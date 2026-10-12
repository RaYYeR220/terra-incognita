import type { TerraSigner } from '@terra-incognita/sdk';

import { ChainHuntSession } from './chain-session';
import { SimHuntSession } from './sim-session';
import type { HuntSession } from './types';

export interface SessionOptions {
  /** Play against the in-browser simulator instead of the chain. */
  sim?: boolean;
  /** A connected wallet; a guest key is used when absent. */
  wallet?: TerraSigner | null;
}

/** The session behind the game screen for a hunt id. */
export function createSession(huntId: string, options: SessionOptions = {}): HuntSession {
  if (options.sim || huntId === 'practice') return new SimHuntSession(huntId);
  return new ChainHuntSession(huntId, options.wallet ?? null);
}
