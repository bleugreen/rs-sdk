# Mining: fastest route to 99

Scripts: [`mining-cycle.ts`](../scripts/mining-cycle.ts) (one standing tile: cycle,
respawn, drop tests), [`mining-rotation.ts`](../scripts/mining-rotation.ts) (executes a
rock rotation and checks every roll against the timing model),
[`mining-rotation-plan.ts`](../scripts/mining-rotation-plan.ts) (offline: finds the best
rotation for every iron cluster in the map files), [`mining-model.ts`](../scripts/mining-model.ts)
(route totals), shared helpers in [`mining-lib.ts`](../scripts/mining-lib.ts). Lab:
[../LAB.md](../LAB.md), mining port block, engine at `NODE_TICKRATE=300`. Labels follow
[README.md](README.md#labels).

## 1. Recommendation

Do Doric's Quest first (helpers hand over 6 clay, 4 copper ore and 2 iron ore; 1,300 base
xp puts Mining at 49), then mine iron with a rune pickaxe on the six-rock cluster south of
the Ardougne zoo (rocks at 2602-2605, 3233-3237), following a fixed rock rotation that
walks to chosen standing tiles and uses the "timer starter" trick (section 4). Drop each
ore in the same tick as the next rock click. On the demo, where about 1,260 players online
shorten iron respawn from 19 to 13 ticks, this rotation sustains **3.61 ticks per ore, 9.69
base xp per tick** at level 99 (measured, 60 ores, with the server's player count
emulated). Mining from 49 to 99 then takes **about 4,030 ticks**, and from level 1 about
4,320 (inferred from the measured rates, section 2). Doric's Quest therefore saves about
280 ticks of mining for roughly 30 ticks of dialogue on the road west from Falador. With
Digsite as well (16,600 base, level 86), mining needs **about 2,420 ticks**, but Digsite
itself takes about 2,180 ticks of playtime (measured on the stock client, p90 about 2,600;
`docs/speedrun/quests/digsite.md`, cairn://p/rs/16) to save about 1,612 ticks of mining.
It is a net loss for Mining alone; do it only if the quest plan needs it for another
reason, such as its quest points.

**On the planned quest route** the account also completes Plague City (2,425 base Mining,
`quest_elena.rs2:12`), which is in the Regicide chain and is done for that reason
(cairn://p/rs/3). With Doric's Quest and Plague City, Mining starts at level 64 (3,725 base),
with **about 3,765 ticks** of mining left on the demo and about 4,000 on a quiet server
(inferred, `mining-model.ts`).

The earlier "about 3,500 ticks" model assumed a 3-tick cycle could run forever. It
cannot: every ore depletes its rock, so a 3-tick cycle needs 5 rocks on the demo (7 on a
quiet server) all reachable without losing a tick, and no iron cluster in this content
has that geometry.

## 2. Route by level band

Rates at level 99 are measured (`mining-rotation.ts`, 60 ores per run, every roll landing
on its predicted tick). Below 63 iron can fail. The bands below 63 come from
`mining-model.ts` (inferred), which combines the measured rotation cost of a successful ore
with the read success formula and pickaxe rates.

| Band | Method | Location | Unlock | Base xp per ore (read) | Ticks per roll | Success (read) | Base xp per tick | Ticks for band (demo / quiet) |
|---|---|---|---|---|---|---|---|---|
| 1-15 | Copper or tin, one rock, iron pickaxe | any copper/tin rock | none | 17.5 | 8 with iron pickaxe (rate 6 + p_delay; inferred) | 50% at 1, 65% at 15 | 1.1 at 1, 1.5 at 10 (inferred) | 61 / 61 |
| 15-41 | Iron rotation, steel/mithril/adamant pickaxe as levels allow | zoo cluster | Mining 15 | 35 | rate + 1 | 52% at 15, 78% at 41 | 2.9 at 15 -> 7.8 at 41 (inferred) | 142 / 146 |
| 41-63 | Iron rotation, rune pickaxe | zoo cluster | Mining 41 (rune pickaxe) | 35 | 3 | 78% at 41, 86% at 49, 92% at 55, 100% from 63 | 7.8 -> 9.7 (inferred) | 301 / 318 |
| 63-99 | Iron rotation, rune pickaxe | zoo cluster, steps in section 4 | | 35 | 3 | 100% (1 roll in 256 hits the gem table, no xp) | **9.69** demo (measured, emulated respawn 13); **9.12** quiet server (measured, respawn 19) | 3,813 / 4,054 |

Totals (inferred, `mining-model.ts --extra 1.61` for the demo, `--extra 1.84` for a quiet
server; half a tick per level-up, section 6):

| Start | Demo (respawn 13) | Quiet server (respawn 19) |
|---|---|---|
| Level 1, no quests | 4,316 | 4,578 |
| Doric's Quest, 1,300 base (level 49) | 4,034 | 4,288 |
| Plague City, 2,425 base (level 58) | 3,904 | 4,150 |
| **Doric + Plague City, 3,725 base (level 64), the planned quest route** | **3,765** | **4,003** |
| Digsite, 15,300 base (level 85) | 2,557 | 2,718 |
| Doric + Digsite, 16,600 base (level 86) | 2,422 | 2,575 |

These count mining ticks only; travel to the mine is not included. Half of the total
is spent above level 90 (1,923 of 4,316 ticks on the demo), where every ore succeeds,
so the band that decides the skill is fully measured.

Seen against nickquarry (the demo's Mining #1, section 4a): 6,015 ticks for the whole
account, against about 4,030 + 30 + travel for this route.

## 3. Quest xp

| Quest | Base Mining xp (read) | Source | Level after | Notes |
|---|---|---|---|---|
| Doric's Quest | 1,300 | `quest_doric.rs2:99` (`stat_advance(mining, 13000)`) | 49 (49 needs 1,214.7, 50 needs 1,304.8) | 1 quest point. Needs 6 clay, 4 copper ore, 2 iron ore (`quest_doric.rs2:70`), all tradeable. Doric stands at (2952,3451), north of Falador. No other requirement. |
| Plague City | 2,425 | `quest_elena.rs2:12` | 58 alone, 64 after Doric | On the route as a Regicide-chain prerequisite (cairn://p/rs/3), so its Mining xp is free for this skill. |
| Digsite | 15,300 (measured 382,500 game xp at the hand-in, rs/16) | `quest_itexam.rs2:41` | 85 alone, 86 after Doric | About 2,180 ticks of playtime on the stock client, 1,930 with the client fix, 1,790 with burst inputs; p90 about 2,600 (measured, `docs/speedrun/quests/digsite.md`, cairn://p/rs/16). Also gives 2,000 base Herblore, a helper-fed skill. Saves about 1,612 mining ticks after Doric (4,034 to 2,422), so it costs about 570 ticks net on median and about 1,000 at p90. |

Doric's dialogue is about 14 pages (start: greeting, two choices, five lines; hand-in:
five lines and the quest scroll; `quest_doric.rs2:34-101`). At the stock lite client's 2
ticks per page (measured by cairn://p/rs/21) that is about 30 ticks (inferred), against
the 282 ticks levels 1-49 cost by mining (inferred). Do it.

Ticks from level 1 and from each post-quest level are in the totals table above.

## 4. Mechanics

### The roll and the 3-tick cycle

- A rock click first runs `mining_firstswing`. If `%action_delay < map_clock` it sets
  `%action_delay = map_clock + mining_rate` and continues on later ticks; the roll happens
  on the tick where `%action_delay = map_clock` (`mining.rs2:76-86`, `118-124`). If the
  timer is already equal to `map_clock` on the first swing, it rolls at once (`mining.rs2:83-85`).
- Rune pickaxe `mining_rate` is 2 (`pickaxes.obj:198`): adamant 3, mithril 4, steel 5,
  iron 6, bronze 7. The checker accepts a pickaxe in the inventory, best tier first
  (`pickaxe_checker.rs2`); wielding is unnecessary.
- A click processed on tick c rolls on c+2, then the next click is processed on c+3 at the
  earliest, so the cycle is **3 ticks** with a rune pickaxe (measured,
  `mining-cycle.ts --mode predict`, 26 consecutive 3-tick gaps) and rate + 2 in general
  (measured: bronze 9 ticks, 30 ores).
- Iron is a "fast" rock: success adds the ore and xp and returns with no delay
  (`mining.rs2:181-214`). Copper, tin, coal, gold and the rest are "normal": success runs
  `p_delay(0)` first (`mining.rs2:157`), so the click on the next tick is rejected
  (`OpLocHandler.ts:14-17`) and the cycle is one tick longer (read, inferred).
- Success: `floor(lo*(99-L)/98) + floor(hi*(L-1)/98) + 1 > rand(256)` using the current,
  boostable level (`PlayerOps.ts:591-600`). Iron is 96/350 (`mine.dbrow:70`), so it is
  certain from level 63. Before the ore roll, 1 roll in 256 goes to the gem table instead
  and gives no xp (`mining.rs2:188-201`).

### Depletion and respawn: why 3 ticks per ore is out of reach

- Every successful iron roll changes the rock to an empty rock for
  `scale_by_playercount(20)` ticks (`mine.dbrow:72`, `mining.rs2:204-206`), which is
  `floor(20 x (4000 - min(players, 2000)) / 4000)` (`player_count.rs2`, `NumberOps.ts:124-127`):
  **19 ticks** for 1-200 players online, **13 ticks on the demo** with 1,262 online (read
  from the demo's front page, 2026-10-20).
- The lifecycle counts down in `processZones` from the tick of the roll (`Loc.ts:54-61`,
  `World.ts:1151-1176`), so a rock rolled on tick R is back at the end of R+D-1 and its next
  roll can be no earlier than R+D+2. Measured: one standing tile with 3 iron rocks (Al
  Kharid, 3295,3310) gives gaps 3, 3 then 16 at D=19 (`mining-cycle.ts`, 40 ores) and 3, 3
  then 10 at the demo's D=13 (30 ores, player count emulated). That is 22 and 16 ticks per 3
  ores: **4.77 and 6.56 base xp per tick**. That bot clicks a respawned rock once it sees
  it; clicking blind on the respawn tick would give D+2 = 21 and 15 ticks, so 5.0 and 7.0
  (inferred). Either way that is the ceiling for a bot that never moves.
- A sustained 3-tick cycle therefore needs (D+2)/3 rocks: 5 on the demo, 7 on a quiet
  server.

### Moving between rocks

- A loc op only fires on a tick in which the player took no step
  (`Player.ts:1326,1347`, `tryInteract(stepsTaken === 0)`), so walking to a rock delays its
  first swing to the tick after arrival. With run, one tick covers two tiles. Run energy is
  free on the demo: `NODE_INFINITE_RUN` defaults to true (`Environment.ts:47`) and `fly.toml`
  does not override it (read).
- **Timer starter.** On the tick after a roll, click any live rock beside you: its first
  swing sets the roll for two ticks later without mining it. Next tick, walk up to two tiles
  to another rock's side and click it; its first swing on the following tick finds
  `%action_delay = map_clock` and rolls at once. The starter rock is not consumed. Measured
  working: 20-24 trick transitions per 60-ore run, every one on its predicted tick.
- The bot should choose its standing tile itself: walk to the planner's tile, then click the
  rock on arrival. The first swing lands on the same tick a walk-into-the-rock would, and it
  keeps the stay and starter options the planner relies on. Letting the client route to
  the nearest tile beside each rock measured 4.33-4.45 ticks per ore on the same cluster,
  against 3.61-3.84 with chosen tiles.

### Rock rotation (measured)

`mining-rotation-plan.ts` beam-searches every iron cluster with these rules (124 iron rocks
in the maps, read from `server/content/maps`). The best open-world results:

| Cluster (rocks) | Where | Planner ticks/ore, D=19 / D=13 | Measured |
|---|---|---|---|
| South of Ardougne zoo, 2602-2605,3233-3237 (6) | members, no requirement | 3.81 / 3.57 | **3.84 at D=19, 3.61 at D=13** (60 ores each) |
| North of East Ardougne, 2710-2715,3328-3332 (6) | members | 3.81 / 3.74 | 4.02-4.12 at D=19 with client-chosen tiles (60 and 45 ores) |
| Wilderness, 3099-3101,3765-3768 (8, 13 within 8 tiles) | about level 31 Wilderness | 3.96 / 3.39 | attempt did not finish (section 6) |
| NE of Rellekka, 2722-2728,3688-3696 (9) | Fremennik province | 4.00 / 4.00 | not run |
| Al Kharid, best tile 3295,3310 (3 on one tile) | free | 6.06 (whole cluster) | 7.33 / 5.33 stationary (above) |

Steps for the recommended cluster (stand>rock, one period; start on the first stand):

- Demo (D=13), 5 rocks, 18 ticks: `2604,3235>2605,3235 2602,3235>2602,3236 2603,3234>2602,3234
  2603,3233>2602,3233 2605,3234>2605,3233`
- Quiet server (D=19), 6 rocks, 23 ticks: `2602,3235>2602,3234 2603,3236>2602,3236
  2605,3236>2605,3237 2606,3235>2605,3235 2605,3234>2605,3233 2603,3233>2602,3233`

Run with `bun docs/speedrun/scripts/mining-rotation.ts <bot> --respawn 13 --start 2604,3235
--steps '...'` (quote each step).

### What the bot sees, and when

The lite client publishes state when PLAYER_INFO arrives, and the server writes that
before the same tick's zone, inventory and stat updates (`World.ts:1299-1309`). So xp and
depletion from tick R appear in the state for R+1. A bot that waits to see the xp
before clicking loses a tick per ore: measured 4-tick cycle reacting, 3 predicting
(`mining-cycle.ts --mode react|predict`). The executor never waits: at level 63+ every roll
is certain, so it sends each click on the predicted tick. Switching rocks on a roll tick
costs nothing even when the roll fails, because the new rock's first swing schedules the
same next roll. This is the general issue cairn://p/rs/22.

## 4a. The nickquarry mystery

**Answer: there is no faster method; the brief's premise was inverted.** nickquarry reached
99 at playtime tick 6,015, which is 1.7 times *slower* than the 3,500-tick model, not half
of it. The model itself was too optimistic because it ignored depletion. Their number fits
Doric's Quest followed by iron at 7.36 base xp per tick, which falls between the stationary
3-rock rate (6.56 on the demo) and the best measured rotation (9.69).

Hypotheses, in the order checked:

1. **Their profile (read).** Total level 126 = Mining 99 + 17 skills at 1 + Hitpoints 10:
   nothing else was trained. Quest points: 1, stamped at tick 764 (exact counts from the
   pages' hover titles). The only 1-point quest with Mining xp is Doric's (1,300 base), and
   a single quest point rules out Digsite. From 1,300 to 39,938 base in
   6,015 - 764 = 5,251 ticks is **7.36 base xp per tick** (inferred).
   The Time column is `levelPlaytime`, the account's `playtime` stamped on the tick the
   level was reached (`Player.ts:1904-1905`, written by `LoginServer.ts:162-181`,
   rendered as ticks x `NODE_TICKRATE` by `hiscores.ts:59-69`). `playtime` counts every tick
   logged in (`World.ts:692`) and the demo ticks at 300 ms (`fly.toml:26`, and 6,015 ticks =
   30m 04s on the page checks out). So 6,015 is the moment of the 99, not a snapshot that
   could predate it. The next three ranks (8,374, 9,362 and 9,850 ticks) are slower still.
2. **A better rock (read).** Granite and sandstone have no `mine.dbrow` rows (the name's
   quarry does not exist in this content). At 99 with a rune pickaxe, every other rock is
   worse than iron. Coal (50 base, 39% success, 100-tick base respawn), gold (65, 30%,
   200), mithril (80, 20%, 400), adamantite (95, 10%, 800), runite (125, 7%, 2,400) and gem
   rocks (65, 28%, 200) all yield under iron's rate per rock and need far more rocks.
   Essence is 5 base per roll. Limestone (26.5 base, 100%, 3 stages per rock) is a
   "normal" rock, so 4 ticks per ore at best: 6.6 per tick (inferred).
3. **A faster cycle (read and measured).** Nothing rolls more often than every 3 ticks: the
   only writers that set `%action_delay` to `map_clock` or `map_clock + 1` are the bullroarer
   (it refuses unless the timer is 8+ ticks stale, `bullroarer.rs2:2-8`) and queued
   smelting/pottery steps. The real lever is the opposite one, keeping the 3-tick cycle
   while moving, which the timer starter does (section 4). The sibling tick-manipulation
   issue's knife-on-logs writer (`cut_logs.rs2:83-85`, cairn://p/rs/9) would make every
   move a starter. The planner puts that at 3.31 ticks per ore (10.59 base xp per tick) on
   the Rellekka cluster at D=19 and 3.48 on the zoo cluster (inferred, untested, blocked by
   the client hang in cairn://p/rs/1).
4. **Server differences (read).** The demo reports revision 289 (`/api/version`), the same
   engine as this fork. The SDK's tracked `collision-data.json` is the demo's own export
   (`sdk/fetch-collision-data.ts`), and rotations planned on it ran tick-exact in this
   fork's lab. xp rate 25 (`fly.toml:27`). The one
   real difference is load: 1,262 players online make respawn 13 ticks instead of 19.
   That is worth 6% on the best rotation (3.84 -> 3.61) and 38% for a stationary bot
   (4.77 -> 6.56).

What nickquarry probably did (inferred): Doric's Quest at the start (764 ticks of
playtime, including walking to Doric and the hiscore stamp), then iron on a small
cluster or a simple rotation without chosen tiles or starters, on a busy server.

## 5. Alternatives considered

| Method | Rate at 99 | Verdict |
|---|---|---|
| One tile beside 3 iron rocks (Al Kharid 3295,3310) | 6.56 base/tick demo, 4.77 quiet (measured) | Loses about 1,800 ticks to the rotation on the demo. Only sensible if the bot cannot schedule clicks. |
| Rotation with the client choosing tiles | 7.87-8.71 base/tick (measured) | Loses about 9-18%; walk to chosen tiles instead. |
| Wilderness 8-rock core | planner 10.33 at D=13 | 7% above the zoo cluster on paper, but hostile NPCs and players; the live attempt stalled. |
| Knife-on-logs starter on every move | planner 10.06-10.59 | Up to about 9% faster; depends on cairn://p/rs/9 and cairn://p/rs/1. |
| Coal, gold, mithril, adamantite, runite, gem rocks, essence, limestone | all below 7 (inferred) | Section 4a. |
| Skip Doric's Quest | +282 ticks of mining | Lose. |

## 6. Gotchas

- **Dropping ore.** Every inventory op calls `clearPendingAction()` when no main modal is
  open (`OpHeldHandler.ts:54-56`), which clears the mining interaction but not
  `%action_delay`. A drop on its own in the middle of a cycle cancels the pending roll
  (measured, `mining-cycle.ts --drop mid`, 2 of 2). Send drops in the same tick as, and
  before, a rock click: the click restores the interaction with its timer intact, so the
  roll lands on schedule. Measured: every ore dropped with the next click across the 60-ore
  runs, all 60 rolls on time; a mid-cycle drop plus re-click lost nothing (`--drop midclick`).
  **Cost per inventory: 0 ticks.** The server takes 5 user events per tick
  (`ClientGameProtCategory.ts:6`); the scripts send one click plus up to 3 drops.
- **Level-ups.** `stat_advance` queues `[advancestat,mining]` in the ENGINE queue
  (`Player.ts:1944-1946`), which runs at the start of the next tick, before interactions
  (`World.ts:785-801`). It opens a chat box and suspends (`levelup.rs2:54-55`), and while a
  modal is open no op fires (`Player.ts:878-888`). Any rock click closes it
  (`OpLocHandler.ts:53`, `clearPendingAction`). If the next transition is a stay, re-click
  the rock on the tick you see the level: the cost is 1 tick (measured). If it is a walk,
  re-send the click before arrival and nothing is lost (measured). There are 50 level-ups
  from 49 to 99; the model charges 0.5 ticks each. Never leave the box open: the planned
  clicks behind it cancel each other.
- **Failures below 63.** A failed roll leaves the rock live; the next roll can be on it or on
  any other rock at no cost. My executor's predictions are exact at 63+ but drifted below 63
  (an unexplained one-tick-late walk after some failures), so the sub-63 bands are
  modelled, not measured.
- **Gems.** 1 roll in 256 gives an uncut gem (or nothing) and no xp. Drop gems like ore.
- **Wilderness.** The 8-rock core is in about level 31 Wilderness; the lab run there did
  not complete, most likely because aggressive monsters pulled the bot into combat (not
  diagnosed).
- **Respawn varies with load.** D is 19 at 1-200 players online, 18 at 201-400, 15 at
  801-1,000, 14 at 1,001-1,200 and 13 at 1,201-1,400 (inferred from the formula). Pick the step list for the current count (re-run the
  planner with `--respawn D`). Woodcutting and Thieving use the same scaling
  (`woodcut.rs2`, `thieving.rs2`).
- **Other players** on the same rocks break the schedule; the zoo cluster is a quiet spot,
  but check before starting.

## 7. Helper supply list

| Item | Count | Why |
|---|---|---|
| Clay | 6 | Doric's Quest |
| Copper ore | 4 | Doric's Quest |
| Iron ore | 2 | Doric's Quest |
| Rune pickaxe | 1 | Usable from Mining 41, so straight after Doric's Quest |
| Iron, steel, mithril, adamant pickaxes | 1 each | Only if skipping Doric's Quest |

No food expected: the Ardougne-north runs ended at full HP with bears nearby. The zoo
cluster was not checked for aggressive NPCs.

## 8. Open questions

- **The sub-63 bands are modelled.** A clean measurement needs the executor's late-walk
  drift after failed rolls diagnosed. It is worth about 300 ticks of route, so the
  uncertainty is perhaps +/- 30 ticks.
- **Live demo check.** The respawn-13 numbers come from the lab with the player count
  emulated (an uncommitted one-line edit to `player_count.rs2`). One run on the demo would
  confirm D and the rate; the planner and executor take `--respawn`.
- **Starter writers.** If cairn://p/rs/9 lands a menu-free `%action_delay = map_clock + 2`
  writer, re-plan with `--free-starter`: up to about 9% faster.
- **Travel and Doric's Quest** are not measured: walking to Doric and on to Ardougne
  belongs to the quest-route plans; the dialogue estimate uses rs/21's 2 ticks per page.
- **The patched lite client** (cairn://p/rs/22) would not change this route: the
  executor never reacts to observed state.
