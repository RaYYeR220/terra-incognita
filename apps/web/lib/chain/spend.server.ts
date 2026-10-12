import 'server-only';

import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { huntAddress } from '@terra-incognita/sdk';
import type { HuntAccount, TerraClient } from '@terra-incognita/sdk';

/** The treasury is never drawn below this, by the faucet or by creating hunts. */
export const TREASURY_FLOOR = 1 * LAMPORTS_PER_SOL;

let queue: Promise<unknown> = Promise.resolve();

/**
 * Runs `fn` alone: every operation that signs with the treasury in this instance goes through
 * here, one at a time, so checks made inside it still hold when the transaction is sent.
 */
export function withTreasury<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/**
 * Reads a hunt only if it is one of the treasury's own: the address must be the program's hunt
 * address for that creator and id, so decoded data from any other account is never trusted.
 */
export async function treasuryHunt(client: TerraClient, address: PublicKey, treasury: PublicKey): Promise<HuntAccount | null> {
  const hunt = await client.fetchHunt(address).catch(() => null);
  if (!hunt || !hunt.creator.equals(treasury)) return null;
  if (!huntAddress(treasury, hunt.id, client.programId).equals(address)) return null;
  return hunt;
}
