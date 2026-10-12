'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { networkOptions } from '../chain/client';
import type { FromBots, ToBots } from './bots.worker';

export type BotsState =
  | { phase: 'idle' }
  | { phase: 'funding' }
  | { phase: 'racing'; names: string[]; soundings: number }
  | { phase: 'finished'; sweptSol: number }
  | { phase: 'failed'; error: string };

/** Starts rival bots on a live hunt, in a worker, and reports how they are doing. */
export function useBots(hunt: string | null): { state: BotsState; start: (count?: number) => void } {
  const [state, setState] = useState<BotsState>({ phase: 'idle' });
  const worker = useRef<Worker | null>(null);

  useEffect(() => () => worker.current?.terminate(), []);

  const start = useCallback(
    (count = 3) => {
      if (!hunt || worker.current) return;
      const w = new Worker(new URL('./bots.worker.ts', import.meta.url), { type: 'module' });
      worker.current = w;
      setState({ phase: 'funding' });
      w.onmessage = (event: MessageEvent<FromBots>) => {
        const msg = event.data;
        if (msg.type === 'funded') setState({ phase: 'racing', names: msg.bots.map((b) => b.name), soundings: 0 });
        else if (msg.type === 'event' && msg.kind === 'probe')
          setState((s) => (s.phase === 'racing' ? { ...s, soundings: s.soundings + 1 } : s));
        else if (msg.type === 'finished') setState({ phase: 'finished', sweptSol: msg.sweptLamports / 1e9 });
        else if (msg.type === 'failed') {
          setState({ phase: 'failed', error: msg.error });
          worker.current = null;
        }
      };
      w.onerror = () => setState({ phase: 'failed', error: 'The bots stopped unexpectedly.' });
      const message: ToBots = { type: 'start', hunt, count, origin: window.location.origin, network: networkOptions() };
      w.postMessage(message);
    },
    [hunt],
  );

  return { state, start };
}
