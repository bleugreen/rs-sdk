# Goblin Diplomacy

**On the route as the first quest of step S24** (`speedrun/quests/goblin-diplomacy.ts`,
STEP-MANIFEST.md entry 25): **51.7 ticks fixed, 21.3 with dialogue bursts**, from its two arrival
tiles (measured, below). It is filler for the Champions' Guild door (5 quest points).

## Reward

- **200 base Crafting** (read, `stat_advance(crafting, 2000)`, `quest_gobdip.rs2:62`; measured
  5,000 game xp, Crafting 42 to 45 on the route) and a **gold bar** (`:63`; H21a takes it back).
- **5 quest points.**

## Requirements (as this server enforces them)

None. Each general's talk checks the mail it asks for (`quest_gobdip.rs2:91`, `:100`, `:109`).

## Helper-supplied items

SUPPLIES.md hand-off H20 at the Rusty Anchor: goblin mail 3, orange dye 1, blue dye 1 (all
tradeable, `quest_gobdip.obj`, `dyes.obj`). The dyed mails are `tradeable=no`, so SCORED dyes two
mails itself: a dye used on a mail (`goblin_mail.rs2:1-12`, no p_delay, no stage check).

## Step list

Quest varp `%goblinquest`: 0-6 (`quest_gobdip.constant`; complete 6). The quest tab shows only
started and complete: stage 2 comes from the journal, stages 3-5 from the mails held.

The step runs in two parts round the Taverley legs (`runner/legs.ts`): the Rusty Anchor part
(T23-24 lands at the bartender, 3045,3257), then L24a, Druidic Ritual and L24b, then the village
part (L24b lands beside the generals, 2957,3511).

| # | Where | Action | Varp | Raw counts | Fixed | Burst | Label |
|---|---|---|---|---|---|---|---|
| G1 | the bartender | "Not very busy in here today, is it?" (`bartender.rs2:18`, `quest_gobdip.rs2:13-19`) | 0 → 1 | `opt, 4c` | 6, 9, 8 | 6, 4, 3 | m |
| G2 | the bartender | both dyes on two mails, sent in one tick (each on its own slots) | | 2 item-on-item | 1, 1, 1 | 1, 1, 1 | m |
| G3 | General Wartface | the greeting (3 pages), "Do you want me to pick an armour colour for you?", 5 pages | 1 → 2 | `3c, opt, 5c` | 10, 10, 10 | 4, 4, 4 | m |
| G4 | Wartface | the greeting, "Oh it you.", the orange mail handed over, 3 replies | 2 → 3 | `9c` | 10, 10, 10 | 3, 3, 3 | m |
| G5 | Wartface | the greeting, the blue mail, 3 replies and the player's line | 3 → 4 | `9c` | 10, 10, 10 | 3, 3, 3 | m |
| G6 | Wartface | the greeting, the plain mail, 4 replies; the completion queued (`:58`); the Crafting level-up page | 4 → 5 → 6 | `9c` + level-up | 13, 13, 13 | 6, 6, 6 | m |
| | | **Total from the two arrival tiles** | | | **51.7** | **21.3** | m |

Measured with `speedrun/lab/quests/goblin-diplomacy.ts` on bgsrv-mac, lab at 300 ms, SCORED's
post-Monkey-Madness levels and the ledger's pack after H20: lite client 3 of 3 in each mode for
each part; browser client (bundle md5 64caf234) burst 6 + 16. The manifest's 61 fixed / 41 burst
were inferred (quest_points.md's standalone 188 / 168 less its ~127 of travel).

## Tick total

| Part | Fixed | Burst | Label |
|---|---|---|---|
| Travel (the Falador teleport and the run to the Rusty Anchor; Kaqemeex to the generals) | the legs' (T23-24, L24b) | the same | m |
| Dialogue (5 talks, 41 pages, 2 options, the level-up page) | 50.7 | 20.3 | m |
| Item uses (2 dyes) | 1 | 1 | m |
| **Total (the step's share)** | **51.7** | **21.3** | m |

## Risks and gotchas

- The bartender's first page is the choice itself (no greeting); G1's spread (6-10 fixed) is the
  approach to him behind the bar.
- Talk to General Wartface, not Bentnoze: Bentnoze's Talk-to checks Dragon Slayer's map stage and
  a clue first (`general_bentnoze.rs2`), Wartface's goes straight to the quest.
- The varp is perm; every segment is logout-safe.

## Open questions

None.
