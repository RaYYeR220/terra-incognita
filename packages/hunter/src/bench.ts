import { DEFAULT_SPEED_KMS } from '@terra-incognita/core';

import type { Personality } from './personalities.js';
import { runHunter } from './play.js';
import type { HunterResult } from './play.js';
import { createRng } from './rng.js';
import type { Rng } from './rng.js';
import { SimHunt } from './sim.js';
import { Solver } from './solver.js';

export interface BenchConfig {
  hunts: number;
  seed: number;
  /** Seconds between zone stages; 0 switches the zone off. */
  zoneIntervalSecs: number;
  /** Seconds from the start of a hunt to its deadline. */
  durationSecs: number;
  speedKms?: number;
}

export interface Summary {
  min: number;
  p10: number;
  median: number;
  mean: number;
  p90: number;
  max: number;
}

export interface SoloStats {
  personality: string;
  hunts: number;
  /** Hunts that ended with a strike. */
  struck: number;
  /** Hunts in which all 64 probes were spent without a strike. */
  exhausted: number;
  /** Hunts in which the deadline passed first. */
  timedOut: number;
  /** Probes used, over the hunts that ended with a strike. */
  probes: Summary | null;
  /** Seconds from the start to the strike, over the same hunts. */
  secs: Summary | null;
}

export interface RaceStats {
  hunts: number;
  /** Hunts nobody struck before the deadline. */
  unstruck: number;
  /** Seconds to the winning strike, over the hunts that had one. */
  secs: Summary | null;
  entrants: { personality: string; wins: number; strikes: number; meanProbes: number }[];
}

export function summarize(values: readonly number[]): Summary | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number;
  return {
    min: sorted[0] as number,
    p10: at(0.1),
    median: at(0.5),
    mean: sorted.reduce((s, v) => s + v, 0) / sorted.length,
    p90: at(0.9),
    max: sorted[sorted.length - 1] as number,
  };
}

function randomness(rng: Rng): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) out[i] = rng.int(256);
  return out;
}

function newHunt(rng: Rng, config: BenchConfig): SimHunt {
  return new SimHunt({
    randomness: randomness(rng),
    zoneIntervalSecs: config.zoneIntervalSecs,
    durationSecs: config.durationSecs,
    speedKms: config.speedKms ?? DEFAULT_SPEED_KMS,
  });
}

/** One hunter alone against `config.hunts` hunts. */
export async function benchSolo(personality: Personality, config: BenchConfig): Promise<SoloStats> {
  const rng = createRng(config.seed);
  const probes: number[] = [];
  const secs: number[] = [];
  let exhausted = 0;
  let timedOut = 0;
  for (let i = 0; i < config.hunts; i += 1) {
    const sim = newHunt(rng, config);
    const solverSeed = rng.int(2 ** 31);
    const result = await runHunter(sim.join(personality.name), new Solver(personality, solverSeed));
    if (result.outcome === 'struck') {
      probes.push(result.probes);
      secs.push(result.finishedAt - sim.startsAt);
    } else if (result.outcome === 'exhausted') {
      exhausted += 1;
    } else {
      timedOut += 1;
    }
  }
  return {
    personality: personality.name,
    hunts: config.hunts,
    struck: probes.length,
    exhausted,
    timedOut,
    probes: summarize(probes),
    secs: summarize(secs),
  };
}

/** All given hunters in the same hunt, `config.hunts` times. First strike wins. */
export async function benchRace(personalities: readonly Personality[], config: BenchConfig): Promise<RaceStats> {
  const rng = createRng(config.seed);
  const entrants = personalities.map((p) => ({ personality: p.name, wins: 0, strikes: 0, meanProbes: 0 }));
  const secs: number[] = [];
  let unstruck = 0;
  for (let i = 0; i < config.hunts; i += 1) {
    const sim = newHunt(rng, config);
    const seeds = personalities.map(() => rng.int(2 ** 31));
    const results: HunterResult[] = await sim.play(
      personalities.map((p, k) => {
        const client = sim.join(`${p.name}#${k}`);
        const solver = new Solver(p, seeds[k] as number);
        return () => runHunter(client, solver);
      }),
    );
    let struck = false;
    results.forEach((result, k) => {
      const entrant = entrants[k] as (typeof entrants)[number];
      entrant.meanProbes += result.probes / config.hunts;
      if (result.outcome === 'struck') {
        entrant.wins += 1;
        entrant.strikes += 1;
        struck = true;
      } else if (result.outcome === 'closest') {
        entrant.wins += 1;
      }
    });
    if (struck) secs.push((sim.endTime as number) - sim.startsAt);
    else unstruck += 1;
  }
  return { hunts: config.hunts, unstruck, secs: summarize(secs), entrants };
}

const pad = (text: string | number, width: number): string => String(text).padStart(width);
const fixed = (value: number, digits = 1): string => value.toFixed(digits);

function summaryCells(summary: Summary | null): string {
  if (!summary) return ['-', '-', '-', '-', '-', '-'].map((c) => pad(c, 7)).join('');
  return [
    fixed(summary.min, 0),
    fixed(summary.p10, 0),
    fixed(summary.median, 0),
    fixed(summary.mean),
    fixed(summary.p90, 0),
    fixed(summary.max, 0),
  ]
    .map((c) => pad(c, 7))
    .join('');
}

export function formatSolo(stats: readonly SoloStats[]): string {
  const left = (name: string, hunts: string | number, struck: string, spent: string | number, late: string | number): string =>
    `${name.padEnd(12)}${pad(hunts, 7)}${pad(struck, 8)}${pad(spent, 15)}${pad(late, 10)}`;
  const cols = ['min', 'p10', 'med', 'mean', 'p90', 'max'].map((c) => pad(c, 7)).join('');
  const blank = ' '.repeat(left('', '', '', '', '').length);
  const lines = [
    `${blank} | ${'probes to strike'.padEnd(cols.length)} | seconds to strike`,
    `${left('personality', 'hunts', 'struck', 'out of probes', 'deadline')} | ${cols} | ${cols}`,
  ];
  for (const s of stats) {
    const rate = `${fixed((100 * s.struck) / s.hunts)}%`;
    lines.push(
      `${left(s.personality, s.hunts, rate, s.exhausted, s.timedOut)} | ${summaryCells(s.probes)} | ${summaryCells(s.secs)}`,
    );
  }
  return lines.join('\n');
}

export function formatRace(stats: RaceStats): string {
  const lines = [`${'personality'.padEnd(12)}${pad('wins', 7)}${pad('share', 8)}${pad('strikes', 9)}${pad('probes/hunt', 13)}`];
  for (const e of stats.entrants) {
    lines.push(
      `${e.personality.padEnd(12)}${pad(e.wins, 7)}${pad(`${fixed((100 * e.wins) / stats.hunts)}%`, 8)}` +
        `${pad(e.strikes, 9)}${pad(fixed(e.meanProbes), 13)}`,
    );
  }
  const s = stats.secs;
  lines.push(
    `hunts ${stats.hunts}, ended without a strike ${stats.unstruck}` +
      (s ? `, seconds to the winning strike: median ${fixed(s.median, 0)}, mean ${fixed(s.mean)}, p90 ${fixed(s.p90, 0)}` : ''),
  );
  return lines.join('\n');
}
