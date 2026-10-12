# scripts

Command-line tools on top of `@terra-incognita/sdk`. Build the packages once, then run them with
`tsx` from the repository root:

```sh
npm install
npm run build:packages
```

All scripts talk to devnet unless `TERRA_BASE_RPC`, `TERRA_ROLLUP_RPC`, `TERRA_ROUTER_RPC` or
`TERRA_VALIDATOR` say otherwise.

## verify-hunt

Audits a finished hunt from public data alone:

```sh
npx tsx scripts/verify-hunt.ts <hunt address>            # or: npm run verify -- <hunt address>
npx tsx scripts/verify-hunt.ts <hunt address> --tamper   # moves the revealed location 300 km
```

It reads the commitment that was anchored on Solana before play, hashes the revealed location
and salt and compares the two, re-measures every sounding in every logbook against the
revealed location, and finds the payout transaction on Solana. Logbooks that are still private
are opened first (anyone may do this once the location is revealed); `--no-open` skips that,
`--json` prints the full report.

`--tamper` replaces the revealed location with one 300 km away before checking, to show what
a forged reveal looks like: the commitment no longer matches and the soundings near the
treasure land in the wrong bands.

Exit codes: `0` verified, `1` mismatch, `2` incomplete (some logbook could not be read) or not
finished, `3` error.

## demo-hunt

Makes sure a live demo hunt from a treasury key exists, and can let bots play it:

```sh
npx tsx scripts/demo-hunt.ts --treasury ~/.config/solana/id.json
npx tsx scripts/demo-hunt.ts --treasury <key> --bots surveyor,sprinter,shadow
```

Without `--bots` it is idempotent: it reuses a live hunt from the treasury that has seats and at
least three minutes left, and otherwise creates a VRF hunt (default prize 0.02 SOL, free entry,
15 minutes, zone stage every 90 s). `--fresh` always creates one.

With `--bots` it funds one throwaway wallet per personality (`surveyor`, `sprinter`, `shadow`,
`wanderer`), plays them until the hunt is over, waits for the payout, prints the audit, then
recovers the rent: logbooks, board and treasure are released to Solana, board and treasure are
closed, and the bots' balances are swept back to the treasury. Logbooks stay on Solana so the
hunt can be verified later; `--close-logbooks` closes them too, `--keep-rent` skips the cleanup.

| option | default | |
| --- | --- | --- |
| `--treasury <file>` | `TERRA_TREASURY_KEY`, else `~/.config/solana/id.json` | funded key that creates the hunt |
| `--prize <SOL>` | `0.02` | prize seeded by the treasury |
| `--entry <SOL>` | `0` | entry fee per player |
| `--duration <s>` | `900` | seconds until the deadline |
| `--zone <s>` | `90` | seconds per zone stage |
| `--keys-dir <dir>` | none | also write the bots' keys there |

The same steps are exported by the SDK (`ensureDemoHunt`, `fundAccounts`, `cleanupHunt`,
`sweepAccounts`) and by the hunter package (`runChainBots`), so a server route can call them
directly.
