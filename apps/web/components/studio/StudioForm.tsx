'use client';

import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { MAX_CLUE_BYTES, MAX_CREATOR_BPS, MAX_TITLE_BYTES, fromLatLon } from '@terra-incognita/core';
import { LIMITS, TerraError, createHunt } from '@terra-incognita/sdk';
import type { CreateStep } from '@terra-incognita/sdk';
import Link from 'next/link';
import { useState } from 'react';

import p from '@/components/chrome/paper.module.css';
import { WalletButton, useWalletSigner } from '@/components/wallet/Wallets';
import { terraClient } from '@/lib/chain/client';
import { fmtSol, latLonText, shortHash } from '@/lib/format';

import { StudioStage, clockText } from './StudioStage';
import type { Spot } from './StudioStage';
import f from './form.module.css';
import st from './studio.module.css';

const STEPS: { step: CreateStep; label: string }[] = [
  { step: 'create', label: 'Hunt created on Solana' },
  { step: 'delegate', label: 'Handed to the private rollup' },
  { step: 'open', label: 'Opened for players' },
  { step: 'seal', label: 'Treasure sealed in the enclave' },
  { step: 'arm', label: 'Armed: fingerprint published' },
  { step: 'anchored', label: 'Fingerprint anchored on Solana' },
  { step: 'crank', label: 'Zone clock scheduled' },
];

const bytes = (text: string) => new TextEncoder().encode(text).length;

type Run = { phase: 'idle' } | { phase: 'running'; done: CreateStep[] } | { phase: 'done'; hunt: string; done: CreateStep[] } | { phase: 'error'; error: string; done: CreateStep[] };

export function StudioForm() {
  const signer = useWalletSigner();
  const [self, setSelf] = useState(false);
  const [spot, setSpot] = useState<Spot>([112, 12]);
  const [title, setTitle] = useState('');
  const [clue, setClue] = useState('');
  const [prize, setPrize] = useState(0.05);
  const [fee, setFee] = useState(0.01);
  const [minutes, setMinutes] = useState(20);
  const [startsIn, setStartsIn] = useState(0);
  const [share, setShare] = useState(10);
  const [run, setRun] = useState<Run>({ phase: 'idle' });

  const problems: string[] = [];
  if (!title.trim()) problems.push('Give the hunt a name.');
  if (bytes(title) > MAX_TITLE_BYTES) problems.push(`The name is too long: ${MAX_TITLE_BYTES} bytes at most.`);
  if (self && !clue.trim()) problems.push('Write the riddle players will get.');
  if (bytes(clue) > MAX_CLUE_BYTES) problems.push(`The riddle is too long: ${MAX_CLUE_BYTES} bytes at most.`);
  if (!(prize >= 0.01)) problems.push('Put up at least 0.01 SOL.');
  const minPlay = LIMITS.minPlaySecs + 15;
  if (!(minutes * 60 >= minPlay)) problems.push(`The clock must run at least ${Math.floor(minPlay / 60)} min ${minPlay % 60} s.`);
  if (minutes * 60 > LIMITS.maxDurationSecs) problems.push(`The clock can run at most ${LIMITS.maxDurationSecs / 86_400} days.`);
  if (!(startsIn >= 0)) problems.push('The hunt starts now or later, not in the past.');
  if (startsIn * 60 > LIMITS.maxStartDelaySecs) problems.push(`The hunt can start at most ${LIMITS.maxStartDelaySecs / 86_400} days from now.`);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signer || problems.length) return;
    const done: CreateStep[] = [];
    setRun({ phase: 'running', done: [] });
    try {
      const durationSecs = minutes * 60;
      const created = await createHunt(terraClient(), signer, {
        mode: self ? 'author' : 'vrf',
        ...(self ? { location: fromLatLon(spot[1], spot[0]) } : {}),
        title: title.trim(),
        clue: clue.trim(),
        prizeSeed: Math.round(prize * LAMPORTS_PER_SOL),
        entryFee: Math.round(fee * LAMPORTS_PER_SOL),
        creatorBps: Math.min(MAX_CREATOR_BPS, share * 100),
        durationSecs,
        startsInSecs: Math.round(startsIn * 60),
        zoneIntervalSecs: Math.max(30, Math.round(durationSecs / 10)),
        onStep: (step) => {
          done.push(step);
          setRun({ phase: 'running', done: [...done] });
        },
      });
      setRun({ phase: 'done', hunt: created.hunt.toBase58(), done: [...done] });
    } catch (error) {
      const text = error instanceof TerraError && error.code === 'InvalidParams' ? `The program would refuse these settings (${error.message.replace(/^invalid hunt parameters: /, '')}).` : error instanceof Error ? error.message : String(error);
      setRun({ phase: 'error', error: text, done: [...done] });
    }
  };

  const busy = run.phase === 'running';
  return (
    <form className={f.layout} onSubmit={submit} noValidate>
      <div className={st.studio}>
        <StudioStage
          self={self}
          spot={spot}
          prizeSol={prize}
          feeSol={fee}
          clockText={clockText(minutes)}
          onPick={(s) => {
            setSelf(true);
            setSpot(s);
          }}
        />
        <div className={st.tabs} role="group" aria-label="Who picks the spot">
          <button type="button" aria-pressed={!self} onClick={() => setSelf(false)}>The enclave picks the spot</button>
          <button type="button" aria-pressed={self} onClick={() => setSelf(true)}>I choose it and write the riddle</button>
        </div>
        <p className={f.hint}>
          {self ? `Your treasure: ${latLonText(spot[1], spot[0])}. Click the globe to move it. Only the fingerprint is published until the hunt ends.` : 'Verifiable randomness draws the point inside the enclave. Nobody, you included, learns it before the end.'}
        </p>
      </div>

      <div className={f.fields}>
        <label className={f.field}>
          <span>Name of the hunt</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={MAX_TITLE_BYTES} placeholder="The Roaring Forties" />
        </label>
        {self ? (
          <label className={f.field}>
            <span>The riddle</span>
            <textarea className={st.riddle} value={clue} onChange={(e) => setClue(e.target.value)} rows={3} placeholder="Where the old tea clippers turned for home…" />
            <small>{bytes(clue)} / {MAX_CLUE_BYTES} bytes</small>
          </label>
        ) : null}
        <div className={st.knobs}>
          <label className={st.knob}><span>Prize</span><input className="pull" type="range" min={0.01} max={2} step={0.01} value={prize} onChange={(e) => setPrize(+e.target.value)} /><output>{fmtSol(prize)}</output></label>
          <label className={st.knob}><span>Entry fee</span><input className="pull" type="range" min={0} max={0.2} step={0.005} value={fee} onChange={(e) => setFee(+e.target.value)} /><output>{fee ? fmtSol(fee) : 'free'}</output></label>
          <label className={st.knob}><span>Clock</span><input className="pull" type="range" min={1} max={240} step={1} value={Math.min(240, minutes)} onChange={(e) => setMinutes(+e.target.value)} /><output>{clockText(minutes)}</output></label>
          <label className={st.knob}><span>Your share</span><input className="pull" type="range" min={0} max={MAX_CREATOR_BPS / 100} step={1} value={share} onChange={(e) => setShare(+e.target.value)} /><output>{share}% of entries</output></label>
        </div>

        <div className={f.pair}>
          <label className={f.field}>
            <span>Clock, minutes</span>
            <input type="number" inputMode="numeric" min={1} value={Number.isFinite(minutes) ? minutes : ''} onChange={(e) => setMinutes(e.target.valueAsNumber)} data-testid="studio-clock" />
          </label>
          <label className={f.field}>
            <span>Starts in, minutes</span>
            <input type="number" inputMode="numeric" min={0} value={Number.isFinite(startsIn) ? startsIn : ''} onChange={(e) => setStartsIn(e.target.valueAsNumber)} data-testid="studio-starts" />
          </label>
        </div>

        {problems.length && (title || clue || minutes * 60 < minPlay || startsIn !== 0) ? (
          <ul className={f.problems} role="alert" data-testid="studio-problems">
            {problems.map((x) => <li key={x}>{x}</li>)}
          </ul>
        ) : null}

        <div className={f.actions}>
          {signer ? (
            <button type="submit" className="btn" disabled={busy || problems.length > 0}>
              {busy ? 'Hiding the treasure…' : 'Hide the treasure'}
            </button>
          ) : (
            <WalletButton className="btn" label="Connect a wallet to create" />
          )}
          {signer ? <WalletButton className={f.walletLink} /> : null}
          <p className={f.cost}>Your wallet pays the prize and about four transactions. Creating takes about ten seconds.</p>
        </div>

        {run.phase !== 'idle' ? (
          <ol className={f.steps} aria-live="polite">
            {STEPS.map(({ step, label }) => (
              <li key={step} className={run.done.includes(step) ? f.stepDone : undefined}>{label}</li>
            ))}
          </ol>
        ) : null}
        {run.phase === 'done' ? (
          <div className={p.state} role="status">
            <b>Your treasure is hidden.</b>
            Hunt {shortHash(run.hunt)} is live. Share the link and watch the ships come.
            <br />
            <Link className="btn" href={`/hunt/${run.hunt}`}>Go to your hunt</Link>
          </div>
        ) : null}
        {run.phase === 'error' ? (
          <div className={p.state} role="alert">
            <b>The hunt was not created.</b>
            {run.error}
          </div>
        ) : null}
      </div>
    </form>
  );
}
