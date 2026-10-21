# Self-only skills: what the efficiency community knows, mapped to this revision

Issue: cairn://p/rs/74 (under cairn://p/rs/59). Skills: Agility, Woodcutting, Mining, Fishing,
Thieving, the five the scored account must train itself. Every candidate below was checked
against this server's scripts and engine, then valued in ticks against the route line it
would replace, using that line's own document on rs/2's branch
(`docs/speedrun/skills/{agility,woodcutting,mining,fishing,thieving,tick-manipulation}.md`).

Labels follow `docs/speedrun/skills/README.md`: **r** read from a script or engine file
(cited `file:line`; scripts under `server/content/scripts/`, engine under
`server/engine/src/`), **m** measured on a local engine (script named), **i** inferred
(arithmetic shown). Xp is base xp (game xp / 25). Time is server ticks. An OSRS hour is 6,000
ticks, which is how the community's xp/hour figures are converted below.

## Summary

**The headline is a mechanism the route documents rule out.** rs/2's
`tick-manipulation.md` (section 4) and `mining.md` (section 4a) argue that no gathering roll can
come faster than every 3 ticks, because no inventory action writes `%action_delay` below
`map_clock + 2`. That is true of inventory actions, but the OSRS community's 2-tick methods use
a different writer: **the auto-retaliate flinch**. In this revision, being hit while
auto-retaliate is on and the player has no interaction runs
`[queue,playerhit_n_retaliate]`, which writes `%action_delay = map_clock + attackrate/2`
(minus 1 on rapid ranged) whenever the clock has expired (r, `skill_combat/scripts/player/
auto_retaliate.rs2:9-22`). With a thrown knife or dart (attackrate 3, r, `skill_combat/configs`)
that is `map_clock + 1`, the exact write the argument says does not exist. On reading, a drop on
the tick after a roll clears the interaction, a hit that tick flinches, and a tree or rock click
on the next tick rolls at once: a **2-tick Woodcutting and Mining cycle**. Valued against the
knife route: **about 700-1,000 ticks of Woodcutting** (i) and **up to about 500 of Mining** (i,
limited by rock respawns). It needs a hit every 2 ticks, from a helper attacking the scored
account in the Wilderness or from two NPCs in a multi-combat zone. It is **untested**; lab brief
A is the most valuable test this page proposes.

Everything else is small. Agility, the largest line, has no faster method in this revision: the
Ape Atoll course (OSRS's 9.2 base/tick, 25% better than the Wilderness course) was released in
2006 and has no scripts here, Brimhaven tickets are untradeable, and an obstacle click sent
during an obstacle is dropped, so the only lever is bot timing and entry tiles (up to about 340
ticks, i). Pinning a Knight of Ardougne with helpers standing around it is about 85 ticks (i).
Fishing gains nothing: fly fishing cannot take the flinch, and 2-tick harpooning only matches
3-tick fly fishing.

Sanity check against community rates: our measured rates match the OSRS wiki's for the same
methods (table in section 4), so the route is not missing a rate-level trick on any method that
exists here.

## 1. Ranked table

| # | Technique | Source | Present in revision | Route line affected | Ticks saved (label) | Cost | Test status |
|---|---|---|---|---|---|---|---|
| 1 | **2-tick Woodcutting by auto-retaliate flinch.** Drop (or any inventory op) on the tick after a roll; a hit that tick flinches the clock to `map_clock + 1`; click the tree next tick and it rolls at once. | [OSRS wiki: Tick manipulation, 2-tick Woodcutting](https://oldschool.runescape.wiki/w/Tick_manipulation#2-tick_Woodcutting); [Flinching](https://oldschool.runescape.wiki/w/Flinching) ("Flinching is also used for skilling"); [Woodcutting training](https://oldschool.runescape.wiki/w/Woodcutting_training) | Yes (r): flinch write `auto_retaliate.rs2:9-22` (PvP: `:37-50`); gate `busy2` = `hasInteraction() \|\| hasWaypoints()` (`engine/script/handlers/PlayerOps.ts:956-958`); NPC hit queues it with delay 0 (`npc_combat_melee.rs2:48`), PvP on every swing hit or miss (`pvp_melee.rs2:40`); tick order packets, NPCs, players (`engine/World.ts:402,414,425`); a delay-0 queue runs the same tick (`engine/entity/Player.ts:960-961`); queues run before interactions (`World.ts:785,801`); drops clear the interaction (`OpHeldHandler.ts:54-56`); woodcutting first click rolls at once on equality (`woodcut.rs2:97-99`) | Woodcutting, ~3,028 with the knife (woodcutting.md section 2) | **~700** (oaks in the level-1 Wilderness, helper attacking) to **~1,000** (willows from 73 with two NPC attackers) (i, section 2) | A hit source every 2 ticks: one helper with thrown knives or darts on rapid (2-tick attacks) inside the Wilderness and within its combat-level window, or two attackrate-4 NPCs offset by 2 ticks in a multi-combat zone. A harmless inventory op every cycle. Player-killer exposure in the Wilderness. | Untested. Brief A. |
| 2 | **2-tick Mining on stays by the same flinch**, mixed with knife starters on moves | as row 1, and [OSRS wiki: 3-tick Mining](https://oldschool.runescape.wiki/w/Tick_manipulation#3-tick_Mining) | Yes (r): the first swing rolls at once on equality (`mining.rs2:83-85`); everything else as row 1. Walking sets waypoints, so the flinch tick must be a stay | Mining 63-99 band, ~3,173 with the knife at respawn 13 (mining.md section 2) | **0 to ~530** (i): the zoo cluster's 6 rocks cap it at 2.5 ticks/ore (6 rocks per 15-tick respawn window) against 3.00 now; 3,173 x (1 - 2.5/3) = 529 | No iron rock lies in a multi-combat zone (r, map scan in section 2), so the hit source is one NPC at the cluster (a flinch every 4 ticks only) or a helper at the Wilderness iron cluster (level 31) | Untested. Brief B (planner first). |
| 3 | **Predicted obstacle clicks and chosen entry tiles on the Wilderness course** | [OSRS wiki: Wilderness Agility Course](https://oldschool.runescape.wiki/w/Wilderness_Agility_Course) (theoretical lap 67 ticks, against our measured 73-77); rs/2 agility.md section 8 open question | Clicks during an obstacle are dropped, not queued (r, `network/game/client/handler/OpLocHandler.ts:14-18`), so the gain is only reaction latency and walking. The rope swing charges `p_delay(distance)` from the trigger tile to its start tile (r, `wilderness_course.rs2:80-88`) | Agility, ~4,695 from level 75 (agility.md section 1) | **~60** (rope-swing tile alone, 1 tick x ~57 laps) to **~340** (6 ticks x ~57 laps if the bot still pays a reaction tick per obstacle) (i) | Bot work only | Untested. Brief C. |
| 4 | **Pin a Knight of Ardougne** by standing helpers on its free neighbouring tiles | [andromack: Setting up a sticky Ardy knight](https://andromack.com/blog/setting-up-a-sticky-ardy-knight) (OSRS uses a splasher); [Autumn Elegy, Efficient 1-99 Thieving Guide, 2004Scape, 7:35 "How to lure the knight"](https://www.youtube.com/watch?v=2QYqNvLwB1g&t=455s) | Yes (r): NPC steps respect player occupancy unless `passthru` (`engine/entity/Npc.ts:406-413`); players set the flag (`engine/entity/PathingEntity.ts:175-179`); a still NPC off its spawn teleports home after 501 ticks, one on its spawn never does (`Npc.ts:729-735`) | Thieving, ~1,975 from Fight Arena (thieving.md section 2) | **~85** (i): rs/2 measured 0.16 ticks per roll of walking at the best knight; x 536 rolls (57-99 run) = 86. Up to ~250 if the route's knight is the worst one (0.47 per roll) | 2-4 helper accounts standing still for the session; pin on the spawn tile | Untested. Brief D. |
| 5 | **Knight multiskilling**: delay-free helper-fed actions in the stun ticks | [Autumn Elegy guide, 11:09 "Knight multiskilling"](https://www.youtube.com/watch?v=2QYqNvLwB1g&t=669s) | A failure leaves the player stunned but not delayed for 7 of its 11 ticks (r, thieving.md section 4: clicks at T+4 to T+10 pass the packet check) | Fletching + Herblore + Crafting + Cooking, ~250 (rs/37, interleaving.md) | **up to ~250** (i), bounded by the delay-free helper-fed work; about 100 failures x 7 free ticks = ~700 free ticks on the knights | Owned by rs/38's interleaving plan; listed so it is not lost | Cross-reference only |

Rows 1 and 2 share one mechanism; if brief A confirms it, brief B is a planner run plus one
measurement.

## 2. The flinch, in detail (rows 1 and 2)

### What the community does

The OSRS wiki describes 2-tick Woodcutting at Ape Atoll and Prifddinas: get two monsters
attacking you so a hitsplat lands every two ticks, wield a 2- or 3-tick weapon that cannot
attack (a shortbow without arrows on rapid), keep auto-retaliate on, "click a teak tree on each
tick a hitsplat appears" and "on each off-tick either click the ground at the base of a teak
tree or drop a teak log" ([Woodcutting training, 2-tick section](https://oldschool.runescape.wiki/w/Woodcutting_training)).
The [Flinching](https://oldschool.runescape.wiki/w/Flinching) page names the write: the hit
gives the player a retaliation delay of half its weapon speed, rounded down, and a skilling
click then turns that into the skilling timer. The same page and the tick manipulation page
use it for 2-tick harpooning with a PvP alt hitting every 2 ticks with darts.

### How it maps onto this engine (r)

- **The write.** `[queue,playerhit_n_retaliate]` runs when the player is hit by an NPC. If
  auto-retaliate is on and `busy2` is false, and `%action_delay < map_clock`, it sets
  `%action_delay = map_clock + floor(attackrate / 2)`, minus 1 on rapid ranged, using the
  right-hand weapon's attackrate (4 if empty), then `p_opnpc(2)` (`auto_retaliate.rs2:1-26`).
  `[queue,pvp_retaliate]` does the same for a player's attack (`:29-54`). Thrown knives and darts
  have attackrate 3 (r, `skill_combat/configs/ranged/*.obj`), so non-rapid gives `+1`; an empty
  hand gives `+2` (the knife starter's value). Every melee NPC swing queues it, hit or miss,
  with delay 0 (`npc_combat_melee.rs2:27-48`); magic and ranged NPCs queue it when the
  projectile lands (`npc_combat_magic.rs2:120`, `npc_combat_ranged.rs2:54`); every PvP swing
  queues it on the target (`pvp_melee.rs2:40`).
- **The gate.** `busy2` is `hasInteraction() || hasWaypoints()` (`PlayerOps.ts:956-958`). A
  gathering loop keeps an interaction through `p_oploc(3)`, so an ordinary hit while chopping
  does nothing. The flinch only fires on a tick where the player's packets cleared the
  interaction without walking: a drop, or any other inventory op, which calls
  `clearPendingAction` (`OpHeldHandler.ts:54-56`).
- **The tick order.** Each tick decodes client packets, then runs NPCs, then players
  (`World.ts:402,414,425`); inside a player, queues run before the interaction
  (`World.ts:785,801`). A request queued with delay 0 runs on the same tick it was queued
  (`Player.ts:960-961`, `delay <= 0` after the post-decrement). So on tick F: the drop clears the
  interaction, the NPC hits, the retaliate queue flinches the clock to F+1 and sets the attack
  interaction, and the attack label waits because the clock is ahead
  (`player_ranged.rs2:6-9`, `player_melee.rs2` same shape). On F+1 the tree click replaces the
  attack, and the woodcutting first-click label rolls at once because the clock equals
  `map_clock` (`woodcut.rs2:97-99`). The player never actually attacks while the cycle holds.
- **Which loops can use it.** Woodcutting and Mining roll at once on equality in their
  first-click label (`woodcut.rs2:97-99`, `mining.rs2:83-85`). So do lobster, harpoon and the
  other sea methods (`rarefish.rs2:70-72`), which is the OSRS 2-tick harpoon. **Fly fishing
  cannot**: its attempt label defers to op 4 on the next tick (`freshfish.rs2:37-52`), where a
  clock set to `map_clock + 1` has already expired and re-arms to +4. A `+2` flinch gives fly
  fishing a 3-tick cycle, the same as the knife.
- **Why rs/2's catalogue missed it.** `tick-manipulation.md` section 3 lists
  `auto_retaliate.rs2` among combat writers that write `map_clock + attackrate` and need combat,
  and section 4's argument only considers inventory writers. The retaliate script writes half
  the attackrate, is triggered by someone else's swing, and coexists with gathering because the
  player's next click overrides its attack interaction.

The catalogue also omits four decrements, `%action_delay = sub(%action_delay, 1)`
(`player_ranged.rs2:22-24`, `pvp_ranged.rs2:20-22`, `castlewars_maindoor.rs2:99-101`,
`chompy_bird.rs2:159-161`). Each follows an absolute `map_clock + attackrate` write on rapid
style, and the lowest right-hand attackrate is 3 (r; the only attackrate-1 object, Beads of the
dead, is neck-slot, `quest_zombiequeen.obj:189-217`), so they cannot go below the knife's `+2`.
They change nothing.

### Valuing it

Woodcutting (woodcutting.md section 2, demo respawn 20): the knife route is 3,028 ticks, of which
the oak band 15-73 is about 609 (796 x 0.765) and the willow band 73-99 about 2,406 (3,145 x
0.765).

- **Two NPC attackers on willows** (2-tick from 73): the cycle goes from 3 ticks to 2, so the
  willow band becomes about 2,406 x 2/3 = 1,604, saving about 800; flinching the oak band too
  saves about 200 more. **About 1,000 (i)**, an upper bound, since fells and all-down waits
  come more often at a faster cycle. Three willows at a 20-tick respawn still cover a fell every
  23 ticks (1 in 8 successes at 68.75% success). Willows inside a multi-combat zone (r, map scan
  of `maps/multiway.csv` against loc 1308 `willowtree`): (2659,3243), (2665,3250), (2670,3227),
  (2672,3226), (2674,3228), (2675,3240), south-east of East Ardougne. The only NPCs spawning
  within 14 tiles are a Necromancer and Invrigar (r, map NPC sections), so two attackers would
  have to be led there.
- **One helper attacking in the Wilderness** (single-way combat is enough with one attacker,
  since thrown knives or darts on rapid attack every 2 ticks): the Wilderness has no willows but
  has oaks at levels 1-2, for example (3157,3525), (3192,3524), (3225,3521), (3266,3527),
  (3267,3521) (r, map scan of loc 1281 `oaktree`). Oak succeeds on every roll from level 60
  (woodcutting.md section 4), so 2-tick oak is 37.5 / 2 = 18.75 base per tick, above 3-tick
  willow at 99 (about 16 measured). Oak for the whole route: 15-60 about 185 ticks (2,573 base at
  about 14 per tick) plus 60-99 about 1,989 (37,290 / 18.75), about 2,175, plus about 5% for
  level-ups and fells, **about 2,300 against 3,028: about 700 saved (i)**. The helper's combat
  level must be within the Wilderness level of the scored account's (`pvp_combat.rs2:35-41`),
  which at level 1 means within one combat level; doing Woodcutting before the combat block, or
  keeping a helper at a matching combat level, settles that.

Mining (mining.md sections 2 and 4): the flinch only helps a stay, because walking sets
waypoints. At respawn 13 a rock can roll again 15 ticks after its last roll, so a 6-rock
cluster can give at most 6 ores per 15 ticks, 2.5 ticks per ore, against 3.00 now; that is an
upper bound of 3,173 x (1 - 2.5/3) = **about 530 (i)** on the 63-99 band, reached only if three
of every six transitions can be stays. No iron rock is in a multi-combat zone (r, map scan of
locs 2092 and 2093), so the zoo cluster would get a flinch only every 4 ticks from one NPC; the
Wilderness iron cluster (level 31) allows a helper. Realistic value is probably a few hundred.

Fishing: 2-tick harpooning swordfish gives 35.4 base per roll at 99 x 1/2 = 17.7 per tick (from
fishing.md's read rates), against 16.7 for 3-tick fly fishing by the same read model and about
15.5 measured; at level 70 they are equal. **No gain** worth the setup.

## 3. Lab briefs

**A. Flinch 2-tick Woodcutting (row 1; worth about 700-1,000 ticks).** Setup: the woodcutting
lab block at `NODE_TICKRATE=300` on a quiet host (LAB.md). Bot Cairn with `::setstat` Woodcutting
99, Defence 99 and Hitpoints 99, a rune axe, about 20 normal logs to drop, a stack of bronze
thrown knives wielded on a non-rapid style, auto-retaliate on. Stand beside an oak or willow and
provide hits: either `::npcadd` two melee NPCs in a multi-combat square two ticks apart, or log a
second bot in at the level-1 Wilderness oaks, wield bronze darts on rapid with no other gear,
and have it attack Cairn continuously. Cairn's loop: on every tick on which a hitsplat on Cairn
appears in its state, send the tree click on the next tick; on every other tick, send one drop.
Log the server tick of every xp drop and of every hit on Cairn. Measure the gap histogram over
200 rolls at 99 and count rolls on the tick after a hit. Success criterion: at least 80% of
gaps are 2 ticks with two attackers (or the 3,3,2 pattern with one attackrate-4 NPC plus knife
starters), and no slip lets Cairn's own attack fire. Then one run of the route's oak band to
price fells and level-ups.

**B. Flinch on Mining stays (row 2; up to about 530).** First extend `mining-rotation-plan.ts`
with a 2-tick transition for stays (the same tile, the next rock adjacent, a flinch due that
tick) and re-plan the zoo cluster and the Wilderness iron cluster at respawn 13 and 19. Only if
the planner finds better than 2.8 ticks per ore, run the best plan with a helper attacker for 200
ores in the mining block. Success criterion: measured ticks per ore below 2.8 with every roll on
its predicted tick.

**C. Wilderness course timing (row 3; about 60-340).** In the agility block at 300 ms with the
fixed lite client, run 10 laps at level 99 with the current reactive bot and 10 laps with a
predicted bot that sends each obstacle click on the tick the previous obstacle's script ends
(read from the script's `p_delay` chain) and walks to chosen entry tiles, in particular (3004,
3952) for the rope swing so its teleport delay is 1. Success criterion: the predicted laps are
at least 3 ticks shorter on average; report per-obstacle time against agility.md's table.

**D. Pinned knight (row 4; about 85).** In the thieving block, `::npcadd` is not needed: walk
three or four helper bots onto the walkable neighbours of the eastern knight's spawn tile
(2671,3313) when it stands there, leaving one for Cairn, and run `thieving-pickpocket.ts` from 55
for 300 rolls. Success criterion: the knight does not move during the run and the per-roll
overhead falls from about 0.16 to under 0.05.

## 4. Sanity check against community rates

One OSRS hour is 6,000 ticks, so base xp per tick x 6,000 is the OSRS-equivalent rate.

| Method | Ours, base xp per tick | OSRS-equivalent per hour | Community figure | Verdict |
|---|---|---|---|---|
| Wilderness Agility Course, 75-99 | 6.7-7.1 (i, agility.md) | 40,000-43,000 | 40,000-45,000 typical, 47,500 at high level, 50,800 theoretical at 67 ticks per lap ([wiki](https://oldschool.runescape.wiki/w/Wilderness_Agility_Course)) | Matches; the 67-tick lap is the ceiling brief C chases |
| Knights of Ardougne at 99 | 33.2 (m, thieving.md) | 199,000 | Success 94.1% at 99 without diary ([wiki pickpocket table](https://oldschool.runescape.wiki/w/User:Sir_Kvothe/PPTables/Knight_of_Ardougne)); ours reads 94.1% (thieving.md) | Same formula; the OSRS boosts (Ardougne cloak, rogue gear, dodgy necklace) are absent here (r, grep `gloves_of_silence|dodgy|rogue_|ardougne_cloak` finds none) |
| Willow with the knife, 99 | about 16 (m, 4.23 ticks per log) | about 96,000 | 2-tick teaks 223,000, 1.5-tick teaks 255,000 ([wiki](https://oldschool.runescape.wiki/w/Woodcutting_training)) | Teaks are absent; the 2-tick mechanism is row 1 |
| Iron with the knife | 11.67 (m) | 70,000 | 3-tick granite is the OSRS best ([wiki](https://oldschool.runescape.wiki/w/Tick_manipulation#3-tick_Mining)) | Granite is absent |
| Fly fishing with the knife | about 15.5 (m, 3.80 ticks per catch) | about 93,000 | 3-tick fly and Barbarian fishing ([wiki](https://oldschool.runescape.wiki/w/Tick_manipulation#3-tick_Fishing)) | Barbarian fishing is absent |
| Ape Atoll course (absent) | would be about 9.2 (580 per lap, about 63 ticks) | 55,200 | [wiki](https://oldschool.runescape.wiki/w/Ape_Atoll_Agility_Course) | Released 15 March 2006; not here |

## 5. Checked and not applicable

One line each, so nobody re-checks.

**Agility**

- **Ape Atoll Agility Course**: absent. Released 15 March 2006 ([wiki](https://oldschool.runescape.wiki/w/Ape_Atoll_Agility_Course)). `skill_agility/scripts/` has only the Gnome, Barbarian and Wilderness courses and shortcuts; the Ape Atoll map (added to the content at rev 289, `server/PATCHES.md:373`) has "Tropical tree" and "Monkeybars" locs in `_unpack/225/all.loc` but no `oploc` script for them (grep `ape_atoll|greegree|monkeybars` in `skill_agility` finds nothing).
- **Werewolf course** (31 January 2005), **Agility Pyramid** (16 January 2006), **rooftop courses** (OSRS 2014), **penguin course**: absent. Canifis exists (`areas/area_canifis/scripts`) with no agility script; grep `pyramid` finds only gnome dialogue and Doric; grep `penguin` finds nothing.
- **Brimhaven Agility Arena tickets from helpers**: tickets are untradeable (`minigames/game_agilityarena/configs/agilityarena.obj:15`), the trade screen enforces it (`interface_trade/scripts/trade.rs2:338`), and a dropped untradeable is visible only to its owner (`engine/zone/Zone.ts:333`). They are untradeable in OSRS too ([wiki](https://oldschool.runescape.wiki/w/Agility_arena_ticket)).
- **Arena tickets for the scored account**: 240 base for 1, 248 each for 10, 260 for 25, 280 for 100, 320 for 1,000 (`agilityarena_tickettrader.rs2:50-63`), one ticket per 98-tick arrow move (`agilityarena_clerk.rs2:85`): at most about 3.3 base per tick from tickets, half the Wilderness rate.
- **Arena traps**: poison darts 30 base, about 11 ticks per crossing, 74.6% success at 99 and an Agility drain on failure (`agilityarena_zones.rs2:250-286`); saw blades 28 base, 82% at 99 (`:198-236`); spikes and pressure pads were measured by rs/2 at 3.45 and about 4. All below the Wilderness course.
- **Agility potion or summer pie to unlock a course early**: no summer pie in this content; the potion's +3 is worth 14 ticks from 96 (agility.md section 7). The Ape Atoll boost trick has no course to apply to.
- **Clicking the next obstacle from range or during an obstacle**: dropped while delayed (`OpLocHandler.ts:14-18`); the remaining part is row 3.
- **Log balance trigger from further along the log**: the Wilderness log is a 1x1 loc (`skill_agility/configs/wilderness_course.loc:55`), so it can only be triggered from its start.
- **Troll Romance sled rides** (25 base each, `quest_troll_love.rs2:223,294`): inside the quest flow, about 1 base per tick of ride.
- **Gnomeball, Yanille and Brimhaven dungeon obstacles, Shilo and Horror from the Deep obstacles**: 0.5-30 base per action (`gnomeball_shoot.rs2:43`, `agility_dungeon.rs2:28,82`, `karam_dungeon.rs2:200-341`, `quest_zombiequeen.rs2`, `basalt_rocks.rs2`); all below 3 base per tick (agility.md section 5).

**Woodcutting**

- **Teak and mahogany, 2-tick and 1.5-tick teaks, 3-tick teaks**: absent. Both trees were released 9 August 2005 ([teak](https://oldschool.runescape.wiki/w/Teak_tree), [mahogany](https://oldschool.runescape.wiki/w/Mahogany_tree)); `skill_woodcutting/configs/trees.dbrow` has normal, jungle, burnt, achey, oak, willow, maple, yew, magic and hollow only; grep `teak|mahogany` finds one comment (`quests/quest_misc/scripts/misc_quest.rs2:10`).
- **1.5-tick "two rolls on arrival"** (OSRS Fossil Island): a roll here needs `%action_delay = map_clock` inside a label run, once per tick (`woodcut.rs2:97-99`, `:153-160`); there is no second roll on arrival.
- **Kharazi jungle trees** (Legends' Quest): 100 base per log but a log on only half of the successful rolls, success `stat_random(70, 233)`, 3 in 4 successes deplete the tree and move the player (`quests/quest_legends/scripts/jungle_tree.rs2:115-165`, `trees.dbrow:43-53`); 45.7 base per roll at 99 against willow's 46.4, below oak at 60, and it needs the quest map. No gain.
- **Cactus** (`areas/area_desert/scripts/kharidian_cactus.rs2:67`, 10 base), **Miscellania Lumberjack Leif** (0.1 base): negligible.

**Mining**

- **3-tick granite (3t4g), sandstone**: absent. Granite was released 23 January 2006 ([wiki](https://oldschool.runescape.wiki/w/Granite)); `skill_mining/configs/mine.dbrow` has no granite or sandstone rows, only comments in `mining.rs2:5,180` (rs/2 mining.md section 4a).
- **Gem rocks, coal, gold, Mining Guild, essence, limestone**: present, all below iron at every level (mining.md section 4a).
- **Motherlode, Blast Mine, infernal shale with Jim's wet cloth**: absent (post-2004).
- **A pickaxe faster than rune**: rune is `mining_rate` 2, the fastest (`skill_mining/configs/pickaxes.obj:198`); no dragon pickaxe.
- **The rapid-ranged decrement writers**: cannot go below `+2` (section 2).

**Fishing**

- **Barbarian fishing (3-tick, cut-eat)**: absent. Released 3 July 2007 ([wiki](https://oldschool.runescape.wiki/w/Barbarian_Fishing)); grep `leaping|barbarian_rod|heavy_rod|otto` finds nothing relevant.
- **1-tick karambwan**: no counterpart. The karambwan roll comes after a hard `p_delay(5)` (`skill_fishing/scripts/fishing_spots/tbwt.rs2:120-124`), so 7 ticks per attempt at best; it is also off the clock, so no starter or flinch applies.
- **Tick-manipulated harpoon, tuna, swordfish, shark**: 3-tick with the knife needs a click exactly on the roll tick (tick-manipulation.md section 2); 2-tick by flinch is possible by reading but only matches 3-tick fly fishing (section 2).
- **Fly fishing by flinch**: impossible; its attempt label defers the roll (section 2).
- **Fishing Trawler**: present, about 1 base per tick (fishing.md section 3).
- **Karambwan eat-delay trick** (OSRS: eating a karambwan delays by 2): karambwan passes `null` and does not write the clock here (tick-manipulation.md section 3).

**Thieving**

- **Blackjacking** (The Feud, 2008), **Pyramid Plunder** (17 July 2006, [wiki](https://oldschool.runescape.wiki/w/Pyramid_Plunder)): absent; grep `blackjack|plunder` finds nothing.
- **Master Farmers**: absent; the level-38 unlock message is commented out (`levelup/scripts/levelup_unlocks_thieving.rs2:13`) and `pickpocket.dbrow` has only the plain Farmer (level 10).
- **Better targets than knights at 55-99**: none; the full table is man, woman, farmer, warrior, rogue, guard, knight, watchman, paladin, gnome, hero, Fremennik (`skill_thieving/configs/pickpocking/pickpocket.dbrow`), and rs/2 measured or modelled each below the knights.
- **Stalls, including OSRS safespots**: the best stall is 81 base per 166-tick respawn and most are 16-54 base (`skill_thieving/configs/stalls/stealing.dbrow`), all under 2 base per tick even unguarded; rs/2 found the Ardougne stalls guarded.
- **Ape Atoll stalls**: scimitar 210 base and magic 100 base at level 65 with **no failure roll** (the low/high arguments are unused, `quests/quest_mm/scripts/aa_market.rs2:13-76`), but one stall of each (map square 43_43) on a 65-tick respawn: at most about 4.8 base per tick, and the player must be in human form among the monkey guards.
- **Ardougne zoo monkeys** (after Monkey Madness): freeing one in Karamja gives 2 x base Thieving level, 198 base at 99 (`quests/quest_mm/scripts/mm_zoo_monkey.rs2:89-100`), but only one fits in the pack (`:2-5`), it cannot be banked (`interface_bank/scripts/bank.rs2:146-149`) or traded (`quests/quest_mm/configs/quest_mm.obj:1162`), so it is one Ardougne-Karamja round trip per monkey.
- **Lockpicking doors** (the 2004Scape guide notes its door method "got nerfed"): a lock is picked only from the locked side and leaving is an ordinary open (`skill_thieving/scripts/doors/locked_door.rs2`), at most 50 base per pick (`locked_door.dbrow`), plus the walk back.
- **Thieving boosts, rogue gear, gloves of silence, dodgy necklace, Ardougne cloak**: absent (grep finds none); only the poison chalice's random +1 (thieving.md section 8).
- **Tick-perfect pickpocket clicks**: already in the route; a success costs the 2-tick floor set by `p_delay(0)` (thieving.md section 4).

## 6. Not yet read

- The Lost City Wiki's [Tick manipulation](https://wiki.garlichq.com/wiki/Tick_manipulation)
  page, the one community page written for this engine, was offline during this research
  (Miraheze outage, back at 15:00 UTC on 2026-10-21). It should be checked for anything not in
  the OSRS page.
- The 2004Scape Thieving guide's "Right-click thieving hack" chapter
  ([12:59](https://www.youtube.com/watch?v=2QYqNvLwB1g&t=779s)) could not be transcribed; our bot
  sends OPNPC3 directly, so a client menu trick is unlikely to matter.

## Sources

- OSRS Wiki, [Tick manipulation](https://oldschool.runescape.wiki/w/Tick_manipulation) (2-tick and 1.5-tick Woodcutting, 3-tick Mining and 3t4g, 2-tick Fishing, karambwan delay), read 2026-10-21.
- OSRS Wiki, [Flinching](https://oldschool.runescape.wiki/w/Flinching) (retaliation delay of half the attack speed; skilling use), read 2026-10-21.
- OSRS Wiki, [Woodcutting training](https://oldschool.runescape.wiki/w/Woodcutting_training) (2-tick setup steps, xp rates), read 2026-10-21.
- OSRS Wiki, [Wilderness Agility Course](https://oldschool.runescape.wiki/w/Wilderness_Agility_Course) (571.4 per lap, 67-tick theoretical lap, xp/hour), read 2026-10-21.
- OSRS Wiki, [Ape Atoll Agility Course](https://oldschool.runescape.wiki/w/Ape_Atoll_Agility_Course) (released 15 March 2006, level 48, greegree, 580 per lap), read 2026-10-21.
- OSRS Wiki release dates: [Teak tree](https://oldschool.runescape.wiki/w/Teak_tree), [Mahogany tree](https://oldschool.runescape.wiki/w/Mahogany_tree), [Granite](https://oldschool.runescape.wiki/w/Granite), [Barbarian Fishing](https://oldschool.runescape.wiki/w/Barbarian_Fishing), [Werewolf Agility Course](https://oldschool.runescape.wiki/w/Werewolf_Agility_Course), [Agility Pyramid](https://oldschool.runescape.wiki/w/Agility_Pyramid), [Pyramid Plunder](https://oldschool.runescape.wiki/w/Pyramid_Plunder), [Blackjacking](https://oldschool.runescape.wiki/w/Blackjacking), [Agility arena ticket](https://oldschool.runescape.wiki/w/Agility_arena_ticket), read 2026-10-21.
- OSRS Wiki, [Knight of Ardougne pickpocket table](https://oldschool.runescape.wiki/w/User:Sir_Kvothe/PPTables/Knight_of_Ardougne), read 2026-10-21.
- Justin Lamping, [Setting up a Sticky Ardy Knight](https://andromack.com/blog/setting-up-a-sticky-ardy-knight), andromack.com, updated 22 March 2024.
- Autumn Elegy, [Efficient 1-99 Thieving Guide | 2004Scape](https://www.youtube.com/watch?v=2QYqNvLwB1g), YouTube, 21 February 2026 (chapters 3:07 doors, 7:35 knight lure, 11:09 knight multiskilling, 12:59 right-click hack; description only, transcript not available).
- data-dependent, [osrs-guides skilling.md](https://github.com/data-dependent/osrs-guides/blob/master/skilling.md) (tick-by-tick skilling mechanics guide), found, not needed beyond the wiki.
- 2004Scape, [Feature Complete Progress](https://github.com/2004scape/Server/wiki/Feature-Complete-Progress), GitHub wiki, 17 November 2024 (project status; context only).
