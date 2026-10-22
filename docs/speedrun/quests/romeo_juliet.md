# Romeo & Juliet

**On the route as the last quest of step S24** (`speedrun/quests/romeo-juliet.ts`, STEP-MANIFEST.md
entry 21): **300 ticks fixed, 265.3 with dialogue bursts**, from Romeo back to Romeo (measured,
below). It is filler for the Champions' Guild door (5 quest points); it gives no xp.

## Reward

- **5 quest points** (read, `quest_romeojuliet.rs2`); no xp.

## Requirements (as this server enforces them)

None. The Apothecary checks the cadava berries at stage 50 (`apothecary.rs2:61-82`).

## Helper-supplied items

SUPPLIES.md hand-off H20: **cadava berries 1** (tradeable). Juliet's message and the cadava potion
are `tradeable=no` and come from the NPCs (`quest_romeojuliet.obj`).

## Step list

Quest varp `%rjquest` (perm): 0, 10, 20, 30, 40, 50, 60, 100 (`quest_romeojuliet.constant`). The
quest tab shows started and complete; the stages between come from the journal (no marker on 50)
and from the message, the berries and the potion held. L24c lands beside Romeo (3211,3425); T24-25
starts there.

**Juliet first**, though the leg lands beside Romeo: at stage 0 her "I guess I could find him." gives
the message at once (`juliet.rs2:4`, `:49-64`, 0 → 20), which skips Romeo's opening talk; the walk
is the same either way.

| # | Where | Action | Varp | Raw counts | Fixed | Burst | Label |
|---|---|---|---|---|---|---|---|
| R1 | Juliet (3158,3425, level 1) | the run in through her house's **north door** (3160,3440; the garden side reaches only the kitchen), her stairs (3156,3435), **two doors upstairs** (3156,3431 and 3159,3427), her three pages, "I guess I could find him.", six pages | 0 → 20 | ~53 tiles, 3 doors, 1 climb; `3c, opt, 6c` | 58.7 | 52 | m |
| R2 | Romeo (Varrock Square; he wanders) | out the same way, the run to the square; the message (`romeo.rs2:45-55`) | 20 → 30 | ~53 tiles, 1 climb; `7c` | 45.3 | 38 | m |
| R3 | Father Lawrence (the church, 3254,3475) | the run; his pages (`father_lawrence.rs2:54-63`) | 30 → 40 | ~55 tiles; `7c` | 40.3 | 34.7 | m |
| R4 | the Apothecary (3195,3404) | the run; at 40 he asks for the berries (`7c`, 40 → 50), at 50 a second talk brews the potion (`4c`) | 40 → 50 | ~75 tiles; `7c` + `4c` | 63.3 | 56.3 | m |
| R5 | Juliet | the run in and up; the potion handed over (`juliet.rs2:87-101`) | 50 → 60 | ~45 tiles, 1 climb; `7c` | 47.3 | 43.3 | m |
| R6 | Romeo | out, the run to the square; the completion queued (`romeo.rs2:94-104`) | 60 → 100 | ~53 tiles, 1 climb; `7c` | 45 | 41 | m |
| | | **Total from Romeo** | | | **300** | **265.3** | m |

Measured with `speedrun/lab/quests/romeo-juliet.ts` on bgsrv-mac, lab at 300 ms, SCORED's levels
and the ledger's pack at S24's end plus H20's berries: lite client 3 of 3 in each mode (fixed 298,
308, 294; burst 267, 260, 269); browser client (bundle md5 64caf234) burst 274. **The manifest's 241
fixed / 211 burst were inferred from page counts** (quests/README.md section 3) and are replaced by
these: the walking is longer than the estimate, chiefly Juliet's doors.

## Tick total

| Part | Fixed | Burst | Label |
|---|---|---|---|
| Travel inside the quest (6 runs, 4 climbs, Juliet's doors) | ~235 | ~235 | m |
| Dialogue (7 talks, 49 pages, 1 option) | ~65 | ~30 | m |
| **Total (the step's share)** | **300** | **265.3** | m |

## Risks and gotchas

- **Juliet's house:** the SDK pathfinder finds no way into her stairs room from the street (its
  door mask), and the run's stall rule opens the nearest door, which upstairs is not always the one
  in the way. The module names each door by tile (`openDoor`, nothing if already open).
- **Romeo wanders** round the square: the talk is aimed at the nearest Romeo, and the approach
  varies by a few ticks.
- The Apothecary needs two talks (stage 40, then 50); the second is skipped only if a potion is
  already held.
- Logout-safe: the varp is perm; a resume reads the stage from the items held (the potion from 50,
  none of the three from 60).

## Open questions

- A shorter way into Juliet's room (the kitchen's inner door, or the west stairs-room door at
  (3155,3438)) was not measured; the north door was the first route that worked.
