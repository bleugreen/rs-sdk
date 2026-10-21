# Free xp: lamps, random events, minigame and NPC xp, Tutorial Island

Coordinator: cairn://p/rs/59. Summary table: [external.md](external.md). This page checks every
source of xp that the RuneScape community lists outside ordinary training against this server's
revision, and values each in ticks on our route.

Labels follow the route documents: **r** read (a script or config line, cited), **m** measured
(a committed lab script), **i** inferred (arithmetic shown). Xp is base xp (game xp / 25; level
99 is 39,938 base). Ticks are 300 ms server ticks spent logged in on the scored account.
Script paths are under `server/content/scripts/` unless they say otherwise.

## Summary

**There is no free-xp lever on this server.** The two items that turn into xp are the genie lamp
and the Brimhaven Agility Arena ticket, and both are untradeable (r: `general/configs/xplamp.obj:12-13`
is `tradeable=no` and `unbankable`; `minigames/game_agilityarena/configs/agilityarena.obj:15` is
`tradeable=no`). Helpers therefore cannot farm either one and hand it over, which closes the
posture's main route to free xp.

The lamp itself is unreachable on the demo. Its only source is the genie random event
(`macro events/scripts/general/macro_event_genie.rs2:70` is the only `inv_add` of
`macro_genilamp` in the content). The demo deploy turns random events off: `fly.toml:25` sets
`NODE_RANDOM_EVENTS = "false"` for `app = "rs-sdk-demo"`. Every event, the genie included,
first checks `map_random_events` (`macro events/scripts/macro_events.rs2:65-68`), which reads that
flag (`server/engine/src/engine/script/handlers/DebugOps.ts:27-28`).

Every other xp grant outside the skill and quest scripts was enumerated with a grep for
`stat_advance` (method in the sources section). Each pays fewer base xp per tick than the route
line it would replace, or sits behind a quest the route does not do. The best of them, Ape Atoll
stall thieving during Monkey Madness, is worth at most about 30 ticks (i), and probably nothing
in practice. **No candidate is worth a lab child** (none reaches 100 ticks).

Two side findings, neither of them xp:

- **Tutorial Island can be skipped in one dialogue** on the demo. The RuneScape Guide offers
  "Do you want to skip the tutorial?" whenever `map_live` is false
  (`tutorial/scripts/guides/runescape_guide.rs2:11-17`). `map_live` reads `NODE_PRODUCTION`
  (`server/engine/src/engine/script/handlers/ServerOps.ts:24-25`), which defaults to false
  (`server/engine/src/util/WorldConfig.ts:103,245`), and `fly.toml` does not set it. The
  tutorial's own xp is capped below level 3 in each skill (`tutorial/scripts/tutorial.rs2:289-293`),
  so skipping gives up nothing. The SDK's `skipTutorial` (`sdk/actions.ts:143`) already takes
  this path. I did not check whether the scored account has already left the island. It does not
  matter to the route: skipping costs a few dialogue pages, and finishing the tutorial is never
  worth it.
- **`NODE_DEBUG = "true"` on the demo does not open cheat commands.** Every branch of the cheat
  handler is gated on `staffModLevel` of at least 2
  (`server/engine/src/network/game/client/handler/ClientCheatHandler.ts:53-685`). The login
  server never grants staff level unless a private lab sets `LOCAL_STAFF_LEVEL`
  (`server/engine/src/server/login/LoginThread.ts:60-61`).

## Ranked table

Sorted by ticks saved on our route. Every row is valued as the ticks of the cheapest route
training the xp replaces, minus the scored account's ticks to claim it.

| # | Technique | Source | Present in revision | Route line affected | Ticks saved (label) | Cost | Test status |
|---|---|---|---|---|---|---|---|
| 1 | Steal from the Ape Atoll scimitar and magic stalls while on the island for Monkey Madness | Monkey Madness rewards area (OSRS wiki, Ape Atoll) | Yes: 210 base (scimitar) and 100 base (magic), Thieving 65, respawn 65 ticks (r: `quests/quest_mm/scripts/aa_market.rs2:11-14`) | Thieving (Knights of Ardougne, 9.8-12.7 base/tick at 55-70, `skills/thieving.md` rs/2) | **0 to ~30** (i: one scimitar steal = 210 / 11.5 ≈ 18 ticks of knights, minus about 3 ticks to steal; at most one or two steals fit the Monkey Madness visit) | Thieving 65 before Monkey Madness (Fight Arena leaves 57); not while wearing a greegree (r: `aa_market.rs2:28-31`); the shopkeeper blocks it within 11 tiles (r: `:44-47`); a human in Marim is attacked by guards | Not tested. Not worth a lab. |
| 2 | Genie lamp (10 × level xp in any skill) | Lamp and genie, RuneScape Wiki; Zybez random events guide (2006) | Script present (r: `general/scripts/xplamp/xplamp.rs2:110-111`), **unreachable**: random events are off on the demo (r: `fly.toml:25`); untradeable and unbankable (r: `xplamp.obj:12-13`) | Agility above 90 would be the target (7.0 base/tick, `skills/agility.md` rs/2) | **0** (r). If events were ever enabled, about 55-150 before interruptions (i, below) | n/a | Not needed. |
| 3 | Tutorial Island xp | Tutorial Island, wikis | Yes, capped below level 3 per skill (r: `tutorial.rs2:289-293`); skippable (r: `runescape_guide.rs2:11-17`) | Levels 1-3 of eight skills | **0** (i: under about 200 base in total, all below level 3, where every skill costs a few ticks; the tutorial itself costs hundreds) | n/a | Not needed. |
| 4 | Brimhaven Agility Arena tickets fed by helpers | Brimhaven Agility Arena, RuneScape Wiki (released 27 July 2004) | Trader present, 240-320 base per ticket (r: `minigames/game_agilityarena/scripts/agilityarena_tickettrader.rs2:36-67`); **tickets untradeable** (r: `agilityarena.obj:15`) | Agility | **0** (r: helpers cannot hand tickets over; self-earned tickets lose to the Wilderness course, rs/2 `agility.md` section 5) | n/a | Not needed. |
| 5 | Fishing Trawler | Fishing Trawler, RuneScape Wiki (released 28 July 2003) | Yes (r: `minigames/game_trawler/`) | Fishing (about 15 base/tick on the knife fly-fishing cycle, `skills/fishing.md` rs/2) | **0** (i: about 2 base/tick, below) | n/a | Not needed. |

Rows 1 to 5 are the only candidates the community lists for this period that exist in some form
here. The rest are in the not-applicable list below.

## Valuations in detail

### Genie lamp, if random events were enabled

The xp is `stat_base × 10` base, so 960-990 base at Agility 96-99 (r: `xplamp.rs2:110-111`).
Agility's Wilderness laps earn 7.02-7.14 base per tick there (rs/2 `agility.md` section 2), so
one lamp replaces about 135-139 ticks (i). Claiming it takes one talk-to, a rub, a skill button
and a confirm: about 2-3 ticks at 5 packets per tick (i). That leaves **about 135 ticks per lamp**
(i). Lamps can be held until the Agility line, but they take an inventory slot and cannot be
banked (r: `xplamp.obj:13`).

The lamps would not arrive often:

- The engine rolls each logged-in player's event flag every 500 ticks, at 1 in 24, or 1 in 12
  while the player has stayed in the same few zones (r: `server/engine/src/engine/World.ts:146-148,694-695`).
  That is one event per 6,000-12,000 logged-in ticks (i).
- An event picks from 8 entries; entries 7 and 8 (teleport events) are kept only a quarter of
  the time and rerolled over 1-6 otherwise (r: `macro_events.rs2:105-118`,
  `macro events/configs/macro_events.constant:54`, `macro_events.enum`). So the genie, entry 2,
  is 1/8 + (2/8 × 3/4 × 1/6) = **5/32, about 16%** of general events (i). At mining, fishing and
  woodcutting sites, skill-specific events take 2-3 of every 10-11 rolls
  (r: `macro events/scripts/mining/macro_event_mining.rs2:6-11`).
- Over a route of about 40,000 logged-in ticks: 3.3-6.7 events, so **about 0.4-1.1 lamps**
  (i), worth about 55-150 ticks.
- The other events cost ticks. They include bee swarms, failed-event teleports to random spots
  (r: `macro_events.rs2:127-144`) and the maze and mime events, which take the player away.
  The net value of switching events on would be roughly zero, and the event rate cannot be
  raised with legal packets: the roll is a per-tick `Math.random()` on the server, not a
  reaction to anything the client sends.

This only matters if the demo's config changes. Logged-out time is free, so a lamp could only
ever come from logged-in time.

### Fishing Trawler

A game lasts a fixed 1,000 ticks (r: `minigames/game_trawler/scripts/trawler_control.rs2:13`).
Each 5-tick cycle adds a fish with chance 1 in 10 per player aboard, but only while the net is
whole (r: `:152-162`). The total is then divided by the player count (r: `:14`). So each player
gets about 20 reward rolls per game whatever the crew size (i: 200 cycles × 0.1). Each roll pays
1.2-115 base (r: `trawler_win.rs2:107-156`). At most that is 20 × 115 = 2,300 base per
1,000-plus ticks, **about 2 base per tick at best** (i), against about 15 base per tick for the
route's fly fishing from level 78 (i: about 30,600 base over about 2,000 ticks, rs/2
`fishing.md` section 1).

### Ape Atoll stalls

The scimitar stall pays 210 base and the magic stall 100 base, Thieving 65 for both, and each
respawns in 65 ticks (r: `aa_market.rs2:11-14,74-75`). Knights of Ardougne earn 9.8 base per tick
at 55 and 12.7 at 70 (m, rs/2 `thieving.md` section 2). So one scimitar steal replaces about 18
ticks of knights (i: 210 / 11.5), and one magic steal about 9. Three things stand in the way:

- The account has Thieving 57 from Fight Arena when it reaches Monkey Madness, not 65. The
  check uses `stat()` (r: `aa_market.rs2:33`), and no Thieving boost exists on the route.
- Stealing is refused while wearing a greegree (r: `aa_market.rs2:28-31`), and Marim's guards
  attack humans.
- The shopkeeper Padulah blocks the steal from within 11 tiles in line of sight (r: `:44-47`).

A quick steal on the way past is not worth staging; the most it could save is about 30 ticks
(i). If the route ever trains Thieving past 65 before Monkey Madness, add it as an opportunistic
click.

## Lab briefs

None. No candidate is worth over ~100 ticks on the current route, so none earns a brief, and
none reaches the ~300-tick bar for a lab child.

One config fact could be confirmed without a lab: that the live demo really runs with
`NODE_RANDOM_EVENTS=false`. `fly.toml` is the deploy source, but a Fly secret could override it.
The cheap check is observational: in the competitor audit (rs/60), has any account on the demo
ever been seen with a random-event NPC (genie, swarm, drunken dwarf, mysterious old man)? If none
has, the config is confirmed.

## Checked and not applicable

Each entry gives where the source lives (or how its absence was checked) and why it does not
help. The absence checks for minigames rely on the fact that the grep below found every
`stat_advance` outside the skill and quest directories; a minigame with no line in that list
grants no xp in this revision.

- **Random events other than the genie.** Off on the demo, as above. When on, none of them
  pays xp in this revision. The rewards are a kebab and beer from the drunken dwarf
  (`macro_event_drunken_dwarf.rs2:69-70`), items from the strange box, the mime and the old man
  (`macro_event_strange_box.rs2:275`, `macro_event_mime.rs2:137,264,281`,
  `macro_event_mysterious_old_man.rs2:108`), coins or items from the maze
  (`macro_event_maze.rs2:122,178`) and a triffid fruit (`macro_event_triffid.rs2:19`). The 2006
  Zybez guide lists Evil Bob as the only other xp-paying event of the era. He is absent (grep for
  `evil_bob` and `evilbob` over the content: no match).
- **Brimhaven Agility Arena tickets, self-earned.** One ticket per 98-tick pillar move caps the
  tickets at about 2.9 base per tick. rs/2 rejects it against the Wilderness course
  (`skills/agility.md` section 5). The 1,000-ticket bundle (320,000 base,
  `agilityarena_tickettrader.rs2:48`) would take about 98,000 ticks of arena play (i).
- **Gnome Ball.** 30 base Ranged and 30 Agility per completed five-goal game
  (`minigames/game_gnomeball/scripts/gnomeball_shoot.rs2:42-45`). rs/2 rejects it
  (`agility.md` section 5), and Ranged comes from the cannon at 11.5-22.7 base per tick
  (rs/28 `ranged.md`).
- **Ranging Guild targets.** Half the shot's points as base Ranged, so at most 50 per bullseye
  (`minigames/game_ranging/scripts/target.rs2:42`). Each shot takes `p_delay(2)` and a target
  interface, ten shots per round, then the judge's dialogue. That is well under the cannon's
  11.5 base per tick from level 1 (i). It also needs Ranged 40 to enter the guild.
- **Shades of Mort'ton pyres and the Flamtaer temple** (released 18 October 2004, present).
  A magic pyre pays 404.5 base Firemaking plus 60 for building it, and up to 100 base Prayer
  (`minigames/game_mortton/configs/flamtaer_pyre.struct:63-66`, `mortton.obj:82`,
  `scripts/mortton_pyre.rs2:42,201-202`). Building, loading and lighting a pyre takes longer than
  the 4 ticks per log of the route's line, which already earns 76 base per tick
  (m, rs/28 `firemaking.md` section 1). It also needs the Shades of Mort'ton quest, which is off
  the route. The temple's 160 base Firemaking (`flamtaer_temple.rs2:233`) comes after a long
  repair.
- **Combat Training Camp dummies.** Six hits at 50 base Attack, once
  (`areas/area_combat_training/scripts/combat_training_camp.rs2:50-55`). The gate needs
  Biohazard, which is off the route (`:39-42`), and the quests already give Attack 99
  (rs/3 README, "Attack 99 = TGV+GT+WF+FA").
- **Varrock training dummy.** 5 base Attack per hit, only below Attack 8
  (`areas/area_varrock/scripts/attack_dummy.rs2:7-12`). Attack comes from quests.
- **Ardougne Zoo monkey release** (after Monkey Madness). 2 × Thieving level base per monkey
  released on Karamja (`quests/quest_mm/scripts/mm_zoo_monkey.rs2:96-98`), one monkey at a time
  (`:2-5`). That is 180 base at Thieving 90 for a round trip from Ardougne to Karamja of well
  over 100 ticks, against knights at 20-33 base per tick (i).
- **Chompy bird hunting milestone.** 30,000 base Ranged at the 4,000th chompy kill
  (`quests/quest_chompybird/scripts/chompy_bird.rs2:211-212`; OSRS wiki, chompy bird hat).
  4,000 kills by the scored account itself cost far more than Ranged's whole ~2,200-tick line.
- **Kharidian cactus.** 10 base Woodcutting per successful cut, 0.4 on a fail, and it needs
  empty waterskins (`areas/area_desert/scripts/kharidian_cactus.rs2:67-70`). Woodcutting
  averages about 13 base per tick (i: ~40,000 base over ~3,030 ticks, rs/2 `woodcutting.md`).
- **Managing Miscellania workers.** 0.1 base per action
  (`areas/area_miscellania/scripts/*.rs2`).
- **Ogre rock-cake stall** in Yanille. 6.5 base Thieving (`areas/area_yanille/scripts/ogre_trader.rs2:39`).
- **Gnome restaurant.** Cooking xp (`areas/area_gnome/scripts/gnome_restaurant.rs2:402`); Cooking
  1-99 already costs about 47 ticks with wine.
- **Agility shortcuts in the Brimhaven and Yanille dungeons.** 7.5-22.5 base each
  (`areas/area_karamja/scripts/karam_dungeon.rs2`, `areas/area_yanille/scripts/agility_dungeon.rs2`);
  rs/2 rejects them (`agility.md` section 5).
- **Repeatable or one-off xp inside off-route quests.** Examples are Nature Spirit's ghasts
  (30 base Prayer each, `quests/quest_druidspirit/scripts/ghast.rs2:132`), the Digsite finds and
  exams (`quests/quest_itexam/scripts/area_digsite.rs2`), Legends' jungle trees
  (`quests/quest_legends/scripts/jungle_tree.rs2:130`), and the Tai Bwo Wannai Trio steps and
  rewards (`quests/quest_tbwt/scripts/`, `areas/area_karamja/scripts/tbwt_*_final.rs2`). They
  belong to their quests' valuations (rs/3 and `quest-speedrun.md`), and every one of those
  quests is off the route.
- **Treasure Trails, Castle Wars, Duel Arena, Party Room, games room.** Present
  (`minigames/game_trail`, `game_castlewars`, `game_duelarena`, `game_partyroom`,
  `game_gamesroom`), with no `stat_advance` anywhere in their scripts. Barcrawl and the
  Champions' Guild likewise grant no xp.
- **Other lamps and xp books.** `macro_genilamp` is the only lamp object, and the genie is its
  only source (grep for `genilamp` over `server/content`: `xplamp.obj`, `xplamp.rs2`,
  `macro_event_genie.rs2` and the packs). The book scripts (`book.rs2`, `ghrims_book.rs2`,
  `book_of_astrology.rs2` and others) only display text. Quest lamps, the Book of Knowledge and
  the random event gift came later.
- **Absent minigames (2005 and later).** None of these has a directory or script in
  `server/content/scripts`, checked by listing `minigames/` and grepping the tree for each name:
  Tai Bwo Wannai Cleanup (released 9 August 2005; no trading sticks in any config), Tears of
  Guthix (4 May 2005), Mage Training Arena (4 January 2006), Pest Control (18 April 2006),
  Stronghold of Security (4 July 2006), Barbarian Assault (4 January 2007), and Penguin Hide and
  Seek (2 September 2008). Achievement Diaries (OSRS 2015; RS2 2009 onward) are also absent;
  the only "diary" scripts are quest props (`witches_diary.rs2`, `horror_diary.rs2`).
- **Cheat commands.** Gated on staff level (see the summary), so no xp source.

## Method

1. A grep for `stat_advance` over every `.rs2` under `server/content/scripts`, excluding
   `skill_*`, `quests/` and `_test`. It returned 64 lines, all listed above or in the table:
   the lamp, the tutorial, the agility arena, Gnome Ball, the Ranging Guild, Mort'ton,
   the Trawler, the gnome restaurant, Miscellania, the Combat Training Camp, the Brimhaven and
   Yanille dungeons, the Tai Bwo Wannai Trio finals, Caroline (Sea Slug's reward, already on
   the route), the ogre trader, the Kharidian cactus and the Varrock dummy.
2. The same grep over the quest directories with more than one grant, to find repeatable or
   off-reward xp (Ape Atoll stalls, zoo monkeys, chompies, ghasts, Digsite).
3. Tradeability from each item's `.obj`, reachability from the deploy config (`fly.toml`) and
   the engine's environment defaults.
4. The community side from the RuneScape and Old School wikis (release dates and reward
   descriptions) and a 2006 random-events guide archived on the Wayback Machine.

The mechanical audit of every grant and guard is rs/61's `engine-sweep.md`; this page does not
repeat it.

## Sources

- Lamp, RuneScape Wiki: https://runescape.wiki/w/Lamp (10 × level; untradeable and unbankable;
  released 6 April 2004).
- Genie (random event), RuneScape Wiki: https://runescape.wiki/w/Genie_(random_event)
- Random Events guide, Zybez, archived 14 August 2006:
  https://web.archive.org/web/20060814111255/http://www.zybez.net/misc.php?id=11 (the source the
  content's own random-event code cites, `macro_events.rs2:181`).
- Brimhaven Agility Arena, RuneScape Wiki: https://runescape.wiki/w/Brimhaven_Agility_Arena
  (released 27 July 2004).
- Fishing Trawler, RuneScape Wiki: https://runescape.wiki/w/Fishing_Trawler (28 July 2003).
- Shades of Mort'ton, RuneScape Wiki: https://runescape.wiki/w/Shades_of_Mort%27ton (18 October 2004).
- Gnomeball, RuneScape Wiki: https://runescape.wiki/w/Gnomeball (28 January 2003).
- Ranging Guild, Old School Wiki: https://oldschool.runescape.wiki/w/Ranging_Guild (21 January 2004).
- Big Chompy Bird Hunting, Old School Wiki: https://oldschool.runescape.wiki/w/Big_Chompy_Bird_Hunting
  (18 May 2004); chompy bird hat (4,000-kill reward): https://oldschool.runescape.wiki/w/Chompy_bird_hat
- Tai Bwo Wannai Cleanup: https://runescape.wiki/w/Tai_Bwo_Wannai_Cleanup (9 August 2005).
- Tears of Guthix: https://runescape.wiki/w/Tears_of_Guthix (4 May 2005).
- Mage Training Arena: https://runescape.wiki/w/Mage_Training_Arena (4 January 2006).
- Pest Control: https://runescape.wiki/w/Pest_Control (18 April 2006).
- Stronghold of Security: https://runescape.wiki/w/Stronghold_of_Security (4 July 2006).
- Barbarian Assault: https://runescape.wiki/w/Barbarian_Assault (4 January 2007).
- Penguin Hide and Seek: https://runescape.wiki/w/Penguin_Hide_and_Seek (2 September 2008).
- Route documents: rs/2 `skills/agility.md`, `thieving.md`, `fishing.md`, `mining.md`,
  `woodcutting.md`; rs/3 `quests/README.md`; rs/28 `skills/firemaking.md`, `ranged.md`.
