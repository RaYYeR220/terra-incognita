import { expect } from "chai";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { Vec3, band, canonical, commitment, distanceKm, fromLatLon } from "./support/geo";
import {
  Hunt,
  PROGRAM_ID,
  Player,
  TEE_RPC,
  base,
  evidence,
  evidenceSection,
  expectFailure,
  fly,
  join,
  launch,
  ownedOnBase,
  payer,
  player,
  rpc,
  sendBase,
  sendTee,
  sound,
  statusOf,
  tee,
  teeAnonymous,
  teeToken,
  waitFor,
  wallet,
} from "./support/harness";

// One complete hunt with an author-placed treasure, so a strike can be flown on purpose:
// create → delegate → open → seal → arm → join → embark → soundings → strike → tick →
// finalize → payout on Solana → audit of every hint against the revealed location → cleanup.

const ENTRY_FEE = 0.01 * LAMPORTS_PER_SOL;
const PRIZE_SEED = 0.05 * LAMPORTS_PER_SOL;
const CREATOR_BPS = 1_000;

const TREASURE: Vec3 = fromLatLon(-13.1631, -72.545);
const NEAR_TREASURE: Vec3 = fromLatLon(-13.3, -72.4);
const ALICE_START: Vec3 = fromLatLon(-12.0464, -77.0428);
const ALICE_FIRST_STOP: Vec3 = fromLatLon(-16.5, -68.15);
const BOB_START: Vec3 = fromLatLon(51.5074, -0.1278);
const BOB_FIRST_STOP: Vec3 = fromLatLon(40.4168, -3.7038);

const vec = (v: any): Vec3 => [v[0], v[1], v[2]];

describe("a hunt from creation to payout", () => {
  const hunt = Hunt.fresh(payer);
  const salt = Keypair.generate().publicKey.toBytes();
  let alice: Player;
  let bob: Player;
  let outsider: Keypair;
  let balancesBefore: { alice: number; creator: number; vault: number };

  const logbookAs = async (reader: Keypair | null, owner: PublicKey) => {
    const url = reader ? `${TEE_RPC}?token=${await teeToken(reader)}` : TEE_RPC;
    const response = await rpc(url, "getAccountInfo", [
      hunt.logbook(owner).toBase58(),
      { encoding: "base64" },
    ]);
    return response?.result?.value ?? null;
  };

  before(async () => {
    alice = await player("alice");
    bob = await player("bob");
    outsider = await wallet("outsider", 0.02);
    evidenceSection(`Lifecycle, author hunt ${hunt.hunt.toBase58()}`);
    evidence(`- program \`${PROGRAM_ID.toBase58()}\`, vault \`${hunt.vault.toBase58()}\``);
  });

  it("goes live with the commitment anchored on Solana", async () => {
    await launch(
      hunt,
      {
        mode: "author",
        durationSecs: 1_200,
        entryFee: ENTRY_FEE,
        prizeSeed: PRIZE_SEED,
        creatorBps: CREATOR_BPS,
        title: "Lost city",
        clue: "Where the condor nests above the sacred valley",
      },
      { location: TREASURE, salt },
    );
    const onBase = await hunt.huntState(base);
    const expected = commitment(hunt.hunt, canonical(TREASURE), salt);
    expect(Buffer.from(onBase.commitment)).to.deep.equal(expected);
    expect(onBase.finalized).to.equal(false);
    expect(vec(onBase.revealedLocation)).to.deep.equal([0, 0, 0]);
    evidence(`- commitment on Solana before play: \`${expected.toString("hex")}\``);
  });

  it("lets two players join on Solana", async () => {
    evidence(`- join alice (base): \`${await join(hunt, alice)}\``);
    evidence(`- join bob (base): \`${await join(hunt, bob)}\``);
    const vault = await hunt.vaultState();
    expect(vault.entrants).to.equal(2);
    expect(vault.entryTotal.toNumber()).to.equal(2 * ENTRY_FEE);
  });

  it("embarks both airships with their session keys", async () => {
    for (const [name, who, start] of [
      ["alice", alice, ALICE_START],
      ["bob", bob, BOB_START],
    ] as const) {
      const signature = await sendTee(
        [await hunt.embarkIx(who.operator.publicKey, who.owner.publicKey, start)],
        [who.operator],
        { computeUnits: 300_000 },
      );
      evidence(`- embark ${name}, signed and paid by an unfunded session key (rollup): \`${signature}\``);
    }
    const board = await hunt.boardState(teeAnonymous);
    expect(board.shipCount).to.equal(2);
    expect(board.ships[0].owner.equals(alice.owner.publicKey)).to.equal(true);
    expect(vec(board.ships[0].to)).to.deep.equal(canonical(ALICE_START));
    expect(board.ships[1].owner.equals(bob.owner.publicKey)).to.equal(true);
  });

  it("writes each sounding into the right logbook only", async () => {
    evidence(`- set_course alice (rollup): \`${await fly(hunt, alice, ALICE_FIRST_STOP)}\``);
    evidence(`- probe alice (rollup): \`${await sound(hunt, alice)}\``);
    evidence(`- set_course bob (rollup): \`${await fly(hunt, bob, BOB_FIRST_STOP)}\``);
    evidence(`- probe bob (rollup): \`${await sound(hunt, bob)}\``);

    const aliceLog = await hunt.logbookState(await tee(alice.operator), alice.owner.publicKey);
    const bobLog = await hunt.logbookState(await tee(bob.owner), bob.owner.publicKey);
    expect(aliceLog.entries).to.have.length(1);
    expect(bobLog.entries).to.have.length(1);
    expect(vec(aliceLog.entries[0].pos)).to.deep.equal(canonical(ALICE_FIRST_STOP));
    expect(aliceLog.entries[0].band).to.equal(band(canonical(ALICE_FIRST_STOP), canonical(TREASURE)));
    expect(bobLog.entries[0].band).to.equal(band(canonical(BOB_FIRST_STOP), canonical(TREASURE)));
    evidence(
      `- alice reads her logbook through her session key: band ${aliceLog.entries[0].band} at ${distanceKm(
        ALICE_FIRST_STOP,
        TREASURE,
      ).toFixed(0)} km; bob reads his: band ${bobLog.entries[0].band}`,
    );

    const board = await hunt.boardState(teeAnonymous);
    expect(board.pinCount).to.equal(2);
    expect(vec(board.pins[0].pos)).to.deep.equal(canonical(ALICE_FIRST_STOP));
    expect(Object.keys(board.pins[0])).to.not.include("band");
  });

  it("refuses a logbook to the other player, to an outsider and to anonymous readers", async () => {
    const target = alice.owner.publicKey;
    const results = {
      "her owner key": await logbookAs(alice.owner, target),
      "her session key": await logbookAs(alice.operator, target),
      "the other player": await logbookAs(bob.owner, target),
      "the other player's session key": await logbookAs(bob.operator, target),
      "the hunt creator": await logbookAs(payer, target),
      "an outsider": await logbookAs(outsider, target),
      "nobody (no token)": await logbookAs(null, target),
    };
    for (const [reader, value] of Object.entries(results)) {
      evidence(`- getAccountInfo(alice's logbook) as ${reader}: ${value ? `${value.space} bytes` : "null"}`);
    }
    expect(results["her owner key"]).to.not.equal(null);
    expect(results["her session key"]).to.not.equal(null);
    for (const reader of [
      "the other player",
      "the other player's session key",
      "the hunt creator",
      "an outsider",
      "nobody (no token)",
    ] as const) {
      expect(results[reader], reader).to.equal(null);
    }
  });

  it("keeps a strike private until a later tick", async () => {
    evidence(`- set_course alice to ${distanceKm(NEAR_TREASURE, TREASURE).toFixed(1)} km from the treasure (rollup): \`${await fly(hunt, alice, NEAR_TREASURE)}\``);
    evidence(`- probe alice, a strike (rollup): \`${await sound(hunt, alice)}\``);

    const log = await hunt.logbookState(await tee(alice.operator), alice.owner.publicKey);
    expect(log.entries).to.have.length(2);
    expect(log.entries[1].band).to.equal(0);

    const publicState = await hunt.huntState(teeAnonymous);
    expect(statusOf(publicState)).to.equal("live");
    expect(publicState.winner.equals(PublicKey.default)).to.equal(true);
    expect(publicState.probesTotal).to.equal(3);
    evidence(`- after the strike the public hunt is still \`${statusOf(publicState)}\` with no winner`);
  });

  it("is promoted by a permissionless tick", async () => {
    const signature = await sendTee([await hunt.tickIx()], [outsider], { computeUnits: 400_000 });
    evidence(`- tick sent by an outsider (rollup): \`${signature}\``);
    const state = await hunt.huntState(teeAnonymous);
    expect(statusOf(state)).to.equal("struck");
    expect(state.winner.equals(alice.owner.publicKey)).to.equal(true);
    expect(state.finalized).to.equal(false);
  });

  it("finalizes, returns to Solana and pays out through the scheduled action", async () => {
    balancesBefore = {
      alice: await base.getBalance(alice.owner.publicKey),
      creator: await base.getBalance(payer.publicKey),
      vault: await base.getBalance(hunt.vault),
    };
    const signature = await sendTee([await hunt.finalizeIx()], [outsider], {
      computeUnits: 400_000,
    });
    evidence(`- finalize sent by an outsider (rollup): \`${signature}\``);

    await waitFor(
      "the hunt to return to Solana",
      async () => {
        if (!(await ownedOnBase(hunt.hunt))) return false;
        const state = await hunt.huntState(base);
        return state?.finalized === true;
      },
      180_000,
      1_000,
    );
    const state = await hunt.huntState(base);
    expect(statusOf(state)).to.equal("struck");
    expect(vec(state.revealedLocation)).to.deep.equal(canonical(TREASURE));
    expect(Buffer.from(state.revealedSalt)).to.deep.equal(Buffer.from(salt));

    const settled = await waitFor(
      "the settlement action",
      async () => (await hunt.vaultState())?.settled === true,
      60_000,
      1_000,
    ).catch(() => false);
    if (!settled) {
      evidence("- the scheduled settlement did not arrive within 60 s; settling directly");
      const direct = await sendBase([await hunt.settleIx(alice.owner.publicKey)], [outsider]);
      evidence(`- settle, direct fallback (base): \`${direct}\``);
    }

    const pot = PRIZE_SEED + 2 * ENTRY_FEE;
    const creatorCut = (2 * ENTRY_FEE * CREATOR_BPS) / 10_000;
    const after = {
      alice: await base.getBalance(alice.owner.publicKey),
      vault: await base.getBalance(hunt.vault),
    };
    expect(after.alice - balancesBefore.alice).to.equal(pot - creatorCut);
    expect(balancesBefore.vault - after.vault).to.equal(pot);
    evidence(`- vault paid ${pot} lamports: ${pot - creatorCut} to the winner, ${creatorCut} to the creator`);

    for (const [name, address] of [
      ["hunt", hunt.hunt],
      ["vault", hunt.vault],
    ] as const) {
      const signatures = await base.getSignaturesForAddress(address, { limit: 4 });
      evidence(`- latest Solana transactions of the ${name}: ${signatures.map((s) => `\`${s.signature}\``).join(", ")}`);
    }
    expect(settled, "settlement arrived through the scheduled action").to.equal(true);
  });

  it("cannot be settled twice", async () => {
    const failure = await expectFailure(async () =>
      sendBase([await hunt.settleIx(alice.owner.publicKey)], [outsider]),
    );
    evidence(`- second settle (base): \`${failure.code}\``);
    expect(failure.code).to.equal("AlreadySettled");
  });

  it("opens the logbooks and the treasure for the audit", async () => {
    for (const [name, who] of [
      ["alice", alice],
      ["bob", bob],
    ] as const) {
      const signature = await sendTee([await hunt.openLogbookIx(who.owner.publicKey)], [outsider]);
      evidence(`- open_logbook ${name} (rollup): \`${signature}\``);
    }
    evidence(`- open_treasure (rollup): \`${await sendTee([await hunt.openTreasureIx()], [outsider])}\``);

    const treasure = await waitFor("the treasure to become readable", () =>
      hunt.treasureState(teeAnonymous),
    );
    expect(vec(treasure.location)).to.deep.equal(canonical(TREASURE));
    expect(treasure.strikePlayer.equals(alice.owner.publicKey)).to.equal(true);
    expect(treasure.bestPlayer.equals(alice.owner.publicKey)).to.equal(true);
    expect(await logbookAs(null, alice.owner.publicKey)).to.not.equal(null);
    expect(await logbookAs(null, bob.owner.publicKey)).to.not.equal(null);
  });

  it("re-derives the commitment and every hint from the revealed location", async () => {
    const state = await hunt.huntState(base);
    const location = vec(state.revealedLocation);
    const recomputed = commitment(hunt.hunt, location, Uint8Array.from(state.revealedSalt));
    expect(Buffer.from(state.commitment)).to.deep.equal(recomputed);

    let checked = 0;
    for (const who of [alice, bob]) {
      const log = await hunt.logbookState(teeAnonymous, who.owner.publicKey);
      for (const entry of log.entries) {
        expect(entry.band).to.equal(band(vec(entry.pos), location));
        checked += 1;
      }
    }
    expect(checked).to.equal(3);
    evidence(`- audit: commitment matches the revealed location and salt; ${checked} of ${checked} hints re-derived`);
  });

  it("returns the rent once the hunt is over", async () => {
    for (const [name, who] of [
      ["alice", alice],
      ["bob", bob],
    ] as const) {
      const signature = await sendTee(
        [await hunt.releaseLogbookIx(outsider.publicKey, who.owner.publicKey)],
        [outsider],
        { computeUnits: 300_000, allowUnconfirmed: true },
      );
      evidence(`- release_logbook ${name} (rollup): \`${signature}\``);
    }
    evidence(`- release_board (rollup): \`${await sendTee([await hunt.releaseBoardIx(outsider.publicKey)], [outsider], { computeUnits: 300_000, allowUnconfirmed: true })}\``);

    const accounts = [
      hunt.board,
      hunt.treasure,
      hunt.logbook(alice.owner.publicKey),
      hunt.logbook(bob.owner.publicKey),
    ];
    for (const account of accounts) {
      await waitFor(`${account.toBase58()} back on Solana`, () => ownedOnBase(account), 180_000, 1_000);
    }

    const creatorBefore = await base.getBalance(payer.publicKey);
    const bobBefore = await base.getBalance(bob.owner.publicKey);
    const closing = await sendBase(
      [
        await hunt.closeLogbookIx(alice.owner.publicKey),
        await hunt.closeLogbookIx(bob.owner.publicKey),
        await hunt.closeBoardIx(),
        await hunt.closeTreasureIx(),
      ],
      [outsider],
    );
    evidence(`- close logbooks, board and treasure (base): \`${closing}\``);
    for (const account of accounts) {
      await waitFor(
        `${account.toBase58()} to be closed`,
        async () => (await base.getAccountInfo(account)) === null,
        30_000,
      );
    }
    const huntInfo = await base.getAccountInfo(hunt.hunt);
    expect(huntInfo?.lamports).to.equal(await base.getMinimumBalanceForRentExemption(huntInfo!.data.length));
    const creatorBack = (await base.getBalance(payer.publicKey)) - creatorBefore;
    const bobBack = (await base.getBalance(bob.owner.publicKey)) - bobBefore;
    evidence(`- rent returned: ${creatorBack} lamports to the creator, ${bobBack} to each player`);
    // A delegated account pays the rollup's session fee out of its own lamports when it
    // leaves, so a logbook returns its rent minus about 0.003 SOL.
    expect(creatorBack).to.be.greaterThan(0.06 * LAMPORTS_PER_SOL);
    expect(bobBack).to.be.greaterThan(0.007 * LAMPORTS_PER_SOL);
  });
});
