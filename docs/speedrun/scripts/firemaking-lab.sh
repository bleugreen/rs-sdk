#!/usr/bin/env bash
# One-batch Firemaking lab: starts engine, gateway and lite runners on the
# firemaking port block (docs/speedrun/LAB.md), runs the given measurement
# scripts in order, then stops everything. Copied from agility-lab.sh; the
# differences are the port block and LAB_HELPERS.
#
#   [NODE_TICKRATE=300] [LAB_HELPERS="fmhelp1 fmhelp2"] \
#     docs/speedrun/scripts/firemaking-lab.sh <bot> <script.ts>[:arg:arg] ...
#
# Each script is run as `bun <script> <bot> <args...>`; arguments follow the
# script path separated by ':', e.g.
# "docs/speedrun/scripts/firemaking-line.ts:--logs=magic_logs:--level=99".
# LAB_HELPERS names extra bots that get their own lite runner, for scripts that
# drive a helper account too (trades, dropped-log rows).
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
BOT=$1; shift
LOG=${LAB_LOG:-${TMPDIR:-/tmp}/fmlab}
mkdir -p "$LOG"

export WEB_PORT=9250 WEB_MANAGEMENT_PORT=9251 HISCORES_WEB_PORT=9252 NODE_PORT=43950 AGENT_PORT=8150
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; sleep 1; for p in "${PIDS[@]}"; do kill -9 "$p" 2>/dev/null; done; }
trap cleanup EXIT

wait_for() { # file phrase seconds
    for _ in $(seq 1 "$3"); do grep -q "$2" "$1" 2>/dev/null && return 0; sleep 1; done
    echo "timeout waiting for '$2' in $1"; tail -20 "$1"; return 1
}

(cd "$ROOT/server/engine" && BUILD_VERIFY=false BUILD_LIVE_RELOAD=false NODE_TICKRATE=${NODE_TICKRATE:-100} LOCAL_STAFF_LEVEL=4 exec bun run src/app.ts) > "$LOG/engine.log" 2>&1 &
PIDS+=($!)
wait_for "$LOG/engine.log" 'World ready' 900 || exit 1

(cd "$ROOT/server/gateway" && exec bun run gateway.ts) > "$LOG/gateway.log" 2>&1 &
PIDS+=($!)
sleep 2

for b in "$BOT" ${LAB_HELPERS:-}; do
    if [ ! -f "$ROOT/bots/$b/bot.env" ]; then
        (cd "$ROOT" && bun bots/create-bot.ts "$b" --local --no-chat > /dev/null)
    fi
    sed -i.bak -e 's#^SERVER=.*#SERVER=localhost:9250#' -e 's#^GATEWAY_URL=.*#GATEWAY_URL=ws://localhost:8150#' -e 's#^TELEMETRY=.*#TELEMETRY=false#' "$ROOT/bots/$b/bot.env"
    (cd "$ROOT/server/webclient" && exec bun src/lite/runner.ts "$b") > "$LOG/runner-$b.log" 2>&1 &
    PIDS+=($!)
done
for b in "$BOT" ${LAB_HELPERS:-}; do
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
