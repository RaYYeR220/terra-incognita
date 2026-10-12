'use client';

import type { GeoProjection } from 'd3-geo';
import { useEffect, useMemo, useRef, useState } from 'react';

import { fmtSol } from '@/lib/format';
import { loadLand110 } from '@/lib/land';
import type { Land } from '@/lib/land';
import { K, SHD } from '@/lib/palette';
import { cut, paperGlobe, rr, wave } from '@/lib/paper';

export type Spot = [number, number];

/** A small paper theatre with a globe. Click the globe to place the treasure yourself. */
export function StudioStage({
  self,
  spot,
  prizeSol,
  feeSol,
  clockText,
  onPick,
  className,
}: {
  self: boolean;
  spot: Spot;
  prizeSol: number;
  feeSol: number;
  clockText: string;
  onPick: (spot: Spot) => void;
  className?: string;
}) {
  const [land, setLand] = useState<Land | null>(null);
  const [mounted, setMounted] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    setMounted(true);
    let alive = true;
    loadLand110().then((l) => alive && setLand(l));
    return () => {
      alive = false;
    };
  }, []);

  const { body, projection } = useMemo(() => {
    let s = cut(rr(0, 0, 560, 400, 10), K.t5, { shadow: SHD, dx: 6, dy: 8 });
    s += `<path d="${rr(36, 60, 488, 316, 0)}" fill="${K.t1}"/><defs><clipPath id="stClip"><rect x="36" y="60" width="488" height="330"/></clipPath></defs><g clip-path="url(#stClip)">`;
    for (let i = 0; i < 9; i += 2) {
      const a0 = Math.PI + (i / 10) * Math.PI;
      const a1 = Math.PI + ((i + 1) / 10) * Math.PI;
      s += `<path d="M280 330 L${280 + Math.cos(a0) * 400} ${330 + Math.sin(a0) * 400} L${280 + Math.cos(a1) * 400} ${330 + Math.sin(a1) * 400} Z" fill="${K.ray}"/>`;
    }
    let projection: GeoProjection | null = null;
    if (land) {
      const g = paperGlobe(land, 280, 370, 170, [-120, 30], { landShadow: 3 }, 'st');
      projection = g.projection;
      s += g.svg;
    }
    return { body: s, projection };
  }, [land]);

  const front = useMemo(() => {
    let s = cut(wave(36, 524, 350, 10, 80, 0, 420), K.t3, { shadow: SHD }) + '</g>';
    s += `<path fill-rule="evenodd" fill="${K.t5}" d="M-2 -2 H562 V402 H-2 Z M36 400 V60 H524 V400 Z"/>`;
    const n = 13;
    const r = (536 - 24) / (2 * n);
    let back = '';
    for (let i = 0; i < n; i += 1) back += `a${r} ${r} 0 0 1 ${-2 * r} 0 `;
    s += `<path d="M24 30 H536 V52 ${back} Z" fill="${K.t4}"/>`;
    s += `<text x="280" y="22" text-anchor="middle" font-family="var(--display)" font-size="13" letter-spacing="3" fill="${K.cream}">YOUR HUNT</text>`;
    s += `<rect x="0" y="388" width="560" height="12" fill="${K.t6}"/>`;
    return s;
  }, []);

  const mark = useMemo(() => {
    const p = projection?.(spot);
    if (!p) return '';
    return self
      ? `<g transform="translate(${p[0]} ${p[1]})">${cut(rr(-14, -14, 28, 28, 5), K.coral, { dx: 3, dy: 4 })}<path d="M-6 -6 L6 6 M6 -6 L-6 6" stroke="${K.cream}" stroke-width="3.4" stroke-linecap="round"/></g>`
      : `<g transform="translate(${p[0]} ${p[1]})">${cut(rr(-15, -15, 30, 30, 5), K.cream, { dx: 3, dy: 4, shadow: 'rgba(14,51,54,.5)' })}<text y="7" text-anchor="middle" font-family="var(--display)" font-size="17" fill="${K.t5}">?</text></g>`;
  }, [projection, spot, self]);

  const sign = `<line x1="420" y1="40" x2="420" y2="84" stroke="${K.ink}" stroke-opacity=".55" stroke-width="1.2"/><line x1="512" y1="40" x2="512" y2="84" stroke="${K.ink}" stroke-opacity=".55" stroke-width="1.2"/>
    <g transform="rotate(2 466 104)">${cut(rr(404, 82, 124, 60, 6), K.cream, { dx: 3, dy: 4 })}
    <text x="466" y="106" text-anchor="middle" font-family="var(--display)" font-size="16" fill="${K.t5}">${fmtSol(prizeSol)}</text>
    <text x="466" y="129" text-anchor="middle" font-family="var(--text)" font-weight="700" font-size="13" fill="${K.ink}">entry ${feeSol.toFixed(2)} · ${clockText}</text></g>`;

  const click = (e: React.MouseEvent<SVGSVGElement>) => {
    const el = svg.current;
    if (!el || !projection) return;
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = el.getScreenCTM();
    if (!ctm) return;
    const q = pt.matrixTransform(ctm.inverse());
    if (Math.hypot(q.x - 280, q.y - 370) > 170 || q.y > 350) return;
    const ll = projection.invert?.([q.x, q.y]);
    if (ll) onPick([ll[0], ll[1]]);
  };

  return (
    <svg
      ref={svg}
      className={className}
      viewBox="0 0 560 400"
      role="img"
      aria-label={self ? 'A small paper theatre with a globe. Click the globe to move your treasure.' : 'A small paper theatre with a globe. The enclave will pick the spot.'}
      onClick={click}
      style={{ cursor: 'crosshair', width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
      dangerouslySetInnerHTML={{ __html: mounted ? body + mark + front + sign : '' }}
    />
  );
}

export const prizeOf = (v: number) => v * 0.5;
export const feeOf = (v: number) => v / 100;
export const clockOf = (v: number) => v * 5;
export function clockText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
