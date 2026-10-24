# Tick audit, band X: the costs every band pays

Read-only audit for rs/654 (under rs/158), 2026-10-23 PDT, from the code on main at the rehearsal's
run commit 1e536f76 and the measured lines on the main and host threads. It covers the shared runner,
the hand-off and cue path, relogs and logins, the walker, the click and dialogue code, and RUN-ORDER
section 6's run-wide allowances. Each cost is counted once, as per-occurrence ticks times the
occurrences on the route, so the step bands (rs/650-rs/653) do not count it again.

Labels: **m** measured end to end (cited), **i** inferred from measured rates or from code (the
arithmetic shown), **e** estimate. `file:line` references are at 1e536f76. No code, test or run
document was changed. SCORED is the scored account; no account name of an attempt and no host
address appears here.

## 1. Ranked table

Ranked by expected ticks saved over the whole route. "Lab needed" means the change touches a
lab-accepted module and, under main's rule, needs its own lab pass before attempt 4's staging.

| # | item | where (code + which steps) | per occurrence x occurrences | ticks saved (expected / bad case) | label, citation | build (h) | risk to lab-accepted modules | owner | lab needed |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **The run stack's 9 h bound counts from `up`, not from the attempt.** Gateway, page server and live view die 9 h after RUN-HOST step 3's `up`, whatever the run is doing. | RUN-HOST.md:53-71 (`T=9h` per process), `speedrun/tools/run-gate.ts` `up`. Hits any attempt that resumes late: tonight the stack started 16:33Z, died ~01:33Z mid-S07 (willow band, session tick 4,287), the watchdog's relaunch hit ECONNREFUSED on the page server and gateway, and SCORED stayed in the world (host, 01:37Z) | ~600+ ticks per event x P(an attempt outlives its `up`) | **~200 e / 600+ i** | bad case i: at least 4 min in the world (01:33Z to host's 01:37Z message) x 150 ticks/min = 600, and still running. Expected e: 1 attempt in 3 so far (attempt 3) ran past its bound, so ~1/3 x 600 = ~200. This is a sensitivity, not a priced row | 1-2 | none of the step chain: run-gate.ts and the runbook only | rs/186 (run-gate) with host | no: a dry-run of `up` and a run.ts start gate check |
| 2 | **The browser's settle tick before every leg's first click.** After a landing the browser rebuilds the region, so `runHop` waits for `sceneReady` before any click. | `lib/travel.ts:536-540` (`settle(sdk, 60)` before every hop), `lib/act.ts:102-112`, the SDK's `scene_loading` refusal (`sdk/index.ts:1085-1097`). Every leg T01-02 to T27-17 and S24's legs, ~29 | +1 m x ~29 legs | **~29 i / ~29 i** | per leg m: rs/308 phase 2 ("the browser costs +1 a leg for the settle", section 6 totals), and rs/589's drop bursts 2 on the browser against 1 on lite for T06-07 and T20-21. 1 x 29 = 29 (i) | 6-10 | **high**: the walk click would carry its own path, computed by speedrun's pathfinder, because the demo trusts the client's path (`clientRoutefinder` defaults true, `server/engine/src/util/WorldConfig.ts:107`, `MoveClickHandler.ts:42-50`). That needs an SDK and webclient change and a bundle rebuild, and every browser-accepted leg (rs/308, rs/589, rs/484) and quest that walks re-labs | rs/186 (walker) with main (sdk/, webclient) | yes, every leg |
| 3 | **A carrier may trade only on the step's live cue, and the cue opens after SCORED arrives.** | `runner/chain.ts:350-361` (`cueAround` opens the `{row, mule}` cue inside the hand-off step's `run`); `helpers/mule.ts:1376-1381` ("Preparation alone never authorizes a trade. Only the receiving step's live cue does"), `:361-371` (pre-request only when SCORED is exactly adjacent), `:1678-1681` (one pass a tick, then `nextTick`). The 19 delivery rows: mule1's H1, H4, H4k, H18, H19, H21d, H22; h55's H6, H4p, H7, H8, H9, H10, H12, H13, H14, H15, H16; h03's H20 (rs/41's carrier list, main 19:4xZ). The cannon rows H11 and H23 wait the same way for h92's request (`runner/handoff.ts:487`) | 1 i x 19, plus 0-1 x 2 | **~19-21 i / 21 i** | from code: SCORED writes the cue on arrival frame A, after the carrier's frame-A pass, so the carrier's click lands A+2 and the trade opens at A+2 instead of A+1. Measured against the 4-tick trade floor: H1 6 m (attempt 2, ticks 11-17; attempt 3, 10-16) and H4k 6 m (attempt 3) | 2-3 | **medium**: `chain.ts` covers every placed hand-off (rs/598's and rs/604's runner-driven labs); the carrier side in `mule.ts` is rs/41's (rs/551's carrier labs) | rs/186 (chain.ts) or rs/41 (mule.ts), one of the two | yes |
| 4 | **Hand-off waits before and after the trade.** Each unequip, drop and wield is sent and then waited out before the next action. | `runner/handoff.ts:496-502` (unequip), `:505-511` (drop), `:514-527` (wield, then unwield). Rows with them: H7 (wields), H11r (wield 3), H13 (unequip, drop, wield), H22 (unequip the staff, wield 3) | ~1-1.5 x 4 | **~4-6 i / 6 i** | H13 at 8.7 m with a 5 m swap inside it (rs/567) leaves 3.7 outside the trade. If the trade click goes out in the drop's tick and the wield confirm moves off the step's critical path: ~1 a row, ~2 on H13, so 1+1+2+1 = 5 (i) | 2-3 | medium: `handoff.ts` (H13, rs/567; H11r; H22) | rs/186 | yes (H13, H22) |
| 5 | **Every login waits for run mode to confirm before the first action.** | `lib/session.ts:819-820` and `:350-351` (`ensureRunOn`, then `setAutoRetaliate`, each awaited), `lib/run-mode.ts:78-80` (press, then wait up to 4 ticks). Run is not saved, so every login presses it; auto-retaliate is saved and costs 0 after the first. Logins: run login 1, the S21 relog, S25c's two relogs, ~1.5 restarts (RES§2) | ~1 x ~5 | **~5 i / 5 i** | 1 tick minimum per press-and-confirm (the varp shows on the next state); 5 logins (i). Send the press with the step's first action and confirm in the background | 1-2 | medium: `session.ts` is on every login and relog (R174's 2 m, the S25c wine windows WW§3) | rs/186 | yes (one relog lab, S25c's login + 19 deadline) |
| 6 | **The top-up ask is written on the trade's first open frame.** | `runner/handoff.ts:541-547`; the carrier polls for it every 15 ms for up to 3 ticks (`helpers/altar-cue.ts:556-565`). Rows H10, H12, H13, H14, H22 | 0-1 x 5 | **~0-5 e / 5** | the carrier's offer slips a tick only when the ask lands after its open-frame pass (e: unmeasured split). Write the scoped ask at the step's start instead | 1 | low-medium: handoff.ts, `mule.ts:878-892` (rs/429, rs/473) | rs/186 with rs/41 | yes, one top-up row |
| 7 | **A late carrier throws the step instead of waiting.** `handOffPre` checks "partner in view" before the cue's bounded ready wait runs. | `runner/handoff.ts:284` and `:586` (precondition), `runner/cue-keeper.ts:167` (`awaitReady`, up to `READY_MAX_TICKS` 600, `delivery-owner.ts:37`) | ~11.7 m + re-entry per event x P(late) | **~0-10 e / ~12 + re-entry (+ the relaunch) per event** | throw cost m: rs/595 (~11.7, SCORED logged out on the throw). Expected e: every carrier route rs/41 has measured fits its window (H16 172 against ~351; H19 110; H20 214 against S00-S23); H4k is exposed only after a mid-run relaunch; H13-H15, H18, H21d and H22 are unmeasured (MAN entry 33) | 1-2 | low: handoff.ts preconditions (the reorder rs/598 proposed, main pre-approved) | rs/186 | yes (rs/598's lab, run 1's late carrier) |
| 8 | **Long waits send no input.** A wait of over ~3 min puts SCORED in the class tonight's idle sweep removed, and in reach of the browser's own idle logout. | `runner/handoff.ts:484` (the cannon wait, up to 6,000 ticks = 40 min at 400 ms; H11, H23), `cue-keeper.ts:167` (the mule ready wait, up to 600 ticks = 4 min) | 0 normally; one removal per event | **~0 e / ~10-25 i + 1 of 3 unplanned relogs per event** | rs/83's WAVE 1 (00:46-00:47Z): 80 players removed one per tick, every one standing still 4-6 min, none of the helpers that send keep-alives. Bad case i: drop-relog (~2, R174) + scene wait + the step's re-entry (rs/595's 9.6-9.9 for the checks) | 1-2 | low: a `sendWait(1)` every ~60 s inside the two waits, as `mule.ts:1766-1771` does for carriers | rs/186 | yes, short |
| 9 | **The idle re-send waits 6 ticks.** A non-jump click that draws nothing is re-sent after 6 still ticks (a post-jump one after 3). | `lib/act.ts:389` (`resendEvery` 6), `:445`; `REPLY_TICKS` 3 at `:89`. Every loc click, door and NPC talk in the quests (~320-390 interactions, RUN-ORDER section 6) and every leg's doors | ~2 x N dropped clicks (if 6 went to 4) | **unknown e / unknown** | N is not measured: `ActResult.resends` is returned (`act.ts:456`) but no run line totals it. The 800's interaction share is +0.5-1 a click on rs/257 (bgsrv-mac) and +0.13 a talk on the twin (rs/287); this item is the part of that our code could shorten | 1 to change, ~1 to count | **high**: act.ts is in every quest module; a re-send that restarts a script is how Dwarf Cannon's railing regressed (rs/257) | rs/186, rs/185 | yes, broad |
| 10 | **A socket drop waits ~23 s before the tab relaunches.** | `runner/drop-relog.ts` (SETTLE_TICKS 40, ~16 s of waiting for ticks to resume after LOST_AFTER_TICKS 17, ~6.8 s), watchdog `staleTicks` 27 (rs/186's code read, main 00:4xZ) | up to ~40 i a wave | **unknown e / ~40 i per wave** | 16 s / 0.4 s = 40 ticks of the wait (i), only if a fresh connection is served during the wave, which is unsettled (drop versus pause, rs/83). Two waves today, both at the start of slow-tick episodes | 2-3 | medium: drop-relog.ts and resume (rs/547, rs/580); a premature relaunch costs ~10-20 | rs/186 | yes (rs/645-style socket kill) |

Sum of the expected column where it is a number: ~200 e (item 1) + ~29 i + ~20 i + ~5 i + ~5 i + 0-5 e + 0-10 e + 0 = **~260-275, of which ~60 is i and the rest is item 1's e**. Items 2-6 are real route ticks (~60 i). Items 1, 7, 8 and 10 are risk lines: they change no row and remove a cliff.

### Hand-off fixed cost, decomposed

The trade itself has a 4-tick floor from SCORED's first click to the items in the pack (m: S07's
bone loads, 4 a load all night on the run machine, host 01:32Z; the old account's give-only swap
to mule1, "4 ticks (open 1)", host 20:04Z). It breaks down as: the click lands and the trade opens;
the partner's offer and accept land; SCORED's accept lands and the confirm screen opens; both
confirms land and the items swap. `trade.rs2` has no delay of its own; each step is one
round trip (lib/trade.ts header). A swap pays no more than a receive (both accepts reset when
SCORED's offer lands, and the partner re-accepts on the next frame).

The measured 4-9 against rows priced 4-8 is that floor plus:
- **+1 on every delivery row** while the carrier's cue opens on arrival (item 3).
- **+1-2 on rows with an unequip, a drop or a wield** (item 4).
- **0-1 on top-up rows** (item 6).
- **The carrier's own frame timing.** This is what is left of the 4-9 spread (rs/41's figures: mule
  hand-offs 4-9, h92 3-5). It is helper-side, unmeasured per row.

**Can a trade open on SCORED's arrival tick?** Yes, but only for a partner whose request already
stands when SCORED steps adjacent. SCORED's click from the arrival frame then opens it on the next
tick. A delivery carrier never pre-requests from range: it only clicks when SCORED is exactly
adjacent (`mule.ts:361-371`), because a click from range walks the clicker. So its earliest open is
the tick after SCORED's arrival, and item 3 is what gets it there. SCORED clicking the trade from
range as its last walk click saves nothing here. The carrier still clicks only once it sees SCORED
adjacent, so the open lands on the same tick.

**rs/41's question (prepares written too late, and writing every prepare one step earlier).** A
prepare is already written as early as a single-stand carrier can use it:
- Each carrier's first row is prepared at run start (`run.ts:659-664`).
- Each later row is prepared at its previous row's stop (`delivery-owner.ts:131`). The carrier
  banks and walks after that serve, so no earlier point exists without carried mode.

So writing prepares one step earlier removes **~0 ticks**, given every route rs/41 has measured:
- H1 97, H6 77, H4p 100, H7 145, H8 280, H9 235, H10 61, H12 208, H16 172, H19 110 and H20 214
  all fit their windows (MAN entry 33).
- H4k is exposed only after a relaunch between H4 and H4k.
- H4, H13-H15, H18, H21d and H22 are unmeasured.

What costs ticks is the cue, not the prepare: the carrier is staged and standing, but may not
request until the step's live cue appears (item 3). What would cost a throw is the precondition
order (item 7). Count of hand-offs that can cost SCORED a wait because a prepare is late, under
today's code: 0 measured, 1 conditional (H4k after a relaunch), 7 unmeasured. Each of those throws
(~11.7 m + re-entry) rather than waits.

### Cue latency

The helpers' cue watcher is `fs.watch` plus a 20 ms poll (`altar-cue.ts:767-774`), so the reaction
to a written cue is ~0 ticks (i; rs/41 at 1e536f76). The costs sit around the cue, not in it:
- **The ready wait.** `CueKeeper.open` runs it before the write (`cue-keeper.ts:167`, 0 when
  the carrier is ready).
- **The beacons wait.** `CueKeeper.open` waits for 4 frames before the write
  (`cue-keeper.ts:168`), 0 after the run's first seconds.
- **The 25-tick rewrite.** A carrier refuses a cue older than 60 s, so delivery cues are rewritten
  every 25 ticks (`cue-keeper.ts:51`, `mule.ts:1030`). This is a file write, 0 ticks.
- **S07's first bone load.** It waits 1-2 ticks for the givers to republish in the session
  (+1.5 i, fold-in 34). The givers' site rotation is rs/635's and band A's, not counted here.

### Step boundaries and per-step overhead

**0 m.** `runner/step.ts:244-296` reads the published state and waits a tick only when a check
fails, when the tick's user-event budget is full, or when the state is stale. Every `(boundary)` row
in `docs/speedrun/rehearsals/fishing-evidence.json` is 0 ticks with no waits. The live lines are
contiguous: attempt 3 ran S00 2-10, H1 10-16, T01-02 16-74, S02 74-93, T02-03 93-144 (host). RUN-ORDER
section 6 already carries boundary idle at 0 m (#92). Entry work inside a step costs 0 when nothing
jumped: `settle` returns at once on a settled state, and the kit and precondition checks are
state reads. That puts the per-step fixed overhead at ~0 x ~60 steps and legs. The real fixed costs
are the leg settle (item 2) and the hand-off items (items 3, 4 and 6).

### Relogs and logins

- **The planned relogs (S21, S25c twice).** ~2 m each in page (R174), plus the demo's delayed-logout
  tail of ~46/29 = ~1.6 i each. They are required: R12's helper order and the wine's fermentation
  windows.
- **The run toggle.** Every login adds ~1 tick for it (item 5).
- **A re-run's login and post-login checks.** ~11.7 m (rs/595): relaunch to in-world ~2, then the
  checks ~9.6-9.9, mostly the browser scene wait after a navigated tab (`session.ts:354`).
  Client-side, so not removable short of item 2's self-routed path.
- **A cold scene rebuild at Varrock west.** 73-75 m (rs/41). It is paid only on a relaunch.

### Demo raggedness against engineering cost

Tonight's rehearsal ran on a slow demo (124-145 ticks a minute against 150; rs/83's SLOWEVT 4 from
01:07:48Z). The cross-cutting costs held through it:
- S07's bone loads stayed at 4-7 ticks with 0 re-picks, the last ones all at 4 (host 01:19Z,
  01:32Z).
- Boundaries stayed at 0.

The ~+1,100 on S07's willow band (WC 73-99 in ~3,410 against the row's 2,386, host via rs/158) is
the reactive knife loop on a ragged server, under rs/642's forced knife. It belongs to band A
(rs/650) and to rs/186's slow-server fallback, which is attempt-4 work. Nothing in this table
moves with raggedness: each item is a fixed tick count per event.

## 2. Top items, for a builder to start from

**Item 1: tie the run stack's life to the attempt, not to `up`.** RUN-HOST.md:53-71 starts the page
server, gateway and live view under `T=9h` at step 3, and nothing re-arms them when an attempt
resumes hours later. Tonight they died at ~01:33Z, with the watchdog's relaunch refused on both
ports and SCORED in the world. Two changes, either sufficient:
- run.ts's start gate reads each stack process's remaining bound (run-gate already owns the units)
  and refuses a start or a `--from` resume with less than the remaining route plus an hour
  (RUN-HOST's own margin).
- RUN-HOST's "Re-running after a StepError" recipe re-runs `up` with a fresh `T` before the
  re-run.

Acceptance:
- A run.ts dry-run against a stack started with `T=10m` refuses with the bound named.
- One started with `T=9h` passes.
- RUN-HOST's resume recipe names the re-`up`.

No step module changes, so no lab pass is owed beyond the dry-run.

**Item 3: let the carrier request on SCORED's arrival frame.** Today `cueAround`
(`runner/chain.ts:350-361`) opens the `{row, mule}` cue in the hand-off step's `run`. That is after
the leg has observed arrival, so the carrier's pass for that frame has already run without
authorization (`mule.ts:1376-1381`, `:1678-1681`). Two forms:
- **(a) Open the row's mule cue at the start of the leg that ends at the hand-off tile** (chain.ts,
  rs/186). The mule keeper is separate from the main keeper (`cue-keeper.ts:244-251`), so a
  leg-time mule cue closes no bone or courier cue. The 25-tick refresh keeps it fresh on long legs.
  The carrier still pre-requests only when SCORED is adjacent, so authorizing early moves nobody.
- **(b) Pre-request from the cue watcher's callback** using the carrier's latest state, instead
  of on its next frame (mule.ts, rs/41).

(b) is smaller and stays in one file. (a) also covers the h92 rows, if `runHandOffOnCue`'s cue
moves the same way.

Acceptance (runner-driven lab, browser, 400 ms, 3 of 3, H1 and H4k):
- The trade opens on the tick after arrival (the carrier's `pre-requested` log line on the arrival
  frame).
- The step row is ≤5 against today's 6.
- No trade opens before SCORED is adjacent.
- A cue stopped on a thrown step still stands the carrier down.

**Item 2: route the first click after a landing without the browser's map.** `runHop` waits
`settle()` before every hop (`lib/travel.ts:536-540`) because the browser's collision maps are stale
while it rebuilds the region. The demo takes the client's path as given (`clientRoutefinder` true by
default, `WorldConfig.ts:107`; `MoveClickHandler.ts:42-50`), so a misrouted click walks wrong. The
recovery is a send that carries an explicit path, computed by speedrun's own pathfinder (the one
`mule.ts:367-370` uses, on the server's map data). It needs an SDK action and a webclient
handler, and so a bundle rebuild on both run machines. Until then, nothing in speedrun alone removes
this tick.

Acceptance:
- rs/589's eight drop legs and rs/308's phase-2 legs on the browser, 3 runs each.
- Each leg's settle tick is gone (T06-07's and T20-21's drop bursts at 1, like lite).
- No leg's walked tiles grow.

This is the most invasive item. Its ~29 i likely does not pay for a re-lab of every leg before
attempt 4. It is listed for attempt 5's planning.

**Item 4: overlap the hand-off's pre- and post-trade actions.** `runHandOff`
(`runner/handoff.ts:530-570`) awaits the unequips, then the drops, then the trade, then
`applyEquip`'s wield confirm (`:514-527`), each a tick. Two changes:
- **Before the trade:** send the trade click in the same frame as the last drop or unequip. The
  offers come a tick later, after the open (`lib/trade.ts:909-916`). Plan the offer from the frame
  the trade opens, not from `s0`.
- **After the trade:** send the wields and return. Let the step's postcondition (`handOffMissing`)
  see them worn, so the next leg's first click goes in the wield's tick. The boundary rule
  (`runner/step.ts:211-218`) re-checks once after one tick, so that alone does not save the tick.
  The postcondition needs a variant that is satisfied by a wield in flight.

Acceptance:
- H13 on the browser at 7 or less against 8.7 m (rs/567's lab, 3 of 3).
- H22 one tick under today's.
- handoff.test.ts's ledger cases unchanged.

**Item 8: keep SCORED's long waits alive.** The cannon wait (`runner/handoff.ts:484`, up to 6,000
ticks) and the mule ready wait (`cue-keeper.ts:167`, 600) send nothing. Inside both waits, send
`sendWait(1)` once a minute: it changes no world state and resets the browser's idle timer
(`mule.ts:1766-1771`). Acceptance:
- A unit test with a fake clock shows one wait per ~150 ticks and none once the partner is in
  sight.
- One lab hand-off with h92 held back 4 minutes shows SCORED still in the world, with no relog
  charged.

## 3. The run-wide allowances (RUN-ORDER section 6): engineering or server

The run-wide ~1,236 (the 800 + contention 300 + retries 100 + level-ups 25 + relog tail 3 +
restarts 8, section 6's totals and section 7's lines 56-57) splits as follows.

- **Overrun bursts, 600 e.** Server behaviour, spread over the reactive loops (Woodcutting 140,
  Mining 129, Fishing 82, Thieving 83, Agility 166). The only engineering lever is each loop's own
  slow-server mode (S07's plain-and-bury fallback, rs/186, band A). Nothing shared removes it.
- **The overlay relay, 200 e: already engineered away, unpriced as such.** The gateway is loopback
  on the run machine (section 1) and #90 executes overlay actions on arrival. Attempt 3's opening
  non-reactive rows, measured on the run machine in calm minutes, came in at **596 against 595.2
  priced, +0.8 over 10 rows** (m, demo, n = 1; host's lines against section 2 and 6's prices):

  | Row | Measured | Priced |
  |---|---|---|
  | H1 | 6 | 8 |
  | S02 | 19 | 20.3 |
  | T02-03 | 51 | 52 |
  | S04 | 199 | 198 |
  | T04-05 | 46 | 51.7 |
  | T05-06 | 68 | 64.5 |
  | S06 | 67 | 60 |
  | T06-07 | 76 | 82.7 |
  | H4k | 6 | 5 |
  | T01-02 | 58 | 53 |

  The interaction part of the 800 does not show on those rows either. That part is ~320-390 i
  sized from bgsrv-mac (rs/257), against the twin's +0.13 a talk (rs/287). Re-pricing the 200 and
  the interaction part from the rehearsal's quest rows is rs/158's evidence task, not a build. It
  moves the margin, not the run.
- **The 800's other named parts.** Teleport casts (~20 i, 5 ticks against 4 on 3 of 5 demo casts)
  are server behaviour. S07's bone loads (0-105 i) now measure at 4 on the run machine all night.
  Herblore's cadence (0-30 i) is still n = 1.
- **Contention, 300 e.** Server behaviour (other players at S07's trees and S09's rocks). rs/261
  saw no respawn waits at ~1,750 online, and rs/259 ran uncontested. The levers are site choices
  (bands A and B).
- **Retries, 100 e.** Mixed:
  - A dropped client is server behaviour.
  - The re-sends are ours: items 9 and 10, and RESEND_TICKS 27 for a standing trade request
    (`lib/trade.ts:504`), which only fires on a partner relog.
- **Level-ups, 25 i.** Content. Pages are already answered on the label that shows them (LU§5).
- **Relog tail, 3 i.** The demo's delayed logout, 1 in 29 (WINE).
- **Restarts, 8 i.** Demo restarts are server behaviour. The ~2 m relog and ~3 m resume are
  already engineered (R174, RES§6).

On tonight's evidence, about 200 of the ~1,236 is engineering already done but not yet re-priced
(the relay). Another ~320-390 inside the 800 looks like host latency that the Ashburn machines
removed. The rest is server behaviour, apart from the small items in this table.

## 4. Not avoidable

- **The trade's 4-tick floor**, first click to items (m: bone loads 4, the 20:04Z swap 4 with
  open 1).
- **Step boundaries**, already 0 m.
- **Cue reaction**, ~0.
- **The planned relogs**: S21 (R12's helper order) and S25c's two (fermentation), at ~2 m each, and
  the demo's delayed-logout tail.
- **The relaunch's scene wait** after a navigated tab (~9.6-9.9 m of rs/595's post-login checks).
  Client-side, unless item 2 extends to it.
- **One tick per closed door.** The walk-through click must follow the loc change the client sees.
- **Teleport cast animations** (4 ticks in the lab, 5 on 3 of 5 demo casts).
- **Level-up pages** the content opens.
- **Overrun bursts, ragged ticks and contention**: the server and other players.
- **The S07 cue session's first-load republish**, 1-2 ticks once (fold-in 34).
