# Bone giver (dragon bones beside the scored account)

`speedrun/helpers/bone-giver.ts`, a run-machine role started by the launcher
(`standalone.ts`, HELPERS.md "Helpers on the run machine"), like the altar givers. It hands
the scored account its dragon bones in two places (SUPPLIES.md, H4.1-H4.16 and H14.1-H14.13):

- **S07, mode `standing` (default).** While the scored account chops with the knife cycle and
  buries a bone every roll (`skills/woodcutting.md` section 9), the giver stands on the tile
  beside its chopping tile (oak 2913,3494 beside 2914,3494; then willow 2920,3407 beside
  2920,3406) holding exactly one load (23), and keeps a trade request standing. The scored
  step's own trade click (`lib/trade.ts receiveFrom`) opens both screens at once, and the giver
  offers the load in one press (`lib/trade.ts give`). 16 loads, 355 bones.
- **S18, mode `on-request`.** The scored account requests at a stun offset of its choosing and
  sizes the load then (15-21). It writes the size to `bones-ask.json` in the cue directory
  (`writeBoneAsk`) and clicks trade on the giver. The giver stays within `follow` (3) tiles,
  answers the request on the frame that carries it, offers exactly the asked count in one press,
  and refills to `hold` (28) when it holds fewer than `refillBelow` (21).

The receiver is never named: it is whoever in sight matches the receiver hash in the cue
directory's `cue.json` (`altar-cue.ts`), which the scored side writes at login. The giver
publishes `bones-<account>.json` there (phase, bones held, trades, refusals).

## Why a standing request, re-sent on the next tick

`trade.rs2 [opplayer4]` refuses a request while the target is busy, meaning delayed (a bury
delays the scored account through the tick after it lands) or with a modal open (a level-up
page). The requester sees "<name> is busy at the moment". Otherwise it sees "Sending trade
offer...", and the request stands: the giver's `%tradepartner` and the target's
`%tradestatus = received` stay set until a trade opens or closes. So the giver answers a
refusal on the frame that carries it (the re-send lands on the next tick) and never re-sends a
request that landed, except after `resendTicks` (100) without a trade, in case the scored
account relogged. `decideRequest` holds that rule and is unit-tested
(`bone-giver.test.ts`). `lib/trade.ts give` on its own re-requests only every 8 s: that is
where rs/105's three 30-tick trades came from (`research/bones-placement.md` section 3).

## Options (`ROLE_OPTIONS`)

| Option | Default | Meaning |
|---|---|---|
| `mode` | `standing` | `standing` (S07) or `on-request` (S18) |
| `item`, `n` | `Dragon bones`, 23 | what and how many per S07 load (unnoted, one press) |
| `sites` | S07's oak then willow | `[{ giver, receiver }]` tiles in run order; the giver moves on when the receiver is not in sight within `siteWaitTicks` (30). Required for `on-request` (where to wait) |
| `trades` | no limit | stop after this many trades (else when the cue says stop) |
| `restock` | `{ kind: 'bank', bank: Falador west }` | `cheat` makes the bones with a staff command (lab only) |
| `noReplyTicks`, `resendTicks` | 3, 100 | re-send with no answer; refresh a standing request |
| `hold`, `refillBelow`, `follow` | 28, 21, 3 | `on-request` only |

## Measured (local engine, `NODE_TICKRATE=300`, bgsrv-ub, 2026-10-21 12:55-13:10 PDT)

`speedrun/lab/bone-giver.ts` launches the giver (cairn_h70, staff-made bones) and the stand-in
`bone-receiver` (cairn_h75) through the launcher. The stand-in buries one bone every 3 ticks
like the knife cycle (so it is busy two ticks in three and the giver's requests really
bounce), trades with `receiveFrom` when its last bone is gone, and on chosen loads raises a
real level-up page (`::advancestat`) right after the trade and holds it open 7 ticks.

| S07, 12 loads, giver logged in first (the run's order) | |
|---|---|
| Scored side: trade click to the bones in its pack | **4 ticks** (11 of 12; the first load 5) |
| Request already standing at the scored click | 11 of 12 (all but the first) |
| Refusals per load | 1 (a bury), 6 while a page was held; each re-sent on the next tick |
| Held page closed to the giver's request reaching the scored account | **0 ticks**, 3 of 3 (it landed on the closing tick) |
| Scored ticks lost to refusals | 0: the request stands ~69 ticks before the click is due |
| Last bury to the next bury across a trade | 7 (3 without a trade): **4 ticks per load** |

rs/105 measured 5 ticks per load with `give` alone, plus 30-tick bounces on 3 of 22 willow
trades. With the scored side logged in first (`--order=receiver-first`), its bury is handled
before the giver's request each tick and refusals can run for 50 ticks in a row. The trades
still cost 4 ticks, because the request has a whole load's burying to land in, but it is one
more reason the helpers log in first.

| S18 top-ups, 8 asks of 15-21 (`--asks=15,21,17,19,16,20,18,15`) | |
|---|---|
| Exact count given | 8 of 8 |
| Scored side: its click to the bones in its pack | **6 ticks** (7 of 8; the first 32, the giver still arriving) |
| Giver: request seen to screens open | 1 tick |

The two extra ticks against S07 are the scored request's round trip. A standing request from
the giver would open the screens on the scored click there too (the size is read once the
screens are open), which would make a top-up 4 ticks; SUPPLIES.md has SCORED request, so that
is proposed rather than built.

Not measured: the bank round trip (Falador west from the Taverley trees is ~120 tiles each way,
longer than a load's ~77 ticks, so one giver cannot keep up from that bank alone; it needs a
second giver or a courier at the trees), the willow site, and anything on the demo.
