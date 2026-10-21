#!/usr/bin/env bash
# Run one session.sh as a systemd user unit (rs/130, then rs/176). RuntimeMaxSec is the hard stop:
# systemd kills the unit's whole cgroup (gateway, page server, Chrome, which Puppeteer detaches from
# the process group), whether or not the agent that launched it is still alive. The unit starts only
# in the first 3 minutes of a :15 or :45 UTC slot (host clock), so with the 595 s stop it ends before
# :25 or :55, well clear of the gate timer's :00 and :30 reads.
# Usage: [OWNER=rs/N] launch.sh overlay|in-page|in-page-oak
set -u
V=${1:?variant}
OWNER=${OWNER:-rs/130}
m=$(date -u +%M); m=$((10#$m))
case $m in 15|16|17|45|46|47) ;; *) echo "host UTC $(date -u +%T): not in the first 3 minutes of a :15 or :45 slot, not starting"; exit 3 ;; esac
systemctl --user reset-failed rs130-session 2>/dev/null
systemctl --user is-active -q rs130-session && { echo 'rs130-session already running'; exit 3; }
systemd-run --user --unit=rs130-session -p RuntimeMaxSec=595 -p TimeoutStopSec=10 -p KillMode=control-group -p ExecStopPost="/bin/rm -f /home/ubuntu/host-reserved.json" \
  --setenv=OWNER="$OWNER" bash -c "$HOME/rs130/session.sh $V > $HOME/rs130/last.log 2>&1"
sleep 4; head -40 $HOME/rs130/last.log
