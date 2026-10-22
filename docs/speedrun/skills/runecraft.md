# Runecraft: fastest route to 99

Scripts: [`runecraft-cycle.ts`](../scripts/runecraft-cycle.ts) (the craft-plus-trade
cycle with two bots: stock, tuned and robust schedules, and the helpers-outside
variant), [`runecraft-probe.ts`](../scripts/runecraft-probe.ts) (altar-room
geometry), [`runecraft-model.ts`](../scripts/runecraft-model.ts) (route model),
[`runecraft-lib.ts`](../scripts/runecraft-lib.ts) (multi-bot helpers),
[`runecraft-lab.sh`](../scripts/runecraft-lab.sh) (the lab in one batch; takes a
comma-separated bot list and logs the bots in in that order). Lab:
[../LAB.md](../LAB.md), runecraft port block (WEB_PORT 9260, WEB_MANAGEMENT_PORT
9261, HISCORES_WEB_PORT 9262, NODE_PORT 43960, AGENT_PORT 8160). Labels follow
[README.md](README.md#labels). Every cadence quoted as a headline was measured at
`NODE_TICKRATE=300`; the 100 ms runs were exploration only (section 6 says why
they are not usable for blind schedules).

**Host.** The 300 ms batches ran on the Mac executor `local`, which main measured at load 11-18
on 16 cores that night (cairn://p/rs/main, 00:36). Read the measured cycles as a **busy host's
figures, a few percent pessimistic**. The tuned 7-tick cycle is a blind schedule, so a loaded
host shows up as missed cycles (the one 14-tick gap in section 8 may be that), not as a
slower cycle. rs/26 closed without a single correction factor; `docs/speedrun/LAB.md` on main (its host-latency table) names bbs the reference host and reads the Mac's figures as pessimistic, so no factor is applied.

**Client.** Every number here was taken on the headless lite client against a local lab engine,
where a reaction lands on the next tick. The scored run drives the browser webclient against the
demo, where each reaction to observed state costs 1-2 more ticks through the SDK relay from home
and about 0.15 from Ashburn (rs/2; `docs/speedrun/LAB.md` on main, "Which client a number was
taken on" and the host-latency table under "Running several labs on one machine"). **The tuned
7-tick cycle has no reactions**: its four packets (trade on T+5, accept on T+6, confirm and craft
on T+7, section 4) go out on predicted ticks. So it does not pay the relay's extra ticks per
reaction, but every packet must land on its tick, and the demo's relay latency of 2-3 ticks
(LAB.md table) would break it. It runs as the in-page `rc-cycle` program (cairn://p/rs/131,
`tick-programs.md`), measured in a browser tab at 7 tuned and 8 robust, 30 of 30 each; a
tuned turn on which the scored account turns out to be handled first finishes at 8 rather
than losing the trade. Reacting to published state instead is the stock
SDK's 15-tick cycle (measured). Totals are not re-derived for the webclient.

## 1. Recommendation

The scored account stands next to the altar inside the altar room and never
leaves it. A helper standing beside it trades in 27 rune essence, the scored
account crafts all 27 in one click, and the next helper trades again. With the
scored account clicking on a fixed tick schedule (section 4), one craft plus one
trade takes **7 ticks** (measured at 300 ms: 20 of 20 cycles at law 99, 20 of 20
at law 54, 8 of 8 at air 1, 13 of 14 at nature 44). That is **36.6 base xp per
tick at the law altar and 34.7 at the nature altar**. The stock SDK, reacting to
published state, takes 15 ticks (measured, 10 of 10).

Route: **air altar 1 -> 44 (7 crafts), then the nature altar 44 -> 99 (161
crafts): 168 crafts, 4,536 essence, about 1,180 ticks of crafting**, plus about
150 ticks of travel (inferred), so **about 1,330 ticks from level 1**. No quest
gives Runecraft xp, so the post-quest figure is the same.

The law altar (9.5 base per essence against nature's 9.0) is only better if the
scored account completes Troll Stronghold **and** every helper that hands over
essence inside the room does too. The law talisman is untradeable and comes only
from that quest (section 4). Then air 1 -> 54 and law 54 -> 99 is 162 crafts and
about 1,134 ticks of crafting, roughly 40 ticks better than the nature route
after travel (inferred). Without law-capable helpers, the scored account has to
leave the room for every trade (32 ticks per cycle, measured), and law is far
worse than nature.

### Summary row

rs/2's columns for the Item-fed skills section of `docs/speedrun/skills/README.md`; column 5
is "with interleaving (net)", n/a where nothing is absorbable.

| Skill | Headline method | Start level (on-route quests) | Ticks to 99, normal | Ticks to 99, with interleaving (net) | Basis | Helper supplies | Document |
|---|---|---|---|---|---|---|---|
| Runecraft | craft in the altar room with a helper trading 27 essence per 7-tick cycle: air altar 1-44, nature altar 44-99 | 1 (no quest gives Runecraft; [quests README](../quests/README.md) section 4) | ~1,330 (~1,180 crafting + ~150 travel) | n/a | measured cycle, inferred totals; busy host | 4,536 rune essence, air and nature talismans, charged glory | runecraft.md |

## 2. Route by level band

Cycle times are measured at 300 ms (`runecraft-cycle.ts --mode=tuned`, 27 essence
per trade). Craft counts and band ticks come from `runecraft-model.ts` (inferred
from the measured cycle and the engine's level table).

| Band | Method | Location (room tile; ruins outside) | Unlock | Base xp / essence (read) | Essence / craft | Ticks / craft (measured) | Base xp / tick | Crafts | Ticks for band |
|---|---|---|---|---|---|---|---|---|---|
| 1-44 | Air altar, helper in the room | altar (2843,4833), stand at (2844,4832); ruins (2984,3291) south of Falador | air talisman (tradeable) | 5.0 | 27 | 7 (8 of 8; a level-up every craft) | 19.3 (measured) | 7 | 49 |
| 44-99 | Nature altar, helper in the room | altar (2399,4840), stand at (2400,4839); ruins (2868,3018), Karamja | Runecraft 44, nature talisman (tradeable) | 9.0 | 27 | 7 (13 of 14) | 34.7 at 7 ticks; 32.4 measured over the run with its one 14 | 161 | 1,127 |
| (alt.) 54-99 | Law altar, helper in the room | altar (2463,4831), stand at (2464,4830); ruins (2857,3380), Entrana | Runecraft 54, law talisman (Troll Stronghold), for the scored account **and every giver** | 9.5 | 27 | 7 (55 of 55, levels 54 and 99) | 36.64 (measured) | 149 | 1,043 |

Totals (crafting only; travel is in section 6):

| Route | Crafts | Essence | Ticks, tuned (7) | Ticks, robust (8) | Ticks, stock (15) |
|---|---|---|---|---|---|
| **Air 1-44, nature 44-99** | 168 | 4,536 | **1,176** | 1,344 | 2,520 |
| Air 1-54, law 54-99 (Troll Stronghold) | 162 | 4,374 | 1,134 | 1,296 | 2,430 |
| Air 1-44, nature 44-54, law 54-99 | 160 | 4,320 | 1,120 | 1,280 | 2,400 |
| Air 1-20, body 20-44, nature 44-99 | 166 | 4,482 | 1,162 | 1,328 | 2,490 |
| Air 1-99 | 296 | 7,992 | 2,072 | 2,368 | 4,440 |
| Helpers outside the room, law 54-99 (stock, 26 per trade, 32 ticks) | 155 | 4,030 | 4,960 | | |
| Helpers outside the room, nature 44-99 (stock, 26 per trade, 25 ticks) | 168 | 4,368 | 4,200 | | |

The low band hardly matters: 1 -> 44 is 847 base xp, 2% of the total. Seven air
crafts take 49 ticks. Any altar change costs more in travel than it saves (body
saves 2 crafts, 14 ticks). Pick whichever low altar the route already passes;
air is next to Falador and Port Sarim.

Nature to law at 54 saves 56 ticks of crafting (inferred: 1,127 against 28 + 1,043)
but costs about 180 ticks of travel from Karamja to Entrana (inferred). So go to
law directly from the low altar or not at all.

## 3. Quest xp

No quest awards Runecraft xp. The only `stat_advance(runecraft, ...)` outside the
skill is the staff cheat `cheat_maxme.rs2:24` (read). Legends' Quest does not
offer Runecraft (`docs/speedrun/quests/legends.md`, rs/3 branch). The xp lamp can
select Runecraft (`xplamp.rs2:16`), but lamps come from random events and cannot
be planned. **Ticks from the on-route post-quest level = ticks from level 1.**

Quests that matter for access (read):

- **Troll Stronghold** gives the only law talisman (`quest_troll.rs2:368`). Dunstan
  replaces a lost one after the quest (`death_smithy.rs2:104-106`). It is a
  candidate on the quest-points route (troll chain, cairn://p/rs/18,
  `docs/speedrun/quests/quest_points.md` on the rs/3 branch).
- **Rune Mysteries** gates the essence-mine teleport (`essence_mine.rs2:2-5`).
  That matters for the helpers who mine essence, not for the scored account. The
  altar scripts check no quest.

## 4. Mechanics

### Access and essence rules (read)

| Altar | Level | Base xp / essence | Entry | Status here |
|---|---|---|---|---|
| Air | 1 | 5.0 | air talisman on the ruins at (2984,3291) | open; altar 3 tiles from the entry |
| Mind | 2 | 5.5 | ruins (2981,3513), north of Falador | open; altar 11 tiles from the entry |
| Water | 5 | 6.0 | ruins (3184,3164), Lumbridge swamp | open; 10 tiles |
| Earth | 9 | 6.5 | ruins (3305,3473), east of Varrock | open; 10 tiles |
| Fire | 14 | 7.0 | ruins (3312,3254), north of Al Kharid | open; 11 tiles |
| Body | 20 | 7.5 | ruins (3052,3444), south of Edgeville | open; 7 tiles |
| Cosmic | 27 | 8.0 | ruins (3175,9496), the Zanaris map square | members; Zanaris needs Lost City (not traced here); the altar is out of view from the entry |
| Chaos | 35 | 8.5 | ruins (3059,3590), Wilderness level 9 | members; the room is a multi-level maze (entry on level 3) |
| Nature | 44 | 9.0 | ruins (2868,3018), Karamja | members; altar 5 tiles from the entry |
| Law | 54 | 9.5 | ruins (2857,3380), Entrana | members; law talisman only from Troll Stronghold, untradeable; altar 12 tiles from the entry |
| Death | 65 | 10.0 | none | **not reachable**: `deathtemple_ruined` has no `rc_ruins` category or `rune_type` param (`runecraft.loc:284-289`), and the row's enter coord is a placeholder in Lumbridge (`runecraft.dbrow:151-162`) |
| Soul, blood | | | none | no `rune_type` and no dbrow (`runecraft.loc:291-303,378-395`) |

Levels, xp and coordinates are from `runecraft.dbrow`. Room distances were measured
with `runecraft-probe.ts` (100 ms; geometry does not depend on tick rate).

- **Entering** is `oplocu` of a matching talisman on the ruins: a `p_delay(1)` and a
  teleport into the room (`runecraft.rs2:19-45`). There are no tiaras and no
  essence pouches in this content (no such objs). Leaving is the exit portal, a
  teleport with no delay (`runecraft.rs2:1-9`).
- **Essence type.** The altar accepts only `blankrune`, "Rune essence"
  (`runecraft.rs2:12-13,68`; `ores.obj:1`). There is no pure essence. Noted essence
  is not `blankrune` and cannot be crafted.
- **One craft converts everything held.** `inv_total(inv, blankrune)` essence
  becomes runes. The xp is the essence count times the row's xp, one
  `stat_advance` per craft. Then the script ends in `p_delay(3)`
  (`runecraft.rs2:68-99`). The rune multiplier (`multiplier`) changes the runes
  made, not the xp.
- **Helpers can enter too**, with their own talisman. Air and nature talismans are
  tradeable (`runecraft.obj`): air from Duke Horacio and goblins
  (`duke_horacio.rs2:35`, `goblin.rs2:29`), nature from the shared rare table
  (`shared_droptables.rs2:69-74`). The law talisman is `tradeable=no`
  (`runecraft.obj:173`), so every law-room helper needs its own Troll Stronghold.
  A helper carries its talisman, so it hands over **27** essence. The scored
  account keeps its rune stack in the 28th slot. The trade checks the receiver's
  free slots against everything offered before accepting
  (`trade.rs2:91-109,161-190`).
- **Entrana** refuses boarding with any weapon or armour category in the
  inventory or worn, including pickaxes (`monk_of_entrana.rs2:26-50`, Port
  Sarim). Talismans and essence are fine.

### Engine rules that set the cycle (read)

- While delayed, a player's `OPLOC`, `OPPLAYER` and `INV_BUTTON` packets are dropped
  (`OpLocHandler.ts:14-18`, `OpPlayerHandler.ts:15-19`, `InvButtonHandler.ts:15-18`).
  `IF_BUTTON` (the trade accept buttons) is not checked (`IfButtonHandler.ts`).
- A trade opens when the second player of a pair runs the trade op, and the other
  player must not be `busy` (delayed or holding a modal), `trade.rs2:26-73`,
  `Player.ts:878-880`. So no trade can open during the craft's delay.
- Every loc or player click calls `clearPendingAction`, which closes any modal
  (`Player.ts:1027-1030`). Clicking the altar with a trade open declines it. So
  the trade must complete before the craft click. The click can be in the same
  tick, sent after the confirm.
- Offering an item resets the partner's accept (`trade.rs2:352-357`). So the
  scored account's first accept must be handled after the helper's offer.
- Per tick, the server reads every player's packets (`processClientsIn`), then
  runs every player's turn (`processPlayers`). It visits players in
  `playerLoop` order: buckets keyed by IP address, then login order within a
  bucket (`World.ts:690,774,1096-1122`; `datastruct/HashTable.ts` `add`/`all`). A
  delay ends in the player's own turn (`World.ts:776`).
- The level-up script goes on the engine queue once per `stat_advance`
  (`Player.ts:1944-1946`). It opens its dialog when the craft's delay ends, and the
  next player click closes it.

### The tuned cycle (read, then measured)

Take the craft click landing on tick T, with the helper handled before the scored
account each tick (log the helper in first, from the same IP):

| Tick | Helper | Scored account |
|---|---|---|
| T | | craft (`p_delay(3)`; delayed through T+4, the level-up dialog opens on T+4) |
| T+5 | trade request | trade request: closes the level-up dialog and opens the trade in its turn |
| T+6 | offer all essence, accept | accept (after the helper's offer, so it sticks): the confirm screen opens |
| T+7 | confirm | confirm (the trade completes), then click the altar: craft = next T |

That is **7 ticks per cycle**. The scored account sends at most 2 packets per
tick, so the 5-per-tick budget is not what limits it. The limits are the craft's
n+2 = 5 ticks and the trade's three server steps (open, accept, confirm). A
second helper does not help, because the next trade cannot open before T+5
anyway.

If the scored account is handled first, its T+6 accept is reset by the helper's
offer later in the same tick, and an altar click on T+7 would decline the trade.
The **robust schedule** moves the scored account's accept and confirm to T+7 and the
craft to T+8, and has the helper confirm on T+7 and T+8. That is 8 ticks in
either order.

Measured (`runecraft-cycle.ts`, NODE_TICKRATE=300, law room unless noted):

| Run | Login order | Cycles | Gap between crafts | Base xp / craft | Base xp / tick |
|---|---|---|---|---|---|
| tuned, level 99 | helper first | 15 / 15 | 7 every time | 256.5 (27 essence) | **36.64** |
| tuned, level 99 | helper first | 20 / 20 | 7 every time | 228 (24 essence: stale talismans in the helper's inventory) | 32.57 |
| tuned, level 54 (level-ups) | helper first | 20 / 20 | 7 every time | 228 | 32.57 |
| tuned, nature 44 (level-ups) | helper first | 13 / 14 | 7, one 14 | 243 | 32.4 (34.7 at 7) |
| tuned, air 1 (a level-up every craft) | helper first | 8 / 8 | 7 every time | 135 | 19.29 |
| robust, level 99 | helper first | 20 / 20 | 8 every time | 228 | 28.5 |
| robust, level 99 | **scored first** | 10 / 10 | 8 every time | 256.5 | 32.06 |
| tuned, level 99 | **scored first** | 5 / 10 | the other 5 failed, as predicted | | |
| stock SDK, level 99 | helper first | 10 / 10 | 15 every time | 228 | 15.2 |

This settles the predictions: the trade opens on T+5, the first non-delayed tick.
The craft can share a tick with the trade's confirm (seen in the trace as
"Accepted trade." and "You bind..." in one publication). Level-up dialogs cost
nothing on the tuned schedule. Processing order is worth exactly one tick.

**Stock SDK (15 ticks).** The helper requests and retries on "is busy". The scored
account answers the request, waits to see the essence on offer and the helper's
accept, accepts, waits for the confirm screen, accepts, and crafts once the essence
shows in its inventory. Each of those reactions costs a tick of observation lag
(primitives.md section 1 on the rs/3 branch), and the craft's xp only shows two
publications after the craft tick.

### Helpers outside the room (measured, stock reactions)

This is the only way to use the law altar without Troll Stronghold helpers. The
scored account keeps its talisman, so a trade carries 26 essence:

| Altar | Cycle | Craft seen to outside (delay plus walk to the portal) | Trade by the ruins | Talisman on ruins to inside | Walk to the altar and craft seen |
|---|---|---|---|---|---|
| Law (altar 12 tiles from the portal) | 32 (7 of 8; one 36) | 10 | 10 | 4 | 8 |
| Nature (5 tiles) | 25 (6 of 6) | 6 | 10 | 5 | 4 |

A tuned version would save roughly the trade's reaction ticks, giving about 22-24
at law (inferred). That is still three times the in-room 7.

## 5. Alternatives considered

- **Other hand-offs (read and inferred).** Dropping essence for the scored account
  to pick up costs one `OPOBJ` interaction per essence, at most one per tick and
  only when not delayed: at least 27 ticks per load, against a 2-tick trade
  window. Noted essence cannot be crafted. There is no bank in any altar room.
  Two helpers per cycle don't help (section 4).
- **28 essence per trade (inferred, not measured).** A helper living in the room
  without a talisman (it enters once, then drops the talisman) could hand over 28,
  but the scored account would also have to drop its rune stack each cycle to have
  28 free slots. The cycle would be unchanged at 7 ticks: nature route 1,134
  ticks (-42), law route 1,099. The rune-stack drop is an `OPHELD` packet that is
  refused while delayed, so it would go in on T+5 with the trade request (one
  extra packet). Resident helpers then need restocking by other helpers, or a
  pile of essence on the floor that they pick up.
- **Chaos (35) and cosmic (27).** Both are below nature per essence, and both have
  worse access: the Wilderness and a maze for chaos, Lost City and Zanaris for
  cosmic. Never better than staying at air for the low band.
- **Death (65, 10.0 per essence).** Not reachable here (section 4).
- **Law with helpers outside the room.** 4,960 ticks (section 2).

**Interleaving** (`interleaving.md` section 8, the absorbable-fractions table): **none of
Runecraft can be absorbed into self-only time.** It is location-bound: the account crafts
inside the altar room, which it enters with a talisman, so it cannot be at a tree, a fishing
spot or a knight at the same time. Inside the room every tick of the 7-tick cycle is either the
craft's `p_delay(3)` (which drops packets) or the trade that refills it (section 4), so the
room has no idle ticks to host other helper-fed actions either. Column 5 of the summary row is
therefore n/a.

## 6. Gotchas

- **Blind schedules need margin.** At NODE_TICKRATE=100 the schedule failed on
  alternate cycles (measured). The SDK publication for tick X sometimes reached
  the script so late that a click meant for X+1 landed on X+2. At 300 ms every
  scheduled cycle landed. On production the margin is 300 ms minus the
  round-trip latency, so check it first with a short run (section 8).
- **Login order decides 7 or 8 ticks.** Use 7 only if the helpers are handled
  before the scored account. Same IP: log the helpers in first. Re-logging the
  scored account puts it at the end of its bucket again. Otherwise use the robust
  8-tick schedule. A wrong guess with the 7-tick schedule declines the trade
  (measured: half the cycles lost).
- **Never send a player or loc click while a trade is open.** It closes the trade
  (`clearPendingAction`). A stock bot that re-sends its trade request after the
  window opens declines its own trade.
- **Level-up dialogs.** Each craft queues one level-up script; its dialog opens
  when the delay ends and blocks the trade (the account is "busy") until
  something closes it. On the tuned schedule the T+5 trade click closes it, and
  the measured cycles with a level-up every craft stayed at 7. A stock bot must
  dismiss it, or the helper's request is refused with "is busy at the moment".
  Related engine quirk (read, harmless here): `openChatModal` closes an open main
  modal without running its close trigger, and it clears `modalChat` where
  `modalMain` was meant (`Player.ts:2094-2099`).
- **Inventory.** The scored account carries nothing but its rune stack: no
  talisman (it never leaves the room), no weapon, no armour. Each helper carries
  its talisman plus 27 essence.
- **Entrana (law only).** No weapons, armour or pickaxes when boarding, for the
  scored account and every helper (`monk_of_entrana.rs2:26-50`).
- **Chaos ruins are in the Wilderness** (level 9). Not on the route.
- **Logout is free.** Logging out in the room costs nothing, and playtime counts
  only logged-in ticks (`docs/speedrun/quests/primitives.md` section 8, rs/3
  branch). The scored account can log out while helpers restock and come back to
  a queue of loaded helpers.
- **Travel (inferred, not walked).** Into the air room from Falador or Port Sarim:
  about 40-60 ticks. Air to the nature altar: amulet of glory to Karamja (6),
  then about 150 route tiles to (2868,3018) at 0.5 ticks per tile, about
  80-90 ticks. Or the Port Sarim ship (21-22) and the walk from Musa Point.
  About 150 ticks of travel for the nature route. Air to law: walk to the Port
  Sarim monks (about 45), ship to Entrana (32, `primitives.md` section 5), walk
  about 50 tiles to the ruins (25): about 100.

## 7. Helper supply list

For the recommended route (air 1-44, nature 44-99, 27 essence per trade):

| Item | Count | Where helpers get it |
|---|---|---|
| Rune essence | **4,536** (189 air + 4,347 nature), in 168 loads of 27 | Mined in the essence mine (Rune Mysteries for the miner, `essence_mine.rs2:2-5`; Aubury in Varrock or Sedridor), every swing succeeds (`mine.dbrow:8`), 3 ticks per essence with a rune pickaxe (cadence measured in `mining.md`, rs/2 branch) |
| Air talisman | 1 for the scored account (dropped after entering), 1 per air helper | Duke Horacio (Rune Mysteries start), goblin drops, the GE |
| Nature talisman | 1 for the scored account, 1 per nature helper | Shared rare drop table (`shared_droptables.rs2:69-74`), the GE |
| Amulet of glory (charged) | 1 | Travel to Karamja; helpers buy or charge it |

Law route instead: 4,374 essence (351 air + 4,023 law, 162 loads), law talismans
only via Troll Stronghold on each account (untradeable), and no weapons, armour or
pickaxes on Entrana.

Helper effort (inferred). Mining is 4,536 x 3 = 13,600 helper ticks, about 68
helper-minutes at 300 ms, plus teleports and banking. That is 168 essence trips
of 27, and 168 delivery trips into the room. A delivery to the nature altar
is a glory teleport and about 80-90 ticks of walking from the nearest bank
(Shilo Village's bank needs that quest). None of this is scored time, because
the scored account can log out. The practical schedule is batches: N helpers each
stand in the room with 27 essence and a talisman, the scored account logs in and
takes N trades in 7N ticks, then logs out while they restock. Twenty helpers make
about 9 batches of 20 crafts.

Cadence: **168 cycles of 7 ticks** (each one trade plus one craft), against 15
ticks with the stock SDK. Add one plain trade (9 ticks stock, measured) at the
start of each session.

## 8. Open questions

- **Production latency.** The tuned and robust schedules are blind: each click
  must land on its exact tick. Run `runecraft-cycle.ts --mode=robust` for a few
  cycles against production (two accounts; a staff-free setup with real essence)
  and check that the gaps are all 8, then try `--mode=tuned`.
- **Processing order on production.** It depends on the remote address the engine
  sees behind Fly's proxy (`World.ts:1091-1122`). If every player shows the
  proxy's address, login order alone decides it. Logging the helpers in first and
  measuring settles which schedule to use.
- **Is the law route worth Troll Stronghold?** It saves about 40 ticks net
  (inferred) only if Troll Stronghold is already on the quest route for the scored
  account (cairn://p/rs/18) **and** enough helpers do it too. Otherwise nature.
- **Travel ticks** (section 6) are estimates. Walk the glory-to-nature-altar route
  once with `quest-primitives-movement.ts` style timing.
- **28 essence per trade** (section 5) is unmeasured: the resident helper and the
  T+5 rune-stack drop.
- **The one 14-tick gap at nature** (13 of 14 at 7) was a missed cycle that the
  script did not flag. Probably a late publication; not seen in 90 other 300 ms
  cycles.

## 9. The step module

`speedrun/skills/runecraft.ts` is the scored run's Runecraft module (STEP-MANIFEST.md entry 9):
`steps()` returns **S06 runecraft** (air, 1-44) and **S21 runecraft** (nature, or body with
`s21Altar: 'body'`, 44-99), both `logoutSafe`. It does not craft by itself. It drives the
page's `rc-cycle` program (cairn://p/rs/131), which owns the tick schedule, and it does the
three things the page cannot do:

- **The giver feed.** On every published state it reads the givers' status files
  (`giver-<account>.json`, rs/117's contract in `docs/speedrun/helpers/altar-giver.md`). It
  keeps givers that are `ready` or `armed`, in the room, loaded with 27 essence and heartbeating
  within 5 s, oldest `readyAt` first, and hands that list to the program through its input op,
  only when the list changes.
- **The schedule per giver.** Under `schedule: 'auto'` (the default) the processing order the
  page reads off each giver's trade screens decides.
  - **First guess**, before any turn: tuned only when `run-machine/launcher.json` is fresh (10 s),
    says `helpersReady`, and records the giver's login before SCORED's. SCORED's login time is
    the session's last client launch, never later than the login, so the guess errs toward
    robust.
  - **After that**, the order rc-cycle read on the giver's latest turn takes over:
    `giver-first` gives tuned, `scored-first` gives robust. That one observation covers the
    login order, the engine's IP buckets (a giver on a lower bucket is handled first even when
    it logged in later; rs/131's lab: 30/30 at 7) and a relog mid-session.
  - **Demotion:** a giver whose tuned turns fail twice in a row (`missed` or `late`) is fed
    robust for the rest of the step, whatever the order says.
- **The cue relay.** The page shares its turns and recent frames; the module copies them into
  `cue.json` whenever they change, one cue session per program run, and writes a `stop` cue at
  every end (done, fault, its own stop, a dropped page). The receiver appears only as a hash of
  its name.

**Fault ladder.**
1. When the program faults on `N turns in a row failed` while any giver was on tuned, the
   module restarts it once with every giver robust.
2. A further fault falls back to the stock reacting cycle (`fallback: 'stock'`): a `stock` turn
   in the cue, then a reacting receive through `lib/trade.ts` and an altar click per cycle. The
   giver side's reacting `stock` turn kind is rs/163's (`TurnSchedule` in `altar-cue.ts`).
   Without it the rung ends in a fault. Its row carries a per-cycle timeline (turn written,
   receive ticks, essence in, craft).
3. `no altar in sight` re-enters the stand tile once.
4. A reloaded page is rethrown for `runResumable`. On a restart the program re-derives its
   anchor from the inventory and trade screen, so resuming the step is simply running it again.
5. Waiting for a giver is progress up to `giverWaitTicks` (300), after which the step stops the
   program and says why. The restock logout ("only when it pays") is not built.

Each program end logs one `kind: 'program'` TickLog row carrying the counters, the gap
histogram, the schedule given to each giver and why, the givers demoted, the last failed turns,
and the first craft's offset from the program start (the session's first trade).

**The talisman drop is checked.** SCORED drops its talisman on entry, because the slot is one of
the 27 a trade needs. The server ignores a drop sent while the player is delayed, and gives no
message. With the talisman kept, the first trade still fits (27 free slots). After the first
craft the rune stack takes the 28th slot, and every later trade fails, under every rung of the
ladder. So the step waits for the talisman to leave the inventory, re-sends the drop up to 3
times, and otherwise stops before any program run. The error names each drop's reply and
whether a dialog or interface was open. Program rows carry `talismanDrops`.

**Level-ups.** Nothing handles level-ups while the program runs: the trade request on T+5
closes the dialog. Only the last craft's dialog is answered, through `lib/levelup.ts`, after the
program ends. That costs no ticks the account could have used, because the craft's delay holds
SCORED until the dialog opens.

**Preconditions.**
- Runecraft is at least the band start.
- SCORED is in the altar's room, judged by position (within 24 tiles of the entry tile) rather
  than by the altar loc. Right after a login the position is published before the scene's locs,
  and the resume walk observes that first state.
- Nothing in the inventory except this altar's talisman (dropped on entry), essence and this
  altar's runes. The step refuses S21 while S06's air runes are still held, because a trade of 27
  needs 27 free slots.

**Measured** (m), local lab at `NODE_TICKRATE=300` on bgsrv-mac (load 5-7), with SCORED's
stand-in in a visible Chrome tab running the step and 3 production `altar-giver`s through
`standalone.ts` on a shared cue directory (`speedrun/lab/runecraft-accept.ts`, 2026-10-21).

The acceptance runs used rs/163's **direct-path** givers (its branch at 2bc114ac, which also
has the body route):

| Run | Login order | Turns given | Gaps | Step ticks |
|---|---|---|---|---|
| nature 44, auto (chose tuned) | givers first | 30/30 | 29 x 7 | 217 |
| nature 44, robust | givers first | 30/30 | 29 x 8 | 247 |
| nature 44, robust | SCORED first | 30/30 | 29 x 8 | 247 |
| nature 44, auto (chose robust) | SCORED first | 30/30 | 29 x 8 | 247 |
| body 44, auto (chose tuned) | givers first | 30/30 | 29 x 7 | 215 |

The rest used **relay-path** givers from rs/41's branch (079ccf21). In the lab the cycle does
not depend on the path, since the engine is on loopback:

| Run | Login order | Turns given | Gaps | Step ticks |
|---|---|---|---|---|
| nature 44, tuned / robust / auto | givers first | 30/30 each | 29 x 7 / 29 x 8 / 29 x 7 | 217 / 247 / 217 |
| nature 44, robust / auto (chose robust) | SCORED first | 30/30 each | 29 x 8 | 247 |
| S06: air 1 to 44, auto (tuned), two runs | givers first | 7/7 each | 6 x 7 | **58** each |
| S06: air 1 to 44, auto (robust) | SCORED first | 7/7 | 6 x 8 | 66 |
| nature, 10 crafts, clean logout, resume walk, 10 more | givers first | 20/20 | 18 x 7 | 149 (one unbroken run: ~147) |

Resume and the fault ladder, also on direct-path givers. `--reload-after`, `--relog-after` and
`--junk-after` in the lab script set these up:

| Run | What happened |
|---|---|
| page reload after 8 crafts, under `runResumable` | Classed as a drop. The resume walk found the step in progress, and the restarted program ran the other 12 at 7 (the first trade again 7). The ticks across the reload aren't observable from the client's counter, which restarts (the row is `crossedSession`). |
| junk item after 5 crafts, dropped when the next program run starts | 6 failed turns, both tuned givers demoted, then the fault. The robust restart recovered: 15/15 at 8. |
| junk item kept | Fault, robust restart, fault, then the stock rung, which failed 6 times (the production giver had no `stock` turn yet). The step threw with the reason. |

**On the wired module** (the real `programs.ts` and `altar-cue.ts` dependencies, base with
rc-cycle at 23ea9f77, page built from it; givers from rs/163's `e4f60121`, direct path;
bgsrv-mac at load 4-9):

| Run | Login order | Turns given | Gaps | Step ticks |
|---|---|---|---|---|
| nature 44, auto (chose tuned), first run on a fresh engine | givers first | 30/30 | 29 x 7 | 218 |
| nature 44, robust | SCORED first | 30/30 | 29 x 8 | 248 |
| S06: air 1 to 44, auto (tuned) | givers first | 7/7 | 6 x 7 | 58 |
| junk item after 3 crafts, kept until the stock rung starts (4 runs) | givers first | program 3/3 at 7, then fault, robust restart, fault | stock rung: 9 crafts, 8 x 31 | 353-382 |
| the same, after rs/267's `openTrade` and giver fixes | givers first | the same | stock rung: 9 crafts, **8 x 9** | 181 |

- **The stock rung costs 9 ticks a cycle** (it cost 31 until rs/267). Each reacting receive takes 8
  ticks from SCORED's first trade click, the rung's first trade 5. The 31 was SCORED's request,
  sent on the frame its craft lands, being dropped (a click from a delayed player), then the
  level-up dialog that opens as the delay ends making SCORED "busy" to every giver request until
  `openTrade`'s 8 s re-send closed it. `openTrade` now re-sends a request that drew no answer by
  the second frame (`helpers/altar-giver.md`, "The stock cycle"). Counted from the craft frame,
  8 is the floor while SCORED clicks during the delay. Waiting out the delay before the first
  click would count the trade from SCORED's first free tick, not shorten the cycle.
- **The demo driver** (`speedrun/lab/runecraft-demo.ts`) runs the same step against a real server
  with no staff commands. The accounts arrive staged: each giver holds an air talisman and 27
  essence, with the rest banked at Falador east; the stand-in holds only an air talisman at the
  ruins. The givers log in through `standalone.ts` with the bank restock, then the stand-in logs in
  through the browser tab's token login (rs/138), walks in through the ruins and runs the step.
  Every logout is confirmed in its RESULT line. `--lab-stage` is its dry run on the lab, staging
  the accounts with staff commands first. Dry run, air, 20 cycles, 3 direct-path givers: **20/20
  given, all tuned**; 13 in-batch gaps at 7, and 6 batch gaps of 86-87 ticks, which are the
  givers' bank round trip; 628 step ticks; every logout confirmed. A 20-turn demo takes
  7 + 7 + 6 loads from three givers.
- **The "unexplained run" below was the talisman.** The first run on a freshly booted engine
  gave its first turn and then failed every turn, including the stock rung's. It ended holding
  the nature talisman. A later fresh-boot run stopped on the talisman check instead (3 drops
  ignored). The drop check above is the fix.

What the table shows:
- **The session's first trade** costs 7 ticks under the program, measured as program start to
  first craft (8 under robust). The manifest prices it at 5; the stock trade in section 7
  costs 9.
- **S06** is 58 against the manifest's 54 (+7%).
- **Outside the program**, the step spends about 7-9 ticks: the walk from the entry tile to the
  stand tile, and the last craft's level-up.
- **One run not counted.** The first tuned run on a freshly booted lab gave its first turn and
  then missed 12 in a row, tuned and robust alike. It was the talisman drop being ignored (see
  the wired-module table above), and it did not recur in the 177 turns after it.
