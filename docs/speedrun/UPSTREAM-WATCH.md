# Upstream watch

The public demo server (rs-sdk-demo.fly.dev) deploys from the public repository
[MaxBittker/rs-sdk](https://github.com/MaxBittker/rs-sdk), which is this fork's `upstream`
remote (see `fly.toml`). The speedrun plan depends on server behaviours the maintainers can
patch at any time: wine fermenting in the bank, Charge with no recast cooldown, the five
user packets per tick, the xp curve and 25x multiplier, how playtime is counted and stamped on
the hiscores, the per-IP session cap, and the gathering and quest scripts the routes were
measured against. The upstream watch reports, within a day, every upstream commit that touches
one of those places, with its diff, and any change to the demo's overall hiscore #1, which is
the time the run has to beat.

The tool is `speedrun/tools/upstream-watch.ts`; the watchlist is
`speedrun/tools/upstream-watchlist.json`; the nightly job is
`.github/workflows/upstream-watch.yml`.

## How notifications arrive

The workflow runs nightly at about 04:23 Pacific on the fork (bleugreen/rs-sdk). When it
finds something it:

- opens a GitHub issue labelled `upstream-watch` and assigned to the repository owner, whose
  body is the report (summary, hiscore record, a table of the commits, then the diffs), or
- if an `upstream-watch` issue is already open, adds the report to it as a comment.

Assignment is what makes GitHub notify the owner (by email or on the web, per their
notification settings) without them watching the repository. Close the issue once it has
been read; the next finding then opens a fresh one. Each upstream range is reported exactly
once, because the recorded state advances after the report is posted.

Issues are capped at 60,000 characters. The summary, hiscore section and commit table always
appear; diffs follow until the budget runs out, each file capped at 300 lines, with links to
the GitHub compare view and to the full report uploaded as the run's `upstream-watch-report`
artifact.

What counts as a finding:

- an upstream commit touching a watched path;
- a different name, level or tick count at overall hiscore #1;
- a hiscores page that loads but no longer parses (its markup changed);
- a recorded baseline commit that upstream's history no longer contains (a force-push).

An unreachable hiscores page (the demo cold-starts on Fly) is only a warning in the job
summary. A watchlist pattern that no longer matches any upstream file is listed in a report
that is being sent anyway, but never triggers one by itself.

## Where state lives

State is a small JSON file: the last upstream commit reported and the last hiscore #1
recorded.

- `speedrun/tools/upstream-watch.state.json` on `main` is the seed, and the default for local
  runs.
- CI keeps the live copy at the root of a dedicated orphan branch, `upstream-watch-state`. Each
  night it reads that branch (falling back to the seed when the branch does not exist yet),
  and pushes a new commit to it whenever upstream moved or the hiscore changed.

The state is kept off `main` because agents and Cairn push `main` continuously, and a bot
commit there would make their next push non-fast-forward. Keeping it in an issue body breaks
once the issue is closed. A separate branch needs only `contents: write`, never races `main`,
and records each state change as an auditable commit.

To re-baseline CI, edit `upstream-watch.state.json` on the `upstream-watch-state` branch, or
delete the branch to fall back to the seed.

## Running it locally

```sh
bun speedrun/tools/upstream-watch.ts                     # read-only: report since the seed state
bun speedrun/tools/upstream-watch.ts --since df3d8888    # replay a range
bun speedrun/tools/upstream-watch.ts --since df3d8888 --until b565f2d9 --no-hiscores
```

The tool keeps a private, blobless bare clone of upstream in
`${XDG_CACHE_HOME:-~/.cache}/rs-upstream-watch/upstream.git` (override with `--cache-dir`). It
never touches the caller's checkout or remotes, so it also runs from agent worktrees. Without
`--update` it never writes the state file. Other flags: `--report PATH` (full markdown),
`--issue-body PATH` (the report fitted to the issue budget), `--summary-json PATH` (what the
workflow branches on), `--state PATH`, `--watchlist PATH`.

Exit codes: 0 nothing to report, 1 findings, 2 tool or git error.

The workflow also runs the tool's self-test on every push that changes it: it replays
`df3d8888..b565f2d9`, asserts that exactly the four commits that touch watched paths are
reported, and checks that the live hiscores page still parses. It opens no issue and moves no
state.

To check that notifications reach you end to end, run the workflow by hand from the Actions tab
with `since` set to an older upstream commit, for example `df3d8888`. That opens or comments on
the issue with a `[replay]` title and never moves state.

## Extending the watchlist

Each entry has an `id`, a `title`, its `paths` (globs matched with `Bun.Glob`), and a one-line
`why` that says, in plain words, the behaviour the run depends on and what it gets from it.
That line is printed above the diff in every issue, so it is the first thing read when
upstream moves. Optional keys: `diff: "stat"` reports only +/- counts for high-churn
merge-relevance paths, and `groupBy: N` groups an entry's files by the path segment at index N
(the quests entry uses 4, the quest directory).

Each changed file is attributed to the first entry that matches it, so keep specific entries
above general ones (wine above cooking, Charge above magic). After editing the JSON, run
`bun speedrun/tools/upstream-watch.ts --write-doc` to regenerate the table below, then
`bun run check`; a test fails if the table and the JSON disagree, or if a pattern matches no
file in the fork.

## What is watched

<!-- watchlist:start -->
<!-- watchlist:end -->

## Caveats

- The cache repo runs git with `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1` on
  purpose. The operator's global config rewrites `https://github.com/` to SSH, which agent
  sandboxes cannot reach; upstream is public and needs no credentials.
- GitHub disables scheduled workflows after 60 days without repository activity. If that
  happens, re-enable the workflow from the fork's Actions tab.
- Actions must be enabled on the fork (a one-time approval at
  https://github.com/bleugreen/rs-sdk/actions), and so must Issues.
- The hiscore check reads one page, once per run, with a 60-second timeout and no retries. It
  never logs in or touches any account.
