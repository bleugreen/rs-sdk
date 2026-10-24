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
  is a state machine with `onTick(ctx)`. `ctx.frames` lists the server frames the pass
  decoded, each with its tick and the `Date.now()` instant its websocket message arrived
  (derived as `Date.now() - (performance.now() - receivedAt)`, so it stays on the wall
  clock other processes on the machine read, where `performance.timeOrigin` can drift from
  it over a long session). `ctx.send` executes an overlay action now,
  within a budget of **5 packets per tick**, the engine's `USER_EVENT` limit
  (`NetworkPlayer`, `ClientGameProtCategory`): a sixth would silently land a tick
  late, so it is refused and counted as `deferred`. A program that throws or reports
  no progress for its stall window faults instead of escaping into the game loop.
  The test-only start parameter `hold` (a share in [0, 1]) holds that share of
  starter bundles to the next tick: a program marks a bundle with `ctx.starter()`
  (knife-cycle, before knife on logs), its sends queue, and they go
  out first on the next tick, counted in `held`. It reproduces the lab scripts'
  `--inject-late`; unset, `ctx.starter()` does nothing.
- **Status** (`state.program`, `window.rsPrograms.status()`). It carries the run id,
  phase (`running`, `done`, `fault`, `stopped`, `replaced`), counters and gauges,
  packets, `deferred`, `skippedTicks` (ticks the page decoded together in one pass),
  the slowest `onTick`, and the result. An ended run also carries its last 40 log
  lines (`logTail`), because the production bundle strips console calls.
  `marks` carries per-event tick stamps while the run goes (`ctx.mark(name)`):
  `marks[name] = {count, ticks}`, where `count` only grows during the run and `ticks`
  holds the last 64 stamps. A poller keeps the `count` it last saw and takes that many
  fewer from the end of `ticks` (`speedrun/lib/programs.ts` `marksSince`, which also
  reports stamps lost to a poll slower than the window). A stamp is the decoded tick the
  program saw the event on, the last of them when the page decodes several in one pass.
  Counters and gauges stay numbers; marks exist because a count cannot time each event
  when several land between polls. `shared` carries structured data a program publishes
  for its driver while it runs (`ctx.share`, by reference, so what `onStop` adds shows in
  the final status too); the Runecraft program's turns and beacons ride there. For the host
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
  | 'status' | 'list' | 'input', name, params, data}`) rides the ordinary `sdk_action` relay, so
  `sdk/` is unchanged. `input` hands `data` to the running program's `onInput`, which
  validates it (a refusal fails the action and leaves the run going) and applies it on its
  next tick: the channel for what only the driver can see, such as which givers are loaded.
  `speedrun/lib/programs.ts` wraps it: `startProgram`, `sendProgramInput`,
  `awaitProgram` (resolves on done, stopped or replaced; rejects on a fault, a page
  that stops publishing, or a reloaded page), `runProgram`, `programCounters`, and
  `probeInPage`. With no SDK at all, `window.rsPrograms.run(name, params)` resolves
  with the final status and `rsPrograms.history` keeps ended runs. A page opened with
  `?program=<name>&programArgs=<json>` starts that program 5 in-game ticks after login.
- **Undeclared parameter keys fault.** Each factory declares the start keys it reads
  (`createKnifeCycle.params = [...]`, just above the factory), and the runtime adds its
  own `stallTicks` and `hold`. A start carrying any other top-level key faults through the
  bad-parameters path, naming the keys and the program (`bad parameters: knife-cycle does
  not declare dropeach (accepts: ...)`), before the factory runs. An unknown key is
  either a typo or a page built from a commit without that program change (rs/211: a
  twin served from main would have dropped mission-branch opt-ins and run the plain
  program), and either way the run is not the one asked for. `register` refuses a factory
  without a declaration, and `index.test.ts` checks each declaration against the
  `params.<key>` reads in its program's module, so a new opt-in is declared or the test
  fails. Nested values (a `method` or `course` object) are the factory's own to validate.

## Programs

Each is a port of the lite lab script named, keeping its loop logic and dropping
its harness (staff cheats, teleports, gates). Every one has a plain-loop technique
the host gate can select with the same parameters.

| Name | Port of | Parameters (main) | Plain fallback |
|---|---|---|---|
| `probe` | `speedrun/lib/hostgate.ts` `probeOnTime` | `trials`, `maxWait` | n/a |
| `knife-mine` | `tickmanip-mine.ts` | `steps` (stand>rock pairs), `respawn`, `ores`, `starter: 'knife' \| 'none'` | `starter: 'none'` (plain and adjacent-rock transitions) |
| `knife-cycle` | `tickmanip-cycle.ts`; `bury` from `bones-wc.ts --mode=knifebury` | `method` (`fly`, `willow`, `oak`, `tree`, `cage`, or an object), `successes` / `untilLevel` / `untilXp` (game xp) / `maxTicks`, `reanchor`, `trees` (the loc tiles reached from the standing tile), `bury` (oak and willow) | `technique: 'plain'`; with `bury`, plain + bury; opt-in `followSpot` (re-click a moved spot on the label that shows its new tile) and `dropEach` (drop the product on the label that shows it, with the re-click, both landing on R+1) |
| `pickpocket` | `thieving-pickpocket.ts` (`--eat=auto`); `stunActions` from `stun-pack-thieve.ts` (rs/106) | `npc`, `rolls`, `food`, `eatBelow`, `forcedBelow`, `stunActions` (`bury`, `charge`, `arrows`, or action objects), `stunWindow`, `stunPerTick` | n/a: it clicks every tick |
| `agility` | `agility-course.ts` | `course` (`gnome`, `barbarian`, `wilderness`, or an object; `agility-courses.ts`), `laps` / `maxTicks` / `untilLevel`, `startStep` (a name, or `auto`: from the tile and plane, by the course's `zones`), `food`, `eatBelow`; opt-in: `untilLevelAt: 'lap'` (the level end waits for the lap's close on the ground; while finishing the lap a pipe another player holds sends the click to the other pipe), `eatGap` (eats in any phase, at most once per `eatGap` ticks, and ends `no-food`) with `eatAt: 'land'` (an eat due during the walk to an obstacle waits for the next click tick, unless HP is within one skeleton hit of death), `restockBelow` (ends `low-food`), `protect` (`hold`, `near`, `flick`, with `protectRange`, `protectNpc`, `flickGap`), Wilderness watch: `pauseFor` (`none`, `threat`, `any`), `playerRadius`, `threatTargetRange`, `threatCloseTiles`, `threatCloseTicks` | `technique: 'plain'` waits `settleTicks` after each obstacle |
| `rc-cycle` | `runecraft-cycle.ts --mode=tuned/robust` (the scored half) | `untilLevel` / `untilXp`, `schedule` (default `robust`), `givers`, `open` (5), `lead` (3) | the stock 15-tick reacting cycle (SDK side) |

### The Runecraft hand-off (`rc-cycle`)

The scored account stands south of the altar and a giver beside it trades in 27 essence
per craft (`skills/runecraft.md` section 4). The givers are lite processes on the run
machine (`speedrun/helpers/altar-giver.ts`, rs/117), and the two sides meet in `cue.json`
(`altar-cue.ts`). The page can't write files and can't read the givers' status files, so
the step that drives the program relays both ways, and the program owns the schedule:

- **In:** `sendProgramInput(sdk, {givers})` with the givers that are ready or armed, in the
  room and beside the scored tile, oldest `readyAt` first, each with its `readyAt` and
  `schedule: 'tuned'` only if it logged in before the scored account. A giver that has
  given is skipped until it is offered again with a newer `readyAt`, so a stale status file
  can't make the program reuse a giver that is still restocking.
- **Out:** `status.shared` (`RcShared`): the turns (`{giver, T, schedule}`), the last 8
  frames as beacons, each turn's outcome, and `stop` once the run ends for any reason.
  `rcCueFields(status)` gives `CueWriter.write`'s fields and a `key`; rewrite the cue when
  the key changes. A new program run is a new cue session.

T is the scored account's tick for a craft; the turn after it opens the trade on T+5. The
program plans each turn when it sends the craft before it, which leaves the giver 4
frames to see it. With nothing in flight it derives the next move from what it observes:
essence held means craft now, a trade open gets declined, and otherwise it plans a turn whose request
lands `lead` frames ahead. A page reload therefore starts over from game state, never from
stored turns. The run stops on `untilLevel` or `untilXp` (rs/127's rule).

Every packet goes out on the frame for the tick before it lands, after a check of the
decoded trade state: the trade open with the giver (tuned accept), its essence offered
(robust accept and confirm), the confirm screen up (tuned confirm and craft), the trade done
or waiting on the giver's last confirm (robust craft). A failed check declines the trade,
reports the turn `missed`, and moves the giver to the back of the queue.

- **Tuned to robust in the turn.** On a tuned turn, the T+K+1 frame shows the processing
  order: the confirm screen means the giver was handled first; the offer screen with the
  giver's offer and accept means the scored account was first, and the giver's offer reset
  its accept. In that case the program sends accept and confirm for T+K+2 and crafts on T+K+3,
  which is robust's tail. The giver's single tuned confirm on T+K+2 comes after them in that
  tick, so the trade completes and the turn costs 8 instead of the declined trade a blind
  tuned schedule gets (0 of 21 in rs/117's lab). Measured: 30 of 30 such turns finished at 8
  with no declined trade (the bucket-2 row under Measured). Robust turns record the order too: the trade is
  done by the T+K+2 frame only when the scored account was first. `results[].order` and
  `result.orders` carry both.
- **Re-anchoring.** A craft whose xp shows a tick late moves the planned turn to the real T
  (the giver acts on the newest turn naming it). A craft with no xp by the tick after it was due
  binds the held essence at once and moves the turn with it.
- **Processing order** is the player loop's: buckets by the client IPv4 address's last octet & 7
  (on the demo, `fly-client-ip`), walked 0 to 7, each in login order, and a relog re-appends at
  its bucket's tail (`World.ts` processLogins, `datastruct/HashTable.ts`). A giver in a lower
  bucket than the scored account precedes it whatever the login order; on one machine they share
  a bucket and login order decides. The driver can grant tuned from the observed `order` of a
  giver's last turn rather than predict it.
- **Outcomes.** `gave`, `missed`, `late` (the page decoded a step's frame together with the
  next one) and `no-giver` (not beside the scored tile when the request was due). The
  giver's own outcome is in its status file. The run faults after `maxFailures` (6) turns in a row fail;
  waiting for a giver is not a stall.

### What the knife cycle reports

A **roll** is one swing of the gathering cadence: every 3 ticks with the knife locked,
every `plainCycle` ticks on the plain loop. It succeeds with the method's catch chance p.
The program sees only the successes (xp drops, one log or fish each), so it reports:

- `successes` (counter and result) and `ticksPerSuccess`: ticks per log or fish, the mean
  gap between xp drops outside re-bootstraps and resyncs. This is the cadence divided by p,
  so it is **not** comparable with the 3 and 4 of the loops. The `successes` parameter stops
  the run after that many.
- `ticksPerExpectedRoll` (result and gauge, on every preset): the same gaps over the rolls
  expected for them, each success weighted 1/p at the level it was rolled at, as
  `scripts/tickmanip-demo-report.ts` does. This is the figure to set against 3 (knife) and
  `plainCycle` (plain); on normal trees it carries the walk to the next tree as well. The
  Woodcutting presets carry `trees.dbrow`'s bounds for every axe and take p from the axe the
  game would swing (the best one worn or carried, rune first, as `woodcutting_axe_checker`
  picks it), reported as `axe`; with no axe seen the figure is NaN. `cage` uses lobster's
  bounds and `fly` salmon's then trout's.
- The lost-lock window comes from the same p: a locked cadence rolls every 3 ticks, so the
  window is 3k ticks for the least k with (1-p)^k at most 0.005, never below the preset's
  `lockWindow`. A preset whose p was missing or too high (oak and willow on a fixed 18 ticks
  before the axe tables) trips on honest misses: a bronze axe on oak at level 60 has p 0.285,
  so 6 misses in a row, 13% of the time, read as a lost lock; its window is now 48 ticks.
- `marks.successes`: the tick of every success while the run goes (count and last 64
  ticks), so a host poller can stamp each log or fish, for example to price the loop in
  catch-up minutes against calm ones.

rs/130's run-host reading on the demo's normal trees is the case in point: 8.56 ticks per log
set against the plain loop's 6.44 ticks per expected roll reads as the knife losing, but the
same run is 3.94 ticks per expected roll, a win (corrected by rs/83).

Notes that differ from the lite scripts:

- `agility` ends with `result.ended` set to `laps`, `maxTicks`, `level`, `player`
  (the pause rule fired), `attacked` (a player's hit, with `pauseFor` given), `no-food` (with `eatGap`: HP at or below
  `eatBelow` with nothing to eat) or `low-food` (`restockBelow`), and faults `died` on a death or a `lifeId`
  change. `level` fires on the level tick wherever the player stands, unless
  `untilLevelAt: 'lap'` is given: then the run clicks the lap's remaining obstacles
  and ends on the tick the lap's last step completes (or at once, when it starts at
  the lap's start on the ground with the level reached), with `afterLevel` (`ticks`,
  `obstacles`) saying what finishing the lap cost. A band the player leaves for a next
  leg uses it (the Gnome band: T11a cannot leave from a platform); the run's last band
  (S17, final logout, stamp at the level-up) does not. Every other end still fires
  mid-lap. A lap joined partway (a start off the lap's first step) earns no lap bonus,
  because the course's progress varp never saw its start, so its last obstacle is done
  on that obstacle's own xp. In the Wilderness it logs every player it sees (`sightings`, with
  whether the attack rule of `pvp_combat.rs2` lets them attack us, and
  `wouldPause` counts for both rules), and splits the damage it takes into
  `fallDamage` (a fail message that tick), `playerDamage` and `npcDamage`. A
  threat is a player who can attack us at this Wilderness level and is either
  targeting a player within `threatTargetRange` tiles of us or, from off the lap
  path, has walked `threatCloseTiles` closer within `threatCloseTicks` ticks. The
  approach is judged by the player's own movement against our current tile, so our
  walking along the lap does not count. `levelTicks` records the tick each level was
  reached, so any band is priced from one run.

- The knife cycle anchors its first lock on observed xp, so it needs no warm-up walk.
  An xp drop seen **off the predicted phase** (a late starter, or two ticks decoded in
  one pass during a server overrun) re-anchors the schedule on that roll at once
  (`phaseResyncs`), so a slip costs that one roll instead of a drift back into phase.
- On normal trees the browser state lists a felled tree for one tick after its log,
  so the program treats a log itself as the fall (a normal tree always falls on its
  first log) and avoids that tree for a few ticks. It also avoids for 100 ticks a tree
  that yields nothing for 30 (often one out of reach).
- **Bury inside the knife cycle** (`bury`, the S07 bones): the roll label carries knife,
  button, drop and a Bury, and the tree click goes alone two labels later, landing on the
  roll tick itself. A bone with no tree list loses the lock whenever the nearest live tree
  needs a walk, so the variant goes with `trees`. Schedule, rules and measurements are in
  `skills/woodcutting.md` section 9.
- **Plain + bury** (`technique: 'plain'` with `bury`, the S07 fallback when the host gate turns
  the knife off; the gate flips `technique` only, so a step passes `bury` and `trees` to both
  techniques). It is `bones-wc.ts --mode=plainbury`'s placement on the 4-tick clock: on the roll
  label R, a drop and a click; on R+1, a bury (lands R+2, delays the player through R+3); on R+3,
  the click alone, which lands on the roll tick and rolls at once. Two in-page differences from
  the lite script:
  - **Falls.** Nothing here writes the clock, and a roll that fells the tree leaves it on the
    roll tick (`woodcut.rs2` `get_logs` returns without `p_oploc`). The page still lists the fallen
    tree on R, so a click there to the same tree hits the stump, and the next live click rolls
    3 ticks after it lands, off the lattice (measured: 16 lost bone cycles in 600 ticks at oak).
    R's click therefore goes to another standing tree in `trees`, which re-arms the clock whether
    or not the rolled one fell (measured: 2-3 fall restarts in 600 ticks, from moments with a single
    tree standing). A fall seen after R sends no bone that cycle and re-anchors on the next xp.
  - **Woodcutting level-ups.** The page shows the level-up page on R+1. The cycle answers it
    with a dismiss and a click and carries no bone (one tick and one bone per level-up). Sending
    the dismiss and then the bury on R+1 instead was tried and is wrong in the page: the bury
    lands, but the chop never resumes until the no-xp restart (11 resyncs, one per level-up,
    Woodcutting 87 logs against plain's 136 at oak in 600 ticks). The cause is not established.
  - **Low levels.** From WC 15, where a level-up comes nearly every log, the loop also loses the
    chop to 6-8 restarts per 600 ticks (cause not established), so it buries 0.14 bones per tick
    at 6.3 ticks per expected roll against plain's 4.8. That is still about 1.7 Woodcutting ticks
    per bone, under the booth's 2.07, but far from the 0.1-0.3 it costs at WC 60 and up.
- A non-depleting tree that falls is a switch inside the lock (`switches`), not a resync.
  With every listed tree down, no starter goes out, because its fletch would use the knife's log.
- Mining plans each transition on the label that shows the previous roll's xp (closed
  loop, lead 0), so a late roll costs only its late ticks. A depleted iron rock keeps its
  Mine option (ids 450-453), so the start excludes those ids and faults on one rather
  than cache the empty rock and slip every lap: start or restart after the respawn. The
  plain fallback's adjacent-rock trick needs walking distances, which the page can't
  compute; steps take an optional `tiles`, else the straight-line tile distance is used.
- **Bury on a Mining stay** (`bury`, the same parameter and bone-selection code as
  knife-cycle's, `util.ts`): a knife stay entered by a move of at most 2 tiles (or a
  restart) sends knife, button, drop and a Bury on the roll label and the rock click alone
  two labels later, so it still rolls 3 ticks on. On the `stay2` lap that is one bone per
  15 ticks. Moves never take a bone (+2 ticks each), the stay after a 3-tile move stays
  plain, and under `starter: 'none'` the option is inert. Schedule and reasons:
  `research/bones-placement.md` section 4 and the knife-mine.ts header.
- Pickpocket eats only in a success window (with the click that follows a success, at
  least 4 ticks after the stun ended), and at once only when HP is at or below
  `forcedBelow`. A bite during a stun costs 3 ticks (`thieving.md`).
- **Stun actions** (`stunActions`, off by default, so the program is unchanged without
  them): rs/106's stun pack (`research/stun-pack.md`). On each failure the program sends,
  ahead of its knight click, actions resolved from that tick's inventory and skills, on the
  window `stunWindow` = [from, to] of offsets k from the tick whose state shows the failure
  (default [2, 7]; k 0 and 1 land while delayed, and xp from k 8 opens a level-up page on the
  attempt tick). The list is a priority order filling up to `stunPerTick` slots (default 4,
  one packet of the 5 stays for the click). Each template is an item option (`item`,
  `option`), item on item (`item`, `on`), spell on item (`spell`, `on`) or a button
  (`component`), with optional `needs` (other items, e.g. runes), `uses` (per fire), a skill
  gate (`skill`, `from`, `below`) and `delay`: `none`, `tick` (p_delay(0), as Bury: sent
  last in its tick, and the next tick sends none) or `action` (writes the action delay, as
  eating: it fires and counts as costly). Presets: `bury`, `charge` (Charge while Magic is
  below 99 and runes last) and `arrows` (the best arrowhead tier the Fletching level allows,
  on headless arrows). `['bury', 'charge']` reproduces rs/106's measured plan: three Charges
  and a bury on k 2, 4 and 6, nothing on 3, 5 and 7; with no bones, four Charges on every
  window tick. An open page is resumed first and takes one slot; an open interface (a trade)
  skips the tick's actions. Nothing is remembered between stuns but the failure's tick, so a
  restarted program picks the pack up from game state. The status counts `stunFired`,
  `stunRejected`, `stunCostly` and `stun:<name>`, and the result carries a `stun` summary
  (stuns, dry stuns, fired per stun, by action). Template code: `programs/stun-actions.ts`.

## Lab

`docs/speedrun/scripts/tickprog-lab.sh` runs one batch: the engine and gateway on a
port block, this checkout's bundle, the bot's page in Chrome (`tickprog-tab.ts`,
headful unless `HEADLESS=1`), then each `tickprog-measure.ts` mode (`probe`, `mine`,
`fly`, `willow`, `tree`, `pickpocket`, `agility`), or a step-module driver given by its
`.ts` path (`speedrun/lab/measure-fishing.ts:fly:--level=78`), plus `wedge` (the watchdog check,
`tickprog-wedge.ts`) and `throttle` (Chrome background throttling,
`tickprog-throttle.ts`). The tab driver prints one `[program] end {json}` line per
finished run, read from `rsPrograms.history`, and samples rendering once a second.

```sh
LAB_BLOCK=tickmanip NODE_TICKRATE=300 bash docs/speedrun/scripts/tickprog-lab.sh tp97 \
  probe:--trials=60 mine:--ores=200 fly:--level=20:--until=99 pickpocket:--level=55:--rolls=300 agility:--laps=10
```

`pickpocket:...:--pack=bury,charge[,arrows]` runs the stun pack with a `::give` kit (dragon
bones, runes, staff of fire, Magic 80 held, Mage Arena set; rune arrowheads at Fletching 75
held for `arrows`) and tops bones and sharks up by `::give`, off the scored clock.

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
| Knife iron, respawn 13, `stay2` lap, Mining 64, rune pickaxe, 200 ores x 2 (2026-10-21 15:00-15:13 PDT) | 3.046, 3.119 ticks per ore (3:375 4:11 6:1 21:1; one slip, in the second run) | | rs/105: 3.000 over 80 ores | 4.4-6.8 |
| Same with `bury` (dragon bones, top-up by `::give`), interleaved with the runs above, 200 ores x 2 | **3.026, 3.026** (3:382 4:4 6:2, 0 slips), **0.066 bones per tick** (80 in 1,210 ticks, one per 15.1), every bury sent landed | | rs/105: 3.052, 0.066 | 4.4-6.8 |
| Five-rock lap against `stay2` + `bury`, interleaved in one session, Mining 64, 200 ores x 3 each (2026-10-21 15:19-15:36 PDT) | five-rock 3.000, 3.124, 3.015 (3:578 6:3 21:1, one slip); stay2 + bury 3.041, 3.026, 3.041 (3:571 4:6 6:5, 0 slips, 0.066 bones per tick). Gaps alone: stay2 +0.021 per ore (one-sided p = 0.11); slip included: -0.010 (p = 0.93) | | | 5.2-9.5 |
| `stay2` + `bury`, Mining 64, 1,050 ores in one run, logs and Fletching xp watched every tick (2026-10-21 17:53-18:09 PDT, `speedrun/lab/measure-mine-logs.ts`) | **3.033 ticks per ore** over 3,184 ticks (3:1030 4:4 6:10, 0 slips, 1,036 on the predicted tick), 0.066 bones per tick; **logs 10 at start, 10 at end, no Fletching xp** (0 per 1,000 knife ticks, 95% bound 0.94); a bare knife + button control completed on its 3rd tick | | | 4.1-7.0 |
| Iron, plain fallback (`starter: 'none'`), 100 ores | 4.03 (4:93 7:1) | | 4.94 (no starter) | 3.1-4.1 |
| Knife fly, Lumbridge, level 20 to 99, 690 catches | **4.26 ticks per catch over the span** (4.10 mean gap; 3:493 6:132 9:29), 68 level-ups, 10 spot moves | 4.16 | 4.28 | 3.2-7.5 |
| Knife willow, rune axe, level 99, 150 logs | 4.83 over the span (4.60 mean gap; 3:80 4:9 6:32 7:2 9:10 12:1 15:2 16:1) | | 4.23 (3:85 4:8 6:25 7:2 8:2 9:7 12:2) | 2.5-5.6 |
| Knife willow, 500 logs | 4.68 over the span (4.59 mean gap), 59 depletions | | | 2.3-3.0 |
| Knife oak, WC 60, the three oaks from 2914,3494, 200 rolls x 2 (2026-10-21 10:52 PDT) | **3.201, 3.402** over the span, 20-31 tree falls switched in the lock | | rs/105: 3.18 (from 11.78 base xp per tick) | 2.5-3.3 |
| Knife oak + bury (dragon bones), same, 200 rolls x 4 | **3.16-3.26** over the span, **0.329 bones per tick**, every bury sent landed | | rs/105: 0.298 including trades | 2.0-3.3 |
| One session, 600 ticks per run, oak WC 60 (to 75; p(L) 0.996-1.000, so Σ1/p = logs), 2026-10-21 14:06-14:20 PDT (rs/162): knife / knife + bury / plain / **plain + bury x 2** | logs per tick 0.314 / 0.304 / 0.203 / **0.235, 0.231**; ticks per expected roll 3.18 / 3.28 / 4.93 / **4.26, 4.32**; bones per tick - / 0.329 / - / **0.205, 0.201** (0.197, 0.194 with 5 ticks of trade per 25 bones, i); plain + bury gaps 4:123 5:15 and 4:121 5:14, 0 resyncs | | rs/105 plain + bury: 0.230 bones per tick including trades | 4.4-7.2 |
| Oak from WC 15, 600 ticks per run, 2026-10-21 15:55-16:05 PDT (rs/162; p(L) 0.574 at L15 to 1.000 by L60-72): knife / knife + bury / plain / **plain + bury** | logs per tick 0.261 / 0.276 / 0.191 / **0.140**; Σ1/p 168.4 / 177.4 / 126.4 / **95.4** expected rolls, so 3.57 / 3.39 / 4.76 / **6.30** ticks per expected roll; bones per tick - / 0.329 / - / **0.143** (0.139 i). Knife + bury held through 47 Woodcutting level-ups (gaps 3 or misses, no bone lost). Plain + bury: gaps 4:44 5:28 8:1 and **8 resyncs**, with a level-up nearly every cycle; a 300-tick repeat to WC 50 had 6 resyncs. Cause not established | | | 5.1-9.1 |
| Same session, willow WC 88 (to 92-93; p(L) 0.633-0.656, rune axe), Taverley tile 2920,3406: knife / knife + bury / plain / **plain + bury x 2** | logs per tick 0.200 / 0.213 / 0.155 / **0.161, 0.168**; Σ1/p 186.8 / 199.0 / 145.4 / **151.5, 157.7** expected rolls, so 3.22 / 3.02 / 4.13 / **3.97, 3.81** ticks per expected roll (under 4 is roll luck); bones per tick - / 0.329 / - / **0.240, 0.235** (0.229, 0.224 with trades, i) | | rs/105 plain + bury: 0.238 | 3.3-6.6 |
| Knife normal trees, bronze axe, from Woodcutting 1, 150 logs | **7.24 ticks per log** over the span (6.80 mean gap) | | | 2.2-2.9 |
| Normal trees, plain fallback, from level 1, 100 logs | 11.60 | | | 2.6 |
| Knife normal trees, bronze axe, Woodcutting 64, 150 logs (the demo account's level) | **6.91** over the span (5.50 mean gap) | | | 1.6-2.8 |
| Normal trees, plain, Woodcutting 64, 100 logs | 9.92 | | | 1.7-2.4 |
| Pickpocket, Knight of Ardougne, level 55 held, 300 rolls | **0.173 rolls per tick**; after a success 2 ticks on 171 of 188; after a fail 11 on 79 of 111; 15 eats, 2 forced | 0.170 | 0.167 | 4.8-7.5 |
| Pickpocket, level 55 held, 300 rolls, plain then `stunActions: ['bury', 'charge']`, one session, 2026-10-21 15:14-15:32 PDT (rs/132) | plain **0.1785** rolls per tick (success 0.640; mean success gap 2.15, failure to next roll 11.80, 11 on 79 of 107); pack **0.1656** (success 0.600; 2.16 and **11.83**, 11 on 84 of 120). At the predicted 0.607 success both are 0.168. Pack: **3.00 bones and 8.04 Charges per stun** (360 and 965, all landed by xp), 0 refused, 0 costly, 0 dry stuns | | | 5.2-7.3 |
| Same, plain then `stunActions: ['bury', 'arrows']` (rune arrowheads on headless arrows, Fletching 75 held), 2026-10-21 15:35-15:54 PDT | plain **0.1613** (success 0.573; success gap 2.18, failure to next roll 11.65, 11 on 97 of 127); pack **0.1657** (success 0.580; 2.09 and **11.53**, 11 on 101 of 125). Pack: **7.97 arrow actions** (about 120 arrows) **and 2.98 bones per stun** over 126 stuns (1,004 and 375, all landed by xp), 0 refused, 0 costly, 0 dry | | | 4.4-5.2 |
| Agility, Wilderness course, level 99, 10 laps | **66 ticks per lap** on all 9 measured laps | | 66 | 3.8-6.1 |

Reading the stun-pack rows: rolls per tick differ by the success-rate draw (0.64 against
0.60 over 300 rolls), not the pack; the per-roll costs, 2.15 against 2.16 after a success
and 11.80 against 11.83 after a failure, are the same. The pack run's 14-tick failures (10
against 2) include its 5 forced eats inside a stun (+3 each): the lab kit carried 6 sharks at
40 HP with a `::give` top-up that lagged, a lab setting rather than the program. Magic held at
80 by `::setstat` (reset at each 99) and Prayer from 43 put many level-up pages into the run;
they did not move the failure-to-next figure. The `arrows` preset does not fire beside
`charge` while Magic is held below 99 (Charge fills every delay-free slot first), so it has its
own row: the Fletching half of the pack, as it runs once Charge reaches 99. Its headless
arrows are given, as in rs/106's plan; making them is not part of the stun pack.

**Runecraft hand-off** (`rc-cycle`), bgsrv-mac, local engine at 300 ms, 2026-10-21 16:05-16:40 PDT,
load 5-7: body altar room, two lite givers east and west of the scored tile (`tickprog-measure.ts
rc`, whose `tickprog-rc-givers.ts` plays rs/117's giver half and run.ts's relay in memory), 30
crafts per run. Each giver's bucket address came from `GIVERS_IP` (the engine trusts
`fly-client-ip` under `FLY_APP_NAME`); the tab connects from loopback, bucket 1.

| Run | Ticks per craft | Order read | Lost or declined trades |
|---|---|---|---|
| robust, givers logged in first, same bucket | **8**, 29 of 29 gaps | giver first 30/30 | 0 |
| tuned, givers in bucket 0, logged in after the tab | **7**, 29 of 29 gaps | giver first 30/30 | 0 |
| tuned, givers in bucket 2, logged in after the tab | **8**, 29 of 29 gaps, all 30 salvaged | scored first 30/30 | 0 |

Every run had 0 deferred packets, 0 skipped ticks and at most 0.8 ms per `onTick`. That is
`skills/runecraft.md`'s 7 tuned and 8 robust exactly. rs/196 measured the same program with rs/163's
direct-path givers: 30/30 at 7 tuned (nature and body), 30/30 at 8 robust in both login orders.

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
