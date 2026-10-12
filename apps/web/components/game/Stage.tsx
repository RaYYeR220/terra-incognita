'use client';

import type { Pin } from '@terra-incognita/core';
import { useEffect, useImperativeHandle, useRef } from 'react';
import type { Ref } from 'react';

import { GlobeEngine } from '@/lib/globe/engine';
import type { GlobeScene } from '@/lib/globe/engine';
import type { LonLat } from '@/lib/geo';
import { loadLand110, loadLand50 } from '@/lib/land';

import s from './game.module.css';

export interface StageHandle {
  centreOn: (at: LonLat, instant?: boolean) => void;
  drop: (at: LonLat, mine: boolean) => void;
  zoomBy: (f: number) => void;
}

export interface OwnFlap {
  key: number;
  n: number;
  band: string;
  at: LonLat;
  open: boolean;
  fresh: boolean;
  label: string;
}

export interface Proposal {
  at: LonLat;
  kind: 'embark' | 'course';
  ok: boolean;
  text: string;
}

export interface PinTip {
  at: LonLat;
  ship: number;
}

export function Stage({
  ref,
  scene,
  flaps,
  proposal,
  tip,
  zoneSign,
  hint,
  notice,
  description,
  now,
  reduceMotion,
  onPick,
  onPin,
  onView,
  onToggleFlap,
  onConfirm,
  onCancel,
  children,
}: {
  ref: Ref<StageHandle>;
  scene: GlobeScene | null;
  flaps: OwnFlap[];
  proposal: Proposal | null;
  tip: PinTip | null;
  zoneSign: React.ReactNode;
  hint: React.ReactNode;
  notice: string | null;
  description: string;
  now: () => number;
  reduceMotion: boolean;
  onPick: (at: LonLat) => void;
  onPin: (pin: Pin, at: LonLat) => void;
  onView: (centre: LonLat) => void;
  onToggleFlap: (key: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLElement>(null);
  const engine = useRef<GlobeEngine | null>(null);
  const handlers = useRef({ onPick, onPin, onView, now });
  handlers.current = { onPick, onPin, onView, now };

  useEffect(() => {
    if (!canvas.current || !overlay.current || !stage.current) return;
    const root = stage.current;
    const e = new GlobeEngine(
      canvas.current,
      overlay.current,
      () => handlers.current.now(),
      {
        onPick: (at) => handlers.current.onPick(at),
        onPin: (pin, at) => handlers.current.onPin(pin, at),
        onView: (centre) => handlers.current.onView(centre),
      },
      () => [...root.querySelectorAll<HTMLElement>('[data-reserve]')].filter((el) => el.offsetParent).map((el) => el.getBoundingClientRect()),
      reduceMotion,
    );
    engine.current = e;
    let alive = true;
    loadLand110().then((land) => alive && e.setLand(land));
    const ro = new ResizeObserver(() => e.resize());
    ro.observe(root);
    e.resize();
    let fineTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
      if (e.wantsFine) {
        if (fineTimer) clearInterval(fineTimer);
        fineTimer = null;
        loadLand50().then((land) => alive && e.setFineLand(land));
      }
    }, 500);
    return () => {
      alive = false;
      if (fineTimer) clearInterval(fineTimer);
      ro.disconnect();
      e.destroy();
      engine.current = null;
    };
  }, [reduceMotion]);

  const hasScene = scene !== null;
  useEffect(() => {
    if (hasScene) engine.current?.resize();
  }, [hasScene]);

  useEffect(() => {
    if (scene) engine.current?.setScene(scene);
  }, [scene]);

  useEffect(() => {
    engine.current?.draw();
  }, [flaps, proposal, tip]);

  useImperativeHandle(ref, () => ({
    centreOn: (at, instant) => engine.current?.centreOn(at, instant),
    drop: (at, mine) => engine.current?.drop(at, mine),
    zoomBy: (f) => engine.current?.zoomBy(f),
  }));

  return (
    <main className={s.stage} ref={stage} id="main" aria-label="The globe">
      <div className={s.backdrop} aria-hidden="true" />
      <svg className={s.stageSea} viewBox="0 0 1200 130" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 50 Q65 66 130 50 T260 50 T390 50 T520 50 T650 50 T780 50 T910 50 T1040 50 T1170 50 T1300 50 V130 H0Z" fill="#9FCFC0" />
        <path d="M0 82 Q75 100 150 82 T300 82 T450 82 T600 82 T750 82 T900 82 T1050 82 T1200 82 V130 H0Z" fill="rgba(27,79,82,.24)" transform="translate(5 7)" />
        <path d="M0 82 Q75 100 150 82 T300 82 T450 82 T600 82 T750 82 T900 82 T1050 82 T1200 82 V130 H0Z" fill="#5FAF9F" />
      </svg>
      <canvas
        ref={canvas}
        className={s.canvas}
        data-testid="globe"
        tabIndex={0}
        role="application"
        aria-roledescription="globe"
        aria-label="Globe. Drag or use the arrow keys to turn it, plus and minus to zoom. Click a point, or press Enter for the point under the crosshair, to set a course."
        aria-describedby="globe-state"
      />
      <p id="globe-state" className="visually-hidden" aria-live="polite">
        {description}
      </p>
      <div className={s.overlay} ref={overlay}>
        {flaps.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`flap${f.open ? ' open' : ''}${f.fresh ? ' cutin' : ''}`}
            data-flap=""
            data-key={f.key}
            data-band={f.band}
            data-lon={f.at[0]}
            data-lat={f.at[1]}
            aria-pressed={f.open}
            aria-label={f.label}
            onClick={() => onToggleFlap(f.key)}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ visibility: 'hidden' }}
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
        {proposal ? (
          <div
            className={`${s.confirm} ${proposal.ok ? '' : s.confirmOob}`}
            data-anchor=""
            data-lon={proposal.at[0]}
            data-lat={proposal.at[1]}
            role="group"
            data-testid="course-confirm"
            aria-label={proposal.kind === 'embark' ? 'Set off here' : 'Set course'}
            style={{ visibility: 'hidden' }}
          >
            <span className={s.confirmKm} aria-live="polite">{proposal.text}</span>
            {proposal.ok ? (
              <button type="button" className={s.go} onClick={onConfirm} autoFocus data-testid={proposal.kind === 'embark' ? 'set-off' : 'set-course'}>
                {proposal.kind === 'embark' ? 'Set off here' : 'Set course'}
              </button>
            ) : null}
            <button type="button" className={s.no} onClick={onCancel}>
              {proposal.ok ? 'Cancel' : 'Pick again'}
            </button>
          </div>
        ) : null}
        {tip ? (
          <div className={s.tip} data-anchor="" data-lon={tip.at[0]} data-lat={tip.at[1]} role="status" style={{ visibility: 'hidden' }}>
            Sealed
            <span>Ship {tip.ship} sounded here. Only ship {tip.ship} can read it.</span>
          </div>
        ) : null}
      </div>
      <div className={`${s.curtain} ${s.curtainL}`} aria-hidden="true" />
      <div className={`${s.curtain} ${s.curtainR}`} aria-hidden="true" />
      <div className={s.opening} aria-hidden="true" />
      {zoneSign}
      {notice ? (
        <p className={s.notice} role="status" data-testid="stage-notice">
          {notice}
        </p>
      ) : null}
      {typeof hint === 'string' ? (
        <p className={s.hint} data-reserve="">
          {hint}
        </p>
      ) : (
        hint
      )}
      <div className={s.zoom} role="group" aria-label="Zoom" data-reserve="">
        <button type="button" aria-label="Zoom in" onClick={() => engine.current?.zoomBy(1.3)}>
          +
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => engine.current?.zoomBy(1 / 1.3)}>
          −
        </button>
      </div>
      {children}
    </main>
  );
}
