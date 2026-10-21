# In-game observation of top and fast-climbing accounts

Observed 2026-10-21, 08:09-09:53 UTC in game (about 75 minutes logged in
across four legs) plus 60 minutes of position tracking without logging in.
Correction to the brief: the server is LostCity revision 289 (January 2005
client), not May 2004.

## Summary

- **No fast climber was in game while we watched.** No stun* account was
  online at any point from 08:55 to 10:14 UTC (`/playerpositions`, polled every
  3 s for an hour, plus spot checks). The hiscore sibling (rs/69) saw no fast
  climber on the boards over the same window. The stun* runs that matter
  (stunagile, stunfast, stunlord, stunmaxing) could not be watched.
- The online accounts of the target families were all **already maxed and
  not training**. `Asukalabs`, `Soko`, `Sokobot` and `Sokogp2` sat on one tile
  for a full hour (parked, logged in). `Nickai` (1,881) worked the Brimhaven
  Agility Arena for 25 minutes, then hopped between Catherby, Port Sarim,
  Karamja, Brimhaven, Draynor, Seers' and Rellekka with stops of under
  2 minutes: quest or clue running, not skilling.
- Fleets that are training use our methods or slower ones. The largest live
  thieving fleet (`Z*`, about 25 accounts at combat 100-113) pickpockets the
  Knights of Ardougne, which is our route. Miners and woodcutters work
  Barbarian Village, Varrock SW and the Seers' yews, which are slower than our
  Ardougne-zoo iron and willow plans.
- **No technique seen in game beats our route.** The one transport-style
  finding is the public `/playerpositions` feed itself: it gives every online
  player's tile, so the next observation should start from it (section
  "Next time").

## Setup

- **Account**: `cairn_obs1`, a throwaway created on first login on 2026-10-21
  (it skipped the tutorial via the RuneScape Guide and has no stats, items or
  coins). Credentials live in `bots/cairn_obs1/bot.env` (gitignored) and in
  `~/.cache/rs-observer/cairn_obs1.env` on the executor that runs it
  (`fedora`). It logs out at the end of every leg.
- **Script**: `speedrun/tools/observe.ts` (bun). Runs the lite client in its
  own process and serves the SDK over a loopback socket that speaks the
  gateway's `sdk_*` messages, so `BotActions.walkTo` (pathfinding, doors)
  works unchanged while the raw player table is readable directly.
- **No-interaction guard**: every action the SDK sends passes `allowAction`.
  Allowed: walking, doors/gates/stairs/ladders, dialogue continue, the
  character-design screen, the tutorial guide (first login only) and the
  logout button. Refused before it reaches the client: player ops, other npc
  ops, trade, chat and PMs, pickups, spells, item use, bank, shop. The tour
  never stands on a resource and never follows anyone.
- **Hiscores**: each new name seen is looked up once per 30 minutes on
  `/hiscores/player/<name>?profile=main` (1 request per second, cached).
  The "time" column is the account's playtime in ticks when it reached that
  level (the span `title`); for Overall it is the playtime at the current total.
- **Online roster**: `https://rs-sdk-demo.fly.dev/status` lists every bot
  connected through the public gateway, with `inGame` and status. Bots on a
  private gateway do not appear there (349 there against 1,631 online).
- **Positions**: `https://rs-sdk-demo.fly.dev/playerpositions` (public JSON,
  `{x, z, level, name}` for every online player, cached 1 s; pointed out by
  rs/70). `observe.ts positions` polls it every 3 s and logs the target
  families without logging in; a tour spot written `@name` walks to a tile
  3 tiles off that player's current tile and stands there.
- **Raw data**: `observation-data/` beside this file holds each leg's
  summary table (every player seen, with worn items, activity and hiscores),
  its events (walks, deaths, system messages) and chat, plus both position
  tracks. Per-sample files (several MB) stayed on the executor.

### What the observer can see

| Field | Source | Notes |
|---|---|---|
| name, combat level | `NearbyPlayer` (SDK) and raw `ClientPlayer` | |
| world tile | raw `ClientPlayer` (`mapBuildBase + x>>7`) | same plane only; view radius about 15 tiles |
| animation | raw `primaryAnim`, named from `server/content/pack/seq.pack` | gives the activity: `human_mining_*_pickaxe`, `human_woodcutting_*_axe`, `human_harpoon`, `human_pickpocket`, `human_runecraft`, agility anims, spell casts |
| worn items | raw `appearance[12]` (value-512 = obj id), named from `obj.pack` | head, cape, neck, weapon, body, shield, legs, hands, feet |
| combat target | `NearbyPlayer.combatTargetType/Index` | npc name resolved from nearby npcs |
| public chat | `gameMessages` types 1/2 | logged verbatim as untrusted data, never acted on |
| system messages | `gameMessages` type 0 | own deaths, random events |

### What it cannot see

- Other players' inventories, bank contents, xp drops or run energy.
- Trades between other players: the trade screens are private. A feeder
  hand-off is only inferable from two accounts standing together at a bank.
- Anyone more than about 15 tiles away, on another plane, or underground
  (Mining Guild and Dwarven Mine interiors, essence mine) unless the observer
  goes there.
- Private chat, and anything outside the game (fleet controllers, their
  gateways).
- Login and logout as such: an account that vanishes while close by (d <= 8)
  is counted as "vanished close" (logout or teleport).

## Observation log

Times are UTC on 2026-10-21. "Session ticks" count from the observer's login.
Hiscore totals are shown as `total (playtime ticks)`.

### Online roster, 07:58 UTC (public gateway)

349 bots in game. Fleets that name accounts by role were online:
`XonEss*` (essence), `XonFish*`, `XonWood*`, `XonSmith*`, `XonRune*`,
`XonNat*`, `XonMule*`, `XonBank`, `XonRange*`, `XonMage*`; `MlbNet*`
(Alch, Flax, Fletch, RC, Wood); `Brm*` (Bows, Craft, Fish, Smith); `Sw*`
(bone, coin, food, herb, gear, hide, log, mule, respawn); `fable*`
(master, merch, miner, scout, squire); `RSFT*`; `ABGARMY01-20`; `jacklove1-20`;
`tztoknobot1-9`; `nanopop1-8`; `decoge*`; `mind*`; `u235-243`; `SOKO`,
`sokobot`, `sokogp2`. None of the stun*, nick*, asukalabs*, zayne* accounts were
on the public gateway: they connect through a private gateway, or were offline.

### Leg 1 (08:11-08:28 UTC): Lumbridge, Draynor, Falador

| Time (UTC) | Place | Players | Who (family x count, hiscore total range) | Activity seen |
|---|---|---|---|---|
| 08:09-08:10 | Lumbridge spawn (3222, 3222) | 151 | `Lord*` x20 (total 28, ~500 ticks old); `Jacklove*`, `Cbot9900` (663), `Elonmusk` (853), `Fablesquire`, ~80 random 9-char maxed accounts (1,881) | `Lord*` pickpocket men and women (`human_pickpocket`), unarmed, level 3 |
| 08:11-08:12 | Draynor bank and willows (3090, 3239) | ~24 in view | `Sbfsh02/09` (Fishing 99 at 122,111 / 142,922 ticks), `Ltfsh04/05` (Fishing 99 at 103,104 / 66,585), `Sbmag05` (1,399), `Dotsbot*`, `Xonrunetwo` (RC 89), `Xonnatone` | standing at the bank; none animating in the window |
| 08:12 | the observer died at Draynor (tick ~190) and respawned at Lumbridge; the rest of the Draynor dwell sampled Lumbridge | | | cause not logged (the script now logs system messages and walks back) |
| 08:15-08:18 | Falador east bank (3010, 3359) | 51 | `Tygem*` x10 (621-1,072), `Dotsbot*` x7 (566-1,595), `Tyrun*` x4, `Tywalk03`, `Ltfsh11`, `Ltmag02`, `Runeprobe` (1,138), a group of celebrity-named alts (`Joerogan`, `Makhachev`, `Seanomalley`, ... all total 267-274) | banking traffic; nobody gathering in view |
| 08:19-08:22 | Mining Guild entrance, surface (3022, 3337) | 50 | `Dotsbot*` x17 (566-1,505), `Cx<hex>` x13 (1,010-1,067), `Tyrun*` x3, `Goo023` (1,512), `Mules`, `Mulex` | walking in and out of the guild ladder; mining itself is underground |
| 08:22 | game connection dropped (hiscore site timed out at the same moment); tour ended | | | |

### Leg 2 (08:31-08:51 UTC): Draynor again, Falador west, Barbarian Village, Edgeville, Varrock

| Time (UTC) | Place | Players | Who (family x count, total@playtime ticks) | Activity seen |
|---|---|---|---|---|
| 08:32-08:35 | Draynor bank and willows | 134 | the random 9-char maxed group x81 (1,881 @ 16-19M) passing through, `Dotsbot*` x10 (1,286-1,521 @ ~2.7M), `Tygem*`, `Ltbw*`, `Steve*` | one low account (`Nxiggbdkvzj`, total 221) net fishing, cooking and lighting fires; nobody else working |
| 08:35-08:38 | Falador west bank | 50 | `Tygem*` x5, `Dotsbot*` x5, `Steve*` x3, `Ltfsh*`, `Aura*` x4 (632-634), `Sw*` support accounts (`Swherb`, `Swlog`, `Swmule1`, `Swrespawn1`) | banking only |
| 08:39-08:41 | Barbarian Village, fishing spot side | 63 | `Cx<hex>` x17 (1,040-1,061 @ ~7.8M), `Dotsbot*` x14, the `King/Queen/Mayor/Baron*` family x8 (131-345) | mining at the nearby rocks: `Dotsbot*` (silverlight, ghostspeak amulet), `Sbbw08`, `Ltbw05`, `Ltmag06`; no one fly fishing in view |
| 08:42-08:44 | Edgeville bank | 40 | `Lord*` x14 (pickpocketing men), `Abgarmy*` x6 (1,055-1,101 @ ~7.7M), `Ltbw*`, `Ltmag*`, `Sbbw*`, `Jackpoo1` | yew chopping (`Ltmag05` with a staff of air, `Ltbw03`, `Redactedyw5`) |
| 08:45-08:48 | Varrock west bank / Grand Exchange | 115 | `Cx<hex>` x16, `Tygem*` x11, `Dotsbot*` x11, **`Bankroll*` x8 (total 83-92 @ 8-10k: new accounts parked at the GE)**, `Bennettbot*`, `Xon*` (Smith, Mage), our own `Cairn H*` and `Cairn Mule1` | `Mindborin` and `Eco8d5939a1` pickpocketing guards; smithing animations at the Varrock west anvils (`Xonsmithone`, `Bennettbot`) |
| 08:48-08:51 | Varrock south-west mine | 11 | `Bennettbot*` x3 (bronze and mithril pickaxes), `Decoge*` x2, `Mikutest8635` | mining (clay/tin/iron rocks) |

### Leg 3 (08:55-09:13 UTC): westward over White Wolf Mountain, Seers'

| Time (UTC) | Place | Players | Who | Activity seen |
|---|---|---|---|---|
| 08:56-09:04 | White Wolf Mountain pass (2844-2861, 3481-3505) | | | the observer died five times to the wolves ("Oh dear you are dead!"), respawning at Lumbridge; Catherby (shore, bank, `@Asukalabs`) was never reached. The game's default auto-retaliate struck back at a wolf once (an Attack level); it never touched a player |
| 09:07-09:13 | Seers' Village bank | 50 | `Abgarmy*` x8, `Cx<hex>` x7, `Goo*` x7 (up to 1,525 @ 21.9M), `Tygem*` x3, `Yew*` x2, `MlbNet*` (Alch, Fletch, Wood3) | banking only |
| 09:13 | game connection dropped again (second server-side drop of the night) | | | |

### Leg 4 (09:34-09:53 UTC): Ardougne, Fishing Guild, magic trees, agility courses

| Time (UTC) | Place | Players | Who | Activity seen |
|---|---|---|---|---|
| 09:35-09:38 | East Ardougne market | 141 | **`Z*` fleet x~25** (`Zkansha`, `Zkoto`, `Zluffyfan`, `Zsekiwake`, `Zrui`, ...; combat 100-113, bronze scimitars; totals 470-509 @ 47k-2.7M), `Swcoin*` x3, `Abgarmy09/20`, `Cx<hex>` x5, `Mind*` x3 | **pickpocketing Knights of Ardougne** (`human_pickpocket`, the knight as combat target after failures) with occasional `human_pickuptable` (stall); 37-75 pickpocket samples each in 150 s |
| 09:38-09:41 | East Ardougne north bank | 7 | `Cx<hex>` x3, `Goo*` x2, `Hoplite` (1,881) | banking |
| 09:42-09:44 | Fishing Guild gate (outside) | 8 | `Dotsbot*` x4 (up to 1,595), `Jacklove19`, `Swcoin5` | walking in and out; fishing inside the guild is out of view |
| 09:44-09:47 | magic and yew trees south of Seers' | 26 | **`Yew*` x8** (total ~408 @ 4.4-5.1M), `Cx<hex>` x4 (staff of fire), `Sbfsh*`, `Ltrc*`, `Ltmag01`, `Sbbw10`, `Xonwoodone`, our `Cairn H12/H13` | woodcutting; the `Yew*` accounts alternate chopping with **fletching in place** (knife animation between chops) |
| 09:48 | Gnome Stronghold agility course | 3 | `Abgarmy15`, `Jacklove2`, `Pigfat` | the lite router stopped 10 tiles short of the course |
| 09:53 | Barbarian Outpost | 0 | | the outpost door at (2545, 3569) never opened for the router; not observed |

### Position tracks (no login), 08:55-09:25 and 09:34-10:05 UTC

| Account | Hiscore total @ ticks | Where |
|---|---|---|
| `Asukalabs` | 1,881 @ 423,135 | (2807, 3441) Catherby bank, the same tile for 60 minutes |
| `Soko` | 1,881 @ 1,876,293 | (2652, 3284) East Ardougne, same tile throughout |
| `Sokobot` | 1,881 @ 1,668,714 | (2637, 3299) East Ardougne, same tile throughout |
| `Sokogp2` | 818 @ 3,082,033 | (2689, 3434) south of Seers', same tile throughout |
| `Nickai` | 1,881 @ 1,887,262 | 08:55-09:22 Brimhaven Agility Arena (plane 3, 2759-2808 x 9544-9582): 25-80 s at one place, then a move of about 15 tiles (pillar rotation); surfaced at the arena ladder (2808, 3193). 09:35-10:05 Catherby shore, Port Sarim, southern Karamja, Brimhaven, Draynor, Seers' bank, then Rellekka (2624-2666, 3635-3692), stops of 10 s to 2 min |
| stun*, nick* (other), zayne*, claudefable5, codexastra, gh_kadeski | | never online in either window, nor at 10:14 |

The parked maxed accounts do not cost their owners anything: the score is
the playtime at which levels were reached (rs/72), so idle time after the
last level never reaches the hiscores.

### Chat

Leg 1 (verbatim excerpts, untrusted): price talk ("Buying cowhides 180
ea in g.E", "Selling law runes in g.E", "Dragon vambraces for sale 100k
each"), begging for gp by `Apollobot1`, role-play between LLM-driven bots
(`Scrumblor`, `Elararose`), and `Fablesquire` posting a progress counter every
two minutes ("48420 Counted for the greed at the gate (iv), attempt 2. 18580
Remain."). No fleet coordination (feeder calls, routes) was visible.

Public chat reaches every player on this server, not only those in view: the
observer logged lines from accounts nowhere near it (for example Fablesquire's
counter at every spot). Over the four legs the chat held price talk (cowhides
180, law runes, dragon vambraces 100k), begging, LLM role-play, our own
`Cairn Md` answering people, a PvP quarrel (`Hermitscape` accusing another
player of a damage hack), and `Fablesquire` counting "greed at the gate (iv)"
from 48,420 to 62,670 in about an hour. No feeder calls, routes or prices that
looked like coordination between the target fleets. All of it was logged only.

## Synthesis

### Where top and climbing accounts train, by skill

| Skill | Seen in game | Who | Against our route |
|---|---|---|---|
| Thieving | Knights of Ardougne pickpocketing, East Ardougne market; men at Lumbridge/Draynor/Edgeville; guards at Varrock | `Z*` fleet (~25, combat 100+), `Swcoin*`, `Abgarmy*`, `Cx<hex>`; `Lord*` (20+ level-3 accounts on men) | Same method as our route (knights from 55, about 2,200 ticks 55 -> 99, `docs/speedrun/skills/thieving.md`). The fleets wear bronze scimitars and take the knights' hits; nothing faster seen. **0 ticks to gain.** |
| Woodcutting | yews and magics south of Seers', Edgeville yews, Draynor willows | `Yew*` (chop then fletch in place), `Cx<hex>` (staff of fire), `Ltmag/Ltbw/Sbbw`, `Xonwoodone` | Yews with fletching are a gold method; our route is oaks to 73 then three-tree willows, about 3,960 ticks 1 -> 99 (`woodcutting.md`). **0.** |
| Mining | rocks by Barbarian Village, Varrock SW mine; Mining Guild traffic (inside not visible) | `Dotsbot*`, `Sbbw08`, `Ltbw05`, `Ltmag06`, `Bennettbot*`, `Decoge*` | Our route mines Ardougne-zoo iron at 3.00 ticks per ore with the knife starter (`mining.md`); none of these spots or cadences beats it. **0.** |
| Fishing | essentially nothing in view (one low account netting at Draynor); `Dotsbot*` entering the Fishing Guild | `Sbfsh*`, `Ltfsh*` (Fishing 99 at 66,585-142,922 ticks), `Dotsbot*` | Their 99 times are 13-28 times our 5,120-tick plan (`fishing.md`). **0.** |
| Agility | Brimhaven Agility Arena (Nickai, maxed); no one on the Gnome course in view; Barbarian and Wilderness courses not reached | `Nickai` | The arena is already priced in `agility.md`: tickets at most about 2.9 base xp per tick against 6.1-7.4 on the Wilderness course; it could matter only below 52 on a no-quest route (not measured). **0 on the planned route.** |
| Combat, Prayer, Magic, Runecraft | not observed in training; mage gear on chatters at the GE | | stun*'s last session (the real target) was not online. |

### Fleet patterns visible in game

- **Role-named fleets**: `Xon*` (Ess, Fish, Wood, Smith, Rune, Nat, Mule, Bank),
  `Sw*` (bone, coin, food, herb, gear, hide, log, mule, respawn), `MlbNet*`,
  `Brm*`. Their names give away a feeder economy (essence, natures, food, coin
  mules), but no hand-off was seen and their skill totals are low (129-480):
  these are supply chains for gold or long-term mains, not speed runs.
- **Bank parking**: 8 new `Bankroll*` accounts (total ~90, 8-10k ticks) and our
  own `Cairn H*`/`Cairn Mule1` stood at Varrock west bank, where the Grand
  Exchange is. A pre-staged mule standing at the trade point is the only
  feeder pattern visible from outside, and we already use it.
- **Swarm thieving at the spawn**: 20+ `Lord*` level-3 accounts pickpocket men
  around Lumbridge, Draynor and Edgeville (total 28 each, about 500 ticks old):
  a fresh-account farm, irrelevant to the scored run.
- **Maxed groups walking together**: about 80 maxed accounts with random
  9-character names (1,881 @ 16-19M ticks) wearing nothing moved as one group
  through Lumbridge and Draynor, and `Cx<hex>` (13-17 per spot, 1,010-1,230)
  travelled the Falador/Varrock/Barbarian Village/Ardougne banks in packs.
  Neither family is fast.

### Techniques we do not use

None with a positive tick estimate came out of the in-game watch. The
candidates and why they do not move our route:

| Seen | Estimate against our route | Why |
|---|---|---|
| Brimhaven Agility Arena (Nickai) | 0 on the quest route; unmeasured below 52 | `agility.md` prices tickets at <= 2.9 base/tick; the Wilderness course gives 6.1-7.4 above 52 |
| Chop-and-fletch yews (`Yew*`) | negative for xp | It earns gold; willows from three-tree tiles are our xp-optimal band |
| Knights pickpocketing with stall steals in between (`Z*`) | 0 | Same target as ours; stall steals are their gold side, and our blind once-per-tick click already holds the 2-tick success cadence |
| Public `/playerpositions` | not a training technique | It is the better observation tool: locate the stun* accounts the moment they log in instead of touring |

The gap that matters, the stun* family's ~18,000-tick combat, Agility,
Thieving and Runecraft session and `stunagile`'s Agility 99 at 6,772 ticks,
could not be watched: those accounts were offline all night.

## Limits

- **The accounts that matter were offline.** Everything about stun*,
  stunagile, stunfast, stunlord, stunmaxing and nickmax here comes from the
  hiscores, not from watching.
- **Places not observed**: Catherby (the White Wolf Mountain pass killed the
  level-3 observer five times), Karamja and Brimhaven (boat fare), the
  Wilderness course (player killers, and the observer must never fight),
  Al Kharid, the essence mine, the Barbarian Outpost (door did not open for
  the router), the Gnome course (router stopped 10 tiles short), and every
  underground or guild interior (Mining Guild, Dwarven Mine, Fishing Guild).
- **Invisible by design**: inventories, trades between other players, xp
  drops, private chat; the view radius is about 15 tiles on one plane.
- **Data quality**: the observer died once at Draynor in leg 1 (cause not
  logged then) and spent most of that dwell at Lumbridge; that leg's Draynor
  table mixes in the Lumbridge crowd (the script now counts samples only
  within 15 tiles of the spot). The game connection dropped twice server-side
  (08:22 and 09:13 UTC), cutting leg 1 and leg 3 short.
- **Hiscore times** are the playtime at which each level was reached (rs/72),
  so they cannot show a run in progress until the account logs out.

## Next time

1. Run `bun speedrun/tools/observe.ts positions --min 120` (no login) and wait
   for a stun* or nickmax name to appear.
2. When one does, run the tour with `--spots @<name>` (and repeat it as they
   move) to watch their animation, worn items and bank trips from a few tiles
   away. Do not route over White Wolf Mountain; use the west-side spots, or
   reach Catherby from Seers'.
3. Consider adding the auto-retaliate toggle to the observer's allowlist and
   switching it off at login, so a level-3 observer never swings back at
   anything.
