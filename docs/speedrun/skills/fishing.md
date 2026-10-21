# Fishing: fastest route to 99

Scripts: [`fishing-rate.ts`](../scripts/fishing-rate.ts) (any rod/net/harpoon method: logs
the server tick of every xp drop, catch, drop, click, spot move and hitpoint change, with
drop and re-find policies) and [`fishing-karambwan.ts`](../scripts/fishing-karambwan.ts)
(karambwan vessel cadence). Lab: [../LAB.md](../LAB.md), fishing port block. Most runs used
`NODE_TICKRATE=100`; the route totals were re-measured at `NODE_TICKRATE=300` (production
speed), because the costs that depend on the bot's reaction time (level-up dialogs, full
inventories) shrink when a tick is longer. Labels follow [README.md](README.md#labels).

## 1. Recommendation

Fly fish at the Lumbridge river from level 20 to 99, dropping every fish the tick after it
is caught together with a re-click of the spot, and re-clicking the nearest spot whenever
the one you fish moves. Below 20, net shrimp with the starter-kit net at Draynor. Fly
fishing is the best method at every level from 20 to 99, in both the normal and the 3-tick
case, so there is only one band change. Measured at production tick speed, 20 to 99 takes
**4,837 ticks** (`fishing-rate.ts fly 20 ... until=99`, 673 catches), and level 1 to 99
about **5,120 ticks** including the 1-20 band and the walk (inferred, section 2). That is
about 9% above the 4,700-tick model this replaces: spot moves, level-up dialogs and the
first walk cost about 450 ticks.

Quest rewards are the large lever. Sea Slug alone gives 7,175 base (level 74), and five
quests give 21,649 base (level 90), leaving **about 2,010 ticks** of fly fishing (measured
segment, section 3). With a 3-tick cycle ([tick-manipulation.md](tick-manipulation.md)),
1 to 99 is about 3,110 ticks and 90 to 99 about 1,190 (both inferred).

## 2. Route by level band

| Band | Method | Location | Unlock | Base xp per catch (read) | Ticks per roll | Catch chance per roll (read) | Base xp per tick | Ticks for band |
|---|---|---|---|---|---|---|---|---|
| 1-20 | Small net: shrimp, anchovies from 15 | Draynor spots (3085-3086, 3227-3231), stand at (3088,3229) | Small fishing net (starter kit) | 10 shrimp, 40 anchovies (`fishing.struct:1-11`) | 6 (measured) | 19% at 1, 29% at 10, shrimp near-certain from 15 | 0.32 at 1, 1.6 at 20 (inferred) | **201** (measured, `fishing-rate.ts net 1 8000 until=20`, 10 catches) |
| walk | Draynor to the Lumbridge river | about 155 tiles | | | | | | about 78 at run speed, 2 tiles per tick, infinite run on the demo (inferred) |
| 20-99 | Fly fishing: trout, salmon from 30 | Lumbridge river: spots on (3239, 3241-3244) and (3238, 3251-3255), stand at (3241,3248) | Fly fishing rod and feathers, Fishing 20 | 50 trout, 70 salmon (`fishing.struct:25-35`) | 5 (measured) | 25% at 20, 42% at 30, 57% at 50, 69% at 70, 80% at 90, 85% at 99 | 2.5 at 20, 6.5 at 50, 8.0 at 70, 9.4 at 90 (read); **9.83 at 99** (measured, 757 rolls, 0.855 catches per roll) | **4,837** (measured at 300 ms ticks, 673 catches, 69 level-ups, 18 spot moves) |

Time inside the 20-99 band (measured, 300 ms run, ticks from the first click): level 50 at
303, 60 at 488, 70 at 875, 80 at 1,543, 90 at 2,813, 95 at 3,793, 99 at 4,837. Over 40%
of the band is spent above level 90.

Totals from each starting point (normal cycle measured; 3-tick inferred as the read model
for a 3-tick cycle plus the measured overheads of 1.3 ticks per level-up and 11 ticks per
spot move at 3.7 moves per 1,000 ticks):

| Start | Base xp | Level | Normal cycle | 3-tick cycle |
|---|---|---|---|---|
| Level 1, no quests | 0 | 1 | about 5,120 (201 + 78 + 4,837) | about 3,110 |
| Level 20 | 124.2 | 20 | 4,837 | about 2,930 |
| Sea Slug | 7,175 | 74 | 3,735 | about 2,230 |
| Sea Slug + Tai Bwo Wannai Trio | 13,675 | 83 | 2,928 | about 1,740 |
| ... + Fremennik Trials | 16,487.4 | 86 | 2,587 | about 1,550 |
| ... + Heroes' Quest + Fishing Contest (all five) | 21,649.4 | 90 | 2,008 | about 1,190 |

The normal-cycle figures for quest starts are segments of the measured 20-99 run, from
the tick at which it passed that xp (measured). The read model without overheads gives
4,525 ticks for 20-99 at the normal cycle and 2,715 at 3 ticks.

The 1-20 band is small whichever way it is done. Baiting sardines and herring from level
5 is slightly faster (5 to 20 in 152 ticks, measured with 5 catches; 133 ticks for 1 to 20
in the read model with net to 5 and bait after), but it needs a rod and bait for about 20
ticks of saving. A quest-first plan skips the band and the walk entirely.

## 3. Quest xp

| Quest | Base Fishing xp (read) | Source | Level after (alone) | Fishing-related requirement in the content |
|---|---|---|---|---|
| Sea Slug | 7,175 | `caroline.rs2:45` (`stat_advance(fishing, 71750)`) | 74 | Checks 30 Firemaking (`quest_seaslug.rs2:43`) |
| Tai Bwo Wannai Trio | 6,500: 1,500 for becoming Lubufu's apprentice (`tbwt_lubufu.rs2:365`) and 5,000 from Tiadeche after the quest (`tbwt_tiadeche_final.rs2:21`) | | 72 | |
| Fremennik Trials | 2,812.4 | `quest_viking.rs2:141` | 60 | |
| Heroes' Quest | 2,725 | `quest_hero.rs2:34` | 60 | The lava eel needs 53 Fishing and an oily rod to catch (`lavafish.rs2:82-99`) |
| Fishing Contest | 2,437 | `quest_fishingcompo.rs2:112` | 58 | 10 Fishing (`hemenster_fishing.rs2:70`, `fishingcompo_journal.rs2:11`) |
| Digsite (panning) | 2 | `area_digsite.rs2:28` | | negligible |

All five together give 21,649.4 base, level 90 (91 needs 22,932.4). Order does not matter
for the total, since each reward is a fixed amount.

No reward choice can be spent on Fishing. Legends' Quest offers Attack, Defence, Strength,
Hitpoints, Prayer, Magic, Woodcutting, Crafting, Smithing, Herblore, Agility and Thieving
(`radimus_erkle.rs2:87-117`), and Tourist Trap offers Fletching, Agility, Smithing and
Thieving (`irena.rs2:77-91`). Genie lamps are untradeable and random events are off on
production (prior research).

Playtime each reward replaces, at the normal cycle (measured segments, against 4,837 ticks
from level 20; a quest-first account also skips the roughly 280-tick 1-20 band and walk):

- Sea Slug: 1,102 ticks (1,380 from level 1).
- Tai Bwo Wannai Trio after Sea Slug: 807 more.
- Fremennik Trials after those two: 341 more.
- Heroes' Quest and Fishing Contest after those three: 579 more together.

At a 3-tick cycle every saving shrinks to about 60% of that. Quest durations belong to
`docs/speedrun/quests/`; each quest pays only if its own playtime is below these figures.

Fishing Trawler is a minigame, not a reward: about 20 catch rolls per player per
1,000-tick game (`trawler_control.rs2:149-162`, `trawler_win.rs2:108-156`), roughly 1 base
xp per tick (inferred), and helpers in the same boat do not raise any one player's share.

## 4. Mechanics

### The fly-fishing cycle (read, then measured)

- Clicking Lure runs `attempt_fish_trout_salmon` (`freshfish.rs2:25-56`). If
  `%action_delay < map_clock` it sets `%action_delay = map_clock + 4`. At `+3` and `+2`
  it only prints the cast messages, and in every case it continues to the hidden op 4.
- Op 4 runs `fish_trout_salmon` (`freshfish.rs2:59-87`). It rolls when
  `%action_delay = map_clock`. On the next tick `%action_delay < map_clock` again, so it
  re-arms `+4` and the next roll lands 5 ticks after the last. Measured: 437 of 673 gaps in
  the 300 ms route run are exactly 5 ticks, and the rest are multiples of 5 (failed rolls)
  except around level-ups and moves.
- Each roll tries salmon first and then trout (`fishing.rs2:40-72`, from level 30,
  `freshfish.rs2:80-84`). So xp per roll is `Ps*70 + (1-Ps)*Pt*50`, with `Ps`/`Pt` from
  `stat_random(fishing, 16, 96)` and `(32, 192)`. The success formula is
  `floor(lo*(99-L)/98) + floor(hi*(L-1)/98) + 1 > rand(256)` (`PlayerOps.ts:591-600`). At 99
  that is 0.379 and 0.754, 0.847 catches per roll and 49.9 base per roll (read). Measured
  0.855 over 757 rolls at 100 ms and 0.889 over 270 rolls at 300 ms.
- The roll uses the current level (`PlayerOps.ts:594`), so a boost would help, but nothing
  in the content boosts Fishing (no `stat_boost` or `stat_add` of fishing anywhere in
  `server/content/scripts`).
- A feather is used only on a catch (`fishing.rs2:62-65`).

### Every method in this content

Cycle = ticks between rolls. Normal cycles were measured with `fishing-rate.ts`; the
re-arm offsets are read. Rates at 99 are read; measured values are at 99 over 1,500-2,500
ticks with drop-when-full.

| Method | Script (re-arm) | Level | Base xp per catch | Cycle | Base xp per tick at 50 / 70 / 99 (read) | Measured at 99 | Survives a 3-tick re-click (read) |
|---|---|---|---|---|---|---|---|
| Net: shrimp, anchovies | `saltfish.rs2:60-81` (+5) | 1, anchovies 15 | 10, 40 | 6 | 2.7 / 3.3 / 4.2 | 1.65 (inventory stalls; cycle 6 confirmed, 88 gaps of 6) | no |
| Bait: sardine, herring | `saltfish.rs2:128-155` (+4) | 5, herring 10 | 20, 30 | 5 | 3.0 / 3.7 / 4.5 | 5 to 20 only | no |
| Fly: trout, salmon | `freshfish.rs2:59-87` (+4) | 20, salmon 30 | 50, 70 | 5 | **6.6 / 8.0 / 10.0** | **9.83** | **yes** |
| Bait: pike | `freshfish.rs2:123-150` (+4) | 25 | 60 | 5 | 2.7 / 3.4 / 4.5 | not run | yes |
| Slimey eel (Mort Myre) | `slimeyfish.rs2:46-69` (+4) | 28 | 65 | 5 | 2.3 / 3.0 / 4.1 | not run | no |
| Harpoon: tuna, swordfish | `rarefish.rs2:185-232` (+5) | 35, swordfish 50 | 80, 100 | 6 | 3.5 / 4.4 / 5.9 | 5.71 | no |
| Cage: lobster | `rarefish.rs2:79-123` (+5) | 40 | 90 | 6 | 3.0 / 4.0 / 5.6 | 4.99 | no |
| Big net (mackerel, cod, bass, junk; every item rolled independently) | `memberfish.rs2:121-215` (+5) | 16, cod 23, bass 46 | 0.1-100 | 6 | 3.0 / 3.9 / 5.4 | 5.10 | no |
| Lava eel (oily rod) | `lavafish.rs2:70-80` (+4) | 53 | 60 | 5 | - / 3.4 / 4.5 | not run | yes |
| Karambwan (vessel) | `tbwt.rs2:99-134` (`p_delay(5)`, no loop, not on the clock) | 65, Tai Bwo Wannai Trio | 105 | 7 minimum (measured, 36 of 300 attempts; lab mean 8.4) | - / 6.7 / 9.4 | 0.623 per attempt (read 0.629) | not on the clock |
| Harpoon: shark | `memberfish.rs2:50-78` (+5) | 76 | 110 | 6 | - / - / 2.9 | 2.52 | no |
| Karambwanji | `tbwt.rs2:67-97` (+5) | 5 | 5, or 10 for shrimp | 6 | below net | not run | no |

Crossovers (read model): net beats nothing else below 5. Bait sardines and herring beat
the net from 5 to 20 (0.59 against 0.37 at level 5, 1.85 against 1.62 at 20). Fly fishing
beats every other method at every level from 20 (2.46 against 1.85 at 20, 9.99 against
5.93 for the best alternative at 99). Under a 3-tick cycle the net overtakes bait at 15,
and fly still wins from 20. The 6-tick methods gain most from 3 ticks, but even swordfish
reach only 11.9 against fly's 16.6 at 99. Karambwan cannot be manipulated at all.

### Tick manipulation (which methods can take it)

Every method except karambwan rolls on the shared `%action_delay = map_clock` check, like
Woodcutting and Mining. The knife-on-log trick sets `%action_delay = map_clock + 2` when
the clock has expired (`cut_logs.rs2:83-84`). The player then re-clicks the spot, which
enters the attempt label with `%action_delay = map_clock + 2`. Only some attempt labels
continue from that state (read):

- **Continue:** fly and pike (`freshfish.rs2:37-52`, `102-117`), the waterfall loc
  (`waterfall.rs2:14-29`) and lava eel (`lavafish.rs2:50-67`). These fall through to the
  fishing op whatever the offset.
- **Stop fishing silently:** small net, saltwater bait, cage, harpoon, shark, big net,
  slimey eel and karambwanji. Their attempt labels only act on `<`, `= +3`/`+4` and `=`,
  so a click at `+2` does nothing. Example: `rarefish.rs2:164-180`.

So the 3-tick numbers in this document apply to fly fishing, the method the route uses.
Testing the trick is owned by [tick-manipulation.md](tick-manipulation.md).

### Spot movement (read, then measured)

Every spot type has `timer=1` and an `ai_timer` that waits 2 ticks (`npc_delay(2)`),
teleports to a random empty coordinate from its area's list and re-arms
`280 + random(250)` ticks. So each spot moves every 280-529 ticks, 404.5 on average
(`fishing_movement.rs2:1-28`, coordinate lists in `fishing_movement.enum`). Nothing in the
fishing scripts scales with player count. The 2-tick delay lets two spots claim the same
empty tile at startup, so stacked spots exist; probes showed two on one tile at Catherby
and the Gnome Stronghold.

The server does not walk the player after a moved spot. The lite client routes every
click itself (`clientRoutefinder`, `server/webclient/src/lite/actions.ts:6-8`), so the bot
must re-click. Measured, fly at 99, with an immediate re-click of the nearest matching
spot (about 4,000 ticks per location at 100 ms; 3,000 for Barbarian Village and Seers'):

| Location (spots / tiles) | Base xp per tick | Moves per 1,000 ticks | Ticks lost per move |
|---|---|---|---|
| **Lumbridge** (2 / 8) | **9.83** | 3.2 | 10.7 |
| Entrana (4 / 7) | 9.56 | 3.8 | 11.5 |
| Gnome Stronghold (7 / 12) | 9.42 | 5.8 | 9.4 |
| Baxtorian Falls (6 / 10) | 9.42 | 4.3 | 9.9 |
| Seers' Village (4 / 7) | 9.38 | 4.3 | not split |
| Barbarian Village (2 / 5) | 9.34 | 2.7 | not split |

"Moves" counts relocations of the spot being fished. More spots mean more moves without
much cheaper re-finds, so Lumbridge's two spots, with a standing tile between their two
clusters, win. The loss per move is the walk plus the 4-tick re-arm. It was the same
(about 11 ticks) at 300 ms ticks.

## 5. Alternatives considered

- **Karambwan** (measured, `fishing-karambwan.ts`, 300 attempts at 99). The `p_delay(5)`
  costs 7 ticks at best, so the ceiling is 66 / 7 = 9.4 base per tick, below fly's 10.0.
  The lab managed 8.4 ticks per attempt (7.8 base per tick). It also needs Tai Bwo Wannai
  Trio, a 14-vessel load per inventory (each catch adds a fish while the empty vessel keeps
  its slot, and a full inventory refuses the attempt, `tbwt.rs2:115-118`), and karambwanji
  for every attempt, including failures. It cannot be manipulated.
- **Harpoon, cage, big net, shark** (measured 5.71, 4.99, 5.10, 2.52 at 99): 6-tick cycles
  and lower xp per roll, all below 60% of fly. They also cannot take a drop-and-re-click
  mid-cycle (section 6).
- **Pike, slimey eel, lava eel** (read): 4.5 or less at 99.
- **Fishing Trawler**: about 1 base per tick (inferred, section 3).
- **Other fly spots**: 1-5% slower than Lumbridge (table above). Barbarian Village is the
  natural choice near Edgeville at 9.34.
- **Drop-when-full** instead of drop-as-you-go: about 5 ticks lost per 26-fish inventory at
  300 ms (8.4 at 100 ms), or 130 ticks over 20-99 (measured per inventory, inferred total).

## 6. Gotchas

- **Inventory, fly fishing.** A drop clears the interaction (`OpHeldHandler.ts:54-56`) but
  not `%action_delay`. The fly attempt label continues from any offset, so dropping each
  fish and re-clicking the spot in the ticks after the catch costs nothing. Measured: the
  drop-as-you-go runs hit the read catch rate per roll (0.855 against 0.847). Send the drop
  and the click right after the catch: a click that lands on the roll tick itself replaces
  the fishing op with the attempt label, which does not roll, and loses that roll (read,
  `freshfish.rs2:37-52`). Rod and feathers take 2 slots, leaving 26.
- **Inventory, every 6-tick method.** The attempt label continues only on the tick after a
  catch (`< map_clock`) or the tick after that (`= +4`). A drop-and-re-click landing later
  stops fishing silently. Measured at 100 ms: drop-as-you-go harpoon and cage runs stalled
  for about 70 ticks at a time until the watchdog re-clicked. Drop when full there instead
  (5 user-event packets per tick, `ClientGameProtCategory.ts:6`, so 26 drops take 6 ticks).
- **Inventory full.** "You can't carry any more fish." opens a message box and ends the
  action (`freshfish.rs2:72-76`). Oddly, the check is skipped while exactly one feather is
  left.
- **Level-up dialogs** pause the interaction, because `canAccess()` is false while a modal
  is open (`Player.ts:878-888`). Measured: 1.3 ticks lost per level-up at 300 ms, about 2 at
  100 ms, with `sendClickDialog(0)` sent as soon as the dialog appears. 1 to 99 has 98
  level-ups (about 130 ticks); a quest start removes most of them.
- **Spot moves** every 280-529 ticks (section 4). Re-click the nearest matching spot at
  once; never rely on the server to follow.
- **Hostile NPCs** (read, `all.hunt` and `all.npc`): none that matter at Lumbridge (giant
  spiders are `cowardly`, range 1, combat 2). Draynor's dark wizards are aggressive casters
  (`huntmode=ranged`, range 5) that attack low-combat players. No damage was taken in 201
  ticks there or at any other spot measured. Baxtorian Falls has moss giants (`cowardly`,
  range 2, combat 42).
- **Random events** (`afk_event` whirlpools and the river troll, `macro_event_*.rs2`) are
  off on production.
- **Lab:** `::clearinv inv` does nothing, so `fishing-rate.ts` drops the starter kit itself.

## 7. Helper supply list

| Item | Count | For |
|---|---|---|
| Fly fishing rod | 1 | 20-99 |
| Feathers | about 700 from level 20 (673 used in the measured run, one per catch); about 320 from the all-quest level 90 | fly fishing |
| Small fishing net | 0 (in the starter kit) | 1-20 |
| Knife and logs | see [tick-manipulation.md](tick-manipulation.md) | 3-tick cycle only |

## 8. Open questions

- **Production latency.** The 300 ms lab ran bot, gateway and engine on one machine. On
  the demo, internet round-trips may push some re-clicks one tick later: a level-up
  dismissal, or a drop and re-click that lands on the roll tick. A timed run on a
  throwaway demo account would settle it.
- **3-tick totals** are inferred. They assume the knife-on-log trick runs every cycle
  without a lost roll and that the 300 ms overheads carry over. Settled by
  tick-manipulation.md once cairn://p/rs/1 lands.
- **The sea methods' failure under a 3-tick re-click** is read, not tested. It does not
  affect the route.
- **Heroes' Quest's lava eel**: whether helpers can supply it (it would spare the 53
  Fishing requirement) was not checked.
- **Quest playtimes** for Sea Slug, Tai Bwo Wannai Trio, Fremennik Trials, Heroes' Quest
  and Fishing Contest belong to `docs/speedrun/quests/`. Each is worth doing for Fishing
  only if it costs less than the ticks it replaces (section 3).
