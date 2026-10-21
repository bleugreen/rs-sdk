# The Grand Tree

**Verdict: about 2,100-2,200 ticks on foot, or about 1,800-1,900 with the Ardougne
teleport (Plague City done), for 18,400 Attack, 7,900 Agility and 2,150 Magic base.**
That is roughly break-even with training (18,400 / 14 per tick plus 7,900 / 8 per
tick is about 2,300 ticks; inferred from the README's combat and Agility rates).
It is worth doing because Monkey Madness needs it (`king_narnode.rs2:7-10`), and it
opens the stronghold spirit tree and Gnome Air.

The quest was played on the lab server, segment by segment, by
`docs/speedrun/scripts/quest-grandtree-full.ts <bot> [first] [last]` (segments A-P;
each can start on its own with `::setvar`). Unless marked otherwise, tick figures
are **measured** by that script (100 ms lab ticks, stock lite client, `bot.walkTo`).
Fights come from `quest-gnome-fights.ts`, the Daconia search from
`quest-grandtree-roots.ts` and `quest-gnome-routes.ts`.

## Reward

- **7,900 Agility, 18,400 Attack, 2,150 Magic base**: `stat_advance(agility, 79000)`,
  `stat_advance(attack, 184000)`, `stat_advance(magic, 21500)` (read,
  `quest_grandtree/scripts/quest_grandtree.rs2:199-201`; tenths, times 25).
- 5 quest points (read, `general/configs/quest.constant:96`).
- The stronghold spirit tree (`spirit_tree.rs2:1-5`) and Gnome Air: the Grand Tree
  pilot flies to Gandius (Karamja shipyard) only after the quest
  (`gnome_glider.rs2:116-117`). Monkey Madness uses that glider.

## Requirements as enforced by this server

- **Agility 25, boosted:** `if(stat(agility) < 25)` on climbing the tree in Glough's
  house up to the twig pillars (read, `quest_grandtree.rs2:25`). `stat()` is the
  boosted level, so **Agility 22 plus a +3 Agility potion passes**
  (`consume_effects.dbrow:288-294` per the Agility child). This is the only Agility
  check in `quest_grandtree/`; there is no `stat_base` check. It gates step M only.
- **No quest or quest-point requirement** (read: nothing in `king_narnode.rs2` at
  stage 0).
- **Inventory space:** Narnode needs 2 free slots for the bark sample and book
  (`king_narnode.rs2:294`), 4 for the twigs (`:108`); Anita, the cupboard and the
  chest need 1 each.
- **The black demon** (level 172, 157 hp, attack 145, strength 148, defence 152,
  slash; read, `quest_grandtree/configs/*.npc`, `[grandtree_blackdemon]`). It is melee,
  so Protect from Melee (Prayer 43) blocks it while prayer lasts. Only the player
  Glough summoned it for can attack it (`grandtree_black_demon.rs2:1-13`).
- **The foreman's quiz** has fixed answers: "Sadly his wife is no longer with us!",
  "He loves worm holes.", "Anita." (`foreman.rs2:44-91`); a wrong answer makes him
  attack, and killing him also drops the lumber order (`foreman.rs2:118-138`).
- **The shipyard password** is Ka / Lu / Min (`shipyardworker.rs2:116-142`).
- **Hazelmere's translation**, fixed: None of the above, None of the above, "A man
  came to me with the King's seal.", "I gave the man Daconia rocks.", "And Daconia
  rocks will kill the tree!" (`king_narnode.rs2:180-413`).
- **Daconia rock:** under one of 15 roots, chosen uniformly by
  `%daconia_rock_root = ~random_range(1, 15)` (`king_narnode.rs2:70`). The enum lists
  root (2456,9886) for both values 0 and 1 (`daconia_coords.enum:4-5`); measured,
  value 1 does find the rock there, so every value is completable
  (`quest-grandtree-roots.ts`).

## Helper-supplied items (one trade)

| Item | Qty | Why |
|---|---|---|
| Rune scimitar or better | 1 | black demon (rune scimitar: base Attack 40) |
| Prayer potions | 2-3 | Protect from Melee lasts about 215 ticks at Prayer 43; the demon took 158-334 |
| Food | a few | in case prayer runs out |
| Law, air, fire runes (Varrock teleport) or law + water (Ardougne) | 1 cast each | the return from Karamja (step J), and Hazelmere with Ardougne |
| Agility potion | 1 | only if Agility is 22-24 |

No quest item is tradeable or helper-suppliable: the bark sample, translation book,
scroll, journal, lumber order, key, invasion plans, twigs and Daconia rock are all
handed out by the quest.

## Step list

Pages and choices cost 2 ticks each (stock client). Walks are `bot.walkTo` ticks;
tile counts are on the route.

| Seg | Step | Answers | Stage | Raw counts | Ticks |
|---|---|---|---|---|---|
| A | Village spirit tree → stronghold tree (from the end of Tree Gnome Village: 6 pages, 2 choices) | Where can I go? / Gnome stronghold. | | tree | 20-23 |
| A | Walk to the Grand Tree door, open it (doors are scripted: open = 2-tile forcemove) | | | 48 tiles, 1 door | 25-27 + 5-6 |
| A | **King Narnode**: talk, he walks you down his trapdoor to the roots and back up (`p_delay` by his walking distance, `king_narnode.rs2:199-308`) | You seem worried, what's up? / I'd be happy to help! | 0→10 | 28 pages, 2 choices, two scripted walks | 102-103 |
| B | Out of the tree, walk to the stronghold gate, through it, walk to Hazelmere's ladder (2677,3087), climb | | | 3+105+456 tiles, door, gate, ladder | 4+6+57+9+255+3 |
| B | Hazelmere (bark sample → scroll) | | 10→20 | 9 pages | 21 |
| C | Ladder down; walk to the maze entrance; Elkoy jumps you to the railing; squeeze; walk to the village tree; tree to the stronghold; walk to the door | Yes please. / Where can I go? / Gnome stronghold. | | 279+27+48 tiles; 11 pages, 3 choices | 2+158+15+4+21+23+25+6 |
| C | Narnode: Hazelmere's message | (translation above) | 20→30 | 17 pages, 6 choices | 48 |
| D | Out; walk to Glough's house ladder (2476,3463); up; Glough | | 30→40 | 36 tiles, door, ladder; 10 pages | 5+5+21+3+24 |
| E | Down; walk to the tree; door; Narnode | | 40→50 | 34 tiles, door, ladder; 7 pages | 4+18+6+17 |
| F | Ladder up three floors to the jail (2466,3495); Charlie | | 50→60 | 3 ladders; 11 pages | 3+6+24 |
| G | Down three floors; out; Glough's house; open the cupboard (2476,3465), search it (journal) | | 60→70 | 3 ladders, 36 tiles, door, ladder, 2 locs, 1 page | 6+3+6+17+3+3+5 |
| H | **Glough**: calls the guards, you are walked up to the jail, Charlie talks, Narnode lets you out (`glough.rs2:33-68`, `charlie.rs2:58-83`) | | 70→80 | 20 pages, about 30 ticks of scripted walking and `p_delay` | 66 |
| I | Glider pilot on the top floor: "Take me to Karamja". The glider crashes near the shipyard (2917,3058); the crash dialogue ends itself after two pages | Take me to Karamja please! | | 8 pages, 1 choice, `p_delay(4)` | 29 |
| I | Walk to the shipyard gate; the worker; password; gate opens | Glough sent me. / Ka. / Lu. / Min. | | 27 tiles; 11 pages, 4 choices, `p_delay(3)` | 16+38 |
| I | Walk to the foreman (2999,3043); he walks you to his office; quiz; lumber order | (quiz above) | 80→90 | 69 tiles; 29 pages, 3 choices, office walk | 39+84 |
| J | **Varrock teleport**; walk to the Varrock young spirit tree (3177,3506); → village tree; → stronghold. Arriving by spirit tree is inside the stronghold gate, so the gate guards (`gnome_gate.rs2:13-20`) and Femi's cart (`femi.rs2`) are skipped | Yes please. / Where can I go? / Gnome stronghold. | | tele, 152 tiles; 10 pages, 3 choices | 4+91+15+20 |
| J | Walk to the tree, door, up three floors, Charlie | | 90→100 | 52 tiles, door, 3 ladders; 9 pages | 25+6+4+6+20 |
| K | Down; out; walk to Anita's stairs (2389,3512); up; Anita (key); down; walk to Glough's ladder; up; use the key on the chest (2482,3462) | | 100→110 | 178 tiles, door, 3 ladders, 2 stairs; 12 pages | 6+3+6+49+2+28+6+62+2+11 |
| L | Down; walk to the tree; door; Narnode (twigs) | | 110→120 | 34 tiles, door, ladder; 9 pages | 6+17+6+21 |
| M | Out; Glough's ladder; **climb the tree (Agility 25)** to the pillars; use the four twigs on pillars T, U, Z, O at (2485-2488,3467) in that order (`quest_grandtree.rs2:35-51`) | | 120→130 | 36 tiles, door, ladder, climb, 4 item-on-loc | 3+5+17+3+9+16 |
| N | Open the trapdoor (2487,3464): Glough's scene, then the black demon | | | 5 pages, scripted walk | 34 |
| N | **Kill the black demon** (Protect from Melee) | | 130→140 | fight | 237 mean (158-334) |
| O | Walk through the roots to Narnode (2464,9897); the guards check Glough's passage (`king_narnode.rs2:41-72`, `p_delay(6)` and `p_delay(4)`) | | 140→150 | 97 tiles; 18 pages | 58+55 |
| P | Search roots for the Daconia rock, then back to Narnode | | | expected 77 (model; up to 164) | 77 |
| P | Narnode: finish (the rock is taken by the completion queue) | | 150→160 | 22 pages | 49 |

### Daconia search

The rock is under one root chosen uniformly from 15, so the search is a gamble.
`quest-gnome-routes.ts` finds the order that minimises the **expected** cost from
Narnode and back: roots 10, 8, 9, 7, 6, 5, 4, 1, 2, 3, 11, 12, 13, 14, 15 (enum
values; the coordinates are in the script). With 3 ticks per root it expects
**77 ticks** (best case about 10, worst 164) (inferred from measured parts: route
tiles offline, searches measured). A root without the rock takes 2-3 ticks from an
adjacent tile, mean 2.4 over 5 (measured); the rock's root takes 3 ticks plus its
item page (measured, 15 of 15 values) (`quest-grandtree-roots.ts`).

## Travel

| Leg | Fastest option | Needs | Ticks | On foot / alternative |
|---|---|---|---|---|
| Start: village → stronghold | village spirit tree | Tree Gnome Village | 20-23 + 48 tiles | |
| Narnode → Hazelmere (step B) | **Ardougne teleport** + 307 tiles | Magic 51, Plague City (`teleport.rs2:22-38`), 2 law + 2 water | about 4 + 155 = 159 (tiles offline) | on foot via the gate: 331 measured (301 tile model). The stronghold spirit tree is closed until the quest ends (`spirit_tree.rs2:1-5`) |
| Hazelmere → Narnode (step C) | **Ardougne teleport** + 124 tiles to the Battlefield young tree + young tree + village tree | as above | about 4 + 63 + 15 + 20 + 31 = 133 | Elkoy route measured: 254 |
| Karamja → stronghold (step J) | Varrock teleport + young tree + village tree | Magic 25, 1 law, 3 air, 1 fire | 130 measured | Ardougne teleport + Battlefield young tree: about 117 |
| Stronghold → Karamja (step I) | the quest's own glider crash | | 29 | |

With Plague City done before this quest, B and C save about 290 ticks together
(inferred from the tile counts above).

## Fight

| | Black demon |
|---|---|
| Level, hp | 172, 157 hp (`[grandtree_blackdemon]`) |
| Attack / strength / defence | 145 / 148 / 152, slash melee |
| Mechanic | only fights the player Glough summoned it for; deletes itself if you go more than 17 tiles away or log out (`grandtree_black_demon.rs2:15-22`) |
| At 70/70/70, rune scimitar, Protect from Melee | **237 ticks mean**: 158, 193, 197, 305, 334 (5 kills). 0 damage while prayer lasted; in the 305 and 334 kills prayer ran out (43 points used) and the player took 144-168 damage (measured, `quest-gnome-fights.ts blackdemon` and the full run) |
| Minimum safe stats | any, with Protect from Melee **and prayer potions**; time scales with accuracy and max hit |
| Combat xp | about 628 base in the trained style plus 209 Hitpoints (inferred: 157 x 4, x 1.33) |

## Tick total

| Part | Measured | Tile model | Raw counts | Basis |
|---|---|---|---|---|
| Travel | 997 | 892 | 1,718 tiles in 25 walks | measured, `quest-grandtree-full.ts` |
| Dialogue | 733 | 733 | 245 pages, 22 choices (includes the scripted walks inside Narnode's, Glough's and the foreman's scenes) | measured |
| Interactions | 176 | 176 | 2 doors per visit, 21 ladder/stair climbs, gate, crates, 4 twigs, teleport | measured |
| Fight | 237 | 237 | black demon | measured, `quest-gnome-fights.ts` |
| Waits | 77 | 77 | Daconia search (expected) | inferred from measured parts |
| **Total, on foot** | **2,220** | **2,115** | | |
| With the Ardougne teleport for B and C | about 1,930 | about 1,825 | | inferred |

With the fixed lite client (cairn://p/rs/22) dialogue drops by about 270 ticks.

## Risks and gotchas

- **Scripted silences.** Narnode's trapdoor walk (up to about 25 ticks, depends on
  where he wanders), Glough's arrest (about 30), the foreman's office walk (about
  20), Bolren-style chants: a bot must not treat a closed chat box as the end.
- **Black demon prayer.** Prayer 43 lasts about 215 ticks of Protect from Melee;
  bring potions or the long kills turn into 150 damage.
- **Do not leave the demon area**: it deletes itself beyond 17 tiles or on logout
  (`grandtree_black_demon.rs2:15-22`), and the stage needs the kill.
- **The demon trapdoor scene** spawns Glough next to you; talking to him resets
  nothing but costs pages.
- **Wrong translation answers** restart the five choices (`king_narnode.rs2:415-418`).
- No logout-unsafe stage varps (`grandtree` is permanent), apart from the demon
  itself.

## Agility: comparison with the Agility child

My reading agrees with the brief: Grand Tree's only Agility check is
`stat(agility) < 25` at `quest_grandtree.rs2:25`, boosted. So Agility 22 plus a
+3 Agility potion satisfies it, and 25 without a potion. It gates only the climb to
the twig pillars (segment M), late in the quest, so the Agility can come from an
earlier quest or from training done in parallel.

## Open questions

- Whether walking away from the last pages of a dialogue after the stage is set
  skips them safely (for example Narnode's last 3 pages in C, the crash dialogue in
  I already ends early). Untested.
- The black demon kill time at the stats the scored account will really have.
