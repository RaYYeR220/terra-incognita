import { readFileSync } from 'node:fs';

import { Program } from '@coral-xyz/anchor';
import type { Idl, Provider } from '@coral-xyz/anchor';
import { Connection } from '@solana/web3.js';

/** The program as Anchor's own client sees it, as a reference for the hand-written codecs. */
export function anchorProgram(): Program {
  const idl = JSON.parse(readFileSync(new URL('../idl/terra_incognita.json', import.meta.url), 'utf8')) as Idl;
  const provider = { connection: new Connection('http://127.0.0.1:1') } as Provider;
  return new Program(idl, provider);
}
