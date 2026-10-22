# chest: blood runes from the Chaos Druid Tower basement

Role module: `speedrun/helpers/chest.ts` (cairn://p/rs/372). It loots the two blood-rune trapped chests under the Chaos Druid Tower in North Ardougne, banks at the East Ardougne north bank, and runs until stopped (or until `target` blood runes were gained over the assignment).

## The content

- **Chests.** `trapped_chest.dbrow` row `trapped_chest_chest_blood_runes`: Thieving 59, 2 blood runes and 500 coins per search, 2,500 Thieving xp. The map (`maps/m40_152.jm2`, loc 2569 `chest_blood_runes`) has two of them, at (2586, 9734) and (2586, 9737) in the tower's basement. They are world-global: a searched chest becomes the looted loc 2572 for everyone.
- **Respawn.** `400 * (4000 - playercount) / 4000` ticks (`~scale_by_playercount`), so about 390 on the demo. At the demo's measured ~0.31 s per tick that is about 2 minutes.
- **Search, never Open.** Op2 ("Search for traps") disarms and loots. Op1 ("Open") only springs the trap for damage. After the loot, a "second magical trap" (`tele_coord`) teleports the player to (2584, 3337) in East Ardougne, so every loot is followed by a walk back.
- **The way in.** The tower door at (2565, 3356) is locked from outside (`locked_door.dbrow` loc_2554: Pick Lock at Thieving 46, `stat_random` 8-75 of 256, about 29% a try at 99, and no delay after a failure). Then the cellar ladder at (2562, 3356), then about 30 tiles through the cave. The druids upstairs do not hunt.
- **Who may go.** The cave holds seven ogres (level 53, three within two tiles of the chests) and five bats (27), all on the `cowardly` hunt. `Npc.ts` skips a player whose combat level is above twice the NPC's (`check_nottoostrong`), so a **combat-107+** account is never attacked there, and a 10-Hitpoint coin earner would be killed. The role measures the account's combat level with the engine's formula and refuses to run below `minCombat` (it logs `refused` and idles, rather than throw into a restart loop).

## The loop

`planStep` decides from a snapshot: away from Ardougne, travel (through Taverley when east of White Wolf Mountain); on the surface, bank once `bankAt` blood runes are carried, else pick the door; inside the tower, climb down; in the cave, search the nearest ready chest, walk until both chests are in view, or wait beside them for a respawn. Chest state is read from the published locs (2569 ready, 2572/2574 looted), never estimated, so a chest that another player took shows up as `chest taken by someone else` in the log.

One account keeps both chests cycling: the walk back (measured 63 ticks, landing to the next search) is well inside the respawn, so the account loots chest A, walks back, loots chest B, walks back, and waits for A. A second account adds nothing unless other players are taking chests.

## Options

| Option | Default | Meaning |
|---|---|---|
| `bankAt` | 40 | carried blood runes that send the player to the bank after a loot (a death keeps one unit of a stack) |
| `keepCoins` | 1000 | coins left in the inventory after banking |
| `target` | 0 | finish once this many blood runes were gained over the assignment (kept in role state); 0 runs on |
| `minCombat` | 107 | refuse below this combat level |
| `reportTicks` | 1000 | ticks between `progress` lines (opens, blood, blood per hour, taken by others, ms per tick) |

## Measured (demo)

First run: cairn_h47 (Thieving 99, combat 111), 2026-10-22, outside the fleet from a dev copy (`standalone.ts`, unit `rs-372-h47`). Varrock west bank to the tower door: 557 ticks. Door picked on the first try or two, ladder 1 click, search 13-16 ticks from the click (walk to the chest included), walk back from the landing to the next search 55-63 ticks.

| Measure | Value |
|---|---|
| First 16 minutes | 24 opens, 48 blood runes, 12,000 gp, 0 chests taken by other players |
| Pair period (one open per chest) | ~244 ticks, i.e. a respawn scaled by about 1,500 players in the world |
| Steady state | 4 blood runes per ~81 s, **~175 per hour** (the role's own `bloodPerHour`, travel included: 142 after 17 minutes) |
| Tick length | 0.31-0.34 s |
| Bank detour (every 40 runes) | ~30 ticks |

The rate follows the world's player count: at a quiet world the respawn is the full ~400 ticks, about 115 runes per hour.
