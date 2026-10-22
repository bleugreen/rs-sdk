#!/usr/bin/env bash
# One-batch lab for the in-page tick programs: the engine and gateway on one port block
# (docs/speedrun/LAB.md), this checkout's browser bundle, the bot's page in Chrome
# (tickprog-tab.ts), then each tickprog-measure.ts mode in order, then stop everything.
#
#   LAB_BLOCK=tickmanip NODE_TICKRATE=400 bash docs/speedrun/scripts/tickprog-lab.sh <bot> <mode>[:--k=v:...] ...
#   e.g. ... tickprog-lab.sh cairntp1 probe:--trials=60 mine:--ores=200 fly:--until=99 wedge
#
# Bot names are letters and digits only, at most 12 (bots/create-bot.ts refuses anything else).
#
# A spec whose first part is a .ts path runs that driver against the open tab instead:
#   ... tickprog-lab.sh cairnfl1 speedrun/lab/measure-fishing.ts:fly:--level=78
#
# `wedge` runs tickprog-wedge.ts (the watchdog check) instead of a measurement.
#
# GIVERS=a,b logs lite runners in for the `rc` mode's essence givers: before the tab with
# GIVERS_ORDER=first (the default: the server handles them before the scored account, as
# tuned needs) or after it with GIVERS_ORDER=last (the scored account first).
#   GIVERS=cairng1,cairng2 ... tickprog-lab.sh cairntp1 rc:--givers=cairng1,cairng2:--schedule=tuned:--crafts=30
# GIVERS_IP=127.0.0.8,127.0.0.2 (parallel to GIVERS) gives each giver the address the engine
# buckets it by (the engine then runs with FLY_APP_NAME=lab and trusts fly-client-ip; the tab
# keeps its socket address, 127.0.0.1 or ::1, both bucket 1).
#
# Headful Chrome by default (HEADLESS=1 for a runner without a display). Logs go to
# $LAB_LOG (default $TMPDIR/tickprog-<block>): engine, gateway, tab (the page's [program]
# lines) and tab/stats.log (render samples once a second).
set -u
# The filters are line-buffered so a batch killed at its bound still shows every line so far.
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
BOT=$1; shift
BLOCK=${LAB_BLOCK:-tickmanip}
case "$BLOCK" in
    agility) N=1 ;; mining) N=2 ;; woodcutting) N=3 ;; fishing) N=4 ;; thieving) N=5 ;; tickmanip) N=6 ;;
    [0-9]|[1-9][0-9]) N=$BLOCK ;; # a free row past the table (ports 8900 + 10 N, ...), for a lab beside the per-skill ones
    *) echo "unknown LAB_BLOCK '$BLOCK'"; exit 2 ;;
esac
export WEB_PORT=$((8900 + 10 * N)) WEB_MANAGEMENT_PORT=$((8901 + 10 * N)) HISCORES_WEB_PORT=$((8902 + 10 * N))
export NODE_PORT=$((43600 + 10 * N)) AGENT_PORT=$((7800 + 10 * N))
export NODE_TICKRATE=${NODE_TICKRATE:-400}
LOG=${LAB_LOG:-${TMPDIR:-/tmp}/tickprog-$BLOCK}
mkdir -p "$LOG"
# A block another lab holds would take this lab's page and bots into that lab's engine.
for p in $WEB_PORT $NODE_PORT $AGENT_PORT; do
    if lsof -nP -iTCP:"$p" -sTCP:LISTEN > /dev/null 2>&1; then echo "port $p of block $BLOCK is in use; pick another LAB_BLOCK"; exit 2; fi
done
load() { cut -d' ' -f1-3 /proc/loadavg 2>/dev/null || sysctl -n vm.loadavg; }
echo "tickprog lab: block $BLOCK (web $WEB_PORT, agent $AGENT_PORT), NODE_TICKRATE=$NODE_TICKRATE, host $(hostname), load $(load), logs $LOG"

for d in . server/engine server/webclient server/gateway; do
    [ -d "$ROOT/$d/node_modules" ] || (cd "$ROOT/$d" && bun install --silent > /dev/null 2>&1)
done
(cd "$ROOT/server/webclient" && bun run build > "$LOG/build.log" 2>&1) || { echo 'bundle build failed'; tail -20 "$LOG/build.log"; exit 1; }

PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; sleep 2; for p in "${PIDS[@]}"; do kill -9 "$p" 2>/dev/null; done; }
trap cleanup EXIT
wait_for() { # file phrase seconds
    for _ in $(seq 1 "$3"); do grep -q "$2" "$1" 2>/dev/null && return 0; sleep 1; done
    echo "timeout waiting for '$2' in $1"; tail -20 "$1"; return 1
}

[ -n "${GIVERS_IP:-}" ] && export FLY_APP_NAME=lab
(cd "$ROOT/server/engine" && BUILD_VERIFY=false BUILD_LIVE_RELOAD=false LOCAL_STAFF_LEVEL=4 exec bun run src/app.ts) > "$LOG/engine.log" 2>&1 &
PIDS+=($!)
wait_for "$LOG/engine.log" 'World ready' 900 || exit 1
(cd "$ROOT/server/gateway" && exec bun run gateway.ts) > "$LOG/gateway.log" 2>&1 &
PIDS+=($!)
sleep 2

# A bot without a bot.env is created; create-bot's refusal (a bad name) is shown and ends the lab.
ensure_bot() {
    [ -f "$ROOT/bots/$1/bot.env" ] && return 0
    (cd "$ROOT" && bun bots/create-bot.ts "$1" --local --no-chat > "$LOG/create-bot-$1.log" 2>&1)
    [ -f "$ROOT/bots/$1/bot.env" ] || { echo "create-bot $1 left no bot.env:"; cat "$LOG/create-bot-$1.log"; exit 2; }
}

# HELPER=<bot> sets up a second account for the modes that trade with one (pickpocket --helper)
for b in "$BOT" ${HELPER:-}; do
    ensure_bot "$b"
    sed -i.bak -e "s#^SERVER=.*#SERVER=localhost:$WEB_PORT#" -e "s#^GATEWAY_URL=.*#GATEWAY_URL=ws://localhost:$AGENT_PORT#" -e 's#^TELEMETRY=.*#TELEMETRY=false#' "$ROOT/bots/$b/bot.env"
done

givers() { # lite runners for the rc mode, logged in one at a time in list order
    [ -n "${GIVERS:-}" ] || return 0
    IFS=',' read -r -a GLIST <<< "$GIVERS"
    GI=0
    for G in "${GLIST[@]}"; do
        ensure_bot "$G"
        sed -i.bak -e "s#^SERVER=.*#SERVER=localhost:$WEB_PORT#" -e "s#^GATEWAY_URL=.*#GATEWAY_URL=ws://localhost:$AGENT_PORT#" -e 's#^TELEMETRY=.*#TELEMETRY=false#' "$ROOT/bots/$G/bot.env"
        GI=$((GI + 1)); IP=$(echo "${GIVERS_IP:-}" | cut -d, -f$GI)
        (cd "$ROOT/server/webclient" && LITE_CLIENT_IP=$IP exec bun src/lite/runner.ts "$G") > "$LOG/runner-$G.log" 2>&1 &
        PIDS+=($!)
        wait_for "$LOG/runner-$G.log" 'logged into' 120 || exit 1
        sleep 1
    done
}
[ "${GIVERS_ORDER:-first}" = first ] && givers

# TAB_FLAGS=--stock-chrome keeps Chrome's background throttling (tickprog-tab.ts)
(cd "$ROOT" && exec bun docs/speedrun/scripts/tickprog-tab.ts "$BOT" --origin="http://localhost:$WEB_PORT" --gateway="ws://localhost:$AGENT_PORT" --out="$LOG/tab" --debug-port=$((9390 + N)) ${TAB_FLAGS:-}) > "$LOG/tab.log" 2>&1 &
PIDS+=($!)
wait_for "$LOG/tab.log" 'TAB-READY' 180 || exit 1
sleep 3
[ "${GIVERS_ORDER:-first}" = last ] && givers

STATUS=0
for spec in "$@"; do
    IFS=':' read -r -a parts <<< "$spec"
    echo "=== ${parts[*]} (load $(load)) ==="
    if [ "${parts[0]}" = throttle ]; then # Chrome background throttling check (tickprog-throttle.ts)
        (cd "$ROOT" && bun docs/speedrun/scripts/tickprog-throttle.ts --debug-port=$((9390 + N)) "${parts[@]:1}") 2>&1 || STATUS=$?
        continue
    fi
    if [[ "${parts[0]}" == *.ts ]]; then # a step-module driver (speedrun/lab/measure-*.ts); SPEEDRUN_CDP_URL is this tab's DevTools port
        (cd "$ROOT" && SPEEDRUN_CDP_URL="http://127.0.0.1:$((9390 + N))" bun "${parts[0]}" "$BOT" "${parts[@]:1}") 2>&1 | grep --line-buffered -vE 'Pathfinding|^\[(Runner|BotSDK)\]' || STATUS=$?
        continue
    fi
    if [ "${parts[0]}" = wedge ]; then # the watchdog check; it leaves the tab wedged, so run it last
        (cd "$ROOT" && bun docs/speedrun/scripts/tickprog-wedge.ts "$BOT" --debug-port=$((9390 + N)) "${parts[@]:1}") 2>&1 | grep --line-buffered -vE 'Pathfinding|^\[(Runner|BotSDK)\]|LOGOUT DEBUG' || STATUS=$?
        continue
    fi
    (cd "$ROOT" && bun docs/speedrun/scripts/tickprog-measure.ts "$BOT" "${parts[@]}") 2>&1 | grep --line-buffered -vE 'Pathfinding|^\[(Runner|BotSDK)\]' || STATUS=$?
done
echo "=== render samples (tab/stats.log, last 5) ==="; tail -5 "$LOG/tab/stats.log"
exit $STATUS
