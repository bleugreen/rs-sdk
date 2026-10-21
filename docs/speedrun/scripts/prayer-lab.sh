#!/usr/bin/env bash
# One-batch Prayer lab: starts engine, gateway and a lite runner on the prayer
# port block (WEB_PORT 9230, AGENT_PORT 8130), runs the given measurement
# scripts in order, then stops everything. Copied from agility-lab.sh on
# agent/rs-2-coordinator-0 with the port block changed (docs/speedrun/LAB.md).
#
#   NODE_TICKRATE=300 docs/speedrun/scripts/prayer-lab.sh <bot> <script.ts>[:arg:arg] ...
#
# Each script is run as `bun <script> <bot> <args...>`; arguments ride after the
# script path separated by ':', e.g.
# "docs/speedrun/scripts/prayer-bury.ts:--mode=fast:--start=1".
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
BOT=$1; shift
LOG=${LAB_LOG:-${TMPDIR:-/tmp}/prayerlab}
mkdir -p "$LOG"

export WEB_PORT=9230 WEB_MANAGEMENT_PORT=9231 HISCORES_WEB_PORT=9232 NODE_PORT=43930 AGENT_PORT=8130
for p in $WEB_PORT $WEB_MANAGEMENT_PORT $HISCORES_WEB_PORT $NODE_PORT $AGENT_PORT; do fuser -k $p/tcp 2>/dev/null; done
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
sleep 8 # the web listener comes up a few seconds after 'World ready'

(cd "$ROOT/server/gateway" && exec bun run gateway.ts) > "$LOG/gateway.log" 2>&1 &
PIDS+=($!)
sleep 2

if [ ! -f "$ROOT/bots/$BOT/bot.env" ]; then
    (cd "$ROOT" && bun bots/create-bot.ts "$BOT" --local --no-chat > /dev/null)
fi
sed -i.bak -e 's#^SERVER=.*#SERVER=localhost:9230#' -e 's#^GATEWAY_URL=.*#GATEWAY_URL=ws://localhost:8130#' -e 's#^TELEMETRY=.*#TELEMETRY=false#' "$ROOT/bots/$BOT/bot.env"

(cd "$ROOT/server/webclient" && exec bun src/lite/runner.ts "$BOT") > "$LOG/runner-$BOT.log" 2>&1 &
PIDS+=($!)
wait_for "$LOG/runner-$BOT.log" 'logged into' 120 || exit 1
sleep 3

STATUS=0
for spec in "$@"; do
    IFS=':' read -r -a parts <<< "$spec"
    echo "=== ${parts[*]} ==="
    # Results also go to $LOG/results.log, so a lost batch connection does not lose them.
    (cd "$ROOT" && timeout "${SCRIPT_TIMEOUT:-2400}" bun "${parts[0]}" "$BOT" "${parts[@]:1}") 2>&1 \
        | grep -v '^\[Client\]' | tee -a "$LOG/results.log"
    [ "${PIPESTATUS[0]}" -eq 0 ] || STATUS=1
done
exit $STATUS
