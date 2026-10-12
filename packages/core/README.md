# @terra-incognita/core

The rules of the globe, in integers.

Terra Incognita hides a treasure inside a private rollup and tells each player only how far
away a probe was, as one of eight distance bands. This package is the geometry behind that:
positions as fixed-point unit vectors, band and zone tests, travel times, the commitment to the
treasure's location and the derivations from VRF randomness. The on-chain program implements
the same functions with the same tables, and the two agree bit for bit. Anything that needs to
predict or check what the program does (the SDK, the web app, the hunter bots, the audit
script) uses this package.

It has no chain dependencies and runs in the browser and in Node. The only dependency is
`@noble/hashes` for sha256.

## Use

```ts
import {
  fromLatLon, bandBetween, travelSecs, inZone, commitment, auditHunt, BAND_NAMES, render,
} from '@terra-incognita/core';

const lisbon = fromLatLon(38.72, -9.14);      // [770305874, -123934644, 625515040]
const recife = fromLatLon(-8.05, -34.88);

const band = bandBetween(lisbon, recife);     // 6
BAND_NAMES[band];                             // 'cold'
travelSecs(lisbon, recife, 800);              // 8 seconds at 800 km/s

render.distanceKm(lisbon, recife);            // 5841.65 (float, for display only)
```

## What is exact and what is not

Everything exported from the package root except the `render` namespace is integer arithmetic
(`bigint` where a value can exceed 2^53) and matches the program:

| Function | Result |
| --- | --- |
| `isUnit(v)` | `\|x² + y² + z² − 1e18\| ≤ 4e9` |
| `dot(a, b)` | `bigint` at scale 1e18 |
| `bandOf(dot)`, `bandBetween(a, b)` | number of `BAND_COS_E18` thresholds the dot product is strictly below, 0..7 |
| `chordE9(dot)` | `isqrt(2 · max(0, 1e18 − dot))` |
| `travelSecs(a, b, speedKms)` | `max(1, ceil(chordE9 · 63710088 / (1e13 · speedKms)))` |
| `inZone(p, zone)` | stage 0: true; otherwise `dot(p, center) ≥ ZONE_COS_E18[stage − 1]` |
| `zoneStageAt(now, startsAt, interval)` | `min(8, floor((now − startsAt) / interval))`, 0 before the start or without an interval |
| `normalize(v)` | each component `v · 1e9 / isqrt(\|v\|²)`, rounded half away from zero |
| `unitVectorFromDigest(d)` | rejection sampling, see below |
| `locationFromRandomness(r)` | `unitVectorFromDigest(sha256(r ‖ "loc"))` |
| `saltFromRandomness(r)` | `sha256(r ‖ "salt")` |
| `zoneSeedFromRandomness(r)` | `sha256(r ‖ "zone")` |
| `zoneCenter(loc, seed, stage)` | `normalize(loc · 1e9 + s · u)` with `u = unitVectorFromDigest(sha256(seed ‖ stage))`, `s = ZONE_SIN_E9[stage − 1] · 999 / 1000` |
| `commitment(hunt, loc, salt)` | `sha256("terra-incognita:v1" ‖ hunt ‖ x ‖ y ‖ z ‖ salt)`, coordinates as little-endian i32 |
| `auditHunt(input)` | checks a reveal against the commitment and every logbook band against the revealed location |

`unitVectorFromDigest` reads three little-endian i32 from the first 12 bytes of the digest and
maps each onto the cube with `v · 1e9 / 2³¹` (truncated toward zero). The sample is accepted
when `1e14 < x² + y² + z² ≤ 1e18` and normalised as `normalize([x · 1e9, y · 1e9, z · 1e9])`.
Otherwise the digest is replaced by its sha256 and the next sample is tried, 32 digests in
all, after which the result is the north pole `[0, 0, 1e9]`.

`fromLatLon` and `toLatLon` convert to and from degrees with floating-point trigonometry. The
program never needs them; it accepts any vector that passes `isUnit`.

`render` (also importable as `@terra-incognita/core/render`) holds float helpers for drawing:
`shipPosition(ship, t)` interpolates along the great circle, `distanceKm`, `bandRadiiKm`,
`capOutline`, `zoneOutline`, `bandOutlines`, `slerp`, `destination`, `toFloat`, `fromFloat`.
None of them decides anything.

## Test vectors

`vectors/geometry.json` holds reference results for the exact functions: 29 band cases, 318
point pairs, 53 travel times at other speeds, 64 unit vectors, 64 randomness derivations with
commitments and 192 zone centres. The program's tests load the same file. Every band threshold
is covered exactly and one unit either side, both as bare dot products and as real point pairs
whose dot product hits the threshold.

The file is deterministic and involves no floating point. The header of
`scripts/generate-vectors.ts` documents the format. To rebuild it:

```sh
npm run vectors -w @terra-incognita/core
```

## Develop

```sh
npm install                               # from the repository root
npm run build -w @terra-incognita/core    # tsc → dist/
npm test -w @terra-incognita/core
```
