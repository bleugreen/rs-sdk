# Underground Pass

**Verdict: skip.** It pays only as a Legends' Quest prerequisite, and Legends is off the
route; see [the chain verdict](regicide.md#the-regicide-chain-total-and-verdict). If it is
ever done, do it after Grand Tree (see the very-low-Agility section).

**About 2,600 ticks (13 minutes at 300 ms) at 70/70/70 melee, Agility 99, Thieving 50,
Ranged 60, for 3,000 base Agility xp, 3,000 base Attack xp and 5 quest points.**
At Agility 60 add about 60 ticks of expected failures, at Agility 40 about 240, and at
Agility 1-10 about 730-960, so it should not be the account's first Agility source
(see [Very low Agility](#very-low-agility-underground-pass-as-the-first-agility-source)).
With the fixed client the total is about 2,553, with dialogue bursts about 2,521. Most of the
time is walking through a long cave with about 45 scripted crossings. The four big fights
(three paladins, three demons, Kalrag) are about 550 ticks at 70 melee. This document is the
canonical one for Underground Pass: Legends' Quest and Regicide both need it, and Regicide
sends the player through the pass a second time (see
[After completion](#after-completion-the-traversal-regicide-needs)).

All ticks are stock lite-client figures at `NODE_TICKRATE=300`, measured on a local engine
with the scripts listed at the end. "Click to idle" means from the click to the player
standing still with no new message for three ticks, minus those three ticks. The segment
scripts start each part from a staged quest state (`::setvar`, `::tele`, `::give`).

## Reward

- **3,000 base Agility xp and 3,000 base Attack xp**: `stat_advance(agility, 30000)` and
  `stat_advance(attack, 30000)` in tenths (read, `quest_upass.rs2:800-801`). Measured: the
  hand-in added 75,000 game Agility xp (3,000 × 25), `quest-underground-pass-segments.ts handin`.
- **5 quest points** (read, `general/configs/quest.constant:125`, `^upass_questpoints`).
- Iban's staff, 15 death runes and 30 fire runes when Iban dies (read, `quest_upass.rs2:673-679`).
- Completion is queued when King Lathas is told at `%upass` 9 (read, `king_lathas.rs2:81-87`).
- Unlocks Regicide (it starts from Lathas once `%upass` is 10) and is one of Legends'
  Quest's requirements (`legends.md`).

## Requirements (as this server enforces them)

- **Biohazard complete** (`%biohazard` 16): Lathas only talks Underground Pass then
  (read, `king_lathas.rs2:73`), and the cave entrance refuses you without it (read,
  `quest_upass.rs2:81-84`).
- **Ranged 25, real level**: `stat_base(ranged) < 25` makes Lathas send you away
  (read, `king_lathas.rs2:95`). A potion does not help.
- **No other skill check on the route.** All the obstacles are random rolls,
  `stat_random(stat, low, high)` on the current (boostable) level; the table under
  [Failure rates](#failure-rates-and-what-a-failure-costs) gives the odds.
- **Thieving 50 is not required.** `stat(thieving) < 50` (boostable) only guards the two
  cage doors in area 2 (read, `quest_upass.rs2:247-251`), a shortcut. Without it you cross
  five stone bridges instead, which is about 11 ticks longer and adds five Agility rolls
  (planner, `quest-underground-pass-route.ts 'ledge end' --no=railing5`). **`legends.md` lists
  Thieving 50 as an Underground Pass requirement and omits the Ranged 25 check; both are
  wrong for this server.**
- **Members world** (the content is members-only; the lab ran as members).
- **Items the steps check** (read): a wielded bow and a lit fire arrow in the quiver for the
  bridge (`upass_bridge.rs2:43-62`), a rope for the swing (`upass_obstacles.rs2:81-91`),
  a spade for the mud (`quest_upass.rs2:210-224`), a bucket and a tinderbox for the tomb
  (`:421-489`), and the two Zamorak robes worn **with nothing else equipped** for the
  temple doors: `inv_freespace(worn) ! inv_size(worn) - 2` refuses you
  (`quest_upass.rs2:586`).
- **Wield requirements** for the gear assumed here, all `stat_base`
  (`levelrequire/scripts/`): shortbow Ranged 1 (`tier1.rs2:57`), rune scimitar Attack 40
  (`tier40.rs2:8`), rune full helm, chainbody, platelegs and kiteshield Defence 40
  (`tier40.rs2:20-25`). The rune platebody needs Dragon Slayer as well
  (`tier40.rs2:26`), so it is not assumed. Dragon weapons need other quests
  (`tier60.rs2`).

## Helper-supplied items

Tradeability is read from each obj config. One trade (9 ticks, `primitives.md` §6), made
before talking to Lathas, carries everything; the combat gear is assumed already owned.

| Item | Tradeable | Note |
|---|---|---|
| Shortbow (any bow) | yes | wielded only for the bridge shot |
| Bronze arrows ×3 | yes | 1 per bridge shot; the spares cover misses |
| Tinderbox | yes | lights the fire arrow, then the tomb |
| Rope ×2 | yes | the swing uses one up; the second covers a failed swing |
| Spade | yes | the mud in area 2 |
| Bucket | yes | the dwarf brew; one also lies at (2309,9801) |
| Swordfish (or sharks) ×20 | yes | traps cost about 80-120 hp before the well; fights little at 70 |
| Damp cloth, fire arrows, orbs, railing, horn, badges, cat, doll, amulets, shadow, brew, ashes, dove | **no** (`upass.obj`, `firemaking.obj:82`) | quest items the scored account collects itself |

Keep 4 inventory slots free for the witch's chest (doll, journal, two potions;
`kardia.rs2:107-112`). Lit fire arrows are tradeable (`arrows.obj:1012-1035`), but they
can only be made from Koftik's untradeable damp cloth, so a helper could only supply them
after starting the quest itself. Klank's gauntlets are not needed: without them the dove's
cage bites for 10 hp (`quest_upass.rs2:515-522`, measured 10).

## Map and stages

`%upass` (perm) runs 0-9, complete 10 (`quest_upass.constant`, `quest.constant:58`).
`%ibanmulti` (perm) is a bitfield: bits 1-4 the doll's blood, dove, ashes and shadow, 5-8
the four orbs, 9 the cat, 11 started, 14-16 the badges, 17 Koftik's madness scene, 18 the horn,
21 the brew, and bits 22-31 the grid answer (three digits 1-5, each within 1 of the last),
drawn when Lathas starts the quest (`upass_grid.rs2:47-58`). Everything is perm, so the
quest is logout-safe throughout. The cave is three level-0 areas under West Ardougne
(area 1 behind the bridge, area 2 below the well, area 3 behind the unicorn tunnel), then
Iban's cavern on level 1 (`1_33_71-73`) with the dwarves and Kalrag below it on level 0.
The ledge and the stone bridges are bridge-flagged map tiles: the engine puts them on
level 0, but the lite client does not list them, so they are clicked by id.

## Step list

Raw counts: route tiles walked, dialogue pages (p) and options (o), crossings. "Measured"
rows name the segment in `quest-underground-pass-segments.ts`; every crossing is clicked on its
loc and walking follows the planner's cheapest route
(`quest-underground-pass-route.ts`). One sample per step unless shown.

| # | Where | Action | Varp | Raw counts | Ticks | Label |
|---|---|---|---|---|---|---|
| 0 | King Lathas | Trade from a helper (the list above) | | 1 trade | 9 | measured, `primitives.md` §6 |
| 1 | King Lathas (2578,3293,1), throne room | Talk; no options | `ibanmulti` bit 11 + grid answer | 11p | 24 | measured, `start` |
| 2 | Lathas → cave entrance (2433,3313) | Castle stairs, out of the castle, the West Ardougne wall doors (open at `%biohazard` 16, `area_ardougne_west/scripts/doors.rs2:24-51`), 119 tiles west | | 1 climb, 2 doors, ~140 tiles | 124 | measured by plague-city (`quest-biohazard-segments.ts westgate`) |
| 3 | Cave entrance | Click it: Koftik's first dialogue, "I'll take my chances." | 0 → 1 | 9p 1o | 25 | measured, `start` |
| 4 | → Koftik at the bridge (2449,9716) | Enter (p_delay 3), three rockslides (2478,9721), (2467,9723), (2460,9720) | | 49 tiles, 4 crossings | 49 | measured, `entry` (48-49 in 5 runs) |
| 5 | Koftik | "Not to worry, probably just litter."; he gives a damp cloth | | 8p 1o | 20 | measured, `entry` |
| 6 | Inventory | Cloth on a bronze arrow, tinderbox on it, wield it (bow already wielded) | | 3 clicks | 6 | measured, `entry` |
| 7 | → (2446,9722) | Walk to the shooting tile (z ≥ 9720, east of the rope, `upass_bridge.rs2:34-41`) | | 23 tiles | 13 | measured, `entry` |
| 8 | Guide rope (2443,9718) | Fire-at: Ranged roll; the bridge drops and a forced walk carries you round to (2442,9716) | 1 → 2 | 1 roll | 31 | measured, `entry`, `rolls bridgeshot` (34 click to idle, n=45) |
| 9 | → rope swing (2462,9699) | Rope on the rock; Agility roll; rope used up; then rockslides (2491,9691) and (2482,9679) to the grid's east edge (2477,9677) | | 100 tiles, 3 crossings | 74 | measured, `entry` (73-74 in 5 runs) |
| 10 | Grid (2467-2476, 9673-9682) | Walk the safe strips of your answer, west to (2466,9673) | | ~25 tiles | 17 | measured, `entry` (answer 343) |
| 10a | Grid, first pass | Expected falls while finding the answer: ~3.6 × (fall 5 + climb 3 + walk back ~7) | | ~3.6 falls, 15 hp each | ~55 | inferred: fall and climb measured (`gridfall`), count from the answer's distribution |
| 11 | Portcullis lever (2466,9672) | Pull: forced walk through to (2464,9677) | | | 8 | measured, `entry` |
| 12 | Area 1, orbs | Orb 1: search the flat rock (2382,9668), "Yes, I'll give it a go.", Thieving roll; orbs 2-4 are ground items at (2386,9677), (2385,9685), (2416,9698). Order portcullis → 1 → 2 → 3 → 4 (best of 24 orders by the planner; the worst is 19 tiles longer) | | 250 tiles, 1p 1o, 3 pickups | 10 + 6 + 137 walking = 153 | measured, `orbs` |
| 13 | → furnace (2454,9682) | Use each orb on it (`p_delay(2)` twice each, `quest_upass.rs2:110-117`) | bits 5-8 | 57 tiles, 4 uses | 31 + 29 = 60 | measured, `orbs` |
| 14 | → well (2416,9674) | Climb down: lands at (2423,9660) | 2 → 3 | 36 tiles | 24 | measured, `orbs` |
| | | Trap damage on steps 12-14: five spear traps and nine flat rocks lie on one-tile corridors, so they cannot be avoided without the plank | | ~80-120 hp | (7 swordfish eaten while walking, no ticks lost) | measured, `orbs` |
| 15 | Area 2 | Pick the south-east cage gate (2393,9655), spade on the mud (2393,9650), the ledge (2374,9644 → 2374,9638, Agility roll), the two Thieving-50 cage doors (2380,9619) and (2404,9620), to the pipe (2417,9605) | | 138 tiles, 5 crossings | 102 | measured, `area2` and `post` (102 in both) |
| 16 | Pipe (2417,9605) | Squeeze through west (one-tile jump at `%upass` 3) | | | 15 | measured, `area2` |
| 17 | Unicorn cage (2397,9605) | Search: a piece of railing | | 15 tiles | 9 + 6 = 15 | measured, `area2` |
| 18 | Boulder (2396,9595) | Railing on it: it falls on the unicorn and you are moved 25 tiles west; one page | 3 → 4 | 1p | 17 + 5 = 22 | measured, `area2` |
| 19 | Smashed cage (2371,9603) | Search: unicorn horn; one page | | ~9 tiles, 1p | 20 | measured, `area2` |
| 20 | Tunnel (2375,9611) | Pass-through to area 3 (2371,9666) | | 4 tiles | 3 | measured, `area2` |
| 21 | → paladins (2422-2426, 9718) | Walk | | 83 tiles | 47 | measured, `paladins` |
| 22 | Sir Jerro, Sir Carl, Sir Harry | Fight each (see Fights); pick up each badge | | 3 fights, 3 pickups | 3 × 76 + 9 = 237 | measured (`paladins`, `fights`) |
| 23 | → well of flames (2373,9718) | Walk (one flat rock on the way) | | 58 tiles | 30 | measured, `paladins` |
| 24 | Well of flames | Use the three badges and the horn on it (`p_delay(1)` each) | bits 14-16, 18 | 4 uses | 16 | measured, `paladins` |
| 25 | Door (2368,9717) | Open: Iban's cavern (2173,4725,1) | 4 → 5 | | 2 | measured, `paladins` |
| 26 | Cavern → dwarves | Walk south, stairs (2150,4545) down, walk to (2336,9794) | | 186 tiles, 1 climb | 97 | measured, `cavern` |
| 27 | Nilhoof (2315,9806) | Walk 44 tiles; talk, no options; he gives food | 5 → 6 | 10p | 24 + 26 = 50 | measured, `cavern` |
| 28 | → stairs up (2336,9793) → cat (2131,4602,1) | Walk, climb, two broken bridges (2156,4582), (2147,4583); pick up the cat | | 144 tiles, 3 crossings | 25 + 71 + 2 = 98 | measured, `cavern` |
| 29 | Witch's door (2158,4566,1) | One broken bridge; use the cat on the door (you hide, `p_delay(5)`); open the door; open the chest (2157,4564): doll, journal, potions; open the door again to leave | 6 → 7, bit 9 | 55 tiles, 1 crossing, 2p | 40 + 10 + 7 + 15 + 6 = 78 | measured, `cavern` |
| 30 | Doomion, Holthion, Othainian | Two broken bridges to Doomion (2134,4565); fight each, pick up each amulet; one bridge each way to Othainian (2122,4562) | | 92 tiles, 4 crossings, 3 fights, 3 pickups | 49 + 7 + 18 + 20 + 9 + 3 × 76 = 331 | measured (`cavern`, `fights`) |
| 31 | Sealed chest (2136,4578) | Open with the three amulets: Iban's shadow; shadow on the doll | bit 4 | 2 clicks | 12 | measured, `cavern` |
| 32 | → dwarves | Three broken bridges, stairs down | | 116 tiles, 4 crossings | 85 | measured, `cavern` |
| 33 | Brew barrel (2327,9799) | From its west side (2326,9799) only; open the house door; bucket on the barrel | | 52 tiles, 1 door | 32 + 2 = 34 | measured, `brew` |
| 34 | Iban's tomb (2356,9800) | Brew on it, tinderbox on it (it burns), Iban's ashes; ashes on the doll (`p_delay(7)`) | bits 21, 3 | 62 tiles, 3 clicks | 37 + 2 + 5 + 10 = 54 | measured, `brew` |
| 35 | Kalrag (2356,9911) | Walk; fight; his death queue smears the doll with blood | bit 1 | 110 tiles, 1 fight | 56 + 76 = 132 | measured (`brew`, `fights`) |
| 36 | → dove cage (2134,4702,1) | Walk, stairs (2304,9915) up, one broken bridge; search the cage (bitten for 10 hp), dove on the doll | bit 2 | 165 tiles, 2 crossings | 99 + 11 + 6 = 116 | measured, `brew` |
| 37 | → Iban disciples (2153,4646,1) | Two broken bridges; kill one disciple (level 13), pick up both robes | | 106 tiles, 2 crossings, 1 fight | 78 + 16 + 5 = 99 | measured, `iban` |
| 38 | Inventory | Unequip all six worn items, wear both robes | | 8 clicks | 12 + 4 = 16 | measured, `iban` |
| 39 | Temple doors (2143,4647,1) | Walk 7 tiles; open (from the east) | 7 → 8 | | 5 + 8 = 13 | measured, `iban` |
| 40 | Well of the damned (2136,4647) | Use the doll on it; Iban dies; you are thrown out to (2482,9607,0) | 8 → 9 | | 23 | measured, `iban` (7 hp lost to Iban's bolts) |
| 41 | → Koftik (2443,9607) | Walk; talk: he leads you out to (2481,9717) | | 39 tiles, 6p | 23 + 14 = 37 | measured, `iban` |
| 42 | → exit (2496,9713) | Walk; leave (`p_delay(3)`): outside at (2436,3315) | | 14 tiles | 8 + 5 = 13 | measured, `iban` |
| 43 | → King Lathas | Wall doors, castle stairs up | | ~140 tiles, 1 climb, 2 doors | 112 | inferred by plague-city from their measured legs |
| 44 | King Lathas | "Indeed, the quest is complete"; no options | 9 → 10 | 5p | 12 | measured, `handin` |

What the order is free to change: little. The bridge needs `%upass` 1 (Koftik), the well
needs all four orb bits, the paladin door needs bits 14-16 and 18, and the cavern's
cat, Nilhoof and chest set 6 and 7 in turn. The four doll parts all need `%upass` 7
and the doll (the amulets only drop at 7, `doomion.rs2:8`; the brew pours only at 7,
`quest_upass.rs2:448`; Kalrag's blood needs 7, `kalrag.rs2:16`), so steps 30-36 can be
reordered. The order above is the one that visits the cavern's south end, the dwarves and
Kalrag's north end once each.

## Fights

Read from `upass.npc`; all were fought with a rune scimitar on aggressive, rune full helm,
chainbody, platelegs, kiteshield and amulet of strength, swordfish eaten below 40% hp
(`quest-underground-pass-segments.ts fights --rounds=3`, plus the quest-segment runs).
Ticks are from the attack click to the NPC gone, including a few tiles of approach.

| Fight | Combat, hp | Mechanic | 70/70/70, 70 hp: ticks | 50/50/50, 50 hp: ticks | Level-ups at 50 |
|---|---|---|---|---|---|
| Sir Jerro / Carl / Harry | 62, 57 each; magic defence -10 | not aggressive; each drops its badge to the hero (`sir_jerro.rs2:1-10`) | 36, 51, 53, 62, 76, 86, 104, 115, 144: **median 76**, lowest hp 51, no food | 100, 130, 142, 144, 164, 174: **median ~143**, lowest hp 20, no food | 2 per fight |
| Doomion / Holthion / Othainian | 91, 87 each; magic defence -10, demonbane-vulnerable | each drops its amulet at `%upass` 7 only, to the hero | 65-109 (n=12): **median 76**, lowest hp 44, 0 food | 92-142 (n=9): **median 105**, lowest hp 17, 1 food in 9 | 3-4 per fight |
| Kalrag | 89, 78; stab | his death queues `defeat_kalrag` on the hero, which also sets nearby blessed spiders on you (`kalrag.rs2:1-14`) | 51, 66, 87, 94: **median ~76**, lowest hp 57 | 109, 243, and one run that did not finish in 600 ticks; lowest hp 15 | 3-8 |
| Iban disciple | 13, 20 | drops both robes (`iban_disciple.rs2:23-31`) | 14, 18 in the quest runs (42-48 with the fight script's approach) | 23, 26, 45 | 0-1 |

At 70/70/70 the fights need almost no food and produce no level-up dialogues (the lab
set the levels with `::setstat`, so a real account may see an occasional one). At
50/50/50 every fight is interrupted by level-up dialogues; the fight loop dismisses them
and clicks attack again. 50/50/50 is survivable with food against everything but costs
about 2× the ticks. Silverlight would add 60% max hit against the demons
(`player_melee.rs2:25-27`) if the account already owns it. Sir Carl never engaged in the
fight-only runs (its staging tile was wrong); in the quest run he took 51 ticks.

## Failure rates and what a failure costs

Every random obstacle rolls `stat_random(stat, low, high)`: success when
`floor(low×(99−L)/98) + floor(high×(L−1)/98) + 1` exceeds a random 0-255, with L the
current level (read, `PlayerOps.ts:591-600`). Measured with
`quest-underground-pass-rolls.ts <obstacle> <level> 25` (25 attempts each); every
measured rate is within sampling error of the formula.

| Obstacle (roll) | Count on the quest route | Level: expected success / measured (n=25) | Failure cost (ticks, beyond the retry) | Label |
|---|---|---|---|---|
| Rockslide (agility 160/300) | 5 | 40: 84.4% / 84%; 60: 95.3% / 88%; 70+: 100% | ~2 and 3 hp; just retry | measured |
| Rope swing (agility 100/410) | 1 | 40: 87.5% / 92%; 60+: 100% / 100% | **~205**: pit (2485,9649) → five pit rockslides → rock pile → three entrance rockslides → Koftik → new cloth → new shot → swing again with a second rope; 15% hp + 1 | measured, `swingfail` (132 + 10 + 6 + 10 + 31 + the failed swing ~15) |
| Ledge (agility 200/260) | 1 | 40: 87.5% / 84%; 60: 92.2% / 96%; 70: 94.9% / 96%; 80: 96.9% / 100%; 99: 100% | ~46: rat pit → cage gate → mud → ledge top again; 5 hp | measured, `ledgefail` (42 + 4) |
| Broken bridge (agility 160/300) | 13 | 40: 84.4% / 80%; 60: 95.3% / 100%; 70+: 100% | ~75-95: you land on level 0 under the cavern, walk back up the stairs; 25% hp + 4 | measured, `bridgefall` (71 and 93 for the bridge at (2155,4718)) |
| Bridge shot (ranged 160/300) | 1 | 25: 75.8% / 80%; 60: 95.3% / 96%; 70+: 100% | ~61: the arrow is lost; back to Koftik for a cloth (20), make it (6), walk (13), shoot | inferred from measured parts (`entry`, `rolls bridgeshot`) |
| Cage gate (thieving 128/400) | 1 | 1: 50.4% / 52%; 25: 75.8% / 63%; 50+: 100% | ~2; retry | measured |
| Log trap for orb 1 (thieving 160/300) | 1 | 1: 62.9% / 64%; 50: 90.2% / 88%; 70+: 100% | ~10 (thrown back 5 tiles, up to 5 hp, then a new attempt with its dialogue) | measured |
| Stone bridge (agility 160/300) | 0 (5 without Thieving 50) | 40: 84.4% / 76%; 60: 95.3% / 100% | not measured | |
| Grid (no roll) | first pass ~3.6 falls | the answer is fixed per account; a second pass has no falls | ~15 and 15 hp per fall | inferred (`gridfall`: fall 5, climb 3) |

Expected extra ticks from failures on the quest route (cost × (1−p)/p, summed):

| Stats | Agility rolls | Ranged | Thieving | Total expected |
|---|---|---|---|---|
| Agility 99, Ranged 60, Thieving 50 | 0 | ~3 | ~1 | **~4** |
| Agility 70 | ~3 (the ledge) | | | |
| Agility 60 | ~60 (mostly the 13 bridges) | | | |
| Agility 40 | ~240 (bridges ~205, swing ~29, ledge ~7) | | | |
| Ranged 25 | | ~20 | | |
| Thieving 1 | | | ~8, plus the stone-bridge detour (~11 + five Agility rolls) | |

Agility 70 is the threshold that matters: from 70 the rockslides, the swing and all 13
bridges can no longer fail, and only the ledge (5% at 70) remains.

### Very low Agility: Underground Pass as the first Agility source

Underground Pass has no Agility check, so it could come before Grand Tree (whose Agility
25 costs 122-159 ticks of Gnome laps for a fresh account, `docs/speedrun/skills/agility.md`
§3 on the rs/2 branch). At Agility 1-10 the rolls fail often. Success chances below are
from the engine formula (read, `PlayerOps.ts:591-600`; the rates measured at 40 and 60
match it), and the failure costs are the measured ones from the table above (the bridge
fall is the mean of the two measured, 82). The pass's own Agility xp (3 base per pipe,
`upass_obstacles.rs2:77,366`) does not move the level meaningfully before the reward.

| Obstacle (count) | Success at 1 | at 10 | Expected extra ticks at 1 | at 10 |
|---|---|---|---|---|
| Rockslide 160/300 (5) | 62.9% | 67.6% | 6 | 5 |
| Rope swing 100/410 (1), ~205 per failure | 39.5% | 50.0% | 314 | 205 |
| Ledge 200/260 (1), ~46 per failure | 78.5% | 80.1% | 13 | 11 |
| Broken bridge 160/300 (13), ~82 per fall | 62.9% | 67.6% | 629 | 511 |
| **Total** | | | **~960** | **~730** |

(inferred: cost × (1 − p)/p per crossing.) For comparison: ~240 at Agility 40, ~60 at
60, ~4 at 70 and above. At Agility 1 the account also expects about 7.7 bridge falls of
25% hp + 4 each and about 1.5 failed swings, so it needs more food than the list above.

The fights make an early slot worse still: at 50/50/50 they cost about 400 ticks more
than at 70/70/70 (measured medians above), with 2-8 level-up dialogues each, and Kalrag
at 50 once ran past 600 ticks without finishing. The demons (91), Kalrag (89) and the
paladins (62) are not safe much below 50/50/50 even with food (inferred from the lowest
hp seen at 50: 15-20).

**Conclusion: Underground Pass before Grand Tree does not pay.** It saves 122-159 ticks of
Gnome laps but costs about 730-960 expected ticks of falls at Agility 1-10, plus the
low-combat fight penalty. Do Grand Tree first (its 7,900 base takes Agility to 75, where
the pass's rolls no longer fail except the ledge at about 5%), or any other early Agility
reward that reaches 70.

## Tick total

| Part | Ticks | Basis |
|---|---|---|
| Travel: walking, the ~45 crossings, stairs, the grid, the two overworld legs (124 + 112) | ~1,560 | measured (steps 2, 4, 7, 9-14, 15-17, 20-21, 23, 26-37, 39, 41-43), overworld legs from plague-city (one inferred) |
| Dialogue: 54 pages and 3 options at 2 ticks (171 ticks of dialogue-bearing steps) | ~170 | measured (steps 1, 3, 5, 12, 18-19, 27, 29, 41, 44) |
| Interactions: arrows, shot, lever, orbs, furnace, railing, boulder, badges, well, cat, chests, amulets, brew, tomb, ashes, dove, robes, doors, doll | ~270 | measured |
| Fights: 3 paladins, 3 demons, Kalrag, a disciple at 70/70/70 | ~550 | measured medians |
| Forced waits | inside the rows above | read: the `p_delay`s (entrance 3, furnace 2+2 per orb, ashes 7, cat 5, ...) are part of each measured step |
| Trade (one helper trade) | 9 | measured, `primitives.md` §6 |
| Grid falls on the first pass | ~55 | inferred (step 10a) |
| **Total, Agility 99 / Thieving 50 / Ranged 60** | **~2,610** | |
| Expected failures at Agility 60 / 40 | +~60 / +~240 | measured rates and costs |
| Fights at 50/50/50 instead of 70 | +~400 | measured medians |

### Dialogue in three columns

Columns as `CONVENTIONS.md` defines them: stock 2 ticks per page or option, fixed client
(cairn://p/rs/22) 1, burst (up to 5 pure-continue pages per tick; a run after an option or
a state-changing page costs 1 + ceil((k-1)/5)). Runs are read from the scripts and match
the measured page counts. `c` is a pure continue, `opt` an option click, `state` a pause
while a script delays or moves the player before the next page.

| Step | Dialogue | Runs | Stock | Fixed | Burst |
|---|---|---|---|---|---|
| 1 | Lathas starts the quest (`king_lathas.rs2:92-110`) | 11c | 22 | 11 | 3 |
| 3 | Koftik at the cave (`koftik.rs2:34-55`) | 7c, opt, 2c | 20 | 10 | 5 |
| 5 | Koftik at the bridge (`koftik.rs2:68-87`) | 6c, opt, 2c | 18 | 9 | 5 |
| 12 | Orb 1 log trap (`upass_obstacles.rs2:222-228`) | 1c, opt | 4 | 2 | 2 |
| 18 | Boulder (`quest_upass.rs2:287`) | state, 1c | 2 | 1 | 1 |
| 19 | Smashed cage (`quest_upass.rs2:309`) | 1c | 2 | 1 | 1 |
| 27 | Nilhoof (`nilhoof.rs2:3-20`) | 9c, state (`p_delay(2)`), 1c | 20 | 10 | 3 |
| 29 | Witch's chest (`kardia.rs2:92-107`) | 1c, state, 1c | 4 | 2 | 2 |
| 41 | Koftik leads you out (`koftik.rs2:133-139`) | 6c | 12 | 6 | 2 |
| 44 | Lathas hand-in (`king_lathas.rs2:81-87`) | 5c | 10 | 5 | 1 |
| | **Total, 54 pages and 3 options** | | **114** | **57** | **25** |

| Column | Quest total (Agility 99, Thieving 50, Ranged 60) | Post-quest traversal (Koftik's cloth, 3c) |
|---|---|---|
| Stock | ~2,610 | ~555 |
| Fixed client | ~2,553 | ~552 |
| Burst | ~2,521 | ~550 |

(inferred: the measured stock totals minus the column differences above.)

With the client fix cairn://p/rs/22 (1 tick per page) the 57 dialogue clicks save about 57
ticks. The measured steps also include a dropped click after most forced moves: the lite client
refuses to send a loc interaction when its own pathfinder finds no route from where it
thinks the player is (runner log: `cant_reach ... nothing was sent`), which is the case
during a forced move. The script re-clicks on the next quiet tick, so this costs about 1
tick per crossing over ~45 crossings; a client that clicks on the exact tick a forced move
ends would save part of that.

## After completion: the traversal Regicide needs

Regicide sends the player back to the Iban temple doors; opening them from the east with
`%regicide_quest` ≥ 2 teleports you to the Well of Voyage area at (2014,4711,1) instead of
entering the temple (read, `quest_upass.rs2:574-584`).

**Measured** (`quest-underground-pass-segments.ts post`, n=4, Agility 99, Thieving 50,
Ranged 60, no failed rolls): cave entrance click to through the temple doors **614-615
ticks** wall clock; the steps themselves sum to **~545**, and a player reacting within a
tick lands at about **555**. Breakdown: enter and three rockslides to Koftik 48-49; Koftik's
cloth at `%upass` 10 (3 pages) 8-9; arrow 6; walk to the shooting tile 11-12; the shot 31;
rope swing and two rockslides 73-74; the grid on the known answer 17; the lever 8; then
the well, cage gate, mud, ledge, two Thieving-50 doors, the pipe (now a 26-tile jump,
`upass_obstacles.rs2:351-352`), the tunnel, area 3 (145 tiles), the door and six broken
bridges to the temple doors 336-337 (444 tiles); the doors 2. 25 hp lost to traps.

What it still needs (read):

- **Yes, a fire arrow.** The bridge only drops when shot from the east bank, and the lever
  on the west bank only carries you west to east (`upass_bridge.rs2:89-106`). Koftik by the
  bridge gives a new damp cloth at any stage when you hold none (`koftik.rs2:58-96`), so
  carry a bow, a bronze arrow and a tinderbox.
- **A rope** for the swing every time, a **spade** for the mud every time.
- The well, the paladins' door and the grid answer persist (perm bits), so no orbs,
  badges or falls. The ledge, the cage gate, the rockslides and the six broken bridges
  still roll; at Agility 60 expect about +30 ticks, at Agility 40 about +130 (six bridges,
  the swing, the ledge), and at Ranged 25 about +16 for misses.
- Nothing in the pass blocks teleports (no wilderness or teleport checks in
  `quest_upass/`).

## Risks and gotchas

- **Death in the temple.** Wearing only the robes, Iban's bolts (5-10 each, eight rounds
  every 10 ticks over the tiles in front of him, `lord_iban.rs2:16-40`) kill a careless
  account: a lab run whose doll use was refused ("I can't reach that!", sent during the
  doors' forced move) died in 38 ticks at 70 hp. Use the doll once the forced move ends, and
  enter with high hp. The bolt damage uses `p_finduid`, which skips a player who is
  delayed, so the doll's own delays give some cover.
- **Trap damage before the well is about 80-120 hp.** The orbs sit at the ends of
  one-tile corridors behind spear traps (10% current hp + 1 per tick on the tile or north of
  it) and flat-rock spring traps (8% base hp + 1). A 70-hp account must eat on the way; the
  plank (2435,9726) disarms flat rocks one at a time but costs a detour and clicks. A lab
  account with 99 hp and 5 swordfish died here.
- **The grid is random per account and unknown on the first pass**: about 3.6 falls
  (15 hp each) expected. Keep hp above 15 on the grid.
- **A failed rope swing costs ~205 ticks** (back through the pit, a new fire arrow and a
  second rope). Agility 60 removes the risk.
- **Death hooks** (coordinator finding 3): Kalrag's `ai_queue3` uses `npc_findhero` and
  queues `defeat_kalrag` on that player, which also turns nearby blessed spiders on you;
  the badges and amulets drop only for the hero (most damage), not the killing blow
  (finding 4 does not apply here). Do not let anyone else out-damage the scored account.
- **Level-up dialogues** interrupt fights at 25x xp (2-8 per fight at 50/50/50; none
  measured at 70).
- **Weapon swaps are not in the step list**: wield the bow before the shot and the
  scimitar again before the paladins (two clicks, about 4 ticks, inferred).
- **The witch's house door closes behind you**; open it again to leave.
- **The brew barrel only works from its west side** (2326,9799), inside a house with a
  closed door.
- **Lathas** talks Regicide first once `%regicide_quest` > 0 (`king_lathas.rs2:2`), so
  Underground Pass must be handed in before Regicide is started.
- **Logout safety:** the whole quest is logout-safe (`%upass`, `%ibanmulti` and
  `%iban_staff_charges` are `scope=perm`, `quest_upass.varp`; the four `.vars` are
  map-clock cooldowns on the swing and pipes). But the hand-in has a consequence for
  Regicide: its messenger timer is armed only at the next login, and timers are not
  saved, so the 400-1,200 ticks that follow must be one session (see `regicide.md`).

## Open questions

- The stone-bridge route (Thieving below 50) was planned, not walked; its fall cost is not
  measured.
- The grid's expected falls assume probing rows in order; a better probing strategy may
  lower the 3.6.
- Lathas → cave and the hand-in walk are plague-city's figures (the hand-in direction is
  inferred).
- Fight samples are small (3-12 per fight) and taken with `::setstat` levels.

## Scripts

- `docs/speedrun/scripts/quest-underground-pass-segments.ts <bot> <segment>`: every timed
  segment above (start, entry, gridfall, orbs, area2, paladins, cavern, brew, iban, handin,
  fights, swingfail, ledgefail, bridgefall, post).
- `docs/speedrun/scripts/quest-underground-pass-rolls.ts <bot> <obstacle> <level> [n]`:
  failure rates and costs of the random obstacles.
- `docs/speedrun/scripts/quest-underground-pass-route.ts [leg...] [--no=kind]`: the offline
  route planner (tiles, crossings, trap tiles) used by the segments and for the orb order.
- `docs/speedrun/scripts/quest-underground-pass-map.ts`: offline region map of the pass.
- The route executor (`travel`, which walks planner routes and clicks each crossing) lives in
  `quest-underground-pass-segments.ts`; timed actions, dialogues, fights and the segment
  recorder come from `speedrun/lib` (act, converse, combat) and `speedrun/lab` (setup, record).
- `docs/speedrun/scripts/quest-underground-pass-explore.ts <bot> <step>...`: the lab console
  used to find coordinates and options.
