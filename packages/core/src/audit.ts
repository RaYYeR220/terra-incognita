import { bytesEqual } from './bytes.js';
import { commitment as computeCommitment } from './derive.js';
import { bandBetween, isUnit } from './geo.js';
import type { Band, LogEntry, Vec3 } from './types.js';

export interface AuditInput {
  /** The hunt account key, 32 bytes. */
  hunt: Uint8Array;
  revealedLocation: Vec3;
  revealedSalt: Uint8Array;
  /** The commitment that was anchored before the hunt went live. */
  commitment: Uint8Array;
  /** Every opened logbook. */
  logbooks: readonly { player: string; entries: readonly LogEntry[] }[];
}

export interface AuditEntry {
  player: string;
  index: number;
  expectedBand: Band;
  recordedBand: Band;
  ok: boolean;
}

export interface AuditReport {
  /** The revealed location and salt hash to the anchored commitment. */
  commitmentOk: boolean;
  entries: AuditEntry[];
  allOk: boolean;
}

/**
 * Replays a finished hunt from public data: checks the reveal against the commitment and
 * recomputes the band of every logbook entry from the revealed location.
 */
export function auditHunt(input: AuditInput): AuditReport {
  const { hunt, revealedLocation, revealedSalt, logbooks } = input;
  const commitmentOk =
    isUnit(revealedLocation) &&
    hunt.length === 32 &&
    revealedSalt.length === 32 &&
    bytesEqual(computeCommitment(hunt, revealedLocation, revealedSalt), input.commitment);

  const entries: AuditEntry[] = [];
  for (const { player, entries: log } of logbooks) {
    log.forEach((entry, index) => {
      const expectedBand = bandBetween(entry.pos, revealedLocation);
      entries.push({
        player,
        index,
        expectedBand,
        recordedBand: entry.band,
        ok: expectedBand === entry.band,
      });
    });
  }

  return { commitmentOk, entries, allOk: commitmentOk && entries.every((e) => e.ok) };
}
