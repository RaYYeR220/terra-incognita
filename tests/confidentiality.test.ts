import { expect } from "chai";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Vec3, fromLatLon } from "./support/geo";
import {
  Hunt,
  PROGRAM_ID,
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
  sound,
  teeToken,
  wallet,
} from "./support/harness";

// What an ordinary outside observer gets back from the TEE endpoint for the private treasure
// and a private logbook: account reads, live subscriptions and transaction history, with an
// unrelated key's token and with no token at all. The owning player is the positive control.
// Every literal result goes into the evidence log; things an observer can still infer are
// recorded rather than failed.

const TREASURE: Vec3 = fromLatLon(27.1751, 78.0421);
const FIRST_STOP: Vec3 = fromLatLon(28.6139, 77.209);
const SECOND_STOP: Vec3 = fromLatLon(26.9124, 75.7873);
const WS = TEE_RPC.replace(/^http/, "ws");

const brief = (value: unknown) => {
  const text = JSON.stringify(value);
  return text.length > 220 ? `${text.slice(0, 220)}…` : text;
};

describe("confidentiality surface for an outside observer", () => {
  const hunt = Hunt.fresh(payer);
  let alice: Player;
  let bob: Player;
  let observer: Keypair;
  let views: { label: string; url: string; ws: string }[];
  let probeSignature: string;

  const privateAccounts = () => [
    ["treasure", hunt.treasure],
    ["alice's logbook", hunt.logbook(alice.owner.publicKey)],
  ] as const;

  before(async () => {
    alice = await player("conf-alice");
    bob = await player("conf-bob");
    observer = await wallet("observer");
    evidenceSection(`Confidentiality surface, author hunt ${hunt.hunt.toBase58()}`);
    await launch(
      hunt,
      { mode: "author", durationSecs: 1_800 },
      { location: TREASURE, salt: Keypair.generate().publicKey.toBytes() },
    );
    await join(hunt, alice);
    await join(hunt, bob);
    for (const [who, start] of [
      [alice, FIRST_STOP],
      [bob, SECOND_STOP],
    ] as const) {
      await sendTee([await hunt.embarkIx(who.operator.publicKey, who.owner.publicKey, start)], [who.operator], {
        computeUnits: 300_000,
      });
    }
    probeSignature = await sound(hunt, alice);
    evidence(`- setup: alice took one sounding \`${probeSignature}\`; the observer key \`${observer.publicKey.toBase58()}\` is no member of anything`);
    const token = await teeToken(observer);
    views = [
      { label: "observer token", url: `${TEE_RPC}?token=${token}`, ws: `${WS}?token=${token}` },
      { label: "no token", url: TEE_RPC, ws: WS },
    ];
  });

  it("1. denies direct reads of the private accounts", async () => {
    for (const view of views) {
      for (const [name, address] of privateAccounts()) {
        const key = address.toBase58();
        const info = await rpc(view.url, "getAccountInfo", [key, { encoding: "base64" }]);
        const sliced = await rpc(view.url, "getAccountInfo", [key, { encoding: "base64", dataSlice: { offset: 0, length: 8 } }]);
        const balance = await rpc(view.url, "getBalance", [key]);
        const history = await rpc(view.url, "getSignaturesForAddress", [key, { limit: 20 }]);
        evidence(`- [${view.label}] getAccountInfo(${name}): \`${brief(info.result?.value ?? info.error ?? null)}\`; with dataSlice: \`${brief(sliced.result?.value ?? sliced.error ?? null)}\``);
        evidence(`- [${view.label}] getBalance(${name}): \`${brief(balance.result?.value ?? balance.error)}\`; getSignaturesForAddress(${name}): ${history.result ? `${history.result.length} entries` : brief(history.error)}`);
        expect(info.result?.value ?? null, `${view.label} ${name}`).to.equal(null);
        expect(sliced.result?.value ?? null).to.equal(null);
        expect(balance.result?.value ?? 0).to.equal(0);
        expect(history.result ?? []).to.have.length(0);
      }

      const multiple = await rpc(view.url, "getMultipleAccounts", [
        [hunt.hunt.toBase58(), ...privateAccounts().map(([, a]) => a.toBase58())],
        { encoding: "base64" },
      ]);
      const values = multiple.result?.value ?? [];
      evidence(`- [${view.label}] getMultipleAccounts([hunt, treasure, logbook]): hunt ${values[0] ? `${values[0].space} bytes` : "null"}, treasure \`${brief(values[1])}\`, logbook \`${brief(values[2])}\``);
      expect(values[0]).to.not.equal(null);
      expect(values[1]).to.equal(null);
      expect(values[2]).to.equal(null);

      const all = await rpc(view.url, "getProgramAccounts", [PROGRAM_ID.toBase58(), { encoding: "base64", dataSlice: { offset: 0, length: 0 } }]);
      const keys = new Set<string>((all.result ?? []).map((entry: any) => entry.pubkey));
      const sized = await rpc(view.url, "getProgramAccounts", [
        PROGRAM_ID.toBase58(),
        { encoding: "base64", filters: [{ dataSize: 8 + 32 * 3 + 3 + 4 + 64 * 21 }] },
      ]);
      evidence(`- [${view.label}] getProgramAccounts(program): ${keys.size} accounts, hunt listed ${keys.has(hunt.hunt.toBase58())}, treasure listed ${keys.has(hunt.treasure.toBase58())}, alice's logbook listed ${keys.has(hunt.logbook(alice.owner.publicKey).toBase58())}; filtered by logbook size: ${sized.result ? `${sized.result.length} accounts` : brief(sized.error)}`);
      expect(keys.has(hunt.hunt.toBase58())).to.equal(true);
      for (const [, address] of privateAccounts()) expect(keys.has(address.toBase58())).to.equal(false);
    }
  });

  it("2. sends no live updates of the private accounts", async () => {
    const notes: string[] = [];
    const subscriptions: { connection: Connection; ids: number[]; logIds: number[] }[] = [];
    const seen = new Map<string, number>();
    const count = (key: string) => seen.set(key, (seen.get(key) ?? 0) + 1);
    for (const view of views) {
      const connection = new Connection(view.url, { commitment: "confirmed", wsEndpoint: view.ws });
      const ids: number[] = [];
      for (const [name, address] of [["board (control)", hunt.board] as const, ...privateAccounts()]) {
        ids.push(
          connection.onAccountChange(address, (info) => {
            count(`${view.label}/${name}`);
            notes.push(`[${view.label}] account notification for ${name}: ${info.data.length} bytes, owner ${info.owner.toBase58()}`);
          }),
        );
      }
      ids.push(
        connection.onProgramAccountChange(PROGRAM_ID, (change) => {
          const key = change.accountId.toBase58();
          const name = key === hunt.treasure.toBase58() ? "treasure" : key === hunt.logbook(alice.owner.publicKey).toBase58() ? "alice's logbook" : key === hunt.board.toBase58() ? "board" : key === hunt.hunt.toBase58() ? "hunt" : "other";
          count(`${view.label}/program:${name}`);
        }),
      );
      const logIds = [
        connection.onLogs(PROGRAM_ID, (logs) => {
          count(`${view.label}/logs`);
          notes.push(`[${view.label}] logs notification ${logs.signature}: ${logs.logs.length} lines, err ${JSON.stringify(logs.err)}`);
        }),
      ];
      subscriptions.push({ connection, ids, logIds });
    }
    await sleep(3_000);

    await fly(hunt, alice, SECOND_STOP);
    const second = await sound(hunt, alice);
    evidence(`- while subscribed, alice moved and took another sounding: \`${second}\``);
    await sleep(8_000);

    for (const { connection, ids, logIds } of subscriptions) {
      for (const id of ids.slice(0, -1)) await connection.removeAccountChangeListener(id);
      await connection.removeProgramAccountChangeListener(ids[ids.length - 1]);
      for (const id of logIds) await connection.removeOnLogsListener(id);
    }
    for (const view of views) {
      const line = ["board (control)", "treasure", "alice's logbook"]
        .map((name) => `${name} ${seen.get(`${view.label}/${name}`) ?? 0}`)
        .join(", ");
      const program = ["board", "hunt", "treasure", "alice's logbook"]
        .map((name) => `${name} ${seen.get(`${view.label}/program:${name}`) ?? 0}`)
        .join(", ");
      evidence(`- [${view.label}] accountSubscribe notifications: ${line}; programSubscribe notifications: ${program}; logsSubscribe(program) notifications: ${seen.get(`${view.label}/logs`) ?? 0}`);
    }
    for (const note of notes.slice(0, 8)) evidence(`  - ${note}`);
    for (const view of views) {
      expect(seen.get(`${view.label}/board (control)`) ?? 0, `${view.label}: control`).to.be.greaterThan(0);
      expect(seen.get(`${view.label}/treasure`) ?? 0).to.equal(0);
      expect(seen.get(`${view.label}/alice's logbook`) ?? 0).to.equal(0);
      expect(seen.get(`${view.label}/program:treasure`) ?? 0).to.equal(0);
      expect(seen.get(`${view.label}/program:alice's logbook`) ?? 0).to.equal(0);
    }
  });

  it("3. keeps the private contents out of transaction history", async () => {
    for (const view of views) {
      const listed = await rpc(view.url, "getSignaturesForAddress", [hunt.board.toBase58(), { limit: 50 }]);
      const entries = listed.result ?? [];
      const found = entries.find((entry: any) => entry.signature === probeSignature);
      evidence(`- [${view.label}] getSignaturesForAddress(board): ${entries.length} entries, alice's sounding listed: ${Boolean(found)}${found ? ` (slot ${found.slot}, blockTime ${found.blockTime}, err ${JSON.stringify(found.err)})` : ""}`);

      for (const encoding of ["json", "jsonParsed", "base64"]) {
        const tx = await rpc(view.url, "getTransaction", [probeSignature, { encoding, maxSupportedTransactionVersion: 0 }]);
        const result = tx.result;
        const message = result?.transaction?.message;
        const raw = Array.isArray(result?.transaction) ? result.transaction[0] : null;
        const fields = result
          ? `slot ${result.slot}, blockTime ${result.blockTime}, accountKeys ${message?.accountKeys?.length ?? "-"}, instructions ${message?.instructions?.length ?? "-"}, raw bytes ${raw ? Buffer.from(raw, "base64").length : "-"}, logs ${result.meta?.logMessages?.length ?? "-"}, innerInstructions ${result.meta?.innerInstructions?.length ?? "-"}, preBalances ${result.meta?.preBalances?.length ?? "-"}, computeUnits ${result.meta?.computeUnitsConsumed ?? "-"}, err ${JSON.stringify(result.meta?.err ?? null)}`
          : brief(tx.error ?? null);
        evidence(`- [${view.label}] getTransaction(alice's sounding, ${encoding}): ${fields}`);
        expect(message?.instructions?.length ?? 0).to.equal(0);
        expect(result?.meta?.logMessages?.length ?? 0).to.equal(0);
        expect(result?.meta?.innerInstructions?.length ?? 0).to.equal(0);
      }

      const status = await rpc(view.url, "getSignatureStatuses", [[probeSignature], { searchTransactionHistory: true }]);
      evidence(`- [${view.label}] getSignatureStatuses(alice's sounding): \`${brief(status.result?.value?.[0] ?? status.error ?? null)}\``);
      const slot = found?.slot ?? status.result?.value?.[0]?.slot;
      if (slot) {
        const block = await rpc(view.url, "getBlock", [slot, { encoding: "json", maxSupportedTransactionVersion: 0, transactionDetails: "full", rewards: false }]);
        evidence(`- [${view.label}] getBlock(${slot}): \`${brief(block.result ? { transactions: block.result.transactions?.length } : block.error)}\``);
        expect(block.result?.transactions?.length ?? 0).to.equal(0);
      }
    }
  });

  it("4. serves a logbook to its own member and to nobody else", async () => {
    const read = async (who: Keypair) => {
      const response = await rpc(`${TEE_RPC}?token=${await teeToken(who)}`, "getAccountInfo", [
        hunt.logbook(alice.owner.publicKey).toBase58(),
        { encoding: "base64" },
      ]);
      return response.result?.value ?? null;
    };
    const asOwner = await read(alice.owner);
    const asOperator = await read(alice.operator);
    const asBob = await read(bob.owner);
    evidence(`- alice's logbook read by alice (challenge-signed token): ${asOwner ? `${asOwner.space} bytes, owner ${asOwner.owner}` : "null"}; by her session key: ${asOperator ? `${asOperator.space} bytes` : "null"}; by bob: \`${JSON.stringify(asBob)}\``);
    expect(asOwner).to.not.equal(null);
    expect(asOperator).to.not.equal(null);
    expect(asBob).to.equal(null);
    const logbook = (await import("./support/harness")).program.coder.accounts.decode(
      "logbook",
      Buffer.from(asOwner.data[0], "base64"),
    );
    expect(logbook.entries.length).to.equal(2);
  });

  after(async () => {
    evidence("- still inferable by an outside observer: when and where each sounding happened (public board pin and probe counter, by design); slot, block time and success of a private transaction for anyone who holds its signature (getTransaction, getSignatureStatuses); the addresses of private accounts, which derive from public seeds, though a private account reads exactly like a missing one; a logbook's (empty) contents until its owner embarks, because the permission is created at embark");
  });
});
