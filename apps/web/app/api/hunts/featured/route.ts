import { huntAddress, isJoinable, listHunts } from '@terra-incognita/sdk';
import { NextResponse } from 'next/server';

import { summarize } from '@/lib/chain/summary';
import { serverClient, treasury } from '@/lib/chain/treasury.server';
import type { HuntSummary } from '@/lib/feed/types';

export const runtime = 'nodejs';
export const maxDuration = 30;

const FRESH_MS = 5_000;
let cache: { at: number; hunt: HuntSummary | null } | null = null;
let inflight: Promise<HuntSummary | null> | null = null;

async function read(): Promise<HuntSummary | null> {
  const payer = treasury();
  if (!payer) return null;
  const client = serverClient();
  const now = await client.now();
  const live = (await listHunts(client, { creator: payer.publicKey })).find(
    (h) => huntAddress(payer.publicKey, h.id, client.programId).equals(h.address) && isJoinable(h, now),
  );
  if (!live) return null;
  const vault = await client.fetchVault(live.address).catch(() => null);
  return summarize(live, vault?.pot ?? null, now);
}

/** The live demo hunt, read only: this route never signs anything. Concurrent misses share one read. */
export async function GET() {
  if (cache && Date.now() - cache.at < FRESH_MS) return NextResponse.json({ hunt: cache.hunt });
  try {
    inflight ??= read().finally(() => {
      inflight = null;
    });
    const hunt = await inflight;
    cache = { at: Date.now(), hunt };
    return NextResponse.json({ hunt });
  } catch (error) {
    console.error('featured hunt read failed', error);
    return NextResponse.json({ hunt: null, error: 'The live hunt could not be read.' }, { status: 503 });
  }
}
