# Bar supplier (miner and smelter)

`speedrun/helpers/smelter.ts` (role `smelter`) takes a fresh demo account to the Mining
and Smithing levels it needs, mines ore and coal around Falador and in the Mining Guild,
smelts mithril bars (adamantite when the account can) at the Falador furnace, and banks
everything. Adamant-tier accounts mine adamantite in the Dwarven Mine through the guild's
south door. Steel and iron bars are made to a per-account quota from iron ore bought on
the Grand Exchange. The same module covers both halves of a split pipeline through its
`mode` option, so there is no separate `miner.ts`.

```
ROLE_OPTIONS='{"mode":"full"}' bun speedrun/helpers/smelter.ts cairn_h20
```

## Options

| Option | Values (default first) | Meaning |
|---|---|---|
| `mode` | `full`, `mine`, `smelt` | `full`: train Mining and Smithing, mine, smelt, bank bars. `mine`: train Mining only and bank ore and coal for someone else to smelt. `smelt`: smelt whatever ore is in this account's bank (handed over by trade), otherwise idle and re-read the bank every 100 ticks. |
| `tier` | `auto`, `mithril`, `adamant` | Which bars to smelt. `auto` smelts adamantite when the account has Smithing 70 and the ore, else mithril. |
| `site` | `auto`, `guild`, `west`, `rimmington`, `barbarian`, `dwarven`, `alkharid` | Where to mine. `auto`: the west Falador mine below Mining 60 (Rimmington when it is camped), the Mining Guild from 60, the adamantite site once the account makes adamantite bars. `barbarian` is coal only (see the measurements before using it). |
| `addy` | `dwarven`, `alkharid`, `none` | Where an adamant-tier account (Mining 70, and Smithing 70 in `full` mode) mines adamantite. `none` keeps it in the guild. Put each adamantite account on its own site. |
| `combat` | the site's threshold + 2 | Combat level to reach on Lumbridge cows before an addy site with aggressive NPCs (31 for both `dwarven` and `alkharid`). |
| `steel`, `iron` | `0` | Bars of each to hold in this account's bank. The role buys the iron ore (or mines it while waiting for adamantite respawns) and smelts it with banked coal. |
| `buyOre` | `true` | Buy the quotas' iron ore on the exchange, selling coal the quotas do not need to pay for it. |
| `maxOrePrice` | `200` | Highest iron ore ask to pay. |
| `smeltMin` | `25` | Bars' worth of ore and coal in the bank before a production smelting session starts. |
| `pickaxe` | `true` | Upgrade the pickaxe by selling surplus on the Grand Exchange and buying from Nurmof. |

## How a cycle works

Every cycle re-derives what to do from what it observes (position, inventory, the last
bank snapshot), so the role restarts cleanly from any point: in the tutorial, mid-trip,
with a full inventory, at the furnace, after a relog or a death. It visits the bank
when it has never seen the bank, the inventory is full, it carries loot away from a
mine, or it has no usable pickaxe; otherwise it mines one inventory. Each bank visit
calls `ctx.reportBank`. Phase changes (`tutorial`, `train-smithing`, `train-mining`,
`produce-mithril`, `produce-adamant`) are logged as `phase` with the levels.

- **Training, below Mining 60.** Surface mines with no NPC spawns: west of Falador
  (2 copper, 6 tin, 3 iron, 2 coal) and Rimmington (6 iron, 5 copper, 2 tin). It
  mines copper and tin below 15, then iron. Falador west bank is the training bank
  (nearest the furnace). In `full` mode it also trains Smithing on bronze (below 15),
  iron (15-30) and steel (30-50) bars, 9 steel bars per furnace trip.
- **Production, Mining 60 and up.** The Mining Guild cellar (37 coal, 5 mithril, only
  dwarves; the ladder is at 3019,3339), banking at Falador east. Rocks are scored
  adamantite 100, mithril 60, coal 10. While it mines coal it switches the moment a
  mithril or adamantite rock is live and nobody stands next to it. It sees a rock
  deplete when the loc id at that tile changes.
- **Adamantite, adamant tier.** The Mining Guild has no adamantite. Through the guild's
  south door (`miningguilddoor`, Mining 60; it walks the player through and shuts, so the
  role judges success by which side it stands on) is the north Dwarven Mine: 3 adamantite
  rocks 12-17 tiles away, banked at Falador east like the guild. Its 10 scorpions (level
  14) are `cowardly`, which outside the Wilderness hunts only players at most twice the
  NPC's level (`Npc.ts`), so the role first trains to combat 31 on Lumbridge cows with
  `bones.ts`'s fighter (about 15 minutes at 25x xp). The 2 king scorpions (level 32)
  still attack and wander beside two of the rocks: the role skips a rock with a king
  scorpion within 3 tiles, and when anything hits it, it steps back through the door and
  rests until 20 ticks without a hit and half hitpoints. At the site it mines
  adamantite, and in the respawn waits coal (while held coal is under 6 per held
  adamantite ore plus 60) and iron (while the bar quotas lack ore); it leaves those
  rocks the moment an adamantite rock is live. It logs `addy` per ore (with `others`,
  the rocks someone else emptied in view) and `retreat`.
- **The guild door's geometry.** The door is a wall on its own tile (3046,9756), and that
  tile is the guild side: clicking it from there walks the player to 3046,9757 (the
  Dwarven Mine), clicking from 9757 walks them back onto the door tile
  (`open_and_close_door` with `check_axis`). So an exit ends on 9756, and the guild's box
  includes that row. With the box one row short, a good exit looked like a failure and
  the retry walked straight back in: the account never banked (`door failed` loops).
- **Al Kharid, the second adamantite site.** The Al Kharid mine (2 adamantite at
  3298,3317 and 3300,3318, 2 mithril, 3 coal, 11 iron), banked at Varrock east and
  reached on foot from Varrock. Its 8 scorpions are level 14 and `cowardly` like the
  Dwarven Mine's, so the same combat 31 makes it safe; there are no king scorpions and
  no door. Smelting still happens at the Falador furnace.
- **Steel and iron quotas.** At a bank visit, if the quotas lack iron ore and the
  exchange sells it at or under `maxOrePrice`, the role sells coal it does not need
  (keeping 2 per steel bar still owed, 6 per banked adamantite ore, and 300 spare), buys
  the ore with `buyer.ts`'s `buyAtGE`, and smelts it at the Falador furnace. Iron bars
  count two ore each (half the smelts fail without a Ring of Forging).
- **Smelting.** It uses the furnace's Smelt option, then the "Smelt 10" button
  (bronze 2807, iron 3989, steel 3997, mithril 6397, adamantite 7443). Progress is
  measured by ore consumed, not bars made: a failed iron smelt still consumes ore. It
  re-clicks after 7 quiet ticks, because a level-up dialog ends the queue.
- **Pickaxes.** Nurmof's shop in the north Dwarven Mine, reached by the Ice Mountain
  trapdoor (3019,3450) only. The Falador stairs land among 12 scorpions and 2 king
  scorpions, aggressive below combat 29. At each bank visit the role prices its
  sellables (steel bars, iron bars, then coal, from `/api/market/items/<id>`) and buys
  the best pickaxe they fund, from Mining 28 skipping mithril for adamant. Coal is
  product, so it sells only as much coal as the pickaxe needs. If the pickaxe is lost
  (on death the three most valuable items are kept, and ore can outrank a bronze
  pickaxe) the starter coins re-buy one.

## Measured on the demo

All figures are from `cairn_h20`-`h22` on rs-sdk-demo.fly.dev, 2026-10-21 04:11-06:45
UTC, through a loopback gateway on bbs (about 300 ms per tick). Logs:
`~/rs-dev/smelter-scratch/logs/role-cairn_h2X.jsonl` on bbs.

### Fresh account to the required levels

| Account | Mode | Result |
|---|---|---|
| h21 | mine | Tutorial skip 3 s, then Mining 1 to 44 in one inventory (404 ticks), 63 at 19 min wall |
| h22 | mine | Tutorial skip 2 s, Lumbridge to the first Falador deposit 309 ticks, Mining 45 at 10 min, 56 at 18 min (bronze pickaxe, 4-9 players at the west mine) |
| h22 | mine | Mining 62 and in the guild at 26 min; adamant pickaxe bought at 28 min, all unattended |
| h20 | full | Smithing 1 to 16 on 14 bronze bars, 16 to 30 on 17 iron bars (half of iron smelts fail without a Ring of Forging), 30 to 51 on 63 steel bars. Fresh to Smithing 51 (first mithril bars) and Mining 82 took 2 h 4 min wall, including a death, a lost pickaxe, a login lockout and restarts; a clean run is about 1 h 30 min. |

Smithing rose faster than the content files predict: steel smelting is 17.5 xp
(`smelting.struct`) times `NODE_XPRATE=25`, 437.5 per bar, yet 54 steel bars took
Smithing 30 to 49, which needs at least about 1,400 xp per bar. The cause is not known; count Smithing training in
bars, as above, not in computed xp.

### Production rates

| What | Measured |
|---|---|
| Guild, bronze pickaxe (h20, h21) | 27 ore per inventory in 2,016 and 3,273 ticks (17-18 coal, 9 mithril each) |
| Guild, adamant pickaxe, 65-73 other players in view (h20, h21) | 25-27 ore per inventory in 1,273-2,089 ticks: 22-26 coal and 1-3 mithril. Per inventory, 113-216 rocks were depleted by someone else before we got ore and 14-25 times we left coal for a live mithril rock. Bank to bank about 7-11 min, so ~150-225 coal and ~10-20 mithril per account-hour. |
| Barbarian Village coal, adamant pickaxe, 23 players (h21) | 27 coal in 1,842 ticks, 908 of them waiting for a live rock: ~165 coal per hour, no mithril. Worse than the guild; keep it for when the guild is even more crowded. |
| West Falador mine, adamant pickaxe (h20) | 26-27 iron and coal in 370-542 ticks (5-11 players) |
| Guild, rune pickaxe, 75 players (h20) | 25 ore (24 coal, 1 mithril) in 1,282 ticks: no clear gain over adamant, because contention, not the roll rate, sets the pace |
| Steel smelting trip, west bank to furnace and back | 9 bars in 128-176 ticks |
| Mithril smelting trip (h20, Smithing 51) | 5 bars in 102-106 ticks, about 21 ticks per bar |
| Smelting cadence | one bar per 4-5 ticks (`smelting_ore` re-queues with delay 4) |
| Grand Exchange plus Nurmof upgrade trip | Falador east bank to the exchange to Nurmof: about 2 min wall. Adamant pickaxes: h21 and h22 sold 23 coal each (3,278 gp after tax), h20 sold 18 steel bars (11,970 gp). Rune pickaxe: h20 sold 36 steel bars (23,940 gp). Every sale filled at once against the bid book. |

### Steel from bought ore (2026-10-21 15:04-15:10 UTC, h20 and h21)

| What | Measured |
|---|---|
| GE trip, Falador bank to ore bought | about 75 s wall: sell coal into the 80 gp bid book, buy iron ore at the 109 gp ask; both filled in full at once (h20: 301 coal, 216 ore; h21: 177 coal, 124 ore) |
| Steel smelting trip, Falador west bank to furnace and back | 9 bars in 97-119 ticks, about 34 s wall |
| Steel bars per account-hour, ore banked | about 950; about 800 counting the GE trip |

Buying steel bars was the alternative: 1,501 gp at the ask, about 14 times the cost of
ore plus our own coal.

### Adamantite rocks in this revision

Every adamantite rock in `server/content/maps` (loc ids 2104, 2105, 2133, 2134 and
4991-4993), with what stands between a helper and it:

| Where | Rocks | Access | Hostiles |
|---|---|---|---|
| Dwarven Mine north, 3035,9764 / 3042,9772 / 3042,9774 | 3 | Mining Guild south door | scorpions (combat 29+ safe), 2 king scorpions (attack below 65) |
| Lumbridge Swamp, 3242,3164 | 2 | open | none (bots camp the swamp's coal and mithril) |
| Al Kharid mine, 3298,3317 | 2 | open | 3 scorpions |
| Karamja south-east, 2846,3035 | 2 | boat and jungle walk, no bank near | snakes (combat 11+ safe) |
| Edgeville dungeon, 3138,9873 | 2 | open | undead and hobgoblins up to 42 |
| Wilderness hobgoblin mine, 3075-3083, 3754-3760 | 7 | Wilderness level ~30 | 18 hobgoblins, players |
| Pirates' hideout, 3055,3944 | 1 | Wilderness ~53 | pirates, players |
| Grand Tree mine, 2493,9908 | 3 | The Grand Tree (King Narnode opens it) | giant rats |
| Crandor, 2836,3243 | 3 | Dragon Slayer | skeletons, moss giants |
| Heroes' Guild basement, 2915,9916 | 2 | Heroes' Quest | blue dragon |
| Desert Mining Camp, 3312-3324, 9464 | 6 | Tourist Trap | none |
| Tirannwn, 2278,3156 | 4 | Regicide | none |
| Haunted Mine, 2768-2776, 4418-4594 | 18 | Haunted Mine | possessed pickaxes |

An adamantite rock respawns in 800 ticks scaled by `(4000 - players) / 4000`
(`mine.dbrow`, `scale_by_playercount`), and at Mining 99 a swing succeeds 25 times in
256. One uncontested rock therefore gives about 14-16 ore per hour, and an adamantite
bar needs one ore and six coal. A 2-3 rock site leaves its miner idle most of the time,
so one account per site is the useful unit.

### Adamantite measured at the Dwarven Mine (h21, 2026-10-21 15:37-19:47 UTC)

| What | Measured |
|---|---|
| Combat 3 to 31 on Lumbridge cows | about 30 minutes (`bones.ts` fighter, 25x xp) |
| Ore per hour at the site | 8 (first 20 min), 27, 18 (an iron-quota smelting trip in it), 9, 7 in 25 min: **about 18 per account-hour** over 3.8 h, 70 ore in all |
| Contention | 4-17 other players in the mine. In the last hour others emptied 39 adamantite rocks in view against our 12: every respawn is raced |
| King scorpion retreats | 12 in an hour at worst; each costs a door trip and up to 20 quiet ticks, no deaths |
| Adamantite smelting | 4 bars per Falador furnace trip (28 slots / 7) in 72-101 ticks |

The site is saturated by other players, so a second account of ours there would mostly
race the first; the second account goes to Al Kharid instead.

### The constraint is mithril ore

A mithril bar is 1 mithril ore and 4 coal. In the camped guild an account mines 10-20
mithril and 150-225 coal per hour, so it has three to four times the coal its mithril
needs. **Bars per account-hour equal mithril ore per account-hour: about 10-20 at
current contention**, whichever route turns them into bars. Smelting is cheap by
comparison: 5 mithril bars per furnace trip in about 104 ticks, roughly 21 ticks per
bar, or under 5% of a full-mode account's hour.

The whole guild cannot supply much more. Its 5 mithril rocks respawn in 400 ticks
scaled by `(4000 - players) / 4000` (`scale_by_playercount`), and at Mining 70 with an
adamant pickaxe a roll lands every 4 ticks with about a 14% chance. So the guild yields
at most about 150 mithril per hour, shared by everyone in it. Adding accounts raises our
share only by crowding a contested spawn, which the etiquette rules out. With 3-4
accounts, 750 mithril bars take roughly 10-25 hours of wall time.

Other non-wilderness mithril, from a scan of `server/content/maps` (coal, mithril,
adamantite):

| Where | Rocks | Why not now |
|---|---|---|
| Lumbridge Swamp, 3233-3243, 3157-3167 | 7, 5, 2 | Camped: about 21 bots, every rock depleted (20:58 PDT) |
| Al Kharid, 3298-3305, 3299-3318 | 3, 2, 2 | Scorpions |
| Dwarven Mine south, 3035-3052, 9760-9777 | 8, 2, 3 | Scorpions (h20 died here) |
| Crandor, 2819-2838, 3242-3247 | 3, 7, 3 | Behind Dragon Slayer, aggressive monsters |
| Underground 3312-3324, 9462-9468 (under the Desert Mining Camp) | 0, 6, 6 | Probably behind Tourist Trap; access not verified |
| Underground 2915-2942, 9888-9917 (under the Heroes' Guild area) | 11, 2, 2 | Probably the Heroes' Guild basement (quest-gated); not verified |
| Underground 2472-2494, 9905-9917 (under the Grand Tree) | 11, 2, 3 | Probably behind The Grand Tree; not verified |
| Edgeville dungeon, 3134-3143, 9868-9878 | 6, 1, 2 | Next to hill giants; not tried |

The locations under other areas are inferred from `maps/labels.txt` (nearest surface
label), not visited. The 6-mithril, 6-adamantite cluster is the one worth checking next.

### Routes compared

| Route | Bars per account-hour | Notes |
|---|---|---|
| (a) `full` on every account | 10-20 | Self-contained. Smithing training costs about an hour per account, but it runs while Mining trains, and the steel bars it makes fund the pickaxe upgrades. |
| (b) split: `mine` miners plus one `smelt` account | 10-20 per miner; one smelter covers 20 or more miners | Miners skip Smithing (about 25 min fresh to the guild instead of about 75). Needs the hand-over: miners run rs/49's `courier` to the mule, and the mule hands mithril ore and coal to the smelt account. |
| (c) Grand Exchange | not viable | No sellers of mithril or adamantite bars or ore, or of coal (2026-10-21 05:30 UTC). Coal has a 6.85M-unit buy book at 150 gp, steel bars a 700 gp bid, adamantite bars 1,666 gp, adamantite ore 1,148 gp. Selling surplus coal is how the role funds pickaxes. A standing buy offer for mithril bars or ore, funded by the coal surplus, is cheap to try (rs/50's buyer). |
| Superheat Item | does not win | Magic 43 plus a nature rune and 4 fire runes per bar. It saves only the furnace walk, under 5% of the hour. Not built. |

Adamant bars need Smithing 70, which the smelters reached on the way through mithril
(h20-h23 are at 70-89), and adamantite ore, which the guild does not have: see the two
adamantite sites above.

## What the fleet needs

- **Adamantite (the open line):** one `full` account per adamantite site,
  `{"mode":"full"}` (Dwarven Mine) and `{"mode":"full","addy":"alkharid"}`. Mithril is
  over target, so no account needs to stay in the guild for it.
- **Steel and iron:** `{"steel":N,"iron":M}` on any account with Smithing 30, which
  buys the iron ore on the exchange; about 950 steel bars per account-hour.
- **Mithril (when needed again):** `{"mode":"full"}` on 3-4 accounts. If the fleet already runs
  couriers to the mule, use `{"mode":"mine"}` miners plus one `{"mode":"smelt"}`
  account fed by the mule. More than 4 accounts in the guild crowds a contested spawn.
- One lite client per account. The role logs `phase`, `bank`, `inventory` (with
  `outcomes`, `waited`, `pickaxe` and `players`), `smelt session`, `smelt trip`,
  `pickaxe trip`, `ge sell`, `ge collect`, `buy pickaxe` and `cycle error`. Errors are
  caught and the cycle re-plans; only the fleet signal stops the role.
- Behind a loopback gateway, the role calls `pointMarketAtServer` (from `mule.ts`) so
  the Grand Exchange calls reach the demo server.
- Accounts and state at hand-over: see the rs/45 PR.

## Gotchas

- **Death costs the pickaxe** if ore in the inventory outranks it. Never route through
  the Dwarven Mine's south entrance.
- **Stopping the role process can log out the lite client**, so a restart can cost a
  login. The demo locks an account out (`code 16`) after too many logins: back off
  exponentially, and wait 10 minutes or more after a lockout.
- **`ctx.log` data must not carry a `message` key**; it overwrites the line's message.
- **`runStandalone` discards errors**, so the role catches its own.
- **Measure smelting by ore consumed.** Bars plus ore stays constant on a success, which
  reads as a stall if you count bars.
- Re-clicking a rock does not reset the roll timer (`mining_firstswing` only sets
  `%action_delay` once it has passed), so the role's re-click after 4 still ticks costs
  nothing.
