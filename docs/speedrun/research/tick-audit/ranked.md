# Tick audit: the ranked table (rs/158, 2026-10-24 03:2xZ)

One table built from the eight audit files in this folder: bands A (rs/650), B (rs/651), C (rs/652),
D (rs/653) and X (rs/654), and long shots L1 (rs/655), L2 (rs/656) and L3 (rs/657, at db888e06).
Each row cites its source as `file#item`; the source holds the arithmetic, the code references and
the lab spec. Labels: **m** measured end to end, **i** inferred from measured rates or from code,
**e** estimate. Where two files price the same lever, it appears once, under the fuller pricing,
with the other cited. Where two levers buy the same ticks, they are marked as alternatives and are
not summed.

Main's rule for attempt 4 (06:5xZ message): this table is the one main picks from, and nothing
after it enters attempt 4 unless it is already lab-passed. So every row says which tier it is in:

- **Tier 0**: attempt 4, no lab needed (docs, staging, a purchase, a runbook line).
- **Tier 1**: attempt 4 only if its named lab passes before staging closes; otherwise attempt 5.
- **Tier 2**: attempt 5 or later (a build plus a lab longer than the time left, or a lab-accepted
  module re-opened broadly).

Nothing here changes a total. Price corrections go into the next docs fold-in, where the sums
script sets the figures.

## 1. Tier 0: attempt 4, no lab

| # | Item | Ticks (exp / bad) | Label | What it needs | Owner | Source |
|---|---|---|---|---|---|---|
| 0.1 | **Size the run stack's 9 h bound to the attempt, or re-`up` in the resume recipe.** Gateway, page server and live view die 9 h after RUN-HOST step 3's `up`; tonight they died ~01:33Z mid-S07 with SCORED in the world | risk line ~200 e expected / 600+ i an event | e / i | a RUN-HOST step-3 line and the `T=` bound in run-gate.ts's `up` (no step module) | rs/186 with the host | band-x#2 |
| 0.2 | **Buy dragon bones for attempt 4's S07 mix.** At 237 dragon, Prayer 99 needs 1,000 bones against 555 all-dragon; ~318 more dragon removes ~445 bones from S07's loads | ~116 / ~116 (best per-bone rate ~77) | i | a market purchase of ~318 dragon bones before staging; the loads re-generated from the staged count | rs/41 (markets) | band-a#2 |
| 0.3 | **Merge H10's runes into H9** (same carrier h55, same Ardougne landing; H10 becomes a 'shark to 8' top-up that trades nothing when S12 eats none) | ~4 / 0 | i | ledger rows, the slot ledger, h55's packages regenerated | rs/158 (rows), rs/41 | band-b#9c |
| 0.4 | H18's logs trimmed from 10 to 6 (S22 uses ~3.9) | <=1 / 0 | i | one ledger cell | rs/158, rs/41 | band-d#17 |
| 0.5 | **Price corrections** (section 4): rows that are wrong today, both directions | net ~-11 (range ~-66 to +44) | m/i | the next docs fold-in, re-summed by script | rs/158 | section 4 |
| 0.6 | **The run-wide allowances may double-count Ashburn's removed latency.** Attempt 3's first 10 steps on the demo took 596 against 594.7 priced, all lab-priced, none reaction-timed | candidate: the 200 relay line and part of the 800 latency line | i (n = 1, 10 calm steps) | a ruling only; no tick moves on the run | main | band-x section 2 |

Tier 0 can be in attempt 4 for certain: 0.1 (an operating fix), 0.2 (if the market has the
depth tonight), 0.3 and 0.4 (ledger edits with the slot ledger re-run), 0.5 and 0.6 (accounting).

## 2. Tier 1: attempt 4 only if its lab passes first

Ranked by expected ticks. 'Lab' is the shortest lab that would pass it under main's rule.

| # | Item | Step | Ticks (exp / bad) | Label | Build + lab | Risk to a lab-accepted module | Owner | Source |
|---|---|---|---|---|---|---|---|---|
| 1.1 | **Burst dialogue in Monkey Madness on main's `converse.ts` unchanged** (rs/513's four patches re-applied to the current module) | S15 | **313 / ~293** | m (3 clean A-Z browser burst chains against the fixed browser chain; ±20) | 2-3 h + 3 clean A-Z burst chains at 400 ms, ~2.5 h | high, S15 only; none for the other 12 converse quests | rs/185 | band-c#1 |
| 1.2 | S11b's black demon by Fire Blast (~30 more death runes in H7 or H9) | S11b | 25 / 10 | i | 1.5 h + N1, N2 3x browser | med, the Grand Tree | rs/185, rs/41 | band-b#6 |
| 1.3 | Amulet of magic kept worn into Kolodion; returned at H14, not H13 | S16 | ~25 / 0 | e (accuracy not computed from the formula) | 1 h (two ledger rows) + 5 fights each way, ~1 h | low-med: mage-arena.ts unchanged, H13/H14 packages change | rs/158 (rows), rs/41, rs/185 (lab) | band-c#4 |
| 1.4 | A door-free route for T18-19 (O25) | T18-19 | 18 / 18 | i | 1 h (waypoints in legs.ts) + 3 browser runs, ~15 min | low, no step module | rs/186 | band-c#5 |
| 1.5 | S11b J by Ardougne and the Khazard young tree (H8 restaged +1 law, +2 water, -3 air) | S11b | 12 / 5 | m-derived | 1.5 h + J 3x browser | med, the Grand Tree | rs/185, rs/41 | band-b#11 |
| 1.6 | Fight Arena's talk idle 3 to 2, module-local part of the shared idle lever | S12 | ~7 | i | ~1.5 h lab | med, Fight Arena only | rs/185 | band-b#3 |
| 1.7 | Merge H16 into H15 (one trade at Caroline's tile), if S19's slots allow; also removes H16's late-carrier exposure | H15, H16 | ~6 / ~6 | i | 1 h (ledger, chain.ts PLACEMENT) + slot ledger + one S19 browser run | low | rs/158, rs/186, rs/41 | band-c#8 |
| 1.8 | T23-24 on SDK waypoints (`via` at the divergence) | T23-24 | <=7 / 0 | i | 3-4 h + 3 browser runs | low, one legs.ts row | rs/186 | band-d#8 |
| 1.9 | S27's cannon left placed (`pickUp` off) | S27 | 1-3 / 0 | m/i | 1 h + S27's end 1x | med, ranged.ts | rs/186 | band-d#14 |
| 1.10 | H11's cue opened at T13-14's teleport click, so h92's request is standing at the landing | H11 | 1-2 / 0 | i | 1 h + T13-14a and H11 3x | low, runner only | rs/186 | band-b#19 |

Tier 1 adds up to ~420 expected if every lab passed, ~313 of it from 1.1. Without 1.1 it is ~105.
At the time this table was cut (03:2xZ) and attempt 4's start ~07:30Z, only the short ones (1.3,
1.4, 1.6, 1.10) fit a build and a lab with margin; 1.1 fits only if rs/185 starts at once and all
three chains pass first time.

## 3. Tier 2: attempt 5 and later, ranked by expected ticks

| # | Item | Step(s) | Ticks (exp / bad) | Label | Build + lab | Risk | Owner | Source | Overlaps |
|---|---|---|---|---|---|---|---|---|---|
| 2.1 | **Conversations finish on the close tick once their shape is consumed** (`converse.ts` idle default 3) | every quest S05-S26 | ~210 / ~30 | i (GT/TGV/FA/MM 92-112, from rs/185) + e (the rest) | 4 h + every quest on the browser | yes, every quest module | rs/185, rs/186 | band-x#1 | subsumes band-b#3 and rs/185's per-quest idle rows; 1.6 is its Fight Arena part |
| 2.2 | **Pen the S18 knight with standing helpers** so it cannot wander | S18 | ~150 (100-199) / 0 | i (rs/479's crowd lab) | 4-6 h + ~2 h | low, thieving.ts unchanged; extra logins on the address | rs/41, rs/186 | band-c#2 | makes band-c#10 (start at the landing, ~6) moot or adds to it |
| 2.3 | **Goblin Diplomacy split: bartender after S06, generals on the way to Taverley** (Crafting 25 at S13) | T23-24, L24b, S13, T06-07, H20 | ~144 (railings only ~124) | i (legs m) | build in goblin-diplomacy.ts parts + 3 browser runs | med | rs/185, rs/186, rs/41 | longshot-l3#2 | **alternative** to Crafting 30 before S13 (band-b#4 prices that at ~+40 net, a cost; longshot-l3#4 does not fit H10's slots) |
| 2.4 | **Gate S07's burying bands between knife + bury and plain + bury on the measured rate** | S07 oak and willow | ~110 / **~1,390** | e expected, i bad | 8 h + ~3 h | high, woodcutting.ts (rs/642) | rs/186 | band-a#1 | the largest bad-case reducer on the route: attempt 4 runs the forced knife with no fallback, unbounded on a ragged demo |
| 2.5 | Imp Catcher in place of S02; S04 starts at Magic 44 (31 enchants for 60) | T01-02, S02, T02-03, S04 | ~90 (75-105) | i (Magic 44 m 3 of 3) | tower stairs unsolved + legs and S04 3x | med | rs/185, rs/186, rs/41 | longshot-l3#1 | **alternative** to S02 at the castle row (band-a#3, ~90 on the legs); combining them is untested |
| 2.6 | 28-essence loads from resident body givers | S21 | 49 / 49 | i | 16-24 h + 30 cycles | high, runecraft.ts, altar-giver | rs/186, rs/41 | band-d#1 | |
| 2.7 | **One wine firing at Cooking 30, inside S25e's mixing** (or the minimal form left in S25c, ~28) | S25c, S25e | ~45-52 (minimal ~28) | i (odds exact from source) | 10 min odds lab + 30 min Herblore lab, then cooking.ts and herblore.ts | high, both lab-accepted | rs/186, rs/41 | longshot-l1#1 | longshot-l2 found the same lever independently (L2 frozen under main's ruling; cited, not quoted) |
| 2.8 | Leg doors opened ahead by a helper (doors revert 500 ticks after opening) | T07-08, T12-13, T13-14, T14-15, T22-23, L24a, L24b | ~44 / 0 | m (closed vs open on the browser) | 5-6 h new role + legs 3x each | low, no step module; one login | rs/41, rs/186 | band-b#7 + band-d#4 | one role, counted once |
| 2.9 | Seed the knife-gate band-start probe from the previous verdict | S09, S22 | 29 + 39 = ~68 / -20 each | m (probe costs) | 3-4 h + seam labs | high, mining.ts, fishing.ts, gated-program.ts | rs/186 | band-b#5 + band-d#2 | one fix |
| 2.10 | Move S07's oaks to the Falador-north cluster beside the willows | T06-07, T07a, S07 oak | ~45 (25-85) | e | 4 h + ~3 h | med-high | rs/186, rs/41 | band-a#5 | changes 2.11's leg arithmetic |
| 2.11 | S06 before S05 (drops the third Falador teleport) | T04-05, T05-06, T06-07 | ~43 | e | 10 h + ~3 h | high (ledger, dorics-quest.ts, runecraft slot rule) | rs/158, rs/186, rs/41, rs/185 | band-a#6 | conflicts with 2.3's T06-07 change; rank together |
| 2.12 | Transport hops (spirit trees, lever, ship, glider, Lumdo) with their burst shapes | T10-11, T14-15, S11b, S15, T20-21 | ~30 / ~10 | r/i + e | 2-3 h + the hops' legs 3x | yes, travel.ts | rs/186, rs/185 | band-x#4 | subsumes band-b#8 |
| 2.13 | Super attack and super strength for Melzar, the demon and Elvarg | S26 | 30 / ~0 | i | 3 h + supply + G, L 3x | med | rs/185, rs/41 | band-d#3 | |
| 2.14 | The browser's settle tick before each leg's first click (send a pathfinder path) | ~29 legs | ~29 | m per leg | 6-10 h + every leg | yes, sdk, webclient | rs/186 with main | band-x#3 | |
| 2.15 | A leg's last click is the next step's first op (fire on the arrival tick) | ~16-26 joins | ~21 | i | 4-6 h + each join | yes, broad | rs/186, rs/185 | band-x#5 | |
| 2.16 | Carrier trades on the cue opened before SCORED arrives | 19 delivery rows | ~20 | i (consistent with H1/H4k 6 m, not proof) | 2-3 h + H1, H4k 3x | yes, chain.ts or mule.ts | rs/186, rs/41 | band-x#6 | |
| 2.17 | The Duke after the ship in Dragon Slayer J | S26 | 18 / 8 | i | 3 h + lab | med | rs/185 | band-d#5 | |
| 2.18 | Prayer toggles: next click in the same tick; re-send after a scene drop | S10b, S11b, S12, S15, S16, S26 | ~15 + ~6 | i | 3 h + packet-order proof | yes, combat.ts | rs/185 | band-x#7, #8 | subsumes band-b#13, #14 |
| 2.19 | Games necklace for T06-07 (or, with 2.3, the Kaqemeex leg ~15) | T06-07 | ~23 | m (lab, lite) | browser 3x + a slot in S06 | low | rs/186, rs/41 | longshot-l3#3 | |
| 2.20 | Fight Arena moved between S09 and S10b | T09-10, T11-12, T12-13, S12 | ~75 / ~40 | i | 12-16 h + seams | med | rs/158, rs/186, rs/185, rs/41 | band-b#1 | changes S12's arrival Magic (~59-64); listed here, not higher, because its build and re-pricing are the largest of the reorders |
| 2.21 | Smaller items, each under ~15: H4k into S07's first bone load (~5), S04 load 1 in H1 (~5), drop bursts folded into trades (~6), trade-close patience (~10 / 96 bad), S11b/S12 small items, S13 railing reaction (5-10), S14 cannon coverage (6-12 e), Fight Arena north exit (~12 e), H18/H19 on S21's hand-back (~8), S21 re-tune after a clean robust stretch (0-10 / 193-386 bad), S21 after S25c's relog (0-9 / 163 bad), S21's entry burst (~3), T20-21 rod in the batch (1), dead items into the next trade (1), Agility potions for the Wilderness course (~40, no stock), H12o-M dropped (4, kit risk), H14 inside the first stun (~7) | various | ~150 together | mixed | each in its file | mixed | various | band-a#8-#19, band-b#12-#23, band-c#3, #6, #7, #9-#11, band-d#7, #9-#16 | |

Rough size of tier 2, alternatives taken once and overlaps removed: **~1,100-1,300 ticks expected**,
nearly all i or e. The measured share is small: the probes (2.9), the doors (2.8), the necklace
(2.19) and the legs inside 2.3. The largest single bad-case reduction is 2.4 (~1,390).

## 4. Price corrections (tier 0.5), both directions

| Row | Correction | Label | Source |
|---|---|---|---|
| S07 knife-gate probes (21 + 63) never paid on the bury path | **-84** | i; one S07 trace confirms (tonight's rehearsal run.jsonl) | band-a P1 |
| S25b bone loads: demo 4-7 ticks a load (n = 44) against ~3.45 priced | **+60 to +170** (central ~+115) | i | band-a P2 |
| S07 normal band 1-15 | +8 | m | band-a P3 |
| H1 | -2 | m | band-a P4 |
| H4k | +1 | m | band-a P5 |
| S02 | ~-4 | m (n = 3) | band-a P6 |
| H9 and H10 sit in no row | +8 to +10 (falls to ~+4 with 0.3) | i | band-b#10 |
| H11 and H11r on their measured trades | -5 to -6 | m | band-b#18 |
| Level-up pages charged twice in section 6's S10-S13 cell | -6 to -18 on the allowance | i | band-b#25 |
| H15 and H16 unpriced | +10 to +16 | i | band-c pricing gaps |
| S21: 193 crafts, not 194 (S06 leaves 22,750 game xp on any account) | -7 | i | band-d R1 |
| S25a priced on the real anvil helper (1,028 m) | -37 | m | band-d R2 |
| S26 L at the pooled 11 runs | -9.7 | m | band-d R3 |
| The relog before S21's logout tail | +1.6 | i | band-d R5 |
| H18 carries 16 items, not 2 stacks | +2 to +3 | i | band-d R6 |
| S07 knife-off column (37,947.7) | not reachable since rs/642: a gate-off night pays the forced knife, ~5,150 for S07 at 15/20 on time | i | band-a P7 |

Net on the row in force: about **-11** at P2's central value (range ~-66 to +44). These come on
top of the S07 bone-wait line (+1 from +95, rs/635 via #526), T07-08's +5 for the 21-bone drop
(rs/664) and S25d's +26 for attempt 3's gem shortfall where it applies; the fold-in's sums script
sets the final figure.

## 5. Risks this audit sharpened (not savings)

- **S07's bad case has no ceiling on attempt 4's code.** The burying bands run the forced knife with
  no plain fallback; at 15 of 20 ticks on time it costs ~5.33 a roll against plain + bury's 3.89.
  Tonight's willow band ran ~+1,100 over its row, ~585 of it ragged demo ticks no technique avoids
  (band-a section 2). Until 2.4 lands, a ragged demo during S07 costs hundreds of ticks.
- **Disconnect waves and long waits with no input** (band-x#14, #15): H11 and H23 waits of up to
  40 min send nothing; a wave removal costs a relog and a re-entry, and uses 1 of 3 unplanned relogs.
- **S21's fault ladder never re-tunes** (band-d#9): one fault costs up to 193, two up to 386.
- **A late carrier throws the step instead of waiting** (band-x#12): ~11.7 m plus re-entry per
  event; H4k is exposed only after a mid-run relaunch.

## 6. Ruled out

- No delay-free xp action stacks past 5 a tick; every one already on the route runs at the cap.
  S25e's 41 level-up stall ticks are an engine floor. The only offline progression is the wine
  (longshot-l1 sections 3-5).
- Death as a free teleport works only on T14-15, at ~+26-35 with PK and armour exposure (longshot-l3
  #5, D1). Random events are off on the demo and cannot be planned (longshot-l3 D3). Logging out
  inside an action's delay saves nothing.
- Crafting 30 before S13 from gloves does not fit H10's slots (longshot-l3#4); priced as a block it
  is a net cost (band-b#4).
- Competitor stamps (longshot-l2): the one item worth doing is the single wine firing, carried here
  as 2.7 under longshot-l1's pricing.
