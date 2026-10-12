import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  BAND_COS_E18,
  bandOf,
  chordE9,
  commitment,
  dot,
  hexToBytes,
  bytesToHex,
  isUnit,
  locationFromRandomness,
  saltFromRandomness,
  travelSecs,
  unitVectorFromDigest,
  zoneCenter,
  zoneSeedFromRandomness,
  ZONE_COS_E18,
} from '../src/index.js';
import { VECTORS_PATH, buildVectors, serialize } from '../scripts/generate-vectors.js';
import type { GeometryVectors } from '../scripts/generate-vectors.js';

const onDisk = readFileSync(VECTORS_PATH, 'utf8');
const vectors = JSON.parse(onDisk) as GeometryVectors;

describe('vectors/geometry.json', () => {
  it('is what the generator produces today', () => {
    expect(onDisk).toBe(serialize(buildVectors()));
  });

  it('carries the threshold table', () => {
    expect(vectors.thresholds).toEqual(BAND_COS_E18.map(String));
    expect(vectors.scale).toBe(1_000_000_000);
    expect(vectors.speedKms).toBe(800);
  });

  it('covers every band threshold exactly and one unit either side', () => {
    const dots = new Set(vectors.bands.map((c) => c.dot));
    for (const threshold of BAND_COS_E18) {
      for (const offset of [-1n, 0n, 1n]) expect(dots.has((threshold + offset).toString())).toBe(true);
    }
    for (const c of vectors.bands) expect(bandOf(BigInt(c.dot))).toBe(c.band);
  });

  it('holds real point pairs on and next to every threshold', () => {
    BAND_COS_E18.forEach((threshold, i) => {
      for (const offset of [-1n, 0n, 1n]) {
        const hits = vectors.pairs.filter((p) => p.dot === (threshold + offset).toString());
        expect(hits.length).toBeGreaterThanOrEqual(2);
        for (const hit of hits) expect(hit.band).toBe(offset < 0n ? i + 1 : i);
      }
    });
  });

  it('has a few hundred pair cases spread over all bands', () => {
    expect(vectors.pairs.length).toBeGreaterThanOrEqual(300);
    for (let band = 0; band <= 7; band += 1) {
      expect(vectors.pairs.filter((p) => p.band === band).length).toBeGreaterThanOrEqual(12);
    }
  });

  it('agrees with the library on every pair', () => {
    for (const c of vectors.pairs) {
      expect(isUnit(c.a)).toBe(true);
      expect(isUnit(c.b)).toBe(true);
      const d = dot(c.a, c.b);
      expect(d.toString()).toBe(c.dot);
      expect(bandOf(d)).toBe(c.band);
      expect(chordE9(d)).toBe(c.chordE9);
      expect(travelSecs(c.a, c.b, vectors.speedKms)).toBe(c.travelSecs);
    }
    for (const c of vectors.travel) {
      expect(travelSecs(c.a, c.b, c.speedKms)).toBe(c.travelSecs);
    }
  });

  it('agrees with the library on unit vectors, including rehashed ones', () => {
    for (const c of vectors.units) {
      expect(unitVectorFromDigest(hexToBytes(c.digest))).toEqual(c.vector);
    }
    const rehashes = vectors.units.map((c) => c.rehashes);
    expect(rehashes.filter((n) => n === 0).length).toBeGreaterThan(10);
    expect(rehashes.filter((n) => n === 1).length).toBeGreaterThan(3);
    expect(Math.max(...rehashes)).toBeGreaterThanOrEqual(3);
  });

  it('agrees with the library on derivations and commitments', () => {
    const hunt = hexToBytes(vectors.hunt);
    expect(vectors.randomness.length).toBeGreaterThanOrEqual(64);
    for (const c of vectors.randomness) {
      const r = hexToBytes(c.randomness);
      expect(locationFromRandomness(r)).toEqual(c.location);
      expect(bytesToHex(saltFromRandomness(r))).toBe(c.salt);
      expect(bytesToHex(zoneSeedFromRandomness(r))).toBe(c.zoneSeed);
      expect(bytesToHex(commitment(hunt, c.location, hexToBytes(c.salt)))).toBe(c.commitment);
    }
  });

  it('agrees with the library on zone centres and keeps the treasure inside', () => {
    expect(vectors.zones.length).toBeGreaterThanOrEqual(8 * 24);
    for (const c of vectors.zones) {
      const center = zoneCenter(c.location, hexToBytes(c.zoneSeed), c.stage);
      expect(center).toEqual(c.center);
      expect(dot(c.location, center).toString()).toBe(c.dot);
      expect(BigInt(c.dot) >= ZONE_COS_E18[c.stage - 1]!).toBe(true);
    }
  });
});
