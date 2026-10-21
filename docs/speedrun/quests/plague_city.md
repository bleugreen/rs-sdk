# Plague City

**Verdict: do it, before The Grand Tree.** Cost about 620 ticks on the fixed client
(737 stock, about 564 with dialogue bursts), measured from a Camelot teleport. Its value is
about 915-930 ticks (inferred): 2,425 base Mining is worth 269 ticks on the demo server
(285 on a quiet one), because Doric's Quest alone leaves 4,034 ticks of mining to 99 and
Doric's plus Plague City leaves 3,765 (rs/2 `docs/speedrun/skills/mining.md` §2). The Ardougne
teleport it unlocks saves about 644 ticks in other documents' legs: Grand Tree ~290
(`grand_tree.md`, steps B and C), Mage Arena ~185 (`mage_arena.md`), Monkey Madness ~100
(`monkey_madness.md`, the Ape Atoll to the zoo leg), Waterfall ~38 (`waterfall.md`, 241
route tiles from Ardougne against 317 from Camelot) and Holy Grail ~31 (`holy_grail.md`
step 13, ~95 against 126). Fight Arena and Dwarf Cannon gain about nothing: the Khazard
spirit tree and Camelot are about as close (`fight_arena.md`, `dwarf_cannon.md`).
Watchtower would gain too, but it is a skip. Net about +300 ticks (fixed) or +350 (burst).
Conditions: the savings count only for quests done after Plague City (Grand Tree's ~290
is the largest), and the teleport needs **Magic 51**, checked with boosted `stat()`
(`skill_magic/scripts/magic.rs2:22`), plus 2 law and 2 water runes per cast from helpers.
Read the magic scroll at the end (`%elenaquest` 30, below), or the teleport stays locked.
Without the teleport uses, Mining alone (~270) does not cover the ~620.

**About 740 ticks (about 3.7 minutes at 300 ms) from a Camelot teleport, for 1 quest
point and 2,425 base Mining xp, and the gate to Biohazard and the Ardougne teleport.**
About 610 of those ticks are inside East and West Ardougne. Dialogue is the largest
share (117 page and option clicks), then the walks between houses. There is no fight
and almost no forced wait. The one random step is the West Ardougne clerk, who only
advances the quest when Bravek happens to be within 7 tiles (about half the time).

All tick figures are stock lite-client figures at `NODE_TICKRATE=300`, measured with
`docs/speedrun/scripts/quest-plague-city-segments.ts` unless marked otherwise.

## Reward

- **2,425 base Mining xp** (read: `stat_advance(mining, 24250)`, `quest_elena.rs2:12`;
  `stat_advance` takes tenths, `Player.ts` `addXp` then multiplies by the 25x rate, so
  60,625 game xp). From Mining 1 that is one level-up dialogue (measured: 1 page).
- **1 quest point** (read, `general/configs/quest.constant:91`).
- **A magic scroll** (`ardougnescroll`, `quest_elena.rs2:11`). Reading it sets
  `%elenaquest` 29 -> 30 (`elena_teleport_scroll.rs2:11-15`). **The Ardougne teleport
  needs 30, not 29**: `teleport.rs2:22` refuses below `^elena_complete` (29) and
  `teleport.rs2:35` refuses below `^elena_complete_read_scroll` (30). So reading the
  scroll (6 ticks, measured) is part of the quest for a speedrun. The spell also needs
  Magic 51 checked with `stat()` (boostable, `skill_magic/scripts/magic.rs2:22`) and
  2 law + 2 water runes (`magic_spells.dbrow:98-105`).
- **Unlocks Biohazard**: Elena's front door (2592,3339) stays locked below 29
  (`area_ardougne_east/scripts/doors.rs2:1-5`), and Elena starts Biohazard.

## Requirements (as this server enforces them)

- **None.** No `stat()`, `stat_base()` or `map_members` call in `quests/quest_elena/`
  or `areas/area_ardougne_west/scripts/` (read, grep). No quest prerequisite.
- Items the scripts check: dwellberries for Alrena (`alrena.rs2:11`), buckets of water
  and a spade on the mud patch (`mud_patch.rs2`), a rope on the pipe grill
  (`sewerpipe.rs2:23`), the gas mask **worn** to climb the pipe (`sewerpipe.rs2:5`), the
  picture for Jethick (`jethick.rs2:18`), the book for Ted (`doors.rs2:107`), the hangover
  cure for Bravek (`bravek.rs2:61`), the warrant at the plague house (`doors.rs2:28`), the
  small key for Elena's cell (`plaguehouse.rs2:34`).
- Coordinator finding 1 (wield requirements in `levelrequire/`, `stat_base`): none of the
  gas mask, doctors' gown or priest robes has an entry there (read, grep), so nothing in
  this quest or Biohazard has a wield requirement.

## Items: helper-supplied and scored-account-only

| Item | Tradeable | Source for the run |
|---|---|---|
| Dwellberries | yes (`gnome_cooking.obj`) | helper |
| 4 buckets of water, spade, rope | yes | helper |
| Chocolate dust, bucket of milk, snape grass | yes (`cooking.obj`, `cakes.obj`, `potions_additives.obj`) | helper |
| Chocolaty milk, hangover cure | **no** (`cooking.obj` `chocolaty_milk`, `hangover_cure.obj`) | scored account mixes them: dust on milk, then snape grass on the chocolaty milk (`cakes.rs2:131-143`, no level or stage check, so any time before Bravek) |
| Gas mask | **no** (`gasmask.obj`) | Alrena |
| Picture | **no** (`picture.obj`) | ground spawn in Edmond's house at (2576,3334) (`maps/m40_52.jm2` OBJ section, obj 1510) |
| Book, warrant, scruffy note, small key, magic scroll | **no** | Jethick, Bravek, the barrel, Edmond |
| Runes for Camelot teleport (arrival) | yes | helper |

**One trade (9 ticks, `primitives.md` §6)**: dwellberries, 4 buckets of water, spade,
rope, chocolate dust, bucket of milk, snape grass, and teleport runes (11+ slots). If
Biohazard follows, add its items to the same trade (see `biohazard.md`).

## Step list

Quest varp `%elenaquest` (perm, `_unpack/225/all.varp`), stages from
`quest_elena.constant`. "Ticks" run from the click to the effect (dialogue closed,
item gained, floor changed); walks are single run clicks with re-clicks if a click is
dropped. Pages/options are the clicks the step needs.

| # | Where | Action | Varp | Pages + options | Ticks | Label |
|---|---|---|---|---|---|---|
| 0 | anywhere | Helper trade | | | 9 | measured, `primitives.md` |
| 1 | → Edmond (2568,3334) | Camelot teleport, run 248 route tiles (one door, 2570,3333) | | | 4 + 125 = **129** | inferred, `quest-plague-city-routes.ts` |
| 2 | Edmond | "What's happened to her?", "Can I help find her?" | 0 → 1 | 15 + 2 | **37** (37, 38) | measured `start` |
| 3 | Edmond's house | Pick up the picture at (2576,3334) (through the inner door) | | | **16** | measured |
| 4 | Alrena (2573,3333) | Talk with dwellberries; she grinds them (two `p_delay(2)`) and gives the gas mask | 1 → 2 | 7 | **24** | measured |
| 5 | Edmond | Talk ("I've got the gas mask now"); required, the patch refuses water at 2 (`mud_patch.rs2:30`) | 2 → 3 | 3 | **9** | measured |
| 6 | anywhere | Chocolate dust on milk, snape grass on chocolaty milk | | 2 | 4 + 4 = **8** | measured `cure` |
| 7 | → mud patch (2566,3331-3333) | 3 tiles | | | 3 | inferred |
| 8 | Mud patch | Four buckets of water, each one mesbox | 3 → 7 | 4 | 4 × 4 = **16** | measured `mud` |
| 9 | Mud patch | Spade: objbox, fall into the sewer at (2561,9738), mesbox | 7 → 8 | 2 | **6** | measured |
| 10 | Sewer | Run to the pipe (2530,9701), 40 tiles | | | **26** (25, 26) | measured `sewer` |
| 11 | Pipe | Use the rope on the grill | 8 → 9 | 1 | **5** | measured |
| 12 | Sewer | Run to Edmond (2535,9719), talk (he pulls the grill), run back | 9 → 10 | 4 | 9 + 11 + 14 = **34** | measured |
| 13 | Pipe | Wear the gas mask; climb through to the manhole tile (2529,3304) | | | 2 + 9 = **11** | measured |
| 14 | → Jethick (2540,3305) | "I'm looking for a woman from East Ardougne."; shows the picture, gets the book | 10 → 20 | 11 + 1 | 6 + 27 = **33** | measured `west` |
| 15 | → Rehnison door (2531,3328) | Open: Ted takes the book and lets you in | 20 → 21 | 5 | 13 + 13 = **26** | measured |
| 16 | Ted Rehnison (2531,3331) | Talk | 21 → 22 | 3 | **8** | measured |
| 17 | Rehnison stairs (2527,3332) | Up, talk to Milli (L1), down, out of the door | 22 → 23 | 5 | 3 + 14 + 3 + 5 = **25** | measured |
| 18 | → plague house door (2533,3272) | 60 tiles, then open: mesbox, the mourner, "I fear not a mere plague." (shorter than the kidnap branch: 7 + 1 against 9 + 2) | 23 → 24 | 7 + 1 | 35 + 19 = **54** | measured |
| 19 | → clerk (2528,3317) | 44 tiles; stand at x = 2529 (see Risks); "I need permission to enter a plague house.", "This is urgent though!" | 24 → 25 | 7 + 2 | 27 + 20 = **47**, plus about **14** expected retries | measured (`clerk`, 5 of 8 tries advanced) |
| 20 | Bravek's door (2530,3314) | Open, run 4 tiles | | | 3 + 4 + 4 = **11** | measured `bravek` (3 tiles inferred) |
| 21 | Bravek (2536,3314) | "This is really important though!", "Do you know what is in the cure?" (the note) | 25 → 26 | 6 + 2 | **18** | measured |
| 22 | Bravek | Talk again with the hangover cure; "They won't listen to me!" (warrant) | 26 → 27 | 11 + 1 | **26** | measured |
| 23 | → plague house door | Out of Bravek's room, 50 tiles | | | **28** | inferred |
| 24 | Plague house door | Open with the warrant: the mourner, you sneak in | | 4 | **11** | measured `rescue` |
| 25 | Barrel (2534,3268) | Run 2 tiles, search: small key | | 1 | 6 + 6 = **12** | measured |
| 26 | Stairs (2536,3268) | Down to the basement, run to the cell door (2539,9672), unlock | | 1 | 1 + 3 + 4 = **8** | measured |
| 27 | Elena (2541,9672) | Talk | 27 → 28 | 4 | **10** | measured |
| 28 | Basement | Out of the cell, up the stairs, out of the plague house door | | | 3 + 2 + 4 = **9** | measured `exit` |
| 29 | → manhole (2529,3303) | 33 tiles, open, climb down (lands at (2530,9703)) | | | 18 + 2 + 2 = **22** | measured |
| 30 | Sewer | Run to the mud pile (2561,9738), climb (lands in the garden (2566,3331)), run to Edmond | | | 21 + 2 + 3 = **26** | measured |
| 31 | Edmond | Talk: reward queue (`edmond.rs2:41`), close the quest-complete scroll, Mining level-up | 28 → 29 | 2 + 1 level-up | 6 + 4 = **10** | measured |
| 32 | anywhere | Read the magic scroll | 29 → 30 | 2 | **6** | measured |

What the order is free to change: step 6 (mixing the cure) can happen at any point
before step 22, for example during a trade wait. The picture (step 3) can be taken any
time before Jethick. The order inside West Ardougne is fixed by the stage checks.

## Tick total

| Part | Ticks | Basis |
|---|---|---|
| Travel to Edmond (Camelot teleport + 248 tiles) | 129 | inferred, route tiles at 0.5/tile + 1 |
| Travel inside the quest (walks, doors, climbs, the sewer and manhole) | 250 | measured, except three short legs (34 ticks) inferred |
| Dialogue (108 pages + 9 options = 117 clicks at 2 ticks) | 234 | measured (step totals), consistent with `primitives.md` §1 |
| Interactions (approaches, item uses, the pickup, the pipe, Alrena's grinding) | 101 | measured: step totals minus the dialogue clicks |
| Clerk retries (expected) | 14 | inferred from the measured hit rate (about 0.5 per try, 18 ticks per miss) |
| Fights | 0 | read: none |
| Forced waits | about 8, already inside the interactions | read: Alrena `p_delay(2)` × 2 (`alrena.rs2:20-22`), mud pile and manhole `p_delay(0)` |
| Trade | 9 | measured, `primitives.md` §6 |
| **Total** | **about 737** (608 without the arrival teleport) | |

With the client fix cairn://p/rs/22 (1 tick per page or option), the dialogue drops by
117 ticks and the total to about 620.

### Dialogue in three columns

Columns as `CONVENTIONS.md` defines them. The stock and fixed columns come from the
measured page and option counts per step. **The burst column is inferred**: the step
scripts recorded counts, not the order of pages, so each dialogue is modelled as one
opening run of P - 2O continues, then for each option the click plus a 2-page run (the
player's echo line and the reply), which costs 1 + 2 = 3 ticks. Single mesbox pages
opened by an item use (the four buckets, the rope, the spade) and the two cure item uses
gain nothing. The README can replace the model with exact runs if it needs them.

| Step | Pages + options | Stock | Fixed | Burst (inferred) |
|---|---|---|---|---|
| 2 Edmond | 15 + 2 | 34 | 17 | 9 |
| 4 Alrena | 7 | 14 | 7 | 2 |
| 5 Edmond | 3 | 6 | 3 | 1 |
| 6 cure (item uses) | 2 | 4 | 2 | 2 |
| 8 buckets (one mesbox each) | 4 | 8 | 4 | 4 |
| 9 spade (objbox, fall, mesbox) | 2 | 4 | 2 | 2 |
| 11, 25, 26 (one page each) | 3 | 6 | 3 | 3 |
| 12 Edmond in the sewer | 4 | 8 | 4 | 1 |
| 14 Jethick | 11 + 1 | 24 | 12 | 5 |
| 15 Ted's door, 16 Ted, 17 Milli | 5, 3, 5 | 26 | 13 | 3 |
| 18 plague house mourner | 7 + 1 | 16 | 8 | 4 |
| 19 clerk | 7 + 2 | 18 | 9 | 7 |
| 21 Bravek | 6 + 2 | 16 | 8 | 7 |
| 22 Bravek, warrant | 11 + 1 | 24 | 12 | 5 |
| 24 plague house door, 27 Elena | 4, 4 | 16 | 8 | 2 |
| 31 Edmond, reward and level-up | 3 | 6 | 3 | 3 |
| 32 magic scroll | 2 | 4 | 2 | 1 |
| **Total** | **108 + 9** | **234** | **117** | **~61** |

| Column | Total (from the Camelot teleport) |
|---|---|
| Stock | ~737 |
| Fixed client | ~620 |
| Burst | ~564 |

The clerk's expected retries (14 ticks stock) shrink in the same proportion.

## Risks and gotchas

- **The clerk is random.** The stage only advances if Bravek is within 7 tiles of the
  *player* when the clerk's last page runs (`clerk.rs2:52`, `.npc_find(coord, bravek, 7,
  0)`, which searches round the player's tile). Bravek has no `wanderrange` in
  `bravek.npc`, so he drifts round (2536,3314), and before this step the player cannot
  stand east of x = 2529. From x = 2528 he is out of range even at his spawn. Measured
  from (2529,3316): 5 of 8 tries advanced (20 ticks, 7 + 2 clicks), the misses cost 18
  ticks (6 + 2) and must be repeated. Bravek's x when the dialogue ended was 2534-2536 on
  every hit and 2537-2538 on every miss, so a client can wait for him to drift west
  before clicking.
- **Walking into the plague house basement area and the Rehnison house needs the doors
  opened**; a run click cannot path through a closed door. Count each door as an op.
- **Wear the gas mask before the pipe**: without it Edmond refuses (`sewerpipe.rs2:7`).
- **Don't start Biohazard early**: at `%biohazard` >= 1 the mud patch says "The ground's
  been filled in" and digging no longer works (`mud_patch.rs2:15`).
- **Level-up dialogue (coordinator finding 2)**: one, Mining, when Edmond's reward queue
  runs (measured). No combat, so no other level-ups.
- **Findings 3 and 4** (death hook lost while delayed, kill-with-item checks): not
  applicable; Plague City has no fight.
- **Logout-safe.** `%elenaquest` is `scope=perm`; the only other var is
  `elena_pipe_used`, a 6-tick pipe cooldown (`sewerpipe.rs2:35-39`). The opened manhole
  is a 500-tick loc change that the manhole recreates.

## Open questions

- Whether equipping the gas mask while running (step 13) costs anything; it was measured
  standing (2 ticks).
- Whether the clerk can be talked to from a tile nearer Bravek through the office door
  frame; (2529,3316) was the closest tile tried.
- Arrival: the Camelot teleport is a placeholder; the README should cost the arrival from
  wherever the previous quest ends (Ardougne itself has no teleport until this quest is
  done).

## Scripts

- `docs/speedrun/scripts/quest-plague-city-segments.ts <bot> [segment...]`: segments
  `start cure mud sewer west clerk bravek rescue exit`.
- `docs/speedrun/scripts/quest-plague-city-routes.ts`: offline route tiles for every leg.
- The step driver (click-to-effect ticks, pages, options, level-ups, walks with re-clicks
  and a `bot.walkTo` fallback through closed doors) lives in
  `quest-plague-city-segments.ts`, shared with the Biohazard script, and is built on
  `speedrun/lib` (`actConverse`, `talkTo`, `clickWalk`, `walkTo`) and the
  `speedrun/lab/record.ts` Recorder.
