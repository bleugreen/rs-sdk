# Tick audit long shot L3: route long shots and ugly-but-legal levers

Read-only investigation (rs/657, under rs/158) answering the operator's 'throw in a couple of long
shots'. It covers four things. First, death as a teleport (D1). Second, xp that replaces a band
(D2). Third, random events (D3). Fourth, transport not yet on the route (D4). Last comes anything
else that is ugly but legal under tenet 6 (E). It changes no code, no test and no canonical
document. No demo login was made, and no lab engine was started. Every figure below comes from
source reads, the repository's measured rows, and the SDK's own offline pathfinder
(`sdk/pathfinding.ts` `findLongPath`, over the collision snapshot the walker uses).

Labels: **m** measured (the run is cited), **r** read from source (file:line; content paths are under
`server/content/scripts/` unless shown), **i** inferred (arithmetic shown), **e** estimate. Row
figures are RUN-ORDER.md section 2's expected column at this branch's base. **Every long shot here
needs its own lab pass before it reaches the run** (rs/158's rule); none of the three top
candidates touches the floor today.

## How the new walks were priced

The pathfinder gives a tile count for a walk. A tick count is the cast plus tiles / 2, times a
factor calibrated on legs that are already measured:

| Leg (calibration) | Pathfinder tiles | Cast + tiles / 2 | Measured | Ratio |
|---|---|---|---|---|
| T01-02 courtyard to the coop gate | 97 | 48.5 | 50 m without the drops | 1.03 |
| T02-03 coop gate to the row entry | 97 | 48.5 | 48-52 m | 0.99-1.07 |
| T05-06's run hop, Falador landing to the air ruins | 106 | 53 | 52-54 m | 1.00 |
| T06-07 Falador landing to the Taverley normal tree | 136 | 72 | 80.7 m without the drops, gate closed | 1.12 |
| T12-13 tail, Ardougne landing to Lawgof | 191 | 99.5 | 101.5 (lab) to 109 (browser, doors) m | 1.02-1.10 |
| L24a tail, Falador landing to Kaqemeex | 118 | 63 | 72 m | 1.14 |
| L24b Kaqemeex to the generals | 104 | 52 | 54 open / 60 closed m | 1.04-1.15 |
| T23-24 tail, Falador landing to the Rusty Anchor | 174 | 91 | 98 m | 1.08 |

New walks below take **x 1.08** (i, the midpoint), with the 1.00-1.15 band as their range. A
teleport spell is 4 (m), and the games necklace 8 (m, `quests/primitives.md`).

## 1. Ranked table

Ranked by payoff times plausibility. Ticks saved are on the row in force; 'range' is the
calibration band and the e terms.

| # | Candidate | Mechanism (file:line) | Rows it replaces or shortens | Ticks saved if it works | Plausibility | Cheapest probe (lab engine) | Owner |
|---|---|---|---|---|---|---|---|
| 1 | **Imp Catcher in place of S02, starting S04 at Magic 44** | `quests/quest_imp/scripts/quest_imp.rs2:4` `stat_advance(magic, 8750)` = 875 base (r), level 44 on the engine's curve (`server/engine/src/engine/entity/Player.ts:77-85`; 44 starts at 846.9 base, i); Mizgog at (3103,3163) level 2 (`maps/m48_49.jm2:6252`, npc 706, r); the hand-in `areas/area_wizard_tower/scripts/wizard_mizgog.rs2:6-19`; tower stairs `ladders+stairs/scripts/stairs.rs2:204,262`; Lumbridge teleport lands at the row (3221,3218) (`magic_spells.dbrow` tele_coord, r) | T01-02 (53), S02 (20.3), T02-03 (52) become one leg; S04 198 drops to ~106 | **~94 i** (range 80-105): S04 casts 31 enchants for 60, 29 x 3 (m, every in-load gap 3) + one ring load fewer (~5, i) = ~92; legs 125.3 against ~123 (i, below), ~2 | **high** (every step r; the walk is calibrated i; 4 beads to supply) | the new leg 3 times on the lab at S00's levels: courtyard to Mizgog to the row entry, beads in the pack, ~20 min; S04 re-run from Magic 44 with 31 rings (~10 min) | rs/185 (the quest module), rs/186 (legs, chain, `magic.ts` plan from 44), rs/41 (4 beads in H1; S04's ring loads) |
| 2 | **Goblin Diplomacy split early: the bartender after S06, the generals on the way to Taverley** | the quest starts only at the Rusty Anchor bartender (`quests/quest_gobdip/scripts/quest_gobdip.rs2:13-19`; the generals have no stage-0 branch, `:72-79`, r); the air altar's exit portal lands at (2983,3288) (`skill_runecraft/configs/runecraft.dbrow` air `exit_coord`, r), 87 tiles from the bartender; 200 base Crafting (`quest_gobdip.rs2:62`) gives Crafting 25 at S13, and the railing roll is `stat_random(crafting, 60, 150)` (`quests/quest_mcannon/scripts/railings.rs2:78`) | T23-24 (98) and L24b (60) deleted; S13's railings (B) shorter; T06-07 longer | **~118 i** (range ~100-140): +158 m (T23-24 98 + L24b 60); +85 i (railings: 6 successes at 83/256 is 18.5 tries against 25.2, 6.7 x 12.75); -117 i (T06-07 lengthens, below); -6 e (H20's S24 items need their own trade) | **medium** (moves the parts of a lab-accepted module; two new door-bound legs; H20 splits) | the new T06-07 three times on the lab from the air altar room with H20a's items served at the Rusty Anchor (~25 min); a slot-ledger walk of the split H20 (minutes) | rs/185 (`goblin-diplomacy.ts` parts), rs/186 (legs, chain), rs/41 (H20a/H20b) |
| 3 | **Games necklace for T06-07 (or, with #2, for the Kaqemeex leg)** | `general/scripts/enchanted_jewellry/necklace_of_minigames.rs2:6-20` lands at the games room (2207,4940); its two stairs (`ladders+stairs/scripts/stairs.rs2:474`, `:515`) put the player out at Burthorpe (2899,3564) (r). Made by Lvl-1 enchant of a sapphire necklace (`skill_magic/configs/magic_spells.dbrow:10`, r); no `tradeable=no` in its config (`enchanted_jewelry.obj:544-552`, i) | T06-07 82.7 to ~54; or L24a 72 (Rusty Anchor or cook to Kaqemeex) to ~57 | **~28 i** on T06-07 (range 22-33), **~15 i** on the Kaqemeex leg (range 10-20); with #2 taken, only the 15 | **high** (r; a slot to find in S06) | T06-07 by necklace 3 times on the lab (~10 min) | rs/186 (legs), rs/41 (one or two necklaces from a Magic-7 helper) |
| 4 | Crafting 30 before S13 from 22 leather gloves (if #2 is not taken) | gloves 13.8 base each from Crafting 1 (`skill_crafting/configs/leather/leather.dbrow:1-8`); crafting is delay-free (m: 26 bodies in 7.0 ticks, S25d's row) | S13's railings | ~75-90 e (95 i railings less ~6 crafting and a trade) | **low**: S13 starts with 11 free slots after H10 and needs 6 (RUN-ORDER S13, rs/379), so 22 leather + needle + thread does not fit one load | slot-ledger walk with the gloves in H10 (minutes) | rs/185, rs/41 |
| 5 | T14-15 by a PvP death at the spiders | death respawns at (3221,3218) (`player/scripts/death.rs2:50`), on 1 HP after a player kill (`:61-69`); the Wilderness above 20 blocks every teleport (`skill_magic/scripts/spells/teleport.rs2:17`) | T14-15's 66-tick walk to Wilderness 20 | **~26-35 i**, bad case negative: 66 m less the kill ~6 e, death 5 r, eat-back 0-9 i, the Khazard armour lost for good (+20 i at X, R8) | **low** (a combat-89-or-less 99-Strength helper logged in at Wilderness 37; PK exposure; R8b not staged) | one lab kill and respawn with R8b's package, ~20 min | rs/41 (killer + spawn helper), rs/186 (chain) |

If #1, #2 and the Kaqemeex half of #3 are all taken, the sum is about **227 i** (94 + 118 + 15).
They are independent: #1 is S00-S04, #2 is T06-07, S13 and S24, and #3's half is S24's first leg.

## 2. Specs for the top three

### 2.1 Imp Catcher replaces the coop (S02) and half of S04

SCORED's next login is at (3222,3222). Today it walks to the coop, casts 4 Wind Strikes to Magic 7,
walks back to the castle row and does Firemaking. S04 then casts 60 enchants for Magic 7-59. Imp
Catcher's reward is 875 base Magic (r), which is level 44 on this curve (i). From 44, the same
greedy plan that gives today's 12 sapphire / 27 emerald / 16 ruby / 5 diamond needs only **10
emerald, 16 ruby and 5 diamond, 31 casts**, ending at 2,524 base against 59's 2,468 (i, computed
on `Player.ts:77-85` and the spells' `experience` 175/370/590/670 in `magic_spells.dbrow`). That
is 29 casts fewer at the measured 3 ticks a cast. It also means one ring load fewer: 31 rings are
two loads, not three.

**The new leg** has these parts:

- At login, H1 with **4 beads** (red, yellow, black, white). They are tradeable: no
  `tradeable=no` in `quest_imp.obj`, and cert ids exist in `pack/obj.pack:1471,1475` (i). H1 also
  carries one more law rune (Lumbridge teleport: law, 3 air, 1 earth).
- The starter drops, 3 m, the same burst T01-02 does today.
- The walk to the tower stairs: 190 tiles, 95 x 1.08 = **~103 i**. It passes 37 tiles from the
  Draynor dark wizards at its closest (pathfinder waypoints).
- Two stair hops, ~5 e (`stairs.rs2:204`, `:262`).
- Mizgog's two talks in burst, ~6 i (about 19 pages and 2 choices at 5 pages a tick).
- The Lumbridge teleport, 4 m, and ~1.5 i to the row entry (3222,3219).

That totals **~123 i** against 125.3 today. S04 at ~106 i (198 less 87 less ~5) replaces 198.

**Side effects.** The bonus is +1 quest point, which closes R11 (exactly 32 QP at the Champions'
Guild door). Mizgog adds an amulet of accuracy, which is dropped. The ring supply falls by 12
sapphire and 17 emerald rings. S02's browser faults (R29 fault 2) leave the route. S03's dropper
cue is re-timed to the new arrival.

**Lab acceptance.** All of these pass on the lab at 400 ms, browser client, from (3222,3222):

- 3 of 3 runs with S00's real levels (combat 3, 10 HP), the beads and runes held: quest complete,
  Magic 44, the row entry reached, **no damage taken on the walk**, the leg's total at or under
  125 ticks.
- S04 from Magic 44 with 31 rings, 3 of 3, Magic 59 at its end, at or under ~110.
- A slot-ledger walk of H1 with the beads (the starter kit leaves ~10 free; H1 takes ~6 stacks). If
  they do not fit, the starter junk is dropped before H1 is accepted.

### 2.2 Goblin Diplomacy split: the bartender after S06, the generals before S07

S24 starts at the Rusty Anchor only because the quest starts there. The bartender's talk sets the
varp to 1, and at 0 the generals have no dialogue (r). T23-24 (98 m) and L24b (60 m) exist for
this quest alone. The new T06-07 does the quest on the way out of the air altar:

| Part | New T06-07 | Ticks |
|---|---|---|
| drop the air runes | as today | 2 m |
| room to the exit portal, out to (2983,3288) | `runecraft.rs2:1-9` | ~3 e |
| run to the bartender (3045,3257) | 87 tiles | 47 i |
| G1 talk, H20a (3 goblin mail, orange and blue dye), G2 dyes | moved from S24 | (4.3 m + trade + 1 m, net 0) |
| Falador teleport, run to the generals (2957,3511) | 133 tiles; 2 doors at (2958,3506) and (2958,3509), ~3 each closed (m, L24b) | 4 + 71.8 + 6 i |
| G3-G6 with Wartface | moved from S24 | (16 m, net 0) |
| run to the Taverley normal tree (2912,3495), where H4k waits | 122 tiles | 65.9 i |
| **New travel** | | **~200 i** against 82.7 m: **+117** |

S24 then runs cook to Kaqemeex (Falador teleport, the same landing, so L24a's 72 m), Druidic
Ritual, the Varrock teleport to Romeo (5.3 m), and R&J. T23-24 and L24b are gone. H20's other
items (the four meats, cadava berries, Falador and Varrock runes; SUPPLIES H20) need a trade near
the cook or on an existing Lumbridge hand-off, ~6 e. **Crafting 25 at S13** (200 base at 195 for
25, i) raises the railing chance from 61/256 to 83/256, so 6 successes take 18.5 tries against
25.2. At the browser's 12.75 a try that saves ~85 i, plus about a third fewer failure hits on H10's
sharks. Crafting ends S24 at 45 as today (750 + 200 base), so S25d does not move. The gold bar
reward (`quest_gobdip.rs2:63`) is dropped; H21a takes back one fewer.

**Lab acceptance.**

- The new T06-07 3 of 3 on the browser at 400 ms from the air altar stand, at the route's levels
  (combat ~31, Defence 1, 10 HP), H20a at the Rusty Anchor: quest stage 6 at the generals'
  exit, the tree tile reached, no damage taken, the leg at or under ~205 with the doors closed.
- `goblin-diplomacy.ts` passes its two parts unchanged; only their placement in the chain moves.
- S24 re-run from the cook with H20b: Druidic Ritual and R&J as measured.
- S13 from Crafting 25, 3 chains, the railing tries logged against 18.5 expected.
- The slot-ledger walk with the 3 mails held from the Rusty Anchor to the generals.

### 2.3 Games necklace into Burthorpe

The necklace teleports to the underground games room. Two staircases put the player out at
Burthorpe (2899,3564) (r). That tile is **72 tiles** from S07's normal tree, against 136 from the
Falador landing. `research/travel-and-overhead.md` (the 'Games necklace' bullet) ruled it out as
'no route site closer than from the Falador teleport'. That reading is true of the underground
tile (2207,4940), not of the Burthorpe exit, and is corrected here.

T06-07 by necklace is about **54 i**:

- drops 2 m;
- rub, choice and teleport 8 m;
- 5 tiles to the first stairs 2.5 i;
- two hops ~3 e;
- 72 tiles, 38.9 i.

That is against 82.7 m. The Kaqemeex leg (from the Rusty Anchor today, or from the cook under
2.2) is about **57 i** by necklace (8 + 5.5 + 81 tiles at 43.7) against 72 m.

**Slot rules.** S06 holds exactly 26 free for essence. With the necklace held, a 25-essence load
still reaches Runecraft 44: 7 x 25 x 5 base = 875 >= 846.9 (air pays 50 tenths, `runecraft.dbrow`,
i). So the necklace can come in H4, with the givers staged at 25, or with the last giver's load
(25 + the necklace). It is dropped after the rub. For the Kaqemeex leg it rides the trade just
before.

**Lab acceptance.** T06-07 by necklace 3 of 3 on the browser at 400 ms, at or under ~58. A 25-load
S06 reaching Runecraft 44 in 7 crafts (the module's `lib/xp.ts` check).

Under 2.2, T06-07 goes by Falador to the generals, and only the Kaqemeex half of this applies.

## 3. The questions, answered

### D1 Death as a free teleport

**Respawn points.** One: a random walkable tile within 2 of (3221,3218), Lumbridge
(`player/scripts/death.rs2:50`, `map_findsquare(0_50_50_21_18, 0, 2, ...)`, r). The only
exceptions are the Duel Arena and Castle Wars (`:15-26`).

**What SCORED keeps.** Unskulled, the three priciest single units by `oc_cost`, a fourth under
Protect Item, with the inventory scanned before the worn set and `destroy_death` items deleted
(`:77-95`, `:204-247`; `speedrun/lib/death-keep.ts` models it). Everything else drops: to the floor
after an NPC kill (`:134-136`), and to the killer after a player kill (`:174`, `:194`).

**The state after death.**

- HP is full after an NPC kill (`stat_reset_all`, `:64`).
- HP is **1 after a player kill**, and a death mark keeps any later death at 1 HP for a while
  (`:61-69`).
- Run energy is refilled (`:70`), and the skull and poison are cleared (`:71-72`).
- The sequence costs at least 5 ticks: `p_delay(1)` and `p_delay(3)` (`:3`, `:7`) plus the queue's
  tick (i), on top of the time to take lethal damage.

A spell teleport is 4 ticks (m), so death can only win where no teleport works: Wilderness above
20 (`teleport.rs2:17`; jewellery `necklace_of_minigames.rs2:11`, `ring_of_dueling.rs2:11`).

**Route legs checked:**

- **T14-15** (S14 at Wilderness 37 to Narnode): the only leg that walks out of a no-teleport zone,
  66 m to level 20. A player kill by our own helper is candidate #5. The kit SCORED carries is
  RUN-ORDER R8's T14-15 line (knife, antipoison(3), 8 sharks, death 49, chaos 16, air 234, fire 1,
  1,000 coins, the cannon set with ~30 balls, mithril scimitar, law and water 2; worn staff of
  fire, amulet of magic, Khazard helmet and armour).
- **The keep** is cannon parts (R8), so the spawn trade must take them back (it absorbs H11r).
- **The re-kit** is R8b's package (stageable, not staged; STEP-MANIFEST 'R8 respawn packages').
  Its honest cost is one ~5 e trade, the eat-back from 1 HP (0-9 i, overlappable with the
  teleport and tree waits), and the Khazard armour lost for good. The armour is untradeable; R8's
  iron substitute costs ~+20 i at segment X.
- **Net ~+26 to +35 i**, negative if anything slips. The killer must be within 37 combat levels
  of SCORED's ~52 (the Wilderness band) while hitting hard enough. That means a Strength pure at
  combat 89 or less, at a tile the feed shows to every PKer (R8).
- **T13-14, T15-16, T26-27, T27-17**: all go *into* the Wilderness or deeper, so a Lumbridge
  respawn moves away from the target. Nothing.
- **S17** is the last step; a death after the last level-up costs nothing (RUN-ORDER section 4)
  but saves nothing either.
- **T02-03** (coop to the row entry, 52 m) ends 1 tile from the respawn, and SCORED has Magic 7,
  short of the Lumbridge teleport's 31. But nothing near the coop can kill a 10-HP player in the
  ~40 ticks that would pay. There is no PvP outside the Wilderness, chickens hit 1, and the nearest
  casters are 75 tiles away. Moot under #1, which brings Magic 44 and the teleport.
- **Everywhere else** a spell teleport exists, and 4 beats 5 plus the kill. This agrees with
  `research/travel-and-overhead.md`'s deathwarp bullet.

### D2 Xp that replaces a band

The quest catalogue (every `stat_advance` under `quests/` and `minigames/`) was re-read against
the route's bands. Only two pay on this route, and neither as a band replacement in the obvious
sense:

- **Imp Catcher** (#1). Its 875 Magic is worth ~92 ticks of S04's enchanting. `quest_points.md`
  priced it only as quest-point filler (~94 burst), and `skills/magic.md` valued it against a
  Grand Tree start (its 'Imp Catcher + Witch's Potion' bullet). Neither priced it against the
  route's real Magic line (S02 + S04).
- **Goblin Diplomacy moved before S13** (#2). Its 200 Crafting is already on the route; moving it
  earlier makes it pay the railings.

**rs/185's Crafting question.** Crafting 30 needs **294 base**, not 534 (i, `Player.ts:77-85`;
30 starts at 293.8). The 534 does not reproduce from 1 to any level near 30. Nor does the ~119:
RUN-ORDER's S13 lever line and O47 give **~95 i** for Crafting 30 at arrival (7.5 tries fewer x
12.75), and `quests/dwarf_cannon.md` has no 119. Crafting 25 already captures ~85 of it (the
railing roll's slope is linear in level, `stat_random`). The cheapest sources, in order:

1. Goblin Diplomacy moved early (#2): its travel nets out positive because T23-24 and L24b go away.
2. 22 leather gloves (#4): blocked on S13's slots.
3. Sheep Shearer (150 base, ~68 i, `quests/quest_sheep/scripts/quest_sheep.rs2:5`): Crafting 22,
   which saves only ~79 tries x... about 79 i of railings for its ~68, so about +11. With #2 it
   adds only ~13 more (Crafting 25 to 31) for the same ~68.
4. Opals or snelms: their sources are not on the route.

**Off-route quests in expensive bands**, all negative. The repo's own pricing is in
`quests/README.md`'s exclusion table:

| Quest | Saving | Source |
|---|---|---|
| Tourist Trap's Agility and Thieving picks | -162 (burst) to -366 | README.md, its row |
| Monk's Friend | -24 / +14 burst, break-even | |
| Witch's House | -163 | |
| Tribal Totem | -140 | |
| Hazeel Cult | -190 | |
| Temple of Ikov | -200 | |
| Troll Romance alone | -117 to -244 (i); its chain -1,515 | |
| Regicide | -1,400 alone (13,750 Agility at S17's 7.87 base a tick is 1,747 ticks, against 1,830 + the forced Underground Pass trips) | `regicide.md` |
| Digsite | -272 | |
| Knight's Sword | -490 to -600 | |
| Waterfall | -356 or worse | |

Unpriced and small: Elemental Workshop's 5,000 Smithing is worth ~123 ticks at S25a's 40.5 a tick
(i), so it can pay only if it costs under that. Shades of Mort'ton, Zombie Queen and Murder Mystery
pay Crafting, which is cheap here.

**Minigames.** `stat_advance` occurs under `minigames/` only in the agility arena, gnome ball,
Mort'ton, ranging and trawler scripts (grep). One new reading: the Brimhaven arena's
**obstacles** pay 6-30 base each (`minigames/game_agilityarena/scripts/agilityarena.rs2:117-501`,
`agilityarena_zones.rs2:146-285`), on top of the untradeable tickets `research/free-xp.md` already
ruled out. That is perhaps 3-6 base a tick (e), below S17's 7.87. Nothing.

### D3 Random events

Off, and not plannable:

- `NODE_RANDOM_EVENTS` defaults false (`server/engine/src/util/Environment.ts:53`), and fly.toml:25
  sets it false.
- The 500-tick event timer is armed only when `map_random_events` is true
  (`login/scripts/login.rs2:40-42`).
- Every spawn path checked calls `macro_event_allowed`, which returns false with the flag off
  (`macro events/scripts/macro_events.rs2:65-68`): the timer, `general_spawn`, login, each skill's
  event label, the flax and teleport `afk_event` branches (`pickables.rs2:61-62`,
  `teleport.rs2:42-44`) and the staff cheat.
- About 50 of 65 `*_spawn` call sites were checked, all behind a gated label; the rest are
  unverified.
- The engine has no roll of its own (World.ts, grep).

So no genie lamp is reachable. If the unpublished demo code had switched events on, free-xp.md's
figures stand: 0.4-1.1 lamps over a run, worth 55-150 ticks, against bee swarms and maze teleports
that cost about as much. The event rate is a server `Math.random()` that no packet moves.

### D4 Transport not yet on the route

Inventory (r):

- gliders `areas/area_gnome/scripts/gnome_glider.rs2`, gated on the Grand Tree and members;
- spirit trees `area_gnome/scripts/spirit_tree.rs2`;
- ships `interface_boat/scripts/sail.rs2` and their callers;
- the one Wilderness lever pair, Ardougne to the Deserted Keep (`area_ardougne_east/scripts/wilderness_lever.rs2`);
- spell teleports (`skill_magic/scripts/spells/teleport.rs2`);
- ring of dueling (`ring_of_dueling.rs2`);
- games necklace (`necklace_of_minigames.rs2`);
- glory, unobtainable (RUN-ORDER, rs/123);
- the Ardougne wizard's teleports, gated on Tribal Totem and Rune Mysteries
  (`area_ardougne_east/scripts/wizard_cromperty.rs2:3,57-76`).

**Members.** The demo runs `NODE_MEMBERS=true` (fly.toml:23), so every members gate on trees and
gliders passes.

**Absent:** fairy rings, canoes, carpets, charter ships, tablets, the ectophial and a house
(grep, and `travel-and-overhead.md`'s 'Not present' list).

Leg by leg, against the walks above:

| Leg | Today | Faster way in this revision? |
|---|---|---|
| T06-07 | 82.7 m | **yes, the games necklace (~54 i), #3**; or the Goblin Diplomacy detour, #2 |
| L24a (Kaqemeex) | 72 m | **yes, the necklace (~57 i), #3** |
| T12-13 Lady Servil to Lawgof | 109 m | no. The village spirit tree is 189 pathfinder tiles from Lady Servil (the maze), and the stronghold has no path out east to Lawgof (the pathfinder stops at (2495,3455)) |
| T07-08 Taverley to Edmond | 138.7 m | no: Ardougne opens only with S08 (`teleport.rs2:22,35`); Castle Wars by ring is 244 Chebyshev from Edmond, worse by 20-37 (i) |
| T11-12 Narnode to Lady Servil | 74.7 m | no: walking out of the stronghold to its tree and the village tree breaks even only if the roots exit costs under ~16 (i), and the maze adds more |
| T13-14, T15-16, T26-27 | 178.7 / 143.7 / 180 m | no: the Ardougne lever is the only Wilderness entry nearer than a walk; walking to it from Lawgof or Daero is worse by 27-40 (i) |
| T14-15, T17 exits | 181 / 177.7 m | no transport; the Keep lever out is measured worse (187-188, 184-187); the PvP death is #5 |
| T18-19 | 49 m | no transport; the door-free route (~31 i, O25) is known |
| T20-21 | 72 (body) / 161 m (nature) | no: the Port Sarim ship is measured 311 |
| T21-22, T22-23, T23-24, T19-20 | 34 / 24 / 98 / 40.5 m | no: the Duel Arena ring to the fly spots is ~51 against 34; the rest already teleport. T23-24 goes away under #2 |
| T01-02, T02-03, T04-05, T05-06, T08-09, T09-10, T10-11, T16-18, T25-26, T27-17 | | no: the trees, gliders and ring landings are all farther than the current landings |

**Unused output.** S04 already makes ~27 rings of dueling (Lvl-2 on emerald,
`magic_spells.dbrow:21`) and hands them back unused. No leg wants either landing.

### E Anything else ugly but legal

- **Logging out inside a scripted wait saves 0 (r).** The logout button only sets a request
  (`login_logout/logout.rs2:11-24`, `PlayerOps.ts:636-639`). `World.ts:857-888` removes the player
  only when `canAccess()` holds (`!protect && !delayed && no modal`, `Player.ts:878-889`) and the
  engine queue is empty. So a ship ride, glider, spirit tree, teleport or the death sequence
  finishes on the clock before the save, and a queued teleport lands before it.
- **A session takeover** (a second login) skips the remaining delay but drops the action in
  progress, so a ride's jump never happens (`World.ts:988-1031`, `Player.ts:502-513`). It is
  refused less than 10 s after the last login (`playtime-audit.md` 1e). Nothing.
- **World-clock waits do elapse logged out**: dropped-item reveal (`Obj.ts:9,27-30` through
  `processZones`), loc, obj and NPC respawns and NPC timers (`World.ts:395-440,1149-1170`). The
  route's such waits are a helper's (S03's droppers), or a ~13-tick rock respawn, shorter than a
  relog's ~3. Nothing on SCORED's clock today. Player timers and temp varps do not help: they
  freeze or reset (`World.ts:786-791`, `VarPlayerType.ts:83`).
- **Monkey Madness's guard cooldown** is a temp varp (`quests/quest_mm/configs/quest_mm.varp:14`,
  `map_clock + 50`), so a relog clears it. But `monkey-madness.ts` never waits on it (grep: 0
  matches). Nothing.
- **Run energy** is infinite on the demo (`Environment.ts:47`, `NODE_INFINITE_RUN` default true,
  not overridden; `AMBASSADOR.md`). Known; nothing.
- **Hand-off merges and helper pre-staging**, from the candidates above: #1 rides H1 (beads, +1
  law); #2 splits H20 into H20a (Rusty Anchor, after S06) and H20b (near the cook); #5 folds H11r
  into the spawn trade; #3's necklace rides H4, the last S06 load or the S24 trade. Band C's merge
  candidates (H15 into H16, H14 inside the stun) are not repeated here.

## 4. Ruled out, and why

| Idea | Why not | Checked at |
|---|---|---|
| Death anywhere but T14-15 | a teleport exists and 4 < 5 + the kill; the Wilderness legs go deeper | `death.rs2:3,7,50`; `teleport.rs2:17` |
| Death at the coop to land at the row | no killer in reach of a 10-HP player outside the Wilderness; moot with #1 | `death.rs2:61-69` (PvP only in the Wilderness) |
| T12-13 by the spirit trees | 189 tiles to the village tree; no path from the stronghold to Lawgof | `sdk/pathfinding.ts` `findLongPath` |
| Reorder S11b-S13-S12 to save T12-13 | the same Ardougne-teleport starts either way; no walk from the stronghold to Lawgof | pathfinder; RUN-ORDER T11-12, T12-13, T13-14 |
| Ring of dueling or Castle Wars for any leg | no leg ends near either landing | `ring_of_dueling.rs2:21-23` |
| Glory, Ancient Magicks, tablets, fairy rings, canoes, carpets, charters, ectophial | absent or unobtainable | `travel-and-overhead.md`; RUN-ORDER rs/123 |
| Genie lamp and every random event | off and gated | `Environment.ts:53`; `macro_events.rs2:65-68`; `login.rs2:40-42` |
| Any off-route quest for Agility, Mining, Fishing, Thieving or Smithing | each negative by 24 to 4,400 on the repo's pricing | `quests/README.md`'s exclusion table; `regicide.md`; `underground_pass.md` |
| Brimhaven arena obstacles, Trawler, stalls | below the band rate | `agilityarena.rs2`; `free-xp.md` |
| Logging out inside a delay or ride | removal waits for the delay | `World.ts:857-888`; `Player.ts:878-889` |
| Session takeover to cut a ride | drops the ride's jump; refused under 10 s | `World.ts:988-1031`; `playtime-audit.md` 1e |
| Goblin Village from Burthorpe with #3 | 184 tiles round the mountain against 72 straight to the tree | pathfinder |
| The Rusty Anchor from the Falador landing before S06 or before S05 | 174 tiles from the landing against 87 from the air altar's exit | pathfinder; `runecraft.dbrow` |
| Sheep Shearer on top of #2 | +13 of railings for ~68 | `quest_points.md` |

## 5. Corrections to canon found on the way

- **`research/travel-and-overhead.md`**, the 'Games necklace' bullet, says that no route site is
  closer than from the Falador teleport. That holds only for the underground landing tile. The
  necklace's stairs put the player out at Burthorpe (2899,3564) (`stairs.rs2:474,515`), 72 tiles
  from S07's tree against 136 from the Falador landing (#3).
- **`skills/magic.md`**'s Imp Catcher row ('no: not in Package B's filler') and `quest_points.md`'s
  'small (875 Magic)' price the reward without S04's cast count. On the route it is ~92 ticks of
  enchanting (#1).
- **rs/185's figures for Crafting before S13.** Crafting 30 needs 294 base (not 534), and RUN-ORDER
  gives ~95 for it (not 119).
- The demo's `NODE_MEMBERS=true` (fly.toml:23) is the gate the spirit trees and gliders need
  (`spirit_tree.rs2:65`, `gnome_glider.rs2:116`). The travel documents do not state it.

## Sources

- Engine curve and xp: `server/engine/src/engine/entity/Player.ts:77-85,1889-1892`;
  `PlayerOps.ts:811-817`; spell xp in `skill_magic/configs/magic_spells.dbrow:5-44`.
- Death: `player/scripts/death.rs2`; `speedrun/lib/death-keep.ts`; RUN-ORDER.md R8;
  STEP-MANIFEST.md 'R8 respawn packages'.
- Logout and the world clock: `server/engine/src/engine/World.ts:395-440,786-791,826-904,988-1031,1149-1170`;
  `Player.ts:502-513,878-889`; `Obj.ts:9,27-30`; `Environment.ts:47,53`.
- Walks: `sdk/pathfinding.ts` `findLongPath`, run at this branch's base on the executor
  (calibration table above).
- Explorations under this node (rs/657 builder): the quest and minigame catalogue (D2), the
  transport inventory (D4) and the engine-waits read (E). Their file:line citations are carried
  into this page where used.
