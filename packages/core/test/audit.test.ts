import { describe, expect, it } from 'vitest';

import {
  auditHunt,
  bandBetween,
  commitment,
  hexToBytes,
  locationFromRandomness,
  saltFromRandomness,
} from '../src/index.js';
import type { AuditInput, LogEntry } from '../src/index.js';
import { mulberry32, randomPoint } from './helpers.js';

function fixture(): AuditInput {
  const rand = mulberry32(51);
  const hunt = hexToBytes('0f'.repeat(32));
  const randomness = hexToBytes('c3'.repeat(32));
  const revealedLocation = locationFromRandomness(randomness);
  const revealedSalt = saltFromRandomness(randomness);
  const logbook = (count: number): LogEntry[] =>
    Array.from({ length: count }, (_, i) => {
      const pos = randomPoint(rand);
      return { pos, band: bandBetween(pos, revealedLocation), ts: 1000 + 3 * i };
    });
  return {
    hunt,
    revealedLocation,
    revealedSalt,
    commitment: commitment(hunt, revealedLocation, revealedSalt),
    logbooks: [
      { player: 'alice', entries: logbook(12) },
      { player: 'bob', entries: logbook(0) },
      { player: 'carol', entries: logbook(64) },
    ],
  };
}

describe('auditHunt', () => {
  it('passes an honest hunt', () => {
    const report = auditHunt(fixture());
    expect(report.commitmentOk).toBe(true);
    expect(report.allOk).toBe(true);
    expect(report.entries).toHaveLength(76);
    expect(report.entries.every((e) => e.ok && e.expectedBand === e.recordedBand)).toBe(true);
    expect(report.entries[0]).toMatchObject({ player: 'alice', index: 0 });
    expect(report.entries[12]).toMatchObject({ player: 'carol', index: 0 });
    expect(report.entries[75]).toMatchObject({ player: 'carol', index: 63 });
  });

  it('pinpoints a logbook entry with the wrong band', () => {
    const input = fixture();
    const entries = input.logbooks[2]!.entries.slice();
    const forged = entries[40]!;
    entries[40] = { ...forged, band: forged.band === 7 ? 6 : 7 };
    const report = auditHunt({
      ...input,
      logbooks: [input.logbooks[0]!, input.logbooks[1]!, { player: 'carol', entries }],
    });
    expect(report.commitmentOk).toBe(true);
    expect(report.allOk).toBe(false);
    const bad = report.entries.filter((e) => !e.ok);
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({ player: 'carol', index: 40, expectedBand: forged.band });
  });

  it('fails the commitment for a different location, salt, hunt or commitment', () => {
    const input = fixture();
    const [x, y, z] = input.revealedLocation;
    const moved = auditHunt({ ...input, revealedLocation: [x + 1, y, z] });
    expect(moved.commitmentOk).toBe(false);
    expect(moved.allOk).toBe(false);

    const salt = input.revealedSalt.slice();
    salt[5] = salt[5]! ^ 0x80;
    expect(auditHunt({ ...input, revealedSalt: salt }).commitmentOk).toBe(false);

    const hunt = input.hunt.slice();
    hunt[0] = hunt[0]! ^ 1;
    expect(auditHunt({ ...input, hunt }).commitmentOk).toBe(false);

    const anchored = input.commitment.slice();
    anchored[31] = anchored[31]! ^ 1;
    expect(auditHunt({ ...input, commitment: anchored }).commitmentOk).toBe(false);
  });

  it('fails instead of throwing on malformed reveals', () => {
    const input = fixture();
    expect(auditHunt({ ...input, revealedSalt: new Uint8Array(16) }).commitmentOk).toBe(false);
    expect(auditHunt({ ...input, revealedLocation: [0, 0, 0] }).commitmentOk).toBe(false);
    expect(auditHunt({ ...input, commitment: new Uint8Array(0) }).allOk).toBe(false);
  });

  it('is vacuously fine for a hunt nobody probed', () => {
    const input = fixture();
    const report = auditHunt({ ...input, logbooks: [] });
    expect(report.entries).toEqual([]);
    expect(report.allOk).toBe(true);
  });
});
