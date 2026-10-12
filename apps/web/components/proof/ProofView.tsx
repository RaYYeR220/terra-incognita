'use client';

import { PublicKey } from '@solana/web3.js';
import { BAND_NAMES, fromLatLon, isTerminal, toLatLon } from '@terra-incognita/core';
import { DEMO_CLUE, PlayerSession, buildProofReport, decodeTreasure, explorerAddress, keypairSigner, listHunts, treasureAddress } from '@terra-incognita/sdk';
import type { ProofReport } from '@terra-incognita/sdk';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import p from '@/components/chrome/paper.module.css';
import { terraClient } from '@/lib/chain/client';
import { guestKeypair } from '@/lib/session/chain-session';
import { fmtKm, fmtSol, latLonText, shortHash, timeOfDay } from '@/lib/format';
import { vecText } from '@/lib/geo';

import s from './proof.module.css';

type Load = { phase: 'finding' } | { phase: 'loading' } | { phase: 'error'; error: string } | { phase: 'ready'; report: ProofReport };

const VERDICT: Record<ProofReport['verdict'], { stamp: string; line: string }> = {
  verified: { stamp: 'VERIFIED', line: 'The treasure matches its fingerprint and every answer the enclave gave re-measures the same.' },
  mismatch: { stamp: 'MISMATCH', line: 'Something does not add up: the fingerprint or at least one answer does not match the revealed treasure.' },
  incomplete: { stamp: 'INCOMPLETE', line: 'Everything that could be read matches, but some logbooks are still private.' },
  unfinished: { stamp: 'AT SEA', line: 'This hunt has not revealed its treasure yet. Its proof opens when it ends.' },
};

/** Moves the revealed point about 330 km north, to show what a dishonest reveal looks like. */
function nudge(v: Parameters<typeof toLatLon>[0]) {
  const { lat, lon } = toLatLon(v);
  return fromLatLon(Math.max(-89, Math.min(89, lat + (lat > 80 ? -3 : 3))), lon);
}

export function ProofView({ id }: { id: string }) {
  const router = useRouter();
  const [load, setLoad] = useState<Load>(id === 'demo' ? { phase: 'finding' } : { phase: 'loading' });
  const [tamper, setTamper] = useState(false);
  const [read, setRead] = useState<string | null>(null);
  const [refund, setRefund] = useState<{ phase: 'none' | 'guest' | 'wallet' | 'busy' } | { phase: 'done'; url: string; signature: string } | { phase: 'error'; error: string }>({ phase: 'none' });

  // A void hunt: if this browser holds an entry in it, offer the entry fee back.
  const status = load.phase === 'ready' ? load.report.status : null;
  useEffect(() => {
    if (status !== 'void') return;
    let saved: string[] = [];
    try {
      saved = Object.keys(window.localStorage).filter((k) => k.startsWith(`terra:session:${id}:`));
    } catch {
      saved = [];
    }
    if (!saved.length) return;
    const guest = guestKeypair().publicKey.toBase58();
    setRefund({ phase: saved.some((k) => k.endsWith(`:${guest}`)) ? 'guest' : 'wallet' });
  }, [status, id]);

  const claim = async () => {
    setRefund({ phase: 'busy' });
    try {
      const burner = guestKeypair();
      const key = `terra:session:${id}:${burner.publicKey.toBase58()}`;
      const data = window.localStorage.getItem(key);
      if (!data) throw new Error('This browser holds no entry in this hunt.');
      const client = terraClient();
      const session = await PlayerSession.restore(client, JSON.parse(data));
      const result = await session.claimRefund(keypairSigner(burner));
      window.localStorage.removeItem(key);
      setRefund({ phase: 'done', signature: result.refund, url: client.explorerTx(result.refund) });
    } catch (e) {
      setRefund({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  };

  useEffect(() => {
    if (id !== 'demo') return;
    let alive = true;
    listHunts(terraClient())
      .then((hunts) => {
        const done = hunts.filter((h) => h.finalized && isTerminal(h.status));
        const pick = done.find((h) => h.clue === DEMO_CLUE) ?? done[0];
        if (!alive) return;
        if (pick) router.replace(`/proof/${pick.address.toBase58()}`);
        else setLoad({ phase: 'error', error: 'No hunt has finished yet, so there is no proof to read. Play one to the end first.' });
      })
      .catch((e: unknown) => alive && setLoad({ phase: 'error', error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [id, router]);

  const build = useCallback(async (withTamper: boolean) => {
    setLoad({ phase: 'loading' });
    try {
      const report = await buildProofReport(terraClient(), new PublicKey(id), withTamper ? { tamper: nudge } : {});
      setLoad({ phase: 'ready', report });
    } catch (e) {
      setLoad({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }, [id]);

  useEffect(() => {
    if (id === 'demo') return;
    try {
      new PublicKey(id);
    } catch {
      setLoad({ phase: 'error', error: 'That is not a hunt address.' });
      return;
    }
    void build(tamper);
  }, [id, tamper, build]);

  // A finished hunt's treasure is public, so the refusal is shown on the hunt at sea right now.
  const tryRead = async () => {
    setRead('Asking the rollup…');
    const client = terraClient();
    const live = (await fetch('/api/hunts/featured')
      .then((r) => r.json() as Promise<{ hunt?: { id: string; title: string } | null }>)
      .catch(() => ({ hunt: null }))).hunt;
    const target = live && live.id !== id ? live : null;
    const address = treasureAddress(new PublicKey(target?.id ?? id), client.programId);
    const info = await client.rollup.getAccountInfo(address).catch(() => null);
    const empty = !info || info.data.length === 0;
    if (target) {
      setRead(
        empty
          ? `Asked the rollup, as an outsider, for the treasure of “${target.title}”, at sea right now. Came back empty.`
          : `The rollup answered for “${target.title}” with ${info!.data.length} bytes; that hunt may have just ended.`,
      );
      return;
    }
    if (empty) {
      setRead(`Asked the rollup for ${shortHash(address.toBase58())} as an outsider. Came back empty.`);
      return;
    }
    try {
      const t = decodeTreasure(address, info!.data);
      const { lat, lon } = toLatLon(t.location);
      setRead(`This hunt is over, so its treasure account is open: it holds ${latLonText(lat, lon)}, the point that was revealed. No hunt is at sea right now to try a sealed one.`);
    } catch {
      setRead('This hunt is over and its treasure account is open. No hunt is at sea right now to try a sealed one.');
    }
  };

  if (load.phase === 'finding' || load.phase === 'loading') {
    return (
      <div className={p.state} role="status" aria-busy="true">
        <b>{load.phase === 'finding' ? 'Finding the last finished hunt…' : 'Reading the proof…'}</b>
        Fetching the hunt, opening its logbooks and re-measuring every sounding. This takes a few seconds.
      </div>
    );
  }
  if (load.phase === 'error') {
    return (
      <div className={p.state} role="alert">
        <b>The proof could not be read.</b>
        {load.error}
        <br />
        <Link className="btn btn-paper" href="/hunts">See all hunts</Link>
      </div>
    );
  }

  const r = load.report;
  const cluster = terraClient().config.cluster;
  const v = VERDICT[r.verdict];
  const stampClass = r.verdict === 'verified' ? s.ok : r.verdict === 'mismatch' ? s.bad : s.pending;
  return (
    <>
      <div className={s.head}>
        <div>
          <h1 className={p.h1}>Proof of “{r.title || 'Untitled hunt'}”</h1>
          <p className={p.lede}>
            <a href={explorerAddress(r.hunt, cluster)} target="_blank" rel="noreferrer" className={p.mono}>{shortHash(r.hunt, 6, 6)}</a> ·{' '}
            {r.mode === 'author' ? 'treasure placed by its author' : 'treasure drawn by verifiable randomness'} · {r.status}
            {r.endedAt ? ` at ${timeOfDay(r.endedAt)}` : ''}
          </p>
        </div>
        <div className={`${s.stamp} ${stampClass}`} data-testid="proof-verdict" role="status">
          <b>{v.stamp}</b>
          <span>{r.entriesChecked} soundings re-measured{r.mismatches ? `, ${r.mismatches} wrong` : ''}</span>
        </div>
      </div>
      <p className={s.verdictLine}>{v.line}</p>
      {refund.phase !== 'none' ? (
        <div className={p.state} data-testid="refund">
          <b>This hunt ended with no soundings — reclaim your entry fee.</b>
          {refund.phase === 'done' ? (
            <a href={refund.url} target="_blank" rel="noreferrer" data-testid="refund-link">Refund transaction {shortHash(refund.signature)}</a>
          ) : refund.phase === 'wallet' ? (
            <Link className="btn" href={`/hunt/${id}`}>Reclaim it with your wallet</Link>
          ) : (
            <button type="button" className="btn" onClick={() => void claim()} disabled={refund.phase === 'busy'}>
              {refund.phase === 'busy' ? 'Reclaiming…' : 'Reclaim my entry fee'}
            </button>
          )}
          {refund.phase === 'error' ? <p role="alert">{refund.error}</p> : null}
        </div>
      ) : null}
      {r.verdict !== 'unfinished' ? (
        <label className={s.tamper}>
          <input type="checkbox" checked={tamper} onChange={(e) => setTamper(e.target.checked)} />
          Tamper with the reveal: move the treasure 330 km and check again
        </label>
      ) : (
        <p><Link className="btn" href={`/hunt/${r.hunt}`}>Go to the hunt</Link></p>
      )}

      <div className={s.cols}>
        <section className={p.card} aria-labelledby="c-h">
          <h2 className={p.h2} id="c-h">The fingerprint</h2>
          <p className={s.note}>Anchored on Solana before the first ship left port, then checked against what was revealed.</p>
          <div className={s.tags}>
            <span className={s.fp} title={r.commitment}>{shortHash(r.commitment, 8, 8)}</span>
            <span className={`${s.check} ${r.commitmentOk ? s.ok : s.bad}`}>{r.commitmentOk ? 'matches' : r.revealedLocation ? 'does not match' : 'not revealed'}</span>
          </div>
          {r.revealedLatLon ? (
            <p className={s.where}>
              Treasure at <b>{latLonText(r.revealedLatLon.lat, r.revealedLatLon.lon)}</b>
              <small className={p.mono}>salt {shortHash(r.revealedSalt, 6, 6)}</small>
            </p>
          ) : null}
          {r.anchorSignature ? (
            <a className={s.link} href={`https://explorer.solana.com/tx/${r.anchorSignature}${cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`}`} target="_blank" rel="noreferrer">
              Anchor transaction {shortHash(r.anchorSignature)}
            </a>
          ) : null}
        </section>

        <section className={`${p.card} ${p.dark}`} aria-labelledby="pay-h">
          <h2 className={p.h2} id="pay-h">The payout</h2>
          {r.settlement ? (
            <>
              <p className={s.big}>{fmtSol(r.settlement.prizeLamports / 1e9)}</p>
              <p className={s.note}>to {r.winner ? shortHash(r.winner) : 'the winner'}{r.settlement.creatorLamports ? `, ${fmtSol(r.settlement.creatorLamports / 1e9)} to the creator` : ''}</p>
              <a className={s.linkLight} href={r.settlement.explorer} target="_blank" rel="noreferrer" data-testid="proof-settlement-link">
                Settlement transaction {shortHash(r.settlement.signature)}
              </a>
            </>
          ) : (
            <p className={s.note}>{r.vault?.settled ? 'Settled; the transaction is still being indexed.' : 'Not settled yet.'}</p>
          )}
          <div className={s.read}>
            <button type="button" className="btn btn-paper" onClick={() => void tryRead()} data-testid="try-read">Try to read it</button>
            {read ? <p className={s.slip} role="status" data-testid="try-read-reply"><span aria-hidden="true" />{read}</p> : null}
          </div>
        </section>
      </div>

      <section className={s.books} aria-labelledby="b-h">
        <h2 className={p.h2} id="b-h">Every logbook, opened and re-measured</h2>
        {r.logbooks.length === 0 ? <p className={s.note}>No logbook could be read yet.</p> : null}
        {r.logbooks.map((book) => (
          <details key={book.address} className={s.book} open={r.logbooks.length <= 3}>
            <summary>
              <b className={p.mono}>{shortHash(book.owner)}</b> · {book.entries.length} soundings · {book.entries.every((e) => e.ok) ? 'all match' : `${book.entries.filter((e) => !e.ok).length} wrong`}
            </summary>
            <ol>
              {book.entries.map((e) => (
                <li key={e.index} className={e.ok ? undefined : s.wrong}>
                  <span className={s.n}>{e.index + 1}</span>
                  <span>{vecText(e.pos)}</span>
                  <span className={p.mono}>{fmtKm(e.distanceKm)}</span>
                  <span data-band={BAND_NAMES[e.recordedBand]} className={s.chip}>{BAND_NAMES[e.recordedBand]}</span>
                  <span>{e.ok ? 'matches' : `should be ${BAND_NAMES[e.expectedBand]}`}</span>
                </li>
              ))}
            </ol>
          </details>
        ))}
        {r.unreadable.length ? <p className={s.note}>{r.unreadable.length} logbooks are still private and could not be checked.</p> : null}
      </section>
    </>
  );
}
