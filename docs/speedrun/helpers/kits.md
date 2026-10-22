# Kit giver (rehearsal starter kits)

`speedrun/helpers/kits.ts` (role `kits`) hands each per-skill rehearsal account
(cairn://p/rs/147) its starter kit. The hand-off happens at Lumbridge (3222,3222),
the tile the tutorial's last label drops a new account on, right after its
tutorial skip and on its clock, so it rehearses the scored run's S01 hand-off. After
the account's 99, the role takes the rune tools back and banks them as fleet spares.
One account runs it: **cairn_mule2**, outside the fleet, on its own loopback
gateway. It never touches the scored run's gear: the rune axe on cairn_h90 is not
lent, so the kit's rune axe is a second one bought for this.

## Why it is shaped this way

- **One trade path.** The giver is `speedrun/lib/trade.ts` `give()`, and the
  receiver side (rs/150's harness) is `receiveFrom()`. `give()` offers every item
  in one burst with its accept behind it, and judges a late decline only on the
  server's word (mule.md, "Safety"). The role adds no trade logic of its own.
- **Exact names.** `give()` matches a string item as a case-insensitive
  *substring*, so `Logs` would also offer `Oak logs` and `Shark` `Raw shark`. The
  role offers each kit item through an anchored pattern with its exact count
  (`giveSpecs`). The staged pack holds exactly the kit, plus the bronze axe when
  it chopped logs, so every offer is one "All" press and needs no count dialog.
- **Pre-requesting.** A trade request to a player who has already requested you
  opens the trade at once (trade.rs2). The giver therefore stands on the exit
  tile before the receiver's first login. When the receiver appears in view,
  `give()` sends a request and re-sends it every 8 s. The receiver's
  `receiveFrom` then opens the trade on the tick its own request lands, even if
  the harness runs its in-page gate probe first.
- **Kits fit a fresh pack.** The tutorial leaves 18 starter items, so a new
  account has 10 free slots. The role refuses a kit that needs more (`kitSlots`:
  one slot per unstackable item, one per stack or banknote). The mining kit is
  exactly 10.
- **Never a second kit blind.** Before opening a trade, the role writes
  `giving` into `ctx.state` under `kits.delivery:<receiver>`. Success changes it
  to `delivered`; an uncertain result retains a blocking record. A crash,
  re-login or launcher restart therefore cannot stage another kit for that
  receiver. Only an unopened trade (`no_response` or `player_not_found`) with
  the entire kit still held clears the record for an automatic retry. A person
  reads both logs before clearing any other record. Changing kit counts does
  not bypass this guard.
- **Buying is not this role's job.** The existing roles cover it, run on the same
  account beforehand (next section).

## Sourcing a kit

| Item | Where | How |
|---|---|---|
| Rune axe | GE only; few sellers. Another player bids 100,001 for 43 | `bidder` line on cairn_mule2 in step mode (below). The offer rests while the account is offline or running another role |
| Steel, mithril, adamant, rune pickaxe | Nurmof (Dwarven Mine; rune stock 1). The GE has no sellers | `buyer` shop line, `shop: nurmof` |
| Knife | Shantay Pass, 6 gp, stock 10. The GE ask was 49,000 | `buyer` shop line, `shop: shantay` |
| Fly fishing rod | Gerrant (Port Sarim), 5 gp | `buyer` shop line, `shop: gerrant` |
| Feathers | Fleet stock (cairn_h01-h03's banks) | `bidder.ts cairn_h01 fund` with `item: Feather`, received by the bidder on cairn_mule2 |
| Coins | Earners cairn_h64, cairn_h63 | `bidder.ts <earner> fund` with `amount`, received by the bidder |
| Normal logs | Chopped by the giver with its starter bronze axe | automatic while staging (`splitLogs`): logs the bank lacks are chopped near Lumbridge |

The rune axe line cairn_mule2 bid with on 2026-10-21:

```json
{"lines":[{"item":"Rune axe","target":1,"tranche":1,"maxPrice":250000,"minPrice":150001,"step":10000,"stepAfterIdleMinutes":20}],
 "recheckMinutes":10,"fillCheckMinutes":2,"funders":["^cairn_h64$","^cairn_h63$","^cairn_h01$"]}
```

It started at 150,001, the price rs/124's axe filled at, which is above the
100,001 wall. It steps up 10,000 after every 20 minutes without a fill, and stops
at main's 250,000 cap. The steps happen only while the bidder role runs. An
offer left resting while the account runs another role keeps its price, and a
fill waits in the exchange until a bidder or buyer run collects it (a buyer
line for the item collects it before counting). **Do not restart this line after the axe has been
given.** The bidder counts what the account holds, so with the axe gone it would
bid for another one.

An earner trip takes the earner out of the fleet only for the trade: `fleetctl
assign <earner> coins --disable && fleetctl reload`, then a one-account launcher
with `final: true` (it logs the earner out when the trip ends), then `fleetctl
assign <earner> coins && fleetctl reload`, and a look at `fleetctl status` and
`fleetctl logs <earner>` within a minute to see it earning again. The 340,000 gp
trip from cairn_h64 took 2.5 minutes away from earning, and the trade itself took
23 ticks.

## Running it

Options (`ROLE_OPTIONS` or the launcher entry's `options`):

| Key | Default | Meaning |
|---|---|---|
| `kits` | required | kit id -> kit (see "A second kit for the same receiver"), in the harness's spelling `rune_axe:1,knife:1,logs:1` (`:noted` for banknotes, `cake:38:noted`) or as `[{ item, amount, noted? }]` with display names |
| `serve` | none | the kit id to stage and serve now, or an ordered list of them. A kit with a delivery record is passed over, and the next one is staged as soon as one is served. Without it the role only takes returns |
| `keepLogs` | 0 | normal logs held back in the bank and never put into a kit (stock for later steps). At start the role chops the bank up to this count; a kit's logs come only from above it |
| `stand` | 3222,3222 | where to wait |
| `bank` | Draynor | where kits are staged and returns banked (Lumbridge's own booths are upstairs) |
| `returns` | every kit receiver | accounts whose trades are answered with `receiveFrom` and banked. When one asks while the pack has fewer than 4 free slots (a staged full-pack kit), the giver banks the pack first and stages the kit again afterwards. The returner's request stays open meanwhile, so keep `stand` beside `bank` when kits fill the pack |
| `freeSlots` | 10 | the receiver's free slots, for the kit size check |

On bbs, from the dev copy `~/rs-dev/rehearsal-kits`, with the standalone
launcher (`speedrun/helpers/standalone.ts`, see HELPERS.md "Helpers on the run
machine") under a private tmux socket:

```sh
cat > kits/mule2-kits.json <<'EOF'
{"gatewayPort":7720,"botsDir":"/home/bleu/rs-fleet/bots","runDir":"/home/bleu/rs-dev/rehearsal-kits/run-mule2",
 "accounts":[{"account":"cairn_mule2","role":"kits","options":{
   "serve":"cairn_casts",
   "kits":{"cairn_chops":"rune_axe:1,knife:1,logs:5",
           "cairn_casts":"fly_fishing_rod:1,feather:800,knife:1,logs:5",
           "cairn_rocks":"steel_pickaxe:1,mithril_pickaxe:1,adamant_pickaxe:1,rune_pickaxe:1,knife:1,logs:4,coins:60"}}}]}
EOF
tmux -L rs41-kits new-session -d -s mule2 \
  'export PATH=$HOME/.bun/bin:$PATH; cd ~/rs-dev/rehearsal-kits && exec bun speedrun/helpers/standalone.ts kits/mule2-kits.json >> run-mule2/launcher.out 2>&1'
```

The credentials stay in `~/rs-fleet/bots/cairn_mule2/bot.env`, which the launcher
reads in place, and nothing is copied. The launcher's PID is `pid` in
`run-mule2/launcher.json`. Role lines are in `run-mule2/logs/cairn_mule2.role.log`.

A hand-off, step by step:

1. rs/147 grants the slot and sends the time, at least 15 minutes ahead.
2. Start (or restart) the launcher with `serve` set to that receiver. The role
   logs `kits ready`, banks, withdraws, chops what logs it lacks, walks to the
   stand and logs `kit staged`.
3. When the receiver logs in and skips its tutorial, the role logs `receiver in
   view`, then `hand-off` with `ok`, `giverTicks`, `gave`, the server `tick` and
   the wall time `at`. The receiver's own cost (the S01 row of the harness's tick
   log) comes from rs/147. Post both on cairn://p/rs/161 and cairn://p/rs/147.
4. After a successful hand-off the role banks the leftovers (the bronze axe) and
   stays at the stand taking returns until stopped.

Returns: start it without `serve` (or leave it running after a hand-off). A
returning account's trade request is answered with `receiveFrom`. The role gives
nothing, logs `returned` with what came, and banks it at Draynor.

## A second kit for the same receiver (a top-up)

Every kit is given at most once, and its delivery record is keyed by **kit id**. A
plain id is the receiver's login name, so records written before kit ids still
count. A further kit for the same receiver gets a labelled id, `name+label`:

```json
{"kits":{"cairn_jumps":"knife:1,cake:7,shark:2","cairn_jumps+topup":"cake:18"},
 "serve":["cairn_jumps","cairn_jumps+topup"]}
```

A labelled kit is checked against a full 28-slot pack, not `freeSlots`, because the
receiver makes room first (it drops its starter items). Kits for the same receiver
that follow one another in `serve`, and fit the giver's pack together, are staged
in one bank visit (`carryGroup`). As soon as one is delivered, the next is offered
from the pack. The giver keeps re-requesting the trade (an unopened trade is safe
to retry) until the receiver opens it. A restart after kit 1 serves only kit 2.

## Loading full packs: the Firemaking droppers

rs/228's assisted Firemaking 99 (cairn_burns) lights 157 logs that six `fm-row`
droppers (cairn_d01-d06, `restock: {kind:'held'}`) drop beside the Lumbridge spawn.
A held dropper logs in already carrying its one 28-log inventory and never banks, so
the loading happens beforehand, in three hops:

1. **Woodcutters to the giver.** The logs are in the woodcutters' banks (cairn_h10-h13),
   and the woodcutters stand at Seers'. One at a time, a woodcutter is disabled in the
   fleet and runs the `handover` role from the dev copy with `crossKandarin: true` and
   `bank` Draynor. It crosses White Wolf Mountain with nothing withdrawn, withdraws
   the logs as notes at Draynor and trades them to cairn_mule2 there. Then it is
   re-enabled on its unchanged woodcutter entry, whose role walks it back to Seers'.
   Both crossings start on rested Hitpoints (`restForCrossing`, see woodcutter.md),
   so expect up to about 16 minutes' rest at Draynor after the trade.
   The giver lists the woodcutters in `returns`, so it takes and banks those trades,
   banking a staged pack first if it fills the giver's inventory.
2. **The giver to each dropper.** cairn_mule2 runs the giver with all six packs in
   `kits`, `freeSlots: 28`, `serve` listing d01-d06 in order, and `stand` and `bank`
   both Draynor. Its bank un-notes the logs, so each pack goes over as 28 real logs.
   Each dropper gets one delivery record, exactly as a rehearsal kit does.
3. **Each dropper takes its pack** with this role's `load` option, one dropper at a time:

```json
{"load":{"from":"cairn_mule2","kit":"logs:2,oak_logs:4,willow_logs:7,maple_logs:13,yew_logs:2","park":{"x":3232,"z":3220}}}
```

   A fresh account's first login creates it. The role skips the tutorial and banks
   all 18 starter items at Draynor, so the pack ends up holding nothing but its logs
   (a held dropper drops whatever it carries). It then waits for the giver to come
   into view and takes the trade with `receiveFrom`, wanting each log type by its
   exact name and count. Last, it walks onto its `park` tile, where it will log in
   for the attempt. The role then returns, and the launcher entry's `final: true`
   logs it out. A trade that delivered anything short of the pack is never retried:
   the role ends with an attention line.

The droppers' credentials are in `~/rs-fleet/bots/<name>/bot.env` (created by
`accounts.ts` `createAccountEnv`, directory 700, file 600). They are never in
fleet.json. The park tiles are rs/228's: z=3220, x 3232-3237 for d01-d06, beside
the row (z=3218/3219) and off it.

## The stall option: cakes from Ardougne

The Thieving kit's food is cakes, which nobody sells on the GE. The bakery shop
restocks one per 800 ticks (`ardougne_east.inv`), so cakes are stolen instead.
With `stall` in its options the role is one trip for a borrowed high-level
account (cairn_h45: Thieving 99, Hitpoints 99), not the kit giver:

```json
{"stall":{"target":55,"deliverTo":"cairn_mule2"}}
```

1. At Varrock west bank it banks everything except food (`food`, default
   Kebab). No coins travel: a death would drop them.
2. It crosses White Wolf Mountain with `speedrun/lib/kandarin.ts` and walks to
   (2667,3312), the tile north of the east baker's stall (2667,3310).
3. It steals by `decideStall`, one decision per tick. It clicks Steal only
   while the stall offers it and no combat contact (damage either way, a held
   target, or the "during combat" refusal) happened in the last 11 ticks. In
   the gaps it drops bread and chocolate slices, banks cakes at the south bank
   when the pack is full, eats below half health and gives up below a third
   with no food left. Auto-retaliate is switched on for this part, as in the lab
   measurement, and restored at the end.
4. At `target` cakes (bank plus pack) it banks them, withdraws them as one
   noted stack, crosses back to `deliverAt` (default 3222,3222) and gives them
   to `deliverTo` with `give()`. The kit giver must list the account in
   `returns` to accept them. Undelivered cakes go to the borrowed account's own
   bank at Draynor.

Why this tile and back-off, measured in the lab (cairn://p/rs/161, 300 ms ticks):
55 cakes and 77 steals per 1,000 ticks, against 8 cakes when clicking through
combat. On the demo the same trip ran at about a quarter of that: 55 cakes in
5,284 ticks on the tile (685 steal clicks), still steady. It was pulled off the
tile now and then, which looks like auto-retaliate chasing a guard (inferred,
not measured). The west stall is in view of three guards. A guard stands next to the
player most of the time; at 99 Defence it did 9 damage per 1,000 ticks. Run the
trip with the launcher and `final: true`, and take the account out of the fleet
only for the trip, as for a fund trip.

## Stopping it cleanly

Signal only the launcher, by the PID it recorded, never by name or pattern
(`pkill -f gateway.ts` would also hit the fleet's gateway):

```sh
P=$(python3 -c 'import json;print(json.load(open("/home/bleu/rs-dev/rehearsal-kits/run-mule2/launcher.json"))["pid"])')
ps -o pid,args -p "$P"      # check it is standalone.ts before signalling
kill -INT "$P"
```

On SIGINT the launcher sends the role SIGTERM, which aborts it: between steps it
declines any open trade and exits. A role still inside a trade or a walk after
15 s is killed. The launcher then clicks logout through the account's own
connection (waiting out a 16-tick combat window once if needed), waits for the
client to leave, and only then closes the client and its gateway on
127.0.0.1:7720. `run-mule2/launcher.out` ends with `cairn_mule2: stopped`, and
the tmux session closes with the process. Stopping in the middle of a trade is
safe: items move only when both sides have accepted the confirm screen, and a
trade cut short before that changes nothing. To avoid even that edge, stop
outside a hand-off window. Stopping after `kit staged` leaves the kit in
the pack, and the next start banks and restages it if no delivery record exists.
If stopped during a hand-off, keep its delivery record until the receiver's log
proves what happened. Never clear the role-state file wholesale. When adopting
an older deployment that did not persist delivery records, first remove any
already-served receiver from `serve`; do not restart its old assignment.
Resting GE offers (the rune
axe bid) survive a stop. Cancel one only from a `bidder` run, by setting the line's
`target` to what is already held.

## On the demo (2026-10-21)

- 20:21 UTC: cairn_mule2's first login created it; the bidder skipped the
  tutorial and walked to Varrock west bank.
- 20:24: cairn_h64 funded 340,000 gp (23 ticks). The bidder placed rune axe
  offer #17400 at 150,001, the best bid above the 100,001 wall.
- 20:28: cairn_h01 gave 800 feathers (25 ticks).
- 20:31-20:44: the buyer bought the fly fishing rod (Gerrant, 5 gp), 4 knives
  (Shantay, 34 gp), the steel, mithril and adamant pickaxes (Nurmof, base
  prices). Nurmof's single rune pickaxe was out of stock; a rerun with
  `maxWaitTicks: 1500` bought it at 32,000 after one restock (700 ticks).
- 20:48: the kit role's first staging (cairn_casts): bank, withdraw, chop one
  log, walk to the stand, 75 s in all.
- 21:30: 92 sharks on the GE for 56,672 gp (rs/147's baseline food).
- 21:32: the rune axe offer filled at 150,001, the price it started at. It
  was collected at 22:35 by a one-line buyer run.
- 21:39-22:12: cairn_h45's stall trip: 500 ticks out over White Wolf Mountain,
  55 cakes in 5,284 ticks at the stall (91 HP left of 99), 595 ticks back, and
  one noted stack given to cairn_mule2 at Lumbridge (9 ticks giver side, 7
  receiver side). It was out of the fleet for 33 minutes and earning again at
  once.

- 2026-10-22 00:06:04 UTC: Fishing kit delivered to cairn_casts at Lumbridge:
  fly fishing rod 1, feathers 800, knife 1, normal logs 5. Giver settled at
  00:06:04.061Z in 8 ticks. Receiver log (rs/195,
  `rehearse-fishing-20261022-000351`, session 1): S01 ticks 6–14,
  **8 ticks**, wallMs 1929, ok true, ending 00:06:04.004Z. S00 was separate,
  ticks 2–6. This used the original live deployment; the durable delivery guard
  was added afterwards to the recovered branch, not hot-deployed during the slot.
- 00:06:41: leftovers banked. Bank stock: rune axe 1 (the GE-bought second axe),
  steel/mithril/adamant/rune pickaxe 1 each, knives 3, cakes 55, sharks 92,
  coins 96,303. Later kits still need their normal logs chopped while staging.
- 00:07:08.146: clean logout after SIGINT to the verified launcher PID 2749943.
  The saved config's `serve` was removed before stopping. The giver is offline;
  future slots require an explicit staging start. Woodcutting's next kit is
  rune axe 1, knife 1, logs 5; its slot and later food counts come from rs/147.
