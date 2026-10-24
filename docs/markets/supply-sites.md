# Scarce supply sites: Shilo gem rocks and the five runite rocks

rs/686, for markets (cairn://p/rs/markets). Who holds the world's scarce gathering sites, what each site can produce,
what the Grand Exchange (the GE) absorbs, and who owns the deep gem bids. Read-only: public `/playerpositions`, the GE
market API, the runite and bank boards, the player hiscores, and the game content. No demo logins.

Each figure is marked **M** (measured on the demo), **I** (inferred: arithmetic or judgement on measured parts), or
**C** (read from the game content and not tested in the lab).

## The window and the data

- **Positions:** one `/playerpositions` read a minute, 2026-10-24 03:54:48Z to 16:53:48Z. That was 776 reads, 2 of
  which failed and recovered on backoff. 917 to 1,435 players were online, 1,311 on average. A read at 14:29Z saw 0
  players and the next 69: that was a demo restart.
  `markets/scan/headcount.ts` counts a player at a site when they are on the rocks' plane and within 8 tiles of a
  rock. Rock tiles are the maps' gemrock and runiterock entries. A 24-tile ring round the surface runite catches
  passers-by.
  Data: `data/sites-headcount-2026-10-24T0354Z.jsonl`, with the summary in `data/sites-headcount-report-2026-10-24.json`.
- **Book:** quotes for the seven uncut gems, runite ore and runite bars every 10 minutes (78 rounds, 03:57Z to
  16:47Z), with hourly and daily history at both ends (`markets/tools/book-watch.ts`,
  `data/sites-book-2026-10-24T0356Z.jsonl`).
- **Holders:** the runite board and a bank-board search for each uncut gem, casket, runite ore and bar, at 03:59Z,
  10:04Z and 17:07Z (`markets/research/rs686-holders.ts`, `data/sites-holders-*.json`). The skill hiscores of every
  regular are in `data/sites-players-2026-10-24.json`.
- **Miners:** players standing next to any ordinary ore rock, per read, as counts only
  (`markets/research/rs686-miners.ts`, `data/sites-miners-2026-10-24.json`).
- **Our accounts:** dropped from every file and recorded as a count per site (`markets/lib/accounts.ts`, which always
  excludes `cairn_*`, `money_*` and markets' main account, `ALWAYS_EXCLUDED`). **Our count was 0 at every site in
  every read (M).**

Combat levels below come from the hiscores through the 2004 formula (I).

## 1. Who holds each site

| Site | Rocks | Wilderness | Rivals present (mean, max) | Regulars, share of reads (M) |
|---|---|---|---|---|
| Shilo gem rocks (2820,2998) | 7 | no | 0.62, 2 | Croesus 62% (4 sessions of 1.5-2.5 h). Cb5exo once, for 1 min. |
| Heroes' Guild basement runite (2937,9882) | 2 | no | 1.83, 4 | U238 90%; Tygem020 48% (32 sessions); Tygem050 30% (30 sessions); Based 15% |
| Wilderness surface runite (3059,3885) | 2 | level 46 | 1.99, 3 | Xulvexi 95%; Bramble 92%; Jenkins13 12% (left at 05:47Z) |
| Lava Maze dungeon runite (3046,10265) | 1 | level 44 | 0, 0 | nobody in 776 reads |

**The surface runite pair is a miner plus a guard, both bots (I from M).**

- **Xulvexi** (Mining 99, Attack 82, Defence 82, Strength 76, HP 80, Prayer 50, combat 98). It stood on one tile,
  3059,3884, in 732 of its 734 reads. It was present for the whole 13 h, leaving only for 4-6 minute gaps at a
  near-clockwork interval (06:31, 08:10, 09:50, 11:29, 13:07: every 98-100 minutes).
- **Bramble** (99 Defence, Hitpoints, Ranged and Prayer, Thieving 58, nothing else; combat about 109). It stood on one
  tile, 3062,3885, from 04:49Z to the end, and **mined nothing**: it is absent from every runite board, whose week
  table goes down to 1 ore. A ranged tank build parked beside a miner is a guard (I).
- **History.** Both were in the 2026-10-22 22:47Z headcount (`data/headcount-2026-10-22T2247Z.json`), when the site
  held 12-15 accounts with generated pronounceable names (Foqaveli, Juxarevi, Neruxoji, Woqenula, Zivqatep, Xulvexi...).
  Xulvexi fits that family (I). Only the pair is left.
- **Passers-by.** Only five other names entered the 24-tile ring in 13 h, about 0.4 an hour (M): Jenkins13 (the
  miner), Goondelf (combat 126, 99 melee and Prayer, 3 brief reads, also seen on 10-22), Achilles (total level 28),
  Vertigo (73) and Bf0os4 (77). Goondelf and Achilles arrived on the same read. One read a minute can't see a
  fight, so this gives traffic, not kills.

**The Heroes' Guild pair.**

- **The Ty* accounts.** Tygem020 and Tygem050 (99 Attack, Strength, Defence, HP and Mining, combat 122) rotate in
  short sessions and were present together in 153 of the 452 reads either was in (M). They belong to a large
  `Ty*` family (tygem###, tyrun##, tywalk## in `lib/fixtures/playerpositions.json`). The tygem accounts bank runite
  ore (tygem002 1,829, tygem030 851, tygem029 506) and gems in the random-mining ratio (§4).
- **U238** (99 Strength, Cooking, Fishing, Smithing and Mining, combat 109) is in a `U2xx` family. **u240**'s banked
  runite ore rose from 613 to 668 over the window (M), which fits a hand-off from U238 (I).
- **Based** (combat 124) came for about 2 h.
- None of them looks unattended in the way the surface pair does, but all are Mining 99.

**Shilo.** Croesus (Mining 99, Magic 85, combat 82) mined in four sessions, with absences of 44, 76 and 117
minutes. §3 ties those absences to the 10,000 ruby asks.

## 2. Output against the market

### Shilo's ceiling

Respawn is base × (4000 − players) / 4000, with players capped at 2,000 (C:
`general/scripts/player_count.rs2`). Gem rocks have a base of 200 ticks; a tick is 400 ms, so an hour is 9,000 ticks.
The ceiling is 7 rocks × 9,000 / respawn. That ignores the ~11 ticks of swinging per gem, so it's an upper bound,
but one login can work all 7 rocks (`methods.md`).

| UTC hour | Online (M) | Respawn, ticks | Gems / h (I) |
|---|---|---|---|
| 03 | 1,203 | 140 | 450 |
| 04-05 | 1,270-1,290 | 136 | 462-465 |
| 06-09 | 1,299-1,352 | 132-135 | 467-476 |
| 10-12 | 1,362-1,396 | 130-132 | 478-484 |
| 13 | 1,315 | 134 | 469 |
| 14 (restart) | 1,138 | 143 | 440 |
| 15-16 | 1,257-1,279 | 136-137 | 459-463 |
| **mean** | **1,311** | **134** | **469** |

The gem table (C: `skill_mining/configs/gem_rock_table.dbrow`) splits each gem 60 : 30 : 15 : 9 : 5 : 5 : 4 of 128
across opal, jade, red topaz, sapphire, emerald, ruby and diamond. Against what the GE traded:

| Gem | Site ceiling / h (I) | Sold / h in the 13 h window (M) | Sold / h over 7 days (M) | Notes |
|---|---|---|---|---|
| Opal | 220 | 0 | 59.5 | the 7-day figure is the wall's whole 10,000 order filling; **no bid now** |
| Jade | 110 | 103.5 | 50.1 | the window's 1,346 came in 2 trades, a stockpile sold in lumps and not mining |
| Red topaz | 55 | 21.0 | 21.3 | 273 in 3 trades; about 1,015 of the 7-day volume traded at 10,000 on 10-17 to 10-19 |
| Sapphire | 32.9 | 14.8 | 29.7 | 19 trades: the steady trickle; also fed by random gems (§4) |
| Emerald | 18.3 | 6.4 | 6.1 | |
| Ruby | 18.3 | 2.3 | 7.3 | 7 days: about 1,118 at **10,000** and 106 at 2,500 |
| Diamond | 14.6 | 7.1 | 5.2 | |

The site is worked by one account about 62% of the time, and its gems reach the GE irregularly: lumps of a
thousand opal or jade, and rubies listed at 10,000. **So of a ~470 gem-an-hour site, the steady flow into the wall
is a few tens of gems an hour, mostly sapphires, and much of that isn't from Shilo (I).**

### What the wall can still pay

The pool of open bids at 16:47Z (M). Net is after the GE's 5% seller fee.

| Gem | Units at the wall | Wall price | Above the wall | gp gross | gp net |
|---|---|---|---|---|---|
| Opal | 0 | - | small bids at 750-1,750 for 11-25 units, briefly | 0 | 0 |
| Jade | 1,588 | 2,500 | - | 3,970,000 | 3,771,500 |
| Red topaz | 7,466 | 2,500 | - | 18,665,000 | 17,731,750 |
| Sapphire | 6,535 | 2,500 | - | 16,337,500 | 15,520,625 |
| Emerald | 9,018 | 2,500 | 26 at 3,000 (new at the end) | 22,623,000 | 21,491,850 |
| Ruby | 9,893 | 2,500 | 12 at 2,501-2,504 earlier, shrinking to 4 and then gone, never traded | 24,732,500 | 23,495,875 |
| Diamond | 9,284 | 3,500 | 8 at 4,500 (new at the end) | 32,530,000 | 30,903,500 |
| **Total** | | | | **118,858,000** | **112,915,100** |

The step-over units come from the bid's value: (coins committed − wall price × units) / (best bid − wall price).

### Hours to fill, and the stockpiles in days of site output (I)

Our likely share of the Shilo clock is about 0.69 for one login: everything while Croesus is away (38% of reads), and
half while Croesus is there.

| Gem | Hours to fill the wall, whole clock | At our 0.69 share | nickai3's stack | In days of site output | ice3's stack | In days |
|---|---|---|---|---|---|---|
| Jade | 14.5 | 21 | - | - | - | - |
| Red topaz | 136 | 197 | - | - | - | - |
| Sapphire | 199 | 288 | 181,718 | 230 | 37,396 | 47 |
| Emerald | 494 | 716 | 99,170 | 226 | 18,678 | 43 |
| Ruby | 541 | 784 | 49,520 | 113 | 9,114 | 21 |
| Diamond | 636 | 922 | 12,273 | 35 | 2,329 | 6.7 |

nickai3's rubies are 5.0 times the ruby wall, and its sapphires 28 times the sapphire wall. Neither stockpile moved in
the window (M).

**Income for one login at a 0.69 share (I).**

- **From the ceiling:** about 417k coins an hour while the jade bid lasts (~21 h), then about 237k (net of the fee;
  opal has no outlet).
- **From the lab's measured solo rate** (`methods.md`: 516k and then 294k alone on the site): about **356k, then
  203k**, which is the figure to plan on.

### Runite's ceiling in the same units

The runite base respawn is 2,400 ticks (C). At the mean 1,311 online that's 1,613 ticks, so **5.58 ore per rock per
hour (I)**: 11.2 an hour for each two-rock site, 5.6 for the dungeon rock, and 27.9 across all five.

**Measured output at the surface pair.** The runite board counts only those two rocks (C: `DebugOps.ts`
`LEADERBOARD_RUNITE_ROCKS`).

- **xulvexi:** went from 2,117 to 2,252 all-time between 03:59Z and 17:07Z, which is **10.3 ore an hour, 92% of the
  ceiling** (M for the counts, I for the share).
- **jenkins13:** added 6, all before 05:47Z.
- **Together:** about 95% of the ceiling.
- **Over 7 days:** xulvexi has 2,073 in the board's rolling week, about all the pair can give.

**What runite ore and bars fetch (M for the book).**

| | Open | Best | Mean of the open bids | Traded in the window | Value per ore, net (I) |
|---|---|---|---|---|---|
| Runite ore | 22,532 | 5,500 | 4,904 | **0** (406 in 7 days) | at most 5,225 |
| Runite bar | 1,679 | 41,005 | 41,005 | 106, all at 41,005 (1,574 in 7 days) | 38,955 − 8 coal (~640 at the 80 coal bid) = **38,315** |

- **The ore bid is several orders, not one wall.** About 20,000 units sit at a mean of 5,375. At 07:57Z an order
  of about 2,544 more arrived at about 1,180, and small orders were re-priced or cancelled without a trade.
- **Bars need Smithing 85 and 8 coal each.** If we mine the coal ourselves, the live coal probe's 98 an hour (`probes.md`)
  makes 8 coal about 5 login-minutes.
- **The surface pair is worth** 58k an hour as ore into the bid, or **428k an hour as bars** (I).
- **The bar bid absorbs** 150 h of the surface pair's output (1,679 / 11.2), or 60 h of all five rocks. Others
  already fill it at 8.3 bars an hour (M).
- **The ore bids absorb** about 2,000 h.

**Where the runite goes (M).** None of xulvexi's ore reached the GE (no ore traded in the window), and xulvexi isn't
in the top runite ore holders. It's traded away or held below the board's listing; the public data can't tell which.

- **Bar stacks grew elsewhere:** stein's banked bars rose from 723 to 1,110, and nickai3's from 459 to 749, far more
  than the bid filled. So bars are being smithed or handed over off-market.
- **Ore stacks were static:** goo001-003 (3,341 / 3,247 / 1,857) and the tygem stacks didn't move.

## 3. Who the deep bids are

**The gem wall and the runite-bar bid are banker (wealth rank 2) (I, strongly).** Every unit the wall bought appeared
in banker's bank:

- **Opal:** 10,000 held, and the 10,000-unit opal bid has filled to 0.
- **First half of the window (03:59Z-10:04Z):** jade +1,346 against bid fills of 1,175 + 171, emerald +55 against
  55, diamond +59 against 59, ruby +1 against 1.
- **Second half (10:04Z-17:07Z):** red topaz +85 against 85, emerald +27 against 27, diamond +33 against 33, ruby +4
  against 4, sapphire +52 against 53.
- **Runite bars:** +106 against the bar bid's 106 fills. banker's bars didn't move until 10:04Z and then caught up
  exactly, which fits fills landing on collection.
- **The orders themselves:** each gem started as one 10,000-unit order at a round price (2,500, and 3,500 for
  diamond). Every unit of each order is at that one price (the mean bid equals the best bid). None refilled in 13 h.
- **The two exceptions:** banker holds about 1,000 red topaz and about 13,200 sapphire more than the wall bought
  (3,534 against 2,534 filled, and 16,678 against 3,465). 590 of the extra topaz arrived during the window without
  passing through the bid, so banker also takes gems by direct trade (I).

What the data can't do is tie an order to an account directly. The API has no order list or trader identity. The
link is the arithmetic, which matched to the unit in nine separate fills.

**The 10,000 ruby ask is a gatherer, almost certainly Croesus (I), and not the 2,501 bidder.**

- **The ask grows.** It went 138 → 172 → 198 → 235 units. Each step is a new sell offer, created at 05:43Z, 09:12Z
  and 13:32Z (the API's newest-ask time). Then 25 sold at 10,000.
- **The timing matches Croesus.** Each of those creation times falls inside one of Croesus's three absences from Shilo
  (05:25-06:09, 08:39-09:55, 12:26-14:23). An opal ask of 2,272 at 2,500 was created at 05:46Z, in the same absence,
  and was withdrawn unsold by 09:17Z. Croesus was away about 30% of the window, so all three ruby listings would
  fall in absences by chance about 3% of the time.
- **The 2,501 bidder can't be the supply.** It was a separate small order of 12 units at 2,501-2,504, cut to 9, then 4,
  then gone, and it never traded in the window. The ask gained 97 units while that bid gave up nothing to trades, so
  the asker isn't buying low there to sell high.
- **What stays open:** whether the small step-over bidders on ruby, diamond (8 at 4,500) and emerald (26 at 3,000) are
  one actor.

**The real ruby market is at 10,000.** Over 7 days about 1,118 rubies traded at 10,000 against 106 at 2,500 (M,
solved from volume and gross). A buyer pays 10,000 for rubies when asks exist. In this window it took only 25.

**The opal stack moved off-market.** After the opal ask was withdrawn, stein held 2,353 uncut opal (10:04Z), and
Croesus's opal and jade dropped out of the holder lists (M). A direct trade from Croesus to stein fits this (I) but
can't be shown.

## 4. Other gem sources

The four bid gems (sapphire, emerald, ruby and diamond) also come from:

| Source | Mechanics (C) | Trickle (I unless marked) |
|---|---|---|
| Random gem while mining any ordinary ore | 1 in 256 swings (1 in 86 with a charged glory amulet), then sapphire 32, emerald 16, ruby 8, diamond 2 of 128 (`mining.rs2`). Rune pickaxe: a swing about every 3 ticks | **127.5 players stand at ore rocks on average (M, max 162):** coal 50, iron 36, adamantite 8.6, others under 7. A continuously swinging miner rolls 5.3 bid gems an hour, so at a 30-60% duty about 200-400 an hour world-wide: rubies 28-56, diamonds 7-14, emeralds 55-110, sapphires 110-220. **That beats Shilo's ruby, emerald and sapphire output and matches its diamonds.** Cross-check (M): active tygem accounts banked 17-28 sapphires, 9-10 emeralds and 3-8 rubies each in 13 h, about 3-4 bid gems an hour, which fits a 0.6 duty. These are banked, not sold |
| Big-net caskets | casket roll stat_random(1, 2) per 5-tick cast, about 2 in 256 at Fishing 99, so ~14 caskets an hour; a casket gives sapphire 32, emerald 16, ruby 8, diamond 2 of 128 (`memberfish.rs2`) | ~6 bid gems an hour per active fisher **if opened**. The casket holders (feifeili, nvidia, samaltman... ~450-490 each) keep them unopened and static (M), so this feeds nothing now |
| Monster drops | `~randomjewel` (the same 32 : 16 : 8 : 2 split) through the rare-drop chain in about 60 NPC drop scripts | not quantifiable from public data |
| Gem stall, East Ardougne (2667,3303), the only one | Thieving 75, 600-tick respawn, sapphire 105, emerald 17, ruby 5, diamond 1 of 128 | at most 15 steals an hour: 12.3 sapphire, 2.0 emerald, 0.6 ruby, 0.1 diamond |
| Gem shops (Herquin, the Al Kharid gem trader) | 0-1 of each, restocking one per 15,000-60,000 ticks (`supplies.md`) | negligible |
| Lava Maze muddy chest | 1 ruby per muddy key | negligible |

The big holders' gems show where the supply sits.

- **nickai3 and ice3, and the tygem family and bjzx62 at smaller scale,** hold sapphire, emerald, ruby and diamond in
  exactly **16 : 8 : 4 : 1** (M). That is the casket, random-mining and rare-drop split, and nothing like Shilo's
  9 : 5 : 5 : 4. None of those gems came from Shilo.
- **The Shilo signature, opal 60 : jade 30 : topaz 15,** appears only in small holders: Croesus, jdj82akghv and
  tlsrune134.

## 5. Wilderness risk at the runite sites

- **Levels (C):** level = (z − zone start z) / 8 + 1 (`wilderness_levels.rs2`, `wilderness_zones.dbrow`). The surface
  rocks are at **46** (the board's own blurb agrees), the dungeon rock at **44**, and the Heroes' Guild basement is
  outside the Wilderness.
- **Who can attack (C, `pvp_combat.rs2`):** an attack is allowed when the combat-level difference is no more than the
  lower of the two players' Wilderness levels. At 46, a combat-98 miner can be attacked by anyone of combat 52 or
  more. In single-way combat, only one attacker at a time.
- **Being attacked doesn't stop mining (C).** A hit only applies damage (`[queue,pvp_damage]`). Auto-retaliate, when
  on and the player isn't busy, replaces the mining action with an attack back (`auto_retaliate.rs2`). Death stops
  everything. A hit blocks logout for 16 ticks (6.4 s).
- **Death (C, `death.rs2`):** an unskulled player keeps their 3 most valuable items, plus 1 with Protect Item, and drops
  the rest: every ore, and the pickaxe unless it's in the top 3. An attacker who starts a fight is skulled for 2,000
  ticks (13.3 min) and keeps nothing, or 1 item with Protect Item. rs-sdk adds that for 1,000 ticks after a PvP death,
  any death respawns at 1 HP.
- **Traffic (M):** about 0.4 passers an hour within 24 tiles of the surface rocks, beyond the resident pair. The
  pair itself includes a combat-109, Prayer-99 ranged account on station all day.

## Recommendation

**Shilo: one login, possibly two for bank-trip cover, and no more.** The site is one world clock that a single login
can saturate, and Croesus holds it 62% of the time. One login takes about 0.69 of the clock. On the lab's solo rate
that's **about 356k coins an hour for the ~21 h the jade bid lasts, then about 203k** (I).

What it earns comes from banker's one-time pool of about **113M net**. Most of that is in emerald, ruby and diamond
orders our share would take 700-900 hours to fill, and opal (47% of the gems) has no bid at all. The risks are
concentrated:

- **banker is a single actor** and can pull or re-price every gem order and the runite bar bid at once.
- **nickai3's stockpile** holds 113 days of the site's rubies and 230 days of its sapphires. If it sells, the wall is
  gone without us.
- **Rubies:** list a share at 10,000 beside Croesus rather than into the 2,500 wall, since the 10,000 buyer took
  1,118 in the last week.

**Runite: not worth fighting for at the surface.**

- **Who holds it:** xulvexi takes 92% of the pair's ceiling, guarded around the clock by Bramble (combat about 109,
  Prayer 99).
- **What winning pays:** about 428k an hour as bars, but only while banker's bar bid lasts. That bid holds 1,679 bars
  (about 64M net), and others already fill it at 8 an hour. Even if we took the whole surface output, it would run
  out in about 86 h.
  Ore has no market (0 trades in 13 h).
- **What it costs:** guards that can repeatedly kill a 98 and a 109 and hold the tile, under 13-minute skulls that
  forfeit their gear.

The better runite option is the **Lava Maze dungeon rock, empty for all 13 h**. One login with Mining 85 and Smithing
85 could take 5.6 ore an hour, about 214k an hour as bars before travel and coal (I). It sits at Wilderness 44,
unguarded, and its trip time is the unmeasured part, which is a lab job before any login. The Heroes' Guild pair is
outside the Wilderness but shared by four combat 109-124 regulars. A fifth would get about a quarter, roughly
3 ore and ~107k an hour as bars (I), which is no better than knights.
