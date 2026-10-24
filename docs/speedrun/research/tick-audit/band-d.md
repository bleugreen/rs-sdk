# Tick audit, band D: S21-S27, legs T20-21 to T27-17, hand-offs H17-H23

Read-only audit (rs/653, under rs/158) for main's attempt-4 pick (about 15:00Z on 10-24) and the
attempt-5 queue. Row by row, it asks what the expected column pays that engineering could remove,
with the best column as the yardstick. It changes no code, no test and no canonical document.

Labels: **m** measured (the run is cited), **r** read from source (file:line), **i** inferred (the
arithmetic is shown), **e** estimate. 'Lab-accepted' means a step module, or shared code under one,
that has passed its lab acceptance and is on main. Main's rule for attempt 4 applies to it: nothing
changes such a module without its own lab pass before staging. Code citations are at main 1e536f76.
Owners: rs/186 (skills and runner), rs/185 (quests), rs/41 (helpers), rs/158 (rows).

**Tonight's live data.** The attempt-3 rehearsal reached S07's end at about 02:01Z (Prayer 99 at
playtime 7,942, host 02:01Z), with S08-S20 still ahead at ~3.5-4 h on tonight's slow ticks (host
01:45Z). It will not reach S21 before this audit's 05:00Z deadline, so no band-D line exists yet.
Every figure below comes from the documents at this branch's base and the labs they cite. When the
rehearsal's lines land, check these rows first: S21's relog and first trade, H17e's wait, S22's
band-start probe, T22-23 and L24a/b against their open-door figures, S25a's turnarounds with a01
on the run machine, and H23's arrival.

**Rows already audited by rs/185** (cairn://p/rs/185/1/coordinator/task/tick-audit-dc, Dragon
Slayer S1-S7) are cited, not re-derived, and marked 'rs/185'.

## 1. Rows in scope: expected, best and the gap

| Row | Expected | Best | Gap | What the gap is, and what removes it |
|---|---|---|---|---|
| T20-21 (body route, in force) | 70.3 m | 70.3 m | 0 | inside the body delta (+143.0 / +143.0): rs/589's browser run on the body route, 68.3 without the drops and 70.3 with (bursts 3/3/3). The 3 drop ticks are removable: item 13 |
| Relog before S21 | +2 i | +2 i | 0 | needed for the tuned order (R12). Its logout tail, ~1.6 i (46/29, WINE), is not priced: the run-wide tail line covers only the two planned relogs (section 6). Removing the relog: items 10 and 12 |
| H17 (the 22-giver ramp) | 0 | 0 | 0 | off SCORED's clock: the pre-login step is `offline: true` and runs between the confirmed logout and the login (runecraft.ts:694-699; chain.ts:723-737, :808) |
| S21 (body) | 1,136 i + 143.0 | 1,136 i + 143.0 | 0 | priced at 194 crafts; the run needs 193 (re-price R1). Within the step, the craft count (item 1) and the fault ladder's bad case (item 9) are the levers |
| H17e | 4 i | 4 i | 0 | the runes-only trip (altar-giver.md:72-78). It can carry H18 and H19 too: item 7 |
| T21-22 | 34.0 m | 33 m | 1 | the teleport's landing tile (random within Chebyshev 2, teleport.rs2). Not removable |
| S22 | 1,995 m | 1,969 m/i | 26 | catch luck: the best is a faster run. Both columns carry a 39-tick band-start probe, which is removable: item 2 |
| H18 | 5 i | 5 i | 0 | priced for '2 stacks' (section 6); the row is now 16 items (ledger H18), so 5 i is low by ~2-3 i (re-price R6). Removable by merging: item 7 |
| T22-23 | 24 m | 15 m | 9 | Lumbridge Castle's three doors, closed on arrival. A helper can open them: item 4 |
| H19 | in S23 (unverified) | | | section 6 says 'in the quests'. The H18-to-H19 carrier move is an unmeasured route (STEP-MANIFEST.md:2679-2680). Removable by merging: item 7 |
| S23 | 12 m | 12 m | 0 | at its burst floor |
| T23-24 | 98 m | 98 m | 0 | but 8 over lite's 90: the browser's settle, a walk re-send near (3003,3358) and the client's own corridor from (3006,3289) to (3026,3270). Item 8 |
| H20 | in S24 | | 0 | h03 is prepared at the run's start and is ready 214 ticks later, long before T23-24 (STEP-MANIFEST.md:2681-2689, m rs/551) |
| S24 | 492 m (browser, n = 1) | 475 m (lite, fastest) | 17 | the client (a browser figure against lite's fastest) and n = 1. Romeo and Juliet runs 274 on the browser against 265.3 on lite (Juliet's doors). A browser n = 3 re-measure settles the pricing; item 15 is the one code tick |
| S24 legs | 137.3 m | 124 m | 13.3 | doors: L24a 72 closed against 65 open, L24b 60 against 54, L24c landing 0.3. Item 4 |
| T24-25 | 13 m | 13 m | 0 | a short walk |
| S25a | 940 | 903 | 37 | the expected prices the scripted stand-in (1,065), the best the real helper (1,028), both less 125 for Superheat. a01 runs on the run machine (helpers.json's cue-gated list, host 08:5x PDT), so the real helper's figure applies: re-price R2 |
| S25b | 0 | 0 | 0 | inside S07; the booth path is a fallback only (prayer.ts:1-7) |
| S25d (leather, in force) | 263 m | 263 m | 0 | the +172 delta in both columns; the diamond basis's 91/85 is history |
| S25e | 191 m | 191 m | 0 | 167 m + the herb mix's 24 m (rs/302) |
| S25c | 81 m | 77 m | 4 | repetition spread (77 / 85 / 81, rs/339). No lever |
| H21d + H21e | 10 i | 10 i | 0 | one trade (8 m) plus one deposit (2 i) |
| T25-26 | 41.5 m | 41.5 m | 0 | a walk |
| S26 | 1,338.3 m | 1,299 m | 39.3 | Elvarg's fight draw (L: 168 / 88 / 166 / 106 / 78) and B's Guildmaster stall. rs/185 S4 re-prices L; S1-S3 shorten the fights |
| T26-27 | 180 m | 178 m | 2 | walk and web noise (rs/589: 179.7 without the drop, 182.3 with) |
| H23 | 8 m | 8 m | 0 | h92 is waiting on its serve at the Ardougne landing (rs/41, 18:48Z: 'serve-waiting at 2658,3301'), so no arrival wait is expected; `arriveTicks` has never been recorded on a runner lab |
| S27 | 1,972 i | 1,946 i | 26 | the bow windows' measured spread (best: the 85 window at its upper end, 20.85) |
| T27-17 | 185.7 m | 185.7 m | 0 | run only (185 / 186 / 186) |

## 2. Candidates, ranked by expected ticks saved

'Bound' rows have a ceiling but no sign or expected yet; they sit at the end. 'Attempt 4?' applies
main's rule: yes only if the item touches no lab-accepted module, or its own lab can pass before
staging.

| # | Item | Step | Ticks saved (expected / bad case) | Label and citation | Build (h) | Risk to a lab-accepted module | Owner | Lab needed | Attempt 4? |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **28-essence loads from resident givers.** Today each giver carries its talisman and 27 essence, a full pack (altar-giver.md:72), so a load is 27 (runecraft.ts:99). Givers that live in the room without a talisman and are restocked by outside carriers could hand over 28 | S21 | **49 / 49** | i: 5,204 essence (R1) / 27 = 193 crafts, / 28 = 186 crafts; 7 crafts x 7 = 49. runecraft.md:261-268 prices the same idea at -42 on the nature route. SCORED drops its rune stack on T+5, inside the trade-request packet (runecraft.md:265-266) | 16-24 e | **high**: runecraft.ts (RCM) and altar-giver.ts | rs/186, rs/41 | a resident body roster, 30 cycles at 400 ms with real restock, plus a login-count check | no (attempt 5+) |
| 2 | **S22's band-start probe seeded, not re-run** | S22 | **39 / -20 e** | m: the probe costs 39 on the lab's fly78 run and on the demo (rehearsals/fishing.md:78-79, :109, :195); 'every probe is on the account's clock' (gated-program.ts:134); it fires on `start` with an empty history (gated-program.ts:196-199). Bad case e: a stale verdict runs the knife on an unsteady host until its first slip re-probes | 3-4 e | **high**: fishing.ts and gated-program.ts | rs/186 | the S21-end to S22 seam 3x with the seed, plus a forced-unsteady control (~2 h) | no (attempt 5) |
| 3 | **Super attack and super strength for Melzar, the demon and Elvarg** (rs/185 S1) | S26 | 30 / ~0 | i, rs/185. Needs 2 of H22's 10 sharks (the pack is at 0 spare at C) | 3 + supply | med: dragon-slayer.ts | rs/185, rs/41 | G x3 and L x3 on lite, L on the browser | if its lab passes |
| 4 | **Leg doors opened ahead by a helper** (the band-B role, item 7 there; doors revert 500 ticks after opening, `~open_door(500)`) | T22-23, L24a, L24b | **22 / 0** | m: closed against open on the browser: T22-23 24 against 15 (9), L24a 72 against 65 (7), L24b 60 against 54 (6). Bad case 0: a late opener or another player closing a door leaves today's state | 5-6 e | **low**: no step module. A light role, plus a cue in legs.ts or chain.ts | rs/41 (role), rs/186 (cue) | each leg 3x on the browser with the opener, `doorOpens` 0 (~2 h) | **yes**, if a login is free. Item 7 frees mule1 for T22-23 |
| 5 | **The Duke after the ship** (rs/185 S2): J walks from the castle to Ned | S26 | 18 / 8 | i, rs/185 (duke_horacio.rs2:4, ned.rs2:226; the module already runs this path on its death return, dragon-slayer.ts:857-871) | 3 | med: dragon-slayer.ts | rs/185 | a G-K chain on lite, F and J x3 on the browser | if its lab passes |
| 6 | **Offensive prayers on Melzar and the demon** (rs/185 S3) | S26 | 15 / 0 | i, rs/185. Net negative without a prayer potion | 1.5 | med: dragon-slayer.ts | rs/185 | G x3, L x3 | no |
| 7 | **H18 and H19 ride S21's runes-only hand-back trip** (t19 carries 20 items in place of 3) | S21 / S22 / S23 | **~8 / + the H18-to-H19 transition cliff** | i: two trades' open and confirm overhead removed, ~4-5 each (H18 priced 5 i; RT§3's 4-8 a trade). The offer ticks stay (20 offers at 5 a tick, 4 ticks, against today's 1 for the 3 runes, so +3 on H17e). Net ~8. Bad case: mule1's H18-to-H19 move is an unmeasured route (STEP-MANIFEST.md:2679-2680) and disappears | 4-6 e | med: runecraft.ts (`S21_HAND_BACK`, runecraft.ts:130-131, and its `holdsHandBack` postcondition), altar-giver's hand-back withdrawal | rs/186, rs/41 | S21's last 3 crafts and the hand-back 3x on the browser, then S22's and S23's preconditions | no |
| 8 | **T23-24 on SDK waypoints** (a `via` on the run hop at the divergence) | T23-24 | ≤7 / 0 | i: 98 browser against 90 lite less the settle's 1 (RUN-ORDER T23-24; `via` at travel.ts:495; the reach-20 click lets the client choose its corridor, travel.ts:500-505) | 3-4 e | low: one legs.ts row | rs/186 | the leg 3x on the browser | **yes**, if its lab passes |
| 9 | **S21's fault ladder re-tunes after a clean robust stretch** | S21 | **~0-10 e / 193 i (robust) to 386 i (stock)** | r: a robust restart is permanent for the band, and a second fault moves to the 9-a-cycle stock rung for the rest (runecraft.ts:913-945, :932-940). i: a fault at the first craft costs 193 x 1, or 193 x 2 on stock. The expected depends on the demo's fault rate, unmeasured for 193 turns (S06's 7 turns and rs/196's 20-cycle demo had none) | 3-4 e | **high**: runecraft.ts (RCM) | rs/186 | a forced-fault lab: two failed turns, then the re-tune, 3x | no |
| 10 | **S21 moved to just after S25c's second planned relog** (drops S21's own relog). The 22 givers ramp during S25a (~940 ticks against a ~3.5 min ramp, rs/41) and are in the world before relog 2's login | S21 / S25 | **~0-9 / 46 + 117** | e. Saved: the relog's 2 i and its unpriced ~1.6 i tail; legs ~-5 e (today T20-21 70.3 + T21-22 34 + T25-26 41.5 = 145.8 m; after: S20 to the river ~34 i (T21-22's cast and run), Varrock west booth to the body ruins ~71 e (~133 tiles at 0.51 + the talisman 3, unmeasured), the room to the guild ~35 e (Varrock teleport + ~60 tiles)). Cost: the body talisman cannot be held through S25 (S25a, S25d and S25e need full packs, S25c peaks at 28), so one giver meets SCORED at the ruins, +5 i. Bad case saved: the 46-tick logout tail (WINE) and the unconfirmed-logout sensitivity (117, rs/310) leave S21 | 8-12 e | med: chain.ts order and legs.ts rows (no module code) | rs/186, rs/158, rs/41 | the two new legs 3x on the browser; one S25c-to-S21 chain lab with the ramp under relog 2 | no |
| 11 | Plank mesboxes and the reward loop (rs/185 S6, S7) | S26 | 4 / 0 | i, rs/185 | 1 | med: dragon-slayer.ts | rs/185 | I x3, L's end | no |
| 12 | (alternative to 10) **S06's air givers become 7 of the 22 body givers**, so all 22 log in before SCORED's first login and S21 needs no relog: 22 + 17 roster + SCORED = 40, under 45 a public IP (24 + 22 + 1 = 47 today) | S21 | ~3.6 / 46 | i: the relog 2 + tail 1.6. Against it: the givers idle ~2.5 h in the world, and one disconnect wave (nine clients at 23:17Z tonight, host) puts every relogged giver behind SCORED on the 8-tick robust schedule, +1 a turn | 6-8 e | med: altar-giver roles and the launcher | rs/41, rs/186 | a 2.5-hour idle hold of 22 givers on the demo, then 30 tuned cycles | no |
| 13 | **S21 entry in one burst before the relog's logout**: the rod, the rune leftovers and the talisman dropped in one tick in the room, and the walk to the stand, both before the logout. After the login, no scene wait when SCORED is already on a known stand tile | T20-21 / S21 | **~3 / 0** | i: T20-21's measured drop burst 3 (rs/589) plus the talisman drop after the login (runecraft.ts:855-858, :888-899: at least 1 tick), less 1 for the merged burst; plus 0-2 e for `enter()`'s altar wait (runecraft.ts:869-876; the body stand is `null`, runecraft.ts:80). Supersedes the known rod lever (-1) | 3 e | med: runecraft.ts (RCM), legs.ts's T20-21 drops | rs/186 | T20-21 and S21's first 5 cycles 3x on the browser | no |
| 14 | **S27's cannon left placed** (`pickUp` off for S27; the postcondition already accepts it, ranged.ts:795) | S27 | 1-3 / 0 | m: S14's pick-up +1 (rs/199); i: up to ~3 with the slot clicks. SCORED keeps the set after H23 either way (rs/41, 16:2x PDT) | 1 | med: ranged.ts (RG) | rs/186 | S27's end 1x | if its lab passes |
| 15 | **D9's settle: let L24b's first click close the last page** in place of two quiet ticks (druidic-ritual.ts:219-224, `quiet >= 2`) | S24 | 1-2 / 0 | e | 1 | med: druidic-ritual.ts | rs/185 | D9 and L24b 3x on the browser | no |
| 16 | **Dead items handed into the next trade, not dropped**: T26-27's hammer into H23's offer | T26-27 | 1 / 0 | m: T26-27's burst 1 (rs/589). Needs h92's serve to accept an unasked item | 2 e | med: cannon.ts serve, legs.ts row | rs/41, rs/186 | T26-27 to H23 3x | no |
| 17 | H18's logs trimmed from 10 to 6 | S22 | ≤1 / 0 | i: 1,995 / 513 = 3.9 logs used (m, rs/195's 1 per 513 knife ticks); 4 fewer offers is at most one offer tick | 0.5 | none (ledger) | rs/158, rs/41 | none | yes |
| B1 | **Bow on Longrange through the Defence phase** (Rapid trains no Defence; the module has no Longrange phase, ranged.ts:165-182) | S27 | bound ≤60 i, sign unknown | i: 214 Defence ticks x ~6 more Ranged a tick (bow 18.24 at 70 against cannon 12.30 at 55, levels mismatched) / ~20 a tick. Against it: Longrange's slower attack and the split xp | 4-8 e | high: ranged.ts (RG) | rs/186 | a Defence 98-99 window on Longrange 3x | no |
| B2 | **Cannon top-up every 30 ticks, not 20** (`RELOAD_EVERY` 20, lib/cannon.ts:44; a load is 30 balls, :42) | S27 | bound ≤33 i, likely 0-10 | i: 1,972 / 20 = 99 top-ups against 66; each costs at most the tick's one interaction (ranged.ts:523-556), and many fall on free ticks. Dry risk at 1 ball a tick | 1 | med: lib/cannon.ts default (S14 shares it) | rs/186 | dry events and attack gaps at 20 and 30, 400 ticks each | no |
| B3 | One make per item in S25a, so level-up pages open between items | S25a | bound ≤12 i, likely ≤0 | i: on the route from Smithing ~55 the measured excess per trade is about 3, 2, 2, 2, 1, 1, 1, 0 over the floor (anvil.md:111-114). rs/197 traced it to an engine floor (anvil.md:115-122), and clicking the dialogs through changed nothing | 2 | high: smithing.ts (SM) | rs/186 | 5 trades at Smithing 55 | no |

**Re-prices (the row is wrong; the run is not slower or faster).** These move the figure, not the
clock, and cost no build.

| # | Row | Change | Label |
|---|---|---|---|
| R1 | S21 | **-7 / -7**: 194 crafts become 193. The 194 counts from the level-44 threshold (21,172 game xp, lib/xp.ts:14-22): (998,458 - 21,172) / 25 / 202.5 = 193.04, so 194. S21 starts at S06's end, 7 crafts of 26 air = 910 base = 22,750 game, the value host read on SCORED tonight (Runecraft 44 at 22,750, host 16:22 PDT). (998,458 - 22,750) / 25 = 39,028.3 base / (7.5 x 27 = 202.5) = 192.73, so **193 crafts, the last of 20 essence**. Staging (5,238, altar-giver.md:127) is 27 over the need, harmless. The hand-back still finds t19 by its status, not its slot (altar-giver.md:75-78) | i |
| R2 | S25a | **-37 expected**: price the real helper (1,028 m, rs/188's HS5), as the best already does; a01 runs on the run machine. The run-machine demo cost (anvil.md:126, unmeasured) belongs in section 6's allowance, as for every other helper | m |
| R3 | S26 | **-9.7**: L at the pooled 11 runs, 111.5, in place of the browser five's 121.2 (rs/185 S4) | m |
| R4 | S24 | none until a browser n = 3: today's 492 is n = 1 | m |
| R5 | Relog before S21 | **+1.6**: its logout tail (2 + 46/29 a relog, section 4) is unpriced | i |
| R6 | H18 | **+2 to +3**: 16 items take 4 offer ticks at 5 a tick (RUN-ORDER.md's user-action cap, fold-in 31), not the '2 stacks' the 5 i was priced on | i |

**Known levers, status.**

| Lever | Status |
|---|---|
| S25e herb mix | in force at +24 m (rs/302, 191 against 167); a hand-tuned mix saves at most ~8 (STEP-MANIFEST.md:2448). Attempts 2-3 replan on the better herbs (rs/387) |
| S25d gems against leather (diamonds ~+198) | diamonds unobtainable; the leather route is in force at +172 (263 m, rs/359). Markets' bid for 8 diamonds at 7,000 is unfilled tonight (markets 23:45Z), and those would go to S04 first |
| S26 rune scimitar | no sellers; the h61 bid stands. An upside only |
| S26 walked legs (no glory) | not a lever: no castable teleport closes D, E or J (rs/185 premise 3) |
| S27 bow from Defence 99 | **done**: `FINISH.bowFrom` 50 (ranged.ts:143, :148-151), -25 against bowFrom 70, already in the row |
| T20-21 rod drop (-1) | superseded by item 13 (~3) |
| T23-24 browser route (98 against 90) | item 8, ≤7 |
| Runecraft 7-tick against 8-tick, and the stock fallback | 7 is the expected and the relog buys it. Only the bad case is open: item 9 |
| Smithing anvil restock | 0 on SCORED's clock: the helper restocks in 14 ticks against ~25 of smithing, staged 11-20 before the screens open (anvil.md:104-109). The 42-tick bank cycle is the fallback if the helper fails |

## 3. Five items a builder can start from

**Item 2: S22's probe seeded (attempt 5, with band B's item 5).** `fishing.ts` builds its own
in-page gate for the fly 78-99 band (fishing.ts:13-15, :29), and with an empty history the gated
program probes on `start` (gated-program.ts:196-199). Twenty trials cost 39 ticks on the account's
clock (rehearsals/fishing.md:109, :195; gated-program.ts:134). Band B proposes the same change for
S09, carrying S07's verdict forward. One shared change serves both: a gate history passed through
the chain, accepted under a freshness bound, so the first knife slip (the `slip` re-probe,
gated-program.ts:196) stays the guard. S22's nearest earlier verdict is old (S09's, many thousand
ticks back), so for S22 the honest form is to start the knife with the history seeded 'on' and lean
on the slip rule and the measured switch-off (`MEASURE_DROPS` 120, fishing.ts:73). A cheaper
variant is a 10-trial start probe (about half the 39, at lower power). Acceptance: the S21-end to
S22 seam 3x on the browser with 0 start probes and the band starting within ~3 ticks of the H18
trade, plus a forced-unsteady control showing the slip re-probe firing and the band falling to plain
as today.

**Item 1: 28-essence loads (attempt 5+, the biggest S21 number).** The load is 27 because a giver's
talisman and 27 essence fill its pack (altar-giver.md:72), and SCORED's precondition reserves the
rune stack's slot (runecraft.ts:621-624). There is no tiara in this content (a search of
server/content for 'tiara' finds nothing), so a giver that re-enters must carry a talisman. The
design: 22 resident givers enter once, drop their talismans and never leave. Outside carriers, on
bbs because they need no tick-exact timing, trade each resident up to 28. SCORED drops its rune
stack inside the T+5 trade-request packet (runecraft.md:265-266), so the cycle stays at 7. 193 crafts
become 186 (-49 i). The costs are a second tier of ~23 carriers, the 80-login and 45-per-IP caps
(residents and roster on the run machine are ~40; carriers go elsewhere), and a new helper
choreography. Acceptance: 30 tuned cycles of 28 at the body altar at 400 ms with real carrier
restocks, every gap 7, and a login census under both caps.

**Item 4: door openers (attempt-4 eligible).** Doors revert 500 ticks after they are opened (band
B, item 7). T22-23 crosses Lumbridge Castle's three doors (24 closed against 15 open, m). L24a
(72 against 65) and L24b (60 against 54; the doors at (2958,3506) and (2958,3509)) follow within
~300 ticks of each other. If item 7 removes H18 and H19, mule1 is free at the river and can open
the castle doors on a cue at S22's end, with no new login. A second light opener covers
L24a and L24b, timed off S24's Goblin Diplomacy start. The change: a role that walks a door list on
a cue and reports each door's state, plus a cue in legs.ts or chain.ts. No step module changes.
Acceptance: each leg 3x on the browser with the opener, the leg's `doorOpens` 0, and the leg at
its open-door figure.

**Item 7: H18 and H19 on S21's hand-back trip.** After S21's last craft SCORED holds the body-rune
stack and nothing else (S21 is at 28/28 with the talisman dropped; rs/158, 02:02Z), so 27 slots are
free. H17e's runes (3 stacks), H18's rod, feathers, 10 logs, knife and runes (16, the rune stacks
shared) and H19's egg, milk, flour and water rune (4) come to 20 items, with 7 left free for S22's
fish and drop. t19 carries its talisman plus those 20, so the trip fits. The change: H17e's ledger
row gains H18's and H19's lines, and `S21_HAND_BACK` (runecraft.ts:130-131) reads that row in place
of a constant. Then t19's launcher `handBack` list grows (altar-giver.md:118), and chain.ts drops
the H18 and H19 placements (chain.ts:236-237). rs/41 stages t19's bank from mule1's two packages.
Acceptance: S21's last 3 crafts, the hand-back, S22's precondition and S23's kit check, 3x on the
browser, with the trade's offer ticks recorded (4 expected).

**Item 9: S21's re-tune (bad-case insurance).** The ladder (runecraft.ts:913-945) turns a
`turns-failed` fault on any tuned giver into `forceRobust = true` for the rest of the band (:932-935),
and a second fault into the stock rung (:937-940). On a 193-craft band a transient demo stall early
on costs up to 193 (robust) or 386 (stock), and tonight's demo had a 117-tick minute (rs/83).
The change: after the robust restart, a giver that logged in before SCORED's current login
goes back to tuned after k clean robust turns (k ~ 10), at most twice a band. The per-giver
`isDemoted` rule (runecraft.ts:847-848) stays. Acceptance: a forced-fault lab (two failed turns
injected at craft 5) shows the restart, the re-tune at craft ~15 and 7-tick gaps after it, 3x.

## 4. Checked, not avoidable

- **S21's 7-tick cycle.** Every tick in the room is the craft's `p_delay(3)` or the trade that
  refills it (runecraft.md:278-279). The 7 is the floor of the trade and craft packets on predicted
  ticks (runecraft.md:27-28).
- **The 27 load with talisman-carrying givers.** It is bound by the giver's pack, not SCORED's
  (altar-giver.md:72), and there is no tiara in the content. Only item 1's resident design moves it.
- **The 22-giver ramp (H17).** It costs 0 on SCORED's clock (runecraft.ts:694-699, offline). rs/41's
  '<= 300 wait' is the `giverWaitTicks` bound (runecraft.ts:963), not an expected wait.
- **The relog before S21.** It is needed for the tuned order: one machine is one address bucket, and
  a relog re-appends SCORED at the tail (section 4). Only items 10 and 12 remove it.
- **The nature altar.** The body altar costs +143.0 against nature, but the no-glory nature legs
  need ~52 givers (rs/163), over the 45-per-IP cap. That is supply and roster, not engineering.
- **T20-21's route.** The Falador teleport plus a 62-63-tick run is the shortest: the Varrock
  teleport lands farther from the ruins, and a walk from (2820,3487) is ~230 tiles (i).
- **T21-22's 1** is the landing tile. **L24c** at 4.5 is minimal.
- **S22.** Its level-up pages are answered in the page (fishing.ts:21-22). Six spot moves are
  inside the band (rehearsals/fishing.md:124-125). The feather margin enlarges the trade, not the
  clock (fishing.ts:76).
- **S23** is at its burst floor (12 = best).
- **S24.** The fresh prison door (27 against 24) is the route's case: SCORED is first through. The
  quest order alternative is ~126 against today's 123 (a walk model at 0.51 ticks a tile, i).
- **S25a's helper half** is at its floor (anvil.md:107-109). The trade-open lag after a level
  crossing is an engine floor (anvil.md:115-122).
- **S25c.** Its relogs are fixed by the wine mechanic, and its order (last) is forced by slots: the
  windows run at 27 items, and S25e needs 28 free. H21c cannot join H21d + H21e, because 520 noted
  wines would take a slot through S25a.
- **S25d's 37 visits** are forced: the needle and thread take 2 slots, so loads are 26 bodies
  (crafting.ts:49-51), and 928 / 26 = 35.7, so 36 loads plus one stow visit.
- **S25e's 41 page ticks.** A load costs (level-ups - 1). Splitting a load that crosses u levels
  into u loads adds u - 1 booth visits at ~4 ticks each to save u - 1 pages at 1 each, a net loss.
- **H21a and H21d + H21e** have different givers (the anvil helper and the booth trade giver). The
  ~2 i deposit exists because notes must be banked before use (herblore.ts:8-10).
- **T25-26, T26-27 and T27-17.** These are walks. Spells are refused above Wilderness 20
  (travel.ts:14-16), and the spiders sit at level 37. T26-27's web needs a cut either way.
- **H23** cannot join H22: S26 starts at 0 spare at C. h92 waits at the landing, so its trade is
  the whole cost.
- **S27's ranging potions** (none held; rs/186 measured 0 difference) and **bowFrom 70** (25
  slower; the default is already 50).
- **S26's walks D, E and J** have no teleport (rs/185 premise 3).

## 5. Open measurements

1. H23's `arriveTicks` from a runner-driven lab, to confirm that h92 is already waiting at the landing.
2. S27's per-phase rows (`PhaseRow`), to size the Hitpoints tail and the set-up, and to price B1
   and B2.
3. The walk from the Varrock west booth to the body ruins, which item 10 needs before it can be
   ranked honestly.
4. Tonight's rehearsal lines for every row in section 1, when the rehearsal reaches S21.
