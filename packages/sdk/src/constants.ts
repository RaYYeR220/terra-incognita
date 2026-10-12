import { PublicKey } from '@solana/web3.js';

import { PROGRAM_INTERFACE } from './program-interface.js';

export const PROGRAM_ID = new PublicKey(PROGRAM_INTERFACE.address);

export const DELEGATION_PROGRAM_ID = new PublicKey('DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh');
export const MAGIC_PROGRAM_ID = new PublicKey('Magic11111111111111111111111111111111111111');
export const MAGIC_CONTEXT_ID = new PublicKey('MagicContext1111111111111111111111111111111');
export const PERMISSION_PROGRAM_ID = new PublicKey('ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1');
export const EPHEMERAL_VAULT_ID = new PublicKey('MagicVau1t999999999999999999999999999999999');
export const VRF_PROGRAM_ID = new PublicKey('Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz');
export const VRF_EPHEMERAL_QUEUE = new PublicKey('5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc');
/** Hydra scheduler deployed inside ephemeral rollups. */
export const HYDRA_EPHEMERAL_ID = new PublicKey('eHyd5BU8QffvHi4GnXwxrK4WpS7pM2x9UGKHBWii7mf');
export const SYSVAR_SLOT_HASHES_ID = new PublicKey('SysvarS1otHashes111111111111111111111111111');
export const SYSVAR_CLOCK_ID = new PublicKey('SysvarC1ock11111111111111111111111111111111');
export const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111');

export const SEEDS = {
  hunt: 'hunt',
  board: 'board',
  treasure: 'treasure',
  logbook: 'logbook',
  vault: 'vault',
} as const;

/** Program limits, mirrored from the program's state module. */
export const LIMITS = {
  maxPlayers: 64,
  maxProbes: 64,
  pinRing: 128,
  maxTitleBytes: 48,
  maxClueBytes: 200,
  maxCreatorBps: 2_000,
  probeCooldownSecs: 3,
  /** The deadline must be at least this long after the later of the start and the creation. */
  minPlaySecs: 120,
  /** The start may be at most this far in the future. */
  maxStartDelaySecs: 7 * 86_400,
  maxDurationSecs: 30 * 86_400,
  vrfRetrySecs: 60,
  minOpsLamports: 5_000_000,
  actionEscrowLamports: 200_000,
} as const;

/** Compute limits that the instructions are known to fit in. */
export const COMPUTE_UNITS = {
  createHunt: 400_000,
  delegateHunt: 600_000,
  delegateHuntSealed: 800_000,
  join: 300_000,
  openHunt: 400_000,
  arm: 400_000,
  embark: 300_000,
  tick: 400_000,
  finalize: 400_000,
  release: 300_000,
} as const;

export interface NetworkConfig {
  /** Solana RPC (HTTP). */
  baseRpc: string;
  /** Solana websocket endpoint. Derived from `baseRpc` when absent. */
  baseWs?: string;
  /** Private ephemeral rollup RPC, without a token. */
  rollupRpc: string;
  rollupWs?: string;
  /** Magic router, used to ask whether an account is delegated. */
  routerRpc: string;
  /** Rollup validator the hunts delegate to. */
  validator: PublicKey;
  /** Cluster name for explorer links. */
  cluster: 'devnet' | 'mainnet-beta' | 'localnet';
}

export const DEVNET: NetworkConfig = {
  baseRpc: 'https://rpc.magicblock.app/devnet',
  rollupRpc: 'https://devnet-tee.magicblock.app',
  routerRpc: 'https://devnet-router.magicblock.app/',
  validator: new PublicKey('MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo'),
  cluster: 'devnet',
};

export function explorerTx(signature: string, cluster: NetworkConfig['cluster'] = 'devnet'): string {
  return `https://explorer.solana.com/tx/${signature}${cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`}`;
}

export function explorerAddress(address: PublicKey | string, cluster: NetworkConfig['cluster'] = 'devnet'): string {
  return `https://explorer.solana.com/address/${address.toString()}${cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`}`;
}
