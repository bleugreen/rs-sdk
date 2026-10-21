#!/usr/bin/env bash
# rs/130: run one session.sh as a systemd user unit. RuntimeMaxSec is the hard stop: systemd kills the
# unit's whole cgroup (gateway, page server, Chrome, which Puppeteer detaches from the process group),
# whether or not the agent that launched it is still alive. Usage: launch.sh overlay|in-page
set -u
V=${1:?variant}
systemctl --user reset-failed rs130-session 2>/dev/null
systemctl --user is-active -q rs130-session && { echo 'rs130-session already running'; exit 3; }
systemd-run --user --unit=rs130-session -p RuntimeMaxSec=595 -p TimeoutStopSec=10 -p KillMode=control-group -p ExecStopPost="/bin/rm -f /home/ubuntu/host-reserved.json" \
  bash -c "$HOME/rs130/session.sh $V > $HOME/rs130/last.log 2>&1"
sleep 4; head -40 $HOME/rs130/last.log
