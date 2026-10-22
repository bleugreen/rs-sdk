# Pre-Monkey-Madness fights at the levels the route actually gives

**Every pre-MM fight is safe at Defence 1 and 10-42 Hitpoints if the account
has Protect from Melee before the first one, and none needs Strength.** Prayer
43 costs 11 dragon bones (21 ticks of burying, which the Prayer route spends
anyway, plus a trade that can ride with Tree Gnome Village's helper trade).
The Khazard warlord, the black demon and the Fight Arena monsters have no
Magic level and no magic defence, so Fire Bolt (Magic 35) or Fire Blast (Magic
59) from a level-1 melee account kills them as fast as melee at Strength 83. In
20 measured fights at the route's levels, 300 ms ticks, the account took **0
damage** under Protect from Melee. What prayer does not cover is poison at the
cannon site (30 Hitpoints per session against 42) and prayer points running
out, so the helper trade carries 1 antipoison and 2 prayer potions.

For the README:

- **Waterfall's Strength is worth at most ~40 ticks in the pre-MM fights**
  (the warlord only: 118 melee against 165 Fire Bolt, or 133 Fire Blast). It is
  worth nothing for the demon and Fight Arena. So Waterfall stays on the route
  only on its post-MM value.
- Merlin's Crystal and Holy Grail are off the route (coordinator, 2026-10-21),
  so Sir Mordred and the Black Knight Titan were not measured. One finding for
  the record: the Titan has magic and ranged defence 1000
  (`fisher_realm.npc:306-307`), so he is the one pre-MM fight a spell cannot
  do, and at Strength 1 a melee kill would take hundreds of ticks (inferred:
  max hit 2). Without Waterfall first, Holy Grail would have been out of reach.
- These fights cost **no more ticks than the 70/70/70 figures in the quest
  docs**, and some cost less: the demon took 153 against 237, and the Fight
  Arena chain 281 against 435.

Conventions and labels follow `CONVENTIONS.md`. All fight figures are
**measured at NODE_TICKRATE=300** with the scripts named below, on a local lab
(`quest-premm-lab.sh`, this child's port block 9020/9021/9022/43720/7920).

## The route assumed

Prayer 43 from bones and Magic 51 from the Magic route's enchant ladder
(rs/28: Magic 51 is reached before Plague City's teleport legs anyway), then:

Plague City (no fight) -> **Tree Gnome Village** (Khazard warlord) -> **Grand
Tree** (black demon) -> **Fight Arena** (ogre, scorpion, Bouncer) -> Dwarf
Cannon (no fight) -> **cannon Ranged 1->50 at the Wilderness poison spiders**
-> Monkey Madness -> Mage Arena.

Waterfall is placed by its own value. If it stays, it goes after Grand Tree,
for the spirit trees. Its dungeon is a hazard at these levels (see Risks).

## 1. Stat timeline (levels at the start of each fight)

Base xp: quest rewards from the quest docs; combat xp measured in the runs
below (Hitpoints 1.33 per damage, `combat.rs2:142,167`; spells give 2 Magic per
damage plus the spell's 22.5 / 34.5 per cast, `magic_combat_spells.dbrow`).
Levels from the xp table (`Player.ts:77-85`). Defence stays 1 until Monkey
Madness, because nothing on the route before it gives Defence.

**Route A, spells, Waterfall not before these fights (recommended):**

| Fight | Atk | Str | Def | HP | Prayer | Magic | Ranged | Combat level (inferred) |
|---|---|---|---|---|---|---|---|---|
| Khazard warlord (TGV) | 1 | 1 | 1 | **10** | 43 | 51 | 1 | ~33 |
| Black demon (GT) | 80 | 1 | 1 | **28** | 43 | 58 | 1 | ~41 |
| Fight Arena | 94 | 1 | 1 | **36** | 43 | 70 | 1 | ~49 |
| Cannon at the spiders | 99 | 1 | 1 | **42** | 43 | 74 | 1 -> 50 | ~52 |
| Monkey Madness (start) | 99 | 1 | 1 | 42 | 43 | 74 | 50 | ~52 |

Per-fight xp behind the steps (measured means): the warlord +226 HP and +1,047
Magic; the demon +209 HP and +996 Magic; Fight Arena about +287 HP (inferred
from 216 hitpoints of monsters) and about +1,540 Magic (inferred). Quest
rewards: TGV 11,450 Atk; GT 18,400 Atk, 2,150 Mag; FA 12,175 Atk (Attack is at
99 from TGV + GT + FA).

**Route B, Waterfall first, then melee (the comparison the coordinator asked
for):** warlord at 83/83/1, HP 10; demon at 92/84/1, HP 28; Fight Arena at
99/84/1, HP 36; cannon at 99/85/1, HP 42. The melee fights give Strength in
place of Magic (+684, +632, about +864) and the same Hitpoints.

Two consequences for other documents:

- **Magic.** Route A's fights give about 3,600 base Magic before Mage Arena
  (Magic ~74 there), which replaces part of the Magic route's enchanting from
  57 to 71 (rs/52). Rs/28's Magic plan should start its pre-Mage-Arena
  enchanting from the post-fight level.
- **Monkey Madness at Defence 1 and 42 Hitpoints.** MM's own doc measured its
  hazards at 70/70/70 (`monkey_madness.md`). Its Jungle Demon is fought under
  Protect from Magic, so Defence does not matter there. But the jungle
  spiders poison through prayer, and the temple trapdoor and the guards were
  measured with 70 Hitpoints. Both are open below.

## 2. Prayer plan and its cost

| Need | Source | Cost (ticks) | Basis |
|---|---|---|---|
| Prayer 43 (Protect from Melee), before TGV | 11 dragon bones from a helper, buried in place | 21 burying + the trade (9 stock / 5 fixed, or 0 extra inside TGV's helper trade) | measured by rs/33 (`prayer-bury.ts`), quoted |
| Prayer 37 (Protect from Magic) for MM and Mage Arena | already covered by 43 | 0 | |
| Prayer points through the pre-MM fights | 2 Prayer potion(4) in the same trade | about 1 tick per sip (between swings) | read: a dose restores 7 + 25% of Prayer, 17 points at 43 (`consume_effects.dbrow:173`) |

**The bones are not an extra cost.** They count toward Prayer 99 like every
other bone (rs/33), so burying them first only moves 21 ticks of the Prayer
route earlier. **Holy Grail is no longer the Prayer source**, so nothing on the
route caps how early Prayer can be bought.

Prayer points used, measured (Protect from Melee drains 1 point per 5 ticks
with no prayer bonus, `prayer.rs2:163-175`, `prayers.enum` drain 12):

| Fight | Points used (n) | At Prayer 43 |
|---|---|---|
| Warlord (Fire Bolt) | 22-46, mean 33 (6) | ran out once (1 dose, 46 points) |
| Warlord (Fire Blast, Magic 59) | 26 (2) | fine |
| Black demon | 27-35, mean 30 (5) | fine |
| Fight Arena, prayer on per fight | not logged; ~20 inferred from ~100 fight ticks | fine |
| Cannon session, ~152 ticks | 29-30 (4) | fine |

That is about 115-125 points from TGV to the end of the cannon session,
against 43. Points do not regenerate, so either 4-5 doses (2 Prayer potion(4)),
or an altar recharge before each fight, or more Prayer. **Does buying more
Prayer early remove the risk?** It removes the need for potions, not any
damage: the melee damage is already 0 at Prayer 43. Prayer 70 (74 dragon bones,
~150 ticks of burying the Prayer route spends anyway, but 2-3 bank trips at
that point instead of later) gives 70 points per recharge. That covers any
single fight with margin, and two in a row. Since it costs only reordering,
it is a reasonable choice if the run plan has an early bank stop. Otherwise
43 plus 2 potions is the cheaper trade. Prayer gear stretches the points too:
monk's robes and a holy symbol (+19, no wield requirement in `levelrequire/`)
give 1 point per 8.2 ticks instead of 5 (read: resistance 60 + 2 x bonus,
`prayer.rs2:165-173`).

## 3. Fights measured at route levels (300 ms)

Scripts: `quest-premm-fight.ts` (warlord, demon), `quest-arena-run.ts` with
the new `--att/--str/--def/--hp/--pray/--prayer/--ppots/--magic/--spell`
flags (Fight Arena from the cell keys, stage 5), `quest-premm-cannon.ts`
(cannon, no survival cheat). Fight ticks run from the first attack to the kill
(the warlord, the demon), or from Jeremy's keys to stage 12 (Fight Arena,
including its cutscenes). Protect from Melee was on in every run unless the row
says otherwise, with no armour (Defence 1), staff of fire + amulet of magic for
spells, rune scimitar + amulet of strength/power for melee.

| Fight | Levels (Atk/Str/Def, HP, Prayer, Magic) | Setup | Ticks per kill | Deaths | Damage taken | Supplies used | n |
|---|---|---|---|---|---|---|---|
| Khazard warlord | 1/1/1, 10, 43, 51 | Fire Bolt | **165** mean (113, 146, 155, 167, 176, 233) | 0 | 0 | 1 prayer dose in 1 run | 6 |
| Khazard warlord | 1/1/1, 10, 43, 59 | Fire Blast | **133** (133, 133) | 0 | 0 | none | 2 |
| Khazard warlord (route B) | 83/83/1, 10, 43 | melee, aggressive | **118** mean (98, 114, 130, 131) | 0 | 0 | none | 4 |
| Black demon | 80/1/1, 28, 43, 58 | Fire Bolt | **153** mean (136, 141, 146, 161, 181) | 0 | 0 | none | 5 |
| Black demon (route B) | 92/84/1, 28, 43 | melee, aggressive | **157** mean (136, 155, 168, 170) | 0 | 0 | none | 4 |
| Fight Arena chain (keys to stage 12) | 94/1/1, 36, 43, 65 | Fire Blast, prayer per fight | **281** | 0 | ~3 (General after the chain) | none | 1 |
| Fight Arena chain (route B) | 99/85/1, 36, 43 | melee, prayer per fight | **278, 281** | 0 | up to 15, all from General Khazard after Bouncer (prayer was switched off) | none | 2 |
| Fight Arena chain, no prayer | 94/1/1, 36, 1, 65 | Fire Blast | 332 | 0 | ~180 (inferred from food) | **14 swordfish**, ended 21/42 | 1 |
| Cannon session at (3288,3810) | 99/1/1, 42, 43; Ranged 1 | rune scimitar wielded, auto-retaliate off | 151-153 ticks for Ranged 1 -> 54-57 (12-14 base/tick) | 0 | **24-30, all poison**, lowest HP 8-19 | 0-1 shark (eat below 12), 0-1 prayer dose | 4 |
| Cannon session, with antipoison | same | one dose at the first poisoning | 166 ticks, Ranged 1 -> 55 | 0 | **0** | 2 antipoison doses | 1 |

Notes on the samples:

- Excluded: one warlord Fire Bolt run of 279 ticks in which the script drank
  12 potion doses off a stale prayer reading at the start (fixed). Also
  excluded: one route-B warlord run that killed two warlords (the static spawn
  at his post as well as the lab spawn; the script now tracks one target), and
  one Fight Arena run that met the previous run's 500-tick ogre spawn
  (`fight_arena.md`'s "Leftover spawns").
- Level-ups: 15-23 level-up dialogues per warlord fight at level 1 (Magic and
  Hitpoints at 25x), 10-12 per demon fight. Each one interrupts the spell loop
  until dismissed. They are included in the ticks above.
- The two first runs of each block ran on loaded executors (fedora, bgsrv-ub,
  load average ~25). The rest ran on bgsrv-mac (load ~2.5). The tick figures agree
  across hosts, but SDK state waits timed out under load. Run the lab on a
  quiet executor.
- The cannon script cannot tell poison hitsplats from melee ones in the lite
  client's combat events. The antipoison run took 0 damage, which shows the
  damage under Protect from Melee is all poison. Poison is read from
  `poison.rs2`: a 30-tick timer, ceil((severity + 4) / 5) per hit, spider
  severity 27 (`all.npc`, `poisonspider`), reset to 27 by each spider attack.
  So about 6 Hitpoints per 30 ticks, or 0.2 per tick.

**Waterfall-first comparison (the coordinator's question 1).** Strength
changes the warlord from 165 (Fire Bolt at Magic 51) or 133 (Fire Blast at
Magic 59) to 118 ticks. That saves 15-47 ticks. It does not change the demon
(157 vs 153) or Fight Arena (278-281 vs 281). Moving the Magic route's
enchanting to 59 before TGV costs nothing (the same casts, earlier) and cuts the
gap to ~15. **Waterfall's Strength is worth about 15-47 ticks in the pre-MM
fights.** Putting Waterfall first also loses its ~300-tick spirit-tree saving
(`waterfall.md`). So Strength gives no reason to keep Waterfall, or to move it
earlier.

## 4. Supplies, and which fights need them

| Fight | Without prayer at these levels | With Protect from Melee | Helper supplies |
|---|---|---|---|
| Khazard warlord | death (max hit ~9 vs 10 HP; inferred from `gnome_battlefield.npc` 75/78/80) | safe, measured 0 damage | Prayer 43 bones; runes |
| Black demon | death (157 hp, 148 Str vs 28 HP; inferred) | safe, measured 0 damage | runes |
| Fight Arena | survivable only on food: 14 swordfish at 36 HP (measured, n=1) | safe, measured | runes. Keep prayer on until out of the arena: General Khazard attacks at stage 12 |
| Cannon at the spiders | not measured | safe from melee. Poison takes 24-30 of 42 HP per session | **1 Antipoison(4)** (or 2 sharks) |
| Prayer points across the four | | 115-125 points needed against 43 | **2 Prayer potion(4)** (or altar recharges, or Prayer ~70 from early bones) |

One helper trade before TGV covers everything: 11 dragon bones, a staff of
fire, an amulet of magic, runes, 2 Prayer potion(4), 1 Antipoison(4) and 2
sharks. Rune counts (inferred from the cast counts above): Fire Bolt 55-114
casts per fight, so about 200 chaos and 600 air for the warlord and the demon.
Fire Blast for Fight Arena, about 40 casts: 40 death and 160 air. Fire runes
come from the staff. Whatever helpers hand over is free
(`CONVENTIONS.md`); the trade is the cost.

## 5. Order recommendation

1. **Prayer 43 from bones before Tree Gnome Village**, in the same helper trade
   (bury 11, 21 ticks). This is the precondition for every fight below.
2. **Magic to 59 before Tree Gnome Village if convenient** (the same enchant
   casts the Magic route does anyway, just earlier). Fire Blast takes the
   warlord in 133 instead of 165. Otherwise Fire Bolt at 51 is fine.
3. Plague City -> TGV -> Grand Tree -> Fight Arena -> Dwarf Cannon -> cannon
   session -> Monkey Madness -> Mage Arena. Fight Arena can sit anywhere after
   Grand Tree. Its fights need nothing that Grand Tree gives, but there is no
   reason to put it earlier.
4. **Waterfall** goes wherever its post-MM value puts it. If it is done before
   MM, do it after Grand Tree (spirit trees) with Protect from Melee on in the
   falls dungeon.
5. Fight with spells, not melee, while Strength is 1. Melee only wins at the
   warlord, and only if Waterfall has already given Strength.

## 6. Defensive casting (O43a): measured, then ruled off

O43a cast the warlord, demon and Fight Arena spells with the staff's defensive "Focus"
style selected, to take Defence from 1 to ~37 at no training ticks before Monkey Madness.
**Main ruled it off (2026-10-22): Monkey Madness's damage in K, M, P and R is direct trap and
roof damage that Defence does not reduce.** These figures are for the record (rs/425,
lite client on a loaded host, so xp is reliable and ticks are indicative only).

- **xp rule (r):** `give_combat_experience` (`combat.rs2`) pays `style_magic_normal` 2 Magic
  per damage and `style_magic_defensive` 1.33 Magic + 1 Defence. `pvm_spell_success`
  (`player_magic.rs2`) picks the defensive branch when `%damagestyle` is
  `style_melee_defensive`. Hitpoints is 1.33 per damage either way.
- **Measured Defence xp per fight (m, finished runs, one Defence per damage):** warlord 172
  (HP 170), demon 158 / 158 (157), ogre + scorpion + Bouncer 218 / 216 / 217 / 218 (216).
  The 1-2 over each NPC's HP is most likely regeneration during the longer fights. **Total
  546-548 base = Defence 38**, 2-4 base over 38's floor (544). Capped strictly at NPC HP it
  would be 543 = Defence 37.
- **Magic (m, 4/4 arena runs):** 1.32-1.33 Magic per damage plus 34.5 base per Fire Blast
  cast. The cost is 0.67 x ~547 = **~365 base**, so rs/158's S16 arrival of 9,117.5 becomes
  ~8,752.5. That is **Magic 77 kept, ~77 base spare** (77's floor is 8,675.5).
- **Ticks (indicative):** warlord 218 and 145 (the 145 run started ~50 HP down, left damaged by
  an earlier failed run); demon 268 / 248; ogre / scorpion / Bouncer 74 / 86 / 92 mean against
  one normal-style control run at 60 / 81 / 67.

**`set_attackstyle` silently drops a style click unless the player is free**
(`player_attackstyles.rs2`, `[proc,set_attackstyle]`). It sets `%com_mode` only when
`p_finduid(uid)` succeeds; otherwise it resyncs the old value and says nothing. The first
version sent one click on the tick of the first cast. It lost the demon's Defence entirely
(0 of 157), and of the arena fights only Bouncer's 116 counted. Anyone reviving this must
wait for the published `combatStyle.currentStyle` before the first cast and re-send the
click if it drops back.

**The style persists.** No weapon swap resets `%com_mode` (`update_weapon_category` resets
autocast only; `player_combat_stat` clamps the mode to each weapon's style count). After
S12, Monkey Madness's bow would inherit slot 2 as **Longrange** (2 Ranged + 2 Defence per
damage instead of 4 Ranged). Kolodion's S16 fight would cast defensively again. A revival
must set style 0 after S12's last fight.

The code (a shared `castingStyle` option in `speedrun/lib/combat.ts`, confirmed-style
`fight()` handling, the three fights' hooks and a lab `--casting` flag, with tests) is on
branch `agent/rs-425-builder-2`, commits `cd6dd10f`..`ff542683` (`7f127382`..`6334bb53`
before a replay), and was not merged.

## Risks and gotchas

- **Prayer is the whole defence.** At Defence 1 every unprotected hit lands.
  The account must switch Protect from Melee on before the warlord attacks, and
  before opening Glough's trapdoor (the demon spawns and attacks inside the
  scene). It must also re-enable the prayer after a potion sip if it drops.
- **Prayer can run out mid-fight at 43** (the warlord used 46 points in one
  run). Sip below ~10 points. A sip costs about a tick between casts.
- **Fight Arena's General Khazard** attacks once Bouncer dies (stage 12). With
  Defence 1, leave the prayer on until you are out of the arena door.
- **The cannon site is level-37 Wilderness.** At combat ~52, other players of
  combat 15-89 can attack (`pvp_combat.rs2:32-38`, via `ranged.md`). With 42
  Hitpoints and Defence 1, a player kill is likely if anyone tries. This is not
  measurable locally. The non-Wilderness fallback (Battlefield of Khazard,
  ~20% slower, `ranged.md`) removes the risk.
- **Waterfall dungeon at Defence 1 and ~36 Hitpoints (not measured).** Fire
  giants and skeleton mages are melee (`all.npc`: `firegiant` slash,
  `skeletonmage` crush), so Protect from Melee blocks them. Shadow spiders halve
  your prayer points on each attack, even under protection
  (`shadow_spider.rs2:22-25`). A shadow spider followed by a fire giant (max hit
  ~11) is the realistic death. Carry food and potions if Waterfall is done
  before MM.
- **Level-up dialogues** arrive every few casts at level 1. A bot must dismiss
  them and re-cast, or the fight stalls.
- **Lab only:** `::npcadd khazard_warlord` adds a second warlord beside his
  static spawn; the arena's ogre spawn lasts 500 ticks across runs.

## Open questions

- Monkey Madness at Defence 1 / 42 Hitpoints / Strength 1: the temple-trapdoor
  guards and the jungle spiders (poison through prayer) were measured at
  70/70/70. It needs a re-check at these levels, or a budget of food and
  antipoison in MM's trade.
- The Waterfall dungeon at these levels (above).
- Prayer points for the Fight Arena fights were not logged (inferred ~20).
- The cannon session is 1 sample with antipoison and 4 without. The Wilderness
  PvP risk is unquantified.

## Scripts

- `docs/speedrun/scripts/quest-premm-lab.sh <script> [args] [-- <script> ...]`:
  boots the engine at 300 ms, a gateway and a headless client on this port
  block, runs the scripts, and restarts the client if it dies. Works on Linux
  and macOS executors.
- `quest-premm-fight.ts <bot> <warlord|blackdemon|mordred|titan> [runs] stats=a,s,d,hp,prayer,magic mode=melee|fire_bolt|fire_blast ...`:
  repeated fights at given levels with real deaths, level-up handling, potion
  sips and per-run xp. Mordred and the Titan are wired but were not measured
  (off route).
- `quest-arena-run.ts --from 5 --att A --str S --def D --hp H --pray yes --prayer P --ppots N --magic M --spell fire_blast`:
  the Fight Arena chain at route levels. Its fights run on the shared
  `speedrun/lib/combat.ts` `fight()`, which has `spell`, `prayer` and
  `drinkBelow` options and re-attacks when a protect prayer suppresses
  auto-retaliate. Without that fix, melee
  under Protect from Melee stalled forever on the ogre.
- `quest-premm-cannon.ts <bot> [runs] stats=a,s,d,r,hp,prayer ticks=N food=N ppots=N antipoison=N`:
  a cannon session at the spiders with no survival cheat.
