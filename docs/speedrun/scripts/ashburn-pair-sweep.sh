#!/usr/bin/env bash
# Same-second --react-delay sweep on the run host and the twin (demo-latency.md section 3): the
# margin after a frame read from both Ashburn machines in the same minute, so a difference between
# them is the machine's own upstream path and not the demo's minute.
#
#   bash ashburn-pair-sweep.sh prep            ship the probe's files into ~/rs83 on both, deps, credentials
#   bash ashburn-pair-sweep.sh start [DELAYS]  both probes start on the same wall-clock second, detached
#   bash ashburn-pair-sweep.sh status          bun processes and the last lines of both logs
#
# Runs from the operator's Mac (Cairn executor `local`) inside a checkout: it holds the keys and the
# address files in ~/.rs-fleet, read there and never printed. Each machine logs in ONE throwaway per
# start (RS83_RH_BOT / RS83_TW_BOT, default cairn_r83rh / cairn_r83tw, minted at prep and auto-registered
# on first login; prep mints a new password only when bots/NAME/bot.env is missing, so once a window's
# bot.env files have been removed, the next window needs new names). It
# touches nothing but ~/rs83: not ~/rs-sdk, its worktrees, the gate timers or their account. Ask host
# for the window first, and send host the login count after.
#
# Why it is shaped this way (24 Oct): neither machine can clone from GitHub outside the run checkout,
# so prep ships `git archive` of only the files the probe imports; bun lives in ~/.bun/bin, which a
# non-interactive ssh does not put on PATH; an attached remote background job holds the ssh session
# open and blocks the second launch, so start uses `setsid -f` and backgrounds both ssh calls; and
# `pgrep -f demo-latency-probe` matches its own ssh command line, so status counts `ps -C bun`.
set -euo pipefail

F="$HOME/.rs-fleet"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=yes)
rh() { ssh "${SSH_OPTS[@]}" -i "$F/id_ed25519_ashburn" -o UserKnownHostsFile="$F/known_hosts_ashburn" "${RS_RUN_USER:-ubuntu}@$(cat "$F/ashburn-ip")" "$@"; }
tw() { ssh "${SSH_OPTS[@]}" -i "$F/id_ed25519_rehearsal" -o UserKnownHostsFile="$F/known_hosts_rehearsal" "${RS_TWIN_USER:-ubuntu}@$(cat "$F/twin-ip")" "$@"; }
scrub() { sed -E 's/[0-9]{1,3}(\.[0-9]{1,3}){3}/<addr>/g'; }

[ -f "$F/id_ed25519_ashburn" ] && [ -f "$F/id_ed25519_rehearsal" ] || { echo "no fleet keys on $(uname -n); run from executor local" >&2; exit 2; }

REV="${RS83_REV:-$(git rev-parse --verify -q origin/main || git rev-parse main)}"
RH_BOT="${RS83_RH_BOT:-cairn_r83rh}"; TW_BOT="${RS83_TW_BOT:-cairn_r83tw}"
PATHS=(docs/speedrun/scripts/demo-latency-probe.ts speedrun/lib server/webclient package.json bun.lock tsconfig.json)

# stdin = the tar; $1 = bot name.
prep_remote='set -e; export PATH=$HOME/.bun/bin:$PATH; bot=$1
echo "host $(uname -n) $(date -u +%TZ)"
mkdir -p ~/rs83 && cd ~/rs83 && tar -xf -
(cd server/webclient && bun install --frozen-lockfile >/tmp/rs83-bun.log 2>&1) && echo "deps ok, bun $(bun --version)" || { echo "deps FAILED"; tail -5 /tmp/rs83-bun.log; }
mkdir -p "bots/$bot" out
[ -f "bots/$bot/bot.env" ] || printf "BOT_USERNAME=%s\nPASSWORD=%s\n" "$bot" "$(openssl rand -hex 8)" > "bots/$bot/bot.env"
chmod 600 "bots/$bot/bot.env"; echo "credentials $bot ok"
(chronyc tracking 2>/dev/null | grep "System time") || true'

# $1 label, $2 bot, $3 start epoch, $4 delays.
start_cmd() {
    echo "export PATH=\$HOME/.bun/bin:\$PATH; cd ~/rs83 && setsid -f nohup bash -c 'sleep \$(( $3 - \$(date +%s) )); SPEEDRUN_TICK_MS=400 timeout 900 bun docs/speedrun/scripts/demo-latency-probe.ts --label=$1 --bot=$2 --phases=react --trials=10 --react-delay=$4 --out=out/sweep-$1.json' > out/sweep-$1.log 2>&1 < /dev/null; echo \"\$(uname -n) armed $1\""
}

case "${1:-}" in
  prep)
    tar=$(mktemp); git archive --format=tar "$REV" "${PATHS[@]}" > "$tar"; echo "rev $REV"
    rh bash -c "'$(printf %s "$prep_remote" | sed "s/'/'\\\\''/g")'" _ "$RH_BOT" < "$tar" 2>&1 | scrub &
    tw bash -c "'$(printf %s "$prep_remote" | sed "s/'/'\\\\''/g")'" _ "$TW_BOT" < "$tar" 2>&1 | scrub &
    wait; rm -f "$tar" ;;
  start)
    delays="${2:-0,50,100,150,200,250,300,300,250,200,150,100,50,0}"; label="${RS83_LABEL:-pair}"
    for x in rh tw; do [ "$($x -n 'ps -C bun -o args= | grep -c rs83' || true)" = 0 ] || { echo "$x busy"; exit 1; }; done
    at=$(( ($(date +%s) / 60 + 1) * 60 )); [ $(( at - $(date +%s) )) -lt 25 ] && at=$(( at + 60 ))
    rh -n "$(start_cmd "rh-$label" "$RH_BOT" "$at" "$delays")" & tw -n "$(start_cmd "tw-$label" "$TW_BOT" "$at" "$delays")" &
    sleep 12; kill %1 %2 2>/dev/null || true
    echo "both start at $(date -u -r "$at" +%TZ); about 4.5 min for the default delays" ;;
  status)
    for x in rh tw; do $x -n 'echo "== $(uname -n): bun $(ps -C bun -o args= | grep -c rs83)"; for f in ~/rs83/out/*.log; do echo "-- $f"; tail -n 3 "$f"; done' | scrub; done ;;
  *) sed -n '2,20p' "$0"; exit 2 ;;
esac
