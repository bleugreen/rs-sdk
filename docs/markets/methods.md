# Wealth methods: measured rates per login at 400 ms

What one login earns an hour by each known wealth method, in two units, measured in the local lab
at the demo's 400 ms tick (markets Q2b, rs/502). Code: `markets/methods/` (the loops, the trip
accounting and the valuation), `markets/methods/lab/rate.ts` (the harness) and
`markets/methods/lab/parallel.ts` (several bots against one lab engine).

## Units

- **Board value an hour.** The demo's wealth board is the sum of `ObjType.cost x count` over the
  bank only (`server/engine/src/server/login/LoginServer.ts`, 'Update bank hiscore'). A note counts
  at its item's cost and coins count 1 each. Items in the pack, worn or on the GE count nothing.
  So a rate here is the change in the bank's board value between two bank visits, which includes
  the walk to the bank and back, and nets out everything the loop consumed from the bank (sharks
  eaten are -300 each).
- **Coins an hour.** The output sold at its best realistic outlet: coins as they come, a standing
  GE bid (the seller pays 5%, `gross - floor(gross/20)`), High Alchemy (60% of cost, less a nature
  rune), or a shop. The GE side was read from the public book (`markets/tools/bids.ts`,
  2026-10-23 01:28Z); the book gives each item's best and mean bid, not its levels, so a sale larger
  than the best bid's depth realises between the two. Whether those bids are real and fill on the
  demo is live probe 1 (below); every 'into the bid' figure rests on it.

A rate is per login: each account's own loop, alone in the lab. Several logins on one method
scale linearly unless a row says it is capped by a world clock (a shared shop restock) or by a
finite bid book (its depth is given in login-hours).

## Where and how measured

- **Host** executor fedora (Linux, 32 cores), one-minute load 2.8-4.5 during the runs;
  `NODE_TICKRATE=400`, measured 400.1 ms a tick over every run. Port blocks M3 (pickpocketing) and
  M4 (gathering), both labs side by side, 2026-10-22 22:59Z; reruns on M3 later the same night.
- **Staging** by staff cheats only (`speedrun/lab/setup.ts`: `::setstat`, `::give`, `setvar`):
  level 99 in the skill unless a row says otherwise, 70 Attack/Strength/Defence, the best tool
  (rune pickaxe or axe, harpoon, big net, staff of fire) wielded, food as noted seeded into the
  bank. Every account starts at its bank, so the first trip includes the walk out.
- **Direct path.** Every loop is a lite client on a local gateway (LAB.md 'Direct path and
  relay'). The click-every-tick loops (pickpocketing, alchemy) do not react to state, so the
  demo's relay costs them little (thieving.md section 4 measured the 300 ms cadence unchanged
  on the demo). The reactive loops (fishing re-clicks, mining and woodcutting rock choice, the bank
  visit) pay one relay delay a decision: a few ticks a trip, a few percent at most.
- **n and spread** are over trips, a trip being one bank visit to the next. `board/h by trip` is
  each trip's own rate; the headline is total board over total trip ticks.
- **Runs.** 6,000 ticks (40 minutes) each unless noted; the lab cannot speed this up (one engine
  tick is 400 ms of wall time).

## The table

m = measured in the lab, i = inferred (named model or arithmetic on measured parts).

| Method | Inputs | Board / h / login | Coins / h / login (outlet) | n trips | Spread (board / h by trip) | Basis | Scaling | Competes with the speedrun |
|---|---|---|---|---|---|---|---|---|
| **Knights of Ardougne**, East Ardougne market, 70 HP, 4 sharks a trip | Thieving 55 (99 here), food | **133,900** | **142,000** (coins) | 4 | 130,100-139,200, sd 4,300 | m, fedora | with logins; 4 knights in the market, crowded on the demo (157 accounts stood in the market at 22:4xZ, candidates.md) | **the scored run's S18 pickpockets these knights**: keep off them on run day; sharks (27/h) |
| Knights, 10 HP, a full pack of sharks | Thieving 55 (99 here) | 104,400 | 149,000 (coins) | 3 | 88,100-116,500 | m, fedora | with logins | 149 sharks/h eaten (a 10 HP account eats on every failure) |
| Knights from 57, 10 HP, full pack | Thieving 57 | 73,900 | 126,100 (coins) | 4 | 3,400-99,300 (the first trip at 57-80) | m, fedora | | as above; the level reaches 99 within ~2,000 ticks at 25x xp |
| Knights 99, 99 HP, full pack (banks at 50,000 carried) | Thieving 99 | 134,000 | 142,100 (coins) | 2 | 127,900-140,600 | m, fedora (7,500 ticks) | as above | 27 sharks/h |
| Knights from 70 / from 85, 70 HP, full pack | Thieving 70 / 85 | 134,500 / 138,300 | 142,600 / 146,200 (coins) | 2 / 2 | 127,300-142,200 / 135,800-140,900 | m, fedora (7,500 ticks) | as above | both at 99 before their first bank visit |
| **Guards**, Varrock (fleet earner `speedrun/helpers/coins.ts`), 10 HP, kebabs from Al-Kharid | Thieving 40 (99 here), 300 coins | 62,900 | 62,900 (coins) | 17 | 23,300-90,600, mean 71,800 | m, fedora | with logins | fleet logins; Al-Kharid kebab shop and toll |
| Al-Kharid warriors (coins.ts), 10 HP | Thieving 25 (99 here) | 46,200 | 46,200 (coins) | 12 | -4,200 (a death) to 62,700 | m, fedora | with logins | as guards |
| Paladins, East Ardougne market, 70 HP, 4 sharks a trip | Thieving 70 (99 here) | 56,400 | 58,400 (coins) + 1,459 chaos runes (no bid; board 15 each) | 13 | 23,200-94,500, sd 19,800 | m, fedora | 2 paladins in the market | 80 sharks/h |
| Paladins 99, 99 HP, full pack | Thieving 70 (99 here) | 65,200 | 65,900 (coins) + 1,750 chaos runes | 2 | 54,000-75,300 | m, fedora (7,500 ticks) | 2 paladins in the market | 90 sharks/h |
| **Heroes**, East Ardougne market, 99 HP, full pack | Thieving 80 (99 here), food | 84,300 | 106,200 (coins) + ~9,000 blood runes (14.7/h, mean bid 663) + 4 diamonds/h (bid 4,500, 11 deep) + 42.7 death runes, 4 fire orbs, 28 jugs of wine | 3 | 80,600-90,600, sd 5,500 | m, fedora (7,500 ticks); success 0.431 against the model's 0.395 (860 rolls) | 3 heroes, spread across the market (the loop walks their spawns) | 112 sharks/h: food is a third of the gross |
| Men, farmers, watchmen (model) | Thieving 1 / 10 / 65 | men 4,100 at 1, 10,100 at 99; farmers 8,900 at 10, 29,000 at 99; watchmen 39,000 at 65 | same, coins | | | i: `value.ts` `pickpocketPerTick`, no walking | | worth nothing beside guards and knights, which a fresh account reaches in minutes at 25x xp |
| **Rune essence**, Varrock east mine (fleet `speedrun/helpers/essence.ts`) | Mining 1 (99 here), Rune Mysteries, pickaxe | 6,200 | **81,100** (bid 55, 471,638 deep: ~300 login-hours) | 18 | 5,860-6,420, sd 162 | m, fedora (3,000 ticks) | with logins until the bid is filled | the run's essence (63,674) is already held; logins |
| **Swordfish and tuna**, Catherby, harpoon | Fishing 50 (99 here), harpoon | **74,300** | ~27,000 (High Alchemy, the cast time charged) | 12 | 54,500-103,700, sd 13,700 | m, fedora | with logins; 2 harpoon spots | logins |
| **Sharks**, Catherby, harpoon | Fishing 76 (99 here), harpoon | 59,400 | ~28,500 (High Alchemy: 180 less a nature, 11% of the hour casting); up to ~100,000 cooked and sold at the GE's traded price (~506 net, before burns and cooking time), which trades ~548 an hour world-wide (candidates.md) | 4 | 52,400-68,800, sd 7,800 | m, fedora | with logins; 3 net/harpoon spots | logins; the run's sharks come from helper stock, not this |
| **Yew logs**, Seers' Village | Woodcutting 60 (99 here), rune axe | 57,900 | **~137,000 at the GE's traded price** (~379 net; ~2,100 an hour trade world-wide, so ~6 logins' worth; candidates.md); ~22,900 alched | 8 | 49,600-66,600, sd 5,800 | m, fedora | with logins | logins; the run's 24 yew are staged |
| Magic logs, Seers' Village | Woodcutting 75 (99 here), rune axe | 51,400 | ~25,300 alched; the GE pays ~2,137 net but trades only ~57 an hour world-wide (candidates.md), ~122,000 for the first login's 57 | 3 | 43,100-60,900 | m, fedora | with logins | logins |
| Coal and mithril, Mining Guild | Mining 60 (99 here), rune pickaxe | 37,300 | 27,000-58,000: coal 471/h at 80 best / 12.4 mean, mithril alched, **6.1 uncut gems/h at 2,500** (14,500) | 14 | 22,500-45,000, sd 5,200 | m, fedora | coal bid 6.8M deep but mostly far below 80 | logins |
| Adamantite and coal, north Dwarven Mine | Mining 70 (99 here), combat 65+ | 25,600 | 39,000-57,000: 33 adamantite/h at 1,148 (18,161 deep) + coal | 7 | 18,200-39,800 | m, fedora | 3 rocks shared with every miner | **yes: adamantite is the run's scarce bar input**; do not sell it |
| Bass, Catherby, big net | Fishing 46 (99 here), big net | 22,500 (all of the catch banked) / 16,700 (bass, oysters and caskets only) | under 15,000 | 13 / 3 | 7,000-57,000 | m, fedora | | none |
| **Iron ore**, Ardougne zoo cluster (6 rocks), Ardougne south bank | Mining 63 (every roll succeeds), pickaxe | ~26,000 | **~115,000** (bid 80, 998,385 deep: ~650 login-hours) | | | i: 3.61 ticks an ore (mining.md, SDK loop on adjacent rocks) and a ~60-tick bank trip, 27 a trip | with logins; 6 rocks hold 2-3 miners before respawn binds | the run's ~150 iron ore an attempt is staged; logins |
| Rune crafting from mined essence, air at 99 | Runecraft 99 (air 10 runes an essence), essence | ~36,000 | air bid 4: ~34,000; **fire 3/ess at 40, ~100,000 until 19,857 runes are sold (~7 login-hours); water 6/ess at 35, ~180,000 for ~3,400 essence (~4 login-hours)** | | | i: 40 board an essence; ~900 essence an hour mined and crafted | the elemental bids are shallow | logins |
| **High Alchemy**, any noted stack, staff of fire | Magic 55, nature runes | **always negative**: -0.4 x cost - the nature, a cast | 1,800 casts/h; profit = 0.6 x cost - buy - nature | | all 599 gaps exactly 5 ticks (600 casts) | m, fedora (3,000 ticks) | with logins | nature runes (run supply; Magic Guild stock, GE ask 621) |
| Low Alchemy | Magic 21 | negative | 3,000 casts/h | | all 199 gaps exactly 3 ticks | m, fedora (600 ticks) | | |
| **Knights, crowding** (rs/543): 1 / 2 / 4 / 8 bots on the 4 market knights, 99 HP | Thieving 99 | 123-131k | **130.6k / 128.7k / 126.0k / 131.5k coins per login** (no loss to 8 bots) | 2,400 ticks a bot-run, 15 bot-runs | 95.7k-144.3k at 8 | m, bgsrv-ub, 401-553 ms/tick (load; per-tick rate unchanged); `phase2.md` | none measured to 8; live at 50-100 players nearby no loss either | after-run-only (S18) |
| **Knights, live** (markets' probe, rs/543's analysis) | Thieving 99, 10 HP, market Baker | | 95k wall clock; **124k at the knights**, 118.5k with the food stops removed; 3.64 ticks a success, 5.7% failures | 9,143 ticks | | L, 400.4 ms/tick | coins per tick rise with players nearby (+0.18/player, r 0.53): no crowding | the Baker was usually sold out: 19.6% of ticks on food |
| **Heroes, crowding** (rs/543): 1 / 2 / 4 / 8 bots on the 3 heroes, 99 HP | Thieving 99, 105-114 sharks/h | 66-77k | **91.0k / 94.1k / 95.3k / 96.3k coins per login** + ~45 death, ~15 blood runes/h | 3,000 ticks a bot-run, 15 bot-runs | 79.5k-114.4k at 8 | m, bgsrv-ub, 400 ms/tick | none measured to 8 | sharks are a third of the gross |
| **Shilo gem rocks** (rs/543), respawn emulated at 1,400 players (129 ticks seen) | Mining 99 (40 with adamant: 359/h), Shilo Village | 16.2k (1 bot) | **399 gems/h alone; 229 a login with 2, 116 with 4** (site ~465/h); 1,291 coins a gem with the jade bid, 735 after (opal's bid is gone) | 2,709 ticks a run; 4 trips at 1 bot | 15.2k-18.0k board by trip | m, bgsrv-ub, 400.1 ms/tick | **world clock: the site supports 1 login** | after-run-only (S25c's gems) |
| **Iron ore with its bank trip** (rs/543; supersedes the i row above) | Mining 99, rune pickaxe, zoo cluster, Ardougne south bank | 20.5k | **1,208 ore/h**: 92k at the bid's 80 mean, up to 126k at its 110 best | 4 trips, 909 ticks | 19.4k-24.5k board by trip, sd 2.3k | m, bgsrv-ub, 401 ms/tick | ~2-3 logins a 6-rock cluster (i); bid 993,853 deep | after-run-only (S18e iron ore) |
| **Steel bars, smelting leg** (rs/543): smelter.ts smelt mode, Falador west bank and furnace | Smithing 30 (99 here), banked iron ore and coal | -5.8k (bars count 100, ore and coal 17 + 90) | **845 bars/h**; full loop with iron and coal mined ~160 bars/h, **208k** at the 1,369 flow (i) | 9 trips | sd 2% | m, bgsrv-ub, 400.6 ms/tick | flow 74,175 a week (~441/h world): 1 login | none |
| Runite, lone rock 47_160 (rs/543) | Mining 85, Wilderness | | **not measured** (bots stalled in the Lava Maze dungeon); ~5.6 ore/h, second login +1.5% (i, content) | | | i | world clock | none |
| Hitpoints training, fresh account (rs/543) | bones.ts cow training | | HP 30 at tick 981, **40 at 1,822**, 50 at 3,308, 55 at 4,371 | 4,500 ticks | | m, bgsrv-ub, 402.7 ms/tick | | |
| **Irksol's ruby rings**, Zanaris | Lost City; ~1,012 a ring | ~18,200 (+1,013 a ring) | ~7,300 to Grum's gold shop (buy 700: 1,417 a ring); ~3,300 alched | | | i: content arithmetic | **capped by a world clock**: 5 on the shelf, 1 back each 500 ticks, 18 an hour for the whole world | the run's ruby ring is staged |

## What the table says

- **Knights of Ardougne at Thieving 99 lead both units**: ~134,000 board and ~142,000 coins an
  hour per login, with nothing needed but a few sharks. Two runs with different food plans (70 HP
  with 4 sharks a trip, 99 HP with a full pack) agree to 0.1% over six trips, and runs started at
  70 and 85 land on the same rate. Heroes earn fewer coins (106,000 plus ~26,000 of loot at the
  bids) and eat four times the sharks; paladins earn half. A fresh account reaches 99 in about
  2,800 ticks (thieving.md) at the server's 25x xp, so the low rows are transient. The model
  (`value.ts`, no walking) gives 167,600 coins an hour at 99; the measured loop keeps 85% of it
  after walking to the knights, wandering targets and the bank trips. Food is the lever on board
  value: every shark eaten is 300 off the board, so a 10 HP account eating 149 sharks an hour
  banks 104,000 against the 70 HP account's 134,000 on the same coins.
- **Fishing, woodcutting and paladins bank ~50,000-75,000 board an hour**, about half the
  knights. Raw fish and logs have no standing bid; High Alchemy halves them again in coins, but
  the GE's traded prices are far above cost (yew ~379, magic ~2,137, cooked shark ~506), so a
  few logins can sell into the weekly flow for more coins than alching (yew ~137,000 an hour).
  The sibling scan (`docs/markets/candidates.md`, rs/501, PR #432) ranks those flows and caps.
- **For coins, the GE's standing bids beat everything except knights**: essence at 55 (cost 4)
  gives ~81,000 an hour from a level-1 skill, and iron ore at 80 (cost 17) about 115,000 (i).
  Both books are deep enough for hundreds of login-hours. These bids sit far above store cost; who
  placed them and whether they fill on the demo is the question live probe 1 answers.
- **No generator here.** High Alchemy loses board value on every cast, and every shop sells at or
  above cost except Irksol (500) and Tiadeche (550), so alching shop stock loses coins too. The
  one positive loop, Irksol's rings resold to Grum or alched, is about 18 rings an hour for the
  whole world (`docs/markets/generator-content-shops.md` section 6 rules it out as a generator).
- **Against the scan's recommendations** (`candidates.md` 'Recommended for lab measurement'):
  this table measures its knights (#8; 142,000 coins here against its 111,000 estimate), heroes
  (#9), yew (#7: 362 logs an hour) and sharks (#10, raw only; cooking and burns not measured).
  Its #1 (charging water orbs into battlestaves), #2 (Shilo gem rocks), #3 (runite bars), #4
  (steel bars), #5 (adamantite at the 13-rock site) and #6 (iron ore with its bank trip) remain.
- **Rows not measured** and still worth a lab run, in order of value: iron ore (the deepest coin
  outlet), fire and water rune crafting into the shallow elemental bids, and gem mining (every
  uncut gem bids 2,500, ~43,000 units across the six; the Mining Guild run found 6.1 an hour
  without a glory). Big bones (bid 1,000, 4,989 deep) and the beads (1,000-5,000, ~14,600 deep)
  are combat drops no loop here covers. Master farmers pay seeds worth little on the board.

## Live probes requested

No account here logs in to the demo (tenet 28). rs/495 trimmed and forwarded four probes to
markets (cairn://p/rs/495/1/coordinator/messages, 2026-10-22 15:12 PDT); the runners for 1 and 3
are `markets/methods/probe-coal.ts` and `probe-knights.ts` (docs/markets/probes.md):

1. Five units each into the coal (80) and uncut ruby (2,500) bids: filled or not, time to fill,
   coins received. Whether the bids are real.
2. Irksol's shelf read every 500 ticks for an hour, buying nothing: whether other players drain it.
3. Knights at Thieving 99 for 30 minutes: gp a tick, failures, players within 5 tiles. The demo
   rate against this table's 142,000, relay and crowding included.
4. The Magic Guild's nature rune shelf and first price: the nature cost behind every alch figure.

## Reproducing

```sh
NODE_TICKRATE=400 WEB_PORT=9920 WEB_MANAGEMENT_PORT=9921 HISCORES_WEB_PORT=9922 NODE_PORT=44920 \
  AGENT_PORT=7704 LAB_FRIEND_PORT=45920 LAB_HELPERS="b2 b3" speedrun/lab/lab.sh b1 \
  'markets/methods/lab/parallel.ts:b1=knight,--ticks=6000,--hp=70,--foodPerTrip=4:b2=shark,--ticks=6000:b3=essence,--ticks=3000'
```

`rate.ts --method=` takes knight, paladin, hero, guard, warrior, essence, shark, swordfish,
lobster, bass, yew, magic, coal, adamant, alch, and (rs/543) shilo, iron, runite and steel, with `--thieving`, `--hp`, `--foodPerTrip`,
`--keep` (fishing) and `--spell` (alchemy). Each bot prints `RESULT trips` and `RESULT summary`
lines; a fresh build slot needs the four `bun install`s and the engine build first.
