# Waterfall Quest

**About 1,200 ticks (about 6 minutes at 300 ms) walking, for 13,750 base Attack,
13,750 base Strength and 1 quest point, and it is a Legends' Quest prerequisite.**
The quest itself measured 1,060 ticks end to end; 775 of those are walking, and
two legs (Hemenster to Tree Gnome Village and back north to Glarial's tomb, about
450 route tiles each) are almost 500 of it. With Tree Gnome Village and The Grand
Tree already done, the spirit trees cut those two legs to roughly 100 ticks each
(inferred), bringing the quest to about 900. Going to Golrie's dungeon while doing
the gnome chain at Tree Gnome Village would remove one leg entirely.

All ticks are stock-client figures at the production tick rate (lab at
`NODE_TICKRATE=300`), measured with `docs/speedrun/scripts/quest-waterfall-run.ts`
unless labelled otherwise. Primitive costs come from `primitives.md`.

## Reward

- 13,750 base Attack and 13,750 base Strength: `stat_advance(attack, 137500)` and
  `stat_advance(strength, 137500)` (read, `quest_waterfall.rs2:491-492`).
  Measured: +343,750 game xp each (= 13,750 × 25).
- 1 quest point (read, `general/configs/quest.constant:127`).
- 2 diamonds, 2 gold bars and 40 mithril seeds (`quest_waterfall.rs2:488-490`); the
  chalice refuses the reward without 5 free slots (`quest_waterfall.rs2:466-469`).
- Legends' Quest checks `%waterfall_quest >= ^waterfall_complete` (`legends.md`).

## Requirements (as this server enforces them)

- **No quest or skill requirement.** Almera starts it with no check
  (`almera.rs2:3-17`), and no script in `quest_waterfall/` calls `stat()` or
  `stat_base()` (read, grep). The wiki's 30 Attack is not enforced.
- **Members:** the quest items are `members=yes` (`waterfall.obj`). The lab ran as
  members.
- **Glarial's tomb is refused if the inventory or equipment holds** gloves, any
  helmet, body, legs, shield or cape, any weapon (including pickaxes, axes, bows,
  thrown weapons), arrows, worn flowers, **runes**, logs, unstrung bows, knives,
  needles, thread, wool, leather, clue scrolls and caskets, or cannon parts
  (`quest_waterfall.rs2:44-100`). Jewellery is allowed, so a glory can come in.
- **Items the steps check:** a rope on the rock and on the tree (not consumed,
  `quest_waterfall.rs2:213-262`); Glarial's amulet held or worn at the ledge door
  (`quest_waterfall.rs2:267`); one air, earth and water rune on each of the six
  pillars, all 18 before the statue (`waterfall_pillars.rs2`,
  `quest_waterfall.rs2:417`); the urn on the chalice (`quest_waterfall.rs2:461`).
- **Stage gates that shape the route:** the bookcase gives the book only from
  stage 2 (`quest_waterfall.rs2:303-311`); Golrie's crate gives the key only from
  stage 3 (`quest_waterfall.rs2:319-327`); the statue works only at stage 6
  (`quest_waterfall.rs2:414`). Reading the book sets stage 3 from any lower stage
  (`baxtorian_book.rs2:6-8`), but the book is untradeable, so that is no shortcut.

## Items: helper-supplied and scored-account-only

| Item | Tradeable | Source for the run |
|---|---|---|
| Rope | yes | helper |
| 6 air, 6 earth, 6 water runes | yes | helper; must not be held at the tombstone |
| Runes for an Ardougne teleport (way in), a glory (way out) | yes | helper |
| Book on Baxtorian | **no** (`waterfall.obj:14`) | scored account: Hadley's bookcase |
| Golrie's key | **no** (`waterfall.obj:27`) | scored account: crate in Golrie's dungeon |
| Glarial's pebble | **no** (`waterfall.obj:38`) | scored account: Golrie |
| Glarial's amulet | **no** (`waterfall.obj:57`) | scored account: chest in the tomb |
| Glarial's urn | **no** (`waterfall.obj:69`) | scored account: Glarial's coffin |
| Baxtorian's key | **no** (`waterfall.obj:94`) | scored account: crate in the falls |

One trade (9 ticks) carries the rope and the runes. The 18 runes then have to be
out of the inventory at the tombstone: drop the three stacks next to it and pick
them up after the tomb (about 8 ticks, inferred), or take them in a second trade
after the tomb (9).

## Step list

Quest varp `%waterfall_quest` (perm), stages from `quest_waterfall.constant`: 0, 1
started, 2 spoken to Hudon, 3 read the book, 4 in Glarial's tomb, 5 in the falls,
6 in the puzzle room, 8 amulet on the statue, 10 complete. The pillars are bits
1-18 of `%pillar_waterfall_quest` (perm).

Measured column: one clean end-to-end run (1,060 ticks). Travel uses
`bot.walkTo`, about 13% slower than chained clicks (`primitives.md` §2).

| # | Where | Action | Varp | Raw counts | Ticks | Label |
|---|---|---|---|---|---|---|
| 0a | anywhere | Trade with a helper: rope, 18 runes, teleport runes, glory | | 1 trade | **9** | measured, `primitives.md` §6 |
| 0b | → Almera (2522,3498) | Ardougne teleport (Magic 51 and Plague City) lands (2661,3301), then run | | 1 teleport, 241 route tiles | 4 + 121 = **125** | inferred from the measured primitives; Camelot teleport is 317 tiles |
| 1 | Almera | "How can I help?" | 0 → 1 | 6 pages, 1 option | **18** | measured |
| 2 | → Log raft (2509,3493) | Run out the back | | 17 tiles | **14** (7-14, n=3) | measured |
| 3 | Raft (`lograft_waterfall_quest`) | Board; 4 × `p_delay(2)`, lands on the island (2512,3481); forced Hudon dialogue (`quest_waterfall.rs2:154-183`) | 1 → 2 | 8 pages, 4 delays | **31** | measured |
| 4 | Island | Run to (2512,3476), "Swim to" the rock: deliberately washed downstream to (2527,3413), next to Hadley's house (`quest_waterfall.rs2:187-210`) | | 5 tiles, `p_delay` 0+0+3 | **15** | measured; a free 70-tile ride south |
| 5 | → Hadley's stairs (2517,3429) | Run | | 35 tiles | **25** | measured |
| 6 | Hadley's house | Stairs up, search the bookcase (2520,3426, floor 1; `p_delay(2)`), read the book, close it, stairs down | 2 → 3 | 5 interactions | **16** | measured |
| 7 | → Tree Gnome Village cellar ladder (2533,3155) | Run, round Ardougne's west side and through the gnome maze | | 454 tiles (460 route) | **250** (250-313, n=3) | measured |
| 8 | Ladder | Climb down to Golrie's dungeon (2533,9555) | | 1 climb | **2** | measured |
| 9 | → Crate (2548,9565) | Run | | 21 tiles | **14** | measured |
| 10 | Crate (`golrie_crate_waterfall_quest`) | Search (`p_delay(2)`): Golrie's key | | 1 interaction | **5** | measured |
| 11 | → Golrie's gate (2515,9575) | Run | | 55 tiles | **37** | measured |
| 12 | Gate | Use the key (`p_delay(3)`), walk through | | 1 interaction | **7** | measured |
| 13 | Golrie (2515,9581) | Talk; looks through his junk (2 × `p_delay(2)`), Glarial's pebble; he keeps the key | | 8 pages | **31** (29-31) | measured |
| 14 | Gate | Walk to it and open from inside | | 5 tiles, 1 interaction | **6** | measured |
| 15 | → Ladder (2533,9555) | Run | | 34 tiles | **19** | measured |
| 16 | Ladder | Climb up | | 1 climb | **2** | measured |
| 17 | → Glarial's tombstone (2558,3444) | Run north again (drop the runes here) | | 448 tiles (451 route) | **247** | measured; rune drop not measured |
| 18 | Tombstone (`glarials_tombstone_waterfall_quest`) | Use the pebble: 3 × `p_delay(2)`, down to (2554,9844) | 3 → 4 | 1 interaction | **12** | measured |
| 19 | → Chest (2530,9844) | Run | | 22 tiles | **11** | measured |
| 20 | Chest | Open, search: Glarial's amulet | | 2 interactions | **7** | measured |
| 21 | → Glarial's tomb (2542,9811) | Run | | 42 tiles | **23** | measured |
| 22 | Tomb (coffin) | Search (`p_delay(1)` × 2): Glarial's urn | | 1 interaction | **7** | measured |
| 23 | → Ladder (2556,9844) | Run | | 38 tiles | **23** | measured |
| 24 | Ladder | Climb up to (2557,3444); pick up the runes | | 1 climb | **5** | measured; pickup not measured |
| 25 | → Log raft | Run | | 86 tiles | **55** | measured |
| 26 | Raft | Board (4 × `p_delay(2)`), no dialogue from stage 2 on | | 1 interaction | **9** | measured |
| 27 | Island | Run to (2512,3476), rope on the rock: wade across (forced moves) | | 5 tiles, 1 interaction | **24** | measured |
| 28 | Rock | Rope on the overhanging tree (2512,3465, `p_delay(1)`): down to the ledge (2511,3463) | | 1 interaction | **4** | measured |
| 29 | Ledge door (2511,3464) | Open with the amulet held (`p_delay(2)`): into the falls (2575,9861) | 4 → 5 | 1 interaction | **5** | measured |
| 30 | → Crate (2589,9888) | Run | | 33 tiles | **22** | measured |
| 31 | Crate | Search (`p_delay(2)`): Baxtorian's key | | 1 interaction | **5** | measured |
| 32 | → Corridor door (2568,9893) | Run | | 46 tiles | **30** | measured |
| 33 | Corridor door | Use the key, walk through | | 1 interaction | **2** | measured |
| 34 | → Puzzle-room door (2566,9901) | Run | | 7 tiles | **5** | measured |
| 35 | Puzzle-room door | Use the key (the stage check is on the opened door one tile north, `quest_waterfall.rs2:396`, `open_and_close_doors.rs2:38`) | 5 → 6 | 1 interaction | **3** | measured |
| 36 | Pillars (2562 and 2569, z 9910/9912/9914) | One air, earth and water rune on each (`p_delay(0)` each) | bits 1-18 | 18 interactions, 11 tiles | **50** | measured |
| 37 | Statue of Glarial (2565,9916) | Use the amulet: raised to the chalice room (2603,9914) | 6 → 8 | 1 interaction, `p_delay` 0+2+2 | **11** | measured |
| 38 | Chalice (2603,9910) | Use the urn (`p_delay` 0+2); completion queue | 8 → 10 | 1 interaction | **8** | measured |

The way out (a glory or spell to wherever the next quest starts) belongs to the
next quest's way in.

## Tick total

| Part | Ticks | Label |
|---|---|---|
| Travel | 775 (1,338 tiles walked) + 125 way in | measured; way in inferred |
| Dialogue (22 pages, 1 option: Almera, Hudon, Golrie) | 65 | measured (Golrie's 6 delay ticks included) |
| Interactions (book, crates, gates, doors, chest, coffin, ladders, ropes, 18 pillars, statue, chalice) | 164 | measured |
| Waits (raft × 2, the swim, tombstone, ledge door) | 56 | measured |
| Fights | 0 | |
| Trade, rune drop and pickup | 9 + about 8 | measured trade, inferred drop |
| **Total** | **about 1,200** | |

The quest itself, steps 1-38, measured **1,060 ticks** in one clean run. With the
client fix (cairn://p/rs/22), the 23 dialogue clicks save about 23.

**Spirit-tree variant (inferred).** With Tree Gnome Village (village tree) and The
Grand Tree (stronghold tree) done (`spirit_tree.rs2:1-5,25-29`):

- step 7 becomes Hadley → the Gnome Stronghold's south gate → the stronghold tree
  (about 130 tiles), the tree's dialogue (6 pages, 2 options, `p_delay(0)`, about
  20 ticks), landing at the village tree (2542,3169), and 14 tiles to the ladder:
  about 100 ticks instead of 250;
- step 17 becomes 14 tiles to the village tree, the dialogue, landing in the
  stronghold (2461,3444), and about 160 tiles out the south gate to the tombstone:
  about 110 ticks instead of 247.

That is about 285 ticks saved, so roughly **900** for the quest with the way in.
The SDK pathfinder cannot route through the stronghold's walls, so these tile
counts are map estimates, not routes.

## Risks and gotchas

- **The falls dungeon is the fire giant dungeon.** Fire giants (level 86),
  shadow spiders (they drain Prayer) and skeleton mages attacked the lab account on
  the way from the ledge door to the puzzle room; a 40-hitpoint account with no
  armour lost 9-15 hitpoints there. The scored account cannot wear armour into
  Glarial's tomb, but it can put armour on again after the tomb (another trade or
  carry it... it must not be in the inventory at the tombstone either), so plan
  enough Hitpoints or food for steps 29-36.
- **Golrie's dungeon** has hobgoblins; they did not damage the lab account.
- **Wrong moves cost hitpoints:** the statue without all 18 runes drops a boulder
  for 20 (`quest_waterfall.rs2:428-436`); the ledge door without the amulet, the
  tree's "Climb" option and the barrel each wash you downstream (8 damage on the
  first two).
- **Do not walk away from Golrie mid-conversation.** The dialogue pauses twice
  (`if_close`, `p_delay(2)`) before he hands over the pebble
  (`golrie.rs2:7-15`); walking off in that gap cancels the script and you get no
  pebble.
- **The swim op needs you near the rock.** From the raft's landing tile (13 tiles
  away) it says "I can't reach that!"; run to (2512,3476) first. The same holds for
  the rope.
- **Pathfinding:** `bot.walkTo` cannot route through Golrie's gate or the falls'
  locked doors; open them explicitly.
- **Logout:** both quest varps are permanent, so the quest survives a logout
  between steps. The rope crossing (steps 27-28) spawns temporary rope locs for 8
  ticks (`quest_waterfall.rs2:233-238`); do not log out in the middle of it.
  Nothing depends on a temporary varp (`primitives.md` §8).

## Open questions

- **Spirit-tree variant:** measure it once the gnome chain's quests are done on a
  lab account (the stronghold gate's behaviour and the exact route).
- **Combining with Tree Gnome Village:** if the gnome chain sends the scored account
  to the village anyway, steps 7-16 (Golrie) fit inside that visit, provided
  steps 1-6 come first (the crate needs stage 3).
- **The rune drop:** whether dropping and re-picking 3 stacks beside the
  tombstone (about 8 ticks, inferred) or a second trade (9) is cheaper.
- **Melee value:** 27,500 base Attack and Strength is worth whatever melee
  training it replaces at that point in the order; the README should check whether
  earlier quests already cap Attack and Strength.
