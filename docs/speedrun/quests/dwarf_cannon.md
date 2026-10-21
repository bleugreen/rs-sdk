# Dwarf Cannon (the multicannon unlock)

**About 1,080 ticks on today's client (about 980 with the dialogue fix, about 920
with dialogue bursts) for 750 base Crafting, 1 quest point and the right to set up
a multicannon. There is no shortcut: the set-up
checks for the completed quest, stage 11.** Half the time is walking (about 930
route tiles); the railings are the variable part, a Crafting roll at about 14
ticks a try (44% success at Crafting 60, 59% at 99). The cannon itself, the
cannonballs and the parts are tradeable, but only a player who has done the quest
can buy or make them, so the helper who supplies them needs the quest too (helper
time is free).

All ticks are stock-client figures at the production tick rate (lab at
`NODE_TICKRATE=300`), measured with `docs/speedrun/scripts/quest-mcannon-run.ts`
(the quest) and `quest-mcannon-setup.ts` (set-up and firing), unless labelled
otherwise. The quest also ran end to end three times in a 100 ms lab (1,039 ticks
with 10 railing tries; the segments agreed with the 300 ms run to within a few
ticks).

## Reward

- **750 base Crafting**: `stat_advance(crafting, 7500)` (read,
  `quest_mcannon/scripts/quest_mcannon.rs2:25`). Measured: Crafting went from
  66,193 to 85,063 game xp, which is 18,750 for the quest (= 750 × 25) plus 120
  for the four cannon repairs (`stat_advance(crafting, 12)` each,
  `mcannon_broken_cannon.rs2:70`).
- 1 quest point (read, `general/configs/quest.constant:110`; the scroll shows a
  cannonball model, `quest_mcannon.rs2:27`; no items are given).
- **The multicannon unlock.** `[opheld1,twpart1]` (Set-up on the cannon base)
  refuses with "You can't set up this cannon. You need to complete the Dwarf
  Cannon quest." while `%mcannon < ^mcannon_complete` (read,
  `cannon_setup.rs2:52-56`; `^mcannon_complete = 11`, `quest.constant:43`).
  Measured: refused at `%mcannon = 10`, accepted at 11. There is no other check on
  the scored account (no level, no item besides the four parts).
- Nulodion's shop (cannon set, parts, ammo) opens only after the quest
  (`nulodion.rs2:1-6`).

## Requirements (as this server enforces them)

- **No quest or skill requirement to start or finish.** Lawgof starts it with no
  check (`lawgof2.rs2:17-42`).
- **Stage gates** (`quest_mcannon.constant:1-11`): the railings work only at stage
  1 (`railings.rs2:42-49`); the tower trapdoor opens from stage 2
  (`mcannon_ladders.rs2:1-8`, `ladders.rs2:52`); the remains can be picked up only
  at stage 2 (`dwarf_remains.rs2:1-12`); the cave sets stage 4 only from 3
  (`mcannon_cave.rs2:6-8`); the crate frees Lollk only at stage 4
  (`mcannon_crate.rs2:3`); the shed door opens from 6 (`mcannon_doors.rs2:10-15`);
  Nulodion's door from 9 (`mcannon_doors.rs2:2-7`). So the order is fixed.
- **Skill rolls** use `stat_random`, which reads the **current** level, so a boost
  helps (`PlayerOps.ts:591-600`: success if `floor(low*(99-L)/98) +
  floor(high*(L-1)/98) + 1` beats a 0-255 roll):
  - Each railing: `stat_random(crafting, 60, 150)` (`railings.rs2:78`). A fail
    hits you for `min(3, hitpoints_base / 10)` (`railings.rs2:84-91`).
  - Each cannon inspect and each part fix: `stat_random(smithing, 80, 300)` **or**
    `stat_random(crafting, 80, 350)` (`mcannon_broken_cannon.rs2:90-97`). At 60/60
    this is 99%; at 99 in either it is certain.

| Crafting | Railing success | Expected tries for 6 | Expected railing ticks |
|---|---|---|---|
| 1 | 61/256 = 24% | 25 | about 365 |
| 30 | 87/256 = 34% | 17.7 | about 260 |
| 60 | 114/256 = 45% | 13.5 | about 195 |
| 99 | 151/256 = 59% | 10.2 | about 150 |

(Ticks per try measured at 14.5-15.5 including the short walks between
railings: 193/12, 217/14, 345/24, 170/10.)

## Items: helper-supplied and scored-account-only

| Item | Tradeable | Source |
|---|---|---|
| Runes for 3 teleports (Ardougne twice, Falador once) | yes | helper |
| Railings | **no** (`quest_mcannon.obj:145`) | Lawgof gives 6, and another whenever you have none (`lawgof2.rs2:39-40,63-68`) |
| Dwarf remains | **no** (`quest_mcannon.obj:12`) | the tower's top floor |
| Tool kit | **no** (`quest_mcannon.obj:25`) | Lawgof |
| Nulodion's notes, ammo mould | **no** (`quest_mcannon.obj:52,65`) | Nulodion; Lawgof takes both at the end |
| **Cannon base, stand, barrels, furnace** | **yes** (no `tradeable=no`, `quest_mcannon.obj:80-132`; objects default to tradeable, `ObjType.ts:181`) | a helper who has done the quest buys them from Nulodion: 750,000 for the set or 200,000 per part (`nulodion.rs2:68-80,145-164`) |
| **Cannonballs** | **yes** (`quest_mcannon.obj:27-39`) | a helper smelts them (Smithing 35 and the untradeable mould, `cannonballs.rs2:10-17`, so the helper needs the quest) or buys them from Nulodion |

Nothing in the goblin cave is a cannon part: the cave holds only the crate with
Gilob's son, Lollk.

## Step list

Raw counts from the 300 ms run; ticks measured.

1. **Ardougne teleport** to (2661,3301) (Plague City; Camelot is about the same
   distance, inferred): 4. **Walk to Commander Lawgof** at (2571,3463), 189 route
   tiles: **117**.
2. **Talk to Lawgof**: pick "Yeah, I'd love to help."; stage 1, six railings
   (`lawgof2.rs2:17-42`). 10 pages, 1 option: **24**.
3. **Replace the six railings**: loc ids 15-20 at (2556,3475), (2558,3472),
   (2557,3464), (2559,3462), (2564,3460), (2572,3460) (maps m39_54, m40_54).
   Each try: Inspect, `p_delay(2)`, `p_delay(2)`, option "Try to replace the
   railing.", `p_delay(2)`, the roll, and on success `p_delay(2)` and bit 5-10 of
   `%mcannonmulti` (`railings.rs2:57-93`). 14 tries at Crafting 60: **217**.
4. **Talk to Lawgof**: all six bits set, stage 2 (`lawgof2.rs2:44-58`). 9 pages:
   **20**.
5. **The watchtower**: the ladder at (2570,3441), then the ladder on the first
   floor; **take the dwarf remains** on the second floor at (2567,3444); climb
   down twice. 23 tiles, 4 climbs, 1 pickup: **33**.
6. **Talk to Lawgof**: shows the remains, stage 3 (`lawgof2.rs2:71-92`). 12 pages,
   22 tiles: **38**.
7. **Walk to the goblin cave** at (2622,3392), north of the Fishing Guild; Enter,
   `p_delay(1)`, stage 4, inside at (2620,9797) (`mcannon_cave.rs2:1-10`). 108
   tiles: **64**.
8. **Search the crate** at (2571,9850): Lollk appears and talks (5 pages), stage 5
   (`mcannon_crate.rs2:1-20`, `dwarfchildtw1.rs2:4-22`). 67 tiles: **53**.
9. **Climb over the mud pile** at (2621,9796) back out to (2623,3391)
   (`mcannon_cave.rs2:12-16`), walk to Lawgof and pick "Ok, I'll see what I can
   do.": tool kit, stage 6 (`lawgof2.rs2:106-126`). 173 tiles, 9 pages, 1 option:
   **127**.
10. **The shed**: open the door at (2576,3461) and Inspect the broken cannon at
    (2577,3461). The first inspect is a chat line and stage 7; each later inspect
    rolls to find the problem (two messages, `p_delay(3)`, a 5-way menu: pick Pipe,
    Barrel, Axle, Shaft in turn), and each fix rolls again (`p_delay(2)`); with all
    four bits set the next inspect says it is in working order, stage 8
    (`mcannon_broken_cannon.rs2:1-76`). 6 inspects, 4 part picks, no failed rolls
    at 60/60: **82** (70 in a 100 ms run without the door hiccup below).
11. **Talk to Lawgof**: he checks the shed (`if_close`, two `p_delay(1)`), then
    pick "Ok then, just for you!": stage 9 (`lawgof2.rs2:142-173`). 14 pages, 1
    option: **41**.
12. **Falador teleport** to (2965,3378): 4. **Walk to the Black Guard base**,
    open Nulodion's door at (3015,3453) and talk to Nulodion at (3011,3453): notes
    and mould, stage 10 (`nulodion.rs2:15-29`). 151 tiles, 1 door, 8 pages:
    **108**.
13. **Ardougne teleport**: 4. **Walk to Lawgof** and talk: he takes the notes and
    mould, `queue(mcannon_complete)`, stage 11 and the reward
    (`lawgof2.rs2:182-203`, `quest_mcannon.rs2:23-27`). 189 tiles, 12 pages:
    **142**.

## Dialogue runs (CONVENTIONS "Dialogue: three columns")

Read from the scripts; the totals match the measured counts (81 pages and 21
option clicks in the 300 ms run, with 14 railing tries). `c` is a pure continue,
`opt` an option click, `wait` a forced server delay inside the dialogue.

| Dialogue | Runs | Stock (2/click) | Fixed (1/click) | Burst |
|---|---|---|---|---|
| Lawgof start (`lawgof2.rs2:17-42`) | `4c, opt, 6c` | 22 | 11 | 1 + 1 + 2 = 4 |
| Lawgof railings done (`:44-58`) | `9c` | 18 | 9 | 2 |
| Lawgof remains (`:71-92`) | `12c` | 24 | 12 | 3 |
| Lollk (`dwarfchildtw1.rs2:4-9`) | `5c` | 10 | 5 | 1 |
| Lawgof tool kit (`lawgof2.rs2:106-126`) | `7c, opt, 2c` | 20 | 10 | 2 + 1 + 1 = 4 |
| Shed (`mcannon_broken_cannon.rs2:3,10,24-31`) | `1c`, then 4 part options (one per inspect), then `1c` | 12 | 6 | 6 |
| Lawgof repaired (`lawgof2.rs2:142-173`) | `4c, wait, 6c, opt, 4c` | 30 | 15 | 1 + 2 + 1 + 1 = 5 |
| Nulodion (`nulodion.rs2:15-29`) | `8c` | 16 | 8 | 2 |
| Lawgof complete (`lawgof2.rs2:182-203`) | `12c` | 24 | 12 | 3 |
| Railings | 1 option per try (14 here, 13.5 expected at Crafting 60) | 28 | 14 | 14 |
| **Total** | 81 pages, 21 options | **204** | **102** | **44** |

Every state change (railings given, varps set, tool kit, notes and mould) happens
before the last pages of its dialogue, so no page in a run gates the bot's next
action; the only in-dialogue wait is Lawgof inspecting the shed (`if_close`, two
`p_delay(1)`), which a burst cannot cross.

## Tick total

| Part | Raw counts | Stock | Fixed | Burst | Basis |
|---|---|---|---|---|---|
| Travel | 3 teleports; about 930 route tiles over 9 walks | 12 + about 560 | same | same | teleport primitive; walks measured |
| Dialogue | 81 pages, 21 options (above) | 204 | 102 | 44 | read runs; stock measured inside the segments |
| Interactions and waits | 14 railing tries (the `p_delay`s and roll), 4 climbs, 1 pickup, cave, crate, mud pile, 2 doors, 6 inspects + 4 fixes, Lawgof's shed wait | about 300 | same | same | measured (the remainder) |
| Fights | none | 0 | 0 | 0 | |
| **Total** | | **1,078** | **about 976** | **about 918** | stock measured, `quest-mcannon-run.ts` (1,066 + 12); fixed and burst = stock minus the dialogue saving |

(The travel and interaction split is approximate, since the segments mix them;
the stock total and the per-step figures above are what was measured.) With
Crafting 99 the railings drop to about 150 stock (inferred from the per-try time),
for about 1,010 stock; with Crafting 1 they rise to about 365, for about 1,230.
Each railing try is about 15 ticks stock and 14 with either client fix (one option
click saved).

## Using the cannon (measured after the quest)

`quest-mcannon-setup.ts`, at the Lumbridge goblins:

- **Set-up to firing: 23 ticks** at 300 ms (21 at 100 ms): Set-up on the base
  (the player steps aside, `cannon_setup.rs2:108-130`) 5, then use the stand,
  barrels and furnace on it, assembled by +13, 30 cannonballs loaded by +15, Fire.
  It needs a clear 3x3 ("There isn't enough space to set up here." at three of the
  first five tiles tried), and not in a bank, the dwarf mines, Duel Arena, Castle
  Wars, the Fight Arena or under the lighthouse (`cannon_setup.rs2:59-107`).
- **Pick-up: 3 ticks** (`cannon_setup.rs2:230-244`); it needs 4 free slots and
  returns unfired balls.
- **It only hits what the player could attack itself.** Each shot calls
  `~player_in_combat_check` (`cannon_fire.rs2:107`), so in a single-combat area a
  monster attacking you blocks shots at every other monster: measured 0 Ranged xp
  in 60 ticks while a goblin was attacking the bot ("I'm already under attack!"
  every shot), and 62 base in 60 ticks in the earlier 100 ms run. **Use it in
  multi-combat areas** (`maps/multiway.csv`), or on the monster you are fighting.
- Xp per hit: `2 × damage` base Ranged (`cannon_fire.rs2:116-120`: `scale(200,
  100, damage)` tenths, then the npc's combat xp multiplier), max hit 30. One shot
  per rotation step of the 8-direction sweep (`cannon_fire.rs2:1-91`), 30 balls per
  load.
- The cannon decays (`^cannon_decay_length`, `cannon_setup.rs2:1-12`); Nulodion
  replaces a decayed one free (`nulodion.rs2:91-143`).

## Risks and gotchas

- **Railing fails cost hitpoints** (up to 3 a try). At low Hitpoints and low
  Crafting a long streak could matter; with 70 Hitpoints it does not.
- **The shed door.** In two of the runs the door was shut when the bot arrived
  from Lawgof and the inspect failed with "can't reach"; the script reopens it
  (cost about 10 ticks). Open it first.
- **Lawgof's "repaired" dialogue closes and reopens** (`if_close`, `p_delay(1)`
  twice) while he inspects the shed; wait for the next page instead of treating
  the closed dialogue as the end.
- **Dialogue double-click** (lab tooling): the lite client can re-publish a page
  under a new `pageId`; an unguarded `sendClickDialog` then answered Lawgof's first
  choice with "I'm sorry, I'm too busy mining.". The scripts use the guarded
  `clickDialogByText`.
- All five quest varps are `scope=perm` (`quest_mcannon.varp`), so the quest is
  logout-safe at every stage.

## Open questions

- Whether the README route passes near Lawgof (north of Ardougne) or the Black
  Guard base (south of Ice Mountain) for another reason; each saved walk is
  100-190 ticks.
- The cannon's real Ranged xp rate in a good multi-combat spot alongside melee:
  not measured here (the goblins at Lumbridge are single-combat).
