# Live probes: knights and coal

Two standalone runners that check rs/502's lab rates against the demo's real crowding and a real
Grand Exchange bid. Each one drives one account through a loopback gateway and its lite client,
samples every 50 game ticks, and leaves the world through `logoutClean` however it ends.

| File | What it is |
|---|---|
| `markets/methods/probe-sampler.ts` | Shared runtime: argument parsing, the 50-tick sampler, the totals line, and the session lifecycle with clean logout on SIGINT/SIGTERM |
| `markets/methods/drive-steps.ts` | Drives a skill module's `steps()` standalone over `runSteps` (`pickSteps`, `driveSteps`) |
| `markets/methods/probe-knights.ts` | Pickpocketing the East Ardougne market knights |
| `markets/methods/probe-coal.ts` | Mining 1 to 30, coal at Barbarian Village, and one capped Exchange sale |

## Running

```sh
bun markets/methods/probe-knights.ts <account> --minutes 60 --out knights.jsonl
bun markets/methods/probe-coal.ts <account> --minutes 60 --sell 5 --floor 80 --out coal.jsonl
```

Run them from the repository root. Each probe attaches to a lite client that is already logged in
(`cd server/webclient && bun src/lite/runner.ts <account>`) through a gateway on loopback
(`GATEWAY_URL=ws://127.0.0.1:<port>` in the account's `bot.env`), the setup
`speedrun/helpers/coins.ts` uses. The demo's public gateway relays state in multi-second bursts,
which breaks the click-every-tick loops, and `lib/session.ts` refuses it for a remote world.

**Accounts and credentials.** The account is any name with a `bots/<account>/bot.env`
(`BOT_USERNAME`, `PASSWORD`, `SERVER`, `GATEWAY_URL`); nothing checks the name's form. The
lite runner and `openSession` both read that path, so to keep credentials outside the checkout,
make `bots/<account>` a symlink to a directory outside it. `bots/*/` is ignored by git either way.
No host address belongs in any committed file.

**Ending a run.** The first SIGINT or SIGTERM cancels the SDK wait in flight and stops the probe.
The probe then logs out cleanly and writes its totals line. A second signal exits at once
(code 130) without waiting for the logout. Exit codes: 0 for a run that finished or was
signalled and logged out, 1 for an error or a failed logout, 2 for bad arguments.

### Common options

| Option | Default | Meaning |
|---|---|---|
| `<account>` | required | `bots/<account>/bot.env` |
| `--minutes N` | required | Wall-clock minutes of the measured activity, counted from arrival at the knights or the coal rocks (0 skips it) |
| `--out file.jsonl` | stdout | Appends the JSONL there; events are echoed on stderr |

### probe-knights options

| Option | Default | Meaning |
|---|---|---|
| `--withdraw N` | 1000 | Coins to carry from the start-side bank (at least 70: two ship fares and the toll) |
| `--food N` | 20 | Food items to hold after a restock (at most 27) |
| `--bank-at N` | 25000 | Carried coins that trigger a deposit at the East Ardougne south bank |
| `--keep-coins N` | 500 | Coins kept in the pack after that deposit (food money) |
| `--food-source` | `shop` | `shop`, `stall` or `shop,stall` (see Food below) |

### probe-coal options

| Option | Default | Meaning |
|---|---|---|
| `--sell N` | 0 | Coal to sell after mining; **hard cap 5 in code** (`SELL_CAP`), larger values are refused |
| `--floor N` | 80 | Sell only if the coal book's best bid is at least this many gp |
| `--fill-minutes N` | 10 | How long to wait for the fill (at most 10) before cancelling the remainder |

## Output

One JSON object per line, labelled by `kind`:

- **`sample`**, on the first state and then every 50 game ticks. It holds UTC time (`t`), `tick`,
  `phase`, position (`x`, `z`, `level`), `hp`, and `coins` as `{inventory, bank}`. `bank` is the
  bank's count while the bank interface is open, else `null`. Item counts come the same way
  (`food` for knights; `coal` and `ore` for coal). `playersNear` counts the other players within
  5 tiles (Chebyshev).
- **`event`**: what the probe did (a withdrawal, a restock, a bank visit, the sale), with its tick.
- **`totals`**, once, last: `wallMs`, `ticks`, `observedMsPerTick`, `end` (`done`, `signal` or
  `error`), `phaseTicks` (game ticks spent in each phase, counted by the sampler on every state),
  the `logout` outcome, and the probe's own totals below. `observedMsPerTick` is measured, not
  configured: the wall time between the first and the last tick the sampler observed, divided
  by the ticks between them (the same window as `ticks`), to 0.1 ms, or `null` when no tick
  passed. That window runs from the first state after login to the last tick of the logout, so
  it leaves out the session opening and closing that `wallMs` includes.

Convert ticks to hours with the measured `observedMsPerTick`, never an assumed tick length.
The demo runs at 400 ms, the lab at whatever `NODE_TICKRATE` says, and the probe's machine knows
neither.

## probe-knights

**Start conditions.** Thieving 55 or more (it refuses below). It can start anywhere on the
Lumbridge side, in Al Kharid, or already in East Ardougne. It needs coins in the bank, or
`--withdraw` coins already carried.

**Route.** It walks to the nearest bank on its side (Draynor, or Al Kharid) and withdraws up to
`--withdraw` coins. From Al Kharid it crosses the toll gate west (`lib/toll-gate.ts`). Then it
sails Port Sarim to Musa Point, walks to Brimhaven, and sails to Ardougne (`lib/ships.ts`
`sailTo`, 30 gp a fare). The land route over White Wolf Mountain kills a 10-Hitpoints account
(`lib/kandarin.ts`). From the landing it walks into the market.

**Food.** The market Baker's shop (`ardougne_east.inv` `bakery`) sells bread (5 HP, 12 gp
base), chocolate slices (5 HP) and cakes (three bites of 4, 50 gp), with a shared stock of
10/3/8 that restocks. The probe buys the cheapest heal first, up to `--food`. When the Baker is
sold out it waits at the shop and retries every 50 ticks, up to 12 times. The baker's stall is
opt-in (`--food-source stall`) and only for an account with combat stats. In the lab a guard
caught a 10-Hitpoints account there within 51 ticks and took it to 4 HP. The stall's guards
and owner check line of sight within 5 tiles (`stealing.rs2`), and kits.ts's stall rates were
measured at 99 combat. A theft also makes the Baker call the guards on the next trade for
1,500 ticks (`baker.rs2`, `^baker_stall_timer`), so the probe skips the shop for that long
after one.

**Pickpocketing.** It clicks the nearest Knight of Ardougne within 10 tiles of (2670,3305) once
per game tick, the cadence of `speedrun/helpers/coins.ts`. The server drops a click sent while
the player is delayed or stunned. It eats like coins.ts: free in a success window (no stun
pending, 3 or more ticks since the last bite, a whole bite under the cap), forced at 4 HP or
less, since a knight does 3 per failure. Coins over `--bank-at` go to the south bank. A death
ends the probe (`stopReason: died`).

**Totals.**

| Field | Meaning |
|---|---|
| `successes`, `failures` | Thieving xp rises; hitpoint drops (a failure hits 3) |
| `coinsGained` | Sum of the pack's coin increases while pickpocketing |
| `xpGained` | Thieving xp over the stay |
| `arrivedTick`, `ticksAtKnights` | First tick at the knights; ticks from then to the end, errands included |
| `foodEaten`, `eatsFree`, `eatsForced` | Bites, split by the eating rule above |
| `eatTicks` | Ticks lost to eating, a model: 3 per forced bite and 0 per free bite (eating adds 3 to the action delay when a stun is pending, `consume.rs2`) |
| `restocks`, `foodBought`, `coinsOnFood`, `stallSteals`, `foodStolen` | The food errands |
| `bankVisits`, `coinsBanked` | The start withdrawal and the coin deposits |
| `phaseTicks.travel` / `.bank` / `.food` / `.knights` | Travel, banking, food (shop and stall), and pickpocketing ticks, kept separately |
| `deaths`, `stopReason` | `minutes`, `signal` or `died` |

## probe-coal

**Start conditions.** Any account, a fresh one included. It leaves Tutorial Island through
S00's `tutorialSkip` when it is still there. It needs a pickaxe, which the tutorial gives (bronze).

**Training to Mining 30.**

1. Mining 1 to 15 uses `speedrun/skills/mining.ts`'s own `mining.prep` and `mining.copper`
   steps (Rimmington copper, `technique: 'plain'`), driven standalone by
   `drive-steps.ts`. Those two steps drop the starter junk and every copper ore, as they do in
   every rehearsal.
2. Mining 15 to 30 is tin at Barbarian Village, beside the coal, mined with the probe's own
   loop. `mining.ts`'s bands above 15 run the browser page's in-page `knife-mine` program
   (`lib/programs.ts`), which the lite client does not have, so they cannot run here. At the
   server's 25x rate this is 13 tin ores (5 copper ores reach 15).

**The coal rocks.** coalrock1 (loc 2096) at Barbarian Village: (3087,3431), (3087,3432),
(3089,3433) and (3089,3434) (`m48_53.jm2`). The coal clusters on the surface, from the map
files:

| Cluster | Rocks | To the Varrock west Exchange | To a bank | Why not |
|---|---|---|---|---|
| **Barbarian Village** (3087-3089, 3431-3434) | 4 | 96 tiles | Edgeville 59 | Chosen: nearest to the Exchange the sale uses; tin rocks beside it for 15-30; only non-aggressive barbarians |
| North of Al Kharid mine (3302,3299-3317) | 3 | 121-139 | Al Kharid, or Varrock east | Scattered single rocks; the mine's scorpions |
| Lumbridge Swamp (3236,3165) | 7 | 273 | Draynor 144 | Far from the Exchange |
| Taverley (2909,3364) | 2 | 276 | Falador west | Far |
| North of Edgeville (3103,3565) and the mine at (3016,3591) | 3 and 34 | 127 and 169 | Edgeville | In the Wilderness |

**Mining.** It clicks the nearest live rock, then waits for the ore (a mining xp rise) or the
rock emptying, as `mining.copper` does. A full pack walks to the Edgeville bank and back. Each
bank visit deposits everything but the pickaxe, the starter kit included, so a fresh account
carries 27 ores a trip. The counters, for the tin (`tin`) and the coal (`coal`) separately:

| Field | Meaning |
|---|---|
| `ores`, `clicks` | Ores mined and Mine clicks sent |
| `contested` | A rock we clicked emptied with no ore of ours: another player took it |
| `nearestDepleted` | Choices where the nearest rock was already empty and another was taken (on a solo lab world it counts our own depletions) |
| `allDepletedTicks` | Ticks with every rock of the cluster empty |
| `bankTrips` | Edgeville round trips |

Walking and banking ticks are in `phaseTicks`: `train-copper`, `train-walk`, `train`,
`train-bank`, `coal-walk`, `coal`, `coal-bank`, `sell-walk` and `sell`. `coalTicks` is the
measured window, `coalCarried` the coal in the pack at its end, and `coalInBank` the coal the
bank showed at the last visit.

**The sale** (`--sell N`, N from 1 to 5). In order:

1. Walk to the Varrock west bank.
2. Read the coal book over the public market API (`MarketClient`, obj 453 = coal, `obj.pack`).
   The HTTP origin comes from the bot.env `SERVER`, the same rule as `mule.ts`
   `pointMarketAtServer`.
3. If the best bid is under `--floor`, or there is none, refuse before any coal leaves the bank.
4. Otherwise deposit, withdraw exactly N coal unnoted, read the book again, and check the floor
   again.
5. Place one sell offer of N at the best bid (`bot.placeGEOffer`) and wait up to
   `--fill-minutes` for the fill.
6. Cancel any remainder and collect.

The seller gets the gross less the burned fee, which the engine rounds down, cumulatively per sell
offer: `gross - floor(gross / 20)` (`MarketStore.ts`). So 5 coal at 85 gp pays 404 gp, not
403.75. The totals' `sell` object records:

- `quoteBefore` and `quote` (bid, ask, buy quantity, time)
- `quantity`, `price`, `offerId`
- `placedAt` / `placedTick`, and `filledAt` / `filledTick`, or `filledAt: "unfilled"`
- `filled`, `cancelled`, `collect`
- `coinsReceived` (the pack's coin rise) against `expectedCoins`
- `result`: `filled`, `partial`, `unfilled`, `refused` (with `reason`), or `not placed`

It never drops, trades or sells anything else. The tin and copper it mines go into its own bank
and nowhere further.

## Lab verification

Lab: `speedrun/lab/lab.sh` at `NODE_TICKRATE=400`, port block **M6** (WEB 9950, MGMT 9951,
HISCORES 9952, NODE 44950, AGENT 7712, FRIEND 45950), every port lsof-checked free first. Runs
were on executor fedora (Linux) and local (macOS), 2026-10-22 23:04-23:41Z. Every lab account is
fresh. The fixtures, which are not committed, used staff commands: Thieving 60 by `::setstat`,
coins by `::give` and banked at Draynor, and a second account bidding for 5 coal at 85 gp at the
Varrock west Exchange.

| Run | Start | Result | Wall clock |
|---|---|---|---|
| probe-knights `--minutes 4` (fedora) | Thieving 60, 10 HP, in Lumbridge, 5,025 coins in the bank | Withdrew 1,000 at Draynor; Draynor to the market 216 ticks by ship; bought 9 food for 112 gp; 4 minutes at the knights: 62 successes, 31 failures, 3,100 coins, 20 bites (6 free, 14 forced), one more restock (10 for 220 gp). Phase ticks: travel 299, bank 6, food 40, knights 584. Logout ok | **382.7 s** |
| probe-knights `--minutes 10`, SIGTERM at 75 s (fedora) | In the market | `end: signal`, 17 successes and 9 failures, logout ok, totals written 7 s after the signal; the lite runner exited as the player left | 82.3 s |
| probe-knights `--minutes 3 --food-source stall` (local) | In the market, no coins | A guard took it from 10 to 4 HP within 51 ticks at the stall (22 clicks, 3 food); the next restock found no food and it stopped with `end: error`, logout ok. Hence `shop` became the only default source | 101.9 s |
| probe-coal `--minutes 3 --sell 5 --floor 80` (local) | Fresh, on Tutorial Island | Mining 1 to 30 (copper 233 ticks, walk 195, tin 164 for 12 ores, one bank trip); 8 coal in 441 ticks, 0 contested, 7 all-empty ticks, no bank trip; walked to Varrock (57); 5 sold at the 85 bid, **filled at placement, 404 gp received, 404 expected**. Logout ok | **458.2 s** |
| probe-coal `--minutes 0 --sell 5 --floor 90` (fedora) | Mining 30, coal in the bank, bid 85 open | Refused before withdrawing: "best bid 85 gp is below the floor of 90 gp" | 1.8 s |
| probe-coal `--minutes 0 --sell 5 --floor 80` (fedora) | Same | 5 at 85, filled, 404 gp | 9.0 s |

At 400 ms a game minute is 150 ticks, so expect about `--minutes` plus 2.5 minutes for knights
from Lumbridge (the voyage and the shop), and about `--minutes` plus 5 minutes for coal from a
fresh account (training 4, the walk to the Exchange under 1). A full 10-minute fill wait adds up
to 10.

Two fixes came out of these runs. `withdrawItem` reads a bare number as a bank slot, not an obj
id, so the coal is withdrawn by its bank item. The deposit of everything but the pickaxe came
from the first fresh-account run, whose pack was full after 8 coal because the starter kit
still held most of its slots.

### Samples

Short excerpts, the account names replaced by placeholders. probe-knights (stall run, local):

```jsonl
{"kind":"sample","probe":"probe-knights","t":"2026-10-22T23:33:31.448Z","tick":61,"phase":"start","x":2670,"z":3305,"level":0,"hp":10,"coins":{"inventory":0,"bank":null},"items":{"food":{"inventory":1,"bank":null}},"playersNear":0}
{"kind":"sample","probe":"probe-knights","t":"2026-10-22T23:33:51.448Z","tick":111,"phase":"food","x":2667,"z":3312,"level":0,"hp":10,"coins":{"inventory":0,"bank":null},"items":{"food":{"inventory":4,"bank":null}},"playersNear":0}
{"kind":"sample","probe":"probe-knights","t":"2026-10-22T23:34:11.446Z","tick":161,"phase":"knights","x":2669,"z":3314,"level":0,"hp":7,"coins":{"inventory":50,"bank":null},"items":{"food":{"inventory":3,"bank":null}},"playersNear":0}
```

probe-knights totals (the 4-minute run from Lumbridge, fedora). This and the probe-coal totals
below were written before the totals measured ms per tick: their `tickMs` is the configured value
the probe used to copy, not a measurement, and today's totals carry `observedMsPerTick` instead.

```jsonl
{"kind":"totals","probe":"probe-knights","account":"acct01","t":"2026-10-22T23:11:01.325Z","startedAt":"2026-10-22T23:04:38.903Z","wallMs":382422,"startTick":35,"endTick":987,"ticks":952,"tickMs":400,"end":"done","phaseTicks":{"travel":299,"bank":6,"food":40,"knights":584,"logout":23},"logout":{"ok":true,"latencyTicks":0},"successes":62,"failures":31,"coinsGained":3100,"xpGained":130665,"arrivedTick":364,"ticksAtKnights":600,"foodEaten":20,"eatsFree":6,"eatsForced":14,"eatTicks":42,"restocks":2,"foodBought":19,"coinsOnFood":332,"stallSteals":0,"foodStolen":0,"bankVisits":1,"coinsBanked":0,"deaths":0,"stopReason":"minutes"}
```

probe-coal (fresh account, local; its totals line has the old configured `tickMs`):

```jsonl
{"kind":"sample","probe":"probe-coal","t":"2026-10-22T23:33:31.049Z","tick":60,"phase":"start","x":3094,"z":3106,"level":0,"hp":10,"coins":{"inventory":0,"bank":null},"items":{"coal":{"inventory":0,"bank":null},"ore":{"inventory":0,"bank":null}},"playersNear":0}
{"kind":"sample","probe":"probe-coal","t":"2026-10-22T23:39:55.449Z","tick":1010,"phase":"coal","x":3088,"z":3432,"level":0,"hp":10,"coins":{"inventory":0,"bank":null},"items":{"coal":{"inventory":5,"bank":null},"ore":{"inventory":2,"bank":null}},"playersNear":0}
{"kind":"event","probe":"probe-coal","t":"2026-10-22T23:41:05.526Z","tick":1185,"phase":"sell","message":"sell offer placed","id":2,"quantity":5,"price":85,"expected":404}
{"kind":"event","probe":"probe-coal","t":"2026-10-22T23:41:06.680Z","tick":1188,"phase":"sell","message":"sale","result":"filled","filled":5,"coinsReceived":404,"expected":404}
{"kind":"totals","probe":"probe-coal","account":"acct02","t":"2026-10-22T23:41:07.589Z","startedAt":"2026-10-22T23:33:29.821Z","wallMs":457768,"startTick":60,"endTick":1189,"ticks":1129,"tickMs":400,"end":"done","phaseTicks":{"train-copper":233,"train-walk":195,"train":164,"train-bank":7,"coal-walk":9,"coal":441,"sell-walk":57,"sell":23},"logout":{"ok":true,"latencyTicks":0},"miningStart":1,"tin":{"ores":12,"clicks":12,"contested":0,"nearestDepleted":5,"allDepletedTicks":0,"bankTrips":1},"coalInBank":8,"miningAtCoal":30,"coal":{"ores":8,"clicks":11,"contested":0,"nearestDepleted":7,"allDepletedTicks":7,"bankTrips":0},"coalTicks":441,"coalCarried":8,"sell":{"item":453,"requested":5,"floor":80,"quoteBefore":{"bid":85,"ask":null,"buyQuantity":5,"at":"2026-10-22T23:40:57.984Z"},"quantity":5,"quote":{"bid":85,"ask":null,"buyQuantity":5,"at":"2026-10-22T23:41:00.737Z"},"price":85,"offerId":2,"placedAt":"2026-10-22T23:41:05.526Z","placedTick":1185,"expectedCoins":404,"filled":5,"filledAt":"2026-10-22T23:41:05.529Z","filledTick":1185,"collect":{"success":true,"coins":404,"items":0,"message":"Collected 0 items and 404 gp. Any overflow remains in the exchange."},"coinsReceived":404,"result":"filled"}}
```

## Known limits

- **Pickaxe.** It mines with whatever pickaxe it holds, bronze for a fresh account, so its coal
  rate is a bronze-pickaxe rate at Mining 30 (8 to 9 coal in 3 minutes in the lab).
- **Wall-clock minutes.** `--minutes` counts wall-clock minutes; the tick counts are in the
  totals.
- **The eating cost** is the model stated above, not a measurement.
- **The sold-out wait** at the Baker has not happened in the lab, since a lone lab account
  never empties the shop.
- **Project checks.** The root `tsconfig.json` includes `markets/**/*.ts` and excludes
  `markets/research/`, whose one-off lab scripts call engine internals; the root `test` script
  runs `markets`. So `bun run typecheck` and `bun run test` cover the probes.
