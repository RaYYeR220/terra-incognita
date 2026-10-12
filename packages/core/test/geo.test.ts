import { describe, expect, it } from 'vitest';

import {
  BAND_COS_E18,
  BAND_KM,
  BAND_NAMES,
  EARTH_RADIUS_E4,
  EARTH_RADIUS_KM,
  SCALE,
  UNIT_E18,
  ZONE_COS_E18,
  ZONE_DEG,
  ZONE_SIN_E9,
  bandBetween,
  bandOf,
  chordE9,
  dot,
  fromLatLon,
  inZone,
  isUnit,
  isqrt,
  normalize,
  render,
  toLatLon,
  travelSecs,
  zoneStageAt,
} from '../src/index.js';
import type { Vec3 } from '../src/index.js';
import { mulberry32, randomPoint } from './helpers.js';

describe('constant tables', () => {
  it('band thresholds are cos(km / R) at scale 1e18', () => {
    BAND_KM.forEach((km, i) => {
      const expected = Math.cos(km / EARTH_RADIUS_KM) * 1e18;
      expect(Math.abs(Number(BAND_COS_E18[i]) - expected)).toBeLessThan(2048);
    });
  });

  it('band thresholds are strictly decreasing', () => {
    for (let i = 1; i < BAND_COS_E18.length; i += 1) {
      expect(BAND_COS_E18[i]! < BAND_COS_E18[i - 1]!).toBe(true);
    }
  });

  it('zone tables are sin and cos of the stage radius', () => {
    ZONE_DEG.forEach((deg, i) => {
      const rad = (deg * Math.PI) / 180;
      expect(Math.abs(ZONE_SIN_E9[i]! - Math.sin(rad) * 1e9)).toBeLessThanOrEqual(0.5 + 1e-6);
      expect(Math.abs(Number(ZONE_COS_E18[i]) - Math.cos(rad) * 1e18)).toBeLessThan(2048);
    });
  });

  it('has eight bands and eight zone stages', () => {
    expect(BAND_NAMES).toHaveLength(8);
    expect(BAND_KM).toHaveLength(7);
    expect(ZONE_DEG).toHaveLength(8);
    expect(ZONE_SIN_E9).toHaveLength(8);
    expect(ZONE_COS_E18).toHaveLength(8);
    expect(Number(EARTH_RADIUS_E4) / 1e4).toBe(EARTH_RADIUS_KM);
  });
});

describe('isqrt', () => {
  it('handles small values', () => {
    const expected = [0, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3];
    expected.forEach((root, n) => expect(isqrt(BigInt(n))).toBe(BigInt(root)));
  });

  it('is the floor of the square root around perfect squares', () => {
    const rand = mulberry32(11);
    for (let i = 0; i < 2000; i += 1) {
      const root = BigInt(Math.floor(rand() * 2 ** 32)) * BigInt(Math.floor(rand() * 2 ** 31)) + 1n;
      expect(isqrt(root * root)).toBe(root);
      expect(isqrt(root * root - 1n)).toBe(root - 1n);
      expect(isqrt(root * root + 2n * root)).toBe(root);
      expect(isqrt((root + 1n) * (root + 1n))).toBe(root + 1n);
    }
  });

  it('covers the range the geometry uses', () => {
    expect(isqrt(4n * UNIT_E18)).toBe(2_000_000_000n);
    expect(isqrt(UNIT_E18 * UNIT_E18)).toBe(UNIT_E18);
    expect(() => isqrt(-1n)).toThrow(RangeError);
  });
});

describe('fromLatLon and toLatLon', () => {
  it('maps the cardinal points exactly', () => {
    expect(fromLatLon(0, 0)).toEqual([SCALE, 0, 0]);
    expect(fromLatLon(0, 90)).toEqual([0, SCALE, 0]);
    expect(fromLatLon(90, 0)).toEqual([0, 0, SCALE]);
    expect(fromLatLon(-90, 123)).toEqual([0, 0, -SCALE]);
    expect(fromLatLon(0, 180)).toEqual([-SCALE, 0, 0]);
    expect(fromLatLon(0, -90)).toEqual([0, -SCALE, 0]);
  });

  it('never yields negative zero', () => {
    for (const v of [fromLatLon(0, 180), fromLatLon(-90, 0), fromLatLon(0, -90)]) {
      for (const c of v) expect(Object.is(c, -0)).toBe(false);
    }
  });

  it('rounds each component to the nearest unit', () => {
    // Kyiv: 50.4501 N, 30.5234 E
    const [x, y, z] = fromLatLon(50.4501, 30.5234);
    const lat = (50.4501 * Math.PI) / 180;
    const lon = (30.5234 * Math.PI) / 180;
    expect(Math.abs(x - Math.cos(lat) * Math.cos(lon) * 1e9)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(y - Math.cos(lat) * Math.sin(lon) * 1e9)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(z - Math.sin(lat) * 1e9)).toBeLessThanOrEqual(0.5);
  });

  it('always produces a valid unit vector', () => {
    const rand = mulberry32(1);
    for (let i = 0; i < 5000; i += 1) {
      expect(isUnit(randomPoint(rand))).toBe(true);
    }
  });

  it('round-trips through toLatLon', () => {
    const rand = mulberry32(2);
    for (let i = 0; i < 2000; i += 1) {
      // Longitude loses precision towards the poles, so stay below 85°.
      const lat = 170 * rand() - 85;
      const lon = 359.9 * rand() - 179.95;
      const back = toLatLon(fromLatLon(lat, lon));
      expect(back.lat).toBeCloseTo(lat, 6);
      expect(back.lon).toBeCloseTo(lon, 5);
    }
  });

  it('rejects coordinates that are not on the globe', () => {
    expect(() => fromLatLon(90.01, 0)).toThrow(RangeError);
    expect(() => fromLatLon(-91, 0)).toThrow(RangeError);
    expect(() => fromLatLon(Number.NaN, 0)).toThrow(RangeError);
    expect(() => fromLatLon(0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('isUnit', () => {
  it('accepts squared lengths within 4e9 of 1e18 and nothing beyond', () => {
    // (1e9 + d)² − 1e18 = 2e9·d + d²
    expect(isUnit([SCALE + 1, 0, 0])).toBe(true);
    expect(isUnit([SCALE + 2, 0, 0])).toBe(false);
    expect(isUnit([SCALE - 2, 0, 0])).toBe(true);
    expect(isUnit([SCALE - 3, 0, 0])).toBe(false);
    expect(isUnit([SCALE, 63245, 0])).toBe(true); // + 3_999_930_025
    expect(isUnit([SCALE, 63245, 264])).toBe(true); // + 3_999_999_721
    expect(isUnit([SCALE, 63245, 265])).toBe(false); // + 4_000_000_250
  });

  it('rejects non-integers, overflowing components and the zero vector', () => {
    expect(isUnit([0, 0, 0])).toBe(false);
    expect(isUnit([0.5, 0, SCALE])).toBe(false);
    expect(isUnit([2147483648, 0, 0])).toBe(false);
    expect(isUnit([Number.NaN, 0, SCALE])).toBe(false);
    expect(isUnit([0, SCALE] as unknown as Vec3)).toBe(false);
  });
});

describe('dot', () => {
  it('is exact beyond the double range', () => {
    expect(dot([SCALE, 0, 0], [SCALE, 0, 0])).toBe(UNIT_E18);
    expect(dot([SCALE, 0, 0], [-SCALE, 0, 0])).toBe(-UNIT_E18);
    expect(dot([999999999, 999999998, 999999997], [999999996, 999999995, 999999994])).toBe(
      999999999n * 999999996n + 999999998n * 999999995n + 999999997n * 999999994n,
    );
    expect(dot([123456789, -987654321, 555555555], [-314159265, 271828182, 141421356])).toBe(
      -228689952691941927n,
    );
  });

  it('is symmetric', () => {
    const rand = mulberry32(3);
    for (let i = 0; i < 500; i += 1) {
      const a = randomPoint(rand);
      const b = randomPoint(rand);
      expect(dot(a, b)).toBe(dot(b, a));
    }
  });
});

describe('bandOf', () => {
  it('puts a dot product exactly on a threshold into the nearer band', () => {
    BAND_COS_E18.forEach((threshold, i) => {
      expect(bandOf(threshold + 1n)).toBe(i);
      expect(bandOf(threshold)).toBe(i);
      expect(bandOf(threshold - 1n)).toBe(i + 1);
    });
  });

  it('covers the extremes', () => {
    expect(bandOf(UNIT_E18 + 4_000_000_000n)).toBe(0);
    expect(bandOf(UNIT_E18)).toBe(0);
    expect(bandOf(0n)).toBe(7);
    expect(bandOf(-UNIT_E18)).toBe(7);
  });

  it('is monotonic in the dot product', () => {
    const rand = mulberry32(4);
    for (let i = 0; i < 2000; i += 1) {
      const a = BigInt(Math.floor((2 * rand() - 1) * 1e9)) * 1_000_000_000n;
      const b = BigInt(Math.floor((2 * rand() - 1) * 1e9)) * 1_000_000_000n;
      const [lo, hi] = a < b ? [a, b] : [b, a];
      expect(bandOf(lo)).toBeGreaterThanOrEqual(bandOf(hi));
    }
  });
});

describe('bandBetween', () => {
  const origin = fromLatLon(12, 34);
  const along = (km: number): Vec3 =>
    render.fromFloat(render.destination(render.toFloat(origin), 0.7, km / EARTH_RADIUS_KM));

  it('is a strike at the same point', () => {
    expect(bandBetween(origin, origin)).toBe(0);
  });

  it('changes band one kilometre either side of every threshold', () => {
    BAND_KM.forEach((km, i) => {
      expect(bandBetween(origin, along(km - 1))).toBe(i);
      expect(bandBetween(origin, along(km + 1))).toBe(i + 1);
    });
  });

  it('resolves the strike radius to within a few metres', () => {
    expect(bandBetween(origin, along(49.99))).toBe(0);
    expect(bandBetween(origin, along(50.01))).toBe(1);
  });

  it('agrees with the great-circle distance for random pairs', () => {
    const rand = mulberry32(5);
    for (let i = 0; i < 3000; i += 1) {
      const a = randomPoint(rand);
      const b = randomPoint(rand);
      const km = render.distanceKm(a, b);
      if (BAND_KM.some((edge) => Math.abs(km - edge) < 0.01)) continue;
      expect(bandBetween(a, b)).toBe(BAND_KM.filter((edge) => km > edge).length);
    }
  });

  it('is frozen at the antipode', () => {
    expect(bandBetween(origin, [-origin[0], -origin[1], -origin[2]])).toBe(7);
  });
});

describe('chordE9', () => {
  it('is zero for coincident points and clamps dot products above one', () => {
    expect(chordE9(UNIT_E18)).toBe(0);
    expect(chordE9(UNIT_E18 + 4_000_000_000n)).toBe(0);
  });

  it('is 2e9 at the antipode and sqrt(2)·1e9 at a right angle', () => {
    expect(chordE9(-UNIT_E18)).toBe(2_000_000_000);
    expect(chordE9(0n)).toBe(1_414_213_562);
  });

  it('floors the square root', () => {
    expect(chordE9(UNIT_E18 - 1n)).toBe(1);
    expect(chordE9(UNIT_E18 - 2n)).toBe(2);
    expect(chordE9(UNIT_E18 - 4n)).toBe(2);
    expect(chordE9(UNIT_E18 - 5n)).toBe(3);
  });

  it('matches the float chord', () => {
    const rand = mulberry32(6);
    for (let i = 0; i < 1000; i += 1) {
      const a = randomPoint(rand);
      const b = randomPoint(rand);
      const angle = render.angleBetween(render.toFloat(a), render.toFloat(b));
      const chord = chordE9(dot(a, b));
      // Lattice points are off the unit sphere by up to 2e-9, which moves the dot product by
      // up to 4e9 and the chord by that divided by the chord itself.
      expect(Math.abs(chord - 2e9 * Math.sin(angle / 2))).toBeLessThan(2 + 4e9 / Math.max(chord, 1));
    }
  });
});

describe('travelSecs', () => {
  const a = fromLatLon(0, 0);

  it('takes 16 s to the antipode at the default speed', () => {
    // 12742.0176 km / 800 km/s = 15.93 s
    expect(travelSecs(a, fromLatLon(0, 180), 800)).toBe(16);
  });

  it('never takes less than a second', () => {
    expect(travelSecs(a, a, 800)).toBe(1);
    expect(travelSecs(a, fromLatLon(0, 0.001), 800)).toBe(1);
  });

  it('rounds up', () => {
    // A quarter turn is a chord of 6371.0088·√2 = 9009.97 km.
    const b = fromLatLon(0, 90);
    expect(travelSecs(a, b, 800)).toBe(12);
    expect(travelSecs(a, b, 9009)).toBe(2);
    expect(travelSecs(a, b, 9010)).toBe(1);
    expect(travelSecs(a, b, 1)).toBe(9010);
  });

  it('equals the ceiling of the rational formula', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 2000; i += 1) {
      const p = randomPoint(rand);
      const q = randomPoint(rand);
      const speed = 1 + Math.floor(rand() * 3000);
      const chord = BigInt(chordE9(dot(p, q)));
      const secs = BigInt(travelSecs(p, q, speed));
      const den = 10_000_000_000_000n * BigInt(speed);
      const num = chord * 63_710_088n;
      if (secs > 1n) {
        expect(secs * den >= num).toBe(true);
        expect((secs - 1n) * den < num).toBe(true);
      } else {
        expect(num <= den).toBe(true);
      }
    }
  });

  it('is symmetric and rejects a bad speed', () => {
    const b = fromLatLon(48.85, 2.35);
    expect(travelSecs(a, b, 800)).toBe(travelSecs(b, a, 800));
    expect(() => travelSecs(a, b, 0)).toThrow(RangeError);
    expect(() => travelSecs(a, b, 1.5)).toThrow(RangeError);
  });
});

describe('normalize', () => {
  it('rounds half away from zero, symmetrically in sign', () => {
    expect(normalize([1n, 0n, 0n])).toEqual([SCALE, 0, 0]);
    expect(normalize([0n, -7n, 0n])).toEqual([0, -SCALE, 0]);
    // |v| = isqrt(9 + 16) = 5
    expect(normalize([3n, 4n, 0n])).toEqual([600000000, 800000000, 0]);
    expect(normalize([-3n, 0n, -4n])).toEqual([-600000000, 0, -800000000]);
    // 1e9 / 3 = 333333333.33 → down, 2e9 / 3 = 666666666.67 → up; isqrt(1 + 4 + 4) = 3
    expect(normalize([1n, 2n, -2n])).toEqual([333333333, 666666667, -666666667]);
    // exact halves: isqrt(0 + 0 + 4·10^18) = 2·10^9, 1 · 1e9 / 2e9 = 0.5 → 1
    expect(normalize([1n, -1n, 2_000_000_000n])).toEqual([1, -1, SCALE]);
  });

  it('maps the zero vector to the north pole', () => {
    expect(normalize([0n, 0n, 0n])).toEqual([0, 0, SCALE]);
  });

  it('returns valid unit vectors for inputs at scale 1e18', () => {
    const rand = mulberry32(8);
    for (let i = 0; i < 3000; i += 1) {
      const v = [0, 0, 0].map(() => BigInt(Math.floor((2 * rand() - 1) * 1e9)) * 1_000_000_007n);
      const out = normalize(v as [bigint, bigint, bigint]);
      expect(isUnit(out)).toBe(true);
    }
  });
});

describe('zoneStageAt', () => {
  it('advances one stage per interval and stops at eight', () => {
    expect(zoneStageAt(1000, 1000, 60)).toBe(0);
    expect(zoneStageAt(1059, 1000, 60)).toBe(0);
    expect(zoneStageAt(1060, 1000, 60)).toBe(1);
    expect(zoneStageAt(1479, 1000, 60)).toBe(7);
    expect(zoneStageAt(1480, 1000, 60)).toBe(8);
    expect(zoneStageAt(999999, 1000, 60)).toBe(8);
  });

  it('stays at zero before the start or without an interval', () => {
    expect(zoneStageAt(900, 1000, 60)).toBe(0);
    expect(zoneStageAt(5000, 1000, 0)).toBe(0);
  });
});

describe('inZone', () => {
  it('treats stage 0 as the whole globe', () => {
    expect(inZone(fromLatLon(-33, 151), { stage: 0, center: [0, 0, 0] })).toBe(true);
  });

  it('includes the boundary of the cap', () => {
    const center: Vec3 = [SCALE, 0, 0];
    // Stage 2 has a 60° radius: cos = 0.5 exactly.
    expect(inZone([500000000, 866025404, 0], { stage: 2, center })).toBe(true);
    expect(inZone([499999999, 866025404, 0], { stage: 2, center })).toBe(false);
    // Stage 1 is a hemisphere.
    expect(inZone([0, SCALE, 0], { stage: 1, center })).toBe(true);
    expect(inZone([-1, SCALE, 0], { stage: 1, center })).toBe(false);
  });

  it('rejects an unknown stage', () => {
    expect(() => inZone([SCALE, 0, 0], { stage: 9, center: [SCALE, 0, 0] })).toThrow(RangeError);
  });
});
