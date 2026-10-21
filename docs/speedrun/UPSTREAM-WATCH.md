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
| Entry | Paths | Why it matters |
|---|---|---|
| Demo deploy settings | `fly.toml` | The demo's live settings: 25x xp, 300 ms ticks, 100 sessions per IP and the hidden hiscore names. Every tick and xp estimate in the plan assumes these values, and an edit here also redeploys the demo. |
| Demo build and boot | `server/Dockerfile`<br>`server/start.ts` | What the demo actually builds and starts. A change can switch the live server's startup flags or content build without touching any game code. |
| Upstream patch checklist | `server/PATCHES.md` | Upstream's own list of the server's custom behaviour patches. An edit here usually announces that one of those behaviours was added, changed or dropped. |
| Server config defaults | `server/engine/src/util/Environment.ts`<br>`server/engine/src/util/WorldConfig.ts` | The defaults and environment parsing that the fly.toml values pass through (xp rate 25, tick rate). A changed default or a renamed variable changes the live server even when fly.toml stays the same. |
| Player xp and level stamps | `server/engine/src/engine/entity/Player.ts` | The xp table, the 25x multiplier applied to every xp drop, and the stamp of the tick each level was reached, which is what the hiscores rank us by. Every route's tick estimate and the scored time depend on them. |
| Player save format | `server/engine/src/engine/entity/PlayerLoading.ts` | How playtime and the per-skill level-reached ticks are saved and loaded. A format change can reset or shift the times the hiscores show for our account. |
| World tick loop and limits | `server/engine/src/engine/World.ts` | The tick loop, the playtime counter that adds one per logged-in tick (the scored clock), the per-IP session cap our helper accounts rely on, and the idle and no-response logout timers. |
| Packet-per-tick enforcement | `server/engine/src/engine/entity/NetworkPlayer.ts` | Stops decoding a client's packets after 5 successful user events in a tick. The run's batched banking, trading and level-up dismissal are planned around exactly that floor. |
| Packet-per-tick limits | `server/engine/src/network/game/client/ClientGameProtCategory.ts` | The budget values themselves: 5 user events, 20 client events and 2 restricted events per tick. Lowering the user-event limit slows every batched action in the run. |
| Packet categories | `server/engine/src/network/game/client/model/**` | Which budget each client packet counts against. Moving a packet we send in bulk into the user or restricted budget slows the run's batched actions. |
| Packet handlers | `server/engine/src/network/game/client/handler/**` | How the server handles item, interface-button, object and NPC clicks and dialogue resumes, and which of them count as successful. The SDK's actions and our fast paths send exactly these packets. |
| Player script ops | `server/engine/src/engine/script/handlers/PlayerOps.ts` | p_delay, which sets how many ticks scripted actions hold the player, and stat_random, the level-scaled success roll behind every gathering action and every wine. |
| Login server and hiscore writes | `server/engine/src/server/login/LoginServer.ts`<br>`server/engine/src/server/login/LoginThread.ts` | Accounts are created automatically on first login, which is how our helper accounts come to exist, and logout and autosave write the hiscore rows with each level's reached tick. |
| Hiscores ranking and page | `server/engine/src/web/pages/RankedHiscores*.ts`<br>`server/engine/src/web/pages/hiscores.ts` | The ranking rule (highest level first, then lowest time) that decides whether we beat #1, and the page markup this watch parses to read the current #1. |
| Grand Exchange | `server/engine/src/engine/market/**`<br>`server/engine/src/web/pages/market.ts`<br>`server/engine/src/engine/entity/tracking/TradeLedger.ts` | Grand Exchange order matching, escrow and the trade ledger. Any supply the run buys or sells instead of gathering goes through this code. |
| Wine fermentation | `server/content/scripts/skill_cooking/scripts/cooking_inv/scripts/wine/wine.rs2` | Unfermented wine ferments on a timer, including every jug sitting in the bank, and each good wine pays Cooking xp with no level check beyond the 35 needed to mix it. The cooking route gets its Cooking levels from banked wine this way. |
| Charge spell | `server/content/scripts/skill_magic/scripts/spells/charge.rs2` | Charge has no recast cooldown (the 'your current Charge is too strong' check is commented out), so it can be cast back to back for Magic xp. |
| Magic | `server/content/scripts/skill_magic/**` | Spell data, rune costs and xp for every spell, including jewellery enchanting and alchemy. The Magic route's casts per level come from these numbers. |
| Player-count scaling | `server/content/scripts/general/scripts/player_count.rs2` | Scales tree, rock and thieving respawn timers by how many players are online. A change alters gathering rates on a busy world. |
| Teleport jewellery and xp lamps | `server/content/scripts/general/scripts/enchanted_jewellry/**`<br>`server/content/scripts/general/scripts/xplamp/**` | What enchanted jewellery does when worn or rubbed (glory, dueling, games necklace, recoil, forging) and how xp lamps pay out. Routes can use these for travel and free xp. |
| Level requirements and level-up | `server/content/scripts/levelrequire/**`<br>`server/content/scripts/levelup/**` | Which items and actions need which level, and the level-up dialog that interrupts the player. The run dismisses that dialog immediately and plans its unlocks around these levels. |
| Cooking | `server/content/scripts/skill_cooking/**` | Cooking actions, burn rolls and xp per item outside wine. Any cooking the route does besides wine is measured against these scripts. |
| Woodcutting | `server/content/scripts/skill_woodcutting/**` | Chop success rolls, tree depletion and respawn, and xp per log. The woodcutting route's measured xp per tick comes from these scripts. |
| Fishing | `server/content/scripts/skill_fishing/**` | Catch rolls, fishing spot behaviour and xp per catch. The measured fly-fishing route at Lumbridge depends on these numbers. |
| Mining | `server/content/scripts/skill_mining/**` | Mining success rolls, rock depletion and respawn, and xp per ore. The mining route's xp per tick comes from these scripts. |
| Thieving | `server/content/scripts/skill_thieving/**` | Pickpocket and stall success rolls, stun times and xp. The thieving route's xp per tick, and how long a failed attempt costs, come from these scripts. |
| Agility | `server/content/scripts/skill_agility/**` | Course obstacles, their tick lengths, fail chances and xp. The agility route's laps per level come from these scripts. |
| Fletching | `server/content/scripts/skill_fletching/**` | Fletching recipes, items made per action and xp. The fletching route's xp per tick comes from these scripts. |
| Herblore | `server/content/scripts/skill_herblore/**` | Herb cleaning and potion mixing, their delays and xp. The herblore route's xp per tick comes from these scripts. |
| Crafting | `server/content/scripts/skill_crafting/**` | Crafting recipes, including jewellery, with their delays and xp. The crafting route's xp per tick comes from these scripts. |
| Smithing | `server/content/scripts/skill_smithing/**` | Smelting and anvil smithing, their delays, success rolls and xp. The smithing route's xp per tick comes from these scripts. |
| Firemaking | `server/content/scripts/skill_firemaking/**` | Lighting rolls, the step after each fire and xp per log. The firemaking route's xp per tick comes from these scripts. |
| Prayer | `server/content/scripts/skill_prayer/**` | Bone burying delay and xp per bone. The prayer route's xp per tick comes from these scripts. |
| Runecraft | `server/content/scripts/skill_runecraft/**` | Altar access, runes made per essence and xp. The runecraft route's xp per trip comes from these scripts. |
| Combat, ranged and combat magic | `server/content/scripts/skill_combat/**` | Hit rolls, attack speeds, ranged and combat-spell data and combat xp. Every combat level and quest fight in the run, including Elvarg, is timed against these scripts. |
| Quests (grouped by directory) | `server/content/scripts/quests/**` | Quest requirements, steps and xp rewards. The measured quest routes and the quest-point total were planned against these scripts; changes are grouped by quest. |
| Trade and bank interfaces | `server/content/scripts/interface_trade/**`<br>`server/content/scripts/interface_bank/**` | How trade offers and bank deposits accept items. The run's batched deposit and batched trade fast paths were measured against these interfaces. |
| Bot webclient (counts only) | `server/webclient/src/lite/**`<br>`server/webclient/src/bot/**` | The client our bots run, including the state collector that produces the state the SDK reads. A change here can break our bots or need merging into the fork. |
| SDK (counts only) | `sdk/**` | The SDK our speedrun code imports. An upstream change here means merge work for the fork and may change the bot helpers our routes call. |
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
