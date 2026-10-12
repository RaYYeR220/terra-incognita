import { PublicKey } from '@solana/web3.js';
import { HuntMode, HuntStatus, auditHunt, bytesToHex, render, toLatLon } from '@terra-incognita/core';
import type { Band, LogEntry, Vec3 } from '@terra-incognita/core';

import { accountDiscriminator, decodeLogbook } from './accounts.js';
import type { HuntAccount, LogbookAccount, VaultAccount } from './accounts.js';
import { base58 } from './codec.js';
import type { TerraClient } from './client.js';
import { DELEGATION_PROGRAM_ID } from './constants.js';
import { TerraTxError } from './errors.js';
import { HuntInstructions } from './instructions.js';
import { logbookAddress, vaultAddress } from './pda.js';
import type { TerraSigner } from './signer.js';

export const HUNT_STATUS_NAMES: Record<HuntStatus, string> = {
  [HuntStatus.Created]: 'created',
  [HuntStatus.Sealing]: 'sealing',
  [HuntStatus.Live]: 'live',
  [HuntStatus.Struck]: 'struck',
  [HuntStatus.Closest]: 'closest',
  [HuntStatus.Void]: 'void',
};

export interface AuditedEntry {
  index: number;
  pos: Vec3;
  ts: number;
  recordedBand: Band;
  expectedBand: Band;
  ok: boolean;
  /** Great-circle distance to the revealed location, for display. */
  distanceKm: number;
}

export interface LogbookProof {
  owner: string;
  address: string;
  /** Where the opened logbook was read. */
  layer: 'rollup' | 'solana';
  entries: AuditedEntry[];
}

export interface SettlementProof {
  signature: string;
  slot: number;
  blockTime: number | null;
  prizeLamports: number;
  creatorLamports: number;
  explorer: string;
}

export interface ProofReport {
  hunt: string;
  title: string;
  mode: 'vrf' | 'author';
  status: string;
  finalized: boolean;
  winner: string | null;
  endedAt: number;
  commitment: string;
  revealedLocation: Vec3 | null;
  revealedLatLon: { lat: number; lon: number } | null;
  revealedSalt: string;
  /** The revealed location and salt hash to the commitment anchored before play. */
  commitmentOk: boolean;
  logbooks: LogbookProof[];
  /** Logbooks of players that are still private, so their entries could not be checked. */
  unreadable: { owner: string; address: string }[];
  entriesChecked: number;
  mismatches: number;
  vault: { settled: boolean; pot: number; entrants: number } | null;
  settlement: SettlementProof | null;
  /** The first Solana transaction the rollup validator sent for this hunt: the commit of the armed hunt. */
  anchorSignature: string | null;
  /**
   * `verified`: commitment and every entry check out and every logbook was read.
   * `mismatch`: the commitment or at least one entry does not match.
   * `incomplete`: everything read matches, but some logbooks could not be read.
   * `unfinished`: the hunt has not revealed its location yet.
   */
  verdict: 'verified' | 'mismatch' | 'incomplete' | 'unfinished';
}

export interface ProofOptions {
  /** Open still-private logbooks (permissionless once the hunt is revealed). Default true. */
  open?: boolean;
  /** Signs the open transactions. Defaults to the client's relay key. */
  signer?: TerraSigner;
  /** Replaces the revealed location before checking, to see the audit fail. */
  tamper?: (location: Vec3) => Vec3;
}

/** Owners of every logbook the hunt has, from the board and from the program's accounts. */
export async function logbookOwners(client: TerraClient, hunt: PublicKey): Promise<PublicKey[]> {
  const owners = new Map<string, PublicKey>();
  const board = await client.fetchBoard(hunt).catch(() => null);
  for (const ship of board?.ships ?? []) owners.set(ship.owner, new PublicKey(ship.owner));

  const filters = [
    { memcmp: { offset: 0, bytes: base58(accountDiscriminator('Logbook')) } },
    { memcmp: { offset: 8, bytes: hunt.toBase58() } },
  ];
  const lists = await Promise.all([
    client.rollup.getProgramAccounts(client.programId, { filters }).catch(() => []),
    client.base.getProgramAccounts(client.programId, { filters }).catch(() => []),
  ]);
  for (const list of lists) {
    for (const { pubkey, account } of list) {
      try {
        const owner = decodeLogbook(pubkey, account.data).owner;
        owners.set(owner.toBase58(), owner);
      } catch {
        // Not a logbook of this layout.
      }
    }
  }
  return [...owners.values()];
}

/** A logbook anyone can read: opened in the rollup, or back on Solana. */
async function publicLogbook(client: TerraClient, hunt: PublicKey, owner: PublicKey) {
  const address = logbookAddress(hunt, owner, client.programId);
  const found = await client.fetchLatest(address);
  if (!found || found.info.owner.equals(DELEGATION_PROGRAM_ID)) return null;
  return { logbook: decodeLogbook(address, found.info.data), layer: found.layer };
}

/**
 * Makes a finished hunt fully auditable: opens every logbook that is still private and the
 * treasure. Permissionless once the location has been revealed. Returns the signatures sent.
 */
export async function openForAudit(
  client: TerraClient,
  huntAccount: HuntAccount,
  signer: TerraSigner = client.relay,
): Promise<string[]> {
  if (!huntAccount.finalized) return [];
  const ix = HuntInstructions.of(huntAccount, client.programId);
  const signatures: string[] = [];
  for (const owner of await logbookOwners(client, huntAccount.address)) {
    if (await publicLogbook(client, huntAccount.address, owner)) continue;
    if ((await client.residence(ix.logbook(owner))) !== 'rollup') continue;
    try {
      signatures.push(await client.send('rollup', [ix.openLogbook(owner)], signer));
    } catch (error) {
      if (!(error instanceof TerraTxError)) throw error;
    }
  }
  if ((await client.fetchTreasure(huntAccount.address)) === null && (await client.residence(ix.addresses.treasure)) === 'rollup') {
    try {
      signatures.push(await client.send('rollup', [ix.openTreasure()], signer));
    } catch (error) {
      if (!(error instanceof TerraTxError)) throw error;
    }
  }
  return signatures;
}

const SETTLED_LOG = /settled: prize (\d+) creator (\d+)/;

/** The Solana transaction in which the vault paid out, found through the vault's history. */
export async function findSettlement(client: TerraClient, hunt: PublicKey, vault?: PublicKey): Promise<SettlementProof | null> {
  const address = vault ?? vaultAddress(hunt, client.programId);
  const signatures = await client.base.getSignaturesForAddress(address, { limit: 25 });
  for (const entry of signatures) {
    if (entry.err) continue;
    const tx = await client.base.getTransaction(entry.signature, { maxSupportedTransactionVersion: 0 });
    const line = tx?.meta?.logMessages?.find((message) => SETTLED_LOG.test(message));
    if (!tx || !line) continue;
    const [, prize, creator] = SETTLED_LOG.exec(line) as RegExpExecArray;
    return {
      signature: entry.signature,
      slot: tx.slot,
      blockTime: tx.blockTime ?? null,
      prizeLamports: Number(prize),
      creatorLamports: Number(creator),
      explorer: client.explorerTx(entry.signature),
    };
  }
  return null;
}

/** The earliest Solana transaction paid by the rollup validator that touches the hunt. */
export async function findAnchor(client: TerraClient, hunt: PublicKey): Promise<string | null> {
  const signatures = await client.base.getSignaturesForAddress(hunt, { limit: 50 });
  const oldestFirst = signatures.filter((entry) => !entry.err).reverse();
  for (const entry of oldestFirst.slice(0, 12)) {
    const tx = await client.base.getTransaction(entry.signature, { maxSupportedTransactionVersion: 0 });
    const payer = tx?.transaction.message.staticAccountKeys[0];
    if (payer?.equals(client.config.validator)) return entry.signature;
  }
  return null;
}

/**
 * Everything needed to check a finished hunt from public data: the reveal against the
 * commitment, every logbook entry re-measured from the revealed location, and the payout
 * transaction on Solana.
 */
export async function buildProofReport(
  client: TerraClient,
  huntAddress: PublicKey,
  options: ProofOptions = {},
): Promise<ProofReport> {
  let hunt = await client.fetchHunt(huntAddress);
  if (!hunt) throw new Error(`no hunt at ${huntAddress.toBase58()}`);
  if (hunt.finalized && options.open !== false) {
    await openForAudit(client, hunt, options.signer);
    hunt = (await client.fetchHunt(huntAddress)) ?? hunt;
  }

  const revealed = hunt.revealedLocation ? (options.tamper ? options.tamper(hunt.revealedLocation) : hunt.revealedLocation) : null;
  const logbooks: LogbookProof[] = [];
  const unreadable: ProofReport['unreadable'] = [];
  const read: { owner: string; logbook: LogbookAccount; layer: 'rollup' | 'solana' }[] = [];
  for (const owner of await logbookOwners(client, huntAddress)) {
    const found = await publicLogbook(client, huntAddress, owner);
    if (found) read.push({ owner: owner.toBase58(), ...found });
    else unreadable.push({ owner: owner.toBase58(), address: logbookAddress(huntAddress, owner, client.programId).toBase58() });
  }

  let commitmentOk = false;
  let mismatches = 0;
  let entriesChecked = 0;
  if (revealed) {
    const audit = auditHunt({
      hunt: huntAddress.toBytes(),
      revealedLocation: revealed,
      revealedSalt: hunt.revealedSalt,
      commitment: hunt.commitment,
      logbooks: read.map(({ owner, logbook }) => ({ player: owner, entries: logbook.entries })),
    });
    commitmentOk = audit.commitmentOk;
    for (const { owner, logbook, layer } of read) {
      const entries = audit.entries
        .filter((entry) => entry.player === owner)
        .map((entry): AuditedEntry => {
          const logged = logbook.entries[entry.index] as LogEntry;
          return {
            index: entry.index,
            pos: logged.pos,
            ts: logged.ts,
            recordedBand: entry.recordedBand,
            expectedBand: entry.expectedBand,
            ok: entry.ok,
            distanceKm: render.distanceKm(logged.pos, revealed),
          };
        });
      logbooks.push({ owner, address: logbook.address.toBase58(), layer, entries });
    }
    entriesChecked = audit.entries.length;
    mismatches = audit.entries.filter((entry) => !entry.ok).length;
  }

  const vault: VaultAccount | null = await client.fetchVault(huntAddress);
  const settlement = vault?.settled ? await findSettlement(client, huntAddress, vault.address).catch(() => null) : null;
  const anchorSignature = await findAnchor(client, huntAddress).catch(() => null);

  const verdict: ProofReport['verdict'] = !revealed
    ? 'unfinished'
    : !commitmentOk || mismatches > 0
      ? 'mismatch'
      : unreadable.length > 0
        ? 'incomplete'
        : 'verified';

  return {
    hunt: huntAddress.toBase58(),
    title: hunt.title,
    mode: hunt.mode === HuntMode.Author ? 'author' : 'vrf',
    status: HUNT_STATUS_NAMES[hunt.status],
    finalized: hunt.finalized,
    winner: hunt.winner?.toBase58() ?? null,
    endedAt: hunt.endedAt,
    commitment: bytesToHex(hunt.commitment),
    revealedLocation: revealed,
    revealedLatLon: revealed ? toLatLon(revealed) : null,
    revealedSalt: bytesToHex(hunt.revealedSalt),
    commitmentOk,
    logbooks,
    unreadable,
    entriesChecked,
    mismatches,
    vault: vault ? { settled: vault.settled, pot: vault.pot, entrants: vault.entrants } : null,
    settlement,
    anchorSignature,
    verdict,
  };
}
