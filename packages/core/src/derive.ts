import { sha256 } from '@noble/hashes/sha2.js';

import {
  COMMITMENT_DOMAIN,
  LOCATION_TAG,
  SALT_TAG,
  SCALE,
  SCALE_N,
  UNIT_E18,
  UNIT_SAMPLE_ATTEMPTS,
  UNIT_SAMPLE_MIN_R2,
  ZONE_MARGIN_DEN,
  ZONE_MARGIN_NUM,
  ZONE_SIN_E9,
  ZONE_STAGES,
  ZONE_TAG,
} from './constants.js';
import { normalize } from './geo.js';
import type { Vec3, Zone } from './types.js';

const TWO_31 = 2147483648n;

/** Bytes of an ASCII string. */
function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (ch) => ch.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function expectLength(bytes: Uint8Array, length: number, what: string): void {
  if (bytes.length !== length) {
    throw new RangeError(`${what} must be ${length} bytes, got ${bytes.length}`);
  }
}

/** Maps a little-endian i32 onto [−1e9, 1e9): v · 1e9 / 2³¹, truncated toward zero. */
function coordinate(view: DataView, offset: number): bigint {
  return (BigInt(view.getInt32(offset, true)) * SCALE_N) / TWO_31;
}

/**
 * Rejection-samples a unit vector from a 32-byte digest.
 *
 * The first 12 bytes give a point in the cube [−1e9, 1e9)³. It is accepted when its squared
 * length r² satisfies 1e14 < r² ≤ 1e18 and is then normalised; otherwise the digest is replaced
 * by its own sha256 and the next attempt is made. After `attempts` rejected digests the result
 * is the north pole.
 */
export function sampleUnitVector(digest: Uint8Array, attempts: number): Vec3 {
  expectLength(digest, 32, 'digest');
  let d = digest;
  for (let i = 0; i < attempts; i += 1) {
    const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const x = coordinate(view, 0);
    const y = coordinate(view, 4);
    const z = coordinate(view, 8);
    const r2 = x * x + y * y + z * z;
    if (r2 > UNIT_SAMPLE_MIN_R2 && r2 <= UNIT_E18) {
      return normalize([x * SCALE_N, y * SCALE_N, z * SCALE_N]);
    }
    d = sha256(d);
  }
  return [0, 0, SCALE];
}

/** Pseudo-random unit vector determined by a 32-byte digest. */
export function unitVectorFromDigest(digest: Uint8Array): Vec3 {
  return sampleUnitVector(digest, UNIT_SAMPLE_ATTEMPTS);
}

/** Treasure location: unit vector from sha256(randomness ‖ "loc"). */
export function locationFromRandomness(randomness: Uint8Array): Vec3 {
  return unitVectorFromDigest(sha256(concat(randomness, ascii(LOCATION_TAG))));
}

/** Commitment salt: sha256(randomness ‖ "salt"). */
export function saltFromRandomness(randomness: Uint8Array): Uint8Array {
  return sha256(concat(randomness, ascii(SALT_TAG)));
}

/** Seed of the zone schedule: sha256(randomness ‖ "zone"). */
export function zoneSeedFromRandomness(randomness: Uint8Array): Uint8Array {
  return sha256(concat(randomness, ascii(ZONE_TAG)));
}

/**
 * Centre of the public cap for a stage in 1..8.
 *
 * c = normalize(loc · 1e9 + s · u), where u is the unit vector from sha256(zoneSeed ‖ stage as
 * one byte) and s = ZONE_SIN_E9[stage − 1] · 999 / 1000 (integer division). The displacement is
 * shorter than sin(radius), so the treasure stays strictly inside the cap. Stage 0 has no cap
 * and yields the zero vector.
 */
export function zoneCenter(loc: Vec3, zoneSeed: Uint8Array, stage: number): Vec3 {
  if (!Number.isInteger(stage) || stage < 0 || stage > ZONE_STAGES) {
    throw new RangeError(`zone stage out of range: ${stage}`);
  }
  if (stage === 0) return [0, 0, 0];
  expectLength(zoneSeed, 32, 'zone seed');
  const u = unitVectorFromDigest(sha256(concat(zoneSeed, Uint8Array.of(stage))));
  const s = (BigInt(ZONE_SIN_E9[stage - 1] as number) * ZONE_MARGIN_NUM) / ZONE_MARGIN_DEN;
  return normalize([
    BigInt(loc[0]) * SCALE_N + s * BigInt(u[0]),
    BigInt(loc[1]) * SCALE_N + s * BigInt(u[1]),
    BigInt(loc[2]) * SCALE_N + s * BigInt(u[2]),
  ]);
}

export function zoneAt(loc: Vec3, zoneSeed: Uint8Array, stage: number): Zone {
  return { stage, center: zoneCenter(loc, zoneSeed, stage) };
}

/**
 * The 94 bytes that are hashed into the commitment:
 * "terra-incognita:v1" (18) ‖ hunt key (32) ‖ x, y, z as little-endian i32 (12) ‖ salt (32).
 */
export function commitmentPreimage(hunt: Uint8Array, loc: Vec3, salt: Uint8Array): Uint8Array {
  expectLength(hunt, 32, 'hunt key');
  expectLength(salt, 32, 'salt');
  const coords = new Uint8Array(12);
  const view = new DataView(coords.buffer);
  view.setInt32(0, loc[0], true);
  view.setInt32(4, loc[1], true);
  view.setInt32(8, loc[2], true);
  return concat(ascii(COMMITMENT_DOMAIN), hunt, coords, salt);
}

/** sha256 commitment to a treasure location, published before the hunt goes live. */
export function commitment(hunt: Uint8Array, loc: Vec3, salt: Uint8Array): Uint8Array {
  return sha256(commitmentPreimage(hunt, loc, salt));
}
