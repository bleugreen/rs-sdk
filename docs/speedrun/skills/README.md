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

Ticks are playtime on the scored account at production's 300 ms ticks, counting only
that skill's own training (quest playtime lives in `docs/speedrun/quests/`). Each row
starts from the level the **planned quest route** (cairn://p/rs/3) leaves the skill at.
Every skill document also gives ticks from level 1 and from other quest sets. "With
tick manipulation" means the knife-on-logs starter ([tick-manipulation.md](tick-manipulation.md)).

### Self-only skills

| Skill | Headline method | Start level (on-route quests) | Ticks to 99, normal | Ticks to 99, with tick manipulation | Basis | Helper supplies | Document |
|---|---|---|---|---|---|---|---|
| Agility | Gnome course to 22 plus an Agility potion for Grand Tree's level-25 check (122 ticks), then the Wilderness course 75 -> 99 | 75 (Grand Tree, 7,900 base) | **about 4,024** + 122 before the quest (66-tick laps measured with 1-tick latency, the direct path the run uses for obstacles); 4,512 at the 74-tick lap implied by relay latency from home | n/a (no gathering clock) | Lap measured at 300 ms on bbs, fixed lite client (`agility-course.ts`, 9 of 9 clean laps); totals inferred (`agility-model.ts --lap=N`) | 1 Agility potion; about 10-12 sharks | [agility.md](agility.md) |
| Mining | Doric's Quest, then iron with a rune pickaxe on the six-rock cluster south of the Ardougne zoo, on a planned rotation | 49 (Doric's Quest, 1,300) | **about 4,034** (adjacent-rock starter, 3.61 ticks per ore) | **about 3,360** (knife, 3.00 ticks per ore) | Rates measured at 300 ms with the demo's respawn 13 emulated (`mining-rotation.ts`, `tickmanip-mine.ts`, 200+ ores each, bgsrv-mac); totals inferred (`mining-model.ts`) | Doric's items (6 clay, 4 copper ore, 2 iron ore); rune pickaxe; knife and about 5 normal logs | [mining.md](mining.md) |
| Woodcutting | Rune axe from level 1: normal trees to 15, oaks 15-73 (Taverley, 2914,3494), willows 73-99 | 1 (no Woodcutting quest on the route) | **about 3,958** | **about 3,028** | Cadence measured by engine trace at 300 ms (5,000+ rolls); totals inferred (`woodcutting-model.ts`); knife ratio 0.765 measured on willows (`tickmanip-cycle.ts`) | Rune axe; knife and 1 normal log | [woodcutting.md](woodcutting.md) |
| Fishing | Fly fishing at the Lumbridge river, dropping each catch on the tick after it | 78 (Sea Slug 7,175 + Fishing Contest 2,437) | **about 3,410** | **about 2,000** (2,032 and 1,978 in two runs) | Measured segments at 300 ms (`fishing-rate.ts`, 673 catches; `tickmanip-cycle.ts`, two runs from 9,612 base) | Fly fishing rod; about 520 feathers; knife and 1 normal log | [fishing.md](fishing.md) |
| Thieving | Knights of Ardougne in the East Ardougne market, clicking every tick | 57 (Fight Arena, 2,175) | **about 1,950-2,000** | n/a (no gathering clock) | 55 -> 99 measured end to end: 1,999 ticks at 300 ms on bbs (1 run), 2,176-2,226 at 100 ms (3 runs); the 57 start is from `thieving-model.ts` | About 20 sharks | [thieving.md](thieving.md) |
| **Total** | | | **about 17,520** | **about 14,510** | Sum of the rows (Agility at 66-tick laps plus its 122 pre-quest ticks; Thieving at 1,975) | | |

The tick-manipulation column saves about 3,010 ticks: Fishing about 1,410, Woodcutting
about 930, Mining about 670. Every figure in this table is a direct-path figure (reactions
land on the next tick), which is how the run drives its reactive loops; driven through the
SDK relay, the knife measured no gain on the demo. See the first open question.

Decisions this table rests on:

- **Quest picks.** Neither Tourist Trap nor Legends is on the planned route, so no
  reward choice is allocated. If Tourist Trap were done, both of its picks would go to
  Agility (about 1,360 ticks saved on top of Grand Tree at 74-tick laps; each pick saves
  more there than on Thieving). That is still less than the quest's 1,430-1,830 ticks
  (`docs/speedrun/quests/tourist_trap.md`).
- **Quests rejected for these skills' xp**, each with its saving against its own
  playtime: Digsite (Mining, a net loss of about 570, [mining.md](mining.md) section 3);
  the troll chain, the Regicide chain and Fremennik Trials (Agility and others,
  [agility.md](agility.md) section 1); Monk's Friend (Woodcutting saves 301 against 325;
  [woodcutting.md](woodcutting.md) section 3); Hazeel Cult and Tribal Totem (Thieving;
  [thieving.md](thieving.md) section 1); Heroes' Quest (off the route on quest points).
- **Provisional:** Plague City (2,425 Mining) is judged on its Ardougne teleport. With
  it, Mining is about 3,134 with the knife and 3,765 without.
- **Ordering:** Sea Slug checks Firemaking 30 (`quest_seaslug.rs2:43`), so it comes after
  the helper-fed Firemaking training passes 30.

### Item-fed skills

The other skills, those fed by helper-supplied items, are owned by cairn://p/rs/28. They
add their rows here in the same columns, except that column 5 is "Ticks to 99, with
interleaving (net)": item-fed actions done inside self-only training ticks. Interleaving
and the knife starter compete for the same ticks, the same 5 user-event packets per tick
(`ClientGameProtCategory.ts:6`) and the same inventory, so each interleaved row names the
self-only loop it rides on. Do not add an interleaving saving to a knife-column total
unless that row says it fits the knife loop.

## Open questions

1. **Tick manipulation on the demo server.** The knife loops need each reaction to land on
   the next tick. A paired sample from Azure eastus (Ashburn) on 2026-10-21 (cairn://p/rs/86,
   about 1,655 online, TCP 2 ms to the demo) separates the two paths. Reactions issued
   in-process on the engine websocket landed 60 of 60 on the next tick. The same runner
   through a private loopback gateway and the lite client landed 32 at 1 tick and 28 at 2.
   So the **SDK relay costs a tick about half the time on any host**, the earlier Ashburn
   reading of 51 of 60 was a lucky draw through the relay, and the server's tick does not
   overrun at that player count. From bbs through the relay, none of 60 landed at 1 (25 at
   2, 35 at 3).

   **Decision (cairn://p/rs/main):** in the scored run the reactive loops (the knife loops,
   the pickpocket re-click, Agility obstacles) run as in-page tick programs in the browser
   webclient (cairn://p/rs/82), and the SDK drives only the non-reactive steps. Every lab
   figure in these documents was taken with 1-tick reactions, so it is a direct-path
   figure and applies to that setup. Do not plan a relay-driven knife loop on the demo.
   Before the run, probe the direct path on the run machine at the actual player count:
   it must read 60 of 60 at 1 tick (floor 58). The path-aware probe is cairn://p/rs/96.

   **Relay fallback**, if the run ever has to drive the loops through the SDK: a late
   starter costs about one plain cycle and does not lose the lock (read in
   `cut_logs.rs2:83-85`; measured by holding 15% of starters one tick: willows 5.76 ticks
   per log against 5.03 on time and 5.84 plain, fly 4.92 against 3.86 and 6.61, iron 3.51
   against 3.53; [tick-manipulation.md](tick-manipulation.md), "Run-time host gate"). So
   the knife beats plain when the share of packets at the dominant latency exceeds about
   0.75 for Woodcutting, 0.60 for fly fishing and 0.39 for iron (inferred). Measured on the
   demo from bbs through the relay (throwaway account, normal trees, 5 rounds x 20 logs per
   condition): 70% of 480 probe trials at the dominant 2 ticks, and the forced knife read
   5.44 ticks per expected roll against 5.67 plain, within noise. The relay gate
   (`speedrun/lib/hostgate.ts`, cairn://p/rs/62) keeps the knife off there, so a
   relay-driven run cannot do worse than the normal column.
2. **Browser client.** All figures are on the headless lite client. The run drives the
   browser webclient, which froze under rapid-fire input in this lab and lacks the #20
   tick-publication fix. Main's cairn://p/rs/82 is porting the fix and proving the knife
   loops and the 2-tick pickpocket in a visible tab ([../LAB.md](../LAB.md), "Which
   client a number was taken on").
3. **Reactions cost more through the relay.** Agility pays one latency per obstacle: 66
   ticks per lap at 1-tick latency (the direct path, which the run uses for obstacles), about
   74 through the relay from home (inferred). The same applies to level-up dismissals, re-clicks after a felled tree or
   a stun, and drops. Main's sendClickDialog(0, {blind:true}) (rs/51) is the likely fix
   for level-ups; [woodcutting.md](woodcutting.md) measured 5 ticks per level-up against
   the 1 it models.
4. **Population on the day.** Rocks and trees respawn faster with more players online
   (`server/content/scripts/general/scripts/player_count.rs2:1-4`, capped at 2,000).
   Mining and Woodcutting are costed at about 1,260 online (iron respawn 13, oak 20). At a
   quiet hour, Mining without the knife rises from about 4,034 to about 4,288 and
   Woodcutting from about 3,958 to about 4,001. Fishing spots and knights do not scale.
5. **Contention with other players.** Rocks and trees deplete, so another player on the
   zoo cluster or the Taverley oaks takes ores and logs from the rotation. Mining and
   Woodcutting are exposed. Second sites: the six-rock iron cluster north of East
   Ardougne (2710-2715, 3328-3332; planner 3.74 ticks per ore at respawn 13, measured
   4.02-4.12 at respawn 19 without a starter; [mining.md](mining.md) section 4). The
   Wilderness eight-rock cluster looks faster on paper but is in level-31 Wilderness and
   its lab run stalled. For Woodcutting, the second oak and willow tiles are in
   [woodcutting.md](woodcutting.md) section 6. Fishing spots never deplete (they move on
   a timer, `fishing_movement.rs2:8-12`), and nothing in `thieving.rs2` reserves a knight
   (read, content only; engine-level interaction rules not checked), so Fishing and
   Thieving should tolerate company. Fallback fly site: Barbarian Village, 9.34 base xp per
   tick against Lumbridge's 9.83. Budget a few hundred ticks for one move to a second
   site in Mining or Woodcutting (inferred).
6. **Modelled, not measured end to end:** Mining below level 63 (about 300 ticks of the
   route); the Woodcutting oak band 15-73; Agility's 75 -> 99 total, from the measured lap
   with modelled falls; Thieving 57 -> 99, from the model with the 55 -> 99 runs as checks.
7. **Hazards.** The Wilderness course is at Wilderness levels 50-56, open to player
   killers ([agility.md](agility.md) section 6). Dark wizards near the Draynor willows
   kill a low-combat account quickly ([woodcutting.md](woodcutting.md) section 6). The
   knife loops re-click every cycle, which consumes rolled random events; random events
   are off on production (`fly.toml`).
8. **Lab hosts.** The Mac ran at load 11-18 (and far higher at times) on the night these
   numbers were taken, so figures measured there read a few percent pessimistic; bbs and
   bgsrv-mac were quiet ([../LAB.md](../LAB.md)).

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
