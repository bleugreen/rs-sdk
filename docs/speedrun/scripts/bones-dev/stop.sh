#!/bin/bash
# Stop bones dev accounts cleanly. For each ACCOUNT (default: every account with a running loop):
# stop its role, log it out with the logout button while its lite client is still connected
# (waiting out combat, eating if hurt), and only then let its client loop exit. When no account
# is left, stop the gateway and the private tmux server. Only PIDs recorded under $R/run/ are
# signalled, after checking they are ours; nothing is killed by name or pattern.
# usage: stop.sh [ACCOUNT...]
# Partial cohort failure: retain each "clean logout verified; dev loops stopped" result
# and retry only the remaining accounts (never restart an already-confirmed account).
# Repeating a stopped account is deliberately rejected: historical log lines alone
# cannot prove its current session is gone. Adopt only after every account is confirmed.
R=${BONES_DEV:-$HOME/rs-dev/babyblue}; S=$R/docs/speedrun/scripts/bones-dev
T="tmux -L ${BONES_TMUX:-rs41-babyblue}"; cd "$R" || exit 1
# Never pass an empty, negative or process-group PID to kill.
pid() { [[ "$1" =~ ^[1-9][0-9]*$ ]]; }
mine() { pid "$1" && ps -o args= -p "$1" 2>/dev/null | grep -q -F -- "$2"; }
accts=("$@")
if [ ${#accts[@]} -eq 0 ]; then
  for f in run/*.roleloop.pid run/*.liteloop.pid; do [ -e "$f" ] && b=$(basename $f) && accts+=("${b%%.*}"); done
fi
accts=($(printf '%s\n' "${accts[@]}" | sort -u))
if [ ${#accts[@]} -eq 0 ]; then echo "no accounts to verify; logout unconfirmed" >&2; exit 1; fi
echo "On partial failure, retain each confirmation line and retry only remaining accounts; do not restart confirmed clients."
for a in "${accts[@]}"; do
  [[ "$a" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo "invalid account: $a" >&2; exit 1; }
  touch "run/stop-$a" || { echo "$a: cannot inhibit restart; refusing logout" >&2; exit 1; }
  rp=$(cat run/$a.role.pid 2>/dev/null)
  if [ -n "$rp" ] && mine "$rp" 'bones.ts'; then
    kill -INT $rp
    for i in $(seq 1 30); do kill -0 $rp 2>/dev/null || break; sleep 1; done
    if kill -0 $rp 2>/dev/null; then echo "$a: role still stopping; retry stop.sh after it exits" >&2; exit 1; fi
  fi
  np=$(cat run/$a.runner.pid 2>/dev/null)
  if ! mine "$np" 'runner.ts' || ! kill -0 "$np" 2>/dev/null; then
    echo "$a: no verified live runner (possibly reconnect backoff); logout unconfirmed, do not adopt" >&2
    exit 1
  fi
  # logout.ts snapshots this account's lite log before sending input. PID exit alone,
  # or a logged-out line from an earlier session, never authorizes fleet adoption.
  timeout 600 ~/.bun/bin/bun "$S/logout.ts" "$a" "$np" || { echo "$a: logout unconfirmed; preserving any live client, do not adopt" >&2; exit 1; }
  if kill -0 "$np" 2>/dev/null; then echo "$a: still connected; refusing to stop its client" >&2; exit 1; fi
  # The role loop may still be in its 15-second restart delay after the role exits.
  for i in $(seq 1 30); do
    [ ! -e "run/$a.liteloop.pid" ] && [ ! -e "run/$a.roleloop.pid" ] && break
    sleep 1
  done
  if [ -e "run/$a.liteloop.pid" ] || [ -e "run/$a.roleloop.pid" ]; then
    echo "$a: logout acknowledged but loops still stopping; do not adopt yet" >&2; exit 1
  fi
  echo "$a: clean logout verified; dev loops stopped"
done
left=0; for f in run/*.liteloop.pid run/*.roleloop.pid; do [ -e "$f" ] && left=1; done
if [ $left -eq 0 ]; then
  gp=$(cat run/gateway.pid 2>/dev/null)
  [ -n "$gp" ] && mine "$gp" 'gateway.ts' && kill -INT "$gp"
  rm -f run/gateway.pid
  $T kill-server 2>/dev/null
  echo "all bones dev accounts stopped; gateway and tmux server stopped"
fi
