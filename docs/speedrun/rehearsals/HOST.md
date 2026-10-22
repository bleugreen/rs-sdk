# Rehearsal host: rs-ashburn-rehearsal

rs/147's fastest-99 rehearsals (cairn://p/rs/tenets/13) run from a twin of the scored run's host,
never from the run host itself. This page covers only what is particular to the twin: how to reach
it, how it differs from the run host, the claim lock (`rs-claim`) that books it, attempt
worktrees, teardown, how it was built, what it costs, every gate read taken on it, and how to stop
or remove it. **The procedure is [RUN-HOST.md](../RUN-HOST.md)**: bring-up, recording, gate,
teardown. Run its commands here with this page's ssh line and the deltas below. Figures carry
RUN-HOST.md's labels: **m** measured (with the time), **r** read, **i** inferred.

## The host

| | |
|---|---|
| Instance | `i-0f690e919614af7b2`, tag `Name=rs-ashburn-rehearsal`, launched 2026-10-21 12:57 PDT by rs/149 |
| Address | an Elastic IP (`$RS_TWIN_HOST`, below), so it survives a stop. rs/host rotated it on 2026-10-22 at 02:20Z; the instance and its host keys did not change. SSH and RDP admit only the operator's address (security group `sg-0f1bb560e649e85c5`, a copy of the run host's ingress). Not on the tailnet |
| Machine | c7i.2xlarge in us-east-1c on the run host's subnet: 8 vCPU (Xeon Platinum 8488C), 15 GB, 60 GB gp3 (3000 IOPS, 125 MB/s), no GPU (m) |
| OS | the run host's AMI `ami-02a9cdd4e98bc3c78`, Ubuntu 24.04.5 (m) |
| Desktop | XFCE served by xrdp, user `ubuntu`, `max_bpp=24`, sesman `KillDisconnected=false`, `DisconnectedTimeLimit=0`, `IdleTimeLimit=0`; no screensaver or locker installed; `xset` no-blank autostart; logind `IdleAction=ignore` (m, read back by the setup script). The operator's first connect made the desktop on display **:10**, 1920x1080, 24 planes (m, session started 20:17:57 UTC) |
| Tools | Google Chrome 156.0.8078.47, held at that version (`apt-mark hold`); Bun 1.4.3 at `~/.bun/bin/bun`, not on PATH for non-login ssh commands; ffmpeg 6.1.1; tmux 3.4; sysstat 12.6.1; Xvfb (m) |
| Checkout | `/home/ubuntu/rs-sdk`, a clone of bleugreen/rs-sdk on a main commit, built as RUN-HOST.md step 0. The page server, the gateway and Chrome always run from here. Only rs/149 moves it, or rs/147's coordinator through rs/149 |
| Gate accounts | `cairn_twin`, the default for the skill children and the harness (`--gate-bot`); `cairn_gate`, rs/149's own reads. Both are throwaways created on this host, with env files in `~/rs-sdk/bots/<name>/bot.env`, mode 600 |
| Keys | `~/.rs-fleet/id_ed25519_rehearsal` on `bgsrv-ub` and on the Mac (`local`). These are **two different keys with the same file name**, one generated on each machine, so no private key has moved. Both are in ubuntu's `authorized_keys` |
| known_hosts | `~/.rs-fleet/known_hosts_rehearsal` on `local` and `bgsrv-ub` only, re-pinned under the new address at the rotation (bgsrv-mac has no rehearsal key and no pin). These are the three host keys cloud-init printed to the EC2 console. To pin on any other machine, check the key against the ED25519 fingerprint `SHA256:9P9aIrnyHo/6G0Fmn//VkLLB9+RVVwlGe57uyhhdB1I` first; never trust on first use |
| RDP password | `~/.rs-fleet/rehearsal-rdp-password` on the Mac, mode 600. Copy it with `pbcopy < ~/.rs-fleet/rehearsal-rdp-password`; never print it |

**Addresses.** The twin's and the run host's addresses are not in this repository, and never go in
any committed file (tenet 20). They are recorded only in cairn://p/rs/host/arc. Before using this
page, export them locally, in the shell or Cairn batch that runs its commands: `export RS_TWIN_HOST=<the twin's public address> RS_RUN_HOST=<rs-ashburn-run's public
address> RS_RUN_TAILNET=<rs-ashburn-run's tailnet address>`. Never commit their values.

**Reaching it.** Paste on the Mac, or run from a Cairn batch on executor `bgsrv-ub` (host batches)
or `local`:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_rehearsal -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_rehearsal -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@$RS_TWIN_HOST 'uptime'
```

To use a RUN-HOST.md command here, replace `id_ed25519_ashburn` with `id_ed25519_rehearsal`,
`known_hosts_ashburn` with `known_hosts_rehearsal`, and the run host's address with `$RS_TWIN_HOST`. Never
run RUN-HOST.md's commands unchanged: they reach the run host.

## How it differs from RUN-HOST.md

- **Bounds.** A fastest-99 attempt runs for about 1 to 3 hours (i, from the skill docs' totals), not
  the run's 9 h or a run rehearsal's 30 min. In every launch that RUN-HOST.md bounds with `T=9h`
  (page server, gateway, the account's Chrome tab, recording, live view), use `T` = the
  attempt's bound, which is the expected wall time times 1.5 (rs/147's brief). For example, `T=3h`
  for a 2-hour estimate. The gate account's tab stays `T=15m`, the gate CLI `15m`, the sampler
  `10m`, `tab-login.ts` `3m`, and `tab-logout.ts` `2m`.
- **One display, several accounts.** The gate account's tab and the attempt's are windows of the
  same Chrome on the xrdp display, and the recording grabs that display whole. Don't open a second
  client window by hand. The harness closes the gate's window before the attempt logs in, checks
  a live frame of the display, and opens no gate window again until the recording has stopped
  (HARNESS.md, "What the recording shows"). Pass the display to the harness as `DISPLAY`.
- **The claim is the booking.** Time on this host is taken with `rs-claim` (below), which keeps its
  lock in `~/host-reserved.json`, the file the gate timer skips on. The gate timer and
  `~/run-commit` are described under "Run-capable twin". The probe-slot minutes in RUN-HOST.md
  (:00-:03 and so on) protect measurements on the run host and don't apply here.
- **RDP** goes to the public address, `$RS_TWIN_HOST` port 3389, not to a tailnet name. Client settings are
  RUN-HOST.md step 2's (1920x1080 fixed, Retina off, 24-bit). One desktop per user applies here too,
  and a stop of the instance ends it.
- **Live view.** There is no tailnet address to bind, so step 5's live view binds `127.0.0.1:8090`:
  in its command, replace `http://$RS_RUN_TAILNET:8090/live.mjpg` with
  `http://127.0.0.1:8090/live.mjpg`. The operator opens it through an ssh tunnel,
  `ssh -N -L 8090:127.0.0.1:8090 <this page's ssh options> ubuntu@$RS_TWIN_HOST`, then
  `http://127.0.0.1:8090/live.mjpg`. On the host, `curl` received 23 JPEG parts in 6 s from it
  (m, 20:32 UTC).
- **Step 0** is the setup script with the commit as its argument ("Setup", below). It moves the
  clone and rebuilds.
- **Accounts** are fresh rehearsal accounts that main names, plus the gate throwaways. Never a fleet,
  helper or SCORED account. Each account's `~/rs-sdk/bots/<name>/bot.env` is mode 600 and holds
  RUN-HOST.md step 0's keys. The tab logs in with `speedrun/tools/tab-login.ts` (rs/138, #120, on
  main). No query-string login has ever been used on this host.
- **Xvfb.** When no RDP session exists, an agent may check things on an Xvfb display, as the whole
  command of a tmux session in the `run` socket:
  `tmux -L run new-session -d -s xvfb "exec timeout --kill-after=30s 40m Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp"`.
  Label any figure taken there **Xvfb**; attempts run on the xrdp display. Xvfb has no window
  manager, so Chrome's `--start-maximized` leaves a 945x1060 window there (m). **`tmux kill-server`
  does not stop Xvfb**: it sends SIGHUP, which Xvfb takes as a server reset, so it kept running until
  stopped with `pkill -TERM -x Xvfb` (m, 20:20 UTC). The teardown below does that.

A new account's env file is written on the host with a fresh random password that is never printed
(`N` is the name main assigned):

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_rehearsal -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_rehearsal -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@$RS_TWIN_HOST 'N=NAME; D=$HOME/rs-sdk/bots/$N; [ -e $D/bot.env ] && { echo "$D/bot.env exists, stop"; exit 1; }; umask 077; mkdir -p $D && { echo BOT_USERNAME=$N; echo PASSWORD=$(openssl rand -hex 8); echo SERVER=rs-sdk-demo.fly.dev; echo GATEWAY_URL=ws://127.0.0.1:7780; echo "CLIENT_URL=http://127.0.0.1:8899/bot?server=rs-sdk-demo.fly.dev&gateway=ws://127.0.0.1:7780"; echo CDP_URL=http://127.0.0.1:9222; echo TELEMETRY=false; } >$D/bot.env && chmod 600 $D/bot.env && ls -l $D/bot.env'
```

## Claims: `rs-claim` books the machine

Since 2026-10-22 02:28Z, time on the twin (and, until run eve, on the run host) is first come,
first served through host's claim lock (tenet 21). It replaced rs/147's slot calendar and the slot
files: **`~/rehearsal-slots` is retired**. Nothing reads it, so a file left there books nothing.
The lock is `~/.local/bin/rs-claim` on both Ashburn machines. Run it on the machine you will use,
over this page's ssh line:

- `rs-claim status` shows who holds the machine, until when, and for what.
- `rs-claim take OWNER LOGINS MINUTES WHAT` takes it. Take it **only when you are staged and
  ready** (worktree made, served page checked, env files in place), never to hold a place in line.
  `OWNER` is your issue as `rs/NNN`. `LOGINS` is every login you will make on this machine under
  the claim: the gate account counts, so an attempt with its gate read declares 2. `MINUTES` is
  your bound, the attempt's `T` plus margin. `WHAT` is a short reason. The take is granted only if
  the claim is free, stale or already yours, and only if our accounts online now plus `LOGINS`
  stay within 100. If the online count can't be read, it refuses. A refusal prints why.
- `rs-claim touch OWNER` renews your claim. A claim goes stale at take + `MINUTES` + 10 minutes
  unless it is touched, and a stale claim blocks nobody. Touch it now and then in a long hold:
  that is also how a preempt reaches you.
- `rs-claim release OWNER` gives it back, after the last clean logout, the teardown and the
  leftover check.

Host can preempt any claim (`rs-claim preempt MINUTES DRAIN REASON`, host only), for the gate
series, an address rotation or the scored run. After a preempt, the holder's `touch` exits 3.
The holder must then log every account out cleanly and release within `DRAIN` minutes, and takes
nothing again until `status` shows the machine free. Every take, touch, release and preempt is
logged to `~/claims/log.jsonl` on that machine. The claim enforces one holder per machine and the
100-per-address line; keeping to tenet 13's two rehearsal accounts logged in at once is still the
holder's job.

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_rehearsal -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_rehearsal -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@$RS_TWIN_HOST '~/.local/bin/rs-claim status'
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_rehearsal -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_rehearsal -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@$RS_TWIN_HOST '~/.local/bin/rs-claim take rs/NNN 2 MINUTES "woodcutting attempt"'
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_rehearsal -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_rehearsal -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@$RS_TWIN_HOST '~/.local/bin/rs-claim touch rs/NNN; echo "touch exit $?"'
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_rehearsal -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_rehearsal -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@$RS_TWIN_HOST '~/.local/bin/rs-claim release rs/NNN; ~/.local/bin/rs-claim status'
```

**`rehearse.ts` under your claim: `--claim-owner=rs/NNN`.** The harness's pre-flight (rs/213,
"Run-capable twin" below) reads the claim's own file, `~/host-reserved.json`. Name the claim you
took with `--claim-owner=rs/NNN` (or `SPEEDRUN_CLAIM_OWNER=rs/NNN`), as the gate timer's
`RS_GATE_OWNER` names its own. Without it, the harness refuses under your own claim (exit 5).

- A live claim of that owner is yours and blocks nothing. Any other live owner refuses at
  pre-flight with exit 5, never forced.
- At each step boundary, a claim that is no longer yours pauses the attempt as a reservation does
  (below). So does host's preempt of it, which `rs-claim` writes as `"owner": "host"` with
  `"displaced": {"owner": "rs/NNN", ...}`. The pause is a clean logout, no relaunch, 'paused for
  the gate/run' and exit 5, and the harness then prints the `rs-claim release` you owe.
- A claim of yours that has gone stale prints a warning and the attempt goes on, since nobody else
  holds the machine.
- Where `rs-claim` is installed, the harness also runs `rs-claim touch` at step boundaries, in
  the background and at most once a minute. A touch that exits 3 pauses the attempt at the next
  boundary. A boundary comes only between steps, so a long band (about 12 minutes for willows
  73-99) goes untouched until it ends.

Don't hide the file from the harness with `--host-reservation`, because that also hides a preempt.

**Leftover check**, before any launch and after any teardown or bound. It is RUN-HOST.md's check with
Xvfb added and the claim's status in place of the reservation. After teardown, expect no tmux
server, no process, and the claim still yours until you release it:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_rehearsal -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_rehearsal -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@$RS_TWIN_HOST 'for s in /tmp/tmux-$(id -u)/*; do [ -S "$s" ] && echo "tmux -L $(basename $s): $(tmux -S $s ls 2>&1 | tr "\n" " ")"; done; ps -o pid,etime,comm -p "$(pgrep -d, "^(chrome.*|ffmpeg|bun|timeout|Xvfb)$")" 2>/dev/null || echo "no chrome, ffmpeg, bun, timeout or Xvfb process"; ~/.local/bin/rs-claim status'
```

## Attempt worktrees

An attempt runs its own branch's code from a separate worktree, `~/rs-<issue>`. The branch comes in
as a git bundle from bgsrv-ub, so nothing is pushed. The worktree's `bots/` is a symlink to
`~/rs-sdk/bots`, so env files stay in one place, mode 600. The gateway and Chrome run from
`~/rs-sdk` as RUN-HOST.md step 3 does, but **the page server (`proxy.ts`) runs from the attempt
worktree**, so the tab runs the branch's in-page programs (`server/webclient/src/bot/programs/`).
The skill modules pass program parameters that reach main only with their snapshot (for example
knife-cycle's `untilXp`, `followSpot` and plain `dropEach`), and a program ignores a parameter it
doesn't know without any error: served from main, the attempt would run a different program from
the one it was priced on. Before the attempt account logs in, confirm the served page carries the
branch's programs: grep what the page server serves for one parameter the module passes, and record
the check in the attempt's log. `~/rs-sdk` itself stays on its main commit, and the worktree is
removed after the attempt.

On bgsrv-ub, in the branch's checkout (`I` is the issue, as `rs-NNN`):

```sh
I=rs-NNN; git bundle create /tmp/$I.bundle HEAD && scp -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_rehearsal -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_rehearsal -o StrictHostKeyChecking=yes -o CheckHostIP=no /tmp/$I.bundle ubuntu@$RS_TWIN_HOST:$I.bundle && rm /tmp/$I.bundle
```

On the host, make the worktree:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_rehearsal -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_rehearsal -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@$RS_TWIN_HOST 'I=rs-NNN; export PATH=$HOME/.bun/bin:$PATH; cd ~/rs-sdk && git fetch -q ~/$I.bundle HEAD && git worktree add -q --detach ~/$I FETCH_HEAD && rm -rf ~/$I/bots && ln -s ~/rs-sdk/bots ~/$I/bots && cd ~/$I && bun install >/dev/null && git log -1 --oneline'
```

In the worktree, `git status` lists bots' four tracked files (`_template/`, `create-bot.ts`) as
deleted; the symlink stands in for them, and nothing is committed there. Remove it after the attempt's
teardown:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_rehearsal -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_rehearsal -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@$RS_TWIN_HOST 'I=rs-NNN; cd ~/rs-sdk && git worktree remove --force ~/$I && git worktree prune && rm -f ~/$I.bundle; git worktree list; ls ~/rs-sdk/bots'
```

`git worktree remove` deletes the symlink, not what it points to: the env files and their mode
survived it (m, bgsrv-ub, on a scratch clone with the same layout, 20:37 UTC).

## Teardown: log out first

No logged-in client is ever dropped, not even a throwaway's (rs/101). A dropped client stays in the
world for up to 500 ticks, and on a rehearsal account that is playtime. In order:

1. **Log every tab out.** An attempt ends with its own `logoutClean` at 99, and then this reports
   `no tab in game`. Every gate tab is logged out with it before its Chrome closes. Expect
   `logged out; the page is out of game` or `no tab in game`. Exit 1 means it is not confirmed:
   stop, and look at the tab.

   ```sh
   ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_rehearsal -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_rehearsal -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@$RS_TWIN_HOST 'cd ~/rs-sdk && timeout --kill-after=30s 2m ~/.bun/bin/bun speedrun/tools/tab-logout.ts NAME 2>&1 | grep tab-logout'
   ```

   `speedrun/tools/tab-logout.ts` runs `logoutClean` and then confirms through the page's own
   in-game flag over Chrome's DevTools port. `logoutClean` on its own can't confirm a browser tab:
   once the tab logs out the page stops publishing, and the gateway keeps its last state
   (`inGame: true`, status `stale`). So it returned "still in game after timeout" on a tab that had
   left the world (m, cairn_twin, 20:33 UTC). rs/164 is fixing that inside `speedrun/lib/session.ts`.
   Once its fix merges, `logoutClean` alone is enough, and `tab-logout.ts` is superseded. Until this
   page's PR merges, the host's clone has `tab-logout.ts` as an untracked file. The setup script's
   `checkout -f` replaces it when the clone moves to a commit that tracks it.
2. **Stop the recording**: RUN-HOST.md step 8.
3. **Stop the stack**, Xvfb included:

   ```sh
   ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_rehearsal -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_rehearsal -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@$RS_TWIN_HOST 'tmux -L run has-session -t rec 2>/dev/null && { echo "recording still running: stop it first (RUN-HOST.md step 8)"; exit 1; }; tmux -L run kill-server; pkill -TERM -x Xvfb; sleep 3; { pgrep -a -f "[p]roxy.ts|[g]ateway.ts|rs-run/[c]hrome-profile"; pgrep -a -x Xvfb; } | grep . || echo "tab stack stopped"'
   ```

   Xvfb is matched by process name (`pgrep -x`), not by command line: this ssh command's own shell
   carries `pkill -TERM -x Xvfb` in its command line, so a `-f` pattern on `[X]vfb` matched the
   shell itself and the check never printed "tab stack stopped" (m, rs/167, 21:16 UTC).

4. The leftover check, then release your claim (`rs-claim release rs/NNN`) and remove your
   worktree.

rs/96's direct gate CLI (`tickmanip-latency.ts --path=direct`) logs out at the end (rs/168) and
prints a `logout (direct):` line once the server confirms. A read whose last line says anything
else has left its account in the world, so check `/playerpositions` before the next login.

## Setup

Two committed scripts rebuild the twin; nothing depends on remembering steps.

- [`rehearsal-host-provision.sh`](../scripts/rehearsal-host-provision.sh) runs on the Mac with the
  `bglab` profile. It reads the run host by describe calls only and copies its AMI, type, subnet,
  root volume and ingress. It imports the Mac's key and passes other machines' public keys to
  cloud-init. It launches the instance, attaches the Elastic IP, pins `known_hosts` from the
  console, and sets the RDP password from stdin. It refuses while a twin exists, and ends with
  `INSTANCE_ID=... PUBLIC_IP=...`. Run it as
  `bash docs/speedrun/scripts/rehearsal-host-provision.sh 'ssh-ed25519 AAAA... rs-ashburn-rehearsal bgsrv-ub'`,
  with bgsrv-ub's `~/.rs-fleet/id_ed25519_rehearsal.pub` as the argument. Then copy
  `known_hosts_rehearsal` (public keys only) to bgsrv-ub.
- [`rehearsal-host-setup.sh`](../scripts/rehearsal-host-setup.sh) runs on the host. It installs and
  configures XFCE and xrdp, removes the screensavers, sets no-blank, and installs Chrome 156 (held),
  Bun 1.4.3, ffmpeg, tmux and sysstat. It clones the fork and checks it out at the given commit
  (with `-f`: nobody edits this clone by hand). Then it builds as step 0 and prints what it set. It
  is idempotent, starts nothing long-lived, and restarts xrdp only while nobody is connected:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_rehearsal -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_rehearsal -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@$RS_TWIN_HOST 'bash -s -- origin/main' < docs/speedrun/scripts/rehearsal-host-setup.sh
```

First built 2026-10-21 12:57-13:01 PDT. The setup took about 3 minutes, at main `7c3e8c706`.

## Cost

On-demand prices from the AWS Pricing API (`aws pricing get-products`, us-east-1), read 2026-10-21
12:59 PDT; the c7i price entry was published 2026-10-15:

| Item | Price | Per day |
|---|---|---|
| c7i.2xlarge, Linux, shared tenancy | $0.357/h | $8.57 |
| EBS gp3, 60 GB (the baseline 3000 IOPS and 125 MB/s are free) | $0.08/GB-month | $0.16 |
| Public IPv4, the Elastic IP (in use or idle) | $0.005/h | $0.12 |
| **Running** | | **about $8.85** (about $0.37/h) |
| **Stopped** | | **about $0.28** (disk and address) |

Data out beyond AWS's free 100 GB a month is $0.09/GB. Pulling recordings (about 3.3 GB per hour of
recording, RUN-HOST.md step 5) is the only sizeable transfer.

## Gate reads on this host

Every gate read taken on the twin, newest last, all on 2026-10-21 (m). Players are the gate CLI's
own online count where it printed one, otherwise `/playercount` right before and after.

**Preconditions (RUN-HOST.md step 1)**, 20:02:12 UTC: the request id ends `-iad`; TCP connect p50
2.4 ms, p90 2.7, max 2.9 over 20. **Pass.** `/playercount` read 23 at that moment and 1,320
eight minutes later, so treat the 23 as a bad read of the endpoint (i).

| # | UTC | Account | Display and configuration | Read | Result | Players |
|---|---|---|---|---|---|---|
| 1 | 20:10:55-20:12:26 | cairn_gate | none: direct path, no tab | (a)-(c), rs/96's CLI | (a) 60/60; (b) tick p90 397 ms; (c) 0 catch-ups/min; vantage iad, TCP p50 2.4 ms. **Pass** | 1,411 |
| 2 | 20:14:20-20:19:37 | cairn_gate | **Xvfb** :99, recording on, no live view | (d), `runhost-loops.ts` 5 min | loop p10 72.0 / 72.6 / 73.2. **Pass** | 1,466 → 1,562 |
| 3 | 20:19:58 | cairn_gate | **Xvfb** :99 | `probeInPage`, 60 trials | 60/60 on time; frame to decision p50 2 ms | 1,562 |
| 4 | 20:22:16-20:23:45 | cairn_twin | xrdp :10, RDP disconnected, recording on, tab closed | (a)-(c) | (a) 60/60; (b) 377 ms; (c) 0/min; TCP p50 1.9 ms. **Pass** | 1,589 |
| 5 | 20:24:06-20:29:23 | cairn_twin | xrdp :10, RDP disconnected, recording and live view on | (d) | loop p10 70.8 / 72.0 / 72.9. **Pass** | 1,596 → 1,604 |
| 6 | 20:29:46 | cairn_twin | xrdp :10, RDP disconnected | `probeInPage`, 60 trials | 60/60 on time; frame to decision p50 2 ms; loop p10 71.9 | 1,604 |
| 7 | 21:00:00-21:01:27 | cairn_gate | none: direct path, no tab; twin idle | (a)-(c), paired with the run host's 21:00 timer read | (a) 60/60; (b) 405 ms, over; (c) 1 catch-up/min; TCP p50 2.2 ms. **Pass** | 1,579 |
| 8 | 21:30:00-21:31:28 | cairn_gate | none; twin idle | (a)-(c), paired, 21:30 | (a) 59/60; (b) 390 ms; (c) 1/min; TCP p50 2.4 ms. **Pass** | 1,602 |
| 9 | 22:00:00-22:01:26 | cairn_gate | none; **rs/174's stack running** (page server, gateway, Chrome tab, relog probe on cairn_smoke) | (a)-(c), paired, 22:00 | (a) 60/60; (b) 390 ms; (c) 0/min; TCP p50 2.0 ms. **Pass** | 1,627 |
| 10 | 22:30:00-22:31:26 | cairn_gate | none; twin idle | (a)-(c), paired, 22:30 | (a) 60/60; (b) 380 ms; (c) 0/min; TCP p50 2.0 ms. **Pass** | 1,502 |
| 11 | 23:00:00-23:01:27 | cairn_gate | none; twin idle | (a)-(c), paired, 23:00 | (a) 60/60; (b) 436 ms, over; (c) 0/min; TCP p50 2.3 ms. **Pass** | 1,597 |
| 12 | 23:30:00-23:31:27 | cairn_gate | none; twin idle | (a)-(c), paired, 23:30, the run host on its new address | (a) 60/60; (b) 383 ms; (c) 1/min; TCP p50 2.3 ms. **Pass** | 1,545 |

**Reads 4 to 6 are the twin's gate of record**: the run's configuration, every line passing. Main
noted read 1 as the first fully passing gate minute recorded from an iad host. (d) is the lowest /
median / highest 10-second p10 of 30 samples (RUN-HOST.md step 6). Read 2 is on Xvfb: no RDP
session existed yet.

**Reads 7 to 12 are paired reads** (rs/170 for rs/83; read 12 for the host thread, the first
pair after the run host moved to a new address, today's `$RS_RUN_HOST`, at 23:11 UTC). Each started on the same second as the run
host's gate timer read (:00:00 and :30:00 UTC), so the two hosts were measured in the same minute.
rs/83 holds the run host's side in its own `~/gate-history`, and the comparison is rs/83's call.
Each read ran through
[`twin-gate-pair.sh`](../scripts/twin-gate-pair.sh), fed over the ssh line above. The script runs
the leftover check, skips when other owners' slots already hold two logins, takes its own
`logins:1` slot, starts rs/96's direct CLI on the second under `timeout --kill-after=30s 5m`, and
holds the slot until `/playerpositions` no longer lists the account. Those reads predate the claim
lock: the script still takes a file in the retired `~/rehearsal-slots`, so it books nothing and
is not to be run until it takes an `rs-claim` instead. The CLI was rs/168's
logout fix (`a369af7f0`); the probe itself is unchanged from rs/96. Every read logged out on the
first click and left the world within 0-5 s. The account stood on the Lumbridge spawn
(3223,3222, region 50_50) each time, with 38 to 65 other players within 15 tiles. The twin
never read more than 1 catch-up/min and never fewer than 59/60 on time. Read 9 shared the twin
within the cap with rs/174's stack, which started at 21:58:31; the others had the twin to
themselves. The ssh for reads 11 and 12 came from the Mac because bgsrv-ub was offline, and the
reads themselves ran on the twin as before. The CLI's JSON (with `result.tickArrivalsMs`), its log and the
in-world samples are in [`twin-pairs/`](twin-pairs/).

CPU during (d), medians in percent of one core:

| | ffmpeg (recording) | Tab renderer | GPU process | Chrome total | Xorg | Host busy (8 vCPU) | Recording |
|---|---|---|---|---|---|---|---|
| Read 2, Xvfb | 87 | 80 | 19 | 99 | not sampled | 24-28% | 29.86 fps, 0 dropped |
| Read 5, xrdp | 117 | 84 | 30 | 114 | 19 | 31-33%, load at most 3.9 | 29.91 fps, 0 dropped |
| Run host, RUN-HOST.md row 3 (for comparison) | 95 | 63 | 24 | 87 | 15 | 25% | 29.9 fps, 0 dropped |

The twin spends somewhat more on the recording and the tab than the run host did. The scenes
differed: the twin's account had just left Tutorial Island, while the run host's had stood in
Lumbridge (i). It is still two-thirds idle.

Notes on the reads:

- The sampler's "run min" (the slowest single tick interval since the probe started) was 9 on Xvfb
  and 8.2 on xrdp, from the first sample onwards, against 64-68 on the run host. Each was one stall in
  the first 10 s. Both of those runs began with `--skip-tutorial`, which moves the account off
  Tutorial Island and loads a new region (i). No 10-second p10 was below 70.8.
- During read 5 no one watched the live view, so its ffmpeg waited for a viewer and cost 0-0.1% of a
  core. The run host measured 3.7% with a viewer attached.
- The sampler's own walk probe, which is context and not a gate line, had 1,015 on time and 1 late
  in read 2, and 1,027 on time and 0 late in read 5, with 3 frame catch-ups in each 5 minutes.
- `tickprog-measure.ts probe` printed `NaN` for the page's decoded-tick intervals in reads 3 and 6.
  That line is not part of the gate.
- Bring-up (RUN-HOST.md step 3) passed both times: the 302 redirect; `400` for a password in the
  URL; the six flags; a 1920x1029 window at +0+24 on :10; `tab-login.ts` in game after 6-9 s; and
  the secrets check at `0 0 0`. That check needs the corrected form now in RUN-HOST.md: the old one
  counted its own shell and read `0 2 0` with nothing leaked (m, 20:24 UTC).
- After each session the leftover check was clean, apart from the Xvfb that `kill-server` did not
  stop (above), which was then stopped. cairn_gate's tab was dropped at 20:20 UTC rather than logged
  out; that was before the logout-first teardown existed. cairn_twin was logged out cleanly at
  20:35 UTC.

## Run-capable twin: gate timer and host reservation (rs/host)

Since 2026-10-21 both Ashburn machines are run-capable (main's policy; successor tenet pending the
operator). Before the scored run, both are gated in the same minute with the giver roster logged in,
and the run starts on one that passes. Rehearsal attempts pause on **both** machines from the start
of run day's gate series until the scored run's teardown; in that span only gate probes may log in
on the machine not chosen (tenet 17; main's ruling, 2026-10-21 19:00 PDT). Rehearsal logins and
helpers count against the same 100-per-IP ban line and 80 working cap as the run's roster.

- **Gate clone and account.** `~/gate/rs-sdk` is the gate's own clone, detached at the commit in
  `~/run-commit`. Its read account is a throwaway (credentials only in
  `~/gate/rs-sdk/bots/gate/bot.env`, mode 600), never a rehearsal or fleet account.
- **Timer.** `rs-gate-read.timer` / `rs-gate-read.service` (systemd user units; installed copy
  `~/.local/lib/rs-gate`, history `~/gate-history/<UTC>.json`). It is installed but DISABLED on the
  twin, and stays disabled until the run night.
  - Status: `systemctl --user is-enabled rs-gate-read.timer; systemctl --user list-timers
    rs-gate-read.timer --all --no-pager`.
  - Enable every 30 min (:00/:30): `bash ~/.local/lib/rs-gate/install.sh`. Every 15 min:
    `bash ~/.local/lib/rs-gate/install.sh --every 15`.
  - Disable: `systemctl --user disable --now rs-gate-read.timer`.
  - One read by hand, inside your own reservation: `systemctl --user set-environment
    RS_GATE_OWNER=<owner>; systemctl --user start rs-gate-read.service; systemctl --user
    unset-environment RS_GATE_OWNER`.

  Each read logs in once (direct path, no Chrome), takes about 90 s, logs out, and is killed by
  systemd at 270 s. It skips by itself if the host is busy (ffmpeg, bun, a live tmux server, or a
  Chrome with its own profile or open connections), so it never runs into an attempt.
- **Host reservation (sentinel).** File `/home/ubuntu/host-reserved.json`, one JSON object:
  `{"owner": "<rs/NNN or run>", "until": "<UTC ISO, e.g. 2026-10-22T03:00:00Z>", "reason": "<text>"}`.
  It is live while `until` is in the future; a file whose `until` has passed is ignored. While it
  is live, the gate timer skips, and rehearsal attempts and claims do not start (pre-flight).
  - Since 2026-10-22 02:28Z it is `rs-claim`'s lock ("Claims", above), which extends this object.
    Every holder writes it through `rs-claim take`: the scored run's step 0 (covering the gate
    and, on the chosen machine, the run), rs/host for installs and hand reads, and every
    rehearsal. The slot files are retired. `rehearse.ts` tells the claim it runs under from
    everyone else's with `--claim-owner` ("Claims", above).
  - Check: `cat ~/host-reserved.json 2>/dev/null || echo none`.

  `speedrun/rehearse.ts` enforces this (rs/213). While the sentinel is live and is not the claim
  named by `--claim-owner`, it refuses at pre-flight, before any login, and exits 5;
  `--force-gate` does not override it. In flight it re-reads the file at each step boundary and,
  if a reservation not its own has appeared (another owner, or host's preempt of its claim),
  logs out cleanly and stops. It checks only at boundaries, so a long band (for example willows 73-99, about 12 minutes)
  finishes first.
- **Run night, for an attempt in flight.** main announces the run night's window. Take no claim
  whose `MINUTES` would run into it; host preempts any claim still held when it opens. If an attempt is in flight when a
  live reservation appears:
  1. It logs out at its next step boundary, once the current step has finished.
  2. It records the stop as 'paused for the gate/run'.
  3. It does not restart until the reservation is gone.

  Choosing the machine does not lift the pause: both machines keep their reservation until the
  scored run's teardown, and rehearsals resume only after it.
- **Step 0 on the twin.** On run night, RUN-HOST.md step 0 runs on both machines: it writes
  `~/run-commit` and moves `~/rs-sdk` to RUN_COMMIT. On the twin that happens only under the run's
  reservation, when no attempt worktree is in use. If the twin is not chosen, `~/rs-sdk` is
  returned to main for attempts afterwards.

## Stop, start, terminate

On the Mac (`bglab`). A stop ends the desktop session, so after a start the operator connects over
RDP again (RUN-HOST.md step 2). The address stays the same, and so do the host keys.

```sh
aws --profile bglab --region us-east-1 ec2 stop-instances --instance-ids i-0f690e919614af7b2
aws --profile bglab --region us-east-1 ec2 start-instances --instance-ids i-0f690e919614af7b2
aws --profile bglab --region us-east-1 ec2 describe-instances --instance-ids i-0f690e919614af7b2 --query 'Reservations[0].Instances[0].State.Name' --output text
```

**Terminate only when main says so.** Pull any recording first. Then release the address, or it bills
$0.12 a day with nothing attached:

```sh
aws --profile bglab --region us-east-1 ec2 terminate-instances --instance-ids i-0f690e919614af7b2
aws --profile bglab --region us-east-1 ec2 wait instance-terminated --instance-ids i-0f690e919614af7b2
aws --profile bglab --region us-east-1 ec2 release-address --allocation-id "$(aws --profile bglab --region us-east-1 ec2 describe-addresses --public-ips "$RS_TWIN_HOST" --query 'Addresses[0].AllocationId' --output text)"
```

The security group `rs-ashburn-rehearsal-sg` and the key pair `rs-ashburn-rehearsal` cost nothing,
and the provision script reuses them. After a terminate, delete `known_hosts_rehearsal` on both
machines; the provision script pins fresh host keys for a new instance. The keys can stay.
