# @terra-incognita/sdk

The client for Terra Incognita hunts: account decoders, instruction builders, rollup sessions,
the flows that create and play a hunt, a live subscription, and the proof of a finished hunt.
It runs in the browser and in Node. Runtime dependencies are `@solana/web3.js`, `@noble/curves`
and `@noble/hashes` (rollup login, sealed author locations), `tweetnacl` (the sealed box),
`buffer` and `@terra-incognita/core`; Anchor is not needed at runtime.

A hunt lives on two layers. The hunt, its board and its treasure are created on Solana and
delegated to a private ephemeral rollup running in a TEE; players join on Solana and play in the
rollup; the finished hunt returns to Solana with the payout. `TerraClient` routes every read and
every transaction to the right layer.

## Use

```ts
import { Keypair } from '@solana/web3.js';
import { fromLatLon } from '@terra-incognita/core';
import {
  PlayerSession, TerraClient, buildProofReport, createHunt, listHunts, walletSigner, watchHunt,
} from '@terra-incognita/sdk';

const client = new TerraClient();                       // devnet endpoints by default

// Creator: create, delegate, open, seal (VRF or author), arm, crank. Live in about 10 s.
const { hunt } = await createHunt(client, walletSigner(wallet), {
  mode: 'vrf', title: 'Open waters', prizeSeed: 20_000_000, durationSecs: 900, zoneIntervalSecs: 90,
});

// Author mode: the location and salt travel encrypted to the rollup validator inside the
// delegation and never appear in clear on Solana. Two wallet signatures.
await createHunt(client, walletSigner(wallet), {
  mode: 'author', location: fromLatLon(-22.95, -43.21), riddle: 'Arms open over the bay', durationSecs: 900,
});

// Player: the wallet signs `join` once; a fresh session key signs everything after that.
const { session } = await PlayerSession.join(client, walletSigner(wallet), hunt);
localStorage.setItem('session', JSON.stringify(session.serialize()));
await session.embark(fromLatLon(48.85, 2.35));
await session.fly(fromLatLon(40.42, -3.70));            // resolves on arrival
const { entry, strike } = await session.probe();        // waits out the cooldown, reads the logbook
// entry.band: 0 strike … 7 frozen. On a strike, probe() also ticks and finalizes the hunt.

// Everyone: live public state, websocket first, polling as fallback.
const watch = watchHunt(client, hunt, ({ hunt, board }) => render(hunt, board));

// After the hunt: commitment, every sounding re-measured, the payout transaction.
const report = await buildProofReport(client, hunt);    // report.verdict === 'verified'
```

## API

**Client** — `new TerraClient(options?)` with `base` and `rollup` connections, `send(layer, ixs,
signers, opts)` (throws `TerraTxError` with the program error name in `.code`), `authenticate`
and `rollupAs(signer)` for private reads, `now()` (the rollup clock the rules run on),
`residence(account)`, `fetchHunt`, `fetchBoard`, `fetchVault`, `fetchLogbook(hunt, owner,
reader?)`, `fetchTreasure`, `isDelegated`, `waitForDelegation`, `waitForRelease`.

**Signers** — `keypairSigner(keypair)`, `walletSigner(adapter)`, `toSigner`. Anything with
`publicKey` and `signTransaction` works; `signMessage` is only needed for private reads.

**Accounts** — `decodeHunt`, `decodeBoard` (zero-copy; pins come back oldest first),
`decodeLogbook`, `decodeVault`, `decodeTreasure`, `accountKind`, `payoutSplit`. Positions are
`Vec3` from the core package, lamports and timestamps are numbers, the hunt id is a `bigint`.

**Addresses** — `huntAddress`, `boardAddress`, `treasureAddress`, `vaultAddress`,
`logbookAddress`, `huntAddresses`, and the rollup accounts (`permissionAddress`,
`delegationRecordAddress`, `actionEscrowAddress`, `magicFeeVaultAddress`, `crankAddress`, …).

**Instructions** — `HuntInstructions` builds every instruction of the program for one hunt;
`buildInstruction(name, accounts, args)` builds any instruction from the interface synced from
the IDL.

**Sealed actions** — `encryptedActions(instructions, validator)` encodes post-delegation
actions with their arguments sealed to the validator (libsodium sealed box to its X25519 key);
`sealTo` and `openSealed` are the box itself. `HuntInstructions.delegateHuntSealed` and
`sealFromAction` are the two instructions that use them.

**Flows** — `createHunt` (`sealed: false` sends `seal_from_author` in the rollup instead of the
encrypted seal; `riddle` is the same as `clue`), `listHunts({ creator })`, `isJoinable`, `PlayerSession` (`join`,
`restore`, `serialize`, `embark`, `setCourse`, `fly`, `probe`, `readLogbook`, `ship`,
`readyAt`), `watchHunt`, `advanceHunt` (one keeper step: tick, finalize or the settle
fallback), `concludeHunt`, `waitForSettlement`, `scheduleCrank`.

**Proof** — `buildProofReport(client, hunt, { open, tamper })`, `openForAudit`,
`findSettlement`, `findAnchor`, `logbookOwners`.

**Operations** — `ensureDemoHunt`, `fundAccounts`, `sweepAccounts`, `cleanupHunt` (release and
close for the rent; logbooks stay readable on Solana unless `closeLogbooks`), `isSettled`.

## How the rollup is used

- Every request that sends a transaction to the rollup needs a session token, but the token
  does not have to belong to a signer of the transaction. The client logs in once with a
  throwaway relay key, so a wallet never has to sign a login message.
- Reading a private logbook needs a token of its owner or its operator. `PlayerSession` reads
  with the operator, which is a local key, so this needs no wallet either.
- Session keys hold no SOL: rollup transactions are free.
- The rollup keeps stale copies of accounts it has released. Reads therefore ask Solana first
  and use the rollup only while the account is delegated.
- Transactions over private accounts come back from the rollup without logs; errors are read
  from the transaction status. Base-layer transactions of a hunt (the commitment anchor, the
  payout) are found through the account history on Solana.

## The IDL

`idl/terra_incognita.json` is the program's IDL for anyone who prefers Anchor's client
(`@terra-incognita/sdk/idl.json`). `src/program-interface.ts` is the compact form the client
is built on. After a program change:

```sh
anchor build
npm run sync-idl -w @terra-incognita/sdk
```

## Develop

```sh
npm run build -w @terra-incognita/core
npm run build -w @terra-incognita/sdk
npm test -w @terra-incognita/sdk     # decoders and instructions against Anchor's own client
```
