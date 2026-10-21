# Death Plateau

**About 816 ticks on the fixed client (1,007 stock, 704 with dialogue bursts) for
3,000 base Attack and 1 quest point.** No fight and no skill check. It is three
fetch loops around Burthorpe with 173 dialogue pages and options, so dialogue is
half the cost on the stock client. On its own it is not worth doing for the
Attack; it is the gate to Troll Stronghold, Troll Romance and Eadgar's Ruse
(see the chain verdict in [troll_romance.md](troll_romance.md)).

Walking legs are measured with `docs/speedrun/scripts/quest-troll-walk.ts` where
the table says so, and otherwise counted with the SDK pathfinder
(`quest-troll-routes.ts`, `quest-troll-totals.ts`); dialogue pages are counted from
the scripts (read) and costed with the measured primitives in `primitives.md`.
The quest was **not** run end to end in the lab; see Open questions.

## Reward

- 3,000 base Attack: `stat_advance(attack, 30000)` (read, `quest_death.rs2:221`).
- 1 quest point (read, `general/configs/quest.constant:82`), steel claws
  (`quest_death.rs2:220`).
- Unlocks: Troll Stronghold (Denulth only offers it once `%death_equiproom` is
  complete, `death_ig_commander.rs2:6-9,62-89`); half of Eadgar's Ruse's start check
  (`area_taverly/scripts/sanfew.rs2:102`); wearing climbing boots
  (`quest_death.rs2:120-125`), which the Death Plateau rocks and the rockslide on
  the Sherpa path need; buying climbing boots from Tenzing for 12 coins
  (`death_sherpa.rs2:13-25`).

## Requirements (as this server enforces them)

- **No quest or skill requirement.** No script in `quest_death/` calls `stat()` or
  `stat_base()` (read, grep). Denulth starts it from `%death_equiproom` 0
  (`death_ig_commander.rs2:10-12,91-115`).
- **Items the steps check:** an Asgarnian ale for Harold
  (`death_guard_equiproom.rs2:316-320`); a Blurberry Special to make him very drunk
  (`:280-298`, optional but it makes the dice game a sure win); coins for the bet
  (`:239`); an iron bar and the climbing boots for Dunstan (`death_smithy.rs2:195-211`);
  10 bread and 10 cooked trout for Tenzing (`death_sherpa.rs2:128-135`).

## The dice game, read

Harold starts with 100 coins (`death_ig_commander.rs2:112`). He writes the IOU
(which is the combination) only when a bet you win is more than he holds
(`death_guard_equiproom.rs2:134-137,153-183`). Max bet is 1,000 (`:230`). Without
the Blurberry Special a fair 2d6-vs-2d6 roll wins 575/1296 = 44% (ties lose,
`:115`), and every loss adds the bet to his purse, so after a loss of 1,000 he holds
1,100 and can never be cleaned out. **Give him the Blurberry Special first:** a
very drunk Harold counts your roll as 16 (`:187-198`), so one bet of 101 or more
wins outright. Bet 101+ and carry at least that many coins; you get the stake back
plus his 100.

## Items: helper-supplied and scored-account-only

| Item | Tradeable | Source for the run |
|---|---|---|
| Asgarnian ale, Blurberry Special, 150 coins, iron bar, 10 bread, 10 cooked trout | yes (`ObjType.ts:181` default) | helper, one trade (9 ticks) |
| Games necklace (2 charges here) | yes | helper |
| IOU / combination, entrance certificate, secret-way map | **no** (`quest_death.obj`) | scored account, from the NPCs |
| 5 stone balls | **no** | scored account: on the ground at 2893,3561-3565 (map `m45_55`) |
| Climbing boots, spiked boots | yes | Tenzing and Dunstan give them in the quest |

Inventory: the 10 bread and 10 trout do not stack. With the coins, iron bar and
necklace that is 23 slots, so the 5 stone balls fit only once the ale and
Blurberry Special are drunk; place each ball as you pick it up if space is short.

## Step list

Varps (all `scope=perm`, `quest_death.varp`): `%death_equiproom` (0 start, 10
started, 20/30/40 Eohric-Harold-Eohric, 50 ale, 55 IOU, 60 combination, 70 door
unlocked, 80 complete); the low 4 bits of `%death_map` (1 Saba, 2 Tenzing, 3
Dunstan, 4 certificate, 5 certificate given, 6 supplies, 7 map, 8 scouted);
`%death_bits` holds the dice rolls and Harold's purse (`quest_death.constant`).

Dialogue runs use the notation in `CONVENTIONS.md`: `c` a pure continue page, `o` an
option or interface click, `s` a page after a state change the next action depends
on, `w` the typed bet. "Interactions + waits" holds doors, stairs, pickups and the
scripts' `p_delay` waits (read, `p_delay(n)` = n + 1).

| # | Step | Dialogue runs | Pages + options | Walk | Interactions + waits | Fight | Stock | Fixed | Burst | Label |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Games necklace to Burthorpe, run to Denulth |  |  | 19 (35 route tiles) | 20 |  | 39 | 39 | 39 | necklace inferred; route pathfinder |
| 2 | Denulth: "Do you have any quests for me?", "No but perhaps I could try and find one?" (0 -> 10) | 2c,o,6c,o,13c | 21 + 2 |  |  |  | 48 | 24 | 9 | read |
| 3 | Run to the castle stairs, climb to level 1, Eohric |  |  | 19 (36 route tiles) | 5 |  | 24 | 24 | 24 | route pathfinder; stairs primitives §3 |
| 4 | Eohric: "I'm looking for the guard that was on last night." (10 -> 20) | 2c,o,5c | 7 + 1 |  |  |  | 18 | 9 | 4 | read |
| 5 | Down, run to the inn stairs, up, knock on Harold's door | 2c | 2 + 0 | 20 (38 route tiles) | 15 |  | 41 | 38 | 37 | route pathfinder; knock read (quest_death.rs2:19-25) |
| 6 | Harold: "You're the guard that was on duty last night?" (20 -> 30) | 2c,o,4c | 6 + 1 |  |  |  | 16 | 8 | 4 | read |
| 7 | Back to Eohric (door, inn stairs, castle stairs) |  |  | 20 (38 route tiles) | 12 |  | 32 | 32 | 32 | route pathfinder |
| 8 | Eohric: "I found Harold but he won't talk to me!" (30 -> 40) | 5c | 5 + 0 |  |  |  | 12 | 6 | 2 | read |
| 9 | Back to Harold, knock | 2c | 2 + 0 | 20 (38 route tiles) | 20 |  | 46 | 43 | 42 | route pathfinder |
| 10 | Harold: Asgarnian ale (40 -> 50), then "Can I buy you a drink?" with a Blurberry Special (very drunk) | 4c,s,1c,o,4c,s,1c | 12 + 1 |  | 14 |  | 42 | 28 | 22 | read (death_guard_equiproom.rs2:275-335) |
| 11 | Harold: "Would you like to gamble?", bet 101+, roll; drunk Harold loses all and writes the IOU (50 -> 55) | 2c,o,4c,w,1c,o,o,4c,s | 12 + 4 |  | 17 |  | 51 | 34 | 27 | read (death_guard_equiproom.rs2:46-249) |
| 12 | Read the IOU (55 -> 60) | 3c,s | 4 + 0 |  |  |  | 10 | 5 | 3 | read (quest_death.rs2:27-35) |
| 13 | Out, down, run to the stone balls |  |  | 21 (39 route tiles) | 5 |  | 26 | 26 | 26 | route pathfinder |
| 14 | Pick up 5 stone balls, place them (blue 2894,3562; yellow 2895,3562; red 2894,3563; purple 2895,3563; green 2895,3564) (60 -> 70) |  |  |  | 20 |  | 20 | 20 | 20 | inferred, 10 interactions at 2 |
| 15 | Run to Saba's cave, enter, to Saba |  |  | 32 (61 route tiles) | 6 |  | 38 | 38 | 38 | route pathfinder |
| 16 | Saba: "Do you know of another way up Death Plateau?" (map 0 -> 1) | 2c,o,13c | 15 + 1 |  |  |  | 34 | 17 | 6 | read |
| 17 | Leave the cave, run to Tenzing's door, knock | 4c | 4 + 0 | 35 (68 route tiles) | 9 |  | 54 | 49 | 46 | route pathfinder; knock read (quest_death.rs2:46-61) |
| 18 | Tenzing: "OK, I'll get those for you." (map 1 -> 2, climbing boots) | 12c,o,3c | 15 + 1 |  |  |  | 34 | 17 | 6 | read |
| 19 | Front door, run to Dunstan |  |  | 76 | 2 |  | 78 | 78 | 78 | measured walk (quest-troll-walk.ts, 2823,3555 -> Dunstan) |
| 20 | Dunstan: boots and the condition (map 2 -> 3) | 12c | 12 + 0 |  |  |  | 26 | 13 | 4 | read |
| 21 | Run to Denulth |  |  | 29 (56 route tiles) |  |  | 29 | 29 | 29 | route pathfinder |
| 22 | Denulth: certificate (map 3 -> 4) | 13c | 13 + 0 |  |  |  | 28 | 14 | 4 | read |
| 23 | Run to Dunstan |  |  | 29 (56 route tiles) |  |  | 29 | 29 | 29 | route pathfinder |
| 24 | Dunstan: certificate (map 4 -> 5), spikes with the iron bar | 9c | 9 + 0 |  |  |  | 20 | 10 | 3 | read |
| 25 | Run to Tenzing (door opens without knocking from map 2) |  |  | 69 (135 route tiles) | 4 |  | 73 | 73 | 73 | route pathfinder |
| 26 | Tenzing: spiked boots, 10 bread, 10 trout (map 5 -> 6 -> 7, secret way map) | 11c | 11 + 0 |  |  |  | 24 | 12 | 4 | read |
| 27 | Back door, stile, run to the lookout zone (2864,3608) (map 7 -> 8) | 1c | 1 + 0 | 38 (73 route tiles) | 8 |  | 50 | 48 | 48 | route pathfinder; stile measured 3-6 |
| 28 | Games necklace to Burthorpe, run to Denulth |  |  | 19 (35 route tiles) | 20 |  | 39 | 39 | 39 | inferred |
| 29 | Denulth: map and combination, quest complete; close the scroll | 11c | 11 + 0 |  | 2 |  | 26 | 14 | 6 | read |

The two equipment-room trips to Eohric and Harold, and the Tenzing-Dunstan-Denulth-
Dunstan-Tenzing loop, are forced by the varp order; I found no shortcut in the
scripts. The lookout zone (`[zone,0_44_56_48_24]`, `quest_death.rs2:130-136`) fires
on entering 2864-2871,3608-3615.

## Tick total

| Part | Ticks | Label |
|---|---|---|
| Walking | 446 | 6 legs measured (76) or pathfinder route tiles at 0.5 + 1 per leg |
| Interactions and waits (stairs, doors, 10 stone-ball actions, 2 necklaces, dice waits) | 179 | read / inferred from `primitives.md` |
| Dialogue: 162 pages + 11 options | 382 stock / 191 fixed / 79 burst | read counts, measured primitives |
| Fights | 0 | |
| **Total** | **1,007 stock / 816 fixed / 704 burst** | |

The opening trade (9) is counted in Troll Stronghold's table, where the chain
needs its second trade; add 9 if Death Plateau is done alone.

## Risks and gotchas

- **Without the Blurberry Special the dice game can lock.** Each loss adds the bet
  to Harold's purse; once he holds more than 1,000 no bet can clean him out
  (`death_guard_equiproom.rs2:135,230`). Bring the drink.
- **Place the stone balls only after reading the IOU.** The door check runs on each
  placement only at stage 60 (`quest_death.rs2:91-98`); balls placed earlier have to
  be picked up and placed again.
- **Harold's door** asks for a reason before stage 20 (`quest_death.rs2:15-18`), and
  Tenzing's front door only opens after Saba (`:46-61`).
- **Logout:** all three varps are permanent; the quest is logout-safe throughout
  (`primitives.md` §8). The dice interface itself should not be interrupted: its end
  queue pays out (`death_guard_equiproom.rs2:148-151`).
- **Climbing boots are taken.** Tenzing keeps the spiked boots (`death_sherpa.rs2:142`),
  so the account ends the quest without climbing boots. Troll Stronghold needs a
  pair worn; buy them back from Tenzing (12 coins) or have a helper who has done the
  quest buy and trade them.

## Open questions

- **An end-to-end lab run.** Dialogue is costed from read page counts; a few long
  `~chatnpc` lines may split into two pages (`split_init` at 4 lines, `primitives.md`
  §1), which would add 2 ticks each on the stock client.
- **The games necklace's last stairs** (games room level 1 at 2205,4935 to the castle
  courtyard 2899,3564, `stairs.rs2:509-516`) are read, not timed; the first flight
  took 4 ticks (measured).
