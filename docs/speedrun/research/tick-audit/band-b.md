# Tick audit, band B: S08-S14, legs T07-08 to T14-15, hand-offs H4p and H6-H11r

Read-only audit (rs/651, under rs/158) for main's attempt-4 pick (about 15:00Z on 10-24) and the
attempt-5 queue. Row by row, it asks what the expected column pays that engineering could remove. It
changes no code, no test and no canonical document.

Labels: **m** measured (the run is cited), **r** read from source (file:line), **i** inferred (the
arithmetic is shown), **e** estimate. 'Lab-accepted' means a step module, or shared code under one,
that has passed its lab acceptance and is on main. Main's rule for attempt 4 applies to it: nothing
changes such a module without its own lab pass before staging. Code citations are at main
1e536f76.

**Tonight's live data.** The attempt-3 rehearsal did not reach this band before this audit was
written. At 01:5xZ main ruled a resume into S07's willow tail after the twin's run stack hit its
bound, so no S08-S14 per-step line exists yet (host and main threads, 00:00-01:57Z). Every figure
below comes from the documents at this branch's base and the labs they cite. When the rehearsal's
S08-S14 lines land, the rows in section 1 to check first are the expected-minus-best gaps on the door
legs (T07-08, T12-13) and S14's 118.

**Rows already audited by rs/185** (cairn://p/rs/185/1/coordinator/task/tick-audit-gt and
/tick-audit-dc) are cited here, not re-derived, and marked 'rs/185'. This document adds the hand-offs,
the legs, Mining, Agility, the cannon session, the design-level items and the pricing of the Crafting
lever.

## 1. Rows in scope: expected, best and the gap

| Row | Expected | Best | Expected minus best | What the gap is, and what removes it |
|---|---|---|---|---|
| T07-08 | 138.7 m | 129 m | 9.7 | Edmond's three house doors (x 2570-2578, z 3333) closed on arrival (run-transitions.md:371). A helper can open them: item 7 |
| H6 (in S08) | 9 m | 9 m | 0 | the receive at Edmond's tile, 12 stacks (rs/400) |
| S08 Plague City | 402.7 m | 399 m | 3.7 | chain variance across rs/413's three browser chains (390 / 398 / 393, + 9). rs/185 puts it within ~5 of its stage-gated floor |
| T08-09 | 49.3 m | 49 m | 0.3 | landing-square variance |
| H4p (in S09) | 5 i | 5 i | 0 | priced 5 i; 3 m on the giver's clock (rs/319). Removable by merging into H6: item 10a |
| S09 Mining | 3,157 i | 3,148 i | 9 | 3.019 against the 3.00 floor: the late starters, 0.38 per 100 ores (MR §6), which is host steadiness, not code. The ~32-tick band start sits in both columns. Its probe is removable: item 5 |
| T09-10 | 55.5 m | 55.5 m | 0 | |
| H7 (in S10b) | ~4 r | ~4 r | 0 | inside S10b's figure (rs/185, from rs/342's PR) |
| S10b Tree Gnome Village | 678 m | 665 m | 13 | warlord fight rolls in K (browser K 195 against lite 191, rs/457) |
| T10-11 | 57 m | 57 m | 0 | |
| S11a Gnome course | 168 m | 168 m | 0 | the same upper bound in both columns. The +54 lap is removable by a potion: item 2 |
| H8 (in S11b) | ~4 r | ~4 r | 0 | inside segment A. Removable by merging into H7 (rs/185): item 10b |
| S11b Grand Tree | 1,352 m/i | 1,259 m | 93 | P, the Daconia root, priced at its expectation of 104 i against the fastest chain's drawn root, plus chain variance. **Not removable**: `%daconia_rock_root` is perm-scope and never sent to the client (quest_grandtree.varp:4-5, king_narnode.rs2:70, `random_range(1, 15)`), and `ROOT_ORDER` (grand-tree.ts:178) is already the 2-opt optimum (rs/185) |
| T11-12 | 74.7 m | 74 m | 0.7 | landing variance; the drop burst (2 m) is in both columns |
| H9 (between T11-12's parts) | **unpriced** | - | - | a real trade (legs.ts:440-445) in no row's figure (rs/185 for H9; T11-12's 74.7 is a leg-only figure). Item 10c |
| S12 Fight Arena | 526.2 m | 499 m | 27.2 | G, H and I combat rolls. The pooled price is conservative by ~10-15 i (rs/185: browser G+H+I 222.3 against the pooled 237.2), which is a pricing note |
| T12-13 | 109 m | 101 m | 8 | the door at (2616,3345) and Lawgof's gate (2568,3458) closed (run-transitions.md:372). Item 7 |
| H10 (between T12-13's parts) | **unpriced** | - | - | as H9: T12-13's 109 m is rs/484's leg-only single. Item 10c |
| S13 Dwarf Cannon | 917.9 i | 810 i | 107.9 | railing and shed dice; the best is a lucky burst chain. Crafting before S13 moves the expected: item 4 |
| T13-14 | 178.7 m | 177 m | 1.7 | the Ardougne and lever-house doors (run-transitions.md:373) |
| H11 (between T13-14's parts) | 8 m | 8 m | 0 | 8 is RT§3's 23-stack figure. The cannon trade is 4 m on the receiver's clock (cannon.md:218-229): item 18 |
| S14 cannon session | 118 m | 104 m | 14 | the four lab sessions' spread (104 / 124 / 116 / 128, rs/199). rs/393's run-script chunk took 137, cause unsplit: item 20 |
| H11r (between T14-15's parts) | 8 i | 8 i | 0 | 5 m on the stand-in's clock for the two-way swap (cannon.md:230): item 18 |
| T14-15 | 181 m | 178.5 m | 2.5 | doors (shared with band C, which lists the same row) |

The band's expected-minus-best gaps sum to **~291 i** (the arithmetic is the column's sum). About 210
of it is dice that no engineering removes: the Daconia root (93) and the railings (108, of which item 4
moves the expected, not the spread). About 22 is doors, which item 7 removes. The rest is variance.

## 2. Engineering candidates, ranked by expected ticks saved

Saved figures are against the row in force, as **expected / bad case**. A negative bad case means the
change can cost ticks if it misbehaves. 'Attempt 4?' says whether the item can meet main's rule by
15:00Z tomorrow: either it touches no lab-accepted module, or its own lab is short enough.

| # | Item | Step | Ticks saved (exp / bad) | Label and citation | Build (h) | Risk to a lab-accepted module | Owner | Lab needed | Attempt 4? |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Fight Arena moved between S09 and S10b** (step reorder): S09 at the zoo, then walk to Lady Servil, then S12, then walk to Elkoy, then S10b, S11a and S11b, then an Ardougne teleport from Narnode into T12-13's run to Lawgof | T09-10, T11-12, T12-13, S12 | **~75 / ~40** | i: today's legs 55.5 + 74.7 + 109 = 239.2 m; the new legs at T09-10's own measured 0.555 ticks per Chebyshev tile (55.5 over the 100 tiles from the zoo to Elkoy): zoo to Servil 38 tiles, 21; Servil to Elkoy 62 tiles, 34; Narnode to Lawgof by the same Ardougne cast and run as T12-13, 109; total 164. Bad case e: +20-35 if Fight Arena's Fire Blast is less accurate at Magic ~59-64 than at ~73, or the Servil-to-Elkoy walk draws Khazard aggression | 12-16 | **med**: S12 (arrival levels change: Magic ~59-64, not ~73), S10b's kit (H7 moves) | rs/158 (order), rs/186 (chain, legs), rs/185 (S12 at the new levels), rs/41 (H7/H9 restaging) | the S09-end, S12, S10b seam on the browser 3x (~3 h); S12 at Magic 59 3x (~1.5 h); the prayer-points ledger first (below) | no, attempt 5 |
| 2 | **S11a lap to 22 with an Agility potion in H8** (known; rs/611's lever) | S11a | **54 / 54** less ~1-2 for the drink | m: rs/611's +54, an upper bound (one lap, 3 of 3, lab, 400 ms, browser). The potion exists in this content (potions.obj:1415, `4dose1agility`); grand-tree.ts:268's kitCheck already reads the boosted level. rs/348 found GE bids only | 1 (chain.ts back to `to: 22` when H8 holds a potion; #497 laps to 25 regardless) + supply | low: Agility and the Grand Tree unchanged | rs/41 (a helper-made potion; Herblore level and ingredients not checked here), rs/186 (chain) | S11b A-M with the potion 1x on the browser | no: no potion held |
| 3 | **Conversations end when their shape is consumed and `until` holds** (rs/185's shared change), plus S13's Lawgof talks, which rs/185's Dwarf Cannon table leaves out | S08, S10b, S11b, S12, S13 | **~55 / ~15** | rs/185: the Grand Tree 20, TGV 15, Fight Arena 10 (after its idle-2 row). Added here: `lawgof()` passes no idle (dwarf-cannon.ts:289), so it takes converse's default of 3 (converse.ts:219), over A, C, E, H, J and L: ~6-10 e. Plague City's talks already use idle 1 (plague-city.ts:380, :409): ~0-3 e | 4 + labs | **high**: converse.ts is under every quest module | rs/186 (lib), rs/185 | every quest module in the band 3x on the browser (~6-8 h) | no; its module-local part, Fight Arena idle 2 (-7 r, fight-arena.ts:278), could pass a ~1.5 h lab |
| 4 | **Crafting 30 before S13** (known: O47, rs/257 ~95; rs/185 D1 119 gross). Its xp cost, unpriced until now, is priced here | S13 | **~+40 net (+14 to +69) / B's p90 tail -45** | Gross 119 i (rs/185: B ~96 + I ~23). Cost e: no idle SCORED window exists in S08-S12 (every row there is walk, talk or fight, and section 5's table gives S09's knife loop no free capacity), so the ~534 base xp (rs/185) is its own block. The cheapest named method is leather crafting from helper-supplied soft leather at a standstill tile (H10's Ardougne landing). ~534 base at ~14-27 base an item (gloves at level 1 to chaps at 18; standard values, not read from this server) is 25-40 items, 1-2 packs, ~14 i at rs/359's 7.0 ticks a 26-item pack (m, Crafting 45+); plus ~29 level-ups from 1 to 30, each stopping the batch, 1-3 ticks each, ~29-87 e; plus a receive, ~5 i: **~50-105 e**. Net 119 - (50 to 105). It also roughly halves S13's damage and H10's shark need (O47) | 6-10 (rs/185) + ~3 (crafting.ts from level 1) | **med**: crafting.ts (S25d, lab-accepted) if reused; S13 itself unchanged | rs/158 (row), rs/186 (crafting), rs/41 (leather) | a 1-30 leather session on the browser (~1 h) to measure the level-up cost; then B and I re-priced at 30 (rs/185, 3 runs) | no, attempt 5 |
| 5 | **S09's band-start probe seeded from S07's last gate verdict** | S09 | **29 / -20** | m: the probe costs 29 (rehearsals/mining.md §1, the lab chain). i: the seed would be ~596 ticks old at S09's start (T07-08 138.7 + S08 402.7 + T08-09 49.3 + H4p 5), ~4 min at 400 ms. Bad case e: a stale verdict runs the knife on an unsteady host until its first slip re-probes | 3-4 | **high**: Mining (MR) and the woodcutting gate, both lab-accepted | rs/186 | the S07-end to S09 seam with a seeded verdict 3x, plus a forced-unsteady control (~2 h) | no, attempt 5 |
| 6 | **S11b's black demon by Fire Blast** (rs/185 GT row 1) | S11b | **25 / 10** | i (rs/185: max hit 12 to 16, magic_combat_spells.dbrow:143, :219; demon magic defence -10). Needs ~30 more death runes in H7 or H9 for Fight Arena's 56 | 1.5 | med: the Grand Tree | rs/185, rs/41 | N1+N2 3x on the browser | yes, if its lab passes |
| 7 | **Leg doors opened ahead of SCORED by a helper** (new). Doors revert 500 ticks after they are opened (doors.rs2:1-2, `~open_door(500)`), so a helper that opens a leg's doors on a cue at the leg's start leaves them open when SCORED arrives | T07-08, T12-13, T13-14, T14-15 | **~22 / 0** | m: each leg's measured closed-door expected against its open-door best on the browser: T07-08 138.7 against 129 (9.7), T12-13 109 against 101 (8), T13-14 178.7 against 177 (1.7), T14-15 181 against 178.5 (2.5). Bad case 0: a late opener or another player closing a door leaves today's state | 5-6 | **low**: no step module. A new light role, not mule.ts (the delivery engine is lab-accepted) | rs/41 (role), rs/186 (cue in legs.ts/chain.ts) | each leg 3x on the browser with the opener, `doorOpens` 0 in the RESULT leg lines (~2 h) | **yes**: no lab-accepted module, if a fleet login is free |
| 8 | **Spirit-tree hops with their shapes and the burst** (rs/185 GT row 4 and TGV row 2), plus T14-15's two hops, which rs/185 does not count | S11b C and J, T10-11, T14-15 | **~18 / 6** | r/i: `hopTree` passes no shape (travel.ts:1124). rs/185: C and J 10, T10-11 3. Added here: T14-15's young tree (`2c, opt, 2c`, -2) and village tree to the stronghold (`2c, opt, 3c, opt, 1c`, -3), shapes from grand_tree.md:157, ~5 i | 2 | **med-high**: travel.ts is under every leg and module | rs/186 | C, J, T10-11 and T14-15 3x on the browser (~2 h) | possible, with that lab |
| 9 | **Merge hand-offs on the same carrier**: (a) H4p into H6, new; (b) H8 into H7, rs/185; (c) H10's runes into H9, new, which leaves H10 a 'shark to 8' top-up that trades nothing when S12 eats no shark | S08/S09, S10b/S11b, T11-12/T12-13 | **~13 / 0** (a 5, b 4, c 4) | (a) i: H4p's whole priced 5 i (RUN-ORDER.md:664); the same carrier, h55 (rs/41's ledger), and 2 slots (rune pickaxe and 1 log) ride S08. (b) rs/185. (c) i: H9 and H10 stand on the same Ardougne landing (legs.ts:440-449) with the same carrier; a top-up row already met makes no trade, 0 ticks (handoff.ts:551-553); S12 ate 0 sharks in rs/379's and rs/401's runs; H10's law, water and air stack on stacks S12's exit already holds (14 used / 14 free, rs/379), so only its sharks take slots. rs/185's alternative, H9 into H7, conflicts with (c); take one of the two | 2 + 1 + 1, plus rs/41 restaging | **med**: (a) S08's `slots('A')` (plague-city.ts:898) and Mining's own H4p receive (mining.ts:514-536); (b) the Grand Tree's `kitFrom`; (c) none (a ledger row) | rs/41, rs/186, rs/185 | (a) S08 A-B and S09's start 1x each; (b) per rs/185; (c) T11-12 and T12-13 with the merged ledger 1x | (c) yes; (a) and (b) with their labs |
| 10 | **Price the two unpriced trades** (pricing, not engineering): H9 and H10 sit in no row | T11-12, T12-13 | **-8 to -10 on the row** (it adds ticks) | i: 4-5 each, from cannon.md's 4-tick receive and H6's 9 m for 12 stacks; item 9c removes most of H10's | 0 | none | rs/158 | none | yes (docs) |
| 11 | **S11b J by Ardougne and the Khazard young tree** (rs/185 GT row 3) | S11b | **12 / 5** | m-derived (run-transitions.md:89-90) | 1.5 | med: the Grand Tree; H8 restaged (+1 law, +2 water, -3 air) | rs/185, rs/41 | J 3x on the browser | yes, if its lab passes |
| 12 | **Fight Arena's exit by the north door** (new against rs/185): from the arena door (2607,3151) out by the north door, which opens from inside without dialogue (fight-arena.ts:18-19), instead of the west door | S12 K | **~12 e / -5** | e: the exit today is 17 + 3 + 33 = 53 m (fight_arena.md:105-107); the north route is ~20 + ~50 tiles at the measured 0.57 ticks a tile, ~40. The corridor gate stall (fight-arena.ts:239-245) could take part of it. Needs an offline route check before any lab | 1.5 | med: Fight Arena | rs/185 | offline pathfinder first, then K 3x on the browser | no |
| 13 | **Prayer toggled once the forced move has settled** (rs/185 GT row 6, FA row 4) | S11b I, S12 J | **6 / 2** | m/r: 4 ticks each today (combat.ts:85-99; RUN-ORDER.md:406, :408) | 1 | med: both modules | rs/185 | I and J 3x on the browser | yes, if their labs pass |
| 14 | **Prayer toggle and the next click in the same tick** (rs/185 GT row 7, TGV row 3, FA row 7) | S10b, S11b, S12 | **10 / -9** | i (rs/185); packet order on the browser is unproven | 2 | **high**: combat.ts is shared | rs/186, rs/185 | packet order on both clients, then each module | no |
| 15 | Tree Gnome Village's Elkoy pages, H's door re-send, N's scroll (rs/185 TGV rows 4-6) | S10b | **8 / 0** | i (rs/185) | 4 | med-high (act.ts is shared for row 5) | rs/185, rs/186 | C, I, J, L, H, N 3x | no |
| 16 | S13's railing loop reacting on publish, and the success wait (rs/185 D2) | S13 B | **5-10 / 0** | i (rs/185): the fixed `waitTicks(3)` after a success (dwarf-cannon.ts:434, and :535 for the shed) | 2 | med: Dwarf Cannon | rs/185 | B 3x on both clients | possible |
| 17 | **S14's cannon placed for coverage** (new, e) | S14 | **6-12 e / 0** | e: ranged.md:292-294 records a cannon 5-6 tiles off cutting the rate (9.2-12.3 against 12.3); S14 builds on the site's `setupTiles` (ranged.ts:390), unmeasured for coverage; `ranged-cannon-coverage.ts` exists to test it | 2 | med: Ranged (RG) | rs/186 | coverage map, then 4 sessions (~1 h) | no |
| 18 | **Re-price H11 and H11r on their measured trades** (pricing) | T13-14, T14-15 | **~5-6 / 0** | m: cannon.md:229-230 (lab, 300 ms): H11's give 4 on the stand-in's clock and H11r's swap 5, against the 8 + 8 placeholders (RT§3's 23-stack figure); H11 also pays ~1-2 i for h92's request after the cue opens (handoff.ts:481-488), so ~5-6 and 5 | 0 | none | rs/158 | none (a browser confirmation would firm it) | yes (docs) |
| 19 | **H11's cue opened at T13-14's start** (new): the {S14, cannon} cue opens inside the hand-off today (chain.ts:869), so SCORED waits for h92's request after it lands. Opened at the leg's teleport click, h92's request is standing at the landing (handoff.ts:487 returns at once) | H11 | **1-2 / 0** | i: holder's 'request to open 2' (cannon.md:229) | 1 | **low**: runner only; h92's serve mode unchanged | rs/186 | T13-14a + H11 3x | **yes** |
| 20 | **S14's slow run** (known; rs/393's run-script chunk 137 against rs/199's 104-128) | S14 | **0 / 19** | m (rs/393, bgsrv-mac, browser, ce357982, overBudget 0, n = 1); the cause is unsplit, and the row prices 118, so nothing comes off the expected until the cause is known | ? | ? (Ranged or the runner) | rs/393, rs/186 | the run.ts chunk with a per-phase trace | open |
| 21 | S14's pick-up behind the Ranged-50 level-up page (new, unverified) | S14 | **0-6 e / 0** | r: the stop breaks (ranged.ts:453-456) before the page's continue click (:504); a refused pick-up re-sends after 6 (lib/cannon.ts:365-371). Also STEP-MANIFEST entry 26 says pick-up +1 while dwarf_cannon.md:184 measured 3 | 0.5 | med: Ranged | rs/186 | one trace of S14's end | possible |
| 22 | Plague City's clerk burst, the mask on during J, and the fixed 3-tick sleeps on retry paths (rs/185 C2, C3; new for the sleeps) | S08 | **~3 / 6** | rs/185 C2 2 i, C3 1 i. The sleeps are `waitUntil(() => false, { maxTicks: 3 })` (plague-city.ts:558, :591, :705), retry paths only, so 0 expected and 3 each in the bad case | 2 | med: Plague City | rs/185 | Q, J-K 3x | no |
| 23 | Dwarf Cannon D waiting for the remains' respawn (rs/185 D3) | S13 D | **0 / 20-40** | i (rs/185) | 1 | med | rs/185 | D with the floor emptied 1x | possible |
| 24 | legs.ts:448 gives T12-13 `expected` 121 against the row's 109 / 101 | T12-13 | **0 / 0** | r (rs/186 via rs/158): code/doc mismatch only; nothing on the run path reads it for timing. Fix queued with rs/186 | 0.1 | none | rs/186 | none | yes |
| 25 | Level-up pages charged twice (pricing, check with rs/158): section 6's S10-S13 cell adds 'S11: ~3 reward pages + 0-12 for the Gnome course; S12 ~2; S13 0-1' (i) to rows measured end to end (S11a's 168 is rs/611's lab laps, which include their level-ups; S11b, S12 and S13 are browser chains that include their reward pages) | S11a-S13 | **~6-18 on the allowance / 0** | i, if the cell is meant as 'not in the figures' (RUN-ORDER.md:658's column header) | 0 | none | rs/158 | none | yes (docs) |

**Already-known levers and their status:**
- S11a's +54 lap to 25: open, item 2 (a supply item; no potion held).
- S13's railings at Crafting 1: open, item 4, now with its xp cost priced (net ~+14 to +69 e).
- S13's segment J door: **done**, #289 on the floor; J 28.7 fixed and 20.3 burst (m, rs/257), in the row since fold-in 19.
- TGV segment H: **done**, accepted on both clients (lite 74 / 70 / 70, browser 76 / 70 / 74, rs/457); no lever left, except rs/185's 2-tick re-send timing (item 15).
- S14's slow run, 137 against 118: open, item 20.
- The Grand Tree's dropped first click after the tree door: **done**, 0 of 48 on the browser (rs/405).
- Fight Arena B's door stall: **done**, 37 / 37 / 37 on #419 (rs/484).

**Totals.** Items 1-9, 11-17, 19 and 21-23, without overlap (9c taken over rs/185's H9 into H7), come to
**~400 expected i/e** across the band (the sum of each item's expected column, taking ranges at
their midpoints), ~130 of it in items 1 and 2 alone. The attempt-4-eligible part
is smaller: item 7 (~22, no lab-accepted module), item 19 (1-2, runner only), and the module-local items
whose own labs are each at most ~2 h (6, 11, 13, 16, Fight Arena's idle 2 inside item 3, and 9c):
**~85 i** (22 + 1.5 + 25 + 12 + 6 + 7.5 + 7 + 4) if every one of those labs passes by staging. The pricing rows (10, 18, 25) move the
row, not the run: -8 to -10 for the unpriced trades, +5 to +6 for H11 and H11r, and +6 to +18 off
the level-up allowance.

## 3. The top five, for a builder to start from

**Item 7: leg doors opened ahead (attempt 4 candidate, no lab-accepted module).** The engine's
doors revert 500 ticks after opening (`[oploc1,_door_closed] ~open_door(500)`,
server/content/scripts/doors/scripts/doors.rs2:1). Every door-bound leg in this band already has a
measured open-door figure, so the saving is measured on both sides: 9.7 on T07-08, 8 on T12-13, 1.7
on T13-14 and 2.5 on T14-15. The doors are listed per leg in docs/speedrun/research/run-transitions.md
:371-373. Build a small headless role (a lite account; not inside helpers/mule.ts, whose delivery
engine is lab-accepted) that stands near a leg's doors and, on a `{step: 'T07-08', family: 'doors'}`
cue, opens each closed door on its list and stands clear of SCORED's path. run.ts writes that cue at
the leg's first click (the leg definitions are speedrun/runner/legs.ts:419-465, and the cue writer
pattern is runner/cue-keeper.ts). T07-08's doors are 2-10 tiles from h55's H6 stand (2568,3334), so
one account can cover T07-08 and, standing at Lawgof's gate and the (2616,3345) door, T12-13. It needs
a fleet login inside tenet 25's budget. Acceptance: on the browser lab at 400 ms, T07-08 and T12-13 3x
each with the opener cued, every run's RESULT leg line showing 0 closed doors met, and each leg within
2 ticks of its open-door best (129 and 101), plus one run with the opener deliberately late, which
must equal today's closed-door figure (the fail-safe).

**Item 1: Fight Arena between S09 and S10b (attempt 5, the band's largest saving).** Today the run
leaves the zoo (2604,3235) west to Elkoy (T09-10, 55.5 m), does TGV, the course and the Grand Tree, then
teleports back to Lady Servil (2566,3199) (T11-12, 74.7 m), which is 38 tiles from the zoo it left,
then teleports again to reach Lawgof (T12-13, 109 m). Visiting Servil on the way west removes the
back-and-forth: zoo to Servil ~21 i, Servil to Elkoy ~34 i, and Narnode to Lawgof by the same
Ardougne cast as today's T12-13, ~109, for ~75 i saved. The chain order lives in
speedrun/runner/chain.ts:760-788. Feasibility gates, in order: (1) the prayer-points ledger. The three
fights (TGV, the Grand Tree, Fight Arena) spend the same points in either order, but the order decides
which fight runs short if the total is tight, and no document states today's total at Prayer 99
(pre_mm_fights.md:191's '115-125 needed against 43' is the old plan). rs/158 should settle it before
anything is built. (2) Fight Arena at Magic ~59-64 instead of ~73: its fights are cast-bound and its
monsters have no magic defence (rs/185), so accuracy should hold, but S12 is lab-accepted at its
current levels and must be re-run. (3) The kit: H7's death and air runes (STEP-MANIFEST.md:3127) and
H9's kit must reach SCORED before S12, so H9 moves to Servil and H7 shrinks. (4) The Servil-to-Elkoy
walk passes near the Battlefield of Khazard; measure it on the browser. Acceptance: the seam chain
(S09's end, the walk, S12 A-K, the walk, S10b A) 3x on the browser at 400 ms, with S12 within its
expected and both new walks measured.

**Item 5: S09's probe seeded from S07's verdict (attempt 5).** The Mining module creates its own
in-page gate on its first auto start (speedrun/skills/mining.ts:1041, `shared.gate =
deps.inPageGate(...)`), and with an empty history the gated program probes on `start`
(speedrun/lib/gated-program.ts:196-199), 20 trials costing 29 ticks (rehearsals/mining.md §1). S07's
knife loop ends ~596 ticks earlier on the same page with a fresh verdict. The change is to carry S07's
last verdict, with its tick, through the chain into Mining's gate as seeded history under a freshness
bound (for example, younger than ~1,000 ticks and no catch-up alarm since). The existing slip rule
(gated-program.ts:196, `slip`) stays the guard: the first knife slip re-probes. Acceptance: the lab
seam (S07's last load, T07-08, S08 stubbed or skipped, T08-09, S09's first 100 ores) 3x with the seed
showing 0 start probes and the band starting within ~3 ticks of arrival, and a control with the host
forced unsteady showing the slip re-probe firing and the band falling to plain as today.

**Item 9 with item 10: one trade where there are two (9c is attempt-4 eligible).** H9 and H10 are
both served by the west carrier at the same Ardougne landing (speedrun/runner/legs.ts:440-449),
~600 ticks apart. Neither is priced in any row today, so the expected understates by ~8-10 i. Move
H10's law 5, water 5 and air 3 into H9's row in STEP-MANIFEST's ledger and keep H10 as the
`shark to 8` top-up alone. When S12 eats no shark (0 in rs/379's and rs/401's measured runs), SCORED's
hand-off finds every top-up met and makes no trade (speedrun/runner/handoff.ts:551-553), so H10 costs
0 ticks. When S12 does eat, H10 still tops the sharks up, as today. For 9a, H4p's rune pickaxe and
log can ride H6 at Edmond (the same carrier) if S08's slot precondition (plague-city.ts:898,
`slots('A')`) allows 2 more slots and Mining's own H4p receive (mining.ts:514-536) accepts a kit
already held. Acceptance for 9c: the slot ledger test with the merged rows, then T11-12, S12 stubbed
and T12-13 1x in the lab, H10 reporting `ticks: 0` with the sharks met and a real trade with one shark
removed.

**Item 4: pricing Crafting 30 before S13 (attempt 5, a measurement first).** rs/185 prices the
gross at ~119 (B ~96 and I ~23 at the formula rates: railings.rs2:78, mcannon_broken_cannon.rs2:90-97)
and leaves the ~534 base xp unpriced. There is no idle SCORED window in S08-S12 to hide it in, so it
is a block of its own, and the one measurement that decides it is the level-up cost. Crafting 1 to 30
crosses ~29 levels, and each one stops a make batch. Run a lab session on the browser at 400 ms: a
fresh account at Crafting 1 receives soft leather, needle and thread, crafts to 30 with crafting.ts's
batching (or the cheapest item ladder the content allows), and logs ticks per level. Adopt it only if
the session plus its receive comes in under ~100 ticks, which makes the net at least ~+19. If it does,
the row is a new step at H10's Ardougne landing before T12-13's run, and S13's B and I re-price at
Crafting 30 (rs/185's lab: 3 browser runs).

## 4. Checked, and not avoidable

- **Waits on the west carrier (H6-H10): 0.** Each carrier's first row is prepared before SCORED logs
  in (run.ts:707-713; tonight's resume line shows H6 on h55 prepared at 01:04Z), and every later row
  is prepared the moment the previous one is served (delivery-owner.ts:131-134, `served`). rs/41's
  lab times to ready from the previous stand (H6 77, H4p 100, H7 145, H8 280, H9 235, H10 61 ticks)
  are each far inside SCORED's window between the rows: ~452 i before H4p (S08 + T08-09), ~3,200
  before H7, ~900 before H8, ~1,350 before H9 and ~530 before H10.
- **Trade starts: at the floor.** Mule carriers pre-request by default (mule.ts:1193, `preRequest: o.preRequest
  ?? true`; :1792-1806), and no carrier config overrides it (no `preRequest` in carriers-gen or the
  runner), so SCORED's click opens the trade on the tick it lands. S04's +1 a trade under
  `preRequest: false` (RUN-ORDER.md:388) does not apply here.
- **Cue latency: ~0.** The cue watcher is fs.watch plus a 20 ms poll (altar-cue.ts:767, rs/41), and
  CueKeeper's beacon wait (cue-keeper.ts:168, up to 10 ticks) is met from frames already held.
- **Step boundaries: 0 m** (#92), and the pre-step checks are state reads that cost 0 on a pass
  (step.ts:212-218, :252-263).
- **Bank visits: none** in any step or leg of the band (rs/185; the explorers' reads of each module).
- **The Daconia root (S11b P):** not knowable (above), and the search order is optimal.
- **S11a mid-lap stop:** level 25 is crossed only on the lap's last obstacle (24 to 27 at +54,
  rs/611), and the in-page program already ends the step on the level-up tick (agility.ts:524).
- **T07-08's Camelot teleport:** the Ardougne teleport needs Plague City complete, so the leg into it
  cannot use it.
- **The forced walks:** the Grand Tree's B to Hazelmere, TGV's maze, and Plague City's P-Q-T and X are
  fixed by stage gates and closed spirit trees (rs/185). The Grand Tree's T11a is 36 m on the only
  path.
- **The cast-bound fights:** TGV's warlord and Fight Arena's G, H and I are already on Fire Blast;
  Fire Wave needs Magic 75 (rs/185). The spell re-click every 2 ticks (combat.ts:181, :330) against a
  5-tick cast was checked as a lead: a click sent during the cast's delay re-targets without adding a
  tick as far as the code shows. One trace comparing attack clicks with runes spent (both logged in
  the fight reports) would close it.
- **S14's set-up, reloads and pick-up:** set-up is at its measured 8-9-tick floor (lib/cannon.ts
  :160-240), reloads never block firing (cannon.ts:317-325), and the pick-up is needed because the
  cannon decays (cannon.ts:45) long before S27.
- **S09's exit drops:** one batch, 0-1 ticks (mining.ts:539-570; MR's one drop tick).
- **T11-12's drop burst (2 m):** five drops fill the 5-packet tick, so the teleport cast cannot share
  it.
- **T13-14 from a cold Deserted Keep region (+27, a sensitivity, not in the expected):** no warm-up is
  possible without a login in the keep.

## Sources

RUN-ORDER.md rows 397-413 and section 6 (lines 653-728) at this branch's base;
STEP-MANIFEST.md's ledger rows H4p, H6-H11r (lines 3120-3143); rs/185's two audits (cited above);
rs/41's helper-side input to rs/651 (19:0x PDT); run-transitions.md (doors, lines 363-378; legs,
78-105); helpers/cannon.md (lab trades, 211-235); the code at main 1e536f76 as cited inline.
