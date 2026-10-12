# @terra-incognita/hunter

A solver that plays Terra Incognita, four bot personalities built on it, an in-memory hunt to
play them against, and a client that lets them play real hunts on chain.

A probe tells a player one thing: which of eight distance bands the treasure is in, seen from
where the ship is. The solver turns a logbook of such answers into the next place to probe.

## How the solver thinks

**Belief.** The places the treasure can still be are represented by a few thousand sample
points spread evenly over them. At the start that is a Fibonacci lattice on the whole globe.
Every sounding is an annulus around the probe position, every published zone stage is a cap;
each one removes the samples it rules out, and the set is topped back up by rejection sampling
inside the region that is left: within the tightest single constraint while the region is
continental, within an oriented box around the survivors once it is compact. The samples
therefore follow the region all the way down. When it is a few kilometres across, far below the
50 km strike radius, there are still thousands of points inside it, and new points are always
checked against every sounding, so the belief never contains an impossible place.

**Choice.** For each candidate position the solver splits the belief by the band every sample
would produce there. A strike ends the hunt; any other band leaves a smaller region, whose
area gives an estimate of the probes still needed and whose distance says whether another
flight will be. The score is the expected time to a strike after the probe plus the time the
probe itself costs (flight or cooldown, whichever is longer): information gain discounted by
travel. Candidates are samples of the belief, points whose band edges cut through the middle
of the region, hops short enough to fit inside the cooldown, a coarse global lattice while the
region is still large, and the places rivals point at. The best one is improved by a short
local search.

**Personalities** are parameter sets for that one solver:

| | |
| --- | --- |
| `SURVEYOR` | Methodical. Barely counts flight time, so it flies wherever a probe tells the most and needs the fewest probes. |
| `SPRINTER` | Greedy. Counts every second in the air, keeps to hops that fit inside the cooldown and pays for the speed with more probes. |
| `SHADOW` | Opportunist. Runs its own search and gives extra belief to places where a rival's last pins sit close together, as long as its own logbook does not rule them out. Pins are public; bands are not. |
| `WANDERER` | Deliberately poor. Remembers only its last three soundings and picks among candidates almost at random. |

## Use

```ts
import { auditHunt } from '@terra-incognita/core';
import { SimHunt, Solver, SPRINTER, SURVEYOR, runHunter } from '@terra-incognita/hunter';

const sim = new SimHunt({ randomness: crypto.getRandomValues(new Uint8Array(32)) });

// One hunter: the clock jumps whenever it waits.
const result = await runHunter(sim.join('alice'), new Solver(SURVEYOR, 42));
// e.g. { outcome: 'struck', probes: 10, finishedAt: 1760000044, status: 3 }

// Several hunters on one clock.
const race = new SimHunt({ randomness: crypto.getRandomValues(new Uint8Array(32)) });
const bob = race.join('bob');
const carol = race.join('carol');
await race.play([
  () => runHunter(bob, new Solver(SURVEYOR, 1)),
  () => runHunter(carol, new Solver(SPRINTER, 2)),
]);
auditHunt(race.reveal()).allOk; // true
```

`runHunter` works against anything that implements `HuntClient`:

```ts
interface HuntClient {
  readonly player: string;
  now(): Promise<number>;
  getPublicState(): Promise<PublicState>;   // status, zone, ships, pins, deadline, speed
  getMyLogbook(): Promise<LogEntry[]>;
  embark(start: Vec3): Promise<void>;
  setCourse(dest: Vec3): Promise<void>;
  probe(): Promise<LogEntry>;
  sleepUntil(ts: number): Promise<void>;
}
```

`SimHunt` implements it in memory and enforces the rules of the program: flight time from the
chord, no new course and no probe while in the air, a 3 s cooldown between probes that already
runs from embarking, 64 probes per ship, a ring of the last 128 public pins, the zone schedule,
a strike within 50 km, and the closest sounding at the deadline (the earlier one on a tie, void
if nobody probed). Positions are stored in canonical form, as the program stores them. A strike
is recorded privately and only becomes public at the next tick; the simulator ticks before
every action and read. Its clock is virtual and counts whole seconds.

The solver itself is synchronous and has no notion of a client: `solver.nextProbe(view)` takes
the public state and a logbook and returns a position, so a belief can be rebuilt from a
logbook at any time. Anything with `chooseStart` and `nextProbe` is a `Strategy` and can be
driven by `runHunter`.

## On a real hunt

`ChainHuntClient` implements `HuntClient` with `@terra-incognita/sdk`: public state from the
rollup, the logbook through the player's session key, every move a rollup transaction. The
same solver that plays `SimHunt` plays a live hunt through it:

```ts
import { Keypair } from '@solana/web3.js';
import { PlayerSession, TerraClient } from '@terra-incognita/sdk';
import { ChainHuntClient, SURVEYOR, Solver, runHunter, runChainBots } from '@terra-incognita/hunter';

const client = new TerraClient();
const { session } = await PlayerSession.join(client, wallet, hunt);
await runHunter(new ChainHuntClient(session), new Solver(SURVEYOR, 7));

// Or several bots from funded keys, with a keeper that ticks the hunt while they play.
await runChainBots(client, hunt, [
  { name: 'ana', owner: Keypair.generate(), personality: 'surveyor' },
  { name: 'ben', owner: Keypair.generate(), personality: 'sprinter' },
]);
```

After a strike the client ticks and finalizes the hunt itself, and it closes a hunt whose
deadline has passed, so a game always ends even without a crank. Program errors arrive as the
same `HuntError` codes the simulator throws.

`test/devnet.e2e.test.ts` plays three bots against each other on devnet, waits for the payout
and audits the hunt. It only runs with `TERRA_DEVNET=1` and a funded `deployer.json` in
`TERRA_KEYS_DIR`.

## Benchmark

`npm run bench -w @terra-incognita/hunter -- --hunts 1000` plays simulated hunts at 800 km/s
with the 3 s cooldown, which starts at embark. 1000 hunts per row, seed 1:

Solo, zone off, no deadline

| personality | struck | out of probes | probes: p10 / median / mean / p90 / max | seconds: p10 / median / mean / p90 / max |
| --- | --- | --- | --- | --- |
| surveyor | 100.0% | 0 | 8 / 10 / 10.1 / 12 / 17 | 31 / 48 / 46.5 / 60 / 78 |
| sprinter | 100.0% | 0 | 9 / 13 / 13.6 / 18 / 24 | 29 / 42 / 42.3 / 57 / 73 |
| shadow | 100.0% | 0 | 8 / 10 / 10.4 / 13 / 16 | 30 / 45 / 44.0 / 58 / 74 |
| wanderer | 91.8% | 82 | 13 / 27 / 29.6 / 51 / 64 | 70 / 138 / 151.0 / 251 / 390 |

Race, one of each in the same hunt, zone stage every 60 s, deadline 900 s

| personality | wins | probes per hunt |
| --- | --- | --- |
| sprinter | 40.6% | 10.6 |
| shadow | 33.9% | 7.1 |
| surveyor | 25.1% | 6.2 |
| wanderer | 0.4% | 3.9 |

Every race ended with a strike; the winning strike came after a median of 34 s.

Reading the numbers: locating a 50 km cap on the globe takes about 16 bits. A probe yields at
most 3 and the first one about 1.6, so ten probes is close to what the bands allow. The sprinter
is only about four seconds faster than the surveyor on its own, but it wins the most races.
The wanderer runs out of probes in 8% of its solo hunts; "out of probes" means all 64 were
spent without a strike. Probe and second statistics cover the hunts that ended with a strike.
With the zone on, the first three finish before the zone matters and their solo numbers do not
change; the wanderer strikes 94.5% of the time. Following rivals changes where the shadow flies
more than how often it wins: with its rival weight set to zero it won 31.4% of 500 such races,
against 33.4% with it, a difference inside the noise.

## Develop

```sh
npm install                                # from the repository root
npm run build:packages                     # core, sdk, then hunter
npm test -w @terra-incognita/hunter
TERRA_DEVNET=1 TERRA_KEYS_DIR=<dir> npx vitest run test/devnet.e2e.test.ts   # from packages/hunter
```
