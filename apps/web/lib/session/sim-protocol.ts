import type { LogEntry } from '@terra-incognita/core';

import type { HuntInfo, PublicView } from './types';

export interface SimConfig {
  id: string;
  number: number;
  title: string;
  bots: number;
  prizeSol: number;
  entryFeeSol: number;
  durationSecs: number;
  zoneIntervalSecs: number;
  /** Seconds of hunt already played by the bots when the page opens. */
  warmupSecs: number;
}

export type ToSim =
  | { type: 'init'; config: SimConfig }
  | { type: 'embark'; id: number; at: readonly number[] }
  | { type: 'course'; id: number; at: readonly number[] }
  | { type: 'probe'; id: number };

export type FromSim =
  | { type: 'snapshot'; info: HuntInfo; view: PublicView; shipIndex: number; logbook: LogEntry[] }
  | { type: 'result'; id: number; ok: true; value: unknown }
  | { type: 'result'; id: number; ok: false; error: string }
  | { type: 'failed'; error: string };
