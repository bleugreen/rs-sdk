# Tribal Totem (feasibility: not worth doing)

**Verdict: skip it.** The reward is 1,775 base Thieving, worth **about 150 ticks** on the
planned route (rs/2 `docs/speedrun/skills/thieving.md` section 2: with Fight Arena and
Biohazard already giving 3,425 base, Thieving to 99 drops from about 1,852 to 1,699 ticks,
`thieving-model.ts`, rs/2 branch at 0e184ef2; rs/26 is re-timing the knights at 300 ms).
The quest costs **about 300 ticks on the fixed client** (about 355 stock, about 280
burst; inferred from the scripts), because it starts and ends at Kangai Mau in Brimhaven
and the rest is in Ardougne: two ship rides and four teleports alone are about 100 ticks.
It loses by about 130-200.

Nothing was measured, following the coordinator's rule for candidates clearly above
their value (cairn://p/rs/3).

## Reward

- **1,775 base Thieving** and 5 swordfish (read, `quest_totem.rs2:159-164`).
- **1 quest point** (read, `quest.constant:123`).

## Requirements (as this server enforces them)

| Check | Where | Type |
|---|---|---|
| Thieving 21 to find the trap on Handelmort's stairs. Without it, "You don't find anything interesting", and climbing the trapped stairs drops you into a pit for 20% of your hitpoints + 1 with no progress | `quest_totem.rs2:120-132`, `:98-118` | `stat()`: a boost (e.g. a stew or tea) counts. The planned route has Thieving 57+ after Fight Arena anyway |
| The door combination lock: K-U-R-T (`quest_totem.rs2:39`; values 10, 20, 17, 19 in `alphabet.enum`). Horacio's hint ("his middle name") is optional: no varp | `quest_totem.rs2:36-46`, `horacio.rs2:15-22` | |
| Members world | the area | |

The label, the totem and the guide book are `tradeable=no` (`quest_totem.obj`).

## Route and counts (read; estimates)

Locations from the map data (`quest-smallskill-locate.ts`): Kangai Mau (2791,3182) in
Brimhaven; the RPDT depot in East Ardougne with the horn crate (2650,3273), the delivery
crate (2650,3271) and the employees (2644-2647, 3271-3276); Wizard Cromperty (2683,3326);
Handelmort Mansion, where Cromperty's teleport lands you at (2638,3321) once the crate is
delivered (`wizard_cromperty.rs2:66-81`); the combination door (2634,3323), the trapped
stairs (2631,3322) and the chest upstairs (2638,3324).

| # | Step | Varp | Raw counts | Ticks fixed (est.) |
|---|---|---|---|---|
| 0 | Trade (teleport runes, ship fares) | | 1 trade | 5 |
| 1 | Ardougne teleport, run to Captain Barnaby, ship to Brimhaven, run to Kangai Mau | | 1 cast, ~40 + ~55 tiles, 1 ship | 4 + 20 + 22 + 28 = 74 |
| 2 | Kangai Mau: "I'm in search of adventure!", "Ok, I will get it back." (`kangai_mau.rs2:16-54`) | 0 → 1 | 7 pages, 2 options | 10 |
| 3 | Ardougne teleport, run to the RPDT depot; search the horn crate for the label (`quest_totem.rs2:8-17`); use it on the delivery crate (`:19-32`) | 1 → 2 | 1 cast, ~30 tiles, 3 pages, 2 interactions | 4 + 15 + 7 = 26 |
| 4 | RPDT employee: "So, when are you going to deliver this crate?" (`rdpt_employee.rs2:1-15`) | 2 → 3 | 3 pages, 1 option | 5 |
| 5 | Run to Cromperty: "So what have you invented?", "Can I be teleported please?", "Yes, that sounds good. Teleport me!"; `p_delay(4)` and the jump into the mansion | 3 → 4 | ~60 tiles, 7 pages, 3 options | 30 + 11 + 6 = 47 |
| 6 | Combination door: 4 locks, 32 button clicks from A-A-A-A to K-U-R-T by the shortest direction (10 up, 6 down, 9 down, 7 down) and Enter; then through | | 33 buttons, 1 door | 8-35 (5 buttons per tick if sent blind, 1 per tick if each is read) |
| 7 | Stairs: search (Thieving 21; `p_walk` and `p_delay`, mesbox), then climb (`quest_totem.rs2:98-132`) | | 2 interactions, 1 page | 10 |
| 8 | Upstairs: open the chest, search: the totem (`quest_totem.rs2:134-146`) | | ~8 tiles, 2 interactions, 1 page | 8 |
| 9 | Ardougne teleport (the totem survives it; `~post_tele_checks` only removes rum, the plague sample, the monkey and trial items, `primitives.md` section 4), run to Barnaby, ship, run to Kangai Mau | | 1 cast, ~40 + ~55 tiles, 1 ship | 74 |
| 10 | Kangai Mau: hand over the totem, quest complete (`kangai_mau.rs2:66-74`) | 4 → 5 | 4 pages | 5 |
| | **Total** | | ~30 clicks, ~290 tiles, 2 ships, 4 casts | **~270-300** |

Columns: about **355 stock**, **300 fixed** (with the lock clicked one per tick),
**280 burst** (lock sent blind, bursts on Kangai Mau and Cromperty). All inferred.

The glory's Karamja teleport is no shortcut: Brimhaven's Kangai Mau is about 120 tiles from
the Karamja side, more than the ship (inferred from the coordinates).

## Marginal value

| Basis | Ticks saved | Source |
|---|---|---|
| Given Fight Arena + Biohazard (the planned route) | **~150** (1,852 → 1,699) | rs/2 `thieving.md` section 2 totals table, model, rs/2 branch at 0e184ef2 |
| With Hazeel Cult too | ~270 for both together | same table (1,852 → 1,583) |

## Risks and gotchas

- **The trapped stairs.** Climbing before searching drops you in the dungeon below for
  20% of max hitpoints + 1 (`quest_totem.rs2:110-118`) and you must walk back.
- The lock resets to A-A-A-A every time the interface opens (`quest_totem.rs2:60-65`).
- Logout-safe: `%totemquest` and `%handelmort_traps_disabled` are `scope=perm`
  (`quest_totem.varp`).

## Open questions

None that affect the verdict.
