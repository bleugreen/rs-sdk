# Run host: the Ashburn machine, step by step

The scored run is played first person in our fork's browser webclient, in a visible Chrome tab on
a dedicated machine in Ashburn (cairn://p/rs/tenets/11). This page is that machine's runbook, in run
order: what to check, what to start, what to record, how to measure the gate, and how to stop.
[RUN-ORDER.md](RUN-ORDER.md) section 1 summarises it; the gate's conditions and the knife switching
rule live there. **SCORED** is the scored account; its real name never appears here, in a commit, a
log line or a chat message. Figures carry a label: **m** measured (with the time), **r** read from a
file, a config or main's notes, **i** inferred.

**The run's standing configuration** (main, 10:02 PDT 2026-10-21, on the measurements below):

- the recording is captured on the VM;
- **RDP is disconnected during the run**;
- the operator watches through a 3 fps MJPEG **live view** (step 5).

RDP is used only before the run: to create the desktop session at the right geometry and to check the
bring-up by eye. With RDP disconnected the tab runs exactly as fast as with it connected, and the
recording is smooth. A connected session costs the recording about a fifth of its frames.

## The host

| | | |
|---|---|---|
| Machine | AWS us-east-1c, c7i.2xlarge: 8 vCPU (Xeon Platinum 8488C), 16 GB, 60 GB gp3, **no GPU**, Ubuntu 24.04 | r: main on cairn://p/rs/103, 08:45 and 08:53 PDT 2026-10-21; CPU model m (`/proc/cpuinfo`) |
| Address | 54.242.152.95; SSH and RDP admit only the operator's address; tailnet name `rs-ashburn` (100.66.164.37) | r: main, same notes |
| Desktop | XFCE served by xrdp, user `ubuntu`; `max_bpp=24`; sesman `KillDisconnected=false`, `DisconnectedTimeLimit=0`, `IdleTimeLimit=0`, so a disconnected session lives on | m: read from `/etc/xrdp/xrdp.ini` and `sesman.ini`, 16:23 UTC |
| One desktop per user | a second session (another resolution, say) starts and dies at once, because `xfce4-session` cannot run twice for one user; the old session holds the only desktop. **Changing resolution means ending the session first** | r: main, 09:26 PDT |
| Screen | screensaver and locker removed, `xset` no-blank at login, logind `IdleAction=ignore` | r: main |
| Chrome | 156.0.8078.47 at `/usr/bin/google-chrome`, software rendered (its renderers run with `--disable-gpu-compositing`) | m |
| Tools | ffmpeg 6.1.1; Bun 1.4.3 at `~/.bun/bin/bun`, **not on PATH** for non-login ssh commands; tmux; sysstat (`pidstat`) | m |
| Checkout | `/home/ubuntu/rs-sdk`, a long-lived clone of our fork for the page server, the gateway and helper runners | r: main |
| Cairn | the executor `ashburn` on this machine is permanently drained: never target it | r: main, 08:58 PDT |

**Reaching it.** Every command below is pasted on the Mac (zsh or bash) and runs on the host over
this exact ssh line (or `speedrun/helpers/ashburn.sh` once rs/41 merges it). From Cairn, run it in a
batch on executor `local`, `bgsrv-mac` or `bgsrv-ub`.

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@54.242.152.95 'uptime'
```

**Names and ports.**

| What | Where |
|---|---|
| tmux socket for the tab's stack (page server, gateway, Chrome, recording) | `tmux -L run` |
| Page server (`server/webclient/proxy.ts`) | port 8899 (it binds every interface; the firewall keeps it local) |
| The tab's SDK gateway (`server/gateway/gateway.ts`) | `127.0.0.1:7780` |
| rs/117's helper gateway | `127.0.0.1:7795` by default (HELPERS.md, "Helpers on the run machine") |
| Chrome profile for the run tab | `/home/ubuntu/rs-run/chrome-profile` |
| Recordings | `/home/ubuntu/recordings/` |
| X display of the operator's session | `:10` when it is the first session since boot; read it in step 2 |

## 0. Prepare the checkout (once per run commit)

The page server needs the browser bundle, and the gateway its own dependencies; on 2026-10-21 only
the root `bun install` had been done (m). Put the clone on the commit main names for the run
(`RUN_COMMIT`), then build:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@54.242.152.95 'export PATH=$HOME/.bun/bin:$PATH; cd ~/rs-sdk && git fetch -q origin && git checkout -q --detach RUN_COMMIT && bun install && (cd server/webclient && bun install && bun run build) && (cd server/gateway && bun install) && mkdir -p ~/recordings ~/rs-run/chrome-profile && git log -1 --oneline && ls server/webclient/out/bot/client.js'
```

Account files: the gate account (step 6) is a throwaway demo account whose name starts with
`cairn_`, with `~/rs-sdk/bots/<gate>/bot.env` holding `BOT_USERNAME`, `PASSWORD`,
`SERVER=rs-sdk-demo.fly.dev`, `GATEWAY_URL=ws://127.0.0.1:7780` and `TELEMETRY=false` (a demo account
is created on its first login). SCORED's env file has the same shape and lives outside git on the
host; its path is set on run night and written here only as `$SCORED_ENV`. Never use a fleet or
helper account for the gate.

## 1. Preconditions: Fly edge iad, TCP connect p50 at most 5 ms

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@54.242.152.95 'curl -s -o /dev/null -D - https://rs-sdk-demo.fly.dev/ | grep -i "^fly-request-id"; for i in $(seq 20); do curl -s -o /dev/null -w "%{time_connect}\n" https://rs-sdk-demo.fly.dev/; done | sort -n | awk "{ms[NR]=\$1*1000} END {printf \"TCP connect ms over %d: p50 %.1f p90 %.1f max %.1f\n\", NR, ms[int(NR/2)+1], ms[int(NR*0.9)+1], ms[NR]}"'
```

Pass: the request id ends in `-iad`, and p50 is at most 5 ms. On 2026-10-21 at 16:26 UTC: `-iad`,
p50 1.9 ms, p90 2.6, max 2.7 over 20 (m). rs/96's gate CLI checks the same preconditions itself
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

After the operator connects, read which display the session is on and its geometry; it must be
1920x1080 at 24 planes. If it is not, the session predates the client settings: main ends it from
the host and the operator connects again (one desktop per user, above).

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@54.242.152.95 'sudo grep "Session started successfully" /var/log/xrdp-sesman.log | tail -1; ls /tmp/.X11-unix; DISPLAY=:10 xdpyinfo | grep -E "dimensions|depth of root"; ss -tn state established "( sport = :3389 )" | tail -n +2 | wc -l | sed "s/^/RDP connections: /"'
```

The commands below use `:10`. If the log names another display, replace `:10` everywhere.

**Connected or not.** xorgxrdp's X server keeps running and drawing when the client disconnects,
and Chrome's window stays mapped, so Chrome sees no change: the page's loop rate was the same
connected and disconnected, with or without the capture (m, "Measured" below). We did not read
`document.visibilityState` directly; an unchanged loop rate is the evidence that nothing throttled.
That is why the run can leave RDP disconnected, which tenet 11 had ruled out before this
measurement (its successor relaxes it).

## 3. Bring up the page server, the gateway and Chrome

Gateway and page server (the page server redirects a bare `/bot` to `?server=` the demo and
`?gateway=` the loopback gateway):

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@54.242.152.95 'B=$HOME/.bun/bin/bun; tmux -L run new-session -d -s gateway -c ~/rs-sdk/server/gateway "AGENT_PORT=7780 GATEWAY_HOSTNAME=127.0.0.1 $B run gateway.ts 2>&1 | tee -a $HOME/rs-run/gateway.log"; tmux -L run new-session -d -s page -c ~/rs-sdk/server/webclient "$B run proxy.ts --world=https://rs-sdk-demo.fly.dev --port=8899 --gateway=ws://127.0.0.1:7780 2>&1 | tee -a $HOME/rs-run/page.log"; sleep 4; ss -ltn | grep -E ":(7780|8899) "; curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "http://127.0.0.1:8899/bot?bot=x"'
```

Expect both ports listening and `302 http://127.0.0.1:8899/bot?bot=x&server=rs-sdk-demo.fly.dev&gateway=ws%3A%2F%2F127.0.0.1%3A7780`.

**Chrome.** The tab's URL is
`http://127.0.0.1:8899/bot?bot=<name>&password=<pw>&server=rs-sdk-demo.fly.dev&gateway=ws://127.0.0.1:7780`.
The page logs in as soon as it loads, so **opening the tab is the account's login**. The launch
builds the URL on the host from an env file, so the credentials never cross the ssh line:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@54.242.152.95 'ENV=$HOME/rs-sdk/bots/GATE_ACCOUNT/bot.env; . $ENV; URL="http://127.0.0.1:8899/bot?bot=$BOT_USERNAME&password=$PASSWORD&server=rs-sdk-demo.fly.dev&gateway=ws://127.0.0.1:7780"; tmux -L run new-session -d -s chrome "DISPLAY=:10 google-chrome --user-data-dir=$HOME/rs-run/chrome-profile --no-first-run --no-default-browser-check --password-store=basic --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --start-maximized --app=\"$URL\""'
```

(For SCORED in step 7, `ENV=$SCORED_ENV`.) Why each flag:

- the three `--disable-background...` flags are tenet 11's: no timer, renderer or occlusion
  throttling;
- `--user-data-dir` gives the run its own Chrome. If another Chrome is already running on the default
  profile, a plain `google-chrome` only opens a window in that process and **its flags are lost**;
  a separate profile always starts a fresh browser with these flags (i: Chrome's single-instance
  behaviour per profile);
- `--app=` opens a window with no address bar, so the URL with the password is never on screen or
  in the recording; `--start-maximized` fills the 1920x1080 session (the window measured
  1920x1029 below XFCE's top panel, m);
- `--password-store=basic` keeps a fresh profile from raising a keyring prompt over the tab;
  `--no-first-run --no-default-browser-check` keep the first-run dialogs away.

Check the flags and the window (expect the five flag names and a window 1920 wide). The operator,
still connected, sees the tab come up. Once this check passes, the operator **disconnects**.
Everything from step 4 on runs disconnected:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@54.242.152.95 'ps -o args= -C chrome | grep -v -- --type= | grep -o -E "disable-background-timer-throttling|disable-renderer-backgrounding|disable-backgrounding-occluded-windows|start-maximized|user-data-dir=[^ ]*"; DISPLAY=:10 xwininfo -root -tree | grep "Bot Client"; tail -2 $HOME/rs-run/gateway.log'
```

## 4. Helpers on the run machine (rs/117)

The tick-exact helpers (the Runecraft altar givers, the trade giver, the wine giver) run on this
machine through rs/117's launcher, `speedrun/helpers/standalone.ts`, from this same checkout, on their
own loopback gateway (7795 by default). How to configure, start and stop them is
[HELPERS.md](HELPERS.md), "Helpers on the run machine" (cairn://p/rs/117); this page doesn't repeat
it. The one ordering rule that touches this runbook: **the helpers are logged in before SCORED's tab
opens** (the launcher's `helpersReady`), because login order decides the 7- or 8-tick Runecraft
cycle.

## 5. Start the recording

The recording is captured on the VM itself, not over RDP: ffmpeg grabs the session's X display
(r: main, 09:13; rejected: recording at the Mac end over RDP). Start it **before SCORED's first
login**, which is before step 7, and before the gate so the gate is measured with the capture
running, as in the run:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@54.242.152.95 'mkdir -p ~/recordings; rm -f ~/recordings/ffmpeg-progress.log; F=$HOME/recordings/run-$(date -u +%Y%m%dT%H%M%SZ).mkv; tmux -L run new-session -d -s rec "ffmpeg -hide_banner -loglevel warning -f x11grab -draw_mouse 1 -framerate 30 -video_size 1920x1080 -i :10.0+0,0 -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -progress $HOME/recordings/ffmpeg-progress.log $F 2>&1 | tee -a $HOME/recordings/ffmpeg.log"; sleep 5; echo $F; grep -E "^(fps|drop_frames|speed)=" ~/recordings/ffmpeg-progress.log | tail -3; df -h / | tail -1'
```

The line is main's decision (x11grab, 1920x1080, 30 fps, libx264 `-preset veryfast -crf 20`) plus
three choices made here:

- **`.mkv`**: a Matroska file stays playable if ffmpeg or the machine dies mid-run, where an MP4 is
  unreadable without the index written at the end (i). Remux on the Mac if MP4 is wanted:
  `ffmpeg -i run.mkv -c copy run.mp4`.
- **`-pix_fmt yuv420p`**: from an RGB grab, x264 otherwise encodes 4:4:4, which QuickTime and most
  players and sites will not play (i).
- **`-progress`**: ffmpeg's frame, fps and drop counters, read by the gate sampler and by the checks
  below. No audio is recorded.

Size: 7.2 Mbit/s at 30 fps in game, about 3.3 GB an hour (m: 288 MB in 318 s, 16:41-16:47 UTC; i: per
hour), against 51 GB free (m, 16:15 UTC); the disk holds well over ten hours.

**Why RDP stays disconnected during the run.** With the operator connected, the capture kept real
time but wrote only about 23 distinct frames a second (2,389 of ~10,700 dropped over 6 minutes).
Disconnected, it wrote 29.9 a second with none dropped (m, "Measured"). The capture is not short of
CPU: it used under one core of eight in both cases. The likely cause is the live RDP session's
screen updates competing with the grab for the X server (i). The game is unaffected either way.
Check the recording during the run with:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@54.242.152.95 'grep -E "^(frame|fps|drop_frames|dup_frames|speed|out_time)=" ~/recordings/ffmpeg-progress.log | tail -6; ls -la ~/recordings; df -h / | tail -1'
```

**The operator's live view**, started with the recording and left running until teardown. It is a
3 fps, 960x540 MJPEG stream on the tailnet address, which the operator opens in a browser at
`http://100.66.164.37:8090/live.mjpg` (over Tailscale, like RDP). ffmpeg's `-listen 1` serves one
viewer and exits when that viewer leaves, so it runs in a loop; a reload reconnects:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@54.242.152.95 'tmux -L run new-session -d -s live "while true; do ffmpeg -hide_banner -loglevel warning -f x11grab -draw_mouse 1 -framerate 3 -video_size 1920x1080 -i :10.0+0,0 -vf scale=960:540 -c:v mjpeg -q:v 8 -f mpjpeg -listen 1 http://100.66.164.37:8090/live.mjpg; sleep 1; done"'
```

It costs 3.7% of one core (m: `pidstat` over 40 s, 16:53 UTC, ~150 kbit/s), and the recording
beside it still wrote 29.7 fps with no drops (m: 70 s, 16:54 UTC). It was tested with `curl` on the
host (217 frames in 72 s); nobody has opened it in the operator's browser yet. Teardown stops it with
the rest of the stack (or `tmux -L run kill-session -t live` on its own).

## 6. Quiesce check and the gate

**Quiesce.** Nothing runs on the machine but the session's desktop, the `run` tmux stack (gateway,
page server, Chrome, recording), rs/117's launcher with its lite runners and roles, and system
daemons. The `run` stack includes the live view (step 5). The drained Cairn executor's daemon (`cairn-exec`) was idle at 0.3% of a core (m, 16:15
UTC); whether it stays up during the run is main's call. No second Chrome, no other `bun`, no other
ffmpeg.

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@54.242.152.95 'uptime; ls /tmp/tmux-$(id -u)/; ps -eo pid,pcpu,etime,args --sort=-pcpu | cut -c1-160 | head -20; pgrep -c -f "chrome --type=gpu-process" | sed "s/^/Chrome GPU processes (expect 1): /"'
```

**The gate** is measured here, on this machine, right before the run, at the real player count, and
**on a gate account, never SCORED**: SCORED's playtime starts at its first login, which is step 7.
Measure it in the run's configuration: RDP disconnected, with the recording and the live view running.
The conditions and what to do on a failure are in RUN-ORDER.md section 1 and tenet 11.

- **(a)-(c)**, next-tick reactions, tick publication p90 and catch-ups: rs/96's direct-path CLI,
  `docs/speedrun/scripts/tickmanip-latency.ts <gate account> --path=direct --no-tele`
  (cairn://p/rs/96, PR #101; its procedure and verdict are in `skills/tick-manipulation.md`, "Run-time
  host gate"). It logs the gate account in itself, in-process, so run it **before** the gate account's
  tab opens, with the tab closed.
- **(d)**, the tab's loop rate: open the gate account's tab (step 3's Chrome command with the gate
  account's env file), let it reach the game, then sample for five minutes with
  `docs/speedrun/scripts/runhost-loops.ts`. It attaches to the tab through the loopback gateway, runs
  the in-page probe (the page publishes `loops` only while a program runs), and every 10 s prints the
  page's loop rate beside each process's CPU and ffmpeg's frame counters. Closing the tab afterwards
  drops the gate account's client; a throwaway account left in the world until the server's
  no-connection timeout costs nothing.

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@54.242.152.95 'cd ~/rs-sdk && ~/.bun/bin/bun docs/speedrun/scripts/runhost-loops.ts GATE_ACCOUNT --label=gate --minutes=5 --display=:10 --out=$HOME/rs-run/gate-loops.jsonl 2>&1 | grep -v -E "^\[(Runner|BotSDK)\]|Pathfinding|LOGOUT DEBUG"; tmux -L run kill-session -t chrome'
```

Read (d) from the summary line's `loops p10` (lowest / median / highest 10-second sample). **Pass**:
the lowest sample is at least 50 per second. **Marginal**: the median is at least 50 but a sample
fell below: re-measure. **Fail**: the median is below 50. On 2026-10-21 every sample in every
condition was 70-73 (m, below). During the run, the page keeps publishing `loops` while SCORED's
programs run, which is what the in-run monitor reads.

## 7. SCORED's tab: the run's first login

With the helpers in (step 4), the recording running (step 5) and the gate passed (step 6), launch
Chrome as in step 3 with `ENV=$SCORED_ENV`. The page logs SCORED in as it loads; from here the run
scripts drive it through the gateway on 7780 (RUN-ORDER.md, STEP-MANIFEST.md). Nobody touches the
window.

## 8. Stop the recording and pull it

After SCORED's final clean logout (the run script's `logoutClean`; check the tab shows the login
screen), stop ffmpeg with `q`, so it finishes the file, and check what it wrote:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@54.242.152.95 'tmux -L run send-keys -t rec q; sleep 5; tmux -L run has-session -t rec 2>/dev/null && echo "ffmpeg still running"; for f in ~/recordings/run-*.mkv; do ffprobe -v error -show_entries format=duration,size:stream=width,height,pix_fmt -of compact "$f"; done; grep -E "^(frame|drop_frames)=" ~/recordings/ffmpeg-progress.log | tail -2'
```

Pull it to the Mac (or with `ashburn.sh` once rs/41 merges it), and check the copy plays before
anything on the host is deleted:

```sh
mkdir -p ~/Movies/rs-run && scp -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no 'ubuntu@54.242.152.95:recordings/run-*.mkv' ~/Movies/rs-run/ && ls -la ~/Movies/rs-run/
```

## 9. Teardown

Stop rs/117's helpers as HELPERS.md says (clean logouts first). Then stop the tab's stack; the
recording must already be stopped (step 8), since killing tmux under ffmpeg cuts the file short:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_ashburn -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_ashburn -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@54.242.152.95 'tmux -L run has-session -t rec 2>/dev/null && { echo "recording still running: stop it first (step 8)"; exit 1; }; tmux -L run kill-server; sleep 2; ls /tmp/tmux-$(id -u)/; pgrep -a -f "proxy.ts|gateway.ts|rs-run/chrome-profile" || echo "tab stack stopped"'
```

The session itself stays: nobody logs out of XFCE. The recording stays on the host until its copy on
the Mac is checked.

## Measured: gate (d) on this host, 2026-10-21

**How it was taken.** On this host (c7i.2xlarge, 8 vCPU, no GPU), 16:28-16:52 UTC (09:28-09:52
PDT), with the demo at about 1,690-1,700 online (the page's footer, m). Chrome 156.0.8078.47 was
launched exactly as in step 3: its own profile, the three throttling flags, a maximised app window of
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
