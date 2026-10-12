import {
  DEFAULT_SPEED_KMS,
  HuntStatus,
  MAX_PLAYERS,
  MAX_PROBES,
  PIN_RING_SIZE,
  PROBE_COOLDOWN_SECS,
  bandOf,
  commitment,
  dot,
  isUnit,
  locationFromRandomness,
  saltFromRandomness,
  travelSecs,
  zoneAt,
  zoneSeedFromRandomness,
  zoneStageAt,
} from '@terra-incognita/core';
import type { AuditInput, LogEntry, Pin, Ship, Vec3, Zone } from '@terra-incognita/core';

import { HuntError } from './client.js';
import type { HuntClient, PublicState } from './client.js';

export interface SimHuntOptions {
  /** 32 bytes standing in for the VRF output. Location, salt and zone seed derive from it. */
  randomness: Uint8Array;
  /** Hunt account key used in the commitment. Defaults to 32 zero bytes. */
  hunt?: Uint8Array;
  /** Unix time at which the hunt goes live. The simulated clock starts here. */
  startsAt?: number;
  /** Seconds from the start to the deadline. */
  durationSecs?: number;
  /** Seconds between zone stages; 0 keeps the zone at the whole globe. */
  zoneIntervalSecs?: number;
  speedKms?: number;
  maxPlayers?: number;
}

interface Sleeper {
  ts: number;
  seq: number;
  wake: () => void;
}

const DEFAULT_START = 1_760_000_000;
const DEFAULT_DURATION_SECS = 900;
const DEFAULT_ZONE_INTERVAL_SECS = 60;
const STALL_LIMIT = 10_000;

function yieldToTasks(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof setImmediate === 'function') setImmediate(resolve);
    else setTimeout(resolve, 0);
  });
}

/**
 * A hunt held in memory that enforces the rules of the program: flight time, the probe cooldown
 * and cap, the zone schedule, the strike radius and closest-wins at the deadline.
 *
 * Time is virtual and counted in whole seconds, like the on-chain clock. It moves only through
 * `advanceTo`, a client's `sleepUntil`, or the scheduler in `play`.
 */
export class SimHunt {
  readonly hunt: Uint8Array;
  readonly startsAt: number;
  readonly deadline: number;
  readonly zoneIntervalSecs: number;
  readonly speedKms: number;
  readonly maxPlayers: number;
  /** Published before play, exactly as the program anchors it when the hunt is armed. */
  readonly commitment: Uint8Array;

  private readonly location: Vec3;
  private readonly salt: Uint8Array;
  private readonly zoneSeed: Uint8Array;

  private clock: number;
  private status: HuntStatus = HuntStatus.Live;
  private zone: Zone = { stage: 0, center: [0, 0, 0] };
  private readonly ships: Ship[] = [];
  private readonly pins: Pin[] = [];
  private readonly logbooks = new Map<string, LogEntry[]>();
  private probesTotal = 0;
  private winner: string | null = null;
  private endedAt: number | null = null;
  private best: { dot: bigint; player: string; ts: number } | null = null;

  private sleepers: Sleeper[] = [];
  private sleeperSeq = 0;
  private scheduled = false;

  constructor(options: SimHuntOptions) {
    if (options.randomness.length !== 32) throw new RangeError('randomness must be 32 bytes');
    this.hunt = options.hunt ?? new Uint8Array(32);
    this.startsAt = options.startsAt ?? DEFAULT_START;
    this.deadline = this.startsAt + (options.durationSecs ?? DEFAULT_DURATION_SECS);
    this.zoneIntervalSecs = options.zoneIntervalSecs ?? DEFAULT_ZONE_INTERVAL_SECS;
    this.speedKms = options.speedKms ?? DEFAULT_SPEED_KMS;
    this.maxPlayers = Math.min(options.maxPlayers ?? MAX_PLAYERS, MAX_PLAYERS);
    this.location = locationFromRandomness(options.randomness);
    this.salt = saltFromRandomness(options.randomness);
    this.zoneSeed = zoneSeedFromRandomness(options.randomness);
    this.commitment = commitment(this.hunt, this.location, this.salt);
    this.clock = this.startsAt;
  }

  get now(): number {
    return this.clock;
  }

  /** Registers a player and returns the client that acts for them. */
  join(player: string): HuntClient {
    if (this.logbooks.has(player)) throw new HuntError('AlreadyJoined');
    if (this.logbooks.size >= this.maxPlayers) throw new HuntError('HuntFull');
    this.logbooks.set(player, []);
    return this.client(player);
  }

  client(player: string): HuntClient {
    if (!this.logbooks.has(player)) throw new HuntError('NotJoined');
    return {
      player,
      now: async () => this.clock,
      getPublicState: async () => this.publicState(),
      getMyLogbook: async () => this.logbook(player),
      embark: async (start) => this.embark(player, start),
      setCourse: async (dest) => this.setCourse(player, dest),
      probe: async () => this.probe(player),
      sleepUntil: (ts) => this.sleepUntil(ts),
    };
  }

  embark(player: string, start: Vec3): void {
    this.tick();
    const log = this.logbooks.get(player);
    if (!log) throw new HuntError('NotJoined');
    if (this.status !== HuntStatus.Live) throw new HuntError('NotLive');
    if (this.ships.some((ship) => ship.owner === player)) throw new HuntError('AlreadyEmbarked');
    if (!isUnit(start)) throw new HuntError('InvalidPosition');
    this.ships.push({
      owner: player,
      from: start,
      to: start,
      departTs: this.clock,
      arriveTs: this.clock,
      probes: 0,
      lastProbeTs: 0,
      embarked: true,
    });
  }

  setCourse(player: string, dest: Vec3): void {
    this.tick();
    const ship = this.shipOf(player);
    if (this.status !== HuntStatus.Live) throw new HuntError('NotLive');
    if (!isUnit(dest)) throw new HuntError('InvalidPosition');
    if (this.clock < ship.arriveTs) throw new HuntError('InFlight');
    ship.from = ship.to;
    ship.to = dest;
    ship.departTs = this.clock;
    ship.arriveTs = this.clock + travelSecs(ship.from, dest, this.speedKms);
  }

  probe(player: string): LogEntry {
    this.tick();
    const ship = this.shipOf(player);
    if (this.status !== HuntStatus.Live) throw new HuntError('NotLive');
    if (this.clock < ship.arriveTs) throw new HuntError('InFlight');
    if (ship.probes >= MAX_PROBES) throw new HuntError('ProbeLimit');
    if (this.clock - ship.lastProbeTs < PROBE_COOLDOWN_SECS) throw new HuntError('Cooldown');

    const d = dot(ship.to, this.location);
    const entry: LogEntry = { pos: ship.to, band: bandOf(d), ts: this.clock };
    (this.logbooks.get(player) as LogEntry[]).push(entry);
    this.pins.push({ shipIndex: this.ships.indexOf(ship), pos: ship.to, ts: this.clock });
    if (this.pins.length > PIN_RING_SIZE) this.pins.shift();
    ship.probes += 1;
    ship.lastProbeTs = this.clock;
    this.probesTotal += 1;

    // Strictly greater: of two equally close soundings the earlier one keeps the lead.
    if (this.best === null || d > this.best.dot) {
      this.best = { dot: d, player, ts: this.clock };
    }
    if (entry.band === 0) {
      this.status = HuntStatus.Struck;
      this.winner = player;
      this.endedAt = this.clock;
    }
    return { ...entry };
  }

  /** Applies everything the clock implies: the zone stage and the deadline. */
  tick(): void {
    if (this.status !== HuntStatus.Live) return;
    const at = Math.min(this.clock, this.deadline);
    const stage = zoneStageAt(at, this.startsAt, this.zoneIntervalSecs);
    if (stage > this.zone.stage) this.zone = zoneAt(this.location, this.zoneSeed, stage);
    if (this.clock >= this.deadline) {
      this.status = this.best ? HuntStatus.Closest : HuntStatus.Void;
      this.winner = this.best ? this.best.player : null;
      this.endedAt = this.deadline;
    }
  }

  /** Moves the clock forward. Earlier timestamps are ignored. */
  advanceTo(ts: number): void {
    const target = Math.ceil(ts);
    if (target > this.clock) this.clock = target;
    this.tick();
  }

  advance(secs: number): void {
    this.advanceTo(this.clock + secs);
  }

  publicState(): PublicState {
    this.tick();
    return {
      status: this.status,
      startsAt: this.startsAt,
      deadline: this.deadline,
      speedKms: this.speedKms,
      zoneIntervalSecs: this.zoneIntervalSecs,
      zone: { ...this.zone },
      ships: this.ships.map((ship) => ({ ...ship })),
      pins: this.pins.map((pin) => ({ ...pin })),
      probesTotal: this.probesTotal,
      winner: this.winner,
    };
  }

  logbook(player: string): LogEntry[] {
    const log = this.logbooks.get(player);
    if (!log) throw new HuntError('NotJoined');
    return log.map((entry) => ({ ...entry }));
  }

  get ended(): boolean {
    this.tick();
    return this.status !== HuntStatus.Live;
  }

  /** Unix time at which the hunt ended, or null while it is live. */
  get endTime(): number | null {
    this.tick();
    return this.endedAt;
  }

  /**
   * What finalising publishes: the location, the salt and every logbook, in the shape
   * `auditHunt` takes. Only available once the hunt has ended.
   */
  reveal(): AuditInput {
    if (!this.ended) throw new HuntError('NotLive', 'the hunt is still live');
    return {
      hunt: this.hunt,
      revealedLocation: this.location,
      revealedSalt: this.salt,
      commitment: this.commitment,
      logbooks: [...this.logbooks.entries()].map(([player, entries]) => ({
        player,
        entries: entries.map((entry) => ({ ...entry })),
      })),
    };
  }

  /** The hidden state, for tests and benchmarks. A real hunt has no such door. */
  peek(): { location: Vec3; salt: Uint8Array; zoneSeed: Uint8Array } {
    return { location: this.location, salt: this.salt, zoneSeed: this.zoneSeed };
  }

  /**
   * Waits for the clock. Outside `play` there is a single driver, so the clock simply jumps.
   * Inside `play` the caller is parked until the scheduler reaches its timestamp.
   */
  sleepUntil(ts: number): Promise<void> {
    if (!this.scheduled) {
      this.advanceTo(ts);
      return Promise.resolve();
    }
    if (ts <= this.clock) return Promise.resolve();
    return new Promise((resolve) => {
      this.sleepers.push({ ts, seq: this.sleeperSeq, wake: resolve });
      this.sleeperSeq += 1;
    });
  }

  /**
   * Runs several players against the same hunt on the shared virtual clock. Each task runs until
   * it sleeps; the clock then jumps to the earliest wake-up and exactly one task resumes, so a
   * run is fully determined by the tasks and their seeds.
   */
  async play<T>(tasks: readonly (() => Promise<T>)[]): Promise<T[]> {
    if (this.scheduled) throw new Error('play is already running');
    this.scheduled = true;
    try {
      let pending = tasks.length;
      const running = tasks.map((task) =>
        task().finally(() => {
          pending -= 1;
        }),
      );
      const all = Promise.all(running);
      all.catch(() => undefined);

      let stalled = 0;
      for (;;) {
        await yieldToTasks();
        if (pending === 0) break;
        const next = this.takeEarliestSleeper();
        if (!next) {
          stalled += 1;
          if (stalled > STALL_LIMIT) throw new Error('simulation stalled: a task waits on something other than the clock');
          continue;
        }
        stalled = 0;
        this.advanceTo(next.ts);
        next.wake();
      }
      return await all;
    } finally {
      this.scheduled = false;
      this.sleepers = [];
    }
  }

  private takeEarliestSleeper(): Sleeper | undefined {
    let index = -1;
    for (let i = 0; i < this.sleepers.length; i += 1) {
      const candidate = this.sleepers[i] as Sleeper;
      const current = index < 0 ? undefined : this.sleepers[index];
      if (!current || candidate.ts < current.ts || (candidate.ts === current.ts && candidate.seq < current.seq)) {
        index = i;
      }
    }
    return index < 0 ? undefined : this.sleepers.splice(index, 1)[0];
  }

  private shipOf(player: string): Ship {
    if (!this.logbooks.has(player)) throw new HuntError('NotJoined');
    const ship = this.ships.find((candidate) => candidate.owner === player);
    if (!ship) throw new HuntError('NotEmbarked');
    return ship;
  }
}
