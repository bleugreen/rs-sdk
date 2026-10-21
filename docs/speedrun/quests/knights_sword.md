# The Knight's Sword

**About 910 ticks (about 4.5 minutes at 300 ms) for 12,725 base Smithing and 1
quest point. It does not beat helper-fed Smithing.** At about 54 base xp per tick
(cairn://p/rs/main/task/per-skill), 12,725 Smithing is worth about 236 ticks of
training; the quest costs about 910. Even with travel set to zero, its dialogue,
interactions and one trade come to about 217 ticks, so it only breaks even if
every leg were free. Drop it from the xp plan. Keep it only if its single quest
point is the cheapest one left toward Dragon Slayer's 32 or Legends' Quest's 107
(`legends.md`), at a net cost of about 675 ticks for that point.

All ticks are stock-client figures at the production tick rate (lab at
`NODE_TICKRATE=300`), measured with `docs/speedrun/scripts/quest-squire-run.ts`
unless labelled otherwise. Primitive costs (teleports, trades) come from
`primitives.md`.

## Reward

- 12,725 base Smithing: `stat_advance(smithing, 127250)` (read,
  `quest_squire.rs2:223`; xp arguments are tenths, so 127,250 is 12,725 base, and
  measured: 318,125 game xp = 12,725 × 25 landed on a level-1 account, which
  reached Smithing 82).
- 1 quest point (read, `general/configs/quest.constant:122`).
- Leaves you holding nothing: the squire takes the Blurite sword
  (`quest_squire.rs2:100`).

## Requirements (as this server enforces them)

- **No quest requirement.** The squire starts it at `%squire` = 0 with no check
  (read, `area_falador/scripts/squire.rs2:5-6`).
- **Mining 10, checked with `stat(mining)`** (boosted level) when you mine the
  blurite rock (read, `skill_mining/scripts/mining.rs2:57-58`,
  `mine.dbrow:170`). The scored account must mine the ore itself because blurite
  ore is untradeable. No boost takes a level-1 account to 10, so Mining 10 has to
  be real here; the plan trains Mining anyway, so do the quest after that.
- **A pickaxe the account can use.** Pickaxe choice uses `stat(mining)`
  (`pickaxe_checker.rs2:2`); wielding one uses `stat_base(attack)` via
  `levelrequire/` (steel 5, rune 40). It can also just sit in the inventory.
- **The wiki's other requirements are not enforced here.** Nothing checks Smithing
  (the dwarf makes the sword), and nothing checks combat.
- **Members:** no `map_members` check on the route (read, grep over
  `quest_squire`, `squire.rs2`, `thurgo.rs2`, `reldo.rs2`, `cupboards.rs2`).
- **Items the steps check:** a redberry pie for Thurgo
  (`quest_squire.rs2:126,150`), the portrait (`quest_squire.rs2:172`), and one
  blurite ore plus two iron bars in the inventory (`quest_squire.rs2:190`).

## Items: helper-supplied and scored-account-only

| Item | Tradeable | Source for the run |
|---|---|---|
| Redberry pie | yes | helper |
| Iron bar × 2 | yes | helper |
| Pickaxe (steel or better) | yes | helper |
| Runes for 3 Falador and 1 Varrock teleport, an amulet of glory with 2 charges | yes | helper |
| Portrait | **no** (`quest_squire.obj:10`) | scored account: Sir Vyvin's cupboard |
| Blurite ore | **no** (`quest_squire.obj:57`) | scored account: mined in the Asgarnian Ice Dungeon |
| Blurite sword | **no** (`quest_squire.obj:41`) | scored account: Thurgo makes it |

One trade (9 ticks, `primitives.md` §6) carries all of the helper items.

## Step list

Quest varp `%squire` (perm, `quest_squire.varp`), stages from
`quest_squire.constant`: 0 not started, 1 started, 2 spoken to Reldo, 3 pie given,
4 spoken to Thurgo, 5 looking for the portrait, 6 looking for blurite, 7 complete
(`quest.constant:55`). Blurite can be mined at any stage, so it is mined on the
first trip south and the second Thurgo visit finishes the sword in two talks.

Measured travel uses `bot.walkTo`, which `primitives.md` §2 found about 13% slower
than chained clicks; route tiles are given so the README can recompute at 0.5
ticks per tile.

| # | Where | Action | Varp | Raw counts | Ticks | Label |
|---|---|---|---|---|---|---|
| 0 | anywhere | Trade with a helper: pie, 2 iron bars, pickaxe, runes, glory | | 1 trade | **9** | measured, `primitives.md` §6 |
| 1 | → Falador | Falador teleport (Magic 37), lands (2965,3378) | | 1 teleport | **4** | measured, `primitives.md` §4 |
| 2 | → Squire (2977,3342) | Run | | 42 tiles | **23** | measured |
| 3 | Squire | "And how is life as a squire?", "I can make a new sword if you like...", "So would these dwarves make another one?", "Ok, I'll give it a go." | 0 → 1 | 12 pages, 4 options | **35** (35-37, n=3) | measured |
| 4 | → Varrock | Varrock teleport (Magic 25), lands (3213,3424) | | 1 teleport | **4** | measured, `primitives.md` §4 |
| 5 | → Reldo (3209,3495), palace library | Run round the palace's west side (see Risks) | | 402 route tiles | **217** | measured |
| 6 | Reldo | "What do you know about the Imcando dwarves?" (offered only at `%squire` = 1, `reldo.rs2:6-9`) | 1 → 2 | 10 pages, 1 option | **26** | measured |
| 7 | → Draynor | Amulet of glory, Draynor Village, lands (3105,3251) | | 1 teleport | **6** | measured, `primitives.md` §4 |
| 8 | → Ice dungeon trapdoor (3008,3150), Mudskipper Point | Run | | 192 tiles | **107** | measured |
| 9 | Trapdoor | Climb down to (3008,9550) | | 1 climb | **4** | measured |
| 10 | → Blurite rocks (3049,9566) | Run past ice warriors and ice giants | | 98 tiles | **57** | measured |
| 11 | Blurite rock (`bluriterock`) | Mine one ore at Mining 10 with a steel pickaxe | | 1 click | **13** (n=1) | measured; see Open questions for the success rate |
| 12 | → Ladder (3008,9550) | Run back | | 96 tiles | **56** | measured |
| 13 | Ladder | Climb up | | 1 climb | **3** | measured |
| 14 | → Thurgo (3001,3144) | Run | | 35 tiles | **24** | measured |
| 15 | Thurgo | "Would you like a redberry pie?" | 2 → 3 | 5 pages, 1 option | **16** | measured |
| 16 | Thurgo | Talk again: "Can you make me a special sword?" (`quest_squire.rs2:154-161`) | 3 → 4 | 6 pages | **15** | measured |
| 17 | → Falador | Falador teleport | | 1 teleport | **4** | measured, `primitives.md` §4 |
| 18 | → Squire | Run | | 42 tiles | **23** | measured |
| 19 | Squire | Talk (status report names the portrait) | 4 → 5 | 5 pages | **13** (13-14, n=2) | measured |
| 20 | → Castle ladder (2994,3341) | Run | | 18 tiles | **11** | measured |
| 21 | Castle | Ladder up (2994,3341), run 10 tiles, first-floor stairs up (2984,3337) to Sir Vyvin's floor. The ladder at (2996,3341) on the first floor leads to a separate tower room. | | 2 climbs, 10 tiles | **24** | measured |
| 22 | → Cupboard (2984,3336, floor 2) | Run | | 6 tiles | **8** | measured |
| 23 | Cupboard (`vyvincupboardshut`) | Open, then Search; portrait | | 2 interactions, 1 page | **9** | measured; Sir Vyvin stood 3 tiles away, so no luring was needed |
| 24 | → Draynor | Amulet of glory, Draynor Village | | 1 teleport | **6** | measured, `primitives.md` §4 |
| 25 | → Thurgo | Run | | 207 tiles | **117** | measured |
| 26 | Thurgo | Talk; gives him the portrait | 5 → 6 | 10 pages | **24** | measured |
| 27 | Thurgo | Talk again; blurite and 2 iron bars become the Blurite sword | | 6 pages | **15** | measured |
| 28 | → Falador | Falador teleport | | 1 teleport | **4** | measured, `primitives.md` §4 |
| 29 | → Squire | Run | | 42 tiles | **23** | measured |
| 30 | Squire | Talk; hands over the sword, completion queue | 6 → 7 | 4 pages | **11** | measured |

## Tick total

| Part | Ticks | Label |
|---|---|---|
| Travel (walking) | 666 (1,180 route tiles) | measured |
| Travel (teleports: 3 Falador, 1 Varrock, 2 glory) | 28 | measured, `primitives.md` §4 |
| Dialogue (58 pages, 6 options, 8 conversations) | 155 | measured |
| Interactions (2 climbs down/up, 3 castle climbs, mining, cupboard) | 53 | measured |
| Trade | 9 | measured, `primitives.md` §6 |
| Fights | 0 | |
| Waits | 0 (no `p_delay` on the route outside climbs) | read |
| **Total** | **911** | measured, stock client |

Raw counts: 58 dialogue pages and 6 option clicks; 6 teleports; 1 trade; 6 climbs;
1,180 route tiles. With the client fix (cairn://p/rs/22) the dialogue drops to
about 85 ticks and the trade to 5, so the total to about 837.

The Reldo leg is a quarter of the total. The SDK's collision snapshot shows a gap
in the palace's south wall at (3212,3438) that the server blocks, so the measured
walk goes round the west side (402 tiles). If the real entrance is shorter than
that (see Open questions), this row shrinks; the verdict does not change.

## Risks and gotchas

- **Aggressive monsters in the Ice Dungeon.** Ice warriors (level 57) and ice
  giants (level 53) stand around the blurite rocks. The lab account at 60/60/60
  lost 7 of 60 hitpoints on the round trip; a low-level account needs food or
  higher Defence.
- **The palace gate.** `bot.walkTo` gets stuck at (3212,3438) every time; route
  round it with waypoints (the script does).
- **Sir Vyvin.** The cupboard search refuses while he is within 1 tile of you
  (`quest_squire.rs2:209-217`). He wanders 5 tiles (engine default,
  `NpcType.ts:101`), so occasionally a wait or a reposition is needed.
- **Reldo's option** appears only while `%squire` = 1 (`reldo.rs2:6-9`); talk to
  the squire first.
- **Thurgo checks the inventory, not the bank** for the blurite and bars
  (`quest_squire.rs2:190`), and the squire refuses a worn sword
  (`quest_squire.rs2:102-104`).
- **Logout-safe throughout.** `%squire` is permanent (`quest_squire.varp`), and no
  step depends on a temporary varp (`primitives.md` §8).
- No level-up dialogue interrupts anything until the reward, which arrives after
  the last step.

## Open questions

- **Blurite success rate at Mining 10.** One sample (1 click, 13 ticks including
  the walk-up). The roll is `stat_random(mining, 95, 350)` (`mine.dbrow:172`), about
  46% per attempt at level 10 by the usual low/high interpolation (inferred), so
  expect a few more ticks on average. At a high Mining level it is close to
  certain.
- **A shorter palace approach.** If the palace's south gate opens on the server
  (it does in later revisions), step 5 drops from 217 to about 40 ticks (75 route
  tiles from the teleport). I did not find a gate loc there in the map
  (`maps/m50_53.jm2`).
- **Combining with other quests.** Thurgo, the ice dungeon and Port Sarim are near
  Dragon Slayer's and Merlin's Crystal's Port Sarim steps, and the squire is in
  Falador. If the README routes those together, Knight's Sword's travel shrinks.
  The dialogue and interactions (about 217 ticks with the trade) are the floor.
