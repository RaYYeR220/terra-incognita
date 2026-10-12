import { EARTH_RADIUS_KM, PROBE_COOLDOWN_SECS, render } from '@terra-incognita/core';
import type { LogEntry, Pin, Ship, Vec3 } from '@terra-incognita/core';

import { Belief } from './belief.js';
import type { PublicState } from './client.js';
import type { Personality } from './personalities.js';
import { createRng } from './rng.js';
import type { Rng } from './rng.js';
import {
  BAND_COS,
  BAND_RAD,
  STRIKE_AREA,
  ZONE_COS,
  bandInterval,
  chordKm,
  dot3,
  fibonacciLattice,
  flightSecs,
  normalize3,
  offset,
} from './sphere.js';
import type { F3 } from './sphere.js';

/** What the solver is shown when it has to decide. */
export interface SolverView {
  now: number;
  state: PublicState;
  logbook: readonly LogEntry[];
  /** Index of the player's ship in `state.ships`, or −1 before embarking. */
  shipIndex: number;
}

/** Anything that can decide where a ship goes. `runHunter` drives one of these. */
export interface Strategy {
  /** Where to embark. */
  chooseStart(view: SolverView): Vec3;
  /** Position of the next probe; the ship's own position means "probe here". */
  nextProbe(view: SolverView): Vec3;
}

/** A summary of the belief for display. */
export interface Estimate {
  center: Vec3;
  /** Root-mean-square distance of the feasible region from its centre. */
  radiusKm: number;
  areaKm2: number;
}

/** Seconds a future probe is assumed to cost once the ship is in the right neighbourhood. */
const SECS_PER_PROBE = PROBE_COOLDOWN_SECS + 0.5;
/** A region is treated as one probe away from a strike once it is this share of the strike cap. */
const STRIKE_PACKING = 0.6;
const GLOBAL_CANDIDATES = 128;
/** Rival pins closer together than this (radians) are read as a rival closing in. */
const RIVAL_CLUSTER_RAD = 0.08;
const RIVAL_MIN_SIGMA = 0.02;
const RIVAL_MIN_PROBES = 4;
/** Points drawn around a rival cluster to stand for "the treasure is where they are looking". */
const HINTS_PER_RIVAL = 24;
const NO_HINTS = new Float64Array(0);

interface Context {
  /** Current position, or null when travel is free (choosing where to embark). */
  cur: F3 | null;
  cooldownLeft: number;
  speed: number;
  area: number;
  stride: number;
  /** Extra weighted points (x, y, z, weight) scored alongside the belief samples. */
  hints: Float64Array;
}

interface Rival {
  center: F3;
  sigma: number;
  confidence: number;
}

/**
 * Chooses where to probe next.
 *
 * The solver keeps a belief (see `Belief`) and scores a set of candidate positions against it.
 * For a candidate it splits the belief by the band each sample would produce, and estimates the
 * time left to a strike after each outcome from the area that outcome would leave. The score is
 * that expected remaining time plus the time the probe itself costs: a one-step lookahead on
 * information gain, discounted by travel. A strike ends the search, so strike chances are valued
 * at everything that is left to do.
 */
export class Solver implements Strategy {
  readonly personality: Personality;
  readonly belief: Belief;

  private readonly rng: Rng;
  private readonly rivalRng: Rng;
  private readonly lattice: Float64Array;
  private readonly hist = new Float64Array(8);
  private readonly dots = new Float64Array(8);
  private readonly caps = new Map<number, F3>();
  private readonly appliedCaps = new Set<number>();
  private appliedEntries = 0;
  private windowKey = '';

  constructor(personality: Personality, seed = 1) {
    this.personality = personality;
    this.rng = createRng(seed);
    this.belief = new Belief(personality.samples, this.rng.fork());
    this.rivalRng = this.rng.fork();
    this.lattice = fibonacciLattice(Math.max(8, Math.round(GLOBAL_CANDIDATES * personality.breadth)));
  }

  /** Where to embark. Travel is free at this point, so only information counts. */
  chooseStart(view: SolverView): Vec3 {
    this.sync(view);
    if (this.belief.constraintCount === 0) return render.fromFloat(this.randomDirection());
    if (this.belief.lost || this.belief.count === 0) return this.fallback(view);
    return render.fromFloat(this.decide(view, null));
  }

  /** Position of the next probe. Equal to the ship's position when it should probe on the spot. */
  nextProbe(view: SolverView): Vec3 {
    const me = view.state.ships[view.shipIndex];
    if (!me) throw new Error('the ship has not embarked');
    this.sync(view);
    if (this.belief.lost || this.belief.count === 0) return this.fallback(view);
    const cur = render.toFloat(me.to);
    const best = this.decide(view, cur);
    return best === cur ? me.to : render.fromFloat(best);
  }

  estimate(): Estimate {
    const center = this.belief.mean();
    return {
      center: render.fromFloat(center),
      radiusKm: this.belief.spread(center) * EARTH_RADIUS_KM,
      areaKm2: this.belief.area * EARTH_RADIUS_KM * EARTH_RADIUS_KM,
    };
  }

  /** Brings the belief up to date with the logbook and the zone. */
  private sync(view: SolverView): void {
    const { zone } = view.state;
    if (zone.stage >= 1 && !this.caps.has(zone.stage)) {
      this.caps.set(zone.stage, render.toFloat(zone.center));
    }
    const log = view.logbook;
    const memory = this.personality.memory;

    if (Number.isFinite(memory)) {
      // A forgetful hunter rebuilds from the newest zone and its last few soundings.
      const from = Math.max(0, log.length - memory);
      const key = `${from}:${log.length}:${zone.stage}`;
      if (key === this.windowKey) return;
      this.windowKey = key;
      this.belief.reset();
      const center = this.caps.get(zone.stage);
      if (center) this.belief.addCap(center, ZONE_COS[zone.stage - 1] as number);
      for (let i = from; i < log.length; i += 1) {
        const entry = log[i] as LogEntry;
        this.belief.addBand(render.toFloat(entry.pos), entry.band);
      }
      return;
    }

    if (log.length < this.appliedEntries) {
      this.belief.reset();
      this.appliedCaps.clear();
      this.appliedEntries = 0;
    }
    for (const [stage, center] of this.caps) {
      if (this.appliedCaps.has(stage)) continue;
      this.belief.addCap(center, ZONE_COS[stage - 1] as number);
      this.appliedCaps.add(stage);
    }
    for (let i = this.appliedEntries; i < log.length; i += 1) {
      const entry = log[i] as LogEntry;
      this.belief.addBand(render.toFloat(entry.pos), entry.band);
    }
    this.appliedEntries = log.length;
  }

  private decide(view: SolverView, cur: F3 | null): F3 {
    const p = this.personality;
    const belief = this.belief;
    const me: Ship | undefined = view.state.ships[view.shipIndex];
    const mean = belief.mean();
    const radius = belief.spread(mean);
    const rivals = p.rivalWeight > 0 ? this.rivals(view) : [];

    const stride = Math.max(1, Math.floor(belief.count / p.evalSamples));
    const speed = view.state.speedKms;
    const ctx: Context = {
      cur,
      cooldownLeft: me && me.probes > 0 ? Math.max(0, me.lastProbeTs + PROBE_COOLDOWN_SECS - view.now) : 0,
      speed,
      area: belief.area,
      stride,
      hints: this.hints(rivals, Math.ceil(belief.count / stride)),
    };

    const candidates = this.candidates(view, cur, mean, radius, ctx.hints);
    const scores = candidates.map((candidate) => this.score(candidate, ctx));
    const pick = this.choose(scores);
    let best = candidates[pick] as F3;
    let bestScore = scores[pick] as number;

    // Hill-climb around the winner at two scales of the region's size.
    for (let round = 0; round < p.refine; round += 1) {
      const step = Math.max(radius, 1e-4) * (round === 0 ? 0.5 : 0.2);
      const phase = 2 * Math.PI * this.rng.next();
      const origin = best;
      for (let k = 0; k < 8; k += 1) {
        const candidate = offset(origin, phase + (Math.PI * k) / 4, step);
        const value = this.score(candidate, ctx);
        if (value > bestScore) {
          best = candidate;
          bestScore = value;
        }
      }
    }
    return best;
  }

  /**
   * Negated expected seconds until a strike if the next probe is taken at `c`, so higher is better.
   */
  private score(c: F3, ctx: Context): number {
    const p = this.personality;
    const pts = this.belief.points;
    const hist = this.hist;
    const dots = this.dots;
    const hints = ctx.hints;
    hist.fill(0);
    dots.fill(0);
    const cx = c[0];
    const cy = c[1];
    const cz = c[2];
    const t0 = BAND_COS[0] as number;
    const t1 = BAND_COS[1] as number;
    const t2 = BAND_COS[2] as number;
    const t3 = BAND_COS[3] as number;
    const t4 = BAND_COS[4] as number;
    const t5 = BAND_COS[5] as number;
    const t6 = BAND_COS[6] as number;
    const end = 3 * this.belief.count;
    const step = 3 * ctx.stride;
    for (let i = 0; i < end; i += step) {
      const d = cx * (pts[i] as number) + cy * (pts[i + 1] as number) + cz * (pts[i + 2] as number);
      let band: number;
      if (d < t3) {
        if (d < t5) band = d < t6 ? 7 : 6;
        else band = d < t4 ? 5 : 4;
      } else if (d < t1) band = d < t2 ? 3 : 2;
      else band = d < t0 ? 1 : 0;
      hist[band] = (hist[band] as number) + 1;
      dots[band] = (dots[band] as number) + d;
    }
    for (let i = 0; i < hints.length; i += 4) {
      const d = cx * (hints[i] as number) + cy * (hints[i + 1] as number) + cz * (hints[i + 2] as number);
      let band = 0;
      for (const threshold of BAND_COS) {
        if (d < threshold) band += 1;
      }
      const w = hints[i + 3] as number;
      hist[band] = (hist[band] as number) + w;
      dots[band] = (dots[band] as number) + w * d;
    }
    let total = 0;
    for (let band = 0; band < 8; band += 1) total += hist[band] as number;

    // After a miss the search goes on in the part of the region that produced the band. What is
    // left costs probes, by its area, and a flight if it lies beyond a cooldown's reach from `c`.
    let future = 0;
    for (let band = 1; band < 8; band += 1) {
      const mass = hist[band] as number;
      if (mass <= 0) continue;
      const share = mass / total;
      const reach = chordKm((dots[band] as number) / mass) / ctx.speed - PROBE_COOLDOWN_SECS;
      future +=
        share * (SECS_PER_PROBE * this.probesLeft(ctx.area * share) + p.approach * Math.max(0, reach));
    }
    const strike = (hist[0] as number) / total;

    let wait = 0;
    if (ctx.cur !== null) {
      const flight = c === ctx.cur ? 0 : flightSecs(dot3(c, ctx.cur), ctx.speed);
      wait = Math.max(flight, ctx.cooldownLeft);
    }
    return SECS_PER_PROBE * p.strikeBias * strike - p.timeWeight * wait - future;
  }

  /** Expected number of probes still needed for a region of the given area, the strike included. */
  private probesLeft(area: number): number {
    const ratio = area / (STRIKE_AREA * STRIKE_PACKING);
    return ratio > 1 ? 1 + Math.log2(ratio) / this.personality.bitsPerProbe : 1;
  }

  private choose(scores: readonly number[]): number {
    let best = 0;
    for (let i = 1; i < scores.length; i += 1) {
      if ((scores[i] as number) > (scores[best] as number)) best = i;
    }
    const temperature = this.personality.temperature;
    if (temperature <= 0) return best;
    const top = scores[best] as number;
    const odds = scores.map((s) => Math.exp((s - top) / temperature));
    let total = 0;
    for (const o of odds) total += o;
    let roll = this.rng.next() * total;
    for (let i = 0; i < odds.length; i += 1) {
      roll -= odds[i] as number;
      if (roll <= 0) return i;
    }
    return best;
  }

  private candidates(view: SolverView, cur: F3 | null, mean: F3, radius: number, hints: Float64Array): F3[] {
    const p = this.personality;
    const belief = this.belief;
    const rng = this.rng;
    const out: F3[] = [];
    const perRing = Math.max(3, Math.round(8 * p.breadth));

    // Staying put is only worth a look if this spot has not been probed yet.
    if (cur !== null) {
      const me = view.state.ships[view.shipIndex] as Ship;
      const probedHere = view.logbook.some(
        (entry) => entry.pos[0] === me.to[0] && entry.pos[1] === me.to[1] && entry.pos[2] === me.to[2],
      );
      if (!probedHere) out.push(cur);
    }

    // Places the treasure may actually be: only these can strike.
    out.push(mean);
    const picks = Math.min(belief.count, Math.max(4, Math.round(40 * p.breadth)));
    for (let i = 0; i < picks; i += 1) {
      const o = 3 * rng.int(belief.count);
      out.push([belief.points[o] as number, belief.points[o + 1] as number, belief.points[o + 2] as number]);
    }

    // Positions whose band boundaries pass through the middle of the region.
    for (const ringRadius of BAND_RAD) {
      const phase = 2 * Math.PI * rng.next();
      for (let k = 0; k < perRing; k += 1) {
        out.push(offset(mean, phase + (2 * Math.PI * k) / perRing, ringRadius));
      }
    }

    // Short hops that fit inside the cooldown and therefore cost no extra time: all around, and
    // straight towards the region.
    if (cur !== null) {
      const freeChord = (PROBE_COOLDOWN_SECS * view.state.speedKms) / EARTH_RADIUS_KM;
      const freeAngle = 2 * Math.asin(Math.min(1, freeChord / 2));
      for (const share of [0.35, 0.7, 0.98]) {
        const phase = 2 * Math.PI * rng.next();
        for (let k = 0; k < perRing; k += 1) {
          out.push(offset(cur, phase + (2 * Math.PI * k) / perRing, share * freeAngle));
        }
      }
      const toMean = Math.acos(Math.max(-1, Math.min(1, dot3(cur, mean))));
      if (toMean > 0.98 * freeAngle && toMean < Math.PI - 1e-6) {
        const f = (0.98 * freeAngle) / toMean;
        const s = Math.sin(toMean);
        const a = Math.sin((1 - f) * toMean) / s;
        const b = Math.sin(f * toMean) / s;
        out.push(normalize3(a * cur[0] + b * mean[0], a * cur[1] + b * mean[1], a * cur[2] + b * mean[2]));
      }
    }

    // While the region is still continental, anywhere on the globe may be the best vantage point.
    if (radius > 0.35) {
      for (let i = 0; i < this.lattice.length; i += 3) {
        out.push([this.lattice[i] as number, this.lattice[i + 1] as number, this.lattice[i + 2] as number]);
      }
    }

    // A few of the places rivals point at: every sixth hint, four numbers per hint.
    for (let i = 0; i < hints.length; i += 4 * 6) {
      out.push([hints[i] as number, hints[i + 1] as number, hints[i + 2] as number]);
    }
    return out;
  }

  /**
   * Where each rival seems to be closing in: the centre of its last three pins, trusted more the
   * tighter they sit and the more probes the rival has spent.
   */
  private rivals(view: SolverView): Rival[] {
    const byShip = new Map<number, Pin[]>();
    for (const pin of view.state.pins) {
      if (pin.shipIndex === view.shipIndex) continue;
      const list = byShip.get(pin.shipIndex);
      if (list) list.push(pin);
      else byShip.set(pin.shipIndex, [pin]);
    }
    const out: Rival[] = [];
    for (const [shipIndex, pins] of byShip) {
      const ship = view.state.ships[shipIndex];
      if (!ship || ship.probes < RIVAL_MIN_PROBES || pins.length < 3) continue;
      const recent = pins.slice(-3).map((pin) => render.toFloat(pin.pos));
      const center = normalize3(
        recent.reduce((s, v) => s + v[0], 0),
        recent.reduce((s, v) => s + v[1], 0),
        recent.reduce((s, v) => s + v[2], 0),
      );
      let spreadAngle = 0;
      for (const v of recent) spreadAngle = Math.max(spreadAngle, Math.acos(Math.min(1, dot3(v, center))));
      const tightness = Math.max(0, 1 - spreadAngle / RIVAL_CLUSTER_RAD);
      const experience = Math.min(1, (ship.probes - RIVAL_MIN_PROBES + 1) / 6);
      const confidence = tightness * experience;
      if (confidence <= 0) continue;
      out.push({ center, sigma: Math.max(RIVAL_MIN_SIGMA, spreadAngle), confidence });
    }
    return out;
  }

  /**
   * Turns rival clusters into weighted points for scoring. Each cluster is given a share of the
   * belief in proportion to how convincing it is, spread over points around its centre that the
   * hunter's own soundings do not rule out. A cluster that contradicts them contributes nothing.
   */
  private hints(rivals: readonly Rival[], evaluated: number): Float64Array {
    if (rivals.length === 0) return NO_HINTS;
    const belief = this.belief;
    const rng = this.rivalRng;
    const out: number[] = [];
    for (const rival of rivals) {
      const kept: F3[] = [];
      if (belief.feasible(rival.center[0], rival.center[1], rival.center[2])) kept.push(rival.center);
      for (let i = kept.length; i < HINTS_PER_RIVAL; i += 1) {
        const angle = rival.sigma * Math.sqrt(-2 * Math.log(1 - rng.next()));
        const point = offset(rival.center, 2 * Math.PI * rng.next(), angle);
        if (belief.feasible(point[0], point[1], point[2])) kept.push(point);
      }
      const weight = (evaluated * this.personality.rivalWeight * rival.confidence) / Math.max(1, kept.length);
      for (const point of kept) out.push(point[0], point[1], point[2], weight);
    }
    return out.length === 0 ? NO_HINTS : Float64Array.from(out);
  }

  private randomDirection(): F3 {
    const z = 2 * this.rng.next() - 1;
    const r = Math.sqrt(1 - z * z);
    const phi = 2 * Math.PI * this.rng.next();
    return [r * Math.cos(phi), r * Math.sin(phi), z];
  }

  /**
   * Used when the belief could not be sampled: probe somewhere inside the annulus of the best
   * sounding so far, or inside the zone before the first sounding.
   */
  private fallback(view: SolverView): Vec3 {
    let bestEntry: LogEntry | undefined;
    for (const entry of view.logbook) {
      if (!bestEntry || entry.band <= bestEntry.band) bestEntry = entry;
    }
    const bearing = 2 * Math.PI * this.rng.next();
    if (bestEntry) {
      const { lo, hi } = bandInterval(bestEntry.band);
      const cos = Math.max(-1, lo) + (Math.min(1, hi) - Math.max(-1, lo)) * this.rng.next();
      return render.fromFloat(offset(render.toFloat(bestEntry.pos), bearing, Math.acos(cos)));
    }
    const { zone } = view.state;
    if (zone.stage >= 1) {
      const cosMin = ZONE_COS[zone.stage - 1] as number;
      const cos = cosMin + (1 - cosMin) * this.rng.next();
      return render.fromFloat(offset(render.toFloat(zone.center), bearing, Math.acos(cos)));
    }
    return render.fromFloat(this.randomDirection());
  }
}
