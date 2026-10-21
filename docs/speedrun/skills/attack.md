# Attack: fastest route to 99

Shared measurement, mechanics and gear: [combat.md](combat.md). Scripts:
[`combat-rate.ts`](../scripts/combat-rate.ts), [`combat-model.ts`](../scripts/combat-model.ts).
Labels follow `docs/speedrun/skills/README.md` (rs/2). Host: the measured rates are
combat.md's, taken at 300 ms on the Mac executor `local` at load 11-18 on 16 cores, so they are
**busy-host figures, a few percent pessimistic** (combat.md header).

## 1. Recommendation

**Do not train Attack.** On rs/3's route (Package B: Waterfall off, Dragon Slayer on after
Monkey Madness option 1) it is quest-capped before the cannon session:

- Tree Gnome Village 11,450 + The Grand Tree 18,400 + Fight Arena 12,175 = **42,025** base
  (read), past 99's 39,938. That is what the cannon needs: its hit roll uses the wielded
  melee style, so Attack 99 must come before the pre-MM cannon session (`ranged.md`).
- Monkey Madness option 1 adds 20,000, for **62,025**. Dragon Slayer and its filler give no
  Attack. **0 ticks of Attack training.**

Alternatives (not on the route): Package A (Waterfall on) adds 13,750 for 75,775; without
MM, The Grand Tree + Fight Arena give 30,575 (level 96), or 44,325 with Waterfall.

If the route changes and Attack has to be trained, use accurate style on the ogres
west of Yanille with Strength 99: 9.0-9.4 base xp per tick from Attack 70 up
(inferred, calibrated to 300 ms samples). That is **about 4,390 ticks from level 1**.
The one real constraint is order: the rune scimitar needs base Attack 40, and Holy
Grail's Black Knight Titan needs Attack 20 for Excalibur if that quest returns.

## 2. Route by level band

| Band | Method | Location | Unlock | Base xp per damage | Ticks per swing | Hit rate | Base xp per tick | Ticks for band |
|---|---|---|---|---|---|---|---|---|
| 1-40 | Ogres, accurate, best scimitar for the level (iron -> adamant) | (2496-2503, 3089-3097) | none | 4 (read) | 4 | 0.5-0.8 (model) | 5-8 (model, may be 15-20% high) | 132 |
| 40-70 | Ogres, accurate, rune scimitar | same | Attack 40 | 4 | 4 | 0.80-0.85 | 8.1-9.0 (model) | 536 |
| 70-85 | same | same | | 4 | 4 | 0.83 (measured 100 ms at 70) | 7.62 measured (100 ms, Str 70); 9.0-9.3 with Str 99 (model) | 1,069 |
| 85-93 | same | same | | 4 | 4 | | 9.3 (model) | 1,205 |
| 93-99 | same | same | | 4 | 4 | | 9.4 (model) | 1,447 |

Band ticks are inferred with Strength 99, full potions, Ultimate Strength and
Incredible Reflexes (`combat-model.ts`).

## 3. Quest xp

| Quest | Attack (base, read) | Scenario |
|---|---|---|
| The Grand Tree | 18,400 (`quest_grandtree.rs2:200`) | on route |
| Waterfall | 13,750 (`quest_waterfall.rs2:491`) | **off route** (Package A only) |
| Fight Arena | 12,175 (`quest_arena.rs2:270`) | on route |
| Tree Gnome Village | 11,450 (`quest_tree.rs2:98`) | on route (the MM gate) |
| Monkey Madness option 1 / 2 | 20,000 / 35,000 (`mm_daero.rs2:295,304`) | option 1 on route |
| **Package B total** | **62,025** (42,025 before the cannon session) | |

The pre-MM fights are cast, not meleed (rs/3 `pre_mm_fights.md`), so they add no Attack;
Attack goes 1 -> 80 -> 94 -> 99 on the three quest rewards alone.

Without Waterfall and without MM, Attack is 30,575 (level 96), leaving 9,363:
about 1,000 ticks (inferred). The earlier the quests come, the less Attack the
account ever trains; nothing in the route needs more than base Attack 40 before
then.

## 4. Mechanics

See [combat.md](combat.md) section 2. Accurate adds +3 to effective Attack, which
raises the hit chance (0.83 against 0.82 for aggressive at 70/70/70, measured 100
ms) but not the max hit. So at a fixed Strength, accurate trains Attack about as
fast as aggressive trains Strength (7.62 against 7.51 measured).

## 5. Alternatives considered

- **Controlled** gives 1.33 base per damage to each of Attack, Strength and
  Defence on the scimitar's weak stab bonus: 6.83 total, 2.28 each (measured, 100
  ms). Never worth it with any of the three capped.
- **Other targets:** combat.md section 1.
- **Interleaving** (`interleaving.md` section 8): nothing to absorb on the route, and if
  Attack were trained, melee is location-bound self-only time that cannot be folded into
  another skill's clock (combat.md section 6).

## 6. Gotchas

As in combat.md section 8: re-attack after every drink or eat, abandon unreachable
targets, and dismiss level-up dialogs.

## 7. Helper supply list

Nothing on the planned route. If Attack 1 -> 99 were trained (about 4,390 ticks):
26 prayer potions, 3 super attack, 3 super strength, about 8 sharks, plus the kit in
combat.md section 6.

## 8. Open questions

- Settled: Waterfall is off (rs/3 Package B), and Attack is still capped by Tree Gnome
  Village + The Grand Tree + Fight Arena. Only a route without MM *and* without Waterfall
  would bring back about 1,000 ticks of Attack.
