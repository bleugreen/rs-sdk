# Mule, courier and hand-off giver

`speedrun/helpers/mule.ts` holds three things the helper economy needs around the
gatherers:

- **mule** (role `mule`): an account standing in Varrock west bank (3185,3436) that
  takes stock in from couriers, keeps it in its bank, hands prepared packages to the
  scored account, and lists items on the Grand Exchange.
- **courier** (role `courier`): one trip that any helper account can be switched to.
  It carries that account's produce, as banknotes, to the mule.
- **the scored account's side**: `requestPackage` (a cue asking for the hand-off's package) and
  `receivePackage`, the calls the speedrun makes to take a package from the mule.

Accounts: `cairn_mule1` is the mule. `cairn_mule2` runs the rehearsal kit giver
([kits.md](kits.md)) outside the fleet.
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
`cairn_h05` shows as `Cairn H05`) and that its own offer is exactly the package
by item id and count. Any mismatch declines, and nothing changes hands.
`receivePackage` re-checks `want` on the confirm screen.

The one exception is a decline sent after our own confirm accept: the partner's
accept can complete the trade before the decline lands. `speedrun/lib/trade.ts`
then judges the trade by its effect, and only on the server's word: the browser
client closes the trade screen locally the moment it declines, before the server
has refunded anything. The giver reports failure once its offered items come
back, success once they stay gone and the server sends "Accepted trade.", and
an unsettled failure if neither arrives. The receiver reports success only for
items that actually arrived.

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
   `{ item, amount, noted? }` with exact item names, or `{ id, amount, noted? }` with an
   obj id where names collide: in this revision every unfinished potion is "Unfinished
   potion" and every grimy herb "Herb", so H21e's potion types are told apart only by id
   (`server/content/pack/obj.pack`; guam unf 91, ranarr unf 99). An id may be the item's
   or its note's (`cert_<name>` in the pack, resolved by `speedrun/lib/obj-pack.ts`): the
   bank holds the item, and a note's id asks for a noted withdrawal (`noted: false` with
   one is refused). The mule stages, checks and offers by id, so one type never stands
   in for another. A name that matches two different bank items is never resolved to the
   first: the package is reported short (`ambiguous` in the log) until it names ids.
   Noted items take one slot each. A package must fit the scored account's free
   inventory slots (stackable items it already holds merge).
2. **Arrive** in Varrock west bank with no modal open (the trade request is refused
   while a bank or shop is open on either side; `receivePackage` retries through
   "busy" for the mule's side) and with enough free slots.
3. **Call** `receivePackage(sdk, bot, { mule: 'cairn_mule1', want })` with `want`
   listing the package (for example `[{ item: /^Shark$/i, amount: 100 }]`). It sends
   one trade request, accepts the tick the offer is complete, re-verifies, and returns
   the tick the items land: about **4 + stacks/5 ticks** (4, 5 and 8 measured).
   It gives nothing.
4. Deposit or use the items; that is the run's own step.

The mule needs time between hand-offs to bank and withdraw the next package, on its
own clock: about 12 s for a 23-type noted package in the lab. Back-to-back hand-offs
closer than that should alternate between two mules.

**Choosing a package by cue.** Every mule package is keyed by a scope
`{ step: <hand-off id>, family: 'mule' }` (`H12`, `H4e`): the hand-off id, not the step id,
because one step can be fed by two mule trades (S07's end can need H4e beside the bone loads).
The scored side asks for a package with `requestPackage(cueDir, receiver, 'H12', beacon)`, which
writes `cue.json` in the cue directory through altar-cue.ts's `CueWriter` with that scope: the
run machine's one channel to the givers, the same directory the top-up asks use. Each cycle the
mule reads the cue (`readCue`); a new one (a new session or a later write, and none older than
the mule's start less a minute) that names the account it serves (by name hash) and addresses
one of its packages (`cueAddresses`, `packageForCue`) makes that package the next one: the mule
withdraws it and pre-requests the scored account when it is near. A cue session asks once
(`muleCueAction`): a later write of the same session (fresh beacons) asks nothing again, so a
served package is never re-staged by its own cue, and a write with `stop` withdraws the request
(a still-pending package is banked). So one writer per hand-off, the run's cue keeper or
`requestPackage`, may rewrite and stop its cue freely. `serveMode: 'request'` serves
only packages asked for this way; in `'order'` mode a cue still asks for any package (a
fallback marked `onRequest`). There is no request file and no private-message request: a config
with `requestFile` is refused.

**Hazard: a stale request.** If the scored account requested a trade the mule never
answered, the mule's pre-request accepts it and opens a trade the run did not ask
for yet. The giver declines after 30 s. The run should decline any trade screen it
did not open itself, and request trades only through `receivePackage`.

**Top-up lines.** The ledger's `ITEM to N` (H12's `shark to 15`) asks for N less what the
scored account already holds. That depends on what the run ate on the way (S13 eats 0-6 of 8),
and the mule can't see the scored account's pack, so no fixed count is safe. A count that
differs from the scored account's `want` makes it decline. Such a line is written
`{ item | id, topUp: { max }, noted? }` (no `amount`), and its package carries
`scope: { step, family: 'mule' }`, for example:

```json
{ "name": "h12", "scope": { "step": "H12", "family": "mule" },
  "items": [{ "item": "Gold bar", "amount": 1 }, { "item": "Shark", "topUp": { "max": 15 } }] }
```

The count comes from the scored account's **top-up ask**: the same ask, file and functions
the S18 courier reads ([bone-giver.md](bone-giver.md), `altar-cue.ts` `writeTopUpAsk`,
`usableAsk`, `awaitAsk`), with the package's scope on it.

- **The scored side's half** is `runner/handoff.ts`, agreed with rs/393. On the first frame
  that shows the trade with the mule open, before it accepts, it writes
  `writeTopUpAsk(cueDir(), [{ item: '^shark…$', count: 15 - held }], Date.now(), { step: 'H12', family: 'mule' })`.
  A top-up already met is left out of the ask, and with every top-up met no ask is written at
  all. Its `want` is the fixed lines plus exactly the asked counts.
- **Staging.** The mule stages a top-up line after the fixed lines, up to `max`, as far as its
  bank and the 28 slots allow. A line staged below its max is logged, never reported missing:
  the scored account may ask for none.
- **Serving.** Once the trade is open, the mule waits up to `askWaitTicks` (default 3) observed
  ticks for an ask addressed to the package's scope. It takes only one written since it saw the
  trade open (less 300 ms) and newer than the last one it served. It offers the fixed lines as
  ever, and of each top-up line the asked count clamped to [0, max] and to what it holds
  (`'all'` means up to max). Each line takes the first ask item whose name pattern matches what
  the mule holds for it. With no usable ask, it offers none of the line and logs
  `top-up: no usable ask`; it never guesses.
- **The scope gate.** An ask for another step or family, or an unscoped ask (the courier's),
  is ignored. The courier, for its part, ignores every scoped ask. The `hand-off` log line
  carries the ask and each line's count.

A package with no top-up line may carry its scope (the key a cue asks for it by) but never waits
for an ask, and offers all of each staged id, exactly as before.

**Packages from the ledger.** A run-day mule's packages are not written by hand. They are built
from the same inventory-ledger rows (STEP-MANIFEST.md) the scored side's hand-off steps read, by
`speedrun/helpers/mule-ledger.ts`:

- Each `in` entry of a row is a package line: `NAME @ID` by `id`, any other NAME by the game's name
  (`runner/handoff.ts` `gameName`), `[n]` noted. A `NAME to N` top-up is `topUp: { max: N }` in the
  **ask** form, or a fixed N in the **fixed** form. The fixed form is the fallback while the
  scored side writes no ask: the scored account drops what it holds of the item standing at the
  tile first (rs/158: H10, H12, H22), or its `want` differs and it declines. Every package, in
  either form, is scoped `{ step: <hand-off id>, family: 'mule' }`, and records the step it feeds
  (the first S row after it).
- The row's `out` entries are what the scored account gives back in the same trade. The mule
  accepts any offer from it, so they are reported, not configured. `<NAME>` entries are the step
  module's own.
- Every row goes through `planHandOff` first, so a row the scored side refuses is refused here. A
  row whose `[s]`/`[u]` kind disagrees with `isStackableName` is refused too: the mule sizes a
  package with that guess, and a stackable it misreads (thread, nails, before they were added)
  makes it count one slot per item and refuse the package.
- The packages come in ledger order, which is the order the run pulls them (`serveMode: 'order'`);
  a list out of ledger order is refused. cairn_mule1's trades are `MULE1_ORDER`, rs/158's list of
  19: H1, H4, H4k, H6, H4p, H7-H10, H12, H13, H14 (S18's load 0), H15, H16, H18-H20, H21d (with
  H21e's list, one trade) and H22. H3's ring loads are the three ring givers' (cairn_h81-h83,
  `skills/magic.ts` `RING_CONTRACT`), not the mule's. A unit test checks the list against
  SUPPLIES.md's trade-giver rows; `MULE1_NO_PACKAGE` names the trade-giver rows with no package of
  their own, and why.
- **On-request packages** (`MULE1_ON_REQUEST`: H4e, the bone runes' fallback, and H4m, the bones
  past S07's capacity on an overflowing stock) come from the ledger's **fallback hand-offs** table
  (the ledger's columns, after a `Fallback hand-offs` heading; the walk never reads it, so a
  fallback changes no later slot count). They carry `onRequest: true`: order mode never serves them
  in turn; a request by name (the request file or a PM) serves one, and the order then resumes at
  the package that was due (`afterServe`), so a fallback can't shift every later package. One with
  no row in that table has no package, and the CLI names it.
- **Request mode is the run-day default** (rs/158, rs/186): run.ts asks for each hand-off's
  package by cue before the trade, so a missed or repeated trade cannot shift the packages; order
  mode is the fallback.

```sh
bun speedrun/helpers/mule-ledger.ts [--form ask|fixed] [--rows H12]       # { packages } for ROLE_OPTIONS
bun speedrun/helpers/mule-ledger.ts --check fleet.json [--form fixed]     # drift; exit 1 on any
bun speedrun/helpers/mule-ledger.ts --bank stockpile.json                 # stock, served back to back
```

`--check` (`muleDrift`) compares a config's packages with the ledger's: a missing, extra or
reordered package, a line missing or extra, a count, a top-up against a fixed count, noted, and the
scope. It reads mule options, a packages list, or fleet.json's entry for `--account` (default
cairn_mule1). Zero drift is the run-day gate. `--bank` (`stockWalk`) stages the packages one after
another against the account's bank in stockpile.json, crediting what each row's give-back returns
(H12's scimitar serves H22), and lists what runs out.

**Proving the packages on the demo** (`speedrun/helpers/mule-standin.ts`). A throwaway stand-in
runs the scored side's own `runHandOff` against the mule in `request` mode, row by row in run
order, under the standalone launcher (the stand-in `final`). Each row: ask by cue, wait for the
mule's standing request (the package is staged, as when SCORED arrives), run the hand-off, then
hand everything received straight back (the mule, with no package pending, takes any offer and
banks it). The stand-in never equips (the row's wield lines are emptied), eats or banks; a give line
runs only on mule surplus it was seeded with just before the row (a seed package, `onRequest`),
and every line left out is reported as not exercised. A give-back that fails stops the session.
It reports, per row, the ticks on its clock, the staging ticks, the free slots before and after,
and what moved, and ends holding exactly what it started with, by id. The mule's first and last
bank reports in the dev log are the before and after for the reconciliation.

**mule1's own cue directory** (rs/186's ruling). `cue.json` is one file per directory, so a mule
cue in the givers' shared directory would replace theirs (H4e at S07's end, beside the bone
givers'). mule1's run-day options therefore carry `cueDir: <cue root>/mule` (`muleCueDir` in
`mule-ledger.ts`), and run.ts's cue keeper writes mule1's cues and top-up asks there.
`mule-ledger.ts` prints the run-day options with it (`--cue-root` names the run host's cue root;
default `RC_CUE_DIR`, else `run-machine/rc-cue`), and `--check` reports a config whose cue directory
is any other, the shared one included. The directory is set in the config, never derived inside
mule.ts, because the launcher's cue gate must read the directory the role reads (HELPERS.md, "The
cue gate"): a launcher entry's own `cueDir` and its options' agree, or the launcher refuses it.

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
types in one trade, `cairn_h05` -> `cairn_mule1`, 7 s from bank to trade done). The
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
ROLE_OPTIONS='{"serve":"<the scored account, from the run host's private config>","packages":[{"name":"food","items":[{"item":"Shark","amount":200,"noted":true}]}]}' \
  bun speedrun/helpers/mule.ts cairn_mule1
ROLE_OPTIONS='{"mule":"cairn_mule1","items":["^logs$"]}' bun speedrun/helpers/mule.ts cairn_h10 courier
```

Mule options: `serve` (the scored account), `couriers` (default `^cairn_h\d+$`),
`packages`, `serveMode` (`order` | `request`), `giver` (`burst` | `stock`), `preRequest`
(default true), `stand` (default 3185,3436), `ge`, `cueDir` (where package cues and top-up asks
are read; default `RC_CUE_DIR`, else `run-machine/rc-cue`, the directory the givers' cues use; on run day
mule1's own directory, `<cue root>/mule`, as `mule-ledger.ts` prints it),
for top-up lines `askWaitTicks` (default 3), and for packages carried from login `carried`
(default false; a package's `at` tile only with it), `wildlife` and `clearTiles`, and
`keepAliveMinutes` (both guards off unless `carried`, so a banked mule behaves as before).

**Carried packages** (`carried: true`). Where there is no bank (Ape Atoll), the mule logs in
already holding every package. Each package's lines are found in the inventory (`carriedNeeds`; a
login that is short of any package logs `carried: SHORT`), and every line is offered by exact count
(`serveStaged`'s `exact`), because the inventory holds the other packages too: P's 9 sharks are
never "all the sharks". A top-up line still takes the ask's count, clamped to its max. A package may
name its tile, `at: { x, z }` (carried mode only). The mule stands on the pending package's tile,
else on the first package not yet served or withdrawn (`carriedStand`), and walks there as soon as
that tile changes, so it moves on straight after a trade or a stop cue. What it served goes to
RoleState (`carriedServed`, by cue session), so a restarted role never serves a cue twice. There are
no courier trades and no GE. Two guards, on by default only in carried mode:

- **Wildlife** (`wildlife`, default the atoll's jungle spider, scorpion and snake; `clearTiles`,
  default 1). Any NPC hit on either trader closes the trade for both (`npc_combat_melee.rs2`'s
  `if_close`). So before it pre-requests, and again before it opens a requested trade, the mule kills
  (lib/combat.ts `fight`) any NPC that hit it in the last 8 ticks and any named species within
  `clearTiles` (`wildlifeThreat`). The atoll's three hunt with `aa_aggressive_melee`: hunt range 1,
  `check_nottoostrong=off`, so they do attack a level-100+ helper (quest_mm.npc, quest_mm.hunt).
- **Keep-alive** (`keepAliveMinutes`, default 5). After that long with no input it steps to a
  neighbouring tile and back (`keepAliveStep`). A click on its own tile sends no packet at all (the
  lite client's route finds no step), so the no-op has to be a step. Never during a trade, nor with
  the served account within 12 tiles. The published engine has no input-inactivity kick (the lite
  client sends keepalive packets, and its AFK `IDLE_TIMER` is the browser client's); this guards
  against the demo's unpublished one (rs/433).

**H12o, the atoll helper.** cairn_h45 serves SCORED twice on Ape Atoll in one login.
The launcher entry is generated, never hand-maintained:

```sh
bun speedrun/helpers/mule-ledger.ts --carried-h45 > docs/speedrun/scripts/h45-carried-packages.json
bun speedrun/helpers/mule-ledger.ts --carried-h45 --check docs/speedrun/scripts/h45-carried-packages.json
```

The [persisted sanitized entry](../scripts/h45-carried-packages.json) is a review artifact,
not a deployment or staging authorization. Replace its `<SCORED>` placeholder only in the
run host's private configuration. The launcher and role share `run-machine/h45-cue`.
The exact-config check includes line order, tiles, cue scopes and launcher gates.

`mule-ledger.ts` derives both packages from the current STEP-MANIFEST rows, through
`muleFromLedger` and the shared `materializeDeliveryPackage` identity/tradeability boundary.
The carried adapter maps ledger **H12o-M/P** to existing cue scopes **H12oM/P**.
Both are dynamic asks: M's ledger top-up stays a top-up; P's fixed-count syntax records
arrival-sized **caps**, so only this adapter converts its lines to top-ups. It preserves
the ledger's potion-first order and id 2448, with sharks resolved to their tradeable id.
No scored receive logic or trade engine is replaced.

Current maximum delivery is **15 sharks at M, then 1 Superantipoison(4) and 9 sharks at P**:
24 sharks plus the potion, **25 unstacked slots**. That leaves at most **3 slots** for
all retained quest/travel items and the helper's own guard food together. Worn equipment
uses equipment slots, but anything that must be unwielded or carried counts against that
margin. A 25-slot package alone is **not** proof that h45 can carry or safely deliver it.
The existing carried engine logs shortage; it does not certify full-duty readiness.
Its wildlife fight currently has no automatic eating policy. Carrying guard sharks alone
therefore does not establish that the helper will use them to survive.

**Actual capacity and staging gate.** Parent-supplied rs/465 report at 2026-10-23 01:30Z,
from the 01:28Z logout frame: h45 is disabled and logged out at **(2465,3490,0)** outside
the Grand Tree, **not at the atoll**. HP **68/99**, Prayer **1**, melee stats **99**,
Magic **57**, Agility **76**. Worn: adamant full helm, adamant longsword, adamant
chainbody and adamant platelegs, not the previously assumed rune set. Inventory is
**17/28 slots**: Coins 270, 11 sharks, Hazelmere's scroll, Translation book, Glough's
journal, Lumber order and Glough's key. These are observed **names**, not an item-id census.

Current pack capacity **FAILS**: even assigning all 11 existing sharks to delivery,
the complete 25-slot package plus six non-package occupied slots requires **31 slots**.
Those sharks cannot simultaneously count as guard food. rs/465 reports the five quest
items as completed-Grand-Tree leftovers; that does not authorize dropping or banking them.
Tree Gnome Village and Grand Tree are complete and MM segment G passed its postconditions;
the underlying MM quest variables after the return flight were not directly observed.

**Fail closed for launch.** Post-cleanup capacity, stock allocation, guard-food sufficiency,
Stronghold-to-atoll travel and actual atoll staging remain **UNKNOWN**, pending parent/rs331
observations and authorization. Do not lower the ledger caps, discard quest items, or
spend the delivery stock on survival to make a theoretical pack fit. The owner must record
a fresh item-id/slot census, required retained items, worn gear, guard-food reserve and
full stock at the intended tile before approving duty. A private atoll-start fixture can
test the M-to-P duty, but cannot establish that live staging or the outbound route is safe.

**Offer order.** In one trade the mule offers in the package's line order (`byPackageLine`), each id
from its lowest slot, with any X count (anything but 1, 5, 10 or the whole stack) after the button
presses (`lib/trade.ts` `planOffers`). H12oP's potion line comes first and is always a one-press All,
so it is offered first for every ask, whatever slot it sits in; nothing in the staging has to hold it.
The trade completes only when both sides confirm, so the order changes nothing SCORED receives. Its own `cueDir` keeps
mule1's H12 cue apart; there H12oP's cue replaces H12oM's in the one `cue.json`. What `run.ts` writes
(rs/393), with SCORED as the receiver:

1. **H12oM opens** at least ~100 ticks before SCORED climbs out onto M's tile (2763,2704), the dungeon
   exit ladder's top. The launcher logs h45 in on it (`LOGIN_CUE_MS`, `cueEpoch`), and the mule reads
   the same cue as M's request: it walks from P's tile to M's and clears the wildlife there.
2. **M's ask**, on the first frame showing the trade with h45 open:
   `writeTopUpAsk(dir, [{ item: '^shark$', count: n }], Date.now(), { step: 'H12oM', family: 'mule' })`,
   n = min(15, SCORED's free slots - 1), `want` exactly n sharks. With n = 0 there's no trade: write H12oM's
   **stop**, and the mule passes M (below) and moves on to P (it moves on straight after M's trade too).
3. **H12oP opens** any time after M (a new cue session). h45 waits logged in on P's tile (2803,2724),
   ~850 ticks. P is sized by SCORED on arrival (rs/158): the Superantipoison(4) plus min(9, free - 2)
   sharks, keeping one slot free. On the first frame showing the trade open SCORED writes
   `writeTopUpAsk(dir, [{ item: '^superantipoison\\(4\\)$', count: 1 }, { item: '^shark$', count: k }], Date.now(), { step: 'H12oP', family: 'mule' })`
   and wants exactly what it asked. A line it needs none of is left out, since an ask's counts are at
   least 1. h45 offers each line's ask clamped to its max and to what it holds: asked 1 + 5, the potion
   and 5 sharks; asked 1 + 0, the potion alone.
4. **Nothing to ask means no trade.** SCORED writes H12oP's **stop** in place of the trade. A carried
   package whose cue stops before its trade is passed: the mule opens no trade and sends no more
   requests, logs `carried: asked for nothing; passed without a trade`, and records the cue session in
   RoleState (`carriedServed`) as a trade would be, so a restarted role never takes it up again.
5. **H12oP's final stop** after P's trade, or in place of it (`final: true`, or the next scope's cue after a
   plain stop): the launcher logs h45 out at once. H12oM's stop and H12oP's open between the two trades
   leave it in.

**Current full-capacity private proof.** The [archived max-load duty](../../../speedrun/lab/evidence/h45-max-load/README.md)
uses the same carried engine and generated packages with the reported h45 stats/adamant
gear, HP 68/99, and a synthetic 28-slot load of 27 sharks plus potion 2448. It delivered
M's full 15, walked from M's combat-offset tile to P in 23 ticks, waited 850 ticks with
an observed keepalive, then offered the potion first and delivered P's full 9 sharks.
Both receiver layouts preserved the canonical spare slot. Minimum HP was 55, final HP
63; no food was consumed and all three reserve sharks remained. The final cue logged
it out after one session. Exact source, patch hashes, inventory snapshots and trade
frames are archived. This is one natural-duty trial, not worst-case survival or proof
of autonomous eating, live capacity, or the Stronghold-to-atoll route.

Historical lighter-load measurement (`speedrun/lab/atoll-mule.ts`, rs/483, fedora lab, T=400, the launcher's relay
path, a stand-in SCORED appearing on each tile as a ladder climb would put it):

| Leg | Ticks |
|---|---|
| H12oM's open to h45 in the world (parked on P's tile) | 2 |
| The walk P -> M (logged in on P's tile, as parked) | 23 |
| Open to the mule ready at M | 30 |
| Wildlife at M: 2 jungle spiders spawned on the tile, both killed (6 HP taken at Defence 99 in rune) | 18 and 28 |
| M's trade, SCORED's clock (10 free slots, asked 10, given exactly 10 of 22) | 5 (mule's giver 3) |
| The walk M -> P, starting straight after M | 23 |
| The wait at P: 850 ticks (5.7 min), 0 hits, 1 keep-alive (after 300 s idle, a 2-tick step) | 850 |
| P's trade, SCORED's clock (9 sharks + 1 potion, P's earlier fixed form in that historical run) | 5 (mule's giver 4) |
| H12oP's stop to the launcher's logout | 2 |

SCORED arrived 70 ticks after the open while the mule was still on its second spider; the
pre-request waited for the kill, which cost SCORED a few ticks. The login and walk took 30 ticks, so
the ~100-tick lead in step 1 leaves room for the wildlife.

**Where h45 must wait, and restock between attempts.** The intended staged state is
logged out on P's tile, with the full generated package and a separately justified guard
reserve. That is not the observed state above. The earlier lab relog landed on P and took
no hits there for 850 ticks; it is historical lab evidence, not an actual staging receipt.

After successful asks n at M and k at P, the delivery allocation left is 24 - n - k sharks,
plus the potion if P did not ask for it; guard consumption must be accounted separately.
There is no bank on the atoll. Any future restock/cleanup or return via Lumdo, Waydar and
the Grand Tree requires parent authorization and a fresh inventory/route check. Never
assume an empty pack or discard retained quest items. The mule role only serves: it does
not implement the off-atoll staging trip.


In the fleet: one mule account is enough; a second (`cairn_mule2`) helps only for
back-to-back hand-offs or while the first is at the GE. The module exports `role`
(mule), `courier` and `roles`. The fleet loads a role by name from
`speedrun/helpers/<name>.ts`, so `speedrun/helpers/courier.ts` re-exports the courier
as its `role`: `fleetctl assign <account> courier --options '{"mule":...,"items":[...]}'`.
A courier trip ends when the trip is done: `run` returns, so the fleet does not start
it again. Borrow the account with `--return` (`fleetctl assign <account> courier --options
'...' --return`) and the fleet puts it back on its gathering role, with the same options,
when the trip finishes (HELPERS.md, "Borrowing an account").

The courier's `mule` can be any account standing at Varrock west bank that accepts the
trade. The bones role does that with its `coinsFrom` option to take coins for Grand
Exchange food (docs/speedrun/helpers/bones.md). A courier that starts in Al Kharid (the
coin earners' warriors) gets stuck at the toll gate: its walk does not pay the gate.
`crossTollGate` in `speedrun/lib/toll-gate.ts` handles that crossing. The mule logs `phase` lines (`idle`, `consolidate`, `serve`, `ge`), a
`hand-off` line per package with the giver's ticks, and calls `reportBank` after
every bank visit. Its role has `produces: []`: it holds stock rather than producing
it, so the ledger should attribute the mule's bank by account, not by role.

The giver sits behind one function, `giveOpenTrade(sdk, bot, partner, items, mode)` (its
optional `amounts` offers an exact count of an id: a top-up line), reached through
`serveStaged`, which waits for the ask first when the package has a top-up line.
Its burst mode is `speedrun/lib/trade.ts` `give()`, the one giver implementation. It uses
`expectTheirs: ANY_OFFER`, so the scored account may hand items back in the same trade
(the two-way swap): whatever it offers is accepted, re-accepted after any reset, and the
confirm screen is accepted once the mule's own offer is exactly the package.
