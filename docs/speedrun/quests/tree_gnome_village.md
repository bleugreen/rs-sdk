# Tree Gnome Village

**Verdict: about 860-920 ticks for 11,450 base Attack.** On its own that is roughly
break-even with training (11,450 / 14 per tick is about 820 ticks; inferred, the
combat rate in CONVENTIONS/README). It is worth doing because it is a prerequisite
for Monkey Madness (via King Narnode, `king_narnode.rs2:7-10`), and it unlocks the
spirit trees that make The Grand Tree and Monkey Madness cheaper.

The whole quest was played on the lab server by
`docs/speedrun/scripts/quest-tree-full.ts` (run as
`bun docs/speedrun/scripts/quest-tree-full.ts <bot>`). Unless marked otherwise,
every tick figure below is **measured** by that script (100 ms lab ticks, stock
lite client, `bot.walkTo` for walks). The warlord fight figure is from
`quest-gnome-fights.ts`.

## Reward

- **11,450 base Attack**: `stat_advance(attack, 114500)` (read,
  `quest_tree/scripts/quest_tree.rs2:98`; tenths, times 25 in `addXp`). Measured
  too: the full run gained 303,450 game xp = 12,138 base, which is the 11,450
  reward plus the warlord's combat xp.
- 2 quest points (read, `general/configs/quest.constant:124`).
- Gnome amulet (`quest_tree.rs2:97`).
- **Spirit trees.** The village tree (`stronghold_ent`) works only after this quest
  (read, `areas/area_gnome/scripts/spirit_tree.rs2:25-28`) and reaches the
  Battlefield of Khazard, Varrock forest and the Gnome Stronghold. The two young
  trees (Battlefield (2555,3260), Varrock (3177,3506)) also open, and take you to
  the village tree (`spirit_tree.rs2:50-62`). The stronghold tree stays closed
  until The Grand Tree is done (`spirit_tree.rs2:1-5`).

## Requirements as enforced by this server

- **No quest, skill or quest-point checks** anywhere in `quest_tree/`,
  `king_bolren.rs2`, `commander_montai.rs2` or `elkoy.rs2` (read).
- **Six normal logs** for Commander Montai: `inv_total(inv, logs) < 6` refuses,
  then `inv_del(inv, logs, 6)` (read, `commander_montai.rs2:25-33`). Tradeable.
- **The Khazard warlord** (level 112, 170 hp, attack 75, strength 78, defence 80,
  crush; read, `quest_tree/configs/gnome_battlefield.npc:76-112`). It is plain
  melee, so Protect from Melee (Prayer 43) blocks all of its damage (measured, 0
  damage in 5 of 5 kills). Without the prayer the run took 108-121 damage at
  70/70/70 (measured, two full runs). There is no minimum combat level: with the
  prayer any stats win, only the time scales.
- **No tracker gnomes needed.** On this server the ballista coordinates are fixed
  at 0004 / 0003 / 0005 and the trackers are never consulted (read,
  `quest_tree.rs2:6-8,20-26`).
- The warlord's death handler cannot lose the stage: if the player is busy it
  queues the hand-off instead (read, `khazard_warlord.rs2:26-33`).

## Helper-supplied items (one trade before the quest)

| Item | Qty | Why |
|---|---|---|
| Logs | 6 | Commander Montai |
| Rune scimitar (or any weapon) | 1 | warlord; rune scimitar needs base Attack 40 (`levelrequire/scripts/tier40.rs2:8`) |
| Prayer potions or Prayer 43 | | Protect from Melee for the warlord (prayer drains about 1 point per 5 ticks, measured; one warlord kill used 22-42 points) |
| Food | a few | only if not praying |

One trade costs 9 ticks (measured, `primitives.md` §6); it carries the logs for
all three gnome quests' needs.

## Step list

Coordinates are world tiles. "Pages" are dialogue continue clicks, "choices" are
option clicks; each costs **2 ticks** on the stock client (measured here and in
`primitives.md` §1). Walking ticks are measured with `bot.walkTo` (about 0.57 per
tile); the tile counts let the README re-cost them at 0.5 per tile.

| # | Step | Where | Answers | Stage | Raw counts | Ticks |
|---|---|---|---|---|---|---|
| 0 | Arrive at the maze entrance (Elkoy, 2504,3191) | | | | see Travel | |
| 1 | Walk the maze to the **loose railing** (2515,3161) and squeeze through (`gnomevillage_fence.rs2`, no requirement) | maze | | | 202 tiles + 1 squeeze | 111 + 3 |
| 2 | Walk to King Bolren (2541,3171) | village | | | 28 tiles | 16 |
| 3 | King Bolren: start. His dialogue ends with Elkoy leading you out to the maze entrance (`king_bolren.rs2:35`, `elkoy.rs2:133`) | (2541,3171) | Can I help at all? / I would be glad to help. | 0→1 | 18 pages, 2 choices | 42 |
| 4 | Walk to Commander Montai (2523,3212) | battlefield | | | 27 tiles | 15 |
| 5 | Montai 1 | | Ok, I'll gather some wood. | 1→2 | 9 pages, 1 choice | 22 |
| 6 | Montai 2: hands over the 6 logs | | | 2→3 | 4 pages | 10 |
| 7 | Montai 3 | | I'll try my best. | 3→4 | 12 pages, 1 choice | 28-32 |
| 8 | Fire the ballista (2508,3210) | | 0004, 0003, 0005 | 4→5 | 3 pages, 3 choices, `p_delay(1)` | 19-24 |
| 9 | Walk to the crumbled wall (2509,3253) | | | | 61 tiles | 37 |
| 10 | Climb over the crumbled wall; the Khazard commander's lines hold you for about 5 ticks (`quest_tree.rs2:56-64`) | | | | 1 page, exactmove | 6 |
| 11 | Open the door (2505,3256) to the ladder room (re-click: clicks during the commander's `p_delay` are dropped) | | | | 1 door | 14 |
| 12 | Ladder up (2503,3252), open the chest (2506,3259, L1), search it | | | 5→6 | 1 ladder, 2 locs, 1 page | 6 + 7-9 + 5-6 |
| 13 | Ladder down | | | | 1 ladder | 6 |
| 14 | Walk back to Elkoy at the maze entrance (2504,3193) | | | | 87 tiles | 52-55 |
| 15 | Elkoy jumps you into the maze beside the railing (`elkoy.rs2:62-79`) | | Yes please. | | 7 pages, 1 choice | 18-19 |
| 16 | Squeeze through the railing, walk to Bolren | | | | 1 squeeze + 28 tiles | 4-5 + 16-22 |
| 17 | Bolren: the orb. Elkoy leads you out again (`king_bolren.rs2:68-75`) | | I will find the warlord... | 6→7 | 16 pages, 1 choice | 36 |
| 18 | Walk to the Khazard warlord (around 2456,3300) | | | | 152 tiles | 90-91 |
| 19 | **Kill the warlord** (Protect from Melee) | | | 7→8 | fight | 164 mean (112-211) |
| 20 | Walk back to Elkoy | | | | 147 tiles | 81-87 |
| 21 | Elkoy jump in | | Yes please. | | 8 pages, 1 choice | 20-26 |
| 22 | Railing, walk to Bolren | | | | 1 squeeze + 28 tiles | 4-5 + 17-28 |
| 23 | Bolren: finish. 7 pages, the chant (the chat box stays closed for about 17 ticks: `p_walk`, four `p_delay(1)` chants and `p_delay(6)`, `king_bolren.rs2:98-118`), 7 more pages, the quest-complete scroll and a level-up page | | | 8→9 | 16 pages + 17-tick wait | 51-53 |

Step-by-step logs (one full run): `quest-tree-full.ts` prints a `STEP` line per
row; the dialogue text of every page is printed with `GNOME_DEBUG=1`.

## Travel

- **Into the village.** The maze walk (step 1) is the only way in before the quest
  starts: Elkoy refuses to guide you until Bolren has spoken to you
  (`elkoy.rs2:21-30`). After that, Elkoy's jump plus the railing (steps 15-16)
  replaces the 202-tile maze.
- **Arriving at the maze entrance.** The fastest way in is the Ardougne teleport
  (Magic 51, 2 law + 2 water; it also needs Plague City, `teleport.rs2:22-38`):
  197 tiles from the landing tile, 99 run ticks (measured offline,
  `quest-gnome-routes.ts`). The Battlefield young spirit tree, 83 tiles away, only
  works after this quest.
- **Leaving.** Bolren stands next to the village spirit tree (2543,3168): the
  next quest (The Grand Tree) starts by taking it to the Gnome Stronghold.

## Fight

| | Khazard warlord |
|---|---|
| Level, hp | 112, 170 hp (`gnome_battlefield.npc:76-106`) |
| Attack / strength / defence | 75 / 78 / 80, crush |
| Mechanic | none; spawns at its post, respawn 300 ticks |
| At 70/70/70, rune scimitar, Protect from Melee | **164 ticks mean** (112, 144, 152, 203, 211; 0 damage; 22-42 prayer points) (measured, `quest-gnome-fights.ts warlord`) |
| Same, no prayer, eating sharks | 184 and 220 ticks, 108-121 damage (measured, two full-quest runs) |
| Minimum safe stats | any, with Protect from Melee (Prayer 43); the time grows as accuracy and max hit fall |
| Combat xp gained | about 680 base in the trained style plus 227 Hitpoints (inferred: 170 hp x 4 and x 1.33) |

## Dialogue runs

CONVENTIONS notation (`c` continue, `opt`, `state` = a page after which the script
does something before the next page). Taken from the measured page logs: a page
followed by a gap of more than 2 ticks is a state page.

| Dialogue | Runs | Clicks | Stock | Fixed | Burst |
|---|---|---|---|---|---|
| Bolren start | 5c, opt, 8c, opt, 5c | 20 | 40 | 20 | 6 |
| Montai 1 | 7c, opt, 2c | 10 | 20 | 10 | 4 |
| Montai 2 | 4c | 4 | 8 | 4 | 1 |
| Montai 3 | 8c, opt, 4c | 13 | 26 | 13 | 4 |
| Elkoy in (twice) | 4c, opt, 3c / 5c, opt, 3c | 8 + 9 | 34 | 17 | 6 |
| Bolren orb | 12c, opt, 4c | 17 | 34 | 17 | 5 |
| Bolren finish | 7c, state, 3c, state, 2c, state, 1c | 16 | 32 | 16 | 8 |
| Ballista (an interaction) | 1c, opt, opt, opt, state, 1c | 6 | 12 | 6 | 6 |

All clicks plus 2-3 ticks of approach per talk are in the measured stock figures.

## Tick total

Stock = the measured run; fixed = 1 tick per page (cairn://p/rs/22); burst = runs
of k continues cost ceil(k/5) (CONVENTIONS). Travel is given both as measured
(`bot.walkTo`) and as the tile model (0.5 per tile + 1 per walk).

| Part | Stock | Fixed | Burst | Raw counts | Basis |
|---|---|---|---|---|---|
| Travel | 451 (tile model 391) | same | same | 760 tiles in 9 walks | measured, `quest-tree-full.ts` |
| Dialogue | 213 | 116 | 53 | 89 pages, 8 options (97 clicks) | measured |
| Interactions | 79 | 71 | 71 | railing x3, ballista, wall, door, 2 ladders, chest x2 (8 clicks) | measured |
| Fight | 164 | 164 | 164 | warlord | measured, `quest-gnome-fights.ts` |
| Waits | 17 | 17 | 17 | the chant | measured |
| **Total** | **924** (tile model **864**) | **819** (759) | **756** (696) | | |

Not included: getting to the maze entrance (see Travel) and the helper trade (9).
The single full run measured 944 ticks of steps (with the slower no-prayer warlord
kill of 184); the table uses the 5-kill mean. The lab ran at 100 ms ticks: the
warlord fight is reaction-dependent and was **not re-run at 300 ms**.

## Risks and gotchas

- **Commander scene after the crumbled wall** holds the player for about 5 ticks;
  clicks sent then are dropped (measured: the door click had to be re-sent).
- **The ceremony goes silent for about 17 ticks** in the middle of Bolren's last
  dialogue. A bot that treats a closed chat box as "done" stops early; the quest
  still completes because the completion is queued (`king_bolren.rs2:100`).
- **Level-up pages.** The 11,450 Attack arrives with a level-up page (2 ticks,
  included above). The warlord fight can add more at mid levels.
- **Bolren's dialogue ends with an automatic teleport out of the village**
  (steps 3 and 17). That is a saving: walking out through the maze would cost about
  100 ticks.
- **Logout-unsafe stretches:** none. `treequest` is a permanent varp and no step
  uses a temporary one (primitives.md §8). Logging out mid-dialogue just ends the
  dialogue; Bolren's completion is queued, so do not log out during the ceremony
  (step 23) until the scroll appears.

## Open questions

- Whether walking away from the last pages of a dialogue, after the stage is
  already set (for example the four Montai 3 pages after "I'll try my best"),
  safely skips them. It would save 10-30 ticks across the quest; untested.
- The warlord kill time at the stats the scored account will actually have when
  it does this quest (likely lower than 70/70/70).
