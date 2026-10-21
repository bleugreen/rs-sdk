# Engine sweep E: economy census (rs/68)

Where each route supply comes from on the rs-sdk demo server, how fast one helper can pull it, and whether more helpers help. Parent: rs/61 (mechanical audit). Posture: tenet 6, so legal client packets only and no changes to `server/` or `sdk/`.

**Labels.** `[read]` means the behaviour was read in code at the cited line. `[inferred]` means it was computed from read values or reasoned from code, but not measured in the lab. Rates are per wall-clock hour at the deployed tick of **300 ms, which is 12,000 ticks per hour** (`fly.toml:26` `NODE_TICKRATE = "300"`) `[read]`. Paths are relative to `server/content/scripts/` unless they start with `server/`, `fly.toml` or `maps/` (which means `server/content/maps/`).

**World facts that frame everything** `[read]`:

- It is a members world: `fly.toml:23` `NODE_MEMBERS = "true"`, and the code default is also true (`server/engine/src/util/WorldConfig.ts:100`). Members shops, spawns and the members branch of `randomherb` (`drop tables/scripts/shared_droptables.rs2:4`) are all live.
- There is one world. The market is designed single-world (`docs/grand-exchange.md:47-49`), and nothing resets shop stock or spawns per world. **World hopping does not reset anything.** Shop stock (`scope=shared` in every shop inv) and ground spawns are shared by every player on the server. Other bots are already present: `learnings/shops.md` reports general stores overstocked by other players. Live stock can therefore sit above or below the base values given here.
- Content under `_unpack/` is packed into the game like any other content. `server/engine/tools/pack/PackFile.ts:388` only exempts it from the folder-layout check. The chromatic dragons and the Mort'ton stores are defined there.

---

## 1. How shops work

### Restock (engine) `[read]`

`server/engine/src/engine/World.ts:1360-1396` runs once per tick, for every world inventory:

- For each slot of a `restock=yes` shop, if `count < stockcount` and `tick % stockrate == 0`, it adds **1** unit. If `count > stockcount`, it removes 1 unit on the same schedule.
- `stockrate` in `stockN=obj,count,rate` is therefore **ticks per unit**. One slot restocks at **12,000 / rate units per hour**, and that rate does not depend on how far below base the stock is. Draining a shop does not speed up its recovery.
- `allstock=yes` shops (general stores) also accept items they don't list. Those items decay by 1 every 100 ticks (`World.INV_STOCKRATE`, `World.ts:128`, used at `:1391`).
- A listed item at 0 stays in its slot and keeps restocking. `Inventory.remove` only nulls non-stock objs (`server/engine/src/engine/Inventory.ts:153,181`).
- The `tick % rate` check is global. Restock is a world clock and is not tied to when anyone bought. Every helper and every other player shares it.

### Price curve `[read]`

In `shop/scripts/shop.rs2:139-192`, the price of one unit when the shop holds `s` units with base `B` is:

```
buy price  = cost * max(100, SELL_MULT - clamp((s - B) * DELTA, -5000, 1000)) / 1000,  min 1 gp
sell value = cost * max(100, BUY_MULT  - clamp((s - B) * DELTA, -5000, 1000)) / 1000
```

Here `cost` is the obj's `cost=`, and `SELL_MULT`, `BUY_MULT` and `DELTA` are the NPC params `shop_sell_multiplier`, `shop_buy_multiplier` and `shop_delta` (defaults 100, 60 and 10 at `shop/configs/shopkeeper.param`). Real shops set them per NPC. Rune shops, for example, use 1000/550/10 (`areas/area_varrock/configs/varrock.npc:28-31`). Script-opened shops pass them as `~openshop(inv, buy, sell, delta, title)`, e.g. Razmire (`quests/quest_mortton/scripts/razmire_keelgan.rs2:240`).

What the formula means in practice:

- **Every unit below base raises the price by DELTA/10 percent of cost.** That is +1% per unit at delta 10 and +3% at delta 30. The price is capped at `SELL_MULT/1000 + 5` times cost, which is 6× for most shops, reached 500 units below base at delta 10.
- **Overstock makes items cheap.** Above base the buy price falls by the same step, down to 0.1× cost. A shop that someone has dumped 90 or more units into (at delta 10) sells at 0.1×.
- **Buying is unit by unit.** `shop.rs2:66-96` loops one unit at a time, re-pricing each. The buy buttons are 1, 5 or 10 (`shop.rs2:168-170`), and the engine takes up to 5 user packets per tick (`server/engine/src/engine/entity/NetworkPlayer.ts:69`). **Purchase speed is never the bottleneck: about 50 units per tick.** Stock and restock are.
- **Selling to a shop and buying back never profits within one shop.** You sell at `BUY_MULT` (at most 950, for the fur and vegetable shops) and buy back at `SELL_MULT` (at least 1000 at nearly every relevant shop), one step apart. The only break-even is at the 0.1× floor. `[read; inferred arithmetic]`
- **Notes.** `can_sell_obj` un-notes before checking (`shop.rs2:28,35`), and sales move the item with `inv_moveitem_uncert` (`shop.rs2:94,125`). You can sell banknotes, and anything you buy comes out un-noted. A general store (allstock, 1300/400/30) will therefore un-note any tradeable item at a 0.4 → 1.3× round-trip loss. That is useful only for cheap items.
- **Members items.** `can_sell_obj` refuses members objs only when `map_members` is false (`shop.rs2:32`), and this is a members world, so there is no restriction. Shops with a members variant pick it with `map_members`, e.g. Rommik (`areas/area_rimmington/scripts/rommik.rs2:14-16`) and Zaff (`areas/area_varrock/scripts/zaff.rs2:16-18`).

**Helper scaling for shops `[inferred]`:** stock is shared and restock is a world clock, so **N helpers at one shop pull exactly what one helper pulls.** Scaling comes only from covering more shops at once: one helper per shop. The per-hour figures below are per shop. A helper standing at the shop and buying each unit as it restocks keeps the stock near base, so it pays roughly the base price indefinitely.

### Shops that stock supply-list items

Columns: base stock, restock interval, steady units/hour per shop (`12000/rate`), price of the first unit, price with one left, and the total to buy out the whole base stock. Prices come from the formula above with each NPC's params `[inferred from read values]`. Shop lines are `[read]`.

| Item | Shop (NPC params file:line) | Inv file:line | Base | Every | Units/h | First / last / buyout |
|---|---|---|---|---|---|---|
| **Feather** | Gerrant, Port Sarim (`port_sarim.npc:285`, 1000/700/10) | `areas/area_port_sarim/configs/port_sarim.inv:93` | 1000 | **1 t** | **12,000** | 2 / 12 / 9,250 gp |
| Feather | Fishing Guild (`fishing_guild.npc:66`) | `skill_fishing/configs/fishing_guild/fishing_guild.inv:11` | 1500 | 1 t | 12,000 | 2 / 12 / 15,250 |
| Feather | Miscellania, Etceteria, Rellekka fishmongers | `areas/area_miscellania/configs/miscellania.inv:13,54`, `areas/area_vt/configs/viking.inv:94` | 1000 | 1 t | 12,000 each | delta 30 there, so the price climbs 3× faster |
| Feather | Shilo fishing; Shantay | `areas/area_shilo/configs/shilo.inv:12`; `areas/area_desert/configs/shantaypass.inv:21` | 800; 500 | 1 t; 50 t | 12,000; 240 | |
| **Fishing bait** | Gerrant, Fishing Guild, Harry (Catherby), fishmongers | `port_sarim.inv:92`, `fishing_guild.inv:10`, `areas/area_catherby/configs/catherby.inv:13` | 1200-2000 | 1 t | 12,000 each | 3 / 18 |
| **Arrow shaft** | Ranging Guild bowshop (`ranging.npc:178`) | `minigames/game_ranging/configs/ranging.inv:10` | 1000 | 50 t | 240 | 1 / 6 / 4,500 |
| Rune arrowheads | Hickton, Catherby (`catherby.npc:108`) | `catherby.inv:48` | 100 | 40 t | 300 | 200 / 398 / 29,900 |
| Rune arrowheads | Ranging Guild | `ranging.inv:16` | 150 | 60 t | 200 | 200 / 498 / 52,350 |
| Adamant arrowheads | Hickton; Ranging Guild | `catherby.inv:47`; `ranging.inv:15` | 200 | 40 t; 50 t | 300; 240 | 40 / 119 / 15,880 |
| Mithril arrowheads | Lathas, E Ardougne (`combat_training_camp.npc:126`, 1500×) | `areas/area_combat_training/configs/combat_training_camp.inv:18` | 800 | 80 t | 150 | 24 / 104 / 62,920 |
| Bronze to mithril arrowheads | Gulluck (Gnome Stronghold) | `areas/area_gnome/configs/gnome.inv:66-69` | 140-200 | 10-80 t | | |
| Dart tips | **none**: no shop stocks them. Smithing only (`skill_smithing/configs/smithing/smithing.inv:32` etc.) | | | | | |
| **Blood rune** | Magic Guild store, Yanille (`magic_guild.npc:62`; **needs 66 Magic to enter**) | `areas/area_yanille/configs/magic_guild/magic_guild.inv:29` | 1000 | 300 t | **40** | 50 / 300 / 237,250 |
| Law rune | Magic Guild | `magic_guild.inv:30` | 1000 | 300 t | 40 | 40 / 240 / 189,700 |
| Nature rune | Magic Guild | `magic_guild.inv:27` | 1000 | 300 t | 40 | 20 / 120 / 94,750 |
| Death rune | Magic Guild; Aubury (Varrock); Betty (Port Sarim) | `magic_guild.inv:31`; `areas/area_varrock/configs/varrock.inv:53`; `port_sarim.inv:49` | 1000 each | 150 t | 80 each | 30 / 180 / 142,200 each |
| Chaos rune | Aubury; Betty; Magic Guild | `varrock.inv:52`; `port_sarim.inv:48`; `magic_guild.inv:28` | 1000 each | 100 t | 120 each | 15 / 90 / 70,975 |
| Fire/water/air/earth | Aubury, Betty (2000 / 1000) | `varrock.inv:46-49`, `port_sarim.inv:42-45` | 1000-2000 | 10 t | 1,200 per rune per shop | 4 / 24 / 42,750 (Aubury) |
| Elementals, mind, body | Magic Guild | `magic_guild.inv:15-20` | 3000 | 18 t | 667 each | 4 / 24 / 66,750 |
| **Cosmic rune** | Lundail, Mage Arena bank (`mage_arena.npc:41`, delta 30, deep Wilderness) | `areas/area_mage_arena/configs/mage_arena.inv:19` | **20** | 100 t | **120** | 15 / 23 / 376 |
| Nature, law, death, chaos | Lundail | `mage_arena.inv:16-20` | 250 | 300 / 300 / 150 / 100 t | 40 / 40 / 80 / 120 | |
| Law rune | Tutab, Ape Atoll (`quest_mm.npc:541`) | `quests/quest_mm/configs/quest_mm.inv:13` | 250 | 300 t | 40 | 40 / 139 / 22,350 |
| Soul rune | Magic Guild | `magic_guild.inv:21` | 50 | 100 t | 120 | 1,250 gp each |
| **Eye of newt** | Betty, Port Sarim | `port_sarim.inv:50` | 300 | 10 t | 1,200 | 3 / 11 / 2,097 |
| Eye of newt | Jatix, Taverly (`taverly.npc:112`); Frincos (Entrana); ogre merchant | `areas/area_taverly/configs/taverly.inv:28`; `areas/area_entrana/configs/entrana.inv:11`; `areas/area_yanille/configs/gutanoth.inv:29` | 800; 50; 50 | 20 t | 600 each | 3 / 18 / 13,059 (Jatix) |
| **Vial of water** | Aemad, E Ardougne (`ardougne_east.npc:654`, 1300×) | `areas/area_ardougne_east/configs/ardougne_east.inv:65` | 500 | 30 t | 400 | 2 / 12 / 4,775 |
| Vial of water | Lighthouse; Razmire; jungle stores; Sigmund | `viking.inv:141`; `_unpack/274/all.inv:20`; `areas/area_karamja/configs/karamja.inv:48`, `shilo.inv:45`; `viking.inv:75` | 100; 100; 50; 10 | 500; 100; 200; 200 t | 24; 120; 60; 60 | |
| Empty vial | Jatix; Lighthouse; ogre merchant; Frincos | `taverly.inv:26`; `viking.inv:140`; `gutanoth.inv:27`; `entrana.inv:9` | 800; 100; 50; 50 | 100 / 500 / 100 / 100 t | 120; 24; 120; 120 | |
| Herbs, snape grass, limpwurt, red spider eggs, white berries | **none**: no shop stocks them | | | | | |
| **Jug of water** | Shantay; Bedabin; Lighthouse | `shantaypass.inv:13`; `areas/area_desert/configs/bedabincamp.inv:11`; `viking.inv:139` | 10; 5; 5 | 100; 100; 500 t | 120; 120; 24 | 1 gp |
| Empty jug | each of about 18 general stores (e.g. Varrock `varrock.inv:31`) plus the Lighthouse (`viking.inv:138`) | | 2 (5) | 100 t (200) | 120 each (60) | 1 gp |
| Jug of wine | Zambo, Karamja | `karamja.inv:11` | 1 | 15,000 t | 0.8 | |
| Grapes | **none** | | | | | |
| Bars | Bronze only: Shantay, jungle stores (10 each, every 500 t, 24/h). Silver: Ardougne silver stall (1). Drogo's ores and bars have **base 0** (`areas/area_falador/configs/dwarven_mine.inv:10-16`), so they only resell what players sold. **Nothing for steel, mithril or adamant.** | | | | | |
| Ores | Drogo, base 0 (as above). Silver ore 1 at the silver stall (`ardougne_east.inv:39`) | | | | | |
| Logs | **none** | | | | | |
| Uncut gems | Herquin and the Al Kharid gem trader: 1 sapphire every 25,000 t, 1 emerald every 40,000 t; ruby and diamond base 0 (`areas/area_falador/configs/falador.inv:9-12`, `areas/area_alkharid/configs/alkharid.inv:67-70`). **About 0.5 per hour, so useless.** | | | | | |
| **Ruby ring** (cut, for enchanting) | Irksol, Zanaris (`lostcity.npc:95`, **sell mult 500, so half price**) | `areas/area_lostcity/configs/lostcity.inv:20` | 5 | 500 t | 24 | 1,012 / 1,093 / 5,263 |
| Swordfish | Fionella, Legends Guild (1550×) | `areas/area_ardougne_east/configs/legends_guild/legends_guild.inv:9` | 20 | 200 t | 60 | 310 / 348 |
| Swordfish, lobster, tuna | Brimhaven restaurants | `areas/area_brimhaven/configs/brimhaven.inv:12-14` | 2-5 | 2,300-2,900 t | about 5 | |
| Bread, pies, cake, flour, milk, veg | many small shops (bakery `ardougne_east.inv:24-26`, food shops, gnome shops) | | 3-30 | 100-800 t | 15-120 each | cheap, low volume |
| Dragon bones, big bones, rune essence | **none** | | | | | |

---

## 2. Ground spawns and gather sources

### Engine rule `[read]`

Map spawns live in each `maps/mX_Z.jm2` under `==== OBJ ====`, one per line as `level x z: obj count`. When a static spawn is taken it respawns after the obj's `respawnrate` (default **100 ticks**, `server/engine/src/cache/config/ObjType.ts:182`; taking it at `server/engine/src/engine/script/handlers/ObjOps.ts:157`). That delay is scaled by `(4000 - players) / 4000` (`World.ts:2061-2065`), so it is 97.5% at 100 players and negligible. Spawns are visible to all players. **N helpers on one spawn give the same rate as one.** Only spreading helpers across distinct spawns helps. The ceiling per spawn is `12000 / respawnrate` per hour, less walking.

### Spawns of supply-list items

These come from a full parse of all 538 map files `[read]`. Coordinates are x, z and level. Units per hour are the spawn ceiling `[inferred]`.

| Item | Spawns | Respawn | Ceiling/h per spawn | Where (file:line) | Notes |
|---|---|---|---|---|---|
| **Grapes** | **2** | 80 t (`skill_cooking/configs/cooking_inv/configs/wine/wine.obj:31`) | 150 | Cooking Guild top floor (3144,3450,2) `maps/m49_53.jm2:10243`; **Phoenix Gang hideout, Varrock** (3237,9761,0) `maps/m50_152.jm2:4122` | The hideout door needs Phoenix Gang membership (`quests/quest_blackarmgang/scripts/quest_blackarmgang.rs2:17`). rs/47 measured 132/h at the Guild including a bank trip. **The hideout is a second, independent spawn, which doubles the grape rate with a second helper.** |
| Jug (empty) | 8 | 100 t | 120 | e.g. Cooking Guild (3141,3447,2) `maps/m49_53.jm2:10241`; Falador area `maps/m45_51.jm2:6233,6237`; Karamja `maps/m45_49.jm2:6507` | |
| Jug of water | 2 | 100 t | 120 | Al Kharid palace (3302,3170) `maps/m51_49.jm2:9014`, next to Hassan; (2568,3102) `maps/m40_48.jm2:9385` | |
| Snape grass | 3 | 30 t (`skill_herblore/configs/brewing/potions_additives.obj:54`) | 400 each, about 1,200 for the cluster | Hobgoblin peninsula, (2906-2917, 3274-3297) `maps/m45_51.jm2:6230-6232` | Enough for any prayer potion count |
| White berries | 3 | 10 t | 1,200 each | (3214,3809) and (3218,3814) Wilderness `maps/m50_59.jm2:5799,5801`; (2262,3168) `maps/m35_49.jm2:6023` | |
| Red spider eggs | 15 | 100 t | 120 each | (2336-2346, 3309-3316) `maps/m36_51.jm2:5267-5272...` | |
| Wine of Zamorak | 1 | 50 t | 240 | Chaos temple (2930,3515) `maps/m45_54.jm2:7456` | |
| Big bones | 7 | 50 t (`skill_prayer/configs/bones.obj:55`) | 240 each | Wilderness (3214-3253, 3733-3746) `maps/m50_58.jm2:6125-6149`; (2767,3855) `maps/m43_60.jm2:4420` | About 1,700/h for the whole cluster, but it is deep Wilderness with PvP risk |
| Bones | 283 | 100 t | | everywhere | |
| Dragon bones | **0** | | | | Drops only |
| Logs | 25 | 100 t | 120 | e.g. `maps/m38_49.jm2:6498-6501` | Normal logs only, irrelevant |
| Runes | nature 4 (11 total), chaos 10 (14), blood 4, cosmic 1 (×3), death 1 | 100-200 t | ≤ 180 per stack | cosmic (2947,3898) `maps/m46_60.jm2:4762` and blood `maps/m51_59.jm2:5678-5680` are deep Wilderness; nature (2671,3737) `maps/m41_58.jm2:4329,4331` | Small next to the shops |
| Uncut sapphire | 2 | 500 t | 24 | `maps/m42_153.jm2:7633` (King Black Dragon lair), `maps/m43_60.jm2:4421` | |
| Fishing bait, feathers, arrowheads, bars | 2, 0, 2, gold 1 and iron 1 | | | | Trivial |
| Vial (empty) | 8 | 100 t | 120 | `maps/m40_48.jm2:9386-9387`, `maps/m43_52.jm2:4740-4741` | |

### Gather sources in scripts (item-on-location, picking, NPCs)

| Source | file:line | Delay | Limit | Notes |
|---|---|---|---|---|
| **Fill jug, vial, bucket or bowl at any water source** (sink, fountain, pump: the `_watersource` loc category) | `general_use/scripts/water_sources.rs2:63-84` | `p_delay(0)`, which is about 1 tick per fill (`server/engine/src/engine/script/handlers/PlayerOps.ts:378`: `delayedUntil = tick + 1 + n`) | **none** | Water is never scarce. Containers are. |
| Item-on-item water transfer (for example, bucket of water onto a jug) | `water_sources.rs2:1-61` | none | 1:1 swap | No duplication: both items step to `next_obj_stage` |
| Wells (buckets only) | `water_sources.rs2:69-93` | `p_delay(0)` | none | |
| Pick wheat, potato, onion, cabbage | `general_use/scripts/pickables.rs2:2-52` | `p_arrivedelay`; the loc respawns after 20, 50, 50 and 70 t | per loc | |
| Pick flax | `pickables.rs2:56-74` | `p_delay(0)`; 3 in 16 chance the plant despawns for 10 t | none in practice | About 1 per tick per helper. Bowstrings for Fletching (rs/37) |
| Shear sheep | `general_use/scripts/shear_sheep.rs2:5-23` | 2 × `p_delay(0)`; 1 in 4 escapes; the sheep re-grows after 100 t | per sheep | |
| Flour mill | `general_use/scripts/windmills.rs2:77-124` | `p_delay(0)` per grain | bin holds 30 | |
| Rune essence | `skill_mining/scripts/mining.rs2:217-226` | swing cadence; **no success roll, no depletion** | none | Scales linearly with helpers (instanced mine). The route figure is 4,536 essence in about 13,600 helper ticks (`[r28] docs/speedrun/skills/runecraft.md:302-310`). This cache has **no pure essence** (`content/pack/obj.pack` has none). |

---

## 3. Item-producing scripts with no delay or no stock limit

Only items that create or convert value are listed. Delays are as written in the script `[read]`. Rates are `[inferred]`.

| Source | file:line | What | Delay / limit | Verdict |
|---|---|---|---|---|
| **Hassan, Al Kharid palace** (3302,3163) `maps/m51_49.jm2:9000` | `areas/area_alkharid/scripts/hassan.rs2:12-16` | Dialogue option 2 ("It's just too hot here…") gives **1 jug of water, every time**, if you have a free slot | Only dialogue pages, no `p_delay`. **No counter, no stock.** Gated on `%princequest = prince_not_started` (`hassan.rs2:2-3`), so it works for any helper that never starts Prince Ali Rescue | **This is the jug source.** Each jug takes the op, one NPC page, the choice, one player page and one NPC page. Continues resolve inside packet handling (`server/engine/src/network/game/client/handler/ResumePauseButtonHandler.ts:20`), up to 5 user packets per tick (`NetworkPlayer.ts:69`), so one cycle is about 1-3 ticks. Including a 28-slot bank trip to the Al Kharid bank (about 33 tiles), that is **about 2,000-5,000 jugs of water per helper per hour**, and **it scales linearly with helpers** because there is no shared stock. `[inferred, needs a lab measure]` |
| Kaleb Paramaya, Shilo inn | `areas/area_shilo/scripts/kaleb_paramaya.rs2:27,33-41` | Jug of wine for **1 gp**, unlimited | Dialogue only | Drinking wine leaves an empty jug (`skill_cooking/configs/cooking_inv/configs/wine/wine.obj`, `jug_wine` `next_obj_stage,jug_empty`; drink at `player/scripts/consumption/consume.rs2:13`, a 3-tick eat delay). It is a second unlimited jug source but slower and behind Shilo access. Bought wine gives no Cooking XP. |
| Recycle fermented wine | `consume.rs2:13`; `wine.obj` | Drinking each finished wine, or the bad wine, returns the jug | 3 t per drink | Closes the loop if Hassan were ever unavailable |
| West Ardougne civilian | `areas/area_ardougne_west/scripts/civilian.rs2:69-77` | Hand over any `cat` or `overgrown` category item and receive **100 death runes** | Per cat; cats are scarce (Gertrude's kitten from Gertrude's Cat) | Small; death runes are cheap in shops anyway |
| Irksol, Zanaris | `lostcity.inv:20`, `lostcity.npc:95` | Ruby rings at 0.5× value (1,012 gp) | 5 in stock + 24/h | Directly supplies the 16 ruby rings Magic enchanting needs (`[r28] docs/speedrun/skills/magic.md:310-316`). Saves cutting and crafting them. Reselling to Grum, Port Sarim (buy mult 700, `port_sarim.npc:250`) makes about 400 gp a ring, which is only pocket money. |
| Wine fermentation into the bank | `skill_cooking/scripts/cooking_inv/scripts/wine/wine.rs2:21-53` | Unfermented wine ferments **in the bank**, in 15 batches, on one timer | 20 t timer | Already the rs/47 mechanic. Noted for completeness. |
| Fycie (Big Chompy Bird Hunting) | `quests/quest_chompybird/scripts/fycie.rs2:34-38` | 25 feathers for 50 gp | **Once** (sets a varbit) | Not worth it; Gerrant gives 12,000 per hour |
| Mort'ton afflicted | `quests/quest_mortton/scripts/afflicted.rs2:83-133` | Random coins, vials, logs, tarromin | Consumes serum 207 per use | Not worth it |
| Digsite panning | `quests/quest_itexam/scripts/area_digsite.rs2:360-391` | 1 in 16 jug, clay, opal, jade | Per pan | Not worth it next to Hassan |
| Observatory assistant | `quests/quest_itgronigen/scripts/observatory_assistant.rs2:4-10` | 1 jug of wine | **Once** | |
| Seers coal truck | `areas/area_seers/scripts/coal_trucks.rs2:19` | Stores coal; it doesn't create any | | Storage only |
| General store un-noting | `shop.rs2:35,94,125` | Sell notes, buy back un-noted | Round trip costs 0.4 → 1.3× | Only for cheap bulk |

No duplication bug was found in the shop, water or wine scripts.

---

## 4. Drop tables (brief)

These are expected values per kill from `drop tables/scripts/*.rs2` (roll of 128) `[read; EV inferred]`.

- **Dragon bones** come from `param=death_drop,dragon_bones`, which is guaranteed on every kill. Blue dragons are in `_unpack/225/all.npc:1416` (respawn 60 t, `:1434`); the same applies to red, black and green dragons (`_unpack/225/all.npc`), the King Black Dragon (`areas/area_wilderness/configs/king_dragon.npc:46`), and the bronze, iron and steel dragons (`areas/area_karamja/configs/karamja.npc:596,638,680`). The spawn counts from the map parse: blue 10 (6 at 2568-2609,9431-9461, `maps/m40_147.jm2:7625...`, which is the Ogre Enclave since that block also holds ogre shamans and the ogre chieftain; and 4 in Taverly dungeon), green 5 (Wilderness, `maps/m48_59.jm2:5755-5759`), red 10, black 4, iron 13, steel 4, bronze 3, King Black Dragon 1. **The spawn ceiling is far above any kill speed.** The bones come at the helper's kill rate, about 60-150 per hour for a strong combat helper `[inferred]`. **555 dragon bones is about 4-9 strong-helper hours, or the GE.** Big bones are the default death drop for ogres, giants and trolls (`areas/area_yanille/configs/ogre.npc:30` etc.).
- **Runes per kill** (on or near the route): green or blue dragon gives 15 nature at 5/128, **0.59 nature per kill** (`green_dragon.rs2:33`, `blue_dragon.rs2:33`). Black dragon gives 0.39 law and 0.35 blood (`black_dragon.rs2:37,39`). Shadow warrior gives 0.21 cosmic (`shadow_warrior.rs2:23`). Fire giant gives 0.16 blood (`fire_giant.rs2:26`). The Kalphite Queen is best for everything (blood 2.97, nature 8.2) but is off-route. **Every one of these is small next to shop restock.**
- **Herbs** come from `~randomherb` (`shared_droptables.rs2:2-35`), where ranarr is 11/128 of herb rolls. Chaos druids drop a herb on 35/128 of kills and two on 11/128 (`chaos_druid.rs2:24-28`), about 0.45 herbs per kill, of which **about 0.04 are ranarr**. Prayer potions from drops would cost thousands of kills. Herbs are a Herblore (rs/37) and GE problem.
- **Grapes:** goblins, one roll per kill (`goblin.rs2:121`). rs/47 puts it at 1/128. It is negligible.

---

## 5. Grand Exchange / market (brief, read-only)

This comes from a sub-agent read of `server/engine/src/engine/market/*`, `docs/grand-exchange.md` and `sdk/MARKET.md` `[read]`:

- It is enabled by default (`server/engine/src/util/Environment.ts:38`, `GE_ENABLED` true; `fly.toml:13` sets its database). Access is the Varrock west bank ground floor, through the table at 3180,3443 or the teller at 3181,3445 (`server/engine/src/engine/market/GrandExchange.ts:72-115`), using ordinary interface packets.
- Matching is **instant, against other players only**: there is no NPC liquidity. It uses price priority then first-in-first-out, allows partial fills, and fills at the resting price (`server/engine/src/engine/market/MarketStore.ts:121-174`). Offers persist offline and do not expire.
- Limits: 6 offer slots per account (`MarketStore.ts:7,134`), no per-item buy limit, no cooldown. Fees: **5% seller tax, burned** (`MarketStore.ts:155`). Buyers pay none.
- Read-only price discovery is public: `GET /api/market/items/{id}` returns bid, ask and quantities (`server/engine/src/web/pages/market.ts:26-116`).
- As a supply path, the GE is **only as deep as other players' listings.** rs/47 found a 1,000 gp bid wall for grapes and no sellers. It is a sink for helper surplus and a possible source for dragon bones and herbs when other agents list them. Check `/api/market/items/{id}` before planning on it. One more tactic: a resting buy offer fills while the account is offline, so posting bids early costs no scored time.

---

## Supply-source table per route item

Route quantities are from the route docs: `[r28]` is `agent/rs-28-coordinator-0`, `[r3]` is `agent/rs-3-coordinator-0`, and rs/47 is the wine issue. "Scales?" asks whether N helpers give N times the units.

| Item | Route need | Best source | file:line | Units/h per helper | Scales? | Delay / gate |
|---|---|---|---|---|---|---|
| Grapes | 520 (rs/47) | Two spawns: Cooking Guild and Phoenix hideout | `maps/m49_53.jm2:10243`, `maps/m50_152.jm2:4122` | ≤150 per spawn (132 measured at the Guild) | **Only up to 2 helpers**, one per spawn | 80 t respawn. Guild needs Cooking 32 and a worn chef's hat (`skill_cooking/scripts/cooking_guild.rs2:4-7`); the hideout needs Phoenix Gang |
| Jug of water | about 520 | **Hassan dialogue** | `hassan.rs2:12-16` | about 2,000-5,000 `[inferred]` | **Yes**, linear | Prince Ali not started |
| Jug of water (fallback) | | Shops (Shantay, Bedabin) or general-store jugs plus a sink | `shantaypass.inv:13`, `bedabincamp.inv:11` | 120 per shop | No (per shop) | |
| Dragon bones | 555 (`[r28] skills/prayer.md:180-192`) | Blue dragons (Ogre Enclave, Taverly) or green dragons; GE | `_unpack/225/all.npc:1416` | about 60-150 per strong helper `[inferred]` | Yes, until spawns saturate | Combat stats |
| Rune essence | 4,536 (`[r28] skills/runecraft.md:289-296`) | Essence mine | `mining.rs2:217-226` | about 3,000 net of banking (route figure) | Yes | Rune Mysteries |
| Bars (mithril 280, adamant 340, steel 95…) | 769 (`[r28] skills/smithing.md:209-213`) | Smelt from mined ore; GE | (no shop) | mining-bound | Yes | No shop source for steel and up |
| Logs (107 magic, 24 yew…) | 157 (`[r28] skills/firemaking.md:291-307`) | Woodcutting | (no shop or spawn) | WC-bound | Yes (per tree) | |
| Feathers | about 700 (`[r2] skills/fishing.md:352`) | **Gerrant, Port Sarim** | `port_sarim.inv:93` | 1,000 at once, then 12,000/h | Per shop | **One visit, about 5.7k gp, done** |
| Fishing bait | small | Gerrant | `port_sarim.inv:92` | 12,000 | Per shop | |
| Arrow shafts / headless arrows | rs/37 (not published) | Ranging Guild shop; fletch from logs | `ranging.inv:10` | 1,000 + 240/h | Per shop | Ranging Guild entry |
| Arrowheads | rs/37 | Hickton (rune 100 + 300/h), Ranging Guild, Lathas | `catherby.inv:43-48` | see shop table | Per shop | |
| Dart tips | rs/37 | Smith only | | | | |
| Blood runes | about 540-610 (`[r28] skills/magic.md:322,341`; `[r3] quests/mage_arena.md:65-66`) | **Magic Guild store** | `magic_guild.inv:29` | 1,000 in stock, then 40/h | No (one shop) | **66 Magic to enter.** 610 bloods cost 120,250 gp `[inferred]` |
| Cosmic runes | 52-170 (`[r28] magic.md:317,335,344`) | Lundail (Mage Arena), then cosmic altar runecrafting | `mage_arena.inv:19` | 20 + 120/h | No | Deep Wilderness. 170 cosmics is about 1.3 h of one helper camping |
| Nature runes | 4,347 essence crafted (route RC) | Runecraft; Magic Guild (1,000) and Lundail (250) as a buffer | `magic_guild.inv:27` | 40/h restock | No | |
| Law runes | teleports (about 10) | Magic Guild, Lundail, Tutab | | | | trivial |
| Death runes | small | Aubury, Betty, Magic Guild (1,000 each) | `varrock.inv:53` | 80/h each | Per shop | |
| Fire, air, earth runes | about 1,540 earth, about 900 air, about 570 fire (`[r28] magic.md:318-324`) | Aubury + Betty + Magic Guild | `varrock.inv:46-49` | 1,000-3,000 each in stock, 667-1,200/h restock | Per shop | One visit each |
| Uncut gems / jewellery | sapphire 12, emerald 27, ruby 16, diamond 37, dragonstone 78 (`[r28] magic.md:310-316`) | Ruby rings: **Irksol**. Others: crafting from mined or GE gems | `lostcity.inv:20` | 5 + 24/h ruby rings | No | Zanaris access (Lost City) |
| Vials of water | herblore (rs/37) | Aemad (500 + 400/h); or fill empty vials at any sink (`p_delay(0)`) | `ardougne_east.inv:65`; `water_sources.rs2:65` | 400 / sink-bound | Per shop / yes | |
| Eye of newt | herblore | Betty (300 + 1,200/h), Jatix (800 + 600/h) | `port_sarim.inv:50`, `taverly.inv:28` | | Per shop | |
| Snape grass | prayer potions (about 100, overlapping blocks) | Hobgoblin peninsula spawns | `maps/m45_51.jm2:6230-6232` | about 1,000 | No (3 spawns) | 30 t respawn |
| Ranarr / herbs | prayer potions, supers | GE; drops are hopeless (0.04 ranarr per kill) | `shared_droptables.rs2:2-35` | | | |
| Sharks | about 100 across blocks (`[r28] defence.md:75` etc.) | Fishing only; no shop | | | | |
| Swordfish | about 15 (Fight Arena, `[r3] quests/README.md:272`) | Fionella (20 + 60/h) | `legends_guild.inv:9` | | | Legends Guild entry (late); otherwise fish |

---

## Free or exploitable sources

1. **Hassan's free jug of water.** It is unlimited, has no delay beyond dialogue, and scales linearly with helpers, for any helper that never starts Prince Ali Rescue (`areas/area_alkharid/scripts/hassan.rs2:12-16`). It turns jugs from a scarce container into a free one. `[read; rate inferred]`
2. **Kaleb's 1 gp wine plus drinking.** This is a second unlimited empty-jug source (`areas/area_shilo/scripts/kaleb_paramaya.rs2:27`; `consume.rs2:13`). Recycling the route's own finished wines works the same way. `[read]`
3. **Water sources** have no limit and a 1-tick delay per fill (`general_use/scripts/water_sources.rs2:75-84`). `[read]`
4. **One-tick feather and bait restock** at every fishing shop (`stockrate 1`): 12,000 per hour per shop at 2-3 gp (`areas/area_port_sarim/configs/port_sarim.inv:92-93`). `[read]`
5. **Overstock floor.** Any shop pushed 90+ units above base (at delta 10) sells at 0.1× value (`shop.rs2:183-192`). Helpers can buy from overstocked general stores cheaply, and other bots on the server do overstock them (`learnings/shops.md`). `[read]`
6. **Irksol's half-price ruby rings** for enchanting (`areas/area_lostcity/configs/lostcity.inv:20`, `lostcity.npc:95`). `[read]`
7. **The second grape spawn in the Phoenix Gang hideout** (`maps/m50_152.jm2:4122`). `[read]`
8. **Offline GE bids.** A resting buy fills while the account is logged out (`MarketStore.ts:121-174`), so posting it costs no scored time. `[read]`
9. **Shop un-noting through a general store** (`shop.rs2:35,94`). This is lossy and only for cheap items. `[read]`

## Worth acting on (ranked by helper time saved against the current plan)

1. **Hassan for jugs of water (rs/47).** The plan sources about 520 jugs from shops, sinks or the Guild spawn at about 100 per hour, which is roughly 5 helper-hours. Hassan should do it in about 10-15 helper-minutes, and it no longer competes with grapes for the Guild spawn. **Saves about 4-5 helper-hours.** Next step: a lab measure of ticks per jug (`[inferred]` 1-3).
2. **Phoenix hideout grapes (rs/47).** Grapes are the binding wine input: only 2 spawns exist in the whole game, there is no shop, and the GE is empty. A second helper on the hideout spawn **halves the wall time for 520 grapes, from about 3.9 h to about 2 h.** The cost is one helper joining the Phoenix Gang (Shield of Arrav start). Nothing else can increase grape supply, so this sets the floor on wine-supply time.
3. **Feathers from Gerrant (fishing).** The fishing doc lists about 700 feathers with no source. One visit of about 70 buy packets (about 14 ticks) at about 5.7k gp covers it (`port_sarim.inv:93`). Small saving, zero risk.
4. **Blood runes: buy the Magic Guild's initial 1,000** (610 for about 120k gp) the first time an account with 66 Magic passes Yanille. After that, restock is only 40 per hour, and other players share the stock. Don't plan on restock.
5. **Cosmic runes:** Lundail holds only 20 plus 120 per hour. The 52-170 the route needs is 0.3-1.3 h of one helper in deep Wilderness, or cosmic runecrafting. Pick one and write it into magic.md.
6. **Ruby rings from Irksol** replace crafting 16 ruby rings, saving rubies and gold bars.
7. **Dragon bones are the real economy risk.** There is no free source: only kills or the GE. 555 bones is about 4-9 strong-helper hours `[inferred]`. Price the GE now via `/api/market/items/{dragon_bones id}`, and decide whether a dedicated combat helper is worth it.

## Open questions

- Hassan's real ticks per jug (lab). Also, whether the lite client's blind continue (`sendClickDialog(0, { blind: true })`) can chain the choice step, which needs `IF_BUTTON` rather than a resume (`ResumePauseButtonHandler.ts:13-17`).
- Live shop stock on the shared server. Other bots may have drained runes or flooded general stores; the base values here are configs, not the live state.
- Herb, arrow, gem and dart supply lists for Fletching, Crafting and Herblore are owned by rs/37 and are not yet on a branch, so they are not ranked here.
