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
