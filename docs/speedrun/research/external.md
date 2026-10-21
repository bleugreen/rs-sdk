# External research: what the speedrunning and efficiency communities know that our route does not use

Coordinator: cairn://p/rs/59. This page ranks techniques, orderings and tricks from the RuneScape
speedrunning and efficiency communities (OSRS quest and skill speedrunning, the OSRS wiki's
efficiency pages, RS2-era guides, the 2004scape / LostCity project's own record) by the ticks
each would save on **our** route. Each one was checked against the game revision this server runs.
The evidence lives on the six per-topic pages. This page is the ranking and the recommendation.

Labels: **m** measured on the local engine at 300 ms, **r** read from a script or engine line,
**i** inferred (the arithmetic is on the topic page). Ticks are 300 ms server ticks spent logged in
on the scored account. Xp is base xp (game xp / 25).

**Route state assumed:** rs/3's Package B (Waterfall off, Dragon Slayer on after Monkey Madness),
chosen at 01:08 on 2026-10-21. After that choice the combat finish is cannon plus defensive melee
for ~231 ticks, then cannon plus rapid rune knives for ~1,792.

## The revision is January 2005, not May 2004

The server is LostCity revision 289: `server/content/README.md:2` reads "Lost City - January 17,
2005". Its engine equals Engine-TS `289` at `ca82af8`, and its content equals Content `289` at
`460d0fde`. The demo runs that code apart from rs-sdk's own patches ([lostcity.md](lostcity.md)
§1). So era sources apply up to January 2005: anything Jagex fixed before then is fixed here, and
content from later (Slayer, the Mage Training Arena, player-owned houses, the Ape Atoll Agility
course, teaks, Pyramid Plunder) is absent. Every "absent" verdict below was checked in the scripts,
not assumed from a release date.

## Per-topic pages

| Page | Topic | Issue |
|---|---|---|
| [self-only-methods.md](self-only-methods.md) | Tick methods and training methods for Agility, Woodcutting, Mining, Fishing, Thieving | rs/74 |
| [quest-speedrun.md](quest-speedrun.md) | Quest speedrunning: skips, sequence breaks, boss handling, off-route quests revisited | rs/75 |
| [free-xp.md](free-xp.md) | Lamps, random events, minigame and NPC xp rewards, Tutorial Island | rs/76 |
| [helper-fed-and-combat.md](helper-fed-and-combat.md) | Efficiency methods for combat and the helper-fed skills | rs/77 |
| [lostcity.md](lostcity.md) | The upstream project's bugs and exploit fixes; which are live here; risks to what we rely on | rs/78 |
| [travel-and-overhead.md](travel-and-overhead.md) | Teleports, transport, logout tricks, starting position, supply staging | rs/79 |

Lab follow-ups for candidates worth about 300 ticks or more: **rs/90** (2-tick Woodcutting by
the auto-retaliate flinch) and **rs/91** (the boosted Package B combat finish).

## Summary

The communities' biggest levers are mostly absent from this revision, or the route already
uses them. Agility (our largest self-only line) has no faster method here: the Ape Atoll course
came later and has no scripts, Brimhaven arena tickets are untradeable, and obstacle clicks sent
during an obstacle are dropped. There is no free xp at all: lamps and arena tickets are
untradeable, and the demo turns random events off (`fly.toml:25`). The community's per-action
floors for Runecraft, Smithing, Firemaking, Prayer and Magic match the route tick for tick.
No upstream-documented bug is live and worth ticks.

What is left is concrete. **About 1,200 ticks are measured** (a fresh account, the Monkey
Madness temple ladder). **~700-1,500 are conditional** on one mechanism, the 2-tick flinch,
whose first lab attempt was negative. A long tail of 50-300-tick items, the boosted combat
finish among them, adds roughly **800-1,500** more. The single largest finding was not a
technique: the scored account has already spent **~547 ticks** of its counter, and a fresh account
skips the tutorial in 6.

## Ranked table

Sorted by ticks saved, the top of each range. "Conditional" rows depend on an untested mechanism.
Rows from the same mechanism are grouped under the higher one.

| # | Technique | Source | Present in revision | Route line | Ticks saved | Cost | Test status |
|---|---|---|---|---|---|---|---|
| 1 | **2-tick Woodcutting by the auto-retaliate flinch**: drop on the tick after a roll; a hit that tick sets `%action_delay = map_clock + 1`; the next tree click rolls at once | OSRS wiki, *Tick manipulation* and *Flinching* ([self-only-methods.md](self-only-methods.md) row 1) | Read yes: `auto_retaliate.rs2:9-22`, `PlayerOps.ts:956-958`, `woodcut.rs2:97-99` | Woodcutting, ~3,028 with the knife | **~700-1,000 (i), conditional** | A hit every 2 ticks: a helper with darts on rapid in the level-1 Wilderness, or two NPCs in a multi-combat zone | **First lab attempt negative** (0 rolls from 125 clicks). Engine trace and re-test: **rs/90** |
| 2 | **Monkey Madness temple: ladder drop onto the trapdoor tile** (up the south bamboo ladder, down the east one, inside the guard box) | OSRS wiki, MM quick guide ([quest-speedrun.md](quest-speedrun.md) row 1) | Yes: `quest_mm.rs2:766-771`, ladders and trapdoor in `maps/m43_43.jm2`; no quest-stage checks | MM step H (102 on success, ~600 expected failure budget) | **~670 expected, ~68 success path (i on m)** | none; 5-9 prayer points | **Measured**, 33-36 ticks, 4 of 4 (`quest-mm-temple-ladder.ts`) |
| 3 | **Start the scored run on a fresh account and skip the tutorial** | OSRS speedrun timing convention ([travel-and-overhead.md](travel-and-overhead.md) row 1; [free-xp.md](free-xp.md)) | Yes: the skip is offered when `map_live` is false (`runescape_guide.rs2:11-18`, `ServerOps.ts:24-26`); the demo leaves `NODE_PRODUCTION` unset | The final score: `www_cairn_md` already carries ~547 ticks (public hiscore, Overall 28 at 2m 44s) | **~540 (m)** | A new account name; the helper roster trades to it | **Measured**: skip in 6 ticks. Main-thread decision |
| 4 | 2-tick Mining on stays by the same flinch | as row 1 ([self-only-methods.md](self-only-methods.md) row 2) | as row 1; `mining.rs2:83-85` | Mining 63-99, ~3,173 | **0-530 (i), conditional** | as row 1; no iron rock is multi-combat | After rs/90, a planner run first (brief B there) |
| 5 | **Boosted Package B combat finish**: ranging potion and glory in the cannon plus knives phase; zero-drain Protect from Melee flicks instead of prayer potions; super antipoison instead of sharks. The cannon's accuracy is the wielded style's, boosts included | OSRS wiki, *Dwarf multicannon*; LostCity forum t/3058, t/14198 ([helper-fed-and-combat.md](helper-fed-and-combat.md) rows 2-4) | Yes: `cannon_fire.rs2:116`, `player_combat.rs2:52-79`; ranging potion `consume_effects.dbrow:57-63`; drain timer `prayer.rs2:30-44,159-175`; `anti_poison.rs2:11-16`. No ranged prayers exist (15 prayers) | Package B finish, ~2,020 | **~290-320 (i)**: potion and glory ~210-240, flicks ~40, antipoison ~40 | ~1 ranging dose per 1,000 ticks, 1 glory, ~6 antipoison doses; flick packets inside the 5-per-tick cap | Flick drain measured (90 points held vs 0 flicked in 150 ticks); rates untested: **rs/91**, which also tests rs/28's scimitar-wielded cannon alternative |
| 6 | Predicted obstacle clicks and chosen entry tiles on the Wilderness Agility course | OSRS wiki, *Wilderness Agility Course* (67-tick theoretical lap against our 73-77) | Yes: clicks during an obstacle are dropped (`OpLocHandler.ts:14-18`); the rope swing charges `p_delay(distance)` (`wilderness_course.rs2:80-88`) | Agility, ~4,695 | **~60-340 (i)** | bot work | Untested; brief C on the topic page |
| 7 | **Skill while running**: enchant, Charge and delay-free helper skills during walking legs (the community's "alch while running") | OSRS speedrunning guide; Sal's forum ([travel-and-overhead.md](travel-and-overhead.md) row 2) | Yes: a delayed player keeps moving (`World.ts:801`, `Player.ts:727-751`); spell-on-item leaves the walk queue (`Player.ts:1026-1030`); bury stops it (`bury_bone.rs2:8`) | Magic enchanting (~300 casting ticks), Charge, Fletching, Herblore, Crafting | **~100-300 (i on m)** | rings and runes carried on the leg; never re-click the walk in a cast's tick (that stops the run, m) | Mechanism measured (25 of 25 casts on slot, identical movement); route count is brief B there |
| 8 | Login and logout hygiene: last action and logout in one tick; first action after login sent blind | OSRS speedrunning guide; `playtime-audit.md` | Yes: the joining tick is uncounted, the logout tick counted | every logout cycle (~60-200 on the route) | **~60-400 (i)** | bot work | Untested; brief C on the travel page |
| 9 | Better cannon tile: lure targets into the overlapping direction squares | OSRS wiki, *Dwarf multicannon* | Yes: 8 directions of 3 squares, one search per tick (`cannon_fire.rs2:10-91`) | combat finish (cannon phases) | **up to ~240 (i)** | lab time | Open question already in `ranged.md` §8 |
| 10 | Walk away from a dialogue's trailing pages once its state is set | OSRS speedrun guides ([quest-speedrun.md](quest-speedrun.md) row 7) | Yes: a move click closes the modal (`MoveClickHandler.ts:26-32`) | every on-route dialogue with trailing continues | **~100-200 fixed client, ~20-50 burst (i)** | per-dialogue audit; rewards that run after the last page must not be cut | Reading task (brief on the topic page) |
| 11 | Multicannon on the Jungle Demon beside the magic shortbow | OSRS wiki, *Jungle Demon* ("the most effective way to kill the demon") | Yes: no set-up ban there (`cannon_setup.rs2:52-107`); damage ignores Strength | MM step L, 267 ticks | **~100-170 (i)** | ~30 balls; the cannon is already owned | Untested; brief on the topic page |
| 12 | Cannon from a safespot in single-combat | OSRS wiki, *Dwarf multicannon* | Yes: `player_combat.rs2:106-122` | Package B cannon plus knives phase; pre-MM cannon session | **0-150 (i)**; mainly moves Ranged out of level-37 Wilderness | a safespot within range | Untested; brief C on the combat page |
| 13 | Pin a Knight of Ardougne with helpers on its neighbouring tiles | andromack blog; Autumn Elegy 2004Scape guide | Yes: NPC steps respect player occupancy (`Npc.ts:406-413`) | Thieving, ~1,975 | **~85, up to ~250 (i)** | 2-4 helpers standing still | Untested; brief D on the topic page |
| 14 | End the run on the step with the longest exit | speedrun practice: the timer stops on the last split | Yes: the score is the last level-up's stamp | the Wilderness Agility course or the spider cannon | **~30-85 (i)** | ordering only | none needed |
| 15 | Log out inside MM's chapter cutscenes so that login completes them | MM's own open question | Yes: `quest_mm.rs2:1-37` (`mm_login`) | MM steps G, H, K | **~40-80 (i)** | none | Untested |
| 16 | Skip Kruk: be pushed one tile west under the Elder Guard by lighting a fire | OSRS wiki, MM quick guide | Probably: `firemaking.rs2:145-174`, `mm_elder_guard.rs2:53-54` | MM step I | **~40-70 (i)** | logs and a tinderbox | Untested |
| 17 | Zero-drain prayer toggling in the quest fights (Elvarg included now that Dragon Slayer is on) | OSRS wiki, *Prayer* (flicking) | Yes, as row 5 | every protect-prayer fight | **~15-35 (i)**; removes "prayer ran out" as a failure mode | 2-3 packets per 4 ticks | Drain measured |
| 18 | Multicannon on the Grand Tree black demon (Dwarf Cannon moved earlier) | OSRS wiki, *Black demon* | Yes | Grand Tree segment N | **~30-60 (i)** | reorder Dwarf Cannon before The Grand Tree | Untested |
| 19 | Drop and pick up for single-item hand-offs | "drop trade" practice | Yes: the drop stays private for 100 ticks (`WorldConfig.ts:38,115`) | 5-10 small hand-offs | **~20-50 (i)** | the scored account is logged out during the reveal | none needed |
| 20 | Collect Grand Exchange buys at Varrock west instead of taking a trade | GE practice | Yes: `market/GrandExchange.ts:72-89` | supplies while training at the Varrock west booth | **~10-30 (i)** | market liquidity unknown | none needed |
| 21 | Ape Atoll stall thieving during the Monkey Madness visit | OSRS wiki, *Ape Atoll* | Yes: `aa_market.rs2:11-14` | Thieving | **0-30 (i)** | Thieving 65 before MM | not worth a lab |
| - | **Correction (a cost): walk the monkey back from the zoo**; spirit trees delete it | OSRS wiki, MM quick guide | Yes: `spirit_tree.rs2:74-76` -> `teleport.rs2:109-112` | MM step J | **about -100 (i)** | none | Read; route tile count needed |

The melee-boost kit (super attack and strength, glory, Ultimate Strength and Incredible Reflexes on
flicks) was worth ~500-580 on the retired Package A. On Package B it applies only to the
~231-tick cannon plus defensive melee phase, worth a few tens of ticks. Knight multiskilling
(delay-free helper actions inside pickpocket stuns, up to ~250) is already planned in
`interleaving.md` and is not counted here.

### Risks to behaviours the route relies on

From [lostcity.md](lostcity.md) §3-4. These are ticks the route would **lose** if upstream changed
the behaviour. None is a saving, and all are low probability today.

| Behaviour | Ticks at risk | Upstream signal |
|---|---|---|
| Knife-on-logs `%action_delay` starter | ~3,100 (i) | Weak-queue clearing changed twice upstream; neither touches the drop and re-click path; the mechanic is authentic |
| Charge with no cooldown | ~1,130 (i) | A deliberate upstream choice (2004scape/Server #969); the comment dates the cooldown to 2005 |
| Five user events per tick | ~1,000+ (i) | Unchanged on every upstream branch |
| Wine fermenting in the bank | ~200-500 (i) | `wine.rs2:6` carries an upstream TODO: "Finish wines ... proper queue clearing" |

One possible gain to watch, which we cannot act on ourselves: rs-sdk PR #79 (open) would make the
level-up interface optional. If the maintainer enabled it on the demo, it would be worth ~200-500
ticks.

## Top five we should adopt

1. **Start the scored run on a fresh account (~540, measured).** `www_cairn_md` has ~547 ticks on
   its counter at total level 28. Every future stamp includes them. A fresh account skips the
   tutorial in 6 ticks with the SDK's `skipTutorial`. This needs a main-thread decision (the name,
   and whether anything else is tied to `www_cairn_md`), not a lab. *Check:* after the new
   account's first logout, read its Overall time on the public hiscores and confirm it is in
   single digits. The saving disappears if the demo ever sets `NODE_PRODUCTION`.
2. **Monkey Madness temple ladder drop (~670 expected, measured).** Adopt it into
   `monkey_madness.md` step H on rs/3's branch, together with the zoo-leg correction (walk the
   monkey back from the zoo, about +100). Net effect: MM expected ~4,645 to ~4,075. No lab is needed.
3. **2-tick Woodcutting by the flinch (~700-1,000 if it holds, lab running as rs/90).**
   *Brief:* first an engine trace (a run-only logging patch, discarded) of every
   `playerhit_n_retaliate` run (`busy2`, the clock before and after) and every woodcutting label.
   That shows which link broke the first attempt: the queue not running, an interaction or
   waypoint surviving the drop, or the bot clicking a tick late because it sees the hitsplat
   late. Then 200 rolls at level 99 with the corrected loop. *Success:* at least 80% of gaps are
   2 ticks, and the player's own attack never fires. If it holds, Mining stays (row 4) follow
   through a planner run. If it cannot hold, the trace gives the file and line that says why, and
   rows 1 and 4 close.
4. **Boosted Package B combat finish (~290-320, lab running as rs/91).** *Brief:* on the local
   engine at 300 ms, set the post-MM and Dragon Slayer stats (Attack and Strength 99, Defence ~97,
   Ranged ~54, the route's Prayer). Run rs/31's `ranged-cannon.ts` at the poison spiders, 400 ticks
   per configuration: cannon plus rapid rune knives with sipped Protect from Melee; plus
   zero-drain flicks; plus a ranging potion kept above half and a glory; plus super antipoison
   instead of sharks; and rs/28's alternative of a rune scimitar wielded throughout, so the cannon
   fires at melee accuracy. Measure Ranged, Defence and Hitpoints xp per tick, cannon hit rate,
   sips, food and packet-cap hits. *Success:* the best configuration beats the control by at least
   10% in Ranged xp per tick, and the Package B finish is recomputed from it.
5. **Skill while running (~100-300, mechanism measured).** Move enchanting, Charge and the
   delay-free helper skills (including their level-ups, which do not stop a queued walk) into
   the route's walking legs. *Brief:* count the route's walking ticks on legs with 20 or more
   free inventory slots (quests README §4 from The Grand Tree on, and the skill-site legs); that
   count bounds the saving at 3 ticks per cast moved. Repeat the measured enchant test for Charge
   (an interface button) and for herb mixing at 4 per tick. *Success:* casts land on their slots
   with movement identical to a cast-free run, and the per-leg plan is written into the run
   order.

Next in line, each under ~300 ticks with a brief on its topic page: Wilderness course timing
(row 6), login and logout hygiene (row 8), the trailing-page audit (row 10), and the cannon on
the Jungle Demon (row 11).

## Corrections to canon found along the way

- **The revision is January 2005 (LostCity 289)**, not May 2004 (above).
- **The ring of dueling does teleport** (`ring_of_dueling.rs2:1-34`), contrary to
  `quests/primitives.md` §4 on rs/3's branch. `quest-speedrun.md` repeats the old claim. It is
  worth about 0 ticks on the current route.
- **Random events are off on the demo** (`fly.toml:25`), so genie lamps cannot be obtained. Lamps
  and Brimhaven tickets are untradeable (`xplamp.obj:12-13`, `agilityarena.obj:15`).
- **Every potion sip pauses the cannon** (`p_delay(1)`, `consume_effects.rs2:123-126`).
- **Prayer drains nothing if all prayers are toggled off and on at least every 4 ticks**
  (measured twice, by rs/75 and rs/77). This changes the prayer-potion budgets in every quest
  fight and in the combat finish.
- **There are no ranged prayers in this revision** (15 prayers in `skill_prayer/scripts/prayers/`).
- **A dismissed level-up ends a Make-X batch on the weak queue** (Engine-TS #125, in our base).
  This affects Fletching and Crafting, not anvil smithing.

## Baseline the techniques were valued against

Approximate lines from the route documents as of 2026-10-21 00:50, with the combat finish
updated for Package B. The topic pages take exact figures from the documents named.

| Route line | Ticks | Document |
|---|---|---|
| Quests on the route (Monkey Madness option 1; Package B: Waterfall off, Dragon Slayer on), fixed client, expected | ~11,750 before Package B's swap | `quests/README.md` (rs/3) |
| Combat finish after Monkey Madness and Dragon Slayer (Package B) | ~2,020 (~231 cannon and melee, ~1,792 cannon and knives) | `quests/README.md` §7, `skills/ranged.md` (rs/28) |
| Agility: Grand Tree to 75, Wilderness laps to 99 | ~4,700 | `skills/agility.md` (rs/2) |
| Woodcutting 1-99 | ~3,960, ~3,030 with knife manipulation | `skills/woodcutting.md` (rs/2) |
| Mining after Doric's Quest and Plague City | ~3,765 (knife iron 3.00 ticks per ore at respawn 13) | `skills/mining.md` (rs/2) |
| Fishing after Sea Slug and Fishing Contest | ~2,330 with knife manipulation | `skills/fishing.md` (rs/2) |
| Thieving after Fight Arena | ~1,975 | `skills/thieving.md` (rs/2) |
| Runecraft | ~1,330 | `skills/runecraft.md` (rs/28) |
| Smithing | ~1,110 | `skills/smithing.md` (rs/28) |
| Firemaking | ~650-700 | `skills/firemaking.md` (rs/28) |
| Prayer | ~150-350 | `skills/prayer.md`, `skills/interleaving.md` (rs/28) |
| Magic (enchant to 71, Mage Arena, Charge) | several hundred | `skills/magic.md` (rs/28) |
| Fletching, Herblore, Crafting, Cooking | ~250 | rs/37, `skills/interleaving.md` |
| Overhead: banking, trades, travel, logins, level-ups | ~2,500-3,500 (estimate) | main thread tally, 2026-10-20 21:15 |

Sibling research, not repeated here: `competitors.md` (rs/60, how the demo's top accounts maxed)
and `engine-sweep.md` (rs/61, a mechanical audit of every xp grant and guard in the scripts).
