# docs/markets

Research for the markets mission (rs/495, thread cairn://p/rs/markets): how the demo's wealth leaders got rich,
what each method yields per login, and what speedrun supplies gold can buy. The code is in `markets/`
(`markets/README.md`).

| Path | Holds |
|---|---|
| `timeline.md` | The leaders' holdings over time, GE history against their stacks, the family census, the swarms seen in `/playerpositions`, and a per-leader verdict on where the wealth came from. |
| `data/` | Dated public reads: `poll-*.json` (bank top 50, positions and zone rosters every 5 minutes), `census-*.json`, `ge-history-*.json`, `players-*.json`, `bank-searches-*.json`, `jump-*.json`. Formats are in `markets/lib/snapshots.ts` and each tool's header. |

`phase2.md` (rs/543) is the phase-2 answer: how 45 logins on one address split across methods, what they earn over
6, 24 and 72 hours, and which shared limit binds first. Other children of rs/495 own their own `docs/markets/<file>.md`; `scaling-limits.md` (rs/519) holds every limit on
logins per address, login rate, registration and world population; `hp-training.md` (rs/553) is the fresh-account
Hitpoints trainer, phase 2's setup step.

## Rules

- **No login to the demo** from this mission or any child (tenet 28). Live probes run only through markets on its
  own VM: send the method, account count, duration and what it measures to the coordinator, who forwards it.
- Public HTTP reads only, and gently: a request every few seconds at most, polls no more than every 5 minutes.
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

`. markets/methods/lab/block.sh M8` (or M9, M10, M11) exports a block's ports and refuses if any is listening. The
next free block for follow-ups starts at 10010 (NODE 45010); check the AGENT, FRIEND, LOGIN and LOGGER ports first. A
long lab on fedora runs from a copy outside the build slot (`/tmp/<name>-lab`, kept between batches so the content
pack is built once) inside a named tmux server; `hp-training.md` gives the commands.
