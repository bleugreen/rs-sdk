# Buyer role

`speedrun/helpers/buyer.ts` executes a shopping list at the Grand Exchange
(Varrock west bank) and at NPC shops, banks what it bought, and reports what it
spent. Which items are worth buying at all, and where, is in
[market.md](market.md).

## Running it

```sh
ROLE_OPTIONS='{"list":[
  {"item":"Feather","quantity":200,"source":"shop","shop":"gerrant","maxPrice":6},
  {"item":"Shark","quantity":20,"source":"ge","maxPrice":950}
]}' bun speedrun/helpers/buyer.ts <account>
```

The account needs coins in its bank; the buyer withdraws the list's budget
(quantity x `maxPrice`, or x the current ask, or x 3x base cost for shop lines)
before it starts, at Varrock west when the list has a GE line and otherwise at
the first shop's bank (`homeBank`). Run the lite client against a local gateway
like every other role (see coins.md).

| Role option | Meaning |
|---|---|
| `list` | The shopping list (below). |
| `campTicks` | Camp on restocking shops: after the first pass, shop lines that stopped on an empty or too dear shelf are revisited in passes, in list order, until they are met or this many ticks have gone by since the budget was withdrawn. Default 0, one pass. |

| Line field | Meaning |
|---|---|
| `item` | Name as the game spells it (`Feather`, `Mithril arrowtips`) or the item id. Names that 2004 shares between items (`Herb`, `Unfinished potion`) must be given by id: market.md has the id table. |
| `quantity` | **Target holdings** (bank + inventory), not an amount to add. A restart, or running the same list again, buys only the shortfall. |
| `maxPrice` | Highest unit price to pay. GE: the bid price when there is no ask at or below it. Shop: the cap on the live price (default 3x the item's base cost). |
| `source` | `ge` or `shop`. |
| `shop` | For shop lines, a key of `SHOPS` in buyer.ts (`aubury`, `gerrant`, `betty`, `nurmof`, `heckel`, `hudo`, ...). Adding a shop is one entry: the shopkeeper's NPC name, a tile beside them, and the nearest bank; a shop or bank off the surface also names its ladder (below). |
| `maxWaitTicks` | Shop lines: how long to wait for restocks when the shelf is empty or the price is above `maxPrice` (default 300 ticks). |

GE lines run first (at Varrock west, where the budget is withdrawn), then the
shop lines in list order, so order shop lines along a sensible route. The
buyer starts from anywhere, including the tutorial and Al-Kharid (it pays the
toll out).

## Getting there: floors, ladders and passages

Every place the buyer walks to (a shop's `stand`, a bank) is a `Place`: a tile,
its `level`, and, when it is off the surface, the `Ladder` that reaches it,
given as the surface tile beside it and the tile beside it on the other floor.
Upstairs and underground are the same mechanism: underground maps are level 0
but 6,400 tiles north, so `floorOf` reads -1 for them and the level otherwise.
`travelPlan(from, to)` turns two places into legs: leave the current floor by
its ladder (climb down from upstairs, up from underground), pay the Al Kharid
toll gate if the two ladders' surface tiles are on opposite sides, climb to the
destination's floor, walk. Two places on one floor are a plain walk unless their
ladders are known to differ, so the Gnome Stronghold's grocers and bank, all
up the same ladder, never climb between them. The buyer remembers the ladder it
climbed; an account that starts off the surface takes the ladder of the nearest
known place on its floor (`ladderNear`), else climbs the nearest ladder in view.
The Magic Guild shop is upstairs with no ladder: its door needs Magic 66, so
its callers climb first, and the buyer then walks on that floor.

On the surface the walk also crosses scripted gates and doors that the
pathfinder treats as walls (`speedrun/lib/passages.ts`, the same crossings
questitems.ts uses): the Gnome Stronghold gate and the Grand Tree doors.

## Camping the Gnome Stronghold grocers

Heckel Funch (2493,3488) and Hudo (2448,3509) both sell chocolate bars and
chocolate dust (gnome.inv: stock 5 each, `stockrate` 100), and both stand on the
Stronghold's first floor (level 1, raised platforms whose ground tiles are
blocked). The way up is the Grand Tree's ladder at (2466,3495), inside the tree
doors; a ladder keeps x and z, so it lands on (2466,3494) level 1. From there
the tree bank (booths at 2448-2450,3481; `BANKS.gnomeStronghold`), Hudo and
Heckel are one walkable floor: 7-17 waypoints on the SDK's collision snapshot,
no further ladders, and the lab walked it without a retry. The route in from
Falador or Varrock is White Wolf Mountain, the Stronghold gate, the tree doors,
the ladder; see kandarin.ts for the Hitpoints that crossing needs.

Restocking is global and synchronous: on every tick that is a multiple of 100,
every line below its stock gains one unit (World.ts). So four lines (two items
at two shops) yield at most 4 units per 100 ticks, and a line visited less
often than every 500 ticks loses units to the stock cap of 5. The shelves are
shared, so other players buying compete for the same units.

```sh
ROLE_OPTIONS='{"campTicks":4000,"list":[
  {"item":"Chocolate bar","quantity":340,"source":"shop","shop":"heckel","maxWaitTicks":100},
  {"item":"Chocolate dust","quantity":340,"source":"shop","shop":"heckel","maxWaitTicks":100},
  {"item":"Chocolate bar","quantity":340,"source":"shop","shop":"hudo","maxWaitTicks":100},
  {"item":"Chocolate dust","quantity":340,"source":"shop","shop":"hudo","maxWaitTicks":100}
]}' bun speedrun/helpers/buyer.ts <account>
```

The two lines for one item share its target (quantities are holdings), so
either grocer fills it.

### Measured on the lab (2026-10-22, 300 ms ticks)

The list above with `campTicks` 4000, one account staff-teleported to Falador
with 30,000 coins and 70 Hitpoints, Attack, Strength and Defence, nobody else buying.

| Measure | Value | |
|---|---|---|
| Falador to the gnome bank, open | under 550 ticks (the world tick at the bank, counted from engine boot, so login and the teleport are inside it), including White Wolf Mountain, the gate and the tree doors, with no walk retry | measured (upper bound) |
| One camp pass (Heckel bars, dust, Hudo bars, dust) | 494-565 ticks, 20-23 units, with one bank trip when the pack fills | measured |
| A line's visit | about 104-108 ticks at the same shop (the 100-tick restock wait), about 140 between shops | measured |
| A bank trip from a shop and back | about 75 ticks on top of the visit | measured (Heckel, pass 2) |
| Camping rate, passes 2-6 | 110 units in 2,730 ticks: 4.03 per 100 ticks, the restock ceiling | measured |
| Whole run | 87 bars and 78 dust (165) in 4,073 ticks from the budget withdrawal, 1,026 gp spent | measured |
| Units per hour | about 480 at 300 ms ticks (240 at 600 ms), split evenly between bars and dust | inferred from the rate |
| 340 bars and 340 dust | about 85 minutes of camping at 300 ms ticks, uncontested | inferred |

The rate is set by restocking, not by walking: a shorter `maxWaitTicks` only
adds shop visits. A pass well under 500 ticks keeps every line from capping.

## How it buys

**Grand Exchange.** The buyer reads the live quote and places one buy offer at
the current **ask**, capped by `maxPrice`. That fills against the cheapest
sellers and never chases the book upwards; any quantity beyond the ask's depth
rests at the ask price. With no ask, or an ask above `maxPrice`, it places a
resting bid at `maxPrice` only if `maxPrice` was given, and skips the line
otherwise (`no sellers and no maxPrice`). A resting offer from an earlier run
counts toward the target and is collected by the next run (fills are collected
before holdings are counted, so a filled but uncollected offer is not bought twice); offers fill while
the account is offline. Coins in escrow for a resting offer are reported as
committed, not spent.

**Shops.** A shop's price rises by `haggle/1000` of base cost for every unit
its shelf is below the configured stock (market.md has the formula), and
**the SDK's `ShopItem.buyPrice` does not show this**: the state collector
computes it at the configured stock level
(`server/webclient/src/bot/StateCollector.ts`, stock difference 0). On the
demo, Aubury's air runes showed `buyPrice` 4 while the server charged 12-16,
because other players drain the shop to sell into the GE's 11 gp air-rune bid.
So the buyer buys one unit as a probe, measures what it paid, and from then on
buys in steps of at most 10 sized to stay under `maxPrice`, re-measuring after
every step. While the price is above the cap it predicts the price from the
shelf count (each restocked unit lowers it by one step) and waits, without
buying, until the prediction is under the cap or `maxWaitTicks` runs out.
Non-stackable purchases that fill the pack trigger a trip to the shop's bank
and back.

## Measured on the demo (2026-10-21, cairn_h60)

| Line | Result | Spent | Time |
|---|---|---|---|
| 12 Mithril arrowtips, GE, max 30 | 12 at the 24 gp ask, filled at once | 288 | under 10 s including openGE |
| 5 Shark, GE, max 950 | 5 at the 732 gp ask, filled at once | 3,660 | under 10 s |
| 100 Cosmic rune, GE, no max | skipped: no sellers and no maxPrice | 0 | |
| 300 Air rune, Aubury | 300 bought, before the live-price cap existed | 4,116 (13.7 each) | 35 s |
| 200 Feather, Gerrant | 200 bought | 640 (3.2 each) | 95 s including the walk from Varrock |
| 50 Eye of newt, Betty, max 5 | 50 bought, with one bank trip at 26 (non-stackable) | 151 (3.0 each) | about 60 s |
| +100 Air rune, Aubury, max 6 (cap test) | 1 probe bought at 12, then waited and stopped: price ~11.6 above 6 | 12 | 100-tick wait |

Total spent: 9,270 gp; the air runes cost about 3,000 gp more than they should
have, which is how the `buyPrice` problem was found. An intermediate version
of the wait loop re-probed every 10 ticks and bought 31 more air runes at 13
(403 gp) before the final fix.

## Gotchas

- **Local gateway and the market.** The SDK derives its market and
  GE-availability URLs from the gateway address, which is wrong behind a
  loopback gateway (`Unable to connect`). The buyer calls
  `pointMarketAtServer(sdk)` from mule.ts, which points it at `SERVER`.
- **The market in the lab.** `pointMarketAtServer` reads `SERVER` from the
  environment, and `speedrun/lab/role-smoke.ts` takes it from `bot.env`
  instead, so a lab run of this role needs `SERVER=localhost:<WEB_PORT>`
  exported, or the budget's market lookup fails with `Unable to connect`.
  Giving every line a `maxPrice` avoids the lookup.
- **Display names.** Trade and player lookups see `Cairn H60`, not
  `cairn_h60`: the server shows the underscore as a space. Use
  `playerPattern(account)` from mule.ts for any name match.
- **Cosmic runes cannot be bought** on the demo: no GE sellers, and the only
  shop is Lundail's in the Mage Arena (deep Wilderness, 20 stock). Blood runes
  should come from the Magic Guild (Magic 66) at 50 gp rather than the GE.
- Quantities are per account. The mule (rs/49) consolidates purchases across
  accounts.
