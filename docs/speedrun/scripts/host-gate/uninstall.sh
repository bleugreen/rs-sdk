#!/usr/bin/env bash
# Stops and removes the run-night gate read timer installed by install.sh.
#
#   bash ~/.local/lib/rs-gate/uninstall.sh
#
# A read in progress is stopped with it (its whole control group is killed, which closes the
# demo session). Removes the units and ~/.local/lib/rs-gate; keeps ~/gate-history and the
# gate's clone with its bots/gate/bot.env.
# To pause the schedule for a while instead, write ~/host-reserved.json (section 10).
set -uo pipefail

dest="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
systemctl --user disable --now rs-gate-read.timer 2>/dev/null
systemctl --user stop rs-gate-read.service 2>/dev/null
rm -f "$dest/rs-gate-read.service" "$dest/rs-gate-read.timer"
systemctl --user daemon-reload
systemctl --user reset-failed rs-gate-read.service rs-gate-read.timer 2>/dev/null
if systemctl --user cat rs-gate-read.timer >/dev/null 2>&1; then
    echo "uninstall.sh: rs-gate-read.timer is still known to systemd" >&2
    exit 1
fi
rm -rf "$HOME/.local/lib/rs-gate"
echo "removed rs-gate-read.timer, rs-gate-read.service and ~/.local/lib/rs-gate; ~/gate-history is kept"
