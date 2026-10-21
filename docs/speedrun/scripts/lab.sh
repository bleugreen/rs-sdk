#!/usr/bin/env bash
# One-batch lab: starts the engine, gateway and a lite runner on one port block
# (docs/speedrun/LAB.md), runs the given measurement scripts in order, then
# stops everything. Use this when long-lived terminals cannot be pinned to the
# machine the scripts run on.
#
#   LAB_BLOCK=<block> [NODE_TICKRATE=300] bash docs/speedrun/scripts/lab.sh <bot> <script.ts>[:arg:arg...] ...
#
# <block> is a row of the LAB.md port table (agility, mining, woodcutting,
# fishing, thieving, tickmanip, travel; default agility). NODE_TICKRATE defaults to 100.
# Each script is run as `bun <script> <bot> <args...>`; arguments are joined to
# the path with colons, e.g. "docs/speedrun/scripts/agility-course.ts:wilderness:10"
# runs `bun docs/speedrun/scripts/agility-course.ts <bot> wilderness 10`.
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
BOT=$1; shift
BLOCK=${LAB_BLOCK:-agility}

case "$BLOCK" in
    agility) N=1 ;;
    mining) N=2 ;;
    woodcutting) N=3 ;;
    fishing) N=4 ;;
    thieving) N=5 ;;
    tickmanip) N=6 ;;
    travel) N=8 ;;
    *) echo "unknown LAB_BLOCK '$BLOCK'"; exit 2 ;;
esac
export WEB_PORT=$((8900 + 10 * N)) WEB_MANAGEMENT_PORT=$((8901 + 10 * N)) HISCORES_WEB_PORT=$((8902 + 10 * N))
export NODE_PORT=$((43600 + 10 * N)) AGENT_PORT=$((7800 + 10 * N))
export NODE_TICKRATE=${NODE_TICKRATE:-100}
LOG=${LAB_LOG:-${TMPDIR:-/tmp}/lab-$BLOCK}
mkdir -p "$LOG"
echo "lab: block $BLOCK (web $WEB_PORT, agent $AGENT_PORT), NODE_TICKRATE=$NODE_TICKRATE, host $(hostname), logs $LOG"

# A fresh executor slot may not have dependencies yet.
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
    echo "=== ${parts[*]} ==="
    (cd "$ROOT" && bun "${parts[0]}" "$BOT" "${parts[@]:1}") || STATUS=$?
done
exit $STATUS
