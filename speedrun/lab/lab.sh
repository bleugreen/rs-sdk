#!/usr/bin/env bash
# One-batch speedrun lab: starts engine, gateway and lite runners on the
# speedrun port block (9300-9302, node 44000, gateway 8300), runs the given
# scripts in order, then stops everything.
#
#   [NODE_TICKRATE=300] [LAB_HELPERS="srlab2"] [LAB_RUNNERS=0] \
#     [WEB_PORT=9300 WEB_MANAGEMENT_PORT=9301 HISCORES_WEB_PORT=9302 NODE_PORT=44000 AGENT_PORT=8300] \
#     speedrun/lab/lab.sh <bot> <script.ts>[:arg:arg] ...
#
# Each script runs as `bun <script> <bot> <args...>`; arguments follow the
# script path separated by ':', e.g. "speedrun/lab/measure-bank.ts:--n=3".
# LAB_HELPERS names extra bots that get their own lite runner (trade giver).
# LAB_RUNNERS=0 starts no lite runner for <bot>, for scripts that launch and
# kill the client themselves; LAB_BOTS names extra bots that only get a
# bot.env pointed at the lab (measure-session.ts). The engine runs with
# LOCAL_STAFF_LEVEL=4 so ::tele / ::give / ::setstat work. The first boot packs
# the content and can take several minutes.
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
BOT=$1; shift
LOG=${LAB_LOG:-${TMPDIR:-/tmp}/speedrun-lab}
mkdir -p "$LOG"
export NODE_TICKRATE=${NODE_TICKRATE:-300}
export PROFANITY_FILTER=false NODE_PROFANITY_FILTER=false

# Overridable so several labs can run side by side (each needs its own block).
export WEB_PORT=${WEB_PORT:-9300} WEB_MANAGEMENT_PORT=${WEB_MANAGEMENT_PORT:-9301} HISCORES_WEB_PORT=${HISCORES_WEB_PORT:-9302} NODE_PORT=${NODE_PORT:-44000} AGENT_PORT=${AGENT_PORT:-8300}
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; sleep 1; for p in "${PIDS[@]}"; do kill -9 "$p" 2>/dev/null; done; }
trap cleanup EXIT

wait_for() { # file phrase seconds
    for _ in $(seq 1 "$3"); do grep -q "$2" "$1" 2>/dev/null && return 0; sleep 1; done
    echo "timeout waiting for '$2' in $1"; tail -20 "$1"; return 1
}

(cd "$ROOT/server/engine" && BUILD_VERIFY=false BUILD_LIVE_RELOAD=false LOCAL_STAFF_LEVEL=4 exec bun run src/app.ts) > "$LOG/engine.log" 2>&1 &
PIDS+=($!)
wait_for "$LOG/engine.log" 'World ready' 900 || exit 1

(cd "$ROOT/server/gateway" && exec bun run gateway.ts) > "$LOG/gateway.log" 2>&1 &
PIDS+=($!)
sleep 2

RUNNERS="${LAB_HELPERS:-}"
[ "${LAB_RUNNERS:-1}" != "0" ] && RUNNERS="$BOT $RUNNERS"
for b in "$BOT" ${LAB_HELPERS:-} ${LAB_BOTS:-}; do
    if [ ! -f "$ROOT/bots/$b/bot.env" ]; then
        (cd "$ROOT" && bun bots/create-bot.ts "$b" --local --no-chat > /dev/null)
    fi
    sed -i.bak -e "s#^SERVER=.*#SERVER=localhost:$WEB_PORT#" -e "s#^GATEWAY_URL=.*#GATEWAY_URL=ws://localhost:$AGENT_PORT#" -e 's#^TELEMETRY=.*#TELEMETRY=false#' "$ROOT/bots/$b/bot.env"
    grep -q '^GATEWAY_URL=' "$ROOT/bots/$b/bot.env" || echo "GATEWAY_URL=ws://localhost:$AGENT_PORT" >> "$ROOT/bots/$b/bot.env"
done
for b in $RUNNERS; do
    (cd "$ROOT/server/webclient" && exec bun src/lite/runner.ts "$b") > "$LOG/runner-$b.log" 2>&1 &
    PIDS+=($!)
done
for b in $RUNNERS; do
    wait_for "$LOG/runner-$b.log" 'logged into' 120 || exit 1
done
sleep 3

STATUS=0
for spec in "$@"; do
    IFS=':' read -r -a parts <<< "$spec"
    echo "=== ${parts[*]} ==="
    (cd "$ROOT" && bun "${parts[0]}" "$BOT" "${parts[@]:1}") || STATUS=$?
done
exit $STATUS
