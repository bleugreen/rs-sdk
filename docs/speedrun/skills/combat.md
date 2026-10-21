# Melee combat: the shared measurement (Attack, Strength, Defence, Hitpoints)

Scripts: [`combat-rate.ts`](../scripts/combat-rate.ts) (one training sample on a real
target, logging the server tick of every hitsplat, xp drop, kill, retarget, eat and
drink), [`combat-model.ts`](../scripts/combat-model.ts) (rate model calibrated to the
samples, and the level integration behind every "ticks to 99" here),
[`combat-lab.sh`](../scripts/combat-lab.sh) (one-batch lab on the combat port block:
WEB 9200, management 9201, hiscores 9202, node 43900, gateway 8100). Lab setup and
labels: `docs/speedrun/LAB.md` and `docs/speedrun/skills/README.md` (rs/2). Every
headline number below was measured at `NODE_TICKRATE=300`; the rows marked 100 ms
are exploration runs.

**Host.** The 300 ms samples ran on the Mac executor `local`, which main measured at load
11-18 on 16 cores that night (cairn://p/rs/main, 00:36). Read every 300 ms rate here as a
**busy host's figure, a few percent pessimistic**: the bot reacts in wall-clock time, so a slow
host occasionally costs a tick on a re-attack or retarget. The quiet reference host is bbs;
rs/26's bbs correction factor had not been published when this was written (01:15), so no
factor is applied.

Per-skill documents: [attack.md](attack.md), [strength.md](strength.md),
[defence.md](defence.md), [hitpoints.md](hitpoints.md).

## Summary

**Melee trains at about 9 to 10 base xp per tick to the trained skill near 99, plus a
third of that to Hitpoints**: 8.99 Strength xp per tick at Strength 90-95, 10.08 at
95-99, and 9.2-9.3 Defence xp per tick at any Defence level (measured, 300 ms, ogres,
Attack 99, full potions and prayers). That is about two thirds of the 14.4 the quest
plan assumed. The gap has three causes, all read from source and confirmed by the logs:

- **There is no dragon scimitar in this revision.** No `dragon_scimitar` object exists
  in any `.obj` file, so Monkey Madness gives no weapon. The rune scimitar (4 ticks,
  +45 slash, +44 strength) does the most damage per tick of anything wieldable
  (section 3), including the dragon longsword, battleaxe and halberd.
- **Strength bonus is scarce.** Apart from weapons, only the amulet of strength (+10)
  is on the route. The climbing boots (+2) need Death Plateau and the Warrior helm
  (+3) needs The Fremennik Trials, both off rs/3's route. So the max hit at 99 with
  super strength and Ultimate Strength is 27-28, not 32.
- **Overkill and retargeting.** Damage is capped at the NPC's remaining hitpoints
  before xp is given (`player_melee.rs2:31-33`). Ogres have 60 HP, so a kill takes
  about 6 swings, and the last one is wasted on average. The retarget costs 0.7-2.7
  ticks per kill on top of the 4-tick swing (measured mean gap from the killing
  hitsplat to the next hitsplat: 4.7-6.7).

**On the route: rs/3's Package B** (`docs/speedrun/quests/README.md` and
`pre_mm_fights.md` on cairn://p/rs/3/1/coordinator; decided 01:08, README being finalised by
cairn://p/rs/80). Waterfall is off. Dragon Slayer is on after Monkey Madness option 1, with 15
QP of filler (Goblin Diplomacy, Romeo & Juliet, Cook's Assistant and Druidic Ritual; Druidic
Ritual replaced Witch's House at 01:20 as Herblore's mandatory unlock). Merlin's
Crystal and Holy Grail are off. The pre-MM fights (Khazard warlord, black demon, Fight Arena)
are **cast, not meleed**, so they give Magic and Hitpoints but no Strength or Defence
(`pre_mm_fights.md` section 1). The account reaches the cannon session and MM at Attack 99,
Strength 1, Defence 1, about 42 HP.

| Skill | Package B quest base xp (read, section 7) | Post-quest gap | Training ticks to 99 | Basis |
|---|---|---|---|---|
| Attack | TGV 11,450 + GT 18,400 + Fight Arena 12,175 = **42,025** before the cannon session (already 99), + MM 20,000 = **62,025** | 0 | **0** | read |
| Strength | MM 35,000 + Dragon Slayer 18,650 = **53,650** | 0 | **0** | read |
| Defence | MM 20,000 + Dragon Slayer 18,650 = **38,650** (level 98) | **1,288** | **230**, inside the cannon finish (cannon + defensive melee at 5.60 Defence per tick, `ranged.md` plan (e)); 140 on ogres alone at 9.18 (inferred), but that forgoes the cannon's 11 Ranged per tick | inferred from measured rates |
| Hitpoints | start 39.2 + the pre-MM fights' ~722 (warlord 226 m, demon 209 m, Fight Arena ~287 i, `pre_mm_fights.md`) + MM 35,000 = **~35,761** (level 97) | **4,177** | **0**: the cannon finish's own by-product, 5,089 HP (rs/31, `ranged.md` Package B row), covers it | read + measured; by-product inferred from measured rates. rs/3's README quotes a 4,938 gap because it counts MM alone. With Witch's House gone from the filler, no quest adds Hitpoints |
| Ranged | none from quests; ~54 after MM's Jungle Demon fight (1,790 base, `ranged.md` section 3) | 38,148 | **113** before MM (Ranged 1 -> 50) + **2,051** after (cannon + defensive melee 230, then cannon + rapid knives 1,821) | inferred from measured rates (`ranged-model.ts`, rs/31) |
| **Combat after the quests** | | | **2,051** after MM (+113 before it) | rs/3's own phase model gives 2,023; the 28-tick difference is the unmeasured Ranged 67-70 stretch, so 2,023-2,051 is the honest range |

So under Package B **no melee block remains at all**. The only melee is the 230 ticks of
defensive style that ride alongside the cannon at the Wilderness spiders, and the Defence gap
it closes is small enough that the cannon's Ranged, not Defence, sets the finish.

**Alternatives, not on the route** (kept for comparison; inferred, `combat-model.ts`). Package
A (Waterfall on, Dragon Slayer off), and no Monkey Madness at all:

| Skill | Package A, MM option 1: quest base xp | Gap | Melee ticks | No MM: quest base xp | Gap | Melee ticks |
|---|---|---|---|---|---|---|
| Attack | 75,775 (TGV 11,450 + GT 18,400 + Waterfall 13,750 + Fight Arena 12,175 + MM 20,000) | 0 | 0 | 44,325 (GT + Waterfall + Fight Arena) | 0 | 0 |
| Strength | 48,750 (MM 35,000 + Waterfall 13,750) | 0 | 0 | 13,750 (Waterfall; level 83) | 26,188 | **2,901** (yields 8,729 HP) |
| Defence | 20,000 (MM; level 89) | 19,938 | **2,121** (yields 6,646 HP) | 0 | 39,938 | **4,248** (yields 13,313 HP) |
| Hitpoints | 35,000 (MM) | 4,938 | **0**: the Defence training's 6,646 HP covers it | 39 (level 10) | 39,899 | 17,857 left after Strength and Defence: **5,683** more on melee alone (Attack style, its xp wasted), less with Ranged combat (below) |
| **Total melee** | | | **2,121** | | | **7,149 + up to 5,683 for HP** |

The alternative columns follow rs/3's route of 22:28 (Holy Grail, Merlin's Crystal and the
troll chain off; Tree Gnome Village only with MM; Waterfall on), and their melee figures assume
melee-trained pre-MM fights. Every reward was checked against the scripts (section 7).

Monkey Madness (4,400-5,300 ticks with failures, rs/3) replaces about 5,000 ticks of
Strength and Defence melee (7,149 - 2,121). It also removes the Hitpoints problem:
without MM, 17,857 HP has to come from some combat after Strength and Defence are
done. Ranged trained by combat earns 1.33 HP per damage as well
(`combat.rs2:155-167`), about 13,300 HP to Ranged 99. That leaves about 4,550 HP,
about 1,450 ticks of wasted-xp melee. **At the measured rate, MM wins by roughly
2,000-3,000 ticks with failures counted**, more if Ranged is not trained by combat.

**On any MM route, the remaining melee has a better place than ogres while Ranged is still
training.** Under Package B that is the 1,288 Defence above (230 ticks). Under Package A it
was the whole 19,938. rs/31 measured defensive melee alongside a
dwarf multicannon at the Wilderness poison spiders: 5.60 Defence + 1.85 HP + 11.03
Ranged per tick, which finishes Ranged, Defence and HP 99 in 3,520 ticks against
4,197 for ogres then Ranged. See `docs/speedrun/skills/ranged.md` section 1,
"Parallel against the best single-combat melee". Ogres are the place for melee
after Ranged is 99, and for the whole no-MM melee block.

## 1. Training target

Every attackable NPC with spawns was scored from its `.npc` config (hitpoints,
defence, slash defence, respawn), its map spawns and `maps/multiway.csv`, with the
exact hit and kill model (section 4). The leaders were then measured on the same
gear (Attack 99, Strength 90 -> 94, full boosts, 800-1,000 ticks each):

| Target | Where (spawns) | HP / def / slash def | Respawn | Measured Str xp per tick | Damage taken per 1,000 ticks | Verdict |
|---|---|---|---|---|---|---|
| **Ogre** | west of Yanille, 5 spawns at (2496-2503, 3089-3097) used; 9 within 10 tiles, 54 in the world (`area_yanille/configs/ogre.npc`) | 60 / 43 / 0 | 60 | **8.99 (300 ms)**, 8.99 (100 ms) | 32-93 | **Best reachable.** Single-combat. |
| Fire giant | Waterfall dungeon, 10 spawns at (2562-2581, 9886-9897) | 111 / 65 / 3 | 60 | 8.47 (300 ms), 8.71 (100 ms) | 150-164 | More HP per kill does not offset the lower hit chance (0.77 against 0.86), and it hits back 3-5 times harder. |
| Lesser demon | Karamja volcano, 6 spawns at (2831-2843, 9552-9565) | 79 / 71 / 0 | 60 | 8.12 (100 ms) | 90 | Accuracy 0.78. |
| Moss giant | Brimhaven, 5 spawns at (2691-2699, 3204-3216) | 60 / 30 / 0 | 60 | 7.91 (100 ms) | 24 | Size-2 giants wander into fences: 14 abandoned targets per 1,000 ticks. |
| Mountain troll, camp outside Troll Stronghold | 8 spawns at (2843-2856, 3673-3684) | 90 / 40 / 0 | 100 | 8.3-8.6 (100 ms) | 56-69 | **Unreachable off the troll chain.** The SDK pathfinder from Burthorpe stops at (2819, 3636), and the climbing rocks need the Death Plateau boots (`quest_death.rs2:159-177`). |
| Mountain troll, Death Plateau camp | 15 spawns at (2852-2876, 3584-3595) | 90 / 40 / 0 | 100 | died after 278 ticks | 313 in 278 ticks | Thrower Trolls (`aggressive_ranged`, huntrange 8, 95 HP) shell the camp. |
| Ice giant | (2880-2891, 9927-9965) | 70 / 40 / 3 | 60 | not measured | | The teleport tile found no reachable giant within 150 ticks; spawns are spread over 40 tiles anyway. |
| Canifis citizens | Canifis, 20 spawns | 60 / 10 / -21 | 50 | not measured | | Turn into 100-HP, defence-70 werewolves on the first hit unless Wolfbane is wielded (`canafis_citizen.rs2:19-26`); Wolfbane has +10 strength. |

At the ogres, Defence does not change the xp rate (it only changes damage taken), and
ogres barely hurt: an account with **Defence 1** took 60 HP in 800 ticks while
training Defence 1 -> 74 at 9.16 xp per tick (100 ms). Ogres are `cowardly`
(not aggressive, `huntmode=cowardly`), so nothing else interrupts the single-combat
"I'm already under attack" check (`player_combat.rs2:106-127`).

The cannon cannot run alongside at the ogres, because they are single-combat (no
`multiway.csv` zone). rs/31's best cannon site is the multi-combat Wilderness
spiders (see Summary).

## 2. Mechanics (read, then confirmed in the logs)

- **Hit roll:** `randominc(A) > randominc(D)` (`player_combat.rs2:52-68`).
  - Player A = (floor(Attack x prayer) + 8 + style) x (slash bonus + 64)
    (`player_combat_stat.rs2`, `combat.rs2:4-12`).
  - NPC D = (defence + 9) x (defence bonus + 64) (`npc_combat.rs2:325-334`).
- **Max hit:** floor((effective Strength x (strength bonus + 64) + 320) / 640)
  (`combat.rs2:7-8`). Effective Strength = floor(Strength x prayer) + 8 + style
  bonus: +3 aggressive, +1 controlled (`combat.rs2:51-61`).
- **Damage:** uniform 0..max, capped at the NPC's remaining hp; xp is given on the
  capped value (`player_melee.rs2:19-35`).
- **Xp per damage:** 4 base xp to the style's skill (accurate Attack, aggressive
  Strength, defensive Defence), or 1.33 to each of the three on controlled, plus
  1.33 to Hitpoints in every case (`combat.rs2:143-167`). The measured HP share
  is 0.331 of the trained skill in every sample.
- **Attack cadence:** `%action_delay = map_clock + attackrate`. The rune scimitar
  has no attackrate param, so it uses the default 4 (`player_melee.rs2:55-62`,
  `combat.param:76-78`). Measured: 85-93% of swing gaps are exactly 4 ticks.
- **Prayers** (`player_combat_stat.rs2`, `prayers.dbrow`):
  - Attack: Clarity of Thought 5% (Prayer 7), Improved Reflexes 10% (16),
    Incredible Reflexes 15% (34).
  - Strength: 5% (4), 10% (13), Ultimate Strength 15% (31).
  - No Piety or Chivalry. The level check uses `stat_base(prayer)`.
  - Drain: Ultimate Strength + Incredible Reflexes = 0.4 points per tick with no
    prayer bonus (`prayer.rs2:163-181`, `prayers.enum`).
- **Potions** (`consume_effects.dbrow`):
  - Super attack and super strength: +5 +15%; ordinary potions +3 +10%.
  - Prayer potion: +7 +25% of base Prayer.
  - **Drinking costs no attack time** (`consume.rs2:97-107`, no eat or skill delay).
  - **Food adds 3 ticks** to the attack clock (`consume.rs2:3,129-131`).
- **Every inventory click cancels the attack.** `OpHeldHandler.ts` calls
  `clearPendingAction()` on any OPHELD, so the bot must re-send the attack after
  each eat or drink.
  - An attack sent in the same tick as the item click does not land (the SDK
    serialises actions).
  - Re-attacking on each of the next two ticks keeps the 4-tick cadence (measured:
    drink gaps went from 10 ticks to 4).

## 3. Gear and prayers the scored account would have

Weapons ranked by damage per tick, proportional to (strength bonus + 54 + 64) /
attack rate with the amulet of strength, read from `skill_combat/configs/melee/*.obj`
and `levelrequire/scripts/tier60.rs2`:

| Weapon | Slash / Str | Rate | Gate | Relative damage per tick |
|---|---|---|---|---|
| **Rune scimitar** | 45 / 44 | 4 | Attack 40 | **1.00** |
| Dragon longsword | 69 / 71 | 5 | Lost City (off route) | 0.98 |
| Dragon dagger | 25 / 40 (stab 40) | 4 | Lost City | 0.97 |
| Rune claws | 38 / 39 | 4 | Attack 40 | 0.96 |
| Dragon battleaxe | 70 / 85 | 6 | Heroes' Quest (off route) | 0.90 |
| Dragon halberd | 95 / 89 | 7 | Regicide | 0.79 |
| Rune 2h sword | 69 / 70 | 7 | none | 0.75 |

- **Scenario (a), with MM:** there is no dragon scimitar, so the kit is the same as
  without MM.
- **Scenario (b), no MM:** rune scimitar.
- **Specials** add almost nothing. Energy regenerates 10% per 50 ticks
  (`combat.constant`). The only special on a route weapon would be the dragon
  battleaxe's Rampage (+10 strength boost, `specwep.rs2`), and that weapon is
  off route.

Kit used in every measurement: rune scimitar, amulet of strength, rune full helm, rune
chainbody (the platebody needs Dragon Slayer, `tier40.rs2:26`), rune platelegs, rune
kiteshield. Super attack and super strength are re-drunk at half of the fresh boost.
Ultimate Strength and Incredible Reflexes are on. The rs/3 route now gives Prayer
only from about 11 dragon bones: 72 base each (`bones.obj:82`), about Prayer 43,
enough for both prayers. A prayer potion then restores 17 points, so the two
prayers need one dose per about 42 ticks (inferred).

What each boost is worth at Strength 95 (inferred, model; one sample measured):

| Boosts | Str xp per tick | Defence xp per tick |
|---|---|---|
| Full (super attack + super strength + Ultimate Strength + Incredible Reflexes) | 9.25 | 9.40 |
| No potions | 8.12 | 8.12 |
| No prayers | 8.15 | 8.24 |
| Neither | 7.32 (measured 7.58 at 100 ms) | 7.32 |
| No amulet of strength | 8.56 | 8.65 |

Without prayers, the MM Defence gap takes 2,420 ticks instead of 2,121.

## 4. Rates per level (the curve)

Measured at 300 ms (`combat-rate.ts <bot> ogre ticks=1000 att=99 ...`, 1,000 ticks
each; the level rises during the sample):

| Trained | Levels during sample | Other stats | Base xp per tick | HP per tick | Swings | Kills | Mean damage per swing | Hit rate | Max hit seen | Mean ticks from kill to next hit | Damage taken | Food / prayer doses |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Strength | 40 -> 62 (600 ticks) | Att 40, Def 40 | 4.14 | 1.37 | 132 | 10 | 4.49 | 0.70 | 17 | 4.3 | 51 | 2 / 7 |
| Strength | 70 -> 82 | Att 99, Def 70 | 7.58 | 2.51 | 214 | 30 | 8.56 | 0.83 | 22 | 6.7 | 93 | 3 / 12 |
| Strength | 90 -> 95 | Att 99, Def 85 | **8.99** | 2.98 | 216 | 36 | 10.05 | 0.86 | 26 | 4.9 | 41 | 0 / 12 |
| Strength | 95 -> 99 | Att 99, Def 90 | **10.08** | 3.34 | 229 | 42 | 10.79 | 0.85 | 27 | 4.7 | 37 | 0 / 12 |
| Defence | 85 -> 91 | Att 99, Str 99 | **9.34** | 3.09 | 224 | 37 | 10.26 | 0.87 | 26 | 5.0 | 55 | 1 / 12 |
| Defence | 95 -> 98 | Att 99, Str 99 | **9.18** | 3.04 | 206 | 38 | 10.84 | 0.89 | 26 | 7.0 | 62 | 1 / 12 |
| Strength, fire giants | 90 -> 94 | Att 99, Def 85 | 8.47 | 2.81 | 223 | 17 | 9.26 | 0.77 | 26 | 5.7 | 150 | 6 / 12 |

The prayer doses in the measured runs are at Prayer 80, which needs fewer doses; the
supply lists use Prayer 43.

Styles at 70/70/70 and other 100 ms samples (600-800 ticks):

| Sample | Base xp per tick |
|---|---|
| Accurate (Attack) | 7.62 |
| Aggressive (Strength) | 7.51 |
| Controlled | 2.28 to each of Attack, Strength and Defence (6.83 total) |
| Defensive, Defence 1 -> 74 | 9.16 |
| Defensive, Defence 40 -> 76 | 9.42 |
| Aggressive, Strength 95 -> 97, no potions or prayers | 7.58 |

Controlled uses the scimitar's stab "lunge" (`combat.dbrow` `weapon_slash_table`),
where the rune scimitar has only +7. It loses about 9% overall and splits the xp
three ways, so it never pays when one of the three is already capped.

**Model** (`combat-model.ts`, inferred):

- It uses the exact hit chance, the exact expected swings per kill with damage
  capped at the remaining hp, and the potion boost averaged between fresh and half.
- That gives the zero-overhead rate. Measured / model over the five Attack-99
  samples is 0.921, 0.941, 1.009, 0.938 and 0.922; the planning rate is the model
  times **0.944**.
- Below level 60 the model is optimistic. The Strength 40 -> 62 sample (Attack 40)
  measured 0.81 of the model, so the 1-60 bands may be 15-20% low. They are a small
  share of any total.

Calibrated rate (base xp per tick to the trained skill):

| Level | Strength (aggressive, Att 99) | Attack (accurate, Str 99) | Defence (defensive, Att/Str 99) | All three at this level, aggressive |
|---|---|---|---|---|
| 40 | 4.84 | 8.13 | 9.40 | 4.12 |
| 60 | 6.48 | 8.81 | 9.40 | 6.03 |
| 70 | 7.30 | 9.02 | 9.40 | 6.97 |
| 80 | 8.11 | 9.20 | 9.40 | 7.90 |
| 85 | 8.47 | 9.26 | 9.40 | 8.32 |
| 90 | 8.89 | 9.33 | 9.40 | 8.80 |
| 95 | 9.25 | 9.39 | 9.40 | 9.21 |
| 99 | 9.54 | 9.43 | 9.40 | 9.54 |

**Ticks by band** (inferred, with the other two melee stats at 99):

| Skill | 1-40 | 40-70 | 70-85 | 85-93 | 93-99 | 1 -> 99 |
|---|---|---|---|---|---|---|
| Attack (Str 99) | 132 | 536 | 1,069 | 1,205 | 1,447 | **4,390** |
| Strength (Att 99) | 186 | 741 | 1,234 | 1,277 | 1,460 | **4,898** |
| Defence (Att/Str 99) | 67 | 500 | 1,042 | 1,194 | 1,446 | **4,248** |
| Hitpoints 10 -> 99 alone (Attack style on a capped Attack, 3.14 HP per tick) | | | | | | **about 12,700** |

## 5. Scenario table and sensitivity

The main table is in the Summary. Variants (inferred, `combat-model.ts`):

| Variant | Melee left | Ticks | HP left after it |
|---|---|---|---|
| **Package B (on route): MM option 1 + Dragon Slayer, Waterfall off** | Defence 1,288 | 140 on ogres alone; on the route it is the 230 cannon-alongside ticks instead (Summary) | 0 (quests, Witch's House) |
| MM option 1, Waterfall dropped | Strength 4,938 + Defence 19,938 | 522 + 2,121 = 2,643 | 0 |
| MM option 2 (Attack/Defence 35,000, Strength/HP 20,000) + Waterfall | Strength 6,188 + Defence 4,938 | 656 + 525 = 1,181 | 16,229 (about 13,300 of it covered if Ranged is trained by combat) |
| MM option 2, Waterfall dropped | Strength 19,938 + Defence 4,938 | 2,171 + 525 = 2,696 | 11,646 |
| No MM, Waterfall dropped | Strength 39,938 + Defence 39,938 | 4,898 + 4,248 = 9,146 | 13,312 |
| No MM + Dragon Slayer (18,650 Strength and Defence, `quest_dragon.rs2:33-34`) | Strength 7,538 + Defence 21,288 | 801 + 2,264 = 3,065 | about 25,000 before Ranged |
| No MM + Haunted Mine (22,000 Strength, `hauntedmine_crystals.rs2:54`) | Strength 4,188 + Defence 39,938 | 443 + 4,248 = 4,691 | about 20,000 before Ranged |
| Holy Grail back on (15,300 Defence) | Defence from 15,300 | 2,621 without MM | |

MM option 1 against option 2 is close: option 2 leaves about 1,180 ticks of melee
but about 16,200 HP. That is a wash if Ranged is trained by combat, and option 1 is
safer if Waterfall is dropped.

## 6. Helper supply list and cadence

Rates of use at Prayer 43 (inferred from the read drain and dose sizes; the potion
and food counts are measured):

| Item | Per 1,000 ticks | Source |
|---|---|---|
| Prayer potion (4) | 5.9 potions (23.5 doses) | Herblore (ranarr + snape grass) or GE |
| Super attack (4) | 0.5 (2 doses measured) | Herblore (irit + eye of newt) or GE |
| Super strength (4) | 0.5-0.75 (2-3 doses measured) | Herblore (kwuarm + limpwurt) or GE |
| Shark | 0-3 eaten at Defence 40+ (measured), 6 at fire giants | Fishing / Cooking or GE |
| Once | rune scimitar, amulet of strength, rune full helm, rune chainbody, rune platelegs, rune kiteshield | GE / Smithing / Crafting + Magic |

Per block:

| Block | Ticks | Prayer potions | Super attack | Super strength | Sharks | Inventories | Resupply trades |
|---|---|---|---|---|---|---|---|
| Package B (on route): Defence 98 -> 99 | 230, alongside the cannon | in `ranged.md` section 7 (the cannon finish's list) | | | | | |
| Package A: Defence 89 -> 99 (HP covered) | 2,121 | 12 | 2 | 2 | 4 | 1 (20 slots) | 0 |
| No MM: Strength 83 -> 99 + Defence 1 -> 99 | 7,149 | 42 | 4 | 5 | 12 | 3 | 2 |
| No MM: remaining HP on melee alone | 5,683 | 34 | 3 | 3 | 10 | 2-3 | 2 |

A trip of about 24 prayer potions lasts about 4,000 ticks. A resupply is one trade
from a helper standing at the ogres:

- 9 ticks for an adjacent helper, 5 with the rs/22 client fix.
- 56 ticks receiving a full 23-stack with the stock SDK.

So resupply is under 1% of any block. No banking: ogre drops are ignored.

**Interleaving** (`interleaving.md` section 8, the absorbable-fractions table): **none of the
combat training can be absorbed into self-only time.** Combat is itself the self-only activity
at a fixed site (the ogres, the Wilderness spiders), and every eat or drink already costs a
re-attack (section 2), so helper-fed inventory actions would compete with the attack loop.
Whether delay-free helper actions could ride the cannon + knives phase is unmeasured.

## 7. Quest xp (read)

| Quest | Reward (base) | Source |
|---|---|---|
| Monkey Madness option 1 | Strength 35,000, HP 35,000, Attack 20,000, Defence 20,000 | `mm_daero.rs2:295-298` |
| Monkey Madness option 2 | Attack 35,000, Defence 35,000, Strength 20,000, HP 20,000 | `mm_daero.rs2:304-307` |
| Waterfall (off route under Package B) | Attack 13,750, Strength 13,750 | `quest_waterfall.rs2:491-492` |
| The Grand Tree | Attack 18,400 | `quest_grandtree.rs2:200` |
| Fight Arena | Attack 12,175 | `quest_arena.rs2:270` |
| Tree Gnome Village | Attack 11,450 | `quest_tree.rs2:98` |
| Holy Grail (off route) | Defence 15,300 | `quest_grail.rs2:117` |
| Dragon Slayer (**on route**, Package B, after MM) | Strength 18,650, Defence 18,650 | `quest_dragon.rs2:33-34` |
| Goblin Diplomacy, Romeo & Juliet, Cook's Assistant, Druidic Ritual (Package B filler) | no combat xp | rs/3 `quest_points.md` |
| Witch's House (off route: replaced in the filler by Druidic Ritual) | Hitpoints 6,325 | `quest_ball.rs2:202` (via rs/3 `quest_points.md`) |
| Pre-MM fights by spell (not quest rewards) | Hitpoints ~722 in all (warlord 226 m, demon 209 m, Fight Arena ~287 i); no Attack, Strength or Defence | rs/3 `pre_mm_fights.md` section 1 |
| Haunted Mine | Strength 22,000 | `hauntedmine_crystals.rs2:54` |
| Death Plateau, Troll Romance (off route) | Attack 3,000; Strength 4,000 | `quest_death.rs2:221`, `quest_troll_love.rs2:304` |
| The Fremennik Trials (off route) | 2,812.4 each to Attack, Defence, Strength, HP | `quest_viking.rs2:135-138` |

## 8. Gotchas

- **Re-send the attack after every eat or drink**, on the next two ticks (section
  2). Without that, each prayer dose cost 4-6 ticks in the first runs.
- **Abandon a target that takes no hitsplat for 10 ticks.** NPCs that wander behind
  fences or rocks otherwise stall the loop for 60-90 ticks (seen at the moss giants
  and trolls before the fix). `combat-rate.ts` skips such a target for 50 ticks.
- **Level-up dialogs** were dismissed with `sendClickDialog(0)` as they appeared and
  cost nothing visible in the swing gaps.
- **Single-combat:** an NPC that attacked the player in the last 8 ticks blocks
  attacking another one (`player_combat.rs2:114-121`). Kills reset this
  (`npc_death.rs2` clears `%lastcombat`), and ogres don't aggro.
- **Quest gates on gear:** the rune platebody needs Dragon Slayer, the climbing
  boots Death Plateau, the Warrior helm The Fremennik Trials. The level checks use
  base levels (`levelrequire.rs2`).

## 9. Open questions

- **Monkey Madness at the route's real levels is unmeasured: Attack 99, Strength 1, Defence
  1, about 42 Hitpoints** (Prayer 43, Ranged 50, Magic ~76). Package B reaches MM with the
  pre-MM fights cast, so nothing has trained Strength or Defence. MM's hazards (the temple
  trapdoor guards, the jungle spiders that poison through prayer, the Ape Atoll dungeon
  traps) were measured at 70/70/70 with ~70 HP (`monkey_madness.md`), so its failure budget
  may be optimistic. The Jungle Demon itself is fought under Protect from Magic, where Defence
  does not matter. Open on rs/3's side (`pre_mm_fights.md` open questions; cairn://p/rs/80
  item (a)); not measured here. The likely mitigation is food and an antipoison in MM's trade.

- **Production latency.** The cadence assumes the re-attack lands within 2 ticks of
  a drink, and the retarget within 1-2 ticks of a kill. A short run on
  rs-sdk-demo.fly.dev with `combat-rate.ts` would confirm it.
- **Travel** to the ogres is not costed. They are about 40 tiles west of Yanille.
- **The 1-60 bands** are model-only below the one 40 -> 62 sample, and the model
  is 15-20% optimistic there.
- **A denser ogre spot.** Only the nearest 5 of 9 spawns were in reach of the
  standing tile. A tile central to all 9 might cut the 0.7-2.7 tick retarget cost
  per kill.

## Ranged

Ranged is owned by the Ranged sibling (cairn://p/rs/31) in [ranged.md](ranged.md).
The numbers below are cited from its section 1 ("Recommendation" and "Parallel
against the best single-combat melee"), measured at 300 ms there or inferred by
`ranged-model.ts`; they are not re-measured here.

- **Cannon + defensive melee at the Wilderness poison spiders** (multi-combat,
  rune scimitar wielded): 11.03 Ranged + 5.60 Defence + 1.85 HP base per tick
  (cited, ranged.md section 1, measured 300 ms).
- **On the route (Package B), Ranged/Defence/HP 99 take 2,051 ticks after MM** by
  rs/31's plan (e): cannon + defensive melee at the spiders for 230 ticks (Defence 1,288
  closed, Ranged to 67), then cannon + rapid rune knives for 1,821 (cited, inferred from
  measured rates; rs/3's phase model gives 2,023).
- **Package A (Waterfall on, Dragon Slayer off) took about 3,520 ticks** after MM by
  rs/31's plan (f): cannon + defensive melee at the spiders until Ranged 99, then
  melee alone at the ogres. Ogres for Defence and then cannon + knives for Ranged,
  trained separately, take 4,197 (cited, inferred). That separate plan prices the
  Defence gap at 2,155 ticks from a flat 9.25 per tick, where section 4 here
  integrates the level curve to 2,121.
- **The cannon is worth about 2,630 ticks** net of the Dwarf Cannon quest, to
  Ranged/Defence/HP 99 on the current route (cited, inferred).
- **Ranged 1 -> 50 before MM takes 113 ticks** of cannon fire (cited, inferred from
  the measured 11.52 per tick).
- **Longrange is a poor Defence top-up:** longrange rune knives give 2.63 Defence
  per tick (cited, measured 300 ms), against 9.25-9.40 for defensive melee at the
  ogres.

So on any MM route, the alternative table's "Defence 19,938 on ogres = 2,121 ticks" is
superseded by the cannon plan whenever Ranged is still training. The ogre figure
stands for melee done after Ranged is 99, and for the no-MM melee block.
