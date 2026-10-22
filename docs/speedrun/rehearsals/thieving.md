# Thieving: cairn_steals (S18, `speedrun/skills/thieving.ts`)

The Thieving rehearsal of rs/147: a fresh account, `cairn_steals`, from creation to Thieving 99 on
the demo, through `speedrun/rehearse.ts` on the twin. It is a **measurement, not a record
attempt**. Under amended addendum 18 the release gate is P(#1) >= 90% against jackalopeth8's
2,933 ticks (14:40), and the module's route models P(#1) at about 0.20 (rs/254 and rs/273,
`speedrun/lab/thieving-sim.ts`). The run still goes to 99, so rs/158 gets S18's 57-99 band, the
98-99 level-up and the logout measured on the demo.

Figures carry their source: (m) measured, (r) read from code or content, (i) inferred.

## S18 helper top-ups (lab, rs/279)

The scored run's S18 is fed food inside the stuns by a helper (the module's `topUp`). Two ways:
`idle` (the default) has the in-page program send the trade request as a `player` stun action on
the stun's +2; `restart` stops the program, receives with `lib/trade.ts` `receiveFrom`, and
restarts it by +9.

Lab: bgsrv-mac, `NODE_TICKRATE=300`, Thieving 57-99 at 97 HP, 2 sharks to start, a top-up of 1
shark due once fewer than 2 are held. The stand-in giver is `speedrun/lab/measure-thieving.ts`
`runGiver`, a second account kept beside the account by `::tele`. Command:
`HELPER=<h> LAB_BLOCK=thieving bash docs/speedrun/scripts/tickprog-lab.sh <a> speedrun/lab/measure-thieving.ts:topup:--mode=<idle|restart>:--helper=<h>:--to=99`.

### A player op reaches only from a side (the cause of the 'idle regression')

The engine runs a trade request when the requester is in operable distance of the target
(`Player.inOperableDistance`, `GameMap.reachedEntity`: rsmod's rectangle reach) (r). For a
one-tile target that is a side tile, not a corner. A stunned account can't walk round, so a
request sent at +2 to a giver on a corner goes nowhere and draws no message on either side (m).

The stand-in used to re-teleport only when it was not at Chebyshev distance 1, so it could sit on
a corner for whole runs while the account followed its knight. The trace now records the giver's
offset on each due failure's +2 (`giverAt2`, `dueDiagonal`).

| Run (57-99, one each) | Band ticks | Top-ups landed | Giver at +2 on the misses | Cost per top-up (m) |
|---|---|---|---|---|
| idle, corner allowed | 2,010 | 11/17 | `1,1` x5, `1,2` x1 | n/a |
| **idle, side tile** | **1,870** | **9/10** | `0,-1` x1 (a side) | ~0 (-1.33, noise) |
| restart, corner allowed | 1,902 | 10/15 | `1,-1` x5, in a row | -0.2 |
| **restart, side tile** | **1,883** | **10/10** | none | +0.30 |

Every landed top-up opened at +4 and closed at +7. Cost per top-up is the mean gap from a top-up
failure to the next roll less the same for other failures (11 is on time). Band totals are single
runs and mostly follow how many failures the dice gave (69 in the side-tile idle run, 87 in the
corner one), not the mode.

The program fired its request on every due stun (`stunFired` = due failures). rs/273's 0 of 14
(idle, out of food at Thieving 72) fits a giver held on one corner for the whole run (i): the
giver was adjacent and saw nothing. Its `requestClicks: 0` counts only the module's own clicks, not
the page's request, and its output did not keep the program's counters.

**The tenth idle miss** (failure at 1471): the request fired and the giver was on a side tile
(`0,-1`), so the stand-in's tile is not the cause; the band did not end first either (top-ups
landed after it). The giver never saw 'wishes to trade', so the engine dropped the request or never
processed it, and the trace cannot separate a late tick that left the account still delayed at +2
from a blocked edge. An idle re-send at +3, inside the ticks the program already holds silent
(REQUEST_HOLD), would be free; it is offered to rs/158 as its own opt-in change with a lab.

**Requirement on the real courier** (`speedrun/helpers/bone-giver.ts` on-request mode, rs/41): hold
a side tile of the scored account at each due +2, never a corner and never 2-3 tiles away. Its
`follow: 3` and `walkNear(receiver, 1)` allow both; at 2-3 tiles the program's `player` action does
not fire at all (it needs distance 1). Routed by rs/147 to rs/41 and rs/158.

**What a lost top-up costs** (m, the corner-allowed runs): nothing while the food held lasts. The
next due stun retries; there were no forced eats, no out-of-food ticks and no food stop in either
run, including 4 and 5 losses in a row. A run of losses longer than the food buffer ends the band
on a food stop, a bank trip (rs/273's case).

### Restart mode's dropped request (rs/273, re-confirmed)

Restart mode sends its request on the failure's own tick, inside the stun's delay, and the engine
drops a delayed player's op with only an UNSET_MAP_FLAG (`OpPlayerHandler`) (r). `openTrade`
re-sent only after a 'busy' refusal, so in rs/273's lab 13 of 13 requests vanished. The fix is
`receiveFrom(..., { byTick, noReplyTicks: 2 })`: re-send when neither 'Sending trade offer...' nor a
refusal came back after 2 ticks, and bound the whole receive by game ticks. Both options are
opt-in and default-identical (`lib/trade.test.ts`). Re-confirmed above: 10/10 with the giver on a
side tile.

## Kit and food for cairn_steals

Kit from `cairn_mule2` (rs/237) at Lumbridge (3222,3222) right after S00, one hand-off:
`cake:30,shark:20,coins:100`, the food noted (3 slots). The coins pay the ship route (60). Agility
takes the other 25 of mule2's 55 cakes.

The module eats one food per program run, with that food's thresholds (`eatPolicy`: at a 10 HP cap
a cake is eaten at 6 and a shark at 4). `--skill-opt=food=cake,shark` sets the order: each bank stop
withdraws the first food the bank still holds (cakes, then sharks), and each run eats the first
food the inventory holds.

HP budget from the route (r, `thieving-sim.ts` inputs: pickpocket.dbrow damage and success curve,
expected failures per level):

| Band | Target | Failures | Damage |
|---|---|---|---|
| 1-25 | men | 8.6 | 9 |
| 25-40 | warrior women | 12.7 | 25 |
| 40-55 | guards | 21.4 | 43 |
| 55-99 | knights | 90.5 | 271 |
| **total** | | 133 | **348** |

About 25 HP regenerates over the run, so the food needed is about 320 HP, standard deviation
about 35 (i). 30 cakes give 360 HP (12 a cake in three bites); 20 sharks add about 120 (about 6
each, eaten at 4 against a 10 HP cap), about 4.5 standard deviations of cover.

## Demo measurement run

Pending: the twin is first come, first served under `rs-claim`, after Mining (rs/259) and Agility
(rs/270). Staged in `~/rs-279` at 27c493f6 on the twin, its bundle carrying the pickpocket
opt-ins (`retargetTicks`, `stopWhenFoodBelow`, `idleOnInterface`, `stunActions`).
