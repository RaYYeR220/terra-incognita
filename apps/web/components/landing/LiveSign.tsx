'use client';

import { render } from '@terra-incognita/core';
import { useEffect, useState } from 'react';

import { getFeed } from '@/lib/feed';
import type { HuntSummary } from '@/lib/feed/types';
import { fmtSol } from '@/lib/format';

/** The sign hung over the stage: live numbers from the demo hunt at sea right now. */
export function LiveSign({ className }: { className?: string }) {
  const [hunt, setHunt] = useState<HuntSummary | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const feed = getFeed();
    let alive = true;
    feed
      .featured()
      .then((h) => alive && (setHunt(h), setChecked(true)))
      .catch(() => alive && setChecked(true));
    const stop = feed.watch('*', (h) => alive && setHunt(h));
    return () => {
      alive = false;
      stop();
    };
  }, []);
  if (!hunt) {
    return (
      <p className={className} data-testid="live-sign" aria-live="polite">
        <span>{checked ? 'Next hunt sets sail' : 'Reading the live hunt…'}</span>
        <span data-sep=""> · </span>
        <span>{checked ? 'when you join' : ' '}</span>
      </p>
    );
  }
  const zone = hunt.zone.stage > 0 ? `zone ${render.zoneRadiusDeg(hunt.zone.stage)}°` : 'zone: whole globe';
  return (
    <p className={className} data-testid="live-sign" aria-label={`Live hunt: pot ${fmtSol(hunt.potSol)}, ${hunt.ships} ships at sea, ${zone}`}>
      <span>Pot {fmtSol(hunt.potSol)}</span>
      <span data-sep=""> · </span>
      <span>{hunt.ships} {hunt.ships === 1 ? 'ship' : 'ships'} at sea</span>
      <span data-sep=""> · </span>
      <span>{zone}</span>
    </p>
  );
}
