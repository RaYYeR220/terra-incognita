import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';

export type Land = ReturnType<typeof toLand>;

function toLand(topo: unknown) {
  const t = topo as Topology<{ land: GeometryCollection }>;
  return feature(t, t.objects.land);
}

let coarse: Promise<ReturnType<typeof toLand>> | null = null;
let fine: Promise<ReturnType<typeof toLand>> | null = null;

/** 1:110m coastlines, bundled with the app and loaded on demand. */
export function loadLand110(): Promise<ReturnType<typeof toLand>> {
  coarse ??= import('world-atlas/land-110m.json').then((m) => toLand(m.default));
  return coarse;
}

/** 1:50m coastlines for close zoom. About ten times the size, so only fetched when needed. */
export function loadLand50(): Promise<ReturnType<typeof toLand>> {
  fine ??= import('world-atlas/land-50m.json').then((m) => toLand(m.default));
  return fine;
}
