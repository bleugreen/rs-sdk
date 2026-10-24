# Sea Slug

**Verdict: do it, but it needs a lite-client fix first (cairn://p/rs/54).** It costs
**about 495 ticks on the stock client (inferred), 394 on the fixed client (measured) and
about 340 with bursts (inferred)**, trade included, and its 7,175 base Fishing replaces
**955 ticks** given Fishing Contest, or **1,385** without it (rs/2
`docs/speedrun/skills/fishing.md` section 3 subset table, normal cycle). Net about +460 /
+560 / +615 against the 955. It is the most valuable of the six quests here.

**Module (S19, rs/414).** `speedrun/quests/sea-slug.ts`, lab-accepted on the lite client from
Caroline's tile (2716,3302): **fixed 346.3 m** (346, 347, 346) and **burst 310.7 m** (306, 318, 308),
against the entry's 361 fixed and 307 burst, and on the **browser client** (the entry's
acceptance) from the same tile: **burst 311.0 m** (307, 304, 322), bgsrv-ub, beside a lite
control chain of 304 on the same engine; see 'The step module' below. The client fix (rs/54) is
on main, so the lab patch below is history.

**Blocker found in the lab (read and measured; fixed by rs/54).** The quest needs the broken glass, which
lies only inside two rooms on the fishing platform, and Kennith's wall, which is behind a
door on the platform's upper floor. Those doors sit on **bridged** tiles. The server opens
them, but the headless lite client stores the change at the wrong level and its router
keeps treating the door as closed, so the bot can never walk in (`"I can't reach that!"`).
Details and the one-line fix are in cairn://p/rs/54; a lab-only patch that applies it is
`docs/speedrun/scripts/quest-smallskill-bridge-patch.sh`. All Sea Slug measurements below
ran with that patch applied in the lab copy of the client, uncommitted. Without the fix
the quest cannot be finished by the bot.

Measured with `docs/speedrun/scripts/quest-smallskill-seaslug.ts` through
`quest-smallskill-lab.sh`, `NODE_TICKRATE=300`, fixed lite client (cairn://p/rs/22) plus
the bridge patch. Two complete runs (389 ticks of steps each, assembled as below); the
Witchaven dialogues were also measured on the stock client before the fix merged.

## Reward

- **7,175 base Fishing** (read, `stat_advance(fishing, 71750)`, `caroline.rs2:45`;
  measured 179,375 game xp, Fishing 1 → 74).
- **1 quest point** (read, `caroline.rs2:43`, `quest.constant:119`), oyster pearls.

## Requirements (as this server enforces them)

| Check | Where | Type |
|---|---|---|
| Firemaking 30 to rub the dry sticks | `quest_seaslug.rs2:43` | `stat()` (boostable) |
| The rub succeeds at random: `stat_random(firemaking, 64, 512)` | `quest_seaslug.rs2:48` | 77% per rub at Firemaking 30, certain from about 50 (read, `PlayerOps.ts` roll) |
| A lit torch in the inventory to climb the ladder once Kent has spoken (or the fishermen hit you for 4 and you stay down) | `quest_seaslug.rs2:65-79` | item |
| Swamp paste for Holgart | `holgart_ardougne.rs2:35` | item, tradeable |
| An unlit torch when the sticks catch | `quest_seaslug.rs2:53-57` | item, tradeable (`firemaking.obj:45`) |

No quest or skill gate otherwise. The Ardougne teleport used to get there needs Plague
City (`%elenaquest` 30) and Magic 51 (`plague_city.md`).

**Bailey is not needed.** His only job is to hand out the unlit torch
(`bailey.rs2:22-28`); no varp is set. A helper-supplied torch skips him.

## Helper-supplied items

One trade: swamp paste (tradeable, `cooking.obj:177`), an unlit torch, and Ardougne
teleport runes (2 law, 2 water). The damp sticks, broken glass and dry sticks are
`tradeable=no` (`_unpack/225/all.obj:779-823`) and are picked up on the platform. A lit
torch is no use: every crossing to the platform puts it out (`holgart_ardougne.rs2:94-103`).

## Step list

Quest varp `%seaslugquest` (perm): stages in `quest_seaslug.constant` (0 → 12). The
platform's ground floor is server level 0 and its upper floor level 1 (the map file keeps
them at levels 1 and 2 with the bridge flag). Loc ids from `maps/m43_51.jm2`. Ticks are
the fixed client, measured; the stock and burst columns are below.

| # | Where | Action | Varp | Raw counts | Fixed | Label |
|---|---|---|---|---|---|---|
| 0 | anywhere | helper trade | | 1 trade | 5 | measured, `primitives.md` |
| 1 | → Ardougne (2661,3301) | Ardougne teleport | | 1 cast | 4 | measured |
| 2 | → Caroline (2716,3302), Witchaven | run east | | 56 route tiles | 29 | measured |
| 3 | Caroline | "I suppose so, how do I get there?" | 0 → 1 | 12 pages + 1 option; `8c, opt, 4c` | 15 (14-17; stock 28) | measured |
| 4 | Holgart (2720,3306) | asks for the boat; told about swamp paste | 1 → 2 | 10 pages; `10c` | 13 (12-13; stock 23-24) | measured |
| 5 | Holgart | gives the paste; "Okay, lets do it."; `p_delay(2)` and the boat jumps to the platform (2782,3273) | 2 → 3 | 8 pages + 1 option; `6c, opt, 1c, state, 1c` | 18 | measured |
| 6 | platform, ground floor | open the door `loc_1533` (2765,3277) from (2766,3277), step in | | 17 tiles, 1 door | 19 | measured (with the bridge patch) |
| 7 | | take the broken glass (2765,3278) | | 1 pickup | 1 | measured |
| 8 | → damp sticks (2784,3289) | run round the platform, take them | | 36 tiles, 1 pickup | 21 | measured |
| 9 | | use the glass on the damp sticks: dry sticks (`p_delay(1)`, `quest_seaslug.rs2:35-40`) | | 1 use | 3 | measured |
| 10 | ladder `slugladder` 2517 (2784,3286) | climb to the upper floor | | 3 tiles, 1 climb | 5 | measured |
| 11 | upper floor | open `loc_1530` (2764,3285) from (2765,3285), step to (2764,3286) | | 19 tiles, 1 door | 20 | measured (with the bridge patch) |
| 12 | Kennith's wall `kennithwall` 2519 (2764,3287) | talk to Kennith through the wall (`quest_seaslug.rs2:119-122`) | 3 → 4 | 6 pages; `6c` | 11 (8 without an accidental second talk) | measured |
| 13 | → `laddertop` 1746 (2784,3286) | back and down | | 19 tiles, 1 climb | 15 | measured |
| 14 | → Holgart (2782,3276) | the deck route from the ladder foot is long | | 48 tiles | 24 | measured |
| 15 | Holgart | "something strange": `p_delay(2)`, to Kent's island (2800,3320) | 4 → 5 | 5 pages; `4c, state, 1c` | 15 | measured |
| 16 | Kent (2793,3321) | his story; he pulls a sea slug off you (`kent.rs2:7-29`: `if_close`, `p_delay(2)`, then `p_delay(1)` x3) | 5 → 6 | 12 pages; `9c, state, 1c, state, 2c` | 16 | measured |
| 17 | Holgart (2799,3320) | back to the platform (2782,3273) | | 3 pages; `2c, state, 1c` | 13 | measured |
| 18 | | rub the dry sticks (op1): the unlit torch lights (`quest_seaslug.rs2:42-63`) | 6 → 7 | 1 click | 0 | measured (Firemaking 99, so no failed rubs) |
| 19 | → ladder, climb | | | 49 tiles, 1 climb | 30 | measured |
| 20 | upper floor | through `loc_1530` (still open from step 11) to (2764,3286) | | 19 tiles | 11 | measured |
| 21 | Kennith's wall | Kennith won't pass the slugs | 7 → 8 | 7 pages; `7c` | 8 | measured |
| 22 | → (2766,3288) | kick the loose panel `loosepanel` 2518 (2765,3288) (`p_delay(2)` x2, `quest_seaslug.rs2:81-91`) | 8 → 9 | 4 tiles, 1 interaction | 10 | measured |
| 23 | → (2764,3286) | Kennith: "I've made an opening" | 9 → 10 | 4 tiles, 6 pages; `6c` | 10 | measured |
| 24 | → (2768,3290) | the crane `fishingcrane` 2520 (2768,3286), used from z ≥ 3289 (`quest_seaslug.rs2:96-115`, `p_delay` 0, 0, 1, 0, 1); its footprint blocks z 3286-3289, so stand at (2768,3290) | 10 → 11 | 7 tiles, 1 interaction | 13 | measured |
| 25 | → ladder, down | | | 16 tiles, 1 climb | 12 | measured |
| 26 | → Holgart, deck route | | | 48 tiles | 24 | measured |
| 27 | Holgart | "Did you get the kid back to shore?": to shore (2722,3305) | | 4 pages; `3c, state, 1c` | 14 | measured |
| 28 | Caroline | reward | 11 → 12 | 4 tiles; 9 pages + level-up page; `7c, state, 2c` | 15 | measured |
| | | **Total** | | 85 dialogue clicks + 2 options, 2 doors, 4 climbs, 3 pickups, ~480 route tiles | **394** (389 + 5) | measured |

Run 2 and run 3 differ only in where the walks are split; run 2's single total is 389
ticks of steps, and run 3 assembled with run 2's two ladder legs (steps 10 and 19) is
also 389.

## Tick total

| Part | Stock | Fixed | Burst | Label |
|---|---|---|---|---|
| Travel (teleport and runs, ~480 route tiles including the platform's deck) | ~185 | ~185 | ~185 | measured (fixed); stock and burst have no reason to differ |
| Dialogue and boat rides (11 conversations, 85 clicks; 4 boat jumps with `p_delay(2)`) | ~250 | ~163 | ~110 | fixed measured; stock = fixed + 1 per click (inferred; the three Witchaven talks measured 28, 23-24 and 20 stock against 15, 13 and 18 fixed); burst from the recorded runs with the CONVENTIONS.md rule, about 54 fewer |
| Doors, climbs, pickups, panel, crane, sticks | ~51 | ~41 | ~41 | measured (stock +1 per reaction, inferred) |
| Trade | 9 | 5 | 5 | measured, `primitives.md` |
| **Total** | **~495** | **394** | **~340** | |

The earlier inferred figure in `quest_points.md` (~300 / ~215 / ~160) was about 100 ticks
low: the platform's deck route between the ladder and Holgart is about 48 tiles each way,
which no estimate from the coordinates could see.

## Marginal value

| Basis | Ticks saved | Source |
|---|---|---|
| Given Fishing Contest, normal fly-fishing cycle (the on-route case) | **955** | rs/2 `fishing.md` section 3 subset table (Contest 4,365 → SS+Contest 3,410), rs/2 branch at 0e184ef2 |
| Done first or alone, from level 1 | 1,385 | same table (5,120 → 3,735) |
| Given Fishing Contest, 3-tick cycle | 586 | same table, 3-tick column (2,626 → 2,040), inferred there |

Every basis clears the cost. Ordering between Sea Slug and Fishing Contest does not change
their combined saving (1,710 normal cycle).

## Risks and gotchas

- **The client defect above (cairn://p/rs/54).** Without the fix the bot cannot reach the
  broken glass or Kennith. The SDK's long-path pathfinder also has no waypoints on the
  platform; drive it with clicks on tiles (the scripts' `clickWalk`), not `bot.walkTo`.
- **Doors give the bot no feedback** on bridged tiles, and clicking an open door closes
  it. The script walks first and opens only if the walk fails (`viaDoor`). The doors
  close by themselves after 500 ticks (`doors.rs2:1`, `open_door(500)`).
- **Another player may have taken the broken glass (rs/661).** A picked-up ground spawn returns
  after 100 ticks (the obj default; neither the glass nor the damp sticks sets a `respawnrate`).
  The glass has a second spawn at (2765,3289) in the store room under Kennith's, behind a twin of
  the glass room door (`loc_1533` at 2765,3287; shut, the spawn is unreachable). E takes the
  glass room's glass if it is there, else the store room's, else it waits at the glass room door
  for whichever returns first, up to `RESPAWN_WAIT_TICKS` (120). A pickup lost under the click
  goes back to that wait. F's sticks (one spawn) share the wait. Lab, lite, 400 ms (m): the
  second spawn costs E+F +4 ticks (40 against 36); the wait, with the taker ~10 ticks before E,
  +80 (116); the module before rs/661 failed E after its 60-tick wait (a `--from` restart).
  The two-bot lab is `speedrun/lab/quests/sea-slug-taker.ts`.
- **Firemaking.** At exactly 30 each rub is 77%: a failure costs about 1 tick and a
  re-click. Firemaking is helper-fed and passes 30 early, so schedule Sea Slug after that.
- **Kennith answers once per click.** A second click on his wall while the first chat is
  closing starts the next stage's lines (3 wasted pages in one run).
- **Sea slugs** on the deck bite for 3 if clicked (`quest_seaslug.rs2:1-9`); nothing on
  the platform is aggressive. No food was needed (HP 60 in the lab).
- **Logout-safe:** `%seaslugquest` is `scope=perm` (`quest_seaslug.varp`). A torch lit on
  the platform goes out on any crossing, so relight after a re-crossing.

## The step module (rs/414)

`speedrun/quests/sea-slug.ts` (S19), lab runner `speedrun/lab/quests/sea-slug.ts`. Seventeen
segments, A to Q, from Caroline's tile, where T18-19 leaves SCORED. H15 is traded during S18, so A
only checks the paste and the torch. Measured on the lite client, bgsrv-mac, 300 ms, at SCORED's
arrival levels (Firemaking 99, Fishing 1) and pack (the slot ledger after H15), module at baaff1ac,
3 runs each. The browser column is the full chain 3 times on `--client=browser` against a local
lab engine on bgsrv-ub (300 ms), module at 7d19e1a3 (Q's level-up wait below), with a webclient
bundle lab-built from rs/185's tip 825d7368 (webclient tree 289d61b7; `out/bot/client.js` md5
e5387d2305f226be686820250d6cc6cf). Lite control is one burst chain on that same engine, straight
after.

| Segment | Step rows | Row (fixed) | Fixed m (lite) | Burst m (lite) | Burst m (browser) | Lite control |
|---|---|---|---|---|---|---|
| A kit | 0 | 0 (trade during S18) | 0 | 0 | 0 | 0 |
| B Caroline | 3 | 15 | 15 | 9.7 | 14.3 (9, 9, 25) | 9 |
| C Holgart, the boat | 4 | 13 | 16 | 7 | 7 | 7 |
| D Holgart, paste and sail | 5 | 18 | 16 | 14 | 14 | 14 |
| E glass room door, glass | 6-7 | 20 | 12 | 12 | 13 | 12 |
| F damp sticks, dry them | 8-9 | 24 | 24 | 24 | 24 | 24 |
| G ladder, door, Kennith | 10-12 | 36 | 26 | 22 | 23 | 22 |
| H down, Holgart to the island | 13-15 | 54 | 50 | 49 | 49.3 | 50 |
| I Kent | 16 | 16 | 26 | 24 (19-33) | 20 | 19 |
| J Holgart back | 17 | 13 | 12.3 | 12.3 | 12.3 | 12 |
| K rub, torch lit | 18 | 0 | 1 | 1 | 1 | 1 |
| L ladder, Kennith | 19-21 | 49 | 50 | 45 | 45 | 45 |
| M panel | 22 | 10 | 10 | 10 | 10 | 10 |
| N Kennith | 23 | 10 | 11 | 7 | 7 | 7 |
| O crane | 24 | 13 | 13 | 13 | 13 | 13 |
| P down, Holgart ashore | 25-27 | 50 | 46 | 47.3 | 46 | 46 |
| Q Caroline, reward, exit drops | 28 | 15 | 18 | 13.3 | 12 | 13 |
| **Total** | | **356** (+5 trade = 361) | **346.3** | **310.7** | **311.0** | **304** |

The browser's one outlier, B at 25 in its third run, did not recur: B alone, 3 more browser runs
with a per-tick trace, read 9, 9, 9 (m). Its log was lost with the build slot, so its cause is
not known; it is 16 ticks, short of an engine stall. Every other browser segment is within a tick
of the lite control.

Every run opened both bridged doors (the glass room door at E, the door by Kennith's wall at G,
closed before and open after in the trace) and gained 179,375 Fishing xp, to **level 74** (m).
What the module found, and what it corrects above:

- **The doors (m, lab).** Opening `loc_1533` at (2765,3277) puts `loc_1534` one tile east at
  (2766,3277); `loc_1530` at (2764,3285) becomes `loc_1531` at (2765,3285). Both clients list them
  now, so LAB.md's 'no locs on bridge-flagged levels' does not hold here. But `nearbyLocs` reaches
  only a few tiles: from the boat landing the glass door shows only in a 25-tile scan. A click on
  the closed id at the closed tile cannot shut an open door: the closed loc is gone from its tile
  and the server drops the op (`OpLocHandler`: no such loc). The module reads the door's state,
  opens it only when it is closed, and waits for the door loc after a crossing (RUN-ORDER R10).
- **Kent's 16 (step 16) was an undercount (i).** His script has 12 pages, and if_close with
  p_delay(2) and three p_delay(1) between them (`kent.rs2:7-29`). A conversation that ends on
  the first quiet spell stops before his last two pages, which the next talk then trips over.
  The module ends his talk on the sea slug message and a page after it: 26 m fixed.
- **The ladder foot (2784,3285) cannot be stood on**; clicking the ladder climbs from wherever
  SCORED is. An NPC click on Holgart from the ladder foot opened nothing in 15 ticks, as the proven
  script found, so the module runs beside him first.
- **The journal** cannot tell 1 from 2 or 2 from 6 (no markers), 4 from 5, or 8 from 9
  (`seaslug_journal.rs2`). The module narrows these by position (offshore means at least 3, Kent's
  island at least 5); a resume at 9 kicks the panel again, which only says 'nothing interesting
  happens'.
- **Exit drops:** the torch, the dry sticks, the glass and the pearls, in Q (1 tick), so T19-20
  starts with H15's runes only.
- **Q's level-up page (m, lab trace).** `stat_advance` runs inside Caroline's script, but the
  Fishing level-up page shows only 3 ticks after her chat closes (the quest-complete message comes
  with the close). The module waits for that page as the target (converse `expect: 'interrupt'`),
  so the wait ends as soon as it is answered, and skips the wait when her own talk already
  answered it. Q on the lite client after the change, bgsrv-ub: fixed 17.3 m (18, 17, 17), burst
  13.0 m (13, 12, 14). Fixed Q stays over its 15-tick row: the close-to-page gap, the page and
  the drop tick are content time the row did not count.

## Open questions

- A demo run on a throwaway at Firemaking 30 (asked of rs/41 and rs/289).
- The stock column is inferred from the fixed run; only the Witchaven talks were measured on the
  stock client.
