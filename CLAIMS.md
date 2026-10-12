# Claims ledger

Every public statement we make about Terra Incognita, tagged with how you can check it.

| Tag | Meaning |
| --- | --- |
| **REPRODUCIBLE** | you can run a command and get the result yourself |
| **VERIFIED-LIVE** | it happened on devnet; there is a transaction or a recorded read behind it ([PROOF.md](PROOF.md)) |
| **MODELED** | it comes from a simulation or a benchmark, not from live play |
| **NOT-CLAIMED** | we do not claim it; see the list at the end |

## The ledger

| # | Claim | Tag | Evidence |
| --- | --- | --- | --- |
| 1 | A finished hunt can be audited from public data alone. | REPRODUCIBLE | `npx tsx scripts/verify-hunt.ts FZM2qBDXCcRTP5gCzT1LgehJtuggUQw4SqZDwzDP6frY` prints `VERIFIED`: 25 soundings re-measured, 0 mismatches |
| 2 | A forged reveal is caught. | REPRODUCIBLE | the same command with `--tamper` prints `MISMATCH` (commitment fails, 5 soundings in the wrong band) and exits with code 1 |
| 3 | The commitment to the location is on Solana before play. | VERIFIED-LIVE | [`74QDZ6Me…`](https://explorer.solana.com/tx/74QDZ6MeCTeQ8wig6EdnEnZjFB8MbYCZfxSRvBs2TgAKUxcdii8VE5T2kiQhkpdkqouosSmLkhoTACRQBKcZkeh?cluster=devnet), slot 510215800, before the three joins at slots 510215814 to 510215832 |
| 4 | In a VRF hunt nobody chooses the location: it comes from VRF randomness delivered inside the rollup. | VERIFIED-LIVE | `seal_from_vrf` callback of the three-bot hunt, sent by the VRF oracle (PROOF §2); hunt `DEVCzeQ…`: "VRF output `779748f2…` re-derives the location, salt, zone seed, commitment and 2 zone centres", payout [`44iT425P…`](https://explorer.solana.com/tx/44iT425PVoBejD81v8mJpp5Y2P1Xi78qY5RWKZB8CgAN3QsjZAb9fcRqzW8M3huYxfoydbwcHsDDxBA3yAZgSA6C?cluster=devnet) |
| 5 | VRF hunts arm within seconds of the request. | VERIFIED-LIVE | timed runs: armed on the first attempt 2239 ms and 963 ms after the request; in the three-bot hunt the callback landed two rollup slots after the request (PROOF §2) |
| 6 | A forged VRF callback is refused. | REPRODUCIBLE | `tests/negative.test.ts`: "seal_from_vrf signed by an ordinary key instead of the VRF identity: `ConstraintAddress`" (refused at preflight, so there is no signature) |
| 7 | Nobody can read the location while a VRF hunt runs: not players, not the creator, not us. | VERIFIED-LIVE | reads of the treasure with no token, an outsider's token and the creator's token return `null`, as does every other read in the confidentiality table (PROOF §5). This covers the reads we performed and rests on the TEE validator, which we trust. |
| 8 | A logbook is readable only by its owner and the owner's session key. | VERIFIED-LIVE | recorded reads on four hunts: owner key 1455 bytes, session key 1455 bytes; other player, the other player's session key, creator, outsider and no token: `null` (PROOF §5) |
| 9 | Moves cost players nothing: the session key holds no SOL. | VERIFIED-LIVE | "embark alice, signed and paid by an unfunded session key" (PROOF §3) |
| 10 | The rollup produces a block about every 10 ms. | VERIFIED-LIVE | 8,984 slots in 90 s of block time on the TEE endpoint during the three-bot hunt; check with `getTransaction` on its rollup signatures |
| 11 | A strike stays private until a `tick` in a later slot. | VERIFIED-LIVE | three-bot hunt: strike at slot 504281480, a rival's sounding accepted at 504281487, the strike made public by the scheduled tick at 504281526 (PROOF §2); "after the strike the public hunt is still `live` with no winner" (PROOF §3) |
| 12 | The pot is paid on Solana in the same transaction that commits and undelegates the hunt, through a Magic Action. | VERIFIED-LIVE | [`2KRBZjBp…`](https://explorer.solana.com/tx/2KRBZjBpdfvCZUMwwoxqTAjjvgWptNRhi2iYsW1pePETGsB5ohWsQaMH65iDDVwokqVo3VGcReJxKDsZVjnTkeuE?cluster=devnet): fee payer is the TEE validator; `ProcessUndelegation` then `Settle`, "settled: prize 15400000 creator 600000" |
| 13 | Scheduled ticks run a hunt to its end with no client. | VERIFIED-LIVE | closest-wins hunt `AoKR7…`, payout [`2gonGqGg…`](https://explorer.solana.com/tx/2gonGqGg2MWqkESTdjKSAsuGmffz1bdVeDj5jtrQT8pA65izMvqjtdTVtZFhu4EEDHbCGJXM6vpG69STxqiEvHMG?cluster=devnet); void hunt refunded by the scheduler [`2S6E74sV…`](https://explorer.solana.com/tx/2S6E74sVnYkpgFDo2YdsJjLnd2M5qTL9fPNjFi7PZcw33eB92cvTYCNfCxUCWPuH8acV2Be1EPfPYBe6ZDTNBjgm?cluster=devnet) |
| 14 | A simulation can't tell a strike from a miss: same errors, same compute. | VERIFIED-LIVE, REPRODUCIBLE | final program: [probe] 25534 CU and [probe, tick] 47075 CU at the treasure and at two far points, identical errors for six transaction shapes (PROOF §6); rerun with `tests/simulation-oracle.test.ts` and a funded devnet key |
| 15 | In Author mode the location and salt travel encrypted inside the delegation and appear neither in the Solana transaction nor in the delegation record. | VERIFIED-LIVE | [`ZSF9ix4W…`](https://explorer.solana.com/tx/ZSF9ix4WHB7dNMCJKTuj52CTNgwDNiADPaHLtKuDiRUTry1uL3uLr2495frN8BBbFuJzh7Kb2exA88oWj33NYqj?cluster=devnet); "location in the Solana transaction: false; in the delegation record (500 bytes): false" (PROOF §8) |
| 16 | The payout can't be claimed twice. | VERIFIED-LIVE | "second settle (base): `AlreadySettled`" (PROOF §3) |
| 17 | The program and the TypeScript geometry agree on every shared reference value. | REPRODUCIBLE | `npm run test:program`: 27 Rust tests, including the parity check against 1548 values in `packages/core/vectors/geometry.json` |
| 18 | Test counts: core 100, sdk 32, hunter 77, program 27; devnet suites lifecycle 12/12, simulation-oracle 6/6, confidentiality 4/4, author-sealed 3/3, vrf-hunt 7/7, negative 7/7, crank 3/3, sealing 3/3. | REPRODUCIBLE | `npm run test:packages`, `npm run test:program`, `npm run test:devnet` (the last needs a funded devnet key) |
| 19 | Anyone can play as a guest, with no wallet. | VERIFIED-LIVE | https://terra-incognita-hunt.vercel.app |
| 20 | The bots find the treasure in about ten soundings: median 10 for the surveyor and 13 for the sprinter; in a four-way race the sprinter wins 40.6 %. | MODELED | `packages/hunter` benchmark, 1,000 simulated hunts per row, seed 1 (`packages/hunter/README.md`) |
| 21 | Ten soundings is close to what the bands allow. | MODELED | about 16 bits are needed to find a 50 km cap on the globe; a sounding yields at most 3 (`packages/hunter/README.md`) |

## NOT-CLAIMED

We make none of these claims:

- **Mainnet.** Everything runs on Solana devnet and MagicBlock's devnet TEE validator.
- **An audit.** Neither the program nor the clients have been audited.
- **A verified build.** The devnet binary has not been matched against this source.
- **Immutability.** The program is upgradeable, and our deployer key holds the upgrade authority.
- **The Hydra crank.** Our Hydra registration succeeds and a manual trigger runs it, but the TEE validator does not trigger ephemeral Hydra cranks at priority tip 0. The legacy scheduled task is the live path.
- **Settlement callbacks** returning the payout receipt into the rollup. Not shipped.
- **Isolation guarantees of the TEE validator** beyond its documented access control and the reads we performed. We did not check enclave attestation, and we did not analyse the host, the operator or hardware side channels. MagicBlock's validator and VRF oracle are trusted.
- **Locating the VRF callback during play.** No read we tried located it while its hunt ran. We saw it only after the hunt was opened for the audit.
- **Secrecy from the author.** In Author mode the creator knows the location. The encrypted placement hides it from Solana, not from its author, and not from the validator that decrypts it.
- **Hidden positions or timing.** Pins, airship positions and sounding times are public by design. Anyone holding a private transaction's signature learns its slot, block time and success.
- **Hiding that a private account exists.** Addresses derive from public seeds; a private account reads like a missing one. A logbook is readable (empty) until its owner embarks.
- **Privacy after the end.** The location, salt and logbooks are published for the audit, and an opened hunt's rollup history reads in full.
- **About 10 ms per move, end to end.** 10 ms is the rollup's block interval. Our client saw confirmations after about 1 to 2.2 s.
- **Scale.** The largest hunt we ran on devnet had three players. A hunt holds up to 64, and we have not load-tested that.
- **Benchmark numbers as live results.** The solver figures come from simulated hunts.
- **Prizes in tokens other than SOL.**
- **Availability of the devnet endpoints** we depend on.
