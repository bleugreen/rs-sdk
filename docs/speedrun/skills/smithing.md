# Smithing: fastest route to 99

Helpers supply every bar; the scored account only hammers. Scripts:
`smithing-trade.ts` (the helper-fed anvil cycle, fixed product or the whole route),
`smithing-cycle.ts` (the anvil and bank cycle, raw packets or stock SDK), `smithing-model.ts`
(best item per level and ticks/bars to 99 for a given turnaround), `smithing-anvils.ts`
(anvil-to-bank distances from the map files), `smithing-lab.sh` (one-batch lab on the smithing
port block, `HELPER=<bot>` for a second bot).

**Host and rate.** Every measured number here was taken at `NODE_TICKRATE=300` on the Mac
executor `local`, which was heavily loaded at the time (load 11-18 on 16 cores). Treat them as a
busy host's figures, a few percent pessimistic: the bot reacts in wall-clock time, so a slow
host occasionally costs a tick in a turnaround. The 100 ms runs were only used to debug the
scripts.

## 1. Recommendation

Stand on the Varrock west anvil (3188,3426) with a hammer and have a helper stand on the next
tile (3187,3427). Each inventory is one trade: the helper offers the next 25 bars, the scored
account offers back the five items it just made, both accept, and the scored account makes 5
platebodies with one make-5 click. The first inventory is a mixed bronze/iron one that takes
level 1 to 34 in 9 items; after that it is platebodies only: iron (33), steel (48), mithril (68),
adamant (88). Every item costs 5 ticks whatever its bar count, so the 5-bar platebody is the
best item at every level from 33 up.

| Start | Ticks to 99 | Basis |
|---|---|---|
| **Level 1 (no on-route quest gives Smithing)** | **1,147**, or about **1,107** with the helper already staged | measured end to end, `smithing-trade.ts --from 1 --until 99`, 300 ms, 31 inventories; the first trade waited 40 ticks on the lab helper's own setup |
| Same route, model | 1,111 | inferred, `smithing-model.ts --overhead 10` (the measured turnaround) |
| Bank instead of a helper (Varrock west booth, raw packets) | about 1,330 | inferred, model with the measured 42-tick bank cycle (overhead 17) |
| Bank, stock SDK porcelain | about 1,600 | inferred, model with the measured 51-tick cycle (overhead 26) |
| Helper trade, stock SDK porcelain | about 2,550 | inferred, model with main's 56-tick stock trade (overhead about 59); with the stock SDK, bank instead |

The issue brief's estimate (~940 ticks, ~54 base/tick) was the 5-tick item with almost no
turnaround; the turnaround measured at 9-10 ticks per inventory of 25 ticks is what adds the rest.

## 2. Route by level band

All at the Varrock west anvil (3188,3426), helper on (3187,3427), bars arriving by trade.
Success is 100% (anvil smithing has no failure roll, `smithing.rs2:271-301`). Ticks per item are
measured (300 ms); "ticks for band" are the measured route's level-reached ticks
(`smithing-trade.ts --from 1 --until 99`).

| Band | Item | Unlock | Bars | Base xp per item | Ticks per item | Base xp per tick (band, measured) | Ticks for band (measured) |
|---|---|---|---|---|---|---|---|
| 1 -> 34 | 2 bronze daggers, bronze scimitar, warhammer, 2h sword, platebody, 2 iron warhammers, iron 2h sword (one inventory: 15 bronze + 9 iron bars) | Smithing 1-29 | 1-5 | 12.5-75 | 7-9 (make-1 with a fresh use-bar each; the bars of one type feed several items) | | |
| 34 -> 48 | iron platebody | 33 | 5 | 125 | 5 | 6.7 for 1 -> 48 (includes the 44-tick first trade) | 168 for 1 -> 48 (about 128 with a staged helper) |
| 48 -> 68 | steel platebody | 48 | 5 | 187.5 | 5 | 26.0 | 135 |
| 68 -> 88 | mithril platebody | 68 | 5 | 250 | 5 | 35.7 | 392 |
| 88 -> 99 | adamant platebody | 88 | 5 | 312.5 | 5 | 47.2 | 452 |
| (99) | rune platebody | 99 | 5 | 375 | 5 (measured, 8 gaps) | | only at 99 |

The level a band starts at can be off by one from the unlock (the plan fills an inventory
before switching tier, and one inventory can carry 1 iron + 4 steel platebodies). The cycle per
inventory in the platebody bands:

| Leg | Ticks (300 ms) | Source |
|---|---|---|
| make-5 click -> 5th xp | 23-25 (first xp 3-5 after the click, then exactly 5 apart) | measured, 114 of 127 gaps = 5 in the route; the rest are the make-1 items and tier switches |
| last xp -> trade open | 3-4 (the last item's `p_delay(2)` holds the player 2 more ticks) | measured |
| trade open -> bars in inventory | 3-9, typically 4-5 | measured |
| bars in -> next make-5 click | 1-3 | measured |
| **click -> next click (one inventory of 5)** | **31-39; mean 35.0** (10 inventories at level 99) and **33.9** (10 inventories, fresh lab) | measured, `smithing-trade.ts --cycles 10` |

That is 1,562.5 base per ~35 ticks = **about 45 base/tick for adamant platebodies**, 47.2
measured over the 88 -> 99 band of the route.

## 3. Quest xp

No quest on the current on-route set gives Smithing (`docs/speedrun/quests/README.md` on
`agent/rs-3-coordinator-0`, cf1e45d9), so the post-quest level is 1 and both totals are the
same. Quests that do give Smithing, all marked off route there (read):

| Quest | Base Smithing | Source | Ticks it would save (inferred: it replaces the last xp of the route, 88 -> 99 at 47.2 base/tick) |
|---|---|---|---|
| The Knight's Sword | 12,725 | `quest_squire.rs2:223` | about 270 (starts the route at 82) |
| Elemental Workshop I | 5,000 | `quest_elemental_workshop.rs2:275` | about 106 |
| Tourist Trap (one pick) | 4,650 | `irena.rs2:86` | about 99 per pick (the quest README spends both picks on Agility) |
| Heroes' Quest | 2,275 | `quest_hero.rs2:38` | about 48 |
| Legends' Quest | 30 | `quest_legends.rs2:1503` | 0 |

## 4. Mechanics

- **The item cycle (read, measured).** A make click runs `[proc,smithing_anvil]`
  (`smithing.rs2:271-301`): `p_delay(1)`, remove bars, add the item, award
  `bar_amount x xpperbar`, `p_delay(2)`, then recurse while the count lasts. The click lands as
  the first xp 3-5 ticks later; after that every item is exactly 5 ticks apart, for every tier
  (measured: bronze, iron, steel, mithril and rune platebodies 8 of 8 gaps each, adamant 40 of 40,
  `smithing-trade.ts --product <x>_platebody --cycles 2` and `--cycles 10`). Bar count does not
  change the ticks, so xp per tick is proportional to bars per item; the platebody (5 bars) is the
  5-bar item of every metal.
- **Xp (read).** Per bar (`smithing.struct`, tenths): bronze 12.5, iron 25, steel 37.5, mithril
  50, adamantite 62.5, runite 75. Platebody levels (`smithing.dbrow`): bronze 18, iron 33, steel
  48, mithril 68, adamant 88, rune 99.
- **Make options (read, measured).** The interface offers make-1, make-5 and make-10
  (`smithing.rs2:1-36`, INV_BUTTON1/2/3; there is no make-X). The option changes clicks, not ticks:
  make-5 runs 5 items 5 ticks apart from one click. Make-1 needs a fresh use-bar-on-anvil and
  click per item and costs 7-9 ticks per item (measured in the route's first inventory; an earlier
  execution of the bank script measured make-1 at 7). When fewer bars remain than the count,
  the chain stops with "You don't have enough bars to make any more" (`smithing.rs2:290-292`),
  so make-5 also works for 2-4 items of the last item using a bar type.
- **Choosing the item (inferred, `smithing-model.ts`).** Each item costs 5 ticks plus
  bars/27 of the inventory turnaround. The best item per level then is: bronze dagger (1),
  scimitar (5), warhammer (9), 2h (14), platebody (18); iron warhammer (24), 2h (29), platebody
  (33); steel platebody (48); mithril platebody (68); adamant platebody (88). The level curve is
  so flat early that 9 items take 1 -> 34.
- **The trade (read, measured).** The space check (`trade.rs2:161`, `enough_trade_space`) uses the
  partner's free slots after its own offer has left its inventory, so the scored account can hand
  back its 5 platebodies in the same trade that brings 25 bars, with no drops. Any offer resets
  both accepts (`trade.rs2:352-356`), and the trade moves to the confirm screen when the second
  player accepts (`trade.rs2:76-79`). A trade request to a player who is `busy()` is refused
  ("... is busy at the moment"), and `busy()` is delayed **or a main or chat modal open**
  (`Player.ts:878-879`).
- **Level-up dialogs (read, measured).** `levelup.rs2` opens a chat interface and
  `p_pausebutton`s. It does not interrupt a make-5 chain (the route's level-ups left the 5-tick
  gaps intact), and the next use-bar-on-anvil opens the smithing interface, which clears the
  paused script (`Player.ts` `openMainModal`). It does matter for trading: an open level-up or
  "not enough bars" box makes the scored account busy, so send `CLOSE_MODAL`
  (`sdk.sendCloseModal()`) with the trade request. Clicking the dialogs away instead made no
  difference (`--dialog click`, measured).
- **Bank cycle (measured).** Varrock west: 42 ticks per 5 adamant platebodies (5 cycles: last xp
  -> bank open 11, bank open -> next make click 8), raw packets: booth re-clicked every tick from
  the last xp, then deposit-all products, withdraw-all bars and use-bar-on-anvil in the tick the
  bank opens (`smithing-cycle.ts --run 1`). Another run on the same host gave 47-48 (3 cycles).
  Withdraw-all fills 27 bars, so 2 carry over and every trip makes exactly 5 platebodies. Running
  is free locally and on production (`NODE_INFINITE_RUN` defaults to true, `Environment.ts:47`,
  and `fly.toml` does not set it).
- **Stock SDK (measured).** `bot.openBank` / `depositItem` / `withdrawItem` / `closeBank` plus one
  raw make-5 click: 50-52 ticks per inventory (2 cycles). `bot.smithAtAnvil` (make-1 porcelain)
  fails after the first item ("Smithing interface did not open"), so it is unusable here. A stock
  SDK trade receive is 56 ticks (main's logistics figure), so with the stock SDK the bank beats
  the helper.

## 5. Alternatives considered

- **Bank instead of a helper.** Inferred about 1,330 ticks (raw packets, Varrock west) against
  1,107-1,147: +190-220 ticks. The map scan (`smithing-anvils.ts`) puts the Seers' Village
  anvils closer to a booth (7-8 tiles against Varrock's 10), but walls make them slower in
  practice: 60 ticks per inventory at (2713,3492) and 66-71 at (2714,3495) (measured, 2 and 4
  cycles), against Varrock's 42. Yanille (10 tiles) was not measured.
- **Superheat Item.** Measured by the Magic child at 3.00 ticks per cast, 53 base Magic plus the
  bar's smelting xp (`superheat.rs2:56-60`, `smelting.struct`: iron 12.5, gold 22.5, mithril
  30, adamantite 37.5, runite 50). Ores that need coal are crippled by inventory space, since coal
  does not stack: mithril takes 5 slots per cast (1 ore + 4 coal), adamantite 7, runite 9, so 3-5
  casts per inventory. Only single-ore bars (iron, gold) fill an inventory, at 27 casts per trip
  with a staff of fire. Comparing a superheat tick with the same xp bought separately (anvil at
  the band's measured rate, Magic at the route's enchant rate of 26 base/tick, dragonstone),
  inferred:

  | Cast | Smithing base per tick | Magic base per tick | Separate ticks for the same xp | Verdict |
  |---|---|---|---|---|
  | Gold, 27 casts + 4-tick bank (3.15 ticks/cast) | 7.1 | 16.8 | 7.1/47.2 + 16.8/26 = 0.80 | loses 20% |
  | Runite, 3 casts per trip (about 4.3 ticks/cast) | 11.6 | 12.3 | 11.6/47.2 + 12.3/26 = 0.72 | loses 28% |
  | Gold with goldsmith gauntlets (56.25 base) | 17.9 | 16.8 | 17.9/47.2 + 16.8/26 = 1.03 | a wash, and unavailable (below) |

  **Goldsmith gauntlets are not tradeable** (`quest_crest.obj:95`, `tradeable=no`), and a dropped
  untradeable item is never revealed to another player (`Zone.ts:333`). A helper cannot hand them
  over; only a scored account that does Family Crest itself can wear them, and even then they only
  break even. Superheat is off the route.
- **Furnace smelting (read, not measured).** The smelt queue re-arms 4 ticks per bar
  (`smelting.rs2:146-165,225-227`), and iron fails half the time without a ring of forging
  (`smelting.rs2:198-209`). Gold, the best single-ore bar at 22.5 base, gives under 6 base/tick
  before banking. Loses to the anvil by 8x.
- **Cannonballs (read).** 37.5 base per steel bar over `p_delay(4)` + `p_delay(0)` + `p_delay(2)`
  (`cannonballs.rs2:29-42`), so under 4 base/tick, and it needs Dwarf Cannon. Loses.
- **Drop the products instead of trading them back.** Same packet count for platebodies (drop 3
  with the trade click, 2 with the next use-bar), but it fills the helper's tile with items and
  only works for 5-bar items (25 free slots are needed). Measured 36-50 per inventory with
  `--dispose drop`, in a run that still had the accept-before-offer bug (gotchas); not
  re-measured.
- **Rune 3-bar items at 96-98 (chainbody, kiteshield).** 225 base per 5 ticks against the adamant
  platebody's 312.5. Loses.
- **3-bar items instead of platebodies.** With the measured turnaround they tie or lose
  everywhere from 33 up (`smithing-model.ts --table`); below 33 they are what the first inventory
  uses.

## 6. Gotchas

- **Accept only once your own offer holds every item.** An offer packet sent on the tick the
  trade screen first shows is sometimes refused. Accepting with the products still in the
  inventory fails the space check, and the engine cancels the trade ("Other player doesn't have
  enough inventory space for this trade", then "Other player declined trade"). That cost about 14
  ticks on a third of the inventories before the fix. Re-send the offer until `myOffer` holds the
  items, then accept.
- **Close modals before trading.** A level-up dialog or the "not enough bars" box left open makes
  the scored account `busy()`, and the helper's requests bounce.
- **Refused interface clicks.** `InvButtonHandler` drops a click while the player is delayed or
  when the clicked slot's item does not match; it happened about once per 10 inventories. Because
  `attempt_smithing` starts with `if_close`, an interface still open the tick after the click
  means the click was refused: re-send it.
- **Requests while delayed are refused.** The helper's trade request during the last item's
  `p_delay(2)` gets "is busy". Both sides re-send every tick, so the trade opens on the first
  free tick.
- **The helper must be staged in time.** It has the 25 smithing ticks of each inventory to get the
  next 25 bars into its own inventory (un-noted). A helper banking at the Varrock west booth (10
  tiles away) has roughly the scored account's own bank leg (about 19 ticks, measured) to do it,
  which fits (inferred). If it does not, alternate two helpers. The lab helper used `::give`.
- **No food, no hostile NPCs, no depletion.** The anvil is indoors in Varrock with guards nearby
  who do not aggro.
- **The stock `smithAtAnvil`** stops after one item at 300 ms; use raw use-bar plus a make-5 click.

## 7. Helper supply list

Per 99 from level 1 (the measured route's plan, `smithing-trade.ts`; the model gives the same):

| Item | Quantity | Where helpers get it |
|---|---|---|
| Hammer | 1 | General stores (1 coin) or the GE |
| Bronze bar | 15 | GE, or smelt (copper + tin) |
| Iron bar | 39 | GE, or smelt (50% failure without a ring of forging) |
| Steel bar | 95 | GE, or smelt (iron ore + 2 coal, Smithing 30): 95 iron ore + 190 coal |
| Mithril bar | 280 | GE, or smelt (mithril ore + 4 coal, Smithing 50): 280 ore + 1,120 coal |
| Adamantite bar | 340 | GE, or smelt (adamantite ore + 6 coal, Smithing 70): 340 ore + 2,040 coal |

Carry a margin of one inventory per tier (+25 bars of steel, mithril and adamantite) against a
misplanned switch. The scored account hands back what it makes (2 bronze daggers and the rest of
the first inventory, 6 iron, about 19 steel, 56 mithril and 68 adamant platebodies), which the
helpers can alch or sell to recover costs; it has no effect on the scored ticks.

**Cadence.** 31 trades of 24-25 bars, one per inventory, about 35 ticks per cycle (25 smithing +
10 turnaround). With the bank instead: 31 bank cycles at 42 ticks (raw packets) or 51 (stock SDK).

## 8. Open questions

- **Production turnaround.** The 9-10-tick trade turnaround and the 42-tick bank cycle were
  measured on a loaded host. On bbs or production the turnaround may be 1-2 ticks shorter (each
  tick saved per inventory is about 31 ticks over the route).
- **A real helper's restock loop** (bank trips between trades, or two alternating helpers) was not
  run; the lab helper spawned bars with `::give`.
- **The first inventory** (make-1 items, 7-9 ticks each) could be tightened, for example by
  planning it around make-5 runs. Worth at most about 20 ticks.
- **Yanille's anvil** (10 tiles from the booth by the map scan) was not measured; it only matters
  for the bank fallback.
- **Turnaround floor.** The trade turnaround has 3 ticks of forced delay plus about 3 ticks of
  trade screens. A client that pre-sends the trade click and offer on exact ticks might get it to
  about 7 (the model gives 1,014 ticks to 99 at 7).
