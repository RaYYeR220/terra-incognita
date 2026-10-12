'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { loadLand110 } from '@/lib/land';
import type { Land } from '@/lib/land';
import { K, SH, SHD } from '@/lib/palette';
import { CLOUD, airship, cut, paperGlobe, wave } from '@/lib/paper';
import { useReducedMotion } from '@/lib/useReducedMotion';

import { LiveSign } from './LiveSign';
import s from './landing.module.css';

const FLAPS: [number, number, string, string, boolean][] = [
  [-56, 16, '1', 'cold', false],
  [-24, 21, '2', 'hot', true],
  [-45, 33, '3', 'cool', true],
  [-40, 12, '4', 'mild', false],
  [-63, 32, '5', 'warm', false],
];

interface Placed {
  n: string;
  band: string;
  x: number;
  y: number;
}

const LAYERS = ['sky', 'clouds', 'globe', 'ship', 'wings', 'w1', 'w2', 'inner', 'outer'] as const;
type Layer = (typeof LAYERS)[number];

/** The toy theatre: stacked paper layers that shift with the pointer, a globe with flaps on stage. */
export function Hero({ joinHref }: { joinHref: string }) {
  const theatre = useRef<HTMLDivElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const refs = useRef<Partial<Record<Layer, SVGSVGElement | null>>>({});
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [open, setOpen] = useState<boolean[]>(() => FLAPS.map((f) => f[4]));
  const reduce = useReducedMotion();

  useEffect(() => {
    const th = theatre.current;
    if (!th) return;
    let land: Land | null = null;
    let raf = 0;

    const layout = () => {
      const W = th.clientWidth;
      const H = Math.max(th.clientHeight, 600);
      const m = W <= 720;
      const side = m ? 13 : 46;
      const val = m ? 62 : 92;
      const ins = m ? 11 : 32;
      const sr = m ? 13 : 25;
      const wingW = m ? 16 : 54;
      const apron = m ? 250 : W <= 1100 ? 186 : 122;
      th.style.setProperty('--valance', `${val}px`);
      th.style.setProperty('--apron', `${apron}px`);
      th.style.setProperty('--copy-top', `${val + sr + ins + (m ? 22 : 20)}px`);
      th.style.setProperty('--sign-r', `${side + ins + wingW + (m ? 10 : 44)}px`);
      th.style.setProperty('--sign-t', `${val + sr + ins + (m ? 40 : 58)}px`);
      const yC = H - apron;
      const yB = yC - (m ? 40 : 56);
      const yA = yB - (m ? 38 : 54);
      const R = m ? Math.min(H * 0.25, W * 0.56) : Math.min(H * 0.375, W * 0.265);
      const gx = W / 2;
      const gy = yA + R * 0.3;
      for (const id of LAYERS) refs.current[id]?.setAttribute('viewBox', `0 0 ${W} ${H}`);
      const set = (id: Layer, html: string) => {
        const el = refs.current[id];
        if (el) el.innerHTML = html;
      };

      let rays = '';
      const n = m ? 14 : 22;
      for (let i = 0; i < n; i += 2) {
        const a0 = Math.PI + (i / n) * Math.PI;
        const a1 = Math.PI + ((i + 1) / n) * Math.PI;
        const L = Math.hypot(W, H) * 1.2;
        rays += `<path d="M${gx} ${gy} L${gx + Math.cos(a0) * L} ${gy + Math.sin(a0) * L} L${gx + Math.cos(a1) * L} ${gy + Math.sin(a1) * L} Z" fill="${K.ray}"/>`;
      }
      set('sky', `<rect x="-80" y="-80" width="${W + 160}" height="${H + 160}" fill="${K.t1}"/>${rays}`);

      const h1b = (copy.current?.querySelector('h1')?.getBoundingClientRect().bottom ?? 0) - th.getBoundingClientRect().top;
      const gTop = gy - R;
      const cl: [number, number, number][] = m
        ? [[W * 0.04, Math.max(h1b + 18, gTop - 74), 0.7]]
        : [[W * 0.098, H * 0.285, 1.55], [W * 0.8, H * 0.6, 1.25], [W * 0.16, H * 0.6, 1.05]];
      set(
        'clouds',
        cl
          .map(
            ([x, y, k]) =>
              `<line x1="${x + 50 * k}" y1="${y + 4 * k}" x2="${x + 50 * k}" y2="-40" stroke="${K.ink}" stroke-opacity=".5" stroke-width="1.2"/>` +
              `<path d="${CLOUD}" transform="translate(${x + 5} ${y + 7}) scale(${k})" fill="${SH}"/><path d="${CLOUD}" transform="translate(${x} ${y}) scale(${k})" fill="${K.cream}"/>`,
          )
          .join(''),
      );

      if (land) {
        const g = paperGlobe(land, gx, gy, R, [36, 15, 0], { landShadow: m ? 2.5 : 3.5 }, 'hero');
        set('globe', g.svg);
        const next: Placed[] = [];
        for (const [lon, lat, num, band] of FLAPS) {
          const p = g.projection([lon, lat]);
          if (!p || p[1] > yA - (m ? 26 : 34)) continue;
          next.push({ n: num, band, x: p[0], y: p[1] });
        }
        setPlaced(next);
      }

      const ax = m ? W * 0.7 : W * 0.795;
      const ay = m ? Math.max(h1b + 30, (h1b + gTop) / 2) : H * 0.4;
      const as = m ? 0.42 : 1;
      set('ship', `<g class="${s.bob}"><path d="M${W + 40} ${ay} H${ax + 104 * as}" stroke="${K.ink}" stroke-opacity=".55" stroke-width="1.4" fill="none"/>${airship(ax, ay, as, -1)}</g>`);

      const x0 = side + ins;
      const x1 = W - side - ins;
      let wl = `M-80 -80 H${x0 + wingW} `;
      let wr = `M${W + 80} -80 H${x1 - wingW} `;
      for (let y = 0; y <= H + 40; y += 40) {
        const k = (y / 40) % 2 ? 1 : -1;
        wl += `Q${x0 + wingW + k * (m ? 5 : 13)} ${y + 20} ${x0 + wingW} ${y + 40} `;
        wr += `Q${x1 - wingW - k * (m ? 5 : 13)} ${y + 20} ${x1 - wingW} ${y + 40} `;
      }
      set('wings', cut(`${wl} H-80 Z`, K.t3) + cut(`${wr} H${W + 80} Z`, K.t3, { dx: -5 }));
      set('w1', cut(wave(0, W, yA, m ? 13 : 20, m ? 64 : 118, 0, H + 80), K.t2));
      set('w2', `<g class="${s.drift}">${cut(wave(0, W, yB, m ? 14 : 22, m ? 78 : 142, m ? -30 : -60, H + 80), K.t3)}</g>`);
      const cr = m ? 46 : 120;
      const iy = val + sr + ins;
      set(
        'inner',
        cut(`M-80 -80 H${W + 80} V${H + 80} H-80 Z M${x0} ${H + 80} V${iy + cr} Q${x0} ${iy} ${x0 + cr} ${iy} H${x1 - cr} Q${x1} ${iy} ${x1} ${iy + cr} V${H + 80} Z`, K.t4, { evenOdd: true, shadow: SHD, dx: 7, dy: 9 }),
      );
      const ns = Math.max(4, Math.round((W - 2 * side) / (2 * sr)));
      const r = (W - 2 * side) / (2 * ns);
      let sc = '';
      for (let i = 0; i < ns; i += 1) sc += `a${r} ${r} 0 0 0 ${2 * r} 0 `;
      set(
        'outer',
        cut(`M-80 -80 H${W + 80} V${H + 80} H-80 Z M${side} ${H + 80} V${val} ${sc} V${H + 80} Z`, K.t5, { evenOdd: true, shadow: SHD, dx: 7, dy: 9 }) +
          cut(wave(0, W, yC, m ? 15 : 24, m ? 92 : 168, m ? -20 : -36, H + 80), K.t5, { shadow: SHD, dx: 7, dy: 9 }),
      );
      th.dataset.ready = '';
    };

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(layout, 120);
    };
    layout();
    loadLand110().then((l) => {
      land = l;
      layout();
    });
    window.addEventListener('resize', onResize);

    // Parallax, only while the theatre is on screen and motion is welcome.
    let visible = true;
    const io = new IntersectionObserver((es) => {
      visible = es[0]?.isIntersecting ?? true;
    });
    io.observe(th);
    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;
    const loop = () => {
      cx += (tx - cx) * 0.09;
      cy += (ty - cy) * 0.09;
      th.style.setProperty('--mx', cx.toFixed(4));
      th.style.setProperty('--my', cy.toFixed(4));
      raf = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.002 ? requestAnimationFrame(loop) : 0;
    };
    const onMove = (e: PointerEvent) => {
      if (!visible || reduce || e.pointerType !== 'mouse') return;
      tx = -((e.clientX / window.innerWidth) * 2 - 1);
      ty = -((e.clientY / window.innerHeight) * 2 - 1);
      if (!raf) raf = requestAnimationFrame(loop);
    };
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onMove);
      io.disconnect();
      cancelAnimationFrame(raf);
      if (resizeTimer) clearTimeout(resizeTimer);
    };
  }, [reduce]);

  const layer = (id: Layer, depth: number, extra = '') => (
    <svg
      className={`${s.layer} ${extra}`}
      style={{ '--d': depth } as React.CSSProperties}
      ref={(el) => {
        refs.current[id] = el;
      }}
      aria-hidden="true"
    />
  );

  return (
    <header className={s.hero} data-testid="landing-hero">
      <div className={s.theatre} ref={theatre}>
        {layer('sky', 30)}
        {layer('clouds', 25)}
        <div className={`${s.layer} ${s.copy}`} style={{ '--d': 20 } as React.CSSProperties} ref={copy}>
          <LiveSign className={s.sign} />
          <h1 className={s.h1}>
            A treasure hunt where nobody knows where the treasure is. <span>Not even us.</span>
          </h1>
        </div>
        {layer('globe', 17)}
        <div className={s.layer} style={{ '--d': 17 } as React.CSSProperties}>
          {placed.map((f, i) => (
            <button
              key={f.n}
              type="button"
              className={`flap ${s.heroFlap} ${open[i] ? 'open' : ''}`}
              data-band={f.band}
              style={{ left: f.x, top: f.y }}
              aria-pressed={open[i]}
              aria-label={`Flap ${f.n}: ${open[i] ? f.band : 'lift to see the band underneath'}`}
              onClick={() => setOpen((o) => o.map((v, j) => (j === i ? !v : v)))}
            >
              <span className="flap-under">
                <b>{f.band}</b>
              </span>
              <span className="flap-door">
                <i className="flap-front">{f.n}</i>
                <i className="flap-back" />
              </span>
            </button>
          ))}
        </div>
        {layer('ship', 14)}
        {layer('wings', 12)}
        {layer('w1', 11)}
        {layer('w2', 8)}
        {layer('inner', 5)}
        {layer('outer', 0)}
        <p className={s.mark}>TERRA INCOGNITA</p>
        <div className={s.apron}>
          <p className={s.support}>
            Its coordinates are drawn by verifiable randomness inside a hardware enclave. Every sounding is an on-chain move. First strike within 50&nbsp;km takes the pot.
          </p>
          <Link className={`btn ${s.cta}`} href={joinHref} data-testid="join-hunt">
            Join the hunt
          </Link>
          <a className={s.link} href="#secret">
            How it stays secret
          </a>
        </div>
      </div>
      <div className="edge edge-scallop" style={{ '--edge-fill': '#1B4F52' } as React.CSSProperties} aria-hidden="true" />
    </header>
  );
}

