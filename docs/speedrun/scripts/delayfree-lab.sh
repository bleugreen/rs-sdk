#!/usr/bin/env bash
# One-batch lab for the delay-free helper-fed skills (rs/37: Crafting, Herblore,
# Fletching, Cooking). Starts engine, gateway and a lite runner on the delayfree
# port block (docs/speedrun/LAB.md), runs the given steps in order, then stops
# everything. Copied from agility-lab.sh; adds a dependency check and a relog step.
#
#   docs/speedrun/scripts/delayfree-lab.sh <bot> <step> [<step> ...]
#
# A step is either a script spec, run as `bun <script> <bot> <args...>` with the
# arguments separated by ':' (e.g. "docs/speedrun/scripts/delayfree-cycle.ts:--skill=herblore"),
# or "@relog[:<seconds>]", which logs the bot out (stops its lite runner), waits
# <seconds> (default 3), and logs it back in with a fresh runner. Login-armed
# timers (the wine timer, wine.rs2:72-73) restart on that login.
#
# NODE_TICKRATE defaults to 100 for exploration; quote headline cadences from a
# NODE_TICKRATE=300 run (LAB.md).
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
BOT=$1; shift
LOG=${LAB_LOG:-${TMPDIR:-/tmp}/delayfreelab}
mkdir -p "$LOG"

export WEB_PORT=9270 WEB_MANAGEMENT_PORT=9271 HISCORES_WEB_PORT=9272 NODE_PORT=43970 AGENT_PORT=8170
export NODE_TICKRATE=${NODE_TICKRATE:-100}
PIDS=()
RUNNER=""
cleanup() { for p in "${PIDS[@]}" $RUNNER; do kill "$p" 2>/dev/null; done; sleep 1; for p in "${PIDS[@]}" $RUNNER; do kill -9 "$p" 2>/dev/null; done; }
trap cleanup EXIT

wait_for() { # file phrase seconds
    for _ in $(seq 1 "$3"); do grep -q "$2" "$1" 2>/dev/null && return 0; sleep 1; done
    echo "timeout waiting for '$2' in $1"; tail -20 "$1"; return 1
}

for d in "$ROOT" "$ROOT/server/engine" "$ROOT/server/webclient" "$ROOT/server/gateway"; do
    [ -d "$d/node_modules" ] || (cd "$d" && bun install > "$LOG/install.log" 2>&1)
done

(cd "$ROOT/server/engine" && BUILD_VERIFY=false BUILD_LIVE_RELOAD=false LOCAL_STAFF_LEVEL=4 exec bun run src/app.ts) > "$LOG/engine.log" 2>&1 &
PIDS+=($!)
wait_for "$LOG/engine.log" 'World ready' 2700 || exit 1 # first boot packs the cache: 15+ min on a busy executor

(cd "$ROOT/server/gateway" && exec bun run gateway.ts) > "$LOG/gateway.log" 2>&1 &
PIDS+=($!)
sleep 2

if [ ! -f "$ROOT/bots/$BOT/bot.env" ]; then
    (cd "$ROOT" && bun bots/create-bot.ts "$BOT" --local --no-chat > /dev/null)
fi
sed -i.bak -e "s#^SERVER=.*#SERVER=localhost:$WEB_PORT#" -e "s#^GATEWAY_URL=.*#GATEWAY_URL=ws://localhost:$AGENT_PORT#" -e 's#^TELEMETRY=.*#TELEMETRY=false#' "$ROOT/bots/$BOT/bot.env"

LOGINS=0
start_runner() {
    LOGINS=$((LOGINS + 1))
    (cd "$ROOT/server/webclient" && exec bun src/lite/runner.ts "$BOT") > "$LOG/runner-$BOT-$LOGINS.log" 2>&1 &
    RUNNER=$!
    wait_for "$LOG/runner-$BOT-$LOGINS.log" 'logged into' 120 || exit 1
    sleep 3
}
start_runner

STATUS=0
for spec in "$@"; do
    IFS=':' read -r -a parts <<< "$spec"
    if [ "${parts[0]}" = "@relog" ]; then
        echo "=== relog (NODE_TICKRATE=$NODE_TICKRATE) ==="
        kill "$RUNNER" 2>/dev/null; sleep 1; kill -9 "$RUNNER" 2>/dev/null
        sleep "${parts[1]:-3}"
        start_runner
        continue
    fi
    echo "=== ${parts[*]} (NODE_TICKRATE=$NODE_TICKRATE) ==="
    (cd "$ROOT" && bun "${parts[0]}" "$BOT" "${parts[@]:1}") || STATUS=$?
done
exit $STATUS
