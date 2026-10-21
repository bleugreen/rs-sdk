# Biohazard

**Verdict: skip.** Its only route value is as the gate to Underground Pass, which is off
the route along with Legends' Quest and Regicide; see
[the chain verdict](regicide.md#the-regicide-chain-total-and-verdict).

**About 1,560 ticks (about 7.8 minutes at 300 ms), for 3 quest points and 1,250 base
Thieving xp, and the gate to Underground Pass.** Two thirds of the playtime is travel,
and most of that is one forced stretch: the plague sample is destroyed by any teleport
(`~post_tele_checks`), so it must be carried from Elena in East Ardougne to the
Rimmington chemist and on to Guidor in Varrock without teleporting. The best measured
way is the ship to Brimhaven, a walk across Karamja, the customs ship to Port Sarim and
then a 440-tile walk to Varrock (about 520 ticks for that stretch alone). The one fight
(a level-13 mourner) is about 11 ticks.

All tick figures are stock lite-client figures at `NODE_TICKRATE=300`, measured with
`docs/speedrun/scripts/quest-biohazard-segments.ts` unless marked otherwise.

## Reward

- **1,250 base Thieving xp** (read: `stat_advance(thieving, 12500)`,
  `quest_biohazard.rs2:159`; tenths, then 25x). From Thieving 1 that is one level-up
  dialogue (measured: 1 page).
- **3 quest points** (read, `quest.constant:75`).
- **Unlocks Underground Pass**: King Lathas offers it only at `%biohazard` = 16
  (`king_lathas.rs2:73-110`); that start needs Ranged 25 by `stat_base`
  (`king_lathas.rs2:95`), which is Underground Pass's requirement, not Biohazard's.
- **Opens the West Ardougne wall doors** (2557-2558, 3299-3300) for the account
  (`area_ardougne_west/scripts/doors.rs2:24-51`): one click and a 2-tile forcemove,
  measured 5 ticks. Before 16 they never open.
- Lathas also grants his training area (dialogue only; no script checks it).

## Requirements (as this server enforces them)

- **Plague City complete**, enforced by Elena's front door (2592,3339), which opens only
  at `%elenaquest` 29 or 30 (`area_ardougne_east/scripts/doors.rs2:1-5`). Elena herself
  does not check it (`elena.rs2:118-138`).
- **Members world** (`map_members`): the chemist, Hops, Chancy, DeVinci, Guidor and his
  wife, and Guidor's door (`chemist.rs2:2`, `quest_biohazard.rs2:7`, and the others).
- **No skill checks** anywhere in `quests/quest_biohazard/` or the West Ardougne scripts
  (read, grep). The Ardougne teleport used for travel needs Magic 51 by `stat()` and
  `%elenaquest` = 30 (see `plague_city.md`).
- Worn items: the doctors' gown for the mourner HQ doors (`doors.rs2:59`,
  `doors.rs2:2`), and both priest gown pieces for Guidor's door
  (`quest_biohazard.rs2:11`). None has a wield requirement (`levelrequire/`, read).
- Elena hands over each vial and the sample only while more than one inventory slot is
  free (`elena.rs2:83-94`): keep at least 5 slots free.

## Items: helper-supplied and scored-account-only

| Item | Tradeable | Source for the run |
|---|---|---|
| Priest gown (top) and priest gown (bottom) | yes (`quest_biohazard.obj`, no `tradeable=no`) | helper |
| Coins for two ships (60) | yes | helper |
| Law and water runes (3 Ardougne teleports: 6 law, 6 water) | yes | helper |
| Combat gear and food | yes | helper (optional; the mourner is level 13) |
| Bird feed, pigeon cage, rotten apple, doctors' gown, key, distillator, the three vials, plague sample, touch paper | **no** (`quest_biohazard.obj`, `cooking.obj`) | scored account (Jerico's cupboard, ground spawn behind his house at (2618,3323-3325), ground spawn at (2535,3333), the nurse's cupboard, the mourner, the crate, Elena, the chemist) |

**One trade (9 ticks)** carries the priest gown pieces, 60 coins and the runes; combine
it with the Plague City trade if the quests run back to back.

## The item-carrying puzzle (read)

Elena gives liquid honey, ethenea, sulphuric broline and the plague sample
(`elena.rs2:80-95`). The Varrock gate into Guidor's district (3264,3405-3406) has a
guard (`bioguard1`, `wanderrange=0`, always in place) who, while `%biohazard` is 10-13,
searches anyone entering and confiscates the three vials, but not the sample or the
touch paper (`east_gate.rs2:14-39`). The offline pathfinder confirms the district
(Guidor, the Dancing Donkey) has no other entrance (`quest-biohazard-routes.ts`, gate
closed: no route from the south road, Varrock square or Rimmington). So the vials go
with the chemist's errand boys (`%bioerrand` bits, `quest_biohazard.constant:14-22`):

| Errand boy | Correct vial | Wrong vial result |
|---|---|---|
| Hops (drunk) | sulphuric broline (`hops.rs2:43-53`) | he drinks it |
| Chancy (gambler) | liquid honey (`chancy.rs2:32-42`) | he sells it |
| DeVinci (painter) | ethenea (`devinci.rs2:21-32`) | he paints with it |

The boys need no travel time: their Varrock copies (Dancing Donkey, (3268-3274,
3389-3391)) hand the vial back as soon as the bit is set. The scored account carries the
plague sample and touch paper itself. **The sample is deleted by every teleport spell,
jewellery teleport and spirit tree** (`teleport.rs2:94-97` in `~post_tele_checks`). Ships
do not call it (`interface_boat/scripts/sail.rs2` uses a plain `p_telejump`), and the
measured Karamja walk kept it. Losing it is recoverable only at Elena
("I'm afraid I've lost some of the stuff", `elena.rs2:36-54`, stages 10 and 12).

**Regicide bit (read):** the chemist's script checks Regicide first. At
`%regicide_quest` = `^regicide_spoken_iorwerth2` with the alchemy book he sets
`%regicide_bits` bit `^regicide_chemist_chat` (`chemist.rs2:9-18`); between that stage
and `^regicide_spoken_arianwyn` he only talks about the still. Neither branch reaches the
Biohazard dialogue, but Regicide needs Biohazard done first, so the two never collide in
a run.

## Step list

Quest varp `%biohazard` (perm), stages from `quest_biohazard.constant`.

| # | Where | Action | Varp | Pages + options | Ticks | Label |
|---|---|---|---|---|---|---|
| 0 | anywhere | Helper trade | | | 9 | measured, `primitives.md` |
| 1 | → Elena (2592,3336) | Ardougne teleport, run 113 tiles, open her door | | | 4 + 58 + 3 = **65** | teleport measured `primitives.md`, run inferred (68-72 measured with `bot.walkTo`), door measured |
| 2 | Elena | "I'll try to retrieve it for you." | 0 → 1 | 10 + 1 | **28** | measured `east` |
| 3 | → Jerico (2612,3324) | Out of Elena's door, 85 tiles round to his door (2610,3324) | | | 4 + 62 = **66** | measured |
| 4 | Jerico | Talk | 1 → 2 | 7 | **17** | measured |
| 5 | Jerico's cupboard (2611,3326) | Open, search: bird feed | | 2 | 6 + 6 = **12** | measured |
| 6 | Behind his house | Pick up a pigeon cage (2618,3323) | | | **13** | measured |
| 7 | → watch tower (2563,3302) | 93 tiles; use the bird feed on the tower (`p_delay(2)`) | 2 → 3 | | 48 + 4 = **52** | walk measured, feed read (n + 2) |
| 8 | Tower zone | Open the pigeon cage inside (2559-2565, 3299-3307) (`p_delay(4)`) | 3 → 4 | | **6** | read (n + 2) |
| 9 | → Omart (2559,3266) | 35 tiles; talk: he calls Kilron (`p_delay(5)`, `p_delay(3)`), "Ok, lets do it.", the ladder (`p_delay(3)`), land at (2556,3267) | 4 → 5 | 4 + 1 | 19 + 25 = **44** | measured |
| 10 | → rotten apple (2535,3333) | 78 tiles, pick up | | | 47 + 2 = **49** | measured |
| 11 | Mourner HQ yard | Climb the fence (2541,3331) (see Risks), apple on the cauldron (2543,3332) (`p_delay(3)`, `p_delay(2)`), climb back | 5 → 6 | | 10 + 8 + 4 = **22** | measured |
| 12 | → nurse's cupboard (2517,3276) | 68 tiles to its **south** side (2518,3275); open, search: doctors' gown; wear it | | | 44 + 5 + 2 + 2 = **53** | measured |
| 13 | → HQ front door (2551,3320) | 48 tiles; open ("In you go doc.") | | 1 | 25 + 4 = **29** | walk inferred, door measured |
| 14 | HQ | Through the inner door to the spiral stairs (2542,3324), up, open the upstairs door (2547,3325, L1) | | | 20 + 1 + 3 + 2 = **26** | measured `hq` |
| 15 | Upstairs | Kill a sick mourner (2551,3324 or 2551,3326, L1): key | | | **11** | measured (n = 1) |
| 16 | Gate (2551,3325, L1) | Open with the key in the inventory (no delay; *using* the key adds `p_delay(3)`, `quest_biohazard.rs2:141-144`) | | | **3** | measured |
| 17 | Crate (2554,3327, L1) | Search (`p_delay(3)`): distillator | 6 → 7 | | **6** | measured |
| 18 | → Elena | Ardougne teleport, 113 tiles, her door | | | 4 + 58 + 3 = **65** | as step 1 |
| 19 | Elena | Talk: distillator for three vials and the sample (two `p_delay(2)`) | 7 → 10 | 11 | **38** | measured |
| 20 | → Captain Barnaby (2681,3276) | Out of Elena's door, 136 tiles | | | 4 + 69 = **73** | door measured, walk inferred |
| 21 | Ship to Brimhaven | Barnaby, 30 coins | | 3 + 1 | **22** | measured, `primitives.md` §5 |
| 22 | Karamja | Brimhaven dock (2772,3230) to the Musa Point customs officer (2954,3147), 205 tiles | | | **104** (118 measured with `bot.walkTo`, 210 tiles; sample kept) | inferred / measured `karamja` |
| 23 | Customs ship to Port Sarim | Searched (no rum), 30 coins | | 6 + 3 | **31** | measured, `primitives.md` §5 |
| 24 | → chemist (2934,3210) | 104 tiles and his door (2932,3213) | | | **55** | inferred |
| 25 | Chemist | "It's ok, I'm Elena's friend.", "I just need some touch paper for a guy called Guidor." (the other first option makes him confiscate the sample) | 10 → 12 | 14 + 2 | **35** | measured `rimmington` |
| 26 | → errand boys (2931-2935,3219) | Out of his door, give Hops the sulphuric broline, Chancy the liquid honey, DeVinci the ethenea | | 18 + 3 | 17 + 16 × 3 = **65** | measured |
| 27 | → Varrock gate (3263,3405) | 440 tiles, with the sample | | | **221** | inferred (0.5/tile + 1; about 250 with `bot.walkTo`) |
| 28 | Gate | Open: the guard searches (`p_delay(3)`; no vials to take) | | 2 | **11** | measured `varrock` |
| 29 | Dancing Donkey | 24 tiles; Hops (`p_delay(2)`), Chancy (`p_delay(2)`), DeVinci hand the vials back | | 14 | 14 + 17 + 13 + 11 = **55** | measured |
| 30 | → Guidor (3285,3381) | 16 tiles and a door, Guidor's door wearing both priest gown pieces | | | 29 + 2 = **31** | measured |
| 31 | Guidor | "I've come to ask your assistance in stopping a plague.", "I've been sent by your old pupil Elena.", "So what does that mean exactly?" | 12 → 14 | 21 + 3 | **52** | measured |
| 32 | → Elena | Ardougne teleport, 113 tiles, her door | | | **65** | as step 1 |
| 33 | Elena | Talk | 14 → 15 | 9 | **24** | measured `finale` |
| 34 | → King Lathas (2578,3293, L1) | Out of the door, 65 tiles to the castle stairs (2571,3295), up, 5 tiles | | | 4 + 34 + 5 + 7 = **50** | walk inferred (43 measured with `bot.walkTo`), rest measured |
| 35 | King Lathas | "I don't understand...": reward queue, close the scroll, Thieving level-up | 15 → 16 | 24 + 1 + 1 level-up | 52 + 4 = **56** | measured |

Fixed order: everything up to step 19 is gated stage by stage. The chemist must come
before Guidor (Guidor only acts at 12, `guidor.rs2:13`). Elena (step 33) must come
before Lathas.

### The sample stretch: options (steps 20-27)

| Route from Elena to the chemist with the sample | Ticks | Basis |
|---|---|---|
| Ship to Brimhaven, walk Karamja, customs ship, walk to Rimmington (steps 20-24) | 73 + 22 + 104 + 31 + 55 = **285** | ships measured, walks inferred |
| Walk all the way (700 tiles, via Catherby and Taverley) | about **355** | inferred |

Rimmington to Varrock has no alternative to walking (no teleport, no ship). That is
why the stretch costs about 520 ticks.

## Fights

**Sick mourner** (`mournerstew2`, `area_ardougne_west/configs/mourner.npc:145-177`):
combat level 13, 19 hitpoints, attack/strength/defence 10, crush attacks, two in the
upstairs room, `respawnrate=140`. Killing one queues the key (`mourner.rs2:68-79`).
Measured at 70/70/70 with a rune scimitar (aggressive), rune helm, platelegs and
kiteshield: **11 ticks** from the attack click to the key, first hit at 4, no food, no
level-ups (n = 1, plus a probe kill of similar length). At any stats above about 20 it
is safe; nothing else in the quest is aggressive while you wear the gown.

Coordinator findings:

- **3 (death hook lost while delayed): does not apply.** The hook uses plain `finduid`
  (`mourner.rs2:70`), which has no `canAccess` check (`PlayerOps.ts` `FINDUID`, unlike
  `P_FINDUID`), and gives the key through a normal `queue`, which waits until the player
  is free. It does require the player to be the mourner's `%npc_aggressive_player`.
- **4 (kill-with-item on the killing blow): does not apply.** No item check on the kill.
- **2 (level-ups):** one Thieving level-up at the end (measured). The fight gives combat
  xp, but at 70 no level was gained. The three Ardougne teleports give 61 base Magic xp
  each (`magic_spells.dbrow:104`), 1,525 game xp, which can trigger Magic level-ups
  depending on the account's level.

## Tick total

| Part | Ticks | Basis |
|---|---|---|
| Travel (teleports, walks, doors, climbs, two ships) | 1,105 | measured where the step says so, otherwise route tiles at 0.5/tile + 1; includes 26 ticks of ship dialogue (13 clicks) |
| Dialogue (138 pages + 11 options = 149 clicks at 2 ticks) | 298 | measured (step totals) |
| Interactions (approaches, item uses, pickups, cupboards, the crate, the gate search) | 141 | measured: step totals minus the dialogue clicks |
| Fight (the mourner, 70/70/70) | 11 | measured |
| Forced waits | about 55, already inside the steps above | read: Omart and the ladder (`omart.rs2:14-18`, `quest_biohazard.rs2:91`, about 18), the cauldron 7, the crate 4, the bird feed 3, the cage 5, Elena 6, the gate search 4, Hops and Chancy 3 each, the fences 2 |
| Trade | 9 | measured, `primitives.md` §6 |
| **Total** | **about 1,564** | |

Raw counts: 162 page and option clicks (149 in steps, 13 on the ships). With the client
fix (1 tick per click) the total is about 1,400.

### Dialogue in three columns

Columns as `CONVENTIONS.md` defines them. Stock and fixed come from the measured counts.
**The burst column is inferred** with the same model as `plague_city.md` (an opening run
of P - 2O continues, then 3 ticks per option for the click and a 2-page run); dialogues
with a script delay in the middle (Omart, Elena's vials, the errand boys in Varrock, the
gate search) are split at each delay, and the ship dialogues are left at the fixed figure.

| Step | Pages + options | Stock | Fixed | Burst (inferred) |
|---|---|---|---|---|
| 2 Elena | 10 + 1 | 22 | 11 | 5 |
| 4 Jerico | 7 | 14 | 7 | 2 |
| 5 cupboard (two mesboxes) | 2 | 4 | 2 | 2 |
| 9 Omart (delays inside) | 4 + 1 | 10 | 5 | 4 |
| 13 HQ door | 1 | 2 | 1 | 1 |
| 19 Elena, vials (two `p_delay(2)` inside) | 11 | 22 | 11 | 5 |
| 25 chemist | 14 + 2 | 32 | 16 | 8 |
| 26 Hops, Chancy, DeVinci in Rimmington | 18 + 3 | 42 | 21 | 12 |
| 28 gate search | 2 | 4 | 2 | 2 |
| 29 the boys in Varrock (delays inside) | 14 | 28 | 14 | 6 |
| 31 Guidor | 21 + 3 | 48 | 24 | 12 |
| 33 Elena | 9 | 18 | 9 | 2 |
| 35 Lathas, reward and level-up | 24 + 1 + 1 | 52 | 26 | 9 |
| Ships (steps 21, 23) | 9 + 4 | 26 | 13 | 13 |
| **Total** | **147 + 15** | **324** | **162** | **~83** |

| Column | Total |
|---|---|
| Stock | ~1,564 |
| Fixed client | ~1,402 |
| Burst | ~1,323 |

## Risks and gotchas

- **Never teleport while holding the plague sample** (steps 19-31). It disintegrates
  (`teleport.rs2:94-97`) and only Elena replaces it.
- **The cauldron is inside the mourner HQ yard.** It cannot be reached from the street;
  climb the fence at (2541,3331) (`general_use/scripts/fence.rs2`, no requirement), 1 tile
  from the cauldron. Using the apple from outside gives "I can't reach that!".
- **The two quest cupboards open from the south.** They have `forceapproach=east` and
  are placed at angle 1, so the forced side rotates; from the east tile the Open click
  silently does nothing (measured on the nurse's cupboard).
- **The HQ has two doors**: the street door (2551,3320) is the one to use; (2551,3328)
  joins the yard to the building.
- **Pick the chemist's second option** ("It's ok, I'm Elena's friend."). The first one
  confiscates the sample (`chemist.rs2:48-51`).
- **Give each errand boy the right vial** (table above); a wrong vial is lost and costs a
  trip back to Elena.
- **Open the HQ gate with a click, not by using the key**: the use adds `p_delay(3)`.
- **Dropped clicks**: in the lab, talk-to and door clicks right after a door or a
  teleport were dropped a few times and re-sent (the scripts re-click after 4 still
  ticks). Re-clicks are inside the measured figures where they happened.
- **Logout-safe.** `%biohazard` and `%bioerrand` are `scope=perm`
  (`quest_biohazard.varp`); the pigeons set no timer, so stage 4 persists (the "before
  the pigeons fly off" line is flavour). The sample survives logout (it is an inventory
  item); only teleports delete it.

## Open questions

- Steps 20-27 are mostly route figures. The Karamja walk was measured (118 ticks for 210
  tiles with `bot.walkTo`, 0.56 per tile), the Rimmington-Varrock walk was not.
- The mourner fight has one clean sample.
- Whether the Varrock gate search can be skipped by entering while the guard is busy: he
  never moves (`wanderrange=0`), and the search fires for anyone within 2 tiles of him,
  so probably not.

## Scripts

- `docs/speedrun/scripts/quest-biohazard-segments.ts <bot> [segment...]`: segments
  `east west hq rimmington karamja varrock finale westgate` (westgate: Lathas to the wall
  doors to Koftik, for Underground Pass: 17 + 4 + 35 + 5 + 63 = about 124 ticks measured).
- `docs/speedrun/scripts/quest-biohazard-routes.ts`: offline route tiles, and the check
  that Guidor's district has no entrance but the searched gate.
- `docs/speedrun/scripts/quest-plague-city-lab.ts`: the shared step driver.
