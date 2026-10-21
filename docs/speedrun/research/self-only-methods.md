# Self-only skills: what the efficiency community knows, mapped to this revision

Issue: cairn://p/rs/74 (under cairn://p/rs/59). Skills: Agility, Woodcutting, Mining, Fishing,
Thieving, the five the scored account must train itself. Every candidate below was checked
against this server's scripts and engine, then valued in ticks against the route line it
would replace, using that line's own document under `docs/speedrun/skills/` (rs/2; on main since PR #72)
(`docs/speedrun/skills/{agility,woodcutting,mining,fishing,thieving,tick-manipulation}.md`).

Labels follow `docs/speedrun/skills/README.md`: **r** read from a script or engine file
(cited `file:line`; scripts under `server/content/scripts/`, engine under
`server/engine/src/`), **m** measured on a local engine (script named), **i** inferred
(arithmetic shown). Xp is base xp (game xp / 25). Time is server ticks. An OSRS hour is 6,000
ticks, which is how the community's xp/hour figures are converted below.

## Summary

**The headline is a mechanism the route documents rule out, and the lab confirms it.** rs/2's
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
on the next tick rolls at once: a **2-tick Woodcutting and Mining cycle**. **Measured (section
3a): 196 rolls at Woodcutting 99, 160 of 166 steady gaps at 2 ticks, every roll on the tick after
a flinch write, and the player's own attack never fired** (m, engine trace, `NODE_TICKRATE=300`).
The first attempt's failure was the setup: its two attackers hit on adjacent ticks, and the bot
skipped the label after each click.

What it is worth depends on keeping a tree standing and a hit arriving every 2 ticks. On one tree
the fells cost more than the flinch saves: 5.15 ticks per roll overall (m), slower than the knife.
Priced with the route model (i, `flinch-model.ts`, demo respawn), the flinch saves **about 500
ticks of Woodcutting** with two melee NPCs phased 2 ticks apart at the two-willow tile south-east
of East Ardougne from level 73, and about 580 if two-oak tiles are used below 73 too. **A helper
in the Wilderness saves nothing**: no Wilderness tile reaches two oaks and the Wilderness has no
willows. That is down from the 700-1,000 read earlier. **Brief A2 (section 3b) then showed the NPC
variant end to end and closed it for the demo.** With two staff-spawned attackers on the
two-willow tile the cycle held on 93% of steady gaps, at 2.50 ticks per roll (m), 8% faster than
the model. But no NPC that exists on the demo can attack a player on that tile: the nearby spawns
cannot hold a target that far from home, the necromancer's summoned zombies cost more to gather
than they save, and the tree-spirit random event is switched off (`fly.toml:25`). **On the demo
the flinch is worth 0 Woodcutting ticks**, and rs/2's knife route stands.

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
| 1 | **2-tick Woodcutting by auto-retaliate flinch.** Drop (or any inventory op) on the tick after a roll; a hit that tick flinches the clock to `map_clock + 1`; click the tree next tick and it rolls at once. | [OSRS wiki: Tick manipulation, 2-tick Woodcutting](https://oldschool.runescape.wiki/w/Tick_manipulation#2-tick_Woodcutting); [Flinching](https://oldschool.runescape.wiki/w/Flinching) ("Flinching is also used for skilling"); [Woodcutting training](https://oldschool.runescape.wiki/w/Woodcutting_training) | Yes (r): flinch write `auto_retaliate.rs2:9-22` (PvP: `:37-50`); gate `busy2` = `hasInteraction() \|\| hasWaypoints()` (`engine/script/handlers/PlayerOps.ts:956-958`); NPC hit queues it with delay 0 (`npc_combat_melee.rs2:48`), PvP on every swing hit or miss (`pvp_melee.rs2:40`); tick order packets, NPCs, players (`engine/World.ts:402,414,425`); a delay-0 queue runs the same tick (`engine/entity/Player.ts:960-961`); queues run before interactions (`World.ts:785,801`); drops clear the interaction (`OpHeldHandler.ts:54-56`); woodcutting first click rolls at once on equality (`woodcut.rs2:97-99`) | Woodcutting, ~3,028 with the knife (woodcutting.md section 2) | **0 on the demo (r, section 3b)**: no NPC there can attack a player on a two-willow tile, and random events are off. With attackers spawned by staff command (lab only): ~500 at the two-willow tile (2674,3227) from 73, ~580 with two-oak tiles below 73 too (i, `flinch-model.ts`, demo D=20, against its 3,016 for the knife; section 2). 0 with a Wilderness helper | Two melee NPCs on the free cardinal tiles of a multi-combat tile reaching two trees, attacking 2 ticks apart; a drop on every other tick; auto-retaliate off while every tree is down (section 3a). One attacker gives a roll every 4 ticks (m), slower than the knife. The demo has no such pair (section 3b) | **Measured end to end with staff-spawned attackers; not applicable on the demo.** Mechanism (m, section 3a): 196 rolls at 99, 160 of 166 steady gaps at 2 ticks, 0 own attacks. Two hobgoblins on the east and south tiles of (2674,3227) (m, section 3b): 252 of 272 steady roll gaps at 2 ticks, 2.50 ticks per roll at 99 against the model's 2.72, a fell with the other willow standing costs about 0.2 ticks, 0 own attacks |
| 2 | **2-tick Mining on stays by the same flinch**, mixed with knife starters on moves | as row 1, and [OSRS wiki: 3-tick Mining](https://oldschool.runescape.wiki/w/Tick_manipulation#3-tick_Mining) | Yes (r): the first swing rolls at once on equality (`mining.rs2:83-85`); everything else as row 1. Walking sets waypoints, so the flinch tick must be a stay | Mining 63-99 band, ~3,173 with the knife at respawn 13 (mining.md section 2) | **0 to ~530** (i): the zoo cluster's 6 rocks cap it at 2.5 ticks/ore (6 rocks per 15-tick respawn window) against 3.00 now; 3,173 x (1 - 2.5/3) = 529 | No iron rock lies in a multi-combat zone (r, map scan in section 2), so the hit source is one NPC at the cluster (a flinch every 4 ticks only) or a helper at the Wilderness iron cluster (level 31) | Mechanism confirmed by brief A (section 3a); value unchanged. A single attacker flinches only every 4 ticks (m, section 3a), so the zoo cluster's one NPC is worth nothing; only a Wilderness helper at the level-31 iron cluster remains, untested. Brief B planner not run. |
| 3 | **Predicted obstacle clicks and chosen entry tiles on the Wilderness course** | [OSRS wiki: Wilderness Agility Course](https://oldschool.runescape.wiki/w/Wilderness_Agility_Course) (theoretical lap 67 ticks, against our measured 73-77); rs/2 agility.md section 8 open question | Clicks during an obstacle are dropped, not queued (r, `network/game/client/handler/OpLocHandler.ts:14-18`), so the gain is only reaction latency and walking. The rope swing charges `p_delay(distance)` from the trigger tile to its start tile (r, `wilderness_course.rs2:80-88`) | Agility, ~4,695 from level 75 (agility.md section 1) | **~60** (rope-swing tile alone, 1 tick x ~57 laps) to **~340** (6 ticks x ~57 laps if the bot still pays a reaction tick per obstacle) (i) | Bot work only | Untested. Brief C. |
| 4 | **Pin a Knight of Ardougne** by standing helpers on its free neighbouring tiles | [andromack: Setting up a sticky Ardy knight](https://andromack.com/blog/setting-up-a-sticky-ardy-knight) (OSRS uses a splasher); [Autumn Elegy, Efficient 1-99 Thieving Guide, 2004Scape, 7:35 "How to lure the knight"](https://www.youtube.com/watch?v=2QYqNvLwB1g&t=455s) | Yes (r): NPC steps respect player occupancy unless `passthru` (`engine/entity/Npc.ts:406-413`); players set the flag (`engine/entity/PathingEntity.ts:175-179`); a still NPC off its spawn teleports home after 501 ticks, one on its spawn never does (`Npc.ts:729-735`) | Thieving, ~1,975 from Fight Arena (thieving.md section 2) | **~85** (i): rs/2 measured 0.16 ticks per roll of walking at the best knight; x 536 rolls (57-99 run) = 86. Up to ~250 if the route's knight is the worst one (0.47 per roll) | 2-4 helper accounts standing still for the session; pin on the spawn tile | Untested. Brief D. |
| 5 | **Knight multiskilling**: delay-free helper-fed actions in the stun ticks | [Autumn Elegy guide, 11:09 "Knight multiskilling"](https://www.youtube.com/watch?v=2QYqNvLwB1g&t=669s) | A failure leaves the player stunned but not delayed for 7 of its 11 ticks (r, thieving.md section 4: clicks at T+4 to T+10 pass the packet check) | Fletching + Herblore + Crafting + Cooking, ~250 (rs/37, interleaving.md) | **up to ~250** (i), bounded by the delay-free helper-fed work; about 100 failures x 7 free ticks = ~700 free ticks on the knights | Owned by rs/38's interleaving plan; listed so it is not lost | Cross-reference only |

Rows 1 and 2 were ranked first on value. Row 1 is now closed: its setup works in the lab, but
the demo cannot supply the attackers, so it is worth 0 there (section 3b). It keeps its number
so references to it stay valid. Row 2 is a planner run plus one measurement (brief B), and its
only remaining hit source is a Wilderness helper.

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

Woodcutting (woodcutting.md section 2, demo respawn 20): the knife route is 3,028 ticks. The
first reading here took the cycle from 3 ticks to 2 and ignored fells, which gave 700-1,000. That
was too high. At a 2-tick cycle a tree fells every 8 successes, about every 16 ticks on oak at
100% success, so the number of trees reachable from the tile decides the value. On one oak the
lab measured 5.15 ticks per roll overall (m, section 3a), slower than the knife.

`flinch-model.ts` reruns woodcutting-model.ts's simulator with flinch bands. It uses the measured
2-tick cycle (4 ticks on 3.6% of steady gaps) and the measured all-down cost (the next roll comes
2 ticks after the respawn). Two things are inferred: a fell with another tree at the same tile
costs nothing, and a 2-tile walk to the next tree costs 4 ticks. The model reproduces the route
document's 4-tick total (3,962 against 3,958) and gives 3,016 for the knife at 3 ticks, against
the document's 3,031 (0.765 x 4-tick).

| Variant (i, `flinch-model.ts`, 400 runs) | Ticks to 99, demo D=20 | Quiet D=29 | Against the knife's 3,016 / 3,083 |
|---|---|---|---|
| Knife oaks to 73, then two NPCs at the two-willow tile (2674,3227) | 2,516 | 2,737 | **-500** / -346 |
| Two NPCs at two-tree tiles throughout (two-oak tile (3002,3312) to 73, then willows) | 2,436 | 2,715 | **-580** / -368 |
| Two NPCs at the two-oak tile to 73, then knife willows | 2,927 | 3,046 | -89 / -37 |
| Wilderness helper on two oaks a 2-tile walk apart, 15-73, then knife willows | 3,005 | 3,112 | -11 / +29 |
| Wilderness helper on oaks to 99 | 3,456 | 3,876 | +440 / +793 |
| One oak (the lab tile) to 99 | 4,972 | 6,174 | +1,956 / +3,091 |

- **Two NPC attackers at willows from 73 was the variant worth having: about 500 (i), and 0
  on the demo (section 3b).**
  Multi-combat tiles that reach two willows (r, `woodcutting-spots.ts` against
  `maps/multiway.csv`): (2672,3228) and (2674,3227), south-east of East Ardougne. Two-oak
  multi-combat tiles: (3002,3312), (2658,3409), (3099,3410), and two beside the jail guards near
  Draynor. Willows are 2x2 locs, so at (2674,3227) the west and north sides are tree and the
  east and south tiles are the only places a melee attacker can stand. The lab held the cycle
  there with two staff-spawned attackers, but no NPC on the demo can attack a player on that
  tile (section 3b).
- **A helper in the Wilderness is worth nothing.** The Wilderness has oaks at levels 1-2
  (3157,3525), (3192,3524), (3225,3521), (3266,3527), (3267,3521) (r, map scan of loc 1281) and
  no willows. No tile there reaches two oaks (r, `woodcutting-spots.ts`), so every fell means a
  walk, and the closest pair, (3266,3527) and (3267,3521), is 2 tiles apart at its nearest tiles.
  That only matches the knife below 73 and loses badly above it. The combat-level window
  (`pvp_combat.rs2:35-41`) and player-killer exposure come on top.
- **Reaction path.** The loop reacts to a hitsplat within one tick: the bot sees the hit on its
  label for tick F, and the click must land on F+1. In the lab that held on 196 of 196 rolls (m,
  local engine). Against the demo through the SDK relay, reactions land 2-3 ticks late
  (LAB.md), so the loop must run in the page like the knife loops (cairn://p/rs/97), or click
  on hit ticks predicted from the attackers' fixed 4-tick period.

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

**A. Flinch 2-tick Woodcutting (row 1). Done: mechanism confirmed, section 3a.** The brief as
written (its original valuation of 700-1,000 is superseded by section 2): the woodcutting
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
price fells and level-ups. **Start with an engine trace**, because the attempt in section 3a
failed for an unknown reason. A run-only patch, applied and discarded in the batch the way
rs/2's `woodcutting-trace.patch` is, should log, for every run of
`[queue,playerhit_n_retaliate]`, the tick, `busy2`, `%action_delay` before and after, and
whether the write happened; and for every woodcutting label, the tick, `%action_delay` and
whether it rolled. One 100-tick run then shows which link fails: no queue run, `busy2` true
(an interaction or waypoint survives the drop), the clock not expired, or the click landing a
tick late. If the hitsplat is seen one label late, try an empty hand (a `+2` flinch, which a
late click still meets) or predict the next hit from the NPC's 4-tick period.

**A2. Two attackers at the two-willow tile (row 1; about 500). Done: passes in the lab, not
applicable on the demo, section 3b.** In the woodcutting block at
`NODE_TICKRATE=300`, Woodcutting 99, stand at (2674,3227) and run
`flinch-wc.ts:npcs40:2500:knife:200:2674,3227:Willow` with `TRACE_PATCH=flinch-trace.patch`.
First check that two attackers can engage from the east and south tiles (the two-oak tile
engaged only one, section 3a). Then measure the steady gap histogram and the cost of a fell
with the other willow standing, which the model assumes is 0. Success criterion: at least 80%
of steady gaps at 2 ticks, and an overall ticks per roll within 10% of `flinch-model.ts`'s
willow band. Then find a way to bring two real attackers there in phase, since `::npcadd` is
staff-only.

### 3a. Lab result (2026-10-21): the flinch works; the first attempt's setup did not

**Verdict: the auto-retaliate flinch gives a 2-tick Woodcutting cycle in this revision (m).**
Every link read in section 2 holds in the engine trace. The 2-tick cycle held on 96% of steady
gaps over 196 rolls at level 99, and the player's own attack never fired.

**Setup.** Executor `fedora` (32 cores, load average 1-4 except at the end of run 5), local
engine at `NODE_TICKRATE=300`, headless lite client, through
[`woodcutting-lab.sh`](../scripts/woodcutting-lab.sh) with
`TRACE_PATCH=docs/speedrun/scripts/flinch-trace.patch`. That patch is run-only: it is applied
for the batch and reverted on exit, and server/ is unchanged on the branch. It logs `FLTRACE`
lines for every run of the retaliate and damage queues (with access state), for every woodcutting
and combat script run (interaction, waypoints and `%action_delay` before and after, and
`%option_nodef`), for every skill roll and item or loc packet, and for each player's state at the
start and end of its tick. [`flinch-trace-summary.ts`](../scripts/flinch-trace-summary.ts)
counts flinch writes, rolls, and attacks that fired. Bot
[`flinch-wc.ts`](../scripts/flinch-wc.ts): Cairn at Woodcutting, Defence and Hitpoints 99,
bronze thrown knives wielded on accurate (flinch +1), rune axe in the pack, hobgoblins added with
`::npcadd hobgoblin_unarmed`. On every label, if a new hitsplat is seen and the previous label
was not a click, it clicks a standing tree; otherwise it drops one log.

**What the trace shows** (first run, the 3a script unchanged; ticks are server ticks). At tick
97 a hobgoblin's swing queued `[queue,playerhit_n_retaliate]` with delay 0, and it ran the same
tick. A drop had cleared the interaction (`inter=0 wp=0`), and `%action_delay` was 96, so
expired. The queue wrote 98 (map_clock + 1) and set the attack interaction. The tree click sent
on the bot's label for tick 97 landed on 98, replaced the attack, and `attempt_cut_tree` rolled
at once with `%action_delay = map_clock`. That run gave 7 rolls, all of them flinch-driven. The
first attempt's bot lost the rest to its setup, not to the engine:

- **Attackers on adjacent ticks.** Two hobgoblins hit on ticks 1 and 2 mod 4. The second hit
  always fell on the click tick, found the chop interaction (`busy2` true) and wrote nothing,
  so the cycle was 4 ticks. Melee NPCs attack every 4 ticks, so a 2-tick cycle needs two
  attackers whose hits land 2 ticks apart. A hit on a click tick is harmless.
- **A skipped label after each click.** With no drop on the tick after the roll, `cut_tree`
  re-armed the clock +3 (103 → 106 in the trace), and the next hit found it unexpired.
- **No packet on the tick after a hit.** The attack interaction from `p_opnpc(2)` then fires
  the player's own attack on the next tick (`player_ranged_attack` moving the clock +3). A drop
  or a click on that tick prevents it, because both replace the interaction. A hit that finds
  the clock unexpired and no interaction fires the attack the same tick, and nothing can stop
  that. This happens when two hits come on consecutive ticks while no tree can be clicked.

Why the first attempt's hit-driven runs got 0 rolls rather than a few is not settled. They ran
on `bgsrv-mac`; a click landing a tick late (F+2) finds the +1 clock expired and arms it +3,
which fits 0 rolls, but it was not traced.

| Run (all m) | Setup | Rolls | Steady roll gaps (ticks:count) | Own attacks | Reading |
|---|---|---|---|---|---|
| 1 | 3a script; 2 hobgoblins; one oak, (2948,3315) | 7 | 4:5, 8:1 | 2, before the loop | Flinch works; attackers on adjacent ticks |
| 2 | spawns 12 ticks apart | 57 | 4:26, 8:24 | 14, while spawning with no logs to drop | All four attackers on one residue mod 4 (12 is a multiple of the period) |
| 3 | spawn controller (below) | 98 | **2:66**, 4:3 | 74, all while the oak was down | Attackers on residues 0, 2 and 3; consecutive hits during waits fired the attack; the Ranged and Hitpoints xp raised the combat level and later spawns stopped hunting |
| 4 | two-oak tile (3002,3312); auto-retaliate off while both trees are down | 110 | 4:61, 8:15 | **0** | Only one of 10 spawned hobgoblins engaged (all hits on one residue): a tile between two trees leaves only its east and west tiles for melee attackers |
| **5** | **one oak (2948,3315), full bot** | **196** | **2:160, 4:6** | **0** (knives 1,000 → 1,000) | **The brief A measurement.** 196 of 196 rolls on the tick after a flinch write; trace: 204 flinch writes, 0 retaliate runs blocked by `busy2`, 0 with the clock unexpired, 296 hits taken with auto-retaliate off. Oak fells: 22 (1 in 8.9 rolls), each followed by an all-down wait of 30-32 ticks at D=29, so 5.15 ticks per roll overall |

The bot as measured in run 5:

- **Spawn controller.** The delay from a spawn to the NPC's first hit is not constant mod 4
  (m). A spawn timed for residue 2 landed on residue 3. So the bot keeps adding attackers
  while the hits of the last 8 ticks lack two residues 2 apart. Extra attackers are harmless
  while a tree stands, because their hits fall on click ticks. `::npcadd` NPCs despawn after
  500 ticks (r, `ClientCheatHandler.ts:515`), and the controller re-spawns after that. After
  about tick 1,060 of run 5, newly added hobgoblins no longer engaged, and the run stopped at
  196 of its 200 rolls. The cause was not traced: the account's combat level was unchanged and
  no own attack fired.
- **Auto-retaliate off while every tree is down** (button `controls:com_3`, back on with
  `com_2` when a tree respawns; `player_controls.rs2:4-20`). Hobgoblins are
  `huntmode=cowardly` (r, `all.npc`), so stray attacks that raise the combat level end the
  setup. With exactly two attackers 2 ticks apart, the toggle is not needed, because the
  drops alone keep the attack from firing.

The single-oak result prices the setup, not the mechanism. A route needs a tile that reaches
two or more trees with room for two melee attackers, or attackers that hit from range. Section
2 prices the variants, and brief A2 tests the best one.

### 3b. Brief A2 result (2026-10-21): two attackers hold the cycle at the two-willow tile; the demo has none

**Verdict: brief A2 passes in the lab and fails on the demo.** With two staff-spawned
hobgoblins on the east and south tiles of (2674,3227), 252 of 272 steady roll gaps were 2 ticks
(93%, m), and the rate at Woodcutting 99 was 2.50 ticks per roll and 3.65 per log (m). That is 8%
faster than `flinch-model.ts`'s two-willow band at the local player count (2.72 and 3.96, i), so
both success criteria hold. But no NPC that exists on the demo can attack a player standing on
that tile (r, below). Row 1 is therefore **not applicable on the demo** and worth 0 Woodcutting
ticks there. rs/2's knife route stands, and there is no route change to make.

**Setup.** Executor `bgsrv-mac` (12 cores; load average 1.3-1.8 just after the run, not logged
during it), local engine at `NODE_TICKRATE=300`, headless lite client, through
[`woodcutting-lab.sh`](../scripts/woodcutting-lab.sh) with
`TRACE_PATCH=docs/speedrun/scripts/flinch-trace.patch`, run-only as in section 3a. Cairn had
Woodcutting, Defence and Hitpoints 99, bronze thrown knives on accurate and a rune axe, and stood
at (2674,3227), which reaches the willows at (2674,3228) and (2672,3226). The run used
`flinch-wc.ts:pair16:9000:knife:200:2674,3227:Willow`, not the brief's `npcs40` form. The npcsN
controller times each spawn from a learned spawn-to-hit delay, and on a tile with exactly two free
cardinal sides that delay does not set the phase: each NPC's phase is the tick it first steps into
reach (`npc_combat.rs2:62`), after a random step off the player's tile
(`randomWalk`, `engine/entity/PathingEntity.ts:438-447`). The pairN mode of
[`flinch-wc.ts`](../scripts/flinch-wc.ts) adds two hobgoblins on one label and keeps them if,
24 ticks later, their hits cover two residues 2 apart mod 4. Otherwise it waits out the 500-tick
despawn and tries again. Gaps are scored only inside the phased windows. The numbers below come
from the engine trace, which counts every roll including those that gave no log. The bot's own
log counts xp drops only, so its gaps are longer.

| Measure (m, engine trace unless marked) | Result |
|---|---|
| Pair attempts | 2, both in phase at the first check: attackers on (2675,3227) east and (2674,3226) south, hits on residues 1 and 3, then 0 and 2, mod 4 |
| Phased windows | 729 ticks: the first pair held for 480 ticks until its despawn, the second for 249 until the run reached 200 logs |
| Rolls in the windows | 292, of which 200 gave a log (68.5%) |
| Steady roll gaps (ticks:count) | **2:252**, 4:20 (93% at 2) |
| Ticks per roll / per log | **2.50 / 3.65**; model 2.72 / 3.96 (i, `flinch-model.ts`, D=29) |
| Fells in the windows | 18: 11 with the other willow standing, 7 that left both down |
| Next roll after a fell with the other willow standing | 2 ticks on 10 of 11, 4 on 1: about 0.2 ticks per fell, against the model's 0 |
| Gaps across an all-down wait | 4, 6, 6, 16, 16, 20, 26 |
| Own attacks | **0** (knives 500 → 500). Whole run: 310 rolls, every one on the tick after a flinch write; 333 flinch writes; 1 retaliate run blocked by `busy2`; 52 during all-down waits with auto-retaliate off |

Two cautions. The pair came into phase on 2 of 2 attempts, which is too few to call reliable,
and why it did was not traced. The run also felled a willow every 11 logs against the model's 1
in 8, which is probably why it beat the model (i): fewer fells mean fewer all-down waits.

**Can the demo supply the attackers? No (r).** `::npcadd` needs staff level 3
(`network/game/client/handler/ClientCheatHandler.ts:189, 505`), so the attackers would have to be
NPCs that exist on the demo.

- **Spawns.** Within 30 tiles of (2674,3227) on plane 0, the NPC sections of the nine
  surrounding map squares hold one necromancer at (2671,3240) (`maps/m41_50.jm2:5340`) and five
  moss giants 17 to 25 tiles away (`maps/m42_50.jm2:4903-4907`). Invrigar the Necromancer is on
  plane 1 (`m41_50.jm2:5341`).
- **The hold rule.** An NPC in a melee op mode drops its target as soon as the target is more
  than `maxrange + 1` tiles from the NPC's spawn on either axis (`engine/entity/Npc.ts:659-668`,
  checked every tick through `validateTarget`, `:629-638`). `maxrange` defaults to
  `wanderrange + 2` (`cache/config/NpcType.ts:118-121`). The necromancer has wanderrange 5
  (`_unpack/225/all.npc:4702`), so it holds a target within 8 tiles of its spawn, and the willow
  tile is 13 away. Its retaliation is the default melee one
  (`areas/area_ardougne_east/scripts/necromancer_tower.rs2:10`, `npc_combat.rs2:7-28`), and it
  casts its spells from the same op handler (`necromancer_tower.rs2:16-17, 41-52`), so the ranged
  allowance (`Npc.ts:671-674`) does not apply. Moss giants have wanderrange 3 (`all.npc:2885`),
  so they hold within 6, and the nearest spawns 17 away. Neither can be lured onto the tile,
  because each turns back at the edge of its range.
- **Summoned zombies: possible, but a loss (i).** The necromancer summons a zombie on 12% of its
  attacks (`necromancer_tower.rs2:46-47`), 1 to 3 tiles from where it stands (`:56`), lasting
  200 ticks (`:65`). `npc_add` makes the summon tile the zombie's spawn
  (`engine/script/handlers/NpcOps.ts:58-66`), and zombies have wanderrange 6 (`all.npc:1918`).
  So a zombie summoned while the player fights at the south edge of the necromancer's range
  could hold the willow tile, about 5 tiles further south. Priced at its best: two zombies take on
  average 2 x 8.3 attacks x 4 ticks, about 67 ticks at the tower with no chopping. The pair then
  overlaps for at most about 167 ticks, which at the model's demo rates (3.54 against 4.41 ticks
  per log for the three-willow knife band) saves about 41. The wait costs more than the window
  saves even before the walk, the phase odds and the zombies' path out of the tower are counted,
  so this was not taken to the lab.
- **Random events.** The tree-spirit event spawns an attacker beside a woodcutting player
  (`macro events/scripts/woodcutting/macro_event_dryad.rs2:5-18`, called from
  `skill_woodcutting/scripts/woodcut.rs2:49-54`). It uses the default 4-tick period, which would
  suit the cycle. The demo turns random events off (`fly.toml:25`, `NODE_RANDOM_EVENTS =
  "false"`): `map_random_events` reads that flag (`engine/script/handlers/DebugOps.ts:27-28`,
  `util/Environment.ts:53`), and every event returns early when it is false
  (`macro events/scripts/macro_events.rs2:65-68`).
- **Players.** A helper can only attack in the Wilderness, which has no willows (section 2).

**Other two-tree multi-combat tiles.** With the willow tile out, what remains is the oak variant
below 73. The model prices it at most 89 ticks, even with a perfect 2-tick cycle (i, section 2
table). The natural attackers at those tiles are worse than that. Falador's two-oak tile
(3002,3312) has no NPC that can hold it. The barbarian village tile (3099,3410) has one barbarian
woman that can, and she attacks every 6 ticks (`all.npc:570`). The Draynor jail guards are
aggressive but attack every 5 ticks (`areas/area_draynor/configs/draynor.npc:183`), so two of
them give gaps of 2 and 3. The ranging guild guards near (2658,3409) retaliate at range 10 every 6
ticks (`minigames/game_ranging/configs/ranging.npc:28-29`), so two give nothing over the knife's
3-tick cycle, and only three in phase would give 2. None is worth setting up for under 89 ticks
(i). The spawn tiles and hold ranges for these four tiles were read for this brief by a
sub-agent; the attack rates cited here were re-read, the spawn tiles were not.

**Route consequence.** None. `skills/woodcutting.md` keeps the knife route (about 3,028
ticks). The flinch stays useful only where a helper can attack, which is row 2's Wilderness iron
cluster.

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
