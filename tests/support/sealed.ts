import { blake2b } from "@noble/hashes/blake2b";
import { edwardsToMontgomeryPriv, edwardsToMontgomeryPub } from "@noble/curves/ed25519";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import nacl from "tweetnacl";

// Post-delegation actions whose instruction arguments only the validator can read.
//
// The delegation program stores the actions in the delegation record on Solana; the validator
// decrypts and runs them inside the rollup right after it takes the account over. Encryption
// is a libsodium sealed box to the validator identity's X25519 key: an ephemeral key pair,
// nonce = BLAKE2b-192(ephemeral public ‖ recipient public), XSalsa20-Poly1305, and the
// ephemeral public key prepended to the box.

const SIGNER = 0b0100_0000;
const WRITABLE = 0b1000_0000;
const MAX_KEYS = 64;

/** Sealed box of `plaintext` to the X25519 counterpart of an Ed25519 public key. */
export function sealTo(recipient: PublicKey, plaintext: Uint8Array): Uint8Array {
  const recipientX = edwardsToMontgomeryPub(recipient.toBytes());
  const ephemeral = nacl.box.keyPair();
  const nonce = blake2b(concat(ephemeral.publicKey, recipientX), { dkLen: 24 });
  return concat(ephemeral.publicKey, nacl.box(plaintext, nonce, recipientX, ephemeral.secretKey));
}

/** Opens a sealed box with the Ed25519 secret key of the recipient. Used to test `sealTo`. */
export function openSealed(recipientSecret: Uint8Array, sealed: Uint8Array): Uint8Array | null {
  const secretX = edwardsToMontgomeryPriv(recipientSecret.slice(0, 32));
  const publicX = nacl.scalarMult.base(secretX);
  const ephemeral = sealed.slice(0, 32);
  const nonce = blake2b(concat(ephemeral, publicX), { dkLen: 24 });
  return nacl.box.open(sealed.slice(32), nonce, ephemeral, secretX);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

class Writer {
  private chunks: Uint8Array[] = [];
  u8(value: number) {
    this.chunks.push(Uint8Array.of(value));
  }
  u32(value: number) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(value);
    this.chunks.push(b);
  }
  bytes(value: Uint8Array) {
    this.u32(value.length);
    this.chunks.push(value);
  }
  raw(value: Uint8Array) {
    this.chunks.push(value);
  }
  done(): Uint8Array {
    return concat(...this.chunks);
  }
}

/**
 * Borsh encoding of the delegation program's `PostDelegationActions` for `instructions`.
 *
 * Program ids and account lists stay readable; each instruction's data is split at
 * `clearPrefix` bytes and everything after it is sealed to `validator`.
 */
export function encryptedActions(
  instructions: TransactionInstruction[],
  validator: PublicKey,
  clearPrefix = 8,
): Uint8Array {
  const signers: PublicKey[] = [];
  const others: PublicKey[] = [];
  const has = (list: PublicKey[], key: PublicKey) => list.some((k) => k.equals(key));

  for (const ix of instructions) {
    for (const meta of ix.keys) {
      if (meta.isSigner && !has(signers, meta.pubkey)) signers.push(meta.pubkey);
    }
  }
  for (const ix of instructions) {
    if (!has(others, ix.programId) && !has(signers, ix.programId)) others.push(ix.programId);
    for (const meta of ix.keys) {
      if (!meta.isSigner && !has(signers, meta.pubkey) && !has(others, meta.pubkey)) {
        others.push(meta.pubkey);
      }
    }
  }
  if (signers.length + others.length > MAX_KEYS) throw new Error("too many accounts");
  const indexOf = (key: PublicKey) => {
    const s = signers.findIndex((k) => k.equals(key));
    return s >= 0 ? s : signers.length + others.findIndex((k) => k.equals(key));
  };

  const w = new Writer();
  w.u8(0); // inserted signers
  w.u8(0); // inserted non-signers
  w.u32(signers.length);
  signers.forEach((key) => w.raw(key.toBytes()));
  w.u32(others.length);
  for (const key of others) {
    w.u8(0); // clear text
    w.raw(key.toBytes());
  }
  w.u32(instructions.length);
  for (const ix of instructions) {
    w.u8(indexOf(ix.programId));
    w.u32(ix.keys.length);
    for (const meta of ix.keys) {
      w.u8(0); // clear text
      w.u8(indexOf(meta.pubkey) | (meta.isSigner ? SIGNER : 0) | (meta.isWritable ? WRITABLE : 0));
    }
    const data = Uint8Array.from(ix.data);
    w.bytes(data.slice(0, clearPrefix));
    w.bytes(data.length > clearPrefix ? sealTo(validator, data.slice(clearPrefix)) : new Uint8Array());
  }
  return w.done();
}

/** Byte ranges of each instruction's encrypted data in an encoded actions payload. */
function encryptedRanges(payload: Uint8Array): { start: number; end: number }[] {
  const view = Buffer.from(payload);
  let at = 2;
  const vecLen = () => {
    const n = view.readUInt32LE(at);
    at += 4;
    return n;
  };
  const skipVec = () => {
    const n = vecLen();
    at += n;
  };
  const signers = vecLen();
  at += 32 * signers;
  for (let i = vecLen(); i > 0; i--) {
    if (view[at++] === 0) at += 32;
    else skipVec();
  }
  const ranges: { start: number; end: number }[] = [];
  for (let i = vecLen(); i > 0; i--) {
    at += 1;
    for (let j = vecLen(); j > 0; j--) {
      if (view[at++] === 0) at += 1;
      else skipVec();
    }
    skipVec();
    const start = at;
    skipVec();
    ranges.push({ start, end: at });
  }
  return ranges;
}

/** The encrypted suffix (length-prefixed) of the first instruction of a payload. */
export function encryptedSuffix(payload: Uint8Array): Uint8Array {
  const { start, end } = encryptedRanges(payload)[0];
  return payload.slice(start, end);
}

/** `payload` with the encrypted suffix of its first instruction replaced by `suffix`. */
export function withEncryptedSuffix(payload: Uint8Array, suffix: Uint8Array): Uint8Array {
  const { start, end } = encryptedRanges(payload)[0];
  return concat(payload.slice(0, start), suffix, payload.slice(end));
}
