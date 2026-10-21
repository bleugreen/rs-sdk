# In-page tick programs

The speedrun's reactive steps (knife-on-log tick manipulation for Mining, Fishing
and Woodcutting, the pickpocket re-click, Agility's next-obstacle click) run as
**tick programs inside the browser webclient page**. A program reacts on the tick
the page has just decoded and sends its packets in the same pass, so no gateway hop
sits on the reaction path. The SDK starts a program with parameters, watches its
counters in the published state, and awaits its end.

Why: from Ashburn the window between a tick's output and the server's next input
read is about 50 ms median (cairn://p/rs/83, `docs/speedrun/research/demo-latency.md`
on rs/85's branch). A reaction relayed page to SDK to page misses it about half
the time, and the reactive steps are worth roughly 3,000 ticks over the route.

## Design

- **Where it runs.** `Client.setOnGameTickCallback` fires once a whole tick is
  decoded (cairn://p/rs/82), inside the pass that decoded it and before that pass
  flushes. `BotOverlay.onGameTick` collects the state it is about to publish, hands
  it to `ProgramHost.onTick`, then publishes it with the program's status. Packets a
  program writes through `ActionExecutor` leave in that flush. Since cairn://p/rs/113
  (#90) the game socket's message wakes the loop, the tick is decoded on arrival and
  the loop flushes right after it, so a program decides under 1 ms after its frame
  arrives (it waited for the next loop pass before: p50 8 ms, p90 12 ms). Programs
  were unchanged by that; they only ever see the decoded-tick callback.
- **Runtime** (`server/webclient/src/bot/programs/runtime.ts`). Programs register by
  name. One runs at a time, because each reactive step owns the player's interaction
  and the tick's packets, and starting a program replaces the running one. A program
  is a state machine with `onTick(ctx)`. `ctx.send` executes an overlay action now,
  within a budget of **5 packets per tick**, the engine's `USER_EVENT` limit
  (`NetworkPlayer`, `ClientGameProtCategory`): a sixth would silently land a tick
  late, so it is refused and counted as `deferred`. A program that throws or reports
  no progress for its stall window faults instead of escaping into the game loop.
- **Status** (`state.program`, `window.rsPrograms.status()`). It carries the run id,
  phase (`running`, `done`, `fault`, `stopped`, `replaced`), counters and gauges,
  packets, `deferred`, `skippedTicks` (ticks the page decoded together in one pass),
  the slowest `onTick`, and the result. An ended run also carries its last 40 log
  lines (`logTail`), because the production bundle strips console calls. For the host
  gate's in-run rule it adds:
  - `frames`: intervals between server frames, from the raw websocket arrival of each
    PLAYER_INFO message (`ClientStream.receivedAt`), with **catch-ups** (an interval
    under 150 ms right after one over 350 ms, i.e. a server overrun) in total, in the
    last minute and per minute, plus p50, p90 and max;
  - `publish`: the page's publication intervals, in the same shape;
  - `react`: from the newest frame's arrival to the program's decision (p50, p90, max);
  - `loops`: the game-loop rate (last, p10 over the last 10 s, run minimum), which is
    the page's reaction granularity whenever decoding waits for a loop pass.
- **Driving it.** The `program` overlay action (`{type: 'program', op: 'start' | 'stop'
  | 'status' | 'list', name, params}`) rides the ordinary `sdk_action` relay, so
  `sdk/` is unchanged. `speedrun/lib/programs.ts` wraps it: `startProgram`,
  `awaitProgram` (resolves on done, stopped or replaced; rejects on a fault, a page
  that stops publishing, or a reloaded page), `runProgram`, `programCounters`, and
  `probeInPage`. With no SDK at all, `window.rsPrograms.run(name, params)` resolves
  with the final status and `rsPrograms.history` keeps ended runs. A page opened with
  `?program=<name>&programArgs=<json>` starts that program 5 in-game ticks after login.

## Programs

Each is a port of the lite lab script named, keeping its loop logic and dropping
its harness (staff cheats, teleports, gates). Every one has a plain-loop technique
the host gate can select with the same parameters.

| Name | Port of | Parameters (main) | Plain fallback |
|---|---|---|---|
| `probe` | `speedrun/lib/hostgate.ts` `probeOnTime` | `trials`, `maxWait` | n/a |
| `knife-mine` | `tickmanip-mine.ts` | `steps` (stand>rock pairs), `respawn`, `ores`, `starter: 'knife' \| 'none'` | `starter: 'none'` (plain and adjacent-rock transitions) |
| `knife-cycle` | `tickmanip-cycle.ts` | `method` (`fly`, `willow`, `oak`, `tree`, `cage`, or an object), `rolls` / `untilLevel` / `maxTicks`, `reanchor` | `technique: 'plain'` |
| `pickpocket` | `thieving-pickpocket.ts` (`--eat=auto`) | `npc`, `rolls`, `food`, `eatBelow`, `forcedBelow` | n/a: it clicks every tick |
| `agility` | `agility-course.ts` | `course` (`gnome`, `barbarian`, `wilderness`, or an object; `agility-courses.ts`), `laps` | `technique: 'plain'` waits `settleTicks` after each obstacle |

Notes that differ from the lite scripts:

- The knife cycle anchors its first lock on observed xp, so it needs no warm-up walk.
  An xp drop seen **off the predicted phase** (a late starter, or two ticks decoded in
  one pass during a server overrun) re-anchors the schedule on that roll at once
  (`phaseResyncs`), so a slip costs that one roll instead of a drift back into phase.
- On normal trees the browser state lists a felled tree for one tick after its log,
  so the program treats a log itself as the fall (a normal tree always falls on its
  first log) and avoids that tree for a few ticks. It also avoids for 100 ticks a tree
  that yields nothing for 30 (often one out of reach).
- Mining plans each transition on the label that shows the previous roll's xp (closed
  loop, lead 0), so a late roll costs only its late ticks. The plain fallback's
  adjacent-rock trick needs walking distances, which the page can't compute; steps
  take an optional `tiles`, else the straight-line tile distance is used.
- Pickpocket eats only in a success window (with the click that follows a success, at
  least 4 ticks after the stun ended), and at once only when HP is at or below
  `forcedBelow`. A bite during a stun costs 3 ticks (`thieving.md`).

## Lab

`docs/speedrun/scripts/tickprog-lab.sh` runs one batch: the engine and gateway on a
port block, this checkout's bundle, the bot's page in Chrome (`tickprog-tab.ts`,
headful unless `HEADLESS=1`), then each `tickprog-measure.ts` mode (`probe`, `mine`,
`fly`, `willow`, `tree`, `pickpocket`, `agility`), plus `wedge` (the watchdog check,
`tickprog-wedge.ts`) and `throttle` (Chrome background throttling,
`tickprog-throttle.ts`). The tab driver prints one `[program] end {json}` line per
finished run, read from `rsPrograms.history`, and samples rendering once a second.

```sh
LAB_BLOCK=tickmanip NODE_TICKRATE=300 bash docs/speedrun/scripts/tickprog-lab.sh tp97 \
  probe:--trials=60 mine:--ores=200 fly:--level=20:--until=99 pickpocket:--level=55:--rolls=300 agility:--laps=10
```

Respawn 13 (the demo at about 1,262 online) needs `player_count.rs2` pinned locally,
which is lab-only and never committed (`mining.md` section 4).

## Measured

Local engine at `NODE_TICKRATE=300`, staff level for setup, in a **visible** Chrome tab
on bgsrv-mac (macOS, 12 cores), 2026-10-21 03:18-05:32 PDT. The load average is in
each row. The tab held 71 fps and 71-75 game loops/s throughout, with no main-thread
stall over 50 ms in all but a handful of seconds. Every program run had 0 deferred
packets, 0 skipped ticks, and at most 0.9 ms per `onTick`. The overlay column is
rs/82's figure (LAB.md); the lite column is from the skills docs.

| Measure | In-page program | rs/82 overlay | Lite | Load |
|---|---|---|---|---|
| Latency probe, 60 trials | **60 at 1 tick** (three runs); decoded-tick interval p50 299-300 ms, p90 308-310 | 60 at 1 | 60 at 1 | 2.2-4.2 |
| Frame arrival to program decision (game-loop wait, before rs/113) | p50 7-9 ms, p90 12-13, max 17 | | | 2-3 |
| Same with rs/113's decode-on-arrival (#90), 2026-10-21 07:45 PDT | **under 1 ms** (max 0.6); probe 60 at 1 tick; loops/s 73-76; frame p90 310 ms, 0 catch-ups | | | 3.9-4.0 |
| Knife iron after #90, 200 ores | 3.015 ticks per ore (193 of 194 gaps at 3), 199 of 200 on the predicted tick, 0 slips | | | 3.3-3.5 |
| Knife iron, respawn 13, 5-rock rotation, 200 ores | **3.00 ticks per ore**, 194 of 194 gaps at 3, 200 of 200 on the predicted tick | 3.05 | 3.00 | 2.5-3.5 |
| Same, before the closed-loop fix to one slip | 3.12 (3:191 6:2 21:1, one slip) | | | 3.1 |
| Iron, plain fallback (`starter: 'none'`), 100 ores | 4.03 (4:93 7:1) | | 4.94 (no starter) | 3.1-4.1 |
| Knife fly, Lumbridge, level 20 to 99, 690 catches | **4.26 ticks per catch over the span** (4.10 mean gap; 3:493 6:132 9:29), 68 level-ups, 10 spot moves | 4.16 | 4.28 | 3.2-7.5 |
| Knife willow, rune axe, level 99, 150 logs | 4.83 over the span (4.60 mean gap; 3:80 4:9 6:32 7:2 9:10 12:1 15:2 16:1) | | 4.23 (3:85 4:8 6:25 7:2 8:2 9:7 12:2) | 2.5-5.6 |
| Knife willow, 500 logs | 4.68 over the span (4.59 mean gap), 59 depletions | | | 2.3-3.0 |
| Knife normal trees, bronze axe, from Woodcutting 1, 150 logs | **7.24 ticks per log** over the span (6.80 mean gap) | | | 2.2-2.9 |
| Normal trees, plain fallback, from level 1, 100 logs | 11.60 | | | 2.6 |
| Knife normal trees, bronze axe, Woodcutting 64, 150 logs (the demo account's level) | **6.91** over the span (5.50 mean gap) | | | 1.6-2.8 |
| Normal trees, plain, Woodcutting 64, 100 logs | 9.92 | | | 1.7-2.4 |
| Pickpocket, Knight of Ardougne, level 55 held, 300 rolls | **0.173 rolls per tick**; after a success 2 ticks on 171 of 188; after a fail 11 on 79 of 111; 15 eats, 2 forced | 0.170 | 0.167 | 4.8-7.5 |
| Agility, Wilderness course, level 99, 10 laps | **66 ticks per lap** on all 9 measured laps | | 66 | 3.8-6.1 |

Reading the willow row: both runs hold the 3-tick lock, and nearly every gap is a
multiple of 3. The difference is how many 3-tick rolls yield a log. Fitting a
geometric success rate to the multiples of 3 gives 0.665 per roll in-page and 0.726
on lite, about 1.3 standard errors apart, which is the server's chop RNG. At 0.70 a
locked loop costs 3 / 0.70 = 4.3 ticks per log. The 500-log run reads the same as the
150-log run, so the program's timing matches lite.

The watchdog (`speedrun/lib/session.ts`) still catches a wedged tab while a program
runs: its first relaunch verdict came 3.1 s after the page's main thread was blocked
(`tickprog-wedge.ts`).

**Chrome background throttling** (`tickprog-throttle.ts`, a continuous in-page probe as
the reaction meter, bgsrv-mac with a display, 2026-10-21 04:50-05:08 PDT, load 2-3):

| Window state | Trials on the next tick, throttling flags off / stock Chrome | Game loops/s during the phase |
|---|---|---|
| visible 20 s | 75 of 75 / 75 of 75 | 73-76 |
| minimised 30 s | 112 of 112 / 112 of 112 | 72-75 |
| hidden behind another tab 30 s | 108 of 109 / 110 of 110 | 72-75 |
| covered by another window 30 s | 110 of 110 / 110 of 110 | 72-74 |
| minimised 6 min (past Chrome's 5-minute intensive throttling) | 1,212 of 1,212 / 1,211 of 1,211 | 72-74 |

Chrome didn't throttle this tab in any state; why was not established here (the page holds
live websockets, which exempt a tab from some throttling). That is macOS with a physical
display. The run machine (a VM over remote desktop) may differ, so the run-night
gate keeps the loop-rate check, and rs/113's decode-on-arrival removes the dependence on
the loop rate for reactions.

### Against the demo from Ashburn

cairn://p/rs/95 runs the in-page probe and 100-200 knife cycles on normal trees west of
Lumbridge castle (3194,3230; `knife-cycle`, `method: 'tree'`, an account at Woodcutting 64)
from an Azure eastus runner through `server/webclient/proxy.ts` and headless Chrome. Pass
is 60/60 (floor 58/60) on the probe and a knife cadence within 5% of the local figure at
the same level (6.91 ticks per log). Results: pending (rs/95 dispatches once this branch
is on GitHub).
