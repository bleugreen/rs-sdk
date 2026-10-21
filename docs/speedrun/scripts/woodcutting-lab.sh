#!/usr/bin/env bash
# One-batch Woodcutting lab on the woodcutting port block (docs/speedrun/LAB.md):
# starts the engine, gateway and a lite runner, runs the given scripts in order,
# then stops everything. Copied from agility-lab.sh with the port block changed.
#
#   docs/speedrun/scripts/woodcutting-lab.sh <bot> <script.ts>[:arg:arg...] ...
#
# "docs/speedrun/scripts/woodcutting-chop.ts:--tree:Willow" runs
# `bun docs/speedrun/scripts/woodcutting-chop.ts <bot> --tree Willow`.
#
# WC_TRACE=1 applies woodcutting-trace.patch to the engine for this run and reverts
# it on exit, so the engine log ($LAB_LOG/engine.log) carries `WCTRACE <tick> ...`
# lines (see woodcutting-trace-summary.ts). NODE_TICKRATE defaults to 100.
# Each script's output is preceded by `=== <script> engine-line=<N> ===`, the engine
# log's line count when it started, to cut the trace per run.
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
BOT=$1; shift
LOG=${LAB_LOG:-${TMPDIR:-/tmp}/wclab}
mkdir -p "$LOG"

export WEB_PORT=8930 WEB_MANAGEMENT_PORT=8931 HISCORES_WEB_PORT=8932 NODE_PORT=43630 AGENT_PORT=7830
PIDS=()
PATCHED=0
cleanup() {
    for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; sleep 1
    for p in "${PIDS[@]}"; do kill -9 "$p" 2>/dev/null; done
    if [ "$PATCHED" = 1 ]; then (cd "$ROOT" && git apply -R docs/speedrun/scripts/woodcutting-trace.patch); fi
}
trap cleanup EXIT

wait_for() { # file phrase seconds
    for _ in $(seq 1 "$3"); do grep -q "$2" "$1" 2>/dev/null && return 0; sleep 1; done
    echo "timeout waiting for '$2' in $1"; tail -20 "$1"; return 1
}

if [ "${WC_TRACE:-0}" = 1 ]; then
    (cd "$ROOT" && git apply docs/speedrun/scripts/woodcutting-trace.patch) || exit 1
    PATCHED=1
fi

(cd "$ROOT/server/engine" && BUILD_VERIFY=false BUILD_LIVE_RELOAD=false NODE_TICKRATE=${NODE_TICKRATE:-100} LOCAL_STAFF_LEVEL=4 exec bun run src/app.ts) > "$LOG/engine.log" 2>&1 &
PIDS+=($!)
wait_for "$LOG/engine.log" 'World ready' 900 || exit 1

(cd "$ROOT/server/gateway" && exec bun run gateway.ts) > "$LOG/gateway.log" 2>&1 &
PIDS+=($!)
sleep 2

if [ ! -f "$ROOT/bots/$BOT/bot.env" ]; then
    (cd "$ROOT" && bun bots/create-bot.ts "$BOT" --local --no-chat > /dev/null)
fi
sed -i.bak -e 's#^SERVER=.*#SERVER=localhost:8930#' -e 's#^GATEWAY_URL=.*#GATEWAY_URL=ws://localhost:7830#' -e 's#^TELEMETRY=.*#TELEMETRY=false#' "$ROOT/bots/$BOT/bot.env"

(cd "$ROOT/server/webclient" && exec bun src/lite/runner.ts "$BOT") > "$LOG/runner-$BOT.log" 2>&1 &
PIDS+=($!)
wait_for "$LOG/runner-$BOT.log" 'logged into' 120 || exit 1
sleep 3

STATUS=0
for spec in "$@"; do
    IFS=':' read -r -a parts <<< "$spec"
    echo "=== ${parts[*]} engine-line=$(wc -l < "$LOG/engine.log" | tr -d ' ') ==="
    (cd "$ROOT" && bun "${parts[0]}" "$BOT" "${parts[@]:1}") || STATUS=$?
done
echo "=== end engine-line=$(wc -l < "$LOG/engine.log" | tr -d ' ') ==="
exit $STATUS
