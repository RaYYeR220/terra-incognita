import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { DEVNET, TerraClient } from '@terra-incognita/sdk';

/** A client for the network named by the environment, devnet by default. */
export function clientFromEnv(): TerraClient {
  return new TerraClient({
    baseRpc: process.env.TERRA_BASE_RPC ?? DEVNET.baseRpc,
    rollupRpc: process.env.TERRA_ROLLUP_RPC ?? DEVNET.rollupRpc,
    routerRpc: process.env.TERRA_ROUTER_RPC ?? DEVNET.routerRpc,
    validator: process.env.TERRA_VALIDATOR ? new PublicKey(process.env.TERRA_VALIDATOR) : DEVNET.validator,
  });
}

export function readKeypair(file: string): Keypair {
  const path = resolve(file.replace(/^~(?=\/)/, homedir()));
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8')) as number[]));
}

export const sol = (lamports: number): string => `${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`;

export const short = (key: string | PublicKey): string => {
  const text = key.toString();
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
};

export function fail(message: string, code = 3): never {
  console.error(message);
  process.exit(code);
}
