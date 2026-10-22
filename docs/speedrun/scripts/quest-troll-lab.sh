#!/usr/bin/env bash
# One-batch lab for the troll-chain quest measurements (Death Plateau, Troll
# Stronghold, Troll Romance). Starts engine, gateway and a lite runner on the
# troll-chain port block (docs/speedrun/quests/CONVENTIONS.md), runs the given
# measurement scripts in order, then stops everything. Use it when long-lived
# terminals cannot be pinned to the machine the scripts run on.
#
#   docs/speedrun/scripts/quest-troll-lab.sh <bot> <script.ts[:arg[:arg...]]> [...]
#
# "docs/speedrun/scripts/quest-troll-fights.ts:dad:70:10" runs
# `bun docs/speedrun/scripts/quest-troll-fights.ts <bot> dad 70 10`.
# Environment: NODE_TICKRATE (ms, default 400 = the demo since 2026-10-22, so bot reaction
# time is realistic), LAB_SCRIPT_TIMEOUT (seconds per script, default 900),
# LAB_LOG (log directory, default /tmp/trolllab; build-slot TMPDIRs differ
# between batches, so a fixed path keeps logs readable afterwards).
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
BOT=$1; shift
LOG=${LAB_LOG:-/tmp/trolllab}
TICKRATE=${NODE_TICKRATE:-400}
SCRIPT_TIMEOUT=${LAB_SCRIPT_TIMEOUT:-900}
mkdir -p "$LOG"

# Build slots are reused unevenly, so install dependencies when missing.
for d in "" server/engine server/webclient server/gateway; do
    [ -d "$ROOT/$d/node_modules" ] || (cd "$ROOT/$d" && bun install > "$LOG/install.log" 2>&1)
done

export WEB_PORT=9090 WEB_MANAGEMENT_PORT=9091 HISCORES_WEB_PORT=9092 NODE_PORT=43790 AGENT_PORT=7990
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; sleep 1; for p in "${PIDS[@]}"; do kill -9 "$p" 2>/dev/null; done; }
trap cleanup EXIT

wait_for() { # file phrase seconds
    for _ in $(seq 1 "$3"); do grep -q "$2" "$1" 2>/dev/null && return 0; sleep 1; done
    echo "timeout waiting for '$2' in $1"; tail -20 "$1"; return 1
}

(cd "$ROOT/server/engine" && BUILD_VERIFY=false NODE_TICKRATE=$TICKRATE LOCAL_STAFF_LEVEL=4 exec bun run src/app.ts) > "$LOG/engine.log" 2>&1 &
PIDS+=($!)
wait_for "$LOG/engine.log" 'World ready' 900 || exit 1

(cd "$ROOT/server/gateway" && exec bun run gateway.ts) > "$LOG/gateway.log" 2>&1 &
PIDS+=($!)
sleep 2

if [ ! -f "$ROOT/bots/$BOT/bot.env" ]; then
    (cd "$ROOT" && bun bots/create-bot.ts "$BOT" --local --no-chat > /dev/null)
fi
sed -i.bak -e 's#^SERVER=.*#SERVER=localhost:9090#' -e 's#^GATEWAY_URL=.*#GATEWAY_URL=ws://localhost:7990#' -e 's#^TELEMETRY=.*#TELEMETRY=false#' "$ROOT/bots/$BOT/bot.env"

(cd "$ROOT/server/webclient" && exec bun src/lite/runner.ts "$BOT") > "$LOG/runner-$BOT.log" 2>&1 &
PIDS+=($!)
wait_for "$LOG/runner-$BOT.log" 'logged into' 120 || exit 1
sleep 3

STATUS=0
for spec in "$@"; do
    IFS=':' read -r -a parts <<< "$spec"
    echo "=== ${parts[*]} ==="
    out="$LOG/$(basename "${parts[0]}" .ts)-$(IFS=-; echo "${parts[*]:1}").log"
    (cd "$ROOT" && exec bun "${parts[0]}" "$BOT" "${parts[@]:1}") > "$out" 2>&1 &
    sp=$!
    ( sleep "$SCRIPT_TIMEOUT"; kill "$sp" 2>/dev/null && echo "TIMEOUT after ${SCRIPT_TIMEOUT}s" >> "$out" ) &
    wd=$!
    wait "$sp" || STATUS=$?
    kill "$wd" 2>/dev/null
    grep -v '^\[Bot\|LOGOUT\|^Pathfinding' "$out" | tail -${LAB_TAIL:-40}
done
exit $STATUS
