/**
 * Floating-point helpers for drawing the globe.
 *
 * Nothing here takes part in game rules: bands, zones, travel times and commitments are decided
 * by the integer functions in `geo.ts` and `derive.ts`. These helpers only turn that state into
 * positions, radii and outlines for a renderer.
 */
import { BAND_KM, EARTH_RADIUS_KM, SCALE, ZONE_DEG } from './constants.js';
import type { Band, Ship, Vec3, Zone } from './types.js';

/** A direction as three floats of unit length. */
export type UnitF = [x: number, y: number, z: number];

const HALF_CIRCUMFERENCE_KM = Math.PI * EARTH_RADIUS_KM;

export function toFloat(v: Vec3): UnitF {
  const n = Math.hypot(v[0], v[1], v[2]);
  return n === 0 ? [0, 0, 1] : [v[0] / n, v[1] / n, v[2] / n];
}

/** Snaps a float direction onto the fixed-point lattice. The result always passes `isUnit`. */
export function fromFloat(u: readonly [number, number, number]): Vec3 {
  const n = Math.hypot(u[0], u[1], u[2]);
  if (!(n > 0) || !Number.isFinite(n)) throw new RangeError('cannot normalise a zero vector');
  return [
    Math.round((u[0] / n) * SCALE) + 0,
    Math.round((u[1] / n) * SCALE) + 0,
    Math.round((u[2] / n) * SCALE) + 0,
  ];
}

export function latLonOf(u: readonly [number, number, number]): { lat: number; lon: number } {
  return {
    lat: (Math.atan2(u[2], Math.hypot(u[0], u[1])) * 180) / Math.PI,
    lon: (Math.atan2(u[1], u[0]) * 180) / Math.PI,
  };
}

/** Angle between two directions in radians, stable for nearly equal and nearly opposite inputs. */
export function angleBetween(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const cx = a[1] * b[2] - a[2] * b[1];
  const cy = a[2] * b[0] - a[0] * b[2];
  const cz = a[0] * b[1] - a[1] * b[0];
  return Math.atan2(Math.hypot(cx, cy, cz), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
}

/** Great-circle distance in km. */
export function distanceKm(a: Vec3, b: Vec3): number {
  return angleBetween(toFloat(a), toFloat(b)) * EARTH_RADIUS_KM;
}

/** Any unit vector perpendicular to `u`. */
function perpendicular(u: readonly [number, number, number]): UnitF {
  const ax = Math.abs(u[0]);
  const ay = Math.abs(u[1]);
  const az = Math.abs(u[2]);
  const h: UnitF = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  const d = h[0] * u[0] + h[1] * u[1] + h[2] * u[2];
  const p: UnitF = [h[0] - d * u[0], h[1] - d * u[1], h[2] - d * u[2]];
  const n = Math.hypot(p[0], p[1], p[2]);
  return [p[0] / n, p[1] / n, p[2] / n];
}

/** Spherical interpolation from `a` (f = 0) to `b` (f = 1) along the shorter great circle. */
export function slerp(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  f: number,
): UnitF {
  const omega = angleBetween(a, b);
  if (omega < 1e-12) return [a[0], a[1], a[2]];
  if (Math.PI - omega < 1e-9) {
    // Antipodal endpoints have no unique great circle; route through a fixed midpoint.
    const mid = perpendicular(a);
    return f <= 0.5 ? slerp(a, mid, f * 2) : slerp(mid, b, f * 2 - 1);
  }
  const s = Math.sin(omega);
  const wa = Math.sin((1 - f) * omega) / s;
  const wb = Math.sin(f * omega) / s;
  const x = wa * a[0] + wb * b[0];
  const y = wa * a[1] + wb * b[1];
  const z = wa * a[2] + wb * b[2];
  const n = Math.hypot(x, y, z);
  return [x / n, y / n, z / n];
}

type Course = Pick<Ship, 'from' | 'to' | 'departTs' | 'arriveTs'>;

/** Fraction of the current leg flown at time `t` (unix seconds, may be fractional), in [0, 1]. */
export function shipProgress(ship: Course, t: number): number {
  if (t >= ship.arriveTs || ship.arriveTs <= ship.departTs) return 1;
  if (t <= ship.departTs) return 0;
  return (t - ship.departTs) / (ship.arriveTs - ship.departTs);
}

/** Where to draw a ship at time `t`: great-circle interpolation between its two waypoints. */
export function shipPosition(ship: Course, t: number): UnitF {
  return slerp(toFloat(ship.from), toFloat(ship.to), shipProgress(ship, t));
}

/** Great-circle radii of the annulus a band describes around the probe position. */
export function bandRadiiKm(band: Band): { innerKm: number; outerKm: number } {
  return {
    innerKm: band === 0 ? 0 : (BAND_KM[band - 1] as number),
    outerKm: band === 7 ? HALF_CIRCUMFERENCE_KM : (BAND_KM[band] as number),
  };
}

/** Angular radius of the zone cap in degrees. Stage 0 covers the globe. */
export function zoneRadiusDeg(stage: number): number {
  if (stage <= 0) return 180;
  return ZONE_DEG[Math.min(stage, ZONE_DEG.length) - 1] as number;
}

/** The point reached from `from` after travelling `angleRad` along the given bearing. */
export function destination(
  from: readonly [number, number, number],
  bearingRad: number,
  angleRad: number,
): UnitF {
  // Local east and north; at the poles any perpendicular pair will do.
  const horizontal = Math.hypot(from[0], from[1]);
  let east: UnitF;
  if (horizontal < 1e-12) east = [0, 1, 0];
  else east = [-from[1] / horizontal, from[0] / horizontal, 0];
  const north: UnitF = [
    from[1] * east[2] - from[2] * east[1],
    from[2] * east[0] - from[0] * east[2],
    from[0] * east[1] - from[1] * east[0],
  ];
  const sb = Math.sin(bearingRad);
  const cb = Math.cos(bearingRad);
  const sa = Math.sin(angleRad);
  const ca = Math.cos(angleRad);
  return [
    ca * from[0] + sa * (cb * north[0] + sb * east[0]),
    ca * from[1] + sa * (cb * north[1] + sb * east[1]),
    ca * from[2] + sa * (cb * north[2] + sb * east[2]),
  ];
}

/** Closed outline of a spherical cap: `segments + 1` points, the last equal to the first. */
export function capOutline(center: Vec3, angularRadiusRad: number, segments = 128): UnitF[] {
  const c = toFloat(center);
  const points: UnitF[] = [];
  for (let i = 0; i <= segments; i += 1) {
    points.push(destination(c, (2 * Math.PI * (i % segments)) / segments, angularRadiusRad));
  }
  return points;
}

/** Outline of the public zone, or an empty list while the zone is the whole globe. */
export function zoneOutline(zone: Zone, segments = 128): UnitF[] {
  if (zone.stage <= 0) return [];
  return capOutline(zone.center, (zoneRadiusDeg(zone.stage) * Math.PI) / 180, segments);
}

/**
 * Inner and outer outlines of the annulus a logbook entry describes. The inner ring is empty
 * for a strike, the outer ring is empty for band 7, which extends to the antipode.
 */
export function bandOutlines(
  pos: Vec3,
  band: Band,
  segments = 128,
): { inner: UnitF[]; outer: UnitF[] } {
  const { innerKm, outerKm } = bandRadiiKm(band);
  return {
    inner: band === 0 ? [] : capOutline(pos, innerKm / EARTH_RADIUS_KM, segments),
    outer: band === 7 ? [] : capOutline(pos, outerKm / EARTH_RADIUS_KM, segments),
  };
}
