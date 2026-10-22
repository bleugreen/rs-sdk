# Cannon helper

`speedrun/helpers/cannon.ts` (role `cannon`) takes a fresh demo account through Dwarf
Cannon, then makes the run's cannonballs and buys its multicannon sets from Nulodion, for
the scored account's hand-offs H11, H11r and H23 (`docs/speedrun/SUPPLIES.md`). Only an
account that has completed the quest can buy a cannon or make cannonballs
(`nulodion.rs2`, `cannonballs.rs2`), and the ammo mould is untradeable, so this one
account does everything and is the one that meets the scored account at run time.

```
ROLE_OPTIONS='{"balls":1160}' bun speedrun/helpers/cannon.ts cairn_h92
```

With `serve` in its options the same role is the **cannon holder** at run time: it hands the
scored account one set and its cannonballs in one trade (H11, H23) and can take them back
(H11r). See "Serve mode" below.

## Options

| Option | Default | Meaning |
|---|---|---|
| `sets` | `2` | Cannon sets to hold: one for the route, one spare against a Wilderness death. |
| `balls` | `1160` | Cannonballs to hold: 290 steel bars (rs/129 priced the route at about 1,170). |
| `funders` | `^cairn_h\d+$` | Login-name patterns whose trades are accepted (coins and steel bars). Narrow it to the earners the coordinator names and the steel giver. |
| `steelMaxPrice` | `0` | With no steel left, buy up to 27 bars at the exchange at no more than this. Off by default: with it on, a set-funding trade under 750,000 would be spent on steel. |
| `crossingHitpoints` | `30` | Hitpoints trained on the Lumbridge cows before the first White Wolf Mountain crossing. |
| `food` | `5` | Sharks bought at the exchange before the railings (0: rest instead). |
| `foodWaitMinutes` | `10` | How long to wait at Varrock West for food money before going without. |
| `stopAfter` | none | `quest` stops once the quest is complete (development). |
| `serve` | none | Hand the set and balls over instead of questing and producing (below). |

## The quest

The stage is read from the quest journal on every cycle (the SDK has no varps, but every
`%mcannon` stage has its own journal text), so the role restarts from any point. The
route and its stock-tick budget are in `docs/speedrun/quests/dwarf_cannon.md`; the lab
run of the whole quest is `docs/speedrun/scripts/quest-mcannon-run.ts`. Lawgof's camp is
west of White Wolf Mountain, so a fresh account trains Hitpoints to 30 on cows first
(`speedrun/lib/kandarin.ts`, shared by every role that crosses), buys five sharks at the exchange on the way
out, and crosses through Taverley and Seers.

The railings are the slow part at Crafting 1: each try succeeds about 1 time in 20 and
a failure hits for `min(3, base Hitpoints / 10)`. The role eats when a shark is not
wasted and otherwise rests until a failure cannot kill it.

One trap: the railing's choice opens about 5 ticks after the inspect (two `p_delay(2)`
in `railings.rs2`). Standing beside the railing, the SDK's `interactLoc` gives up
before that ('Nothing happened interacting with Railing'), and inspecting again
dismisses the choice as it opens, so a retry loop never gets past it. The role treats
that timeout as "wait for the choice" rather than a failure.

## After the quest

`nextWork` (pure, tested) picks each step from what the account holds, carried plus
banked:

1. **Sets** jump the queue as soon as a set's 750,000 coins are in hand (Nulodion's
   dialogue sale; it also gives a mould and the manual). Otherwise they come last.
2. **Smithing 1 to 15 on bronze.** The exchange has no copper, tin or bronze, so the
   account mines about 13 copper and 13 tin west of Falador and smelts them at the
   Falador furnace (the furnace's Smelt option and "Smelt 10" button, as the smelter).
3. **Smithing 15 to 35 on iron.** Iron ore is plentiful on the exchange (about 110 coins,
   tens of thousands listed). `ironOreToBuy` sizes the order in whole inventories from
   h20's measured rate (34 ore took Smithing 16 to 30; half of iron smelts fail).
4. **The mould** from Nulodion's shop (5 coins; Lawgof keeps the quest's).
5. **Cannonballs**: the mould and 27 steel bars to the Falador furnace, one use of a bar
   on the furnace per 4 balls (`cannonballs.rs2` has no make-all), bank, repeat.
6. With no steel left, it **waits at Varrock West** for 1,000 ticks at a time, accepting
   trades, then re-plans.

Every trade meets at **Varrock West bank** (the funding trip's stand): coins from coin
earners and noted steel bars from the bars line (rs/119's `cairn_h20`). The bank is
shared by every booth, so whatever arrives there is withdrawn in Falador.

## Funding

Coins come by trade from coin earners the coordinator names, one at a time, with the
bidder's fund trip: take the earner out of the fleet, log it in on a dev gateway, trade,
log it out, give it back. The dev copy on bbs has this as
`~/rs-dev/cannon/fund-round.sh` (after `~/rs-dev/bidder/fund-round.sh`):

```
RECEIVER=cairn_h92 AMOUNT=50000 ./fund-round.sh cairn_h65
```

The receiver only accepts while it is waiting (`waiting for funding` or
`waiting for steel bars` in its log), so start the round then.

## Measured on the demo (cairn_h92, 2026-10-21)

| Step | Measured |
|---|---|
| Hitpoints 10 to 30 on the Lumbridge cows | 6,839 ticks, 62 kills (Strength 43 alongside). The woodcutter measured 661-1,488; the pen was crowded and "Someone else is fighting that" was most of the wait. |
| Five sharks at the exchange | 696 coins each, filled at once |
| Crossing west (Varrock to Seers) | 444 ticks |
| Railings, Crafting 1 | 332 ticks for the last pass (21 tries, 1 success); the first pass lost about 3 minutes to the choice race above |
| Quest, stage 1 to 11 | 15:55-16:27 UTC, about 6,400 ticks of wall time; about 4,000 without the railing and shed-door races (both fixed) |
| Crossing back east | 382-383 ticks each way |
| Copper and tin, west of Falador | 13 + 13 in 300 ticks (Mining 9 to 37 on the way) |
| Bronze, 14 bars | 499 ticks, Smithing 2 to 17 |
| Iron ore at the exchange | 81 at 109, filled at once (8,829 coins) |
| Iron, 28 ore then 28 ore | 18 bars in 633 ticks (Smithing 17 to 30), 12 bars in 433 ticks (30 to 35) |
| Mould from Nulodion's shop | 5 coins, about 50 seconds from the Falador bank |
| **Fresh Smithing to 35 with the mould** | **16:38-16:55 UTC, about 17 minutes** |
| Steel bars at the exchange | 23 at 1,501 (34,523 coins), filled at once |
| **Cannonballs, one furnace trip** | **23 bars, 92 balls, 287 ticks pouring: 12.5 ticks a bar** (the script's own delays are about 7); plus the Falador bank round trip |

At about 12.5 ticks a bar plus the bank walk, 1,160 balls (290 bars, 11 trips) is about
4,000-4,500 ticks, 20-25 minutes, once the bars are in.

## What the quest gates, and what it does not

Read from the content (rs/189):

- **Buying** is gated. Nulodion's shop (`[opnpc3,nulodion]`) and his cannon sale (`[opnpc1,nulodion]`,
  the `^mcannon_complete` case only) refuse anyone below `^mcannon_complete`.
- **Trading** is not. The four parts (`twpart1`-`twpart4` in `quest_mcannon.obj`) and `mcannonball`
  carry no `tradeable=no`, and `trade.rs2`'s `movetotrade` checks only `oc_tradeable` and members
  items on a free world. The mould, Nulodion's notes, the manual and the tool kit are the
  untradeable ones.
- **Using**: only Set-up on the base checks the quest (`cannon_setup.rs2 [opheld1,twpart1]`).
  Adding the other parts, loading, firing and picking up check only that the cannon is yours.
- **Making balls** needs the mould (only from Nulodion), Smithing 35 and a members world;
  `cannonballs.rs2` does not read `%mcannon` itself.

So one helper has to do the quest to buy the sets and make the balls, but anyone can receive
them; SCORED, quest-complete after S13, can set the cannon up.

## Serve mode (the hand-off)

```
ROLE_OPTIONS='{"serve":{"id":"H11","tile":{"x":2570,"z":3463},"balls":100,"returnTile":{"x":2661,"z":3301}}}' \
  bun speedrun/helpers/cannon.ts cairn_h92
```

1. **Load.** Unless it already carries a set and `balls` cannonballs, it banks everything at
   `serve.bank` (default Falador west; every bank is one bank) and withdraws one of each part
   and exactly `balls` balls. Exactly the load is carried, so each of the five items is one
   All press in the trade (`items.ts amountButtons`).
2. **Stand** on `serve.tile` (walking over White Wolf Mountain if the tile is west of it).
3. **Find the receiver by name hash, never by name**: `serve.receiver` (the sha256 of the scored
   account's canonical name, `altar-cue.ts nameHash`; a plain name is refused), or else the
   `receiver.sha256` of `cue.json` in the cue directory, which the scored side writes at login.
4. **Keep a request standing** (`bone-giver.ts requestUntilOpen`, shared with the bone giver):
   sent when the receiver comes into sight, re-sent on the next tick after a "busy" refusal,
   refreshed every 100 ticks. The scored step's own trade click (`lib/trade.ts receiveFrom`)
   then opens both screens at once.
5. **Give everything in one trade** (`lib/trade.ts give`). A trade opened by anyone else is declined.
6. With `serve.returnTile`: **take the set back** (H11r). It stands there, waits for the
   receiver's own trade request (matched by hash in the chat), and receives with
   `receiveFrom`, wanting the four parts; leftover balls are optional.

Each hand-off is recorded in the role's `ctx.state` under `cannon-serve:<id>`: `giving` just
before the trade, then `gave`, then `returned`. A restarted holder resumes from the record and
never gives a hand-off twice; a restart after `giving` with the load gone is taken as given and
flagged for a person (`attention`). Give each hand-off its own `serve.id` (H11, H23).

| `serve` option | Default | Meaning |
|---|---|---|
| `tile` | required | Where the holder stands (beside the scored account's tile) |
| `balls` | required | Cannonballs in the load (H11: 100; H23: ~1,100) |
| `id` | `x,zxballs` | Names the hand-off in `ctx.state` |
| `receiver` | the cue | sha256 hex of the scored account's canonical name |
| `bank` | Falador west | Where to load |
| `returnTile` | none | Take the set back here afterwards (H11r) |
| `labStock` | false | Local lab only: make the load with staff commands |
| `noReplyTicks`, `resendTicks`, `cueDir` | 3, 100, `RC_CUE_DIR` | As the bone giver |

**The scored side's contract**: stand beside the holder and call
`receiveFrom(holder, { want: loadWant(balls) })` (`loadWant` is exported from `cannon.ts`). For
H11r, `give(holder, loadSpecs(leftover))`.

**Stand-in receiver**: `speedrun/helpers/cannon-receiver.ts` writes the cue, waits for the
holder's request, receives as the scored step does and reports the trade's ticks on its own
clock; in the lab it can set `%mcannon` and try Set-up, and it can give the load back.

### Measured in the lab (bgsrv-ub, `NODE_TICKRATE=300`, 2026-10-21)

`speedrun/lab/cannon-handoff.ts`, the Lumbridge cow pen, holder cairn_h71 with staff-made stock,
receiver cairn_h76 with `%mcannon` set by staff command (not a real quest run):

| Receiver `%mcannon` | Trade | Receiver clock: click to items | Request standing at the click | Set-up on the base | Back to the holder (giver / holder's clock) |
|---|---|---|---|---|---|
| 11 (complete) | set + 100 balls, one trade | **4 ticks** | yes, 1 send, 0 refusals | "You place the cannon base on the ground." | 5 / 4 ticks |
| 0 (not started) | set + 100 balls, one trade | **4 ticks** | yes | "You can't set up this cannon." | 5 / 4 ticks |

4 ticks is the receiver floor SUPPLIES.md measured for a few stacks.

### Demo leg (rs-sdk-demo, 2026-10-22 00:56-01:06 UTC)

No throwaway has done Dwarf Cannon, so the acceptance ran as a round trip of h92's spare set
with a fresh account, on Falador west bank's floor (holder 2945,3369, receiver 2944,3369):

| Leg | Giver | Receiver | One trade | Items | Receiver clock | Giver clock |
|---|---|---|---|---|---|---|
| 1 | cairn_h92 (serve) | cairn_h93, fresh (`cannon-receiver.ts`) | yes | base, stand, barrels, furnace, 100 balls | 8 ticks | 6 |
| 2 | cairn_h93 (serve) | cairn_h92, quest complete (serve `returnTile`) | yes | base, stand, barrels, furnace, 100 balls | **6 ticks** | 4 |

Both holders found their partner by name hash, with 0 refusals. Leg 2 is the acceptance: a
quest-complete account receives a set and balls in one trade. Leg 1's 8 ticks are likely
inflated by the stand-in's own measurement. It counts the holder's request only once it is on
its own tile, so it missed the one sent while it walked in, clicked after its 30-tick wait, and
the 8 likely include walking to the holder. Set-up was not tried on the demo.

h92's bank, read with the bank open before the leg and again after it banked the returned load,
was identical (inventory empty both times):

| Item | Before | After |
|---|---|---|
| Cannon base, stand, barrels, furnace | 2 each | 2 each |
| Cannonball | 1,416 | 1,416 |
| Coins | 4,246 | 4,246 |
| Ammo mould / Instruction manual | 3 / 2 | 3 / 2 |

During the leg, h92's load left 1 set and 1,316 balls in its bank.
