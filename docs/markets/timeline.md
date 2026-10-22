# How the wealth leaders got rich: timeline, GE history, census and swarms

Public reads only (tenet 28): the bank, equipment and runite boards, item searches, player pages, the GE API and
`/playerpositions`, read through `markets/` at least three seconds apart. Read 2026-10-22 22:1xZ to 23:16Z, against
the speedrun competitor snapshot of 2026-10-21 08:04Z and its item searches at 08:13Z
(`docs/speedrun/research/competitors/data/`). The new snapshots wait for the accounts-list gate
(`markets/lib/accounts.ts`) and land in `docs/markets/data/` in a follow-up. Every figure below is quoted from them.

**What the bank board measures.** An account's total is store cost x count over its bank, not GE price
(cairn://posts/404). Coins cap at 2,147,483,647. Neither the inventory nor GE escrow counts. So the board rewards
hoarding items with a high store cost and is blind to coins sitting in GE bids.

## 1. Holdings over time

Only two dated full reads exist before the poller: 2026-10-21 08:04Z and 2026-10-22 22:35Z (38.5 h apart). The
poller then read the top 50 every 5 minutes from 22:32Z to 23:14Z. Every leader's large stacks were already present
at the first read, so **no stack can be dated earlier than "before 2026-10-21 08:04Z"** from public data. That
includes the coin rows at or near the cap, so public data can't place them in the Miscellania dupe window
(10-09 to 10-11).

| Account | 10-21 08:04Z | 10-22 22:35Z | Change | What moved |
|---|---|---|---|---|
| nickai3 | 15,886M (#1) | 16,139M (#1) | +253M | raw bass 9,766,108 -> 10,787,666; oyster 1,906,272 -> 2,105,389; uncut gems and cosmic talismans up; **air rune 1,923,311,135, raw shark 7,148,932, mind rune 247.7M unchanged** |
| banker | 8,968M (#2) | 8,019M (#2) | -949M | shark 21,258,003 -> 18,044,690; rune essence 104,084 -> 592,387; yew logs 329,976 -> 418,657; coins 2,147,483,647 (cap) and fire rune 65,872,111 unchanged |
| nickai | 2,148M (#3) | 2,148M (#3) | flat | coins 2,147.3M (cap less ~183K) |
| soko | 1,198M (#6) | 1,650M (#4) | +451M | coins 668.9M -> 1,012.4M; yew longbow +17.6K, maple +7.2K, magic +1.3K; potions and arrows up |
| **stein** | **312M (#13)** | **1,505M (#5)** | **+1,193M** | **coins 172.5M -> 1,375.1M; coal 378,794 -> 166,794 (exactly -212,000); nothing else moved** |
| kurobanker | 1,481M (#4) | 1,481M (#6) | flat | coins only |
| goo021 | 871M (#7) | 871M (#7) | flat | coins 850.7M |
| hoplite | 1,427M (#5) | 840M (#8) | -587M | coins 1,413.5M -> 827.1M; nothing else moved |
| lebek | 765M (#8) | 765M (#9) | flat | coins only |
| nickai2 | 680M (#9) | 680M (#10) | flat | coins only |
| marketmaker | 470M (#10) | 512M (#12) | +42M | coins +35M; sharks +18K |

Growth rates over the 38.5 h: nickai3 raw bass **+26.4K/h** and oyster **+5.1K/h**. The ratio of the growth
(0.195) equals the ratio of the existing stacks (0.195), the shape of one big-net source. nickai3's uncut gems grew in
the random-gem proportions: sapphire +18,640, emerald +9,292, ruby +4,759, diamond +1,154, dragonstone +85.
**No leader stack is a round number** (`timeline.ts` checks powers of ten from 1,000). The one round figure is
stein's coal outflow of exactly 212,000.

In the polls (22:32Z to 23:14Z) every leader total was flat except banker (+84K) and soko (-16M). nickai3 was offline
in every poll. stein was online at 23:04Z with no change. The soko family went from 18 online at 22:1xZ to none by
23:04Z.

### stein

stein's whole visible bank was diffed over 48 item searches. Coal is the only stack that fell (-212,000, worth
-9.5M at store cost), against +1.20B coins in. Rune essence 3,258,956, 723 runite bars, 1,804 gold bars, 279,079 law
runes and the rune armour are all unchanged. Coal traded about 5K on the GE in that window. The whole GE grossed
2.36B in 7 days, mostly four dragon trades dated 10-16 to 10-19, before the window. stein is total level 566 (Magic,
Woodcutting, Crafting and Smithing at 99, Mining 52). **Coins arrived with nothing of comparable value leaving: a
coin hand-off into stein.**

### hoplite

hoplite's -586M of coins has no visible destination. The open GE bid side commits 1.11B coins in total. The largest
bids are a dragon chainbody at 175M, 100 uncut dragonstones at 1M each, grapes 98M, rune knives 87M, coal 85M (6.85M
units at a mean of 12.4 gp, best bid 80), runite bars 82M and iron ore 80M. Escrow could hold hoplite's coins only
if hoplite owns most of those bids. Bids can't be attributed publicly, and a trade-away fits equally.

## 2. GE history against the stacks

The GE API's daily history over 90 days (the market's first trades are 2026-09-08) and the open book at 22:4xZ:

| Item (store cost) | Traded in 90 days | Trades | Open book | Holder: stack | Stack / everything traded |
|---|---|---|---|---|---|
| Air rune (4) | 3,001,060 | 2,103 | 99K bid at 4; 154K asked | nickai3: 1,923,311,135 | **641x** |
| Mind rune (3) | 81 | 6 | 1,988 bid | nickai3: 247,717,228 | **3,058,237x** |
| Raw shark (300) | 1 | 1 | none | nickai3: 7,148,932 | **7,148,932x** |
| Raw bass (120) | 0 | 0 | none | nickai3: 10,787,666 | never traded |
| Oyster (200) | 0 | 0 | none | nickai3: 2,105,389 | never traded |
| Shark (300) | 357,212 | 1,876 | no bids; 2,003,270 asked at 533 | banker: 18,044,690 | **51x** |
| Fire rune (4) | 19,741 | 66 | 27 asked | banker: 65,872,111 | **3,337x** |
| Earth rune (4) | 15,857 | 39 | none | banker: 2,866,861 | 181x |
| Rune essence (4) | 642,549 | 3,149 | 512K bid at 55 | stein: 3,258,956; banker: 592,387 | 5x; 0.9x |
| Yew logs (160) | 420,365 | 43 | 263 asked | banker: 418,657 | 1x |
| Yew, maple, magic longbow | 0 | 0 | none | soko: 149K, 246K, 37K | never traded |
| Uncut gems | 0.5K-15K each | | 2,500 bids | nickai3: 182K sapphire, 99K emerald | 12x+ |

Volume moved twice in ways that matter. On 10-12, 1.9M air runes traded (vwap 37.5), with coal and rune essence spiking
the same day. That looks like the market's first big day, not a leader's purchase. On 10-22, 472K rune essence traded at
55-56. banker's essence grew +488K over the window, matching that day's volume, so banker is buying essence and yew
logs on the GE now. Otherwise **volume stayed flat while every large stack grew or sat, so no leader stack came through
the GE**, except banker's current essence and yew-log buying.

## 3. Family census

One sweep at 22:35Z (`census.ts`: overall top 210, two pages of every skill board, the bank board and 11 item
searches, equipment, runite, positions; 1,347 online), plus skill levels from the player pages:

| Family | Accounts seen | Online | Where online | Levels | On the boards |
|---|---|---|---|---|---|
| nick* | 64 (nickai, nickai2, nickai3, nickgem02-13, and one or two single-skill accounts per skill) | 1 (nickai) | elsewhere | nickai3 1,597; nickai 1,881; nickai2 1,352 | every skill board; 14 in the uncut search (gem mules, 108 uncut dragonstones each, unchanged) |
| banker* | 2 (banker, banker2) | 2 | GE table 1, Catherby bank 1 | **total 28, no skill ranked** | bank only |
| soko* | 41 (soko, soko1-60, sokoherb1-10, sokoalt1-3, sokogp2/7, sokobot, sokoslave2) | 3 (18 at 22:1xZ, 0 by 23:04Z) | GE table | soko and sokobot 1,881 | Crafting 17, Prayer 10, QP 9 |
| kuro* | 1 (kurobanker) | 0 | - | **total 53, Thieving 25 only** | bank |
| goo* | 30 (goo001-030) | 30 in every poll | Seers' bank 19, Catherby shore 5, elsewhere | goo021 1,541 | equipment 21 of top 50; runite all-time #1, #3, #4 |
| stein* | 1 (stein) | 0 (1 at 23:04Z) | - | 566 | bank |

The same class of no-levels holder recurs: **banker (8.02B), banker2, lebek (765M coins, total 28) and kurobanker
(1.48B coins, total 53)**. An account that never trained holds wealth only by receiving it. At the GE table the
other no-levels accounts are ordinary bank mules (and our own cairn mules). All 44 names standing there have a public
player page, so **no hidden staff account stands at the GE table** (staff above level 1 are absent from every board
and player page).

## 4. Swarms in /playerpositions

The poller records every name per zone (`markets/lib/positions.ts` ZONES). Per-account stacks come from item
searches. Growth was measured over the 36 minutes between two search reads (22:35Z and 23:11Z).

| Swarm | Zone | Names | Online per poll | Per-account stack | Growth in 36 min | Feeds | Board value/h | Realisable gp |
|---|---|---|---|---|---|---|---|---|
| Harpoon sharks | Fishing Guild | random 9-character lowercase and digits | 56, 56, 56, 56 | raw shark 10.3K-12K (median 10,371) | 1 of 48 grew (+767) | nothing visible; nickai3's raw shark frozen | ~0 now (banks rarely) | **0**: raw shark has no bids |
| Air-rune crafters | air altar ruins and room, essence mine | `cx` + 8 hex characters | 17-22 at the ruins | air rune 0.5M-2.35M (median 1.64M) | 0 of 9 | nothing visible; nickai3's air rune frozen | ~0 now | ~0: 99K air runes bid at 4, about 0.4M in all |
| Cooked sharks | various | steveNNN | ~51 | shark 113K-123K, plus ~12K burnt | 0 of 44 | nothing visible; banker's sharks falling | ~0 now | **0**: no shark bids; 2.0M asked at 533 |
| Big net (bass, oysters) | Catherby | tech names (samaltman, nvidia, peterthiel, palantir and 11 more) | **0 in every poll** | raw bass 24.9K-36.7K, oyster 5.1K-7.3K (ratio 0.2) | 0 of 15 | consistent with nickai3's growth ratio | nickai3 gained **4.2M/h** (26.4K bass x 120 + 5.1K oysters x 200) | **0**: bass and oysters have never traded and have no bids |
| goo farm | Seers' bank, Catherby shore | goo001-030 | 30 | goo021 851M coins (flat) | - | nothing visible | 0 now | - |
| soko fletchers and traders | GE table | soko* | 18, then 3, then 0 | soko: longbows 149K yew, 246K maple | soko +451M in 38.5 h | soko | yew longbow 1,280 each | **0** for longbows (no bids) |

The Catherby shore held 19-25 others in each poll (xonfish*, redactedsk*, swfood* and goo026-030). None of them
holds a top-50 bass stack. nickai3's 26.4K bass an hour therefore came from accounts that were offline in every poll,
or that bank below the top 50 of the search. rs/502's lab rate for big net per login converts 26.4K/h into a login
count.

**Every swarm's catch is board value without a buyer.** None of raw shark, raw bass, oyster, shark or longbows has an
open bid; air runes have 0.4M of bids in all. The leaders' wealth is board value. Turned into coins, it would
realise almost nothing on today's book.

### The open bid pool

The outlets a gatherer can sell into at once are 98 items with bids, 1,104.8M coins committed at 23:11Z
(`bids.ts`; 1,108.5M across 93 items at 22:1xZ). The depth that matters for a sale is the mean bid, not the best
bid: coal's best is 80 but its mean is 12.4. Both readings are an hour apart, so there is no refill rate yet. The
poller records the pool's total every poll once it restarts under the accounts gate.

## 5. Verdicts per leader

The candidates are staff feeding (staff `::give` to themselves, then trade to an eligible account), a gathering
swarm with trade hand-off, the Miscellania coin dupe (2026-10-09 to 10-11, coins only), and GE accumulation.

| Leader | Staff feeding | Gathering swarm, trade hand-off | Coin dupe | GE accumulation |
|---|---|---|---|---|
| nickai3, growing stacks (bass, oyster, gems, talismans) | consistent | **consistent, and favoured**: drop-table ratios hold in the growth (big net 0.195, random gems 2 : 1 : 1/2 : 1/8) and big-net swarms exist | inconsistent (not coins) | **inconsistent**: zero GE volume |
| nickai3, frozen stacks (air 1.92B, raw shark 7.15M, mind 248M) | consistent | consistent (matching swarms exist: the air crafters and harpooners hold the same goods), but needs about 1,000 full swarm stacks each | inconsistent | **inconsistent**: 641x, 7.1Mx, 3.1Mx all traded |
| nickai3, nickai, nickai2 coin rows (at or near the cap, frozen) | consistent | consistent | consistent; can't be dated (no read before 10-21) | inconsistent: 7-day GE gross is 2.36B |
| **No-levels class: banker, banker2, lebek, kurobanker** | **consistent**: they received everything | consistent | consistent for the coin rows only | inconsistent for banker's sharks (51x) and fire runes (3,337x); consistent only for banker's current essence and yew-log buying |
| stein (+1.20B coins in 38.5 h) | consistent | inconsistent unless the swarm hands over coins | inconsistent unless the dupe is live (rs/515) | **inconsistent**: no GE path |
| soko (+451M) | not needed | consistent (41-account family, longbows with zero GE volume) | inconsistent | consistent for part of the coins (GE-table trader) |
| hoplite (-586M) | - | - | - | consistent with bids in escrow, or a trade-away |
| goo021 (flat) | not needed | consistent (30 accounts with real levels: runite, fishing) | - | - |

**Summary.** No leader stack came through the GE. The growing stacks look gathered: their growth keeps the game's
drop ratios, and big-net, harpoon and air-rune swarms of 15 to 56 accounts are visible. The frozen giants and the
no-levels holders are equally consistent with staff feeding and with a swarm hand-off. Public data can't tell those
apart, and it can't date anything before 2026-10-21 08:04Z. stein's +1.20B is the one leader move inside the
current code's lifetime, and it is a coin hand-off. Nothing in the evidence calls for a generator.
