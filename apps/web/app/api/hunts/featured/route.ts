import { isJoinable, listHunts } from '@terra-incognita/sdk';
import { NextResponse } from 'next/server';

import { summarize } from '@/lib/chain/summary';
import { serverClient, treasury } from '@/lib/chain/treasury.server';
import type { HuntSummary } from '@/lib/feed/types';

export const runtime = 'nodejs';
export const maxDuration = 30;

let cache: { at: number; hunt: HuntSummary | null } | null = null;
const FRESH_MS = 5_000;

/** The live demo hunt, read only: nothing is created here. */
export async function GET() {
  if (cache && Date.now() - cache.at < FRESH_MS) return NextResponse.json({ hunt: cache.hunt });
  const payer = treasury();
  if (!payer) return NextResponse.json({ hunt: null });
  try {
    const client = serverClient();
    const now = await client.now();
    const live = (await listHunts(client, { creator: payer.publicKey })).find((h) => isJoinable(h, now));
    let hunt: HuntSummary | null = null;
    if (live) {
      const vault = await client.fetchVault(live.address).catch(() => null);
      hunt = summarize(live, vault?.pot ?? null, now);
    }
    cache = { at: Date.now(), hunt };
    return NextResponse.json({ hunt });
  } catch (error) {
    return NextResponse.json({ hunt: null, error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}
