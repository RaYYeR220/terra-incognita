import type { AccountInfo, PublicKey } from '@solana/web3.js';
import type { Buffer } from 'buffer';

import { decodeBoard, decodeHunt } from './accounts.js';
import type { BoardAccount, HuntAccount } from './accounts.js';
import { bytesEqual } from './codec.js';
import type { Layer, TerraClient } from './client.js';
import { boardAddress } from './pda.js';

export interface HuntSnapshot {
  hunt: HuntAccount;
  board: BoardAccount | null;
  /** Where the hunt account was read: the rollup while it is delegated, Solana after it. */
  layer: Layer;
  /** Which path delivered this update. */
  via: 'initial' | 'websocket' | 'poll';
}

export interface WatchOptions {
  /** Poll interval used when the websocket is quiet. Default 2000 ms. */
  pollMs?: number;
  /** Turn off the websocket and only poll. */
  pollOnly?: boolean;
  onError?: (error: unknown) => void;
}

export interface HuntWatch {
  stop(): void;
  /** The last snapshot delivered, if any. */
  readonly current: HuntSnapshot | null;
}

/**
 * Follows a hunt's public state: the hunt account and its board. Updates arrive over the
 * rollup's websocket; when that is quiet for longer than `pollMs` the accounts are polled, so
 * the callback keeps firing if the websocket drops or never connects. After finalisation the
 * hunt is read from Solana. The callback fires only when something changed.
 */
export function watchHunt(
  client: TerraClient,
  huntAddress: PublicKey,
  onUpdate: (snapshot: HuntSnapshot) => void,
  options: WatchOptions = {},
): HuntWatch {
  const pollMs = options.pollMs ?? 2_000;
  const board = boardAddress(huntAddress, client.programId);
  let stopped = false;
  let current: HuntSnapshot | null = null;
  let huntData: Uint8Array | null = null;
  let boardData: Uint8Array | null = null;
  let layer: Layer = 'rollup';
  let lastPush = 0;
  const subscriptions: number[] = [];

  const report = (error: unknown) => options.onError?.(error);

  const emit = (via: HuntSnapshot['via']) => {
    if (stopped || !huntData) return;
    try {
      current = {
        hunt: decodeHunt(huntAddress, huntData),
        board: boardData ? decodeBoard(board, boardData) : null,
        layer,
        via,
      };
      onUpdate(current);
    } catch (error) {
      report(error);
    }
  };

  const accept = (which: 'hunt' | 'board', data: Uint8Array | null, from: Layer, via: HuntSnapshot['via']) => {
    if (!data || data.length === 0) return;
    const previous = which === 'hunt' ? huntData : boardData;
    if (previous && bytesEqual(previous, data) && (which === 'board' || layer === from)) return;
    if (which === 'hunt') {
      huntData = data;
      layer = from;
    } else {
      boardData = data;
    }
    emit(via);
  };

  const poll = async (via: 'initial' | 'poll') => {
    const finalized = current?.hunt.finalized === true;
    if (!finalized && layer === 'rollup' && via === 'poll') {
      const [hunt, boardInfo] = await client.rollup.getMultipleAccountsInfo([huntAddress, board]);
      accept('board', boardInfo?.data ?? null, 'rollup', via);
      accept('hunt', hunt?.data ?? null, 'rollup', via);
      return;
    }
    const [hunt, boardFound] = await Promise.all([client.fetchLatest(huntAddress), client.fetchLatest(board)]);
    accept('board', boardFound?.info.data ?? null, boardFound?.layer ?? 'rollup', via);
    accept('hunt', hunt?.info.data ?? null, hunt?.layer ?? 'rollup', via);
  };

  const onChange = (which: 'hunt' | 'board') => (info: AccountInfo<Buffer>) => {
    lastPush = Date.now();
    if (current?.hunt.finalized && which === 'hunt') return;
    accept(which, info.data, 'rollup', 'websocket');
  };

  if (!options.pollOnly) {
    try {
      subscriptions.push(client.rollup.onAccountChange(huntAddress, onChange('hunt'), { commitment: 'confirmed' }));
      subscriptions.push(client.rollup.onAccountChange(board, onChange('board'), { commitment: 'confirmed' }));
    } catch (error) {
      report(error);
    }
  }

  poll('initial').catch(report);
  const timer = setInterval(() => {
    const quiet = Date.now() - lastPush >= pollMs;
    if (stopped || (!quiet && !current?.hunt.finalized)) return;
    poll('poll').catch(report);
  }, pollMs);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      for (const id of subscriptions) client.rollup.removeAccountChangeListener(id).catch(() => undefined);
    },
    get current() {
      return current;
    },
  };
}
