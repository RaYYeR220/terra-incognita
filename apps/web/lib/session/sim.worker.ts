/// <reference lib="webworker" />
/**
 * A whole hunt in a worker: the simulator, its sealed treasure and a few solver bots. The page
 * only ever receives what a player could read on chain: the public board and its own logbook.
 */
import { HuntStatus, MAX_PROBES, PROBE_COOLDOWN_SECS, bytesToHex, canonical } from '@terra-incognita/core';
import type { Vec3 } from '@terra-incognita/core';
import { SHADOW, SURVEYOR, SimHunt, Solver, WANDERER } from '@terra-incognita/hunter';
import type { Personality } from '@terra-incognita/hunter';

import type { FromSim, SimConfig, ToSim } from './sim-protocol';

declare const self: DedicatedWorkerGlobalScope;

const ME = 'guest';

interface Bot {
  name: string;
  solver: Solver;
  think: [number, number];
  nextAt: number;
  heading: boolean;
}

let sim: SimHunt | null = null;
let bots: Bot[] = [];
let config: SimConfig;
let lastPosted = -1;
let timer: ReturnType<typeof setInterval> | null = null;

const post = (msg: FromSim) => self.postMessage(msg);
const nowSecs = () => Math.floor(Date.now() / 1000);

function lineup(count: number): { personality: Personality; think: [number, number] }[] {
  const strong = [
    { personality: SURVEYOR, think: [22, 40] as [number, number] },
    { personality: SHADOW, think: [16, 32] as [number, number] },
  ];
  const out = strong.slice(0, Math.min(2, Math.max(0, count - 1)));
  while (out.length < count) out.push({ personality: WANDERER, think: [10, 22] });
  return out;
}

function between([lo, hi]: [number, number], scale = 1): number {
  return Math.round((lo + Math.random() * (hi - lo)) * scale);
}

function stepBot(hunt: SimHunt, bot: Bot, warmup: boolean): void {
  const now = hunt.now;
  if (now < bot.nextAt) return;
  const state = hunt.publicState();
  if (state.status !== HuntStatus.Live) return;
  const shipIndex = state.ships.findIndex((s) => s.owner === bot.name);
  const logbook = hunt.logbook(bot.name);
  const view = { now, state, logbook, shipIndex };
  if (shipIndex < 0) {
    hunt.embark(bot.name, bot.solver.chooseStart(view));
    bot.nextAt = now + PROBE_COOLDOWN_SECS + between(bot.think, warmup ? 2 : 0.5);
    return;
  }
  const ship = state.ships[shipIndex]!;
  if (ship.probes >= MAX_PROBES) return;
  if (now < ship.arriveTs) {
    bot.nextAt = ship.arriveTs;
    return;
  }
  if (now < ship.lastProbeTs + PROBE_COOLDOWN_SECS) {
    bot.nextAt = ship.lastProbeTs + PROBE_COOLDOWN_SECS;
    return;
  }
  if (!bot.heading) {
    const target = bot.solver.nextProbe(view);
    const here = canonical(target);
    if (here[0] !== ship.to[0] || here[1] !== ship.to[1] || here[2] !== ship.to[2]) {
      hunt.setCourse(bot.name, target);
      bot.heading = true;
      bot.nextAt = hunt.publicState().ships[shipIndex]!.arriveTs;
      return;
    }
  }
  hunt.probe(bot.name);
  bot.heading = false;
  bot.nextAt = now + between(bot.think, warmup ? 3.5 : 1);
}

function create(): SimHunt {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const start = nowSecs() - config.warmupSecs;
    const hunt = new SimHunt({
      randomness: crypto.getRandomValues(new Uint8Array(32)),
      hunt: crypto.getRandomValues(new Uint8Array(32)),
      startsAt: start,
      durationSecs: config.durationSecs,
      zoneIntervalSecs: config.zoneIntervalSecs,
    });
    hunt.join(ME);
    bots = lineup(config.bots).map((b, i) => ({
      name: `bot-${i + 1}`,
      solver: new Solver(b.personality, (Math.random() * 2 ** 31) | 0),
      think: b.think,
      nextAt: start + between([2, 40]),
      heading: false,
    }));
    for (const bot of bots) hunt.join(bot.name);
    // Play the part of the hunt that happened before the visitor arrived.
    for (let t = start; t <= nowSecs(); t += 1) {
      hunt.advanceTo(t);
      for (const bot of bots) stepBot(hunt, bot, true);
      if (hunt.ended) break;
    }
    if (!hunt.ended) return hunt;
  }
  throw new Error('could not start a hunt');
}

function snapshot(hunt: SimHunt): FromSim {
  const state = hunt.publicState();
  const shipIndex = state.ships.findIndex((s) => s.owner === ME);
  const winnerShip = state.winner === null ? null : state.ships.findIndex((s) => s.owner === state.winner);
  const pot = config.prizeSol + state.ships.length * config.entryFeeSol * 0.9;
  const ended = state.status !== HuntStatus.Live;
  return {
    type: 'snapshot',
    info: {
      id: config.id,
      number: config.number,
      title: config.title,
      mode: 0,
      clue: null,
      commitmentHex: bytesToHex(hunt.commitment),
      startsAt: state.startsAt,
      deadline: state.deadline,
      zoneIntervalSecs: state.zoneIntervalSecs,
      speedKms: state.speedKms,
      maxProbes: MAX_PROBES,
      entryFeeSol: config.entryFeeSol,
      network: 'simulator',
    },
    view: {
      status: state.status,
      readAt: hunt.now,
      zone: state.zone,
      ships: state.ships,
      pins: state.pins,
      probesTotal: state.probesTotal,
      potSol: Math.round(pot * 1000) / 1000,
      winnerShip: winnerShip !== null && winnerShip >= 0 ? winnerShip : null,
      settlement:
        ended && winnerShip !== null && winnerShip >= 0
          ? { shipIndex: winnerShip, payoutSol: Math.round(pot * 1000) / 1000, signature: null, explorerUrl: null }
          : null,
      revealed: ended ? hunt.reveal().revealedLocation : null,
    },
    shipIndex,
    logbook: hunt.logbook(ME),
  };
}

function publish(force = false): void {
  if (!sim) return;
  if (!force && sim.now === lastPosted) return;
  lastPosted = sim.now;
  post(snapshot(sim));
}

function loop(): void {
  if (!sim) return;
  const before = sim.now;
  sim.advanceTo(nowSecs());
  let acted = false;
  if (!sim.ended) {
    for (const bot of bots) {
      const probes = sim.publicState().probesTotal;
      stepBot(sim, bot, false);
      if (sim.publicState().probesTotal !== probes) acted = true;
    }
  }
  publish(acted || sim.now !== before);
}

function act(id: number, fn: (hunt: SimHunt) => unknown): void {
  if (!sim) return;
  try {
    sim.advanceTo(nowSecs());
    const value = fn(sim);
    post({ type: 'result', id, ok: true, value });
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'Error';
    post({ type: 'result', id, ok: false, error: code });
  }
  publish(true);
}

self.onmessage = (event: MessageEvent<ToSim>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      config = msg.config;
      try {
        sim = create();
        publish(true);
        timer ??= setInterval(loop, 250);
      } catch (error) {
        post({ type: 'failed', error: String(error) });
      }
      break;
    case 'embark':
      act(msg.id, (hunt) => hunt.embark(ME, msg.at as Vec3));
      break;
    case 'course':
      act(msg.id, (hunt) => hunt.setCourse(ME, msg.at as Vec3));
      break;
    case 'probe':
      act(msg.id, (hunt) => hunt.probe(ME));
      break;
  }
};
