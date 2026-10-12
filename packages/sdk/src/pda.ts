import { PublicKey } from '@solana/web3.js';

import {
  DELEGATION_PROGRAM_ID,
  HYDRA_EPHEMERAL_ID,
  PERMISSION_PROGRAM_ID,
  PROGRAM_ID,
  SEEDS,
} from './constants.js';

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

function u64le(value: bigint | number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
}

function find(seeds: Uint8Array[], programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

export function huntAddress(creator: PublicKey, id: bigint | number, programId = PROGRAM_ID): PublicKey {
  return find([text(SEEDS.hunt), creator.toBytes(), u64le(id)], programId);
}

export function boardAddress(hunt: PublicKey, programId = PROGRAM_ID): PublicKey {
  return find([text(SEEDS.board), hunt.toBytes()], programId);
}

export function treasureAddress(hunt: PublicKey, programId = PROGRAM_ID): PublicKey {
  return find([text(SEEDS.treasure), hunt.toBytes()], programId);
}

export function vaultAddress(hunt: PublicKey, programId = PROGRAM_ID): PublicKey {
  return find([text(SEEDS.vault), hunt.toBytes()], programId);
}

export function logbookAddress(hunt: PublicKey, owner: PublicKey, programId = PROGRAM_ID): PublicKey {
  return find([text(SEEDS.logbook), hunt.toBytes(), owner.toBytes()], programId);
}

/** Identity the program signs VRF requests with. */
export function programIdentityAddress(programId = PROGRAM_ID): PublicKey {
  return find([text('identity')], programId);
}

/** Access-control record that makes an account private inside the rollup. */
export function permissionAddress(account: PublicKey): PublicKey {
  return find([text('permission:'), account.toBytes()], PERMISSION_PROGRAM_ID);
}

export function delegationRecordAddress(account: PublicKey): PublicKey {
  return find([text('delegation'), account.toBytes()], DELEGATION_PROGRAM_ID);
}

export function delegationMetadataAddress(account: PublicKey): PublicKey {
  return find([text('delegation-metadata'), account.toBytes()], DELEGATION_PROGRAM_ID);
}

export function delegateBufferAddress(account: PublicKey, ownerProgram = PROGRAM_ID): PublicKey {
  return find([text('buffer'), account.toBytes()], ownerProgram);
}

/** Escrow at the delegation program that pays for actions scheduled by `authority`. */
export function actionEscrowAddress(authority: PublicKey, index = 255): PublicKey {
  return find([text('balance'), authority.toBytes(), Uint8Array.of(index)], DELEGATION_PROGRAM_ID);
}

export function magicFeeVaultAddress(validator: PublicKey): PublicKey {
  return find([text('magic-fee-vault'), validator.toBytes()], DELEGATION_PROGRAM_ID);
}

/** Hydra crank that runs the hunt's scheduled `tick`. */
export function crankAddress(hunt: PublicKey): PublicKey {
  return find([text('crank'), hunt.toBytes(), hunt.toBytes()], HYDRA_EPHEMERAL_ID);
}

/** Every address that belongs to one hunt. */
export interface HuntAddresses {
  hunt: PublicKey;
  board: PublicKey;
  treasure: PublicKey;
  vault: PublicKey;
  treasurePermission: PublicKey;
  actionEscrow: PublicKey;
  crank: PublicKey;
}

export function huntAddresses(hunt: PublicKey, programId = PROGRAM_ID): HuntAddresses {
  const treasure = treasureAddress(hunt, programId);
  return {
    hunt,
    board: boardAddress(hunt, programId),
    treasure,
    vault: vaultAddress(hunt, programId),
    treasurePermission: permissionAddress(treasure),
    actionEscrow: actionEscrowAddress(hunt),
    crank: crankAddress(hunt),
  };
}
