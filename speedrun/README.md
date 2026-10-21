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
    session.ts    openSession, launchClient, logoutClean, waitLoggedOut, login, startWatchdog,
                  abandonClient, markProgress
    demo-status.ts  restart detector (/playercount, our logins, catch-ups): one status line +
                  speedrun/runs/demo-status.json; CLI: bun speedrun/lib/demo-status.ts watch|show
    reconnect.ts  reconnectAfterOutage, serverDownProbe (the watchdog's outage path)
    tab.ts        the scored browser tab over the Chrome DevTools protocol (reload, not reopen)
    ticks.ts      TickLog (JSONL), measure, report; CLI: bun speedrun/lib/ticks.ts report <file>
    hostgate.ts   probeOnTime (packet latency in ticks), gateDecision, HostGate (run-time knife gate)
    programs.ts   startProgram, awaitProgram, runProgram, probeInPage: the page's in-page tick programs
    fake-sdk.ts   scriptable BotSDK stand-in for the unit tests
  runner/
    step.ts       Step type and runSteps
    budget.ts     TickWindow: the per-tick user-event budget a step boundary hands off against
    resume.ts     resolveResume (walk the manifest from game state), sessionLink, runResumable
    fence.ts      Fence: an abandoned step attempt cannot send or hear state; patchMethod
    example-bank.ts  'bank everything at Varrock west', end to end
  skills/         the run's step modules: `skill` and `steps({to, ...})` returning runner Steps
    start.ts      S00, the tutorial skip on a brand-new account's first login
  lab/            local lab: never imported by lib/
    lab.sh        engine + gateway + lite runners on port block 9300
    setup.ts      ::tele / ::give / ::setstat fixtures
    measure-*.ts  the measurements quoted below (measure-runner.ts: runner boundary ticks)
    probe-engine.ts      engine-rule probes (docs/speedrun/research/engine-sweep/engine.md)
    census-delayfree.ts  static census of delay-free item/xp triggers (same doc)
    measure-sweep.ts     top-ten verification (docs/speedrun/research/engine-sweep.md section 8)
    measure-drop.ts      ticks from a client drop to the player leaving, with and without the
                         watchdog (docs/speedrun/research/competitors/hiscore-timestamps.md 5.1)
    measure-restart.ts   engine SIGKILL and client SIGKILL mid-run: what rolls back, reconnect
                         and resume times (docs/speedrun/RESILIENCE.md section 6)
  tools/          tab-login.ts (log an account's browser tab in with a one-time token over
                  CDP; see "Logging the browser tab in");
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

## session.ts

- `openSession(bot, {client: 'lite'|'browser', launch?})` builds the control
  `BotSDK` from `bots/<bot>/bot.env` the way `runScript` does, without
  `runScript`'s disconnect-is-fatal policy, and waits for an advancing tick.
  The gateway can replay the bot's last published state (still `inGame`) on
  connect, so with `launch` the advance gets the whole ready budget: a demo
  login takes about 20 s. If it fails after launching, it logs the client out
  (or kills it) before rethrowing, so no runner is left holding the player.
- `launchClient` spawns the lite runner (`server/webclient`, `src/lite/runner.ts`)
  or opens the browser client URL; each launch bumps `sessionId`, and the
  client's tick counter restarts with it. The runner gets its own process
  group (a terminal Ctrl-C reaches only this process), and it never outlives
  this process: a crash, SIGTERM or SIGHUP logs every launched runner out
  (`abandonClient`), and any other exit kills it.
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
  first in-world tick is relaunched with backoff.
- `launchClient` sets `LITE_LOGIN_JITTER_MS=0` for the lite runner (its 0-5 s
  fleet jitter only delays a takeover). For the browser it uses `CLIENT_URL`
  from the bot.env as the page (proxy.ts with `?server=`/`?gateway=`) and
  re-navigates the one scored tab over CDP (`CDP_URL`, `tab.ts`) to a one-time
  login token URL; see "Logging the browser tab in" below.

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
one tick of wall time (`tickMs()`) is waited past before a check, since the
server has already moved on and its publication is due.

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

| Measurement (`rehearse.ts` on the lab, fresh bots, lite client, bgsrv-mac, 300 ms) | Ticks |
|---|---|
| S00 step row, first published state to Lumbridge with the kit | **3** (3 of 3): question page +1, choice page +2, landed +3 |
| Stock `bot.skipTutorial()` (manifest entry 34, `travel-walk-enchant.ts`) | 6 |

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
