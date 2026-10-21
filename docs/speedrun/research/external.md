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
the auto-retaliate flinch: mechanism confirmed, [self-only-methods.md](self-only-methods.md)
§3a; its attacker setup is brief A2, still to run) and **rs/91** (the boosted Package B combat
finish, measured; [helper-fed-and-combat.md](helper-fed-and-combat.md) §3).

The self-only skill routes (`skills/*.md`, rs/2) are on main since PR #72; cite main's
`docs/speedrun/skills/README.md`, not rs/2's branch.

## Summary

The communities' biggest levers are mostly absent from this revision, or the route already
uses them. Agility (our largest self-only line) has no faster method here: the Ape Atoll course
came later and has no scripts, Brimhaven arena tickets are untradeable, and obstacle clicks sent
during an obstacle are dropped. There is no free xp at all: lamps and arena tickets are
untradeable, and the demo turns random events off (`fly.toml:25`). The community's per-action
floors for Runecraft, Smithing, Firemaking, Prayer and Magic match the route tick for tick.
No upstream-documented bug is live and worth ticks.

What is left is concrete. **About 1,200 ticks are measured** (a fresh account, the Monkey
Madness temple ladder). **~500-1,100 are conditional** on one mechanism, the 2-tick flinch.
rs/90 confirmed it in the lab (196 rolls at 2 ticks, self-only-methods.md section 3a), but its
Woodcutting value is ~500 and needs two NPC attackers at a two-willow tile, which is not yet
measured. The boosted combat finish is now measured at **~194** against
the route's figure (rs/91). A long tail of 50-300-tick items adds roughly **800-1,500** more. The single largest finding was not a
technique: the scored account has already spent **~547 ticks** of its counter, and a fresh account
skips the tutorial in 6.

## Ranked table

Sorted by ticks saved, the top of each range. "Conditional" rows depend on an untested mechanism.
Rows from the same mechanism are grouped under the higher one. The last column names the route
document an adopted item changes, so the run-order pass can apply it directly.

| # | Technique | Source | Present in revision | Route line | Ticks saved | Cost | Test status | Route document it changes |
|---|---|---|---|---|---|---|---|---|
| 1 | **2-tick Woodcutting by the auto-retaliate flinch**: drop on the tick after a roll; a hit that tick sets `%action_delay = map_clock + 1`; the next tree click rolls at once | OSRS wiki, *Tick manipulation* and *Flinching* ([self-only-methods.md](self-only-methods.md) row 1) | Read yes: `auto_retaliate.rs2:9-22`, `PlayerOps.ts:956-958`, `woodcut.rs2:97-99` | Woodcutting, ~3,028 with the knife | **~500-580 (i)** with two NPCs at two-tree multi-combat tiles; **0** with a Wilderness helper (no two-oak tile, no willows) | Two melee NPCs attacking 2 ticks apart beside a tile reaching two trees | **Mechanism confirmed (m, rs/90)**: 196 rolls at 99, 2 ticks on 160 of 166 steady gaps, own attack never fired. Attacker setup at the two-willow tile untested (brief A2) | `skills/woodcutting.md`, `skills/tick-manipulation.md` (rs/2) |
| 2 | **Monkey Madness temple: ladder drop onto the trapdoor tile** (up the south bamboo ladder, down the east one, inside the guard box) | OSRS wiki, MM quick guide ([quest-speedrun.md](quest-speedrun.md) row 1) | Yes: `quest_mm.rs2:766-771`, ladders and trapdoor in `maps/m43_43.jm2`; no quest-stage checks | MM step H (102 on success, ~600 expected failure budget) | **~670 expected, ~68 success path (i on m)** | none; 5-9 prayer points | **Measured**, 33-36 ticks, 4 of 4 (`quest-mm-temple-ladder.ts`); folded into the quest route, MM now ~3,897 success / ~4,077 expected | `quests/monkey_madness.md` step H, `quests/README.md` (rs/3): **adopted** at `663b4814` |
| 3 | **Start the scored run on a fresh account and skip the tutorial** | OSRS speedrun timing convention ([travel-and-overhead.md](travel-and-overhead.md) row 1; [free-xp.md](free-xp.md)) | Yes: the skip is offered when `map_live` is false (`runescape_guide.rs2:11-18`, `ServerOps.ts:24-26`); the demo leaves `NODE_PRODUCTION` unset | The final score: `www_cairn_md` already carries ~547 ticks (public hiscore, Overall 28 at 2m 44s) | **~540 (m)** | A new account name; the helper roster trades to it | **Measured**: skip in 6 ticks. Adopted by the main thread | Run plan (main thread): **decided yes**; helpers and docs take the scored name from an env value |
| 4 | 2-tick Mining on stays by the same flinch | as row 1 ([self-only-methods.md](self-only-methods.md) row 2) | as row 1; `mining.rs2:83-85` | Mining 63-99, ~3,173 | **0-530 (i), conditional** | as row 1; no iron rock is multi-combat, and one attacker only flinches every 4 ticks (m, rs/90) | Mechanism confirmed by rs/90; needs a Wilderness helper at the level-31 iron cluster; planner run first (brief B there) | `skills/mining.md` (rs/2) |
| 5 | **Boosted Package B combat finish**: ranging potion and glory in the cannon plus knives phase; zero-drain Protect from Melee flicks instead of prayer potions; super antipoison instead of sharks. The cannon's accuracy is the wielded style's, boosts included | OSRS wiki, *Dwarf multicannon*; LostCity forum t/3058, t/14198 ([helper-fed-and-combat.md](helper-fed-and-combat.md) rows 2-4) | Yes: `cannon_fire.rs2:116`, `player_combat.rs2:52-79`; ranging potion `consume_effects.dbrow:57-63`; drain timer `prayer.rs2:30-44,159-175`; `anti_poison.rs2:11-16`. No ranged prayers exist (15 prayers) | Package B finish, 2,051 (rs/31's rates) | **~194 against the route's 2,051; ~354 like for like against the same lab's control, 2,211 (rates m, finish i)**: 1,857 with the kit | ~9 ranging doses, ~3 super antipoison doses, 1 super attack, 1 super strength, 1 glory; no sharks or prayer potions; at most 5 packets per tick (the three-prayer flick tick) | **Measured, rs/91**: at Ranged 85, 21.95 against 18.56 base Ranged per tick (+18%, no overlap); 0 prayer points in 15 flicked runs. A scimitar throughout is slower (2,794) | `quests/README.md` §7 and step 14: **adopted** at `c4066d82`; `skills/ranged.md` (rs/28) |
| 6 | Predicted obstacle clicks and chosen entry tiles on the Wilderness Agility course | OSRS wiki, *Wilderness Agility Course* (67-tick theoretical lap against our 73-77) | Yes: clicks during an obstacle are dropped (`OpLocHandler.ts:14-18`); the rope swing charges `p_delay(distance)` (`wilderness_course.rs2:80-88`) | Agility, ~4,695 | **~60-340 (i)** | bot work | Untested; brief C on the topic page | `skills/agility.md` (rs/2) |
| 7 | **Skill while running**: enchant, Charge and delay-free helper skills during walking legs (the community's "alch while running") | OSRS speedrunning guide; Sal's forum ([travel-and-overhead.md](travel-and-overhead.md) row 2) | Yes: a delayed player keeps moving (`World.ts:801`, `Player.ts:727-751`); spell-on-item leaves the walk queue (`Player.ts:1026-1030`); bury stops it (`bury_bone.rs2:8`) | Magic enchanting (~300 casting ticks), Charge, Fletching, Herblore, Crafting | **~100-300 (i on m)** | rings and runes carried on the leg; never re-click the walk in a cast's tick (that stops the run, m) | Mechanism measured (25 of 25 casts on slot, identical movement); route count is brief B there | `skills/magic.md`, `skills/interleaving.md` (rs/28); the run order's walking legs |
| 8 | Login and logout hygiene: last action and logout in one tick; first action after login sent blind | OSRS speedrunning guide; `playtime-audit.md` | Yes: the joining tick is uncounted, the logout tick counted | every logout cycle (~60-200 on the route) | **~60-400 (i)** | bot work | Untested; brief C on the travel page | speedrun/lib logout and login primitives (rs/40); `playtime-audit.md` |
| 9 | Better cannon tile: lure targets into the overlapping direction squares | OSRS wiki, *Dwarf multicannon* | Yes: 8 directions of 3 squares, one search per tick (`cannon_fire.rs2:10-91`) | combat finish (cannon phases) | **up to ~240 (i)** | lab time | Open question already in `ranged.md` §8 | `skills/ranged.md` §8 (rs/28) |
| 10 | Walk away from a dialogue's trailing pages once its state is set | OSRS speedrun guides ([quest-speedrun.md](quest-speedrun.md) row 7) | Yes: a move click closes the modal (`MoveClickHandler.ts:26-32`) | every on-route dialogue with trailing continues | **~100-200 fixed client, ~20-50 burst (i)** | per-dialogue audit; rewards that run after the last page must not be cut | Reading task (brief on the topic page) | each on-route quest document (rs/3) |
| 11 | Multicannon on the Jungle Demon beside the magic shortbow | OSRS wiki, *Jungle Demon* ("the most effective way to kill the demon") | Yes: no set-up ban there (`cannon_setup.rs2:52-107`); damage ignores Strength | MM step L, 267 ticks | **~100-170 (i)** | ~30 balls; the cannon is already owned | Untested; brief on the topic page | `quests/monkey_madness.md` step L (rs/3) |
| 12 | Cannon from a safespot in single-combat | OSRS wiki, *Dwarf multicannon* | Yes: `player_combat.rs2:106-122` | Package B cannon plus knives phase; pre-MM cannon session | **0-150 (i)**; mainly moves Ranged out of level-37 Wilderness | a safespot within range | Untested; brief C on the combat page | `skills/ranged.md` (rs/28) |
| 13 | Pin a Knight of Ardougne with helpers on its neighbouring tiles | andromack blog; Autumn Elegy 2004Scape guide | Yes: NPC steps respect player occupancy (`Npc.ts:406-413`) | Thieving, ~1,975 | **~85, up to ~250 (i)** | 2-4 helpers standing still | Untested; brief D on the topic page | `skills/thieving.md` (rs/2); helper roster (rs/41) |
| 14 | End the run on the step with the longest exit | speedrun practice: the timer stops on the last split | Yes: the score is the last level-up's stamp | the Wilderness Agility course or the spider cannon | **~30-85 (i)** | ordering only | none needed | the run order (last step) |
| 15 | Log out inside MM's chapter cutscenes so that login completes them | MM's own open question | Yes: `quest_mm.rs2:1-37` (`mm_login`) | MM steps G, H, K | **~40-80 (i)** | none | Untested | `quests/monkey_madness.md` steps G, H, K (rs/3) |
| 16 | Skip Kruk: be pushed one tile west under the Elder Guard by lighting a fire | OSRS wiki, MM quick guide | Probably: `firemaking.rs2:145-174`, `mm_elder_guard.rs2:53-54` | MM step I | **~40-70 (i)** | logs and a tinderbox | Untested | `quests/monkey_madness.md` step I (rs/3) |
| 17 | Zero-drain prayer toggling in the quest fights (Elvarg included now that Dragon Slayer is on) | OSRS wiki, *Prayer* (flicking) | Yes, as row 5 | every protect-prayer fight | **~15-35 (i)**; removes "prayer ran out" as a failure mode | 2-3 packets per 4 ticks | Drain measured | `quests/README.md` trades and the per-fight prayer-potion counts (rs/3); `skills/prayer.md` (rs/28) |
| 18 | Multicannon on the Grand Tree black demon (Dwarf Cannon moved earlier) | OSRS wiki, *Black demon* | Yes | Grand Tree segment N | **~30-60 (i)** | reorder Dwarf Cannon before The Grand Tree | Untested | `quests/grand_tree.md`, `quests/README.md` §4 order (rs/3) |
| 19 | Drop and pick up for single-item hand-offs | "drop trade" practice | Yes: the drop stays private for 100 ticks (`WorldConfig.ts:38,115`) | 5-10 small hand-offs | **~20-50 (i)** | the scored account is logged out during the reveal | none needed | hand-off giver (rs/49), speedrun/lib |
| 20 | Collect Grand Exchange buys at Varrock west instead of taking a trade | GE practice | Yes: `market/GrandExchange.ts:72-89` | supplies while training at the Varrock west booth | **~10-30 (i)** | market liquidity unknown | none needed | buyer role (rs/50) |
| 21 | Ape Atoll stall thieving during the Monkey Madness visit | OSRS wiki, *Ape Atoll* | Yes: `aa_market.rs2:11-14` | Thieving | **0-30 (i)** | Thieving 65 before MM | not worth a lab | none (not adopted) |
| - | **Correction (a cost): walk the monkey back from the zoo**; spirit trees delete it | OSRS wiki, MM quick guide | Yes: `spirit_tree.rs2:74-76` -> `teleport.rs2:109-112` | MM step J | **about -100 (i)** | none | Read; route tile count needed | `quests/monkey_madness.md` step J (rs/3): **adopted** at `663b4814` |

With the kit on both packages, Package A's finish falls to ~2,720 (i, rs/91 config 5), so
Package B still wins, but by ~310-340 rather than ~910-970 (`quests/README.md` §7, decision 1).
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

1. **Start the scored run on a fresh account (~540, measured; adopted).** `www_cairn_md` has ~547
   ticks on its counter at total level 28. Every future stamp includes them. A fresh account skips
   the tutorial in 6 ticks with the SDK's `skipTutorial`. The main thread adopted this on
   2026-10-21. The operator chooses the new name, and nothing in helpers or docs hard-codes it. *Check:* after the new
   account's first logout, read its Overall time on the public hiscores and confirm it is in
   single digits. The saving disappears if the demo ever sets `NODE_PRODUCTION`.
2. **Monkey Madness temple ladder drop (~670 expected, measured; adopted).** rs/3 folded it into
   `monkey_madness.md` and the quest README at `663b4814`, together with the zoo-leg correction
   (walk the monkey back from the zoo, about +100). MM is now ~3,897 success and ~4,077 expected
   (fixed client). No lab is needed.
3. **2-tick Woodcutting by the flinch (mechanism confirmed by rs/90; worth ~500 with two NPC
   attackers at the two-willow tile, 0 with a Wilderness helper; self-only-methods.md section
   3a and brief A2).** *Result (m):* the engine trace showed the first attempt failed on setup
   (attackers on adjacent ticks, and a skipped label after each click), not on the mechanism. With
   that fixed: 196 rolls at Woodcutting 99, 160 of 166 steady gaps at 2 ticks, every roll on the
   tick after a flinch write, and the player's own attack never fired. On one tree the fells make it
   5.15 ticks per roll, slower than the knife, so the value needs a tile that reaches two trees:
   ~500 at the two-willow multi-combat tile (2674,3227) from level 73, ~580 with two-oak tiles
   below 73 too, and 0 with a Wilderness helper (no such tile there). A single attacker flinches
   only every 4 ticks, which also leaves Mining (row 4) needing a Wilderness helper.
   *Next, brief A2 (self-only-methods.md §3):* at (2674,3227), check that two attackers engage
   from the east and south tiles (at the two-oak tile only 1 of 10 did), measure the steady gap
   histogram and the cost of a fell with the other willow standing, and *succeed* on at least 80%
   of steady gaps at 2 ticks and ticks per roll within 10% of `flinch-model.ts`. Then the
   practical question: `::npcadd` is staff-only, so the demo needs two naturally spawning
   attackers that can be brought to that tile 2 ticks out of phase. Do not change rs/2's
   Woodcutting route until A2 passes.
4. **Boosted Package B combat finish (~194 against the route, measured by rs/91; adopted).**
   Flicked Protect from Melee, a ranging potion, a glory and super antipoison with no food
   raise cannon-plus-knives from 18.56 to 21.95 base Ranged per tick at Ranged 85 (m, 3 runs
   each). The finish falls to ~1,857 (i), against the route's 2,051 and the same lab's control of
   2,211. So rs/31's no-kit rate may be ~160 optimistic, and the like-for-like saving is ~354.
   Two route-script rules come with it: drink in the flick's tick, after the toggles, and refill
   the cannon only while standing beside it. The quest README carries the kit, rules and totals
   (§7, step 14). Full results: [helper-fed-and-combat.md](helper-fed-and-combat.md) §3.
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
- **The ring of dueling does teleport** (`ring_of_dueling.rs2:1-34`). An earlier draft of
  `quest-speedrun.md` said it did not and attributed that to `primitives.md`, which makes no such
  claim; the page is corrected. It is worth about 0 ticks on the current route.
- **Random events are off on the demo** (`fly.toml:25`), so genie lamps cannot be obtained. Lamps
  and Brimhaven tickets are untradeable (`xplamp.obj:12-13`, `agilityarena.obj:15`).
- **Every potion sip pauses the cannon** (`p_delay(1)`, `consume_effects.rs2:123-126`).
- **Prayer drains nothing if all prayers are toggled off and on at least every 4 ticks**
  (measured twice, by rs/75 and rs/77). This changes the prayer-potion budgets in every quest
  fight and in the combat finish.
- **A sip or an eat blocks prayer buttons for the next two ticks** (m, rs/91): the engine decodes
  client input before it clears an expired delay (`World.ts`). Drink or eat in the same tick as a
  flick, after the toggles.
- **The route's no-kit cannon-plus-knives rate may be ~160 ticks optimistic** (m, rs/91): its
  same-lab control gives 2,211 for the finish against rs/31's 2,051.
- **There are no ranged prayers in this revision** (15 prayers in `skill_prayer/scripts/prayers/`).
- **A dismissed level-up ends a Make-X batch on the weak queue** (Engine-TS #125, in our base).
  This affects Fletching and Crafting, not anvil smithing.

## Baseline the techniques were valued against

Approximate lines from the route documents as of 2026-10-21 00:50, with the combat finish
updated for Package B. The topic pages take exact figures from the documents named.

| Route line | Ticks | Document |
|---|---|---|
| Quests on the route (Monkey Madness option 1; Package B: Waterfall off, Dragon Slayer on), fixed client, expected | ~11,750 before Package B's swap | `quests/README.md` (rs/3) |
| Combat finish after Monkey Madness and Dragon Slayer (Package B) | ~2,020 (~231 cannon and melee, ~1,792 cannon and knives); now ~1,857 with rs/91's kit | `quests/README.md` §7, `skills/ranged.md` (rs/28) |
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
