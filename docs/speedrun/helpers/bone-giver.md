# Bone giver (dragon bones beside the scored account)

`speedrun/helpers/bone-giver.ts`, a run-machine role started by the launcher
(`standalone.ts`, HELPERS.md "Helpers on the run machine"), like the altar givers. On run
day S07's givers carry `stopOn: { step: 'S07', family: 'bone' }`: the role ends on S07's stop
anyway, and the launcher logs the account out at once when S07's scope closes (its final stop,
or the next scope's cue) instead of leaving it in the world until the launcher's stop
(HELPERS.md, "The cue gate"). It hands
the scored account its dragon bones in two places (SUPPLIES.md, H4.1-H4.16 and H14.1-H14.13):

- **S07, mode `standing` (default).** While the scored account chops with the knife cycle and
  buries a bone every roll (`skills/woodcutting.md` section 9), the giver stands on the tile
  beside its chopping tile (oak 2913,3494 beside 2914,3494; then willow 2920,3407 beside
  2920,3406) holding exactly one load (23), and keeps a trade request standing. The scored
  step's own trade click (`lib/trade.ts receiveFrom`) opens both screens at once, and the giver
  offers the load in one press (`lib/trade.ts give`). 16 loads, 355 bones.
- **S18, mode `on-request`: the stun-pack courier (HS2).** The scored account's Thieving module
  requests at stun +2 (the in-page program's `player` stun action in idle mode, the module's
  `receiveFrom` in restart mode). The courier holds a side tile of the scored account, re-stepping
  whenever it moves, and answers the request on the frame that carries it. Once the trade is open
  it offers what the scored side's **top-up ask** names, each item with one press (`askOffer`), and
  refills to `hold` bones and its `carry` list when it holds fewer than `refillBelow` bones or less
  than a carried count. S18's bones are babydragon bones (the dragon-first rule: `item:
  'Babydragon bones'`).
- **Why the scored side sizes the load (the top-up ask).** The courier can't see the scored
  account's inventory, and the trade screen doesn't show its free slots. So the Thieving module
  (`thieving.ts` `TopUpAsker`, sized by `topUpAsk`) writes the ask to `topup-ask.json` in the cue
  directory (`altar-cue.ts` `writeTopUpAsk`) on the frame that shows the trade open. From then
  until the trade ends it sends nothing else, so its free slots can't change under the ask. The
  sizing is stun-pack.md section 5: bones in every free slot but one (kept for a new arrow product
  stack, and one more for the knights' coins until some are held), food back to 2, and the adamant
  and then the rune arrowtips once each when the account is down to one tier. Each ask item is a
  name pattern and a count or `all`. The courier takes only an ask written after it saw the trade
  open (less 300 ms for the two clients' frame arrivals) and newer than the last one it served, so
  an earlier trade's ask is never sized onto this one. It waits up to `askWaitTicks` (2) observed
  ticks for it; in the lab it was always there on the open frame (`openToAsk` 0). The wait is
  `altar-cue.ts` `awaitAsk`, which the trade giver's top-up packages share ([mule.md](mule.md)).
  An ask may carry a `scope`. The courier's carry none, and the courier takes only an unscoped
  ask, so an ask scoped to the trade giver (family `mule`) can never be served by the courier,
  and the other way round.
- **Keeping up.** The courier steps toward a side tile in bounded steps (`stepToSide`): it sends
  the walk without awaiting the walk's action result, then re-reads after at most 4 observed ticks
  or as soon as the account moves. Awaiting the result (`standOn`) stalled it for 180-350 ticks at
  a time among the wandering knights, and about half the due top-ups found it 5-15 tiles off.
- **`standing` (default off; rs/158's option).** The courier keeps its own trade request standing
  from its side tile (`requestUntilOpen`, the one click rule), so the scored account's top-up click
  opens both screens at once: open at stun +3 instead of +4, closed at +6-7 instead of +7-8. That
  frees the stun's last bury (Measured below). The request is dropped and re-sent whenever the
  account moves off the courier's side. A refused re-send (the account delayed by its stun) returns
  in `trade.rs2 [opplayer4]` before it touches the trade variables, so the standing request
  survives it, and the account's knight clicks don't touch them either.
- **Why a side tile (S18).** An op on a player reaches it only from a side: the engine uses
  rsmod's rectangle reach (`GameMap.reachedEntity`), which a diagonal corner does not satisfy, and
  a stunned account cannot step round to it. So a request between the stunned scored account and a
  giver on a corner, or 2-3 tiles away, goes nowhere and draws no message. rs/279's lab stand-in
  lost 6 of 17 due top-ups that way while it held Chebyshev distance 1 (`lab/measure-thieving.ts`).
  The giver picks the nearest of the four orthogonal tiles that no NPC stands on, so never the
  knight's (`sideTiles`); a side the walk cannot reach falls through to the next.
- **Never across a wall edge (S18).** A side tile counts only if no wall lies on the edge between
  it and the scored account (`wallBetween`, `onOpenSide`). The stunned account cannot step, so a
  request across a wall draws 'I can't reach that!' and dies on its own tick (rs/454's engine
  probe; this was the ~1 in 40 unanswered top-ups, 6 of 191 in the lab). The Ardougne knights'
  area has walled columns: x=2672 carries an east-edge wall at z 3299-3303 and 3306-3310. The wall
  is read from either tile's directional wall flag in the SDK pathfinder's collision map
  (`sdk/pathfinding.ts` `isFlagged`, rsmod's `CollisionFlag.WALL_*`), the map every helper launch
  already loads, so the helper keeps no map of its own. A blocking loc such as a stall is no wall:
  a stall tile with an open shared edge stays a side. The same rule decides whether the courier is
  already on a side, so one standing across a wall re-steps rather than waiting there. With every
  side walled or taken by an NPC, `stepToSide` faults with 'no free side tile' as before. One gap:
  the SDK map clears the wall at door positions so routes pass through them, so a closed door on
  the shared edge is not seen.

The receiver is never named: it is whoever in sight matches the receiver hash in the cue
directory's `cue.json` (`altar-cue.ts`), which the scored side writes at login. The giver reads
only a cue scoped to its own step and family (`scope`, altar-giver.md "The cue contract"):
`{ step: 'S07', family: 'bone' }` for the standing mode, `{ step: 'S18', family: 'courier' }`
for on-request. Runecraft's S06 cue, which ends with a stop, is invisible to both. The giver
publishes `bones-<account>.json` there (phase, bones held, trades, refusals).

## Taking turns (S07's group, b01-b04)

S07 has four givers, cairn_b01-b04, because one restock round trip is longer than three loads' worth of burying. Each carries `group: ["cairn_b01", "cairn_b02", "cairn_b03", "cairn_b04"]`, and the group takes turns by one rule, `boneServer`. It is the same `altar-cue.ts turnOrder` the altar side's batch uses:

- **The server** is the group giver already requesting or trading. Otherwise it is the loaded giver that has stood at the site longest (`readyAt` in its `bones-<account>.json`), with ties broken by name. Statuses older than 5 s don't count.
- **Only the server keeps a request standing.** The others wait loaded on the same tile (players stack) with phase `waiting` and detail `queued behind <server>`. They re-read the order every tick or two.
- **Overlap:** two givers that start requesting on one frame resolve by the same order. The one that has waited less stands down.
- **After its trade** the server restocks, and its `readyAt` clears, so the next in line takes over within a tick. A request that came to nothing, or a turn waited out, keeps a giver on its tile and its place in the order.
- **The scored side** names its trade partner by the same rule: `boneServer(readBoneStatuses(cueDir), group, Date.now())` before each load's `receiveFrom`. Both the S07 step (`woodcutting.ts` `bones.group`) and the stand-in (`givers: [...]`) take it from `awaitBoneServer`, which waits on observed ticks while no giver serves and gives up after `SERVER_WAIT_TICKS` (400). The step also writes the S07 bone cue the givers read (`skills/woodcutting.md` section 9, "The giver group").
- **The last load and its runes.** With a group, `trades` counts the group's loads: the sum of the givers' `trades` in their status files for the current cue session (`groupLoadsDone`). A file from another run, with another session, counts for nothing. S07's last load also hands over T07-08's runes, and the group never knows ahead of time whose turn that will be, because the first round's order comes from who reaches the tile first (b02, b03, b01, b04 on the demo). So **exactly one** giver's entry carries `finalExtras`, and every giver carries `trades` set to S07's load count. That giver is marked `final` in its status. It carries a whole load plus the runes on every trip, and offers the runes only on the group's last load. `boneServer` gives it that load and gives it to no one else. It also passes the final giver over for any load within one rotation of the last (fewer than group-size loads before it), so the final giver is back from its last bank trip and waiting when the last load comes. If the rotation lines up, the final giver's normal turn is already the last load and nothing changes. Otherwise it swaps one turn with the giver after it. The scored step just accepts the runes on its last load, whoever serves it. After the last load there is no server, and the givers end. Only the final giver's bank is staged with the runes (law 1, air 5). For S07 that giver is **cairn_b04** (rs/158's ruling, SUPPLIES.md H4 and T07-08).
- **Relaunch.** A relaunched giver reads its own status file before it first writes one. If the file's session matches the first cue it sees, it carries on from that file's `trades` (logged `resumed`), so the group's count survives a relaunch. A new session counts from zero.

- **Two bone types (S07: every dragon bone, then babydragon).** `item` may be a priority list, `["Dragon bones", "Babydragon bones"]` (standing mode only; S18's courier serves one). Each restock fills the load from the first type the giver's own bank still holds, then the next (`boneWithdrawals`), and the load offers what is carried in the same order, so a load at the switch is mixed. Spread the dragon bones evenly over the group's banks: each giver buries its own first, so **every dragon bone is buried however the rotation falls**, and the total is exact to the bone. With one type per giver it would not be. The rotation fixes nobody's load count, and every load a dragon-only giver gains or loses moves the total by 23 × (72 − 30) = 966 base. A later dragon top-up only adds dragon to the banks and lowers `trades`; the babydragon it displaces stays banked. The step accepts any bones (`woodcutting.ts` `bones$`).
- **A bank that can't make a load.** In a group, a giver whose bank is short of a load or of its `finalExtras` leaves the rotation: it logs `bank short: leaving the group` and goes `off` with the reason as its detail. The others cover its loads. Without a group it keeps retrying (`fault`). A final giver short of its runes leaves too, and the last load then has no server, so stage its runes before the run.

Lab, last-load rule (the `local` executor, bbl, 2026-10-22 17:42Z, `--givers=3 --loads=7 --final=1 --pages=`, a loaded machine, so the tick figures are rough): 7 of 7 loads, served h70, h71, h72, h70, h72, h70, h71. h71's natural turn was load 5, within one rotation of the last, so it waited, and it served load 7: 21 Dragon bones, 1 Law rune and 5 Air rune, all received. The last load took 8 ticks from click to bones (the others 4) and a bury gap of 11 (the others 7): the extras' offer costs about 4 ticks, once.

Lab, two bone types (`local`, 2026-10-22 18:16-18:21Z, `--givers=4 --loads=12 --final=3 --mix=30,60 --pages=`; each giver's Falador west bank seeded once with 30 dragon and 60 babydragon by `restock.labSeed`, every load a real withdrawal; a correctness check, not a timing one): **12 of 12**, in strict rotation h71, h70, h72, h73 three times. Each giver went 23 dragon, then 7 dragon + 16 babydragon, then 23 babydragon; h71's first load was the 23 babydragon it still carried from an earlier run, which a giver serves as it is. The last load was h73's: 14 dragon and 7 babydragon, 1 law and 5 air, all received. The run before it went 11 of 12, because the lab driver had not seeded the final giver's law rune, and h73 retried its bank every 3 s and never served. That is why a short bank now takes a giver out of the rotation.

Lab, local engine at 300 ms (`speedrun/lab/bone-giver.ts --givers=3 --loads=6 --pages=`, staff-made bones, 2026-10-22):

| | |
|---|---|
| Loads taken | 6 of 6, in turn h70, h71, h72, h70, h71, h72 |
| Requests out of turn | none: each non-server logged `queued behind` its server and never requested |
| Scored side: click to the bones in its pack | **4 ticks** (5 of 6; the first load 5) |
| Last bury to the next bury across a trade | **7** (5 of 5): 4 ticks per load, as with one giver |
| Request standing at the click | 4 of 6 |

One turn (h71's first) bounced 52 times before its request stood, against 1-5 in the others. It cost no ticks.

**Each restock round trip is logged** as a `trip` line: ticks to the bank and back, run energy at the trade, at the bank and back on the tile, and whether each leg ran (`legRan`). A walk click carries the run flag, so a leg runs while energy lasts. Ran or walked is judged by pace: a walk covers at most one tile a tick, so a leg faster than its tile distance ran. Energy is no evidence, because the demo keeps it full.

### On the demo (rs/383, 2026-10-22 14:11-14:20Z)

The launcher ran on bbs through its own relay (not the run machine). cairn_b01-b04 were the group, each holding 92 Big bones (4 loads of 23, from cairn_h51), restocking at Falador west and serving the oak tile. cairn_h75 was the demo stand-in, taking 16 loads from the group's server.

| | |
|---|---|
| Loads | **16 of 16**, in strict rotation (b02, b03, b01, b04, four times round), none out of turn |
| Request standing at the stand-in's click | 12 of 16 |
| Stand-in: click to the bones in its pack | **7.25 ticks** mean (5-8) |
| Last bury to the next bury across a trade | **10.2 ticks** mean (8-11): about 7 ticks a load, against 4 in the lab |
| Restock round trip, Falador west and the oak tile with the bank visit | **205-215 ticks** (mean 211, n = 12): to the bank 98-106, back with the bank 103-111 |
| Ran or walked | **ran**: ~100 ticks a leg over at least 126 tiles; run energy read 100 at every trade, bank and arrival |

A load is due every ~70 ticks of burying, so four givers leave each ~280 ticks per round trip against the 211 measured: **four are enough, three (210) would not be**. The extra ~3 ticks a load against the lab come from both sides' clicks crossing bbs's relay. The run machine is 1.8 ms from the demo (altar-giver.md), so expect nearer the lab's 4 there, but that is not measured. The first attempt ended at once: cairn_h75 had been left in the air altar room by the Runecraft demo. The stand-in now leaves any altar room by its portal first (`altarRoomOf`).

## The trade-and-return rehearsal (S07 at full scale, nothing spent)

The whole of S07's rotation, played against a stand-in that keeps nothing, so the staged banks come out of it unchanged. The stand-in is `bone-receiver` with `returnLoads: true` and `givers`, and every giver has `acceptReturn: true` (bank restock only; never set on the run). Lab driver: `speedrun/lab/bone-giver.ts --givers=4 --loads=N --final=3 --mix=D,B --return --pace=69`.

- **Per load:** the stand-in takes the load from the group's server, as the step does, then gives exactly what that trade brought straight back to that giver (`give` by exact name; anything its pack already held stays). It then waits out `paceTicks` from the receive, by default n × buryEvery = 69, a load's bury time, before wanting the next load. So the rotation runs at the run's pace.
- **The giver** takes its load back with `receiveFrom` (`returnWants`: what it gave, merged by name). It stays `trading` while it does, so it keeps the turn: a next giver requesting a stand-in that is busy in this trade got no busy refusal in the lab, took the request as standing, and lost about 35 ticks to its re-send. Then it makes its real bank trip, depositing the returned load and withdrawing the next dragon first. So the round trip and the bank sequence are the run's.
- **At the end** every giver banks everything it holds (`final bank` lists its bones and extras) and goes off. The stand-in waits for all of them to be off, so each bank ends as staged.
- **The stand-in** banks, eats, equips and buries nothing. Its pack needs free slots for the biggest load, n or finalN + extras (23, or 21 + 2). Off the lab it may be any helper that is neither forbidden nor one of the givers (`assertDemoStandIn`).
- **Per load it records:** the giver, ticks from its click to the bones, whether a request was standing, ticks waiting for a server (a stall when the group had nobody ready), the return trade's ticks, and the gap since the last load. `RESULT bone-receiver` sums them.

**A standing request goes stale on an idle receiver.** In the lab, a giver's request that had stood about 60 or more ticks did not open on the stand-in's click. The trade opened only at the giver's re-send (`resendTicks`, 100), about 35 ticks late. The run's account buries every 3 ticks, so a request to it bounces as busy and is re-sent fresh: the step's loads came in 4 ticks in rs/436's lab and in 5-8 on the 16-load demo. The rehearsal's idle stand-in needs the givers to re-send sooner, so the lab driver sets `resendTicks: 30` with `--return`. With 100, 4 of 8 loads took 34-36 ticks; with 30, all 8 took 4-5. If S07 ever stands idle with a load requested (waiting on a chop with an empty pack, say), expect that cost.

Lab (`local`, 2026-10-22 18:50-18:55Z, 300 ms, 4 givers, 8 loads, final giver h73, `--mix=30,60 --return --pace=69`, `resendTicks` 30; a correctness check): **8 of 8** in strict rotation, every load handed back (4 ticks each), click to bones 4-5, a load every 73-74 ticks (the pace plus the trade), restock round trips 167-174 ticks. The last load was h73's 21 bones and the runes. Every bank ended at its starting count plus exactly that run's seed.

## The stand-in on the demo

`bone-receiver` on a non-local server uses no staff commands. It banks what it carries at Falador west, walks to the site, and raises no level-up pages. Its `item` option sets the bones it takes and buries; the demo uses `Big bones`, which are unstackable like dragon bones but not scarce. It buries what it's given, so off the lab it runs only as a run-machine test account (`STAND_IN_ACCOUNTS`: h70-h72 and h75) and refuses any other name.

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
| `scope` | required | `{ step, family }` of the cue it serves: family `bone` in the standing mode, `courier` in on-request (`altar-cue.ts` CueScope) |
| `item`, `n` | `Dragon bones`, 23 | what and how many per S07 load (unnoted, one press). `item` may be a priority list, S07's `["Dragon bones", "Babydragon bones"]` ("Taking turns") |
| `group` | none | standing mode only: the accounts taking turns at the site, this one included (S07: b01-b04; "Taking turns"). With a group, `trades` counts the group's loads |
| `acceptReturn` | false | rehearsal only (standing, bank restock): take each load back from the stand-in and bank everything at the end ("The trade-and-return rehearsal"). Never set on the run |
| `sites` | S07's oak then willow | `[{ giver, receiver }]` tiles in run order; the giver moves on when the receiver is not in sight within `siteWaitTicks` (30). Required for `on-request` (where to wait) |
| `trades` | no limit | stop after this many trades (else when the cue says stop) |
| `restock` | `{ kind: 'bank', bank: Falador west }` | `cheat` makes the bones with a staff command (lab only). `labSeed: [{ obj, n }]` (bank, lab only): staff-gives these, noted, before the first bank visit, which banks them, so every later withdrawal is a real one |
| `noReplyTicks`, `resendTicks` | 2, 100 | re-send with no answer (frames after the click's action result); refresh a standing request |
| `hold`, `refillBelow` | 28, 21 | `on-request` only; `hold` plus the carry's slots must fit 28 (the lab courier: 22, 2 sharks, 2 tiers) |
| `item`, `obj` | `Dragon bones`, the name in snake case | S18 uses `Babydragon bones`; `obj` is the staff-give name for `restock.kind: 'cheat'` |
| `carry` | none | `on-request` only: `[{ item, count, obj?, once? }]`, the other stacks kept for the ask. The courier: `[{"item":"Shark","count":2},{"item":"Adamant arrowtips","count":2070,"once":true},{"item":"Rune arrowtips","count":570,"once":true}]`. A `once` stack is delivered in one top-up and then not restocked |
| `standing` | false | `on-request` only: keep our own trade request standing (above) |
| `askWaitTicks` | 2 | `on-request` only: observed ticks after the open to wait for the ask, then decline |
| `finalExtras` | none | `[{ item, count, obj? }]` carried and offered beside the bones on the **last** standing load only (the `trades`-th, so `trades` is required), in the same one-way trade: S07's last load also hands over T07-08's Camelot runes, `[{"item":"Law rune","count":1},{"item":"Air rune","count":5}]`; the scored account offers nothing back. `obj` is the staff-give name for `restock.kind: 'cheat'`. That load carries `finalN` bones, default `n` minus the extras (21 with the runes), so it fits the same free slots as every load. In a group, set it on one giver only, with `trades` set to the group's load count on every giver: that giver serves the group's last load ("Taking turns") |

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

The two extra ticks against S07 are the scored request's round trip; the `standing` option
removes one of them in S18 (below).

### S18 with the real courier (rs/330, 2026-10-22, bgsrv-mac, 300 ms, browser client)

`speedrun/lab/measure-thieving.ts pack --mode=idle --courier=role [--standing]` runs this role
in-process on the helper's session against a lab cue, the Thieving module writing the asks, from
Thieving 57 to 99 with Load 0 (H14) staged. One run each, both on the bounded side step:

| | Due top-ups, courier on a side tile | Completed | Open / close (stun offset) | Top-up stuns that buried after the trade | Bones per top-up stun | Band ticks | Normalised | Bones in the band |
|---|---|---|---|---|---|---|---|---|
| `standing` off | 27 of 27 | 27 | +4 / +7-8 | 8 of 27 | 0.30 | 2,157 | 1,944 | 233 |
| `standing` on | 21 of 21 | 21 | +3 / +6-7 | 21 of 21 | 1.00 | 2,084 | 2,046 | 219 |

The courier's ask was on file at the open in every trade; no trade was short, declined or
faulted. Before the bounded side step, the same pair of runs had the courier 5-15 tiles off for
16 of 36 and 36 of 51 due stuns.

rs/158's acceptance for `standing`: (a) at least one bone buried after the trade in most top-up
stuns: 21 of 21, against 8 of 27 without. (b) Thieving ticks no worse: the top-up stuns
themselves were not slower (their mean gap 0.7 under the other stuns', against +0.22 without).
The band totals point both ways: 73 fewer band ticks, but normalised 102 higher, from slower
non-top-up stuns (knight wander). At one run each that is noise, so (b) is not shown either way.
(c) No trade opened without a due request (21 opened, 21 fired), and none was cancelled. It
stays off by default until rs/158 rules.

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

Not measured: the willow site's trades, and anything on the demo; the S18 courier's bank restock
(the lab restocks by staff command).
