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

## Risks and gotchas

- None found. No fight, no random step, no forced wait. Doric's house door is open.
- Logout-safe: `%doricquest` is `scope=perm` (`quest_doric.varp`).
- The quest-complete scroll and the Mining level-up page need not be dismissed; the
  next click closes them.

## Open questions

None.
