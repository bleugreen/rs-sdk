# Tick audit, band C: S15-S20 and S17, legs T14-15 to T20-21, hand-offs H12-H16

Read-only audit (rs/652, under rs/158) for main's attempt-4 pick (about 15:00Z on 10-24) and the
attempt-5 queue. It asks, row by row, what the expected column pays that engineering could remove.
It changes no code, no test and no canonical document.

Labels: **m** measured (the run is cited), **r** read from source, **i** inferred (the arithmetic is
shown), **e** estimate. 'Lab-accepted module' means a step module that has passed its lab acceptance
and is on main. Main's rule for attempt 4 applies to it: nothing changes such a module without its own
lab pass before staging.

**Tonight's live data.** The attempt-3 rehearsal never reached this band. It resumed at S07's willow
band at 01:05Z, and at about 01:33Z the twin's run stack hit its 9-hour bound. run.ts then exited at
session tick 5,027, still inside S07 (host, 01:43Z). So no S15-S20 line from tonight is used here.
Every figure below comes from the documents at this branch's base and the labs they cite.

## Rows in scope: expected, best and the gap

| Row | Expected | Best | Expected minus best | What the gap is |
|---|---|---|---|---|
| T14-15 | 181 m | 178.5 m | 2.5 | doors closed against open (browser) |
| H12 (inside S15) | 5 i | 5 i | 0 | the trade inside segment A (RUN-ORDER S15's 'the trade 5') |
| S15 Monkey Madness | 4,790.5 m/i | 4,565.7 m/i | 224.8 | segment means against each segment's fastest fixed run; the rope pin's 130.7 and the failures' 60 sit in both columns |
| H12o-M, H12o-P (inside S15) | 4 + 4 | 4 + 4 | 0 | measured 6 each (rs/201 exec 9), +2 a leg on the ladder |
| T15-16 (H13 inside it) | 143.7 m | 140 m | 3.7 | browser landing square and doors |
| H13 | 8.7 m | 8 m | 0.7 | pooled browser mean (rs/488, rs/567) |
| S16 Mage Arena | 382 m | 336 m | 46 | Kolodion fight variance, 252-340 ticks over 26 fights (rs/371) |
| T16-18 | 15.3 (7.3 m + 8 i) | 15 | 0.3 | the 8 i run to the anchor is in both |
| H14 | 8 m | 8 m | 0 | |
| S18 Thieving + stun pack | 2,026 | 1,925 | 101 | pack runs 1,908-2,098 (failure count, knight wander) + S18d's 9 |
| T18-19 | 49 m | 49 m | 0 | the two doors are in both |
| H15 | unpriced | unpriced | - | see 'Pricing gaps' |
| S19 Sea Slug | 311.0 m | 304 m | 7 | browser runs 307 / 304 / 322 |
| T19-20 | 40.5 m | 39 m | 1.5 | |
| H16 | unpriced | unpriced | - | see 'Pricing gaps' |
| S20 Fishing Contest | 319 m | 318 m | 1 | browser chains 318-320 |
| T20-21 (body plan in force) | 69.3 m + 3 m drops | 69 + 3 | 0.3 | rs/308 phase 2; the drop burst rs/589 |
| S17 Wilderness Agility | 4,114 i | 3,820 i | 294 | falls only (simulated sd 142, rs/270) |

## 1. Avoidable costs, ranked by expected ticks saved

'Ticks saved' gives the expected saving and then the saving in the bad case. Known levers are marked
**known** and their status is given in the notes under the table.

| # | Item | Step | Ticks saved (expected / bad case) | Label, citation | Build effort (h) | Risk to a lab-accepted module | Owner | Lab needed |
|---|---|---|---|---|---|---|---|---|
| 1 | **known** Burst dialogue in Monkey Madness, rebuilt on main's `lib/converse.ts` unchanged, so the other 12 converse quests stay byte-for-byte on tested code | S15 | 313 / ~293 | m: rs/513's 3 clean A-Z browser burst chains (4,724 / 4,809 / 4,499, 400 ms, the ruled kit) against the fixed browser chain 4,328: -313 on median per-segment deltas over the 17 talk-dominated segments, read ±20 (n = 1 on the fixed side); bad = -313 + 20 | 2-3 (re-apply rs/513's four patches to the current module; drop the converse re-send dependency) | **high, S15** (`monkey-madness.ts` + a shapes file); **none** for S05, S08, S10b, S11b, S12, S13, S16, S19, S20, S23, S24, S26 if `converse.ts` is untouched | rs/185 | 3 clean A-Z burst chains at 400 ms on main's converse.ts, browser, kit-gate criteria (at least 1 shark after R, HP never below 10): ~4,500 ticks ≈ 30 min each, ~2.5 h with setup |
| 2 | **Pin S18's knight with standing helpers** (a 'pen'): helpers on the knight's free neighbour tiles so it cannot wander, which removes the walk after a wandering knight from the success gaps and the post-stun clicks | S18 | ~150 / 0 | i: rs/479 (m, lab, 400 ms, browser stand-in at Thieving 80): success gap 2.03 against 2.23 and stun-to-next 11.00 against 12.21 with the crowd present, the stand-in never walking. On S18's 449 successes and ~90 failures: 449 x 0.20 + 90 x 1.21 = 90 + 109 = **~199**. Cross-check on the row's own runs: rs/375's c-runs normalise to 1,938 / 2,075 against the zero-wander floor 449 x 2 + 84.2 x 11 = 1,824 (stun-pack.md section 17) plus the Superheat slip 17 and ~11 level-up pages, so 2,006 - 1,852 = **~154**. Taken as ~150, range 100-199. Bad case 0: the pen is not formed, or rivals already pin the knight (R49's census: 37 rival Thieving-99 bots in this square on 10-22) | 4-6 (a pen mode in an existing helper, launcher entries, one cue family placed around S18 in chain.ts) | **low, S18**: thieving.ts unchanged. It targets the nearest knight from anchor (2670,3305) (`thieving.ts:206-207`, `:816`, `:841`), so the pen has to be on that knight. Costs extra logins on the address during S18 | rs/41 (pen helpers), rs/186 (chain cue) | (a) a pen-placement smoke at the anchor's knight, 4-7 helpers, checking that the knight stays put for 300 ticks (~20 min); (b) S18 57-99 browser band x2 with the pen and x1 without, same host (~2,000 ticks ≈ 14 min each at 400 ms), ~1.5-2 h in all |
| 3 | Supply Agility potions for the Wilderness course: the fall roll reads the boosted level | S17 | ~40 / 0 | i: falls use `stat_random` on the current (boostable) level (agility.md, `PlayerOps.ts:591-600`, r). RUN-ORDER S17 gives fall chances of 7.1% at 75 and 2.3% at 99 on the rope and log, and 9.0% and 2.3% on the stones: slopes of 0.20 and 0.28 points a level. +3 levels saves 0.6% x (75 + 47) + 0.84% x 16 = **0.86 ticks a lap**. Over ~59 laps (4,114 / ~70) that is ~51 at a full +3, ~30-50 after decay. Drinking costs 0 by analogy with `eatAt: 'land'` (m for eats, rs/270; i for drinks). Bad case 0: no stock (rs/348: not obtainable on the 23rd) | 2 (a drink-on-land beside the eat in agility.ts) + supply (Herblore 34: toadflax + toad's legs, ~7 potions, e) | med, S17 (`skills/agility.ts`, which is lab-accepted with the program's `eatAt`) | 10 laps at Agility 75 with a drink due at every landing, to confirm 0 a drink (~15 min); the boost's decay read from the engine (r) |
| 4 | Keep the amulet of magic worn into Kolodion's fight. Return it at H14, not H13 | S16 | ~25 / 0 | e: the entry check does not test the neck slot (`area_mage_arena/scripts/mage_arena.rs2:100-138`, r: hands, helmet, body, legs, shield, weapons, arrows, logs, cannon). The amulet's magic attack bonus should raise Fire Wave's hit chance; a 5-15% shorter fight on the ~318 mean is 15-45. Not computed from the engine's accuracy formula, so e until labbed. Bad case 0 if accuracy is not the binding term | 1 (two ledger rows: H13's `out` loses `amulet of magic x1`, H14's gains it; carriers regenerate) | low-med, S16: mage-arena.ts unchanged; the H13 and H14 packages change | 5 Kolodion fights each way from the route's arrival at Magic 77, lab, 400 ms (~320 ticks a fight, ~1 h with setup) |
| 5 | **known (O25)** A door-free route for T18-19 | T18-19 | 18 / 18 | i: RUN-ORDER T18-19 49 m with the walker taking 2 doors; O25's door-free route ~31 i. Chebyshev distance from (2670,3305) to (2716,3302) is 46 tiles, 23 ticks running, plus the browser settle | 1 (waypoints on the leg, `runner/legs.ts:481-484`, which is one bare `run` hop today) | low, no step module (runner leg) | 3 browser runs of the leg on the lab (~15 min) |
| 6 | **known** Bar drops off the Superheat cast ticks, so Fletching reaches 99 inside S18 and the S18d fallback never runs | S18 (S18d) | 9 / 16 | i: RUN-ORDER S18 '+9 (i)' for S18d's finish at ~75 stuns, '+10-16 at 70-74' (rs/147's s18-fletching model); the ladder's after-attempt-1 line 'Fletching 99 inside S18, Charge pin ~154 (the bar drops off the cast ticks), -2 to -10' | 3-4 (thieving.ts's stun schedule and `stun-actions.ts`'s program; page bundle rebuild on both Ashburn machines) | **med-high, S18** (thieving.ts + the in-page program; the golden packet tests change) | S18 57-99 browser band x2 at the scored stock (~30 min) + golden tests |
| 7 | Drop H12o-M (the M shark leg); keep H12o-P's Superantipoison(4) | S15 | 4 / 6 | m: priced +4, measured 6 ticks a leg (rs/201 exec 9). Kit-gate chains ended R with 13-14 sharks (rs/185, fold-in 33), and M delivered ~3 (rs/611's lab: asked 3, served 3), so ~10-11 would be left (i). It also removes M's ~40-tick absent-helper sensitivity and h45's M walk. Against it: rs/185 recorded the bare-kit case as 'food runs out in P and R' on older chains | 1 (h12o block `m: false`, `chain.ts:534-535`; h45's package) | **high, S15** (the kit; a death on the atoll ends the attempt) | kit-gate re-run: 3 A-Z chains without M (~2.5 h) |
| 8 | **Merge H16 into H15** (one carrier trade at Caroline's tile instead of two), if S19's slots allow | H15 + H16 | ~6 / ~6 | i: one placed trade removed, ~5-8 by analogy with H14's 8 m and H11's 8 m; it also removes H16's late-carrier exposure (rs/41 lab: 172 ticks from H15 to ready against a ~351 window, RUN-ORDER's late-carrier line). Needs ~8 more free slots through S19 (H16's rod, spade, garlic, coins, 3 rune stacks, talisman) | 1 (ledger rows; `chain.ts` PLACEMENT drops H16) | low, S19 and S20 kit segments unchanged if the items are already held | `tools/slot-ledger.ts` on the merged rows (minutes), then one S19 browser run holding H16's items (~5 min) |
| 9 | Do H14's load 0 as the first top-up inside the first stun | H14 / S18 | ~7 / 0 | e: inside-stun trades cost ~0.1-0.3 (stun-pack.md section 5, m), against H14's 8 m. But H14 is a 13-line two-way swap with several X offers, and one X offer a trade is the lab's rule (stun-pack.md section 16, 'one X offer a trade at most'), so it may not fit in a stun's window (by +9) | 3 | high, S18 | S18 band x2 (~30 min) after code |
| 10 | Start S18 from the Ardougne landing, not the anchor 15 tiles east | T16-18 | ~6 / 8 | i: legs.ts's T16-18 is 6 m to (2655,3305) + 8 i to (2670,3305) (`runner/legs.ts:477-479`). The anchor was chosen because 'the eastern knights wander least' (`thieving.ts:205`); a pen (item 2) makes that reason moot | 1 (anchor + H14's stand tile) | med, S18 (its anchor) | T16-18 3 runs + an S18 start smoke (~20 min) |
| 11 | **known** T20-21's rod into the post-landing drop batch | T20-21 | 1 / 1 | i: rs/589's trace (4 stacks fit one 5-drop tick; 3 ticks on the browser at two drop points) | 0.5 (`dropsDue` in `runner/legs.ts`) | low, no step module | 3 runs (~10 min) |
| - | A route that avoids the temple rope pin | S15 (N) | 130.7 / 392 if one exists | e: no mechanism known. The landing is the server's random tile 1-2 from the trapdoor (`mm_temple.rs2` oploc1 `map_findsquare`, per `monkey-madness.ts:1466-1467`), so no approach changes the odds | unknown | high, S15 | research first: is any exit from under the temple other than the rope? (r, quest_mm scripts) |

**Known levers named in the brief, with their status**

- **MM fast dialogue -313** (rs/513): measured, main ruled it off for attempt 1 because it rode on a
  `lib/converse.ts` change. Item 1 is the decoupled form, rs/513's own attempt-2 plan (2): the
  converse re-send fired 0 times in the burst chains (rs/513).
- **MM rope-pin recovery**: in force since fold-in 25. The module waits 50 ticks, casts the spare
  Varrock teleport and O takes the way back, ~392 a pin (m parts, rs/201 exec 7), 130.7 in the
  expected at 1 in 3 chains. Shortening `PIN_WAIT` is not a lever (see section 3).
- **Segment O's aunt windows**: the fixed talks nearly fill the aunt's ~54-tick safe window
  (`AUNT_LOOP`, `monkey-madness.ts:641-669`). rs/513's acceptance re-derives the patrol arithmetic
  under burst, so this lever rides item 1. The two newest clean chains already ran O at 300 / 307
  against the row's 388 (see 'Pricing gaps').
- **H12 single trade**: in force since fold-in 23 (H12a + H12b merged, -5). Nothing left to merge:
  H11r's bow and arrows ride the cannon return, which has to happen anyway.
- **S18 bar drops off the cast ticks**: item 6.
- **S17 falls and eatAt**: `eatAt: 'land'` is on main and costs 0 an eat (m, rs/270). Falls are the
  engine's roll on the boostable level, so the only lever is a boost (item 3).
- **S16 Fire Wave against Fire Blast**: Blast is +76 a fight (m, rs/371: 391 against 315.2). It pays
  only when blood runes are short, so it is not a saving while attempt 4's blood is complete.
- **H13 cellar version**: lab-accepted at 9 / 9 / 9 lite and 9 on the browser (rs/488) against the
  landing's 8.7 m. It saves no ticks; its value was staging (attempt-2 content).

## 2. Where a builder starts: the top five

**1. Monkey Madness burst on main's converse.ts (rs/185; -313 m).** rs/513 holds four patches against
rs/185's 19462917: `monkey-madness.ts` 6e862f47, its test b0d36fac, `monkey-madness-shapes.ts` a0fee5dd
and its test 095dc9ae (rs/513's issue body has the stitching note). Re-apply them to the module as it is
on main now; it has changed since 19462917, for example #498's H12 give-list fix (1c17d3e6). Do not take
the `converse.ts` re-send change (f92833fc). Delete the stale refusal at `monkey-madness.ts:3262` and keep
`DEFAULT_OPTIONS.dialogue: 'fixed'` (`:77`) until main adopts it. chain.ts passes `dialogue: 'fixed'` at
`runner/chain.ts:716`, and adoption is a one-word change there. Acceptance is rs/513's own bar on main's
library: unit tests (every shape matches; O's patrol arithmetic under burst), then **3 clean A-Z
chains in burst at 400 ms on the browser**, each passing the kit gate. rs/158 then re-prices S15 from
the per-segment burst table. `git diff main -- speedrun/lib/converse.ts` must be empty; that is what
keeps the other 12 quests off the risk.

**2. The S18 knight pen (rs/41 and rs/186; ~-150 i).** Mechanism (r, accepted by main via rs/479):
players never block players (`server/engine/src/engine/entity/Player.ts:783`), but NPCs are blocked by
players (`Npc.ts:412-413`). Helpers on a knight's neighbour tiles therefore pin it while SCORED and the
courier still reach it. The knight band starts at the nearest Knight of Ardougne to anchor (2670,3305)
(`skills/thieving.ts:206-207`, `nearestNpc` at `:816`, used at `:841`; `retargetTicks: 12` at `:1016`).
So the pen goes up around that knight before SCORED arrives: H14's time at the anchor is the natural
cue, with a new family `{step: 'S18', family: 'pen'}` placed around S18 in `chain.ts:796-797` like the
courier's. Helper side: a stand-on-tile mode in an existing role (mule.ts already holds stands), with
each helper taking the next free walkable neighbour of the knight's tile when it arrives and logging out
on the cue's stop. Open points for the lab: (a) how many helpers pin it (8 neighbours, less SCORED's,
the courier's and walls, so 4-7); (b) whether a knight already mid-walk escapes before the pen closes;
(c) rs/480's lab saw the uncrowded knight also at 2.03 / 11.00 with the crowd present (R49), so the
gain may need only nearby players rather than a full ring. Measure it, don't assume. Acceptance: two
S18 57-99 browser bands with the pen, normalised against one without on the same host, success gap
under 2.10 and stun-to-next under 11.3. Check the per-address login budget at S18 against SUPPLIES.md's
peak table. If rivals already crowd the square on run day, RUN-HOST's pre-S18 count shows whether the
pen adds anything.

**3. Agility potions for S17 (rs/186 and rs/41; ~-40 i).** The fall roll's level is boostable
(agility.md; `PlayerOps.ts:591-600`, r), and the only Agility boost in this content is the potion,
+3 (agility.md: `consume_effects.dbrow:288-294`; no summer pie). Build: a drink-on-land option in
`skills/agility.ts` beside `eatAt: 'land'` (the same landing-tick slot that makes an eat free), drinking
whenever the boosted level has fallen to base. Supply: ~7 potions (e, pending the decay read) from
Herblore 34 (toadflax + toad's legs), stocked in H23 beside S17's 12 sharks. Acceptance: 10 lab laps
at Agility 75 with a drink at every landing cost what the falls alone cost, as rs/270 showed for eats.
The saving itself follows from the formula and needs no band run.

**4. The amulet of magic through S16 (rs/185, ledger rs/158 and rs/41; ~-25 e).** At
`docs/speedrun/STEP-MANIFEST.md`'s H13 ledger row the `out` column hands back
`amulet of magic x1 (swap: dead since S15)`. Move that line to H14's `out` (H14 already swaps the knife
out), wear the amulet before T15-16a if it is not already worn, and regenerate the H13 and H14 carrier
packages. Kolodion's entry check (`area_mage_arena/scripts/mage_arena.rs2:100-138`) does not test the
neck slot. Before any ledger change, the lab answers whether the fight shortens: 5 fights with the
amulet and 5 without, from the route's arrival at Magic 77 on the same host (rs/371's
`fight` counters already report casts and ticks a form). Adopt only if the mean is at least 10 ticks
shorter.

**5. T18-19 without the doors (rs/186; -18 i, O25).** `runner/legs.ts:481-484` defines T18-19 as one
bare `run` to Caroline (2716,3302), and the walker's path took two doors (RT `L18`, 49 / 49). Add
waypoints that keep it outside, read from the collision map between (2670,3305) and (2716,3302). Then
measure 3 browser runs from the knights' anchor with doors in their default state and re-point the leg's
`expected` at the measured figure. The quest documents are untouched; the leg is runner code, not a
lab-accepted module. If item 10 moves S18's start west, re-derive the start tile with it.

## 3. Checked and not avoidable

- **S15's jail cycles (H, M) and the lock**: the ravine archers knock out at 1 in 20 shots
  (`mm_archer.rs2:51-53`, r) and the lock is `stat_random(thieving, 95, 295)` (`mm_jail.rs2:4`, r); wake
  times 55-73 (m, monkey_madness.md). Content randomness, and the route needs both jailings.
- **S15's waits**: the child's toy timer 100 (`mm_monkey_child.rs2:142`, r), the hangar cutscene and
  the sigil (monkey_madness.md 'Waits', 336, m + r). Content timers.
- **S15's rope-pin wait, `PIN_WAIT` 50** (`monkey-madness.ts:1488`): waiting freed 1 pin in 3, at 49
  ticks; the pins that lasted held 400+ (`:1492-1493`, m, lab/measure-mm-pin.ts). Expected value of
  the wait is +1/3 x 338 (the way back) = +113 against at most 50 paid, so keep it (i).
- **S15 G's scorpion** (+12 to +27) and the N, T and P throw lines: sensitivities outside the
  expected (the margin ladder), not in it.
- **H12o-M login lead**: in rs/611's lab h45 logged in at tick 1603 on its H12oM cue and traded at 1908,
  a 305-tick lead (m), so no arrival wait is paid. The receive leg's 30-tick `TOPUP_WAIT`
  (`monkey-madness.ts:2304`) only bites if h45 is absent.
- **Hand-off arrival waits, H12-H16**: every window is long: H12 after S13 + S14 + T14-15, H13 after
  S15's ~4,790, H14 after S16 + T16-18 (~540 i), H15 after S18's ~2,026, H16 172 ticks to ready
  against ~351 (rs/41 lab). Expected wait 0. The residual risk is a thrown step when the partner is not
  in view (`runner/handoff.ts:284`, the late-carrier line; rs/598's reorder after attempt 1). It is a
  manual restart, not an expected cost.
- **S16's fight**: the module clicks every 2 ticks (`castEvery: 2`, `mage-arena.ts:508`) against the
  spell's 5-tick delay, so the cast cadence is server-bound. The fight's 252-340 spread is Kolodion's
  rolls. Fire Blast is slower (above).
- **T15-16's webs**: a flat 50% a slash, weapon-independent (`web.rs2:26`, r).
- **S17's lap**: 66 ticks is the floor (rs/270's per-tick trace: each click lands on the tick after
  the xp shows, and a click during an obstacle's delay is dropped). An eat costs 0 with `eatAt: 'land'`.
- **S18's stun count and top-ups**: failures are the pickpocket roll at the level. Idle top-ups with
  the courier on a side tile cost ~0 (m, rs/279). The Superheat slip (+0.22 a stun, 95% interval
  -0.11 to +0.56, m, rs/375) buys the net ~-58, so it stays.
- **S19**: I's Kent pages carry `p_delay(2)` + three `p_delay(1)` (`kent.rs2`, m, rs/414), and Q's
  level-up page comes 3 ticks after Caroline's chat closes. Content time.
- **S20**: the self route's walks are forced, since the carp, the red vine worm and the pass are
  untradeable (`fishing.obj:378`, r). J's Sinister Stranger pages (9 against 13) are the content's.
- **T14-15** is the fastest no-glory variant (the others 187-188 m). **T19-20** is the Camelot
  teleport and the run east, and no closer teleport exists. **T15-16**'s Ardougne lever and ladder are
  the only way into the arena.
- **Level-up pages**: S15's ~3 reward pages are in section 6's 25 i allowance. Burst cannot skip them.

## Pricing gaps found (forecast errors, not tick savings)

These move the forecast, not the score. They are listed so rs/158 can check them; none of them is a
reason to change code.

- **H15 and H16 look unpriced (+10 to +16 i).** Both are placed hand-offs run by run.ts
  (`chain.ts:231, 235`, `before: 'S20'` / `'S19'`). S19's figure counts from Caroline's tile with
  segment A at 0 (the kit check; STEP-MANIFEST entry 20's segment table), and section 6's S19-S20 cell
  says 'in the quests'. Section 6's run-wide hand-off sum (69.7) lists H11, H11r, H13, H14 and others,
  but neither H15 nor H16. At ~5-8 a trade (i, against H14's 8 m) that is +10-16 missing. If S20's
  rs/388 lab ran the H16 receive inside segment A, H16 is already in; rs/388's driver says which.
- **S15's 'expected failures 60' (the demon)** may be stale. X out of rune arrows was 0 in 12 runs on
  200 arrows, with p90 use ~76 (the ladder's X line, m). If no other demon failure mode remains, the
  60 is an allowance with nothing behind it. rs/185 to confirm.
- **S15's segment mix has drifted from the row.** The two newest clean chains (rs/513 browser 4,328;
  rs/611 lab 4,369) ran V at 70 / 70 against 14 priced (+56) and A-F at 426 / 433 against ~325 i
  (+~105). They ran H-M at 1,286 / 1,351 against 1,466, O at 300 / 307 against 388, P at 368 / 366
  against 454 and X at 280 / 275 against 323.8. The kit-gate mean, 4,811.7 (rs/185, fold-in 33),
  still sits on the row's 4,790.5, so this is a composition note, not a re-price.
- **T16-18**: `runner/legs.ts:479` carries 14 (lite basis) against the documents' 15.3 (browser). This
  is known (rs/158, fold-in 34) and listed only for completeness.

## Sources

RUN-ORDER.md section 2 (rows T14-15 to T20-21, S15-S20, S17), section 6 (the overhead model and
the hand-off sum), section 7 (the margin ladder, R49, the late-carrier and S15 lines); STEP-MANIFEST.md
entries 2, 6, 19, 20 and 23 and the ledger rows H12, H12o-M, H12o-P and H13-H16; SUPPLIES.md H12-H16;
`research/stun-pack.md` sections 3, 5, 16 and 17; `quests/monkey_madness.md`; `skills/agility.md`;
code at this branch's base: `speedrun/quests/monkey-madness.ts`, `mage-arena.ts`, `sea-slug.ts`,
`fishing-contest.ts`, `speedrun/skills/thieving.ts`, `speedrun/runner/chain.ts` and `legs.ts`;
`server/content/scripts/areas/area_mage_arena/scripts/mage_arena.rs2`; issues rs/479, rs/513, rs/201,
rs/611, rs/371 and rs/375; main's and host's threads through 01:43Z on 10-24 (the attempt-3 rehearsal
stopped in S07); rs/41's helper-side input to rs/652 (19:0x PDT).
