import {
  BAND_COS_E18,
  EARTH_RADIUS_E4,
  MIN_TRAVEL_SECS,
  SCALE,
  SCALE_N,
  UNIT_E18,
  UNIT_TOLERANCE,
  ZONE_COS_E18,
  ZONE_STAGES,
} from './constants.js';
import type { Band, Vec3, Zone } from './types.js';

const I32_MIN = -2147483648;
const I32_MAX = 2147483647;

/** Floor of the square root of a non-negative integer. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError('isqrt of a negative number');
  if (n < 2n) return n;
  let x = 1n << BigInt((n.toString(2).length + 1) >> 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

/**
 * Scales an integer vector to length 1e9.
 *
 * Each component is `v · 1e9 / isqrt(|v|²)` rounded half away from zero. The caller is expected
 * to pass components around 1e18 so the floor in the square root is far below one output unit.
 * The zero vector maps to the north pole.
 */
export function normalize(v: readonly [bigint, bigint, bigint]): Vec3 {
  const n = isqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (n === 0n) return [0, 0, SCALE];
  const scale = (c: bigint): number => {
    const mag = c < 0n ? -c : c;
    const q = (2n * mag * SCALE_N + n) / (2n * n);
    return Number(c < 0n ? -q : q);
  };
  return [scale(v[0]), scale(v[1]), scale(v[2])];
}

/**
 * The form in which the program stores a position: `normalize(v · 1e9)`.
 *
 * `isUnit` accepts several spellings of nearly the same direction, and a longer spelling scores
 * a larger dot product. The program therefore re-normalises every position it is given, and
 * anything that predicts what it stores has to do the same. Stable: `canonical(canonical(v))`
 * equals `canonical(v)`.
 */
export function canonical(v: Vec3): Vec3 {
  return normalize([BigInt(v[0]) * SCALE_N, BigInt(v[1]) * SCALE_N, BigInt(v[2]) * SCALE_N]);
}

/**
 * Unit vector for a latitude and longitude in degrees.
 *
 * This is the one place where floating point feeds the exact layer. The program never needs it:
 * it accepts any vector that passes `isUnit`.
 */
export function fromLatLon(latDeg: number, lonDeg: number): Vec3 {
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg) || latDeg < -90 || latDeg > 90) {
    throw new RangeError(`invalid coordinates: ${latDeg}, ${lonDeg}`);
  }
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const c = Math.cos(lat);
  return [
    Math.round(c * Math.cos(lon) * SCALE) + 0,
    Math.round(c * Math.sin(lon) * SCALE) + 0,
    Math.round(Math.sin(lat) * SCALE) + 0,
  ];
}

/** Latitude and longitude in degrees, longitude in (−180, 180]. */
export function toLatLon(v: Vec3): { lat: number; lon: number } {
  const lat = (Math.atan2(v[2], Math.hypot(v[0], v[1])) * 180) / Math.PI;
  const lon = (Math.atan2(v[1], v[0]) * 180) / Math.PI;
  return { lat, lon: lon === -180 ? 180 : lon + 0 };
}

function isI32(n: number): boolean {
  return Number.isInteger(n) && n >= I32_MIN && n <= I32_MAX;
}

/** True when `v` holds three i32 values whose squared length is within the tolerance of 1e18. */
export function isUnit(v: Vec3): boolean {
  if (v.length !== 3 || !isI32(v[0]) || !isI32(v[1]) || !isI32(v[2])) return false;
  const x = BigInt(v[0]);
  const y = BigInt(v[1]);
  const z = BigInt(v[2]);
  const diff = x * x + y * y + z * z - UNIT_E18;
  return (diff < 0n ? -diff : diff) <= UNIT_TOLERANCE;
}

/** Dot product at scale 1e18. Fits an i64 for any pair of valid unit vectors. */
export function dot(a: Vec3, b: Vec3): bigint {
  return BigInt(a[0]) * BigInt(b[0]) + BigInt(a[1]) * BigInt(b[1]) + BigInt(a[2]) * BigInt(b[2]);
}

/** Band of a dot product: the number of thresholds the dot product is strictly below. */
export function bandOf(d: bigint): Band {
  let band = 0;
  for (const threshold of BAND_COS_E18) {
    if (d < threshold) band += 1;
  }
  return band as Band;
}

export function bandBetween(a: Vec3, b: Vec3): Band {
  return bandOf(dot(a, b));
}

/** Straight-line distance on the unit sphere at scale 1e9: isqrt(2 · (1e18 − dot)), clamped at 0. */
export function chordE9(d: bigint): number {
  const gap = UNIT_E18 - d;
  return gap <= 0n ? 0 : Number(isqrt(2n * gap));
}

/**
 * Flight time in whole seconds: ceil(chord · 6371.0088 km / speed), at least one second.
 * `speedKms` is the hunt's speed in km per second and must be a positive integer.
 */
export function travelSecs(a: Vec3, b: Vec3, speedKms: number): number {
  if (!Number.isInteger(speedKms) || speedKms <= 0) {
    throw new RangeError(`speed must be a positive integer, got ${speedKms}`);
  }
  const num = BigInt(chordE9(dot(a, b))) * EARTH_RADIUS_E4;
  const den = 10_000_000_000_000n * BigInt(speedKms);
  const secs = Number((num + den - 1n) / den);
  return Math.max(MIN_TRAVEL_SECS, secs);
}

/** Whether `p` lies inside the public zone. Stage 0 covers the whole globe. */
export function inZone(p: Vec3, zone: Zone): boolean {
  if (zone.stage === 0) return true;
  const cos = ZONE_COS_E18[zone.stage - 1];
  if (cos === undefined) throw new RangeError(`zone stage out of range: ${zone.stage}`);
  return dot(p, zone.center) >= cos;
}

/**
 * Zone stage the clock implies: one stage per elapsed interval since the start, capped at 8.
 * A non-positive interval disables shrinking.
 */
export function zoneStageAt(now: number, startsAt: number, intervalSecs: number): number {
  if (intervalSecs <= 0 || now <= startsAt) return 0;
  return Math.min(ZONE_STAGES, Math.floor((now - startsAt) / intervalSecs));
}
