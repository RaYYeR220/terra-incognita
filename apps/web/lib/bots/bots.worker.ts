/// <reference lib="webworker" />
/**
 * Rival bots for a live hunt. Each bot gets a fresh key funded by the faucet, plays with the
 * hunter's solver through the chain client, and sends what it has left back to the treasury
 * when the hunt is over. The solver is CPU-heavy, which is why this runs off the main thread.
 */
import { Keypair, PublicKey } from '@solana/web3.js';
import { runChainBots } from '@terra-incognita/hunter';
import type { ChainBot, PersonalityName } from '@terra-incognita/hunter';
import { HuntStatus } from '@terra-incognita/core';
import { TerraClient, claimRefund, keypairSigner, sweepAccounts, waitForSettlement } from '@terra-incognita/sdk';
import type { ClientOptions } from '@terra-incognita/sdk';

declare const self: DedicatedWorkerGlobalScope;

export type ToBots = { type: 'start'; hunt: string; count: number; origin: string; network: ClientOptions };
export type FromBots =
  | { type: 'funded'; bots: { name: string; personality: string; key: string }[] }
  | { type: 'event'; bot: string; kind: 'joined' | 'course' | 'probe' | 'done' | 'error'; detail: string }
  | { type: 'finished'; sweptLamports: number }
  | { type: 'failed'; error: string };

const LINEUP: PersonalityName[] = ['shadow', 'wanderer', 'surveyor'];
const post = (msg: FromBots) => self.postMessage(msg);

async function start(msg: Extract<ToBots, { type: 'start' }>): Promise<void> {
  const client = new TerraClient(msg.network);
  const hunt = new PublicKey(msg.hunt);
  const keys = Array.from({ length: Math.min(3, Math.max(1, msg.count)) }, () => Keypair.generate());
  const res = await fetch(`${msg.origin}/api/faucet`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ keys: keys.map((k) => k.publicKey.toBase58()), hunt: msg.hunt, purpose: 'bots' }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; treasury?: string };
  if (!res.ok || !body.treasury) throw new Error(body.error ?? 'The faucet could not fund the bots.');
  const treasury = new PublicKey(body.treasury);

  try {
    const bots: ChainBot[] = keys.map((owner, i) => ({
      name: `${LINEUP[i]}-${owner.publicKey.toBase58().slice(0, 4)}`,
      owner,
      personality: LINEUP[i] as PersonalityName,
      seed: (Date.now() % 1_000_000) + i,
    }));
    post({ type: 'funded', bots: bots.map((b) => ({ name: b.name, personality: b.personality, key: b.owner.publicKey.toBase58() })) });

    await runChainBots(client, hunt, bots, {
      keeperSecs: 3,
      onEvent: (event) => {
        let detail = '';
        if (event.kind === 'joined') detail = event.signature;
        else if (event.kind === 'probe') detail = `sounding ${event.index + 1}`;
        else if (event.kind === 'done') detail = `${event.result.outcome} after ${event.result.probes} soundings`;
        else if (event.kind === 'error') detail = event.error instanceof Error ? event.error.message : String(event.error);
        post({ type: 'event', bot: event.bot, kind: event.kind, detail });
      },
    });
    // A void hunt hands every entry fee back; each bot signs for its own. In a hunt with
    // soundings the logbooks stay open on Solana, because the proof is built from them.
    const ended = await waitForSettlement(client, hunt).catch(() => null);
    if (ended?.hunt.status === HuntStatus.Void) {
      for (const owner of keys) await claimRefund(client, hunt, owner.publicKey, keypairSigner(owner)).catch(() => undefined);
    }
  } finally {
    // Whatever happened above, every bot sends what it holds back to the treasury.
    const swept = await sweepAccounts(client, keys, treasury).catch(() => 0);
    post({ type: 'finished', sweptLamports: swept });
  }
}

self.onmessage = (event: MessageEvent<ToBots>) => {
  if (event.data.type !== 'start') return;
  start(event.data).catch((error: unknown) => post({ type: 'failed', error: error instanceof Error ? error.message : String(error) }));
};
