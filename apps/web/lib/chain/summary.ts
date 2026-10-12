import type { HuntAccount } from '@terra-incognita/sdk';

import type { HuntSummary } from '../feed/types';

/** The public facts of a hunt account, in the shape lists and posters use. JSON-safe. */
export function summarize(hunt: HuntAccount, potLamports: number | null, now: number): HuntSummary {
  return {
    id: hunt.address.toBase58(),
    number: null,
    title: hunt.title || 'Untitled hunt',
    status: hunt.status,
    mode: hunt.mode,
    clue: hunt.clue || null,
    potSol: (potLamports ?? hunt.prizeSeed + hunt.entryFee * hunt.players) / 1e9,
    entryFeeSol: hunt.entryFee / 1e9,
    ships: hunt.players,
    maxPlayers: hunt.maxPlayers,
    zone: { stage: hunt.zone.stage, center: [...hunt.zone.center] as unknown as HuntSummary['zone']['center'] },
    startsAt: hunt.startsAt,
    deadline: hunt.deadline,
    winnerShip: null,
    readAt: now,
    finalized: hunt.finalized,
    creator: hunt.creator.toBase58(),
  };
}
