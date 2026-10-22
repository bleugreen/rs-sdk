# Run hosts: the two Ashburn machines, step by step

The scored run is played first person in our fork's browser webclient, in a visible Chrome tab on
one of **two run-capable machines in Ashburn: the run host, rs-ashburn-run, and its twin**
(addresses: cairn://p/rs/host). Both are kept with the same RUN_COMMIT, gate history timer, host
reservation, recording and live-view setup, and the run starts on whichever passes the gate
immediately before the start (cairn://p/rs/tenets/17, approved 17:44 PDT 2026-10-21; it narrows
tenet 12's single named machine and tenet 13's "never from the twin"). Tenet 12
(cairn://p/rs/tenets/12, which supersedes tenet 11) still sets the gate and the configuration. This
page is both machines' runbook, in run order: what to check, what to start, what to record, how to
measure the gate, how to choose the machine (step 5a), and how to stop. Steps 0-5 run on both
machines; from step 7 on, "the chosen machine" is the one step 5a picked.
[RUN-ORDER.md](RUN-ORDER.md) section 1 summarises it; the gate's conditions and the knife switching
rule live there. **SCORED** is the scored account; its real name never appears here, in a commit, a
log line or a chat message. Figures carry a label: **m** measured (with the time), **r** read from a
file, a config or main's notes, **i** inferred.

**The run's standing configuration** (main, 10:02 PDT 2026-10-21, on the measurements below; tenet 12,
approved, which supersedes tenet 11's "remote desktop connected"):

- the recording is captured on the VM;
- **RDP is disconnected during the run**;
- the operator watches through a 3 fps MJPEG **live view** (step 5).

RDP is used only before the run: to create the desktop session at the right geometry and to check the
bring-up by eye. With RDP disconnected the tab runs exactly as fast as with it connected, and the
recording is smooth. A connected session costs the recording about a fifth of its frames.

## Rules for every launch on the host

These rules hold on both machines; "the host" in them is whichever machine the command runs on.

**Every launch is reaped by its own hard timeout.** Nothing on the host may depend on an agent, an
ssh session or a person being alive to stop it (main, 10:20 PDT 2026-10-21, after rs/134's last
measurement condition outlived its issue: a Chrome logged in to the gate account and two ffmpegs
under `tmux -L rs134`, stopped by hand). Every long-lived process here is started as
`exec timeout --kill-after=30s <bound> <command>`, as the whole command of its own tmux session.
Every foreground measurement runs as `timeout --kill-after=30s <bound> <command>`. At the bound,
`timeout` sends SIGTERM (SIGINT for the recording, so ffmpeg finishes the file as it does on `q`),
then SIGKILL 30 s later. **Teardown (step 9) still stops everything explicitly; the timeout is the
backstop** for the teardown that never happens.

**The run bound is 9 h.** A full run is about 36,000 ticks at 0.6 s, about 6 h, and steps 3 to 7
take under an hour, so 9 h leaves about two hours of margin (i). The same 9 h bounds the run's host
reservation (below). Each run launch below begins `T=9h;`, the only place the figure appears in a
command. A rehearsal replaces it with `T=30m`. The gate account's tab and the measurement commands
carry their own short bounds, stated with each command. A bound counts from its own launch. If
SCORED's login (step 7) slips more than two hours past step 3, tear the stack down and bring it up
again before step 7.

| Launch | Run | Rehearsal or measurement |
|---|---|---|
| Page server, gateway (step 3) | `T=9h` | `T=30m` |
| Chrome, gate account's tab (steps 3 and 6) | - | `T=15m` |
| Chrome, SCORED's tab (step 7) | `T=9h` | - |
| `tab-login.ts`, the tab's login (steps 3, 6, 7) | `3m` | `3m` (it gives up by itself after 120 s) |
| The tab's logout, `logoutClean` attached to the tab (steps 6 and 8) | `3m` | `3m` (30 s to attach, `logoutClean`'s waits, 15 s to confirm) |
| rs/117's helper launcher (step 4) | `T=9h` | `T=30m` |
| Recording (step 5), SIGINT at the bound | `T=9h` | `T=30m` |
| Live view (step 5) | `T=9h` | `T=30m` |
| Gate (a)-(c), rs/96's CLI (step 6) | - | `15m` (its probe gives up after 10 min) |
| Gate (d), the sampler (step 6) | - | `10m` (a 5 min sample; the script's own limit is 7 min 10 s) |
| SIGKILL after the bound, every launch | 30 s | 30 s |
| rs/83's gate history timer read (not ours; "Gate history timer") | skipped while the reservation holds | `timeout 240`; systemd kills the unit at 270 s |

**Why `timeout` in each command, not a host-side reaper.**

- The bound is part of the command that starts the process, so nothing can be started without one,
  and there is no second thing to start, remember or cancel. A reaper such as
  `systemd-run --user --on-active=9h tmux -L run kill-server` bounds only that one tmux socket, not
  the foreground measurements or another socket. It is as easy to forget as teardown is, and a
  rehearsal's leftover timer fires into whatever runs on the same socket next. `timeout` also needs
  nothing beyond coreutils, while the host's user systemd manager reports `degraded` (m, 17:19 UTC).
- **`exec` is load-bearing.** It makes `timeout` the tmux pane's own process, heading the pane's
  foreground process group. At the bound its signal reaches the whole group: a loop's shell and the
  ffmpeg inside it, and Chrome's child processes. Teardown's `tmux kill-session` or `kill-server`
  reaches `timeout` and everything under it. Without `exec`, as in `timeout ... cmd | tee log`,
  `timeout` moves to a background process group. `tmux kill-session` then leaves it running until
  its bound, and a program in it that reads the terminal is stopped by the kernel (SIGTTIN), so
  ffmpeg would freeze on its `q` key. All three behaviours were observed with `sleep` and `cat` under
  `tmux -L rs139` (m, 17:24-17:26 UTC). So logs are written by redirection (`>>log 2>&1`), never
  `| tee`.

**Checked on the host** (m, 17:34-17:41 UTC, inside the probe-slot windows, under a `rs/139-verify`
reservation). Each command below was taken verbatim from this page with its bound cut to 60-150 s,
and nothing was stopped by hand:

- the recording, live view and gate tab (`T=60s`) were gone within 90 s of launch;
- the recording ended at 59.97 s with 1,799 frames, 0 dropped, `progress=end` and a playable file;
- the gateway and page server (`T=150s`, then `T=120s`) were gone right after their bound, with
  7780 and 8899 closed;
- the sampler, bounded at 30 s, ended at 31 s through the SDK runner's own SIGTERM cleanup.

The explicit stops still work: step 8's `q` finished a recording (17.1 s, 513 frames) and step 9's
teardown left nothing. The gate (a)-(c) command's bound was not exercised. The host's clone was
then at `85a28dc8d`, whose older `tickmanip-latency.ts` needs an attached tab and exited by itself
within 17 s. Main has since moved `~/rs-sdk` to main `ae6d5664` (rs/96's direct CLI and rs/127),
and from now on only step 0's run commit moves it (r: main via rs/103, 2026-10-21). Afterwards the leftover check showed no tmux server, no process and no reservation.

**Probe slots, while rs/96 and rs/130 measure on the run host.** Nothing is tested, rehearsed or
verified on the run host in minutes :00-:03, :15-:25, :30-:33 or :45-:55 of any hour. Use :04-:14,
:26-:29, :34-:44 and :56-:59, and fit the whole thing, bound included, inside one window (r: main via
rs/103, 2026-10-21). Run the leftover check (below) first. If anything is running that isn't yours,
leave it alone and wait. The probe slots are the run host's; the twin's day-to-day bookings are rs/147's
slot files (`docs/speedrun/rehearsals/HOST.md` on rs/147's branch, "Slots").

**Host reservation.** On each machine the reservation is the file `/home/ubuntu/host-reserved.json`:

```json
{"owner":"<issue or run>","until":"<RFC3339, UTC>","reason":"..."}
```

rs/83's gate history timer honours it on either machine ("Gate history timer", below "The host"): every firing skips
while `until` is in the future, and a reservation whose `until` has passed (owner gone) is ignored,
so a forgotten removal costs nothing and nothing needs cleaning by hand (r: main via rs/103, 10:45
PDT). The timer runs from its own clone, `~/gate/rs-sdk`, at the commit in `~/run-commit` (step 0),
never from `~/rs-sdk`. Who writes it:

- **the run**: step 0, on run night, on **both** machines, before anything else starts, with `until`
  covering setup, the 9 h run bound above and an hour's margin; the run never disables the timer
  instead. run.ts, on the chosen machine, refuses to start unless the reservation is live and the
  run's own, and removes it after SCORED's final clean logout. The machine not chosen keeps its
  reservation until the run's teardown (step 9), so its timer skips and rehearsals there stay paused
  (step 5a; on the twin, rehearsal attempts read the file at pre-flight once rs/213 lands, and rs/147
  checks it by hand until then);
- **a rehearsal**: by hand, before anything starts, with `until` = now + the rehearsal's bound
  (30 min); removed after teardown;
- **any other slot holder** (a measurement child, a probe, a check of these commands): for its slot;
  removed afterwards.

Write it (`O` is the owner, `M` the bound in minutes). It refuses if someone else holds a reservation
that has not expired:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'O=rs/NNN-rehearsal; M=30; F=$HOME/host-reserved.json; if [ -f $F ]; then U=$(sed -n "s/.*\"until\": *\"\([^\"]*\)\".*/\1/p" $F); if [ -n "$U" ] && [ $(date -d "$U" +%s) -gt $(date +%s) ] && ! grep -q "\"owner\": *\"$O\"" $F; then echo "host reserved, stop: $(cat $F)"; exit 1; fi; fi; printf "{\"owner\":\"%s\",\"until\":\"%s\",\"reason\":\"%s\"}\n" "$O" "$(date -u -d "now + $M minutes" +%Y-%m-%dT%H:%M:%SZ)" "rehearsal" >$F.tmp && mv $F.tmp $F && cat $F'
```

Remove it after teardown (only your own):

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'O=rs/NNN-rehearsal; F=$HOME/host-reserved.json; grep -q "\"owner\": *\"$O\"" $F 2>/dev/null && rm $F; cat $F 2>/dev/null || echo "no host reservation"'
```

**Credentials.** No password and no login token is ever a process argument, part of the URL Chrome
starts with, or in shell history. Chrome opens a bare `?bot=<name>` page, and `tab-login.ts` logs it
in with a one-time token over Chrome's DevTools port (cairn://p/rs/138; step 3, with a secrets check
that expects `0 0 0`). The earlier launch put the password in the tab's URL, and so in `ps`, in tmux
and in shell history (rs/130). It is gone from this runbook; never rebuild it.

`tab-login.ts` and the page server's token endpoints are on main since rs/138's merge (#120,
`96fc462a`), so every command marked **requires rs/138 on RUN_COMMIT** needs step 0's `RUN_COMMIT`
to be `96fc462a` or a descendant of it (the run-commit floor below contains it). **No real account's credentials, fleet or SCORED, go on
either machine while its `~/rs-sdk` is at an older commit** (main, 10:20 PDT): step 4 (the helpers are fleet
accounts) and step 7 (SCORED) check this first.

`RUN_COMMIT` must also include **rs/164**, which is on main as **`c2d9eada`** (#146, "Snapshot
rs/147's scored-run pieces to main"). It is byte-identical to 4e0e8ae4 on rs/147's branch (rs/164's
squash merge, PR #143), whose code is 3ed0cd49c, the commit that passed on the rehearsal twin: the
page confirmed every logout in 222-324 ms, 0 ticks of latency, and because the gateway still said
`inGame: true` afterwards, `session.ts` no longer consults it for a browser session (m, rs/164 on the
twin, account cairn_smoke, 20:44-20:52Z 2026-10-21, via rs/147). From c2d9eada on, `logoutClean`
(`speedrun/lib/session.ts`) treats `lastDamageTick < 0` as never damaged, and for a browser session
it confirms the logout through the page's own in-game flag over Chrome's DevTools port
(`speedrun/lib/tab.ts` `pageInGame`), never the gateway's `inGame` (r, c2d9eada). On an older
commit it cannot confirm a tab's logout: the gateway keeps `inGame: true` with status `stale` after
the page leaves the game, so the check waits out its timeout and reports a failure (m, rs/149 on the
rehearsal twin, via rs/147, 2026-10-21; cairn://p/rs/164). That would affect SCORED's two planned
relogs, every shortfall or restock pause, and the final logout that writes the hiscore row
(RUN-ORDER.md section 4 and R1). The run-commit floor below contains it. rs/149's `speedrun/tools/tab-logout.ts`, the interim confirm, reached rs/147's branch
(#140) but not main, since #146 did not carry it. Steps 6 and 8 therefore confirm a tab's logout with
`logoutClean` itself and the login screen in the live view.

**The run-commit floor is one commit, `4fe2d0a8`** (#209, rs/246's one idle timeout for every tick-keyed wait, on main at
04:14 UTC 2026-10-22). Step 0 checks it once: `git -C ~/rs-sdk merge-base --is-ancestor 4fe2d0a8 "$RUN_COMMIT"`.
Its history contains every earlier requirement (rs/158 in the store; here `git merge-base
--is-ancestor <commit> 4fe2d0a8` for each row), so no per-fix check is kept. What each one brings:

| Commit | PR | What the run needs from it |
|---|---|---|
| `4fe2d0a8` | #209 (rs/246) | one idle timeout, `tickClock`, in place of the total-time backstops on every tick-keyed wait under `speedrun/`: `wait.ts`, `converse`, the trade drive and `wine-receive` (`onStates` merged into one export), anvil `openBooth`, altar-room `until`, the altar-giver's turn, the altar-receiver's `runTurn` and `programs.ts` `probeInPage`. Each keeps its `maxTicks` on observed ticks; the only wall bound is `IDLE_TICKS`, 20 ticks of silence. Deadlines that are seconds by design remain (openTrade's partner response, logout and session waits, role budgets). So a slow-ticking demo no longer fires a tick-count deadline early (RUN-ORDER.md R23); it descends from 1514f47a |
| `1514f47a` | #222 (rs/268) | the Runecraft step module, from rs/196's lab-accepted module (rs/186's branch at 0c349da6): `speedrun/skills/runecraft.ts` for S06 (the air altar 1-44) and S21 (the altar 44-99; nature by default, body selectable, and the body altar is the S21 plan), its tests, the lab-accept and demo drivers, `runecraft.md` section 9 (STEP-MANIFEST.md entry 9); it descends from 148788c5 |
| `148788c5` | #221 (rs/262) | `HostGate`'s `measureDrops` default 30 to 120, with a seeded-simulation test; `fishing.ts` passes 120 explicitly on each fly band; README and `tick-manipulation.md` corrected (RUN-ORDER.md R21: the measured switch-off fired on luck at 30); it descends from 4235a9e7 |
| `4235a9e7` | #220 (rs/260) | the Mining step module, from rs/230's lab-accepted module (rs/147's branch at 59ec3933): `speedrun/skills/mining.ts` (S09, STEP-MANIFEST.md entry 4), knife-mine's `selfStarter` (S09's plain fallback at 3.62 ticks per ore, the knife-off line in force) with its success and rate fields, gated-program's `beforeRestart` and `dirs` pass-through, `programs.ts` `probeInPage(dirs)`; it descends from 8a741554 |
| `8a741554` | #212 (rs/252) | the combat step module, from rs/199's lab-accepted module: `speedrun/skills/ranged.ts` with `cannonSession` (S14, STEP-MANIFEST.md entry 26) and `combatFinish` (S27, entry 7), `speedrun/lib/cannon.ts`, `speedrun/lib/flick.ts` and `speedrun/lab/measure-ranged.ts`; `FINISH.bowFrom = 50`, the early bow switch S27's ~1,972 assumes; it descends from 0658e896 |
| `0658e896` | #200 (rs/198) | `speedrun/lib/travel.ts`, the shared walker STEP-MANIFEST.md entry 11's legs run on, with `STALL_TICKS = 20` (a walk that stalls returns `ok: false` instead of throwing), and `act.ts`'s `castTeleport` ending on a refusal with an optional `landed`; byte-identical from rs/198's f0e76192; it contains 73a6a8a3 |
| `73a6a8a3` | #210 (rs/41; a merge commit) | fleet snapshot 2: rs/41's helper code and docs (the cannon holder's serve mode, rs/189; the anvil and log-row helpers; STEP-MANIFEST.md section 4) |
| `4cc468e0` | #205 (rs/244) | `speedrun/skills/firemaking.ts` and its test, S03's module (STEP-MANIFEST.md entry 16), from rs/228's lab-gated module; it descends from 22552bf4 |
| `22552bf4` | #197 (rs/231) | `speedrun/skills/fishing.ts` (S22, STEP-MANIFEST.md entry 5), knife-cycle's `untilXp`, `followSpot` and `dropEach` declared (the net band passes them), the runtime's `hold` parameter and `ctx.starter()`, `speedrun/lib/gated-program.ts` and `xp.ts`, and `fishing.md` with rs/195's corrections |
| `23ea9f77` | #178 (rs/131) | `rc-cycle`, the scored side of the Runecraft altar hand-off as an in-page program, 7-tick tuned and 8-tick robust schedules, which S06 and S21 run on (m, lab, rs/131: 7.00 ticks per craft with the givers handled first, 8.00 robust, 30 crafts each, no lost trades; STEP-MANIFEST.md entry 9) |
| `efdbe2e2` | #164 (rs/174) | `speedrun/lib/tab.ts` `reloadOrOpenTab` closes the old page's gateway socket before a navigation, so a relog's first SDK state is at login + 1, not + 19 to + 20 (m, rs/174 on the twin against the demo, 21:58-22:08Z; RUN-ORDER.md section 4, R1, R17); the in-page relog `login(s, {inPage: true})` |
| `96fc462a` | #120 (rs/138) | step 3's Chrome login, `tab-login.ts` and the page server's token endpoints (above) |
| `c2d9eada` | #146 (rs/164) | `logoutClean` confirms a tab's logout through the page's own in-game flag (above) |
| `faae9b13` | #155 (rs/183) | the client's second-login fix the in-page relog builds on |
| `93ae0738` | #159 (rs/182) | `knife-mine`'s `stay2` bury, which today's stock row prices (RUN-ORDER.md O35) |
| `e5d8a058` | #170 (rs/207) | `knife-mine` faults instead of slipping forever when a restart lands on a depleted iron rock (RUN-ORDER.md R18) |
| `6e86a656` | #163 (rs/132) | pickpocket's stun-window actions, which S18's stun pack runs on |
| `3dfc217f` | #165 (rs/162) | knife-cycle's plain + bury, which the knife-off line in force prices (S07's gate-off bones buried in the willow band; RUN-ORDER.md O31) |
| `b6950915` | #177 | a tick program faults at start on any parameter key it does not declare, so a module built against another commit's programs stops instead of running a different program (`tick-programs.md`; STEP-MANIFEST.md entry 0) |
| `834f376b` | #176 (rs/210) | the in-run tick-cadence monitor on the scored connection: per-minute `TICKMON` rows in the run log, no behaviour change |

**Gate tooling on main, not floor items** (main: gate-script helpers, not run-client code; the floor contains both, so the run host's checkout has them): `5d22252d` (#208, rs/232's `speedrun/lib/display.ts`, the live-frame check for steps 5 and 5a) and `c4b79f17` (#213, rs/232's `speedrun/lib/tab.ts` window helpers, `screenshotTab` among them).

**Pending for the floor**, each moving it to its merge commit when it lands (rs/158 sends the commit,
and the latest one sent is the floor): rs/147's Agility snapshot (agility declares `untilLevel`; it waits on main's sign-off of four default-changing program fixes and the Agility part-2 lab; RUN-ORDER.md O40); PR #218 (rs/241's `eatAt: 'land'` for the agility program, so S17's eats cost 0, STEP-MANIFEST.md entry 1; building); rs/267's PR (`speedrun/lib/trade.ts` `openTrade` with the altar giver: the Runecraft stock rung at 9 a cycle, not 31, and a busy partner's trade retry at ~2 ticks, not ~27; STEP-MANIFEST.md entry 9); rs/276 (the tick monitor's late count against a rolling median of observed intervals, the measured period in its per-minute line, and gated-program's pause in observed ticks; it changes a run-night pass line, R23); rs/243's Thieving snapshot (pickpocket's `stopWhenFoodBelow` and `retargetTicks`, declared with a packet-fingerprint golden test; STEP-MANIFEST.md entry 6); and PR #198 (rs/198's `speedrun/runner/legs.ts`, STEP-MANIFEST.md entry 11, with its per-leg lab section of `research/run-transitions.md`). #198 and #218 have
PR numbers so far.

**Leftover check.** It lists every tmux socket on the host with its sessions, other agents' sockets
included, plus every `chrome*`, `ffmpeg`, `bun` and `timeout` process with its age, and the host
reservation. It does not count the gate history timer's processes: they run in
`rs-gate-read.service`'s own control group (none between firings) and are reaped by its 270 s bound.
It prints the timer's state on its own line instead; `gate timer read: active` means a firing is in
progress, so wait for `inactive` before a launch. Run it before any launch and after any teardown or
bound. After teardown expect `no server running` on every socket, no processes and none of your
reservations:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'for s in /tmp/tmux-$(id -u)/*; do [ -S "$s" ] && echo "tmux -L $(basename $s): $(tmux -S $s ls 2>&1 | tr "\n" " ")"; done; L=; for p in $(pgrep "^(chrome.*|ffmpeg|bun|timeout)$"); do grep -q rs-gate-read.service /proc/$p/cgroup 2>/dev/null || L="$L,$p"; done; if [ -n "$L" ]; then ps -o pid,etime,comm -p "${L#,}"; else echo "no chrome, ffmpeg, bun or timeout process outside the gate timer"; fi; echo "gate timer read: $(systemctl --user is-active rs-gate-read.service)"; cat ~/host-reserved.json 2>/dev/null || echo "no host reservation"'
```

**Twin:** rehearsals there may also leave an Xvfb (`:99`), which `tmux kill-server` does not stop
(m, rs/149; rs/147's HOST.md). Add `pgrep -a -x Xvfb` to the check there, and stop a leftover
rehearsal Xvfb with `pkill -TERM -x Xvfb` only when no rehearsal holds a slot.

## The host

Set `RS_RUN_HOST`, `RS_TWIN_HOST` and `RS_RUN_TAILNET` in your local shell from cairn://p/rs/host before running any command here; never commit them (main's rule: no host addresses on main).

Two machines (tenet 17): the run host and its twin, the same instance class, AMI and availability
zone, with identical CPU, kernel (7.0.0-1014-aws) and TCP settings (m, the host thread, 14:17 PDT
2026-10-21). Twin facts are r from rs/147's `docs/speedrun/rehearsals/HOST.md` (rs/147's branch at
715dd4fa; rs/149 built the twin) unless marked; **pending (rs/host)** marks a fact the host thread
has not yet sent from the twin's run-capable install (its window opened at 00:26Z on 2026-10-22).

| | Run host | Twin | Source |
|---|---|---|---|
| Name | **rs-ashburn-run**; instance id **pending (rs/host)** | **the twin** (rs/147's; launched 2026-10-21 12:57 PDT by rs/149) | r: the host thread, 16:12 PDT; HOST.md |
| Machine | AWS us-east-1c, c7i.2xlarge: 8 vCPU (Xeon Platinum 8488C), 16 GB, 60 GB gp3, **no GPU**, Ubuntu 24.04 | the same class on the run host's subnet: 8 vCPU (Xeon Platinum 8488C), 15 GB as read on the machine, 60 GB gp3, no GPU; the run host's AMI, Ubuntu 24.04.5 | run host r: main on cairn://p/rs/103, 08:45 and 08:53 PDT, CPU model m (`/proc/cpuinfo`); twin m, HOST.md |
| Address | addresses: cairn://p/rs/host. The run host is **rs-ashburn-run**; its public address is an Elastic IP, changed at 23:11Z on 2026-10-21, and the earlier address is released. Commands use `$RS_RUN_HOST` | an Elastic IP, so it survives a stop. Commands use `$RS_TWIN_HOST` | r: the host thread, 16:12 PDT; HOST.md |
| The engine's processing group (the address's last octet & 7; step 4) | **1**, as of 2026-10-21 | **0**, as of 2026-10-21 | m: the host thread and main, 16:25-16:33 PDT (the demo sees each machine's public address, flyio-debug `ra`). Groups change when an address changes; the current one is in cairn://p/rs/host |
| Ingress | SSH and RDP admit only the operator's address | the same: a copy of the run host's security group | r |
| Tailscale | its tailnet address (`$RS_RUN_TAILNET`) is unchanged by the address change | **not on the tailnet**: RDP goes to the public address and the live view through an ssh tunnel (step 5) | r: the host thread; HOST.md |
| SSH key, known_hosts | `~/.rs-fleet/id_ed25519_ashburn`, `known_hosts_ashburn`, on `local`, bgsrv-mac and bgsrv-ub | `~/.rs-fleet/id_ed25519_rehearsal`, `known_hosts_rehearsal`, on `local` and bgsrv-ub only: two different keys with the same file name, one made on each machine | r |
| Host key | ssh-ed25519 ...WZ0wE, unchanged by the address change | the three keys cloud-init printed to the EC2 console, pinned in `known_hosts_rehearsal` before the first connection; the ed25519 key's tail for this table **pending (rs/host)** | r: the host thread, 16:12 PDT; HOST.md |
| Desktop | XFCE served by xrdp, user `ubuntu`; `max_bpp=24`; sesman `KillDisconnected=false`, `DisconnectedTimeLimit=0`, `IdleTimeLimit=0`, so a disconnected session lives on | the same settings (m, read back by its setup script) | run host m: `/etc/xrdp/xrdp.ini` and `sesman.ini`, 16:23 UTC |
| Display | `:10` when it is the first session since boot; read it in step 2 | `:10`, 1920x1080, 24 planes, made by the operator's first connect (m, 20:17:57 UTC); a stop of the instance ends it | r, m |
| One desktop per user | a second session (another resolution, say) starts and dies at once, because `xfce4-session` cannot run twice for one user; the old session holds the only desktop. **Changing resolution means ending the session first** | the same | r: main, 09:26 PDT |
| Screen | screensaver and locker removed, `xset` no-blank at login, logind `IdleAction=ignore` | none installed, `xset` no-blank autostart, `IdleAction=ignore` | r |
| Chrome | 156.0.8078.47 at `/usr/bin/google-chrome`, software rendered (its renderers run with `--disable-gpu-compositing`) | 156.0.8078.47, held at that version (`apt-mark hold`) | m |
| Tools | ffmpeg 6.1.1; Bun 1.4.3 at `~/.bun/bin/bun`, **not on PATH** for non-login ssh commands; tmux; sysstat (`pidstat`) | the same, with tmux 3.4, sysstat 12.6.1 and Xvfb (rehearsals use it, never the run) | m |
| Checkout | `/home/ubuntu/rs-sdk`, a long-lived clone of our fork for the page server, the gateway and helper runners; only step 0 moves it | `/home/ubuntu/rs-sdk`, kept on main day to day because rehearsal attempts add worktrees from it (at 7c3e8c706 at 16:34 PDT, rs/147); on run night step 0 moves it to RUN_COMMIT under the run's reservation with no attempt worktree in use, and if the twin is not chosen it goes back to main after the run's teardown | r: main; rs/147, 16:18-16:34 PDT |
| `~/run-commit` and the gate clone `~/gate/rs-sdk` | written by step 0 only; the clone follows it | the install writes the run host's RUN_COMMIT; then only step 0: **pending (rs/host)** | r: rs/83 and the host thread, 16:13-16:36 PDT |
| Gate history timer (rs/140) | enabled, :00 and :30 | installed, **disabled until run night**; install **pending (rs/host)** | "Gate history timer", below |
| Host reservation | `/home/ubuntu/host-reserved.json` | the same path and schema; rehearsal attempts and claims stand down while it is live | r: the host thread, 16:18 PDT; HOST.md |
| Helpers' code and credentials (step 4) | rs/117's launcher from `~/rs-sdk` at RUN_COMMIT; the givers' mode-600 env files on run night only | the same, as part of the run-capable setup: **pending (rs/host)** | r: main, 16:14 PDT; the host thread, 17:03 PDT |
| Day to day | the gate timer, rs/83's probe slots; the host thread books the slots | rs/147's rehearsals under its slot files (two logins, main's exceptions aside) | r |
| Cairn | the executor `ashburn` on this machine is permanently drained: never target it | none listed in HOST.md | r: main, 08:58 PDT |

**Why rs-ashburn-run's address changed.** In 5 of 5 same-second gate pairs before the change
(21:00-23:00Z on 2026-10-21) the run host failed and the twin passed, and captures showed tick
messages held 135-218 ms in Fly's delivery path to its earlier address on every connection to the
machine, with the machine, its TCP stack and the account ruled out (m, the host thread, 15:47 PDT;
rs/83's `demo-latency.md` sections 9 and 10, 01e2ec00 on rs/83's branch). After the 23:11Z change its
first pairs read clean, tick for tick with the twin ("Measured: the route after the address change",
at the end): the hold followed the address. A gate read is therefore a dated read of a machine's
**route at the time**, not a property of the machine. The host thread will change rs-ashburn-run's
address again before run day, timed so the gate series can re-qualify the new route (rs/158,
2026-10-21); only reads taken after the last address change count (step 5a). A held route can strike
either machine, which is why both are kept run-capable and both are gated (tenet 17).

**Reaching them.** Every command below is pasted on the Mac (zsh or bash) and runs on a machine over
an exact ssh line (or `speedrun/helpers/ashburn.sh` once rs/41 merges it). **Every command on this
page is written for the run host.** From Cairn, run it in a batch on executor `local`, `bgsrv-mac`
or `bgsrv-ub`.

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'uptime'
```

The twin, from `local` or bgsrv-ub only (bgsrv-mac holds no twin key):

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_rehearsal -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_rehearsal -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_TWIN_HOST" 'uptime'
```

**The twin's form of any command** changes four strings and nothing else: the key, the known_hosts
file, the host variable, and the live view's bind address (step 5). Paste the run host's command
through this filter on the Mac and run what it prints; never run a run-host command unchanged with
the twin in mind, or the other way round:

```sh
pbpaste | sed -e 's/id_ed25519_ashburn/id_ed25519_rehearsal/g' -e 's/known_hosts_ashburn/known_hosts_rehearsal/g' -e 's/RS_RUN_HOST/RS_TWIN_HOST/g' -e 's/"[$]RS_RUN_TAILNET"/127.0.0.1/g'
```

**Names and ports**, the same on both machines except the live view:

| What | Where |
|---|---|
| tmux socket for the tab's stack (page server, gateway, Chrome, recording) | `tmux -L run` |
| Page server (`server/webclient/proxy.ts`) | port 8899 (it binds every interface; the firewall keeps it local) |
| The tab's SDK gateway (`server/gateway/gateway.ts`) | `127.0.0.1:7780` |
| rs/117's helper gateway | `127.0.0.1:7795` by default (HELPERS.md, "Helpers on the run machine") |
| Chrome profile for the run tab | `/home/ubuntu/rs-run/chrome-profile` |
| Recordings | `/home/ubuntu/recordings/` |
| Host reservation (rs/83's timer skips while it holds) | `/home/ubuntu/host-reserved.json` |
| Run commit (written only by step 0) | `/home/ubuntu/run-commit` |
| Gate history timer (rs/83): its copy, its clone, its history | `~/.local/lib/rs-gate`, `~/gate/rs-sdk`, `~/gate-history/` |
| X display of the operator's session | `:10` when it is the first session since boot; read it in step 2 |
| The operator's live view (step 5) | run host `http://$RS_RUN_TAILNET:8090/live.mjpg` on the tailnet; twin `127.0.0.1:8090` on the machine, opened through an ssh tunnel |

### Gate history timer

(r: main via rs/103, 2026-10-21; rs/140 installed it for mission rs/83, first firing 20:00Z;
`docs/speedrun/research/demo-latency.md` section 10, on rs/140's branch, PR into rs/83. The scripts
it names, `docs/speedrun/scripts/host-gate/` and `docs/speedrun/scripts/host-gate-read.sh`, are not
on main yet: they arrive with rs/83.)

**On both machines** (tenet 17). On the run host the timer has read at :00 and :30 since 20:00Z on
2026-10-21. On the twin the host thread installs the same files, a gate clone at the same
RUN_COMMIT and a throwaway read account of its own (never one of rs/147's), with the schedule
**disabled until run night**, so it never runs into a rehearsal (the host thread, 16:18 PDT; rs/147's
HOST.md, "Run-capable twin"); that install is **pending (rs/host)**. Each machine writes its own
`~/gate-history/<UTC timestamp>.json` on itself, in the format below; nothing is merged or copied
between them. Every command in this section runs on either machine in its own ssh form ("Reaching
them").

**How the start decision reads both.** From two hours before the start both timers run every 15
minutes: `install.sh --every 15` on each machine, which on the twin is also what enables it. They
fire in the same minutes, so every firing is a same-minute pair of the two paths. Until step 0's
reservations stop them, read the latest files on both machines side by side (the history command
below, once per machine). A path that holds ticks shows as a run of failed reads on one machine while
the other passes, as the run host's old address did in 5 of 5 pairs (m, the host thread, 15:47 PDT).
The history picks the start window and warns of a bad path early; the decision itself is step 5a's
fresh same-minute gate on both. A rehearsal running on the twin makes its firings skip as busy, so
rs/147 grants no attempt that would overlap that window (HOST.md).

The run-night gate's history accumulates on each machine until the scored run, without an agent. It's a systemd user timer owned by mission rs/83. `ubuntu` lingers, so the timer runs with no one logged in. The sources are in `docs/speedrun/scripts/host-gate/` and `docs/speedrun/scripts/host-gate-read.sh`. `install.sh` copies them to `~/.local/lib/rs-gate`, and the timer runs that copy.

- **What fires when.** `rs-gate-read.timer` starts `rs-gate-read.service` at :00 and :30. The host clock is UTC; the minutes are the same in PDT. Each firing (1) skips while a reservation is live; (2) skips while the host is busy: ffmpeg, bun, a tmux server that still answers, or a Chrome with its own profile, app URL, headless flag or open connection; (2b) skips without logging in, as `restart suspected`, when fewer than 300 are online: the 20:00Z firing crashed with 38 online during the afternoon's probable restart, and this skip replaces that crash (rs/140, 14:05 PDT 2026-10-21); (3) checks out the commit in `~/run-commit` (written only by the runbook's step 0), detached in its own clone `~/gate/rs-sdk`, and skips with `no run-commit` if that file is missing; (4) runs the #101 gate, `tickmanip-latency.ts gate --path=direct --no-tele`, under `timeout 240`. The account is a throwaway whose credentials exist only in `~/gate/rs-sdk/bots/gate/bot.env` (mode 600). It logs in through the direct path, not through a Chrome URL. A read takes about 3 minutes, and systemd kills the unit's whole control group at 270 s. That makes the timer compliant with the reaping rule: nothing it starts outlives its own bound.
- **History.** One file per firing, `~/gate-history/<UTC timestamp>.json`: `commit`, `status` (`ok`, `not-probed`, `timeout`, `error` or `skip`), `on`, `onTime`, `catchUpsPerMinute`, `tickP90Ms`, `players`, `edge`, `utc` and `endUtc`, and `preLogin` (`players`, `flyMachine`, `flyWorker`; the Fly machine id makes a restart visible as a changed machine; rs/140, 14:05 PDT), with the gate's own JSON under `gate`. Skips record the reason in `note`. There's one journal line per firing: `journalctl --user -u rs-gate-read`. Check the next firing with `systemctl --user list-timers rs-gate-read.timer`.
- **Every 15 minutes from two hours before the start:** `bash ~/.local/lib/rs-gate/install.sh --every 15` (`--every 30` switches back).
- **Reserving the host.** Anyone who needs the host quiet (the run script, rehearsals, a slot holder) writes `~/host-reserved.json`, e.g. `{"owner": "rs/NNN", "until": "2026-10-22T03:00:00Z", "reason": "rehearsal"}` with `until` in UTC, and removes it afterwards. While it's live every firing logs `skip: reserved by rs/NNN` and does nothing. A file whose `until` has passed is ignored. To take one read inside your own reservation: `systemctl --user set-environment RS_GATE_OWNER=rs/NNN`, then `systemctl --user start rs-gate-read.service`, then `systemctl --user unset-environment RS_GATE_OWNER`.
- **The gate account logs out after each read.** rs/96's direct gate CLI (`speedrun/lib/direct.ts`'s gate, which this timer runs) used to close its socket without logging out, leaving the account in the world until the server's no-connection timeout, so its next login (the next firing's, or step 6's tab-login after (a)-(c) on the same account) could see 'already logged in' (rs/149, relayed by rs/158, 2026-10-21). That is fixed by #142 (9d26aa87, rs/168: `DirectSession.logout`): the gate account logs out at the end of each read, once `~/run-commit` (which the timer checks out) is at or after 9d26aa87.
- **Stopping and removing.** To pause, run `systemctl --user disable --now rs-gate-read.timer`; to resume, run `bash ~/.local/lib/rs-gate/install.sh`. To remove it, run `bash ~/.local/lib/rs-gate/uninstall.sh`. That stops a read in progress and keeps `~/gate-history` and the clone.

**For the run script and rehearsals:** in step 0 or setup, write `~/host-reserved.json` covering the whole run with margin before anything else starts, rather than disabling the timer. A forgotten removal then costs nothing. The leftover check should not count the timer: between firings it has no process, and during one its processes belong to `rs-gate-read.service` (`systemctl --user status rs-gate-read.service`).

The same commands in this page's ssh form (the run host's; the twin's through the filter in "Reaching
them"). The journal, the next firing and the latest history file:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'journalctl --user -u rs-gate-read -n 20 --no-pager; systemctl --user list-timers rs-gate-read.timer --no-pager; ls -t ~/gate-history | head -1 | sed "s|^|$HOME/gate-history/|" | xargs -r cat'
```

Every 15 minutes from two hours before the start (`--every 30` switches back):

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'bash ~/.local/lib/rs-gate/install.sh --every 15'
```

One read inside your own reservation (`O` is its owner; it waits for the read, at most 270 s):

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'O=rs/NNN; systemctl --user set-environment RS_GATE_OWNER=$O && systemctl --user start rs-gate-read.service; systemctl --user unset-environment RS_GATE_OWNER; ls -t ~/gate-history | head -1'
```

Pause, resume and remove:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'systemctl --user disable --now rs-gate-read.timer'
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'bash ~/.local/lib/rs-gate/install.sh'
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'bash ~/.local/lib/rs-gate/uninstall.sh'
```

## Steps 0-5 run on both machines

On run night steps 0 to 5 run on **both** machines, each in its own ssh form ("Reaching them"), so
that either can take the run when step 5a chooses: the same RUN_COMMIT, reservation, bring-up,
opening helpers, recording and live view (tenet 17). Where a step differs on the twin, it says so
in a **Twin:** line. Step 6's gate runs on both inside step 5a; steps 7 and 8 run on the chosen
machine only; step 9 tears down both.

## 0. Prepare the checkout (once per run commit)

**On run night, step 0 starts with the run's host reservation**, before anything else on this page
starts, even when the checkout is already on `RUN_COMMIT` ("Gate history timer"; main via rs/103).
It covers the whole run with margin, and the run never disables the timer instead. `M` is the minutes
from now to the planned start plus 600 (the 9 h bound and an hour's margin). It refuses if another
owner holds a live reservation:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'O=run; M=MINUTES; case "$M" in ""|*[!0-9]*) echo "set M to whole minutes"; exit 1;; esac; F=$HOME/host-reserved.json; if [ -f $F ]; then U=$(sed -n "s/.*\"until\": *\"\([^\"]*\)\".*/\1/p" $F); if [ -n "$U" ] && [ $(date -d "$U" +%s) -gt $(date +%s) ] && ! grep -q "\"owner\": *\"$O\"" $F; then echo "host reserved, stop: $(cat $F)"; exit 1; fi; fi; printf "{\"owner\":\"%s\",\"until\":\"%s\",\"reason\":\"%s\"}\n" "$O" "$(date -u -d "now + $M minutes" +%Y-%m-%dT%H:%M:%SZ)" "scored run" >$F.tmp && mv $F.tmp $F && cat $F'
```

A firing that began before the write still finishes (within 270 s). Run the leftover check until it
prints `gate timer read: inactive` before anything below starts.

The page server needs the browser bundle, and the gateway its own dependencies; on 2026-10-21 only
the root `bun install` had been done (m). Main names the run's commit (`RUN_COMMIT`). Step 0 first
writes it to **`~/run-commit`**: one line, the full 40-hex commit. Only step 0 writes that file,
and it writes it **before** it moves `~/rs-sdk`. rs/83's gate timer reads the same file and checks
that commit out in its own clone, `~/gate/rs-sdk`. Main seeded it with `ae6d5664` (main on
2026-10-21); rs/83 and the host thread moved the file and `~/rs-sdk` to f9b5ef44 at 23:13-23:35Z
(r: the host thread, 16:13-16:36 PDT). Replace `C` with the full commit:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'C=0000000000000000000000000000000000000000; case "$C" in *[!0-9a-f]*) echo "not a commit: $C"; exit 1;; esac; [ ${#C} -eq 40 ] || { echo "need the full 40-hex commit"; exit 1; }; printf "%s\n" "$C" >$HOME/run-commit.tmp && mv $HOME/run-commit.tmp $HOME/run-commit && cat $HOME/run-commit'
```

Then put the clone on it and build:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'export PATH=$HOME/.bun/bin:$PATH; cd ~/rs-sdk && git fetch -q origin && git checkout -q --detach "$(cat $HOME/run-commit)" && bun install && (cd server/webclient && bun install && bun run build) && (cd server/gateway && bun install) && mkdir -p ~/recordings ~/rs-run/chrome-profile && git log -1 --oneline && ls server/webclient/out/bot/client.js'
```

`RUN_COMMIT` must be at or after the run-commit floor, **`4fe2d0a8`** (#209; "Credentials" lists
what it contains, rs/138's Chrome login and rs/164's tab-logout confirmation among them). One
check: `git -C ~/rs-sdk merge-base --is-ancestor 4fe2d0a8 "$RUN_COMMIT"`. A failure means the commit
predates at least one of the changes in that table.

Account files: the gate account (step 6) is a throwaway demo account whose name starts with
`cairn_`, with `~/rs-sdk/bots/<gate>/bot.env` holding `BOT_USERNAME`, `PASSWORD`,
`SERVER=rs-sdk-demo.fly.dev`, `GATEWAY_URL=ws://127.0.0.1:7780`,
`CLIENT_URL=http://127.0.0.1:8899/bot?server=rs-sdk-demo.fly.dev&gateway=ws://127.0.0.1:7780`,
`CDP_URL=http://127.0.0.1:9222` and `TELEMETRY=false` (a demo account is created on its first
login). Every env file is mode 600 (`chmod 600`): the page server refuses to log in from a file other
users can read. SCORED's env file has the same keys and mode. Its path is set on run night and
written here only as `$SCORED_ENV`. It must be `~/rs-sdk/bots/<account>/bot.env`, with the directory
named after `BOT_USERNAME` (`bots/*/` is gitignored, so it stays outside git): the page server and
the run's session.ts both read accounts from `~/rs-sdk/bots`. **It is not put on the host until
`~/rs-sdk` is at a `RUN_COMMIT` that includes #120.** Never use a fleet or helper account for the gate.
SCORED's env file goes only on the machine step 5a chooses, after the choice.

**Twin:** step 0 runs there only under the run's reservation and with no rehearsal attempt worktree
in use, since attempts add their worktrees from `~/rs-sdk`; if the twin is not chosen, `~/rs-sdk`
goes back to main after the run's teardown (rs/147's HOST.md, "Run-capable twin"). Each machine has
**its own gate account**: one account is in the world only once, and the two gates run in the same
minute (step 5a). Which throwaway the twin's step 6 uses is **pending (rs/host, with rs/147)**; it
is never one of rs/147's rehearsal accounts unless rs/147 lends it.

## 1. Preconditions: Fly edge iad, TCP connect p50 at most 5 ms

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'curl -s -o /dev/null -D - https://rs-sdk-demo.fly.dev/ | grep -i "^fly-request-id"; for i in $(seq 20); do curl -s -o /dev/null -w "%{time_connect}\n" https://rs-sdk-demo.fly.dev/; done | sort -n | awk "{ms[NR]=\$1*1000} END {printf \"TCP connect ms over %d: p50 %.1f p90 %.1f max %.1f\n\", NR, ms[int(NR/2)+1], ms[int(NR*0.9)+1], ms[NR]}"'
```

Pass: the request id ends in `-iad`, and p50 is at most 5 ms. On 2026-10-21 at 16:26 UTC, on the run
host at its old address: `-iad`, p50 1.9 ms, p90 2.6, max 2.7 over 20 (m). The twin's gate reads
showed TCP p50 1.9-2.3 ms (m, rs/149 and rs/170, 20:22-23:30Z). rs/96's gate CLI checks the same preconditions itself
before it probes (step 6), so this step is the early warning, not the record.

## 2. The operator's remote desktop

RDP is for the pre-run steps only. Connecting creates the desktop session that Chrome and the
recording live in. The operator stays connected to watch steps 2 and 3 come up, then **disconnects
before the recording starts** (step 5) and watches the live view from then on. Neither the recording
nor the run goes through RDP. Client settings (labels as in Microsoft's Windows App for macOS; check
them against the client in use):

- Resolution **1920x1080**, fixed. **Optimize for Retina displays off**, no "fit to window", no
  "update the session resolution on resize" (dynamic resolution). The first test session came up at
  3072x1728 from a Retina client and was sluggish (r: main, 09:13).
- Colour: 24-bit, or the client's highest (xrdp caps at 24).
- Connect, then leave the desktop empty and untouched: no mouse or keyboard in Chrome's window,
  nothing on top of it.
- To leave, **Disconnect** (close the window). Never **Log out** in XFCE: that ends the only desktop
  session, and with it display :10, Chrome and the recording.
- A mid-run reconnect to look at something is safe for the run, because the tab doesn't slow down.
  The recording drops frames while connected, so disconnect again as soon as possible.

**Twin:** the operator connects to `$RS_TWIN_HOST:3389`, the public address, with the same client
settings; the twin is not on the tailnet. On run night the operator holds two sessions, one per
machine, and disconnects both before step 5 starts the recordings.

After the operator connects, read which display the session is on and its geometry; it must be
1920x1080 at 24 planes. If it is not, the session predates the client settings: main ends it from
the host and the operator connects again (one desktop per user, above).

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'sudo grep "Session started successfully" /var/log/xrdp-sesman.log | tail -1; ls /tmp/.X11-unix; DISPLAY=:10 xdpyinfo | grep -E "dimensions|depth of root"; ss -tn state established "( sport = :3389 )" | tail -n +2 | wc -l | sed "s/^/RDP connections: /"'
```

The commands below use `:10`. If the log names another display, replace `:10` everywhere.

**Connected or not.** xorgxrdp's X server keeps running and drawing when the client disconnects,
and Chrome's window stays mapped, so Chrome sees no change: the page's loop rate was the same
connected and disconnected, with or without the capture (m, "Measured" below). We did not read
`document.visibilityState` directly; an unchanged loop rate is the evidence that nothing throttled.
The session survives a disconnect intact. After the operator disconnected at 16:41 UTC, display :10
stayed at 1920x1080 under the same `xfce4-session` process until 17:04 UTC. Chrome kept running and
the tab stayed in game, maximised and unobscured (m). That is why the run can leave RDP
disconnected. Tenet 11 asked for it connected; tenet 12, which supersedes it, has it disconnected.
What does not change: Chrome stays maximised and unobscured on :10 with the throttling flags.

## 3. Bring up the page server, the gateway and Chrome

Gateway and page server (the page server redirects a bare `/bot` to `?server=` the demo and
`?gateway=` the loopback gateway). Bound: `T=9h` for the run, `T=30m` for a rehearsal:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'T=9h; B=$HOME/.bun/bin/bun; tmux -L run new-session -d -s gateway -c ~/rs-sdk/server/gateway "exec timeout --kill-after=30s $T env AGENT_PORT=7780 GATEWAY_HOSTNAME=127.0.0.1 $B run gateway.ts >>$HOME/rs-run/gateway.log 2>&1"; tmux -L run new-session -d -s page -c ~/rs-sdk/server/webclient "exec timeout --kill-after=30s $T $B run proxy.ts --world=https://rs-sdk-demo.fly.dev --port=8899 --gateway=ws://127.0.0.1:7780 >>$HOME/rs-run/page.log 2>&1"; sleep 4; ss -ltn | grep -E ":(7780|8899) "; curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "http://127.0.0.1:8899/bot?bot=x"'
```

Expect both ports listening and `302 http://127.0.0.1:8899/bot?bot=x&server=rs-sdk-demo.fly.dev&gateway=ws%3A%2F%2F127.0.0.1%3A7780`.
Then check that the page server refuses a password in the URL (**requires rs/138 on RUN_COMMIT**).
Expect `400`:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:8899/bot?bot=x&password=y"'
```

**Chrome.** Chrome starts on the bare page `http://127.0.0.1:8899/bot?bot=<name>`, which carries no
secret and waits on the title screen. **Logging in is a separate command**,
`speedrun/tools/tab-login.ts`. It asks the page server for a one-time token (single use, 60 s,
loopback only, minted only for a caller that holds the env file) and navigates the tab to it over
Chrome's DevTools port. The page strips the token from its URL and exchanges it with the page server
for the credentials, which it keeps in memory only. Neither the password nor the token is ever a
process argument (speedrun/README.md, "Logging the browser tab in"; cairn://p/rs/138). Both commands
**require rs/138 on RUN_COMMIT**.

The tab. Bound: `T=15m` for the gate account's tab, here and in step 6; `T=9h` for SCORED's
(step 7):

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'T=15m; ENV=$HOME/rs-sdk/bots/GATE_ACCOUNT/bot.env; NAME=$(sed -n "s/^BOT_USERNAME=//p" "$ENV"); tmux -L run new-session -d -s chrome "exec timeout --kill-after=30s $T env DISPLAY=:10 google-chrome --user-data-dir=$HOME/rs-run/chrome-profile --remote-debugging-port=9222 --no-first-run --no-default-browser-check --password-store=basic --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --start-maximized --app=\"http://127.0.0.1:8899/bot?bot=$NAME\""'
```

The login. Bound: 3 min (`tab-login.ts` gives up by itself after `--wait-ms`, 120 s by default):

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'ENV=$HOME/rs-sdk/bots/GATE_ACCOUNT/bot.env; cd ~/rs-sdk && timeout --kill-after=30s 3m ~/.bun/bin/bun speedrun/tools/tab-login.ts "$(basename "$(dirname "$ENV")")" --bots-dir="$(dirname "$(dirname "$ENV")")"'
```

Expect `[tab-login] <name>: tab reloaded with a one-time token`, then `in game after N s`, and exit
0. A `403 ... chmod 600` means the env file's mode is too loose. **Running tab-login is the
account's login; opening the tab is not.** Why each flag:

- the three `--disable-background...` flags are tenet 12's (carried over from tenet 11): no timer, renderer or occlusion
  throttling;
- `--user-data-dir` gives the run its own Chrome. If another Chrome is already running on the default
  profile, a plain `google-chrome` only opens a window in that process and **its flags are lost**;
  a separate profile always starts a fresh browser with these flags (i: Chrome's single-instance
  behaviour per profile);
- `--app=` opens a window with no address bar. Its URL carries only the account name.
  `--start-maximized` fills the 1920x1080 session (the window measured 1920x1029 below XFCE's top
  panel, m);
- `--remote-debugging-port=9222` is how tab-login.ts navigates the one tab, and how the run's
  session.ts does on a watchdog relaunch. It needs the separate `--user-data-dir` (Chrome ignores it
  on the default profile). Anyone who can reach that port can drive the tab and read its memory, so
  keep the host single-user;
- `--password-store=basic` keeps a fresh profile from raising a keyring prompt over the tab;
  `--no-first-run --no-default-browser-check` keep the first-run dialogs away.

Check the flags and the window (expect the six flag names and a window 1920 wide). The operator,
still connected, sees the tab come up. Once this check passes, the operator **disconnects**.
Everything from step 4 on runs disconnected:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'ps -o args= -C chrome | grep -v -- --type= | grep -o -E "disable-background-timer-throttling|disable-renderer-backgrounding|disable-backgrounding-occluded-windows|start-maximized|remote-debugging-port=[0-9]*|user-data-dir=[^ ]*"; DISPLAY=:10 xwininfo -root -tree | grep "Bot Client"; tail -2 $HOME/rs-run/gateway.log'
```

Then run the secrets check (**requires rs/138 on RUN_COMMIT**). It feeds the password to grep
through a file descriptor, so it is never on a command line either. The three counts are the
processes showing the password, the processes showing a token, and the tab URLs showing either.
Expect `0 0 0`:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'ENV=$HOME/rs-sdk/bots/GATE_ACCOUNT/bot.env; echo "$(ps -efww | grep -c -F -f <(sed -n "s/^PASSWORD=//p" "$ENV")) $(ps -efww | grep -c "[t]oken=") $(curl -s http://127.0.0.1:9222/json/list | grep -c -F -e "token""=" -f <(sed -n "s/^PASSWORD=//p" "$ENV"))"'
```

Before the third grep's literal was written `"token""="`, a `2` in the middle came from the check's own command line, not a token (m, rs/149 on the rehearsal twin, via rs/147, 13:36 PDT 2026-10-21). The `2` was the remote shell plus its command-substitution subshell, both of whose command lines held the literal (m, rs/149 on the twin, 20:24 UTC).

## 4. Helpers on the run machine (rs/117)

**Where they run: on SCORED's machine, logged in before SCORED** (main's plan of record, 16:35-16:36
PDT 2026-10-21). At the gate only the **opening roster**, S06's 7 air-altar givers, is logged in, on
**each** candidate machine, so each gate is read under the opening load (main, 16:14 and 16:36
PDT). After step 5a chooses, the rest of the roster logs in on the chosen machine before SCORED, and
the other machine's 7 log out. So both machines carry the launcher at RUN_COMMIT and, on run night
only, the givers' mode-600 env files (main, 16:14 PDT; on the twin **pending (rs/host)**). The CPU
under the full roster is established before run day by the giver-load check, not at the gate
(below).

Why SCORED's machine:

- **The cue.** The altar cue (`cue.json` in `RC_CUE_DIR`) is a file on the machine that writes it,
  so a giver on the other machine cannot read SCORED's cue today (main, 16:35 PDT).
- **The path.** Each tick-exact giver is itself a reactive program on SCORED's critical path, so its
  own delivery path must be clean, and the only evidence that a path is clean is that machine's gate
  read just before the start. Co-located, one gate covers SCORED and its givers (the host thread,
  co-signed by main, 16:13-16:14 PDT). **Never bbs or a home machine** for a tick-exact role.
- **The order.** The engine visits players in 8 buckets by the client's IPv4 address, bucket = last
  octet & 7, bucket 0 first, and within a bucket in login order; a relog re-appends the player at
  its bucket's tail (r, `World.ts` playerLoop and `HashTable(8)`, main's rulings 16:25-16:43 PDT; m,
  lab, rs/131: a giver in a lower bucket was handled first whatever the login order, 7.00 ticks a
  craft, 30 of 30; one in a higher bucket after, 8.00). On the demo the address is the machine's
  public one, `fly-client-ip` (r, rs/131; the table above has each machine's bucket). One machine
  is one address and one bucket, so login order decides: **the givers log in before SCORED and never
  relog once SCORED is in.** A giver relaunched after SCORED is in comes back behind SCORED, and its
  turns run robust at 8 until SCORED's next relog: about 7 ticks for the craft lost in the cue plus
  1 per later turn of that giver, at most ~15 over S21 for one crash with 22 givers (m, lab, rs/163:
  back in the world 54-74 ticks after a SIGKILL, exactly 1 turn missed, later turns 8, 3 of 3
  repeats on the direct path; RUN-ORDER.md R12).

**Which helpers the rule binds:**

| Helper | Tick-exact? | Where |
|---|---|---|
| S06 air-altar givers (7) and S21 body-altar givers (22) | yes: the 7-tick cycle schedules their packets (R12) | SCORED's machine, before SCORED |
| Trade givers (2): the hand-offs, H4m, S18's top-ups, the wine (SUPPLIES.md) | tick-sensitive: an S18 top-up must finish by stun + 9 (R16), the wine's bank by login + 19 (R17) | SCORED's machine, before SCORED |
| S07 bone givers b01-b04 | no: SCORED's loop stops, receives and restarts, and a refused request costs SCORED 0 because the giver re-sends on the next tick (m, lab, rs/141) | SCORED's machine with the roster (rs/117's launcher, SUPPLIES.md H4.1); their machine decides no cycle, but they count in the load check |
| Cannon helper (H11, H11r, H23), carp helper, couriers, lookouts | no | bbs fleet; their machine doesn't matter |

**The lower-bucket machine is an alternative, not the plan.** Givers on a machine whose bucket is
below SCORED's would precede SCORED whatever their login time: with the dated table above, SCORED
on the run host and the givers on the twin, both machines passing the gate. It needs a
cross-machine cue (rs/196 to scope), rs/196's auto rule keyed to "handled before SCORED" rather than
login order (STEP-MANIFEST.md entry 9), and, if those givers ran the relay path, rs/225's relaunch
fix: a relay giver misses 3 turns per crash until it lands (m, lab, rs/163), against 1 on the direct
path. The table's buckets are as of 2026-10-21; a re-address supersedes them.

**Load and logins.** The chosen machine carries SCORED and ~35 helpers on the body plan (7 air, 22
body, 4 bone, 2 trade givers). The giver-load check runs every co-located helper as lite clients
beside a scored-style tab with recording; it passes at tab loop rate (d) p10 of at least 50 per
second and recording at 29 fps or more with 0 dropped (main and the host thread, 16:18-16:36 PDT).
It is **pending (rs/host, with rs/41 and rs/214)**: at the 22-giver point (00:35-00:52Z on
2026-10-22) all 22 logged in in 190 s (m, rs/214) but the tab side never started, so there is no
(d) or fps reading; the ~34-client body point is booked for 01:00-01:25Z. The ~65-client nature
point runs only if rs/194 reports 4 or more nature talismans before the run's eve (main, 17:07 PDT;
RUN-ORDER.md O41). Around 25-36 logins on one machine is fine on the swarm side: the demo's bound
is per IP and our cap is a total (main, 16:24 PDT; "~20 a machine" was an observation, not a cap).

**How.** The tick-exact helpers (the Runecraft altar givers, the trade giver, the wine giver, the S07 bone givers) run on this
machine through rs/117's launcher, `speedrun/helpers/standalone.ts`, from this same checkout, on their
own loopback gateway (7795 by default). How to configure, start and stop them is
[HELPERS.md](HELPERS.md), "Helpers on the run machine" (cairn://p/rs/117); this page doesn't repeat
it. The one ordering rule that touches this runbook: **the helpers are logged in before SCORED's tab
opens** (the launcher's `helpersReady`), because login order decides the 7- or 8-tick Runecraft
cycle. Every helper counts against the 80-login cap from its login until it logs out (step 7), and
SCORED's run login is the peak, because S21's altar givers are already in (SUPPLIES.md, "Peak
concurrent logins"). At the gate the 7 opening givers on **each** machine count, 14 in all. After a demo restart the helpers come back by relaunching rs/141's headless
lite-runner child processes (`fleet.ts`, `standalone.ts`), not tabs: the OS closes the old child's
gateway socket when it exits, so there is no gateway takeover (inferred from the code; owned by
rs/41), and the earlier lite restart measurement read 3 in-world ticks after the relogin
(`RESILIENCE.md` section 6).

**The S07 bone givers** are rs/41's four, **cairn_b01-b04**, which serve SUPPLIES.md's H4.1-H4.n
at the Woodcutting trees. They take turns, and they're a role rs/141 added to the same launcher
(rs/141's `bone-giver.ts`, rs/41's PR #135). Like the altar givers, all four **log in before SCORED
and stay in through both planned relogs** (RUN-ORDER.md section 4). The fourth is there because the
demo round trip, Falador west bank to the oak giver tile and back with a bank visit, measured
199-215 ticks running (178-193 at the willows; m, demo, rs/163), and three givers leave each only
~210 ticks a trip at one load per ~70; four leave ~280. The givers run, not walk: walking it took
321-328 ticks, which would need five (SUPPLIES.md H4.1-H4.n).

Two rules from this page apply to that launch:

- **Bound.** Whatever command HELPERS.md gives starts as the whole command of its own tmux
  session, `exec timeout --kill-after=30s $T <launcher command> >>$HOME/rs-run/helpers.log 2>&1`,
  with `T=9h` for the run and `T=30m` for a rehearsal ("Rules for every launch"), unless rs/117
  gives the launcher its own hard bound. Its clean logouts are HELPERS.md's teardown. If the bound
  fires instead, the helpers are dropped, not logged out; whether the launcher logs out on SIGTERM
  is rs/117's to say. Neither the launcher nor HELPERS.md is on this branch or on the host's
  checkout yet (m, 17:22 UTC), so this form has not been run.
- **Only once `~/rs-sdk` is at a `RUN_COMMIT` that includes #120** (rs/138, on main). The helpers are
  fleet accounts, so their credentials stay off the host before that ("Credentials").

## 5. Start the recording

The recording is captured on the VM itself, not over RDP: ffmpeg grabs the session's X display
(r: main, 09:13; rejected: recording at the Mac end over RDP). Start it **before SCORED's first
login** (step 5a's hand-over, line 6), which is before step 7, and before the gate so the gate is measured with the capture
running, as in the run. Bound: `T=9h` for the run, `T=30m` for a rehearsal. At the bound `timeout`
sends SIGINT, which ffmpeg treats like `q`: it finishes the file:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'T=9h; mkdir -p ~/recordings; rm -f ~/recordings/ffmpeg-progress.log; F=$HOME/recordings/run-$(date -u +%Y%m%dT%H%M%SZ).mkv; tmux -L run new-session -d -s rec "exec timeout -s INT --kill-after=30s $T ffmpeg -hide_banner -loglevel warning -f x11grab -draw_mouse 1 -framerate 30 -video_size 1920x1080 -i :10.0+0,0 -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -progress $HOME/recordings/ffmpeg-progress.log $F 2>>$HOME/recordings/ffmpeg.log"; sleep 5; echo $F; grep -E "^(fps|drop_frames|speed)=" ~/recordings/ffmpeg-progress.log | tail -3; df -h / | tail -1'
```

The line is main's decision (x11grab, 1920x1080, 30 fps, libx264 `-preset veryfast -crf 20`) plus
three choices made here (and the bound, above):

- **`.mkv`**: a Matroska file stays playable if ffmpeg or the machine dies mid-run, where an MP4 is
  unreadable without the index written at the end (i). Remux on the Mac if MP4 is wanted:
  `ffmpeg -i run.mkv -c copy run.mp4`.
- **`-pix_fmt yuv420p`**: from an RGB grab, x264 otherwise encodes 4:4:4, which QuickTime and most
  players and sites will not play (i).
- **`-progress`**: ffmpeg's frame, fps and drop counters, read by the gate sampler and by the checks
  below. No audio is recorded.

Size: 7.2 Mbit/s at 30 fps in game, about 3.3 GB an hour (m: 288 MB in 318 s, 16:41-16:47 UTC; i: per
hour), against 51 GB free (m, 16:15 UTC); the disk holds well over ten hours.

**The live-frame pass line** (step 5a, hand-over item 4). The fps and drop counters say the capture
is running, not what it shows. Before SCORED's login a frame of the capture must show the run tab,
with nothing in front of it; a wrong window costs the run's evidence, not ticks (RUN-ORDER.md R20).
It is a pass line of the start, beside the gate's (a)-(d): no start until it holds. rs/232's
`speedrun/lib/display.ts` helpers, `frontWindows`, `grabFrame` and `frameShows`, check it from a
script; they are on main, 5d22252d (#208), gate tooling rather than a floor item (the floor
8a741554 contains it), and the operator can also check it on the live view (below).

**Why RDP stays disconnected during the run.** With the operator connected, the capture kept real
time but wrote only about 23 distinct frames a second (2,389 of ~10,700 dropped over 6 minutes).
Disconnected, it wrote 29.9 a second with none dropped (m, "Measured"). The capture is not short of
CPU: it used under one core of eight in both cases. The likely cause is the live RDP session's
screen updates competing with the grab for the X server (i). The game is unaffected either way.
Check the recording during the run with:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'grep -E "^(frame|fps|drop_frames|dup_frames|speed|out_time)=" ~/recordings/ffmpeg-progress.log | tail -6; ls -la ~/recordings; df -h / | tail -1'
```

**The operator's live view**, started with the recording and left running until teardown. It is a
3 fps, 960x540 MJPEG stream on the tailnet address, which the operator opens in a browser at
`http://$RS_RUN_TAILNET:8090/live.mjpg` (over Tailscale, like RDP). ffmpeg's `-listen 1` serves one
viewer and exits when that viewer leaves, so it runs in a loop; a reload reconnects. It is bound to the
tailnet address only, never the public one. It is a **separate low-rate grab, not a second output of
the recording's ffmpeg**: an HTTP `-listen` output blocks its process until a viewer connects and
fails when the viewer leaves. Inside the recording's process that would hold up or end the
recording (i). As its own process, it can come and go without touching the recording file. Bound:
`T=9h` for the run, `T=30m` for a rehearsal; at the bound the signal reaches the loop's shell and
the ffmpeg inside it (`-nostdin` keeps a stray key in the pane away from ffmpeg):

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'T=9h; tmux -L run new-session -d -s live "exec timeout --kill-after=30s $T bash -c \"while true; do ffmpeg -nostdin -hide_banner -loglevel warning -f x11grab -draw_mouse 1 -framerate 3 -video_size 1920x1080 -i :10.0+0,0 -vf scale=960:540 -c:v mjpeg -q:v 8 -f mpjpeg -listen 1 http://'"$RS_RUN_TAILNET"':8090/live.mjpg; sleep 1; done\""'
```

It costs 3.7% of one core (m: `pidstat` over 40 s, 16:53 UTC, ~150 kbit/s), and the recording
beside it still wrote 29.7 fps with no drops (m: 70 s, 16:54 UTC). It was tested with `curl` on the
host (217 frames in 72 s); nobody has opened it in the operator's browser yet. Teardown stops it with
the rest of the stack (or `tmux -L run kill-session -t live` on its own).

**Twin:** there is no tailnet address to bind, so the live view binds `127.0.0.1:8090` (the filter in
"Reaching them" makes that change), and the operator opens it through an ssh tunnel from the Mac,
`ssh -N -L 8091:127.0.0.1:8090` with the twin's ssh options to `ubuntu@"$RS_TWIN_HOST"`, then
`http://127.0.0.1:8091/live.mjpg` (local port 8091 so it can sit beside the run host's view). On the
twin `curl` received 23 JPEG parts in 6 s from it (m, rs/149, 20:32 UTC; HOST.md, which tunnels to
local port 8090). The tunnel is one ssh session: if it drops, the view stops and the recording on
the machine does not (i). The twin's recording beside its gate tab wrote 29.91 fps with 0 dropped
(m, rs/149, read 5).

## 5a. Choose the machine: the gate on both

SCORED's machine is chosen by the gate immediately before the start, not named in advance (tenet
17). Both machines have been through steps 0-5: reserved, on RUN_COMMIT, the tab stack up, the
opening roster (S06's 7 air-altar givers) logged in on each (step 4), the recording and the live view
running, RDP disconnected. **Rehearsals are paused on both machines** from the start of the gate series on run day until the
scored run's teardown, meaning SCORED's hiscore row has landed at its final logout and the recording
is stopped (main, 19:00 PDT 2026-10-21; tenet 17). Rehearsal logins and their helpers count against
the same 100-per-address ban line and 80 working cap as the run's own roster, which peaks near 72
under the nature plan, and a ban costs the run. rs/147 grants no attempt that would still run when
the gate series starts, and an attempt in flight logs out at its next step boundary when the
reservation appears (rs/147's HOST.md, to match main's ruling).

1. **Gate both in the same minute.** Run step 6 on both machines at once: the quiesce check, then
   (a)-(c) started in the same minute on both (rs/96's CLI, the same flags), then (d) on both, each
   on its own gate account. Same-minute reads compare the two delivery paths on one server minute: on
   2026-10-21 the server's own tick distribution was the same on both machines to the millisecond
   while one address's path held ticks (m, the host thread's pairs, 21:00-23:00Z). If they cannot
   overlap (one ssh line down, say), run them back to back, the run host first, and record that they
   did not share a minute. **Only reads taken after a machine's last address change count**, here
   and in the gate history: a read is a dated read of that machine's route at the time ("The host").
2. **Choose.**
   - **One passes:** start on it.
   - **Both pass:** start on **the run host**, the default: its route read clean after its 23:11Z
     address change ("Measured: the route after the address change"; re-qualified after any later
     change), and the run host stays preferred by its documentation
     (main, 15:54 PDT; under tenet 17 that is only a default). **The tiebreak:** start on the twin
     instead only when its read is clearly better in that minute, meaning the run host passed at the
     margin ((a) 58 or 59 of 60, or (c) exactly 2 catch-ups a minute, or a (d) sample under 60 loops
     a second) while the twin read (a) 60 of 60 and (c) at most 1.
   - **Neither passes:** no start. RUN-ORDER.md section 1's rule applies to both: the knife stays
     off on a failed gate, and the start waits for a passing read (re-measure both; the gate history
     on both shows when).
3. **Record both reads**: for each machine the minute, (a) on-time of 60, (b) p90, (c) catch-ups a
   minute, (d) lowest / median / highest p10 and the players online, with the choice and the reason,
   in the run's record and, after the run, in "Measured" below. Each machine keeps its own outputs
   (`~/rs-run/gate-loops.jsonl` and the CLI's output) until teardown.
4. **On the chosen machine:** the rest of the roster logs in through rs/117's launcher before SCORED
   (22 body-altar, 4 bone and 2 trade givers; 22 logins took 190 s through the launcher's limiter, m,
   rs/214 on the run host, 00:35-00:39Z on 2026-10-22), then step 7's login count, then SCORED.
5. **On the other machine,** before SCORED's first login: its 7 opening givers log out cleanly
   (HELPERS.md teardown) and its tab stack and recording stop (step 9's commands there). Its
   reservation stays live and rehearsals there stay paused until the run's teardown (above). **The
   only logins allowed on it until then are gate probes**, and only when the gate script needs them
   off the recorded display (line 6).
6. **Hand over from the gate to the run, on the chosen machine** (main's recording rule, 18:16 PDT
   2026-10-21, after cairn_casts' rehearsal recorded the gate account's tab instead of the attempt
   because the gate tab stayed on top of the recorded display; rs/147):
   1. the gate probe tab is **logged out and closed** before the run tab opens (step 6's
      logout-before-Chrome-stops command does both);
   2. the run tab is the **only browser window on the recorded display**: `DISPLAY=:10 xwininfo
      -root -tree` lists one `Bot Client` window (step 3's check);
   3. the recording is **already running before the run tab's login** (step 5);
   4. **a live frame of the capture shows the run tab** (step 5's pass line): the live view, a grab of
      the same display, shows SCORED's tab before step 7's tab-login. This is a pass line of the gate, beside tenet
      12's (a)-(d): no start until it holds. A wrong window costs the run's evidence, not ticks
      (RUN-ORDER.md R20);
   5. any later probe runs on **the other machine**, never on the recorded display.

**No second gate mid-run.** SCORED's logged-in ticks keep counting and the recording, the live view
and the helpers are on the chosen machine, so the run never stops to re-measure or to change
machine. The held-tick monitor (step 7) is how a path going bad mid-run would be seen. The evidence
so far: the hold of 2026-10-21 was a persistent property of one address over about 5 hours; no path
has yet been seen going bad mid-run (the host thread, 16:15 PDT).

## 6. Quiesce check and the gate

**Quiesce.** Nothing runs on the machine but the session's desktop, the `run` tmux stack (gateway,
page server, Chrome, recording), rs/117's launcher with its lite runners and roles, and system
daemons. The `run` stack includes the live view (step 5). On the twin, no rehearsal process, slot
file or Xvfb either (the leftover check, "Twin:"). The drained Cairn executor's daemon (`cairn-exec`) was idle at 0.3% of a core (m, 16:15
UTC); whether it stays up during the run is main's call. No second Chrome, no other `bun`, no other
ffmpeg, and no tmux server but `run` (the leftover check, "Rules for every launch", lists them all).
The gate history timer is quiet: step 0's reservation makes every firing skip, so no
`rs-gate-read.service` process should appear here.

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'uptime; ls /tmp/tmux-$(id -u)/; ps -eo pid,pcpu,etime,args --sort=-pcpu | cut -c1-160 | head -20; pgrep -c -f "chrome --type=gpu-process" | sed "s/^/Chrome GPU processes (expect 1): /"'
```

**The gate** is measured on **each** candidate machine inside step 5a, right before the run, at the
real player count, and **on a gate account, never SCORED**, each machine its own (step 0): SCORED's
playtime starts at its first login, which is step 7. The opening roster is logged in on the machine
being gated (step 4).
Measure it in the run's configuration: RDP disconnected, with the recording and the live view running.
The conditions and what to do on a failure are in RUN-ORDER.md section 1 and tenet 12.

- **(a)-(c)**, next-tick reactions, tick publication p90 and catch-ups: rs/96's direct-path CLI,
  `docs/speedrun/scripts/tickmanip-latency.ts <gate account> --path=direct --no-tele`
  (cairn://p/rs/96, PR #101; its procedure and verdict are in `skills/tick-manipulation.md`, "Run-time
  host gate"). It logs the gate account in itself, in-process, so run it **before** the gate account's
  tab opens, with the tab closed. Fixed by #142 (9d26aa87): it logs the account out at the end of the
  read, so (d)'s tab-login of the same account no longer sees 'already logged in', once `RUN_COMMIT`
  is at or after 9d26aa87 ("Gate history timer"). Bound: 15 min (its probe gives up
  after 10):

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'cd ~/rs-sdk && timeout --kill-after=30s 15m ~/.bun/bin/bun docs/speedrun/scripts/tickmanip-latency.ts GATE_ACCOUNT --path=direct --no-tele'
```

- **(d)**, the tab's loop rate: open the gate account's tab and log it in (step 3's Chrome and
  tab-login commands with the gate account's env file), let it reach the game, then sample for five minutes with
  `docs/speedrun/scripts/runhost-loops.ts`. It attaches to the tab through the loopback gateway, runs
  the in-page probe (the page publishes `loops` only while a program runs), and every 10 s prints the
  page's loop rate beside each process's CPU and ffmpeg's frame counters. **Before Chrome is stopped,
  the gate account's tab is logged out** with `logoutClean`, so the account doesn't linger in the
  world. The command below attaches to the running tab through the gateway (`openSession` with
  `client: 'browser'`, which does not relaunch it) and calls `logoutClean`, the same call a run
  script makes. With `RUN_COMMIT` at or after `c2d9eada` that call confirms the logout from the
  page's own in-game flag over Chrome's DevTools port, so it is trustworthy from the tab
  ("Credentials"). It exits 0 once the page is out of game and 1 when it isn't confirmed, and the
  command stops Chrome only on 0. It also exits 1 when the tab is already out, because there is no
  advancing tick to attach to. Then check in the live view that the tab shows the login screen.
  This attach-and-logout command is new with c2d9eada and has not yet run on the twin, where
  rs/149's tab-logout.ts did this job (not on main, "Credentials"). Bounds: the tab `T=15m`
  (step 3's command), the sampler 10 min, the logout 3 min. **Never kill the tab while the
  account is in game.** If the ssh line dies or the logout isn't confirmed, look at the live view and
  re-run the logout part of the command until it shows the login screen. Only then close the tab
  with `kill-session`. The tab's own bound is the last resort: it closes the tab at `T=15m` and
  leaves the account to the server's no-connection timeout.

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'cd ~/rs-sdk && timeout --kill-after=30s 10m ~/.bun/bin/bun docs/speedrun/scripts/runhost-loops.ts GATE_ACCOUNT --label=gate --minutes=5 --display=:10 --out=$HOME/rs-run/gate-loops.jsonl 2>&1 | grep -v -E "^\[(Runner|BotSDK)\]|Pathfinding|LOGOUT DEBUG"; B=GATE_ACCOUNT timeout --kill-after=30s 3m ~/.bun/bin/bun -e "const m = await import(\"./speedrun/lib/session.ts\"); const s = await m.openSession(process.env.B, { client: \"browser\", pathfinding: false, readyTimeoutMs: 30000 }); const r = await m.logoutClean(s); console.log(r.ok ? \"logged out; the page is out of game\" : \"not confirmed: \" + r.reason); await m.closeSession(s); process.exit(r.ok ? 0 : 1);" && tmux -L run kill-session -t chrome'
```

Read (d) from the summary line's `loops p10` (lowest / median / highest 10-second sample). **Pass**:
the lowest sample is at least 50 per second. **Marginal**: the median is at least 50 but a sample
fell below: re-measure. **Fail**: the median is below 50. On 2026-10-21 every sample in every
condition was 70-73 (m, below). During the run, the page keeps publishing `loops` while SCORED's
programs run, which is what the in-run monitor reads.

## 7. SCORED's tab: the run's first login

**Only once `RUN_COMMIT` includes #120** (rs/138, on main since `96fc462a`; "Credentials").

**The login cap, a pre-start condition** (cairn://p/rs/tenets/16, approved 17:43 PDT; main's working
cap). Before SCORED logs in, count our simultaneous demo logins **summed across both Ashburn machines
and every other host**: rs/117's launcher on the chosen machine (its `helpersReady` roster); on the
other machine, anything still logged in, which should be nothing once its 7 opening givers are out,
its rehearsals paused and its timer skipping under the reservation, and any rehearsal account there
that did not log out counts; the bbs fleet (rs/41 reports its count to the operator; no command on
this page reads it); the ambassador's host (rs/58); and any other host with one of our accounts in
the world. With SCORED's 1 the total must be **at most 80**, the working cap: 100 simultaneous
connections per IP is the server operator's ban threshold, and spreading accounts across IPs to
evade it is what gets accounts banned. The gate minute holds the 7 opening givers and a gate
account on each machine, 16 on the two (step 5a). **Fleet accounts not needed during the run are logged out**
before the count; gathering is finished by run day. The gate account is already out (step 6).
SUPPLIES.md, "Peak concurrent logins", has the count by run phase: on the body-altar plan (22 givers,
rs/163) the start is ~90 with the gathering fleet's ~53 in and 37 without it, so **logging the
unneeded fleet out first is mandatory**. S21's givers log in before SCORED, on the chosen machine
(step 4; RUN-ORDER.md O38, settled). Do not log SCORED in over the cap.

**The gate's Chrome is gone before SCORED's tab opens.** After an unconfirmed gate logout the gate
tab's Chrome can still be running on the run profile; SCORED's `--app` window then joins that
process (the same `--user-data-dir`) and dies with it at the gate tab's `T=15m` bound (rs/232's
read-only check against main's 18:16 PDT recording rule, via rs/147). So the `chrome` session must be
gone from the `run` socket and no process may hold `rs-run/chrome-profile` (the bracket keeps the
check's own shell, whose command line holds the pattern, out of `pgrep`'s match, as with step 3's
`"token""="`). Expect `ok`:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'if tmux -L run has-session -t chrome 2>/dev/null; then echo "chrome session still up"; elif pgrep -af "rs-run/chrome-[p]rofile"; then echo "Chrome still holds the run profile"; else echo ok; fi'
```

If either is left, log the gate tab out and stop it (step 6's logout-before-Chrome-stops command),
then check again. Never open SCORED's tab beside it.

On the chosen machine, with the machine chosen (step 5a), the full roster in (step 4), the
recording running (step 5), the gate's Chrome gone and the login count at or under 80, put
`$SCORED_ENV` on it (step 0) and launch Chrome as in step 3 with `ENV=$SCORED_ENV` and `T=9h`.
Repeat step 3's window check for SCORED's window: exactly one `Bot Client` window on `:10`, 1920
wide (step 3 measured 1920x1029 below XFCE's top panel). Expect one line:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'DISPLAY=:10 xwininfo -root -tree | grep "Bot Client"'
```

Then log it in with step 3's tab-login
command, with the same `ENV`; it exits 0 once SCORED is in game. run.ts checks that step 0's host
reservation is live and the run's own, and refuses to start otherwise. From here the run scripts drive the tab through the gateway on
7780 (RUN-ORDER.md, STEP-MANIFEST.md). Nobody touches the window. Relaunches during the run go the
same way: session.ts mints a fresh token from `CLIENT_URL` and re-navigates the tab over
`CDP_URL`. The run's relogs use `login(session, {inPage: true})`, with this navigation as the fallback.
With rs/174's fix on `RUN_COMMIT` either path costs ~2 ticks on SCORED's clock (first SDK state at
login + 1; m, rs/174 on the twin against the demo); without it a navigated relog passes ~19-20
ticks before the bot layer sees state (m, rs/164 and rs/174; RUN-ORDER.md section 4).

**Watching SCORED's own tick stream during the run** (rs/210, on main as #176, 834f376b, inside the
run-commit floor). The start gate reads each candidate's path once. During the run, the step runner
(`runSteps` or `runResumable`) runs a passive tick-cadence monitor on SCORED's connection from its
first in-world tick. It acts on nothing. Once a minute it appends a `kind: "tickmon"` row to the run
log (`speedrun/runs/<runId>.jsonl`) and prints the same line, tagged `TICKMON`, on the run's stdout:

```
TICKMON minute=12 at=2026-10-22T01:12:00Z secs=60 ticks=200 glued=0 late=0 p50=0 p90=2 max=7 gaps=0 lateMs=120
```

Read it on the chosen machine with `grep -o 'TICKMON[^"]*' ~/rs-sdk/speedrun/runs/<runId>.jsonl | tail -5`
(or follow the run's stdout).

- `ticks`: tick arrivals in the minute, 200 at the demo's 300 ms (`fly.toml:26`, `NODE_TICKRATE=300`).
  Fewer means the tab stopped publishing for part of the minute: a relog, or a stall the watchdog
  will see.
- `glued`: arrivals under 5 ms after the previous one. These are ticks held on the path and
  released together.
- `late`: arrivals more than `lateMs` (120 ms) after the tick's expected point on the cadence. The
  cadence follows each on-time arrival, so slow clock drift does not count. A tick glued behind a
  held one is not counted twice. A lasting shift of the cadence (a server stall beyond the engine's
  two-tick catch-up) costs two late ticks, after which the cadence follows the shift.
- `p50`/`p90`/`max`: each arrival's offset from its expected point, in ms.
- `gaps`: the tick counter went back (a relog) or jumped more than 17 ticks; the cadence restarts
  there.

Times come from the loopback gateway's receipt of the tab's publication, so this is the tab's tick
stream as the run scripts see it.

What to expect (m, bgsrv-mac, local engine at `NODE_TICKRATE=300`, rs/210): a clean path reads
`glued=0 late=0` with p90 at most 3 ms and max at most 21 ms in every minute (5 minutes, 1,000
ticks). With a proxy holding 8% of server-to-client chunks for 150-350 ms, it read late 16-22 and
glued 2-12 per minute (86 late and 26 glued over 1,000 ticks). On 2026-10-21 the run host's old
address took 5-13% of ticks late (rs/83), which is 10-26 late per minute at the run's 200 ticks a
minute (i).

It is a reading, not a gate: nothing stops on it. A run of minutes with double-digit `late` on
SCORED means the path went bad mid-run; tell main (and rs/158 for the record). `SPEEDRUN_TICKMON=off`
in the run's environment turns it off, and `SPEEDRUN_TICKMON_LATE_MS` changes the threshold.

## 8. Stop the recording and pull it

On the chosen machine (in its ssh form). The recording holds the run only if step 5a's hand-over
(line 6) passed: the run tab alone on the recorded display. After SCORED's final clean logout (the run script's `logoutClean`), and only once that logout is
confirmed, stop ffmpeg with `q`, so it finishes the file, and check what it wrote. The final logout
is what writes SCORED's hiscore row (RUN-ORDER.md section 4, "Final logout"). With `RUN_COMMIT` at
or after `c2d9eada` ("Credentials"), `logoutClean` confirms the logout from the page's own in-game
flag, so its own result is trustworthy from the tab. The confirmation is both of these: the run
script's final `logoutClean` result reads `ok: true` with `confirmedBy: 'page'`, and the live view
shows the login screen. If the result is not `ok`, or the live view still shows SCORED in game, log
SCORED out with step 6's attach-and-logout command on SCORED's account (below). It calls the same
`logoutClean` and exits 0 once the page is out of game. **Never kill the tab while SCORED is in
game.** `ENV` is `$SCORED_ENV`, as in step 7. Bound: 3 min. Its error messages can carry the
account's name, so keep its output out of chat and logs:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'ENV=SCORED_ENV; cd ~/rs-sdk && B="$(basename "$(dirname "$ENV")")" timeout --kill-after=30s 3m ~/.bun/bin/bun -e "const m = await import(\"./speedrun/lib/session.ts\"); const s = await m.openSession(process.env.B, { client: \"browser\", pathfinding: false, readyTimeoutMs: 30000 }); const r = await m.logoutClean(s); console.log(r.ok ? \"logged out; the page is out of game\" : \"not confirmed: \" + r.reason); await m.closeSession(s); process.exit(r.ok ? 0 : 1);"'
```

Expect `logged out; the page is out of game`, and exit 0. On exit 1 (`not confirmed`, or no
advancing tick to attach to, which is also what a tab already out of game gives), look at the tab in
the live view. Stop nothing until it shows the login screen. Then stop the recording:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'tmux -L run send-keys -t rec q; sleep 5; tmux -L run has-session -t rec 2>/dev/null && echo "ffmpeg still running"; for f in ~/recordings/run-*.mkv; do ffprobe -v error -show_entries format=duration,size:stream=width,height,pix_fmt -of compact "$f"; done; grep -E "^(frame|drop_frames)=" ~/recordings/ffmpeg-progress.log | tail -2'
```

Pull it to the Mac (or with `ashburn.sh` once rs/41 merges it), and check the copy plays before
anything on the host is deleted:

```sh
mkdir -p ~/Movies/rs-run && scp -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST":'recordings/run-*.mkv' ~/Movies/rs-run/ && ls -la ~/Movies/rs-run/
```

## 9. Teardown

On both machines: the chosen one after step 8, the other right after step 5a's choice for its
opening givers and tab stack (its reservation stays until the run is over). Teardown stops
everything explicitly; the bounds are only the backstop. Stop rs/117's helpers as
HELPERS.md says (clean logouts first). Then stop the tab's stack. The recording must already be
stopped (step 8), since killing tmux under ffmpeg cuts the file short:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'tmux -L run has-session -t rec 2>/dev/null && { echo "recording still running: stop it first (step 8)"; exit 1; }; tmux -L run kill-server; sleep 2; ls /tmp/tmux-$(id -u)/; pgrep -a -f "[p]roxy.ts|[g]ateway.ts|rs-run/[c]hrome-profile" || echo "tab stack stopped"'
```

The brackets keep the pattern from matching the ssh command's own shell, whose command line contains
it. Without them the check always found that shell and never printed `tab stack stopped` (m, 17:37
UTC).

Then run the leftover check ("Rules for every launch"). After a rehearsal, remove its host
reservation; after the run, run.ts removes the run's on the chosen machine, and the operator removes
the run's reservation on the other machine with the removal command (`O=run`), after which rehearsals
there may resume. On the twin, if it was not chosen, `~/rs-sdk` then goes back to main for the
attempts (step 0, "Twin:"). The session itself stays: nobody logs out of
XFCE. The recording stays on the host until its copy on the Mac is checked.

## Measured: gate (d) on this host, 2026-10-21, before the address change

**Taken before the run host's address change on 2026-10-21 23:11Z** ("The host"), so
these figures do not stand for the new address until gate (d) is measured there.

**How it was taken.** On this host (c7i.2xlarge, 8 vCPU, no GPU), 16:28-16:52 UTC (09:28-09:52
PDT), with the demo at about 1,690-1,700 online (the page's footer, m). Chrome 156.0.8078.47 was
launched with step 3's throttling flags and profile, in an earlier launch form (before the bounds
and rs/138's token login): its own profile, the three throttling flags, a maximised app window of
1920x1029 in the operator's xrdp session (display :10, 1920x1080, 24 planes). The page server and
gateway ran from the clone at main `85a28dc8d`. The tab was logged in as a throwaway `cairn_` demo
account standing in Lumbridge and running the in-page probe (one walk to a neighbouring tile and back
per tick), which makes the page publish its loop rate. The operator's macOS client was connected for
conditions 1 and 2 and disconnected at 16:41:18 UTC for 3 and 4; the session lived on. The capture
was step 5's ffmpeg line, a fresh file per condition. Each condition was one run of
`runhost-loops.ts`: 30 samples, 10 s apart. CPU is the change in each process's utime+stime in
`/proc/<pid>/stat` over each 10 s, as a percentage of one core. `pidstat -u` agreed: 67.5% for
ffmpeg against the sampler's 64-94% in condition 2, and 94.2% against 93-97% in condition 3.

| Condition (UTC) | Loop p10, lowest / median / highest sample (loops/s) | Run min | ffmpeg | Chrome tab renderer | Chrome GPU process | Chrome total | Xorg | xrdp | Page server, gateway | Host busy (8 vCPU), load | Recording |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1. RDP connected, capture off (16:28-16:33) | **70.8 / 72.2 / 73.0** | 68.0 | - | 53 | 18 | 72 | 9 | 4 | 0, 0.3 | 11%, 0.7 | - |
| 2. RDP connected, capture on (16:34-16:39) | **71.0 / 72.3 / 73.1** | 64.6 | 75 | 56 | 17 | 73 | 11 | 5 | 0, 0.3 | 21%, 2.1 | ~23 fps, 2,389 dropped in 6 min |
| 3. RDP disconnected, capture on (16:41-16:47) | **70.6 / 72.4 / 73.3** | 66.6 | 95 | 63 | 24 | 87 | 15 | 0 | 0, 0.3 | 25%, 2.0 | 29.9 fps, 0 dropped |
| 4. RDP disconnected, capture off (16:47-16:52) | **71.0 / 72.2 / 73.1** | 66.0 | - | 58 | 22 | 80 | 11 | 0 | 0, 0.3 | 12%, 1.0 | - |

All m. CPU columns are medians of the 30 samples, in percent of one core. "Run min" is the
slowest single tick interval's loop rate in the condition.

**Verdict: gate (d) passes on this host in every condition, with margin.** The lowest 10-second p10 in
120 samples was 70.6 loops/s, about 40% above the ~50 threshold. Software rendering at 1920x1080
costs the tab and Chrome's GPU process together about 0.7-0.9 of a core. The run's configuration
(RDP disconnected, capture on) is row 3, plus the live view's 3.7% of a core. The capture costs 0.95
of a core disconnected and 0.75 connected, about 10-12% of the machine. The busiest sample of the whole window had the host 27%
busy. A larger instance is not needed for (d) (i).

Not part of (d): the probe found about 17% of walk trials late and about 11 catch-ups a minute in
every condition alike (for example 130 late of 770 and 57 catch-ups in condition 1; frame p90
460-490 ms). Neither RDP nor the capture changed these, so the demo was overrunning during the
window (i). Gates (a) and (c) would not have passed then; rs/96's gate exists for exactly this.

A dry run at 16:21 UTC on the session's earlier 3072x1728 geometry (disconnected; capture of the
top-left 1920x1080) had Chrome at about 1.45 cores and ffmpeg at 1.7, against 0.8 and 0.95 here.
The scene differed, so it is not a clean comparison, but it agrees with fixing the session at
1920x1080 (m for the figures, i for the reading).

### Corroborating: the rehearsal twin's gate read of record (not this host)

Taken on **rs/147's twin** of this host, with the same
AMI, instance type and subnet, **not on this host**. It is the first full pass in the run-night
configuration: RDP disconnected, recording on, xrdp display :10, throwaway account cairn_twin
(m, 2026-10-21 20:22-20:29 UTC; rs/149, `docs/speedrun/rehearsals/HOST.md` on rs/147's branch,
via rs/147, 13:46 PDT).

| Gate condition | Twin, 20:22-20:29 UTC |
|---|---|
| (a) direct reactions | 60/60 |
| (c) catch-ups | 0 a minute |
| (b) tick p90 | 377 ms (context, not a pass line) |
| (d) tab loop p10, lowest / median / highest sample | 70.8 / 72.0 / 72.9 |
| In-page probe (`probeInPage`) | 60/60 |
| Recording | 29.9 fps, 0 dropped |
| Host | ~32% busy |
| Online | 1,589 |

All m. It shows that the run-night configuration passes all four conditions on the twin in a calm
minute. Under tenet 17 the twin is a run candidate, so this is its own baseline; it replaces neither
machine's gate read before the start (step 5a) nor the gate history on either (tenet 13 kept the
twin for rehearsals only; tenet 17 narrowed it).

## Measured: the route after the address change

Dated reads of each machine's route at the time; only reads after the last address change count for
the start (step 5a).

(a) on-time of 60 and (c) catch-ups a minute from rs/96's direct CLI, the same flags on both
machines, read in the same second (the run host's timer read against a twin read started at the
same second; m, as cited).

| UTC (2026-10-21/22) | rs-ashburn-run's route | Run host (a), (c), p90 | Twin (a), (c), p90 | Online | Source |
|---|---|---|---|---|---|
| 21:00, 21:30, 22:00, 22:30, 23:00 (five pairs) | before the 23:11Z address change | 51-58 of 60, 4.98-15.0 a minute: **fail in all five** | 59-60 of 60, 0-1 a minute: **pass in all five** | 1,502-1,627 | m: the host thread, 15:47 and 16:12 PDT; rs/83 |
| 23:30 | first pair after the change | 60, 1.0, 382.5 ms: **pass** | 60, 1.0, 382.7 ms: **pass** | 1,545 | m: the host thread, 16:33 PDT: aligned tick by tick, 0 ticks late by more than 40 ms, 0 glued, against 18 late and 7 glued at 23:00 |
| 00:00 | after the change | 60, 1.0, 388.6 ms: **pass** | 60, 1.0, 388.0 ms: **pass** | 1,670 | m: the host thread, 17:03 PDT: aligned to 0.4 ms, 0 late or glued |
| 00:30 (unpaired: the twin was in a rehearsal) | after the change | 60, 0, 515 ms: **pass** on (a) and (c) | - | 1,731 | m: rs/83, 17:33 PDT |
| Gate (d) after the change, either machine with the opening roster | after the change | **pending** (no (d) read since the move; the giver-load check's tab side is the next one, rs/host) | **pending** | | |
| rs/170's raw pair files (`tickArrivalsMs`) | | | `docs/speedrun/rehearsals/twin-pairs/` on `agent/rs-170-builder-0` (rs/170 is closed): **pending** their merge, for a tick-by-tick table here | | |

The raw arrivals of every pair are kept on the run host (`~/host-captures`) and on bgsrv-mac
(`~/hostpair`) by the host thread. Two clean pairs and one clean single read at the new address make
the route "consistent with fixed"; the series continues on both timers (rs/83, 16:32 PDT), and starts
again after the next address change.

## Measured: the demo's tick period, 2026-10-22

**The demo ran at 0.34-0.37 s a tick** around 03:4xZ on 2026-10-22: rs/210's tick monitor (step 7's
`TICKMON` rows) read 161-177 ticks a minute against 200 at 300 ms, during rs/269's S03 demo run
(m, a demo observation, dated; RUN-ORDER.md R23). The score is in ticks, so a slow tick costs
nothing itself; what it exposes is any cue or deadline timed in wall clock, which lands early (an
S03 launch at T0 + 75 x 300 ms cost ~18 ticks). Until rs/276 lands, `tick-monitor.ts` anchors its
expected tick times on the nominal 300 ms, so on a slow demo it counts every tick as late: read its
late count beside the ticks-per-minute figure, not as a route alarm on its own.
