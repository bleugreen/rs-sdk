# Troll Romance

**Verdict: SKIP the whole chain on the current route** (settled with the
quest-route coordinator, cairn://p/rs/3). Troll Romance needs Troll Stronghold,
which needs Death Plateau, so the 8,000 base Agility costs **about 2,735 ticks on
the fixed client (3,039 stock, 2,562 burst)** and returns about 1,150 ticks of
Agility training. Nothing else in the chain has value on the current route: Monkey
Madness option 1 already puts Strength and Attack past 99, Eadgar's Ruse is off
(cairn://p/rs/25 closed), and no quest-point gate needs the chain's 4 points. The
arithmetic is in [Chain verdict](#chain-verdict). Troll Romance on its own is about
1,260 ticks (1,350 stock, 1,208 burst) at 70 melee with Protect from Melee, for
8,000 Agility, 4,000 Strength and 2 quest points.

Fight and travel figures are measured at `NODE_TICKRATE=300` with
`docs/speedrun/scripts/quest-troll-lab.sh` (`quest-troll-fights.ts`,
`quest-troll-walk.ts`, `quest-troll-obstacles.ts`) unless labelled; dialogue is costed
from read page counts; totals come from `quest-troll-totals.ts`.

## Reward

- 8,000 base Agility and 4,000 base Strength: `stat_advance(agility, 80000)` and
  `stat_advance(strength, 40000)` (read, `quest_troll_love.rs2:304-305`).
- 25 base Agility per sled ride (`quest_troll_love.rs2:223,294`); this route rides
  once.
- 2 quest points (`general/configs/quest.constant:131`), 7 uncut gems (1 diamond, 2
  rubies, 4 emeralds, `quest_troll_love.rs2:301-303`): keep 7 inventory slots free.

## Requirements (as this server enforces them)

- **Troll Stronghold complete**: Ug will not talk before `%troll_quest` = 50
  (`ug.rs2:30-33`).
- **Agility 28, `stat()`**, only at the sled slope (`quest_troll_love.rs2:1-5`), so 25
  plus an Agility potion passes. The quest journal tests `stat_base`
  (`troll_love_journal.rs2:21`) but that only changes its text. The route also
  crosses Agility-15 rockslides and climbing rocks (`troll_stronghold.md`).
- **A waxed sled wielded** at the slope (`quest_troll_love.rs2:6-9`); it can only be
  wielded inside the Trollweiss sled zone, mapsquares 43_58 to 43_60
  (`:112-129`, `quest_troll_love.constant:14-15`), and not within 10 ticks of combat
  (`:113`).
- **Items the steps check:** yew or maple logs, an iron bar and rope for Dunstan
  (`quest_troll_love.rs2:59-65`); a bucket of wax, swamp tar and a cake tin for the
  wax (`:67-82`); a free slot for the flower (`:48-51`).
- **Climbing boots worn** for the rockslide at 2856,3612 from the south
  (`quest_troll.rs2:11`), which every way to the secret door from Burthorpe crosses.

## Items: helper-supplied and scored-account-only

| Item | Tradeable | Source |
|---|---|---|
| Yew logs, iron bar, rope, bucket of wax, swamp tar, cake tin | yes | helper; packed into Troll Stronghold's trade |
| Games necklace (3 charges here) | yes | helper |
| Sled, waxed sled, sled wax, Trollweiss | **no** (`all.obj`) | scored account |

## Step list

Varp `%troll_love` (`scope=perm`): 0, 5 started, 10 Aga, 15 Tenzing, 20 materials
asked, 22 sled made, 25 waxed, 30 flower, 35 Arrg to go, 40 Arrg beaten, 45 complete
(`quest_troll_love.constant`). The temporary varp `%wearing_sled`
(`quest_troll_love.varp`) resets on logout. The list starts at Dunstan, where Troll
Stronghold ends.

| # | Step | Dialogue runs | Pages + options | Walk | Interactions + waits | Fight | Stock | Fixed | Burst | Label |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Dunstan to the Death Plateau rocks, up, rockslides to the secret door, in, to Ug |  |  | 144 (143 route tiles + 71 measured) | 10 |  | 154 | 154 | 154 | measured legs (walk.ts); Dunstan -> rocks pathfinder |
| 2 | Ug: "Awww, you poor troll...", "Don't worry now, I'll see what I can do." (0 -> 5) | 2c,o,3c,o,4c | 9 + 2 |  |  |  | 24 | 12 | 6 | read |
| 3 | Run to Aga |  |  | 21 |  |  | 21 | 21 | 21 | measured (stile_to_ug) |
| 4 | Aga: "So... how's your... um... love life?", "Errr... I've got to go." (5 -> 10) | 1c,o,9c,o,1c | 11 + 2 |  |  |  | 28 | 14 | 7 | read |
| 5 | Games necklace to Burthorpe, run to Tenzing (door opens) |  |  | 63 (123 route tiles) | 22 |  | 85 | 85 | 85 | inferred |
| 6 | Tenzing: "Do you know where I can find Trollweiss?", "What would I need to make such a sled?" (10 -> 15) | 2c,o,13c,o,5c | 20 + 2 |  |  |  | 46 | 23 | 8 | read |
| 7 | Front door, run to Dunstan |  |  | 76 | 2 |  | 78 | 78 | 78 | measured walk |
| 8 | Dunstan: "I need a sled!!", "Yes." (15 -> 20) | 2c,o,1c,o,8c | 11 + 2 |  |  |  | 28 | 14 | 7 | read |
| 9 | Dunstan again with yew logs, iron bar, rope: sled (20 -> 22); walk off at the menu | 4c,s,2c | 7 + 0 |  |  |  | 16 | 8 | 4 | read |
| 10 | Swamp tar on bucket of wax (cake tin held), wax on sled (22 -> 25) |  |  |  | 4 |  | 4 | 4 | 4 | inferred, 2 item uses |
| 11 | To the Death Plateau rocks, secret door, through the stronghold to the level 2 top door |  |  | 181 (143 route tiles + 108 measured) | 23 |  | 204 | 204 | 204 | measured legs (walk.ts ts_in reversed); stronghold doors inferred |
| 12 | Trollheim to the ice cave, crevasse, sled start; wield sled, ride 1 (Agility 28) |  |  | 160 | 26 |  | 186 | 186 | 186 | measured (trollweiss leg) |
| 13 | Pick the Trollweiss (25 -> 30) |  |  |  | 3 |  | 3 | 3 | 3 | inferred, p_delay(0) |
| 14 | Games necklace to Burthorpe, to the rocks, secret door, Ug |  |  | 138 (131 route tiles + 71 measured) | 30 |  | 168 | 168 | 168 | measured legs; necklace inferred |
| 15 | Ug: flower (30 -> 35) | 10c | 10 + 0 |  |  |  | 22 | 11 | 3 | read |
| 16 | Run to Arrg; "I am here to kill you!"; fight in the arena (35 -> 40) |  |  | 16 |  | 144 | 160 | 160 | 160 | measured, 70 melee + Protect from Melee, n=3 (125-161), includes the talk |
| 17 | Arena west door, climbing rocks, rockslide, secret door, Ug |  |  | 105 |  |  | 105 | 105 | 105 | measured (arena_to_ug) |
| 18 | Ug: "Yes, he has been defeated." quest complete (40 -> 45); close the scroll | 7c | 7 + 0 |  | 2 |  | 18 | 10 | 5 | read |

Order notes (read): Tenzing's Trollweiss option needs `%troll_love` above 5
(`death_sherpa.rs2:6`), so Ug and Aga come first. Dunstan's first talk only records
the materials request (`death_smithy.rs2:228-235`); the second, with the materials
held, makes the sled. His follow-up menu has no exit option (`:258-273`); walk away
from it, since stage 22 is already set. After picking the flower, a games necklace
leaves Trollweiss directly. The second sled ride (25 measured) only lands you in a
pocket whose exit is a tunnel to the Rellekka cave, so skipping it costs 25 base
Agility and saves the ride plus the long way home.

### Travel, measured

| Leg | Ticks | Script leg |
|---|---|---|
| Stile (6), to the rockslide 2856,3612 (36), cross (2), to the rockslide 2833,3628 (20), cross (2), to the secret door (15), in (1), to Ug (18), to Aga (21) | 121 | `stile_to_ug` |
| Stronghold top door (2840,3690) to the Trollheim ice cave (88), in (1), to the crevasse (48), out (2), to the sled start (18) | 157 | `trollweiss` |
| Ride 1: slope click to arrival at 2790,3794 | 21 | `trollweiss` |
| To the Trollweiss flowers | 6 | `trollweiss` |
| Ride 2 (not on the route) | 25 | `trollweiss` |
| Arrg's arena (2914,3611) to the west door (19), out (3), climbing rocks 2879 (10 + 3), 2860 (13 + 5), rockslide 2833 (16 + 2), secret door (15 + 1), Ug (18) | 105 | `arena_to_ug` |

## Fight: Arrg

`trollromance_arrg_attackable` (read, `quest_troll_love.npc`): level 113, 140 hp,
70/140/40, +60 attack, +100 strength, slash defence 60 (stab and crush 35), **attack
rate 4**. Talking to Arrg and choosing "I am here to kill you!" teleports you into
Dad's arena and spawns him 4 tiles west for 500 ticks (`arrg.rs2:48-72`). Each attack
is a coin flip between melee and a ranged rock throw that can poison
(`arrg.rs2:82-126`); Protect from Melee stops only the melee half. Max hit about 38
(inferred, as the Troll General). His death hook advances the stage only if he finds
you as his hero (`arrg.rs2:91-96`).

Measured (`quest-troll-fights.ts arrg`, rune scimitar aggressive, rune armour, 20
swordfish; "total" includes the 13-tick talk and teleport):

| Stats | Weapon | Runs | Fight ticks | Total ticks | Hp lost | Food | Deaths |
|---|---|---|---|---|---|---|---|
| 70/70/70 + Protect from Melee | rune scimitar | 3 | 111-147, mean 130 | 125-161, mean 144 | 7-22 | 0 | 0 |
| 99/99/99, no prayer | rune scimitar | 3 | 75-102, mean 85 | 89-116, mean 99 | 5-62 | 0-1 | 0 |
| 70/70/70, no prayer | rune scimitar | 3 | 56-102 | 70-116 | 70-127 | 2-7 | **1 of 3** |
| 70/70/70, no prayer | rune warhammer | 3 | 120-207 | 134-221 | 104-124 | 6-9 | 0 |
| 40/40/40, no prayer | rune scimitar | 3 | | | | | **3 of 3** |

Minimum I would call safe: 70 melee with Protect from Melee, or 99 without it.

## Tick total

| Part | Ticks | Label |
|---|---|---|
| Walking | 904 | measured legs (most) plus pathfinder legs from Dunstan and the necklace arrival to the Death Plateau rocks |
| Interactions and waits (doors, climbs, item uses, sled, flower, 3 necklaces, scroll) | 122 | measured climbs and ride; doors and necklace inferred |
| Fight (Arrg, including the talk) | 144 | measured, 70 + Protect from Melee |
| Dialogue: 75 pages + 8 options | 180 stock / 90 fixed / 38 burst | read |
| **Total** | **1,350 stock / 1,260 fixed / 1,208 burst** | |

## Chain verdict

| Quest | Walk | Interactions + waits | Fights | Pages + options | Dialogue stock / fixed / burst | Total stock | Total fixed | Total burst |
|---|---|---|---|---|---|---|---|---|
| DP | 446 | 179 | 0 | 162 + 11 | 382 / 191 / 79 | 1007 | 816 | 704 |
| TS | 354 | 47 | 235 | 16 + 3 | 46 / 23 / 14 | 682 | 659 | 650 |
| TR | 904 | 122 | 144 | 75 + 8 | 180 / 90 / 38 | 1350 | 1260 | 1208 |
| chain | 1704 | 348 | 379 | 253 + 22 | 608 / 304 / 131 | 3039 | 2735 | 2562 |

(Death Plateau's table carries the walk from a necklace arrival; Troll Stronghold's
carries the one trade the chain needs after Death Plateau's own trade, which is not
included: add 9.)

**Verdict: skip.**

On the current route (Monkey Madness option 1, no Eadgar's Ruse, no quest-point
need):

| Reward | Base xp | Worth on this route | Basis |
|---|---|---|---|
| Troll Romance Agility | 8,000 | about 1,150 ticks | Wilderness-course ticks replaced on top of Grand Tree, Regicide and Underground Pass (`docs/speedrun/skills/agility.md` §3, cairn://p/rs/2) |
| Troll Romance Strength | 4,000 | 0 | Strength is already past 99: Monkey Madness 35,000 + Waterfall 13,750 = 48,750 (coordinator, from the quest documents) |
| Death Plateau Attack | 3,000 | 0 | Attack is already past 99: Tree Gnome Village 11,450 + Grand Tree 18,400 + Waterfall 13,750 + Fight Arena 12,175 |
| Melee xp from the chain's fights | about 1,600 + 530 Hitpoints | 0 | melee is capped by quests |
| Quest points | 4 | 0 | the Champions' Guild door is the only quest-point gate and Dragon Slayer is skipped (`quest_points.md`) |
| Unlocks | | 0 | Eadgar's Ruse is off (rs/25 closed: Herblore is helper-fed) |

**About 1,150 ticks of value against 2,735 ticks of quest (fixed client): a loss of
about 1,585 ticks** (about 1,890 on the stock client, 1,410 with dialogue bursts).

**Without Monkey Madness** it is still a loss. Attack is still past 99 without
Death Plateau (44,325 base from the other quests), so its 3,000 Attack is worth 0.
The 4,000 Strength replaces about 280 ticks at main's inferred 14.4 base Strength
per tick at 99 (super strength, Ultimate Strength, +76 strength bonus;
cairn://p/rs/main/task/per-skill/return). That training would also have produced
about 1,330 base Hitpoints (1.33 per damage), which the quest reward does not give.
So the chain returns about 1,150 + 280 = 1,430 ticks against 2,735: **a loss of
about 1,300** (inferred).

I first valued Strength and Attack at 4-6 base xp per tick. That is the rate the
chain's own fights produced (101-145 damage in 100-125 ticks at 70-99 melee against
high-defence bosses, with knockbacks and eating). It is a quest-fight rate, not a
training rate, so the verdict uses main's 14.4 instead.

**When to revisit:** if the plan adopts Eadgar's Ruse (which needs Death Plateau and
Troll Stronghold, `sanfew.rs2:102`) or needs quest points, Death Plateau and Troll
Stronghold become sunk cost. Troll Romance's own 1,260 ticks would then still buy
only about 1,150 Agility ticks plus whatever the Strength is worth on that route,
roughly break-even. The end state, logout and death-hook notes below are kept for
that case.

For the Agility route (cairn://p/rs/2's Agility child): this chain checks Agility 15
(`stat()`, three obstacles on the way to the arena and two to six more crossings
later, `quest_troll.rs2:7,18,46`) and 28 (`stat()`, the sled,
`quest_troll_love.rs2:2`). Both pass with an Agility potion from 12 and 25. The
obstacles themselves give 1 base xp per success (`stat_advance(agility, 10)`), about
12 in the whole chain.

## Risks and gotchas

- **Logout-unsafe stretch:** from wielding the waxed sled to the end of the ride.
  `%wearing_sled` is temporary (`primitives.md` §8) and the ride is a long scripted
  walk (`quest_troll_love.rs2:131-223`). Everything else is permanent.
- **Sled crash, 1 in 250** on ride 1 (`quest_troll_love.rs2:144-178`): you land at
  2799,3794 without the sled, which lies on the ground for 99 ticks; pick it up and
  ride again.
- **Arrg is the dangerous fight.** At 70 melee without prayer he killed the bot once
  in three runs; his rock throws poison. He despawns after 500 ticks
  (`arrg.rs2:67`), and a death sends you to Lumbridge with the stage still at 35.
- **Climbing rocks and rockslides** fail 23-29% at Agility 28 (read, see
  `troll_stronghold.md`); the chain crosses about 12 of them, so expect about 3 falls,
  about 12 ticks.
- **Inventory:** 7 slots for the gems at the end, and a free slot for the flower.
- The sled cannot be wielded within 10 ticks of combat (`quest_troll_love.rs2:113`):
  ice trolls in the Trollheim cave are aggressive (`cowardly` hunt mode).

## Open questions

- **Melee rates.** The verdict's Strength and Attack values use our quest fights'
  rate; when the skill-route issue publishes melee training rates, recompute.
- **End-to-end run.** Dialogue is read-counted; the stronghold interior on the way to
  the top door reuses `ts_in`'s legs in reverse and infers its doors.
- **The ride-2 pocket.** The lab's tunnel click at 2795,3717 did not register; the
  route avoids it by teleporting from the flowers.
- **Faster weapons.** A crush weapon did worse than the scimitar here; a dragon or
  better weapon, whatever the plan holds by then, was not tried.
