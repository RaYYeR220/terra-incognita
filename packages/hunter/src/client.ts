import type { HuntStatus, LogEntry, Pin, Ship, Vec3, Zone } from '@terra-incognita/core';

/** Everything about a hunt that every participant can read. */
export interface PublicState {
  status: HuntStatus;
  startsAt: number;
  deadline: number;
  speedKms: number;
  zoneIntervalSecs: number;
  zone: Zone;
  /** Ships by board index. */
  ships: Ship[];
  /** Recent probe positions of all ships, oldest first. Bands are never public. */
  pins: Pin[];
  probesTotal: number;
  /** Owner of the winning ship once the hunt has ended with a winner. */
  winner: string | null;
}

/**
 * What a hunter needs from a hunt. The simulator implements it in memory; the chain client
 * implements it with rollup transactions and private account reads.
 */
export interface HuntClient {
  /** Identity of the player this client acts for, as it appears in `Ship.owner`. */
  readonly player: string;

  /** Current time in unix seconds, on the clock the hunt's rules use. */
  now(): Promise<number>;
  getPublicState(): Promise<PublicState>;
  /** The player's private logbook, oldest entry first. */
  getMyLogbook(): Promise<LogEntry[]>;

  /** Puts the player's ship on the board. Once per hunt. */
  embark(start: Vec3): Promise<void>;
  /** Starts a flight. Rejected while the ship is in the air. */
  setCourse(dest: Vec3): Promise<void>;
  /** Takes a sounding at the ship's position and returns the new logbook entry. */
  probe(): Promise<LogEntry>;

  /** Resolves once `now()` has reached `ts`. */
  sleepUntil(ts: number): Promise<void>;
}

export type HuntErrorCode =
  | 'HuntFull'
  | 'AlreadyJoined'
  | 'NotJoined'
  | 'AlreadyEmbarked'
  | 'NotEmbarked'
  | 'NotLive'
  | 'InvalidPosition'
  | 'InFlight'
  | 'Cooldown'
  | 'ProbeLimit';

/** A rule of the hunt rejected the action. */
export class HuntError extends Error {
  readonly code: HuntErrorCode;

  constructor(code: HuntErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'HuntError';
    this.code = code;
  }
}
