# What a demo hiscore time means

**Answer.** On rs-sdk-demo.fly.dev, a skill row's time is the account's playtime tick at the
moment the current level was reached, not its playtime at logout. Upstream 55fa26cca is live.
A throwaway account proved it on 2026-10-21. Woodcutting 17 was reached at client tick 72 of a
session that began at playtime 6,261, and the row reads 6,333 (6,261 + 72). The logout rule
cannot produce that value: the whole session lasted at most 66 seconds (about 220 ticks). The
Overall row equals the largest skill stamp. Rows are written only at a clean logout and appear
about 3 s after it. While the account is in the world, nothing on the board moves, including
across a 1,500-tick autosave. A player page exists from the account's first login, but until
its first save every row is blank, Overall included (`acquiredl13`, 2026-10-22, in
`speedrun/tools/fixtures/hiscore`). Every save stamps Overall whatever the levels, and a skill
row only from level 15 (`LoginServer.ts` `updateHiscores`; `cairn_h90`'s page: Overall 28 and no
skill rows). For competitors, two kinds of stamp are logout playtimes and
therefore upper bounds on the true reach tick: a stamp shared by several unrelated skills, and
a page where every row carries one value. That covers every account in the overall top 25
except nickoverall, and it covers the record (stunbaron, 35,916). Distinct stamps
(nickoverall, stunmine, nickquarry) are exact only if the levels were reached after the
deploy, and the page alone cannot show that.

The source-level rule is in `docs/speedrun/playtime-audit.md` (rs/28 branch). The rule's
history is in `docs/speedrun/research/competitors/public-code.md` section 5. The probe is
`speedrun/tools/hiscore-stamp-probe.ts`. The raw event log, one JSONL line per event, was
written to `speedrun/runs/hiscore-probe-cairn_hsp1.jsonl`, which is gitignored and local to the
executor that ran it. Every number below is copied from that log.

## 1. Deploy timeline

| When (UTC) | Event | Source |
|---|---|---|
| 2026-02-08 | Playtime tiebreak added: rows rank by level, then playtime ascending, written at logout | `public-code.md` section 5 (migration `20260208000000_hiscore_playtime_and_outfit`) |
| 2026-08-26 | Jamie Legg's PR #67 reports that logouts re-stamp maxed rows (never merged) | `public-code.md` section 5 |
| 2026-10-07 19:36 | 415491a1c: playtime is re-stamped only when a row's level changes, still at logout playtime | git |
| 2026-10-19 02:29 | ac6ef5e42 pushed: times to the second, with the exact tick count in the hover title | GitHub push events |
| 2026-10-19 02:31:48 | 55fa26cca pushed: `levelPlaytime[stat]` stamped at each level-up, save version 9; stamp-less levels fall back to logout playtime | GitHub push events (push `ac6ef5e42..55fa26cca`) |
| 2026-10-19 21:31 | b565f2d92 (world feed capacity), the last upstream push to date | GitHub push events |
| by 2026-10-21 03:30 | The demo shows exact-tick hover titles, so it runs at least ac6ef5e42; stunbaron is already #1 at 35,916 | `speedrun/tools/fixtures/hiscores-2026-10-20.html` (saved 2026-10-20 20:30 PDT) |
| 2026-10-21 08:21 to 08:23 | The demo refused logins ("Authentication timeout", then "Login server offline"): a restart | this probe |
| by 2026-10-21 08:33 | Stamping at the reach tick observed live | this probe, section 2 |

The demo does not publish its version, and the Wayback Machine has no capture after 2026-10-05.
So the only proven bound is this: 55fa26cca has been live since some time between 2026-10-19
02:31 and 2026-10-21 08:33. Both hiscore commits were pushed within three minutes, and nothing
else was pushed until 21:31 that day. The display commit was live by 2026-10-21 03:30. A deploy
that took the display commit without the stamping one would have had to fall inside those three
minutes, so the likely live date for 55fa26cca is 2026-10-19 (inferred, not proven). The restart
at 08:21 to 08:23 today could also have been the deploy; nothing seen from outside rules that
out.

**Where a pre-version-9 stamp can still come from.** Under 55fa26cca, a level reached on an
older engine has stamp 0. A deploy restarts the server, which logs everyone out on the old
engine first, so levels reached before the deploy were already written at that logout under the
old rule (logout playtime). After the deploy, a stamp of 0 surfaces as a new fallback write only
when a level changes on a save whose stamp is still 0, and that cannot happen once the account
has levelled on the new engine. In practice, then: **a level reached before the deploy shows a
logout playtime; a level reached after it shows its exact reach tick.** The Overall row takes
the largest non-zero stamp. It falls back to logout playtime only while every stamp is 0, for
example a fresh account whose levels are all starting levels (section 2, recon).

## 2. Live test (throwaway `cairn_hsp1`, 2026-10-21)

Setup: a new account (the lite client, auto-created at first login), skills levelled only by
chopping normal trees and burning logs near the Lumbridge spawn. It never traded, talked or
attacked, which keeps to tenet 6. "Client tick" is the lite client's count of server ticks
since that session's login (`state.tick`). The board was read from the player page, whose rows
come straight from the database (`web/pages/hiscores.ts`; only the rank column is cached).
Xp is 25x, so a log is 625 Woodcutting xp and a fire is 1,000 Firemaking xp; level 15 is
1,860 xp on this server's curve.

| Phase (UTC) | What happened (client ticks) | Board while in the world | Board after logout | Reading |
|---|---|---|---|---|
| recon 07:57 | New account, tutorial skipped; logged out at client tick 51 | no rows | Overall 28 at **52** | All stamps are 0 (starting levels), so Overall falls back to logout playtime. Server playtime at logout = last client tick + 1 |
| (failed login 07:58) | The client reached the world, then dropped before its first advancing tick | n/a | unchanged | See section 5: the character apparently stayed in the world for about 4,600 ticks |
| a 08:23 | Woodcutting 1→7 at 22, 7→11 at 31, **11→15 at 56**; then 1,553 ticks in the world (to 1,609) with the board read every 100 ticks; clean logout | **no change** over 1,550 ticks, which is more than one 1,500-tick autosave period (`World.ts` `PLAYER_SAVERATE`) | Woodcutting 15 at **4,708**, Overall 42 at **4,708** | Stamp at the reach tick (proved by phase c) |
| c 08:32 | **Woodcutting 15→17 at 72**, then logout (a duplicate client took over the session; see section 5) | no change | Woodcutting 17 at **6,333**, Overall 44 at **6,333** | If phase a stamped the reach tick, phase a's logout playtime is 4,708 + (1,609 − 56) = 6,261, and 6,261 + 72 = **6,333 exactly**. If phase a had stamped logout playtime (4,708), phase c would need 1,625 ticks in the world; it was in for at most 66 s (≈220 ticks) |
| d 08:35 | Firemaking 1→10 at 11, **10→15 at 29**; then 212 idle ticks; clean logout at 241 | no change over 200 ticks | Firemaking 15 at **6,433**, Overall 58 at **6,433**, Woodcutting unchanged at 6,333 | Session start ≈ 6,404, which matches phase c's ≈140 ticks in the world (08:32:50 to 08:33:32). The logout playtime was ≈ 6,646; the row took the reach tick. Overall = max(6,333, 6,433) |

What this settles, against the method's questions:

- **(a) Before logout:** no skill or Overall row appears or changes while the account is in the
  world, autosave included. That matches `LoginServer.ts`: autosave refreshes only the
  quest-point and wealth boards. There was no positive control showing the autosave fired; the
  1,550-tick window guarantees one global autosave boundary (`tick % 1500 === 0`).
- **(b) At logout:** the row carries the level-up tick, not logout playtime. It lands about
  3.2 s after the logout click (four samples: 3.2 to 3.3 s).
- **(c) A further level:** it re-stamps the row with the new reach tick (6,333). An xp-only
  change does not move it: Woodcutting stayed at 6,333 through phase d.
- **(d) A second skill:** Overall's time equals the largest stamp (6,433, Firemaking).
- **Offset:** within a session, the client's tick counter and the server's playtime advance in
  lockstep. Across a clean logout the arithmetic closes to within one tick: the recon logout
  counted one tick the client never saw (52 against 51), and phase c closes exactly. Read a
  stamp as "session-start playtime + client tick", with ±1 tick of slack.

## 3. Classification of competitor stamps

Rule used:

- **Batch, so an upper bound.** One stamp is shared by several skills that no single action
  levels together. Under 55fa26cca, two skills share a tick only when one action levelled both
  (a melee hit with Hitpoints, Attack/Defence/Strength under the controlled style, a quest
  reward). A shared value across unrelated skills is therefore a logout playtime: an old-rule
  write, or a fallback. The true reach tick of each member is at or before that value.
- **Quest Points equal to a skill stamp** marks that value as a save-time playtime, not a reach
  tick. The QP row is always stamped with `player.playtime` at a save, autosave or logout
  (`updateQuestHiscore`).
- **Distinct, so exact if post-deploy.** Distinct values are what the new rule produces. The
  old rule produces them too, for an account that logged out between level-ups, so they are
  exact only if the levels were reached after the deploy (section 1). For accounts that already
  sat at these values in rs/69's first snapshot (2026-10-21 08:04 UTC), nothing on the page
  dates them.

Pages read 2026-10-21 10:50 UTC with `hiscore-stamp-probe.ts classify` (one request a second).
They agree with rs/69's 08:04 snapshot (`hiscores.md` and `data/` beside this file); no listed
account changed in between.

| # | Account | Overall (ticks) | Distinct stamps over 19 skills | QP (level @ ticks) | Classification |
|---|---|---|---|---|---|
| 1 | stunbaron | 35,916 | 3: 12,006 (Pray, WC, Fish, Mine); 17,697 (Fletch, FM, Craft, Smith, Herb); 35,916 (the other 10) | 13 @ 17,697 | **Upper bound, every row.** Three logout batches; QP sits in the 17,697 batch. The 35,916 batch was written by a pre-deploy logout |
| 2 | stunhard | 36,246 | 3: 12,507; 18,156; 36,246 (same split as stunbaron) | 13 @ 18,156 | Upper bound, every row |
| 3 | stunless | 36,325 | 3: 12,697; 18,358; 36,325 (same split) | 13 @ 18,358 | Upper bound, every row |
| 4 | stunking | 38,597 | 3: 12,070 (WC, Fish, Mine); 18,920 (Pray + the five); 38,597 (the other 10) | 33 @ 65,804 | Upper bound, every row. QP was raised long after maxing |
| 5 | nickoverall | 45,443 | 16: Fletch 312; Craft+Herb 2,698; Pray 2,725; WC 7,653; FM 8,470; Atk+Def+Str 18,421; HP 18,864; Rng 21,269; Mag 22,087; Thiev 26,675; Smith 30,033; RC 32,229; Fish 34,650; Cook 34,821; Mine 40,127; Agil 45,443 | 6 @ 27,210 | **Exact if maxed after the deploy, otherwise logout values; not decidable from the page.** The Atk/Def/Str tie fits the controlled style. The Crafting+Herblore tie at 2,698 is the one pair the new rule finds hard to explain (two unrelated 99s in one tick); a logout explains it trivially. Treat it as "probably exact", not proven |
| 6 | gh_kadeski | 46,681 | 1 (every skill) | 8 @ 46,681 | Upper bound (one logout; QP in the same write) |
| 7 | asukalabs1 | 198,277 | 1 | 4 @ 198,277 | Upper bound |
| 8 | asukalabs | 423,135 | 1 | 4 @ 423,135 | Upper bound |
| 9 | zayne | 639,986 | 10: one batch of 10 at 224,513, then one skill per value | 8 @ 433,164 | Batch: upper bound. The 9 singles are exact only if post-deploy |
| 10 | claudefable5 | 670,390 | 1 | 5 @ 670,390 | Upper bound |
| 11 | codexastra | 955,124 | 1 | 14 @ 955,124 | Upper bound |
| 12 | 0hyl8lmri | 1,381,283 | 2 batches (7 and 12 skills) | 135 @ 1,261,343 | Upper bound |
| 13 | skylordafk | 1,441,969 | 1 | 6 @ 1,441,969 | Upper bound |
| 14 | sokobot | 1,668,714 | 1 | 135 @ 2,057,324 | Upper bound |
| 15 | simplereally | 1,726,493 | 1 | 37 @ 1,726,493 | Upper bound |
| 16 | soko | 1,876,293 | 1 | 135 @ 1,880,939 | Upper bound |
| 17 | nickai | 1,887,262 | 1 | 124 @ 2,281,587 | Upper bound |
| 18 | inaribot1 | 1,903,145 | 1 | 39 @ 1,903,145 | Upper bound |
| 19 | vends | 2,075,994 | 1 | 36 @ 2,075,994 | Upper bound |
| 20 | syn | 2,533,973 | 1 | 93 @ 2,533,973 | Upper bound |
| 21 | eja620 | 2,672,692 | 1 | 9 @ 2,672,692 | Upper bound |
| 22 | bimmyglm53 | 3,514,165 | 5: batches of 6, 4, 4, 4, plus Thieving alone at 186,203 | 12 @ 2,364,115 | Upper bound (Thieving's single value is exact only if post-deploy) |
| 23 | claude46 | 4,452,664 | 1 | 72 @ 4,452,664 | Upper bound |
| 24 | jackthief | 4,825,784 | 1 | 38 @ 7,739,432 | Upper bound |
| 25 | bimmydsv4 | 5,703,153 | 1 | 8 @ 5,999,941 | Upper bound |
| — | stunmine (Mining board #1) | 4,575 (total 170) | Mining 99 @ 4,575; Magic 45 @ 136 | 2 @ 269 | Single values: **exact if post-deploy, else an upper bound**. QP by 269 and Magic 45 at 136 are consistent with Doric's Quest and Imp Catcher first (rs/69) |
| — | nickquarry | 6,015 (total 126) | Mining 99 @ 6,015 | 1 @ 764 | Same: exact if post-deploy, else an upper bound. rs/2 `mining.md` section 4a already explains 6,015 as a slow iron route, so the bound changes nothing |

On one-value pages the Overall time equals every skill's time, and the QP value usually does
too. Each is one logout that wrote the whole account. The account was trained to 99 on the old
rule or a pre-version-9 save and published in one go, so the gaps between its skills cannot be
recovered at all.

## 4. Implications

**Reading competitor times.**

- For ranking, the shown value is what we must beat, whatever it means. Our Overall stamp will
  be our exact last-99 tick, so the target is "< 35,916" whether or not stunbaron's true tick
  was earlier.
- For inferring methods and rates, a batch value overstates the time: the operator was at least
  as fast as shown. Gaps between batches are not per-skill times. rs/69's per-account orderings
  already flag batches; this document is the live basis for that flag.
- If the stun operator re-runs under 55fa26cca, its new account's stamps will be exact, and its
  Overall time can fall below the old one by the slack between its last 99 and that logout. We
  cannot measure that slack from the page. A bot that logs out on completion has little.
- A competitor's progress is invisible until it logs out. A run that never logs out shows
  nothing on the board until it finishes; only `/playerpositions` and in-game observation
  (rs/71) see it earlier.

**Our own run.**

- The score is the tick of our last level-up, so time after the final 99 is free. Log out
  cleanly anyway: the board shows nothing of ours until a logout save reaches the login server.
  Autosave publishes skill rows never, and quest points and wealth only.
- An interim logout publishes interim rows (about 3 s later) and costs no ticks (audit 1c), but
  it tells anyone watching the board where we are. Staying in the world keeps our progress off
  the board.
- Monitor the run from our own tick log, not the board: the board lags by a whole session.
- A quest-point time is a save time, not the moment the quest finished.

## 5. Incidents during the probe

### 5.1 The dropped login (settled by rs/101)

**What happened.** At 07:58 UTC a phase-a login reached the world, and `openSession` threw
`tick did not advance` (the replayed-state bug below). The probe exited, but the lite runner it
had launched kept running. Nothing killed it: `openSession` did not clean up after itself, and
a Bun parent's exit does not end its children (measured below). The runner kept sending
keepalives, so the server kept the player for about **4,600 ticks**, until the demo restart at
08:21 to 08:23 cut its socket. The evidence is in rs/72's transcript. The batch
(`live cairn_hsp1 a 2>&1 | grep | tail`) failed within a minute of the login, but its result
came back only at 08:22:14. The `| tail` pipe stayed open because the orphaned runner held the
inherited stderr. The runner's last line, `Game session ended (disconnected)`, was printed by
the restart, not at 07:58. Under today's code, a server-side drop alone is capped at 1,000
ticks (below), so 4,600 ticks needs a live client.

**How long a player stays after its client drops.** The engine increments `playtime` for every
player in the player loop, whether or not a socket is attached (`World.ts` `processClientsIn`).
`NetworkPlayer.decodeIn` sets `lastConnected` every tick that a socket is attached, and
`lastResponse` every tick that bytes arrive. A closed websocket swaps in a `NullClientSocket`
(`web/websocket.ts` `close`), which freezes both. `World.processLogouts` then applies two
constants (`World.ts`, `TIMEOUT_NO_CONNECTION` and `TIMEOUT_NO_RESPONSE`):

| Client state after the drop | Rule | N (ticks) |
|---|---|---|
| Socket closed (process killed or crashed; the OS sends the FIN) | `currentTick - lastConnected >= 500` sets `requestIdleLogout`, re-set every tick, honoured once `currentTick >= preventLogoutUntil` | **500** |
| Socket open but silent (network gone, no FIN; or the client process frozen) | `currentTick - lastResponse >= 1000` forces the logout and ignores `preventLogoutUntil` | **1,000** |
| Client alive with nothing driving it (orphaned lite runner, wedged bot, forgotten browser tab) | None applies. The lite runner sends `NO_TIMEOUT` every 50 client cycles, about 1 s (`lite/session.ts` `KEEPALIVE_CYCLES`), and the browser client sends it too (`Client.ts`) | **unbounded** |

The player cannot be removed while any of these hold:

- `preventLogoutUntil` has not passed. Combat sets it 16 ticks ahead (`p_preventlogout` in
  `logout.rs2`). This delays the 500-tick path only.
- `canAccess()` is false: the player is `delayed`, or a protected script is running.
- The engine queue is not empty.
- A queued script is not a discardable LONG queue.

The last three hold up even the forced 1,000-tick path. Every one of them clears itself within
a few ticks in normal play: `closeModal()` runs first and drops dialog-suspended scripts. The
client's own AFK packet (`IDLE_TIMER`, `IdleTimerHandler.ts`) is ignored on the demo
(`NODE_DEBUG=true`, `fly.toml`). The browser client sends it after 10 minutes without input, so
it cannot end a forgotten tab either. `NODE_DEBUG_SOCKET` would raise both timeouts to 60,000,
but `fly.toml` does not set it. Nothing on the SDK side holds a player in the world: the
gateway relays between the SDK and the game client and has no engine socket of its own. A
runner told `save_and_disconnect` just closes its game socket, which is a 500-tick drop unless
a takeover login removes the player first.

**Measured.** The local runs used the speedrun lab on `bgsrv-mac` (load about 4 on 12 cores,
`NODE_TICKRATE=300`, `NODE_DEBUG=true`), with `speedrun/lab/measure-drop.ts`. Its oracle is the
saved `playtime` (byte 24 of the `.sav`), and every row is one run. Ticks are counted after the
client's last observed tick. A baseline clean logout before each scenario gave an offset of 0
between client ticks and saved playtime.

| Reproduction | Ticks in the world after the drop | Engine's own log |
|---|---|---|
| Local: SIGKILL the runner 20 ticks into a session | **499** | `requesting idle logout ... ticksSinceConnected=500` |
| Local: SIGKILL the runner the moment it logs in (the hsp1 shape) | **500** | same |
| Local: sever the network (a TCP relay drops both directions and keeps both sockets open; the runner itself gave up after 60 s) | **998** | `forcing logout ... ticksSinceResponse=1000` |
| Local: the controlling script crashes after `openSession({launch:true})`, today's code | still in the world after **1,303** ticks; the runner was alive after its parent exited; ended only by attaching and logging out | none until that logout |
| Demo, throwaway `cairn_dl1`, 2026-10-21 12:08 UTC: SIGKILL the runner 27 ticks in | **497 ± 2** by the server's playtime; gone from `/playerpositions` 507 wall ticks after the kill (5 s polling) | n/a |

The demo row comes from `speedrun/tools/drop-probe.ts`. A timed-out removal saves the player,
but a board row is rewritten only when its level changes, so the probe logs back in and chops
one log. Woodcutting's level-up at client tick 17 stamped 583, so the stay is
583 − 40 − (27 + 1) − (17 + 1) = 497. The account then logged out cleanly.

**The policy for the scored run.** Never leave the scored account's client to the server's
timeouts. `speedrun/lib/session.ts` now does the following:

- `startWatchdog` logs a wedged client out with `logoutClean`, the clean-logout primitive, and
  then logs back in. Wedged means no advancing tick for 10 ticks, or the gateway reports the
  bot dead or stale, while the client process runs. It falls back to a relaunch only when that
  logout is not confirmed within 8 ticks, or when the client process has exited. A relaunch's
  login takes the session over (`World.ts`, "kick the existing session"). That is the only way
  out faster than 500 or 1,000 ticks once the client cannot click.
- `progressStaleTicks` is opt-in. When the bot stops calling `markProgress` on a healthy client,
  the watchdog logs out and stays out (verdict `stop`).
- A launched lite runner no longer outlives its controller. A failed `openSession` logs it out,
  or kills it if the click cannot land, through `abandonClient`. A crash, SIGTERM or SIGHUP
  logs it out before exiting. Any other exit kills it, which bounds the stay to 500 ticks.
- The runner runs in its own process group, so a terminal Ctrl-C reaches only the step runner,
  which logs out at a safe boundary. Before this change, the runner's own SIGINT handler closed
  its socket, which is a 500-tick drop.

| With the fixed watchdog (local, 300 ms) | What it did | Ticks from the wedge until the old session left |
|---|---|---|
| Relay wedged, client alive: runner state stops reaching the gateway, but actions still reach the runner | clean logout, then relog | **10**: the 10-tick stale threshold, and the player left on the tick after the click (0 ticks of latency) |
| Client frozen (SIGSTOP) | logout not confirmed after 8 ticks, then relaunch and takeover | **20** |
| Client killed | immediate relaunch and takeover | **about 1** by the save (5 by wall clock) |
| Controller crashes after `openSession` | the exit guard clicks logout | **0**; the runner exited with the parent |

Answer, in ticks after our client drops:

| Case | Under the old code | Under this change |
|---|---|---|
| Clean logout | 0 ticks after the click (the relog budget is that tick plus the click's latency: 0 in the lab, about 2 through the demo relay) | same |
| Client wedged but alive | a relaunch, so the stale threshold plus login time | about 10 ticks: the stale threshold, then a clean logout |
| Client frozen | same as wedged | 10 + 8 + login time: 20 in the lab; on the demo, where a login takes about 20 s, roughly 85 (inferred, not measured on the demo) |
| Client died, watchdog running | detection plus login time; the README's lab figure is 12-14 | same: 1-5 in this lab, about 70 on the demo (inferred) |
| Client died, no watchdog | 500 (497 measured on the demo) | 500 |
| Controller crashed | unbounded (the hsp1 incident: about 4,600) | 0, through the exit guard |
| Network severed | 1,000; the watchdog's logout cannot land, and its relaunch cannot connect until the network returns. Once the network is back, the takeover ends the stay | same |

Residual risks. A SIGKILLed controller cannot run its guard, so the runner is orphaned and the
stay is unbounded. If that happens, attach (`openSession` without `launch`) and call
`logoutClean`. The browser webclient is a tab, not a child process: the watchdog's logout
works through the SDK, but the exit guards cannot reach the tab, and a forgotten tab holds the
player indefinitely. Logout waits out combat (16 ticks). The cases marked inferred have not
been measured on the demo.

### 5.2 Other incidents

- **A stale replayed state broke `openSession`.** On connect, the gateway can hand back the
  bot's last published state, still marked `inGame`. `openSession(..., {launch: true})` then
  allowed only 6 s for the tick to advance, while a demo login takes about 20 s, so it threw.
  The retry launched a second client, which took over the first session (phase c). Fixed in
  this change: a launched client gets the whole ready budget to advance. The failure messages
  came before the new client could have been in the world, which is why this reads as a
  replayed state (inferred, not traced in the gateway).
