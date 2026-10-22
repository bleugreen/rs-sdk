# Druidic Ritual

**On the route as the second quest of step S24** (`speedrun/quests/druidic-ritual.ts`,
STEP-MANIFEST.md entry 22): **208 ticks fixed, 193.3 with dialogue bursts**, from Kaqemeex back to
Kaqemeex (measured, below). It is mandatory: without it Herblore never leaves level 1.

## Reward

- **250 base Herblore** (read, `stat_advance(herblore, 2500)`, `quest_druid.rs2:3`; measured 6,250
  game xp: Herblore 1 to 28).
- **4 quest points.**

## Requirements (as this server enforces them)

None. The cauldron enchants a raw meat only at stage 2 (`quest_druid.rs2:16`).

## Helper-supplied items

SUPPLIES.md hand-off H20: raw rat meat, raw bear meat, raw beef, raw chicken, 1 each. The
enchanted meats are `tradeable=no` (`quest_druid.obj`), so SCORED dips them itself.

## Step list

Quest varp `%druidquest` (perm): 0-4 (`quest_druid.constant`; complete 4). The quest tab shows
started and complete; stages 2 and 3 come from the journal or from the meats held (raw, then
enchanted, then none). L24a lands beside Kaqemeex (2924,3486); L24b starts there.

| # | Where | Action | Varp | Raw counts | Fixed | Burst | Label |
|---|---|---|---|---|---|---|---|
| D1 | Kaqemeex | hello, his question, "I'm in search of a quest.", two pages on the circle, "Ok, I will try and help." (`kaqemeex.rs2`) | 0 → 1 | `2c, opt, 4c, opt, 3c` | 12 | 6 | m |
| D2 | to Sanfew | run down Taverley's west side (the SDK route swings east round the circle: 55 m against 41), his spiral stairs up (2898,3428) | | ~70 tiles, 1 climb | 41 | 41.3 | m |
| D3 | Sanfew (2897,3426, level 1) | his question, "I've been sent to help purify...", his two pages, "Ok, I'll do that then." (`sanfew.rs2:24-51`) | 1 → 2 | `1c, opt, 3c, opt, 2c` | 9 | 6 | m |
| D4 | to the dungeon | his stairs down, the run to Taverley Dungeon's ladder (2884,3397), down | | ~35 tiles, 2 climbs | 23 | 23 | m |
| D5 | the cauldron (2893,9831) | the run to the prison door (2889,9831), three opens from the west (the first two each wake a suit of armour, `prison_doors.rs2`; the third lets the player through), the four meats used on the cauldron (one a tick) | | ~33 tiles, 3 opens, 4 uses | 26 (27, 24, 27) | 25 (24, 27, 24) | m |
| D6 | back to Sanfew | the door from inside (one open), the run to the ladder, up, the run and his stairs up | | ~70 tiles, 1 open, 2 climbs | 43 | 43 | m |
| D7 | Sanfew | the meats handed over (`sanfew.rs2:53-66`) | 2 → 3 | `5c` | 6 | 2 | m |
| D8 | to Kaqemeex | his stairs down, the run north | | ~70 tiles, 1 climb | 41 | 41 | m |
| D9 | Kaqemeex | hello and his one page; the completion queued (`kaqemeex.rs2:94`), the Herblore level-up page; **his queued 15-page tutorial closed** (`quest_druid.rs2:8-12`) | 3 → 4 | `2c` + level-up + close | 7 | 6 | m |
| | | **Total from Kaqemeex** | | | **208** | **193.3** | m |

Measured with `speedrun/lab/quests/druidic-ritual.ts` on bgsrv-mac, lab at 300 ms, SCORED's
post-Monkey-Madness levels (Attack 99, Defence 89, Hitpoints 97) and the ledger's pack after H20:
lite client 3 of 3 in each mode (fixed 209, 206, 209; burst 192, 195, 193); browser client (bundle
md5 64caf234) burst 196. The manifest's 239 fixed / 220 burst were inferred.

D5's spread is the door, not the dialogue. The suits turn back into locs 500 ticks after they wake
(`prison_doors.rs2`), so back-to-back lab runs alternate: three of the six runs opened it three
times and woke both suits, and three met it open to one click (the module's note row). The 27s
line up with the three-open runs, so **27 is the route's D5** (a fresh door), and the route's
Druidic Ritual is 209 fixed / 195.3 burst.

## Tick total

| Part | Fixed | Burst | Label |
|---|---|---|---|
| Travel inside the quest (D2, D4, D6, D8, and D5's run to the door) | ~165 | ~165 | m |
| Dialogue (5 talks, 24 pages, 4 options, the level-up page) | ~37 | ~22 | m |
| Loc ops (6 climbs, 4 door opens, 4 cauldron uses) | in the travel rows | the same | m |
| Fights | 0 (the suits fight back; HP lost 0-1 at S24's levels) | 0 | m |
| **Total (the step's share)** | **208** | **193.3** | m |

## Risks and gotchas

- **The suits come back** as locs 500 ticks after they wake (`.loc_del(500)`): a second player (or
  a lab rerun) within that finds the door open to one click.
- The suits' wake message is stamped on the click's own tick on the browser client and on the next
  on lite; the door loop reads it by the message cursor taken before each open (m: a tick offset
  missed it on the browser).
- The dungeon at S05's Defence 1 and 10 HP would be lethal; at S24's levels it is not (RUN-ORDER
  RT§7 keeps the quest here).
- The tutorial's pages are closed, not read: nothing on the route needs them, and reading them
  costs 15 ticks fixed.

## Open questions

None.
