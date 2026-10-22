# Run-order transitions: measured legs, hand-offs, and four ordering answers

Issue cairn://p/rs/104, for the provisional run order v1 of cairn://p/rs/103 (step ids S00-S27 as
that issue defines them). This page replaces the travel and hand-off part of the main tally's
unmodelled "banking, trades, travel, logins, level-ups" lump with legs measured end to end. The
account is called SCORED throughout.

**Labels.** **m** measured on the local engine (script and run count given), **r** read from a
document or a script line (cited), **i** inferred from measured parts (the parts are named).

**Provenance of every m figure.** Local engine at `NODE_TICKRATE=300`, headless lite client
(post-rs/22 tick publishing), `speedrun/lab/lab.sh` on this issue's port block (web 9600, agent
8600), executor **fedora** (Linux x86_64, 32 cores; load average 1.5-4.6, shared with two other
labs), 2026-10-21. Scripts: [`run-transitions-legs.ts`](../scripts/run-transitions-legs.ts) (leg
catalogue, one `RESULT leg` line per run), [`run-transitions-handoff.ts`](../scripts/run-transitions-handoff.ts),
shared helpers in [`run-transitions-lib.ts`](../scripts/run-transitions-lib.ts), and
[`run-transitions-probe.ts`](../scripts/run-transitions-probe.ts) for stalled walks. Raw results:
[`run-transitions-results.jsonl`](run-transitions-results.jsonl). The main campaign's raw log sat in
non-durable scratch space and was lost after it was summarised. The file therefore holds that
campaign's per-run ticks and segment ticks as a summary, plus the raw rows of the reruns and of the
hand-offs.

**Clock.** A leg runs from the tick in which its first action is sent to the first published state
at the next step's start tile, which is the receiver-clock convention of `speedrun/README.md`. Setup
is untimed: route stats by `::setstat`, items by `::give`, quest varps by `::setvar`, then `::tele`
to the earlier step's end tile.

**Walker.** Runs are chained clicks on the SDK's global route. The walker clicks the furthest route
tile within 20 tiles and re-clicks 3 tiles before it is reached (`quests/primitives.md` section 2:
0.51 ticks per route tile). A closed door or gate on the route ahead is opened as part of the run,
so the server walks to it. A knife is used on webs.

**Door state matters.** The lab leaves a door open after the first run, so a leg's first run often
opens doors that its later runs find open. The demo's doors can be in either state.
`doorOpens` per run is in the results file. The ranges below include both cases.

**No amulet of glory.** rs/123 found charged glories unobtainable on the demo. Every leg that a
glory would shorten has a measured no-glory method, and the no-glory method is the primary figure.
Glory figures are kept as a reference only, marked "glory, unavailable".

## 1. Summary

- **Leg total for order v1: about 2,286 ticks** with the best method that has no glory. Of that,
  1,792 is measured end to end, 321 is read from quest documents that measured the same leg, and
  174 is one leg inferred from measured parts. Section 2 has the table and section 6 the arithmetic.
- **Agility placement: put S17 last, after S27. It saves 99 ticks.** S16 to S17 to S18 costs 113 +
  178 = 291 ticks. S16 to S18 directly (6 ticks) plus S27 to S17 (186 ticks) costs 192. With S17
  last, order v1 comes to **about 2,187**.
- **Enchant while walking does not pay before Doric's.** Walking from the Firemaking row to Doric
  with 60 enchants riding took 252-258 ticks (m, 2 clean runs of 4). Enchanting standalone and then
  using the Falador teleport takes about 240 (i). The walk is 187-202 ticks on its own, against 44
  for the teleport and walk, and that difference swallows what the casts save. Two of the four
  enchant-walk attempts also went wrong, which is a reliability cost.
- **Nature altar from the Fishing Contest: use the Ardougne-Brimhaven ship.** It took 161-162 ticks,
  which beats even the unavailable glory (166-169). The Port Sarim ship took 311-312. The talisman
  entry is 3-4 ticks.
- **Druidic Ritual beside Doric's saves about 14 ticks of travel**, but it puts a Defence 1, 10 HP
  account past six aggressive level-25 skeletons and an animated suit of armour. Keep it in S24.
- **Hand-offs confirm speedrun/README.md.** A trade with `speedrun/lib/trade.ts` costs the receiver
  **4 ticks for 1 noted stack and 8 for 23 stacks**. That held at all four staging tiles in 12 of
  12 samples each, with no variation. Drop and pick up costs **1, 2 or 3 ticks for 1, 2 or 3
  items** when the receiver stands on the pile, and 2, 3 or 4 from the next tile.

## 2. Leg table, order v1

The start and end tiles are the earlier step's end and the next step's start. Where a document
gives none, the tile is the one this page assumed (marked). "Ticks" are the per-run figures and the
mean. "In next step's own total?" says whether the next step's quest document already counts an
arrival leg. If it does, the leg here replaces that row and does not add to it, and the difference
is given.

| Leg | From tile | To tile | Method (primary, no glory) | Ticks: runs (mean) | Label | Source | In next step's own total? |
|---|---|---|---|---|---|---|---|
| S00→S01 | (3222,3222) tutorial-skip landing | same | none: the hand-off happens on the landing tile | 0 | r | travel-and-overhead.md (rs/59) row 1 | no |
| S01→S02 | (3222,3222) | chicken coop gate (3235,3295) | run, 1 gate | 51, 49, 49 (50) | m | legs.ts `L01`, 3 runs | no (skill site) |
| S02→S03 | coop (3233,3295) | Firemaking row start (3200,3226), the Lumbridge-Draynor road (**assumed**; firemaking.md gives no Lumbridge row) | run | 50, 50 (50) | m | `L02`, 2 runs | no |
| S03→S04 | row end | same | none: enchant at the row, restocks by hand-off (section 3) | 0 | i | enchants need no bank | no |
| S04→S05 | (3200,3226) | Doric (2952,3451) | Falador teleport + run (house door) | 46, 42 (44) | m | `L04`, 2 runs | yes: dorics_quest.md counts 47 stock / 43 fixed, so the difference is about 0 |
| S05→S06 | Doric (2952,3451) | inside the air altar room (2841,4830) | Falador teleport + run to the ruins (2984,3291) + air talisman on the ruins | 62, 60 (61): teleport 4, run 52-54, entry 4 | m | `L05`, 2 runs | no; runecraft.md estimated 40-60 (i) |
| S06→S07 | air altar room | Taverley normal trees (2912,3495) | Falador teleport from the room + run | 75, 73 (74) | m | `L06`, 2 runs | no |
| S07→S08 | Taverley willows (2920,3406) | Edmond (2568,3334) | Camelot teleport + run, 248 tiles | 134, 128 (131) | m | `L07`, 2 runs | yes: plague_city.md counts 129 (i), so +2 |
| S08→S09 | Edmond (2568,3334) | zoo iron (2604,3235) | Ardougne teleport (the scroll is read in S08) + run | 50, 50 (50) | m | `L08t`, 2 runs; on foot 59, 59 (`L08`) | no; the travel matrix's ~38 lower bound ran 32% longer |
| S09→S10 | zoo (2604,3235) | Elkoy, maze entrance (2504,3191) | run | 54, 57 (55.5) | m | `L09`, 2 runs | yes: tree_gnome_village.md counts Ardougne teleport + 197 tiles = 103, so **−47.5** |
| S10→S11 | King Bolren (2541,3171) | gnome course start (2474,3436) | village spirit tree to the stronghold (6 pages, 2 choices) + run | 20, 20 (20): tree 11, run 9 | m | `L10`, 2 runs | no (S11 begins with the course) |
| S11 inside | course end (2484,3437) | Grand Tree door (2465,3489) | run | 36, 36 (36) | m | `L11a`, 2 runs | grand_tree.md segment A counts tree 20-23 + run 25-27; with the course first, S10→S11 + this = 56 against about 47.5 (**+8.5**) |
| S11→S12 | Narnode in the roots (2464,9897) | Lady Servil (2566,3199) | Ardougne teleport + run | 71, 71 (71) | m | `L11`, 2 runs | yes: fight_arena.md counts 74 (i), so −3 |
| S12→S13 | Lady Servil | Commander Lawgof (2571,3463) | Ardougne teleport + run, 189 tiles | 4 + 117 = 121 | r | dwarf_cannon.md (walk measured at 300 ms) | yes, so 0 |
| S13→S14 | Lawgof (2571,3463) | poison spiders (3288,3810) | Ardougne teleport + run to the lever + lever + Deserted Keep web + run | 182, 181 (181.5): teleport 4, run 55-58, lever 11-12, web 20-22, run 87-90 | m | `L13L`, 2 runs; glory, unavailable: 164, 164 (`L13G`) | no (README: "+ travel") |
| S14→S15 | spiders | Grand Tree door (Narnode inside) | run to Wilderness level 20 + **Ardougne** teleport + run to the Khazard young tree + young tree to the village tree + village tree to the stronghold + run | **173.5** = 66 + 4 + 103.5 | i | parts m: `X14n` run to level 20, 66, 66, 66; `L14a` from the Ardougne landing, 105, 102 | MM's document starts at Narnode, so not counted |
| | | | end-to-end alternatives, no glory | `X14n` + `L14nv` (Varrock teleport and the Varrock young tree): 70 + 116-120 = **188**; `X14l` + `L14nl` (Keep lever out, then the Khazard young tree): 117-119 + 68-70 = **187** | m | 2-3 runs each | |
| | | | glory, unavailable | `X14` 31 + `L14v` 92 = 123 | m | 3 + 2 runs | |
| S15→S16 | Daero (2484,3486, level 1) | Kolodion's cellar (2543,4713) | Ardougne teleport + lever + Keep webs + ladder | 4 + 61 + 15 + 75 + 3 = 158 (172 measured with 12 web tries) | r | mage_arena.md "Tick total"; this lab's lever segments agree (lever 11-12 here, run to the lever 55-58) | yes, so 0 |
| S16→S17 | chamber guardian (2506,4696) | Wilderness course pipe (3004,3937) | return pool + cellar ladder + 1-2 Mage Bank webs + run + ridge gate | 111, 111, 117 (113): pool 13, ladder 5, web 7-11, run 66-68, ridge 14, run 6 | m | `L16A`, 3 runs | no |
| S17→S18 | course lap end (2994,3933) | Ardougne market knights (2655,3305) | course gate and ridge out + run to Wilderness level 20 + Ardougne teleport | 175, 182, 176 (177.7): gate 14, run 155-161, teleport 4, run 2-3 | m | `L17n`, 3 runs; Keep lever out 187, 184 (`L17nl`); glory, unavailable 149, 141, 141 (`L17A`) | no |
| S18→S19 | knights (2655,3305) | Caroline (2716,3302) | run (the route took 2 doors) | 49, 49 (49) | m | `L18`, 2 runs | yes: sea_slug.md counts Ardougne teleport 4 + a 29-tick run from the landing. A door-free route is probably about 31 (i); the walker's route cost 18 more |
| S19→S20 | Caroline | Fishing Contest stairs (2820,3484) | Camelot teleport + run, 66-69 tiles | 4 + 36-40 = 40-44 | r | fishing_contest.md (m) | yes, so 0 |
| S20→S21 | Fishing Contest dwarf (2820,3487) | inside the nature altar room (2400,4835) | Ardougne teleport + run to Captain Barnaby + ship + gangplank + run + nature talisman | 162, 161 (161.5): teleport 4, run 17-18, ship 13, gangplank 3, run 120, entry 4 | m | `L20S`, 2 runs | no; runecraft.md estimated ~150 (i) |
| S21→S22 | nature altar room | Lumbridge fly spots (3241,3248) | Lumbridge teleport + run | 32, 34 (33) | m | `L21`, 2 runs | no |
| S22→S23 | (3241,3248) | Lumbridge cook (3209,3215) | Lumbridge teleport + run (castle doors) | 20, 15, 14 (16.3) | m | `L22t`, 3 runs; on foot 45, 39 (`L22`) | yes: quest_points.md counts teleport + 12 tiles (~10, i), so about +6 |
| S23→S24 | cook | Rusty Anchor, Port Sarim (3045,3257) | Falador teleport + run | 90, 90 (90) | m | `L23f`, 2 runs; on foot 124, 124 (`L23w`); glory to Draynor, unavailable 51, 51 (`L23`) | yes, wholly: **superseded** (RUN-ORDER.md fold-in 11, part 5). This row once read that quest_points.md's standalone Goblin Diplomacy assumed a glory (~45 i), so about +45. Q§3's 188 is that standalone figure and carries ~127 of travel (the Falador teleport and walk to the Rusty Anchor, then the run from the bartender to Goblin Village; quest_points.md:147-150), all of it already in this leg and S24's inside legs (`L24a`-`L24c`), so Goblin Diplomacy is ~61 from the Rusty Anchor (RUN-ORDER.md's S24 row) |
| S24 inside | Rusty Anchor | Kaqemeex (2924,3486) | Falador teleport + run | 74, 64 (69) | m | `L24a`, 2 runs | no (no step list) |
| S24 inside | Kaqemeex | Goblin Village generals (2957,3511) | run | 56, 52 (54) | m | `L24b`, 2 runs | no |
| S24 inside | Goblin Village | Romeo (3211,3425) | Varrock teleport, Romeo is beside the landing | 5, 4 (4.5) | m | `L24c`, 2 runs | no |
| S24→S25 | Romeo | west anvil (3188,3426) | run | 13, 13 (13) | m | `L24e`, 2 runs | no |
| S25→S26 | booth (3185,3436) | Champions' Guild door (3191,3364) | run | 39, 49 (44) | m | `L25`, 2 runs | yes: dragon_slayer.md counts Varrock teleport + ~65 tiles = 37 (i); from the booth it is a run, so about +7 |
| S26→S27 | Elvarg's exit teleport (2846,9636) (`quest_dragon.rs2:27-28`) | spiders (3288,3810) | Ardougne teleport + lever + Keep web + run | 179 | m | `L26L`, 1 run (agrees with `L13L` 181-182 from Lawgof) | no |
| after S27 | | | none: S27 is v1's last step, and time after the last level-up is not scored | 0 | r | playtime-audit.md | |

Wilderness legs ran at the route's combat stats (Attack 99, Defence 1, 42-45 HP, Prayer 43; the
run after S27 at 99s). Aggressive NPCs did not stop any walk, but they took up to 31 of 42 HP
(`hpMin` in the results file). Carry food on S13→S14, the S14 exit and S17→S18.

## 3. Hand-offs at the staging tiles

The giver (`giveAll`) requests first. The receiver (`receiveFrom`) clicks after seeing the request,
which is how a helper delivery runs. Receiver clock from its first click, 3 samples per case per
tile (`run-transitions-handoff.ts`, campaign run).

| Staging tile | 1 noted stack: receiver (giver) | 23 stacks, 10 noted + 13 unnoted: receiver (giver, events) |
|---|---|---|
| Lumbridge landing (3222,3222), S00/S01 | **4, 4, 4** (6) | **8, 8, 8** (10, 24) |
| Falador teleport landing (2965,3378), S05-S07 | 4, 4, 4 (6) | 8, 8, 8 (10, 24) |
| Ardougne teleport landing and market (2661,3301), S08-S18 | 4, 4, 4 (6) | 8, 8, 8 (10, 24) |
| Varrock west bank (3185,3436), S25 | 4, 4, 4 (6) | 8, 8, 8 (10, 24) |

This **confirms `speedrun/README.md`** (4 and 8) on a second host. Mixing noted and unnoted stacks
changes nothing. The lab has no other players, so "busy" and "quiet" tiles could not be told apart
here: the tile made no difference. On the demo, a crowded tile adds client load and possible
trade-request noise, which this lab cannot reproduce (unmeasured).

**Drop and pick up** (`run-transitions-handoff.ts`, Lumbridge landing, 3 samples each). The
helper drops k items on its tile and steps away. The receiver sees them 93-94 ticks later, which is
the 100-tick `objRevealTicks` counted from the drop, less this script's setup ticks. The receiver
then picks them up.

| Items | Receiver on the pile | Receiver on the next tile |
|---|---|---|
| 1 | 1, 1, 1 | 2, 2, 2 |
| 2 | 2, 2, 2 | 3, 3, 3 |
| 3 | 3, 3, 3 | 4, 4, 4 |

Pickups must go one at a time, each after the last item arrives. A burst of pickups fired together
keeps only the last one, because each pickup is an interaction that replaces the one before
(measured: 0 of 6 two- and three-item bursts completed). Against a 4-tick trade, a drop saves 3
ticks for one item and 1 for three items, and nothing from the next tile at three items. That
**corrects travel-and-overhead.md row 5** (4-7 per hand-off, i, against the 9 / 5 trade). The
saving is 0-3 per hand-off against `trade.ts`, and the cost is that SCORED must be logged out or
elsewhere for the 100-tick private window.

## 4. Agility placement (question 2)

All figures are m, no glory.

| Leg | Ticks |
|---|---|
| Mage Arena end (chamber guardian) → Wilderness course (`L16A`) | 111-117, mean 113 |
| Wilderness course → Ardougne knights (`L17n`, level-20 walk + Ardougne teleport) | 175-182, mean 177.7 (lever out: 184-187) |
| Mage Arena end → Ardougne knights directly (`L16B`, Ardougne teleport from the chamber) | 6, 6, 6 |
| Spiders (end of S27) → Wilderness course (`LB`) | 185-186, mean 185.7 |
| Spiders' own exit: walk to level 20 + teleport (`X14n`) | 70, 70, 70 (to level 30 + glory, unavailable: 31) |

- **S17 straight after S16 (v1):** 113 + 177.7 = **290.7**. S27 is then last and needs no exit.
- **S17 last, after S27:** S16→S18 6 + S27→S17 185.7 = **191.7**. S17 is then last and needs no exit
  (the course's exit, 177.7, is the one avoided).
- **S17 last is cheaper by 99 ticks.** With a glory it would still be cheaper, by 65 (113 + 144 −
  192). The spiders' exit leg (70) belongs to S14→S15 in both orders, so it doesn't change the
  comparison. In both orders the run ends deep in the Wilderness, and the course is levels 50-56,
  so the player-killer exposure is the same S17 block either way.

## 5. Enchant while walking (question 3)

travel-and-overhead.md row 2 measured that a run keeps its speed while enchanting every 3 ticks
over a 45-tile straight. Over the route's real legs:

| Measurement | Ticks | Label |
|---|---|---|
| S02→S03 run, coop to the row (`L02`) | 50 | m, 2 runs |
| S03→S05 on foot, row to Doric, no casts (`E0`, 367-370 tiles) | 202, 187 (194.5) | m, 2 runs |
| Same walk with 60 Lvl-1 Enchants riding from Magic 7, two refills of 26 rings (`E1`) | **252, 258** (255); 60 of 60 casts landed in both; 32 level-up pages dismissed | m, 2 clean runs of 4: one stalled at (3054,3283), and one detoured to 900 tiles and 578 ticks after interrupted clicks |
| S04→S05 Falador teleport + run (`L04`) | 46, 42 (44) | m, 2 runs |

The walking ticks where enchants could ride are S02→S03 (50) plus the on-foot S03→S05 (about 195),
so about 245 ticks, enough for about 80 casts at one per 3 ticks. But the casts are not free on
these legs. The enchanting run took 60 ticks longer than the plain walk. Each level-up page held
back a walk click, and a click must not share a cast's tick (row 2), so clicks waited for slots.

- **Walk to Doric's with enchants:** 255 + 2 ring top-ups by hand-off (8 each, section 3; they
  stand in for the lab's `::give` refills) = **about 271** (i on m parts).
- **Enchant standalone + Falador teleport:** 180 casting ticks (60 casts at 3, magic.md) + 2
  top-ups (16) + 44 = **about 240** (i on m parts); about 236 with magic.md's two 4-tick bank
  visits.
- **Standalone and teleport is cheaper by about 31 ticks**, and it is also the robust choice. The
  walk the enchants would ride costs 150 more than the teleport, and a single cast saves 3. The only
  ride worth having is S02→S03, which v1 walks anyway: about 15 casts at the measured 1-tick
  slowdown per cast save about 30 (i). That needs Lvl-1 Enchant from Magic 7, which S02's Wind
  Strike reaches.

## 6. Nature altar access (question 4)

From the Fishing Contest's end (dwarf at (2820,3487), the White Wolf Mountain tunnel; every option
starts with a teleport, so the exact start tile within Hemenster does not matter):

| Route | Ticks | Label |
|---|---|---|
| **Ardougne teleport, Captain Barnaby to Brimhaven (30 coins), run 120, nature talisman** (`L20S`) | **162, 161** | m, 2 runs |
| Falador teleport, run to the Port Sarim sailors (90), ship to Musa Point, run 195-198, talisman (`L20P`) | 312, 311 | m, 2 runs |
| Glory to Karamja (2918,3176), run 157-160, talisman (`L20G`), unavailable | 169, 166 | m, 2 runs |

The ship's dialogue and ride took 13 ticks and its gangplank 3, below primitives.md's stock 18 + 4.
This lab's client answers pages as they publish, which matches primitives.md's floor column. The
**talisman entry** (nature talisman used on the ruins at (2867-2869, 3018-3020), loc 2460) took
**3-4 ticks** in all 4 runs: `runecraft.rs2` `teleport_to_ruins` is a `p_delay(1)` and a
`p_telejump` to (2400,4835). The air altar's entry measured the same 4 ticks (`L05`).

The nature altar givers' round trip is helper time, which is free, so it does not enter the scored
total. For scheduling them: the Brimhaven route is about 160 ticks each way from Ardougne, by the
same measurement.

## 7. Druidic Ritual beside Doric's (question 5)

Legs, all m, 2 runs each:

| | v1 (Druidic Ritual in S24) | moved to S05 |
|---|---|---|
| Added at S05 | | Doric → Kaqemeex (`D1`): 42, 28 (35) |
| S24, from the Rusty Anchor | Falador teleport → Kaqemeex (`L24a`) 69, then Kaqemeex → Goblin Village (`L24b`) 54 | Falador teleport → Goblin Village (`L24d`): 76, 73 (74.5) |
| Total | **123** | **109.5** |

Moving it saves **about 14 ticks** (i on m parts). S05→S06 starts with the Falador teleport either
way, so leaving from Kaqemeex instead of Doric changes nothing. The Druidic Ritual's own steps
(Sanfew, the dungeon, Kaqemeex) are the same in both places.

**Taverley Dungeon at the early route's levels: not safe** (r from the map and NPC configs, i for
the verdict; no fight was attempted). The cauldron of thunder is behind the iron doors at
(2887,9829-9832). Opening them from outside animates a **suit of armour** (level 19, Attack 16,
Strength 14, 29 HP) that attacks (`area_taverly/dungeon/scripts/prison_doors.rs2:1-23`). The
corridor from the entrance ladder (2884,9798) to those doors passes **six unarmed skeletons**
(level 25, Attack, Strength and Defence 24, `huntmode=cowardly`, hunt range 1) at (2882,9826),
(2885,9819), (2885,9823), (2886,9812), (2886,9816) and (2887,9821) (`maps/m45_153.jm2` NPC section).
Armed skeletons (22), ghosts (19) and giant bats (27) stand just past the doors. Outside the
Wilderness, a `cowardly` NPC hunts any player whose combat level is at most twice its own
(`Npc.ts` `huntPlayers`, `checkNotTooStrong`). At S05, SCORED is about combat 31 (Defence 1, 10
HP, Prayer 1, Magic 59), so every one of them attacks. A skeleton's maximum hit is about 3
(Strength 24, no bonus), and at Defence 1 most attacks land. Three to four maximum hits kill a
10 HP account, and it has no Protect from Melee yet. The round trip is about 60 tiles past them.
A death costs far more than the 14 ticks the move saves, and logging out is refused within 16
ticks of combat. **Keep the Druidic Ritual in S24**, where SCORED arrives with 99 combat stats.

## 8. Leg total for order v1 and the alternatives

Sums of the leg means in section 2: m except where marked. S24's three inner legs are counted
because S24 has no step list that costs them.

| | Ticks |
|---|---|
| S00→S12 legs: 0 + 50 + 50 + 0 + 44 + 61 + 74 + 131 + 50 + 55.5 + 20 + 71 | 606.5 |
| S12→S13 (r) | 121 |
| S13→S14 | 181.5 |
| S14→S15 (i) | 173.5 |
| S15→S16 (r) | 158 |
| S16→S17 + S17→S18 | 113 + 177.7 |
| S18→S22: 49 + 42 (r) + 161.5 + 33 | 285.5 |
| S22→S23 + S23→S24 | 16.3 + 90 |
| S24's inner legs: 69 + 54 + 4.5 | 127.5 |
| S24→S27: 13 + 44 + 179 | 236 |
| **Order v1, no glory** | **about 2,286** |
| Alternative: S17 last (section 4) | −99, **about 2,187** |
| Alternative: Druidic Ritual beside Doric's (section 7), not recommended | −14 |
| Alternative: enchants riding S03→S05 on foot instead of the teleport (section 5), not recommended | +31 |
| Reference: if a glory were obtainable (S14 exit, S17 exit and S23→S24) | −124 |

**Against the tally.** These legs are not all new ticks. Several replace an arrival row that the
next step's quest document already counts (the last column of section 2). Those rows are S04→S05,
S07→S08, S09→S10, S11→S12, S12→S13, S15→S16, S18→S19, S19→S20, S22→S23, S23→S24 (the standalone
Goblin Diplomacy figure) and S25→S26. They add up to 47 + 129 + 103 + 74 + 121 + 158 + 33 + 42 +
10 + 45 + 37 = 799 counted in those documents, against 44 + 131 + 55.5 + 71 + 121 + 158 + 49 + 42
+ 16.3 + 90 + 44 = 821.8 here. So **about 1,464 ticks of the 2,286 are legs that no step total
counts yet** (1,365 with S17 last). **Correction (rs/111):** what the legs add to a sum of step
totals is larger, because the replaced arrival legs measured 22.8 more than the documents count:
2,286 − 799 = **about 1,487** (1,388 with S17 last). That is the figure to set against the main
tally's travel lump. RUN-ORDER.md section 6 nets each leg against its own document's arrival row. Hand-offs add 4-8 ticks each on top (section 3). Their count is the route's supply plan,
which is outside this page.

## 9. What is not settled

- **S03's Firemaking row** was assumed on the Lumbridge-Draynor road at (3200,3226), because
  firemaking.md measured its rows at Falador east. A row placed at the coop gate would cut S02→S03
  from 50 to about 0.
- **S18→S19** took the walker through two doors. sea_slug.md's door-free 29-tick run from the
  Ardougne landing suggests about 31 is reachable from the knights (i).
- **S14→S15's best method** is a composite of measured parts: walk to level 20, Ardougne
  teleport, then the measured Ardougne-landing tree route. It was not run end to end. The two
  end-to-end no-glory variants measured 187-188.
- **Enchant-while-walking** needs a sturdier walker before it is trusted on any leg longer than a
  straight road. Two of four runs went wrong once level-up pages interrupted clicks.
- **Busy-tile hand-offs** can only be measured on the demo, which this issue did not touch.


## 10. lib/travel.ts and runner/legs.ts: lab figures per leg

The legs of section 2 are built as runner Steps in `speedrun/runner/legs.ts` (STEP-MANIFEST.md
entry 11), each a hop list for `speedrun/lib/travel.ts`, the one route walker and transport
layer. The walker is a chained run: it clicks the furthest route tile within 20 and re-clicks 3
tiles before that click would end. On every tick, not only when a click falls due, it opens a
closed door or gate it sees on the route within that reach, so a door is opened on the first tick
the 15-tile loc scan lists it. After a stall it opens the nearest door or web. It decides nothing
from a browser frame published while the map region rebuilds (`sceneReady` false): that frame lists
no doors, and the browser drops a loc click sent during one (rs/484, Fight Arena S12 B: 44 ticks on
the browser against 35 on lite before, 37 after). It arrives only when the published position is inside the
destination's tolerance. It follows this document's rules: no glory, and no casting while
walking (section 5). Where a quest counts its own arrival (RUN-ORDER O6), the leg ends exactly at
the quest's first tile and carries the full figure below. The quest module does not travel there
itself. T19-20 now ends beside the tunnel stairs at (2820,3486), tolerance 1; (2820,3484) is the
stairs loc.

Measured on the lab (`lab/measure-legs.ts`, local Mac, 300 ms, `::tele` to the earlier step's end
tile with that step's route stats and items; clock from the first send to the first state inside
the destination). Reference labels: m measured, i inferred, r read from a quest document.

| Leg | Reference | Measured (runs) | Delta |
|---|---|---|---|
| T01-02 | 50 m | 50 (51, 49) | 0% |
| T02-03 | 5 i | **4** (4, 4) | first measurement |
| T04-05 | 44 m | 43.5 (46, 41) | -1% |
| T05-06 | 61 m | 61.5 (64, 59) | +1% |
| T06-07 | 74 m | 79 (83, 75) | +7% (Taverley gate closed in the 83) |
| T07a | 46 i | **58** (58, 58), 114 tiles | first measurement |
| T07-08 | 131 m | 131.5 (135, 128) | 0% |
| T08-09 | 50 m | 49 (50, 48) | -2% |
| T09-10 | 55.5 m | 55.5 (54, 57) | 0% |
| T10-11 | 20 m | 20 (20, 20) | 0% |
| T11a | 36 m | 36 (36, 36) | 0% |
| T11-12 | 71 m | 71.5 (71, 72) | +1% |
| T12-13 | 121 r | 101.5 (103, 100) | -16% (faster than dwarf_cannon.md's figure) |
| T13-14 | 181.5 m | 180.3 (182, 178, 181) | -1% |
| T14-15 | 173.5 i | **174** (173, 175) | first measurement |
| T15-16 | 158 r | 143.5 (145, 142) | -9% |
| T16-18 | 6 m | 6.2 (7, 6, 7, 6, 6, 5) | +3% |
| T18-19 | 49 m | 49 (49, 49) | 0% |
| T19-20 | 42 r | 39.5 (39, 40) | -6% |
| T20-21 | 161.5 m | 158 (158, 158); ship 17-18 = deck 14-15 + gangplank 2 | -2% |
| T21-22 | 33 m | 32.5 (33, 32) | -2% |
| T22-23 | 16.3 m | 18 (21 with three castle doors closed, 15 with them open) | +10% |
| T23-24 | 90 m | 91.5 (93, 90) | +2% |
| L24a | 69 m | 67.5 (69, 66) | -2% |
| L24b | 54 m | 54 (56, 52) | 0% |
| L24c | 4.5 m | 4.5 (4, 6, 4, 4, 4, 5) | 0% |
| T24-25 | 13 m | 13 (13, 13) | 0% |
| T25-26 | 44 m | 41.5 (39, 44) | -6% |
| T26-27 | 179 m | 180 (180, 180) | +1% |
| T27-17 | 185.7 m | 185.5 (186, 185) | 0% |

S21 at the body altar, the plan in force (`legsFor({ s21Altar: 'body' })`, `measure-legs.ts:T20-21,T21-22:3:body`):
T20-21 by Falador teleport, a run to the ruins south of Edgeville and the body talisman,
**69.3** (72, 67, 69: teleport 4, run 57-62 over ~118 tiles, talisman entry 6), against the
nature route's 158 by the Brimhaven ship; T21-22 from the body altar room 32.7 (32, 33, 33).

Transports that no leg rides (`measure-legs.ts:transports`, one run each): glider Ta Quir Priw
to Gandius 9, back 9, to Kar-Hewo 9; Lumdo Crash Island to Ape Atoll 7, back 13; Ape Atoll
roofs (`APE_ATOLL_ROOFS`) 111, against rs/201's 112 with `bot.walkTo`; the Deserted Keep lever
out 10; Port Sarim ship to Karamja 17. Every spell teleport took 4 ticks (5 once).

**Doors and gates** (the `doors` field of each run's `RESULT leg` line). Each door met closed
costs a leg about 2 ticks against meeting it open:

| Leg | Door or gate (tile) | Seen |
|---|---|---|
| T01-02 | coop gate (3236,3295) | closed in every run |
| T04-05 | Doric's door (2949,3450) | closed, then open |
| T06-07, L24a | Taverley gate (2935,3451) | closed in one run, open in the other |
| T07-08 | three Seers' doors (2578, 2574, 2570; z 3333) | closed in one run, open in the other |
| T12-13 | door (2616,3345), Lawgof's gate (2568,3458) | closed in one run, open in the other |
| T13-14, T26-27 | Ardougne door (2650,3305), lever-house door (2564,3310), Wilderness gate (3224,3904) | closed, then open |
| T15-16 | lever-house door (2564,3310) | closed, then open |
| T18-19 | market door (2674,3305) | closed |
| T22-23 | Lumbridge Castle large doors (3217,3218), (3213,3220), door (3207,3217) | all closed in one run (21), all open in the other (15) |
| T23-24 | Rusty Anchor door (3053,3259) | open |
| L24b | Goblin Village door (2958,3506), large doors (2958,3509) | closed, then open |
| T24-25 | Varrock door (3187,3428) | open |
| T27-17 | Wilderness gates (3225,3903), ridge gate (2998,3931) | the ridge gate closed |

Two lab rehearsals of the demo chain passed end to end: T01-02 51, T23-24 91 and 94, L24a 69,
L24b 56, L24c 5 and 6, T06-07 75, T21-22 32.

**Demo check** (rs/198, 05:26:14-05:29:04Z 2026-10-22, the lent account cairn_h55, one launch of
`speedrun/tools/demo-legs.ts` at 2d6ff2a9, whose tree matches the mission branch's 576b7a55).
The SDK and the lite client both went through a loopback gateway on bbs (127.0.0.1:7823), never
the demo relay. The 19:10 PDT attempts had gone through the relay, because the account's bot.env
had no GATEWAY_URL. Untimed prep: 200 coins from the account's bank, runes from Aubury's, a
Lumbridge teleport and a walk to the spawn. The bar is the lab mean within 10%, or the lab's own
spread where that is wider.

| Leg | Demo | Lab | Δ | Bar | Doors met (state) |
|---|---|---|---|---|---|
| T01-02 | 51 | 50 | +2.0% | pass | none |
| T23-24 | 94 | 91.5 | +2.7% | pass | door (3053,3259) open |
| L24a | 68 | 67.5 | +0.7% | pass | gate (2936,3450) open |
| L24b | 60 | 54 | +11.1% | miss | door (2958,3506) closed; large doors (2958,3509) closed, (2958,3510) open |
| L24c | 8 | 4.5 | +3.5 | miss (bar ±1.5) | none |
| T06-07 | 76 | 79 | -3.8% | pass | none |
| T21-22 | 36 | 32.5 | +10.8% | miss (bar 3.25) | none |

The misses are read from the hop breakdowns, not measured separately. L24b met two closed doors at
about 3 ticks each, the whole gap, the same door-state split as T22-23 in the lab. The two teleport
misses are NOT landing spread: the landing tables below put L24c at 4-7 and T21-22 at 32-34 over
every tile seen, and the demo's 8 and 36 lie above both. On the demo, L24c's Varrock cast took 5
ticks (4 in all 80 lab casts) and then a 3-tick walk-on. T21-22's Lumbridge cast took 4 and its run
32 (28-30 in the lab). The demo's other casts split the same way: the Falador cast took 5 for T23-24
and L24a, and 4 for T06-07. So the excess is a demo-side cost of about 1-3 ticks on a teleport leg,
a cast or walk click landing a tick late, which one reading per leg can't size further. The clean
legs are within 3%, and T06-07 came in 3 ticks under, so the walker itself is confirmed. Pricing
(rs/158, fold-in 13): door-bound legs at the closed-door figure for the expected and the open-door
figure for the best; teleport legs at the landing tables' cast mean for the expected.

**Landing tables** (rs/198, lab, 300 ms, patched travel.ts through `runLeg` as the run casts it,
Magic 99, every cast started outside both landing squares). L24c (Varrock teleport, walk-on to
(3211,3425)): 80 casts, 22 of 25 tiles seen, the cast 4 ticks every time; mean over casts **4.83**,
over tiles seen 4.98, range 4-7. Ticks by landing tile (casts in brackets):

| landing x \ z | 3422 | 3423 | 3424 | 3425 | 3426 |
|---|---|---|---|---|---|
| 3211 | 5.25 (4) | 5 (2) | 4 (5) | 4 (5) | 4 (6) |
| 3212 | 5 (2) | 5 (2) | 4 (5) | 4 (6) | 4 (2) |
| 3213 | 5 (4) | 5 (5) | – | 5 (4) | – |
| 3214 | 5 (2) | 5 (9) | 5 (3) | 5 (2) | 6 (3) |
| 3215 | 6 (1) | – | 6 (2) | 6.25 (4) | 6 (2) |

T21-22 (Lumbridge teleport, run to (3241,3248)): 40 casts, 14 tiles seen (x 3219-3222, z
3216-3220), the cast 4 ticks every time; mean over casts **32.98**, over tiles 32.93, range 32-34.
x 3222 gives 32-33 (z 3216, 3218, 3219: 32; z 3217, 3220: 33), x 3221 gives 33 (z 3216-3220), x
3220 gives 33 (z 3218, 3219), x 3219 gives 34 (z 3218, 3219). The cast means (4.8 and 33.0, against
the earlier lab means 4.5 and 32.5) are the expected figures.

**Browser client** (rs/308, phase 1: before rs/309's region-loaded wait; lab, bgsrv-mac, 300 ms,
`measure-legs.ts --client=browser`, a headless Chrome tab on the lab's /bot page with this
checkout's bundle, and the lite runs beside it on the same machine; observed ticks; the per-hop
timeline is `lab/leg-trace.ts`):

| Leg | Lite, same machine | Browser | Browser, 3 ticks' wait after the landing (diagnostic) | Where the browser loses |
|---|---|---|---|---|
| T05-06 | 60.7 (61, 61, 60) | **74.1** over 11 runs (64-77); 1 failure in 12 | 66, 66, 66 (63 less the wait) | the first walk click, sent on the landing tick, misroutes: the player walks 14 tiles south (2964,3379 to 2965,3365) for an east target, 128 tiles against 107; in 9 of 11 runs |
| T20-21 (body) | 69 (67, 69, 71) | **74.7** (69, 85, 69, 67, 70, 88) | 71, 72, 72 | the same misroute after the Falador landing in 2 of 6 (+16, +19) |
| T10-11 | 20 (20, 20, 20) | 21 (21, 21, 21) | - | the run's first click after the stronghold landing doesn't move the player; re-sent a tick later |
| T13-14 | 179.7 (185, 176, 178) | 189.3 (211, 179, 178) | - | the first run's knife on the keep web (a cold region after the lever) drew no reply 6 times, re-sent every 6 ticks by act: 47 ticks against 20-24 |
| T14-15 | 173.7 (173, 174, 174) | **fails 3 of 3** | - | the stronghold tree hop finds no spirit tree at the village (2542,3169) straight after the young tree lands there: the loc lookup runs before the region is built |

With the first walk click held until the region is built, T05-06's run hop is 55 against lite's
53-54 (an 8-tick wait gives 55-56 too), so the browser's T05-06 excess is the click after the
landing, not the route or the door. The one unexplained browser failure (the air talisman not in
the published inventory at the ruins, although the leg's precondition saw it) did not recur in
6 more runs. Lite on the same machine: T02-03 6, 4, 4 (the coop gate (3236,3295) closed in the
6, not met in the others); T25-26 42, 42, 42 (no door met). First dialogue page after the click:
the spirit trees +1 to +2 on both clients; the Ardougne lever +4 on the first pull (the warning)
and no page after it, where act's 6-idle re-send sends a second pull at +7 or +8 that the
server drops (the landing at 10-11 either way).

**Browser client, phase 2** (rs/308, after rs/309's settle before every hop (#321, c4e2a681); lab,
bgsrv-mac, 300 ms, a scratch tree of the mission tip 9dc3d50f, browser and lite on the same host;
observed ticks). Every leg that clicks right after a teleport, spirit-tree or lever landing, 3 runs
a client; the door columns split each leg's runs by the state of the doors it met (`RESULT leg`
door records). No browser run misrouted after a landing. The first click after a landing goes +1
on the browser (the settle) and +0 on lite.

| Leg | Doors met | Browser, closed | Browser, open | Lite, closed | Lite, open | Catalogue |
|---|---|---|---|---|---|---|
| T04-05 | door 2949,3450 | 51, 50, 51 | 43, 43, 43 | 46 | 42, 42 | 44 |
| T05-06 | none | - | 64, 64, 64 | - | 60, 61, 60 | 61 |
| T06-07 | gate 2935,3451 | 81, 80, 81 | 74, 74, 74 | 78 | 74, 73 | 74 |
| T07-08 | 3 doors, 2570-2578,3333 | 138, 138, 140 | 129, 130, 130 | 134 | 128, 128 | 131 |
| T08-09 | none | - | 49, 50, 49 | - | 49, 50, 49 | 50 |
| T11-12 | none | - | 72, 73, 73 | - | 71, 72, 72 | 71 |
| T12-13 | door 2616,3345, gate 2568,3458 | 109 | 101 | 103 | 103, 99 | 121 (r) |
| T14-15 | door 2650,3305 | 181 | 178, 179 | 175 | 173, 173 | 173.5 |
| T16-18 | none | - | 8, 7, 7, 8, 7, 7 | - | 6, 7, 6 | 6 |
| T19-20 | none | - | 41, 39, 39, 42, 41, 41 | - | 39, 38, 39 | 42 |
| T20-21 (body) | none | - | 69, 70, 69 | - | - | 69.3 |
| T21-22 (body) | none | - | 34, 33, 34 | - | 33, 34, 33 | 33 |
| T22-23 | 3 large doors, Lumbridge castle | 24, 22, 23 | 15, 15, 14 | 21 | 15, 14 | 16.3 |
| T23-24 | door 3053,3259 (open in every run) | - | 98, 98, 98 | - | 94, 90, 90 | 90 |
| L24a | gate 2935,3451 | 72, 72 | 65, 65, 65, 66 | 70 | 64, 64 | 69 |
| L24c | none | - | 5, 6, 5 | - | 5, 4, 4 | 4.5 |

A leg's slow first run in a lab is its closed doors, not a cold region: each run after it finds
the doors the first one opened, and a fresh Chrome tab on an engine that had already been there
met them closed again and was as slow (T04-05 50, T06-07 81, T07-08 140, T22-23 23, L24a 72).
On the browser a closed-door leg costs 1-4 ticks more than on lite, an open one about 1 (the
settle). T05-06 costs +3.7 with no doors. T23-24 walks 177 tiles on the browser in every run
(lite 171 after its first run): the click from 3006,3289 to 3026,3270 takes 12 ticks against 9,
a longer client-side route on that stretch, cause not found. T12-13's 121 is the reckoned
teleport 4 + run 117; both clients measure 99-109. One browser Ardougne cast (T12-13, from
2566,3199) drew nothing and act re-sent it at +10, landing at +14: 1 in about 60 browser casts in
these labs, none on lite.

The lever legs and the stronghold tree landing, with the webs fix below (before it, in brackets):

| Leg | Browser | Lite | Catalogue |
|---|---|---|---|
| T10-11 | 21, 21, 21 | 20, 20, 20 | 20 |
| T13-14 | 181, 178, 177 (190, 177) | 179, 180, 176 | 181.5 |
| T15-16 | 148, 143, 140 (294, 198, 196) | 142, 145, 146; 147, 140 with the fix | 158 (r) |
| T26-27 | 181, 177, 179 (204, 209, 177) | 178, 177, 179 | 179 |

The lever pull is never re-sent on the browser since #321 (its script answers). The webs were
the browser's loss: the browser stamps a click's reply with the click's own tick (a knife at tick
25: "You fail to cut through it." stamped 25), lite with the next. `slashWeb` counted only
replies stamped from the click tick + 1, so on the browser it never saw an adjacent slash's reply
and waited out act's 6-tick idle re-send or its 30-tick limit: the Mage Bank web hop took 67-163
ticks against lite's 13-17, the keep web 47 against 20. It now reads replies past the message
cursor (`world.ts` messageCursor and messagesAfter, the SDK's observation-id rule), the same on
both clients: 13-15 on the browser. Phase 1's T13-14 knife that "drew no reply 6 times" was this,
not a cold region.
