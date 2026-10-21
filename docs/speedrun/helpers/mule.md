# Mule, courier and hand-off giver

`speedrun/helpers/mule.ts` holds three things the helper economy needs around the
gatherers:

- **mule** (role `mule`): an account standing in Varrock west bank (3185,3436) that
  takes stock in from couriers, keeps it in its bank, hands prepared packages to the
  scored account, and lists items on the Grand Exchange.
- **courier** (role `courier`): one trip that any helper account can be switched to.
  It carries that account's produce, as banknotes, to the mule.
- **the scored account's side**: `receivePackage` (and `requestPackage`), the calls the
  speedrun makes to take a package from the mule.

Accounts: `cairn_mule1` is the mule; `cairn_mule2` is reserved for a second one (never
logged in yet, so it does not exist on the demo until its first login).
`cairn_h05` stood in for the scored account in tests.

## Why it is shaped this way

Every hand-off tick is on the scored account's clock. The stock SDK giver offers one
item at a time and waits to see each one land, so the receiver pays roughly two ticks
per stack. The engine reads up to 5 user packets per player per tick and carries the
rest to the next tick, in order (`NetworkPlayer.ts`, `ClientGameProtCategory.ts`).
The lite client executes one queued action every 20 ms. So the giver can send every
"Offer All" plus its accept in one burst, and the server applies them over
`ceil((stacks + 1) / 5)` ticks with the accept after the last offer.

Two more facts from `interface_trade/scripts/trade.rs2` shape the protocol:

- A trade request opens the trade at once when the target already has a pending
  request from the requester. The mule therefore **pre-requests**: when a package is
  ready and the scored account comes within 12 tiles, the mule sends it a trade
  request (which also walks the mule next to it). The scored account's own request
  then opens the trade on the tick it lands.
- Every offer change resets both accepts, so an accept before the last offer is
  wasted. The giver accepts after its burst. The receiver accepts on the tick the
  offer satisfies its `want`, or, without `want`, the tick it sees the mule's accept.

Safety is unchanged from the SDK. The giver checks, on both screens, that the partner
is exactly the configured account (display names are compared in canonical form:
`cairn_dot_md` shows as `Cairn Dot Md`) and that its own offer is exactly the package
by item id and count. Any mismatch declines, and nothing changes hands.
`receivePackage` re-checks `want` on the confirm screen.

## Measured hand-off cost (receiver's clock, 300 ms ticks)

Scripts: `docs/speedrun/scripts/mule-handoff.ts` (receiver side; it reports ticks from
its trade request to the items in its inventory, and to the receiver function
returning) with `mule-lab-stock.ts`, `mule-lab-packages.json` and
`mule-demo-packages.json`. Every row is three rounds; values are means.

Local lab (engine at `NODE_TICKRATE=300`, loopback gateway, 100 noted per stack):

| Giver | Pre-request | Receiver | 1 stack | 10 stacks | 23 stacks |
|---|---|---|---|---|---|
| stock (`bot.trade`) | no | stock (`bot.trade` + want) | 5 / 8 | 14 / 17 | 27.7 / 30.7 |
| burst | yes | stock | 4 / 7 | 5 / 8 | 8 / 11 |
| burst | no | fast (`receivePackage`) | 5.3 | 6 | 9.3 |
| burst | yes | fast | **4** | **5** | **8** |

The first number is ticks to the items in the inventory; the second is ticks to the
receiver function returning (the same for the fast receiver). The stock receiver
spends 3 more ticks after completion classifying the closed screen.

Demo server (`cairn_mule1` -> `cairn_h05`, both on a loopback gateway on bbs; the
mule held the 20 item types it had, so 20 stacks instead of 23):

| Giver, receiver | 1 stack | 10 stacks | 20 stacks |
|---|---|---|---|
| stock, stock (no pre-request) | 8 / 11 | 24.3 / 27.3 | 43.3 / 46.3 |
| burst + pre-request, fast | **6.7** (4, 8, 8) | **8** (7, 9, 8) | **10** (9, 11, 10) |

The demo runs two to three ticks behind the lab because its state reaches the bot a
tick later; the shape is the same. Measure through the demo's public gateway and its
2-5 s stalls swamp the numbers, so the fleet's loopback gateway matters.

## How the scored run takes a package

1. **Configure the packages** in the mule's options, in the order the run will pull
   them (`serveMode: 'order'`, the default). Each package is a list of
   `{ item, amount, noted? }` with exact item names. Noted items take one slot each.
   A package must fit the scored account's free inventory slots (stackable items it
   already holds merge).
2. **Arrive** in Varrock west bank with no modal open (the trade request is refused
   while a bank or shop is open on either side; `receivePackage` retries through
   "busy" for the mule's side) and with enough free slots.
3. **Call** `receivePackage(sdk, bot, { mule: 'cairn_mule1', want })` with `want`
   listing the package (for example `[{ item: /^Shark$/i, amount: 100 }]`). It sends
   one trade request, accepts the tick the offer is complete, re-verifies, and returns
   the tick the items land: about **4 + stacks/5 ticks** (4, 5 and 8 measured).
   It gives nothing.
4. Deposit or use the items; that is the run's own step.

The mule needs time between hand-offs to withdraw the next package: two to three
seconds per item type of its own time (no scored ticks), so about a minute for 23
types. Back-to-back hand-offs closer than that should alternate between two mules.

**Choosing a package by request.** `serveMode: 'request'` serves only a package that
was asked for, through `requestFile`: a file on the mule's host where each line is a
package name (`echo wine1 >> <file>` over ssh, from whatever drives the run). The
mule pops one line per request, withdraws that package, and pre-requests the scored
account when it is near. `requestPackage(sdk, mule, name)` sends the same name by
private message, but in our tests no private message reached the mule, on the lab or
on the demo (the engine relays PMs only through its friends server), so treat PMs as
unavailable.

**Hazard: a stale request.** If the scored account requested a trade the mule never
answered, the mule's pre-request accepts it and opens a trade the run did not ask
for yet. The giver declines after 30 s. The run should decline any trade screen it
did not open itself, and request trades only through `receivePackage`.

**Order mode and giving back.** In `order` mode every trade from the scored account
takes the next package. A trade from the scored account while no package is pending
is receive-only: the mule accepts any non-empty offer and banks it. A session that
stays empty is declined after 30 s.

## Consolidation: couriers

Banks are shared across every booth, so a courier does not carry anything across the
map: it walks to Varrock west bank, deposits any matching items it carries (the bank
un-notes notes), withdraws every matching item as notes (up to its free slots), trades
them to the mule, repeats while the bank holds more, banks anything left over if a
trade fails, and walks back to where it started. Restarting it at any point is safe:
an open trade is declined (both sides keep their items) and the bank is the source of
truth for what is left.

Options: `{ mule: 'cairn_mule1', items: ['^logs$', 'oak logs'], minStacks?: 1, returnHome?: true }`.
`items` are case-insensitive RegExp sources matched against item names. The mule
accepts couriers whose login name matches `couriers` (default `^cairn_h\d+$`).

Cadence: consolidation only matters for what the scored account will take from the
mule, since the ledger already counts every helper's bank. Run each gatherer's
courier trip once a day, and before a run segment that pulls its supply. A trip costs
the helper its walk to Varrock plus about 10 s at the bank per load (measured: 12 item
types in one trade, `cairn_h05` -> `cairn_mule1`, 8 s from bank to trade done). The
mule's bank has 288 slots, one per item type, which covers the whole supply list.

## Grand Exchange

`ge: { orders: [{ item, quantity, price, fill? }], collectEveryMin?: 10 }`.
The GE is the table on the west side of Varrock west bank, a few tiles from the mule.

- A sell order withdraws `quantity` (or `'all'`) of the bank item as notes and lists
  it at `price`. An order already listed at that price is not listed again.
- `fill: true` is for the scored account's standing buy offers: it lists only while
  the market's best bid equals `price`, so the fill goes to that bidder and not to a
  higher one, capped at the bid's open quantity.
- Every `collectEveryMin` the mule opens the exchange, collects proceeds and
  leftovers as notes and coins, and banks them on its next bank visit.

Measured on the demo: `cairn_h05` bid 5 logs at 5 gp; the mule's `fill` order listed
5 logs at 5 gp and filled 5/5 at once; the next collection took 24 gp (5% seller tax).
Each GE visit costs the mule about 13 ticks to open, and the mule answers trade
requests with "busy" while the exchange is open.

The SDK derives its market and GE origin from the gateway URL, so behind a loopback
gateway it asks `localhost:8888` and every GE action fails with "Unable to connect".
`pointMarketAtServer(sdk)` (exported) points it at `SERVER`; the mule calls it at start.

## Running it

Standalone, from the repo root, with the account's lite client running:

```sh
ROLE_OPTIONS='{"serve":"cairn_dot_md","packages":[{"name":"food","items":[{"item":"Shark","amount":200,"noted":true}]}]}' \
  bun speedrun/helpers/mule.ts cairn_mule1
ROLE_OPTIONS='{"mule":"cairn_mule1","items":["^logs$"]}' bun speedrun/helpers/mule.ts cairn_h10 courier
```

Mule options: `serve` (the scored account), `couriers` (default `^cairn_h\d+$`),
`packages`, `serveMode` (`order` | `request`), `requestFile`, `giver` (`burst` |
`stock`), `preRequest` (default true), `stand` (default 3185,3436), `ge`.

In the fleet: one mule account is enough; a second (`cairn_mule2`) helps only for
back-to-back hand-offs or while the first is at the GE. The module exports `role`
(mule), `courier` and `roles`. A courier trip ends when the trip is done, so the
fleet should assign `courier` for one run and then give the account its gathering
role back. The mule logs `phase` lines (`idle`, `consolidate`, `serve`, `ge`), a
`hand-off` line per package with the giver's ticks, and calls `reportBank` after
every bank visit. Its role has `produces: []`: it holds stock rather than producing
it, so the ledger should attribute the mule's bank by account, not by role.

The giver sits behind one function, `giveOpenTrade(sdk, bot, partner, items, mode)`.
When `speedrun/lib/trade.ts` (rs/40) lands, its giver can replace the burst body
there without touching the mule.
