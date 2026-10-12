import { TerraClient } from '@terra-incognita/sdk';
import type { ClientOptions } from '@terra-incognita/sdk';

/** Network endpoints from the environment; devnet defaults are built into the SDK. */
export function networkOptions(): ClientOptions {
  const options: ClientOptions = {};
  if (process.env.NEXT_PUBLIC_TERRA_BASE_RPC) options.baseRpc = process.env.NEXT_PUBLIC_TERRA_BASE_RPC;
  if (process.env.NEXT_PUBLIC_TERRA_ROLLUP_RPC) options.rollupRpc = process.env.NEXT_PUBLIC_TERRA_ROLLUP_RPC;
  if (process.env.NEXT_PUBLIC_TERRA_ROUTER_RPC) options.routerRpc = process.env.NEXT_PUBLIC_TERRA_ROUTER_RPC;
  return options;
}

let shared: TerraClient | null = null;

/** One client per page: it caches rollup sessions and the clock offset. */
export function terraClient(): TerraClient {
  shared ??= new TerraClient(networkOptions());
  return shared;
}

/** Lamports a guest or a bot needs to join one hunt: the logbook's rent and the fees. */
export const JOIN_FUNDING = 30_000_000;
