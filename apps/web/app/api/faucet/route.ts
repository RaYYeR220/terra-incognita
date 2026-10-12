import { PublicKey } from '@solana/web3.js';
import { NextResponse } from 'next/server';

import { fundKeys } from '@/lib/chain/spend.server';
import { serverClient, treasury } from '@/lib/chain/treasury.server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BOTS_PER_REQUEST = 3;

function clientAddress(req: Request): string {
  const vercel = req.headers.get('x-vercel-forwarded-for');
  if (vercel) return vercel.split(',')[0]!.trim();
  if (process.env.VERCEL) return 'unknown';
  const hops = req.headers.get('x-forwarded-for')?.split(',').map((h) => h.trim()).filter(Boolean) ?? [];
  return hops.at(-1) ?? req.headers.get('x-real-ip') ?? 'local';
}

const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

/**
 * Funds throwaway keys with just enough to join one live demo hunt: one key for a guest, or up
 * to three rival bots. This route only reads the request; every limit is enforced in `fundKeys`.
 */
export async function POST(req: Request) {
  try {
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
    if (raw.length < 1 || raw.length > maxKeys) {
      return fail(400, purpose === 'bots' ? `Ask for 1 to ${maxKeys} bot keys.` : 'A guest is funded one key at a time.');
    }
    if (typeof body.hunt !== 'string') return fail(400, 'Say which hunt the keys are for.');

    let keys: PublicKey[];
    let hunt: PublicKey;
    try {
      keys = raw.map((k) => new PublicKey(String(k)));
      hunt = new PublicKey(body.hunt);
    } catch {
      return fail(400, 'A key or the hunt is not a Solana address.');
    }
    if (new Set(keys.map((k) => k.toBase58())).size !== keys.length) return fail(400, 'Each key may appear once.');
    if (keys.some((k) => k.equals(payer.publicKey) || !PublicKey.isOnCurve(k.toBytes()))) {
      return fail(400, 'Only fresh wallet keys can be funded.');
    }

    const result = await fundKeys({ client: serverClient(), payer, hunt, keys, ip: clientAddress(req), purpose });
    if (!result.ok) return fail(result.status, result.error);
    return NextResponse.json({ funded: result.funded, lamports: result.lamports, signatures: result.signatures, treasury: payer.publicKey.toBase58() });
  } catch (error) {
    console.error('faucet request failed', error);
    return fail(503, 'The faucet could not fund that right now.');
  }
}
