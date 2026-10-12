// Audits a finished hunt from public data and exits non-zero if anything does not add up.
//
//   npx tsx scripts/verify-hunt.ts <hunt address> [--tamper] [--no-open] [--json]
//
// Exit codes: 0 verified, 1 mismatch, 2 incomplete or not finished, 3 error.

import { parseArgs } from 'node:util';

import { PublicKey } from '@solana/web3.js';
import { BAND_NAMES, EARTH_RADIUS_KM, canonical, render, toLatLon } from '@terra-incognita/core';
import type { Vec3 } from '@terra-incognita/core';
import { buildProofReport, explorerAddress, explorerTx } from '@terra-incognita/sdk';

import { clientFromEnv, fail, short, sol } from './common.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    tamper: { type: 'boolean', default: false },
    'no-open': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  },
});

const address = positionals[0];
if (!address) fail('usage: npx tsx scripts/verify-hunt.ts <hunt address> [--tamper] [--no-open] [--json]');
let hunt: PublicKey;
try {
  hunt = new PublicKey(address);
} catch {
  fail(`not an address: ${address}`);
}

/** Moves the revealed location 300 km to the north-east, as a forged reveal would. */
function tamper(location: Vec3): Vec3 {
  const moved = render.destination(render.toFloat(location), Math.PI / 4, 300 / EARTH_RADIUS_KM);
  return canonical(render.fromFloat(moved));
}

async function main(): Promise<void> {
  const client = clientFromEnv();
  const report = await buildProofReport(client, hunt, {
    open: !values['no-open'],
    ...(values.tamper ? { tamper } : {}),
  }).catch((error: unknown) => fail(`could not read the hunt: ${String(error)}`));

  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const cluster = client.config.cluster;
    const latLon = (v: Vec3) => {
      const { lat, lon } = toLatLon(v);
      return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    };
    const mark = (ok: boolean) => (ok ? 'ok' : 'MISMATCH');

    console.log(`Terra Incognita hunt ${report.hunt}`);
    console.log(`  "${report.title}", ${report.mode} mode, status ${report.status}${report.winner ? `, winner ${report.winner}` : ''}`);
    console.log(`  ${explorerAddress(report.hunt, cluster)}`);
    console.log();
    console.log(`Commitment  ${report.commitment}`);
    if (report.anchorSignature) console.log(`  anchored on Solana before play: ${explorerTx(report.anchorSignature, cluster)}`);
    if (!report.revealedLocation) {
      console.log('\nThe hunt has not revealed its location yet.');
    } else {
      console.log(`Revealed    ${latLon(report.revealedLocation)}${values.tamper ? '   (tampered: moved 300 km)' : ''}`);
      console.log(`Salt        ${report.revealedSalt}`);
      console.log(`  sha256("terra-incognita:v1" | hunt | location | salt) = commitment: ${mark(report.commitmentOk)}`);
      console.log();
      console.log(`Logbooks: ${report.logbooks.length} read, ${report.unreadable.length} still private`);
      for (const logbook of report.logbooks) {
        console.log(`  ${short(logbook.owner)}  ${logbook.entries.length} entries (read from ${logbook.layer})`);
        for (const entry of logbook.entries) {
          const band = `${entry.recordedBand} ${BAND_NAMES[entry.recordedBand]}`.padEnd(12);
          const expected = entry.ok ? '' : `, re-measured ${entry.expectedBand} ${BAND_NAMES[entry.expectedBand]}`;
          console.log(
            `    #${String(entry.index + 1).padStart(2)}  ${latLon(entry.pos).padEnd(22)} band ${band} ${entry.distanceKm.toFixed(0).padStart(6)} km  ${mark(entry.ok)}${expected}`,
          );
        }
      }
      for (const missing of report.unreadable) console.log(`  ${short(missing.owner)}  private, could not be checked`);
      console.log(`Entries: ${report.entriesChecked} re-measured, ${report.mismatches} mismatches`);
    }
    console.log();
    if (report.settlement) {
      console.log(`Payout on Solana: ${sol(report.settlement.prizeLamports)} to the winner, ${sol(report.settlement.creatorLamports)} to the creator`);
      console.log(`  ${report.settlement.explorer}`);
    } else if (report.vault) {
      console.log(`Payout: vault ${report.vault.settled ? 'settled, transaction not found in recent history' : 'not settled yet'} (pot ${sol(report.vault.pot)})`);
    }
    console.log();
    console.log(`Verdict: ${report.verdict.toUpperCase()}`);
  }

  process.exit(report.verdict === 'verified' ? 0 : report.verdict === 'mismatch' ? 1 : 2);
}

main().catch((error: unknown) => fail(String(error)));
