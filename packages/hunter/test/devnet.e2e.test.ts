// A real hunt on devnet: three bots play a VRF hunt to the end, the pot is paid on Solana and
// the audit of the finished hunt passes. Skipped unless TERRA_DEVNET=1.
//
//   TERRA_DEVNET=1 TERRA_KEYS_DIR=/path/to/keys npx vitest run test/devnet.e2e.test.ts
//
// TERRA_KEYS_DIR must hold a funded `deployer.json`; the bots' keys are written next to it so a
// crashed run can still be swept.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { HuntStatus } from '@terra-incognita/core';
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  TerraClient,
  buildProofReport,
  cleanupHunt,
  createHunt,
  fundAccounts,
  payoutSplit,
  sweepAccounts,
  waitForSettlement,
} from '@terra-incognita/sdk';
import { describe, expect, it } from 'vitest';

import { runChainBots } from '../src/index.js';
import type { BotOutcome, ChainBot, PersonalityName } from '../src/index.js';

const enabled = process.env.TERRA_DEVNET === '1';
const keysDir = process.env.TERRA_KEYS_DIR ?? join(homedir(), '.config/solana');

function keypair(name: string, create = false): Keypair {
  const file = join(keysDir, `${name}.json`);
  if (!existsSync(file)) {
    if (!create) throw new Error(`missing key ${file}`);
    mkdirSync(keysDir, { recursive: true });
    writeFileSync(file, JSON.stringify(Array.from(Keypair.generate().secretKey)), { mode: 0o600 });
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, 'utf8')) as number[]));
}

const log = (line: string) => console.log(`      ${line}`);

describe.skipIf(!enabled)('three bots on a devnet VRF hunt', () => {
  it(
    'plays to a single winner, pays out on Solana and passes the audit',
    async () => {
      const client = new TerraClient();
      const treasury = keypair(process.env.TERRA_TREASURY ?? 'deployer');
      const personalities: PersonalityName[] = ['surveyor', 'sprinter', 'shadow'];
      const bots: ChainBot[] = personalities.map((personality, i) => ({
        name: personality,
        personality,
        owner: keypair(`e2e-${personality}`, true),
        seed: Date.now() % 100_000 + i,
      }));
      const ENTRY_FEE = 0.002 * LAMPORTS_PER_SOL;
      const PRIZE = 0.01 * LAMPORTS_PER_SOL;
      await fundAccounts(client, treasury, bots.map((bot) => bot.owner.publicKey), 0.03 * LAMPORTS_PER_SOL);

      const started = Date.now();
      const created = await createHunt(client, treasury, {
        mode: 'vrf',
        title: 'Three bots',
        clue: 'Somewhere on Earth',
        entryFee: ENTRY_FEE,
        prizeSeed: PRIZE,
        creatorBps: 1_000,
        maxPlayers: 8,
        durationSecs: 600,
        zoneIntervalSecs: 60,
        onStep: (step, signature) => log(`${step}${signature ? ` ${signature}` : ''}`),
      });
      const hunt = created.hunt;
      log(`hunt ${hunt.toBase58()} live after ${((Date.now() - started) / 1000).toFixed(1)} s, crank: ${created.crank}`);
      expect(created.account.status).toBe(HuntStatus.Live);
      expect(created.account.commitment.some((byte) => byte !== 0)).toBe(true);

      const outcomes: BotOutcome[] = await runChainBots(client, hunt, bots, {
        onEvent: (event) => {
          if (event.kind === 'probe') log(`${event.bot} probe ${event.index + 1}: band ${event.entry.band}`);
          if (event.kind === 'done') log(`${event.bot}: ${event.result.outcome} after ${event.result.probes} probes`);
          if (event.kind === 'error') log(`${event.bot} failed: ${String(event.error)}`);
        },
      });
      expect(outcomes.every((outcome) => outcome.result !== null)).toBe(true);
      const winners = outcomes.filter((o) => o.result?.outcome === 'struck' || o.result?.outcome === 'closest');
      expect(winners).toHaveLength(1);
      const winner = winners[0] as BotOutcome;
      log(`winner ${winner.name} (${winner.owner}) after ${((Date.now() - started) / 1000).toFixed(1)} s`);

      const { hunt: finished, settled } = await waitForSettlement(client, hunt);
      expect(finished.finalized).toBe(true);
      expect(finished.winner?.toBase58()).toBe(winner.owner);
      expect(settled).toBe(true);

      const report = await buildProofReport(client, hunt);
      const probes = outcomes.reduce((sum, outcome) => sum + (outcome.result?.probes ?? 0), 0);
      log(`audit: ${report.verdict}, commitment ${report.commitmentOk ? 'ok' : 'MISMATCH'}, ${report.entriesChecked} entries, ${report.mismatches} mismatches`);
      log(`settlement ${report.settlement?.signature} (${report.settlement?.prizeLamports} to the winner, ${report.settlement?.creatorLamports} to the creator)`);
      log(`commitment anchored in ${report.anchorSignature}`);
      expect(report.verdict).toBe('verified');
      expect(report.commitmentOk).toBe(true);
      expect(report.logbooks).toHaveLength(3);
      expect(report.entriesChecked).toBe(probes);
      expect(report.mismatches).toBe(0);
      const vault = await client.fetchVault(hunt);
      const split = payoutSplit(finished, vault!);
      expect(report.settlement?.prizeLamports).toBe(split.prize);
      expect(report.settlement?.creatorLamports).toBe(split.creator);

      const tampered = await buildProofReport(client, hunt, { open: false, tamper: ([x, y, z]) => [y, z, x] });
      expect(tampered.verdict).toBe('mismatch');
      expect(tampered.commitmentOk).toBe(false);

      const cleanup = await cleanupHunt(client, treasury, hunt);
      log(`cleanup: ${cleanup.released.length} releases, ${cleanup.closed.length} closing transactions, ${cleanup.recovered} lamports back`);
      const swept = await sweepAccounts(client, bots.map((bot) => bot.owner), treasury.publicKey);
      log(`swept ${swept} lamports back to the treasury`);

      const after = await buildProofReport(client, hunt);
      expect(after.verdict).toBe('verified');
      expect(after.logbooks.every((logbook) => logbook.layer === 'solana')).toBe(true);
    },
    20 * 60_000,
  );
});
