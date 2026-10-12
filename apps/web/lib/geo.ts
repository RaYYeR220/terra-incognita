import { fromLatLon, render, toLatLon } from '@terra-incognita/core';
import type { Vec3 } from '@terra-incognita/core';

import { latLonText } from './format';

/** d3 works in [longitude, latitude]. */
export type LonLat = [number, number];

export function vecToLonLat(v: Vec3): LonLat {
  const { lat, lon } = toLatLon(v);
  return [lon, lat];
}

export function unitToLonLat(u: readonly [number, number, number]): LonLat {
  const { lat, lon } = render.latLonOf(u);
  return [lon, lat];
}

export function lonLatToVec([lon, lat]: LonLat): Vec3 {
  return fromLatLon(Math.max(-90, Math.min(90, lat)), lon);
}

export function vecText(v: Vec3): string {
  const { lat, lon } = toLatLon(v);
  return latLonText(lat, lon);
}

export function sameVec(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}
