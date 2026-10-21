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
at Varrock west before it starts. Run the lite client against a local gateway
like every other role (see coins.md).

| Line field | Meaning |
|---|---|
| `item` | Name as the game spells it (`Feather`, `Mithril arrowtips`) or the item id. Names that 2004 shares between items (`Herb`, `Unfinished potion`) must be given by id: market.md has the id table. |
| `quantity` | **Target holdings** (bank + inventory), not an amount to add. A restart, or running the same list again, buys only the shortfall. |
| `maxPrice` | Highest unit price to pay. GE: the bid price when there is no ask at or below it. Shop: the cap on the live price (default 3x the item's base cost). |
| `source` | `ge` or `shop`. |
| `shop` | For shop lines, a key of `SHOPS` in buyer.ts: `aubury`, `gerrant`, `betty`, `lumbridgeGeneral`, `varrockGeneral`, `zeke`, `nurmof`, `wayne`, `peksa`, `shantay`, `louie`, `lowe`, `dargaud`. Adding a shop is one entry: the shopkeeper's NPC name, a tile beside them, and the nearest bank. |
| `maxWaitTicks` | Shop lines: how long to wait for restocks when the shelf is empty or the price is above `maxPrice` (default 300 ticks). |

GE lines run first (at Varrock west, where the budget is withdrawn), then the
shop lines in list order, so order shop lines along a sensible route. The
buyer starts from anywhere, including the tutorial and Al-Kharid (it pays the
toll out).

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
- **Display names.** Trade and player lookups see `Cairn H60`, not
  `cairn_h60`: the server shows the underscore as a space. Use
  `playerPattern(account)` from mule.ts for any name match.
- **Cosmic runes cannot be bought** on the demo: no GE sellers, and the only
  shop is Lundail's in the Mage Arena (deep Wilderness, 20 stock). Blood runes
  should come from the Magic Guild (Magic 66) at 50 gp rather than the GE.
- Quantities are per account. The mule (rs/49) consolidates purchases across
  accounts.
