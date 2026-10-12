'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Wallets } from '@/components/wallet/Wallets';

import { GameScreen } from './GameScreen';
import s from './game.module.css';

/**
 * `/hunt/demo` finds the live demo hunt (or has the server start one) and moves to its address.
 * Any other id is a hunt address, or `practice` for the simulator.
 */
export function HuntRoute({ id, sim, course }: { id: string; sim: boolean; course: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const resolving = id === 'demo' && !sim;

  useEffect(() => {
    if (!resolving) return;
    let alive = true;
    fetch('/api/hunts/ensure', { method: 'POST' })
      .then(async (res) => {
        const body = (await res.json()) as { hunt?: { id: string } | null; joinable?: boolean; error?: string };
        if (!alive) return;
        if (body.hunt && body.joinable !== false) router.replace(`/hunt/${body.hunt.id}${course ? `?course=${encodeURIComponent(course)}` : ''}`);
        else setError(body.error ?? 'No live hunt could be found or started.');
      })
      .catch(() => alive && setError('Could not reach the server to find the live hunt.'));
    return () => {
      alive = false;
    };
  }, [resolving, router, course]);

  if (resolving) {
    return (
      <div className={s.game}>
        <header className={s.bar}>
          <Link className={s.wm} href="/">TERRA INCOGNITA</Link>
        </header>
        <main className={s.waiting} id="main">
          <div className={s.waitCard} role="status">
            {error ? (
              <>
                <b>No live hunt right now.</b>
                <p>{error}</p>
                <p>
                  <Link className="btn" href="/hunt/practice">Play a practice hunt</Link>
                </p>
              </>
            ) : (
              <>
                <b>Finding the live hunt…</b>
                <p>If none has time left, a new one is sealed in the enclave. That takes about ten seconds.</p>
              </>
            )}
          </div>
        </main>
      </div>
    );
  }

  return (
    <Wallets>
      <GameScreen huntId={id} sim={sim} course={course} />
    </Wallets>
  );
}
