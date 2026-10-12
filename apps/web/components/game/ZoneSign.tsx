'use client';

import { ZONE_STAGES, render } from '@terra-incognita/core';
import type { Zone } from '@terra-incognita/core';
import { useEffect, useRef, useState } from 'react';

import { clock } from '@/lib/format';
import type { HuntInfo } from '@/lib/session/types';

import s from './game.module.css';

export function ZoneSign({ zone, info, now, live }: { zone: Zone; info: HuntInfo; now: number; live: boolean }) {
  const deg = render.zoneRadiusDeg(zone.stage);
  const [sway, setSway] = useState(false);
  const stage = useRef(zone.stage);
  useEffect(() => {
    if (zone.stage === stage.current) return;
    stage.current = zone.stage;
    setSway(true);
    const t = setTimeout(() => setSway(false), 1300);
    return () => clearTimeout(t);
  }, [zone.stage]);

  const next = info.startsAt + (zone.stage + 1) * info.zoneIntervalSecs;
  const final = zone.stage >= ZONE_STAGES || next >= info.deadline;
  const ring = zone.stage > 0 ? Math.max(3, (12 * deg) / 90) : 15;
  return (
    <div className={`${s.zone} ${sway ? s.zoneSway : ''}`} data-reserve="" aria-live="polite" data-testid="zone">
      <svg viewBox="-20 -20 40 40" aria-hidden="true">
        <circle r="18" fill="#1B4F52" opacity=".55" />
        <circle r={ring} fill="#2F7F78" stroke="#F2734E" strokeWidth="2.5" strokeDasharray="3 2.5" />
      </svg>
      <div>
        <b>{zone.stage > 0 ? `Search zone ${deg}°` : 'Search zone: everywhere'}</b>
        <span>{!live ? 'hunt over' : final ? 'final zone' : `narrows in ${clock(next - now)}`}</span>
      </div>
    </div>
  );
}
