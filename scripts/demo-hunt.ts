// Makes sure a live demo hunt exists and, optionally, lets bots play it to the end.
//
//   npx tsx scripts/demo-hunt.ts [--treasury <keyfile>] [--fresh]
//                                [--bots surveyor,sprinter,shadow] [--keep-rent] [--close-logbooks]
//                                [--prize <SOL>] [--entry <SOL>] [--duration <s>] [--zone <s>] [--keys-dir <dir>]

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { BAND_NAMES } from '@terra-incognita/core';
import { PERSONALITIES, runChainBots } from '@terra-incognita/hunter';
import type { ChainBot, PersonalityName } from '@terra-incognita/hunter';
import {
  HUNT_STATUS_NAMES,
  buildProofReport,
  cleanupHunt,
  ensureDemoHunt,
  explorerAddress,
  fundAccounts,
  sweepAccounts,
  waitForSettlement,
} from '@terra-incognita/sdk';

import { clientFromEnv, fail, readKeypair, short, sol } from './common.js';

const { values } = parseArgs({
  options: {
    treasury: { type: 'string' },
    fresh: { type: 'boolean', default: false },
    bots: { type: 'string' },
    'keep-rent': { type: 'boolean', default: false },
    'close-logbooks': { type: 'boolean', default: false },
    prize: { type: 'string', default: '0.02' },
    entry: { type: 'string', default: '0' },
    duration: { type: 'string', default: '900' },
    zone: { type: 'string', default: '90' },
    'keys-dir': { type: 'string' },
  },
});

const lamports = (text: string) => Math.round(Number(text) * LAMPORTS_PER_SOL);
const BOT_FUNDING = 0.03 * LAMPORTS_PER_SOL;

function botKey(name: string): Keypair {
  const keypair = Keypair.generate();
  const dir = values['keys-dir'];
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `bot-${name}-${keypair.publicKey.toBase58().slice(0, 6)}.json`), JSON.stringify(Array.from(keypair.secretKey)), {
      mode: 0o600,
    });
  }
  return keypair;
}

async function main(): Promise<void> {
  const treasuryFile = values.treasury ?? process.env.TERRA_TREASURY_KEY ?? join(homedir(), '.config/solana/id.json');
  if (!existsSync(treasuryFile)) fail(`no treasury key at ${treasuryFile}; pass --treasury or set TERRA_TREASURY_KEY`);
  const treasury = readKeypair(treasuryFile);
  const client = clientFromEnv();
  const cluster = client.config.cluster;
  console.log(`treasury ${treasury.publicKey.toBase58()}: ${sol(await client.base.getBalance(treasury.publicKey))}`);

  const started = Date.now();
  const { hunt, created } = await ensureDemoHunt(client, treasury, {
    fresh: values.fresh,
    prizeSeed: lamports(values.prize),
    entryFee: lamports(values.entry),
    durationSecs: Number(values.duration),
    zoneIntervalSecs: Number(values.zone),
    onStep: (step, signature) => console.log(`  ${step}${signature ? `  ${signature}` : ''}`),
  });
  const remaining = hunt.deadline - (await client.now());
  console.log(
    `${created ? 'created' : 'reusing'} hunt ${hunt.address.toBase58()} "${hunt.title}": ${HUNT_STATUS_NAMES[hunt.status]}, ` +
      `${Math.max(0, remaining)} s left, prize ${sol(hunt.prizeSeed)}${created ? `, crank: ${created.crank ?? 'none'}` : ''}`,
  );
  console.log(`  ${explorerAddress(hunt.address, cluster)}`);
  if (created) console.log(`  live after ${((Date.now() - started) / 1000).toFixed(1)} s`);

  if (!values.bots) return;
  const names = values.bots.split(',').map((name) => name.trim()) as PersonalityName[];
  for (const name of names) if (!(name in PERSONALITIES)) fail(`unknown personality ${name}; one of ${Object.keys(PERSONALITIES).join(', ')}`);

  const bots: ChainBot[] = names.map((personality, i) => ({
    name: names.length > new Set(names).size ? `${personality}-${i + 1}` : personality,
    personality,
    owner: botKey(personality),
    seed: Date.now() % 1_000_000 + i,
  }));
  const owners = bots.map((bot) => bot.owner);
  await fundAccounts(client, treasury, owners.map((key) => key.publicKey), BOT_FUNDING + hunt.entryFee);
  console.log(`funded ${bots.length} bots with ${sol(BOT_FUNDING + hunt.entryFee)} each`);

  const playStarted = Date.now();
  const outcomes = await runChainBots(client, hunt.address, bots, {
    onEvent: (event) => {
      const at = `${((Date.now() - playStarted) / 1000).toFixed(1).padStart(6)} s`;
      if (event.kind === 'joined') console.log(`${at}  ${event.bot} joined`);
      if (event.kind === 'probe') console.log(`${at}  ${event.bot} sounding ${event.index + 1}: ${BAND_NAMES[event.entry.band]}`);
      if (event.kind === 'done') console.log(`${at}  ${event.bot}: ${event.result.outcome} after ${event.result.probes} soundings`);
      if (event.kind === 'error') console.log(`${at}  ${event.bot} failed: ${String(event.error)}`);
    },
  });

  const { hunt: finished, settled } = await waitForSettlement(client, hunt.address);
  const winner = outcomes.find((outcome) => outcome.owner === finished.winner?.toBase58());
  console.log(
    `hunt ${HUNT_STATUS_NAMES[finished.status]}${winner ? `, won by ${winner.name}` : finished.winner ? `, won by ${short(finished.winner)}` : ''}; ` +
      `payout ${settled ? 'settled' : 'not settled yet'}`,
  );

  const report = await buildProofReport(client, hunt.address);
  console.log(
    `audit: ${report.verdict}, commitment ${report.commitmentOk ? 'ok' : 'MISMATCH'}, ` +
      `${report.entriesChecked} soundings re-measured, ${report.mismatches} mismatches`,
  );
  if (report.settlement) console.log(`payout transaction ${report.settlement.explorer}`);

  if (!values['keep-rent'] && settled) {
    const cleanup = await cleanupHunt(client, treasury, hunt.address, { closeLogbooks: values['close-logbooks'] });
    console.log(`rent: ${cleanup.released.length} accounts released, ${cleanup.closed.length} closing transactions`);
  }
  const swept = await sweepAccounts(client, owners, treasury.publicKey);
  console.log(`swept ${sol(swept)} from the bots back to the treasury`);
  console.log(`\nverify: npx tsx scripts/verify-hunt.ts ${hunt.address.toBase58()}`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => fail(error instanceof Error ? (error.stack ?? error.message) : String(error)));

