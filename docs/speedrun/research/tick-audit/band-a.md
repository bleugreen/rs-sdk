# Tick audit, band A: S00-S07 (S25b inside S07), legs T01-02 to T07-08, hand-offs H1-H4k

Read-only audit for rs/158's tick-audit mission (cairn://p/rs/650), against the run commit 1e536f76
and RUN-ORDER.md v2 as on main. The question for every row: what does the **expected** column pay
that the **best** column, or a better design, does not, and what removes it. Nothing here changes a
row; the pricing corrections at the end of section 1 go to rs/158's next fold-in only if main takes
them.

**Labels.** m = measured (the run and source are cited); i = inferred from measured rates (the
arithmetic is shown); e = estimate. **Sources.** Demo figures come from tonight's attempts, as host
reported them on cairn://p/rs/host and cairn://p/rs/main:

- attempt 2 (19:23Z): S00 9, H1 6, T01-02 51, S02 17, T02-03 51, S03 649; then a resumed session with S04 228 across a staging fault, S05 17, S06 61, H4k 6, and the normal band 22;
- attempt 3 (21:35Z): S00 8, H1 6, T01-02 58, S02 19, T02-03 51, S03 661, S04 199, T04-05 46, S05 18, T05-06 68, S06 67, T06-07 76, H4k 6, and the normal band 22;
- attempt 3's resumed oak band ran plain: 805 ticks for WC 38-73;
- T07a 58;
- the rehearsal willow band on 1e536f76 took 3,505 ticks for WC 73-99.

The demo ran ragged tonight, 124-145 ticks a minute from about 22:45Z. A figure taken in that
window says so. Code is cited as file:line at 1e536f76 unless stated otherwise.

**Lab-accepted modules** (main's rule: nothing in this list changes for attempt 4 without its own
lab pass before staging):

- `skills/magic.ts` (S02 and S04), `skills/firemaking.ts` (S03), `skills/runecraft.ts` (S06) and `skills/woodcutting.ts` (S07, at rs/642's 1e536f76);
- `quests/dorics-quest.ts` (S05);
- `helpers/mule.ts` with the delivery engine (#482, #487), `helpers/bone-giver.ts` and `helpers/fm-row.ts`;
- `runner/legs.ts`, with `lib/travel.ts` under it;
- `runner/chain.ts`;
- the in-page `knife-cycle.ts` (a webclient bundle change, so it needs a rebuild).

## 1. The table, ranked by expected ticks saved

Engineering and design candidates come first. Pricing corrections, where a row is wrong today with
no build needed, are listed after them so they are not counted as savings. Items marked
**known** were already on someone's list; their status is given.

| # | Item | Step | Ticks saved (expected / bad case) | Label, citation | Build (h) | Risk to a lab-accepted module | Owner | Lab needed |
|---|---|---|---|---|---|---|---|---|
| 1 | **Gate the burying bands between knife + bury and plain + bury, switching on the measured rate with no up-front probe** (known in part: rs/186 filed the plain + bury fallback for attempt 4 at main's 00:2xZ ruling, unbuilt). Section 2 explains the willow band's +1,100. | S07 oak 15-73 and willow 73-99 | **~110 / ~1,390** | e expected: P(a ragged S07) ≈ 0.25 (rs/102's overnight series, 6 of 24 samples simmer or severe) x ~500 saved when ragged, less ~10 for false switches on calm minutes. i bad: at 15/20 on time, knife + bury costs 3/(0.75)² = 5.33 a roll (rs/642's model, below) against plain + bury's 3.89 (m, lab, PB): 1.44 x 964 expected rolls (185.4 oak + 778.8 willow, RUN-ORDER S07). Tonight it would have saved ~220 on the willow band (i, section 2) | 8 + lab 3 | **high**: woodcutting.ts (rs/642's module) | rs/186 | the willow band with the gate forced off, then on, on the lab engine, with a cadence-delay injector at 15/20 and at 19/20; check loads still flow under plain + bury; ~3 h |
| 2 | **Buy dragon bones for attempt 4's S07 mix** (supply, not code). The fleet keeps 237 dragon (markets, 00:5xZ). At 237 dragon, Prayer 99 needs (39,938 - 237 x 72) / 30 = 763 babydragon, so 1,000 bones, against 555 if every bone is dragon | S25b inside S07 | **~116 / ~116** | i: 445 extra bones x 6/23 a bone (the row in force's per-bone load cost, RUN-ORDER headline, scenario row 1); best 4/23 gives ~77 | 0 (a purchase) | none | rs/41, markets | none; markets reads depth for ~318 dragon bones |
| 3 | **Strike S02 beside the castle row instead of at the chicken coop.** T01-02 and T02-03 exist only to take S02 to the coop and back, now that S03 burns on the castle row (rs/622, Commit A). Rats spawn 3-4 tiles from the row: (3222,3215), (3229,3223), (3236,3222) (`server/content/maps/m50_50.jm2:9686`, `:9689`, `:9699`, NPC 47 = rat, `npc.pack:48`). The S03 dropper go cue moves to before the login | S02, T01-02, T02-03, S03's go cue | **~90 / -10** | i: the two legs, 53 m + 52 m = 105 m (RUN-ORDER; demo 51 + 51 and 58 + 51), less ~10 for the new pieces (e): a 3-tile walk ~2, the drop burst 3 m (already inside T01-02's 53), a walk into spell range ~2.5, and finishing a wounded target ~2.5. Bad: no rat in view, so the 10-tick give-up plus today's coop walk | 8 + lab 2 | **med**: magic.ts S02 (a target and site option), chain.ts order, legs.ts (two legs retired), chain.ts `dropperGoCue` | rs/186; rs/41 for the dropper cue timing | rat census and S02 to Magic 7 three times at the row on the lab engine; chain-built S01 to S04 with the go cue written before the login; ~2 h |
| 4 | **rs/635: the S07 cue names SCORED's site** (known; operator's idea, main 01:3xZ; rs/186 building, ETA green ~04:00Z, lab ~05:00Z) | S07 first oak load, willow switch | **~80 / ~270** | i: rs/158 priced the rotation +90 expected and +290 bad (two waits of ~45; main 21:3xZ: ~30-60 expected and ~130 worst each). rs/635's lab target is under 10 a wait, so ~90 - 10 and ~290 - 20. Attempt 3's first oak load took 5 (m) because of a timed login | (building) | **med**: bone-giver.ts, woodcutting.ts | rs/186, rs/41 reviews | rs/635's two-band lab, as briefed |
| 5 | **Move S07 to the Falador-north oaks beside the willows.** Four oaks stand at (2927,3441), (2932,3433), (2937,3443) and (2939,3437) (`m45_53.jm2:6458`, `:6533`, `:6595`, `:6626`; loc 1281 = oaktree), about 30 tiles from the willow stand (2920,3406). Today S07 chops at the Taverley trio (2912-2915,3491-3495), 114 route tiles from the willows and beyond the Taverley gate | T06-07, T07a, S07 oak band | **~45 / ~0** (range 25-85) | e: T07a 58 m becomes ~16 (32 tiles at 0.51 a tile, PRIM §2), -42. T06-07 82.7 m becomes ~37 (the Falador teleport + ~60 tiles + the drop 2, with no Taverley gate), -45. Less the oak spacing: these oaks are 6-10 tiles apart against the trio's 4, so ~23 falls in the band x ~2-3 more walk ticks ≈ +50-60 (i). Normal trees for WC 1-15 near the cluster are **unverified** | 4 + lab 3 | **med-high**: woodcutting.ts sites, legs.ts TILES, the bone givers' site config | rs/186; rs/41 for the bone sites; rs/158 for the row decision | a map and path survey, then a band rehearsal on the lab engine: oak knife ticks per roll on the new cluster, T06-07 and T07a measured 3 runs each; ~3 h |
| 6 | **Do S06 before S05.** The order becomes S04, then T04-06 (Falador teleport to the air altar), S06, T06-05 (Falador teleport to Doric), S05, then a T05-07 walk from Doric to the trees. Doric (2952,3451) is next to Taverley, so the third Falador teleport goes | T04-05, T05-06, T06-07 | **~43 / ~43** | e: today 51.7 + 64 + 82.7 = 198.4 m. Reordered ≈ 64 + 50.7 + ~36 (Doric to (2912,3495), ~65 tiles, e) = ~151, so -48. Less ~4 for dropping or swapping S04's last 20 rings before S06 (the 26-free rule). With item 5, Doric to the south oaks is ~20 tiles, a further ~-24 (e) | 10 + lab 3 | **high**: the H4 and H4k ledger, dorics-quest.ts (H4's ring swap), runecraft.ts slot rule; the air talisman, law and air must come at H1 | rs/158 (row order); rs/186, rs/41, rs/185 | a slot census through the reordered chain, then the three legs measured; ~3 h |
| 7 | **A pure bury loop for the close past WC 99** (rs/186's 01:4xZ estimate). On attempt 4's 237-dragon mix, Prayer may still be short at WC 99 | S07 willow tail | **~15 / ~70** | i: the bands bury ~0.329 bones a tick (m, #124) over 3,013 band ticks = ~991 bones, against the 1,000 needed, so a ~1-load tail on a calm demo. In-cycle that costs ~70 a load (23 / 0.329); a pure loop costs ~30-50 a load (rs/186: 23-46 bury + trade). 0 if item 2 lands | 2 + lab 1 | **high**: woodcutting.ts close | rs/186 | the close with a forced tail; ~1 h |
| 8 | **Trade-close patience** (known, rs/186's audit item 4): a close without the inventory delta waits 2 ticks (`lib/trade.ts:298-300`) | H1, H3 x 3, H4, H4k, and S07's ~42 bone loads | **~10 / ~96** | e expected. i bad: 48 trades x 2. Demo bone loads ran 4-7 ticks click-to-bones against the lab's 4 (m, rehearsal 01:14Z, n = 44), so some of that gap may be this wait | 2 + trace 4 | low: lib/trade.ts | rs/186 | a trace counting closes without the delta over a bone band; ~2 h |
| 9 | **Drop bursts folded into the next hand-off as a swap**: T01-02's 14 drops into H1, T06-07's air runes into H4k, T04-05's tinderbox and earth into H4. Offers ride inside the trade's fixed latency: H4's swap measured 6 with 20 rings and 6 without (m, rs/285) | T01-02, T04-05, T06-07 | **~6 / ~6** | m: the bursts measured on the browser, 3 / 1 / 2 (rs/589). Alternative, **known**: rs/186's overlap of the burst with the first walk click, 1-2 a leg (i) | 4 + lab 2 | **med**: mule.ts and the delivery engine's settlement guard must take unexpected items; legs.ts drops; dorics-quest.ts for H4 | rs/41, rs/186, rs/185 (H4) | H1 and H4k with the swap, 3 runs each on the lab engine; ~2 h |
| 10 | **S03 start-up.** On attempt 2, S03 started at session tick 136 and lit its first fire at 149 (m, host 19:25Z). The row allows 1 + 4 (the first roll) + 2 (the dropper-cue wait). rs/41: log 0 waits 0 if `fm-row-go` is written at least ~105 ticks ahead (fm-row.md:74), and it was written ~125 ahead | S03 | **~4 / ~8** | i: 13 - 7 = ~6 unexplained ticks on attempt 2; attempt 3's split was not reported. The dropper-cue part (0-4, midpoint 2, RUN-ORDER S03) goes with the cue timing | trace 2 | low (a trace first) | rs/186, rs/41 | none: read run.jsonl's S03 rows for attempts 2 and 3 |
| 11 | **S04's load 1 rides H1**, so S04 starts holding 20 rings. `s04Status` already infers loads delivered from xp and rings held (magic.ts:621-628, rs/186 at 19:3xZ), so S04 would open on load 2 | S04, H1 | **~5 / ~9** | i: S04 pays 5 from its start to the first trade window and ~4 for the trade (rs/607, m). H1 gains ~3 for the 20 extra offers (e). It needs the 14 drops burst before H1 so 20 slots are free | 4 + lab 1 | med: the H1 and H3 ledger rows, mule.ts carrier | rs/41, rs/186 | the chain-built H1 to S04 with load 1 on mule1; ~1 h |
| 12 | **The normal band 1-15 measured 22 twice against the row's 14** (m: attempts 2 and 3). The cause is untraced: the band start, the walk-oaks segment or the first tree pick | S07 normal band | **~4 / ~8** | e for the engineering part; the +8 correction is P3 below | trace 2 | low (a trace first) | rs/186 | none: read the wc rows of attempts 2 and 3 |
| 13 | **S00's tutorial skip took 6-9 ticks on the demo against the lab's 3** (m: rs/439 6, attempt 2 9, attempt 3 8, twin 7). On a claim that logs out on tick 1, S00 runs inside the scored session | S00 | **~4 / ~6** | e: trace start.ts's talk on the demo (the burst, the 12-tick window) | trace 2 | low: start.ts (rs/287's acceptance) | rs/186 | none: read the S00 rows |
| 14 | **S06 giver turns missed on the demo**: S06 took 61 and 67 against the row's 60 (m, attempts 2 and 3). rs/41: 6 of 8 turns on the run host in an overrun minute, and a missed turn drops to the robust cycle (~31 against 9) | S06 | **~4 / ~24** | m for the overrun; i for the cost per miss. Candidate: re-arm the tuned schedule after a miss instead of dropping to the robust one | 4 + lab 2 | **high**: runecraft.ts and altar-giver (demo-accepted, 20-cycle) | rs/41, rs/186 | a forced late giver turn on the lab engine; ~2 h |
| 15 | **H4k folded into S07's first bone load at the normal trees.** Giver site 0 (2913,3494) is beside the normal trees (2912,3495); the load would carry the axe, knife and log as `firstExtras`, like b04's `finalExtras` | H4k | **~5 / ~5** | i: H4k 6 m (attempts 2 and 3) less ~1 for 3 more items. It needs load 1 taken before the normal band, and the 23 bones held through it | 6 + lab 2 | med: bone-giver.ts, woodcutting.ts, the H4k ledger row | rs/41, rs/186 | the S07 entry with the kit on load 1; ~2 h (after rs/635) |
| 16 | **S04 ring givers on preRequest's default** (known, rs/607: 195 against 198, n = 1; not adopted, since it breaks 'every trade SCORED-initiated') | S04 | **3 / 3** | m, n = 1 | 0 (config) | low: mule.ts config only | rs/41, rs/186 | 3 runs to confirm n; ~1 h |
| 17 | **h66's stand within 2 tiles of S04's start** (known: rs/622's `GIVER_MAX_STEPS=2`, dropped by main 18:38Z; load 3's trade ~+2 over load 2, lab) | S04 | **~2 / ~2** | m (lab, n = 1) | 1 | low: helpers.json stands only | rs/496, rs/41 | a re-check of the stand's line to SCORED's tile; ~0.5 h |
| 18 | **The teleport landing check** (known, rs/186's item 5: `lib/travel.ts:575`'s `maxTicks: 1` wait, 0-1 a teleport) | T04-05, T05-06, T06-07, T07-08 | **~2 / ~4** | i | 2 + lab 1 | med: lib/travel.ts (legs) | rs/186 | the four legs, 3 runs each; ~1 h |
| 19 | **Doors** (known: rs/496's browser door-click line, +1 a click). Closed-door expected against open-door best: T04-05 51.7 / 44, T06-07 82.7 / 76, T07-08 138.7 / 129. Only a doorless route removes it; item 5 drops the Taverley gate | T04-05, T06-07, T07-08 | **~2 / ~10** | e | 2 | low: legs.ts routes | rs/186 | per-leg door census; ~1 h |
| - | **The S07 knife-gate probe is not paid on the bury path** (rs/186's audit, relayed by rs/158; main's ruling: an expected-row correction after one confirming trace). See P1 | S07 | (row correction: P1) | i | 0 | none | rs/158 | one S07 trace |
| - | **Move S03's row next to the coop** (rs/186's item 1; main's 02:0xZ ruling: a row decision, a measured proposal, not attempt 4 unless measured) | T02-03, S03, S04 | ~40-45 if measured / unmeasured | m for the coop-side walk (4, rs/198); the row itself unmeasured | ~16 incl. lab | high: S03 and S04 re-priced | rs/158 ruling; rs/186, rs/41 | one dropper + Firemaking rehearsal on a coop row, ticks a fire and failed rolls against 661. **Item 3 makes it moot**: with S02 at the castle, the coop trip goes and S03 keeps its demo-measured row |

**Pricing corrections** (no build; each moves a row, not the run):

| # | Row | Today | Measured or derived | Correction | Label, citation |
|---|---|---|---|---|---|
| P1 | S07, the probes 21 (oak) + 63 (willow) | 3,054.5 knife | the bury path builds no gate: `techniqueOf` returns `'knife'` when `bury` is set (woodcutting.ts:566-569), and the header says so (:38-40) | **-84** | i (rs/186's audit); one S07 trace confirms |
| P2 | S25b, the bone loads' cost | 145 i for ~42 loads, ~3.45 a load | 4-7 ticks click-to-bones a load on the demo, n = 44, 0 re-picks (m, attempt-3 rehearsal, host 01:14Z and 01:32Z), plus the in-page stop and restart (+30 i over 16 loads, ~2, R15) | **+60 to +170** | i: 42 x (5.5 + ~2) = ~315, against 145 + the restart share already in it. Item 8 attacks part of it |
| P3 | S07 normal band 1-15 | 14 | 22 and 22 | **+8** | m, attempts 2 and 3 |
| P4 | H1 | 8 | 6, 6, 6 | **-2** | m, attempts 2 and 3 and the twin's 13:07Z H1 |
| P5 | H4k | 5 i | 6, 6 | **+1** | m, attempts 2 and 3 |
| P6 | S02 | 20.3 | 17, 19, 12 (mean 16.0, n = 3, damage luck in it) | **~-4** | m, attempts 1, 2 and 3 |
| P7 | S07's knife-off column (the headline's 37,947.7) | plain + bury at 4,026.5 | since rs/642, a burying band never runs plain: no probe, no switch, no fallback. A gate-off night now pays the knife at whatever the on-time rate is: at 15/20, ~964 x 5.33 + 14 + the loads ≈ **~5,150** (i) | the knife-off column is not reachable on 1e536f76 | i from rs/642's model. **rs/158's question answered:** forcing the knife removes the fallback's own costs (the probes, already P1, and the knife-to-plain restarts), but it also removes the fallback, so the bad case is unbounded until item 1 lands |

## 2. Why the willow band ran ~+1,100 over its row, and what removes it

The rehearsal on 1e536f76 measured three things (m, host 01:04Z-01:32Z): WC 73 to 99 in 3,505
session ticks; WC 75 at tick 95, after the entry's 23 held dragon bones were buried; and loads
#3-#46, 44 in the band, each 4-7 ticks with 0 re-picks. The row is 2,386 (i, the lite ratio).
The gap, 1,119, splits like this (i):

| Part | Ticks | How |
|---|---|---|
| Bone loads inside the band | ~260 | 44 loads x ~6 (4-7 trade + restart). The row prices S07's loads in S25b, not in the willow row. About 10 of the 44 exist only because the rehearsal's givers were babydragon-only (the run's willow band carries ~34; rs/158 at 23:2xZ), so ~60 of this is a rehearsal artifact and ~200 is the run's own cost, which S25b under-prices (P2) |
| The demo's client loss on a calm knife | ~58 | rs/261's luck-free calm-demo willow 2,444 against the lite 2,386 (m) |
| The ragged demo's penalty that no technique avoids | ~585 | plain + bury on a ragged demo against a calm knife: (3.89 - 3.14) x 778.8 expected rolls. Plain is not slowed by lateness: attempt 3's plain oak band ran exactly 4 ticks a success, 115 of 115 gaps (m, host 23:2xZ) |
| Knife + bury instead of plain + bury on a ragged demo | ~220 | the chopping rate was (3,505 - 260) / 778.8 = 4.17 ticks an expected roll, against plain + bury's 3.89 (m, lab, PB): 0.28 x 778.8 |

**Why the knife suffers twice when it buries.** knife-cycle.ts:23-29 sends two bundles a cycle:
knife-on-logs, the button, a drop and the Bury on R, then the tree click alone on R+2. The bury
lands on R+1 and delays the player through R+2, so nothing may land on R+2. The click sent on R+2
must land on R+3. Both sends must arrive on the next tick, so a cycle survives with probability
(1-q)², not the knife-alone (1-q), where q is the late-tick rate. rs/642's 3/(1-q)² fits tonight:
4.17 gives (1-q)² = 0.72, about 17/20 on time, between the 15/20 and 18/20 probes host read on the
same demo. That squared exposure is structural, so **a different cadence is not the fix**: the
click cannot move earlier than R+2 without landing inside the bury's delay, and the bury cannot
leave R without breaking the 3-tick lattice (BP§2). Burying on alternate cycles halves the bones a
tick, and the bands then cannot hold S07's bones.

**So the fix is the gate (item 1).** Knife + bury breaks even with plain + bury at
3/(1-q)² = 3.89, which is q = 0.12, about 17.6/20 on time; rs/186's 17-18/20 agrees. On a calm
demo, q ≈ 0.02, the knife is ~720 ticks ahead over S07's 964 rolls, so the gate must not switch
without cause. On a ragged one it saves 220 (tonight) to 1,390 (15/20 all band).

**One design constraint.** An up-front 20-trial probe puts back the 84 ticks P1 takes out, so
the gate should judge the in-band rate rather than probe.

## 3. Specs for the top five

**Item 1, the burying gate (rs/186).** In `skills/woodcutting.ts`, remove `techniqueOf`'s forced
knife for burying bands (:566-569) and give them a gate that starts on the knife with **no
probe**. Read knife-cycle's own `ticksPerExpectedRoll` over a rolling window of about 40 rolls
(~130 ticks). Switch to plain + bury when it exceeds 3.9 for two windows running. Switch back to
the knife for one 20-roll trial window every ~600 ticks.

Plain segments must carry `bury` (paramsOf :591 passes it on knife segments only) and must ask for
loads; woodcutting.ts:38-40 says only knife segments do today, and rs/186 placed the check at :1092
at 32f39720. knife-cycle.ts already has plain + bury (:60-75, #165, lab-measured PB), so no bundle
rebuild is needed.

Acceptance:

- unit tests: a plain segment buries and requests loads; the switch fires on a synthetic 4.5-a-roll window and not on 3.2;
- lab: the willow band on the lab engine with a delay injector (q = 0.25 for 300 ticks, then 0) switches to plain within ~2 windows and back after the trial window;
- lab: loads served in both techniques, and the band closing on b04's runes load as rs/642 does.

This touches rs/642's lab-accepted module, so it needs its own lab pass before staging.

**Item 3, S02 at the castle row (rs/186, with rs/41).** `skills/magic.ts` already takes a `site`
(:538-539, defaulting to COOP at :596), but the target is hard-coded to chickens (CHICKEN at :57,
`strikeTarget` at :366-372). Add a target option (`/^rat$/i`) and set the site to the row's end
(3218,3219), radius ~12. In `runner/chain.ts` (:744-752):

- run S03 straight after H1 (a 3-tile walk to the row entry, which can stay as a one-hop T01-03 so the leg owns the 14 drops);
- then S02 at the row's end, then S04 as now;
- retire T01-02 and T02-03 (legs.ts:386-397).

S02 must end with no wounded target fighting SCORED. Rats retaliate, and S04 stands there for
~200 ticks at 10 HP, so `strikeTo` should strike on past Magic 7 until the current target is
dead. The extra 0-1 cast is harmless: S04's 60-cast plan holds from 7 or 8 (RUN-ORDER S04).

The S03 droppers then see SCORED ~125 ticks earlier than today. `dropperGoCue` (chain.ts:496-516)
must be written before the login, about 110-120 ticks (44-48 s) of wall time ahead of the expected
arrival on the row (fm-row.ts:404-411, `latestDrop`/`earliestDrop`). A late arrival of up to ~90
ticks costs nothing, and an early one waits. The bad case is a login delayed past ~200 ticks: the
logs despawn and S03 falls back to its trades (+58 i, 719 against 661).

Acceptance:

- lab: a rat census at the row's end over 300 ticks;
- lab: S02 to Magic 7 three times, with the target dead at exit and no damage after S02;
- lab: a chain-built S01 to S04 with the pre-login cue, S03's first fire within 6 ticks of arrival and S04 unchanged;
- the leg-ledger tests updated.

magic.ts, chain.ts, legs.ts and fm-row's cue timing are all lab-accepted, so this is likely attempt 5.

**Item 2, dragon bones (rs/41 and markets).** Buy about 318 dragon bones before staging, which takes
S07 from ~44 loads to ~24. It is worth ~116 i on the row's per-bone cost, and it also removes item
7's tail and shrinks P2. No code changes. The acceptance is rs/41's by-id bank census of b01-b04
against a regenerated load plan, as rs/631 did tonight. If depth is short, every dragon bone
bought is worth ~0.37 (i, RUN-ORDER headline).

**Item 5, S07 at the Falador-north oaks (rs/186, rs/41, rs/158).** First a survey, read-only:

- the paths from the Falador teleport landing to the oak cluster (2927-2939, 3433-3443) and from it to the willow stand (2920,3406): walls, fences, the north gate;
- normal trees within ~10 tiles of the cluster for WC 1-15;
- the cluster's oak spacing from each stand.

Then one lab band on the lab engine: the oak band knife + bury on the new cluster with `trees`
listing the two nearest oaks, ticks a roll against the Taverley trio's 627, and T06-07 and T07a
measured 3 runs each.

The code change is `legs.ts` TILES (:330-332), woodcutting's sites, and the bone givers' `sites`
in the S07 helper file. Acceptance: T06-07 + S07's oak band + T07a beats today's 82.7 + 627 + 58
by at least 25 on the lab, with respawn waits counted. It is a row decision for rs/158, priced
against Taverley's rs/261-corroborated row.

**Item 4, rs/635 (known; rs/186 and rs/41).** Already specified and building (main 01:3xZ, rs/186
18:32 PDT). The audit adds one acceptance line: rs/635's lab should report the first oak load's
wait and the willow-switch wait in ticks, both under 10. This table then takes ~80 expected off
rs/158's +90 S07 line.

## 4. Checked and not avoidable

Each line says what was checked and why it costs nothing against the best column.

- **S03's 4 ticks a fire and its failed rolls.** The light's roll cadence and its chance are the content's (firemaking.rs2; rs/186's audit, `skills/firemaking.ts:139-141`). The row ran exactly 4.00 a fire from FM 30 on the demo (rs/269), and its expected-minus-best (661.3 against 657) is failure luck plus item 10.
- **S04's 3-tick enchant cadence and its 60 casts.** Every enchant ends in `p_delay(1)` and OPHELDT is dropped while delayed (magic.ts:13-17), so 3 ticks is the floor. 60 casts are what 7 to 59 needs (`simulatePlan`). Expected equals best at 198 (m, rs/607), apart from items 11, 16 and 17.
- **S05 (17 = best, browser-accepted).** Its dialogue is already burst. The quest's segments are rs/185's audit; this band adds only H4's swap, which costs 0 marginal (6 with the rings, 6 without, m).
- **S06's 7-tick cycle and its ~9-tick walk from the ruins to the stand.** 7 crafts are fixed by xp (26 a load is a slot rule, rs/186). A trade window stops movement, so the first trade cannot overlap the walk. Taking the first 26 essence before the room would need a second trade at Doric's, a net ~2 at most (e, not tabled).
- **The teleport casts and the talisman entry** (T04-05, T05-06, T06-07: the Falador teleport; T05-06's ruins entry 4). These are fixed content delays. The browser's post-landing settle, 1 a landing, stays: it guards the 14-tile misroute (R29; rs/186's item 6).
- **Cue latency.** CueWatcher is fs.watch plus a 20 ms poll (altar-cue.ts:767, rs/41), ~0 ticks. Mule cues are re-written by CueKeeper every 25 ticks, off the clock.
- **Bounds that are not paid on the normal path:** `SERVER_WAIT_TICKS` 400 (bone-giver.ts:572), `READY_MAX_TICKS` 600 (delivery-owner.ts:37), `RESEND_TICKS` 27 and `OPEN_MAX_TICKS` 200 (lib/trade.ts), and the drop-relog waits. None is paid unless a helper or link fails.
- **H1's ready wait.** mule1's 97 ticks from bank to ready (lab, mule-delivery.md:185) fall before the login, which is gated on readiness. The scored cost is the trade, 6 m.
- **H4k's carry-ahead.** 44 against a ~132 window (mule-delivery.md:187), so the trade is not late. The bank-return path's zero margin is a fault-path cliff (the margin ladder's late-walking-carrier line), not an expected cost.
- **S07's end.** The last bone load carries T07-08's runes and the axe drop is sent without waiting (woodcutting.ts:1373-1381), so 0 ticks (fold-in 22).
- **The bone load size of 23.** It is capped by slots: 28 less the axe, the knife, the log and the held product. Fewer, larger loads are impossible; fewer loads come only from a better bone mix (item 2).
- **T07a on today's sites.** 58 m = best over 114 route tiles; only a site move shortens it (item 5).
- **T07-08.** The Camelot teleport plus 248 tiles. No faster teleport to Edmond exists before Plague City gives the Ardougne one, and the expected-minus-best (138.7 against 129) is doors (item 19).
- **Level-up pages in S03, S04 and S07.** 0 measured: S04's casts close pages, the knife answers on its own labels (LU§2-§3), and S03's are inside the measured line.
- **Relogs.** None planned in this band.
- **rs/637's in-sight server pick.** A far-site server waits at most one siteWait (30) before dropping out (bone-giver.ts:814). That cost is inside item 4's +90, not separate.

## 5. For attempt 4

By main's rule, only items needing no lab-accepted change, or with a lab pass before ~15:00Z,
qualify:

- item 2 (a purchase);
- P1-P6 (pricing, after P1's confirming trace);
- items 16 and 17 (config, each with its re-check);
- item 4, if rs/635's lab passes on time.

Item 1 is the one I would push hardest for, because its bad case alone (~1,390) is larger than
the whole margin on the row in force. It touches rs/642's module, though, so it enters attempt 4
only with its own lab. Otherwise it is attempt 5's first item. Items 3, 5 and 6 are design moves
for attempt 5.
