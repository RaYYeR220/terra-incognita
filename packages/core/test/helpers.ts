import { createHash } from 'node:crypto';

import { fromLatLon } from '../src/index.js';
import type { Vec3 } from '../src/index.js';

/** Small deterministic generator for test inputs. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomBytes(rand: () => number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) out[i] = Math.floor(rand() * 256);
  return out;
}

/** Uniformly distributed point on the sphere. */
export function randomPoint(rand: () => number): Vec3 {
  const lat = (Math.asin(2 * rand() - 1) * 180) / Math.PI;
  const lon = 360 * rand() - 180;
  return fromLatLon(lat, lon);
}

/** sha256 from Node's crypto module, independent of the library the package uses. */
export function nodeSha256(...parts: Uint8Array[]): Uint8Array {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return new Uint8Array(hash.digest());
}
