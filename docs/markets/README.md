# docs/markets

Research for the markets mission (rs/495, thread cairn://p/rs/markets): how the demo's wealth leaders got rich,
what each method yields per login, and what speedrun supplies gold can buy. The code is in `markets/`
(`markets/README.md`). This page gives the answers; each links to the doc that holds the evidence.

## The answers

### 1. How the top three got rich

**No generator exists for a player.** Two audits found nothing that creates items or coins, by reading the code
and by tests in the local lab:

- **The GE, the save escrow and autosave** (`generator-ge-persistence.md`, rs/498). Every save is one atomic
  snapshot, and version-8 escrow is recovered exactly once. All ten in-process cases conserved items and coins, and
  so did a lab engine killed mid-trade (11,990 coins before and after).
- **Content scripts, shops, trades, the bank and notes** (`generator-content-shops.md`, rs/499). No shop round trip
  profits at any of 592,292 stock levels across 126 shopkeepers. The best gap between two shops is about 1,400 gp
  per restock (Irksol's ruby rings resold to Grum). Stacks at the cap and bank edge cases conserve in the lab.
- **One latent engine defect, not reachable today.** The two engine ops that move items between inventories size
  the dropped overflow from the requested count rather than the moved count. Every caller caps first, so nothing
  exploits it (rs/518).
- **The Miscellania coin dupe is fixed on the demo** (`demo-revision.md`, rs/515). A post-fix build was serving by
  2026-10-21 03:30Z. Whether the dupe was live for part of 10-09 to 10-21 can't be shown from public data.

**What the evidence does show** (`timeline.md`, rs/500, public reads only):

- **No leader stack came through the GE.** 90 days of history moved 3.0M air runes against nickai3's 1.92B, one raw
  shark, and no raw bass or oysters at all.
- **nickai3's growing stacks are gathered.** Its bass grew about 26,000 an hour with zero GE volume, at big-net
  fishing's own oyster-to-bass ratio (0.195). Gathering teams of 15 to 56 accounts are visible: Fishing Guild
  harpooners, about 30 `cx…` air-runecrafters, and a tech-name bass family.
- **The frozen giants and the no-levels holders can't be traced.** nickai3's air, shark and mind runes, and banker,
  banker2, lebek and kurobanker (total level 28), fit two explanations equally: a gathering team handing over by
  trade, or staff `::give` followed by a trade. rs/499 showed the staff path works in the lab: a level-4 account
  gave itself 200M air runes, traded them, and the receiving account ranked at 800,000,490. Staff accounts never
  appear on any board, so public data can't tell the two apart, and nothing before 2026-10-21 08:04Z can be dated.
- **stein's +1.20B in 38 hours was a coin hand-off.** Only about 10M of coal left its bank.

**What this means for us:** the board's leaders are not a method to copy. Their raw sharks, bass, oysters and air
runes have no meaningful bids (the whole GE bid pool was about 1.11B coins at 22:30Z), so they rank on store cost
but are worth almost nothing as capital. The mission was reframed from board rank to capital.

### 2. The method table

Per login per hour at the demo's 400 ms. Board value counts store cost in the bank only. For a coin method the board
value equals the coins. L = measured live on the demo through markets' account, m = measured in the lab, i =
inferred from measured parts. Full tables, spreads and inputs: `methods.md` (rs/502), `phase2.md` (rs/543),
`candidates.md` (rs/501).

| Method | Board / h | Coins / h | Basis | Scales with logins until | Competes with the scored run |
|---|---|---|---|---|---|
| Shilo gem rocks, uncut gems into their bids | 301k | 301k while the jade bid lasts, then 171k (alone on the site: 516k / 294k) | m (respawn emulated) + book | 1 login: the 7 rocks are one world clock | yes: S25c's gems |
| Steel bars, mined and smelted, sold into the weekly flow | 208k | 208k at 1,369 | i from m parts | 1 login sells ~36% of the world's flow | no |
| Runite, the lone rock, as bars | ~215k | ~215k | i (lab bots stalled) | 1 login | no |
| **Knights of Ardougne**, Thieving 99, HP 40, sharks from the bank | 104k net | **118.5k gross, 104k net** of 26 sharks (live); lab 142k, and 140.6k in the runner's 15-login lab run | L + m | not reached: no loss from 1 to 16 lab bots, nor live with 50-100 players near | yes: S18 pickpockets these knights; sharks are a fleet input |
| Iron ore into the 80 gp bid | 92k | 92k (126k at the best bid) | m + book | the bid's 994k ore, ~66 h for 12 logins; 2-3 logins a rock cluster (i) | yes: S18e's Superheat ore |
| Heroes, Thieving 99 | 73k with runes sold | 73k net of 110 sharks (35k coins only) | m | not reached at 8 bots on 3 heroes | yes: blood and death runes |
| Varrock guards (the fleet's earner) | ~60k | ~60k | m | with logins | the fleet's own |
| Swordfish and tuna, raw sharks, yew logs (gathered for the board) | 74.3k, 59.4k, 57.9k | ~0 for sharks (no bid); yews into the flow | m | with logins | sharks and yews are supplies |
| Coal into the 80 gp bid | ~7.4k | ~7.4k | **L** (98 coal an hour; 4 rocks depleted 41% of the time) | ~1.06M coal at 80 or better, 14k traded a week | yes until the run ends |
| Irksol's ruby rings, high-alched | +183 gp a ring | ~3.3k | i from content | **world clock**: 18 rings an hour for everyone | rubies are supplies |
| High or low alchemy of anything else; shop round trips | negative | negative | m | | |
| Battlestaff water orbs | +8.2k a staff | negative | i | | cosmic runes are an H1 input |

**Phase 2 on our one address** (`phase2.md`; 45 logins, `scaling-limits.md`). With the knights after the scored
run: 1 Shilo, 1 steel and 43 knights earn about **4.9M coins an hour: 28M in 6 hours, 117M in 24 and 350M in 72**.
Without the knights: 1 Shilo, 1 steel, 12 iron, 8 heroes and 23 guards earn about 3.5M an hour: 21M, 84M and
247M. Setup is about 0.3 login-hours a fresh account (HP 40 in 1,707-1,972 ticks with `hp-train.ts`,
`hp-training.md`). What binds first is a shared outlet, never the address: the gem site at once, the jade bid at
~16.6 h, steel's weekly flow, and the iron bid at ~66 h. The demo enforces no login-rate lockout on these
settings: 45 logins took 2.3 s in the lab, and code 16 comes only from retrying an account whose last login is
still pending (`scaling-limits.md`). `markets/phase2/run.ts` (rs/544) runs the allocation from one command,
adding knights in steps of 8, 20 and 43 and stopping if the median rate falls more than 10%.

**Hitpoints setup scales** (rs/632): the runner spreads fresh accounts over seven low Hitpoints sites with caps and
shares one npc claim table, and in the lab 22 fresh accounts all reached HP 40 within 25 minutes of login (median
16), with no two of ours on one npc. With everyone on the Lumbridge pen the knights had reached the market 60-108
minutes after login. **Open:** sales work only for accounts that can walk to the Varrock Exchange (guards today),
because nothing brings an iron or Shilo account back.

### 3. The code

`markets/` (`markets/README.md`) has public readers for the boards, the GE book, history and bid depth, and
`/playerpositions` (`markets/lib/`). It also has the read-only shelf reader (`markets/shelf/`,
`shelf-reader.md`), the live probes (`markets/methods/probe-*.ts`, `probes.md`), the lab rate harness
(`markets/methods/lab/`), the HP trainer, and the phase-2 plan and runner (`markets/methods/phase2-plan.ts`,
`markets/phase2/`). It derives the market origin from the gateway URL, as speedrun/ does. Every tool that writes
shared data refuses to run without the account-names file (`markets/lib/accounts.ts`). The root `typecheck` and
`test` scripts cover `markets/` except the one-off lab scripts in `markets/research/`.

### 4. Speedrun supplies priced in gold

`supplies.md` (rs/503) prices every SUPPLIES.md line. It gives shop curves from content, live shelf counts from
markets' 2026-10-22 23:43Z read, and the GE book.

- **Total:** everything gold can buy for one attempt costs about **1.24M gp**. 0.77M of that is magic logs, steel
  bars, rune arrows (800-1,060 gp each, Dargaud only), blood runes (~1,300 gp at the margin) and mithril arrowtips.
- **What gold can't buy:** 32 of 85 lines, including every potion.
- **The rune shops are drained:** Aubury and Betty held 0-13 of each rune, at the 6x ceiling (posts/419).

## Index

| Path | Holds |
|---|---|
| `generator-ge-persistence.md` | rs/498: the GE ledger, save-v8 escrow and autosave audit, with the lab kill test. |
| `generator-content-shops.md` | rs/499: content scripts, shop arithmetic, trade, bank and notes, and the staff hand-off lab test. |
| `demo-revision.md` | rs/515: which engine build the demo runs, dated from public fingerprints. |
| `timeline.md` | rs/500: the leaders' holdings over time, GE history against their stacks, the family census, the swarms seen in `/playerpositions`, and a verdict per leader. |
| `candidates.md` | rs/501: every obj's store cost against its source, shop multipliers, arbitrage, alchemy, and the deep bids, ranked. |
| `methods.md` | rs/502: lab rates at 400 ms in board value and coins per login-hour. |
| `phase2.md` | rs/543 and rs/544: crowding, net-of-input rates, the 45-login allocation over 6, 24 and 72 hours, and the runner. |
| `scaling-limits.md` | rs/519: every limit on logins per address, login rate, registration and world population. |
| `hp-training.md` | rs/553: the fresh-account Hitpoints trainer, phase 2's setup step. |
| `probes.md` | rs/508 and rs/557: the live probe runners and their totals. |
| `shelf-reader.md` | rs/506: the read-only shop shelf reader. |
| `supplies.md` | rs/503: speedrun supplies priced in gold. |
| `supply-sites.md` | rs/686: who holds the Shilo gem rocks and the five runite rocks (a 13-hour headcount), each site's ceiling against GE volume, banker as the owner of the gem wall and the runite-bar bid, the other gem sources, and Wilderness PvP at the runite rocks. |
| `data/` | Dated public reads: `poll-*.json` (bank top 50, positions and zone rosters every 5 minutes), `census-*.json`, `ge-history-*.json`, `players-*.json`, `bank-searches-*.json`, `jump-*.json`, GE book snapshots, and the live shelf and probe samples with our account names removed. Formats are in `markets/lib/snapshots.ts` and each tool's header. |

## Rules

- **No login to the demo** from this mission or any child (tenet 28). Live probes run only through markets on its
  own VM: send the method, account count, duration and what it measures to the coordinator, who forwards it.
- Public HTTP reads only, and gently: a request every few seconds at most, polls no more than every 5 minutes unless
  markets sets a rate (rs/686's site headcount read `/playerpositions` once a minute at markets' request).
- A generator or dupe is confirmed in the local lab only, and reported to markets first
  (cairn://p/rs/markets/messages).
- No SUPPLIES.md trades, no GE volume and no load before main announces the run has ended.
- No host address of any machine in a committed file (tenet 20). The demo's public hostname, rs-sdk-demo.fly.dev, is fine.

## Lab port blocks

Labs run on fedora or bgsrv-ub with `NODE_TICKRATE=400`. Check all ports with `lsof` before use.

| Block | Owner | WEB / MGMT / HISCORES | NODE | AGENT | FRIEND |
|---|---|---|---|---|---|
| M1 | GE and persistence audit (rs/498) | 9900 / 9901 / 9902 | 44900 | 7700 | 45900 |
| M2 | content, shop, trade and bank audit (rs/499) | 9910 / 9911 / 9912 | 44910 | 7702 | 45910 |
| M3 | lab measurements (rs/502) | 9920 / 9921 / 9922 | 44920 | 7704 | 45920 |
| M4 | second measurement lab (rs/502) | 9930 / 9931 / 9932 | 44930 | 7706 | 45930 |
| M5 | shelf reader (rs/506) | 9940 / 9941 / 9942 | 44940 | 7708 | 45940 |
| M6 | live-probe runners (rs/508) | 9950 / 9951 / 9952 | 44950 | 7712 | 45950 |
| M7 | login-limit lab (rs/519; LOGIN 43960, LOGGER 43961) | 9960 / 9961 / 9962 | 44960 | 7960 | 45960 |
| M8 | phase-2 measurements (rs/543; LOGIN 43970, LOGGER 43971) | 9970 / 9971 / 9972 | 44970 | 7970 | 45970 |
| M9 | second phase-2 lab (rs/543; LOGIN 43980, LOGGER 43981) | 9980 / 9981 / 9982 | 44980 | 7980 | 45980 |
| M10 | Hitpoints trainer (rs/553; LOGIN 43990, LOGGER 43991) | 9990 / 9991 / 9992 | 44990 | 7990 | 45990 |
| M11 | phase-2 runner (rs/544; LOGIN 44000, LOGGER 44001) | 10000 / 10001 / 10002 | 45000 | 8000 | 46000 |
| M12 | Shilo gem site: miners, mules, fresh-account runs (rs/685; LOGIN 44010, LOGGER 44011) | 10010 / 10011 / 10012 | 45010 | 8010 | 46010 |
| M13-M16 | Shilo quest and stage labs (rs/685; LOGIN 44025/35/45/55, LOGGER 44026/36/46/56) | 10020-10050 / +1 / +2 | 45020-45050 | 8025 / 8035 / 8045 / 8055 | 46020-46050 |
| M17 | phase-2 Hitpoints sites and return trip (rs/632; LOGIN 44065, LOGGER 44066) | 10060 / 10061 / 10062 | 45060 | 8065 | 46060 |
| M18 | coins deaths and coins driver (rs/706; LOGIN 44075, LOGGER 44076) | 10070 / 10071 / 10072 | 45070 | 8075 | 46070 |
| M19 | knights ramp measure and contention (rs/731; LOGIN 44085, LOGGER 44086) | 10080 / 10081 / 10082 | 45080 | 8085 | 46080 |
| M20 | phase-2 sale round trip and pickaxe stage (rs/732; LOGIN 44095, LOGGER 44096) | 10090 / 10091 / 10092 | 45090 | 8095 | 46090 |
| M21 | pickpocket door recovery (rs/736; LOGIN 44105, LOGGER 44106) | 10100 / 10101 / 10102 | 45100 | 8105 | 46100 |
| M22 | phase-2 shark resupply (rs/743; LOGIN 44115, LOGGER 44116) | 10110 / 10111 / 10112 | 45110 | 8115 | 46110 |
| M23 | phase-2 stages reached from anywhere, stage stalls (rs/754; LOGIN 44125, LOGGER 44126) | 10120 / 10121 / 10122 | 45120 | 8125 | 46120 |
| M24 | phase-2 runner memory (rs/767; LOGIN 44135, LOGGER 44136) | 10130 / 10131 / 10132 | 45130 | 8135 | 46130 |

`. markets/methods/lab/block.sh M8` (any listed block) exports a block's ports and refuses if any is listening; every
port is M8's plus 10 a block, and from M13 the AGENT, LOGIN and LOGGER ports are 5 higher again (8020, 44040,
44050, 8060 and 44060 belong to other labs). The next free block for follow-ups is M25 (WEB 10140, NODE 45140,
AGENT 8145, FRIEND 46140, LOGIN 44145, LOGGER 44146); add it to `block.sh`'s list when you claim it, and check the
AGENT, FRIEND, LOGIN and LOGGER ports first. A
long lab on fedora runs from a copy outside the build slot (`/tmp/<name>-lab`, kept between batches so the content
pack is built once) inside a named tmux server; `hp-training.md` gives the commands.
