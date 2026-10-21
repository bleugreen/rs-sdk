# Quest speedrunning techniques, mapped to this revision

Issue cairn://p/rs/75, under the external-research coordinator cairn://p/rs/59 (`external.md`).
This page takes what the quest speedrunning and quest-guide communities know (OSRS quest
speedrunning, the OSRS wiki's quick and speedrun guides, RS2-era forum guides) and checks each
technique against this server's scripts. It values each one in fixed-client ticks against the
per-quest documents on the quest-route branch (cairn://p/rs/3, `docs/speedrun/quests/`).

Labels follow the quest CONVENTIONS. **m** means measured: a committed lab script run at
`NODE_TICKRATE=300` on bgsrv-mac (load about 2.5). **r** means read from a script line. **i**
means inferred, with the arithmetic given.

## Summary

- **Monkey Madness's temple trapdoor can be reached from the floor above, and the lab confirms
  it.** The OSRS quick guide routes players "up the ladder to the south then down in the east to
  avoid the gorillas". This revision has the same pair of bamboo ladders. The ladder-top script
  drops you on your own tile one floor down, so standing east of the east ladder's top lands you
  on the trapdoor's only access tile, inside the guard box. From the temple approach (2795,2786)
  to the dungeon below the trapdoor took **33-36 ticks, mean 33.75, in 4 of 4 runs (m)**. Those
  runs lost 0-1 hitpoints and used 5-9 prayer points. The documented method took 102 ticks when
  it worked, worked in 1 of 3 tries, and once died. **This saves ~670 ticks of Monkey Madness's
  expected cost (i, on m): ~68 on the success path and the ~600-tick trapdoor failure budget.**
  It is the only finding over ~300 ticks, and it is already measured, so it needs no lab child.
- **Protect prayers can be held at almost zero drain (m).** This revision drains prayer only
  when a 5-tick timer fires, and the timer is cleared whenever no prayer is active. Switching
  Protect from Melee off and on in the same tick every 4 ticks drained **1 point in 100 ticks,
  against 20 when held (m)**, with no unprotected tick among five aggressive temple guards. That
  beats the OSRS 1-tick flick, which still drains. In ticks it is worth only ~15-35 of potion
  sips (i), but it removes "prayer ran out" as a failure mode in every protect-prayer fight.
- **The multicannon on the Jungle Demon** (the OSRS wiki calls it "the most effective way to
  kill the demon") is legal here. The route already owns a cannon by then, and the cannon's
  damage ignores the player's Strength. **~100-170 ticks (i), untested; brief below.**
- **A correction, not a saving: the monkey must be walked back from the zoo.** The spirit trees
  run `~post_tele_checks`, which deletes the monkey in the backpack. `monkey_madness.md` step J
  returns from Ardougne Zoo by the young tree, the village tree and the stronghold tree. The OSRS
  guide says "Travel by foot ... Do not use any means of teleportation". On foot the leg costs
  **~100 ticks more (i)** than the document assumes.
- Smaller items, all inferred: skipping Kruk by being pushed past the Elder Guard (~40-70);
  logging out inside Monkey Madness's chapter cutscenes so that login completes them (~40-80);
  walking away from a dialogue's trailing pages once its state is set (~20-50 burst, ~100-200
  fixed).

**Net effect on the quest block (i).** With rows 1 and 3, Monkey Madness's expected cost moves
from ~4,645 fixed to about **~4,075**: -670 for the trapdoor and +100 for the walked zoo leg.
The success path moves from ~3,865 to about ~3,900. Row 2 would take another ~100-170 off
both. **No off-route verdict flips** (section below).

## Ranked table

Sorted by expected ticks saved on the route. "MM" is Monkey Madness.

| # | Technique | Source | Present in revision (file:line, or absent + how checked) | Route line affected (quest and step) | Ticks saved (label) | Cost | Test status |
|---|---|---|---|---|---|---|---|
| 1 | **Temple ladder drop.** Climb the temple's south bamboo ladder (2794,2773), walk on floor 1 to (2806,2785,1), climb down the east ladder (2805,2785) onto the trapdoor's access tile, open the trapdoor and climb down | OSRS wiki, MM quick guide, M'speak amulet section: "You may need to climb up the ladder to the south then down in the east to avoid the gorillas" [S1] | **Present (r, m).** Ladders in `maps/m43_43.jm2`: bottom 4772 and top 4778 at local (42,21) and at (53,33) (jm2 lines 7537, 9088, 7891, 9294); trapdoor 4879 at (55,33) = (2807,2785). `mm_bamboo_ladder_top` teleports to `movecoord(coord, 0, -1, 0)`, the player's own tile one floor down (`quest_mm.rs2:766-771`). Neither the ladders nor the trapdoor check a quest stage (`quest_mm.rs2:759-771`, `mm_temple.rs2:1-17`) | MM step H, "the trapdoor": 102 on the success path (1 of 3 tries), about +600 expected over it (`monkey_madness.md`) | **~670 expected (i, on m)**: the segment measured 33-36 ticks (mean 33.75, n=4, m) from (2795,2786), the same start as the documented 102. That is 68 on the success path, plus the ~600 failure budget, since no run failed | none. Protect from Melee for the ~5 ticks beside the guards: 5-9 prayer points and 0-1 hitpoints per run (m) | **measured**, `quest-mm-temple-ladder.ts` segment L (4 of 4; the fifth run's staff teleport did not land, a setup failure) |
| 2 | **Multicannon on the Jungle Demon**, alongside the magic shortbow | OSRS wiki, Jungle Demon, Strategy: "Using a dwarf multicannon, fewer than twenty (20) steel cannonballs may be used, making the cannon the most effective way to kill the demon" [S2] | Present (r). Set-up has no ban outside banks, the dwarf mines, the Duel Arena, Castle Wars, the Fight Arena, the party room and under the lighthouse (`cannon_setup.rs2:52-107`). Each tick the cannon checks one of 8 directions and fires at a hunted NPC. Damage is `randominc(min(30, ~npc_max_dealt(30, 0)))`, which does not use the player's Strength. Accuracy is the player's roll for the *wielded* style (`cannon_fire.rs2:1-91, 104-124`; `player_combat.rs2:52-79`). With the bow wielded that is Ranged against the demon's Defence 170 and 0 ranged bonus | MM step L, Jungle Demon: 267 ticks (100 ms lab, `monkey_madness.md`) | **~100-170 (i)**. The bow alone does ~0.64 hp/tick (170 / 267, m). One cannon direction at ~34% accuracy (Ranged 50 + magic shortbow against Defence 170, the standard roll) and 15.5 average damage adds ~0.65 hp/tick. A 3x3 demon near the cannon sits in 2-3 directions, so more. 170 / (1.3 to 1.9) is 88-132 ticks, plus ~26 to set up and pick up, against 267 | cannon set (4 slots) and ~30 balls, already traded for the pre-MM cannon session (README step 8). Risk: a squad gnome in a direction's close-range box takes that direction's shot, because `$fired` is set before the attackable check (`cannon_fire.rs2:68-72`) | untested; lab brief below |
| 3 | **Correction: walk the monkey back from the zoo** (a cost, not a saving) | OSRS wiki, MM quick guide, zoo section: "Travel by foot ... Do not use any means of teleportation" [S1] | Present (r). `spirit_tree.rs2:74-76` calls `~post_tele_checks`, which deletes `mm_monkey_in_backpack` (`teleport.rs2:109-112`). Only spells and spirit trees call it (grep of `~post_tele_checks`), so the gnome glider, Daero's blindfold and Lumdo's boat keep the monkey, and so does the amulet of glory | MM step J, "Back: young tree, village tree, stronghold, Daero ..." (245 + 20) | **about -100 (i)**. The spirit-tree hops cost ~70 (55 tiles to the Battlefield young tree, two tree dialogues, 48 tiles to the Grand Tree). Walking from Ardougne Zoo to the Grand Tree is ~300-350 route tiles, ~150-175 ticks | none | read only; the walking route needs a tile count |
| 4 | **Prayer re-toggle at near-zero drain**: switch the protect prayer off and on in the same tick every 4 ticks. This is the OSRS prayer-flick idea in this engine's form | OSRS wiki, Prayer, prayer flicking [S3]. OSRS drains per tick against a counter, so a 1-tick flick still costs a little; here the drain timer never fires | **Present (r, m).** Activation starts a 5-tick `prayer_drain` timer only when none is running (`prayer.rs2:30-34`). Deactivating the last prayer clears it (`prayer.rs2:42-44`). The only drain is inside the timer (`prayer.rs2:163-181`). Each toggle also runs `p_clearpendingaction`, which clears the attack target (`protectfrommelee.rs2:9`, `Player.ts:1027-1030`), so in a fight the bot must re-send its attack in the same tick | Every protect-prayer fight: warlord, black demon, MM temple and dungeon, Jungle Demon, Kolodion | **~15-35 (i)**: ~6-12 prayer-potion doses avoided route-wide (black demon up to ~67 points, Jungle Demon 2-3 doses, Kolodion ~60 points, temple and dungeon), at ~1-3 ticks per sip. The larger value is risk: prayer ran out in 2 of 5 black-demon kills at 70s (`grand_tree.md`) | no supplies; 2 extra packets every 4 ticks (3 with the attack re-send, inside the 5-packet cap) | **drain measured**: 1 point per 100 ticks toggled against 20 held, 0 published ticks without the prayer, 0 net damage among the trapdoor guards (`quest-mm-temple-ladder.ts` segment P, n=1 each). The attack re-send while toggling is **untested** |
| 5 | **Skip Kruk**: stand east of the Elder Guard and light a fire (or plant a mithril seed) to be pushed one tile west, under the guard and into Awowogei's building | OSRS wiki, MM quick guide: "stand on the east side of the Elder Guard and plant the mithril seeds or light a fire to be force moved one tile west and thus bypass needing to talk to Kruk or to Garkor" [S1] | Probably present (r). The push tries west first, using `lineofwalk` (`firemaking.rs2:145-174`); seeds call the same proc (`mithril_seeds.rs2:16-17`). The Elder Guard script's own comment expects players "under them (mithril seeds)" (`mm_elder_guard.rs2:53-54`). Awowogei's throne gives the mission with no Garkor or Kruk check (`mm_awowogei.rs2:37-38, 63-92`). Unknown: whether `lineofwalk` treats the 2x2 guard as blocking | MM step I (141 stock, R + T): Garkor, Elder Guard, walk to Kruk, Kruk's escort, Awowogei. Also step J's second entry: the Elder Guard lets you in again only if `%mm_kruk` is set (`mm_elder_guard.rs2:27-41`) | **~40-70 (i)**: the Kruk detour (about 60-80 tiles with two ladders and the bridge, 6 pages, ~10 ticks of escort fades) against ~3-5 for a push, once per entry | logs and a tinderbox (tradeable; Firemaking 1 for normal logs) or mithril seeds (Waterfall's reward gives 40) | untested; lab brief below |
| 6 | **Log out inside MM's chapter cutscenes**, so that the login script completes them | MM's own open question (`monkey_madness.md`). For Zooknock's cutscene the community advice runs the other way: "talking to Zooknock again will restart the cutscene" [S1] | Present (r). When you log in inside the chapter-2, -3 or -4 zone, `mm_login` teleports you to the cutscene's end and sets its varps (`quest_mm.rs2:1-37`). Logout closes the modal and waits only for delays and non-discardable queues (`World.ts:857-875`) | MM steps G, H (gree-gree) and K: three cutscenes, ~44, 54 and 70 stock | **~40-80 (i)**: the pages and fade delays left after the teleport into the zone, less ~2-3 ticks of login per use | none | untested; lab brief below |
| 7 | **Walk away from a dialogue's trailing pages** once its last state change has happened | Standard in OSRS quest speedruns: the wiki speedrun guides time dialogue to the last required page [S4] | Present (r). A non-op move click calls `clearPendingAction`, which closes the modal and so ends the paused dialogue script (`MoveClickHandler.ts:26-32`, `Player.ts:1027-1030`). It is refused while the player is delayed (`MoveClickHandler.ts:12-15`). State set before the walk is kept | Any on-route dialogue whose varp, item or reward lands before its last pages, for example Narnode's MM finish (`13c, state, 2c, state, 7c`) and Grand Tree step P (`17c, state, 4c`) | **~20-50 burst, ~100-200 fixed (i)**: about 25-40 dialogues with a trailing run of ~3-8 pure continues; burst saves ~1 tick per such run | none. Each dialogue must be read: completion queues and rewards that run after the last page (Bolren's ceremony, `king_bolren.rs2:100`; Golrie's pebble, `waterfall.md`) must not be cut | read; needs a per-dialogue audit |
| 8 | **Multicannon on the black demon**, with Dwarf Cannon moved before The Grand Tree | OSRS wiki, Black demon (The Grand Tree): "Cannons: Not immune" [S5] | Present (r): no set-up ban under the Grand Tree (`cannon_setup.rs2:52-107`). Accuracy uses the wielded style, so a rune scimitar at Attack ~81 (after Tree Gnome Village's 11,450) rolls slash against Defence 152 | Grand Tree segment N. rs/56 measures Fire Bolt at Strength 1 at 157 ticks (141-181, n=4), with 0 damage under the prayer (cairn://p/rs/56 chat) | **~30-60 (i)**: ~0.75 hp/tick of cannon from one direction, added to Fire Bolt's ~1.0, gives ~90 ticks plus ~26 of set-up | Dwarf Cannon (976) moves before the Grand Tree; no dependency forbids it (`dwarf_cannon.md`). Cannon and balls go in the Grand Tree trade | not tested |

## Lab briefs

Row 1 needs no brief: it is measured. Rows over ~100 ticks that remain untested:

**Row 2, cannon on the Jungle Demon (~100-170).** Setup: the lab state of `quest-mm-demon.ts`
(Ranged 50, magic shortbow, rune arrows, Protect from Magic), plus a cannon set and 60 balls
(Dwarf Cannon done with `::setvar mcannon 11`). Wear the sigil, set the cannon up on the first
clear 3x3 near the landing, then shoot as before. Measure the kill ticks including set-up and
pick-up, balls used, how many directions hit the demon, whether the squad's gnomes take shots,
and deaths. 3 runs at 300 ms. Success: a mean kill under ~170 ticks with no extra deaths.

**Row 7, trailing-page walk-away (~100-200 fixed, ~20-50 burst).** This is a reading task
rather than a lab one. For each on-route dialogue, find the line where its last varp, item or
queue is set and count the pure continues after it. Then spot-check two dialogues in the lab
(walk away after the state page and confirm the varp held). Success: a per-quest list of
skippable runs and their burst ticks.

Below ~100 ticks but cheap to confirm in the same lab session: row 4's attack re-send (fight a
melee NPC for 200 ticks while toggling; success is an attack rate within one attack of an
untoggled control), row 5 (MM at `%mm_garkor = ^garkor_seek_alliance`, gree-gree and amulet
worn, light logs east of the Elder Guard; success is `%mm_awowogei = ^awowogei_sent_mission`
without Kruk), and row 6 (log out on the first tick inside each chapter zone; success is varps
that match a played-through cutscene and at least 15 fewer logged-in ticks per cutscene).

## Checked and not applicable

- **Safespotting the Khazard warlord or the black demon** (OSRS wiki [S5], [S6]): under Protect
  from Melee both already deal 0 damage (rs/56, m), so a safespot changes nothing in ticks. The
  warlord's corner trap [S6] only matters for ranged or magic without the prayer.
- **Safespotting the Jungle Demon** (RS2-era forum threads [S7]): Protect from Magic and 6+
  tiles of range already give 0 damage in the controlled setup (m). Its deaths came from its
  melee when it closed in, which a faster kill (row 2) addresses better.
- **Glough's 200,000-coin puzzle skip** (OSRS wiki [S1]): it leaves the puzzle one slide from
  solved here, and that slide is the same blocked click (`monkey_madness.md`, read).
- **Tracker gnomes in Tree Gnome Village**: the ballista coordinates are fixed here
  (`quest_tree.rs2:6-8,20-26`), as `tree_gnome_village.md` already uses.
- **Ardougne cloak, ring of dueling, stamina and energy potions, explorer's ring** (OSRS wiki
  [S1] item lists): either absent in this content (the ring of dueling does not teleport,
  `primitives.md` §4) or useless because run energy is infinite (`primitives.md` §2).
- **Gorilla statues to restore prayer in the temple** (OSRS wiki [S1]): unnecessary with row 4.
- **Monkey bones from a Karamja monkey** (OSRS wiki [S1]): helpers already supply them.
- **Logging out when the monkey's aunt calls the guards** (OSRS wiki [S1]: "log out or hop
  worlds to avoid going back to jail"): mostly blocked. The aunt queues `aa_guards_queue` 6 ticks
  ahead (`mm_monkeys_aunt.rs2:26-29`). A normal queue blocks logout until it runs
  (`World.ts:863-875`), and then the guards spawn next to you. At most a one-tick window
  remains; timing the aunt (already in `monkey_madness.md`) is the better fix.
- **General Khazard need not be killed** (Fight Arena): already in `fight_arena.md`.
- **Golrie's dungeon during the gnome visit** (Waterfall): already in `waterfall.md`.
- **Kill Fight Arena's Bouncer or Kolodion with the cannon**: banned. The cannon cannot be set up
  in the Fight Arena (`cannon_setup.rs2:78-81`), and cannon parts may not be carried into the
  Mage Arena (`mage_arena.md`, `kolodion.rs2:93-96`).

## Off-route quests

The OSRS wiki's speedrun guides for Tourist Trap, Merlin's Crystal, Holy Grail and Monk's Friend
returned 502 errors throughout this session (wiki maintenance), so these rest on the scripts
and the route documents. The Dragon Slayer guide [S4] was read.

- **Dragon Slayer (Package B candidate).** The speedrun guide's tricks mostly don't apply here.
  "Trade with Oziach to skip some initial dialogue" is absent: his trade option refuses before the
  quest is complete (`oziach.rs2:25-33`). The guide's "teleport as soon as Elvarg dies" is moot,
  because the quest completes on her death (`elvarg.rs2:13-14`). Killing Wormbrain and grabbing
  his map piece is no faster than paying (57 fixed, `dragon_slayer.md`). The guide's one
  transferable idea is **pre-damaging the Melzar's Maze NPCs**. The key drops only to the
  NPC's top-damage player (`npc_findhero` before `obj_add`, `melzars_maze.rs2:69-112`), and the
  keys are untradeable (`quest_dragon.obj`). So a helper can take each NPC to just under half
  its hitpoints, and the scored account deals the rest. That saves roughly 40-45% of the maze's
  fight ticks: **~50-70 (i)**, which lowers Package B from ~1,010 to ~950 fixed and raises the
  Waterfall threshold in README §7 from ~830 to ~890. It does not decide the package; rs/56's
  measurement still does. An Elvarg safespot is not used by the speedrun guide, which fights
  her in melee or ranged behind the anti-dragon shield.
- **Monk's Friend (break-even).** No skip found. The party's 34-tick wait cannot be dodged by
  logging out, because logout waits while the player is delayed (`monks_friend.md`, read). Row
  7's walk-away and chained walk clicks (~15, the document's own note) move it from -24 to about
  0 fixed. That is still inside the model's error, so the verdict stays OFF.
- **Tourist Trap (-162 to -366), Merlin's Crystal + Holy Grail (-233 to -433), Temple of Ikov
  (about -200), The Dig Site (about -320).** No known community skip of that size was found in
  the sources reachable this session, and rows 4 and 7 shave at most a few tens of ticks from
  each. Verdicts unchanged. Tourist Trap's margin is the one to recheck if its speedrun guide
  shows a skip of 200+ ticks.
- **Quest-point efficiency.** No QP gate binds on the route (README decision 3). Package B's
  32-QP filler already uses the cheapest set in `quest_points.md`; community cheapest-QP lists
  add nothing that changes it.

## Sources

- [S1] OSRS Wiki, "Monkey Madness I/Quick guide", https://oldschool.runescape.wiki/w/Monkey_Madness_I/Quick_guide (read 2026-10-21).
- [S2] OSRS Wiki, "Jungle Demon", Strategy section, https://oldschool.runescape.wiki/w/Jungle_Demon (read 2026-10-21).
- [S3] OSRS Wiki, "Prayer", prayer flicking, https://oldschool.runescape.wiki/w/Prayer (not re-read: the wiki was down; the mechanism here is read from `prayer.rs2` and measured).
- [S4] OSRS Wiki, "Dragon Slayer I/Speedrun guide" (Quest Speedrunning worlds, maintained with the RuneScape Speedruns Discord), https://oldschool.runescape.wiki/w/Dragon_Slayer_I/Speedrun_guide (read 2026-10-21, oldid 15150432).
- [S5] OSRS Wiki, "Black demon (The Grand Tree)", https://oldschool.runescape.wiki/w/Black_demon_(The_Grand_Tree) (read 2026-10-21): two safespots, "Cannons: Not immune", magic level 1.
- [S6] OSRS Wiki, "Khazard Warlord", https://oldschool.runescape.wiki/w/Khazard_Warlord (read 2026-10-21): safespot and corner trap.
- [S7] Tip.It forum, "Safespot for Jungle Demon from Monkey Madness?" (2006), https://forum.tip.it/topic/64566-safespot-for-jungle-demon-from-monkey-madness/ (title only; the page timed out).
- No Monkey Madness speedrun guide exists on the OSRS wiki (404 on the Wayback Machine as well); speedrun.com lists MM runs (for example https://www.speedrun.com/rs/runs/z0e555em) without route notes.

## Scripts

- `docs/speedrun/scripts/quest-mm-temple-ladder.ts <bot> [LP] [reps]`: segment L is row 1's
  ladder drop, segment P is row 4's prayer drain. Run with
  `LAB_BLOCK=tickmanip NODE_TICKRATE=300 bash docs/speedrun/scripts/lab.sh Cairn docs/speedrun/scripts/quest-mm-temple-ladder.ts:LP:5`.
- `quest-gnome-lib.ts` (from rs/3) and `lab.sh` (from rs/2) are verbatim copies so the script
  runs on this branch.
