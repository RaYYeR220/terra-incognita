'use client';

import { HuntStatus } from '@terra-incognita/core';
import Link from 'next/link';
import { useRef } from 'react';

import { fmtSol, shortHash } from '@/lib/format';
import type { HuntInfo, PublicView } from '@/lib/session/types';
import { useFocusTrap } from '@/lib/useFocusTrap';

import s from './panels.module.css';

function starPath(): string {
  let d = '';
  for (let i = 0; i < 32; i += 1) {
    const a = (i * Math.PI) / 16;
    const r = i % 2 ? 52 : 74;
    d += `${i ? 'L' : 'M'}${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`;
  }
  return `${d}Z`;
}
const STAR = starPath();

export function EndCard({
  info,
  view,
  myShip,
  onClose,
}: {
  info: HuntInfo;
  view: PublicView;
  myShip: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, onClose);
  const winner = view.winnerShip;
  const mine = winner !== null && winner === myShip;
  const label = winner === null ? '—' : String(winner + 1);
  const paid = view.settlement?.payoutSol ?? view.potSol;
  const onChain = info.network !== 'simulator';

  let title: string;
  let line: string;
  const settled = !!view.settlement?.signature;
  const payout = onChain ? (settled ? `${fmtSol(paid)} paid on Solana` : `Paying ${fmtSol(paid)} out on Solana…`) : `${fmtSol(paid)} to ship ${label}`;
  if (view.status === HuntStatus.Struck) {
    title = mine ? 'You struck it' : `Struck by ship ${label}`;
    line = payout;
  } else if (view.status === HuntStatus.Closest) {
    title = mine ? 'Yours was the closest' : `Ship ${label} came closest`;
    line = `The clock ran out. ${payout}`;
  } else {
    title = 'Nobody sounded';
    line = 'The clock ran out before a single sounding. The pot goes back.';
  }

  return (
    <div className={s.end} role="dialog" aria-modal="true" aria-labelledby="end-h" ref={ref} data-testid="end-card">
      <div className={s.endcard}>
        <svg viewBox="-80 -80 160 160" aria-hidden="true">
          <path d={STAR} fill="rgba(12,47,49,.4)" transform="translate(6 8)" />
          <path d={STAR} fill="#F2734E" />
          <circle r="40" fill="#F6F1E3" />
          <text y="9" textAnchor="middle" fontFamily="var(--display)" fontSize="24" fill="#1B4F52">{label}</text>
        </svg>
        <h2 id="end-h">{title}</h2>
        <p data-testid="paid">{line}</p>
        {view.settlement?.signature ? (
          view.settlement.explorerUrl ? (
            <a className={s.tx} href={view.settlement.explorerUrl} target="_blank" rel="noreferrer" data-testid="settlement-link">
              Transaction {shortHash(view.settlement.signature)}
            </a>
          ) : (
            <p className={s.sub}>Transaction {shortHash(view.settlement.signature)}</p>
          )
        ) : !onChain && winner !== null ? (
          <p className={s.sub}>A practice hunt against the simulator: nothing was paid.</p>
        ) : null}
        <div className={s.endActions}>
          <Link className="btn" href={`/proof/${info.network === 'simulator' ? 'demo' : info.id}`}>
            Verify this hunt
          </Link>
          <button type="button" className={s.linkBtn} onClick={onClose}>
            Look at the globe
          </button>
        </div>
      </div>
    </div>
  );
}
