# speedrun/

The speedrun package: TypeScript run with bun, importing the SDK from `sdk/`.
The run is ranked by the scored account's ticks in the world, so everything
here is measured in server ticks at the production tick rate (300 ms).

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
    dialogue.ts   classifyPage, advance, continueBurst
    levelup.ts    isLevelUp, startLevelUpWatcher, withLevelUpDismissal
    session.ts    openSession, launchClient, logoutClean, waitLoggedOut, login, startWatchdog
    ticks.ts      TickLog (JSONL), measure, report; CLI: bun speedrun/lib/ticks.ts report <file>
    hostgate.ts   probeOnTime (packet latency in ticks), gateDecision, HostGate (run-time knife gate)
    fake-sdk.ts   scriptable BotSDK stand-in for the unit tests
  runner/
    step.ts       Step type and runSteps
    example-bank.ts  'bank everything at Varrock west', end to end
  lab/            local lab: never imported by lib/
    lab.sh        engine + gateway + lite runners on port block 9300
    setup.ts      ::tele / ::give / ::setstat fixtures
    measure-*.ts  the measurements quoted below
  tools/          upstream watch (nightly diff of watched upstream paths);
                  hiscore-stamp-probe.ts (board reader and the live stamp test,
                  docs/speedrun/research/competitors/hiscore-timestamps.md);
                  observe.ts, the passive in-game observer and /playerpositions tracker
                  (docs/speedrun/research/competitors/observation.md);
                  hiscore-scrape.ts (demo hiscore snapshots and climber diffs,
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
  on `state.tick` or on the specific field. Its wall-clock backstop scales
  with `tickMs()` (`SPEEDRUN_TICK_MS`, else `NODE_TICKRATE`, else 300).
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
open it fires every offer (one Offer-All per item id, `planOffers` pure) and
the accept behind them in one burst. FIFO puts the accept after the last
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

## session.ts

- `openSession(bot, {client: 'lite'|'browser', launch?})` builds the control
  `BotSDK` from `bots/<bot>/bot.env` the way `runScript` does, without
  `runScript`'s disconnect-is-fatal policy, and waits for an advancing tick.
  The gateway can replay the bot's last published state (still `inGame`) on
  connect, so with `launch` the advance gets the whole ready budget: a demo
  login takes about 20 s.
- `launchClient` spawns the lite runner (`server/webclient`, `src/lite/runner.ts`)
  or opens the browser client URL; each launch bumps `sessionId`, and the
  client's tick counter restarts with it.
- `logoutClean` waits out the 16-tick post-combat window, clicks logout
  (IF_BUTTON 2458), retries once if refused, and verifies: no tick after the
  click, and the lite child exited or the gateway reports the bot dead. It
  never kills the process to log out: a dropped connection leaves the player
  in the world until the 500-tick no-connection timeout.
- `waitLoggedOut(ms)` asserts the account is out, then waits wall time, which
  is free.
- `login` relaunches the client and waits for an advancing tick. A login
  seconds after a logout can be accepted and then dropped while the old
  session's save is still flushing (`World.ts`, "old session is mid-logout");
  the lab hit this once in 7 re-logins. So a client that exits before its
  first in-world tick is relaunched with backoff.
- `startWatchdog` relaunches the client when the account should be in the
  world and the lite child exited, the tick stopped advancing for 10 ticks, or
  the gateway reports the bot dead or stale. A freshly launched client gets a
  30 s login grace (only its exit counts), it backs off 1 s, 2 s, 4 s ... 30 s,
  it never relaunches after exit code 3 (outdated client), and it is a no-op
  while paused around an intended logout. The decision is the pure
  `watchdogDecision`.

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

## hostgate.ts

The run-time gate for the tick-manipulation loops. `probeOnTime(sdk, {trials = 20})` walks
one tile and back and reports, per trial, how many ticks after its send label each walk was
processed (1 on a punctual host), as counts, the dominant offset and its share. It ends on
the starting tile. `gateDecision(probe, {plainCycle, missCost})` says whether the knife's
predicted ticks per roll beat the plain loop's. `HostGate` probes at the start, after the
loop's lost locks and periodically while off, and switches off when the loop's measured
ticks per drop are not faster than plain. The design and the measurements are in
`docs/speedrun/skills/tick-manipulation.md` ("Run-time host gate").

## runner/step.ts

A step is `{name, preconditions(state, c), run(ctx), postconditions(state, c), logoutSafe}`.
`runSteps(session, steps, {log, c, from?, shouldStop?})`:

1. Takes a fresh tick and checks the preconditions. A failure is logged, and
   it throws before `run` is called.
2. Runs the step inside `measure`.
3. Takes the next tick and checks the postconditions. A failure is logged and fatal.
4. After a `logoutSafe` step, if a stop was requested (default: SIGINT), logs
   out cleanly and returns `resumeAt`. A stop during an unsafe step waits for
   the next safe boundary.

`runner/example-bank.ts` is the shape in miniature. On the lab (1 sample, same
provenance), "bank everything at Varrock west" (open the bank, deposit 24
distinct items) took **6 ticks** and wrote its tick log:

```
speedrun/lab/lab.sh srlab1 'speedrun/runner/example-bank.ts:--lab'
bun speedrun/lib/ticks.ts report speedrun/runs/<runId>.jsonl
```

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
