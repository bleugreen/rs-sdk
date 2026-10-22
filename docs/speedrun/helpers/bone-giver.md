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
  (`writeBoneAsk`) and clicks trade on the giver. The giver holds a side tile of the scored
  account, re-stepping whenever it moves, answers the request on the frame that carries it, offers
  exactly the asked count in one press, and refills to `hold` (28) when it holds fewer than
  `refillBelow` (21).
- **Why a side tile (S18).** An op on a player reaches it only from a side: the engine uses
  rsmod's rectangle reach (`GameMap.reachedEntity`), which a diagonal corner does not satisfy, and
  a stunned account cannot step round to it. So a request between the stunned scored account and a
  giver on a corner, or 2-3 tiles away, goes nowhere and draws no message. rs/279's lab stand-in
  lost 6 of 17 due top-ups that way while it held Chebyshev distance 1 (`lab/measure-thieving.ts`).
  The giver picks the nearest of the four orthogonal tiles that no NPC stands on, so never the
  knight's (`sideTiles`); a side the walk cannot reach falls through to the next.

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
account relogged.

When a click may go out is `lib/trade.ts`'s one rule for every trade click (`decideTradeClick`,
through `openTrade`; its header comment carries the engine facts), which `requestUntilOpen`
calls: never while the trade is open or the last click's action result is still pending, and a
click that drew no answer is re-sent `noReplyTicks` (2) frames after its result came back. A
re-click sent sooner can land on the trade the first one opened and close it: on rs/197's demo
the old rule here re-sent about a tick after a click that had opened the trade, counting from
the send while the relay still held the click. Rs/105's three 30-tick trades came from the old
8 s re-request in `lib/trade.ts` (`research/bones-placement.md` section 3).

## Options (`ROLE_OPTIONS`)

| Option | Default | Meaning |
|---|---|---|
| `mode` | `standing` | `standing` (S07) or `on-request` (S18) |
| `item`, `n` | `Dragon bones`, 23 | what and how many per S07 load (unnoted, one press) |
| `sites` | S07's oak then willow | `[{ giver, receiver }]` tiles in run order; the giver moves on when the receiver is not in sight within `siteWaitTicks` (30). Required for `on-request` (where to wait) |
| `trades` | no limit | stop after this many trades (else when the cue says stop) |
| `restock` | `{ kind: 'bank', bank: Falador west }` | `cheat` makes the bones with a staff command (lab only) |
| `noReplyTicks`, `resendTicks` | 2, 100 | re-send with no answer (frames after the click's action result); refresh a standing request |
| `hold`, `refillBelow` | 28, 21 | `on-request` only |
| `finalExtras` | none | `[{ item, count, obj? }]` carried and offered beside the bones on the **last** standing load only (the `trades`-th, so `trades` is required), in the same one-way trade: S07's last load also hands over T07-08's Camelot runes, `[{"item":"Law rune","count":1},{"item":"Air rune","count":5}]`; the scored account offers nothing back. `obj` is the staff-give name for `restock.kind: 'cheat'`; `n` + extras must fit 28 slots |

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

**The restock round trip** (`speedrun/lab/measure-bone-trip.ts`, the SDK's pathfinding walk,
as the role walks; 2 trials each):

| Falador west bank and back | Out | Back | Round trip |
|---|---|---|---|
| oak giver tile (2913,3494) | 79-82 | 79 | **158-161 ticks** |
| willow giver tile (2920,3407) | 74 | 75-78 | **149-152 ticks** |

Walking only; the bank visit adds a few ticks. Run energy read 100 after every leg, so the lab
did not drain it; on the demo a giver walking trip after trip will drain and partly walk, so
these are lower bounds. With a load due every ~70 ticks (rs/158: ~39 loads of 23), two
alternating givers allow 140 ticks per round trip and **three** allow 210: S07 needs three.

Not measured: the willow site's trades, and anything on the demo.
