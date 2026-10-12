import { expect } from "chai";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { Vec3, band, canonical, fromLatLon } from "./support/geo";
import {
  Hunt,
  Player,
  TEE_RPC,
  evidence,
  evidenceSection,
  fly,
  join,
  launch,
  payer,
  player,
  rpc,
  sendTee,
  sleep,
  statusOf,
  tee,
  teeAnonymous,
  teeToken,
  wallet,
} from "./support/harness";

// The rollup returns the error of a simulated transaction to any caller, even when the
// transaction touches private accounts, and simulations cost nothing and leave no trace.
// A sounding at the treasure must therefore be indistinguishable from one far away in every
// combination a single transaction allows, including how much compute it needs.

const TREASURE: Vec3 = fromLatLon(41.9028, 12.4964);
const FAR: Vec3 = fromLatLon(-33.8688, 151.2093);
const FAR_TOO: Vec3 = fromLatLon(-37.8136, 144.9631);

interface Outcome {
  err: unknown;
  logs: number;
  post: unknown;
}

async function simulate(
  feePayer: Keypair,
  instructions: TransactionInstruction[],
  computeUnits = 1_000_000,
  postStateOf: PublicKey[] = [],
): Promise<Outcome> {
  const url = `${TEE_RPC}?token=${await teeToken(feePayer)}`;
  const blockhash = (await rpc(url, "getLatestBlockhash", [])).result.value.blockhash;
  const tx = new Transaction({ feePayer: feePayer.publicKey, recentBlockhash: blockhash });
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }), ...instructions);
  tx.partialSign(feePayer);
  const wire = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  const config: Record<string, unknown> = {
    encoding: "base64",
    sigVerify: false,
    replaceRecentBlockhash: true,
  };
  if (postStateOf.length) {
    config.accounts = { encoding: "base64", addresses: postStateOf.map((k) => k.toBase58()) };
  }
  const response = await rpc(url, "simulateTransaction", [wire, config]);
  if (response.error) return { err: { rpc: response.error }, logs: 0, post: null };
  const value = response.result?.value;
  return {
    err: value?.err ?? null,
    logs: value?.logs?.length ?? 0,
    post: value?.accounts ?? null,
  };
}

/** Smallest compute budget under which the simulation does not run out of compute. */
async function computeNeeded(feePayer: Keypair, instructions: TransactionInstruction[]) {
  const exhausted = (outcome: Outcome) =>
    /ComputationalBudgetExceeded|ProgramFailedToComplete|exceeded CUs/i.test(
      JSON.stringify(outcome.err),
    );
  let low = 1_000;
  let high = 400_000;
  expect(exhausted(await simulate(feePayer, instructions, high))).to.equal(false);
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (exhausted(await simulate(feePayer, instructions, mid))) low = mid;
    else high = mid;
  }
  return high;
}

describe("simulation as a side channel", () => {
  const hunt = Hunt.fresh(payer);
  let atTreasure: Player;
  let farAway: Player;
  let newcomer: Player;
  let outsider: Keypair;

  const probeIx = (who: Player) => hunt.probeIx(who.operator.publicKey, who.owner.publicKey);

  before(async () => {
    atTreasure = await player("sim-a");
    farAway = await player("sim-b");
    newcomer = await player("sim-c");
    outsider = await wallet("outsider");
    evidenceSection(`Simulation side channel, author hunt ${hunt.hunt.toBase58()}`);
    await launch(
      hunt,
      { mode: "author", durationSecs: 1_800 },
      { location: TREASURE, salt: Keypair.generate().publicKey.toBytes() },
    );
    for (const who of [atTreasure, farAway, newcomer]) await join(hunt, who);
    for (const [who, start] of [
      [atTreasure, TREASURE],
      [farAway, FAR],
    ] as const) {
      await sendTee(
        [await hunt.embarkIx(who.operator.publicKey, who.owner.publicKey, start)],
        [who.operator],
        { computeUnits: 300_000 },
      );
    }
    evidence("- one ship embarked exactly at the treasure, one on the far side; nobody has sounded");
    await sleep(4_000);
  });

  const compare = async (label: string, near: () => Promise<Outcome>, far: () => Promise<Outcome>) => {
    const [a, b] = [await near(), await far()];
    evidence(`- ${label}: at the treasure \`${JSON.stringify(a.err)}\` / far away \`${JSON.stringify(b.err)}\``);
    expect(a, label).to.deep.equal(b);
    return a;
  };

  it("cannot tell from [embark, probe, probe]", async () => {
    const triple = async (start: Vec3) => [
      await hunt.embarkIx(newcomer.operator.publicKey, newcomer.owner.publicKey, start),
      await probeIx(newcomer),
      await probeIx(newcomer),
    ];
    const outcome = await compare(
      "[embark, probe, probe] by a player",
      async () => simulate(newcomer.operator, await triple(TREASURE)),
      async () => simulate(newcomer.operator, await triple(FAR)),
    );
    expect(JSON.stringify(outcome.err)).to.contain("6018");
    await compare(
      "[embark, probe, probe] paid by an outsider without the pilot's signature",
      async () => simulate(outsider, await triple(TREASURE)),
      async () => simulate(outsider, await triple(FAR)),
    );
  });

  it("cannot tell from [probe, probe] of an embarked ship", async () => {
    const outcome = await compare(
      "[probe, probe]",
      async () => simulate(atTreasure.operator, [await probeIx(atTreasure), await probeIx(atTreasure)]),
      async () => simulate(farAway.operator, [await probeIx(farAway), await probeIx(farAway)]),
    );
    expect(JSON.stringify(outcome.err)).to.contain("6018");
  });

  it("cannot tell from [probe, tick], [probe, tick, finalize] or [probe, finalize]", async () => {
    const tick = await hunt.tickIx();
    const finalize = await hunt.finalizeIx();
    const ok = await compare(
      "[probe, tick]",
      async () => simulate(atTreasure.operator, [await probeIx(atTreasure), tick]),
      async () => simulate(farAway.operator, [await probeIx(farAway), tick]),
    );
    expect(ok.err).to.equal(null);
    const notEnded = await compare(
      "[probe, tick, finalize]",
      async () => simulate(atTreasure.operator, [await probeIx(atTreasure), tick, finalize]),
      async () => simulate(farAway.operator, [await probeIx(farAway), tick, finalize]),
    );
    expect(JSON.stringify(notEnded.err)).to.contain("6020");
    await compare(
      "[probe, finalize]",
      async () => simulate(atTreasure.operator, [await probeIx(atTreasure), finalize]),
      async () => simulate(farAway.operator, [await probeIx(farAway), finalize]),
    );
  });

  it("needs the same compute for a strike as for a miss", async () => {
    // One ship, so keys, ship index and account sizes are identical: only where it stands
    // relative to the treasure changes. The two far points are a control for position alone.
    const ship = atTreasure;
    const tick = await hunt.tickIx();
    const measure = async () => ({
      probe: await computeNeeded(ship.operator, [await probeIx(ship)]),
      probeTick: await computeNeeded(ship.operator, [await probeIx(ship), tick]),
    });
    const atStrike = await measure();
    await fly(hunt, ship, FAR);
    const far = await measure();
    await fly(hunt, ship, FAR_TOO);
    const farToo = await measure();
    evidence(`- smallest compute budget, same ship, [probe]: ${atStrike.probe} CU at the treasure, ${far.probe} and ${farToo.probe} CU at two far points`);
    evidence(`- smallest compute budget, same ship, [probe, tick]: ${atStrike.probeTick} CU at the treasure, ${far.probeTick} and ${farToo.probeTick} CU at two far points`);
    expect(far, "control: position alone").to.deep.equal(farToo);
    expect(atStrike).to.deep.equal(far);
  });

  it("does not hand a simulated logbook to its own member", async () => {
    const logbook = hunt.logbook(atTreasure.owner.publicKey);
    const outcome = await simulate(atTreasure.operator, [await probeIx(atTreasure)], 400_000, [logbook]);
    evidence(`- member simulates a probe and asks for its logbook's post-state: err \`${JSON.stringify(outcome.err)}\`, logs ${outcome.logs}, post-state \`${JSON.stringify(outcome.post)}\``);
    expect(outcome.err).to.equal(null);
    expect(outcome.logs).to.equal(0);
    expect(JSON.stringify(outcome.post)).to.match(/^(null|\[null\])$/);
  });

  it("left nothing behind", async () => {
    const live = await hunt.huntState(teeAnonymous);
    const board = await hunt.boardState(teeAnonymous);
    const log = await hunt.logbookState(await tee(atTreasure.operator), atTreasure.owner.publicKey);
    evidence(`- after all simulations: hunt ${statusOf(live)}, ${live.probesTotal} probes, ${board.pinCount} pins, logbook entries ${log.entries.length}`);
    expect(statusOf(live)).to.equal("live");
    expect(live.probesTotal).to.equal(0);
    expect(board.pinCount).to.equal(0);
    expect(log.entries).to.have.length(0);
    expect(band(canonical(TREASURE), canonical(TREASURE))).to.equal(0);
  });
});
