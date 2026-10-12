import { HuntStatus, MAX_PROBES, auditHunt, bandBetween, fromLatLon, inZone, isUnit, render } from '@terra-incognita/core';
import type { LogEntry, Pin, Ship, Vec3 } from '@terra-incognita/core';
import { describe, expect, it } from 'vitest';

import { PERSONALITIES, SHADOW, SPRINTER, SURVEYOR, SimHunt, Solver, WANDERER, runHunter } from '../src/index.js';
import type { HunterResult, Personality, PublicState, SolverView } from '../src/index.js';
import { pointAt, randomnessFor } from './helpers.js';

const T0 = 1_760_000_000;

interface Played {
  result: HunterResult;
  path: Vec3[];
  sim: SimHunt;
}

async function playSolo(personality: Personality, seed: number, options: { zoneIntervalSecs?: number } = {}): Promise<Played> {
  const sim = new SimHunt({
    randomness: randomnessFor(seed),
    zoneIntervalSecs: options.zoneIntervalSecs ?? 0,
    durationSecs: 86_400,
  });
  const path: Vec3[] = [];
  const result = await runHunter(sim.join('solo'), new Solver(personality, seed), {
    onProbe: (entry) => path.push(entry.pos),
  });
  return { result, path, sim };
}

const mean = (values: number[]): number => values.reduce((s, v) => s + v, 0) / values.length;

interface Scene {
  now?: number;
  logbook?: LogEntry[];
  shipIndex?: number;
  ships?: Ship[];
  pins?: Pin[];
  state?: Partial<PublicState>;
}

function view(overrides: Scene): SolverView {
  const state: PublicState = {
    status: HuntStatus.Live,
    startsAt: T0,
    deadline: T0 + 900,
    speedKms: 800,
    zoneIntervalSecs: 0,
    zone: { stage: 0, center: [0, 0, 0] },
    ships: overrides.ships ?? [],
    pins: overrides.pins ?? [],
    probesTotal: 0,
    winner: null,
    ...overrides.state,
  };
  return { now: overrides.now ?? T0, state, logbook: overrides.logbook ?? [], shipIndex: overrides.shipIndex ?? -1 };
}

function parked(owner: string, at: Vec3, probes = 0, lastProbeTs = 0): Ship {
  return { owner, from: at, to: at, departTs: T0, arriveTs: T0, probes, lastProbeTs, embarked: true };
}

describe('convergence on fixed seeds', () => {
  const seeds = Array.from({ length: 25 }, (_, i) => i + 1);

  for (const personality of [SURVEYOR, SPRINTER, SHADOW]) {
    it(`${personality.name} strikes every hunt well inside the probe cap`, async () => {
      const probes: number[] = [];
      const secs: number[] = [];
      for (const seed of seeds) {
        const { result, sim } = await playSolo(personality, seed);
        expect(result.outcome).toBe('struck');
        expect(sim.publicState().winner).toBe('solo');
        expect(auditHunt(sim.reveal()).allOk).toBe(true);
        probes.push(result.probes);
        secs.push(result.finishedAt - T0);
      }
      expect(Math.max(...probes)).toBeLessThanOrEqual(30);
      expect(mean(probes)).toBeLessThan(16);
      expect(mean(secs)).toBeLessThan(60);
    });
  }

  it('the surveyor needs fewer probes than the sprinter, the sprinter less time per probe', async () => {
    const surveyor = await Promise.all(seeds.map((seed) => playSolo(SURVEYOR, seed)));
    const sprinter = await Promise.all(seeds.map((seed) => playSolo(SPRINTER, seed)));
    const probesOf = (runs: Played[]): number => mean(runs.map((r) => r.result.probes));
    const paceOf = (runs: Played[]): number =>
      mean(runs.map((r) => (r.result.finishedAt - T0) / Math.max(1, r.result.probes - 1)));
    expect(probesOf(surveyor)).toBeLessThan(probesOf(sprinter));
    expect(paceOf(sprinter)).toBeLessThan(paceOf(surveyor));
  });

  it('the wanderer is clearly worse but does not break', async () => {
    const wandering: number[] = [];
    const surveying: number[] = [];
    for (const seed of seeds.slice(0, 12)) {
      const lost = await playSolo(WANDERER, seed);
      expect(['struck', 'exhausted']).toContain(lost.result.outcome);
      expect(lost.result.probes).toBeLessThanOrEqual(MAX_PROBES);
      wandering.push(lost.result.outcome === 'struck' ? lost.result.probes : MAX_PROBES);
      surveying.push((await playSolo(SURVEYOR, seed)).result.probes);
    }
    expect(mean(wandering)).toBeGreaterThan(1.5 * mean(surveying));
  });

  it('replays identically from the same seed and differently from another', async () => {
    const first = await playSolo(SPRINTER, 5);
    const again = await playSolo(SPRINTER, 5);
    expect(again.path).toEqual(first.path);
    expect(again.result).toEqual(first.result);

    const sim = new SimHunt({ randomness: randomnessFor(5), zoneIntervalSecs: 0, durationSecs: 86_400 });
    const other: Vec3[] = [];
    await runHunter(sim.join('solo'), new Solver(SPRINTER, 6), { onProbe: (e) => other.push(e.pos) });
    expect(other).not.toEqual(first.path);
  });

  it('only ever asks for valid positions and respects the rules', async () => {
    const { path, sim } = await playSolo(SURVEYOR, 3);
    for (const pos of path) expect(isUnit(pos)).toBe(true);
    const log = sim.logbook('solo');
    for (let i = 1; i < log.length; i += 1) {
      expect(log[i]!.ts - log[i - 1]!.ts).toBeGreaterThanOrEqual(3);
    }
    expect(new Set(path.map((p) => p.join(','))).size).toBe(path.length);
  });
});

describe('endgame', () => {
  it('closes in from a first sounding 100 km out', async () => {
    for (let seed = 1; seed <= 15; seed += 1) {
      const sim = new SimHunt({ randomness: randomnessFor(seed), zoneIntervalSecs: 0, durationSecs: 86_400 });
      const start = pointAt(sim.peek().location, seed, 100);
      const solver = new Solver(SURVEYOR, seed);
      solver.chooseStart = () => start;
      const result = await runHunter(sim.join('solo'), solver);
      expect(result.outcome).toBe('struck');
      // Band 1 alone leaves an annulus eight times the strike cap.
      expect(result.probes).toBeLessThanOrEqual(9);
    }
  });

  it('refines a region far below the strike radius without stalling', () => {
    // Six soundings from 2499 km out, all "within 2500": their edges pass a kilometre beyond the
    // truth on every side and leave a pocket a couple of kilometres across.
    const truth = fromLatLon(-12, 77);
    const logbook: LogEntry[] = [0.2, 1.25, 2.3, 3.35, 4.4, 5.45].map((bearing, i) => {
      const pos = pointAt(truth, bearing, 2499 + 0.1 * i);
      return { pos, band: bandBetween(pos, truth), ts: T0 + 3 * i };
    });
    expect(logbook.every((entry) => entry.band === 4)).toBe(true);
    const at = logbook[5]!.pos;
    const solver = new Solver(SURVEYOR, 1);
    const next = solver.nextProbe(view({ now: T0 + 18, logbook, ships: [parked('me', at, 6, T0 + 15)], shipIndex: 0 }));
    expect(solver.belief.lost).toBe(false);
    expect(solver.belief.count).toBe(SURVEYOR.samples);
    expect(solver.estimate().radiusKm).toBeLessThan(5);
    expect(solver.estimate().areaKm2).toBeLessThan(60);
    expect(render.distanceKm(solver.estimate().center, truth)).toBeLessThan(5);
    expect(bandBetween(next, truth)).toBe(0);
  });
});

describe('use of public information', () => {
  it('searches inside the zone', async () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const sim = new SimHunt({ randomness: randomnessFor(seed), zoneIntervalSecs: 4, durationSecs: 86_400 });
      const zones: PublicState['zone'][] = [];
      const client = sim.join('solo');
      const result = await runHunter(client, new Solver(SURVEYOR, seed), {
        onProbe: () => zones.push(sim.publicState().zone),
      });
      expect(result.outcome).toBe('struck');
      const log = sim.logbook('solo');
      // From the third probe on the solver has seen the cap that was current when it decided.
      for (let i = 2; i < log.length; i += 1) {
        const decidedUnder = zones[i - 1]!;
        if (decidedUnder.stage >= 2) expect(inZone(log[i]!.pos, { ...decidedUnder, stage: decidedUnder.stage - 1 })).toBe(true);
      }
    }
  });

  it('starts inside the zone when the hunt is already under way', () => {
    const center = fromLatLon(40, -100);
    const solver = new Solver(SURVEYOR, 2);
    const start = solver.chooseStart(view({ state: { zone: { stage: 6, center } } }));
    expect(isUnit(start)).toBe(true);
    expect(render.distanceKm(start, center)).toBeLessThan((9 * Math.PI * 6371.0088) / 180);
  });

  it('starts anywhere while nothing is known', () => {
    const starts = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => new Solver(SURVEYOR, seed).chooseStart(view({})));
    for (const start of starts) expect(isUnit(start)).toBe(true);
    expect(new Set(starts.map((s) => s.join(','))).size).toBe(8);
  });

  it('rebuilds its belief from a logbook it did not write', () => {
    const truth = fromLatLon(8, 8);
    const logbook: LogEntry[] = [9000, 4000, 1800, 600].map((km, i) => {
      const pos = pointAt(truth, i * 1.3, km);
      return { pos, band: bandBetween(pos, truth), ts: T0 + 10 * i };
    });
    const at = logbook[3]!.pos;
    const solver = new Solver(SPRINTER, 4);
    const next = solver.nextProbe(view({ now: T0 + 40, logbook, ships: [parked('me', at, 4, T0 + 30)], shipIndex: 0 }));
    expect(isUnit(next)).toBe(true);
    expect(solver.belief.lost).toBe(false);
    expect(solver.belief.feasible(...render.toFloat(truth))).toBe(true);
    expect(render.distanceKm(solver.estimate().center, truth)).toBeLessThan(1500);
    expect(render.distanceKm(next, truth)).toBeLessThan(3000);
  });

  it('the shadow is drawn to where a rival keeps probing, the surveyor is not', () => {
    const truth = fromLatLon(20, 20);
    const myPos = pointAt(truth, 1, 4000);
    const logbook: LogEntry[] = [{ pos: myPos, band: bandBetween(myPos, truth), ts: T0 }];
    const rivalPins: Pin[] = [0, 1, 2, 3, 4, 5].map((i) => ({
      shipIndex: 1,
      pos: pointAt(truth, i * 2, 60 + 10 * i),
      ts: T0 + 3 * i,
    }));
    const ships = [parked('me', myPos, 1, T0), parked('rival', rivalPins[5]!.pos, 6, T0 + 15)];
    const scene = (): SolverView => view({ now: T0 + 20, logbook, ships, pins: rivalPins, shipIndex: 0 });

    // The rival's last three pins sit about 100 km from the treasure. The hint is a prior, not a
    // fact, so the shadow may still prefer a sounding that tests it from a distance.
    let followed = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const shadow = new Solver(SHADOW, seed).nextProbe(scene());
      const surveyor = new Solver(SURVEYOR, seed).nextProbe(scene());
      if (render.distanceKm(shadow, truth) < 250) followed += 1;
      expect(render.distanceKm(surveyor, truth)).toBeGreaterThan(500);
    }
    expect(followed).toBeGreaterThanOrEqual(5);
  });

  it('the shadow ignores rivals that are still scattered or outside its own region', () => {
    const truth = fromLatLon(20, 20);
    const myPos = pointAt(truth, 1, 700);
    const logbook: LogEntry[] = [{ pos: myPos, band: bandBetween(myPos, truth), ts: T0 }];
    const far = fromLatLon(-60, -150);
    const decoys: Pin[] = [0, 1, 2, 3, 4].map((i) => ({ shipIndex: 1, pos: pointAt(far, i, 40), ts: T0 + 3 * i }));
    const scattered: Pin[] = [0, 1, 2, 3, 4].map((i) => ({ shipIndex: 2, pos: pointAt(truth, i, 2500), ts: T0 + 3 * i }));
    const ships = [parked('me', myPos, 1, T0), parked('decoy', far, 5, T0 + 12), parked('roamer', truth, 5, T0 + 12)];
    const withRivals = new Solver(SHADOW, 3).nextProbe(
      view({ now: T0 + 20, logbook, ships, pins: [...decoys, ...scattered], shipIndex: 0 }),
    );
    const alone = new Solver(SHADOW, 3).nextProbe(view({ now: T0 + 20, logbook, ships: [ships[0]!], shipIndex: 0 }));
    expect(withRivals).toEqual(alone);
  });
});

describe('races', () => {
  it('runs every personality in one hunt with a single winner and a clean audit', async () => {
    const wins = new Map<string, number>();
    for (let seed = 1; seed <= 8; seed += 1) {
      const sim = new SimHunt({ randomness: randomnessFor(seed), zoneIntervalSecs: 60, durationSecs: 900 });
      const entrants = Object.values(PERSONALITIES);
      const results = await sim.play(
        entrants.map((p, i) => {
          const client = sim.join(p.name);
          const solver = new Solver(p, 100 * seed + i);
          return () => runHunter(client, solver);
        }),
      );
      const state = sim.publicState();
      expect(state.status).toBe(HuntStatus.Struck);
      expect(results.filter((r) => r.outcome === 'struck')).toHaveLength(1);
      expect(results.filter((r) => r.outcome === 'beaten')).toHaveLength(3);
      const winner = entrants[results.findIndex((r) => r.outcome === 'struck')]!.name;
      expect(state.winner).toBe(winner);
      wins.set(winner, (wins.get(winner) ?? 0) + 1);

      const report = auditHunt(sim.reveal());
      expect(report.allOk).toBe(true);
      expect(report.entries).toHaveLength(state.probesTotal);
      expect(report.entries.filter((e) => e.recordedBand === 0)).toHaveLength(1);
    }
    expect(wins.get('wanderer') ?? 0).toBeLessThanOrEqual(1);
  });

  it('is reproducible', async () => {
    const run = async (): Promise<string> => {
      const sim = new SimHunt({ randomness: randomnessFor(42), zoneIntervalSecs: 60, durationSecs: 900 });
      const results = await sim.play(
        [SURVEYOR, SPRINTER, SHADOW].map((p, i) => {
          const client = sim.join(p.name);
          const solver = new Solver(p, 7 + i);
          return () => runHunter(client, solver);
        }),
      );
      return JSON.stringify([results, sim.publicState().pins]);
    };
    expect(await run()).toBe(await run());
  });
});
