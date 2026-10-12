import { describe, expect, it } from 'vitest';

import {
  COMMITMENT_DOMAIN,
  SCALE,
  UNIT_E18,
  ZONE_COS_E18,
  ZONE_STAGES,
  bytesToHex,
  commitment,
  commitmentPreimage,
  dot,
  hexToBytes,
  inZone,
  isUnit,
  isqrt,
  locationFromRandomness,
  saltFromRandomness,
  unitVectorFromDigest,
  zoneAt,
  zoneCenter,
  zoneSeedFromRandomness,
} from '../src/index.js';
import type { Vec3 } from '../src/index.js';
import { sampleUnitVector } from '../src/derive.js';
import { mulberry32, nodeSha256, randomBytes } from './helpers.js';

const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Coordinates of the first sample a digest encodes, written independently of the library. */
function firstSample(digest: Uint8Array): { coords: [bigint, bigint, bigint]; r2: bigint } {
  const coords = [0, 4, 8].map((offset) => {
    const unsigned =
      BigInt(digest[offset]!) |
      (BigInt(digest[offset + 1]!) << 8n) |
      (BigInt(digest[offset + 2]!) << 16n) |
      (BigInt(digest[offset + 3]!) << 24n);
    const signed = unsigned >= 2n ** 31n ? unsigned - 2n ** 32n : unsigned;
    return (signed * 1_000_000_000n) / 2n ** 31n;
  }) as [bigint, bigint, bigint];
  return { coords, r2: coords[0] ** 2n + coords[1] ** 2n + coords[2] ** 2n };
}

function accepted(r2: bigint): boolean {
  return r2 > 100_000_000_000_000n && r2 <= UNIT_E18;
}

describe('unitVectorFromDigest', () => {
  it('returns a valid unit vector for every digest', () => {
    const rand = mulberry32(21);
    for (let i = 0; i < 5000; i += 1) {
      expect(isUnit(unitVectorFromDigest(randomBytes(rand, 32)))).toBe(true);
    }
  });

  it('points along the first accepted sample', () => {
    const rand = mulberry32(22);
    let checked = 0;
    for (let i = 0; i < 400; i += 1) {
      const digest = randomBytes(rand, 32);
      const { coords, r2 } = firstSample(digest);
      if (!accepted(r2)) continue;
      const v = unitVectorFromDigest(digest);
      // Reference: round(c · 1e18 / isqrt(r² · 1e18)), half away from zero.
      const n = isqrt(r2 * UNIT_E18);
      const expected = coords.map((c) => {
        const mag = c < 0n ? -c : c;
        const q = (2n * mag * UNIT_E18 + n) / (2n * n);
        return Number(c < 0n ? -q : q);
      });
      expect(v).toEqual(expected);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(150);
  });

  it('rehashes the digest when the sample falls outside the sphere', () => {
    const rand = mulberry32(23);
    let rehashed = 0;
    for (let i = 0; i < 400; i += 1) {
      const digest = randomBytes(rand, 32);
      if (accepted(firstSample(digest).r2)) continue;
      expect(unitVectorFromDigest(digest)).toEqual(unitVectorFromDigest(nodeSha256(digest)));
      rehashed += 1;
    }
    expect(rehashed).toBeGreaterThan(100);
  });

  it('truncates coordinates toward zero', () => {
    const digest = new Uint8Array(32);
    const view = new DataView(digest.buffer);
    view.setInt32(0, -3, true); // −3e9 / 2³¹ = −1.39 → −1
    view.setInt32(4, 3, true); //   3e9 / 2³¹ =  1.39 →  1
    view.setInt32(8, 1073741824, true); // 2³⁰ → exactly 5e8
    expect(firstSample(digest).coords).toEqual([-1n, 1n, 500_000_000n]);
    expect(unitVectorFromDigest(digest)).toEqual([-2, 2, SCALE]);
  });

  it('accepts a sample exactly on the unit sphere and rejects the far corner', () => {
    const onSphere = new Uint8Array(32);
    new DataView(onSphere.buffer).setInt32(0, -2147483648, true); // (−1e9, 0, 0)
    expect(unitVectorFromDigest(onSphere)).toEqual([-SCALE, 0, 0]);

    const corner = new Uint8Array(32);
    const view = new DataView(corner.buffer);
    for (const offset of [0, 4, 8]) view.setInt32(offset, -2147483648, true);
    expect(accepted(firstSample(corner).r2)).toBe(false);
    expect(unitVectorFromDigest(corner)).toEqual(unitVectorFromDigest(nodeSha256(corner)));
  });

  it('rejects samples too close to the origin', () => {
    // r² must exceed 1e14, i.e. the sample must be more than 1e7 from the origin.
    const edge = new Uint8Array(32);
    new DataView(edge.buffer).setInt32(0, 21474837, true); // → 10_000_000 exactly on the bound
    expect(firstSample(edge).coords[0]).toBe(10_000_000n);
    expect(unitVectorFromDigest(edge)).toEqual(unitVectorFromDigest(nodeSha256(edge)));

    const inside = new Uint8Array(32);
    new DataView(inside.buffer).setInt32(0, 21474840, true); // → 10_000_001
    expect(firstSample(inside).coords[0]).toBe(10_000_001n);
    expect(unitVectorFromDigest(inside)).toEqual([SCALE, 0, 0]);
  });

  it('falls back to the north pole when every attempt is rejected', () => {
    const corner = new Uint8Array(32).fill(0x7f);
    expect(accepted(firstSample(corner).r2)).toBe(false);
    expect(sampleUnitVector(corner, 1)).toEqual([0, 0, SCALE]);
    expect(sampleUnitVector(corner, 0)).toEqual([0, 0, SCALE]);
  });

  it('only reads the first twelve bytes of each digest', () => {
    const rand = mulberry32(24);
    for (let i = 0; i < 200; i += 1) {
      const digest = randomBytes(rand, 32);
      if (!accepted(firstSample(digest).r2)) continue;
      const other = digest.slice();
      other.fill(0xaa, 12);
      expect(unitVectorFromDigest(other)).toEqual(unitVectorFromDigest(digest));
    }
  });

  it('spreads evenly over the sphere', () => {
    const rand = mulberry32(25);
    const n = 20000;
    const sum = [0, 0, 0];
    const octants = new Array<number>(8).fill(0);
    let polar = 0;
    for (let i = 0; i < n; i += 1) {
      const v = unitVectorFromDigest(randomBytes(rand, 32));
      v.forEach((c, axis) => (sum[axis]! += c / SCALE));
      octants[(v[0] < 0 ? 1 : 0) | (v[1] < 0 ? 2 : 0) | (v[2] < 0 ? 4 : 0)]! += 1;
      if (Math.abs(v[2]) > SCALE / 2) polar += 1;
    }
    for (const s of sum) expect(Math.abs(s / n)).toBeLessThan(0.02);
    for (const count of octants) expect(Math.abs(count / n - 1 / 8)).toBeLessThan(0.012);
    // |z| is uniform on [0, 1] for a uniform direction.
    expect(Math.abs(polar / n - 0.5)).toBeLessThan(0.015);
  });

  it('insists on a 32-byte digest', () => {
    expect(() => unitVectorFromDigest(new Uint8Array(31))).toThrow(RangeError);
  });
});

describe('derivations from randomness', () => {
  const r = hexToBytes('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');

  it('hashes the randomness followed by an ASCII tag', () => {
    expect(saltFromRandomness(r)).toEqual(nodeSha256(r, ascii('salt')));
    expect(zoneSeedFromRandomness(r)).toEqual(nodeSha256(r, ascii('zone')));
    expect(locationFromRandomness(r)).toEqual(unitVectorFromDigest(nodeSha256(r, ascii('loc'))));
  });

  it('gives unrelated outputs for the three tags', () => {
    const salt = bytesToHex(saltFromRandomness(r));
    const seed = bytesToHex(zoneSeedFromRandomness(r));
    expect(salt).not.toBe(seed);
    expect(salt).toHaveLength(64);
    expect(seed).toHaveLength(64);
  });

  it('is deterministic and sensitive to every bit', () => {
    const flipped = r.slice();
    flipped[31] = flipped[31]! ^ 1;
    expect(locationFromRandomness(r)).toEqual(locationFromRandomness(r.slice()));
    expect(locationFromRandomness(flipped)).not.toEqual(locationFromRandomness(r));
    expect(bytesToHex(saltFromRandomness(flipped))).not.toBe(bytesToHex(saltFromRandomness(r)));
  });
});

describe('commitment', () => {
  const hunt = hexToBytes('a1'.repeat(32));
  const salt = hexToBytes('5c'.repeat(32));
  const loc: Vec3 = [-123456789, 987654321, 97616771];

  it('hashes domain ‖ hunt ‖ x ‖ y ‖ z ‖ salt', () => {
    const preimage = commitmentPreimage(hunt, loc, salt);
    expect(preimage).toHaveLength(94);
    expect(new TextDecoder().decode(preimage.subarray(0, 18))).toBe('terra-incognita:v1');
    expect(COMMITMENT_DOMAIN).toHaveLength(18);
    expect(preimage.subarray(18, 50)).toEqual(hunt);
    expect(preimage.subarray(62, 94)).toEqual(salt);
    expect(commitment(hunt, loc, salt)).toEqual(nodeSha256(preimage));
  });

  it('encodes coordinates as little-endian two\'s complement i32', () => {
    const preimage = commitmentPreimage(hunt, loc, salt);
    // −123456789 = 0xf8a432eb, 987654321 = 0x3ade68b1, 97616771 = 0x05d18383
    expect(bytesToHex(preimage.subarray(50, 62))).toBe('eb32a4f8' + 'b168de3a' + '8383d105');
  });

  it('matches a digest assembled by hand', () => {
    const manual = nodeSha256(
      ascii('terra-incognita:v1'),
      hunt,
      hexToBytes('eb32a4f8b168de3a8383d105'),
      salt,
    );
    expect(bytesToHex(commitment(hunt, loc, salt))).toBe(bytesToHex(manual));
  });

  it('changes with every input', () => {
    const base = bytesToHex(commitment(hunt, loc, salt));
    const otherHunt = hunt.slice();
    otherHunt[0] = 0;
    const otherSalt = salt.slice();
    otherSalt[31] = 0;
    expect(bytesToHex(commitment(otherHunt, loc, salt))).not.toBe(base);
    expect(bytesToHex(commitment(hunt, loc, otherSalt))).not.toBe(base);
    expect(bytesToHex(commitment(hunt, [loc[0] + 1, loc[1], loc[2]], salt))).not.toBe(base);
    expect(bytesToHex(commitment(hunt, [loc[1], loc[0], loc[2]], salt))).not.toBe(base);
  });

  it('rejects keys and salts of the wrong length', () => {
    expect(() => commitment(new Uint8Array(31), loc, salt)).toThrow(RangeError);
    expect(() => commitment(hunt, loc, new Uint8Array(33))).toThrow(RangeError);
  });
});

describe('zoneCenter', () => {
  it('keeps the treasure inside the cap for thousands of hunts at every stage', () => {
    const rand = mulberry32(31);
    let cases = 0;
    for (let i = 0; i < 2500; i += 1) {
      const r = randomBytes(rand, 32);
      const loc = locationFromRandomness(r);
      const seed = zoneSeedFromRandomness(r);
      for (let stage = 1; stage <= ZONE_STAGES; stage += 1) {
        const center = zoneCenter(loc, seed, stage);
        expect(isUnit(center)).toBe(true);
        expect(dot(loc, center) > ZONE_COS_E18[stage - 1]!).toBe(true);
        expect(inZone(loc, { stage, center })).toBe(true);
        cases += 1;
      }
    }
    expect(cases).toBe(20000);
  });

  it('keeps arbitrary valid locations inside the cap, not only derived ones', () => {
    const rand = mulberry32(32);
    const corners: Vec3[] = [
      [SCALE, 0, 0],
      [0, 0, -SCALE],
      [577350269, 577350269, 577350269],
      [-577350269, 577350270, -577350269],
    ];
    for (let i = 0; i < 1500; i += 1) {
      const seed = randomBytes(rand, 32);
      const loc = i < corners.length ? corners[i]! : unitVectorFromDigest(randomBytes(rand, 32));
      for (let stage = 1; stage <= ZONE_STAGES; stage += 1) {
        expect(inZone(loc, zoneAt(loc, seed, stage))).toBe(true);
      }
    }
  });

  it('does not put the treasure at the centre of the cap', () => {
    const rand = mulberry32(33);
    const n = 600;
    for (let stage = 1; stage <= ZONE_STAGES; stage += 1) {
      const cos = Number(ZONE_COS_E18[stage - 1]) / 1e18;
      let offCentre = 0;
      for (let i = 0; i < n; i += 1) {
        const r = randomBytes(rand, 32);
        const loc = locationFromRandomness(r);
        const d = Number(dot(loc, zoneCenter(loc, zoneSeedFromRandomness(r), stage))) / 1e18;
        // More than a third of the cap radius away from the centre.
        if (Math.acos(Math.min(1, d)) > Math.acos(cos) / 3) offCentre += 1;
      }
      expect(offCentre / n).toBeGreaterThan(0.5);
    }
  });

  it('uses an independent direction per stage', () => {
    const r = hexToBytes('11'.repeat(32));
    const loc = locationFromRandomness(r);
    const seed = zoneSeedFromRandomness(r);
    const centres = new Set<string>();
    for (let stage = 1; stage <= ZONE_STAGES; stage += 1) {
      centres.add(zoneCenter(loc, seed, stage).join(','));
    }
    expect(centres.size).toBe(ZONE_STAGES);
  });

  it('follows the documented formula', () => {
    const r = hexToBytes('2a'.repeat(32));
    const loc = locationFromRandomness(r);
    const seed = zoneSeedFromRandomness(r);
    const stage = 4;
    const u = unitVectorFromDigest(nodeSha256(seed, Uint8Array.of(stage)));
    const s = (422618262n * 999n) / 1000n;
    const v = loc.map((c, i) => BigInt(c) * 1_000_000_000n + s * BigInt(u[i]!));
    const n = isqrt(v[0]! ** 2n + v[1]! ** 2n + v[2]! ** 2n);
    const expected = v.map((c) => {
      const mag = c < 0n ? -c : c;
      const q = (2n * mag * 1_000_000_000n + n) / (2n * n);
      return Number(c < 0n ? -q : q);
    });
    expect(zoneCenter(loc, seed, stage)).toEqual(expected);
  });

  it('has no centre at stage 0 and rejects stages beyond 8', () => {
    const seed = new Uint8Array(32);
    expect(zoneCenter([SCALE, 0, 0], seed, 0)).toEqual([0, 0, 0]);
    expect(() => zoneCenter([SCALE, 0, 0], seed, 9)).toThrow(RangeError);
    expect(() => zoneCenter([SCALE, 0, 0], seed, -1)).toThrow(RangeError);
    expect(() => zoneCenter([SCALE, 0, 0], new Uint8Array(8), 1)).toThrow(RangeError);
  });
});
