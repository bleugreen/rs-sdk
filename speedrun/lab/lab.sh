#!/usr/bin/env bash
# One-batch speedrun lab: starts engine, gateway and lite runners on the
# speedrun port block (9300-9302, node 44000, gateway 8300), runs the given
# scripts in order, then stops everything.
#
#   [NODE_TICKRATE=400] [LAB_HELPERS="srlab2"] [LAB_RUNNERS=0] \
#     [WEB_PORT=9300 WEB_MANAGEMENT_PORT=9301 HISCORES_WEB_PORT=9302 NODE_PORT=44000 AGENT_PORT=8300] [LAB_TIMEOUT=900] \
#     speedrun/lab/lab.sh <bot> <script.ts>[:arg:arg] ...
#
# Each script runs as `bun <script> <bot> <args...>`; arguments follow the
# script path separated by ':', e.g. "speedrun/lab/measure-bank.ts:--n=3".
# LAB_HELPERS names extra bots that get their own lite runner (trade giver).
# LAB_RUNNERS=0 starts no lite runner for <bot>, for scripts that launch and
# kill the client themselves; LAB_BOTS names extra bots that only get a
# bot.env pointed at the lab (measure-session.ts). The engine runs with
# LOCAL_STAFF_LEVEL=4 so ::tele / ::give / ::setstat work. The first boot packs
# the content and can take several minutes.
#
# LAB_FRIEND=1 also starts the friend server (FRIEND_SERVER=true, port
# LAB_FRIEND_PORT, default 45099), which relays private messages.
#
# LAB_EXTERNAL=1 attaches to an engine and gateway already running on these
# ports (long-lived lab terminals); only the lite runners and scripts start here.
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
BOT=$1; shift
LOG=${LAB_LOG:-${TMPDIR:-/tmp}/speedrun-lab}
mkdir -p "$LOG"
export NODE_TICKRATE=${NODE_TICKRATE:-400}  # the demo's tick since 2026-10-22 (lib/wait.ts DEMO_TICK_MS)
export PROFANITY_FILTER=false NODE_PROFANITY_FILTER=false

# Overridable so several labs can run side by side (each needs its own block).
export WEB_PORT=${WEB_PORT:-9300} WEB_MANAGEMENT_PORT=${WEB_MANAGEMENT_PORT:-9301} HISCORES_WEB_PORT=${HISCORES_WEB_PORT:-9302} NODE_PORT=${NODE_PORT:-44000} AGENT_PORT=${AGENT_PORT:-8300}
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; sleep 1; for p in "${PIDS[@]}"; do kill -9 "$p" 2>/dev/null; done; }
trap cleanup EXIT
# A signal exits through the EXIT trap, so a killed lab stops its engine, gateway and clients too.
trap 'exit 124' TERM INT HUP ALRM
# LAB_TIMEOUT=<seconds> bounds the whole lab (macOS has no timeout(1)).
if [ -n "${LAB_TIMEOUT:-}" ]; then
    # The sleep gets /dev/null and dies with its watcher: an orphaned sleep holding the
    # output would keep a pipe reading the lab open until the timeout.
    (sleep "$LAB_TIMEOUT" </dev/null >/dev/null 2>&1 & s=$!; trap 'kill $s 2>/dev/null; exit 0' TERM; wait $s; echo "lab.sh: LAB_TIMEOUT ${LAB_TIMEOUT}s reached, stopping"; kill -TERM $$) &
    PIDS+=($!)
fi

wait_for() { # file phrase seconds
    for _ in $(seq 1 "$3"); do grep -q "$2" "$1" 2>/dev/null && return 0; sleep 1; done
    echo "timeout waiting for '$2' in $1"; tail -20 "$1"; return 1
}

if [ "${LAB_EXTERNAL:-0}" != "1" ]; then
    if [ "${LAB_FRIEND:-0}" = "1" ]; then
        export FRIEND_SERVER=true FRIEND_PORT=${LAB_FRIEND_PORT:-45099}
        (cd "$ROOT/server/engine" && exec bun run src/friend.ts) > "$LOG/friend.log" 2>&1 &
        PIDS+=($!)
        sleep 2
    fi

    (cd "$ROOT/server/engine" && BUILD_VERIFY=false BUILD_LIVE_RELOAD=false LOCAL_STAFF_LEVEL=4 exec bun run src/app.ts) > "$LOG/engine.log" 2>&1 &
    PIDS+=($!)
    # measure-restart.ts SIGKILLs the engine by this pid and starts its own replacement.
    echo $! > "$LOG/engine.pid"
    export LAB_LOG=$LOG
    wait_for "$LOG/engine.log" 'World ready' 900 || exit 1
    # "World ready" prints before the web server binds: a port held by another lab fails after it,
    # and the scripts would then drive that lab's engine without an error.
    bound() { # log name
        sleep 2
        if grep -q 'EADDRINUSE\|Failed to start server' "$1"; then echo "$2 could not bind its port (another lab on this block?):"; grep -m1 'Failed to start server\|EADDRINUSE' "$1"; return 1; fi
    }
    bound "$LOG/engine.log" engine || exit 1

    (cd "$ROOT/server/gateway" && exec bun run gateway.ts) > "$LOG/gateway.log" 2>&1 &
    PIDS+=($!)
    bound "$LOG/gateway.log" gateway || exit 1
fi

RUNNERS="${LAB_HELPERS:-}"
[ "${LAB_RUNNERS:-1}" != "0" ] && RUNNERS="$BOT $RUNNERS"
for b in "$BOT" ${LAB_HELPERS:-} ${LAB_BOTS:-}; do
    if [ ! -f "$ROOT/bots/$b/bot.env" ]; then
        (cd "$ROOT" && bun bots/create-bot.ts "$b" --local --no-chat > /dev/null)
    fi
    sed -i.bak -e "s#^SERVER=.*#SERVER=localhost:$WEB_PORT#" -e "s#^GATEWAY_URL=.*#GATEWAY_URL=ws://localhost:$AGENT_PORT#" -e 's#^TELEMETRY=.*#TELEMETRY=false#' "$ROOT/bots/$b/bot.env"
    grep -q '^GATEWAY_URL=' "$ROOT/bots/$b/bot.env" || echo "GATEWAY_URL=ws://localhost:$AGENT_PORT" >> "$ROOT/bots/$b/bot.env"
done
for b in $RUNNERS; do
    (cd "$ROOT/server/webclient" && exec bun src/lite/runner.ts "$b") > "$LOG/runner-$b.log" 2>&1 &
    PIDS+=($!)
done
for b in $RUNNERS; do
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
