# Cook's Assistant

**On the route as step S23** (`speedrun/quests/cooks-assistant.ts`, STEP-MANIFEST.md entry 31):
**19 ticks fixed, 12 with dialogue bursts**, from the cook's tile (measured, below). It is filler
for the Champions' Guild door's 32 quest points; its Cooking is a by-product (S25c is helper-fed).

## Reward

- **300 base Cooking** (read, `stat_advance(cooking, 3000)`, `quest_cook.rs2:91`; measured 7,500
  game xp at rate 25): from level 1 this is level 30 (`speedrun/lib/xp.ts`) and one level-up page.
- **1 quest point** (read, `general/configs/quest.constant`).

## Requirements (as this server enforces them)

None. The hand-in checks an egg, a bucket of milk and a pot of flour (`quest_cook.rs2:42`).

## Helper-supplied items

SUPPLIES.md hand-off H19 at the kitchen: egg 1, bucket of milk 1, pot of flour 1 (all tradeable),
with T23-24's Falador runes. The run chain trades it on T22-23 (`runner/handoff.ts`), so the
step only checks it.

## Step list

Quest varp `%cookquest` (perm): 0, 1, 2 (`quest_cook.constant`). The cook (npc 278) stands at
(3209,3215) in Lumbridge Castle's kitchen; T22-23 lands there.

| # | Where | Action | Varp | Raw counts | Fixed | Burst | Label |
|---|---|---|---|---|---|---|---|
| A | the cook | H19 held (a no-op on the route) | | | 0 | 0 | m |
| B | the cook | "What am I to do?", "What's wrong?", two pages, "Yes, I'll help you.", two lines (`cook.rs2:9-10`, `quest_cook.rs2:2-37`) | 0 → 1 | `1c, opt, 3c, opt, 2c` | 9, 9, 9 | 6, 6, 6 | m |
| C | the cook | his question, two lines, his thanks, the mesbox after which the items go (`quest_cook.rs2:39-87`); the completion queued (`:88`); the Cooking level-up page answered | 1 → 2 | `5c` + level-up | 10, 10, 10 | 6, 6, 6 | m |
| | | **Total from the cook's tile** | | | **19** | **12** | m |

Measured with `speedrun/lab/quests/cooks-assistant.ts` on bgsrv-mac, lab at 300 ms, SCORED's
levels and the inventory ledger's pack after H19: lite client 3 of 3 in each mode, browser client
(bundle md5 64caf234) burst 12. The manifest's 17 fixed / 12 burst were inferred from page
counts (`quest_points.md`); the fixed row is 2 over them for the level-up page.

## Tick total

| Part | Fixed | Burst | Label |
|---|---|---|---|
| Travel (Lumbridge teleport and the run in) | the leg's (T22-23, 21 m) | the same | m |
| Dialogue (2 talks, 11 pages, 2 options, the level-up page) | 19 | 12 | m |
| Trade | the hand-off's (H19) | the same | |
| **Total (the step)** | **19** | **12** | m |

## Risks and gotchas

- None found. The milk's bucket and the flour's pot go with them (`inv_del` of the filled items),
  so nothing is left to drop.
- Logout-safe: `%cookquest` is `scope=perm`, and the quest tab shows every stage.
- The level-up page opens 1-2 ticks after the completion and is answered in the step.

## Open questions

None.
