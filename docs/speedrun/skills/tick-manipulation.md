# Tick manipulation for the gathering skills

Shared by [woodcutting.md](woodcutting.md), [fishing.md](fishing.md) and
[mining.md](mining.md). Conventions (read / measured / inferred, base xp, ticks) are in
[README.md](README.md). Scripts:

- [`tickmanip-cycle.ts`](../scripts/tickmanip-cycle.ts): one target (willow, fly-fishing
  spot, lobster spot). It runs a technique (`base`, `eat` or `knife`) and logs the server
  tick of every packet sent and every xp drop.
- [`tickmanip-mine.ts`](../scripts/tickmanip-mine.ts) and
  [`tickmanip-mine-run.sh`](../scripts/tickmanip-mine-run.sh): rs/5's iron rotation at the
  Ardougne zoo cluster, with a starter (`eat`, `knife` or `none`) on every move.
- [`tickmanip-lab.sh`](../scripts/tickmanip-lab.sh): boots the tickmanip port block
  (LAB.md), logs one bot in, runs the given commands and tears everything down.
- [`tickmanip-latency.ts`](../scripts/tickmanip-latency.ts): checks that a packet sent on
  state label c is processed on server tick c+1, the assumption every loop here rests on.

Every measurement is at `NODE_TICKRATE=300` (the production rate), unless a row says 100 ms.
The rs/9 rows used the **stock** lite client. The rows marked rs/53 (respawn 13, level-ups)
used the client with the #20 fix (a tick is published only after it is fully decoded) on a
quiet host, `bgsrv-mac` (load 2-6, every latency probe on c+1). Both loops are
**predicted**: they send each packet on a tick computed from their own bootstrap and use xp
drops only to detect a lost lock. #20 did not change packet timing, and the cycles
reproduced (knife iron at respawn 19: 3.50 ticks per ore, 0 slips, on both clients). It
did move the xp one label earlier: stats from a roll on R are now in the state for R, not
R+1, so the executors' slip checks take `--xplag` (0 now, 1 for the stock client). A
reactive loop, one that waits to see the roll before sending, lost a tick per cycle on the
stock client; it was not re-measured on the fixed one. Host load matters much more than
the client (section 6).

## 1. Recommendation

Use the **knife-on-logs starter**. On the tick after each roll, send knife-on-logs, the
"15 Arrow Shafts" menu button, a drop, and the re-click, all in the same tick. That moves
the next roll to 3 ticks after the last one (read: `cut_logs.rs2:83-85`). In steady state it
consumes nothing: the re-click closes the menu and clears the queued fletch before it
runs (read: `Player.ts:817-820`). Measured end inventories kept all 10 logs over 150
willow logs, 150 fly catches, 80 lobsters and 60 ores. It needs a knife, one normal log,
a members world (the demo is one, `fly.toml:23`) and Fletching 1. The fletch-menu path is
**tested** (section 7).

Eating food is a menu-free alternative that writes the same clock (`consume.rs2:129-131`).
It costs one food bite per cycle, though, and its relative `+3` carries a late packet
forward instead of correcting it. Use it only where the knife is unavailable.

| Skill and method | Normal cycle | With the knife starter | Ticks per xp drop, normal -> knife (measured) |
|---|---|---|---|
| Fishing: fly (trout, salmon), 99 | 5 (read `freshfish.rs2:77-78`; measured 80 of 90 gaps) | **3** (121 of 148 gaps) | 5.56 -> **3.80** (`tickmanip-cycle.ts`, 90 and 148 gaps) |
| Fishing: fly at Lumbridge, 78 -> 99 through 21 level-ups and spot moves (rs/53) | 3,410 ticks for the segment (fishing.md) | 3, lock kept through every level-up | **3.80** ticks per catch, 1,978 ticks for 78-99 (520 catches); a second run from 20 took 2,896 to 99, 2,032 of them from 9,612 base |
| Fishing: lobster cage, 99 | 6 (read `rarefish.rs2:117-118`; measured 19 of 32 gaps) | 3, but about 40% of cycles produce no roll | 8.44 -> **7.06** (32 and 79 gaps) |
| Woodcutting: willow, rune axe, 99 | 4 (read `woodcut.rs2:153-154`; measured 47 of 75 gaps) | **3** (85 of 131 gaps) | 5.53 -> **4.23** (75 and 131 gaps) |
| Mining: iron rotation, respawn 19 | 3 when stationary (read `mining.rs2:118-119`, `pickaxes.obj:198`); 4.82 ticks/ore moving | 3 per ore; 3.50 ticks/ore (6 rocks wait once per lap) | 4.82 -> **3.50** (`tickmanip-mine.ts`, 60 ores) |
| Mining: iron rotation, respawn 13 (demo) | 4.94 ticks/ore; adjacent-rock starter 3.61 | **3** per ore, no wait (5-rock lap = respawn + 2) | 4.94 -> **3.00** (knife, 2 x 200 ores, rs/53) |

A 2-tick Mining cycle is not possible (inferred, section 4). Fishing gains most, because
its normal cycles are 5 and 6 ticks.

## 2. Mechanism

**The shared clock.** Every gathering loop rolls only when the player variable
`%action_delay` equals `map_clock`. A continuation label that finds the clock expired sets
it to `map_clock + N` and waits (read):

- Woodcutting: `woodcut.rs2:153-158`, N = 3, so a 4-tick cycle.
- Fly fishing: `freshfish.rs2:77-86`, N = 4, so 5 ticks. Lobster: `rarefish.rs2:117-122`,
  N = 5, so 6 ticks.
- Mining: `mining.rs2:118-123`, N = the pickaxe's `mining_rate`: rune 2 (`pickaxes.obj:198`),
  so 3 ticks. Iron depletes on every ore, so the real cost is the move to the next rock
  (mining.md section 4).

**Starters.** Any script that writes `%action_delay` between a roll on tick R and the
loop's own reset on R+1 replaces N. Client packets are processed before players each tick
(read `World.ts:399-425`), so a packet processed on R+1 runs before the gathering script
on R+1. At that point the clock still holds R.

- Knife on logs: `if (%action_delay < map_clock) %action_delay = map_clock + 2`
  (`cut_logs.rs2:83-85`). On R+1 that gives R+3, and the roll comes 3 ticks after the last.
  The write is **absolute**: sent on any tick with an expired clock, it schedules a roll 2
  ticks later.
- Eating: `%action_delay = %action_delay + 3` (`consume.rs2:129-131`). On R+1 that also
  gives R+3. The write is **relative**: it only works if it lands exactly on R+1. On R+2 the
  loop has already reset the clock to R+4 (woodcutting), so the eat pushes it to R+7.

**Keeping the interaction.** Both starters are inventory ops, and the engine clears the
current interaction for them: `OpHeldHandler.ts:54-56` and `OpHeldUHandler.ts:57`
(`clearPendingAction`, which is `clearInteraction` + `closeModal`, `Player.ts:1027-1030`).
The bot therefore re-clicks the target every cycle. What that click does depends on the
first-click label, which now sees the clock 2 ticks ahead:

- **Continues at +2:** woodcutting (`woodcut.rs2:94-101`), mining's first swing
  (`mining.rs2:76-86`), fly and pike (`freshfish.rs2:37-52`, `102-117`), waterfall
  (`waterfall.rs2:14-29`) and lava eel (`lavafish.rs2:50-67`). The click goes in the same
  tick as the starter, and the continuation label rolls on R+3.
- **Stops at +2:** shrimp and sardine (`saltfish.rs2:37-56`, `101-120`), lobster
  (`rarefish.rs2:60-73`), swordfish/tuna (`rarefish.rs2:164-180`), mackerel and shark
  (`memberfish.rs2:30-45`, `102-117`), slimey eel (`slimeyfish.rs2:26-45`) and karambwanji
  (`tbwt.rs2:41-55`). These labels act only on an expired clock, on `+3`/`+4`, and on
  equality. So the click must land on R+3 itself, where the label rolls at once
  (`rarefish.rs2:70-72`). Measured: lobster with the click in the starter tick caught 13
  lobsters and lost the lock 53 times in 2,387 ticks.

**Why the knife uses no log.** Knife-on-logs runs `fletch_log`, which opens the
`skill_multi3` menu and pauses (`cut_logs.rs2:44-47`). The bot does not wait for the
menu: it sends the button blind in the same tick. Component 8889 is `skill_multi3:make1_a`,
"15 Arrow Shafts" (`server/content/pack/interface.pack:8890`). The server registered the
resume buttons when the script paused, so it accepts the button (`IfButtonHandler.ts:20,29-36`)
and `process_fletch_logs` writes the clock and weak-queues the fletch 2 ticks out
(`cut_logs.rs2:80-86`). The drop and re-click that follow in the same tick call
`closeModal`, which clears the weak queue (`Player.ts:817-820`), so the fletch never runs.
If a cycle slips and nothing follows the button, the fletch runs: one log becomes 15
arrow shafts, which stack.

## 3. Catalogue of `%action_delay` writers (read)

There are 170 writes in 44 files under `server/content/scripts/`. They fall into three
groups.

**Inventory-only writers (usable beside a tree, spot or rock):**

| Writer | Trigger | Write | Menu or dialog | Needs | Notes |
|---|---|---|---|---|---|
| `consume.rs2:115-131` (food, drinks, cakes, pies, pizzas, kebabs, beer, tea, jangerberries) | OPHELD1 (Eat/Drink) | `+= 3` (relative) | none | one bite per use; `%eat_delay` must have expired (`consume.rs2:122-127`; 2 ticks for most food) | Gnome food, karambwan, potions and the keg pass `null` and do not write (`consume.rs2:29-40`, `97-111`). Clears the interaction (`OpHeldHandler.ts:54-56`). |
| `cut_logs.rs2:80-86, 103` | knife on logs (OPHELDU), then a menu button | `= map_clock + 2` if expired | `skill_multi2/3` menu; a blind button in the same tick works | members, knife, logs; Fletching 1 for shafts | **Recommended.** No log used when the click follows (section 2). |
| `glass.rs2:85-111` | glassblowing pipe on molten glass, then an interface button | `= map_clock + 2` | glassblowing interface | Crafting, molten glass | Same pattern as the knife; not measured. |
| `leather.rs2:137-181` | needle on leather, then an interface button | `= map_clock + 2` | leather interface | Crafting, needle, thread, leather | Same pattern; not measured. |
| `firemaking.rs2:79-118`, `achey.rs2:11-51` | tinderbox on logs | `= map_clock + 3` if expired | none | logs, tinderbox | Drops and lights the log, then walks the player off the fire. No gain: +3 matches woodcutting's own reset. |
| `bullroarer.rs2:1-8` | OPHELD1 bullroarer (Legends' Quest) | `= map_clock` | none | the clock must have expired 8 ticks ago | Cannot follow a roll within 8 ticks. |

**Writers that need a loc, an NPC or combat (not usable mid-cycle):**

- Smelting (`smelting.rs2:158, 184, 205, 226`) and pottery (`pottery.rs2:84, 100, 132, 152`).
  These include the only `map_clock + 1` writes, but they run inside furnace and oven
  queues.
- Thieving stuns (`thieving.rs2:49`, `digsite_workman.rs2:79`).
- Every combat style, which writes `map_clock + attackrate` (`player_melee.rs2`,
  `player_ranged.rs2`, `player_magic.rs2`, specials, PvP, `auto_retaliate.rs2`,
  `chompy_bird.rs2:157`, `castlewars_maindoor.rs2:95-100`).

**The loops that read the clock (each also writes its own reset):** woodcutting
(`woodcut.rs2`, `jungle_tree.rs2`, `karam_dungeon.rs2` vines, `macro_event_ent.rs2`,
`tut_woodcut.rs2`), mining (`mining.rs2`, `castlewars_rocks.rs2`), every fishing script in
`skill_fishing/scripts/fishing_spots/`, weeding (`weed_herbs.rs2`), and the Mort'ton temple
and pyre (`flamtaer_temple.rs2`, `mortton_pyre.rs2`).

No writer outside this list touches the gathering loops; their only gate is the equality
check.

## 4. Measured cycles

All at level 99, 300 ms, stock client. "Gaps" are ticks between consecutive xp drops
inside one lock; gaps that span a re-bootstrap are excluded. A gap of 6 or 9 in a 3-tick
lock is a failed roll or a cycle that did not roll.

| Method | Technique | Sample | Gap histogram (ticks:count) | Ticks per xp drop | Notes |
|---|---|---|---|---|---|
| Fly, Barbarian Village | base | 100 drops, 90 gaps | 5:80 10:10 | 5.56 | |
| Fly | eat | 200 drops, 197 gaps | 3:165 6:21 9:8 5:1 15:1 19:1 | 3.72 | 3 lost locks |
| Fly | **knife** | 150 drops, 148 gaps | 3:121 6:18 9:8 19:1 | **3.80** | 1 lost lock; 10 of 10 logs kept |
| Fly, 100 ms | knife | 100 drops, 99 gaps | 3:82 6:9 9:6 12:1 15:1 | 3.85 | 6 logs became shafts (slips) |
| Fly, 100 ms | eat | 100 drops, 92 gaps | 3:62 6:15 9:5 20:4 others | 6.15 overall | 11 lost locks |
| Lobster, Catherby | base | 60 drops, 32 gaps | 6:19 12:13 | 8.44 | |
| Lobster | eat, click on R+3 | 100 drops, 97 gaps | 3:33 6:19 9:14 12:14 15:5 18:5 others | 8.81 | no gain |
| Lobster | **knife**, click on R+3 | 80 drops, 79 gaps | 3:34 6:19 9:11 12:8 15:2 18:3 27:1 36:1 | **7.06** | 0 lost locks; logs kept |
| Lobster | eat, click on R+1 | 13 drops | none | 199 | stops fishing (section 2) |
| Willow, Draynor | base | 80 drops, 75 gaps | 4:47 5:6 7:2 8:15 12:2 13:3 | 5.53 | combat stats 70 |
| Willow | eat | 200 drops, 163 gaps | 3:114 6:33 9:8 4:1 12:1 22:5 25:1 | 6.22 overall | 37 lost locks: tree depletion and NPC attacks (combat stats not raised) |
| Willow | **knife** | 150 drops, 131 gaps | 3:85 6:25 9:7 4:8 7:2 8:2 12:2 | **4.23** | combat stats 70; 18 lost locks, all tree depletion; 10 of 10 logs kept |

The willow runs only count with the bot's combat stats raised (`tickmanip-cycle.ts` sets
hitpoints, attack, strength and defence to 70). Without that, an NPC caster beside the
Draynor willows attacked the level-3 lab bot ("You feel weakened",
`npc_combat_magic.rs2:136`; most likely a dark wizard, inferred) and killed it within
about 40 ticks ("Oh dear you are dead!", respawn at 3221,3217) in all four early knife
runs. The eat runs hid this because every bite heals. Earlier 100 ms willow runs are left
out for the same reason.

Mining, `tickmanip-mine.ts`, rs/5's south-of-zoo cluster (mining.md section 4); "ticks per
ore" is from the sixth ore on:

| Respawn | Starter on each move | Ores | Gap histogram | Ticks per ore | Base xp per tick | Notes |
|---|---|---|---|---|---|---|
| 19 (quiet server) | none | 40 | 4:27 8:7 | 4.82 | 7.26 | |
| 19 | eat | 60 | 3:45 6:9 | 3.50 | 10.00 | every ore on its predicted tick |
| 19 | eat (second run) | 60 | 3:18 8:18 21:18 | 10.67 | 3.28 | 38 slips; see section 6 |
| 19 | **knife** | 60 | 3:45 6:9 | **3.50** | 10.00 | 0 slips; 10 of 10 logs kept |
| 13 (demo, emulated) | none | 40 | 4:26 8:8 | 4.94 | 7.08 | |
| 13 | eat | 80 | 3:72 7:1 9:1 | **3.14** | 11.16 | 79 of 80 on the predicted tick, 1 slip |
| 13, rs/53 | **knife**, rs/5's demo steps | 200 | 3:194 | **3.00** | 11.67 | 200 of 200 on the predicted tick, 0 slips; 10 of 10 logs kept |
| 13, rs/53 | **knife**, the planner's free-starter steps | 200 | 3:194 | **3.00** | 11.67 | the same; steps in mining.md section 4 |
| 13, rs/53 | adjacent-rock starter (`mining-rotation.ts`), same session | 200 | 3:75 4:113 6:1 | 3.61 | 9.69 | 200 of 200 rolls on the predicted tick |
| 19, rs/53 | knife (repeat on the #20 client) | 60 | 3:45 6:9 | 3.50 | 10.00 | 60 of 60 on the predicted tick, 0 slips |

For comparison, rs/5's adjacent-rock starter measured 3.84 (respawn 19) and 3.61 (respawn
13) on the same cluster; the rs/53 repeat at respawn 13 matched it exactly, so the knife's
gain at the demo's respawn is 3.61 -> 3.00, 17%. At respawn 19 the 6-rock lap takes 18 ticks, one short of the
respawn, so one move per lap waits 3 ticks (the 6:9 above). A 7-rock rotation should hold
3.00 (inferred, not run). At respawn 13 five rocks already hold 3.00, the floor, so more
rocks cannot help (the planner's `--free-starter` gives 2.99 for the 6-rock cluster). Respawn 13 was emulated by pinning `player_count.rs2` to
`min(1262, 2000)` locally; that file is not committed (mining.md section 4).

**No 2-tick Mining.** After a roll on R, the earliest write is on R+1 (a write processed on
R finds the clock equal and only delays that roll). A 2-tick cycle needs R+2 written on
R+1, so `map_clock + 1` or `+= 2`. The only `map_clock + 1` writers are smelting and
pottery queues at a furnace or oven, and no inventory writer adds less than 3 (section 3).
Stationary mining is already at the 3-tick floor with a rune pickaxe (inferred from read).

## 5. Bot sequence

R is the server tick of a roll. "On R+1" means processed on server tick R+1: the lite
client sends it while showing state tick R, before the roll's xp is visible (xp from R
appears in the state for R+1, mining.md section 4). The bot cannot react in time, so it
runs open-loop from its first click: an expired-clock click landing on C rolls on C+3
(woodcutting) or C+4 (fishing), and every later cycle is 3 ticks after that.

**Woodcutting, fly, pike, waterfall, lava eel** (one packet tick per cycle, 4 packets, within
the 5 user events per tick, `ClientGameProtCategory.ts:6`):

| On | Packets, in this order |
|---|---|
| R+1 | OPHELDU knife on logs; IF_BUTTON 8889; OPHELD5 drop one product (when the inventory needs it); OPLOC1 tree or OPNPC1 spot (the same target) |
| R+3 | roll; R+4 is the next R+1 |

**Lobster and the other stop-at-+2 methods** (two packet ticks per cycle):

| On | Packets |
|---|---|
| R+1 | OPHELDU knife on logs; IF_BUTTON 8889; OPHELD5 drop |
| R+3 | OPNPC1 spot (rolls at once) |

**Mining, moving to the next rock:**

| On | Packets |
|---|---|
| R+1 | OPHELDU knife on logs; IF_BUTTON 8889; OPHELD5 drop ore; MOVE_CLICK (run) to the next standing tile |
| so it lands by R+3 | OPLOC1 next rock: its first swing on R+2 or R+3 rolls on R+3 (`mining.rs2:76-86`) |

That covers moves of up to 4 tiles with run. On a stay (the same rock respawned, or a
non-depleting rock), skip the starter: the loop's own 3-tick reset is already the floor.
An inventory op clears the interaction but not the clock, so drops go in the same tick as
the next click and before it.

Recovery: if no xp arrives for a predicted roll, stop sending starters, let the clock
expire (about 5 ticks), and bootstrap again with one plain click. Both scripts implement
this (`resync` in `tickmanip-cycle.ts`, `SLIP` in `tickmanip-mine.ts`).

## 6. Interactions and failure modes

- **Supplies (knife):** knife and one normal log (2 slots) plus spares. A slipped cycle
  lets the fletch run and turns one log into 15 arrow shafts (Fletching xp, one stacking
  slot). Measured log use: 0 per 150 willow logs, 150 fly catches, 80 lobsters and 60 ores
  at 300 ms; 6 per 100 fly catches at 100 ms. Carry about 5 spare logs (inferred).
- **Supplies (eat):** one bite per cycle. Food does not stack. Cakes give 3 bites per slot
  (`consume.rs2:78-83`), pies and pizzas 2. 26 cakes last 78 cycles, about 234 ticks
  (inferred), so the eat starter needs constant restocking. It is not a sustained method.
- **Late packets:** the knife's absolute write absorbs a starter that lands a tick late:
  that roll is lost, but the next cycle is on time. The eat's relative write compounds the
  error: every first swing then finds the clock ahead, and nothing rolls until the bot
  resyncs. Measured on the same machine and session at respawn 19: knife 0 slips in 60
  ores, eat 38 slips in 60 ores.
- **Dropping:** drop one product per cycle in the starter tick, before the click. The drop
  clears the interaction but not the clock (`OpHeldHandler.ts:54-56`); every run above
  dropped this way.
- **Level-up dialog:** a level-up opens a chat dialog and pauses (`levelup.rs2:51-55`).
  The engine queue that opens it runs on R+1 after that tick's packets (`World.ts`
  `processPlayers`: queues, then the engine queue, then interactions), so the starter on
  R+1 is already in, and the dialog only blocks R+1's fishing op. Answered at once
  (`sendClickDialog(0)` sent on label R+1, landing on R+2), the roll on R+3 still runs.
  Measured with the knife at Lumbridge (rs/53, `tickmanip-cycle.ts --dismiss=now`): 0 of
  38 level-ups between 79 and 98 lost the lock, at a cost of about half a tick each, and 2
  of 67 from level 20 needed a re-anchor (one beside a spot move). A dismissal that came
  too late would cost one roll: the next starter's `closeModal` clears the dialog and the
  knife's absolute write puts the lock back on schedule (inferred, read). Details in
  fishing.md section 6.
- **Spot moves:** a fishing spot keeps its NPC index when it teleports, so watch its tile.
  Re-click the nearest spot and anchor the schedule on the first catch after it
  (`--reanchor=xp`); about 8-9 ticks lost per move (rs/53, 12 moves).
- **Host load:** the loops need every packet to land on its tick. On `local` at load
  average 100-130 (16 cores), state publications came 354 ms apart at the median (p90
  473) instead of 300, and 37 of 60 walk probes landed one or two ticks late
  (`tickmanip-latency.ts`). Knife iron at respawn 13 then measured 8.6-8.8 ticks per ore
  with every log fletched, the adjacent-rock rotation 14.3, and Lumbridge fly 78-99 7.7
  ticks per catch, all worse than not manipulating. The same scripts on a quiet host
  (load 2-6, 110 of 110 probes on time) gave the rows above. Probe the host before a timed
  run, and on the demo, before trusting a schedule.
- **Combat:** being attacked starts auto-retaliate, which replaces the gathering
  interaction and breaks the lock. Train where nothing aggressive reaches the account, or
  outlevel the local aggressors (measured at the Draynor willows, section 4).
- **Random events:** the first-click labels check `afk_event` (`woodcut.rs2:49-54`,
  `mining.rs2:64-67`, `freshfish.rs2:54-56`, `rarefish.rs2:74-76`); the continuation labels
  do not. Each player gets an event flag every 500 ticks with chance 1/24, or 1/12 while
  its area has not changed (`World.ts:146-148, 694-695`). The flag is live for anyone below
  staff level 2, or for everyone on a debug server (`PlayerOps.ts:1115-1118`; production
  sets `NODE_DEBUG=true`, `fly.toml:16`). A manipulating bot re-clicks every cycle, so it
  takes every event that is rolled, about one per 6,000-12,000 ticks (inferred); some are
  teleports (`macro_events.rs2:105-111`), and the woodcutting table includes a dryad and
  an ent (`macro_event_woodcutting.rs2:1-10`). The bot must handle them. None was
  identified in these runs; every early move to Lumbridge was a death (section 4).
- **Depletion:** willows deplete on 1 log in 8 (`woodcut.rs2:168, 184-188`), and the
  respawn scales with the player count. Each depletion costs a re-bootstrap (about 5 ticks
  plus the new tree's first 3-4 ticks).
- **100 ms labs:** packet timing differs from 300 ms (LAB.md). The eat starter lost far
  more locks at 100 ms. Trust the 300 ms numbers.

## 7. The fletch-menu path (cairn://p/rs/1)

rs/1 found that the client hang came from a malformed `sendInteractLoc(loc, 'chop')` call,
not from the menu. The well-formed `sendInteractLoc(x, z, id, op)` works with the menu
open (rs/1's PR). This branch uses only well-formed calls, and the knife path was
measured above at 300 ms without a hang. Every knife-cycle packet across the runs
succeeded; the only refusals were one `knife on logs` sent while the inventory was
shifting, and the packets in flight when each run's client disconnected at the end.

## 8. Open questions

- **Lobster:** with the knife, about 40% of 3-tick cycles produce no roll (0.425 xp drops
  per cycle against about 0.71 per roll at 99, from the base run). The click must land
  exactly on R+3, in a different tick from the starter, so latency jitter between the two
  sends is the likely cause (inferred). Logging the server's view of each click, or sending
  the click on R+2 and R+3 both, would settle it.
- **Level-ups** (settled by rs/53): the knife lock survives a level-up dialog answered at
  once; about half a tick each (section 6). Woodcutting and Mining level-ups with the knife
  were not run; the same tick order applies (inferred).
- **Respawn 13 with the knife** (settled by rs/53): 3.00 ticks per ore. Still open: a
  7-rock iron rotation at respawn 19 (planner: 3.00 ticks per ore).
- **Demo latency:** the loops assume the demo's round trip fits inside a 300 ms tick, as
  it did in the lab on a quiet host. `tickmanip-latency.ts` on a throwaway demo account
  would show whether it does.
- **Glassblowing and leather** as menu starters for accounts without a knife or logs: same
  pattern, not measured.
- **Fixed client (rs/22, #20):** run (rs/53): packet timing and cycles unchanged; xp
  appears a label earlier, which the executors now take as `--xplag` (section intro).
