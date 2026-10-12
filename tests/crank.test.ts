import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import {
  HYDRA_EPHEMERAL_ID,
  Hunt,
  base,
  evidence,
  evidenceSection,
  launch,
  ownedOnBase,
  payer,
  sendTee,
  statusOf,
  teeAnonymous,
  waitFor,
  wallet,
} from "./support/harness";
import { fromLatLon } from "./support/geo";

// A hunt nobody touches after it goes live. Only a scheduler calls `tick`: it must shrink the
// zone, close the hunt at the deadline (void, as nobody sounded) and finalize it, which
// returns the hunt to Solana and refunds the creator.

const ZONE_INTERVAL_SECS = 8;
const DURATION_SECS = 135;

async function observeStage(hunt: Hunt, atLeast: number, timeoutMs: number) {
  return waitFor(
    `zone stage ${atLeast}`,
    async () => {
      const state = await hunt.huntState(teeAnonymous);
      return state && state.zoneStage >= atLeast ? state : null;
    },
    timeoutMs,
    1_000,
  ).catch(() => null);
}

describe("a scheduler drives the hunt to its end", () => {
  let path: "hydra" | "legacy" | "none" = "none";
  let hunt: Hunt;
  let caller: Keypair;

  before(async () => {
    caller = await wallet("outsider", 0.02);
  });

  it("schedules tick with the rollup's Hydra scheduler", async () => {
    hunt = Hunt.fresh(payer);
    evidenceSection(`Crank (Hydra), author hunt ${hunt.hunt.toBase58()}`);
    await launch(
      hunt,
      { mode: "author", durationSecs: DURATION_SECS, zoneIntervalSecs: ZONE_INTERVAL_SECS, prizeSeed: 1_000_000 },
      { location: fromLatLon(64.1466, -21.9426), salt: Keypair.generate().publicKey.toBytes() },
    );
    const signature = await sendTee([await hunt.scheduleTickIx(caller.publicKey, 20)], [caller], {
      computeUnits: 400_000,
    });
    evidence(`- schedule_tick, Hydra crank \`${hunt.crank.toBase58()}\` (rollup): \`${signature}\``);
    const crank = await waitFor("the crank account", () =>
      teeAnonymous.getAccountInfo(hunt.crank),
    );
    expect(crank.owner.equals(HYDRA_EPHEMERAL_ID)).to.equal(true);

    const advanced = await observeStage(hunt, 1, (ZONE_INTERVAL_SECS + 15) * 1_000);
    evidence(`- zone stage after ${ZONE_INTERVAL_SECS + 15} s with nobody sending tick: ${advanced ? advanced.zoneStage : "unchanged"}`);
    if (advanced) path = "hydra";
  });

  it("falls back to the validator's task scheduler", async function () {
    if (path !== "none") this.skip();
    hunt = Hunt.fresh(payer);
    evidenceSection(`Crank (legacy ScheduleTask), author hunt ${hunt.hunt.toBase58()}`);
    await launch(
      hunt,
      { mode: "author", durationSecs: DURATION_SECS, zoneIntervalSecs: ZONE_INTERVAL_SECS, prizeSeed: 1_000_000 },
      { location: fromLatLon(64.1466, -21.9426), salt: Keypair.generate().publicKey.toBytes() },
    );
    const taskId = new BN(Date.now() % 1_000_000_000_000);
    const signature = await sendTee(
      [await hunt.scheduleTickLegacyIx(caller.publicKey, taskId, 1_000)],
      [caller],
      { computeUnits: 400_000 },
    );
    evidence(`- schedule_tick_legacy, task ${taskId.toString()} (rollup): \`${signature}\``);
    const advanced = await observeStage(hunt, 1, (ZONE_INTERVAL_SECS + 15) * 1_000);
    evidence(`- zone stage after ${ZONE_INTERVAL_SECS + 15} s with nobody sending tick: ${advanced ? advanced.zoneStage : "unchanged"}`);
    if (advanced) path = "legacy";
  });

  it("shrinks the zone, closes the hunt and finalizes it without any client", async function () {
    evidence(`- live scheduler path: ${path}`);
    expect(path, "neither scheduler executed tick").to.not.equal("none");

    const later = await observeStage(hunt, 2, (2 * ZONE_INTERVAL_SECS + 10) * 1_000);
    expect(later, "the zone kept shrinking").to.not.equal(null);
    evidence(`- zone stage ${later.zoneStage}, centre ${JSON.stringify(later.zoneCenter)}`);

    const creatorBefore = await base.getBalance(payer.publicKey);
    await waitFor(
      "the scheduler to finalize the hunt on Solana",
      async () => (await ownedOnBase(hunt.hunt)) && (await hunt.huntState(base))?.finalized,
      (DURATION_SECS + 120) * 1_000,
      2_000,
    );
    const state = await hunt.huntState(base);
    expect(statusOf(state)).to.equal("void");
    await waitFor("the refund", async () => (await hunt.vaultState())?.settled, 60_000, 1_000);
    const refunded = (await base.getBalance(payer.publicKey)) - creatorBefore;
    expect(refunded).to.equal(1_000_000);
    const signatures = await base.getSignaturesForAddress(hunt.vault, { limit: 1 });
    evidence(`- void hunt finalized by the scheduler and refunded through the settlement action: \`${signatures[0].signature}\``);
  });
});
