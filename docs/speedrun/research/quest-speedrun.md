# Quest speedrunning techniques, mapped to this revision

Issue cairn://p/rs/75, under the external-research coordinator cairn://p/rs/59 (`external.md`).
This page takes what the quest speedrunning and quest-guide communities know (OSRS quest
speedrunning, the OSRS and RS wikis, RS2-era forum guides) and checks each technique against
this server's scripts. It values each one in fixed-client ticks against the per-quest documents
on the quest-route branch (cairn://p/rs/3, `docs/speedrun/quests/`). Labels follow the quest
CONVENTIONS: **m** measured, **r** read (a script line), **i** inferred (arithmetic given).

**Status: first ranked draft.** The on-route quests are covered. The off-route re-valuation
and a short lab check of the top row are still in progress.

## Summary

- **The temple trapdoor in Monkey Madness can probably be reached from above.** The OSRS
  quick guide routes players up a ladder south of the trapdoor and down a ladder in the east
  "to avoid the gorillas". This revision has the same pair of bamboo ladders, and the
  ladder-top script drops you on your own tile one floor down. So standing east of the east
  ladder's top lands you on the trapdoor's only access tile, inside the guard box. If a lab
  run confirms it, this removes most of Monkey Madness's ~600-tick expected trapdoor
  failure cost and shortens the success path by ~75 (i). **Worth ~600-680 ticks expected
  (i), untested.** It is the only candidate over ~300 ticks.
- **Kill the Jungle Demon with the multicannon as well as the bow.** The OSRS wiki calls the
  cannon "the most effective way to kill the demon" (under 20 cannonballs). The route already
  owns a cannon by then, nothing here bans setting it up in the battle, and its damage roll
  ignores the player's Strength. **~100-170 ticks (i), untested.**
- **Prayer can be kept up at zero drain.** This revision drains prayer only when a 5-tick
  timer fires, and the timer is cleared whenever no prayer is active. Switching the protect
  prayer off and on in the same tick, at least every 4 ticks, means the timer never fires.
  That beats OSRS 1-tick flicking. In ticks it is worth only ~15-35 (i) of potion sips, but
  it removes "prayer ran out" as a failure mode in every protect-prayer fight.
- **A correction, not a saving: the monkey must be walked back from the zoo.** The spirit
  trees run `~post_tele_checks`, which deletes the monkey in your backpack. Yet
  `monkey_madness.md` step J returns from Ardougne Zoo by young tree, village tree and
  stronghold tree. The OSRS guide says "Travel by foot ... Do not use any means of
  teleportation". On foot the leg costs roughly **~100 ticks more (i)** than the document
  assumes.
- Smaller items: skipping Kruk by being pushed past the Elder Guard (~40-70 i), logging out
  inside Monkey Madness's chapter cutscenes so that login completes them (~40-80 i), and
  walking away from a dialogue's trailing pages once its state is set (~20-50 burst, ~100-200
  fixed, i).

Nothing found so far flips an off-route verdict (section in progress below).

## Ranked table

Sorted by expected ticks saved on the route. "MM" is Monkey Madness.

| # | Technique | Source | Present in revision (file:line, or absent + how checked) | Route line affected (quest and step) | Ticks saved (label) | Cost | Test status |
|---|---|---|---|---|---|---|---|
| 1 | **Temple ladder drop.** Climb the temple's south bamboo ladder to the upper floor, walk to the top of the east ladder beside the trapdoor, stand on its east side and climb down. You land on the trapdoor's access tile, then open the trapdoor and climb down | OSRS wiki, MM quick guide, "Getting the M'speak amulet": "You may need to climb up the ladder to the south then down in the east to avoid the gorillas" [S1] | Present (r). Ladders in `maps/m43_43.jm2`: bottom (loc 4772) at local (42,21) = world (2794,2773), top (4778) at the same tile on floor 1; bottom (4772) at (53,33) = (2805,2785), top (4778) at (53,33) floor 1 (jm2 lines 7537, 9088, 7891, 9294). Trapdoor (4879) at (55,33) = (2807,2785). Floor 1 has floor overlay on every tile of x 50-55, z 28-40 (jm2 lines 5109-5215). `mm_bamboo_ladder_top` teleports to `movecoord(coord, 0, -1, 0)`, the player's own tile one floor down (`quest_mm.rs2:766-771`). The trapdoor has no stage or zone check (`mm_temple.rs2:1-17`) | MM step H, "walk to the temple; the trapdoor": 35 + 102 success, +600 expected (`monkey_madness.md`) | **~600-680 expected (i)**: about +600 of failure budget removed, plus the success path's 137 falls to ~60 (35 walk, 3 climb, ~13 upper-floor walk, 3 climb, ~5 trapdoor) | none beyond Protect from Melee for the ~5 ticks beside the trapdoor guards (they are adjacent on landing). Risk: the floor-1 route may be walled or guarded; the floor-1 room holds Denadu, Lofu and a warehouse spider (npc spawns at jm2 lines 10084-10086) | **untested; lab brief below** |
| 2 | **Multicannon on the Jungle Demon**, alongside the magic shortbow | OSRS wiki, Jungle Demon, Strategy: "Using a dwarf multicannon, fewer than twenty (20) steel cannonballs may be used, making the cannon the most effective way to kill the demon" [S2] | Present (r). Set-up has no ban outside banks, the dwarf mines, the Duel Arena, Castle Wars, the Fight Arena, the party room and under the lighthouse (`cannon_setup.rs2:52-107`). Each tick the cannon checks one of 8 directions and fires at a hunted NPC; damage is `randominc(min(30, ~npc_max_dealt(30, 0)))`, independent of the player's Strength; accuracy is the player's roll for the *wielded* style (`cannon_fire.rs2:1-91, 104-124`; `player_combat.rs2:52-79`). With the bow wielded that is Ranged against the demon's 170 Defence and 0 ranged bonus | MM step L, Jungle Demon 267 m (100 ms lab) | **~100-170 (i)**: the bow alone does ~0.64 hp/tick (170 hp / 267, m). One cannon direction at ~34% accuracy (Ranged 50 + magic shortbow against Defence 170, standard roll) and 15.5 average damage gives ~0.65 hp/tick; a 3x3 demon near the cannon sits in 2-3 directions, more. 170 / (0.64 + 0.65 to 1.3) is 88-132 ticks, plus ~26 to set up and pick up, against 267 | cannon set (4 slots) and ~30 balls, already traded for the pre-MM cannon session (README step 8). Risk: a gnome of the squad in the cannon's close-range box takes that direction's shot (`$fired` is set before the attackable check, `cannon_fire.rs2:68-72`) | **untested; lab brief below** |
| 3 | **Correction: walk the monkey back from the zoo** (cost, not saving) | OSRS wiki, MM quick guide, "Freeing King Awowogei's monkey": "Travel by foot ... Do not use any means of teleportation" [S1] | Present (r): `spirit_tree.rs2:74-76` calls `~post_tele_checks`, which deletes `mm_monkey_in_backpack` (`teleport.rs2:109-112`). Only spells and spirit trees call it (grep of `~post_tele_checks`), so the gnome glider, Daero's blindfold and Lumdo's boat keep the monkey | MM step J, "Back: young tree, village tree, stronghold, Daero ..." (245 + 20) | **about -100 (i)**: the spirit-tree hops cost ~70 (55 tiles to the Battlefield young tree, two tree dialogues, 48 tiles to the Grand Tree), the walk from Ardougne Zoo to the Grand Tree is ~300-350 route tiles, ~150-175 | none | read only; the walking route needs a tile count |
| 4 | **Prayer re-toggle at zero drain** (the OSRS prayer-flick idea, in this engine's form): switch the protect prayer off and on in the same tick at least every 4 ticks | OSRS wiki, Prayer flicking [S3] (OSRS drains per tick against a counter, so a 1-tick flick still costs a little; this revision does not drain at all if the timer never fires) | Present (r). Activation starts a 5-tick `prayer_drain` timer only when none is running (`prayer.rs2:30-34`); deactivating the last prayer clears it (`prayer.rs2:42-44`); the only drain is inside the timer (`prayer.rs2:163-181`). `gettimer` returns the timer's start clock (`PlayerOps.ts:907-919`). Each toggle runs `p_clearpendingaction`, which clears the attack interaction (`protectfrommelee.rs2:9`, `Player.ts:1027-1030`), so the bot re-sends the attack in the same tick (3 packets, inside the 5-packet cap) | Every protect-prayer fight: warlord, black demon, MM temple and dungeon, Jungle Demon, Kolodion | **~15-35 (i)**: ~6-12 prayer-potion doses avoided route-wide (black demon up to ~67 points, Jungle Demon 2-3 doses, Kolodion ~60 points, temple and dungeon), at ~1-3 ticks per sip. The larger value is risk: prayer ran out in 2 of 5 black-demon kills at 70s (`grand_tree.md`) | no supplies; 2 extra packets every 4 ticks | **untested; lab brief below** |
| 5 | **Skip Kruk**: stand east of the Elder Guard and light a fire (or plant a mithril seed) to be pushed one tile west, under the guard and into Awowogei's building | OSRS wiki, MM quick guide: "stand on the east side of the Elder Guard and plant the mithril seeds or light a fire to be force moved one tile west and thus bypass needing to talk to Kruk or to Garkor" [S1] | Probably present (r). The push tries west first with `lineofwalk` (`firemaking.rs2:145-174`; seeds call the same proc, `mithril_seeds.rs2:16-17`). The Elder Guard script's own comment anticipates players "under them (mithril seeds)" (`mm_elder_guard.rs2:53-54`). Awowogei's throne gives the mission with no Garkor or Kruk check (`mm_awowogei.rs2:37-38, 63-92`). Unknown: whether `lineofwalk` treats the 2x2 guard as blocking | MM step I (141 stock, R + T): Garkor, Elder Guard, walk to Kruk, Kruk's escort, Awowogei; and step J's second entry (the Elder Guard lets you in again only if `%mm_kruk` is set, `mm_elder_guard.rs2:27-41`) | **~40-70 (i)**: the Kruk detour (about 60-80 tiles with two ladders and the bridge, 6 pages, the escort's ~10 ticks of fades) against ~3-5 for the push, once per entry | logs and a tinderbox (tradeable; Firemaking 1 for normal logs) or mithril seeds (Waterfall's reward gives 40) | **untested; lab brief below** |
| 6 | **Log out inside MM's chapter cutscenes** so that the login script completes them | MM's own open question; the community guidance runs the other way for Zooknock ("talking to Zooknock again will restart the cutscene") [S1] | Present (r): `mm_login` teleports you to the cutscene's end and sets its varps when you log in inside the chapter-2, -3 or -4 zone (`quest_mm.rs2:1-37`). Logout closes the modal and waits only for delays and non-discardable queues (`World.ts:857-875`) | MM steps G, H (gree-gree) and K: three cutscenes, ~44, 54 and 70 stock | **~40-80 (i)**: the cutscenes' remaining pages and fade delays after the teleport into the zone, less ~2-3 ticks of login per use | none | **untested; lab brief below** |
| 7 | **Walk away from a dialogue's trailing pages** once its last state change has happened | Standard practice in OSRS quest speedruns ("click away") [S4] | Present (r): a non-op move click calls `clearPendingAction`, which closes the modal and so ends the paused dialogue script (`MoveClickHandler.ts:26-32`, `Player.ts:1027-1030`). It is refused while the player is delayed (`MoveClickHandler.ts:12-15`). State set before the walk is kept | Every on-route dialogue whose varp, item or reward lands before its last pages (for example Narnode's MM finish `13c, state, 2c, state, 7c`; Grand Tree P `17c, state, 4c`) | **~20-50 burst, ~100-200 fixed (i)**: about 25-40 dialogues with a trailing run of ~3-8 pure continues; burst saves ~1 tick per such run | none. Risk: completion queues and rewards that run after the last page (Bolren's ceremony, `king_bolren.rs2:100`) must be read per dialogue | read; per-dialogue audit needed |
| 8 | **Multicannon on the black demon**, with Dwarf Cannon moved before The Grand Tree | OSRS wiki, Black demon (The Grand Tree): "Cannons: Not immune" [S5] | Present (r): no set-up ban under the Grand Tree (`cannon_setup.rs2:52-107`). Accuracy uses the wielded style, so a rune scimitar at Attack ~81 (after Tree Gnome Village's 11,450) rolls slash against Defence 152 | Grand Tree segment N: rs/56 measures Fire Bolt at Strength 1 at 157 ticks (141-181, n=4), 0 damage under the prayer (cairn://p/rs/56 chat) | **~30-60 (i)**: ~0.75 hp/tick of cannon from one direction added to Fire Bolt's ~1.0 gives ~90 ticks plus ~26 of set-up | Dwarf Cannon (976) moves before the Grand Tree; no dependency forbids it (`dwarf_cannon.md`). Cannon and balls in the Grand Tree trade | not tested |

## Lab briefs

**Row 1, temple ladder drop (worth ~600-680 expected; the coordinator's threshold for a lab
child).** Setup: local engine, practice account Cairn with `LOCAL_STAFF_LEVEL`, Prayer 43, a few
sharks; no quest stage is needed, because the temple trapdoor and the ladders have no stage
check. Teleport to the south ladder at (2794,2773,0), climb, walk on floor 1 to the tile east of
the ladder top at (2805,2785,1), that is (2806,2785,1), and climb down. Measure: whether floor 1
connects the two ladders, the landing tile, the ticks from the first climb click to the
dungeon below the trapdoor (0_43_143_55_49), the damage taken under Protect from Melee, and
whether a trapdoor guard can occupy (2806,2785,0) so that the landing is refused or boxed.
Repeat 5 times at `NODE_TICKRATE=300`. Success: 5 of 5 descents with no death, each under ~70
ticks from the temple entrance. If floor 1 does not connect, try climbing the east ladder from
any free neighbour and dropping back east of it.

**Row 2, cannon on the Jungle Demon (~100-170).** Setup: the lab state of `quest-mm-demon.ts`
(Ranged 50, magic shortbow, rune arrows, Protect from Magic), plus a cannon set and 60 balls
(Dwarf Cannon done via `::setvar mcannon 11`). Wear the sigil, set the cannon up on the first
clear 3x3 near the landing, then shoot as before. Measure: kill ticks including set-up, balls
used, how many directions hit the demon, whether the squad's gnomes eat shots, deaths. 3 runs
at 300 ms. Success: mean kill (with set-up and pick-up) under ~170 ticks with no extra deaths.

**Row 4, prayer re-toggle (~15-35, high risk value).** Setup: any melee NPC that hits
regularly, Prayer 43. Loop: every 4 ticks send prayer off, prayer on, attack (3 packets in one
tick). Measure over 200 ticks: prayer points used, any hit that landed unprotected, and the
attack rate against an untoggled control. Success: 0 points drained, 0 unprotected hits, and an
attack rate within one attack of the control.

**Row 5, Kruk skip (~40-70).** Setup: MM at `%mm_garkor = ^garkor_seek_alliance`, Karamja
gree-gree and M'speak amulet worn, logs and a tinderbox. Stand east of the Elder Guard at the
building entrance, light the logs, and record whether the push lands under the guard and
whether you can walk from there to the throne and start Awowogei's mission. Success: mission
set (`%mm_awowogei = ^awowogei_sent_mission`) without talking to Kruk.

**Row 6, cutscene logout (~40-80).** Setup: `::setvar` MM to the step before each chapter
cutscene. Trigger the cutscene, log out on the first tick after the teleport into the zone,
log in, and check the position and varps (`mm_main`, `mm_lumdo`, `mm_zooknock`, `mm_garkor`).
Measure: logged-in ticks from the trigger click to control on the far side, against playing
the cutscene through. Success: varps match a played-through cutscene and the logged-in time is
at least 15 ticks lower per cutscene.

## Checked and not applicable

- **Safespotting the Khazard warlord or the black demon** (OSRS wiki [S5], [S6]): under Protect
  from Melee both already deal 0 damage (rs/56, m), so a safespot changes nothing in ticks.
- **Safespotting the Jungle Demon** (RS2-era forum threads, [S7]): Protect from Magic and
  6+ tiles of range already give 0 damage in the controlled setup (m); the deaths came from
  its melee when it closed in, which the cannon's faster kill addresses better.
- **Glough's 200,000-coin puzzle skip** (OSRS wiki [S1]): it leaves the puzzle one slide from
  solved here, the same blocked click (`monkey_madness.md`, read).
- **Tracker gnomes in Tree Gnome Village**: the ballista coordinates are fixed here
  (`quest_tree.rs2:6-8,20-26`), as `tree_gnome_village.md` already uses.
- **Ardougne cloak, ring of dueling, stamina and energy potions, explorer's ring** (OSRS wiki
  [S1] item lists): absent in this content (the ring of dueling does not teleport,
  `primitives.md` §4) or useless because run energy is infinite (`primitives.md` §2).
- **Gorilla statues to restore prayer in the temple** (OSRS wiki [S1]): unnecessary if row 4
  works; not checked further.
- **Monkey bones from a Karamja monkey** (OSRS wiki [S1]): helpers supply them already.
- **Logging out when the monkey's aunt calls the guards** (OSRS wiki [S1]: "log out or hop
  worlds to avoid going back to jail"): mostly blocked. The aunt queues `aa_guards_queue`
  6 ticks ahead (`mm_monkeys_aunt.rs2:26-29`), a normal queue blocks logout until it runs
  (`World.ts:863-875`), and then the guards spawn next to you. At most a one-tick window;
  timing the aunt (already in `monkey_madness.md`) is the better fix.

## Off-route quests (in progress)

Tourist Trap, Monk's Friend, Merlin's Crystal with Holy Grail, Dragon Slayer, Temple of Ikov and
The Dig Site are being checked against the OSRS wiki speedrun guides. This section fills in
with the refinement.

## Sources

- [S1] OSRS Wiki, "Monkey Madness I/Quick guide", https://oldschool.runescape.wiki/w/Monkey_Madness_I/Quick_guide (read 2026-10-21).
- [S2] OSRS Wiki, "Jungle Demon", Strategy section, https://oldschool.runescape.wiki/w/Jungle_Demon (read 2026-10-21).
- [S3] OSRS Wiki, "Prayer" (prayer flicking), https://oldschool.runescape.wiki/w/Prayer#Prayer_flicking (to confirm).
- [S4] OSRS Wiki speedrun guides written with the RuneScape Speedruns Discord, for example https://oldschool.runescape.wiki/w/Dragon_Slayer_I/Speedrun_guide (to confirm the click-away wording).
- [S5] OSRS Wiki, "Black demon (The Grand Tree)", https://oldschool.runescape.wiki/w/Black_demon_(The_Grand_Tree) (read 2026-10-21): safespots, "Cannons: Not immune", magic level 1.
- [S6] OSRS Wiki, "Khazard Warlord", https://oldschool.runescape.wiki/w/Khazard_Warlord (read 2026-10-21): safespot and corner trap.
- [S7] Tip.It forum, "Safespot for Jungle Demon from Monkey Madness?" (2006), https://forum.tip.it/topic/64566-safespot-for-jungle-demon-from-monkey-madness/ (title only; the page timed out).
