import 'server-only';

import { geoCircle, geoDistance, geoEqualEarth, geoGraticule, geoOrthographic, geoPath } from 'd3-geo';
import type { GeoProjection } from 'd3-geo';

import { bandForKm, bandName } from '@/lib/bands';
import { declutter } from '@/lib/globe/declutter';
import { LAND } from '@/lib/land.server';
import { K, SHD } from '@/lib/palette';
import { RIVAL_SHIP, airship, circ, cut, rng, rr } from '@/lib/paper';

/** An illustration only: the bands printed on these flaps come from this made-up point. */
const T: [number, number] = [41.5, -44.2];
const OWN: [number, number][] = [[-36, -24], [-18, -33], [-4, -41], [8, -50], [16, -38], [22, -55], [27, -43], [33, -52], [31, -47.5]];
const RIVALS: number[][] = [[72, -33, 55, -48], [88, -47, 64, -38], [52, -28, 60, -52], [15, -45, 40, -40], [-10, -38, 30, -50], [64, -56], [78, -22], [47, -39, 70, -44]];

const R = rng(12);
const PINS = Array.from({ length: 30 }, () => {
  const a = R() * Math.PI * 2;
  const d = Math.sqrt(R()) * 27;
  return [60 + Math.cos(a) * d * 1.25, Math.max(-68, -40 + Math.sin(a) * d * 0.8)] as [number, number];
});

export interface MapFlap {
  n: number;
  band: string;
  x: number;
  y: number;
}

export interface MapScene {
  svg: string;
  width: number;
  height: number;
  flaps: MapFlap[];
}

function draw(W: number, H: number, proj: GeoProjection, mobile: boolean, id: string): MapScene {
  const path = geoPath(proj);
  const zone = geoCircle().center([60, -40]).radius(25)();
  const outside = { type: 'Polygon' as const, coordinates: [zone.coordinates[0]!.slice().reverse()] };
  const board = rr(0, 0, W, H, 8);
  const ld = path(LAND) ?? '';
  let s = `<defs><clipPath id="${id}b"><path d="${board}"/></clipPath><pattern id="${id}h" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="9" height="9" fill="${K.t5}"/><rect width="3" height="9" fill="#24585B"/></pattern></defs>`;
  s += cut(board, K.t4, { shadow: SHD, dx: 6, dy: 8 });
  s += `<g clip-path="url(#${id}b)"><path d="${path(geoGraticule().step([20, 20])())}" fill="none" stroke="${K.t3}" stroke-opacity=".5" stroke-width="1"/>`;
  s += `<path d="${ld}" fill="#143F42" fill-opacity=".7" transform="translate(3 4)"/><path d="${ld}" fill="${K.cream}" stroke="${K.cream}" stroke-width=".8" stroke-linejoin="round"/>`;
  s += `<path d="${path(outside)}" fill="rgba(12,47,49,.32)" transform="translate(5 7)"/><path d="${path(outside)}" fill="url(#${id}h)" opacity=".78"/>`;
  s += `<path d="${path(zone)}" fill="none" stroke="rgba(12,47,49,.45)" stroke-width="3" stroke-dasharray="7 5" transform="translate(1.5 2)"/><path d="${path(zone)}" fill="none" stroke="${K.coral}" stroke-width="3" stroke-dasharray="7 5"/>`;
  for (const r of RIVALS) {
    if (r.length > 2) s += `<path d="${path({ type: 'LineString', coordinates: [[r[0]!, r[1]!], [r[2]!, r[3]!]] })}" fill="none" stroke="${K.cream}" stroke-opacity=".85" stroke-width="1.8" stroke-dasharray="1 6" stroke-linecap="round"/>`;
  }
  const z = mobile ? 7 : 8;
  for (const p of PINS) {
    const q = proj(p);
    if (!q) continue;
    s += `<rect x="${(q[0] - z + 2).toFixed(1)}" y="${(q[1] - z + 3).toFixed(1)}" width="${2 * z}" height="${2 * z}" rx="2.5" fill="rgba(12,47,49,.55)"/><rect x="${(q[0] - z).toFixed(1)}" y="${(q[1] - z).toFixed(1)}" width="${2 * z}" height="${2 * z}" rx="2.5" fill="${K.cream}"/>`;
  }
  // Rival ships sail their courses, fade at the end and set out again.
  const lift = mobile ? 12 : 16;
  RIVALS.forEach((r, i) => {
    const q = proj([r[0]!, r[1]!]);
    if (!q) return;
    const scale = mobile ? 0.13 : 0.17;
    if (r.length > 2) {
      const q2 = proj([r[2]!, r[3]!]);
      const course = path({ type: 'LineString', coordinates: [[r[0]!, r[1]!], [r[2]!, r[3]!]] });
      if (!q2 || !course) return;
      const dur = 14 + (i % 4) * 3;
      s += `<g opacity="0">${airship(0, -lift, scale, q2[0] < q[0] ? -1 : 1, { ...RIVAL_SHIP, sx: 2, sy: 3, shadow: 'rgba(12,47,49,.5)' })}<animateMotion dur="${dur}s" begin="${-i * 2.3}s" repeatCount="indefinite" path="${course}" keyPoints="0;1;1" keyTimes="0;0.86;1" calcMode="linear"/><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.05;0.93;1" dur="${dur}s" begin="${-i * 2.3}s" repeatCount="indefinite"/></g>`;
    } else {
      s += airship(q[0], q[1] - lift, scale, 1, { ...RIVAL_SHIP, sx: 2, sy: 3, shadow: 'rgba(12,47,49,.5)' });
    }
  });
  const ship: [number, number] = [38, -46];
  const dest: [number, number] = [77, -39];
  const qs = proj(ship)!;
  s += `<path d="${path({ type: 'LineString', coordinates: [ship, dest] })}" fill="none" stroke="${K.coral}" stroke-width="2.6" stroke-dasharray="2 7" stroke-linecap="round"/>`;
  s += `<path d="${path({ type: 'LineString', coordinates: [...OWN, ship] })}" fill="none" stroke="${K.coral}" stroke-opacity=".55" stroke-width="1.6"/>`;

  // Own flaps, moved apart where they would overlap and tied back with a thread.
  const fs = mobile ? 32 : 30;
  const anchors = OWN.map((p, i) => ({ q: proj(p)!, i, band: bandName(bandForKm(geoDistance(p, T) * 6371.0088)) }));
  const placed = declutter(
    [...anchors].reverse().map((a) => ({ key: String(a.i), x: a.q[0], y: a.q[1], w: fs, h: fs })),
    new Map(),
    (x, y) => x > fs && x < W - fs && y > fs && y < H - fs,
    4,
  );
  const flaps: MapFlap[] = [];
  for (const p of placed) {
    const a = anchors[Number(p.key)]!;
    if (p.moved) {
      s += `<line x1="${a.q[0].toFixed(1)}" y1="${a.q[1].toFixed(1)}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="${K.ink}" stroke-opacity=".6" stroke-width="1.2"/><circle cx="${a.q[0].toFixed(1)}" cy="${a.q[1].toFixed(1)}" r="3" fill="${K.cream}" stroke="${K.t6}" stroke-width="1.2"/>`;
    }
    flaps.push({ n: a.i + 1, band: a.band, x: (p.x / W) * 100, y: (p.y / H) * 100 });
  }
  flaps.sort((a, b) => a.n - b.n);
  s += airship(qs[0], qs[1] - (mobile ? 16 : 22), mobile ? 0.2 : 0.27, 1, { sx: 3, sy: 4, shadow: 'rgba(12,47,49,.5)' });
  s += '</g>';
  const px = W * 0.9;
  const py = mobile ? H * 0.1 : H * 0.14;
  s += `<line x1="${px}" y1="${py - 40}" x2="${px}" y2="${py - 14}" stroke="${K.ink}" stroke-opacity=".55" stroke-width="1.2"/>${cut(circ(px, py, 16), K.cream, { dx: 3, dy: 4, shadow: SHD })}<circle cx="${px}" cy="${py}" r="9.5" fill="none" stroke="${K.coral}" stroke-width="3.4"/>`;
  s += `<text x="${px - 24}" y="${py + 6}" text-anchor="end" font-family="var(--text)" font-weight="700" font-size="16" fill="${K.cream}">pot 2.4 SOL</text>`;
  return { svg: s, width: W, height: H, flaps };
}

export function mapScenes(): { wide: MapScene; narrow: MapScene } {
  const W = 1120;
  const H = Math.round(W * 0.46);
  const wide = geoEqualEarth()
    .rotate([-40, 0])
    .precision(0.3)
    .fitExtent([[0, 0], [W, H]], { type: 'MultiPoint', coordinates: [[-42, -66], [118, -66], [-42, -10], [118, -10]] });
  const w = 358;
  const h = Math.round(w * 0.95);
  const narrow = geoOrthographic().rotate([-24, 42]).clipAngle(90).precision(0.5).scale(w * 0.62).translate([w / 2, h * 0.5]);
  return { wide: draw(W, H, wide, false, 'mw'), narrow: draw(w, h, narrow, true, 'mn') };
}
