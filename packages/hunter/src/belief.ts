import type { Rng } from './rng.js';
import { SPHERE_AREA, bandInterval, fibonacciLattice, tangentFrame } from './sphere.js';
import type { F3 } from './sphere.js';

/** Below this many survivors a refill first looks for more before it trusts their extent. */
const SEED_MIN = 32;
/** A filter that leaves at least this share of the samples does not trigger a refill. */
const KEEP_FRACTION = 0.75;
const SEED_BUDGET = 1_500_000;
const FILL_BUDGET_PER_SAMPLE = 400;
/** Survivors within 35° of their mean direction are boxed in a tangent plane. */
const COMPACT_COS = Math.cos((35 * Math.PI) / 180);
const FIELDS = 5;

/**
 * Region samples are proposed from.
 *
 * `ring`: the set of points whose cosine to `c` lies in [a0, a1], sampled uniformly by area.
 * `box`:  a rectangle [a0, a1] × [b0, b1] in the tangent plane at `c`, projected through the
 *         centre of the sphere; samples are thinned so they are uniform on the sphere as well.
 * `area` is the measure the acceptance rate is taken against: steradians for a ring, plane
 * units for a box (the thinning makes both estimates come out in steradians).
 */
interface Proposal {
  kind: 'ring' | 'box';
  c: F3;
  e1: F3;
  e2: F3;
  a0: number;
  a1: number;
  b0: number;
  b1: number;
  area: number;
}

const WHOLE_SPHERE: Proposal = {
  kind: 'ring',
  c: [0, 0, 1],
  e1: [1, 0, 0],
  e2: [0, 1, 0],
  a0: -1,
  a1: 1,
  b0: 0,
  b1: 0,
  area: SPHERE_AREA,
};

/**
 * The set of places the treasure can still be, represented by sample points spread uniformly
 * over it.
 *
 * Every observation is a constraint lo ≤ dot(axis, treasure) < hi: a band is an annulus around
 * the probe, a zone stage is a cap. Adding one drops the samples it rules out and tops the set
 * back up by rejection sampling, so the resolution follows the region as it shrinks from the
 * whole globe to a few kilometres. New samples are always tested against every constraint, so
 * the set never contains an impossible point.
 */
export class Belief {
  readonly size: number;
  /** Sample points as x, y, z triples; the first `count` are live. */
  readonly points: Float64Array;
  count = 0;
  /** Estimated area of the feasible region in steradians. */
  area = SPHERE_AREA;
  /** True when no feasible point could be found; the constraints are kept. */
  lost = false;

  private readonly rng: Rng;
  private cons = new Float64Array(FIELDS * 16);
  private consCount = 0;
  private proposal: Proposal = WHOLE_SPHERE;

  constructor(size: number, rng: Rng) {
    this.size = size;
    this.rng = rng;
    this.points = new Float64Array(3 * size);
    this.reset();
  }

  /** Forgets every constraint and returns to the whole globe. */
  reset(): void {
    fibonacciLattice(this.size, this.points);
    this.count = this.size;
    this.area = SPHERE_AREA;
    this.lost = false;
    this.consCount = 0;
    this.proposal = WHOLE_SPHERE;
  }

  get constraintCount(): number {
    return this.consCount;
  }

  /** A probe at `pos` returned `band`. */
  addBand(pos: readonly number[], band: number): void {
    const { lo, hi } = bandInterval(band);
    this.add(pos, lo, hi);
  }

  /** The treasure is within the cap around `center` whose radius has cosine `cosMin`. */
  addCap(center: readonly number[], cosMin: number): void {
    this.add(center, cosMin, Infinity);
  }

  feasible(x: number, y: number, z: number): boolean {
    const cons = this.cons;
    // Newest first: recent constraints are the ones that cut through the current region.
    for (let o = FIELDS * (this.consCount - 1); o >= 0; o -= FIELDS) {
      const d = x * (cons[o] as number) + y * (cons[o + 1] as number) + z * (cons[o + 2] as number);
      if (d < (cons[o + 3] as number) || d >= (cons[o + 4] as number)) return false;
    }
    return true;
  }

  /** Mean direction of the samples. */
  mean(): F3 {
    const pts = this.points;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let i = 0; i < 3 * this.count; i += 3) {
      sx += pts[i] as number;
      sy += pts[i + 1] as number;
      sz += pts[i + 2] as number;
    }
    const n = Math.hypot(sx, sy, sz);
    return n > 1e-9 ? [sx / n, sy / n, sz / n] : [0, 0, 1];
  }

  /** Root-mean-square distance of the samples from `center`, as a chord on the unit sphere. */
  spread(center: readonly number[]): number {
    if (this.count === 0) return 0;
    const pts = this.points;
    const cx = center[0] as number;
    const cy = center[1] as number;
    const cz = center[2] as number;
    let sum = 0;
    for (let i = 0; i < 3 * this.count; i += 3) {
      sum += 2 * (1 - ((pts[i] as number) * cx + (pts[i + 1] as number) * cy + (pts[i + 2] as number) * cz));
    }
    return Math.sqrt(Math.max(0, sum / this.count));
  }

  private add(axis: readonly number[], lo: number, hi: number): void {
    if (FIELDS * (this.consCount + 1) > this.cons.length) {
      const grown = new Float64Array(this.cons.length * 2);
      grown.set(this.cons);
      this.cons = grown;
    }
    const n = Math.hypot(axis[0] as number, axis[1] as number, axis[2] as number);
    const o = FIELDS * this.consCount;
    this.cons[o] = (axis[0] as number) / n;
    this.cons[o + 1] = (axis[1] as number) / n;
    this.cons[o + 2] = (axis[2] as number) / n;
    this.cons[o + 3] = lo;
    this.cons[o + 4] = hi;
    this.consCount += 1;

    const before = this.count;
    this.filterByLast();
    if (before > 0) {
      this.area *= this.count > 0 ? this.count / before : 0.5 / before;
    }
    this.lost = false;
    this.refill();
  }

  private filterByLast(): void {
    const cons = this.cons;
    const o = FIELDS * (this.consCount - 1);
    const ax = cons[o] as number;
    const ay = cons[o + 1] as number;
    const az = cons[o + 2] as number;
    const lo = cons[o + 3] as number;
    const hi = cons[o + 4] as number;
    const pts = this.points;
    let kept = 0;
    for (let i = 0; i < 3 * this.count; i += 3) {
      const x = pts[i] as number;
      const y = pts[i + 1] as number;
      const z = pts[i + 2] as number;
      const d = x * ax + y * ay + z * az;
      if (d < lo || d >= hi) continue;
      pts[kept] = x;
      pts[kept + 1] = y;
      pts[kept + 2] = z;
      kept += 3;
    }
    this.count = kept / 3;
  }

  private refill(): void {
    if (this.count >= KEEP_FRACTION * this.size) return;

    if (this.count < SEED_MIN) {
      // Too few survivors to outline the region. Look for more inside the last region that was
      // sampled, or inside the tightest single constraint if that is smaller.
      const exact = this.tightest();
      const first = this.proposal.area <= exact.area ? this.proposal : exact;
      this.seed(first);
      if (this.count === 0 && first !== exact) this.seed(exact);
      if (this.count === 0) {
        this.lost = true;
        return;
      }
    }

    const exact = this.tightest();
    const box = this.boxAround();
    const proposal = box !== null && box.area < exact.area ? box : exact;
    const { tries, accepted } = this.draw(proposal, this.size, this.size * FILL_BUDGET_PER_SAMPLE);
    if (accepted >= 16) this.area = (proposal.area * accepted) / tries;
    this.proposal = proposal;
  }

  private seed(proposal: Proposal): void {
    const { tries, accepted } = this.draw(proposal, SEED_MIN, SEED_BUDGET);
    if (tries > 0) this.area = (proposal.area * Math.max(accepted, 0.5)) / tries;
  }

  private draw(proposal: Proposal, target: number, budget: number): { tries: number; accepted: number } {
    const { c, e1, e2, a0, a1, b0, b1 } = proposal;
    const ring = proposal.kind === 'ring';
    const pts = this.points;
    const rng = this.rng;
    let tries = 0;
    let accepted = 0;
    while (this.count < target && tries < budget) {
      tries += 1;
      let x: number;
      let y: number;
      let z: number;
      if (ring) {
        const w = a0 + (a1 - a0) * rng.next();
        const s = Math.sqrt(Math.max(0, 1 - w * w));
        const phi = 2 * Math.PI * rng.next();
        const p = s * Math.cos(phi);
        const q = s * Math.sin(phi);
        x = w * c[0] + p * e1[0] + q * e2[0];
        y = w * c[1] + p * e1[1] + q * e2[1];
        z = w * c[2] + p * e1[2] + q * e2[2];
      } else {
        const u = a0 + (a1 - a0) * rng.next();
        const v = b0 + (b1 - b0) * rng.next();
        const q = 1 + u * u + v * v;
        // The projection stretches area by q^(3/2); thin the samples by the inverse.
        if (rng.next() * q * Math.sqrt(q) > 1) continue;
        const inv = 1 / Math.sqrt(q);
        x = (c[0] + u * e1[0] + v * e2[0]) * inv;
        y = (c[1] + u * e1[1] + v * e2[1]) * inv;
        z = (c[2] + u * e1[2] + v * e2[2]) * inv;
      }
      if (!this.feasible(x, y, z)) continue;
      const o = 3 * this.count;
      pts[o] = x;
      pts[o + 1] = y;
      pts[o + 2] = z;
      this.count += 1;
      accepted += 1;
    }
    return { tries, accepted };
  }

  /** The single constraint with the smallest area, as a proposal that surely contains the region. */
  private tightest(): Proposal {
    const cons = this.cons;
    let best = -1;
    let bestArea = SPHERE_AREA;
    for (let i = 0; i < this.consCount; i += 1) {
      const o = FIELDS * i;
      const lo = Math.max(-1, cons[o + 3] as number);
      const hi = Math.min(1, cons[o + 4] as number);
      const area = 2 * Math.PI * (hi - lo);
      if (area < bestArea) {
        bestArea = area;
        best = i;
      }
    }
    if (best < 0) return WHOLE_SPHERE;
    const o = FIELDS * best;
    const c: F3 = [cons[o] as number, cons[o + 1] as number, cons[o + 2] as number];
    const { e1, e2 } = tangentFrame(c);
    return {
      kind: 'ring',
      c,
      e1,
      e2,
      a0: Math.max(-1, cons[o + 3] as number),
      a1: Math.min(1, cons[o + 4] as number),
      b0: 0,
      b1: 0,
      area: bestArea,
    };
  }

  /**
   * An oriented rectangle in the tangent plane at the mean of the samples that covers them with
   * a margin, or null when they are too spread out for a single tangent plane. The margin grows
   * as samples get scarce, because few samples say little about how far the region extends.
   */
  private boxAround(): Proposal | null {
    const pts = this.points;
    const n = this.count;
    if (n === 0) return null;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let i = 0; i < 3 * n; i += 3) {
      sx += pts[i] as number;
      sy += pts[i + 1] as number;
      sz += pts[i + 2] as number;
    }
    const norm = Math.hypot(sx, sy, sz);
    if (norm < 0.5 * n) return null;
    const c: F3 = [sx / norm, sy / norm, sz / norm];
    const frame = tangentFrame(c);

    let su = 0;
    let sv = 0;
    let suu = 0;
    let svv = 0;
    let suv = 0;
    for (let i = 0; i < 3 * n; i += 3) {
      const x = pts[i] as number;
      const y = pts[i + 1] as number;
      const z = pts[i + 2] as number;
      const d = x * c[0] + y * c[1] + z * c[2];
      if (d < COMPACT_COS) return null;
      const u = (x * frame.e1[0] + y * frame.e1[1] + z * frame.e1[2]) / d;
      const v = (x * frame.e2[0] + y * frame.e2[1] + z * frame.e2[2]) / d;
      su += u;
      sv += v;
      suu += u * u;
      svv += v * v;
      suv += u * v;
    }
    const mu = su / n;
    const mv = sv / n;
    const theta = 0.5 * Math.atan2(2 * (suv / n - mu * mv), suu / n - mu * mu - (svv / n - mv * mv));
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    const e1: F3 = [
      ct * frame.e1[0] + st * frame.e2[0],
      ct * frame.e1[1] + st * frame.e2[1],
      ct * frame.e1[2] + st * frame.e2[2],
    ];
    const e2: F3 = [
      ct * frame.e2[0] - st * frame.e1[0],
      ct * frame.e2[1] - st * frame.e1[1],
      ct * frame.e2[2] - st * frame.e1[2],
    ];

    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (let i = 0; i < 3 * n; i += 3) {
      const x = pts[i] as number;
      const y = pts[i + 1] as number;
      const z = pts[i + 2] as number;
      const d = x * c[0] + y * c[1] + z * c[2];
      const u = (x * e1[0] + y * e1[1] + z * e1[2]) / d;
      const v = (x * e2[0] + y * e2[1] + z * e2[2]) / d;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    const spacing = Math.sqrt(this.area / n);
    const marginU = Math.max((6 * (u1 - u0)) / n, 2.5 * spacing);
    const marginV = Math.max((6 * (v1 - v0)) / n, 2.5 * spacing);
    u0 -= marginU;
    u1 += marginU;
    v0 -= marginV;
    v1 += marginV;
    return { kind: 'box', c, e1, e2, a0: u0, a1: u1, b0: v0, b1: v1, area: (u1 - u0) * (v1 - v0) };
  }
}
