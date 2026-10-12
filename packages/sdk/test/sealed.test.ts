import { Keypair, PublicKey } from '@solana/web3.js';
import type { TransactionInstruction } from '@solana/web3.js';
import { fromLatLon } from '@terra-incognita/core';
import { describe, expect, it } from 'vitest';

import { DEVNET, HuntInstructions, PROGRAM_ID, encryptedActions, openSealed, sealTo } from '../src/index.js';

// The helper the program's own devnet tests seal author hunts with. Loaded at run time so that
// it is not type-checked under this package's module settings.
const helper = '../../../tests/support/sealed.ts';
const reference = (await import(/* @vite-ignore */ helper)) as {
  encryptedActions(instructions: TransactionInstruction[], validator: PublicKey, clearPrefix?: number): Uint8Array;
  openSealed(recipientSecret: Uint8Array, sealed: Uint8Array): Uint8Array | null;
};

const validator = Keypair.generate();
const creator = Keypair.generate().publicKey;
const ix = HuntInstructions.forNew(creator, 1_791_800_000_000n, validator.publicKey);
const location = fromLatLon(-22.9519, -43.2105);
const salt = Uint8Array.from({ length: 32 }, (_, i) => 200 - i);
const action = ix.sealFromAction(location, salt);

interface Parsed {
  insertedSigners: number;
  insertedNonSigners: number;
  signers: string[];
  others: { encrypted: number; key: string }[];
  instructions: { program: number; accounts: [number, number][]; clear: Uint8Array; sealed: Uint8Array }[];
  /** The encoding with every sealed box zeroed, so two encodings can be compared byte for byte. */
  masked: Uint8Array;
}

/** Reads the delegation program's `PostDelegationActions` back. */
function parse(bytes: Uint8Array): Parsed {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const masked = Uint8Array.from(bytes);
  let at = 0;
  const u8 = () => bytes[at++] as number;
  const u32 = () => {
    const value = view.getUint32(at, true);
    at += 4;
    return value;
  };
  const take = (length: number) => bytes.slice(at, (at += length));
  const key = () => new PublicKey(take(32)).toBase58();

  const insertedSigners = u8();
  const insertedNonSigners = u8();
  const signers = Array.from({ length: u32() }, key);
  const others = Array.from({ length: u32() }, () => ({ encrypted: u8(), key: key() }));
  const instructions = Array.from({ length: u32() }, () => {
    const program = u8();
    const accounts = Array.from({ length: u32() }, (): [number, number] => [u8(), u8()]);
    const clear = take(u32());
    const length = u32();
    masked.fill(0, at, at + length);
    const sealed = take(length);
    return { program, accounts, clear, sealed };
  });
  expect(at).toBe(bytes.length);
  return { insertedSigners, insertedNonSigners, signers, others, instructions, masked };
}

describe('encrypted post-delegation actions', () => {
  it('encode exactly like the program tests do, apart from the random boxes', () => {
    const mine = encryptedActions([action], validator.publicKey);
    const theirs = reference.encryptedActions([action], validator.publicKey);
    expect(mine.length).toBe(theirs.length);
    const a = parse(mine);
    const b = parse(theirs);
    expect(Buffer.from(a.masked).equals(Buffer.from(b.masked))).toBe(true);
    expect(a.instructions[0]?.sealed).not.toEqual(b.instructions[0]?.sealed);
  });

  it('lay out the seal with the creator as the only signer and the arguments sealed', () => {
    const parsed = parse(encryptedActions([action], validator.publicKey));
    expect(parsed.insertedSigners).toBe(0);
    expect(parsed.insertedNonSigners).toBe(0);
    expect(parsed.signers).toEqual([creator.toBase58()]);
    const keys = [...parsed.signers, ...parsed.others.map((o) => o.key)];
    expect(parsed.others.every((o) => o.encrypted === 0)).toBe(true);
    expect(parsed.others[0]?.key).toBe(PROGRAM_ID.toBase58());

    const [sealed] = parsed.instructions;
    if (!sealed) throw new Error('no instruction');
    expect(keys[sealed.program]).toBe(PROGRAM_ID.toBase58());
    expect(sealed.accounts.map(([, flags]) => keys[flags & 0b0011_1111])).toEqual(action.keys.map((k) => k.pubkey.toBase58()));
    expect(sealed.accounts.map(([, flags]) => [(flags & 0x40) !== 0, (flags & 0x80) !== 0])).toEqual(
      action.keys.map((k) => [k.isSigner, k.isWritable]),
    );
    expect(Array.from(sealed.clear)).toEqual(Array.from(action.data.subarray(0, 8)));
    // 32-byte ephemeral key, 16-byte tag, 12 bytes of location and 32 of salt.
    expect(sealed.sealed.length).toBe(32 + 16 + 12 + 32);
  });

  it('can only be opened by the validator and hold the location and salt', () => {
    const actions = encryptedActions([action], validator.publicKey);
    const box = parse(actions).instructions[0]?.sealed as Uint8Array;
    const expected = Array.from(action.data.subarray(8));
    expect(Array.from(openSealed(validator.secretKey, box) ?? [])).toEqual(expected);
    expect(Array.from(reference.openSealed(validator.secretKey, box) ?? [])).toEqual(expected);
    expect(openSealed(Keypair.generate().secretKey, box)).toBeNull();

    const theirs = parse(reference.encryptedActions([action], validator.publicKey)).instructions[0]?.sealed as Uint8Array;
    expect(Array.from(openSealed(validator.secretKey, theirs) ?? [])).toEqual(expected);

    const contains = (needle: Uint8Array) => Buffer.from(actions).indexOf(Buffer.from(needle)) >= 0;
    expect(contains(action.data.subarray(8, 20))).toBe(false);
    expect(contains(salt)).toBe(false);
  });

  it('round-trips arbitrary payloads', () => {
    for (const length of [0, 1, 44, 300]) {
      const payload = Uint8Array.from({ length }, (_, i) => (i * 31) & 0xff);
      expect(Array.from(openSealed(validator.secretKey, sealTo(validator.publicKey, payload)) ?? [])).toEqual(Array.from(payload));
    }
  });

  it('fit the sealed delegation into one transaction', () => {
    const delegation = HuntInstructions.forNew(creator, 1n, DEVNET.validator).delegateHuntSealed(
      1n,
      encryptedActions([ix.sealFromAction(location, salt)], DEVNET.validator),
    );
    expect(delegation.keys).toHaveLength(16);
    expect(delegation.data.length).toBeLessThan(700);
  });
});
