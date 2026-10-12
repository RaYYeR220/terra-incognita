'use client';

import { useState } from 'react';

import { StudioStage, clockOf, clockText, feeOf, prizeOf } from '@/components/studio/StudioStage';
import type { Spot } from '@/components/studio/StudioStage';
import { fmtSol } from '@/lib/format';
import st from '@/components/studio/studio.module.css';

/** The studio in miniature: the same stage and knobs as the real one. */
export function StudioDemo() {
  const [self, setSelf] = useState(false);
  const [spot, setSpot] = useState<Spot>([112, 12]);
  const [prize, setPrize] = useState(10);
  const [fee, setFee] = useState(5);
  const [clock, setClock] = useState(4);
  const choose = (mine: boolean) => {
    setSelf(mine);
    if (!mine) setSpot([75 + Math.random() * 90, 2 + Math.random() * 40]);
  };
  return (
    <div className={st.studio}>
      <StudioStage
        self={self}
        spot={spot}
        prizeSol={prizeOf(prize)}
        feeSol={feeOf(fee)}
        clockText={clockText(clockOf(clock))}
        onPick={(p) => {
          setSelf(true);
          setSpot(p);
        }}
      />
      <div className={st.tabs} role="group" aria-label="Who picks the spot">
        <button type="button" aria-pressed={!self} onClick={() => choose(false)}>The enclave picks the spot</button>
        <button type="button" aria-pressed={self} onClick={() => choose(true)}>I choose it and write the riddle</button>
      </div>
      <div className={st.knobs}>
        <label className={st.knob}><span>Prize</span><input className="pull" type="range" min={1} max={40} value={prize} onChange={(e) => setPrize(+e.target.value)} /><output>{fmtSol(prizeOf(prize))}</output></label>
        <label className={st.knob}><span>Entry fee</span><input className="pull" type="range" min={1} max={20} value={fee} onChange={(e) => setFee(+e.target.value)} /><output>{feeOf(fee).toFixed(2)} SOL</output></label>
        <label className={st.knob}><span>Clock</span><input className="pull" type="range" min={1} max={12} value={clock} onChange={(e) => setClock(+e.target.value)} /><output>{clockText(clockOf(clock))}</output></label>
      </div>
      {self ? <textarea className={st.riddle} rows={2} aria-label="Your riddle" placeholder="Write the riddle" /> : null}
    </div>
  );
}
