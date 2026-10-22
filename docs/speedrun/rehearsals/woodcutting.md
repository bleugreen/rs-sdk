# Woodcutting: the cairn_chops fastest-99 rehearsal (S07)

Mission cairn://p/rs/147, entry 3 of STEP-MANIFEST.md. Module: `speedrun/skills/woodcutting.ts`;
lab driver: `speedrun/lab/measure-woodcutting.ts`. History: rs/151 (the module), rs/211 (the
first lab at default stats), rs/236 (the respawn-wait and probe fixes, the route, and the lab
gate), rs/261 (the attempt changes and the demo attempt). Labels: **m** measured, **r** read,
**i** inferred.

## The record and the gate

- **#1 row:** stunwc, 99 at 18:15 playtime, **3,653 ticks** (exact hover; r, hiscores category 9).
  Its player page carries only the 99 stamp, so no level curve or sites can be read from it.
- **Release gate (rs/147 addendum 18):** modelled P(#1) of at least 90% against the #1's exact
  hover ticks, from at least five from-creation lab runs with the final fixes on. The 5% bar
  (3,470) is the planning target.
- **Result: P(#1) = 91%** (central; sensitivity 81-96%), so the attempt is a **record attempt**.

## What the module does on the attempt

From Lumbridge after S00 and the kit (rune axe, knife, 5 logs from cairn_mule2), with
`route=rimmington`:

| Step | What | Lab ticks (m, rs/236 c2-c6) |
|---|---|---|
| walk-oaks | Lumbridge to the Rimmington oak stand (2984,3205), no waypoints | 159-163 |
| normal-1-15 | plain on the normal trees beside the oaks | 27-31 |
| oak-15-73 | knife-cycle `oak` under the in-page gate, trees (2981,3205) (2984,3206) (2985,3203) | 620-661 |
| walk-willows | to the Draynor-west willow stand (3058,3253) | 51 |
| willow-73-99 | knife-cycle `willow`, gated, trees (3057,3251) (3057,3254) (3059,3252) | 2,391-2,583 |

The four changes rs/236 found the attempt needs, made in rs/261:

1. **`measureDrops: 120`** (`MEASURE_DROPS`), passed explicitly to each band's gate (main's 20:08
   ruling: every run-day module passes a value sized to its success chance). Over 30 logs the
   knife's mean has about 13% relative error (0.71/sqrt(30)). That's enough for chop luck to
   read a sound knife as slower than plain's 4.0: rs/236's Taverley chain c1 switched to plain
   at oak 15 (4.46 per expected roll over 30 drops) and at willow 85 (4.09), and finished at
   4,189. Over 120 the knife's ~3.15 is more than 4 standard errors below 4.0, and a knife that
   really is slow is still caught within about 500 ticks.
2. **`route`** with exported `ROUTES`: `taverley` (SITES, still the scored run's default until
   rs/158 says otherwise) and `rimmington`. Each band summary row records the resolved `route` and
   `stand`, and the oak walk's first log line names the route, so a silent fallback to
   Taverley would show.
3. **`lighten` removed.** Infinite run is on, in the lab and (i) on the demo:
   `server/engine/src/util/Environment.ts` defaults `NODE_INFINITE_RUN` to true, `Player.ts`
   `updateEnergy` pins energy, and fly.toml doesn't override it. Every lab walk ended at 100%
   energy, so weight and energy potions are worth 0.
4. **Lab driver:** `walk` and `chain` now set Woodcutting to `--level` (default 1) first. Before,
   a case after `walk` started at 73 and skipped walk-oaks. The driver also uses the module's
   ROUTES and has no potion or refill path.

It also adds the **hit guard** rs/147 asked for. Every hitpoint lost in a walk or band is a 0-tick
`woodcutting:hit` row (tick, tile, hitpoints before and after, the NPCs within 2 tiles). With
`hpStop=4`, a hit to 4 or below aborts the program run or the walk and fails the step, and
rehearse.ts then logs out cleanly. None of these options reaches an in-page program, so
knife-cycle's `params` declaration is unchanged.

## Route safety (rs/236, decided by rs/147)

- **No route out of Lumbridge avoids every aggressive NPC**, Taverley's included: giant spiders on
  the Lumbridge-Draynor road and a highwayman hunt a combat-3 account. All of them have max hit 1,
  and the account has 10 hitpoints (r).
- **Dark wizards:** the nearest is 26 tiles from the willow stand, and their reach is 8 (r).
- rs/147 reads "no route that risks a death" as "no NPC on the route that can plausibly kill".
  Rimmington passes that test.
- In the lab, every chain ended at 10/10 hitpoints (m, five chains).

## Lab gate (rs/236, measured on bgsrv-mac)

NODE_TICKRATE=300, default stats (combat 3, 10 HP), starter items carried in c3-c6, rune axe in
the pack, no bury, 0 catch-ups in every run. Totals are from Lumbridge, then + S00 4 + kit 8 for
from creation.

| run | walk oaks | 1-15 | oak 15-73 | walk willows | willow 73-99 | total | from creation |
|---|---|---|---|---|---|---|---|
| c2 (measureDrops 30, never fired) | 163 | 31 | 620 | 51 | 2,467 | 3,332 | 3,344 |
| c3 | 159 | 31 | 621 | 51 | 2,583 | 3,445 | 3,457 |
| c4 | 159 | 27 | 627 | 51 | 2,413 | 3,277 | 3,289 |
| c5 | 159 | 27 | 641 | 51 | 2,391 | 3,269 | 3,281 |
| c6 | 159 | 27 | 661 | 51 | 2,493 | 3,391 | 3,403 |

**Mean 3,355, sd 75.** c3-c6 ran measureDrops 120 from the lab copy: 0 switch-offs.

### The willow band, decomposed (for rs/158)

All five have 777 expected rolls and 494 logs, with knife share 1.00:

| chain | knife ticks | per expected roll | respawn waits (n, ticks) | per roll, waits excluded | fitted vs formula success | slips |
|---|---|---|---|---|---|---|
| c2 | 2,425 | 3.120 | 9, 63 | 3.039 | 0.616 vs 0.636 | 1 |
| c3 | 2,499 | 3.216 | 11, 86 | 3.105 | 0.614 vs 0.636 | 3 |
| c4 | 2,392 | 3.078 | 6, 72 | 2.985 | 0.621 vs 0.636 | 0 |
| c5 | 2,370 | 3.050 | 11, 68 | 2.962 | 0.628 vs 0.636 | 0 |
| c6 | 2,451 | 3.154 | 9, 60 | 3.077 | 0.617 vs 0.636 | 1 |

- **The cadence is 3 on the lattice.** Off-lattice log gaps add only 4-34 ticks per band.
- **Respawn waits** cost 60-86 ticks per band at the lab's D=29 (one player online).
- **The success fit runs 1.3-3.6% under the formula in every chain**, and oak 60-73 reads
  0.85-0.99 where the formula is capped at 1.0. So this is systematic, not luck. (i) A felled
  tree costs the knife a cycle while it moves to the next tree. That is a model term, not a
  client loss.
- **Probes are 20-21 ticks each**, against 47 before the `dirs` fix. Slips come from honest miss
  streaks that trip the 18-tick lock window: 0-3 per band, about 21 ticks each.

### P(#1) model (rs/236)

Monte Carlo inputs, every one stated:

- **Lab total:** N(3,355, 85), the measured sd inflated for n=5. Chop-luck sd from geometric rolls
  over the measured logs per sub-band is 65.
- **Demo knife slowdown on ~3,000 knife ticks:** 1.5% ± 1.5%, from cairn_casts' demo gap-3 share
  (79.6%) against the lab's 81.6%.
- **Demo probes and slips:** + N(40, 30).
- **Gate-off stretches:** Poisson with λ = 0.3, each about 130 ticks.
- **Relog:** 5% chance of + 20.

The central result is **P(#1) = 91%, p10/p50/p90 = 3,330 / 3,473 / 3,643**. Break-even is
about 7% demo knife slowdown at λ = 0.3.

| slowdown | λ 0.1 | 0.3 | 0.6 | 1.0 |
|---|---|---|---|---|
| 0% | 98.5 | 95.4 | 89.2 | 79.3 |
| 1.5% | 96.0 | **91.1** | 82.9 | 71.1 |
| 3% | 87.4 | 81.4 | 72.1 | 60.3 |
| 5% | 76.0 | 69.0 | 59.1 | 47.5 |

## The attempt: cairn_chops, #1 at 3,329 ticks (rs/261)

**Result: Woodcutting 99 in 3,329 ticks (16:38), #1 on `hiscores?category=9&profile=main`,
324 ticks ahead of stunwc's 3,653** (r, the board's hover, 04:26Z 2026-10-22). It was a record
attempt under the 90% gate.

- **Session:** 2026-10-22 04:03:16-04:21:42Z (21:03-21:22 PDT), on rs-ashburn-rehearsal (the twin)
  under `rs-claim take rs/261 2 75`, the xrdp display `:10`.
- **Code:** the worktree `~/rs-261` at 010e477b, which is rs/147's tip f95f9558 plus this child's
  files. The page server ran from the worktree, and its served `client.js` carried `waitRespawn`
  (m, checked before the login).
- **Account and kit:** `cairn_chops` was free (404) when checked at 03:22Z. The kit was rune axe 1,
  knife 1 and logs 5 from cairn_mule2 at Lumbridge (rs/237).
- **Players:** 1,732 at the gate, 1,782 at 04:13Z, 1,745 at the end (m, `/playercount`). The
  demo averaged **0.332 s per tick** over the Woodcutting steps (m, wall over ticks).

```sh
cd ~/rs-261 && exec timeout --kill-after=30s 40m env DISPLAY=:10 ~/.bun/bin/bun speedrun/rehearse.ts \
  --skill=woodcutting --bot=cairn_chops --gate-bot=cairn_twin --claim-owner=rs/261 \
  --kit-from=cairn_mule2 --kit=rune_axe:1,knife:1,logs:5 \
  --skill-opt=route=rimmington --skill-opt=hpStop=4 --log=$HOME/rs-run/cairn_chops.jsonl
```

### Gate, recording, hiscore

| Read | Result (m) |
|---|---|
| Direct, cairn_twin, 04:01:10Z | 60/60 on time, 0 catch-ups/min, tick p90 448.7 ms (over the 400 report line), edge iad, TCP p50 2.1 ms: pass |
| Gate tab before, 04:03:09Z | 59/60, (c) 0/min, loop p10 71.8/s, tick p90 478 ms: marginal pass |
| Recording | running before the login; 1,337.8 s, 40,135 frames, **0 dropped** (`~/recordings/rehearsal-cairn_chops-20261022T040104Z.mkv` on the twin) |
| Live frame | **PASS**: cairn_chops' window alone, maximised and in front of `:10` (difference 2.9) |
| Gate tab after, 04:23:48Z (after the recording stopped) | 59/60, (c) 0/min, loop p10 72.5/s, tick p90 423 ms |
| Logout | click on tick 3,330 = the 99's tick, latency 0, confirmed by the page in 213 ms |
| **Hiscore against the log** | Woodcutting 99 **3,329** against the session's 3,330 (last tick + 1 = 3,331): -1, ok; Overall the same |

### Per step (m, tick log `~/rs-run/cairn_chops.jsonl` on the twin)

| Step | Ticks | Lab (rs/236 c2-c6) |
|---|---|---|
| login to S00 | 2 | |
| S00 tutorial skip | 4 | 4 |
| S01 kit (receiver) | 7 | 8 |
| walk-oaks (Rimmington) | 160 | 159-163 |
| normal 1-15 (plain, 3 logs) | 28 | 27-31 |
| oak 15-73 (step; band summary 605 with one 21-tick probe) | 613 | 620-661 |
| walk-willows | 52 | 51 |
| willow 73-99 (3 probes, 63 ticks) | 2,464 | 2,391-2,583 |
| **Session** | **3,330** | 3,281-3,457 (mean 3,355) |

Boundary rows were 0 ticks over 8 boundaries. Overhead was 2 ticks, from the login to the first
step. Knife share was 1.00 in both gated bands, with **no switch-off** at measureDrops 120 and no
plain fallback.

### The knife bands, luck and client separated

Per band: the model figure is 3 ticks per expected roll (the formula's success). The lattice
figure is 3 ticks per roll taken (logs over the fitted success, which counts whole-cycle log
gaps). Luck is the lattice figure minus the model's, and client loss is the knife ticks minus the
lattice figure. Luck carries the systematic felled-tree cycle as well as chop RNG (see the lab
section).

| Band | Knife ticks | Logs | Per expected roll | Fit vs formula | Model 3 x E | Luck | Client loss | Probes |
|---|---|---|---|---|---|---|---|---|
| oak 15-60 | 261 | 69 | 3.249 | 0.844 vs 0.859 | 241 | +4 | +16 | 21 |
| oak 60-73 | 323 | 105 | 3.076 | 0.981 vs 1.0 | 315 | +6 | +2 | 0 |
| **oak 15-73** | **584** | 174 | **3.151** | 0.923 vs 0.939 | 556 | +10 | +18 | 21 |
| willow 73-85 | 784 | 127 | 3.642 | 0.509 vs 0.590 | 646 | **+103** | +35 | 63 |
| willow 85-99 | 1,617 | 367 | 2.878 | 0.684 vs 0.653 | 1,686 | **-77** | +8 | 0 |
| **willow 73-99** | **2,401** | 494 | **3.089** | 0.630 vs 0.636 | 2,331 | +21 | +49 | 63 |

The client loss in willow 73-85 includes both slips: miss streaks that tripped the 18-tick lock
window, each answered by a stop and a 20-tick re-probe, at ticks 1,008 and 1,403.

- **Knife hit rate.** Log gaps on the 3-tick lattice made up 168 of 173 on oak (97.1%) and 483 of
  490 on willow (98.6%). The off-lattice gaps total 25 and 36 ticks. Every in-band probe was 20/20
  in 20 ticks, with 0 lost (1 on oak, 3 on willow). There were no late clicks (the counter never
  appeared). There were 5 and 4 phase resyncs, and 2 resyncs, both the slips above.
- **Frames during the bands:** tick interval p50 310-360 ms and p90 440-530 ms, with one
  catch-up in the whole run (willow run 7).
- **D and respawn waits: zero respawn waits on the demo**, against 60-86 ticks per willow band in
  the lab. At 1,732-1,782 players D is about 16 (i, `respawnTicks`), against the lab's 29 with
  one player, so all three trees were never down at once.
- **Hits taken: none.** There were no `woodcutting:hit` rows, HP stayed 10/10 from Lumbridge to
  the logout, and the hpStop guard never fired.

### Against the models

- **rs/158's knife model (2,986 ticks):** 584 + 2,401 = **2,985** knife ticks (m). With the
  probes, the gated bands are 605 + 2,464 = 3,069.
- **S07's rows:** oak 605 against 627 (m, rs/162) and willow 2,464 against 2,386 + probes. The
  willow knife ran 3.089 per expected roll against S07's 3.06.
- **rs/236's P(#1) model:** p10/p50/p90 3,330 / 3,473 / 3,643. The result, 3,329, sits at its
  p10. That model added a demo knife slowdown of 1.5% and kept the lab's respawn waits, and the
  demo had none. Excluding waits, the demo's willow knife (3.089) ran about 2% slower than the
  lab's mean (3.034, c2-c6); oak was 3.151 against 3.05-3.18. So the slowdown was about as
  modelled. The waits that the demo's player count removed (about 70 ticks) and a near-neutral
  willow luck (+21 over the band) are what put it at p10.

### Run mode (main, 21:32 PDT: the run toggle isn't persisted across logins)

Lab on bgsrv-mac, S07's Taverley stands, `measure-woodcutting.ts --run=off|on`. The run button
was pressed before any step started, since it runs `p_clearpendingaction`. Movement was counted per
tick from the published tile (m):

| Step | Run off | Run on | Movement |
|---|---|---|---|
| normal 1-15 | 22 ticks | 22 | 8 tiles in both: 3 run ticks, 2 walk ticks |
| oak 15-30 | 58 | 57 | 20 tiles, all the probe's 1-tile steps; none after the probe |
| willow 73-80 | 367 | 427 | 20 and 40 tiles, all probe steps (the run-on case had a slip and a second probe); none after |
| walk-oaks, walk-willows | 277, 61 | 277, 61 | identical |

**Run mode costs S07 nothing.** The oak and willow bands chop every listed tree from the stand tile,
so tree switches and respawn re-targets never move the player, and a probe step is one tile, which
takes one tick either way. The walks are ctrl-run moves (`MoveClickHandler.ts` `tempRun`), which
run whatever `option_run` says while energy is 100%, as infinite run keeps it. The willow
difference is chop luck and one more slip, not movement.

### Procedure notes

- **Timing:** nothing in the module times an action on wall-clock multiples of 300 ms (rs/158
  fold-in 13). The bands are tick-driven, and the kit trade opens on the request's tick.
- **The module's `log` lines don't reach the harness log.** rehearse.ts passes no `log` to
  `steps()`, so the route line and any hit lines live only in the tick log's rows (which carry
  them). A two-line harness change would add them to the console.
- **Lab chains must live inside a running batch.** A `nohup` lab launched from a Cairn batch is
  reaped when the batch exits (m, rs/261's first two chains, 20:16 PDT).
- **Claims race.** rs/196 took the twin's claim between a `status` and a `take` (03:32Z), and
  rs/261 claimed when it was released (03:51Z).
- **Rune axe returned** to cairn_mule2 at Lumbridge on 2026-10-22 06:57Z (rs/296, twin claim
  06:52-07:00Z): one cairn_chops login with `speedrun/tools/kit-return.ts`, one 7-tick trade,
  exit 0, logout confirmed by the page; mule2 banked it (rs/237). The knife and logs stay with
  cairn_chops.
