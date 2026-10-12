import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { DEMO_CLUE, ensureDemoHunt, huntAddress, isJoinable, listHunts } from '@terra-incognita/sdk';
import type { HuntAccount } from '@terra-incognita/sdk';
import { NextResponse } from 'next/server';

import { TREASURY_FLOOR, withTreasury } from '@/lib/chain/spend.server';
import { summarize } from '@/lib/chain/summary';
import { serverClient, treasury } from '@/lib/chain/treasury.server';
import type { HuntSummary } from '@/lib/feed/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MIN_REMAINING_SECS = 240;
/** At most one new hunt per this long, per instance, however often the endpoint is called. */
const CREATE_EVERY_MS = 3 * 60_000;
/** What a demo hunt costs the treasury: the prize plus rent for its accounts, rounded up. */
const CREATE_COST = 0.1 * LAMPORTS_PER_SOL;
const FRESH_MS = 15_000;

let last: { at: number; hunt: HuntSummary } | null = null;
let lastCreatedAt = 0;

type Answer = { hunt: HuntSummary | null; joinable: boolean; created?: boolean; error?: string };

async function summary(hunt: HuntAccount, now: number): Promise<HuntSummary> {
  const vault = await serverClient().fetchVault(hunt.address).catch(() => null);
  return summarize(hunt, vault?.pot ?? null, now);
}

/**
 * Returns a live demo hunt. Reuses any joinable hunt the treasury created; creates one only when
 * none is left, at most once every three minutes, and never below the treasury floor.
 */
export async function POST() {
  const payer = treasury();
  if (!payer) return NextResponse.json({ hunt: null, joinable: false, error: 'The treasury is not configured.' } satisfies Answer, { status: 503 });

  try {
    const answer = await withTreasury(async (): Promise<Answer> => {
      if (last && Date.now() - last.at < FRESH_MS && last.hunt.deadline * 1000 - Date.now() > MIN_REMAINING_SECS * 1000) {
        return { hunt: last.hunt, joinable: true };
      }
      const client = serverClient();
      const now = await client.now();
      const own = (await listHunts(client, { creator: payer.publicKey })).filter((h) =>
        huntAddress(payer.publicKey, h.id, client.programId).equals(h.address),
      );
      for (const h of own) {
        if (h.clue !== DEMO_CLUE || !isJoinable(h, now, MIN_REMAINING_SECS)) continue;
        const vault = await client.fetchVault(h.address).catch(() => null);
        if (vault && vault.entrants >= h.maxPlayers) continue;
        const hunt = await summary(h, now);
        last = { at: Date.now(), hunt };
        return { hunt, joinable: true };
      }

      const fallback = own.find((h) => isJoinable(h, now)) ?? own[0] ?? null;
      const refuse = async (error: string): Promise<Answer> => ({
        hunt: fallback ? await summary(fallback, now) : null,
        joinable: !!fallback && isJoinable(fallback, now),
        error,
      });
      if (Date.now() - lastCreatedAt < CREATE_EVERY_MS) return refuse('A new hunt was started moments ago. Try again in a minute.');
      const balance = await client.base.getBalance(payer.publicKey);
      if (balance - CREATE_COST < TREASURY_FLOOR) return refuse('The treasury is too low to start a new hunt.');

      lastCreatedAt = Date.now();
      const { hunt: created } = await ensureDemoHunt(client, payer, { fresh: true, minRemainingSecs: MIN_REMAINING_SECS });
      const hunt = await summary(created, await client.now());
      last = { at: Date.now(), hunt };
      return { hunt, joinable: true, created: true };
    });
    return NextResponse.json(answer, { status: answer.hunt || !answer.error ? 200 : 503 });
  } catch (error) {
    console.error('ensure demo hunt failed', error);
    return NextResponse.json({ hunt: null, joinable: false, error: 'The live hunt could not be found or started.' } satisfies Answer, { status: 503 });
  }
}
