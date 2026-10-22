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

## The self route (the route in force)

Measured through `speedrun/quests/fishing-contest.ts` (rs/388): lab, lite client, bgsrv-mac,
300 ms, SCORED's levels (Fishing 74, Magic 99, Agility 75), SCORED's pack after H16 (8
slots), from the arrival tile (2820,3486); 3 chains each mode, every one complete with the
reward's xp. Ticks are the module's segments; T19-20 (the first Camelot cast and the run
east) is the leg's.

| Seg | Action | Fixed (m, 3 runs) | Burst (m, 3 runs) |
|---|---|---|---|
| A | the kit held (H16) | 0 | 0 |
| B | click the stairs: the dwarf stops you (dialogue 1 tick after the click), 15 pages + 5 options, the pass | 24 | 16 |
| C | Camelot teleport, run round the wood to the railing's outside tile (2661,3500) | 62.3 | 62.3 |
| D | squeeze through into the wood (2662,3500) | 2 | 2 |
| E | run to the vine (2631,3499), Check with the spade: the worm 2 ticks after the click | 39 | 39 |
| F | run back to (2662,3500), squeeze out | 36 | 36 |
| G | run to the gate (2643,3441) | 63 | 63 |
| H | Morris checks the pass (dialogue 1 tick after the click), through | 7 | 7 |
| I | Bonzo: pay 5 coins, the willow spot | 14 | 12 |
| J | garlic in the pipe (2638,3446): the pipe spot is ours | 11.7 (9-13) | 11 |
| K | one catch at the pipe spot (2637,3444) with the worm: the carp | 6 | 6 |
| L | Bonzo takes the carp: the trophy | 10 | 9 |
| M | Camelot teleport, run to the stairs | 38.3 | 38.7 |
| N | the trophy to the dwarf, complete, the level-up page, drop the pass and spade | 14 | 12 |
| | **Total** | **327.3** (324, 329, 329) | **314** (315, 314, 313) |

Against the helper-carp route's 181 fixed from the same tile, the self route's +146 is
almost all walking: C to G (202.3, of which the dig is 2 and the two squeezes 4) replace the
helper route's teleport and run to the gate (69), +133; the garlic adds J (11.7); the catch is
4 faster (the pipe spot is beside Bonzo). Burst saves 13.3, all in dialogue (B 8, I 2, L 1, N
2, J 0.7); the walks do not move.

What the content and the map fix, all found on the lab:

- **McGrubor's Wood is east of the loose railing** (2662,3500). Its wall runs between x
  2661 and 2662; the squeeze (`mcgrubors_wood.rs2:12-23`, `p_delay(0)` and a 1-tile
  exactmove) goes from (2661,3500) into the wood and back. Inside, the way to the vines winds
  round an inner fence (south to z 3484, then west and north). Aimed at the vines from
  outside, the SDK pathfinder routes through McGrubor's locked gate (2649,3469) and stalls
  there; aim every walk at a tile on the right side of the railing.
- **Only the wall pipe at (2638,3446) can be reached**: the client finds no route to the
  pipes at 2636 and 2637 ("I can't reach that!"). The garlic is used from that pipe's tile.
- **Pay Bonzo before the garlic**: stashing while the fee is paid sets the pipe stage
  unconditionally (`quest_fishingcompo.rs2:90-93`). Stashing first, as this document had
  it, leaves that to `~move_hemenster_pipe`, which needs the Sinister Stranger (spawn
  (2635,3437); he wanders) within 8 tiles of the player when Bonzo seats him
  (`bonzo.rs2:40-42`, `quest_fishingcompo.rs2:97-105`). His three pages after the stash come
  only when he is in range (2 of 3 fixed runs: J 13, against 9 without).
- The stairs start the dwarf's dialogue only while a tunnel dwarf is within 5 tiles
  (`quest_fishingcompo.rs2:15`); otherwise the click does nothing and says nothing, and the
  module talks to him (one more option).
- Something in McGrubor's Wood hits for a point or two (about 6 HP over C to F in one run at
  70 HP); harmless at the scored account's HP, not identified.
- A second entry after a gate reset costs 5 more coins (`bonzo.rs2:24-30`); H16 carries 5.

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
