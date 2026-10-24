# speedrun/

The speedrun package: TypeScript run with bun, importing the SDK from `sdk/`.
The run is ranked by the scored account's ticks in the world, so everything
here is measured in server ticks. The demo server has run 400 ms ticks since its
2026-10-22 19:56Z restart (the spectator feed's hello reports `tickMs: 400`, rs/83); the
measurements below that say 300 ms were taken before it.

The stock `bot.*` helpers are the project's general API and stay as they are.
This package is a separate fast layer built on the raw `sdk.send*` calls.

## Layout

```
speedrun/
  lib/            fast primitives (each has a *.test.ts next to it)
    wait.ts       tick-keyed waits shared by every module
    items.ts      item matching and the 1/5/10/All/X button planner
    bank.ts       depositAll, depositMatching, withdrawMany (+ pure planners)
    trade.ts      give / giveAll (giver), receiveFrom (receiver) (+ pure per-tick decisions)
    dialogue.ts   classifyPage, clickOption, clickContinue, advance, continueBurst
    converse.ts   whole conversations, choice queues, the shape-driven burst mode, unsolicited-page
                  interrupts, dialogueRuns and burstTicks
    levelup.ts    isLevelUpPage, levelUpChain, isLevelUp, startLevelUpWatcher, withLevelUpDismissal
    combat.ts     fight (one target by world index), Upkeep (prayer, potions, food), setPrayer
    world.ts      position, entity/item/skill queries, message windows and tile counters
    paths.ts      collision-map route lengths (separate from light world queries)
    act.ts        act, actConverse, talkTo, useOn, loc/item/door actions, walks and spell teleports;
                  the jump guard every click goes through (settle, ClickGuard: docs/speedrun/LAB.md,
                  "Region loads and jumps")
    travel.ts     travel(hops): runs, teleports, locs, gates (passGate, GNOME_STRONGHOLD_GATE),
                  spirit trees, the lever, ships, gliders, Lumdo's boat
    idle.ts       message-based idle waits and animation-based settled predicates
    session.ts    openSession, launchClient, logoutClean, waitLoggedOut, login, startWatchdog,
                  abandonClient, markProgress
    demo-status.ts  restart detector (/playercount, our logins, catch-ups): one status line +
                  speedrun/runs/demo-status.json; CLI: bun speedrun/lib/demo-status.ts watch|show
    reconnect.ts  reconnectAfterOutage, serverDownProbe (the watchdog's outage path)
    tab.ts        the scored browser tab over the Chrome DevTools protocol (reload, not reopen)
    ticks.ts      TickLog (JSONL), measure, report; CLI: bun speedrun/lib/ticks.ts report <file>
    hostgate.ts   probeOnTime (packet latency in ticks), gateDecision, HostGate (run-time knife gate)
    programs.ts   startProgram, awaitProgram, runProgram, probeInPage: the page's in-page tick programs
    gated-program.ts  runGatedProgram, inPageGate: an in-page knife program under the host gate
    xp.ts         the engine's level curve in state (game xp) units: xpForLevel, levelForXp, baseToXp
    fake-sdk.ts   scriptable BotSDK stand-in for the unit tests
  runner/
    step.ts       Step type and runSteps
    budget.ts     TickWindow: the per-tick user-event budget a step boundary hands off against
    resume.ts     resolveResume (walk the manifest from game state), sessionLink, runResumable
    fence.ts      Fence: an abandoned step attempt cannot send or hear state; patchMethod
    example-bank.ts  'bank everything at Varrock west', end to end
    stub.ts       a stand-in skill module (chop to a level, or idle N ticks) for exercising rehearse.ts
  skills/         the run's step modules: `skill` and `steps({to, ...})` returning runner Steps
    start.ts      S00, the tutorial skip on a brand-new account's first login
    agility.ts    Gnome course to 52, the lever to the Wilderness course, 52 -> to, final logout
    fishing.ts    S22 fly fishing under the gated knife loop, and the from-1 net and walk bands
    woodcutting.ts  S07: normal trees, oaks and willows at Taverley under the in-page gate
  quests/         the quest step modules: `quest`, `stepId`, `steps(opts)`, one Step per segment
    segments.ts   the shared scaffold: questSteps, QuestOptions, talkShape, kitSegment, checks
  rehearse.ts     one single-skill rehearsal attempt end to end (gate, S00, kit, steps, logout, hiscore)
  lab/            local lab: never imported by lib/
    lab.sh        engine + gateway + lite runners on port block 9300
    setup.ts      staff fixtures: tele/mustTele, give/ensureItem, setStats, setvar/getvar, clearInventory
    record.ts     Recorder segments, stats, trace and RESULT output for quest measurements
    quests/run.ts the quest modules' lab runner: segment fixtures, --from/--until/--runs/
                  --dialogue/--trace/--launch, per-segment tick tables
    quests/dialogue-burst.ts  fixed vs burst on the Cook's Assistant and Grand Tree openings
    measure-*.ts  the measurements quoted below (measure-runner.ts: runner boundary ticks)
    probe-engine.ts      engine-rule probes (docs/speedrun/research/engine-sweep/engine.md)
    census-delayfree.ts  static census of delay-free item/xp triggers (same doc)
    measure-sweep.ts     top-ten verification (docs/speedrun/research/engine-sweep.md section 8)
    measure-drop.ts      ticks from a client drop to the player leaving, with and without the
                         watchdog (docs/speedrun/research/competitors/hiscore-timestamps.md 5.1)
    measure-restart.ts   engine SIGKILL and client SIGKILL mid-run: what rolls back, reconnect
                         and resume times (docs/speedrun/RESILIENCE.md section 6)
    measure-mine-logs.ts logs and Fletching xp over a long in-page knife-mine lap, run in
                         tickprog-lab.sh's tab (docs/speedrun/skills/mining.md section 7)
  tools/          tab-login.ts (log an account's browser tab in with a one-time token over
                  CDP; see "Logging the browser tab in");
                  kit-return.ts (hand a rehearsal account's kit back to its giver and log out:
                  runs only within 30 tiles of the giver's --at tile, else casts a teleport
                  landing there if it can, else refuses without moving (exit 3; this content
                  has no home teleport, so move the giver and pass --at); a hit on the way or
                  waiting on the trade halts it, it runs once to a tile 20 from the attacker,
                  then logs out (exit 4, naming the attacker); lab: lab/kit-return-lab.ts);
                  upstream watch (nightly diff of watched upstream paths);
                  drop-probe.ts (the dropped-client stay on the demo, with a throwaway);
                  hiscore-stamp-probe.ts (the live stamp test, plus uncached
                  page/classify reads through hiscore-scrape.ts's parser,
                  docs/speedrun/research/competitors/hiscore-timestamps.md);
                  observe.ts, the passive in-game observer and /playerpositions tracker
                  (docs/speedrun/research/competitors/observation.md);
                  hiscore-scrape.ts (demo hiscore snapshots and climber diffs; the
                  one player-page parser and stamp grouping,
                  docs/speedrun/research/competitors/hiscores.md)
  runs/           tick logs and the hiscore HTML cache (gitignored)
```

## Conventions

- Functions take `sdk` (the `BotSDK`) and only take `bot` (`BotActions`) where
  a stock helper is reused, for example `bot.openBank()`.
- Expected game refusals come back as a result object `{ok, ticks, ..., reason?}`.
  A disconnect or a client that stops publishing throws.
- **Fire, then confirm once.** Sends are fired without awaiting each other.
  The client runs them FIFO, one per ~20 ms, and the server takes 5 USER events
  per tick (`NetworkPlayer.ts`); the excess stays buffered for the next tick,
  so nothing is dropped and no client-side pacing is needed. One wait on the
  expected end state confirms the batch. Bank, trade, dialogue, logout, walks
  and loc/npc clicks all share that budget of 5, so a batch delays any click
  queued behind it.
- **Wait on ticks or on the effect, never on "any change".** The client
  republishes state after every executed action within the same tick, so
  `waitForStateChange` resolves against stale state. `wait.ts` keys every wait
  on `state.tick` or on the specific field. `maxTicks` is the only limit on
  a ticking wait, however slow the ticks; a wait fails as `idle` only when no
  new tick arrives for `IDLE_TICKS` (20) ticks of wall time, scaled by
  `tickMs()` (`SPEEDRUN_TICK_MS`, else `NODE_TICKRATE`, else `DEMO_TICK_MS`, 400). A wait
  that spans a known silent window passes `idle: {ticks, period}` (an
  `IdleBound`): the bound is `ticks` of the observed tick period (`TickPeriod`),
  never shorter than `ticks * tickMs()`. A failed wait reports `silentMs`.
- **One rule for every deadline that stands for ticks.** A deadline that is a number of ticks
  counts observed ticks (`maxTicks`, `tickClock`). A detector for silence (no new tick for N
  ticks) cannot count ticks, since none arrive: it is `idleBoundMs({ticks: N, period})`, N ticks
  at the longer of the nominal and the observed length (the session watchdog, `awaitProgram`'s
  stale bound, the fleet's state silence). A wall-clock give-up that is only a backstop is
  `N * tickMs()`, never a millisecond literal sized from one tick length. lib/trade.ts's default
  trade open is `OPEN_MAX_TICKS` (200) observed ticks, with a backstop of twice that in `tickMs()`.
  `onStates` (feed every state to a step until it returns), `converse` and
  the helpers' own state listeners take the same two limits from the same
  `tickClock`; none has a total wall-clock budget.
- **Turn wall time into ticks at the observed period, never at `tickMs()`.** A nominal length
  shorter than the real one overcounts (the demo ran 340-370 ms against a nominal 300, and now
  runs 400). Something that has to count a wall-clock interval in ticks (fm-row's
  `cueAt: 'written'`, a step boundary's stale check, `serverClock`) reads `wait.ts` `periodMs`
  of a `TickPeriod`, the one estimator (tick-monitor.ts re-exports it): the rolling median of
  per-tick intervals measured across 8-tick spans, with `tickMs()` as the fallback until it has
  `PERIOD_MIN_SAMPLES` of them. `feedTickPeriod` feeds one from an SDK, and a `Session` carries
  its own as `session.period`.
- Tick logs go to `speedrun/runs/<runId>.jsonl`, or to `$SPEEDRUN_LOG`.

## Measurements: provenance

Unless a row says otherwise, every number below is:

- **300 ms ticks** (`NODE_TICKRATE=300`), on the local lab (`lab/lab.sh`, executor bgsrv-ub, Linux x86_64)
- **stock lite client, main @ 18b05c31, post-rs/22** (the client publishes a
  tick after it is fully decoded, so observe-then-act costs 1 tick), and
  **pre-rs/51** (no blind continue)
- **3 samples**, identical unless a range is shown
- produced by the script named in the row

Ticks run from a fresh tick to the first state that shows the confirmed result.

## bank.ts

`depositAll(sdk)` and `depositMatching(sdk, patterns)` fire one Deposit-All
per distinct item id (button 4 moves every unit of that id) and wait once for
those ids to leave the inventory. Inventory slots don't shift when items leave,
and the server validates each slot and item id, so a stale target is refused,
never misapplied.

`withdrawMany(sdk, [{item, n, asNote?}])` plans the sends first
(`planWithdraws`, pure):

- Bank slots compact when a stack is withdrawn completely, so withdraws go in
  descending slot order.
- Withdraws are grouped by note mode, current mode first, so at most one
  toggle (IF_BUTTON 5386 note / 5387 item) is needed. Grouping is used only
  when it is slot-safe; otherwise the plan falls back to global descending
  order.
- `n` maps to buttons: All when `n` is at least the stack; 1, 5, 10 as one
  button; up to three 10/5/1 clicks; otherwise X, which goes last because
  the count dialog holds the client queue.
- `n:'all'` takes the whole stack. `n:'fill'` is one Withdraw-All for a
  non-stackable item: the server fills the free slots and stops. The SDK
  can't tell stackable from non-stackable, so "28 of one item" is spelled
  `{item, n:'fill'}`.
- The note mode is left as the plan ends; `restoreNoteMode` costs an event.

| Measurement (`lab/measure-bank.ts`) | Stock | Ours |
|---|---|---|
| Deposit-all, 24 distinct stacks, bank open | 24 (`bot.depositItem(/./, -1)`) | **5** |
| Withdraw 28 distinct items, one each | 28 (`bot.withdrawItem` loop) | **6** |
| Withdraw 28 of one item into an empty inventory | 2 (`bot.withdrawItem(item, 28)`, X dialog) | **1** (`n:'fill'`) |

The floor for k events is ceil(k/5) ticks, plus the tick the result is observed
in: 24 deposits are 5 ticks of events, and 28 withdraws are 6.

## trade.ts

The partner is a player name. A trade request to a player who already
requested you opens both screens at once, so `openTrade` just requests (and
re-requests every 8 s).

**Giver** (`give` / `giveAll`, helper side). The moment the offer screen is
open it fires every offer (`planOffers`, pure: one entry per item id, Offer-All
unless `give` asks for a count) and the accept behind them in one burst. A
count uses the same buttons as a withdraw, except that an unstackable item
(an id held in more than one inventory slot) gets a single press: 1, 5, 10 or
X. Each press names a slot and the server takes that slot's item first, so a
second press on the same slot would find it empty and offer nothing. FIFO puts the accept after the last
offer on the server. On the confirm screen it accepts only if both offers are
exactly as planned (the partner's is empty by default, or matches
`expectTheirs`). If an offer change resets its accept, it re-accepts at most
once per tick. It is done when the items have left its inventory.

**Receiver** (`receiveFrom`, scored side). `decideReceiver` (pure) runs once
per published state:

- On the offer screen it accepts (once per tick) when `theirOffer` satisfies
  `want`; with no `want` it accepts when the partner has accepted (the giver's
  "offer is final" signal) and snapshots `theirOffer`.
- On the confirm screen it accepts only if `theirOffer` still satisfies
  `want` (or equals the snapshot) and its own offer is empty; otherwise it
  declines, so nothing changes hands. This keeps the SDK's safety semantics.
- It is done when the inventory delta shows the confirmed items arrived,
  which replaces stock's fixed 2-tick close wait. A close without the delta
  counts only after 2 ticks, because the offer-to-confirm transition can
  publish a closed frame.

| Measurement (`lab/measure-trade.ts`), receiver clock from its first click | Stock (`bot.trade` both sides) | Ours |
|---|---|---|
| 1 noted stack | 7 | **4** (giver clock 6, 2 events) |
| 23 noted stacks | 29 | **8** (giver clock 10, 24 events) |

In both cases the giver requested first and the receiver clicked after seeing
the request, as a helper hand-off would run. The comparison is our giver and
receiver against stock on both sides, so part of the receiver-clock gain comes
from the giver offering everything in one burst. Before rs/22, main measured
stock at 14 and 56.

## dialogue.ts

- `classifyPage(dialog)`: a dialog with at most one option and no registered
  choice button is a continue page (the SDK's own rule).
- `advance(sdk, {choose?})` reads, then acts. It waits for a fresh page; a page
  keeps its id after its continue is sent (rs/22), so fresh means a new id,
  or the same id after it was seen waiting. A choice page needs `choose` and
  is answered with the guarded `clickDialogByText`, which refuses rather than
  mis-clicks if the page changed.
- `continueBurst(sdk, k, {until?})` fires k `sendClickDialog(0, {blind: true})`
  at once (rs/51). The server advances one page per continue synchronously,
  so k pure continue pages cost ceil(k/5) ticks when the burst lands within
  one tick's budget. A burst fired mid-tick can split across server ticks,
  and the client publishes once per tick (the pages inside a tick collapse
  into one), so the burst returns only on the caller's `until` landing (say,
  "on the choice page" or "closed"), or after one quiet tick (the same page,
  not waiting, across a tick boundary past the floor). Returning earlier
  would let the caller's next continue land behind still-buffered resumes,
  one page past k. Pass `until` when the landing is known: it saves the
  quiet tick. The result reports `landedTicks` and the confirmed `ticks`.
  **Contract:** the caller
  guarantees the current page and the next k-1 are pure continue pages and
  that none follows a server-side state change. A burst never crosses a
  choice page (the engine refuses a bare resume while a choice is pending).
  On a client without blind continue, continues 2..k are refused locally (no
  server event is spent) and the rest go one `advance` at a time. The result
  reports `mode: 'burst' | 'fallback'`.

The blind flag is cairn://p/rs/51 (main PR #24).

| Measurement (`lab/measure-dialogue.ts`, Carla in West Ardougne: 10 pure continue pages, then a choice) | Ticks |
|---|---|
| `advance`, 10 pages (read-then-act) | 10: **1 per page** |
| `continueBurst` k=5, fallback mode (pre-rs/51) | 5 |
| `continueBurst` k=10, fallback mode (pre-rs/51) | 10 |

Burst mode, with rs/51. Every sample checked the landing: k=10 ended on the
choice page, and k=5 left exactly 5 continue pages before it (3 of 3 each).

| Burst | Landed (ticks) | Confirmed (ticks) |
|---|---|---|
| k=5, quiet-tick confirm, fired on a tick boundary | **1** | 2 |
| k=10, `until` choice page, fired on a tick boundary | **2** | **2** |
| k=10, `until` choice page, fired mid-tick | 3 | 3 |
| k=10, quiet-tick confirm, fired mid-tick | 3 | 4 |

Fired mid-tick, the 10 events split across three server ticks: that is the
case the quiet-tick rule guards against. The burst rows ran with rs/51's
client and SDK diff applied on top of main @ 18b05c31 (the rs/51 branch tip
7255c41de, which merged as main PR #24). The other rows ran without it.

## levelup.ts

A level-up is `mes` + `if_openchat(levelup_<skill>)` + `p_pausebutton`; levels
with unlocks then show more continue boxes (`~levelup_unlocks`). Gathering
stalls on that chat modal. The stats update and the modal arrive in the same
tick, so `startLevelUpWatcher` arms when a skill's base level rises and sends
one continue per fresh continue page for the next few ticks; after each
dismissal it stays armed for 3 ticks to catch the unlock pages. The level-up
text in `recentDialogs` is a backup signal (`dialog.text` is never filled
in), and it only counts while that history entry is at most 4 ticks old: the
lite client records an entry only when the chat modal id changes, so an old
level-up entry can sit at the head of the history long after its dialog closed. Choice pages are never touched. An NPC continue page that opens within
the armed window would be clicked too, so don't wrap a loop that starts a
conversation right after leveling.

| Measurement (`lab/measure-levelup.ts`, `::advancestat woodcutting N`), chat appearing to chat gone | Stock `bot.dismissBlockingUI()` called at once | Watcher |
|---|---|---|
| Level 15: level-up page + Oak-trees unlock page | 2 | **2** |
| Level 16: level-up page only | 1 | **1** |

Both hit the floor of one read-then-act tick per page. The watcher's value is
that it needs no cooperation from the loop: stock porcelain dismisses only
when its next wait notices the blocker, and the raw-send loops in this package
never call `dismissBlockingUI`. A gathering-loop comparison (ticks lost per
level with and without the watcher) has not been measured yet.

## Quest actions and lab measurements

Quest measurement scripts in `docs/speedrun/scripts` use this same fast layer;
there are no quest-family copies of the generic helper libraries. Existing lib
exports remain available. Staff fixtures and research reporting live separately
in `lab/`, which `lib/` never imports.

- `clickOption` resolves a visible option first and sends nothing if absent,
  then uses the SDK's page-bound exact-text click. `clickContinue` uses the
  guarded path when component metadata is available.
- `converse` drives the open or upcoming conversation, consuming matching
  choice patterns only after accepted clicks. `keep` makes the patterns a
  reusable priority list; `unmatched` chooses whether to throw, stop or take
  the first option. It separates level-up pages from quest dialogue counts,
  waits through closed-page gaps, and records the last close rather than the
  idle-confirmation tail. `until` gates the end of an opened conversation;
  no page by `openTicks` is explicitly reported as `opened: false`.
- `act` sends once and confirms an effect, re-clicking after an idle stall or
  a fresh reachability refusal. Set `resendEvery: 0` for actions that restart
  when clicked twice. `actConverse` composes this with dialogue handling and
  latches a required effect, including one observed while dialogue is open.
  It measures the later of that effect and the final close. `talkTo` handles
  NPC discovery and retries when no conversation opens; a click whose send came
  back unrouted (browser) or cant_reach (lite) and opened nothing first runs
  `approachNpc` (doors toward the live tile, a run to within 1) within a
  `refinds` budget the caller can share with its own approach.
- `approach` is the one place for getting to an NPC the client cannot route to:
  `approachNpc` before a talk, `approachInRange` before a re-sent attack or
  cast (the nearest tile within range of the live footprint with line of sight
  and an exact SDK route, chosen here, not by the SDK walk's fallback). Both
  re-find the NPC's live tile a bounded number of times and never throw.
- `fight` keeps one world-index target, dismisses level-up/unlock pages with
  an attack on the same target in the same tick, and re-engages under a protect
  prayer when outgoing damage stalls despite the client saying it is in combat.
  With the opt-in `unreachable` option (absent, the loop sends exactly what it
  always has; S12's caged rounds use it), a send that reached no tile (the
  browser's `routed: false`, lite's cant_reach)
  with the target untouched 6 ticks, or `stuckSends` re-sends with no engine
  effect (no hitsplat with the target, no rune or xp spent, no step), sends the
  player to a tile in range with `approachInRange`; with none, the fight waits
  `unreachableTicks` and ends `'unreachable'` with the target's tile in `reason`.
  A quest dialogue stops the fight unless `onDialog: 'continue'` is requested.
  Bosses that heal or trigger a cutscene at zero hitpoints use
  `endOnTargetDeath: false` and an explicit `done` or dialogue outcome.
  Food and potion counters count sends, not confirmed consumption.
- `world` queries accept a published state or the SDK; loc lookup checks the
  published list then scans. `paths` alone loads the SDK collision map.
  `idle` waits for movement/message/dialogue quiet and returns the last change
  tick, leaving quest dialogue untouched. `settled` instead checks animation
  quiet and includes its quiet tail in the successful tick.
- `lab/setup` provides bounded staff fixtures. `tele` returns a boolean;
  `mustTele` throws if the landing was not observed. `getvar` accepts only a
  fresh exact engine reply, not a previous request's reply on the same tick.
- `lab/record` records segments with explicit effect marks, dialogue shape,
  interactions and walked tiles. `Recorder.report()` emits SEG lines, a table
  and `RESULT <title> {total, segments}`. It is not the scored runner's
  `TickLog`, and its totals do not include idle-confirmation tails unless a
  caller deliberately marks them.

## Quest step modules: the shared layer

`quests/<quest>.ts` modules (rs/185) are built from a segment table with
`quests/segments.ts`. `questSteps(stepId, segments)` names each Step
`<stepId>:<letter>-<label>` (S15:A-narnode; run.ts keys on the step id and
`runSteps({from})` starts at any full name), defaults missing checks to
passing, and passes `done`/`inProgress`/`resume`/`probes` through only when
given, so a pure travel segment stays transient for the resume walk.
`QuestOptions` is the base of every module's options: `dialogue` ('burst' by
default) and `kitFrom`. `kitSegment` is the standard first segment: it only
checks the inventory when the kit is held, receives the missing amounts with
`trade.receiveFrom(kitFrom)` otherwise, and has no `done`, because the kit is
spent later and holding it is not a durable mark. Position checks (`within`)
judge by coordinates: after a reconnect the first state has no scene.

**Burst mode.** `converse(sdk, choices, { shape, burst })` takes the
conversation's shape in CONVENTIONS.md notation (`3c, opt, 3c, state, 8c`) and
clears each run of two or more continues with one `continueBurst`, from the
run's first observed page. Every page is checked against the shape as it
comes; the first disagreement, or a burst that does not land whole, turns
bursting off and the conversation goes on one page per tick, so a wrong shape
costs ticks, never a mis-click. `result.shape` counts burst and per-tick pages
and reports `seen` against `expected`. In fixed mode the shape is still
checked, which is how a lab run validates a doc's recorded shape. A run
followed by a `state` page waits one quiet tick, since nothing else tells its
landing apart; a run followed by an option or the close does not. A shape that
over-counts a run before a choice is invisible (the engine refuses the extra
continue at the choice); one that under-counts costs about 3 ticks.

Measured on the lab at 300 ms, 3 runs per mode, talk click to dialogue closed
(`lab/quests/dialogue-burst.ts`, 2026-10-21):

| Conversation | Shape | Fixed | Burst |
|---|---|---|---|
| Cook's Assistant start | 1c, opt, 3c, opt, 2c | 9, 13, 12 | 6, 6, 7 |
| Grand Tree, King Narnode start | 3c, opt, 3c, state, 8c, opt, 13c | 52, 51, 53 | 33, 33, 34 |

The Grand Tree figures include its two scripted cutscenes (about 14 ticks
down the trapdoor and 8 back up, the same in both modes). The run after an
option is burst whole from its first page, so it costs ceil(k/5) rather than
CONVENTIONS.md's 1 + ceil((k-1)/5).

**Interrupts.** `interrupts: [{ match, dismiss }]` on `converse` and `act`
dismisses pages the step did not ask for (the Monkey Madness backpack monkey).
`converse` counts them apart and never treats one as the conversation opening
or reopening; `act` dismisses and then re-sends its click once the page has
gone. `levelUpInterrupt()` is the level-up rule in the same shape. `match`
must give the same answer when called twice on one state.

**useOn and setPrayer.** `useOn(sdk, item, {loc}|{npc}|{item}, done)` does not
re-send blindly by default, because most uses spend the item or start an
action: it re-sends only a click after which nothing happened (no movement,
animation, dialogue, message or inventory change), or at once on "I can't
reach that!". A loc given with its tile and id is clicked without a lookup, so
it works on bridged levels. `setPrayer` checks the level (`PRAYER_LEVELS`,
from prayers.dbrow) and points before sending, confirms from the published
prayer state, and re-toggles only after `retryAfter` ticks, so a late first
toggle is never flipped back.

**Lab runner.** `lab/quests/run.ts` applies a segment's fixture (vars, items,
worn items, levels, tile), runs `--from..--until` through `runSteps` with a
`TickLog`, repeats `--runs` times and prints a markdown table (per-run ticks,
mean, min, max, delta against the quest's reference, boundaries, total);
`--dialogue=both` adds the fixed-vs-burst comparison. `::setvar` changes a
quest's varp but not the quest tab's colours, which are what the bot
publishes as `quests`; the content recolours the tab at login
(`login.rs2` `~update_questlist`). A fixture that sets vars therefore relogs,
which needs the script to own the client: run with `LAB_RUNNERS=0` and
`--launch`.

The migration does not revise historical measurements. New runs may differ
because retry policies, endpoint definitions and counter meanings have changed;
rerun a measurement before quoting new numbers. See
[`docs/speedrun/scripts/README.md`](../docs/speedrun/scripts/README.md) for the
research-script boundary and retained quest-specific code.

## session.ts

- `openSession(bot, {client: 'lite'|'browser', launch?})` builds the control
  `BotSDK` from `bots/<bot>/bot.env` the way `runScript` does, without
  `runScript`'s disconnect-is-fatal policy, and waits for an advancing tick.
  The gateway can replay the bot's last published state (still `inGame`) on
  connect, so with `launch` the advance gets the whole ready budget: a demo
  login takes about 20 s. If it fails after launching, it logs the client out
  (or kills it) before rethrowing, so no runner is left holding the player.
- On a remote world (the demo: any SERVER, or browser `?server=`, that is not
  localhost, 127.0.0.0/8 or ::1) `openSession` refuses to open unless the
  gateway it would use (`sessionGateway`: bot.env GATEWAY_URL, else the
  process's, else the one derived from SERVER, the same order the lite runner
  follows) is a loopback gateway or the direct bridge. Through the demo's
  public relay the state arrives 10-60 ticks late and actions are lost
  (rs/287's first demo attempt), so no timing taken that way is the run's. A
  local engine is never refused. `allowRelay: true` opens anyway, with a loud
  warning, and is only for a probe that measures the relay itself. The fleet
  and standalone launchers hand their roles a loopback GATEWAY_URL of their own
  and never go through `openSession`; the direct path (`lib/direct.ts`) has no
  gateway at all.
- `launchClient` spawns the lite runner (`server/webclient`, `src/lite/runner.ts`)
  or opens the browser client URL; each launch bumps `sessionId`, and the
  client's tick counter restarts with it. The runner gets its own process
  group (a terminal Ctrl-C reaches only this process), and it never outlives
  this process: a crash, SIGTERM or SIGHUP logs every launched runner out
  (`abandonClient`), and any other exit kills it.
- The runner is given only the login name, and on its own reads
  `LITE_BOT_ENV`, else `bots/<login>/bot.env`. So a session opened with an
  explicit environment, an `env` passed to `openSession` or another bot dir
  (an alias such as `bots/host-oneoff`, the scored login on an isolated
  gateway), launches its runner with that environment (`runnerEnvFor`,
  `liteRunnerEnv`): `LITE_BOT_ENV` names the alias's own bot.env, or a private
  600 copy of an `env` passed in (removed when that runner exits), and
  `GATEWAY_URL` is the session's gateway, over anything inherited. Without
  it the SDK and the runner could sit on different gateways: a stale first
  state, "tick did not advance", and a connectionless body in the world for
  500 ticks (attempt 4's one-offs, 24 Oct). A session opened from
  `bots/<login>/bot.env` itself launches its runner with the process
  environment as it is.
- `logoutClean` waits out the 16-tick post-combat window (none when
  `lastDamageTick` is -1, never hit; a fresh account's first ticks don't wait), clicks logout
  (IF_BUTTON 2458), retries once if refused, and verifies: no tick after the
  click, and the published state says out, or the lite child exited (a lite
  client attached without its child: the gateway reports it dead or out), or,
  for a browser tab, **the page's own `gameClient.ingame` read over CDP**
  (`loggedOutBy`; `LogoutResult.confirmedBy` names the signal). A browser tab
  is never judged by the gateway: once a page logs out it stops publishing,
  and the gateway keeps `inGame: true` (status `stale`, or still `active`), as
  measured on the twin (docs/speedrun/rehearsals/HARNESS.md). A missing tab is
  not out (a closed tab is a dropped client); without CDP only a published
  `inGame: false` confirms. It
  never kills the process to log out. A closed socket leaves the player in the
  world for 500 ticks, a silent one for 1,000, and a live client with nothing
  driving it forever (hiscore-timestamps.md section 5.1).
- `waitLoggedOut(ms)` asserts the account is out, then waits wall time, which
  is free.
- `login` relaunches the client and waits for an advancing tick. A login
  seconds after a logout can be accepted and then dropped while the old
  session's save is still flushing (`World.ts`, "old session is mid-logout");
  the lab hit this once in 7 re-logins. So a client that exits before its
  first in-world tick is relaunched with backoff. On a browser tab,
  `login(session, { inPage: true })` logs the page back in where it stands
  instead of navigating it (see "Relogging the browser tab in place"). `login`
  takes it only when asked and the watchdog keeps navigating, but `relog`
  (logout, `offlineMs`, login) uses it by default, with `inPage: false` to
  navigate; its result carries `tickBase` and `via`. Each game session sets
  `session.tickBase`, so `state.tick - session.tickBase` is the session's own
  tick on either path (1 on its first in-world tick).
- `launchClient` sets `LITE_LOGIN_JITTER_MS=0` for the lite runner (its 0-5 s
  fleet jitter only delays a takeover). For the browser it uses `CLIENT_URL`
  from the bot.env as the page (proxy.ts with `?server=`/`?gateway=`) and
  re-navigates the one scored tab over CDP (`CDP_URL`, `tab.ts`) to a one-time
  login token URL; see "Logging the browser tab in" below.

### The run toggle (`lib/run-mode.ts`)

The account's run toggle (`option_run`, varp 173, published as
`state.varps.option_run`) is not saved (`player_controls.varp` has no
`scope=perm`), so every login starts with it off. `ensureRun(sdk, on)` /
`ensureRunOn(sdk)` is the one way to set it. It reads the published varp and
presses the controls button (152 off, 153 on) only when the varp disagrees,
because both buttons run `if_close` and `p_clearpendingaction`. It confirms the
change within 4 ticks and presses once more if needed. The server ignores the
button while the player is busy (`p_finduid`) and turns run off below 1% energy.
On Tutorial Island the controls tab is hidden and the server drops the click, so
there it returns `unavailable: 'tutorial-island'` without pressing.

When the toggle still disagrees after both presses, or the client does not
publish the varp, the two differ. `ensureRunOn` is best effort: it returns
`{on, presses, reason}`, warns, and lets the caller continue, because the
measurement below shows a client-routed approach runs either way, so stopping
the scored run over the toggle would cost far more than it saves. `ensureRun`
throws a `RunToggleError` with the same reason, for callers whose result depends
on the toggle: the lab opt-out below and A/B scripts. Both throw when the player
is not in the world, which is a caller bug.

It is called wherever the account comes back into the world: at the end of
`login` (so `relog`, the lab quest fixtures' relog, the watchdog's
logout-then-login and `reconnectAfterOutage` all turn run on, and
`LoginResult.run` reports it), at the end of `openSession`, at the start of
every `runResumable` walk (which also covers a watchdog relaunch or a reloaded
page, neither of which goes through `login`), by S00 once it lands in
Lumbridge, and by `kandarin.crossingSettings`.

What the toggle changes is narrower than it looks. Both clients send the
op-click route (`MOVE_OPCLICK`) with the ctrl-run flag (lite
`movement.ts` `tryMoveTo`, browser `Client.ts` tryMove), and the engine runs
while that `tempRun` is set. So a client-routed approach to a loc, ground item
or obstacle runs with the toggle off too:

| Measurement (`lab/measure-run-approach.ts`, lite client, bgsrv-ub, 300 ms, 3 reps each) | Ticks | Tiles |
|---|---|---|
| Op-click on a dead tree 15 tiles away (Chebyshev), toggle **off** | 7 | 14 |
| Same, toggle **on** | 7 | 14 |

From the engine source (not measured), the toggle decides the pace only where
the engine moves the player without a fresh ctrl-run route. One case is its own
re-path to an NPC or player target (`Player.ts` `pathToPathingTarget`) after
`tempRun` has cleared, which happens on any tick without a step. The other is
content `p_walk`. With `clientRoutefinder` on, the engine never paths to a loc
by itself.

### Logging the browser tab in

The account's password never appears in a URL or a process argument. A
password on Chrome's command line (`--app=...&password=...`) is readable by
every user and process on the host through `ps`, and stays in shell history,
in tmux's command line, and in Chrome's history and session files. The design
has three parts (`server/webclient/login-token.ts` holds the full description):

1. `server/webclient/proxy.ts` reads the account's `bot.env` from
   `--bots-dir` (default `bots/`) at `<bots-dir>/<account>/bot.env`, and
   refuses one that other users can read (it must be mode 600;
   `bots/create-bot.ts` now creates it that way). `POST /bot/login-token`
   mints a random token for the account. The token is single use, valid for
   60 s, and minted only for a loopback caller that sends
   `HMAC-SHA256(PASSWORD, account)`, so a local user without the file
   cannot mint one.
2. The launcher (`openBrowserClient` in session.ts, or
   `speedrun/tools/tab-login.ts` on the command line) navigates the tab to
   `CLIENT_URL&bot=<account>&token=<token>` over the Chrome DevTools protocol.
   That is a websocket message to Chrome, not a command line. The token form
   therefore requires CDP: without `CDP_URL` the launch fails rather than
   pass the URL to `open`.
3. The page (`GatewayConnection.ts` `redeemLoginToken`) removes the token from
   its address bar, then redeems it at `POST /bot/login` (loopback only), and
   keeps the credentials in memory for the title screen's auto-login. A manual
   reload therefore does not log in again; relaunch instead. proxy.ts never
   forwards `?token=`, `?password=` or the `Referer` to the world.

`proxy.ts` refuses a page request that carries `?password=` unless it was
started with `--insecure-query-login`, which it accepts only for a loopback
world (the local lab). On the session side, the same flag on any script's
command line (or `openSession(..., {insecureQueryLogin: true})`) keeps the old
query-string login, and `browserUrl` throws for any world that is not on
loopback.

Measured on the local engine (bgsrv-ub, headless Chrome 148 with
`--remote-debugging-port`, proxy.ts in front of the lab world, a throwaway
account): `tab-login.ts` logged the tab in after 6.5 s, and a second run took
the in-game session over after 6.0 s. `ps -efww`, sampled every 100 ms (167
samples), never showed the password or a `token=` in any process, and
afterwards the tab's URL held neither. Residual exposure: the CDP port itself
lets any local user drive Chrome and read the page's memory, so the run host
should stay single-user.

### Relogging the browser tab in place

A relog that navigates the tab throws away the loaded client: the new
document downloads and unpacks the game again, rebuilds the map from storage
and opens a fresh socket to the gateway. `login(session, { inPage: true })`
(`tab.ts` `pageLogin`) keeps the page instead. After `logoutClean` the page
sits on its title screen with its overlay and gateway socket still up; a
`Runtime.evaluate` over CDP carries only a fresh one-time token, which the
page redeems at its own server (`POST /bot/login`, as a `?token=` load does)
and hands straight to the client's `autoLogin`, so the password never leaves
the page. If the page cannot (no tab, no client, the token refused) that
attempt navigates as before. A login that ends without getting in (refused by
the server, or a client that cannot log in twice) lands back on the title
screen, which `pageLoginState` reads with the message and anything the client
threw; the retry after the usual backoff navigates, which costs the same ticks.

**The tick count goes on.** The overlay counts PLAYER_INFO only in game and
the page is not reloaded, so the new session's first tick reads the old count
+ 1. `login` returns the page's count at the login as `tickBase` and stores it
on the session. A second login in the same page needs a client with rs/183's
`autoLogin` fix (it waits on `loadingComplete`, not on the loading bar, which
every logout's title redraw sets back to 10); on an older bundle the in-page
login never gets past that wait, reads as ended, and the retry navigates.

`speedrun/tools/relog-probe.ts <bot> --via=navigate,page --n=3 --bank`
alternates the two paths in one session. It reports each relog in the new
session's own ticks: the first state the SDK received, a bank-booth click sent
the moment the booth is in the scene, and the tick the bank read open. It also
records the page's own timeline from a 50 ms DevTools sampler: new document,
loaded, login started, in world, first tick, and gateway socket up, with the
page's tick at that moment. `speedrun/lab/measure-relog.ts` runs it on the lab
engine behind proxy.ts and Chrome, the way the run host has them in front of
the demo.

**Where a navigating relog's ~20 ticks went (rs/164's twin finding).** Not the
page: on the twin the re-navigated page was in the world 5.9-7.4 s after the
out with its gateway socket already up at its tick 0, but the SDK's first state
came at 11.7-13.2 s, session tick 19-20. The navigation did not close the old
document's gateway socket on the twin's Chrome (the lab's headless Chrome did),
so the gateway (`server/gateway/gateway.ts`) took the new page's registration
for a second session: it sent the old one `save_and_disconnect`, waited out its
5 s takeover timeout, force-closed it, and completed the new registration 700 ms
later, dropping every state the new page sent meanwhile (5.7 s = 19 ticks at
300 ms). `tab.ts` `reloadOrOpenTab` now closes the old page's gateway socket
(auto-reconnect off) before it navigates, so the gateway sees the old session go
and registers the new page at once. That fixes every navigation: the default
`login`, the watchdog's relaunch, and the in-page path's fallback.

Twin (rs-ashburn-rehearsal against the demo, `cairn_smoke` on the xrdp display,
the tab stack from `~/rs-sdk` at main 7c3e8c706, standing on a Draynor booth
tile; 2026-10-21 21:58-22:08Z, 1,618-1,629 online; rs/174). Ticks are the
session's own; three relogs per row, alternating paths in one session:

| Path | Out to in world | First SDK state | Booth click | Bank open |
|---|---|---|---|---|
| navigate, before the fix | 13.4 / 13.3 / 12.1 s | tick 20 / 19 / 20 | 20 / 19 / 20 | (booth click wrong, not measured) |
| navigate, gateway socket released first | 7.2 / 7.9 / 7.7 s | tick 1 / 1 / 1 | 2 / 3 / 5 | 3 / 4 / 6 |
| in page | 2.1 / 2.1 / 2.2 s | tick 1 / 1 / 1 | 2 / 2 / 2 | 3 / 3 / 3 |

(The in-page rows of the first run read the same: first state tick 1, booth click 2.)
Both paths now act from the session's first ticks, well inside the wine step's
bank-open-by-login+19 bar. The in-page relog is about 5 s shorter in wall time
and sees the scene from its tick 2, where a navigated page needs 2-5 ticks to
rebuild its map. Click to confirmed out was 0 ticks and 215-431 ms throughout,
confirmed by the page.

Lab (bbl.local, 300 ms ticks, headless Chrome, standing a few steps from the
Varrock west booths, which adds a walk to the bank-open tick; this Chrome closed
the old socket on its own): navigate 15.4-28.6 s out to in world, first state
tick 2, bank open 12-20; in page 1.4-2.9 s, first state tick 1, bank open 6-11.
On a bundle with rs/183's `autoLogin` fix and no speedrun-side workaround (the
Mac at load ~120): in page 3 of 3 got in on the first attempt, 1.9-2.9 s, first
state tick 1, bank open 7 / 10 / 9.

**After a server restart** (`measure-relog.ts --restart`, the lab engine
SIGKILLed under a logged-in tab, as the demo dies): the page dropped out 1.0 s
after the kill, the replacement engine was ready at 20.3 s, and
`reconnectAfterOutage` with `login: (s, t) => login(s, { attempts: 1, timeoutMs:
t, inPage: true })` got back in 2.0 s later, in the page, on its first attempt
with no refusals, at session tick 2 when it returned. The page's gateway socket
was up throughout.
- `startWatchdog` acts while the account should be in the world. A client
  whose tick stopped advancing for 17 ticks (~5 s; the demo has gone ~2 s
  without a frame and recovered), or whose gateway status is dead or
  stale, while its process runs, is logged out cleanly (`logoutClean`) and
  logged back in. If that logout is not confirmed within 8 ticks, or the lite
  child has exited, the watchdog kills the client and relaunches it; the new
  login takes the session over. With `progressStaleTicks` set, a healthy client
  whose bot stopped calling `markProgress` is logged out and left out. A
  freshly launched client gets a 30 s login grace (only its exit counts).
  Relaunches back off 1 s, 2 s, 4 s ... 30 s; the logout does not wait. It never
  relaunches after exit code 3 (outdated client), and it is a no-op while
  paused around an intended logout. The decision is the pure
  `watchdogDecision`. With `serverDown` (reconnect.ts `serverDownProbe` over a
  `DemoMonitor`), an unhealthy client is first checked against the world: if
  the world is gone (a demo restart) the verdict is `outage` and
  `reconnectAfterOutage` waits for it and logs in once logins are accepted,
  one try per 10 s, behind an optional login-order gate. Nothing is on the
  clock then, so there is nothing to take over. Why, and what a restart costs:
  docs/speedrun/RESILIENCE.md.

| Measurement (`lab/measure-drop.ts`, bgsrv-mac, 300 ms) | Ticks from the drop or wedge until the old session left |
|---|---|
| No watchdog: runner SIGKILLed | 499-500 (demo: 497) |
| No watchdog: network severed, sockets left open | 998 |
| No watchdog: controller crashed, runner alive (before the exit guards) | unbounded (> 1,303) |
| Watchdog: relay wedged, client alive (clean logout) | 10 |
| Watchdog: client frozen (logout fails, then relaunch and takeover) | 20 |
| Watchdog: client killed (relaunch and takeover) | about 1 |
| Controller crashed, exit guard | 0 |

The two wedged rows were measured at the earlier 10-tick stale default. At
the current 17 they read about 17 and 27 (inferred: the threshold plus the same
logout and takeover times); the killed-client row does not depend on it.

| Measurement (`lab/measure-session.ts`) | Result |
|---|---|
| Logout click to not in world | **0 ticks** as the client sees it: the last in-world tick is the tick the click was sent in (3 of 3); the server applies the click while processing the next tick, and no state for that tick is published |
| Re-login after a clean logout, wall time (free) | 4.4-6.0 s, 1 attempt each |
| Watchdog: `kill -9` the lite runner mid-world, to playing again | 3.5-4.1 s; exit noticed in 0.1-0.2 s; 1 relaunch each |
| Ticks the dropped player stays in the world meanwhile | about 12-14 (wall time / 300 ms) |

**Crash recovery.** A fresh login is accepted while the dropped player is still
in the world, on the first attempt, in all 3 samples (judged by the new lite
runner logging in and its tick advancing in the world; the raw login response
code was not captured). The engine's takeover
path (`World.ts`, "kick the existing session and transfer their state to the
new login") removes the old player and loads the new login from its live
state; the account came back on the same tile. So a crash costs about the
relaunch time (~12-14 ticks at 300 ms), not the 500-tick no-connection
timeout, provided something relaunches the client at once. Run the scored
account under `startWatchdog`; never leave a dead client to the server's
timeout.

## ticks.ts

`measure(log, target, name, fn, meta?)` records `state.tick` before and after
`fn` and appends one JSONL row:
`{v:1, runId, account, sessionId, step, startTick, endTick, ticks, wallMs, ok, error?, meta?, crossedSession?, tickMs, at}`.
A step that spans a client relaunch is flagged `crossedSession` and its ticks
are a lower bound: the counter restarts, and the dropped player's in-world
ticks were never observed. `report(rows)` totals per step;
`bun speedrun/lib/ticks.ts report speedrun/runs/<runId>.jsonl` prints the table
(lower bounds marked `>=`).

**Annotation rows.** A row with a `kind` (`session`, `program`, `gate`, `reach`, `hiscore`)
describes the run instead of one stretch of it, so it overlaps the step rows. `report` lists it
under "annotations" and never sums it into the total. Rows without a kind (steps, `(boundary)`,
`(resume)`, `(drop)`) together cover the run, as before.

## hostgate.ts

The run-time gate for the tick-manipulation loops. `probeOnTime(sdk, {trials = 20})` walks
one tile and back and reports, per trial, how many ticks after its send label each walk was
processed (1 on a punctual host), as counts, the dominant offset and its share. It ends on
the starting tile. `gateDecision(probe, {plainCycle, missCost})` says whether the knife's
predicted ticks per roll beat the plain loop's. `HostGate` probes at the start, after the
loop's lost locks and periodically while off, and switches off when the loop's measured
ticks per drop are not faster than plain. The design and the measurements are in
`docs/speedrun/skills/tick-manipulation.md` ("Run-time host gate").

## programs.ts

Drives the browser page's in-page tick programs (`server/webclient/src/bot/programs`,
design in `docs/speedrun/tick-programs.md`) over the ordinary `sdk_action` relay:
`startProgram(sdk, name, params)`, `awaitProgram(sdk, runId, {onProgress})` (resolves on done,
stopped or replaced, rejects on a fault or a page that stops publishing), `runProgram`,
`programCounters`, `marksSince` (the per-event tick stamps a poller has not seen yet, e.g.
`knife-cycle`'s `marks.successes`), and `probeInPage` (the host gate's probe over the direct path). Programs:
`probe`, `knife-cycle`, `knife-mine`, `pickpocket`, `agility`.

**`knife-cycle` with bones (S07).** Knife Woodcutting that buries a bone every 3-tick cycle:

```ts
await runProgram(sdk, 'knife-cycle', {
    method: 'oak', untilLevel: 73,
    bury: '^dragon bones$',
    trees: [[2912, 3491], [2914, 3495], [2915, 3492]] // the oaks reached from 2914,3494
});
```

The bones come from the inventory; with none left the program runs the plain knife cycle on
the same labels and resumes burying when bones appear. Pass `trees` whenever `bury` is on: a
click on a tree that needs a walk never rolls in a bury cycle. The status carries `buried`,
`burySent`, `noBoneCycles`, `switches` (tree falls absorbed in the lock) and the gauges
`bonesLeft`, `buriesPerTick`, `ticksPerSuccess`, `ticksPerSuccessSpan` and `lastSuccessGap`, so a
step script sees a lost 3-tick lock as success gaps that are not multiples of 3. A success is one
log, not one roll: ticks per success is the cadence over the catch chance (see
`docs/speedrun/tick-programs.md`, "What the knife cycle reports"). The program does not trade: a top-up is the step
script's (stop, `trade.ts` `receiveFrom`, start again). Measured 0.329 bones per tick at oak
WC 60 with the knife cadence unchanged (`docs/speedrun/skills/woodcutting.md` section 9).

The same parameters with `technique: 'plain'` run **plain + bury**, the fallback when the host
gate turns the knife off: a bone in the idle ticks of the 4-tick plain clock, about 0.20 bones
per tick at oak and 0.24 at willow with Woodcutting no slower than the plain loop
(`docs/speedrun/tick-programs.md`). `runGatedProgram` flips only `technique`, so pass `bury` and
`trees` in the params of both techniques.

## gated-program.ts

The one loop that runs an in-page knife program (`knife-cycle`, `knife-mine`) under the
host gate, for the skill step modules:

```ts
const gate = inPageGate(sdk, { plainTicksPerRoll: 4 }); // 20-trial in-page probe, 19 of 20 keeps the knife
const { segments, ended } = await runGatedProgram(sdk, 'knife-cycle', { method: 'willow', untilLevel: 99 }, {
    gate, technique: 'auto',                    // or 'knife' / 'plain': forced, never probes
    rollsPerDrop: s => 1 / successChance(s),   // the measured switch-off reads ticks per expected roll
    onSegment, onProgress, signal               // abort resolves with the segments so far
});
```

With `auto` it probes before the first run, after a slip while knifing, and every 500 ticks
while plain. It runs the program with its knife parameters while the gate is on and the
pause rule is not holding, and with its plain ones otherwise (`technique: 'plain'`,
`starter: 'none'`). Each run is one segment, and each segment carries its final
`ProgramStatus`, technique and the reason it ended (`done`, `probe`, `measured`, `pause`,
`resume`, `aborted`, `stopped`, `fault`).

The switch-offs:
- **Measured.** Over `measureDrops` (120) drops, if the knife is not strictly faster than
  `plainTicksPerRoll * (1 - measuredMargin)`, it goes plain for `measuredOffTicks` (3000).
  The unit is ticks per expected roll for knife-cycle (each log weighted by `rollsPerDrop`,
  1 / the success chance at the level) and ticks per ore for knife-mine.
- **Pause** (STEP-MANIFEST.md entry 0). Above 5 catch-ups in the knife run's last minute
  (`frames.catchUpsLastMinute`), it pauses to plain. Below 1 after a minute of plain, it
  re-probes and resumes. Paused drops are not fed to the gate.

The `successes`/`ores` budget and `maxTicks` carry across segments. `params` may be a
function of the technique.

A 20-trial probe costs 20 to 29 ticks on the account's clock (29 is the first, which waits
for a fresh label and walks home; lab, 300 ms).

**Forced slip** (test only): the start parameter `hold: 0.15` makes the page runtime hold that
share of starter bundles one tick, as the lab's `--inject-late` does. The status counts them
in `held`. Without the parameter nothing changes.

## skills/fishing.ts

STEP-MANIFEST.md entry 5 (S22) as five level-driven steps that run from any start level:
`fishing:to-draynor`, `fishing:net-1-20` (small net, plain), `fishing:to-river`,
`fishing:fly-20-78` (fly up to S22's 9,612 base) and `fishing:fly-78-99` (the run's band, with
its own gate probe and measure row). Each band reads level and xp from the state, so one already
passed is a no-op; the bands are the resume walk's milestones, and each band's preconditions
include its standing tile, so a restart away from the spot walks first.

```ts
import { steps } from '../skills/fishing';
await runSteps(session, steps({ to: 99, technique: 'auto' }), { log, c: {} });
```

The fly bands run `knife-cycle` `fly` through `lib/gated-program.ts` `runGatedProgram`, with a
fresh `inPageGate` per band. The gate judges in ticks per expected roll: the plain reference
is `PLAIN_TICKS_PER_ROLL` (5.35, measured) and each catch is weighted by one over the catch
chance at the current level. Every catch is dropped on the label that shows it, by the knife
bundle or by the plain loop's `dropEach`, and plain follows a moved spot by its tile. The
roll model (`rollYield`, `expectedRolls`, from `fishing.struct`) predicts 680 catches for
20-99 against the 673-677 measured, and sizes the feather precondition (`feathersNeeded`, 15%
margin: 783 for 20-99, 595 for 78-99). Each gated segment and a band summary
(`summarizeBand`: ticks per expected roll first, then per catch, the gap histogram and gap-3
share, spot-move costs, resyncs and slips) go to the tick log as 0-tick rows tagged
`fishing:<band>:segment` and `:summary`. Running out of feathers stops the band with an error
that names the level reached.

## skills/mining.ts

Slots (STEP-MANIFEST.md's inventory ledger, rows H4p to H7). Each iron band refuses to start
without `FREE_SLOTS` (4) free, ores counted as free since the band drops them first. Two steps
are the scored run's and off by default, since a rehearsal brings its kit from Lumbridge and keeps
it: `kitGiver=<name>` adds `mining.kit: H4p` after the zoo walk, one `receiveFrom` of `H4P_KIT`
(the rune pickaxe and a normal log; S07's kept log is the second) whose precondition counts the
kit's 2 slots and the band's 4;
`dropAtExit=true` adds `mining.exit`, which drops `EXIT_DROPS` (every pickaxe, every log, a
leftover ore, gem or arrow shaft; never the knife) at `to`, 5 a tick and the last batch sent
without waiting, so the leg after keeps its queue. Lab: `lab/handoff-slots.ts` runs both steps
against the mule giver.

## skills/woodcutting.ts (S07)

STEP-MANIFEST.md entry 3 as five level-driven steps that run from any start level:
`woodcutting:walk-oaks` (Lumbridge to the oak tile by `SITES.approach`, waypoints that keep a
level-3 account clear of every dark wizard spawn), `woodcutting:normal-1-15` (knife-cycle `tree`,
plain), `woodcutting:oak-15-73`, `woodcutting:walk-willows` and `woodcutting:willow-73-99`. A rune
axe in the pack is enough from level 1 (`woodcut.rs2`'s axe checker has no level gate and takes a
carried axe). Each band reads the Woodcutting level, so one already passed is a no-op; the bands
are the resume walk's milestones and each one's preconditions include its stand.

```ts
import { steps } from '../skills/woodcutting';
await runSteps(session, steps({ to: 99, technique: 'auto' }), { log, c: {} });
```

The oak and willow bands run `knife-cycle` through `lib/gated-program.ts` with a fresh
`inPageGate` each, judged in ticks per expected roll (plain reference 4, the plain loop's cycle;
each log weighted by 1 / the rune axe's success chance at the current level). Knife segments
carry `bury` when it is set and plain ones `dropEach`; both carry `trees`, the three trees
reachable from the stand, and each band first walks onto the stand exactly. The normal band runs
plain without a probe: it is about 3 logs, less than one 20-trial probe costs. With `bury` and a
`bones.giver`, the band stops the run on the roll label after the last bury (the program's
`bonesLeft` gauge at 0 for 2 ticks), takes a load with `receiveFrom`, and starts again with the
same gate (`woodcutting:bones-load` rows); there is no plain loop with a bury, so bones wait
while the gate holds plain. Each band's gate judges its measured switch-off over
`MEASURE_DROPS` (120) logs, passed explicitly: over 30, chop luck alone false-fires it.

`route` picks the stands as data from `ROUTES`: `taverley` (`SITES`, the scored run's and the
default) or `rimmington` (the Rimmington oaks and the Draynor-west willows, about 130 ticks less
walking from Lumbridge, which a fresh rehearsal account takes); `sites` lays over the route. Each
band's summary row records the resolved `route` and `stand`. Every hitpoint lost in a walk or a
band is a 0-tick `woodcutting:hit` row (tick, tile, the NPCs within 2 tiles). With `hpStop=N` a hit
to N or below aborts the walk or the band's program run and fails the step, so the harness logs
out cleanly. Options from the CLI come as strings (`--skill-opt=route=rimmington`, `hpStop=4`,
`bury=true`, `boneGiver=`, `boneLastLoad=`, `plainTicksPerRoll=`, `sites=<json>`, `hold=` for the
lab's forced slip, `keepProducts=`, `handBack=`, `dropAxe=`).

Slots (STEP-MANIFEST.md's inventory ledger, rows H4k to T07-08). The normal band passes
knife-cycle `keepProducts` (default `NORMAL_KEEP`, 1; the program's own is 3), counting the kit's
logs, and the program ends on the label that shows its last log, after its last drop, so every
oak and willow band first drops the normal logs past `keepProducts` (`extraLogs`; the starter
takes the first log), sent without waiting before its walk; its bury precondition counts them as
free. The oaks then start on the axe, the knife and one log, 25 free for a 23-bone load and the
chopped log. S07's end has two opt-in steps, off by default since rehearsals keep their axe and
carry no bones. The scored path: T07-08's runes ride the last bone load (`receiveFrom` takes an
offer holding more than the bones), and `dropAxe=true` adds `woodcutting:drop-axe`, which drops
the axe at `to` without waiting. A giver that shrinks the last load for the two rune stacks is
named by `bones.lastLoad` (`boneLastLoad=21`, unset by default): every receive wants at least that
many bones, since a full-load want refuses the shrunken offer on both trade screens; the bury
precondition needs room for the larger load and none once the runes are held; and the last band's
postcondition asks for the runes. The fallback until a bone giver can add the runes to a load:
`handBack=true` (the bone giver) or `handBack=<name>` adds `woodcutting:hand-back`, one `swap()`
at `to` that gives the axe and every bone held and takes `CAMELOT_RUNES` (1 law, 5 air), a trade
of its own, since the axe chops to the last level. Lab: `lab/handoff-slots.ts` runs both against
the mule giver.

`BandLedger` files every tick of a band by level and technique from the program statuses, and
`summarizeBand` turns it into rs/158's table: per sub-band (oak 15-60 and 60-73, willow 73-85 and
85-99) and per technique, ticks per expected roll, ticks per log, the fitted success per roll
(logs over cycles on whole-cycle gaps, the chop RNG) against the formula's, the lattice's ticks
per log (cycle / p), and the knife's share of the ticks, with the probe and bone-load ticks
between runs apart. Segments and the band summary go to the tick log as 0-tick rows tagged
`meta.kind` `wc-segment` and `wc-band`. `modelTicksPerLog(tree, level, technique, D)` prices
felled trees: the share of time all three trees are down is Erlang B at load
(p / cycle / 8) x (D + 4), since the downtime's distribution does not matter to it.

Lab driver: `lab/measure-woodcutting.ts` (`survey` of the stands, `walk` legs, single `band`s with
`--bury --helper=<bot>` for real 23-bone trades, `chain` from level 1), run as a
`tickprog-lab.sh` spec with `LAB_BLOCK=woodcutting` (`--route=rimmington`, `--hp-stop=N`; `walk`
and `chain` set Woodcutting to `--level` first). The lab gate, the attempt and their findings are
in `docs/speedrun/rehearsals/woodcutting.md`.

## runner/step.ts

A step is `{name, preconditions(state, c), run(ctx), postconditions(state, c), logoutSafe}`.
`runSteps(session, steps, {log, c, from?, shouldStop?})`:

1. Checks the preconditions on the state already published for the current
   tick. A failing check waits exactly one tick and is checked once more; a
   second failure is logged, and it throws before `run` is called.
2. Runs the step inside `measure`.
3. Checks the postconditions the same way (now, then once more a tick later).
   A second failure is logged and fatal.
4. After a `logoutSafe` step, if a stop was requested (default: SIGINT), logs
   out cleanly and returns `resumeAt`. A stop during an unsafe step waits for
   the next safe boundary.
5. Hands off to the next step in the same tick when that tick still has room
   for one more user event, otherwise on the next tick, never later.

The scored clock runs between steps too, so a boundary waits for a tick only
when it must. The budget (`budget.ts`, `TickWindow`) is the engine's 5 accepted
user events per tick (`NetworkPlayer.ts` `decodeIn`), booked from the SDK's own
traffic: actions acknowledged in the current tick window, actions dispatched
and not yet acknowledged, and any earlier burst the server is still decoding at
5 per tick. It hooks the SDK's single dispatch method for the length of the
run, so `bot.*` porcelain is counted along with raw sends. A state older than
one tick at the observed tick length (`periodMs`) is waited past before a check,
since the server has already moved on and its publication is due.

A step with `running: false` has the run toggle turned off at its boundary and
back on at the boundary of the next step that does not opt out. The flag cannot
be called `run`, which is the step's entry point. It exists for lab A/B
measurement of a loop walking versus running only, and no run-day step sets it.
Steps without it cost nothing: login already left run on.

Every boundary is a ledger row named `(boundary)`, with `meta: {from, to,
index, waits, budget}`; `waits` names why it took a tick (`post-recheck`,
`budget`, `stale`, `pre-recheck`). The first runs from the `runSteps` call to
the first step and the last to `(end)` or `(logout)`, so the report's total is
the whole run, idle ticks included.

| Measurement (`lab/measure-runner.ts`: 10 steps, each one walk of one tile confirmed on arrival; 3 chains each) | Measured step ticks | Boundary ticks | Chain total |
|---|---|---|---|
| Before (each boundary took a fresh tick before the preconditions and another after the step) | 10 | **20** (1 entry, 2 between each pair of steps, 1 exit) | 30 |
| After | 10 | **0** | 10 |

Boundary ticks there are the chain's ticks outside every step row, computed
from the step rows alone so both runners are measured the same way.

### Resume (`runner/resume.ts`)

`runResumable(session, steps, {log, c, link, probes?, from?, recover?})` runs the
manifest to the end through drops and restarts, and decides where to start
from the game state on every start, never from its own memory:

- Steps may declare `done(observed)` (a milestone: true once its effect is in
  the game and from then on), `inProgress(observed)` with a `resume` entry, and
  `probes` (named in `probes`, e.g. a bank-open probe; run only when the walk
  needs them). `resolveResume` finds the first milestone not done, then the
  latest step back to the last done milestone that can start now: in progress
  (enter by `resume`) or preconditions true (enter by `run`).
- On a lost link (`sessionLink`: the lite runner exited, `inGame` false, or no
  tick for 17 ticks) the attempt is abandoned and fenced (`fence.ts`: its sends
  are refused at `sendAction` and its listeners muted), `recover` waits for the
  watchdog to bring the session back, and the walk runs again. A step error
  after the session changed, or a `page reloaded` program rejection, is the
  drop, not a failure.
- `runSteps` gained `startMode: 'resume'` (enter the first step by `resume`,
  skipping its start preconditions) and `signal` (checked at every boundary).
  Ledger rows: `(resume)` and `(drop)`.
- Every walk starts with `ensureRunOn` (see "The run toggle"), and the
  `(resume)` row's `meta.run` records the presses it took.

Measured on the local engine (`lab/measure-restart.ts`, RESILIENCE.md section
6): after an engine SIGKILL the walk resumed at the first rolled-back step in
3 of 3 runs, 4.1-11.7 s after the kill, 3 in-world ticks after the relogin.

`runner/example-bank.ts` is the shape in miniature. On the lab (1 sample, same
provenance), "bank everything at Varrock west" (open the bank, deposit 24
distinct items) took **6 ticks** and wrote its tick log:

```
speedrun/lab/lab.sh srlab1 'speedrun/runner/example-bank.ts:--lab'
bun speedrun/lib/ticks.ts report speedrun/runs/<runId>.jsonl
```

## skills/start.ts (S00)

The tutorial skip, STEP-MANIFEST.md entry 34, as one `logoutSafe` step (`steps()` returns it, so a
run or `rehearse.ts` chains it like a skill module). A fresh account logs in on Tutorial Island
with the character-design screen open. The step sends the design accept and the talk to the
RuneScape Guide in the same tick (FIFO puts the accept first, and closing the screen queues
the guide's welcome state before the talk lands). It answers the guide's question page with a
continue on the tick it shows, and the choice page with a guarded "Yes please." on the tick it
shows. The guard is the content's own (`runescape_guide.rs2`, `map_live = false`): the choice
must offer "Yes please.", and the question page's text must ask about skipping whenever the
client published it. If the skip is not offered, the step fails rather than starting the
tutorial. Precondition: on Tutorial Island. Postcondition: on (3222,3222) with the starter kit
(side tabs are not in `BotWorldState`; the same script opens them). `done`: off the island.
Once landed it turns run on (`ensureRunOn`). No login can do that on the island, where the
controls tab is hidden.

The landing wait spans the Lumbridge region rebuild. The browser client publishes nothing while
it builds the region and then publishes the landing as the next tick, so the rebuild costs no
observed ticks, only wall time, and a starved tab stretches it past `IDLE_TICKS`. The wait keeps
`LANDING_TICKS` (8) and takes `LANDING_IDLE_TICKS` (100) ticks of the observed period as its idle bound.
On failure it names the last tick, the position, the kit and the silence.

**Click recovery.** The talk goes through `lib/act.ts`'s `ClickGuard` (`alwaysWatch`): it is sent
from a settled position and sent once more when it draws no reply. Each re-send is logged as an
`S00:resend` note with the guard's counts. The guide refuses about one talk in thirty with "I
can't reach that!". It wanders, and when it stands next to the player the client sends no route,
so a step the guide takes that tick leaves the engine nothing to walk; the guard re-sends 3 ticks
later. The continue has no re-send: no continue was dropped in any lab run, and every "no choice
page" failure was the bound.

S00's own waits for the guide's page (`TALK_TICKS`, 12), the choice page (`CHOICE_TICKS`, 6) and the
landing (`LANDING_TICKS`, 8) count from the server tick the click *reached*, not from the send or
the page. A starved browser tab decodes a backlog of ticks: it runs a queued click only when it
gets to it (the SDK's action result marks that), and it decodes the server's reply only after the
rest of the backlog. The reached tick is the later of the tick the click executed and S00's first
tick plus the wall time since then over the observed tick length (`lib/wait.ts` `serverClock`). Wall time only
ever lengthens a tick bound, and on a current tab the two agree. Failures name the click's sent,
executed and reached ticks, the guard's re-sends, and the last state.

| S00 on the browser client (bgsrv-mac, 300 ms, fresh bots, `lab/measure-s00.ts`, rs/345) | Before | After |
|---|---|---|
| Quiet tab | 24 of 24 (no refusal drawn) | **40 of 40**; 3 talks re-sent by ClickGuard, page at tick 8 |
| Tab throttled from login, 14x / 20x | 0 of 4 ("no choice page": continue executed 6-9 ticks late) | **4 of 4** |
| Tab throttled from login, 30x / 40x | 0 of 2 at 30x | **4 of 4** (landing 40-88 ticks after the first state) |

| Rebuild silence, "Yes please." to the landing state (browser client, bgsrv-mac, 300 ms, fresh bots, rs/337) | Silence | Ticks across it |
|---|---|---|
| Quiet machine (load ~3) | **0.58-0.59 s** (5 of 5) | 1 |
| Tab CPU throttled from the click (CDP), 4x / 10x / 20x / 30x / 40x / 60x | 1.6 / 4.5 / 9.3 / 14.6 / 21.1 / 34.2 s | 1 |
| Executor at load ~165 (rs/320) | over 6 s (failed `IDLE_TICKS`) | - |

| Measurement (`rehearse.ts` on the lab, fresh bots, lite client, bgsrv-mac, 300 ms) | Ticks |
|---|---|
| S00 step row, first published state to Lumbridge with the kit | **3** (3 of 3): question page +1, choice page +2, landed +3 |
| Stock `bot.skipTutorial()` (manifest entry 34, `travel-walk-enchant.ts`) | 6 |

## rehearse.ts

One single-skill attempt for the per-skill fastest-99 rehearsals (cairn://p/rs/147), a thin layer
over `runResumable` (`runSteps` plus the resume walk from game state), `lib/session.ts`,
`lib/ticks.ts`, `lib/programs.ts`, `lib/hostgate.ts` and `lib/trade.ts`:

```
bun speedrun/rehearse.ts --skill=<name|module.ts> --bot=<env name> [--to=99] [--client=browser|lite]
    [--kit-from=<giver> --kit=<item:n,...>] [--technique=auto|knife|plain] [--skill-opt=<key>=<value> ...]
    [--gate-bot=<gate account env, default cairn_twin off a local world>] [--gate-json=<file>]
    [--gate-probe-trials=60] [--probe-trials=0]
    [--force-gate] [--from=<step name or index>] [--log=<file>] [--lab] [--insecure-query-login]
    [--host-reservation=<file>] [--claim-owner=<rs/NNN>] [--kind=measurement|record]
```

1. **Gate, off the clock.** `/playercount`; the direct read on a separate gate account
   (off a local world, `cairn_twin`, the twin's gate account, unless `--gate-bot` names another or
   `--gate-json` replaces the read; the lab has no default) (`--gate-bot` runs `docs/speedrun/scripts/tickmanip-latency.ts --path=direct --json` in its own
   process, `--gate-json` takes a file it wrote at most 10 minutes ago); then, on the browser,
   the gate account's own tab logs in and runs `probeInPage` (`--gate-probe-trials`, default 60
   with `--gate-bot`). Each is a `(gate)` row. It refuses to start (exit 3, nothing logged in) when
   (c) fails on any read, when the world does not answer, or when a non-lab world has no direct
   read. `--force-gate` overrides. (a), (b) and (d) are printed with each verdict. That is the
   `--kind=measurement` rule, the default. `--kind=record` (a fresh name raced once) also refuses
   below 58/60 next-tick reactions on a 60-trial direct read, needs a direct read even on the lab,
   and refuses `--force-gate` as a usage error. A `(gate) kind` row and the summary's first gate
   line record the kind, its rule and the read's (a) and (c)
   (docs/speedrun/rehearsals/HARNESS.md, "Attempt kinds").
2. **The attempt.** It launches the client (the browser through `lib/session.ts`'s one-time
   token login) under `startWatchdog`, then runs S00 (`skills/start.ts`), an optional
   `probeInPage` on this account (`--probe-trials`, on its clock), an optional kit receive (S01:
   `receiveFrom` with `want` built from `--kit`; on the lab `--kit` alone uses `::give`), and
   `skill.steps({to, technique, ...skill-opts})`. `--kit` takes debug names (`rune_axe:1`), or
   `item=n` under `lab/lab.sh`, which splits a script's arguments on `:`. Meanwhile `/playercount`
   is read every 10 minutes (`PLAYERS_EVERY_MS`; an HTTP GET beside the game socket, no game
   packets), and once more right after the logout.
3. **Out, then the free work.** `logoutClean` follows the moment the chain ends; a last step that
   logged out by itself counts as done. Then the gate tab's after-probe, the public player page
   (`tools/hiscore-scrape.ts`) against the log, and a one-screen summary. Exit codes: 0 done,
   3 refused, 4 stopped or paused (a re-run resumes), 5 host reserved (below), 1 failed.

**Claiming a name: `--claim`.** `bun speedrun/rehearse.ts --claim --bot=<name> --log=<file>` runs
S00 and then `logoutClean`, nothing else. The tutorial skip creates the account, and the clean
logout parks it. There is no gate account (not even the default `cairn_twin`), no direct read, no
tab probes and no skill module, so a claim is exactly one login. A world that does not answer
`/playercount` still refuses it. It writes a `(gate) claim` row, so the log says it was a claim.
The summary and the hiscore check run as for an attempt, against the Overall row only.
`--claim` refuses every option that would add a login, a probe or a step, and `--kind`
(docs/speedrun/rehearsals/CLAIMS.md).

**Host reservation.** A run-capable host carries `~/host-reserved.json`
(`{"owner", "until", "reason"}`, docs/speedrun/rehearsals/HOST.md, 'Run-capable twin') while the
gate or the scored run holds it. It is live while `until` is in the future; a missing file, a
past `until` or a malformed file (which prints a warning) is not. The path is
`--host-reservation=<file>`, else `$SPEEDRUN_HOST_RESERVATION`, else `$HOME/host-reserved.json`.
While it is live, an attempt or a claim refuses before any login (the gate account's, the gate
tab's or its own), naming owner, until and reason, and exits 5; `--force-gate` does not override
it. It is read again before each login and **at every logout-safe step boundary**, which is the
only place it is checked in flight: the runner exposes no safe point inside a step, so a long
band runs to its end before the pause. A live reservation there logs out with `logoutClean`
(page-confirmed; it clears `expectInWorld`, so the watchdog relaunches nothing), logs the gate tab
out without its after-probe, writes a `(gate) paused for the gate/run` row (owner, until, reason,
the next step), and exits 5. Nothing restarts it: once the file is gone or expired, the same
command resumes from game state, and every summary over that log prints a `PAUSED for the
gate/run` line per pause.

**Under a claim: `--claim-owner`.** The file is host's claim lock: `rs-claim take OWNER ...`
writes it with the taker as `owner`, and host's `preempt` replaces it with `"owner": "host"` and
the holder it displaced under `displaced.owner` (HOST.md, 'Claims'). `--claim-owner=<rs/NNN>`,
else `$SPEEDRUN_CLAIM_OWNER`, names the claim the attempt runs under (not to be confused with
`--claim`, which parks a name). A live claim of that owner blocks nothing; one gone stale prints a
warning and blocks nothing, since nobody else holds the machine. Any other live owner refuses at
pre-flight and pauses at a boundary, a preempt of ours included. Where `rs-claim` is installed (on
PATH or in `~/.local/bin`), each boundary also starts `rs-claim touch <owner>` in the background,
at most once a minute and killed after 10 s. Its exit 3 (preempted) pauses at the next boundary,
and any other failure only warns.

The tick log adds annotation rows: `(session)` from client tick 0 (the login) to the logout click
per client session, `(program)` per in-page program run (its final `ProgramStatus`), `(reach)` per
level gained, `(gate)`, `(hiscore)`, and `(players)` per `/playercount` read during the attempt
(the count, the wall time, and the client tick while in the world). The summary prints the
count's range over the attempt (the gate's read and the `(players)` rows) and a `MOVED` line when
its lowest read is under half its highest (`playerSwing`: (highest - lowest) / highest over 0.5),
which is a demo restart and refill: respawn-bound bands then ran in two regimes, each priced at
its own count (rs/147, addendum 7). The summary's arithmetic (`summarize`) is the session
minus the step rows (the overhead), split into boundary rows, the resume walk's rows, and the
ticks outside the runner (login to the first step, the end to the logout click). The hiscore
check (`compareHiscore`, hiscore-timestamps.md): a skill row is the playtime its level was reached
at (the earlier sessions' playtime plus the client tick); Overall is the latest level gained, or
the logout playtime (each session's last tick + 1) when no level was gained. The page is read
only once it shows this attempt's save (`hiscoreSettled`): Overall stamped, and the skill's row at
the log's last level of it when that is 15 or more. The save lands when the player leaves, which a
logout that wasn't confirmed can delay, so the read polls every 5 s for up to 2 minutes and then
checks the page as it stands. A page with no save yet reads "no rows saved yet", and "no row
(under level 15)" means a genuine sub-15 skill.

Stops: the first Ctrl-C stops at the next `logoutSafe` boundary with `logoutClean`; a second
Ctrl-C, SIGTERM or SIGHUP logs out at once (a browser tab outlives the process, so `timeout`'s
SIGTERM must not just exit). A re-run with the same `--log` walks from game state; `--from`
overrides the first walk. **Skill modules should give every band `done`** (level at least the
band's end). A step without `done` is transient to the walk, which then scans backward from the
last step and can start a later band whose preconditions happen to hold.

| Measurement (lab, fresh bots, lite, bgsrv-mac, 300 ms) | Session | Steps | Boundary rows | Outside the runner |
|---|---|---|---|---|
| S00, kit by `::give`, chop stub to WC 11 (tree-fall bug, since fixed), logout | 47 | 44 (3 + 1 + 40) | 0 over 3 | 3 |
| S00, chop stub to WC 15, logout | 71 | 68 (3 + 65) | 0 over 3 | 3 |
| S00, idle 20; SIGINT mid-step: logout at the boundary, click on the part's end tick | 26 | 23 | 0 over 3 | 3 |
| Re-run `--from=2`: idle 20 + 20, logout | 42 | 40 | 0 over 3 | 2 |
| S00, idle 1, logout (after the `lastDamageTick = -1` fix): click on tick 7, S00 ended on 6 | 7 | 4 (3 + 1) | 0 over 3 | 3 |

The ticks outside the runner are the login frames the client counts before the SDK's first
advancing state (`openSession`); the logout click lands on the last step's end tick. Results and
the host's command lines: `docs/speedrun/rehearsals/HARNESS.md`.

## skills/agility.ts

Each module exports `skill` and `steps(opts)`, returning `runner/step.ts` steps
the scored run chains and `rehearse.ts` runs alone. Steps are level-driven: each
reads the level and the tile at its precondition and is a no-op once its band is
passed, so a module runs from any start level. Band steps carry `done`, are
`logoutSafe`, and have stable names.

**`agility.ts`** (STEP-MANIFEST.md entry 1). Steps `agility:walk-gnome`,
`agility:gnome` (1 -> min(to, 52)), `agility:walk-wilderness` (the Gnome
Stronghold gate, the Ardougne lever, the Deserted Keep web with the knife, the
ridge gate at 52) and `agility:wilderness` (52 -> to). The run's S11a is
`steps({to: 22})`; S17 arrives inside the Wilderness course, so only the last
step acts. Options (strings are accepted, as `--skill-opt` passes them):

- `to` (99), `technique` (`auto`/`knife` = the in-page reaction, `plain` for
  measurement only), `food`, `eatBelow` (default ceil(0.6 x max HP) on the
  Wilderness course: 6 at 10 HP, 60 at 99);
- `finish`: `final-logout` (default at `to` 99) waits for the level-up chain,
  walks to the pipe's start tile (3004,3937) if a fight is on, waits out the
  16-tick combat window and logs out with `logoutClean`; the postcondition
  accepts that logged-out end;
- `pauseFor` (`none` by default, rs/147's ruling), `playerRadius` (15) and the
  threat parameters, passed to the program (docs/speedrun/tick-programs.md);
  `maxPauses` (3);
- `drop`: a pattern of items to drop before the walk to the Gnome course (a
  fresh account's 18-slot starter kit leaves 10 free; the rehearsal drops the 16
  that are not food).

What each Wilderness end does: a pause (`pauseFor` fired) logs out at once,
writes an `agility:pause` row and throws `AgilityStop('paused-for-player')`;
resume with `--from=agility:wilderness` and the same `--log`, which is where the
pause count lives. More than `maxPauses` pauses in a band refuses to resume
(`pause-limit`) until `--skill-opt=pauseLimitAck=true`, after the coordinator
has answered. A player's hit (`attacked`) never fights back: it eats at the
line, steps away from the attacker, logs out the first tick the combat window
allows, and throws `retreat`. A death logs out at the respawn and throws
`died`. No food at the line logs out and throws `no-food`. Walks eat at the
same line and open a gate the pathfinder cannot route through. Ledger rows
(zero ticks): `agility:pause`, `agility:retreat`, `agility:death`,
`agility:final-logout`, `agility:walk-wilderness:legs`; the program results and
the level ticks are `rehearse.ts`'s `(program)` and `(reach)` rows.

## Lab

`lab/lab.sh <bot> <script.ts>[:arg:arg] ...` starts the engine (with
`LOCAL_STAFF_LEVEL=4`, `BUILD_VERIFY=false`, `BUILD_LIVE_RELOAD=false`,
profanity filter off, `NODE_TICKRATE` default 300), the gateway, and a lite
runner per bot on port block **9300** (web 9300, management 9301, hiscores
9302, node 44000, gateway 8300). It runs each script as
`bun <script> <bot> <args>`, then stops everything. It creates missing bots
and points their `bot.env` at the lab.

- `LAB_HELPERS="srlab2"`: extra bots with their own runner (the trade giver).
- `LAB_BOTS="srlab3"`: extra bots with a lab `bot.env` but no runner, for
  scripts that launch and kill their own client.
- `LAB_RUNNERS=0`: no runner for `<bot>` either.
- A helper that a script relogs (`logoutClean` + `login`) must not also have a `lab.sh` runner:
  the two clients fight over the account and the script's sends fail with "Connection closed".
  Name it in `LAB_BOTS` and open it with `openSession(name, {launch: true})`
  (`measure-sweep.ts` does).
- `WEB_PORT`, `WEB_MANAGEMENT_PORT`, `HISCORES_WEB_PORT`, `NODE_PORT`, `AGENT_PORT`: override
  the port block (defaults above) to run several labs side by side; give each lab its own
  bots, because `lab.sh` points each bot's `bot.env` at its own block.
- A bot fresh from `create-bot.ts` is still in the tutorial and has no side tabs, so the
  server silently refuses its inventory ops and tab buttons; `probe-engine.ts` shows the fix
  (`::setvar tutorial 1000`, teleport, relog).
- The first boot packs the content (about 13 minutes on bgsrv-ub); later boots
  take seconds. Pin every batch to one executor so the packed content is reused.

Bots: `srlab1` (receiver, scored), `srlab2` (giver), `srlab3` (session trials).
The full measurement run:

```
LAB_HELPERS=srlab2 LAB_BOTS=srlab3 speedrun/lab/lab.sh srlab1 \
  speedrun/lab/measure-bank.ts speedrun/lab/measure-trade.ts:--giver=srlab2 \
  speedrun/lab/measure-dialogue.ts speedrun/lab/measure-levelup.ts \
  speedrun/lab/measure-session.ts:--bot=srlab3
```

### The step benchmark (`lab/bench-step.ts`)

One step module evaluated K times on the lab, as a number a loop can optimise
(`lab/autoresearch/program.md` is that loop's brief). Each run is
`lab/dress-rehearsal.ts` on a fresh lab account: `--from=<the step's chunk>` stages
the chunk's start boundary by staff commands (`lab/boundary.ts`), run.ts's chain runs
through `--until=<the step>`, and the tick log plus the rehearsal's `--vitals` file
give the step's ticks, pass or refusal, TICKMON's late / glued / gap counts over its
minutes, its lowest HP and the food it ate. The bench never plans the chain itself:
`dress-rehearsal.ts --plan-only=1 --plan-out=<file>` hands it the lab chain, the
start index, the helper families the slice meets and its giver gaps.

```
LOCAL_STAFF_LEVEL=4 NODE_TICKRATE=150 LAB_RUNNERS=0 speedrun/lab/lab.sh benchlab \
  'speedrun/lab/bench-step.ts:S12:--k=3:--tick-ms=150'
```

- The target is a RUN-ORDER id (`S12`), a range (`S10b..S12`), or one chain step's
  name (`woodcutting:oak-15-73`; under `lab.sh` its colons arrive split and rejoin).
  Staging is per chunk, so the leg in and the chunk's earlier steps run uncounted.
- Launcher-family helpers (S03's droppers, S06's altar givers, S07's bone givers, S25a's
  anvil, H23's cannon holder) get fresh `cairn_<tag><family><run><n>` names per run.
  S04's ring givers and S25c's wine giver need `lab.sh` lite runners, so their flags
  pass through. Hand-offs are staff-supplied unless `--stub` names a stub giver.
  H12o's h45 is named in the generated config but never logs in (as in rs/764's
  rehearsal), so S15's top-up legs M and P each wait 30 ticks unanswered and go on.
- The score is the median over passing runs when all pass; a failure counts as its
  ticks + RUN-ORDER's manual restart + the step's expected again, averaged in, so a
  faster but flaky change loses. A band RUN-ORDER prices only inside its step takes
  `--expected=N`.
- One row per run goes to `speedrun/lab/autoresearch/results.tsv` (untracked): the
  checkout's commit, ticks, score, wall seconds, TICKMON, HP, food, the cheats used.
  HP is two columns: `hp_entry`, as the counted span starts (a leg's poison shows here),
  and `hp_min`, the lowest a change inside the span left. A file under an older header
  is moved aside to `results.tsv.<hash>`, never appended to.
- Staff supply tops a `to N` row up from what SCORED holds (H12's `shark to 15`), as
  the real trade asks, so the pack after it is the run's (27/28 at S15:A).
- A build slot's webclient bundle can predate the session's launch echo, and then every
  login refuses (`in-game states with no launch id`): `cd server/webclient && bun run build`.
- The summary prints each counted segment's median and range over the passing runs (and
  `segments` in the RESULT json): a loop judges a segment against its own spread.
- Noise at 150 ms (2026-10-24): S12 537 / 606 / 554 on fedora and 572 / 525 / 548 / 584 / 539
  on bbs (rs/764's chain run 533), the walk and dialogue segments within 1-3 ticks and all
  the spread in the three fights' rolls; the S07 oak band 726 / 806 (rs/764: 726), the spread
  in tree depletion on a near-empty world. TICKMON 0 glued and 0 gaps throughout, late 0
  on fedora and 2 over bbs's K=5.

`LOCAL_STAFF_LEVEL` (engine, `Environment.ts`) grants that staff level to
every login on a world without a login server. Non-production worlds,
including a public one run that way, take that path, so set it only on a
private lab engine. It defaults to 0, which grants nothing.

## Re-run list

The numbers above are already post-rs/22. Re-run these when the client changes:

- **Once main with rs/51 is the base:** `lab/measure-dialogue.ts`, to replace
  the burst rows' patched-client provenance with a plain main sha.
- **After any change to the client's publish timing or action cadence:** every
  observe-then-act row, meaning dialogue `advance`, the level-up rows, the
  trade rows (both clocks), and the bank rows (their confirm wait is one
  observed tick).
