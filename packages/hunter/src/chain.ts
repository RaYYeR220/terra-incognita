import { HuntStatus } from '@terra-incognita/core';
import type { LogEntry, Vec3 } from '@terra-incognita/core';
import type { Keypair, PublicKey } from '@solana/web3.js';
import { PlayerSession, TerraTxError, advanceHunt, concludeHunt, decodeBoard, decodeHunt } from '@terra-incognita/sdk';
import type { HuntAccount, TerraClient } from '@terra-incognita/sdk';

import { HuntError } from './client.js';
import type { HuntClient, HuntErrorCode, PublicState } from './client.js';
import { runHunter } from './play.js';
import type { HunterResult } from './play.js';
import { PERSONALITIES } from './personalities.js';
import type { PersonalityName } from './personalities.js';
import { Solver } from './solver.js';

const RULE_ERRORS: Record<string, HuntErrorCode> = {
  NotLive: 'NotLive',
  DeadlinePassed: 'NotLive',
  HuntClosed: 'NotLive',
  NotStarted: 'NotLive',
  InFlight: 'InFlight',
  Cooldown: 'Cooldown',
  ProbeLimit: 'ProbeLimit',
  AlreadyEmbarked: 'AlreadyEmbarked',
  NotEmbarked: 'NotEmbarked',
  HuntFull: 'HuntFull',
  NotUnitVector: 'InvalidPosition',
};

/**
 * `HuntClient` on a real hunt: public state from the rollup (or from Solana once the hunt has
 * been released), the private logbook through the operator's rollup session, and every move as
 * a rollup transaction signed by the operator. Anything that plays against `SimHunt` plays
 * against a live hunt through this.
 */
export class ChainHuntClient implements HuntClient {
  readonly player: string;
  private readonly client: TerraClient;

  constructor(readonly session: PlayerSession) {
    this.player = session.owner.toBase58();
    this.client = session.client;
  }

  now(): Promise<number> {
    return this.client.now();
  }

  private async readHunt(): Promise<{ hunt: HuntAccount; boardData: Uint8Array | null }> {
    const { hunt: address, ix } = this.session;
    const [huntInfo, boardInfo] = await this.client.rollup.getMultipleAccountsInfo([address, ix.addresses.board]);
    let hunt = huntInfo ? decodeHunt(address, huntInfo.data) : null;
    // A finalized hunt lives on Solana again; the rollup only keeps a stale copy.
    if (!hunt || hunt.finalized) hunt = (await this.client.fetchHunt(address)) ?? hunt;
    if (!hunt) throw new Error(`hunt ${address.toBase58()} not found`);
    return { hunt, boardData: boardInfo?.data ?? null };
  }

  async getPublicState(): Promise<PublicState> {
    let { hunt, boardData } = await this.readHunt();
    // Nobody may have ticked since the deadline; without that tick the hunt never ends.
    if (hunt.status === HuntStatus.Live && (await this.now()) >= hunt.deadline) {
      await concludeHunt(this.client, hunt.address, this.session.operator);
      ({ hunt, boardData } = await this.readHunt());
    }
    const board = boardData ? decodeBoard(this.session.ix.addresses.board, boardData) : null;
    return {
      status: hunt.status,
      startsAt: hunt.startsAt,
      deadline: hunt.deadline,
      speedKms: hunt.speedKms,
      zoneIntervalSecs: hunt.zoneIntervalSecs,
      zone: hunt.zone,
      ships: board?.ships ?? [],
      pins: board?.pins ?? [],
      probesTotal: hunt.probesTotal,
      winner: hunt.winner?.toBase58() ?? null,
    };
  }

  async getMyLogbook(): Promise<LogEntry[]> {
    return (await this.session.readLogbook())?.entries ?? [];
  }

  async embark(start: Vec3): Promise<void> {
    await this.rules(() => this.session.embark(start));
  }

  async setCourse(dest: Vec3): Promise<void> {
    await this.rules(() => this.session.setCourse(dest));
  }

  async probe(): Promise<LogEntry> {
    return (await this.rules(() => this.session.probe())).entry;
  }

  sleepUntil(ts: number): Promise<void> {
    return this.session.sleepUntil(ts);
  }

  /** Turns rejections by the program into the `HuntError` codes the hunter understands. */
  private async rules<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (!(error instanceof TerraTxError)) throw error;
      const code = error.code ? RULE_ERRORS[error.code] : undefined;
      if (code) throw new HuntError(code, error.message);
      // A hunt released from the rollup rejects every move before the program runs.
      const state = await this.getPublicState().catch(() => null);
      if (state && state.status !== HuntStatus.Live) throw new HuntError('NotLive', error.message);
      throw error;
    }
  }
}

export interface ChainBot {
  name: string;
  /** Funded wallet that joins and receives any prize. */
  owner: Keypair;
  personality: PersonalityName;
  seed?: number;
  /** Session key; a fresh one is created when absent. */
  operator?: Keypair;
}

export type BotEvent =
  | { bot: string; kind: 'joined'; signature: string }
  | { bot: string; kind: 'course'; dest: Vec3 }
  | { bot: string; kind: 'probe'; entry: LogEntry; index: number }
  | { bot: string; kind: 'done'; result: HunterResult }
  | { bot: string; kind: 'error'; error: unknown };

export interface BotOutcome {
  name: string;
  owner: string;
  personality: PersonalityName;
  result: HunterResult | null;
  error?: unknown;
}

export interface RunBotsOptions {
  onEvent?: (event: BotEvent) => void;
  /**
   * Seconds between keeper steps (`advanceHunt`) while the bots play, so the zone shrinks and
   * the deadline is enforced even without a crank in the rollup. 0 turns the keeper off.
   * Default 3.
   */
  keeperSecs?: number;
}

/**
 * Joins every bot to `hunt` and plays them against each other until the hunt is over. A bot
 * that joined earlier flies with its owner key, since a lost operator key cannot be recovered.
 */
export async function runChainBots(
  client: TerraClient,
  hunt: PublicKey,
  bots: ChainBot[],
  options: RunBotsOptions = {},
): Promise<BotOutcome[]> {
  const onEvent = options.onEvent ?? (() => undefined);
  const keeperSecs = options.keeperSecs ?? 3;
  let keeping = keeperSecs > 0;
  const keeper = (async () => {
    while (keeping) {
      await new Promise((resolve) => setTimeout(resolve, keeperSecs * 1_000));
      if (!keeping) break;
      await advanceHunt(client, hunt).catch(() => undefined);
    }
  })();
  const outcomes = await Promise.all(
    bots.map(async (bot): Promise<BotOutcome> => {
      const base = { name: bot.name, owner: bot.owner.publicKey.toBase58(), personality: bot.personality };
      try {
        const session = await joinOrResume(client, hunt, bot);
        if (session.signature) onEvent({ bot: bot.name, kind: 'joined', signature: session.signature });
        const result = await runHunter(new ChainHuntClient(session.session), new Solver(PERSONALITIES[bot.personality], bot.seed ?? 1), {
          onCourse: (dest) => onEvent({ bot: bot.name, kind: 'course', dest }),
          onProbe: (entry, index) => onEvent({ bot: bot.name, kind: 'probe', entry, index }),
        });
        onEvent({ bot: bot.name, kind: 'done', result });
        return { ...base, result };
      } catch (error) {
        onEvent({ bot: bot.name, kind: 'error', error });
        return { ...base, result: null, error };
      }
    }),
  );
  keeping = false;
  await keeper;
  return outcomes;
}

async function joinOrResume(
  client: TerraClient,
  hunt: PublicKey,
  bot: ChainBot,
): Promise<{ session: PlayerSession; signature: string | null }> {
  const account = await client.fetchHunt(hunt);
  if (!account) throw new Error(`hunt ${hunt.toBase58()} not found`);
  const logbook = new PlayerSession(client, account, bot.owner.publicKey, bot.owner).logbookAddress;
  if ((await client.residence(logbook)) !== 'missing') {
    return { session: new PlayerSession(client, account, bot.owner.publicKey, bot.operator ?? bot.owner), signature: null };
  }
  const { session, signature } = await PlayerSession.join(client, bot.owner, hunt, bot.operator ? { operator: bot.operator } : {});
  return { session, signature };
}

