# Hitpoints: fastest route to 99

Shared measurement, mechanics and gear: [combat.md](combat.md). Scripts:
[`combat-rate.ts`](../scripts/combat-rate.ts), [`combat-model.ts`](../scripts/combat-model.ts).
Labels follow `docs/speedrun/skills/README.md` (rs/2).

## 1. Recommendation

Hitpoints is never trained on its own. Every point of combat damage gives 1.33 base
HP xp on top of the 4 to the style's skill (melee and Ranged alike,
`combat.rs2:143-167`), so **HP = a third of combat xp** (measured share 0.331 in
every sample). Plan it as a by-product:

- **With MM option 1:** MM gives 35,000, and the 4,938 gap is covered by the
  Defence training's 6,646 HP (2,121 ticks on ogres) or by Ranged combat. **0 extra
  ticks.**
- **No MM:** Strength 83 -> 99 and Defence 1 -> 99 earn 22,042 HP, leaving
  **17,857**. Ranged 1 -> 99 trained by combat earns about 13,300 of it. The last
  about 4,550 cost about 1,450 ticks of melee on a capped skill (3.14 HP per tick,
  inferred). On melee alone, the 17,857 is **about 5,683 ticks**.
- **From level 10 with nothing else:** about 12,700 ticks of melee (inferred).
  Nobody should do this.

## 2. Route by level band

| Band | Method | Location | Unlock | Base HP xp per damage | Ticks per swing | Base HP xp per tick | Ticks for band |
|---|---|---|---|---|---|---|---|
| 10-99 | Any combat; on its own, ogres on accurate with Attack capped | (2496-2503, 3089-3097) | none | 1.33 (read) | 4 | 2.51 at Strength 70-82, 2.98 at 90-95, 3.34 at 95-99, 3.04-3.09 on defensive (measured, 300 ms) | about 12,700 alone (inferred) |

## 3. Quest xp

| Quest | Hitpoints (base, read) |
|---|---|
| Monkey Madness option 1 / 2 | 35,000 / 20,000 (`mm_daero.rs2:298,307`) |
| The Fremennik Trials (off route) | 2,812.4 (`quest_viking.rs2:138`) |

An account starts at level 10 (39.2 base).

## 4. Mechanics

`stat_advance(hitpoints, scale(multiplier, 1000, scale(133, 100, damage*10)))`
(`combat.rs2:167`): 1.33 base per damage, on the damage capped at the NPC's
remaining hp. NPC combat-xp multipliers only reduce it (`combat.param:164-167`).

## 5. Alternatives considered

- **Black Knight Titan** gives exactly 1 xp per hit and 1.33 HP (`combat.rs2:92-117`);
  it is a quest boss, not a training target.
- **Magic:** combat spells also give 1.33 HP per damage. Not costed here.

## 6. Gotchas

Train the skills that feed HP before any HP-only melee, so the HP is free.

## 7. Helper supply list

None of its own: the supplies come with the Strength, Defence and Ranged blocks.
The no-MM melee-only remainder (5,683 ticks) needs 34 prayer potions, 3 super attack,
3 super strength and 10 sharks.

## 8. Open questions

- How much HP Ranged training actually yields on rs/31's chosen method (the cannon's
  hits; see `ranged.md`). That decides the no-MM remainder.
