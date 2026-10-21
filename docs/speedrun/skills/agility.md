# Agility: fastest route to 99

Agility has to be trained by the scored account itself. Every number below is
labelled **read** (source cited as `file:line`; content under
`server/content/scripts/`), **measured** (local lab per
[../LAB.md](../LAB.md), script under [../scripts/](../scripts/) and sample
size) or **inferred** (arithmetic or model shown). Xp is base xp (game xp / 25)
and time is server ticks throughout.

All lap times assume **infinite run**. `NODE_INFINITE_RUN` defaults to true
(`server/engine/src/util/Environment.ts:47`), production does not override it
(`fly.toml`), and the lab used the same default, so run energy never ran down
(it read 100 on every lap). No obstacle here forces walking between
obstacles; the obstacles themselves move the player by script (`forcemove`,
`exactmove`), which run state does not affect.

The inferred tick totals come from
[`agility-model.ts`](../scripts/agility-model.ts), which combines the
measured lap and fall costs with the success-roll formula; rerun it with
`bun docs/speedrun/scripts/agility-model.ts`.

## 1. Recommendation

**With quests:** Agility's quest rewards are Grand Tree, Regicide, Troll
Romance and Underground Pass. Regicide requires Underground Pass, so the real
base is **32,650 base xp (level 96)**, not the 29,650 that leaves Underground
Pass out. From there the Wilderness course takes **about 1,035 ticks** to 99
(inferred). Two Tourist Trap picks, or one Legends pick, or Fremennik Trials
plus one Tourist Trap pick covers the remaining 7,288 base, and then Agility
needs **no course training at all**. The account needs **no Agility training
before the first quest** as long as Underground Pass (or Fremennik Trials, or a
Tourist Trap Agility pick) comes before Grand Tree. Otherwise it needs level 25
for Grand Tree's tree climb: 159 ticks of Gnome laps, or 122 ticks to level 22
plus an Agility potion.

**Without quests:** Gnome Stronghold course 1 -> 52, then the Wilderness course
52 -> 99, about **6,960 ticks** (inferred: 1,230 + 5,726). Using the Edgeville
dungeon monkey bars for 15 -> 52 cuts this to **about 6,510 ticks**, but they
are in level-6 Wilderness among aggressive spiders and earth warriors.

The Wilderness course is the only method above level 52 that is worth
doing. It is 2.9 to 5.7 times faster than anything else measured, and it sits
at Wilderness level 50 to 56, open to player killers.

## 2. Route by level band

| Band | Method | Location | Unlock | Base xp / action | Ticks / action | Success | Base xp / tick | Ticks for band |
|---|---|---|---|---|---|---|---|---|
| 1 -> 15 | Gnome Stronghold course | start (2474, 3436) | none | 86.5 per lap (read: 7 obstacles 47.5 + bonus 39, `gnome_course.rs2:1-110`) | 70.7 per lap (measured, `agility-course.ts gnome`, 3 laps at 99; no fail rolls so level does not matter) | 100% (read: no fail branch) | 1.22 | 61 (inferred) |
| 15 -> 52 | Gnome course (safe) | as above | none | 86.5 | 70.7 | 100% | 1.22 | 1,169 (inferred) |
| 15 -> 52 | or Edgeville dungeon monkey bars, back and forth | (3120, 9964) to (3120, 9969), Wilderness level 6 | 15 Agility (read: `shortcuts.loc:30`) | 20 (read: `shortcuts.rs2:193`) | 10.1 per crossing (measured, `agility-repeat.ts`, 11 gaps at level 15) | 100% (read: fail params 256/512 always pass, `shortcuts.loc:33-34`) | 1.98 | 722 (inferred) |
| 52 -> 70 | Wilderness course | pipe at (3004, 3938); enter through the ridge gate (2998, 3917) | 52 Agility for the ridge gate (read: `wilderness_course.rs2:2`); pipe needs 49 (`:53`) | 571.4 per lap (read: 12.5 + 20 + 20 + 20 + 0 + bonus 498.9, `wilderness_course.rs2:76-176`) | 77 per clean lap (measured, n=36 fall-free laps at levels 52-99); 99.5 expected at 52 with falls (inferred) | see section 4 | 5.84 at 52 to 6.32 at 70 (inferred) | 628 (inferred) |
| 70 -> 85 | Wilderness course | as above | | 571.4 | 91 -> 86 expected | | 6.32 -> 6.69 | 1,507 (inferred) |
| 85 -> 93 | Wilderness course | | | 571.4 | 86 -> 83 | | 6.69 -> 6.92 | 1,650 (inferred) |
| 93 -> 96 | Wilderness course | | | 571.4 | 83 -> 82 | | 6.92 -> 7.02 | 876 (inferred) |
| 96 -> 99 | Wilderness course | | | 571.4 | 82 -> 80 | | 7.02 -> 7.14 | 1,065 (inferred) |

Measured check on the Wilderness rate (`agility-course.ts wilderness`):

| Run | Laps | Ticks | Base xp | Base xp / tick | Falls |
|---|---|---|---|---|---|
| set to 99 | 3 | 216 | 1,714 | 7.94 (laps of 73 and 75 ticks) | 0 |
| set to 52 (rises to about 84 during the run) | 25 | 2,123 | 14,390 | 6.78 | 3 (2 rope swing, 1 stones) |
| set to 75 (rises to about 80) | 15 | 1,237 | 8,624 | 6.97 | 1 (rope swing) |

The lab runs fell less often than the formula predicts: 4 falls in 39 laps
against about 9 expected at the levels involved. So the model's rates are
about 5% lower (more pessimistic) than the measured runs. The tick totals
above use the model.

## 3. Quest xp

| Reward | Base xp | Source (read) | Agility needed by the quest (read; all use `stat()`, so boosts count) |
|---|---|---|---|
| Grand Tree | 7,900 | `quest_grandtree.rs2:199` | 25 to climb the tree (`quest_grandtree.rs2:23-27`) |
| Regicide | 13,750 | `quest_regicide.rs2:852` | 45 for two log balances (`:346,368`), 56 for an obstacle (`:404`); requires Underground Pass complete (`regicide_kings_messenger.rs2:2`) |
| Troll Romance | 8,000 | `quest_troll_love.rs2:305` (plus 25 per sled ride, `:223,294`) | 28 (`quest_troll_love.rs2:2`); Troll Stronghold prerequisite needs 15 (`quest_troll.rs2:7,18,46,140,164`) |
| Underground Pass | 3,000 | `quest_upass.rs2:800` | none; its obstacles roll `stat_random` (`upass_obstacles.rs2:22,113`) |
| Fremennik Trials | 2,812.4 (and the same to nine other skills) | `quest_viking.rs2:135-144` | none checked |
| Tourist Trap | 4,650 per pick, 2 picks; Agility is one of the four choices | `irena.rs2:77-91` | none |
| Legends | 7,650 per pick, 4 picks; Agility is on the fourth menu page | `radimus_erkle.rs2:112-114,122` | 50 (`quest_legends.rs2:327,587`) |

**Ordering and minimum pre-quest training.** Grand Tree's 25 is the only
Agility check that comes early. Its 7,900 base takes a fresh account to level
75 (inferred from the level table), which clears Troll Romance (28), Regicide
(45, 56) and Legends (50) with no further training. Underground Pass is
required for Regicide anyway and gives 3,000 base (level 61) with no Agility
check, so **doing Underground Pass before Grand Tree makes the pre-quest
training zero**. Fremennik Trials (level 60) or a Tourist Trap Agility pick
(4,650, level 67) would do the same. Troll Stronghold's 15 must also be met
whenever it is done, so it should come after one of those rewards too. If none
of them comes first, train to 25 on the Gnome course (194.5 base, 159 ticks,
inferred), or to 22 and drink an Agility potion (+3, read:
`consume_effects.dbrow:288-294`; 149.4 base, 122 ticks). Only Agility potions
boost Agility in this content; there is no summer pie.

Underground Pass has failable obstacles that roll Agility
(`upass_obstacles.rs2:22` 160-300, `:113` 100-410). Doing it at level 1 makes
those fail more often, which costs quest time. That cost is the quest plan's to
weigh against the 159 ticks saved.

**Ticks to 99 by quest set** (inferred, `agility-model.ts`; quest playtime
excluded, see `docs/speedrun/quests/`):

| Quest xp in | Base xp | Start level | Ticks to 99 |
|---|---|---|---|
| none | 0 | 1 | 6,956 (Gnome below 52) / 6,509 (monkey bars) |
| Grand Tree + Regicide + Troll Romance | 29,650 | 94 | 1,465 |
| ... + Underground Pass (required by Regicide) | 32,650 | 96 | 1,035 |
| ... + Fremennik Trials | 35,462 | 97 | 634 |
| ... + 1 Tourist Trap pick | 37,300 | 98 | 373 |
| ... + Fremennik + 1 Tourist Trap pick, or + 2 Tourist Trap picks, or + 1 Legends pick | 40,112 / 41,950 / 40,300 | 99 | 0 |

**What each reward is worth to Agility** (inferred, ticks of Wilderness
course it replaces):

| Reward | Saved on top of GT + Regicide + TR + UP | Saved from a fresh account |
|---|---|---|
| Grand Tree 7,900 | 1,137 | 2,262 |
| Regicide 13,750 | 1,994 | 3,158 |
| Troll Romance 8,000 | 1,152 | 2,277 |
| Underground Pass 3,000 | 430 | 1,481 |
| Fremennik Trials 2,812 | 400 | 1,450 |
| 1 Tourist Trap pick 4,650 | 662 | 1,749 |
| 2 Tourist Trap picks | 1,035 (finishes 99) | |
| 1 Legends pick 7,650 | 1,035 (finishes 99; a second pick is wasted) | 2,223 |

The picks displace Wilderness laps at about 7.0 base per tick, so a 4,650 pick
is worth about 660 ticks and a 7,650 pick about 1,035 ticks (capped by what is
left to 99). That beats the roughly 400 and 600 ticks the same picks save on
Thieving. Agility is the better home for the first Tourist Trap pick and for
one Legends pick. A second Agility pick only helps if fewer Agility quests are
done.

## 4. Mechanics

- **Laps must be done in order.** Each course keeps a progress varp, and an
  obstacle only advances it if it is at most one step ahead
  (`update_wilderness_varp`, `wilderness_course.rs2:170-178`; same rule in
  `gnome_course.rs2:103-110`, `barbarian_course.rs2:149-156`). The bonus is
  paid on the same tick as the last obstacle's xp, so the lab sees one combined
  drop (498.9 on the Wilderness rocks, which pay nothing themselves,
  `wilderness_course.rs2:151-158`).
- **Success roll:** `floor(lo*(99-L)/98) + floor(hi*(L-1)/98) + 1 > rand(256)`,
  using the current (boostable) level (`server/engine/src/engine/script/handlers/PlayerOps.ts:591-600`).
  Fail chances (inferred from that formula):

  | Obstacle (lo, hi) | Damage on fail (read) | 1 | 20 | 35 | 52 | 70 | 85 | 93 | 99 |
  |---|---|---|---|---|---|---|---|---|---|
  | Wilderness rope swing (200, 250), `:89` | 15% of current HP + 1, into the pit | 21.5% | 18.0% | 15.2% | 11.7% | 7.8% | 5.1% | 3.5% | 2.0% |
  | Wilderness stepping stones (180, 250), `:114` | 21.6% + 1 (`:115`) | 29.3% | 24.2% | 20.3% | 15.2% | 10.2% | 6.2% | 3.9% | 2.0% |
  | Wilderness log (200, 250), `:136` | 15% + 1, into the pit | 21.5% | 18.0% | 15.2% | 11.7% | 7.8% | 5.1% | 3.5% | 2.0% |
  | Wilderness ridge gate (entry only), `:12` | none, drops into the wolf pit | same as rope swing | | | | | | | |
  | Barbarian rope swing / ledge (200, 280) | 15% + 1 | 21.5% | 15.6% | 10.9% | 5.9% | 0% | 0% | 0% | 0% |
  | Barbarian log (180, 260) | 9% + 1 | 29.3% | 23.4% | 18.8% | 13.3% | 7.4% | 3.1% | 0% | 0% |
  | Gnome course | no fail branches | 0% | | | | | | | |
  | Arena floor spikes (60, 250) | 5% + 2 | 76.2% | 62.1% | 50.8% | 37.9% | 24.2% | 12.9% | 7.0% | 2.0% |
  | Arena pressure pad (40, 230) | 5% + 2 | 84.0% | 69.9% | 58.6% | 45.7% | 32.4% | 20.7% | 14.8% | 9.8% |

  Measured damage matched: rope swing falls took 9 HP at 55 and 7 at 45; a
  stones fall took 7 at 34. Because the damage is a fraction of current HP plus
  1, falls alone cannot kill above 1 HP.
- **Fall recovery on the Wilderness course** (read and measured). The rope
  swing and log drop the player into a pit whose only exit is the ladder at
  (3005, 10363). It comes up north of the rope swing, beside the stepping
  stones, and from there the swing refuses with "You cannot do that from
  here". A rope-swing fall therefore costs a whole loop without the bonus: 88
  extra ticks, measured as laps of 164 and 166 ticks against 77, and the loop
  still earns 52.5 base from the stones, log and pipe. A log fall means pit,
  ladder, stones again and back to the log: 53 ticks (measured, 1 sample). A
  stepping-stone fall lands next to the stones and costs about 21 ticks
  (measured, lap of 98). The model charges these costs at the formula's fall
  rates.
- **Measured ticks per Wilderness obstacle** (time from the previous
  obstacle's xp, at 99 / at 52+): pipe, including the walk back from the rocks,
  16.3 / 19.2; rope swing 9.0 / 9.1; stones 16.7 / 19.4; log 18.7 / 19.3;
  rocks 11.3 / 12.3. Gnome: log 14.3, net 6.8, branch 5.5, rope 11.8, tree
  down 5.5, net 7.8, pipe 17.8. Barbarian: rope swing 10.3, log 15.0, net 4.3,
  ledge 9.8, ladder down 2.5, walls 11.8 / 8.0 / 8.0.
- **Lab reaction time is included.** The bot clicks the next obstacle after it
  sees the previous obstacle's xp, which is about one tick after the server
  awarded it. A player who clicks earlier could save up to about 5 ticks per
  lap, if the server accepts a click made during the obstacle's delay (not
  tested).

## 5. Alternatives considered

| Method | Base xp / tick | Why it loses |
|---|---|---|
| Barbarian Outpost course (35 for the pipe entry, `barbarian_course.rs2:126`) | 1.97 at 99 (measured: laps of 71, 76 and 66 ticks, 139.5 base per lap including all three walls) | No better than the monkey bars, and it has falls below 70. |
| Barbarian pipe back and forth | 1.27 (measured, `agility-repeat.ts`, 9 gaps of 7-8 ticks, 10 base each) | Slow. |
| Brimhaven arena floor spikes, back and forth (level 20) | 3.45 at 99 (measured, `agility-trap.ts spikes`, 40 crossings, 24 base every 7 ticks) | Half the Wilderness rate at 99, and it fails 38% to 62% of the time at the levels where it would be used. |
| Brimhaven arena pressure pads (level 20) | about 4 when clean (measured gaps of 6-7 ticks, 26 base); 2.56 overall in the lab, including fails | Fails 10% even at 99. |
| Brimhaven arena tickets | at most about 2.9 from tickets (read: one pillar tag per 98-tick pillar move, `agilityarena_clerk.rs2:85`; 240 base for 1 ticket up to 280 each in batches of 100, `agilityarena_tickettrader.rs2:40-53`), plus obstacle xp on the way | Not measured. Even with obstacle xp along the way it cannot reach the Wilderness rate. Tickets are untradeable (`agilityarena.obj:15`), and entry costs 200 coins (`agilityarena_clerk.rs2:69-75`). |
| `watchshortcut`, Yanille climbing rocks (2561, 3108) | one-off 25 base | Not repeatable (measured, `agility-repeat.ts`): it drops you at (2561, 3111) inside Yanille, and from that side the click on the wall decoration never runs. |
| Other shortcuts (crumbling walls 12.5, Ardougne log 8.5, island rope swings 3, stepping stones 3) (`shortcuts.rs2`) | below 2 | One-way, or long walks back. |
| Yanille agility dungeon, Brimhaven dungeon obstacles (`agility_dungeon.rs2`, `karam_dungeon.rs2`) | below 3 (inferred from 7.5-22.5 base and the same delay procs) | Low xp per obstacle. |
| Gnomeball | 30 base per won game of five goals (`gnomeball_shoot.rs2:38-43`) | Each goal needs the ball back from the gnomes, and xp comes only on the fifth goal. Not measured. |
| Ape Atoll course | n/a | Not in this content; there is no Ape Atoll agility script. |

## 6. Gotchas

- **Player killers.** The course spans Wilderness levels 50 to 56 (inferred
  from `wilderness_levels.rs2:4-16` and `wilderness_zones.dbrow:4`). Any
  player within 50+ combat levels can attack (`pvp_combat.rs2:35-41`).
  Teleports are blocked above level 20 (`teleport.rs2:17`) and glories above
  30 (`amulet_of_glory.rs2:19`), so escaping means a long walk south. Carry
  nothing worth losing; the route needs no items. Whether player killers are
  active on the public demo is unknown.
- **Aggressive NPCs.** Wilderness NPCs with `huntmode=cowardly` attack
  whatever the player's combat level (the strength check only applies outside
  the Wilderness, `server/engine/src/engine/entity/Npc.ts:1011`). Near the
  course: armed skeletons (level 22, hunt range 1, wander range 9) at
  (2989, 3944) and (2992, 3942), beside the log exit and the rocks; ice
  warriors (57, hunt range 5) at (2984, 3933) and (2978, 3942); an ice giant
  at (2978, 3956); a white wolf (38) at (3005, 3926). In the lab they cost
  about 1 HP per lap on top of falls, against a low-combat bot. The monkey bars
  sit between deadly red spiders (34) and earth warriors (51), both
  `cowardly`.
- **HP budget.** At level 52, expected fall damage is about 3 HP per lap at
  60 HP (inferred: 0.45 falls per lap x about 15-22% of HP). Over the about 66
  laps from 52 to 99 with no quests, that is roughly 11 sharks' worth of
  healing beyond natural regeneration (inferred). After the quests (13 laps or
  fewer) it is negligible.
- **Level-up dialogs** stop the bot's next click until dismissed
  (`agility-lib.ts` clicks through them).
- **Bridge locs.** The Wilderness, Gnome and Barbarian logs and the Barbarian
  ledge are stored on plane 1 over plane-0 tiles. The SDK's nearby-loc scan
  does not list them, but `sendInteractLoc` with their id and tile works.
- **Travel.** The Ardougne lever lands at (3154, 3924)
  (`wilderness_lever.constant:1`, `wilderness_lever.rs2`), about 156 tiles
  east of the course gate, so about 80 ticks running (inferred). It is a
  one-off per session; logging out on the course and back in avoids repeating
  it. Lever and walking costs belong to `docs/speedrun/quests/primitives.md`.

## 7. Helper supply list

| Item | Count | Needed for |
|---|---|---|
| None | | Quest route with two Tourist Trap picks or a Legends pick: no training. |
| Sharks (or any food) | about 3 | Quest route ending at 96 (13 laps of Wilderness course), as insurance against falls and skeletons. |
| Sharks | about 11-15 | No-quest route, 52 -> 99. |
| Agility potion (4) | 1, optional | Only if Grand Tree must come before any other Agility reward: lets level 22 pass the 25 check (saves 37 ticks). On the course, +3 levels saves only 14 ticks from 96 and 73 from 52 (inferred), so it is not worth bringing for training. |

Nothing else is needed: no gear, no coins (the arena is not used), no tools.

## 8. Open questions

- **Click timing.** Can the next obstacle be clicked during the current
  obstacle's delay, so it starts on the first free tick? That could save about
  5 ticks per lap (6%). Settle it with a script that clicks one tick before the
  expected xp tick and logs whether the obstacle runs.
- **Fall rate sample.** The lab fell less than the formula predicts (4 against
  about 9). A 100-lap run at a fixed level (using `::setstat` before each lap)
  would pin the per-lap cost and check the formula against reality.
- **Brimhaven tickets** were not measured. They cannot beat the Wilderness
  above 52, so they could matter only for the sub-52 band of the no-quest route.
- **Underground Pass at low Agility.** Its obstacles roll Agility
  (`upass_obstacles.rs2:22,113`). The quest plan should measure how much quest
  time a level-1 account loses to falls there, against the 159 ticks of Gnome
  laps that doing it first saves.
- **For the README and the quest plan:** the brief's 29,650 leaves out
  Underground Pass, which Regicide requires. Fremennik Trials gives 2,812.4
  base to ten skills, including Woodcutting, Fishing and Thieving
  (`quest_viking.rs2:135-144`), which matters to those skill plans too.
