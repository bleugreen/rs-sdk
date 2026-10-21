# Quest timing primitives (measured)

The per-quest documents record raw counts (tiles, dialogue pages, option
clicks, doors, climbs, teleports, rides, trades). This page converts each count
to ticks. Every number labelled **measured** came from a local engine run at
the production tick rate, `NODE_TICKRATE=300` (`fly.toml:26`), driven by the
headless lite client through the SDK (setup: `docs/speedrun/LAB.md`). Each
script under `docs/speedrun/scripts/quest-primitives-*.ts` takes the bot name
as its first argument and prints `RESULT <name> <json>` lines.

The lab ran at 300 ms rather than LAB.md's 100 ms on purpose. Dialogue and
trade timings depend on whether the bot's reply lands before the next tick,
and 300 ms is what the scored account gets in production.

## Two clocks: stock client and server floor

Every observe-then-act step costs one extra tick with the current lite client.
The runner publishes state from inside the PLAYER_INFO handler
(`server/webclient/src/lite/protocol/incoming.ts`). The engine writes PLAYER_INFO
before the tick's NPC info, loc changes, inventories, stats and interface opens
(`server/engine/src/engine/World.ts` `processClientsOut`, then
`NetworkPlayer.encodeOut`). So a page, door or trade screen opened on tick T
reaches the script on T+1, and the reply reaches the server on T+2.

The tables give both figures:

- **stock**: the client as it is today, which is what a run would use now.
- **floor**: a lab copy of the client patched to publish once after each
  inbound batch. This is the server's real limit, and what a fixed client would
  get. The fix is tracked in cairn://p/rs/22.

Where only one figure is given, the primitive involves no reaction, so the
two are the same.

Observed positions are the client's interpolated entity tile
(`server/webclient/src/bot/StateCollector.ts`, `worldX = baseX + (x >> 7)`),
which trails the server by about one tick. Every observed arrival below
therefore includes one tick of observation. Use the numbers as written: they
are click-to-effect as a script sees it.

## Summary table

| Primitive | Provisional | Measured, stock | Measured, floor | Difference (stock vs provisional) | Script |
|---|---|---|---|---|---|
| Dialogue page (continue) | 1 | **2** | 1 | +1 | `quest-primitives-dialogue.ts` |
| Dialogue option click | 1 | **2** | 1 | +1 | `quest-primitives-dialogue.ts` |
| Talk-to an adjacent NPC, click to first page | (not given) | 2-3 | 1 | | `quest-primitives-dialogue.ts` |
| Run, per tile | 0.5 | **0.5** (+1 tick to the first step) | same | 0 | `quest-primitives-movement.ts` |
| Walk, per tile | | 1 | same | | `quest-primitives-movement.ts` |
| Long walk, chained clicks (165 tiles) | 0.5 per tile | **84-85 ticks = 0.51 per tile** | same | +1 tick per walk | `quest-primitives-movement.ts` |
| Long walk, `bot.walkTo` (166 tiles) | 0.5 per tile | 94 ticks = 0.57 per tile | same | +13% | `quest-primitives-movement.ts` |
| Ladder, trapdoor or stairs climb, adjacent | | **1-2** | same | | `quest-primitives-locs.ts` |
| Door, gate or trapdoor open, adjacent | | **2** | 1 (inferred) | | `quest-primitives-locs.ts` |
| Teleport spell | about 5 | **4** | same | -1 | `quest-primitives-teleports.ts` |
| Amulet of glory | about 5 | **6** | 5 (inferred) | +1 | `quest-primitives-teleports.ts` |
| Games necklace | about 5 | **8** | 7 (inferred) | +3 | `quest-primitives-teleports.ts` |
| Ship to the deck (Port Sarim to Karamja, Ardougne to Brimhaven) | | **17-18**, then **4** to get off | about 13 + 3 (inferred) | | `quest-primitives-transport.ts` |
| Trade from an adjacent helper | 1 segment | **9** | **5** | | `quest-primitives-trade.ts` |
| Loc or NPC interaction with `p_delay(n)` | n + 2 | n + 2 (consistent with every delay measured here) | | 0 | see Cutscenes |

The rest of this page gives the detail behind each row.

## 1. Dialogue

This uses the Cook's Assistant start (`quests/quest_cook/scripts/quest_cook.rs2`),
reset between runs with `::setvar cookquest 0`. The bot clicks the instant a new
page is published. Three runs per branch, all identical:

| Branch | Pages + choices | Click to close, stock | Per page, stock | Click to close, floor | Per page, floor |
|---|---|---|---|---|---|
| short (`What's wrong?`) | 6 + 2 | 18-19 | 2 (n=24) | 9 | 1 |
| long (`You don't look very happy`) | 10 + 3 | 28-29 | 2 (n=39) | 14 | 1 |

**Formula (measured).** A conversation of P plain pages and C choices costs
2(P + C) + 2 to 3 ticks from the talk-to click to dialogue closed with the stock
client, and P + C + 1 at the floor. Each `~chatnpc`, `~chatplayer`, `~mesbox` and
`~objbox` page is one `p_pausebutton` (`interface_chat/scripts/chat.rs2`), and
each `~p_choiceN` is one more. Long text auto-splits into several pages
(`split_init(..., 4, ...)`, 4 lines per page), so count the pages the player
actually sees.

**Can several pages advance in one tick? Yes, measured, but not with the stock
client.** The server resumes a paused script inside packet processing
(`server/engine/src/network/game/client/handler/ResumePauseButtonHandler.ts`),
and accepts up to 5 successful user-event packets per tick
(`ClientGameProtCategory.ts:6`, `NetworkPlayer.ts:69,141`). The stock lite client
refuses a second continue until the next page has arrived
(`server/webclient/src/lite/actions.ts`, the `resumedPauseButton` guard). With
that guard lifted in a lab copy (`quest-primitives-dialogue-blind.ts`, which
documents the one-line change):

- a choice click plus 3 blind continues (4 events) landed in **1 tick** (3 of 3
  runs), against 4 ticks at the floor;
- a choice click plus 5 blind continues (6 events) took **2 ticks** (3 of 3), which
  confirms the 5-per-tick cap.

So a client that knows the page count can clear about 5 pages per tick. It must
not send a continue while a choice is pending, because the engine refuses it
(`ResumePauseButtonHandler.ts`). Whether a blind-firing client is acceptable on
the public server is a call for the maintainers. Plan with the stock figures.

## 2. Movement

`quest-primitives-movement.ts`, on the Lumbridge-Draynor road:

- **Run speed: 2 tiles per tick, measured.** A 20-tile run takes 11 ticks from
  click to observed arrival (3 of 3 runs): the first step shows at +2, then 10
  moving ticks. So N tiles cost about ceil(N/2) + 1.
- **Walk speed: 1 tile per tick, measured.** 10 tiles took 11 ticks.
- **Run energy is infinite on this server, measured and read.** Energy stayed at
  100 for all 332 sampled ticks of running. The engine pins it when
  `NODE_INFINITE_RUN` is set (`server/engine/src/engine/entity/Player.ts`
  `updateEnergy`), which defaults to true (`server/engine/src/util/Environment.ts:47`);
  `fly.toml` does not override it.
- **Single-click reach.** The client routes each click itself
  (`clientRoutefinder` defaults to true, `WorldConfig.ts:107`) inside its
  104×104 loaded area. It sends at most 25 turns (`lite/movement.ts`); the server
  keeps 25 waypoints (`PathingEntity.ts:42`) and rejects a path whose start tile
  is more than 104 tiles away (`MoveClickHandler.ts:20`). One click covered 60
  and 70 tiles (measured). The 40-, 50- and 55-tile clicks stopped short or
  didn't move because their destination tiles were blocked, not because of the
  distance. A click beyond the loaded area is clamped to its edge
  (`LiteClient.walkTo`).
- **Long multi-click walks cost nothing extra if clicks are chained, measured.**
  Lumbridge castle courtyard (3222,3218) to Draynor bank (3093,3244) is 129
  tiles in a straight line and about 165 along the route. Re-clicking the
  furthest route tile within 20 tiles, 3 tiles before each leg ends: **84-85
  ticks with 8 clicks**, against an ideal of 83. With `bot.walkTo`: **94 ticks**
  (2 of 2 runs), because its short legs end on odd tiles (20 one-tile ticks).
  Rule: long walks cost 0.5 ticks per route tile, or 0.57 with `bot.walkTo`.
  Count route tiles, not straight-line distance; here the route was 28% longer.

## 3. Doors, gates, trapdoors, ladders and stairs

`quest-primitives-locs.ts`, at Lumbridge castle (kitchen trapdoor at
(3209,3216), cellar ladder, spiral staircase at (3204,3207)), a door at
(3226,3214) and the gate at (3236,3295). All stock client.

| Action | Distance from the loc | Ticks, click to effect | Samples |
|---|---|---|---|
| Trapdoor climb-down | 1 | 1 | 2 |
| Trapdoor climb-down | 4 | 3 | 2 |
| Cellar ladder climb-up | 1 | 2 | 4 |
| Staircase climb-up | 3 | 2 | 2 |
| Staircase climb-up | 6 | 4 | 2 |
| Staircase climb-down (level 1) | 2 | 1 | 4 |
| Trapdoor open | 1 | 2 | 1 |
| Gate open | 0 (standing in the gateway) | 2 | 3 |
| Door open | 4 | 5 | 3 |

**Rules (measured).**

- A climb costs about 1 to 2 ticks plus the run to the loc (ceil(d/2)). Plain
  ladders do `p_delay(0)` and then jump (`ladders+stairs/scripts/ladders.rs2`
  `climb_ladder`). A ladder that offers both up and down asks first
  (`ladder_options`), which adds one choice and a `p_delay(1)`.
- Opening a door or gate costs about 2 ticks plus the run to it. Opening itself
  has no delay (`doors/scripts/doors.rs2` `open_door`); the open state is a loc
  change, which the stock client shows one tick late. Then walk through as
  normal movement. A door that needs no opening (already open, or a
  `open_and_close_door*` proc that walks you through) costs its walk plus any
  `p_delay` in that proc.
- I didn't time a combined open-and-walk-through as one primitive. Count it as
  the open plus the tiles walked.

## 4. Teleports

`quest-primitives-teleports.ts`. Rune costs and levels are in
`skill_magic/configs/magic_spells.dbrow`.

| Teleport | Needs | Click to arrival | Wilderness limit |
|---|---|---|---|
| Varrock, Lumbridge, Falador, Camelot | Magic 25 / 31 / 37 / 45 and runes | **4** (3 samples each; Lumbridge timed in combat) | level 20 |
| Ardougne | Magic 51 and Plague City complete (`%elenaquest` ≥ 30, `teleport.rs2:22-38`) | **4** | level 20 |
| Watchtower | Magic 58 and the Watchtower quest (`%itwatchtower` ≥ 14) | **4**. It lands on the top floor of the Watchtower at (2932,4711, level 2) (`magic_spells.dbrow:114`), so add the climb down to reach Yanille. | level 20 |
| Amulet of glory | charged amulet (4 charges); Edgeville, Karamja, Draynor Village, Al Kharid | **6**: 2 to the choice, 4 to arrival | **level 30** |
| Games necklace | charged necklace (8 uses); Burthorpe games room only (arrived at about (2208,4941)) | **8**: 4 to the choice (it has a `p_delay(1)` first), 4 to arrival | level 20 |
| Ring of dueling | | **does not teleport here**. The obj exists (`enchanted_jewelry.obj`) but no script uses it (read). | |

Notes:

- **Measured:** not blocked in combat. A Lumbridge teleport cast while fighting a
  goblin arrived in 4 ticks (2 of 2). The spell script has no combat check
  (`skill_magic/scripts/spells/teleport.rs2`).
- **Measured:** the wilderness limits. At wilderness level 25 the spell and the
  games necklace were blocked and the glory worked; at level 35 all three were
  blocked. Wilderness level is (z − 3520)/8 + 1 (`wilderness_levels.rs2`).
- **Read:** all teleports share `~player_teleport_normal`, which is an
  animation, `p_delay(1)`, `p_delay(0)` and then the jump
  (`teleport.rs2:54-66`). The jump runs `~post_tele_checks`, which deletes
  Karamja rum, the plague sample, the monkey in a backpack and peer-trial
  items, so quests carrying those must not teleport.
- Jewellery charges and runes are tradeable, so a helper supplies them.

## 5. Transport

`quest-primitives-transport.ts` (route names in the script header). Stock
client, 2 runs per route, identical unless shown. "To deck" runs from the
talk-to click to arrival; ships land you on their deck (level 1), and
"disembark" covers closing the arrival message box (2) plus crossing the
gangplank (2-3).

| Route | Fare | Requirement | Pages + choices | To deck | Disembark | Total |
|---|---|---|---|---|---|---|
| Port Sarim → Karamja (Musa Point), any of the three sailors | 30 coins | | 3 + 1 | 17-18 | 4 | **21-22** |
| Karamja (Musa Point) → Port Sarim, customs officer | 30 coins | searched first; no Karamja rum | 6 + 3 | 27 | 4 | **31** |
| Ardougne → Brimhaven, Captain Barnaby | 30 coins | | 3 + 1 | 18 | 4 | **22** |
| Port Sarim → Entrana, monk of Entrana | free | no weapons or armour in inventory or worn (`monk_of_entrana.rs2:26-50`) | 5 + 1 | 27 | 5 | **32** |
| Gnome glider, Ta Quir Priw (Grand Tree, level 3) → Kar-Hewo (Al Kharid) or Gandius (Karamja) | free | Grand Tree complete (`%grandtree` = 160) | 2 + 1, then a map click | 13 (8 to the map, 5 from map click to arrival) | 0 | **13** |
| Shantay Pass, north to south | Shantay pass (5 coins from Shantay, stackable, tradeable) | | 7 + 1 first time; 3 + 0 once you hold the disclaimer | 20 / 10 | 0 | **20 first time, 10 after** |
| Shantay Pass, south to north | free | | 0 | 2 | 0 | **2** |

Read:

- All the ships use one sailor dialogue (`karamja_sailor_dialogue` in
  `areas/area_port_sarim/scripts/sailors.rs2`) and `~set_sail`
  (`interface_boat/scripts/sail.rs2`), which waits `p_delay(7)`, or 13 for
  Entrana. That is the 9 or 15 ticks measured after the last page.
- The glider only flies to or from Ta Quir Priw (`gnome_glider.rs2:14-19`);
  Lemanto Andra (Varrock) is a valid destination.
- Captain Shanks (Cairn Isle to Khazard Port or Port Sarim) needs Shilo Village,
  a ship ticket (26-45 coins) and `p_delay(9)` or `p_delay(15)`
  (`captain_shanks.rs2`). Not measured.
- **Not in this content (read):** charter ships, magic carpets, canoes and fairy
  rings. No scripts exist for them; `area_lostcity/scripts/fairy_queen.rs2` is
  Lost City dialogue, not a ring network.
- At the floor, each page and choice is 1 tick instead of 2, so a ship costs
  about P + C fewer ticks: Port Sarim to Karamja is about 14 to the deck plus 3.
  This is inferred from the dialogue figures; I didn't rerun ships on the
  patched client.

## 6. Trades

`quest-primitives-trade.ts`, which spawns `quest-primitives-trade-helper.ts` for
the helper. The helper stands next to the scored account and sends the request
first. The scored account then clicks trade back, accepts the offer screen once
the gift is on it and the helper has accepted, and accepts the confirm screen.
The helper offers and accepts the instant each screen opens. That is 3 clicks
for the scored account. There are no delays in the trade scripts
(`interface_trade/scripts/trade.rs2`); adding or removing items resets both
accepts.

| Clients | Scored click to items in inventory | Breakdown (open / helper offer and accept / confirm / done) | Samples |
|---|---|---|---|
| stock, both | **9** | 2 / 3 / 2 / 2 | 4, identical |
| patched, both (floor) | **5** | 1 / 2 / 1 / 1 | 4, identical |

The helper's request and its offer are made while the scored account waits.
The scored account is logged in throughout, so count the full 9 (or 5) per
trade. One trade can carry up to 28 inventory slots of stackables or items.

## 7. Cutscenes

Read: there is no generic cutscene mechanism. "Cutscenes" are scripted
sequences of `cam_*` commands, `p_delay(n)` and dialogue pages, each written in
its quest's script; Monkey Madness even keeps its cutscene stage in a temporary
varp, `mm_cutscene_part`. Count them as follows:

- each `p_delay(n)` inside a running script costs n + 1 ticks; the first one after
  a click costs n + 2 counted from the click;
- each dialogue page or choice inside costs the dialogue figure above;
- camera commands (`cam_moveto`, `cam_lookat`, `cam_reset`) cost nothing.

The measured delays fit this rule. A teleport (`p_delay(1)` + `p_delay(0)`) is 1
+ 2 + 1 = 4 from the click. A ship's `p_delay(7)` is 9 after the last page
(1 + 8). Entrana's `p_delay(13)` is 15. The glider's `p_delay(3)` is 5 from the
map click.

## 8. Logout

`quest-primitives-logout.ts`, phases `out` and `in`.

- **Measured:** a logout click outside combat ended the session in the same tick
  (no further tick was published). Within 16 ticks of combat it is refused with
  "You can't log out until 10 seconds after the end of combat."
  (`login_logout/logout.rs2:27-28`, measured). It is also refused in a duel or
  on the gnomeball pitch, and it waits while the player is delayed or holds a
  non-discardable queued script (`World.ts` `processLogouts`).
- **Measured:** after logging back in, the account was on the same tile. A
  permanent quest varp kept its value (`cookquest` 1 stayed 1), and a temporary
  one reset (`regicide_still_total` 5 became 0).
- **Read:** the save keeps position, stats, permanent-scope varps and
  permanent-scope inventories (`Player.ts` `save`); timers and queues are not
  saved. A varp is temporary unless its config says `scope=perm`
  (`VarPlayerType.ts:83`). 16 of the 159 quest varps are temporary, and these
  reset on logout:
  - Nature Spirit: `ghast_delay`, `mortmyre`
  - Gertrude's Cat: `follower_uid`
  - Monkey Madness: `mm_cutscene_part`, `varp_369`, `varp_370`, `mm_guards_cooldown`
  - Shades of Mort'ton: `mortton_current_shade`, `temple_sanctity`,
    `temple_repaired_p`, `temple_resources_p`, `temple_sanctity_p`
  - Regicide: `regicide_still_total`, `regicide_still_settings`
  - Troll Romance: `wearing_sled`
  - The Fremennik Trials: `draugen_butterfly_uid`

  A quest step that depends on one of these (the Regicide still, the Mort'ton
  temple, the Monkey Madness cutscene) is not logout-safe. Everything else
  persists. There are no instances in this content to reset.
- **Conclusion:** the scored account can log out while a helper prepares (for
  example, between the gathering and the trade) and pay nothing for that time,
  as long as it doesn't log out in the middle of a temporary-varp step.
  Playtime counts only ticks logged in (`World.ts`, see `CONVENTIONS.md`).

## Not measured

- A combined door open-and-walk-through as one timed primitive (count it as the
  open plus the tiles).
- Ships, doors and teleports on the patched client (floor figures marked
  inferred above are the stock figure minus one tick per reaction step).
- Captain Shanks's Cairn Isle ship (needs Shilo Village).
- Whether crossing a gangplank while the arrival message box is still open saves
  the 2-tick dismiss.
