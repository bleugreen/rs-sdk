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

**Host.** The 300 ms batches ran on the Mac executor `local`, which main measured at load
11-18 on 16 cores that night (cairn://p/rs/main, 00:36). Read every 300 ms rate here as a
**busy host's figure, a few percent pessimistic**: the bot reacts in wall-clock time, so a
slow host occasionally costs a tick on a reload, retarget or knife throw. The cannon's own
sweep is a server timer and does not depend on the host. rs/26 closed without a single correction factor; `docs/speedrun/LAB.md` on main (its host-latency table) names bbs the reference host and reads the Mac's figures as pessimistic, so no factor is applied.

**Client.** Every number here was taken on the headless lite client against a local lab engine,
where a reaction lands on the next tick. The scored run drives the browser webclient against the
demo, where each reaction to observed state costs 1-2 more ticks through the SDK relay from home
and about 0.15 from Ashburn (rs/2; `docs/speedrun/LAB.md` on main, "Which client a number was
taken on" and the host-latency table under "Running several labs on one machine"). The reactions
in these loops: the cannon set-up is about 5 steps, each sent when the last is seen (once per
2,500-tick cannon life); the reload every ~20 ticks is one packet from beside the cannon; the
knives retarget once per kill; and each sip or eat is followed by one re-attack. rs/91's 4-tick
flick re-sends the attack blind, which is why it threw slightly more often than the held control
(0.44-0.45 knives per tick against 0.42, measured). The cannon's sweep and the 2-tick knife
clock are server timers. Totals are not re-derived for the webclient.

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

**On the route: rs/3's Package B** ([`docs/speedrun/quests/README.md`](../quests/README.md)
section 4, the canonical quest order). Monkey Madness option 1, then Dragon Slayer, whose 32-QP
door needs 11 QP of filler (Goblin Diplomacy, Romeo & Juliet, Cook's Assistant) plus Druidic
Ritual's 4 (README step 12); Waterfall, Merlin's Crystal and Holy Grail off. After the quests
Attack and Strength are capped, the Defence gap is **1,288** (MM 20,000 + Dragon Slayer 18,650)
and the Hitpoints gap **~4,220** (README section 6). Fire the cannon for **113 ticks before MM**
for Ranged 50 (the Jungle Demon's magic shortbow), wielding the rune scimitar at Attack 99.

After MM and Dragon Slayer, **run plan (e) with rs/91's kit** (rs/91, measured at 300 ms:
`docs/speedrun/research/helper-fed-and-combat.md` section 3 on cairn://p/rs/91/1/builder,
scripts `cannon-kit.ts` and `cannon-kit-model.ts`). The kit is super attack and super strength,
an amulet of glory, Protect from Melee + Ultimate Strength + Incredible Reflexes flicked every
4 ticks, one super antipoison dose per ~600 ticks and no food, plus a ranging potion once the
knives are out. **Cannon + defensive melee for 168 ticks** (13.66 Ranged + 7.65 Defence per
tick, measured) closes Defence. Then the cannon with the scimitar to Ranged 70 and **cannon +
rapid rune knives** to 99 (21.95 Ranged per tick at 85 against the control's 18.56, measured),
1,688 ticks. That is **1,857 ticks after MM for Ranged 99 + Defence 99 + Hitpoints 99**
(measured rates, inferred total), with about 5,440 HP as a by-product against the ~4,220 gap.

**Without the kit, plan (e) is 2,051-2,211**: 2,051 on rs/31's rates (230 + 1,821; Prayer 99,
survival by `::setstat`) and 2,211 on rs/91's own control (Prayer 43, real sips and food;
inferred total). The difference is mostly the control running 19.88 at Ranged 99 against
rs/31's 22.72. So the kit's gain is measured against its own control: about 354 ticks like for
like, about 194 against 2,051. README step 14 still quotes 2,023-2,051, the no-kit figure (rs/3's
phase model gives 2,023 on rs/31's rates). Without the kit the next best plans are (c) 2,120 and
(g) 2,180.

Alternatives, no longer on the route: **Package A** (Waterfall on, Dragon Slayer off; Defence
gap 19,938, HP 4,938) is plan (f), cannon + defensive melee until Ranged 99 (3,459) then
about 60 ticks of melee alone, **3,520** in all (HP by-product about 6,590). With neither
Waterfall nor Dragon Slayer it is 4,054. With Holy Grail back (Defence gap 4,638) the best
plan is (e) again, 828 + 1,420 = 2,248.

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
| Cannon + rapid knives, **rs/91 control** (Prayer 43, Protect from Melee held, prayer potions and sharks), Ranged 70 / 85 / 99 | 17.40 / 18.56 / 19.88 | 0 | 0 | 2.03 / 2.38 / 2.59 | rs/91, 400 ticks, 1 / 3 / 2 runs |
| **Cannon + rapid knives, rs/91 kit** (Protect from Melee flicked, ranging potion, glory, super antipoison, no food), Ranged 70 / 85 / 99 | **19.46 / 21.95 / 24.47** | 0 | 0 | 2.57 / 3.19 / 3.48 | rs/91, 400 ticks, 1 / 3 / 1 clean run (two more at 99 ran the cannon dry) |
| **Cannon + defensive melee, rs/91 scimitar kit** (supers, glory, three prayers flicked, super antipoison), Ranged 85 | **13.66** | **7.65** | 0 | 2.53 | rs/91, 400 ticks, 1 run; swings held the 4-tick ideal |
| Cannon alone, rs/91 scimitar kit | 13.64 | 0 | 0 | 0 | rs/91, 400 ticks, 1 run |
| **Rapid rune knives alone** (moss giants), Ranged 50 / 70 / 99 | **5.37 / 8.13 / 8.75** | 0 | 0 | 1.77 / 2.68 / 2.89 | 300 ticks each |
| Rapid rune darts alone, Ranged 70 | 8.00 | 0 | 0 | 2.65 | 300 ticks |
| **Longrange rune knives alone** (moss giants), Ranged/Defence 70 | **2.63** | **2.63** | 0 | 1.74 | 300 ticks |
| Cannon alone, Battlefield of Khazard (non-Wilderness fallback) | 9.13 | 0 | 0 | 0 | 400 ticks; 16.3 xp/ball (22 hp targets) |
| Cannon + defensive melee, Battlefield of Khazard | 8.88 | 3.37 | 0 | 1.12 | 400 ticks |
| **Cannon + rapid magic shortbow, rune arrows** (rs/124), Ranged 70 / 85 / 99 | **15.77 / 19.02 / 20.43** | 0 | 0 | 2.10 / 2.07 / 2.28 | 300 ticks each, 1 run each, bbs at 300 ms; cannon's share 9.47 / 12.80 / 13.58 |
| Cannon + rapid rune knives, same session as the bow (rs/124 control) | 15.67 / 18.29 / 19.45 | 0 | 0 | 2.09 / 2.31 / 2.62 | 300 ticks each, 1 run each; cannon's share 9.40 / 11.34 / 11.58; 0.42-0.46 knives per tick |

**The magic shortbow with rune arrows matches rune knives beside the cannon** (rs/124,
measured, same host and session, `ranged-cannon.ts --mode=hand --style=1 --hold=1`):
+0.6% at Ranged 70, +4% at 85 and +5% at 99. The bow's own hits earn less than the knives'
(it fires every 3 ticks on rapid, the default attackrate 4 minus 1, against the knives' 2),
but the cannon rolls with the wielded weapon's style and bonus (section 4), and the bow's
+69 ranged attack against the knife's lower bonus lifts the cannon's share by 1.4-2.0 per
tick from 85. Arrows used were not counted by the script; at one shot per 3 ticks and the
knives' measured 87% of their ideal cadence, about 0.29-0.33 per tick (inferred), so ~490-560
for the 1,688-tick phase from 70. This session's knife control read lower than the rows
above (17.34 / 18.69 / 22.72, another host and day), so compare the two rs/124 rows with
each other, not with those. Rune arrows come from Dargaud's in the Ranging Guild at ~405 gp
(`docs/speedrun/helpers/rune-arrows.md`); no shop sells knives and the Grand Exchange has no
sellers.

What this means for the plan (inferred, `ranged-model.ts`).
Separate melee in these plans is rs/30's best single-combat target, the ogres west
of Yanille (300 ms, `combat-rate.ts`): 9.25 Defence on defensive (8.99-10.08 Strength
on aggressive), HP a third of that. Aggressive melee at the spiders is assumed to
run at the measured defensive rate (5.60).

| Scenario | Plan | Ticks |
|---|---|---|
| Ranged 1 -> 50 before MM | cannon, melee weapon wielded | **113** firing + ~10 set-up and pick-up + travel (README step 7); about 96 with super attack, glory and Incredible Reflexes flicked (inferred: 113 x 11.52 / 13.64, rs/91's kit cannon-only rate; unmeasured at Strength 1, Defence 1); knives only: 628 |
| **Package B (current route) with rs/91's kit, recommended**: from Ranged ~54, Defence gap 1,288, HP gap ~4,220 (README section 6) | **(e) with the kit: cannon + defensive melee (168), then the cannon, knives from 70 (1,688)** | **1,857** (rs/91, `cannon-kit-model.ts`) |
| Package B without the kit: MM option 1 + Dragon Slayer (18,650 Str + 18,650 Def), Waterfall off | **(e) cannon + defensive melee (230), then cannon + rapid knives (1,821)**; (c) 2,120; (g) 2,180 | **2,051** on rs/31's rates; 2,211 on rs/91's control |
| Package A (superseded): MM option 1, Waterfall on, Holy Grail off: from Ranged ~54 (50 + ~485 from the demon fight), Defence gap 19,938, HP gap 4,938 | **(f) cannon + defensive melee at the spiders until Ranged 99 (3,459), then melee alone at the ogres (62)** | **3,520** |
| | (d) cannon + defensive melee at the spiders throughout | 3,560 |
| | (g) melee alone at the ogres for Defence (2,155), then cannon + knives for Ranged (2,041) | 4,197 |
| | (a) cannon alone for Ranged, then melee alone | 5,467 |
| | (c) cannon + longrange until Defence 99, then cannon + rapid knives | 9,104 |
| | (b) hand only: longrange until Defence 99, then rapid knives | 9,685 |
| Same, Waterfall off as well (Strength gap 4,938 too) | (f) / (g) | **4,054** / 4,730 |
| With MM option 1 and Holy Grail: Defence gap 4,638, HP gap 4,938 | **(e) cannon + defensive melee until Defence 99 (828), then cannon + rapid knives (1,420)**; (g) 2,543; (c) 2,722; (b) 5,689 | **2,248** |
| Same, plus Fremennik Trials (gaps Defence 1,826, HP 2,126) | (e) | 2,057 (**Fremennik saves 191 ticks** of combat training) |
| Ranged only from ~54 (no gaps) | cannon + rapid knives | 2,041 |
| Pre-MM Ranged 70 instead of 50 (demon fight 178 instead of 267 ticks), Package A | 463 + 178 + 3,376 | 4,017, against 3,900 for Ranged 50 first: no gain |
| **Net value of the cannon** (Package A, to Ranged/Def/HP 99; on Package B the cannon still carries every Ranged tick of the finish) | with: 113 + 267 + 3,520 + Dwarf Cannon 1,078 = 4,978; without: knives 628 + 267 + ogres 2,155 + knives 4,557 = 7,607 | **saves about 2,630 ticks** |

**Parallel against the best single-combat melee:** at the spiders the cannon adds
11.03 Ranged per tick while defensive melee drops from rs/30's 9.25 at the ogres to
5.60. On Package A that trade was worth about 680 ticks ((f) 3,520 against (g)
4,197), and on Package B (e) 2,051 beats (g) 2,180 by about 130, so the spiders win while
Ranged is below 99. Once Ranged is 99 the cannon's xp
is wasted, and the ogres are the place to finish melee.

**No-MM scenario** (Strength gap 26,188, Defence 24,638, most of Hitpoints):
longrange closes Defence at 2.63/tick (about 9,370 ticks), far behind melee
(about 2,660 at rs/30's 9.25/tick at the ogres). Defence should be meleed. The
cheapest Ranged there is the cannon *in parallel* with that melee. At the spiders
defensive melee runs at 5.60/tick with the cannon against 9.25 at the ogres, so
Ranged 99 (about 3,620 ticks of cannon at 11.03 from level 1) costs about 3,620 x
(9.25 - 5.6) / 9.25 = **~1,430 ticks of melee time** (inferred), against 2,196 for a
dedicated cannon + knives route. The melee rate at the spiders without the
cannon is 6.64, so most of that penalty is the site (spiders have 52 defence), not
the cannon.

### Summary row

rs/2's columns for the Item-fed skills section of `docs/speedrun/skills/README.md`; column 5
is "with interleaving (net)", n/a where nothing is absorbable. This is **one combined row for
the finish**: its ticks also close Defence (168, defence.md) and Hitpoints (hitpoints.md),
whose rows point here and are not additive.

| Skill | Headline method | Start level (on-route quests) | Ticks to 99, normal | Ticks to 99, with interleaving (net) | Basis | Helper supplies | Document |
|---|---|---|---|---|---|---|---|
| Ranged (with Defence and Hitpoints 99) | dwarf multicannon at the Wilderness poison spiders, rune scimitar wielded, to Ranged 50 before MM; after MM rs/91's kit: cannon + defensive melee, then the cannon with rapid rune knives from 70 | 1; 50 after the pre-MM cannon session, ~54 after MM's Jungle Demon (no Ranged quests; [quests README](../quests/README.md) section 4, steps 7 and 14) | **1,970** = 113 + 1,857 (2,164-2,324 without the kit) | n/a | measured rates (rs/31, rs/91), inferred totals; busy host | cannon set (Nulodion, 750,000, from a helper with Dwarf Cannon), ~1,000-1,300 cannonballs, up to ~760 rune knives, rune scimitar, ~9 ranging doses, ~3 super antipoison, 1 dose each of super attack and super strength, glory, 1 antipoison(4) for the pre-MM session | ranged.md |

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

No quest on the planned route awards Ranged. The route is rs/3's Package B
([`README.md`](../quests/README.md) section 4): Doric's,
Plague City, Tree Gnome Village, The Grand Tree, Fight Arena, Dwarf Cannon, Monkey Madness
option 1, Mage Arena, Dragon Slayer with its filler (Goblin Diplomacy, Romeo & Juliet, Cook's
Assistant) and Druidic Ritual, Sea Slug if rs/54 unblocks it (Sheep Shearer otherwise), and
Fishing Contest. The pre-MM fights are cast, not
shot (rs/3 `pre_mm_fights.md`), so the on-route start is level 1, then 50 from the cannon
session and about 54 after the Jungle Demon. The Ranged rewards in the content are all off route (read):

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
- **Interleaving** (`interleaving.md` section 8, the absorbable-fractions table): **none of
  Ranged can be absorbed into self-only time.** The cannon needs a multi-combat site (the
  Wilderness spiders) and the account standing at it; the training is itself the self-only
  activity there, so column 5 of the summary row is n/a. The packet budget is the other
  limit (rs/91, measured): the three-prayer melee flick sends exactly 5 user events on 100 of
  its 400 ticks, the cap, so the defensive-melee phase has no room at all. The knives phase
  peaks at 3 per tick, which leaves 2. But every inventory use there competes with the attack
  loop (each consume ends in `p_delay(1)` and pauses the cannon, `consume_effects.rs2:123-126`,
  read), and the account stands in level-37 Wilderness with the kit in its slots. Whether
  delay-free helper actions (arrowheads, gem cutting) could ride the knives' spare ticks
  without costing throws is unmeasured.

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
  the player. **rs/91's kit removes both costs** (measured): one super antipoison dose kept
  damage at 0 for 400 ticks in 9 of 9 runs, and flicking every prayer off and on at least
  every 4 ticks left the points unchanged in every flicked run (the drain timer clears when
  the last prayer goes off, `prayer.rs2:30-44, 159-175`, read).
- **With the kit, top up the cannon only while standing beside it** (rs/91, measured). Under
  a flick schedule the re-attack cancels the walk back to the cannon, and the cannon runs dry:
  it happened in two of rs/91's three kit runs at Ranged 99 (6 "out of ammo" messages in one).
  Load from beside it, or hold the re-attack until "You load the cannon" appears.
- **Send each potion sip in the flick tick, after the prayer toggles** (rs/91, measured). A
  sip ends in `p_delay(1)`, and prayer buttons are dropped on the next two ticks; a sip on the
  tick before a flick left the boost prayers half-toggled and the drain fired. In the flick
  tick, the two blocked ticks fall on the free ticks of the 4-tick cycle. Every sip also pauses
  the cannon for about 2 ticks (read, `cannon_fire.rs2:91`, rs/59).
- **The pre-MM session happens at Defence 1 and about 42 HP** on the route (the pre-MM
  fights are cast). rs/56 measured it at those levels (rs/3 `pre_mm_fights.md`, 300 ms):
  151-166 ticks for Ranged 1 -> 54-57 at 12-14 base per tick, 0 melee damage under Protect
  from Melee, but 24-30 of 42 HP lost to poison per session (lowest HP 8-19). One
  Antipoison(4) removed the damage entirely. Carry it.
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

For the on-route plan (Package B: 113 cannon ticks before MM, then plan (e)). With rs/91's kit
that is 168 ticks of cannon + defensive melee and 1,688 of cannon, knives from Ranged 70, about
1,970 cannon ticks in all. Without it, 230 + 1,821, about 2,160. Package A's plan (f) needed
about 3,570 cannon ticks and no knives. Counts are inferred from the measured consumption
(rs/91's kit list is its own inference from its measured sip and dose rates).

| Item | Package B with rs/91's kit (recommended) | Package B without the kit |
|---|---|---|
| Cannonballs | ~1,000-1,300 (0.51-0.67 per tick over ~1,970 ticks) | ~1,100-1,450 (over ~2,160) |
| Rune knives | up to ~760 (0.45 per tick over at most 1,688 ticks) | ~820 (0.45 per tick over 1,821) |
| Ranging potion doses | ~9 (one at Ranged 70, then one per ~210 ticks) | 0 |
| Super antipoison doses | ~3 (one per ~600 ticks) | 0 |
| Super attack, super strength | 1 dose each (the 168-tick melee phase) | 0 |
| Amulet of glory | 1 | 0 |
| Sharks | 0 | ~25 (0.2-0.3 hp per tick) |
| Prayer potions (4) | 0 (flicked) | ~6 (Protect from Melee, 1 point per 5 ticks) |
| Antipoison (4) | 1 for the pre-MM session (rs/56, above) | same |

The table below keeps rs/31's original per-plan counts for reference.

| Item | Count | Where helpers get it |
|---|---|---|
| Dwarf multicannon set (base, stand, barrels, furnace) | 1 set | A helper who has done Dwarf Cannon buys it from Nulodion, 750,000 coins (`nulodion.rs2:68-80`) |
| Cannonballs | ~2,300 for plan (f), ~1,500 for plan (e) (0.51-0.67 used per tick) | Smithing 35 with the ammo mould (the helper needs the quest), or Nulodion's shop |
| Rune knives | none for plan (f); ~700 for plan (e) (0.45 per tick); ~850 for a plain 1 -> 99 | Fletching/Smithing or the GE |
| Rune scimitar | 1 | GE/shop |
| Food (sharks) | ~45 for plan (f), ~25 for plan (e) (about 0.2-0.3 hp per tick taken) | Fishing helper or GE |
| Prayer potions (4) | ~9 for plan (f), ~6 for plan (e) (1 prayer point per 5 ticks) | Herblore helper or GE |
| Ranged armour / Defence gear | optional | not needed by the cannon |

Cadence: everything fits in one trade (the parts take 4 slots until set-up; balls and
knives stack). That is one adjacent-helper trade (9 ticks, 5 with the rs/22 fix) or
about 56 stock. Plan (f)'s 45 sharks and 9 potions do not fit beside the parts, so
expect one more trade mid-stretch, delivered at the spider site.

## 8. Open questions

- **The kit at Ranged 99 rests on one clean run** (24.47 per tick, rs/91); the other two ran
  the cannon dry and only their knife figures were kept. A repeat with the top-up fix (section
  6) would settle the last ~400 ticks of the 1,857.
- **rs/91's control ran below rs/31 at 99** (19.88 over two runs against 22.72 from one). The
  kit's gain is measured against its own control, so 1,857 stands; what the no-kit baseline
  really is (2,051 or 2,211) matters only if the kit is not carried.
- **The kit before MM** (super attack, glory, Incredible Reflexes and Protect from Melee
  flicked for the cannon session at Strength 1, Defence 1, ~42 HP) is unmeasured: the ~96
  ticks in section 1 is scaled from the post-MM cannon-only rate. The cannon's damage is fixed
  at 0-30, so super strength and Ultimate Strength add nothing there.
- **There are no ranged prayers in this revision** (15 prayers, `skill_prayer/scripts/prayers/`,
  read; rs/59). In the knives phase flicking therefore saves only Protect from Melee's budget;
  the boost to the cannon there comes from the ranging potion and glory.

- **Cannon + knives between 40 and 70** was not measured. Measure at 50 and 60 to set
  the switch level (it would shorten the 1 -> 99 line by up to a few hundred ticks).
- **Aggressive melee at the spiders** was not measured. The Strength-gap variants
  assume it runs at the measured defensive rate (5.60 with the cannon); the gear here
  was a bare rune scimitar, not rs/30's full set with potions and prayers, so the
  spider melee rates are probably low.
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
