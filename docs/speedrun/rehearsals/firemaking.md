# Firemaking assisted 99: cairn_burns (rs/228)

**Status: lab gate passed; demo attempt not yet run.** Two complete lab runs from a parked account
reached 99 with **12 ticks of overhead each, parked ticks included** (gate: 25 or fewer; target 17
or fewer). For cairn_burns (8 parked ticks) that predicts a demo total of **669 ticks at the
median line**, **P(#1) = 95.7%** against jackalopefm4's 706, and P(at or under the 670 bar) =
56.5%. The demo waits on two fm-row fixes (filed under rs/41) and the dropper loading.

Labels: **m** measured in the retained lab output ([firemaking-evidence.json](firemaking-evidence.json));
**r** read from code or content; **i** inferred.

## The route

- **Logs (r, deterministic):** 157, which is 2 normal, 4 oak, 7 willow, 13 maple, 24 yew and 107
  magic (`routeLogs` in `speedrun/skills/firemaking.ts`). A failed roll retries the same log.
- **Supply:** six fm-row droppers (`speedrun/helpers/fm-row.ts`), each holding one 28-log
  inventory (`restock: held`, `parts: 6`), drop the logs on the planned tiles about 105 ticks
  before the account wants each one. A dropped obj is private for 100 ticks, so each log turns
  public 3-5 ticks before it is wanted (m: need minus drop was 103-105 for all 157 drops in run 2).
  The account trades nothing and keeps its starter kit; it lights with the starter tinderbox.
- **Lighter:** `speedrun/skills/firemaking.ts`, one Step (`S03 firemaking`). It sends the ground
  item's "Light" op on the success message, so the light lands at R+2 and queues onto the running
  clock (4 ticks a roll). The bands are measure rows, not steps.

## The row (lab, m)

The lap beside the Lumbridge spawn, confirmed by `speedrun/lab/firemaking-row.ts` (one bot drops a
log on each candidate tile and lights them all at level 80, where every roll succeeds, so any gap
other than 4 is geometry):

```
3222-3218@3219;3218-3243@3218;3242-3223@3219
```

That is west along z=3219 from the entry (3222,3219), east along z=3218 to 3243, then west along
z=3219 from 3242 back to the entry: **51 tiles, 204 ticks a lap**. A fire burns 100-199 ticks
(firemaking.rs2), so every tile's previous fire is out before its next log is lit.

- 62 fires in the second check, every gap 4 ticks: both lap turns, a 3-tile diagonal step and
  14 level-up pages cost nothing. The first light from the spawn tile (3222,3222) was 3 ticks.
- **x=3217 is a wall the player can stand on but not pass west of** ("I can't reach that!"), on
  both rows, and it refuses a fire. The SDK's collision map doesn't carry it. So 3214-3217 are out.
- The map read that put grass decor on z=3219 at 3237-3239 and 3241 was wrong: those tiles take
  fires, as do z=3218 3237-3243 and z=3216 3218-3226.
- The first check (before the fix) found that the loop didn't know "I can't reach that!" and resent
  for 150 ticks. It is now a refused tile.

## Lab runs (m)

`speedrun/lab/firemaking-assisted.ts` on the bbs lab engine (300 ms ticks, lite client). The account
is claimed and parked first (`rehearse.ts --claim`: 7 ticks of playtime), the six droppers start
from one go file (`start: cue`, `cueAt: written`), and the account's harness
(`rehearse.ts --skill=firemaking --lab --to=99 --skill-opt=tiles=...`, no kit) is launched at
T0 + 95 ticks, as log 0 turns public at T0 + 101.

| | Run 2 | Run 3 |
|---|---|---|
| Logs lit | 157/157 | 157/157 |
| 99 at session tick | 689 | 645 |
| Parked playtime | 7 | 7 |
| **Total playtime at 99** | **696** | **652** |
| Failed rolls (inferred), expected 7.58 | 14 (92nd percentile of luck) | 3 (17th) |
| Modelled line for those rolls | 684 | 640 |
| Overhead from login: login to first step + walk to the first log | 2 + 3 = 5 | 2 + 3 = 5 |
| **Overhead including parked** | **12** | **12** |
| Lights sent at R+2 / later | 156 / 0 | 156 / 0 |
| Slips, lost logs, resends | 0, 0, 2 | 0, 0, 0 |
| Level-up pages dismissed | 64 | 64 |

Per band, run 3 (ticks, fires, failures): fm-01-15 12/2/2, fm-15-30 20/4/1, fm-30-45 28/7/0,
fm-45-60 52/13/0, fm-60-75 96/24/0, fm-75-99 428/107/0. Every band from 30 is exactly 4 ticks a
log. Run 2's 14 failures were 10 in the first band, where a roll succeeds 25-41% of the time.

The line is the model's: 3 ticks to the first roll, 4 per roll after, the stamp one tick after
the last roll. Both runs land on it exactly once the 5 login-and-walk ticks are added.

**Run 1 failed on the droppers, not the lighter.** It staggered the droppers' logins (dropper k
about 165 ticks before its first log), as the demo must (rs/41 allows at most 3 in the world).
Droppers 0-3 were perfect and the account lit their 112 logs with 0 slips, 5 overhead ticks.
Droppers 4 and 5 logged in to a row already holding other droppers' public logs on their planned
tiles (the lap reuses tiles), took them for their own drops from an earlier session
(`resumeCursor`), skipped the held check and the cue, and dropped nothing. Runs 2 and 3 armed all
six before T0, which sidesteps it.

## Predicted demo total

The overhead on the demo is cairn_burns's 8 parked ticks plus the measured 5, so 13. Over 400,000
runs of the roll model (`rollChance` over the route's levels; line mean 658.3, p10 640, p50 656,
p90 680, p99 716) (i):

| Overhead | Median total | P(#1, 705 or under) | P(670 or under) |
|---|---|---|---|
| 13 (predicted) | 669 | 95.7% | 56.5% |
| 17 (target) | 673 | 94.3% | 46.9% |
| 25 (gate) | 681 | 90.0% | 26.4% |

One log gap (a missing or stolen log, a late light) costs 4 ticks or more and moves one row of the
table. The lab ran at 300 ms on a local engine; the demo's latency is the open risk, and the light
has 3 ticks of slack (it may land as late as R+4).

## Before the demo

- **fm-row fixes (filed under rs/41):** a held dropper that still carries its whole load starts
  with cursor 0 (the run-1 failure); and with `skipOccupied`, a fire seen appearing at tick F
  doesn't block a log wanted at F + 200 or later, because on a 51-tile lap the previous lap's fire
  is still burning (about 99 ticks old) when the next log is dropped. With spare tiles the lap's
  revisits drop below 50 logs (47 with spareTiles 2), so the demo runs spareTiles 0 on this lap.
- **A skip run** (the plan's run 2 with an interference fire) once the skip rule lands.
- **Droppers cairn_d01-d06** loaded per inventory (rs/41's kits issue); dropper 5 carries 17 magic
  plus spares (1 normal, 1 oak, 1 willow, 2 maple, 2 yew, 4 magic), 28 items.
- Then `ready for demo slot` to rs/147 with the numbers above.

## Demo procedure (the configuration of lab runs 2 and 3)

1. rs/237 has loaded cairn_d01-d06 (one inventory each, d06 with the spares) and logged each out
   on z=3220, x 3232-3237, beside the row and off its tiles. rs/41 has had 15 minutes' notice.
2. On the twin (`ubuntu@$RS_TWIN_HOST`, HOST.md's ssh line): the leftover check,
   `~/host-reserved.json` absent, the attempt worktree from this branch, the stack (RUN-HOST.md
   step 3, Chrome as an `--app` window on cairn_burns's page) and the recording. Once staged, and
   before the gate's login, the claim: `rs-claim take rs/228 2 MINUTES "firemaking attempt"`
   (cairn_burns and the gate account; HOST.md, "Claims").
3. Gate, off the clock: rs/96's direct CLI on cairn_twin (`--json`) and the 60-trial in-page probe
   on its tab, `/playercount`. The JSON must be under 10 minutes old at the harness's start.
4. Scout: one dropper's view of the 51 tiles (fires, ground items, players standing on them).
5. On bbs: one `speedrun/helpers/standalone.ts` launcher per dropper (its own gateway port and run
   directory, `botsDir` the fleet's, the account `final`, so it logs out the moment fm-row
   finishes), with ROLE_OPTIONS `{tiles, parts: 6, part: k, restock: {kind: 'held'}, start: 'cue',
   cueAt: 'written', cueDir}`, all six armed before T0.
6. T0: write `fm-row-go.json` (`{v: 1, ms}`) into the droppers' cue directory.
7. At T0 + 101 ticks: on the twin, `rehearse.ts --skill=firemaking --bot=cairn_burns
   --gate-json=<file> --skill-opt=tiles=3222-3218@3219;3218-3243@3218;3242-3223@3219`, bounded
   with `timeout --kill-after=30s 10m`. It logs out the tick 99 is seen.
8. After: the gate read and probe again, teardown (logout first), the leftover check, release the
   claim (`rs-claim release rs/228`), the hiscore row (`speedrun/tools/hiscore-scrape.ts`, category 12) against the tick log.

## Divergences from STEP-MANIFEST entry 16

Entry 16 expects 695 (best 650) for S03's 1-99. The lab line is the same model; S03 learns from
this that a dropped row at 4.00 ticks a log holds across 157 logs including turns and level-ups,
with 5 ticks of fixed cost from a standing start beside the row. The row on the demo at real
player counts is still unmeasured.
