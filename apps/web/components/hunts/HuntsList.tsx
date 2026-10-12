'use client';

import { HuntStatus, isTerminal, render } from '@terra-incognita/core';
import { isJoinable, listHunts } from '@terra-incognita/sdk';
import type { HuntAccount } from '@terra-incognita/sdk';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import p from '@/components/chrome/paper.module.css';
import { terraClient } from '@/lib/chain/client';
import { clock, fmtSol, timeOfDay } from '@/lib/format';

import s from './hunts.module.css';

type Load = { phase: 'loading' } | { phase: 'error'; error: string } | { phase: 'ready'; live: HuntAccount[]; done: HuntAccount[]; now: number };

const STATUS: Partial<Record<HuntStatus, string>> = {
  [HuntStatus.Struck]: 'Struck',
  [HuntStatus.Closest]: 'Closest sounding won',
  [HuntStatus.Void]: 'Nobody sounded',
};

export function HuntsList() {
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const [, setTick] = useState(0);

  const fetchAll = useCallback(async () => {
    setLoad({ phase: 'loading' });
    try {
      const client = terraClient();
      const [now, hunts] = await Promise.all([client.now(), listHunts(client)]);
      const live = hunts.filter((h) => isJoinable(h, now));
      const done = hunts.filter((h) => h.finalized && isTerminal(h.status)).slice(0, 12);
      setLoad({ phase: 'ready', live, done, now });
    } catch (error) {
      setLoad({ phase: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => {
    void fetchAll();
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [fetchAll]);

  if (load.phase === 'loading') {
    return (
      <div className={s.grid} aria-busy="true" aria-label="Loading hunts">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`${p.skeleton} ${s.ghost}`} />
        ))}
      </div>
    );
  }
  if (load.phase === 'error') {
    return (
      <div className={p.state} role="alert">
        <b>The hunts could not be read.</b>
        Solana or the rollup did not answer: {load.error}
        <br />
        <button type="button" className="btn" onClick={() => void fetchAll()}>Try again</button>
      </div>
    );
  }
  const now = Date.now() / 1000;
  return (
    <>
      <h2 className={`${p.h2} ${s.section}`}>At sea now</h2>
      {load.live.length === 0 ? (
        <div className={p.state}>
          <b>No hunts at sea right now.</b>
          Start the demo hunt, or hide a treasure of your own.
          <br />
          <Link className="btn" href="/hunt/demo">Join the hunt</Link>{' '}
          <Link className="btn btn-paper" href="/studio">Open the studio</Link>
        </div>
      ) : (
        <ul className={s.grid} data-testid="hunts-live">
          {load.live.map((h, i) => (
            <li key={h.address.toBase58()} className={s.ticket} style={{ '--tilt': `${(i % 3) - 1}deg` } as React.CSSProperties}>
              <h3>{h.title || 'Untitled hunt'}</h3>
              {h.clue && h.mode === 1 ? <p className={s.clue}>“{h.clue}”</p> : null}
              <dl className={s.facts}>
                <div><dt>Pot</dt><dd>{fmtSol((h.prizeSeed + h.entryFee * h.players) / 1e9)}</dd></div>
                <div><dt>Ships</dt><dd>{h.players} of {h.maxPlayers}</dd></div>
                <div><dt>Zone</dt><dd>{h.zone.stage > 0 ? `${render.zoneRadiusDeg(h.zone.stage)}°` : 'whole globe'}</dd></div>
                <div><dt>Ends in</dt><dd>{clock(h.deadline - now)}</dd></div>
              </dl>
              <p className={s.fee}>{h.entryFee ? `Entry ${fmtSol(h.entryFee / 1e9)}` : 'Free to enter'}</p>
              <Link className="btn" href={`/hunt/${h.address.toBase58()}`}>Join</Link>
            </li>
          ))}
        </ul>
      )}
      <h2 className={`${p.h2} ${s.section}`}>Finished</h2>
      {load.done.length === 0 ? (
        <div className={p.state}><b>No finished hunts yet.</b>When a hunt ends, its proof opens here.</div>
      ) : (
        <ul className={s.done}>
          {load.done.map((h) => (
            <li key={h.address.toBase58()}>
              <span className={s.doneTitle}>{h.title || 'Untitled hunt'}</span>
              <span>{STATUS[h.status] ?? 'Ended'}</span>
              <span className={p.muted}>{h.endedAt ? timeOfDay(h.endedAt) : ''}</span>
              <Link href={`/proof/${h.address.toBase58()}`}>Read the proof</Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
