import { edwardsToMontgomeryPriv, edwardsToMontgomeryPub } from '@noble/curves/ed25519';
import { blake2b } from '@noble/hashes/blake2.js';
import type { PublicKey, TransactionInstruction } from '@solana/web3.js';
import nacl from 'tweetnacl';

import { Writer } from './codec.js';

// Post-delegation actions whose instruction arguments only the validator can read.
//
// The delegation program stores the actions in the delegation record on Solana; the validator
// decrypts and runs them inside the rollup right after it takes the account over. Encryption is
// a libsodium sealed box to the X25519 form of the validator's identity key: an ephemeral key
// pair, nonce = BLAKE2b-192(ephemeral public ‖ recipient public), XSalsa20-Poly1305, and the
// ephemeral public key in front of the box.

const SIGNER_FLAG = 0b0100_0000;
const WRITABLE_FLAG = 0b1000_0000;
const MAX_KEYS = 64;

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Sealed box of `plaintext` to the X25519 counterpart of an Ed25519 public key. */
export function sealTo(recipient: PublicKey, plaintext: Uint8Array): Uint8Array {
  const recipientX = edwardsToMontgomeryPub(recipient.toBytes());
  const ephemeral = nacl.box.keyPair();
  const nonce = blake2b(concat(ephemeral.publicKey, recipientX), { dkLen: 24 });
  return concat(ephemeral.publicKey, nacl.box(plaintext, nonce, recipientX, ephemeral.secretKey));
}

/** Opens a sealed box with the recipient's Ed25519 secret key; null if it does not open. */
export function openSealed(recipientSecretKey: Uint8Array, sealed: Uint8Array): Uint8Array | null {
  const secretX = edwardsToMontgomeryPriv(recipientSecretKey.slice(0, 32));
  const publicX = nacl.scalarMult.base(secretX);
  const ephemeral = sealed.slice(0, 32);
  const nonce = blake2b(concat(ephemeral, publicX), { dkLen: 24 });
  return nacl.box.open(sealed.slice(32), nonce, ephemeral, secretX);
}

/**
 * Borsh encoding of the delegation program's `PostDelegationActions` for `instructions`.
 *
 * Program ids and account lists stay readable; the data of each instruction is split after
 * `clearPrefix` bytes (the discriminator) and the rest is sealed to `validator`.
 */
export function encryptedActions(instructions: TransactionInstruction[], validator: PublicKey, clearPrefix = 8): Uint8Array {
  const signers: PublicKey[] = [];
  const others: PublicKey[] = [];
  const has = (list: PublicKey[], key: PublicKey) => list.some((k) => k.equals(key));

  for (const ix of instructions) {
    for (const meta of ix.keys) if (meta.isSigner && !has(signers, meta.pubkey)) signers.push(meta.pubkey);
  }
  for (const ix of instructions) {
    if (!has(others, ix.programId) && !has(signers, ix.programId)) others.push(ix.programId);
    for (const meta of ix.keys) {
      if (!meta.isSigner && !has(signers, meta.pubkey) && !has(others, meta.pubkey)) others.push(meta.pubkey);
    }
  }
  if (signers.length + others.length > MAX_KEYS) throw new RangeError('post-delegation actions name too many accounts');
  const indexOf = (key: PublicKey) => {
    const signer = signers.findIndex((k) => k.equals(key));
    return signer >= 0 ? signer : signers.length + others.findIndex((k) => k.equals(key));
  };

  const w = new Writer();
  w.u8(0); // inserted signers
  w.u8(0); // inserted non-signers
  w.u32(signers.length);
  for (const key of signers) w.pubkey(key);
  w.u32(others.length);
  for (const key of others) w.u8(0).pubkey(key); // in clear
  w.u32(instructions.length);
  for (const ix of instructions) {
    w.u8(indexOf(ix.programId));
    w.u32(ix.keys.length);
    for (const meta of ix.keys) {
      w.u8(0).u8(indexOf(meta.pubkey) | (meta.isSigner ? SIGNER_FLAG : 0) | (meta.isWritable ? WRITABLE_FLAG : 0));
    }
    const data = Uint8Array.from(ix.data);
    const clear = data.slice(0, clearPrefix);
    const sealed = data.length > clearPrefix ? sealTo(validator, data.slice(clearPrefix)) : new Uint8Array();
    w.u32(clear.length).bytes(clear);
    w.u32(sealed.length).bytes(sealed);
  }
  return w.finish();
}
