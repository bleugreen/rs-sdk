# Bar supplier (miner and smelter)

`speedrun/helpers/smelter.ts` (role `smelter`) takes a fresh demo account to the Mining
and Smithing levels it needs, mines ore and coal around Falador and in the Mining Guild,
smelts mithril bars (adamantite when the account can) at the Falador furnace, and banks
everything. The same module covers both halves of a split pipeline through its `mode`
option, so there is no separate `miner.ts`.

```
ROLE_OPTIONS='{"mode":"full"}' bun speedrun/helpers/smelter.ts cairn_h20
```

## Options

| Option | Values (default first) | Meaning |
|---|---|---|
| `mode` | `full`, `mine`, `smelt` | `full`: train Mining and Smithing, mine, smelt, bank bars. `mine`: train Mining only and bank ore and coal for someone else to smelt. `smelt`: smelt whatever ore is in this account's bank (handed over by trade), otherwise idle and re-read the bank every 100 ticks. |
| `tier` | `auto`, `mithril`, `adamant` | Which bars to smelt. `auto` smelts adamantite when the account has Smithing 70 and the ore, else mithril. |
| `site` | `auto`, `guild`, `west`, `rimmington`, `barbarian` | Where to mine. `auto`: the west Falador mine below Mining 60 (Rimmington when it is camped), the Mining Guild from 60. `barbarian` is coal only (see the measurements before using it). |
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
| h20 | full | Smithing 1 to 16 on 14 bronze bars, 16 to 30 on 17 iron bars (half of iron smelts fail without a Ring of Forging), 30 to 49 on 54 steel bars. Fresh to Smithing 49 and Mining 79 took 1 h 47 min wall, including a death, a lost pickaxe, a login lockout and restarts; a clean run is about 1 h 15 min. |

Smithing rose faster than the content files predict: steel smelting is 17.5 xp
(`smelting.struct`) times `NODE_XPRATE=25`, yet 54 steel bars took Smithing 30 to 49,
which needs about 1,400 xp per bar. The cause is not known; count Smithing training in
bars, as above, not in computed xp.

### Production rates

| What | Measured |
|---|---|
| Guild, bronze pickaxe (h20, h21) | 27 ore per inventory in 2,016 and 3,273 ticks (17-18 coal, 9 mithril each) |
| Guild, adamant pickaxe, 65-73 other players in view (h20, h21) | 25-27 ore per inventory in 1,273-2,089 ticks: 22-26 coal and 1-3 mithril. Per inventory, 113-216 rocks were depleted by someone else before we got ore and 14-25 times we left coal for a live mithril rock. Bank to bank about 7-11 min, so ~150-225 coal and ~10-20 mithril per account-hour. |
| Barbarian Village coal, adamant pickaxe, 23 players (h21) | 27 coal in 1,842 ticks, 908 of them waiting for a live rock: ~165 coal per hour, no mithril. Worse than the guild; keep it for when the guild is even more crowded. |
| West Falador mine, adamant pickaxe (h20) | 26-27 iron and coal in 370-542 ticks (5-11 players) |
| Steel smelting trip, west bank to furnace and back | 9 bars in 131-176 ticks |
| Smelting cadence | one bar per 4-5 ticks (`smelting_ore` re-queues with delay 4) |
| Grand Exchange plus Nurmof upgrade trip | Falador east bank to the exchange to Nurmof: about 2 min wall. Sold 23 coal (3,278 gp after tax) and 18 steel bars (11,970 gp), both filled at once against the bid book. |

### The constraint is mithril ore

A mithril bar is 1 mithril ore and 4 coal. In the camped guild an account mines 10-20
mithril and 150-225 coal per hour, so it has three to four times the coal its mithril
needs. **Bars per account-hour equal mithril ore per account-hour: about 10-20 at
current contention**, whichever route turns them into bars. Smelting is cheap by
comparison: 5 mithril bars per furnace trip in about 125 ticks, roughly 25 ticks per
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
| Underground 3312-3324, 9462-9468 | 0, 6, 6 | Access not yet identified |
| Heroes' Guild and Gnome Stronghold dungeons | 11, 2, 2-3 each | Quest-gated |

The 6-mithril, 6-adamantite cluster is the one worth identifying next.

### Routes compared

| Route | Bars per account-hour | Notes |
|---|---|---|
| (a) `full` on every account | 10-20 | Self-contained. Smithing training costs about an hour per account, but it runs while Mining trains, and the steel bars it makes fund the pickaxe upgrades. |
| (b) split: `mine` miners plus one `smelt` account | 10-20 per miner; one smelter covers 20 or more miners | Miners skip Smithing (about 25 min fresh to the guild instead of about 75). Needs the hand-over: miners run rs/49's `courier` to the mule, and the mule hands mithril ore and coal to the smelt account. |
| (c) Grand Exchange | not viable | No sellers of mithril or adamantite bars or ore, or of coal (2026-10-21 05:30 UTC). Coal has a 6.85M-unit buy book at 150 gp, steel bars a 700 gp bid, adamantite bars 1,666 gp, adamantite ore 1,148 gp. Selling surplus coal is how the role funds pickaxes. A standing buy offer for mithril bars or ore, funded by the coal surplus, is cheap to try (rs/50's buyer). |
| Superheat Item | does not win | Magic 43 plus a nature rune and 4 fire runes per bar. It saves only the furnace walk, under 5% of the hour. Not built. |

Adamant bars are not practical yet. They need Smithing 70 (on content-file xp, about
850 mithril bars smelted from 50; fewer if the observed xp surplus holds) and
adamantite ore, which the guild does not have. The role mines adamantite whenever a
rock is live, banks it, and smelts it once `tier` and Smithing allow.

## What the fleet needs

- **Recommended:** `{"mode":"full"}` on 3-4 accounts. If the fleet already runs
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
