#!/usr/bin/env bash
# One-batch level-up lab (docs/speedrun/research/levelup-cost.md): starts the engine and gateway on
# the level-up port block, logs in one lite runner per bot (in the given order), runs the given
# scripts, then stops everything. Same shape as lab.sh; the port block is fixed:
#   WEB 9640, management 9641, hiscores 9642, node 44640, agent 8640.
#
#   NODE_TICKRATE=400 bash docs/speedrun/scripts/levelup-lab.sh <bot>[,<bot>...] <script.ts>[:arg:arg] ...
#
# Each script runs as `bun <script> <first bot> <args...>`; prefix the spec with + to pass the whole
# comma-separated bot list instead (runecraft-cycle.ts takes scored,helper). Arguments are joined
# to the path with colons. NODE_TICKRATE defaults to 400 here (the demo's tick since 2026-10-22).
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
BOTS=$1; shift
IFS=',' read -r -a BOTLIST <<< "$BOTS"
export WEB_PORT=9640 WEB_MANAGEMENT_PORT=9641 HISCORES_WEB_PORT=9642 NODE_PORT=44640 AGENT_PORT=8640
export NODE_TICKRATE=${NODE_TICKRATE:-400}
LOG=${LAB_LOG:-${TMPDIR:-/tmp}/lab-levelup}
mkdir -p "$LOG"
echo "levelup lab: web $WEB_PORT, agent $AGENT_PORT, NODE_TICKRATE=$NODE_TICKRATE, host $(hostname), load $(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null || uptime), logs $LOG"

for d in . server/engine server/webclient server/gateway; do
    [ -d "$ROOT/$d/node_modules" ] || (cd "$ROOT/$d" && bun install --silent > /dev/null 2>&1)
done

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

for BOT in "${BOTLIST[@]}"; do
    if [ ! -f "$ROOT/bots/$BOT/bot.env" ]; then
        (cd "$ROOT" && bun bots/create-bot.ts "$BOT" --local --no-chat > /dev/null)
    fi
    sed -i.bak -e "s#^SERVER=.*#SERVER=localhost:$WEB_PORT#" -e "s#^GATEWAY_URL=.*#GATEWAY_URL=ws://localhost:$AGENT_PORT#" -e 's#^TELEMETRY=.*#TELEMETRY=false#' "$ROOT/bots/$BOT/bot.env"
    (cd "$ROOT/server/webclient" && exec bun src/lite/runner.ts "$BOT") > "$LOG/runner-$BOT.log" 2>&1 &
    PIDS+=($!)
    wait_for "$LOG/runner-$BOT.log" 'logged into' 120 || exit 1
    sleep 1
done
sleep 3

STATUS=0
for spec in "$@"; do
    WHO=${BOTLIST[0]}
    if [ "${spec:0:1}" = "+" ]; then WHO=$BOTS; spec=${spec:1}; fi
    IFS=':' read -r -a parts <<< "$spec"
    echo "=== ${parts[*]} (load $(cut -d' ' -f1 /proc/loadavg 2>/dev/null || echo ?)) ==="
    (cd "$ROOT" && bun "${parts[0]}" "$WHO" "${parts[@]:1}") || STATUS=$?
done
exit $STATUS
