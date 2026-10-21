# Strength: fastest route to 99

Shared measurement, mechanics and gear: [combat.md](combat.md). Scripts:
[`combat-rate.ts`](../scripts/combat-rate.ts), [`combat-model.ts`](../scripts/combat-model.ts).
Labels follow `docs/speedrun/skills/README.md` (rs/2).

## 1. Recommendation

Train Strength on the ogres west of Yanille, aggressive style, with Attack already
99. Use the rune scimitar, amulet of strength, super attack and super strength
kept above half boost, and Ultimate Strength + Incredible Reflexes.

Measured at 300 ms: **7.58 base xp per tick at Strength 70-82, 8.99 at 90-95, 10.08
at 95-99**, plus a third of that to Hitpoints.

| Start | Ticks to 99 | Basis |
|---|---|---|
| With MM option 1 (48,750 base with Waterfall) | **0** | capped |
| With MM option 1, no Waterfall (35,000) | 522 | inferred |
| No MM (Waterfall 13,750, level 83) | **2,901**, yields 8,729 HP | inferred |
| Level 1 (Attack 99) | **4,898** | inferred |

## 2. Route by level band

| Band | Method | Location | Unlock | Base xp per damage | Ticks per swing | Hit rate | Base xp per tick | Ticks for band |
|---|---|---|---|---|---|---|---|---|
| 1-40 | Ogres, aggressive | (2496-2503, 3089-3097) | none | 4 (read) | 4 | 0.89 (Att 99) | 2-5 (model) | 186 |
| 40-70 | same | same | | 4 | 4 | 0.89 | 4.8-7.3 (model); 4.14 measured at 40-62 with Attack 40 | 741 |
| 70-85 | same | same | | 4 | 4 | 0.83 | **7.58 measured (70-82)** | 1,234 |
| 85-93 | same | same | | 4 | 4 | 0.86 | **8.99 measured (90-95)** | 1,277 |
| 93-99 | same | same | | 4 | 4 | 0.85 | **10.08 measured (95-99)** | 1,460 |

Band ticks are from `combat-model.ts` (model x 0.944); the measured samples are 300
ms, 1,000 ticks each, from `combat-rate.ts <bot> ogre ticks=1000 att=99 str=<L>`.

## 3. Quest xp

| Quest | Strength (base, read) | Start level |
|---|---|---|
| Waterfall | 13,750 (`quest_waterfall.rs2:492`) | 83 |
| Monkey Madness option 1 | 35,000 (`mm_daero.rs2:297`) | 97 (99 with Waterfall) |
| Monkey Madness option 2 | 20,000 (`mm_daero.rs2:306`) | 89; 96 with Waterfall (656 ticks left) |
| Haunted Mine (candidate) | 22,000 (`hauntedmine_crystals.rs2:54`) | 97 with Waterfall (443 ticks left) |
| Dragon Slayer (off route) | 18,650 (`quest_dragon.rs2:33`) | 95 with Waterfall (801 ticks left) |
| Troll Romance (off route) | 4,000 (`quest_troll_love.rs2:304`) | |

Half of the xp to 99 lies above level 93, where melee runs at 9-10 base xp per tick.
So a Strength quest reward is worth about its xp / 9.5 in ticks (inferred).

## 4. Mechanics

See [combat.md](combat.md) section 2. The max hit is what Strength buys: 22 at 70,
26 at 90, 27 at 95-99 (measured maxima). Attack 99 keeps the hit rate at
0.85-0.89 against ogres.

## 5. Alternatives considered

- **Fire giants** (111 HP): 8.47 against 8.99 for ogres at the same levels
  (measured, 300 ms), and 3-5 times the damage taken.
- **Moss giants, lesser demons:** 7.91 and 8.12 (100 ms).
- **The troll camps** are off the route or lethal. All in combat.md section 1.
- **Without potions and prayers:** 7.58 at Strength 95-97 against 10.08 (100 ms and
  300 ms samples), a 25% loss.

## 6. Gotchas

See combat.md section 8. Strength is the skill where the potion boost matters most,
because it is the max hit: re-drink super strength at half boost. Drinking is free
if the attack is re-sent on the next tick.

## 7. Helper supply list

For the no-MM block, Strength 83 -> 99 (2,901 ticks, inferred):

| Item | Count | Source |
|---|---|---|
| Prayer potion (4) | 17 | Herblore or GE |
| Super strength (4) | 2 | Herblore or GE |
| Super attack (4) | 2 | Herblore or GE |
| Shark | 6 | Fishing or GE |

One inventory, no resupply. With MM option 1 and Waterfall: nothing.

## 8. Open questions

- Production latency on the re-attack after drinks and kills (combat.md section 9).
- Whether Waterfall stays (rs/56): without it, MM option 1 leaves 522 ticks of
  Strength.
