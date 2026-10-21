#!/usr/bin/env bash
# One-batch Ranged lab: starts engine, gateway and a lite runner on the ranged
# port block (docs/speedrun/LAB.md), runs the given measurement scripts in order,
# then stops everything. Use this when long-lived terminals cannot be pinned to
# the machine the scripts run on.
#
#   docs/speedrun/scripts/ranged-lab.sh <bot> <script.ts> [<script.ts> ...]
#
# Each script is run as `bun <script> <bot>`. Script arguments go after `--`
# inside the script path string, e.g. "docs/speedrun/scripts/ranged-cannon.ts:--ticks=300"
# is run as `bun docs/speedrun/scripts/ranged-cannon.ts <bot> --ticks=300`.
#
# With no scripts it serves: prints LAB-UP once the bot is logged in and keeps
# the lab running until killed, so scripts can be run against it one by one
# (from the same machine). NODE_TICKRATE (default 100) sets the tick length.
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
BOT=$1; shift
LOG=${LAB_LOG:-${TMPDIR:-/tmp}/rangedlab}
mkdir -p "$LOG"

export WEB_PORT=9210 WEB_MANAGEMENT_PORT=9211 HISCORES_WEB_PORT=9212 NODE_PORT=43910 AGENT_PORT=8110
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

if [ ! -f "$ROOT/bots/$BOT/bot.env" ]; then
    (cd "$ROOT" && bun bots/create-bot.ts "$BOT" --local --no-chat > /dev/null)
fi
sed -i.bak -e 's#^SERVER=.*#SERVER=localhost:9210#' -e 's#^GATEWAY_URL=.*#GATEWAY_URL=ws://localhost:8110#' -e 's#^TELEMETRY=.*#TELEMETRY=false#' "$ROOT/bots/$BOT/bot.env"

(cd "$ROOT/server/webclient" && exec bun src/lite/runner.ts "$BOT") > "$LOG/runner-$BOT.log" 2>&1 &
PIDS+=($!)
wait_for "$LOG/runner-$BOT.log" 'logged into' 120 || exit 1
sleep 3

if [ $# -eq 0 ]; then echo "LAB-UP tickrate=${NODE_TICKRATE:-100}"; wait; exit 0; fi

STATUS=0
for spec in "$@"; do
    IFS=':' read -r -a parts <<< "$spec"
    echo "=== ${parts[*]} ==="
    (cd "$ROOT" && bun "${parts[0]}" "$BOT" "${parts[@]:1}") || STATUS=$?
done
exit $STATUS
