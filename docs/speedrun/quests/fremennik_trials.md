# The Fremennik Trials

**About 3,130 ticks on today's client (about 15.7 minutes at 300 ms), 2,640
with the one-tick-per-page client fix (cairn://p/rs/22) and about 2,320 with
dialogue bursts, for 2,812.4 base xp in each of ten skills and 3 quest points.**
The xp it displaces in the skills that are not already capped (Woodcutting,
Fishing, Thieving, Agility, plus a little Fletching and Crafting) is worth
about 1,200 ticks of training, so on xp alone the quest loses roughly 1,100
ticks even in the burst column. The cost is spread out rather than in one
segment: the merchant trial's 26-conversation trade chain is a third of it
(about 1,010 ticks), travel another quarter, then Koschei (about 234 at
boosted 99 melee), the Draugen hunt (about 216) and the Seer's house (about
181).

All seven trials are mandatory on this server (Brundt completes the quest
only at seven votes, and there are exactly seven councillor trials), every
quest item is untradeable, and the quest needs no Agility, no quest points and
no other quest. Its skill gates are Woodcutting 40, Crafting 40 and Fletching
25, none of which has a usable boost here.

Lab runs used `NODE_TICKRATE=100`; every figure is in server ticks, and the
dialogue figures match `primitives.md`'s 2 ticks per page (see Open
questions).

## Reward

- `stat_advance(<skill>, 28124)` for Attack, Defence, Strength, Hitpoints,
  Woodcutting, Fletching, Fishing, Crafting, Agility and Thieving (read,
  `quest_viking.rs2:135-144`, all ten checked). These are tenths, so **2,812.4
  base xp each** (70,310 game xp), 7.0% of the 39,938 base xp to 99. On this
  server's xp table (`Player.ts:77-85`, stored in tenths) 2,812.4 base alone is
  **level 60** in a skill that starts at 1 (inferred: computed from that table).
- 3 quest points (read, `quest.constant:136`, `^viking_questpoints`).
- `%viking` becomes 10 (`quest.constant:68`, `quest_viking.rs2:145`); measured
  in `quest-rellekka-segments.ts finish`.
- Unlocks (read, not valued here): Fremennik shops and the Rellekka spinning
  wheel (`spinning.rs2:2-6`), the longship to Miscellania (`viking_sailor.rs2:14-25`),
  the Rellekka lyre teleport after another raw-shark offering
  (`viking_olaf.rs2:191-207, 246-262`), and the fence gate north of the market
  (`quest_viking.rs2:1-23`).

### Value against training (inferred, for the README)

| Skill | Base xp | Training it displaces | Basis |
|---|---|---|---|
| Agility | 2,812.4 | about 400 ticks at 7.0 base/tick | rs/2's rate, via the coordinator |
| Fishing | 2,812.4 | about 310 ticks | rs/7's measured figure, via the coordinator |
| Thieving | 2,812.4 | about 245 ticks at 11-12 base/tick | rs/2's rate |
| Woodcutting | 2,812.4 | about 240 ticks at 11.6 base/tick | rs/2's rate |
| Fletching, Crafting | 2,812.4 each | under 10 ticks together (99 costs about 48 and 80 ticks with helpers) | coordinator, per-skill rates |
| Attack, Defence, Strength, Hitpoints | 2,812.4 each | about 0 (over-capped by earlier quests) | coordinator |
| **Total** | | **about 1,200 ticks** | |

The quest's other claimed role, Agility before Grand Tree (Agility 25), is
worth little: level 25 is 194.5 base xp (computed from `Player.ts:77-85`),
which at 7 base/tick is under 30 ticks of training (inferred).

## Requirements (as this server enforces them)

- **No quest, quest-point or Agility requirement.** Brundt starts the quest for
  anyone (`viking_brundt.rs2:114-150`). Olaf's checks of Legends' Quest, Heroes'
  Quest and Dragon Slayer (`viking_olaf.rs2:380-395`) only choose which four
  lines you sing on stage; nothing branches on them.
- **All seven trials.** Brundt counts votes as `%viking - 1` and completes only
  at 7 (`viking_brundt.rs2:3, 21-30`). The seven increments are Manni
  (`viking_reveller.rs2:204`), Sigli (`viking_sigil.rs2:19`), Swensen
  (`viking_hallifred.rs2:159`), Thorvald (`viking_thorvald.rs2:327, 402`), Peer
  (`viking_peer.rs2:1053`), Olaf (`viking_olaf.rs2:468`) and Sigmund
  (`viking_sigmund.rs2:13`); each is guarded so it counts once.
- **Woodcutting 40**, `stat(woodcutting)`, to cut the musical tree, plus an axe
  usable at that level (`viking_olaf.rs2:148-157`).
- **Crafting 40**, `stat(crafting)`, for the knife on the branch
  (`viking_olaf.rs2:175`).
- **Fletching 25**, `stat(fletching)`, to string the lyre (`viking_olaf.rs2:230`).
- **Boosts:** `stat()` is the boosted level, but nothing in this content boosts
  these three usefully. The only Woodcutting/Fletching/Crafting entries in
  `consume_effects.dbrow` are super restore heals (`:310-318`), and the poison
  chalice's random +1 Crafting (`poison_chalice.rs2:17`) is a 32/128 roll. No
  trial has an alternative path that avoids them: the lyre is the only way to
  play on stage (`viking_olaf.rs2:264-275`).
- **Gate cost.** Level 40 is 631.6 base xp and level 25 is 194.5 (computed from
  `Player.ts:77-85`). This xp is not wasted if the skill goes to 99 anyway; it
  only has to be trained before the quest rather than after. Woodcutting 40 is
  the one that costs real ticks before the quest, about 55 at rs/2's 11.6 base
  per tick (inferred; low levels train slower than that average).
- **Thorvald's arena forbids any weapon or armour, worn or carried**, including
  axes, pickaxes, arrows, runes in the inventory, logs, unstrung bows and cannon
  parts (`viking_thorvald.rs2:435-481`). Food, potions, amulets, rings and boots
  are allowed (read: not on the list).
- **Peer's house needs an empty inventory and nothing worn**
  (`viking_peer.rs2:293`). His spell banks everything for you
  (`viking_peer.rs2:185-231`), which would send untradeable quest items to the
  bank too.
- **Combat:** forms 1-3 of Koschei must be beaten unarmed (see Fights); the
  Draugen (60 hitpoints) can be fought with any gear.
- **Members world** (all quest items are `members=yes`, `viking.obj`).

## Items: helper-supplied and scored-account-only

| Item | Tradeable | Source for the run |
|---|---|---|
| Coins: 5,000 for Askeladden's promise, 250 for the low alcohol keg | yes | helper |
| Beer (for the Council workman's strange object), tinderbox | yes | helper |
| Cabbage, potato, onion (Lalli's stew) | yes | helper |
| Axe usable at Woodcutting 40 (adamant), knife | yes | helper, **after** Koschei (axes are banned in his arena) |
| Raw shark (or raw sea turtle or manta ray) for Fossegrimen | yes | helper |
| Koschei kit: 2 Zamorak brews (4), super attack, super strength, amulet of strength, a few sharks | yes | helper, before Thorvald's ladder |
| Draugen kit: rune scimitar and armour, food | yes | helper, after Koschei |
| Runes for two Camelot teleports (Magic 45) | yes | helper (not carried into Thorvald's arena) |
| Pet rock, golden fleece and wool, branch, lyres, talisman, kegs, strange object, every merchant-chain item, every Seer's-house item | **no** (`viking.obj`, all `tradeable=no`) | scored account |

The order of the route keeps the two restricted rooms simple: the scored
account arrives empty for Peer's house, takes the Koschei kit in trade 1, and
everything else (including the axe and the second teleport's runes) in trade 2
after Koschei.

## Step list

Quest varps (both `scope=perm`, `quest_viking.varp`): `%viking` counts 1 +
votes; `%viking_bits` packs each trial's progress (`quest_viking.constant`):
Swensen bits 10-11, Manni 12-13, Sigli 14-15, Thorvald 16-17, Peer 18-19, Olaf
20-22, Sigmund 23-26, plus the firecracker (bit 0), low-alcohol keg (bit 2),
riddle choice (bits 3-5) and stew ingredients (27-30).

"Runs" use `CONVENTIONS.md`'s notation (`9c, opt, 3c` = nine continues, an
option, three continues). Segment ticks are measured from standing next to the
NPC or loc; travel rows are route tiles from `quest-rellekka-routes.ts` at 0.5
ticks per tile + 1. Measuring scripts are named in the Label column
(`segments` = `quest-rellekka-segments.ts`, `items` = `quest-rellekka-items.ts`).

| # | Where | Action | Varp effect | Runs / raw counts | Ticks | Label |
|---|---|---|---|---|---|---|
| 1 | Camelot teleport (2757,3478) → Brundt (2659,3669) | teleport, 265 tiles (walking in from Seers' bank is 248) | | 1 teleport, 265 tiles | 4 + 134 | inferred (routes) |
| 2 | Brundt | "Do you have any quests?", "Yes, I am interested.", "I want to become a Fremennik!" | `%viking` 0 → 1 | 1c, opt, 3c, opt, 9c, opt, 3c | **40** | measured, `segments start` |
| 3 | → Peer (2634,3668) | 34 tiles | | | 18 | inferred |
| 4 | Peer | "Yes" to his trial, "Yes" to the bank spell (empty inventory: nothing to bank) | Peer started, riddle 0-5 | 16c, opt, 13c, opt, 2c | **68** | measured, `segments councillors` (70 with Thorvald's extra topic menu) |
| 5 | Peer's house | riddle, lock, puzzle, exit (sub-steps below) | Peer complete, vote 1 | 11 clicks | **181** (n=3: 181, 182, 181) | measured, `quest-rellekka-seer.ts` |
| 6 | outside | trade 1 (Koschei kit) | | 1 trade | 9 | measured, `primitives.md` §6 |
| 7 | → Thorvald (2666,3693) | 38 tiles | | | 20 | inferred |
| 8 | Thorvald | "Yes" | Thorvald started | 13c, opt, 9c | **48** | measured, `segments councillors` |
| 9 | Thorvald's ladder | Koschei (see Fights); ends upstairs in his house | Thorvald complete, vote 2 | 4 defeat/honour pages | **234** mean (n=6) | measured, `quest-rellekka-koschei.ts` |
| 10 | → ground floor, Manni (2660,3673) | climb down, 50 tiles; trade 2 on the way | | 1 climb, 1 trade | 2 + 26 + 9 | inferred / §6 |
| 11 | Manni | "Yes" | Manni started | 9c, opt, 3c | **28** | measured |
| 12 | keg table (2660,3676) | take the keg of beer (needs Manni started, `viking_reveller.rs2:293-294`) | | 11 tiles, 1 pick-up | 7 + 4 | inferred + measured, `items keg` |
| 13 | → Olaf (2673,3683) | 43 tiles | | | 23 | inferred |
| 14 | Olaf | "Yes" | Olaf started | 8c, opt, 2c | **25** | measured |
| 15 | → Sigli (2660,3653) | 29 tiles | | | 16 | inferred |
| 16 | Sigli | "What's a Draugen?", "Yes"; talisman | Sigli started | 11c, opt, 4c, opt, 6c | **48** | measured |
| 17 | → Swensen (2646,3660) | 22 tiles | | | 12 | inferred |
| 18 | Swensen | "Yes" | Swensen started | 11c, opt, 3c | **37** | measured |
| 19 | Swensen's maze | ladder down, the 7 fixed portals, exit ladder, his 4 pages | Swensen complete, vote 3 | 4c; portals 4-7 ticks each | **56** | measured, `segments maze` |
| 20 | → Lalli (2770,3622) | 135 tiles east | | | 69 | inferred |
| 21 | Lalli | "Other human?" | Olaf 1 → 2 | 7c, opt, 3c | **24** | measured, `items lalli1` |
| 22 | → Askeladden (2658,3660) and back | 2 × 122 tiles | | | 2 × 62 | inferred |
| 23 | Askeladden | (no options) pet rock | Olaf 2 → 3 | 14c | **30** | measured |
| 24 | Lalli | (with the rock) | Olaf 3 → 4 | 8c | **18** | measured |
| 25 | Cauldron (2772,3623) | rock, cabbage, potato, onion | stew bits; Olaf → 5 | 4 uses, 11 pages | **44** | measured, `items cauldron` |
| 26 | Lalli | golden fleece | | 6c | **15** | measured |
| 27 | Draugen hunt | talisman directions, spawn, fight (see Fights); done from Rellekka's south gate | Sigli 1 → 2 | | **216** mean (n=4) | measured, `quest-rellekka-draugen.ts` |
| 28 | Musical tree (2738,3638), 34 tiles from Lalli | cut a branch (`p_delay(2)`); knife on branch | | 1 cut, 1 use | 18 + 7 + 4 | inferred + measured |
| 29 | → Seers' Village | Camelot teleport, 48 tiles, stairs up | | | 4 + 25 + 2 | inferred |
| 30 | Spinning wheel (2711,3471, floor 1) | fleece on wheel (any wheel except Rellekka's, `spinning.rs2:2-29`); wool on lyre | | 2 uses | 3 + 3 | measured |
| 31 | → Poison Salesman (2737,3491) | stairs, 28 tiles | | | 2 + 15 | inferred |
| 32 | Poison Salesman | "Talk about the Fremennik Trials", the pitch, "Yes" (250 coins; sells only once Manni's trial is started, `poison_salesman.rs2:94`) | keg bought | opt, 33c, opt, 1c | **75** | measured, `items salesman` |
| 33 | → Fossegrimen's altar (2626,3598) | 209 tiles | | | 106 | inferred |
| 34 | Altar | raw shark on altar | lyre enchanted | 1c | **5** | measured |
| 35 | → Council workman (2655,3592) | 56 tiles | | | 29 | inferred |
| 36 | Workman | beer on him → strange object (no quest check, `vt_council_workman.rs2:20-30`) | | 3c | **9** | measured |
| 37 | → longhall pipe (2663,3674) | 84 tiles; light the object on arrival (it explodes after 140-200 ticks, `viking_reveller.rs2:250`) | | | 43 + 3 | inferred + measured |
| 38 | Pipe | put the lit object in | bit 0 | 1c | **7** | measured |
| 39 | → inside the longhall | swap: low alcohol keg on keg of beer | bit 2 | 25 tiles, 1 use | 14 + 4 | inferred + measured |
| 40 | Manni | "Yes"; the contest | Manni complete, vote 4 | 1c, opt, 2c | **10** | measured |
| 41 | → backstage door (2667,3683) → stage | door, 4 tiles, play the lyre, Olaf's 2 pages | Olaf complete, vote 5 | 33 tiles; 1c (bouncer), 2c | 18 + **40** | inferred + measured, `items perform` |
| 42 | → Sigmund (2641,3680) | 35 tiles | | | 19 | inferred |
| 43 | Sigmund | "Yes" | Sigmund started | 13c, opt, 4c | **41** | measured |
| 44 | The merchant chain | 26 conversations, sailor to Sigmund (below) | Sigmund complete, vote 6... | 190 pages, 26 options | **1,010** | measured, `quest-rellekka-merchant.ts` |
| 45 | → Brundt | 29 tiles; "Ask about becoming a Fremennik" is not offered once Sigmund is done | `%viking` 8 → 10 | 4c | 16 + **10** | measured, `segments finish` |

(Vote order in the table is illustrative; the merchant chain's vote is the
seventh.)

### Peer's house in detail (step 5)

Measured with `quest-rellekka-seer.ts` (3 runs, riddles MIND, TREE, LIFE). The
ground floor is **two rooms**: the entry room has the ladder up; the mural and
the exit door are in the east room, reachable only through the upper floor's
second trapdoor (found the hard way: the mural is "I can't reach that!" from
the entry room).

| Sub-step | Ticks |
|---|---|
| Door: "Read the riddle" (message box, option, two message boxes), lock opens | 11 |
| Lock: 25-37 clicks (one per letter step, the shorter way round 26) and submit; they all land within | 7-8 |
| Open the door again (empty inventory), ladder up | 2 + 4 |
| Cupboard open + search (bucket); chest open + search (jug) | 13 + 13 |
| Unicorn head, bull head (2 message boxes each), bookcase | 10 + 10 + 9 |
| Herring on range (goop, 1 message box); goop on wooden disk | 4 + 2 |
| Water: bucket on tap; bucket into jug; jug down drain; bucket into jug; bucket on tap; bucket into jug (4/5ths) | 4 + 2 + 2 + 2 + 2 + 2 |
| 4/5ths bucket on the scale chest (vase); vase on tap | 5 + 5 |
| Open the east trapdoor (2636,3663), climb down | 5-6 + 2-3 |
| Both red disks on the mural (lid); lid on vase | 4 + 2 + 2 |
| Ladder up; sealed vase on the frozen table; frozen key on the range | 4 + 4 + 6 |
| East trapdoor down; key on the exit door (Peer's page) | 5 + 3 |
| **Total** | **181-182** |

The lock clicks are interface buttons, not dialogue, so many land in one tick
(37 clicks resolved in 8 ticks, measured). A first version that used the SDK's
high-level `interactLoc` measured 223-247 ticks: that call waits on its own
completion heuristic (about 20 ticks on a search), so scripts here use the raw
interaction packet (`opLoc` in `quest-rellekka-lib.ts`).

### The merchant chain (step 44)

Each NPC first offers "Ask about the Merchant's trial" while the trial is open.
The order is fixed: each NPC's dialogue moves `%viking_bits`' Sigmund field one
stage (`quest_viking.constant:62-77`) and hands over the next untradeable item.

| # | NPC | Gives / asks for | Runs | Ticks |
|---|---|---|---|---|
| 1 | Sailor (2629,3693) | wants a love ballad | opt, 9c | 36 |
| 2 | Olaf | wants boots | opt, 9c | 55 |
| 3 | Yrsa (2625,3675) | wants a tax cut | opt, 7c | 51 |
| 4 | Brundt | wants Sigli's map | 1c, opt, 10c | 47 |
| 5 | Sigli | wants a bowstring | opt, 10c | 35 |
| 6 | Skulgrimen (2663,3694) | wants the unusual fish | opt, 12c | 53 |
| 7 | Fisherman (2641,3699) | wants Swensen's map | opt, 8c | 43 |
| 8 | Swensen | wants a forecast | 1c, opt, 11c | 56 |
| 9 | Peer | wants a bodyguard | opt, 8c | 29 |
| 10 | Thorvald | wants a champion's token | opt, 12c | 51 |
| 11 | Manni | wants the cocktail | opt, 12c | 58 |
| 12 | Thora (2662,3673) | wants Askeladden's promise | opt, 19c | 47 |
| 13 | Askeladden | promise, "Yes", 5,000 coins | opt, 6c, opt, 2c | 31 |
| 14-25 | Thora, Manni, Thorvald, Peer, Swensen, Fisherman, Skulgrimen, Sigli, Brundt, Yrsa, Olaf, Sailor | each trades the item back up the chain | opt + 2-7c each | 20-44 each, 375 together |
| 26 | Sigmund | the flower | 3c | 23 |
| | **Total** | | 190 pages, 26 options | **1,010** |

About 432 ticks of that is dialogue on today's client; the rest is walking about
680 straight-line tiles between the NPCs (the SDK's `talkTo` paths there,
including doors, so this walking is about 13% slower than chained run clicks,
`primitives.md` §2).

## Fights

### Koschei the deathless (Thorvald's trial)

Read (`viking.npc`, `viking_thorvald.rs2`): four forms, combat level hidden.
Form 1: 20 attack/strength/defence, 30 hitpoints. Form 2: 40s, 50 hitpoints.
Form 3: 60s, 70 hitpoints. Each defeat heals him into the next form
(`ai_queue3`, lines 230-277) with one dialogue page. Form 4: attack and defence
255, strength 5 (maximum hit 1), attacks every tick, 255 hitpoints; it cannot be
beaten, and when one of its hits leaves you on exactly 0 hitpoints you "die
honourably" (`playerhit_n_melee_viking`, lines 368-427): the trial passes, you
are teleported upstairs beside Thorvald, healed, and he talks (5 pages). He
spawns 20-70 ticks after you climb down (line 160), a forced wait. Prayer is
drained at the form 3 defeat (line 297).

So the fight has two halves with opposite needs: forms 1-3 want damage (unarmed,
since weapons are banned), and form 4 wants as few hitpoints as possible
(about 2.7 ticks per hitpoint you carry in, measured). **Zamorak brew** solves
the second: each dose deals 12% of current hitpoints (never lethal) and drains
Defence by 2 + 10% (`consume_effects.dbrow` `zamorak_brew_effect`,
`consume_effects.rs2:56-58`), and the forced spawn wait gives time to drink
eight doses for free. Low Defence makes forms 1-3 hit harder, but their maximum
hits are small (about 3, 5 and 7).

Measured with `quest-rellekka-koschei.ts`, ladder click to the end of
Thorvald's dialogue (spawn wait included), aggressive style, one bot in the
arena at a time:

| Stats and plan | Ticks per run | Mean |
|---|---|---|
| 99/99/99, 99 hp, unarmed, no boosts | 542, 413, 503, 456, 480 | **479** (n=5) |
| 99s, super attack + super strength, amulet of strength, Ultimate Strength + Incredible Reflexes, **8 brew doses in the spawn wait** | 233, 218, 225, 227, 272, 229 | **234** (n=6) |
| same boosts, 8 brew doses at the start of form 4 instead | 349, 342, 349, 368, 336, 310, 347 | 343 (n=7) |
| 70/70/70, 70 hp, same boosts, brew at form 4 | 304, 392, 324, 393, 455 | 374 (n=5) |
| 70s, same boosts, 4 doses in the wait, eat at 9 hp | 440, 395, 349 | 395 (n=3) |
| 70s, boosts, no brew | 519, 479 | 499 (n=2) |

With brew in the wait at 99s, forms 1-3 took 15-31, 35-52 and 48-119 ticks and
form 4 39-59 ticks; the account entered form 4 on 13-24 hitpoints and ate 0-3
sharks. Minimum stats: not established. Two runs at 40/40/40 (unboosted, eating
at half) took 1,281 ticks and ended in one real death in form 3; treat about
60-70 melee with boosts and food as the practical floor (inferred). A real death
in forms 1-3 is an ordinary death (only form 4's hits are converted), which
loses the trip and the attempt.

The defeat hooks are safe from the lost-hook pattern: they queue the follow-up
with `finduid`, and only an extra `p_delay(0)` depends on `p_finduid`
(lines 236-238). Level-up pages appear at low combat stats (up to 12 in one
40-stat run); none at 99.

### The Draugen (Sigli's trial)

Read (`viking.npc`, `viking_sigil.rs2`): combat level 69, 60 hitpoints, 60
attack/strength/defence, +100 stab/slash/crush defence, crush attacks. The
talisman spawns a "butterfly" in one of four forests round Rellekka (lines
239-251) and points a compass direction; within 3 tiles of the butterfly it
spawns the Draugen. The butterfly is an ordinary NPC (`viking_draugen_safe`,
id 1280), so a bot that sees it can walk straight to it (it wanders up to 40
tiles, so it often has to be chased).

Measured with `quest-rellekka-draugen.sh` (fresh bots, one at a time) at
70/70/70 with a rune scimitar and rune armour, from the first talisman use at
Rellekka's south gate: **148, 251, 235, 230 ticks, mean 216** (n=4); the
Draugen appeared after 78-161 ticks and died after 70-110 more, no food eaten.

**Lost-hook risk:** the essence is only absorbed if `p_finduid` succeeds when
the Draugen dies (`viking_sigil.rs2:161-176`): if the player is delayed at that
moment the kill is lost and the Draugen is not removed. It did not happen in
four runs; don't click an item with a delay (or the talisman) on the killing
hit.

## Tick total

Dialogue in three columns (`CONVENTIONS.md`): stock 2 ticks per page or option,
fixed 1, burst = 1 per option plus ceil(k/5) per run of k continues. "Other"
is each measured segment minus its dialogue.

| Part | Stock | Fixed client | Burst | Basis |
|---|---|---|---|---|
| Travel (steps 1, 3, 7, 10, 12-13, 15, 17, 20, 22, 28-29, 31, 33, 35, 37, 39, 41-42, 45) | 766 | 766 | 766 | routes at 0.5/tile + 1, teleports and climbs from `primitives.md` |
| Merchant chain, walking | 578 | 578 | 578 | measured total minus dialogue |
| Dialogue, merchant chain (216 clicks) | 432 | 216 | 79 | measured runs |
| Dialogue, everything else (280 clicks) | 560 | 280 | 97 | measured runs |
| Koschei, other than pages | 218 | 218 | 218 | measured (99s boosted, brew in the wait; includes the 20-70 tick spawn wait) |
| Draugen hunt and fight | 216 | 216 | 216 | measured |
| Seer's house, other than pages | 159 | 159 | 159 | measured |
| Maze, item steps, contest and performance delays, two trades | 202 | 202 | 202 | measured |
| **Total** | **about 3,130** | **about 2,640** | **about 2,320** | |

At 70/70/70 instead of boosted 99s, Koschei adds about 140 ticks (inferred from
the table above). The Draugen hunt was measured from the south gate as its own
trip; doing it during the Lalli trip should save some of its 78-161 ticks of
searching (inferred, not measured).

## Risks and gotchas

- **Real deaths in Koschei's forms 1-3** at low stats (one in two runs at
  40s). Bring boosts and food; only form 4 is safe.
- **Draugen kill lost if delayed** (`p_finduid`, above).
- **Swensen must be within 5 tiles of the maze exit** when you climb out, or
  the trial does not complete (`viking_hallifred.rs2:150-151`); he wanders. It
  completed in the measured run.
- **The maze's 70 wrong portals teleport you to one of 20 random spots**
  (`viking_hallifred.rs2:163-246`); use only the 7 fixed ones (listed in
  `quest-rellekka-segments.ts`).
- **Peer's house:** enter with nothing at all; anything left in the house is
  deleted when you leave (`viking_peer.rs2:1058-1087`). The east room is only
  reachable from upstairs.
- **The lit strange object explodes after 140-200 ticks** for max(2, hp/25)
  damage if still in the inventory (`viking_reveller.rs2:250-263`); light it at
  the pipe. Without the firecracker in the pipe the keg swap is refused while
  Manni is within 10 tiles, which covers the whole longhall
  (`viking_reveller.rs2:212-223`), and drinking the real keg always fails
  (`:185-194`). The pipe accepts the object before the trial is even started
  (`:277`).
- **The merchant trial adds an extra menu to every NPC** while it is open
  ("Ask about the Merchant's trial"); start it last, after every other trial
  has been started, or each first talk costs an extra option.
- **Sigmund resets the chain** if you talk to him at the `spoke_thora` stage
  without any chain item (`viking_sigmund.rs2:26-34`). Don't drop or bank the
  chain items; the flower can be destroyed (`:96-100`).
- **Level-up pages** interrupt fights at low stats (see Koschei).
- **Logout safety.** `%viking` and `%viking_bits` are `scope=perm`, so the
  quest state survives logout, with these exceptions (`primitives.md` §8):
  - **Draugen hunt: logout-unsafe.** `%draugen_butterfly_uid` is temporary;
    after a logout the next talisman use spawns a new butterfly somewhere else.
  - **Koschei: logout-unsafe after climbing down.** The spawn is a queued
    script (`longqueue(spawn_viking_enemy)`), and queues are not saved; climb
    up and down again. Logout is refused in combat anyway.
  - **Lit strange object:** its explosion is a queue, lost on logout, so the
    object stays lit and harmless (read; untested).
  - **Combination lock:** the wheels live in `%temp` inside an open interface;
    re-enter the code after a logout.
  - Opened cupboards, chests and the east trapdoor revert after 300-500 ticks
    (`viking_peer.rs2:770, 1028`); a long break inside Peer's house means
    reopening them.

## Open questions

- Timed at a 100 ms tick, not production's 300 ms. Dialogue measured 2 ticks per
  page throughout, matching `primitives.md`'s 300 ms figure, so the totals
  should carry over; the merchant chain and the Koschei reaction loop were not
  re-run at 300 ms.
- The merchant chain walked with `talkTo` (one run). Chained run clicks should
  take roughly 70 ticks less (inferred from `primitives.md` §2's 13%).
- Koschei's minimum stats are not established (only 40s, which failed once,
  and 70s, which never failed).
- Combining the Draugen hunt with the Lalli trip, and whether the Seers' Village
  trip (spinning wheel and keg, about 330 ticks out and back) can be avoided:
  the only other spinning wheels are further away, and Rellekka's refuses
  outerlanders.
- Whether the README should value the Fremennik unlocks (Miscellania boat,
  lyre teleport, Rellekka shops) at all; nothing in the current plan needs
  them.

## Scripts

- `docs/speedrun/scripts/quest-rellekka-koschei.ts <bot> [att str def hp] [runs=N] [food=N] [eatAt=N] [boost] [pray] [amulet=<obj>] [brew=N] [brew4=N]`: Thorvald's trial.
- `docs/speedrun/scripts/quest-rellekka-seer.ts <bot> [runs=N]`: Peer's house.
- `docs/speedrun/scripts/quest-rellekka-segments.ts <bot> [start|councillors|maze|finish]`: Brundt, the seven first talks, Swensen's maze.
- `docs/speedrun/scripts/quest-rellekka-merchant.ts <bot>`: the merchant chain.
- `docs/speedrun/scripts/quest-rellekka-items.ts <bot> [piece...]`: the bard and drinking trials, piece by piece.
- `docs/speedrun/scripts/quest-rellekka-draugen.ts <bot> [att str def hp]` and `quest-rellekka-draugen.sh <prefix> <count>`: the Draugen hunt on fresh bots, serially.
- `docs/speedrun/scripts/quest-rellekka-routes.ts`: route tiles (offline).
- `docs/speedrun/scripts/quest-rellekka-map.ts npc|loc|obj <regex>...`: coordinates from the map files (offline).
- `docs/speedrun/scripts/quest-rellekka-lib.ts`: shared helpers (builds on `quest-arthur-lab.ts`).

Scripts that share Koschei's arena or the Draugen's butterflies must run one
bot at a time: other players' Koschei and butterflies are visible and confuse
the measurement.
