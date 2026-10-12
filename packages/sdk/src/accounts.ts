import { PublicKey } from '@solana/web3.js';
import { HuntMode, HuntStatus } from '@terra-incognita/core';
import type { Band, LogEntry, Pin, Ship, Vec3, Zone } from '@terra-incognita/core';

import { Reader, bytesEqual } from './codec.js';
import { LIMITS } from './constants.js';
import { PROGRAM_INTERFACE } from './program-interface.js';

export type AccountName = keyof typeof PROGRAM_INTERFACE.accounts;

export function accountDiscriminator(name: AccountName): Uint8Array {
  return Uint8Array.from(PROGRAM_INTERFACE.accounts[name]);
}

/** Which program account `data` holds, judged by its discriminator. */
export function accountKind(data: Uint8Array): AccountName | null {
  const head = data.subarray(0, 8);
  for (const name of Object.keys(PROGRAM_INTERFACE.accounts) as AccountName[]) {
    if (bytesEqual(head, accountDiscriminator(name))) return name;
  }
  return null;
}

function open(name: AccountName, data: Uint8Array): Reader {
  if (data.length < 8 || !bytesEqual(data.subarray(0, 8), accountDiscriminator(name))) {
    throw new TypeError(`not a ${name} account`);
  }
  return new Reader(data, 8);
}

const isZeroKey = (key: PublicKey): boolean => key.toBytes().every((byte) => byte === 0);
const isZeroVec = (v: Vec3): boolean => v[0] === 0 && v[1] === 0 && v[2] === 0;

const STATUSES = [
  HuntStatus.Created,
  HuntStatus.Sealing,
  HuntStatus.Live,
  HuntStatus.Struck,
  HuntStatus.Closest,
  HuntStatus.Void,
] as const;

function status(index: number): HuntStatus {
  const value = STATUSES[index];
  if (value === undefined) throw new RangeError(`unknown hunt status ${index}`);
  return value;
}

function mode(index: number): HuntMode {
  if (index === 0) return HuntMode.Vrf;
  if (index === 1) return HuntMode.Author;
  throw new RangeError(`unknown hunt mode ${index}`);
}

export interface HuntAccount {
  address: PublicKey;
  creator: PublicKey;
  id: bigint;
  mode: HuntMode;
  validator: PublicKey;
  /** Lamports. */
  entryFee: number;
  /** Lamports the creator put into the vault. */
  prizeSeed: number;
  creatorBps: number;
  maxPlayers: number;
  speedKms: number;
  startsAt: number;
  deadline: number;
  zoneIntervalSecs: number;
  status: HuntStatus;
  /** The location has been revealed and the hunt has been released to Solana. */
  finalized: boolean;
  /** sha256 commitment to the location, all zero until the hunt is armed. */
  commitment: Uint8Array;
  zone: Zone;
  players: number;
  probesTotal: number;
  winner: PublicKey | null;
  revealedLocation: Vec3 | null;
  revealedSalt: Uint8Array;
  endedAt: number;
  bumps: { hunt: number; board: number; treasure: number; vault: number };
  title: string;
  clue: string;
}

export function decodeHunt(address: PublicKey, data: Uint8Array): HuntAccount {
  const r = open('Hunt', data);
  const creator = r.pubkey();
  const id = r.u64();
  const huntMode = mode(r.u8());
  const validator = r.pubkey();
  const entryFee = r.u64n();
  const prizeSeed = r.u64n();
  const creatorBps = r.u16();
  const maxPlayers = r.u8();
  const speedKms = r.u32();
  const startsAt = r.i64n();
  const deadline = r.i64n();
  const zoneIntervalSecs = r.u32();
  const huntStatus = status(r.u8());
  const finalized = r.bool();
  const commitment = r.bytes(32);
  const zone: Zone = { stage: r.u8(), center: r.vec3() };
  const players = r.u8();
  const probesTotal = r.u32();
  const winner = r.pubkey();
  const revealedLocation = r.vec3();
  const revealedSalt = r.bytes(32);
  const endedAt = r.i64n();
  const bumps = { hunt: r.u8(), board: r.u8(), treasure: r.u8(), vault: r.u8() };
  const title = r.string();
  const clue = r.string();
  return {
    address,
    creator,
    id,
    mode: huntMode,
    validator,
    entryFee,
    prizeSeed,
    creatorBps,
    maxPlayers,
    speedKms,
    startsAt,
    deadline,
    zoneIntervalSecs,
    status: huntStatus,
    finalized,
    commitment,
    zone,
    players,
    probesTotal,
    winner: isZeroKey(winner) ? null : winner,
    revealedLocation: isZeroVec(revealedLocation) ? null : revealedLocation,
    revealedSalt,
    endedAt,
    bumps,
    title,
    clue,
  };
}

export interface BoardAccount {
  address: PublicKey;
  hunt: PublicKey;
  /** Pins ever pushed, including those the ring has overwritten. */
  pinCount: number;
  /** Ships by board index. */
  ships: Ship[];
  /** The pins still in the ring, oldest first. */
  pins: Pin[];
}

const SHIP_SIZE = 88;
const PIN_SIZE = 24;
const SHIPS_OFFSET = 48;
const PINS_OFFSET = SHIPS_OFFSET + LIMITS.maxPlayers * SHIP_SIZE;
export const BOARD_ACCOUNT_SIZE = PINS_OFFSET + LIMITS.pinRing * PIN_SIZE;

/** Decodes the zero-copy board. Its layout is the program's `repr(C)` structs. */
export function decodeBoard(address: PublicKey, data: Uint8Array): BoardAccount {
  const r = open('Board', data);
  if (data.length < BOARD_ACCOUNT_SIZE) throw new RangeError(`board is ${data.length} bytes`);
  const hunt = r.pubkey();
  const pinCount = r.u32();
  const shipCount = Math.min(r.u8(), LIMITS.maxPlayers);

  const ships: Ship[] = [];
  for (let i = 0; i < shipCount; i += 1) {
    const s = new Reader(data, SHIPS_OFFSET + i * SHIP_SIZE);
    const owner = s.pubkey();
    const departTs = s.i64n();
    const arriveTs = s.i64n();
    const lastProbeTs = s.i64n();
    const from = s.vec3();
    const to = s.vec3();
    const probes = s.u8();
    const embarked = s.u8() === 1;
    ships.push({ owner: owner.toBase58(), from, to, departTs, arriveTs, probes, lastProbeTs, embarked });
  }

  const pins: Pin[] = [];
  const kept = Math.min(pinCount, LIMITS.pinRing);
  const first = pinCount - kept;
  for (let n = first; n < pinCount; n += 1) {
    const p = new Reader(data, PINS_OFFSET + (n % LIMITS.pinRing) * PIN_SIZE);
    const ts = p.i64n();
    const pos = p.vec3();
    const shipIndex = p.u8();
    pins.push({ shipIndex, pos, ts });
  }
  return { address, hunt, pinCount, ships, pins };
}

export interface LogbookAccount {
  address: PublicKey;
  hunt: PublicKey;
  owner: PublicKey;
  /** Session key that may fly the airship for the owner. */
  operator: PublicKey;
  shipIndex: number;
  embarked: boolean;
  entries: LogEntry[];
}

export function decodeLogbook(address: PublicKey, data: Uint8Array): LogbookAccount {
  const r = open('Logbook', data);
  const hunt = r.pubkey();
  const owner = r.pubkey();
  const operator = r.pubkey();
  const shipIndex = r.u8();
  const embarked = r.bool();
  r.u8();
  const count = r.u32();
  const entries: LogEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    const pos = r.vec3();
    const band = r.u8() as Band;
    const ts = r.i64n();
    entries.push({ pos, band, ts });
  }
  return { address, hunt, owner, operator, shipIndex, embarked, entries };
}

export interface VaultAccount {
  address: PublicKey;
  hunt: PublicKey;
  prizeSeed: number;
  entryTotal: number;
  entrants: number;
  settled: boolean;
  /** Prize plus entry fees, in lamports. */
  pot: number;
}

export function decodeVault(address: PublicKey, data: Uint8Array): VaultAccount {
  const r = open('Vault', data);
  const hunt = r.pubkey();
  const prizeSeed = r.u64n();
  const entryTotal = r.u64n();
  const entrants = r.u8();
  const settled = r.bool();
  return { address, hunt, prizeSeed, entryTotal, entrants, settled, pot: prizeSeed + entryTotal };
}

export interface TreasureAccount {
  address: PublicKey;
  hunt: PublicKey;
  sealed: boolean;
  revealed: boolean;
  entropy: Uint8Array;
  location: Vec3;
  salt: Uint8Array;
  zoneSeed: Uint8Array;
  vrfRequestedAt: number;
  /** Dot product of the closest sounding with the location, scale 1e18. */
  bestDot: bigint;
  bestPlayer: PublicKey | null;
  bestTs: number;
  strikePlayer: PublicKey | null;
  /** Rollup slot of the first strike, 0 when nobody struck. */
  strikeSlot: bigint;
  strikeTs: number;
}

/** The treasure is private while the hunt runs; this decodes it once it has been opened. */
export function decodeTreasure(address: PublicKey, data: Uint8Array): TreasureAccount {
  const r = open('Treasure', data);
  const hunt = r.pubkey();
  const sealed = r.bool();
  const revealed = r.bool();
  const entropy = r.bytes(32);
  const location = r.vec3();
  const salt = r.bytes(32);
  const zoneSeed = r.bytes(32);
  const vrfRequestedAt = r.i64n();
  const bestDot = r.i64();
  const bestPlayer = r.pubkey();
  const bestTs = r.i64n();
  const strikePlayer = r.pubkey();
  const strikeSlot = r.u64();
  const strikeTs = r.i64n();
  return {
    address,
    hunt,
    sealed,
    revealed,
    entropy,
    location,
    salt,
    zoneSeed,
    vrfRequestedAt,
    bestDot,
    bestPlayer: isZeroKey(bestPlayer) ? null : bestPlayer,
    bestTs,
    strikePlayer: isZeroKey(strikePlayer) ? null : strikePlayer,
    strikeSlot,
    strikeTs,
  };
}

/** Lamports of `pot` that go to the creator and to the payee when the vault settles. */
export function payoutSplit(hunt: Pick<HuntAccount, 'status' | 'creatorBps'>, vault: Pick<VaultAccount, 'pot' | 'entryTotal'>) {
  if (hunt.status === HuntStatus.Void) return { prize: 0, creator: vault.pot };
  const creator = Number((BigInt(vault.entryTotal) * BigInt(hunt.creatorBps)) / 10_000n);
  return { prize: vault.pot - creator, creator };
}
