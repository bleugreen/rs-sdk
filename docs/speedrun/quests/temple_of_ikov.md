# Temple of Ikov (feasibility: not worth doing)

**Verdict: skip it.** The reward is 10,500 base Ranged and 8,000 base Fletching.
Under the plan's skill model, that is worth **at most about 50 ticks**. Ranged comes
alongside melee from the dwarf multicannon, so the Ranged xp replaces nothing, and
all of Fletching 1→99 takes about 48 ticks (inferred,
cairn://p/rs/main/task/per-skill). The quest costs about **750 ticks** (inferred,
range 550-1,000), so it loses by more than ten times.

The two endings give **identical rewards** (read, `quest_ikov.rs2:60-76`). The
Lucien ending is a little shorter (about 20 ticks, inferred); see Endings.

Nothing was measured. The verdict doesn't depend on any uncertain segment: even if
the dungeon cost nothing, getting to Lucien, the temple and back to Lucien is
about 380 route tiles (190 ticks) plus about 30 dialogue clicks, already about
five times the value.

## Reward

- 10,500 base Ranged and 8,000 base Fletching: `stat_advance(ranged, 105000)` and
  `stat_advance(fletching, 80000)`, the same in both endings (read,
  `quest_ikov.rs2:62-63` for Armadyl, `:73-74` for Lucien; tenths, multiplied 25x).
- 1 quest point (read, `general/configs/quest.constant:103`).
- Final stage `%ikov` = 80 (Armadyl) or 90 (Lucien) (`quest.constant:35-36`).

### What it is worth

| Part | Ticks replaced | Basis |
|---|---|---|
| 8,000 Fletching | at most ~48 (all of 1→99); about 9 at the top-end rate of ~940 base/tick | inferred, per-skill model |
| 10,500 Ranged | ~0 if Ranged comes from the cannon in parallel with melee | inferred, per-skill model |
| 10,500 Ranged, if trained alone with rune knives instead (~16 base/tick) | ~650 | inferred, per-skill model |
| 1 quest point | see `knights_sword.md` for the per-point comparison | |

So it is worth about 10-50 ticks on the current plan. Only if Ranged were trained
without the cannon would it come near break-even (about 700 against about 750).

## Requirements (as this server enforces them)

| Check | Where | Type |
|---|---|---|
| Thieving 42 to find and disable the trap on the lever. Pulling without it drops you into a pit for 20 damage and doesn't advance the quest. | `ikov_dungeon.rs2:155-165`, `:133-153` | `stat()` (boostable) |
| A lit light source for the dark stairs (else a dead end) | `ikov_dungeon.rs2:3-10` | |
| Pendant of Lucien **worn** to open the Chamber of Fear doors | `ikov_dungeon.rs2:15-23` | |
| Boots of lightness **worn**, and total weight below 0, to cross the lava bridge; otherwise 20 damage and you are put back | `ikov_dungeon.rs2:36-82`, boots weigh −10 lb worn (`quest_ikov.obj`) | |
| The lever piece fitted to its bracket and pulled to open the south gate | `ikov_dungeon.rs2:25-34,87-110` | |
| **Ice arrows worn with a ranged style** to damage the Fire Warrior; melee, magic and the cannon do nothing | `npc_combat.rs2:169,259`, `cannon_fire.rs2:97` | |
| A bow the account can wield | `levelrequire/` | `stat_base(ranged)` by bow tier |
| 20 limpwurt roots for Winelda | `winelda.rs2:4-12` | |
| Members world (Lucien's second appearance and the attack checks test `map_members`) | `lucien.rs2:24`, `quest_ikov.rs2:20,26` | |

The wiki's Ranged 40 is not enforced (read: no `ice_arrow` check under
`levelrequire/`). The only Ranged gate is the bow's wield level.

Items: ice arrows, the lever piece, the staff, the shiny key, both pendants and
the boots are all untradeable (`quest_ikov.obj`). Helper-supplied: a lit light
source, a bow, 20 limpwurt roots, teleport runes and food.

## Route and step counts (read; estimates)

Locations from the map data: Lucien first at (2573,3321) in East Ardougne; the
temple trapdoor near Hemenster at (2637,3408); the dungeon at about
(2630-2750, 9740-9912); Lucien finally at (3176,3476), north of Varrock. Route
tiles from `quest-wtikov-routes.ts`.

| # | Step | Varp | Raw counts | Ticks (est.) |
|---|---|---|---|---|
| 0 | Trade with a helper | | 1 trade | 9 |
| 1 | Ardougne teleport (Magic 51 and Plague City), run to Lucien | | 98 tiles | 53 |
| 2 | Lucien: "I'm a mighty hero!", "That sounds like a laugh!"; pendant (`lucien.rs2:49-72`) | 0 → 10 | 11 pages, 2 options | 26 |
| 3 | Run to the temple trapdoor, climb down | | 112 tiles, 1 climb | 58 |
| 4 | Dark stairs down with a light; boots of lightness; stairs back up (`ikov_dungeon.rs2:3-10,84-85`) | | ~40 tiles, 2 climbs, 1 pickup | 30 |
| 5 | Lever piece (2637,9819) to its bracket (2671,9804) and pull, `p_delay(0)` ×4 (`ikov_dungeon.rs2:87-110`) | `%ikov_dungeon` lever | ~60 tiles, 2 mesboxes, 3 interactions | 50 |
| 6 | Pendant on; across the lava bridge with the boots on and light inventory; trap lever: search (Thieving 42), then pull (`ikov_dungeon.rs2:133-165`) | 10 → 20 → 30 | ~60 tiles, 1 mesbox, 2 interactions | 45 |
| 7 | Ice arrows: open and search the chests at (2710-2747, 9821-9850) until the random one pays out, 1-5 arrows each time; repeat for enough arrows (`quest_ikov.rs2:9-17`, `ikov_dungeon.rs2:112-131`) | | ~150-300 tiles, ~10-20 chest interactions, ~4-6 objboxes | 120-250 |
| 8 | Fire Warrior: open his door (scripted spawn, about 8 ticks of `p_delay`), kill him with worn ice arrows (level 84, 59 hp, Defence 78, ranged defence +35) (`ikov_dungeon.rs2:177-219`) | 30 → 40 | fight | 40-80 |
| 9 | Winelda: "Yes I do!", then 20 roots; she teleports you over, `p_delay(0,2,3,2)` (`winelda.rs2`) | 40 → 50 → 60 | 14 pages, 1 option, ~12 tiles | 45 |
| 10 | Ending (below) | 60 → 80 or 90 | | 40-60 |
| 11 | Out of the dungeon; Varrock teleport; run to Lucien | | ~150 tiles + 169 tiles, 1 teleport | 165 |

**Total: about 750 ticks** (range 550-1,000): about 410 walking, 75 dialogue,
120-250 ice arrows, 40-80 Fire Warrior, and the rest climbs, waits and the trade.
With the client fix, dialogue drops by about 35.

## Endings

Both end at Lucien north of Varrock, and both give the same xp and quest point.

- **Lucien (stage 90).** Take the staff (2638,9906). The pickup is refused while a
  guardian of Armadyl is within 5 tiles in line of sight, and that guardian
  attacks (`quest_ikov.rs2:37-58`). The female guardian at (2636,9910) is 4 tiles
  from the staff, so kill her first (level 43, 40 hp; trivial at 70 melee, about
  10-15 ticks) or wait for her to wander. Then give the staff to Lucien: about 7
  pages and 1 option (`lucien.rs2:23-47`). **About 40 ticks.**
- **Armadyl (stage 80).** Take the Lucien pendant off first: the guardians attack
  anyone wearing it (`guardian_of_armadyl.rs2:20-24`). The shortest branch to
  "Ok! I'll help!" ("I seek the Staff of Armadyl.", "Lucien will give me a grand
  reward for it!", "You're right, it's time for my yearly bath.", "Ok! I'll
  help!") is about 18 pages and 4 options. Then put on the Armadyl pendant and
  kill Lucien (level 14, 17 hp), and his `ai_queue3` hands the completion to a
  queue (`lucien.rs2:108-122`). **About 60 ticks.**

The Lucien ending is about 20 ticks cheaper (inferred).

## Risks and gotchas

- **The ice arrow hunt is random.** One of six chests holds 1-5 arrows, and the
  location moves to a new random chest after each find (`quest_ikov.rs2:9-17`).
  The arrow count depends on the Ranged level and bow, and arrows can be picked
  back up after the fight.
- **The lava bridge checks weight.** Anything that brings the total to 0 or more
  sends you into the lava for 20 damage (`ikov_dungeon.rs2:58-82`). The worn boots
  give −10 lb, so carry little.
- **Lucien's death hook** uses `npc_findhero` and `npc_finduid` across queues
  (`lucien.rs2:108-122`), the pattern that dropped a stage once for the Holy
  Grail child. Only the Armadyl ending relies on it.
- **Logout-safe.** `%ikov`, `%ikov_dungeon` and `%ikov_icearrowchest_coord` are
  `scope=perm` (`quest_ikov.varp`).

## Open questions

None that affect the verdict. If Ranged ever leaves the cannon plan, re-check
this quest: then its value (about 700) comes near its cost.

## Scripts

`docs/speedrun/scripts/quest-wtikov-routes.ts` (route lengths, the `# Temple of
Ikov` section).
