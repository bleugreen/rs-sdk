# Playtime and hiscore accounting audit

Read-only code audit of how the rs-sdk-demo hiscores score a level, and whether any legal
client packet sequence awards xp or stamps a level without the matching playtime. Nothing was
run against the public server and no lab run was needed: every point below settles from the
engine source. Audited at `ba651f45f` (base `agent/rs-28-coordinator-0`). Production settings
are read from `fly.toml`.

**Verdict: nothing material.** No legal client sequence moves a level's stamp earlier than the
tick it was reached. The only edges found are worth at most one tick, or they hurt the player
rather than help.

## How the score is computed

`Player.playtime` is a counter that `World.processClientsIn` increments once per tick for every
player in the player loop (`World.ts:692`). Connection state does not matter. The counter is
saved and restored with the account. `Player.addXp` is the only place a base level rises in
normal play: content reaches it through the `stat_advance` opcode (`PlayerOps.ts:811-818`). When
a base level rises, `addXp` copies the current counter into `levelPlaytime[stat]`
(`Player.ts:1904-1905`). That array is saved in every save, as save version 9
(`Player.ts:306-308`, `PlayerLoading.ts:183-187`).

Skill and Overall hiscore rows are written only when a logout save reaches the login server
(`LoginServer.ts:746` calls `updateHiscores`, `LoginServer.ts:101-198`). Autosave only refreshes
the quest-point and wealth boards (`LoginServer.ts:747-767`). The Overall row stores the total
level with playtime equal to the **maximum per-skill stamp**, not total playtime
(`LoginServer.ts:117`, `:125`). Its time changes only when the total level changes (`:134`). A
skill row is written once the skill reaches level 15 (`:160`). It stores that skill's stamp
(`:162`), and its time changes only when the level changes (`:171`).

The boards rank by `level DESC, playtime ASC` and exclude staff above moderator level 1
(`RankedHiscoresWorker.ts:18-19`). There is no third sort key, so two rows with the same level
and the same tick come out in whatever order SQLite returns them. Times are displayed as ticks
multiplied by `NODE_TICKRATE`, which is 300 ms in production (`hiscores.ts:61`,
`fly.toml:26`). The ranked unit is therefore **ticks spent in the world when the last level-up
happened**. Wall-clock time and logout time play no part.

## Findings

In the table, "Basis: read" means the behaviour was traced line by line. "Basis: inferred"
means it was reasoned from the code but not traced end to end or exercised.

| # | Path | Code | Reachable by a legal client sequence | Score effect (ticks) | Basis |
|---|------|------|-------------------------------------|----------------------|-------|
| 1a | **Login tick.** A joining player is added to the loop in `processLogins`. That runs after this tick's `playtime++` and after the player pass, so the joining tick is not counted. `onLogin` runs the `[login,_]` trigger in this tick. | `World.ts:402,425,434`, `World.ts:1096-1133`, `login.rs2:1-94` | Yes | 0. None of the 29 procs, timers and queues the login script reaches calls `stat_advance`; they only arm timers and queues. The earliest possible xp is in the next tick's player pass, after that tick's increment. | read |
| 1b | **Wine fermentation armed at login.** `~ferment_wines_login` only calls `settimer(fermenting_wine, 20)`. The timer fires in a later tick's `processTimers`, after that tick's increment, and its `stat_advance` calls are stamped with the in-session counter. The timer has no Cooking level check; that is the known, legal content exploit. Timers do not run while the player is logging out. | `login.rs2:70`, `wine.rs2:22-73`, `World.ts:786-791` | Yes | 0 | read |
| 1c | **Session boundary.** The logout tick is counted, since the player was in the loop during `processClientsIn`. The next login loads that same value and the joining tick is not counted, so the boundary neither gains nor loses a tick. | `World.ts:692,826-890,906-1145` | Yes | 0 | read |
| 1d | **Logout ordering.** `processLogouts` runs after the player pass in the same tick. The logout trigger and removal wait until the engine queue is empty and every queued script is discardable. While removal is deferred, queues keep running and their xp is stamped with ticks that are being counted. At most 10 removals happen per tick under load. `[logout,_]` grants no xp. | `World.ts:826-890`, `logout.rs2` | Yes | 0. A deferred logout adds counted ticks, which costs the player. | read |
| 1e | **Session takeover** (logging in while already logged in). The live player is serialized with `other.save()`, which also writes the exchange checkpoint, then reloaded into the new session; the old session is removed without a save. The counter carries over unchanged, and the old copy was processed this tick before removal. The login script runs again but grants no xp. The login server refuses takeovers less than 10 s apart. | `World.ts:988-1037`, `Player.ts:312`, `PlayerLoading.ts:36-37`, `LoginServer.ts:573-601` | Yes | 0 | read |
| 1f | **Reconnect** (client login opcode 18). The new socket is attached to the player already in the world; the player never leaves the loop, and the counter keeps running. | `World.ts:947-985`, `LoginServer.ts:522-572` | Yes | 0 | read |
| 1g | **Reconnect race.** Whether the world already holds the player (`hasSave`) is decided when the request is sent. If that player logs out and the logout is acknowledged before the login server replies, the reply carries no save and the world loads an empty one. With the exchange store enabled, as in production (`GE_DATABASE`), `PlayerLoading.load` swaps in the latest checkpoint first, so the real account loads. Without the store, a blank account loads; its later saves are refused by `wouldResetSaveFile`, but `updateHiscores` still runs on its stats and drags the Overall row down until the next real logout restores the correct stamp. | `World.ts:2263,2279,2621`, `PlayerLoading.ts:36-55`, `LoginServer.ts:341-356,707,746`, `fly.toml:13` | Only as a narrow timing race | 0 in production. Without the store the effect is transient and harmful only; it never yields an earlier stamp. | inferred |
| 1h | **World-queue and NPC scripts.** The world queue runs before `processClientsIn`, so any xp it gave a player would be stamped with the previous tick's value. NPC scripts run after the increment. | `World.ts:395,402,414` | Unknown; no world-queue xp script was found | -1 at most | inferred |
| 1i | **Players outside the loop.** Players waiting to join or waiting for their logout to be acknowledged run no scripts. Nothing earns xp while logged out. | `World.ts:160-162,935,2289,2602` | n/a | 0 | read |
| 2a | **Autosave versus logout writes.** The stamp is fixed in memory at the level-up tick and travels in every save, so logging out sooner or later does not change the score; it only decides when the board shows it. A crash rolls back to the last checkpoint, and the level and its stamp roll back together. | `Player.ts:1905`, `LoginServer.ts:746-767`, `World.ts:478-481,1433-1465` | Yes | 0 | read |
| 2b | **Stamp of 0 (the fallback).** A stamp is 0 only for starting levels (Hitpoints 10, everything else 1) and for levels reached on saves older than version 9. A skill row falls back to logout playtime, which is later and therefore worse, and only when the row is new or its level changed. The Overall row ignores zeros through the max and falls back only when every stamp is 0. A level-up at playtime 0 cannot happen, because the first increment comes before the first packet is processed. | `LoginServer.ts:117,125,162`, `PlayerLoading.ts:44-55,183-187` | Yes | 0, or later (worse) | read |
| 2c | **`::setstat` and `::advancestat`.** `setLevel` changes a level without stamping it; `::advancestat` resets the skill to 1 and stamps the current tick. Both need staff level 3 or higher, and accounts above staff level 1 are excluded from the boards. `LOCAL_STAFF_LEVEL` applies only when `LOGIN_SERVER=false`; production runs with `LOGIN_SERVER=true`. | `ClientCheatHandler.ts:189,453-483`, `Player.ts:1963-1974`, `LoginServer.ts:87-99`, `LoginThread.ts:58-60`, `fly.toml:22` | No | n/a | read |
| 2d | **Stamping earlier than reached.** A stamp is always the current counter. The counter only increments while the player is in the loop, and only goes back if an older save loads. A save with a lower counter is refused on disk by `wouldResetSaveFile`, and a row keeps its old time while the level is unchanged. Nothing sets `levelPlaytime` except save load and `addXp`. | `Player.ts:1905`, `World.ts:692`, `PlayerLoading.ts:90,185`, `LoginServer.ts:134,171,351` | No path found | 0 | read |
| 3a | **Ranking and ties.** Rows sort by level descending, then playtime ascending. Overall stores the maximum of the per-skill stamps, which is the tick the current total was reached, not total playtime. Skills under 15 get no row of their own but still count toward the Overall stamp. Rows with the same level and the same tick have no deterministic order. | `RankedHiscoresWorker.ts:15-19`, `LoginServer.ts:107-153`, `hiscores.ts:101-114` | n/a | Same-tick ties only | read (tie order: inferred) |
| 4a | **Ticks versus wall clock.** The score counts ticks. Server lag, catch-up after a backlog (`nextTick` is clamped to 2 ticks of backlog), and the fast ticks during shutdown all change wall-clock time per tick, but not the tick count; the display assumes 300 ms per tick regardless. `::speed` is limited to staff level 4 and above. | `World.ts:389,1427-1430`, `hiscores.ts:61`, `ClientCheatHandler.ts:57,154-167` | Lag: not controllable. `::speed`: no. | 0 | read |
| 4b | **A dropped connection keeps counting.** A disconnected player stays in the loop and keeps accruing playtime. An idle logout is requested after 500 ticks without a connection (about 2.5 min), and happens once `preventLogoutUntil` passes. A logout is forced after 1000 ticks with no bytes received (about 5 min). `NODE_DEBUG_SOCKET`, which would stretch these timeouts, is not set in production. | `World.ts:150-151,834-843`, `NetworkPlayer.ts:63,75` | Yes | +500 to +1000 ticks per dropped session; this hurts the player | read |
| 4c | **The client idle-logout packet is ignored.** `IDLE_TIMER` is ignored when `node.debug` is true, and production sets `NODE_DEBUG=true`. A connected but idle client is never logged out by the client's own AFK timer. It still accrues playtime and is forced out only after 1000 ticks with zero bytes. | `IdleTimerHandler.ts:8-12`, `WorldConfig.ts:247`, `fly.toml:16` | Yes | Idle connected ticks count against the player | read |
| 4d | **What counts as "logged in".** Exactly the ticks spent in the player loop count. Logged-out time is free, and a logout followed by a login costs no extra counted tick (see 1c). Logout is gated by `p_preventlogout` (for example in combat). The hop timer applies only when switching worlds. | `World.ts:692,845-857`, `LoginServer.ts:603-621` | Yes | Saves every waiting tick spent logged out | read |

## Notes

- `updateHiscores` runs on the uploaded logout save even when that save was refused for disk
  (`LoginServer.ts:707` compared with `:746`). Only the race in 1g can reach this, and only
  without the exchange store.
- Production leaves `NODE_PRODUCTION` at its default of false (`WorldConfig.ts:103`). That
  enables the staff level 4 developer commands, including debug procedures and `::speed`.
  Ordinary accounts never get that staff level, so the score is unaffected, but it is a
  deployment setting worth knowing about.
- `server/engine/test/level-playtime.test.ts` covers stamping and persistence. It came in with
  `55fa26cca feat(hiscores): rank by the tick a level was reached, not logout`, which built on
  `415491a1c fix(hiscores): stamp playtime only when a skill's level changes`.

## What this means for the run

The score is the in-world tick of the last level-up. The levers are therefore to leave the
world whenever the account itself has nothing productive to do (helper deliveries, exchange
fills, waiting), to log out explicitly rather than drop the socket (4b), and not to leave a
maxed account sitting idle and connected (4c). The idle case does not move the final stamp,
but it does push back every intermediate total.
