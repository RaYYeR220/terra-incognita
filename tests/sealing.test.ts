import { expect } from "chai";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  Hunt,
  TransactionFailed,
  base,
  evidence,
  evidenceSection,
  expectFailure,
  isDelegated,
  payer,
  sendTee,
  sleep,
  statusOf,
  tee,
  waitFor,
} from "./support/harness";

async function createAndDelegate(hunt: Hunt, mode: "vrf" | "author"): Promise<void> {
  evidence(`- create_hunt (base): \`${await hunt.create({ mode, durationSecs: 900 })}\``);
  await waitFor("the hunt on Solana", () => hunt.huntState(base));
  evidence(`- delegate_hunt (base): \`${await hunt.delegate()}\``);
  for (const account of [hunt.hunt, hunt.board, hunt.treasure]) {
    await waitFor(`delegation of ${account.toBase58()}`, async () => {
      const info = await base.getAccountInfo(account);
      return info?.owner.equals(DELEGATION_PROGRAM_ID) && (await isDelegated(account));
    });
  }
}

describe("a hunt cannot be armed before its treasure is sealed", () => {
  it("rejects arm on an opened author hunt that nobody sealed", async () => {
    const hunt = Hunt.fresh(payer);
    evidenceSection(`Seal guard control, author hunt ${hunt.hunt.toBase58()}`);
    await createAndDelegate(hunt, "author");
    evidence(`- open_hunt, no randomness requested (rollup): \`${await sendTee([await hunt.openIx()], [payer], { computeUnits: 400_000 })}\``);
    expect(statusOf(await hunt.huntState(await tee(payer)))).to.equal("sealing");

    const failure = await expectFailure(async () =>
      sendTee([await hunt.armIx(payer.publicKey)], [payer], { computeUnits: 400_000 }),
    );
    evidence(`- arm on unsealed treasure: code \`${failure.code}\`, signature \`${failure.signature}\`, raw \`${JSON.stringify(failure.cause)}\``);
    expect(failure.code).to.equal("NotSealed");
    expect(statusOf(await hunt.huntState(await tee(payer)))).to.equal("sealing");
  });

  it("cannot open and arm a VRF hunt in one transaction", async () => {
    const hunt = Hunt.fresh(payer);
    evidenceSection(`Atomic open+arm, VRF hunt ${hunt.hunt.toBase58()}`);
    await createAndDelegate(hunt, "vrf");
    const instructions = [await hunt.openIx(), await hunt.armIx(payer.publicKey)];

    const simulated = await expectFailure(async () =>
      sendTee(instructions, [payer], { computeUnits: 600_000 }),
    );
    evidence(`- open_hunt + arm, preflight on: code \`${simulated.code}\`, signature \`${simulated.signature}\``);
    const executed = await expectFailure(async () =>
      sendTee(instructions, [payer], { computeUnits: 600_000, skipPreflight: true }),
    );
    evidence(`- open_hunt + arm, executed: code \`${executed.code}\`, signature \`${executed.signature}\`, raw \`${JSON.stringify(executed.cause)}\``);
    expect(simulated.code).to.equal("NotSealed");
    expect(JSON.stringify(executed.cause)).to.contain("6003");
    expect(statusOf(await hunt.huntState(await tee(payer)))).to.equal("created");
  });

  it("arms a VRF hunt within seconds of the randomness request", async () => {
    const hunt = Hunt.fresh(payer);
    evidenceSection(`Timed VRF sealing, hunt ${hunt.hunt.toBase58()}`);
    await createAndDelegate(hunt, "vrf");
    const armIx = await hunt.armIx(payer.publicKey);

    const requested = Date.now();
    const openSignature = await sendTee([await hunt.openIx()], [payer], { computeUnits: 400_000 });
    evidence(`- open_hunt with VRF request (rollup): \`${openSignature}\`, confirmed after ${Date.now() - requested} ms`);

    const attempts: string[] = [];
    let armSignature: string | null = null;
    while (!armSignature && Date.now() - requested < 120_000) {
      const at = Date.now() - requested;
      try {
        armSignature = await sendTee([armIx], [payer], { computeUnits: 400_000 });
        attempts.push(`${at}ms:ok`);
      } catch (error) {
        if (!(error instanceof TransactionFailed)) throw error;
        attempts.push(`${at}ms:${error.code.slice(0, 60)}`);
        await sleep(200);
      }
    }
    evidence(`- arm attempts since the request: ${attempts.join(", ")}`);
    evidence(`- arm (rollup): \`${armSignature}\``);
    expect(armSignature, "arm never succeeded").to.be.a("string");
    expect(Date.now() - requested).to.be.below(30_000);
    expect(statusOf(await hunt.huntState(await tee(payer)))).to.equal("live");
  });
});
