import { PublicKey } from '@solana/web3.js';
import type { Vec3 } from '@terra-incognita/core';

/** Little-endian reader for Borsh and plain `repr(C)` account data. */
export class Reader {
  private readonly view: DataView;
  offset: number;

  constructor(
    private readonly data: Uint8Array,
    offset = 0,
  ) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.offset = offset;
  }

  private take(length: number): number {
    const at = this.offset;
    if (at + length > this.data.length) {
      throw new RangeError(`account data ends at ${this.data.length}, needed ${at + length}`);
    }
    this.offset += length;
    return at;
  }

  u8(): number {
    return this.view.getUint8(this.take(1));
  }

  bool(): boolean {
    return this.u8() !== 0;
  }

  u16(): number {
    return this.view.getUint16(this.take(2), true);
  }

  u32(): number {
    return this.view.getUint32(this.take(4), true);
  }

  i32(): number {
    return this.view.getInt32(this.take(4), true);
  }

  u64(): bigint {
    return this.view.getBigUint64(this.take(8), true);
  }

  i64(): bigint {
    return this.view.getBigInt64(this.take(8), true);
  }

  /** An integer that is known to stay below 2^53, such as lamports or unix seconds. */
  u64n(): number {
    return Number(this.u64());
  }

  i64n(): number {
    return Number(this.i64());
  }

  bytes(length: number): Uint8Array {
    const at = this.take(length);
    return this.data.slice(at, at + length);
  }

  pubkey(): PublicKey {
    return new PublicKey(this.bytes(32));
  }

  vec3(): Vec3 {
    return [this.i32(), this.i32(), this.i32()];
  }

  string(): string {
    const length = this.u32();
    return new TextDecoder().decode(this.bytes(length));
  }

  skip(length: number): void {
    this.take(length);
  }
}

/** Little-endian Borsh writer for instruction arguments. */
export class Writer {
  private chunks: Uint8Array[] = [];

  private push(length: number, write: (view: DataView) => void): this {
    const chunk = new Uint8Array(length);
    write(new DataView(chunk.buffer));
    this.chunks.push(chunk);
    return this;
  }

  u8(value: number): this {
    return this.push(1, (view) => view.setUint8(0, value));
  }

  bool(value: boolean): this {
    return this.u8(value ? 1 : 0);
  }

  u16(value: number): this {
    return this.push(2, (view) => view.setUint16(0, value, true));
  }

  u32(value: number): this {
    return this.push(4, (view) => view.setUint32(0, value, true));
  }

  i32(value: number): this {
    return this.push(4, (view) => view.setInt32(0, value, true));
  }

  u64(value: bigint | number): this {
    return this.push(8, (view) => view.setBigUint64(0, BigInt(value), true));
  }

  i64(value: bigint | number): this {
    return this.push(8, (view) => view.setBigInt64(0, BigInt(value), true));
  }

  bytes(value: Uint8Array): this {
    this.chunks.push(Uint8Array.from(value));
    return this;
  }

  fixed(value: Uint8Array, length: number): this {
    if (value.length !== length) throw new RangeError(`expected ${length} bytes, got ${value.length}`);
    return this.bytes(value);
  }

  pubkey(value: PublicKey): this {
    return this.bytes(value.toBytes());
  }

  vec3(value: Vec3): this {
    return this.i32(value[0]).i32(value[1]).i32(value[2]);
  }

  string(value: string): this {
    const encoded = new TextEncoder().encode(value);
    return this.u32(encoded.length).bytes(encoded);
  }

  finish(): Uint8Array {
    let length = 0;
    for (const chunk of this.chunks) length += chunk.length;
    const out = new Uint8Array(length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let out = '';
  while (value > 0n) {
    out = BASE58[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}
