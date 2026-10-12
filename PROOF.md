# Proof on devnet

Every claim in this repository, with a devnet transaction behind it.

- **Solana transactions** link to `https://explorer.solana.com/tx/<signature>?cluster=devnet`.
- **Rollup transactions** ran on MagicBlock's TEE validator and are not on the Solana explorer. They are listed by full signature. Fetch one with `getTransaction` from `https://devnet-tee.magicblock.app`.
- Times are UTC, 2026-10-12. Quoted read results are copied exactly as we recorded them.

## 1. Deployment

| | |
| --- | --- |
| Program | [`37s4Ax372B3AJkcBe7Cp3RA6Z4ns7Zx2PVbgU1eh2Z1v`](https://explorer.solana.com/address/37s4Ax372B3AJkcBe7Cp3RA6Z4ns7Zx2PVbgU1eh2Z1v?cluster=devnet) |
| Upgrade authority | [`Ca7fJbX3CWYVu3sHuWuEiFxpRk9rUsdV7pFdPKNQJg9p`](https://explorer.solana.com/address/Ca7fJbX3CWYVu3sHuWuEiFxpRk9rUsdV7pFdPKNQJg9p?cluster=devnet) |
| Rollup validator | `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo` at `https://devnet-tee.magicblock.app` (`getVersion`: magicblock-core 1.0.0) |

| Time | Transaction | What changed |
| --- | --- | --- |
| 08:06 | [`4AbKYpmY…`](https://explorer.solana.com/tx/4AbKYpmYQhqkkbEJUxoqYj3xzkChoDmKZvMmQx6A1HLymWGVhgvH9iR3sPfEsRRmbNQVpfKZGstT2YY9fJHEsUwY?cluster=devnet) | first deploy, full instruction set |
| 08:48 | [`5HkTRuzn…`](https://explorer.solana.com/tx/5HkTRuznXL9c37qMHsTj4FWQTAy3f8Ny8z9KRYkeoEsEaXnrzTRuEniGcYDnZRJ6iGS5YbuXyyK5hUP3GobvJtRq?cluster=devnet) | strike recorded privately and promoted by `tick` in a later slot; `probe` has no secret-dependent branch, error or public write; `embark` starts the cooldown; positions stored in canonical form; rent recovery instructions |
| 08:54 | [`3d98ehLn…`](https://explorer.solana.com/tx/3d98ehLn2hdjsfaUvWgNNcNZBaCKtBvZuXae8f8ut7c33kyWWTmxqUAW71TDS8kpUJ2mCb8dCQJ1QpF8zAdM4PXm?cluster=devnet) | `close_board` also returns the hunt account's unused lamports |
| 09:01 | [`3GLg2hDL…`](https://explorer.solana.com/tx/3GLg2hDLYdZbdT3ityCkFgAqzFofjwHNsTVdzjsgT1CLYFPjahWyhjgZbNGxy3e4X72bJcZJ4vduYDCxVPBdNFHn?cluster=devnet) | flags passed through volatile loads (first attempt at the compute side channel, section 6) |
| 09:06 | [`31MJtyFT…`](https://explorer.solana.com/tx/31MJtyFTkRir4cneNVPibF19Nzn2eYns2Z48xYwUeaoJro8fANTFswibtsKzzV9oaWQdnzCkhMEqojY1wbjsK1Fe?cluster=devnet) | `dot` uses wrapping arithmetic: compute no longer depends on position |
| 09:09 | [`L1nyXgf1…`](https://explorer.solana.com/tx/L1nyXgf1G6L4qMzvbDdejEMKbKrtRoBGoNYf7bSntXMxp42LaRHUkPnfkqPe8pX5dj1VnLK9qAK8zwSntaePHYT?cluster=devnet) | `tick`'s strike-promotion flag passed through a volatile load. Sections 2 to 5 ran on this binary. |
| 10:35 | [`2zrZLBL3…`](https://explorer.solana.com/tx/2zrZLBL3Ui2yZatbvLwNi64VRnBpeyRoMMAP6SyQw78Z6udkzXnWsiAjKGjpFPTJXsda2Ncx1ne7GuDD4iHHDWiA?cluster=devnet) | **final program.** Adds `delegate_hunt_sealed` and `seal_from_action`, the encrypted author placement in section 8. Nothing else changed and the account layouts are the same, so evidence from the previous binary still applies. |

## 2. A full hunt: three bots, VRF, struck

Hunt [`FZM2qBDXCcRTP5gCzT1LgehJtuggUQw4SqZDwzDP6frY`](https://explorer.solana.com/address/FZM2qBDXCcRTP5gCzT1LgehJtuggUQw4SqZDwzDP6frY?cluster=devnet), "Three bots". Three bots from `packages/hunter` played it, and the scheduled task ran `tick`. Vault [`FLzPSyLJvYJfv1UL6dCubNARPwYBh3ypn9JpuCGpY6CZ`](https://explorer.solana.com/address/FLzPSyLJvYJfv1UL6dCubNARPwYBh3ypn9JpuCGpY6CZ?cluster=devnet), treasure `BwS9A4NgDwK2rEcF6HuSk4LGqQisCEHkM1eayjXKovhy`.

| Step | Layer | Transaction | Notes |
| --- | --- | --- | --- |
| create_hunt | Solana | [`4cpfgVZ2…`](https://explorer.solana.com/tx/4cpfgVZ2g6abD7eqPM5kPoFLnj3cVTt5frtAhMUz3UdouN9xxKbFgRyqqVJvN4VG5haGXuJw5esqyD9m79qJgkps?cluster=devnet) | prize seed into the vault |
| delegate_hunt | Solana | [`5ucCZ6G9…`](https://explorer.solana.com/tx/5ucCZ6G9SwQDuRLPSxMmVo1Q8DdJ7uPTyj81CkkoCKez7CPgH8s3fXkYpWhJKSpmRciNwYSeFkZJQvsirxCgGEFV?cluster=devnet) | hunt, board, treasure to the TEE validator |
| open_hunt + VRF request | rollup | `2UHfVneP5DoaXDH1Ckcjp6nZ4FFQcwqitTPaNY22gWxBNpdL5V3uVSNMFhh5rnTAdba91XYtyc55N45HetBUbrjc` | slot 504275587; treasure made private with no members |
| seal_from_vrf | rollup | `4TmR8B9L8W9EcBU2V5kWSx7Z764jYEPPfYNrvVvzMVQBzr1WFg9JwehgKbbZT4fpiyLmvCwsPD3ZsSvh4vMGNw59` | slot 504275589, two slots after the request; fee payer `vrfkfM4uoisXZQPrFiS2brY4oMkU9EWjyvmvqaFd5AS`; the VRF program invokes our `SealFromVrf` |
| arm | rollup | `47gHtvQ9g1BDxzvHxkkjBiqSetCqEzMfeBunK47ZXYqKDRrzD1hKweqgHNDChAUuFvi3VrJ9TWPQZmhRnFVu6QdW` | slot 504275714; derives the secrets, schedules the commit |
| commitment on Solana | Solana | [`74QDZ6Me…`](https://explorer.solana.com/tx/74QDZ6MeCTeQ8wig6EdnEnZjFB8MbYCZfxSRvBs2TgAKUxcdii8VE5T2kiQhkpdkqouosSmLkhoTACRQBKcZkeh?cluster=devnet) | commit of the armed hunt, fee payer = TEE validator, slot 510215800, before all three joins; commitment `2b5706532afd4736237eed4185be5b78a738dad2c5545fea4b3a5896dcbf6c7b` |
| schedule_tick_legacy | rollup | `3ECYghVd87owp9BUC7ejJZKzjeoUGhRvasu61hVrrYWtbUKjvhx5L4RduEQCh6yaFsbbRwqohueZg6zVr3eBjaqo` | first scheduled tick four slots later: `66Qr8rodP5iC6WYL3LPFKr4wV8VFw3Ecmx7qYpiomipitxzEiMyxKuyWxvZCMLfFKsFvC6KSLiW8tx5sBjyLNwGK` |
| join `GtkF…SRfx` | Solana | [`65Xtpu2C…`](https://explorer.solana.com/tx/65Xtpu2CwRhqR2rCHbF7JMjcvTyVdsMKJYwwFKg6Xws8ZvzuuQcdku9s1gE7ipb1KMEh7MqPD2sZEs7nUyTtjmdw?cluster=devnet) | slot 510215814 |
| join `7Pwi…Wfb9` | Solana | [`4fPM88KK…`](https://explorer.solana.com/tx/4fPM88KKejh9pEfSKu1nRvrQksJC7WcHSCCN76NWtXXQc5tSorS2YjGQiozcoEqSiAFcpqfyMTJSuHhrDeofyEzc?cluster=devnet) | slot 510215829 |
| join `H5Y7…yiPE` | Solana | [`jsfLym2c…`](https://explorer.solana.com/tx/jsfLym2cVfxZ4A54tNCqCFjU4BxYtxgZV6nj7mo7zr4TvWtygX5W6deySC9t2BeYUse8gyxy1nAHYVnd8G7hTor?cluster=devnet) | slot 510215832 |
| embark ×3 | rollup | `57cTdS1FA67odDUotcowWUTVGTfpSt8T3RMz5hmhKCb8S4G74yBtMh6U9gVLapxUv3a2tEHXrd7LqmTKWZvRRy6Z`<br>`2Bv67tpFoGYvuq4ft18HQWPbrmKZEousWkosWWCPNyrPmViRhpFgcy7HK8PVEZXMv6XTjLCKcJTSspfBNqawPZt4`<br>`3P2ctPH8W4DPPqPpHgCwHSojjH2GSYFugreQU4nry75rVUZpmNFRMD1z63UAMheBEPdnX6GdWtYcG3b9oseTFBrN` | signed by each player's session key; first one at 09:17:27 |
| 25 soundings | rollup | listed below | 7 + 10 + 8 |
| the strike | rollup | `3gSiQAgo16iBmXcuADf5H3r4qBo6uKMNtv4o3psgwSEVxtREvnp52nZWKLU9GytK1ZuHc2gj5Wgn9zGPFt4JhrYv` | `H5Y7…yiPE`'s 8th sounding, 35 km from the treasure, slot 504281480, 09:18:17 |
| a rival sounds after the strike | rollup | `suVGA5vEsmH6544DbnQfEtFJ3KttyeEtaQ4eLiSMyrNxPxj8rMaJF2EMdFCg37idL4sG3eKHXeKmA5Sn968ao72` | slot 504281487: the strike is still private, the hunt still live |
| tick makes the strike public | rollup | `4xRfUUfhctZUnTqjHq595YrzrzsbtaCx5qW3pG2LZpYnwERPmUrmfcZj9kSXLR3omWNxxctBesXhCAhHeybqwo2Y` | slot 504281526; executed by the validator's scheduled task (fee payer = validator, "Executed crank with 1 instructions") |
| a rival's course refused | rollup | `2rP6gCC1jHJoDPkFR3HDWwnuYeyn7ESga8SUoUeo1czAekYcksEJD1YdjfoRxrDfNELNp6kEm6LpTbXYykKzdzSn` | slot 504281585; `NotLive` (6011), the hunt is over |
| finalize | rollup | `4wSBXwuUU8aZxyjoEx6XXLsbydgG5qriy8PEtaRJzco3YkYVKkaRb6A2sUJNGmGFY1hznoQx1zBep87HTqrDyPkL` | slot 504281596, sent by the winner's session key; logs "Scheduling undelegation for accounts: FZM2q…" |
| payout via Magic Action | Solana | [`2KRBZjBp…`](https://explorer.solana.com/tx/2KRBZjBpdfvCZUMwwoxqTAjjvgWptNRhi2iYsW1pePETGsB5ohWsQaMH65iDDVwokqVo3VGcReJxKDsZVjnTkeuE?cluster=devnet) | 09:18:18; fee payer = TEE validator; delegation program commit, finalize, undelegate (our `ProcessUndelegation`), then call handler: our `Settle`, log "settled: prize 15400000 creator 600000" |
| close board and treasure | Solana | [`5rkz5q5F…`](https://explorer.solana.com/tx/5rkz5q5FrZCApwmnNXZhVQHvCjxVLTewkEuRt3YrWStPVkJDo9b3DTWhxDUTq2j9kdiGQZz7BV6KsanueqiaLYLr?cluster=devnet) | rent back to the creator; the logbooks stay on Solana for the audit |
| audit | anyone | `npx tsx scripts/verify-hunt.ts FZM2qBDXCcRTP5gCzT1LgehJtuggUQw4SqZDwzDP6frY` | `Verdict: VERIFIED`, 25 re-measured, 0 mismatches, exit 0. With `--tamper`: commitment `MISMATCH`, 5 mismatches, `Verdict: MISMATCH`, exit 1 |

Revealed location: −23.7645, −37.4839. Pot 16,000,000 lamports: the prize seed plus three entry fees. The winner received 15,400,000 and the creator 600,000, which is 10 % of the entry fees.

The rollup advanced 8,984 slots in 90 s of block time during this hunt, about one block every 10 ms.

<details>
<summary>All 25 soundings (rollup), with the band each logbook recorded</summary>

| Player | # | Band | Distance after reveal | Signature |
| --- | --- | --- | --- | --- |
| `GtkF…SRfx` | 1 | 6 cold | 9106 km | `23LwD5t8nJnf8Qa878ggYKhXDSER36ZnfdLQW53UjvzhZWndHRqMmn6BmMmiD8aCDyT6mNuJFd3Q1NojXXpWXHBW` |
| `GtkF…SRfx` | 2 | 6 cold | 7911 km | `2w9ddMzvw1k98CgTCyH1TZ6RMXyviP6B1z3qa3YimDW5txR6vovmcPc9KcGojAxwjEm23YyvkDgt4HjFVyyvWvyJ` |
| `GtkF…SRfx` | 3 | 7 frozen | 11887 km | `25EGoFZDYhYJWuW3YpD87KRrStn9vLVpj5CA9GPMnuJpEjt4Emp5zaPHV6MqZDX61Y1TeEvuseqLuSGXMsCTKZD7` |
| `GtkF…SRfx` | 4 | 4 mild | 1366 km | `5RMZvAdGBimD8fGQftVSR3YdW7va2vkd6wpVEG212npCvqbUTwp17sKTvhDH8e4Gk3vTP2CZeM7T949p8TvcM2R9` |
| `GtkF…SRfx` | 5 | 4 mild | 1811 km | `kcrH6wMKxQDesQH9PMeMVT8kaTb3nysQkJGdoxntZW2RThLnNHsFv7xh273dA9XvbSTDkNeSrNsV4VJqyvTxYi6` |
| `GtkF…SRfx` | 6 | 3 warm | 969 km | `1SoZyQTtH651a1yjDYjjxZsNVuYhSYMMcbjvhnUVyzkJtUFd4P8R1Uxtquz2sxvdVr5synB7o5jCkwEU3xjk91h` |
| `GtkF…SRfx` | 7 | 3 warm | 993 km | `suVGA5vEsmH6544DbnQfEtFJ3KttyeEtaQ4eLiSMyrNxPxj8rMaJF2EMdFCg37idL4sG3eKHXeKmA5Sn968ao72` |
| `7Pwi…Wfb9` | 1 | 5 cool | 3886 km | `3YqA8vDgzZtqfujtg4UTHhH2MHkozdZPF7GUrr1JtXJvbWTSWmcX7vDXX6p9dFChhVXaT1wqkFFQVgxUffuMnUqP` |
| `7Pwi…Wfb9` | 2 | 5 cool | 4849 km | `5CPtcTC9oFtQzD9rYT3aYSETpGoqLAmEpCHsmPwJUGyrX2R8U3BnJLvUT9kFEmuxCsF6H952Ly8FLEGuJFUKs3bu` |
| `7Pwi…Wfb9` | 3 | 6 cold | 5859 km | `5dz5hCn5TxtbAZ6Rok88QDFUZcReZHddvJCqnVdXYdZ6njUxR4DRuZdY7aaNobz5Ze1XBH4PLYGxqvNh49mDXudR` |
| `7Pwi…Wfb9` | 4 | 6 cold | 5328 km | `2cFqyTd49BajxYrvRS1CtAbZAizHjsjQg2xvYPp4rKqTrw5WgaRp32uJnnC2MBEtF1RNSXcHT5KghVJB2dYJSTj1` |
| `7Pwi…Wfb9` | 5 | 5 cool | 4743 km | `3rgoGMRXJcS6nhaZoZCTZbrrb7Q6F9ukWMwBiX7DfdC5Jhz9dWzjrgHaFa3WvzuDaGTcrryhWnAQpeCmp8uFjrE5` |
| `7Pwi…Wfb9` | 6 | 4 mild | 2377 km | `4ctcapxoTL2Lrq1YasN45cG1ppesthQ2GjdYj1oLFcV24M41ko6V71BbFPjt9NC8gzEwuL8z3drCYW97b54Gb84y` |
| `7Pwi…Wfb9` | 7 | 3 warm | 764 km | `3EjawXD1pPqk68r1pMTSotkrb38LykGPDWHdJ57YEyjsn5MDhC4iGLGH3zh3iaYPspsum6VjyvK2aw4Sa9xeeYS7` |
| `7Pwi…Wfb9` | 8 | 2 hot | 269 km | `3jTyrVCFc71FHsdArtfP1GK5XG5ESVm7xQWDX2i76ah22fRhSA5J4e46CBqTVxBifpQSNbUKmLFRFSSNzcYT4e1X` |
| `7Pwi…Wfb9` | 9 | 2 hot | 284 km | `5WDgwhnqhVfnnBeLRwFvxqGzfphdZcaYxDtVwaVwzKyhzrZchfoRW4uryYuY5bAsdBbS9QYTDymVUr6RD1M3c2u3` |
| `7Pwi…Wfb9` | 10 | 1 scorching | 120 km | `tMbTR6MU7LwtsX3H2DtJU6t587Aw6iYDfw1nrojBPdniYYDPmaj3oHmq2KnQWmdtER24FKokvLxUUjDibJuRX6K` |
| `H5Y7…yiPE` | 1 | 6 cold | 6549 km | `5h2H5QaBAHSPE5K3nCkWJVAnW9nF3ow188rRt7FtzkF6ePnT69G33sBmcnbtbLw3CUf58RgfbGYzqyHZagcZbFjc` |
| `H5Y7…yiPE` | 2 | 6 cold | 6782 km | `3dUfo6nnWCCNWXiABVvUqKWUdFe5dDctd8WBZz23aer9Q2TVzTUS11PMXxz2VoNcoW74KXVqio5HRkPe79sdjWgF` |
| `H5Y7…yiPE` | 3 | 6 cold | 7180 km | `4EeR6SSdYLZXZsMLLdyYQmNEjSqP5PRBMGEUV66iUxVgNHM37XdXLgHex18RtryGmPJujNp6m63kKuLayJPWKQPp` |
| `H5Y7…yiPE` | 4 | 7 frozen | 10743 km | `36JqQXXSL4BLq7TKNe2qrACeXrPwqhNHuJfqv3FniPUWijd8iG7L7RU4DW3wQ1qUwKE9gDXwe57MvXVFSLM5QaHm` |
| `H5Y7…yiPE` | 5 | 1 scorching | 142 km | `5hxQGw6ukoogZzgubtUn36uUE72fEERP4bZznfwy1mtP9bJXtDkyxNwYGvaKMUMZ6NKHfjmecXzVKG3cGuMLLBwu` |
| `H5Y7…yiPE` | 6 | 1 scorching | 130 km | `PDgNcEEwmxUh5wk2BsQNgw83Lc6rxtaVyDYpLDfPhYNtD7CnwNKTK5AtJd5UPGFe5AhCUs8jHADFh1UiXhfCNgj` |
| `H5Y7…yiPE` | 7 | 2 hot | 204 km | `3nJ7eiwDAcupS5hUrtTkJgfT5r1a94PvMU3FFFRQpNzQppitj6xsNUzvXt9UwV9QE8rjpx7rU7emZHEir4Uy6fhx` |
| `H5Y7…yiPE` | 8 | 0 strike | 35 km | `3gSiQAgo16iBmXcuADf5H3r4qBo6uKMNtv4o3psgwSEVxtREvnp52nZWKLU9GytK1ZuHc2gj5Wgn9zGPFt4JhrYv` |

Each player's soundings are matched to the player through the logbook account they name, and they appear in the same order as the logbook entries. Bands and distances come from `verify-hunt`.

</details>

During play, transactions that touch a private account come back from the rollup as empty shells (section 5), and no read we tried located a VRF callback while its hunt was running. This hunt was opened for the audit after it ended. After that, the rollup returned the transactions above in full to an anonymous `getTransaction`, VRF callback included, and listed them under `getSignaturesForAddress` for the hunt and the treasure.

## 3. An author hunt with a deliberate strike

Author mode puts the treasure where the test wants it, so a strike can be flown on purpose. This run shows gasless session keys, a strike kept private until `tick`, and a double-settle refusal. Hunt `3K6dsgdJf294uVLXDMaoEVNkjxG4zdLxs9hNjPcsQVUG`, on the same binary as section 2.

| Step | Layer | Transaction |
| --- | --- | --- |
| create_hunt | Solana | [`3DFqBfKi…`](https://explorer.solana.com/tx/3DFqBfKiKaaVFWEqWmPcCkb6nUfJCscduHgu24ZSS5ThsEYuuYCrWX9CqRvxP3ZCMimKFXMKYiBAeKd3swYPeMrW?cluster=devnet) |
| delegate_hunt | Solana | [`3ypqy6ZQ…`](https://explorer.solana.com/tx/3ypqy6ZQv8A2L55AhBYF9a42xmeCpAw2HbcPu4CGDk1V3EWr9bLS69gmissrqtjuvy5G51r82Ji11tmieshMkcAM?cluster=devnet) |
| open_hunt | rollup | `3mYRS8pJc9RpLBWiy8UPNUo9cjQtVZRK12sZX4gJcmuzrubWZwT32izgXjngfW7AuN6SP22diGACrrsdBWbv5Szi` |
| seal_from_author | rollup | `5CLFh7UsMLA7bRrdKzGHZXM356DgFzJVt1qD7tnzSaeRXnJeBWe1a9DAp6TrK6BL1WohYTzrTZxG5DSKdwaC1UG7` |
| arm | rollup | `3m14cTf1Z8HGC56Z2V2SsNcgWvutwGqVtDYXSz1rsR1GARxLk5UcsqrNuSUzNw4tQUWBVTVEEvfqGhQY2KVeKucj` |
| commitment on Solana (`5ed05881fc264e775379e559ec9a8dc60ae7ce3ed4db60058c1fff2f20773dcf`) | Solana | [`2eFuyNZP…`](https://explorer.solana.com/tx/2eFuyNZPmwYrpeF5EeVDRSJ4tAqcD64Dvj1c61wbraLwDTZsHEmKC1pS1ftxth3mAMm5z9rftjmJVS2j1VQbkCwE?cluster=devnet), fee payer = TEE validator |
| join alice / bob | Solana | [`ayGd3oGG…`](https://explorer.solana.com/tx/ayGd3oGGh6yDGS6Jqd9fiEP56birt7Ktnca9e1S64qHnFXKmgU8By8DvvhLEmiAMm1UEzUR5b4Ms1EjmQaj55J4?cluster=devnet) / [`2XuFZWpw…`](https://explorer.solana.com/tx/2XuFZWpwQyxBx1WEiV3vxSLmr8noXpuNiopck9UL8AUPBNBQdG2eqwqFPiCbmQRe4mGZzKL7w9phEMTpFUD2C1Xz?cluster=devnet) |
| embark alice, signed and paid by an unfunded session key | rollup | `5R8vbUMhaUB5iMkxbkdLUxPviE67brZUyit7hGRSWLivFgpf4CEpghUhc6eLTPMaxdYKBN1zEMiwXEY6WbfPrptL` |
| embark bob, signed and paid by an unfunded session key | rollup | `5Viu2vCYTNDmUMd62eKJgExj99MNGiMXtSgXsGiuR3VGDuFKKWFXMGU42QP7svhbaqweRtSa6rifTCnkUwVMNxYy` |
| probe alice / bob | rollup | `be6w52rb9mUHDEm6G1uaAFEmh8nbKeQNAmuDeaskd2VvMqq7trETNBk3H3t5sk3YDRhgvEpE64b9EfvM9L6aazW`<br>`2nZ8ECKpDca8djYA5wWjQtLk6Bar4UiP6fC9ypaXsfoJW3VYhjoAGK4fN8rfF6gU8DBxuMyuJuFVvzMgwiNAsMLe` |
| set_course alice to 21.9 km from the treasure | rollup | `39hAGruLqNngiUjPX1a4qT8VNN6hd3mGTPTGFqgG6UkydtswEm2JWhh99bTXBifZBeJwTaULxshrGSd8sUUbXAnT` |
| probe alice, a strike | rollup | `2Ax36THTXuH2vdXGUAgDcceNi7PwTKyk2GEWJJ68BDDpC5g4Cs44WXkJbV9od87CW3yG2d1D1UaZU4Wsqdw2osm5` |
| tick sent by an outsider | rollup | `2m14CMnzpYU12FYLsjczxiBTTpZgGW3ashN41t21dkKTq6dK2d24nNGcPiKRo6V75dFcdLcDHUVSaVpMuriSoUox` |
| finalize sent by an outsider | rollup | `5xRNrDDDjqceCfmqYp1GHthViZc6jTjV1A1FWHrz3skaH7ReeGPD9x2ikMdJwjH7xKfckRFEJifSmFLoqBmJG9GU` |
| payout via Magic Action | Solana | [`4haNU62n…`](https://explorer.solana.com/tx/4haNU62nZQw65s7M5uEp5eaPYvgrY59g3YGKnUb5UxyLYPPEPexmZbBhdhHihXDNrmNTTrMxdqQ1sz3iSpQfBHrd?cluster=devnet), fee payer = TEE validator, "settled: prize 68000000 creator 2000000" |
| close logbooks, board and treasure | Solana | [`9LUBjGyw…`](https://explorer.solana.com/tx/9LUBjGywL5z84C6UZ3w3JcBRWnVvHMdUVaY7LtDzzaJgt9Uj8M3N3TLYejX84LoRAadvZDaUycuPj1qTYtwBJh4?cluster=devnet) |

Recorded during this run:

- "alice reads her logbook through her session key: band 3 at 601 km; bob reads his: band 6"
- "after the strike the public hunt is still `live` with no winner"
- "vault paid 70000000 lamports: 68000000 to the winner, 2000000 to the creator"
- "second settle (base): `AlreadySettled`"
- "audit: commitment matches the revealed location and salt; 3 of 3 hints re-derived"
- "rent returned: 67058152 lamports to the creator, 8043752 to each player"

## 4. Closed by the crank: closest sounding wins

Hunt [`AoKR7rx5v7t8otjrht5B4yC5SXvVVQgRm1EJh7iogD4C`](https://explorer.solana.com/address/AoKR7rx5v7t8otjrht5B4yC5SXvVVQgRm1EJh7iogD4C?cluster=devnet), "SDK smoke", VRF mode, one player, two soundings. Once the legacy task was registered, no client transaction touched the hunt again. The scheduled task's ticks closed it at the deadline and finalized it, and the Magic Action paid out.

| Step | Layer | Transaction |
| --- | --- | --- |
| create_hunt | Solana | [`kPi3Gu8a…`](https://explorer.solana.com/tx/kPi3Gu8aK17Ck41gxWfwg3geX9MhN5dMaLyKUiagYnnksgfZswfFwuEFCx7UqEd7UegxrRnXAF1sEU8E6C53vwf?cluster=devnet) |
| delegate_hunt | Solana | [`5veLJzNX…`](https://explorer.solana.com/tx/5veLJzNXv9ri2c8NWqxu6pFb2GkKLfRQsMGBFDQz2ryW6TsZqrNYCV1qWRzXJkvqGWrfJTw12k7cXKjHP3f1ioqA?cluster=devnet) |
| open_hunt / arm | rollup | `3pRxdZnjHiwvvwi7YzEMWaCP5wop9uddxCGcsR8mZGQFDZxyFmrDjPf9fr2VX5gGkC1krSjLWDJm9XEBv7qFJGG1`<br>`44AnKGv4ipRL2Sc4jwa86uZQZyjHqKcEX5z9Rx8azsVmyv8M2ewYri9ETx5ei98foNQ9C9khyh5MHVMuKsUCa8uC` |
| commitment on Solana | Solana | [`3nYdXh1q…`](https://explorer.solana.com/tx/3nYdXh1qCUskecCe4hdUWo7rbpp14dvKPBSpdLU3WN6vL7XTZVvKuVDHrUaCw7Edkoe6Cs6325ZfqFydiuSdjLVK?cluster=devnet), fee payer = TEE validator |
| schedule_tick (Hydra), 09:09:00 | rollup | `7yyn4JSEeHHnG9BiutwQGw2AwA7mWcpnejZzgpjqUXH8uP7kyE4GiKbHLgLeVvVdpZmFMJTRSWoWzMYosMiotAN` |
| join | Solana | [`auSBvBco…`](https://explorer.solana.com/tx/auSBvBcoFdfFbyMK4Txb2MGk3bRLB1PYN1d5qG1YdBhBDmEE8i7W5Fmkh8BCmAdiRW6wRXRN4EwK81tBncXDJyG?cluster=devnet) |
| embark, probe, set_course, probe | rollup | `5GXShRHFQUJ1WavyFfMqc2MFzjpkfr2zyorTUwyUdnZM856gBfNf3kTnNyoUKupnRBuYdszyeZE3AuEiVHVVXfHe`<br>`2QUxs9if211op2nDx9QMXdiKaWF3NNN1JmPP2YPMhHMFg7hZwSQUR68q61b76UPqUJSpXTqKeuTdUPQYzAAxhWXW`<br>`mvJJe3ceRquvc6LbRfdYEy3aP64rKs4EXVC2pe2D8mFnyDnC4gavN4ofNKJgWm33jJcBtA5Y6M8AM6YCY9zkZ9u`<br>`43WfoPRM1LLy78Tr972cYYYthJGUxECFcgaCM5v3N5DDNVJ7YhmzV4eQPSpxgJA8x3ztGFr7PwDwpp92L5NCtTYH` |
| schedule_tick_legacy, 09:15:45 | rollup | `YCt3jiFAm2NXaEut56EFUtW8quR1zvT5PZpwfZ83D7woLdg2wEnuFUJqT7JsnsM29dE9BHt1xhUDPPwZ4PWX1Jh` |
| first scheduled tick | rollup | `3vD7v8hzg4WGBLLm5r9GANL38FysSWFbEr6szzfS7vUujD4H3A7XNpXgpxeM5Lv3RMXm1jH5ki3q7kRfocWQknMh` |
| scheduled tick that finalized the hunt | rollup | `4HcekdzJFniRKvBfLkWgdMrHfcrT2rYE8j5rGTopnSLmYeXMB9ak4mdL6ibGLtED8Y6CH33HBfHVi6Ym5APhrfGi`, logs "ScheduleCommit … Scheduling undelegation for accounts: AoKR7…" |
| payout via Magic Action | Solana | [`2gonGqGg…`](https://explorer.solana.com/tx/2gonGqGg2MWqkESTdjKSAsuGmffz1bdVeDj5jtrQT8pA65izMvqjtdTVtZFhu4EEDHbCGJXM6vpG69STxqiEvHMG?cluster=devnet), fee payer = TEE validator, "settled: prize 1000000 creator 0" |
| audit | anyone | `npx tsx scripts/verify-hunt.ts AoKR7rx5v7t8otjrht5B4yC5SXvVVQgRm1EJh7iogD4C`: status closest, 2 re-measured, 0 mismatches, `VERIFIED` |

Every scheduled tick has the TEE validator as fee payer and runs through the validator's crank program ("Executed crank with 1 instructions"). In the 6 min 45 s between the Hydra registration and the legacy registration, no tick ran. After the legacy registration, 96 scheduled ticks succeeded. Another 11 ran after the hunt had left the rollup and failed harmlessly (`InvalidWritableAccount`).

The crank test suite showed the same split on two more hunts:

- **Hydra**, hunt `YPpLdcrig8LWZXuPqFo5okkSkAfdSBuEX1hjDfyWw3a`: "zone stage after 23 s with nobody sending tick: unchanged".
- **Legacy**, hunt `HhqMnWS1aBNaydZULbusyZ65QxeaTibruke8MYBe9Cqi`: "zone stage after 23 s with nobody sending tick: 1", "zone stage 2", then "void hunt finalized by the scheduler and refunded through the settlement action". The refund is [`2S6E74sV…`](https://explorer.solana.com/tx/2S6E74sVnYkpgFDo2YdsJjLnd2M5qTL9fPNjFi7PZcw33eB92cvTYCNfCxUCWPuH8acV2Be1EPfPYBe6ZDTNBjgm?cluster=devnet). Hunt `3dGKKQUEeMhLosZrDACQx5K2h2hCoXiwvE3qdNAJKLMP` repeated it on a later binary, refund [`2EyawMHg…`](https://explorer.solana.com/tx/2EyawMHg142Fe64oRFYjtu22sD45Sj7wDCWALAnpzHaWWHoggLVJQLe4Yi6BGQ9vcFRL93PYcSHH6uVB7h6Z22t7?cluster=devnet), log "settled: prize 0 creator 1000000".
- We inspected one Hydra crank, `3FLyX9B5uL8QtAmL1YuLUruusSktzwjQxmHnddAxc9Eo`: "executed 0, next_exec_slot 504148693 while the rollup was at 504663873 (515180 slots overdue)". A manual Hydra trigger sent by an ordinary wallet ran it: `46RPVPsGsDfSZZrBWuSabtqRbYyDTPAsT59VGubsCXv4vRpdP6FtoJ7sy8tV2Sd9469q2tsK4qujNRcvVraXNeHm` (rollup).

### VRF output re-derived

Hunt `DEVCzeQqKQhiexJn2uiRumm1sesoY346eVfRK2bUZuT5`, closest sounding wins:

| Step | Layer | Transaction |
| --- | --- | --- |
| create_hunt | Solana | [`4FZdXU5x…`](https://explorer.solana.com/tx/4FZdXU5xNWozoCa4t1fW1vb9ig1KUUf6aMw8SNPZHx3R397Ks13uNm1826hsyDVR1zKo4orvbuzuiHteZbuDpp6r?cluster=devnet) |
| delegate_hunt | Solana | [`ehFsTxae…`](https://explorer.solana.com/tx/ehFsTxaeWqZWHePmB3aKPZWKXx2ypNXJ2dpRn5ddjsP4Xt8PayyUUG6pKDAGS56Gs84MAxB1qWEDzFU8WtkXMdH?cluster=devnet) |
| tick after the deadline | rollup | `4FcfRfqPpfT8PZhVyGxC9vf5xfDeMbPpHfLUJiahUhbLpst7uo2PZoNqRRGZQUszrDADN65buQCK1aoXJkR86bbH` |
| finalize | rollup | `vBdjmo7FvgDf46THnYAc2Ux7ki51hNAJKb6Gic5m4tV7XEJgSBixYLEhc32LPyF727mWmtdUhZgNDQb9MESGqwA` |
| payout to `CQb85TQUCntFYQnXR28rrMMYjTHL1HozwMhXE45HzyEY` | Solana | [`44iT425P…`](https://explorer.solana.com/tx/44iT425PVoBejD81v8mJpp5Y2P1Xi78qY5RWKZB8CgAN3QsjZAb9fcRqzW8M3huYxfoydbwcHsDDxBA3yAZgSA6C?cluster=devnet), "settled: prize 29500000 creator 500000" |
| open_treasure | rollup | `5dZU7uwuH3wfTAX93qJvUsnVqY86iRZ6QVVG4MydaAGDsfFFkYjsimAms5iz9CvH6bU4nenN9KDyADtHpmPnt29A` |

Recorded: "VRF output `779748f2b5f5d6f8393aa32c0f80c94606e7a08a2d6257b04ed0551e1e142718` re-derives the location, salt, zone seed, commitment and 2 zone centres" and "winner is the sounding with the greatest dot product; every hint matches the revealed location". Hunt `FnFXunZVv5RBHWyTM1dVcDovyxuXjMUuFnEYqMdzqukm` repeated it with VRF output `c19fc215fb1b72e7e809a9442481a539bcf978e1c50c006276aceb7e62973674`, payout [`4yGb9pH5…`](https://explorer.solana.com/tx/4yGb9pH5TM6ffT3HiNojDRgfYZGpJYdc25NMWGFXwvQFUeNHYUB1TziPBkTJp2v3tm2giLK3wEaafRwPx8Ppo8JK?cluster=devnet).

## 5. Privacy observations

These are the literal results of the reads, as recorded.

**Confidentiality surface on the final program**, author hunt `J2pyqJETSuXzJL6vL1H1bx8G87B5FynyjQc81SGfviPe`, from `tests/confidentiality.test.ts`. The observer key `Cxzp6nMdP33opqbeBsTCJ7Ge7hRter9bAFTpYmLfeyac` is no member of anything. While it watched, alice moved and took a sounding.

| handle (observer token / no token, same result) | treasure | alice's logbook (embarked) |
|---|---|---|
| getAccountInfo, also with dataSlice | null | null |
| getMultipleAccounts with the public hunt | null (hunt: 520 bytes) | null |
| getProgramAccounts(program) | not listed (121 listed) | not listed |
| getBalance | 0 | 0 |
| getSignaturesForAddress | 0 entries | 0 entries |
| accountSubscribe during a sounding | 0 notifications (board control: 2) | 0 notifications |
| programSubscribe during a sounding | 0 for it (board 2, hunt 2) | 0 |
| logsSubscribe(program) | 0 notifications, also for public transactions: uninformative | — |
| getTransaction(sounding sig), json/jsonParsed/base64 | slot + blockTime + err only; 0 keys, 0 instructions, 0 logs, 0 inner, CU 0 | same |
| getSignatureStatuses(sounding sig) | slot, finalized, Ok | — |
| getBlock(slot of the sounding) | "Access denied" | — |
| getSignaturesForAddress(public board) | the sounding is not listed | — |

Member control: alice (owner, challenge-signed token) and her session key read her logbook (2 entries); bob gets null.

The suite also records what an observer can still learn: sounding time and position are public by design; anyone holding a private transaction's signature learns its slot, block time and success; private account addresses derive from public seeds but read like missing accounts; a logbook is readable (empty) until its owner embarks; getProgramAccounts filtered by logbook size returned 18 public logbooks (opened after hunts, or not yet embarked).

**The treasure, sealed VRF hunt `7NY1NWecGrP5ihL7zDaVUp3vJaBgQ6TnDWf3hnCgGD5z` (first deployment):**

- getAccountInfo(treasure) without token: `{"status":200,"jsonrpc":"2.0","id":1,"result":{"context":{"slot":503866688},"value":null}}`
- getAccountInfo(treasure) as outsider: `{"status":200,"jsonrpc":"2.0","id":1,"result":{"context":{"slot":503866760},"value":null}}`
- getAccountInfo(treasure) as creator: `{"status":200,"jsonrpc":"2.0","id":1,"result":{"context":{"slot":503866783},"value":null}}`
- getSignaturesForAddress(treasure) without token: 0 signatures
- getSignaturesForAddress(treasure) as outsider: 0 signatures
- getMultipleAccounts([hunt, treasure]): hunt = 520 bytes of data; treasure = null. (control and target in one call)
- getProgramAccounts(program): 12 accounts, hunt listed, treasure not listed.
- getBalance(treasure): 0 (account holds 1708008 lamports on base).

**The treasure on the binary of sections 2 to 4**, VRF hunts `5rJPsDwKccMvWtVQh7kZfN8kNz6wUDxcF8rEddxBya8g`, `9jy9x9oPgvFYS3oYNWThBqQGoTyUVLF1eYPrzNJEQPdb`, `DEVCzeQqKQhiexJn2uiRumm1sesoY346eVfRK2bUZuT5` and `FnFXunZVv5RBHWyTM1dVcDovyxuXjMUuFnEYqMdzqukm`, identical in each:

- getAccountInfo(treasure), no token: `null`
- getAccountInfo(treasure), outsider token: `null`
- getAccountInfo(treasure), creator token: `null`
- the copy of the treasure on Solana still holds its unsealed creation state

**Blocks and transactions during play**, timed VRF hunt `9Qh9SNxgbWJNz2GWdhEzVkVC92YMuTJZ2a5avqrko2of`:

- getBlock for each of the 218 slots 503883681..503883898: `"Access denied"` for anonymous, outsider token and creator token (0/218 blocks served to anyone).
- getTransaction(open_hunt sig) as anonymous / outsider / creator: result present, message has 0 account keys, 0 instructions, 0 log lines, no error. Same for the signer.

**A logbook**, author hunts `DcVPRKrFwVtrzJjAybd9m6Xxj3oj7VMzwjpU4fxXWCGu`, `94MkkeqYUPAihtqDiSGJE1Mcu53VGW3KsJahwesgtpZo`, `63zkiyvy3sgRqRGFSumvCWAWScad1obpHjhLDQmpQbWZ` and `3K6dsgdJf294uVLXDMaoEVNkjxG4zdLxs9hNjPcsQVUG`, identical in each:

- getAccountInfo(alice's logbook) as her owner key: 1455 bytes
- getAccountInfo(alice's logbook) as her session key: 1455 bytes
- getAccountInfo(alice's logbook) as the other player: null
- getAccountInfo(alice's logbook) as the other player's session key: null
- getAccountInfo(alice's logbook) as the hunt creator: null
- getAccountInfo(alice's logbook) as an outsider: null
- getAccountInfo(alice's logbook) as nobody (no token): null

**What is visible, by design or by the rollup's behaviour:**

- Hunt and board are readable by anyone.
- The validator's clone transactions (`54fV3Y…` for the program, `3Srju4…` for the hunt) are fully readable anonymously, including logs (lamports, owner, data_len).
- Simulation errors pass through. On unsealed author hunt `HxdNvLQczyKthJVEWZtX3FDnpA8PUBUA2nRjnmtijxBM`, a simulated `arm` gave the outsider and the creator alike `err={"InstructionError":[1,{"Custom":6003}]}`, 0 logs, unitsConsumed 0, hunt post-state null. Section 6 covers what we did about it.

## 6. Simulation side channel: found, fixed, checked

**First deployment**, author hunt `4JWfBqPhMhxGeuoM3DyQxFjr5VcDAvFczifDPLYuBJN5`, treasure at lat 41.9028 lon 12.4964, `simulateTransaction` only:

- player simulates [embark(at the treasure), probe, probe]: `{"err":{"InstructionError":[3,{"Custom":6011}]}}`
- player simulates [embark(12 km away), probe, probe]: `{"err":{"InstructionError":[3,{"Custom":6011}]}}`
- player simulates [embark(1100 km away), probe, probe]: `{"err":{"InstructionError":[3,{"Custom":6018}]}}`
- player simulates [embark(antipode), probe, probe]: `{"err":{"InstructionError":[3,{"Custom":6018}]}}`
- same triple at the treasure, fee payer = outsider, pilot signature absent: `{"err":{"InstructionError":[3,{"Custom":6011}]}}`

So the first deployment gave a free yes/no answer to "is X within 50 km?". The next upgrade (08:48) removed it.

**Before the compute fix**, author hunt `7ujLKE1m8rGVexjSLHWf3UnC1xt16MExdwzPD5vyjqtE`:

- smallest compute budget for one probe of the same ship: 25435 CU at the treasure, 25433 CU and 25433 CU at two far points

**After the fix**, author hunt `9iofVExB7Qd7PkZHreQL4TZBxVeETco7BMQgDF6cC4Fd`, from `tests/simulation-oracle.test.ts`:

- [embark, probe, probe] by a player: at the treasure `{"InstructionError":[2,{"Custom":6018}]}` / far away `{"InstructionError":[2,{"Custom":6018}]}`
- [embark, probe, probe] paid by an outsider without the pilot's signature: at the treasure `{"InstructionError":[2,{"Custom":6018}]}` / far away `{"InstructionError":[2,{"Custom":6018}]}`
- [probe, probe]: at the treasure `{"InstructionError":[2,{"Custom":6018}]}` / far away `{"InstructionError":[2,{"Custom":6018}]}`
- [probe, tick]: at the treasure `null` / far away `null`
- [probe, tick, finalize]: at the treasure `{"InstructionError":[3,{"Custom":6020}]}` / far away `{"InstructionError":[3,{"Custom":6020}]}`
- [probe, finalize]: at the treasure `{"InstructionError":[2,{"Custom":6020}]}` / far away `{"InstructionError":[2,{"Custom":6020}]}`
- smallest compute budget, same ship, [probe]: 25442 CU at the treasure, 25442 and 25442 CU at two far points
- smallest compute budget, same ship, [probe, tick]: 46891 CU at the treasure, 46891 and 46891 CU at two far points
- member simulates a probe and asks for its logbook's post-state: err `null`, logs 0, post-state `null`
- after all simulations: hunt live, 0 probes, 0 pins, logbook entries 0

**On the final program**, author hunt `5k7DfsZqMxvexKmqx5tv1cDjFbJM2n3Y74JgoKfofeaA`: the same six error comparisons were identical, and

- smallest compute budget, same ship, [probe]: 25534 CU at the treasure, 25534 and 25534 CU at two far points
- smallest compute budget, same ship, [probe, tick]: 47075 CU at the treasure, 47075 and 47075 CU at two far points

## 7. Transactions that fail on purpose

Executed with preflight off, so they landed and failed:

| What | Layer | Signature | Result |
| --- | --- | --- | --- |
| `open_hunt` and `arm` in one transaction: arm before the VRF callback, hunt `FCvW6DJetZq1sPvEPg49XeVXBebTZPaKpEcX5Sbsvhq8` | rollup | `5pG4UjE3ou8Siz3qiLcFyfJBXBxzJpFrwqdWUoKHAJSPRGQQrCfWA6eMXK9M6isSbSBVxfPfckYczQbadgPvUjYM` | `{"InstructionError":[2,{"Custom":6003}]}`, `NotSealed` |
| the same on the first deployment, hunt `5cmENn2TgYbPyZKnaTh9Kb7QT1YPaeKp4Rim59H2uiaa` | rollup | `r5EmZEhP42rEBDWUEHFPXynQxZT1MQvcPnfE6TWZP9j4bSbJXvQWCK7cYbHV1BfvDmA9BU1tDoGDHZzbseDs6UC` | `{"InstructionError":[2,{"Custom":6003}]}` |
| the 65th sounding of one ship, hunt `Cq53hSNJDerFhMhgbwenPUeZThXP7kPEwAWjptfGvgkq` | rollup | `3QStMpgwgkuQEkTguKt6SHnQjZPXgzS9fR1KiRJWbjX1ZviYMGhwRfUy4n9xRmoqdQWJkMqSp3qykFrzT185LQn8` | `ProbeLimit` (6019); the rollup returns the error with 0 log lines, because the logbook is still private |

Failures that weren't planned, but which the design expects:

- `2rP6gCC1jHJoDPkFR3HDWwnuYeyn7ESga8SUoUeo1czAekYcksEJD1YdjfoRxrDfNELNp6kEm6LpTbXYykKzdzSn` (rollup): a bot's `set_course` right after the strike in section 2 became public, `NotLive` (6011).
- `4kPQB1XTyCgNTgBzkut4nA7tFLpywmHWgjGNEazZhqz4hZ6bX923ybtH25EghwfzKD3HyhPVTEXgg9TXWuKZ6s2y` (rollup): a scheduled tick that fired after the hunt in section 2 had returned to Solana, `{"InstructionError":[1,{"Custom":3007}]}` (`AccountOwnedByWrongProgram`).

Refused at preflight, with no signature, from the refusal suite on hunt `Cq53hSNJDerFhMhgbwenPUeZThXP7kPEwAWjptfGvgkq`:

- create_hunt with a 25 % creator cut: `InvalidParams`
- seal_from_author again after arming: `WrongStatus`
- seal_from_author signed by someone other than the creator: `ConstraintHasOne`
- arm a hunt that is already live: `WrongStatus`
- seal_from_vrf signed by an ordinary key instead of the VRF identity: `ConstraintAddress`
- join a full hunt: `HuntFull`
- probe before embarking: `NotEmbarked`
- embark at a vector that is not a unit vector: `NotUnitVector`
- embark someone else's airship: `NotPilot`
- embark twice: `AlreadyEmbarked`
- probe right after embarking: `Cooldown`
- probe someone else's airship: `NotPilot`
- set a course for someone else's airship: `NotPilot`
- probe while in flight: `InFlight`
- change course while in flight: `InFlight`
- set a course and probe in one transaction: `InFlight`
- probe again during the cooldown: `Cooldown`
- finalize a live hunt: `NotEnded`
- open a logbook before the reveal: `NotRevealed`
- release the board before the reveal: `NotRevealed`
- settle on Solana while the hunt is still delegated: `AccountOwnedByWrongProgram`
- close the board while the hunt is still delegated: `AccountOwnedByWrongProgram`

## 8. Encrypted author placement

In Author mode, the SDK puts the creator's location and salt inside the delegation as a post-delegation action. The action is sealed to the TEE validator's key (a libsodium sealed box to the X25519 form of the validator identity). The validator decrypts it and runs `seal_from_action` inside the rollup. Hunt `7tGEKMaC5FZJ4WaU91xnhjuBp98AcABto7qggUiupn5K`, on the final program:

- create_hunt (Solana): [`4t2sLQ7U…`](https://explorer.solana.com/tx/4t2sLQ7UFgHqsjMeo29gYE7tMhBhLzNjjpQRjp5R8TWzvkgt2qBtLHa77cLKjRi2gPMRMrgkKLfkQ3kVeRKDdVqJ?cluster=devnet)
- delegate_hunt_sealed (Solana), 424 bytes of instruction data: [`ZSF9ix4W…`](https://explorer.solana.com/tx/ZSF9ix4WHB7dNMCJKTuj52CTNgwDNiADPaHLtKuDiRUTry1uL3uLr2495frN8BBbFuJzh7Kb2exA88oWj33NYqj?cluster=devnet)
- "location in the Solana transaction: false; in the delegation record (500 bytes): false"
- "location as entered in the Solana transaction: false; in the delegation record (500 bytes): false"
- "salt in the Solana transaction: false; in the delegation record (500 bytes): false"
- arm, accepted once the action had run (rollup): `62Nsp77V8Bbr766pqbyuhNQRWe23JPgGx2gDgWQw8nk2mTHypvqQc8LPPfWe8pQFCBaTHYLkDT3inqLuXKkDgDco`
- "the commitment on Solana matches the creator's location and salt, so the validator decrypted and ran the action"
- "the sealed treasure reads as null without a token, with the creator's and with an outsider's"
- "1 rollup transactions naming the hunt fetched as an outsider (base64 and json): none carries the location or the salt"
- "revealed on Solana after the end: [671142510,-630476260,-389958224]"
- board and treasure closed (Solana): [`FDCP9Mxz…`](https://explorer.solana.com/tx/FDCP9Mxzhn3ejqchT857rbCrMFQnzk1e2JQSEktwCHw4riyVEL8E54cyFcDmhcJ1TiPRZerCzrkwbqUWBfDyJLM?cluster=devnet)

The first attempt, hunt `5y3Yzi5ogEtSYD3bmp1Zve8v3S3hiioncrqAu4vKCgjx`, failed with `InstructionFallbackNotFound`: the validator dispatched the action about 28 s after the upgrade landed, most likely while it was still running the previous program. The validator returned the treasure to Solana unchanged in [`5sghUCs8…`](https://explorer.solana.com/tx/5sghUCs8XQZjVVubzamQWBBdwc6skUjwGmdeVnfRoZabkrxkdCd6vJBH9idHfrYNcvHyMXgVJ1BAGi6ibpCFPvov?cluster=devnet). Its logs showed that the validator had decrypted the arguments and dispatched to our program.
