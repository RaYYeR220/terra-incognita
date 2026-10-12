// The ways a hunt can end without a winner, on devnet: a hunt cancelled before delegation, and a
// void hunt whose entrant takes the fee back. Skipped unless TERRA_DEVNET=1.
//
//   TERRA_DEVNET=1 TERRA_KEYS_DIR=/path/to/keys npx vitest run test/lifecycle.devnet.test.ts

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { HuntMode, HuntStatus, fromLatLon } from '@terra-incognita/core';
import { describe, expect, it } from 'vitest';

import {
  COMPUTE_UNITS,
  HuntInstructions,
  PlayerSession,
  TerraClient,
  TerraTxError,
  advanceHunt,
  buildProofReport,
  cancelHunt,
  cleanupHunt,
  createHunt,
  fundAccounts,
  sleep,
  sweepAccounts,
  waitFor,
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

describe.skipIf(!enabled)('hunts without a winner on devnet', () => {
  const client = new TerraClient();

  it('cancels a hunt that was never delegated and returns everything to the creator', async () => {
    const creator = keypair(process.env.TERRA_TREASURY ?? 'deployer');
    const id = BigInt(Date.now());
    const ix = HuntInstructions.forNew(creator.publicKey, id, client.config.validator);
    const now = await client.now();
    const before = await client.base.getBalance(creator.publicKey);
    const create = await client.send(
      'solana',
      [
        ix.createHunt(id, {
          mode: HuntMode.Vrf,
          validator: client.config.validator,
          entryFee: 0,
          prizeSeed: 0.01 * LAMPORTS_PER_SOL,
          creatorBps: 0,
          maxPlayers: 4,
          speedKms: 800,
          startsAt: now,
          deadline: now + 600,
          zoneIntervalSecs: 60,
          opsLamports: 20_000_000,
          title: 'Withdrawn',
          clue: '',
        }),
      ],
      creator,
      { computeUnits: COMPUTE_UNITS.createHunt },
    );
    await waitFor('the hunt on Solana', async () => (await client.residence(ix.hunt)) === 'solana');
    const { signature, recovered } = await cancelHunt(client, creator, ix.hunt);
    log(`create ${create}, cancel ${signature}: ${recovered} lamports back`);
    for (const address of [ix.hunt, ix.addresses.board, ix.addresses.treasure, ix.addresses.vault]) {
      expect(await client.residence(address)).toBe('missing');
    }
    expect((await client.base.getAccountInfo(ix.addresses.actionEscrow))?.lamports ?? 0).toBe(0);
    // Everything but the fees of the two transactions comes back.
    expect(before - (await client.base.getBalance(creator.publicKey))).toBeLessThan(50_000);
  });

  it(
    'ends void without soundings, pays back the prize seed and refunds the entry fee',
    async () => {
      const creator = keypair(process.env.TERRA_TREASURY ?? 'deployer');
      const player = keypair('e2e-void-player', true);
      await fundAccounts(client, creator, [player.publicKey], 0.03 * LAMPORTS_PER_SOL);
      const ENTRY = 0.002 * LAMPORTS_PER_SOL;
      const PRIZE = 0.005 * LAMPORTS_PER_SOL;

      const created = await createHunt(client, creator, {
        mode: 'vrf',
        title: 'Nobody came',
        entryFee: ENTRY,
        prizeSeed: PRIZE,
        durationSecs: 135,
        zoneIntervalSecs: 60,
      });
      const hunt = created.hunt;
      log(`hunt ${hunt.toBase58()}, crank ${created.crank}`);
      const { session } = await PlayerSession.join(client, player, hunt, { embarkAt: fromLatLon(0, 0) });

      // Nobody sounds; at the deadline the hunt ends void and goes back to Solana.
      await session.sleepUntil(created.account.deadline + 1);
      await waitFor(
        'the void hunt to be finalized',
        async () => {
          const result = await advanceHunt(client, hunt).catch((error) => {
            if (error instanceof TerraTxError) return null;
            throw error;
          });
          return result?.hunt?.finalized ? result.hunt : null;
        },
        120_000,
        2_000,
      );
      const { hunt: finished, settled } = await waitForSettlement(client, hunt);
      expect(finished.status).toBe(HuntStatus.Void);
      expect(settled).toBe(true);

      // Can the session key, which holds no SOL, sign the release in the rollup?
      const ix = session.ix;
      let releasedBy = 'operator';
      try {
        await client.send('rollup', [ix.releaseLogbook(session.operator.publicKey, player.publicKey)], session.operator, {
          computeUnits: COMPUTE_UNITS.release,
        });
      } catch (error) {
        releasedBy = `payer (operator refused: ${(error as Error).message.slice(0, 120)})`;
      }
      await sleep(500);
      const balance = await client.base.getBalance(player.publicKey);
      const refund = await session.claimRefund(player);
      const back = (await client.base.getBalance(player.publicKey)) - balance;
      log(`release by ${releasedBy}; refund ${refund.refund}: ${back} lamports back to the player`);
      expect(back).toBeGreaterThan(ENTRY);
      expect(await client.residence(session.logbookAddress)).toBe('missing');

      const report = await buildProofReport(client, hunt);
      log(`audit ${report.verdict}; settlement ${report.settlement?.signature} (${report.settlement?.prizeLamports} to the creator)`);
      expect(report.verdict).toBe('verified');
      expect(report.settlement?.prizeLamports).toBe(PRIZE);
      expect(report.settlement?.creatorLamports).toBe(0);

      const cleanup = await cleanupHunt(client, creator, hunt);
      log(`cleanup: ${cleanup.released.length} releases, ${cleanup.closed.join(', ')}`);
      expect(cleanup.closed.length).toBe(1);
      expect((await client.base.getAccountInfo(created.account.address))?.lamports).toBeGreaterThan(0);
      await sweepAccounts(client, [player], creator.publicKey);
    },
    10 * 60_000,
  );
});
