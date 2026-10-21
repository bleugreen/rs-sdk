# Horror from the Deep (feasibility only)

**Verdict: skip. Estimated at about 800-1,000 ticks (read and inferred, not
measured), for about 60-100 ticks of training it would displace.** Its reward
is 4,662 base xp each in Magic, Strength and Ranged; Strength is already
over-capped by earlier quests and Ranged is nearly free alongside a dwarf
multicannon, so only the Magic share counts, and Magic 1-99 costs about 540
ticks with helpers (coordinator's per-skill figures), which makes 4,662 base
worth about 63 ticks. The quest is far over the coordinator's 200-tick
threshold for lab time, so none was spent on it (scope decision from
cairn://p/rs/3, 2026-10-20).

## Reward (read)

- `stat_advance(magic, 46620)`, `stat_advance(strength, 46620)`,
  `stat_advance(ranged, 46620)` (`quest_horror.rs2:491-493`): **all three, not
  a choice**, 4,662 base xp each (11.7% of the 39,938 to 99; level 68 from
  scratch on this server's table, `Player.ts:77-85`).
- 2 quest points (`quest.constant:137`), a casket (`quest_horror.rs2:494`).

## Requirements (as this server enforces them)

- **None enforced.** Larrissa starts the quest without checking any quest,
  skill or quest points (`horror_girlfriend.rs2:49-93`); Gunnjorn hands over
  the key on request (`gunnjorn.rs2:14-25`). The wiki's Alfred Grimhand's
  Barcrawl and 35 Agility are not checked. The only `stat` checks in the quest
  folder are the post-quest god books (`horror_godbook.rs2:253-276`).
- **Agility is a failure roll, not a requirement.** The bridge jump rolls
  `stat_random(agility, 5, 255)` and always crosses, failing only into 1-5
  damage (`quest_horror.rs2:97-108`). Of the ten basalt-rock jumps, one in each
  direction (spots 3 and 8) rolls the same and on failure sweeps you back to
  shore with 1-10 damage (`basalt_rocks.rs2:20-53`). Success chance is
  value/256 with value = floor(5(99-L)/98) + floor(255(L-1)/98) + 1
  (`PlayerOps.ts:591-599`): 2% at Agility 1, 36% at 35, 61% at 60 (Fremennik
  Trials alone), 100% at 99.
- **Dagannoth Mother needs four elemental spells, melee and ranged.** Each of
  her six forms takes damage only from its own style: wind, water, earth or fire
  spells (strike to wave), melee styles, or ranged (`npc_combat.rs2:401-437`),
  and she changes form every 30 ticks (`timer=30`, `quest_horror.npc`;
  `horror_dagannoth.rs2:113-214`). So the minimum is Fire Strike, Magic 13,
  with Wind, Water and Earth Strike; strikes hit for at most 2-8, so realistic
  play wants bolts or blasts. 120 hitpoints, defence 81 with +150 melee and +50
  magic and ranged defence (`quest_horror.npc`).
- **Dagannoth (first fight):** 120 hitpoints, attack/strength 78, defence 81
  (`quest_horror.npc` `horror_dagannoth_jr4`).

## Step estimate (read and inferred)

| Part | Raw counts | Estimate (stock ticks) |
|---|---|---|
| Travel: Rellekka or Camelot → lighthouse (2509,3639); lighthouse → Gunnjorn at the Barbarian Outpost (2540,3548) and back; planks near the outpost (2552-2556,3573-3575) or from a helper | about 400-600 tiles, 10 basalt jumps, 1-2 failure retries | 250-350 |
| Dialogue: Larrissa (start, key), Gunnjorn, the six wall slots (one page and a "Really place" choice each), Jossik | about 50-60 clicks | 100-120 |
| Interactions: two planks with nails and hammer, lighthouse door, two spiral staircases, tar, tinderbox and molten glass on the light (which teleports you below), the metal wall, ladders | about 20 | 60-80 |
| Dagannoth (120 hp, melee) | | 60-100 |
| Dagannoth Mother: one style per 30-tick form, cycling six styles over 120 hp | | 150-300 |
| **Total** | | **about 800-1,000** |

Helper-supplied (all tradeable): two planks, eight steel nails, a hammer, swamp
tar, a tinderbox, molten glass, one each of fire, water, earth and air runes,
a stab or slash weapon and an arrow for the wall slots
(`quest_horror.rs2:332-426`), the casting runes, a bow and arrows, and food.

## Risks noted while reading

- The Dagannoth and the Mother check `npc_findhero` on death
  (`horror_dagannoth.rs2:17, 219`): kill credit must be the player's.
- The Mother deletes herself if the player is more than 17 tiles away at a form
  change (`horror_dagannoth.rs2:115, 133, ...`).
- Protect from Missiles or Melee makes her switch to the other attack style
  (`horror_dagannoth.rs2:62-75`); switching prayers every tick stops her
  attacking at all (comment, line 63).

## Open questions

- Whether `npc_changetype` keeps the Mother's damage between forms (assumed
  here; if each form reset her hitpoints the fight would be far longer).
- None measured; the estimate would only matter if Magic xp became scarce.
