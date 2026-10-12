import { EARTH_RADIUS_KM, bandBetween, fromLatLon, render, travelSecs } from '@terra-incognita/core';
import type { Vec3 } from '@terra-incognita/core';
import { describe, expect, it } from 'vitest';

import { Belief, createRng } from '../src/index.js';
import { BAND_COS, ZONE_COS, bandInterval, bandOfCos, fibonacciLattice, flightSecs, offset, tangentFrame } from '../src/sphere.js';
import { antipode, pointAt } from './helpers.js';

interface Observation {
  pos: Vec3;
  band: number;
}

function points(belief: Belief): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < belief.count; i += 1) {
    out.push([belief.points[3 * i]!, belief.points[3 * i + 1]!, belief.points[3 * i + 2]!]);
  }
  return out;
}

function consistent(belief: Belief, observations: readonly Observation[]): boolean {
  return points(belief).every((p) =>
    observations.every(({ pos, band }) => {
      const f = render.toFloat(pos);
      return bandOfCos(p[0] * f[0] + p[1] * f[1] + p[2] * f[2]) === band;
    }),
  );
}

function observe(belief: Belief, truth: Vec3, pos: Vec3): Observation {
  const band = bandBetween(pos, truth);
  belief.addBand(render.toFloat(pos), band);
  return { pos, band };
}

const km = (a: readonly number[], b: Vec3): number => render.angleBetween(a as [number, number, number], render.toFloat(b)) * EARTH_RADIUS_KM;

describe('float band tables', () => {
  it('classify like the integer thresholds', () => {
    expect(bandOfCos(1)).toBe(0);
    expect(bandOfCos(-1)).toBe(7);
    BAND_COS.forEach((cos, i) => {
      expect(bandOfCos(cos)).toBe(i);
      expect(bandOfCos(cos - 1e-12)).toBe(i + 1);
    });
    expect(bandInterval(0)).toEqual({ lo: BAND_COS[0], hi: Infinity });
    expect(bandInterval(3)).toEqual({ lo: BAND_COS[3], hi: BAND_COS[2] });
    expect(bandInterval(7)).toEqual({ lo: -Infinity, hi: BAND_COS[6] });
  });
});

describe('float sphere helpers', () => {
  it('estimate flight time like the exact formula', () => {
    const rng = createRng(77);
    let different = 0;
    for (let i = 0; i < 3000; i += 1) {
      const a = render.fromFloat([rng.next() - 0.5, rng.next() - 0.5, rng.next() - 0.5]);
      const b = render.fromFloat([rng.next() - 0.5, rng.next() - 0.5, rng.next() - 0.5]);
      const fa = render.toFloat(a);
      const fb = render.toFloat(b);
      const estimate = flightSecs(fa[0] * fb[0] + fa[1] * fb[1] + fa[2] * fb[2], 800);
      const exact = travelSecs(a, b, 800);
      expect(Math.abs(estimate - exact)).toBeLessThanOrEqual(1);
      if (estimate !== exact) different += 1;
    }
    // They can only disagree when a flight time lands within rounding of a whole second.
    expect(different).toBeLessThanOrEqual(3);
    expect(flightSecs(1, 800)).toBe(1);
    expect(flightSecs(-1, 800)).toBe(16);
  });

  it('build orthonormal frames and offsets at the requested angle', () => {
    const rng = createRng(78);
    for (let i = 0; i < 500; i += 1) {
      const axis = render.toFloat(render.fromFloat([rng.next() - 0.5, rng.next() - 0.5, rng.next() - 0.5]));
      const { e1, e2 } = tangentFrame(axis);
      const dot = (u: number[], v: number[]): number => u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!;
      expect(dot(e1, e1)).toBeCloseTo(1, 12);
      expect(dot(e2, e2)).toBeCloseTo(1, 12);
      expect(dot(e1, e2)).toBeCloseTo(0, 12);
      expect(dot(e1, axis)).toBeCloseTo(0, 12);
      expect(dot(e2, axis)).toBeCloseTo(0, 12);
      const angle = rng.next() * 3;
      expect(render.angleBetween(axis, offset(axis, rng.next() * 7, angle))).toBeCloseTo(angle, 9);
    }
  });

  it('lay out a lattice without clumps or holes', () => {
    const n = 400;
    const lattice = fibonacciLattice(n);
    let closest = Infinity;
    let loneliest = 0;
    for (let i = 0; i < n; i += 1) {
      let nearest = Infinity;
      for (let j = 0; j < n; j += 1) {
        if (i === j) continue;
        const d =
          lattice[3 * i]! * lattice[3 * j]! + lattice[3 * i + 1]! * lattice[3 * j + 1]! + lattice[3 * i + 2]! * lattice[3 * j + 2]!;
        nearest = Math.min(nearest, Math.acos(Math.min(1, d)));
      }
      closest = Math.min(closest, nearest);
      loneliest = Math.max(loneliest, nearest);
    }
    // Even spacing for 400 points is about sqrt(4π / 400) = 0.177 rad.
    expect(closest).toBeGreaterThan(0.1);
    expect(loneliest).toBeLessThan(0.25);
  });
});

describe('Belief', () => {
  it('starts as an even cover of the globe', () => {
    const belief = new Belief(2000, createRng(1));
    expect(belief.count).toBe(2000);
    expect(belief.area).toBeCloseTo(4 * Math.PI, 12);
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const p of points(belief)) {
      expect(Math.hypot(...p)).toBeCloseTo(1, 12);
      sx += p[0];
      sy += p[1];
      sz += p[2];
    }
    expect(Math.hypot(sx, sy, sz) / 2000).toBeLessThan(0.01);
    // Each hemisphere and each octant gets its share.
    const north = points(belief).filter((p) => p[2] > 0).length;
    expect(Math.abs(north - 1000)).toBeLessThanOrEqual(1);
    const octant = points(belief).filter((p) => p[0] > 0 && p[1] > 0 && p[2] > 0).length;
    expect(Math.abs(octant - 250)).toBeLessThan(15);
  });

  it('keeps only points that agree with a sounding and tops itself up', () => {
    const truth = fromLatLon(30, 40);
    const belief = new Belief(1500, createRng(2));
    const seen = [observe(belief, truth, pointAt(truth, 1, 3000))];
    expect(seen[0]!.band).toBe(5);
    expect(belief.count).toBe(1500);
    expect(consistent(belief, seen)).toBe(true);
    expect(belief.feasible(...render.toFloat(truth))).toBe(true);
    expect(belief.feasible(...render.toFloat(antipode(truth)))).toBe(false);
  });

  it('estimates the area of what is left', () => {
    const truth = fromLatLon(-20, 100);
    const pos = pointAt(truth, 2, 3000);
    const belief = new Belief(3000, createRng(3));
    observe(belief, truth, pos);
    // Band 5 is the annulus between 2500 and 5000 km.
    const annulus = 2 * Math.PI * (BAND_COS[4]! - BAND_COS[5]!);
    expect(belief.area / annulus).toBeGreaterThan(0.93);
    expect(belief.area / annulus).toBeLessThan(1.07);

    // A second, crossing annulus keeps a known share of the first.
    const before = belief.area;
    observe(belief, truth, pointAt(truth, 4, 3000));
    expect(belief.area).toBeLessThan(before * 0.6);
    expect(belief.area).toBeGreaterThan(before * 0.05);
  });

  it('accepts the zone cap as a constraint', () => {
    const center = fromLatLon(10, 10);
    const belief = new Belief(1000, createRng(4));
    belief.addCap(render.toFloat(center), ZONE_COS[4]!);
    expect(belief.count).toBe(1000);
    for (const p of points(belief)) expect(km(p, center)).toBeLessThanOrEqual((15 * Math.PI * EARTH_RADIUS_KM) / 180 + 1e-6);
    const cap = 2 * Math.PI * (1 - ZONE_COS[4]!);
    expect(belief.area / cap).toBeGreaterThan(0.9);
    expect(belief.area / cap).toBeLessThan(1.1);
  });

  it('follows the region down from the whole globe to a few kilometres', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const rng = createRng(100 + seed);
      const truth = render.fromFloat([rng.next() - 0.5, rng.next() - 0.5, rng.next() - 0.5]);
      const belief = new Belief(1200, createRng(seed));
      const seen: Observation[] = [];
      // Soundings from ever closer in, the way a search converges, but never a strike.
      for (const range of [9000, 9000, 6000, 6000, 3000, 3000, 1500, 1500, 700, 700, 300, 300, 130, 130, 90, 90, 70, 70]) {
        const distance = 51 + rng.next() * range;
        seen.push(observe(belief, truth, pointAt(truth, 2 * Math.PI * rng.next(), distance)));
        expect(belief.lost).toBe(false);
        // A sounding that removes less than a quarter of the samples is not topped up.
        expect(belief.count).toBeGreaterThanOrEqual(900);
        expect(belief.count).toBeLessThanOrEqual(1200);
      }
      expect(consistent(belief, seen)).toBe(true);
      expect(belief.feasible(...render.toFloat(truth))).toBe(true);
      const center = belief.mean();
      expect(km(center, truth)).toBeLessThan(120);
      expect(belief.spread(center) * EARTH_RADIUS_KM).toBeLessThan(120);
      expect(belief.area * EARTH_RADIUS_KM ** 2).toBeLessThan(40_000);
    }
  });

  it('finds a region smaller than the gap between its samples', () => {
    // With 300 points on the globe the nearest one is typically hundreds of km away, so a strike
    // cap of 50 km starts with no survivor at all.
    const truth = fromLatLon(12.34, -56.78);
    const belief = new Belief(300, createRng(5));
    belief.addBand(render.toFloat(truth), 0);
    expect(belief.lost).toBe(false);
    expect(belief.count).toBe(300);
    for (const p of points(belief)) expect(km(p, truth)).toBeLessThanOrEqual(50.001);
    const cap = 2 * Math.PI * (1 - BAND_COS[0]!);
    expect(belief.area / cap).toBeGreaterThan(0.8);
    expect(belief.area / cap).toBeLessThan(1.2);
  });

  it('recovers a sliver far smaller than any single constraint', () => {
    // Three discs of 2500 km whose edges pass just beyond the truth overlap in a triangle a few
    // dozen km across, some ten thousand times smaller than any of the annuli.
    const truth = fromLatLon(45, 90);
    const belief = new Belief(800, createRng(6));
    const seen = [
      observe(belief, truth, pointAt(truth, 0, 2480)),
      observe(belief, truth, pointAt(truth, 2.1, 2485)),
      observe(belief, truth, pointAt(truth, 4.2, 2490)),
    ];
    expect(seen.map((o) => o.band)).toEqual([4, 4, 4]);
    expect(belief.lost).toBe(false);
    expect(belief.count).toBe(800);
    expect(consistent(belief, seen)).toBe(true);
    for (const p of points(belief)) expect(km(p, truth)).toBeLessThan(150);
    const annulus = 2 * Math.PI * (BAND_COS[3]! - BAND_COS[4]!);
    expect(belief.area).toBeLessThan(annulus / 2000);
    expect(belief.feasible(...render.toFloat(truth))).toBe(true);
  });

  it('reports contradictory soundings instead of inventing a region', () => {
    const a = fromLatLon(0, 0);
    const belief = new Belief(400, createRng(7));
    belief.addBand(render.toFloat(a), 0);
    belief.addBand(render.toFloat(antipode(a)), 0);
    expect(belief.lost).toBe(true);
    expect(belief.count).toBe(0);
    belief.reset();
    expect(belief.lost).toBe(false);
    expect(belief.count).toBe(400);
    expect(belief.constraintCount).toBe(0);
  });

  it('is reproducible from its seed', () => {
    const truth = fromLatLon(5, 5);
    const run = (): number[] => {
      const belief = new Belief(500, createRng(8));
      observe(belief, truth, pointAt(truth, 1, 4000));
      observe(belief, truth, pointAt(truth, 3, 800));
      return [...belief.points.subarray(0, 30)];
    };
    expect(run()).toEqual(run());
  });
});
