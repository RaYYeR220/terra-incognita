import 'server-only';

import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { fundAccounts, huntAddress, isJoinable } from '@terra-incognita/sdk';
import type { HuntAccount, TerraClient } from '@terra-incognita/sdk';
import type { Keypair } from '@solana/web3.js';

import { JOIN_FUNDING } from './client';

/** The treasury is never drawn below this, by the faucet or by creating hunts. */
export const TREASURY_FLOOR = 1 * LAMPORTS_PER_SOL;
/** The faucet never covers more than this of a hunt's entry fee. */
const MAX_FAUCET_ENTRY_FEE = 0.02 * LAMPORTS_PER_SOL;
/** Lamports this instance may hand out per rolling hour, whatever the headers say. */
const HOURLY_BUDGET = 0.6 * LAMPORTS_PER_SOL;
const HOUR_MS = 60 * 60_000;
const IP_WINDOW_MS = 10 * 60_000;
const KEYS_PER_IP = 6;
const BOTS_PER_HUNT = 6;

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
  const hunt = await client.fetchHunt(address);
  if (!hunt || !hunt.creator.equals(treasury)) return null;
  if (!huntAddress(treasury, hunt.id, client.programId).equals(address)) return null;
  return hunt;
}

// What this instance has handed out. Entries are added before a transfer and removed only when
// the transfer is known not to have arrived, so the counts can only overstate what was spent.
const reserved: { at: number; lamports: number }[] = [];
const fundedKeys = new Set<string>();
const keysByIp = new Map<string, number[]>();
const botsByHunt = new Map<string, number>();

export type FundResult =
  | { ok: true; funded: string[]; lamports: number; signatures: string[] }
  | { ok: false; status: number; error: string };

const refuse = (status: number, error: string): FundResult => ({ ok: false, status, error });

/**
 * Funds `keys` with just enough to join `hunt`. Every limit is checked inside the treasury queue,
 * right before the transfer; anything unexpected refuses rather than funds.
 */
export function fundKeys(args: {
  client: TerraClient;
  payer: Keypair;
  hunt: PublicKey;
  keys: PublicKey[];
  ip: string;
  purpose: 'guest' | 'bots';
}): Promise<FundResult> {
  const { client, payer, keys, ip, purpose } = args;
  const names = keys.map((k) => k.toBase58());
  const hunt58 = args.hunt.toBase58();

  return withTreasury(async (): Promise<FundResult> => {
    let charge: { at: number; lamports: number } | null = null;
    let target = 0;
    try {
      const hunt = await treasuryHunt(client, args.hunt, payer.publicKey);
      if (!hunt) return refuse(400, 'The faucet only funds the demo hunts it runs.');
      if (!isJoinable(hunt, await client.now())) return refuse(409, 'That hunt can no longer be joined.');
      target = JOIN_FUNDING + Math.min(hunt.entryFee, MAX_FAUCET_ENTRY_FEE);
      const balances = await Promise.all(keys.map((k) => client.base.getBalance(k)));
      const reserve = await client.base.getBalance(payer.publicKey);

      // The caps, all together, immediately before the transfer.
      const now = Date.now();
      while (reserved.length && now - reserved[0]!.at >= HOUR_MS) reserved.shift();
      const recent = (keysByIp.get(ip) ?? []).filter((t) => now - t < IP_WINDOW_MS);
      if (names.some((n) => fundedKeys.has(n))) return refuse(409, 'That key has been funded already.');
      if (balances.some((b) => b >= target / 2)) return refuse(409, 'That key already holds enough to play.');
      if (recent.length + keys.length > KEYS_PER_IP) return refuse(429, 'Too many keys funded from here. Try again in a few minutes.');
      if (purpose === 'bots' && (botsByHunt.get(hunt58) ?? 0) + keys.length > BOTS_PER_HUNT) return refuse(429, 'This hunt already has its share of rival bots.');
      if (reserved.reduce((sum, r) => sum + r.lamports, 0) + target * keys.length > HOURLY_BUDGET) {
        return refuse(429, 'The faucet has given out its hourly share. Try again later, or play a practice hunt.');
      }
      if (reserve - target * keys.length < TREASURY_FLOOR) return refuse(503, 'The faucet is running low. Play a practice hunt for now.');

      // Charge the most a transfer could send, not the top-up estimate, so the budget never lags.
      charge = { at: now, lamports: target * keys.length };
      reserved.push(charge);
      for (const n of names) fundedKeys.add(n);
      keysByIp.set(ip, [...recent, ...keys.map(() => now)]);
      if (purpose === 'bots') botsByHunt.set(hunt58, (botsByHunt.get(hunt58) ?? 0) + keys.length);

      const signatures = await fundAccounts(client, payer, keys, target);
      return { ok: true, funded: names, lamports: target, signatures };
    } catch (error) {
      console.error('faucet failed', error);
      if (charge) await releaseIfNothingArrived(client, keys, target, charge, names, ip, purpose, hunt58);
      return refuse(503, 'The faucet could not fund that right now. Try again in a moment.');
    }
  });
}

/** Gives a reservation back only when every key is confirmed to hold less than was sent. */
async function releaseIfNothingArrived(
  client: TerraClient,
  keys: PublicKey[],
  target: number,
  charge: { at: number; lamports: number },
  names: string[],
  ip: string,
  purpose: 'guest' | 'bots',
  hunt58: string,
): Promise<void> {
  let balances: number[];
  try {
    balances = await Promise.all(keys.map((k) => client.base.getBalance(k)));
  } catch {
    return;
  }
  if (balances.some((b) => b >= target / 2)) return;
  const i = reserved.indexOf(charge);
  if (i >= 0) reserved.splice(i, 1);
  for (const n of names) fundedKeys.delete(n);
  keysByIp.set(ip, (keysByIp.get(ip) ?? []).slice(0, -keys.length));
  if (purpose === 'bots') botsByHunt.set(hunt58, Math.max(0, (botsByHunt.get(hunt58) ?? 0) - keys.length));
}
