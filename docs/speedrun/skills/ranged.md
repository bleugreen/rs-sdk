# Ranged: fastest route to 99

Scripts: [`ranged-cannon.ts`](../scripts/ranged-cannon.ts) (cannon set-up and
firing, alone or with the player's own melee or hand-ranged attacks, and
hand-ranged alone with `--cannon=0`), [`ranged-cannon-sites.ts`](../scripts/ranged-cannon-sites.ts)
(multi-combat site ranking from the content data),
[`ranged-cannon-coverage.ts`](../scripts/ranged-cannon-coverage.ts) (how many of the
cannon's 8 directions had a target each tick), [`ranged-model.ts`](../scripts/ranged-model.ts)
(route model: integrates the measured rates over the xp curve). Lab:
[../LAB.md](../LAB.md) with [`ranged-lab.sh`](../scripts/ranged-lab.sh) (ports 9210/9211/9212/43910,
agent 8110). Labels follow [README.md](README.md#labels).

Every headline rate below was measured at `NODE_TICKRATE=300` (one batch per
measurement set, local lab, 300-400 tick windows, one run each); numbers marked
"100 ms" are exploration runs. All xp is base xp (game xp / 25).

## 1. Recommendation

**Use the dwarf multicannon at the Wilderness poison spiders (3288,3810),
wielding a melee weapon until Ranged 70 and rune knives on rapid from 70.** The
cannon's hit roll uses the player's currently wielded attack style, not Ranged
(section 4), and its damage is 0-30 whatever the levels. So with the quests' Attack
99 and a rune scimitar it earns **11.5 Ranged per tick from Ranged 1** (measured).
From 70, throwing rune knives alongside it gives **17.3 Ranged per tick at 70, 18.7
at 85 and 22.7 at 99**, plus 2.1-3.3 Hitpoints. **Ranged 1 -> 99 takes about 2,200
ticks**, plus the Dwarf Cannon quest (1,078 ticks, `docs/speedrun/quests/dwarf_cannon.md`),
against **about 5,270 by knives alone**. No quest on the planned route gives Ranged xp
(section 3), so the post-quest start is level 1, or level ~54 after the Monkey
Madness Jungle Demon fight.

**On the Monkey Madness route** (option 1: Attack and Strength capped, gaps of
Defence 4,638 and Hitpoints 4,938 after MM): fire the cannon for **113 ticks before
MM** for Ranged 50 (the demon's magic shortbow). After MM, **cannon + defensive melee
for about 830 ticks** closes the Defence gap and brings Ranged to ~80. Then **cannon +
rapid rune knives for about 1,420 ticks** reaches Ranged 99, and Hitpoints fills as a
by-product (about 5,500 base against the 4,938 gap). That is **about 2,250 ticks after
MM for Ranged 99 + Defence 99 + Hitpoints 99** (inferred from measured rates,
`ranged-model.ts`). Hand-trained Ranged alone (longrange, then rapid) needs about
5,690.

### Combat comparison (the numbers the quest plan needs)

Base xp per tick, 300 ms lab, `ranged-cannon.ts`. The cannon site is the
Wilderness poison spiders. Players have Attack/Strength 99, Hitpoints 99, Prayer 99
with Protect from Melee, and a rune scimitar unless a ranged weapon is listed.

| Method | Ranged | Defence | Attack | Hitpoints | Notes (basis) |
|---|---|---|---|---|---|
| **Cannon alone** (scimitar wielded, auto-retaliate off), any Ranged level | **11.52** | 0 | 0 | 0 | 400 ticks; 0.51 balls/tick, 22.5 xp/ball |
| **Cannon + defensive melee** (scimitar, Defence 70) | **11.03** | **5.60** | 0 | 1.85 | 400 ticks |
| Melee alone, defensive, same site and gear | 0 | 6.64 | 0 | 2.18 | 400 ticks: the cannon costs melee ~1.0 xp/tick here |
| Cannon + reactive accurate melee (auto-retaliate only) | 10.14 | 0 | 5.40 | 1.79 | 400 ticks |
| **Cannon + rapid rune knives**, Ranged 70 / 85 / 99 | **17.34 / 18.69 / 22.72** | 0 | 0 | 2.12 / 2.42 / 3.28 | 300 ticks each; cannon's share 11.0 / 11.4 / 12.9 |
| Cannon + longrange rune knives, Ranged/Defence 70 | 12.07 | 2.19 | 0 | 1.45 | 300 ticks |
| **Rapid rune knives alone** (moss giants), Ranged 50 / 70 / 99 | **5.37 / 8.13 / 8.75** | 0 | 0 | 1.77 / 2.68 / 2.89 | 300 ticks each |
| Rapid rune darts alone, Ranged 70 | 8.00 | 0 | 0 | 2.65 | 300 ticks |
| **Longrange rune knives alone** (moss giants), Ranged/Defence 70 | **2.63** | **2.63** | 0 | 1.74 | 300 ticks |
| Cannon alone, Battlefield of Khazard (non-Wilderness fallback) | 9.13 | 0 | 0 | 0 | 400 ticks; 16.3 xp/ball (22 hp targets) |
| Cannon + defensive melee, Battlefield of Khazard | 8.88 | 3.37 | 0 | 1.12 | 400 ticks |

What this means for the plan (inferred, `ranged-model.ts`):

| Scenario | Plan | Ticks |
|---|---|---|
| Ranged 1 -> 50 before MM | cannon, melee weapon wielded | **113** firing + ~10 set-up and pick-up + travel; knives only: 628 |
| With MM option 1, from Ranged ~54 (50 + ~485 from the demon fight), Defence gap 4,638, HP gap 4,938 | (a) cannon alone for Ranged, then melee for Def/HP (8 + 2.67/tick, rs/30 preliminary) | 5,161 |
| | (b) hand only: longrange until Defence 99, then rapid knives | 5,689 |
| | (c) cannon + longrange until Defence 99, then cannon + rapid knives | 2,727 |
| | (d) cannon + defensive melee throughout | 3,459 |
| | **(e) cannon + defensive melee until Defence 99 (828), then cannon + rapid knives (1,420)** | **2,248** |
| Same, with Fremennik Trials (gaps Defence 1,826, HP 2,126) | (e) | 2,057 (**saves 191 ticks**) |
| Ranged only from ~54 (no gaps) | cannon + rapid knives | 2,041 |
| Pre-MM Ranged 70 instead of 50 (demon fight 178 instead of 267 ticks) | 463 + 178 + 2,030 | 2,670, against 2,628 for Ranged 50 first: no gain |
| **Net value of the cannon** (MM route, to Ranged/Def/HP 99) | with: 113 + 267 + 2,248 + Dwarf Cannon 1,078 = 3,706; without: knives 628 + 267 + 5,689 = 6,584 | **saves about 2,880 ticks** |

**No-MM scenario** (Strength gap 26,188, Defence 24,638, most of Hitpoints):
longrange closes Defence at 2.63/tick (about 9,370 ticks), far behind melee
(about 3,080 at rs/30's preliminary 8/tick). Defence should be meleed. The cheapest
Ranged there is the cannon *in parallel* with that melee. At the spiders defensive
melee runs at 5.60/tick with the cannon against rs/30's 8/tick at its best
single-combat target, so Ranged 99 (about 3,460 ticks of cannon at 11.03) costs
about 3,460 x (8 - 5.6) / 8 = **~1,040 ticks of melee time** (inferred), against 2,196
for a dedicated cannon + knives route. The melee rate at the spiders without the
cannon is 6.64, so most of that penalty is the site (spiders have 52 defence), not
the cannon.

## 2. Route by level band

Rates measured at 300 ms (`ranged-cannon.ts`, windows as in section 1); band ticks
inferred by integrating them over the xp curve (`ranged-model.ts`).

| Band | Method | Location | Unlock | Base xp / action (read) | Ticks / action | Success rate | Base xp / tick | Ticks for band |
|---|---|---|---|---|---|---|---|---|
| 1-50 | Cannon, rune scimitar wielded (Attack 99 from quests), auto-retaliate off | Wilderness poison spiders, cannon at (3287,3809) | Dwarf Cannon quest; cannon set from a helper | 2 x damage per hit, damage 0-30 (`cannon_fire.rs2:117-119`) | 1 shot per tick at most, one of 8 directions per tick (`cannon_fire.rs2:91`); 0.51 shots/tick measured | 22.5 xp per ball measured (about 75% hits at ~15 average) | 11.52 (measured) | 113 |
| 50-70 | same (or cannon + defensive melee on the MM route: 11.03 Ranged + 5.60 Defence) | same | | same | same | | 11.52 | 349 |
| 70-85 | Cannon + rune knives on rapid | same | Ranged 40 for rune knives | cannon as above; knives 4 x damage + 1.33 x damage HP (`combat.rs2:155-167`) | knives every 2 ticks (attackrate 3, rapid -1: `knives.obj`, `player_ranged.rs2:15-24`) | | 17.34 at 70, 18.69 at 85 (measured) | 542 |
| 85-99 | same | same | | | | | 18.69 at 85, 22.72 at 99 (measured) | 1,192 |

Totals:

| Start | Ticks to 99 | Basis |
|---|---|---|
| Level 1 (no Ranged quests on route) | **~2,200** (2,196) | inferred from measured rates; + Dwarf Cannon quest 1,078 if not already done |
| ~54 after the MM demon fight (1,790 base) | ~2,040 | inferred |
| Level 1, knives only (no cannon) | ~5,270 | inferred; 1-40 from the 100 ms sweep, 10/30/50/70/99 at 300 ms |
| Level 1, cannon alone (melee weapon, never knives) | ~3,470 | inferred (39,938 / 11.52) |

## 3. Quest xp

No quest on the planned route (rs/3, as of 21:00: Tree Gnome Village, Grand Tree,
Waterfall, Fight Arena, Death Plateau, Holy Grail, Mage Arena, Dwarf Cannon, Monkey
Madness option 1, the troll and Regicide chains, Sea Slug, Fishing Contest, Doric's)
awards Ranged. The Ranged rewards in the content are all off route (read):

| Quest | Base Ranged | Source |
|---|---|---|
| Temple of Ikov | 10,500 | `quest_ikov.rs2:62,73` |
| Horror from the Deep | 4,662 | `quest_horror.rs2:493` |
| Heroes' Quest | 2,075 | `quest_hero.rs2:33` |
| Big Chompy Bird Hunting | 735 | `quest_chompybird.rs2:48` |

Monkey Madness's Jungle Demon fight itself gives about 430-540 base Ranged
(measured in `monkey_madness.md`), so the post-MM start is about 1,790 base
(level 54) after a pre-MM Ranged 50. Fremennik Trials (2,812 in each of ten skills,
`quest_viking.rs2:130-144`) would add Ranged too if it joins the route; its value for
the combat gaps is in section 1.

## 4. Mechanics

### The cannon (`server/content/scripts/quests/quest_mcannon/scripts/`)

- **Set-up gate:** `%mcannon` must be 11, Dwarf Cannon complete
  (`cannon_setup.rs2:52-56`). It needs a clear 3x3, and is refused in banks, the
  dwarf mines, the Duel Arena, Castle Wars, the Fight Arena and under the lighthouse
  (`cannon_setup.rs2:64-107`). Only one cannon per player (`%ownedmcannon`,
  `:59-63`).
- **Set-up time:** 9-10 ticks from the base click to Fire at 300 ms (measured, 9
  set-ups): base 4-5 ticks (the player steps aside, `p_delay(0)`,
  `cannon_setup.rs2:114-130`), then stand, barrels and furnace by use-on-loc, load,
  Fire. The stock `bot.useItemOnLoc` path took 23 (`dwarf_cannon.md`); raw
  `sendUseItemOnLoc` packets on consecutive ticks give 9. **Pick-up: 1 tick**
  (measured) and needs 4 free slots; it returns unfired balls (`:230-244`).
- **Firing:** a 1-tick timer advances one of 8 directions per tick
  (`cannon_fire.rs2:1-91`). Each direction searches three squares (Chebyshev radius 1
  at 3 tiles, radius 2 at 7, radius 5 at 14; diagonals at 2, 5, 12), measured to
  the npc's SW tile (`NpcHuntAllCommandIterator`, `ScriptIterators.ts`). It shoots the
  nearest npc there with line of sight. **At most one shot per tick.** Tiles next to
  the cannon are not covered.
- **Who it can hit:** `~npc_is_attackable` and `~player_in_combat_check`
  (`cannon_fire.rs2:104-109`, `player_combat.rs2:101-132`). In single-combat areas
  that blocks every npc except the one attacking you, so the cannon only works in
  multi-combat zones (`maps/multiway.csv`).
- **Accuracy follows the wielded style:** `~player_npc_hit_roll(%damagetype)`
  (`cannon_fire.rs2:116`, `player_combat.rs2:52-68`) rolls the player's
  `%com_*attack` for the current weapon's damage type against the npc's defence for
  that type. With a scimitar it is the slash roll (Attack level + slash bonus against
  the npc's slash defence), with knives the ranged roll. **The xp still goes to
  Ranged** (`cannon_fire.rs2:119`). Measured: at Ranged 1 the cannon earned 11.52/tick
  with a rune scimitar (Attack 99) and 1.16/tick (1.9 xp per ball) with iron knives.
- **Damage and xp:** `randominc(min(30, ~npc_max_dealt(30, 0)))`, independent of any
  level (`cannon_fire.rs2:117`; `npc_max_dealt` only matters for Horror from the Deep's
  daggannoths). Xp is `2 x min(damage, npc hp)` base Ranged times the npc's
  combat-xp multiplier (`:118-119`; multipliers only ever reduce,
  `combat.param:165-167`). Ranged only, no Hitpoints.
- **Ammo:** 30 balls per load, one per shot, hit or miss (`cannon_fire.rs2:113`,
  `cannon_setup.rs2:264-281`). Loading tops up to 30. When the count reaches 0 the
  timer stops at the next north step ("Your cannon is out of ammo!",
  `cannon_fire.rs2:21-25`), and the cannon needs a reload *and* a new Fire click. The
  measurements reloaded every 20 ticks (no dry ticks in any 300 ms run). That is one
  use-item-on-loc packet from beside the cannon, so stock and 5-packet clients cost
  the same.
- **Decay:** every `loc_add`/`loc_change` sets a 2,500-tick lifetime
  (`^cannon_decay_length`, `cannon.constant:1`); reloading does not renew it. At 2,500
  ticks the cannon vanishes ("Your cannon has decayed!"). `%ownedmcannon` stays set,
  so a new one cannot be built until Nulodion replaces it for free
  (`nulodion.rs2:91-143`, at the Black Guard base). **Pick it up and re-set it before
  2,500 ticks**: about 10 ticks, once in this route.
- **Coverage measured:** at the spiders 65-78% of directions had a live target in
  their squares on a given tick (`ranged-cannon-coverage.ts`), and the cannon fired on
  51-67% of ticks; the gap is line of sight and targets at 0 hp. Moving the player off
  the cannon (5-6 tiles away) lowered the rate (9.2-12.3 against 12.3, 100 ms), because
  retaliating spiders follow the player out of the squares. Stand where set-up leaves
  you.

### Hand-trained Ranged (`skill_combat/scripts/player/player_ranged.rs2`)

- **Attack speed:** `attackrate` from the weapon (`player_ranged.rs2:16-24`), minus 1
  on rapid. Knives and darts are 3 (`skill_combat/configs/ranged/knives.obj`,
  `darts.obj`), so 2 ticks on rapid. Shortbows use the default 4
  (`combat.param:76-78`), so 3. The rune thrownaxe is 5.
- **Bonuses (read):** rune knife +25 attack / +24 strength (Ranged 40), rune dart +15 /
  +14 (40), adamant knife +15 / +14 (30), mithril knife +11 / +10 (20), black +10 / +8
  (10), steel +8 / +7 (5), iron +5 / +4 (1). Magic shortbow +69 attack (Ranged 50), rune
  arrows +49 strength (40).
- **Max hit:** `(effective x (bonus + 64) + 320) / 640`, effective = Ranged + 8 (+3 on
  accurate) (`combat.rs2:7-12`, `player_combat_stat.rs2:68-100`). Rune knife at 99
  rapid: 15; magic shortbow + rune arrows: 19. Iron knife at Ranged 1: 1, which is why
  the first levels by hand are so slow.
- **Xp:** rapid and accurate give 4 x damage Ranged; **longrange 2 x damage Ranged + 2 x
  damage Defence**; all styles add 1.33 x damage Hitpoints (`combat.rs2:144-167`).
  Longrange keeps the 3-tick knife clock (no rapid -1), so it deals about two thirds of
  rapid's damage per tick and puts half of it in Defence: 2.63 + 2.63 against 8.13
  measured at 70.
- **Knives against the bow:** at Ranged 70 on moss giants, rune knives 8.13, rune darts
  8.00, magic shortbow + rune arrows 7.36 (100 ms) per tick. Knives win on the 2-tick clock.

### Hand-ranged level sweep (moss giants at (2699,3212), rapid, `--hold=1`)

| Ranged | Weapon | Ranged / tick | HP / tick | Rate basis |
|---|---|---|---|---|
| 1 | iron knife (accurate, max hit 1) | 0.14 | 0.05 | 100 ms, 250 ticks |
| 10 | iron knife accurate / black knife rapid | 0.41 / 0.43 | 0.13 / 0.18 | 300 ms / 100 ms |
| 20 | mithril knife | 1.25 | 0.41 | 100 ms |
| 30 | adamant knife | 2.17 | 0.71 | 300 ms, 300 ticks |
| 40 | rune knife | 4.00 | 1.33 | 100 ms |
| 50 | rune knife | 5.37 | 1.77 | 300 ms |
| 70 | rune knife | 8.13 | 2.68 | 300 ms |
| 90 | rune knife | 8.70 | 2.89 | 100 ms |
| 99 | rune knife | 8.75 | 2.89 | 300 ms |

About 0.45 knives are used per tick (130-140 per 300 ticks): most drop under the
target and the rest break (`player_ranged.rs2:123-134`). The script does not pick them
up.

## 5. Alternatives considered

- **Other cannon sites** (`ranged-cannon-sites.ts` ranks every multi-combat cluster by
  spawns and hp regrowth). Ape Atoll dungeon zombie monkeys (24 spawns, 60-90 hp,
  needs Monkey Madness access): 11.05 at 100 ms at one spot, 4.26 at 300 ms at another,
  because walls block line of sight. Battlefield of Khazard troops (23 spawns, 22 hp): 9.13
  at 300 ms, about 20% below the spiders, since every hit is capped at 22. Horror from
  the Deep's dagannoths and the deep-Wilderness clusters are off route or worse. White
  Knights in Falador, pack wolves on White Wolf Mountain and the Varrock sewer red
  spiders have too few spawns (3-7 hp regrowth per tick).
- **Cannon in a single-combat area:** only the npc attacking you can be hit, and only
  when the sweep points at it (1 tick in 8). Measured 0 xp in 60 ticks while a goblin
  attacked (`dwarf_cannon.md`).
- **Hand Ranged without the cannon:** 5,270 ticks from 1 (2.4 times the cannon route) and
  628 to 50 (5.6 times).
- **Longrange for Defence:** 2.63 Defence per tick, about a third of melee's. For the
  with-MM gap of 4,638 that is about 1,760 ticks (yielding 4,640 Ranged and 3,070 HP).
  Cannon + defensive melee closes it in about 830 while also giving 9,100 Ranged.
  Cannon + longrange (2.19 Defence) is plan (c), 480 ticks behind plan (e).
- **Cannon + knives below 70:** not measured. At 70 the knives' ranged roll already
  makes the cannon slightly less accurate than with the scimitar (11.0 against 11.5).
  The total is still 17.3 against 11.5, so switching earlier (from 40, rune knives)
  is probably a gain; see open questions.
- **Magic shortbow, darts, thrownaxe:** each loses to rune knives (section 4).
- **Ranged 70 before MM** for a faster demon fight (178 against 267 ticks): no net
  gain, because the post-MM Defence phase earns that Ranged anyway (2,670 against 2,628).

## 6. Gotchas

- **The spiders are in level-37 Wilderness** (`wilderness_levels.rs2:4-13`: main
  Wilderness from z = 3520, one level per 8 tiles; z = 3810 is level 37). Any player
  within 37 combat levels can attack (`pvp_combat.rs2:32-38`), and the cannon
  makes noise. A death keeps the 3 most valuable items (4 with Protect Item) and drops
  the rest (`death.rs2:80-135`). A placed cannon stays on the spot, decays at 2,500
  ticks, and can then be reclaimed from Nulodion. Carry only what the stretch needs:
  balls, knives, food, potions. The fallback outside the Wilderness is the Battlefield
  of Khazard (2523,3239): 9.13 cannon alone and 8.88 + 3.37 Defence with melee, with
  almost no damage taken (2-8 hp per 400 ticks). That makes plan (e) about 20-25%
  slower (inferred).
- **Poison spiders hit and poison.** With Protect from Melee on, the account still took
  60-115 damage per 300-400 ticks (about 0.2-0.3 per tick, mostly poison). Protect from
  Melee drains 1 prayer point per 5 ticks with no prayer bonus (`prayers.enum` drain 12,
  `prayer.rs2:163-175`). The aggressive spiders retaliate against the cannon and walk to
  the player.
- **Wield the melee weapon for the cannon-only phase.** With knives in hand at low
  Ranged the cannon drops to 1.2/tick (measured).
- **Turn auto-retaliate off** for a pure cannon phase (`controls:com_3`,
  `player_controls.rs2:14-21`), or leave it on and take the free melee xp (5.4 Attack/tick
  measured with reactive melee). With defensive melee active, retarget on every kill.
- **Out of ammo stops the sweep** and needs a reload plus Fire; top up every ~20 ticks
  instead (one packet, delay-free).
- **Level-up dialogs:** Ranged gains about one level per 7 ticks in the first hundred
  ticks. Dismiss each dialog; the cannon keeps firing regardless.
- **Lab note:** `::setstat` resets that skill's xp, so the scripts sum per-tick deltas.
  Cannons left behind by a crashed run block the next set-up until `%ownedmcannon` is
  cleared (the script does `::setvar ownedmcannon -1`).

## 7. Helper supply list

For the with-MM plan (113 cannon ticks before MM, then plan (e): about 2,360 cannon
ticks, of which about 1,420 with knives). Counts are inferred from the measured
consumption.

| Item | Count | Where helpers get it |
|---|---|---|
| Dwarf multicannon set (base, stand, barrels, furnace) | 1 set | A helper who has done Dwarf Cannon buys it from Nulodion, 750,000 coins (`nulodion.rs2:68-80`) |
| Cannonballs | ~1,500 (0.51-0.67 used per tick) | Smithing 35 with the ammo mould (the helper needs the quest), or Nulodion's shop |
| Rune knives | ~700 (0.45 per tick; ~850 for a 1 -> 99 run without the Defence phase) | Fletching/Smithing or the GE |
| Rune scimitar | 1 | GE/shop |
| Food (sharks) | ~25 (about 0.2 hp per tick taken) | Fishing helper or GE |
| Prayer potions (4) | ~6 (about 470 prayer points at 1 per 5 ticks) | Herblore helper or GE |
| Ranged armour / Defence gear | optional | not needed by the cannon |

Cadence: everything fits in one trade (the parts take 4 slots until set-up; balls and
knives stack). That is one adjacent-helper trade (9 ticks, 5 with the rs/22 fix) or
about 56 stock, and no banking for the whole stretch. The knives (worn stack) and
balls need no restock below about 700 / 1,500.

## 8. Open questions

- **Cannon + knives between 40 and 70** was not measured. Measure at 50 and 60 to set
  the switch level (it would shorten the 1 -> 99 line by up to a few hundred ticks).
- **Melee at the spiders against the best melee site.** The no-MM "~1,040 ticks" for
  Ranged rests on rs/30's preliminary 8/tick (100 ms, moss giants); recompute with its
  300 ms number. Also check whether Strength (aggressive) at the spiders behaves like
  the defensive measurement.
- **Cannon placement:** the cannon fired on only 51-67% of ticks. A better tile in the
  spider field (more line of sight to the east and west clusters) could add a few xp
  per tick. `ranged-cannon-coverage.ts` on more tiles would settle it.
- **Wilderness risk on the public server** depends on who is playing; it is not
  measurable locally. The Khazard fallback costs about 20-25%.
- **Travel** to the spiders (about 320 tiles from Edgeville, ~160 ticks running) and the
  pre-MM trip are not timed; they depend on where the route stands when the cannon
  stretch starts.
- **Knife pick-up:** about half the thrown knives land under the target; picking them
  up costs ticks and was not tried.
