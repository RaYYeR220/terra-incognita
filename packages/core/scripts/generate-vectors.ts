/*
 * Writes vectors/geometry.json: reference results of the fixed-point geometry, loaded by the
 * Rust program's tests to prove that both implementations agree bit for bit.
 *
 * Every input comes from a sha256 counter stream over a fixed seed and no floating point is
 * involved, so the file is reproducible on any machine: `npm run vectors`.
 *
 * Encoding
 *   - vectors are [x, y, z] arrays of i32
 *   - 32-byte values are lowercase hex without a prefix
 *   - dot products are decimal strings (they do not fit a JSON number)
 *   - everything else is a plain JSON integer
 *
 * Top-level fields
 *   scale       1e9, the scale of a vector component
 *   speedKms    speed used for `pairs[].travelSecs`
 *   hunt        hunt key used for `randomness[].commitment`
 *   thresholds  the BAND_COS_E18 table, for a sanity check on the loader's side
 *
 * Sections
 *   bands       { dot, band }                             band_of(dot); covers every threshold
 *                                                         exactly and one unit either side
 *   pairs       { a, b, dot, band, chordE9, travelSecs }  dot(a, b), band_of, chord_e9 and
 *                                                         travel_secs at `speedKms`. The first
 *                                                         entries are real point pairs whose dot
 *                                                         product is exactly a threshold or one
 *                                                         unit off (see `note`)
 *   travel      { a, b, speedKms, travelSecs }            travel_secs at other speeds
 *   units       { digest, vector, rehashes }              unit_vector(digest); `rehashes` is the
 *                                                         number of rejected samples before it
 *   randomness  { randomness, location, salt, zoneSeed, commitment }
 *                                                         derivations from VRF randomness and the
 *                                                         commitment for `hunt`
 *   zones       { location, zoneSeed, stage, center, dot } zone_center(location, zoneSeed, stage)
 *                                                         and dot(location, center)
 *
 * `note` fields are informational.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { sha256 } from '@noble/hashes/sha2.js';

import {
  BAND_COS_E18,
  SCALE,
  SCALE_N,
  UNIT_E18,
  UNIT_SAMPLE_ATTEMPTS,
  UNIT_SAMPLE_MIN_R2,
  UNIT_TOLERANCE,
  ZONE_STAGES,
  bandOf,
  bytesToHex,
  chordE9,
  commitment,
  dot,
  isUnit,
  isqrt,
  locationFromRandomness,
  normalize,
  saltFromRandomness,
  travelSecs,
  unitVectorFromDigest,
  zoneCenter,
  zoneSeedFromRandomness,
} from '../src/index.js';
import type { Vec3 } from '../src/index.js';

const SEED = 'terra-incognita:vectors:v1';
const SPEED_KMS = 800;
const RANDOM_PAIRS = 240;
const UNIT_CASES = 64;
const RANDOMNESS_CASES = 64;
const ZONE_LOCATIONS = 24;
const PAIRS_PER_THRESHOLD_OFFSET = 2;

export interface BandCase {
  dot: string;
  band: number;
  note?: string;
}

export interface PairCase {
  a: Vec3;
  b: Vec3;
  dot: string;
  band: number;
  chordE9: number;
  travelSecs: number;
  note?: string;
}

export interface TravelCase {
  a: Vec3;
  b: Vec3;
  speedKms: number;
  travelSecs: number;
}

export interface UnitCase {
  digest: string;
  vector: Vec3;
  rehashes: number;
}

export interface RandomnessCase {
  randomness: string;
  location: Vec3;
  salt: string;
  zoneSeed: string;
  commitment: string;
}

export interface ZoneCase {
  location: Vec3;
  zoneSeed: string;
  stage: number;
  center: Vec3;
  dot: string;
}

export interface GeometryVectors {
  format: 'terra-incognita/geometry';
  version: 1;
  seed: string;
  scale: number;
  speedKms: number;
  hunt: string;
  thresholds: string[];
  bands: BandCase[];
  pairs: PairCase[];
  travel: TravelCase[];
  units: UnitCase[];
  randomness: RandomnessCase[];
  zones: ZoneCase[];
}

/** Deterministic byte stream: block i is sha256(seed ‖ i as u32 LE). */
class Stream {
  private readonly seed: Uint8Array;
  private counter = 0;

  constructor(label: string) {
    this.seed = new TextEncoder().encode(label);
  }

  digest(): Uint8Array {
    const input = new Uint8Array(this.seed.length + 4);
    input.set(this.seed);
    new DataView(input.buffer).setUint32(this.seed.length, this.counter, true);
    this.counter += 1;
    return sha256(input);
  }

  u32(): number {
    return new DataView(this.digest().buffer).getUint32(0, true);
  }

  below(n: number): number {
    return this.u32() % n;
  }

  unit(): Vec3 {
    return unitVectorFromDigest(this.digest());
  }
}

function abs(n: bigint): bigint {
  return n < 0n ? -n : n;
}

/** Extended Euclid: returns [g, s, t] with s·a + t·b = g. */
function egcd(a: bigint, b: bigint): [bigint, bigint, bigint] {
  let [r0, r1] = [a, b];
  let [s0, s1] = [1n, 0n];
  let [t0, t1] = [0n, 1n];
  while (r1 !== 0n) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
    [t0, t1] = [t1, t0 - q * t1];
  }
  return r0 < 0n ? [-r0, -s0, -t0] : [r0, s0, t0];
}

function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
}

const AXIS_ORDERS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
] as const;

/** Applies the same axis permutation and sign flips to both vectors; dot products are unchanged. */
function shuffleAxes(a: Vec3, b: Vec3, stream: Stream): [Vec3, Vec3] {
  const order = AXIS_ORDERS[stream.below(AXIS_ORDERS.length)] as readonly [number, number, number];
  const flips = stream.below(8);
  const apply = (v: Vec3): Vec3 => {
    const out = order.map((axis, i) => {
      const value = v[axis] as number;
      return (flips >> i) & 1 ? -value + 0 : value;
    });
    return [out[0] as number, out[1] as number, out[2] as number];
  };
  return [apply(a), apply(b)];
}

/**
 * Finds two valid unit vectors whose dot product is exactly `target`.
 *
 * With b in the xy-plane and gcd(bx, by) = 1 the equation ax·bx + ay·by = target has integer
 * solutions one |b| apart along a line; one of them falls inside the unit disc for a small share
 * of the candidates b, and az then completes the vector.
 */
function exactPair(target: bigint, stream: Stream): [Vec3, Vec3] {
  for (;;) {
    const seed = stream.unit();
    const b = normalize([BigInt(seed[0]) * SCALE_N, BigInt(seed[1]) * SCALE_N, 0n]);
    const bx = BigInt(b[0]);
    const by = BigInt(b[1]);
    if (!isUnit(b)) continue;
    const [g, s, t] = egcd(bx, by);
    if (g !== 1n) continue;
    const ax0 = s * target;
    const ay0 = t * target;
    const k0 = floorDiv(ay0 * bx - ax0 * by, bx * bx + by * by);
    for (const k of [k0, k0 + 1n]) {
      const ax = ax0 + k * by;
      const ay = ay0 - k * bx;
      const rest = UNIT_E18 - ax * ax - ay * ay;
      if (rest < -UNIT_TOLERANCE) continue;
      let az = rest <= 0n ? 0n : isqrt(rest);
      if (rest > 0n && rest - az * az > az) az += 1n;
      const a: Vec3 = [Number(ax), Number(ay), Number(stream.below(2) === 0 ? az : -az) + 0];
      if (!isUnit(a) || dot(a, b) !== target) continue;
      return shuffleAxes(a, b, stream);
    }
  }
}

function pairCase(a: Vec3, b: Vec3, note?: string): PairCase {
  const d = dot(a, b);
  const result: PairCase = {
    a,
    b,
    dot: d.toString(),
    band: bandOf(d),
    chordE9: chordE9(d),
    travelSecs: travelSecs(a, b, SPEED_KMS),
  };
  if (note !== undefined) result.note = note;
  return result;
}

/** A second point at a random angle from `a`, with small and large separations equally likely. */
function companion(a: Vec3, stream: Stream): Vec3 {
  const u = stream.unit();
  const magnitudes = [1n, 3n, 10n, 30n, 100n, 300n, 1000n, 3000n, 10000n];
  const base = magnitudes[stream.below(magnitudes.length)] as bigint;
  const q = (base * 1_000_000n * BigInt(1000 + stream.below(2000))) / 1000n;
  const p = stream.below(4) === 0 ? -SCALE_N : SCALE_N;
  return normalize([
    BigInt(a[0]) * p + BigInt(u[0]) * q,
    BigInt(a[1]) * p + BigInt(u[1]) * q,
    BigInt(a[2]) * p + BigInt(u[2]) * q,
  ]);
}

function countRehashes(digest: Uint8Array): number {
  let d = digest;
  for (let i = 0; i < UNIT_SAMPLE_ATTEMPTS; i += 1) {
    const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
    let r2 = 0n;
    for (const offset of [0, 4, 8]) {
      const c = (BigInt(view.getInt32(offset, true)) * SCALE_N) / 2147483648n;
      r2 += c * c;
    }
    if (r2 > UNIT_SAMPLE_MIN_R2 && r2 <= UNIT_E18) return i;
    d = sha256(d);
  }
  return UNIT_SAMPLE_ATTEMPTS;
}

export function buildVectors(): GeometryVectors {
  const hunt = sha256(new TextEncoder().encode(`${SEED}:hunt`));

  const bands: BandCase[] = [];
  BAND_COS_E18.forEach((threshold, i) => {
    for (const offset of [-1n, 0n, 1n]) {
      const d = threshold + offset;
      bands.push({ dot: d.toString(), band: bandOf(d), note: `threshold ${i} offset ${offset}` });
    }
  });
  for (const d of [
    UNIT_E18 + UNIT_TOLERANCE,
    UNIT_E18,
    UNIT_E18 - 1n,
    1n,
    0n,
    -1n,
    -UNIT_E18,
    -UNIT_E18 - UNIT_TOLERANCE,
  ]) {
    bands.push({ dot: d.toString(), band: bandOf(d) });
  }

  const pairs: PairCase[] = [];
  const exact = new Stream(`${SEED}:exact`);
  BAND_COS_E18.forEach((threshold, i) => {
    for (const offset of [-1n, 0n, 1n]) {
      for (let n = 0; n < PAIRS_PER_THRESHOLD_OFFSET; n += 1) {
        const [a, b] = exactPair(threshold + offset, exact);
        pairs.push(pairCase(a, b, `threshold ${i} offset ${offset}`));
      }
    }
  });

  const axes: Vec3[] = [
    [SCALE, 0, 0],
    [0, SCALE, 0],
    [0, 0, SCALE],
    [-SCALE, 0, 0],
    [0, -SCALE, 0],
    [0, 0, -SCALE],
  ];
  for (const a of axes) {
    for (const b of axes) pairs.push(pairCase(a, b));
  }

  const points = new Stream(`${SEED}:pairs`);
  for (let i = 0; i < RANDOM_PAIRS; i += 1) {
    const a = points.unit();
    if (i % 12 === 0) {
      pairs.push(pairCase(a, a, 'same point'));
    } else if (i % 12 === 1) {
      pairs.push(pairCase(a, [-a[0] + 0, -a[1] + 0, -a[2] + 0], 'antipode'));
    } else if (i % 3 === 0) {
      pairs.push(pairCase(a, points.unit()));
    } else {
      pairs.push(pairCase(a, companion(a, points)));
    }
  }

  const travel: TravelCase[] = [];
  const speeds = [1, 7, 100, 343, 1200, 12742, 65535, 4294967295];
  pairs.forEach((pair, i) => {
    if (i % 6 !== 0) return;
    const speedKms = speeds[(i / 6) % speeds.length] as number;
    travel.push({ a: pair.a, b: pair.b, speedKms, travelSecs: travelSecs(pair.a, pair.b, speedKms) });
  });

  const units: UnitCase[] = [];
  const digests = new Stream(`${SEED}:units`);
  for (let i = 0; i < UNIT_CASES; i += 1) {
    const digest = digests.digest();
    units.push({
      digest: bytesToHex(digest),
      vector: unitVectorFromDigest(digest),
      rehashes: countRehashes(digest),
    });
  }

  const randomness: RandomnessCase[] = [];
  const zones: ZoneCase[] = [];
  const draws = new Stream(`${SEED}:randomness`);
  for (let i = 0; i < RANDOMNESS_CASES; i += 1) {
    const r = draws.digest();
    const location = locationFromRandomness(r);
    const salt = saltFromRandomness(r);
    const zoneSeed = zoneSeedFromRandomness(r);
    randomness.push({
      randomness: bytesToHex(r),
      location,
      salt: bytesToHex(salt),
      zoneSeed: bytesToHex(zoneSeed),
      commitment: bytesToHex(commitment(hunt, location, salt)),
    });
    if (i < ZONE_LOCATIONS) {
      for (let stage = 1; stage <= ZONE_STAGES; stage += 1) {
        const center = zoneCenter(location, zoneSeed, stage);
        zones.push({
          location,
          zoneSeed: bytesToHex(zoneSeed),
          stage,
          center,
          dot: dot(location, center).toString(),
        });
      }
    }
  }

  return {
    format: 'terra-incognita/geometry',
    version: 1,
    seed: SEED,
    scale: SCALE,
    speedKms: SPEED_KMS,
    hunt: bytesToHex(hunt),
    thresholds: BAND_COS_E18.map((t) => t.toString()),
    bands,
    pairs,
    travel,
    units,
    randomness,
    zones,
  };
}

/** One case per line keeps the file diffable. */
export function serialize(vectors: GeometryVectors): string {
  const lines: string[] = ['{'];
  const entries = Object.entries(vectors);
  entries.forEach(([key, value], i) => {
    const comma = i === entries.length - 1 ? '' : ',';
    if (Array.isArray(value) && typeof value[0] === 'object') {
      lines.push(`  ${JSON.stringify(key)}: [`);
      value.forEach((item, j) => {
        lines.push(`    ${JSON.stringify(item)}${j === value.length - 1 ? '' : ','}`);
      });
      lines.push(`  ]${comma}`);
    } else {
      lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)}${comma}`);
    }
  });
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

export const VECTORS_PATH = fileURLToPath(new URL('../vectors/geometry.json', import.meta.url));

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const vectors = buildVectors();
  writeFileSync(VECTORS_PATH, serialize(vectors));
  const perBand = new Array<number>(8).fill(0);
  for (const pair of vectors.pairs) perBand[pair.band] = (perBand[pair.band] ?? 0) + 1;
  console.log(
    `wrote ${VECTORS_PATH}: ${vectors.bands.length} bands, ${vectors.pairs.length} pairs ` +
      `(per band ${perBand.join('/')}), ${vectors.travel.length} travel, ${vectors.units.length} units, ` +
      `${vectors.randomness.length} randomness, ${vectors.zones.length} zones`,
  );
}
