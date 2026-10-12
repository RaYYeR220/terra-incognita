import { HuntMode, HuntStatus, fromLatLon } from '@terra-incognita/core';

import type { HuntFeed, HuntSummary } from './types';

const T0 = 1_760_270_000;

function base(): HuntSummary[] {
  const now = Math.floor(Date.now() / 1000);
  return [
    {
      id: 'demo', number: 12, title: 'The Roaring Forties', status: HuntStatus.Live, mode: HuntMode.Vrf, clue: null,
      potSol: 2.4, entryFeeSol: 0.05, ships: 17, maxPlayers: 64,
      zone: { stage: 4, center: fromLatLon(-40, 60) }, startsAt: now - 498, deadline: now + 702, winnerShip: null, readAt: now,
    },
    {
      id: 'trade-winds', number: 13, title: 'Trade Winds', status: HuntStatus.Live, mode: HuntMode.Author,
      clue: 'Where the old tea clippers turned for home, look south of the cape that is not a cape.',
      potSol: 5, entryFeeSol: 0.1, ships: 6, maxPlayers: 64,
      zone: { stage: 2, center: fromLatLon(-12, 48) }, startsAt: now - 130, deadline: now + 1670, winnerShip: null, readAt: now,
    },
    {
      id: 'last-hunt', number: 11, title: 'Horse Latitudes', status: HuntStatus.Struck, mode: HuntMode.Vrf, clue: null,
      potSol: 1.85, entryFeeSol: 0.05, ships: 14, maxPlayers: 64,
      zone: { stage: 6, center: fromLatLon(31, -38) }, startsAt: T0 - 86_400, deadline: T0 - 85_200, winnerShip: 4, readAt: T0,
    },
    {
      id: 'doldrums', number: 10, title: 'Doldrums', status: HuntStatus.Closest, mode: HuntMode.Vrf, clue: null,
      potSol: 0.9, entryFeeSol: 0.02, ships: 9, maxPlayers: 64,
      zone: { stage: 8, center: fromLatLon(2, -25) }, startsAt: T0 - 172_800, deadline: T0 - 171_000, winnerShip: 2, readAt: T0,
    },
  ];
}

/** Stands in for the chain while the app is built: numbers move the way a live hunt's would. */
export class MockHuntFeed implements HuntFeed {
  async featured(): Promise<HuntSummary | null> {
    return base()[0] ?? null;
  }

  async list(): Promise<HuntSummary[]> {
    return base();
  }

  watch(id: string, onChange: (summary: HuntSummary) => void): () => void {
    const start = base().find((h) => h.id === id);
    if (!start || start.status !== HuntStatus.Live) return () => undefined;
    let current = start;
    const timer = setInterval(() => {
      const joined = Math.random() < 0.18;
      current = {
        ...current,
        ships: current.ships + (joined ? 1 : 0),
        potSol: Math.round((current.potSol + (joined ? current.entryFeeSol * 0.9 : 0)) * 1000) / 1000,
        readAt: Math.floor(Date.now() / 1000),
      };
      onChange(current);
    }, 4000);
    return () => clearInterval(timer);
  }
}
