# Tick audit, band X: the costs every band pays

Read-only audit for rs/654 (under rs/158), 2026-10-23 PDT. It covers the shared runner, the
hand-off and cue path, relogs and logins, the walker, the click, dialogue and prayer code, and
RUN-ORDER section 6's run-wide allowances. Each cost is counted once, as per-occurrence ticks times
the occurrences on the route. The step bands (rs/650-rs/653) should cite these rows, not re-count
them; where a row here subsumes a band row, that row is named.

- **Sources.** The code on main at the rehearsal's run commit 1e536f76, the measured lines on the
  main and host threads, and rs/185's Grand Tree / Tree Gnome Village / Fight Arena audit
  (cairn://p/rs/185/1/coordinator/task/tick-audit-gt/return).
- **Labels.** **m** measured end to end (cited), **i** inferred from measured rates or read from
  code (arithmetic shown), **e** estimate. `file:line` is at 1e536f76 unless another commit is
  named.
- **Scope.** No code, test or run document was changed. SCORED is the scored account; no attempt's
  account name and no host address appears here.

**Columns.** "Saved" is **expected / low** for a change that removes route ticks. Low is rs/185's
convention: what it saves if it under-delivers, and negative where it can cost ticks. For a risk
line it is **expected / event**: the ticks one occurrence costs today. "Lab-accepted" names the
accepted modules the change touches. Under main's rule each such change needs its own lab pass
before attempt 4's staging.

## 1. Ranked table

| # | item | where (code + which steps) | per occurrence x occurrences | saved (expected / low or event) | label, citation | build (h) | touches lab-accepted? | owner | lab |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Every conversation ends with 2-3 idle ticks after its last page closes**, even when its shape is consumed and `until` holds. Proposed lever: finish on the close tick once the passed shape is fully consumed. Subsumes rs/185's GT row 2 (20), TGV row 1 (15), FA rows 1 and 2 (7 + 10) and its S15 figure | `lib/converse.ts:219` (`idle` default 3) and `:462-467` (finish only when `s.tick - closedSince >= idle`); rs/185 cites `converse.ts:488-493` on main. Modules pass idle 2 (grand-tree.ts:344, :379; tree-gnome-village.ts:353, :372) or the default 3 (fight-arena.ts:278). Every scripted talk and loc dialogue S05-S26 | ~1.2 a conversation (rs/185: GT 20 over ~17 talks) x the quest block's conversations | **~210 / ~30** | i for GT 20 + TGV 15 + FA 17 + S15 40-60 = 92-112 (rs/185, shape arithmetic checked against measured segments: FA A 8 for `2c, opt, 8c`, TGV E 4 for `4c`). e for the rest: section 6 counts 318-389 interactions in S08-S26. GT, TGV, FA and MM hold 149-181 of them at 0.62 saved a click (92-112 / 149-181). The other quests hold 169-208, less ~25 of Dwarf Cannon's railings, so 144-183 x 0.62 = ~90-113. Total ~180-225, ~210 central. Low: rs/185's lows (GT 6, TGV 5, FA 6) plus an assumed ~10 elsewhere | 4 | **yes, all quest modules on both clients**: S05, S08, S10b (rs/391, rs/457), S11b (rs/405), S12 (rs/401, rs/484), S13, S15, S16, S19, S20, S23, S24, S26. Risk: ending while a script still owes a page | rs/185 (converse.ts) with rs/186 | yes, broad |
| 2 | **The run stack's 9 h bound counts from `up`, not from the attempt.** Gateway, page server and live view die 9 h after RUN-HOST step 3's `up`, whatever the run is doing | RUN-HOST.md:53-71 (`T=9h` per process), `speedrun/tools/run-gate.ts` `up`. Tonight the stack started 16:33Z and died ~01:33Z in S07's willow band (session tick 4,287). The watchdog's relaunch hit ECONNREFUSED on the page server and gateway, and SCORED stayed in the world (host 01:37Z) | ~600+ ticks per event x P(an attempt outlives its `up`) | **~200 e / 600+ i** (risk line) | event i: at least 4 min in the world (01:33Z to host's 01:37Z message) x 150 ticks/min = 600, and still running. Expected e: 1 attempt in 3 ran past its bound, so ~1/3 x 600 | 1-2 | no: run-gate.ts and the runbook only | rs/186 with host | no: dry-runs (item paragraph) |
| 3 | **The browser waits a settle tick before each leg's first click**, because its collision map is stale while the region rebuilds and the demo trusts the client's path | `lib/travel.ts:536-540` (`settle(sdk, 60)` before every hop), `lib/act.ts:102-112`, `sdk/index.ts:1085-1097` (`scene_loading`); the server takes the client's waypoints (`clientRoutefinder` true by default, `server/engine/src/util/WorldConfig.ts:107`; `MoveClickHandler.ts:42-50`). ~29 legs (T01-02 to T27-17 and S24's) | +1 m x ~29 | **~29 / 0** | per leg m: rs/308 phase 2 ("the browser costs +1 a leg for the settle"); rs/589: T06-07's and T20-21's drop bursts are 2 on the browser against 1 on lite. 1 x 29 = 29 (i) | 6-10 | **yes**: needs an SDK action and a webclient handler that send a path computed by speedrun's pathfinder (the one `mule.ts:367-370` uses), and a bundle rebuild. Every browser-accepted leg (rs/308, rs/589, rs/484) and every walking quest re-labs | rs/186 with main (sdk/, webclient) | yes, every leg |
| 4 | **Transport hops run their dialogue in fixed mode.** Spirit trees, the lever, the ship, the glider and Lumdo pass no burst shape. Subsumes rs/185's GT row 4 (10) and TGV row 2 (3) | `lib/travel.ts:1124` (`hopTree`, `actConverse` with no shape, so `converse.ts:84` never bursts), `:1137` (lever), `:1155` (ship), `:1180` (glider), `:1192` (Lumdo). Tree hops on the route: T10-11 (1, `legs.ts:431`), T14-15 (2, `legs.ts:458-459`), S11b's C and J (4), Monkey Madness's TREE_ROUTE (2, `monkey-madness.ts:1719`) | 2 a young-tree hop, 3 a big-tree hop x 9 tree hops; ~1-2 x ~6 other hops | **~30 / ~10** | trees r/i (shapes in grand_tree.md:157, spirit_tree.rs2:1-23, :49-62; rs/185): T10-11 3 + T14-15 5 + GT 10 + MM 5 = 23. Other hops e: the lever's first pull (T13-14; later pulls skip it), the Brimhaven ship (T20-21), the gliders and Lumdo in S11b/S15, ~1-2 each = ~6-9. Low: rs/185's GT 4 + TGV 1, plus ~5 | 2-3 | **yes**: travel.ts in T10-11, T14-15 (shared legs), S11b, S15, T20-21 | rs/186 (travel.ts) with rs/185 | yes: the five hops' legs 3x |
| 5 | **Two things in one tick: a leg's last click is the next step's first op.** Today the leg runs to the arrival tile, observes it, and the step's first talk or loc click goes a tick later. An op sent from range walks and fires on the tick SCORED comes into range | legs.ts / chain.ts (every leg ends on `inArea(arrive)`), each quest's segment A (lab-accepted from the arrival tile, O6). Joins: ~16 quest entries (S05, S08, S10b, S11a, S11b, S12, S13, S15, S16, S19, S20, S23, S24 x3, S26), ~3 hand-offs with a standing partner request (H11, H23, H12o), ~7 loc-first skill entries (S06, S07, S09, S17, S18, S21, S22) | ~1 i x ~16-26 | **~21 / 0** | per join i: the engine answers an op once the player is in range, "a click from range is silent for its whole approach walk" (`lib/trade.ts:490-493`), so it fires on the arrival tick instead of the one after. 16-26 joins x 1. Low 0: an NPC that wanders out of the approach tile | 4-6 | **yes**: every joined entry segment (all quest modules' A), and the in-page programs anchored on tiles (S07, S09, S18, S22 knife and stun loops) | rs/186 (legs, chain) with rs/185 | yes, each join |
| 6 | **A carrier may trade only on the step's live cue, and the cue opens after SCORED arrives**, so the carrier's request lands a tick late | `runner/chain.ts:350-361` (`cueAround` opens the `{row, mule}` cue in the hand-off's `run`). The carrier side is `helpers/mule.ts`: `:1376-1381` ("Preparation alone never authorizes a trade. Only the receiving step's live cue does"), `:361-371` (pre-request only when SCORED is exactly adjacent) and `:1678-1681` (one pass a tick). 19 delivery rows: mule1's H1, H4, H4k, H18, H19, H21d, H22; h55's H6, H4p, H7, H8, H9, H10, H12, H13, H14, H15, H16; h03's H20 (rs/41's carrier list, main 19:4xZ). The cannon rows H11 and H23 wait for h92's request the same way (`runner/handoff.ts:487`) | 1 i x 19, plus 0-1 x 2 | **~20 / 0** | from code: SCORED writes the cue on arrival frame A, after the carrier's frame-A pass, so the carrier's click lands at A+2 and the trade opens a tick late. Measured against the 4-tick trade floor: H1 6 m (attempt 2, ticks 11-17; attempt 3, 10-16), H4k 6 m (attempt 3). Low 0: the carrier already acts in-frame | 2-3 | **yes**: chain.ts covers every placed hand-off (rs/598's and rs/604's runner-driven labs); mule.ts is rs/41's (rs/551's carrier labs) | rs/186 (chain.ts) or rs/41 (mule.ts) | yes: H1 and H4k, 3x |
| 7 | **A prayer toggle and the next click go in separate ticks.** Subsumes rs/185's GT row 7 (3), TGV row 3 (5) and FA row 7 (2) | `lib/combat.ts` `setPrayer` (waits for the prayer state before the module's next click; grand-tree.ts:569, :627, :813; tree-gnome-village.ts:434, :453, :497, :574-577, :684; fight-arena.ts:509, :537). Other users: S15, S16, S26 | 1 x ~10 measured toggles + S15/S16/S26 | **~15 / -9** | i: rs/185's 3 + 5 + 2 = 10, plus ~5 e for the other quests' toggles (uncounted). Low: rs/185's -3 a quest if the order flips, which clears the click (rs/241) | 2 | **yes**: combat.ts in S10b, S11b, S12, S15, S16, S26 | rs/185 | yes: packet-order proof on both clients |
| 8 | **A prayer toggle dropped under a scene is re-sent only after 3 ticks.** Subsumes rs/185's GT row 6 (3) and FA row 4 (3) | `lib/combat.ts:85-99` (rs/185); the Grand Tree's shipyard gate and Fight Arena's arena door | 3 x 2 | **~6 / 2** | m/r (rs/185; STEP-MANIFEST.md:1537-1541): 4 ticks against 1, twice | 1 | yes: S11b I, S12 J | rs/185 | yes |
| 9 | **Hand-off waits before and after the trade.** Each unequip, drop and wield is sent and waited out before the next action | `runner/handoff.ts:496-502` (unequip), `:505-511` (drop), `:514-527` (wield, then unwield). Rows: H7 (wields), H11r (wield 3), H13 (unequip, drop, wield), H22 (unequip the staff, wield 3) | ~1 x 4, ~2 on H13 | **~5 / 2** | H13 is 8.7 m with a 5 m swap inside it (rs/567), so 3.7 sits outside the trade. Overlapped as in the item paragraph: 1 + 1 + 2 + 1 = 5 (i) | 2-3 | yes: handoff.ts (H13 rs/567, H11r, H22) | rs/186 | yes: H13, H22 |
| 10 | **Every login waits for run mode to confirm before the first action** | `lib/session.ts:819-820` and `:350-351` (`ensureRunOn`, then `setAutoRetaliate`, each awaited); `lib/run-mode.ts:78-80` (press, then wait up to 4 ticks). Run is not saved, so every login presses it; auto-retaliate is saved and costs 0 after the first. Logins: run login 1, the S21 relog, S25c's two, ~1.5 restarts (RES§2) | ~1 x ~5 | **~5 / 0** | i: a press confirms on the next state at the soonest. Send it with the step's first action and confirm in the background | 1-2 | yes: session.ts, on every login (R174's 2 m; the S25c wine windows, WW§3) | rs/186 | yes: one relog lab with S25c's login + 19 |
| 11 | **The top-up ask is written on the trade's first open frame** | `runner/handoff.ts:541-547`; the carrier polls every 15 ms for up to 3 ticks (`helpers/altar-cue.ts:556-565`). Rows H10, H12, H13, H14, H22 | 0-1 x 5 | **~2.5 / 0** | e: the carrier's offer slips a tick only when the ask lands after its open-frame pass (unmeasured). Write the scoped ask at the step's start instead | 1 | yes: handoff.ts, `mule.ts:878-892` (rs/429, rs/473) | rs/186 with rs/41 | yes: one top-up row |
| 12 | **A late carrier throws the step instead of waiting.** `handOffPre` checks "partner in view" before the cue's bounded ready wait | `runner/handoff.ts:284`, `:586` (precondition); `runner/cue-keeper.ts:167` (`awaitReady`, `READY_MAX_TICKS` 600, `delivery-owner.ts:37`) | ~11.7 m + re-entry per event x P(late) | **~0-10 e / ~12 + re-entry** (risk line) | event m: rs/595 (~11.7, SCORED logged out on the throw). Expected e: rs/41's measured routes all fit their windows (section 1's note); H4k is exposed only after a mid-run relaunch; 7 rows are unmeasured | 1-2 | yes: handoff.ts preconditions (rs/598's reorder, main pre-approved) | rs/186 | yes: rs/598's lab, run 1 |
| 13 | **The idle re-send waits 6 still ticks** (3 after a jump), and is not timed to a scene's end. Subsumes rs/185's TGV row 5 (2) | `lib/act.ts:389` (`resendEvery` 6), `:445`; `REPLY_TICKS` 3 (`:89`). Every loc click, door and talk on the route | ~2 x N dropped clicks, if 6 went to 4 | **~2 + unknown / 0** | TGV H's door: 15 ticks with 2 re-sends, ~2 savable by timing the re-send to the wall scene's end (rs/411's trace via rs/185). N elsewhere is unmeasured: `ActResult.resends` is returned (`act.ts:456`) but no run line totals it | 1, plus ~1 to count | **yes, high**: act.ts runs in every module; re-sending a click that landed restarts its script (Dwarf Cannon's railing, rs/257) | rs/186, rs/185 | yes, broad |
| 14 | **Long waits send no input**, which puts SCORED in reach of tonight's idle sweep and of the browser's own idle logout | `runner/handoff.ts:484` (cannon wait up to 6,000 ticks = 40 min; H11, H23); `cue-keeper.ts:167` (mule ready wait up to 600 = 4 min) | 0 normally; one removal per event | **~0 / ~10-25 + 1 of 3 unplanned relogs** (risk line) | event i: rs/83's WAVE 1 (00:46-00:47Z) removed 80 players, one per tick, every one standing still 4-6 min, and none of the helpers sending keep-alives. A removal costs drop-relog (~2 m, R174) plus the scene and the step's re-entry | 1-2 | yes, lightly: handoff.ts, delivery-owner.ts (H11/H23 cannon receiver rs/393; mule rows) | rs/186 | yes, short |
| 15 | **A socket drop waits ~23 s before the tab relaunches** | `runner/drop-relog.ts` (SETTLE_TICKS 40, ~16 s after LOST_AFTER_TICKS 17, ~6.8 s); the watchdog's `staleTicks` 27 (rs/186's code read, main 00:4xZ) | up to ~40 i a wave | **unknown / ~40** (risk line) | i: 16 s / 0.4 s = 40, and only if a fresh connection is served mid-wave, which is unsettled (drop against pause, rs/83). Two waves today, both at the start of slow-tick episodes | 2-3 | yes: drop-relog.ts, resume (rs/547, rs/580). A premature relaunch costs ~10-20 | rs/186 | yes: an rs/645-style socket kill |

**What the route rows gain.** Items 1, 3-11 and 13 are real route ticks:

| Item | Expected (ticks) |
|---|---|
| 1 | 210 |
| 3 | 29 |
| 4 | 30 |
| 5 | 21 |
| 6 | 20 |
| 7 | 15 |
| 8 | 6 |
| 9 | 5 |
| 10 | 5 |
| 11 | 2.5 |
| 13 | 2 |
| **Total** | **345.5** |

That is **~345 expected**. About 120 of it is i on measured or read mechanisms (items 1's measured
quests, 3, 4's trees, 6, 8 and 9). The rest is e scaling. Items 2, 12, 14 and 15 are risk lines:
they move no row and remove a cliff.

**Cut to what fits before attempt 4's lab window:** items 2 (no lab), 6, 4, 8 and 9 touch a
handful of modules each, for ~60 i plus item 2's risk. Items 1, 3, 5 and 7 are the large ones and
the broad re-labs.

### Checked, nothing to remove against best

| Checked | What was read | Why it costs nothing against best |
|---|---|---|
| Step boundaries | `runner/step.ts:244-296`: a wait only on a failed check, a full user-event budget, or a stale state | 0 m. Every `(boundary)` row in `docs/speedrun/rehearsals/fishing-evidence.json` is 0 ticks with no waits. Attempt 3's lines are contiguous (S00 2-10, H1 10-16, T01-02 16-74, S02 74-93, T02-03 93-144, host). Section 6 carries 0 / 0 (#92). Per-step fixed overhead is ~0 x ~60 steps and legs |
| Step entry work | `settle` returns at once on a settled state (`act.ts:107-112`); kit and precondition checks are state reads | 0 except after a jump, which is item 3 |
| Cue reaction | `helpers/altar-cue.ts:767-774`: `fs.watch` plus a 20 ms poll | ~0 ticks (rs/41 at 1e536f76). The 4-beacon wait before the first cue write (`cue-keeper.ts:168`) is 0 after the run's first seconds. The 25-tick delivery-cue rewrite (`:51`) is a file write |
| Prepare timing (rs/41's question) | `run.ts:659-664` (first rows at run start), `delivery-owner.ts:131` (each later row at its predecessor's stop) | Already the earliest a single-stand banked carrier can use, so "one step earlier" removes ~0 (section 1's note). What costs ticks is the cue authorization (item 6) and the throw on a late carrier (item 12) |
| The trade itself | `lib/trade.ts` header (trade.rs2 has no delay), `:881-933` | A 4-tick floor from first click to items, m: S07's bone loads at 4 a load all night on the run machine (host 01:32Z); the old account's give-only swap to mule1, "4 ticks (open 1)" (host 20:04Z). A swap pays no more than a receive |
| Pre-arrival trade click ("open on arrival") | `mule.ts:361-371` | A delivery carrier only clicks once SCORED is adjacent, so SCORED clicking from range opens nothing earlier. The gain comes from item 6, or from item 5 for partners whose request already stands |
| S07 bone loads under a ragged demo | host 01:19Z and 01:32Z | 4-7 ticks, 0 re-picks, the last ones all 4, at 124-145 ticks a minute: the hand-off floor held. S07's +1,100 on the willow band is the reactive knife loop (band A, rs/650; rs/186's slow-server fallback) |

### Hand-off fixed cost, decomposed

The measured 4-9 against rows priced 4-8 is the 4-tick floor plus:
- **+1 on each of the 19 delivery rows** (item 6).
- **+1-2 on the four rows with an unequip, drop or wield** (item 9).
- **0-1 on the five top-up rows** (item 11).
- **The carrier's own frame timing.** This is helper-side and unmeasured per row (rs/41: mule
  hand-offs 4-9, h92 3-5).

**rs/41's question in numbers.** rs/41's measured carrier routes are H1 97, H6 77, H4p 100, H7 145,
H8 280, H9 235, H10 61, H12 208, H16 172, H19 110 and H20 214. Under today's code, the hand-offs
that can cost SCORED a wait (in fact a throw, item 12) because a prepare is late are:
- **0 measured.** Every route rs/41 has measured sits inside its window (MAN entry 33; H16's 172 is
  against ~351).
- **1 conditional.** H4k, only after a whole-launcher relaunch between H4 and H4k (route 132
  against ~210 without the carry-ahead).
- **7 unmeasured.** H4, H13, H14, H15, H18, H21d and H22.

## 2. The best-column yardstick: every run-wide line where expected exceeds best

Section 6's run-wide lines total ~1,236:

| Line | Expected / best |
|---|---|
| Overrun | 600 / 0 |
| Overlay relay | 200 / 0 |
| Contention | 300 / 0 |
| Retries | 100 / 0 |
| Level-ups | 25 / 15 |
| Relog tail | 3 / 0 |
| Restarts | 8 / 0 |

Section 6 also carries the legs at 2,328.3 / 2,256.2 and the hand-offs outside the figures at
69.7 / 69. For each line below: the reason expected exceeds best, and what removes it.

- **Overrun bursts, 600 / 0.** The demo's tick overruns hit the reactive loops (Woodcutting 140,
  Mining 129, Fishing 82, Thieving 83, Agility 166).
  - *Removes it:* nothing shared. Each loop's own slow-server mode (S07's plain-and-bury fallback,
    rs/186, band A) lowers its share.
  - *Server or ours:* server behaviour.
- **Overlay relay, 200 / 0.** A late-landing action through rs/98's relay (60:0 calm, 40:20 in an
  overrun minute).
  - *Removes it:* already engineered away, but still priced. The gateway is loopback on the run
    machine (section 1) and #90 executes overlay actions on arrival.
  - *Evidence:* attempt 3's opening non-reactive rows, measured on the run machine in calm
    minutes, came in at **596 against 595.2 priced, +0.8 over 10 rows** (m, demo, n = 1; host's
    lines against section 2 and 6's prices):

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

  - *Next step:* re-pricing it from the rehearsal's quest rows is rs/158's evidence task. It moves
    the margin, not the run.
- **The 800's named parts.**
  - *Real-server interactions, ~320-390 i:* sized from bgsrv-mac (rs/257, +0.5-1 a click),
    against the twin's +0.13 a talk (rs/287). The opening rows above show no surcharge, so this
    part looks like host latency the Ashburn machines removed: evidence, not a build.
  - *Teleport casts, ~20 i (5 ticks against 4 on 3 of 5 demo casts):* server behaviour.
  - *S07's bone loads, 0-105 i:* now 4 a load on the run machine all night (m), so close to 0.
  - *Herblore's cadence, 0-30 i:* n = 1, unchanged.
- **Contention, 300 / 0.** Other players at S07's trees and S09's rocks.
  - *Removes it:* site choice (bands A and B). rs/261 saw no respawn waits at ~1,750 online, and
    rs/259 ran S09's rocks uncontested.
  - *Server or ours:* server and players.
- **Retries, 100 / 0.** Mis-clicks, a dropped client, a re-sent trade.
  - *Removes it:* the re-sends are ours: items 13 and 15, and RESEND_TICKS 27 for a standing
    trade request (`lib/trade.ts:504`), which fires only when a partner relogs.
  - *Server or ours:* a dropped client is server behaviour.
- **Level-ups, 25 / 15.** The pages the content opens, in the range of LU§1's "15-30".
  - *Removes it:* nothing more. Pages are already answered on the label that shows them (LU§5),
    and the gap is page count, not handling.
- **Relog tail, 3 / 0.** The demo holds one logout in 29 for 46 ticks (WINE).
  - *Removes it:* nothing. It is a delayed logout, never a delayed login.
- **Restarts, 8 / 0.** 1-2 demo restarts a run, at ~2 m relog plus ~3 m resume each (R174,
  RES§6).
  - *Removes it:* nothing on our side. The relog and resume are already engineered; the restart is
    the demo's.
- **Legs, 2,328.3 / 2,256.2 (72.1 apart).** Closed doors in the expected and open in the best, and
  the teleport landing-square mean against the fastest tile.
  - *Removes it:* a door-free `via` where one exists, leg by leg in the bands (rs/185's T12-13
    row, ~4). The landing square is server RNG (map_findsquare radius 2).
  - *Fixed in both columns:* the settle tick (item 3), the leg/step join (item 5) and the
    transport hops' fixed dialogue (item 4). These are below best, not in the gap.
- **Hand-offs outside the figures, 69.7 / 69.** H13's 8.7 (pooled 9/10/9 and 8/8/8) against its
  fastest 8.
  - *Removes it:* item 9 brings H13 under 8. Items 6 and 11 sit below best on the delivery rows.

On tonight's evidence, about 200 of the ~1,236 is engineering already done but not yet re-priced
(the relay). Another ~320-390 inside the 800 looks like host latency that the Ashburn machines
removed. The rest is server behaviour, apart from items 13 and 15.

## 3. Top items, for a builder to start from

**Item 1: end a conversation on its close tick once its shape is consumed.**
- *Today:* `converse` (`lib/converse.ts:462-467`) finishes only after `idle` ticks with the chat
  closed (default 3, `:219`; the modules pass 2). That is how it tells "done" from a pause between
  pages.
- *Change:* when the caller passed a burst shape, every part of it has been answered, `until`
  holds, and the chat is closed on this frame, finish on this frame. Callers with no shape keep
  today's idle rule.
- *Acceptance:* the S10b, S11b and S12 browser chains, 3 of 3 each.
  - Each shaped conversation's row ends on its close tick: Fight Arena A at 5 against 8; Tree
    Gnome Village E at 2 against 4.
  - No page opens after a finish and goes unanswered: the next segment's first state shows no
    open dialog.
  - The S15 chain shows rs/185's 40-60.
- *Risk:* it touches every quest module, so it is a broad re-lab. It is rs/185's to build; rs/186
  reviews it as shared code.

**Item 2: tie the run stack's life to the attempt, not to `up`.**
- *Today:* RUN-HOST.md:53-71 starts the page server, gateway and live view under `T=9h` at step 3,
  and nothing re-arms them when an attempt resumes hours later. Tonight they died at ~01:33Z, with
  the watchdog's relaunch refused on both ports and SCORED in the world.
- *Change:* either is sufficient.
  - run.ts's start gate reads each stack process's remaining bound (run-gate already owns the
    units) and refuses a start or a `--from` resume with less than the remaining route plus RUN-HOST's
    hour of margin.
  - RUN-HOST's "Re-running after a StepError" recipe re-runs `up` with a fresh `T` first.
- *Acceptance:*
  - A run.ts dry-run against a stack started with `T=10m` refuses, naming the bound.
  - One with `T=9h` passes.
  - The resume recipe names the re-`up`.
- *Risk:* no step module changes.

**Item 4: give the transport hops their burst shapes.**
- *Today:* `hopTree` (`lib/travel.ts:1113-1128`) calls `actConverse` with only the answers, so the
  conversation runs fixed.
- *Change:* pass the shape for the tree kind and the burst flag (young `2c, opt, 2c`; big
  `2c, opt, 3c, opt, 1c`; grand_tree.md:157, spirit_tree.rs2). Do the same for the lever's first
  pull, Barnaby's ship, the glider pilot and Lumdo once their pages are read from the content.
- *Acceptance:* T10-11 and T14-15 on the browser, 3 of 3.
  - Each young-tree hop is 2 ticks shorter and each big-tree hop 3, against today's legs.
  - No burst falls back on the pre-teleport page (`if_close`, `p_delay(0)`, rs/185's caution).
  - S11b's C and J and S15's tree route rerun.

**Item 6: let the carrier request on SCORED's arrival frame.**
- *Today:* `cueAround` (`runner/chain.ts:350-361`) opens the `{row, mule}` cue in the hand-off's
  `run`. That is after the leg has observed arrival, so the carrier's pass for that frame has
  already run without authorization (`mule.ts:1376-1381`, `:1678-1681`).
- *Change, two forms:*
  - (a) Open the row's mule cue at the start of the leg that ends at the hand-off tile (chain.ts,
    rs/186). The mule keeper is separate from the main one (`cue-keeper.ts:244-251`), so it closes
    no bone or courier cue, and the 25-tick refresh keeps it fresh on long legs. The carrier still
    clicks only when SCORED is adjacent, so authorizing early moves nobody.
  - (b) Pre-request from the cue watcher's callback on the carrier's latest state (mule.ts, rs/41).
  - (b) is smaller and stays in one file. (a) also covers H11 and H23, if `runHandOffOnCue` moves
    the same way.
- *Acceptance:* a runner-driven lab, browser, 400 ms, H1 and H4k, 3 of 3.
  - The carrier's `pre-requested` line falls on SCORED's arrival frame.
  - Each row is 5 or less against today's 6.
  - No trade opens before SCORED is adjacent.
  - A cue stopped on a thrown step still stands the carrier down.

**Item 5: let the leg's last click be the next step's first op.**
- *Today:* each leg ends on `inArea(arrive)` (runner/legs.ts). The step's first talk or loc click
  then goes out on the frame that shows arrival and lands a tick later.
- *Change:* a leg may carry its successor's entry op (NPC or loc, from the step's segment A).
  `travel` sends that op in place of the final run click once the route is within the op's
  approach, and the step's A accepts "op in flight" as its start.
- *Acceptance:* per joined entry, on the browser, 3 of 3.
  - The step's first reply comes 1 tick sooner after the leg's last observed move.
  - Walked tiles are unchanged, so no detour to an off-path approach tile.
  - Segment A's later shape is unchanged.
- *Risk:* it touches every joined module. Start with the two where the NPC is static and the
  approach is on the leg's own path: Elkoy for S10b, and Caroline for S19.

## 4. Not avoidable

- **The trade's 4-tick floor**, from first click to items in the pack (m).
- **Step boundaries**, already 0 m.
- **Cue reaction**, ~0.
- **The planned relogs**: S21 (R12's helper order) and S25c's two (fermentation), ~2 m each, plus
  the demo's delayed-logout tail.
- **A relaunch's scene wait** after a navigated tab: most of rs/595's ~9.6-9.9 post-login checks,
  plus 73-75 m for a cold Varrock west scene (rs/41). It is client-side, unless item 3's
  self-routed send extends to it.
- **One tick per closed door.** The walk-through click must follow the loc change the client sees.
- **Teleport cast animations**: 4 ticks in the lab, 5 on 3 of 5 demo casts.
- **The teleport landing square**: server RNG.
- **Level-up pages** the content opens.
- **Overrun bursts, ragged ticks and contention**: the server and other players.
- **The S07 cue session's first-load republish**: 1-2 ticks, once (fold-in 34).
- **Spirit-tree routes where no lever exists** (rs/185's GT B, P, T11a and T11-12 rows).
