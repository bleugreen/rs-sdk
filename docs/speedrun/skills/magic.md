# Magic: fastest route to 99

All tick figures are server ticks. Headline cadences were measured on a local engine at
`NODE_TICKRATE=300` (production rate) with the headless lite client; figures marked
"100 ms lab" came from `NODE_TICKRATE=100` exploration runs and agree with the 300 ms runs.
Lab: `docs/speedrun/scripts/magic-lab.sh` (port block WEB 9220, management 9221, hiscores 9222,
node 43920, agent 8120). Scripts: `magic-cadence.ts` (ticks per cast for every candidate),
`magic-bank.ts` (the bank cycle), `magic-route.ts` (the ladder end to end with bank visits),
`magic-strike.ts` (1 -> 7), `magic-boost.ts` (potion-boosted Fire Wave and Charge, the potion's
decay, and the Mage Arena fight at base 71), all under `docs/speedrun/scripts/`.

**Host.** The 300 ms batches ran on the Mac executor `local`, which main measured at load 11-18
on 16 cores that night (cairn://p/rs/main, 00:36). Read the measured tick counts as a **busy
host's figures, a few percent pessimistic**: the bot reacts in wall-clock time, so a slow host
occasionally costs a tick in a bank visit or a re-sip. The 3-tick enchant floor and Charge's 5
per tick are server rules and do not depend on the host. rs/26's bbs correction factor had not
been published when this was written (01:15), so no factor is applied.

## 1. Recommendation

**On the route (rs/3's Package B), enchant only to Magic 59, before Tree Gnome Village.**
Under Package B the pre-MM fights are **cast, not meleed** (rs/3 `pre_mm_fights.md`): Fire
Bolt or Fire Blast from a level-1 melee account kills the Khazard warlord, the black demon and
the Fight Arena monsters as fast as melee at Strength 83, because none of them has magic
defence. Those fights pay about 3,600 base Magic, and The Grand Tree pays 2,150. So the
account reaches the Mage Arena at **base 76-77 without any further enchanting** (timeline
below). From there:

- **Fire Wave needs no potion.** Its gate is boosted 75 (`magic.rs2:22`, read), and base 76
  meets it. Kolodion's start check is `stat_base(magic) >= 60` (read), met.
- **Kolodion is fought at base 76-77**, between the measured base-71-plus-potion fights
  (320-346 ticks) and rs/20's base-80 fights (312-322): about 315-340 ticks (inferred). The
  fight is counted in rs/3's Mage Arena step, not here.
- **The fight leaves base 80-81**, so **Charge needs no potion either**: every yield measured
  at base 71 (2,787-3,129 base) takes 8,251 past 80's 10,686.8. Only the lowest yield ever
  recorded (2,404, rs/3, base 80, 100 ms) would stop at 79 without the teleports' xp. Carry
  **one** magic potion as insurance for that case (inferred).
- **Charge 80/81 -> 99: 156-163 casts at 5 per tick, about 32-33 ticks** (rs/20 measured 163
  casts and 33 ticks from the bottom of 80, 300 ms).

The 57 -> 71 enchant ladder of the earlier plan (52 casts, about 164 ticks) is gone entirely.
What remains is Wind Strike 1 -> 7 and **60 enchant casts, 7 -> 59** (12 sapphire, 27 emerald,
16 ruby, 5 diamond; inferred from the read xp per cast and the level table), all before Tree
Gnome Village.

| Start | Ticks to 99 (Magic training only) | Basis |
|---|---|---|
| **On route (Package B): level 1, enchant to 59 before TGV, fights cast, no potions** | **about 245**: 18 (strike) + about 4 (first withdraw) + 180 (60 casts) + 8 (2 bank visits) + about 33 (Charge from 80-81) | measured parts, 300 ms; timeline inferred (below). The Mage Arena fight is in rs/3's step 10 |
| Package B, enchant only to 51 (the Ardougne teleport gate), magic potions for Fire Wave and Charge | about 195: 18 + 4 + 126 (42 casts) + 4 (1 visit) + about 38 (sip + Charge from 78-80) + about 2 of fight sips | inferred; but the warlord takes Fire Bolt's 165 ticks instead of Fire Blast's 133 (measured, rs/56), so the route as a whole is only about 15 ticks better (section 5) |

### Magic timeline under Package B

Derived here from rs/3's step order (README section 4 and `pre_mm_fights.md` on
cairn://p/rs/3/1/coordinator); rs/80, which is finalising that README, had not published its own
timeline when this was written. Base xp from this server's curve (`Player.ts`,
`levelExperience`: 59 = 2,468.0, 64 = 3,504.9, 67 = 4,322.7, 73 = 6,568.0, 76 = 8,092.7, 77 =
8,675.5, 80 = 10,686.8, 81 = 11,455.6).

| Point on the route | Magic base xp | Level | Basis |
|---|---|---|---|
| End of the enchant ladder, before Plague City | 2,518 | **59** | 4 Wind Strikes + 60 enchants (inferred from the read xp per cast) |
| + Khazard warlord (TGV), Fire Blast | ~3,565 | 64 | +1,047, measured with Fire Bolt at 51 (rs/56, 6 runs); Fire Blast's yield was not logged and is assumed similar (inferred) |
| + black demon (GT) | ~4,561 | 67 | +996, measured with Fire Bolt at 58 (rs/56, 5 runs) |
| + The Grand Tree reward | ~6,711 | 73 | +2,150, read (`quest_grandtree.rs2:201`) |
| + Fight Arena, Fire Blast | ~8,251 | **76** | +~1,540, inferred by rs/56 from 216 hitpoints of monsters |
| + teleport casts before the arena | ~8,850 | 77 | +~600, inferred: about 7 Ardougne (61 base), 2 Varrock (35), 1 Camelot (55.5) and 1 Falador (48) from the rune lists in rs/3's step table (`magic_spells.dbrow`, read). The exact count is open |
| **Mage Arena start** | **8,251-8,850** | **76-77** | |
| After Kolodion, +2,404 to +3,129 | 10,655-11,980 | **80-81** (79 only for the lowest yield without the teleports) | yields measured (section 4; rs/3) |

With the ladder stopped at 51 instead, the same steps give 58 at the demon, 70 at Fight Arena,
**74-75 at the Mage Arena** and 78-80 after the fight (inferred), so Fire Wave needs a sip at
74, and Charge one more.

### The earlier route (pre-MM fights meleed; superseded on the route, measurements stand)

Wind Strike from 1 to 7. Then enchant jewellery at a bank booth: sapphire 7 -> 27, emerald
27 -> 49, ruby 49 -> 57, diamond 57 -> 68, dragonstone 68 -> **71**. Every enchant costs exactly
**3 ticks**, because the spell ends in `p_delay(1)` and the server drops any spell click while
the player is delayed. Bank every 24-26 casts at **4 ticks of overhead** per visit. At base 71,
**fight the Mage Arena with a magic potion** (+4, so Fire Wave's 75 is met), re-sipping at each
of the potion's 100-tick decay steps. The fight leaves the account at base 76-77. **Sip again
and Charge** from there to 99 at 5 casts per tick: Charge needs 80 and the boosted level counts.

| Start | Ticks to 99 (Magic training only) | Basis |
|---|---|---|
| **Level 57 (after The Grand Tree's 2,150 base), boosted route** | **about 205**: about 4 (first withdraw) + 156 (52 casts, 57 -> 71) + 4 (1 bank visit) + 41 (sip, then Charge from 76) | measured parts, 300 ms; plus about 15-35 extra fight ticks (below) |
| **Level 1 (no quest xp), boosted route** | **about 400**: 18 (strike) + about 4 + 321 (107 casts, 7 -> 71) + 16 (4 bank visits) + 41 | measured parts, 300 ms; plus the same fight delta |
| Level 57, Mage Arena at an unboosted 75 | about 280-305 | inferred (section 5), superseded |
| Level 57, Mage Arena at 80 | about 400: about 4 + 364 (57 -> 80) + 33 (Charge) | measured parts, 300 ms |
| Level 1, Mage Arena at 80 | about 600: 18 + about 4 + 546 (7 -> 80) + 33 | measured parts, 300 ms |

The ordering is what saves the ticks. The fight is on the route anyway (it unlocks Charge) and
pays about 3,000 base Magic. Below 80 that xp replaces dragonstone enchanting at 26 base per
tick; above 80 it replaces Charge at 900 base per tick, worth about 3 ticks. Every spell's level
check reads the **boosted** level (`magic.rs2:22`, `stat(magic)`), so a +4 magic potion moves
both gates down by 4: Fire Wave (75) from base 71, Charge (80) from base 76.

**Measured at 300 ms** (`magic-boost.ts`):

- Fire Wave at base 71 is refused. After one sip (75/71) it casts.
- Kolodion at base 71 + potion under Protect from Magic took **328, 320 and 346 ticks**. rs/20
  measured 312, 314 and 322 at 300 ms with base 80 (`mage_arena.md`). Each fight used 3 doses
  (one before the talk, 2 re-sips) and paid 2,787-3,129 base, ending at **base 76, 76 and 77**.
- Charge from base 76 + potion took 180 casts and **41 ticks from the sip to 99**. From 77 it
  took 175 casts and 40 ticks. Both ran 5 casts per tick with no refusal; the boosted level held
  at 80 or 81 while base climbed to meet it.

Compared with the arena at an unboosted 75, the boosted route saves 24 dragonstone casts before
the fight and the 2-10 after it, less 8 ticks of slower Charge. That is about 70-100 ticks.
Base 76 needs 2,379 base from the fight, starting from the bottom of level 71. All four measured yields clear that: three at base
71 and rs/3's lowest at base 80 (2,404).

Charge is the only Magic spell that fires more than once per tick. Every other xp spell sets
a player delay, and the engine refuses spell, loc and inventory clicks while one is pending.
So nothing below 80 can be stacked the way Charge is, and the 1 -> 80 cost is set by casts x 3.

## 2. Route by level band

All at a bank booth (measured at Varrock west bank, booth (3186,3436), player on (3185,3436)).
Wind Strike is anywhere with a weak NPC (measured at the Lumbridge east chicken coop, (3233,3295)).
Ticks per action and xp per tick are measured at 300 ms (`magic-cadence.ts`, 20 casts per spell,
and `magic-route.ts` for the bands as run end to end). Success is 100% for every non-combat spell.

| Band | Method | Unlock | Base xp/cast | Ticks/cast | Base xp/tick | Casts | Ticks for band |
|---|---|---|---|---|---|---|---|
| 1 -> 7 | Wind Strike on chickens | Magic 1 | 5.5 + 2 per damage (7.5 typical) | 5 | about 1.5 | 4 | 16, 20 (measured, 2 runs) |
| 7 -> 27 | Enchant sapphire ring (Lvl-1 Enchant, com 1155) | Magic 7 | 17.5 | 3 | 5.83 | 12 | 36 + banks |
| 27 -> 49 | Enchant emerald ring (Lvl-2, com 1165) | Magic 27 | 37 | 3 | 12.33 | 27 | 81 + banks |
| 49 -> 57 | Enchant ruby ring (Lvl-3, com 1176) | Magic 49 | 59 | 3 | 19.67 | 16 | 48 + banks |
| 57 -> 68 | Enchant diamond ring (Lvl-4, com 1180) | Magic 57 | 67 | 3 | 22.33 | 37-38 | 111-114 + banks |
| 68 -> 80 | Enchant dragonstone ring (Lvl-5, com 1187) | Magic 68 | 78 | 3 | 26.00 | 77-78 | 231-234 + banks |
| **7 -> 80, end to end** | the five enchant bands, 24 rings per inventory | | | | | **170** | **546** (510 casting + 9 bank visits x 4) |
| **57 -> 80, end to end** | diamond, dragonstone, 26 per inventory | | | | | **115** | **364** (345 casting + 19 over 5 visits) |
| 80 -> 99 | Charge (com 1193) | Magic 80, `%magearena >= 8` (Mage Arena) | 180 | 0.2 (5 per tick) | 900 | 163 | **33** (rs/20, `quest-magearena-charge.ts`, 300 ms) |
| **Boosted route** | | | | | | | |
| 68 -> 71 | Enchant dragonstone ring | Magic 68 | 78 | 3 | 26.00 | 14 | 42 + banks |
| **57 -> 71, end to end** | diamond, dragonstone, 26 per inventory | | | | | **52** | **about 164** (156 casting + first withdraw + 1 visit; inferred from the measured cadence and bank cycle) |
| 71 -> 76/77 | Mage Arena fight: Fire Wave (com 1189) at boosted 75, Protect from Magic, re-sip at each decay step | base 60 to start (`kolodion.rs2:6`), boosted 75 for Fire Wave | 42.5 + 2 per damage | 5 (attack delay) | about 8.8 | about 50-58 (inferred from the xp) | **320-346** (3 runs, mean 331), +2,787-3,129 base (measured, 300 ms) |
| 76/77 -> 99 | Charge after a magic-potion sip | **boosted** 80, `%magearena >= 8` | 180 | 0.2 (5 per tick) | 900 | 175-180 | **40-41 from the sip** (4 ticks of sip delay + 36-37 casting; measured, 300 ms) |
| **Package B route (on route)** | | | | | | | |
| 1 -> 7 | Wind Strike on chickens | Magic 1 | 7.5 typical | 5 | about 1.5 | 4 | 16-20 (measured) |
| 7 -> 59 | Enchant sapphire 12, emerald 27, ruby 16, diamond 5, before Tree Gnome Village | Magic 7 / 27 / 49 / 57 | 17.5-67 | 3 | 5.8-22.3 | **60** | **about 192** (180 casting + first withdraw + 2 bank visits; inferred from the measured cadence and bank cycle) |
| 59 -> 76/77 | The pre-MM fights by spell, The Grand Tree's reward, teleports | Fire Bolt 35, Fire Blast 59 | | | | | 0 Magic-training ticks: counted in rs/3's quest steps (timeline in section 1) |
| 76/77 -> 80/81 | Mage Arena fight, Fire Wave, no potion | base 60, boosted 75 | | | | | 0 here: rs/3's step 10 (about 315-340, inferred) |
| 80/81 -> 99 | Charge, no sip | 80, `%magearena >= 8` | 180 | 0.2 | 900 | 156-163 | **about 32-33** (rs/20 measured 33 from 80, 300 ms) |

"Ticks for band" counts the span from the first cast to the tick the next action can land.
The last cast's delay is included. The end-to-end figures are measured
(`magic-route.ts`, `NODE_TICKRATE=300`). From 7 the run took 170 casts and 546 ticks, with 160
gaps of 3 ticks and 9 bank gaps of 7. From 57 it took 115 casts and 364 ticks, with 109 gaps of 3
and bank gaps of 5, 7, 7, 7 and 8. Neither figure includes the first bank withdraw before the
first cast (about 4 ticks, inferred from the bank cycle).

Enchanting an amulet gives the same xp as the ring (same spell row,
`magic_spells.dbrow:8-60`). Rings need no stringing, so they cost helpers one Crafting step fewer.

## 3. Quest xp

| Quest | Base Magic | Source | On route? |
|---|---|---|---|
| The Grand Tree | 2,150 | `quest_grandtree.rs2:201` (`stat_advance(magic, 21500)`) | yes (rs/3) |
| Pre-MM fights by spell (not quest rewards) | about 3,583: Khazard warlord 1,047 (measured, Fire Bolt), black demon 996 (measured, Fire Bolt), Fight Arena about 1,540 (inferred) | rs/3 `pre_mm_fights.md` section 1 (rs/56, 300 ms); 2 base per damage + 22.5 (Fire Bolt) or 34.5 (Fire Blast) per cast, `magic_combat_spells.dbrow` | **yes**, Package B |
| Teleport casts on the way | Ardougne 61, Camelot 55.5, Falador 48, Varrock 35 per cast; about 600 before the arena (inferred count) | `magic_spells.dbrow` (read) | yes |
| Watchtower | 15,300 | `quest_itwatchtower.rs2:533` | off route (rs/3 README section 5: worth at most ~510 against ~1,100) |
| Horror from the Deep | 4,662 (and 4,662 each in Strength and Ranged) | `quest_horror.rs2:491-493` | skipped (`horror_from_the_deep.md`) |
| Imp Catcher | 875 | `quest_imp.rs2:4` | no: not in Package B's filler (Goblin Diplomacy, Romeo & Juliet, Cook's Assistant, Druidic Ritual) |
| Witch's Potion | 325 | `quest_hetty.rs2:11` | no, as above |
| Mage Arena fight (not a quest reward) | about 2,400-3,050 from casting | `mage_arena.md` (measured 3,044 and 2,404) | yes, it unlocks Charge |

- **On the route (Package B)** the Grand Tree's 2,150 lands on top of the enchant ladder and
  the first two fights, at base ~4,561, taking the account from 67 to 73 (section 1). The
  bullets below are the earlier, fights-meleed accounting.
- **The Grand Tree alone**: 2,150 base is level **57** (57 starts at 2,143.7 base). That is
  exactly the diamond unlock, so the route from there is diamond -> dragonstone to 71 -> the
  Mage Arena with a magic potion -> Charge, about **205 ticks** of Magic training (section 1;
  about 400 with the arena at 80). The quest itself uses the Varrock teleport (Magic 25) and the
  Ardougne teleport (Magic 51, after Plague City) for its fastest legs (`grand_tree.md`).
  If the plan wants those teleports during the quest, the account needs Magic 51 first. That
  costs 1 -> 51 at about 160 ticks (inferred: Wind Strike 18, then 12 sapphire + 27 emerald + 4 ruby
  casts = 129 ticks, plus the first withdraw and 2 bank visits). The quest's xp then lands at
  1,401 + 2,150 = 3,551 base, level 64, so the ticks are not lost; they are moved.
- **Grand Tree + Watchtower** (17,450 base) would start at level **87**, with no enchanting at
  all: Charge 87 -> 99 is 125 casts, 25 ticks (inferred from rs/20's 5 casts per tick).
- **Imp Catcher + Witch's Potion** (1,200 base) give level 47 from scratch. That is worth about
  450 ticks of casting from level 1, but nothing on top of Grand Tree beyond about 18 dragonstone
  casts (54 ticks). They pay for themselves only if they are cheaper than that
  (`quest_points.md`: about 107 + 140 ticks).

## 4. Mechanics

**Why 3 ticks per cast and never more than one cast per window (read, then measured).**

- Enchant, Superheat and Low Alchemy end with `p_delay(1)`; High Alchemy with `p_delay(3)`
  (`enchant.rs2:53`, `superheat.rs2:67`, `alchemy.rs2:69,37`). `P_DELAY` sets
  `delayedUntil = currentTick + 1 + n` (`PlayerOps.ts:376-380`).
- The world decodes client packets (`processClientsIn`) before it clears expired delays
  (`processPlayers`, `World.ts:776`). `OpHeldTHandler` returns without acting while
  `player.delayed` is set (`OpHeldTHandler.ts`, the first check). So a cast at tick T blocks
  clicks at T+1 and T+2, and the next cast lands at T+3: n+2 ticks.
- Measured: 20 casts each at 1, 2 and 5 clicks per tick on different inventory slots. Every
  configuration gave one cast per 3 ticks (19 of 19 gaps of 3 at 5 clicks per tick, 100 ms lab;
  300 ms with 2 clicks per tick in the table below). Extra clicks are dropped harmlessly, so a
  bot should send one or two clicks every tick and never wait for the xp.
- Charge has no delay at all (`charge.rs2`). IF_BUTTON is decoded up to 5 per tick
  (`ClientGameProtCategory.ts:6`). Hence 5 casts per tick (rs/20).

**Measured cadence of every candidate, 300 ms, 2 clicks per tick, 20 casts each**
(`magic-cadence.ts all 20 2`; the 100 ms lab gave the same ticks per cast):

| Spell | Level | Base xp | Ticks/cast | Base xp/tick | Gaps (ticks: count) |
|---|---|---|---|---|---|
| Lvl-1 Enchant (sapphire) | 7 | 17.5 | 3.11 | 5.64 | 3: 18, 5: 1 |
| Low Alchemy | 21 | 31 | 3.00 | 10.33 | 3: 19 |
| Varrock Teleport | 25 | 35 | 4.00 | 8.75 | 4: 19 |
| Lvl-2 Enchant (emerald) | 27 | 37 | 3.05 | 12.12 | 3: 18, 4: 1 |
| Superheat Item (gold ore) | 43 | 53 | 3.00 | 17.67 | 3: 19 |
| Camelot Teleport | 45 | 55.5 | 4.00 | 13.88 | 4: 19 |
| Lvl-3 Enchant (ruby) | 49 | 59 | 3.05 | 19.33 | 3: 18, 4: 1 |
| High Alchemy | 55 | 65 | 5.00 | 13.00 | 5: 19 |
| Lvl-4 Enchant (diamond) | 57 | 67 | 3.00 | 22.33 | 3: 19 |
| Lvl-5 Enchant (dragonstone) | 68 | 78 | 3.00 | 26.00 | 3: 19 |
| Charge (rs/20) | 80 | 180 | 0.2 | 900 | 5 per tick |

The odd 4- and 5-tick gaps are the bot missing a tick, not the server: the 3-tick floor held
in every run where the bot kept a click queued. Teleports take 4 ticks: `p_delay(1)` then
`p_delay(0)` before the jump (`teleport.rs2:61,65`), and `p_finduid` refuses the button while
the player is busy.

**Level-up boxes do not stall enchanting.** `OpHeldTHandler` calls `clearPendingAction`, which
closes the chat modal before the spell runs. Every run crossed several levels without dismissing
anything.

**The bank cycle** (`magic-bank.ts`, dragonstone, 3 bank visits each):

- The booth's Bank/Use-quickly click is also dropped while the last cast's delay holds
  (`OpLocHandler.ts`), so the earliest open is the tick a cast would have landed.
- The visit is open, then deposit-all of the product (one INV_BUTTON), withdraw-all of the next
  stack (one INV_BUTTON) and close (CLOSE_MODAL), all in one tick, then cast. The spell needs
  the magic tab visible, and the bank's side panel replaces it until the bank is closed.

| Client | Last cast -> first cast of next inventory | Overhead per visit | Basis |
|---|---|---|---|
| Stock SDK (`bot.openBank`, `depositItem`, `withdrawItem`, `closeBank`) | 20, 11, 20 | **8-17, mean 14** | measured, 300 ms |
| Tick-driven script, withdraw sent blind the tick the bank opens | 7, 7, 7 (and 7 x 9 in the 7 -> 80 run) | **4** | measured, 300 ms |
| Packet floor: open at T+3, deposit+withdraw+close at T+4, cast at T+5 | 5 | 2 | inferred; one 5-gap seen in the 57 -> 80 run |
| Floor with a client that sends the next OPHELDT in the same tick as the withdraw (the server has the item by then; the lite client refuses because its own inventory is not updated yet) | 4 | 1 | inferred |

The stock helper's first booth click usually lands inside the delay and is dropped. It then
waits for its own timeout, and that wait is most of the stock overhead. With the stock SDK the
7 -> 80 ladder is about 510 + 9 x 14 = **about 636 ticks** (inferred). At the packet floor it
is 510 + 9 x 2 = **about 528**.

**Boosts (read, then measured with `magic-boost.ts` at 300 ms).**

- **Gates read the boosted level.** `~check_spell_requirements` tests `stat(magic)`
  (`magic.rs2:22`). Charge calls it after the `%magearena` check (`charge.rs2:4-15`). The client
  lights the icons the same way. Fire Wave tests `stat_level,magic > 74` and Charge
  `> 79` (`magic.if`). `stat_level` is opcode 1, `statEffectiveLevel` (`PackShared.ts`,
  `Client.ts`), so the spells are not greyed out when boosted (read; the lite client draws no UI).
- **Magic potion: +4 flat** (`consume_effects.dbrow:337-343`). `stat_boost` caps at base + boost
  (`PlayerOps.ts`, `STAT_BOOST`), so a second sip only restores, never stacks. A potion has no
  eat delay and adds nothing to the attack clock (`consume.rs2:97-107`). But it does run
  **`p_delay(1)`** (`consume_messages.dbrow:766-773`, `consume_effects.rs2:123-126`), and a
  delayed player's OPNPCT is dropped (`OpNpcTHandler.ts`) and Charge's `p_finduid` fails.
  Measured: the first Charge lands **4 ticks after the sip is sent**. A single Fire Wave click
  sent 1 tick after a sip got no response.
- **Decay: 1 point per 100 ticks.** The `stat_boost_restore` soft timer runs every 100 ticks
  from login (`login.rs2:36`, `stat.rs2:45-56`). Measured after a sip at base 71: first drop
  77 ticks later, then 100, 100, 100. So the first drop comes 1-100 ticks after any sip,
  depending on where the login clock is.
- **A level-up does not move a boosted level.** `addXp` only raises the current level when it
  equals the base (`Player.ts:1898-1910`). Measured during Charge: 80/76, 80/77, 80/78, 80/79,
  81/81. So the boost shrinks from below as base rises, and once base passes the boosted level
  the two move together.
- **Wizard's mind bomb: +2 + 2%** with Attack, Strength and Defence drains
  (`consume_effects.dbrow:72-78`). That is +3 at bases 70-72 (`(2 + 1.4..1.44) | 0`). It is an
  alcoholic drink, so it costs 3 ticks of `%action_delay` (`consume.rs2:13`). Measured: base 70
  + potion + mind bomb is 74 in either order, and Fire Wave is refused. Base 71 + mind bomb is
  74, refused. Base 72 + mind bomb is 75 and casts.
- **Kolodion at base 71 + potion** (3 runs, Prayer 80, staff of fire, Fire Wave clicked every
  2 ticks, re-sip on the tick after a cast lands once the boost is below 75): fights of 328,
  320 and 346 ticks. Forms took 14-29 (human), 37-77 (ogre), 52-70 (spider), 52-63 (ethereal)
  and 84-154 (demon) ticks. Prayer went 80 -> 18-26, so 54-62 points against Holy Grail's 80.
  There was 1 refused Fire Wave in 3 runs (a decay step landed between a cast and the re-sip).
  Boost trace from run 1, in ticks after the arena teleport: 75/71 at the start; a decay step
  to 74 at +16, then a re-sip; another to 74/72 at +114, then a re-sip to 76; a step to 75/74
  at +214, still enough; base reached the boosted 76 at +278, with no further sip needed.

**1 -> 7.** Wind Strike: 5.5 base on the cast (`player_magic.rs2:170`) plus 2 base per damage
point (`combat.rs2`, `style_magic_normal`). The spell attack delay is 5 ticks
(`player_magic.rs2:188`). Measured 4 casts, 16 and 20 ticks (`magic-strike.ts`, 300 ms).

## 5. Alternatives considered

- **Mage Arena at an unboosted 75 (the previous recommendation, superseded by the boosted
  route).** From 57: diamond to 68 (38 casts), dragonstone to 75 (38 casts), about 2 bank visits
  and the first withdraw. That is about 240 ticks. The fight's about 3,000 base takes 75 (7,549
  base) to about 10,550, so 2 more dragonstone casts reach 80; after a low 2,404 fight it would
  take 10. That is 6-30 ticks. Then Charge 33. Total about 280-305. The fight itself runs at the
  same effective level 75 as the boosted route, so it costs the same as the measured 320-346
  (inferred). It needs no potions.
- **Mage Arena at 80**: the fight measured 312-322 at 300 ms (rs/20), about 15-30 ticks faster
  than at base 71 + potion. It costs about 115 more enchant casts, so it loses by about 200.
- **Wizard's mind bomb instead of the magic potion**: +3, so Fire Wave from base 72 (measured).
  That is one level later, about 5 more dragonstone casts. It adds 3 ticks of attack delay per
  drink and drains Attack, Strength and Defence (harmless under the prayer). It never stacks
  with the potion (measured), and +3 cannot reach Charge before base 77. Use it only if no magic
  potion is available: the mind bomb is sold in shops (`burthorpe.inv`, `viking.inv`) and
  needs no Herblore.
- **A lower spell at a lower base** (Fire Blast, 59): the fight is slower (`mage_arena.md`, inferred)
  and the xp per cast lower, so it trades enchant casts for fight ticks at a worse rate. Not
  measured.
- **Diamond only, 57 -> 80** (if dragonstones are scarce): 128 casts at 67 base instead of 38
  diamond + 77 dragonstone. That is +13 casts, about +39 ticks, plus about 1 more bank visit
  (inferred).
- **Superheat 43 -> 49 instead of emerald**: 9 casts instead of 12, about 9 ticks saved. It adds
  a nature-rune slot (staff of fire, or 4 fire runes per cast), ore stock and a Smithing level
  requirement, and pays Smithing xp too: per 3-tick cast, iron 12.5, gold 22.5, gold with
  goldsmithing gauntlets 56.25 base (`smelting.struct`, `superheat.rs2:56-60`). Measured cadence
  3.00 ticks per cast at 300 ms. Worth it only if the Smithing route wants those casts (sent
  to the Smithing child via the coordinator).
- **Low Alchemy 21 -> 27 instead of sapphire**: 4 casts instead of 6, about 6 ticks saved, at
  the cost of nature runes, an alch item stack and a fire staff. Not worth a separate band.
- **High Alchemy**: 5 ticks per cast, 13 base per tick (measured). It loses to every enchant tier
  from emerald up.
- **Teleports**: 4 ticks per cast (measured). Camelot 13.9 base per tick at 45 loses to
  superheat (17.7) and ruby (19.7). Trollheim and Watchtower teleports (68 base, 17 per tick,
  read) need quests and lose to diamond (22.3).
- **Charge Orb** (air orb 76 base at 66): `p_delay(2)` makes it 4 ticks, 19 base per tick, and it
  must be cast on an obelisk (`charge_orb.rs2:44`). It loses to diamond (read, inferred).
- **Bones to Bananas** (25 base, `p_delay(2)`, 4 ticks) and **Telekinetic Grab** (43 base,
  `p_delay(2)` + `p_delay(1)`): lose (read).
- **Combat spells and curses**: 5-tick action delay (`player_magic.rs2:188`). At best the cast xp
  plus 2 per damage, for example Fire Blast at most 34.5 + 32 = 66.5 per 5 ticks, 13.3 per tick.
  This revision has no multi-target spells (no Ancient Magicks in
  `magic_combat_spells.dbrow`), so a multi-combat area adds nothing. Only useful for 1 -> 7.
- **Several casts per tick on different items**: impossible before Charge (section 4,
  measured).
- **Trading jewellery from a helper each inventory instead of banking**: an adjacent-helper trade
  is 9 ticks (5 with the rs/22 fix, `primitives.md` section 6), against a 4-tick bank visit.
  Banking wins.

## 6. Gotchas

- **Never wait for the xp before the next click.** Send a click (two is safer) every tick. A
  dropped click costs nothing; a late one costs a whole tick.
- **Booth clicks inside the delay are dropped.** The stock `bot.openBank()` then sits out its
  timeout (the measured stock overhead of 8-17 ticks). Re-click every tick until the bank opens.
- **The SDK publishes the bank's contents 1-2 ticks after the bank opens.** Withdraw by the
  known slot instead of waiting for `getBankItems()`. Keep one spare inventory of each tier in
  the bank so no stack empties; an emptied slot makes the bank reorganise on close
  (`bank.rs2:25-35`) and the slots shift.
- **Close the bank before casting**: OPHELDT needs the magic spell component visible, and the
  bank's side panel hides it.
- **Band changes leave unconverted items** of the old tier in the inventory. Deposit them with
  the products; one deposit-all per item type.
- **A potion sip delays you 2 ticks.** Spell clicks are dropped until 4 ticks after the sip is
  sent. In the fight, sip on the tick after a Fire Wave lands, inside its 5-tick attack delay.
  Before Charge, sip while something else is waiting anyway (inferred: the boost holds up to 100
  ticks).
- **Re-sip at every decay step while the boost is all that meets the gate.** At base 71 the
  first decay step drops 75 to 74 and Fire Wave is refused. At base 76 it drops 80 to 79 and
  Charge is refused (measured, then cast again after the re-sip). The step is every 100 ticks on
  the login clock, so a bot learns its phase from the first drop.
- **Do not sip before Kolodion's talk and then click at once**: the talk click is dropped while
  delayed. Sip, then talk 2 ticks later (what `magic-boost.ts` timed: 40-41 ticks, against
  rs/20's 39).
- Level-up boxes need no handling while enchanting (section 4). Wind Strike does not close them;
  `magic-strike.ts` dismisses them.
- Wind Strike kills chickens in one or two casts; retarget at once.
- Lab only: a fresh lab account starts on Tutorial Island, and debugprocs need the `~` prefix
  (`::~clearinv inv`, `::~clearbank`; `NODE_DEBUGPROC_CHAR`, `WorldConfig.ts`).

## 7. Helper supply list

Counts are the casts `magic-route.ts` planned and completed. Add a spare inventory per tier only
if the bank-slot trick above is used (the spares come back).

**From level 1, Mage Arena at 80**

| Item | Quantity | Used for | Where helpers get it |
|---|---|---|---|
| Air rune, mind rune | 4 each | Wind Strike 1 -> 7 | Aubury, Varrock (`varrock.inv:49-50`); Magic Guild shop (`magic_guild.inv`) |
| Staff of water | 1 | removes water runes from Lvl-1 and Lvl-5 Enchant | Zaff, Varrock (`varrock.inv:137`); Magic Guild |
| Sapphire ring | 12 | 7 -> 27 | helper Crafting 20: gold bar + cut sapphire + ring mould at a furnace (`jewellery.struct`); GE |
| Emerald ring | 27 | 27 -> 49 | Crafting 27; GE |
| Ruby ring | 16 | 49 -> 57 | Crafting 34; GE |
| Diamond ring | 37 | 57 -> 68 | Crafting 43; GE |
| Dragonstone ring | 78 | 68 -> 80 | Crafting 55; uncut dragonstones from the GE or drops (no shop sells them) |
| Cosmic rune | 170 | 1 per enchant | GE, or helper Runecraft at the cosmic altar (Zanaris, Lost City). The only shop is the Mage Arena rune shop, 20 in stock, deep wilderness (`mage_arena.inv:19`) |
| Air rune | 81 | emerald (3 per cast) | rune shops |
| Fire rune | 80 | ruby (5 per cast) | rune shops |
| Earth rune | 1,540 | diamond 10 x 37 + dragonstone 15 x 78 | Aubury (2,000 stock), Magic Guild (3,000) |
| Staff of fire (or air) | 1 | Charge; also the arena fight (`mage_arena.md`) | Zaff; Magic Guild |
| Blood rune | 489 | Charge, 163 casts | Magic Guild (1,000 stock, `magic_guild.inv:29`); GE |
| Air rune | 489 | Charge (none with a staff of air) | rune shops |
| Fire rune | 489 | Charge (none with a staff of fire) | rune shops |

Add the Mage Arena fight's own runes from `mage_arena.md` (about 70 blood and 400 air for Fire
Wave, with a staff of fire).

**Boosted route (recommended), from level 57 (after The Grand Tree)**

| Item | Quantity | Used for | Where helpers get it |
|---|---|---|---|
| Diamond ring | 38 | 57 -> 68 | Crafting 43; GE |
| Dragonstone ring | 14 | 68 -> 71 | Crafting 55 |
| Cosmic rune | 52 | 1 per enchant | as above |
| Earth rune | 590 | diamond 10 x 38 + dragonstone 15 x 14 | as above |
| Staff of water | 1 | enchanting | as above |
| **Magic potion** | **2 potions (3 doses each)**: 3 doses measured for the fight + 1 for Charge, plus 1-2 spare for a badly phased decay step | Fire Wave at base 71, Charge at base 76-77 | **No shop sells it** (no `.inv` lists `*dose1magic`). Helper Herblore **76**: lantadyme potion (unf) + potato cactus makes a 3-dose potion, 172.5 base Herblore (`brew_potion.struct:278-284`); or the GE. Members item |
| Staff of fire | 1 | the fight and Charge | as above |
| Blood rune, air rune | about 70 and 400 | the fight (`mage_arena.md`) | as above |
| Blood rune, air rune | 540 each | Charge, 177-180 casts from base 76 (522 from 77) | as above |

From level 1 the boosted route adds 4 air and mind runes (Wind Strike), sapphire 12, emerald 27
and ruby 16 rings, 55 more cosmic runes (107 in all), 81 air (emerald) and 80 fire (ruby). The
diamond, dragonstone, earth and Charge figures are as above.

**From level 57 (after The Grand Tree)**: diamond rings 38, dragonstone rings 77, cosmic 115,
earth 1,535 (380 + 1,155), staff of water. Charge as above. **With the arena at 75**: diamond
38, dragonstone about 40-48, cosmic about 78-86, earth about 980-1,100.

**Hand-off.** Helpers trade the jewellery **noted** (one stack per tier) together with the
runes and staves in one trade: about 9 stacks. The scored account deposits the noted stacks at
the booth it trains at; they bank as unnoted items. The cost is one trade (stock 56 ticks;
adjacent helper 9, or 5 with the rs/22 fix) plus one deposit pass (about 2 ticks per stack
stock, floor about 1 tick). Bank visits during training: 9 from level 1 (24 per inventory,
with 4 rune slots), 5 from 57 (26 per inventory).

## 8. Open questions

- **Where the Charge sip goes.** Measured, the sip costs about 3 ticks before the first Charge
  (4-tick gap). Charge has no location check (`charge.rs2`), so it can be cast in the chamber
  right after the guardian sets `%magearena = 8`. A sip taken during the chamber walk (rs/20's
  pool, statue and guardian, 74 ticks) would hide the delay if no decay step falls between the
  sip and the casts. Inferred, not measured; it belongs to the Mage Arena run (rs/3).
- **Fight yield below 76.** Base 76 from the bottom of 71 needs 2,379 base from the fight. The
  three base-71 fights paid 2,787-3,129, and the lowest ever measured is 2,404 (rs/3, base 80,
  100 ms). If a fight falls short, one or two dragonstone casts, or a sip and a Charge at base
  76 later, close the gap. The fight's xp is mostly per cast (42.5 base each), and a less
  accurate fight casts more, so a short yield is unlikely (inferred).
- **Magic potion supply.** Helper Herblore 76 (or the GE) is the only source. The Herblore plan
  should confirm it reaches 76 before the scored account's arena trip. Without it, the mind
  bomb (+3, shops) gives Fire Wave at base 72, about 5 more dragonstone casts (measured gate,
  inferred cost).
- **Whether the decay phase can be steered.** The restore timer is aligned to login
  (`login.rs2:36`). A sip right after a decay step holds a full 100 ticks; the measured fights
  needed 2 re-sips. Logging in so that a decay step falls just before the fight would save at
  most one re-sip (2 ticks at worst, 0 when it lands inside an attack delay). Not worth
  planning around.
- **The packet floor of the bank visit** (2 ticks, or 1 with a blind OPHELDT) was inferred, not
  measured. It needs a client that sends the next cast without waiting for its own inventory
  to update, which belongs to the fast primitives in `speedrun/lib/` (tenet 4).
- **Whether noted items can be alched** (`alchemy.rs2` has no certificate check) was not tested.
  It does not affect the route.
- **Delay-free actions during the 2 idle ticks of every cast**: a helper-fed delay-free action
  (rs/37, rs/38) could fill the 2 blocked ticks of every enchant, if its packets are not
  dropped while delayed. That is for the packet-budget interleaving issue (rs/38) to measure.
  Most user-event handlers (`OpHeldT`, `OpLoc`, `InvButton`) refuse while delayed, so this
  likely needs IF_BUTTON-driven actions.
- **Which on-route quests are done before Magic training.** The Grand Tree wants the Varrock and
  Ardougne teleports (Magic 25 and 51) for its fastest legs, so some enchanting may come first
  (section 3). The README ordering should decide.
