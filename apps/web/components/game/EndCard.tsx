'use client';

import { HuntStatus } from '@terra-incognita/core';
import Link from 'next/link';
import { useRef, useState } from 'react';

import { fmtSol, shortHash } from '@/lib/format';
import type { HuntInfo, HuntSession, PublicView } from '@/lib/session/types';
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
  joined,
  session,
  onClose,
}: {
  info: HuntInfo;
  view: PublicView;
  myShip: number;
  joined: boolean;
  session: HuntSession | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [refund, setRefund] = useState<{ phase: 'idle' | 'busy' } | { phase: 'done'; url: string; signature: string } | { phase: 'error'; error: string }>({ phase: 'idle' });
  const claim = async () => {
    if (!session?.claimRefund) return;
    setRefund({ phase: 'busy' });
    try {
      const r = await session.claimRefund();
      setRefund({ phase: 'done', url: r.explorerUrl, signature: r.signature });
    } catch (e) {
      setRefund({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  };
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
    line = joined && onChain
      ? 'This hunt ended with no soundings — reclaim your entry fee.'
      : 'The clock ran out before a single sounding. The prize goes back to its creator and every entrant can take their fee back.';
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
        {view.status === HuntStatus.Void && joined && onChain && session?.claimRefund ? (
          <div className={s.refund} data-testid="refund">
            {refund.phase === 'done' ? (
              <a className={s.tx} href={refund.url} target="_blank" rel="noreferrer" data-testid="refund-link">
                Refund transaction {shortHash(refund.signature)}
              </a>
            ) : (
              <button type="button" className="btn" onClick={() => void claim()} disabled={refund.phase === 'busy'}>
                {refund.phase === 'busy' ? 'Reclaiming…' : 'Reclaim my entry fee'}
              </button>
            )}
            {refund.phase === 'error' ? <p className={s.sub} role="alert">{refund.error}</p> : null}
          </div>
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
