import { ComputeBudgetProgram, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { HuntMode } from '@terra-incognita/core';
import type { Vec3 } from '@terra-incognita/core';

import type { HuntAccount } from './accounts.js';
import { Writer } from './codec.js';
import {
  DELEGATION_PROGRAM_ID,
  EPHEMERAL_VAULT_ID,
  HYDRA_EPHEMERAL_ID,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  PERMISSION_PROGRAM_ID,
  PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  SYSVAR_SLOT_HASHES_ID,
  VRF_EPHEMERAL_QUEUE,
  VRF_PROGRAM_ID,
} from './constants.js';
import {
  delegateBufferAddress,
  delegationMetadataAddress,
  delegationRecordAddress,
  huntAddress,
  huntAddresses,
  logbookAddress,
  magicFeeVaultAddress,
  permissionAddress,
  programIdentityAddress,
} from './pda.js';
import type { HuntAddresses } from './pda.js';
import { PROGRAM_INTERFACE } from './program-interface.js';

export type InstructionName = keyof typeof PROGRAM_INTERFACE.instructions;

const camel = (name: string): string => name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/**
 * Builds an instruction of the program from its interface description: the discriminator and
 * the account order come from the IDL, fixed addresses fill themselves in, every other account
 * must be given by its camelCase name.
 */
export function buildInstruction(
  name: InstructionName,
  accounts: Record<string, PublicKey>,
  args: Uint8Array = new Uint8Array(),
  programId: PublicKey = PROGRAM_ID,
): TransactionInstruction {
  const spec = PROGRAM_INTERFACE.instructions[name];
  const keys = spec.accounts.map((account) => {
    const given = accounts[camel(account.name)];
    const fixed = 'address' in account ? account.address : undefined;
    const pubkey = given ?? (fixed ? new PublicKey(fixed) : undefined);
    if (!pubkey) throw new Error(`${name}: missing account ${camel(account.name)}`);
    return {
      pubkey,
      isSigner: 'signer' in account && account.signer === true,
      isWritable: 'writable' in account && account.writable === true,
    };
  });
  const data = new Uint8Array(8 + args.length);
  data.set(spec.discriminator, 0);
  data.set(args, 8);
  return new TransactionInstruction({ programId, keys, data: Buffer.from(data) });
}

export function computeLimit(units: number): TransactionInstruction {
  return ComputeBudgetProgram.setComputeUnitLimit({ units });
}

export interface HuntParams {
  mode: HuntMode;
  validator: PublicKey;
  /** Lamports each player pays to join. */
  entryFee: number | bigint;
  /** Lamports the creator puts into the prize. */
  prizeSeed: number | bigint;
  /** Share of the entry fees that goes to the creator, in basis points (at most 2000). */
  creatorBps: number;
  maxPlayers: number;
  speedKms: number;
  startsAt: number;
  deadline: number;
  zoneIntervalSecs: number;
  /** Lamports left on the hunt account to pay rollup fees (at least 0.005 SOL). */
  opsLamports: number | bigint;
  title: string;
  clue: string;
}

export function encodeHuntParams(params: HuntParams, w = new Writer()): Writer {
  return w
    .u8(params.mode === HuntMode.Author ? 1 : 0)
    .pubkey(params.validator)
    .u64(params.entryFee)
    .u64(params.prizeSeed)
    .u16(params.creatorBps)
    .u8(params.maxPlayers)
    .u32(params.speedKms)
    .i64(params.startsAt)
    .i64(params.deadline)
    .u32(params.zoneIntervalSecs)
    .u64(params.opsLamports)
    .string(params.title)
    .string(params.clue);
}

/** Instruction builders for one hunt, with every derived account filled in. */
export class HuntInstructions {
  readonly addresses: HuntAddresses;
  readonly feeVault: PublicKey;

  constructor(
    readonly hunt: PublicKey,
    readonly creator: PublicKey,
    readonly validator: PublicKey,
    readonly programId: PublicKey = PROGRAM_ID,
  ) {
    this.addresses = huntAddresses(hunt, programId);
    this.feeVault = magicFeeVaultAddress(validator);
  }

  static forNew(creator: PublicKey, id: bigint | number, validator: PublicKey, programId = PROGRAM_ID): HuntInstructions {
    return new HuntInstructions(huntAddress(creator, id, programId), creator, validator, programId);
  }

  static of(hunt: Pick<HuntAccount, 'address' | 'creator' | 'validator'>, programId = PROGRAM_ID): HuntInstructions {
    return new HuntInstructions(hunt.address, hunt.creator, hunt.validator, programId);
  }

  logbook(owner: PublicKey): PublicKey {
    return logbookAddress(this.hunt, owner, this.programId);
  }

  private ix(name: InstructionName, accounts: Record<string, PublicKey>, args?: Uint8Array): TransactionInstruction {
    return buildInstruction(name, accounts, args, this.programId);
  }

  private delegation(suffix: string, account: PublicKey): Record<string, PublicKey> {
    return {
      [`buffer${suffix}`]: delegateBufferAddress(account, this.programId),
      [`delegationRecord${suffix}`]: delegationRecordAddress(account),
      [`delegationMetadata${suffix}`]: delegationMetadataAddress(account),
    };
  }

  private get permissionAccounts(): Record<string, PublicKey> {
    return {
      permissionProgram: PERMISSION_PROGRAM_ID,
      ephemeralVault: EPHEMERAL_VAULT_ID,
      magicProgram: MAGIC_PROGRAM_ID,
    };
  }

  private get tickAccounts(): Record<string, PublicKey> {
    return {
      hunt: this.hunt,
      treasure: this.addresses.treasure,
      vault: this.addresses.vault,
      magicFeeVault: this.feeVault,
      program: this.programId,
      magicProgram: MAGIC_PROGRAM_ID,
      magicContext: MAGIC_CONTEXT_ID,
    };
  }

  // Solana --------------------------------------------------------------------------------------

  createHunt(id: bigint | number, params: HuntParams): TransactionInstruction {
    const args = encodeHuntParams(params, new Writer().u64(id)).finish();
    return this.ix(
      'create_hunt',
      {
        creator: this.creator,
        hunt: this.hunt,
        board: this.addresses.board,
        treasure: this.addresses.treasure,
        vault: this.addresses.vault,
        actionEscrow: this.addresses.actionEscrow,
        delegationProgram: DELEGATION_PROGRAM_ID,
        systemProgram: SYSTEM_PROGRAM_ID,
      },
      args,
    );
  }

  delegateHunt(id: bigint | number): TransactionInstruction {
    return this.ix(
      'delegate_hunt',
      {
        creator: this.creator,
        hunt: this.hunt,
        board: this.addresses.board,
        treasure: this.addresses.treasure,
        ...this.delegation('Hunt', this.hunt),
        ...this.delegation('Board', this.addresses.board),
        ...this.delegation('Treasure', this.addresses.treasure),
        ownerProgram: this.programId,
      },
      new Writer().u64(id).finish(),
    );
  }

  /**
   * Delegates like `delegateHunt` and attaches post-delegation actions (see `encryptedActions`)
   * that the validator runs inside the rollup once it holds the treasure. Author mode only.
   */
  delegateHuntSealed(id: bigint | number, actions: Uint8Array): TransactionInstruction {
    return this.ix(
      'delegate_hunt_sealed',
      {
        creator: this.creator,
        hunt: this.hunt,
        board: this.addresses.board,
        treasure: this.addresses.treasure,
        ...this.delegation('Hunt', this.hunt),
        ...this.delegation('Board', this.addresses.board),
        ...this.delegation('Treasure', this.addresses.treasure),
        ownerProgram: this.programId,
      },
      new Writer().u64(id).u32(actions.length).bytes(actions).finish(),
    );
  }

  join(player: PublicKey, operator: PublicKey): TransactionInstruction {
    const logbook = this.logbook(player);
    return this.ix(
      'join',
      {
        player,
        hunt: this.hunt,
        vault: this.addresses.vault,
        logbook,
        ...this.delegation('Logbook', logbook),
        ownerProgram: this.programId,
      },
      new Writer().pubkey(operator).finish(),
    );
  }

  /** Pays out the vault directly. The rollup normally schedules this itself at finalisation. */
  settle(payee: PublicKey): TransactionInstruction {
    return this.ix('settle', {
      hunt: this.hunt,
      vault: this.addresses.vault,
      payee,
      creator: this.creator,
      escrowAuth: this.hunt,
      escrow: this.addresses.actionEscrow,
    });
  }

  /**
   * Void hunts only: returns the entry fee from the vault to `owner` and closes their logbook,
   * which must be back on Solana. Anyone may send it.
   */
  refundEntry(owner: PublicKey): TransactionInstruction {
    return this.ix('refund_entry', { hunt: this.hunt, vault: this.addresses.vault, logbook: this.logbook(owner), owner });
  }

  /** Withdraws a hunt that was never delegated; everything goes back to the creator, who signs. */
  cancelHunt(): TransactionInstruction {
    return this.ix('cancel_hunt', {
      creator: this.creator,
      hunt: this.hunt,
      board: this.addresses.board,
      treasure: this.addresses.treasure,
      vault: this.addresses.vault,
    });
  }

  /**
   * Closes the escrow that pays for the settlement action and hands the creator everything the
   * hunt account holds beyond its rent. Allowed before delegation and after settlement.
   */
  reclaimEscrow(): TransactionInstruction {
    return this.ix('reclaim_escrow', {
      creator: this.creator,
      hunt: this.hunt,
      vault: this.addresses.vault,
      actionEscrow: this.addresses.actionEscrow,
    });
  }

  /** The owner signs: the record of their soundings goes with it. Not for void hunts (use `refundEntry`). */
  closeLogbook(owner: PublicKey): TransactionInstruction {
    return this.ix('close_logbook', { hunt: this.hunt, logbook: this.logbook(owner), owner });
  }

  /** The creator signs. */
  closeBoard(): TransactionInstruction {
    return this.ix('close_board', { hunt: this.hunt, board: this.addresses.board, creator: this.creator });
  }

  /** The creator signs. */
  closeTreasure(): TransactionInstruction {
    return this.ix('close_treasure', { hunt: this.hunt, treasure: this.addresses.treasure, creator: this.creator });
  }

  // Rollup --------------------------------------------------------------------------------------

  openHunt(): TransactionInstruction {
    return this.ix('open_hunt', {
      creator: this.creator,
      hunt: this.hunt,
      treasure: this.addresses.treasure,
      treasurePermission: this.addresses.treasurePermission,
      ...this.permissionAccounts,
      oracleQueue: VRF_EPHEMERAL_QUEUE,
      programIdentity: programIdentityAddress(this.programId),
      vrfProgram: VRF_PROGRAM_ID,
      slotHashes: SYSVAR_SLOT_HASHES_ID,
    });
  }

  sealFromAuthor(location: Vec3, salt: Uint8Array): TransactionInstruction {
    return this.ix(
      'seal_from_author',
      { creator: this.creator, hunt: this.hunt, treasure: this.addresses.treasure },
      new Writer().vec3(location).fixed(salt, 32).finish(),
    );
  }

  /**
   * The seal an author hunt carries in its delegation. Only the validator runs it, decrypted,
   * as a post-delegation action; sent as a transaction it is rejected. The hunt key is part of
   * the sealed arguments, so a seal cannot be replayed into another hunt (`ForeignSeal`).
   */
  sealFromAction(location: Vec3, salt: Uint8Array, sealedFor: PublicKey = this.hunt): TransactionInstruction {
    return this.ix(
      'seal_from_action',
      {
        creator: this.creator,
        hunt: this.hunt,
        treasure: this.addresses.treasure,
        treasurePermission: this.addresses.treasurePermission,
        ...this.permissionAccounts,
      },
      new Writer().pubkey(sealedFor).vec3(location).fixed(salt, 32).finish(),
    );
  }

  /** Permissionless once the treasure is sealed; `payer` only signs. */
  arm(payer: PublicKey): TransactionInstruction {
    return this.ix('arm', {
      payer,
      hunt: this.hunt,
      treasure: this.addresses.treasure,
      magicFeeVault: this.feeVault,
    });
  }

  scheduleTick(payer: PublicKey, intervalSlots: number): TransactionInstruction {
    return this.ix(
      'schedule_tick',
      { payer, hunt: this.hunt, crank: this.addresses.crank, hydraProgram: HYDRA_EPHEMERAL_ID },
      new Writer().u32(intervalSlots).finish(),
    );
  }

  scheduleTickLegacy(payer: PublicKey, taskId: bigint | number, intervalMillis: number): TransactionInstruction {
    return this.ix(
      'schedule_tick_legacy',
      { payer, ...this.tickAccounts },
      new Writer().i64(taskId).i64(intervalMillis).finish(),
    );
  }

  embark(pilot: PublicKey, owner: PublicKey, start: Vec3): TransactionInstruction {
    const logbook = this.logbook(owner);
    return this.ix(
      'embark',
      {
        pilot,
        hunt: this.hunt,
        board: this.addresses.board,
        logbook,
        logbookPermission: permissionAddress(logbook),
        ...this.permissionAccounts,
      },
      new Writer().vec3(start).finish(),
    );
  }

  setCourse(pilot: PublicKey, owner: PublicKey, destination: Vec3): TransactionInstruction {
    return this.ix(
      'set_course',
      { pilot, hunt: this.hunt, board: this.addresses.board, logbook: this.logbook(owner) },
      new Writer().vec3(destination).finish(),
    );
  }

  probe(pilot: PublicKey, owner: PublicKey): TransactionInstruction {
    return this.ix('probe', {
      pilot,
      hunt: this.hunt,
      board: this.addresses.board,
      treasure: this.addresses.treasure,
      logbook: this.logbook(owner),
    });
  }

  tick(): TransactionInstruction {
    return this.ix('tick', this.tickAccounts);
  }

  finalize(): TransactionInstruction {
    return this.ix('finalize', this.tickAccounts);
  }

  openTreasure(): TransactionInstruction {
    return this.ix('open_treasure', {
      treasure: this.addresses.treasure,
      treasurePermission: this.addresses.treasurePermission,
      ...this.permissionAccounts,
    });
  }

  openLogbook(owner: PublicKey): TransactionInstruction {
    const logbook = this.logbook(owner);
    return this.ix('open_logbook', {
      treasure: this.addresses.treasure,
      logbook,
      logbookPermission: permissionAddress(logbook),
      ...this.permissionAccounts,
    });
  }

  releaseLogbook(payer: PublicKey, owner: PublicKey): TransactionInstruction {
    return this.ix('release_logbook', {
      payer,
      treasure: this.addresses.treasure,
      logbook: this.logbook(owner),
    });
  }

  releaseBoard(payer: PublicKey): TransactionInstruction {
    return this.ix('release_board', {
      payer,
      treasure: this.addresses.treasure,
      board: this.addresses.board,
    });
  }
}
