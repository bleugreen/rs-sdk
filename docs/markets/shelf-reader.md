# Shelf reader

`markets/shelf/shelf-reader.ts` walks one account round a list of NPC shops and
records every shelf item's stock count and prices, with the UTC time, as JSON
lines. markets runs it on a fresh account to price the speedrun supplies table
(rs/503) and the method table (rs/502). It is read only: it never buys, sells,
trades, drops or uses the Grand Exchange.

## Running it

```sh
bun markets/shelf/shelf-reader.ts acct01 [--stops a,b,c] [--out file.jsonl] [--repeat N --every TICKS]
```

The account and host follow the helper-role convention in
`speedrun/helpers/role.ts` (`runStandalone`); nothing about the host is in the
reader:

- **Gateway path:** `bots/<account>/bot.env` (`SERVER`, `GATEWAY_URL`,
  credentials), with the account's lite client running
  (`cd server/webclient && bun src/lite/runner.ts <account>`).
- **Direct path:** `HELPER_PATH=direct` with `BOT_USERNAME`, `PASSWORD` and
  `SERVER` in the environment. The process logs in with its own client and logs
  out on exit.

The account may have any name; the reader doesn't check it against a pattern.

Options (also accepted as JSON in `ROLE_OPTIONS`; the flags win):

| Option | Default | Meaning |
|---|---|---|
| `--stops a,b,c` | the default route below | Stops to read, in this order. An unknown name fails before login. |
| `--out file.jsonl` | `markets/shelf/out/<account>-<UTC>.jsonl` (git-ignored) | Records are appended to this file, one line at a time, so a crash keeps what was read. |
| `--repeat N` | 1 | Read each stop on the route N times (rs/502's "do players empty a shelf?"). Meant for one stop. |
| `--every TICKS` | 100 | Ticks between the starts of repeated reads. The shop is closed in between. |

Progress lines go to stdout as JSON (`skip`, `shelf`, `voyage`, `toll gate`, `done`).

### What the account needs

- **80 coins in the inventory** for the whole default route: the Al Kharid toll
  twice (10 each way) and two voyages (Port Sarim to Karamja, Brimhaven to
  Ardougne, 30 each). The reader never visits a bank. A fresh account has its 25
  starting coins in the bank, so give it the fare first.
- **Ranged 40** (current level: the guild door checks `stat(ranged)`) for
  Dargaud. Train it separately with `speedrun/helpers/rune-arrows.ts`; the reader
  never trains.

A stop the account can't afford or doesn't qualify for is written as a `skip`
record with the reason, and the route moves on. The fare check counts the way
out of Al Kharid too, so a short purse never strands the account behind the toll
gate. A stop that fails (it can't walk there, or the shop won't open) is also a
`skip` with `failed: ...`, and the next stop is planned from wherever the account
ended up, including after a death and a respawn in Lumbridge.

## Stops

The table is data in `markets/shelf/stops.ts`. Each stop has the shopkeeper
pattern, a walk target, the content inventory, and any entry or requirement.
The default route, from the Lumbridge spawn:

| # | Stop | Shop | Content inv | Getting there |
|---|---|---|---|---|
| 1 | `general-lumbridge` | Lumbridge General Store | `generalshop1` | beside the spawn |
| 2 | `gemtrader` | Gem Trader, Al Kharid | `gemshop2` | toll gate (10), and 10 back |
| 3 | `aubury` | Aubury's Rune Shop, Varrock | `runeshop` | walk |
| 4 | `general-varrock` | Varrock General Store | `generalshop2` | walk |
| 5 | `zaff` | Zaff's Superior Staffs, Varrock | `memberstaffshop` or `staffshop` | walk |
| 6 | `drogo` | Drogo's Mining Emporium, Dwarven Mine | `miningstore` | Ice Mountain trapdoor down; ladder up |
| 7 | `general-falador` | Falador General Store | `generalshop4` | walk |
| 8 | `herquin` | Herquin's Gems, Falador | `gemshop` | walk |
| 9 | `grum` | Grum's Gold Exchange, Port Sarim | `goldshop` | walk |
| 10 | `betty` | Betty's Magic Emporium, Port Sarim | `magicshop` | walk |
| 11 | `jiminua` | Jiminua's Jungle Store, Karamja | `junglestore` | ship to Musa Point (30) |
| 12 | `davon` | Davon's Amulet Store, Brimhaven | `amuletshop` | walk across Karamja |
| 13 | `dargaud` | Dargaud's Bow and Arrows, Ranging Guild | `ranging_guild_bowshop` | ship to Ardougne (30); guild door, Ranged 40 |
| 14 | `hickton` | Hicktons Archery Emporium, Catherby | `archeryshop2` | walk out of the guild door |

Kandarin is reached by ship, never over White Wolf Mountain, whose wolves kill a
10-Hitpoints account. Travel reuses the speedrun walkers: `speedrun/lib/toll-gate.ts`
`travelTo` (toll gate, and the climb out of the Dwarven Mine) and
`speedrun/lib/ships.ts` `sailTo`. The trapdoor and the guild door are handled in
the reader itself, because the only existing code for them sits inside the buying
roles.

Zaff's shop is opened by a script (`zaff.rs2`): `memberstaffshop` (with
battlestaves) on a members world, `staffshop` otherwise. Each read records the one
whose configured stock matches the shelf; the lab is a members world.

Config only, never visited (a `skip` if named): `magicguild` (behind the Magic 66
door), `irksol` (not reachable by a fresh account), `lundail` (deep Wilderness).

`content.test.ts` checks every stop's inventory against the content: the
shopkeeper's `param=owned_shop`, or Zaff's `~openshop(...)` script call.

## Records

One JSON object per line, told apart by `kind`:

- `route`: the start (account, stops, coins, Ranged, position).
- `shop`, once per read of a stop: `shopTitle`, `inv`, `shopConfig` as the SDK
  reports it, `haggle` (the shop's real haggle from the content), item count,
  position, and `legMs`/`legTicks`, the walk from the previous stop.
- `item`, one per shelf slot: `utc`, `stop`, `read`, `shopTitle`, `inv`, `slot`,
  `itemId`, `name`, `obj` (content debug name), `count`, `stockBase` (the
  configured stock, or null when the item isn't in the base config),
  `inBaseConfig` (false for stock players sold into a general store), `baseCost`,
  `buyPrice` and `sellPrice` (the SDK's), `valuePrice` (the server's),
  `computedBuyPrice` and `computedSellPrice`, and `tick`.
- `skip`: a stop not read, with the reason.
- `done`: stops read and skipped, `aborted`, and the route's `wallMs` and `ticks`.

The content fields (`obj`, `stockBase`, `inBaseConfig`, the computed prices,
`haggle`) come from this checkout's `server/content` and `obj.pack`. Without them
the reader still runs, and those fields are null.

## Prices

Use `valuePrice`. The SDK's `buyPrice` and `sellPrice` are wrong for any shelf
that isn't at its configured stock.

- **`valuePrice`** is the server's own price for the next unit: the shop's
  Value option (`[inv_button1,shop_template:inv]` in `shop.rs2`) answers
  "<name>: currently costs <n>gp." The reader values every slot, in batches of
  five. Answers are matched to slots in click order, because one shop can hold two
  objects with the same name (Betty's two "Wizards hat").
- **`computedBuyPrice` / `computedSellPrice`** apply `shop.rs2`'s formula
  (`calc_shop_value`, `price_mod`) to the shelf count, using the content's
  configured stock and haggle. Stock outside the base config is reckoned from its
  whole count, so a general store's price falls as it holds more. The sell side
  has no Value message (the item must be in the player's pack), so
  `computedSellPrice` is the only live sell figure.
- **`buyPrice` / `sellPrice`** are the SDK's (`StateCollector` `calcShopValue`
  with the stock difference fixed at 0). They are right only at the configured
  stock. The SDK's `shopConfig.haggle` is also always 10, its fallback: varp
  `shop_haggle` isn't transmitted to the client (`shop.varp`), unlike `shop_buy`
  and `shop_sell`. The general stores' real haggle is 30, Drogo's and Zaff's 20.
  The SDK defect is tracked separately by rs/495; the reader works around it and
  leaves the SDK alone.

Evidence (lab, 400 ms ticks, `markets/shelf/lab/buy-check.ts`, a throwaway that
buys and is not the reader). At Aubury's death runes (configured 1,000, base cost
30):

| Shelf before | SDK `buyPrice` | Server Value | Bought | Charged |
|---|---|---|---|---|
| 1,000 | 30 | 30 | 1 | 30 (matches Value) |
| 999 | 30 | 30 | 10 | 312 |
| 989 | 30 | 33 | 10 | 342 |
| 979 | 30 | **36** | - | - |

After 10 of those death runes were sold into the Lumbridge general store
(`generalshop1`, which doesn't stock them), the SDK said 39 and the server said 30.
On the following full route, the computed buy price equalled the server's Value on
all 158 slots of all 14 shops. That includes the drained Aubury shelf (981 left:
Value 35) and the sold-in stock (10 death runes, `inBaseConfig: false`, Value 30).

## Exporting to the supplies table

```sh
bun markets/shelf/export-supplies.ts readings.jsonl... [--to markets/supplies/data/shelf.json]
```

This merges the readings into rs/503's data file, an array of
`{inv, obj, count, price, at}` with content names. `price` is `valuePrice`, else
`computedBuyPrice`, and only then `buyPrice`; `at` is the reading's `utc`. Each
(inv, obj) keeps its newest reading. Entries already in the file are kept in place,
and lines without content names are reported and left out.

## Read only

The role never holds the raw bot or SDK. `markets/shelf/read-only.ts` wraps both
in views that refuse, by name, every shop buy or sell, Grand Exchange, trade and
drop method, including anything added later under those words. That covers the
speedrun walkers the reader hands the views to. The one inventory-button click
the reader sends, the shop's Value, is allowed only as option 1 on the shop stock
component (3900); options 2-4 there are Buy 1/5/10. `read-only.test.ts` checks the
refusals against the real SDK classes. It also checks that the reader's own
sources never name a trading method and import only an allowlist of modules.

The scripts in `markets/shelf/lab/` are lab-only fixtures and sit outside that
guard: `buy-check.ts` buys and sells on purpose.

## Lab

Developed and verified only in the local lab (cairn://skills/speedrun-lab), on
fedora, port block M5: WEB 9940, MGMT 9941, HISCORES 9942, NODE 44940, AGENT 7708
(FRIEND 45940, not used). `NODE_TICKRATE=400`. On a fresh build slot, install the
root, `server/webclient` and `server/engine` dependencies in the same batch first
(cairn://skills/executor-batches).

```sh
NODE_TICKRATE=400 WEB_PORT=9940 WEB_MANAGEMENT_PORT=9941 HISCORES_WEB_PORT=9942 NODE_PORT=44940 AGENT_PORT=7708 \
  LAB_HELPERS=<helper bot> speedrun/lab/lab.sh <lab bot> \
  'markets/shelf/lab/buy-check.ts:--as=<helper bot>' \
  'markets/shelf/lab/route.ts:--coins=80:--ranged=40:--out=/tmp/shelf.jsonl'
```

`lab/route.ts` stages the account with staff commands (`::give coins`,
`::setstat ranged`) after the lab's tutorial skip, then runs the reader.

Samples, with the account names replaced:

- `markets/shelf/samples/lab-route-2026-10-22.jsonl`: the 14-stop run, with the
  route and done lines, all of the Lumbridge general store and Aubury, and
  Dargaud's rune arrows and arrowtips.
- `markets/shelf/samples/lab-skips-2026-10-22.jsonl`: a fresh account with no
  coins and Ranged 1, asked for `dargaud,jiminua,gemtrader,aubury`. It skipped the
  first three with reasons and read Aubury. This run predates the `haggle` field.

## Timing

A fresh lab account (10 Hitpoints, 80 coins, Ranged 40) on 400 ms ticks:

| Route | Wall time | Ticks |
|---|---|---|
| 14 stops (the default) | 500.6 s (8 min 21 s) | 1,251 |
| the first 10 stops only, before the general stores and Zaff | 469.9 s | 1,174 |

The route is tick-bound: 1,251 ticks at 400 ms is 500 s. Legs in ticks, from the
14-stop run, each ending with the shop open (shop reads add 2-5 ticks):

| Leg to | Ticks | | Leg to | Ticks |
|---|---|---|---|---|
| general-lumbridge | 20 | | herquin | 25 |
| gemtrader (toll) | 87 | | grum | 84 |
| aubury (toll back) | 178 | | betty | 13 |
| general-varrock | 34 | | jiminua (ship) | 167 |
| zaff | 13 | | davon | 48 |
| drogo (trapdoor) | 129 | | dargaud (ship, guild door) | 170 |
| general-falador (ladder up) | 89 | | hickton | 104 |

On the demo, allow the same ticks plus login and any walk retries. Schedule about
10 minutes for the route; 15 is a safe slot. The account was never attacked on
the route in the lab, and ends in Catherby.
