import {
  HuntStatus,
  MAX_PROBES,
  PIN_RING_SIZE,
  auditHunt,
  bandBetween,
  canonical,
  commitment,
  fromLatLon,
  inZone,
  isUnit,
  render,
  travelSecs,
} from '@terra-incognita/core';
import type { Vec3 } from '@terra-incognita/core';
import { describe, expect, it } from 'vitest';

import { HuntError, SimHunt } from '../src/index.js';
import { antipode, pointAt, randomnessFor } from './helpers.js';

const T0 = 1_760_000_000;

function newHunt(options: Partial<ConstructorParameters<typeof SimHunt>[0]> = {}): SimHunt {
  return new SimHunt({ randomness: randomnessFor(1), zoneIntervalSecs: 0, durationSecs: 10_000, ...options });
}

function code(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    if (error instanceof HuntError) return error.code;
    throw error;
  }
  return undefined;
}

describe('joining and embarking', () => {
  it('starts live at the configured time with nothing on the board', () => {
    const sim = newHunt();
    const state = sim.publicState();
    expect(sim.now).toBe(T0);
    expect(state.status).toBe(HuntStatus.Live);
    expect(state.zone.stage).toBe(0);
    expect(state.ships).toEqual([]);
    expect(state.pins).toEqual([]);
    expect(state.winner).toBeNull();
    expect(state.speedKms).toBe(800);
    expect(state.deadline).toBe(T0 + 10_000);
  });

  it('lets a player join once and caps the number of players', () => {
    const sim = newHunt({ maxPlayers: 2 });
    sim.join('a');
    expect(code(() => sim.join('a'))).toBe('AlreadyJoined');
    sim.join('b');
    expect(code(() => sim.join('c'))).toBe('HuntFull');
    expect(code(() => sim.client('c'))).toBe('NotJoined');
  });

  it('never allows more than 64 players', () => {
    const sim = newHunt({ maxPlayers: 500 });
    for (let i = 0; i < 64; i += 1) sim.join(`p${i}`);
    expect(code(() => sim.join('late'))).toBe('HuntFull');
  });

  it('registers a parked ship on embark', () => {
    const sim = newHunt();
    sim.join('a');
    const start = fromLatLon(10, 20);
    sim.embark('a', start);
    expect(sim.publicState().ships).toEqual([
      { owner: 'a', from: start, to: start, departTs: T0, arriveTs: T0, probes: 0, lastProbeTs: T0, embarked: true },
    ]);
  });

  it('rejects a second embark, strangers and positions off the sphere', () => {
    const sim = newHunt();
    sim.join('a');
    sim.join('b');
    expect(code(() => sim.embark('nobody', fromLatLon(0, 0)))).toBe('NotJoined');
    expect(code(() => sim.embark('a', [1, 2, 3]))).toBe('InvalidPosition');
    expect(code(() => sim.embark('a', [1_000_000_003, 0, 0]))).toBe('InvalidPosition');
    sim.embark('a', fromLatLon(0, 0));
    expect(code(() => sim.embark('a', fromLatLon(1, 1)))).toBe('AlreadyEmbarked');
    expect(code(() => sim.probe('b'))).toBe('NotEmbarked');
    expect(code(() => sim.setCourse('b', fromLatLon(1, 1)))).toBe('NotEmbarked');
  });
});

describe('flight', () => {
  it('charges the travel time of the program', () => {
    const sim = newHunt();
    sim.join('a');
    const start = fromLatLon(0, 0);
    const dest = fromLatLon(0, 90);
    sim.embark('a', start);
    sim.advance(5);
    sim.setCourse('a', dest);
    const ship = sim.publicState().ships[0]!;
    expect(ship.from).toEqual(start);
    expect(ship.to).toEqual(dest);
    expect(ship.departTs).toBe(T0 + 5);
    expect(ship.arriveTs).toBe(T0 + 5 + travelSecs(start, dest, 800));
    expect(ship.arriveTs - ship.departTs).toBe(12);
  });

  it('takes at least a second even for no distance', () => {
    const sim = newHunt();
    sim.join('a');
    const start = fromLatLon(0, 0);
    sim.embark('a', start);
    sim.setCourse('a', start);
    expect(sim.publicState().ships[0]!.arriveTs).toBe(T0 + 1);
  });

  it('honours the hunt speed', () => {
    const sim = newHunt({ speedKms: 100 });
    sim.join('a');
    sim.embark('a', fromLatLon(0, 0));
    sim.setCourse('a', fromLatLon(0, 180));
    expect(sim.publicState().ships[0]!.arriveTs - T0).toBe(128);
  });

  it('refuses a new course and a probe while in the air', () => {
    const sim = newHunt();
    sim.join('a');
    sim.embark('a', fromLatLon(0, 0));
    sim.setCourse('a', fromLatLon(0, 90));
    expect(code(() => sim.setCourse('a', fromLatLon(0, 10)))).toBe('InFlight');
    expect(code(() => sim.probe('a'))).toBe('InFlight');
    sim.advance(11);
    expect(code(() => sim.probe('a'))).toBe('InFlight');
    sim.advance(1);
    expect(sim.probe('a').pos).toEqual(fromLatLon(0, 90));
    sim.setCourse('a', fromLatLon(0, 10));
    expect(sim.publicState().ships[0]!.from).toEqual(fromLatLon(0, 90));
  });

  it('refuses a destination off the sphere', () => {
    const sim = newHunt();
    sim.join('a');
    sim.embark('a', fromLatLon(0, 0));
    expect(code(() => sim.setCourse('a', [0, 0, 0]))).toBe('InvalidPosition');
  });
});

describe('probing', () => {
  it('records the band in the private logbook and only the position on the board', () => {
    const sim = newHunt();
    const { location } = sim.peek();
    sim.join('a');
    sim.join('b');
    const pos = canonical(pointAt(location, 1, 700));
    sim.embark('a', pos);
    sim.advance(3);
    const entry = sim.probe('a');
    expect(entry).toEqual({ pos, band: bandBetween(pos, location), ts: T0 + 3 });
    expect(entry.band).toBe(3);
    expect(sim.logbook('a')).toEqual([entry]);
    expect(sim.logbook('b')).toEqual([]);

    const state = sim.publicState();
    expect(state.pins).toEqual([{ shipIndex: 0, pos, ts: T0 + 3 }]);
    expect(Object.keys(state.pins[0]!)).not.toContain('band');
    expect(state.ships[0]!.probes).toBe(1);
    expect(state.ships[0]!.lastProbeTs).toBe(T0 + 3);
    expect(state.probesTotal).toBe(1);
  });

  it('enforces the three second cooldown, starting at embark', () => {
    const sim = newHunt();
    sim.join('a');
    sim.embark('a', antipode(sim.peek().location));
    expect(code(() => sim.probe('a'))).toBe('Cooldown');
    sim.advance(2);
    expect(code(() => sim.probe('a'))).toBe('Cooldown');
    sim.advance(1);
    sim.probe('a');
    expect(code(() => sim.probe('a'))).toBe('Cooldown');
    sim.advance(2);
    expect(code(() => sim.probe('a'))).toBe('Cooldown');
    sim.advance(1);
    expect(sim.probe('a').ts).toBe(T0 + 6);
    expect(sim.logbook('a')).toHaveLength(2);
  });

  it('stores positions in canonical form', () => {
    const sim = newHunt();
    sim.join('a');
    const long: Vec3 = [600_000_001, 0, 800_000_001];
    expect(isUnit(long)).toBe(true);
    sim.embark('a', long);
    expect(sim.publicState().ships[0]!.to).toEqual([600_000_000, 0, 800_000_000]);
    sim.setCourse('a', [0, 600_000_001, 800_000_001]);
    expect(sim.publicState().ships[0]!.to).toEqual([0, 600_000_000, 800_000_000]);
    sim.advance(30);
    expect(sim.probe('a').pos).toEqual([0, 600_000_000, 800_000_000]);
  });

  it('stops a ship after 64 probes', () => {
    const sim = newHunt();
    sim.join('a');
    sim.embark('a', antipode(sim.peek().location));
    for (let i = 0; i < MAX_PROBES; i += 1) {
      sim.advance(3);
      sim.probe('a');
    }
    sim.advance(3);
    expect(sim.logbook('a')).toHaveLength(64);
    expect(code(() => sim.probe('a'))).toBe('ProbeLimit');
    expect(sim.publicState().ships[0]!.probes).toBe(64);
    expect(sim.publicState().status).toBe(HuntStatus.Live);
  });

  it('keeps only the last 128 pins', () => {
    const sim = newHunt();
    const far = canonical(antipode(sim.peek().location));
    for (const player of ['a', 'b', 'c']) {
      sim.join(player);
      sim.embark(player, far);
    }
    for (let i = 0; i < 50; i += 1) {
      sim.advance(3);
      for (const player of ['a', 'b', 'c']) sim.probe(player);
    }
    const { pins, probesTotal } = sim.publicState();
    expect(probesTotal).toBe(150);
    expect(pins).toHaveLength(PIN_RING_SIZE);
    // 150 pins were pushed; the first 22 fell off, so the oldest left is b's 8th probe.
    expect(pins[0]).toEqual({ shipIndex: 1, pos: far, ts: T0 + 8 * 3 });
    expect(pins[127]).toEqual({ shipIndex: 2, pos: far, ts: T0 + 50 * 3 });
  });

  it('hands out copies, not its own state', () => {
    const sim = newHunt();
    sim.join('a');
    sim.embark('a', antipode(sim.peek().location));
    sim.advance(3);
    sim.probe('a');
    const state = sim.publicState();
    state.ships[0]!.probes = 99;
    state.pins.length = 0;
    sim.logbook('a')[0]!.band = 0;
    expect(sim.publicState().ships[0]!.probes).toBe(1);
    expect(sim.publicState().pins).toHaveLength(1);
    expect(sim.logbook('a')[0]!.band).toBe(7);
  });
});

describe('strike', () => {
  it('ends the hunt for a probe within 50 km', () => {
    const sim = newHunt();
    const { location } = sim.peek();
    sim.join('a');
    sim.join('b');
    sim.embark('a', pointAt(location, 2, 49.9));
    sim.embark('b', pointAt(location, 4, 30));
    sim.advance(7);
    expect(sim.probe('a').band).toBe(0);
    // Recorded, not yet public: the next tick promotes it.
    expect(sim.peek().strike).toEqual({ player: 'a', ts: T0 + 7 });
    const state = sim.publicState();
    expect(state.status).toBe(HuntStatus.Struck);
    expect(state.winner).toBe('a');
    expect(sim.endTime).toBe(T0 + 7);
    expect(code(() => sim.probe('b'))).toBe('NotLive');
    expect(code(() => sim.setCourse('b', location))).toBe('NotLive');
    sim.join('c');
    expect(code(() => sim.embark('c', location))).toBe('NotLive');
  });

  it('lets the first strike stand when a rival strikes in the same slot', () => {
    const sim = newHunt();
    const { location } = sim.peek();
    sim.join('a');
    sim.join('b');
    sim.embark('a', pointAt(location, 2, 10));
    sim.embark('b', pointAt(location, 4, 10));
    sim.advance(3);
    sim.probe('b');
    expect(sim.peek().strike?.player).toBe('b');
    expect(code(() => sim.probe('a'))).toBe('NotLive');
    expect(sim.publicState().winner).toBe('b');
  });

  it('beats the closest-sounding rule when the strike is ticked only after the deadline', () => {
    const sim = newHunt({ durationSecs: 100 });
    const { location } = sim.peek();
    sim.join('a');
    sim.embark('a', pointAt(location, 2, 10));
    sim.advance(3);
    expect(sim.probe('a').band).toBe(0);
    sim.advance(500);
    expect(sim.publicState().status).toBe(HuntStatus.Struck);
    expect(sim.endTime).toBe(T0 + 3);
  });

  it('does not end for a probe just outside', () => {
    const sim = newHunt();
    const { location } = sim.peek();
    sim.join('a');
    sim.embark('a', pointAt(location, 2, 50.1));
    sim.advance(3);
    expect(sim.probe('a').band).toBe(1);
    expect(sim.publicState().status).toBe(HuntStatus.Live);
    expect(sim.endTime).toBeNull();
  });
});

describe('deadline', () => {
  it('awards the closest sounding when nobody struck', () => {
    const sim = newHunt({ durationSecs: 100 });
    const { location } = sim.peek();
    const players = [['a', 900], ['b', 300], ['c', 5000]] as const;
    for (const [player, km] of players) {
      sim.join(player);
      sim.embark(player, pointAt(location, 1, km));
    }
    sim.advance(3);
    for (const [player] of players) sim.probe(player);
    sim.advance(96);
    expect(sim.publicState().status).toBe(HuntStatus.Live);
    sim.advance(1);
    const state = sim.publicState();
    expect(state.status).toBe(HuntStatus.Closest);
    expect(state.winner).toBe('b');
    expect(sim.endTime).toBe(T0 + 100);
  });

  it('compares soundings by exact distance, not by band', () => {
    const sim = newHunt({ durationSecs: 100 });
    const { location } = sim.peek();
    sim.join('a');
    sim.join('b');
    sim.embark('a', pointAt(location, 0, 390));
    sim.embark('b', pointAt(location, 3, 380));
    sim.advance(3);
    expect(sim.probe('a').band).toBe(2);
    expect(sim.probe('b').band).toBe(2);
    sim.advance(100);
    expect(sim.publicState().winner).toBe('b');
  });

  it('keeps the earlier of two equally close soundings', () => {
    const sim = newHunt({ durationSecs: 100 });
    const pos = pointAt(sim.peek().location, 0, 200);
    sim.join('first');
    sim.join('second');
    sim.embark('first', pos);
    sim.embark('second', pos);
    sim.advance(3);
    sim.probe('first');
    sim.advance(10);
    sim.probe('second');
    sim.advance(100);
    expect(sim.publicState().winner).toBe('first');
  });

  it('is void when nobody probed', () => {
    const sim = newHunt({ durationSecs: 100 });
    sim.join('a');
    sim.embark('a', fromLatLon(0, 0));
    sim.advance(500);
    const state = sim.publicState();
    expect(state.status).toBe(HuntStatus.Void);
    expect(state.winner).toBeNull();
    expect(sim.endTime).toBe(T0 + 100);
  });

  it('rejects a probe at the deadline', () => {
    const sim = newHunt({ durationSecs: 100 });
    sim.join('a');
    sim.embark('a', antipode(sim.peek().location));
    sim.advance(100);
    expect(code(() => sim.probe('a'))).toBe('NotLive');
    expect(sim.publicState().status).toBe(HuntStatus.Void);
  });
});

describe('zone schedule', () => {
  it('shrinks one stage per interval around the treasure', () => {
    const sim = newHunt({ zoneIntervalSecs: 30 });
    const { location } = sim.peek();
    const radii: number[] = [];
    for (let stage = 0; stage <= 8; stage += 1) {
      const { zone } = sim.publicState();
      expect(zone.stage).toBe(stage);
      expect(inZone(location, zone)).toBe(true);
      if (stage > 0) {
        expect(isUnit(zone.center)).toBe(true);
        expect(render.distanceKm(zone.center, location)).toBeLessThan(
          (render.zoneRadiusDeg(stage) * Math.PI * 6371.0088) / 180,
        );
      }
      radii.push(render.zoneRadiusDeg(zone.stage));
      sim.advance(29);
      expect(sim.publicState().zone.stage).toBe(stage);
      sim.advance(1);
    }
    expect(radii).toEqual([180, 90, 60, 40, 25, 15, 9, 5, 3]);
    sim.advance(1000);
    expect(sim.publicState().zone.stage).toBe(8);
  });

  it('skips stages when the clock jumps', () => {
    const sim = newHunt({ zoneIntervalSecs: 30 });
    sim.advance(100);
    expect(sim.publicState().zone.stage).toBe(3);
  });

  it('stays at the whole globe without an interval', () => {
    const sim = newHunt({ zoneIntervalSecs: 0 });
    sim.advance(5000);
    expect(sim.publicState().zone).toEqual({ stage: 0, center: [0, 0, 0] });
  });

  it('freezes when the hunt ends', () => {
    const sim = newHunt({ zoneIntervalSecs: 30, durationSecs: 100 });
    sim.advance(10_000);
    expect(sim.publicState().zone.stage).toBe(3);
  });
});

describe('reveal and audit', () => {
  it('opens only after the end and passes the audit', () => {
    const sim = newHunt({ hunt: new Uint8Array(32).fill(9), durationSecs: 60 });
    const { location, salt } = sim.peek();
    expect(sim.commitment).toEqual(commitment(sim.hunt, location, salt));
    const positions: Vec3[] = [pointAt(location, 0, 9000), pointAt(location, 1, 2000), pointAt(location, 2, 120)];
    sim.join('a');
    sim.join('b');
    sim.embark('a', positions[0]!);
    sim.embark('b', positions[1]!);
    sim.advance(3);
    sim.probe('a');
    sim.probe('b');
    expect(() => sim.reveal()).toThrow(HuntError);
    sim.advance(60);

    const opened = sim.reveal();
    expect(opened.revealedLocation).toEqual(location);
    expect(opened.logbooks.map((l) => l.player)).toEqual(['a', 'b']);
    const report = auditHunt(opened);
    expect(report.allOk).toBe(true);
    expect(report.entries).toHaveLength(2);

    const forged = auditHunt({ ...opened, revealedLocation: positions[2]! });
    expect(forged.commitmentOk).toBe(false);
  });

  it('insists on 32 bytes of randomness', () => {
    expect(() => new SimHunt({ randomness: new Uint8Array(16) })).toThrow(RangeError);
  });
});

describe('clients and the shared clock', () => {
  it('exposes the hunt through the HuntClient interface', async () => {
    const sim = newHunt();
    const client = sim.join('a');
    expect(client.player).toBe('a');
    await client.embark(antipode(sim.peek().location));
    expect(await client.now()).toBe(T0);
    await expect(client.probe()).rejects.toMatchObject({ code: 'Cooldown' });
    await client.sleepUntil(T0 + 3);
    const entry = await client.probe();
    expect(await client.getMyLogbook()).toEqual([entry]);
    await expect(client.probe()).rejects.toMatchObject({ code: 'Cooldown' });
    await client.sleepUntil(T0 + 6);
    expect(await client.now()).toBe(T0 + 6);
    await client.setCourse(fromLatLon(0, 0));
    await expect(client.setCourse(fromLatLon(1, 1))).rejects.toBeInstanceOf(HuntError);
    expect((await client.getPublicState()).ships[0]!.to).toEqual(fromLatLon(0, 0));
  });

  it('never moves the clock backwards', async () => {
    const sim = newHunt();
    sim.advance(50);
    sim.advanceTo(T0 + 10);
    await sim.sleepUntil(T0 + 20);
    expect(sim.now).toBe(T0 + 50);
  });

  it('interleaves several players in timestamp order', async () => {
    const sim = newHunt();
    const order: string[] = [];
    const sleeper = (name: string, wakeUps: number[]) => async (): Promise<string> => {
      for (const at of wakeUps) {
        await sim.sleepUntil(T0 + at);
        order.push(`${name}@${sim.now - T0}`);
      }
      return name;
    };
    const results = await sim.play([sleeper('a', [5, 20, 21]), sleeper('b', [1, 20, 30]), sleeper('c', [])]);
    expect(results).toEqual(['a', 'b', 'c']);
    // b asked for second 20 before a did, so b is woken first.
    expect(order).toEqual(['b@1', 'a@5', 'b@20', 'a@20', 'a@21', 'b@30']);
    expect(sim.now).toBe(T0 + 30);
  });

  it('reports a failing player without hanging the others', async () => {
    const sim = newHunt();
    const done: string[] = [];
    const failing = async (): Promise<void> => {
      await sim.sleepUntil(T0 + 2);
      throw new Error('boom');
    };
    const patient = async (): Promise<void> => {
      await sim.sleepUntil(T0 + 9);
      done.push('patient');
    };
    await expect(sim.play([failing, patient])).rejects.toThrow('boom');
    expect(done).toEqual(['patient']);
    await expect(sim.play([patient])).resolves.toEqual([undefined]);
  });
});
