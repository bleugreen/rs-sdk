#!/usr/bin/env bash
# One-batch interleaving lab (rs/38): starts engine, gateway and a lite runner on the
# interleave port block (WEB 9280, MGMT 9281, HISCORES 9282, NODE 43980, AGENT 8180),
# runs the given measurement scripts in order, then stops everything. Copied from
# agility-lab.sh (docs/speedrun/LAB.md), with NODE_TICKRATE defaulting to 400 (the demo's tick since 2026-10-22) because
# every interleaving number depends on where packets land inside a production tick.
#
#   docs/speedrun/scripts/interleave-lab.sh <bot> <script.ts>[:arg:arg] ...
#
# Each script is run as `bun <script> <bot> <args...>`; arguments are separated by ':'
# inside the spec, e.g. "docs/speedrun/scripts/interleave-gather.ts:--skill=wc:--helper=arrows".
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
BOT=$1; shift
LOG=${LAB_LOG:-${TMPDIR:-/tmp}/interleavelab}
mkdir -p "$LOG"

export WEB_PORT=9280 WEB_MANAGEMENT_PORT=9281 HISCORES_WEB_PORT=9282 NODE_PORT=43980 AGENT_PORT=8180
export NODE_TICKRATE=${NODE_TICKRATE:-400}
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

if [ ! -f "$ROOT/bots/$BOT/bot.env" ]; then
    (cd "$ROOT" && bun bots/create-bot.ts "$BOT" --local --no-chat > /dev/null)
fi
sed -i.bak -e "s#^SERVER=.*#SERVER=localhost:$WEB_PORT#" -e "s#^GATEWAY_URL=.*#GATEWAY_URL=ws://localhost:$AGENT_PORT#" -e 's#^TELEMETRY=.*#TELEMETRY=false#' "$ROOT/bots/$BOT/bot.env"

(cd "$ROOT/server/webclient" && exec bun src/lite/runner.ts "$BOT") > "$LOG/runner-$BOT.log" 2>&1 &
PIDS+=($!)
wait_for "$LOG/runner-$BOT.log" 'logged into' 120 || exit 1
sleep 3

STATUS=0
for spec in "$@"; do
    IFS=':' read -r -a parts <<< "$spec"
    echo "=== ${parts[*]} (NODE_TICKRATE=$NODE_TICKRATE) ==="
    (cd "$ROOT" && bun "${parts[0]}" "$BOT" "${parts[@]:1}") || STATUS=$?
done
exit $STATUS
