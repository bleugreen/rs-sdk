# Dragon Slayer

**Verdict: skip it.** The quest costs about **1,120 ticks** with the stock client
(about 1,010 with the fixed client, about 970 with dialogue bursts; about 370 of
those ticks are measured). It is worth at most **about 330 ticks** of training in
the planned route. Its 18,650 Strength is entirely wasted: Monkey Madness, Haunted
Mine, Waterfall and Troll Romance already put Strength past 99. Its 18,650
Defence fills only the 4,638 gap that Monkey Madness option 1 and Holy Grail
leave. Dragon Slayer pays for itself only if Monkey Madness is dropped (see
[Value](#value-what-the-xp-replaces)). Its 32-quest-point gate then costs
nothing extra, because the other planned quests already give 48-51 quest points
([quest_points.md](quest_points.md)).

Measured figures come from a local engine at the production tick rate
(`NODE_TICKRATE=300`), launched with `bash docs/speedrun/scripts/quest-dragon-lab.sh`
and driven by the scripts named in each row. Primitive costs (dialogue, doors,
teleports, trades) come from [primitives.md](primitives.md). Dialogue is given in the
three columns of [CONVENTIONS.md](CONVENTIONS.md): stock 2 ticks per page, fixed 1, and
burst (`ceil(k/5)` for a run of k pure continues, 1 per option or state page).

## Reward (read)

- `stat_advance(strength, 186500)` and `stat_advance(defence, 186500)`, which is **18,650 base
  each** (`quests/quest_dragon/scripts/quest_dragon.rs2:33-34`; measured: the lab account gained
  466,250 game xp in each, which is 18,650 x 25, `quest-dragon-elvarg.ts`).
- **2 quest points** (`^dragon_questpoints`, `general/configs/quest.constant:86`).
- Unlocks: wearing rune platebody and green d'hide body (`levelrequire/scripts/levelrequire.rs2:132-137`),
  and Oziach's shop. Neither matters to the speedrun.
- **The quest completes the moment Elvarg dies** (`quest_dragon/scripts/elvarg.rs2:13-14` queues
  `dragon_complete`, which also teleports the player out of the lair, `quest_dragon.rs2:27-29`).
  There is **no return trip to Oziach** on this server.

## Requirements as enforced by this server (read)

- **32 quest points, at the Champions' Guild door only** (`areas/area_varrock/scripts/champions_guild.rs2:2`).
  The Guildmaster's quest start has no check of its own (`guild_master.rs2:5-8`), but he stands
  inside the guild (spawn (3191,3362), door (3191,3363)). **Measured** (`quest-dragon-guild.ts`):
  with 0 quest points, talk-to on the Guildmaster from outside the closed door never opens a
  dialogue, and the door refuses ("The door won't open - you need at least 32 Quest Points").
  `dragon_journal.rs2:7` only changes the journal text.
- **No skill checks** anywhere in `quest_dragon/` or the NPC scripts on the route. The
  journal's "level 83 dragon" is advice.
- **Kill credit:** Elvarg's death completes the quest only for the player who landed the last
  hit (`elvarg.rs2:5-10`, `npc_findhero` plus `%npc_aggressive_player`). There is no `p_finduid`
  hand-off of the kind that loses Sir Mordred's death hook ([holy_grail.md](holy_grail.md)).
- **Lair gates need stage 9** (`crandor.rs2:31-45`), which only Ned's sailing sets
  (`dragonslayer_ned.rs2:22`). So the ship is mandatory; the Karamja secret wall
  (`crandor.rs2:11-27`) cannot replace it on a first visit.
- Gear: rune scimitar needs Attack 40 and rune armour Defence 40, as base levels
  (`levelrequire/`, see [holy_grail.md](holy_grail.md)). Rune platebody is locked until this
  quest is done (`levelrequire.rs2:132-137`), so the fight uses a rune chainbody.

The stage values are in `quest_dragon/configs/quest_dragon.constant`: 1 Guildmaster, 2 Oziach,
3 ship bought, 7 ship repaired, 8 map given to Ned, 9 sailed. Side varps: `%dragon_oracle`,
`%dragon_goblin` and `%dragon_shield` are set by Oziach's three answers, and `%dragonquestvar`
counts the planks. All of them are `scope=perm` (`quest_dragon.varp`), so **every step is
logout-safe**.

## Value: what the xp replaces

The melee rate is about 14 base xp per tick ([monkey_madness.md](monkey_madness.md)). Other
quests' Strength and Defence (read, base xp):

| Source | Strength | Defence |
|---|---|---|
| Monkey Madness option 1 / option 2 (`mm_daero.rs2:295-307`) | 35,000 / 20,000 | 20,000 / 35,000 |
| Haunted Mine (`hauntedmine_crystals.rs2:54`) | 22,000 | |
| Waterfall (`quest_waterfall.rs2:492`) | 13,750 | |
| Troll Romance (`quest_troll_love.rs2:304`) | 4,000 | |
| Holy Grail (`quest_grail.rs2:117`) | | 15,300 |
| **Level 99** | 39,938 | 39,938 |

| Plan | Strength gap before DS | Defence gap before DS | Useful DS xp | Worth (ticks) |
|---|---|---|---|---|
| MM option 1 (recommended by monkey_madness.md), all of the above | 0 | 4,638 | 4,638 | **~330** |
| MM option 2, all of the above | 0 | 0 | 0 | **0** |
| MM option 1, Haunted Mine dropped (its boss is unreliable) | 0 | 4,638 | 4,638 | ~330 |
| MM option 2, Haunted Mine dropped | 2,188 | 0 | 2,188 | ~155 |
| **Monkey Madness dropped** (it needs the rs/23 client fix) | 188 | 24,638 | 18,838 | **~1,345** |

Against a cost of about 1,120 ticks (stock), Dragon Slayer is a loss of about 800 ticks in
every plan that keeps Monkey Madness. It gains about 230 (stock) to 375 (burst) only if Monkey
Madness is dropped. One caveat in that case: melee training also gives a third of its xp as
Hitpoints, and quest Defence does not, so replacing Defence training with Dragon Slayer could
open a Hitpoints gap (inferred). The README should check that against the Hitpoints sources.

## Helper-supplied items (one trade, 9 ticks stock / 5 fixed)

All of these are tradeable (no `tradeable=no` in their configs):

- 12,000 coins (2,000 for the ship, `klarense.rs2:91-95`; 10,000 for Wormbrain, `wormbrain.rs2:296-302`)
- Wizard's mind bomb, silk, lobster pot, unfired bowl (magic door, `magic_door.rs2:180`)
- 3 planks, 12 steel nails, a hammer (`lady_lumbridge.rs2:157-187`)
- Rune scimitar, rune full helm, rune chainbody, rune platelegs, amulet of strength, about 10 sharks
- Amulet of glory (Edgeville, Draynor); runes for the Varrock, Lumbridge and Falador teleports

The **Dragonfire shield** is tradeable (`skill_combat/configs/melee/shields.obj:244-266`), but
the Duke only hands one to an account whose `%dragon_shield` was set by Oziach
(`duke_horacio.rs2:203`), and that needs 32 quest points. So the scored account fetches its own.
The map pieces, the Crandor map and the maze keys are all `tradeable=no`
(`quest_dragon.obj`), so the map work cannot be handed off.

## Step list

Raw counts per segment: route tiles, dialogue runs (`c` = continue page, `opt` = option,
`state` = page after which the server changes state), locs and fights. Walking at 0.5 ticks per
route tile. "Talk" adds 2 ticks for the click to the first page.

| # | Segment | Raw counts | Stock | Fixed | Burst | Basis |
|---|---|---|---|---|---|---|
| 0 | Trade the helper items | 1 trade | 9 | 5 | 5 | measured, primitives.md |
| 1 | Varrock teleport, walk to the Champions' Guild door (3191,3363) | 1 teleport, ~65 tiles | 37 | 37 | 37 | inferred |
| 2 | Open the guild door (32 QP); Guildmaster's welcome page | 1 door, `1c` | 5 | 4 | 4 | measured (`quest-dragon-guild.ts`) |
| 3 | Guildmaster: "Do you know where I could get a Rune Plate mail body?" Stage 1 (`guild_master.rs2:20-28`) | talk, `1c, opt, 3c state` | 12 | 7 | 5 | measured stock; fixed/burst inferred |
| 4 | Glory to Edgeville, walk to Oziach (3069,3517) | 1 glory, ~25 tiles | 19 | 18 | 18 | inferred |
| 5 | Oziach, full briefing in one conversation: rune plate, guildmaster, prove, dragon fun, where dragon, piece 1 (maze key), 2 (oracle), 3 (goblin), shield, farewell. Stage 2 (`oziach.rs2:46-143`) | talk, 30 pages + 10 options: `1c, opt, 2c, opt, 5c, opt, 2c, opt, 4c state, opt, 4c, opt, 4c state, opt, 2c, opt, 2c, opt, 2c, opt, 2c` | **82** | 42 | 23 | measured stock (`quest-dragon-guild.ts`); fixed/burst inferred |
| 6 | Walk to the Oracle (3015,3504); "I seek a piece of the map" (`oracle.rs2:15-19`, `%dragon_oracle` 2) | ~60 tiles; talk, `opt, 3c` | 40 | 36 | 34 | inferred |
| 7 | Walk to the Ice Mountain trapdoor (3019,3450), climb down to (3019,9850), walk to the magic door (3051,9840), use it with the four items (`magic_door.rs2:178-189`), open the chest (3057,9841) and take map part 3 (`magic_door.rs2:219-231`) | ~55 + ~40 tiles, 1 climb, 1 door, chest open (`p_delay(0)`) + search, `1c` | 61 | 60 | 60 | inferred |
| 8 | Lumbridge teleport, castle stairs, Duke (3212,3220,1): "I seek a shield" (`duke_horacio.rs2:258-263`) | 1 teleport, ~28 tiles, 1 climb; talk, `1c, opt, 2c state` | 32 | 27 | 26 | inferred |
| 9 | Falador teleport, walk to Melzar's Maze door (2941,3248) | 1 teleport, ~140 tiles | 74 | 74 | 74 | inferred |
| 10 | **Melzar's Maze**: key on the front door, then giant rat (red key), ghost (orange), skeleton (yellow), zombie (blue), Melzar (magenta), lesser demon (green), six coloured doors, about six ladders over three floors and the cellar, chest (2935,9657) for map part 1 (`melzars_maze.rs2`) | ~120 tiles, 7 doors, ~6 climbs, 6 kills, 6 key pickups, chest, `1c` | **260** (200-380) | 259 | 259 | inferred, see Fights |
| 11 | Walk to Port Sarim jail; Wormbrain, pay 10,000 coins for map part 2 (`wormbrain.rs2:270-304`) | ~90 tiles; talk, `opt, 2c, opt, 2c, opt, 1c, state, 1c` | 67 | 57 | 55 | inferred |
| 12 | Combine the three parts into the Crandor map (`crandor_map.rs2:34-45`) | 1 item-on-item, `1c` | 4 | 3 | 3 | inferred |
| 13 | Walk to the dock; Klarense: "I don't suppose I could buy it?", "Yep, sounds good" (2,000 coins). Stage 3 (`klarense.rs2:80-97`) | ~40 tiles; talk, `1c, opt, 3c, opt, 2c state` | 38 | 30 | 27 | inferred |
| 14 | Gangplank, ladder down to the hold, 3 planks on the hole (`lady_lumbridge.rs2:151-191`; stage 7 on the third), back up, gangplank off | 2 gangplanks, 2 climbs, 3 item-on-loc, `1c` x3 | 31 | 28 | 28 | gangplank and ladder measured (3, 4; `quest-dragon-voyage.ts`); rest inferred |
| 15 | Glory to Draynor, Ned (3100,3258): "You're a sailor?" (hire, `ned.rs2:128-153`), then use the map on him (stage 8, `ned.rs2:225-234`) | 1 glory, ~10 tiles; talk, `1c, opt, 9c`; item-on-NPC, `state, 2c` | 43 | 30 | 21 | inferred |
| 16 | Walk back to the Port Sarim dock | ~75 tiles | 38 | 38 | 38 | inferred |
| 17 | **Voyage**: gangplank 3, deck ladder 4, Ned "Yep lets go!" + `p_delay(11)` + 3 arrival pages 26, walk off the wreck to the rock opening and climb down 83, dungeon to the gate 14 | 1 + 1 climbs; talk, `1c, opt, state`, then `3c`; 147 + 22 route tiles | **130** | 124 | 122 | measured, 3 of 3 runs identical (`quest-dragon-voyage.ts`) |
| 18 | **Elvarg** at 70/70/70: gate 3, fight from the first attack to the kill | 1 gate, 1 fight | **139** (105-169) | 139 | 139 | measured, n = 4 (`quest-dragon-elvarg.ts`) |
| | **Total** | | **~1,120** | **~1,010** | **~970** | about 370 measured |

Notes on the route:

- The order is forced in places. Wormbrain only offers the map option once Oziach's third
  answer has set `%dragon_goblin` (`wormbrain.rs2:254`). The Oracle needs `%dragon_oracle`
  (`oracle.rs2:9`), and the chests only give their pieces while stage is 2-7
  (`crandor_map.rs2:52-56`). Ned takes the map only at stage 7 with `%dragon_ned_hired`
  (`ned.rs2:226`), so he is visited after the repairs.
- **Walking off the Crandor wreck.** The sail lands the player inside the hull at
  (2851,3235,0) (`^crandor_tele_coord`). The damaged hull does not block: walking straight
  out works, while the deck above is a dead end (measured, `quest-dragon-wreck-probe.ts`).
  The surface route to the rock opening is 147 tiles because of the island's cliffs.
  `bot.walkTo` took 81 ticks for it; chained clicks at 0.5 ticks per tile would take
  about 74, which would bring the voyage to about 122.
- The lite client does not list the Lady Lumbridge's gangplank or deck ladder in
  `nearbyLocs` (they sit on a bridge-flagged map level). Click them by tile and loc id:
  gangplank 2593 at (3047,3205), deck ladder 2590 at (3049,3208) (`quest-dragon-lib.ts` `clickLoc`).
- Melzar's Maze was **not measured**. It is a ladder maze over the ground floor, two upper
  floors and the cellar (ladders and coloured doors from the `m45_50` and `m45_150` map
  files), and it is the largest uncertain segment. Measuring it would only matter if the
  value side changes (Monkey Madness dropped), since the measured segments alone (about
  370 ticks) already exceed the 330-tick value in the recommended plan.

## Fights

### Elvarg (measured)

Level 83, 120 hitpoints, Attack/Strength/Defence/Magic 70, slash defence +40, stab +20
(`quest_dragon/configs/quest_dragon.npc`). Melee with 3 in 4 of her close-range attacks;
otherwise dragonfire (`elvarg.rs2:58-65`), and a ranged fireball whenever she is in
attack-at-range mode (`elvarg.rs2:86-105`). **Dragonfire max hit is 70**, cut to **10** by a worn
Dragonfire shield, with -3 more each for Protect from Magic and an antifire potion
(`elvarg.rs2:109-133`). Never fight her without the shield.

`quest-dragon-elvarg.ts`, gear: rune scimitar (aggressive), rune full helm, chainbody, platelegs,
amulet of strength, Dragonfire shield, sharks eaten below 45% hitpoints.

| Profile (Att/Str/Def/HP) | Runs | Fight ticks (first attack to kill) | Biggest hit | Lowest HP | Sharks | Level-up dialogs | Deaths |
|---|---|---|---|---|---|---|---|
| 99 | 2 | 64, 75 | 9 | 61 | 0 | 0 | 0 |
| **70** | 4 | **166, 132, 144, 102** (mean 136) | 10 | 22 | 1-3 | 1 | 0 |
| 40 | 2 | 269; one death | 10 | 0 | 7 | 4-10 | **1 of 2** |

The lair gate costs 3 ticks. The kill teleports the player out of the lair and the quest
scroll opens (1 click to close). Kill xp is small: about 490 base Strength and 160 base
Hitpoints at 70 (measured).

**Minimum safe stats (inferred):** her hits never exceeded 10, but at 40 Hitpoints two hits
in a row while a shark was still being eaten killed the account. Fight at 60+ Hitpoints, or
eat at 60%. At 40 melee the fight is twice as long, and 4-10 level-up dialogs interrupt it.

### Melzar's Maze (read stats, inferred ticks)

| Monster | Level | HP | Key | Ticks at 70 melee (inferred) |
|---|---|---|---|---|
| Giant rat | 6 | 10 | red | ~5 |
| Ghost | 19 | 25 | orange | ~12 |
| Skeleton | 22 | 29 | yellow | ~14 |
| Zombie | 25 | 30 | blue | ~14 |
| Melzar the Mad (magic: weaken, fire strike, cabbage, zap) | 43 | 44 | magenta | ~22 |
| Lesser demon | 82 | 79 | green | ~75 (Defence 71, like Elvarg's 70) |

Stats from `quest_dragon/configs/quest_dragon.npc`; keys drop on death
(`melzars_maze.rs2:68-136`). Tick basis: Elvarg's measured 0.9 hitpoints per tick at
Defence 70, and about 2-2.5 per tick against the low-Defence monsters (inferred). With
about 4 ticks per kill to engage and pick up the key, the fights are about 165 of the
maze's 260.

## Risks and gotchas

- **Death at low Hitpoints** in the Elvarg fight (measured, 1 of 2 at 40/40/40). A death after
  stage 9 keeps the stage, so the run can return by the Karamja secret wall only if
  `%dragon_wall` was set, which happens on leaving the lair through it (`crandor.rs2:11-27`).
  Otherwise it is a second voyage... which Klarense refuses at stage 9 (`klarense.rs2:19-27`);
  ask Ned again (`dragonslayer_ned.rs2:4`).
- Crandor's dungeon has aggressive monsters on the way to the gate: the voyage runs took
  0-8 damage (measured).
- Oziach hands over the maze key only if none is in the inventory or bank
  (`oziach.rs2:122`).
- Wormbrain needs `%dragon_goblin`, so ask Oziach all three map questions.
- Logout: every quest varp is `scope=perm` (read), so any segment may be split by a logout.

## Open questions

- Melzar's Maze end to end (the largest inferred segment). Worth measuring only if Monkey
  Madness leaves the plan.
- The travel legs marked inferred use straight-line tile counts plus a margin; Ice Mountain
  and the Port Sarim-Draynor road may route longer.
- Whether killing Wormbrain through the cell bars with a ranged or magic attack beats the
  dialogue purchase (about 20 stock ticks). Coins are free from helpers, so probably not.
