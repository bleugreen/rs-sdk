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
(`resumeCursor`) and relearns the frontier from the fires. A `held` dropper that still carries
its whole load has dropped nothing, so it always starts fresh (below).

## Starting

`start` decides when log 0's 100 ticks begin:

| start | Fires when | Use |
|---|---|---|
| `sighted` (default) | SCORED is within `sightRange` (15), by `scoredSha256` (`altar-cue.ts` nameHash) or the cue's receiver hash | the lab; or a run where SCORED waits out the first ~100 ticks at the row, logged out (firemaking.md section 6) |
| `cue` | `<cueDir>/fm-row-go.json` (`{v:1, ms, tickMs?}`) is written | the run machine: the run script writes it about 105 ticks before SCORED reaches the row |
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
(`{ account, role: 'fm-row', options: { start: 'cue', row, restock } }`). On run day the
droppers also carry `stopOn: { step: 'S03', family: 'fmrow' }`: `run.ts` writes that cue's final stop
after S03, and the launcher logs them out at once (HELPERS.md, "The cue gate"). The role itself
never reads the `fmrow` cue; its start stays `fm-row-go.json`.

## Opt-ins for a busy row and staggered droppers

The assisted Firemaking attempt (rs/228) runs on a row beside the Lumbridge spawn with six
preloaded droppers, one inventory each. It needs four options that S03 does not use. Each is off
by default, and with all of them off the dropper behaves exactly as above.

- **`tiles`**: an explicit list of tiles, `[[x,z],...]`, walked in order and cycled, in place of
  the `row` snake. A snake cannot leave out tiles that refuse a fire (decor), and a refused
  planned tile never shows a fire, so progress would stall on it. Leave those tiles out of the
  list. Giving both `row` and `tiles` is an error.
- **`skipOccupied`**: before a drop, if the log's tile has a fire or any ground item except ashes
  on it, the log goes on the next free tile, and the logs after it follow it. Ashes are allowed
  because a burnt-out fire leaves them for 100 ticks (`firemaking.rs2`), so on a 50-tile lap our
  own ashes often lie on the next lap's tiles, and they do not stop a light. The lighter follows
  the logs it can see, not a tile index.
  - *Blocks.* A skip pushes a log one tile on. If that tile were the next dropper's first, the
    next dropper could not see our log, which is private for 100 ticks, and would drop on top of
    it. So each inventory gets its own block of 28 + `spareTiles` planned tiles. Skips use up that
    block's spares and never cross into the next block. A log with no free tile left is dropped
    on the block's last tile and logged `skip: block full`. `spareTiles` defaults to 2 with
    parts > 1 and 0 with one dropper, and it can be set to 0 or more. One dropper sees all its
    own logs, so with parts = 1 a skip has no block limit and shifts the later logs on.
    `plannedTiles(path, parts, spareTiles)` is the layout as a pure function (slot, tile,
    inventory, part, and the log, or null on a spare), for lab scripts and tick logs.
  - *Progress.* A busy row has foreign fires, and a cycled list repeats tiles, so a fire on a
    tile no longer proves that SCORED lit our log. In this mode a fire counts only if it is
    fresh (`FireLedger`): its tile was watched with no fire on it after arming, before the fire
    appeared. A tile watched clear forgets its fire, so a tile relit on the next lap counts again.
    An own log counts on the tile it was actually dropped on, by a fire first seen at or after
    the drop. Another part's log, which we cannot see, counts by the first fresh fire from the
    slot after the last lit log's fire to the end of its block (`advanceFresh`).
  - *The last lap's fire.* A log goes down about 105 ticks before it is lit, so on a lapped
    row its tile's fire from the previous lap is often still burning at the drop: on a 51-tile
    lap (204 ticks) that fire is about 100 ticks old, and fires burn 100-199 ticks
    (`firemaking.rs2`: `100 + random(100)`). Counting it as occupied would skip nearly every
    tile from lap 2 on and fill the blocks. So a fire the dropper saw appear at tick F (a fresh
    fire in `FireLedger`) does not block a log whose need tick is F + 200 or later
    (`fireOutBy`, `FIRE_OUT_TICKS`): it is out before the light can land. The need tick is a
    lower bound on the light, so this never drops on a fire that can still be burning. A fire
    already burning when the dropper first saw its tile may be any age and still blocks. A fire
    tile does not block walking (`blockwalk=no`), so the dropper can stand on it to drop. The
    rule only helps a dropper that was watching its tiles when the previous lap lit them, so on
    a lapped row a staggered dropper should be dropping (logged in, cue seen) about a lap
    before its first log is due. If it arrives later, those first tiles read occupied and skip.
  - *Spares shorten revisits.* A tile's next log comes round after one lap of logs, minus the
    empty spares in between. Under 50 logs (200 ticks) the lighter can reach a tile whose last
    fire still burns. On rs/228's 51-tile lap with `spareTiles` 2, some tiles come round in 47
    logs (188 ticks). Use `spareTiles` 0 on a 51-tile lap, or 1 on a 53-tile lap, which keeps
    every revisit at 51 logs or more. `shortestRevisit(plannedTiles(...))` computes it, and the
    role logs `warning: a tile comes round before its last fire is surely out` at start when
    it is under 50.
- **`restock: {kind:'held'}`**: the dropper logs in already carrying its one inventory and never
  restocks. At start it checks the load (spares on top are fine) and throws if it is short. It
  refuses a part that owns more than one inventory, which means `parts` must be 6 for the
  route's 157 logs. `restockTicks` defaults to 0. At login, a held dropper that still carries
  its whole load takes the fresh start (held check, `armed`, trigger, `cue`, catch-up) whatever
  lies on its tiles. On a lapped row those tiles are shared with earlier inventories, and the
  logs lying there are other droppers' drops, which `resumeCursor` would otherwise read as its
  own (rs/228's lab: a late dropper printed `resume cursor 9` and dropped nothing).
- **`cueAt: 'written'`** (with `start: 'cue'`; the default is `'seen'`): a dropper that logs in
  after the go file was written counts from the file's `ms`, not from the tick it sees it.
  `start = tick_seen - round((ms_seen - ms) / period) + 1 + reveal + lead` (`cueTick`).
  - *The period is observed, not nominal* (rs/158: cue-timed actions run on observed ticks). The
    demo has run at 340-370 ms a tick, and counting 0.35 s ticks at a nominal 300 places the cue
    about 15% of the elapsed time too early, so a late dropper runs ahead of the row. From the
    moment the role starts, the dropper times every new tick it sees (`lib/wait.ts`
    `tickPeriod`, counting ticks with `tickClock`), and `period` is their wall-clock span over
    the ticks counted, for the last 60 s. Under 20 s of ticks it falls back to the go file's
    `tickMs` (the writer's own observed period, if it wrote one), and then to the nominal
    `tickMs` option (`tickMs()`: `SPEEDRUN_TICK_MS`, else `NODE_TICKRATE`, else 300). A measured
    period is held to 250-600 ms (`cuePeriod`). A writer should record its period:
    `{v:1, ms, tickMs: period.msPerTick(20_000)}`, leaving `tickMs` out when that is null.
  - *Placed again once observed.* A held dropper logs in at the row and reaches its trigger in a
    few seconds, before it has 20 s of ticks, so it places the cue on a fallback period. It keeps
    the moment it saw the go file (tick and wall time), and once 20 s of ticks are in it places
    the cue again from that moment at the observed period, moving `start` (`cue: refined`, then
    `start` with `was`). A nominal period faster than the server's places the cue early, so until
    then the dropper paces early, not late.
  - *Catch-up.* A correct `start` alone is not enough for a late dropper. By the time it arms,
    the fires from log 0 on are burnt out, so `advance` never leaves log 0, and `needTick`
    slides with the clock, putting dropper k's first log about 4 x 28k ticks late. So under
    `written` (and only then), while progress is still at log 0, the dropper takes the frontier
    from the highest log that burns now together with the log before it (one fire alone may be
    anyone's), if SCORED can have got that far: log i is lit no sooner than `start` + 4(i + 1)
    (`catchUp`, logged as `catch-up`). It then expects the next log from the next tick on.

## Options

| Option | Default | Meaning |
|---|---|---|
| `row` | `{x:3019, z:3362, len:27, rows:2}` | the snake (firemaking-line.ts `--row`/`--rows`). The default is the confirmed Falador east lab row; the run's row beside the coop (SUPPLIES.md H2) is unconfirmed |
| `tiles` | none | `[[x,z],...]` in place of `row`, cycled (above) |
| `logs` | the route's 157 (`S03_LOGS`) | `[{obj, n}, ...]` in lighting order, each `obj` one of the route's tiers and `n` >= 1, e.g. `[{obj:'logs', n:20}]` for entry 16's demo row of normal logs; a part that owns none of the list's inventories is refused |
| `part`, `parts` | 0, 1 | this dropper's share of the inventories |
| `skipOccupied`, `spareTiles` | false; 2 with parts > 1, else 0 | above |
| `start`, `scoredSha256`, `sightRange` | `sighted`, none, 15 | above. The hash, never the name |
| `cueAt`, `tickMs` | `seen`; `lib/wait.ts` `tickMs()` | above. `tickMs` is only `written`'s last fallback |
| `restock` | `{kind:'bank', bank: Falador east (3013,3357)}` | `cheat` (::give) for the local lab only; `held` above |
| `lead` | 4 | ticks a log is public before SCORED's earliest want of it |
| `restockTicks` | cheat 6; held 0; bank: distance from the first tile + 20 | a restock's round trip, last drop to next drop |
| `dropTicks` | 2 | ticks per drop when catching up |
| `scanRadius` | 32 | scan for fires beyond the state's 15 tiles |
| `lingerTicks` | 400 | after the last drop, how long to watch for it to be lit |

Log lines: `phase` (restock, armed, dropping), `start`, `drop` (`i`, tier, tick, ms, target,
need, lit; `early` if it went down more than 100 ticks before its need; `slot` and `tile` with
`skipOccupied`), `progress` every 10 lit, `lost`, `restocked` (ticks), `fm-row: finished`. The
opt-ins add `skip` and `skip: block full` (i, from, to), `held` (the load checked), `cue`
(seenTick, seenMs, writtenMs, cueTick; `tickMs` used and `tickMsFrom` observed, cue or nominal,
beside `observedTickMs`, `writerTickMs` and `nominalTickMs`), `cue: refined` (the same, on the
observed period) and `catch-up` (lit, slot). A layout whose shortest revisit is
under 50 logs logs `warning: a tile comes round before its last fire is surely out`.

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

### `cueAt: 'written'` on a slow tick

```
NODE_TICKRATE=350 LAB_HELPERS=rs274d speedrun/lab/lab.sh rs274w speedrun/lab/fm-row-cue.ts:--dropper=rs274d
```

`lab/fm-row-cue.ts` (rs/274): the engine ticks at 350 ms and the dropper is told `tickMs: 300`, as
on a slow demo minute. The lab's own client writes the go file and times its ticks, which gives
the cue's true tick in the dropper's numbering. bgsrv-mac, 2026-10-21: the dropper saw the go file
35.0 s after it was written, 100 true ticks later. It reached its trigger 4 s after starting,
before it had 20 s of ticks, and placed the cue on the nominal 300 ms, **17 ticks early**. That is
the fault this fixes, and the case `cue: refined` is for. 16.5 s later it placed the cue again on
its observed 350.7 ms, **on the true tick**. The writer observed 351.2 ms.

## Not done yet

- **The run's row.** SUPPLIES.md H2 puts it beside the Lumbridge chicken coop. No row there has
  been confirmed in the lab (`firemaking-rows.ts`, then a lab run). Pass it as `row`.
- **Bank restock** is written (Falador east by default; `withdrawMany` of the inventory's tiers)
  but untested; the lab restocked by `::give`. Measure a trip from the chosen row, and set
  `restockTicks` and `parts` from `maxRestockTicks`.
- **`skipOccupied` is unit-tested only.** rs/228's lab run 1 (51-tile lap, six held droppers,
  `cueAt: 'written'`, staggered logins) exercised `held`, the written cue and catch-up: droppers
  0-3 dropped 112 logs and all 112 were lit. It found the two faults fixed above (a late held
  dropper's resume, and the last lap's fire). No lab run has had `skipOccupied` on yet.
- **Restart with `skipOccupied`** resumes by the planned tiles (`resumeCursor`), so after skips in
  the current block it can be off by up to `spareTiles` logs.
- **A held dropper restarting mid-row** (it carries part of its load) still resumes from the
  logs it sees on its tiles, and on a lapped row those can be other droppers' logs. Logs it
  carries as spares hide up to that many of its own drops, so it reads as not started.
- **The fire-age rule trusts continuous watching.** The ledger records a fire on its tiles in
  view, each tick. If a tile is out of view while its fire burns out and a new one is lit, the
  new fire inherits the old one's tick and reads as out too early.
- **Catch-up trusts a burning pair.** Two foreign fires on consecutive planned tiles, within
  SCORED's reach on schedule, would put the frontier too far on, and logs would turn public early.
- **Demo.** No demo run, and no demo credentials for `cairn_f01`/`f02` yet (they would go in
  `~/rs-fleet/bots/` or, for a run-machine helper, bbs `~/rs-run-machine/bots/`, created with
  `accounts.ts createAccountEnv`). The logs come from the woodcutters' stock through rs/41.
