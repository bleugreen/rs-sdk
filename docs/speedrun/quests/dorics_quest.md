# Doric's Quest

**Verdict: do it.** It costs **90 ticks on the stock client, 65 on the fixed client and
about 60 with dialogue bursts** (measured end to end at `NODE_TICKRATE=300`, trade
included), and its 1,300 base Mining replaces **139 ticks** of mining given Plague City,
the other on-route Mining quest (rs/2 `docs/speedrun/skills/mining.md` section 2: 3,904
ticks to 99 after Plague City alone, 3,765 after both, demo server). Net about +50 / +75 / +80
ticks. Done before Plague City it shows a larger saving (282), but the pair's total is the
same either way, so 139 is the honest marginal figure.

Measured with `docs/speedrun/scripts/quest-smallskill-doric.ts` through
`quest-smallskill-lab.sh` (headless lite client, 300 ms ticks): once on the stock client
(before the cairn://p/rs/22 fix merged) and once on the fixed client.

## Reward

- **1,300 base Mining** (read, `stat_advance(mining, 13000)`, `quest_doric.rs2:99`;
  measured 32,500 game xp). From level 1 this is level 49 and one level-up page.
- **1 quest point** (read, `general/configs/quest.constant:85`), 180 coins
  (`quest_doric.rs2:83`).

## Requirements (as this server enforces them)

None. `quest_doric.rs2` has no `stat()`, `stat_base()` or quest check (read). The items are
checked at the hand-in: 6 clay, 4 copper ore and 2 iron ore (`quest_doric.rs2:70`).

## Helper-supplied items

One trade: 6 clay, 4 copper ore, 2 iron ore (all tradeable), and Falador teleport runes
(1 law, 3 air, 1 water; Magic 37, `magic_spells.dbrow:80-85`). The quest needs only one
trade, and it can ride on any other trade the plan already makes, in which case its
trade cost is zero.

## Step list

Quest varp `%doricquest` (perm): 0, 10, 100 (`quest.constant:17`). Ticks run from the
click to the effect.

| # | Where | Action | Varp | Raw counts | Stock | Fixed | Label |
|---|---|---|---|---|---|---|---|
| 0 | anywhere | helper trade | | 1 trade | 9 | 5 | measured, `primitives.md` section 6 |
| 1 | → Falador | Falador teleport | | 1 cast | 4 | 4 | measured (both runs) |
| 2 | (2964,3379) → Doric (2952,3451) | run north out of Falador | | 73-74 route tiles | 43 | 39 | measured with `bot.walkTo` (0.57/tile); chained clicks would be about 38 |
| 3 | Doric | "I wanted to use your anvils.", "Yes, I will get you materials." | 0 → 10 | 6 pages + 2 options; runs `1c, opt, 2c, opt, 3c` | 18 | 9 | measured |
| 4 | Doric | hand-in: the ores go, the quest completes (queued, `quest_doric.rs2:80`) | 10 → 100 | 5 pages + quest scroll + level-up page; runs `5c` | 16 | 8 | measured |
| | | **Total** | | | **90** | **65** | measured |

Burst column (inferred from the runs with the CONVENTIONS.md rule): step 3 is
1 (approach) + 1 + 1 + 2 + 1 + 2 = 8, step 4 is 1 + 1 + 2 (scroll and level-up page) = 4,
so the total is 5 + 4 + 39 + 8 + 4 = **60**.

## Tick total

| Part | Stock | Fixed | Burst | Label |
|---|---|---|---|---|
| Travel (teleport and run) | 47 | 43 | 43 | measured |
| Dialogue (2 talks, 11 pages, 2 options, scroll, level-up) | 34 | 17 | 12 | measured (burst inferred) |
| Trade | 9 | 5 | 5 | measured, `primitives.md` |
| Fights, waits | 0 | 0 | 0 | read |
| **Total** | **90** | **65** | **60** | |

The inferred figure in `quest_points.md` (75 / 60 / 51) was close; the walk is about
6 ticks longer than its estimate.

## Marginal value

| Basis | Ticks saved | Source |
|---|---|---|
| Given Plague City (2,425 base), the on-route case | **139** | rs/2 `mining.md` section 2 totals table (3,904 → 3,765), demo server, rs/2 branch at 0e184ef2 |
| Done first, from level 1 | 282 | same table (4,316 → 4,034) |
| Quiet server | 147 | same table, second column |

## The step module (S05, `speedrun/quests/dorics-quest.ts`)

The run does Doric's Quest as step S05, from Doric's tile (2952,3451; T04-05's landing, so
the teleport and the walk above are the leg's, not the step's), in three segments:

| Segment | What | Fixed (m) | Burst (m) |
|---|---|---|---|
| A `h4-swap` | SUPPLIES.md hand-off H4 as one `swap()`: the ores, the air talisman and the T05-06 / T06-07 runes in; S04's last 20 enchanted rings out | 0 (landed in the fixture); 6 m (rs/285) | 0; 6 m |
| B `doric-start` | `1c, opt, 2c, opt, 3c` | 9, 9, 9 | 6, 6, 6 |
| C `doric-hand-in` | `5c`, the Mining level-up page answered, the 180 coins dropped | 9, 9, 9 | 5, 5, 5 |
| | **From Doric's tile, trade landed** | **18** | **11** |

Measured on bgsrv-mac, lab at 300 ms, `speedrun/lab/quests/dorics-quest.ts`: lite client 3 of
3 in each mode; browser client (bundle md5 64caf234) burst 11. With the trade, 24 fixed and 17
burst against the manifest's 22 and 17.

Where the module differs from the step list above:

- **H4 is the step's own trade.** Its items and its free-slot need are read from STEP-MANIFEST.md's
  inventory ledger (row H4, through `runner/handoff.ts`), and the rings, the row's `<enchanted
  ring>` placeholder, are what `skills/magic.ts` `enchantedRingSpecs` names. The server counts
  offered items as freed, so the free-slot check credits the rings' slots, and segment A refuses
  before the trade, naming the shortfall, when the pack cannot take H4 (main's ruling, 2026-10-21
  23:31 PDT). On the route the ledger reads 14 needed (13 unstackables and a new law stack) with
  27 free after the rings go.
- **The coins are dropped inside the step,** the tick they land: the completion is already queued
  two pages before (`quest_doric.rs2:80`), so the drop closes Doric's last page and loses nothing.
  The ledger's T05-06 drop moves into S05.
- **The Mining level-up page is answered.** It opens 1-2 ticks after the completion (m), and the
  next leg's teleport would not close it. The shared `small-quest.ts` completion helper first
  requires the completed quest tab, then uses `converse` with `expect: 'interrupt'` and a
  fresh level-up interrupt recogniser. A quest scroll is closed without treating it as the
  queued reward page. When the preceding talk already answered the reward, or no level-up
  is expected, there is no extra reward-opening window. The helper confirms scroll closure
  before returning; the Doric lab checks that neither chat nor modal remains open.

## Risks and gotchas

- None found. No fight, no random step, no forced wait. Doric's house door is open.
- Logout-safe: `%doricquest` is `scope=perm` (`quest_doric.varp`), and the quest tab shows every
  stage, so a resume needs no journal read.
- The quest-complete scroll needs no dismissing on this client (none was seen in the lab runs);
  the Mining level-up page does (above).

## Open questions

None.
