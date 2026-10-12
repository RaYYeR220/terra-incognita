import { BAND_COS_E18, BAND_KM, EARTH_RADIUS_KM, ZONE_COS_E18 } from '@terra-incognita/core';

/** A direction as three floats of unit length. */
export type F3 = [number, number, number];

/** Band thresholds as cosines; index i separates band i from band i + 1. */
export const BAND_COS: readonly number[] = BAND_COS_E18.map((t) => Number(t) / 1e18);
/** Cosine of the zone radius for stages 1..8. */
export const ZONE_COS: readonly number[] = ZONE_COS_E18.map((t) => Number(t) / 1e18);
/** Outer radius of bands 0..6 in radians. */
export const BAND_RAD: readonly number[] = BAND_KM.map((km) => km / EARTH_RADIUS_KM);

export const SPHERE_AREA = 4 * Math.PI;
/** Area of the 50 km strike cap in steradians. */
export const STRIKE_AREA = 2 * Math.PI * (1 - (BAND_COS[0] as number));

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Feasible interval of dot(probe, treasure) for a band: lo ≤ dot < hi. */
export function bandInterval(band: number): { lo: number; hi: number } {
  return {
    lo: band >= 7 ? -Infinity : (BAND_COS[band] as number),
    hi: band <= 0 ? Infinity : (BAND_COS[band - 1] as number),
  };
}

/** Band a float dot product falls in. */
export function bandOfCos(d: number): number {
  let band = 0;
  for (const threshold of BAND_COS) {
    if (d < threshold) band += 1;
  }
  return band;
}

export function dot3(a: readonly number[], b: readonly number[]): number {
  return (a[0] as number) * (b[0] as number) + (a[1] as number) * (b[1] as number) + (a[2] as number) * (b[2] as number);
}

export function normalize3(x: number, y: number, z: number): F3 {
  const n = Math.hypot(x, y, z);
  return n > 0 ? [x / n, y / n, z / n] : [0, 0, 1];
}

/** Two unit vectors that complete `axis` to an orthonormal frame. */
export function tangentFrame(axis: readonly number[]): { e1: F3; e2: F3 } {
  const ax = axis[0] as number;
  const ay = axis[1] as number;
  const az = axis[2] as number;
  const mx = Math.abs(ax);
  const my = Math.abs(ay);
  const mz = Math.abs(az);
  let hx = 0;
  let hy = 0;
  let hz = 0;
  if (mx <= my && mx <= mz) hx = 1;
  else if (my <= mz) hy = 1;
  else hz = 1;
  const d = hx * ax + hy * ay + hz * az;
  const e1 = normalize3(hx - d * ax, hy - d * ay, hz - d * az);
  const e2: F3 = [ay * e1[2] - az * e1[1], az * e1[0] - ax * e1[2], ax * e1[1] - ay * e1[0]];
  return { e1, e2 };
}

/** The point at angular distance `angle` from `from`, in the direction `bearing` of its tangent frame. */
export function offset(from: readonly number[], bearing: number, angle: number): F3 {
  const { e1, e2 } = tangentFrame(from);
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const cb = Math.cos(bearing);
  const sb = Math.sin(bearing);
  return normalize3(
    ca * (from[0] as number) + sa * (cb * e1[0] + sb * e2[0]),
    ca * (from[1] as number) + sa * (cb * e1[1] + sb * e2[1]),
    ca * (from[2] as number) + sa * (cb * e1[2] + sb * e2[2]),
  );
}

/** Writes `count` near-evenly spaced points on the sphere into `out` as x, y, z triples. */
export function fibonacciLattice(count: number, out: Float64Array = new Float64Array(3 * count)): Float64Array {
  for (let i = 0; i < count; i += 1) {
    const z = 1 - (2 * i + 1) / count;
    const r = Math.sqrt(1 - z * z);
    const phi = i * GOLDEN_ANGLE;
    out[3 * i] = r * Math.cos(phi);
    out[3 * i + 1] = r * Math.sin(phi);
    out[3 * i + 2] = z;
  }
  return out;
}

/** Chord in km between two directions with the given cosine. */
export function chordKm(cos: number): number {
  return EARTH_RADIUS_KM * Math.sqrt(Math.max(0, 2 * (1 - cos)));
}

/** Flight time in seconds the program would charge for a chord, mirroring `travelSecs`. */
export function flightSecs(cos: number, speedKms: number): number {
  return Math.max(1, Math.ceil(chordKm(cos) / speedKms - 1e-9));
}
