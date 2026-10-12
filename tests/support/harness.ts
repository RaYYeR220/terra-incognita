import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SYSVAR_SLOT_HASHES_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  DELEGATION_PROGRAM_ID,
  EPHEMERAL_VAULT_ID,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  PERMISSION_PROGRAM_ID,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
  escrowPdaFromEscrowAuthority,
  getAuthToken,
  magicFeeVaultPdaFromValidator,
  permissionPdaFromAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import nacl from "tweetnacl";
import idl from "../../target/idl/terra_incognita.json";
import { TerraIncognita } from "../../target/types/terra_incognita";
import { Vec3 } from "./geo";
import { encryptedActions } from "./sealed";

export const BASE_RPC = process.env.BASE_RPC ?? "https://rpc.magicblock.app/devnet";
export const ROUTER_RPC = process.env.ROUTER_RPC ?? "https://devnet-router.magicblock.app/";
export const TEE_RPC = (process.env.TEE_RPC ?? "https://devnet-tee.magicblock.app").replace(/\/$/, "");
export const TEE_VALIDATOR = new PublicKey(
  process.env.TEE_VALIDATOR ?? "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo",
);

export const VRF_PROGRAM_ID = new PublicKey("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz");
export const VRF_EPHEMERAL_QUEUE = new PublicKey("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc");
export const HYDRA_EPHEMERAL_ID = new PublicKey("eHyd5BU8QffvHi4GnXwxrK4WpS7pM2x9UGKHBWii7mf");

export const base = new Connection(BASE_RPC, "confirmed");

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `probe` until it returns a value, failing the test after `timeoutMs`. */
export async function waitFor<T>(
  what: string,
  probe: () => Promise<T | null | undefined | false>,
  timeoutMs = 60_000,
  intervalMs = 500,
): Promise<T> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`timed out waiting for ${what}${lastError ? `: ${lastError}` : ""}`);
}

// ---------------------------------------------------------------------------------------------
// Wallets

function readKeypair(file: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
}

export const payer = readKeypair(
  process.env.ANCHOR_WALLET ?? path.join(os.homedir(), ".config/solana/id.json"),
);

const keysDir = process.env.TERRA_KEYS_DIR ?? path.join(__dirname, "../../keys");

/** A named test wallet, persisted outside version control and topped up from the payer. */
export async function wallet(name: string, minSol = 0): Promise<Keypair> {
  fs.mkdirSync(keysDir, { recursive: true });
  const file = path.join(keysDir, `${name}.json`);
  let keypair: Keypair;
  if (fs.existsSync(file)) {
    keypair = readKeypair(file);
  } else {
    keypair = Keypair.generate();
    fs.writeFileSync(file, JSON.stringify(Array.from(keypair.secretKey)), { mode: 0o600 });
  }
  if (minSol > 0) {
    const balance = await base.getBalance(keypair.publicKey);
    const wanted = Math.round(minSol * LAMPORTS_PER_SOL);
    if (balance < wanted) {
      await sendBase(
        [
          SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: keypair.publicKey,
            lamports: wanted - balance,
          }),
        ],
        [payer],
      );
    }
  }
  return keypair;
}

// ---------------------------------------------------------------------------------------------
// Rollup access

const tokens = new Map<string, string>();

/** Signs the rollup's challenge with `keypair` and returns the bearer token for private reads. */
export async function teeToken(keypair: Keypair): Promise<string> {
  const key = keypair.publicKey.toBase58();
  let token = tokens.get(key);
  if (!token) {
    const auth = await getAuthToken(TEE_RPC, keypair.publicKey, async (message) =>
      nacl.sign.detached(message, keypair.secretKey),
    );
    token = auth.token;
    tokens.set(key, token);
  }
  return token;
}

/** Rollup connection authenticated as `keypair`. */
export async function tee(keypair: Keypair): Promise<Connection> {
  return new Connection(`${TEE_RPC}?token=${await teeToken(keypair)}`, "confirmed");
}

/** Rollup connection without any credentials. */
export const teeAnonymous = new Connection(TEE_RPC, "confirmed");

/** Raw JSON-RPC call that returns the full response, including errors. */
export async function rpc(url: string, method: string, params: unknown[]): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await response.text();
  try {
    return { status: response.status, ...JSON.parse(text) };
  } catch {
    return { status: response.status, raw: text };
  }
}

// ---------------------------------------------------------------------------------------------
// Sending

export class TransactionFailed extends Error {
  constructor(
    readonly signature: string | null,
    readonly cause: unknown,
    readonly logs: string[],
  ) {
    super(`transaction failed: ${JSON.stringify(cause)}\n${logs.join("\n")}`);
  }

  /** Anchor error name or number found in the logs or the raw error. */
  get code(): string {
    const text = `${JSON.stringify(this.cause)} ${this.logs.join(" ")}`;
    const named = /Error Code: (\w+)/.exec(text);
    if (named) return named[1];
    const custom = /"Custom":\s*(\d+)|custom program error: (0x[0-9a-f]+)/i.exec(text);
    if (custom) {
      const number = Number(custom[1] ?? custom[2]);
      const known = (idl as { errors?: { code: number; name: string }[] }).errors?.find(
        (entry) => entry.code === number,
      );
      return known ? pascal(known.name) : (FRAMEWORK_ERRORS[number] ?? String(number));
    }
    return text;
  }
}

const pascal = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

/** Anchor's own error codes that the tests expect. */
const FRAMEWORK_ERRORS: Record<number, string> = {
  2001: "ConstraintHasOne",
  2003: "ConstraintRaw",
  2006: "ConstraintSeeds",
  2012: "ConstraintAddress",
  3007: "AccountOwnedByWrongProgram",
  3012: "AccountNotInitialized",
};

export interface SendOptions {
  computeUnits?: number;
  skipPreflight?: boolean;
  timeoutMs?: number;
  /**
   * Return the signature even if no status arrives in time. For steps whose effect the
   * caller verifies itself, because the rollup occasionally never reports a status.
   */
  allowUnconfirmed?: boolean;
}

async function send(
  connection: Connection,
  instructions: TransactionInstruction[],
  signers: Keypair[],
  options: SendOptions = {},
): Promise<string> {
  const latest = await connection.getLatestBlockhash();
  const tx = new Transaction({ feePayer: signers[0].publicKey, ...latest });
  if (options.computeUnits) {
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: options.computeUnits }));
  }
  tx.add(...instructions);
  tx.sign(...signers);

  let signature: string;
  try {
    signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: options.skipPreflight ?? false,
    });
  } catch (error: any) {
    throw new TransactionFailed(null, error?.message ?? error, error?.logs ?? []);
  }

  let status;
  try {
    status = await waitFor(
      `confirmation of ${signature}`,
      async () => (await connection.getSignatureStatuses([signature])).value[0],
      options.timeoutMs ?? 60_000,
      250,
    );
  } catch (error) {
    if (!options.allowUnconfirmed) throw error;
    console.log(`      no status for ${signature}; the caller verifies the effect`);
    return signature;
  }
  if (status.err) {
    let logs: string[] = [];
    try {
      const details = await connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });
      logs = details?.meta?.logMessages ?? [];
    } catch {
      // Logs of transactions that touch private accounts are not served to everyone.
    }
    throw new TransactionFailed(signature, status.err, logs);
  }
  return signature;
}

export const sendBase = (
  instructions: TransactionInstruction[],
  signers: Keypair[],
  options?: SendOptions,
) => send(base, instructions, signers, options);

export async function sendTee(
  instructions: TransactionInstruction[],
  signers: Keypair[],
  options?: SendOptions,
): Promise<string> {
  return send(await tee(signers[0]), instructions, signers, options);
}

/** Runs `action` and returns the failure it must produce. */
export async function expectFailure(action: () => Promise<unknown>): Promise<TransactionFailed> {
  try {
    await action();
  } catch (error) {
    if (error instanceof TransactionFailed) return error;
    throw error;
  }
  throw new Error("transaction unexpectedly succeeded");
}

// ---------------------------------------------------------------------------------------------
// Evidence

const evidenceFile = process.env.TERRA_EVIDENCE_LOG;

export function evidence(line: string): void {
  console.log(`      ${line}`);
  if (evidenceFile) fs.appendFileSync(evidenceFile, `${line}\n`);
}

export function evidenceSection(title: string): void {
  if (evidenceFile) {
    fs.appendFileSync(evidenceFile, `\n### ${title} (${new Date().toISOString()})\n\n`);
  }
}

// ---------------------------------------------------------------------------------------------
// Program

export const program = new Program<TerraIncognita>(
  idl as TerraIncognita,
  new anchor.AnchorProvider(base, new anchor.Wallet(payer), { commitment: "confirmed" }),
);
export const PROGRAM_ID = program.programId;

const pda = (seeds: (Buffer | Uint8Array)[], programId = PROGRAM_ID) =>
  PublicKey.findProgramAddressSync(seeds, programId)[0];

export interface HuntOptions {
  mode: "vrf" | "author";
  entryFee?: number;
  prizeSeed?: number;
  creatorBps?: number;
  maxPlayers?: number;
  speedKms?: number;
  startsInSecs?: number;
  durationSecs: number;
  zoneIntervalSecs?: number;
  opsLamports?: number;
  title?: string;
  clue?: string;
}

/** Addresses and instruction builders of one hunt. */
export class Hunt {
  readonly hunt: PublicKey;
  readonly board: PublicKey;
  readonly treasure: PublicKey;
  readonly vault: PublicKey;
  readonly treasurePermission: PublicKey;
  readonly actionEscrow: PublicKey;
  readonly feeVault: PublicKey;
  readonly crank: PublicKey;

  constructor(
    readonly creator: Keypair,
    readonly id: BN,
  ) {
    this.hunt = pda([
      Buffer.from("hunt"),
      creator.publicKey.toBuffer(),
      id.toArrayLike(Buffer, "le", 8),
    ]);
    this.board = pda([Buffer.from("board"), this.hunt.toBuffer()]);
    this.treasure = pda([Buffer.from("treasure"), this.hunt.toBuffer()]);
    this.vault = pda([Buffer.from("vault"), this.hunt.toBuffer()]);
    this.treasurePermission = permissionPdaFromAccount(this.treasure);
    this.actionEscrow = escrowPdaFromEscrowAuthority(this.hunt);
    this.feeVault = magicFeeVaultPdaFromValidator(TEE_VALIDATOR);
    this.crank = pda(
      [Buffer.from("crank"), this.hunt.toBuffer(), this.hunt.toBuffer()],
      HYDRA_EPHEMERAL_ID,
    );
  }

  static fresh(creator: Keypair): Hunt {
    return new Hunt(creator, new BN(Date.now()));
  }

  logbook(owner: PublicKey): PublicKey {
    return pda([Buffer.from("logbook"), this.hunt.toBuffer(), owner.toBuffer()]);
  }

  private delegation(name: string, account: PublicKey) {
    return {
      [`buffer${name}`]: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(account, PROGRAM_ID),
      [`delegationRecord${name}`]: delegationRecordPdaFromDelegatedAccount(account),
      [`delegationMetadata${name}`]: delegationMetadataPdaFromDelegatedAccount(account),
    };
  }

  private get permissionAccounts() {
    return {
      permissionProgram: PERMISSION_PROGRAM_ID,
      ephemeralVault: EPHEMERAL_VAULT_ID,
      magicProgram: MAGIC_PROGRAM_ID,
    };
  }

  private get tickAccounts() {
    return {
      hunt: this.hunt,
      treasure: this.treasure,
      vault: this.vault,
      magicFeeVault: this.feeVault,
      program: PROGRAM_ID,
      magicProgram: MAGIC_PROGRAM_ID,
      magicContext: MAGIC_CONTEXT_ID,
    };
  }

  // Solana -------------------------------------------------------------------------------------

  async create(options: HuntOptions): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const startsAt = now + (options.startsInSecs ?? 0);
    const ix = await program.methods
      .createHunt(this.id, {
        mode: options.mode === "vrf" ? { vrf: {} } : { author: {} },
        validator: TEE_VALIDATOR,
        entryFee: new BN(options.entryFee ?? 0),
        prizeSeed: new BN(options.prizeSeed ?? 0),
        creatorBps: options.creatorBps ?? 0,
        maxPlayers: options.maxPlayers ?? 8,
        speedKms: options.speedKms ?? 800,
        startsAt: new BN(startsAt),
        deadline: new BN(startsAt + options.durationSecs),
        zoneIntervalSecs: options.zoneIntervalSecs ?? 3600,
        opsLamports: new BN(options.opsLamports ?? 20_000_000),
        title: options.title ?? "Test hunt",
        clue: options.clue ?? "",
      })
      .accountsPartial({
        creator: this.creator.publicKey,
        hunt: this.hunt,
        board: this.board,
        treasure: this.treasure,
        vault: this.vault,
        actionEscrow: this.actionEscrow,
        delegationProgram: DELEGATION_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    return sendBase([ix], [this.creator], { computeUnits: 400_000 });
  }

  async delegate(): Promise<string> {
    const ix = await program.methods
      .delegateHunt(this.id)
      .accountsPartial({
        creator: this.creator.publicKey,
        hunt: this.hunt,
        board: this.board,
        treasure: this.treasure,
        ...this.delegation("Hunt", this.hunt),
        ...this.delegation("Board", this.board),
        ...this.delegation("Treasure", this.treasure),
        ownerProgram: PROGRAM_ID,
        delegationProgram: DELEGATION_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    return sendBase([ix], [this.creator], { computeUnits: 600_000 });
  }

  /**
   * Author mode without a readable seal: delegates hunt, board and treasure and attaches the
   * seal as a post-delegation action whose arguments are encrypted to the validator.
   */
  async delegateSealedIx(location: Vec3, salt: Uint8Array): Promise<TransactionInstruction> {
    const action = await this.sealFromActionIx(location, salt);
    const actions = encryptedActions([action], TEE_VALIDATOR);
    return program.methods
      .delegateHuntSealed(this.id, Buffer.from(actions))
      .accountsPartial({
        creator: this.creator.publicKey,
        hunt: this.hunt,
        board: this.board,
        treasure: this.treasure,
        ...this.delegation("Hunt", this.hunt),
        ...this.delegation("Board", this.board),
        ...this.delegation("Treasure", this.treasure),
        ownerProgram: PROGRAM_ID,
        delegationProgram: DELEGATION_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  async sealFromActionIx(location: Vec3, salt: Uint8Array): Promise<TransactionInstruction> {
    return program.methods
      .sealFromAction(location, Array.from(salt))
      .accountsPartial({
        creator: this.creator.publicKey,
        hunt: this.hunt,
        treasure: this.treasure,
        treasurePermission: this.treasurePermission,
        ...this.permissionAccounts,
      })
      .instruction();
  }

  async join(player: Keypair, operator: PublicKey): Promise<string> {
    const logbook = this.logbook(player.publicKey);
    const ix = await program.methods
      .join(operator)
      .accountsPartial({
        player: player.publicKey,
        hunt: this.hunt,
        vault: this.vault,
        logbook,
        ...this.delegation("Logbook", logbook),
        ownerProgram: PROGRAM_ID,
        delegationProgram: DELEGATION_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    return sendBase([ix], [player], { computeUnits: 300_000 });
  }

  async settleIx(payee: PublicKey): Promise<TransactionInstruction> {
    return program.methods
      .settle()
      .accountsPartial({
        hunt: this.hunt,
        vault: this.vault,
        payee,
        creator: this.creator.publicKey,
        escrowAuth: this.hunt,
        escrow: this.actionEscrow,
      })
      .instruction();
  }

  // Rollup -------------------------------------------------------------------------------------

  async openIx(): Promise<TransactionInstruction> {
    return program.methods
      .openHunt()
      .accountsPartial({
        creator: this.creator.publicKey,
        hunt: this.hunt,
        treasure: this.treasure,
        treasurePermission: this.treasurePermission,
        ...this.permissionAccounts,
        oracleQueue: VRF_EPHEMERAL_QUEUE,
        programIdentity: pda([Buffer.from("identity")]),
        vrfProgram: VRF_PROGRAM_ID,
        slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  async sealFromAuthorIx(location: Vec3, salt: Uint8Array): Promise<TransactionInstruction> {
    return program.methods
      .sealFromAuthor(location, Array.from(salt))
      .accountsPartial({
        creator: this.creator.publicKey,
        hunt: this.hunt,
        treasure: this.treasure,
      })
      .instruction();
  }

  /** `seal_from_vrf` as an impostor would send it, with `identity` in place of the oracle. */
  async sealFromVrfIx(identity: PublicKey, randomness: Uint8Array) {
    return program.methods
      .sealFromVrf(Array.from(randomness))
      .accountsPartial({ vrfProgramIdentity: identity, treasure: this.treasure })
      .instruction();
  }

  async armIx(caller: PublicKey): Promise<TransactionInstruction> {
    return program.methods
      .arm()
      .accountsPartial({
        payer: caller,
        hunt: this.hunt,
        treasure: this.treasure,
        magicFeeVault: this.feeVault,
        magicProgram: MAGIC_PROGRAM_ID,
        magicContext: MAGIC_CONTEXT_ID,
      })
      .instruction();
  }

  async embarkIx(pilot: PublicKey, owner: PublicKey, start: Vec3) {
    const logbook = this.logbook(owner);
    return program.methods
      .embark(start)
      .accountsPartial({
        pilot,
        hunt: this.hunt,
        board: this.board,
        logbook,
        logbookPermission: permissionPdaFromAccount(logbook),
        ...this.permissionAccounts,
      })
      .instruction();
  }

  async setCourseIx(pilot: PublicKey, owner: PublicKey, destination: Vec3) {
    return program.methods
      .setCourse(destination)
      .accountsPartial({
        pilot,
        hunt: this.hunt,
        board: this.board,
        logbook: this.logbook(owner),
      })
      .instruction();
  }

  async probeIx(pilot: PublicKey, owner: PublicKey) {
    return program.methods
      .probe()
      .accountsPartial({
        pilot,
        hunt: this.hunt,
        board: this.board,
        treasure: this.treasure,
        logbook: this.logbook(owner),
      })
      .instruction();
  }

  async tickIx() {
    return program.methods.tick().accountsPartial(this.tickAccounts).instruction();
  }

  async finalizeIx() {
    return program.methods.finalize().accountsPartial(this.tickAccounts).instruction();
  }

  async scheduleTickIx(caller: PublicKey, intervalSlots: number) {
    return program.methods
      .scheduleTick(intervalSlots)
      .accountsPartial({
        payer: caller,
        hunt: this.hunt,
        crank: this.crank,
        ephemeralVault: EPHEMERAL_VAULT_ID,
        magicProgram: MAGIC_PROGRAM_ID,
        hydraProgram: HYDRA_EPHEMERAL_ID,
      })
      .instruction();
  }

  async scheduleTickLegacyIx(caller: PublicKey, taskId: BN, intervalMillis: number) {
    return program.methods
      .scheduleTickLegacy(taskId, new BN(intervalMillis))
      .accountsPartial({ payer: caller, ...this.tickAccounts })
      .instruction();
  }

  async openTreasureIx() {
    return program.methods
      .openTreasure()
      .accountsPartial({
        treasure: this.treasure,
        treasurePermission: this.treasurePermission,
        ...this.permissionAccounts,
      })
      .instruction();
  }

  async openLogbookIx(owner: PublicKey) {
    const logbook = this.logbook(owner);
    return program.methods
      .openLogbook()
      .accountsPartial({
        treasure: this.treasure,
        logbook,
        logbookPermission: permissionPdaFromAccount(logbook),
        ...this.permissionAccounts,
      })
      .instruction();
  }

  async releaseLogbookIx(caller: PublicKey, owner: PublicKey) {
    return program.methods
      .releaseLogbook()
      .accountsPartial({
        payer: caller,
        treasure: this.treasure,
        logbook: this.logbook(owner),
        magicProgram: MAGIC_PROGRAM_ID,
        magicContext: MAGIC_CONTEXT_ID,
      })
      .instruction();
  }

  async releaseBoardIx(caller: PublicKey) {
    return program.methods
      .releaseBoard()
      .accountsPartial({
        payer: caller,
        treasure: this.treasure,
        board: this.board,
        magicProgram: MAGIC_PROGRAM_ID,
        magicContext: MAGIC_CONTEXT_ID,
      })
      .instruction();
  }

  // Solana, after the hunt ---------------------------------------------------------------------

  async closeLogbookIx(owner: PublicKey) {
    return program.methods
      .closeLogbook()
      .accountsPartial({ hunt: this.hunt, logbook: this.logbook(owner), owner })
      .instruction();
  }

  async closeBoardIx() {
    return program.methods
      .closeBoard()
      .accountsPartial({ hunt: this.hunt, board: this.board, creator: this.creator.publicKey })
      .instruction();
  }

  async closeTreasureIx() {
    return program.methods
      .closeTreasure()
      .accountsPartial({
        hunt: this.hunt,
        treasure: this.treasure,
        creator: this.creator.publicKey,
      })
      .instruction();
  }

  // Reads --------------------------------------------------------------------------------------

  private async decode<T>(connection: Connection, name: string, address: PublicKey): Promise<T | null> {
    const info = await connection.getAccountInfo(address);
    if (!info || info.data.length === 0) return null;
    return program.coder.accounts.decode(name, info.data) as T;
  }

  huntState(connection: Connection) {
    return this.decode<any>(connection, "hunt", this.hunt);
  }

  boardState(connection: Connection) {
    return this.decode<any>(connection, "board", this.board);
  }

  treasureState(connection: Connection) {
    return this.decode<any>(connection, "treasure", this.treasure);
  }

  logbookState(connection: Connection, owner: PublicKey) {
    return this.decode<any>(connection, "logbook", this.logbook(owner));
  }

  vaultState() {
    return this.decode<any>(base, "vault", this.vault);
  }
}

export const statusOf = (hunt: any): string => Object.keys(hunt.status)[0];

/** Whether `account` sits on Solana under the delegation program. */
export async function delegatedOnBase(account: PublicKey): Promise<boolean> {
  const info = await base.getAccountInfo(account);
  return info !== null && info.owner.equals(DELEGATION_PROGRAM_ID);
}

/** Whether `account` sits on Solana under this program, that is, not delegated. */
export async function ownedOnBase(account: PublicKey): Promise<boolean> {
  const info = await base.getAccountInfo(account);
  return info !== null && info.owner.equals(PROGRAM_ID);
}

export interface Launch {
  create: string;
  delegate: string;
  open: string;
  seal?: string;
  arm: string;
}

/**
 * Takes a hunt from nothing to live: creates and delegates it on Solana, opens it in the
 * rollup, seals the treasure (by the author when `placement` is given, otherwise by the VRF
 * callback) and arms it. Resolves once the armed state has been committed to Solana.
 */
export async function launch(
  hunt: Hunt,
  options: HuntOptions,
  placement?: { location: Vec3; salt: Uint8Array },
): Promise<Launch> {
  const create = await hunt.create(options);
  evidence(`- create_hunt (base): \`${create}\``);
  await waitFor("the hunt on Solana", () => hunt.huntState(base));

  const delegate = await hunt.delegate();
  evidence(`- delegate_hunt (base): \`${delegate}\``);
  for (const account of [hunt.hunt, hunt.board, hunt.treasure]) {
    await waitFor(
      `delegation of ${account.toBase58()}`,
      async () => (await delegatedOnBase(account)) && (await isDelegated(account)),
    );
  }

  const creator = hunt.creator;
  const open = await sendTee([await hunt.openIx()], [creator], { computeUnits: 400_000 });
  evidence(`- open_hunt (rollup): \`${open}\``);

  let seal: string | undefined;
  if (placement) {
    seal = await sendTee(
      [await hunt.sealFromAuthorIx(placement.location, placement.salt)],
      [creator],
    );
    evidence(`- seal_from_author (rollup): \`${seal}\``);
  }

  const armIx = await hunt.armIx(creator.publicKey);
  const arm = await waitFor(
    "the treasure to be sealed",
    async () => {
      try {
        return await sendTee([armIx], [creator], { computeUnits: 400_000 });
      } catch (error) {
        if (error instanceof TransactionFailed && error.code === "NotSealed") return null;
        throw error;
      }
    },
    120_000,
    500,
  );
  evidence(`- arm (rollup): \`${arm}\``);

  await waitFor(
    "the armed hunt on Solana",
    async () => {
      const state = await hunt.huntState(base);
      return state && statusOf(state) === "live";
    },
    120_000,
    1_000,
  );
  return { create, delegate, open, seal, arm };
}

/** A player: a funded wallet that owns the logbook and a session key that flies the airship. */
export interface Player {
  owner: Keypair;
  operator: Keypair;
}

export async function player(name: string, sol = 0.05): Promise<Player> {
  return { owner: await wallet(name, sol), operator: Keypair.generate() };
}

/** Joins on Solana and waits until the rollup can use the logbook. */
export async function join(hunt: Hunt, who: Player): Promise<string> {
  const signature = await hunt.join(who.owner, who.operator.publicKey);
  const logbook = hunt.logbook(who.owner.publicKey);
  await waitFor(
    "delegation of the logbook",
    async () => (await delegatedOnBase(logbook)) && (await isDelegated(logbook)),
  );
  return signature;
}

/** Sends the airship to `destination` and waits until it has arrived. */
export async function fly(hunt: Hunt, who: Player, destination: Vec3): Promise<string> {
  await waitFor(
    "the airship to finish its current flight",
    async () => {
      const board = await hunt.boardState(teeAnonymous);
      const ship = board.ships.find((s: any) => s.owner.equals(who.owner.publicKey));
      return !ship || Date.now() / 1000 > ship.arriveTs.toNumber() + 1;
    },
    60_000,
    500,
  );
  const signature = await sendTee(
    [await hunt.setCourseIx(who.operator.publicKey, who.owner.publicKey, destination)],
    [who.operator],
  );
  await waitFor(
    "the airship to arrive",
    async () => {
      const board = await hunt.boardState(teeAnonymous);
      const ship = board.ships.find((s: any) => s.owner.equals(who.owner.publicKey));
      return ship && Date.now() / 1000 > ship.arriveTs.toNumber() + 1;
    },
    60_000,
    500,
  );
  return signature;
}

/** Takes a sounding, waiting out the cooldown first. */
export async function sound(hunt: Hunt, who: Player): Promise<string> {
  const ix = await hunt.probeIx(who.operator.publicKey, who.owner.publicKey);
  return waitFor(
    "the sounding gear to cool down",
    async () => {
      try {
        return await sendTee([ix], [who.operator]);
      } catch (error) {
        if (error instanceof TransactionFailed && error.code === "Cooldown") return null;
        throw error;
      }
    },
    30_000,
    500,
  );
}

/** Whether the router sees `account` as delegated to the TEE validator. */
export async function isDelegated(account: PublicKey): Promise<boolean> {
  const response = await rpc(ROUTER_RPC, "getDelegationStatus", [account.toBase58()]);
  return response?.result?.isDelegated === true;
}
