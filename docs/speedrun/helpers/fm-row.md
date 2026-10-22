# Log-row dropper (H6, S03 Firemaking)

`speedrun/helpers/fm-row.ts` drops the scored account's Firemaking logs on the ground, one per
tile, along the snake SCORED lights with the ground op (`skills/firemaking.md` sections 1 and 4).
The logs are the route's 157 (logs 2, oak 4, willow 7, maple 13, yew 24, magic 107; firemaking.md
section 7; SUPPLIES.md H2), in row order. Each one is dropped so that it turns public a few ticks
before SCORED can want it. Lab driver: `speedrun/lab/fm-row.ts`. Standalone:
`bun speedrun/helpers/fm-row.ts <account>` with `ROLE_OPTIONS`.

## The rule it paces around

A player's drop is private to the dropper for 100 ticks (`World.ts` addObj,
`NODE_OBJ_REVEAL_TICKS`, not set on the demo) and despawns 300 ticks after it lands (`drop.rs2`,
`lootdrop_duration` 200 x 3/2). Measured in the lab: a log is in SCORED's view **99 ticks after
the dropper's drop is confirmed** (two runs). So log i has to leave the dropper's hands at least
~100 ticks before SCORED reaches it, or SCORED waits on a log it cannot see. If it leaves much
earlier, it lies public, and anyone may take it.

SCORED chains one 4-tick roll per log. After the success of log i-1 it wants log i at once
(firemaking.md section 4). The success deletes the log and adds a `Fire` loc on its tile
(`firemaking.rs2`, `firemaking_success`), so the dropper always knows how far SCORED has got by
watching the row's tiles for fires.

## Pacing

All of it is pure functions in `fm-row.ts`, unit-tested in `fm-row.test.ts`, including a tick
simulation of a stand-in SCORED with failed rolls.

- **When SCORED can want log i** (`needTick`). With `lit` logs burning and the last one seen
  at tick F, log `lit` is wanted at F. Every later log is wanted one roll (4 ticks) after the one
  before, starting no sooner than F + 4 and no sooner than the next tick. Before the first
  success, log 0 is due at `start` (the trigger tick + 1 + 100 + lead), and the same rule runs
  from there. These are lower bounds: a failed roll only makes SCORED later. So pacing on them
  is never late. A log turns public early only by the failed rolls between its drop and its
  light, and there are none from level 43 on (after about the 25th log).
- **When to drop it** (`latestDrop`, `dropTarget`). Decide at need - 100 - lead - 1. The drop
  lands on the next tick and turns public `lead` ticks before the need. `lead` defaults to 4. It
  absorbs the observation lag (the fire is seen a tick or so after the roll) and one tick of
  client lag.
- **Restocks.** The dropper carries 28 logs, so the route takes 6 inventories. When a restock
  follows an inventory, the rest of that inventory is pulled forward. Its last log is down
  `restockTicks` before the next own inventory's first log is due, and each earlier log is down
  `dropTicks` (2) before the one after it.
- **Several droppers** (`part`, `parts`). Inventory k goes to dropper k % parts, so each has
  `parts` inventories of SCORED's time (112 ticks each) for its trip plus 28 drops.
  `maxRestockTicks(parts)` is the longest trip that still fits: 112 x parts - 28 x dropTicks
  (56 ticks for one dropper at 2 ticks a drop), and never more than the window allows. The role
  logs a warning when `restockTicks` is over it. One dropper with a 150-tick bank trip falls
  behind; two keep up inside the window (simulated).
- **SCORED late.** If SCORED has not started by `start`, the need slides with the clock. The
  dropper keeps about 26 logs down ahead of "now" and holds back the rest, so it does not run
  ahead of an absent SCORED.

## Seeing SCORED's progress

The dropper watches for fires on the tiles from the frontier on. The state's `nearbyLocs` only
reaches 15 tiles (`StateCollector.ts`), so when the frontier is further away it scans with
`scanNearbyLocs(scanRadius)` (32). A fire counts only on a log that has been dropped: its own
logs once dropped, or another part's logs, which it cannot see while they are private. An own
log that disappears without a fire (taken or despawned) is logged as `lost`. It is not re-dropped,
because a replacement would be private for another 100 ticks.

On a restart mid-row the role resumes after the last own log it still sees lying on its tile
(`resumeCursor`) and relearns the frontier from the fires.

## Starting

`start` decides when log 0's 100 ticks begin:

| start | Fires when | Use |
|---|---|---|
| `sighted` (default) | SCORED is within `sightRange` (15), by `scoredSha256` (`altar-cue.ts` nameHash) or the cue's receiver hash | the lab; or a run where SCORED waits out the first ~100 ticks at the row, logged out (firemaking.md section 6) |
| `cue` | `<cueDir>/fm-row-go.json` (`{v:1, ms}`) is written | the run machine: the run script writes it about 105 ticks before SCORED reaches the row |
| `now` | at once | manual runs |

The run cannot simply trigger on sight at the coop. S02 (Wind Strike at the coop) is 18 ticks
(RUN-ORDER.md), far less than the 100 the first log needs. So in the run either SCORED spends
those ticks logged out at the row, or the run script cues the dropper during S01.

## Where it runs

It does **not** need tick-exact timing. A drop may land anywhere in a ~95-tick window and still
be on time and not early, and a relayed client's 1-2 tick lag costs lead, not a gap. So it can
run in the bbs fleet like any gatherer, and the direct path (`lib/direct.ts`) is not needed.
The one thing that ties it to the run machine is the `cue` start, because the cue is a local
directory. With `start: 'sighted'` (and `scoredSha256` in its fleet options) it runs from bbs.
With `start: 'cue'` it runs beside the scored client through `standalone.ts`
(`{ account, role: 'fm-row', options: { start: 'cue', row, restock } }`).

## Options

| Option | Default | Meaning |
|---|---|---|
| `row` | `{x:3019, z:3362, len:27, rows:2}` | the snake (firemaking-line.ts `--row`/`--rows`). The default is the confirmed Falador east lab row; the run's row beside the coop (SUPPLIES.md H2) is unconfirmed |
| `part`, `parts` | 0, 1 | this dropper's share of the inventories |
| `start`, `scoredSha256`, `sightRange` | `sighted`, none, 15 | above. The hash, never the name |
| `restock` | `{kind:'bank', bank: Falador east (3013,3357)}` | `cheat` (::give) for the local lab only |
| `lead` | 4 | ticks a log is public before SCORED's earliest want of it |
| `restockTicks` | cheat 6; bank: distance + 20 | a restock's round trip, last drop to next drop |
| `dropTicks` | 2 | ticks per drop when catching up |
| `scanRadius` | 32 | scan for fires beyond the state's 15 tiles |
| `lingerTicks` | 400 | after the last drop, how long to watch for it to be lit |

Log lines: `phase` (restock, armed, dropping), `start`, `drop` (`i`, tier, tick, ms, target,
need, lit; `early` if it went down more than 100 ticks before its need), `progress` every 10 lit,
`lost`, `restocked` (ticks), `fm-row: finished`.

## Lab acceptance

```
NODE_TICKRATE=300 LAB_HELPERS=cairn_f01 WEB_PORT=9560 WEB_MANAGEMENT_PORT=9561 HISCORES_WEB_PORT=9562 \
  NODE_PORT=44260 AGENT_PORT=8560 speedrun/lab/lab.sh cairn_f02 speedrun/lab/fm-row.ts
```

The dropper `cairn_f01` (restock `cheat`, `start: sighted`) against a stand-in SCORED `cairn_f02`
running firemaking.md's route: `firemaking-line.ts --mode=ground --logs=auto --level=1 --hold=0
--until=99` on the Falador east 2-row snake. `lab.sh` cannot create `cairn_*` lab accounts
(`create-bot.ts` refuses the underscore), so `bots/cairn_f0{1,2}/bot.env` are written by hand for
the lab ports (gitignored). bgsrv-mac, 2026-10-21, two runs:

| | Run 1 | Run 2 |
|---|---|---|
| Logs dropped / lit | 157 / 157, level 1 to 99 | 157 / 157, level 1 to 99 |
| First to last success | 658 ticks | 658 ticks |
| Gaps between successes | 151 x 4, 1 x 8, 2 x 9, 1 x 12, 1 x 16 | 150 x 4, 2 x 8, 2 x 9, 2 x 12 |
| **Gaps that waited on a missing log** | **0** | **0** |
| Failed rolls (inferred) | 7 | 11 |
| Log 0: SCORED waited at the row | 89 ticks | 89 ticks |
| Ticks public before SCORED wanted it, logs 1-156 | 3-32; 64 x 5, 53 x 10, 19 x 30 | 3-48; 64 x 5, 53 x 10, 19 x 46 |
| Lost logs; drops over 100 ticks early | 0; 0 | 0; 0 |

Where each number comes from:

- **The 8, 12 and 16-tick gaps** are failed rolls at levels 15-36. The log was in view each time.
- **The two 9-tick gaps** are the snake's lap turn, logs 54 and 108. From the end of row 1
  (3019,3361) the stand-in walks round to (3019,3362) and starts the lighting clock afresh. The
  log had been public for 3 ticks. That is 5 ticks per lap on this snake whoever supplies the
  logs, a route detail for the S03 module (firemaking.md section 4).
- **5 ticks ahead** is the steady state: `lead` 4 plus the drop's own tick. The row after each
  lap turn shows 10, because the turn's 5 ticks came after those logs were down.
- **30-48 ticks ahead** are logs 2-28. They went down while the stand-in was still failing its
  low-level rolls, as the pacing predicts. They are the run's most exposed logs, and well inside
  the 100.
- **Log 0's wait** is the private window itself. SCORED came to the row as dropping began. On the
  run that wait is either spent logged out or avoided by a `cue` start (above).

## Not done yet

- **The run's row.** SUPPLIES.md H2 puts it beside the Lumbridge chicken coop. No row there has
  been confirmed in the lab (`firemaking-rows.ts`, then a lab run). Pass it as `row`.
- **Bank restock** is written (Falador east by default; `withdrawMany` of the inventory's tiers)
  but untested; the lab restocked by `::give`. Measure a trip from the chosen row, and set
  `restockTicks` and `parts` from `maxRestockTicks`.
- **Demo.** No demo run, and no demo credentials for `cairn_f01`/`f02` yet (they would go in
  `~/rs-fleet/bots/` or, for a run-machine helper, bbs `~/rs-run-machine/bots/`, created with
  `accounts.ts createAccountEnv`). The logs come from the woodcutters' stock through rs/41.
