import { HuntStatus, MAX_PROBES, PROBE_COOLDOWN_SECS } from '@terra-incognita/core';
import type { LogEntry, Vec3 } from '@terra-incognita/core';

import { HuntError } from './client.js';
import type { HuntClient, PublicState } from './client.js';
import type { SolverView, Strategy } from './solver.js';

export type HunterOutcome =
  /** This hunter probed within the strike radius. */
  | 'struck'
  /** The deadline passed and this hunter's best sounding was the closest. */
  | 'closest'
  /** Somebody else won. */
  | 'beaten'
  /** The deadline passed without a single probe. */
  | 'void'
  /** All probes are spent and the hunt is still running. */
  | 'exhausted'
  /** Stopped by the caller. */
  | 'stopped';

export interface HunterResult {
  outcome: HunterOutcome;
  /** Probes this hunter took. */
  probes: number;
  /** Time of the last thing this hunter saw: its strike, the end of the hunt, or giving up. */
  finishedAt: number;
  status: HuntStatus;
}

export interface RunOptions {
  /** Called after every probe with the new logbook entry. */
  onProbe?: (entry: LogEntry, index: number) => void;
  /** Called before every flight with the destination. */
  onCourse?: (dest: Vec3) => void;
  /** Return true to make the hunter stop at the next decision. */
  shouldStop?: () => boolean;
}

function sameVec(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/**
 * Plays a hunt to the end with the given strategy: embark, then fly and probe until the hunt is
 * over or the probes run out. Works against anything that implements `HuntClient`.
 */
export async function runHunter(
  client: HuntClient,
  solver: Strategy,
  options: RunOptions = {},
): Promise<HunterResult> {
  let probes = 0;

  const finish = async (state: PublicState, exhausted = false, stopped = false): Promise<HunterResult> => {
    const now = await client.now();
    let outcome: HunterOutcome;
    if (state.status === HuntStatus.Struck) outcome = state.winner === client.player ? 'struck' : 'beaten';
    else if (state.status === HuntStatus.Closest) outcome = state.winner === client.player ? 'closest' : 'beaten';
    else if (state.status === HuntStatus.Void) outcome = 'void';
    else if (stopped) outcome = 'stopped';
    else if (exhausted) outcome = 'exhausted';
    else outcome = 'beaten';
    return { outcome, probes, finishedAt: now, status: state.status };
  };

  for (;;) {
    const state = await client.getPublicState();
    if (state.status !== HuntStatus.Live) return finish(state);
    if (options.shouldStop?.()) return finish(state, false, true);

    const now = await client.now();
    const logbook = await client.getMyLogbook();
    const shipIndex = state.ships.findIndex((ship) => ship.embarked && ship.owner === client.player);
    const view: SolverView = { now, state, logbook, shipIndex };
    probes = logbook.length;

    try {
      if (shipIndex < 0) {
        await client.embark(solver.chooseStart(view));
        continue;
      }
      const me = state.ships[shipIndex]!;
      if (me.probes >= MAX_PROBES) return finish(state, true);
      if (now < me.arriveTs) {
        await client.sleepUntil(me.arriveTs);
        continue;
      }

      const target = solver.nextProbe(view);
      let readyAt = me.probes > 0 ? me.lastProbeTs + PROBE_COOLDOWN_SECS : now;
      if (!sameVec(target, me.to)) {
        options.onCourse?.(target);
        await client.setCourse(target);
        const flying = (await client.getPublicState()).ships[shipIndex];
        if (flying) readyAt = Math.max(readyAt, flying.arriveTs);
      }
      if (readyAt > now) await client.sleepUntil(readyAt);

      // The hunt may have ended while the ship was in the air.
      const arrived = await client.getPublicState();
      if (arrived.status !== HuntStatus.Live) return finish(arrived);

      const entry = await client.probe();
      probes += 1;
      options.onProbe?.(entry, probes - 1);
    } catch (error) {
      // A rival can end the hunt between our read and our action; anything else is a real failure.
      if (!(error instanceof HuntError) || error.code !== 'NotLive') throw error;
    }
  }
}
