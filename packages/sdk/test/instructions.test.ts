import { BN } from '@coral-xyz/anchor';
import {
  DELEGATION_PROGRAM_ID as MB_DELEGATION,
  EPHEMERAL_VAULT_ID as MB_EPHEMERAL_VAULT,
  MAGIC_CONTEXT_ID as MB_MAGIC_CONTEXT,
  MAGIC_PROGRAM_ID as MB_MAGIC_PROGRAM,
  PERMISSION_PROGRAM_ID as MB_PERMISSION,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
  escrowPdaFromEscrowAuthority,
  magicFeeVaultPdaFromValidator,
  permissionPdaFromAccount,
} from '@magicblock-labs/ephemeral-rollups-sdk';
import { Keypair, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { HuntMode, fromLatLon } from '@terra-incognita/core';
import { describe, expect, it } from 'vitest';

import {
  DELEGATION_PROGRAM_ID,
  DEVNET,
  EPHEMERAL_VAULT_ID,
  HYDRA_EPHEMERAL_ID,
  HuntInstructions,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  PERMISSION_PROGRAM_ID,
  PROGRAM_ID,
  SYSVAR_SLOT_HASHES_ID,
  VRF_EPHEMERAL_QUEUE,
  VRF_PROGRAM_ID,
  actionEscrowAddress,
  boardAddress,
  buildInstruction,
  crankAddress,
  delegateBufferAddress,
  delegationMetadataAddress,
  delegationRecordAddress,
  huntAddress,
  logbookAddress,
  magicFeeVaultAddress,
  permissionAddress,
  treasureAddress,
  vaultAddress,
} from '../src/index.js';
import { anchorProgram } from './anchor.js';

const program = anchorProgram();
const creator = Keypair.generate().publicKey;
const id = 1_791_796_133_256n;
const ix = HuntInstructions.forNew(creator, id, DEVNET.validator);
const { hunt, board, treasure, vault } = ix.addresses;
const pda = (seeds: (Buffer | Uint8Array)[], programId = PROGRAM_ID) => PublicKey.findProgramAddressSync(seeds, programId)[0];

function same(mine: TransactionInstruction, reference: TransactionInstruction): void {
  expect(mine.programId.equals(reference.programId)).toBe(true);
  expect(Buffer.from(mine.data).toString('hex')).toBe(Buffer.from(reference.data).toString('hex'));
  expect(mine.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual(
    reference.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
  );
}

describe('addresses', () => {
  it('derives the program accounts from their seeds', () => {
    const idBytes = Buffer.alloc(8);
    idBytes.writeBigUInt64LE(id);
    expect(hunt.equals(pda([Buffer.from('hunt'), creator.toBuffer(), idBytes]))).toBe(true);
    expect(huntAddress(creator, Number(id)).equals(hunt)).toBe(true);
    expect(board.equals(pda([Buffer.from('board'), hunt.toBuffer()]))).toBe(true);
    expect(treasure.equals(pda([Buffer.from('treasure'), hunt.toBuffer()]))).toBe(true);
    expect(vault.equals(pda([Buffer.from('vault'), hunt.toBuffer()]))).toBe(true);
    expect(boardAddress(hunt).equals(board)).toBe(true);
    expect(treasureAddress(hunt).equals(treasure)).toBe(true);
    expect(vaultAddress(hunt).equals(vault)).toBe(true);
    const owner = Keypair.generate().publicKey;
    expect(logbookAddress(hunt, owner).equals(pda([Buffer.from('logbook'), hunt.toBuffer(), owner.toBuffer()]))).toBe(true);
  });

  it('agrees with the MagicBlock SDK on every rollup address', () => {
    expect(DELEGATION_PROGRAM_ID.equals(MB_DELEGATION)).toBe(true);
    expect(MAGIC_PROGRAM_ID.equals(MB_MAGIC_PROGRAM)).toBe(true);
    expect(MAGIC_CONTEXT_ID.equals(MB_MAGIC_CONTEXT)).toBe(true);
    expect(PERMISSION_PROGRAM_ID.equals(MB_PERMISSION)).toBe(true);
    expect(EPHEMERAL_VAULT_ID.equals(MB_EPHEMERAL_VAULT)).toBe(true);
    for (const account of [hunt, board, treasure]) {
      expect(delegationRecordAddress(account).equals(delegationRecordPdaFromDelegatedAccount(account))).toBe(true);
      expect(delegationMetadataAddress(account).equals(delegationMetadataPdaFromDelegatedAccount(account))).toBe(true);
      expect(delegateBufferAddress(account).equals(delegateBufferPdaFromDelegatedAccountAndOwnerProgram(account, PROGRAM_ID))).toBe(true);
      expect(permissionAddress(account).equals(permissionPdaFromAccount(account))).toBe(true);
    }
    expect(actionEscrowAddress(hunt).equals(escrowPdaFromEscrowAuthority(hunt))).toBe(true);
    expect(magicFeeVaultAddress(DEVNET.validator).equals(magicFeeVaultPdaFromValidator(DEVNET.validator))).toBe(true);
    expect(crankAddress(hunt).equals(pda([Buffer.from('crank'), hunt.toBuffer(), hunt.toBuffer()], HYDRA_EPHEMERAL_ID))).toBe(true);
  });
});

describe('instructions match the Anchor client', () => {
  const m = program.methods;
  const operator = Keypair.generate().publicKey;
  const player = Keypair.generate().publicKey;
  const logbook = logbookAddress(hunt, player);
  const delegation = (suffix: string, account: PublicKey) => ({
    [`buffer${suffix}`]: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(account, PROGRAM_ID),
    [`delegationRecord${suffix}`]: delegationRecordPdaFromDelegatedAccount(account),
    [`delegationMetadata${suffix}`]: delegationMetadataPdaFromDelegatedAccount(account),
  });
  const permission = { permissionProgram: MB_PERMISSION, ephemeralVault: MB_EPHEMERAL_VAULT, magicProgram: MB_MAGIC_PROGRAM };
  const feeVault = magicFeeVaultPdaFromValidator(DEVNET.validator);
  const tickAccounts = {
    hunt,
    treasure,
    vault,
    magicFeeVault: feeVault,
    program: PROGRAM_ID,
    magicProgram: MB_MAGIC_PROGRAM,
    magicContext: MB_MAGIC_CONTEXT,
  };

  it('create_hunt', async () => {
    const params = {
      mode: HuntMode.Author,
      validator: DEVNET.validator,
      entryFee: 10_000_000,
      prizeSeed: 50_000_000,
      creatorBps: 1_000,
      maxPlayers: 8,
      speedKms: 800,
      startsAt: 1_791_000_000,
      deadline: 1_791_001_200,
      zoneIntervalSecs: 60,
      opsLamports: 20_000_000,
      title: 'Lost city',
      clue: 'Where the condor nests',
    };
    const reference = await m
      .createHunt!(new BN(id.toString()), {
        ...params,
        mode: { author: {} },
        entryFee: new BN(params.entryFee),
        prizeSeed: new BN(params.prizeSeed),
        startsAt: new BN(params.startsAt),
        deadline: new BN(params.deadline),
        opsLamports: new BN(params.opsLamports),
      })
      .accountsPartial({
        creator,
        hunt,
        board,
        treasure,
        vault,
        actionEscrow: escrowPdaFromEscrowAuthority(hunt),
        delegationProgram: MB_DELEGATION,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    same(ix.createHunt(id, params), reference);
  });

  it('delegate_hunt and join', async () => {
    same(
      ix.delegateHunt(id),
      await m
        .delegateHunt!(new BN(id.toString()))
        .accountsPartial({
          creator,
          hunt,
          board,
          treasure,
          ...delegation('Hunt', hunt),
          ...delegation('Board', board),
          ...delegation('Treasure', treasure),
          ownerProgram: PROGRAM_ID,
          delegationProgram: MB_DELEGATION,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    );
    same(
      ix.join(player, operator),
      await m
        .join!(operator)
        .accountsPartial({
          player,
          hunt,
          vault,
          logbook,
          ...delegation('Logbook', logbook),
          ownerProgram: PROGRAM_ID,
          delegationProgram: MB_DELEGATION,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    );
  });

  it('settle and the closing instructions', async () => {
    same(
      ix.settle(player),
      await m
        .settle!()
        .accountsPartial({ hunt, vault, payee: player, creator, escrowAuth: hunt, escrow: escrowPdaFromEscrowAuthority(hunt) })
        .instruction(),
    );
    same(ix.closeLogbook(player), await m.closeLogbook!().accountsPartial({ hunt, logbook, owner: player }).instruction());
    same(ix.closeBoard(), await m.closeBoard!().accountsPartial({ hunt, board, creator }).instruction());
    same(ix.closeTreasure(), await m.closeTreasure!().accountsPartial({ hunt, treasure, creator }).instruction());
  });

  it('delegate_hunt_sealed and seal_from_action', async () => {
    const location = fromLatLon(-22.9519, -43.2105);
    const salt = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    same(
      ix.sealFromAction(location, salt),
      await m
        .sealFromAction!([...location], Array.from(salt))
        .accountsPartial({ creator, hunt, treasure, treasurePermission: permissionPdaFromAccount(treasure), ...permission })
        .instruction(),
    );
    const actions = Uint8Array.from({ length: 300 }, (_, i) => (i * 7) & 0xff);
    same(
      ix.delegateHuntSealed(id, actions),
      await m
        .delegateHuntSealed!(new BN(id.toString()), Buffer.from(actions))
        .accountsPartial({
          creator,
          hunt,
          board,
          treasure,
          ...delegation('Hunt', hunt),
          ...delegation('Board', board),
          ...delegation('Treasure', treasure),
          ownerProgram: PROGRAM_ID,
          delegationProgram: MB_DELEGATION,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    );
  });

  it('open_hunt, seal_from_author and arm', async () => {
    same(
      ix.openHunt(),
      await m
        .openHunt!()
        .accountsPartial({
          creator,
          hunt,
          treasure,
          treasurePermission: permissionPdaFromAccount(treasure),
          ...permission,
          oracleQueue: VRF_EPHEMERAL_QUEUE,
          programIdentity: pda([Buffer.from('identity')]),
          vrfProgram: VRF_PROGRAM_ID,
          slotHashes: SYSVAR_SLOT_HASHES_ID,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    );
    const location = fromLatLon(-13.1631, -72.545);
    const salt = Uint8Array.from({ length: 32 }, (_, i) => i * 7);
    same(
      ix.sealFromAuthor(location, salt),
      await m.sealFromAuthor!([...location], Array.from(salt)).accountsPartial({ creator, hunt, treasure }).instruction(),
    );
    same(
      ix.arm(operator),
      await m
        .arm!()
        .accountsPartial({ payer: operator, hunt, treasure, magicFeeVault: feeVault, magicProgram: MB_MAGIC_PROGRAM, magicContext: MB_MAGIC_CONTEXT })
        .instruction(),
    );
  });

  it('embark, set_course and probe', async () => {
    const start = fromLatLon(48.85, 2.35);
    same(
      ix.embark(operator, player, start),
      await m
        .embark!([...start])
        .accountsPartial({ pilot: operator, hunt, board, logbook, logbookPermission: permissionPdaFromAccount(logbook), ...permission })
        .instruction(),
    );
    const dest = fromLatLon(-33.87, 151.21);
    same(
      ix.setCourse(operator, player, dest),
      await m.setCourse!([...dest]).accountsPartial({ pilot: operator, hunt, board, logbook }).instruction(),
    );
    same(
      ix.probe(operator, player),
      await m.probe!().accountsPartial({ pilot: operator, hunt, board, treasure, logbook }).instruction(),
    );
  });

  it('tick, finalize and the schedulers', async () => {
    same(ix.tick(), await m.tick!().accountsPartial(tickAccounts).instruction());
    same(ix.finalize(), await m.finalize!().accountsPartial(tickAccounts).instruction());
    same(
      ix.scheduleTick(operator, 40),
      await m
        .scheduleTick!(40)
        .accountsPartial({
          payer: operator,
          hunt,
          crank: crankAddress(hunt),
          ephemeralVault: MB_EPHEMERAL_VAULT,
          magicProgram: MB_MAGIC_PROGRAM,
          hydraProgram: HYDRA_EPHEMERAL_ID,
        })
        .instruction(),
    );
    same(
      ix.scheduleTickLegacy(operator, 77n, 2_000),
      await m.scheduleTickLegacy!(new BN(77), new BN(2_000)).accountsPartial({ payer: operator, ...tickAccounts }).instruction(),
    );
  });

  it('the audit openers and the releases', async () => {
    same(
      ix.openTreasure(),
      await m.openTreasure!().accountsPartial({ treasure, treasurePermission: permissionPdaFromAccount(treasure), ...permission }).instruction(),
    );
    same(
      ix.openLogbook(player),
      await m
        .openLogbook!()
        .accountsPartial({ treasure, logbook, logbookPermission: permissionPdaFromAccount(logbook), ...permission })
        .instruction(),
    );
    same(
      ix.releaseLogbook(operator, player),
      await m
        .releaseLogbook!()
        .accountsPartial({ payer: operator, treasure, logbook, magicProgram: MB_MAGIC_PROGRAM, magicContext: MB_MAGIC_CONTEXT })
        .instruction(),
    );
    same(
      ix.releaseBoard(operator),
      await m
        .releaseBoard!()
        .accountsPartial({ payer: operator, treasure, board, magicProgram: MB_MAGIC_PROGRAM, magicContext: MB_MAGIC_CONTEXT })
        .instruction(),
    );
  });

  it('names a missing account', () => {
    expect(() => buildInstruction('probe', { pilot: operator })).toThrow(/missing account hunt/);
  });
});
