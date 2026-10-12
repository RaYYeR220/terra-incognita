import { describe, expect, it } from 'vitest';

import { SPRINTER, SURVEYOR, WANDERER, benchRace, benchSolo, createRng, formatRace, formatSolo, hashSeed, summarize } from '../src/index.js';

describe('summarize', () => {
  it('reports order statistics', () => {
    const values = Array.from({ length: 100 }, (_, i) => 100 - i);
    expect(summarize(values)).toEqual({ min: 1, p10: 11, median: 51, mean: 50.5, p90: 91, max: 100 });
    expect(summarize([7])).toEqual({ min: 7, p10: 7, median: 7, mean: 7, p90: 7, max: 7 });
    expect(summarize([])).toBeNull();
  });
});

describe('random source', () => {
  it('is reproducible, roughly uniform and forkable', () => {
    const a = createRng(123);
    const b = createRng(123);
    const first = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(first);
    expect(createRng(124).next()).not.toBe(first[0]);

    const rng = createRng(9);
    const buckets = new Array<number>(10).fill(0);
    let sum = 0;
    for (let i = 0; i < 50_000; i += 1) {
      const x = rng.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      sum += x;
      buckets[rng.int(10)]! += 1;
    }
    expect(Math.abs(sum / 50_000 - 0.5)).toBeLessThan(0.01);
    for (const count of buckets) expect(Math.abs(count - 5000)).toBeLessThan(300);

    const fork = rng.fork();
    expect(fork.next()).not.toBe(rng.next());
    expect(hashSeed('surveyor')).toBe(hashSeed('surveyor'));
    expect(hashSeed('surveyor')).not.toBe(hashSeed('sprinter'));
  });
});

describe('benchmarks', () => {
  it('accounts for every solo hunt', async () => {
    const config = { hunts: 12, seed: 3, zoneIntervalSecs: 0, durationSecs: 86_400 };
    const stats = await benchSolo(SURVEYOR, config);
    expect(stats.hunts).toBe(12);
    expect(stats.struck + stats.exhausted + stats.timedOut).toBe(12);
    expect(stats.struck).toBe(12);
    expect(stats.probes!.min).toBeGreaterThanOrEqual(1);
    expect(stats.probes!.max).toBeLessThanOrEqual(64);
    // A probe every three seconds at best.
    expect(stats.secs!.mean).toBeGreaterThanOrEqual(3 * (stats.probes!.mean - 1));
    expect(await benchSolo(SURVEYOR, config)).toEqual(stats);

    const table = formatSolo([stats]);
    expect(table).toContain('surveyor');
    expect(table).toContain('100.0%');
    expect(table.split('\n')).toHaveLength(3);
  });

  it('counts a deadline that comes first as a failure', async () => {
    const stats = await benchSolo(WANDERER, { hunts: 6, seed: 1, zoneIntervalSecs: 0, durationSecs: 10 });
    expect(stats.struck + stats.exhausted + stats.timedOut).toBe(6);
    expect(stats.timedOut).toBeGreaterThan(0);
  });

  it('awards every race to exactly one entrant', async () => {
    const stats = await benchRace([SURVEYOR, SPRINTER, WANDERER], {
      hunts: 6,
      seed: 5,
      zoneIntervalSecs: 60,
      durationSecs: 900,
    });
    expect(stats.entrants.map((e) => e.personality)).toEqual(['surveyor', 'sprinter', 'wanderer']);
    expect(stats.entrants.reduce((s, e) => s + e.wins, 0)).toBe(6);
    expect(stats.entrants.reduce((s, e) => s + e.strikes, 0) + stats.unstruck).toBe(6);
    expect(formatRace(stats)).toContain('sprinter');
  });
});
