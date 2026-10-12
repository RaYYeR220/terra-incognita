import { ensureDemoHunt } from '@terra-incognita/sdk';
import { NextResponse } from 'next/server';

import { summarize } from '@/lib/chain/summary';
import { serverClient, treasury } from '@/lib/chain/treasury.server';
import type { HuntSummary } from '@/lib/feed/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

let inflight: Promise<HuntSummary> | null = null;
let last: { at: number; hunt: HuntSummary } | null = null;
const FRESH_MS = 15_000;

async function ensure(): Promise<HuntSummary> {
  const payer = treasury();
  if (!payer) throw new Error('The treasury is not configured.');
  const client = serverClient();
  const { hunt } = await ensureDemoHunt(client, payer, { minRemainingSecs: 240 });
  const vault = await client.fetchVault(hunt.address).catch(() => null);
  return summarize(hunt, vault?.pot ?? null, await client.now());
}

/** Returns a live demo hunt, creating one when none has time left. Safe to call repeatedly. */
export async function POST() {
  if (last && Date.now() - last.at < FRESH_MS && last.hunt.deadline * 1000 - Date.now() > 240_000) {
    return NextResponse.json({ hunt: last.hunt });
  }
  try {
    inflight ??= ensure().finally(() => {
      inflight = null;
    });
    const hunt = await inflight;
    last = { at: Date.now(), hunt };
    return NextResponse.json({ hunt });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}
