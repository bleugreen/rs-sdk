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

Measured on the demo (rs/315, below): only **27 cakes leave the bank** at the provision stop, since
it fills the 27 slots that coins leave free, and the restock withdraws the first food the bank still
holds. So the first stop carries 324 HP, not 360, and a second stop fetches the 3 remaining cakes
before any shark. cairn_steals ran out at Thieving 96 and banked once; the sharks never left the bank.

## Demo measurement run (rs/315): cairn_steals, Thieving 1-99

**Not a record attempt** (addendum 18 amended; P(#1) about 0.20). **Thieving 99 at 3,343 ticks of
playtime by the tick log, 3,342 on the hiscore** (category 18: **rank 3**, 16m 42s; -1, the relog
convention). The hiscore's time column is ticks x 0.3 s. The board at 07:39Z (r):

| Rank | Account | Time | Ticks |
|---:|---|---|---:|
| 1 | jackalopeth8 | 14m 40s | 2,933 |
| 2 | stunthief | 16m 15s | 3,250 |
| **3** | **cairn_steals** | **16m 42s** | **3,342** |
| 4 | jackalopeth2 | 16m 49s | 3,363 |

The run took place on the twin under rs/315's claim (07:14:22-07:40:05Z, 2026-10-22), in one
session, 07:16:42-07:35:48Z. It ran from `~/rs-315` at 532b8f7b, whose Thieving code is main #244's,
identical to rs/279's labbed 27c493f6. The page server ran from that worktree: the served
`client.js` had the worktree build's md5, and before login it showed `stopWhenFoodBelow` 3 times,
`retargetTicks` 3 times and `idleOnInterface` twice. The command was
`rehearse.ts --skill=thieving --bot=cairn_steals --gate-bot=cairn_twin --claim-owner=rs/315 --kit-from=cairn_mule2 --kit=cake:30,shark:20,coins:100 --skill-opt=food=cake,shark`,
with `DISPLAY=:10`, under `timeout 70m`. The tick log is
[`thieving-evidence.jsonl`](thieving-evidence.jsonl). Labels: m measured (that log), r read,
i inferred. The model is `speedrun/lab/thieving-sim.ts --fixed=387 --overhead=<all>:0.19`
(rs/243's table, reproduced by rs/254): mean 3,077, sd 165.

### Per step (m)

| Step | Ticks | Model (mean +- sd) | Notes |
|---|---:|---:|---|
| S00 tutorial skip | 4 | fixed | ticks 2-6 |
| S01 kit (cairn_mule2, Lumbridge) | 8 | fixed | 6-14; 30 noted cakes, 20 noted sharks, 100 coins in one hand-off; the giver recorded it once at 07:16:45Z |
| men 1-25 | 160 | 155 +- 39 | program 14-174 |
| to Ardougne (ship) | 306 | fixed | sub-legs below; lab 303 |
| provision (bank stop) | 27 | fixed | everything but coins deposited, 27 cakes withdrawn |
| warrior women 25-40 | 371 (program 358, walk 13) | 184 +- 56 | |
| guards 40-55 | 303 (program 285, walk 18) | 310 +- 74 | |
| knights 55-57 | 27 (program 21, walk 6) | in the next row | |
| knights 57-99 | **2,135**: program 1,860 (57-96, out of food), bank stop 56, program 219 (96-99) | 55-99: 2,041 +- 130 | |
| **Total to 99** | **3,343** (hiscore 3,342) | **3,077 +- 165** | +266 (+1.6 sd) |

The fixed part (S00, kit, leg, provision, the walks to each band and the 2 ticks outside the
runner) measured 384 against the model's 387. The session had 0 ticks in every one of its 10
boundary rows and 2 outside the runner (0.2 per boundary). The logout click landed on tick 3,343,
the last step's end (latency 0), and the page confirmed it in 259 ms. Wall time was 19 min 6 s,
a mean of 343 ms a tick.

### Ship sub-legs (m)

| Sub-leg | Ends | Ticks | Notes |
|---|---:|---:|---|
| Lumbridge (3217,3208) to Port Sarim | 319 | 145 | |
| sail to Musa Point | 337 | 18 | 1 talk click |
| Karamja path to the Brimhaven dock | 441 | 104 | |
| sail to Ardougne | 465 | 24 | 1 talk click |
| landing to the market | 480 | 15 | |
| **Total** | | **306** | lab 303 |

No talk-to needed the 12-quiet-tick re-send. No HP was lost on the leg. 115 coins were left: the
kit's 100, plus 75 from the men, less the two 30-coin fares.

### 57-99, cumulative ticks from 57 (m against the model)

| Level | 60 | 65 | 70 | 75 | 80 | 85 | 90 | 95 | 96 | 99 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Measured | 52 | 222 | 363 | 524 | 734 | 1,039 | 1,359 | 1,709 | 1,802 | 2,135 |
| Model (per-level expectation, overhead 0.19) | 53 | 159 | 290 | 455 | 659 | 913 | 1,225 | 1,608 | 1,692 | 1,970 |

Level 96 to 97 took 160 ticks, including the 56-tick bank stop.

### Stuns, eats and bank trips (m)

| Band | Rolls | Successes | Fails (expected at that many successes) | Success rate | HP lost (budget) | Bites eaten | Forced eats | Eat ticks lost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| men 1-25 | 33 | 25 | 8 (8.6) | 0.76 | 8 (9) | 2 | 0 | 1 |
| warrior women 25-40 | 43 | 17 | **26 (12.7)** | **0.40** | **51 (25)** | 11 | 7 | 23 |
| guards 40-55 | 46 | 27 | 19 (21.4) | 0.59 | 38 (43) | 9 | 3 | 13 |
| knights 55-57 | 4 | 3 | 1 (2.2) | 0.75 | 3 | 1 | 0 | 0 |
| knights 57-99 | 530 | 445 | 85 (88.3) | 0.84 | 267 | 63 | 26 | 124 |
| **Total** | **656** | **517** | **139 (133.2)** | | **367 (348)** | **86** | **36** | **161** |

- **One bank trip**, at Thieving 96 (ticks 3,068-3,124, 56 ticks). The program stopped on food
  (`reason: food`; its out-of-food counter read 11). The restock withdrew the 3 cakes the bank
  still held and no sharks, and the run finished with 2 left. The 20 sharks never left the bank.
- **Why the food ran out:** 27 cakes went out at the provision stop (above), 324 HP against the
  budget's 360. HP lost was 367 against 348, with 26 more on warrior women than budgeted. The 86
  bites eaten are 344 HP, and about 33 HP regenerated over 3,343 ticks.
- **Its cost:** the 56-tick stop. Had more than the 3 cakes' 36 HP been needed after 96, this
  restock rule would have banked a second time before reaching the sharks (i). Filling the free
  slots down the food list at a stop (the 3 cakes, then sharks) would remove that second stop. It
  is not changed here: this run measured main #244 as it stands, and the scored run never takes
  this path (it uses helper top-ups and sharks at 40+ HP). It goes to rs/147.
- **The program on the demo:** 0 catch-ups in every program run. Reaction p90 was 2 ms, and loop
  p10 was 71.6-72.7/s (one dip to 48.3 in the long knights run). There were 2 op rejections in
  that run. After a success, 321 of 366 gaps were the 2-tick minimum.

### Gate, players and the recording (m)

| Read | UTC | Result |
|---|---|---|
| direct, cairn_twin (rs/96's CLI) | 07:14:34 | (a) **57/60, under the floor of 58**; (b) tick p90 469 ms, over the 400 report line; (c) 0 catch-ups/min; edge iad, TCP connect p50 2.4 ms. The CLI's verdict: investigate, do not start |
| gate tab before, cairn_twin | 07:16:35 | (a) 59/60; (b) 511 ms, over; (c) 1/min; (d) loop p10 72.7/s: marginal, pass. Logout confirmed by the page, latency 0. cairn_steals' window staged maximised, the gate window closed |
| live frame | 07:16:43 | **PASS**: cairn_steals' tab the only window, maximised, in front of :10; frame difference 2.2 against contrast 50.5; no raise |
| gate tab after, cairn_twin | 07:37:56 | (a) 58/60; (b) 532 ms, over; (c) 0/min; (d) 72.5/s: marginal, pass |

- **The direct read's (a) failure did not refuse the attempt.** That is by design: the harness's
  pre-flight refuses only on (c) or on a failed or stale direct read, and it prints (a), (b) and
  (d) without refusing (`speedrun/rehearse.ts`, the gate refusal). For a measurement run that is
  the rule. For rs/host's series, it was one twin read under 58/60.
- **Tick monitor:** over 19 minutes there was 1 glued tick (minute 1) and none in any other
  minute. Per-minute periods were 304-379 ms.
- **Players** (`/playercount`): 1,768 at the start, 1,763 at 07:26:42Z, 1,691 at the end. At the
  claim, 60 of our accounts were online.
- **Recording:** `~/recordings/rehearsal-cairn_steals-20261022T071429Z.mkv` on the twin: 22 min
  51.6 s, 41,152 frames at 30 fps, 0 dropped, 316 MB. It started at 07:14:29Z, before the gate
  tab, and stopped at 07:37:22Z after the logout. So it shows cairn_twin's window during the
  before-probe, and cairn_steals' window from login to logout.

### Divergence from the model (sim mean 3,077, sd 165)

The run came in **+266 ticks over the model, +1.6 sd**. The sim gives P(total >= 3,343) = 0.059.

| Part | Measured | Model | Difference | Cause |
|---|---:|---:|---:|---|
| fixed (S00, kit, leg, stops, walks) | 384 | 387 | -3 | |
| men 1-25 | 160 | 155 | +5 | |
| warrior women 25-40 (program) | 358 | 184 | **+174** | the dice: 26 fails for 17 successes, where 12.7 are expected (sim P(band >= 358) = 0.005). The curve holds: the same pickpocket row measured 56.5% at 25 over 200 rolls (Al-Kharid, `docs/speedrun/skills/thieving.md`), against 39.5% over 43 here (i) |
| guards 40-55 (program) | 285 | 310 | -25 | the dice, the other way |
| knights 55-99 | 2,156 (program 2,100, bank stop 56) | 2,041 | **+115** | the bank stop (56), which the sim doesn't have, and eats (below) |
| **Total** | **3,343** | **3,077** | **+266** | |

- **Eats cost more than the sim prices.** The sim makes a window eat free and a forced eat cost 3
  ticks, for 16.4 forced eats in a mean run (about 49 ticks). This run had 36 forced eats and 161
  eat ticks lost (124 of them at 57-99). That is about +110 ticks the model doesn't carry (m for
  the counts, i for the attribution). The knights' fails were on the model (85 against 88.3), so
  knights' extra time is eats and the stop, not stuns.
- **For rs/158's S18 (the scored run's 57-99 band):** this band measured 2,135 ticks, or 2,079
  without the stop. It ran at 10 HP on cake, which forces many eats. The scored run's shape is 97 HP
  on sharks with top-ups, and its figure stays the lab's 1,870 / 1,883 (section "S18 helper
  top-ups"). What this run adds from the demo: the program's timing held (0 catch-ups, the 2-tick
  minimum on 88% of success gaps, reaction p90 2 ms), and the 98-99 level-up and the logout cost
  nothing visible (the click landed on the 99 tick, latency 0).

### After 99

cairn_steals is logged out at the East Ardougne knights, confirmed by the page, and is not on
`/playerpositions`. Its bank there holds the 20 sharks and the starter items. No kit return was
run: `speedrun/tools/kit-return.ts` walked cairn_rocks to its death from Ardougne, and rs/314 is
fixing it (a home teleport first). rs/147 schedules the return after that. On the twin, the claim
is released, the stack is stopped, `~/rs-315` and its bundle are removed, and the leftover check
is clean. cairn_steals' env file stays.
