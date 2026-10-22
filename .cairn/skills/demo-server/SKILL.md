---
name: demo-server
description: Use when planning against, measuring on, or researching the deployed demo world (rs-sdk-demo.fly.dev) — its tick rate and world config, shop stock and prices, what its hiscores actually record, watching other players live, finding public competitor sources, or grepping the game content it runs.
---

# The demo server

The scored world is the deployment described by `fly.toml`. This skill holds the
facts that change a plan; the deep references are
`docs/speedrun/research/engine-sweep/economy.md` (shops, prices, supply sources) and
`docs/speedrun/research/competitors.md` with the section documents beside it
(hiscores, public code, observation).

## World config

- **400 ms ticks since 2026-10-22 19:56Z** (9,000 ticks per hour); 300 ms before
  that, which is what documents written before then assume. `fly.toml` still says
  `NODE_TICKRATE=300`, and the operator may slow the world further, so read the
  live value from the worldfeed with `worldfeedTickMs()` in
  `speedrun/tools/hiscore-scrape.ts`. It is a **members** world
  (`NODE_MEMBERS=true`), random events off, xp rate 25. Take lab measurements at
  the live rate (`NODE_TICKRATE=400 lab/lab.sh ...`; the lab defaults to 300) so
  they transfer.
- **At most 50 concurrent logins per source IP address** since 2026-10-22 (cut
  from 100). Our own ceiling is **45 per address**, counting fleet accounts, dev
  copies and children's demo logins together (tenet 25;
  `docs/speedrun/HELPERS.md`, "Capacity and the IP cap").
- **There is one world, so hopping resets nothing.** Shop stock and ground spawns
  are shared by every player on the server, and other bots already draw on them,
  so live stock can sit above or below the base values.
- `NODE_PRODUCTION` is unset, so `map_live` is false and the RuneScape Guide offers
  the tutorial skip: `bot.skipTutorial()` takes about 6 ticks on a fresh account.

## Shops

- **Restock is +1 unit per `stockrate` ticks per slot, on the global tick clock**
  (the shop loop in `server/engine/src/engine/World.ts`). The rate does not depend
  on how far below base the stock is, and it is shared by everyone: N helpers
  buying at one shop pull what one does. Spread buyers across shops instead.
- The price rises by DELTA/10 percent of the item's value for each unit below base
  stock, capped at about 6x (`shop.rs2`). Buying a shop dry gets expensive fast.
- Feathers and bait at fishing shops restock every tick.

## Hiscores

- **A skill row is written only at logout**, and it stores the tick the level was
  reached. A bot in the middle of a session is invisible on the boards.
- Many identical stamps across unrelated skills, or a skill stamp equal to the
  Quest Points stamp, are logout values: an upper bound on the reach time, not the
  reach time itself. Levels reached before the version-9 stamps went live carry
  logout stamps too.
- `speedrun/tools/hiscore-scrape.ts` (`snapshot | players | boards | diff | analyze`)
  scrapes and analyses the boards; `competitors/hiscores.md` and
  `competitors/hiscore-timestamps.md` explain what a board time means.

## Watching other players and their sources

- **`https://rs-sdk-demo.fly.dev/playerpositions`** is public JSON of every online
  player's name and tile. It is the cheapest way to see who is climbing right now,
  since the boards only move at logout.
- The accounts above us have not published code or routes;
  `competitors/public-code.md` maps the accounts to their owners. The public
  sources worth reading are the `rs2b2t/rs2b0t` bot client, which targets the same
  content revision (289) and keeps per-quest live-run pitfalls in
  `docs/decisions/quest-pitfalls-*.md` (read it before scripting a quest), and the
  upstream `server/PATCHES.md`, which lists every server modification and the
  exploits reported against it.

## Grepping the content

`server/content/scripts/_unpack/` is packed like any other content:
`server/engine/tools/pack/PackFile.ts` only exempts it from the folder-layout check.
The chromatic dragons and the Mort'ton stores are defined there, so don't exclude
it from content greps.

## Which code it runs

- **The demo runs unpublished code on top of upstream's tip** (b565f2d920b as of
  2026-10-22): its board titles read `N ticks normalized to 400 ms per tick`, which
  no commit contains. Treat the repo as a lower bound on what is live, not an exact
  copy (rs/515, `docs/markets/demo-revision.md`).
- The `/` page's `bot/client.js?v=TOKEN` is the server's process start time in
  base 36 (`parseInt(TOKEN, 36)` gives epoch ms). It is the cheapest public way to
  detect a restart or deploy. Static files are served with no Last-Modified or ETag.
- `markets/research/rs-515-demo-revision.ts` re-dates the build in about three
  minutes with six gentle requests.
