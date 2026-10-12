import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import type { TransactionInstruction } from '@solana/web3.js';
import { HuntStatus } from '@terra-incognita/core';

import type { HuntAccount } from './accounts.js';
import { sleep } from './client.js';
import type { TerraClient } from './client.js';
import { COMPUTE_UNITS } from './constants.js';
import { TerraError, TerraTxError } from './errors.js';
import { advanceHunt, cancelHunt, createHunt, isJoinable, listHunts } from './hunts.js';
import type { CreateHuntOptions, CreatedHunt } from './hunts.js';
import { HuntInstructions } from './instructions.js';
import { logbookOwners } from './proof.js';
import { keypairSigner, toSigner } from './signer.js';
import type { TerraSigner } from './signer.js';

export interface DemoHuntOptions extends Partial<CreateHuntOptions> {
  /** A live hunt is reused only if at least this much time is left. Default 180 s. */
  minRemainingSecs?: number;
  /** Always create a new hunt. */
  fresh?: boolean;
  /**
   * Which of the treasury's live hunts may be reused. Default: those whose clue is the clue
   * new demo hunts get, so hunts the same key created for other purposes are left alone.
   */
  reuse?: (hunt: HuntAccount) => boolean;
  /**
   * Cancel reusable hunts of the treasury that were created more than five minutes ago but never
   * delegated (an interrupted creation), returning their prize and rent. Default true.
   */
  cancelStale?: boolean;
}

export interface DemoHunt {
  hunt: HuntAccount;
  /** Set when a new hunt was created. */
  created: CreatedHunt | null;
}

const DEMO_TITLES = ['Open waters', 'Uncharted', 'Dead reckoning', 'Here be dragons', 'Far horizon', 'Lost bearing'];
export const DEMO_CLUE = 'Nobody knows where it is. Not even us.';

/**
 * Returns a hunt from `treasury` that players can join right now: a live one with time and
 * seats left, or else a new VRF hunt with a small prize and a short clock.
 */
export async function ensureDemoHunt(
  client: TerraClient,
  treasury: TerraSigner | Keypair,
  options: DemoHuntOptions = {},
): Promise<DemoHunt> {
  const signer = toSigner(treasury);
  const { minRemainingSecs = 180, fresh = false, reuse, cancelStale = true, ...create } = options;
  const clue = create.riddle ?? create.clue ?? DEMO_CLUE;
  const reusable = reuse ?? ((hunt: HuntAccount) => hunt.clue === clue);
  const now = await client.now();
  const mine = (await listHunts(client, { creator: signer.publicKey })).filter(reusable);
  if (cancelStale) {
    for (const hunt of mine) {
      // Ids are creation times in milliseconds.
      const stale = hunt.status === HuntStatus.Created && Number(hunt.id / 1000n) < now - 300;
      if (stale) await cancelHunt(client, signer, hunt.address).catch(() => undefined);
    }
  }
  if (!fresh) {
    for (const hunt of mine) {
      if (!isJoinable(hunt, now, minRemainingSecs)) continue;
      const vault = await client.fetchVault(hunt.address);
      if (vault && vault.entrants < hunt.maxPlayers) return { hunt, created: null };
    }
  }
  const created = await createHunt(client, signer, {
    mode: 'vrf',
    title: DEMO_TITLES[Math.floor(Math.random() * DEMO_TITLES.length)] as string,
    clue,
    prizeSeed: Math.round(0.02 * LAMPORTS_PER_SOL),
    entryFee: 0,
    durationSecs: 15 * 60,
    zoneIntervalSecs: 90,
    maxPlayers: 32,
    ...create,
  });
  return { hunt: created.account, created };
}

/** Tops every recipient up to `lamports` from `funder` in as few transactions as possible. */
export async function fundAccounts(
  client: TerraClient,
  funder: TerraSigner | Keypair,
  recipients: PublicKey[],
  lamports: number,
): Promise<string[]> {
  const signer = toSigner(funder);
  const balances = await Promise.all(recipients.map((key) => client.base.getBalance(key)));
  const transfers = recipients
    .map((toPubkey, i) => ({ toPubkey, missing: lamports - (balances[i] ?? 0) }))
    .filter(({ missing }) => missing > 0)
    .map(({ toPubkey, missing }) => SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey, lamports: missing }));
  const signatures: string[] = [];
  for (let i = 0; i < transfers.length; i += 12) {
    signatures.push(await client.send('solana', transfers.slice(i, i + 12), signer));
  }
  return signatures;
}

/** Sends everything `keypairs` hold back to `to`, keeping only the fee. */
export async function sweepAccounts(client: TerraClient, keypairs: Keypair[], to: PublicKey): Promise<number> {
  const FEE = 5_000;
  let total = 0;
  for (const keypair of keypairs) {
    const balance = await client.base.getBalance(keypair.publicKey);
    if (balance <= FEE) continue;
    try {
      await client.send(
        'solana',
        [SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: to, lamports: balance - FEE })],
        keypairSigner(keypair),
      );
      total += balance - FEE;
    } catch (error) {
      if (!(error instanceof TerraTxError)) throw error;
    }
  }
  return total;
}

export interface CleanupOptions {
  /**
   * Also close the logbooks of these players, who sign for it: their rent goes back to them but
   * the record the audit is built on goes too. Logbooks of players not listed are released to
   * Solana, where they stay readable by anyone. In a void hunt every logbook is closed by the
   * refund of its entry fee instead, whether listed or not.
   */
  players?: (TerraSigner | Keypair)[];
  /** Kept for compatibility: closing a logbook now needs its owner's signature, see `players`. */
  closeLogbooks?: boolean;
  onStep?: (step: string, signature?: string) => void;
}

export interface CleanupResult {
  released: string[];
  closed: string[];
  /** Entry fees returned in a void hunt, one transaction per batch of entrants. */
  refunded: string[];
  /** Net change of the creator's and the players' balances while closing. */
  recovered: number;
}

/**
 * Recovers what a settled hunt still holds:
 *
 * 1. releases every logbook (opened first) and the board and the treasure back to Solana;
 * 2. in a void hunt, refunds every entrant's fee, which also closes their logbook;
 * 3. if `payer` is the creator, closes the board and the treasure and reclaims the settlement
 *    escrow and the rest of the hunt's operating lamports;
 * 4. closes the logbooks of the `players` given, signed by them.
 *
 * `payer` signs and pays every step. Anyone can do steps 1 and 2.
 */
export async function cleanupHunt(
  client: TerraClient,
  payer: TerraSigner | Keypair,
  huntAddress: PublicKey,
  options: CleanupOptions = {},
): Promise<CleanupResult> {
  const signer = toSigner(payer);
  const step = options.onStep ?? (() => undefined);
  let hunt = await client.fetchHunt(huntAddress);
  if (!hunt?.finalized) throw new TerraError('NotFinalized', 'the hunt has not been finalized');
  const vault = await client.fetchVault(huntAddress);
  if (vault && !vault.settled) {
    const advanced = await advanceHunt(client, huntAddress, signer, { settleGraceSecs: 0 });
    step('settle', advanced.signature);
  }
  hunt = (await client.fetchHunt(huntAddress)) ?? hunt;
  const ix = HuntInstructions.of(hunt, client.programId);
  const isVoid = hunt.status === HuntStatus.Void;
  const owners = await logbookOwners(client, huntAddress);
  const released: string[] = [];

  const releaseIfDelegated = async (address: PublicKey, build: () => TransactionInstruction[]) => {
    if ((await client.residence(address)) !== 'rollup') return;
    const signature = await client.send('rollup', build(), signer, { computeUnits: COMPUTE_UNITS.release });
    released.push(signature);
    step(`release ${address.toBase58()}`, signature);
  };

  for (const owner of owners) {
    const logbook = ix.logbook(owner);
    await releaseIfDelegated(logbook, () => [ix.openLogbook(owner), ix.releaseLogbook(signer.publicKey, owner)]).catch(async (error) => {
      // Already opened: release on its own.
      if (!(error instanceof TerraTxError)) throw error;
      await releaseIfDelegated(logbook, () => [ix.releaseLogbook(signer.publicKey, owner)]);
    });
  }
  await releaseIfDelegated(ix.addresses.board, () => [ix.releaseBoard(signer.publicKey)]);

  const watched = [ix.addresses.board, ix.addresses.treasure, ...owners.map((owner) => ix.logbook(owner))];
  const present = [];
  for (const address of watched) if ((await client.residence(address)) !== 'missing') present.push(address);
  await client.waitForRelease(present);

  const before = await balances(client, [hunt.creator, ...owners]);
  const onSolana = async (address: PublicKey) => (await client.residence(address)) === 'solana';

  const refunded: string[] = [];
  if (isVoid) {
    const refunds = [];
    for (const owner of owners) if (await onSolana(ix.logbook(owner))) refunds.push(ix.refundEntry(owner));
    for (let i = 0; i < refunds.length; i += 6) {
      const signature = await client.send('solana', refunds.slice(i, i + 6), signer);
      refunded.push(signature);
      step('refund', signature);
    }
  }

  const closed: string[] = [];
  if (signer.publicKey.equals(hunt.creator)) {
    const closes = [];
    if (await onSolana(ix.addresses.board)) closes.push(ix.closeBoard());
    if (await onSolana(ix.addresses.treasure)) closes.push(ix.closeTreasure());
    if ((await client.fetchVault(huntAddress))?.settled) closes.push(ix.reclaimEscrow());
    if (closes.length > 0) {
      const signature = await client.send('solana', closes, signer);
      closed.push(signature);
      step('close', signature);
    }
  }

  if (!isVoid) {
    for (const player of options.players ?? []) {
      const owner = toSigner(player);
      if (!(await onSolana(ix.logbook(owner.publicKey)))) continue;
      const signature = await client.send('solana', [ix.closeLogbook(owner.publicKey)], [signer, owner]);
      closed.push(signature);
      step(`close logbook ${owner.publicKey.toBase58()}`, signature);
    }
  }

  await sleep(1_000);
  const after = await balances(client, [hunt.creator, ...owners]);
  return { released, closed, refunded, recovered: after - before };
}

async function balances(client: TerraClient, keys: PublicKey[]): Promise<number> {
  const values = await Promise.all(keys.map((key) => client.base.getBalance(key)));
  return values.reduce((sum, value) => sum + value, 0);
}

/** Whether the hunt is over and paid, so that `cleanupHunt` may run. */
export async function isSettled(client: TerraClient, huntAddress: PublicKey): Promise<boolean> {
  const hunt = await client.fetchHunt(huntAddress);
  if (!hunt?.finalized || hunt.status === HuntStatus.Live) return false;
  return (await client.fetchVault(huntAddress))?.settled === true;
}
