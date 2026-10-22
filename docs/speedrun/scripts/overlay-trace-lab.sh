#!/usr/bin/env bash
# One-batch lab for overlay-trace.ts: the engine and gateway on one port block
# (docs/speedrun/LAB.md), the browser bundle, then the traced tab and probe, then stop.
#
#   [BUNDLE_REV=<rev>] [LAB_BLOCK=overlay] NODE_TICKRATE=400 bash docs/speedrun/scripts/overlay-trace-lab.sh <bot> [--trials=60]
#
# The default block, overlay (web 9110, agent 8010), is its own so a long-lived lab on a
# shared block (rs/97 keeps one on tickmanip) cannot serve its bundle to this tab; the script
# refuses to start if any of its ports is already listening.
#
# BUNDLE_REV builds the page from server/webclient at another revision (for a before/after
# pair) in a scratch copy, then serves it from this checkout's out/; the default builds
# this checkout. Logs go to $LAB_LOG (default $TMPDIR/overlay-trace-<block>).
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
BOT=$1; shift
BLOCK=${LAB_BLOCK:-overlay}
case "$BLOCK" in
    agility) N=1 ;; mining) N=2 ;; woodcutting) N=3 ;; fishing) N=4 ;; thieving) N=5 ;; tickmanip) N=6 ;; overlay) N=21 ;;
    *) echo "unknown LAB_BLOCK '$BLOCK'"; exit 2 ;;
esac
export WEB_PORT=$((8900 + 10 * N)) WEB_MANAGEMENT_PORT=$((8901 + 10 * N)) HISCORES_WEB_PORT=$((8902 + 10 * N))
export NODE_PORT=$((43600 + 10 * N)) AGENT_PORT=$((7800 + 10 * N))
for port in $WEB_PORT $WEB_MANAGEMENT_PORT $HISCORES_WEB_PORT $NODE_PORT $AGENT_PORT; do
    if (echo > "/dev/tcp/127.0.0.1/$port") 2> /dev/null; then
        echo "port $port is already listening; another lab holds block $BLOCK"; exit 2
    fi
done
export NODE_TICKRATE=${NODE_TICKRATE:-400}
LOG=${LAB_LOG:-${TMPDIR:-/tmp}/overlay-trace-$BLOCK}
mkdir -p "$LOG"
load() { cut -d' ' -f1-3 /proc/loadavg 2>/dev/null || sysctl -n vm.loadavg; }
REV=${BUNDLE_REV:-$(git -C "$ROOT" rev-parse --short HEAD)}
echo "overlay trace: block $BLOCK, NODE_TICKRATE=$NODE_TICKRATE, bundle $REV, host $(hostname), load $(load)"

for d in . server/engine server/webclient server/gateway; do
    [ -d "$ROOT/$d/node_modules" ] || (cd "$ROOT/$d" && bun install --silent > /dev/null 2>&1)
done
if [ -n "${BUNDLE_REV:-}" ]; then
    SRC=$(mktemp -d)
    git -C "$ROOT" archive "$BUNDLE_REV" server/webclient | tar -x -C "$SRC" || exit 1
    ln -s "$ROOT/server/webclient/node_modules" "$SRC/server/webclient/node_modules"
    (cd "$SRC/server/webclient" && BUILD_MODE=bot bun run build > "$LOG/build.log" 2>&1) || { echo 'bundle build failed'; tail -20 "$LOG/build.log"; exit 1; }
    mkdir -p "$ROOT/server/webclient/out"
    rm -rf "$ROOT/server/webclient/out/bot" && cp -R "$SRC/server/webclient/out/bot" "$ROOT/server/webclient/out/bot"
    rm -rf "$SRC"
else
    (cd "$ROOT/server/webclient" && BUILD_MODE=bot bun run build > "$LOG/build.log" 2>&1) || { echo 'bundle build failed'; tail -20 "$LOG/build.log"; exit 1; }
fi

PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; sleep 2; for p in "${PIDS[@]}"; do kill -9 "$p" 2>/dev/null; done; }
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

# LAB_TAB_SCRIPT=overlay-render-check.ts runs the render check instead of the trace.
(cd "$ROOT" && bun "docs/speedrun/scripts/${LAB_TAB_SCRIPT:-overlay-trace.ts}" "$BOT" --origin="http://localhost:$WEB_PORT" --gateway="ws://localhost:$AGENT_PORT" --out="$LOG/$REV" "$@")
