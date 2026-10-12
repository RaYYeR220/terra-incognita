// An author hunt on devnet whose location travels encrypted inside the delegation, played to a
// strike and a payout, then audited. Skipped unless TERRA_DEVNET=1.
//
//   TERRA_DEVNET=1 TERRA_KEYS_DIR=/path/to/keys npx vitest run test/author.devnet.test.ts
//
// TERRA_KEYS_DIR must hold a funded `deployer.json`; the player's key is written next to it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { EARTH_RADIUS_KM, HuntStatus, canonical, fromLatLon, render } from '@terra-incognita/core';
import type { Vec3 } from '@terra-incognita/core';
import { describe, expect, it } from 'vitest';

import {
  PlayerSession,
  TerraClient,
  buildProofReport,
  cleanupHunt,
  createHunt,
  delegationRecordAddress,
  fundAccounts,
  sweepAccounts,
  waitForSettlement,
} from '../src/index.js';

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
const le = (v: Vec3) => Buffer.concat(v.map((c) => Buffer.from(new Int32Array([c]).buffer)));

describe.skipIf(!enabled)('an encrypted author hunt on devnet', () => {
  it(
    'keeps the location out of Solana, strikes, pays out and passes the audit',
    async () => {
      const client = new TerraClient();
      const creator = keypair(process.env.TERRA_TREASURY ?? 'deployer');
      const player = keypair('e2e-author-player', true);
      await fundAccounts(client, creator, [player.publicKey], 0.03 * LAMPORTS_PER_SOL);

      const treasure = fromLatLon(-22.9519, -43.2105);
      const salt = crypto.getRandomValues(new Uint8Array(32));
      const created = await createHunt(client, creator, {
        mode: 'author',
        location: treasure,
        salt,
        title: 'Redeemer',
        riddle: 'Arms open over the bay',
        entryFee: 0.002 * LAMPORTS_PER_SOL,
        prizeSeed: 0.01 * LAMPORTS_PER_SOL,
        creatorBps: 1_000,
        durationSecs: 600,
        onStep: (step, signature) => log(`${step}${signature ? ` ${signature}` : ''}`),
      });
      const hunt = created.hunt;
      log(`hunt ${hunt.toBase58()}: ${created.sealing}, crank ${created.crank}`);
      expect(created.sealing).toBe('encrypted');
      expect(created.account.status).toBe(HuntStatus.Live);
      expect(created.account.clue).toBe('Arms open over the bay');
      expect(created.signatures.open).toBeUndefined();

      // Neither the delegation transaction nor the delegation record holds the location or salt.
      const delegation = await client.base.getTransaction(created.signatures.delegate as string, { maxSupportedTransactionVersion: 0 });
      const record = await client.base.getAccountInfo(delegationRecordAddress(created.account.address));
      const haystacks = [
        ...(delegation?.transaction.message.compiledInstructions.map((i) => Buffer.from(i.data)) ?? []),
        ...(record ? [record.data] : []),
      ];
      expect(haystacks.length).toBeGreaterThan(0);
      for (const needle of [le(treasure), le(canonical(treasure)), Buffer.from(salt)]) {
        expect(haystacks.some((data) => data.indexOf(needle) >= 0)).toBe(false);
      }

      // Embark 20 km from the treasure; the first sounding is a strike.
      const start = canonical(render.fromFloat(render.destination(render.toFloat(treasure), 1, 20 / EARTH_RADIUS_KM)));
      const { session, signature } = await PlayerSession.join(client, player, hunt, { embarkAt: start });
      log(`join ${signature}`);
      const probe = await session.probe();
      log(`probe ${probe.signature}: band ${probe.entry.band}, tick ${probe.conclusion?.tick}, finalize ${probe.conclusion?.finalize}`);
      expect(probe.strike).toBe(true);

      const { hunt: finished, settled } = await waitForSettlement(client, hunt);
      expect(finished.status).toBe(HuntStatus.Struck);
      expect(finished.winner?.equals(player.publicKey)).toBe(true);
      expect(finished.revealedLocation).toEqual(canonical(treasure));
      expect(settled).toBe(true);

      const report = await buildProofReport(client, hunt);
      log(`audit ${report.verdict}; settlement ${report.settlement?.signature}; anchored in ${report.anchorSignature}`);
      expect(report.verdict).toBe('verified');
      expect(report.entriesChecked).toBe(1);
      expect(report.settlement?.prizeLamports).toBe(0.01 * LAMPORTS_PER_SOL + 0.002 * LAMPORTS_PER_SOL - 0.0002 * LAMPORTS_PER_SOL);

      const cleanup = await cleanupHunt(client, creator, hunt);
      log(`cleanup: ${cleanup.released.length} releases, ${cleanup.closed.length} closing transactions`);
      await sweepAccounts(client, [player], creator.publicKey);
    },
    10 * 60_000,
  );
});
