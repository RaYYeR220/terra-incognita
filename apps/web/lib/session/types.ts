import type { HuntMode, HuntStatus, LogEntry, Pin, Ship, Vec3, Zone } from '@terra-incognita/core';

/** Fixed facts about a hunt, read once. */
export interface HuntInfo {
  id: string;
  /** Sequence number, for hunts that have one. */
  number: number | null;
  title: string;
  mode: HuntMode;
  clue: string | null;
  /** The commitment anchored before play, hex. The "fingerprint" of the treasure. */
  commitmentHex: string;
  startsAt: number;
  deadline: number;
  zoneIntervalSecs: number;
  speedKms: number;
  maxProbes: number;
  entryFeeSol: number;
  /** Where the hunt runs: an in-browser simulator or a Solana cluster. */
  network: 'simulator' | 'devnet' | 'mainnet';
}

export interface Settlement {
  /** Board index of the ship that was paid. */
  shipIndex: number;
  payoutSol: number;
  /** Transaction signature on Solana, if the payout is a real transaction. */
  signature: string | null;
  explorerUrl: string | null;
}

/** Everything every participant can see. Bands are never part of it. */
export interface PublicView {
  status: HuntStatus;
  /** Hunt clock when this view was read, unix seconds. */
  readAt: number;
  zone: Zone;
  ships: readonly Ship[];
  pins: readonly Pin[];
  probesTotal: number;
  potSol: number;
  /** Board index of the winning ship once the hunt has ended with one. */
  winnerShip: number | null;
  settlement: Settlement | null;
  /** Revealed after the hunt: the treasure's position. Null while it is sealed. */
  revealed: Vec3 | null;
  /** New ships can still join. */
  joinable: boolean;
}

export interface Identity {
  kind: 'guest' | 'wallet';
  /** Short label for the guest strip, e.g. a shortened address. */
  label: string;
}

export type Pending = 'join' | 'embark' | 'course' | 'probe' | null;

/** What only this player can see, plus the state of their own requests. */
export interface MyView {
  identity: Identity | null;
  /** Board index of my ship, or -1 before embarking. */
  shipIndex: number;
  /** I hold an entry in this hunt (joined, whether or not my ship set off). */
  joined: boolean;
  /** My private logbook, oldest first. */
  logbook: readonly LogEntry[];
  pending: Pending;
  /** My logbook shows a strike that the public board has not confirmed yet. */
  strikeUnconfirmed: boolean;
  error: string | null;
}

export interface SessionSnapshot {
  phase: 'loading' | 'ready' | 'error';
  info: HuntInfo | null;
  view: PublicView | null;
  me: MyView;
  /** Set when the session could not load at all. */
  error: string | null;
}

export interface ReadAttempt {
  readable: false;
  /** Who asked, in the voice of the slip that comes back. */
  asker: string;
  detail: string;
}

/**
 * One player's connection to one hunt. The UI renders `getSnapshot()` and calls the actions;
 * implementations keep the snapshot fresh and call subscribers on every change.
 */
export interface HuntSession {
  readonly huntId: string;
  getSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): () => void;
  /** The hunt's clock in fractional unix seconds, for animating ships between snapshots. */
  now(): number;
  /** Puts my ship on the board at `start`, joining the hunt first if needed. */
  embark(start: Vec3): Promise<void>;
  setCourse(dest: Vec3): Promise<void>;
  /** Takes a sounding where my ship is and resolves with the new logbook entry. */
  probe(): Promise<LogEntry>;
  /** Asks for the treasure's coordinates as an outsider. The answer is always empty. */
  attemptRead(): Promise<ReadAttempt>;
  /** Takes my entry fee back from a hunt that ended without a single sounding. */
  claimRefund?(): Promise<{ signature: string; explorerUrl: string }>;
  dispose(): void;
}

export const EMPTY_ME: MyView = {
  identity: null,
  shipIndex: -1,
  joined: false,
  logbook: [],
  pending: null,
  strikeUnconfirmed: false,
  error: null,
};
