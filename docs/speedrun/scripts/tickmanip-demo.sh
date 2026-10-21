#!/usr/bin/env bash
# Knife woodcutting on the demo server: plain, knife forced on, and knife behind the host
# gate, in interleaved rounds, with a latency probe before every block
# (docs/speedrun/skills/tick-manipulation.md, "Run-time host gate").
#
#   bash docs/speedrun/scripts/tickmanip-demo.sh <bot> [rounds=5] [logs=20]
#
# Run it from a checkout on the host being tested: the probe and the loops measure that
# host's path to the demo. It starts a private SDK gateway on $GATEWAY_PORT (default 7851)
# and a lite runner for <bot>, readies the account (tickmanip-demo-setup.ts: tutorial skip,
# the Lumbridge knife spawn, a few logs, the trees west of the castle), runs the rounds, and
# prints tickmanip-demo-report.ts over the logs. <bot> is a throwaway account whose
# bots/<bot>/bot.env sets SERVER=rs-sdk-demo.fly.dev and GATEWAY_URL=ws://localhost:$GATEWAY_PORT;
# never the scored account. Logs go to $OUT (default $TMPDIR/tickmanip-demo-<bot>).
set -u
BOT=${1:?bot}; ROUNDS=${2:-5}; N=${3:-20}
ROOT=$(cd "$(dirname "$0")/../../.." && pwd); cd "$ROOT"
PORT=${GATEWAY_PORT:-7851}
OUT=${OUT:-${TMPDIR:-/tmp}/tickmanip-demo-$BOT}; mkdir -p "$OUT"
S=docs/speedrun/scripts
load() { cut -d' ' -f1-3 /proc/loadavg 2>/dev/null || sysctl -n vm.loadavg; }
quiet() { grep -vE 'Pathfinding|\[Runner\]|\[BotSDK\]|LOGOUT|^\s*$'; }
grep -q "^GATEWAY_URL=ws://localhost:$PORT" "bots/$BOT/bot.env" || { echo "bots/$BOT/bot.env must set GATEWAY_URL=ws://localhost:$PORT"; exit 2; }
echo "### tickmanip-demo $(date -u +%FT%TZ) host $(hostname) load $(load) bot $BOT rounds $ROUNDS logs $N"
(cd server/gateway && AGENT_PORT=$PORT WEB_MANAGEMENT_PORT=$((PORT + 1102)) exec bun run gateway.ts) > "$OUT/gateway.log" 2>&1 & GW=$!
sleep 2
(cd server/webclient && exec bun src/lite/runner.ts "$BOT") > "$OUT/runner.log" 2>&1 & RN=$!
trap 'kill $RN $GW 2>/dev/null; sleep 2; kill -9 $RN $GW 2>/dev/null' EXIT
for _ in $(seq 1 120); do grep -q 'logged into' "$OUT/runner.log" && break; sleep 1; done
sleep 3
[ "${SETUP:-1}" = 1 ] && bun $S/tickmanip-demo-setup.ts "$BOT" 2>&1 | quiet | grep -v '^chop:'
for r in $(seq 1 "$ROUNDS"); do
    for cond in base knife-off knife-gate; do
        echo "--- round $r $cond probe $(date -u +%T) load $(load)"
        bun $S/tickmanip-latency.ts "$BOT" --no-tele --trials=30 --plain=4 2>&1 | quiet | grep -E '^(probe|latency|on time|gate)'
        case $cond in
            base) a="--mode=tree-base" ;;
            knife-off) a="--mode=tree-knife --gate=off" ;;
            knife-gate) a="--mode=tree-knife" ;;
        esac
        # shellcheck disable=SC2086
        bun $S/tickmanip-cycle.ts "$BOT" $a --demo --rolls="$N" --maxticks=2500 --log="$OUT/r$r-$cond.log" 2>&1 | quiet | grep -E '^(T[0-9]+ gate|segment)'
    done
done
echo "### done $(date -u +%FT%TZ) load $(load)"
bun $S/tickmanip-demo-report.ts "$OUT"
