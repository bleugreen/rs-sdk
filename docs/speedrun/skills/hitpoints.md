# Hitpoints: fastest route to 99

Shared measurement, mechanics and gear: [combat.md](combat.md). Scripts:
[`combat-rate.ts`](../scripts/combat-rate.ts), [`combat-model.ts`](../scripts/combat-model.ts).
Labels follow `docs/speedrun/skills/README.md` (rs/2). Host: the measured rates are
combat.md's and ranged.md's, taken at 300 ms on the Mac executor `local` at load 11-18 on 16
cores, so they are **busy-host figures, a few percent pessimistic**.

## 1. Recommendation

Hitpoints is never trained on its own. Every point of combat damage gives 1.33 base
HP xp on top of the 4 to the style's skill (melee and Ranged alike,
`combat.rs2:143-167`), so **HP = a third of combat xp** (measured share 0.331 in
every sample). Plan it as a by-product:

- **On the route (rs/3's Package B): 0 extra ticks.** The account starts at 39.2 base.
  The pre-MM fights are cast by spell and still give Hitpoints at 1.33 per damage: warlord
  226 (measured), demon 209 (measured), Fight Arena ~287 (inferred), about 722, so about
  42 HP at Monkey Madness (rs/3 `pre_mm_fights.md`). MM option 1 adds 35,000: **35,761**
  in all (level 97), a gap of **4,177**. Dragon Slayer and the filler quests give no HP.
  The post-MM cannon finish (cannon + defensive melee, then cannon + rapid knives, 2,051
  ticks) yields about **5,089 HP** as a by-product (rs/31, `ranged.md`; inferred from
  measured rates), which covers the gap. rs/3's README quotes the gap as 4,938 because it
  counts MM alone.
- **Package A (Waterfall on, no Dragon Slayer):** MM gives 35,000, and the 4,938 gap is
  covered by the Defence training's 6,646 HP (2,121 ticks on ogres) or by Ranged combat.
  0 extra ticks.
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
| Monkey Madness option 1 / 2 | 35,000 / 20,000 (`mm_daero.rs2:298,307`); option 1 on route |
| Witch's House (off route: Druidic Ritual took its quest points at 01:20) | 6,325 (`quest_ball.rs2:202`, via rs/3 `quest_points.md`) |
| The Fremennik Trials (off route) | 2,812.4 (`quest_viking.rs2:138`) |

An account starts at level 10 (39.2 base). On the route the pre-MM spell fights add about
722 before MM (measured 226 + 209, inferred ~287; rs/3 `pre_mm_fights.md`), so the on-route
start for the post-MM finish is 35,761 base, level 97.

## 4. Mechanics

`stat_advance(hitpoints, scale(multiplier, 1000, scale(133, 100, damage*10)))`
(`combat.rs2:167`): 1.33 base per damage, on the damage capped at the NPC's
remaining hp. NPC combat-xp multipliers only reduce it (`combat.param:164-167`).

## 5. Alternatives considered

- **Black Knight Titan** gives exactly 1 xp per hit and 1.33 HP (`combat.rs2:92-117`);
  it is a quest boss, not a training target.
- **Magic:** combat spells also give 1.33 HP per damage. On the route this is how the
  pre-MM fights give their ~722 HP (above). Not costed as a training method.
- **Interleaving** (`interleaving.md` section 8): nothing to absorb. Hitpoints is only ever
  a by-product of combat, and combat is location-bound self-only time.

## 6. Gotchas

Train the skills that feed HP before any HP-only melee, so the HP is free.

## 7. Helper supply list

None of its own: the supplies come with the Strength, Defence and Ranged blocks.
The no-MM melee-only remainder (5,683 ticks) needs 34 prayer potions, 3 super attack,
3 super strength and 10 sharks.

## 8. Open questions

- How much HP Ranged training actually yields on rs/31's chosen method (the cannon's
  hits give none; see `ranged.md`). That decides the no-MM remainder. On the route, the
  5,089 by-product against the 4,177 gap leaves about 900 base of margin (inferred).
- Monkey Madness at ~42 HP with Defence 1 is unmeasured (combat.md section 9).
