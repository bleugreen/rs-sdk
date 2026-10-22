# Fishing Contest

**Verdict: on the route as a precondition, done by the scored account itself (the self
route).** It costs **327.3 ticks fixed and 314 burst from the arrival tile beside the
tunnel stairs (2820,3486)** (measured: `speedrun/quests/fishing-contest.ts`, rs/388, lab,
lite client, 3 + 3 chains, section "The self route"). Its 2,437 base Fishing replaces
**325 ticks** given Sea Slug (rs/2 `docs/speedrun/skills/fishing.md` section 3 subset
table: SS 3,735 → SS+Contest 3,410, normal cycle): break-even fixed (-2), +11 burst.
The quest stays whatever its net, because its quest point is needed (main, 2026-10-22: the
route has none to spare for the Fishing Guild's 32). If fly fishing moves to the 3-tick
cycle (`tick-manipulation.md`), the same xp replaces only **186 ticks** (2,226 → 2,040).

The raw giant carp is **untradeable** (`skill_fishing/configs/fishing.obj:378`,
`tradeable=no`; this document said tradeable, citing the obj's header at line 362, and
rs/173's demo confirmed it: two carp handovers failed with an empty offer). The red vine
worm and the pass are untradeable too (`quest_fishingcompo.obj`). So the helper-carp route
below is not feasible: the scored account digs its own worm in McGrubor's Wood, catches
the carp at the pipe spot, and gets the pass from the dwarf; a helper stages only the
rod, a spade, garlic, the fee and the runes (main's ruling, 2026-10-22).

The helper-carp figures below were measured with
`docs/speedrun/scripts/quest-smallskill-fishingcompo.ts` (two full runs, 224 and 218 ticks
of steps) at `NODE_TICKRATE=300` on the fixed lite client; they are kept for the shared
steps' history.

## Reward

- **2,437 base Fishing** (read, `stat_advance(fishing, 24370)`, `quest_fishingcompo.rs2:112`;
  measured 60,925 game xp).
- **1 quest point** (read, `general/configs/quest.constant:92`).
- Unlocks the dwarven tunnel under White Wolf Mountain (`quest_fishingcompo.rs2:8-14`).

## Requirements (as this server enforces them)

| Check | Where | Type |
|---|---|---|
| Fishing 10 to fish in the contest | `hemenster_fishing.rs2:70` | `stat()` (boostable) |
| Competition pass in the inventory at Morris's gate | `quest_fishingcompo.rs2:37` | item, `tradeable=no` (`quest_fishingcompo.obj:30-41`) |
| 5 coins for Bonzo | `bonzo.rs2:24-29` | item |
| A raw giant carp in the inventory when Bonzo collects the catch | `bonzo.rs2:58` | item, `tradeable=no` (`fishing.obj:378`) |

The wiki's start requirement of Fishing 10 at the dwarf is not enforced here: the comment
at `mountain_dwarf.rs2:54-56` notes it was added in the 2006 rework. On the planned route
Sea Slug comes first, so Fishing is far above 10 anyway.

## Helper-supplied items

One trade (H16, the self route): a fishing rod, a spade, a garlic, 5 coins, and Camelot
teleport runes for three casts (3 law, 15 air; Magic 45, `magic_spells.dbrow:89-94`), the
first of them T19-20's. No fishing bait: the red vine worm is the bait
(`hemenster_fishing.rs2:20-24` prefers it), and with it the pipe spot gives the carp, never
shrimps (`:29-32`).

**Getting the carp from a helper (not feasible: the carp cannot be traded).** A helper starts the quest
at the dwarf, digs a red vine worm in McGrubor's Wood (`mcgrubors_wood.rs2:26-48`, a
spade), stashes garlic in the pipe (`quest_fishingcompo.rs2:85-94`), pays Bonzo, catches a
giant carp with the worm at the pipe spot (`hemenster_fishing.rs2:29-32`) and **leaves
through the gate before catching three fish**: the third catch hands the carp in
(`hemenster_fishing.rs2:48-53`), and leaving resets the helper's contest
(`bonzo.rs2:72-81`) while the carp stays in its inventory. The helper can repeat this for
every future carp.

## Step list (helper-carp route, not feasible; kept for the shared steps)

Quest varp `%fishingcompo` (perm): 0, 1 started, 2 in the contest, 4 won, 5 complete
(`quest_fishingcompo.constant`, `quest.constant:24`); `%hemenster_comp_stage` (perm) counts
the fee and the catches.

| # | Where | Action | Varp | Raw counts | Fixed (measured, 2 runs) | Label |
|---|---|---|---|---|---|---|
| 0 | anywhere | helper trade | | 1 trade | 5 (9 stock) | measured, `primitives.md` |
| 1 | → Camelot (2757,3478) | Camelot teleport | | 1 cast | 4 | measured |
| 2 | → tunnel stairs (2820,3484) | run east | | 66-69 route tiles | 36-40 | measured, `bot.walkTo` |
| 3 | tunnel stairs | click the stairs: the dwarf (2820,3487) stops you, which starts one option nearer the pass than Talk-to (`quest_fishingcompo.rs2:15-19`). "Why not?", "If you were my friend I wouldn't mind.", "Well, let's be friends!", "And how am I meant to do that?", "Fortunately I'm alright at fishing!" | 0 → 1, pass | 17 pages + 5 options; runs `2c, opt, 2c, opt, 2c, opt, 2c, opt, 5c, opt, 4c` | 24-26 | measured |
| 4 | → Camelot | Camelot teleport | | 1 cast | 4 | measured |
| 5 | → Hemenster gate (2642,3441) | run west | | 119 route tiles | 65 | measured |
| 6 | gate | Morris checks the pass and lets you in (`quest_fishingcompo.rs2:36-43`) | | 3 pages; `3c` | 5 | measured |
| 7 | Bonzo (2641,3439) | "I'll enter the competition please."; pays 5 coins; spot by the willow | comp 0 → 1, 1 → 2 | 9 pages + 1 option; `3c, opt, 6c` | 11 | measured |
| 8 | willow spot (2630,3435) | one catch with bait (`p_delay(4)`, `hemenster_fishing.rs2:100`); any fish advances the comp stage | comp 1 → 2 | 1 interaction | 10 | measured |
| 9 | Bonzo | "I caught some fish! Here...": he finds the carp, trophy (`bonzo.rs2:47-64`) | 2 → 4 | 5 pages; `5c` | 10 | measured |
| 10 | → Camelot | Camelot teleport (from inside the contest) | | 1 cast | 4 | measured |
| 11 | → tunnel stairs | run east | | 69 route tiles | 36 | measured |
| 12 | dwarf | hand in the trophy, quest complete (queued, `mountain_dwarf.rs2:96-102`) | 4 → 5 | 7 pages; `7c` | 9 | measured |
| | | **Total** | | 47 dialogue clicks, 3 casts, 323 route tiles | **223** (218 + 5; run 1: 224 + 5) | measured |

The first run fell back to staff teleports for its three Camelot casts (a freshly
created lab account drops its first casts; the script books the measured 4 ticks), the
second cast all three for real: 4 ticks each.

## Tick total

| Part | Stock | Fixed | Burst | Label |
|---|---|---|---|---|
| Travel (3 teleports, 323 route tiles) | 149 | 149 | 149 | measured (`bot.walkTo`; chained clicks would save about 15) |
| Dialogue (5 conversations, 47 clicks) | 106 | 59 | 36 | fixed measured; stock = fixed + 1 per click; burst from the runs with the CONVENTIONS.md rule (dwarf 16, gate 1, Bonzo 4 and 1+approach, dwarf 2, plus approaches) |
| Interactions and waits (the catch, the gate) | 12 | 10 | 10 | measured (stock +1 per reaction, inferred) |
| Trade | 9 | 5 | 5 | measured, `primitives.md` |
| **Total** | **~276** | **223** | **~200** | |

## The self route (for comparison)

Instead of the trade carp: Camelot teleport (4), run to the **west** side of McGrubor's
loose railing (2661,3500) (112 tiles, 58 measured), squeeze through (2), run to the vines
(2631,3497) (61 tiles, 38), dig a worm (`p_delay(0)`, about 3, inferred), back to the
railing (62 tiles, 40), squeeze out (2), run to the gate (113 tiles, 62); inside, stash
garlic in the pipe (2637,3446) before paying (`p_delay(2)`, about 4, inferred), and Bonzo's
set-places then moves the stranger at once (`bonzo.rs2:40-42`, two extra pages); fish the
pipe spot (2637,3444) with the worm. That replaces steps 4-5 (69 ticks) with about 211, so
the self route is about **367 ticks fixed**, a net loss of about 40 against 325. The
walks were measured; the dig, the stash and the carp catch failed in the one self run
and are inferred from their scripts. Note that the SDK pathfinder treats McGrubor's locked
gate as a door: aim walks at the railing's outside tile (2661,3500), not the inside one.

## Risks and gotchas

- **Three catches end the contest.** On the scored account it doesn't matter (the carp
  is already in the bag), but the helper must leave after its carp, before a third fish.
- **Leaving through the gate mid-contest resets it** (`bonzo.rs2:72-81`); don't walk out
  between step 7 and step 9.
- **The stranger's spot.** At stage 2 the pipe spot belongs to the Sinister Stranger and
  fishing there starts his dialogue (`hemenster_fishing.rs2:64-67`); fish the willow spot.
- Logout-safe: all three varps are `scope=perm` (`quest_fishingcompo.varp`). The contest
  state survives a logout, though logging out inside the fence was not tested.
- No fights. Grandpa Jack and the other contestants are not aggressive.

## Marginal value

| Basis | Ticks saved | Source |
|---|---|---|
| Given Sea Slug, normal fly-fishing cycle (the on-route case) | **325** | rs/2 `fishing.md` section 3 subset table (SS 3,735 → SS+Contest 3,410), rs/2 branch at 0e184ef2 |
| Given Sea Slug, 3-tick cycle | 186 | same table, 3-tick column (2,226 → 2,040), inferred there |
| Alone, from level 1 | 755 | same table (5,120 → 4,365) |

## Open questions

- Whether helpers stockpiling giant carp is acceptable to the maintainers. It uses only
  the rule that tradeable items are free (CONVENTIONS.md), but the carp is a quest item
  the contest awards.
- Whether the run will fly fish on the 3-tick cycle; if so, drop this quest.
