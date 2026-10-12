import { expect } from "chai";
import { Keypair, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import { fromLatLon } from "./support/geo";
import {
  Hunt,
  Player,
  base,
  delegatedOnBase,
  evidence,
  balanceChange,
  evidenceSection,
  expectFailure,
  isDelegated,
  join,
  launch,
  ownedOnBase,
  player,
  sendBase,
  sendTee,
  statusOf,
  teeAnonymous,
  waitFor,
  wallet,
} from "./support/harness";

// Money must never be stuck or taken: hunts that never go live, hunts nobody plays, and the
// ways a third party could block an entrant. All hunts start together so their deadlines pass
// at the same time.

const DURATION_SECS = 135;
const PRIZE_SEED = 0.02 * LAMPORTS_PER_SOL;
const ENTRY_FEE = 0.01 * LAMPORTS_PER_SOL;

describe("recovery and refunds", () => {
  let creator: Keypair;
  let neverDelegated: Hunt;
  let neverArmed: Hunt;
  let unplayed: Hunt;
  let first: Player;
  let second: Player;
  let outsider: Keypair;
  let deadline = 0;

  const refused = async (label: string, expected: string, send: () => Promise<unknown>) => {
    const failure = await expectFailure(send);
    evidence(`- ${label}: \`${failure.code}\``);
    expect(failure.code, label).to.equal(expected);
  };

  const finalizeOnSolana = async (hunt: Hunt) => {
    await sendTee([await hunt.tickIx()], [outsider], { computeUnits: 400_000 });
    expect(statusOf(await hunt.huntState(teeAnonymous))).to.equal("void");
    await sendTee([await hunt.tickIx()], [outsider], { computeUnits: 400_000 });
    await waitFor(
      "the void hunt back on Solana",
      async () => (await ownedOnBase(hunt.hunt)) && (await hunt.huntState(base))?.finalized,
      180_000,
      1_000,
    );
    await waitFor("the settlement", async () => (await hunt.vaultState())?.settled, 60_000, 1_000);
  };

  before(async () => {
    // A creator of its own, so balance checks are not disturbed by other suites.
    creator = await wallet("recovery-creator", 0.6);
    neverDelegated = Hunt.fresh(creator);
    neverArmed = new Hunt(creator, neverDelegated.id.addn(1));
    unplayed = new Hunt(creator, neverDelegated.id.addn(2));
    first = await player("refund-1", 0.05);
    second = await player("refund-2", 0.05);
    outsider = await wallet("outsider", 0.02);
    evidenceSection(`Recovery and refunds (${neverDelegated.hunt.toBase58()}, ${neverArmed.hunt.toBase58()}, ${unplayed.hunt.toBase58()})`);
  });

  it("refuses hunts too short to play or starting too far ahead", async () => {
    await refused("create_hunt ending 60 s after its start", "InvalidParams", () =>
      Hunt.fresh(creator).create({ mode: "author", durationSecs: 60 }),
    );
    await refused("create_hunt starting in 8 days", "InvalidParams", () =>
      Hunt.fresh(creator).create({ mode: "author", durationSecs: 600, startsInSecs: 8 * 86_400 }),
    );
  });

  it("sets up three hunts at once", async () => {
    const options = { durationSecs: DURATION_SECS, prizeSeed: PRIZE_SEED, entryFee: ENTRY_FEE };
    await neverDelegated.create({ mode: "author", ...options });
    await neverArmed.create({ mode: "author", ...options });
    await launch(unplayed, { mode: "author", ...options }, {
      location: fromLatLon(10, 10),
      salt: Keypair.generate().publicKey.toBytes(),
    });
    deadline = (await unplayed.huntState(base)).deadline.toNumber();
    evidence(`- three hunts, deadlines around ${new Date(deadline * 1000).toISOString()}`);

    await waitFor("the hunt on Solana", () => neverArmed.huntState(base));
    evidence(`- never-armed hunt delegated (base): \`${await neverArmed.delegate()}\``);
    for (const account of [neverArmed.hunt, neverArmed.board, neverArmed.treasure]) {
      await waitFor(`delegation of ${account.toBase58()}`, async () =>
        (await delegatedOnBase(account)) && (await isDelegated(account)),
      );
    }
    evidence(`- never-armed hunt opened, nobody seals it (rollup): \`${await sendTee([await neverArmed.openIx()], [creator], { computeUnits: 400_000 })}\``);
  });

  it("refuses entrants before the hunt is live", async () => {
    await refused("join a hunt that was never delegated", "NotLive", () =>
      neverDelegated.join(first.owner, first.operator.publicKey),
    );
    await refused("join a delegated hunt that is not armed", "NotLive", () =>
      neverArmed.join(first.owner, first.operator.publicKey),
    );
  });

  it("lets a player join even when someone pre-funded their logbook address", async () => {
    const logbook = unplayed.logbook(first.owner.publicKey);
    const grief = await sendBase(
      [SystemProgram.transfer({ fromPubkey: outsider.publicKey, toPubkey: logbook, lamports: 1_000_000 })],
      [outsider],
    );
    evidence(`- outsider sent 0.001 SOL to the first player's logbook address (base): \`${grief}\``);
    evidence(`- the first player still joins (base): \`${await join(unplayed, first)}\``);
    evidence(`- second player joins (base): \`${await join(unplayed, second)}\``);
    const info = await base.getAccountInfo(logbook);
    expect(info?.owner.equals(DELEGATION_PROGRAM_ID)).to.equal(true);
    expect((await unplayed.vaultState()).entrants).to.equal(2);
  });

  it("lets the creator withdraw a hunt that was never delegated", async () => {
    const before = await base.getBalance(creator.publicKey);
    const signature = await sendBase(
      [await neverDelegated.reclaimEscrowIx(), await neverDelegated.cancelIx()],
      [creator],
    );
    evidence(`- reclaim_escrow + cancel_hunt (base): \`${signature}\``);
    for (const account of [neverDelegated.hunt, neverDelegated.board, neverDelegated.treasure, neverDelegated.vault, neverDelegated.actionEscrow]) {
      await waitFor(`${account.toBase58()} closed`, async () => (await base.getAccountInfo(account)) === null, 30_000);
    }
    const back = (await base.getBalance(creator.publicKey)) - before;
    evidence(`- creator got ${back} lamports back (prize seed ${PRIZE_SEED} included)`);
    expect(back).to.be.greaterThan(PRIZE_SEED + 0.06 * LAMPORTS_PER_SOL);
  });

  it("ends a hunt that never went live as void and returns the prize seed", async () => {
    await waitFor("the deadline", async () => Date.now() / 1000 > deadline + 3, (DURATION_SECS + 60) * 1000, 2_000);
    await finalizeOnSolana(neverArmed);
    const [payout] = await base.getSignaturesForAddress(neverArmed.vault, { limit: 1 });
    const fromVault = -(await balanceChange(payout.signature, neverArmed.vault));
    evidence(`- never-armed hunt: tick -> void, tick -> finalize; the vault paid ${fromVault} lamports (the prize seed) to the creator through the action \`${payout.signature}\``);
    expect(fromVault).to.equal(PRIZE_SEED);
  });

  it("returns only the prize seed to the creator and every entry fee to its entrant", async () => {
    await finalizeOnSolana(unplayed);
    const vault = await unplayed.vaultState();
    const [payout] = await base.getSignaturesForAddress(unplayed.vault, { limit: 1 });
    expect(-(await balanceChange(payout.signature, unplayed.vault))).to.equal(PRIZE_SEED);
    expect(vault.entryTotal.toNumber()).to.equal(2 * ENTRY_FEE);
    evidence(`- unplayed hunt void: creator received the prize seed only; ${vault.entryTotal.toNumber()} lamports of entry fees stay for refunds`);

    for (const who of [first, second]) {
      await sendTee([await unplayed.releaseLogbookIx(outsider.publicKey, who.owner.publicKey)], [outsider], {
        computeUnits: 300_000,
        allowUnconfirmed: true,
      });
      await waitFor("the logbook on Solana", () => ownedOnBase(unplayed.logbook(who.owner.publicKey)), 180_000, 1_000);
    }
    await refused("close_logbook on a void hunt", "UseRefund", async () =>
      sendBase([await unplayed.closeLogbookIx(first.owner.publicKey)], [first.owner]),
    );

    for (const [name, who] of [["first", first], ["second", second]] as const) {
      const signature = await sendBase([await unplayed.refundEntryIx(who.owner.publicKey)], [outsider]);
      const back = await balanceChange(signature, who.owner.publicKey);
      expect(-(await balanceChange(signature, unplayed.vault))).to.equal(ENTRY_FEE);
      evidence(`- refund_entry for the ${name} entrant, sent by an outsider (base): \`${signature}\`, +${back} lamports (fee ${ENTRY_FEE} plus logbook rent)`);
      expect(back).to.be.greaterThan(ENTRY_FEE);
    }
    expect((await unplayed.vaultState()).entryTotal.toNumber()).to.equal(0);
    await refused("refund the same entry twice", "AccountNotInitialized", async () =>
      sendBase([await unplayed.refundEntryIx(first.owner.publicKey)], [outsider]),
    );
  });

  it("keeps a finalized hunt out of the rollup and its records with their owners", async () => {
    await refused("delegate a finalized hunt again", "WrongStatus", () => unplayed.delegate());
    await sendTee([await unplayed.releaseBoardIx(outsider.publicKey)], [outsider], { computeUnits: 300_000, allowUnconfirmed: true });
    await waitFor("board and treasure on Solana", async () => (await ownedOnBase(unplayed.board)) && (await ownedOnBase(unplayed.treasure)), 180_000, 1_000);
    const ix = await unplayed.closeBoardIx();
    ix.keys = ix.keys.map((meta) => (meta.pubkey.equals(creator.publicKey) ? { ...meta, pubkey: outsider.publicKey } : meta));
    await refused("close the board as someone other than the creator", "ConstraintAddress", () => sendBase([ix], [outsider]));
    const signature = await sendBase(
      [await unplayed.closeBoardIx(), await unplayed.closeTreasureIx(), await unplayed.reclaimEscrowIx()],
      [creator],
    );
    evidence(`- creator closes board and treasure and reclaims the escrow (base): \`${signature}\``);
    const escrowChange = await balanceChange(signature, unplayed.actionEscrow);
    evidence(`- escrow emptied by the reclaim: ${escrowChange} lamports`);
    expect(escrowChange).to.be.lessThan(0);
    await waitFor("the escrow to be closed", async () => ((await base.getAccountInfo(unplayed.actionEscrow))?.lamports ?? 0) === 0, 30_000);
  });
});
