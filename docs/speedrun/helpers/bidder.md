# GE bidder role

`speedrun/helpers/bidder.ts` (role `bidder`, the "ge-bidder" mode of the buyer)
keeps a standing Grand Exchange buy offer for one item just above the competing
best bid, buys in tranches until a target quantity is held, and then parks. It
was written for grapes (item 1987), which gate the scored account's Cooking
(cairn://p/rs/47) and have no shop, so the only supply is players selling into
our bid. It reuses the buyer's bank, GE and travel helpers (`Buyer` in
`buyer.ts`).

## The rules

These are main's rules for the grape bid (cairn://p/rs/41), and the role
enforces them:

1. **Stay just above the competing bid.** The competing bid is the market's best
   bid excluding our own offers (below). Every recheck (`recheckMinutes`,
   default 30) compares it with ours. Only when someone bids above us do we
   cancel and re-place, at their price plus `outbidBy`. Otherwise the offer is
   left alone, which keeps its place in the queue.
2. **Our price never goes down.** A new tranche starts at the highest price this
   bidder has already bid, or at `minPrice`, whichever is higher, even if the
   competition has fallen away. Sellers answer the price they saw. On the demo,
   the first version dropped from 1,650 to 1,025 after a tranche filled, while
   a seller was asking 1,650. An open offer of ours below that floor (after a
   restart, or after `minPrice` was raised) is re-priced up.
3. **Tranches until the target.** While short of `target`, the bidder keeps
   about `tranche` resting on the book. When a quarter of the tranche has filled
   and we are still the best bid, it adds a top-up offer at the same price
   instead of cancelling anything. Once the target is held, it cancels what is
   still resting, logs `phase parked`, and stops bidding for good.
4. **Hard cap.** It never bids above `maxPrice`. A competitor at or above the
   cap gets one last raise to exactly `maxPrice` (never past it). After that,
   every recheck logs `capped` and holds. A human decides what happens next.
   Post it on cairn://p/rs/41.
5. **Collect promptly.** Fills count only once collected. Every recheck
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
| equal, others' escrow lower | others are below us, at an average of escrow / quantity (logged as `belowAvg`); their best price isn't visible |
| below ours, or none | the quote predates our offer (the API lags a placement by a few seconds), so it doesn't count as an outbid |

## Options

| Option | Default | Meaning |
|---|---|---|
| `item` | required | Name as the game spells it (`"Grapes"`) or id |
| `target` | required | Stop once this many are held: bank + inventory + collected fills on this account. Main's grape target is 520 (450 plus a 15% reserve). Wine accounts' grapes are counted separately. |
| `tranche` | 150 | Quantity kept resting while short of the target |
| `maxPrice` | 3000 | Hard cap per item |
| `minPrice` | 0 | Price floor, also the starting price when nobody else bids. Run the grape bid with 1650. |
| `outbidBy` | 25 | How far above the competing bid to place |
| `recheckMinutes` | 30 | Minutes between market rechecks |
| `fillCheckMinutes` | 3 | Minutes between peeks for fills waiting to be collected |
| `funders` | `^cairn_h\d+$` | Login-name RegExps whose trades are accepted as funding |

## The log

Each recheck ends with one `holdings` line:

```json
{"message":"holdings","item":"Grapes","held":171,"target":520,"offer":15957,"price":1650,
 "remaining":140,"offers":1,"competing":1000,"competingBelow":null,"coins":138717,"escrow":231000}
```

- `held`: items on this account after collecting and banking.
- `offer`, `price`, `remaining`, `offers`: our best open offer, its price, the
  quantity still resting across all our offers, and how many offers there are.
- `competing`: the best bid that isn't ours, when visible (null when ours is
  the best). `competingBelow`: the others' average when they are all below us.
- `coins`: coins banked and carried. `escrow`: coins locked in our resting offers.

Other lines: `decision` (action `hold` / `place` / `replace` / `done` / `short`
with the reason and the competition), `offer`, `cancel`, `ge collect`,
`funded`, `capped`, `short` (coins missing for a whole tranche), `waiting`
(a heartbeat every 10 minutes between rechecks, so the fleet's stall watchdog
stays quiet), and `phase` (`bid`, then `parked`).

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
reload`), logged in standalone, and put back afterwards.

An account with the exchange open answers trade requests with "busy". That is
why the bidder only opens the exchange for rechecks and short peeks and doesn't
keep it open between them. The funder retries its request every 8 seconds for 3
minutes.

## Running it

Standalone, on a loopback gateway (for example a dev gateway on port 7775, as for
any role child):

```sh
ROLE_OPTIONS='{"item":"Grapes","target":520,"tranche":150,"maxPrice":3000,"minPrice":1650}' \
  GATEWAY_URL=ws://127.0.0.1:7775 bun speedrun/helpers/bidder.ts cairn_h61
```

In the fleet (once merged and deployed):

```sh
fleetctl assign cairn_h61 bidder --options '{"item":"Grapes","target":520,"tranche":150,"maxPrice":3000,"minPrice":1650}' && fleetctl reload
```

The bidder starts by collecting and counting, so it adopts whatever offers the
account already has. Its price floor lives in memory, so pass `minPrice` to
carry the price across restarts.

**After the target.** A parked bidder stays parked only until it restarts. A
restarted bidder counts again, and if the grapes have since left the account
(handed to the wine makers), it would buy again. Reassign the account once
the target is reached.

## On the demo

- 2026-10-21 07:53 UTC: cancelled #15910 (94 at 1,050, unfilled) by hand, and
  placed #15914 at 1,650: 61 grapes, all h61's coins would buy. 16 filled at once
  against an ask at 1,623, and the rest within 15 minutes. The other bids
  were one 99,508-grape bid at 1,000.
- Sellers answer our price within minutes. Asks of 10-16 grapes at 1,623-1,650
  appeared after each of our bids and filled against them.
- The market API lagged our own placements and cancellations by a few seconds
  (a quote right after placing still showed the old best bid).
