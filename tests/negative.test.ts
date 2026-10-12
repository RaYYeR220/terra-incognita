import { expect } from "chai";
import { Keypair, TransactionInstruction } from "@solana/web3.js";
import { Vec3, fromLatLon } from "./support/geo";
import {
  Hunt,
  Player,
  evidence,
  evidenceSection,
  expectFailure,
  fly,
  join,
  launch,
  payer,
  player,
  sendBase,
  sendTee,
  sleep,
  sound,
  statusOf,
  teeAnonymous,
  wallet,
} from "./support/harness";

// Everything that must be refused, each against a live hunt on devnet.

const TREASURE: Vec3 = fromLatLon(-33.9249, 18.4241);
const START: Vec3 = fromLatLon(35.6762, 139.6503);
const ANTIPODE_OF_START: Vec3 = [-START[0], -START[1], -START[2]];
const NOT_UNIT: Vec3 = [1, 2, 3];

describe("refusals", () => {
  const hunt = Hunt.fresh(payer);
  let first: Player;
  let second: Player;
  let third: Player;
  let outsider: Keypair;

  const refused = async (label: string, expected: string, send: () => Promise<unknown>) => {
    const failure = await expectFailure(send);
    evidence(`- ${label}: \`${failure.code}\`${failure.signature ? `, signature \`${failure.signature}\`` : " (rejected at preflight)"}`);
    expect(failure.code, label).to.equal(expected);
    return failure;
  };
  const rollup = (signer: Keypair, ix: TransactionInstruction) => () =>
    sendTee([ix], [signer], { computeUnits: 300_000 });

  before(async () => {
    first = await player("neg-1");
    second = await player("neg-2");
    third = await player("neg-3");
    outsider = await wallet("outsider", 0.02);
    evidenceSection(`Refusals, author hunt ${hunt.hunt.toBase58()}`);
  });

  it("refuses hunts with parameters out of range", async () => {
    const bad = Hunt.fresh(payer);
    await refused("create_hunt with a 25 % creator cut", "InvalidParams", () =>
      bad.create({ mode: "author", durationSecs: 600, creatorBps: 2_500 }),
    );
  });

  it("refuses a second seal, a foreign seal and a second arm", async () => {
    const salt = Keypair.generate().publicKey.toBytes();
    await launch(hunt, { mode: "author", durationSecs: 1_800, maxPlayers: 2 }, { location: TREASURE, salt });
    await refused("seal_from_author again after arming", "WrongStatus", async () =>
      sendTee([await hunt.sealFromAuthorIx(START, salt)], [payer]),
    );
    const impostor = new Hunt(outsider, hunt.id);
    const ix = await impostor.sealFromAuthorIx(START, salt);
    ix.keys = ix.keys.map((meta) => {
      if (meta.pubkey.equals(impostor.hunt)) return { ...meta, pubkey: hunt.hunt };
      if (meta.pubkey.equals(impostor.treasure)) return { ...meta, pubkey: hunt.treasure };
      return meta;
    });
    await refused("seal_from_author signed by someone other than the creator", "ConstraintHasOne", () =>
      sendTee([ix], [outsider]),
    );
    await refused("arm a hunt that is already live", "WrongStatus", async () =>
      sendTee([await hunt.armIx(outsider.publicKey)], [outsider], { computeUnits: 400_000 }),
    );
  });

  it("refuses a forged VRF callback", async () => {
    await refused("seal_from_vrf signed by an ordinary key instead of the VRF identity", "ConstraintAddress", async () =>
      sendTee([await hunt.sealFromVrfIx(outsider.publicKey, new Uint8Array(32).fill(7))], [outsider]),
    );
  });

  it("refuses a player beyond the cap", async () => {
    await join(hunt, first);
    await join(hunt, second);
    await refused("join a full hunt", "HuntFull", () => hunt.join(third.owner, third.operator.publicKey));
  });

  it("refuses soundings, courses and embarkations that break the rules", async () => {
    const pilot = first.operator;
    const owner = first.owner.publicKey;
    await refused("probe before embarking", "NotEmbarked", async () =>
      sendTee([await hunt.probeIx(pilot.publicKey, owner)], [pilot]),
    );
    await refused("embark at a vector that is not a unit vector", "NotUnitVector", async () =>
      sendTee([await hunt.embarkIx(pilot.publicKey, owner, NOT_UNIT)], [pilot], { computeUnits: 300_000 }),
    );
    await refused("embark someone else's airship", "NotPilot", async () =>
      sendTee([await hunt.embarkIx(second.operator.publicKey, owner, START)], [second.operator], { computeUnits: 300_000 }),
    );
    await sendTee([await hunt.embarkIx(pilot.publicKey, owner, START)], [pilot], { computeUnits: 300_000 });
    await refused("embark twice", "AlreadyEmbarked", async () =>
      sendTee([await hunt.embarkIx(pilot.publicKey, owner, START)], [pilot], { computeUnits: 300_000 }),
    );
    await refused("probe right after embarking", "Cooldown", async () =>
      sendTee([await hunt.probeIx(pilot.publicKey, owner)], [pilot]),
    );
    await refused("probe someone else's airship", "NotPilot", async () =>
      sendTee([await hunt.probeIx(outsider.publicKey, owner)], [outsider]),
    );
    await refused("set a course for someone else's airship", "NotPilot", async () =>
      sendTee([await hunt.setCourseIx(second.operator.publicKey, owner, TREASURE)], [second.operator]),
    );
    await refused("set a course to a vector that is not a unit vector", "NotUnitVector", async () =>
      sendTee([await hunt.setCourseIx(pilot.publicKey, owner, NOT_UNIT)], [pilot]),
    );

    await sendTee([await hunt.setCourseIx(pilot.publicKey, owner, ANTIPODE_OF_START)], [pilot]);
    await refused("probe while in flight", "InFlight", async () =>
      sendTee([await hunt.probeIx(pilot.publicKey, owner)], [pilot]),
    );
    await refused("change course while in flight", "InFlight", async () =>
      sendTee([await hunt.setCourseIx(pilot.publicKey, owner, START)], [pilot]),
    );

    await fly(hunt, first, START);
    await sleep(3_000);
    const failure = await expectFailure(async () =>
      sendTee(
        [
          await hunt.setCourseIx(pilot.publicKey, owner, TREASURE),
          await hunt.probeIx(pilot.publicKey, owner),
        ],
        [pilot],
      ),
    );
    evidence(`- set a course and probe in one transaction: \`${failure.code}\``);
    expect(failure.code).to.equal("InFlight");
    await sound(hunt, first);
    await refused("probe again during the cooldown", "Cooldown", async () =>
      sendTee([await hunt.probeIx(pilot.publicKey, owner)], [pilot]),
    );
  });

  it("refuses to end, open or release a hunt that is still running", async () => {
    await sendTee([await hunt.tickIx()], [outsider], { computeUnits: 400_000 });
    expect(statusOf(await hunt.huntState(teeAnonymous))).to.equal("live");
    evidence("- tick on a live hunt with nothing to do: succeeds and changes nothing");
    await refused("finalize a live hunt", "NotEnded", async () =>
      sendTee([await hunt.finalizeIx()], [outsider], { computeUnits: 400_000 }),
    );
    await refused("open a logbook before the reveal", "NotRevealed", async () =>
      sendTee([await hunt.openLogbookIx(first.owner.publicKey)], [outsider]),
    );
    await refused("release the board before the reveal", "NotRevealed", async () =>
      sendTee([await hunt.releaseBoardIx(outsider.publicKey)], [outsider], { computeUnits: 300_000 }),
    );
    await refused("settle on Solana while the hunt is still delegated", "AccountOwnedByWrongProgram", async () =>
      sendBase([await hunt.settleIx(first.owner.publicKey)], [outsider]),
    );
    await refused("close the board while the hunt is still delegated", "AccountOwnedByWrongProgram", async () =>
      sendBase([await hunt.closeBoardIx()], [outsider]),
    );
  });

  it("refuses the 65th sounding", async function () {
    this.timeout(600_000);
    const pilot = second.operator;
    const owner = second.owner.publicKey;
    await sendTee([await hunt.embarkIx(pilot.publicKey, owner, TREASURE)], [pilot], { computeUnits: 300_000 });
    for (let i = 0; i < 64; i++) await sound(hunt, second);
    const board = await hunt.boardState(teeAnonymous);
    expect(board.ships[1].probes).to.equal(64);
    await sleep(3_500);
    await refused("the 65th probe, preflight", "ProbeLimit", async () =>
      sendTee([await hunt.probeIx(pilot.publicKey, owner)], [pilot]),
    );
    await refused("the 65th probe, executed without preflight", "ProbeLimit", async () =>
      sendTee([await hunt.probeIx(pilot.publicKey, owner)], [pilot], { skipPreflight: true }),
    );
  });
});
