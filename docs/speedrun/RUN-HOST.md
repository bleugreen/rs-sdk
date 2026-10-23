# Run hosts: the two Ashburn machines, step by step

The scored run is played first person in our fork's browser webclient, in a visible Chrome tab on
one of **two run-capable machines in Ashburn: the run host, rs-ashburn-run, and its twin**
(addresses: cairn://p/rs/host). Both are kept with the same RUN_COMMIT, gate history timer, claim
lock, recording and live-view setup, and the run starts on whichever passes the gate
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

RDP is used only before the run: to create the desktop session at the right geometry and check it
by eye (step 2). It is disconnected before step 3's `run-gate.ts up`, which refuses while a remote
desktop connection is up; from then on the operator watches the live view. With RDP disconnected the tab runs exactly as fast as with it connected, and the
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

**Every launch for SCORED or a rehearsal account is dry-run first** (main's rule, 13:4x PDT
2026-10-22, after a rehearsal attempt's launch died on an unquoted lap string that the shell split at
`;`, and its account stood about 280 ticks idle; rs/147, rs/439). The dry run is the launch's exact
command **on its exact host, in the same shell with the same quoting, with no login, immediately
before the real launch**, and its output goes in the run's record beside the gate lines (step 5a.3).
On this page that is `handoff` (step 7, "The launch dry run", which gives the form; SCORED, or a
rehearsal account with `--rehearsal`) and step 8's attach-and-logout. The scored run's own start,
run.ts, is rs/186's and not on main, so its line is pending; it is dry-run the same way.

**The run bound is 9 h.** A full run is our row, about 35,300 ticks (RUN-ORDER.md): about 2.9 h of
wall clock at the 300 ms tick the demo ran until 19:56Z on 2026-10-22, and about **3.9 h at the
400 ms it has run since** ("Measured: the demo's tick period"); at 600 ms, which remains possible,
about 5.9 h. Steps 3 to 7 take under an hour, so 9 h leaves about four hours of margin at 400 ms
and about two at 600 ms (i). The same 9 h bounds the run's claim
(below). Each hand-run launch below begins `T=9h;`, the only place the figure appears in a
command, and a rehearsal replaces it with `T=30m`; `speedrun/tools/run-gate.ts` (steps 3-7) carries
the same 9 h for the run and 30 min with `--rehearsal`. The gate account's tab and the measurements
carry their own short bounds, in the table. A bound counts from its own launch. If
SCORED's login (step 7) slips more than two hours past step 3, tear the stack down and bring it up
again before step 7.

| Launch | Run | Rehearsal or measurement |
|---|---|---|
| Page server, gateway (`up`, step 3) | `T=9h` | `T=30m` (`--rehearsal`) |
| Recording (`up`, step 5), SIGINT at the bound | `T=9h` | `T=30m` |
| Live view (`up`, step 5) | `T=9h` | `T=30m` |
| Chrome, the gate account's tab (`gate`, step 6) | - | `15m` |
| Chrome, SCORED's tab (`handoff`, step 7) | `T=9h` | `T=30m` |
| `tab-login.ts`, a tab's login (`gate`, `handoff`) | `3m` | `3m` (it gives up by itself after 120 s) |
| A tab's logout, `logoutClean` attached to the tab (`gate`; step 8 for SCORED) | `3m` | `3m` (30 s to attach, `logoutClean`'s waits, 15 s to confirm) |
| Gate (a)-(c), rs/96's CLI (`gate`) | - | `15m` (its probe gives up after 10 min) |
| Gate (d), the sampler (`gate`) | - | `10m` (a 5 min sample; the script's own limit is 7 min 10 s) |
| run-gate.ts's own run on each machine | `up` 3 min, `gate` 40 min, `handoff` 12 min | the same |
| rs/117's helper launcher (step 4) | `T=9h` | `T=30m` |
| SIGKILL after the bound, every launch | 30 s | 30 s |
| rs/83's gate history timer read (not ours; "Gate history timer") | skipped while a claim holds | `timeout 240`; systemd kills the unit at 270 s |

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
teardown left nothing. The gate (a)-(c) command's bound was not exercised: the host's clone was
then at `85a28dc8d`, whose older `tickmanip-latency.ts` needs an attached tab and exited by itself
within 17 s. Only step 0 moves `~/rs-sdk` (r: main via rs/103, 2026-10-21). Afterwards the leftover check showed no tmux server, no process and no reservation.

**The claim lock, `rs-claim`** (tenet 21; the host thread, 02:28-02:30Z 2026-10-22). Machine time on
either machine is taken through `~/.local/bin/rs-claim`. Its source is
`docs/speedrun/scripts/host-gate/rs-claim` (rs/440, on main as `d02c094f`, #350): the copy the host
thread installed, byte for byte, with the same sha256 on both machines.
`docs/speedrun/scripts/host-gate/install.sh` installs it into `~/.local/bin` only when the installed
copy differs, and prints both sha256s either way; `uninstall.sh` leaves it in place. It keeps the sentinel
`/home/ubuntu/host-reserved.json`, the file rs/83's gate history timer skips on, so the timer and the
claims are one lock. It replaced the slot calendars (the run host's probe slots and rs/147's slot
files) and the hand-written reservation one-liners this page used to carry: the file is written only
through `rs-claim`. Its commands:

- `rs-claim status`: who holds the machine, and until when.
- `rs-claim take OWNER LOGINS MINUTES WHAT`: granted only if the machine is free, stale or already
  `OWNER`'s, and only if our accounts in the world plus `LOGINS` stay at or under 100. It counts ours
  on `/playerpositions` (the `Cairn ` prefix plus the private names, matched by hash and never stored
  in clear); if the count can't be fetched, the take is refused. A refused take says why (held, or
  the login cap); start nothing until a take is granted. A claim goes stale at take + `MINUTES` +
  10 min unless touched.
- `rs-claim touch OWNER` keeps a claim live; `rs-claim release OWNER` frees it.
- `rs-claim preempt MINUTES DRAIN REASON` is the host thread's only: the displaced holder's next
  `touch` exits 3, and it logs out and releases within `DRAIN`.

Every event goes to `~/claims/log.jsonl`. rehearse.ts takes part: `--claim-owner` names the claim an
attempt runs under, and any other live owner refuses it at pre-flight and pauses it at a step
boundary (speedrun/README.md, "Under a claim"). The gate history timer skips every firing while a
claim is live and ignores one gone stale, so a forgotten release costs nothing ("Gate history
timer", below "The host"). Who takes one:

- **the run**: step 0, on run night, on **both** machines, as owner `run`, before anything else
  starts, covering setup, the 9 h run bound above and an hour's margin; the run never disables the
  timer instead. run.ts, on the chosen machine, refuses to start unless the claim is live and the
  run's own, and releases it after SCORED's final clean logout. The machine not chosen keeps its
  claim until the run's teardown (step 9), so its timer skips and rehearsals there stay paused
  (step 5a);
- **a rehearsal**: before anything starts, for the rehearsal's bound (30 min) and its logins;
  released after teardown;
- **anyone else** who needs a machine quiet (a measurement child, a probe, a check of these
  commands): for its time; released afterwards.

**A claim keeps its gate evidence** (fold-in 31): an ad-hoc gate or probe run under a claim copies
its JSON (per-trial rows, `tickArrivalsMs`) into its evidence before the claim's teardown, and no
teardown deletes `~/gate-history`, `~/rs-run/gate-*` or `~/rs-run/<run>/load.log` (step 9).

**Leave nothing running on a machine without a claim.** The timer also skips while the machine is
busy (a tmux server that answers, bun, ffmpeg, or a Chrome with its own profile), and a busy skip is
not a reserved one: at 03:00Z on 2026-10-22 a load-check stack armed on the run host outside any
claim made the run host's firing skip as `busy`, so that minute had no pair with the twin (m, rs/249
and rs/83). Take the claim for anything you arm, or clear it.

The commands in this page's ssh form (`rs/NNN` is the owner; the twin's form through the filter in
"Reaching them"):

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" '~/.local/bin/rs-claim status'
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" '~/.local/bin/rs-claim take rs/NNN 2 30 "rehearsal"'
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" '~/.local/bin/rs-claim release rs/NNN'
```

**Credentials.** No password and no login token is ever a process argument, part of the URL Chrome
starts with, or in shell history. Chrome opens a bare `?bot=<name>` page, and `tab-login.ts` logs it
in with a one-time token over Chrome's DevTools port (cairn://p/rs/138; run-gate.ts does both for
every tab it opens, with a secrets check that expects `0 0 0`, step 3). The earlier launch put the password in the tab's URL, and so in `ps`, in tmux
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
(#140) but not main, since #146 did not carry it. `gate` (step 6) and step 8 therefore confirm a
tab's logout with `logoutClean` itself, and step 8 also with the login screen in the live view.

**The run-commit floor is not named on this page.** Its single source is STEP-MANIFEST.md entry
0's line, "`RUN_COMMIT` at or after the run-commit floor, `<hash>`", the line rs/393's run-floor
parser reads (main's ruling, fold-in 23; relayed by rs/158, 08:39 and 09:24 PDT 2026-10-22). Step 0
reads the hash from that line on origin/main and stops on any mismatch ("The floor check"). The
floor's history contains every earlier requirement, so no per-fix check is kept. **What each commit
on the floor brings, and what is pending for it, is entry 0's list**, kept there only; main names
each new floor in its messages and the next docs snapshot writes the line. The commits this page's
own steps rely on, all inside the floor: rs/138's Chrome login and the page server's token endpoints (`96fc462a`, #120; step 3),
rs/164's tab-logout confirmation (`c2d9eada`, #146; above), rs/174's relog fix (`efdbe2e2`, #164;
step 7), rs/210's tick monitor (`834f376b`, #176) with rs/276's observed-period change (`de66634b`,
#226) and #325's `overBudget` (step 7), rs/312's loopback guard in `openSession` (`7cc8afac`, #250;
step 3's env check), and the cue scope contract (`2538b7d8`, #313; step 4).

**Leftover check.** It lists every tmux socket on the host with its sessions, other agents' sockets
included, plus every `chrome*`, `ffmpeg`, `bun` and `timeout` process with its age, and the claim
(`rs-claim status`). It does not count the gate history timer's processes: they run in
`rs-gate-read.service`'s own control group (none between firings) and are reaped by its 270 s bound.
It prints the timer's state on its own line instead; `gate timer read: active` means a firing is in
progress, so wait for `inactive` before a launch. Run it before any launch and after any teardown or
bound. After teardown expect `no server running` on every socket, no processes and no claim of
yours:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'for s in /tmp/tmux-$(id -u)/*; do [ -S "$s" ] && echo "tmux -L $(basename $s): $(tmux -S $s ls 2>&1 | tr "\n" " ")"; done; L=; for p in $(pgrep "^(chrome.*|ffmpeg|bun|timeout)$"); do grep -q rs-gate-read.service /proc/$p/cgroup 2>/dev/null || L="$L,$p"; done; if [ -n "$L" ]; then ps -o pid,etime,comm -p "${L#,}"; else echo "no chrome, ffmpeg, bun or timeout process outside the gate timer"; fi; echo "gate timer read: $(systemctl --user is-active rs-gate-read.service)"; ~/.local/bin/rs-claim status'
```

**Twin:** rehearsals there may also leave an Xvfb (`:99`), which `tmux kill-server` does not stop
(m, rs/149; rs/147's HOST.md). Add `pgrep -a -x Xvfb` to the check there, and stop a leftover
rehearsal Xvfb with `pkill -TERM -x Xvfb` only when no rehearsal holds a claim.

## The host

Set `RS_RUN_HOST`, `RS_TWIN_HOST` and `RS_RUN_TAILNET` in your local shell from cairn://p/rs/host before running any command here; never commit them (main's rule: no host addresses on main).

Two machines (tenet 17): the run host and its twin, the same instance class, AMI and availability
zone, with identical CPU, kernel (7.0.0-1014-aws) and TCP settings (m, the host thread, 14:17 PDT
2026-10-21). Twin facts are r from rs/147's `docs/speedrun/rehearsals/HOST.md` (rs/147's branch at
715dd4fa; rs/149 built the twin) unless marked; **pending (rs/host)** marks a fact the host thread
has not yet sent from the twin's run-capable install (its window opened at 00:26Z on 2026-10-22).

| | Run host | Twin | Source |
|---|---|---|---|
| Name | **rs-ashburn-run**, also its hostname ("Hostnames", below); instance id **pending (rs/host)** | **`rs-ashburn-rehearsal`**, the twin (rs/147's; launched 2026-10-21 12:57 PDT by rs/149) | r: the host thread, 16:12 PDT; HOST.md |
| Machine | AWS us-east-1c, c7i.2xlarge: 8 vCPU (Xeon Platinum 8488C), 16 GB, 60 GB gp3, **no GPU**, Ubuntu 24.04 | AWS us-east-1c, c7i.2xlarge, same AMI as rs-ashburn-run, on the run host's subnet: 8 vCPU (Xeon Platinum 8488C), 15 GB as read on the machine, 60 GB gp3, no GPU; the run host's AMI, Ubuntu 24.04.5 | run host r: main on cairn://p/rs/103, 08:45 and 08:53 PDT, CPU model m (`/proc/cpuinfo`); twin m, HOST.md |
| Address | addresses: cairn://p/rs/host. The run host is **rs-ashburn-run**; its public address is an Elastic IP, changed at 23:11Z on 2026-10-21, and the earlier address is released. Commands use `$RS_RUN_HOST` | an Elastic IP, so it survives a stop. Commands use `$RS_TWIN_HOST` | r: the host thread, 16:12 PDT; HOST.md |
| The engine's processing group (the address's last octet & 7; step 4) | **3** (current address; re-read after any address change) | **4** (current address; re-read after any address change) | m: the host thread, 2026-10-23, via rs/158 (fold-in 34; the addresses live only in the host thread). The 1 and 0 before were the 2026-10-21 addresses (the host thread and main, 16:25-16:33 PDT; the demo sees each machine's public address, flyio-debug `ra`). The lower group is processed first, so the run host's players precede the twin's. **It no longer decides placement for attempt 1**: helpers on the other machine are off (step 4) |
| Ingress | SSH and RDP admit only the operator's address | the same: a copy of the run host's security group | r |
| Tailscale | its tailnet address (`$RS_RUN_TAILNET`) is unchanged by the address change | **not on the tailnet**: RDP goes to the public address and the live view through an ssh tunnel (step 5) | r: the host thread; HOST.md |
| SSH key, known_hosts | `~/.rs-fleet/id_ed25519_ashburn`, `known_hosts_ashburn`, on `local`, bgsrv-mac and bgsrv-ub | `~/.rs-fleet/id_ed25519_rehearsal`, `known_hosts_rehearsal`, on `local` and bgsrv-ub only: two different keys with the same file name, one made on each machine | r |
| Host key | ssh-ed25519 ...WZ0wE, unchanged by the address change | the three keys cloud-init printed to the EC2 console, pinned in `known_hosts_rehearsal` before the first connection; the ed25519 key's tail for this table **pending (rs/host)** | r: the host thread, 16:12 PDT; HOST.md |
| Desktop | XFCE served by xrdp, user `ubuntu`; `max_bpp=24`; sesman `KillDisconnected=false`, `DisconnectedTimeLimit=0`, `IdleTimeLimit=0`, so a disconnected session lives on | the same settings (m, read back by its setup script) | run host m: `/etc/xrdp/xrdp.ini` and `sesman.ini`, 16:23 UTC |
| Display | `:10` when it is the first session since boot; read it in step 2 | `:10`, 1920x1080, 24 planes, made by the operator's first connect (m, 20:17:57 UTC); a stop of the instance ends it | r, m |
| One desktop per user | a second session (another resolution, say) starts and dies at once, because `xfce4-session` cannot run twice for one user; the old session holds the only desktop. **Changing resolution means ending the session first** | the same | r: main, 09:26 PDT |
| Screen | screensaver and locker removed, `xset` no-blank at login, logind `IdleAction=ignore` | none installed, `xset` no-blank autostart, `IdleAction=ignore` | r |
| Chrome | 156.0.8078.47 at `/usr/bin/google-chrome`, software rendered (its renderers run with `--disable-gpu-compositing`) | `google-chrome` 156.0.8078.47, held at that version (`apt-mark hold`) | m |
| Run profile, page origin | `/home/ubuntu/rs-run/chrome-profile`, `http://127.0.0.1:8899` | run profile `/home/ubuntu/rs-run/chrome-profile`, page origin `http://127.0.0.1:8899`: the run tab's warmed profile (step 7) | r: the host thread, 10:4x PDT 2026-10-22 |
| Live view (step 5) | `$RS_RUN_TAILNET:8090`, on the tailnet | 127.0.0.1:8090 (no tailnet; watch with `ssh -L 8090:127.0.0.1:8090 ...` until Tailscale is installed on it) | r: the host thread, 10:4x PDT 2026-10-22 |
| Tools | ffmpeg 6.1.1; Bun 1.4.3 at `~/.bun/bin/bun`, **not on PATH** for non-login ssh commands; tmux; sysstat (`pidstat`) | the same, with tmux 3.4, sysstat 12.6.1 and Xvfb (rehearsals use it, never the run) | m |
| Checkout | `/home/ubuntu/rs-sdk`, a long-lived clone of our fork for the page server, the gateway and helper runners; only step 0 moves it | `/home/ubuntu/rs-sdk`, kept on main day to day because rehearsal attempts add worktrees from it; on run night step 0 moves it to RUN_COMMIT under the run's claim with no attempt worktree in use, and if the twin is not chosen it goes back to main after the run's teardown | r: main; rs/147, 16:18-16:34 PDT |
| `~/run-commit` and the gate clone `~/gate/rs-sdk` | written by step 0 only, on both machines together; the clone follows it at its next firing | the same: rs/249's install wrote the run host's RUN_COMMIT, and from then on only step 0 | r: rs/83 and the host thread, 16:13-16:36 PDT; m, rs/249, 02:29-02:32Z 2026-10-22 |
| Gate history timer (rs/140) | enabled, :00 and :30 | the same files and unit, enabled, :00 and :30, since 02:30Z on 2026-10-22 (rs/249) | "Gate history timer", below |
| Claim lock | `~/.local/bin/rs-claim`, keeping `/home/ubuntu/host-reserved.json` | the same | r: the host thread, 02:28-02:30Z 2026-10-22 |
| Helpers' code and credentials (step 4) | rs/117's launcher from `~/rs-sdk` at RUN_COMMIT; the givers' mode-600 env files on run night only | the same, as part of the run-capable setup: **pending (rs/host)** | r: main, 16:14 PDT; the host thread, 17:03 PDT |
| Day to day | the gate timer; everything else under a claim | the gate timer; rs/147's rehearsals under a claim | r: the host thread, 02:28Z 2026-10-22 |
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
2026-10-21), and did so at 17:39Z on 2026-10-22. Only reads taken after the last address change
count (step 5a), so rs/83's 4 of 17 for the run host are readings of its old route: the run host is
the **fallback pending 4+ clean pairs on the new address (rotated 17:39Z)** (main, relayed by rs/158
at 10:5x PDT). A held route can strike either machine, which is why both are kept run-capable and
both are gated (tenet 17).

**The expected start machine** (the host thread, 10:4x PDT 2026-10-22, as written). Under tenet 17
and main's 2026-10-22 10:4x PDT ruling, the **twin is the expected start machine** and
rs-ashburn-run is the fallback. The reason is rs/83's same-minute pair series on the final
addresses: twin 17 of 17 pass, run host 4 of 17, with held ticks on the run host's path. The run
host's address was rotated again at 17:39Z 2026-10-22 and is re-judged on 4+ clean same-minute
pairs. `run-gate gate` gates both machines and prefers the twin when both pass (rs/440, #350,
`d02c094f`; step 5a has the tiebreak and when a move to the run host counts). Per-skill rehearsals and lab claims use whichever machine is
free through rs-claim, and they end on the twin at the floor freeze on run eve.

**Hostnames** (the host thread, 10:4x PDT 2026-10-22, as written). The run host's hostname is
`rs-ashburn-run` and the twin's `rs-ashburn-rehearsal`, both kept across reboots
(`/etc/cloud/cloud.cfg.d/99-rs-hostname.cfg`, preserve_hostname: true). Gate-history JSON records
the machine name, never an EC2 `ip-172-31-*` name.

**Reaching them.** Every command below is pasted on the Mac (zsh or bash) and runs on a machine over
an exact ssh line (or `speedrun/helpers/ashburn.sh` once rs/41 merges it). **Every command on this
page is written for the run host**, except run-gate.ts's three (steps 3-7), which run on the Mac
itself and reach both machines with their own keys. From Cairn, run a run-host command in a batch on
executor `local`, `bgsrv-mac` or `bgsrv-ub`; run-gate.ts needs the twin's key too, so `local` or
bgsrv-ub.

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
the twin in mind, or the other way round (run-gate.ts needs no filter):

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
| The claim lock's sentinel (`rs-claim`; rs/83's timer skips while a claim holds) | `/home/ubuntu/host-reserved.json` |
| Run commit (written only by step 0) | `/home/ubuntu/run-commit` |
| Gate history timer (rs/83): its copy, its clone, its history | `~/.local/lib/rs-gate`, `~/gate/rs-sdk`, `~/gate-history/` |
| X display of the operator's session | `:10` when it is the first session since boot; read it in step 2 |
| The operator's live view (step 5) | run host `http://$RS_RUN_TAILNET:8090/live.mjpg` on the tailnet; twin `127.0.0.1:8090` on the machine, opened through an ssh tunnel |

### Gate history timer

(r: main via rs/103, 2026-10-21; rs/140 installed it for mission rs/83, first scheduled firing
20:00Z, first successful one 20:30Z;
`docs/speedrun/research/demo-latency.md` section 10, on rs/140's branch, PR into rs/83. The scripts
it names, `docs/speedrun/scripts/host-gate/` and `docs/speedrun/scripts/host-gate-read.sh`, are not
on main yet: they arrive with rs/83.)

**On both machines, at parity** (tenet 17; m, rs/249, which installed the twin's under its claim at
02:29-02:32Z on 2026-10-22 and sent the deltas to the host thread at 03:05Z). The run host's timer
has read at :00 and :30 since 20:00Z on 2026-10-21, the twin's since 02:30Z on 2026-10-22, and both
are enabled day to day. The two are identical item for item: the five files under
`~/.local/lib/rs-gate` (the same sha256 on both, equal to rs/83's branch at the install), the unit
text (`systemctl --user cat rs-gate-read.service rs-gate-read.timer` hashes the same on both:
`TimeoutStartSec=270`, `KillMode=control-group`, `OnCalendar=*:00,30`, Bun on the unit's PATH), and a
blob:none gate clone `~/gate/rs-sdk` that every firing checks out detached at `~/run-commit`, which
step 0 writes on both machines together. **`ubuntu` lingering must be ON** on each
(`sudo loginctl enable-linger ubuntu`; `install.sh` refuses without it), so the timer runs with no
one logged in; the twin had it off until rs/249 set it. Each machine reads on **its own throwaway
account** (step 0, "Gate accounts"). Each writes its own `~/gate-history/<UTC timestamp>.json` on
itself, in the format below; nothing is merged or copied between them, and same-minute files pair
up by name. Every command in this
section runs on either machine in its own ssh form ("Reaching them").

**One wrapper fix pending on both** (rs/249): `host-gate-read.sh` redacts `BOT_PASSWORD`, a key no
bot.env carries (they use `PASSWORD`), so its password redaction has never run. It is latent: the
probe never prints the password, and rs/249 found it in no history file or journal line. The fix is
in rs/249's PR into rs/83's branch. Once it is in `RUN_COMMIT`, install it on both machines at the
same moment, at step 0 with `bash docs/speedrun/scripts/host-gate/install.sh` from `~/rs-sdk` at
`RUN_COMMIT` (with `--every 15` if the start is under two hours away), so the files stay identical.

**Twin** (rs/249's install, relayed by rs/83, 2026-10-22). rs/249 installed the twin's timer for
rs/83 at 02:29-02:32Z on 2026-10-22, under its own claim, item for item from the run host. The same
five files are in `~/.local/lib/rs-gate` (identical sha256), and the installed unit text is
byte-identical, including `GATE_REPO` and Bun at `~/.bun/bin/bun` (1.4.3 on both). `~/gate/rs-sdk`
is a blob-less clone (`--filter=blob:none`) of the fork, as on the run host, checked out detached at
the run host's `~/run-commit` of that moment, with the same dependency stamp. Its gate account is a
fresh `cairn_` throwaway, made the way rs/140 made the run host's. Name and password were generated
on the twin under `umask 077`, so they never crossed an ssh command line. They exist only in
`bots/gate/bot.env` (mode 600, directory 700), and the account was created by its first login.
Lingering was off on the twin and was turned on (`sudo loginctl enable-linger ubuntu`), because
`install.sh` refuses without it. The 02:30Z firing skipped as `reserved by rs/249`. The owner read
at 02:30:17Z passed 60/60 with 0 catch-ups per minute, its record names the commit, its logout was
confirmed, and nothing was left running. What differs from the run host: the account; the twin's
clone has no local branch (the run host's was cloned from rs/83's branch, and the wrapper detaches
either way); and the twin has no `~/gate/tools`, rs/140's leftover staging copy on the run host,
which the timer never reads. **On run night step 0 writes `~/run-commit` on both machines**, so the
two series stay on one commit.

**How the start decision reads both.** From two hours before the start both timers run every 15
minutes: `install.sh --every 15` on each machine. They
fire in the same minutes, so every firing is a same-minute pair of the two paths. Until step 0's
claims stop them, read the latest files on both machines side by side (the history command
below, once per machine). A path that holds ticks shows as a run of failed reads on one machine while
the other passes, as the run host's old address did in 5 of 5 pairs (m, the host thread, 15:47 PDT).
The history picks the start window and warns of a bad path early; the decision itself is step 5a's
fresh same-minute gate on both. A rehearsal on the twin holds its claim, so the twin's firings skip as
reserved for its length and those minutes have no pair.

The run-night gate's history accumulates on each machine until the scored run, without an agent. It's a systemd user timer owned by mission rs/83. `ubuntu` lingers on both machines (above), so the timer runs with no one logged in. The sources are in `docs/speedrun/scripts/host-gate/` and `docs/speedrun/scripts/host-gate-read.sh`. `install.sh` copies them to `~/.local/lib/rs-gate`, and the timer runs that copy.

- **What fires when.** `rs-gate-read.timer` starts `rs-gate-read.service` at :00 and :30. The host clock is UTC; the minutes are the same in PDT. Each firing (1) skips while a claim is live; (2) skips while the host is busy ("Leave nothing running on a machine without a claim", "Rules for every launch"): ffmpeg, bun, a tmux server that still answers, or a Chrome with its own profile, app URL, headless flag or open connection; (3) checks out the commit in `~/run-commit` (written only by the runbook's step 0), detached in its own clone `~/gate/rs-sdk`, and skips with `no run-commit` if that file is missing; (4) checks the server without logging in: the public `/playercount`, with Fly's machine (`sid`) and worker (`bn`) from the `flyio-debug` header, and skips as `restart suspected (players N)` under 300 online or with no answer. The 20:00Z firing crashed with 38 online during the afternoon's probable restart, and this skip replaces that crash (rs/140, 14:05 PDT 2026-10-21); (5) runs the #101 gate, `tickmanip-latency.ts gate --path=direct --no-tele`, under `timeout 240`. The account is the machine's own throwaway, whose credentials exist only in `~/gate/rs-sdk/bots/gate/bot.env` (mode 600). It logs in through the direct path, not through a Chrome URL. A read takes about 3 minutes, and systemd kills the unit's whole control group at 270 s. That makes the timer compliant with the reaping rule: nothing it starts outlives its own bound.
- **History.** One file per firing, `~/gate-history/<UTC timestamp>.json`: `commit`, `status` (`ok`, `not-probed`, `timeout`, `error` or `skip`), `on`, `onTime`, `catchUpsPerMinute`, `tickP90Ms`, `players`, `edge`, `utc` and `endUtc`, and `preLogin` (`players`, `flyMachine`, `flyWorker`; the Fly machine id makes a restart visible as a changed machine; rs/140, 14:05 PDT), with the gate's own JSON under `gate`. Skips record the reason in `note`; a broken read puts its first error line there and its last 40 output lines, credentials redacted, in `outputTail` (rs/140, via rs/83). There's one journal line per firing: `journalctl --user -t rs-gate-read` (not `-u`, which can miss the summary line printed as the read exits). Check the next firing with `systemctl --user list-timers rs-gate-read.timer`.
- **Every 15 minutes from two hours before the start:** `bash ~/.local/lib/rs-gate/install.sh --every 15` (`--every 30` switches back).
- **Claims.** While a claim is live (`rs-claim`, "Rules for every launch") every firing logs `skip: reserved by OWNER` and does nothing; a claim gone stale is ignored. To take one read inside your own claim: `systemctl --user set-environment RS_GATE_OWNER=rs/NNN`, then `systemctl --user start rs-gate-read.service`, then `systemctl --user unset-environment RS_GATE_OWNER`.
- **The gate account logs out after each read.** rs/96's direct gate CLI (`speedrun/lib/direct.ts`'s gate, which this timer runs) used to close its socket without logging out, leaving the account in the world until the server's no-connection timeout, so its next login (the next firing's, or step 6's tab-login after (a)-(c) on the same account) could see 'already logged in' (rs/149, relayed by rs/158, 2026-10-21). That is fixed by #142 (9d26aa87, rs/168: `DirectSession.logout`): the gate account logs out at the end of each read, once `~/run-commit` (which the timer checks out) is at or after 9d26aa87.
- **Stopping and removing.** To pause, run `systemctl --user disable --now rs-gate-read.timer`; to resume, run `bash ~/.local/lib/rs-gate/install.sh`. To remove it, run `bash ~/.local/lib/rs-gate/uninstall.sh`. That stops a read in progress and keeps `~/gate-history` and the clone.

**For the run script and rehearsals:** in step 0 or setup, take the claim covering the whole run with margin before anything else starts, rather than disabling the timer. A forgotten release then costs nothing. The leftover check should not count the timer: between firings it has no process, and during one its processes belong to `rs-gate-read.service` (`systemctl --user status rs-gate-read.service`).

The same commands in this page's ssh form (the run host's; the twin's through the filter in "Reaching
them"). The journal, the next firing and the latest history file:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'journalctl --user -t rs-gate-read -n 20 --no-pager; systemctl --user list-timers rs-gate-read.timer --no-pager; ls -t ~/gate-history | head -1 | sed "s|^|$HOME/gate-history/|" | xargs -r cat'
```

Every 15 minutes from two hours before the start (`--every 30` switches back):

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'bash ~/.local/lib/rs-gate/install.sh --every 15'
```

One read inside your own claim (`O` is its owner; it waits for the read, at most 270 s):

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
that either can take the run when step 5a chooses: the same RUN_COMMIT, claim, bring-up,
opening helpers, recording and live view (tenet 17). Where a step differs on the twin, it says so
in a **Twin:** line. Step 6's gate runs on both inside step 5a; steps 7 and 8 run on the chosen
machine only; step 9 tears down both.

## 0. Prepare the checkout (once per run commit)

**On run night, step 0 starts with the run's claim**, on both machines, before anything else on
this page starts, even when the checkout is already on `RUN_COMMIT` ("The claim lock", "Rules for
every launch"). It covers the whole run with margin, and the run never disables the timer instead.
`M` is the minutes from now to the planned start plus 600 (the 9 h bound and an hour's margin). `L`
is the most logins the machine holds during the run: SCORED, the full roster and its gate account
(SUPPLIES.md, "Peak concurrent logins"), since either machine may be chosen. If the take is refused
on the login count, log the unneeded fleet out first (step 7) and take it again; nothing below
starts without it:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'M=MINUTES; L=LOGINS; for v in "$M" "$L"; do case "$v" in ""|*[!0-9]*) echo "set M and L to whole numbers"; exit 1;; esac; done; ~/.local/bin/rs-claim take run "$L" "$M" "scored run" && ~/.local/bin/rs-claim status'
```

A firing that began before the take still finishes (within 270 s). Run the leftover check until it
prints `gate timer read: inactive` before anything below starts.

The page server needs the browser bundle, and the gateway its own dependencies; on 2026-10-21 only
the root `bun install` had been done (m). Main names the run's commit (`RUN_COMMIT`). Step 0 first
writes it to **`~/run-commit`**: one line, the full 40-hex commit. Only step 0 writes that file. It
writes it **on both machines together**, one straight after the other, and on each **before** it
moves `~/rs-sdk`. rs/83's gate timer reads the same file on each machine and checks that commit out
in its own clone, `~/gate/rs-sdk`, at its next firing, so a file moved on one machine only splits
the two gate series by commit (rs/249, 2026-10-22). On each machine it then checks `~/rs-sdk` out
to that same full hash and verifies that `git rev-parse HEAD` equals `~/run-commit` (the deploy
command below; rs/410, 15:11Z 2026-10-22). Replace `C` with the full commit:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'C=0000000000000000000000000000000000000000; case "$C" in *[!0-9a-f]*) echo "not a commit: $C"; exit 1;; esac; [ ${#C} -eq 40 ] || { echo "need the full 40-hex commit"; exit 1; }; printf "%s\n" "$C" >$HOME/run-commit.tmp && mv $HOME/run-commit.tmp $HOME/run-commit && cat $HOME/run-commit'
```

**Deploying `RUN_COMMIT`** (main, 07:28 PDT 2026-10-22). Every code update on run night, on the run
host, the twin and the fleet, follows three rules:

1. The update takes the **full** 40-hex `RUN_COMMIT`, never a short hash.
2. Before any restart or launch, the step verifies that `git rev-parse HEAD` equals it and that the
   tree has no scaffolding: no `.jjconflict-*` path, no conflict marker, no modified tracked file.
3. No update command's exit status is hidden by a pipe: `set -o pipefail`, or run the update on its
   own and check it.

The incident behind them: on 2026-10-22 `fleetctl update`, given a short hash it couldn't fetch,
failed silently behind a pipe, the restart still went ahead, and the fleet ran the old commit for
23 s (rs/41, 14:27Z). On the two Ashburn machines the command below keeps all three: it checks out
`~/run-commit`'s full hash, every step is `&&`-chained with nothing piped, and it prints `HEAD is
the run commit, no scaffolding` before it installs or builds anything. The fleet's update is
rs/41's: `fleetctl update` with the full hash, run on its own (fleetctl itself runs under
`set -euo pipefail`), then the same two checks in the fleet's checkout before any restart (step 4).

Then put the clone on it, check it, install and build. Every install is `--frozen-lockfile`, in the
repository root, `server/webclient`, `server/engine` and `server/gateway`, all before the build
(rs/410's step 0, 2026-10-22), so a checkout whose lockfile disagrees with its `package.json` stops
here:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'export PATH=$HOME/.bun/bin:$PATH; C=$(cat $HOME/run-commit); cd ~/rs-sdk && git fetch -q origin && git checkout -q --detach "$C" && [ "$(git rev-parse HEAD)" = "$C" ] && [ -z "$(git status --porcelain --untracked-files=no)" ] && [ -z "$(git ls-files "*.jjconflict*")" ] && ! git grep -q -E "^(<<<<<<<|>>>>>>>)( |\$)" HEAD && echo "HEAD is the run commit, no scaffolding" && bun install --frozen-lockfile && (cd server/webclient && bun install --frozen-lockfile) && (cd server/engine && bun install --frozen-lockfile) && (cd server/gateway && bun install --frozen-lockfile) && (cd server/webclient && bun run build) && mkdir -p ~/recordings ~/rs-run/chrome-profile && git log -1 --oneline && ls server/webclient/out/bot/client.js'
```

**What identifies a build** (main's ruling, relayed by rs/158 at 10:05 PDT 2026-10-22). A figure,
and the run, is identified by the commit it was built from, which fixes the webclient tree, plus the
host. Bun's minifier does not build byte for byte reproducibly: the same commit built in a fresh
checkout gives a different bundle md5, and the two machines' md5s differ by its naming (m, rs/410's
step 0 on the run host at 15:11Z and the twin at 15:15Z, 2026-10-22). So an md5 proves only that
one machine serves what it built. Step 3's served = built check runs within each machine and is
never compared across machines or builders, and tenet 17's "the same RUN_COMMIT on both machines" is
checked by commit hash: `git rev-parse HEAD` against `~/run-commit` on each, in the command above.
The page server serves `out/bot` per request with `no-store` (`server/webclient/proxy.ts`), so a
rebuilt client bundle needs no restart of it (rs/410).

**The bot bundle is rebuilt on both machines after a4456c73** (#385, rs/471; main 15:5x via rs/158,
fold-in 31). #385 moves the gate's catch-up and p90 limits to fractions of the tick length T, and
the page's half of that rule (`frames.ts`, with the program runtime's `tickMs` start parameter) is in
the served bot bundle, so a bundle built before a4456c73 still judges (c) at 150 / 350 ms. host
rebuilds the bundle on each machine at a commit at or after a4456c73 (the floor contains it), and
step 3's served = built check then runs within each machine as usual.

**The served webclient is rebuilt from the run commit at every step 0** (main 21:3x via rs/158;
fold-in 33). The final run commit carries an `sdk/` change (**rs/564**, the `sdk/` snapshot carrying rs/186's
`walkTo` fix, 01304312, on main as #459, a1ce2209, fold-in 35; fleet snapshot 11, #451, also moved the floor), and the SDK reaches the tab only
through the served bot bundle. So whenever `~/run-commit` changes, the install and build above run
again on both machines before anything is launched, and step 3's served = built check confirms
that each machine serves what it built from that commit. A bundle built from an earlier commit is
never served to SCORED's tab, even when the page server is already up (it serves `out/bot` with
`no-store`, so the rebuild needs no restart of it). Main names the final commit by 12:00Z (12:30Z
absolute), leaving this rebuild its 20 minutes before the 13:00Z freeze (RUN-ORDER.md section 1).
**Slid for rs/598** (main 04:15 PDT via rs/158; fold-in 37): the run commit is re-named by 14:00Z
with the runner-side delivery-session binding in it, and the freeze is 15:00Z; any miss postpones
attempt 1. **Main's schedule ruling** (04:45 PDT via rs/158; fold-in 37): naming by 14:00Z (rs/598's
lab 3 of 3 by 13:15Z, merged 13:45Z, the twin re-run by 14:45Z), the freeze 15:00Z, the gate series
from 17:00Z, the start ~17:15Z (10:15 PDT) on the machine that passes, the run ending ~21:10Z;
claims released 14:30Z; rs/83's 20:35Z sweep skipped. Naming at 14:00Z is 3 h before the series,
so the run-eve freeze rule below holds as written. **Superseded by main's final set** (12:08Z via rs/158): the run commit named 12:05Z (233d0f34), the freeze 14:00Z, the gate series from 16:00Z, the start ~16:15Z (09:15 PDT), the run ending ~20:10Z, the 20:35Z sweep skipped; named nearly 4 h before the series. The host's input check on 233d0f34 (both machines, 12:03Z): no bundle input changed, so no rebuild; step 0 running.

**The floor check, a hard stop** (main's ruling, relayed by rs/158 at 09:24 PDT 2026-10-22;
STEP-MANIFEST.md entry 0). The floor is read from entry 0's line on origin/main, "`RUN_COMMIT` at
or after the run-commit floor, `<hash>`", its single source ("Credentials"). Set `N` to the floor
main last named (cairn://p/rs/main/messages, or the host thread's messages). The command stops unless
that line gives exactly one hash, the line and `N` are the same commit, and `RUN_COMMIT` is at or
after it. It also checks that `RUN_COMMIT` contains run-gate.ts as rs/440 left it (#350, `d02c094f`, which
contains #216's `b1a2765d`), the gate tooling steps 3-7 run from this checkout. That check stands on
its own, not as part of the floor (step 3). **Any mismatch is a stop, not a
note**: tell main. Expect `floor ok`:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'N=FLOOR_MAIN_NAMED; cd ~/rs-sdk && C=$(cat $HOME/run-commit) || exit 1; git fetch -q origin main && git show origin/main:docs/speedrun/STEP-MANIFEST.md >$HOME/rs-run/manifest-main.md || { echo "STOP: cannot read STEP-MANIFEST.md on origin/main"; exit 1; }; L=$(sed -n -E "s/.*RUN_COMMIT. at or after the run-commit floor, .([0-9a-f]{7,40}).*/\1/p" $HOME/rs-run/manifest-main.md); case "$L" in ""|*[!0-9a-f]*) echo "STOP: entry 0 does not give exactly one floor"; exit 1;; esac; F=$(git rev-parse -q --verify "$L^{commit}") || { echo "STOP: the floor $L is not in this clone"; exit 1; }; [ "$F" = "$(git rev-parse -q --verify "$N^{commit}")" ] || { echo "STOP: entry 0 names $L, main last named $N"; exit 1; }; git merge-base --is-ancestor "$F" "$C" || { echo "STOP: RUN_COMMIT is before the floor $L"; exit 1; }; git merge-base --is-ancestor d02c094f "$C" || { echo "STOP: RUN_COMMIT lacks run-gate.ts as of #350"; exit 1; }; echo "floor ok: $L, RUN_COMMIT at or after it, run-gate.ts in it"'
```

**The schedule for 2026-10-23** (main, 13:3x PDT 2026-10-22). All of it is subject to the operator
and to the Monkey Madness kit gate (RUN-ORDER.md R37):

| When (UTC) | PDT | What |
|---|---|---|
| by ~03:00Z | 20:00 on the 22nd | the overnight lab pass, only if the rehearsal chunks are green by then |
| by ~09:00Z | 02:00 | the run-eve loads done |
| 13:00Z, slid | 06:00 | the floor freeze as first set; slid to 15:00Z for rs/598 (main 04:15 PDT; fold-in 37) |
| 12:02Z | 05:02 | rs/598 on main as #487, 233d0f34 (fold-in 37, as are the rows below; main's final set, 12:08Z, superseding its 04:45 PDT set of 15:00Z / 17:00Z) |
| 12:03Z | 05:03 | the host's input check on 233d0f34, both machines: no bundle input changed, so no rebuild; step 0 running |
| 12:05Z | 05:05 | main names the run commit, 233d0f34 |
| before 14:00Z | before 07:00 | the early warm-up on both machines, after the final install (below) |
| 14:00Z | 07:00 | the floor freeze (below), 2 h before the gate series and nearly 4 h after the naming |
| 14:45Z | 07:45 | the twin re-run through H4k due (the ladder note's proof) |
| from 16:00Z | 09:00 | the gate series (step 5a) |
| ~16:15Z | 09:15 | the start, on the machine that passes |
| ~20:10Z | 13:10 | the run ends (~3.9 h at 400 ms) |
| 20:35Z | 13:35 | rs/83's daily delay sweep: skipped today |

**The run-eve freeze** (main's ruling; STEP-MANIFEST.md entry 0). The last floor is named at least
2 h before the gate series starts; after that no merge moves the floor without the line's update in
the same window.

**The early warm-up, a standing pre-freeze step** (the host's text, main ruled 11:55Z via rs/158;
fold-in 37; `up` and `gate` take `--rehearsal` and `--claim` in `run-gate.ts` at 38902b56, re-checked at the run commit 233d0f34). After the final install on both machines and before the freeze, run
`run-gate.ts up --rehearsal --claim=<owner, not host/run>` then `gate --rehearsal` on both machines,
each under its own claim, with run-gate's bot.env present. Pass lines: the served bundle's md5 equals
the built one (`curl -s http://127.0.0.1:8899/bot/client.js?v=check | md5sum` against `md5sum
~/rs-sdk/server/webclient/out/bot/client.js`); (d) measured (p10 >= 50); the scene report-only line
read (warm = sceneState 2 within a few ticks); the gate logout confirmed. Then tear down: recording
stopped with q, `tmux -L run kill-server`, ports 8899, 7780, 8090 and 9222 free, the claim released.
It warms each run profile on the final bundle and finds browser-side faults hours before the start
(today it found the stale lock, 11:16Z). Re-run it on a machine after any later rebuild there.

**Run eve** (the host thread, 10:4x PDT 2026-10-22, as written). At the floor freeze (at least 2 h
before the start), host switches both machines' timers to `install.sh --every 15` and takes the twin
with `rs-claim preempt`. From then until `run-gate gate`, no lab engine, rehearsal or install runs on
the twin. The run profile on the twin is the persistent `~/rs-run/chrome-profile`, warmed through
`http://127.0.0.1:8899` (rs/393's dress rehearsal, then the gate tab's own login, whose `scene` line
reports the warm-up in ticks, step 6). Never start from a fresh profile. A profile copied
between the two Ashburn machines keeps its cache (same origin, same Chrome major 156) after deleting
`Singleton*` and `Default/Sessions` in the copy.

**The run tab's profile is warm before it opens** (step 7, main's ruling). This step's build is the
final served-webclient rebuild unless another follows; step 7's verification login (the gate tab's,
step 6) runs after the last one, so a later rebuild means running it again. A demo restart after the
last gate pass means gating again too: it invalidates the pass, not the cache (step 7, "The restart
detector").

**The partners map matches the fleet binding, before the start is called** (rs/41 via rs/158;
fold-in 36). The run config's `partners` map (which rows each mule carrier serves) must agree with the
fleet's `mule-delivery-production.json` binding: `runner/chain.ts` uses it to find each carrier's final
row, after which #477 logs the carrier out, so a mismatch would log a carrier out before a later
hand-off it owns, which that hand-off then cannot get. Check: partners map matches the fleet binding
(generated, or a one-line diff check; **the command pending rs/41**: the run commit's
`mule-delivery-production.json` carries no `partners` map, which comes from the gitignored run config, so
the two sources are compared). A mismatch is a stop: tell main and rs/41.

**The gate account's bot.env is on both machines, before the 16:00Z gate series** (main's final set, 12:08Z; 17:00Z, then 15:00Z, before it; main 04:08 PDT via
rs/158; fold-in 36; keys from the host thread, 11:1x-11:27Z via rs/158, fold-in 37).
`~/rs-sdk/bots/<gate account>/bot.env` present on both machines (directory 700, file 600,
gitignored), holding BOT_USERNAME, PASSWORD, SERVER (the demo), GATEWAY_URL (loopback 7780),
CLIENT_URL (loopback 8899 /bot, with the demo server and the loopback gateway), CDP_URL (loopback
9222) and TELEMETRY=false. It is the same parked account as the gate timer's bot.env (rs/441's
Lumbridge probe); run-gate's `gate` reads it by the name it is given. Verify it is present on both
machines before the 16:00Z gate series (it was missing on both at 11:0xZ; the gate timer reads its
own copy at a different path). Never name the gate account, and never print the file's values.

**No stale Chrome lock on the run profile, permanent, every install** (the host's text, main ruled
11:55Z via rs/158; fold-in 37). With no Chrome on the profile (`pgrep -f
user-data-dir=$HOME/rs-run/chrome-profile` empty), the run profile holds no SingletonLock,
SingletonCookie or SingletonSocket, or the lock names the machine's current hostname (`readlink
~/rs-run/chrome-profile/SingletonLock` = `$(hostname)-<pid>`). Otherwise delete all three. Also after
any hostname change or profile copy. Why (run-ending, main): on 2026-10-23 at 11:16Z the run host's
profile held a lock naming its pre-rename hostname, so Chrome refused the profile as in use by
another computer and put an xmessage dialog on display :10; the gate tab never opened, and every
browser login would have failed on run day. Fixed on both machines, after which the run host's gate
re-run passed (scene t2, locs 116, at spawn).

**The recorded display must not blank, permanent, both machines, every install, beside the stale-lock
check** (main's wording, 11:50Z via rs/158; the host found it 11:44Z; fold-in 37): '`DISPLAY=:10 xset q`
shows screensaver timeout 0 and DPMS off; an x11grab test frame is not black'. Why: the run host's
screensaver blanked :10 after 600 s idle, so the start would have been recorded black and `handoff`
refused; fixed by an autostart entry on both machines. The details (the host): `xset q` shows
`timeout: 0` under Screen Saver and DPMS disabled; the test frame, `ffmpeg -f x11grab -video_size 1920x1080 -i
:10.0+0,0 -frames:v 1 /tmp/f.png` writes more than a few KB (a solid-black 1920x1080 PNG is about
6 KB). Fix: `export DISPLAY=:10; xset s off; xset s noblank; xset -dpms` (an `export`, since
`DISPLAY=:10 a; b; c` sets it for the first command only); the autostart entry is
`~/.config/autostart/rs-noblank.desktop`. On 2026-10-23 the recording captured black after 10 idle
minutes and `handoff`'s scored-title live frame failed (difference 55.2); after the fix it passed at
3.6.

**The cannon serve file, before SCORED logs in** (rs/41's wording via rs/158, main 04:15 PDT; fold-in 36).
Before SCORED logs in, <run dir>/cannon-serve.json holds exactly host's bytes, sha256 f0e57ad6107d2621d0c12306a5cec6ee70fe73db1a2c39e5d2a28cbfca96a7c6 (the JSON plus one trailing newline); run.ts's preflight gate "cannon serve" (run.ts:286-294) must read "H11, H23 served as the ledger rows want"; a missing file or any drift is a refusal.

**The delivery run id, before the start is called** (main 04:15 PDT via rs/158; fold-in 37; it comes
with rs/598, the runner-side delivery-session binding, on main as #487 (233d0f34, the run commit); `docs/speedrun/helpers/mule-delivery.md`, 'Run owner', lines 330-379 at 233d0f34). `delivery.run` in the run config equals every
mule carrier's launcher `deliveryRun`; `mule-ledger --check` verifies it, and any mismatch is a
refusal. the carrier configs come from the generator and check below (fold-in 37).

**The carrier configs, generated and checked on the chosen machine before the launcher starts**
(rs/41's step via rs/158, main 12:1xZ; fold-in 37; `<C>` the checkout at 233d0f34, `<R>` the run dir,
`<RC>` the resolved cue dir; `S` is SCORED's login read from its env file, never typed:
`S="$(sed -n 's/^BOT_USERNAME=//p' "$SCORED_ENV")"`):

1. **Generate:** `cd <C> && CHECKOUT=<C> SCORED_NAME="$S" bun docs/speedrun/scripts/carriers-gen.ts <RC>
   <R>/carriers.json`; it must print `serve nameHash
   678f805eb8de77cc92987a80015556fff4f40d3247ae571953a76478639d6322`. The generator is rs/41's text,
   committed verbatim (sha256 `e1424d2f9730d24f1815973c39574bf0b77b7f689d0a2c14387d33ee2fe0e9d2`): it reads `CHECKOUT`, `SCORED_NAME`,
   `docs/speedrun/research/mule-delivery-production.json` and the checkout's STEP-MANIFEST ledger
   (`slot-ledger.ts`'s `MANIFEST`), writes only its output file and prints only the serve nameHash,
   never the name. Its `deliveryRun` is the literal `a1-20261023`, so attempt 2 changes it (rs/41
   suggests a `DELIVERY_RUN` env with no default, so it cannot be silently reused).
2. **Check:** each `bun speedrun/helpers/mule-ledger.ts --check <R>/carriers.json --account
   <carrier> --rows <rows> --delivery-run a1-20261023 --serve "$S" --cue-root <RC>` exits 0 with its
   `no drift:` line: cairn_mule1, rows H1,H4,H4k,H18,H19,H21d,H22 with `--on-request H4e` (`no drift:
   H1, H4, H4k, H18, H19, H21d, H22, H4e (ask form)`); cairn_h55, rows
   H6,H4p,H7,H8,H9,H10,H12,H13,H14,H15,H16 (`no drift: H6, H4p, H7, H8, H9, H10, H12, H13, H14, H15,
   H16 (ask form)`); cairn_h03, row H20 (`no drift: H20 (ask form)`). Verified at 233d0f34 on
   bgsrv-mac with a placeholder name: the generator exit 0, all three checks exit 0 with those lines.
3. **Merge** the three entries into `<R>/helpers.json` in login order; the run config gets
   `delivery: { run: "a1-20261023", launcherConfig: "<R>/helpers.json" }`, with `muleCueDir` =
   `<RC>/mule` if set.
4. **mule-hold: NOT used for attempt 1** (main 13:15Z 2026-10-23): the carriers launch unheld in
   the roster phase and self-stage their first rows. With the hold, run.ts's first-row prepare at
   login leaves SCORED waiting ~160 ticks at H1 (the twin's live H1 with the hold measured 167 ticks
   at H1, almost all waiting); rs/598's lab run 2 proved the unheld shape with ready wait 0. **Main's wording (13:22Z): 'mule-hold: not used for attempt 1. Carriers launch
   unheld in the roster phase; the launcher must start at least 2 minutes (>= ~180 ticks) before
   step 7's login so mule1's first stand is ready (its bank-and-walk measured 72 s on the twin); the
   run-day order gives it over 5 minutes.'** Confirmed from code (rs/186; mule.ts:1252, :1326-1335;
   run.ts:659-663; delivery-owner.ts:58-59, :93-96): `syncPreparation` skips the reset when the
   package is already pending, so run.ts's first-row prepare then reuses the self-staged
   row without re-banking (helpers/mule.ts:1283-1312, runner/delivery-owner.ts:89-96), and nothing in
   run.ts's preflight needs a hold file (rs/186). `mule-hold.ts` stays in the commit, unused. The
   mule-hold text below is kept for reference only.
5. **Report:** the host sends the hash line (no mule-hold exit codes for attempt 1) and `sha256sum <R>/carriers.json
   <R>/helpers.json` to rs/41 and main before the launcher starts.

**The fleet on the run commit:** back at 29/29 on 233d0f34 at ~12:11Z, 27 while two stand-ins serve
 rs/496's twin pass (rs/41 via rs/158; fold-in 37). **run.ts's own guard** (rs/598, on main as #487, 233d0f34, the run commit; `docs/speedrun/helpers/mule-delivery.md`, 'Run owner', lines 330-379 at 233d0f34; the run config's `delivery` block is read by `runner/delivery-owner.ts:161-256`, its type `runner/chain.ts:129`; the code wins): run.ts's run
config carries `delivery: { run: "a1-20261023", launcherConfig: "<that launcher json>" }`, and its
preflight refuses with exit 3, before any login, if that is missing or does not match every mule
partner's launcher entry. That preflight is the code's own guard; rs/41's `mule-ledger --check` stays
as the operator's check. `delivery.run` changes per attempt (a1-20261023 for attempt 1, then a2-..., a3-...), like h92's serve ids below. **For attempt 1 (rs/158 at the naming, 12:05Z): the run config's `delivery.run` is exactly `a1-20261023` and matches every mule helper's `deliveryRun`**, checked before the start is called (the code's own check of the match, `runner/delivery-owner.ts:192`).

**h92 on the run commit, and its serve ids per attempt** (rs/41's wording via rs/158; fold-in 36).
h92 is applied on bbs on the run commit: fleet role cannon, serve.id a1-H11 at the Ardougne landing (2658,3301), returnTile the same, fallback (2659,3301) per SUPPLIES H11 (still pending rs/198's two-bot check), then a1-H23 on the same tile.
serve.id is per attempt: a2-H11 / a2-H23 for attempt 2, a3-* for 3; a completed a1-* record survives restarts and a reused id resumes as done and gives nothing, so rs/41 reassigns h92 between attempts.

**The inventory check, before the start is called.** On any checkout at `RUN_COMMIT` (it reads only
the repository), run

```sh
bun speedrun/tools/slot-ledger.ts
```

It walks SCORED's inventory through STEP-MANIFEST.md's "Inventory ledger" table, S00 to S27 in run
order (the starter kit, every hand-off, drop, consumption and worn change), prints the whole ledger
(each row's free slots, need and verdict, and what is held after it), and exits non-zero if any
row's need exceeds its free slots, an item leaves that is not held, or the pack passes 28. A
non-zero exit means a step would refuse at its start on the night, as S06 did at 13 free against 27
before the 2026-10-21 fixes; the failing rows go to the run-order owner, who owns the loads and
hand-offs. Rows with a `?` are listed as unknown; `--strict` fails them too.

The inventory check is rs/304's; `slot-ledger.ts` is on main since #275 (bb08bba0).

Account files: the gate account (step 6) is a throwaway demo account whose name starts with
`cairn_`, with `~/rs-sdk/bots/<gate>/bot.env` holding `BOT_USERNAME`, `PASSWORD`,
`SERVER=rs-sdk-demo.fly.dev`, `GATEWAY_URL=ws://127.0.0.1:7780`,
`CLIENT_URL=http://127.0.0.1:8899/bot?server=rs-sdk-demo.fly.dev&gateway=ws://127.0.0.1:7780`,
`CDP_URL=http://127.0.0.1:9222` and `TELEMETRY=false` (a demo account is created on its first
login). Every env file is mode 600 (`chmod 600`): the page server refuses to log in from a file other
users can read. SCORED's env file has the same keys and mode. Its path is set on run night and
written here only as `$SCORED_ENV`. It must be `~/rs-sdk/bots/<account>/bot.env`, with the directory
named after `BOT_USERNAME` (`bots/*/` is gitignored, so it stays outside git): the page server and
the run's session.ts both read accounts from `~/rs-sdk/bots`. **A precondition, by path shape only**
(rs/158, fold-in 37): on the chosen machine `$SCORED_ENV` is the file itself at
`<run checkout>/bots/<name>/bot.env`, never a copy kept elsewhere (a secrets directory, say), because
run.ts's `--bot` takes the name derived from that path (step 7, "The run-start order";
`loadBotEnv` reads `<repo>/bots/<name>/bot.env`, `lib/session.ts`) and a copy elsewhere would make
the derived name point at a missing file. Check the shape beside step 3's env check; never print the
name. **It is not put on the host until
`~/rs-sdk` is at a `RUN_COMMIT` that includes #120.** Never use a fleet or helper account for the gate.
SCORED's env file goes only on the machine step 5a chooses, after the choice. run-gate.ts enforces
the shape for both: it refuses an env file that is not `bots/<BOT_USERNAME>/bot.env` in the
checkout, is not mode 600, or has no `PASSWORD`.

**Twin:** step 0 runs there only under the run's claim and with no rehearsal attempt worktree
in use, since attempts add their worktrees from `~/rs-sdk`; if the twin is not chosen, `~/rs-sdk`
goes back to main after the run's teardown (rs/147's HOST.md, "Run-capable twin").

**Gate accounts.** Each machine has **its own throwaway gate account**: one account is in the world
only once, and the two gates run in the same minute (step 5a). Each machine's timer reads on its own
throwaway too, in `~/gate/rs-sdk/bots/gate/bot.env` (rs/249 made the twin's at 02:30Z on 2026-10-22
with rs/140's recipe: directory 700, file 600, the same keys). The two machines' prefixes differ by
design, so their accounts can be told apart without publishing either name. **Never print either
name**: this page calls them the run host's gate account and the twin's gate account. Neither is
ever one of rs/147's rehearsal accounts unless rs/147 lends it.

## 1. Preconditions: Fly edge iad, TCP connect p50 at most 5 ms

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'curl -s -o /dev/null -D - https://rs-sdk-demo.fly.dev/ | grep -i "^fly-request-id"; for i in $(seq 20); do curl -s -o /dev/null -w "%{time_connect}\n" https://rs-sdk-demo.fly.dev/; done | sort -n | awk "{ms[NR]=\$1*1000} END {printf \"TCP connect ms over %d: p50 %.1f p90 %.1f max %.1f\n\", NR, ms[int(NR/2)+1], ms[int(NR*0.9)+1], ms[NR]}"'
```

Pass: the request id ends in `-iad`, and p50 is at most 5 ms. On 2026-10-21 at 16:26 UTC, on the run
host at its old address: `-iad`, p50 1.9 ms, p90 2.6, max 2.7 over 20 (m). The twin's gate reads
showed TCP p50 1.9-2.3 ms (m, rs/149 and rs/170, 20:22-23:30Z). rs/96's gate CLI checks the same preconditions itself
before it probes, and `gate` (step 6) stops a machine as not probed when they fail, so this step is
the early warning, not the record.

## 2. The operator's remote desktop

RDP is for the pre-run steps only. Connecting creates the desktop session that Chrome and the
recording live in. The operator stays connected to check the session by eye, then **disconnects
before step 3's `up`**, which starts the recording and refuses while a remote desktop connection is
up, and watches the live view from then on. Neither the recording
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
machine, and disconnects both before step 3's `up` starts the stacks and the recordings.

After the operator connects, read which display the session is on and its geometry; it must be
1920x1080 at 24 planes. If it is not, the session predates the client settings: main ends it from
the host and the operator connects again (one desktop per user, above).

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'sudo grep "Session started successfully" /var/log/xrdp-sesman.log | tail -1; ls /tmp/.X11-unix; DISPLAY=:10 xdpyinfo | grep -E "dimensions|depth of root"; ss -tn state established "( sport = :3389 )" | tail -n +2 | wc -l | sed "s/^/RDP connections: /"'
```

The commands below use `:10`. If the log names another display, replace `:10` everywhere and pass
the same to run-gate.ts as `--display=`. `up`, `gate` and `handoff` re-check the geometry and RDP at
0 connections themselves.

**Connected or not.** xorgxrdp's X server keeps running and drawing when the client disconnects,
and Chrome's window stays mapped, so Chrome sees no change: the page's loop rate was the same
connected and disconnected, with or without the capture (m, "Measured" below). We did not read
`document.visibilityState` directly; an unchanged loop rate is the evidence that nothing throttled.
The session survives a disconnect intact. After the operator disconnected at 16:41 UTC, display :10
stayed at 1920x1080 under the same `xfce4-session` process until 17:04 UTC. Chrome kept running and
the tab stayed in game, maximised and unobscured (m). That is why the run can leave RDP
disconnected. Tenet 11 asked for it connected; tenet 12, which supersedes it, has it disconnected.
What does not change: Chrome stays maximised and unobscured on :10 with the throttling flags.

## 3. Bring up the stack on both machines: `run-gate.ts up`

**Steps 3, 5, 5a, 6 and 7 are one tool**, rs/247's `speedrun/tools/run-gate.ts` (#216, merge commit
`b1a2765d`), as rs/440 left it (#350, `d02c094f`: the twin preferred, the gate accounts relabelled,
the report-only lines). Its three subcommands replace those steps' hand-run commands: `up` (steps 3 and 5, on
both machines), `gate` (steps 6 and 5a, both machines in parallel) and `handoff` (step 7, on the
chosen machine). This page keeps each step's preconditions and pass lines as text, so it still says
what must be true; the tool checks them. #216 and #350 are gate tooling, not run-commit floor items,
like #208 and #213: whether or not a floor's history contains them, step 0's floor check verifies on
its own that `RUN_COMMIT` contains #350, and so #216.

Run it on the Mac from a checkout at `RUN_COMMIT`, with `RS_RUN_HOST`, `RS_TWIN_HOST` and
`RS_RUN_TAILNET` set locally ("The host"). It reaches each machine over this page's exact ssh lines
and runs there from `~/rs-sdk` at `RUN_COMMIT`, detached under its own `timeout`, so a dropped ssh
line ends only the Mac's view of a step, never the step. Each machine keeps its outputs in
`~/rs-run/gate-<UTC>/` (`steps.log`; the gate's `direct.json`, `loops.jsonl` and `verdict.json`; the
hand-off's `handoff.json` and live frames), and the Mac keeps a copy of every log and each choice in
`~/rs-run-gate/`. Any failed precondition or pass line stops it with one `STOP:` line and a non-zero
exit. It never repairs the recorded display: the only window it closes is the gate Chrome, by rule
(step 6).

**Exit codes**, the same for all three: **0** a pass (for `gate`, a machine chosen); **1** a pass
line failed (for `gate`, no machine passes); **2** a precondition refused or a tool failure, in any
of the three (every `handoff` refusal among them); **3** re-measure ((c) failed, or (d) marginal).

**Before `up`, on each machine.** run-gate.ts checks neither of these two.

**Before any login, every checkout that launches a client has its dependencies** (rs/147's finding;
main, 20:58 PDT 2026-10-21). `bun install --frozen-lockfile` has been run in **both the repository
root and `server/webclient`** of every checkout that launches a client: **the run host's and the
twin's `~/rs-sdk`** (step 0's command does both) and **every checkout on bbs** that launches one, the
fleet's and any other deploy there (`fleetctl update` does both for the fleet's). On 2026-10-21
rs/269's bbs dropper deploy, a `git archive` of the fleet commit, lacked
`server/webclient/node_modules` (fflate), so its lite clients exited in 20 ms; it was fixed before
any login. On each Ashburn machine, expect `dependencies ok` (`up` checks only that the client is
built):

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'export PATH=$HOME/.bun/bin:$PATH; cd ~/rs-sdk && bun install --frozen-lockfile >/dev/null && (cd server/webclient && bun install --frozen-lockfile >/dev/null) && echo "dependencies ok"'
```

No command on this page reaches bbs: the fleet's owner (rs/41) confirms it for every bbs checkout
that will launch a client, as it reports its login count (step 7).

**The env check, before a tab's login** (rs/287 and rs/312; main, 23:52 PDT 2026-10-21). The tab
account's `bot.env` must carry the loopback `GATEWAY_URL` and the `CLIENT_URL` and `CDP_URL` lines
exactly as step 0's "Account files" gives them, at mode 600. Without `CLIENT_URL` and `CDP_URL` the
run scripts cannot mint a token or re-navigate the tab (a missing pair cost a load check on
2026-10-22). Without a loopback `GATEWAY_URL` the client silently goes through the demo's public
relay, which adds a round trip to every click; that made S00's guide talk miss its 12-tick window on
a fresh account (rs/287). On the floor `openSession` also refuses a demo world without a loopback or
direct gateway (rs/312, #250), so a bad env stops the run script rather than slowing it, but this
check finds it before any login. run-gate.ts checks an env file's place, mode and `PASSWORD` (step 0,
"Account files"), not these three lines. Run it for each machine's gate account before `gate`, and
for `$SCORED_ENV` before `handoff` (step 7). It prints no value, only what is missing, and the mode.
Expect only `mode 600`:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'ENV=$HOME/rs-sdk/bots/GATE_ACCOUNT/bot.env; for k in "GATEWAY_URL=ws://127.0.0.1:7780" "CLIENT_URL=http://127.0.0.1:8899/bot?server=rs-sdk-demo.fly.dev&gateway=ws://127.0.0.1:7780" "CDP_URL=http://127.0.0.1:9222"; do grep -q -x -F "$k" "$ENV" || echo "missing or not loopback: ${k%%=*}"; done; echo "mode $(stat -c %a "$ENV")"'
```

**The helpers' env files** carry no `GATEWAY_URL` at all, and need no line here: rs/117's launcher
gives every lite client its own loopback gateway and refuses a `bot.env` whose `GATEWAY_URL` would
bypass it (`speedrun/helpers/standalone.ts`; HELPERS.md, "Credentials"), so the tick-exact helpers
cannot reach the relay either.

**`up`**, on both machines, once the operator has disconnected (step 2). Bounds: the stack, the
recording and the live view `T=9h`, or `T=30m` with `--rehearsal`:

```sh
bun speedrun/tools/run-gate.ts up --claim=run
```

`--machines=run` or `--machines=twin` brings up one machine. A rehearsal adds `--rehearsal` and runs
under its own claim, `--claim=rs/NNN` (never `host` or `run`). On each machine `up` checks these
preconditions in order and stops on the first that fails:

- a live claim (with `--claim=run`, the run's own; it touches it);
- display `:10` at 1920x1080 and 24 planes (step 2), and **RDP at 0 connections**, since the
  recording starts here;
- no `run` stack already up, and ports 7780, 8899 and 8090 free;
- a built client, `server/webclient/out/bot/client.js` (step 0's build).

Then it starts the tab's SDK gateway (`127.0.0.1:7780`) and the page server (port 8899; it redirects
a bare `/bot` to `?server=` the demo and `?gateway=` the loopback gateway) in sessions `gateway` and
`page` of `tmux -L run`, and requires these pass lines:

- both ports listening;
- the bare page answers `302` to `http://127.0.0.1:8899/bot?bot=x&server=rs-sdk-demo.fly.dev&gateway=...`;
- a password in the URL answers `400` (**requires rs/138 on RUN_COMMIT**).

Last it starts the recording and the live view (step 5) and requires the recording's frame counter
to advance. It opens no Chrome: `gate` opens the gate account's tab, and `handoff` SCORED's.

**Served = built, on each machine after `up`** (step 0, "What identifies a build"). The page server
serves `server/webclient/out/bot` per request, so it must serve exactly what this checkout built.
Expect `served = built`, and record the md5 and commit it prints, with the machine's name, in the
run's record; never compare that md5 with the other machine's:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'cd ~/rs-sdk && curl -s -f -o $HOME/rs-run/served-client.js http://127.0.0.1:8899/bot/client.js && if cmp -s $HOME/rs-run/served-client.js server/webclient/out/bot/client.js; then echo "served = built: md5 $(md5sum <server/webclient/out/bot/client.js | cut -c1-32), commit $(git rev-parse HEAD)"; else echo "STOP: the page server serves a different client.js than this checkout built"; fi'
```

**Chrome.** Every tab opens on the bare page `http://127.0.0.1:8899/bot?bot=<name>`, which carries
no secret and waits on the title screen. **Logging in is a separate command**,
`speedrun/tools/tab-login.ts`. It asks the page server for a one-time token (single use, 60 s,
loopback only, minted only for a caller that holds the env file) and navigates the tab to it over
Chrome's DevTools port. The page strips the token from its URL and exchanges it with the page server
for the credentials, which it keeps in memory only. Neither the password nor the token is ever a
process argument (speedrun/README.md, "Logging the browser tab in"; cairn://p/rs/138). Both
**require rs/138 on RUN_COMMIT**. **Running tab-login is the account's login; opening the tab is
not.**

`gate` (the gate account's tab, bound `15m`) and `handoff` (SCORED's, `T=9h`) both open the tab with
this line, in session `chrome` of `tmux -L run`, and log it in with tab-login (bound 3 min; it gives
up by itself after 120 s). For reference, not to paste:

```
exec timeout --kill-after=30s <bound> env DISPLAY=:10 google-chrome --user-data-dir=$HOME/rs-run/chrome-profile --remote-debugging-port=9222 --no-first-run --no-default-browser-check --password-store=basic --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --start-maximized --app="http://127.0.0.1:8899/bot?bot=<name>"
```

Why each flag:

- the three `--disable-background...` flags are tenet 12's (carried over from tenet 11): no timer, renderer or occlusion
  throttling;
- `--user-data-dir` gives the run its own Chrome. If another Chrome is already running on the default
  profile, a plain `google-chrome` only opens a window in that process and **its flags are lost**;
  a separate profile always starts a fresh browser with these flags (i: Chrome's single-instance
  behaviour per profile). The gate tab and SCORED's share it, which is what warms SCORED's (step 7);
- `--app=` opens a window with no address bar. Its URL carries only the account name.
  `--start-maximized` fills the 1920x1080 session (the window measured 1920x1029 below XFCE's top
  panel, m);
- `--remote-debugging-port=9222` is how tab-login.ts navigates the one tab, and how the run's
  session.ts does on a watchdog relaunch. It needs the separate `--user-data-dir` (Chrome ignores it
  on the default profile). Anyone who can reach that port can drive the tab and read its memory, so
  keep the host single-user;
- `--password-store=basic`: **every Chrome that a demo or the run attaches to over CDP carries it**,
  launched by hand or by script (main, from rs/41's bbs probe; relayed by rs/158 at 08:31 PDT
  2026-10-22). Without it Chrome's keyring lookup hangs forever on a host with no D-Bus session, as
  on the Ashburn machines, so a scripted Chrome there never commits an http navigation (rs/410, the
  run host, 15:11Z), and on bbs it delays the first navigation by about 25 s. run-gate.ts's line and
  Puppeteer launches pass it;
- `--no-first-run --no-default-browser-check` keep the first-run dialogs away.

**The tab's pass lines**, which the tool checks after each launch:

- the six flags on the browser process: the three throttling flags, `--start-maximized`,
  `--remote-debugging-port=9222` and `--user-data-dir` on `rs-run/chrome-profile` (not
  `--password-store=basic`, which its own launch line carries);
- **exactly one Bot Client window, 1920 wide** (`xwininfo -root -tree`): a hard check of
  `handoff`, before SCORED's login and again after it;
- after the login, **the secrets check, `0 0 0`**: processes showing the password, processes showing
  `token=`, and tab URLs showing either. The tool runs it in process, so no command line holds the
  password. For SCORED, since main's 12:10Z ruling (fold-in 37), the login is run.ts's:
  `handoff --no-login` runs the secrets check at the title screen, and the operator runs it again once
  SCORED is in world (step 7, "The secrets check runs twice").

## 4. Helpers on the run machine (rs/117)

**Where they run: on SCORED's machine, logged in before SCORED** (main's plan of record, 16:35-16:36
PDT 2026-10-21). At the gate only the **opening roster**, S06's 7 air-altar givers, is logged in, on
**each** candidate machine, so each gate is read under the opening load (main, 16:14 and 16:36
PDT). After step 5a chooses, the bone and trade givers log in on the chosen machine before SCORED;
S21's givers later, inside SCORED's relog before S21, and the S18 courier and the S25a anvil helper
only for their own steps ("The per-address login plan", below); and the other machine's 7 log out. So both machines carry the launcher at RUN_COMMIT and, on run night
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
  is one address and one bucket, so login order decides: **a step's givers are in before SCORED's
  last login ahead of that step, and never relog after it**: S06's before SCORED's first login, S21's
  inside SCORED's one in-page relog ahead of S21, before its login ("The per-address login plan", below). A giver
  relaunched after that comes back behind SCORED, and its turns run robust at 8 until SCORED's next
  relog: about 7 ticks for the craft lost in the cue plus
  1 per later turn of that giver, at most ~15 over S21 for one crash with 22 givers (m, lab, rs/163:
  back in the world 54-74 ticks after a SIGKILL, exactly 1 turn missed, later turns 8, 3 of 3
  repeats on the direct path; RUN-ORDER.md R12).

**Cue scope** (main's ruling, 05:1x PDT 2026-10-22: a cue is scoped to one step and one giver
family, never a global stop). In rs/186's final wording, on main since 2538b7d8 (#313): "Every
reader role takes a required `scope` in its launcher options: {S06|S21, altar}, {S07, bone},
{S18, courier}, {S25a, anvil}, {S14|S27, cannon}. Before each step whose helpers read a cue, run.ts
writes a fresh cue with that step's scope (no stop). `session` remains the per-login key. A cue
without a scope is refused." The readers and the runecraft.ts and woodcutting.ts writers are on the
floor.

**One writer per helper step's cue** (main, 11:5x PDT 2026-10-22; rs/186). rs/186's wording has
run.ts write every step's cue; main's rule names exactly one writer for each helper step:

- S06 and S21 {altar}: `runecraft.ts`;
- S07 {bone}: `woodcutting.ts` (rs/436, on main since `d35ec6e3`, #357), scoped
  `{step: 'S07', family: 'bone'}`;
- S18 {courier}, the mule rows {Hx, mule} and the cannon {S14|S27, cannon}: run.ts, through
  `handoff.ts`;
- H12oM and H12oP {mule}: **the Monkey Madness module** (run.ts writes none; rs/201 exec 9,
  c5288dac; the other mule hand-offs stay with run.ts); cairn_h45 reads them on rs/483's carried
  mode and the launcher logs it in on H12oM's cue and out on H12oP's stop (fold-in 31);
- S25a {anvil}: run.ts, unless smithing.ts writes its own (pending rs/186);
- S04 {ring}: **run.ts's chain, through `cueAround`** (r, rs/186 at the run commit 233d0f34: S04
  built as `cueAround(s, FAMILY_CUES.S04, o.cues)`, `runner/chain.ts:678`, `FAMILY_CUES.S04`
  `:316`, 'ring' in `CUE_FAMILIES`, `helpers/altar-cue.ts:68`; `cueAround` at `chain.ts:324-336`
  opens the scope fresh when S04 starts, writes the final stop on success and a non-final, failed
  stop on a throw). magic.ts writes no cue, and the three ring givers' launcher `stopOn {S04, ring}`
  is the only reader. **Proven** (main 12:50Z via rs/158; fold-in 38): rs/607 ran the real chain from
  a scratch tree of exactly 233d0f34, and the launcher logged 'final stop for S04/ring (seq 2):
  stopping role mule and logging out now' 0.06 s after S04's row closed, all three givers 'out of
  the run on its stop cue (logout: out)'.

rs/393 adds a test that each helper step has exactly one writer. The run.ts writer is rs/186's and
still pending (STEP-MANIFEST.md entry 33). **The fleet restarts once
on 2538b7d8 or later**, so every reader, the fleet's on bbs included, has the scoped launcher
options; that restart, like every update, keeps step 0's deploy rules. The run machines' launcher
runs from `~/rs-sdk` at `RUN_COMMIT`, which the floor puts after 2538b7d8.

**A sixth family, `mule`** (rs/429; its reader, `speedrun/helpers/mule.ts`, is on main in fleet
snapshot 8, merge `c9472897`, #353; relayed by rs/158 at 10:30 PDT 2026-10-22). mule.ts serves H12's `Shark topUp {max: 15}` from an ask that SCORED writes on the
first open-trade frame. **A scope's `step` is the step id for altar, bone, courier, anvil and cannon,
and the hand-off id for mule**, for example `{step: 'H12', family: 'mule'}` (rs/158's cue scope
contract, agreed by rs/186 and settled by rs/41 with rs/186, 2026-10-22). run.ts names mule1's
package in that cue before every mule1 hand-off, with queue order as the fallback. So the families
are six: altar (S06, S21), bone (S07), courier (S18), anvil (S25a), cannon (S14, S27) and mule (by
hand-off id, H12 in S15). The scope by hand-off id is **pending fleet snapshot 9** (commit 2c38a339 on
rs/41's branch): until that is on main and the fleet is deployed on it, the mule cue's hand-off-id
scope is not in force, and rs/393's writer is pending likewise.

**On run night the opening roster logs in on both machines after `up` and before `gate`** (step
5a), so each gate is read under the opening load.

**Which helpers the rule binds:**

| Helper | Tick-exact? | Where |
|---|---|---|
| S06 air-altar givers (7: h70-h72 and e11-e14) and S21 body-altar givers (22) | yes: the 7-tick cycle schedules their packets (R12) | SCORED's machine: S06's before SCORED's first login; S21's late, inside SCORED's in-page relog ahead of S21 (below) |
| Trade givers (2): the hand-offs, H4m, S18's top-ups, the wine (SUPPLIES.md) | tick-sensitive: an S18 top-up must finish by stun + 9 (R16), the wine's bank by login + 19 (R17) | SCORED's machine, before SCORED |
| S07 bone givers b01-b04 | no: SCORED's loop stops, receives and restarts, and a refused request costs SCORED 0 because the giver re-sends on the next tick (m, lab, rs/141) | SCORED's machine with the roster (rs/117's launcher, SUPPLIES.md H4.1); their machine decides no cycle, but they count in the load check |
| S18 courier e15, scope {S18, courier} | no | SCORED's machine, in rs/41's on-address roster; logged in for S18 only (below) |
| S25a anvil helper a01, scope {S25a, anvil} | not ruled here; run machine only (HELPERS.md) | SCORED's machine, in rs/41's on-address roster; logged in for S25a only (below) |
| Cannon helper (H11, H11r, H23; h92), carp helper, lookouts | no | the home address (bbs fleet); their machine doesn't matter |

**Browser tabs on bbs don't receive the region's locs** (m, rs/359, 11:25Z 2026-10-22, a dated
observation): a browser tab on bbs had 0 locs and 16 npcs from the demo world after 65 ticks, in 3
tries. So any browser demo or rehearsal that clicks locs runs on the Ashburn machines, never on bbs.

**Helpers on the other machine are off for attempt 1** (main 23:1x via rs/158; fold-in 34). The cue
protocol is local-filesystem IPC: a cue and a status are files on the machine that writes them, so a
giver on the other machine cannot read SCORED's cue, and a relay would need `RUN_COMMIT` code. The
R12 rule stands: tick-exact givers on SCORED's machine, logged in before SCORED. So the group table
above no longer decides placement. The earlier alternative, givers on a lower-group machine preceding
SCORED whatever their login time (on the current addresses, the run host's group 3 before the twin's
4), needed a cross-machine cue (rs/196 to scope), rs/196's auto rule keyed to "handled before
SCORED" rather than login order (STEP-MANIFEST.md entry 9), and, on the relay path, rs/225's relaunch
fix (a relay giver misses 3 turns per crash until it lands, m, lab, rs/163, against 1 on the direct
path); it stays off unless main reopens it after attempt 1.

**Load and logins.** The chosen machine carries SCORED and ~35 helpers on the body plan (7 air, 22
body, 4 bone, 2 trade givers), plus the courier and the anvil helper for their steps, never all at
once: at most 26 on its address at a time ("The per-address login plan", below). The giver-load check runs every co-located helper as lite clients
beside a scored-style tab with recording; it passes at tab loop rate (d) p10 of at least 50 per
second and recording at 29 fps or more with 0 dropped (main and the host thread, 16:18-16:36 PDT).
It is **pending (rs/host, with rs/41 and rs/214)**: at the 22-giver point (00:35-00:52Z on
2026-10-22) all 22 logged in in 190 s (m, rs/214) but the tab side never started, so there is no
(d) or fps reading; the ~34-client body point is booked for 01:00-01:25Z. The ~65-client nature
point runs only if rs/194 reports 4 or more nature talismans before the run's eve (main, 17:07 PDT;
RUN-ORDER.md O41). Around 25-36 logins on one machine was ruled fine on the swarm side (main, 16:24
PDT; "~20 a machine" was an observation, not a cap). The demo's bound is 50 an address and ours is 45
("The per-address login plan", below).

**How.** The tick-exact helpers (the Runecraft altar givers, the trade giver, the wine giver, the S07 bone givers) run on this
machine through rs/117's launcher, `speedrun/helpers/standalone.ts`, from this same checkout, on their
own loopback gateway (7795 by default). How to configure, start and stop them is
[HELPERS.md](HELPERS.md), "Helpers on the run machine" (cairn://p/rs/117); this page doesn't repeat
it. **Every run-day helper runs a headless client** (fold-in 34; rs/186's confirmed wording, 22:3x):
lite, or the direct path's in-process client, never the browser client. The browser client sends
`IDLE_TIMER` after 10 minutes without input (`server/webclient/src/client/Client.ts:4926-4933`, its
AFK logout), which idles a helper out during a stand-down. The connection paths are unchanged (the
S06 and S21 altar givers on the direct path); rs/41 is confirming that the in-process client never
sends `IDLE_TIMER` either. The one ordering rule that touches this runbook: **the helpers are logged in before SCORED's tab
opens** (the launcher's `helpersReady`), because login order decides the 7- or 8-tick Runecraft
cycle. Every helper counts against the 80-login cap from its login until it logs out (step 7), and against
its address's per-IP cap (below). With S21's altar givers in from the start, SCORED's run login was
the peak (SUPPLIES.md, "Peak concurrent logins"); under the per-address plan below, rs/41's map puts
SCORED's address at 25 at the start (24 helpers + SCORED, step 5a.4; fold-in 36: rs/41's correction, the roster being 17, 4 + 6 + 3 + 4; 24 written at fold-ins 34-35 on a count of 16) and 26 during S21's ramp (SCORED, mule1, mule2, a01 and the 22 S21 givers, h03 counted under main's 19:3x ruling; unchanged by the 17, rs/41; the worst case 27, + h94 on an R8 death, all under 45; 29 before #477, e7e54a11, rs/590 snapshotted as rs/592: each mule carrier's last hand-off now stops its cue final, so no carrier idles logged in after its last row, and #472 made P's stop final). At the gate the 7 opening givers on **each** machine count, 14 in all. After a demo restart the helpers come back by relaunching rs/141's headless
lite-runner child processes (`fleet.ts`, `standalone.ts`), not tabs: the OS closes the old child's
gateway socket when it exits, so there is no gateway takeover (inferred from the code; owned by
rs/41), and the earlier lite restart measurement read 3 in-world ticks after the relogin
(`RESILIENCE.md` section 6).

**The per-address login plan** (main, 13:3x-13:4x PDT 2026-10-22, via rs/158; rs/41's address map,
accepted by main at 14:1x PDT; RUN-ORDER.md R43). One run machine is one address, so SCORED's
machine carries SCORED, its gate account until the gate's kill, and every helper launched there.
**SCORED's run-day address is most likely the twin's** (rs/41's map; the twin is the gate's default
preference, step 5a), but the gate still chooses (tenet 17), and the plan holds on either machine:

- **The cap.** The demo's operator caps simultaneous logins at **50 per IP** (public Discord, 13:2x
  PDT; it may rise). **Ours is 45 per address**, the working figure since main accepted rs/41's map.
  Tenet 16's 80, summed across every host, applies beside it (step 7).
- **The peak per address** (rs/41's map): **25 on SCORED's address at the start (S01: the 7 air givers, the 17 roster logins and SCORED; rs/41's start order, main ruled; fold-in 36: rs/41's correction, the roster being 17, 4 + 6 + 3 + 4; 24 written at fold-ins 34-35 on a count of 16) and 26 during S21's
  ramp**, inside SCORED's relog before S21 (the worst case 27: + h94 on an R8 death; no carrier idles logged in after its last row since #477, e7e54a11, rs/590 snapshotted as rs/592, and P's stop is final since #472; rs/41). All under 45.
- **The home address on run day, a run-day rule:** the home machines (bbs and every executor) carry
  **29 fleet accounts plus the cannon helper**, and nothing else, with **one named exception** (main 17:0x via rs/158, fold-in 31): **R8's spawn helper** (rs/526; a fleet spare, never named here), parked logged out beside the Lumbridge respawn tile, with 0 run-day logins, or 1 cued login on a player-kill, logged out after its trade. No development sessions and no
  executor demo logins run from them on run day (rs/41's map, via rs/158).
- **Families log out when their step is done:** after S03, S04, S06 and S07, that step's helper
  family logs out when the step's scope closes (its final stop cue, or the next scope's cue). After
  rs/491 (rs/41's c97bc1c5; on main in fleet snapshot 11, #451, ee75d700) a plain stop only stands a helper down; the
  launcher logs it out on a stop carrying `final: true` (rs/490 writes it on each family's last stop
  and on abort) or on a later scope's cue.
- **S21's body-altar givers log in inside SCORED's relog** (rs/186's ruling to rs/490; fold-in 31):
  **SCORED logs out on arrival at S21, the givers log in and report ready with SCORED out, SCORED
  logs back in in-page behind them, then the first trade. The ramp is off SCORED's clock.** The
  relog is split into a logout half and a login half under one budget entry, and rs/511 counts the
  logged-out window as planned, not a drop. **As built, run.ts does otherwise**: chain.ts:563 runs
  runecraft's preLoginStep (it opens the {S21, altar} cue and waits for all 22 givers to report
  ready) while SCORED is in game, then relogs, so SCORED would sit logged in through the ramp
  (~500 ticks at 400 ms); the fix is rs/490's, a start condition until it is on the floor
  (RUN-ORDER.md section 1). The 22 givers log in during it, not before SCORED's first login: about 3.5 wall minutes
  through the launcher's limiter (rs/41; 22 logins took 190 s, m, rs/214). SCORED's login closes the
  relog after the last of them, which re-appends it at its group's tail behind them, so they are
  handled first and the cycle stays at 7 (R12; the in-page relog is `login(session, {inPage: true})`,
  step 7).
- **The courier and the anvil helper log in for their own step only:** the courier for S18, scope
  {S18, courier}, and the anvil helper for S25a, scope {S25a, anvil} (rs/41; their names are in the
  roster table above). Their credentials go to SCORED's machine with the rest of the on-address
  roster (rs/41; "Credentials"). Anything this page prints names them by role, `courier` and `anvil`,
  never by account, as the gate accounts print only as `GATE-run` and `GATE-twin` (step 5a.3).
- **The atoll helper, H12o** (cairn_h45, rs/483's carried mode), is cued by the Monkey Madness
  module, not run.ts: H12oM's cue as M leaves Zooknock, ~300 ticks before the ladder top, and
  H12oP's stop after P's leg; the launcher logs h45 in on H12oM's cue and out on H12oP's stop
  (fold-in 31; SUPPLIES H12o-M and H12o-P; its two ledger rows since fold-in 28).
- **Triggers.** The family logouts, the late logins and SCORED's relog are triggered by
  run.ts (H12o's cues by the Monkey Madness module) and acted on by rs/41's schedule. run.ts is rs/186's and not on main (main has only
  `speedrun/lab/quests/run.ts`), and the schedule is rs/41's: **both pending**. On main nothing
  triggers them.

**Where the code differs** (r, main): a cue's `stop` stands its readers down (`altar-cue.ts`, no
action on a stopped cue) but logs nobody out. A family's logout is the launcher's own stop (SIGINT
or SIGTERM, then each account clicks logout; `standalone.ts`), so until run.ts and rs/41's schedule
are on main, a family's logout is that launcher's stop. The launcher spaces logins by
`loginSpacingMs`, 5 s by default. Neither `handoff`'s count (`--cap`, 80) nor `rs-claim take`'s (100)
counts an address: both are totals across every host, and nothing on main counts logins per
address. So 45 an address is the operator's check against rs/41's map. No address goes on this page,
and account names only in the roster table.

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

## 5. The recording and the live view (`up`)

The recording is captured on the VM itself, not over RDP: ffmpeg grabs the session's X display
(r: main, 09:13; rejected: recording at the Mac end over RDP). `up` (step 3) starts it **before the
gate and before SCORED's first login**, so the gate is measured with the capture running, as in the
run, and `handoff` refuses unless it is running and advancing (step 5a, hand-over line 3). `up` runs
it in session `rec` of `tmux -L run`, writing `~/recordings/run-<UTC>.mkv` (`rehearsal-<UTC>.mkv`
with `--rehearsal`). At the bound (`T=9h`, or `T=30m`) `timeout` sends SIGINT, which ffmpeg treats
like `q`: it finishes the file. Its line, for reference, not to paste:

```
exec timeout -s INT --kill-after=30s $T ffmpeg -hide_banner -loglevel warning -f x11grab -draw_mouse 1 -framerate 30 -video_size 1920x1080 -i :10.0+0,0 -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -progress ~/recordings/ffmpeg-progress.log ~/recordings/run-<UTC>.mkv 2>>~/recordings/ffmpeg.log
```

The line is main's decision (x11grab, 1920x1080, 30 fps, libx264 `-preset veryfast -crf 20`) plus
three choices made here (and the bound, above):

- **`.mkv`**: a Matroska file stays playable if ffmpeg or the machine dies mid-run, where an MP4 is
  unreadable without the index written at the end (i). Remux on the Mac if MP4 is wanted:
  `ffmpeg -i run.mkv -c copy run.mp4`.
- **`-pix_fmt yuv420p`**: from an RGB grab, x264 otherwise encodes 4:4:4, which QuickTime and most
  players and sites will not play (i).
- **`-progress`**: ffmpeg's frame, fps and drop counters, read by the gate sampler, by run-gate.ts's
  advancing-frame check and by the check below. No audio is recorded.

Size: 7.2 Mbit/s at 30 fps in game, about 3.3 GB an hour (m: 288 MB in 318 s, 16:41-16:47 UTC; i: per
hour), against 51 GB free (m, 16:15 UTC); the disk holds well over ten hours. A run of about 3.9 h
at 400 ms is about 13 GB (i).

**The live-frame pass line** (step 5a, hand-over line 4). The fps and drop counters say the capture
is running, not what it shows. Before SCORED's login a frame of the capture must show the run tab,
with nothing in front of it; a wrong window costs the run's evidence, not ticks (RUN-ORDER.md R20).
It is a pass line of the start, beside the gate's (a)-(d): no start until it holds. `handoff` checks
it, before SCORED's login and again in game: the window in front is the run tab, and an x11grab
frame of the display matches the page's own screenshot (rs/232's `speedrun/lib/display.ts`
`frontWindows`, `grabFrame` and `frameShows`, with `speedrun/lib/tab.ts` `screenshotTab`; pass at a
mean grey difference of at most 12/255, against 1.1 for the same window and 54.9 for a different
one). It waits up to 20 s for a conclusive look and never raises or touches a window. Those helpers
are on main, 5d22252d (#208) and c4b79f17 (#213), gate tooling rather than floor items (the floor
contains them). The operator can also see it on the live view (below).

**Why RDP stays disconnected during the run.** With the operator connected, the capture kept real
time but wrote only about 23 distinct frames a second (2,389 of ~10,700 dropped over 6 minutes).
Disconnected, it wrote 29.9 a second with none dropped (m, "Measured"). The capture is not short of
CPU: it used under one core of eight in both cases. The likely cause is the live RDP session's
screen updates competing with the grab for the X server (i). The game is unaffected either way.
Check the recording during the run with:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'grep -E "^(frame|fps|drop_frames|dup_frames|speed|out_time)=" ~/recordings/ffmpeg-progress.log | tail -6; ls -la ~/recordings; df -h / | tail -1'
```

**The operator's live view**, started by `up` with the recording and left running until teardown,
in session `live`. It is a 3 fps, 960x540 MJPEG stream, view-only, which the operator opens in a
browser. On the run host `up` binds it to the tailnet address only (`$RS_RUN_TAILNET`, from the Mac's
shell), never the public one, at `http://$RS_RUN_TAILNET:8090/live.mjpg` (over Tailscale, like RDP).
ffmpeg's `-listen 1` serves one viewer and exits when that viewer leaves, so it runs in a loop; a
reload reconnects. It is a **separate low-rate grab, not a second output of the recording's
ffmpeg**: an HTTP `-listen` output blocks its process until a viewer connects and fails when the
viewer leaves. Inside the recording's process that would hold up or end the recording (i). As its
own process, it can come and go without touching the recording file. At its bound the signal reaches
the loop's shell and the ffmpeg inside it.

It costs 3.7% of one core (m: `pidstat` over 40 s, 16:53 UTC, ~150 kbit/s), and the recording
beside it still wrote 29.7 fps with no drops (m: 70 s, 16:54 UTC). It was tested with `curl` on the
host (217 frames in 72 s). Teardown stops it with the rest of the stack (or
`tmux -L run kill-session -t live` on its own).

**Twin:** there is no tailnet address to bind, so `up` binds the twin's live view to
`127.0.0.1:8090` (`run-gate up --live-bind=127.0.0.1`), 3 fps MJPEG at 960x540, view-only with no
input. Until the operator authorises Tailscale on it, watch it through this tunnel, run on the
operator's Mac (the host thread, relayed by rs/158 at 10:4x PDT 2026-10-22, as written), then open
`http://127.0.0.1:8090/live.mjpg`:

```sh
ssh -N -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_rehearsal -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_rehearsal -o StrictHostKeyChecking=yes -o CheckHostIP=no -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -L 8090:127.0.0.1:8090 ubuntu@"$RS_TWIN_HOST"
```

The operator's remote desktop stays disconnected throughout (tenet 12). The tunnel is one ssh
session: if it drops, the view stops and the recording on the machine does not (i). On the twin
`curl` received 23 JPEG parts in 6 s from the live view (m, rs/149, 20:32 UTC). The twin's recording
beside its gate tab wrote 29.91 fps with 0 dropped (m, rs/149, read 5), and 29.9-29.97 fps with 0
dropped under run-gate.ts (m, rs/247, "Measured: run-gate.ts rehearsed on the twin").

## 5a. Choose the machine: `gate` on both

SCORED's machine is chosen by the gate immediately before the start, not named in advance (tenet
17). Both machines have been through steps 0-5: claimed, on RUN_COMMIT, the tab stack up, the
opening roster (S06's 7 air-altar givers) logged in on each (step 4), the recording and the live view
running, RDP disconnected. **Rehearsals are paused on both machines** from the start of the gate series on run day until the
scored run's teardown, meaning SCORED's hiscore row has landed at its final logout and the recording
is stopped (main, 19:00 PDT 2026-10-21; tenet 17). Rehearsal logins and their helpers count against
the same per-address caps (the operator's 50 and our 45; step 4, "The
per-address login plan") and 80 working cap as the run's own roster, which peaks near 72 under the
nature plan, and going over costs the run. No rehearsal claim may run into the gate series, and an attempt in
flight pauses at its next step boundary once the run's claim appears (rehearse.ts, `--claim-owner`;
speedrun/README.md, "Under a claim").

**The expected machine is the twin** (main's ruling, relayed by rs/158 at 10:4x and 10:5x PDT
2026-10-22; "The host"): the twin passed 17 of 17 of rs/83's final-address pairs, and the run host
is the fallback pending 4+ clean pairs on its new address (rotated 17:39Z). Both are still gated in
the same minute (tenet 17): a gate read is a dated read of each route, and the choice is made on it.

Before `gate`, on both machines: `up` passed (step 3); the opening roster is in (step 4); the gate
account's env check passed (step 3); the quiesce check is clean (step 6); and each gate account
stands at the Lumbridge spawn, so its tab's login is also the run profile's warm-up (step 7).

**The demo's tick length, read before the gate series** (main's ruling, relayed by rs/158 at 13:1x
PDT 2026-10-22). Right before `gate`, read the tick length the demo announces on its spectator feed
and record it in the run's record: the feed's first message, `hello`, carries `tickMs`, the
engine's `World.tickRate` (`server/engine/src/web/worldfeed.ts`). It is read again right before the
run tab opens (step 7, the hand-off), and **a change between the two readings means stop: no
start**. The value goes beside the warm-up's bundle token (step 7). On the Mac; the command opens
the feed, prints the `hello`'s `tickMs` and closes, with its own 10 s limit:

```sh
bun -e 'const ws = new WebSocket("wss://rs-sdk-demo.fly.dev/worldfeed"); const t = setTimeout(() => { console.log("no hello within 10 s"); process.exit(1); }, 10000); ws.onmessage = e => { const m = JSON.parse(String(e.data)); if (m.t !== "hello") return; clearTimeout(t); console.log(new Date().toISOString().slice(0, 19) + "Z demo tickMs " + m.tickMs); ws.close(); process.exit(0); }; ws.onerror = () => { console.log("world feed refused the connection"); process.exit(1); };'
```

It printed `demo tickMs 400` at 20:10Z on 2026-10-22 (m, rs/469, from fedora (bginf-halo); "Measured: the
demo's tick period"). The demo has run 400 ms ticks since its 19:56:29Z restart that day (300 ms
before it). Tenet 12's (a) is counted in ticks and is unaffected; (b) and (c) are fractions of
the tick length T on main since #385 (a4456c73, rs/471; fold-in 31; step 6, line 2).

1. **Gate both in the same minute: `gate`.** It runs step 6 on both machines in parallel, each on
   its own gate account, and refuses the same account twice (one account is in the world only once).
   The two names are typed on the Mac and never committed. Bound: 40 min a machine:

   ```sh
   bun speedrun/tools/run-gate.ts gate --gate-run=RUN_GATE_ACCOUNT --gate-twin=TWIN_GATE_ACCOUNT --claim=run
   ```

   Same-minute reads compare the two delivery paths on one server minute: on 2026-10-21 the
   server's own tick distribution was the same on both machines to the millisecond while one
   address's path held ticks (m, the host thread's pairs, 21:00-23:00Z). If one machine can't be
   reached, `--machines=twin` (or `run`) gates the other alone; the tool warns that it gated one
   machine, and its choice can only be that one. **Only reads taken after a machine's last address
   change count**, here and in the gate history: a read is a dated read of that machine's route at
   the time ("The host"). The tool doesn't know addresses, so this one is the operator's check.
2. **Choose.** The tool prints the preference before the gates start, then, after the rows, one
   `chosen:` line: `run`, `twin` or `NONE`, with the reason in brackets. It writes `choice.json` on
   the Mac: a top-level `prefer`, and `choice` as `{machine, prefer, tiebreak, reason}`; `handoff`
   reads only `choice.machine`. **The twin is preferred by default** (`DEFAULT_PREFER` in
   run-gate.ts, main's 10:4x PDT ruling); `gate --prefer=run|twin` overrides it, and only main moves
   it back to the run host. rs/440's sample output, one `chosen:` line per case:

   ```
   [run-gate] preference: twin (the default; both pass: twin, unless the tiebreak moves it)
   [run-gate] chosen: twin (both pass: the preferred machine, twin)
   [run-gate] chosen: run (tiebreak: preferred twin passed only at the margin: (c) 2/min; run read clean)
   [run-gate] chosen: run (only the run host passes; twin fail (on time 51/60))
   ```

   - **One passes:** start on it, except that the run host passing alone also needs its clean
     pairs (below). A pass includes a marginal (a), 58 or 59 of 60.
   - **Both pass:** start on the preferred machine, the twin, unless the tiebreak moves it.
   - **The tiebreak (main's, reversed onto the preferred machine):** if the preferred machine passed
     only at the margin ((a) under 60 of 60, (c) above 1 a minute, or a (d) sample under 60 loops a
     second) while the other read clean ((a) 60 of 60 and (c) at most 1 a minute; its (d) is not
     compared), the start moves to the other machine, on its own `chosen:` line, and `choice.json`
     records `tiebreak: true`. A marginal preferred machine stays the choice when the other is not
     clean either.
   - **A tiebreak move to the run host counts only if the run host has 4+ clean same-minute pairs on
     its current address** (rotated 17:39Z 2026-10-22; main, 11:5x PDT, via rs/158). Otherwise a
     marginal twin means **re-measure**, not the run host: no `handoff`; gate both again. The tool
     doesn't count pairs, so, like 5a.1's address rule, this is the operator's check.
   - **Only the run host passes** (main's ruling, 13:5x PDT 2026-10-22, via rs/158; rs/447): the
     run starts on it **only with 4+ clean pairs on its current address**. A clean pair is a
     same-minute pair in which the run host has no held ticks 135-218 ms behind the twin's copy of
     the same tick, and no glued pairs of its own. The twin's read counts as the pair's other half
     even when the twin's own (a) fails. Otherwise wait for the next pair: no `handoff`; gate both
     again. **Where the code differs:** `choose` in run-gate.ts picks the run host whenever it alone
     passes (`chosen: run (only the run host passes; ...)`) and writes it to `choice.json`, and
     `handoff --machine=run` accepts that choice; the tool doesn't count pairs. So, as for the
     tiebreak, the count is the operator's check before `handoff`, and the ruling decides.
   - **Neither passes:** no start; `gate` exits 1 (3 when a machine read re-measure and none stopped
     on a precondition). RUN-ORDER.md section 1's rule applies to both: the knife stays off on a
     failed gate, and the start waits for a passing read (re-measure both; the gate history on both
     shows when).
3. **Record both reads.** The tool prints one row per machine: the minute, (a) on-time of 60, (b)
   p90, (c) catch-ups a minute, (d) lowest / median / highest p10, the verdict, the players online
   and whether the gate logout was confirmed; then the choice and its reason. Copy them into the
   run's record and, after the run, into "Measured" below. Each machine keeps its outputs in
   `~/rs-run/gate-<UTC>/` until teardown, and the Mac keeps `~/rs-run-gate/choice-<UTC>.json`.
   Each row ends with the three report-only readings (step 6), for example
   `| report only: scene <=t2, locs 89, tile at spawn`. **The gate accounts appear only as
   `GATE-run` and `GATE-twin`** (step 0's "never print either name"): each machine relabels its own
   account in every line, `STOP:` line, JSON file and `GATE-RESULT` (from the `--role` the Mac
   passes), and the Mac relabels both in everything streamed back, its log and `choice.json`. Run on
   a machine by hand without `--role`, the label is plain `GATE`.
4. **On the chosen machine, the start order** (rs/41's wording, main ruled and applied 22:4x via
   rs/158; fold-in 34). rs/41's start sequence:
   1. the gate minute (line 1): the gate account and S06's 7 air-altar givers on **both** machines;
   2. after the choice, on SCORED's machine, first (main 04:30 PDT via rs/158, rs/186's wording; fold-in 37; it comes
      with rs/598, its line citations from rs/186's branch at rs/598, re-checked against the run commit main names):
      **NOT for attempt 1 (main 13:15Z): carriers launch unheld and self-stage their first rows; skip this hold (step 0, item 4).** Reference text: **Hold each delivery carrier before starting the helper launcher.** Run `bun speedrun/tools/mule-hold.ts --config <launcher config json> --account <carrier>` for every carrier in the generated carrier config. The hold must be written before the carrier starts: a running carrier with no control file selects and stages its first row at once (helpers/mule.ts:1250-1257, :1480, :1828; re-cited at the run commit 233d0f34, where rs/186's :1240, :1314-1323 and :1478 had moved), and a hold written after that leaves a staged carrier whose readiness check `heldFor` never passes (helpers/mule-readiness.ts:159). `holdMule` also refuses a hold after a prepare in the same attempt (helpers/mule-readiness.ts:303). If this step is skipped, the run still works through run.ts's per-row prepare and readiness gate, but the carrier pre-stages its first row.
      The hold command (rs/598, on main as #487, 233d0f34, the run commit: `speedrun/tools/mule-hold.ts`; `docs/speedrun/helpers/mule-delivery.md`, 'Run owner', lines 330-379 at 233d0f34; via rs/158): once per banked delivery carrier, for example `--config run-machine/<launcher>.json --account cairn_mule1`; the run id, serve, cue directory, first row and tile all come from the generated launcher entry. Exit 0 = held; 1 = refused (after this run's prepare, or over another run's live control); 2 = usage; an identical repeat is a no-op. After its gates, run.ts prepares each carrier's first row before SCORED logs in.
      Then rs/117's launcher logs in the **17 roster accounts** (4 + 6 + 3 + 4; fold-in 36, rs/41's correction of 16):
      mule1, mule2, h55, h03, the 6 S03 droppers, the 3 S04 ring givers (h81, h63, h66; fold-in 38,
      rs/41's names) and the 4 S07 bone givers (b01-b04), about 2.5-3 minutes.

      **The S04 ring givers in the launcher** (rs/41's line, verbatim, via rs/158; fold-in 38; in place
      of 'started by hand'): "The S04 ring givers (H3) run in the single launcher config
      `<R>/helpers.json` as the `mule` role in carried mode, one entry each, logged in before SCORED:
      `{account, role: 'mule', path: 'relay', stopOn: {step: 'S04', family: 'ring'}, options: {serveMode: 'order', carried: true, serve: <SCORED>, preRequest: false, stand: T_k, packages: [{name: 'ring<k>', at: T_k, items: <load k by id>}]}}`
      with no deliveryRun, takeBackSlots or final. Load 1 = cairn_h81: sapphire ring 1637×12 +
      emerald ring 1639×8. Load 2 = cairn_h63: 1639×19 + ruby ring 1641×1. Load 3 = cairn_h66:
      1641×15 + diamond ring 1643×5. Each load is held unnoted in the giver's inventory with ≤ 8
      other items. `T_k = giverTiles(3, ringerTile, firemakingTiles)[k]` (lab/ring-givers.ts,
      lab/dress-rehearsal.ts:532) on the day's firemakingTiles, so load 1's giver is in view at S04's
      start. The run config's `rings: { giver: 'cairn_h81', loads: [{rings: load1, giver:
      'cairn_h81'}, {rings: load2, giver: 'cairn_h63'}, {rings: load3, giver: 'cairn_h66'}] }`.
      SCORED's S04 trade-ops each giver at the last cast + 2 (magic.ts:146); each giver gives
      exactly its load and takes back what SCORED offers (the previous 20 enchanted rings; mule.ts:830
      ANY_OFFER), and the launcher logs all three out on S04's final stop. Proven by rs/607
      (bgsrv-mac, 233d0f34, preRequest:false): 3/3 loads, take-backs 0/20/20, Magic 59 in 198
      ticks." Every trade is SCORED-initiated. The count is unchanged: 17 helpers, 25 sessions at S01.
      The {S04, ring} stop's one writer is run.ts ("One writer per helper step's cue", step 4).
   3. wait for the launcher's `helpersReady`, then **load reading (i)** (step 6, "The load ceiling"),
      before the tab starts;
   4. the run tab and the recording start; **load reading (ii)**, the decisive one, before SCORED's
      login;
   5. the hand-over (`handoff --no-login`, step 7), then SCORED's one login, run.ts's (step 7, "The
      run-start order"; main 12:10Z, fold-in 37).

   The anvil helper a01 and the courier e15 are **not** in the start window: they log in on their
   cue gates (`loginOn` {S25a, anvil} and {S18, courier}). S21's 22 body-altar givers log in later,
   inside SCORED's relog before S21 (step 4, "The per-address login plan"; about 3.5 wall minutes
   through the launcher's limiter, rs/41; 22 logins took 190 s, m, rs/214 on the run host,
   00:35-00:39Z on 2026-10-22). **The start-window count on SCORED's address is 25 at S01**: 24
   helpers (the 7 air givers and the 17) and SCORED (fold-in 36: rs/41's correction, the roster being 17, 4 + 6 + 3 + 4; 24 written at fold-ins 34-35 on a count of 16). Before `handoff`: step 7's login count
   (`handoff` re-checks it), the demo's `tickMs` and bundle token re-read and the launch dry run,
   within 20 minutes of the gate (`--max-gate-age`). **Where the code differs** (r, run-gate.ts at
   this fold-in's base): `handoff` opens the run tab and logs SCORED in as one command (since main's 12:10Z ruling, fold-in
37, `handoff --no-login` opens it at the title screen only, and run.ts does the one login) and reads no
   load, so reading (ii) is the host's own read on the chosen machine while the tab is up and before
   the login; how it is taken inside `handoff` is the host thread's (pending).
5. **On the other machine,** before SCORED's first login: its 7 opening givers log out cleanly
   (HELPERS.md teardown; send their stop at least 5 minutes before they must be out of the world,
   since the server logs out at most one player per tick world-wide: HELPERS.md, "Stopping", rs/267)
   and its tab stack and recording stop (step 9's commands there). Its
   claim stays live and rehearsals there stay paused until the run's teardown (above). **The
   only logins allowed on it until then are gate probes**, and only when the gate script needs them
   off the recorded display (line 6).
6. **Hand over from the gate to the run, on the chosen machine: `handoff`** (step 7). Main's
   recording rule (18:16 PDT 2026-10-21, after cairn_casts' rehearsal recorded the gate account's
   tab instead of the attempt because the gate tab stayed on top of the recorded display; rs/147;
   19:08 PDT for the unconditional kill). Every line is a hard check of the tool:
   1. the gate probe tab is **logged out and closed** before the run tab opens: `gate` logs it out
      with `logoutClean` and then **kills the gate Chrome unconditionally, confirmed logout or not**;
      after the kill, and again at the start of `handoff`, no `chrome` session on the `run` socket,
      no process on `rs-run/chrome-profile` and no Bot Client window may be left;
   2. the run tab is the **only browser window on the recorded display**: exactly one `Bot Client`
      window, 1920 wide, before SCORED's login and after it;
   3. the recording is **already running and advancing before the run tab's login**, with RDP at 0
      connections (step 5);
   4. **a live frame of the capture shows the run tab** (step 5's pass line), before SCORED's login
      and again in game. This is a pass line of the gate, beside tenet 12's (a)-(d): no start until
      it holds. A wrong window costs the run's evidence, not ticks (RUN-ORDER.md R20);
   5. any later probe that needs a tab runs on **the machine not chosen**, never on the recorded
      display (main, 18:16 PDT): `gate` and `handoff` both refuse to start while any Bot Client
      window or run-profile Chrome exists, so nothing in the tool opens a window beside the run tab.

**No second gate mid-run.** SCORED's logged-in ticks keep counting and the recording, the live view
and the helpers are on the chosen machine, so the run never stops to re-measure or to change
machine. A demo restart mid-run is ridden out in place (step 7, "A demo restart during the run").
The held-tick monitor (step 7) is how a path going bad mid-run would be seen. The evidence
so far: the hold of 2026-10-21 was a persistent property of one address over about 5 hours; no path
has yet been seen going bad mid-run (the host thread, 16:15 PDT).

## 6. Quiesce check and the gate (`gate`)

**The load ceiling** (main 22:3x via rs/158, from the host thread; fold-in 33). The chosen
machine's 1-minute load average stays **under 4.0** (half its 8 vCPUs) for the whole run. The
reason: a helper on a CPU-starved host fails readiness closed. Its held-status goes stale past 3 s
against a 400 ms write cadence, so a healthy mule reads as not ready (main's delivery-engine proof:
load 37 on 8 cores did it in 7 s).

**The rule in force (main 13:10Z 2026-10-23, the host's measurement; supersedes the 4.0 threshold everywhere below):** pre-start readings (i) and (ii) and the mid-run ALERT pass on **CPU busy under 60% (the sampler's process CPU and `vmstat` 100 - id) AND PSI `cpu some avg60` under 25% AND no helper reporting not-ready**; the 1-minute load average is **logged only**, with no threshold. Why: on the twin's run-day composition with the delivery path live, load1 read 5.35 before SCORED's login while the CPU was 64-70% idle and PSI 5-7%, because ~300 bun threads waking each tick inflate the runnable count; the ceiling exists to catch CPU starvation (a held-status stale past 3 s), which busy% and PSI measure directly and load average does not. rs-loadlog gains PSI, busy% and the oldest helper status age: `~/.local/bin/rs-loadlog OUT [SECONDS] [RUN_DIR]` (both machines, untracked host tooling), its lines `busy=% psi60= load1 load5 ... status_max_age=s status_over3s=n notready=n helpersReady=`; on run day at the hand-off: `nohup setsid timeout <bound> ~/.local/bin/rs-loadlog ~/rs-run/<run>/load.log 30 /home/ubuntu/rs-sdk/run-machine >/dev/null 2>&1 &`. ALERT = busy >= 60% or psi60 >= 25; ALERT2 = two consecutive, to main and the operator as messages, the run not stopping. Measured on the twin 13:05-13:07Z: busy 31-36%, PSI 5-7%, PASS, with load1 4.7-6.5 in the same minutes and H1's tick-exact hand-off succeeding (the host). Where the text below says 'under 4.0' or 'at or over 4.0', read this rule.

- **Pre-start** (main 23:0x via rs/158, the host thread's wording; fold-in 34). The pre-start load condition is TWO readings. Each is a settled 1-minute load average, taken after 60 s with no new login. (i) After helpersReady and before the tab starts (rs/41's start-sequence step 3). (ii) After the tab and the recording have started and before SCORED's login (step 4); this is the decisive one. Both must be under 4.0, or the start waits and the reading is taken again. The reading at the gate pass, with the machine quiesced, is logged but is not a condition. The
  start order is step 5a.4's.
- **Mid-run** (main ruled 02:2x via rs/158; fold-in 36). At the hand-off (step 7) host starts the
  sampler on the chosen machine, `~/.local/bin/rs-loadlog OUT [SECONDS]` (untracked host tooling,
  installed on both machines, its sha256 beginning 2348a022), under `timeout`, with no tmux, writing
  every 30 s to `~/rs-run/<run>/load.log`, which stays on the never-deleted list (step 9). Each line
  has the UTC time, load1 / load5 and the per-process CPU of chrome, ffmpeg and each helper (bun, by
  role and account). `bun_total` is every bun process (helpers, run.ts and the gateway); the
  per-helper figures are the `bun:<role>:<account>` entries; SCORED and the gate accounts never
  appear by name. rs-loadlog names an account only for a helper role process (a script under
  `speedrun/helpers/`); every other bun process is logged by its script name alone (`bun:run`, for
  example), and Chrome only as the aggregate `chrome`, never its command line or URLs (host's test on
  the run host, 08:53-08:54Z: a stand-in name passed to run.ts appeared 0 times). A sample at or
  over 4.0 is logged. Load alerts reach the operator as MESSAGES, never on the display: host tails ~/rs-run/<run>/load.log on the chosen machine and, on an ALERT sample (>= 4.0), messages main and the operator's channel within about a minute; ALERT2 (two consecutive) goes to main, who decides whether to stop a helper; the run does not stop. Nothing is drawn on :10, because the recording and the live view grab the same display. Helpers fail
  closed and sit out rather than misfire.
- **sysstat.** Both machines sample sysstat every minute (the drop-in
  `/etc/systemd/system/sysstat-collect.timer.d/every-minute.conf`, in place since 05:28Z 23 Oct);
  teardown removes it after the run (step 9).
- **Measured headroom, recording on, no helpers:** peak 2.18 on the run host, 2.27 on the twin (m).
  The dress rehearsal (rs/496) is the first measurement with helpers on the machine: **pending**.
- **Attempt-1 load levers** (main 23:1x via rs/158; fold-in 34): the roster's early logins (step
  5a.4), the anvil helper and the courier cue-gated out of the start window, and possibly
  `path: 'direct'` for the helpers after the rehearsal. The exact wording is the host thread's and
  rs/41's: **pending**. **The recording preset stays `veryfast`** (m, the host thread via rs/158: a
  lighter preset saves at most ~0.24 cores, under main's 0.5-core bar).

**Quiesce.** Nothing runs on the machine but the session's desktop, the `run` tmux stack (gateway,
page server, recording, live view), rs/117's launcher with its lite runners and roles, and system
daemons. On the twin, no rehearsal process or Xvfb either (the leftover check, "Twin:"). The drained
Cairn executor's daemon (`cairn-exec`) was idle at 0.3% of a core (m, 16:15 UTC); whether it stays
up during the run is main's call. No Chrome at all, no other `bun`, no other ffmpeg, and no tmux
server but `run` (the leftover check, "Rules for every launch", lists them all). The gate history
timer is quiet: step 0's claim makes every firing skip, so no `rs-gate-read.service` process should
appear here. `gate` itself refuses while a run-profile Chrome or a Bot Client window exists, or a
timer read is in progress; the rest of this list is the operator's to read:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'uptime; ls /tmp/tmux-$(id -u)/; ps -eo pid,pcpu,etime,args --sort=-pcpu | cut -c1-160 | head -20'
```

**The gate** is measured on **each** candidate machine inside step 5a, right before the run, at the
real player count, and **on a gate account, never SCORED**, each machine its own (step 0): SCORED's
playtime starts at its first login, which is step 7. The opening roster is logged in on the machine
being gated (step 4). It is measured in the run's configuration: RDP disconnected, with the
recording and the live view running. The conditions and what to do on a failure are in RUN-ORDER.md
section 1 and tenet 12. `gate` (step 5a) runs it on each machine in this order; every line is a
hard check, and the first that fails stops that machine:

1. **Preconditions:** a live claim; display `:10` at 1920x1080 and 24 planes, and RDP at 0
   connections; no `chrome` session, no run-profile process and no Bot Client window on the display
   (it never gates where a run tab may be); the `up` stack's sessions `gateway`, `page`, `rec` and
   `live`; no gate history timer read in progress; the recording advancing; and the gate account's
   env file at `~/rs-sdk/bots/<gate>/bot.env`, mode 600, with a `PASSWORD`.
2. **(a)-(c)**, next-tick reactions, tick publication p90 and catch-ups: rs/96's direct-path CLI,
   `docs/speedrun/scripts/tickmanip-latency.ts <gate account> --path=direct --no-tele`
   (cairn://p/rs/96, PR #101; its procedure and verdict are in `skills/tick-manipulation.md`,
   "Run-time host gate"), bound 15 min (its probe gives up after 10). It logs the gate account in
   itself, in-process, so it runs before the gate tab opens, and since #142 (9d26aa87) it logs the
   account out at the end of the read ("Gate history timer"). Its vantage preconditions (step 1: edge
   `iad`, TCP connect p50 at most 5 ms) stop the machine as not probed. **The gate stops here, before
   any tab, unless (a)-(c) can start.** (a) below the floor of 58 of 60 on a steady server reads
   `investigate` (`speedrun/lib/hostgate-verdict.ts` `directDecision`), which the tool counts as a
   fail (`machineVerdict`): it prints `STOP: (a)-(c) fail` and the machine exits 1 (`onGate`). (c)
   above 2 a minute reads re-measure, exit 3, even when (a) is short too. Either way that machine
   can't be chosen: the run never starts on a machine whose read is under the floor, which rs/315's
   Thieving rehearsal harness let through at 57 of 60.
   **(b) and (c) in the demo's tick length T** (main's ruling, 13:5x PDT 2026-10-22, via rs/158; the
   demo has ticked at 400 ms since 19:56Z that day). (a) is counted in ticks and stands as written.
   **(b)**: the publication p90 at most 4/3 T (400 ms at T=300), reported, not a pass line. **(c)**:
   a catch-up is an interval under T/2 right after one over 7/6 T (150 / 350 ms at T=300), at most 2
   a minute (RUN-ORDER.md section 1). They are on main as **#385** (a4456c73, rs/471, inside the
   run-commit floor since fold-in 31): one rule, `server/webclient/src/bot/programs/tick-rule.ts`,
   which `speedrun/lib/hostgate-verdict.ts` imports and the page's `frames.ts` bundles. As the code
   states them (`TICK_FRACTIONS`, r): **(c)** a catch-up is an interval under **1/2 T** right after
   one over **7/6 T** (`isCatchUp`); **(b)**'s report line is **4/3 T** (`tickP90Report`). At
   T = 400 that is under 200 ms after over 466.7 ms, and 533.3 ms; at T = 300, 150 after 350, and 400.
   T is the command line's flag, else the feed hello's `tickMs`, else the median interval rounded to
   50 ms (`resolveTickLength` in `hostgate.ts`; the page takes the driver's `tickMs` start parameter,
   else its running median), and run-gate prints the T each of (b) and (c) was read at with its
   limits in ms. #385 changes the served bot bundle, so a machine still serving a bundle built before
   a4456c73 would judge (c) on the 300 ms values: step 0 rebuilds it on both machines. rs/449's #370
   carries only the gate history's fields (uptime, fingerprint, `tickMs`, 60 s of server intervals,
   T on each record).
3. **(d)**, the tab's loop rate: it opens the gate account's tab (step 3's line, bound 15 min),
   checks the six flags, logs it in with tab-login, prints the three report-only lines (below) and runs the secrets
   check (`0 0 0`). Then it
   samples for five minutes (`--minutes=5`) with `docs/speedrun/scripts/runhost-loops.ts`, bound
   10 min. The sampler attaches through the loopback gateway and runs the in-page probe (the page
   publishes `loops` only while a program runs). Every 10 s it reads the page's loop rate beside each
   process's CPU and ffmpeg's frame counters.
4. **The gate tab's logout, then the kill.** It logs the tab out with `logoutClean`, attaching through
   the gateway with `client: 'browser'` (bound 3 min; with `RUN_COMMIT` at or after `c2d9eada` it
   confirms from the page's own in-game flag, "Credentials"). Then it **kills the gate Chrome
   unconditionally, confirmed logout or not** (main, 19:08 PDT 2026-10-21): the `chrome` tmux
   session, then SIGTERM, then SIGKILL on the profile. A failed launch, login or sampler still ends
   in the kill. The reason: there is one Chrome per profile. A gate Chrome left up after an
   unconfirmed logout would take SCORED's `--app` window into its own process, leave the gate window
   on the recorded display, and end SCORED's tab at the gate tab's 15-minute bound. What a kill
   without a confirmed logout costs is one login slot for a few minutes. The account stays in the
   world until the server's no-connection timeout: 2 min 43 s to 4 min 51 s after the forced kill on
   the twin (m, rs/247, 2026-10-22). The gate row then says `gate logout unconfirmed`.
5. **Closed.** After the kill there must be no `chrome` session, no process on
   `rs-run/chrome-profile` and no Bot Client window, or the gate stops.
6. **The verdict**, through `directDecision` with (d) as the lowest 10-second sample. (d) is read
   from the lowest / median / highest 10-second p10. **Pass**: the lowest sample is at least 50 per
   second. **Marginal**: the median is at least 50 but a sample fell below: re-measure (exit 3).
   **Fail**: the median is below 50. (d) not measured is never a pass. On 2026-10-21 every sample in
   every condition was 70-73 (m, below). During the run, the page keeps publishing `loops` while
   SCORED's programs run, which is what the in-run monitor reads.

**Three report-only lines, beside (a)-(d)** (rs/440, #350, `d02c094f`). The gate tab's login also
yields `scene`, `locs` and `tile`. None of them is ever a pass or a fail: they are printed in the
step log, stored in the machine's gate JSON (`scene`, `locs` and `tile` on `MachineGate`) and
appended to its row after `| report only:` (step 5a.3). They read the page through
`speedrun/lib/tab.ts`'s `evaluateInTab`, and return counts and the tile only, never a name.

- **`scene`**, the warm-up reading: page ticks from the login to the client's `sceneState` 2. The
  watch starts before tab-login's navigation and looks every 250 ms; the page's tick count starts at
  0 as it enters the world on a fresh load. If the first in-game look already shows `sceneState` 2
  (warm), it reads `by page tick N`, an upper bound (`<=tN` in the row). It gives up 120 s after in
  game, or when the login fails. It is the reading step 7's verification pass asks for.
- **`locs`**: the SDK's `nearbyLocs` count, waiting up to 10 s after the scene is built (locs follow
  the scene by about a tick). **> 0 expected**; 0 reads `the tab sees no scenery`, as browser tabs
  on bbs do (step 4, rs/359).
- **`tile`**: the gate account's tile against the Lumbridge spawn (3222, 3218, level 0): at the
  spawn within 5 tiles (Chebyshev) on level 0, otherwise N tiles off it, or the level it is on.
  Each gate account is parked there (step 5a).

rs/440's sample lines, from the real functions on sample reads, not a measurement: the twin warm
and at the spawn; the run host cold, with no locs and off the spawn; a failed login; then the two
rows.

```
[twin] [gate] 17:21:04Z scene (report only): sceneState 2 by page tick 2 (already built at the first in-game look), 4.4 s after tab-login started; bbs reference: warm 3-4 ticks, cold 73-83 at a busy site
[twin] [gate] 17:21:04Z locs (report only): 89 locs at page tick 3 (21 NPCs, 97 players nearby); > 0 expected
[twin] [gate] 17:21:04Z tile (report only): (3222, 3218, level 0): at Lumbridge spawn (3222, 3218, level 0), 0 tiles from it

[run] [gate] 17:21:04Z scene (report only): sceneState 2 at page tick 83, 68.1 s after tab-login started, 27.8 s after in game (tick 0); bbs reference: warm 3-4 ticks, cold 73-83 at a busy site
[run] [gate] 17:21:04Z locs (report only): 0 locs for 10 s after the scene was built, last at page tick 99 (21 NPCs, 97 players nearby); > 0 expected: the tab sees no scenery
[run] [gate] 17:21:04Z tile (report only): (3185, 3436, level 0): 218 tiles from Lumbridge spawn (3222, 3218, level 0)
[run] [gate] 17:21:04Z scene (report only): not read: the login failed
[run] [gate] 17:21:04Z locs (report only): not read: the login failed

  run   01:00Z  (a) 60/60  (b) p90 488.5 ms (c) 2/min     (d) p10 71.5 / 72.5 / 73.1   pass       online 1600  gate logout confirmed  | report only: scene t83, locs 0, tile 218 from spawn
  twin  01:00Z  (a) 60/60  (b) p90 488.5 ms (c) 0/min     (d) p10 71.5 / 72.5 / 73.1   pass       online 1600  gate logout confirmed  | report only: scene <=t2, locs 89, tile at spawn
```

**Open, for the host thread** (2026-10-22, rs/410): rs/249's gate-wrapper fix (`host-gate-read.sh`'s
password redaction, "Gate history timer") is not yet installed on either machine.

## 7. SCORED's tab: the run's first login (`handoff`)

**Only once `RUN_COMMIT` includes #120** (rs/138, on main since `96fc462a`; "Credentials").

**The login cap, a pre-start condition** (cairn://p/rs/tenets/16, approved 17:43 PDT; main's working
cap). Before SCORED logs in, count our simultaneous demo logins **summed across both Ashburn machines
and every other host**: rs/117's launcher on the chosen machine (its `helpersReady` roster); on the
other machine, anything still logged in, which should be nothing once its 7 opening givers are out,
its rehearsals paused and its timer skipping under the claim, and any rehearsal account there
that did not log out counts; the bbs fleet (rs/41 reports its count to the operator; no command on
this page reads it); the ambassador's host (rs/58); and any other host with one of our accounts in
the world. With SCORED's 1 the total must be **at most 80**, the working cap. Per address, the demo's operator
caps logins at 50 per IP (13:2x PDT 2026-10-22) and ours is 45 an address (step 4, "The per-address
login plan"), and spreading
accounts across IPs to evade a cap is what gets accounts banned. The gate minute holds the 7 opening givers and a gate
account on each machine, 16 on the two (step 5a). **Fleet accounts not needed during the run are logged out**
before the count, their stop sent at least 5 minutes before it: the server logs out at most one
player per tick world-wide, so a stop of many accounts queues (rs/267; HELPERS.md, "Stopping"); gathering is finished by run day. The gate account is already out (step 6).
SUPPLIES.md, "Peak concurrent logins", has the count by run phase: on the body-altar plan (22 givers,
rs/163) the start is ~90 with the gathering fleet's ~53 in and 37 without it, so **logging the
unneeded fleet out first is mandatory**. Those counts have S21's givers in from SCORED's first
login. Under the per-address plan they log in later, inside SCORED's relog before S21, on the chosen
machine (step 4; RUN-ORDER.md O38 for the machine), so the start is lower: rs/41's map puts SCORED's
address at 25 at the start (step 5a.4; 24 before fold-in 36's 17-account roster) and 26 during S21's ramp (worst case 27), and the home address at 29 fleet accounts plus
the cannon helper. Do not log SCORED in over either cap. `handoff` re-checks it as a hard check: our accounts
online, as `rs-claim status` counts them on `/playerpositions` (every host's), plus SCORED's 1, at
most 80 (`--cap`); it refuses if the count can't be read. **The code counts a total, not an
address:** nothing on main counts logins per address.

**The gate's Chrome is gone before SCORED's tab opens.** After an unconfirmed gate logout the gate
tab's Chrome could still be running on the run profile; SCORED's `--app` window would then join that
process (the same `--user-data-dir`) and die with it at the gate tab's `T=15m` bound (rs/232's
read-only check against main's 18:16 PDT recording rule, via rs/147). `gate` kills it
unconditionally (step 6), and `handoff` checks first that no `chrome` session is left on the `run`
socket, no process holds `rs-run/chrome-profile`, and no Bot Client window is on `:10`. It refuses
(exit 2) on any of them. Never open SCORED's tab beside it.

**The run tab's profile is warm before SCORED's tab opens** (main's rulings, relayed by rs/158 at
09:42, 10:04, 10:4x and 10:5x PDT 2026-10-22; m, rs/424 and rs/41, "Measured: the run tab's browser
profile"). A fresh Chrome profile is cold: the client fetches models and maps over its cache socket
as the scene loads, which at SCORED's first login, at Lumbridge with the clock running, costs ticks.
The cache is per profile and per page address (rs/41). Ashburn's run and gate tabs use
google-chrome **156** with `~/rs-run/chrome-profile` on origin `http://127.0.0.1:8899`; a profile
warmed on bbs (chrome-headless-shell 148) doesn't carry over, so warm on the Ashburn machine itself,
at that exact origin (rs/41, via rs/158). Two layers, of which run-gate.ts checks neither:

- **The warm-up: the twin's own profile.** The run profile is the twin's persistent
  `~/rs-run/chrome-profile`, warmed by rs/393's `--until=S14` dress rehearsal through the run's exact
  client address, `127.0.0.1:8899`. It stays on the twin, the expected start machine (step 5a). Only
  if the run falls back to the run host is it moved to the run host's `~/rs-run/chrome-profile`, in
  this order: SIGTERM its Chrome; `cp -a` the profile; delete `Singleton*` in the copy (the
  `SingletonLock` names the host and pid, and without the delete Chrome exits 21, 'profile in use
  on another computer'); delete `Default/Sessions` (otherwise session restore reopens the last tab);
  then a login-free check that the IndexedDB key count matches the source's. The move needs the
  same served origin and the same Chrome major on both machines (the host thread confirms both). No
  command for the move is on this page: it is the host thread's.
- **The verification pass, always: the gate account's login.** After the final served-webclient
  rebuild (step 0) and before the run tab opens, a browser-client login through the run's
  `CLIENT_URL` at the Lumbridge spawn must reach **`sceneState` 2 within a few ticks, with archive-0
  urgent requests about 0**. Each machine's gate account, parked at the Lumbridge spawn, is that
  login (main, 10:5x PDT): one gate-tab login serves as the (d) tab, the warm-up and rs/440's
  report-only `scene`, `locs` and `tile` lines (step 6). The `scene` line is this pass's reading,
  for the operator to read, since the tool never gates on it; the parking is a sibling issue under
  the host thread, **pending**. It warms the run because the gate tab and the run tab are opened by the same
  `launchTab` in `speedrun/tools/run-gate.ts`, on the same `--user-data-dir` (its `PROFILE`,
  `~/rs-run/chrome-profile`) and the same page (its `PAGE`, `http://127.0.0.1:8899`). The cache
  lives on disk in the profile, so it survives `gate`'s unconditional kill. **The rule behind it:**
  the gate login warms the run only while the gate tab uses the same Chrome profile directory and the
  exact client address the run tab will use. If either ever differs, the verification pass is a
  separate probe login through the run's profile, never SCORED's, whose Chrome is gone before
  `handoff` and whose login counts against the cap until it is out.

The gate timer's direct-path login opens no browser and warms nothing, and a fresh or `mkdtemp`
profile is cold.

**The restart detector: the bundle token** (main's rulings, relayed by rs/158 at 13:0x-13:2x and
13:5x PDT 2026-10-22; the command is the host thread's). The demo's page imports the client as
`./bot/client.js?v=<token>` (`server/engine/view/bot.ejs`), and the engine sets the token once at
process start, `Date.now().toString(36)` (`server/engine/src/web/pages/client.ts`), so it changes at
every demo restart and decodes to the process's start time (rs/449). The page server passes the
page through from the demo (`server/webclient/proxy.ts`), so the run tab's page carries the demo's
current token.

A restart cools nothing the run tab caches. The page server answers `/bot/client.js` for any `?v=`
from the checkout's own `out/bot` with `Cache-Control: no-store` (proxy.ts; step 0, "What identifies
a build"), so every page load fetches the bundle from loopback, and the on-demand IndexedDB cache is
keyed by the page's origin and stays warm through a restart ("Measured: the run tab's browser
profile"). The token check is a **restart detector**, and main's rule for it is: **a restart between
the last gate pass and the run tab opening invalidates the pass, not the cache, so the gate runs
again before the run tab.**

- the operator runs the command below right after `gate` and records the token **beside the
  tick-length reading** (step 5a) in the run's record;
- it runs again right before the run tab opens (the hand-off, below). **A different token means a
  restart came in between: run `gate` again** (step 5a, both machines) before `handoff`.

The token is run-night state: it goes in the run's record, never on this page. `-m 10` is curl's
own limit, not a `timeout` pipe. It prints one `client.js?v=` line; no line means the page didn't
answer, so read again:

```sh
curl -s -m 10 https://rs-sdk-demo.fly.dev/bot | grep -oE 'client\.js\?v=[A-Za-z0-9]+'
```

**"One more gate login" means another `gate` run** (main, 13:5x PDT). There is no login-only
warm-up, and none is needed: run-gate.ts has no login-only command, and the gate account's tab logs
in only inside `gate` (step 6, line 3). Another `gate` reads both paths again after the restart,
logs each gate account in through the run's profile and address (the verification pass, above), and
renews the choice for `handoff`'s 20-minute limit.

**The hand-off.** Right before it, on the Mac, read the demo's tick length (step 5a's command) and
the bundle token (above) again and record both. Load reading (i) is in hand by then (after
`helpersReady`, before the tab starts); reading (ii), the decisive one, follows once the tab and the
recording are up and before SCORED's login (step 5a.4; step 6, "The load ceiling"). **A tick length different from step 5a's reading
is a stop**: no start; tell main (main kept this stop-on-change for the reads before the start,
13:5x PDT). A different token means `gate` again first (above). Then, on the chosen machine, with
the machine chosen (step 5a), the start's roster in (step 4; S21's givers come inside SCORED's relog before S21), the recording running (step 5), the gate's Chrome gone, the profile warm and the login
count at or under 80: put `$SCORED_ENV` on it (step 0), run step 3's env check with
`ENV=$SCORED_ENV` (expect only `mode 600`), then the launch dry run (below), then hand over. `$SCORED_ENV` is set in the Mac's shell
to the env file's path on the machine. Use `--machine=run` when the gate chose the run host. Bound:
12 min:

```sh
bun speedrun/tools/run-gate.ts handoff --machine=twin --scored-env="$SCORED_ENV" --claim=run --no-login
```

**The launch dry run, immediately before that line** (main's rule, 13:4x PDT 2026-10-22; "Rules for
every launch"). Type the hand-off's exact line in the same shell on the Mac, with the same quoting,
and put `printf '<%s>\n'` in front of it. The shell then prints each word it would pass, one per
line, and nothing runs and nothing logs in. The `sed` relabels SCORED's directory in the path, so the
output can be recorded beside the gate lines (step 5a.3) without SCORED's name:

```sh
printf '<%s>\n' bun speedrun/tools/run-gate.ts handoff --machine=twin --scored-env="$SCORED_ENV" --claim=run --no-login | sed "s#$(basename "$(dirname "$SCORED_ENV")")#SCORED#g"
```

Expect seven lines, each argument whole (m with six, fedora (bginf-halo), bash, a stand-in path,
2026-10-22; `--no-login` added by main's 12:10Z ruling, fold-in 37, its exact name the code's at the run commit 233d0f34):

```
<bun>
<speedrun/tools/run-gate.ts>
<handoff>
<--machine=twin>
<--scored-env=bots/SCORED/bot.env>
<--claim=run>
<--no-login>
```

An argument split at a space shows as extra lines. An unquoted `;` ends the `printf` there, and the
shell runs the rest as a command of its own, which prints an error such as `command not found`
(exit 127 in the same test). Either is a stop: fix the quoting, dry-run again, and launch only the
line that dry-ran clean. **Where the code stands** (r, main 36edbf1d): run-gate.ts has no dry run of
its own, and `handoff` opens SCORED's tab and logs it in once its checks pass (`onHandoff`), so the
shell's parse is what a dry run can show. The Mac passes `handoff`'s arguments to the machine
shell-quoted (`shq`, in `remote`), so the Mac's line is the only quoting the operator decides.

On the Mac `handoff` refuses a machine the latest gate did not choose, a choice older than 20 minutes
(`--max-gate-age`; gate again), and a rehearsal's gate for the run's hand-off or the other way
round. Then on the machine, in order, each a hard check:

1. SCORED's env file is at `bots/<BOT_USERNAME>/bot.env` in the checkout, mode 600, with a
   `PASSWORD`;
2. the claim is live, and **the step-7 preconditions** hold: no `chrome` session, no process on
   `rs-run/chrome-profile`, no Bot Client window;
3. display `:10` is at 1920x1080 and 24 planes, and **RDP is at 0 connections**;
4. **the recording is running and advancing**;
5. **the login count**: ours online plus SCORED's 1 is at most 80;
6. it opens SCORED's bare page in Chrome (step 3's line, `T=9h`) and requires the six flags and
   **exactly one Bot Client window, 1920 wide**;
7. **the live-frame pass line** (step 5): the window in front is the run tab, and an x11grab frame
   of the display matches the page's own screenshot, at most 12/255;
8. **it leaves the tab at the title screen and logs nobody in** (main's ruling, 12:10Z via rs/158;
   fold-in 37; `--no-login`, rs/601 merged as #485): its pre-login checks are the live frame at the title
   screen, the single window and the login count (items 2-7), and its `secretsCheck`
   (`tools/run-gate.ts:824-836`) still runs there, where it should read `0 0 0`. Before the ruling it
   logged SCORED in with tab-login, then ran the secrets check, the one-window check and the live
   frame in game.

Without `--no-login` it ends `PASS: SCORED is in game, alone and in front on the recorded display,
with the recording showing it` and exits 0; with it, its pass line is the code's at the run commit 233d0f34. SCORED's name is never printed: every line, frame and result says SCORED. A
stop before the login leaves SCORED's bare page up and not logged in, for the operator to read in
the live view. A stop after it leaves SCORED in game: touch nothing on the display, and tell main.

run.ts checks that step 0's claim is live and the run's own, and refuses to start otherwise. Its
start is a launch for SCORED, dry-run first like `handoff` (above). **The run-start order, written
once** (rs/186 via rs/158; fold-in 37; run.ts has been on main since #457, so its line is no longer
pending; the flags are run.ts's at 38902b56, re-checked at the run commit 233d0f34, the code winning on
any difference):

1. place cannon-serve.json and rs/41's launcher json in the run dir and check cannon-serve's sha256
   (step 0, "The cannon serve file");
2. **no mule-hold for attempt 1** (main 13:15Z: carriers launch unheld and self-stage; a hold costs ~160 ticks at H1);
3. start the helper launcher (step 4; step 5a.4, item 2);
4. after the hand-over, start run.ts in the run's tmux on the chosen machine; its preflight then
   checks the floor, the delivery config and the cannon serve, prepares each carrier's first row, and
   logs SCORED in (the only login);
5. straight after run.ts reports in-game, the operator's secrets check (below):

```sh
export PATH=$HOME/.bun/bin:$PATH; cd ~/rs-sdk && bun speedrun/run.ts --bot="$(basename "$(dirname "$SCORED_ENV")")" --config=<run config json> --run-dir=$HOME/rs-sdk/run-machine --run-commit=$(cat ~/run-commit)
```

`--bot` takes the env name, the directory under `bots/` (run.ts's usage; `loadBotEnv` reads
`bots/<name>/bot.env`, `lib/session.ts`), not the file's path, so the line derives it from
`$SCORED_ENV` and never types it; that works only with `$SCORED_ENV` at
`<run checkout>/bots/<name>/bot.env` on the chosen machine (step 0's precondition). The run dir must equal the helper launcher's `runDir`: both
default to `<checkout>/run-machine` (helpers/altar-cue.ts:587, helpers/standalone.ts:50), and
cannon-serve.json defaults to `<run dir>/cannon-serve.json` (run.ts:143). Items 1-3 come before the
tab, at step 5a.4 item 2; items 4 and 5 after `handoff --no-login`. The command above is item 4's.

**SCORED is logged in exactly once, by run.ts** (main's ruling, 12:10Z via rs/158, superseding the
12:05Z summary; fold-in 37). `handoff` runs its pre-login checks (the live frame at the title screen,
the single window, the login count) and leaves the tab at the title screen, with `--no-login` (#485, in the run commit 233d0f34; `run-gate.ts`'s usage line 14). run.ts performs the only
login. **No run.ts change is needed** (r, rs/186 at 9f2efb03; every file:line re-checked at the
run commit 233d0f34, the code winning): run.ts:574 always mints a token and navigates the one
`bot=<SCORED>` tab (`lib/tab.ts:206-218`), then waits for in-world ticks (`lib/session.ts:346`),
the same from the title screen; its only reads of the page's in-game state are the S21 relog resume
(run.ts:579-587, which refuses a live page, so a title-screen tab is what it wants) and the watchdog
after login.

**The secrets check runs twice.** First `handoff`'s `secretsCheck` (`tools/run-gate.ts:824-836`),
at the title screen, reading `0 0 0`. Then, **straight after run.ts reports in-game (S00 started),
an operator step, not inside run.ts**: the host's one-liner on the chosen machine (not a run-gate
subcommand, so nothing new enters the run commit; the host, 12:2xZ; `SCORED_ENV` is the placeholder
for `$SCORED_ENV`'s path, as in step 8; `RS_RUN_HOST` as the chosen machine's form, step 0):

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'ENV=SCORED_ENV; P=$(sed -n "s/^PASSWORD=//p" "$ENV"); [ -n "$P" ] || { echo "no PASSWORD in the env file"; exit 2; }; K=tok; K="${K}en="; a=$(pgrep -c -f -- "$P"); b=$(pgrep -c -f -- "$K"); L=$(curl -s -m 5 http://127.0.0.1:9222/json/list); if [ -z "$L" ]; then c=no-cdp; else c=$(printf "%s" "$L" | grep -c -F -f <(printf "%s\n%s\n" "$K" "$P")); fi; unset P; echo "secrets check: ${a:-0} ${b:-0} $c"'
```

Expect `secrets check: 0 0 0`: processes showing the password, processes showing the token key, and
tab URLs (CDP `/json/list`) showing either, the same three counts as run-gate's `secretsCheck`
(`run-gate.ts:824-836`). It never prints the password; the token key is built from two parts (`K`)
so the check's own shell cannot match itself (an earlier draft read `0 1` from its own shell), and
the password reaches grep through a file descriptor, never argv. `no-cdp` in the third place means
Chrome's DevTools port did not answer: read again. It reads `0 0 0` because run.ts passes the token
over CDP, not argv, and the page strips `token` from its URL (`server/webclient/src/bot/GatewayConnection.ts:48-51`).
Tested login-free on the run host at 12:2xZ (no tab up): `0 0 no-cdp`, the expected reading.
**Anything other than `0 0 0` is a stop for main before S01's first action; touch nothing on the
display.** **Measured in world on the twin, 2026-10-23** (m, rs/496's step-7 rehearsal on
`rs-ashburn-rehearsal`, relayed by rs/158; fold-in 38; the twin, not the run host): `handoff
--no-login` PASS at 12:22:32Z, run.ts's single login at 12:23:16Z, in world at 12:23:24Z, and this
one-liner (ENV set to the throwaway's env path) read **`secrets check: 0 0 0`** at 12:23:49Z. This
discharges the secrets-check part of rs/496's proof; the ladder note's two proofs are separate.

**Step 7's timing on the twin, 2026-10-23** (m, the same rehearsal; fold-in 38; a note, no priced
line): from the tab up at the title screen to run.ts's login click took **44 s**, operator latency,
and from the click to in world **8.2 s**. The 44 s comes before SCORED's login, so it is off
SCORED's clock (the server's clock runs from the first login, RUN-ORDER.md's ladder note on the run
clock). The 8.2 s is as observed; how much of it falls after the server accepts the login, and so
counts, is inferred, not measured (counting starts at the login; all of it would be about 20 ticks at
400 ms). It stays inside section 6's live-slowness allowance (RUN-ORDER.md, the 800), not a new
line.

**Before run.ts starts: `handoff` logged nobody in** (the host's line via rs/158; `handoff --no-login`,
rs/601 merged as #485; the key is exactly `loggedIn`, the host confirmed, re-checked at the run commit 233d0f34,
the code winning). The
`handoff.json` of this gate pass, in the gate directory `handoff` printed (not the newest
`~/rs-run/gate-*` by glob: UTC names sort, but a stale rehearsal directory could win), must show
both `"ok": true` and `"loggedIn": false`. On the chosen machine:

```sh
grep -o -E '"(ok|loggedIn)": *(true|false)' ~/rs-run/gate-<UTC handoff printed>/handoff.json
```

If it shows `"loggedIn": true`, `handoff` took the old path: the fallback below applies (a confirmed
clean logout, then at least 10 s) before run.ts. It is the confirmation; #485 is in the run commit 233d0f34.

**Why** (main, 12:10Z): the server's clock runs from SCORED's first login and keeps counting on a
dropped connection (`playtime-audit.md` rows 4b and 4d); a takeover under 10 s is refused by the
login server (`LoginServer.ts:573-601`); the gateway's duplicate-session stall is ~19-20 ticks
(rs/174). The run clock the ladder prices from is the server's first login of the account, not
run.ts's `tickBase` (RUN-ORDER.md section 7).

**History, moot since #485 is in the run commit 233d0f34** (the fallback main ruled, 11:50Z, for a commit without `handoff --no-login`; main's wording): after handoff's
verification, log SCORED out cleanly in the tab (confirmed on the page) before starting run.ts, and
wait at least 10 s after the confirmed logout; the logout is also confirmed by observing SCORED's
absence on `/playerpositions` (rs/186 via the host). Priced as `handoff`'s own logged-in ticks, inferred tens, a start-cost line beside the row, outside
the expected total (RUN-ORDER.md section 7's ladder). A logout not confirmed before run.ts starts
runs into the login server's 10 s takeover refusal and the gateway's duplicate-session stall. From
here the run scripts drive the tab through the gateway on 7780 (RUN-ORDER.md, STEP-MANIFEST.md).
Nobody touches the window. Relaunches during the run go the same way: session.ts mints a fresh token
from `CLIENT_URL` and re-navigates the tab over `CDP_URL`. The run's relogs use
`login(session, {inPage: true})`, with this navigation as the fallback. With rs/174's fix on
`RUN_COMMIT` either path costs ~2 ticks on SCORED's clock (first SDK state at login + 1; m, rs/174
on the twin against the demo); without it a navigated relog passes ~19-20 ticks before the bot
layer sees state (m, rs/164 and rs/174; RUN-ORDER.md section 4).

**Login codes on a relog** (rs/83's reading, relayed by rs/158 at 13:3x PDT 2026-10-22; the codes'
text is the client's own, `server/webclient/src/client/Client.ts`). A refused login is answered with
a code, which the page shows as two lines on its title screen:

| Code | The page says | What it means for the run |
|---|---|---|
| 7 | This world is full. Please use a different world. | the world is at its cap: **retry; not a failure** |
| 8 | Unable to connect. Login server offline. | a login-server stall, as for ~1.5-2.5 min after a demo restart (`speedrun/lib/demo-status.ts`): reported as such |
| 14 | The server is being updated. Please wait 1 minute and try again. | an update countdown: reported as such |

The cap behind 7 is set by the demo's operator and can change with any restart (RUN-ORDER.md, the
'world full' row). **On main, SCORED's relog doesn't tell the codes apart** (r, 2ec58839): session.ts
`login` retries any login that ends before its first in-world tick, up to 6 attempts with backoff,
and reconnect.ts `reconnectAfterOutage` tries one login every 10 s for up to 30 min, whatever the
refusal. Neither reads the code. An in-page attempt writes the title screen's text to the session
log (`in-page login ended on the title screen (...)`); a navigated attempt waits out its login
budget (75 s for the browser). Retrying on 7 without counting it as a failure, and reporting 8 and
14 as such, are run.ts's, **pending rs/186**. The fleet's supervisor already maps the codes
(`speedrun/helpers/backoff.ts` `loginFailurePolicy`: 7, 8, 13 and 14 hold that account 60 s and
pause every fleet login 60 s).

**Watching SCORED's own tick stream during the run** (rs/210, on main as #176, 834f376b; measured
against the observed tick period since rs/276's #226, de66634b; reporting `overBudget` since #325;
all inside the run-commit floor). The start gate reads each candidate's path once. During the run, the step runner
(`runSteps` or `runResumable`) runs a passive tick-cadence monitor on SCORED's connection from its
first in-world tick. It acts on nothing. Once a minute it appends a `kind: "tickmon"` row to the run
log (`speedrun/runs/<runId>.jsonl`) and prints the same line, tagged `TICKMON`, on the run's stdout:

```
TICKMON minute=12 at=2026-10-22T01:12:00Z secs=60 ticks=176 glued=0 late=0 p50=0 p90=2 max=7 gaps=0 lateMs=120 periodMs=341
```

Read it on the chosen machine with `grep -o 'TICKMON[^"]*' ~/rs-sdk/speedrun/runs/<runId>.jsonl | tail -5`
(or follow the run's stdout).

- `ticks`: tick arrivals in the minute: **150 at the 400 ms the demo has run since 19:56Z on
  2026-10-22**; until then 200 at 300 ms (`fly.toml:26`, `NODE_TICKRATE=300`), and 161-177 at the
  demo's observed 340-370 ms (2026-10-21). Fewer than 60000 / periodMs means the tab stopped
  publishing for part of the minute: a relog, or a stall the watchdog will see.
- `glued`: arrivals under 5 ms after the previous one. These are ticks held on the path and
  released together.
- `late`: arrivals more than `lateMs` (120 ms) after the tick's expected point on the cadence, which
  steps by the observed tick period (`periodMs`, a rolling median over about 16 s of ticks), not the
  nominal 300 ms, so a slow but steady server reads late=0 and offsets near 0. The cadence follows each on-time arrival, so slow clock drift does not count. A tick glued behind a
  held one is not counted twice. A lasting shift of the cadence (a server stall beyond the engine's
  two-tick catch-up) costs two late ticks, after which the cadence follows the shift.
- `p50`/`p90`/`max`: each arrival's offset from its expected point, in ms.
- `gaps`: the tick counter went back (a relog) or jumped more than 17 ticks; the cadence restarts
  there.
- `periodMs`: the median tick period the minute's offsets were measured against, in ms.
- `overBudget` (#325): ticks in the minute where SCORED's in-page program had more than the server's
  5 user events, so the engine deferred the sixth and later. It is printed only when nonzero: a
  clean minute has no `overBudget` field, which reads as 0.

Times come from the loopback gateway's receipt of the tab's publication, so this is the tab's tick
stream as the run scripts see it. The fields after `lateMs` are appended at the end of the line, so
`grep -o 'TICKMON[^"]*'` and key=value readers keep working; the run log row's `meta` carries
`periodMs` too, and `overBudget` when it is nonzero.

What to expect (m, bgsrv-mac, local engine at `NODE_TICKRATE=300`, rs/210): a clean path reads
`glued=0 late=0` with p90 at most 3 ms and max at most 21 ms in every minute (5 minutes, 1,000
ticks). With a proxy holding 8% of server-to-client chunks for 150-350 ms, it read late 16-22 and
glued 2-12 per minute (86 late and 26 glued over 1,000 ticks). On 2026-10-21 the run host's old
address took 5-13% of ticks late (rs/83), which is 10-26 late per minute at 200 ticks a minute
(300 ms, the demo's tick until 19:56Z on 2026-10-22), or 8-20 at the 150 a minute since (i).

It is a reading, not a gate: nothing stops on it. A run of minutes with double-digit `late` on
SCORED means the path went bad mid-run; tell main (and rs/158 for the record). `SPEEDRUN_TICKMON=off`
in the run's environment turns it off, and `SPEEDRUN_TICKMON_LATE_MS` changes the threshold.

**A demo restart during the run** (RUN-ORDER.md R7, "demo restart mid-run", written by fold-in 25:
its costs and what is unknown; three restarts came in 32 minutes on 2026-10-22, 19:24-19:56Z).
Nobody touches the display: the run's own code brings everything back, and the operator watches and
records. Mechanics read on main are marked r (2ec58839); those not on main are **pending rs/186 and
rs/41**.

What the operator sees:

- **Every session drops.** In the live view SCORED's client draws `Connection lost` and `Please
  wait - attempting to reestablish` once 15 s pass without a packet, tries one login of its own,
  and with the server down falls back to the title screen (r: `lostCon` in Client.ts). The helpers
  and the fleet drop at the same moment.
- **The outage from outside:** `/playercount` stops answering for ~30 s, then answers 0; logins are
  refused with code 8 for ~1.5-2.5 min; the count refills over ~10 min (r:
  `speedrun/lib/demo-status.ts`, rs/102). The bundle-token command (above) prints a new token.
- **SCORED's tick stream:** the TICKMON minute of the drop shows fewer ticks and a `gaps` count
  (the counter went back at the relog); the monitor runs on through the drop (`runResumable`, r).

What the run does:

- **The fleet relogs in rs/41's order, and the helpers return to their tiles.** The tick-exact
  helpers come back as relaunched lite children (step 4) through the fleet's login limiter, which
  brings a dropped fleet back gradually and holds every fleet login 60 s after a 7, 8, 13 or 14
  refusal (`speedrun/helpers/backoff.ts`, r). reconnect.ts gives a login-order gate (`beforeLogin`:
  tick-exact helpers in first, r), and the helper roles restart from any position (altar-giver.ts,
  bone-giver.ts, r). The run-night order itself is rs/41's: **pending rs/41**.
- **SCORED relogs through run.ts's resume** (rs/186). On main the watchdog sees the world gone and
  calls `reconnectAfterOutage` (`speedrun/lib/reconnect.ts`), which waits while `/playercount`
  doesn't answer, then tries one login every 10 s, for up to 30 min. `runResumable`
  (`speedrun/runner/resume.ts`) abandons the step attempt, waits for the session, and walks the
  manifest again from the game state, since a restart rolls the account back to its last world
  checkpoint (r). The login codes are as above: 7 retried and not a failure, 8 and 14 reported as
  such, **pending rs/186** (on main every refusal is retried alike). run.ts itself is **pending
  rs/186**.
- **SCORED's relog loads a cold bundle (seconds, from loopback).** A navigated relog reloads the
  page, and the page server answers the bundle from loopback with `no-store` on every load; the
  on-demand IndexedDB cache stays warm (above). reconnect.ts's default login navigates; the lab's
  restart measurement logged back in inside the page instead, 2.0 s after the engine was ready,
  with no bundle load (speedrun/README.md, "After a server restart"). Which of the two run.ts uses
  is **pending rs/186**.
- **The step in progress resumes by its module's rules.** The walk enters the latest step whose
  `inProgress` holds through its `resume`, or else one whose preconditions hold through `run`
  (resume.ts, r). A restart inside an S15 no-logout segment loses the segment (RUN-ORDER.md R7).

What the operator does: touch nothing on the display and run no step by hand. Record the drop's UTC
time, the new bundle token and the tick length (step 5a's command) in the run's record; a changed
tick length is handled as below, never by a stop. Watch the live view for SCORED back in game and the run log for its
resume row. Tell main if SCORED isn't back within reconnect's 30 minutes, or if the walk stops for
the operator (resume.ts then prints each candidate step's reason). The recording and the live view
run on through it: they grab the display, not the game.

**A dropped session with no restart** (main 15:3x-15:4x via rs/158; rs/83, rs/186, the host thread; fold-in 31).
At 22:15:50Z on 2026-10-22 about 116 players dropped world-wide, 29 of our 42 sessions on one
address, with no restart and no stall (rs/83: the process token unchanged, the tick feed
continuous), and the fleet relogged by itself; with the 2026-10-21 outage that is two demo-side
events in 38 hours (RUN-ORDER.md R53). **Since #466 (86e7aa37, rs/580; fold-in 35) run.ts relogs a
dropped tab itself and relog-now is the operator's command (the socket-drop recovery, below); this
manual procedure is the fallback** for a recovery that refuses or a budget that is spent. **What run.ts did before #466** (rs/186, code at a2adbc7a): the
runner link sees inGame=false about 1 tick after a drop (or after 17 ticks with no in-world tick),
aborts the step and waits up to 30 minutes for the link, then throws (`resume.ts:217, 343`). **It
starts no relog**: the watchdog ignores inGame and acts only on stopped ticks or a dead or stale
gateway, so **with the feed live nothing relogs, and the operator must relog SCORED by hand within
the 30 minutes.** When the watchdog does act it relaunches a new client, not in-page, which cuts
the in-page programs, and its logout doesn't check for an open bank or trade. There is no relog cap
or budget, and planned relogs aren't counted. On return the resume walk re-enters the latest step
whose `inProgress` holds (through `resume`) or whose preconditions hold (through `run`, which
restarts the step from its beginning); cooking (`splitStage`), the legs (by checkpoint) and the
hand-offs (equip only if the trade landed) handle re-entry. Wrong re-entries: the S21 relog step can
be re-picked (an extra relog); S03's dropper go cue and S14's and S27's cue stops can be re-written;
and **a Wilderness leg deeper than level 20 cannot restart** (the teleport is refused), so it ends
in a ResumeError.

**The manual relog, today's run commit** (the host's facts, checked on both machines):

1. **Who notices.** The operator, on the live view (3 fps MJPEG, view-only: the run host's
   `/live.mjpg` on port 8090 over Tailscale; the twin's on 127.0.0.1:8090 through step 5's ssh
   tunnel). A full-resolution still comes over the run tab's DevTools port (`speedrun/lib/tab.ts`
   `screenshotTab`) and touches nothing on the display.
2. **The act.** An ssh shell on the machine (keys and known_hosts per step 0), then the run tab's
   DevTools at 127.0.0.1:9222 (loopback only). The relog is `speedrun/lib/session.ts`
   `login(session, {inPage: true})`, or `login(session)` to re-navigate to a fresh one-time token
   URL; `speedrun/tools/relog-probe.ts` already drives both over DevTools. **Confirm in or out by
   `tab.ts` `pageInGame`, never the gateway's `inGame`**, which stays true with status `stale`
   after a drop. Not offered: xdotool (absent, not to be installed); the overlay gateway on
   127.0.0.1:7780, which cannot log a tab in; RDP is the last resort, since it cuts the recording
   to ~23 fps (tenet 12, rs/134).
3. **The recording** (ffmpeg on :10) keeps running through it; it grabs the display, not the game.
4. **The relog budget:** the planned S21 relog plus 3 unplanned, run.ts's and the operator's
   together, inside tenet 25's count. A manual relog is an unplanned one.

**Helper preparation by generation, the operator's side** (main 19:4x via rs/158; fold-in 32;
the canon is RESILIENCE.md's; the command and API names are **pending rs/532, after rs/41 approves
rs/529's API**, and are not written here until they exist):

- An operator resume after an abort mints a new attempt generation in the same delivery run and
  keeps the row sessions.
- Helpers re-arm only on a strictly higher generation; a prepare for an aborted generation is
  refused and logged.
- A crash that never reached the abort path cancels nothing, so a crash-resume is unchanged.
- The run-bound hold (generation 0) is its own state, never a cancel; S22's prepare advances it.

**Re-running after a StepError** (main 21:5x via rs/158; rs/186's code read at its mission tip,
22:2x; run.ts on main since the run-chain snapshot rs/563, #457, 41b2b7a9; fold-in 33). run.ts
never re-invokes a step that throws: `runner/step.ts:262-289` raises `StepError(step, phase,
detail)`, the phase `precondition`, `run` or `postcondition`, and `resume.ts:337-344` retries only
a link, session or page-reload failure. `lib/attempt.ts:108-114` catches it in the world and run.ts
stops with exit 1. The only recovery is the operator re-running the command, and where it enters is
decided from game state, not from the log (`resolveResume`, `resume.ts:123-152`). A manual re-run
costs **~11.7 ticks (m) plus re-entering the interrupted step (unmeasured)** (main accepted 12:40Z via
rs/158; fold-in 37): run.ts logs SCORED out, confirmed, before it exits on a throw
(`lib/attempt.ts:111-116`, run.ts:528 at 9f2efb03; r, rs/186), so the operator's reaction and the
relaunch are off the clock. **~150-450 ticks (i) only where SCORED stays in the world:** a crash
before the chain, a SIGKILL, an unconfirmed logout (run.ts reports 'logout NOT confirmed'), and a
failure in combat, where the server refuses the logout (the in-combat rule below). **Every re-run
starts by observing SCORED's state on `/playerpositions`** (never naming it on this page); if SCORED
is still in, take the stays-in branch. Its measured component (rs/595, bgsrv-mac lab, 400 ms, browser, 3 of 3
SIGKILLs mid-T04-05 with an immediate re-run; fold-in 36): **kill to the resume point chosen ~11.7 ticks (m)**,
relaunch to SCORED in the world ~2, the post-login checks ~9.6-9.9, the scene wait 0, the resume decision
0; not included are the operator's reaction time (ticks count while SCORED stays logged in), run.ts's
pre-login gates (the floor read, the reservation, the slot ledger, helpersReady) and the killed step's own
resume (unmeasured); rs/589 (rs/546's, rs/574's and rs/585's successor) measures one kill-and-re-run (RUN-ORDER.md
section 7, the ladder's general note). **The relog budget on a re-run** (r, run.ts at 233d0f34; fold-in 37): run.ts's own login on a re-run is not a relog and does not spend 'S21 + 3': its launch
(`openRunSession`) records nothing in `<run dir>/relogs.json`, where only S21's planned relog,
`runner/drop-relog.ts`'s recoveries after a drop and the operator's relog-now are recorded
(`runner/relog-budget.ts`). But run.ts's start gate 'relog budget' refuses a re-run once the
unplanned relogs are spent (run.ts:285), and a re-run keeps the earlier sessions' entries: only a
fresh run, with no earlier sessions and no `--from`, clears them (run.ts:641-643). Plainly (main,
13:00Z): **once the run's unplanned relogs are spent, run.ts's start gate (run.ts:285) refuses a
re-run; the entries persist in the run dir.** **There is no operator override** (r, rs/186 at 9f2efb03, which rs/598
does not touch): the limits are fixed constants (`PLANNED_RELOGS = 1`, `UNPLANNED_RELOGS = 3`,
`runner/relog-budget.ts:22-24`), run.ts builds the budget with them (run.ts:616) and no flag or
config sets them; the gate reads `<run dir>/relogs.json` fresh, every entry whose `kind` is not
`planned` counting as unplanned, and the file is neither signed nor checked beyond parsing, so the
only way past the gate is a hand edit of `relogs.json`, which no code or document sanctions. **Main's
ruling (13:20Z via rs/158, verbatim): 'past S21 + 3 unplanned relogs the start gate refuses; do not
edit relogs.json unless main says so in the channel, with the margin stated; the planned S21 entry is
never touched'.** By default a re-run past the budget is attempt-ending; main decides live against
the remaining margin. **The procedure main would order** (rs/186's): copy the file aside
(`relogs.json.<UTC>.bak`), then remove only the unplanned and manual entries, never the `planned`
S21 entry, whose `open` flag tells run.ts whether SCORED is between
S21's logout and login halves (relog-budget.ts:118-127; run.ts:570-587). No code change tonight.

**A throw in combat: relaunch FIRST** (main 23:3x via rs/158; fold-in 35). If the run log's last
state shows SCORED in combat (the logout refused, `[run] logout:` reporting it), re-run the same
command **at once, in the live session**, and only then run the checks below that assume a parked
character (2, 3 and 6). Never wait out the logout: the server refuses it while SCORED is in combat,
and SCORED stands in the fight with nothing acting. This applies to any throw in combat; **S15 N is
the measured case** (rs/201 exec 9, bgsrv-mac, 400 ms: a throw right after the trapdoor landing
under the temple, the logout refused for 27.6 s of tries, ~69 ticks; the re-run resumed N in the
live session and finished it in 50; waiting out the logout was a death in one lab attempt).

**What the operator sees.** `[run] FAILED: <message>` (`lib/attempt.ts:114`), then
`[run] logout: ...` (`run.ts:513`): **run.ts logs SCORED out after a StepError**, and on the way
out closes the helper cues **non-final**, printing `[run] cues closed non-final: a re-run re-arms the
helpers` (`run.ts:534-538`, `runner/cue-keeper.ts` `exitStopIsFinal`). Exit code 1. **The helpers
stand down on a StepError or a first Ctrl-C, per family** (rs/574's retire rule, on main with #468,
4657eed8, rs/583 from rs/186 @43f03530; the families rs/186's from rs/595's code reading, main
03:25 PDT; fold-in 36):

- A failed step's own cue is stopped non-final too (`runner/chain.ts` `cueAround`). **Before
  re-running after a failed step, relaunch that step's bone, anvil, fm-row, courier or S04 ring helpers (they
  exit on a non-final stop and are not restarted); altar and mule givers stand by and pick up the
  re-run's fresh cue themselves (up to 25-26 at S21 on SCORED's address, rs/41)**. **A failed S04 means
  the whole-launcher relaunch** (fold-in 38, rs/158; the S04 ring givers are carried-mode `mule`
  entries in the launcher, step 5a.4). In the code at 233d0f34, a throw in S04 writes a non-final,
  failed stop (`cueAround`, `runner/chain.ts:330`), and the launcher closes a `stopOn` scope only on
  its final stop or the next scope's cue after its stop (`helpers/standalone.ts:418-430`). So after a
  failed S04 the givers stay logged in with their roles parked, and the relaunch brings them back
  fresh (rs/186). This is attempt 1's procedure:
  changing those roles to stand by is attempt-2 work (helper code, rs/41), and rs/595's live lab
  only confirms which families exit. The same holds after a first Ctrl-C (a graceful stop at the
  next logout-safe boundary, to resume later, exit 4), SIGHUP, a refused resume, a host reservation
  and a crash exit. Cannon is out of scope: on run day h92 runs in bbs's fleet in
  receiver-in-sight mode and reads no cue.
- **Measured (lab): rs/597's stand-by lab** (bgsrv-mac, 400 ms, a scratch copy of 075c1763,
  04:18-04:32 PDT 2026-10-23, via rs/158; fold-in 37; no figure moves). **Altar and mule: relaunch
  none** when the failed step involves only altar or mule givers (a failed step whose bone, anvil,
  log-row or courier family forces the whole-launcher restart, next item, takes them down too), now
  measured: after a non-final stop both stayed logged in for 10 minutes, the altar giver
  served the fresh session and the mule's role stayed live. **The mule caveat:** after a plain stop
  the mule releases its stand and waits, logged in, at Draynor bank (3092,3245), and its served
  journal refuses a row it has already delivered ('delivery already served'), so a re-run of a step
  whose mule hand-off already landed gets nothing more from the mule. That is correct unless SCORED
  lost those items (a death, say), when the recovery is the respawn kit or the by-hand procedure
  ("After a player-kill"), not the mule. **A re-run of a step whose mule row was never served** (i, code reading, rs/186
  at rs/598's fix via rs/158; file:line re-checked at the run commit 233d0f34, the code winning): the
  mule keeps its stand on that row and serves the re-run. It leaves its stand only after a serve
  (`finishDelivery`, mule.ts:1338-1346; `keepsStandAfterServe` is false for an unserved row,
  :1354-1356); a plain stop only pauses authorization while the stop is live (:1250-1257, :1272); a failed
  step's stop is plain, and on the re-run the run script reopens the same delivery session, which
  the mule authorizes again (altar-cue.ts:676-687). The Draynor walk rs/597 saw is the served case
  only. **The bone givers:** their roles exit on a plain stop (measured: `bone-giver: finished`
  0.2 s after the stop), but the launcher keeps both accounts logged in, so a relaunch must first stop
  the stale session (next item). The anvil, log-row and courier helpers stay code-reading until
  measured.
- **Relaunching after a failed step whose family exits** (main's line, 12:40Z via rs/158,
  verbatim; fold-in 37): 'with SCORED out, stop the whole launcher, confirm every helper out via
  /playerpositions, relaunch the same config, wait helpersReady, re-run run.ts; no mule-hold', **cost
  one SCORED login**. The whole launcher because attempt 1 runs one helper launcher (run.ts's
  preflight reads helpersReady from one `<run dir>/launcher.json`; a split needs a run.ts change
  inside the freeze, an attempt-2 lever, RUN-ORDER.md section 7) and `standalone.ts` has no per-role
  or per-account stop (its only stop is SIGINT or SIGTERM to the whole process,
  standalone.ts:929-930; a role that exits 0 is 'finished; not restarting it', :813-816, its account
  logged in until the launcher stops). **The detail, rs/41's text verbatim** (12:3xZ via rs/158;
  step 5's count is main's rule in place of rs/41's 'against 45'; the code at the run commit 233d0f34
  wins on any name):

  '**The manual's re-run commands**, with `<R>` = the run dir and the single config
  `<R>/helpers.json` (`runDir: <R>`), run in its own tmux window (`tmux new -d -s helpers`):
  **Start:** `exec timeout --kill-after=30s 43200 bun speedrun/helpers/standalone.ts <R>/helpers.json`,
  then wait for `<R>/launcher.json` helpersReady (run.ts gate 5 checks it).
  **Re-run after a failed step:**

  0. **Precheck:** no carrier mid-trade. No carrier's status in the mule cue dir may show `phase:
     'trading'` (`<R>/rc-cue/mule/` status files), and no helper log may show an open trade. A carrier
     killed mid-trade faults on restart until reconciled.
  1. **Stop:** Ctrl-C in the helpers window, which SIGINTs the launcher only (never kill by name or
     pattern; HELPERS.md:225). It logs every account out within `stopDeadlineMs` (25 s).
  2. **Confirm:** `<R>/launcher.json` shows every account's `logout` = `out` (`queued` = wait). Every
     helper's display name ('Cairn T01'.., 'Cairn Mule1', 'Cairn B01', ...) must be absent from
     `https://rs-sdk-demo.fly.dev/playerpositions`. Use display names, not login names. Budget minutes
     on a busy world: removal is one player per tick, world-wide (HELPERS.md:227).
  3. **Wait** at least 10 s after the last absence.
  4. **Relaunch:** the same start command, then wait for `<R>/launcher.json` helpersReady. **Do NOT
     run `mule-hold.ts` again** (holdMule refuses after a prepare, mule-readiness.ts:303).
  5. **Count before re-running run.ts:** ungated families (mules, ring givers, bone givers) log back
     in even if their step is done. **Count sessions on SCORED's address before the relaunch; refuse
     to relaunch above 45** (main, 12:35Z; worst case ~33-40).
  6. **Re-run run.ts** with the same `--run-dir`. Its resume reopens the step's cues fresh, and gated
     helpers (S21 givers, e15, a01, h45, the cue-start droppers) log in only on those new cues.

  **Expected after a relaunch:** a carry-ahead carrier makes one extra bank trip, and carriers resume
  from their served journal. **Unmeasured:** the relogin ramp's duration and a carrier's correct
  next-row serve after a mid-run relaunch.'

  Before all of it, SCORED is out, observed on `/playerpositions` (run.ts logs it out on a throw;
  else the stays-in branch above); the absence check names helper accounts only, never SCORED or a
  gate account. **A relaunch landing between H4's serve and H4k** (S05's remainder through T06-07;
  rs/186 via rs/158): after the relaunch and before re-running run.ts, wait until the H4k carrier's
  status file (the mule cue dir's `mule-<hash>.json`) shows phase 'ready' for H4k; if it does not
  within ~3 minutes, re-run anyway and accept the late-carrier refusal (STEP-MANIFEST.md entry 33). The altar givers and mules lose
  their stand-by in this case and log in again with the rest. **Unmeasured** (main): the path where a
  carrier is restarted; the relogin ramp (~3.5-4 min, rs/496's measured roster login on the start)
  and a carrier's next-row serve after a mid-run relaunch. **Price:** one SCORED login, the ramp
  running while SCORED is out (`playtime-audit.md` rows 1c and 4d); in the stays-in exceptions (a
  crash outside `runAttempt`, SIGKILL, an unconfirmed logout) the ramp's ~550 ticks land on the score
  (RUN-ORDER.md section 7, an unsummed ladder line).
- Helpers are **retired** (a final stop, `[run] cues closed final`) **only** on a completed whole
  run, SIGTERM or a second Ctrl-C, which **end the attempt**: a launcher never re-arms a retired
  scope (`helpers/standalone.ts`'s ScopeSessions), so a re-run after one finds no helpers.

**Never send SIGTERM or a second Ctrl-C unless the attempt is being ended.**

**Signals** (run.ts's signal shutdown, rs/546, on main with #462, 11353fbe): a first Ctrl-C asks for
a stop at the next logout-safe boundary; a second Ctrl-C (exit 130), SIGTERM or SIGHUP (exit 143)
logs SCORED out now and then ends the chain, so the cleanup (the cue close, the helper launchers,
Chrome, the token proxy, the report) runs before the exit, bounded at 60 s (`TERM_CLEANUP_MS`). A
hard kill (SIGKILL, a host failure) or a throw before the chain starts (an uncaught stack trace,
e.g. S21's relog refused at startup) still leaves the cues armed, **and leaves SCORED in the world
with nothing acting** (rs/186 22:3x; fold-in 34). The run tab's client logs itself out
after 10 minutes without input (`server/webclient/src/client/Client.ts:4926-4933`, the AFK logout
that sends `IDLE_TIMER`), so **re-run within ~9 minutes, or log SCORED out cleanly first**: every
tick in the world still counts, and an idle-out is an unplanned relog.

The checks, in order, before re-running. Any one failing means **do not re-run: tell main**.

1. **The StepError's step, phase and reason**, from the `[run] FAILED:` line in the run log
   (`<run dir>/run.jsonl` unless `--log` named another, `run.ts:134-137`), and exit code 1. Note
   them for main and for the attempt's findings.
2. **SCORED logged out cleanly**: the `[run] logout:` line, and the run tab on the title screen
   (`tab.ts` `pageInGame` false over the tab's DevTools, never the gateway's `inGame`). If the page
   still reads in game or the log has no logout line after a StepError, ask main first, unless the
   log shows the logout refused in combat: then the re-run has already gone first (above). **After a
   hard kill or a throw before the chain starts** SCORED is still in the world by design (above): re-run
   within ~9 minutes of it, or log SCORED out cleanly first; never leave it to the client's
   10-minute AFK logout (rs/186, fold-in 34).
3. **The relog lock is free**: `<run dir>/relog.lock` (`runner/relog-budget.ts:172-182`). The next
   taker removes a lock whose pid is dead, so it needs clearing by hand only when the pid it names
   is alive: then confirm that process is not a relog in progress (run.ts or `relog-now.ts`) before
   removing the lock, and ask main if unsure.
4. **Nothing else is cleared.** Keep `<run dir>/relogs.json` (it holds S21's open entry, which the
   re-run needs, `run.ts:436-460`), `<run dir>/handoffs.json` (the hand-offs this attempt completed:
   without it a re-run inside a band walks back to the band's hand-off and refuses, rs/562), the cue dir and the run dir (cleared only on a fresh start,
   `run.ts:507-509`, `cue-keeper.ts:24-38`). **Deleting `handoffs.json` makes a re-run inside S18, S22
   or S16 walk back to the consumed hand-off (H14, H18, H13) and refuse** (`HandOffRecord`, on main
   with #462; fold-in 35).
5. **The host claim is still held and live**: run.ts releases it only on success (`run.ts:533`); an
   expired claim makes gate 2 refuse with an `rs-claim take ...` hint (`run.ts:252-261`), so retake it
   as step 0 does first.
6. **The helpers, per family** (#468, 4657eed8, rs/583 from rs/186 @43f03530; fold-in 36). The log
   reads `[run] cues closed non-final: a re-run re-arms the helpers`. If the failed step's bone,
   anvil, fm-row, courier or S04 ring helpers must come back, restart the whole launcher before the re-run
   ("Relaunching after a failed step whose family exits", above: SIGINT after run.ts has exited and
   no carrier trading, every logout confirmed, no helper listed, the sessions counted (refuse above
   45), relaunch, helpersReady, never the
   mule-hold command again; the altar and mule givers come back with it); a failed S04 means the same
   relaunch, the ring givers being launcher entries (fold-in 38); the altar and
   mule givers stand by logged in on SCORED's address (up to 25-26 at S21, rs/41), and the
   re-run's cue re-arms them (measured, rs/597; a mule row already delivered is not served again,
   the caveat above). If it reads `[run] cues closed final` (a SIGTERM or a second Ctrl-C was sent), the
   attempt has been ended and the helpers retired: do not re-run, tell main.
7. **The step is not on the non-admitting list**: RUN-ORDER.md section 7's margin ladder and its
   attempt-ending lines (A and B are on main, #462 and #453, so fold-in 33's conditional note after
   H7 and in S18 and S22 mid-band is off; fold-in 35). Some lines name an
   operator fix before the re-run instead (S25a: walk SCORED to the anvil; S06 or S21: re-enter
   through the ruins; S21's relog logout half needs none since #468, which opens S21's entry once `logoutClean` reports
   SCORED out and before the page check, so an unconfirmed page leaves the entry open and the re-run
   takes the login half); the rest end the attempt.

**The re-run is the bare launch command, unchanged**: `bun speedrun/run.ts` with the same
arguments as the first launch (usage `run.ts:75-79`, parsing `run.ts:113-142`), the same `--run-dir`
and `--log`; there is no resume flag (the launch line itself is pending with rs/563, step 7).
**Never pass `--from` on a re-run**: it forces that step to run with no walk and no `done` check
(`resume.ts:305-307`), so `--from` into a finished step runs it again.

**The line to expect**, one per walk (`run.ts:395`):

```
[resume] {"kind":"resume","attempt":N,"point":{"index":I,"mode":"run|resume|finished","step":"<name>","lastDone":L,"firstUndone":F,"reason":"..."}}
```

The reason is `<step> is in progress` (mode `resume`), `<step> can start` (mode `run`) or
`every milestone is done` (`finished`) (`resume.ts:141-148`); a quest's step name carries its
segment (e.g. `S05:A-h4-swap`), and the tick log gets a `(resume)` row with the same fields
(`resume.ts:313`). It should name the step the StepError named, or the next one if that step's
`done` already holds. Any other step: stop and ask main.

**A refusal goes to main**, nothing changed by hand:

- a start gate, before anything logs in: `[gate] REFUSED <gate>: <detail>` and `[run] nothing was
  logged in`, exit 3 (`run.ts:495-504`);
- the walk: `[run] FAILED: no step can start from the observed state (last done milestone #L,
  first undone #F): <step>: <why>; ...`, exit 1, SCORED logged out (`resume.ts:69-74, 151`);
- the walk throwing while SCORED is not in the world: `[run] resume: run the same command again`,
  exit 4 (`attempt.ts:111`, `run.ts:536`): re-run once; a second refusal means stop and escalate,
  never loop;
- **the S00 edge, closed** (#468, 4657eed8, rs/583 from rs/186 @43f03530, rs/562's D; fold-in 36): each walk first waits up to
  30 observed ticks for a published state that carries the player (`runner/resume.ts` `awaitPlayer`,
  `PLAYER_MAX_TICKS`), so a re-run no longer sees S00 undone on an empty first state; past the bound
  the walk observes anyway, so a 'not in game' refusal after it goes to main.

**The run-day watch list** (fold-in 36; main via rs/158):

- **A death on a leg** (main's wording, 03:15 PDT, via rs/158). A Lumbridge respawn mid-leg is a death. The leg re-walks from Lumbridge on its own (~205 ticks from T06-07; travel.ts re-paths in the same leg, no re-run needed: rs/589's 02:18 run reported ok). Check the kit-gap line on that leg's row (T06-07: none, the worn staff kept, the runes spent or dropped) before the next hand-off. A respawn mid-leg means a jump to Lumbridge's respawn tile (3221,3218) on a leg that does not home-teleport: that tile is also the home teleport's landing. The walker does not flag it (rs/593, green at 26fbcce9, waits until after attempt 1); watch the live view and the run log.
- **SCORED's tab over ~3 hours (R44)** (rs/186 via rs/158, 13:1xZ 2026-10-23). run.ts's stdout carries one `TABMEM minute=… nodes=…` line a minute from rs/393's sampler (`speedrun/lib/tab-memory.ts`, wired into `runChainOnSession`); the host watches it against main's 100k-node alert and messages main and the operator at the alert, the run not stopping. No hours-long reading exists: the twin's pass 2 read heap 85.0 → 84.9 MB flat and nodes 584 → 1,547 in 3 minutes (~19k nodes an hour if linear, inferred), so 100k would come near hour 5, after the run's ~3.9 h, if the growth stays linear.

**An attempt cut short before H11r: h92 and H23** (main's ruling via rs/158; fold-in 36). h92's H11r
take-back waits without a bound at its return tile (`speedrun/helpers/cannon.ts:1545-1598`, `takeBack`'s
`for (;;)`, run through `retryUntil`, `:1375`, `:1394-1396`), and the fleet's `then` to the H23 serve fires
only when the H11 serve finishes. So if S14 aborts before H11r, or the run ends before T14-15, h92
waits there and H23 is never served until the operator reassigns it: `fleetctl assign cairn_h92 cannon
--options <H23 serve>` and a reload, a role change with no relogin, before H23. The unbounded wait is
deliberate, not a defect: it is what makes an operator re-run of S14 safe for H11r.

**The socket-drop recovery, on main** (#466, 86e7aa37: rs/511's work via rs/547, snapshotted as
rs/580 from rs/186 @34d0ecf4, 16 files byte-identical, with `cueStop(S27)` above T27-17; fold-in 35;
the figures below were measured on rs/511's patch: built and unit-tested, and lab-measured
on bgsrv-mac, the lab engine at 400 ms, the browser client, tree 1fccc5b7 + rs/511's patch,
cairn://p/rs/511/comments/2; fold-in 32). It is the current procedure, the manual relog above its
fallback. The design is `docs/speedrun/RESILIENCE.md` (the drop relog and its race rule, relog-now,
the confirmed logout, the deep-Wilderness resume).

- **An unplanned drop, run.ts's side.** In the 22:15:50Z shape (the run tab on the title screen,
  the world feed live) run.ts asks the page (`tab.ts` `pageInGame`) and logs it back in inside the
  page (`session.ts` `login({inPage: true})`, never a client relaunch), then resumes the step. Drop
  to back in the world: **24-26 ticks (9.5-10.3 s)**, about 17 of them detection (a page whose
  socket died still reads in game for ~7 s); the in-page login itself takes 0.7-1.4 s (m, lab).
  If run.ts's relog refuses or gives up, the operator relogs with relog-now (below), else by hand (above).
- **The operator's side of the race rule.** If the run tab is on the title screen and run.ts hasn't
  relogged it, run from an ssh shell on the run host:

  ```
  bun speedrun/tools/relog-now.ts <bot> [--run-dir=<run.ts's run dir>]
  ```

  `<bot>` is SCORED's bot directory, taken from the run's env and never written here. relog-now
  uses the run tab's DevTools at the bot env's `CDP_URL`, else 127.0.0.1:9222 (`--cdp=` overrides
  both; `--run-dir` defaults to run.ts's `RUN_DIR`; `speedrun/tools/relog-now.ts` on main). It takes the relog lock
  (`<run dir>/relog.lock`), logs the page in (an in-page login, the token URL as its fallback),
  **confirms only by the page's in-game flag with the tick advancing** (never the gateway's
  `inGame`), records a manual relog in the shared budget (`<run dir>/relogs.json`) and prints one
  line: `in: ...` (exit 0) or `failed: ...` (exit 1). It opens no SDK session, so it never takes
  the gateway from run.ts.
- **When it does nothing** (each prints `failed: ...; nothing done`): while run.ts holds the lock
  (run.ts is relogging the tab itself; run relog-now again only if run.ts gives up), while S21's
  planned relog is open (SCORED is out on purpose until its login half), and when the budget is
  spent. A page already in the world prints `in: ... is already in the world ...; nothing done`.
- **run.ts adopts the operator's session and never relogs over it**: it starts no relog while the
  operator holds the lock, then finds the page in the world, adopts that session
  (`session.ts` `adoptSession`) and resumes as after its own relog. A page it finds already back
  in the world is recorded as a manual relog, against the same budget.
- **The budget**: S21's planned relog plus 3 unplanned, **run.ts's and the operator's together**.
  Past it run.ts stops with `relog budget spent` as its reason (`RelogBudgetSpent`).
- **S21's planned logout** goes through `session.ts` `logoutClean`, which confirms the account out
  within `LOGOUT_CONFIRM_TICKS` = 4 observed ticks or sends the logout again (m, lab: 21 of 21
  browser logouts confirmed by the page, 0 ticks from the click to out, 1 send each). Between the
  halves of the split relog the account is out on purpose: no drop recovery, nothing counted.
- **A drop in the deep Wilderness** (unit-tested only, not lab-accepted: a fallback to budget, not
  a measured row; RUN-ORDER.md R8 and R53). A drop at level 21 or deeper between the keep and the
  spiders, off every checkpoint box, cannot restart from the leg's teleport (refused above level
  20). run.ts resumes at the leg's last run hop above level 20 (`legs.ts` `deepWildernessHop`:
  T13-14 and T26-27 at the run to the spiders, T15-16 at the run to the Mage Bank webs). If that
  fails, the walk stops with a ResumeError: **the operator walks SCORED south to level 20 or below
  by hand** (over the tab's DevTools, as the manual relog's act) **and restarts run.ts**, which
  resumes from the teleport. The cost is the walk back plus the teleport again. If the drop relog
  itself fails, the operator does the same after relog-now or the manual relog.

**After a player-kill: the recovery** (main 17:0x via rs/158; RUN-ORDER.md R8; fold-in 31). Logged-out
time costs nothing, so a death is recoverable only if SCORED logs out at once after the respawn, R8's
spawn helper (rs/526) is parked at the Lumbridge spawn with the phase's package, and a one-shot trades
the package and re-enters the chain; without all three the death is the attempt. **`recover-now`**
(rs/186 scopes it; pending, not on main's 09:00Z list) does it like relog-now: it walks to the
helper, receives the phase package (R8a-R8d) and re-enters the chain through the preconditions.
**The manual fallback, until it is on the floor:** (1) the operator stops run.ts; (2) SCORED logs out
at once from the run tab, over DevTools as the relog above, confirmed by `pageInGame`; (3) the
operator cues the spawn helper by writing its cue file, scope `{step: 'R8a'..'R8d', family: 'mule'}`
for the phase (the launcher's gate `{step: 'R8', family: 'mule'}` logs it in); (4) once the helper
stands beside the spawn, SCORED logs back in, takes the trade and the operator restarts the chain at
the step whose preconditions hold. The packages are pending rs/526. **Two deaths have no automatic
kit and are covered only by this manual recovery** (fold-in 35, rs/41 from rs/579's evidence via
rs/158): **a death at H23** and **a death in S27 with the cannon packed** (R8d1 refuses, short:
after a death H23 stays a done milestone, so the resume re-enters at T26-27b, which holds the web,
and a forced H23 repeat would be 7 slots short). For both, **the operator stages a knife (946) from
h68** (h68 holds 2) plus the kit by hand. **R8's staging** (rs/41, 11:14Z, against kits regenerated
from 38902b56, respawnCheck passing; main confirmed 04:40 PDT via rs/158; fold-in 37): **R8d2 is
staged** on h68 (shark 17, law 2, water 2, knife 1, by item id), so a death on the Agility course is
a priced recovery through its package and this knife line does not apply to it; **R8c is staged too** (rs/41, 12:12:09Z, by item id, the earmarks excluded, against the kits at 233d0f34, JSON sha256 5daf2997...f59b; main 12:15Z; before, not staged: air short 743, a Grand Exchange bid resting), so a death on T15-16 or in S16 is a priced recovery through its package;
**R8a is not staged** (no amulet of magic in the fleet); **R8d1 is refused by design** (26 slots
against 25). So **the manual recovery with a knife from h68 is attempt 1's procedure for R8a and the R8d1 deaths** (a death at H23, or in S27 with the cannon packed). h68's air 552 and death
110 are the rehearsal's H7 earmark and do not count toward R8. Its minutes are wall clock, not
ticks: R8's prices stay `r8-deaths.ts`'s, in ticks.

**S21 relog: reconciliation when the run script refuses** (rs/186's identity and order matrix; code
at 1fccc5b7, pending browser lab acceptance (rs/490): unit tests and CDP mocks only, not a
real-browser lab; fold-in 31):

| Case | State | What the script does | What the operator does |
|---|---|---|---|
| 1 | No open planned entry | a normal launch or resume | finish the T20-21 leg to its canonical arrival; never log out early |
| 2 | Entry OPEN (written once `logoutClean` reports SCORED out, before the page-out check; rs/562), the page proven OUT with no login pending (the entry's timing on main since #468, 4657eed8: `scored-relog.ts` opens the entry once `logoutClean` reports SCORED out, before the page confirmation; fold-in 36) | attaches without launching, waits for the world feed and the full fresh giver roster while SCORED is out, then logs in inside the page; the single planned entry closes only on success | nothing |
| 3 | Entry OPEN, the page LIVE | refuses: no login, no navigation, no entry change (a live page does not prove which session set the processing order) | inspects the account and session and the givers' login order, and reconciles the budget by hand; nothing adopts the state automatically |
| 4 | Entry OPEN, a login PENDING | refuses: no second dispatch or navigation | waits for the real outcome before reconciling; never erases the entry or restarts blindly |
| 5 | Entry OPEN, CDP unreadable or missing, or the page unknown | refuses the same way | restores observation and establishes the actual state first |
| 6 | A giver missing or stale after the feed gate or the token mint | no dispatch; if the login expires or the page flips live or pending during token redemption, the final page check refuses, with no fallback navigation, and the entry stays open | retries only from a proven-out state with a freshly checked full roster |
| 7 | The planned entry completed | does not repeat the S21 relog; the ordinary scene and resume path applies; world-full retries recheck admission on every dispatch and never reuse a stale authorization | nothing |

- A refusal closes the control SDK, not necessarily the game account. An account still live keeps
  accruing playtime, so the operator confirms the actual logout and state.
- No case is a zero-tick or automatic recovery.
- One shared lock and budget: one planned S21 relog plus three unplanned.
- The socket-drop half is on main with #466 (86e7aa37, fold-in 35; rs/511's work via rs/547 and
  rs/580): lab-measured with an injected drop, 24-26 ticks from the drop to back in the world
  (bgsrv-mac, 400 ms); 'The socket-drop recovery, on main' above. Between the halves of the split relog no drop recovery runs and nothing is counted.

**A tick-length change during the run** (main's ruling, 13:5x PDT 2026-10-22, via rs/158). **The run
never stops for it**: the score is in ticks, the in-page loops read the observed period once rs/470
lands (pending), and a stop burns the name. run.ts records the change (the world feed's `hello` at
each relog; rs/186, pending), and rs/83's monitor alerts on it. The operator is told live, and the
attempt's findings label the change. The two reads before the start keep their stop-on-change
(step 5a and the hand-off, above), since both come before SCORED's first login. On main neither the
record nor the alert is in the run chain; what shows a changed period there is TICKMON's
`periodMs`, minute by minute (above), which acts on nothing.

**Before S09: who is on the zoo iron cluster** (main, 21:58 PDT 2026-10-21; rs/259's threshold,
relayed by rs/158 at 22:37 PDT). S09 mines the six-rock cluster south of the Ardougne zoo (rocks
2602-2605, 3233-3237) on a five-stand lap, and on the demo other teams' accounts have worked it in
waves (RUN-ORDER.md R26). Before S09 starts, read `/playerpositions` once for the cluster.
**Contested means any account other than ours within 1 tile of a lap stand**; passers 7-8 tiles
away never touched the lap (m, rs/259's demo run, 2026-10-22 04:41-05:35Z). If the cluster is
contested, the run takes the fallback rs/259's child builds (rs/311's contested-lap detection and
alternate circuit, which takes over by rule once it is on the floor); until that lands, record the
reading in the run's record and carry on. Either way the count is for the watcher's awareness and
the log; nobody steps in. Run it on the chosen machine: it takes the lap's stands from
`speedrun/skills/mining.ts` and SCORED's name from `$SCORED_ENV` only to leave SCORED out, prints
only a count, and names nobody. Bound: 1 min. Expect `0 other accounts` on an uncontested cluster
(run without SCORED's name at 14:36Z on 2026-10-22, it read 0 of 1,639 online):

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'ENV=SCORED_ENV; cd ~/rs-sdk && S="$(sed -n "s/^BOT_USERNAME=//p" "$ENV")" timeout --kill-after=30s 1m ~/.bun/bin/bun -e "const { ROTATIONS, parseSteps } = await import(\"./speedrun/skills/mining.ts\"); const { playerNameKey } = await import(\"./speedrun/lib/demo-status.ts\"); const stands = parseSteps(ROTATIONS.five.steps).map(s => s.stand); const me = playerNameKey(process.env.S ?? \"\"); const b = await (await fetch(\"https://rs-sdk-demo.fly.dev/playerpositions\", { signal: AbortSignal.timeout(10000) })).json(); const all = Array.isArray(b) ? b : b.players; const n = all.filter(p => p.level === 0 && stands.some(([x, z]) => Math.max(Math.abs(p.x - x), Math.abs(p.z - z)) <= 1) && playerNameKey(p.name) !== me && !playerNameKey(p.name).startsWith(\"cairn \")).length; console.log(new Date().toISOString().slice(0, 19) + \"Z zoo iron cluster: \" + n + \" other accounts within 1 tile of a lap stand, \" + all.length + \" online\");"'
```

**Before S16 C, S10b K and S12 F: three boundary checks** (main 16:2x-16:3x via rs/158; rs/185's
competition census, RUN-ORDER.md R54; fold-in 31). Before each of these three, the operator reads the
region for other players and **holds until it is clear**: rs/83's feed gives every player's position
every 4 s without a login, through **rs/489's `--live` command** (its invocation pending rs/489: it
is not on main). The hold is priced as main ruled: SCORED logs out at the safe point before the
boundary (0 ticks on its clock + ~2 for the relog) where the module resumes from there; otherwise it
waits logged in, every tick counted. From the modules' segment flags and rs/186's resume walk:

| Boundary | The safe point before it | The hold |
|---|---|---|
| S16 C, Kolodion's fight (entering Kolodion's cellar) | the end of A, the kit, in the cellar (`logoutSafe` true; B and C are not) | **logged out**, 0 + ~2; the walk re-enters at B |
| S10b K, the warlord | the end of J (J and K are `logoutSafe`; M is not) | **logged out**, 0 + ~2; the walk re-enters at K |
| S12 F, Jeremy and the arena (the logout-unsafe stretch F-I) | the end of E, the cell keys (`logoutSafe` true) | **logged out**, 0 + ~2; the walk re-enters at F |

**No hold exists for the Wilderness PvP window on the landing tile.**

**Before S18: the knights' square** (rs/147's lever (1), via rs/158 at 13:39 PDT 2026-10-22).
rs/453's census found 37 of 42 rival accounts at Thieving 99 standing in one East Ardougne square,
the square of S18's knights (RUN-ORDER.md, S18's crowded-knight-square risk line). Players don't
block players, so a crowd doesn't stop SCORED or the courier, though it may pin a knight in place
(rs/147's read, on rs/477). Before S18 starts, the operator reads the square once and logs the count
in the run's record with the least-crowded knight, beside S09's reading. **It is informational:**
nobody steps in, and S18's module picks its own knight. rs/479 measured no cost from a crowd (up to 40
bots on one knight ran faster; RUN-ORDER.md R49, closed), so rs/480's `prefer: 'uncrowded'` is off the
pending list and the count is information only.

The square here is the knights' wander area: their four spawns, (2653,3300), (2669,3298),
(2671,3313) and (2652,3318), each with `wanderrange=15` (thieving.md), so x 2637-2686 and z
3283-3333 on level 0. It is wider than the market, and its count includes every account there, so it
isn't comparable with the census's 37. The command reads `/playerpositions` once (live positions,
refreshed at most once a second: `getPlayerPositionsJson` in `server/engine/src/web/worldfeed.ts`,
r) for the other accounts in the square, leaving ours and SCORED out as S09's does. Then it reads
one tick of the login-free world feed for the knights' tiles (NPC types 23 and 26,
`knight_of_ardougne` and `knight_of_ardougne2` in `server/content/pack/npc.pack`). For each knight
it counts the other accounts on the 8 tiles around it, the count rs/480's choice uses. Ties go to
the knight nearest the module's anchor, (2670,3305) (`BANDS` in `speedrun/skills/thieving.ts`). It
prints counts and tiles only, never a name; `none seen` means the feed showed no knight in the
square. Run it on the chosen machine. Bound: 1 min:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'ENV=SCORED_ENV; cd ~/rs-sdk && S="$(sed -n "s/^BOT_USERNAME=//p" "$ENV")" timeout --kill-after=30s 1m ~/.bun/bin/bun -e "const { playerNameKey } = await import(\"./speedrun/lib/demo-status.ts\"); const me = playerNameKey(process.env.S ?? \"\"); const q = { x: 2637, z: 3283, w: 50, h: 51 }; const inQ = p => p.level === 0 && p.x >= q.x && p.x < q.x + q.w && p.z >= q.z && p.z < q.z + q.h; const b = await (await fetch(\"https://rs-sdk-demo.fly.dev/playerpositions\", { signal: AbortSignal.timeout(10000) })).json(); const all = Array.isArray(b) ? b : b.players; const others = all.filter(p => inQ(p) && playerNameKey(p.name) !== me && !playerNameKey(p.name).startsWith(\"cairn \")); const ks = await new Promise((ok, no) => { const ws = new WebSocket(\"wss://rs-sdk-demo.fly.dev/worldfeed\"); const t = setTimeout(() => { ws.close(); no(new Error(\"no knights from the world feed within 15 s\")); }, 15000); ws.onmessage = e => { const m = JSON.parse(String(e.data)); if (m.t === \"hello\") ws.send(JSON.stringify({ t: \"sub\", ...q })); else if (m.t === \"tick\" && Array.isArray(m.n)) { clearTimeout(t); ws.close(); ok(m.n.filter(r => r.f === 1 && (r.t === 23 || r.t === 26) && r.l === 0)); } }; ws.onerror = () => { clearTimeout(t); no(new Error(\"the world feed refused the connection\")); }; }); const near = k => others.filter(p => Math.max(Math.abs(p.x - k.x), Math.abs(p.z - k.z)) === 1).length; const d = k => Math.max(Math.abs(k.x - 2670), Math.abs(k.z - 3305)); const rows = ks.map(k => ({ x: k.x, z: k.z, n: near(k) })).sort((a, c) => a.n - c.n || d(a) - d(c)); console.log(new Date().toISOString().slice(0, 19) + \"Z knight square: \" + others.length + \" other accounts, \" + all.length + \" online; knights (tile, others adjacent): \" + (rows.map(r => \"(\" + r.x + \",\" + r.z + \") \" + r.n).join(\", \") || \"none seen\") + \"; least crowded: \" + (rows[0] ? \"the knight at (\" + rows[0].x + \",\" + rows[0].z + \"), \" + rows[0].n + \" adjacent\" : \"none\"));"'
```

Its remote part, run through `bash -c` on fedora (bginf-halo) without SCORED's name at 20:53Z on 2026-10-22, exit
0, read (m, a dated observation of the demo):

```
2026-10-22T20:53:00Z knight square: 148 other accounts, 1238 online; knights (tile, others adjacent): (2669,3307) 1, (2661,3316) 4, (2674,3315) 12, (2663,3305) 16; least crowded: the knight at (2669,3307), 1 adjacent
```

## 8. Stop the recording and pull it

On the chosen machine (in its ssh form). The recording holds the run only if `handoff` passed (step
5a, hand-over line 6): the run tab alone on the recorded display. After SCORED's final clean logout (the run script's `logoutClean`), and only once that logout is
confirmed, stop ffmpeg with `q`, so it finishes the file, and check what it wrote. The final logout
is what writes SCORED's hiscore row (RUN-ORDER.md section 4, "Final logout"). With `RUN_COMMIT` at
or after `c2d9eada` ("Credentials"), `logoutClean` confirms the logout from the page's own in-game
flag, so its own result is trustworthy from the tab. The confirmation is both of these: the run
script's final `logoutClean` result reads `ok: true` with `confirmedBy: 'page'`, and the live view
shows the login screen. If the result is not `ok`, or the live view still shows SCORED in game, log
SCORED out with the attach-and-logout command below (the same `logoutClean` call `gate` makes for the
gate tab). It calls the same
`logoutClean` and exits 0 once the page is out of game. **Never kill the tab while SCORED is in
game.** `ENV` is `$SCORED_ENV`, as in step 7. Bound: 3 min. Its error messages can carry the
account's name, so keep its output out of chat and logs:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'ENV=SCORED_ENV; cd ~/rs-sdk && B="$(basename "$(dirname "$ENV")")" timeout --kill-after=30s 3m ~/.bun/bin/bun -e "const m = await import(\"./speedrun/lib/session.ts\"); const s = await m.openSession(process.env.B, { client: \"browser\", pathfinding: false, readyTimeoutMs: 30000 }); const r = await m.logoutClean(s); console.log(r.ok ? \"logged out; the page is out of game\" : \"not confirmed: \" + r.reason); await m.closeSession(s); process.exit(r.ok ? 0 : 1);"'
```

Dry-run it first ("Rules for every launch"): the same line with `printf "<%s>\n"` placed inside the
quotes immediately before `timeout`, so the machine's shell prints the words it would run, one per
line, and nothing attaches or logs out. The `-e` script must come back as one word; the output names
no account, since the directory goes in `B`, which `printf` doesn't print (m, fedora (bginf-halo), the same form
on a stand-in path, 2026-10-22).

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
opening givers and tab stack (its claim stays until the run is over). Teardown stops
everything explicitly; the bounds are only the backstop. Stop rs/117's helpers as
HELPERS.md says (clean logouts first), sending the stop **at least 5 minutes before they must be
out of the world**: the server logs out at most one player per tick world-wide, so a stop of many
accounts queues behind every other logout (rs/267; HELPERS.md, "Stopping"). Then stop the tab's stack. The recording must already be
stopped (step 8), since killing tmux under ffmpeg cuts the file short:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@"$RS_RUN_HOST" 'tmux -L run has-session -t rec 2>/dev/null && { echo "recording still running: stop it first (step 8)"; exit 1; }; tmux -L run kill-server; sleep 2; ls /tmp/tmux-$(id -u)/; pgrep -a -f "[p]roxy.ts|[g]ateway.ts|rs-run/[c]hrome-profile" || echo "tab stack stopped"'
```

The brackets keep the pattern from matching the ssh command's own shell, whose command line contains
it. Without them the check always found that shell and never printed `tab stack stopped` (m, 17:37
UTC).

**Gate evidence is kept, never deleted** (the host, 15:4x PDT 2026-10-22, after rs/310's teardown deleted
`/tmp/speedrun/gate-*.json` and with it a 56/60 reading's per-trial rows): (1) teardown never deletes
`~/gate-history`, `~/rs-run/gate-*` or `~/rs-run/<run>/load.log` (the load sampler's, step 6; fold-in 33); they are the run's gate evidence and are copied off with the
recording (the timer writes the gate's full JSON under `gate` in `~/gate-history/<UTC>.json`;
run-gate's `gate` writes `~/rs-run/gate-<UTC>/verdict.json`); (2) any ad-hoc gate or probe run under a
claim copies its JSON (per-trial rows, `tickArrivalsMs`) into its evidence before teardown; (3)
recordings and other large artifacts go to the operator's Mac via host (`~/rs-archive/<topic>/`,
sha256 checked), never deleted.

After the run, remove the every-minute sysstat drop-in
(`/etc/systemd/system/sysstat-collect.timer.d/every-minute.conf`, then `systemctl daemon-reload`)
on both machines (step 6, "The load ceiling"). Then run the leftover check ("Rules for every launch"). After a rehearsal, release its claim;
after the run, run.ts releases the run's on the chosen machine, and the operator releases the run's
claim on the other machine (`rs-claim release run`), after which rehearsals there may resume. On the twin, if it was not chosen, `~/rs-sdk` then goes back to main for the
attempts (step 0, "Twin:"). The session itself stays: nobody logs out of
XFCE. The recording stays on the host until its copy on the Mac is checked.

## Twin rehearsal with substitute supplies (rs/496)

`speedrun/lab/twin-rehearsal.ts` (rs/496's driver, on rs/496's branch, not on main; main 17:5x via
rs/158, fold-in 31) runs the chain on the twin with named substitute supplies:
`--substitute=<json>` names them, and `--until=H11r` or an earlier step stops it. It refuses the scored
account and the fleet's logins, and any run or host claim owner; **every gate still applies** (the
claim, the login cap, tenet 12's gate). Run it with `--dry-run` first and read its plan.

**A substitute row is written as SUBSTITUTE**, and it is excluded from measured totals and from
RUN-ORDER.md's comparisons. **A rehearsal is always partial.** The approved substitutes: S04 by
teleport xp; S07 on babydragon bones (no Prayer 99); S11a to 25, with H8 dropping the agility potion.
No scored or runner change comes with it.

**The rehearsal of 2026-10-23** (rs/496: the twin, 075c1763 = 38902b56 + lab and docs, 400 ms, the
browser on the loopback gateway; main via rs/158; fold-in 37; notes only, no re-price): the run
reached only H1, refused after 31 ticks, mule2 having no delivery prepare: the runner-side
delivery-session binding missing at 38902b56 (RUN-ORDER.md section 1, R52; the fix rs/598). **No
S01-S14 timings exist from this rehearsal.** S00's skip took 6 ticks (STEP-MANIFEST.md entry 34);
its tick monitor is in "Measured: the twin rehearsal's tick monitor" below. **Its step-7 rehearsal**
(the same day, 12:22-12:23Z; fold-in 38): `handoff --no-login`, then run.ts's single login, then the
post-login secrets check reading `0 0 0` in world, with the step's timing (step 7, "The secrets
check runs twice").

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

## Measured: the run host's gate in a rehearsal session, 2026-10-22

In rs/310's session E (cairn_jumps' Agility rehearsal; `uname -n` rs-ashburn-run), the run host's
gate read the direct probe at **56/60**, below tenet 12's 58/60 floor (m, a dated reading, not a
verdict on the run's gate). Its per-trial rows were lost when `/tmp/speedrun/gate-*.json` was deleted
at teardown, which is why step 9 now keeps every gate's JSON.

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
| rs/83's 17 same-minute pairs, up to 2026-10-22, before the run host's 17:39Z rotation (the pairs main called final-address) | the run host's previous address: a reading of its old route | **4 of 17 pass**, with held ticks on its path; at 17:30Z (a) 26 of 60, with no late ticks | **17 of 17 pass** | | m: rs/83, relayed by main and rs/158, 10:4x PDT 2026-10-22, and the host thread; the pair-by-pair table **pending** rs/83 |
| After the run host's 17:39Z rotation | its new address | **pending**: 4+ clean same-minute pairs before it can be the fallback | | | the host thread; rs/158, 10:5x PDT |
| rs/170's raw pair files (`tickArrivalsMs`) | | | `docs/speedrun/rehearsals/twin-pairs/` on `agent/rs-170-builder-0` (rs/170 is closed): **pending** their merge, for a tick-by-tick table here | | |

The raw arrivals of every pair are kept on the run host (`~/host-captures`) and on bgsrv-mac
(`~/hostpair`) by the host thread. Two clean pairs and one clean single read at the new address make
the route "consistent with fixed"; the series continues on both timers (rs/83, 16:32 PDT), and starts
again after the next address change.

## Measured: run-gate.ts rehearsed on the twin, 2026-10-22

**On the twin, not the run host** (m, rs/247, 2026-10-22 02:41-02:57Z; PR #216, merge commit
`b1a2765d`). A dated reading of the twin's route and the tool at that time, not a property of the
machine ("The host"). Conditions: the recording on `:10` from 02:40:13Z, RDP disconnected,
1,534-1,652 online, under an `rs-claim` of rs/247's, with two fresh throwaway accounts, a gate
account and a stand-in for SCORED (never the scored account). The run host's leg of `gate` was not
run live, because the tool was not yet on its checkout; the two-machine path and the choice rule are
covered by `speedrun/tools/run-gate.test.ts` only.

| | The twin, 02:41-02:57Z |
|---|---|
| Gates | 3, the twin only (`gate` warned that it gated one machine) |
| (a) direct reactions | 60/60 in each |
| (c) catch-ups | 0 a minute in each |
| (b) tick p90 (reported, not a pass line) | 405-489 ms |
| (d) tab loop p10, lowest / median / highest sample | 71.5 / 72.5 / 73.1 over 30 samples |
| Recording | 29.9-29.97 fps, 0 dropped (1,017 s, 30,503 frames) |
| Live frame, difference from the page's screenshot (pass at most 12/255) | 2.8 and 3.0 before login, 2.4 and 2.3 in game, against page contrast 48.8-50.8 |
| Hand-off | one Bot Client window, 1920x1029; 61 of ours online plus the stand-in's 1, under 80; secrets `0 0 0` |

Two forced unconfirmed-logout cases, which exist only with `--rehearsal`:

- **`--rehearse=kept-chrome`**: `logoutClean` was skipped and the gate Chrome **not** killed, the old
  `logout && kill` behaviour on an unconfirmed logout. `gate` **stopped** at its closed check, which
  found the `chrome` session, 12 processes on the profile and 1 Bot Client window. The `handoff` that
  followed **stopped at the step-7 precondition, exit 2**, before it opened anything.
- **`--rehearse=unconfirmed-logout`**: `logoutClean` was skipped and the kill left on. The gate
  Chrome was **killed unconditionally**, the closed check passed and the gate passed. The hand-off
  that followed **passed**, with a live frame of 3.0 before login and 2.3 in game. The gate account
  stayed in the world 2 min 43 s to 4 min 51 s after the kill.

All m. The kept-chrome case shows the closed checks catching the window main's 19:08 PDT ruling
forbids; the unconfirmed-logout case shows the unconditional kill clearing it.

## Measured: the run tab's browser profile, 2026-10-22

**A cold Chrome profile costs scene-load time at login, and a warm one doesn't** (m, rs/424 and
rs/41's warm-profile probes, 2026-10-22; relayed by rs/158 at 09:42 and 10:04 PDT). Through the
run's client origin a browser-client login took 40.3 s to in-game on a cold profile and reached
`sceneState` 2 at tick 83. On a warm profile it took 4.5 s, with `sceneState` 2 at the first poll and
441 of 442 models from IndexedDB. The cache is keyed by the exact page origin, since Chrome names the
IndexedDB directory by scheme, host and port, and it survives a Chrome restart on the same
user-data-dir. A copied profile kept all 1,257 IndexedDB keys at the same origin, and 12 of 12 maps
plus 100 sampled models loaded from cache with 0 socket requests. These were measured on Chrome 148
(chrome-headless-shell); the Ashburn machines run google-chrome 156, and a profile from one does not
carry over to the other (step 7). Earlier, rs/424 measured a cold-profile login taking 22 ticks to
scene-ready on Tutorial Island and 73 at Varrock west bank, with ~80 players there (models at about
15 files a second).

**The twin's run profile already holds ~174 MB of cache** under the origin directory
`http_127.0.0.1_8899` (m, the host thread, 17:45Z 2026-10-22, relayed by rs/158; a dated reading, not
a property).

## Measured: the demo's tick period, 2026-10-22

**The demo ran at 0.34-0.37 s a tick** around 03:4xZ on 2026-10-22: rs/210's tick monitor (step 7's
`TICKMON` rows) read 161-177 ticks a minute against 200 at 300 ms, during rs/269's S03 demo run
(m, a demo observation, dated; RUN-ORDER.md R23). The score is in ticks, so a slow tick costs
nothing itself; what it exposes is any cue or deadline timed in wall clock, which lands early (an
S03 launch at T0 + 75 x 300 ms cost ~18 ticks). When this was read, `tick-monitor.ts` anchored its
expected tick times on the nominal 300 ms, so on a slow demo it counted every tick as late. Since
rs/276's #226 (de66634b, inside the floor) its cadence steps by the observed period (`periodMs`), so a
slow but steady demo reads `late=0` (step 7).

**Since its 19:56:29Z restart on 2026-10-22 the demo has run 400 ms ticks** (a dated observation of
the demo). Its spectator feed's `hello` reads `tickMs` 400, and the gate probe's publication p50
went from 300 to 396 ms between the 19:30Z and 20:00Z pairs (m, the host thread, relayed by rs/158
at 13:0x PDT); rs/83 measured p50 402 (relayed by rs/158 at 13:1x PDT). The feed still read 400 at
20:10Z (m, rs/469, step 5a's command, from fedora (bginf-halo)). Rows and the score are in ticks, so nothing is
re-priced here; wall clock is x4/3, about 3.9 h for our row ("Rules for every launch"). Tenet 12's
(a) is in ticks and unaffected; (b) and (c) are fractions of T on main since #385 (a4456c73,
rs/471; fold-in 31): at T = 400 a catch-up is under 200 ms after over 466.7 ms, and (b)'s report line
533.3 ms (step 6).

## Measured: the demo relay holding SDK actions, 2026-10-22

**Through the home relay (`GATEWAY_DIRECT=false`) the demo held the scored side's SDK actions back by
p50 11 / p90 15 ticks, with 37 of 57 frames glued** (m, rs/197, on bbs, ~04:16Z 2026-10-22; a demo
observation, dated). The run machines use the loopback gateway (step 3's env check), so this does
not touch SCORED. It is recorded so that nobody runs a helper on the relay expecting tick-exact
timing: the tick-exact helpers run on SCORED's machine, on the launcher's loopback gateway (step 4).

## Measured: the twin rehearsal's tick monitor, 2026-10-23

**First minute on SCORED's stand-in, the twin** (m, rs/496's rehearsal: 075c1763 = 38902b56 + lab and
docs, 400 ms, the browser on the loopback gateway; relayed by main via rs/158, fold-in 37; a dated
twin reading, not a gate): `ticks=37 late=5 p50=24 p90=154 max=493 gaps=0 periodMs=399`. The rehearsal
stopped at H1 after 31 ticks ("Twin rehearsal with substitute supplies"), so this is its only minute
reported, and no S01-S14 timings exist from it.
