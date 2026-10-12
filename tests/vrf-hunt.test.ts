import { expect } from "chai";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  Vec3,
  band,
  canonical,
  commitment,
  dot,
  fromLatLon,
  secretsFromEntropy,
  zoneCenter,
  ZONE_COS_E18,
} from "./support/geo";
import {
  Hunt,
  Player,
  TEE_RPC,
  TransactionFailed,
  base,
  evidence,
  evidenceSection,
  fly,
  join,
  launch,
  ownedOnBase,
  payer,
  player,
  rpc,
  sendBase,
  sendTee,
  sleep,
  sound,
  statusOf,
  teeAnonymous,
  teeToken,
  waitFor,
  wallet,
} from "./support/harness";

// A hunt whose treasure nobody chose: the location comes from a VRF callback inside the
// rollup. Nobody strikes, the deadline passes, the closest sounding wins, and afterwards the
// raw VRF output is opened so the location, salt, zone schedule and commitment can all be
// re-derived from it.

const DURATION_SECS = 75;
const ZONE_INTERVAL_SECS = 15;
const ENTRY_FEE = 0.005 * LAMPORTS_PER_SOL;
const PRIZE_SEED = 0.02 * LAMPORTS_PER_SOL;
const CREATOR_BPS = 500;

const vec = (v: any): Vec3 => [v[0], v[1], v[2]];

describe("a hunt sealed by VRF inside the rollup", () => {
  const hunt = Hunt.fresh(payer);
  let north: Player;
  let south: Player;
  let outsider: Keypair;
  const soundings: { owner: string; pos: Vec3; order: number }[] = [];
  const zones = new Map<number, Vec3>();

  before(async () => {
    north = await player("vrf-north");
    south = await player("vrf-south");
    outsider = await wallet("outsider", 0.02);
    evidenceSection(`VRF hunt, closest sounding wins, ${hunt.hunt.toBase58()}`);
  });

  it("goes live once the VRF callback has sealed the treasure", async () => {
    await launch(hunt, {
      mode: "vrf",
      durationSecs: DURATION_SECS,
      zoneIntervalSecs: ZONE_INTERVAL_SECS,
      entryFee: ENTRY_FEE,
      prizeSeed: PRIZE_SEED,
      creatorBps: CREATOR_BPS,
    });
    const onBase = await hunt.huntState(base);
    expect(statusOf(onBase)).to.equal("live");
    evidence(`- commitment on Solana before play: \`${Buffer.from(onBase.commitment).toString("hex")}\``);
  });

  it("keeps the treasure unreadable for everyone, its creator included", async () => {
    const params = [hunt.treasure.toBase58(), { encoding: "base64" }];
    for (const [label, url] of [
      ["no token", TEE_RPC],
      ["outsider token", `${TEE_RPC}?token=${await teeToken(outsider)}`],
      ["creator token", `${TEE_RPC}?token=${await teeToken(payer)}`],
    ] as const) {
      const response = await rpc(url, "getAccountInfo", params);
      evidence(`- getAccountInfo(treasure), ${label}: \`${JSON.stringify(response.result?.value ?? response.error ?? null)}\``);
      expect(response.result?.value ?? null).to.equal(null);
    }
    const onBase = await hunt.treasureState(base);
    expect(onBase.sealed).to.equal(false);
    expect(vec(onBase.location)).to.deep.equal([0, 0, 0]);
    expect(Buffer.from(onBase.entropy).equals(Buffer.alloc(32))).to.equal(true);
    evidence("- the copy of the treasure on Solana still holds its unsealed creation state");
  });

  it("plays: two airships take soundings while the zone shrinks", async () => {
    await join(hunt, north);
    await join(hunt, south);
    let order = 0;
    for (const [who, start, stops] of [
      [north, fromLatLon(60, 10), [fromLatLon(45, 60), fromLatLon(20, 100)]],
      [south, fromLatLon(-30, -60), [fromLatLon(-10, -20), fromLatLon(-40, 30)]],
    ] as const) {
      await sendTee([await hunt.embarkIx(who.operator.publicKey, who.owner.publicKey, start)], [who.operator], {
        computeUnits: 300_000,
      });
      for (const stop of stops) {
        await fly(hunt, who, stop);
        await sound(hunt, who);
        soundings.push({ owner: who.owner.publicKey.toBase58(), pos: canonical(stop), order: order++ });
      }
    }
    evidence(`- ${soundings.length} soundings taken by two airships`);
  });

  it("closes at the deadline with the closest sounding as the winner", async () => {
    const state = await hunt.huntState(teeAnonymous);
    const deadline = state.deadline.toNumber();
    // Tick only before the deadline here: each call takes one step, and the step after the
    // close would already finalize.
    while (Date.now() / 1000 < deadline - 3) {
      await sendTee([await hunt.tickIx()], [outsider], { computeUnits: 400_000 });
      const now = await hunt.huntState(teeAnonymous);
      if (now.zoneStage > 0 && !zones.has(now.zoneStage)) {
        zones.set(now.zoneStage, vec(now.zoneCenter));
        evidence(`- zone stage ${now.zoneStage}: centre ${JSON.stringify(vec(now.zoneCenter))}`);
      }
      await sleep(4_000);
    }
    await sleep(Math.max(0, (deadline + 2) * 1000 - Date.now()));
    if (statusOf(await hunt.huntState(teeAnonymous)) === "live") {
      const signature = await sendTee([await hunt.tickIx()], [outsider], { computeUnits: 400_000 });
      evidence(`- tick after the deadline (rollup): \`${signature}\``);
    }
    const ended = await hunt.huntState(teeAnonymous);
    expect(statusOf(ended)).to.equal("closest");
    expect(zones.size).to.be.greaterThan(0);
  });

  it("finalizes and pays the winner through the scheduled action", async () => {
    const winner = (await hunt.huntState(teeAnonymous)).winner;
    const before = await base.getBalance(winner);
    try {
      evidence(`- finalize (rollup): \`${await sendTee([await hunt.finalizeIx()], [outsider], { computeUnits: 400_000 })}\``);
    } catch (error) {
      // The rollup clock can run ahead of this machine's, so a tick sent just before the
      // deadline by local time may already have closed the hunt and the next one finalized it.
      if (!(error instanceof TransactionFailed && error.code === "AlreadyFinalized")) throw error;
      evidence("- finalize: already done by the tick that followed the close");
    }
    await waitFor(
      "the hunt back on Solana",
      async () => (await ownedOnBase(hunt.hunt)) && (await hunt.huntState(base))?.finalized,
      180_000,
      1_000,
    );
    await waitFor("the payout", async () => (await hunt.vaultState())?.settled, 60_000, 1_000);
    const pot = PRIZE_SEED + 2 * ENTRY_FEE;
    const prize = pot - (2 * ENTRY_FEE * CREATOR_BPS) / 10_000;
    expect((await base.getBalance(winner)) - before).to.equal(prize);
    const [payout] = await base.getSignaturesForAddress(hunt.vault, { limit: 1 });
    evidence(`- winner \`${winner.toBase58()}\` paid ${prize} lamports on Solana: \`${payout.signature}\``);
  });

  it("re-derives location, salt, zone schedule and commitment from the opened VRF output", async () => {
    evidence(`- open_treasure (rollup): \`${await sendTee([await hunt.openTreasureIx()], [outsider])}\``);
    for (const who of [north, south]) {
      await sendTee([await hunt.openLogbookIx(who.owner.publicKey)], [outsider]);
    }
    const treasure = await waitFor("the opened treasure", () => hunt.treasureState(teeAnonymous));
    const state = await hunt.huntState(base);
    const entropy = Buffer.from(treasure.entropy);
    expect(entropy.equals(Buffer.alloc(32))).to.equal(false);
    const derived = secretsFromEntropy(entropy);

    expect(vec(treasure.location)).to.deep.equal(derived.location);
    expect(Buffer.from(treasure.salt)).to.deep.equal(derived.salt);
    expect(Buffer.from(treasure.zoneSeed)).to.deep.equal(derived.zoneSeed);
    expect(vec(state.revealedLocation)).to.deep.equal(derived.location);
    expect(Buffer.from(state.commitment)).to.deep.equal(
      commitment(hunt.hunt, derived.location, derived.salt),
    );
    for (const [stage, center] of zones) {
      expect(center).to.deep.equal(zoneCenter(derived.location, derived.zoneSeed, stage));
      expect(dot(derived.location, center) >= ZONE_COS_E18[stage - 1]).to.equal(true);
    }
    evidence(`- VRF output \`${entropy.toString("hex")}\` re-derives the location, salt, zone seed, commitment and ${zones.size} zone centres`);

    let best = soundings[0];
    for (const s of soundings) {
      if (dot(s.pos, derived.location) > dot(best.pos, derived.location)) best = s;
    }
    expect(state.winner.toBase58()).to.equal(best.owner);
    for (const who of [north, south]) {
      const log = await hunt.logbookState(teeAnonymous, who.owner.publicKey);
      for (const entry of log.entries) {
        expect(entry.band).to.equal(band(vec(entry.pos), derived.location));
      }
    }
    evidence("- winner is the sounding with the greatest dot product; every hint matches the revealed location");
  });

  it("returns the rent", async () => {
    for (const who of [north, south]) {
      await sendTee([await hunt.releaseLogbookIx(outsider.publicKey, who.owner.publicKey)], [outsider], {
        computeUnits: 300_000,
        allowUnconfirmed: true,
      });
    }
    await sendTee([await hunt.releaseBoardIx(outsider.publicKey)], [outsider], { computeUnits: 300_000, allowUnconfirmed: true });
    const accounts = [hunt.board, hunt.treasure, ...[north, south].map((w) => hunt.logbook(w.owner.publicKey))];
    for (const account of accounts) {
      await waitFor(`${account.toBase58()} back on Solana`, () => ownedOnBase(account), 180_000, 1_000);
    }
    const signature = await sendBase(
      [
        ...(await Promise.all([north, south].map((w) => hunt.closeLogbookIx(w.owner.publicKey)))),
        await hunt.closeBoardIx(),
        await hunt.closeTreasureIx(),
      ],
      [outsider],
    );
    evidence(`- released and closed board, treasure and logbooks (base): \`${signature}\``);
  });
});
