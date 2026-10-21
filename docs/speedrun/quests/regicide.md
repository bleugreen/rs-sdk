# Regicide

**About 1,830 ticks of Regicide itself (about 9 minutes at 300 ms) plus two forced
Underground Pass traversals of about 635 and 680 ticks, so about 3,150 ticks
(16 minutes) in all, at Agility 56 and 70/70/70 melee, for 13,750 base Agility and
3 quest points.** The two pass traversals are not optional: the account must
enter Tirannwn at stage 2 (the Arandar gate is shut from outside until stage 13),
and it must enter again at stage 11 carrying naphtha, because the only still is
in Rimmington and the catapult only fires at stage 11. Inside Regicide the cost is
mostly walking the Isafdar forest (it is cut into regions joined only by agility
obstacles), the Tyras guard fight (about 200 ticks at 70 melee) and dialogue.
With the fixed client the total is about 3,060, with dialogue bursts about 3,015.

**Verdict: Regicide does not pay.** Its 13,750 Agility replaces about 2,000 ticks of
Wilderness laps, a loss of about 1,000-1,150 ticks even when Underground Pass is already
done for Legends' Quest; the whole four-quest chain costs about 7,400-8,100 ticks for
about 3,200-3,550 ticks of skill training. See
[The Regicide chain: total and verdict](#the-regicide-chain-total-and-verdict).

All ticks are stock lite client (2 ticks per dialogue page, `primitives.md`). Lab:
one engine at `NODE_TICKRATE=300`, bot `rs15rg`, Agility 56 unless stated. Scripts
are listed at the end; each **measured** figure names its script.

## Reward

- **13,750 base Agility** (343,750 game xp at 25x): `stat_advance(agility, 137500)`
  is in tenths (read, `quest_regicide.rs2:852`; measured, `quest-regicide-segments.ts
  lathas14`, which saw +343,750 game xp three ticks after the dialogue closed).
- 15,000 coins (read, `:851`) and **3 quest points** (`^regicide_questpoints`).
- Completion is queued by King Lathas (2578,3293, level 1) when handed Iorwerth's
  message at stage 14 (read, `king_lathas.rs2:7-20`).
- Unlocks: wielding the dragon halberd (`levelrequire/scripts/tier60.rs2:10`, via
  `levelrequire_regicide_quest`), the Tirannwn general store (read,
  `regicidegeneralshopkeeper.rs2:3`), and Arandar gate passage from outside
  (stage > 12).

## Requirements (as this server enforces them)

- **Underground Pass complete** (`%upass = 10`) at **login**: the King's messenger
  timer is armed only by `login_logout/login.rs2:74` -> `start_king_messenger_timer`
  (`regicide_kings_messenger.rs2:1-4`) with `~random_range(400, 1200)` ticks. So after
  UP is handed in, the account must log out and in, then stay logged in 400-1200
  ticks (measured once: **998**, `quest-regicide-messenger.ts`); it can train or quest
  meanwhile, and the messenger walks to wherever it is. Biohazard is not checked by
  Regicide itself (only the chemist's lines use it).
- **Agility 56, boosted** (`stat(agility) < 56`, `quest_regicide.rs2:404`) for every
  "Dense forest" cross-over, which also need `%regicide_quest >= 8`
  (`:389`). Strictly required: Tyras's camp is reachable only through cross-overs
  and stage 10 is set by crossing `regicide_cross_over2_tyras_camp` (`:467-470`).
  The script checks both directions (`:402-407`).
- **Agility 45, boosted** for the log balances (`stat(agility) < 45`, `:346`, `:368`).
  The route crosses log balance 1 five times and log balance 2 or 3 never.
- **Crafting 10, boosted** at the Tirannwn loom (`stat(crafting) < 10`, `:674`).
- No Magic, Thieving or combat level checks. Traps (woodsprings, tripwires,
  pitfalls) have no level gate, only `stat_random` rolls (below).
- **Boosts that exist here** (read): the agility potion gives +3 Agility
  (`player/configs/consumption/consume_effects.dbrow:288-294`, `4dose1agility`,
  tradeable), so base 53 with a potion passes the 56 checks. Boosts drain 1 level per
  100 ticks (`login.rs2:36`, `stat.rs2:45-56`) and reset at login
  (`stat_boost_login`), so base 53 needs a fresh dose every 100 ticks of cross-over
  use (base 54 every 200, base 55 every 300). Nothing else raises Agility: there is no
  `stat_boost`/`stat_add` on agility in any `.rs2`, no summer pie, and the restore
  potions only heal back to base (`consume_effects.dbrow:319`). Kamen's brew in UP
  **lowers** Agility by 3 (`quest_upass/scripts/kamen.rs2:18`); refuse it. The poison
  chalice can give +1 Crafting at random (`poison_chalice.rs2:17`); irrelevant.
- Members world (the chemist and the grinding script check `map_members`).

## Items

| Item | Tradeable | Source |
|---|---|---|
| Limestone, coal (5 used, carry 8), ball of wool x4, cooked rabbit, pestle and mortar, pot | **yes** (`quest_regicide.obj:64-76`, `ores.obj`, `crafting.obj`, `tools.obj`, `cooking.obj`) | helper |
| Food (swordfish), combat gear, teleport runes (Falador 1, Ardougne 2-3), agility potion if base Agility < 56 | yes | helper |
| Barrel, barrel of coal-tar, naphtha, the mixes, barrel bomb, quicklime, pot of quicklime, sulphur, ground sulphur, cloth, crystal pendant, book, both messages | **no** (`quest_regicide.obj`) | scored account |

Not needed, contrary to the brief: a **tinderbox** (the catapult fires the bomb, no
lighting step) and **leather gloves**. The quicklime burn check is
`inv_totalcat(worn, armour_hands)` (`quest_regicide.rs2:665`) and leather gloves are
category `gloves`; only dragonhide vambraces, the Family Crest gauntlets and Klank's
gauntlets are `armour_hands`. Without them the furnace step costs 8 hitpoints and no
time (measured, `quest-regicide-segments.ts quicklime`).

**One helper trade (9 ticks) before the first entry** carries: limestone, 8 coal, 4
balls of wool, cooked rabbit, pestle and mortar, pot, food, runes, plus what the two
Underground Pass traversals use (per the Underground Pass agent): a bow, 2 arrows (one
per traversal), a tinderbox, 2 ropes and a spade. The tinderbox is for the pass's fire
arrow, not for Regicide. The helper cannot
enter Tirannwn (it would need the whole Underground Pass and Regicide chain), so
everything after the first entry must already be on the scored account.

## The map: why the route looks the way it does

Isafdar is split into walkable regions joined only by scripted crossings
(`quest-regicide-graph.ts` flood-fills the regions with the engine's `canTravel` and
adds each crossing with the landing tiles the script computes):

| Crossing | Op, roll | Measured cost (Agility 56) | Script |
|---|---|---|---|
| Log balance (45) | Cross, no roll | 8 ticks (log 1), 9 (log 3); 6/6 each | `quest-regicide-obstacles.ts log/log3` |
| Pitfall ("Leaves") | Jump, `stat_random(agility,160,300)`: 93% at 56, 100% at 65+ | 2 ticks to land; 1 fall in 26 jumps at 56 (pit, 15 damage, climb out: about +6 ticks) | `... pitfall` |
| Woodspring ("Sticks") | Pass, `stat_random(agility,30,155)`: 39% at 56, 46% at 70, 61% at 99 | success 6 ticks, each failure about 4 more and 8 damage; mean per crossing 10.4 at 56 (14 crossings, 38% of 37 tries), 11.4 at 70 (42% of 33) | `... woodspring` |
| Tripwire | Step-over, roll only decides poison and 2x5 damage | 5 ticks; walking straight through also crosses but costs about 2.5 more ticks, 10-12 damage and poison | `... tripwire` |
| Cross-over (56, stage >= 8) | Enter | lands in 2 ticks, then `p_delay(3)`: chained cross-overs cost 6-7 ticks each | `... crossover`, `quest-regicide-traverse.ts` |

Roll odds are the engine formula (`PlayerOps.ts:591-600`): success if
`floor(low*(99-L)/98) + floor(high*(L-1)/98) + 1 > random(256)`.

Walking onto a trap is worse than its op: pitfall tiles drop you into the pit
(`regicide_zones.rs2:73-82`), woodspring trigger tiles throw you back (`:53-66`).
All are `blockwalk=no` locs, so an ordinary click route can cross them; the route
scripts block these tiles.

What the graph shows (read from the collision map, confirmed by the live
traversals below):

- **Before stage 8 (no cross-overs)** the temple exit reaches Lord Iorwerth only via
  pitfall (2267,3203) -> woodspring (2235,3181) -> pitfall (2209,3203) -> log balance
  1: 170 route tiles. Iorwerth <-> the old-camp tracker is 115 tiles with log balance 1
  and pitfall (2209,3203). The tar pools and sulphur are in the tracker's region (22
  tiles from him).
- **Everything in or near Tyras's camp needs the cross-overs**: tracker -> the guard
  spot (3), the camp entry (3 + the camp cross-over), the furnace inside the camp, the
  lazy guard and catapult, and the way to Arandar (10 cross-overs and 2 logs from
  Iorwerth). The crossings that **strictly** require Agility 56 are therefore the
  three at (2232-2238,3148), the three at (2216,3161-3167) and the camp cross-over at
  (2187,3169); there is no bypass.

## Route and ordering (recommended)

Forced: two Underground Pass traversals, the stage-4/5 shuttle between Iorwerth and
the tracker (Iorwerth hands out the pendant only at stage 5, `lord_iorwerth.rs2:93-107`,
and the tracker sets 5 only at stage 4, `regicide_camp_tracker.rs2:34-48`), and the
guard fight.

What this server allows that shortens it (all read, three measured):

1. **Teleports work in Tirannwn** (no check in `pre_tele_checks`; measured: Falador
   teleport from the tracker arrives in 4 ticks, 3/3, `quest-regicide-obstacles.ts
   teleport`). So the account never needs to walk to Arandar: it teleports out with the
   tar, and at the end teleports to Ardougne.
2. **Quicklime works in any furnace** at stage >= 11: the generic `use_furnace` sends
   limestone to `regicide_heat_quicklime` (`skill_smithing/.../smelting.rs2:23`).
   The Falador furnace is 14 tiles from the teleport landing (measured 6 ticks, plus 2
   to grind).
3. **Arianwyn is in East Ardougne**, not at Arandar: the trigger is zone
   0_40_51_24_32, (2584-2591,3296-3303), on the walk from the Ardougne teleport to
   Lathas's castle stairs (`quest_regicide.rs2:826-830`).
4. The chemist and Koftik are optional: the still has no stage or chemist check
   (`regicide_fractionalizing_still.rs2:4-8`), the chemist bit only feeds the journal,
   and the well works without talking to Koftik.

Ordering: do stages 2-11 and **all** gathering in the first entry (barrel at
Iorwerth's camp, cloth at the loom, tar and sulphur by the tracker), teleport out at
stage 11, make quicklime at Falador and naphtha in Rimmington, assemble the bomb,
then in the second entry go straight to the catapult and back to Iorwerth.
Alternative checked: leaving at stage 10 (straight after entering the camp) and doing
Iorwerth and the camp furnace in the second entry is about 10 ticks worse by route
tiles and crossings, so the extra Iorwerth walk in entry 1 is worth it (inferred,
`quest-regicide-graph.ts`).

## Step list

Quest varp `%regicide_quest` (perm), stages from `quest_regicide.constant`: 0 not
started, 1 message, 2 spoken to Lathas, 3 scouts, 4 Iorwerth, 5 tracker, 6 pendant
shown, 7 footprints, 8 tracker again, 9 guard defeated, 10 entered camp, 11 Iorwerth
again (book), 12 Tyras killed, 13 reported to Iorwerth, 14 Arianwyn, 15 complete
(`general/configs/quest.constant`). Bitfield `%regicide_bits` (perm): 0 Koftik food, 1
down the well, 2 guard seen, 3 rabbit given, 5 chemist. `%regicide_still_total` and
`%regicide_still_settings` are temporary.

"Click to close" dialogue figures run from the talk click to the dialogue closing
(`quest-regicide-segments.ts <segment>`); leg figures run from the start tile to the
arrival tile with every crossing (`quest-regicide-traverse.ts <leg>`).

| # | Where | Action | Varp | Raw counts | Ticks | Label |
|---|---|---|---|---|---|---|
| 0 | anywhere | After UP is handed in: log out and in; 400-1200 logged-in ticks of other activity | | 1 relog | 0 if overlapped (else 400-1200; 998 seen) | read; measured `quest-regicide-messenger.ts` |
| 1 | wherever the player is | King's messenger spawns 1-3 tiles away and walks up; scroll | 0 -> 1 | 2 pages | 3 + 4 = **7** | measured, same |
| 2 | -> King Lathas (2578,3293,1) | Ardougne teleport, 90 tiles to the stairs (2571,3295), climb, 7 tiles | | 1 teleport, 97 tiles, 1 climb | 4 + 46 + 2 + 4 = **56** | inferred (route tiles) |
| 3 | Lathas | "I received your message" (no options) | 1 -> 2 | 6 pages | **15** | measured `segments lathas1` |
| 4 | -> Iban temple doors (2143,4648,1) | Down the stairs, west through the West Ardougne wall doors to the cave (2433,3313), Underground Pass traversal #1 (`%upass` = 10) | | 1 climb, about 150 tiles to the cave, UP crossings and about 600 tiles inside | 2 + about 78 + **555** = **about 635** | UP part measured by the Underground Pass agent (`quest-underground-pass-segments.ts post`, n=4: 545 ticks of steps, about 555 for a player reacting within a tick, cave click to through the doors); approach inferred from its and plague-city's route figures |
| 5 | temple doors -> Well of Voyage | Open door (teleports to (2014,4711,1)), 5 tiles, climb into well1 (2008,4711,1), 31 tiles underground, exit (2312,9623) -> (2312,3216) | | 1 door, 1 well, 36 tiles, 1 exit | 2 + 4 + 17 = **23** | measured `segments iban/well/exit` |
| 6 | Isafdar | Walk west; Idris spawns 20-30 ticks after entering mapzone 0_35_50 (timer runs while walking). **Stand still** after his 2 pages until the elves' 4 pages finish | 2 -> 3 | 6 pages | **18** first page to last close | measured `segments idris` |
| 7 | -> Lord Iorwerth (2205,3252) | pitfall, woodspring, pitfall, log 1 | | 170 tiles, 2 pitfalls, 1 woodspring, 1 log | **134** (132, 136 walking; total runs 161, 167 incl. dialogue) | measured `traverse e1-first` |
| 8 | Iorwerth | Talk | 3 -> 4 | 4 pages | **10** | measured `segments iorwerth3` |
| 9 | barrel (2205,3257) | Pick up the empty barrel (ground spawn, 5 spots) | | ~10 tiles detour, 1 pickup | 5 + 5 = **10** | measured pickup; inferred detour |
| 10 | -> tracker (2257,3149) | log 1, pitfall | | 115 tiles | **82** | measured `traverse iorwerth-tracker` |
| 11 | Tracker | Talk (no pendant yet) | 4 -> 5 | 6 pages | **14** | measured `segments tracker4` |
| 12 | -> Iorwerth | pitfall, log 1 | | 115 tiles | **83** | measured `traverse tracker-iorwerth` |
| 13 | Iorwerth | Talk: crystal pendant | (5) | 4 pages | **10** | measured `segments iorwerth5` |
| 14 | loom (2198,3249) | Use 4 balls of wool on the loom | | 8 tiles, 1 use | 3 + 7 = **10** | measured loom; inferred detour |
| 15 | -> tracker | log 1, pitfall | | 112 tiles | **82** | measured (same leg) |
| 16 | Tracker | Talk with the pendant: shown, then "I need to find Tyras" | 5 -> 6 | 13 pages | **28** | measured `segments tracker5` |
| 17 | Tracks (2240-2241,3150) | Follow, back to the tracker, talk | 6 -> 7 -> 8 | 32 tiles, 1 click, 4 pages | 9 + 1 + 9 + 10 = **29** | measured footprints and tracker7; inferred walk |
| 18 | tar pools (2262-2264,3127), sulphur (2256-2273,3115-3130) | Barrel on the tar, break sulphur, grind it (pestle) | | 22 + 5 + 29 tiles vs 18 direct | **26** | measured actions (2, 2, 2); inferred detour |
| 19 | -> guard spot (2231,3149) | 3 cross-overs at (2238/2235/2232,3148); landing on (2231,3149) at stage 8 spawns the old-camp guard (`quest_regicide.rs2:464-466`) | | 18 tiles, 3 cross-overs | **29** | inferred from measured parts |
| 20 | Tyras guard | Fight (level 110, 110 hp); its death queue sets 9 | 8 -> 9 | fight | **207** median at 70/70/70 (123-253); 124 at 99 | measured `quest-regicide-guard.ts` |
| 21 | -> camp (2188,3168) | tripwire (2220,3153), 3 cross-overs (2216,3161-3167), camp cross-over (2187,3169) | 9 -> 10 | 55 tiles, 1 tripwire, 4 cross-overs | **58** | inferred from measured parts; camp crossing measured `segments camp` |
| 22 | -> Iorwerth | 7 cross-overs, tripwire, pitfall, log 1 | | 167 tiles | **187** | measured `traverse camp-iorwerth` |
| 23 | Iorwerth | Talk: Big Book o' Bangs (needs 1 free slot) | 10 -> 11 | 4 pages | **10** | measured `segments iorwerth10` |
| 24 | -> Falador | Falador teleport (Magic 37) | | 1 teleport | **4** | measured `obstacles teleport` |
| 25 | Falador furnace (2975,3368) | Limestone on the furnace (`p_delay(3)`), grind with pestle and pot | | 14 tiles, 2 actions | 8 + 6 + 2 = **16** | measured `segments quicklime` |
| 26 | -> still (2927,3212), Rimmington | Walk | | 190 tiles | **96** | inferred (route tiles) |
| 27 | Fractionalizing still | **Logout-unsafe.** Tar on the still, button schedule below | | 5 coal, 3 valve clicks, 1 close | **33** click to naphtha | measured `quest-regicide-still.ts`, 6/6 |
| 28 | anywhere | Pot of quicklime on naphtha, ground sulphur on the mix, cloth on the bomb | | 3 item-on-items | **6** | measured `segments bomb` |
| 29 | -> Iban temple doors | Ardougne teleport, wall doors, cave, UP traversal #2 | | 1 teleport, about 250 tiles to the cave, UP crossings | 4 + about 122 + **555** = **about 681** | UP part measured (as row 4); approach inferred by the Underground Pass agent (Ardougne teleport -> doors 59, door 2, -> cave 61) |
| 30 | doors -> surface | as row 5 | | | **23** | measured |
| 31 | -> lazy guard (2181,3184) | pitfall, woodspring, 6 cross-overs, tripwire | | 176 tiles | **182** (one run with 0 woodspring failures; 227 with 4) | measured `traverse e2-guard` |
| 32 | Lazy guard | Use cooked rabbit on him (after the last cross_over3, which clears the bit, `quest_regicide.rs2:473-476`) | bit 3 set | 3 pages | **9** | measured `segments rabbit` |
| 33 | Catapult (2185,3183) | Use the fused barrel bomb: cutscene, `p_delay`s at `:513-596` | 11 -> 12 | 1 use | **35** to moving again (tent at 17, back at 29) | measured `segments catapult` |
| 34 | -> Iorwerth | 6 cross-overs, tripwire, pitfall, log 1 | | 172 tiles | **173** | measured `traverse e2-back` |
| 35 | Iorwerth | "The deed is done": Iorwerth's message | 12 -> 13 | 6 pages | **14** | measured `segments iorwerth12` |
| 36 | -> East Ardougne | Ardougne teleport (Magic 51, Plague City), 71 tiles into zone (2584-2591,3296-3303) | | 1 teleport, 71 tiles | 4 + 37 = **41** | inferred (route tiles) |
| 37 | Arianwyn | 16 queued steps: 15 pages and the message scroll (close it) | 13 -> 14 | 15 pages, 1 scroll | **31** after the zone entry (36 from a 5-tick walk click) | measured `segments arianwyn` |
| 38 | -> Lathas | 19 tiles to the stairs, climb, 7 tiles | | 26 tiles, 1 climb | **16** | inferred |
| 39 | Lathas | "My lord, Tyras is dead!"; reward queued | 14 -> 15 | 5 pages | **15** (12 + xp 3 ticks later) | measured `segments lathas14` |
| | helper trade | before row 4 | | 1 trade | **9** | measured (`primitives.md` §6) |

The Arandar gate is not on this route. For the record (measured,
`quest-regicide-obstacles.ts gate`): from the south (Tirannwn) side it opens at any
stage (2 ticks); from the north it stays shut at stage 11 and opens at 13 (3 ticks),
as `regicide_arandar_gate_guard.rs2:5` reads (`%regicide_quest > 12 | coordz <
loc z`, gate locs at (2384,3334) and (2386,3334)).

## The still (the one segment that must run in one session)

`%regicide_still_total` is a temporary varp: logging out resets it
(`primitives.md` §8). Using the tar turns the barrel into an empty barrel and opens
the window; a 2-tick softtimer then fires (`regicide_fractionalizing_still.rs2:118-158`).
Each fire adds 2 to the total when the tar valve is fully open and the heat needle is
in its green band (positions 6-11); pressure above position 12 or heat above 12
resets everything (but keeps the window and timer running). Closing the window with
the total at 26 or more swaps the empty barrel for naphtha (`:10-17`). The still has
no random rolls, so the best schedule can be computed exactly; `quest-regicide-still.ts
sim` does that by exhaustive search over a line-for-line model of the script.

**Schedule (14 fires, 5 coal):** as soon as the window opens, click the pressure valve
up once (26 -> 27, -2 pressure per fire), the tar valve up twice (29 -> 31, +2 per
fire, so pressure stays at 0) and "add coal" twice (5 events, the per-tick cap). Then
add one coal about 10, 16 and 22 ticks after the window is seen open (before fires 6,
9 and 12). Close the window when the total reaches 26 (fire 14).

Measured (`quest-regicide-still.ts`, 3 runs at the aim point plus margin runs, all
identical when they worked): window open 3 ticks after the click from an adjacent
tile, total 26 at 28 ticks after the window opened, **naphtha 33 ticks after the
click**, 5 coal. The later coal clicks may land up to 2 ticks early or 1 tick late
(shifts -2, -1, 0, +1 all finished in 28 ticks); 2 late or 3 early stalls at 20, because
heat falls below the band and needs one extra coal. Safe policy if a click is missed:
watch for the total not rising for two fires and add one coal; never add two coal in one
window after the start (that is the only way to burn out).

Risk: closing the window early (any interface close) converts the tar to an empty
barrel but keeps the total for the rest of the session. A **second barrel of tar** (one
more pickup and fill in Tirannwn, about 10 ticks) is cheap insurance against having to
re-enter Tirannwn for tar.

## Traps on the recommended route

| Kind | Crossings | Expected cost at 56 | At 70 |
|---|---|---|---|
| Pitfall | 8 (rows 7 x2, 10, 12, 15, 22, 31, 34) | 2-3 each, 7% fall (+6, 15 damage) | 2-3, no falls |
| Woodspring | 2 (rows 7, 31) | about 12 each (10.4 measured mean), 1.6 failures expected (8 damage each) | about 11 |
| Tripwire | 4 (rows 21, 22, 31, 34) | 5-6 each | same |
| Log balance | 6 (rows 7, 10, 12, 15, 22, 34) | 8 each | same |
| Cross-over | 26 (rows 19, 21, 22, 31, 34) | 6-7 each chained | same |

Agility 70 instead of 56 saves only the pitfall falls (about 3 ticks expected over the
route) and a little on the woodsprings (about 2 ticks over two crossings): the
woodspring roll is 46% even at 70.

## Fights

**Tyras guard** (old-camp guard, `quest_regicide.npc:385-430`): combat level 110, 110
hitpoints, attack 85, strength 95, defence 100, attack rate 5, defence bonuses stab 87,
slash 84, crush 76, ranged 79, **magic -10**. Spawned at stage 8 when the player lands on
(2231,3149) (`quest_regicide.rs2:464-466`, `:602-610`), and it attacks. Measured,
`quest-regicide-guard.ts` (rune armour, amulet of strength, aggressive, swordfish below
40%), attack click to death:

| Melee | Weapon | Ticks (3 runs) | Lowest hp | Food | Level-ups |
|---|---|---|---|---|---|
| 70/70/70, 70 hp | rune scimitar | 123, 207, 253 | 16 | 0-5 | 1 per fight |
| 70/70/70, 70 hp | rune warhammer (crush) | 172, 277 (third run broke) | 19 | 1-2 | 0-1 |
| 85/85/85, 85 hp | rune scimitar | 159, 198, 226 | 23 | 0-2 | 0 |
| 99/99/99, 99 hp | rune scimitar | 83, 124, 175 | 57 | 0 | 0 |

70 melee is safe with food but slow; its magic defence of -10 suggests a strong combat
spell would be much faster (inferred, not measured). The camp guard
(`regicide_tyras_camp_guard`) is never fought on this route: it only spawns at the camp
cross-over below stage 9 (`:393-399`).

## Tick total

| Part | Ticks | Basis |
|---|---|---|
| Travel in Kandarin (rows 2, 24, the walk in 25, 26, 36, 38; teleports included) | 221 | inferred route tiles, measured teleports |
| Tirannwn legs with their obstacle crossings and the pickups, loom, tar and tracks on the way (rows 5, 7, 9-10, 12, 14-15, 17-19, 21-22, 30-31, 34) | 1,131 | measured legs (`traverse`), the rest inferred from measured parts |
| Dialogue (rows 1, 3, 6, 8, 11, 13, 16, 23, 32, 35, 37, 39: 74 pages, 0 options; the tracker's last 4 pages are in row 17) | 181 | measured click-to-close totals (2 ticks per page + approach) |
| Item steps outside Tirannwn (quicklime and grind in 25, bomb in 28) | 14 | measured |
| Fight (row 20, 70/70/70) | 207 | measured median |
| Forced waits: still (row 27), catapult cutscene (row 33) | 68 | measured |
| Trade | 9 | measured |
| **Regicide subtotal** | **1,831** (at 99 melee about 1,750) | sum of the step rows |
| Underground Pass traversals #1 and #2 (rows 4, 29) | about 1,316 | 2 x 555 measured inside UP, approaches inferred |
| **Total** | **about 3,150** | |
| Messenger wait (row 0) | 0 if overlapped with other content, else 400-1200 | read |

Raw counts for recompute: 78 dialogue pages and no option clicks; 2 teleports in
Kandarin plus 1 in Tirannwn (Falador) and 1 more Ardougne for UP #2; about 1,195 Isafdar
route tiles (entry 1 about 845, entry 2 348) and about 400 Kandarin tiles; 8 pitfalls, 2
woodsprings, 4 tripwires, 6 log balances, 26 cross-overs; 2 climbs; 1 trade. With the
client fix (1 tick per page) the dialogue drops by about 78 ticks.

### Dialogue in three columns

Columns as `CONVENTIONS.md` defines them (stock 2 per page, fixed client 1, burst up to 5
pure continues per tick, with 1 + ceil((k-1)/5) for a run after an option or a state
change). Runs read from the scripts; the page counts match the measured ones. Regicide has
no option clicks at all.

| Row | Dialogue | Runs | Stock | Fixed | Burst |
|---|---|---|---|---|---|
| 1 | Messenger (`regicide_kings_messenger.rs2:28-30`) | 2c | 4 | 2 | 1 |
| 3 | Lathas, stage 1 (`king_lathas.rs2:30-37`) | 6c | 12 | 6 | 2 |
| 6 | Idris, then the elves (`idris.rs2:23-24`, `:59-64`) | 2c, state (queued ambush, stand still), 4c | 12 | 6 | 3 |
| 8 | Iorwerth, stage 3 (`lord_iorwerth.rs2:110-116`) | 4c | 8 | 4 | 1 |
| 11 | Tracker, stage 4 (`regicide_camp_tracker.rs2:34-48`) | 6c | 12 | 6 | 2 |
| 13 | Iorwerth, pendant (`lord_iorwerth.rs2:93-107`) | 4c | 8 | 4 | 1 |
| 16 | Tracker with the pendant (`regicide_camp_tracker.rs2:34-61`) | 13c | 26 | 13 | 3 |
| 17 | Tracker, stage 7 (`regicide_camp_tracker.rs2:25-30`) | 4c | 8 | 4 | 1 |
| 23 | Iorwerth, the book (`lord_iorwerth.rs2:66-72`) | 4c | 8 | 4 | 1 |
| 32 | Lazy guard, rabbit (`regicide_tyras_lazy_guard.rs2:30-37`) | 3c | 6 | 3 | 1 |
| 35 | Iorwerth, the message (`lord_iorwerth.rs2:40-49`) | 6c | 12 | 6 | 2 |
| 37 | Arianwyn (`quest_regicide.rs2:792-824`) | 15 single-page queued scripts plus the scroll; each page is its own `queue(arianwyn_dialogue)` run, so a blind continue has no paused script to resume and **cannot burst** | 30 | 15 | 15 |
| 39 | Lathas, reward (`king_lathas.rs2:8-20`) | 5c | 10 | 5 | 1 |
| | **Total, 78 pages** | | **156** | **78** | **34** |

| Column | Regicide itself | + two Underground Pass traversals | Total |
|---|---|---|---|
| Stock | 1,831 | ~1,316 | **~3,150** |
| Fixed client | ~1,753 | ~1,310 | **~3,060** |
| Burst | ~1,709 | ~1,306 | **~3,015** |

(inferred: measured stock totals minus the column differences; the traversals each carry
Koftik's 3-page cloth dialogue, `underground_pass.md`.)

## Risks and gotchas

- **Logout-unsafe stretches** (everything else persists: `%regicide_quest` and
  `%regicide_bits` are `scope=perm`, `quest_regicide.varp`):
  1. **The still (row 27), from the tar-on-still click to the naphtha**, about 33 ticks:
     `%regicide_still_total` and `%regicide_still_settings` are temporary
     (`primitives.md` §8). A logout mid-still loses the progress and the tar (the barrel is
     already empty), which forces a third Underground Pass traversal for more tar. Carry
     the spare barrel of tar.
  2. **The messenger wait (row 0), from the login after the Underground Pass hand-in to
     the messenger's arrival**, 400-1,200 ticks: the `spawn_kings_messenger` timer is set
     only by `login.rs2:74`, and timers are not saved (`primitives.md` §8), so a logout
     in that window restarts the draw. Plan it as one session of other content.
  3. **A potion-boosted Agility 56** (base 53-55 only) during the cross-over legs
     (rows 19-22, 31, 34): boosts reset at login (`stat_boost_login`, `login.rs2:72`), so
     a relog there needs a fresh dose (one potion click, no quest progress lost).
  4. **Idris (row 6)**: his ambush is a queued script; a logout before the elves'
     pages finish leaves the stage at 2 and he only re-spawns on the next mapzone entry.
     Short (about 18 ticks), but not a clean logout point.
- **Idris: stand still.** After his two pages the ambush is a queued script that bails
  out if the player is more than one tile from Idris (`idris.rs2:32-35`). In both
  `traverse e1-first` runs, where the bot kept walking, the stage stayed at 2. Stage 2
  Iorwerth has no dialogue, so a missed ambush costs a new Idris spawn (his timer
  re-arms on the next mapzone entry, `music/scripts/move.rs2:24-41`).
- **The rabbit bit is cleared** by crossing a cross_over3 inside mapzone 0_34_49
  (`quest_regicide.rs2:473-476`); give the rabbit after the last cross-over on the way
  to the catapult, as row 32 does.
- **Woodsprings fail more often than not** (39-46%); each failure is 8 damage and about
  4 ticks. Do not walk onto their trigger tiles or onto pitfall leaves; a scripted bot
  must route around them (the client's own routefinder does not know them).
- **Guard kill must be the scored account's**: its death hook uses `npc_findhero` and
  queues stage 9 on that player only, and only at exactly stage 8
  (`tyras_guard.rs2:28-36`). A helper cannot kill it.
- Level-up dialogues interrupt the guard fight at 70 stats (1 per fight measured); a
  fight loop must dismiss them and re-attack.
- Iorwerth needs a free inventory slot for the book (`lord_iorwerth.rs2:53-56`), and the
  still's close handler adds the naphtha before deleting the empty barrel
  (`regicide_fractionalizing_still.rs2:14-15`): keep one slot free at the still.
- The messenger timer is armed only at login; finishing UP mid-session and carrying on
  never starts Regicide until the next login.
- Agility boosts reset at login and drain 1 per 100 ticks, so a potion-boosted 56
  must be topped up during the cross-over legs.

## The Regicide chain: total and verdict

The chain is Plague City → Biohazard → Underground Pass → Regicide, each the gate of the
next (`plague_city.md`, `biohazard.md`, `underground_pass.md`). Totals at 70/70/70 melee
and the levels each document assumes (Agility 99/Thieving 50/Ranged 60 inside the pass,
Agility 56 in Tirannwn); every figure is the sum of the documents' labelled totals.

| Quest | Stock | Fixed client | Burst | Main reward (base xp, read) | Quest points |
|---|---|---|---|---|---|
| Plague City (from a Camelot teleport) | 737 | 620 | ~564 | 2,425 Mining; Ardougne teleport | 1 |
| Biohazard | 1,564 | 1,402 | ~1,323 | 1,250 Thieving | 3 |
| Underground Pass | 2,610 | 2,553 | 2,521 | 3,000 Agility, 3,000 Attack | 5 |
| Regicide itself | 1,831 | 1,753 | 1,709 | 13,750 Agility, 15,000 coins | 3 |
| Two forced Underground Pass traversals | 1,316 | 1,310 | 1,306 | | |
| **Chain** | **~8,060** | **~7,640** | **~7,420** | | **12** |
| of which Plague City + Biohazard + Underground Pass (shared with Legends' Quest) | 4,911 | 4,575 | ~4,408 | | 9 |
| of which Regicide's own share (itself + both traversals) | 3,147 | 3,063 | 3,015 | | 3 |

At Agility below 70 inside the pass add the expected failures in `underground_pass.md`
(about +60 at 60, +240 at 40; the two traversals add about +30 each at 60). Not included:
the 400-1,200-tick messenger wait (free if overlapped with other content) and the walk
from the previous quest to Camelot.

**What the rewards replace** (inferred; rates from the skill-route documents on the rs/2
branch, `docs/speedrun/skills/`):

| Reward | Replaces | Basis |
|---|---|---|
| Regicide 13,750 Agility | **~2,000 ticks** of Wilderness laps | `agility.md` §3: the laps run at about 7.0 base per tick at the levels Regicide displaces; 1,994 ticks on top of every other Agility quest, more from a lower start |
| Underground Pass 3,000 Agility | ~430 ticks | `agility.md` §3 |
| Underground Pass 3,000 Attack | ~400-750 ticks (not a self-only skill; at 4-8 base per tick of melee) | inferred, combat xp is 4 base per damage point; no measured melee rate yet |
| Plague City 2,425 Mining | ~270 ticks | `mining.md`: Doric only 4,034 → Doric + Plague City 3,765 ticks to 99 |
| Biohazard 1,250 Thieving | ~110 ticks | `thieving.md`: 11-12 base per tick after Fight Arena |
| **Skill total** | **~3,200-3,550 ticks** | |

**Verdict.**

1. **The chain does not pay for its xp.** It costs about 7,400-8,100 ticks and its
   skill rewards replace about 3,200-3,550. The 12 quest points and the Ardougne teleport
   would have to be worth about 4,000 ticks more for the chain to break even.
2. **Regicide does not pay even when Underground Pass is done anyway** (for Legends'
   Quest). Its own share is about 3,015-3,150 ticks, against about 2,000 ticks of
   Agility it replaces, a loss of about 1,000-1,150 ticks. Most of its cost is the two
   forced trips back through the pass (about 1,310 ticks), which the scripts make
   unavoidable: the Arandar gate stays shut from outside until stage 13, the only still
   is in Rimmington, and the catapult fires only at stage 11 (`regicide_arandar_gate_guard.rs2:5`,
   `regicide_fractionalizing_still.rs2`, `quest_regicide.rs2:505`). Regicide earns its
   place only if its 3 quest points are needed for a threshold that would otherwise cost
   more than about 1,000 ticks, or if a later quest requires it.
3. **Underground Pass (with Plague City and Biohazard) is worth doing only as Legends'
   Quest's prerequisite.** Its own Agility, Attack, Mining and Thieving rewards replace
   about 1,200-1,550 ticks against about 4,400-4,900 ticks of play. The decision
   therefore belongs to Legends' Quest: if Legends is on the route, these three are part
   of its cost (about 4,400-4,900 ticks); if not, drop all four.
4. If Regicide is dropped, the route's quest Agility falls by 13,750 base, which adds
   about 2,000 ticks of Wilderness laps (`agility.md` §3). That is already counted in
   the comparison above.

For the Agility route (cairn://p/rs/2): Regicide's checks are all boosted `stat()`
(Agility 45 for log balances, 56 for every cross-over, Crafting 10 at the loom), the only
Agility boost in this content is the agility potion (+3), and Underground Pass should
come after Grand Tree, not before (`underground_pass.md`, very low Agility).

## Coordinator findings checked

1. **`levelrequire/` wield checks use `stat_base`** - confirmed
   (`levelrequire.rs2:174-191`); Regicide adds the dragon halberd's quest gate
   (`levelrequire_regicide_quest`, `:164-170`, `tier60.rs2:10`). The Regicide quest
   checks themselves are all `stat()` (boosted).
2. **Level-up dialogues interrupt fights** - confirmed here: 1 per guard fight at
   70/70/70, none at 85+.
3. **`ai_queue3` death hooks with `npc_findhero`** - confirmed: both the old-camp and the
   camp guard set stage 9 through `queue(defeat_tyras_guard)` on the hero, at stage 8
   only (`tyras_guard.rs2:28-36`, `:61-62`).
4. **Kill-with-item checks** - none in Regicide: the guard needs no special weapon or
   item.

## Open questions

- The two Underground Pass traversals (rows 4 and 29) use the Underground Pass agent's
  measured 555 ticks inside the pass (Agility 99, Thieving 50, Ranged 60, no failed
  rolls); the approaches from Lathas's castle and from the Ardougne teleport are
  inferred. Lower Agility, Ranged or Thieving adds failure costs given in that
  document.
- Rows 2, 19, 21, 26, 36, 38 and the gathering detours are route-tile estimates, not
  measured walks.
- The guard fight with magic (magic defence -10) is not measured.
- The pitfall (2209,3203) is the only cheap Iorwerth <-> tracker crossing; whether a
  bot can chain the log and the pitfall faster than the measured 82-83 ticks was not
  tried.

## Scripts

- `quest-regicide-find.ts loc|npc|obj <name|/regex/>`: map placements (offline).
- `quest-regicide-routes.ts` and `quest-regicide-graph.ts`: route tiles; the graph
  flood-fills the Isafdar regions, adds each crossing and solves legs with and without
  cross-overs (offline).
- `quest-regicide-probe.ts <bot> <stage> <x,z> [targets] [--locs]`: live reachability and
  nearby-loc dump.
- `quest-regicide-obstacles.ts <bot> log|log3|pitfall|woodspring|tripwire|crossover|teleport|gate [agility] [reps]`.
- `quest-regicide-traverse.ts <bot> e1-first|iorwerth-tracker|tracker-iorwerth|camp-iorwerth|e2-guard|e2-back [agility] [runs]`: whole legs, end to end.
- `quest-regicide-segments.ts <bot> [segment...]`: every dialogue and gathering step.
- `quest-regicide-still.ts <bot> [runs] [delta] | sim`: the still schedule, live or
  offline.
- `quest-regicide-guard.ts <bot> [att str def hp] [weapon] [runs]`: the guard fight.
- `quest-regicide-messenger.ts <bot> out|in`: the messenger after a relog.
- `quest-regicide-lab.ts`: shared helpers.
