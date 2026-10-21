# Self-only skills: fastest routes to 99

The scored account must train Agility, Mining, Woodcutting, Fishing and Thieving
itself; helpers can only hand it items. These five dominate total playtime
(ticks logged in, 300 ms each on production). This directory holds one route
document per skill plus this summary.

- [agility.md](agility.md)
- [mining.md](mining.md)
- [woodcutting.md](woodcutting.md)
- [fishing.md](fishing.md)
- [thieving.md](thieving.md)
- [tick-manipulation.md](tick-manipulation.md) (shared by the gathering skills)

Lab setup and measurement conventions: [../LAB.md](../LAB.md). Measurement
scripts: [../scripts/](../scripts/).

## Summary

_Filled in once every skill document has landed._

| Skill | Route (level bands) | Quest xp assumed (base) | Ticks 1 -> 99 | Ticks post-quest -> 99 | Basis |
|---|---|---|---|---|---|

## Conventions

### Labels

Every number carries one of:

- **read**: taken from source, cited as `file:line` (content under
  `server/content/`, engine under `server/engine/src/`).
- **measured**: observed on a local server, naming the script under
  `docs/speedrun/scripts/` and the sample size (e.g. "measured,
  `mining-cycle.ts`, 200 ores").
- **inferred**: derived from read or measured numbers; show the arithmetic or the
  model and its assumptions.

### Units

- **Base xp** is the xp a script awards before the server multiplier. Content
  scripts award xp in tenths (`stat_advance(woodcutting, 675)` is 67.5 base).
  The server multiplies everything by 25 (`NODE_XPRATE`,
  `server/engine/src/util/WorldConfig.ts:102`; quest rewards included), so game
  xp = base x 25.
- **Ticks** are server ticks. Never report seconds; local labs run at 100 ms and
  production at 300 ms.

### Level table (computed from `server/engine/src/engine/entity/Player.ts:77-85`)

The curve uses `2^(level/10)` rather than RuneScape's `2^(level/7)`.

| Level | Base xp | Level | Base xp | Level | Base xp |
|---|---|---|---|---|---|
| 10 | 39.2 | 57 | 2,143.7 | 91 | 22,932.4 |
| 20 | 124.2 | 60 | 2,647.7 | 92 | 24,579.6 |
| 30 | 293.8 | 65 | 3,758.8 | 93 | 26,344.9 |
| 40 | 631.6 | 70 | 5,329.2 | 94 | 28,236.8 |
| 50 | 1,304.8 | 75 | 7,548.9 | 95 | 30,264.5 |
| 52 | 1,504.6 | 80 | 10,686.8 | 96 | 32,437.7 |
| 55 | 1,861.4 | 85 | 15,123.1 | 97 | 34,766.8 |
|  |  | 90 | 21,395.5 | 98 | 37,263.0 |
|  |  |  |  | 99 | 39,938.3 |

Half of the xp to 99 lies above level 93, so the rate at high levels decides
each skill.

### Per-skill document template

Each `<skill>.md` uses these sections, in this order:

1. **Recommendation**: the route in one paragraph and its tick total.
2. **Route by level band**: a table with level band, method, location
   (coordinates), unlock (level/quest/item), base xp per action, ticks per
   action, success rate, base xp per tick (measured where possible), and ticks
   for the band.
3. **Quest xp**: which quest rewards feed this skill, their base xp (read), and
   the starting level they give. Quest durations belong to
   `docs/speedrun/quests/`; report ticks both from level 1 and from the
   post-quest level so the plans can be combined.
4. **Mechanics**: the scripts and engine rules that set the cycle (cited), and
   what was measured to confirm them.
5. **Alternatives considered**: methods that lose, and by how much.
6. **Gotchas**: level-up dialogs, inventory-full handling, hostile NPCs,
   damage and food, depletion and respawn, travel.
7. **Helper supply list**: every item the helpers must hand over, with counts.
8. **Open questions**: what was not settled and what would settle it.
