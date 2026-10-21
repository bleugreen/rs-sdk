# Defence: fastest route to 99

Shared measurement, mechanics and gear: [combat.md](combat.md). Scripts:
[`combat-rate.ts`](../scripts/combat-rate.ts), [`combat-model.ts`](../scripts/combat-model.ts).
Labels follow `docs/speedrun/skills/README.md` (rs/2). Host: the ogre rates are combat.md's
and the spider rates ranged.md's, all taken at 300 ms on the Mac executor `local` at load
11-18 on 16 cores, so they are **busy-host figures, a few percent pessimistic**.

## 1. Recommendation

**On the route (rs/3's Package B), Defence needs only 1,288 base after the quests.**
Monkey Madness option 1 gives 20,000 and Dragon Slayer (after MM) 18,650: 38,650, level 98
(read). The pre-MM fights are cast, so Defence stays at 1 until MM. Close the 1,288 with
**defensive melee beside the cannon at the Wilderness poison spiders: 230 ticks** at 5.60
Defence per tick (rs/31's plan (e), `ranged.md`; inferred from measured rates). Those ticks
are part of the Ranged finish, not extra: the cannon earns 11.03 Ranged per tick over them
(Ranged 54 -> 67), then the finish continues with cannon + rapid knives. Ogres alone would
close the gap in about 140 ticks (1,288 / 9.18) but give up the cannon's Ranged.

Under the alternatives (Package A, no Dragon Slayer) the gap was 19,938 base from MM option
1's 20,000, and Defence was the main melee line. Two ways to close a gap that size:

- **While Ranged is still training, run defensive melee alongside the dwarf
  multicannon at the Wilderness poison spiders.** rs/31 measured 5.60 Defence + 1.85
  HP + 11.03 Ranged per tick, which finishes Ranged, Defence and HP in 3,520 ticks
  against 4,197 sequentially (`ranged.md` section 1, cairn://p/rs/31).
- **Otherwise, defensive style at the ogres west of Yanille** with Attack and
  Strength 99: **9.34 base Defence xp per tick at 85-91 and 9.18 at 95-98**
  (measured, 300 ms). Defence does not change the rate, because it only affects
  damage taken: 9.16 at Defence 1 -> 74 (100 ms).

| Start | Ticks to 99 on ogres | HP earned | Basis |
|---|---|---|---|
| **On route: Package B, MM option 1 + Dragon Slayer (38,650, level 98)** | **140** on ogres; on the route, **230** at the spiders alongside the cannon (shared with Ranged) | about 426 either way (a third of 1,288; 1.85 HP per tick at the spiders); the HP gap is covered by the Ranged finish anyway | inferred |
| Package A: MM option 1 alone (20,000, level 89) | 2,121 | 6,646, more than MM's 4,938 HP gap | inferred |
| With MM option 2 (35,000, level 97) | 525 | 1,646 | inferred |
| No MM (0) | **4,248** | 13,313 | inferred |
| Level 1 | **4,248** | 13,313 | inferred |

## 2. Route by level band

| Band | Method | Location | Unlock | Base xp per damage | Ticks per swing | Hit rate | Base xp per tick | Ticks for band |
|---|---|---|---|---|---|---|---|---|
| 1-40 | Ogres, defensive, Attack/Strength 99 | (2496-2503, 3089-3097) | none | 4 (read) | 4 | 0.86 | **9.16 measured (1-74, 100 ms)** | 67 |
| 40-70 | same | same | | 4 | 4 | 0.86 | 9.42 measured (40-76, 100 ms) | 500 |
| 70-85 | same | same | | 4 | 4 | | 9.40 (model) | 1,042 |
| 85-93 | same | same | | 4 | 4 | 0.87 | **9.34 measured (85-91, 300 ms)** | 1,194 |
| 93-99 | same | same | | 4 | 4 | 0.89 | **9.18 measured (95-98, 300 ms)** | 1,446 |

## 3. Quest xp

| Quest | Defence (base, read) | Start level | Scenario |
|---|---|---|---|
| Monkey Madness option 1 | 20,000 (`mm_daero.rs2:296`) | 89 | **on route** |
| Dragon Slayer, after MM | 18,650 (`quest_dragon.rs2:34`) | 88 alone; **98 with MM option 1 (38,650; 1,288 left)** | **on route** (Package B) |
| Monkey Madness option 2 | 35,000 (`mm_daero.rs2:305`) | 97 | alternative |
| Holy Grail (off route) | 15,300 (`quest_grail.rs2:117`) | 85; with MM option 1, 4,638 left | |

Nothing before MM gives Defence on Package B: the pre-MM fights are cast (rs/3
`pre_mm_fights.md`), and the Package B filler quests give no combat xp.

## 4. Mechanics

See [combat.md](combat.md) section 2. Defensive style adds +3 to effective Defence
only, so the offence is that of accurate or aggressive without the style bonus: the
max hit at 99/99 is 26 (measured). Super defence is not needed, because Defence
level does not change the xp rate.

## 5. Alternatives considered

- **Longrange Ranged** splits xp between Ranged and Defence (`combat.rs2:157-159`);
  rs/31 costs it in `ranged.md`.
- **Cannon + defensive melee at the spiders:** above, from rs/31.
- **Controlled melee** gives only a third of the xp to Defence (combat.md section 4).
- **Interleaving** (`interleaving.md` section 8): none of it can be absorbed into self-only
  time. Defence is trained by melee at a fixed site, which is itself self-only time, and on
  the route its 230 ticks already share the cannon's clock with Ranged.

## 6. Gotchas

See combat.md section 8. At low Defence, ogres still hit rarely and for at most 5:
60 HP taken in 800 ticks at Defence 1-74 (measured, 100 ms).

## 7. Helper supply list

On the route (Package B) Defence has no list of its own: its 230 ticks run inside the cannon
finish, whose supplies are in `ranged.md` section 7. For Package A, Defence 89 -> 99 on ogres
(2,121 ticks, inferred):

| Item | Count | Source |
|---|---|---|
| Prayer potion (4) | 12 | Herblore or GE |
| Super attack (4) | 2 | Herblore or GE |
| Super strength (4) | 2 | Herblore or GE |
| Shark | 4 | Fishing or GE |

One inventory of 20 slots, no resupply. No-MM Defence 1 -> 99 (4,248 ticks): 25
prayer potions, 3 super attack, 3 super strength, 6 sharks, about 2 inventories (one
adjacent-helper trade, 9 ticks).

## 8. Open questions

- The parallel cannon plan depends on Wilderness safety on production (rs/31).
- Monkey Madness at Defence 1, Strength 1 and ~42 HP is unmeasured (combat.md section 9).
- Production latency (combat.md section 9).
