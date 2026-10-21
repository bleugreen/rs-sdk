# External research: combat and the helper-fed skills, mapped to the 2004 revision

Issue: cairn://p/rs/77 (child of rs/59). This page checks what the efficiency and speedrunning
communities (the OSRS Wiki, the 2004scape / LostCity forum, 2004-2007 fan-site guides) know about
training combat and the helper-fed skills, against this server's scripts, and values each
technique in ticks on our route. Sibling pages: `competitors.md` (rs/60) and `engine-sweep.md`
(rs/61).

Labels: **m** measured, **r** read from source, **i** inferred (arithmetic on m and r figures).
All xp is base xp (game xp / 25). Route figures come from the rs/28 skill documents
(`docs/speedrun/skills/*.md` on `agent/rs-28-coordinator-0`) and the rs/3 quest README
(`docs/speedrun/quests/README.md` on `agent/rs-3-coordinator-0`, sections 4, 6 and 7).

**Status: ranked draft, 2026-10-21; rows 1-4 measured by rs/91 (section 3).** Zero-drain prayer
flicking (row 2) was measured on the local engine at 300 ms, first alone (section 2) and then in
combat with potions (section 3), together with the ranging potion, glory and super antipoison
(rows 3 and 4) on Package B's cannon + rapid knives phase and the full melee kit (row 1) on its
cannon + defensive melee phase. Rows 5-8 are inferred from read mechanics and measured rates.

## Summary

The community's per-action methods for Runecraft, Smithing, Firemaking, Prayer, Magic and the
delay-free skills are either absent from a May-2004 revision (pouches, the Abyss, the Blast
Furnace, gilded altars, the Ectofuntus, Lunar spells) or no faster than what the route already
does. In those skills the engine's own delays set the floor, and our route already sits on it.
The OSRS action-length table agrees tick for tick: 4 ticks per log, 5 per anvil item, 2 per bone
buried.

The value is in the **combat finish**, the largest helper-fed line (about 3,520 ticks on
Package A). rs/31 measured the cannon-plus-defensive-melee rates with a bare rune scimitar, no
potions, no offensive prayers and Prayer 99 (`ranged.md` sections 1 and 8). Three standard
efficiency practices apply on top, and the scripts allow all three:

1. **The cannon's accuracy is the player's boosted melee accuracy** (OSRS Wiki, *Dwarf
   multicannon*, Accuracy; here `cannon_fire.rs2:116` calls `~player_npc_hit_roll`, which reads
   the prayer- and potion-boosted `%com_*attack`). A super attack, Incredible Reflexes and an
   amulet of glory raise the cannon's hit chance on poison spiders from about 0.79 to 0.86 (i).
   Super strength and Ultimate Strength raise the defensive melee's max hit from 18 to 25 (i).
2. **Prayer flicking costs zero prayer points here.** The drain is a 5-tick timer that starts when
   a prayer is switched on from all-off and is cleared when the last prayer goes off
   (`prayer.rs2:30-34, 39-44, 159-175`). Switching all prayers off and on again at least every 4
   ticks means the timer never fires (r). Measured at 300 ms: holding Protect from Melee,
   Ultimate Strength and Incredible Reflexes for 150 ticks used 90 points; flicking all three
   every 4 ticks used 0 (m, `prayer-flick.ts`). This makes the boost prayers free, and removes about 38
   prayer-potion sips that the 3,520 figure leaves out (it was measured at Prayer 99; the route
   has Prayer 43).
3. **Super antipoison instead of sharks.** Most of the damage taken at the spiders is poison
   (`ranged.md` section 6). One super antipoison dose gives about 600 ticks of immunity
   (`anti_poison.rs2:15`, `poison.rs2:20-30, 72-75`), which replaces the route's ~45 sharks.

Together these cut the Package A finish from about 3,520 to about **2,940-3,030 ticks (i)**, a
saving of roughly **500-580 ticks**, plus about 70 from the antipoison. On Package B a ranging
potion and glory in the 1,792-tick cannon-plus-knives phase add about **210-240 (i)**. The
boosted rates are untested; lab brief A below is the test.

**Measured (rs/91, section 3), on Package B, which rs/3 chose on 2026-10-21 (Package A is
retired):** flicking Protect from Melee, a ranging potion, glory and one super antipoison dose
raise cannon + rapid knives from 18.6 to 22.0 Ranged per tick at Ranged 85 (m, +18%, 3 runs each,
no overlap), with 0 prayer points, 0 food and never more than 3 packets in a tick. The melee kit
raises cannon + defensive melee from rs/31's 11.0 + 5.6 to 13.7 Ranged + 7.7 Defence per tick (m).
The Package B finish drops from **2,211 ticks with the same lab's control to about 1,857 (i), a
saving of about 350**; against the route's current 2,051 (rs/31's figures, measured at Prayer 99
with survival by cheat) the saving is about 190 (i). Wielding a rune scimitar for the whole finish
loses: about 2,790 ticks even with the kit (i).

A side finding the coordinator should know: **every potion sip pauses the cannon.** All potions
end in `p_delay(1)` (`consume_effects.rs2:123-126`, `consume_messages.dbrow`), and the cannon's
rotation is a normal timer, which only runs while the player is not busy
(`cannon_fire.rs2:91`, `Player.ts` `processTimers` and `busy()`). So each sip costs about 2
cannon ticks as well as the melee re-attack (i). This is one more reason to flick rather than
sip.

## Ranked table

Sorted by ticks saved on the route line named. "Package A" and "Package B" are rs/3's
combat-finish packages (README section 7).

| # | Technique | Source | Present in revision | Route line affected | Ticks saved (label) | Cost | Test status |
|---|---|---|---|---|---|---|---|
| 1 | Full efficiency kit at the spider cannon site: super attack + super strength, amulet of glory, Ultimate Strength + Incredible Reflexes (kept up by flicking, row 2) | OSRS Wiki *Dwarf multicannon* (Accuracy) and *Pay-to-play Ranged training*; LostCity forum t/3058 ("boosts & prot if you align attack with a 4t monster") | **yes**: `cannon_fire.rs2:116` -> `player_combat.rs2:52-68` reads `%com_slashattack`, built by `player_combat_stat.rs2` with the prayer multipliers; prayers `prayers/ultimatestrength.rs2`, `incrediblereflexes.rs2` (levels 31 and 34, under the route's Prayer 43) | Package A finish, ~3,520 | **~500-580 (i)**, arithmetic in section 1 | 2 super attack + 2 super strength doses per ~1,000 ticks (`combat.md` section 6); 1 glory; packet schedule for flicks | **measured** on Package B's melee phase (section 3, config 5): 13.66 Ranged + 7.65 Defence per tick against rs/31's 11.03 + 5.60, a full 4-tick swing cadence with 5 packets on the flick tick; Defence phase 230 -> 168 ticks (i) |
| 2 | Zero-drain prayer flicking (all prayers off and on within one or two ticks, at least every 4 ticks) | microgrind.io *Prayer flicking explained tick by tick*; OSRS Wiki *Prayer points*; LostCity forum t/3058, t/3391 | **yes**, by reading: drain only runs from `[timer,prayer_drain]`, set for 5 ticks when a prayer goes on from all-off and cleared when the last goes off (`prayer.rs2:30-34, 39-44, 159-175`). Each toggle runs `p_clearpendingaction` (`prayers/*.rs2`), the LostCity March 2025 change, so the attack must be re-sent | Package A finish (the ~38 sips the 3,520 omits); Package B (~21 sips); Mage Arena (1-2 sips) | **~75 (i)** on A, ~40 on B; it is also what makes row 1 affordable: without it the three prayers drain 0.6 points per tick, ~106 doses and ~210 ticks of sip stalls over the finish (i) | 4-6 extra IF_BUTTON packets per 4 ticks plus a re-attack; no prayer potions at all | **measured** (300 ms, 150 ticks per mode): hold 90 points, flick 0-1 (section 2); in combat with sips, 0 points in all 15 flicked 400-tick runs, and the re-attack it needs *raises* the knife cadence (0.44 throws per tick against 0.42 held); sips must go out in the last flick tick (section 3) |
| 3 | Ranging potion + amulet of glory in the cannon + rapid knives phase | OSRS Wiki *Dwarf multicannon* (ranged weapons use the ranged roll, "can be boosted") | **yes**: ranging potion +4 +10% (`consume_effects.dbrow:57-63`); glory +10 ranged attack (`enchanted_jewelry.obj`); cannon uses `%com_rangeattack` with knives wielded (`player_combat.rs2:76`). No ranged prayers exist in this revision (15 prayers, `skill_prayer/scripts/prayers/`) | Package B finish (1,792 ticks of cannon + knives); Package A's boosted tail (~230-360 ticks) | **~210-240 (i)** on B; ~30-45 on A | ~1 ranging potion dose per ~1,000 ticks (it decays 1 level per 100 ticks, re-sip at half), 1 glory | **measured** with row 4 (section 3): configs 3 and 4 against 2 at Ranged 85, knives' share +11% and +24%, cannon xp per ball +8% (pooled); ~1 dose per ~210 ticks |
| 4 | Super antipoison schedule instead of ~45 sharks at the spiders | standard practice; the 2004scape forum's cannon thread lists constant poisoning as the cost of poisonous sites (t/14198) | **yes**: super antipoison sets `%poison` to -20, and the 30-tick poison timer counts it up by 1, so ~600 ticks of immunity (`anti_poison.rs2:11-16`, `poison.rs2:12-30, 72-75`); spiders still poison through Protect from Melee because poison is applied on the accuracy roll (`npc_combat_melee.rs2:24-30`) | Package A finish; Package B | **~70 (i)** on A (45 sharks x 3 melee ticks of attack delay, `consume.rs2:3,129-131`, less ~6 doses x 2 stall ticks); ~40 on B | ~6 super antipoison doses per 3,500 ticks (Herblore helper or GE) | **measured** (section 3): 0 damage taken in all 9 runs with one dose (400 ticks each), against 6-78 damage and up to 5 sharks per 400 ticks without |
| 5 | Cannon from a safespot in a single-combat area | OSRS Wiki *Dwarf multicannon* ("the cannon fires at multiple monsters ... as long as the player is never attacked") | **yes**: `~player_in_combat_check` blocks a target only if an NPC attacked the player in the last 8 ticks (`player_combat.rs2:106-122`); `%lastcombat` is set only when an NPC swings at the player (`npc_combat.rs2:377-380`) | Package B cannon + knives phase; the pre-MM cannon session (113 ticks) | **0 to ~150 (i)**, uncertain; the main value is moving the Ranged block out of level-37 Wilderness | a safespot tile within cannon range; knives still need line of sight | untested: lab brief C |
| 6 | Better cannon tile, luring targets into the overlapping squares | OSRS Wiki *Dwarf multicannon* (target regions overlap; "lure them into a multi-hit spot") | yes: 8 directions, one search per tick, three squares each (`cannon_fire.rs2:10-91`) | Package A finish | **up to ~240 (i)** after row 1, for +2 cannon xp per tick; after row 1 Defence binds, so cannon gains are worth less | lab time only | open question already in `ranged.md` section 8 |
| 7 | Most accurate weapon for cannon-only phases: rune 2h sword (slash +69) + glory + Incredible Reflexes + super attack | OSRS Wiki *Dwarf multicannon* (Accuracy) | yes: `2hswords.obj` slash +69; cannon accuracy only, the 2h's 7-tick speed is irrelevant when not meleeing | Pre-MM cannon session, Ranged 1 -> 50 (113 m-based ticks) | **~10 (i)**: hit chance 0.79 -> 0.88 | 1 rune 2h sword, 1 super attack sip | not worth a test |
| 8 | Battlestaff orb attaching as the Crafting fallback when dragonstones are scarce | OSRS Wiki *Game tick/Action lengths* (2 ticks per staff in OSRS) | yes, and **delay-free here**: `battlestaves.rs2:15-37` has no delay; air battlestaff 137.5 base at level 66 (`battlestaves.struct:13-17`), the same as a dragonstone | Crafting (rs/37) | **0** ticks; a supply alternative. It needs 2 slots per action (staff + orb) against 1 for a gem, so more top-ups | battlestaves: Zaff and the Magic Guild stock 5 each (`varrock.inv:150`, `magic_guild.inv:22`); orbs from a helper's Charge Orb | none needed |

## 1. Arithmetic for the combat rows

### Hit chances (r formula, i values)

The roll is `randominc(A) > randominc(D)` (`player_combat.rs2:65`), so for A > D the hit chance
is about 1 - (D + 2) / (2(A + 1)). A = (effective level + 8) x (attack bonus + 64), and the NPC's
D = (defence + 9) x (defence bonus + 64) (`combat.md` section 2).

Poison spider (`_unpack/225/all.npc:3476-3506`, r): defence 52, stab 20, slash 17, crush 10,
ranged 14, 64 hitpoints. So D is 4,941 against slash and 4,758 against ranged.

| Setup (Attack 99, defensive style) | Effective attack | Slash bonus | A | Hit chance (i) |
|---|---|---|---|---|
| rs/31's measurement: bare rune scimitar | 99 | +45 | 11,663 | 0.788 (the measured 22.5 xp per ball implies 0.75) |
| + super attack (+5 +15%) and Incredible Reflexes (x1.15) | 135 | +45 | 15,587 | 0.841 |
| + amulet of glory (+10 slash) | 135 | +55 | 17,017 | **0.855** |
| Cannon-only phase: rune 2h sword + glory + the same boosts | 135 | +79 | 20,449 | 0.879 |

The cannon's xp per ball scales with the hit chance, because its damage is 0-30 whatever the
levels (`cannon_fire.rs2:117`). So the kit multiplies the cannon's Ranged rate by 0.855 / 0.788 =
1.085 (i). The measured flick schedule leaves Incredible Reflexes off on one tick in four
(section 2), when the hit chance is glory-only (0.806), so the average is about 0.843 and the
factor **1.07 (i)**: 11.03 becomes about 11.8 per tick.

Melee max hit, defensive style, rune scimitar (+44 strength), from
floor((effective strength x (bonus + 64) + 320) / 640) (`combat.rs2:7-8`):

| Setup | Effective strength | Strength bonus | Max hit (i) | Expected damage per swing (i) |
|---|---|---|---|---|
| bare (rs/31) | 107 | 44 | 18 | 0.788 x 9.0 = 7.1 |
| super strength (+5 +15%) and Ultimate Strength (x1.15), glory (+6) | 143 | 50 | 25 | 0.855 x 12.5 = 10.7 |

That is x1.51 per swing before overkill and the cannon taking kills. At the ogres, rs/30
measured the same kit against no potions, no prayers and no amulet at about x1.40 (9.40 against
7.32 x 8.65 / 9.40, `combat.md` section 3). So the Defence rate at the spiders is taken as
5.60 x 1.28 to 5.60 x 1.40 = **7.2 to 7.8 per tick (i)**.

### Package A finish with the kit (i)

Start: Ranged 1,790 base, so 38,148 to go; Defence gap 19,938; Hitpoints gap 4,938 (covered by
the melee's one-third Hitpoints share, 6,646).

- **Defence 7.2, cannon 11.8.** Cannon + defensive melee until Defence 99: 19,938 / 7.2 = 2,769
  ticks, which also gives 32,674 Ranged (34,464 base, level 97-98). The rest, 5,474 base, at about
  21.5 per tick with cannon + rapid knives (interpolated from the measured 18.69 at 85 and 22.72 at
  99): 255. **Total 3,024, saving 496.**
- **Defence 7.8, cannon 11.8.** 2,556 ticks (30,161 Ranged), then 7,987 / 21 = 380. **Total
  2,936, saving 584.**
- **Cannon boost only** (Incredible Reflexes and glory, melee unchanged at 5.60): 38,148 / 11.8 =
  3,233 ticks, Defence then 18,105, the last 1,833 at the ogres at 9.3 = 197. **Total 3,430,
  saving 90.** So most of row 1's value is the melee damage boost, not the cannon's.

After the kit, Defence is the binding skill: Ranged is nearly done when Defence reaches 99. That
is why a better cannon tile (row 6) is worth less than it was. With the cannon at 14.0 instead of
11.8, Ranged finishes at tick 2,725, and the last 318 Defence take 34 ticks at the ogres: 2,759,
about 265 below the 3,024 case.

### Prayer drain with and without flicking (r, i)

The timer adds `%prayer_drain_effect x 5` to a counter every 5 ticks and removes a point per
`max(60, resistance)` (`prayer.rs2:159-175`). `combat.md` gives Ultimate Strength + Incredible
Reflexes at 0.4 points per tick, and `ranged.md` gives Protect from Melee at 0.2. At Prayer 43 a
prayer potion dose restores 7 + 25% of 43 = 17 points.

- **Current plan (f), Protect from Melee only, no flicking:** 3,459 ticks x 0.2 = 692 points, less
  the first 43: about 38 doses. Each sip is `p_delay(1)`: the melee loses the attack and the cannon
  loses its rotation for about 2 ticks (r: normal timers skip busy ticks, `Player.ts`
  `processTimers`). About 76 ticks of the finish (i). rs/31's 400-tick measurements at Prayer 99
  drained 80 points and needed no sip, so the 3,520 figure does not include them.
- **Row 1's three prayers, no flicking:** 0.6 points per tick, about 106 doses, about 210 ticks of
  stalls (i). The kit is only worth it with flicking.
- **Flicking:** 0 points (r, then m in section 2). The packet cost: turning all three off clears the timer, and the
  first one turned back on restarts it for 5 ticks. With the interleaving rule of at most 4 user
  events per tick (`interleaving.md` rule 2), one schedule is tick A: three offs and one on; tick
  A+1: the other two ons and the re-attack. Two prayers are then off for one tick in four. Put
  that tick between melee swings. A simpler variant drops Protect from Melee, which only blocks
  the spiders' small hits, not the poison (row 4).

### Ranging potion in the knives phase (i)

Rune knife (+25 ranged attack, +24 ranged strength), rapid, Ranged 99 against the spiders'
ranged D of 4,758:

| Setup | Effective ranged | Attack bonus | Hit chance | Max hit |
|---|---|---|---|---|
| bare (rs/31) | 107 | +25 | 0.750 | 15 |
| ranging potion (112 boosted) + glory | 120 | +35 | 0.800 | 17 |

Knife damage rises by 0.800 x 17 / (0.750 x 15) = 1.21, and the cannon's (it uses the same
ranged roll while knives are wielded) by 1.067. At 99 the measured 22.72 per tick splits as
12.9 cannon + 9.8 knives (`ranged.md` section 1), which becomes 13.8 + 11.9 = 25.6, +12.8%.
On Package B's 1,792 ticks that is about 1,792 x (1 - 1 / 1.13) = **~210-240 ticks (i)**. Green
dragonhide would add more ranged attack; whether its body needs Dragon Slayer here (which
Package B includes) was not checked.

## 2. Lab check: zero-drain flicking (measured)

`docs/speedrun/scripts/prayer-flick.ts` on `docs/speedrun/scripts/research-lab.sh` (port block
9290/9291/9292/43990/8190, `NODE_TICKRATE=300`, practice account Cairn on the local engine,
Prayer set to 99 so nothing ran out, no combat). One run of 150 ticks per mode:

| Mode | Packets | Prayer points used | Ticks each prayer showed active |
|---|---|---|---|
| Hold Protect from Melee + Ultimate Strength + Incredible Reflexes | none after activation | **90** (0.60 per tick, as read) | 1.00 / 1.00 / 1.00 |
| Flick Protect from Melee alone: off and on in one tick, every 4 ticks | 2 per 4 ticks | **1** | 0.99 |
| Flick all three: tick A off x3 + on Protect, tick A+1 on x2, every 4 ticks | 6 per 4 ticks | **0** | 0.94 / 0.74 / 0.74 |

So the drain timer never fires under a 4-tick flick (m). The two boost prayers are off on one tick
in four, exactly the schedule's tick A (the 0.94 for Protect from Melee is the state publication
catching the tick between its off and on). Not measured here: the flick's effect on the melee
cadence, since every prayer toggle runs `p_clearpendingaction` and the attack must be re-sent or
resumed by auto-retaliate. That belongs to brief A.

## 3. Lab: the boosted cannon finish (rs/91, measured)

Scope: rs/3 chose Package B (Waterfall off, Dragon Slayer after Monkey Madness) while this lab was
being set up, so rs/59 redirected it from Package A's long cannon + defensive melee stretch to
Package B's finish: Defence gap 1,288 base, Hitpoints gap 4,938, Ranged from about 54, Attack and
Strength capped (README section 7 on `agent/rs-3-coordinator-0`). That finish is about 230 ticks
of cannon + defensive melee, then cannon + rapid rune knives to Ranged 99.

**Method.** `docs/speedrun/scripts/cannon-kit.ts` on `research-lab.sh` (port block
9290/9291/9292/43990/8190, `NODE_TICKRATE=300`, practice account Cairn, local engine, macOS and
Linux executors). Set-up is rs/31's: cannon at the poison spiders (3288,3810), topped up every
20 ticks; stats Attack 99, Strength 99, Defence 99, Hitpoints 97, Prayer 43 and Ranged 70, 85 or
99, no armour. Unlike rs/31's runs, survival is real: sharks eaten below 58 hitpoints and prayer
potions sipped in the window, with no `::setstat` (the safety heal never fired). Each window is
400 ticks from the cannon's first Fire, and every sip, eat and stall falls inside it. The
configurations:

1. control: rune knives on rapid, Protect from Melee held, a prayer potion when the points fall
   one dose (17) below 43, sharks;
2. as 1 with Protect from Melee flicked: off and on in one tick every 4 ticks, the attack re-sent
   after the toggles in the same tick (3 packets);
3. as 2 plus a ranging potion, re-sipped when the boost falls to half, and an amulet of glory;
4. as 3 with one super antipoison dose and no sharks;
5. rune scimitar on defensive, super attack and super strength (re-sipped at half), glory, super
   antipoison, Protect from Melee + Ultimate Strength + Incredible Reflexes flicked with section
   1's schedule plus a re-attack on both ticks (5 and 3 packets); and the same with no melee
   (auto-retaliate off, cannon only).

The cannon's share of Ranged is the total less the knives' (4 per damage, the damage being
Hitpoints xp / 1.33). Throws are counted from the equipped knife stack.

**Ranged 85, three runs per configuration** (the level rises to 90-91 in the window; means, with
the range of the three totals):

| Config | Ranged / tick (m) | cannon (m) | knives (m) | Hitpoints / tick (m) | vs control (i) | Throws / tick, ideal 0.5 (m) | Cannon xp per ball (m) | Prayer points used (m) | Supplies used per 400 ticks (m) | Damage taken per 400 ticks (m) |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 control | 18.56 (18.04-19.52) | 11.40 | 7.15 | 2.38 | | 0.42 | 18.8 | 11-12 | 4 prayer potion doses, 0-1 shark | 6-54 |
| 2 flick | 19.41 (18.54-20.46) | 11.67 | 7.74 | 2.57 | +4.6% | 0.44 | 19.5 | 0 | 3-5 sharks | 78 |
| 3 + ranging potion, glory | 20.17 (19.59-21.22) | 11.56 | 8.60 | 2.86 | +8.7% | 0.44 | 20.3 | 0 | 2 ranging doses, 3-5 sharks | 78 |
| 4 + super antipoison, no food | **21.95 (21.82-22.14)** | 12.35 | 9.60 | 3.19 | **+18.3%** | 0.45 | 20.9 | 0 | 1 super antipoison, 2 ranging doses | **0** |

**Other levels** (configs 1 and 4 only):

| Start Ranged (window end) | Config | Runs | Ranged / tick (m) | cannon (m) | knives (m) | Hitpoints / tick (m) |
|---|---|---|---|---|---|---|
| 70 (82-83) | 1 | 1 | 17.40 | 11.30 | 6.10 | 2.03 |
| 70 (82-83) | 4 | 1 | 19.46 (+11.9%, i) | 11.75 | 7.71 | 2.57 |
| 99 | 1 | 2 | 19.88 (19.21, 20.55) | 12.08 | 7.80 | 2.59 |
| 99 | 4 | 1 clean + 2 with a dry cannon | 24.47 in the clean run (+23%, i) | 13.39 (clean run only) | 10.46 (all 3) | 3.48 |

**Configuration 5** (Ranged 85, one run each): with defensive melee, 13.66 Ranged and 7.65
Defence per tick, Hitpoints 2.53 (m), against rs/31's 11.03 + 5.60 + 1.85 with a bare scimitar.
The cannon's xp per ball rose to 23.1 (m), so the melee boosts lift the cannon about 18% over
rs/31's 11.52 cannon-only rate; cannon only, 13.64 per tick (m). The swing cadence held: 81 ticks
with Defence xp, 62 of the gaps between them exactly 4 ticks and 14 exactly 8 (a miss between two
hits) (m), so about 100 swings in 400 ticks (i), the 4-tick ideal. The Defence rate sits at the top
of section 1's inferred 7.2-7.8, which would have put Package A's finish near 2,720 ticks (i);
Package A is retired. With the kit on both packages, B still beats A, by ~310-340 ticks (i)
instead of the ~910-970 the quest README priced on rs/31's no-kit rates (README section 7).

**What the runs show:**

- **The flick costs no prayer in combat.** Every flicked run (15 of 400 ticks, configurations 2-5)
  ended on 43 points (m). The held control used 11-12 points plus 4 prayer potion doses per 400
  ticks (m), 0.2 points per tick as read.
- **A sip or eat blocks the next two ticks of prayer buttons.** A consume ends in `p_delay(1)`,
  setting `delayedUntil` two ticks on, and the engine decodes client input (`processClientsIn`)
  before it clears an expired delay (`processPlayers`, `World.ts`). A prayer toggle runs under
  protected access (`IfButtonHandler.ts`, `Player.ts` `canAccess`), so the toggles on both
  following ticks are dropped (r; seen in the first trial, where a sip on the tick before a
  flick left the boost prayers half-toggled and the drain fired). Working schedule: send the sip
  or eat in the same tick as the last flick toggles, after them; the two blocked ticks are then
  the free ticks of the 4-tick cycle.
- **The flick's re-attack helps the knives.** Throws per tick were 0.42 held and 0.44-0.45
  flicked (m), against 0.5 at the 2-tick rapid ideal. The held control re-attacks only when the
  player has dropped out of combat; re-sending the attack every 4 ticks picks the next target
  sooner after a kill. Most of the remaining loss is retargeting: gaps of 3-10 ticks between
  knife hits (m).
- **Packets.** No tick needed more than 5 user events (m). The knife configurations peaked at 3
  per tick (the flick tick); configuration 5 sent exactly 5 on 100 of its 400 ticks (m), at the
  cap, so the three-prayer melee flick leaves no room for anything else on that tick.
- **Super antipoison.** One dose kept damage at 0 for 400 ticks in all 9 runs that had it (m);
  its ~600 ticks (r) were not run to expiry. Without it, the flicked runs took 78 damage per 400
  ticks every time and ate 3-5 sharks (m).
- **Ranging potion.** Re-sipped at half boost about every 210 ticks (m, the second dose at
  ticks 210-218 at Ranged 85). It raised the knives' share by 11% (config 3 against 2) to 24%
  (4 against 2), and the cannon's xp per ball by about 8% (configs 3-4 against 1-2 pooled, m);
  section 1 inferred +21% and +6.7%. Configs 3 and 4 differ by more than 3-5 sharks can explain
  (i), so part of that gap is run-to-run noise: the cannon's shots per tick alone ranged
  0.54-0.67 between runs (m).
- **A lab defect to fix before longer runs.** In two of the three configuration-4 runs at Ranged
  99 the cannon ran dry (6 "out of ammo" messages in one) (m). The top-up is a use-item-on-cannon
  click; when the player has stepped away from the cannon for line of sight, the next flick's
  re-attack cancels the walk back before the balls are loaded. Those runs' cannon numbers are
  excluded; their knife numbers are kept. A route script should top up only from beside the
  cannon, or hold the re-attack until "You load the cannon" appears.

**Package B finish recomputed** (`docs/speedrun/scripts/cannon-kit-model.ts`, rs/31's plan (e):
cannon + defensive melee until the Defence gap closes, the cannon with the scimitar until Ranged
70, cannon + rapid knives to 99, Hitpoints as a by-product; the knife curves place each window at
its time-averaged level, 76, 87.5 and 99):

| Rates | Melee phase (i) | Cannon and knives phase (i) | Finish (i) |
|---|---|---|---|
| rs/31's (Prayer 99, survival by cheat; the route's current figure) | 230 | 1,821 | 2,051 |
| This lab's control (Prayer 43, real sips and food) | 230 | 1,936 (+44 Hitpoints-only) | 2,211 |
| Kit in the knives phase only (configuration 4) | 230 | 1,684 | 1,914 |
| **Full kit (configuration 5, then 4)** | **168** | **1,688** | **1,857** |
| Rune scimitar for the whole finish, full kit (configuration 5 throughout) | | | 2,794 |

Like for like, the kit saves about **354 ticks** (i) on Package B. Against the route's current
2,051 it saves about 194 (i), because this lab's control is slower than rs/31's runs: Prayer 43
with real sips and food, and a lower rate at Ranged 99 (19.9 over two runs against rs/31's 22.7
from one). Hitpoints closes as a by-product in every kit plan (about 5,440 base against the
4,938 gap, i). Cannon + rapid knives beats the scimitar by about 940 ticks once Defence is
capped (i): the scimitar's boosted cannon earns 13.6 Ranged per tick, the knives 19.5-24.5 with
the cannon.

**Supplies for the kit on Package B (i):** about 9 ranging potion doses (one at Ranged 70, then one
per ~210 ticks over ~1,690 ticks); 3 super antipoison doses (one per ~600 ticks, r); one dose each
of super attack and super strength for the 168-tick melee phase; one amulet of glory; no prayer
potions and no sharks, against about 6 prayer potions and 25 sharks in ranged.md's plan (e).
Every sip goes out in the tick of the Protect from Melee flick, after the toggles.

## 4. Lab briefs

**Measured by rs/91 (section 3): brief A's flick and antipoison questions, its kit on Package B's
melee phase, and brief B.**

**Brief A: the full kit at the spider cannon site, with zero-drain flicks and super antipoison
(worth about 570-650 ticks on Package A with row 4; over the 300-tick bar).** On the local engine
(practice account Cairn, `LOCAL_STAFF_LEVEL`, the ranged lab block of `ranged-lab.sh`:
9210/9211/9212/43910/8110, `NODE_TICKRATE=300`), set the route's post-MM stats with `::setstat`
(Attack 99, Strength 99, Defence 89, Hitpoints 97, Prayer 43, Ranged 54) and run
`ranged-cannon.ts` at the poison spiders (3288,3810) with defensive melee in four 400-tick
configurations (the flick schedule itself is already measured, section 2): (1) rs/31's control, bare scimitar, Protect from Melee, sipping prayer potions as
needed at Prayer 43; (2) control plus zero-drain flicks of Protect from Melee alone, re-attacking
after each flick; (3) the full kit (super attack, super strength, glory, Ultimate Strength,
Incredible Reflexes, Protect from Melee) with the flick schedule in section 1; (4) as 3 plus one
super antipoison dose and no food. Log per tick: cannon shots and xp, Defence, Hitpoints, prayer
points, packets sent and refused, damage taken, and whether a cannon shot is ever logged on the
2 ticks after a sip (to confirm the stall). The questions: does the prayer total stay flat under
flicks; does the cannon reach about 12 Ranged per tick and the melee 7.2-7.8 Defence per tick; and
what does a flick cost the melee cadence. If configuration 3 gives Defence 7.0 or more and
cannon 11.8 or more with no prayer used, rewrite plan (f) in `ranged.md` and the README's step 13.

**Brief B: ranging potion and glory in the cannon + rapid knives phase (about 210-240 ticks on
Package B).** Same lab, Ranged 85 and 99, rune knives on rapid, Defence 99 (Package B's state
after its 231-tick melee phase), Protect from Melee flicked: 300-tick windows with and without a
ranging potion (re-sipped when the boost has halved) plus glory. Report cannon and knife xp
separately. If Package A is chosen, the same data prices its ~230-360-tick tail.

**Brief C: a single-combat safespot cannon site (worth 0 to about 150 ticks on Package B, and
removes the Wilderness risk).** Read the OSRS rule against our code: a cannon target is refused
in a single-combat area only when an NPC has attacked the player in the last 8 ticks
(`player_combat.rs2:114-121`). Candidates from rs/31's own ranking run with `--single`
(`ranged-cannon-sites.ts --single`, run for this page): jungle spiders at (2673,3088), 18 spawns,
50 hp, defence 35, ranged defence 20, respawn 60, 15.0 hp per tick of regrowth against the
spiders' 13.9; and the Combat Training Camp ogres, ranged defence 0, which the 2004scape forum
recommends (t/14198) but which sit behind Biohazard's gate (`combat_training_camp.rs2:39`) and
accept ranged only (`:65-71`). Find a tile the targets cannot path to and that still has line of
sight for knives, then run cannon + rapid knives for 300 ticks against the spiders' measured
17.3-22.7. rs/31's earlier single-combat test (0 xp in 60 ticks) had a goblin attacking the
player, which is the one case the rule blocks.

## 5. Checked and not applicable

**Combat**

- **Rock crabs.** Only the Fremennik quest's `horror_rockcrab` NPCs exist
  (`quest_viking/configs/horror_rockcrab.npc`); no open rock-crab field. Not applicable.
- **Hill giants, moss giants, ogres, experiments as AFK targets.** Already measured by rs/30
  (`combat.md` section 1); ogres west of Yanille are its best single-combat target. The 2004scape
  forum's spots (Falador guards, fire giants, black demons) add nothing for a cannon that also
  needs a multi-combat melee target.
- **Tick eating.** Nothing on the route hits hard enough to need it. Not applicable.
- **Safespotting to avoid food ticks.** The finish needs the spiders to reach the player for
  melee; row 4 removes the food instead.
- **Curse and Vulnerability** (-5% and -10% NPC defence, `magic_combat_spells.dbrow:389-424`):
  spider defence 52 -> 47 lifts the hit chance by about 0.01 (i), for a 5-tick cast per target.
  Not worth it.
- **Defence-lowering specials** (dragon warhammer, Bandos godsword): absent from a 2004 revision.
  The dragon dagger's special needs Lost City (off route) and would add about 3% damage (i).
- **Faster melee weapons.** Nothing below 4 ticks exists here (`combat.md` section 3).
- **Fastest Hitpoints source.** Hitpoints is a by-product on both packages (README section 6).
- **Darts, chinchompas, dark bow, blowpipe.** Darts lose to knives (`ranged.md` section 4); no
  `chinchompa`, `dark_bow` or `blowpipe` object exists (grep of every `.obj`, `.npc`, `.rs2`).
- **Granite cannonballs (max hit 35).** Absent (no such object).
- **Two cannons, or a helper's cannon.** One cannon per player (`cannon_setup.rs2:59-63`); a
  helper's cannon gives its xp to the helper and takes kills from ours.
- **"Cannon reset" tricks.** A second Fire click is refused while the timer runs
  (`cannon_setup.rs2:251-253`), and timers are keyed by script, so a re-set cannot double the
  rate (`Player.ts` `setTimer`). At most one shot per tick (r).
- **Ranged prayers (Sharp Eye and successors).** Absent: only 15 prayers exist.
- **The prayer "drain stall"** (LostCity forum t/13002: drain pauses while a locked emote or a
  skill menu is open). The drain timer is a normal timer, so it pauses whenever the player is
  busy, but so does combat and the cannon. Not useful.

**Magic**

- **Tele-alching, stun-alching, alch while splashing.** Every spell but Charge sets `p_delay`,
  and a delayed player's spell clicks are dropped (`magic.md` section 4). Two delayed spells cannot
  share a window. Not applicable.
- **Splashing / curse training.** 5-tick combat spells (`player_magic.rs2:188`), 13 base per tick
  at best, against 22-26 for enchanting.
- **Superheat, Bones to Bananas, Telekinetic Grab, Charge Orb, teleports.** Already ranked by
  rs/20 and rs/28 (`magic.md` section 5); all lose to enchanting or Charge.
- **Lunar spells (Plank Make, String Jewellery, Superglass Make), bolt enchanting.** Absent (no
  matching spell or object; Lunar Diplomacy is 2006).
- **Anything below 3 ticks per enchant below level 71.** The `p_delay(1)` floor is the engine's,
  measured at 3 ticks with up to 5 clicks per tick (`magic.md` section 4). No community method
  applies.

**Prayer**

- **Gilded altar** (released 31 May 2006): absent. The only `gilded` matches are Legends' Quest
  and treasure-trail items.
- **Ectofuntus** (15 February 2005): absent (no `ecto` script, object or loc; `prayer.md`).
- **Chaos altar bone offering:** absent. No `[oplocu]` on any altar takes bones (`prayer.md`
  section 5), which the 2004scape forum also states (t/5978).
- **Higher bone tiers and multipliers** (dagannoth bones, bonecrusher, ensouled heads): absent.
  Dragon bones are the top tier (`bones.obj:82`).
- **A 1-tick bury.** The OSRS action table gives burying as 2 ticks and lists no trick; here
  `bury_bone.rs2` uses `p_delay(0)`, a hard 2 ticks (`prayer.md` section 4). The only sub-2-tick
  Prayer action in the community (POH altar offerings at "one with manual input") is absent.

**Runecraft**

- **Essence pouches, the Abyss** (13 June 2005), **the Ourania altar (ZMI), tiaras, combination
  runes**: absent. The only pouch object is Nature Spirit's druid pouch; no `tiara`, `abyss`,
  `lava_rune` or `mud_rune` object or script exists.
- **Double-rune levels.** They change runes made, not xp (`runecraft.rs2:68-99`).
- **Essence running** (runners trading essence to a crafter standing at the altar), the standard
  2004-2007 method in the community guides, is exactly the route's 7-tick cycle
  (`runecraft.md`). In OSRS crafting has no delay; here it ends in `p_delay(3)`, which is the floor.

**Smithing**

- **Blast Furnace** (23 August 2005), **Smiths' Uniform**: absent. The anvil item is 5 ticks in
  OSRS too. Goldsmith gauntlets with Superheat are untradeable and only break even
  (`smithing.md` section 5).

**Firemaking**

- **Fire lines** are the route's method; OSRS also lights at 4 ticks per log. Wintertodt,
  Forestry campfires and bow lighting are absent. Multiple tinderboxes do not help, because the
  clock is per player (`firemaking.rs2:54-77`). Pyre logs are covered in `firemaking.md` section 5.

**Fletching, Herblore, Crafting, Cooking**

- The community's best rates are 2 ticks per action in OSRS (arrows, mixing, gem cutting). These
  actions are delay-free here, up to 5 per tick (rs/37), already faster than any community method.
  Wine fermentation (Cooking) has no community equivalent.

**Records.** The OSRS Wiki's standard cannon spot (ogres by Castle Wars) gives about 40,000 xp
per hour from the cannon alone, about 6.7 base per tick at OSRS rates. Our spider site's measured
11.5 is well above it, consistent with rs/31 having already found an unusually dense site.
Competitor timelines are rs/60's.

## 6. Sources

All accessed 2026-10-21.

- OSRS Wiki, *Dwarf multicannon* (sections Accuracy, Rotation, Targeting, Common cannon spots):
  https://oldschool.runescape.wiki/w/Dwarf_multicannon
- OSRS Wiki, *Pay-to-play Ranged training* (cannon section; Castle Wars ogres ~40,000 xp/h):
  https://oldschool.runescape.wiki/w/Pay-to-play_Ranged_training
- OSRS Wiki, *Game tick/Action lengths*: https://oldschool.runescape.wiki/w/Game_tick/Action_lengths
- OSRS Wiki, *Prayer points* (flicking): https://oldschool.runescape.wiki/w/Prayer_points
- Microgrind, *Prayer flicking explained tick by tick: lazy flicks vs 1-tick flicks*:
  https://microgrind.io/guides/prayer-flicking/
- LostCity forum, *Reintroduce Prayer Flicking*, 15-16 March 2025 (prayer changes now require
  re-clicking the monster; drain delays tweaked in 2004Scape/Server PR #1423, not read here):
  https://lostcity.rs/t/reintroduce-prayer-flicking/3058 (raw text at https://lostcity.rs/raw/3058)
- LostCity forum, *Prayer flicking not working properly*, 19 March 2025:
  https://lostcity.rs/t/prayer-flicking-not-working-properly/3391
- LostCity forum, *Prayer drain stall bug its back boys*, 3 January 2026:
  https://lostcity.rs/t/prayer-drain-stall-bug-its-back-boys/13002
- LostCity forum, *Best Cannon Spot for XP?*, 21-22 February 2026 (Yanille ogres "3 or 4 ogres per
  rotation", the Biohazard ogre cage, fire giants, poisonous sites):
  https://lostcity.rs/t/best-cannon-spot-for-xp/14198
- LostCity forum, *Prayer training tips*, 17 April 2025 (no bones-on-altar in 2004; search
  snippet only): https://lostcity.rs/t/prayer-training-tips/5978
- Release dates: OSRS Wiki *Blast Furnace* (23 August 2005), *Gilded altar* (31 May 2006),
  *Ectofuntus* (15 February 2005), *Abyss* (13 June 2005).
- Essence-running guides of the period (search snippets; the pages did not load): Wildguard
  forum *Rune Crafting Guide*, 8 September 2004,
  https://www.tapatalk.com/groups/wildernessguardians/rune-crafting-guide-t614.html; Global
  RuneScape *Essence Running Guide*, http://www.global-rs.com/guides/misc/essencerunning/.

Code references are to `server/content/scripts/**` and `server/engine/src/**` at this branch's
base. rs/31's site ranking was re-run unchanged from
`docs/speedrun/scripts/ranged-cannon-sites.ts` on `agent/rs-28-coordinator-0`.
