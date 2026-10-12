import { Keypair, PublicKey } from '@solana/web3.js';
import type { TransactionInstruction } from '@solana/web3.js';
import { HuntMode, HuntStatus, bytesEqual, canonical, commitment, isTerminal, isUnit } from '@terra-incognita/core';
import type { Vec3 } from '@terra-incognita/core';

import { accountDiscriminator, decodeHunt } from './accounts.js';
import type { HuntAccount } from './accounts.js';
import { base58 } from './codec.js';
import { COMPUTE_UNITS, LIMITS } from './constants.js';
import { TerraError, TerraTxError, isTxError } from './errors.js';
import { HuntInstructions } from './instructions.js';
import type { HuntParams } from './instructions.js';
import { encryptedActions } from './sealed.js';
import { toSigner } from './signer.js';
import type { TerraSigner } from './signer.js';
import { sleep, waitFor } from './client.js';
import type { TerraClient } from './client.js';

export type CreateStep = 'create' | 'delegate' | 'open' | 'seal' | 'arm' | 'anchored' | 'crank';

export interface CreateHuntOptions {
  mode?: 'vrf' | 'author';
  /** Author mode: where the treasure goes. */
  location?: Vec3;
  /** Author mode: salt of the commitment. Random when absent. */
  salt?: Uint8Array;
  /**
   * Author mode: carry the location and salt inside the delegation, encrypted to the rollup
   * validator, so they never appear in clear on Solana or in a rollup transaction. Default
   * true. With false the creator sends `seal_from_author` to the rollup directly.
   */
  sealed?: boolean;
  /** Seed of the hunt address. Defaults to the current time in milliseconds. */
  id?: bigint | number;
  title?: string;
  clue?: string;
  /** Same as `clue`: the riddle of an author hunt. Wins when both are given. */
  riddle?: string;
  /** Lamports. */
  entryFee?: number;
  /** Lamports. */
  prizeSeed?: number;
  creatorBps?: number;
  maxPlayers?: number;
  speedKms?: number;
  /** Seconds from now until soundings are allowed; at most 7 days. */
  startsInSecs?: number;
  /** Seconds from the start to the deadline: at least 135 (the program's 120 plus a margin), at most 30 days. */
  durationSecs: number;
  /** Seconds between zone stages (more than 0). Default 60. */
  zoneIntervalSecs?: number;
  /** Lamports left on the hunt account for rollup fees. */
  opsLamports?: number;
  /** Seconds between scheduled ticks inside the rollup, or false to schedule none. */
  crankIntervalSecs?: number | false;
  /** Key that signs the permissionless rollup steps (arm, crank). Defaults to the client's relay key. */
  operator?: TerraSigner;
  onStep?: (step: CreateStep, signature?: string) => void;
}

export interface CreatedHunt {
  hunt: PublicKey;
  id: bigint;
  account: HuntAccount;
  /** How the treasure was placed: by VRF, by an encrypted action in the delegation, or by a direct seal. */
  sealing: 'vrf' | 'encrypted' | 'direct';
  /** Author mode: the salt of the commitment, which the creator may keep to check it. */
  salt?: Uint8Array;
  signatures: Partial<Record<CreateStep, string>>;
  /** The scheduler that runs `tick`, or null when none could be registered. */
  crank: 'hydra' | 'legacy' | null;
}

const randomBytes = (length: number): Uint8Array => crypto.getRandomValues(new Uint8Array(length));

/**
 * Takes a hunt from nothing to live and waits until the commitment is anchored on Solana, then
 * registers a crank if one is available.
 *
 * - VRF mode: create and delegate on Solana, open inside the rollup (which requests the
 *   randomness), arm once the callback has sealed the treasure.
 * - Author mode, `sealed` (the default): create on Solana, then delegate with the location and
 *   salt encrypted to the validator as a post-delegation action; the validator seals the
 *   treasure inside the rollup, and the hunt is armed once it has. The creator signs two
 *   transactions and the location never appears in clear.
 * - Author mode with `sealed: false`: create, delegate, open, then `seal_from_author` sent to
 *   the rollup by the creator.
 */
export async function createHunt(
  client: TerraClient,
  creator: TerraSigner | Keypair,
  options: CreateHuntOptions,
): Promise<CreatedHunt> {
  const wallet = toSigner(creator);
  const operator = options.operator ?? client.relay;
  const mode = options.mode === 'author' ? HuntMode.Author : HuntMode.Vrf;
  if (mode === HuntMode.Author && (!options.location || !isUnit(options.location))) {
    throw new TerraError('NotUnitVector', 'an author hunt needs a treasure location on the unit sphere');
  }
  const id = BigInt(options.id ?? Date.now());
  const ix = HuntInstructions.forNew(wallet.publicKey, id, client.config.validator, client.programId);
  const signatures: Partial<Record<CreateStep, string>> = {};
  const step = (name: CreateStep, signature?: string) => {
    if (signature) signatures[name] = signature;
    options.onStep?.(name, signature);
  };

  const sealing: CreatedHunt['sealing'] = mode === HuntMode.Vrf ? 'vrf' : options.sealed === false ? 'direct' : 'encrypted';
  const salt = mode === HuntMode.Author ? (options.salt ?? randomBytes(32)) : undefined;
  const now = await client.now();
  const startsAt = now + (options.startsInSecs ?? 0);
  const params: HuntParams = {
    mode,
    validator: client.config.validator,
    entryFee: options.entryFee ?? 0,
    prizeSeed: options.prizeSeed ?? 0,
    creatorBps: options.creatorBps ?? 0,
    maxPlayers: options.maxPlayers ?? 16,
    speedKms: options.speedKms ?? 800,
    startsAt,
    deadline: startsAt + options.durationSecs,
    zoneIntervalSecs: options.zoneIntervalSecs ?? 60,
    opsLamports: options.opsLamports ?? 20_000_000,
    title: options.title ?? 'Terra Incognita',
    clue: options.riddle ?? options.clue ?? '',
  };
  validateParams(params, now);

  step(
    'create',
    await client.send('solana', [ix.createHunt(id, params)], wallet, { computeUnits: COMPUTE_UNITS.createHunt }),
  );
  await waitFor('the hunt on Solana', async () => (await client.residence(ix.hunt)) === 'solana', 60_000, 750);

  if (sealing === 'encrypted') {
    const actions = encryptedActions([ix.sealFromAction(options.location as Vec3, salt as Uint8Array)], client.config.validator);
    step(
      'delegate',
      await client.send('solana', [ix.delegateHuntSealed(id, actions)], wallet, { computeUnits: COMPUTE_UNITS.delegateHuntSealed }),
    );
    await client.waitForDelegation([ix.hunt, ix.addresses.board, ix.addresses.treasure]);
    step('seal');
  } else {
    step(
      'delegate',
      await client.send('solana', [ix.delegateHunt(id)], wallet, { computeUnits: COMPUTE_UNITS.delegateHunt }),
    );
    await client.waitForDelegation([ix.hunt, ix.addresses.board, ix.addresses.treasure]);
    step('open', await sendWithRetry(client, () => client.send('rollup', [ix.openHunt()], wallet, { computeUnits: COMPUTE_UNITS.openHunt })));
    if (sealing === 'direct') {
      step('seal', await client.send('rollup', [ix.sealFromAuthor(options.location as Vec3, salt as Uint8Array)], wallet));
    }
  }

  // Until the treasure is sealed, arm fails with NotSealed, or with WrongStatus while an
  // encrypted seal has not run yet.
  const notYet = sealing === 'encrypted' ? (['NotSealed', 'WrongStatus'] as const) : (['NotSealed'] as const);
  const armIx = ix.arm(operator.publicKey);
  step(
    'arm',
    await waitFor(
      'the treasure to be sealed',
      async () => {
        try {
          return await client.send('rollup', [armIx], operator, { computeUnits: COMPUTE_UNITS.arm });
        } catch (error) {
          if (isTxError(error, ...notYet)) return null;
          // The rollup may not have cloned the freshly delegated accounts yet.
          if (error instanceof TerraTxError && error.code === null && error.signature === null) return null;
          throw error;
        }
      },
      150_000,
      750,
    ),
  );

  const account = await waitFor(
    'the armed hunt on Solana',
    async () => {
      const info = await client.base.getAccountInfo(ix.hunt);
      if (!info) return null;
      const hunt = decodeHunt(ix.hunt, info.data);
      return hunt.status === HuntStatus.Live ? hunt : null;
    },
    150_000,
    1_000,
  );
  step('anchored');
  if (salt && !bytesEqual(account.commitment, commitment(ix.hunt.toBytes(), canonical(options.location as Vec3), salt))) {
    throw new TerraError('CommitmentMismatch', 'the anchored commitment does not match the location and salt the creator chose');
  }

  let crank: CreatedHunt['crank'] = null;
  if (options.crankIntervalSecs !== false) {
    crank = await scheduleCrank(client, ix, operator, options.crankIntervalSecs ?? 1, (signature) => step('crank', signature));
  }
  return {
    hunt: ix.hunt,
    id,
    account: (await client.fetchHunt(ix.hunt)) ?? account,
    sealing,
    ...(salt ? { salt } : {}),
    signatures,
    crank,
  };
}

/** Slack on top of the program's minimum play time, for the time the creation takes to land. */
const PLAY_MARGIN_SECS = 15;

function validateParams(params: HuntParams, now: number): void {
  const bytes = (value: string) => new TextEncoder().encode(value).length;
  const problems: string[] = [];
  const playFrom = Math.max(params.startsAt, now);
  if (params.creatorBps < 0 || params.creatorBps > LIMITS.maxCreatorBps) problems.push('creatorBps');
  if (params.maxPlayers < 1 || params.maxPlayers > LIMITS.maxPlayers) problems.push('maxPlayers');
  if (params.speedKms <= 0) problems.push('speedKms');
  if (params.zoneIntervalSecs <= 0) problems.push('zoneIntervalSecs');
  if (params.startsAt - now > LIMITS.maxStartDelaySecs) problems.push('startsInSecs (at most 7 days)');
  if (params.deadline - playFrom < LIMITS.minPlaySecs + PLAY_MARGIN_SECS) problems.push(`durationSecs (at least ${LIMITS.minPlaySecs + PLAY_MARGIN_SECS})`);
  if (params.deadline - playFrom > LIMITS.maxDurationSecs) problems.push('durationSecs (at most 30 days)');
  if (BigInt(params.opsLamports) < BigInt(LIMITS.minOpsLamports)) problems.push('opsLamports');
  if (bytes(params.title) > LIMITS.maxTitleBytes) problems.push('title');
  if (bytes(params.clue) > LIMITS.maxClueBytes) problems.push('clue');
  if (problems.length > 0) throw new TerraError('InvalidParams', `invalid hunt parameters: ${problems.join(', ')}`);
}

/** The rollup may not have cloned a freshly delegated account yet; give it a few seconds. */
async function sendWithRetry(client: TerraClient, send: () => Promise<string>, attempts = 6): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await send();
    } catch (error) {
      const retriable = error instanceof TerraTxError && error.code === null && error.signature === null;
      if (!retriable || attempt >= attempts) throw error;
      await sleep(1_000 * attempt);
    }
  }
}

/**
 * Registers a recurring `tick` inside the rollup. The validator's task scheduler is tried first:
 * on devnet it runs the ticks, while the Hydra scheduler accepts the registration but has not
 * been seen to run them. Returns which one took it, or null.
 */
export async function scheduleCrank(
  client: TerraClient,
  ix: HuntInstructions,
  operator: TerraSigner,
  intervalSecs: number,
  onScheduled?: (signature: string) => void,
): Promise<'hydra' | 'legacy' | null> {
  const interval = Math.max(1, intervalSecs);
  const attempts: [kind: 'legacy' | 'hydra', build: () => TransactionInstruction][] = [
    ['legacy', () => ix.scheduleTickLegacy(operator.publicKey, BigInt(Date.now()), interval * 1_000)],
    ['hydra', () => ix.scheduleTick(operator.publicKey, interval * 20)],
  ];
  for (const [kind, build] of attempts) {
    try {
      onScheduled?.(await client.send('rollup', [build()], operator, { computeUnits: COMPUTE_UNITS.tick }));
      return kind;
    } catch (error) {
      if (!(error instanceof TerraTxError)) throw error;
    }
  }
  return null;
}

export interface ListHuntsOptions {
  creator?: PublicKey;
}

/**
 * Every hunt of the program: live ones from the rollup, the others from Solana. Newest first.
 * Hunts from earlier, incompatible deployments may decode but will never progress; filter by
 * creator or deadline to hide them.
 */
export async function listHunts(client: TerraClient, options: ListHuntsOptions = {}): Promise<HuntAccount[]> {
  const filters = [
    { memcmp: { offset: 0, bytes: base58(accountDiscriminator('Hunt')) } },
    ...(options.creator ? [{ memcmp: { offset: 8, bytes: options.creator.toBase58() } }] : []),
  ];
  const [onRollup, onBase] = await Promise.all([
    client.rollup.getProgramAccounts(client.programId, { filters }).catch(() => []),
    client.base.getProgramAccounts(client.programId, { filters }).catch(() => []),
  ]);
  const hunts = new Map<string, HuntAccount>();
  const decode = (pubkey: PublicKey, data: Uint8Array) => {
    try {
      return decodeHunt(pubkey, data);
    } catch {
      return null;
    }
  };
  for (const { pubkey, account } of onRollup) {
    const hunt = decode(pubkey, account.data);
    if (hunt) hunts.set(pubkey.toBase58(), hunt);
  }
  // Accounts owned by the program on Solana are not delegated, so their Solana copy is current.
  for (const { pubkey, account } of onBase) {
    const hunt = decode(pubkey, account.data);
    if (hunt) hunts.set(pubkey.toBase58(), hunt);
  }
  return [...hunts.values()].sort((a, b) => (a.id === b.id ? 0 : a.id > b.id ? -1 : 1));
}

/** Whether a player can still join `hunt` and expect to play. */
export function isJoinable(hunt: HuntAccount, now = Math.floor(Date.now() / 1000), minRemainingSecs = 30): boolean {
  return (
    hunt.status === HuntStatus.Live &&
    !hunt.finalized &&
    hunt.deadline - now >= minRemainingSecs &&
    hunt.players < hunt.maxPlayers
  );
}

export type AdvanceAction = 'none' | 'tick' | 'finalize' | 'settle';

export interface AdvanceResult {
  action: AdvanceAction;
  signature?: string;
  hunt: HuntAccount | null;
}

/**
 * Moves a hunt along by one step if the clock or its state call for it: a tick while it is live
 * (promotes a strike from an earlier slot, closes it at the deadline, shrinks the zone), a
 * finalize once it has ended, or the direct settlement fallback once it is back on Solana and the
 * scheduled payout has not arrived within `settleGraceSecs`. Anyone can call this.
 */
export async function advanceHunt(
  client: TerraClient,
  huntAddress: PublicKey,
  signer: TerraSigner = client.relay,
  options: { settleGraceSecs?: number; force?: boolean } = {},
): Promise<AdvanceResult> {
  const hunt = await client.fetchHunt(huntAddress);
  if (!hunt) return { action: 'none', hunt };
  const ix = HuntInstructions.of(hunt, client.programId);
  const now = await client.now();

  if (hunt.finalized) {
    if ((await client.residence(huntAddress)) !== 'solana') return { action: 'none', hunt };
    const vault = await client.fetchVault(huntAddress);
    const grace = options.settleGraceSecs ?? 90;
    if (!vault || vault.settled || now - hunt.endedAt < grace) return { action: 'none', hunt };
    const payee = hunt.status === HuntStatus.Void ? hunt.creator : hunt.winner;
    if (!payee) return { action: 'none', hunt };
    const signature = await client.send('solana', [ix.settle(payee)], signer);
    return { action: 'settle', signature, hunt };
  }

  if (isTerminal(hunt.status)) {
    const signature = await client.send('rollup', [ix.finalize()], signer, { computeUnits: COMPUTE_UNITS.finalize });
    return { action: 'finalize', signature, hunt };
  }

  if (hunt.status === HuntStatus.Live) {
    const zoneDue =
      hunt.zoneIntervalSecs > 0 && now >= hunt.startsAt && Math.floor((now - hunt.startsAt) / hunt.zoneIntervalSecs) > hunt.zone.stage && hunt.zone.stage < 8;
    if (options.force || now >= hunt.deadline || zoneDue) {
      const signature = await client.send('rollup', [ix.tick()], signer, { computeUnits: COMPUTE_UNITS.tick });
      return { action: 'tick', signature, hunt };
    }
  }
  return { action: 'none', hunt };
}

/**
 * Drives a hunt that may have just been struck to its end: ticks until the strike is public,
 * then finalizes. A strike only becomes public in a slot after the one it was made in, so the
 * first tick can come too early; it simply gets repeated. Returns the signatures it sent.
 */
export async function concludeHunt(
  client: TerraClient,
  huntAddress: PublicKey,
  signer: TerraSigner = client.relay,
  timeoutMs = 30_000,
): Promise<{ tick?: string; finalize?: string; hunt: HuntAccount | null }> {
  const sent: { tick?: string; finalize?: string } = {};
  const started = Date.now();
  let hunt: HuntAccount | null = null;
  while (Date.now() - started < timeoutMs) {
    hunt = await client.fetchHunt(huntAddress);
    if (!hunt || hunt.finalized) break;
    const ix = HuntInstructions.of(hunt, client.programId);
    try {
      if (isTerminal(hunt.status)) {
        sent.finalize = await client.send('rollup', [ix.finalize()], signer, { computeUnits: COMPUTE_UNITS.finalize });
      } else if (hunt.status === HuntStatus.Live) {
        await sleep(150);
        sent.tick = await client.send('rollup', [ix.tick()], signer, { computeUnits: COMPUTE_UNITS.tick });
      } else {
        break;
      }
    } catch (error) {
      if (!(error instanceof TerraTxError)) throw error;
      // Someone else (a rival, the crank) moved the hunt first; read it again.
    }
    await sleep(250);
  }
  return { ...sent, hunt };
}

/** Waits until the hunt is back on Solana and its vault has paid out. */
export async function waitForSettlement(
  client: TerraClient,
  huntAddress: PublicKey,
  timeoutMs = 180_000,
): Promise<{ hunt: HuntAccount; settled: boolean }> {
  const hunt = await waitFor(
    'the finalized hunt on Solana',
    async () => {
      if ((await client.residence(huntAddress)) !== 'solana') return null;
      const account = await client.fetchHunt(huntAddress);
      return account?.finalized ? account : null;
    },
    timeoutMs,
    1_500,
  );
  const settled = await waitFor('the payout', async () => (await client.fetchVault(huntAddress))?.settled === true, 60_000, 1_500).catch(
    () => false,
  );
  return { hunt, settled };
}


/**
 * Withdraws a hunt that was created but never delegated: reclaims the settlement escrow and
 * closes the hunt, board, treasure and vault, prize seed included, back to the creator. One
 * transaction, signed by the creator.
 */
export async function cancelHunt(
  client: TerraClient,
  creator: TerraSigner | Keypair,
  huntAddress: PublicKey,
): Promise<{ signature: string; recovered: number }> {
  const signer = toSigner(creator);
  const hunt = await client.fetchHunt(huntAddress);
  if (!hunt) throw new TerraError('InvalidHunt', `no hunt at ${huntAddress.toBase58()}`);
  if ((await client.residence(huntAddress)) !== 'solana' || hunt.status !== HuntStatus.Created) {
    throw new TerraError('WrongStatus', 'only a hunt that was never delegated can be cancelled');
  }
  if (!signer.publicKey.equals(hunt.creator)) throw new TerraError('NotCreator', 'only the creator can cancel a hunt');
  const ix = HuntInstructions.of(hunt, client.programId);
  const before = await client.base.getBalance(signer.publicKey);
  const signature = await client.send('solana', [ix.reclaimEscrow(), ix.cancelHunt()], signer);
  const after = await client.base.getBalance(signer.publicKey);
  return { signature, recovered: after - before };
}

export interface RefundResult {
  /** The rollup transaction that brought the logbook back to Solana, if it was still delegated. */
  release?: string;
  refund: string;
  /** The entry fee returned; the logbook's rent comes back on top. */
  entryFee: number;
}

/**
 * Takes an entry fee back from a void hunt (one that ended without a single sounding): brings
 * the player's logbook back to Solana, then refunds the fee and closes the logbook, whose rent
 * goes to the player as well. `payer` pays both transactions and may be anyone; `releaser`
 * signs the rollup step and defaults to `payer`.
 */
export async function claimRefund(
  client: TerraClient,
  huntAddress: PublicKey,
  owner: PublicKey,
  payer: TerraSigner | Keypair,
  options: { releaser?: TerraSigner | Keypair } = {},
): Promise<RefundResult> {
  const signer = toSigner(payer);
  const releaser = options.releaser ? toSigner(options.releaser) : signer;
  const hunt = await client.fetchHunt(huntAddress);
  if (!hunt) throw new TerraError('InvalidHunt', `no hunt at ${huntAddress.toBase58()}`);
  if (!hunt.finalized || hunt.status !== HuntStatus.Void) throw new TerraError('NotVoid', 'only a void hunt refunds entry fees');
  const ix = HuntInstructions.of(hunt, client.programId);
  const logbook = ix.logbook(owner);
  const residence = await client.residence(logbook);
  if (residence === 'missing') throw new TerraError('AlreadyRefunded', 'this entry has been refunded already');

  let release: string | undefined;
  if (residence === 'rollup') {
    const send = (by: TerraSigner) =>
      client.send('rollup', [ix.releaseLogbook(by.publicKey, owner)], by, { computeUnits: COMPUTE_UNITS.release });
    try {
      release = await send(releaser);
    } catch (error) {
      if (!(error instanceof TerraTxError) || releaser === signer) throw error;
      release = await send(signer);
    }
    await client.waitForRelease([logbook]);
  }
  const refund = await client.send('solana', [ix.refundEntry(owner)], signer);
  return { ...(release ? { release } : {}), refund, entryFee: hunt.entryFee };
}
