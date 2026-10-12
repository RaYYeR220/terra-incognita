'use client';

import { useEffect, useRef, useState } from 'react';

import { fmtKm } from '@/lib/format';
import { airship } from '@/lib/paper';
import { useReducedMotion } from '@/lib/useReducedMotion';

import s from './landing.module.css';

export function Flap({
  n,
  band,
  open,
  onToggle,
  style,
  label,
  tabIndex,
}: {
  n: number | string;
  band: string;
  open: boolean;
  onToggle?: () => void;
  style?: React.CSSProperties;
  label?: string;
  tabIndex?: number;
}) {
  return (
    <button
      type="button"
      className={`flap${open ? ' open' : ''}`}
      data-band={band}
      style={style}
      aria-pressed={open}
      aria-label={label ?? `Flap ${n}: ${open ? band : 'lift it to see the band underneath'}`}
      onClick={onToggle}
      tabIndex={tabIndex}
    >
      <span className="flap-under">
        <b>{band}</b>
      </span>
      <span className="flap-door">
        <i className="flap-front">{n}</i>
        <i className="flap-back" />
      </span>
    </button>
  );
}

/** Beat 2: pull the tab and the airship flies the course; the readout is real distance and time. */
export function CoursePull({ track, km, secs }: { track: [number, number][]; km: number; secs: number }) {
  const [t, setT] = useState(38);
  const p = track[Math.round(t)] ?? track[0]!;
  const done = t / 100;
  return (
    <>
      <svg viewBox="0 0 520 360" className={s.courseShip} aria-hidden="true">
        <line x1={p[0]} y1={p[1]} x2={p[0]} y2={p[1] - 26} stroke="#2B2B2B" strokeOpacity=".6" strokeWidth="1.3" />
        <g dangerouslySetInnerHTML={{ __html: airship(p[0], p[1] - 44, 0.3, 1, { sx: 4, sy: 5 }) }} />
      </svg>
      <div className={s.pullRow}>
        <input
          className="pull"
          type="range"
          min={0}
          max={100}
          value={t}
          onChange={(e) => setT(Number(e.target.value))}
          aria-label="Pull the tab to fly the course"
          aria-valuetext={`${fmtKm(km * done)}, ${Math.ceil(secs * done - 1e-9)} seconds`}
        />
        <output>
          {fmtKm(km * done)} · {Math.ceil(secs * done - 1e-9)} s
        </output>
      </div>
    </>
  );
}

/** Beat 3: the numbered flaps on the sounding scene. */
export function FlapField({ flaps }: { flaps: { n: number; band: string; open: boolean; x: number; y: number }[] }) {
  const [open, setOpen] = useState(() => flaps.map((f) => f.open));
  return (
    <div className={s.flapField}>
      {flaps.map((f, i) => (
        <Flap
          key={f.n}
          n={f.n}
          band={f.band}
          open={open[i] ?? false}
          style={{ left: `${f.x}%`, top: `${f.y}%` }}
          onToggle={() => setOpen((o) => o.map((v, j) => (j === i ? !v : v)))}
        />
      ))}
    </div>
  );
}

const ASKERS = ['A player', 'The organiser', 'Us'];

/** The refused read, shown as an object: each request comes back as an empty slip. */
export function TryRead({ envelope }: { envelope: React.ReactNode }) {
  const [slips, setSlips] = useState<{ id: number; who: string }[]>([]);
  const [shake, setShake] = useState(0);
  const count = useRef(0);
  const ask = () => {
    const id = count.current;
    count.current += 1;
    setShake((n) => n + 1);
    setSlips((list) => [{ id, who: ASKERS[id % ASKERS.length]! }, ...list].slice(0, 3));
  };
  return (
    <>
      <div className={shake ? 'refuse' : undefined} key={shake}>
        {envelope}
      </div>
      <div className={s.tryRow}>
        <button type="button" className="btn btn-paper" onClick={ask}>
          Try to read it
        </button>
        <div className={s.pile} aria-live="polite">
          {slips.map((slip) => (
            <div className={s.slip} key={slip.id}>
              <span>{slip.who} asked</span>
              <span className={s.hole} aria-hidden="true" />
              <span>came back empty</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

interface MapFlap {
  n: number;
  band: string;
  x: number;
  y: number;
}

/** What everyone sees: pull the thread across the chart to lift your own flaps. */
export function RevealMap({
  wide,
  narrow,
}: {
  wide: { svg: string; width: number; height: number; flaps: MapFlap[] };
  narrow: { svg: string; width: number; height: number; flaps: MapFlap[] };
}) {
  const [v, setV] = useState(27);
  const reduce = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    for (const svg of box.current?.querySelectorAll('svg') ?? []) {
      if (reduce) svg.pauseAnimations();
      else svg.unpauseAnimations();
    }
  }, [reduce]);
  const chart = (m: typeof wide, cls?: string) => (
    <div className={`${s.mapbox} ${cls}`}>
      <svg
        viewBox={`0 0 ${m.width} ${m.height}`}
        role="img"
        aria-label="A paper chart of the southern oceans: a coral-stitched search zone, rival airships sailing their courses, sealed rival flaps, and your own flaps that only you can lift."
        dangerouslySetInnerHTML={{ __html: m.svg }}
      />
      <div className={s.mapFlaps}>
        {m.flaps.map((f) => (
          <Flap key={f.n} n={f.n} band={f.band} open={f.x <= v} tabIndex={-1} style={{ left: `${f.x}%`, top: `${f.y}%` }} label={`Your sounding ${f.n}${f.x <= v ? `: ${f.band}` : ''}`} />
        ))}
      </div>
      <div className={s.mapThread} style={{ left: `${v}%` }} aria-hidden="true" />
    </div>
  );
  return (
    <div ref={box}>
      {chart(wide, s.mapWide)}
      {chart(narrow, s.mapNarrow)}
      <div className={s.reveal}>
        <label htmlFor="reveal">Pull to lift your own flaps</label>
        <input className="pull" type="range" id="reveal" min={0} max={100} value={v} onChange={(e) => setV(Number(e.target.value))} />
      </div>
    </div>
  );
}

/** The private half of the legend: one flap you can lift, not a heavy box. */
export function PrivateNote() {
  const [open, setOpen] = useState(false);
  return (
    <div className={s.private}>
      <h3>Private</h3>
      <Flap n="?" band="warm" open={open} onToggle={() => setOpen((o) => !o)} label={open ? 'Your flap, lifted: warm' : 'Lift your flap'} />
      <p>
        what each sounding found.
        <small>Only the ship that took it can lift the flap.</small>
      </p>
    </div>
  );
}
