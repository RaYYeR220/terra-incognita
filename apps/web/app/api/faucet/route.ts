import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { fundAccounts } from '@terra-incognita/sdk';
import { NextResponse } from 'next/server';

import { JOIN_FUNDING } from '@/lib/chain/client';
import { serverClient, treasury } from '@/lib/chain/treasury.server';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** The faucet never covers more than this of a hunt's entry fee. */
const MAX_FAUCET_ENTRY_FEE = 0.02 * LAMPORTS_PER_SOL;
/** The treasury is never drawn below this. */
const TREASURY_FLOOR = 1 * LAMPORTS_PER_SOL;
/** Lamports this instance may hand out per rolling hour, whatever the headers say. */
const HOURLY_BUDGET = 0.6 * LAMPORTS_PER_SOL;
const HOUR_MS = 60 * 60_000;
const WINDOW_MS = 10 * 60_000;
const KEYS_PER_IP = 6;
const BOTS_PER_REQUEST = 3;
const BOTS_PER_HUNT = 6;

// All of this is per instance. The hourly budget and the treasury floor are the hard limits.
const byIp = new Map<string, number[]>();
const seenKeys = new Set<string>();
const botsByHunt = new Map<string, number>();
let spent: { at: number; lamports: number }[] = [];

function clientAddress(req: Request): string {
  const vercel = req.headers.get('x-vercel-forwarded-for');
  if (vercel) return vercel.split(',')[0]!.trim();
  if (process.env.VERCEL) return 'unknown';
  const hops = req.headers.get('x-forwarded-for')?.split(',').map((h) => h.trim()).filter(Boolean) ?? [];
  return hops.at(-1) ?? req.headers.get('x-real-ip') ?? 'local';
}

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

/**
 * Funds throwaway keys with just enough to join one demo hunt: one key for a guest, or up to
 * three rival bots. Only hunts created by the treasury itself are funded.
 */
export async function POST(req: Request) {
  const payer = treasury();
  if (!payer) return fail(503, 'The faucet is not configured.');

  let body: { keys?: unknown; hunt?: unknown; purpose?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail(400, 'Send JSON: { "keys": [base58], "hunt": base58, "purpose": "guest" | "bots" }.');
  }
  const purpose = body.purpose === 'bots' ? 'bots' : 'guest';
  const raw = Array.isArray(body.keys) ? body.keys : [];
  const maxKeys = purpose === 'bots' ? BOTS_PER_REQUEST : 1;
  if (raw.length < 1 || raw.length > maxKeys) return fail(400, purpose === 'bots' ? `Ask for 1 to ${maxKeys} bot keys.` : 'A guest is funded one key at a time.');
  if (typeof body.hunt !== 'string') return fail(400, 'Say which hunt the keys are for.');

  let keys: PublicKey[];
  let huntKey: PublicKey;
  try {
    keys = raw.map((k) => new PublicKey(String(k)));
    huntKey = new PublicKey(body.hunt);
  } catch {
    return fail(400, 'A key or the hunt is not a Solana address.');
  }

  const ip = clientAddress(req);
  const now = Date.now();
  const recent = (byIp.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length + keys.length > KEYS_PER_IP) return fail(429, 'Too many keys funded from here. Try again in a few minutes.');
  if (keys.some((k) => seenKeys.has(k.toBase58()))) return fail(409, 'That key has been funded already.');

  const client = serverClient();
  const hunt = await client.fetchHunt(huntKey).catch(() => null);
  if (!hunt) return fail(400, 'There is no hunt at that address.');
  if (!hunt.creator.equals(payer.publicKey)) return fail(400, 'The faucet only funds the demo hunts it runs.');
  const hunt58 = huntKey.toBase58();
  if (purpose === 'bots' && (botsByHunt.get(hunt58) ?? 0) + keys.length > BOTS_PER_HUNT) {
    return fail(429, 'This hunt already has its share of rival bots.');
  }

  const target = JOIN_FUNDING + Math.min(hunt.entryFee, MAX_FAUCET_ENTRY_FEE);
  const balances = await Promise.all(keys.map((k) => client.base.getBalance(k)));
  if (balances.some((b) => b >= target / 2)) return fail(409, 'That key already holds enough to play.');
  const needed = balances.reduce((sum, b) => sum + Math.max(0, target - b), 0);

  spent = spent.filter((s) => now - s.at < HOUR_MS);
  const hourly = spent.reduce((sum, s) => sum + s.lamports, 0);
  if (hourly + needed > HOURLY_BUDGET) return fail(429, 'The faucet has given out its hourly share. Try again later, or play a practice hunt.');
  const reserve = await client.base.getBalance(payer.publicKey);
  if (reserve - needed < TREASURY_FLOOR) return fail(503, 'The faucet is running low. Play a practice hunt for now.');

  try {
    // Recorded before sending so concurrent requests cannot both pass the checks above.
    spent.push({ at: now, lamports: needed });
    for (const k of keys) seenKeys.add(k.toBase58());
    byIp.set(ip, [...recent, ...keys.map(() => now)]);
    if (purpose === 'bots') botsByHunt.set(hunt58, (botsByHunt.get(hunt58) ?? 0) + keys.length);
    const signatures = await fundAccounts(client, payer, keys, target);
    return NextResponse.json({ funded: keys.map((k) => k.toBase58()), lamports: target, signatures, treasury: payer.publicKey.toBase58() });
  } catch (error) {
    return fail(502, `Funding failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
