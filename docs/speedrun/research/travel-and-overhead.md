# Travel, teleports, logout tricks, starting position and supply staging

Coordinator: cairn://p/rs/59 (issue cairn://p/rs/79). This page checks what the RuneScape
speedrunning and efficiency communities know about moving around and staging supplies against
the revision this server runs (2004scape, about May 2004), and values each technique in ticks
logged in on the scored account. Sibling pages: [external.md](external.md) (the baseline
table), `competitors.md` (rs/60) and `engine-sweep.md` (rs/61, shop and spawn mechanics from the
scripts).

**Labels.** **m** measured (a lab script or a live read of a public page), **r** read (a script
or engine line, cited), **i** inferred (basis given). Ticks are 300 ms server ticks spent logged
in on the scored account. File references are to this branch unless a branch is named.

## Summary

Most of what the communities know about travel is already in use or does not exist in this
revision. Run energy is infinite here, so energy potions, weight and Agility regeneration do
nothing. Every teleport, ship and glider the route needs is already measured in
`quests/primitives.md` (rs/3). Ancient Magicks, teleport tablets, fairy rings, canoes, magic
carpets, charter ships and the Edgeville Wilderness lever are absent. Three findings are worth
real ticks:

1. **Start the scored run on a fresh account.** The scored account `www_cairn_md` already
   carries about **547 ticks** of playtime at total level 28 (m, public hiscore row), and every
   level stamp it earns will include them. The spare `cairn_dot_md` carries about **530** (m).
   A new account starts on Tutorial Island, but the demo offers the tutorial skip, because
   `NODE_PRODUCTION` is unset and `map_live` is therefore false. The skip took **6 ticks** with
   the stock SDK (m, `travel-walk-enchant.ts`, local engine at 300 ms) and lands in Lumbridge
   with a starter kit. **Saving: about 540 ticks (m/r).**
2. **Skill while running.** The engine keeps moving a player who is delayed by a script, and
   spell-on-item packets clear only the interaction, not the walk queue. Measured: a run with an
   enchant every 3 ticks covered exactly the same tiles in the same ticks as a run with no casts,
   and every cast landed on its 3-tick slot (m, 2 runs each). The walk must not be re-clicked in
   a cast's tick: that stopped the run dead (m). Burying cannot be done this way, because it
   calls `p_stopaction`. This is the community's "alch while running" mapped onto this engine.
   **Saving: about 100-300 ticks (i on a measured mechanism)**, set by how many walking ticks
   the route has with rings in the inventory.
3. **Login and logout hygiene.** Login opens no modal and its tick is not counted, but the
   logout tick is. Each logout cycle loses about 1-3 ticks with the stock client and 0-1 at the
   floor (i), depending on whether the last action and the logout share a tick and whether the
   first action after login is sent without waiting for state. **Saving: about 1-2 ticks per
   cycle, so about 60-400 over the route (i), depending on how many cycles the final schedule
   has; lab brief below.**

One correction to canon: the **ring of dueling does teleport** in this revision
(`general/scripts/enchanted_jewellry/ring_of_dueling.rs2:1-34`, Duel Arena or Castle Wars).
`quests/primitives.md` §4 on rs/3 says it does not. On the current route it saves almost
nothing (row 7).

The ~2,500-3,500-tick overhead line in the main tally is mostly bank visits, trades, level-up
dialogs and the walking inside quest and skill documents. None of the community travel
techniques shrinks that line by more than the rows below. The largest remaining lever on it is
the order of the skill blocks (geographic clustering), which is the coordinator's route
decision. The [travel matrix](#travel-matrix-from-teleport-landings-to-training-sites) gives the
per-leg costs that decision needs.

## Ranked table

| # | Technique | Source | Present in revision | Route line affected | Ticks saved (label) | Cost | Test status |
|---|---|---|---|---|---|---|---|
| 1 | Fresh scored account, tutorial skipped | OSRS speedrun timing convention: the run starts at account creation (OSRS Wiki speedrunning guide, "Category rules"; speedrun.com OSRS Tutorial Island category) | Present. New accounts spawn on Tutorial Island (3094,3106) (`Player.ts:470-471`, engine). The first guide offers "Do you want to skip the tutorial?" when `map_live` is false (`tutorial/scripts/guides/runescape_guide.rs2:11-18`). `map_live` is `Environment.node.production` (`ServerOps.ts:24-26`, engine), which `fly.toml` does not set. The skip runs `tutorial_complete`, which lands on (3222,3222) with a bronze axe, tinderbox, net, pickaxe and other starters (`tutorial.rs2:295-310`) | Every level stamp, so the final score | **~540** (m/r): 547 m sunk on `www_cairn_md` (Overall time 2m 44s / 0.3 s), less the skip's 6 m. Against the spare: 530 m less 6 | A new account name; the helper roster must trade to the new name. No in-game cost | **Measured**: skip 6 ticks from the first observed tick on Tutorial Island (3094,3106) to (3222,3222), 2 dialog clicks, starter kit in the inventory (`travel-walk-enchant.ts`, 1 run, 300 ms, bgsrv-mac). Brief A covers what is left |
| 2 | Skill while running: enchant, Charge and delay-free helper skills during travel legs | "Alching while running" (Sal's RuneScape Forum, 2009; OSRS Wiki speedrunning guide: "Always be in motion") | Present (r). `processInteraction` and its `updateMovement` run every tick with no `delayed` check (`World.ts:801`, `Player.ts:727-751,1330-1344`, engine). `OpHeldTHandler`/`OpHeldUHandler` call `clearPendingAction`, which clears the interaction and modal but "leave[s] walk queue intact" (`Player.ts:1026-1030`). Enchant has `p_delay(1)` and no `p_stopaction` (`skill_magic/scripts/spells/enchant.rs2:41-53`). Bury calls `p_stopaction` (`skill_prayer/scripts/bury_bone.rs2:8`), so it stops the walk. A move click is refused while delayed (`MoveClickHandler.ts:12-15`, engine), so re-clicks go on free ticks | Magic (enchant 57 to 71, ~156 casting ticks; pre-quest enchanting to ~51, ~140), Charge (~41), Fletching, Herblore, Crafting (~217 standalone together, `skills/interleaving.md` §8 on rs/28) | **~100-300** (i): each cast moved into a walk saves its 3 ticks. The ceiling is the enchanting that Thieving stuns do not already absorb (interleaving.md §8 plans ~190 casts in stuns). Level-up dialogs do not stop a walk that is already queued (`Player.ts:729`: only a new move click is refused while busy with a queue), so walks are also a loss-free place to level helper skills, which cost ~136 Woodcutting ticks per skill inside gathering (interleaving.md §5) | Rings and runes must ride in the inventory during the leg; top-up trades (5-9 each) per 24-26 rings. One cast slot is lost each time the walk needs a new click (every ~30 ticks of running), because a click is refused while delayed and a click in the cast's own tick stops the run | **Mechanism measured** (`travel-walk-enchant.ts`, 300 ms, bgsrv-mac, 2 runs per mode): with one run click, 22 moving ticks of 2 tiles both with and without casts (identical step histograms), 25 of 25 diamond enchants landing at 3-tick spacing, one level-up dialog mid-run without effect. With a walk click in each cast's tick: 0 tiles in 80 ticks (2 of 2). The route count is brief B |
| 3 | Login and logout hygiene: last action and logout in one tick; first action after login sent blind | OSRS Wiki speedrunning guide ("be walking on the next game tick"); `playtime-audit.md` (rs/28) for the counting | Present (r). Login opens no interface on a non-tutorial account (`login_logout/login.rs2:1-94`: messages, timers, tabs); the joining tick is not counted and the logout tick is (`playtime-audit.md` 1a, 1c). A logout waits while the player is delayed or holds a non-discardable queue (`World.ts` `processLogouts`) | Every logout cycle (helper waits, deliveries, exchange fills) | **~1-2 per cycle** (i): stock client 1 tick late after login (primitives.md "two clocks") plus 0-2 ticks between the last action and the logout. Over **~60-200 cycles** (i, rough count: quest trades, Runecraft delivery batches, Smithing and Firemaking refills) that is **~60-400** | None; a client change in the bot | Not run. Lab brief C |
| 4 | End the run where the exit is longest | Speedrun practice: the timer stops on the final split, so the last segment needs no return | Present (r): the score is the stamp of the last level-up, and time after it costs nothing (`playtime-audit.md`, "What this means for the run") | The step that leaves the Wilderness: the cannon finish at the poison spiders (walk to level 30 and glory, ~26 + 6 i) or the Wilderness Agility course (lever out, ~80 + 4 i) | **~30-85** (i): one exit leg, whichever is longest among the steps that could go last | Ordering constraint only | No test needed |
| 5 | Drop and pick up for single-item hand-offs | Common "drop trade" practice between alts | Present (r): a player-dropped obj is private to the dropper for `objRevealTicks` = 100 (`WorldConfig.ts:38,115`, engine; `fly.toml` does not override), then public; untradeable objs never reveal (`World.ts:1713-1724`) | Hand-offs of 1-3 items (the Fishing Contest carp, a single potion or tool) | **~4-7 per hand-off** (i): one pickup (~1-2) against a trade (9 stock, 5 floor, primitives.md §6). **~20-50** over the route (i, 5-10 such hand-offs) | The scored account is logged out during the 100-tick reveal; after it, anyone nearby can take the item | No test needed; a trade is the safe fallback |
| 6 | Collect Grand Exchange purchases at Varrock west instead of taking a trade | Grand Exchange practice | Present (r): the exchange table and teller are on the west side of Varrock west bank only (`market/GrandExchange.ts:72-89`, engine) | Supplies bought on the market while the scored account trains at the Varrock west booth (Magic, Prayer, Smithing were measured there) | **~10-30** (i): a few interface clicks (~2-3 i) in place of a 5-9 trade, a handful of times | Market liquidity on the demo is unknown; a helper still has to place the order | No test needed |
| 7 | Ring of dueling to the Duel Arena or Castle Wars | OSRS Wiki, "Ring of dueling" (released 20 April 2004) | **Present** (r): `ring_of_dueling.rs2:1-34`; `p_delay(1)`, a 3-way choice, then `~player_teleport_normal` to (3315,3235) or (2440,3090); blocked above Wilderness 20. About 8 ticks (i, same shape as the games necklace, measured 8). Castle Wars has a bank chest (`minigames/game_castlewars/scripts/castlewars_bank.rs2:1`) | Fire altar (3312,3254) is about 19 ticks from anywhere (i); Castle Wars chest is a bank in ~11 (i) | **~0** on the current route (i): Runecraft uses air, nature and law, and a glory to Edgeville or Draynor reaches a bank in about the same time | Rings from helpers | No test needed. Corrects primitives.md §4 |
| 8 | Ardougne Wilderness lever for the cannon trips | Wilderness lever, OSRS Wiki | Present (r): one lever pair only, Ardougne (2561,3311) to the Deserted Keep (3154,3924) (`areas/area_ardougne_east/scripts/wilderness_lever.rs2:3-45`; placements in `maps/m40_51.jm2` and `m49_61.jm2`, loc ids 1814 and 1815) | Cannon session and cannon finish at (3288,3810) | **~0-30** (i): lever route ~4 + 61 + 13 + ~68 = ~146 against glory to Edgeville + ~160 = ~166, less any web on the way out of the keep, over 2 trips | Deep Wilderness (level 51) landing | No test needed |

## Lab briefs

**A. Fresh account and the tutorial skip (worth ~540; the skip itself is measured).** The local
run measured 6 ticks for the SDK's `skipTutorial` on a fresh account, from the first observed
tick to arrival in Lumbridge. What is left is a decision and one check, not a campaign. The
coordinator decides whether the scored run moves to a fresh name, after confirming that nothing
else is tied to `www_cairn_md` (helper scripts, trade allowlists, the main thread's naming). The
check: read the new account's Overall time on the public hiscores after its first logout, to
confirm the counter is in the single digits there too. The saving holds only while the demo
keeps `NODE_PRODUCTION` unset; with it set, the skip disappears and the full tutorial would cost
far more than 547 ticks.

**B. Skill while running (worth ~100-300; the mechanism is measured).** The local test settled
the mechanism for enchanting. Three things remain. First, count the route's walking ticks on
legs where 20 or more inventory slots are free: the quest walks in `quests/README.md` §4 from
The Grand Tree on, the walk from the start tile to the first quest, and the skill-site legs.
That count bounds the saving, because each cast moved into a walk saves 3 ticks. Second, repeat
the test for Charge (IF_BUTTON) and for herb mixing at 4 per tick, which should behave the same
by reading. Third, settle why every walk in the second run stopped at (3153,3226), 13 tiles short
of the click. It happened identically with and without casts, so it does not affect the
comparison, but a route bot needs to know its single-click reach on that road.

**C. Logout and login (worth ~1-2 per cycle).** On the local engine, log the practice account
in and record the first tick at which a blind walk packet (sent the moment the login response
arrives) takes effect, compared with the stock client reacting to its first published state.
Then send `[final action, logout]` in one tick, both after a delay-free action and after a
`p_delay` action, and record how many counted ticks pass before removal. The counter is
`Player.playtime`; read it before and after with a staff command.

## Checked and not applicable

- **Run energy, energy potions, weight and Agility regeneration.** Run is infinite on the demo:
  `NODE_INFINITE_RUN` defaults to true (`server/engine/src/util/Environment.ts:47`) and
  `fly.toml` does not set it, so `updateEnergy` pins energy at 10000 (`Player.ts:754-757`,
  engine). For reference, the inactive formula restores `floor(Agility / 6) + 8` hundredths of
  a percent per tick standing or walking and drains `67 + 67 * min(kg, 64) / 64` per running
  tick (`Player.ts:762-769`). The community advice to stockpile energy and run light (OSRS Wiki
  speedrunning guide) does not apply.
- **Ancient Magicks.** Absent: no Desert Treasure directory under `server/content/scripts/quests`
  (`quest_desertrescue` is Tourist Trap), and no ancient spells in
  `skill_magic/configs/magic_spells.dbrow`.
- **Trollheim and Watchtower teleports.** Present, but each needs a quest that is off the route:
  Eadgar's Ruse and Watchtower (`skill_magic/scripts/spells/teleport.rs2:26-38`).
- **Teleport tablets, ectophial, fairy rings, canoes, magic carpets, charter ships, home
  teleport.** Absent: no match for `ectophial`, `teletab`, `teleport_tablet`, `fairy_ring`,
  `canoe`, `magic_carpet` or `charter` in any `.rs2`, `.obj` or `.loc` under
  `server/content/scripts`, and the standard spellbook buttons are the seven in
  `teleport.rs2:1-7`.
- **Edgeville Wilderness lever.** Absent: the only Wilderness lever locs (1814, 1815) are placed
  at Ardougne and the Deserted Keep (scan of every `maps/*.jm2` LOC section).
- **Death as a teleport (deathwarp).** Present but slower than any teleport. Death runs
  `p_delay(1)`, the death animation and `p_delay(3)`, then respawns at Lumbridge (3221,3218),
  keeping only the 3 priciest items (`player/scripts/death.rs2:1-75`). The Lumbridge teleport is
  4 ticks (primitives.md §4). Death would help only above Wilderness level 30, where no teleport
  works, and nothing on the route is stuck there: the exits are 26-80-tick walks, and dying
  needs time to take damage. The ring of life is the same: it fires only below 10% hitpoints
  (`ring_of_life.rs2:1-16`).
- **Games necklace.** Present (8 ticks, primitives.md) but it lands in the Burthorpe games room;
  no route site is closer from there than from the Falador teleport.
- **World hopping.** No use: the demo is one world, and a takeover less than 10 s after the last
  login is refused (`playtime-audit.md` 1e).
- **Shops and item spawns for the scored account.** Under the posture, helpers supply every
  tradeable item and their time is free, so a shop or spawn changes no scored tick. The tutorial
  skip's starter kit (row 1) covers the only items the account could want before its first
  trade. Script-level shop and spawn mechanics are rs/61's.
- **Agility shortcuts on travel legs.** None on the legs the documents walk saves more than a
  few ticks; `skills/agility.md` (rs/2) lists them as one-way or with long walks back.
- **Bank layout and deposit methods.** Measured already: a 4-tick bank visit with a blind
  withdraw (`skills/magic.md`, `skills/prayer.md` on rs/28), and banking beats a trade for
  per-inventory refills. rs/40's library holds the primitives.

## Travel matrix from teleport landings to training sites

Landing tiles are read from the configs (`magic_spells.dbrow`, `amulet_of_glory.rs2:30-33`,
`ring_of_dueling.rs2:21-23`, `spirit_tree.constant`). Ticks are the cast (spells 4 m, glory 6 m,
ring of dueling about 8 i) plus the run at 2 tiles per tick over the straight-line
(Chebyshev) distance, plus 1. Real routes ran 28% longer on the one long walk measured
(primitives.md §2), so treat these as lower bounds (i).

| Site (tile) | Used by | Best landing | Distance (tiles) | Ticks (i) |
|---|---|---|---|---|
| Ardougne market knights (~2655,3305) | Thieving | Ardougne teleport (2661,3301) | ~6 | ~8 |
| Ardougne south bank (~2655,3286) | any-bank skills | Ardougne teleport | ~15 | ~13 |
| Seers' Village bank and its 53-54-tile fire lines (2733,3484) | Firemaking, any-bank skills | Camelot teleport (2757,3478) | 24 | ~17 |
| Varrock west booth (3185,3436) and the exchange (3180,3443) | Magic, Prayer, Smithing, Grand Exchange | Varrock teleport (3213,3424) | 28-33 | ~19-22 |
| Lumbridge river fly spots (3241,3248) | Fishing | Lumbridge teleport (3221,3218) | 30 | ~20 |
| Fire altar ruins (3312,3254) | Runecraft (not on the route) | Ring of dueling, Duel Arena (3315,3235) | 19 | ~19 |
| Taverley willows (2920,3406) | Woodcutting | Falador teleport (2965,3378) | 45 | ~28 |
| Falador east bank lines (3013,3356) | Firemaking | Falador teleport | 48 | ~29 |
| Ardougne zoo iron (2602-2605,3233-3237) | Mining | Ardougne teleport | 66 | ~38 |
| Oak tile (2914,3494) | Woodcutting 15-73 | Falador teleport | 116 | ~63 |
| Wilderness Agility course (~2998,3930) | Agility | Ardougne teleport, lever | ~100 + lever + 156 | ~158 (Mage Arena's measured lever legs plus 80) |
| Poison spiders (3288,3810) | Cannon | Glory to Edgeville (3087,3496) | 314 | ~164 |

Two uses: an any-bank skill (Magic, Prayer, the helper-fed skills) should be done at the bank
nearest the previous or next site rather than at a fixed booth, and sites in the same town
(Ardougne: Mining, Thieving, Plague City, Fight Arena, the lever) should be consecutive. Each
avoided teleport-and-walk between towns is worth ~20-60 ticks (i, from the table).

## Measurements on this page

`docs/speedrun/scripts/travel-walk-enchant.ts`, run through `docs/speedrun/scripts/lab.sh`
(block `travel`: web 8980, agent 7880) at `NODE_TICKRATE=300` on bgsrv-mac (idle), practice
account `cairn` on the local engine, 2026-10-21.

| Measurement | Result | Runs |
|---|---|---|
| SDK `skipTutorial` on a fresh account, first observed tick to (3222,3222) | 6 ticks, 2 dialog clicks; starter kit: bronze axe, tinderbox, small fishing net, shrimps, bucket, pot, bread, bronze pickaxe, dagger, sword, wooden shield, shortbow, bronze arrows, five rune types | 1 |
| Run west from (3200,3226), one click, no casts | 45 tiles, 22 moving ticks of 2 tiles (step histogram 2:22, 1:1) | 2 |
| Same run, Lvl-4 Enchant on a diamond ring every 3 observed ticks | identical: 45 tiles, 22 moving ticks of 2; 25 of 25 casts landed at ticks 2, 5, 8 ... 74; one Magic level-up mid-run | 2 |
| Same, with a walk click to the destination in each cast's tick | 0 tiles in 80 ticks; 25 of 25 casts landed | 2 |

A first run of the script was discarded. The staff was never wielded, so every cast failed for
lack of runes, and the level-3 account was attacked by goblins on the road, whose retaliation
stopped some walks. The committed script uses earth runes and combat stats of 99.

## Sources

- OSRS Wiki, "Guide:Speedrunning guide": https://oldschool.runescape.wiki/w/Guide:Speedrunning_guide
  (deathwarps, run start at account creation, run-energy and "always be in motion" advice).
- OSRS Wiki, "Guide:Speedrunning guide/Tutorial Island":
  https://oldschool.runescape.wiki/w/Guide:Speedrunning_guide/Tutorial_Island
- speedrun.com, Old School RuneScape leaderboards and the Tutorial Island category:
  https://www.speedrun.com/osrs; start-time discussion: https://www.speedrun.com/osrs/forums/il0my
- OSRS Wiki, "Ring of dueling" (released 20 April 2004): https://oldschool.runescape.wiki/w/Ring_of_dueling
- OSRS Wiki, "Update:Castle Wars": https://oldschool.runescape.wiki/w/Update:Castle_Wars
- OSRS Wiki, "Tutorial Island": https://oldschool.runescape.wiki/w/Tutorial_Island
- OSRS Wiki, "Energy": https://oldschool.runescape.wiki/w/Run
- Sal's RuneScape Forum, "Alching While Running" (2009):
  https://runescape.salmoneus.net/forums/topic/257169-alching-while-running/
- rs-sdk demo hiscores, read 2026-10-21 01:25 PDT (no login):
  https://rs-sdk-demo.fly.dev/hiscores/player/www_cairn_md (Overall 28, 2m 44s),
  https://rs-sdk-demo.fly.dev/hiscores/player/cairn_dot_md (Overall 28, 2m 39s),
  https://rs-sdk-demo.fly.dev/hiscores?category=0&profile=main (rank 1 at 1,881, 2h 59m 34s).
- Route documents: `quests/README.md`, `quests/primitives.md`, `quests/mage_arena.md` (rs/3);
  `skills/*.md` (rs/2, rs/28); `playtime-audit.md` (rs/28).
