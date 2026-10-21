# Quest points: the cheapest way to 32

**Short answer: the run needs no quest-point filler.** The only quest-point gate on the
planned route is the Champions' Guild door for Dragon Slayer (32), and
[dragon_slayer.md](dragon_slayer.md) recommends skipping Dragon Slayer. If it is done anyway,
the other planned quests already give 49 quest points (46 without Monkey Madness), so it only
needs to come after 32 of them. Filler is needed only if Dragon Slayer is pulled earlier
than that. For that case, and for the Legends' Quest arithmetic, this page ranks every
candidate by net ticks per quest point.

Three quests are worth doing for their own xp, whatever happens to Dragon Slayer: **Doric's
Quest** (1,300 Mining), **Sea Slug** (7,175 Fishing) and, about break-even, **Fishing
Contest** (2,437 Fishing). They are flagged for the Mining and Fishing routes below.

All ticks follow [CONVENTIONS.md](CONVENTIONS.md): stock / fixed / burst dialogue columns,
0.5 ticks per route tile, teleport 4, glory 6, trade 9 / 5 ([primitives.md](primitives.md)).
Filler figures are **inferred** from the quest scripts (step lists below and in the cited
sibling documents). They were not measured.

## Quest-point gates on this server (read)

| Gate | Points | Where | In the plan? |
|---|---|---|---|
| Champions' Guild door (Dragon Slayer start) | 32 | `areas/area_varrock/scripts/champions_guild.rs2:2` | Dragon Slayer is recommended against |
| Black Knights' Fortress (Sir Amik Varze) | 12 | `areas/area_falador/scripts/sir_amik_varze.rs2:15` | no |
| Heroes' Quest | 55 | `quests/quest_hero/scripts/quest_hero.rs2:2` | no |
| Legends' Quest | 107 | `quests/quest_legends/scripts/legends_guard.rs2:53` | no ([legends.md](legends.md)) |

`%qp` is recounted from completed quests at each quest completion
(`general/scripts/quests.rs2:89-302`), using the values in `general/configs/quest.constant:72-139`.

## Quest points the plan already has (read)

| Quest | QP | Document |
|---|---|---|
| Tree Gnome Village, The Grand Tree, Monkey Madness | 2 + 5 + 3 | [tree_gnome_village.md](tree_gnome_village.md), [grand_tree.md](grand_tree.md), [monkey_madness.md](monkey_madness.md) |
| Merlin's Crystal, Holy Grail | 6 + 2 | [merlins_crystal.md](merlins_crystal.md), [holy_grail.md](holy_grail.md) |
| Waterfall, Fight Arena, Knight's Sword | 1 + 2 + 1 | [waterfall.md](waterfall.md), [fight_arena.md](fight_arena.md), [knights_sword.md](knights_sword.md) |
| Priest in Peril | 1 | [priest_in_peril.md](priest_in_peril.md) |
| Dwarf Cannon | 1 | [dwarf_cannon.md](dwarf_cannon.md) |
| Watchtower, Temple of Ikov | 4 + 1 | [watchtower.md](watchtower.md), [temple_of_ikov.md](temple_of_ikov.md) |
| Digsite, Tourist Trap | 2 + 2 | [digsite.md](digsite.md), [tourist_trap.md](tourist_trap.md) |
| Plague City, Biohazard, Underground Pass, Regicide | 1 + 3 + 5 + 3 | Regicide chain (cairn://p/rs/15) |
| Death Plateau, Troll Stronghold, Troll Romance | 1 + 1 + 2 | troll chain (cairn://p/rs/18) |
| **Total** | **49** | |

Haunted Mine (2) is left out: it is on the skip list ([haunted_mine.md](haunted_mine.md)).

So if Dragon Slayer is done, schedule it after any 32 of these. For example, the gnome chain
(10), Merlin's Crystal and Holy Grail (8), Waterfall, Fight Arena and Knight's Sword (4),
Priest in Peril (1), Watchtower (4), Temple of Ikov (1), Dwarf Cannon (1), Digsite (2) and
Tourist Trap (2) make 33. Without Monkey Madness, the troll chain (4) makes up the difference. If some of these are dropped, the shortfall is a few points, and the ranking
below says which filler to buy.

## Ranking: net ticks per quest point

Net = the quest's ticks minus the training its own xp replaces, divided by its quest points.
Values use the rates the sibling documents use: Mining about 9.5 base xp per tick
([digsite.md](digsite.md)), Fishing about 9.1 (rs/7, via the coordinator), melee 14
([monkey_madness.md](monkey_madness.md)). Xp in skills that are already capped by other
quests (Attack, Strength, Hitpoints) is valued at zero.

| Rank | Quest | QP | Ticks stock / fixed / burst | Xp value (ticks) | **Net per QP** stock / fixed / burst | Notes |
|---|---|---|---|---|---|---|
| 1 | Sea Slug | 1 | ~300 / ~215 / ~160 | ~790 (7,175 Fishing, `caroline.rs2:45`) | **-490 / -575 / -630** | Worth doing for Fishing alone. Firemaking 30 via `stat()` (`quest_seaslug.rs2:43`) |
| 2 | Doric's Quest | 1 | ~75 / ~60 / ~51 | ~137 (1,300 Mining, `quest_doric.rs2:99`) | **-62 / -77 / -86** | Worth doing for Mining alone |
| 3 | Fishing Contest | 1 | ~292 / ~246 / ~230 | ~270 (2,437 Fishing, `quest_fishingcompo.rs2:112`) | **+22 / -24 / -40** | About break-even. Walking is ~186 of it |
| 4 | Goblin Diplomacy | 5 | ~229 / ~188 / ~162 (~140 / ~115 / ~100 on the Dragon Slayer route) | ~0 | **46 / 38 / 32** (28 / 23 / 20) | Best large filler. Shares Port Sarim and Ice Mountain legs with Dragon Slayer |
| 5 | Witch's House | 4 | ~174 / ~163 / ~157 | ~0 (6,325 Hitpoints, `quest_ball.rs2:202`) | **44 / 41 / 39** | Fight-heavy, so the dialogue fixes barely help. The witch's sight line resets progress |
| 6 | Cook's Assistant | 1 | ~41 / ~27 / ~20 | ~0 | **41 / 27 / 20** | Cheapest quest overall in ticks |
| 7 | Romeo & Juliet | 5 | ~301 / ~241 / ~201 | 0 | 60 / 48 / 40 | Long dialogues: gains most from bursts |
| 8 | Druidic Ritual | 4 | ~284 / ~239 / ~212 | ~0 (250 Herblore) | 71 / 60 / 53 | Prerequisite of Jungle Potion, if the Fishing route wants Tai Bwo Wannai Trio |
| 9 | Sheep Shearer | 1 | ~80 / ~68 / ~61 | ~0 | 80 / 68 / 61 | 20 handovers with `p_delay(1)` each |
| 10 | Sheep Herder | 4 | ~320 / ~295 / ~285 | 0 | 80 / 74 / 71 | Low confidence: prod count unknown |
| 11 | Imp Catcher | 1 | ~107 / ~94 / ~80 | small (875 Magic) | ~80-100 | Beads are tradeable |
| 12 | Black Knights' Fortress | 3 | ~265 / ~230 / ~210 | 0 | 88 / 77 / 70 | Needs 12 QP |
| 13 | Vampire Slayer | 3 | ~340 | 0 (Attack capped) | ~113 | |
| 14 | Witch's Potion | 1 | ~140 | small (325 Magic) | ~140 | One rat kill for the untradeable tail |
| 15 | Watchtower | 4 | ~1,100 | ~510 (15,300 Magic) | ~150 | [watchtower.md](watchtower.md) via the coordinator |
| 16 | Prince Ali Rescue | 3 | ~520 | 0 | ~175 | Route not optimised |
| 17 | Tourist Trap | 2 | 1,830 / 1,560 / 1,430 (measured) | ~1,060 | 385 / 250 / 185 | [tourist_trap.md](tourist_trap.md) |
| 18 | Demon Slayer | 3 | ~640 | 0 | ~215 | |
| 19 | Digsite | 2 | 2,180 / 1,930 / 1,790 (measured) | ~1,610 | 285 / 160 / 90 | [digsite.md](digsite.md); long tail on the finds |
| 20 | Restless Ghost, Rune Mysteries | 1 each | ~300 each | small | ~300 | Untradeable quest items; Rune Mysteries has a 28-page monologue |
| 21 | Horror from the Deep | 2 | 800-1,000 | ~63 | 370-470 | via the coordinator |
| 22 | Fremennik Trials | 3 | 3,130 / 2,640 / 2,320 (measured) | ~1,200 | 645 / 480 / 375 | via the coordinator; WC 40, Crafting 40, Fletching 25 |
| 23 | Knight's Sword | 1 | ~910 (measured) | ~235 | ~675 | [knights_sword.md](knights_sword.md) |
| | Murder Mystery, Pirate's Treasure | 3, 2 | ~1,000 each | 0 | 330-475 | Pirate's Treasure needs Karamja rum, whose source is unresolved |
| | Ernest the Chicken | 4 | unknown | 0 | | **Possibly blocked**: no source found for the rubber tube (`quest_haunted.obj:58-68`, tradeable=no). Unverified |
| | Shield of Arrav | 1 | ~130-400 | 0 | | The other gang's half is tradeable, but a helper must join that gang to fetch it |
| | Tai Bwo Wannai Trio | 2 | not costed (long) | ~715 (6,500 Fishing) | | Needs Jungle Potion (so Druidic Ritual), Fishing 65 for karambwan, a level-83 fight |

The ranking hardly moves between the columns. The bursts help the dialogue-heavy quests most
(Romeo & Juliet, Cook's Assistant, Goblin Diplomacy), and they would overtake Witch's House
only on the Dragon Slayer route. Sheep Herder and Witch's House barely change, because
fights and prodding dominate them.

**If filler is needed:** take Sea Slug, Doric's Quest and Fishing Contest first (net zero or
better, 3 QP), then Cook's Assistant (1), then Goblin Diplomacy (5) or Witch's House (4) for
larger gaps. All six together buy 13 QP for about 1,110 / 900 / 780 ticks, and their Fishing
and Mining xp (about 1,200 ticks of training) more than repays that: about -90 / -300 / -420
net (inferred).

## Step lists for the recommended fillers

Coordinates are absolute; dialogue runs use `c` (continue), `opt` (option) and `state`
(a page after which the server changes state). Helper items arrive in the run's one trade.

### Doric's Quest (1 QP, 1,300 Mining)

Items from the helper: 6 clay, 4 copper ore, 2 iron ore, all tradeable (`quest_doric.rs2:70-76`).

1. Falador teleport (4), walk to Doric (2952,3451), about 73 tiles (37).
2. Talk: "I wanted to use your anvils", accept. Stage 10 (`quest_doric.rs2:34-66`). About 6
   pages and 2 options.
3. Talk again with the materials: stage complete (`quest_doric.rs2:68-101`). About 7 pages, the
   last of which changes state.

Total ~75 / ~60 / ~51 ticks, against ~137 ticks of Mining (inferred).

### Cook's Assistant (1 QP)

Items: egg, bucket of milk, pot of flour (tradeable).

1. Lumbridge teleport (4), walk to the cook (3209,3215), 12 tiles (6).
2. Talk: "What's wrong?", "Yes, I'll help you". Stage 1 (`quest_cook.rs2:2-32`). Measured in
   [primitives.md](primitives.md) §1: 18-19 ticks stock, 9 fixed.
3. Talk again: the items go and the quest completes (`quest_cook.rs2:42-91`). About 5 pages.

Total ~41 / ~27 / ~20 ticks.

### Goblin Diplomacy (5 QP)

Items: 3 goblin mail, orange dye and blue dye (tradeable, `quest_gobdip.obj:29`,
`dyes.obj:31,46`). The dyed mails are `tradeable=no` (`quest_gobdip.obj:1,15`), so the
player dyes two of them (`goblin_mail.rs2:1-12`).

1. Port Sarim, Rusty Anchor bartender (3045,3257): "Not very busy". Stage 1
   (`bartender.rs2:7-18`, `quest_gobdip.rs2:13-19`). `opt, 4c state`.
2. Goblin Village, General Wartface or Bentnoze (2957,3511): four visits, each a greeting
   (3 pages), one option and a 5-page routine (`quest_gobdip.rs2:1-58`). Before visit 2, use
   the orange dye on a mail; before visit 3, the blue dye. Visit 4 hands in the plain mail and
   completes the quest.

Travel: Falador teleport and walking, about 127 ticks standalone (bartender and village are
150+ tiles apart). On the Dragon Slayer route the bartender is next to Wormbrain's jail and
the village is about 60 tiles from the Oracle, so travel drops to about 45 ticks (inferred).
Total ~229 / ~188 / ~162 standalone, ~140 / ~115 / ~100 on the Dragon Slayer route.

### Witch's House (4 QP)

Item: cheese (tradeable). The door key, magnet, shed key and ball are `tradeable=no`
(`quest_ball.obj:28-71`).

1. Boy (2928,3456): "Ok, I'll see what I can do". Stage 1 (`boy.rs2:10-13`).
2. Flower pot (2900,3474): search for the door key (`quest_ball.rs2:1-9`); open the front door.
3. Inside: cupboard for the magnet (stage 2, `quest_ball.rs2:65-78`); drop cheese at the mouse
   hole (about (2902,3466)); use the magnet on the mouse (stage 3, `quest_ball.rs2:102-116`).
4. Fountain (2909,3470): shed key (`quest_ball.rs2:162-169`). Shed door (2934,3463).
5. Take the ball (`quest_ball.rs2:171-196`): the experiment spawns. Kill its four forms
   (21, 31, 41, 51 hitpoints, `witches_house.npc`; stage 6, `witches_experiement.rs2:44-46`).
6. Return the ball to the boy: complete (`quest_ball.rs2:198-204`).

Risk: if the witch (`witch.rs2:1-34`) sees the player she teleports them out, deletes the shed
key and ball, and resets stage 3 to 1. Total ~174 / ~163 / ~157 ticks, with fights about 47.

### Sea Slug (1 QP, 7,175 Fishing): for the Fishing route

Caroline (2716,3302) at Witchaven; Holgart's boat to the fishing platform; Kennith; Kent on the
island; Bailey's torch. **It is completable**: damp sticks spawn at (2784,3289) and broken glass
at (2765,3278) and (2765,3289) on the platform (read, `maps/m43_51.jm2` OBJ section; both are
`tradeable=no`, so the player picks them up). Rubbing the dry sticks needs Firemaking 30
(`quest_seaslug.rs2:43`), and success is random (`stat_random(firemaking, 64, 512)`, `:48`).
The reachable part up to Bailey is about 182 / 117 / 81 ticks with 65 dialogue pages; the
torch, ladder, Kennith's crane and the return add roughly 120 more (inferred). Ardougne
teleport needs Plague City, which the Regicide chain does.

### Fishing Contest (1 QP, 2,437 Fishing)

Tunnel dwarf (2820,3487) gives the pass (`mountain_dwarf.rs2:8-71`); Bonzo (2641,3439) takes
5 coins; garlic in the pipe (2650,3441) moves the Sinister Stranger
(`quest_fishingcompo.rs2:85-94`); dig a red vine worm at McGrubor's Wood
(`mcgrubors_wood.rs2:44-48`) and catch the giant carp; hand the trophy to the dwarf
(`mountain_dwarf.rs2:91-102`). Fishing 10 via `stat()` (`hemenster_fishing.rs2:70`). About
372 route tiles of walking (~186 ticks) dominate the cost.

## Where this disagrees with legends.md

[legends.md](legends.md) uses placeholder filler ticks. Against this ranking:

| Quest | legends.md | Here (stock) |
|---|---|---|
| Witch's House | 700 | ~174 |
| Sheep Herder | 700 | ~320 |
| Romeo & Juliet | 400 | ~301 |
| Goblin Diplomacy | 250 | ~229 |
| Ernest the Chicken | 900 | possibly blocked (rubber tube) |
| Cook's, Sheep Shearer, Doric's, Imp Catcher, Witch's Potion | 550 together | ~445 together, and Doric's pays for itself |

Legends' list also leaves out Sea Slug and Fishing Contest, which cost nothing net. Neither
change affects that document's verdict: its quest-point gate still needs about 41 filler points.
