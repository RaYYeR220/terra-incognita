'use client';

import { MAX_PROBES } from '@terra-incognita/core';
import type { Band, LogEntry, Ship } from '@terra-incognita/core';
import { useState } from 'react';

import { BANDS_COLD_TO_HOT, bandName, bandRange } from '@/lib/bands';
import { shortHash, timeOfDay } from '@/lib/format';
import { vecText } from '@/lib/geo';
import type { HuntSession, ReadAttempt } from '@/lib/session/types';

import s from './panels.module.css';

export function Logbook({
  logbook,
  shipIndex,
  freshIndex,
  onShow,
}: {
  logbook: readonly LogEntry[];
  shipIndex: number;
  freshIndex: number;
  onShow: (entry: LogEntry) => void;
}) {
  const used = logbook.length;
  return (
    <div className={s.book}>
      <h2>Logbook</h2>
      <p className={s.who}>
        <svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true">
          <rect x="2" y="7" width="18" height="9" rx="2" fill="#1B4F52" />
          <path d="M6 7 V5 a5 5 0 0 1 10 0 V7" fill="none" stroke="#1B4F52" strokeWidth="2.4" />
        </svg>
        {shipIndex >= 0 ? `Ship ${shipIndex + 1}, only you can read this` : 'Only you can read this'}
      </p>
      {used === 0 ? (
        <p className={s.empty}>
          <b>No soundings yet.</b>
          {shipIndex < 0
            ? 'Click the globe to choose where your ship sets off.'
            : 'Take a sounding where you are, or set a course first.'}
        </p>
      ) : (
        <ol className={s.rows} aria-label="Your soundings, newest first" data-testid="logbook">
          {logbook
            .map((entry, i) => ({ entry, i }))
            .reverse()
            .map(({ entry, i }) => (
              <li key={`${i}-${entry.ts}`} data-testid="logbook-row" data-band={bandName(entry.band)} className={i === freshIndex ? s.fresh : undefined}>
                <button type="button" className={s.row} onClick={() => onShow(entry)} aria-label={`Sounding ${i + 1} at ${vecText(entry.pos)}, ${timeOfDay(entry.ts)}: ${bandName(entry.band)}. Show on the globe.`}>
                  <span className={s.n}>{i + 1}</span>
                  <span className={s.pos}>{vecText(entry.pos)}</span>
                  <span className={s.t}>{timeOfDay(entry.ts)}</span>
                  <span className={s.chip}>
                    <span>{bandName(entry.band)}</span>
                  </span>
                </button>
              </li>
            ))}
        </ol>
      )}
      <div className={s.used}>
        <div className={s.holes} aria-hidden="true">
          {Array.from({ length: MAX_PROBES }, (_, i) => (
            <i key={i} className={i < used ? s.on : undefined} />
          ))}
        </div>
        <p>
          <b>{used}</b> of {MAX_PROBES} soundings used
        </p>
      </div>
    </div>
  );
}

export function Readout({ last, count }: { last: LogEntry | null; count: number }) {
  const lit: Band | null = last ? last.band : null;
  return (
    <div className={s.readout} aria-live="polite">
      <ol className={s.steps} aria-hidden="true">
        {BANDS_COLD_TO_HOT.map(({ band, name }, i) => (
          <li key={name} data-band={name} style={{ '--i': i } as React.CSSProperties} className={lit === band ? s.lit : undefined} />
        ))}
      </ol>
      {last && lit !== null ? (
        <div className={s.rlabel}>
          <span className={s.cap}>Sounding {count}</span>
          <b>{bandName(lit)}</b>
          <span className={s.rng}>{bandRange(lit)}</span>
        </div>
      ) : (
        <div className={`${s.rlabel} ${s.quiet}`}>
          <span className={s.cap}>No sounding yet</span>
          <b>unknown</b>
          <span className={s.rng}>eight bands, frozen to strike</span>
        </div>
      )}
    </div>
  );
}

export function RivalsKey({ pins }: { pins: number }) {
  return (
    <section className={s.card} aria-labelledby="rivals-h" id="rivals" data-testid="rivals">
      <h2 id="rivals-h">Rivals</h2>
      <ul className={s.key}>
        <li>
          <svg viewBox="-15 -13 30 26" aria-hidden="true"><rect x="-8" y="-6" width="18" height="18" rx="3" fill="rgba(12,47,49,.4)" /><rect x="-10" y="-9" width="18" height="18" rx="3" fill="#F6F1E3" stroke="#9FCFC0" /><path d="M-10 -5 H8" stroke="#9FCFC0" /></svg>
          <span><b>Sealed.</b> {pins} rival {pins === 1 ? 'sounding' : 'soundings'}: you see where, never what.</span>
        </li>
        <li>
          <svg viewBox="-15 -13 30 26" aria-hidden="true"><g transform="scale(.12)"><path d="M-74 -10 L-122 -44 L-108 -4 Z M-74 10 L-122 44 L-108 4 Z" fill="#5FAF9F" /><path d="M-100 0 C-100 -22 -54 -35 0 -35 C56 -35 100 -20 110 0 C100 20 56 35 0 35 C-54 35 -100 22 -100 0 Z" fill="#F6F1E3" stroke="#9FCFC0" strokeWidth="6" /><rect x="-24" y="38" width="52" height="15" rx="6" fill="#1B4F52" /></g><path d="M-14 10 H14" stroke="#2B2B2B" strokeWidth="1.6" strokeDasharray="1.5 3.5" strokeLinecap="round" /></svg>
          <span>Rival ships and the courses they set.</span>
        </li>
        <li>
          <svg viewBox="-15 -13 30 26" aria-hidden="true"><rect x="-11" y="-3" width="22" height="16" rx="3" fill="#F6C59E" /><path d="M-11 -3 L-8 -13 H8 L11 -3 Z" fill="#E7DFC9" /></svg>
          <span>Your soundings, band printed underneath.</span>
        </li>
        <li>
          <svg viewBox="-15 -13 30 26" aria-hidden="true"><defs><pattern id="kh" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#1B4F52" /><rect width="2" height="5" fill="#2F6A6C" /></pattern></defs><rect x="-14" y="-12" width="28" height="24" rx="3" fill="url(#kh)" /><circle r="8" fill="#2F7F78" stroke="#F2734E" strokeWidth="2" strokeDasharray="3 2" /></svg>
          <span>Outside the search zone. Nothing to find there.</span>
        </li>
      </ul>
    </section>
  );
}

export function ShipsAtSea({ ships, myShip, now }: { ships: readonly Ship[]; myShip: number; now: number }) {
  const order = ships.map((ship, i) => ({ ship, i })).filter((x) => x.ship.embarked);
  return (
    <section className={`${s.card} ${s.ships}`} aria-labelledby="ships-h">
      <h2 id="ships-h">Ships at sea</h2>
      {order.length === 0 ? (
        <p className={s.empty}>Nobody has set off yet.</p>
      ) : (
        <ul className={s.shipList}>
          {order.map(({ ship, i }) => {
            const flying = now < ship.arriveTs;
            const state = flying ? `in flight, ${Math.max(1, Math.ceil(ship.arriveTs - now))} s` : now - ship.lastProbeTs < 4 && ship.probes ? 'sounding' : 'holding';
            return (
              <li key={ship.owner} className={i === myShip ? s.me : undefined}>
                <b>{i === myShip ? 'You' : `Ship ${i + 1}`}</b>
                <span className={s.state}>{state}</span>
                <span className={s.count}>{ship.probes}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function EnclaveCard({ fingerprint, session }: { fingerprint: string; session: HuntSession | null }) {
  const [attempt, setAttempt] = useState<ReadAttempt | null>(null);
  const [asking, setAsking] = useState(false);
  const [shake, setShake] = useState(0);
  const tryRead = async () => {
    if (!session) return;
    setAsking(true);
    setShake((n) => n + 1);
    try {
      setAttempt(await session.attemptRead());
    } finally {
      setAsking(false);
    }
  };
  return (
    <section className={`${s.card} ${s.enclave}`} id="enclave" aria-labelledby="enclave-h">
      <div className={`${s.enc} ${shake ? 'refuse' : ''}`} key={shake}>
        <svg viewBox="0 0 72 56" aria-hidden="true">
          <rect x="3" y="7" width="66" height="44" rx="4" fill="rgba(0,0,0,.3)" />
          <rect x="0" y="4" width="66" height="44" rx="4" fill="#F6F1E3" />
          <path d="M0 48 L28 26 M66 48 L38 26" stroke="#E7DFC9" strokeWidth="2" />
          <g className="env-lid"><path d="M0 7 L33 30 L66 7 Q66 4 63 4 H3 Q0 4 0 7Z" fill="#E7DFC9" /></g>
          <g className="env-seal"><circle cx="33" cy="30" r="9" fill="#F2734E" /><circle cx="33" cy="30" r="5.5" fill="none" stroke="#D95C39" strokeWidth="1.6" /></g>
        </svg>
        <p>
          <b id="enclave-h">Treasure sealed in enclave</b>fingerprint
          <br />
          <span className={s.fp} title={fingerprint}>{fingerprint ? shortHash(fingerprint) : '…'}</span>
        </p>
      </div>
      <button type="button" className={`btn btn-paper ${s.try}`} onClick={tryRead} disabled={asking || !session} data-testid="try-read">
        {asking ? 'Asking…' : 'Try to read it'}
      </button>
      <div role="status">
        {attempt ? (
          <div className={s.refused} key={shake} data-testid="try-read-reply">
            <b>{attempt.asker} asked.</b>
            <span className={s.hole} aria-hidden="true" />
            {attempt.detail}
          </div>
        ) : null}
      </div>
    </section>
  );
}
