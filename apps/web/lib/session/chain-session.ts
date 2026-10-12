import { Keypair, PublicKey } from '@solana/web3.js';
import { HuntStatus, MAX_PROBES, bytesToHex, isTerminal } from '@terra-incognita/core';
import type { LogEntry, Vec3 } from '@terra-incognita/core';
import { PlayerSession, TerraTxError, findSettlement, keypairSigner, treasureAddress, watchHunt } from '@terra-incognita/sdk';
import type { HuntAccount, HuntSnapshot, HuntWatch, TerraClient, TerraSigner } from '@terra-incognita/sdk';

import { JOIN_FUNDING, terraClient } from '../chain/client';
import { shortHash } from '../format';
import { explain } from './errors';
import { EMPTY_ME } from './types';
import type { HuntInfo, HuntSession, Pending, PublicView, ReadAttempt, SessionSnapshot } from './types';

const BURNER_KEY = 'terra:burner';
const sessionKey = (hunt: string, owner: string) => `terra:session:${hunt}:${owner}`;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The guest's throwaway key, kept in this browser so a reload keeps the same ship. */
export function guestKeypair(): Keypair {
  const store = storage();
  const saved = store?.getItem(BURNER_KEY);
  if (saved) {
    try {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(saved) as number[]));
    } catch {
      // A damaged entry is replaced below.
    }
  }
  const fresh = Keypair.generate();
  store?.setItem(BURNER_KEY, JSON.stringify(Array.from(fresh.secretKey)));
  return fresh;
}

function codeOf(error: unknown): string {
  if (error instanceof TerraTxError) return error.code ?? 'Error';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : 'Error';
}

/** A live hunt on Solana and the private rollup, played with a session key. */
export class ChainHuntSession implements HuntSession {
  readonly huntId: string;
  private readonly client: TerraClient;
  private readonly address: PublicKey;
  private readonly signer: TerraSigner;
  private readonly identityKind: 'guest' | 'wallet';
  private player: PlayerSession | null = null;
  private watch: HuntWatch | null = null;
  private snapshot: SessionSnapshot = { phase: 'loading', info: null, view: null, me: EMPTY_ME, error: null };
  private readonly listeners = new Set<() => void>();
  private offset = 0;
  private potLamports: number | null = null;
  private lastPlayers = -1;
  private lastProbes = -1;
  private settlementTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(huntId: string, wallet: TerraSigner | null = null) {
    this.huntId = huntId;
    this.client = terraClient();
    this.address = new PublicKey(huntId);
    this.signer = wallet ?? keypairSigner(guestKeypair());
    this.identityKind = wallet ? 'wallet' : 'guest';
    void this.start();
  }

  getSnapshot = (): SessionSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  now(): number {
    return Date.now() / 1000 + this.offset;
  }

  async embark(start: Vec3): Promise<void> {
    if (this.player) {
      await this.run('embark', () => this.player!.embark(start));
      return;
    }
    await this.run('join', async () => {
      if (this.identityKind === 'guest') await this.fundGuest();
      const { session } = await PlayerSession.join(this.client, this.signer, this.address, {
        embarkAt: start,
        onJoined: () => this.patchMe({ pending: 'embark' }),
      });
      this.player = session;
      storage()?.setItem(sessionKey(this.huntId, this.signer.publicKey.toBase58()), JSON.stringify(session.serialize()));
    });
    await this.refreshLogbook();
  }

  async setCourse(dest: Vec3): Promise<void> {
    if (!this.player) throw new Error(explain('NotEmbarked'));
    await this.run('course', () => this.player!.setCourse(dest));
  }

  async probe(): Promise<LogEntry> {
    if (!this.player) throw new Error(explain('NotEmbarked'));
    const result = await this.run('probe', () => this.player!.probe({ wait: true }));
    await this.refreshLogbook();
    return result.entry;
  }

  async attemptRead(): Promise<ReadAttempt> {
    const address = treasureAddress(this.address, this.client.programId);
    let data = 0;
    try {
      const info = await this.client.rollup.getAccountInfo(address);
      data = info?.data.length ?? 0;
    } catch {
      data = 0;
    }
    return {
      readable: false,
      asker: this.identityKind === 'wallet' ? `Your wallet ${shortHash(this.signer.publicKey.toBase58())}` : 'You',
      detail:
        data === 0
          ? `Asked the rollup for ${shortHash(address.toBase58())}. Came back empty: the account refuses every reader, players, the organiser, us.`
          : 'The hunt is over, so its treasure account is open now. While a hunt is at sea the same request comes back empty.',
    };
  }

  dispose(): void {
    this.disposed = true;
    this.watch?.stop();
    if (this.settlementTimer) clearTimeout(this.settlementTimer);
    this.listeners.clear();
  }

  private async start(): Promise<void> {
    try {
      const [chainNow, hunt] = await Promise.all([this.client.now(), this.client.fetchHunt(this.address)]);
      this.offset = chainNow - Date.now() / 1000;
      if (!hunt) {
        this.update({ phase: 'error', error: 'There is no hunt at this address. Check the link, or open the list of hunts.' });
        return;
      }
      this.patchMe({ identity: { kind: this.identityKind, label: shortHash(this.signer.publicKey.toBase58()) } });
      await this.restore();
      this.apply(hunt, null);
      this.watch = watchHunt(this.client, this.address, (snap) => this.onSnapshot(snap), {
        onError: () => undefined,
      });
    } catch (error) {
      this.update({ phase: 'error', error: `Could not reach the hunt: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  private async restore(): Promise<void> {
    const saved = storage()?.getItem(sessionKey(this.huntId, this.signer.publicKey.toBase58()));
    if (!saved) return;
    try {
      this.player = await PlayerSession.restore(this.client, JSON.parse(saved));
      await this.refreshLogbook();
    } catch {
      this.player = null;
    }
  }

  private async fundGuest(): Promise<void> {
    const balance = await this.client.base.getBalance(this.signer.publicKey);
    if (balance >= JOIN_FUNDING * 0.6) return;
    const res = await fetch('/api/faucet', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keys: [this.signer.publicKey.toBase58()], hunt: this.huntId, purpose: 'guest' }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw Object.assign(new Error(body.error ?? 'The faucet is unavailable.'), { code: 'Faucet', detail: body.error });
    }
  }

  private onSnapshot(snap: HuntSnapshot): void {
    if (this.disposed) return;
    this.apply(snap.hunt, snap.board);
  }

  private apply(hunt: HuntAccount, board: HuntSnapshot['board']): void {
    const me = this.signer.publicKey.toBase58();
    const ships = board?.ships ?? this.snapshot.view?.ships ?? [];
    const pins = board?.pins ?? this.snapshot.view?.pins ?? [];
    const shipIndex = ships.findIndex((s) => s.owner === me && s.embarked);
    const winner = hunt.winner?.toBase58() ?? null;
    const winnerShip = winner ? ships.findIndex((s) => s.owner === winner) : -1;

    if (hunt.players !== this.lastPlayers) {
      this.lastPlayers = hunt.players;
      void this.client
        .fetchVault(this.address)
        .then((v) => {
          if (v) this.potLamports = v.pot;
        })
        .catch(() => undefined);
    }
    const myProbes = shipIndex >= 0 ? (ships[shipIndex]?.probes ?? 0) : -1;
    if (myProbes !== this.lastProbes) {
      this.lastProbes = myProbes;
      void this.refreshLogbook();
    }

    const info: HuntInfo = {
      id: this.huntId,
      number: null,
      title: hunt.title || 'Untitled hunt',
      mode: hunt.mode,
      clue: hunt.clue || null,
      commitmentHex: bytesToHex(hunt.commitment),
      startsAt: hunt.startsAt,
      deadline: hunt.deadline,
      zoneIntervalSecs: hunt.zoneIntervalSecs,
      speedKms: hunt.speedKms,
      maxProbes: MAX_PROBES,
      entryFeeSol: hunt.entryFee / 1e9,
      network: this.client.config.cluster === 'mainnet-beta' ? 'mainnet' : 'devnet',
    };
    const pot = (this.potLamports ?? hunt.prizeSeed + hunt.entryFee * hunt.players) / 1e9;
    const previous = this.snapshot.view?.settlement ?? null;
    const view: PublicView = {
      status: hunt.status,
      readAt: Math.floor(this.now()),
      zone: hunt.zone,
      ships,
      pins,
      probesTotal: hunt.probesTotal,
      potSol: pot,
      winnerShip: winnerShip >= 0 ? winnerShip : null,
      settlement: previous,
      revealed: hunt.revealedLocation,
    };
    const strikeUnconfirmed = this.snapshot.me.logbook.some((e) => e.band === 0) && hunt.status === HuntStatus.Live;
    this.update({ phase: 'ready', info, view, me: { ...this.snapshot.me, shipIndex, strikeUnconfirmed } });
    if (isTerminal(hunt.status) && !previous && !this.settlementTimer) this.pollSettlement(0);
  }

  private pollSettlement(attempt: number): void {
    this.settlementTimer = setTimeout(async () => {
      this.settlementTimer = null;
      if (this.disposed) return;
      const found = await findSettlement(this.client, this.address).catch(() => null);
      const view = this.snapshot.view;
      if (found && view) {
        this.update({
          view: {
            ...view,
            potSol: (found.prizeLamports || view.potSol * 1e9) / 1e9,
            settlement: {
              shipIndex: view.winnerShip ?? -1,
              payoutSol: found.prizeLamports / 1e9,
              signature: found.signature,
              explorerUrl: found.explorer,
            },
          },
        });
        return;
      }
      if (attempt < 40) this.pollSettlement(attempt + 1);
    }, attempt === 0 ? 1500 : 5000);
  }

  private async refreshLogbook(): Promise<void> {
    if (!this.player) return;
    try {
      const book = await this.player.readLogbook();
      if (!book) return;
      const live = this.snapshot.view?.status === HuntStatus.Live;
      this.patchMe({ logbook: book.entries, strikeUnconfirmed: live && book.entries.some((e) => e.band === 0) });
    } catch {
      // The next board update tries again.
    }
  }

  private async run<T>(pending: Exclude<Pending, null>, fn: () => Promise<T>): Promise<T> {
    this.patchMe({ pending, error: null });
    try {
      const value = await fn();
      this.patchMe({ pending: null });
      return value;
    } catch (error) {
      const code = codeOf(error);
      const detail = (error as { detail?: string }).detail;
      const text = detail ?? (code === 'Error' ? `That did not go through: ${error instanceof Error ? error.message : String(error)}` : explain(code));
      this.patchMe({ pending: null, error: text });
      throw new Error(text);
    }
  }

  private patchMe(patch: Partial<SessionSnapshot['me']>): void {
    this.update({ me: { ...this.snapshot.me, ...patch } });
  }

  private update(patch: Partial<SessionSnapshot>): void {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }
}
