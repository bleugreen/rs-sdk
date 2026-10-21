#!/bin/bash
# Development runs of the bones role on bbs, outside the fleet (docs/speedrun/helpers/bones.md).
# Starts the loopback gateway (if it is not up) and, for each ACCOUNT, its lite-client loop and
# role loop, all inside the private tmux server `tmux -L rs41-babyblue` (session bb). Logins are
# staggered by 20 s. Every PID is recorded under $R/run/ for stop.sh.
# usage: start.sh ACCOUNT [ACCOUNT...]
set -e
R=${BONES_DEV:-$HOME/rs-dev/babyblue}; PORT=${BONES_PORT:-7782}; S=$R/docs/speedrun/scripts/bones-dev
T="tmux -L ${BONES_TMUX:-rs41-babyblue}"
mkdir -p $R/logs $R/run
$T has-session -t bb 2>/dev/null || $T new-session -d -s bb -n shell
if ! ss -ltn | grep -q "127.0.0.1:$PORT "; then
  $T new-window -t bb -n gw "cd $R/server/gateway && AGENT_PORT=$PORT GATEWAY_HOSTNAME=127.0.0.1 exec ~/.bun/bin/bun gateway.ts >> $R/logs/gateway.log 2>&1"
  sleep 3
  $T list-panes -t bb:gw -F '#{pane_pid}' > $R/run/gateway.pid
fi
i=0
for a in "$@"; do
  rm -f $R/run/stop-$a $R/run/pause-$a
  $T new-window -t bb -n lite-${a#cairn_} "bash $S/lite-loop.sh $a $(( i * 20 ))"
  $T new-window -t bb -n role-${a#cairn_} "bash $S/role-loop.sh $a"
  i=$(( i + 1 ))
done
$T list-windows -t bb
