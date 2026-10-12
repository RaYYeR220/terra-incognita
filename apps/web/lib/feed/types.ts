import type { HuntMode, HuntStatus, Zone } from '@terra-incognita/core';

/** What a list or a poster needs to know about a hunt, all of it public. */
export interface HuntSummary {
  /** Route id: the hunt account address on chain, or a short name for local hunts. */
  id: string;
  /** Sequence number for hunts that have one; chain hunts are known by title and address. */
  number: number | null;
  title: string;
  status: HuntStatus;
  mode: HuntMode;
  /** The riddle of an author-sealed hunt. */
  clue: string | null;
  potSol: number;
  entryFeeSol: number;
  /** Ships that have embarked. */
  ships: number;
  maxPlayers: number;
  zone: Zone;
  startsAt: number;
  deadline: number;
  /** Board index of the winning ship, once there is one. */
  winnerShip: number | null;
  /** Unix seconds this summary was read at, on the hunt's clock. */
  readAt: number;
  /** The location has been revealed and the proof can be built. */
  finalized?: boolean;
  creator?: string;
}

export interface HuntFeed {
  /** The hunt the landing page points at: the live demo hunt if there is one. */
  featured(): Promise<HuntSummary | null>;
  /** Live hunts first, then finished ones, newest first. */
  list(): Promise<HuntSummary[]>;
  /** Calls back whenever the public state of the hunt changes. Returns an unsubscribe. */
  watch(id: string, onChange: (summary: HuntSummary) => void): () => void;
}
