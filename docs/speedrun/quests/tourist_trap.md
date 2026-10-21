# The Tourist Trap

**Verdict: about 1,830 ticks on the stock client (about 1,560 with the client fix, about
1,430 with dialogue bursts), for two picks of 4,650 base, plus a combat level of at least
87 so the camp's Rowdy Guards leave you alone.** Spent as recommended below (one Agility
pick, one Thieving pick), the picks save about 1,060 ticks of training, so the quest loses
about 370-770 ticks as xp. Do it for its 2 quest points or the dart unlock, not for the
xp. The camp, the mine and the cart section are about 60% of the time, and four walks
between the camp and the Bedabin tents are another 15%.

**Reward recommendation: first pick Agility, second pick Thieving (Agility twice is
nearly as good, and the coordinator's default).** The two picks are independent: the
order doesn't matter, and the same skill can take both (measured). Fletching and Smithing
are helper-fed, so a pick there replaces almost no playtime. Details in "Reward".

The quest was played start to finish on the lab server by
`docs/speedrun/scripts/quest-touristtrap-run.ts` at the production tick rate
(`NODE_TICKRATE=300`), with the stock lite client and `bot.walkTo`, plus partial runs at
100 ms ticks from two later start points (`shabim`, `mine`) while debugging, and two
earlier full runs at 70/70/70 melee. Tile counts come from
`quest-digsite-touristtrap-paths.ts`.

```sh
NODE_TICKRATE=300 BOTS=tt16 docs/speedrun/scripts/quest-digsite-lab-session.sh \
    bun docs/speedrun/scripts/quest-touristtrap-run.ts tt16 [start|shabim|mine] [thieving] [melee]
```

## Reward

Read, `quest_desertrescue/scripts/irena.rs2:77-101`:

- `p_choice4("Fletching.", "Agility.", "Smithing.", "Thieving")` (`:78`), then
  `stat_advance(<skill>, 46500)`, which is **4,650 base** for Fletching `:80`, Agility `:83`,
  Smithing `:86` or Thieving `:89`.
- After each pick `%desertrescue` goes up by one (`:92`), from 27 to 28 to 29. At 28
  Irena says "now choose your second skill" and offers the **same four skills again**
  (`:96-98`); at 29 the quest completes (`:99-101`). So the second pick doesn't depend on
  the first: there is no exclusion and no change in amount, and **Agility twice** is
  allowed (measured: the playthrough picked Agility twice and gained 232,500 game Agility
  xp, which is 9,300 base).
- 2 quest points (`general/configs/quest.constant:84`); dart smithing is unlocked by Al
  Shabim (`al_shabim.rs2:71`); 6 bronze darts (`:59-63`).

What a pick saves, from the skill-route documents on cairn://p/rs/2's branch (inferred
there):

| Pick | Saves | Source |
|---|---|---|
| Agility, first pick, after Grand Tree + Regicide + Troll Romance + Underground Pass | 662 ticks | `skills/agility.md` section 3 (7.0 base per tick displaced) |
| Agility, second pick, same quest set | 373 ticks (the pair finishes 99: 1,035 together) | `skills/agility.md` section 3 |
| Agility, second pick, if Fremennik Trials is also done | 0 (Fremennik + 1 pick already finishes 99) | `skills/agility.md` section 3 |
| Thieving, on top of Fight Arena | 402 ticks | `skills/thieving.md` section 4 |
| Thieving, from level 1 (no Fight Arena) | 907 ticks | `skills/thieving.md` section 4 |
| Fletching or Smithing | close to 0: helper-fed skills, whose scored-account time is clicks on supplied materials | inferred |

So the first pick goes to Agility (662), and the second is a near tie between Thieving
(402 after Fight Arena) and Agility (373, or 0 with Fremennik). Thieving wins clearly
(907) if the route skips Fight Arena. The reward comes at the very end of the quest, so a
pick helps only training done after Tourist Trap. Neither pick helps the quest's own
Agility and Thieving rolls (the cart and the lock below).

## Requirements as enforced by this server

- **Smithing 20** to forge the dart tip: `stat(smithing) < 20` (`quest_desertrescue.rs2:603`).
- **Fletching 10** to finish the dart: `stat(fletching) < 10` (`quest_desertrescue.rs2:655`).
- Both use `stat()`, the boosted level. The wiki lists the same two, and nothing else is
  checked. No quest or quest-point requirement.
- **Combat, in practice.** Mercenary Captain, level 47, 80 hp, attack 32, strength 29,
  defence 32 (`configs/desertrescue.npc:252-303`), fought one-on-one. Rowdy Guards, level
  43, 60 hp, attack nearby players (huntmode `cowardly`, huntrange 1,
  `desertrescue.npc:364-397`) unless the player's combat level is above twice theirs:
  `player.combatLevel > type.vislevel * 2` (read, `server/engine/src/engine/entity/Npc.ts:1011`).
  **So combat 87 or more makes the camp safe.** That is about 76 in Attack, Strength,
  Defence and Hitpoints (inferred from the standard combat formula).
- Random rolls, all `stat_random(stat, low, high)`, which succeed with probability
  (⌊low(99-L)/98⌋ + ⌊high(L-1)/98⌋ + 1)/256 at current level L
  (`server/engine/src/engine/script/handlers/PlayerOps.ts:591-600`):

| Roll | Line | Chance at the levels that matter (read) |
|---|---|---|
| Slave's lock, Thieving (20, 250) | `mining_slave.rs2:111` | 30% at 25, 44% at 40, 57% at 55, 71% at 70, 98% at 99 |
| Dart tip, Smithing (61, 245); a failure destroys the bar | `quest_desertrescue.rs2:621` | 38% at 20, 52% at 40, 96% at 99 |
| Feathers, Fletching (61, 254); a failure destroys 10 feathers | `quest_desertrescue.rs2:659` | 31% at 10, 54% at 40, 99.6% at 99 |
| Squeeze into a mine cart, Agility (100, 250); 2 rides; a failure deals 2 damage | `quest_desertrescue.rs2:820` | 39% at 1, 54% at 25, 69% at 50 |

- All quest items are untradeable (`tradeable=no` in `desertrescue.obj`).

## Helper-supplied items (one trade, 9 ticks)

| Item | Qty | Why |
|---|---|---|
| Amulet of glory (charged) | 1 | teleport to Al Kharid |
| Shantay pass | 1 | the first crossing (`shantay_pass.rs2:79-97`) |
| Waterskin (4) | 1-2 | desert heat takes a sip every 150 ticks (190 in full desert clothes), else 1-10 damage (`area_desert/scripts/desert_heat.rs2:10-119`). The playthrough used only 2 sips (measured: it ended with Waterskin(2) and two full ones), since the camp, the mine and the tents spare you most of the time (`desertheat_disabled_zones`, `desert_heat.rs2:72-75`). |
| Desert shirt, desert robe, desert boots | 1 each | traded to the slave for his clothes (`mining_slave.rs2:145-200`); wear them from the start (+40 ticks per sip) |
| Bronze bar | 3-6 | 2.6 expected at Smithing 20; the run used 6 |
| Feathers | 40-80 | 10 per try, 3.2 tries expected at Fletching 10 |
| Hammer | 1 | the experimental anvil (`quest_desertrescue.rs2:592`) |
| A weapon (rune scimitar measured) | 1 | the captain; take it off before entering the camp |
| Food | some | only if combat is below 87 |

The run itself was given 3 waterskins, 6 bars and 80 feathers, and finished with the
surplus.

## Step list

Stages are `%desertrescue` (`configs/desertrescue.constant:1-29`); the sub-steps are bits
in `%desertrescue_map_mechanisms` (`:31-43`). Both are `scope=perm`. Ticks are
**measured** (the 300 ms playthrough: Thieving 25, 80/80/80 melee, Smithing 20, Fletching
10, Agility 1). "Runs" is the dialogue shape for the burst column (CONVENTIONS.md): `Nc`
is N continues, `opt` an option, `|` a new dialogue. Burst ticks don't separately cost
state-changing pages, so they are a lower bound.

| # | Step (where; choices; varp) | Ticks | Pages + options | Runs | Burst | Clicks |
|---|---|---|---|---|---|---|
| - | Glory to Al Kharid (3293,3163) | 6 (primitives) | | | | 2 |
| 1 | Wear the desert clothes | 6 | | | | 3 |
| 2 | Walk to the Shantay Pass (3302,3118) | 52 | | | | |
| 3 | Go through the pass, first time: "Yeah, that poster doesn't scare me!" | 21 | 7 + 1 | `3c,opt,4c` | 3 | 1 |
| 4 | Irena (3303,3113, desert side): "What's the matter?", "Is there a reward if I get her back?", "Okay Irena, calm down..." -> stage 1 | 27 | 9 + 3 | `2c,opt,2c,opt,3c,opt,2c` | 7 | 1 |
| 5 | Walk to the Mercenary Captain (3270,3029) | 43 | | | | |
| 6 | Wield the weapon | 3 | | | | 1 |
| 7 | Captain: "Wow! A real captain!", "I'd love to work for a tough guy like you!", "Can't I do something for a strong Captain like you?", "Sorry Sir, I don't think I can do that.", "It's a funny captain who can't fight his own battles!" -> stage 3, he attacks | 45 | 15 + 5 | `1c,opt,2c,opt,2c,opt,4c,opt,2c,opt,4c` | 11 | 1 |
| 8 | Kill him -> stage 4, metal key added to the inventory | 39 (5 hp lost) | 1 + 0 | `1c` | 1 | 1 |
| 9 | Unwield the weapon | 2 | | | | 1 |
| 10 | Gate (3273,3029) with the key -> stage 5, inside | 7 | | | | 1 |
| 11 | Walk to the male slave (3302,3030) | 15 | | | | |
| 12 | Slave: "I've just arrived.", "Oh yes, that sounds interesting.", "What's that then?", "I can try to undo them for you.", "It's funny you should say that...", "Yeah, okay, let's give it a go." (-> stage 6), lock roll (retry: "Yeah I'll give it another go.") -> stage 7, "Yes, I'll trade." -> stage 8, slave clothes worn | 80 (0 retries) | 32 + 7 | `1c,opt,2c,opt,2c,opt,2c,opt,3c,opt,10c,opt,5c,opt,7c` | 17 | 1 |
| 13 | Mine doors (3301,3036) -> stage 9, underground at (3278,9426) | 8 | | | | 1 |
| 14 | Cave guard (3279,9416), from inside his zone: "I'd like to mine in a different area.", "Yes sir, you're quite right sir." (-> stage 10), "Yes sir, we understand each other perfectly." | 87 | 12 + 3 | `1c,opt,3c,opt,5c,opt,3c` | 7 | 1 |
| 15 | Mine exit doors (3278,9426) to (3301,3036) | 48 | | | | 1 |
| 16 | Take off all three slave clothes (the gate catches any piece, `quest_desertrescue.rs2:110`) | 8 | | | | 3 |
| 17 | Walk to the gate, leave | 25 | | | | 1 |
| 18 | Walk to Al Shabim (3171,3025), about 100 tiles | 66 | | | | |
| 19 | Al Shabim: "I am looking for a pineapple.", "Yes, I'm interested." -> stage 11, Bedabin key | 35 | 12 + 2 | `2c,opt,5c,opt,5c` | 5 | 1 |
| 20 | Walk back to the gate, enter | 80 | | | | 2 |
| 21 | Walk to Siad's ladder (3290,3036), climb | 18 | | | | 1 |
| 22 | Search the bookcase (3284,3032,1) -> sailing bit; Siad: "I wanted to have a chat?", "You seem to have a lot of books!", "So, you're interested in sailing?", "I could tell by the cut of your jib." -> distracted bit; open the chest (3292,3033,1) -> plans, stage 12 | 57 | 15 + 4 | `1c \| 1c,opt,2c,opt,2c,opt,3c,opt,5c \| 1c` | 11 | 3 |
| 23 | Ladder down, walk to the gate, leave | 29 | | | | 2 |
| 24 | Walk to Al Shabim | 67 | | | | |
| 25 | Plans on Al Shabim: "Yes, I'm very interested.", "Yes, I'm kind of curious." (bar, 10 feathers, hammer carried) -> stage 13 | 25 | 7 + 2 | `2c,opt,2c,opt,3c` | 5 | 1 |
| 26 | Talk to the tent guard (3170,3045), plans carried: he walks you in; his `p_delay(3)` must end before the next click | 31 | 2 + 0 | `2c` | 1 | 1 |
| 27 | Bar on the anvil (3171,3048): "Yes, I'd like to try.", 5 `p_delay(2)`s, Smithing roll -> dart tip, stage 14 | **random**: 124 (6 bars) | 1 + 1 per try | `1c,opt` per try | 2 per try | 1 per try |
| 28 | Feathers on the tip: Fletching roll -> prototype dart, stage 15 | **random**: 34 (3 tries) | about 2 per try | | | 1 per try |
| 29 | Leave the tent; talk to Al Shabim (the scene closes for a `p_delay(2)` mid-way) -> stage 16, Tenti pineapple | 60 | 14 + 0 | `6c \| 8c` | 4 | 2 |
| 30 | Walk to the gate, enter, wear the slave clothes, walk to the mine doors, enter | 120 | | | | 6 |
| 31 | Cave guard: talk (the pineapple is taken) -> stage 17 | 66 | 5 + 0 | `5c` | 1 | 1 |
| 32 | Cave passage (3281,9415) east to (3286,9415) | 6 | | | | 1 |
| 33 | Empty barrel (3303,9418), Search: "Yeah, cool!" | 19 | 2 + 1 | `1c,opt,1c` | 3 | 1 |
| 34 | Lower mine cart (3303,9417), Search: "Yes, of course.", Agility roll -> (3319,9431), stage 18 | **random**: 12 (1 try) | 3 + 1 | `2c,opt,1c` | 3 | 1 per try |
| 35 | Walk to Ana (3302,9466); use the barrel on her -> stage 19, Ana in a barrel | 33 | 1 + 0 | `1c` | 1 | 1 |
| 36 | Walk to the upper cart (3318,9430); use Ana on it -> stage 20 | 38 | | | | 1 |
| 37 | Upper cart, Search: "Yes, of course.", Agility roll -> (3302,9417) | **random**: 21 (2 tries) | about 2 + 1 per try | | | 1 per try |
| 38 | Barrel by the lower cart, Search: Ana -> stage 21 | 10 | 2 + 0 | `2c` | 1 | 1 |
| 39 | Ana on the lift (3292,9423), guard beside it: "Yes please.", "I said you were very gregarious!" -> stage 22 | 56 | 17 + 2 | `2c,opt,9c,opt,6c` | 7 | 1 |
| 40 | Cave passage west; mine exit doors to the surface | 58 | | | | 2 |
| 41 | Walk to the surface winch (3279,3017), Operate -> stage 23 | 29 | 2 + 0 | `2c` | 1 | 1 |
| 42 | Upper barrel (3278,3017), Search: Ana -> stage 24 | 7 | 1 + 0 | `1c` | 1 | 1 |
| 43 | Ana on the mine cart (3287,3023) -> stage 25 | 10 | 1 + 0 | `1c` | 1 | 1 |
| 44 | Cart driver (3287,3022): "Nice cart.", "One wagon wheel says to the other...", "'One good turn deserves another'", "Fired... no, shot perhaps!", "In for a penny in for a pound.", "Well, you see, it's like this...", "Prison riot in ten minutes, get your cart out of here!", "You can't leave me here, I'll get killed!" -> ready bit | 92 | 26 + 8 | `1c,opt,4c,opt,3c,opt,3c,opt,2c,opt,5c,opt,2c,opt,4c,opt,2c` | 17 | 1 |
| 45 | Cart, Search: "Yes, I'll get on." -> stage 26, outside the camp at (3258,3029) holding Ana | 15 | 3 + 1 | `1c,opt,1c \| 1c` | 4 | 1 |
| 46 | Walk to Irena (3303,3113); no pass needed, she is on the desert side | 48 | | | | |
| 47 | Irena (Ana's part closes the dialogue for a `p_delay(2)`): "Agility." and then "Thieving" (run: Agility twice) -> stages 27, 28, 29, quest complete | 33 | 9 + 2 | `2c \| 3c \| 2c,opt,1c,opt,1c` | 7 | 1 |

After the quest the account is just inside the desert; going north through the pass
costs 2 ticks (`primitives.md` §5).

## Fights

| Stats (melee, rune scimitar) | Combat level | Captain fight | Rowdy Guards | Basis |
|---|---|---|---|---|
| 80/80/80, 80 hp | 92 | 39 ticks, 5 hp lost | never attacked (the whole quest) | measured, 300 ms run |
| 70/70/70, 70 hp | 80 | 63-68 ticks, 11-12 hp lost | attacked on the walk to the slave (a 109-tick fight) and again at the slave, **which killed the account** (no food) | measured, two 100 ms runs |

The captain is a one-on-one duel (`mercenary_captain.rs2:62-67`); his death hook awards
the stage and the key only if `finduid(%npc_aggressive_player)` succeeds
(`mercenary_captain.rs2:193-196`), the pattern the coordinator flagged for Sir Mordred.
In 5 of 5 kills measured here the key arrived. Wield requirements: a rune scimitar needs
base Attack 40 (see `levelrequire/` per the coordinator's note); nothing in this quest
checks the weapon.

## Tick total

Random parts, expected (inferred from the read chances and the measured cost per try):

| Roll | Measured in the run | Cost per try (measured) | Expected tries | Expected ticks |
|---|---|---|---|---|
| Dart tip (Smithing 20) | 6 bars, 124 ticks | 20.7 | 2.6 | 55 |
| Feathers (Fletching 10) | 3 tries, 34 ticks | 11.3 | 3.2 | 37 |
| Mine carts (Agility 1, 2 rides) | 3 tries, 33 ticks | 11 | 5.1 | 56 |
| Slave's lock (Thieving 25) | 0 retries | about 7 per retry | 0.8 | 6, plus 34% x about 100 for the cell (below) = 40 |

| Part | Stock client | Fixed client (rs/22) | Burst | Basis |
|---|---|---|---|---|
| Travel: 16 walks, `bot.walkTo` | 594 | 594 | 594 | measured; chained clicks would save about 11% |
| Dialogue: 218 pages + 50 options | 536 | 268 | 141 | counts measured; 2 / 1 / burst |
| Fight (captain, 80/80/80) | 39 | 39 | 39 | measured |
| Interactions and waits | 462 | 462 or less | 462 or less | measured, by subtraction (1,631 non-random - travel - dialogue - fight) |
| Random rolls | 188 | about 180 | about 180 | inferred, table above (the run drew 191) |
| Glory teleport | 6 | 6 | 6 | measured, `primitives.md` §4 |
| Helper trade | 9 | 5 | 5 | measured, `primitives.md` §6 |
| **Total** | **about 1,830** | **about 1,560** | **about 1,430** | |

The measured playthrough was 1,822 ticks wall-clock (1,815 in segments), drawing bad
luck on the bars and good luck on the lock. As with Digsite, the fixed client would also
save a reaction tick per loc or item click (about 60), so its column is an upper bound.
The base xp per tick is 9,300 / 1,830 = 5.1 on the stock client.

## Risks and gotchas

- **Rowdy Guards below combat 87.** They roam the camp surface and the mine (9 spawns,
  wanderrange 3) and attack anyone they pass beside. At 70/70/70 one walk drew two fights
  and a death. Either be combat 87+ or carry food and add about 110 ticks per fight.
- **The slave's lock sends you to a cell on the third failure in a row** if a guard is
  within 10 tiles, which one always is at that slave (`mining_slave.rs2:115-127`): 34% at
  Thieving 25, 8% at 55, 2% at 70. The attempt count is kept in the varp across
  conversations. Getting out takes a window-bar bend (Strength roll, `quest_desertrescue.rs2:199-229`),
  a rock climb (Agility roll, `:247-274`) and the walk back, about 100 ticks (inferred,
  not measured).
- **Weapons and armour are searched for** at the gate and on a 25-100 tick timer inside
  the camp (`quest_desertrescue.rs2:119-131,136-162`); a hit means the cell. Take off the
  weapon and any armour before the gate. Desert clothes are not armour.
- **Any piece of slave clothing at the gate, going out, with a guard within 4 tiles,
  means the cell** (`quest_desertrescue.rs2:110-117`). Take all three off before leaving,
  and put them back on before the mine doors (6 clicks, about 17 ticks, measured).
- **The clothes trade duplicates the slave clothes** (measured): with the desert clothes
  worn, the slave's swap puts the slave clothes in the worn slots *and* a second set in
  the inventory. It is harmless here (three extra slots), but it looks like a server bug
  in `mining_slave.rs2:170-200`.
- **Bronze bars and feathers are destroyed on a failed roll**, so pack enough.
- **Two scenes close the dialogue in the middle**: Al Shabim takes the plans with an
  `if_close; p_delay(2)` (`al_shabim.rs2:53-55`), and Ana's goodbye does the same before
  the reward picks (`ana.rs2:9-17`). A bot that treats the close as the end will act too
  early. The tent guard ends with `p_delay(3)` after moving you in, and a click inside it is
  lost (measured).
- **Clicking the camp gate from outside** answered "I can't reach that!" on the first try
  in 2 of the 3 entries of the 300 ms run (measured); the retry cost about 3 ticks. `bot.walkTo` aimed at the
  tile in front of the mine doors opens them itself, and once routed into Siad's locked
  cell door.
- **Logout**: both quest varps are `scope=perm`, and none of the 16 temporary quest varps
  (`primitives.md` §8) belong to Tourist Trap. Ana in a barrel is an inventory item. The
  quest is logout-safe between steps, except that logging out is refused within about 16
  ticks of combat. The desert heat timer restarts on login (`desert_heat.rs2:2-8`), which
  is harmless.

## Open questions

- The cell escape's cost is inferred, not measured.
- The Fletching and Smithing pick values are taken as near zero because those skills are
  helper-fed. The skill-route issue's helper-fed rates will confirm or revise that.
- The order of the two Al Shabim trips is forced by the stages (the pineapple errand
  needs stage 10 from the cave guard; Siad's chest needs the Bedabin key). No shortcut for
  the four camp-to-tents walks was found in this content.
