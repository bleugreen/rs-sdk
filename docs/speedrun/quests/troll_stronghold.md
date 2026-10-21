# Troll Stronghold

**About 659 ticks on the fixed client (682 stock, 650 burst) at 70 melee with
Protect from Melee, for 1 quest point and no xp at all.** This server's completion
queue gives only a law talisman and the quest point (read,
`quest_troll.rs2:364-369`); there is no Agility or Thieving reward. The quest is
worth doing only as the gate to Troll Romance and Eadgar's Ruse. It needs Agility
15 (`stat()`, so level 12 plus an Agility potion passes) for three climbing
obstacles on the only route to Dad's arena; the Trollheim rockslide on the way to
the stronghold can be walked around.

All fight and travel figures are measured at the production tick rate
(`NODE_TICKRATE=300`) with `docs/speedrun/scripts/quest-troll-lab.sh` driving
`quest-troll-fights.ts`, `quest-troll-walk.ts` and `quest-troll-obstacles.ts`, unless
labelled otherwise. Dialogue is costed from read page counts.

## Reward

- 1 quest point (read, `general/configs/quest.constant:130`), a law talisman
  (`quest_troll.rs2:368`). **No xp** (read, `quest_troll.rs2:364-369`; the wiki's
  Agility and Thieving reward does not exist here).
- Unlocks: Troll Romance (Ug, `ug.rs2:30`); the other half of Eadgar's Ruse's start
  check (`sanfew.rs2:102`); the stronghold's secret door from outside once Godric is
  freed (`quest_troll.rs2:108-114`).

## Requirements (as this server enforces them)

- **Death Plateau complete:** Denulth only offers the quest from
  `%death_equiproom` = complete (`death_ig_commander.rs2:6-9,62-89`).
- **Agility 15, `stat()`**, on every troll climbing obstacle: the rockslides
  (`quest_troll.rs2:7`), the climbing rocks (`:18,46`) and the mountain shortcuts
  (`:140,164`). The route to the arena crosses three of them (below), and the lab
  found no other way onto the plateau: Burthorpe's main Death Plateau path stops at
  2856,3606 (measured, `quest-troll-walk.ts plateau_main`). Because it is `stat()`, an
  Agility potion (+3, `consume_effects.dbrow:288-294`) lets level 12 pass. **The
  Trollheim rockslide at 2910,3686 is not needed:** the lab walked from the pass exit
  along x=2913 to 2912,3690 and on to the stronghold door (measured, `ts_pass`).
- **Climbing boots worn** for the Death Plateau rocks (`quest_death.rs2:159-177`) and
  for the rockslide at 2856,3612 from its south side (`quest_troll.rs2:11`). Wearing
  them needs Death Plateau complete (`quest_death.rs2:120-125`).
- **Thieving 30, `stat()`**, to pickpocket the cell key from Twig
  (`troll_stronghold_camp_guard.rs2:46`). Killing Twig instead also drops it
  (`drop tables/scripts/mountain_troll.rs2:5-8`).
- **Combat:** Dad must be brought below 20 hp (`troll_champion.rs2:116`) and a Troll
  General killed for the prison key (`drop tables/scripts/troll_commander.rs2:4-5`).
- **Wield requirements of the assumed gear** (`levelrequire/`, all `stat_base`): rune
  scimitar 40 Attack (`tier40.rs2:8`), rune armour 40 Defence.

## Items: helper-supplied and scored-account-only

| Item | Tradeable | Source |
|---|---|---|
| Climbing boots | yes | helper (who has done Death Plateau; Tenzing sells them for 12 coins) or buy from Tenzing |
| Weapon, armour, food, games necklace; the Troll Romance materials | yes | helper, one trade (9 ticks) |
| Prison key, cell key 1 | **no** (`quest_troll.obj`) | scored account: the General and Twig |

## Step list

Varps (`scope=perm`): `%troll_quest` (0, 10 started, 20 Dad beaten, 30 prison
entered, 40 Godric freed, 50 complete; `quest_troll.constant`,
`general/configs/quest.constant:63`), `%troll_varbit` bits (`quest_troll.varbit`).
The step list starts at Denulth, where Death Plateau ends.

| # | Step | Dialogue runs | Pages + options | Walk | Interactions + waits | Fight | Stock | Fixed | Burst | Label |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Trade: climbing boots, food, Troll Romance materials, games necklace |  |  |  | 9 |  | 9 | 9 | 9 | measured, primitives §6 |
| 2 | Denulth: "How goes your fight with the trolls?", "Is there anything...", "I'll get Godric back!" (0 -> 10); wear climbing boots | 2c,o,4c,o,2c,o,2c | 10 + 3 |  | 2 |  | 30 | 16 | 10 | read |
| 3 | Run to the Death Plateau rocks, climb, run to the rockslide (2856,3612) |  |  | 90 |  |  | 90 | 90 | 90 | measured (quest-troll-walk.ts plateau_dp_rocks) |
| 4 | Rockslide, climbing rocks 2860,3626 and 2879,3622, to the arena's west door (Agility 15 each) | 1c | 1 + 0 | 55 | 3 |  | 62 | 60 | 60 | measured (ts_out); door and Dad's line inferred |
| 5 | Fight Dad to surrender, "I'll be going now." (10 -> 20) |  |  |  |  | 123 | 123 | 123 | 123 | measured, 70/70/70 rune scimitar, n=5 (111-138) |
| 6 | North door, run to the troll pass |  |  | 22 | 3 |  | 25 | 25 | 25 | measured walks; door inferred |
| 7 | Pass tunnel, round the Trollheim rockslide on x=2913, stronghold door |  |  | 110 |  |  | 110 | 110 | 110 | measured (ts_pass) |
| 8 | Kill a Troll General, pick up the prison key |  |  |  |  | 112 | 112 | 112 | 112 | measured, 70 melee + Protect from Melee, n=3 (103-127) |
| 9 | North stairs to level 1, prison door (20 -> 30), stairs to level 0, run to Twig |  |  | 45 | 3 |  | 48 | 48 | 48 | measured (ts_in); prison door inferred |
| 10 | Pickpocket Twig for cell key 1 (Thieving 30, stat_random 60/300) |  |  |  | 3 |  | 3 | 3 | 3 | inferred; 89% at Thieving 70, see Risks |
| 11 | Unlock Godric's cell (30 -> 40) | 1c | 1 + 0 |  | 2 |  | 6 | 4 | 4 | read (quest_troll.rs2:241-309) |
| 12 | Games necklace to Burthorpe, run to Dunstan |  |  | 32 (61 route tiles) | 20 |  | 52 | 52 | 52 | inferred |
| 13 | Dunstan: Godric is home, quest complete (40 -> 50); close the scroll | 4c | 4 + 0 |  | 2 |  | 12 | 7 | 4 | read |

### Travel, measured

| Leg | Ticks | Script leg |
|---|---|---|
| Denulth to the Death Plateau rocks (67), climb (5), to the rockslide's south side (18) | 90 | `plateau_dp_rocks` |
| Rockslide 2856,3612 (2), run (15), climbing rocks 2859,3626 (3), run (12), climbing rocks 2878,3622 (5), run to the arena's west door (18) | 55 | `ts_out` |
| Arena west door to the north door (19), pass entrance (12) | 31 | `ts_out` |
| Pass tunnel in (1), through (19), out (1), along x=2913 past the rockslide (20), to the stronghold door (68), in (1) | 110 | `ts_pass` |
| Level 2 arrival to the north stairs (10), down (4), prison door (5 + door), down at the prison stairs (3 + 4), to Twig (19) | 45 + door | `ts_in` |
| Twig to the secret exit (18 + 1); not used: the necklace is faster | 19 | `ts_in` |
| Secret exit to Burthorpe on foot: rockslides 2833,3628 and 2856,3612, stile, Tenzing's hut, Dunstan | 80 + 8 + 76 | `secret_to_dunstan` (hut doors inferred) |

## Fights

Stats read from `quest_troll.npc` and `quest_troll_love.npc`; max hits inferred from
floor(0.5 + (strength + 8) × (strength bonus + 64) / 640).

| Monster | Level | Hitpoints | Att/str/def, bonuses | Style | Max hit (inferred) | Mechanic |
|---|---|---|---|---|---|---|
| Dad (`troll_champion`) | 101 | 120 | 60/120/50, +40 att, +70 str; def 25 stab/slash, 40 crush | crush, attack rate 8 | 27 | 1 attack in 3 swings a tree trunk that knocks you 7 tiles back and stops your attack (`troll_champion.rs2:40-89`); surrenders below 20 hp (`:116`); resets to full if you leave the arena or log out (`:101-109`) |
| Troll General | 113 | 140 | 70/140/40, +60 att, +100 str; def 35 stab, 60 slash, 35 crush | slash | 38 | `cowardly` hunt mode; other trolls on level 2 join in |

Measured (`quest-troll-fights.ts`, rune scimitar on aggressive, rune armour, amulet of
strength, 20 swordfish, eat below 50-60%):

| Fight | Stats | Runs | Ticks (click to surrender / key picked up) | Hp lost | Food | Deaths |
|---|---|---|---|---|---|---|
| Dad | 70/70/70 | 5 | 111-138, mean 123 | 6-61 | 0-2 | 0 |
| Dad | 40/40/40 | 2 | did not finish | | | **2 of 2**, about 120 ticks in, after about 50 of the 101 damage |
| Troll General | 70 + Protect from Melee | 3 | 103-127, mean 112 | 0 | 0 | 0 |
| Troll General | 99/99/99, no prayer | 3 | 92-131, mean 107 | 55-122 | 3-12 | 0 |
| Troll General | 70/70/70, no prayer | 1 | | 77 in 41 ticks | 3 | **1 of 1** |

Minimum I would call safe: **70 melee with Protect from Melee (43 Prayer)**, or 99
melee without it. Against the General the prayer blocks all melee
(`skill_combat/scripts/npc/npc_combat_melee.rs2:44`). Both trolls have slash defence
60 but stab and crush 35; a rune warhammer was slower than the scimitar against
Arrg (same stats, 120-207 ticks, `troll_romance.md`), so keep the scimitar.

## Tick total

| Part | Ticks | Label |
|---|---|---|
| Walking | 354 | measured legs plus one pathfinder leg (necklace arrival to Dunstan) |
| Interactions and waits (trade, doors, pickpocket, cell, necklace, scroll) | 47 | trade measured; rest inferred |
| Fights (Dad, General) | 235 | measured, 70 + Protect from Melee |
| Dialogue: 16 pages + 3 options | 46 stock / 23 fixed / 14 burst | read |
| **Total** | **682 stock / 659 fixed / 650 burst** | |

## Risks and gotchas

- **Agility 15 is real.** Three obstacles on the only route to the arena check it
  (2856,3612 rockslide `stat_random(160, 300)`; climbing rocks at 2859-2860,3626 and
  2878-2879,3622, `stat_random(170, 253)`, `quest_troll.rs2:30,59`). Success (read,
  `PlayerOps.ts:591-599`, current level): rockslide 70% at 15, 77% at 28, 100% from
  70; climbing rocks 71% at 15, 75% at 28, 89% at 70. Measured at 15: rockslide 4
  falls in 12; climbing rocks 7 falls in 24; each crossing took 2-5 ticks and a fall
  costs about the same plus 3 hp (rockslide) or 5% hp + 1 (`quest-troll-obstacles.ts`).
- **Twig's pocket at Thieving 30 is a coin flip** (`stat_random(60, 300)`, read): 51%
  at 30, 80% at 60, 89% at 70, 99% at 80. A failure wakes him and he attacks
  (`troll_stronghold_camp_guard.rs2:58-63`); then kill him (level 71, 90 hp) for the
  key or wait out the combat delay. Not timed.
- **Dad resets** if you leave the arena or log out mid-fight (`troll_champion.rs2:101-109`).
  His knockback interrupts your attack; re-attack after every swing. If he is killed
  outright instead of surrendering, the death queue still sets stage 20 (`:145-149`).
- **Aggressive trolls** in the pass tunnel killed a level-3 lab walker in 10 ticks;
  Troll Generals and mountain trolls on level 2 hunt players.
- **Logout:** `%troll_quest` and `%troll_varbit` are permanent; logout is refused in
  combat. Leaving mid-Dad-fight costs the fight.

## End state (for Eadgar's Ruse, cairn://p/rs/25)

The account ends at Dunstan in Burthorpe (2919,3573) with `%troll_quest` = 50
(complete) and a law talisman. In `%troll_varbit`: accepted the challenge, told,
entered the stronghold, to the death are set; **`troll_freed_eadgar` is not set** on
this route, and `troll_opened_back_exit` is not set because the route leaves by
necklace (the secret door opens anyway from stage 40, `quest_troll.rs2:109`). Freeing
Eadgar would add a second pickpocket (Berry, `troll_prison_guard2`, cell key 2) and
the cell (`quest_troll.rs2:251-301`), about 8 ticks while beside the cells; Eadgar's
cave entrance sends a freed Eadgar's visitor to level 2 (`quest_troll.rs2:129-131`).
Whether Eadgar's Ruse needs him freed is for rs/25 to check.

## Open questions

- **Dad below 70 melee.** 40 is a death; 50-60 was not measured.
- **Twig's failure branch** (fight or wait) is not timed.
- **The full quest end to end** was not run as one script; the figure is the sum of
  measured legs, measured fights and read dialogue.
