# Which engine commit the demo runs (markets Q1d, rs/515)

**Answer: fix live.** The demo build serving on 2026-10-22, with its process
started at 20:08:13Z, contains every public marker up to upstream's tip
`b565f2d920b` (2026-10-19 21:31Z). It also contains one marker that is in no
published commit. So it runs **at or after `b565f2d920b`, plus unpublished
changes**. That bracket lies entirely after the Managing Miscellania fix,
`ca0fe09cc8`, which was merged as PR #73 in `e4441c6233` on 2026-10-11 at
23:36Z. An earlier build, live by 2026-10-21 03:30Z, was already at or after
`ac6ef5e42cd` (2026-10-19 02:29Z), so it contained the fix too.

**Open question: when the fix first went live.** No public evidence dates the
first deploy that contained the fix. The pre-fix engine could have served the
demo from the 289 deploy, which was no earlier than `8601955cfb` (2026-10-09
04:53Z), until any time before 2026-10-21 03:30Z. That window spans from about
2 days to about 12 days, depending on when the operator deployed. The leaders'
coin rows that were already at the cap in our first snapshot (2026-10-21 08:04Z)
fit inside that window.

**stein's +1.20B coins did not come from this dupe** (cairn://posts/406).
stein's gain runs from 2026-10-21 08:04Z to 2026-10-22 22:35Z, which is after
the 10-21 03:30Z observation of a post-fix build. Two things would have to be
true for the dupe to explain it: a rollback to code older than 2026-10-11, and
a later redeploy forward. Such a rollback would also cross `55fa26ccaad`, whose
commit message warns that an older engine rejects the version-9 saves that
commit writes. That would have locked out every player who logged out after
2026-10-19. A real-account probe saw version-9 stamping live at 2026-10-21
08:33Z (`docs/speedrun/research/competitors/hiscore-timestamps.md`). The
rollback is inferred to be implausible, not proven impossible.

## How the dating works

The demo deploys from the public repository MaxBittker/rs-sdk
(`docs/speedrun/UPSTREAM-WATCH.md`). Its history from the 289 upgrade to the
tip is one linear first-parent chain, and our fork carries that same chain up
to `b565f2d920b`. The GitHub API showed `b565f2d920b` was still upstream's tip
on 2026-10-22. The fix is server-only content (`managing_miscellania.rs2`) and
is never served. Instead, each fingerprint is a string that one dated commit
introduced into something the demo does serve. A marker that is present on the
demo puts the deploy at or after its commit, and a missing one puts it before.
`--verify-repo` confirms, from git, that each string is absent at `<commit>^`,
present at `<commit>`, and still present at the tip.

## Fingerprints (read 2026-10-22, 23:00 to 23:09Z)

| Public path | Marker | Introduced by | Present | Contains fix |
|---|---|---|---|---|
| `<demo>/worldfeed` (WebSocket hello) | `{t:'hello', ...}` | `68ff9ebf826` 2026-10-09 19:10Z, world feed added | yes (`rev 289`, `tickMs 400`) | no |
| `<demo>/bot/client.js` | `stale_dialog` | `8b7be3de4b0` 2026-10-11 05:10Z, guarded dialogue clicks | yes | no |
| `<demo>/bot/client.js` | regex `/^attack$/i` | `07d53516abb` 2026-10-12 18:30Z, talk/trade NPCs are not combat targets | yes | **yes** |
| `<demo>/bot/client.js` | `combatTargetTelemetryVersion` | `54f3e62084c` 2026-10-18 13:30Z, nearby players' combat targets | yes | **yes** |
| `<demo>/hiscores?category=0&profile=main` | `<span title="N ticks…" style="font-variant-numeric: tabular-nums">` | `ac6ef5e42cd` 2026-10-19 02:28Z, times to the second | yes | **yes** |
| `<demo>/worldfeed` (silent socket) | closed after 120.6 s with reason `World feed idle timeout` | `b565f2d920b` 2026-10-19 21:31Z, idle expiry (upstream tip) | yes | **yes** |
| `<demo>/hiscores?category=0&profile=main` | title `35,916 ticks normalized to 400 ms per tick` | **no published commit** (`git log --all -S` finds nothing in upstream or this fork) | yes | built on the tip |

The unpublished marker probably arrived with the operator's change to 400 ms
ticks, which the worldfeed showed live at 2026-10-22 19:56Z
(`.claude`-free source: the demo-server skill). The current process started
twelve minutes after that. Both the hover title and the 400 ms tick come from
the same restart, but nothing public names that commit.

The server code sends close code 1001 for the idle expiry. The client saw code
1000 with the exact reason string, in both runs. The reason string and the
120 s delay (`WORLD_FEED_IDLE_TIMEOUT_MS = 120000` in `fly.toml`) identify the
behaviour. Code before `b565f2d920b` never closes a silent viewer.

### The earlier build (2026-10-21 03:30Z)

`speedrun/tools/fixtures/hiscores-2026-10-20.html` is the same board page,
saved at 2026-10-21 03:30Z and committed in `c76dfd483b0`. It has the
`ac6ef5e42cd` span (`title="35,916 ticks"`) but not the normalized suffix. So
it came from a different, earlier build that was at or after `ac6ef5e42cd` and
therefore post-fix. `--verify-repo` re-checks the fixture offline.

## Timestamp leaks

| Source | Result |
|---|---|
| `<demo>/` cache-bust token (`CLIENT_CACHEBUST = Date.now().toString(36)` in `server/engine/src/web/pages/client.ts`, rendered as `bot/client.js?v=…`) | `mvjz3zys`, which is a **process start at 2026-10-22 20:08:13.012Z**. That is the last restart or deploy, not the commit date. |
| `Last-Modified` / `ETag` on `<demo>/bot/client.js`, `<demo>/ondemand.zip`, `<demo>/favicon.ico` | none sent |
| `<demo>/api/version` | `{"revision":289}` only (`handleVersionApi`) |
| PR #73 on GitHub | no comments and no deploy note; created 23:30:00Z, merged 23:36:36Z on 2026-10-11 |
| Wayback Machine | no capture after 2026-10-05 (`hiscore-timestamps.md`) |

The served bot bundle is 556,749 bytes, with a SHA-256 prefix of
`e98894be2ec4781b`. It is recorded here so the next session can tell, with one
request, whether the client has changed. It was not compared with a local build,
because the bundle's reproducibility across Bun versions is untested.

## Limits

- Server-only code, the coffers script included, is invisible from outside. The
  verdict rests on ancestry: every marker present is in a commit that descends
  from the fix, and the unpublished build carries the tip's markers. A private
  change that re-broke the coffers is possible in principle, and nothing public
  could show it.
- The bracket for the first post-fix deploy is open at its lower end, as
  described above. Only a dated observation of the demo between 2026-10-09 and
  2026-10-21, from someone else's logs or posts, could narrow it.

## Method and budget

The script is `markets/research/rs-515-demo-revision.ts`. It is read-only and
has no login, no game socket and no form posts.

- `bun markets/research/rs-515-demo-revision.ts --verify-repo` makes no network
  requests. It checks each marker against git history and the saved fixture.
- `bun markets/research/rs-515-demo-revision.ts` makes six HTTP GETs to the
  demo, at least 5 s apart. It also opens one worldfeed socket that sends
  nothing and is held until the server closes it (at most 150 s), and makes one
  GitHub API call for upstream's tip. It prints the table and the verdict.

The probe ran twice, and this session also made one extra fetch of the board
page, for 15 HTTP requests to the demo and two worldfeed sockets in total. The
first run's board check was too strict about the title text; the rows above
come from the second run. The demo origin is imported from
`speedrun/tools/hiscore-scrape.ts`, so no host is written in these files.
