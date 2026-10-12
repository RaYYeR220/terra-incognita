# Reviewing Terra Incognita in five minutes

A treasure hunt where nobody knows where the treasure is. Not even us. Everything below runs on Solana devnet and MagicBlock's TEE validator.

Video: `<VIDEO_URL>`

## 1. Play (2 minutes)

1. Open https://terra-incognita-hunt.vercel.app.
2. Play as a guest. You don't need a wallet or a browser extension. Your moves are signed by a session key that holds no SOL, so every move is free.
3. Watch the refused read. While the hunt is live, the app asks the rollup for the hidden treasure and gets `null` back. Our recorded reads with no token, with an outsider's token and with the creator's token all came back `null`, and so did every other way of reading the treasure that we tried ([PROOF.md](PROOF.md), section 5).
4. Open the proof of a finished hunt. It shows the commitment that was on Solana before play, the revealed location, every sounding re-measured against it, and the payout transaction.

## 2. Verify one hunt yourself (2 minutes)

From a checkout of this repository (Node 22 or newer; no wallet needed):

```sh
npm install && npm run build:packages
npx tsx scripts/verify-hunt.ts FZM2qBDXCcRTP5gCzT1LgehJtuggUQw4SqZDwzDP6frY
```

This prints `Verdict: VERIFIED`: 3 logbooks, 25 soundings re-measured, 0 mismatches, and the payout of 0.0154 SOL to the winner and 0.0006 SOL to the creator. Add `--tamper` to move the revealed location 300 km. The commitment check then fails, 5 soundings land in the wrong band, and the script exits with code 1.

## 3. Key links (1 minute)

| What | Link |
| --- | --- |
| Program | [`37s4Ax37…eh2Z1v`](https://explorer.solana.com/address/37s4Ax372B3AJkcBe7Cp3RA6Z4ns7Zx2PVbgU1eh2Z1v?cluster=devnet) |
| Final program upgrade | [`2zrZLBL3…`](https://explorer.solana.com/tx/2zrZLBL3Ui2yZatbvLwNi64VRnBpeyRoMMAP6SyQw78Z6udkzXnWsiAjKGjpFPTJXsda2Ncx1ne7GuDD4iHHDWiA?cluster=devnet) |
| Three-bot VRF hunt | [`FZM2qBDX…`](https://explorer.solana.com/address/FZM2qBDXCcRTP5gCzT1LgehJtuggUQw4SqZDwzDP6frY?cluster=devnet) |
| Its commitment, on Solana before play | [`74QDZ6Me…`](https://explorer.solana.com/tx/74QDZ6MeCTeQ8wig6EdnEnZjFB8MbYCZfxSRvBs2TgAKUxcdii8VE5T2kiQhkpdkqouosSmLkhoTACRQBKcZkeh?cluster=devnet) |
| Its payout: commit + undelegate + Magic Action `settle` in one transaction paid by the validator | [`2KRBZjBp…`](https://explorer.solana.com/tx/2KRBZjBpdfvCZUMwwoxqTAjjvgWptNRhi2iYsW1pePETGsB5ohWsQaMH65iDDVwokqVo3VGcReJxKDsZVjnTkeuE?cluster=devnet) |
| Hunt closed by scheduled ticks, closest sounding wins: payout | [`2gonGqGg…`](https://explorer.solana.com/tx/2gonGqGg2MWqkESTdjKSAsuGmffz1bdVeDj5jtrQT8pA65izMvqjtdTVtZFhu4EEDHbCGJXM6vpG69STxqiEvHMG?cluster=devnet) |
| Hunt with no client after launch: zone shrank, void, refunded by the scheduler | [`2S6E74sV…`](https://explorer.solana.com/tx/2S6E74sVnYkpgFDo2YdsJjLnd2M5qTL9fPNjFi7PZcw33eB92cvTYCNfCxUCWPuH8acV2Be1EPfPYBe6ZDTNBjgm?cluster=devnet) |
| Author location delivered encrypted inside the delegation | [`ZSF9ix4W…`](https://explorer.solana.com/tx/ZSF9ix4WHB7dNMCJKTuj52CTNgwDNiADPaHLtKuDiRUTry1uL3uLr2495frN8BBbFuJzh7Kb2exA88oWj33NYqj?cluster=devnet) |

[PROOF.md](PROOF.md) has the full list, including rollup signatures and the exact read results.

## Where the interesting code is

| File | Why look |
| --- | --- |
| `programs/terra_incognita/src/lib.rs`, `probe` | once the secret is touched: no branch, no error, no public write |
| `programs/terra_incognita/src/lib.rs`, `tick` | makes a strike public only from an earlier slot; runs under the validator's scheduler |
| `programs/terra_incognita/src/lib.rs`, `reveal_and_release` | reveal, commit, undelegate and the `settle` action in one intent, paid and signed by the hunt PDA |
| `programs/terra_incognita/src/lib.rs`, `open_hunt` / `seal_from_vrf` / `arm` | VRF request inside the rollup, the callback that touches only the treasure, the commitment |
| `programs/terra_incognita/src/lib.rs`, `delegate_hunt_sealed` / `seal_from_action` | an author's location delivered as an encrypted post-delegation action |
| `programs/terra_incognita/src/blind.rs` | branch-free selections behind volatile loads, so compute use can't depend on the secret |
| `programs/terra_incognita/src/geo.rs` | integer geometry, no trigonometry; its tests load the shared vectors |
| `packages/core/vectors/geometry.json` | reference vectors shared by Rust and TypeScript: bands, pairs, travel, unit vectors, VRF derivations, zone centres |
| `packages/core/src/audit.ts`, `derive.ts` | the commitment, the derivations from VRF output, the audit of every hint |
| `packages/sdk/src/proof.ts` | the proof report behind `verify-hunt` |
| `packages/sdk/src/sealed.ts` | sealed box to the validator's X25519 key and the encoding of post-delegation actions |
| `packages/sdk/src/player.ts` | the wallet signs `join` once; a session key does the rest |
| `packages/hunter/src/belief.ts`, `solver.ts` | the solver: sampled belief, expected time to a strike, travel-aware choice |
| `tests/simulation-oracle.test.ts` | simulations at the treasure and far away must give the same errors and need the same compute |
| `tests/confidentiality.test.ts` | everything an outside observer can ask the rollup, and what comes back |

## Tests

| Suite | Command | Result |
| --- | --- | --- |
| core (geometry, derivations, audit) | `npm test -w @terra-incognita/core` | 100 |
| sdk (decoders, instructions, sealed actions) | `npm test -w @terra-incognita/sdk` | 32, plus 1 devnet test (`TERRA_DEVNET=1`) |
| hunter (solver, simulator, bots) | `npm test -w @terra-incognita/hunter` | 77, plus 1 devnet test (`TERRA_DEVNET=1`) |
| program unit tests (Rust) | `npm run test:program` | 27, including the parity check against 1548 shared vector values |
| program on devnet | `npm run build:program && npm run test:devnet` | lifecycle 12/12, simulation-oracle 6/6, confidentiality 4/4, author-sealed 3/3, vrf-hunt 7/7, negative 7/7, crank 3/3, sealing 3/3 |

The last four devnet suites ran on the previous upgrade, which differs from the final program only by the two sealed-path instructions. Run `npm run build:packages` before the package tests. The devnet suites need a funded devnet key at `ANCHOR_WALLET`.

What we don't claim is listed in [CLAIMS.md](CLAIMS.md).
