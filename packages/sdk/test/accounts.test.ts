import { BN } from '@coral-xyz/anchor';
import { Keypair, PublicKey } from '@solana/web3.js';
import { HuntMode, HuntStatus, fromLatLon } from '@terra-incognita/core';
import { describe, expect, it } from 'vitest';

import {
  BOARD_ACCOUNT_SIZE,
  accountKind,
  decodeBoard,
  decodeHunt,
  decodeLogbook,
  decodeTreasure,
  decodeVault,
  payoutSplit,
} from '../src/index.js';

import { anchorProgram } from './anchor.js';

const coder = anchorProgram().coder.accounts;
const key = () => Keypair.generate().publicKey;
const at = PublicKey.default;

const huntValue = (overrides: Record<string, unknown> = {}) => ({
  creator: key(),
  id: new BN('1791796133256'),
  mode: { author: {} },
  validator: key(),
  entryFee: new BN(10_000_000),
  prizeSeed: new BN(50_000_000),
  creatorBps: 1_000,
  maxPlayers: 8,
  speedKms: 800,
  startsAt: new BN(1_791_000_000),
  deadline: new BN(1_791_001_200),
  zoneIntervalSecs: 60,
  status: { struck: {} },
  finalized: true,
  commitment: Array.from({ length: 32 }, (_, i) => i),
  zoneStage: 3,
  zoneCenter: fromLatLon(10, 20),
  players: 2,
  probesTotal: 7,
  winner: key(),
  revealedLocation: fromLatLon(-13.1631, -72.545),
  revealedSalt: Array.from({ length: 32 }, (_, i) => 255 - i),
  endedAt: new BN(1_791_000_500),
  bump: 254,
  boardBump: 253,
  treasureBump: 252,
  vaultBump: 251,
  title: 'Lost city',
  clue: 'Where the condor nests above the sacred valley',
  ...overrides,
});

async function encode(name: string, value: object): Promise<Uint8Array> {
  return Uint8Array.from(await coder.encode(name.charAt(0).toLowerCase() + name.slice(1), value));
}

describe('hunt', () => {
  it('decodes every field the program writes', async () => {
    const value = huntValue();
    const hunt = decodeHunt(at, await encode('Hunt', value));
    expect(hunt.creator.equals(value.creator)).toBe(true);
    expect(hunt.id).toBe(1_791_796_133_256n);
    expect(hunt.mode).toBe(HuntMode.Author);
    expect(hunt.validator.equals(value.validator)).toBe(true);
    expect(hunt.entryFee).toBe(10_000_000);
    expect(hunt.prizeSeed).toBe(50_000_000);
    expect(hunt.creatorBps).toBe(1_000);
    expect(hunt.maxPlayers).toBe(8);
    expect(hunt.speedKms).toBe(800);
    expect(hunt.startsAt).toBe(1_791_000_000);
    expect(hunt.deadline).toBe(1_791_001_200);
    expect(hunt.zoneIntervalSecs).toBe(60);
    expect(hunt.status).toBe(HuntStatus.Struck);
    expect(hunt.finalized).toBe(true);
    expect(Array.from(hunt.commitment)).toEqual(value.commitment);
    expect(hunt.zone).toEqual({ stage: 3, center: value.zoneCenter });
    expect(hunt.players).toBe(2);
    expect(hunt.probesTotal).toBe(7);
    expect(hunt.winner?.equals(value.winner)).toBe(true);
    expect(hunt.revealedLocation).toEqual(value.revealedLocation);
    expect(Array.from(hunt.revealedSalt)).toEqual(value.revealedSalt);
    expect(hunt.endedAt).toBe(1_791_000_500);
    expect(hunt.bumps).toEqual({ hunt: 254, board: 253, treasure: 252, vault: 251 });
    expect(hunt.title).toBe('Lost city');
    expect(hunt.clue).toBe(value.clue);
  });

  it('maps every status and the empty winner and reveal', async () => {
    const statuses = ['created', 'sealing', 'live', 'struck', 'closest', 'void'];
    for (const [index, status] of statuses.entries()) {
      const data = await encode(
        'Hunt',
        huntValue({ status: { [status]: {} }, winner: PublicKey.default, revealedLocation: [0, 0, 0], mode: { vrf: {} } }),
      );
      const hunt = decodeHunt(at, data);
      expect(hunt.status).toBe(index);
      expect(hunt.winner).toBeNull();
      expect(hunt.revealedLocation).toBeNull();
      expect(hunt.mode).toBe(HuntMode.Vrf);
    }
  });

  it('decodes a hunt padded to its full account size', async () => {
    const data = await encode('Hunt', huntValue({ title: 'x', clue: '' }));
    const padded = new Uint8Array(520);
    padded.set(data);
    expect(decodeHunt(at, padded).title).toBe('x');
  });

  it('refuses data of another account type', async () => {
    const vault = await encode('Vault', { hunt: key(), prizeSeed: new BN(1), entryTotal: new BN(2), entrants: 1, settled: false, bump: 1 });
    expect(() => decodeHunt(at, vault)).toThrow(/not a Hunt account/);
    expect(accountKind(vault)).toBe('Vault');
    expect(accountKind(new Uint8Array(8))).toBeNull();
  });
});

describe('board', () => {
  // Writes the zero-copy board byte by byte, so that Anchor's decoder can serve as the reference.
  function board(shipCount: number, pinCount: number) {
    const data = new Uint8Array(BOARD_ACCOUNT_SIZE);
    const view = new DataView(data.buffer);
    data.set([79, 48, 160, 63, 153, 132, 240, 56], 0);
    data.set(key().toBytes(), 8);
    view.setUint32(40, pinCount, true);
    view.setUint8(44, shipCount);
    const owners = Array.from({ length: shipCount }, key);
    owners.forEach((owner, i) => {
      const at = 48 + i * 88;
      data.set(owner.toBytes(), at);
      view.setBigInt64(at + 32, BigInt(1_000 + i), true);
      view.setBigInt64(at + 40, BigInt(2_000 + i), true);
      view.setBigInt64(at + 48, BigInt(3_000 + i), true);
      fromLatLon(i, i).forEach((c, k) => view.setInt32(at + 56 + 4 * k, c, true));
      fromLatLon(-i, 2 * i).forEach((c, k) => view.setInt32(at + 68 + 4 * k, c, true));
      view.setUint8(at + 80, i);
      view.setUint8(at + 81, 1);
    });
    for (let n = Math.max(0, pinCount - 128); n < pinCount; n += 1) {
      const at = 48 + 64 * 88 + (n % 128) * 24;
      view.setBigInt64(at, BigInt(5_000 + n), true);
      fromLatLon(n % 80, n).forEach((c, k) => view.setInt32(at + 8 + 4 * k, c, true));
      view.setUint8(at + 20, n % 3);
    }
    return { owners, data };
  }

  it('reads the zero-copy layout the way Anchor does', () => {
    const { data } = board(5, 200);
    const mine = decodeBoard(at, data);
    const reference = coder.decode('board', Buffer.from(data));
    expect(mine.hunt.equals(reference.hunt)).toBe(true);
    expect(mine.pinCount).toBe(reference.pinCount);
    expect(mine.ships).toHaveLength(reference.shipCount);
    mine.ships.forEach((ship, i) => {
      const expected = reference.ships[i];
      expect(ship.owner).toBe(expected.owner.toBase58());
      expect(ship.departTs).toBe(expected.departTs.toNumber());
      expect(ship.arriveTs).toBe(expected.arriveTs.toNumber());
      expect(ship.lastProbeTs).toBe(expected.lastProbeTs.toNumber());
      expect(ship.from).toEqual(expected.from);
      expect(ship.to).toEqual(expected.to);
      expect(ship.probes).toBe(expected.probes);
      expect(ship.embarked).toBe(expected.embarked === 1);
    });
    for (const pin of mine.pins) {
      const expected = reference.pins[(pin.ts - 5_000) % 128];
      expect(pin).toEqual({ ts: expected.ts.toNumber(), pos: expected.pos, shipIndex: expected.shipIndex });
    }
  });

  it('decodes the ships in board order', () => {
    const { owners, data } = board(3, 0);
    const decoded = decodeBoard(at, data);
    expect(decoded.ships).toHaveLength(3);
    decoded.ships.forEach((s, i) => {
      expect(s).toEqual({
        owner: (owners[i] as PublicKey).toBase58(),
        departTs: 1_000 + i,
        arriveTs: 2_000 + i,
        lastProbeTs: 3_000 + i,
        from: fromLatLon(i, i),
        to: fromLatLon(-i, 2 * i),
        probes: i,
        embarked: true,
      });
    });
  });

  it('returns the pins oldest first, before and after the ring wraps', () => {
    const few = decodeBoard(at, board(1, 5).data);
    expect(few.pinCount).toBe(5);
    expect(few.pins.map((p) => p.ts)).toEqual([5_000, 5_001, 5_002, 5_003, 5_004]);
    expect(few.pins[2]).toEqual({ ts: 5_002, pos: fromLatLon(2, 2), shipIndex: 2 });

    const wrapped = decodeBoard(at, board(1, 300).data);
    expect(wrapped.pinCount).toBe(300);
    expect(wrapped.pins).toHaveLength(128);
    expect(wrapped.pins[0]?.ts).toBe(5_000 + 172);
    expect(wrapped.pins[127]?.ts).toBe(5_000 + 299);
    const ts = wrapped.pins.map((p) => p.ts);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });

  it('refuses a truncated board', () => {
    expect(() => decodeBoard(at, board(0, 0).data.slice(0, 4000))).toThrow(RangeError);
  });
});

describe('logbook, vault and treasure', () => {
  it('decodes a logbook with its entries', async () => {
    const owner = key();
    const operator = key();
    const entries = [
      { pos: fromLatLon(1, 2), band: 6, ts: new BN(100) },
      { pos: fromLatLon(3, 4), band: 0, ts: new BN(104) },
    ];
    const data = await encode('Logbook', { hunt: key(), owner, operator, shipIndex: 5, embarked: true, bump: 9, entries });
    const logbook = decodeLogbook(at, data);
    expect(logbook.owner.equals(owner)).toBe(true);
    expect(logbook.operator.equals(operator)).toBe(true);
    expect(logbook.shipIndex).toBe(5);
    expect(logbook.embarked).toBe(true);
    expect(logbook.entries).toEqual([
      { pos: fromLatLon(1, 2), band: 6, ts: 100 },
      { pos: fromLatLon(3, 4), band: 0, ts: 104 },
    ]);
  });

  it('decodes a vault and adds up the pot', async () => {
    const data = await encode('Vault', {
      hunt: key(),
      prizeSeed: new BN(50_000_000),
      entryTotal: new BN(20_000_000),
      entrants: 2,
      settled: true,
      bump: 255,
    });
    const vault = decodeVault(at, data);
    expect(vault).toMatchObject({ prizeSeed: 50_000_000, entryTotal: 20_000_000, entrants: 2, settled: true, pot: 70_000_000 });
  });

  it('decodes an opened treasure', async () => {
    const strikePlayer = key();
    const data = await encode('Treasure', {
      hunt: key(),
      sealed: true,
      revealed: true,
      entropy: Array(32).fill(7),
      location: fromLatLon(41.9, 12.5),
      salt: Array(32).fill(8),
      zoneSeed: Array(32).fill(9),
      vrfRequestedAt: new BN(1_000),
      bestDot: new BN('999990000000000000'),
      bestPlayer: strikePlayer,
      bestTs: new BN(1_100),
      strikePlayer,
      strikeSlot: new BN('504155155'),
      strikeTs: new BN(1_100),
      bump: 250,
    });
    const treasure = decodeTreasure(at, data);
    expect(treasure.location).toEqual(fromLatLon(41.9, 12.5));
    expect(treasure.bestDot).toBe(999_990_000_000_000_000n);
    expect(treasure.strikePlayer?.equals(strikePlayer)).toBe(true);
    expect(treasure.strikeSlot).toBe(504_155_155n);
    expect(treasure.revealed).toBe(true);
  });

  it('splits the pot the way settle does', () => {
    const vault = { pot: 70_000_000, entryTotal: 20_000_000 };
    expect(payoutSplit({ status: HuntStatus.Struck, creatorBps: 1_000 }, vault)).toEqual({ prize: 68_000_000, creator: 2_000_000 });
    expect(payoutSplit({ status: HuntStatus.Void, creatorBps: 1_000 }, vault)).toEqual({ prize: 0, creator: 70_000_000 });
  });
});
