# Wealth candidates: what earns board value on the demo

markets Q2a (rs/501, under rs/495). A ranked list of ways to raise a login's bank-board value,
computed from the game content and one snapshot of the Grand Exchange book by a committed,
tested scanner. Its purpose is to pick what a lab child measures next.

## What the board counts, and the one fact that shapes the ranking

The bank board values a bank as the sum of `ObjType.cost x count` over its slots, bank only, one
slot capped at 2,147,483,647 (`server/engine/src/server/login/LoginServer.ts`). Coins have cost 1,
so **a coin is one unit of board value**. A note copies its item's cost (`ObjConfig.ts`, the cert
links to its item) and the bank always stores the unnoted item, so noting never changes the board.

The GE book read at 22:30Z 2026-10-22 (`data/ge-book-2026-10-22T2230Z.json`) shows the market
paying **3 to 100 times store cost** for almost everything: nature runes ask 621 against a cost
of 20, yew logs trade at 423 against 160, uncut sapphires are bid 2,500 against 25. Two
consequences run through every row below:

- **Holding coins beats holding almost any item.** Nothing of size is offered below store cost
  (the best is 10 mithril square shields at 1,248 against 1,560, worth 3,120 once), so buying on
  the GE loses board value. Until a slot nears the 2.15B coin cap, the job is coins per hour.
- **The real sources are the deep standing bids and the weekly flow.** A method's board rate is
  the larger of its banked store cost and the coins its output fetches, and the coins nearly
  always win.

Past the coin cap a bank needs item stacks. The board-per-coin options for that are in the shop
section and the battlestaff row.

## Units, rates and how to regenerate

Every per-hour figure is **per login, at 400 ms a tick (9,000 ticks an hour)**, the demo's tick:
public boards and rs/515 (`demo-revision.md`) show 400 ms ticks since 2026-10-22 19:56Z, and
markets' live probes measured 400.2-400.4 ms. (History: when this scan was written the committed
`fly.toml` said `NODE_TICKRATE=300` and coins.md had measured 302 ms; at 300 ms, rates bounded by a
login or a world clock would be 4/3 higher.) GE weekly-flow caps do not scale with the tick. Each rate is marked **measured** (a cycle measured in
`docs/speedrun/skills/*.md` or `helpers/coins.md`) or **estimated** (derived from content, a
measured xp rate, or an assumed bank trip of 40 ticks per 27 items).

```
bun markets/scan/ge-book.ts          # one gentle book snapshot (2 paged reads, 4 s apart) -> docs/markets/data/ge-book-<stamp>.json
bun markets/scan/scan.ts             # content + newest book -> docs/markets/data/scan-<date>.json (no network)
bun markets/scan/scan.ts --tick=300  # the same at the demo's configured tick
bun markets/scan/headcount.ts        # public /playerpositions headcount at the rock sites, every 5 min
bun test markets/
```

`markets/scan/` holds the scanner. `content.ts` parses objs, shops (`.inv` stock plus the owning
NPC's params or a script's `~openshop` call), map spawns, rock, thieving and runecraft tables.
`recipes.ts` reads the processing tables, `methods.ts` ports the shop, alchemy and thieving
formulas, `rank.ts` assembles the candidates, `ge-book.ts` reads the book and `scan.ts` writes the
report. The formulas it ports:

- **Shop price** (`shop.rs2` `calc_shop_value`): `max(100, multiplier - clamp((stock - base) x
  delta, -5000, 1000)) x cost / 1000`, truncated. A general store prices an unlisted item on its
  whole stock. A purchase never costs under 1 gp. So a shelf at base sells at its multiplier;
  each unit under base adds `delta` per mille, up to 6x; overstock falls to 0.1x.
- **Restock** (`World.ts`): +1 unit when the world tick is a multiple of the line's `stockrate`,
  so it is a shared clock and does not scale with logins. A general store's unlisted stock
  decays one unit every 100 ticks.
- **High alchemy** (`alchemy.rs2`): `max(1, 0.6 x cost)`.
- **Rock respawn** (`player_count.rs2` `scale_by_playercount`): `base x (4000 - min(players,
  2000)) / 4000`. That is 0.65x at the demo's ~1,400 players: iron 20 to 13 ticks (mining.md
  measured 13), gem rock 200 to 130, runite 2,400 to 1,560. One login works one site, so
  per-login rates use the best site's rock count; the world rate uses all rocks.
- **Pickpocket loot** (`thieving.rs2`): entries roll last first, each against the weight left;
  once the weight is spent every remaining entry is awarded. The modelled gp per tick is scaled
  by the guards' measured/modelled ratio (7.4 / 11.44).
- **GE**: sellers pay 5%. A row is priced at the better of the best bid (when the bid depth
  sits at the best price) and the week's flow (the lower of the 7-day mean and the best ask),
  with flow sales capped at a week's volume spread over 168 hours.

## Ranked candidates

`board/h` is the banked store-cost value per login-hour and `coins/h` the value selling the output
where `sell to` says. Ranked by the larger of the two. Scaling is one of: **logins** (each
login adds the full rate), **world clock** (a shared respawn or restock caps every login
together), **GE bid depth** or **GE weekly flow** (the market absorbs a fixed amount).

| # | Method | Inputs | board/h | coins/h | Sell to | Scaling and cap | Speedrun conflict | Basis |
|---|---|---|---|---|---|---|---|---|
| 1 | Buy battlestaves, attach charged water orbs, bank | Crafting 54, Magic 56 (Charge Water Orb at the obelisk), 7,000 coins a staff, unpowered orbs, cosmic + water runes | **1.56M** | 0 (no market) | bank | world clock: battlestaff restock 190/h (Zaff 5 per 100 ticks, Magic Guild 5 per 90); orb casting time unmeasured. **Assumes base stock**: 1.51M at half shelves, 1.47M at empty | low | estimated |
| 2 | Mine Shilo gem rocks, sell uncut gems into their bids | Mining 40, Shilo Village, pickaxe | 16k | **1.08M** | GE bids ~2,500 (diamond 3,500) | world clock: 7 rocks at one site, 447 gems/h world-wide; bids 37,663 gems (opal's 2,342 fill first). Shared with whoever mines there: one regular in the headcount, so about 540k a new login | medium: S25c's gems | estimated |
| 3 | Mine runite ore + 8 coal, smelt runite bars, sell | Mining 85, Smithing 85 | 56k | **438k** | GE bid 41,005 (38,954 net), 2,017 deep | world clock: 5 rocks, best site 2, 28 ore/h world-wide; two sites camped (12-15 and 1-3 accounts in the headcount); the lone rock at 47_160 was empty all hour, about 220k from it alone | none | estimated |
| 4 | Mine iron + 2 coal, smelt steel bars, sell | Mining 30, Smithing 30 | 33k | **423k** | GE flow ~1,369 (1,300 net) | GE weekly flow: 73,672 a week (438/h world-wide); 321 bars/h a login | none known (S27's cannonballs) | estimated |
| 5 | Mine adamantite ore, sell | Mining 70 | 85k | **232k** | GE bid 1,148 (1,090 net) | GE bid depth 18,226 ore; 55 rocks, best site 13, 901/h world-wide | none | estimated |
| 6 | Mine iron ore, sell | Mining 15 | 34k | **205k** | GE flow ~108 (102 net); bid 80 for 999,283 | GE weekly flow 552,355 a week (3,288/h) | low | measured cycle (3.0 ticks an ore, demo); bank trip estimated |
| 7 | Mine adamantite + 6 coal, smelt bars, sell | Mining 70, Smithing 70 | 64k | 157k | GE bid 1,666 (1,582 net) | GE bid depth 24,886 bars | none | estimated |
| 8 | Cut yew logs, sell | Woodcutting 60 | 59k | 141k | GE flow ~399 (379 net) | GE weekly flow 352,894 a week (2,101/h) | low (S03's 24 yew) | estimated |
| 9 | Cut magic logs, sell | Woodcutting 75 | 60k | 122k | GE flow ~2,250 (2,137 net) | GE weekly flow 9,590 a week (57/h world-wide): the market, not the axe, is the cap | low (S03's 107 magic) | estimated |
| 10 | Pickpocket Knights of Ardougne | Thieving 55, food | 111k | 111k | coins | logins | **high**: S18 pickpockets these knights on run day; 157 accounts stood in the market at 22:4xZ | estimated (model x guards' ratio) |
| 11 | Pickpocket heroes | Thieving 80, food | 79k | 107k | coins + death, blood runes, diamonds at market | logins | low | estimated |
| 12 | Pickpocket rogues | Thieving 32, food | 80k | 98k | coins | logins | low | estimated |
| 13 | Mine gold ore, bank | Mining 40 | 96k | 0 (no market) | bank | logins (44 rocks, 2,826/h world-wide) | none | estimated |
| 14 | Harpoon and cook sharks, sell | Fishing 76, Cooking 80 | 55k | 93k | GE flow ~533 (506 net) | GE weekly flow 92,018 a week (548/h) | medium: the fleet buys sharks | estimated (fishing.md's measured xp rate; burns not deducted) |
| 15 | Pickpocket vikings | Thieving 45, food | 89k | 89k | coins | logins | low | estimated |
| 16 | Mine mithril ore, bank | Mining 55 | 88k | 0 | bank | logins | none | estimated |
| 17 | Buy raw karambwan at Tiadeche's stall, bank | Tai Bwo Wannai Trio, 110 coins each | 81k | -99k spent | bank (200 board for 110 coins, 1.82 a coin) | world clock: 900/h. **Assumes base stock**: worth nothing once the shelf is 11 under base | none | estimated |
| 18 | Buy law runes at rune shops as they restock, sell | coins; Magic Guild, Lundail | 0 | 75k | GE flow ~2,068 (1,964 net) | world clock 60/h, GE flow 39/h; a one-off 2.22M buying full shelves down to the GE price. **Assumes base stock**: 68k/h at half, 67k at empty, no one-off | medium | estimated |
| 19 | Mine coal, sell | Mining 30 | 45k | 75k | GE bid 80 (76 net). **Depth unverified beyond 5** | GE bid: every fill in the last 36 h cleared at 80 (8,898 units), behind it 6.85M of mostly cheap bids | none | estimated |
| 20 | Pickpocket paladins | Thieving 70, food | 72k | 72k | coins + chaos runes | logins | low | estimated |
| 21 | Pickpocket guards | Thieving 40, food | 67k | 67k | coins | logins | low (the coins earners use them) | **measured** (coins.md, 7.4 gp a tick) |
| 22 | Buy death runes at four rune shops, sell | coins | 0 | 52k | GE flow ~394 (374 net) | world clock 240/h, GE flow 151/h; one-off 757k. **Assumes base stock**: 31k at half, 29k at empty | low | estimated |
| 23 | Mine rune essence, sell | Rune Mysteries | 3k | 44k | GE flow ~57 (54 net); bid 55 for 522,738 | GE flow 515,804 a week | low: the fleet ledger is complete | measured (coins.md trip rate) |
| 24 | Buy blood runes at the Magic Guild, sell | Magic 66 (to enter), coins | 0 | 36k | GE bid 1,301 (depth unverified) | world clock 30/h; one-off 998k | **high**: the fleet camps this shelf (h88) | estimated |
| 25 | Buy ruby rings from Irksol, bank | coins | 18k | -18k spent | bank (2.00 board a coin) | world clock 18/h. **Assumes base stock** (config only) | none | estimated |

Rows ranked below 25 (nature runes from shops at 34k, raw runite ore, silver, limestone, lobsters
banked, gnomes, watchmen, warriors) are in `data/scan-2026-10-22.json` under `candidates`.

## Recommended for lab measurement

In order. Each says what the estimate rests on, which is what the lab should measure.

1. **Charge water orbs into battlestaves** (#1). The one large *board-value* method, and the
   answer to holding wealth past the coin cap. Measure the Charge Water Orb cycle at the water
   obelisk with its bank trip (orbs an hour per login), and the staff-and-orb combine. The 190
   staves an hour is a world clock, so one or two logins saturate it.
2. **Shilo gem rocks** (#2). Measure gems an hour with all 7 rocks free, at the emulated respawn
   (130 ticks for ~1,400 players), including the Shilo bank trip. The live share comes from the
   headcount below, not the lab.
3. **Steel bars from mined iron and coal** (#4). Measure ticks per bar at the best
   iron-and-coal site with a furnace and bank (for example the Mining Guild and the Falador
   furnace). The 28 ticks a bar is built from three estimates.
4. **Runite bars** (#3). Measure runite plus coal plus smelt at the uncontested single rock in
   map square 47_160 (the headcount found the two-rock sites camped); the rate is respawn-bound,
   so the lab answers the cycle and travel, and the demo answers the contention.
5. **Adamantite ore at the 13-rock site** (#5, #7). Measure ore an hour at map square 43_69.
6. **Iron ore with bank trips** (#6). The roll is measured (3.0 ticks); measure the bank trip.
7. **Yew logs** (#8). Measure logs an hour with a rune axe at 99, banking.
8. **Knights of Ardougne at 99** (#10). Measure gp a tick, including food. The run-day conflict
   with S18 is about the date, not the method.
9. **Heroes at 99** (#11). Measure success, stun and gp a tick; loot sold at market adds about a
   third over coins.
10. **Sharks, fished and cooked** (#14). Measure catches an hour at 99 and the burn rate.

The magic-log row (#9) needs no lab time: its cap is the market's 57 logs an hour, not the axe.

## Live checks requested from the parent (rs/495)

Agreed at 22:4xZ, carried out by markets' own live readers. The doc ships without them.

- **Shelves** (rs/506's read-only shelf reader, before 12:30Z): Zaff, Aubury and Betty are read.
  The Magic Guild, Lundail and Irksol stay **config only**. Their rows above say "assumes base
  stock" and give the half- and empty-shelf values. Restock runs one unit per period whatever
  the shelf holds, so an emptier shelf only prices the hourly units higher and removes the
  one-off.
- **General stores** (same route): Varrock, Lumbridge and Falador, every slot. An item dumped
  in quantity sells at 0.1x cost, which is 10 board value per coin.
- **Coal into the 80 bid** (rs/508): 5 units with the fill time. The row stays "depth unverified
  beyond 5".
- **Shilo gem rocks**: no account qualifies in time, so this is the public headcount below.

## Shilo gem rocks: who is there

Superseded by the 13-hour headcount in `supply-sites.md` (rs/686, 2026-10-24), which also covers the runite rocks.
The one-hour read below stays as the 10-22 baseline.

Thirteen reads of the public `/playerpositions` list, five minutes apart, 22:47Z to 23:47Z
2026-10-22, with 1,258 to 1,424 players online (`data/headcount-2026-10-22T2247Z.json`,
`markets/scan/headcount.ts`). Each box is a few tiles round the site's rocks; standing in it is
not proof of mining, but the names repeat across the hour.

| Site | Rocks | Accounts present (min-max) | Reads with anyone | Regulars |
|---|---|---|---|---|
| Shilo gem rocks | 7 | 0-2 | 10 of 13 | Croesus (9 reads), Dotsbot29 (2) |
| runite, map square 47_60 | 2 | 12-15 | 13 of 13 | the same 11 in every read, up to 4 more |
| runite, map square 45_154 | 2 | 1-3 | 13 of 13 | Tygem020, Tygem050, U238 |
| runite, map square 47_160 | 1 | 0 | 0 of 13 | none |

What it changes in the table:

- **Shilo (#2)** is held by about one account. Sharing 7 rocks with one steady miner leaves a
  new login roughly half the world's 447 gems an hour: about **540k coins an hour**, not 1.08M,
  and less if Croesus clicks faster. Still the second-best row, and the best in coins.
- **Runite (#3)** is camped at two of its three sites. The 438k row assumed a login owns a
  two-rock site; at 47_60 a newcomer is the thirteenth account on two rocks and earns close to
  nothing, and at 45_154 the fourth of four. The **lone rock at 47_160 is free**: one rock at the
  1,560-tick respawn (1,400 players) gives about 5.6 ore an hour, about **220k coins an hour** as
  bars, before travel, which drops runite below steel bars (#4) and adamantite ore (#5). The lab
  should measure that rock, not a two-rock site.

The table and `data/scan-2026-10-22.json` keep the scanner's uncontested figures; the
headcount adjustments above are in the rows' cap text.

## The scan sections

Everything below is in `data/scan-2026-10-22.json`.

**Shops selling below cost.** Of 137 shop openers (126 by NPC params, 11 by script
`~openshop` calls), only three sell under 1,000 per mille: Irksol's ruby rings at 500 (1,012
for a 2,025 ring), Tiadeche's raw karambwan at 550 (110 for 200), and the bandits' duty-free
shop at 900 (1-16 gp items). No NPC shop falls back to `shopkeeper.param`'s 100/60 defaults, and
no shop buys at or above what it sells for.

**Cross-shop arbitrage.** Seven pairs, all from those two shops: Irksol's rings (Irksol stands
underground, at 3247,9589) resold to the Wilderness bandit shop (+203 each, 18 an hour) or to
general stores, and karambwans resold to the bandits (+10). The best is 3,654 coins an hour.
Nothing worth a login.

One NPC, in Regicide, carries two `owned_shop` params; its quest script opens both shops with
explicit `~openshop` multipliers, which the scan reads as script openers.

**High alchemy.** Only Irksol's rings beat a shop price plus a 20 gp nature rune: +183 a cast, 18
an hour, 3,294 coins an hour. **No alch loop profits otherwise**: every other shop sells at 1,000
per mille or more, above the 600 alchemy pays.

**GE asks below store cost.** Seven items, 3,120 board value in total (the mithril shields).
None worth a probe buy.

**GE bids** (93 items with standing bids). The deep ones, with coins committed at the best price:
uncut dragonstone 1,000,000 x 100 (100M; supply is the Taverley crystal chest, no regular
source), grapes 1,000 x 97,804 (97.8M; the only content source is a 1-in-128 goblin drop,
`goblin.rs2`, so it cannot be filled), rune knives 2,010 x 43,459 (87.4M; a runite bar smiths 5
knives, 10,050 at the bid against 41,005 for the bar), runite bars, iron ore 80 x 999,283, uncut
gems ~2,500 x ~9,000 each, adamantite bars and ore, rune essence 55 x 522,738. Several bids look
like the speedrun fleet's own (rune scimitar 47,250 x 2, ranging potions); they are not sources.

**Processing at store cost** (`recipesByBoardValuePerTick`). Content prices some products far
above their inputs: dragonstone 10,000 from a 1,000 uncut, rune platebody 65,000 from 5 bars,
rune arrows 400 from 200 arrowheads at 5 actions a tick. **These matter only where the input has
no market**, because the GE pays more for the inputs than the board counts for the product
(five runite bars fetch 205k at the bid; the platebody counts 65k). The battlestaff row is the
exception: battlestaves come from shops at 1:1 and the product has no market.

**Ground spawns.** The best item spawn is 5 blue dragon scales in Taverley dungeon on a 30-tick
respawn, 75k board an hour if every scale is taken on time. The rest are single items under
45k an hour. No generator.

**Thieving.** Modelled at 99 with the engine's roll order. The coin pickpockets (knights 50,
vikings 40, rogues 25-40, guards 30) all succeed 94% of the time. Heroes (200-300 coins) succeed
39% and gnomes 47%, which their larger loot does not fully repay. Stalls give 0.05-4.8 board a
tick; the gem stall gives 0.05.

## Not scanned

NPC drop tables (scripts under `drop tables/`) beyond the specific items checked here (grapes
from goblins, rune knives from metal dragons), so monster-killing methods (big bones into the
1,000 bid, beads into the 1,000-5,000 bids, dragon bones into the 5,001 bid) are unranked. The
crystal chest (uncut dragonstone), herb supply for the potion bids, and farming are unranked too.
Every market figure is one snapshot; the flows assume this week's demand holds.

## No generator

No shop, alchemy or cross-shop loop profits beyond a few thousand coins an hour, and nothing is
obtainable orders of magnitude faster than its cost implies. The leaders' stacks, if earned in
game, have to come from the market spread above: coins from deep bids and flows, then items
bought at shop base prices past the coin cap.
