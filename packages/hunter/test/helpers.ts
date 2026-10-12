import { EARTH_RADIUS_KM, render } from '@terra-incognita/core';
import type { Vec3 } from '@terra-incognita/core';

import { createRng } from '../src/index.js';
import type { SolverView, Strategy } from '../src/index.js';

/** 32 bytes of stand-in randomness for hunt number `n`. */
export function randomnessFor(n: number): Uint8Array {
  const rng = createRng(n);
  return new Uint8Array(32).map(() => rng.int(256));
}

/** The point `km` away from `from` along `bearing` (radians, 0 = north). */
export function pointAt(from: Vec3, bearing: number, km: number): Vec3 {
  return render.fromFloat(render.destination(render.toFloat(from), bearing, km / EARTH_RADIUS_KM));
}

export function antipode(v: Vec3): Vec3 {
  return [-v[0] + 0, -v[1] + 0, -v[2] + 0];
}

/** A strategy that visits a fixed list of positions, then keeps probing the last one. */
export function route(start: Vec3, stops: readonly Vec3[]): Strategy {
  return {
    chooseStart: () => start,
    nextProbe: (view: SolverView) => {
      const next = stops[view.logbook.length - 1];
      return next ?? (view.state.ships[view.shipIndex]!.to as Vec3);
    },
  };
}
