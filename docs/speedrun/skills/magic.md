# Magic: fastest route to 99

All tick figures are server ticks. Headline cadences were measured on a local engine at
`NODE_TICKRATE=300` (production rate) with the headless lite client; figures marked
"100 ms lab" came from `NODE_TICKRATE=100` exploration runs and agree with the 300 ms runs.
Lab: `docs/speedrun/scripts/magic-lab.sh` (port block WEB 9220, management 9221, hiscores 9222,
node 43920, agent 8120). Scripts: `magic-cadence.ts` (ticks per cast for every candidate),
`magic-bank.ts` (the bank cycle), `magic-route.ts` (the ladder end to end with bank visits),
`magic-strike.ts` (1 -> 7), `magic-boost.ts` (potion-boosted Fire Wave and Charge, the potion's
decay, and the Mage Arena fight at base 71), all under `docs/speedrun/scripts/`.

## 1. Recommendation

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
the fight and the 2-10 after it, less 8 ticks of slower Charge. That is about 70-100 ticks. Base 76 needs 2,379 base from the
fight, starting from the bottom of level 71. All four measured yields clear that: three at base
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
| Watchtower | 15,300 | `quest_itwatchtower.rs2:533` | listed off route in this issue's brief; `quest_points.md` counts its 4 QP in one plan, so check with rs/3 |
| Horror from the Deep | 4,662 (and 4,662 each in Strength and Ranged) | `quest_horror.rs2:491-493` | skipped (`horror_from_the_deep.md`) |
| Imp Catcher | 875 | `quest_imp.rs2:4` | filler only (`quest_points.md`) |
| Witch's Potion | 325 | `quest_hetty.rs2:11` | filler only |
| Mage Arena fight (not a quest reward) | about 2,400-3,050 from casting | `mage_arena.md` (measured 3,044 and 2,404) | yes, it unlocks Charge |

- **The Grand Tree alone**: 2,150 base is level **57** (57 starts at 2,143.7 base). That is
  exactly the diamond unlock, so the route from there is diamond -> dragonstone -> Charge, about
  **400 ticks** (section 1). The quest itself uses the Varrock teleport (Magic 25) and the
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

- **Mage Arena at 75**: the fight length at Magic 75 with Fire Wave was not measured (rs/3's
  `mage_arena.md` measured it at 80). If it is under about 100 ticks longer, it pays. It also
  needs the plan to reach the arena at 75 rather than 80.
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
