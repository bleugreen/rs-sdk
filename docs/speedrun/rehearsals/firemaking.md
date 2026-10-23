# Firemaking assisted 99: cairn_burns (rs/228, rs/255, rs/269)

**Status: done. cairn_burns is #1 on the demo's Firemaking hiscores at 3m 27s (690 ticks)**,
ahead of jackalopefm4's 3m 31s (706), on 2026-10-22 03:43-03:47Z (20:43-20:47 PDT; rs/269). The lab
gate had predicted 669 at the median line with P(#1) = 95.7%. The 21 ticks over the median were an
early login (+18, the launch was timed in 300 ms wall ticks while the demo ran 0.34-0.37 s a tick),
roll luck (+4) and one parked tick fewer (-1). See "Demo attempt" below. jackalopefma later took #1 at
673 ticks (3m 21s at 300 ms). Re-raced by cairn_ashes at 664 ticks, #1 again (rs/439, below).

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

## Demo attempt (rs/269, m unless marked)

The configuration of lab runs 2 and 3: all six droppers armed before T0, `restock: held`,
skipOccupied off. Evidence: the harness's tick log `rs269-ticks.jsonl`, the droppers' role logs
and the recording, retained on the twin and bbs (rs/269's PR lists them).

| | |
|---|---|
| Account | cairn_burns (claimed and parked earlier: 7 ticks of playtime) |
| When | cue T0 03:42:53.116Z; harness launched 03:43:15.6Z; 99 and logout at 03:47:22.6Z (2026-10-22) |
| **Hiscore row (category 12)** | **690 ticks, 3m 27s, rank 1** (jackalopefm4 3m 31s, then stunfiremake) |
| Tick log | session 683 ticks: S03 681 + 2 outside the runner; 99 at playtime 683; 690 - 683 = the 7 parked ticks |
| Players online | 1,622 at the direct read, 1,790 at the start, 1,762 at the end |
| Gate (direct, cairn_twin, 03:37:21Z) | (a) 60/60 on time; (b) tick p90 452 ms, over the 400 ms report line; (c) 0 catch-ups/min. Pass |
| Gate (in-page, gate-tab.ts, 60 trials, 03:39Z) | (a) 58/60, at the floor; (b) p90 496 ms (report); (c) 0/min; (d) loop p10 72.5/s. Pass, marginal |
| Live frame | PASS: cairn_burns's tab the only window, maximised, in front of :10 |
| Recording | 649 s, 1920x1080 yuv420p, 19,473 frames, 0 dropped |
| Demo tick (TICKMON) | 161, 166, 177, 177 ticks a minute: 0.34-0.37 s a tick, not 0.30 |

**Where the ticks went.** 690 = 7 parked + 2 (login to the first step) + 21 (the step's fixed ticks
before its first light) + 660 (the line: the first roll 3 ticks after the attempt, then 4 a roll,
157 logs and 8 failed rolls).

- **Early login, +18 against the lab.** The harness was launched at T0 + 75 x 300 ms. With the
  demo at about 0.37 s a tick, T0 + 101 ticks (log 0 public) came about 7 s later than that clock
  assumed, so cairn_burns logged in about 20 ticks before log 0 turned public. It waited at the
  entry (`nolog`, ticks 2-22) and sent the first light at tick 23. The lab's figure is about 3.
  Fixed for the next run: the launch now waits on observed ticks (procedure step 7).
- **Rolls, +4 against the median.** 8 failed rolls against 7.58 expected; the line is 660 against
  p50 656. fm-01-15 had 4 failures and fm-15-30 4, then none from 30.
- **Parked, -1:** 7 ticks against the model's 8.
- **No lost logs, slips or resends.** All 157 logs were dropped and lit, and every light from the
  second on was sent on the success message (lands R+2). The harness summary counted 13 failures
  and 5 `lost`. Those 5 were lights of cairn_burns's own whose "The fire catches" message never
  showed. The log became a fire on its tile and the xp arrived, and the next fire came 8 ticks
  later, covering two logs. Evidence: fm-row's ledger (which advances only past consecutive tiles
  burning with a fresh fire) reached 157, and 99 came at the 157th log, as it did in the lab. They
  cost no ticks. Since rs/269, `firemaking.ts` records such a light as a fire (`inferred: true`)
  when the log turned into a fire and this account's xp rose, so `failures` counts only real
  failures.

Per band (ticks / fires / real failures), from the band rows with the 5 inferred fires restored:
fm-01-15 12 / 2 / 4; fm-15-30 32 / 4 / 4; fm-30-45 28 / 7 / 0; fm-45-60 52 / 13 / 0; fm-60-75 96 / 24 / 0;
fm-75-99 428 / 107 / 0. Every band from 30 runs at exactly 4 ticks a log, as in the lab, at about
1,700 players and with 20-odd strangers standing on the row.

**The push on the eastward row costs nothing.** After each light, firemaking.rs2's `push_player`
teleports the player one tile west if it can (then east, south, north). The `fire` loc has
`blockwalk=no` (cooking_sources.loc), so a lit fire doesn't stop it. On the westward rows (z=3219)
the push lands on the next log. On the eastward row (z=3218, 26 of the lap's 51 tiles) it lands on
the previous tile's fire, and the player walks 2 tiles east to the next log: the visible
back-and-forth in the recording. The cadence is the script's roll clock (`%action_delay =
map_clock + 4` per roll), not movement. The next light is sent on the success message and lands
R+2, and 2 tiles at run take 1 tick inside that wait. Measured on the demo: 78 eastward logs and 78
westward logs, **both at exactly 4.000 ticks per clean log**, and both lap turns at 4 ticks. So a
west-only route can't gain, and its empty runs back east would only add ticks. The only effect is
slack: an eastward light spends 1 of the 3 ticks it may lose before it slips (R+4). It never slipped
here, at 0.37 s ticks and about 1,700 players (m, r; rs/269).

**Incidents (none on the clock).**
- The first dropper launch failed: the bbs deploy folder had no `server/webclient/node_modules`,
  so each lite client exited in 20 ms on `Cannot find package 'fflate'`. Nobody logged in. Fixed by
  `bun install --frozen-lockfile` in `server/webclient` (step 5 now says so).
- The scout reported NOT CLEAR on non-log ground items (a herb, bones, coins) on 3 planned tiles,
  with no fire and no log anywhere on the row. The cue went ahead: `area_allow_loc_add`
  (firemaking.rs2) refuses a fire only on a loc or a blocked tile, never on ground objs, and lap 2
  relights every tile on top of lap 1's ashes. row-scout now blocks only on a loc or a log (step 4).
- The twin was claimed by rs/196 between the leftover check and the stack's launch. The stack's
  `tmux new-session` calls failed as duplicate sessions, so nothing of rs/269's started. The claim
  was taken at 03:36:51Z, when rs/196 released.

## Re-race on the current floor (rs/439)

**Status: done. cairn_ashes reached Firemaking 99 at 664 ticks on its hiscore page (4m 25s; the tick log
has 665 playtime) on 2026-10-22 20:36-20:40Z**, under jackalopefma's 673 (#1 since that morning) and
cairn_burns's 690. The model put P(beating 673) at 65%, below the 90% gate, so it was run and labelled
as a **measurement** of S03 on the current floor (rs/364's message reader, rs/309's ClickGuard),
not a record attempt. The board listed it #1 at 20:44:42Z, ahead of jackalopefma 673 and cairn_burns 690.
Labels: **m** measured, **r** read, **i** inferred.

**The change: no parked claim, login on the cue.** cairn_burns was claimed and parked in advance
(7 ticks of playtime), then logged in about 20 ticks before log 0 turned public. A fresh name's first
login is now the attempt: S00 runs on the clock, and the harness is launched on the droppers'
observed ticks so the account arrives as log 0 turns public.

### Lab, no claim (m)

bgsrv-mac, scratch copy of main 827cc66a, 300 ms, lite client; `firemaking-assisted.ts` with a
`--claim=0` option (scratch only: it skips the claim), the six held droppers armed before the cue,
the harness launched at T0 + 101. Playtime at 99 **678** = line 668 (10 failed rolls against 7.58
expected) + **10 overhead** (4 login frames, S00 3 plus its boundary, 3 to the first roll). 157/157
lit; 156 lights at R+2; 0 slips, lost logs or resends.

### Model (i)

The failure count F is computed exactly (a convolution of `rollChance` over the 157 logs; 12 can
fail, E[F] = 7.58). Total = 4 x (157 + F) + overhead, so totals move in steps of 4. P(F <= 7) = 56.6%,
P(F <= 8) = 65.1%, P(F <= 13) = 90.1%.

| Overhead | Median | P(672 or under: beats 673) | P(705 or under) |
|---|---|---|---|
| 9 (expected: 2 login + 4 S00 + 3) | 665 | 65.1% | 96.7% |
| 10 (lab) | 666 | 65.1% | 95.7% |
| 13 (measured on the demo) | 669 | 56.6% | 95.7% |

rs/158: nothing else in the row beats it structurally. The log count and the 4-tick cadence are
server rules, and the first roll is already the floor; what's left is F below level 43.

### Demo attempt (m)

| | |
|---|---|
| Account | cairn_ashes, fresh (operator's name), first login = the attempt |
| Code | harness from main 2ec58839 on the twin (S03 path identical to floor 069a8690 and to the lab's 827cc66a); droppers fleet 7da08916 (fm-row.ts blob 850fc7e7) |
| When | cue 20:35:33Z (tick 1909); harness launched 20:36:02Z at T0 + 74 observed ticks; 99 and logout at tick 665, 20:40:35Z |
| **Hiscore row (category 12)** | **664 ticks** ('normalized to 400 ms per tick'), against the log's 665. The harness's automatic check couldn't parse the new hover format, so it was read by hand |
| Demo | **400 ms ticks** since the 19:56Z restart (TICKMON 150-151 a minute, period 397-401 ms); restart ~20:08Z, token mvjz3zys unchanged through the run; 1,255-1,258 online |
| Gate (direct, cairn_twin, 20:32:40Z) | (a) 57/60, one under the record line of 58; (b) tick p90 482 ms (the 400 report line predates 400 ms ticks); (c) 0/min. Measurement rule: (c) only, so it passes |
| Gate (in-page, gate-tab.ts, 60 trials) | 57/60, (c) 0/min, loop p10 73/s; logout confirmed, cairn_ashes staged, gate window closed |
| Live frame | PASS: cairn_ashes's app window the only window, maximised and in front of :10 |
| Recording | 1,362.6 s, 1920x1080 yuv420p, 40,879 frames, 0 dropped |
| Player count / per address | ~1,182 online and 45 cairn* accounts across all addresses at 20:23Z; bbs at most 43 with the droppers (rs/41); the twin a separate address |

**Where the ticks went.** 665 = 2 (login to the first step) + 6 (S00, ticks 2-8, including turning
run on) + 4 (`nolog`: arrived before log 0 turned public) + 1 (to the first light) + **652** (the
line: 157 logs, 6 failed rolls). The start overhead was **13**, against 10 in the lab and 9 in the
model: S00 took 6 (lab 3; 4 on the demo earlier) and the login landed 4 ticks early, since the ~8 s
launch-to-login is about 18 ticks at 400 ms, not 20.

Per band (ticks / fires / failures): fm-01-15 12 / 2 / 5; fm-15-30 20 / 4 / 1; fm-30-45 28 / 7 / 0;
fm-45-60 52 / 13 / 0; fm-60-75 96 / 24 / 0; fm-75-99 428 / 107 / 0. 154 gaps at exactly 4 ticks,
one 8 and one 12 (the failures). Every light from the second on was sent on the success message and
landed at R+2; 0 slips, lost logs, resends or refused tiles; 64 level-up pages dismissed. The
droppers placed the cue on their observed period (399.8 ms; rs/274's `cuePeriod`). All 157 logs
were dropped and lit, none lost.

**The 400 ms tick changed nothing per tick.** 4.00 ticks a log held from level 30 to 99. Wall
time is 4/3 of a 300 ms run (about 4.5 min). The harness and droppers ran with
`SPEEDRUN_TICK_MS=400`, so `waitUntil`'s tick guards and fm-row's nominal period match the server.

### The first launch spent a name (cairn_embers)

The first launch, cairn_embers at 20:27Z, logged in on time to an **empty row** and stood there
about a minute (159 ticks of playtime, no Firemaking row). There were two faults in the launch path,
not in the code under test:
- **The droppers' go file was not JSON.** It was written with `echo` through three layers of shell
  quoting, which stripped its double quotes (`{v:1,ms:...}`). fm-row's reader rejected it, so no
  dropper started, but tick-wait only checks that the file exists, so the launch fired anyway.
- **The lap string was unquoted** in the harness's tmux command, so the shell split it at the first
  `;` (one 5-tile run, no `--log`, no log file).
Nothing was dropped, so no logs were lost and the six packs served cairn_ashes unchanged. Fixed in
the procedure: the cue is written by a script that writes and re-reads the JSON (no cue counts
until it parses), the lap is passed from a file as one quoted argument, and the exact launch line is
**dry-run on the twin with no login** (printing its parsed argv) before every attempt.

### Procedure deltas from rs/269's (steps 5-7)

- **Loading** (rs/41's approval): woodcutters to cairn_mule2 at Draynor, mule2's `kits` giver with
  labelled kit ids (`cairn_d0N+rs439`), each dropper's `kits` `load` receiver one at a time (kits.md,
  'Loading full packs'). mule2's bank was read by id before and after (identical apart from the
  logs). One receiver failed on a client state stall before any trade, and its retry was clean.
- **The cue-to-launch hop** runs from a twin ssh session opened in advance and armed on stdin, fired
  the moment tick-wait on bbs prints T0 + N: about 40 ms bbs to twin, 77-139 ms round-trip guard
  (abort over 250). A fresh ssh connect costs 1.1-1.9 s (3-6 ticks), so it is never used for the
  launch. Ssh to the twin and bbs goes through `local` only; nothing timed runs there.
- **Launch offset:** T0 + 74 observed ticks at 400 ms landed the login 4 ticks early. Use **T0 + 78**
  at 400 ms (i), and a later offset rather than an earlier one: late costs no playtime, early does.
- **S00 on the clock** took 6 ticks here, not 3-4. Its run toggle (`S00:run`) is one of them (r: the
  note row at tick 8).

## Demo procedure

1. The droppers cairn_d01-d06 are loaded (one inventory each, d06 with the spares) and logged out on
   z=3220, x 3232-3237, beside the row and off its tiles (rs/237). rs/41 gets a heads-up at the
   claim.
2. bbs: a deploy folder of its own, `git -C ~/rs-fleet archive <dropper commit> | tar -x`, `bots/`
   removed, `bun install` at the root **and `bun install --frozen-lockfile` in
   `server/webclient`** (the lite client's packages), `DEPLOYED_FROM` written. Check before the
   claim, and record: the deployed `fm-row.ts` blob (`git hash-object`) equals the dropper commit's,
   skipOccupied off, and the six launch configs pass `parseLaunchConfig`, `fmRowOptions` and
   `checkBotEnv`, on gateway ports free on `ss -ltn` (7740-7745; the fleet owns 7790-7799).
3. Twin (`ubuntu@$RS_TWIN_HOST`, HOST.md's ssh line): the leftover check, `rs-claim status` free,
   the attempt worktree, the stack (RUN-HOST.md step 3; page server from the worktree, Chrome as an
   `--app` window on cairn_burns's bare page), the served page carrying the branch's programs
   (`createProbe.params` `["trials","maxWait","dirs"]`). Then the claim at once:
   `rs-claim take rs/NNN 2 MINUTES "firemaking attempt"`. Then the recording and the live view.
4. Gate, off the clock: rs/96's direct CLI on cairn_twin (`--json`), then
   `speedrun/tools/gate-tab.ts cairn_twin --trials=60 --stage=cairn_burns` with `DISPLAY` set. Stand
   down if either fails. The direct JSON must be under 10 minutes old at the harness's start.
5. bbs: one `speedrun/helpers/standalone.ts` launcher per dropper (its own port and run directory,
   `botsDir` the fleet's, the account `final`), ROLE_OPTIONS `{tiles, parts: 6, part: k, restock:
   {kind: 'held'}, start: 'cue', cueAt: 'written', cueDir}`, bounded `timeout --kill-after=30s
   25m`. Wait for `helpersReady: true` and each role's `"phase":"armed"`.
6. Scout: `speedrun/tools/row-scout.ts --tiles=<lap> --bots-dir=<fleet bots>` on d01 and d02's
   gateways. It blocks on a loc (a fire, or any other) or a log on a planned tile, or a tile no
   dropper saw. Other ground items and players on the row are reported, not refused. No cue unless
   clear.
7. T0 and the launch, placed on observed ticks: on bbs, start `speedrun/tools/tick-wait.ts
   cairn_d01@7740 --bots-dir=<fleet bots> --cue=<cueDir>/fm-row-go.json --after=71`, write
   `fm-row-go.json` (`{v: 1, ms}`, through a temporary file and `mv`), and the moment tick-wait
   exits 0, launch the harness on the twin: `rehearse.ts --skill=firemaking --bot=cairn_burns
   --to=99 --gate-json=<direct JSON> --claim-owner=rs/NNN --skill-opt=tiles=<lap>`, with
   `DISPLAY` set, bounded `timeout --kill-after=30s 10m`. Why 71: the login landed about 23 ticks
   after the launch in rs/269 (pre-flight checks, live frame, login), log 0 turns public at T0 + 101
   and the first light wants about 5 ticks from login, so launch at about T0 + 74. The ssh hop from
   bbs's result to the twin costs about 3 more (i). The harness logs out the tick 99 is seen.
8. After: the droppers' `stopped (logout: out)` lines, `tab-logout.ts cairn_burns` (expect `no
   tab in game`), stop the recording, stop the stack, the leftover check on the twin and bbs,
   `rs-claim release rs/NNN` (tell whoever waits on the twin), the hiscore row (category 12)
   against the tick log.

## Divergences from STEP-MANIFEST entry 16

Entry 16 expects 695 (best 650) for S03's 1-99. The lab line is the same model; S03 learns from
this that a dropped row at 4.00 ticks a log holds across 157 logs including turns and level-ups,
with 5 ticks of fixed cost from a standing start beside the row. On the demo (rs/269, about 1,700
players, strangers standing on the row) the row held exactly 4.00 ticks a log from level 30 to 99
as well, with no stolen log and no slip: S03's 1-99 measured 683 ticks of playtime from a parked
login (690 on the row including the claim's 7), with 18 of them an avoidable early login. With the
launch on observed ticks, this run's rolls give about 665 from a parked login (i).
