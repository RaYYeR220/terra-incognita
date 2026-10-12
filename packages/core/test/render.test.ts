import { describe, expect, it } from 'vitest';

import { EARTH_RADIUS_KM, SCALE, fromLatLon, isUnit, render } from '../src/index.js';
import type { Ship, Vec3 } from '../src/index.js';
import * as renderEntry from '../src/render.js';
import { mulberry32, randomPoint } from './helpers.js';

const {
  angleBetween,
  bandOutlines,
  bandRadiiKm,
  capOutline,
  destination,
  distanceKm,
  fromFloat,
  latLonOf,
  shipPosition,
  shipProgress,
  slerp,
  toFloat,
  zoneOutline,
  zoneRadiusDeg,
} = render;

const length = (u: readonly number[]): number => Math.hypot(u[0]!, u[1]!, u[2]!);

describe('render entry point', () => {
  it('is the same module as the namespace on the main entry', () => {
    expect(renderEntry.slerp).toBe(render.slerp);
  });
});

describe('float conversion', () => {
  it('snaps any direction to a valid lattice point', () => {
    const rand = mulberry32(41);
    for (let i = 0; i < 3000; i += 1) {
      const u = [rand() - 0.5, rand() - 0.5, rand() - 0.5] as const;
      expect(isUnit(fromFloat([u[0] * 7, u[1] * 7, u[2] * 7]))).toBe(true);
    }
    expect(() => fromFloat([0, 0, 0])).toThrow(RangeError);
  });

  it('round-trips to within two lattice units', () => {
    const rand = mulberry32(42);
    for (let i = 0; i < 500; i += 1) {
      const p = randomPoint(rand);
      const back = fromFloat(toFloat(p));
      for (let axis = 0; axis < 3; axis += 1) {
        expect(Math.abs(back[axis]! - p[axis]!)).toBeLessThanOrEqual(2);
      }
      expect(length(toFloat(p))).toBeCloseTo(1, 12);
    }
    expect(fromFloat(toFloat([SCALE, 0, 0]))).toEqual([SCALE, 0, 0]);
  });

  it('reports latitude and longitude', () => {
    const { lat, lon } = latLonOf(toFloat(fromLatLon(-33.8688, 151.2093)));
    expect(lat).toBeCloseTo(-33.8688, 6);
    expect(lon).toBeCloseTo(151.2093, 6);
  });
});

describe('distanceKm', () => {
  it('measures a quarter and a half of the globe', () => {
    expect(distanceKm([SCALE, 0, 0], [0, SCALE, 0])).toBeCloseTo((Math.PI / 2) * EARTH_RADIUS_KM, 6);
    expect(distanceKm([SCALE, 0, 0], [-SCALE, 0, 0])).toBeCloseTo(Math.PI * EARTH_RADIUS_KM, 6);
    expect(distanceKm([SCALE, 0, 0], [SCALE, 0, 0])).toBe(0);
  });

  it('matches a known city pair', () => {
    // London to New York is about 5570 km on a sphere of this radius.
    const km = distanceKm(fromLatLon(51.5074, -0.1278), fromLatLon(40.7128, -74.006));
    expect(km).toBeGreaterThan(5560);
    expect(km).toBeLessThan(5580);
  });

  it('stays accurate for points a few metres apart', () => {
    const a = fromLatLon(10, 10);
    const b = fromFloat(destination(toFloat(a), 1.1, 0.02 / EARTH_RADIUS_KM));
    expect(distanceKm(a, b)).toBeCloseTo(0.02, 2);
  });
});

describe('slerp and ship position', () => {
  const a = toFloat(fromLatLon(0, 0));
  const b = toFloat(fromLatLon(0, 90));

  it('returns the endpoints and stays on the sphere', () => {
    expect(slerp(a, b, 0)).toEqual(a);
    expect(angleBetween(slerp(a, b, 1), b)).toBeLessThan(1e-12);
    for (let f = 0; f <= 1; f += 0.125) expect(length(slerp(a, b, f))).toBeCloseTo(1, 12);
  });

  it('moves at a constant angular speed along the great circle', () => {
    const mid = slerp(a, b, 0.5);
    expect(latLonOf(mid).lon).toBeCloseTo(45, 9);
    expect(latLonOf(mid).lat).toBeCloseTo(0, 9);
    expect(angleBetween(a, slerp(a, b, 0.25))).toBeCloseTo(Math.PI / 8, 12);
  });

  it('handles identical and antipodal endpoints', () => {
    expect(slerp(a, a, 0.3)).toEqual(a);
    const opposite: [number, number, number] = [-a[0], -a[1], -a[2]];
    expect(angleBetween(slerp(a, opposite, 1), opposite)).toBeLessThan(1e-9);
    expect(angleBetween(a, slerp(a, opposite, 0.25))).toBeCloseTo(Math.PI / 4, 9);
    expect(angleBetween(a, slerp(a, opposite, 0.75))).toBeCloseTo((3 * Math.PI) / 4, 9);
  });

  it('places a ship along its leg by the clock', () => {
    const ship: Pick<Ship, 'from' | 'to' | 'departTs' | 'arriveTs'> = {
      from: fromLatLon(0, 0),
      to: fromLatLon(0, 90),
      departTs: 1000,
      arriveTs: 1012,
    };
    expect(shipProgress(ship, 990)).toBe(0);
    expect(shipProgress(ship, 1006)).toBe(0.5);
    expect(shipProgress(ship, 2000)).toBe(1);
    expect(latLonOf(shipPosition(ship, 1003)).lon).toBeCloseTo(22.5, 6);
    expect(fromFloat(shipPosition(ship, 1012))).toEqual(ship.to);
    expect(fromFloat(shipPosition(ship, 999))).toEqual(ship.from);
  });

  it('keeps a ship that has not moved where it is', () => {
    const at = fromLatLon(20, 30);
    const ship = { from: at, to: at, departTs: 500, arriveTs: 500 };
    expect(fromFloat(shipPosition(ship, 400))).toEqual(at);
    expect(fromFloat(shipPosition(ship, 600))).toEqual(at);
  });
});

describe('band and zone shapes', () => {
  it('lists the annulus of every band', () => {
    expect(bandRadiiKm(0)).toEqual({ innerKm: 0, outerKm: 50 });
    expect(bandRadiiKm(1)).toEqual({ innerKm: 50, outerKm: 150 });
    expect(bandRadiiKm(4)).toEqual({ innerKm: 1000, outerKm: 2500 });
    expect(bandRadiiKm(7).innerKm).toBe(10000);
    expect(bandRadiiKm(7).outerKm).toBeCloseTo(Math.PI * EARTH_RADIUS_KM, 9);
  });

  it('gives the zone radius per stage', () => {
    expect(zoneRadiusDeg(0)).toBe(180);
    expect(zoneRadiusDeg(1)).toBe(90);
    expect(zoneRadiusDeg(8)).toBe(3);
  });

  it('draws a closed outline at the requested angular distance', () => {
    const center: Vec3 = fromLatLon(47, 8);
    const outline = capOutline(center, 0.2, 64);
    expect(outline).toHaveLength(65);
    expect(outline[64]).toEqual(outline[0]);
    for (const point of outline) {
      expect(angleBetween(toFloat(center), point)).toBeCloseTo(0.2, 12);
      expect(length(point)).toBeCloseTo(1, 12);
    }
  });

  it('draws outlines around the poles too', () => {
    for (const point of capOutline([0, 0, SCALE], 0.5, 16)) {
      expect(latLonOf(point).lat).toBeCloseTo(90 - (0.5 * 180) / Math.PI, 9);
    }
  });

  it('outlines the zone and the band annulus', () => {
    expect(zoneOutline({ stage: 0, center: [0, 0, 0] })).toEqual([]);
    const center = fromLatLon(-10, 100);
    for (const point of zoneOutline({ stage: 5, center }, 32)) {
      expect((angleBetween(toFloat(center), point) * 180) / Math.PI).toBeCloseTo(15, 9);
    }
    const rings = bandOutlines(center, 2, 32);
    expect(angleBetween(toFloat(center), rings.inner[3]!) * EARTH_RADIUS_KM).toBeCloseTo(150, 6);
    expect(angleBetween(toFloat(center), rings.outer[3]!) * EARTH_RADIUS_KM).toBeCloseTo(400, 6);
    expect(bandOutlines(center, 0).inner).toEqual([]);
    expect(bandOutlines(center, 7).outer).toEqual([]);
  });

  it('follows the bearing convention: 0 is north, a quarter turn is east', () => {
    const from = toFloat(fromLatLon(0, 0));
    expect(latLonOf(destination(from, 0, 0.1)).lat).toBeCloseTo((0.1 * 180) / Math.PI, 9);
    expect(latLonOf(destination(from, Math.PI / 2, 0.1)).lon).toBeCloseTo((0.1 * 180) / Math.PI, 9);
  });
});
