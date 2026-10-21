#!/usr/bin/env bash
# One-batch Smithing lab: starts engine, gateway and a lite runner on the smithing
# port block (WEB_PORT 9240, AGENT_PORT 8140; docs/speedrun/LAB.md), runs the given measurement scripts in order,
# then stops everything. Use this when long-lived terminals cannot be pinned to
# the machine the scripts run on.
#
#   docs/speedrun/scripts/smithing-lab.sh <bot> <script.ts> [<script.ts> ...]
#
# Each script is run as `bun <script> <bot>`. Script arguments go after `--`
# inside the script path string, e.g. "docs/speedrun/scripts/smithing-cycle.ts:--cycles:4"
# is run as `bun docs/speedrun/scripts/smithing-cycle.ts <bot> --cycles 4`.
# HELPER=<bot2> also logs in a second bot (for smithing-trade.ts). NODE_TICKRATE
# defaults to 100; pass NODE_TICKRATE=300 for headline numbers.
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
BOT=$1; shift
LOG=${LAB_LOG:-${TMPDIR:-/tmp}/smithlab}
mkdir -p "$LOG"

export WEB_PORT=9240 WEB_MANAGEMENT_PORT=9241 HISCORES_WEB_PORT=9242 NODE_PORT=43940 AGENT_PORT=8140
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
sed -i.bak -e 's#^SERVER=.*#SERVER=localhost:9240#' -e 's#^GATEWAY_URL=.*#GATEWAY_URL=ws://localhost:8140#' -e 's#^TELEMETRY=.*#TELEMETRY=false#' "$ROOT/bots/$BOT/bot.env"

(cd "$ROOT/server/webclient" && exec bun src/lite/runner.ts "$BOT") > "$LOG/runner-$BOT.log" 2>&1 &
PIDS+=($!)
wait_for "$LOG/runner-$BOT.log" 'logged into' 120 || exit 1

if [ -n "${HELPER:-}" ]; then
    if [ ! -f "$ROOT/bots/$HELPER/bot.env" ]; then
        (cd "$ROOT" && bun bots/create-bot.ts "$HELPER" --local --no-chat > /dev/null)
    fi
    sed -i.bak -e 's#^SERVER=.*#SERVER=localhost:9240#' -e 's#^GATEWAY_URL=.*#GATEWAY_URL=ws://localhost:8140#' -e 's#^TELEMETRY=.*#TELEMETRY=false#' "$ROOT/bots/$HELPER/bot.env"
    (cd "$ROOT/server/webclient" && exec bun src/lite/runner.ts "$HELPER") > "$LOG/runner-$HELPER.log" 2>&1 &
    PIDS+=($!)
    wait_for "$LOG/runner-$HELPER.log" 'logged into' 120 || exit 1
fi
sleep 3

STATUS=0
for spec in "$@"; do
    IFS=':' read -r -a parts <<< "$spec"
    echo "=== ${parts[*]} ==="
    (cd "$ROOT" && bun "${parts[0]}" "$BOT" "${parts[@]:1}") || STATUS=$?
done
exit $STATUS
