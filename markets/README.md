# markets/

Tools for the markets mission: reading the public demo's wealth boards, Grand Exchange and player positions, and
(later) the methods that turn logins into capital. TypeScript run with bun, importing the SDK from `sdk/` and
reusing `speedrun/lib` and `speedrun/tools` where they already do the job (tenet 4). Findings live in
`docs/markets/`.

**Public HTTP only.** Nothing here logs in to the demo. Every reader goes through `Gentle` (`lib/demo.ts`), which
spaces requests at least 3 seconds apart and retries only transient failures. The poller refuses to run more
often than every 5 minutes (tenet 28).

## lib/: readers

| Module | What it reads | Notes |
|---|---|---|
| `demo.ts` | the origin and the request gate | `Gentle({ server })` maps a bot.env SERVER value (host, host:port or ws(s) gateway URL) to the game's HTTP origin through `speedrun/lib/demo-status.ts` `demoOrigin()`. That is the workaround for the SDK deriving its market origin from the gateway URL. Pass a lab SERVER to read a lab world. |
| `boards.ts` | `/hiscores/bank` (top 50 and `?q=` item search), `/hiscores/outfit`, `/hiscores/runite` | Bank and outfit parsing is `speedrun/tools/hiscore-scrape.ts`'s. A bank row's `gp` is store cost x count, not a GE price, and the board shows each account's six largest stacks only. |
| `market.ts` | `/api/market/status`, `/items`, `/items/{id}`, `/items/{id}/history` | `DemoMarket` wraps the SDK's `MarketClient` behind the gate. `bookDepth()` gives per-side totals and means (the API has no price levels). `realisable()` gives what a stack fetches sold into the open bids. `historyTotals()`, `historyMoves()` and `stackOverVolume()` do the history arithmetic. |
| `positions.ts` | `/playerpositions` | `ZONES` are the GE table, the banks, the Catherby and Fishing Guild spots, the essence mine and the air altar. `zoneRoster()` names everyone in each zone. Names are display names; compare them through `playerNameKey`. |
| `families.ts` | none (classification) | `FAMILIES` (nick, banker, soko, kuro, goo, stein) and `census()` over any named row lists plus one positions read. |
| `snapshots.ts` | saved files | Loads hiscore-scrape snapshots, census files and poll files into bank top-50 reads (`bankTops`, `holdingsOf`), flags jumps (`jumps`), and encodes and decodes the poll file. |

Tests use recorded replies in `lib/fixtures/` (2026-10-22 ~22:1xZ) and never the network. Run them with
`bun test markets/`; the root `bun run test` and `bun run typecheck` include this package.

## tools/

| Tool | Requests | Output |
|---|---|---|
| `poll.ts` | 2 every 5 min | `poll-<date>T<HH>Z.json` per 6 UTC hours: the bank top 50 (changed rows only), online count, family positions, every name per zone. Also `jump-<stamp>.json` on a jump, holding who stood near the gainer and both polls' positions. |
| `census.ts` | ~65 | `census-<stamp>.json`: the family census across every board, item search and positions. |
| `ge-history.ts` | ~3 per item | `ge-history-<stamp>.json`: quotes, 90 days of daily and 7 days of hourly history for the leaders' goods. |
| `players.ts NAME...` | 1 per name | `players-<stamp>.json`: skill levels (a no-levels account holding billions was handed its wealth). |
| `searches.ts` | 1 per query | `bank-searches-<stamp>.json` and an item-by-item diff of named accounts against an earlier file. |
| `timeline.ts` | none | Each leader's totals and stack growth across every saved read. |

All tools default to writing `docs/markets/data/`; pass `--out` to write elsewhere.

### Keeping the poller running

```
bun markets/tools/poll.ts --out=$HOME/.cache/rs-markets/poll
```

Run it in a terminal resource (cairn://skills/terminal). Point `--out` outside the worktree: a `run` batch without
a commit restores the worktree and would discard untracked poll files. To commit a block, copy its files into
`docs/markets/data/` in a batch with a commit message. A restarted poller appends to the current block's file.
