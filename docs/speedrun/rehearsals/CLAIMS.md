# Parked rehearsal names

The operator locked in one rehearsal account per remaining skill (cairn://p/rs/167, under
cairn://p/rs/147). Each is claimed and parked: created by S00's tutorial skip, logged out cleanly,
and nothing else. No training happens until that skill's row is commissioned. Figures carry
RUN-HOST.md's labels: **m** measured (with the time), **r** read, **i** inferred.

## The names

| Account | Skill | Hiscore check before the claim (UTC) | Claimed (UTC) | In-world ticks at logout (session row) | Hiscore playtime after logout | Status |
|---|---|---|---|---|---|---|
| `cairn_swings` | Attack | not found, 21:10:52 | 21:10:52 | 9 (click 6) | 9 | parked |
| `cairn_bashes` | Strength | not found, 21:11:44 | 21:11:44 | 8 (click 6) | 8 | parked |
| `cairn_blocks` | Defence | not found, 21:12:00 | 21:12:00 | 8 (click 6) | 8 | parked |
| `cairn_lives` | Hitpoints | not found, 21:12:16 | 21:12:16 | 8 (click 6) | 8 | parked |
| `cairn_shoots` | Ranged | not found, 21:12:33 | 21:12:33 | 8 (click 6) | 8 | parked |
| `cairn_prays` | Prayer | not found, 21:12:50 | 21:12:50 | 7 (click 6) | 7 | parked |
| `cairn_spells` | Magic | not found, 21:13:07 | 21:13:07 | 8 (click 6) | 8 | parked |
| `cairn_cooks` | Cooking | not found, 21:13:45 | 21:13:45 | 8 (click 6) | 8 | parked |
| `cairn_carves` | Fletching | not found, 21:14:03 | 21:14:03 | 8 (click 6) | 8 | parked |
| `cairn_burns` | Firemaking | not found, 21:14:21 | 21:14:21 | 8 (click 6) | 8 | parked |
| `cairn_crafts` | Crafting | not found, 21:14:38 | 21:14:38 | 8 (click 6) | 8 | parked |
| `cairn_forges` | Smithing | not found, 21:14:54 | 21:14:54 | 9 (click 6) | 9 | parked |
| `cairn_brews` | Herblore | not found, 21:15:13 | 21:15:13 | 6 (click 5) | 6 | parked |
| `cairn_binds` | Runecraft | not found, 21:15:31 | 21:15:31 | 8 (click 6) | 8 | parked |

All on 2026-10-21 (m). Each name was checked twice: once for the whole list at 20:58:57-20:59:04
(all not found), and again in the second before its own claim (the column above). "Claimed" is
the harness's start; each claim took 16-18 s of wall time, login included.

**What the tick columns are.** The in-world figure is the `(session)` row's `endTick`, the
last client tick the account was in the world (`logout.lastInWorldTick`), counted from login at
tick 0. In brackets is the tick of the logout click. S00 took 4 ticks on every account except
`cairn_brews` (3), starting at tick 2-3; the click follows S00's last tick, and the server took
1-3 more ticks to drop the player. So the parked total is 6-9 ticks, one or two above the 3-8 the
brief expected: that estimate counted to the click, and the logout's own latency comes after it.
The hiscore playtime is the player page's Overall figure read by the harness right after the
logout, and it equals `endTick` on all fourteen. The harness's own expectation is `endTick + 1`
(a session's last tick + 1) and it accepts the -1, as it did on rs/164's acceptance (r, the
`(hiscore) Overall` rows).

Every logout was confirmed by the page's own in-game flag over CDP (`confirmedBy: "page"`); none
waited out a combat window (rs/164's fix). Each tab's URL list held neither the password nor a
token after the claim, and each tab was closed only after its page read out of game. At
teardown (21:16Z) the gateway reported all fourteen `inGame: false`, and the leftover check was
clean. Each claim's log is on the twin at `~/rs-run/<name>-claim.{jsonl,log,out}`.

The first execution of this child (rs/167/1) could not reach the twin: every Cairn batch it
placed, whatever executor it named, ran on an unlisted machine with no rehearsal key (reported
at cairn://bug). The second execution's batches reached bgsrv-ub, and the claims ran within
rs/147's 21:45Z slot.

## Is the name free? The hiscore check

`speedrun/tools/hiscore-scrape.ts`'s player page (`playerPath`, `parsePlayer`) through its
`PoliteFetcher`, one request at a time. The demo answers `Player "<name>" not found.` (HTTP 404)
only when its `account` table has no row for the name (`server/engine/src/web/pages/hiscores.ts`,
`handleHiscoresPlayerPage`). It looks the account up before it reads any hiscore row, so an
account with 0 xp, and no hiscore row at all, still gets a page of dashes. **So any page at all
means taken.** Two names also read "not found" while they exist: staff accounts (staffmodlevel
above 1) and the server's `HISCORES_HIDDEN_NAMES`. A first-login password refusal is the backstop
for those: treat it as taken, stop, and do not retry. The check reads our fork's server source.
That the demo runs the same handler is inferred (i), and the controls below agree with it.

Controls in the same run (m, 20:58:56-57Z): `cairn_smoke` (rs/164's throwaway) read **exists**,
Overall 28 at 56 ticks; `cairn_fishes` (assigned, then renamed before any login) read
**not found**.

The check is repeated right before each claim, and a name that reads taken goes back to rs/147
unclaimed, never with a variant.

## How a claim runs

On rs-ashburn-rehearsal (HOST.md), one account at a time, under an `rs-claim` that declares one
login (HOST.md, "Claims"). The slot files the first claims ran under are retired. The page server, gateway and Chrome run from
`~/rs-sdk` as RUN-HOST.md step 3 does. Chrome starts on a blank page; the harness opens each
account's tab over the DevTools port (`lib/tab.ts` `reloadOrOpenTab`). The harness runs from the
per-attempt worktree `~/rs-167`, whose `bots/` is a symlink to `~/rs-sdk/bots` (HOST.md). Per
name `N`:

1. Re-check the hiscore page for `N` (the player page through `PoliteFetcher`, with a fresh cache
   directory, since the fetcher caches by path and would otherwise return the earlier answer).
   Any page means taken: stop and report it.
2. Write `~/rs-sdk/bots/N/bot.env` with a fresh random password, mode 600, with HOST.md's command.
   It refuses if the file exists, and the password is never printed.
3. Claim it, bounded, as the whole command of a tmux session:

   ```sh
   N=<name>; tmux -L rehearsal new-session -d -s "$N" "cd ~/rs-167 && exec timeout --kill-after=30s 5m ~/.bun/bin/bun speedrun/rehearse.ts --claim --bot=$N --claim-owner=rs/NNN --log=$HOME/rs-run/$N-claim.jsonl >>$HOME/rs-run/$N-claim.log 2>&1"
   ```

   `--claim` (speedrun/README.md) is S00 and then `logoutClean`, with no gate read and no second
   login. `logoutClean` confirms the browser logout through the page's own in-game flag over CDP,
   and a logout in a session's first 16 ticks no longer waits out a combat window (rs/164).
4. Read the `(session)` row (`endTick` is the last in-world tick; `logout.clickTick` the click)
   and the summary's `hiscore Overall` line, the logout playtime of an account with no level
   gained. Then read the tab's in-game flag over CDP, and close the tab only once it reads false.
5. A login that never reaches the world (a refused password) ends the run with an error and no
   retry. Treat it as taken.

After the last claim: the tab stack's teardown (every tab already out), the worktree removed, the
slot released, then the leftover check. HOST.md's stack-stop command prints its own ssh shell
instead of `tab stack stopped`: its command line contains `pkill -TERM -x Xvfb`, which the
`[X]vfb` pattern matches. The leftover check, which matches process names, is the one to trust.

## Credentials

Each account's password exists only in `~/rs-sdk/bots/<name>/bot.env` (mode 600) on the twin, and
in the fleet's credential store on bbs as rs/41 directs. It is never in the repo, chat or a
process argument.
