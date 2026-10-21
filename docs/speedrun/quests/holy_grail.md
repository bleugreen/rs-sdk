# Holy Grail

**About 1,300 ticks (about 6.5 minutes at 300 ms) at 70/70/70 melee, for 15,300
Defence and 11,000 Prayer base xp and 2 quest points**, after Merlin's Crystal
(`merlins_crystal.md`, about 820 more). The Black Knight Titan is the biggest
single cost: about 195 ticks if you fight him with a rune scimitar and switch to
Excalibur for the last hit, against about 330 with Excalibur throughout. The rest
is travel between nine sites, two of them reached through the Fisher Realm
whistle crossing on Karamja.

All ticks are stock-client figures, using `primitives.md`'s measured values where
this document did not measure a segment itself. Lab runs used `NODE_TICKRATE=100`;
figures are in server ticks (see Open questions for the one caveat).

## Reward

- `stat_advance(prayer, 110000)` and `stat_advance(defence, 153000)` (read,
  `quest_grail.rs2:116-117`). These are tenths, so **11,000 Prayer and 15,300
  Defence base xp** (25x in game). That is 27.5% and 38.3% of the 39,938 base xp
  to 99.
- 2 quest points (read, `general/configs/quest.constant:95`, `^grail_questpoints`).
- Measured: the reward conversation set `%grail` to 10 (`quest-holy-grail-segments.ts reward`).

## Requirements (as this server enforces them)

- **Merlin's Crystal complete.** King Arthur offers the quest only at
  `%arthur` = 7 (read, `king_arthur.rs2:41-45`).
- **20 Attack, base level, to wield Excalibur.** No quest script checks Attack,
  but Excalibur's wield goes through `levelrequire_attack(20)`
  (`levelrequire/scripts/tier20.rs2:16`), which tests `stat_base(attack)`
  (`levelrequire.rs2:7`). A boost does not count. The Titan only dies to a hit
  landed while Excalibur is worn (`black_knight_titan.rs2:30`), so the wiki's 20
  Attack is effectively enforced.
- **No other skill check.** No `stat()` or `stat_base()` call anywhere in
  `quests/quest_grail/`, `area_camelot`, `brother_galahad.rs2` or
  `high_priest_of_entrana.rs2` (read, grep).
- **Members world**: the Entrana monk (`area_port_sarim/scripts/monk_of_entrana.rs2:2`)
  and the whistle door (`quest_grail.rs2:31`) check `map_members`.
- **Nothing that counts as a weapon or armour, worn or carried, on the Entrana
  boat**: helmets, bodies, legs, shields, gloves, capes and every weapon category,
  Excalibur included (`monk_of_entrana.rs2:26-53`). Amulets, food and runes are fine.
- **Draynor Manor whistle door**: the holy table napkin in the inventory and
  fewer than 2 magic whistles held (`quest_grail.rs2:31`; the bank is not checked).

## Items: helper-supplied and scored-account-only

| Item | Tradeable | Source for the run |
|---|---|---|
| Excalibur | **no** (`quest_arthur.obj`) | scored account, from Merlin's Crystal; banked before Entrana and taken out again at Draynor |
| Holy table napkin | **no** (`quest_grail.obj`) | scored account: Galahad |
| Magic whistles (2) | **no** | scored account: the Draynor Manor door spawns them. Ground spawns also lie inside both realms, which needs a whistle to reach. |
| Grail bell | **no** | scored account: the fisherman spawns it |
| Magic golden feather | **no** | not needed: it only points to the sacks |
| Holy Grail | **no** | scored account: the healed realm's castle |
| Rune scimitar and armour, swordfish, runes (2 Camelot, 1 Falador), a charged amulet of glory (4 charges: Draynor twice, Karamja twice) | yes | helper; one trade before the quest (food and runes may go to Entrana, the gear goes in the bank with Excalibur) |

## Step list

Quest varp `%grail` (perm), stages from `quest_grail.constant` and
`quest.constant:27`: 0 not started, 2 started, 3 spoken to Merlin, 4 spoken to the
crone, 7 failed against the Titan, 8 finding Percival, 9 Percival has a whistle,
10 complete.

"Measured" step totals run from the talk-to (or loc or item) click to the dialogue
closing, clicking each page as soon as it shows (2 ticks per page or option,
consistent with `primitives.md` §1). Travel rows give route tiles from
`quest-arthur-grail-routes.ts` at 0.5 ticks per tile + 1, unless they say measured.

| # | Where | Action | Varp | Raw counts | Ticks | Label |
|---|---|---|---|---|---|---|
| 1 | King Arthur (2764,3515), straight after the Merlin's Crystal reward | "Tell me of this quest.", "I'd enjoy trying that." | 0 → 2 | 9 pages, 2 options | **25** | measured, `quest-holy-grail-segments.ts start` |
| 2 | → Merlin's workshop door (2764,3503, floor 1) | Run about 14 tiles to the hall staircase, climb, 19 tiles | | about 33 tiles, 1 climb | 8 + 2 + 11 = **21** | inferred |
| 3 | Workshop door, Merlin | Open the door (it spawns Merlin inside, `quest_grail.rs2:1-13`); talk; "Thank you for the advice." | 2 → 3 | 1 door, 9 pages, 1 option | 2 + 25 = **27** | measured, `merlin` |
| 4 | → Draynor bank → Port Sarim monks (3048,3234) | Glory to Draynor Village, run 14 tiles, bank Excalibur and all armour, run 90 tiles | | 1 glory, 104 tiles, 1 bank visit | 6 + 8 + 46 = 60 travel, about 6 banking | inferred |
| 5 | Monk of Entrana | "Yes, okay, I'm ready to go."; ship (`p_delay(13)`); arrival message; gangplank | | 6 pages, 1 option, 1 wait, 1 gangplank | **34** (n=2) | measured, `boatout` (`primitives.md` measured 32) |
| 6 | → High Priest of Entrana (2851,3349) | Run 34 tiles | | 34 tiles | **18** | inferred |
| 7 | High Priest | His dialogue spawns the crone, whose dialogue runs on in the same conversation; "Ok, I will go searching." | 3 → 4 | 9 pages, 1 option | **23** | measured, `priest` |
| 8 | → monk, ship back | Run 34 tiles; "Yes, I'm ready to go."; ship (`p_delay(14)`); gangplank at (3048,3234) | | 34 tiles, 4 pages, 1 option, 1 wait | 18 + **30-32** | measured ship, `boatback` |
| 9 | → Galahad (2612,3474) | Camelot teleport, run 157 tiles | | 1 teleport, 157 tiles | 4 + 80 = **84** | inferred |
| 10 | Galahad | "I seek an item from the realm of the Fisher King." (offered only at `%grail` = 4 with no napkin in the inventory, `brother_galahad.rs2:33`) | napkin | 6 pages, 1 option | **17** | measured, `galahad` |
| 11 | → Draynor bank → Draynor Manor, floor 2 (3105,3364) | Glory to Draynor Village, run 14 tiles, take Excalibur and the gear out and put them on, run 109 tiles, open the front door, two staircases | | 1 glory, about 135 tiles, 1 bank visit, 1 door, 2 climbs | 6 + 8 + 56 + 2 + about 14 = 86 travel, about 8 banking | inferred |
| 12 | Whistle door (3106,3361, floor 2) | Open it from the staircase landing; two whistles drop at (3107,3359); pick both up | | 1 door, 2 pick-ups | **32-41** | measured, `whistles` (n=2) |
| 13 | → Karamja crossing (2740-2743, 3234-3237) | Glory to Karamja, run 237 tiles. With Plague City and Magic 51: Ardougne teleport, 30 tiles to Captain Barnaby, ship (22, `primitives.md` §5), 103 tiles from the Brimhaven dock: about 95. | | 1 glory, 237 tiles | 6 + 120 = **126** | inferred |
| 14 | Fisher Realm, first visit | Whistle in, kill the Black Knight Titan, fisherman, bell, Fisher King, whistle out (sub-steps below) | 4 → 8 | | **about 325** | measured, `quest-holy-grail-realm.ts` |
| 15 | → goblin village sacks (2960,3507) | Falador teleport, run 129 tiles | | 1 teleport, 129 tiles | 4 + 66 = **70** | inferred |
| 16 | Sacks | Open: Sir Percival spawns and talks; "Your father wishes to speak to you." He takes one whistle. | 8 → 9 | 10 pages, 1 option | **25** | measured, `percival` |
| 17 | → Karamja crossing | as step 13 | | | **126** (or about 95) | inferred |
| 18 | Healed Fisher Realm | Whistle in (lands at (2678,4715) once `%grail` ≥ 9, `quest_grail.rs2:39-42`); run 102 tiles through 5 doors to the castle staircase (2648,4683); staircase up; ladder up (2651,4684); take the Holy Grail from (2649,4684, floor 2); whistle out | | 2 whistles, 102 tiles, 5 doors, 2 climbs, 1 pick-up | 1 + 85 + 2 + 4 + 5 + 1 = **98** | measured, `realm2` (the walk used `bot.walkTo`) |
| 19 | → King Arthur | Camelot teleport, run 34 tiles | | 1 teleport, 34 tiles | 4 + 18 = **22** | inferred |
| 20 | King Arthur | Talk with the Grail in the inventory | 9 → 10 | 3 pages | **8** | measured, `reward` |

The order is fixed by the varp gates: Merlin needs 2, the High Priest 3 or more,
Galahad 4, the whistle door the napkin, the sacks 8 (from the Fisher King), and
the healed realm 9 (from Percival). The fisherman, the bell and the Fisher King
do not check `%grail` at all; the Fisher King raises any value below 8 to 8
(`fisher_king.rs2:31-33`). That does not open a shortcut, because entering the
realm needs a whistle, and whistles need the napkin, which needs `%grail` 4.

### Step 14 in detail: the first Fisher Realm visit

Measured with `quest-holy-grail-realm.ts` (rune armour, amulet of strength,
aggressive style): 18 Titan fights, 5 complete visits.

| Sub-step | Action | Raw counts | Ticks | Notes |
|---|---|---|---|---|
| a | Blow the whistle in the crossing zone; land at (2806,4715) | 1 item click | 1-3 | |
| b | Attack the Black Knight Titan (2791,4722) directly (no need to talk); his death teleports you one tile past him | fight | **about 195** (rune scimitar, Excalibur at ≤ 30 Titan hp) or **about 330** (Excalibur only) | see Fights |
| c | Run 22-24 tiles to the fisherman (2802,4706) on the river's south bank | 23 tiles | 14-16 | the river (blocked tiles at z 4707-4710) cuts the arrival bank off from him; only the Titan's death teleport crosses it |
| d | Fisherman: "Any idea how to get into the castle?" Spawns the Grail bell at (2762,4694) for 500 ticks (`grail_fisherman.rs2:12`) | 6 pages, 1 option | 14 | |
| e | Run 49-54 tiles to the bell and take it | 52 tiles, 1 pick-up | 33-35 | |
| f | Stay on the bell tile until a Grail maiden is within 4 tiles, then ring the bell; you are moved inside to (2761,4692) | 3 pages (1 page per failed ring) | 8, plus a wait of 0-90 | the bell needs `npc_find(coord, grail_maiden, 4, 0)` (`quest_grail.rs2:54`); see Risks |
| g | Run 12 tiles to the staircase (2761,4680), climb | 12 tiles, 1 climb | 8-15 | |
| h | Through the doors at (2766,4684) and (2766,4688) to the Fisher King | up to 2 doors | 2-26 (median 8) | the doors close again on a timer |
| i | Fisher King: "You don't look too well." | 9 pages, 1 option | 20 | sets `%grail` 8 |
| j | Blow the whistle; land at (2741,3235) on Karamja | 1 item click | 1 | |

Typical total with the weapon switch: 1 + 195 + 15 + 14 + 34 + 15 (expected wait,
inferred) + 8 + 11 + 8 + 20 + 1 = **about 325**. The five complete visits summed
to 287 and 299 (scimitar and switch), 406 (switch at ≤ 20 and 26 ticks at the
doors), 434 (with the prayer, including a 90-tick maiden wait) and 423 (Excalibur
only), counting the sub-steps above.

## Fights

**Black Knight Titan** (read, `fisher_realm.npc`): combat level 120, 142
hitpoints, attack 91, strength 100, defence 91; crush attacks every 7 ticks;
defence bonuses stab 18, slash 27, crush 18; magic and ranged defence 1000; does not
move (`moverestrict=nomove`, `blockwalk=all`). When his hitpoints reach zero
(`ai_queue3`, `black_knight_titan.rs2:10-25`) he dies only if you are wearing
Excalibur (`inv_total(worn, excalibur)`, line 30). Otherwise he heals to full, says
two pages ("Puny mortal...", "INVINCIBLE!!!"), and `%grail` 4 becomes 7.

Since only the killing blow needs Excalibur, fight with a stronger weapon and
switch when his hitpoints are low. Excalibur is slash 29, strength 25, attack rate 5;
a rune scimitar is slash 45, strength 44 at the default rate (read, `.obj` params).
The dragon longsword is not an option without Lost City (`tier60.rs2:5`).

Measured at 70/70/70, 70 hp, attack click to the death teleport:

| Plan | Ticks per run | Mean | Food (swordfish) | Lowest hp |
|---|---|---|---|---|
| Excalibur throughout | 378, 308, 342, 287, 344, 331, 314 | **329** (n=7) | 0-8 | 22 |
| Rune scimitar, switch to Excalibur at ≤ 30 Titan hp | 209, 118, 247, 224, 168, 127, 180, and with Protect from Melee 251, 227 | **195** (n=9) | 0-4 (none with the prayer) | 22 (70 with the prayer) |
| Rune scimitar, switch at ≤ 20 | 230, 204 | 217 (n=2) | 0 | 46 |

No run killed him before the switch (0 reheals in 11 switch runs). The
threshold has to stay above the scimitar's max hit, or a reheal costs roughly
another full fight; 30 left a safe margin here. With Protect from Melee (43
Prayer) the account took no damage in either run and ate nothing.

Minimum stats: not measured. 20 base Attack is the floor (to wield Excalibur);
with 91 Defence the fight would be very long at low Attack (inferred). His stab
and crush defence (18) are lower than his slash (27), so a stab or crush weapon may
beat the scimitar (inferred, not measured).

## Tick total

| Part | Ticks | Basis |
|---|---|---|
| Travel (steps 2, 4, 6, 8 walk, 9, 11, 13, 15, 17, 19, the realm runs and whistles in 14 and 18) | 794 | measured where the step says so, otherwise route tiles at 0.5/tile + 1, teleports from `primitives.md` |
| Dialogue (84 page and option clicks at 2 ticks) | 168 | measured (the step totals), consistent with `primitives.md` |
| Interactions (talk-to approaches, doors, gangplanks, pick-ups, bank visits) | 90 | measured step totals minus dialogue; the two bank visits (14) are inferred |
| Fight (Black Knight Titan, scimitar and switch) | 195 | measured mean, n=9; 329 with Excalibur only |
| Waits | 46 | the two ship delays, 15 + 16 (measured); the maiden wait, about 15 (inferred from 10 rings: 0 in most, 90 at worst) |
| Trade (one helper trade) | 9 | measured, `primitives.md` ¦6 |
| **Total** | **about 1,300** | 1,440 with Excalibur only; about 1,240 using the Ardougne ship for both crossings |

With the client fix cairn://p/rs/22 (1 tick per page), dialogue drops to about 84
and the total to about 1,220. Merlin's Crystal adds about 820 if it is done only
for this quest.

## Risks and gotchas

- **A Titan reheal costs a whole fight.** Excalibur must be worn when his
  hitpoints reach zero. Switch with a margin above your max hit.
- **The Entrana boat refuses weapons and armour, even in the inventory.** Bank
  Excalibur (untradeable) and the gear first; there is no deposit box script in
  this content (read, grep). Draynor bank is the cheapest: the same glory trip
  passes it again on the way to the manor.
- **The bell needs a maiden within 4 tiles** (Chebyshev, walls ignored). The
  maidens wander inside the castle, so walking towards one from outside does not
  help: in two lab runs it led the bot round the castle for 60-80 ticks. Stay on
  the bell tile and ring as soon as one is in range (probe of 8 rings: 6 had a
  maiden in range at once; the worst wait measured was 90 ticks). The bell only
  lasts 500 ticks; the fisherman spawns another.
- **The fisherman cannot be reached before the Titan**: the river south of the
  arrival point is impassable (map flags at z 4707-4710).
- **Open the whistle door from the staircase landing** (3105,3364). Standing
  diagonally at (3105,3362) gives "I can't reach that!". The whistles only appear
  with the napkin in the inventory and fewer than 2 whistles held, and they are
  short-lived (`^lootdrop_duration / 2`).
- **Keep two whistles.** Percival takes one (`sir_percival.rs2:43-47`); you need
  the other to enter the healed realm. A whistle works only in the Karamja zone
  (2740-2743, 3234-3237) or inside the realm (`quest_grail.rs2:37-50`).
- **The Fisher King's doors close again** after a while; open whichever is shut.
- **Level-up dialogues** at 25x xp can interrupt the Titan fight; dismiss them
  without dismissing his "invincible" dialogue, which means a reheal.
- **Logout-safe.** `%grail` is `scope=perm` (`quest_grail.varp`), and the quest
  touches none of the temporary varps in `primitives.md` §8. Spawns (Merlin, the
  crone, Percival, the bell, the whistles) are short-lived and are recreated by
  repeating their step.
- **King Arthur's grail branch overrides his Merlin's Crystal branch** whenever
  `%grail` > 0 (`king_arthur.rs2:2`). That cannot happen in a real run, but a lab
  account must reset `%grail` to 0 before testing the Merlin's Crystal reward.

## Open questions

- Not measured: the Draynor Manor interior (front door to the floor-2 landing),
  the two bank visits, the Ardougne-Brimhaven crossing end to end, and the Titan
  below 70/70/70.
- The healed-realm walk (step 18) used `bot.walkTo` through 5 doors: 85 ticks for
  102 route tiles. Chained clicks (`primitives.md` §2) should take about 60.
- Fight loops were timed at a 100 ms tick. The weapon switch reacts to the Titan's
  hitpoints one observation late; at 300 ms that is still one tick, so the
  30-hitpoint margin should hold, but it was not re-run at 300 ms.
- Whether Defence xp has any value depends on what other quests already cap;
  that valuation belongs to the README.

## Scripts

- `docs/speedrun/scripts/quest-holy-grail-realm.ts <bot> [att str def hp] [pray] [weapon=<obj>] [swap=<hp>]`:
  step 14, from the whistle in to the whistle out.
- `docs/speedrun/scripts/quest-holy-grail-segments.ts <bot> [segment...]`: every
  other segment (start, merlin, boatout, priest, boatback, galahad, whistles,
  percival, realm2, reward).
- `docs/speedrun/scripts/quest-arthur-grail-routes.ts`: route tiles for the travel
  legs (offline).
- `docs/speedrun/scripts/quest-lab.ts`: shared helpers.
