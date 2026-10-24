# Woodcutting: fastest route to 99

Scripts: [`woodcutting-chop.ts`](../scripts/woodcutting-chop.ts) (chops at one standing
tile; `--click predict` is the recommended loop), [`woodcutting-lab.sh`](../scripts/woodcutting-lab.sh)
(one-batch lab on the woodcutting port block; `WC_TRACE=1` applies
[`woodcutting-trace.patch`](../scripts/woodcutting-trace.patch) for the run only),
[`woodcutting-trace-summary.ts`](../scripts/woodcutting-trace-summary.ts) (rolls, gaps,
fells and click phase from the engine's own log), [`woodcutting-spots.ts`](../scripts/woodcutting-spots.ts)
(static map survey of multi-tree tiles and hostile spawns), [`woodcutting-model.ts`](../scripts/woodcutting-model.ts)
(route totals). Lab: [../LAB.md](../LAB.md). Every measured cadence below was taken at
`NODE_TICKRATE=300` (production rate) and counted in **server ticks from the engine
trace**, not from the client. Labels follow [README.md](README.md#labels).

## 1. Recommendation

Carry a rune axe from level 1 (axes have no level requirement in this content). Chop the
normal trees beside the oaks north of Taverley to level 15, then **oaks from 15 to 73**
from the tile (2914,3494), which reaches three oaks. From **73 to 99, chop willows** from a
tile that reaches three willows: Taverley (2920,3406) for a low-combat account, or west of
Draynor (3058,3253), where the rates were measured. Run a predicted loop. On the tick
after every roll, send the drops for any logs and then a click on another live tree,
without waiting to see the roll's result. Drops and tree switches then cost nothing, and
the only lost ticks are level-ups and the rare moment when all three trees are down.

**About 3,960 ticks from level 1 to 99** on the demo (about 1,260 players online, respawn
20 ticks), and about 4,000 on a quiet server. With the knife tick manipulation from
[tick-manipulation.md](tick-manipulation.md), the totals are **about 3,030** and 3,060
(inferred, `woodcutting-model.ts`; section 2). The quest plan has no Woodcutting xp on
its route (section 3), so the headline starts at level 1.

The surprise is that oak, not willow, is the best tree until level 73. A rune axe
succeeds on every oak roll from about level 60, which gives 9.38 base xp per tick. Willow
only passes that at 73 and reaches 11.60 at 99. Maple, yew, magic and hollow trees never
win.

## 2. Route by level band

All with a rune axe. The cycle is a roll every 4 ticks for every tree and axe (read,
section 4; measured on willow and oak). Base xp per tick in the table is ideal: xp x
success / 4.

| Band | Method | Location | Unlock | Base xp per log (read) | Ticks per roll | Success per roll (read) | Base xp per tick | Ticks for band, demo / quiet (inferred) |
|---|---|---|---|---|---|---|---|---|
| 1-15 | Normal trees (each log fells the tree) | the normal trees beside the oak tile, e.g. (2912,3495), (2910,3492), (2918,3493) | none | 25 | 4, plus about 1 tick walking per log (inferred) | 88% at 1, 100% from 15 | 4.5-5.0 (inferred) | 14 / 13 |
| 15-73 | Oak, 3 trees from one tile | (2914,3494): oaks at (2912,3491), (2914,3495), (2915,3492) | Woodcutting 15 | 37.5 | 4 | 57% at 15, 71% at 30, 86% at 45, 100% from 60 | 5.38 at 15 -> 9.38 from 60 (ideal); **measured 8.41** at 65-74 (120 rolls, 120 logs; 9.0 without the bot's level-up losses) | 796 / 812 |
| 73-99 | Willow, 3 trees from one tile | Taverley (2920,3406): willows at (2918,3405), (2919,3407), (2921,3405); measured at (3058,3253): willows at (3057,3251), (3057,3254), (3059,3252) | Woodcutting 30 | 67.5 | 4 | 56% at 73, 64% at 90, 68.75% at 99 | 9.43 at 73 -> 11.60 at 99 (ideal); **measured 10.71-12.14** at 99 (95-136 rolls per run, success 66-74%) and 11.27 over 2,851 rolls | 3,145 / 3,172 |

Totals (inferred, `woodcutting-model.ts`, 400 simulated runs each). The model takes the
read success formula, the measured 4-tick cycle, free drops and switches (measured), 1 in 8
fells, a wait of D+4 ticks after the first fell when all three trees are down (measured,
stock client) and 1 tick per level-up (inferred, section 6). The knife columns multiply by
0.765, the ratio tick-manipulation.md measured for willows at 99 (5.53 to 4.23 ticks per
log, stock client); applying it to oak is inferred.

| Start | Base xp | Level | 4-tick, demo (D=20) | 4-tick, quiet (D=29) | Knife, demo | Knife, quiet |
|---|---|---|---|---|---|---|
| Level 1, no quests (**route**) | 0 | 1 | **3,958** | 4,001 | **3,028** | 3,061 |
| Monk's Friend (off route) | 2,000 | 56 | 3,657 | 3,697 | 2,798 | 2,828 |
| Fremennik Trials (off route) | 2,812.4 | 60 | 3,566 | 3,602 | 2,728 | 2,756 |
| Monk's Friend + Fremennik (off route) | 4,812.4 | 68 | 3,347 | 3,379 | 2,561 | 2,585 |
| Hero's Quest | 1,575 | 52 | 3,711 | 3,752 | 2,839 | 2,871 |
| Monk's Friend + Hero's Quest | 3,575 | 64 | 3,484 | 3,519 | 2,665 | 2,692 |

Ticks remaining to 99 from the start of a level, for any other starting point (inferred,
4-tick cycle; multiply by 0.765 for the knife). Interpolate between rows for xp in
between.

| Level | Base xp | Tree from here | Demo (D=20) | Quiet (D=29) |
|---|---|---|---|---|
| 1 | 0 | normal | 3,955 | 3,997 |
| 15 | 74.4 | oak | 3,941 | 3,984 |
| 30 | 293.8 | oak | 3,897 | 3,939 |
| 40 | 631.6 | oak | 3,841 | 3,882 |
| 50 | 1,304.8 | oak | 3,747 | 3,787 |
| 55 | 1,861.4 | oak | 3,676 | 3,716 |
| 60 | 2,647.7 | oak | 3,584 | 3,621 |
| 65 | 3,758.8 | oak | 3,457 | 3,492 |
| 70 | 5,329.2 | oak | 3,282 | 3,312 |
| 73 | 6,568.0 | willow | 3,145 | 3,172 |
| 75 | 7,548.9 | willow | 3,037 | 3,063 |
| 80 | 10,686.8 | willow | 2,715 | 2,740 |
| 85 | 15,123.1 | willow | 2,270 | 2,291 |
| 90 | 21,395.5 | willow | 1,673 | 1,688 |
| 93 | 26,344.9 | willow | 1,216 | 1,228 |
| 95 | 30,264.5 | willow | 860 | 868 |
| 97 | 34,766.8 | willow | 452 | 456 |
| 99 | 39,938.3 | | 0 | 0 |

Willow from 73 is 80% of the total, and above level 90 is 42%. The decisive band is
measured directly.

## 3. Quest xp

| Source | Base Woodcutting xp (read) | Source line | Level after | On the route? |
|---|---|---|---|---|
| Monk's Friend | 2,000 | `quest_drunkmonk.rs2:89` | 56 | No. It saves about 301 ticks (demo) or 230 with the knife, below the quest plan's 325-tick threshold (rs/2, rs/3). |
| The Fremennik Trials | 2,812.4 | `quest_viking.rs2:139` | 60 | No. It saves about 392 ticks (300 with the knife); the quest plan rates it a net loss (rs/3). |
| Hero's Quest | 1,575 | `quest_hero.rs2:36` | 52 | Not costed here. It saves about 247 ticks. It also gives 2,575 base Mining (`quest_hero.rs2:39`). |
| Legends' Quest | 7,650 per training pick, 4 picks, and the menu allows Woodcutting more than once | `radimus_erkle.rs2:104-122` | needs Woodcutting 50 to start (`legends_journal.rs2:114`) | No; off the quest route (rs/3). |
| Tourist Trap | none | the reward menu is Fletching, Agility, Smithing, Thieving (`irena.rs2:78`) | | |
| Genie lamp | 10 x current level | `xplamp.rs2:110-111` | | Random event only (`macro_event_genie.rs2:70`), so it can't be planned. |

From level 1, the route is 3,958 ticks (demo). From any quest's xp, read the start table
or the remaining-ticks table in section 2.

## 4. Mechanics

### The roll and the 4-tick cycle (read, confirmed by trace)

- A tree click runs `attempt_cut_tree`. If `%action_delay < map_clock`, it sets
  `%action_delay = map_clock + 3` and re-runs on the next tick (`woodcut.rs2:55-60`).
  Then it swings and, if the timer equals `map_clock`, rolls at once (`woodcut.rs2:97-98`).
  The loop continues through `cut_tree` with `p_oploc(3)`: on the tick after a roll it
  sets the timer 3 ahead again, and it rolls when the timer comes due
  (`woodcut.rs2:153-160`). So the rolls fall every 4 ticks (measured: 2,600 of 2,850 gaps
  in one run, and every gap except fells and level-ups in the predicted runs).
- The axe only selects the lo/hi pair (`woodcut.rs2:249-262`, `trees.dbrow`). Every axe
  has the same cycle, and there is **no dragon axe**: `axes.obj` holds bronze through
  rune plus black, and `woodcutting_axe_checker` returns rune as the best
  (`woodcut.rs2:220-240`). The level requirements for axes are commented out
  (`woodcut.rs2:197-219`), so a rune axe works at level 1, wielded or in the pack.
- Success: `floor(lo*(99-L)/98) + floor(hi*(L-1)/98) + 1 > rand(256)` with the current
  level (`PlayerOps.ts:591-600`). The trace logged every roll's value and outcome:
  **5,707 rolls across levels 15-99 on oak and willow matched the formula** (z-scores
  between -0.5 and +1.5 per run; for example, 1,979 of 2,851 at willow 99, 69.4% against
  68.75%). No content boosts Woodcutting.
- Logs per success: 1. Fells: 1 success in 8 for every tree except normal trees, which
  fall on every log (`woodcut.rs2:168-174`, `random(0)` is always 0). Measured on
  willow: 238 fells in 1,979 logs (1 in 8.3). The stump lasts
  `scale_by_playercount(respawnrate)`: willow and oak 30 -> **29 ticks** with one player
  (measured, every one of about 480 fells), 20 on the demo at 1,260 online (inferred,
  `player_count.rs2`).

| Tree | Level (read) | Base xp | Rune lo/hi | Respawn (read) | Success at 99 | Base xp/tick at 75 / 99 (ideal) |
|---|---|---|---|---|---|---|
| Normal | 1 | 25 | 224/700 | 120-199 | 100% from 15 | 5.0 with a walk per log (inferred) |
| Oak | 15 | 37.5 | 112/350 | 30 | 100% from about 60 | 9.38 / 9.38 |
| Willow | 30 | 67.5 | 56/175 | 30 | 68.75% | 9.62 / **11.60** |
| Maple | 45 | 100 | 28/87 | 120 | 34.4% | 7.03 / 8.59 |
| Hollow tree | 45 | 82.5 | 64/94 | 86 | 37.1% | 6.93 / 7.65 |
| Yew | 60 | 175 | 14/44 | 200 | 17.6% | 6.32 / 7.69 |
| Magic | 75 | 250 | 7/21 | 400 | 8.6% | 4.15 / 5.37 |

Crossovers (inferred, `woodcutting-model.ts`): normal to oak at 15 (the oak unlock), and
oak to willow at **73**. Oak beats willow from 30 to 72 (6.67 against 6.00 at 30, 9.34
against 8.44 at 60).

### The predicted loop: why drops and switches cost nothing (measured)

- The bot sends drops and a click on another live tree on the tick after each roll. The
  click lands where the chop loop would have restarted the timer anyway, so the next roll
  comes 4 ticks after the last one, whether or not the last tree fell. The trace confirms
  the phase: 84 of 89 accepted clicks landed on the tick after a roll
  (`woodcutting-chop.ts --click predict --shift 0`). A felled tree then cost nothing
  unless all three were down.
- Clicking on the roll tick itself also works for the roll, which happens at once on the
  new tree. If that roll fells the tree, though, nothing restarts the timer on the next
  tick, and the next click starts a fresh 4-tick wait: **+1 tick per fell** (measured:
  2,438 of 2,883 clicks on the roll tick, 384 ticks lost over 238 fells, 11.27 base xp
  per tick against 11.6).
- A bot that reacts to seeing the fell also loses 1 tick per fell (measured: 11 of 11
  fells; stock client). Over the route that is about 83 fells, so about 83 ticks
  (inferred).
- When all three trees are down, the next roll comes D+4 ticks after the first of them fell
  (measured: fell at 424, roll at 457, D=29; stock client reacting to the respawn). A
  click sent blind on the respawn tick would make it D+3 (inferred). Measured cost:
  17 ticks over 19 fells on oak at 100% success, where fells are most frequent.
- Sending a click every tick costs nothing either (measured: 340 rolls at willow 99, 11.66
  base xp per tick): a mid-cycle click finds the timer pending and keeps it.

## 5. Alternatives considered

| Method | Rate | Verdict |
|---|---|---|
| Willow from 30 instead of oak to 73 | 6.00-9.38 base xp per tick against oak's 6.67-9.38 (ideal) | Loses; oak is 11% faster at 30 and 11% faster at 60. |
| Maple, yew, magic, hollow trees | 8.59, 7.69, 5.37, 7.65 at 99 (ideal) | Lose to willow at every level and to oak below 73. |
| Normal trees past 15 | 6.25 if a fresh tree were always adjacent, 5.0 with a walk per log (inferred) | Each log fells the tree and respawn is 120-199 ticks, so no tile keeps up. Oak is close at 15 (5.38) and clearly better by 25; levels 15-25 are only 120 base xp. |
| Reacting to fells instead of predicting | +1 tick per fell (measured) | About 83 ticks over the route (inferred). |
| Lighting logs (Firemaking) | Every light is time not chopping | Lose: logs are tradeable, so helpers can supply Firemaking logs at no playtime cost. |
| Knife tick manipulation | x0.765 ticks (tick-manipulation.md, willow 99, measured) | **Use it if the knife setup is ready**: about 930 ticks saved. It needs a knife, one normal log, a members world (the demo is one) and Fletching 1. |
| Hero's Quest for its 1,575 base | saves about 247 ticks (inferred) | A quest-plan decision; not costed here. |

## 6. Gotchas

- **Inventory.** Drop each log on the tick after the next roll, before that tick's tree
  click: 0 ticks per inventory (measured; 1,979, 101, 64 and 121 drops in four runs, none
  rejected, no gap attributable to a drop). A drop clears the chop interaction
  (`OpHeldHandler.ts:54-56`, `clearPendingAction`) but not `%action_delay`, so the click
  after it rolls on schedule. A drop sent on its own mid-cycle cancels the pending roll
  (measured for Mining in [mining.md](mining.md), section 6; the same handler, not
  re-measured here). Never let the pack fill: a full pack ends the loop with "Your
  inventory is too full" (`woodcut.rs2:146-150`). The server takes 5 inventory or click
  events per tick (`ClientGameProtCategory.ts:6`); the loop needs one drop and one click.
- **Level-ups.** The level-up box opens on the tick after the roll, after client packets
  and before interactions (`World.ts:402`, `793`, `801`), so it blocks the click that
  landed that tick. A click on the next tick closes it and restarts the timer: **1 tick
  per level-up (inferred**, matching mining.md's measured 1). My bot measured 3.4-4.4
  ticks per level-up (37 level-ups at willow 35-45 cost 163 ticks; 11 on oak cost 37),
  because it waited for the level to appear in its state. There are about 98 level-ups, so
  this is worth up to about 300 ticks; see section 8.
- **Hostile NPCs.** `woodcutting-spots.ts` lists no aggressive spawn within 15 tiles of
  the oak tile (2914,3494), the Taverley willow tile (2920,3406) or the Draynor-west tile
  (3058,3253). It checks spawn points only, not wander range. tick-manipulation.md lost a
  level-3 lab bot to a magic caster at the Draynor willows (most likely a dark wizard;
  the Dark Wizards stand around (3087,3234)). **A low-combat account should use the
  Taverley willows.** The Taverley tiles have the same three-willow geometry but were not
  measured.
- **Second-choice sites** (the demo is busy). Oak: (2474,3378), with oaks at (2471,3378),
  (2472,3375), (2475,3378), and no hostile spawns within 15 tiles; or (2676,3338), with
  oaks at (2673,3338), (2676,3335), (2677,3338) and a brown bear (cowardly) nearby.
  Willow: (2922,3401) or (2924,3400) at Taverley, each reaching three willows, then
  Draynor west (3058,3253) or (3061,3252). Every one of these has three trees on one
  tile, so the inferred rate equals the recommended site's. A two-tree tile loses more
  to all-down waits.
- **Another player fells your tree first** (inferred, not measured). The stump replaces
  the loc, so the chop loop's next `p_oploc(3)` has no tree and the interaction ends. The
  timer keeps its due tick. If your next predicted click goes to a live tree before that
  tick, the roll happens on schedule on the new tree (`woodcut.rs2:97-98`), at a cost of
  0. If the fell lands inside the 3-tick wait and the bot only clicks on its next grid
  tick, that roll is lost: 4 ticks. A bot should re-click another tree as soon as it sees
  an unexpected stump.
- **Respawn varies with load.** D = floor(30 x (4000 - players) / 4000): 29 ticks up to
  200 players online, 20 at 1,201-1,400 (inferred, same scaling as mining.md). The demo's
  higher load helps slightly (3,958 against 4,001 ticks).
- **Lab measurement traps** (for anyone scripting gathering bots).
  - The lite client re-reports old game messages under new observation ids, so counting
    "You get some logs" over-counted on ticks where the server granted nothing (measured).
    Count xp changes instead.
  - The client's tick counter is reliable only when the machine is not overloaded.
    Measure cadences from the engine trace (`WC_TRACE=1`).
- **Client fix rs/22** (one tick faster reactions) does not change the predicted loop. It
  would cut the stock-client figures labelled above: +1 per fell when reacting, and D+4
  after an all-down wait. The level-up cost is a reaction too.

## 7. Helper supply list

| Item | Count | Why |
|---|---|---|
| Rune axe | 1 | Best axe, usable from level 1 |
| Knife | 1 | Only for the knife tick manipulation (tick-manipulation.md) |
| Logs (normal) | 1 | Only for the knife tick manipulation; not consumed in steady state |
| Dragon bones | 359 over S07, about 23 per top-up trade | Buried inside the knife cycle (section 9) |

No food is needed at the recommended oak and Taverley willow tiles (no hostile spawns
within 15 tiles). Bring food or combat levels only for the Draynor willows.

## 8. Open questions

- **Level-up cost.** Modelled at 1 tick (inferred), measured 3.4-4.4 by a bot that waited
  to see the new level. The likely fix is to detect the level-up from the xp, which is
  visible a tick earlier, and either re-click a tree straight away or dismiss with
  `sdk.sendClickDialog(0, {blind:true})` (rs/51 measured 10 continue pages in 2 ticks).
  One willow run from level 35 with that change would settle it. It is worth up to about
  300 ticks.
- **Taverley and second-choice sites** are surveyed, not measured; the oak spot (2914,3494)
  and Draynor-west willows were measured.
- **Knife on oak.** The 0.765 ratio was measured on willows. Oak at 100% success fells a
  tree every 8 rolls, so a 3-tick cycle meets all-down waits more often; the oak band
  under the knife may save a little less than modelled.
- **Live demo check.** The demo respawn of 20 comes from the formula and the player count
  (inferred). One run on the demo would confirm it.
- **Contention** with other players is inferred from the script, not measured.
- **Levels 1-15** on normal trees are modelled with one walking tick per log (inferred).
  They are 14 ticks in total, so the error is a few ticks at most.

## 9. Bones inside the knife cycle (in-page program)

The run buries most of its dragon bones while chopping (S07; why and how many in
`research/bones-placement.md` on rs/103's branch). The in-page program `knife-cycle` does it
with the `bury` parameter (`server/webclient/src/bot/programs/knife-cycle.ts`; how a step script
starts it in `speedrun/README.md`, `programs.ts`).

**The schedule (read, bones-placement.md section 2; measured in-page).** On the label that
shows roll R, the page sends knife on logs, button 8889, one log drop and a bone's Bury (4 of
the 5 user events per tick). On R+2 it sends the tree click alone. On R+1 the knife sets the
clock to R+3, then the bury clears the interaction and the queued fletch and delays the
player through R+2 (`bury_bone.rs2`), so nothing may land on R+2. The click lands on R+3, where
the first-click label finds the clock due and rolls at once (`woodcut.rs2:97-98`): the 3-tick
lattice holds with one bone per roll. That click also closes a level-up page, so Woodcutting
and Prayer level-ups cost no roll. With no bone in the pack the roll label sends the plain knife
bundle (with the click), which rolls on the same R+3, so running out loses no label, and burying
resumes when bones arrive. The variant is refused for fishing (the fly lock breaks, measured by
rs/105) and for normal trees (each log re-bootstraps on the next tree).

**Two things the variant needs.**

- **Only the reachable trees (`trees`).** The program clicks the nearest live tree. Without a
  list, when one of the three oaks falls the nearest live oak can need a walk. A walk never
  completes in a bury cycle, because each roll label's bury (`p_stopaction`) cancels it, so
  the account buries a bone every cycle and chops nothing until it creeps to the tree. Measured
  without the list: 292 and 302 bones buried in 200 rolls, 0.28 and 0.27 bones per tick, 5.21
  and 5.53 ticks per roll over the span. With the list, the account never left 2914,3494.
- **A fall is a switch, not a lost lock.** A tree that falls (one log in 8 at 100% success)
  leaves the clock with the player, so a live tree clicked by the roll tick takes the roll. The
  program sends the cycle's click to a live tree. If the plain knife's click already went to the
  fallen one, it re-clicks before the roll. Every tree down: the plain knife sends no starter
  (a starter with no click leaves the fletching menu open, so the fletch completes and uses
  the knife's log). A bury cycle still goes out, so bones are buried through the wait. Both
  rules apply to the plain knife loop as well.

**Measured** (local engine, `NODE_TICKRATE=300`, a visible Chrome tab on bgsrv-mac, load 2.0-3.3,
2026-10-21 10:52-11:06 PDT, `tickprog-lab.sh` `oak` mode: WC 60 and Prayer 43 at the start, rune
axe, the three oaks from 2914,3494; the in-page probe 60 of 60 on the next tick; 0 deferred
packets, 0 skipped ticks in every run). Bones were topped up by a staff `::give` at 3 left, so
the figures are the loop's own; the run's trades come on top.

| 200 rolls each, in run order | Ticks per roll over the span | Gaps at 3 | Bones per tick | Tree falls switched | Resyncs |
|---|---|---|---|---|---|
| Knife | 3.201 | 191 of 199 | | 26 | 0 |
| Knife + bury | 3.261 | 187 of 199 | **0.329** (215 sent, 215 buried) | 25 | 0 |
| Knife | 3.402 | 187 of 198 | | 31 | 1 |
| Knife + bury | 3.156 | 190 of 199 | **0.329** (208 of 208) | 20 | 0 |
| Knife + bury (previous batch, same program apart from the all-down rule) | 3.261, 3.201 | 189, 189 of 199 | 0.329, 0.329 | 26, 22 | 0, 0 |

The bury costs the loop nothing measurable: 3.21 ticks per roll against 3.30 for the plain
knife at the same band, in the same tab. Each run had 42-43 Prayer and 19 Woodcutting
level-ups. The lite figure (rs/105) was 0.298 bones per tick including its real trades. 5 ticks
per 23-bone load (rs/105 section 3) would put the in-page loop at about **0.31 bones per tick
with trades** (inferred, 23 bones in 23 x 3.21 + 5 ticks). Not measured in-page: the trade
itself, which the program leaves to the step script (stop, `receiveFrom`, start). The restart
re-anchors on observed xp, so it may cost a few ticks more than the lite script's bootstrap.
The willow band is not measured in-page.

### Knife + bury or plain + bury: the on-time switch (rs/643)

knife-cycle has two bury loops. Knife + bury is the one above. Plain + bury (`technique: 'plain'`
with `bury`, #165) puts a bone in the plain 4-tick cycle's idle ticks: R drops and clicks, R+1 buries,
R+3 clicks alone and lands on the roll. Both loops depend on a timed Bury. A Bury that lands a tick late
puts its `p_delay` over the cycle's click, OpLocHandler drops the click, and the roll is lost. A
burying band (oak or willow with `bury`) therefore never chops without burying. Under `technique`
auto it runs one loop or the other on the on-time rate it measures in itself, with no probe:

- **The instrument (knife-cycle).** The engine deletes a buried bone on the tick after the Bury lands.
  So a Bury sent on label S that lands on its tick, S+1, shows the bone gone on label S+2. Each Bury is
  counted there as `buryOnTime` or `buryLate`. A run whose S+2 label the page decoded together with
  the next counts that Bury neither way. Every bury cycle sends one Bury, so this rate is the server's
  on-time rate for that cycle's sends, in either loop.
- **The switch (woodcutting.ts `OnTimeMeter`).** Tumbling windows of 50 judged Burys, one
  technique per window. The knife goes to plain + bury as soon as a window has more than 13 late (it can
  no longer reach 37 of 50, the break-even of 14.5 of 20 that main ruled from the lab below), without
  waiting for the window's end. Plain + bury goes back to the knife on a window with 41 of 50 or more on
  time. A switch stops the run and starts the other, the way a bone load does, and the loads go on in
  either loop. Every band and every resume starts on the knife with an empty window. The deadband from
  37 to 40 keeps either technique (the return about 1.3 standard errors above the keep), so noise near
  the break-even doesn't flap it. Simulated, that is at most about 5 switches per 1000 Burys at any
  rate, and none at 0.6 or below or at 0.9 and above. The first design's 17.6 of 20 (44 and 47 of 50)
  assumed plain + bury holds its clean ~3.87 ticks a roll on a ragged server, which the lab refuted.
- **Forced techniques.** `technique: 'knife'` with `bury` is rs/642's forced knife. `'plain'` with
  `bury` is plain + bury throughout. Neither switches.
- **The lab's forced lateness.** The runtime's `hold` (a share of sends held one label) reaches each bury
  cycle's timed sends in both loops: the knife's roll-label bundle and its lone click, and plain + bury's
  Bury and R+3 click. `measure-woodcutting.ts --hold-ticks=N` makes the hold reach only a band's first N
  ticks. With `hold` unset or 0, knife-cycle's packets are identical to f6ecd96f's (pinned digests in
  `knife-cycle.test.ts`).

**Measured** (bgsrv-mac, 400 ms, a headless Chrome tab, four real givers, willow from 80, rune axe,
2026-10-24 02:40-03:23Z). Ticks per landed roll is chopping ticks over the rolls the logs stand for
(1 / p each). Base Prayer xp is 72 a dragon bone.

| Run | Burys on time | Ticks per landed roll | Bones a tick | Base Prayer xp a tick |
|---|---|---|---|---|
| Knife + bury, no hold (two runs) | 20/20 | 3.05, 3.24 | 0.26, 0.27 | 18.7, 19.3 |
| Knife + bury forced, hold 0.12 | 18.5/20 | 3.95 | 0.28 | 20.2 |
| Plain + bury forced, hold 0.12 | 17.5/20 | 6.41 | 0.21 | 15.1 |
| Knife + bury forced, hold 0.25 (two runs) | 13.9/20, 14.4/20 | 7.56, 9.60 | 0.19, 0.16 | 13.5, 11.9 |
| Plain + bury after the switch, hold 0.25 | 16.1/20 | 7.06 | 0.22 | 15.7 |

The switching band, hold 0.25 for its first 350 ticks, then none (80 to 87, 996 ticks, 8 loads, none
refused). The knife went to plain + bury at T529 on 37 of 44, with its 7th late Bury. Plain + bury buried
every bone of loads 3-7. It went back to the knife at T1066 on its first clean window (50 of 50), and
the knife then ran 3.13 ticks per landed roll to the end.

What this says about the break-even: plain + bury is not a fixed ~3.87 on a ragged server. Its timed
Bury loses rolls to late sends just as the knife's does, and faster. In this lab the knife was the
faster loop at every rate down to about 14-15 of 20, where the two met (hold 0.25). Main set the
threshold there, 14.5 of 20 (`BURY_BREAK_EVEN`, one constant, priced by rs/158). The samples are
small, though: 37-66 logs a run, so about ±15% on each figure. And `hold` is a model of a slow
server, not a recording of one. The switching band's figures above ran under the first design's 17.6
of 20. Under 14.5 the same band would have stayed on the knife at 37 of 44, the rate where the knife
was the faster loop.

### The giver group (S07's b01-b04 taking turns)

On the run the loads come from four givers taking turns (`helpers/bone-giver.md` "Taking turns":
one restock round trip on the demo, 205-215 ticks, is longer than three loads of burying). The
step takes them with `bones.group` (CLI `boneGroup=cairn_b01,cairn_b02,cairn_b03,cairn_b04`) in
place of one `bones.giver`:

- **Whose turn.** Before each load's `receiveFrom` the step takes its partner from
  `bone-giver.ts` `awaitBoneServer`: `boneServer` over the givers' status files in the cue
  directory, the same rule the givers use to decide which of them keeps a request standing. While
  no giver serves (every one away at the bank) it waits on observed ticks, up to `serverWait`
  (default `SERVER_WAIT_TICKS`, 400, about two round trips), and a load that finds none fails the
  band: `bone load N from the group (...) failed: no giver of the group served within N observed
  ticks`. The bone-receiver stand-in (`givers`) takes its partner from the same function. Each
  load's row carries the giver and the ticks waited for it (`giver`, `serverWait`).
- **The cue.** The givers find the scored account only through `cue.json`, and read only a cue
  scoped `{ step: 'S07', family: 'bone' }` (`S07_BONE_CUE`). Nothing else writes one (Runecraft's
  S06 cue is scoped to S06's altar givers and ends with a stop they never see), so the step writes
  it: at each burying band's start, before the first load, in one cue session for the whole step
  (the group counts its loads per session, across both bands), and a stop when S07's last band
  reaches `to`. A band that fails leaves the cue standing for the resume. With one `bones.giver`
  the step writes no cue, as before.
- **The site.** The cue names SCORED's stand (`Cue.site`), and the givers wait at that site rather
  than rotating between the trees (`helpers/bone-giver.md`, "Which site"). Each burying band's start
  names its own stand, a resume included. The oak band's end names the willows', because SCORED
  sets off for them then, and givers told only at the willow band's start would arrive a walk late.
- **The last load.** The want is the same whichever giver serves, so `bones.lastLoad` (21) holds
  for the group as for one giver; which giver carries T07-08's runes is the helpers' choice
  (`finalExtras` on one giver, served on the group's last load by `boneServer`). Once the runes
  are in, that load was the last: the band asks for no other, and the knife cycle chops on without
  bones to the band end, as the bones run out well before 99.
- **The early last load (rs/663).** The group's load count is padded above need, so it must not
  decide when the band ends. When the last band is past `to` with Prayer at `prayerTo` (the run
  sets 99 and 99), holds no bones, and still owes the runes, it writes `lastLoad` into the S07 cue
  once (`BoneCue.markLastLoad`; a resumed process reads it back and never writes it twice). Its
  next ask wants exactly `CAMELOT_RUNES`, from the group's final giver only, and the band closes on
  that load without starting another run. If no final giver serves within `serverWait`, the band
  fails by name and keeps the cue for the resume. The fallback for that case is the coordinator's
  call; the code never closes without the runes. The flag's row is `woodcutting:last-load`, and the
  band summary carries `bothTargetsTick` for measuring the close.
- **The pure-bury tail (rs/700).** Past `to` the last band never chops again: knife-cycle ends
  on its `untilLevel`, and while Prayer, the runes or a clear pack are owed the band buries every
  bone held with `prayer.ts` `buryHeld`, takes the next load, and repeats, the runes' load last.
  Inside a band each bone rides a roll of the chop (0.26-0.28 bones a tick, rs/643); the knife loop
  run on past 99 kept that rate (about 3.9 ticks a bone in attempt 4's rehearsal), with nothing left
  to chop for. The bury's own rate is the engine's: `bury_bone.rs2` runs `p_delay(0)`, which
  `PlayerOps.ts` makes a delay through the next tick; `OpHeldHandler` drops every click while the
  player is delayed; and `World.ts` clears the delay only in `processPlayers`, after the tick's
  client input, where the script deletes the bone. So one bone per two ticks at best, with nothing
  to batch. `buryHeld` sends each Bury on the frame that shows the last bone gone, a frame on which
  the delay has cleared, so no click lands in it; with a round trip inside a tick that is the 2-tick
  floor, plus each load's trade. `done` and `inProgress` are unchanged, so a resume at `to` that
  still owes Prayer or the runes re-enters the band and goes straight to the tail. A tail whose
  Burys go unanswered (`BURY_STALL` in a row) fails the band by name and keeps the cue. The band
  summary's `buryTail` and the `woodcutting:bury-tail` rows (one per pass) carry the tail's ticks,
  bones, loads and resends.
- **The close target.** `prayerTo` is the run config's `s07PrayerTo` (`chain.ts` `s07PrayerTo`,
  default `S07_PRAYER_TO`, 99): the band closes, and the early last load fires, at that Prayer. A
  value below 99 is for a run in which a later step buries the rest; the chain's Prayer-99 check
  (S25b's fallback) does not move with it.
- **No bones at the close.** On the scored run's path (`bones.lastLoad` set), the last band buries
  every bone it holds before it closes, Prayer 99 or not, so T07-08 starts with the knife, a log and
  the runes. The early last load brings no bones, and a count-driven last load (21 bones and the
  runes) is buried in the tail. A resume that finds bones held at both targets re-enters the
  band to bury them.
- `handBack: true` names one giver, so it is refused with a group (name the partner instead).

The group's load failures and their recovery. In both cases the band fails, keeps the cue standing,
and never closes without the runes.

| Failure (the band's error) | Cause | Recovery |
|---|---|---|
| `bone load N from the group (...) failed: no giver of the group served within N observed ticks` | no giver loaded and in sight within `serverWait` (all away, faulted or logged out) | the operator relaunches the bone family's launcher and resumes `--from=S07`; the resume re-enters the band in the same cue session and the givers carry on their count |
| `woodcutting:willow-73-99: the bury tail stalled: 5 Burys in a row buried nothing at ...` | the server answered none of the tail's Burys (a disconnect, a modal the Continue did not clear) | resume `--from=S07`: the band re-enters the tail with the bones still held |
| `... the group's final giver did not serve the runes' load (the cue's lastLoad) within N observed ticks: relaunch the bone givers and resume --from=S07` | the cue says lastLoad, and b04 (the only giver that may serve it) is faulted, logged out or stale | the operator relaunches the bone family's launcher (a fresh launcher ignores stale cues) and resumes `--from=S07`. The resume re-enters the closing band, writes `lastLoad` once in the new session, and asks b04 again. Not `handBack`, a path no lab has exercised (rs/186's ruling) |

**Measured** (local engine, `NODE_TICKRATE=300`, a headless Chrome tab on bgsrv-mac, load 2.2-5.2,
2026-10-22 18:29-18:41Z, `speedrun/lab/measure-woodcutting.ts band --level=15 --bury --givers=4`:
cairn_b01-b04 under the run-machine launcher with staff-made bones, so a giver's restock takes a
tick, not the demo's ~211; the lab's 25x xp rate, so a band is short in ticks):

| | Run A: this step on main's helpers, oak 15-65 | Run B: rs/383's group last load (`--final=7`, its helpers at 4838513b), oak 15-72 |
|---|---|---|
| Loads | **6 of 6**, b01, b02, b03, b01, b04, b02 | **7 of 7**, b01, b02, b03, b01, b02, b03, then b04 with 21 bones, 1 law and 5 air |
| Click to bones (`receiveFrom` ticks) | **4** (the first 5) | **4** (the first and the last 5) |
| Waiting for a server | 0 ticks on every load | 0 ticks on every load |
| Band ticks around the loads (stop, trade, restart) | 46 for 6, ~7.7 a load | 51 for 7, ~7.3 a load |
| After the last load | | no load asked; chopped on 220 ticks to 72 (the gate went plain at T643), runes held at the end |

The step always traded the giver `boneServer` named, and no giver requested out of turn. Run A's
b01 came round again before b04's first turn because b04 logged in after b01 had already given
load 1 and stood loaded again (a 1-tick lab restock): the longest-waiting rule, not a skip. In
run B, b04 was held for the last load as rs/383's rule intends. Against rs/383's lab of the
stand-in (4 ticks a load, a bury gap of 7) the step takes the same 4 ticks a load. Not measured
here: the demo's round trips, and the willow band.
