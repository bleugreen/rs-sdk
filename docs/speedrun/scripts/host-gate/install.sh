#!/usr/bin/env bash
# Installs the run-night gate read as a systemd user timer on the run host
# (docs/speedrun/research/demo-latency.md, section 10, "Gate history timer").
#
#   bash docs/speedrun/scripts/host-gate/install.sh [--every 30|15] [--repo PATH] [--no-enable]
#   bash ~/.local/lib/rs-gate/install.sh --every 15        (later, from the installed copy)
#
# Copies the wrapper (host-gate-read.sh), the units and these scripts to ~/.local/lib/rs-gate,
# so the timer never runs code from the checkout the wrapper moves to ~/run-commit.
# It also installs the claim lock, rs-claim (tenet 21), to ~/.local/bin/rs-claim, mode 755, but
# only when the installed copy differs from this one; it prints both sha256s either way.
# uninstall.sh leaves rs-claim in place: the lock outlives the timer.
# --every 30 (default) fires at :00 and :30; --every 15 at :00, :15, :30 and :45. Rerunning with
# the other value switches the cadence of an installed timer in place.
# --repo is the gate's own clone (default ~/gate/rs-sdk), holding bots/gate/bot.env.
# --no-enable installs without starting the schedule, so one read can be fired by hand first:
# systemctl --user start rs-gate-read.service
#
# Refuses to install when the user does not linger: without lingering the user manager, and with
# it the timer, stops when the last session logs out. Enabling linger is the host owner's call.
set -euo pipefail

every=30
repo="$HOME/gate/rs-sdk"
enable=1
while [ $# -gt 0 ]; do
    case "$1" in
        --every) every="${2:-}"; shift 2 ;;
        --every=*) every="${1#*=}"; shift ;;
        --repo) repo="${2:-}"; shift 2 ;;
        --repo=*) repo="${1#*=}"; shift ;;
        --no-enable) enable=0; shift ;;
        *) echo "install.sh: unknown argument $1" >&2; exit 64 ;;
    esac
done
case "$every" in
    30) calendar='*:00,30' ;;
    15) calendar='*:00,15,30,45' ;;
    *) echo "install.sh: --every must be 30 or 15, not '$every'" >&2; exit 64 ;;
esac
repo=$(cd "$repo" && pwd)
here=$(cd "$(dirname "$0")" && pwd)
lib="$HOME/.local/lib/rs-gate"

linger=$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || true)
if [ "$linger" != yes ]; then
    echo "install.sh: Linger is '${linger:-unknown}' for $(id -un); the timer would stop at logout. Not installing." >&2
    exit 1
fi
[ -d "$repo/.git" ] || { echo "install.sh: $repo is not a clone" >&2; exit 1; }
[ -f "$repo/bots/gate/bot.env" ] || echo "install.sh: warning: no $repo/bots/gate/bot.env; reads will fail until it exists" >&2
[ -f "$HOME/run-commit" ] || echo "install.sh: warning: no ~/run-commit; reads will skip until the runbook writes it" >&2

if [ "$here" != "$lib" ]; then
    wrapper="$here/../host-gate-read.sh"
    [ -f "$wrapper" ] || { echo "install.sh: no host-gate-read.sh next to $here" >&2; exit 1; }
    mkdir -p "$lib"
    cp "$wrapper" "$here/rs-gate-read.service" "$here/rs-gate-read.timer" "$here/install.sh" "$here/uninstall.sh" "$here/rs-claim" "$lib/"
fi

# The claim lock writes the ~/host-reserved.json every firing skips on. Replace the installed copy
# only when it differs from this one, so a rerun (a cadence switch) never touches a matching lock.
claim="$HOME/.local/bin/rs-claim"
want=$(sha256sum "$lib/rs-claim" | cut -d' ' -f1)
have=$(if [ -f "$claim" ]; then sha256sum "$claim" | cut -d' ' -f1; else echo none; fi)
if [ "$have" = "$want" ]; then
    [ -x "$claim" ] || chmod 755 "$claim"
    echo "rs-claim: installed $have, repo $want: the same, left as it is"
else
    mkdir -p "$HOME/.local/bin"
    install -m 755 "$lib/rs-claim" "$claim"
    echo "rs-claim: installed $have, repo $want: different, replaced (mode 755)"
fi

dest="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$dest"
sed "s|%h/gate/rs-sdk|$repo|g" "$lib/rs-gate-read.service" > "$dest/rs-gate-read.service"
sed "s|^OnCalendar=.*|OnCalendar=$calendar|" "$lib/rs-gate-read.timer" > "$dest/rs-gate-read.timer"
systemd-analyze --user verify "$dest/rs-gate-read.service" "$dest/rs-gate-read.timer"
systemctl --user daemon-reload

if [ "$enable" = 1 ]; then
    systemctl --user enable rs-gate-read.timer
    # restart, not start, so a cadence switch reschedules a timer that is already running;
    # starting a timer never fires the service by itself (OnCalendar only, Persistent=false)
    systemctl --user restart rs-gate-read.timer
fi
echo "installed: every $every min ($calendar), repo $repo, timer $(systemctl --user is-enabled rs-gate-read.timer 2>/dev/null || true)/$(systemctl --user is-active rs-gate-read.timer 2>/dev/null || true)"
systemctl --user list-timers rs-gate-read.timer --all --no-pager
