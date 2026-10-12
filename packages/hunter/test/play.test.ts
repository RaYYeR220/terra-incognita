import { HuntStatus, MAX_PROBES, fromLatLon, travelSecs } from '@terra-incognita/core';
import type { Vec3 } from '@terra-incognita/core';
import { describe, expect, it } from 'vitest';

import { SimHunt, runHunter } from '../src/index.js';
import type { Strategy } from '../src/index.js';
import { antipode, pointAt, randomnessFor, route } from './helpers.js';

const T0 = 1_760_000_000;

function newHunt(durationSecs = 10_000): SimHunt {
  return new SimHunt({ randomness: randomnessFor(2), zoneIntervalSecs: 0, durationSecs });
}

describe('runHunter', () => {
  it('embarks, flies, waits out the cooldown and reports a strike', async () => {
    const sim = newHunt();
    const { location } = sim.peek();
    const start = antipode(location);
    const stops: Vec3[] = [pointAt(location, 0, 3000), pointAt(location, 0, 2990), pointAt(location, 1, 20)];
    const courses: Vec3[] = [];
    const bands: number[] = [];
    const result = await runHunter(sim.join('a'), route(start, stops), {
      onCourse: (dest) => courses.push(dest),
      onProbe: (entry, index) => {
        expect(index).toBe(bands.length);
        bands.push(entry.band);
      },
    });

    expect(result).toEqual({
      outcome: 'struck',
      probes: 4,
      finishedAt: sim.endTime,
      status: HuntStatus.Struck,
    });
    expect(bands).toEqual([7, 5, 5, 0]);
    expect(courses).toEqual(stops);

    const log = sim.logbook('a');
    const firstLeg = travelSecs(start, stops[0]!, 800);
    expect(log.map((entry) => entry.ts - T0)).toEqual([
      // Embarking starts the cooldown, so even the first probe waits three seconds.
      3,
      3 + firstLeg,
      // 10 km takes one second to fly, but the cooldown holds the probe back.
      6 + firstLeg,
      6 + firstLeg + travelSecs(stops[1]!, stops[2]!, 800),
    ]);
  });

  it('probes on the spot when the strategy returns the current position', async () => {
    const sim = newHunt();
    const far = antipode(sim.peek().location);
    let decisions = 0;
    const strategy: Strategy = {
      chooseStart: () => far,
      nextProbe: (view) => {
        decisions += 1;
        return view.state.ships[view.shipIndex]!.to;
      },
    };
    const result = await runHunter(sim.join('a'), strategy, { shouldStop: () => decisions >= 5 });
    expect(result.outcome).toBe('stopped');
    expect(result.probes).toBe(5);
    expect(sim.logbook('a').map((entry) => entry.ts - T0)).toEqual([3, 6, 9, 12, 15]);
    expect(sim.publicState().ships[0]!.departTs).toBe(T0);
  });

  it('gives up when the 64 probes are spent', async () => {
    const sim = newHunt();
    const result = await runHunter(sim.join('a'), route(antipode(sim.peek().location), []));
    expect(result.outcome).toBe('exhausted');
    expect(result.probes).toBe(MAX_PROBES);
    expect(result.status).toBe(HuntStatus.Live);
    expect(result.finishedAt).toBe(T0 + 64 * 3);
  });

  it('reports a win by closest sounding at the deadline', async () => {
    const sim = newHunt(20);
    const result = await runHunter(sim.join('a'), route(antipode(sim.peek().location), []));
    expect(result.outcome).toBe('closest');
    expect(result.status).toBe(HuntStatus.Closest);
    // Probes at 3, 6, ..., 18; the one due at 21 is past the deadline.
    expect(result.probes).toBe(6);
  });

  it('reports a defeat when a rival strikes first', async () => {
    const sim = newHunt();
    const { location } = sim.peek();
    const loser = sim.join('slow');
    const winner = sim.join('quick');
    const results = await sim.play([
      () => runHunter(loser, route(antipode(location), [])),
      () => runHunter(winner, route(fromLatLon(0, 0), [location])),
    ]);
    expect(results[0]!.outcome).toBe('beaten');
    expect(results[1]!.outcome).toBe('struck');
    expect(results[0]!.status).toBe(HuntStatus.Struck);
    expect(sim.publicState().winner).toBe('quick');
    // The loser stopped probing as soon as the hunt was over.
    const strikeAt = sim.endTime!;
    expect(sim.logbook('slow').every((entry) => entry.ts <= strikeAt)).toBe(true);
    expect(results[0]!.probes).toBe(sim.logbook('slow').length);
  });

  it('reports a defeat by a closer rival at the deadline', async () => {
    const sim = newHunt(30);
    const { location } = sim.peek();
    const a = sim.join('near');
    const b = sim.join('far');
    const results = await sim.play([
      () => runHunter(a, route(pointAt(location, 0, 500), [])),
      () => runHunter(b, route(pointAt(location, 0, 5000), [])),
    ]);
    expect(results.map((r) => r.outcome)).toEqual(['closest', 'beaten']);
  });

  it('passes on failures that are not the end of the hunt', async () => {
    const sim = newHunt();
    const broken: Strategy = { chooseStart: () => [1, 2, 3], nextProbe: () => [1, 2, 3] };
    await expect(runHunter(sim.join('a'), broken)).rejects.toMatchObject({ code: 'InvalidPosition' });
  });
});
