# GE bidder role

`speedrun/helpers/bidder.ts` (role `bidder`, the "ge-bidder" mode of the buyer)
keeps standing Grand Exchange buy offers for a list of items, each just above
its competing best bid. It buys in tranches until each line's target is held,
then parks. It runs the speedrun's two player-supplied inputs with no shop:
grapes (item 1987, the scored account's Cooking, cairn://p/rs/47) and dragon
bones (item 536, Prayer, cairn://p/rs/48). One account runs every line, and
each line is one entry in `lines`, so adding an item is one more entry, not a
second implementation. It reuses the buyer's bank, GE and travel helpers
(`Buyer` in `buyer.ts`).

## The rules

These are main's rules (cairn://p/rs/41), and the role enforces them per line:

1. **Stay just above the competing bid.** The competing bid is the market's best
   bid excluding our own offers (below). Every recheck (`recheckMinutes`,
   default 30) compares it with ours. Only when someone bids above us do we
   cancel and re-place: at their price plus `outbidBy`, or in step mode at the
   first whole `step` above them, counted from our own price. Otherwise the
   offer is left alone, which keeps its place in the queue.
2. **Our price never goes down.** A new tranche starts at the highest price this
   bidder has bid, or at `minPrice`, whichever is higher, even if the
   competition has fallen away. Sellers answer the price they saw. On the demo,
   the first version dropped from 1,650 to 1,025 after a tranche filled, while
   a seller was asking 1,650. An open offer of ours below that floor (after a
   restart, or after `minPrice` was raised) is re-priced up.
3. **Step mode: no fills means step up, never jump.** With `step` and
   `stepAfterIdleMinutes` set (dragon bones: 1,000 and 60), a line that has seen
   no fill for that long raises by exactly one step. A raise for any reason
   restarts the idle clock. Sellers of bones fill the top bid at once, so there
   is never an ask to read; silence is the signal.
4. **Tranches until the target.** While short of `target`, a line keeps about
   `tranche` resting. When a quarter of the tranche has filled and we are still
   the best bid, it adds a top-up offer at the same price instead of cancelling
   anything. A top-up is never smaller than a quarter tranche, and a line holds
   at most 2 offers (`MAX_OFFERS_PER_LINE`). **An account has 6 offer slots on
   this server** (`OFFER_SLOTS` in `server/engine/src/engine/market/MarketStore.ts`),
   so 2 lines leave 2 slots spare. Once a line's target is held, it cancels what
   is still resting and stops bidding for good. When every line has, the role
   logs `phase parked`.
5. **Hard cap.** It never bids above `maxPrice`. A competitor at or above the
   cap, or an idle step past it, gets one last raise to exactly `maxPrice`
   (never past it). After that, every recheck logs `capped` and holds. A human
   decides what happens next; post it on cairn://p/rs/41 with the fill history
   from the holdings lines.
6. **Coins go to lines in list order.** Each line reserves the coins it wants
   beyond what it has placed: the unfunded part of its tranche, or a top-up
   that is waiting for a free slot or for enough coins. The lines after it
   spend only the coins above all earlier reservations. Put the line that
   matters most first (dragon bones, by main's call). On the demo, before
   slot-waiting top-ups reserved anything, grapes took a whole 215k funding
   round while bones waited for a slot.
7. **Collect promptly.** Fills count only once collected. Every recheck
   collects and banks first. Between rechecks the bidder peeks at its offers
   every `fillCheckMinutes` (default 3) and runs an early cycle (at most one
   per 2 minutes) when a fill is waiting, so escrowed coins don't sit idle.

## Telling our offer apart from the market's

The market API (`sdk.getMarketItem`) gives the best bid plus the totals of
every open bid: `buyQuantity`, and `buyValue`, the coins in escrow. Our own
offers come from the open exchange (`getGEState().offers`). `competingBid`
subtracts ours from the totals, and the rest belongs to others:

| Market best bid vs our price | Meaning |
|---|---|
| above ours | outbid: the best bid is someone else's |
| equal, and nothing left after subtracting ours | we are alone |
| equal, others' escrow = others' quantity x our price | a tie: they all sit at our price, and we placed first, so we keep priority |
| equal, others' escrow lower | others are below us, at an average of escrow / quantity (logged as `competingBelow`); their best price isn't visible |
| below ours, or none | the quote predates our offer (the API lags a placement by a few seconds), so it doesn't count as an outbid |

## Options

Role options are `{ "lines": [ ...line options... ], "recheckMinutes", "fillCheckMinutes", "funders" }`.
Without `lines`, the options themselves are a single line.

| Line option | Default | Meaning |
|---|---|---|
| `item` | required | Name as the game spells it (`"Grapes"`, `"Dragon bones"`) or id |
| `target` | required | Stop once this many are held: bank + inventory + collected fills on this account. Main's targets: grapes 520 (450 plus a 15% reserve; wine accounts' grapes are counted separately), dragon bones 555 (11 early + bulk). |
| `maxPrice` | required | Hard cap per item (grapes 3,000, bones 12,000) |
| `tranche` | 150 | Quantity kept resting while short of the target |
| `minPrice` | 0 | Price floor, also the starting price when nobody else bids |
| `outbidBy` | 25 | How far above a competing bid to place, outside step mode |
| `step` | none | Step mode: prices move in whole steps from our own price |
| `stepAfterIdleMinutes` | none | Step mode: one step up after this long without a fill |

| Role option | Default | Meaning |
|---|---|---|
| `recheckMinutes` | 30 | Minutes between market rechecks |
| `fillCheckMinutes` | 3 | Minutes between peeks for fills waiting to be collected |
| `funders` | `^cairn_h\d+$` | Login-name RegExps whose trades are accepted as funding |

The options cairn_h61 runs with:

```json
{"lines":[
  {"item":"Dragon bones","target":555,"tranche":30,"maxPrice":12000,"minPrice":6000,"step":1000,"stepAfterIdleMinutes":60},
  {"item":"Grapes","target":520,"tranche":150,"maxPrice":3000,"minPrice":1650}],
 "recheckMinutes":30}
```

## The log

Each recheck ends with one `holdings` line per line:

```json
{"message":"holdings","item":"Grapes","held":255,"target":520,"offer":16035,"price":2343,"remaining":67,"offers":1,
 "filledSinceLast":0,"lastFillAt":"2026-10-21T09:06:29.916Z","competing":2318,"competingBelow":null,"otherDepth":99681,
 "competitorMoved":null,"traded":{"lastPrice":2318,"at":"2026-10-21T09:03:36.482Z","volume7d":826,"volumeDelta":null},
 "coins":2136,"escrow":156981}
```

- `held`: items on this account after collecting and banking.
- `offer`, `price`, `remaining`, `offers`: our best open offer, its price, the
  quantity still resting across the line's offers, and how many there are.
- `filledSinceLast`, `lastFillAt`: our fills collected since the last holdings
  line, and when the line last saw a fill. A raise also resets `lastFillAt`,
  because it restarts the idle clock.
- `competing`: the best bid that isn't ours, when visible (null when ours is
  the best). `competingBelow`: the others' average when they are all below us.
  `otherDepth`: the quantity everyone else bids.
- `competitorMoved`: `{from, to}` bid and depth when the competition changed
  since the last recheck (also logged as its own `competitor` line).
- `traded`: the market's last trade price and time, and the 7-day volume, when a
  trade has happened since the last recheck. These are the visible fills,
  ours or anyone's.
- `coins`: coins banked and carried (shared by all lines). `escrow`: coins
  locked in this line's resting offers.

Other lines: `decision` (action `hold` / `place` / `replace` / `done` / `short`
with the reason, the coins available to the line, the reservations ahead of it,
and the competition), `offer`, `cancel`, `ge collect`, `funded`, `capped`,
`short` (coins a line is missing for its tranche), `waiting` (a heartbeat every
10 minutes between rechecks, so the fleet's stall watchdog stays quiet), and
`phase` (`bid`, then `parked`).

## Funding

GE offers are paid from the inventory, so the bidder carries every coin it owns
during a recheck and banks the rest afterwards. When it logs `short`, add
coins: earners' banks hold them (see `~/rs-fleet/stockpile.json`). The same
file has a one-trip funding mode for an earner:

```sh
ROLE_OPTIONS='{"bidder":"cairn_h61","keep":1000}' bun speedrun/helpers/bidder.ts cairn_h60 fund
```

The earner walks to Varrock west bank, withdraws its coins (all of them, or
`amount`, leaving `keep` in the bank for the coin role's toll and kebabs), and
trades them to the bidder with `speedrun/lib/trade.ts`'s `give`. The bidder
notices the trade request (chat type 4) from an account matching `funders`,
answers with `receiveFrom`, and gives nothing. The earner has to be taken out of
the fleet for the trip (`fleetctl assign <earner> coins --disable && fleetctl
reload`), logged in standalone, and put back afterwards. Each trip costs the
earner about 5 minutes.

The trip also funds any other receiver that accepts trades at Varrock west
bank (the fletcher's camper, for one), and with `item` it carries a stackable
item instead of coins, with `amount` and `keep` counted in that item:

```sh
ROLE_OPTIONS='{"bidder":"cairn_h78","item":"Feather","amount":4245}' bun speedrun/helpers/bidder.ts cairn_h01 fund
```

An account with the exchange open answers trade requests with "busy". That is
why the bidder only opens the exchange for rechecks and short peeks and doesn't
keep it open between them. The funder retries its request every 8 seconds for 3
minutes.

## Running it

Standalone, on a loopback gateway (for example a dev gateway on port 7775, as for
any role child):

```sh
ROLE_OPTIONS="$(cat bidder-options.json)" GATEWAY_URL=ws://127.0.0.1:7775 bun speedrun/helpers/bidder.ts cairn_h61
```

In the fleet (once merged and deployed):

```sh
fleetctl assign cairn_h61 bidder --options "$(cat bidder-options.json)" && fleetctl reload
```

The bidder starts by collecting and counting, so it adopts whatever offers the
account already has. Its price floor and idle clock live in memory, so pass
`minPrice` to carry the price across restarts. A restart also restarts the idle
clock.

**After a target.** A line that has reached its target stays stopped only until
the role restarts. A restarted bidder counts again, and if the items have since
left the account (grapes handed to the wine makers, bones to the mule), it
would buy again. Remove the line, or reassign the account, once a target is
reached.

## On the demo (2026-10-21)

- 07:53 UTC: cancelled #15910 (94 at 1,050, unfilled) by hand, and placed
  #15914 at 1,650: 61 grapes, all h61's coins would buy. 16 filled at once
  against an ask at 1,623, and the rest within 15 minutes. The rest of the
  book was one 99,508-grape bid at 1,000.
- Overnight, grape sellers answered 1,650 at about 28 grapes per 6-12 minutes,
  in asks of 10-28. At 09:03 a second grape buyer bid 2,318; the bidder
  re-placed at 2,343 (#16035).
- 08:57: 11 dragon bones at 6,000 (#16015), above a 5,000 bid for about 1,250
  bones. Bones trade about 15 an hour, in lots of 9-41.
- The market API lagged our own placements and cancellations by a few seconds
  (a quote right after placing still showed the old best bid).
- A demo login outage at 08:22 dropped every account for about 2 minutes; the
  bidder resumed by itself after its client logged back in.
