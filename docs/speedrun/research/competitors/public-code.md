# Competitors B: published code, routes and writeups by other rs-sdk demo participants

What other participants on rs-sdk-demo.fly.dev have published, what techniques it contains, and
what each would save against our route (the tally in `cairn://p/rs/main/db`, table `tally`:
45,282 ticks expected, 34,894 best case; record stunbaron 35,916). Gathered 2026-10-21 by reading
only: every repository was cloned into its own empty directory outside the worktree and read with
`git grep`/`rg`, nothing was run, and nobody was contacted. Short excerpts are quoted; everything
else is a link pinned to the commit that was read.

## 1. Bottom line

- **None of the accounts above us has published code, a route or a writeup.** No public trace
  was found for stunbaron, stunhard, stunless, stunking, stunmine, nickoverall, nickquarry,
  asukalabs/asukalabs1, zayne/zaynelab06, claudefable5, codexastra, skylordafk, inaribot1, syn,
  eja620 or lachmine003. The account-to-owner links that do exist (soko and 0hyl8lmri to
  markeljan, gh_kadeski to kadeski) lead to tooling, not training code (section 3).
- **Nothing published beats our route.** All the public speed work is far slower than ours
  (msalmeida's Fishing 99 in 2h40m against our 3,410 ticks, about 17 minutes; UberMouse's iron
  at about 5 base xp per tick against our measured 11.67), or it is
  about other goals: gold farming, King of the Hill, quests for their own sake, benchmarks. No
  public source uses any of our exploits (wine without a level check, Charge without a
  cooldown, dialogue bursts, knife-on-log tick manipulation, five-packet interleaving).
- **The most useful public material is rs2b0t's quest pitfalls** (section 4.1): a separate
  2004scape bot client on the **same content revision (289)** as the demo, with live-run
  pitfall notes for most quests on our route. Worth an estimated 200 to 500 ticks of avoided
  quest retries and stalls. It needs a review against our quest scripts, not new research
  (brief in section 8).
- **The hiscore rule change was not prompted by gaming.** Commit 55fa26cca (rank by the tick a
  level was reached) follows a fairness complaint: Jamie Legg's PR #67 (2026-08-26) said maxed
  accounts kept losing rank because every logout re-stamped their playtime. Max fixed that in
  two steps (2026-10-07, then 2026-10-18). No source describes anyone exploiting either rule
  (section 5).
- **Everything else is 0 ticks for us.** It is either already in our route or measured docs,
  patched upstream, or about gold. Two operational facts are worth keeping: a second login
  kicks the first session, and the update packet shows at most 250 players on the same floor
  (section 6).

## 2. What was searched

| Where | How | Result |
|---|---|---|
| Forks of MaxBittker/rs-sdk | `gh api repos/MaxBittker/rs-sdk/forks --paginate` (141 forks), then forks of forks, then each fork's commits since it was forked, with upstream's own commits filtered out. Upstream rewrote its history in March, so a raw `ahead_by` count is meaningless for older forks. The forks behind recent PR authors (Ghosts, wheredidmyantsgo, Acquiredl, Milbaxter, CakeRepository, Kudretg) were missing from that list, so their branches were checked one by one. | About 25 forks have their own commits. Section 4 covers the ones with game content; the rest are SDK fixes, dev-environment tweaks or website changes. |
| Upstream PRs and issues (open and closed, #1 to #85) | `gh pr list`/`gh issue list --state all`, then bodies and comments of every one that touches hiscores, exploits, xp or bot tooling. Discussions are disabled on the repo. | Section 5 (hiscores) and section 6 (exploit reports). |
| Upstream commits since 2026-06 | `git log`, plus `server/PATCHES.md` (the list of local server modifications, which credits reporters). | Section 5 and section 6. |
| GitHub search | `gh search repos` and `gh search code` for rs-sdk-demo, rs-sdk-demo.fly.dev, runebench, "2004scape bot", "rs-sdk bot", every account name above, and the GitHub users of the same names. | Repos: RuneBench and its forks, rs-fleet, rs-sdk-dashboard, CScape, rs-sdk-fleet. Code hits: only markeljan's dashboard names a listed account (sokobot, SOKO, 0hyl8LmRi). Users named kadeski, asukalabs, sokobot, nickai, syn, vends, zayne, soko and codexastra exist on GitHub; only kadeski is active on rs-sdk. |
| Web | Exa searches for the record, the account names, maxing writeups, Max Bittker's posts; his X feed via a nitter mirror; the Hacker News threads on rs-sdk (Feb) and on his RuneBench talk (Oct 18); lostcity.rs. | Max's posts are about RuneBench and the economy, not the speedrun board. His talk ("RuneScape Bench: MMOs for Agents", Recurse Center, 2026-10-17) has no transcript the reader can fetch. The lostcity.rs "2004Scape Speedrunning" thread is behind a CAPTCHA. Neither HN thread mentions maxing times. |
| Discord | Not read directly: reading needs an account in the server, which is left to the operator (section 9). GoonMachine's repo publishes a read-only sample of the rs-sdk Discord taken 2026-08-15 (section 4.3). | Second-hand only. |

The deepwiki MCP was not needed: every repo of interest was small enough to clone and read.

## 3. Which listed accounts have a public footprint

| Account(s) | Owner found | What they published | Speedrun content |
|---|---|---|---|
| soko, sokobot, sokoalt*, soko3..soko28, 0hyl8lmri | **markeljan** ([rs-sdk-dashboard](https://github.com/markeljan/rs-sdk-dashboard), "the dashboard a 90-account rs-sdk fleet runs on") | A fleet dashboard, phone remote and spectator TV. It is synced from a **private** rs-sdk fork ([`SYNCED_FROM`](https://github.com/markeljan/rs-sdk-dashboard/blob/2a6fa48f4ddd1c14c14e36c6b3d88e683ad13c85/SYNCED_FROM): `rs-sdk 6bcc8992…`, 2026-10-13). Its milestones say "sokobot finished all 63 quests" (10-07) and "0hyl8LmRi reached 99 in every skill and handed its loot to SOKO" (10-08) ([`highlights.ts:15-17`](https://github.com/markeljan/rs-sdk-dashboard/blob/2a6fa48f4ddd1c14c14e36c6b3d88e683ad13c85/tools/dashboard/highlights.ts#L15-L17)). | None. The quest scripts it refers to (`bots/SOKO/quests/naturespirit.ts`, [`process-affiliation.test.ts:19`](https://github.com/markeljan/rs-sdk-dashboard/blob/2a6fa48f4ddd1c14c14e36c6b3d88e683ad13c85/tools/dashboard/process-affiliation.test.ts#L19)) are not public. |
| gh_kadeski | **kadeski** (Kaden Staker) | [rs-world](https://github.com/kadeski/rs-world), a live 3D viewer of the demo's world feed; [rs-sdk-upstream](https://github.com/kadeski/rs-sdk-upstream), an unmodified mirror of upstream at 2012ab67; [skills](https://github.com/kadeski/skills), Claude Code plugins unrelated to the game. Upstream PR #73 (Miscellania coffers, section 6) and issue #72 (world feed in Safari). | None. |
| nickai, nickai3, nickwins, nickoverall... | Unknown. A Discord user "Nick" described combat farmers who bank at three items (GoonMachine's sample, section 4.3). GitHub user nickai has been inactive since 2018. | Nothing. | None. |
| simplereally | GitHub user Simplereally makes web tools; nothing rs-sdk related. On 2026-08-15 simplereally held the fastest max at **143h 52m** ([GoonMachine `owner-context.md:228`](https://github.com/GoonMachine/rs-sdk/blob/a2c13e8a76285d1aa95cf8343c4fbec667c30ee7/learnings/owner-context.md#L228)). | Nothing. | None. |
| vends, eja620 | Named among the maxed accounts in the top 10 on 2026-08-15 (with nickai and claude46), and vends 4th on the equipment board (GoonMachine `owner-context.md:228`, `top-players.md`). GitHub users Vends and eja620 are unrelated or absent. | Nothing. | None. |
| All other listed names | No trace on GitHub or the web beyond the demo's own hiscore pages. | Nothing. | None. |

The record history is the one useful fact here. The fastest max was 143h 52m on 2026-08-15 and
is 2h 59m now, so every account in today's top group maxed in the last two months, almost
certainly with an exploit-heavy route like ours, and none of them has published it. Stamps
written before 2026-10-18 are logout times, so they can only overstate how long an account took
(section 5). rs/69 and rs/72 reconstruct the timings.

## 4. Sources with game content

The column "Revision" matters because the demo moved from LostCity revision 274 to 289 on
2026-10-09 ([8601955c](https://github.com/MaxBittker/rs-sdk/commit/8601955cfba4b73f9ae92ea341b131ec80ae2d0d)).
Anything measured before that date was on different content scripts.

| Source | Author, date | What it is | Revision | Techniques relevant to us | We have it? | Ticks saved |
|---|---|---|---|---|---|---|
| [rs2b2t/rs2b0t](https://github.com/rs2b2t/rs2b0t) (`90a6924`) | rs2b2t project, 2026-07 to 10-19 | Bot client for rs2b2t, a 2004scape "anarchy" fork, not the demo. It ships quest modules plus about 40 pitfall notes from live runs. | **289** (same as the demo) | Quest pitfalls for Fight Arena, Holy Grail, Tree Gnome Village, Grand Tree, Sea Slug, Fishing Contest, Biohazard, Underground Pass, Regicide, Legends and more (4.1) | Partly: our quest docs measured the same quests independently | **200-500** (estimate; section 8 brief) |
| [TestingPurposes/rs-sdk-fleet](https://github.com/TestingPurposes/rs-sdk-fleet) (`3cb9a52`) | anonymous, 2026-07 to 08 | A headless protocol client (about 1,800 bots on one PC), navgrid pathfinding, a gold-consolidation "pyramid", about 30 learnings documents | 274 | Floor-scoped player lists for crowded trades; a second login kicks the first session; no login rate limit off-production (6) | No (operational facts) | 0-150 (trades); 0 (risk avoidance) |
| [UberMouse/rs-sdk](https://github.com/UberMouse/rs-sdk) (`8cf8568`) | Taylor Lodge, 2026-10-09 to 10-18 | "Conductor" task framework, method models, measured skill learnings. Runs on a local server at 400 ms. | 289 | Smithing: a bar used within 3 ticks of the last item's xp is lost; mining: clicking on the predicted roll tick gains nothing (4.2) | Yes, both inside our measured cycles | 0 |
| [GoonMachine/rs-sdk](https://github.com/GoonMachine/rs-sdk) (`a2c13e8`) | GoonMachine, 2026-08-16 | King of the Hill and scarce-goods swarm playbooks, a quest-xp "combat bootstrap" stack, a Discord sample, server-difference notes | 274 | Quest-xp bootstrap order (4.3) | Yes, valued in our quest docs | 0 |
| [msalmeida-boomer/runescaper](https://github.com/msalmeida-boomer/runescaper) (`229f5b6`) | msalmeida-boomer, 2026-03-10 | Fishing 99 in 2h40m (three bots), a benchmark journal | 245/254 era | Fly fishing with a resupply loop beat netting 2x on xp | Yes (our fishing route is far faster) | 0 |
| [AuburyEssentian/rs-sdk](https://github.com/AuburyEssentian/rs-sdk) (`1b3c0a4`) | Aubury Essentian, 2026-03 | A single all-skills bot script, v5 to v7.2 | pre-274 | Stock methods (cows, guards, warriors) | Superseded | 0 |
| [saimdlx/nineninemaxxing](https://github.com/saimdlx/nineninemaxxing), [dlhg/rs-sdk](https://github.com/dlhg/rs-sdk) | 2026-04 to 08 | Upstream's old example scripts; the one own commit only touches `bun.lock` | old | None | - | 0 |
| [samheutmaker/lumbridge-ai](https://github.com/samheutmaker/lumbridge-ai) (`210b7ac`) | Sam Heutmaker, 2026-08-17 | Their own server (250 ms ticks), a swarm agent and a website | own server | None for the demo | - | n/a |
| [MaxBittker/runebench](https://github.com/MaxBittker/runebench) and forks ([Skyvern-AI/jevscape](https://github.com/Skyvern-AI/jevscape)) | Max Bittker; Skyvern, 2026-02 to 10 | Benchmark: peak xp in a 15-second window over 15- or 30-minute tasks on a private server, with model trajectories | private server | "Bank then burst" processing, as named in GoonMachine's notes | Yes (our helper-fed blocks) | 0 |
| [chrisbremmer/rs-fleet](https://github.com/chrisbremmer/rs-fleet), [singulocity/rs-sdk](https://github.com/singulocity/rs-sdk), [Kudretg/rs-sdk](https://github.com/Kudretg/rs-sdk) `feature/multibot`, [Acquiredl/rs-sdk](https://github.com/Acquiredl/rs-sdk) `acquiredl` | 2026-04 to 10 | Fleet orchestration, a 100-bot local fleet, a multi-bot runner, chat "guild" bots | various | Supervision only | Ours exists (rs/43) | 0 |
| [markeljan/rs-sdk-dashboard](https://github.com/markeljan/rs-sdk-dashboard), [kadeski/rs-world](https://github.com/kadeski/rs-world) | 2026-10 | Spectator tooling (section 3) | 289 | Live world feed and `/playerpositions` (6.4) | Not used yet | 0 (helps observation) |

### 4.1 rs2b0t's quest pitfalls (same revision as the demo)

rs2b0t's quests are pure `decide(snapshot) -> step` modules
([`docs/QUESTS.md`](https://github.com/rs2b2t/rs2b0t/blob/90a69240a4617155f280f098958c3cd7f044f234/docs/QUESTS.md)).
Each pitfall page records what a live run cost them. The items that bear on our route:

- **Fight Arena** ([quest-pitfalls-4.md:13-17, 32-35](https://github.com/rs2b2t/rs2b0t/blob/90a69240a4617155f280f098958c3cd7f044f234/docs/decisions/quest-pitfalls-4.md#L13-L35)).
  Killing the ogre with Justin and General Khazard both in range runs stages 8 to 9 inside one
  dialogue, so a script that waits to observe stage 8 stalls. Reading the quest journal opens a
  main modal, which is bad mid-fight. With Protect from Melee, all three beasts died to an
  **unarmed** max-stats account without landing a hit. Our Fight Arena (850 ticks, measured at
  70/70/70) should check that it never waits on stage 8.
- **Regicide, tar still** ([quest-pitfalls-34.md:39-44](https://github.com/rs2b2t/rs2b0t/blob/90a69240a4617155f280f098958c3cd7f044f234/docs/decisions/quest-pitfalls-34.md#L39-L44)).
  Progress accrues only at full regulator flow with the heat needle in bits 19 to 24. Coal at
  needle six or below, four ticks apart, finishes in **36 ticks on six coal**. Two lumps in one
  softtimer period overshoot the gauge every time. The page also warns that `interface.pack`
  ids are the server's, not the client's: the still's buttons must be found by their menu text.
  The Regicide chain is our largest unmeasured quest block (5,000 expected, 4,000 best).
- **Grand Tree** ([quest-pitfalls-20.md](https://github.com/rs2b2t/rs2b0t/blob/90a69240a4617155f280f098958c3cd7f044f234/docs/decisions/quest-pitfalls-20.md)).
  Active ground decor blocks its own tile, so each trapdoor has exactly one stand tile. Spiral
  stairs are missing from their stair graph. The stronghold gate turns you back on the way out
  at stage 80 and on the way in at stage 90. One conversation walks, teleports and talks again,
  outlasting a normal dialogue driver.
- **Underground Pass** (pages 29 to 31). The op-click and the modal must land in separate
  server ticks; the client can flush both packets into one tick. This bears directly on our
  five-packet interleaving: some multi-packet bursts inside Underground Pass must be split
  across ticks.
- Also covered: Holy Grail (16), Tree Gnome Village (17), Sea Slug (8), Fishing Contest (13),
  Biohazard (15), Legends (36 and 37), plus general engine pitfalls (doors re-shut in 3 ticks,
  a bought-out shop never restocks a nulled slot, cutscene `if_close` returns early).

These are correctness facts, not new xp. Their value is the failure allowance in our quest
tally: expected minus best is about 370 for Monkey Madness (which rs2b0t does not cover), 155
for Grand Tree, 60 for Merlin's Crystal and Holy Grail, 1,000 for the Regicide chain and 500 for
the troll chain. The pitfalls address part of the Regicide and Grand Tree gaps and harden Fight
Arena and Holy Grail, hence the 200 to 500 tick estimate.

### 4.2 UberMouse (Taylor Lodge)

A careful local-server project with measured learnings tagged by date and fixture. Two facts
touch our routes, and both are already absorbed:

- **Smithing lockout**: "A bar used on the anvil within 3 ticks of the previous item's Smithing
  XP is lost: no interface opens"
  ([`learnings/smithing.md:69-71`](https://github.com/UberMouse/rs-sdk/blob/8cf856819d96026dc47194037f371691fc3545e5/learnings/smithing.md#L69-L71)).
  Our smithing route uses make-5 chains and re-clicks after the chain
  (`docs/speedrun/skills/smithing.md` on the rs/28 branch, section 4), so the 3-tick window
  falls inside its measured 42-tick bank cycle. 0 ticks.
- **Mining**: "Clicking the next rock on the predicted roll tick gains nothing: `World.cycle`
  processes client input before players"
  ([`learnings/mining.md:61-63`](https://github.com/UberMouse/rs-sdk/blob/8cf856819d96026dc47194037f371691fc3545e5/learnings/mining.md#L61-L63)).
  This agrees with our timer-starter model (a roll-tick click only redirects that roll).
  Their best is about 6.75 ticks per iron ore with 4 or more rocks; our measured rotation is 3
  ticks per roll (`docs/speedrun/skills/mining.md` on the rs/2 branch). 0 ticks.

### 4.3 GoonMachine

- **Quest-xp combat bootstrap**
  ([`bootstrap-quest-stack.md:17-27`](https://github.com/GoonMachine/rs-sdk/blob/a2c13e8a76285d1aa95cf8343c4fbec667c30ee7/learnings/bootstrap-quest-stack.md#L17-L27)):
  Restless Ghost (1,125 base Prayer), Vampire Slayer (4,825 Attack), Witch's House (6,325
  Hitpoints), then Waterfall, Tree Gnome Village, Fight Arena, Merlin's Crystal and Holy Grail,
  and Dragon Slayer. Our quest docs already value each of these: Witch's House at 0 for us
  (quests README, rs/3 branch), Vampire Slayer at 0 because Attack is capped and Restless Ghost
  as small (`quest_points.md` rows 13 and 20). 0 ticks.
- **Discord sample, 2026-08-15**
  ([`discord-meta-2026-08-15.md:46-62`](https://github.com/GoonMachine/rs-sdk/blob/a2c13e8a76285d1aa95cf8343c4fbec667c30ee7/learnings/discord-meta-2026-08-15.md#L46-L62)).
  Channels `general`, `99str-contest`, `agent-techniques` and `share-progress`. Relevant
  claims: quest-based combat bootstrapping beat grinding in the `99str-contest` channel (a
  Waterfall, Grand Tree, Tree Gnome Village, Fight Arena and Vampire Slayer stack). One
  participant ran a four-bot thieving pilot with deterministic tick policies and no model calls
  in the hot loop. Nothing about maxing exploits.
- Production tick measured at **300.3 ms** (100 ticks in 30,025 ms, `server-diffs.md:20-22`),
  which matches our assumption.

## 5. The hiscore rule change: who prompted it, and how

| Date | Change | Source |
|---|---|---|
| 2026-02-08 | Playtime tiebreak added: boards rank by level, then playtime ascending, written at logout | migration `20260208000000_hiscore_playtime_and_outfit` ([PATCHES.md](https://github.com/MaxBittker/rs-sdk/blob/b565f2d920bf6f5ec427bc6f66dc6fd64a2e15c1/server/PATCHES.md), "Hiscore playtime tiebreak") |
| 2026-08-26 | **Jamie Legg, PR #67** "freeze hiscore time at achieved level": "`updateHiscores` treated every lifetime playtime change as a score change and overwrote the stored tie-break time on logout/reconnect ... maxed accounts kept losing rank after reaching max." Still open; never merged. | [PR #67](https://github.com/MaxBittker/rs-sdk/pull/67) |
| 2026-10-07 | Max: stamp playtime only when a row's level changes (XP-only changes keep it) | [415491a1](https://github.com/MaxBittker/rs-sdk/commit/415491a1ccaa5cca16034e597a238121f0fb2eaf) |
| 2026-10-18 | Max: stamp `player.playtime` per stat on each level-up, persist it (save v9), total level uses the latest stat stamp; older saves fall back to logout playtime. Rationale in the message: rows "were only written at logout ... hours late for anyone who kept playing". | [55fa26cc](https://github.com/MaxBittker/rs-sdk/commit/55fa26ccaad35417c4fe828000e5d832512186c1) |

**Who and how**: the trigger was a fairness bug, not someone gaming the rule. Under the old
rule an account could only lose by playing on, so the rule had nothing to exploit. Jamie Legg
reported it, and Max's two commits fixed it (the second also stops long sessions being stamped
late). No PR, issue, commit message or Discord sample mentions an account abusing either
rule.

What this means for us:

- Under 55fa26cca, our total-level stamp is the tick of our last 99. Logging out promptly
  after maxing no longer matters. Logging out during waits still does, because playtime counts
  every logged-in tick.
- Stamps of accounts that maxed before 2026-10-18 fall back to their logout playtime, so they
  are **upper bounds**, possibly hours above the true level-up tick. Whether 55fa26cca is live
  on the demo is rs/72's question.

## 6. Other facts from public sources

### 6.1 Exploit reports and patches (all closed, none useful to us)

| Report | What | Status on the demo | For us |
|---|---|---|---|
| kadeski, [PR #73](https://github.com/MaxBittker/rs-sdk/pull/73) (2026-10-11) | Managing Miscellania coffers accepted unchecked deposit and withdraw amounts (a coin dupe) | Patched: [fb264971](https://github.com/MaxBittker/rs-sdk/commit/fb264971634d877c8d7f8dc3d93c608d6d879a0f) "coin dupe regression coverage" | n/a: coins are not a bottleneck |
| IMNMV, [issue #55](https://github.com/MaxBittker/rs-sdk/issues/55) (08-17) | A stale duel-challenge varp let a player die anywhere and keep every item | Patched: [c4880dc8](https://github.com/MaxBittker/rs-sdk/commit/c4880dc82e2a5722525a894197a13295d1a49cc2) | n/a |
| MidTermDev, [issue #56](https://github.com/MaxBittker/rs-sdk/issues/56) (08-18) | The Lost City ring shop sells ruby rings below high-alch value (about 12 rings an hour server-wide) | Open | n/a: gold only |
| (Max) [cbfd40e6](https://github.com/MaxBittker/rs-sdk/commit/cbfd40e6fa2c897bd70b0efdd7f977320b3f5455) (10-03) | Razmire buyback profit | Patched | n/a |
| ancientastronauttheorist, issues #57 to #60 (08-18) | Web-layer security (default password, unthrottled auth, screenshot writes, exportCollision) | Patched | Off limits under tenet 6 anyway |

rs/78 owns the full list of exploit fixes; nothing here touches wine, Charge, dialogue or packet
handling.

### 6.2 A second login kicks the first session

TestingPurposes measured 3,953 server logouts in one night from two supervisors fighting over
the same accounts
([`KEY-FINDINGS.md:79-87`](https://github.com/TestingPurposes/rs-sdk-fleet/blob/3cb9a5266784d3ce68c1308151e93f957d7b95df/learnings/KEY-FINDINGS.md#L79-L87)).
Our server does the same: "player already logged in - kick the existing session and transfer
their state to the new login" (`server/engine/src/engine/World.ts:988`). For the scored account
this is a correctness rule, not a saving: exactly one process may ever hold www_cairn_md's
credentials. An accidental second runner would cost a logout and login (and possibly a lost
quest step) each time it fights the first. 0 ticks if respected.

### 6.3 Trades on a crowded tile and the 250-player view

The update packet shows each player at most 250 others, shrinks the view distance below 15
tiles when crowded, and only includes players on the same floor
(`server/engine/src/network/rsbuf/build.ts:55` and `:259`). TestingPurposes used this for
parallel trades upstairs, away from a 1,799-bot crowd on the ground floor
([`KEY-FINDINGS.md:19-22`](https://github.com/TestingPurposes/rs-sdk-fleet/blob/3cb9a5266784d3ce68c1308151e93f957d7b95df/learnings/KEY-FINDINGS.md#L19-L22)).
For us it matters only if a hand-off spot holds more than 250 players within view, where a
helper could drop out of the scored account's player list and the trade request would fail. The
demo has about 1,262 players spread over the map, so this is unlikely outside a few hotspots.
Estimate 0 to 150 ticks, part of the unmodelled 1,000-tick contention line. Below the brief
threshold, but rs/49's hand-off giver should pick an uncrowded tile, or the floor above, when
the scored account's player count nears 250.

### 6.4 Live world feed and position endpoints (for rs/71)

Two public, read-only endpoints show where every online player is:

- **`https://rs-sdk-demo.fly.dev/playerpositions`** returns JSON with `{x, z, level, name}`
  for every online player, cached for one second
  ([`worldfeed.ts` `getPlayerPositionsJson`](https://github.com/MaxBittker/rs-sdk/blob/b565f2d920bf6f5ec427bc6f66dc6fd64a2e15c1/server/engine/src/web/worldfeed.ts#L619-L627),
  routed in `web/index.ts:133`). GoonMachine polled it for live tiles.
- **`/worldfeed`**, a WebSocket of every player and NPC per tick
  ([68ff9ebf](https://github.com/MaxBittker/rs-sdk/commit/68ff9ebf8263d03d62dec817363948c0f71a857f);
  the demo's `fly.toml` caps it at 128 clients with a two-minute idle timeout). Max links a
  public viewer of it, [maxbittker.github.io/rs-world](https://maxbittker.github.io/rs-world/)
  (built on kadeski's rs-world).

Polling `/playerpositions` once every few seconds lets rs/71 log where named top accounts are,
and how long they stay, with no observer logged in. This is passive and inside tenet 6, but
stay at a polite rate: one request per few seconds, not per tick. 0 ticks, but it is the cheapest
way to see what the stun and nick accounts do now, including which helper names cluster around
them.

### 6.5 Settings that bound helper swarms

The demo allows **100 game sessions per IP**, keyed on `Fly-Client-IP`
([2fdb019b](https://github.com/MaxBittker/rs-sdk/commit/2fdb019b3edc20e758c2738c8c6d8eb039b1dd93),
2026-10-04; `MAX_PLAYERS_PER_IP = "100"` in the demo's `fly.toml`, where the code default is
200; earlier caps were 200 and 400). PR #79 (wheredidmyantsgo, a toggle that skips the
level-up interface) is open and the demo default keeps the interface, so our level-up
dismissal (rs/40) stays necessary.

## 7. Techniques ranked by ticks saved

| # | Technique | Source | Already ours? | Applies to rev 289? | Ticks saved (expected) |
|---|---|---|---|---|---|
| 1 | Review our quest scripts against rs2b0t's live-run pitfalls (Fight Arena stage skip, Regicide still recipe, Grand Tree stands and gate, Underground Pass tick splits) | rs2b0t | Partly | Yes | **200-500** (brief below) |
| 2 | Hand-offs on an uncrowded tile or floor when the view nears 250 players | TestingPurposes plus our `build.ts` | No | Yes | 0-150 |
| 3 | One process per scored account (second login kicks the first) | TestingPurposes plus our `World.ts` | Implicit | Yes | 0 (risk avoidance) |
| 4 | Quest-xp combat bootstrap (Restless Ghost, Vampire Slayer, Witch's House, Waterfall...) | GoonMachine, Discord `99str-contest` | Yes, valued | Yes | 0 |
| 5 | Smithing: no bar within 3 ticks of the last xp | UberMouse | Yes, in the measured cycle | Yes | 0 |
| 6 | Mining: roll-tick clicks only redirect the roll | UberMouse | Yes | Yes | 0 |
| 7 | Bank, then process in a burst | RuneBench and GoonMachine | Yes | Yes | 0 |
| 8 | Fly fishing with a resupply loop | msalmeida | Superseded | n/a | 0 |
| 9 | Miscellania coin dupe, duel death keep, ring alch loop, Razmire buyback | issues and PRs | n/a | Patched or gold-only | n/a |
| 10 | Level-up interface toggle | PR #79 | n/a | Not deployed | n/a |

## 8. Brief: rs2b0t pitfalls against our quest scripts (estimated 200-500 ticks)

For each quest on our route that rs2b0t documents (Fight Arena, Merlin's Crystal and Holy
Grail, Tree Gnome Village, Grand Tree, Sea Slug, Fishing Contest, Biohazard, Underground Pass,
Regicide), read its pitfall page
([index](https://github.com/rs2b2t/rs2b0t/blob/90a69240a4617155f280f098958c3cd7f044f234/docs/QUESTS.md),
commit `90a6924`, MIT; link and paraphrase, do not copy code). List each pitfall our step list
or script does not already handle, then confirm it against our own content scripts (same
revision 289). The rs2b0t notes cite script names, so this is a grep. Run the affected legs on
the local server at 300 ms. Priority by size of our failure allowance: the Regicide still (their
recipe claims 36 ticks on six coal at four-tick spacing; time ours) and the Underground Pass
legs where an op-click and a modal must land in separate ticks (check every five-packet burst
there); then the Grand Tree trapdoor stand tiles and gate direction at stages 80 and 90; then
Fight Arena's stage 8 to 9 jump (never wait for stage 8; with Protect from Melee, test whether
the arena fights need any weapon at all). Done when each relevant pitfall is marked handled or
fixed, with the measured tick difference, in the quest's doc on the rs/3 branch. The rs/3
coordinator (or rs/80, which is finalizing the quest README) should own it.

## 9. Open

- Max's RuneBench talk (2026-10-17, chapters "Agent farming practices" and "AI macro
  economics") may mention the speedrun board. No transcript could be fetched; someone with a
  browser could skim the 16:32 and 35:34 chapters.
- The lostcity.rs "2004Scape Speedrunning" thread (2026-06-04) is behind a CAPTCHA. It is about
  the human 2004scape game, but might list category tricks; rs/59 and rs/75 cover that
  community.
- The rs-sdk Discord (channels `99str-contest`, `share-progress`, `agent-techniques`) is the
  only likely home of a writeup by the stun or nick teams. Reading it needs an account in the
  server, which tenet 6 does not forbid (it is reading, not contact). That is the operator's
  call.
