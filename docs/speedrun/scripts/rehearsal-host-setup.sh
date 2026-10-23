#!/usr/bin/env bash
# Bring a fresh Ubuntu 24.04 VM to the run host's setup (docs/speedrun/RUN-HOST.md, "The host"):
# XFCE served by xrdp, no screensaver or blanking, Google Chrome, Bun, ffmpeg, tmux, sysstat, and
# the fork's clone at ~/rs-sdk built as in RUN-HOST.md step 0. Written for rs-ashburn-rehearsal
# (docs/speedrun/rehearsals/HOST.md, cairn://p/rs/149); provisioning is rehearsal-host-provision.sh.
#
#   ssh <HOST.md's ssh line> 'bash -s -- [COMMIT]' < docs/speedrun/scripts/rehearsal-host-setup.sh
#
# Runs as ubuntu (passwordless sudo, the EC2 default). Idempotent: re-run it to repair the host or
# to move the clone to another COMMIT (default origin/main). It starts nothing long-lived, never
# touches a running desktop session, and does not set the RDP password (the provision script does).
set -euo pipefail

COMMIT=${1:-origin/main}
BUN_VERSION=1.4.3
CHROME_MAJOR=156              # the run host's Chrome, 156.0.8078.47
CHROME_EXACT=156.0.8078.47
REPO=https://github.com/bleugreen/rs-sdk
export DEBIAN_FRONTEND=noninteractive
APT=(sudo -E apt-get -y -q -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)
say() { echo "setup: $*"; }

[ "$(id -un)" = ubuntu ] || { echo "run as ubuntu" >&2; exit 1; }
sudo hostnamectl set-hostname rs-ashburn-rehearsal

# --- Packages ---------------------------------------------------------------------------------------
sudo apt-get update -q
"${APT[@]}" install --no-install-recommends \
    xfce4 xfce4-terminal dbus-x11 xrdp xorgxrdp \
    ffmpeg tmux sysstat git curl unzip ca-certificates gnupg jq \
    xvfb x11-utils x11-xserver-utils fonts-liberation
# Screensavers and lockers out, so nothing ever blanks or locks the session the tab lives in.
"${APT[@]}" purge xfce4-screensaver light-locker xscreensaver gnome-screensaver 2>/dev/null || true

# --- xrdp: 24 bpp, a disconnected session lives on --------------------------------------------
sudo sed -i -E 's/^#?max_bpp=.*/max_bpp=24/' /etc/xrdp/xrdp.ini
sudo sed -i -E 's/^#?KillDisconnected=.*/KillDisconnected=false/; s/^#?DisconnectedTimeLimit=.*/DisconnectedTimeLimit=0/; s/^#?IdleTimeLimit=.*/IdleTimeLimit=0/' /etc/xrdp/sesman.ini
sudo adduser -q xrdp ssl-cert
echo xfce4-session >"$HOME/.xsession"
sudo systemctl enable -q xrdp xrdp-sesman
# Restarting xrdp would not end an existing desktop (sesman keeps it), but only restart when
# nobody is connected, so a re-run never drops the operator.
if [ "$(ss -Htn state established '( sport = :3389 )' | wc -l)" = 0 ]; then sudo systemctl restart xrdp; fi

# --- No blanking: xset at session start, logind never idles ----------------------------------------
mkdir -p "$HOME/.config/autostart"
cat >"$HOME/.config/autostart/rs-noblank.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=rs no-blank
Exec=sh -c "xset s off; xset s noblank; xset -dpms"
X-GNOME-Autostart-enabled=true
EOF
sudo mkdir -p /etc/systemd/logind.conf.d
printf '[Login]\nIdleAction=ignore\n' | sudo tee /etc/systemd/logind.conf.d/rs-idle.conf >/dev/null
sudo systemctl kill -s HUP systemd-logind || true

# --- Google Chrome stable, the run host's major, held there ---------------------------------------
if [ ! -f /usr/share/keyrings/google-chrome.gpg ]; then
    curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor --yes -o /usr/share/keyrings/google-chrome.gpg
fi
echo 'deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main' |
    sudo tee /etc/apt/sources.list.d/google-chrome.list >/dev/null
sudo apt-get update -q
have=$(dpkg-query -W -f='${Version}' google-chrome-stable 2>/dev/null || true)
if [ "${have%%.*}" != "$CHROME_MAJOR" ]; then
    V=$(apt-cache madison google-chrome-stable | awk -v m="$CHROME_MAJOR." 'index($3, m) == 1 {print $3; exit}')
    if [ -n "$V" ]; then
        "${APT[@]}" install --allow-downgrades "google-chrome-stable=$V"
    else
        # Google's apt index keeps only the newest stable; its pool often still has older builds.
        D=$(mktemp -d)
        if curl -fsSL -o "$D/chrome.deb" "https://dl.google.com/linux/chrome/deb/pool/main/g/google-chrome-stable/google-chrome-stable_${CHROME_EXACT}-1_amd64.deb"; then
            "${APT[@]}" install --allow-downgrades "$D/chrome.deb"
        else
            say "Chrome $CHROME_MAJOR is not obtainable; installing the current stable (a delta from the run host)"
            "${APT[@]}" install google-chrome-stable
        fi
        rm -rf "$D"
    fi
fi
sudo apt-mark hold google-chrome-stable >/dev/null

# --- Bun, at ~/.bun/bin/bun (not on PATH for non-login ssh commands, as on the run host) -----------
if [ "$("$HOME/.bun/bin/bun" --version 2>/dev/null || true)" != "$BUN_VERSION" ]; then
    curl -fsSL https://bun.sh/install | bash -s "bun-v$BUN_VERSION" >/dev/null
fi

# --- The clone, built as RUN-HOST.md step 0 -------------------------------------------------------
[ -d "$HOME/rs-sdk/.git" ] || git clone -q "$REPO" "$HOME/rs-sdk"
export PATH=$HOME/.bun/bin:$PATH
cd "$HOME/rs-sdk"
git fetch -q origin
# -f: the host clone is never edited by hand, and a stopgap copy of a not-yet-merged file
# (untracked) must not block moving to a commit that tracks it.
git checkout -q -f --detach "$COMMIT"
bun install >/dev/null
(cd server/webclient && bun install >/dev/null && bun run build >/dev/null)
(cd server/gateway && bun install >/dev/null)
# Gate (d)'s sampler is on main from 7c3e8c706; for an older COMMIT take rs/103's copy (untracked,
# so a later checkout keeps it).
if [ ! -f docs/speedrun/scripts/runhost-loops.ts ]; then
    git fetch -q origin agent/rs-103-coordinator-0 &&
        git show FETCH_HEAD:docs/speedrun/scripts/runhost-loops.ts >docs/speedrun/scripts/runhost-loops.ts
fi
mkdir -p "$HOME/recordings" "$HOME/rs-run/chrome-profile" "$HOME/rehearsal-slots" "$HOME/rs-sdk/bots"
chmod 700 "$HOME/rs-sdk/bots"

# --- Report -------------------------------------------------------------------------------------------
say "$(. /etc/os-release; echo "$PRETTY_NAME"), $(nproc) vCPU, $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | xargs), $(free -g | awk '/Mem:/ {print $2}') GB, root $(df -h / | awk 'NR==2 {print $2" size, "$4" free"}')"
say "$(google-chrome --version); bun $(bun --version); $(ffmpeg -version | head -1 | cut -d' ' -f1-3); $(tmux -V); $(pidstat -V 2>&1 | head -1)"
say "xrdp: $(grep -E '^max_bpp=' /etc/xrdp/xrdp.ini) $(grep -E '^(KillDisconnected|DisconnectedTimeLimit|IdleTimeLimit)=' /etc/xrdp/sesman.ini | tr '\n' ' ')"
say "screensavers installed: $(dpkg -l xfce4-screensaver light-locker xscreensaver 2>/dev/null | grep -c '^ii'); logind: $(cat /etc/systemd/logind.conf.d/rs-idle.conf | tr '\n' ' ')"
say "clone: $(git log -1 --oneline | cut -c1-80); bundle $(ls server/webclient/out/bot/client.js)"
