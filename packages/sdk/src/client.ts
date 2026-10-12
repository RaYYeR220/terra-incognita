import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import type { AccountInfo, TransactionInstruction } from '@solana/web3.js';
import type { Buffer } from 'buffer';

import {
  decodeBoard,
  decodeHunt,
  decodeLogbook,
  decodeTreasure,
  decodeVault,
} from './accounts.js';
import type { BoardAccount, HuntAccount, LogbookAccount, TreasureAccount, VaultAccount } from './accounts.js';
import { base58 } from './codec.js';
import { DELEGATION_PROGRAM_ID, DEVNET, PROGRAM_ID, SYSVAR_CLOCK_ID } from './constants.js';
import type { NetworkConfig } from './constants.js';
import { TerraError, TerraTxError } from './errors.js';
import { computeLimit } from './instructions.js';
import { boardAddress, logbookAddress, treasureAddress, vaultAddress } from './pda.js';
import { keypairSigner, toSigner } from './signer.js';
import type { LocalSigner, TerraSigner } from './signer.js';

export type Layer = 'solana' | 'rollup';

export interface SendOptions {
  computeUnits?: number;
  skipPreflight?: boolean;
  timeoutMs?: number;
}

export interface ClientOptions extends Partial<NetworkConfig> {
  programId?: PublicKey;
  /**
   * Key used to open a rollup session for sending. Any key will do: the rollup asks for a
   * token on every request, but transactions carry their own signatures. A fresh key is
   * created when absent, so a browser never has to ask the wallet to sign a login message.
   */
  relay?: Keypair;
}

interface Token {
  token: string;
  expiresAt: number;
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `probe` until it returns a truthy value. */
export async function waitFor<T>(
  what: string,
  probe: () => Promise<T | null | undefined | false>,
  timeoutMs = 60_000,
  intervalMs = 500,
): Promise<T> {
  const started = Date.now();
  let lastError: unknown;
  for (;;) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() - started >= timeoutMs) break;
    await sleep(intervalMs);
  }
  throw new TerraError('Timeout', `timed out waiting for ${what}${lastError ? `: ${String(lastError)}` : ''}`);
}

const TRANSIENT = /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|EAI_AGAIN|\b50[234]\b/i;

/** Retries a read that failed for reasons of the network rather than of the request. */
async function retrying<T>(read: () => Promise<T>, attempts = 4): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      if (attempt >= attempts || !TRANSIENT.test(String((error as Error)?.message ?? error))) throw error;
      await sleep(400 * attempt);
    }
  }
}

/** Where an account currently lives. */
export type Residence = 'solana' | 'rollup' | 'missing';

/**
 * Connections to Solana and to the private rollup, rollup sessions, sending and account reads.
 * Everything else in this package takes one of these.
 */
export class TerraClient {
  readonly config: NetworkConfig;
  readonly programId: PublicKey;
  /** Solana. */
  readonly base: Connection;
  /** The rollup without credentials: enough for public accounts and subscriptions. */
  readonly rollup: Connection;
  readonly relay: LocalSigner;

  private readonly tokens = new Map<string, Token>();
  private readonly pendingTokens = new Map<string, Promise<Token>>();
  private readonly sessions = new Map<string, Connection>();
  private clock: { offset: number; at: number } | null = null;

  constructor(options: ClientOptions = {}) {
    const { programId, relay, ...network } = options;
    this.config = { ...DEVNET, ...network };
    this.programId = programId ?? PROGRAM_ID;
    this.base = new Connection(this.config.baseRpc, {
      commitment: 'confirmed',
      ...(this.config.baseWs ? { wsEndpoint: this.config.baseWs } : {}),
    });
    this.rollup = new Connection(this.rollupUrl(), {
      commitment: 'confirmed',
      ...(this.config.rollupWs ? { wsEndpoint: this.config.rollupWs } : {}),
    });
    this.relay = keypairSigner(relay ?? Keypair.generate());
  }

  private rollupUrl(token?: string): string {
    const url = this.config.rollupRpc.replace(/\/$/, '');
    return token ? `${url}?token=${token}` : url;
  }

  private rollupWs(token: string): string | undefined {
    return this.config.rollupWs ? `${this.config.rollupWs.replace(/\/$/, '')}?token=${token}` : undefined;
  }

  // Rollup sessions -----------------------------------------------------------------------------

  /**
   * Signs the rollup's login challenge with `signer` and returns the session token. Tokens are
   * cached until shortly before they expire. With a wallet this asks for one message signature.
   */
  async authenticate(signer: TerraSigner): Promise<string> {
    const key = signer.publicKey.toBase58();
    const cached = this.tokens.get(key);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    let pending = this.pendingTokens.get(key);
    if (!pending) {
      pending = this.login(signer).finally(() => this.pendingTokens.delete(key));
      this.pendingTokens.set(key, pending);
    }
    const token = await pending;
    this.tokens.set(key, token);
    this.sessions.delete(key);
    return token.token;
  }

  private async login(signer: TerraSigner): Promise<Token> {
    if (!signer.signMessage) throw new TerraError('CannotSignMessage', 'this signer cannot sign the rollup login');
    const root = this.rollupUrl();
    const pubkey = signer.publicKey.toBase58();
    const challengeResponse = await fetch(`${root}/auth/challenge?pubkey=${pubkey}`);
    const { challenge, error } = (await challengeResponse.json()) as { challenge?: string; error?: string };
    if (!challenge) throw new TerraError('RollupAuth', `no login challenge: ${error ?? challengeResponse.status}`);
    const signature = await signer.signMessage(new TextEncoder().encode(challenge));
    const loginResponse = await fetch(`${root}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pubkey, challenge, signature: base58(signature) }),
    });
    const login = (await loginResponse.json()) as { token?: string; expiresAt?: number; error?: string };
    if (loginResponse.status !== 200 || !login.token) {
      throw new TerraError('RollupAuth', `rollup login failed: ${login.error ?? loginResponse.status}`);
    }
    return { token: login.token, expiresAt: login.expiresAt ?? Date.now() + 24 * 3600_000 };
  }

  /** Rollup connection authenticated as `signer`: it can read what `signer` may read. */
  async rollupAs(signer: TerraSigner): Promise<Connection> {
    const token = await this.authenticate(signer);
    const key = signer.publicKey.toBase58();
    let connection = this.sessions.get(key);
    if (!connection) {
      const wsEndpoint = this.rollupWs(token);
      connection = new Connection(this.rollupUrl(token), {
        commitment: 'confirmed',
        ...(wsEndpoint ? { wsEndpoint } : {}),
      });
      this.sessions.set(key, connection);
    }
    return connection;
  }

  /** Connection used to send rollup transactions. */
  rollupSender(): Promise<Connection> {
    return this.rollupAs(this.relay);
  }

  /** The rollup's clock in unix seconds, which is the clock the hunt rules run on. */
  async now(): Promise<number> {
    if (!this.clock || Date.now() - this.clock.at > 30_000) {
      const info = await this.rollup.getAccountInfo(SYSVAR_CLOCK_ID);
      if (info && info.data.length >= 40) {
        const unix = Number(new DataView(info.data.buffer, info.data.byteOffset, info.data.byteLength).getBigInt64(32, true));
        // The sysvar holds whole seconds; assume the read landed half way through one.
        this.clock = { offset: unix + 0.5 - Date.now() / 1000, at: Date.now() };
      } else {
        this.clock = { offset: 0, at: Date.now() };
      }
    }
    return Math.floor(Date.now() / 1000 + this.clock.offset);
  }

  /** Whether the router sees `account` as delegated to a rollup validator. */
  async isDelegated(account: PublicKey): Promise<boolean> {
    const response = await fetch(this.config.routerRpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getDelegationStatus', params: [account.toBase58()] }),
    });
    const json = (await response.json()) as { result?: { isDelegated?: boolean } };
    return json.result?.isDelegated === true;
  }

  /** Waits until `accounts` are delegated on Solana and the router reports them. */
  async waitForDelegation(accounts: PublicKey[], timeoutMs = 90_000): Promise<void> {
    await Promise.all(
      accounts.map((account) =>
        waitFor(
          `delegation of ${account.toBase58()}`,
          async () => (await this.residence(account)) === 'rollup' && (await this.isDelegated(account)),
          timeoutMs,
          750,
        ),
      ),
    );
  }

  /** Waits until `accounts` are back on Solana under the program. */
  async waitForRelease(accounts: PublicKey[], timeoutMs = 180_000): Promise<void> {
    await Promise.all(
      accounts.map((account) =>
        waitFor(`${account.toBase58()} back on Solana`, async () => (await this.residence(account)) === 'solana', timeoutMs, 1_500),
      ),
    );
  }

  // Sending -------------------------------------------------------------------------------------

  /**
   * Signs and sends `instructions` on `layer`, then waits for the result. The first signer pays.
   * Throws `TerraTxError` with the program error name when the transaction fails.
   */
  async send(
    layer: Layer,
    instructions: TransactionInstruction[],
    signers: TerraSigner | Keypair | (TerraSigner | Keypair)[],
    options: SendOptions = {},
  ): Promise<string> {
    const all = (Array.isArray(signers) ? signers : [signers]).map(toSigner);
    const payer = all[0];
    if (!payer) throw new TerraError('NoSigner', 'a transaction needs a signer');
    const connection = layer === 'solana' ? this.base : await this.rollupSender();
    const latest = await retrying(() => connection.getLatestBlockhash());
    let tx = new Transaction({ feePayer: payer.publicKey, ...latest });
    if (options.computeUnits) tx.add(computeLimit(options.computeUnits));
    tx.add(...instructions);
    for (const signer of all) tx = await signer.signTransaction(tx);

    let signature: string;
    try {
      signature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: options.skipPreflight ?? false,
      });
    } catch (error) {
      const logs = (error as { logs?: string[] })?.logs ?? [];
      throw new TerraTxError(layer, null, (error as Error)?.message ?? error, logs);
    }

    const timeoutMs = options.timeoutMs ?? (layer === 'solana' ? 90_000 : 30_000);
    const status = await waitFor(
      `confirmation of ${signature}`,
      async () => {
        const value = (await retrying(() => connection.getSignatureStatuses([signature]))).value[0];
        if (!value) return null;
        if (value.err) return value;
        if (layer === 'solana' && value.confirmationStatus === 'processed') return null;
        return value;
      },
      timeoutMs,
      layer === 'solana' ? 600 : 200,
    );
    if (status.err) {
      let logs: string[] = [];
      try {
        const details = await connection.getTransaction(signature, { maxSupportedTransactionVersion: 0 });
        logs = details?.meta?.logMessages ?? [];
      } catch {
        // Logs of transactions over private accounts are not served.
      }
      throw new TerraTxError(layer, signature, status.err, logs);
    }
    return signature;
  }

  // Reads ---------------------------------------------------------------------------------------

  /** Whether `account` sits on Solana under the program, is delegated to the rollup, or is gone. */
  async residence(account: PublicKey): Promise<Residence> {
    const info = await retrying(() => this.base.getAccountInfo(account));
    if (!info) return 'missing';
    if (info.owner.equals(DELEGATION_PROGRAM_ID)) return 'rollup';
    return 'solana';
  }

  /**
   * Reads an account from wherever it is authoritative: Solana while it is not delegated, the
   * rollup while it is. The rollup keeps stale copies of accounts it has released, so Solana is
   * always asked first.
   */
  async fetchLatest(
    account: PublicKey,
    rollup: Connection = this.rollup,
  ): Promise<{ info: AccountInfo<Buffer>; layer: Layer } | null> {
    const [onBase, onRollup] = await Promise.all([
      retrying(() => this.base.getAccountInfo(account)),
      retrying(() => rollup.getAccountInfo(account)).catch(() => null),
    ]);
    if (onBase && onBase.owner.equals(this.programId)) return { info: onBase, layer: 'solana' };
    if (onRollup && onRollup.data.length > 0) return { info: onRollup, layer: 'rollup' };
    if (onBase && onBase.owner.equals(DELEGATION_PROGRAM_ID)) return { info: onBase, layer: 'solana' };
    return null;
  }

  async fetchHunt(hunt: PublicKey): Promise<HuntAccount | null> {
    const found = await this.fetchLatest(hunt);
    return found ? decodeHunt(hunt, found.info.data) : null;
  }

  async fetchBoard(hunt: PublicKey): Promise<BoardAccount | null> {
    const address = boardAddress(hunt, this.programId);
    const found = await this.fetchLatest(address);
    return found ? decodeBoard(address, found.info.data) : null;
  }

  /** The vault never leaves Solana. */
  async fetchVault(hunt: PublicKey): Promise<VaultAccount | null> {
    const address = vaultAddress(hunt, this.programId);
    const info = await retrying(() => this.base.getAccountInfo(address));
    return info ? decodeVault(address, info.data) : null;
  }

  /**
   * A logbook as `reader` can see it. While the hunt runs only its owner and operator can read
   * it; once opened or released after the hunt anyone can.
   */
  async fetchLogbook(hunt: PublicKey, owner: PublicKey, reader?: TerraSigner): Promise<LogbookAccount | null> {
    const address = logbookAddress(hunt, owner, this.programId);
    const rollup = reader ? await this.rollupAs(reader) : this.rollup;
    const found = await this.fetchLatest(address, rollup);
    if (!found || !found.info.owner.equals(this.programId)) return null;
    return decodeLogbook(address, found.info.data);
  }

  /** The treasure, readable only after the hunt once it has been opened or released. */
  async fetchTreasure(hunt: PublicKey): Promise<TreasureAccount | null> {
    const address = treasureAddress(hunt, this.programId);
    const found = await this.fetchLatest(address);
    if (!found || !found.info.owner.equals(this.programId)) return null;
    return decodeTreasure(address, found.info.data);
  }

  explorerTx(signature: string): string {
    return `https://explorer.solana.com/tx/${signature}${this.config.cluster === 'mainnet-beta' ? '' : `?cluster=${this.config.cluster}`}`;
  }
}
