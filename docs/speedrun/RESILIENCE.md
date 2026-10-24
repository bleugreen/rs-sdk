# Scored-run resilience: demo restarts, dropped connections, resume and saves

The demo's game process exits and Fly restarts it in place every 1.5-3.5 hours
(three times overnight on 2026-10-21, at 01:22, 04:53 and 06:14 PDT; same machine
before and after, so a crash or an out-of-memory kill, not a deploy;
cairn://p/rs/102). A 3-hour scored run should expect one or two. This document
says what such a restart costs the score, what the run does about it, and how
each piece is built. The code is in `speedrun/lib/demo-status.ts`,
`speedrun/lib/reconnect.ts`, `speedrun/lib/tab.ts`, the watchdog in
`speedrun/lib/session.ts`, and `speedrun/runner/resume.ts` with
`speedrun/runner/fence.ts`. The issue is cairn://p/rs/127.

Labels as in STEP-MANIFEST.md: **measured** (a committed lab script),
**read** (an engine or content line), **inferred** (arithmetic over measured and
read inputs).

## 1. What persists a player, and what a crash loses

**The save** (`Player.save()`, read) holds the position, every stat's xp and
level, `playtime`, the perm varps, the perm inventories (worn, inventory, bank),
and `levelPlaytime`, the playtime tick each level was reached. Engine timers and
queued scripts are not saved; content that needs them re-arms at login (for
example `~ferment_wines_login` in `login.rs2`, which is what makes the wine
relog work).

**When it is written** (read):

| Trigger | What is written | Source |
|---|---|---|
| Autosave every 1,500 world ticks | every online player, one transaction | `World.PLAYER_SAVERATE`, `savePlayers` |
| **Any player's logout**, anywhere in the world | every online player, one transaction | `flushPlayer` -> `checkpointPlayers` ("each removal performs a durable whole-world checkpoint") |
| A takeover login (a new client while the old player is still in the world) | every online player | `processLogins`, "Save current state on reconnect" |
| Grand Exchange operations | every online player | `MarketStore` transfers |
| A clean server shutdown (SIGTERM/SIGINT) | every player, through the forced logouts | `app.ts` `safeExit` -> `rebootTimer(0)` |

The whole-world checkpoint goes to the GE's SQLite store
(`data/market.sqlite`, `accounts` table, WAL with `synchronous=FULL`, so it
survives a process kill), which exists whenever `GE_ENABLED` is on (the default;
the demo runs the GE). A login loads that checkpoint in preference to the
`.sav` file (`PlayerLoading.load`). An out-of-memory exit runs no shutdown, so
the next login gets the last checkpoint.

**What a crash loses:** everything after the last whole-world checkpoint, for
every account at once. On the demo, with ~1,700 players, someone logs out every
few seconds, so the checkpoint is seconds old (inferred from the read code; the
lab below measured the mechanism, not the demo's rate).

**Measured on the local engine** (`speedrun/lab/measure-restart.ts`, three runs,
numbers in section 6): a logout by a third account checkpointed SCORED and its
trade partner every time (SCORED's saved playtime and Woodcutting xp moved at
that logout). Then a trade and a level-up after that checkpoint, a SIGKILL of
the engine, and a restart: on the next login both accounts came back at the
checkpoint. The second trade was undone on both sides, the second level-up
undone, and playtime back at the checkpoint value (residual -2 ticks against the
expected value in all three runs, the read timing).

## 2. What a restart costs the score

`playtime` is in the save, so a crash rolls playtime back together with the
progress. Work lost to a restart is therefore **score-neutral**: redoing it adds
back exactly the ticks the rollback removed. A whole-world checkpoint is atomic,
so a helper hand-off is rolled back on both sides or neither (measured above),
never one.

What a restart does cost:

| Cost | Ticks on the score | Wall time | Basis |
|---|---|---|---|
| The world is gone while the server is down | 0: no world, no ticks | ~1.8-2.4 min until logins are accepted (code 8 "Login server offline" before that) | rs/41 fleet logs, rs/102 polls (measured on the demo) |
| The relog into the restarted world | ~2, plus the 1-in-29 tail: ~3.6 expected | ~20 s demo login | RUN-ORDER.md section 4 (WINE "Relog risk") |
| Login to the resumed step's first action | 3 (local engine, 2 of 2 after the fix; 4 before it) | | measured, section 6 |
| Re-entering the interrupted step | the step's own resume overhead (re-plan a program, re-open a bank) | | per step, section 5 |
| Redoing the work since the checkpoint | 0 (score-neutral) | seconds on the demo | inferred |

**Per restart: about 3-4 ticks plus the step's resume overhead, and ~3-4 minutes
of wall time.** At one or two restarts per run that is under ~10 ticks.

The hiscore row (total level and its playtime stamp) is written only by the
login server's logout handler (`LoginServer.ts` `player_logout` ->
`updateHiscores`; autosave updates only the quest-point and wealth boards). The
stamp is the level-up's own tick, carried in the save as `levelPlaytime`. So a
restart after the last level-up costs nothing as long as the next session ends
with a clean logout; the final logout stays as RUN-ORDER.md has it.

The case that **is** on the clock is different: the client drops while the
server is up. The player stays in the world for 500 ticks (socket closed) or
1,000 (socket open and silent) unless something takes it over (rs/101,
`hiscore-timestamps.md` section 5.1). The watchdog does that at once:
measured 3 and 12 ticks in the world, plus 2 to the resumed step (section 6).

## 3. The save decision

A deliberate save is a clean logout and login: ~2 ticks plus the tail, about
**3.6 ticks expected per relog** (RUN-ORDER.md section 4). What it would protect
is progress since the last checkpoint, and that is worth **0 ticks** to the score
(section 2): playtime rolls back with it. Even counted as wall time, the demo's
checkpoint is seconds old. So:

- **No milestone justifies a deliberate save relog.** The wine step's planned
  fermentation relogs remain separate from S21's planned login-order relog:
  SCORED leaves while the altar givers join, then logs in behind them. Neither
  operation is a milestone save; S21's split recovery is described in section 5.
- **A severe tick-overrun burst** (at least ~10 catch-ups a minute for 2 minutes;
  21-26 a minute ran for 4 minutes before the 06:14 restart, n=1) is exposed as
  `restartLikely` (`demo-status.ts`, both thresholds parameters). The run's
  response is to pause the reactive loop (the host gate's plain-loop fallback),
  not to save. One option for main's in-run rule, by arithmetic: during a burst a
  knife step loses its knife gain on every unit it makes, while waiting the burst
  out logged out costs one relog (~3.6 ticks) and wall time. Where the burst
  outlasts a few seconds of a knife step, waiting it out logged out is the
  cheaper of the two on the score; whether the wall clock allows it is the
  operator's call.
- **A restart inside the wine window** behaves like the planned wine relog:
  fermentation re-arms at login from the saved inventory (`login.rs2`).

Nothing in the engine needs changing for the score. The restarts themselves
(an out-of-memory kill on a 4 GB machine, inferred) belong upstream.

## 4. Detect, reconnect, hand back

### Detection (`demo-status.ts`)

`DemoMonitor` polls `/playercount` (every 20 s by default, the rs/102 cadence)
and keeps a `RestartTracker`, which also takes our own login outcomes and the
catch-up counts. An outage opens on **two** unanswered samples in a row, or on a
count collapsing under a tenth of the recent running count, so a single stall or
network blip is not a restart (the demo has gone 1,987 ms without a frame and
recovered, rs/102). It ends when the count refills to half of before, or, where
there is no crowd (the lab), when our login is accepted. Every sample writes one
status line and `speedrun/runs/demo-status.json`; the run script prints the line
and the operator's screen can run the same thing:

```
bun speedrun/lib/demo-status.ts watch --last-restart=2026-10-21T06:14:07-07:00
06:20:31  demo up, 1,612 players | last restart 06:14:07, 6m24s ago | catch-ups 0/min
06:15:10  DEMO RESTARTING since 06:14:07 (1m03s), 0 players, logins refused x2
bun speedrun/lib/demo-status.ts show      # the last line the run wrote
```

### Two kinds of drop (`session.ts` watchdog, `reconnect.ts`)

The watchdog (rs/101's, extended) decides from the client first: a lite runner
that exited, or no advancing tick for 17 ticks (~5 s, raised from 10 for the
demo's ~2 s silences). A dead client is seen at once through its exit: 36-137 ms
after the engine died, measured. Before acting it asks `serverDown` (a
`/playercount` sample through the shared monitor, or the tracker still in an
outage):

- **Server up**: rs/101's path, at once, because the player is on the clock. A
  wedged client is logged out cleanly; a dead one is replaced by a fresh login
  that takes the session over.
- **Server down**: verdict `outage`, `reconnectAfterOutage`. Nothing is on the
  clock and nothing can be taken over. It clears any client still running,
  waits while the world does not answer (5 s polls), then tries one login every
  10 s until one is accepted (the demo refuses with code 8 for 1.5-2.5 min), so it
  is in at most one retry interval after logins open. `beforeLogin` is the
  login-order gate: tick-exact helpers in before SCORED (rs/117).
- **Our own gateway down** (rs/659): verdict `gateway_down`, a wait and nothing
  else. A tick that stopped because the SDK's socket to our gateway is down, or
  its status does not answer, says nothing about the client (the page may be
  playing on, unseen), and a logout through it cannot land. It is asked before
  the server probe. For `GATEWAY_BACK_GRACE_TICKS` (25) after the gateway is
  reachable again with no tick yet, a `stale` reading is still the gateway's: the
  page's own gateway connection retries every 3 s, the SDK's within 2 s
  (`GATEWAY_RECONNECT_MAX_MS`). Past that grace a stale tick is the client's
  again, as before.

### A page that fell out of a live world (`runner/drop-relog.ts`, rs/511)

The watchdog's verdict reads only the tick and the gateway, and its fallback is
a client relaunch. The 22:15:50Z drop (about 116 players world-wide, no restart,
the tick feed live) is a different case: the scored tab is on the title screen
while the world goes on. With `run.ts`'s relog budget on, the browser session
handles it itself:

- **Seen.** The link asks the page (`window.gameClient.ingame` over DevTools,
  `tab.ts` `pageInGame`) once the tick has stood 3 ticks; an out page is lost at
  once. A page whose socket died says it is in game for about 17 more ticks (7 s)
  before it notices, so the drop is usually seen at the stale bound; the
  watchdog acts 10 ticks after the link, and stands down for an out page only
  while a recovery is running (`dropRecovery` `acting`): with none running,
  nothing would relog it.
- **Relogged in page.** `recoverDrop` gives a page still claiming in-game 40
  ticks to settle (it reconnects itself: adopted; it falls to the title screen:
  relogged), then logs it in with `session.ts` `login({ inPage: true })`, the
  path planned relogs take, never a relaunch. No page to ask goes to the
  watchdog's path unchanged.
- **Every wait keeps asking the page** (rs/659). The adopt's wait for an
  advancing tick, the watchdog's path and a world or gateway outage all re-read
  the page every 3 ticks; a page out of the world with the account meant to be
  in (not during someone's logout), the world up and our gateway up is relogged
  in page there and then. Attempt 3 ended on the gap this closes: an adopted page
  was logged out a tick later, the adopt waited 120 s on ticks that could not
  come, and the watchdog stood down for a recovery that could not act. An adopt
  that fell out is relogged on the adopt's own budget entry (`RelogBudget`
  `amend`), so one drop costs one entry; at most `MAX_FALLS` (2) such falls per
  recovery. With the world or our gateway down the page is left out until both
  answer: a login could not land, or could not be seen landing.
- **Budgeted.** Every relog is a row in `<run dir>/relogs.json`
  (`runner/relog-budget.ts`) with its step and tick: the planned S21 relog plus 3
  unplanned, run.ts's and the operator's together. The start gate reads it; past
  it the recovery throws `RelogBudgetSpent` and the run stops with that reason.
  Between the halves of S21's split relog the account is out on purpose: no
  relog, nothing counted.
- **Measured** (bgsrv-mac, 400 ms, the 22:15 shape injected into a knife loop, a
  bank burst and a leg): drop to back in the world 24-26 ticks (9.5-10.3 s), the
  login itself 0.7-1.4 s; every step resumed and finished.
- **Measured, our gateway killed** (bgsrv-mac, 400 ms, `lab/drop-accept.ts
  --gateway-down`, rs/659): 60 s down mid-walk or mid-knife-loop, the page in
  the world throughout: no logout, no budget entry, the step resumed about 1 s
  after the gateway was back; the blind stretch is the cost (148 ticks on the leg,
  172 on the knife band, against a 150-tick outage). The page out when the
  gateway came back: one in-page relog, one entry. The page out in the adopt's
  own tick: relogged on the adopt's entry, one entry.

**The race rule: a manual relog is adopted, never fought.** The operator's
`bun speedrun/tools/relog-now.ts <bot>` (from an ssh shell on the run host,
against the tab's DevTools on loopback 9222) and run.ts share one lock,
`<run dir>/relog.lock`, created exclusively; a holder whose pid is gone is
broken by the next taker. relog-now confirms only by the page's own in-game flag
with its tick advancing, never by the gateway's `inGame`, and does not open an
SDK session (a second controller would take the gateway from run.ts).

- run.ts never starts a relog while the operator holds the lock; it waits for
  it to go, finds the page in the world, adopts that session
  (`session.ts` `adoptSession`) and resumes exactly as after its own relog.
- A page already back in the world when run.ts looks is adopted and recorded as
  a manual relog, the same budget.
- relog-now refuses while run.ts holds the lock, while S21's planned relog is
  open, and when the budget is spent, and does nothing in each case.

### Confirmed logout (`session.ts` `logoutClean`)

A logout click is confirmed by the account being out (the page's flag, the
lite child's exit, the gateway, or for a lite client with nothing else the
world's own `/playerpositions` list) within `LOGOUT_CONFIRM_TICKS` (4) observed
ticks, or the click is sent again, up to `LOGOUT_WAIT_TICKS` after the first.
The bound is twice the demo's 2-tick figure (0 ticks in 42 of 42 lab relogs,
rs/164); rs/310's unconfirmed tab logout left the account in the world for 117
ticks. Each result carries `sends` and `confirmTicks` (click to out); S21's
logout half goes through it. The watchdog's own logout is held while a bank or
trade is open, for at most `INTERFACE_HOLD_TICKS` (100), then acts as before: a
click would close the interface under the step.

A logout belongs to the game session it was issued in (rs/659). Every click goes
through `sendLogoutClick` with the `sessionId` it was issued under: once an
adopt, a launch or an in-page login has begun a newer session it is dropped, and
a `logoutClean` still waiting stops (`superseded`, which the watchdog takes as
no failure). And a logout is never handed to an SDK that is not connected:
BotSDK queues an action sent while it reconnects and dispatches it the moment the
gateway is back, which is how attempt 3's watchdog logout reached the session
run.ts had just adopted.

### A death is never a clean stop (`runner/death.ts`, rs/709)

Attempt 3's twin rehearsal: S14 refused at tick 231 at the Wilderness spiders,
the logout after it waited out 37 ticks of combat, and SCORED died and respawned
at Lumbridge before the click. The logout was logged `ok`, and the next session
refused S14 on site with no reason given. Now one `DeathWatch` watches every
state of the two stretches where a death could otherwise pass unseen:

- **Every logout** (`logoutClean`): a stop, the logout after a refused or failed
  step, a signal, the watchdog's, and relog's. It watches from the call until the
  account is out.
- **Every leg** (`runLeg`): rs/593's relocation detector (`travel.ts`
  `onRelocated`) fails the hop when a relocation onto `RESPAWN` comes with a death
  the watch corroborates. Any other jump is re-pathed, as before.

A death is any of these: the engine's `Oh dear you are dead!` (death.rs2), hp 0,
the browser client's `lifeId` going up, or a jump onto the respawn square that the
hitpoints confirm (0 before it, or restored to full on it). A teleport elsewhere
is not a death, nor is a walk, nor a Lumbridge Teleport onto the square with the
hitpoints unchanged. The lite client publishes no `lifeId`. If its frames skip
the 0-hp tick, a death within 15 tiles of the square shows only through the
message.

On a death the account stays out. The watchdog does not log it back in,
relog refuses, and the drop recovery refuses to relog. A death on a leg reaches
the logout at once (read from the code, not measured): the hop fails on the
first state after the corroborated landing, the step fails, and run.ts's
logout follows with nothing run between. `logoutClean` waits out only the
16-tick post-combat window from the killing hit, so the click lands at most
about 12 ticks after the respawn. The logout line says
DIED, giving the tile before and after. A held logout also reports its combat
ticks and hp trajectory. run.ts writes one `(death)` row and ends the attempt
with **exit 6**, whatever the chain ended with. Any later run into the same log
is refused at the start (exit 3), whether it would walk from game state or start
at a `--from`. It stays refused until R8's recovery is done (RUN-HOST.md, "After
a player-kill") and `--r8-recovered=<key>` names that death; the start then
writes `(death) acknowledged`. The key is the row's `runId@tick`, so a flag left
on a command line never acknowledges a later death.

### A launch is known by its id; a failed start is logged out (rs/668)

Attempt 3's 04:2xZ start: the loopback gateway still held a lite one-off's last
state for SCORED (210 s old) and handed it to run.ts's new controller as current.
The tab's token login reached the game, then the page's game socket dropped,
leaving a socketless body in the world. openSession waited 120 s for that cached
state to advance and exited with the body still in the world.

- **Identity, not freshness.** Every browser launch gets a launch id
  (`Session.launchTag`) in the tab's URL, `?launch=`. The page keeps it when the
  token leaves the URL, and the overlay echoes it in every state it publishes
  (`BotWorldState.launch`). openSession (`waitOwnLaunch`) takes only states that
  carry it. It refuses, with the reason and before anything is sent to the
  account, on: in-game states from another launch or with no launch id advancing
  (another client, or a page bundle that predates the echo: rebuild it with
  `cd server/webclient && bun run build`); the page, read over CDP once it shows
  this launch's URL, having made its auto-login and being neither in game nor
  logging in for `PAGE_ENDED_HOLD_MS`; the page in game with none of its states
  reaching our gateway for `GATEWAY_BACK_GRACE_TICKS`. The echo was chosen over
  the gateway's lists because those name SDK controllers, not the page, and a
  page's gateway client id is minted afresh on every reconnect. An id on each
  state holds through any gateway, upstream's included.
- **Log out what we logged in.** `abandonClient` on a browser tab
  (`abandonTab`) clicks logout inside the page over CDP, straight down its game
  socket, so neither our gateway nor the page's gateway socket has to be up.
  The click carries its session generation, as `sendLogoutClick`'s do. It is
  re-sent every `LOGOUT_CONFIRM_TICKS`, at most `ABANDON_SENDS` (15) times.
  The logout is confirmed only when the page is out of game *and* the world's
  `/playerpositions` no longer lists the account: a page whose game socket
  dropped is out of game while its body stays in the world for 500 ticks. That
  body cannot be clicked out, so once the page has been out with the account
  still listed for longer than a removal takes to show, the page logs in again
  in place, which takes the body over (World.ts "kick the existing session"),
  and the click then logs it out. There are at most `ABANDON_TAKEOVERS` (2)
  such logins, and in run.ts each one follows the relog rules (`takeoverGate`):
  it is refused while the operator's relog holds the lock or the unplanned
  relogs are spent, and is otherwise recorded as one unplanned relog.
- **Every startup failure in run.ts abandons.** A failed launch is abandoned
  by openSession, and the thrown error says how the abandon went; run.ts logs
  it as `(startup) SCORED launch failed`. A failed S21 login half is abandoned
  once that half has started; a refusal before it sends nothing. Everything
  after `openRunSession` runs inside `withScoredSession`, so any way out that
  leaves the account meant to be in the world (a throw before the chain, a
  crash inside it) ends in the abandon, logged as `(run) SCORED abandoned`.

The gateway itself (`server/gateway/gateway.ts`, upstream's code) still keeps a
gone client's last state, hands it to the next controller, and lets the next
client inherit it. The run no longer depends on that changing: the launch id
refuses such a state through any gateway.

### The two clients

- **Lite** (helpers, lab): each launch is a fresh runner. Our launches set
  `LITE_LOGIN_JITTER_MS=0`: the runner otherwise sleeps a random 0-5 s before
  logging in to a secured world to spread fleet starts, and on a takeover the
  dropped player is in the world meanwhile.
- **Browser** (the scored tab): the page auto-logs in once per load and, after a
  failed reconnect, sits on the title screen (`Client.ts`), so the only login
  path is a fresh navigation. Launch the run machine's Chrome with
  `--remote-debugging-port=9222` and set `CDP_URL=http://127.0.0.1:9222` in the
  bot.env (or `SPEEDRUN_CDP_URL`); every launch then re-navigates the one tab
  (`tab.ts`, closing duplicates that would fight for the account) instead of
  opening another. `CLIENT_URL` in the bot.env names the page served by
  `server/webclient/proxy.ts`, with `?server=` and `?gateway=` on it. Each
  launch navigates to a fresh one-time login token rather than the password
  (speedrun/README.md, "Logging the browser tab in"), so CDP is required: without
  it the launch fails instead of putting the token on a command line. The
  launch and a relaunch over a live session (the takeover) were run against a
  live headless Chrome on the local engine through `speedrun/tools/tab-login.ts`,
  which calls the same `openBrowserClient`.

### Handing back

The runner is not told anything: its link (`sessionLink`) sees the session lost
and later restored, and it walks the manifest again (section 5).

## 5. Resume from game state (`runner/resume.ts`)

After a restart the account is wherever the last checkpoint left it, so the run
script's own idea of "the step I was in" is wrong. `runResumable` therefore walks
the manifest against the game on every start, operator restarts included:

1. **Milestones** are the steps with `done(observed)`: true once the step's
   effect is in the game and for every later state of the run (levels, xp, quest
   status, items owned). The walk finds the first milestone that is not done.
2. Between the last done milestone and that one, **the latest step that can
   start now** wins: from the undone milestone back, a step whose
   `inProgress(observed)` holds is entered through its `resume` handler (default
   `run`), else one whose preconditions hold is entered through `run`. Transient
   steps (legs, banking) whose effect is already in the state are skipped.
3. If nothing qualifies, it stops for the operator with every candidate's reason.

**A logout-unsafe step is never re-entered mid-step from the top.** The engine
keeps a dropped player in the world for 500 ticks (`World.ts`
TIMEOUT_NO_CONNECTION), so a relogin inside that window is a session takeover:
the same tile, HP and prayers, and the fight still on. For a step with
`logoutSafe: false` (a fight, a queued completion) the walk therefore enters
through `resume` only when the step has one and its `inProgress` holds. When
`inProgress` holds and the step has no `resume`, or when `run` would start it
inside the combat window (engaged, or hit within the server's 16-tick logout
rule: `lib/world.ts` `inCombatWindow`), the walk stops at that step with a
`MidStepError` instead of walking further back. `runResumable` then waits a
bounded time (`MID_STEP_HOLD_TICKS`, unmeasured) for the window to end,
observes again and walks again; if the step is still mid-step, the run stops
for the operator naming the step and the reason. The wait is idle (nothing eats
or prays), so a new hit during it ends it at once with the refusal: something is
still attacking, and idling on is worse than stopping. A step whose `run` picks
up a fight already on, or already runs under a protect prayer in an aggressive
zone, declares `startsInCombat` and is never held: the Fight Arena fights and
arena door, Monkey Madness G, Q and X, Grand Tree N1, Mage Arena C, S14 and S27.
A step with `inProgress` whose `run` is written to re-enter names it as its
`resume` (Monkey Madness E, Mage Arena C). The held steps are the ones whose
`run` would re-talk or walk away mid-fight in a zone that is otherwise safe; no
chain step is refused outright today.
`runner/resume-takeover.test.ts` pins the table. Logout-safe steps resolve as
before.

**A milestone must stay done.** Step 1 stops at the first undone milestone, so
one that turns false later sends the walk back to a step whose preconditions
then refuse. Two shapes keep `done` monotonic where the state alone moves on:

- **Owed where it runs.** A step's exit work (mining.exit's drops, S25a's last
  hand-back, S14's cannon pick-up) is owed only at the place it runs: off that
  site the step is done at its level whatever the pack holds. A throw before the
  exit work, still on the site, leaves the step undone and re-entered.
- **The attempt record.** Some completions leave no lasting game fact, so the
  attempt keeps one record of them: `<run dir>/attempt-record.json`
  (`runner/attempt-record.ts` `AttemptRecord`, keyed by the attempt id run.ts
  shares across processes, so a fresh attempt sees none and a resumed process
  sees what an earlier one marked). A missing or empty file is nothing recorded;
  a file that does not parse refuses the run. It holds two kinds of mark, kept
  apart:
  - **Hand-off rows.** The band after a hand-off consumes what it brought
    (S18's stuns and food after H14, S22's feathers after H18), and the band's
    own `inProgress` already holds on arrival, before the trade, so the state
    cannot tell "traded, then used" from "not yet traded". A hand-off step marks
    its row once its post-hand-off state shows, and reads as done from then on
    unless what it gave is held again (a demo rollback across the swap). It also
    stays done once the next milestone is (`supersededBy`). The rune census
    reads the same rows as supplies already served.
  - **Step names.** `runSteps` marks every step's `name` once its
    postconditions pass, entered through `run` or `resume`. The walk hands the
    marks to every `done` and `inProgress` it evaluates as `Observed.record`, and
    a milestone with no game fact to read uses it: the Mage Arena's pool,
    statue and guardian segments, whose cape and staff S16's exit drops, and
    Doric's hand-in. While the observed state is out of the world (S21's relog
    split, a walk before a login lands), a milestone the record has counts as
    done without reading the game, since every quest stage and the player read
    empty there; in the world each `done` decides.

Every walk first waits, bounded in observed ticks (`PLAYER_MAX_TICKS`), for a
state that carries the player: a relaunched or reloaded client can publish
frames before it, and S00's `done` reads the player, so a walk on such a frame
would see S00 undone and refuse 'not in game'. Past the bound the walk observes
what it has (an account out on purpose, between S21's relog halves, publishes
none); the `(resume)` row's `meta.player` records the wait.

Every walk then turns the run toggle on (`lib/run-mode.ts`). The toggle is
not saved, and a session brought back by a relaunch or a page reload never
went through `login`, which does the same. A toggle that will not take is
recorded in the `(resume)` row's `meta.run` and warned; the walk continues.

Steps that need more than the published state declare **probes** (a bank-open
probe, a quest-journal read; rs/114's quest status and journal). Probes cost
ticks, so they run only when the walk reaches a step that declares them, once
per walk. `--from` overrides the first walk only.

On a lost link the attempt is **abandoned, not cancelled**: its promise is still
inside a wait or a send. `fence.ts` ties everything the attempt does to it
(`AsyncLocalStorage`): once aborted, its sends are refused at the SDK's one
`sendAction`, and listeners it registered stop firing, so it cannot act on the
reconnected session. A step error that arrives after the session changed, or
rs/97's `awaitProgram` "page reloaded" rejection, counts as the drop, not as a
failure. Ledger rows: `(resume)` (where and why, probes used) and `(drop)` (the
step running, the reason, recover wall time, the new session's ticks before the
resume).

**Markers.** A 0-tick step with no game effect (the S03 dropper go cue, the S14
and S27 cue stops) is a `marker`: its preconditions always hold, so on its own
it would win the walk over the unfinished step before it. The walk enters a
marker only where the step before it finished or the step after it can start.
The go cue is `done` once its file exists (a rewrite would restart the
droppers); a cue stop once its scope is no longer open (`CueSink.isOpen`), so a
late stop never closes a helper's newer session.

**Deep Wilderness.** A leg that opens with a teleport cannot restart above
Wilderness level 20 (the spell is refused there). A player off every checkpoint
there resumes at the leg's last run whose target is itself above level 20
(`legs.ts` `deepWildernessHop`): unit-tested, not lab-run.

**In-page programs (rs/97)** resynchronise from observed state, never from their
counters: a reload restarts the page's runtime, so the resumed step starts the
program again with parameters computed from the state (target level or xp, the
inventory now), and treats the old run's counters as gone.

### S21's split login-order relog

S21's planned relog is a login-order operation, not a save. The chain permits
its logout milestone only after the canonical T20-21 arrival predicate holds;
a restart before or during that leg must finish the approach first.
`runner/scored-relog.ts` opens one persistent entry in `runner/relog-budget.ts`
as soon as `logoutClean` reports SCORED out, and only then confirms the page is
out. A page-out it cannot confirm throws with the entry open: SCORED is out
with an open entry, which the walk resumes at the login half and a new process
checks against the page first (below). Opening it after the confirmation would
leave SCORED out with no entry, which neither half admits. The same entry
closes after a successful login; the halves share the relog lock.

Between the halves, `skills/runecraft.ts` publishes giver cues and waits on
login-free observed world-feed ticks from `lib/feed-hello.ts`, not the paused
player state. Advancing server tick labels bound the ready wait; silence and a
world-tick rollback fail closed. Offline steps in `runner/step.ts` skip player
tick freshness, packet-budget waits and run-toggle clicks.

Every login attempt rechecks the complete fresh giver roster. The final
`beforeDispatch` check runs after the asynchronous tick preflight and token
minting. It supplies a freshness deadline that `lib/tab.ts` checks again after
token redemption, immediately before the page dispatches login. The controller
and browser share the run host's wall clock for status freshness; elapsed wall
time never proves giver readiness. S21 requires the token-backed in-page path:
a refusal, expired admission, missing client, live page or pending login must
not fall back to navigating the tab. World-full retries repeat the checks.

On startup, `run.ts` attaches without launching when the entry is open, then
reads the actual browser page before opening a giver cue. A proven idle,
logged-out page can repeat the ready wait and complete the login half. A live,
login-in-progress or unreadable page instead refuses with the entry unchanged
and no new login or navigation. A page being live alone cannot establish which
login set its processing order. **Automatic adoption after a crash between
accepted login and ledger close is not implemented.** An already closed
entry skips both halves during the resume walk. Startup recovery and gate rows
are anonymized to `SCORED` before being appended.

A refusal only disconnects the control SDK; it does **not** log out a player
that may still be live. Stop automated retries, inspect that account's actual
page and the retained relog entry, and have the operator confirm its state and
the intended reconciliation before continuing. Do not clear the ledger or
launch another login merely to bypass the refusal. The live player may still
accumulate playtime; refusal is not a zero-tick recovery.

The local dress-rehearsal harness still needs its browser wired through the
existing `server/webclient/proxy.ts` token endpoints. The canonical setup uses
the local engine as `--world`, its loopback gateway, a dedicated proxy port and
the scratch bots directory, then passes the proxy's `/bot` URL as
`launchLabBrowser`'s `clientUrl` and opens the session with
`insecureQueryLogin: false`. The proxy and browser must be owned and cleaned
up by the harness on every failure path. The engine's query-password page is
not a substitute for this path. Until that wiring is implemented and exercised,
mock-CDP tests do not establish S15–S21 or full-chain browser acceptance.

### Resume-from lines for STEP-MANIFEST.md

One line per manifest entry (sent to rs/103). "Quest status" is rs/114's quest-list
colour (not started / started / complete); "stage" is its journal read.

| # | Entry | `done` | `inProgress` / resume entry | Probes |
|---|---|---|---|---|
| 0 | run.ts | | walks on every start; `--from` only overrides the first walk | |
| 1 | Agility S11a, S17 | Agility >= 22 / >= 99 | on the course (position in the course area): restart the program at the next obstacle from the position | |
| 2 | Monkey Madness S15 | quest status complete | started: stage -> the segment's `STARTS` entry (`quest-mm-full.ts`) | journal |
| 3 | Woodcutting S07 | Woodcutting >= end level | at the site with axe and knife: restart `knife-cycle` with the target level, from the inventory now | |
| 4 | Mining S09 | Mining >= 99 | at the rocks, Mining >= 64: restart `knife-mine` with the target xp | |
| 5 | Fishing S22 | Fishing >= 99 | at the spot: restart `knife-cycle` | |
| 6 | Thieving S18 (+ stun pack) | Thieving >= 99 | at the knights: restart `pickpocket` with `stunActions` recomputed from the bones and runes held | |
| 7 | Combat finish S27 | every combat target level | at the site: check the cannon (a placed cannon is a world object: inventory and bank probe after a restart) | bank |
| 8 | The Grand Tree S11b | quest status complete | started: stage -> segment | journal |
| 9 | Runecraft S06, S21 | Runecraft >= 44 / >= 99 | in the altar room: restart the cycle; a new session cancels armed givers (rs/117 cue contract), and the givers log in before SCORED (gate) | |
| 10 | Smithing S25a | Smithing >= 99 | at the anvil: restart, bars from inventory and bank | bank |
| 11 | Transition legs | none (transient) | preconditions = the start tile; skipped when the next step can start | |
| 12-14 | Dwarf Cannon, Dragon Slayer, Tree Gnome Village | quest status complete | started: stage -> segment | journal |
| 15 | Prayer S10a, S25b | Prayer >= 43 / >= 99 | bones held: bury on; bones left in the bank | bank |
| 16 | Firemaking S03 | Firemaking >= end level | logs held or on the line: continue the row | |
| 17, 18, 20-23, 25, 30, 31 | the short quests | quest status complete | started: stage -> segment | journal |
| 19 | Mage Arena S16 | god cape or staff owned (`magearena` is not transmitted and the quest is not on the list) | in the arena (position): resume the fight from the position | bank |
| 24 | Magic S02, S04 | Magic >= 7 / >= 59 | enchant supplies held: continue | |
| 27, 28 | Herblore, Crafting | level | supplies held or banked | bank |
| 29 | Cooking by wine S25c | Cooking >= 99 | jugs held or banked: a restart inside the window is a relog (fermentation re-arms at login) | bank |
| 32 | Fletching (inside S18) | Fletching target | with S18 | |
| 33 | Hand-off H1 S01 | the H1 supplies owned | partner beside: re-run the receive | bank |
| 34 | Tutorial skip S00 | off the island (position) | | |

Helper-side scripts (H1-H8) are rs/117's roles, restartable from any state by
their contract.

## 6. Measurements

Local engine, `NODE_TICKRATE=300`, `GE_ENABLED` default (on), no login server;
executor `local` (macOS, Apple silicon); branch agent/rs-127-builder-0;
`speedrun/lab/measure-restart.ts`, 2026-10-21 08:02-08:09 PDT. Three accounts:
SCORED (srrs1), PARTNER (srrs2), CHURN (srrs3). The engine is SIGKILLed 40 ticks
into the step after the second trade and level-up.

**Engine SIGKILL (a restart)**

| | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| CHURN's logout checkpointed SCORED (saved playtime; Woodcutting xp 9,800 -> 11,320) | 107 -> 143 | 340 -> 367 | 597 -> 616 |
| Before the kill: SCORED coins / Woodcutting / PARTNER coins | 150 / 12 / 9,850 | 300 / 12 / 19,700 | 450 / 12 / 29,550 |
| After the restart | 100 / 11 / 9,900 | 250 / 11 / 19,750 | 400 / 11 / 29,600 |
| Ticks after the checkpoint erased (progress and playtime together) | 47 | 46 | 46 |
| Loaded playtime minus checkpoint playtime minus new-session ticks | -2 | -2 | -2 |
| Kill -> drop seen by the runner | 0.11 s | 0.14 s | 0.04 s |
| Kill -> replacement engine ready | 3.7 s | (log bug, fixed) | 0.8 s |
| Kill -> world answers /playercount | 4.5 s | 3.5 s | 1.1 s |
| Kill -> SCORED in the world (after PARTNER, the gate) | 11.6 s | 10.3 s | 4.1 s |
| Kill -> resumed step running | 11.7 s | 10.4 s | 4.1 s |
| Resumed at | trade-2 | trade-2 | trade-2 |
| SCORED's ticks from the relogin to the resumed step | 4 | 3 | 3 |

Run 1 predates the `restored()` fix (it waited one tick the login had already
confirmed); runs 2-3 are the current code. The local engine has no login server,
so the code 8 minutes cannot be reproduced here: the demo's ~1.8-2.4 min until
logins are accepted dominates the wall time there.

**Client SIGKILL, server up (a dropped connection)**

| | Run 2 | Run 3 |
|---|---|---|
| Kill -> resumed | 4.6 s | 1.5 s |
| Dropped player's ticks in the world (from the takeover's checkpoint) | 12 | 3 |
| New session's ticks before the resumed step | 2 | 2 |

**Demo:** not yet measured. No natural restart happened while this was built
(the last was 06:14 PDT); rs/102 will report the next one, and the procedure for
a throwaway (`cairn_` prefix, never a fleet or scored name) is the same script's
client-drop and outage paths against the demo.

Re-run with:

```
LAB_RUNNERS=0 LAB_BOTS="srrs2 srrs3" NODE_TICKRATE=300 speedrun/lab/lab.sh srrs1 \
  speedrun/lab/measure-restart.ts:--partner=srrs2:--churn=srrs3
```
