/*
 * Plays simulated hunts with every personality and prints how many probes and how many seconds
 * each needs to strike.
 *
 *   npm run bench -- [--hunts 500] [--seed 1] [--out file] [--only surveyor,sprinter]
 *
 * Three settings are measured:
 *   solo, no zone   one hunter, the public zone never shrinks, no deadline to speak of:
 *                   the solver on its own
 *   solo, zone      one hunter in a hunt with the default schedule (a zone stage every 60 s,
 *                   deadline after 15 min)
 *   race            one hunter of each personality in the same hunt with the default schedule
 */
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { PERSONALITIES, benchRace, benchSolo, formatRace, formatSolo } from '../src/index.js';
import type { BenchConfig, Personality, SoloStats } from '../src/index.js';

const { values } = parseArgs({
  options: {
    hunts: { type: 'string', default: '500' },
    seed: { type: 'string', default: '1' },
    out: { type: 'string' },
    only: { type: 'string' },
  },
});

const hunts = Number(values.hunts);
const seed = Number(values.seed);
const wanted = values.only?.split(',');
const personalities: Personality[] = Object.values(PERSONALITIES).filter(
  (p) => !wanted || wanted.includes(p.name),
);

const noZone: BenchConfig = { hunts, seed, zoneIntervalSecs: 0, durationSecs: 86_400 };
const standard: BenchConfig = { hunts, seed, zoneIntervalSecs: 60, durationSecs: 900 };

const lines: string[] = [];
const say = (text = ''): void => {
  lines.push(text);
  console.log(text);
};

async function solo(title: string, config: BenchConfig): Promise<void> {
  const stats: SoloStats[] = [];
  for (const personality of personalities) {
    const started = Date.now();
    stats.push(await benchSolo(personality, config));
    console.error(`  ${personality.name}: ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
  say(title);
  say(formatSolo(stats));
  say();
}

say(`Terra Incognita solver benchmark: ${hunts} simulated hunts per row, seed ${seed}`);
say('Rules: speed 800 km/s, 3 s probe cooldown, 64 probes per ship, strike within 50 km.');
say('"out of probes" counts hunts in which all 64 probes were spent without a strike,');
say('"deadline" counts hunts in which the deadline passed first. Both are failures to strike.');
say('Probe and second statistics are taken over the hunts that ended with a strike.');
say();

await solo('Solo, zone off, no deadline', noZone);
await solo('Solo, zone stage every 60 s, deadline 900 s', standard);

if (personalities.length > 1) {
  const started = Date.now();
  const race = await benchRace(personalities, standard);
  console.error(`  race: ${((Date.now() - started) / 1000).toFixed(1)} s`);
  say(`Race: one of each in the same hunt, zone stage every 60 s, deadline 900 s`);
  say(formatRace(race));
  say();
}

if (values.out) {
  writeFileSync(values.out, `${lines.join('\n')}\n`);
  console.error(`saved to ${values.out}`);
}
