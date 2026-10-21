#!/usr/bin/env bash
# Boot the tickmanip lab block (docs/speedrun/LAB.md), log one bot in, run the
# given commands from the repo root, then tear everything down.
#
#   bash docs/speedrun/scripts/tickmanip-lab.sh <bot> -- <command> [args...]
#   bash docs/speedrun/scripts/tickmanip-lab.sh tmlab -- bash -c 'bun a.ts tmlab; bun b.ts tmlab'
#
# Self-contained on purpose: executors may reap background processes between
# batches, so the whole stack lives and dies inside one invocation.
# BUILD_LIVE_RELOAD=false stops the engine's content file-watcher worker, which
# exhausts inotify instances (EMFILE crash) on a machine shared with other labs.
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$ROOT"
BOT=${1:?bot name}; shift
[ "${1:-}" = "--" ] && shift
TICKRATE=${NODE_TICKRATE:-100}
LOGDIR=${LAB_LOGDIR:-${TMPDIR:-/tmp}/tickmanip-lab}
mkdir -p "$LOGDIR"

for d in . server/engine server/webclient server/gateway; do
    [ -d "$d/node_modules" ] || (cd "$d" && bun install --silent >/dev/null 2>&1)
done

ENG=; GW=; RUNNER=
cleanup() { kill $RUNNER $GW $ENG 2>/dev/null; wait 2>/dev/null; }
trap cleanup EXIT

wait_for() { # file phrase seconds
    for _ in $(seq 1 "$3"); do grep -q "$2" "$1" 2>/dev/null && return 0; sleep 1; done
    echo "timeout waiting for '$2' in $1"; tail -20 "$1"; exit 1
}

(cd server/engine && WEB_PORT=8960 WEB_MANAGEMENT_PORT=8961 HISCORES_WEB_PORT=8962 NODE_PORT=43660 \
    BUILD_VERIFY=false BUILD_LIVE_RELOAD=false NODE_TICKRATE=$TICKRATE LOCAL_STAFF_LEVEL=4 \
    exec bun run src/app.ts) >"$LOGDIR/engine.log" 2>&1 &
ENG=$!
# A cold cache pack on a busy machine has taken over 600 s.
wait_for "$LOGDIR/engine.log" 'World ready' "${LAB_READY_SECS:-1200}"

(cd server/gateway && AGENT_PORT=7860 WEB_MANAGEMENT_PORT=8961 exec bun run gateway.ts) >"$LOGDIR/gateway.log" 2>&1 &
GW=$!
sleep 3

if [ ! -f "bots/$BOT/bot.env" ]; then
    bun bots/create-bot.ts "$BOT" --local >/dev/null
    perl -pi -e 's/localhost:8888/localhost:8960/; s/localhost:7780/localhost:7860/; s/^TELEMETRY=true/TELEMETRY=false/' "bots/$BOT/bot.env"
fi

(cd server/webclient && exec bun src/lite/runner.ts "$BOT") >"$LOGDIR/runner.log" 2>&1 &
RUNNER=$!
wait_for "$LOGDIR/runner.log" 'logged into' 120
sleep 2

echo "[lab] engine tickrate ${TICKRATE}ms, bot $BOT ready"
"$@"
STATUS=$?
echo "[lab] command exit $STATUS"
exit $STATUS
