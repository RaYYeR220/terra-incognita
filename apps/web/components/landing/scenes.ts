import 'server-only';

import { DEFAULT_SPEED_KMS, fromLatLon, render, travelSecs } from '@terra-incognita/core';
import { geoInterpolate } from 'd3-geo';

import { LAND } from '@/lib/land.server';
import { K, SHD } from '@/lib/palette';
import { RIVAL_SHIP, airship, circ, cut, paperGlobe, rr, scallop, star, wave } from '@/lib/paper';

const SH30 = 'rgba(0,0,0,.3)';
const label = (x: number, y: number, size: number, fill: string, text: string, display = false) =>
  `<text x="${x}" y="${y}" text-anchor="middle" font-family="${display ? 'var(--display)' : 'var(--text)'}"${display ? '' : ' font-weight="700"'} font-size="${size}" fill="${fill}">${text}</text>`;

/** Beat 1: the strongbox with the globe inside, its fingerprint pinned to the chain. */
export function sealedScene(fingerprint: string): string {
  const g = paperGlobe(LAND, 260, 262, 40, [-70, 30], { noShadow: true, landShadow: 1.5 }, 'sc1');
  let s = cut('M70 372 V160 Q70 36 194 36 H326 Q450 36 450 160 V372 Z', K.t2);
  s += `<line x1="402" y1="-30" x2="402" y2="72" stroke="${K.ink}" stroke-opacity=".5" stroke-width="1.2"/>`;
  s += `<g transform="rotate(12 402 96)">${cut(rr(378, 72, 48, 48, 8), K.cream)}${[[390, 84], [414, 84], [402, 96], [390, 108], [414, 108]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4.2" fill="${K.coral}"/>`).join('')}</g>`;
  s += cut(rr(150, 196, 220, 132, 8), K.t4, { shadow: SHD });
  s += cut('M140 202 Q140 140 202 140 H318 Q380 140 380 202 Z', K.t5, { shadow: SHD });
  s += `<rect x="184" y="140" width="16" height="188" fill="${K.t3}"/><rect x="320" y="140" width="16" height="188" fill="${K.t3}"/>`;
  s += cut(circ(260, 262, 50), K.cream, { dx: 3, dy: 4 }) + g.svg;
  s += cut(scallop(260, 203, 19, 12, 6), K.coral, { dx: 3, dy: 4 }) + `<circle cx="260" cy="200" r="5" fill="${K.t6}"/><path d="M257 202 h6 l2 10 h-10z" fill="${K.t6}"/>`;
  for (let i = 0; i < 6; i += 1) {
    const x = 76 + i * 64;
    if (i) s += `<rect x="${x - 30}" y="350" width="32" height="7" rx="3" fill="${K.t5}"/>`;
    s += cut(rr(x, 336, 36, 36, 6), i === 4 ? K.t5 : K.t3, { dx: 3, dy: 4 });
  }
  s += `<path d="M372 250 C410 262 404 300 352 330" fill="none" stroke="${K.ink}" stroke-opacity=".55" stroke-width="1.3"/>`;
  s += `<g transform="rotate(-7 392 294)">${cut('M336 278 H436 Q444 278 444 286 V306 Q444 314 436 314 H336 L322 296 Z', K.cream, { dx: 3, dy: 4 })}<circle cx="335" cy="296" r="3.5" fill="${K.t2}"/>${label(390, 302, 15, K.ink, fingerprint)}</g>`;
  return s;
}

const CA: [number, number] = [22, -40];
const CB: [number, number] = [98, -33];

/** Beat 2: a course across a paper globe, with two rivals at sea watching it. */
export function courseScene(): { svg: string; track: [number, number][]; km: number; secs: number } {
  const g = paperGlobe(LAND, 260, 340, 196, [-60, 58], { landShadow: 3 }, 'sc2');
  const arc = g.path({ type: 'LineString', coordinates: [CA, CB] }) ?? '';
  const pA = g.projection(CA)!;
  const pB = g.projection(CB)!;
  const rivals: [[number, number], [number, number]][] = [
    [[40, -22], [58, -30]],
    [[86, -50], [72, -44]],
  ];
  let s = g.svg;
  for (const [from, to] of rivals) {
    s += `<path d="${g.path({ type: 'LineString', coordinates: [from, to] })}" fill="none" stroke="${K.cream}" stroke-opacity=".85" stroke-width="1.8" stroke-dasharray="1 6" stroke-linecap="round"/>`;
  }
  s += `<path d="${arc}" fill="none" stroke="${K.cream}" stroke-width="2.4" stroke-dasharray="2 7" stroke-linecap="round"/>`;
  s += `<circle cx="${pA[0]}" cy="${pA[1]}" r="6" fill="${K.cream}"/>`;
  s += `<g transform="translate(${pB[0]} ${pB[1]})"><path d="M-9 -9 L9 9 M9 -9 L-9 9" stroke="rgba(12,47,49,.4)" stroke-width="5" stroke-linecap="round" transform="translate(2 3)"/><path d="M-9 -9 L9 9 M9 -9 L-9 9" stroke="${K.coral}" stroke-width="5" stroke-linecap="round"/></g>`;
  for (const [from, to] of rivals) {
    const p = g.projection(from)!;
    const q = g.projection(to)!;
    s += `<line x1="${p[0]}" y1="${p[1]}" x2="${p[0]}" y2="${p[1] - 12}" stroke="${K.ink}" stroke-opacity=".5" stroke-width="1.1"/>`;
    s += airship(p[0], p[1] - 22, 0.17, q[0] < p[0] ? -1 : 1, { ...RIVAL_SHIP, sx: 3, sy: 4 });
  }
  s += cut(wave(0, 520, 300, 12, 86, 0, 400), K.t2) + cut(wave(0, 520, 326, 14, 104, -40, 400), K.t3, { shadow: SHD });
  const interp = geoInterpolate(CA, CB);
  const track = Array.from({ length: 101 }, (_, i) => {
    const p = g.projection(interp(i / 100))!;
    return [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10] as [number, number];
  });
  const a = fromLatLon(CA[1], CA[0]);
  const b = fromLatLon(CB[1], CB[0]);
  return { svg: s, track, km: render.distanceKm(a, b), secs: travelSecs(a, b, DEFAULT_SPEED_KMS) };
}

/** Beat 3: the lead line drops onto a globe covered in numbered flaps. */
export function soundingScene(): { svg: string; flaps: { n: number; band: string; open: boolean; x: number; y: number }[] } {
  const g = paperGlobe(LAND, 340, 540, 450, [-58, 78], { landShadow: 4, noShadow: true }, 'sc3');
  const F: [number, number, number, string, boolean][] = [
    [28, -24, 1, 'cold', true],
    [64, -14, 2, 'mild', false],
    [50, -34, 3, 'hot', false],
    [88, -27, 4, 'warm', false],
  ];
  let s = g.svg;
  const p3 = g.projection([F[2]![0], F[2]![1]])!;
  s += `<line class="leadline" x1="${p3[0]}" y1="54" x2="${p3[0]}" y2="${p3[1] - 30}" stroke="${K.ink}" stroke-opacity=".7" stroke-width="1.4" stroke-dasharray="5 4"/>`;
  s += `<path class="leadbob" d="M${p3[0] - 6} ${p3[1] - 34} h12 l-3 9 h-6z" fill="${K.t6}"/>`;
  s += airship(p3[0] + 6, 38, 0.34, -1, { sx: 4, sy: 5 });
  s += `<line x1="${p3[0] + 40}" y1="38" x2="700" y2="38" stroke="${K.ink}" stroke-opacity=".45" stroke-width="1.2"/>`;
  s += cut(wave(-20, 700, 300, 10, 96, 0, 400), K.t3, { shadow: SHD });
  const flaps = F.map(([lon, lat, n, band, open]) => {
    const p = g.projection([lon, lat])!;
    return { n, band, open, x: (p[0] / 680) * 100, y: (p[1] / 330) * 100 };
  });
  return { svg: s, flaps };
}

/** Beat 4: the flap thrown open on a starburst, coins flying to the pot, a clock standing by. */
export function strikeScene(pot: string): string {
  let s = cut(star(240, 206, 168, 124, 16, 0.1), K.coral, { shadow: SHD, dx: 6, dy: 8 }) + `<path d="${star(240, 206, 120, 96, 16, 0.3)}" fill="${K.cream}"/>`;
  const rays = Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI) / 6;
    const b = a + Math.PI / 12;
    return `<path d="M240 220 L${240 + Math.cos(a) * 120} ${220 + Math.sin(a) * 120} L${240 + Math.cos(b) * 120} ${220 + Math.sin(b) * 120} Z" fill="${K.coral}"/>`;
  }).join('');
  s += `<defs><clipPath id="hole4"><path d="${rr(186, 170, 108, 100, 8)}"/></clipPath></defs><path d="${rr(186, 170, 108, 100, 8)}" fill="${K.cream}"/><g clip-path="url(#hole4)">${rays}<rect x="186" y="170" width="108" height="100" fill="none" stroke="rgba(14,51,54,.32)" stroke-width="10" transform="translate(4 5)"/></g>`;
  s += `<rect x="208" y="206" width="64" height="26" rx="4" fill="${K.cream}"/>${label(240, 225, 16, K.ink, 'strike')}`;
  s += cut('M190 166 L178 92 Q177 84 185 84 H295 Q303 84 302 92 L290 166 Z', K.kraft, { dx: 4, dy: -5, shadow: SHD }) + `<path d="M186 160 H294 V170 H186Z" fill="${K.t5}" opacity=".85"/>`;
  for (const [x, y, r] of [[318, 150, 13], [352, 118, 12], [384, 92, 11], [300, 120, 10], [338, 80, 9]] as const) {
    s += cut(circ(x, y, r), K.cream, { dx: 2, dy: 3, shadow: SHD }) + `<circle cx="${x}" cy="${y}" r="${r * 0.55}" fill="none" stroke="${K.coral}" stroke-width="2.4"/>`;
  }
  s += `<line x1="440" y1="-30" x2="440" y2="40" stroke="${K.ink}" stroke-opacity=".5" stroke-width="1.2"/>`;
  s += `<g transform="rotate(6 440 58)">${cut(rr(392, 40, 96, 40, 6), K.t5, { dx: 3, dy: 4 })}${label(440, 66, 16, K.cream, pot)}</g>`;
  s += cut(circ(78, 316, 38), K.cream, { shadow: SHD }) + `<circle cx="78" cy="316" r="30" fill="none" stroke="${K.t2}" stroke-width="2"/><path d="M78 316 V292 M78 316 L96 324" stroke="${K.t5}" stroke-width="4" stroke-linecap="round"/><circle cx="78" cy="316" r="4" fill="${K.coral}"/><rect x="70" y="268" width="16" height="10" rx="3" fill="${K.t5}"/>`;
  return s;
}

/** Before: the fingerprint tag on the chain while the airship is still moored. */
export function beforeObject(fingerprint: string): string {
  let b = `<line x1="150" y1="-26" x2="150" y2="20" stroke="${K.cream}" stroke-opacity=".5" stroke-width="1.3"/>`;
  b += `<g transform="rotate(-5 150 70)">${cut('M70 24 H220 Q230 24 230 34 V104 Q230 114 220 114 H70 L46 69 Z', K.cream, { shadow: SH30 })}<circle cx="72" cy="69" r="6" fill="${K.t5}"/>`;
  b += `<text x="148" y="62" text-anchor="middle" font-family="var(--text)" font-size="14" fill="${K.t5}">fingerprint</text>${label(148, 90, 21, K.t5, fingerprint, true)}</g>`;
  b += `<path d="M150 118 V196" stroke="${K.cream}" stroke-opacity=".5" stroke-width="1.3"/>`;
  for (let i = 0; i < 4; i += 1) {
    const x = 30 + i * 60;
    if (i) b += `<rect x="${x - 28}" y="208" width="30" height="7" rx="3" fill="${K.t3}"/>`;
    b += cut(rr(x, 194, 34, 34, 6), i === 2 ? K.coral : K.t4, { dx: 3, dy: 4, shadow: SH30 });
  }
  b += cut('M0 252 H280 V262 H0Z', K.t4, { dx: 0, dy: 4, shadow: SH30 });
  b += `<path d="M232 178 L250 252" stroke="${K.cream}" stroke-opacity=".5" stroke-width="1.3"/>`;
  b += airship(226, 160, 0.2, -1, { sx: 3, sy: 4, shadow: SH30 });
  return b;
}

/** During: the sealed envelope. Its flap will not lift. */
export function duringObject(): string {
  let d = `<g class="env-all">${cut(rr(20, 40, 380, 214, 8), K.cream, { shadow: 'rgba(0,0,0,.32)', dx: 7, dy: 9 })}`;
  d += `<path d="M20 254 L178 150 M400 254 L242 150" stroke="${K.kraft}" stroke-width="3"/><path d="M28 246 L210 132 L392 246 Z" fill="${K.kraft}" opacity=".55"/>`;
  d += `<g class="env-lid"><path d="M20 46 L210 170 L400 46 Q400 40 394 40 H26 Q20 40 20 46 Z" fill="rgba(0,0,0,.18)" transform="translate(0 8)"/><path d="M20 46 L210 170 L400 46 Q400 40 394 40 H26 Q20 40 20 46 Z" fill="${K.kraft}"/></g>`;
  d += `<g class="env-seal">${cut(scallop(210, 166, 30, 14, 8), K.coral, { dx: 3, dy: 4, shadow: SH30 })}<circle cx="210" cy="166" r="21" fill="none" stroke="${K.coralD}" stroke-width="2.5"/><path d="${star(210, 166, 13, 6, 5, -Math.PI / 2)}" fill="${K.coralD}"/></g></g>`;
  return d;
}

/** After: the opened envelope, the coordinates, two matching fingerprints and an open logbook. */
export function afterObject(fingerprint: string): string {
  let a = cut(rr(30, 120, 190, 120, 8), K.cream, { shadow: 'rgba(0,0,0,.32)' });
  a += `<path d="M30 124 L125 40 L220 124 Z" fill="${K.kraft}"/><path d="M30 124 L125 40 L220 124" fill="none" stroke="rgba(0,0,0,.12)" stroke-width="2"/>`;
  a += `<g transform="rotate(-4 125 104)">${cut(rr(56, 62, 138, 84, 6), K.t1, { dx: 3, dy: 4, shadow: 'rgba(0,0,0,.25)' })}${label(125, 96, 17, K.t5, '12.6°N', true)}${label(125, 122, 17, K.t5, '141.3°W', true)}</g>`;
  a += `<path d="M30 240 L125 172 L220 240" fill="none" stroke="${K.kraft}" stroke-width="3"/>`;
  a += `<g transform="rotate(4 248 64)">${cut(rr(196, 30, 104, 30, 5), K.cream, { dx: 3, dy: 4, shadow: SH30 })}${label(248, 51, 13, K.t5, fingerprint)}</g>`;
  a += `<g transform="rotate(-3 248 98)">${cut(rr(196, 84, 104, 30, 5), K.t2, { dx: 3, dy: 4, shadow: SH30 })}${label(248, 105, 13, K.t5, fingerprint)}</g>`;
  a += cut(circ(288, 80, 15), K.coral, { dx: 2, dy: 3, shadow: SH30 }) + `<path d="M280 80 l6 6 l10 -12" fill="none" stroke="${K.ink}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`;
  a += cut('M160 186 L230 178 L300 186 V262 L230 254 L160 262 Z', K.cream, { shadow: 'rgba(0,0,0,.32)' }) + `<path d="M230 178 V254" stroke="${K.kraft}" stroke-width="3"/>`;
  (['frozen', 'cool', 'warm', 'hot'] as const).forEach((bd, i) => {
    const col = { frozen: K.t6, cool: K.t3, warm: K.peach, hot: K.coral }[bd];
    a += `<rect x="170" y="${196 + i * 14}" width="46" height="4" rx="2" fill="${K.t2}"/><rect x="242" y="${193 + i * 14}" width="${18 + i * 6}" height="9" rx="2" fill="${col}"/>`;
  });
  return a;
}
