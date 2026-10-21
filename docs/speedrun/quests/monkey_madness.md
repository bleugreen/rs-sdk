# Monkey Madness

> **Blocker with the stock lite client.** The hangar puzzle (step E) moves tiles
> only through OPHELD5 on `reinitialisation_puzzle:com_3`; the stock lite client
> sends INV_BUTTON5 for every non-inventory component, which no script handles
> (`No trigger for [inv_button5,reinitialisation_puzzle:com_3]`, measured). So a
> bot cannot finish this quest until cairn://p/rs/23 lands. Glough's 200,000-coin
> shortcut does not help: it leaves the puzzle one slide from solved, and that
> slide is the same OPHELD5. Everything below assumes the rs/23 fix; the puzzle
> segment was **measured with the rs/23 fix (lab client)**.

**Verdict: about 4,500 ticks (stock client), about 3,950 with 1-tick pages,
about 3,600 with dialogue bursts, for 110,000 base combat xp.** At the combat
rate (about 14 base xp per tick, README) that xp is worth about 7,850 ticks, so the
quest nets roughly 3,300-4,250 ticks. It is the most valuable quest in the chain,
but it carries real risk on Ape Atoll (the temple guards and two forced jailings,
see Risks).

**Those totals are the success path.** Three steps are random and can fail; with the
failure costs below, the **expected total is about 5,270 ticks stock, about 4,740
fixed, about 4,370 burst (inferred, mostly from 3-sample observations)**.

### Random steps: success rates, failure costs, expected ticks

| Step | Observed | Failure and what recovers it | Failure cost | Expected extra over the success path |
|---|---|---|---|---|
| Temple trapdoor (H): reach the one access tile (2806,2785) past the 2x2 `blockwalk=all` guards and click | **1 of 3 tries got down** (102 ticks); 1 still pinned after 150 ticks at 5 hp; 1 **died** (measured, lab probe, Protect from Melee on, auto-retaliate off) | **Stuck**: walk out west, eat, drink a prayer dose, try again (about 30 ticks plus the next try). **Death**: respawn in Lumbridge; Varrock teleport, young tree, village tree, stronghold, Daero's blindfold, Waydar, Lumdo, a jail cycle, walk to the temple (about 330); regear by trade (9). This assumes the enchanted bar is among the 3 kept items (it is the most valuable quest item; the stock death rules keep the 3 most valuable). If it is lost, remaking it is about 650 more (another jail and cellar trip for the mould, two dungeon passes, Zooknock) | stuck about 30 + retry; death about 340 (about 990 if the bar is lost) | **about +600** (inferred: with p = 1/3 per outcome, a try costs about 110 + 30/3 + 340/3 = 233 and takes 3 tries on average, about 700, against 102 on the success path) |
| The monkey child (H) while the aunt is near | **1 of 1 talk sequence jailed** (the aunt called guards on the second of four talks, measured) | jail cycle (wake + lock), walk back 44 tiles, repeat the interrupted talk | about 120 | **about +120** (inferred, observed 1 of 1) |
| Jungle demon (L), bow from 6+ tiles | controlled setup 3 of 3 clean kills; an earlier, less controlled batch had 2 deaths in 3 (one 22 ticks after the spawn, before stepping away; one at 242 ticks after the demon got within 2 tiles) | death: respawn in Lumbridge, re-wear the sigil (it teleports you straight back, 44 ticks), regear by trade | about 60 | **about +60** (inferred, about 1 death in 6) |
| Both knockouts (H) and the cell lock | always succeed; only the time varies (55-73 and 15-43 ticks, measured) | | | 0 (the means are already in the total) |
| Dungeon traps (H, 4 passes) | no death in the measured pass (lowest 31 of 70 hp, 5 sharks) | death costs as for the temple | | not included |

Leads for making the temple deterministic (open, not measured; evidence only):

- **Poison, not the guards, may be what kills.** A jungle spider stood among the
  guards in every logged attempt (`Spider@2801,2782` and `@2805,2784` in the probe
  log). Ape Atoll wildlife poisons on about 1 hit in 10 (`aa_wildlife.rs2:1-39`), and
  poison is not blocked by Protect from Melee. A helper-supplied antipoison could
  remove the death outcome.
- **The trapdoor guards wander only 1 tile** (`wanderrange=1`, `maxrange=2`) around
  spawns at (2803,2785), (2805,2783) and (2805,2786) (`quest_mm.npc`,
  `[mm_religious_trapdoor_guard]`), so the access tile opens on a cycle.
  Waiting just outside their 2-tile hunt range and stepping in when (2806,2785) is
  free could make it a timing step instead of a scrum. In the success, the tile came
  free about 94 ticks in.
- **Killing one trapdoor guard** frees the tile for its 25-tick respawn
  (`respawnrate=25`), but at defence 200 and 130 hp (healing 24 below 30 hp,
  `aa_monkey_guard.rs2:45-56`) that is probably slower than waiting.

How the numbers were made. The gnome half (steps A-G) was played on the lab by
`docs/speedrun/scripts/quest-mm-full.ts <bot> [first] [last]`. The Ape Atoll half
was measured segment by segment, because two of its steps are random and can kill
or jail the account (so one scripted end-to-end pass is not repeatable):
`quest-mm-jail.ts` (knockout and cell lock), `quest-mm-atoll.ts` (crates, hole,
cellar, temple, child), the dungeon walk (probe, see step H), `quest-mm-demon.ts`
(the demon) and `quest-mm-puzzle-sim.ts` (the puzzle). Dialogue that was not
played is costed from the scripts' page counts at the measured 2 ticks per page.
Every row of the total says which. Lab ticks were 100 ms; the demon fight was
**not re-run at 300 ms** (CONVENTIONS, reaction-dependent figures).

## Reward

Talk to Daero after the quest and choose a training focus (read,
`quest_mm/scripts/mm_daero.rs2:240-312`):

| Option | Strength | Hitpoints | Attack | Defence | Line |
|---|---|---|---|---|---|
| 1 "Focus on increasing strength and stamina" | **35,000** | **35,000** | 20,000 | 20,000 | `mm_daero.rs2:294-302` (`stat_advance(strength, 350000)` etc.) |
| 2 "Focus on improving attack and defence techniques" | 20,000 | 20,000 | **35,000** | **35,000** | `mm_daero.rs2:303-311` |

All base xp (tenths times 25). Also 3 quest points
(`general/configs/quest.constant:138`), 10,000 coins and 3 diamonds from Narnode
(`mm_narnode.rs2:95-99`), Ape Atoll access, gree-grees, and the monkey in the
backpack.

### The split: both options, with the arithmetic

The README picks after the combat-quest selection; here is what decides it.

- **Attack is already high from this chain.** Tree Gnome Village gives 11,450 and
  The Grand Tree 18,400 base Attack: 29,850 of the 39,938 for 99. Option 1 adds
  20,000 (9,912 above 99, wasted); option 2 adds 35,000 (24,912 wasted). Other
  combat quests that give Attack make both worse.
- **Hitpoints is a byproduct of melee.** Every 4 base xp in Attack, Strength or
  Defence gives 1.33 Hitpoints. If T base xp of melee training is still needed after
  all quests, it brings T/3 Hitpoints. Hitpoints needs no dedicated training as long
  as HP from quests + T/3 >= 39,938.
- **With this chain alone** (no other combat quests): option 1 leaves Strength
  4,938 and Defence 19,938 to train (T = 24,876, about 1,780 ticks at 14 per tick);
  Hitpoints gets 35,000 + 8,292 >= 39,938, so it is free. Option 2 leaves Defence
  4,938 and Strength 19,938 (the same T = 24,876), but Hitpoints then has
  20,000 + 8,292 = 28,292, 11,646 short: it needs about 35,000 more melee xp, or
  2,500 more ticks (inferred). Option 1 is better by about 2,500 ticks here.
- The general rule for the README: put 35,000 where the remaining gap after every
  other quest is largest, counting Hitpoints' gap net of one third of the remaining
  melee training. Attack is the stat most likely to be overfull, which favours
  option 1.

## Requirements as enforced by this server

- **Quests:** The Grand Tree and Tree Gnome Village. Narnode switches to Monkey
  Madness only when `%grandtree = ^grandtree_complete` and
  `%treequest = ^tree_complete` (read, `king_narnode.rs2:7-10`). No quest-point
  check and no other quest check (read, `mm_narnode.rs2`).
- **No skill checks gate the quest.** Every `stat` use in `quest_mm/` is a random
  roll, not a gate:
  - **Thieving** (`aa_market.rs2:33`): `stat(thieving) < 5 / 65` gates only *stealing
    from the Ape Atoll market stalls*, which the quest does not need (bananas come
    from a helper or the cellar crates). Thieving also sets the odds of picking the
    cell lock, `stat_random(thieving, 95, 295)` (`mm_jail.rs2:4`): at Thieving 20 that
    took 2-6 tries, 15-43 ticks (measured).
  - **Agility** sets the odds of landing on your feet in the cellar,
    `stat_random(agility, 150, 300)`; failing costs a third of your hitpoints
    (`quest_mm.rs2:982-992`).
- **What gates Ape Atoll.** The atoll is reached only through the quest: Daero's
  blindfold to the hangar (step D), the reinitialisation puzzle (E, the client
  blocker), Waydar's glider to Crash Island (F), and Lumdo's boat once Waydar has
  ordered him (G). On the atoll a **human cannot walk from the landing into the
  town**: the bamboo bridge north of the landing is one-way (climb up on the town
  side, jump off on the landing side, `quest_mm.rs2:1022-1043`), and the west gate
  opens only for a monkey (`quest_mm.rs2:1113-1117`). Before the gree-gree, the way
  in is **being knocked out and jailed** (measured, step H), then picking the lock.
- **Combat:** the jungle demon (level 195, 170 hp, attack/strength/defence/magic 170,
  +50 slash and magic defence, no stab, crush or ranged defence; read,
  `quest_mm/configs/quest_mm.npc`, `[mm_demon]`). See Fight.
- **Wield levels** are base levels (`levelrequire.rs2:7`): magic shortbow Ranged 50
  (`tier50.rs2:6`), rune scimitar Attack 40 (`tier40.rs2:8`).
- **Spell for magic:** Fire Blast needs Magic 59 (spell table).

## Helper-supplied items (one trade before step A)

| Item | Qty | Why |
|---|---|---|
| Gold bar | 1 | the amulet (Zooknock) |
| Ball of wool | 1 | stringing the amulet (`stringing.rs2:5`) |
| Monkey bones (normal) | 1 | the Karamja-monkey gree-gree Garkor insists on (`mm_garkor.rs2:51-58`; bones are tradeable, `quest_mm.obj`) |
| Bananas | 5 | the monkey child takes "twenty" but checks for more than 4 (`mm_monkey_child.rs2:136`) |
| Magic shortbow + rune arrows | 1 + 100 | the demon (Ranged 50) |
| Prayer potions | 4-6 | Protect from Magic (demon), Protect from Melee (temple) |
| Food | about 15 | the Ape Atoll dungeon traps cost about 5 sharks per pass at 70 hp (measured), and there are 4 passes |
| Varrock teleport runes (1 law, 3 air, 1 fire); Ardougne teleport runes if Plague City is done | 1-2 casts | the return from the atoll, the zoo trip |
| 200,000 coins | optional | Glough's puzzle fallback (`mm_glough.rs2:28-29`), not needed with a solving bot |

**Untradeable, fetched by the scored account:** the monkey dentures (crate, step H;
`tradeable=no`), the M'amulet mould (cellar crate), the monkey talisman (the monkey
child), and everything the quest hands out (seal, orders, sigil, gree-gree, amulet).
The shops on Ape Atoll stock dentures, talismans and moulds (`quest_mm.inv`) but
trade only with a gree-gree wearer, which you do not have yet (`mm_shopkeepers.rs2`).

## Step list

Stock ticks: pages cost 2 (measured), walks `bot.walkTo` (measured) or 0.57 per
tile (T: tile model from `quest-gnome-routes.ts`-style offline paths). Runs use the
CONVENTIONS notation (`c` continue, `opt`, `state`). Basis: **M** measured, **R**
read page count at 2 ticks per page, **T** tile model, **I** inferred.

### Chapter 1: the gnomes (stage `mm_main` 0 → 3)

| Seg | Step | Answers | Runs | Stock | Basis |
|---|---|---|---|---|---|
| A | King Narnode (Grand Tree, ground floor): start, royal seal, chapter card | Yes | state, 6c, state, 8c, opt, 4c | 50 | M |
| B | Up three floors to the glider pilot; Gnome Air to Gandius (glidermap:com_21) | Can you take me on the glider? | opt, 2c | 8 + 10 + 5 | M |
| B | Walk to the shipyard's west gate (80 tiles); the worker sees the seal (`mm_caranock.rs2:45-61`), gate opens | | 13c (incl. `p_delay(5)`) | 43 + 36 | M |
| B | Walk to G.L.O. Caranock (20 tiles); talk | | 12c | 14 + 26 | M |
| C | Walk back to the Gandius pilot (99 tiles), glide to the Grand Tree, down three floors | Can you take me on the glider? | opt, 2c | 55 + 10 + 6 + 10 | M |
| C | Narnode: report, he writes orders (`p_delay(3)`) | | 10c, state, 3c | 34 | M |
| D | Up one floor, walk to Daero (2484,3486, L1); orders. His menu offers "Leave" only after each of the three topics has been opened (`mm_daero.rs2:129-133`); then the blindfold to the hangar | journey / Return / 10th squad / Return / Caranock / Return / Leave / Who is it? | 7c, state, 4c, state, 3c, 7 opt, 2c, opt, 4c | 19 + 74 | M |
| E | Daero introduces Waydar | | 20c | 42 | M |
| E | Open the reinitialisation panel (2394,9883) | | | 5 | M |
| E | **Solve the puzzle**: 5x5 sliding puzzle scrambled by a 255-step random walk (`mm_puzzle.rs2:71-85`). A bot needs about 63 moves (39-83 over 40 scrambles, weighted A*) and the server takes 5 per tick | | | 13 | I, `quest-mm-puzzle-sim.ts` |
| E | Last tile → rumble → hangar cutscene → powered hangar (timer 3, fades, `p_delay` 4+3+7, `mm_puzzle.rs2:141-192`) | | | 21 | M with the rs/23 fix (lab client) |
| F | Daero: reinitialised; Waydar: fly to Crash Island | Yes | 2c, state, 6c / 3c, opt, 2c | 2 + 21 + 19 | M |
| G | Waydar on Crash Island; Lumdo (won't take you) | | 4c / 25c | 11 + 52 | M |
| G | Waydar orders Lumdo; **chapter 2 cutscene** (14 lines, two fades); you land on Ape Atoll (2801,2707) | I cannot convince Lumdo... | opt, 18c, state, 14c | 90 | M |

### Chapter 2: Ape Atoll as a human (3 → 4)

| Seg | Step | Runs | Stock | Basis |
|---|---|---|---|---|
| H | Walk the west corridor until the ravine archers knock you out (1 in 20 shots, `mm_archer.rs2:51-53`); wake in the jail (2770-2776,2793-2795) | | 63 (55-73, 8 runs) | M, `quest-mm-jail.ts` |
| H | Pick the cell lock (2771,2795) at Thieving 20 | | 25 (15-43; 2-6 tries) | M |
| H | Walk to Sergeant Garkor (2805,2762); his first talk sends you to Zooknock | 25c | 43 + 52 | T + R |
| H | Walk to the **denture crate's east side (2768,2769)** and take dentures. Every other side is in the sleeping guard's zone (`mm_sleeping_monkey_guard.rs2:2-12`): his 2-tick timer closes the crate's choice and calls guards (measured: 3 of 3 failed from the north side, 3 of 3 worked from the east) | 1c, opt | 29 + 13 | T + M |
| H | Crate over the hole (2769,2765): drop to the cellar | state, opt, state, 1c | 27 | M |
| H | Mould crate (2782,9172); **western** rope (2764,9165) up (the eastern rope lands in the sleeping guard's zone) | 1c, opt | 14 + 16 + 19 + 4 | M |
| H | To the bridge's north ladder (2803,2734), bridge, jump off, to the dungeon ladder (2763,2703) | | 76 | T |
| H | Ladder down; **the dungeon to Zooknock** (534 tiles, spike and rock traps, about 5 sharks at 70 hp) | | 7 + 291 | M |
| H | Zooknock: the story up to "need items" (56 pages; the closing menu can be skipped) | 55c, opt, 2c | 118 | R |
| H | Use the dentures, gold bar and mould on Zooknock; he enchants (`p_delay(4)`) | 3c, 3c, 6c, state, 1c | 40 | R |
| H | Back through the dungeon; ladder up | | 291 + 3 | M + I |
| H | **Knocked out and jailed again** (the landing side cannot reach the temple), pick the lock | | 88 | M |
| H | Walk to the temple (62 tiles); **the trapdoor (2807,2785)**: its only access tile, (2806,2785), is walled on three sides and boxed by 2x2 `blockwalk=all` guards (`quest_mm.npc`, `[mm_religious_trapdoor_guard]`) | | 35 + 102 (1 of 3 tries; see Risks) | T + M |
| H | Fire room: use the enchanted bar on the fire (`quest_mm.rs2:1063-1080`), string the amulet, rope up | | 14 | I |
| H | Walk to the monkey child (68 tiles); wear the amulet; four talks | 4c / 4c, opt, 2c / 5c, opt, 6c / 6c | 39 + 78 | T + R |
| H | Wait for the toy (timer 100, `mm_monkey_child.rs2:142`); the talisman | 7c | 100 + 16 | R |
| H | Child → bridge → dungeon ladder; the dungeon to Zooknock | | 83 + 291 | T + M |
| H | Talisman and bones on Zooknock → Karamja gree-gree; **chapter 3 cutscene** (19 lines, fades) | 3c, 6c, ..., 19c | 86 | R |

### Chapter 3: a monkey (4 → 5)

| Seg | Step | Runs | Stock | Basis |
|---|---|---|---|---|
| H | Wear the gree-gree; back through the dungeon; as a monkey walk the west corridor and open the gate (monkeys are not shot), walk to Garkor | | 296 + 93 | M + T |
| I | Garkor (seek an alliance); elder guard (2801,2757); walk to Kruk at the west gate; Kruk escorts you to Awowogei; Awowogei's mission | 5c / 5c / 6c, state / 20c | 141 | R + T |
| J | The zoo trip: bridge, Lumdo to Crash Island, Waydar's glider to the Gnomeball pitch, stronghold spirit tree to the Battlefield, walk to Ardougne zoo | | 150 | T + M |
| J | In the zoo as a monkey the Monkey Minder puts you in the cage (`mm_monkey_minder.rs2:28-50`); a zoo monkey jumps into your backpack (amulet worn); take the gree-gree off; the minder lets the human out | 10c, state / 16c / 7c | 80 | R |
| J | Back: young tree, village tree, stronghold, Daero, hangar, Waydar, Lumdo, west gate, elder guard to Awowogei | | 245 + 20 (backpack chatter) | T + I |
| K | Awowogei: success | 9c | 20 | R |
| K | Garkor; **chapter 4 cutscene** (25 lines); Garkor again: the sigil | 6c, state, 25c, state / 19c | 75 + 40 | R |

### Chapter 4: the battle (5 → 10)

| Seg | Step | Runs | Stock | Basis |
|---|---|---|---|---|
| L | Wear the sigil (works anywhere outside the Wilderness, `mm_demon.rs2:1-31`): timer, teleport, squad, demon | | 44 (43-53) | M |
| L | **Jungle demon** from range with Protect from Magic | | 267 | M, see Fight |
| M | Garkor; Zooknock teleports you out (`mm_demon.rs2:480-528`) | 5c | 18 | R |
| M | Varrock teleport, Varrock young tree, village tree, stronghold, Grand Tree door | | 149 | M (Grand Tree step J) |
| N | Narnode: report, reward, completion scroll, "sign up for training" | 13c, state, 2c, state, 7c | 52 | R |
| O | Up to Daero; training focus; "Several hours later..." (`mm_daero.rs2:240-293`) | 9c, opt, state | 63 | R + I |

## Travel

| Leg | Option used | Needs | Alternative |
|---|---|---|---|
| Grand Tree → Karamja shipyard | Gnome Air to Gandius (step B, 5 ticks + 80 tiles) | The Grand Tree | ship to Karamja + walk: much longer |
| Ape Atoll → Ardougne zoo (J) | Lumdo, Waydar, stronghold tree, Battlefield young tree (150) | Tree Gnome Village, Grand Tree | **Ardougne teleport** (Plague City, Magic 51): about 4 + 40 = 44, saving about 100 |
| Zoo → Ape Atoll (J) | young tree, village tree, stronghold, Daero, hangar, glider, Lumdo (245) | | no shortcut: the atoll is reachable only through the hangar |
| Ape Atoll → Narnode (M) | Varrock teleport + spirit trees (149) | Magic 25 | Lumdo + Waydar's glider to the Gnomeball pitch + walk: similar |

## Fight

| | Jungle demon |
|---|---|
| Level, hp | 195, 170 hp |
| Stats | attack, strength, defence, magic 170; +50 attack, strength, slash defence, magic defence; no stab, crush or ranged defence |
| Mechanic | Casts a random wave spell (max 31) at range; within 2 tiles it uses melee on half its attacks (`mm_demon.rs2:299-340`). Protect from Magic stops the spells only. The squad chips at it but can never land the kill: a killing blow from a gnome heals it 15 (`mm_demon.rs2:403-417`). Spawns 5-10 tiles away (`mm_demon.rs2:160`) |
| **Magic shortbow + rune arrows, Ranged 50, Protect from Magic, from 6+ tiles** | **267 ticks mean** (188, 268, 346; 3 of 3 kills, 0 damage, 2-3 prayer doses, 3-4 level-up pages). Measured, `quest-mm-demon.ts bow 50` |
| Same at Ranged 70 | 178 ticks (1 kill, 7 damage) (measured) |
| **Fire Blast, Magic 59, Protect from Magic** | **1,082 ticks mean** (517, 735, 1,993; 3 of 3, 0 damage, 7-22 prayer doses). Measured, `quest-mm-demon.ts magic 59`. Its +50 magic defence makes magic poor |
| Melee 70/70/70, rune scimitar, Protect from Magic | **died 2 of 2** (about 392 damage through 16 sharks: its melee is not covered) (measured, `quest-gnome-fights.ts jungledemon`) |
| Minimum setup | Ranged 50 with a magic shortbow and 4+ prayer potions (or Prayer above 43) |
| Ranged xp gained | about 430-540 base (measured) |

All demon figures are from 100 ms lab ticks and were not re-run at 300 ms.
Level-up pages stop the attack until dismissed; the script re-attacks when xp stops
rising (this is what a real run must do too).

## Tick total

Stock column per CONVENTIONS; fixed = 1 tick per page; burst = runs of k continues
cost ceil(k/5), options and state pages 1.

| Part | Stock | Fixed (rs/22) | Burst | Raw counts | Basis |
|---|---|---|---|---|---|
| Travel | 2,277 | 2,277 | 2,277 | 4 dungeon passes (534 tiles each), about 2,000 other tiles, 2 gliders, Lumdo x3, teleports, spirit trees | M for the dungeon and the gnome half, T for most atoll legs |
| Dialogue | 1,354 | 826 | 463 | 528 page/option clicks (about 3 cutscenes' worth of lines inside) | M (gnome half, 196 clicks) + R (atoll, 332 clicks) |
| Interactions | 258 | 250 | 250 | crates, hole, rope, lock picking, temple trapdoor, fire, puzzle | M except fire room and puzzle solve (I) |
| Fight | 267 | 267 | 267 | jungle demon, bow | M |
| Waits | 336 | 336 | 336 | 2 knockouts to the cell (63 + 63), child timer (100), hangar cutscene (21), sigil (44), chatter | M + R |
| **Total** | **about 4,490** | **about 3,960** | **about 3,590** | | 2,670 M, 980 R, 790 T, 50 I |

Not included: the helper trade (9), and the random failures. With them the expected
total is about **5,270 stock / 4,740 fixed / 4,370 burst** (inferred; see Random
steps near the top).

## Risks and gotchas

- **The temple trapdoor is the worst step.** Five level-167 guards (attack 130,
  aggressive to humans) surround it; NPCs block players on this engine, the
  trapdoor's alcove has one access tile, and two `blockwalk=all` guards stand on its
  neighbours. In 3 timed tries: one got down in 102 ticks, one was still pinned after
  150 ticks at 5 hp, one **died** (measured, lab probe). Protect from Melee and
  auto-retaliate off (the combat tab) help; damage still got through when boxed in.
  Bring prayer potions and food, and expect retries. A safer method is an open
  question.
- **The monkey's aunt** calls guards on a human in her part of the farm
  (`mm_monkeys_aunt.rs2:5-30`); talking to the child as a human got the account
  jailed mid-dialogue (measured). Wait until she is in the house while you stand in
  the garden (her zone test), or pay a jail cycle (about 90).
- **Two forced jail cycles** (steps H): random length, 55-73 ticks to wake plus
  15-43 to pick the lock at Thieving 20; low Thieving makes the lock slower.
- **Ape Atoll dungeon traps** (spikes 7% hp, rocks 3%, spring traps 8%, poison:
  `ape_atoll_dungeon.rs2:43-110`): about 5 sharks per pass at 70 hp.
- **Deaths** lose the run's inventory risk and cost a long trip back (the atoll
  only through the hangar).
- **Level-up pages** interrupt the demon fight (3-4 at Ranged 50).
- **Logout-unsafe stretches** (CONVENTIONS, primitives.md §8): the three chapter
  cutscenes (steps G, H-talisman, K) live in the temporary varp `mm_cutscene_part`;
  a login inside a cutscene zone completes the cutscene instead (`mm_login`,
  `quest_mm.rs2:1-37`). The final battle: the squad and the demon delete themselves
  when you leave (`mm_demon.rs2:212-220, 272-279`), so a logout restarts the battle
  (the sigil can be worn again). The hangar cutscene runs on a timer, which is not
  saved. `mm_guards_cooldown`, `varp_369` and `varp_370` reset too (harmless). Every
  other stage is a permanent varp: clean logout points are anywhere outside those
  four stretches.
- **Glough's fallback** (200,000 coins) is per attempt and he can be paid twice
  (`mm_glough.rs2:3`).

## Open questions

- **Skipping cutscenes by logging out.** `mm_login` completes a cutscene when you log
  in inside its zone (`quest_mm.rs2:9-37`). The three cutscenes cost about 44, 54 and
  70 ticks; a logout inside each could save most of that, since logged-out time is
  free. Not measured.
- A reliable way past the temple guards (luring them out at run speed, killing one
  trapdoor guard for its 25-tick respawn, or timing their one-tile wander).
- The Ape Atoll legs marked T were not walked: the SDK pathfinder does not model
  the bamboo ladders and bridges, so a real route may be a little longer.
- Walking away from closing pages after the stage is set (Zooknock's menu, Daero's
  menu) is assumed above for Zooknock only; untested.
