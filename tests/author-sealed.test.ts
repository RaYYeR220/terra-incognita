import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import { Vec3, canonical, commitment, fromLatLon } from "./support/geo";
import {
  Hunt,
  TEE_RPC,
  TransactionFailed,
  base,
  delegatedOnBase,
  evidence,
  evidenceSection,
  isDelegated,
  ownedOnBase,
  payer,
  rpc,
  sendBase,
  sendTee,
  statusOf,
  teeAnonymous,
  teeToken,
  waitFor,
  wallet,
} from "./support/harness";

// Author mode where the creator's chosen location never appears in clear anywhere: the seal is
// a post-delegation action whose arguments are encrypted to the validator, stored by the
// delegation program on Solana and run by the validator inside the rollup.

const TREASURE: Vec3 = fromLatLon(-22.9519, -43.2105);
const DURATION_SECS = 45;

const contains = (haystack: Uint8Array, needle: Uint8Array) =>
  Buffer.from(haystack).indexOf(Buffer.from(needle)) >= 0;

describe("an author hunt sealed through an encrypted post-delegation action", () => {
  const hunt = Hunt.fresh(payer);
  const salt = Keypair.generate().publicKey.toBytes();
  const location = canonical(TREASURE);
  const locationBytes = Buffer.concat(location.map((c) => {
    const b = Buffer.alloc(4);
    b.writeInt32LE(c);
    return b;
  }));
  const rawLocationBytes = Buffer.concat(TREASURE.map((c) => {
    const b = Buffer.alloc(4);
    b.writeInt32LE(c);
    return b;
  }));
  let delegation: string;
  let outsider: Keypair;

  before(async () => {
    outsider = await wallet("outsider", 0.02);
    evidenceSection(`Encrypted author seal, hunt ${hunt.hunt.toBase58()}`);
  });

  it("delegates with the seal attached and nothing readable on Solana", async () => {
    evidence(`- create_hunt (base): \`${await hunt.create({ mode: "author", durationSecs: DURATION_SECS })}\``);
    await waitFor("the hunt on Solana", () => hunt.huntState(base));
    const ix = await hunt.delegateSealedIx(TREASURE, salt);
    evidence(`- delegate_hunt_sealed instruction data: ${ix.data.length} bytes`);
    delegation = await sendBase([ix], [payer], { computeUnits: 800_000 });
    evidence(`- delegate_hunt_sealed (base): \`${delegation}\``);
    for (const account of [hunt.hunt, hunt.board, hunt.treasure]) {
      await waitFor(
        `delegation of ${account.toBase58()}`,
        async () => (await delegatedOnBase(account)) && (await isDelegated(account)),
      );
    }

    const tx = await base.getTransaction(delegation, { maxSupportedTransactionVersion: 0 });
    const raw = tx!.transaction.message.compiledInstructions.map((i) => i.data);
    const record = await base.getAccountInfo(
      (await import("@magicblock-labs/ephemeral-rollups-sdk")).delegationRecordPdaFromDelegatedAccount(hunt.treasure),
    );
    for (const [what, bytes] of [
      ["location", locationBytes],
      ["location as entered", rawLocationBytes],
      ["salt", Buffer.from(salt)],
    ] as const) {
      const inTx = raw.some((data) => contains(data, bytes));
      const inRecord = record ? contains(record.data, bytes) : false;
      evidence(`- ${what} in the Solana transaction: ${inTx}; in the delegation record (${record?.data.length ?? 0} bytes): ${inRecord}`);
      expect(inTx, `${what} in the transaction`).to.equal(false);
      expect(inRecord, `${what} in the delegation record`).to.equal(false);
    }
  });

  it("is sealed by the validator inside the rollup with the creator's location", async () => {
    const armIx = await hunt.armIx(payer.publicKey);
    const arm = await waitFor(
      "the post-delegation action to seal the treasure",
      async () => {
        try {
          return await sendTee([armIx], [payer], { computeUnits: 400_000 });
        } catch (error) {
          if (error instanceof TransactionFailed && ["NotSealed", "WrongStatus"].includes(error.code)) return null;
          throw error;
        }
      },
      120_000,
      1_000,
    );
    evidence(`- arm, accepted once the action had run (rollup): \`${arm}\``);
    const onBase = await waitFor(
      "the commitment on Solana",
      async () => {
        const state = await hunt.huntState(base);
        return state && statusOf(state) === "live" ? state : null;
      },
      120_000,
      1_000,
    );
    expect(Buffer.from(onBase.commitment)).to.deep.equal(commitment(hunt.hunt, location, salt));
    evidence("- the commitment on Solana matches the creator's location and salt, so the validator decrypted and ran the action");
    for (const [label, url] of [
      ["no token", TEE_RPC],
      ["creator token", `${TEE_RPC}?token=${await teeToken(payer)}`],
      ["outsider token", `${TEE_RPC}?token=${await teeToken(outsider)}`],
    ] as const) {
      const response = await rpc(url, "getAccountInfo", [hunt.treasure.toBase58(), { encoding: "base64" }]);
      expect(response.result?.value ?? null, label).to.equal(null);
    }
    evidence("- the sealed treasure reads as null without a token, with the creator's and with an outsider's");

    // The validator runs the decrypted action as a rollup transaction that names the public
    // hunt, so an outsider can find it. Its instruction data would carry the location.
    const url = `${TEE_RPC}?token=${await teeToken(outsider)}`;
    const listed = await rpc(url, "getSignaturesForAddress", [hunt.hunt.toBase58(), { limit: 100 }]);
    let checked = 0;
    for (const entry of listed.result ?? []) {
      const tx = await rpc(url, "getTransaction", [entry.signature, { encoding: "base64", maxSupportedTransactionVersion: 0 }]);
      const json = await rpc(url, "getTransaction", [entry.signature, { encoding: "json", maxSupportedTransactionVersion: 0 }]);
      const raw = tx.result?.transaction?.[0] ? Buffer.from(tx.result.transaction[0], "base64") : Buffer.alloc(0);
      const text = JSON.stringify(json.result ?? {});
      const leaked = contains(raw, locationBytes) || contains(raw, Buffer.from(salt)) || text.includes("PostAct");
      if (leaked) evidence(`- outsider can read the action transaction \`${entry.signature}\`: ${text.slice(0, 300)}`);
      expect(contains(raw, locationBytes), `location in ${entry.signature}`).to.equal(false);
      expect(contains(raw, Buffer.from(salt)), `salt in ${entry.signature}`).to.equal(false);
      checked += 1;
    }
    evidence(`- ${checked} rollup transactions naming the hunt fetched as an outsider (base64 and json): none carries the location or the salt`);
  });

  it("ends void, reveals the same location on Solana and returns the rent", async () => {
    const deadline = (await hunt.huntState(teeAnonymous)).deadline.toNumber();
    await waitFor("the deadline", async () => Date.now() / 1000 > deadline + 2, (DURATION_SECS + 60) * 1000, 1_000);
    await sendTee([await hunt.tickIx()], [outsider], { computeUnits: 400_000 });
    await sendTee([await hunt.finalizeIx()], [outsider], { computeUnits: 400_000 }).catch((error) => {
      if (!(error instanceof TransactionFailed && error.code === "AlreadyFinalized")) throw error;
    });
    await waitFor(
      "the hunt back on Solana",
      async () => (await ownedOnBase(hunt.hunt)) && (await hunt.huntState(base))?.finalized,
      180_000,
      1_000,
    );
    const state = await hunt.huntState(base);
    expect(statusOf(state)).to.equal("void");
    expect([...state.revealedLocation]).to.deep.equal(location);
    evidence(`- revealed on Solana after the end: ${JSON.stringify([...state.revealedLocation])}`);

    await sendTee([await hunt.releaseBoardIx(outsider.publicKey)], [outsider], { computeUnits: 300_000, allowUnconfirmed: true });
    for (const account of [hunt.board, hunt.treasure]) {
      await waitFor(`${account.toBase58()} back on Solana`, () => ownedOnBase(account), 180_000, 1_000);
    }
    evidence(`- board and treasure closed (base): \`${await sendBase([await hunt.closeBoardIx(), await hunt.closeTreasureIx()], [outsider])}\``);
  });
});
