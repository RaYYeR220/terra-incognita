/**
 * Cut-paper drawing for SVG. Every shape is drawn twice: a flat shadow copy offset down and
 * to the right, then the shape itself. No filters anywhere, so nothing repaints on scroll.
 */
import { geoGraticule, geoOrthographic, geoPath } from 'd3-geo';
import type { GeoPath, GeoPermissibleObjects, GeoProjection } from 'd3-geo';

import { K, SH } from './palette';

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

export interface CutOptions {
  dx?: number;
  dy?: number;
  shadow?: string;
  evenOdd?: boolean;
  attr?: string;
}

export function cut(d: string, fill: string, o: CutOptions = {}): string {
  const rule = o.evenOdd ? ' fill-rule="evenodd"' : '';
  return (
    `<path d="${d}" fill="${o.shadow ?? SH}" transform="translate(${o.dx ?? 5} ${o.dy ?? 7})"${rule}/>` +
    `<path d="${d}" fill="${fill}"${rule}${o.attr ? ` ${o.attr}` : ''}/>`
  );
}

export function rr(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;
}

export function circ(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
}

export function star(cx: number, cy: number, ro: number, ri: number, n: number, rot = 0): string {
  let d = '';
  for (let i = 0; i < 2 * n; i += 1) {
    const a = rot + (i * Math.PI) / n;
    const r = i % 2 ? ri : ro;
    d += `${i ? 'L' : 'M'}${f1(cx + Math.cos(a) * r)} ${f1(cy + Math.sin(a) * r)}`;
  }
  return `${d}Z`;
}

export function scallop(cx: number, cy: number, r: number, n: number, amp: number): string {
  const p = (a: number, q: number) => `${f1(cx + Math.cos(a) * q)} ${f1(cy + Math.sin(a) * q)}`;
  let d = '';
  for (let i = 0; i < n; i += 1) {
    const a0 = (i / n) * 2 * Math.PI;
    const a1 = ((i + 1) / n) * 2 * Math.PI;
    d += `${i ? '' : `M${p(a0, r)}`} Q${p((a0 + a1) / 2, r + amp)} ${p(a1, r)}`;
  }
  return `${d}Z`;
}

/** A band of sea: a wavy top edge from x0 to x1, closed down to `bottom`. */
export function wave(x0: number, x1: number, y: number, amp: number, wl: number, phase: number, bottom: number): string {
  let d = `M${x0 - wl * 2} ${bottom} V${y}`;
  for (let x = x0 - wl * 2 + phase; x < x1 + wl * 2; x += wl) d += ` Q${f1(x + wl / 2)} ${y + amp} ${f1(x + wl)} ${y}`;
  return `${d} V${bottom} Z`;
}

export const CLOUD = 'M8 46 a17 17 0 0 1 6 -32 a25 25 0 0 1 46 -8 a21 21 0 0 1 36 10 a16 16 0 0 1 2 30 Z';

export const AIRSHIP = {
  fins: 'M-74 -10 L-122 -44 L-108 -4 Z M-74 10 L-122 44 L-108 4 Z',
  body: 'M-100 0 C-100 -22 -54 -35 0 -35 C56 -35 100 -20 110 0 C100 20 56 35 0 35 C-54 35 -100 22 -100 0 Z',
  ribs: 'M-46 -30 Q-58 0 -46 30 M6 -35 Q-6 0 6 35 M58 -30 Q50 0 58 30',
  gondola: 'M-18 38 H22 Q28 38 28 44 V47 Q28 53 22 53 H-18 Q-24 53 -24 47 V44 Q-24 38 -18 38 Z',
} as const;

export interface AirshipColours {
  body?: string;
  fin?: string;
  gondola?: string;
  rib?: string;
  sx?: number;
  sy?: number;
  shadow?: string;
}

/** The own ship is coral; rivals are cream paper. */
export const RIVAL_SHIP: AirshipColours = { body: K.cream, fin: K.t3, rib: K.t2 };

export function airship(x: number, y: number, s: number, dir = 1, o: AirshipColours = {}): string {
  const body = o.body ?? K.coral;
  const fin = o.fin ?? K.coralD;
  const gondola = o.gondola ?? K.t5;
  const rib = o.rib ?? K.cream;
  const shape = (mono?: string) =>
    `<path d="${AIRSHIP.fins}" fill="${mono ?? fin}"/><path d="${AIRSHIP.body}" fill="${mono ?? body}"/>` +
    (mono ? '' : `<path d="${AIRSHIP.ribs}" stroke="${rib}" stroke-opacity=".75" stroke-width="2" fill="none"/>`) +
    `<path d="${AIRSHIP.gondola}" fill="${mono ?? gondola}"/>` +
    (mono ? '' : `<path d="M-14 35 V40 M18 35 V40" stroke="${gondola}" stroke-width="3"/>`);
  const t = `translate(${f1(x)} ${f1(y)}) scale(${dir * s} ${s})`;
  return `<g transform="translate(${o.sx ?? 5} ${o.sy ?? 7})"><g transform="${t}">${shape(o.shadow ?? SH)}</g></g><g transform="${t}">${shape()}</g>`;
}

export interface GlobeOptions {
  noShadow?: boolean;
  sea?: string;
  landShadow?: number;
  sdx?: number;
  sdy?: number;
  graticule?: number;
  inner?: (projection: GeoProjection, path: GeoPath) => string;
}

export interface PaperGlobe {
  projection: GeoProjection;
  path: GeoPath;
  svg: string;
}

let globeSeq = 0;

/** A paper globe: sea disc, graticule, land cut out of cream with its own shadow. */
export function paperGlobe(
  land: GeoPermissibleObjects,
  cx: number,
  cy: number,
  r: number,
  rotate: [number, number, number?],
  o: GlobeOptions = {},
  idPrefix = 'g',
): PaperGlobe {
  globeSeq += 1;
  const id = `${idPrefix}${globeSeq}`;
  const projection = geoOrthographic()
    .scale(r)
    .translate([cx, cy])
    .rotate([rotate[0], rotate[1], rotate[2] ?? 0])
    .clipAngle(90)
    .precision(0.5);
  const path = geoPath(projection);
  const ld = path(land) ?? '';
  const step = o.graticule ?? 30;
  const gr = path(geoGraticule().step([step, step])()) ?? '';
  const inner = o.inner ? o.inner(projection, path) : '';
  const ls = o.landShadow ?? 3;
  const svg =
    `<defs><clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs>` +
    (o.noShadow ? '' : `<circle cx="${cx + (o.sdx ?? 5)}" cy="${cy + (o.sdy ?? 7)}" r="${r}" fill="${SH}"/>`) +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${o.sea ?? K.t4}"/>` +
    `<g clip-path="url(#${id})"><path d="${gr}" fill="none" stroke="${K.t3}" stroke-opacity=".55" stroke-width="1.1"/>` +
    `<path d="${ld}" fill="${K.landShadow}" fill-opacity=".7" transform="translate(${ls} ${ls})"/>` +
    `<path d="${ld}" fill="${K.cream}" stroke="${K.cream}" stroke-width=".8" stroke-linejoin="round"/>${inner}</g>`;
  return { projection, path, svg };
}

/** Small seeded generator for deterministic decoration. */
export function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
