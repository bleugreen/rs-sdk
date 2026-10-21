# Fletching: fastest route to 99

Scripts: [`delayfree-cycle.ts`](../scripts/delayfree-cycle.ts) (actions per tick, end to end),
[`delayfree-model.ts`](../scripts/delayfree-model.ts) (`routes`, band arithmetic). Lab:
[`delayfree-lab.sh`](../scripts/delayfree-lab.sh), delayfree port block (WEB 9270, management
9271, hiscores 9272, node 43970, agent 8170). Labels follow
[README.md](README.md#labels) on rs/2's branch.

**Host and rate.** Every measured figure here was taken on **bbs** (Linux, 32 cores, a
shared host also running helper labs) at **`NODE_TICKRATE=300`** with the headless lite
client. No figure here comes from the Mac executor.

## 1. Recommendation

Attach arrowheads to headless arrows, 15 arrows per action, 5 actions in every server tick,
and never bank: arrows, arrowheads and headless arrows all stack. Use the best arrowhead the
level allows (bronze 1, iron 15, steel 30, mithril 45, adamant 60, rune 75). **1 -> 99 took 50
ticks** (measured, one run, 49 of 49 xp ticks landed exactly 5 actions). **75 -> 99 is 35
ticks** (inferred: 173 actions at the measured 5 per tick). The scored account can take the
supplies in one trade anywhere and needs no bank. With the stock SDK (one awaited action per
observed tick) the same work is 1 action per tick: **75 -> 99 took 173 ticks** (measured), and 1
-> 99 would be about 240 (inferred).

Supply is the real constraint, not playtime: a 1 -> 99 run eats about 2,600 rune arrowheads,
and shops hold 250. **Adamant arrowheads from 60 cost only about 9 extra ticks** (283 actions
instead of 240, inferred), so they are the practical default unless rune arrowheads are cheap.

## 2. Route by level band

Base xp per action is 15 x the per-arrow xp in `arrows.dbrow:1-47` (read). Ticks per action
0.2 (5 per tick) is measured for every band in the 1 -> 99 run. Success is 100% (no roll in
`make_arrows`, `arrows.rs2:50-86`).

| Band | Method | Location | Unlock | Base xp / action | Ticks / action | Base xp / tick | Actions | Ticks for band |
|---|---|---|---|---|---|---|---|---|
| 1-15 | Bronze arrowheads on headless arrows | anywhere | Fletching 1, members | 19.5 | 0.2 | 97.5 | 4 | 1 |
| 15-30 | Iron arrowheads | anywhere | Fletching 15 | 37.5 | 0.2 | 187.5 | 6 | 2 |
| 30-45 | Steel arrowheads | anywhere | Fletching 30 | 75 | 0.2 | 375 | 9 | 2 |
| 45-60 | Mithril arrowheads | anywhere | Fletching 45 | 112.5 | 0.2 | 562.5 | 15 | 3 |
| 60-75 | Adamant arrowheads | anywhere | Fletching 60 | 150 | 0.2 | 750 | 33 | 7 |
| 75-99 | Rune arrowheads | anywhere | Fletching 75 | 187.5 | 0.2 | 937.5 | 173 | 35 |
| **1-99** | | | | | | **800.7 average** | **240** | **50 measured** (48 inferred) |

Measured, `delayfree-cycle.ts --skill=fletching --level=1 --route=bronzearrow,...,runearrow`:
1 -> 99 in 50 ticks, 40,035 base xp, 245 packets, 5 actions landed on each of the 49 ticks with
xp. The two ticks above the 48-tick packet floor are the first and last ticks of the run.

| Start | Ticks to 99, fast script | Ticks to 99, stock SDK | Basis |
|---|---|---|---|
| Level 1 | **50** | about 240 | fast measured; stock inferred from the measured 1 action per tick |
| Level 75 | 35 | **173** | fast inferred; stock measured (172 ticks with 1 action each) |
| Level 75 after Temple of Ikov (8,000 base) | 35 | 173 | inferred |
| Level 1, adamant arrowheads as the top tier | about 57 | about 283 | inferred |
| Level 1, mithril arrowheads as the top tier | about 74 | about 366 | inferred |

## 3. Quest xp

| Quest | Fletching reward (base, read) | Start level | On route? |
|---|---|---|---|
| Temple of Ikov | 8,000 (`temple_of_ikov.md` on rs/3's branch, `stat_advance(fletching, 80000)`) | 75 | listed among the 49 planned quest points in `quest_points.md`, but `temple_of_ikov.md` recommends skipping it |
| Tourist Trap | 4,650 per pick, 2 picks (`irena.rs2:77-91`) | 68 per pick | picks are better spent on Agility or Thieving (inferred) |
| The Fremennik Trials | 2,812.4 | 60 | off route |

Quest xp is nearly worthless here. Ikov's 8,000 base saves 13 ticks with the fast script (48
-> 35, inferred) and about 67 with the stock SDK. A Tourist Trap pick saves about 8 ticks. No
Fletching quest reward should be chosen for its Fletching xp. **On-route start: level 1**
(no planned quest gives Fletching), so the headline is 1 -> 99 in about 50 ticks.

## 4. Mechanics

- **The action.** OPHELDU of arrowheads on headless arrows runs `[opheldu,headless_arrow]` or
  `[opheldu,_category_968]` -> `@make_arrows` (`arrows.rs2:9-23`). It deletes and adds
  `min(heads, headless, 15)` and awards 15 x the row's xp at once (`arrows.rs2:70-86`). There is
  no `p_delay`, no queue and no `%action_delay`, so the whole action completes inside the
  packet handler.
- **5 per tick.** OPHELDU is a USER_EVENT, and the engine decodes at most 5 per player per
  tick (`ClientGameProtCategory.ts:6`). The surplus waits for the next tick, it is not
  dropped (`NetworkPlayer.ts`).
- **Same slots every time.** Both inputs are stackable, so the packet's slots never change:
  the script sends `use heads@slot -> headless@slot` five times per observed tick without
  waiting for state. The lite runner writes one queued action every 20 ms
  (`server/webclient/src/lite/runner.ts`, `TICK_MS`), so a burst of 5 lands inside one 300 ms
  tick. At `NODE_TICKRATE=100` a 5-burst takes 100 ms and can straddle ticks; quote only the
  300 ms figures.
- **Level-up boxes cost nothing here.** Each OPHELDU calls `clearPendingAction`, which closes
  the chat modal (`OpHeldUHandler.ts`). The run had a dialog open on 49 ticks and still landed
  5 actions on every one.
- **Stock SDK** (`sdk.sendUseItemOnItem` awaited, then waiting for the inventory to change):
  exactly 1 action per tick (measured, 172 ticks of 1 action). That is the SDK's read-then-act
  contract, not a server limit.
- **Darts** (`darts.rs2:20-62`, `darts.dbrow`) are the same shape with 10 per action. Rune
  darts (81) give 188 per action against rune arrows' 187.5: a 1-action difference over the
  whole route (239 vs 240 actions, inferred). Dart tips need the smithing helper to have done
  Tourist Trap (`smithing.rs2:224-229`, `%desertrescue`). Not worth it.
- **Headless arrows** (feather on arrow shaft, 15 per action, 1 base each,
  `arrows.rs2:25-47`) are best made by helpers: on the scored account they are 15 base per
  action, far below any arrowhead tier.

## 5. Alternatives considered

- **Adamant or mithril as the top tier**: +43 or +126 actions, about +9 or +25 ticks (inferred).
  Use them if rune arrowheads cost more helper time than 9 or 25 scored ticks are worth.
- **Stringing bows** is also delay-free: one bow per OPHELDU, no delay or queue
  (`bows.rs2:18-42`). But it is one bow per action, magic longbow 91.5 base at level 85
  (`bows.dbrow:78-83`), and unstrung bows and bow strings do not stack, so it runs 14 per
  inventory with a bank visit: about 91.5 x 14 / 5 ticks = 256 base per tick at the herblore
  cycle (inferred) against rune arrows' 937.5. Loses by a factor of about 3.6.
- **Cutting logs** (`cut_logs.rs2`) goes through a make-X menu and a queued action (read).
  Slower still.
- **Bolts** (`bolts.rs2:49-88`): tipping is delay-free and 10 per action, but the best row,
  barbed bolts at 51, is 95 base per action (`bolts.dbrow:38-43`), below mithril arrows'
  112.5 at 45. Loses to arrows at every level.
- **Ogre arrows** (`ogre_arrows.rs2`): need Big Chompy Bird Hunting, lower xp. Not considered.
- **Trading per inventory**: not needed; everything stacks.

## 6. Gotchas

- **Members only** (`arrows.rs2:51-53`). The demo is members (`fly.toml`, `NODE_MEMBERS`).
- **Uneven stacks.** `make_arrows` takes `min(heads, headless, 15)`. Hand over headless arrows
  and arrowheads in equal counts per tier, multiples of 15, or the last action of a tier gives
  partial xp.
- **Choose the arrowhead by level every tick.** The level check (`arrows.rs2:63-68`) uses
  `stat()`; a too-high tier opens a mesbox and wastes the action. The script re-picks the tier
  from the observed level each tick. The state lags one tick, so at a band edge one burst still
  uses the old tier (harmless).
- **Inventory space.** All inputs and products are stackable: 1 slot of headless arrows, 1 per
  arrowhead tier, 1 per arrow type. No banking at all.
- **Busy host.** The bbs host was loaded by other labs. The run still hit the 5-per-tick floor,
  so the measurement is not host-limited.

## 7. Helper supply list

Per 99 from level 1 (counts from the band table; 15 arrows per action, plus nothing spare
because the actions are exact):

| Item | Quantity | Where helpers get it | Scarcity |
|---|---|---|---|
| Headless arrow | 3,600 (240 actions x 15) | helpers attach feathers to arrow shafts (15 per action, no level) | easy: needs 3,600 shafts and 3,600 feathers |
| Arrow shaft (for the above) | 3,600 | Ranging Guild bow shop, 1,000 in stock (`ranging.inv:10`); or helper Fletching, 15 shafts per log (`cut_logs.rs2`) | easy |
| Feather (for the above) | 3,600 | Port Sarim fishing shop, 1,000 in stock, fast restock (`port_sarim.inv:93`); other fishing shops (`shantaypass`, `viking`, `shilo`, `fishing_guild`, `miscellania`) | easy |
| Bronze arrowheads | 60 | Ranging Guild (500), Catherby archery (1,000), combat camp, gnome shop | easy |
| Iron arrowheads | 90 | same shops | easy |
| Steel arrowheads | 135 | same shops | easy |
| Mithril arrowheads | 225 | same shops | easy |
| Adamant arrowheads | 495 | Ranging Guild 200 (`ranging.inv:15`), Catherby 200 (`catherby.inv:47`); or smithing helper (Smithing 75) | moderate |
| Rune arrowheads | 2,595 | Ranging Guild 150 (`ranging.inv:16`), Catherby 100 (`catherby.inv:48`), slow restock; otherwise smithing helper at Smithing 90 with rune bars, or the GE | **scarce**: shops cover about a tenth |

**Adamant-cap variant** (recommended unless rune arrowheads are cheap): bronze 60, iron 90,
steel 135, mithril 225, **adamant 3,735**, headless arrows 4,245 (283 actions). About 57 ticks
instead of 50.

**Hand-off.** One trade of 7-8 stacks anywhere (adjacent helper: 9 ticks stock, 5 with the
rs/22 client fix, `primitives.md` section 6 on rs/3's branch). No bank visit, so the scored
account can fletch wherever it stands, for example while waiting at a quest location.

## 8. Open questions

- **Interleaving.** Fletching has no cycle of its own, so its 240 actions could ride in spare
  packet slots of other skills' ticks (rs/38 measured 3.8-3.9 helper arrows per tick inside
  gathering loops). If that holds on production, Fletching costs close to zero dedicated ticks.
- **Production latency.** A burst of 5 must reach the server inside one 300 ms tick. On the
  demo server a late packet only spills into the next tick (it is queued, not dropped), so the
  worst case is a few extra ticks. Not measured on production.
- **Rune arrowhead supply.** Whether helpers can get about 2,600 rune arrowheads (smithing
  helpers at 90 with about 175-260 rune bars, or the GE) decides between the rune and adamant
  routes (+9 ticks). Belongs to the helper-supply issues under rs/41.
