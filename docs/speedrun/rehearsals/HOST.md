# Rehearsal host: rs-ashburn-rehearsal

rs/147's fastest-99 rehearsals (cairn://p/rs/tenets/13) run from a twin of the scored run's host,
never from the run host itself. This page covers only what is particular to the twin: how to reach
it, how it differs from the run host, the slot convention behind the two-login cap, how it was built,
what it costs, its measured gate, and how to stop or remove it. **The procedure is
[RUN-HOST.md](../RUN-HOST.md)**: bring-up, recording, gate, teardown. Run its commands here with this
page's ssh line and the deltas below. Figures carry RUN-HOST.md's labels: **m** measured (with the
time), **r** read, **i** inferred.

## The host

| | |
|---|---|
| Instance | `i-0f690e919614af7b2`, tag `Name=rs-ashburn-rehearsal`, launched 2026-10-21 12:57 PDT by rs/149 |
| Address | **54.167.144.8**, an Elastic IP, so it survives a stop. SSH and RDP admit only the operator's address (security group `sg-0f1bb560e649e85c5`, a copy of the run host's ingress). Not on the tailnet |
| Machine | c7i.2xlarge in us-east-1c on the run host's subnet: 8 vCPU (Xeon Platinum 8488C), 15 GB, 60 GB gp3 (3000 IOPS, 125 MB/s), no GPU (m) |
| OS | the run host's AMI `ami-02a9cdd4e98bc3c78`, Ubuntu 24.04.5 (m) |
| Desktop | XFCE served by xrdp, user `ubuntu`, `max_bpp=24`, sesman `KillDisconnected=false`, `DisconnectedTimeLimit=0`, `IdleTimeLimit=0`; no screensaver or locker installed; `xset` no-blank autostart; logind `IdleAction=ignore` (m, read back by the setup script) |
| Tools | Google Chrome 156.0.8078.47, held at that version (`apt-mark hold`); Bun 1.4.3 at `~/.bun/bin/bun`, not on PATH for non-login ssh commands; ffmpeg 6.1.1; tmux 3.4; sysstat 12.6.1; Xvfb (m) |
| Checkout | `/home/ubuntu/rs-sdk`, a clone of bleugreen/rs-sdk, built as RUN-HOST.md step 0 |
| Keys | `~/.rs-fleet/id_ed25519_rehearsal` on `bgsrv-ub` and on the Mac (`local`). These are **two different keys with the same file name**, one generated on each machine, so no private key has moved. Both are in ubuntu's `authorized_keys` |
| known_hosts | `~/.rs-fleet/known_hosts_rehearsal` on both machines: the three host keys cloud-init printed to the EC2 console, pinned before the first connection |
| RDP password | `~/.rs-fleet/rehearsal-rdp-password` on the Mac, mode 600. Copy it with `pbcopy < ~/.rs-fleet/rehearsal-rdp-password`; never print it |

**Reaching it.** Paste on the Mac, or run from a Cairn batch on executor `bgsrv-ub` (host batches)
or `local`:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_rehearsal -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_rehearsal -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@54.167.144.8 'uptime'
```

To use a RUN-HOST.md command here, replace `id_ed25519_ashburn` with `id_ed25519_rehearsal`,
`known_hosts_ashburn` with `known_hosts_rehearsal`, and `54.242.152.95` with `54.167.144.8`. Never
run RUN-HOST.md's commands unchanged: they reach the run host.

## How it differs from RUN-HOST.md

- **Bounds.** A fastest-99 attempt runs for about 1 to 3 hours (i, from the skill docs' totals), not
  the run's 9 h or a run rehearsal's 30 min. In every launch that RUN-HOST.md bounds with `T=9h`
  (page server, gateway, the account's Chrome tab, recording, live view), use `T` = the
  attempt's bound, which is the expected wall time times 1.5 (rs/147's brief). For example, `T=3h`
  for a 2-hour estimate. The gate account's tab stays `T=15m`, the gate CLI `15m`, the sampler
  `10m`, and `tab-login.ts` `3m`.
- **No host reservation, no gate timer.** This host has no `~/host-reserved.json`, no
  `~/run-commit` and no rs/83 timer. The probe-slot minutes in RUN-HOST.md (:00-:03 and so on)
  protect measurements on the run host and don't apply here. The slot files below take the
  reservation's place.
- **RDP** goes to the public address 54.167.144.8:3389, not to a tailnet name. Client settings are
  RUN-HOST.md step 2's (1920x1080 fixed, Retina off, 24-bit). One desktop per user applies here too.
- **Live view.** There is no tailnet address to bind, so step 5's live view binds `127.0.0.1:8090`.
  The operator opens it through an ssh tunnel:
  `ssh -N -L 8090:127.0.0.1:8090 <this page's ssh options> ubuntu@54.167.144.8`, then
  `http://127.0.0.1:8090/live.mjpg`. In step 5's live-view command, replace
  `http://100.66.164.37:8090/live.mjpg` with `http://127.0.0.1:8090/live.mjpg`.
- **Step 0** is the setup script with the commit as its argument ("Setup", below). It moves the
  clone and rebuilds.
- **Accounts** are fresh rehearsal accounts that main names, plus the gate throwaway. Never a fleet,
  helper or SCORED account. Each account's `~/rs-sdk/bots/<name>/bot.env` is mode 600 and holds
  RUN-HOST.md step 0's keys. The tab logs in with `speedrun/tools/tab-login.ts` (rs/138, #120, on
  main). No query-string login has been used on this host.
- **Xvfb.** When no RDP session exists yet, an agent may check things on an Xvfb display
  (`Xvfb :99 -screen 0 1920x1080x24`, bounded like any launch). Label any figure taken there
  **Xvfb**; the attempt itself runs on the xrdp display.

A new account's env file is written on the host with a fresh random password that is never printed
(`N` is the name main assigned):

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_rehearsal -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_rehearsal -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@54.167.144.8 'N=NAME; D=$HOME/rs-sdk/bots/$N; [ -e $D/bot.env ] && { echo "$D/bot.env exists, stop"; exit 1; }; umask 077; mkdir -p $D && { echo BOT_USERNAME=$N; echo PASSWORD=$(openssl rand -hex 8); echo SERVER=rs-sdk-demo.fly.dev; echo GATEWAY_URL=ws://127.0.0.1:7780; echo "CLIENT_URL=http://127.0.0.1:8899/bot?server=rs-sdk-demo.fly.dev&gateway=ws://127.0.0.1:7780"; echo CDP_URL=http://127.0.0.1:9222; echo TELEMETRY=false; } >$D/bot.env && chmod 600 $D/bot.env && ls -l $D/bot.env'
```

## Slots: at most two rehearsal logins at once

rs/147 allows at most two rehearsal accounts logged in at once, and its coordinator grants each
slot (cairn://p/rs/147/1/coordinator/messages). The holder writes `~/rehearsal-slots/<owner>.json`
(`{"owner", "until", "reason"}`, `until` in UTC) **before its first login** and removes it after its
last clean logout. The take command refuses while two unexpired slots belong to other owners. It
holds a lock while it counts, so two children can't both take the last slot. An expired slot
counts for nothing, so a forgotten one blocks nobody once its time is up. `O` is the owner
(`rs-NNN`, the issue number with a hyphen), `M` is the bound in whole minutes (the attempt's `T`
plus margin), and `R` is the reason. Re-running it with the same `O` renews that slot.

Take a slot:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_rehearsal -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_rehearsal -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@54.167.144.8 'O=rs-NNN; M=MINUTES; R="woodcutting attempt"; case "$O" in rs-[0-9]*) ;; *) echo "set O to rs-NNN"; exit 1;; esac; case "$M" in ""|*[!0-9]*) echo "set M to whole minutes"; exit 1;; esac; D=$HOME/rehearsal-slots; mkdir -p $D; exec 9>$D/.lock; flock -w 10 9 || { echo "slot lock busy"; exit 1; }; n=0; for f in $D/*.json; do [ -f "$f" ] && [ "$f" != "$D/$O.json" ] || continue; U=$(sed -n "s/.*\"until\": *\"\([^\"]*\)\".*/\1/p" "$f"); [ -n "$U" ] && [ $(date -d "$U" +%s) -gt $(date +%s) ] && n=$((n+1)); done; if [ $n -ge 2 ]; then echo "two slots held, stop:"; cat $D/*.json; exit 1; fi; printf "{\"owner\":\"%s\",\"until\":\"%s\",\"reason\":\"%s\"}\n" "$O" "$(date -u -d "now + $M minutes" +%Y-%m-%dT%H:%M:%SZ)" "$R" >$D/$O.json.tmp && mv $D/$O.json.tmp $D/$O.json && cat $D/*.json'
```

Release it (only your own), after the last clean logout and teardown:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_rehearsal -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_rehearsal -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@54.167.144.8 'O=rs-NNN; D=$HOME/rehearsal-slots; rm -f $D/$O.json; cat $D/*.json 2>/dev/null || echo "no slots held"'
```

**Leftover check**, before any launch and after any teardown or bound. It is RUN-HOST.md's check with
Xvfb added and the slot files in place of the reservation. After teardown, expect no tmux server, no
process and none of your slots:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_rehearsal -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_rehearsal -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@54.167.144.8 'for s in /tmp/tmux-$(id -u)/*; do [ -S "$s" ] && echo "tmux -L $(basename $s): $(tmux -S $s ls 2>&1 | tr "\n" " ")"; done; ps -o pid,etime,comm -p "$(pgrep -d, "^(chrome.*|ffmpeg|bun|timeout|Xvfb)$")" 2>/dev/null || echo "no chrome, ffmpeg, bun, timeout or Xvfb process"; cat ~/rehearsal-slots/*.json 2>/dev/null || echo "no slots held"'
```

## Setup

Two committed scripts rebuild the twin; nothing depends on remembering steps.

- [`rehearsal-host-provision.sh`](../scripts/rehearsal-host-provision.sh) runs on the Mac with the
  `bglab` profile. It reads the run host by describe calls only and copies its AMI, type, subnet,
  root volume and ingress. It imports the Mac's key and passes other machines' public keys to
  cloud-init. It launches the instance, attaches the Elastic IP, pins `known_hosts` from the
  console, and sets the RDP password from stdin. It refuses while a twin exists, and ends with
  `INSTANCE_ID=... PUBLIC_IP=...`. Run it as
  `bash docs/speedrun/scripts/rehearsal-host-provision.sh "$(ssh bgsrv-ub cat .rs-fleet/id_ed25519_rehearsal.pub)"`,
  or paste bgsrv-ub's public key as the argument. Then copy `known_hosts_rehearsal` to bgsrv-ub.
  It contains public keys only.
- [`rehearsal-host-setup.sh`](../scripts/rehearsal-host-setup.sh) runs on the host. It installs and
  configures XFCE and xrdp, removes the screensavers, sets no-blank, and installs Chrome 156 (held),
  Bun 1.4.3, ffmpeg, tmux and sysstat. It clones the fork, builds it as step 0 at the given commit,
  and prints what it set. It is idempotent and starts nothing long-lived:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.rs-fleet/id_ed25519_rehearsal -o UserKnownHostsFile=$HOME/.rs-fleet/known_hosts_rehearsal -o StrictHostKeyChecking=yes -o CheckHostIP=no ubuntu@54.167.144.8 'bash -s -- origin/main' < docs/speedrun/scripts/rehearsal-host-setup.sh
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

## Gate on this host

MEASUREMENTS

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
aws --profile bglab --region us-east-1 ec2 release-address --allocation-id "$(aws --profile bglab --region us-east-1 ec2 describe-addresses --public-ips 54.167.144.8 --query 'Addresses[0].AllocationId' --output text)"
```

The security group `rs-ashburn-rehearsal-sg` and the key pair `rs-ashburn-rehearsal` cost nothing,
and the provision script reuses them. After a terminate, delete `known_hosts_rehearsal` on both
machines. The keys can stay.
