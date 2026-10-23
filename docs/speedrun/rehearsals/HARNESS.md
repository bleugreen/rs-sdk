# Rehearsal harness: `speedrun/rehearse.ts`

The per-skill fastest-99 rehearsals (cairn://p/rs/147) all run through one harness: the gate
snapshot, a fresh account's tutorial skip (`speedrun/skills/start.ts`, S00), the kit receive,
one skill module's steps, a clean logout at the target level, and the tick log against the public
hiscore row. How it works and its flags are in `speedrun/README.md`, sections "skills/start.ts"
and "rehearse.ts". This page holds the measured results and the command lines a skill child runs.

## Lab acceptance (measured, 2026-10-21)

Local lab engine (`speedrun/lab/lab.sh`, `NODE_TICKRATE=300`, port block 9650), executor
bgsrv-mac (macOS arm64), lite client, a brand-new bot each run (`LAB_RUNNERS=0`, so the harness
launches the client itself and the session row starts at the login). Source: the tick logs of the
runs below; one sample each.

| Run | S00 | Steps | Boundary rows | Session | Overhead (session minus steps) |
|---|---|---|---|---|---|
| A: S00, chop stub to Woodcutting 15, logout | **3** | 68 | 0 ticks over 3 | 71 | 3 = 1.0 per boundary |
| B1: S00, idle part 1 of 3, SIGINT during it | **3** | 23 | 0 over 3 | 26 | 3 = 1.0 per boundary |
| B2: B's re-run with `--from=2`, parts 2 and 3 | - | 40 | 0 over 3 | 42 | 2 = 0.67 per boundary |
| Earlier: S00, `::give` kit (1 tick), chop stub, gate read by a second bot | **3** | 44 | 0 over 3 | 47 | 3 = 1.0 per boundary |
| C: S00, idle 1 tick, logout (rs/164, after the logout fix below) | **3** | 4 | 0 over 3 | 7 | 3 = 1.0 per boundary |

- **S00: 3 ticks, against the bar of 7.** The question page shows 1 tick after the pipelined
  design accept and talk, the choice page 1 tick after the continue, and Lumbridge with the 18
  starter items 1 tick after "Yes please." (the stock `bot.skipTutorial()` measured 6).
- **Boundaries: 0 ticks in every runner boundary row.** The whole overhead is 2-3 ticks of
  login frames the client counts before `openSession` sees an advancing state. The logout click
  lands on the last step's end tick (`logoutClean` latency 0). That meets "at most 1 tick per
  boundary".
- **A logout in the first 16 ticks no longer waits (run C, rs/164).** `logoutClean` used to read
  `lastDamageTick = -1` ("never damaged", `sdk/types.ts`) as a hit on tick -1. So a logout before
  tick 16 waited out a post-combat window first: rs/150's lab runs showed the click on tick 23
  instead of 6, twice. A negative `lastDamageTick` now means never. In run C, S00 ended on tick 6,
  the 1-tick stub on 7, and the click landed on tick 7 (logout latency 0), one tick after S00's
  end. A real hit within 16 ticks still waits (`session.test.ts`).
- **SIGINT mid-step:** sent 2 s into idle part 1, it logged out at the boundary after part 1, with
  the click on that part's end tick (26). The run exited 4, and the re-run resumed at part 2.
- **Direct gate read on the lab** (second bot, rs/96's CLI): 60/60 on time, tick p90 302 ms, 0
  catch-ups. The vantage check is not applicable to a local engine.
- **Not covered on the lab:** the hiscore comparison (the lab engine serves no hiscore page on
  its port, so the harness skips it), the browser client, the gate tab's in-page probes, and the
  kit trade from a giver (`receiveFrom` is measured in `speedrun/README.md`, "trade.ts"). These are
  for the demo run below.

## Demo acceptance (passed, rs/164, 2026-10-21 13:46-13:51 PDT)

On rs-ashburn-rehearsal (the twin) under rs/147's slot. The run used a fresh throwaway,
`cairn_smoke`, with the gate account `cairn_twin`. The browser tab ran on the xrdp display `:10`
(1920x1080, 24 planes), Chrome 156 with RUN-HOST.md step 3's six flags, and the page server and
gateway from `~/rs-sdk` at main 7c3e8c706. The harness ran from a worktree of the branch at
3ed0cd49c (`~/rs-164`, removed afterwards). There was no on-VM recording. Every figure below is
measured (m), and the source is the tick log `~/rs-run/cairn_smoke.jsonl` and the harness summary.

| Check | Bar | Measured |
|---|---|---|
| S00 on the demo | at most 11 ticks | **4** (ticks 2-6) |
| Hiscore Overall against the session row | within 2 ticks | **56** against the log's 57 (session ticks 0-56, last tick + 1): **-1, ok** |
| Session minus step rows | about 1 per boundary | 56 - 54 = 2 over 3 boundaries; every boundary row 0 ticks |
| Logout | the click on the last step's end | click on tick 56, the stub's end tick; latency 0; confirmed by **the page** over CDP in 233 ms |
| Direct gate read, `cairn_twin` (rs/96's CLI, 20:46:37Z) | (a) at least 58/60, (c) at most 2/min | 60/60, all at 1 tick; (c) 0 catch-ups/min; tick p90 391 ms; vantage edge iad, TCP connect p50 2.5 ms |
| Gate tab in-page probe, before | runs, (c) passes | 60/60, (c) 0/min, loop p10 72.6/s; (b) tick p90 422 ms, over the 400 report line |
| Gate tab in-page probe, after | runs | 60/60, (c) 0/min, loop p10 72.8/s; (b) p90 439 ms, over |
| `/playercount` | logged | 1,540 at the gate, 1,594 after the logout (no swing) |

The gate tab's tick p90 was over 400 ms on both probes, while the direct read on the same
account gave 391 ms. That is a report line, not a pass line, so it refused nothing.

**Relogs through the run's path (rs/158's question).** Right after the harness, still in the slot,
the run's own `login` and `logoutClean` relogged `cairn_smoke` three times through its tab
(`speedrun/tools/relog-probe.ts cairn_smoke --n=3`). Each relog was: the logout click, the out
confirmed by the page's flag, the tab re-navigated to a fresh one-time token, and the new
session's tick advancing.

| Relog | Click to confirmed out | Signal | Out to back in the world | Click to the new session's first published state | That state's client tick |
|---|---|---|---|---|---|
| 1 | 228 ms, 0 ticks | page | 11.9 s | 11.8 s | 20 |
| 2 | 324 ms, 0 ticks | page | 12.3 s | 12.3 s | 21 |
| 3 | 320 ms, 0 ticks | page | 12.9 s | 13.0 s | 22 |

The final logout was confirmed by the page in 222 ms. Each re-navigated tab's first state already
read client tick 20-22. The client counts its tick from PLAYER_INFO packets, which the server
sends only to a player in the world (`lib/wait.ts`). So the page was in the world about 20 ticks
before the SDK saw it. The first login on a freshly opened tab read tick 3 (`firstObservedTick`).
**Inferred:** a relog through a re-navigated tab costs about 20 ticks of playtime before control
returns, against the 2 ticks the run prices it at. The hiscore can't confirm this: Overall stays
at the first logout's 56, because a stamp moves only when a level is gained. The cause (the page's
socket to the gateway, or the SDK reattaching after a navigation) is not yet measured.

**The gateway can't confirm a browser logout.** After both pages read out of game, the gateway
still reported `cairn_twin` as `stale, inGame: true` (state 100 s old) and `cairn_smoke` as
`active, inGame: true`. `logoutClean` now confirms a browser tab by the page's own
`gameClient.ingame` over CDP (`lib/session.ts` `loggedOutBy`), and never by the gateway.

**Procedure notes.** A worktree's tracked `bots/` holds `create-bot.ts`, so link each account's
directory (`ln -s ~/rs-sdk/bots/<name> ~/rs-164/bots/<name>`), not `bots/` itself. Bun is not on
a non-login shell's PATH, so the harness spawns its gate CLI with its own bun
(`process.execPath`). The teardown is: read both pages' flags, and only when both are out,
`tmux -L run kill-server`.

The exact command, in the host's tmux and timeout form (the bound `B=20m` covers the gate read of
about 1.5 min, the two 60-trial tab probes, and the attempt; the stack had `T=30m`):

```sh
rm -f ~/rs-run/cairn_smoke.jsonl ~/rs-run/cairn_smoke.log; B=20m; ACCOUNT=cairn_smoke; mkdir -p ~/rs-run
tmux -L rehearsal new-session -d -s "$ACCOUNT" "cd ~/rs-164 && exec timeout --kill-after=30s $B ~/.bun/bin/bun speedrun/rehearse.ts --skill=speedrun/runner/stub.ts --skill-opt=idle=50 --bot=$ACCOUNT --gate-bot=cairn_twin --log=$HOME/rs-run/$ACCOUNT.jsonl >>$HOME/rs-run/$ACCOUNT.log 2>&1"
```

The relogs (`timeout` as a foreground measurement):

```sh
cd ~/rs-164 && timeout --kill-after=30s 6m ~/.bun/bin/bun speedrun/tools/relog-probe.ts cairn_smoke --n=3 --json=$HOME/rs-run/cairn_smoke-relog.json >>$HOME/rs-run/cairn_smoke-relog.log 2>&1
```

The leftover check was clean before (20:44Z) and after (20:52Z): no tmux server, no process, no slot.

## The command a skill child runs on the host

On the rehearsal host, as RUN-HOST.md prescribes ("Rules for every launch": `exec timeout` as the
whole command of its own tmux session, logs by redirection). The ssh line, key and IP are in
`docs/speedrun/rehearsals/HOST.md` (rs/149). The page server, gateway and Chrome (with
`--remote-debugging-port`) must be up first (RUN-HOST.md step 3). **Launch that Chrome with
`--app` on the attempt account's bare page** (`NAME=<ACCOUNT>` in step 3's command), not the gate
account's. The harness then reuses that app window for the attempt (staged as `present`). The gate
account gets a `/json/new` window, which is the one it closes, so the recording shows an app window
without a tab strip or address bar. The account's
`~/rs-sdk/bots/<ACCOUNT>/bot.env` (mode 600) needs `CLIENT_URL` (the proxy.ts page) and `CDP_URL`,
and the gate account `cairn_twin`'s needs the same. Off a local world the harness uses
`cairn_twin` when no `--gate-bot` is given; the command below names it anyway.
`cairn_gate` is rs/149's personal gate account, and the harness never uses it. Before
launching: your `rs-claim` (HOST.md, "Claims"; `~/rehearsal-slots/` is retired) and the
leftover check. Pass that claim's owner as `--claim-owner=rs/NNN`. Without it, the pre-flight
reads your own claim as a reservation and refuses with exit 5. With it, another owner or host's
preempt still refuses, or pauses at a step boundary. When the host checkout
is not at the attempt's commit, run from a worktree of it, as the demo acceptance did (HOST.md).
Then replace `cd ~/rs-sdk` with `cd` to that worktree.

```sh
# B: the bound, expected wall time x 1.5 (a 99 is about 1-3 h); ACCOUNT: the name rs/147 assigned;
# D: the operator's xrdp display, where Chrome and the recording are (RUN-HOST.md step 2).
B=4h; ACCOUNT=<account>; D=:10; mkdir -p ~/rs-run
tmux -L rehearsal new-session -d -s "$ACCOUNT" \
  "cd ~/rs-sdk && exec timeout --kill-after=30s $B env DISPLAY=$D ~/.bun/bin/bun speedrun/rehearse.ts \
     --skill=<skill> --bot=$ACCOUNT --gate-bot=cairn_twin --claim-owner=rs/NNN \
     --kit-from=<giver> --kit=<item:n,...> \
     --log=$HOME/rs-run/$ACCOUNT.jsonl >>$HOME/rs-run/$ACCOUNT.log 2>&1"
```

- At the bound, `timeout` sends SIGTERM and the harness logs out at once before it exits; the
  30 s kill-after covers the click. `tmux -L rehearsal kill-session -t $ACCOUNT` does the same.
- To stop at the next band boundary instead: `tmux -L rehearsal send-keys -t $ACCOUNT C-c`. A
  second C-c logs out at once.
- Exit 3 means the gate refused: nothing was logged in for the attempt. Wait and run again.
  Exit 4 means stopped or paused: run the same command again, with the same `--log`, and it resumes
  from game state. Exit 5 means the host is someone else's: refused at pre-flight, or paused for
  the gate/run at a step boundary (HOST.md, "Claims"). After host's preempt, release your claim
  once teardown is confirmed, and run again only once `rs-claim status` shows the machine free.
- `/playercount` goes into the log every 10 minutes as a `(players)` row. The summary prints the
  count's range, plus a `MOVED` line if it swung by more than half (a demo restart and refill).
- Watch with `tail -f ~/rs-run/$ACCOUNT.log`; afterwards `bun speedrun/lib/ticks.ts report
  ~/rs-run/$ACCOUNT.jsonl`.
- `DISPLAY` names the recorded display, for the recording check and the live-frame pass line
  (below). Without it the attempt runs the same, and the pass line is reported as unverified.
- Start the recording (RUN-HOST.md step 5) before the harness. It refuses the attempt (exit 3)
  when no recording runs on `DISPLAY`.
- After the attempt account's logout (`[rehearse] logout: out ...` in the log), stop the recording
  (RUN-HOST.md step 8). The after-probe waits for that, at most 10 minutes.

### Attempt kinds: measurement and record

Every attempt declares what it is for with `--kind`, and the kind picks the rule the direct gate
read is held to at pre-flight. The default is `measurement`.

| Kind | For | The direct read refuses on | `--force-gate` |
|---|---|---|---|
| `measurement` (default) | pricing a method or a band, where a weaker minute is a cost to record rather than a reason to wait | (c) only: catch-ups per minute over 2 | overrides, with a warning per reason |
| `record` | a fresh name raced once, whose time is the result | (c), **and** (a) under 58/60 next-tick reactions on a 60-trial read | refused: `--kind=record --force-gate` is a usage error (exit 2) |

The record line is tenet 12's (a) line. It was calibrated at 58/60, which agreed with (c) at most
2 on 17 of 17 reads. 60/60 is not the line, because it would refuse good minutes. A longer read
is held to the same share, rounded up (116 of 120), and a read of fewer than 60 trials refuses,
because it cannot show 58/60. A record attempt also needs a direct read on the lab, where a
measurement needs none. On 2026-10-22 the cairn_steals measurement started on a 57/60 read on
cairn_twin. That was correct for a measurement, and a record attempt would have refused it.

A record attempt can't be forced. Racing a name on a minute that failed the line would spend the
name on the very thing the line exists to prevent, and an override flag that is easy to pass would
make the line silent. To start on such a minute anyway, run it as a measurement and say so in its
findings.

A refusal names the criterion that failed (`record attempt: (a) 57/60 next-tick reactions on the
direct read, under the record line of 58/60`, or the (c) line, or both). It is the same exit 3
refusal as a failing (c): it comes after the gate tab has logged out and closed, before the attempt
account logs in, and it leaves the claim and the twin as it found them.

Every attempt's tick log has a `(gate) kind` row right after `(gate) direct`. It records the kind,
the rule it ran under, the read's (a) (`onTime`/`trials`) and (c) (`catchUpsPerMinute` against
`catchUpLimit`), and for a record attempt the line it needed (`recordLine`) and whether the read
held it (`recordHeld`; the row is `ok: false` with the reason when it did not). The summary's gate
block opens with the same facts, for example `gate: kind: record (refuses below 58/60 next-tick
reactions on the direct read, and on (c); no --force-gate); direct (a) 58/60, line 58 held; (c)
0/min, limit 2`, so a findings doc can state which rule applied. A `--claim` parks a name and is
not an attempt, so it takes no `--kind` and logs no kind.

## What the recording shows

The on-VM recording grabs the whole X display (RUN-HOST.md step 5). Every tab on the host's
Chrome, the gate account's and the attempt account's alike, is a window on that display, so the
recording shows whichever window is on top. Until rs/232, the harness opened the gate tab for the
before-probe and kept it logged in for the after-probe, and then opened the attempt's tab. The gate
window stayed on top, and cairn_casts' whole Fishing recording shows cairn_twin.

The harness now follows main's run-night ruling (cairn://p/rs/host, 2026-10-21 18:16 PDT), which
holds for rows too: the gate's window is closed before the attempt logs in; the attempt's tab is the
only browser window on the recorded display, maximised; the recording runs before the attempt's
login, and a live frame of it is a pass line of the gate; and no other window comes up on that
display until the attempt ends. In order (`rehearse.ts` `bracketAttempt`):

1. **The gate tab.** The gate account logs in, runs the 60-trial in-page probe, and logs out with
   `logoutClean`. Once the logout is confirmed:
   - the attempt account's bare client window (its `CLIENT_URL` with `bot=<name>` and no token) is
     put on the display, logged out and maximised (`lib/tab.ts` `stageBotTab`);
   - then the gate's window is closed (`closeBotTabs`), and its session disconnects.

   Opening the attempt's window first is what keeps Chrome up, since Chrome quits with its last
   window. `closeBotTabs` refuses to close Chrome's last window. The gate window is closed only
   after a confirmed logout: a closed tab is a dropped client, which the server keeps in the world
   for up to 500 ticks. If the probe, logout, staging or close fails, the attempt is refused (exit
   3), as a failing gate is.
2. **The recording.** Right before the attempt's login, the harness checks that an ffmpeg x11grab
   of `DISPLAY` writing a file is running (`lib/display.ts` `recordingState`). The operator's live
   view is another x11grab of the display, but it serves HTTP (`-listen`), so it doesn't count. With
   no recording on the display, the attempt is refused (exit 3). With no `DISPLAY` at all (headless
   Chrome, as on the run host in agility.md 7.6) the state is unknown, and the attempt is not
   refused: there is no recording and the live frame below is UNVERIFIED. A `(gate) recording` row
   records the result.
3. **The login, then the live-frame pass line.** The attempt account logs in by re-navigating its
   staged window. Once it is in the world, alongside its first steps (so the attempt's clock pays
   nothing), the harness:
   - brings the tab to the front and prefixes its title with the account name, for example
     `cairn_smoke - 2004Scape Bot Client`. Every client page has the same title, and the prefix is
     what tells the windows apart.
   - reads which window is on top of the display with `xprop` (from x11-utils, which the setup
     script installs; the twin has no xdotool), skipping the panel, the desktop and minimised
     windows;
   - grabs one frame of the display with ffmpeg x11grab, exactly as the recording grabs it, and
     matches it against the page's own render (`Page.captureScreenshot`). Both are compared at 1/8
     size, in gray, at every place the page could sit, and they match when the mean difference is
     at most 12 of 255 (`frameShows`).

   It passes when the tab's window is on top, the frame shows its page, it is Chrome's only page,
   and its window is maximised. When the window on top or the frame shows something else, it
   raises the tab once (minimise, restore, maximise, over CDP) and looks again. The result is a
   `(gate) live frame` row, ok only on a pass, with the frame PNGs kept beside the log as evidence.
   The direct read's own file, `<log>-<runId>-gate.json` (its per-trial rows and tick arrivals,
   which are what explain a short on-time count), is kept beside the log too, so copying the log's
   directory off before teardown keeps the gate's raw evidence.
   The summary also gets a `gate: live frame: PASS|FAIL|UNVERIFIED` line. A failure prints a
   `[gate] WARNING` line and never stops the attempt. A frame of a near-flat page, such as a black
   loading screen, is inconclusive, and that reports as unverified.
4. **The after-probe.** It runs only once the attempt account's logout is confirmed **and** the
   recording on the display has stopped, so the video ends on the attempt. The harness waits up to
   10 minutes for the recording to stop. Past that, it skips the after-probe rather than open a
   gate window on a running recording. A fresh gate session logs in, probes, logs out and closes
   its window. The probe is also skipped when the attempt's logout was not confirmed, or when the
   attempt paused for the gate/run (rs/213).

**Checked on the twin** (rs/232, 2026-10-22 02:03-02:10 UTC; m). The setup was RUN-HOST.md step 3's
stack, with Chrome's app window on cairn_twin's bare page and a 30-minute bound; the recording was
started at 02:03:2xZ. The run was
`rehearse.ts --skill=speedrun/runner/stub.ts --skill-opt=idle=300 --bot=cairn_smoke --gate-bot=cairn_twin` with `DISPLAY=:10`.
The recording was stopped by hand after cairn_smoke's logout line.

| Row | Result |
|---|---|
| `(gate) in-page before` | 60/60, (c) 0/min, loop p10 72.4/s. cairn_twin's logout was confirmed. cairn_smoke's window was then **opened** (`/json/new`, maximised), and cairn_twin's was closed |
| `(gate) recording` | running (the `.mkv`); the live view was not up |
| `(gate) live frame` | **PASS** 1.2 s after the first step: the window in front was `cairn_smoke - 2004Scape Bot Client - Google Chrome`, Chrome's only page, maximised; frame difference 2.5 (at 0,120), contrast 48.9; no raise needed |
| `(gate) in-page after` | 60/60 at 02:07:52Z, after the recording stopped at 02:07:27Z |
| Recording | 240.9 s, 7,226 frames, 0 dropped |

Frames extracted from the recording file (`ffmpeg -ss`) show cairn_twin's app window during its
before-probe (02:05:31Z). From cairn_smoke's login to the end of the file, they show cairn_smoke's
game view (02:06:39Z: "Cairn Smoke" in the chat and the overlay, tick 120).

The staged window is a normal Chrome window, with a tab strip and an address bar showing the bare
page URL (no token). It is not an `--app` window, because `/json/new` can't open one. The stub step
itself failed at tick 278 with `waitTicks(300): client stopped publishing`. That failure is
unrelated to the windows: `waitTicks`'s wall-clock backstop is (n + 13) x 300 ms, which is 93.9 s,
and the demo was ticking at about 0.34 s, so 300 ticks took longer than that. Use `idle=50` for
this smoke, as rs/164 did.

So the recording shows the gate account's window for its before-probe, if the recording was
already running then, and the attempt account's window from its login to its logout. Only one of
an attempt's accounts is in the world at any moment, where before there were two for the whole
attempt. The cost is one more gate-account login per attempt, off the attempt's clock.

The lab form, for a dry run of a skill module (no browser, no gate tab, staff kit):

```sh
LAB_RUNNERS=0 speedrun/lab/lab.sh <fresh bot> \
  'speedrun/rehearse.ts:--skill=<skill>:--client=lite:--lab:--to=<level>:--kit=<item=n,...>'
```
