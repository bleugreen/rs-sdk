# Phase 2 on one address: 45 logins, what they earn and what binds first

markets Q2c (rs/543, under rs/495). Phase 2 starts when the scored run ends: one public address, at most 45
concurrent logins (`scaling-limits.md`). The goal is capital: coins, plus what items realise at real book depth
less the 5% seller fee. A coin is one unit of board value, so the board figure is the coin figure for every coin
method here. The rates come from the lab (`markets/methods/`, block M8/M9 at `NODE_TICKRATE=400`) and from the two
live probes markets ran on the demo; every row says which.

## The answer

**With the knights available: 1 login on the Shilo gem rocks, 1 on steel bars, 43 on the Knights of Ardougne.**
That earns about **4.9M coins an hour** on one address, after a setup of about 0.3 login-hours per fresh account,
and about **28M in 6 hours, 117M in 24 and 350M in 72** (`bun markets/methods/phase2-plan.ts`). No coin cap comes
near: 72 hours at this rate is about 8M a login, against the 2.15B a bank slot holds.

**Without the knights** (if main keeps them free for S18's account): **1 Shilo, 1 steel, 12 iron ore into the deep
iron bid, 8 on heroes, 23 on Varrock guards**: about 3.5M an hour, **21M in 6 hours, 84M in 24, 247M in 72**.

What binds first is a shared outlet, not setup and not the address:

| Shared limit | Binds at | What happens then |
|---|---|---|
| The Shilo gem site (7 rocks, one world clock) | at once: a second login adds 15% to the site | 1 login is the whole method |
| The uncut jade bid (3,768 at 08:45Z, draining ~173/h to other sellers) | ~16.6 h from the 08:45Z read | the gem login falls from ~301k to ~171k an hour |
| The steel bar market (no bid: 74,175 traded in 7 days, ~441 an hour world-wide) | 1 login sells ~36% of the world's flow | more logins sell into a falling price |
| The iron ore bid (993,853 at a mean of 80) | ~66 h with 12 logins | the iron logins move to guards |
| Iron rock respawn (6 rocks a cluster, 13 ticks) | ~2-3 logins a cluster (inferred) | 12 iron logins need 4-6 clusters |
| Knights, heroes | not reached: no crowding measured to 8 bots on 4 knights or 3 heroes, nor live at 50-100 players nearby | |

Setup does not bind on one address: each fresh account trains its own levels in parallel, and the longest setup
(Shilo, ~0.8 login-hours plus quest bots nobody has written) is for one login only. Every setup-driven crossover
falls inside the first two hours (section 'Horizons'), so the allocation is the same for 6, 24 and 72 hours; only
the caps above change what each row is worth.

**Live slot for the knights.** The knights row uses markets' live probe (summarised in rs/495's message of 21:05
PDT; samples in `data/knights-live-20261023T0253Z.jsonl`): 124k an hour at the knights and
118.5k with the food stops removed, less 26 sharks an hour at the Exchange's 533 ask, **104k net**. The lab's
126-131k (crowding table below) is the upper bound if the gap to the lab turns out to be removable.

## Per-login rates

m = measured in the lab (n, spread and host given), L = measured live on the demo, i = inferred from measured
parts or content. All lab rates are per 9,000 server ticks (one hour at 400 ms); a run's `msPerTick` is given
where load stretched the lab's ticks, which leaves a per-tick rate unchanged.

| Method | Logins in the plan | Rate per login at that crowding | Inputs per login-hour (live price) | Net coins / h | Board / h | Basis | Competes with the scored run |
|---|---|---|---|---|---|---|---|
| **Knights of Ardougne**, Thieving 99, HP 99, banked sharks | 43 (A) / 0 (B) | 118.5k coins (L); lab 126-131k at 1-8 bots | 26 sharks (13.9k) | **104k** | 104k | L + m | **after-run-only**: S18 pickpockets these knights; sharks are a fleet input |
| **Shilo gem rocks**, Mining 40-99 | 1 | 233 gems/h sharing the site with one regular (m, 2 bots); 399 alone (m) | none | **301k** while the jade bid lasts, then 171k (alone: 516k / 294k) | same | m (respawn emulated) + book | **after-run-only**: S25c's gems (H21d) |
| **Steel bars**: mine iron and coal, smelt | 1 | 160 bars/h (i: iron 1,208/h m, coal 471/h rs/502 m, smelting 845/h m) | none (mined); pickaxe | **208k** at the flow's 1,369 | 208k | i from m parts | none (S27's cannonballs are made from staged bars) |
| **Iron ore** into the iron bid | 0 (A) / 12 (B) | 1,208 ore/h (m) | pickaxe | **92k** at the bid's 80 mean (126k at its 110 best) | 92k | m + book | **after-run-only**: S18e's Superheat iron ore |
| **Heroes**, Thieving 99, HP 99 | 0 (A) / 8 (B) | 94-96k coins at 1-8 bots (m) + blood and death runes | 110 sharks (58.6k) | **73k** with the runes sold (35k coins only) | 73k | m | **after-run-only**: blood and death runes are S16/S18 inputs |
| Varrock guards (fleet earner) | 0 (A) / 23 (B) | 62.9k (rs/502 m) | kebabs | ~60k | ~60k | m (rs/502) | the fleet's own earner |
| Runite, the lone rock (47_160) | 0 | **not measured** (the lab bots stalled) ; ~5.6 ore/h one login (i, content) | coal 8 a bar | ~215k as bars, 1 login (i) | | i | none |
| Battlestaff water orbs | 0 | **not measured** | 7,000 a staff, unpowered orbs (no shop, no Exchange stock), 3 cosmic runes (Exchange ~1,000 each, 70 traded a week) | negative in coins | +8,200 board a staff (i) | i | **after-run-only**: cosmic runes are H1's |

The plan's two allocations are in `markets/methods/phase2-plan.ts` (`WITH_KNIGHTS`, `WITHOUT_KNIGHTS`).

## Crowding

### Spawn groups (content)

| Group | NPCs | Where (map file:line) |
|---|---|---|
| Knights of Ardougne, East Ardougne market | 4 | `m41_51.jm2:10987`, `:10989`, `:11007`, `:11010` (2652,3318; 2653,3300; 2669,3298; 2671,3313) |
| Knight of Ardougne, castle | 1 | `m40_51.jm2:10766` (2582,3297), behind the castle walls |
| Heroes, East Ardougne | 3 | `m41_51.jm2:10974`, `:10985`, `:11006` (2630,3288; 2647,3306; 2667,3316) |
| Paladins, market / castle | 2 / 23 | `m41_51.jm2:10990`, `:10996`; `m40_51.jm2:10758-10842` (behind walls) |
| Shilo gem rocks | 7 rocks | `m44_46.jm2:5559`, `:5596`, `:5599`, `:5665`, `:5667`, `:5729`, `:5731` |
| Runite | 2 + 2 + 1 rocks | `m47_60.jm2:5031`, `:5050`; `m45_154.jm2:8059`, `:8267`; `m47_160.jm2:4390` (3046,10265) |

**What caps a pickpocket group: nothing in content.** `pickpocket.rs2` takes no lock on the NPC: a failure sets the
NPC's mode to face the player for the stun and clears it, and the stun and its delay sit on the player
(`thieving.rs2` `fail_pick_pocket`). Players do not collide with each other. So any number of accounts can work one
knight; the measured bound is the 8 bots below.

### Measured (lab, bgsrv-ub, M8)

Coins an hour per login, every bot on the same group at once (`markets/methods/lab/crowd.sh`; raw per bot in
`data/phase2-lab-20261023.json`).

| Bots | Knights (4 NPCs), 2,400 ticks each | % of 1 bot | Heroes (3 NPCs), 3,000 ticks each | % of 1 bot |
|---|---|---|---|---|
| 1 | 130,600 | 100 | 91,000 | 100 |
| 2 | 128,700 (126.7k, 130.8k) | 99 | 94,100 (93.6k, 94.6k) | 103 |
| 4 | 126,000 (114.8k-136.4k) | 96 | 95,300 (90.5k-103.0k) | 105 |
| 8 | 131,500 (95.7k-144.3k, sd 15k) | 101 | 96,300 (79.5k-114.4k, sd 11k) | 106 |

**Logins per group before the rate per login drops below 80%: more than 8 for both** (the most measured). Host:
bgsrv-ub, load 5-10 at 1-2 bots, 45 at 4, peaks of 233 during 8 from other tenants; the engine's tick stretched to
530-553 ms then, which leaves the per-tick rate unchanged. A first run on fedora with two labs side by side and
four other jobs (load 41-50 on 32 cores) fell from 97k at 1 bot to 65k at 8; its 1-bot rate was already a third
below the clean figure, so that fall was the host, not the game, and it is superseded.

### What the demo says (live, markets' knights probe)

The probe stood among a median 53 players (p75 73, max 102) within 5 tiles. Regressing coins per tick in its
knights-phase samples (116 intervals) on the players nearby gives a **positive** slope (+0.18 gp a tick per player,
se 0.03, r 0.53): 82k an hour with under 40 players near, 136-143k with 40-80, 179k above 80. Few players near
means the bot was away from the knights (walking, finding one), not that a crowd slowed it. **No crowding loss is
visible on the demo either**, so the 157 accounts rs/501 counted in the market are not a cap; the 43 logins of
allocation A are a bet that holds to 8 bots on 4 knights in the lab and ~100 accounts live, and is untested beyond.

The live rate at the knights (3.64 ticks a success, 5.7% failures) is still ~18% below the lab's (3.08 ticks a
success, 7.2% failures). With crowding ruled out, the candidates are the probe's 10 HP (37 forced eats, 111 eat
ticks, small) and its round trip from markets' VM to the demo; markets reports the probe ran through a gateway on
its own VM, so the public gateway is not it. Food took 19.6% of the probe's ticks at the market Baker, which was
usually sold out: the live totals already split the gap into food (~20%) and the rest (~18%), so the lab's
food-starved reproduction was not run.

## Shilo gem rocks

- **Staging:** `::setstat` Mining 99 (and 40 with an adamant pickaxe), `::setvar zombiequeen 17` (Shilo Village
  complete), tele to the rocks; the bot banks at Shilo (2852,2954), ~50 tiles away.
- **Respawn: the engine's player count pinned to 1,400** (`markets/methods/lab/emulate-players.sh`, a worktree edit of
  `player_count.rs2` for the lab batch only, never committed). The loop logs every respawn it sees: **129 ticks** in
  every run (n = 113-133 a bot), the content's 130 at 1,400 players.

| Bots | Gems / h per login | Site total | Basis |
|---|---|---|---|
| 1, Mining 99 | 399 (2,709 ticks, 4 trips); 440 over a 900-tick run | 399 | m, bgsrv-ub, 400.1 ms/tick |
| 1, Mining 40, adamant pickaxe | 359 (3 trips) | 359 | m, 504 ms/tick (busy host) |
| 2 | 256, 203 (mean 229) | 458 | m |
| 4 | 110, 80, 93, 183 (mean 116) | 465 | m |

One login takes 86% of the site. A second takes about half of the first's, and the site total rises only 15%, so
**the site supports 1 login**. The demo's headcount found one regular there (`candidates.md`), which makes our login
the second: about 233 gems an hour. Mining 40 gets 90% of Mining 99's rate because the site, not the swing, binds.

**Price at depth** (`data/phase2-book-2026-10-23T084522Z.json`, `markets/methods/book.ts`): every uncut gem's bid
is a single price level (best bid = mean), so a sale realises the best bid until the depth is gone.

| Gem | Share of rolls (`gem_rock_table.dbrow`) | Bid, depth at 08:45Z | Change since 22:30Z | Net a gem |
|---|---|---|---|---|
| Opal | 60/128 | **none** (2,342 at 2,500 at 22:30Z, gone; 10,000 traded this week) | -2,342 | board 20 only |
| Jade | 30/128 | 2,500 x 3,768 | -1,772 | 2,375 |
| Red topaz | 15/128 | 2,500 x 9,634 | -239 | 2,375 |
| Sapphire | 9/128 | 2,500 x 7,909 | -590 | 2,375 |
| Emerald | 5/128 | 2,500 x 9,253 | -170 | 2,375 |
| Ruby | 5/128 | 2,500 x 9,905 | -73 | 2,375 |
| Diamond | 4/128 | 3,500 x 9,502 | -166 | 3,325 |

Expected coins a gem: **1,291 with the jade bid, 735 after it** (half the rolls are opals with no outlet). At 233
gems an hour that is 301k and 171k; alone, 516k and 294k. The other bids last hundreds of hours at one login.

## Iron ore with its bank trip

6 rocks south of the Ardougne zoo, banking at Ardougne south bank, Mining 99, rune pickaxe, respawn emulated (13;
the loop saw 12 end to end): **1,208 ore an hour** (122 in 909 ticks, 4 trips, by-trip 1,140-1,440; m, bgsrv-ub,
401 ms). The bot never waited for a respawn alone. The iron bid: best 110, 993,853 deep at a mean of 80 (79.5M
committed), down 5,430 in the ten hours since 22:30Z. At the mean less 5%, **92k an hour a login**; the share of
the depth at 110 is not visible (the API gives totals, not levels), so 92k-126k. One login uses 1,208 of a
cluster's ~3,600 an hour of respawns (6 rocks / 15 ticks a rock cycle): 2-3 logins a cluster (i).

## Steel bars

| Leg | Rate | Basis |
|---|---|---|
| Mine iron | 1,208 ore/h | m (above) |
| Mine coal | 471/h, Mining Guild | m, rs/502 (`methods.md`); live at Barbarian Village only 98/h, 3,685 of 8,785 ticks with all four rocks depleted (markets' coal probe, `data/coal-live-20261023T0402Z.jsonl`) |
| Smelt (Falador west bank and furnace, from banked ore and coal) | **845 bars/h** (854 over 9 trips, sd 2%; 834 whole run) | m, bgsrv-ub, `rate.ts --method=steel` (smelter.ts smelt mode) |

One bar is 7.5 ticks of iron, 38.2 of coal and 10.6 of smelting: **~56 ticks, 160 bars an hour** for a login doing
all three (i). There is no real bid (89 for 9,595); the outlet is the flow, 74,175 bars in 7 days at a
volume-weighted 1,369 with 7,187 listed at 1,502. At 1,300 net that is **208k an hour**, and one login is ~36% of
the world's weekly flow, so it is a 1-login method. Coal has no asks to buy from; it must be mined.

## Runite (not measured)

The lone rock at 3046,10265 is in the Lava Maze dungeon (Wilderness level ~44). In the lab each of 2 runs gave one
ore at the start and nothing after: the bots stalled (client stalls during a load-90 spike, then no respawn seen
in view), so there is no measured rate. From content: success 16/256 a 3-tick roll at Mining 85 (~48 ticks), respawn
1,560 at 1,400 players: **~5.6 ore an hour, one login; a second login on the rock adds ~1.5%** (it only halves the
48 ticks). The ore has no outlet (one bid of 5,320; 414 traded a week); as bars (Smithing 85, 8 coal) into the
41,005 bid (1,884 deep): ~215k an hour (i). It needs Mining 85 and Smithing 85 on a fresh account and a Wilderness
trip, so it does not enter a 72-hour plan.

## Battlestaff water orbs (not measured)

Charge Water Orb (`magic_spells.dbrow`, Magic 56, at the obelisk, 2844,3422) turns an unpowered orb, 30 water runes
(free with a staff of water) and 3 cosmic runes into a water orb; staff + orb makes a water battlestaff. Board: a
water battlestaff counts 15,500 against the staff's 7,000 and the orb's 100, **+8,200 a staff**. The world clock is
the battlestaff shelf: Zaff 1 a 100 ticks (full, 5 of 5, at 23:46Z) and the Magic Guild 1 a 90 ticks, **190 an hour
for everyone**. The inputs are what stop it: unpowered orbs are in no shop and nobody lists them, and cosmic runes
trade ~70 a week on the Exchange at ~1,000 (3 a staff would be 570 an hour). It converts coins to board at ~2x, which
is only worth anything past the coin cap; phase 2 does not get near it. The cast cycle was not run.

## Inputs, net

| Input | Used by | Per login-hour | Source and live price | Enough for N logins? |
|---|---|---|---|---|
| Sharks | knights | 22-26 at HP 99 (m); ~30 from HP 40 (i: damage is 3 a failure x ~225 failures/h; above ~30 HP no heal is wasted) | Exchange ask 533, 2,003,285 listed | 45 logins x 72 h x 30 = 97k: yes |
| Sharks | heroes | 105-114 (m) | as above | yes |
| Market Baker's food | the live probe | | 1-2 a restock, usually sold out (L) | **no**: phase 2 must not use it |
| Coal | steel | 2 a bar | no asks; mine it (bid 80, mean 12.4; 15,351 traded a week) | mined |
| Rune / adamant pickaxe | iron, steel, Shilo | one-off | Nurmof 32,000 / 3,200; the rune shelf holds 1 and restocks ~13 an hour world-wide (content) | rune for a few, adamant (Mining 31) for the rest |
| Cosmic, water runes, staves, unpowered orbs | battlestaves | | above | no |

## Setup: fresh account to each method, at 25x xp

| Method | Needs | Login-hours (one fresh account) | Basis |
|---|---|---|---|
| Knights | Thieving 55 (rates reach 99 within ~2,000 ticks of work), Hitpoints ~40 | **~0.3**: HP 40 took **1,707-1,972 ticks** with `hp-train.ts` (m, 2 fresh bots; `bones.ts` 1,822); Thieving 1-55 a few hundred more | m (`hp-training.md`), thieving.md |
| Heroes | Thieving 80, HP ~40 | ~0.35 | as above |
| Guards | Thieving 40, HP ~40 | ~0.25 | as above |
| Iron ore | Mining 15 (63 for every roll), a pickaxe | ~0.1: 15 to 63 is ~450 ticks (mining.md), plus coins for the pickaxe | i |
| Steel | Mining 60 (guild coal), Smithing 30, pickaxe | ~0.2 | i |
| Shilo | Druidic Ritual, Jungle Potion, Shilo Village; Agility 32, Crafting 20, Mining 40, HP 15, Prayer 10, combat for the quest's undead | **~0.8** (quests ~3,500-4,500 ticks by legends.md's estimates, levels ~2,000 more); **no quest bot exists for Jungle Potion or Shilo Village** | i |
| Runite | Mining 85, Smithing 85, Wilderness kit | several | i |

The Hitpoints trainer is `markets/methods/hp-train.ts` (rs/553, `hp-training.md`): `bun markets/methods/hp-train.ts
<acct>` trains a fresh account to **40 HP in 1,707-1,972 ticks** (m, fedora, 400 ms, 2 bots; Attack 30, Strength 52,
Defence 1) on the Lumbridge cows with the tutorial's bronze sword, spending nothing. The fleet's `bones.ts` cow
stage, measured first (m, bgsrv-ub, 402.7 ms), gave HP 20 at tick 437, 30 at 981, 40 at 1,822, 50 at 3,308 and 55 at
4,371, flattening because a cow has 8 HP to give. Higher targets are not worth it for the knights: a shark heals
20, and from ~30-40 HP no heal is wasted, so sharks an hour hardly change above that while 10 HP eats 149 an hour
(rs/502). Above ~52 HP the trainer goes over White Wolf Mountain to the rock crabs, which reached **70 in 6,028
ticks** (m, 1 sample). Prayer-first (`--prayer 31 --pray`) is slower at every target: ~2,720 ticks to 40 (m).

## Running

`markets/phase2/run.ts` executes a plan: one process on the phase-2 address brings every account from a fresh login
to its method and runs it until stopped, with a ledger of what each account holds.

```sh
bun markets/phase2/run.ts <plan.json> [--out DIR] [--minutes N] [--run-ended] [--placeholder-data]
bun markets/phase2/report.ts DIR/ledger.jsonl     # rates per account and method, the ramp, redirects, logouts
```

**The plan** (`markets/phase2/plan.ts`; `plan.example.json` has placeholder names) lists each account with its
method (`knights`, `heroes`, `guards`, `iron`, `shilo`; steel, runite and battlestaves are refused with the reason
above) and optionally its own `hp` and role `options`. It names accounts, so it lives outside the checkout like the
names list. Everything else has a default: `maxSessions` (the account count, at most 45), `loginSpacingMs` 2,000,
`hp` 40, `sharks`, `ramp`, `foodFallbackMix`, `ledger`, `sell`. Parsing lists every problem at once.

**Each account** logs in with its own in-process lite client (`speedrun/lib/direct.ts`, credentials from
`bots/<account>/bot.env`; every account must share one SERVER), then works through its sequence. A stage whose goal
already holds is skipped, and the runner recomputes the first unmet stage after anything that can undo one (a death
in the market respawns in Lumbridge without the ship's coins, so the account earns them and sails again):

| Method | Sequence (`sequenceFor`) |
|---|---|
| knights | tutorial, HP 40 (`hp-train.ts`), Thieving 55 (`coins.ts` auto: men, warriors, guards), admission (the ramp; Varrock guards meanwhile), [buy sharks], 100 coins, ship to Ardougne (`thieving.ts`'s leg), `pickpocket.ts` on the knights |
| heroes | as knights to Thieving 80, no ramp |
| guards | tutorial, HP 40, `coins.ts` auto from Thieving 1 |
| iron | tutorial, 100 coins (Lumbridge men), Mining 15 (`mining.ts`'s copper steps), wield the pickaxe, ship to Ardougne, `mine.ts` at the zoo cluster |
| shilo | staged by hand (no quest bot exists): the method only |

A stage that fails three times in a row, or three sessions that end in an error within two minutes of login, give
the account up; the rest carry on.

**Logins** (`gate.ts`): never a second login for an account whose first has not answered (the demo's code 16 was a
same-account retry, rs/519); a login that ended with no answer holds the account 60 s. Sessions, logins in flight
included, never exceed `maxSessions`. Starts are spaced `loginSpacingMs` apart. A refusal holds the account by its
code (16: 16 s, 5: 15 s, 7: 60 s for the whole address); five refusals in a row give it up.

**The knights ramp** (`ramp.ts`, rs/495's condition on allocation A): knights logins are admitted in steps (default
8, 20, 43). The ramp opens when the first knight reaches admission; a step holds `holdMinutes` (15) once every
admitted login is pickpocketing at Thieving 99 (the rate climbs with the level, so a hold mid-climb would set a low
reference), or `admitTimeoutMinutes` (30) after it opened, then takes the median gp a tick
per login over the hold. A step more than `dropPct` (10%) below the first stops the ramp: the knights not yet
admitted go to `ramp.fallbackMix` (plan B's 12 iron, 8 heroes, 23 guards, split in proportion), and the ledger
says why. A hold with no login measured waits for the step again.

**Sharks and the food fallback.** `sharks.source: 'bank'` (default): markets puts the sharks in each account's
bank. `'buy'`: each shark eater buys `perAccount` at the Exchange during admission, a limit offer at the `ceiling`
(701), paid from the bank's coins; sharks are a fleet input (docs/speedrun/SUPPLIES.md), so a buying plan refuses to
start without `--run-ended`, and the errand refuses again without it. Before buying, `exchange.ts` bounds the
plan's quantity on the ask side (`buyCost`: N units cost between N at the best ask and N at the mean ask). **The
fallback food is no food:** an account whose bank has no sharks left, or whose purchase leaves fewer than
`minimum` (28) banked, goes to `foodFallbackMix`, plan B's low-food methods: iron (never damaged) and guards (2 per
failure, kebabs bought in Al-Kharid with its own coins). The heroes are refused there (four times the knights'
sharks).

**The ledger** (`DIR/ledger.jsonl`, `ledger.ts`): a line per account every 50 of its ticks (stage, coins carried
and banked, the bank at store cost and at what it realises sold into the open bids less the 5% fee, the observed
ms a tick), a totals line on the same cadence (book value merged across accounts so two accounts never count one
bid twice), and the ramp's holds and decisions, admissions, redirects, purchases, sales and the logouts. The bank is
only visible open, so `banked` is its count at the last visit. Accounts appear as aliases (`a01` for the plan's
first, `names.ts`), every string is scrubbed of the plan's names before it is written, and the runner refuses to
start without the names file (`lib/accounts.ts`) or, on real accounts, with any account missing from it.
`--placeholder-data` is for lab accounts. `DIR/events.jsonl` has every stage change and role log line.

**Sales into the bids** (`sell`, off by default): `errands.ts` reads the book, refuses below the item's floor,
withdraws at most the cap (500, never above 5,000) as notes, reads again, offers at the floor (each unit fills at
its bid's own price, best first), waits `fillMinutes`, cancels the rest and banks the proceeds. An offer whose
placement outcome is unknown is never retried. The Exchange is at the Varrock west bank and nothing yet brings an
account back from Ardougne or Shilo, so a plan may enable sales only when every account it can move works within
walking distance (`SALE_ROUTE`: guards); iron ore and gems wait for that return trip.

**Stopping:** SIGINT or SIGTERM stops every account at its next safe point and logs it out (`logoutDirect`
re-clicks through the post-combat window); a second signal exits at once. `--minutes N` stops the same way. The
exit code is 0 when every account logged out.

### The lab run

fedora, `NODE_TICKRATE=400` (observed 400.0 ms a tick, 95th percentile 400.3), block M11, one runner process.
`markets/phase2/lab.ts` ran 22 lab accounts: 16 knights (15 left Tutorial Island through S00's skip and got 400 sharks
banked by `::give`; one stayed fresh with no sharks), 4 guards and 2 iron, the rest fresh. Every level was earned by
the runner's own stages. Ramp steps 8 and 16, 10-minute holds. It ran as run 1 (36 minutes, stopped by SIGINT to
fix the ramp's clock) and run 2 (150 minutes) on the saved accounts; runs 3 and 4 put 8 of the trained knights
through a 4-then-8 ramp with 5-minute holds to check the fixes below.

| What | Measured |
|---|---|
| Logins | 22, 2 s apart, answered in 27-1,038 ms; run 2 had no refusal, failed stage or session error |
| Fresh account to its method | iron 3.5-4 min (tutorial, coins, Mining 15, ship); guards 24-41 min; knights 60-108 min |
| Ramp step 1 (run 2) | 8 knights, held 10 min once all 8 pickpocketed: median 15.05 gp a tick, **135.5k an hour** a login |
| Ramp step 2 (run 2) | 16 admitted, 15 measured (the 16th had gone to the food fallback): median 17.14, **154.2k**, 1.14 times step 1: done. **No loss from 8 to 16 knights** |
| Food fallback | the fresh knight found no sharks at its first bank visit and went to the guards (a `redirect` line) |
| Rates over run 2 (`report.ts`) | knights **140.6k coins an hour** a login (130.6-146.5k, 15 logins, 11,750-18,950 ticks each); guards 53.6k (51.9-56.8k, 5); iron 12.2k of bank store value (~720 ore, 2) |
| Knights' food and risk | **40 sharks an hour** at HP 40 (median; 28-44), no deaths, 6.3-7.7% failures |
| Stopping | SIGINT: 22 accounts out within 8 s (run 2) and 14 s (run 1), every account `out`, exit 0 |
| Exchange errands, on the lab's own book | a sale with a 150 floor was refused (best bid 100); at an 80 floor, 500 iron ore (the cap) sold into a 100 bid for 47,500 coins after the fee; the shark purchase at a 701 ceiling filled 120 at the 600 ask and banked 120 |

Against `methods.md`: the knights' 140.6k sits with the lab's 126-131k at 1-8 bots (Thieving 99, HP 99) and 133.9k
at HP 70, now at 16 bots on the 4 knights. The guards' 53.6k is under the 62.9k measured at Thieving 99 because
these climbed from Thieving 1 inside the stretch. Iron is under the 1,208 ore an hour at Mining 99 because it mined
from 15. The knights' bank store rises slower than their coins (109k an hour) because a knight carries up to 50,000
between bank trips: coins are the measure for a carrying method.

**What it means for the plan:**

- **The cow pen is the setup bottleneck.** `hp-train.ts` has one low-level site, the Lumbridge pen. With 20 accounts
  on it at once the first two reached HP 40 at 3,389 and 4,430 ticks (rs/553: 1,707-1,972 with 2), and most were
  still under 30 after 5,300 ticks: each bot counted ~150 kills, mostly shared. The knights reached the market
  60-108 minutes after logging in, not the ~18 minutes (0.3 login-hours) of the setup table above, and 43 at once
  would be slower still. More low-level sites in `hp-train.ts`, or a cap on how many accounts train at once, is the
  fix; neither is built.
- **Sharks: 40 an hour a knight at HP 40, not 30.** 43 knights over 72 hours eat ~124k, which is what the supply
  check (`sharks.perLoginHour`, now 40 by default) bounds against the asks.

**What the lab fixed in the runner**, each found by these runs:

- The ramp's admission timeout counted from the start, so step 1 opened its hold at 30 minutes with no knight
  admitted. The ramp now opens when the first knight reaches admission, and a hold with nothing measured goes back
  to waiting for its step.
- Run 2's step 1 was measured while its knights' Thieving still climbed from 55 (12% under step 2), a low reference
  that would hide a later step's loss. A knight now counts as working only at Thieving 99.
- `thieving.ts`'s ship leg counts itself done at its `to` level: run 3's trained knights (Thieving 99) never sailed
  and were given up after three tries. A knight dying in the market after 99 would have been lost the same way. The
  runner now asks the leg for a level no account reaches.
- An account's banked coins count as 0 until it sees its bank, and run 3's knights (250k banked from run 2) first
  saw theirs inside a hold. Ramp readings now start only once the bank has been seen; run 4 confirmed every measured
  knight's first sighting came before its hold (step 1 13.7 gp a tick, step 2 17.5: done).
- The shark purchase read the bank after closing it and reported 0 banked, which would have sent every buying
  knight to the food fallback (the Exchange check, before run 1).

```sh
# block M11 on fedora, from a copy outside the build slot, in a tmux server
. markets/methods/lab/block.sh M11 && LAB_RUNNERS=0 LAB_TIMEOUT=12000 speedrun/lab/lab.sh p2f00 \
  'markets/phase2/lab.ts:--prefix=p2f:--knights=16:--hungry=1:--guards=4:--iron=2:--steps=8,16:--hold=10:--sigint=150:--out=/tmp/rs544-run2'
bun markets/phase2/report.ts /tmp/rs544-run2/ledger.jsonl
```

## Horizons

Capital earned in the first 6, 24 and 72 hours of phase 2, setup subtracted, caps applied
(`bun markets/methods/phase2-plan.ts`):

| Allocation A (with knights) | Logins | Cap binds at | 6 h | 24 h | 72 h |
|---|---|---|---|---|---|
| Shilo gem rocks | 1 | jade bid, ~16.6 h | 1.57M | 6.02M | 14.22M |
| Steel bars | 1 | | 1.21M | 4.95M | 14.93M |
| Knights of Ardougne | 43 | | 25.49M | 105.99M | 320.64M |
| **Total** | 45 | | **28.26M** | **116.95M** | **349.80M** |

| Allocation B (no knights) | Logins | Cap binds at | 6 h | 24 h | 72 h |
|---|---|---|---|---|---|
| Shilo gem rocks | 1 | jade bid, ~16.6 h | 1.57M | 6.02M | 14.22M |
| Steel bars | 1 | | 1.21M | 4.95M | 14.93M |
| Iron ore | 12 | iron bid, ~66 h | 6.50M | 26.33M | 77.01M |
| Heroes | 8 | | 3.30M | 13.81M | 41.84M |
| Varrock guards | 23 | | 7.93M | 32.77M | 99.02M |
| **Total** | 45 | | **20.51M** | **83.88M** | **247.03M** |

**Crossovers.** Shilo (0.8 h setup, 301k) overtakes a knights login (0.3 h, 104k) after **1.1 hours**; iron (0.1 h,
92k) leads knights only until **1.8 hours**; steel leads everything after its setup. So the 6-hour answer is the
72-hour answer. What differs: by 24 hours the jade bid is gone (Shilo's login is worth 171k after ~16.6 h), and by
72 hours allocation B's iron bid is nearly gone (66 h) and those 12 logins move to guards. If the jade bid is gone
before phase 2 starts (it drains ~173 an hour to other sellers), Shilo is worth 171k from the start and still
beats a knights login.

**Prices over the horizon.** The deep bids are fixed-price limit orders: they pay their price until filled, then
the outlet is gone, which is a step down, not inflation. The flow outlets (steel bars, death runes) moved -3.4% and
-1.9% a day over the last 7 days (volume-weighted fit of ln vwap on daily buckets, `book.ts` `priceDrift`), and
the 30-day fits (+8% to +12% a day) trace the market's first weeks rising from store cost, not a trend to project.
**The tables assume no drift.** At the 7-day magnitudes (+-3% a day) a 72-hour flow sale moves +-9%; steel's 72-hour
figure would range 13.6M-16.3M.

## The deep bids as a one-off harvest

Coins committed at 08:45Z, and what left each bid in the ten hours since 22:30Z. **No bid grew** (except water
runes, from 3,000 to 567k coins): nothing refills them, and other sellers are already draining them.

| Bid | Units, price | Coins committed | Drained by others since 22:30Z | Our method | Our draw |
|---|---|---|---|---|---|
| Iron ore | 993,853 at 80 mean (best 110) | 79.5M | 5,430 (~530/h) | iron | 1,208/h a login |
| Coal | 6,844,263 at 12.4 mean (best 80; at most ~1.06M units can sit at 80+) | 84.8M | 3,842 | none at our rates | |
| Uncut gems (5 types at 2,500, diamond 3,500) | 49,971 | 134.4M | 3,010, of which jade 1,772 | Shilo | ~124 of the 233 gems/h (68 of 128 rolls) |
| Runite bar | 1,884 at 41,005 | 77.3M | 133 | (runite) | |
| Blood rune | 17,120 at 633 mean (best 1,301) | 10.8M | 796 | heroes | ~15/h a login |
| Rune essence | ~471k at 55 (rs/502's read) | ~26M | not re-read | (essence: 81k/h, rs/502) | |

7-day traded volumes (`book.ts` history, the Exchange's only refill signal) are in the book file; the opal bid shows
what happens: 10,000 traded at 2,500 in a week, then the bid was gone.

## Shop stock against the Exchange (inflation hedge)

Shop prices follow ObjType.cost and the shelf, not the market, so a shop line whose Exchange price is far above it
is a hedge (`markets/methods/shop-hedge.ts`; shelves from the 23:43Z live reading where read, else config base).

| Shop | Item | Shelf / base | Shop price | Exchange net (outlet) | Restock / h (world) | Coins / h | One-off | Note |
|---|---|---|---|---|---|---|---|---|
| Oziach | Dragonhide body | 2 / 2 (config) | 10,140 | 23,750 (bid) | 18 | 240,768 | 26,986 | needs Dragon Slayer |
| Magic Guild | blood rune | 1,000 / 1,000 (config) | 50 | 1,236 (bid) | 30 | 35,580 | 998,750 | **after-run-only**; a fleet helper camps this shelf (SUPPLIES.md), so the config stock is not there |
| Magic Guild, Lundail | death rune | config | 30 | 421 (flow) | 60 | 23,449 | 279k + 73k | **after-run-only** (H7) |
| Magic Guild, Lundail | nature rune | config | 20 | 709 (flow) | 30 | 20,656 | 614k + 156k | **after-run-only** (S18e) |
| Aubury, Betty | elemental runes | 0-12 of 1,000-2,000 (live) | 24 (drained) | 34-38 (bid) | 900 | ~10-20k | ~0 | drained by someone already |

The one-offs are what draining a full shelf down to the margin's end returns; the hourly figures are the shared
restock, one login's worth for the whole world. Worth one login's errands after the run, not a method.

## How this was measured

- **Labs:** bgsrv-ub, `NODE_TICKRATE=400`, blocks M8 (9970-9972, 44970, 7970, 45970, 43970-43971) and M9
  (9980-9982, 44980, 7980, 45980, 43980-43981), every port checked free by `markets/methods/lab/block.sh`.
  Measured tick length is in `data/phase2-lab-20261023.json` per configuration (400.0-401.5 ms when the host was
  quiet; 411-553 ms during other tenants' load, with per-tick rates unchanged).
- **Whole-run accounting:** `rate.ts` now also reports `RESULT run`, bank plus pack plus worn items at the first
  bank visit against the same at the stop (`trips.ts` `holdings`, `span`), so a short run counts its unfinished last
  trip and charges only the food actually eaten.
- **Loops:** `markets/methods/mine.ts` (mining with respawn tracking: Shilo, iron, runite), the fleet smelter's
  smelt mode (steel), `pickpocket.ts` (knights, heroes), `hp-train.ts` (Hitpoints; measured by `lab/hp-run.ts`).
- **Book:** `bun markets/methods/book.ts` (public reads, 3 s apart; `data/phase2-book-2026-10-23T084522Z.json`).
- **Live:** markets' knights and coal probes (`data/knights-live-20261023T0253Z.jsonl`,
  `data/coal-live-20261023T0402Z.jsonl`); tick length from wallMs / ticks (400.4 and 400.2 ms), not the files'
  `tickMs: 300` field.

```sh
# crowding (bash; block M8)
LAB_LOG=$TMPDIR/k bash markets/methods/lab/crowd.sh M8 knight m8k 2400 "1 2 4 8" --hp=99
# mining at the demo's respawn: pin the player count, rebuild, then run
bash markets/methods/lab/emulate-players.sh 1400
LAB_LOG=$TMPDIR/g bash markets/methods/lab/crowd.sh M8 shilo m8g 2700 "1 2 4"
# single runs: iron, steel
. markets/methods/lab/block.sh M9 && LAB_HELPERS="b2" speedrun/lab/lab.sh b1 \
  'markets/methods/lab/parallel.ts:b1=iron,--ticks=900:b2=steel,--ticks=900'
# hitpoints to 40, two fresh bots (hp-training.md)
. markets/methods/lab/block.sh M10 && LAB_HELPERS="b2" speedrun/lab/lab.sh b1 \
  'markets/methods/lab/hp-run.ts:--bots=b1,b2:--stagger=10:--out=/tmp/hp40'
```

## Not done, in the brief's order

- Runite: no lab rate (bots stalled in the Lava Maze dungeon); the row is content arithmetic.
- Battlestaves: the Charge Water Orb cycle and loop were not run; the inputs rule the method out regardless.
- The 10-HP Baker case in the lab: not run, because the live probe's own tick split answers it.
- Iron crowding on one cluster beyond 1 bot, and the coal leg of steel at the guild under the demo's contention.
