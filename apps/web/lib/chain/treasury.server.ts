import 'server-only';

import { Keypair } from '@solana/web3.js';
import { TerraClient } from '@terra-incognita/sdk';
import bs58 from 'bs58';

import { networkOptions } from './client';

let cached: Keypair | null | undefined;

/** The key that funds guests and creates demo hunts. Read from TERRA_TREASURY_KEY, never from the repo. */
export function treasury(): Keypair | null {
  if (cached !== undefined) return cached;
  const raw = process.env.TERRA_TREASURY_KEY?.trim();
  if (!raw) return (cached = null);
  try {
    const bytes = raw.startsWith('[') ? Uint8Array.from(JSON.parse(raw) as number[]) : bs58.decode(raw);
    cached = Keypair.fromSecretKey(bytes);
  } catch {
    cached = null;
  }
  return cached;
}

let client: TerraClient | null = null;

export function serverClient(): TerraClient {
  client ??= new TerraClient(networkOptions());
  return client;
}
