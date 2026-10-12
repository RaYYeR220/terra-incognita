import type { BAND_NAMES } from './constants.js';

/** A point on the globe: integer unit vector (x, y, z) at scale 1e9. */
export type Vec3 = readonly [x: number, y: number, z: number];

/** Distance band of a probe. 0 is a strike (within 50 km), 7 is beyond 10 000 km. */
export type Band = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type BandName = (typeof BAND_NAMES)[number];

/** Public search zone: a spherical cap. Stage 0 is the whole globe and its centre is unused. */
export interface Zone {
  stage: number;
  center: Vec3;
}

/** A ship on the public board. Timestamps are unix seconds. */
export interface Ship {
  /** Base58 public key of the player who owns the ship. */
  owner: string;
  from: Vec3;
  to: Vec3;
  departTs: number;
  arriveTs: number;
  probes: number;
  lastProbeTs: number;
  embarked: boolean;
}

/** A public marker left where a ship probed. The band is not part of it. */
export interface Pin {
  shipIndex: number;
  pos: Vec3;
  ts: number;
}

/** One private logbook entry. */
export interface LogEntry {
  pos: Vec3;
  band: Band;
  ts: number;
}

export enum HuntStatus {
  Created = 0,
  Sealing = 1,
  Live = 2,
  Struck = 3,
  Closest = 4,
  Void = 5,
}

export enum HuntMode {
  Vrf = 0,
  Author = 1,
}

export function isTerminal(status: HuntStatus): boolean {
  return status === HuntStatus.Struck || status === HuntStatus.Closest || status === HuntStatus.Void;
}
