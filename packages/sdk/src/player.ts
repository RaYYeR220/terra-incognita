import { Keypair, PublicKey } from '@solana/web3.js';
import { isUnit } from '@terra-incognita/core';
import type { LogEntry, Ship, Vec3 } from '@terra-incognita/core';

import type { HuntAccount, LogbookAccount } from './accounts.js';
import { sleep, waitFor } from './client.js';
import type { TerraClient } from './client.js';
import { COMPUTE_UNITS, LIMITS } from './constants.js';
import { TerraError, isTxError } from './errors.js';
import { concludeHunt } from './hunts.js';
import { HuntInstructions } from './instructions.js';
import { keypairSigner, toSigner } from './signer.js';
import type { LocalSigner, TerraSigner } from './signer.js';

/** What a player session needs to survive a page reload. Contains the operator's secret key. */
export interface PlayerSessionData {
  hunt: string;
  owner: string;
  operatorSecretKey: number[];
}

export interface ProbeResult {
  signature: string;
  entry: LogEntry;
  /** Position of the entry in the logbook. */
  index: number;
  /** The sounding landed within 50 km. */
  strike: boolean;
  /** Transactions sent after a strike to make it public and end the hunt. */
  conclusion?: { tick?: string; finalize?: string };
}

export interface ShipView {
  index: number;
  ship: Ship;
}

export interface ProbeOptions {
  /** Wait for the ship to arrive and the gear to cool down before sending. Default true. */
  wait?: boolean;
  /** After a strike, tick and finalize the hunt right away. Default true. */
  conclude?: boolean;
}

/**
 * One player in one hunt. The owner's wallet signs only `join` on Solana; everything in the
 * rollup is signed by the operator, a session key registered at join that holds no SOL.
 */
export class PlayerSession {
  readonly ix: HuntInstructions;
  readonly operator: LocalSigner;

  constructor(
    readonly client: TerraClient,
    hunt: Pick<HuntAccount, 'address' | 'creator' | 'validator'>,
    readonly owner: PublicKey,
    operator: Keypair,
  ) {
    this.ix = HuntInstructions.of(hunt, client.programId);
    this.operator = keypairSigner(operator);
  }

  get hunt(): PublicKey {
    return this.ix.hunt;
  }

  get logbookAddress(): PublicKey {
    return this.ix.logbook(this.owner);
  }

  /**
   * Joins on Solana: pays the entry fee, creates the logbook and delegates it. Resolves once the
   * rollup can use the logbook. A fresh operator key is created unless one is given. With
   * `embarkAt` the airship is also put on the board, signed by the operator.
   */
  static async join(
    client: TerraClient,
    wallet: TerraSigner | Keypair,
    huntAddress: PublicKey,
    options: { operator?: Keypair; embarkAt?: Vec3; onJoined?: (signature: string) => void } = {},
  ): Promise<{ session: PlayerSession; signature: string; embarkSignature?: string }> {
    const signer = toSigner(wallet);
    if (options.embarkAt) assertUnit(options.embarkAt);
    const hunt = await client.fetchHunt(huntAddress);
    if (!hunt) throw new TerraError('InvalidHunt', `no hunt at ${huntAddress.toBase58()}`);
    const operator = options.operator ?? Keypair.generate();
    const session = new PlayerSession(client, hunt, signer.publicKey, operator);
    const signature = await client.send('solana', [session.ix.join(signer.publicKey, operator.publicKey)], signer, {
      computeUnits: COMPUTE_UNITS.join,
    });
    options.onJoined?.(signature);
    await client.waitForDelegation([session.logbookAddress]);
    if (!options.embarkAt) return { session, signature };
    return { session, signature, embarkSignature: await session.embark(options.embarkAt) };
  }

  /** Picks up a session saved with `serialize`, for example after a reload. */
  static async restore(client: TerraClient, data: PlayerSessionData): Promise<PlayerSession> {
    const huntAddress = new PublicKey(data.hunt);
    const hunt = await client.fetchHunt(huntAddress);
    if (!hunt) throw new TerraError('InvalidHunt', `no hunt at ${data.hunt}`);
    return new PlayerSession(client, hunt, new PublicKey(data.owner), Keypair.fromSecretKey(Uint8Array.from(data.operatorSecretKey)));
  }

  serialize(): PlayerSessionData {
    return {
      hunt: this.hunt.toBase58(),
      owner: this.owner.toBase58(),
      operatorSecretKey: Array.from(this.operator.keypair.secretKey),
    };
  }

  /** The private logbook, read through a rollup session of the operator. */
  readLogbook(): Promise<LogbookAccount | null> {
    return this.client.fetchLogbook(this.hunt, this.owner, this.operator);
  }

  /** This player's airship on the public board, or null before embarking. */
  async ship(): Promise<ShipView | null> {
    const board = await this.client.fetchBoard(this.hunt);
    if (!board) return null;
    const owner = this.owner.toBase58();
    const index = board.ships.findIndex((ship) => ship.embarked && ship.owner === owner);
    const ship = board.ships[index];
    return ship ? { index, ship } : null;
  }

  /** Puts the airship on the board at `start`. The sounding gear starts cooling down. */
  embark(start: Vec3): Promise<string> {
    assertUnit(start);
    return this.client.send('rollup', [this.ix.embark(this.operator.publicKey, this.owner, start)], this.operator, {
      computeUnits: COMPUTE_UNITS.embark,
    });
  }

  /** Sends the airship towards `destination`; the flight takes at least a second. */
  setCourse(destination: Vec3): Promise<string> {
    assertUnit(destination);
    return this.client.send('rollup', [this.ix.setCourse(this.operator.publicKey, this.owner, destination)], this.operator);
  }

  /** Sets a course and resolves once the airship has arrived. */
  async fly(destination: Vec3): Promise<{ signature: string; arriveTs: number }> {
    const signature = await this.setCourse(destination);
    const view = await waitFor('the new course on the board', async () => {
      const current = await this.ship();
      return current && current.ship.departTs > 0 ? current : null;
    });
    await this.sleepUntil(view.ship.arriveTs);
    return { signature, arriveTs: view.ship.arriveTs };
  }

  /** Rollup time at which the next sounding is allowed. */
  async readyAt(): Promise<number> {
    const view = await this.ship();
    if (!view) throw new TerraError('NotEmbarked', 'the airship has not embarked');
    return Math.max(view.ship.arriveTs, view.ship.lastProbeTs + LIMITS.probeCooldownSecs);
  }

  /** Resolves once the rollup clock has reached `ts`. */
  async sleepUntil(ts: number): Promise<void> {
    for (;;) {
      const now = await this.client.now();
      if (now >= ts) return;
      await sleep(Math.min(1_000, (ts - now) * 1_000 + 50));
    }
  }

  /**
   * Takes a sounding where the airship is and returns the new logbook entry. A strike (band 0) is
   * recorded privately; unless `conclude` is false this then ticks and finalizes the hunt so the
   * strike becomes public and the payout is scheduled.
   */
  async probe(options: ProbeOptions = {}): Promise<ProbeResult> {
    const before = (await this.readLogbook())?.entries.length ?? 0;
    if (before >= LIMITS.maxProbes) throw new TerraError('ProbeLimit', 'the logbook is full');
    if (options.wait !== false) await this.sleepUntil(await this.readyAt());

    let signature: string | null = null;
    for (let attempt = 0; signature === null; attempt += 1) {
      try {
        signature = await this.client.send('rollup', [this.ix.probe(this.operator.publicKey, this.owner)], this.operator);
      } catch (error) {
        // The local estimate of the rollup clock can be a fraction of a second early.
        if (options.wait === false || attempt >= 6 || !isTxError(error, 'Cooldown', 'InFlight')) throw error;
        await sleep(400);
      }
    }

    const logbook = await waitFor(
      'the sounding in the logbook',
      async () => {
        const current = await this.readLogbook();
        return current && current.entries.length > before ? current : null;
      },
      15_000,
      200,
    );
    const index = logbook.entries.length - 1;
    const entry = logbook.entries[index] as LogEntry;
    const result: ProbeResult = { signature, entry, index, strike: entry.band === 0 };
    if (result.strike && options.conclude !== false) {
      const { tick, finalize } = await concludeHunt(this.client, this.hunt, this.operator);
      result.conclusion = { ...(tick ? { tick } : {}), ...(finalize ? { finalize } : {}) };
    }
    return result;
  }
}

function assertUnit(v: Vec3): void {
  if (!isUnit(v)) throw new TerraError('NotUnitVector', 'positions must be unit vectors scaled by 1e9');
}

