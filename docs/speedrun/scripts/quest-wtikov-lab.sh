#!/usr/bin/env bash
# Lab harness for the Watchtower and Temple of Ikov measurement scripts.
#
#   docs/speedrun/scripts/quest-wtikov-lab.sh <bot> <script.ts> [args...]
#
# Starts the engine and gateway on the quest-route port block for this pair
# (WEB 9080, MGMT 9081, HISCORES 9082, NODE 43780, AGENT 7980) unless they are
# already listening, creates the bot if needed, logs it in with the headless
# lite runner, runs the script against it and stops the runner. The engine and
# gateway are left running so the next script in the same slot reuses them.
#
# BUILD_LIVE_RELOAD=false is required: the dev reload thread fs.watch()es every
# content directory and exhausts file descriptors (EMFILE) on default limits.
set -u
cd "$(git rev-parse --show-toplevel)"
BOT=$1; shift
LOG=${TMPDIR:-/tmp}/wtikov-lab; mkdir -p "$LOG"
ulimit -n 65536 2>/dev/null || ulimit -n "$(ulimit -Hn)" 2>/dev/null || true

for d in server/engine server/gateway server/webclient; do
    [ -d "$d/node_modules" ] || (cd "$d" && bun install >/dev/null 2>&1)
done

up() { curl -s -o /dev/null --max-time 2 "http://localhost:$1/"; }

if ! up 9080; then
    (cd server/engine && WEB_PORT=9080 WEB_MANAGEMENT_PORT=9081 HISCORES_WEB_PORT=9082 NODE_PORT=43780 \
        BUILD_VERIFY=false BUILD_LIVE_RELOAD=false NODE_TICKRATE=100 LOCAL_STAFF_LEVEL=4 \
        nohup bun run src/app.ts > "$LOG/engine.log" 2>&1 &)
    for _ in $(seq 1 240); do grep -q 'World ready' "$LOG/engine.log" 2>/dev/null && break; sleep 1; done
    grep -q 'World ready' "$LOG/engine.log" || { echo '[lab] engine did not start'; tail -20 "$LOG/engine.log"; exit 1; }
fi
if ! up 7980; then
    (cd server/gateway && AGENT_PORT=7980 WEB_MANAGEMENT_PORT=9081 nohup bun run gateway > "$LOG/gateway.log" 2>&1 &)
    sleep 4
fi

if [ ! -f "bots/$BOT/bot.env" ]; then
    bun bots/create-bot.ts "$BOT" --local >/dev/null
    sed -i.bak -e 's#^SERVER=.*#SERVER=localhost:9080#' -e 's#^GATEWAY_URL=.*#GATEWAY_URL=ws://localhost:7980#' \
        -e 's#^TELEMETRY=.*#TELEMETRY=false#' "bots/$BOT/bot.env" && rm -f "bots/$BOT/bot.env.bak"
fi

(cd server/webclient && nohup bun src/lite/runner.ts "$BOT" > "$LOG/runner-$BOT.log" 2>&1 &)
sleep 8
bun "$@" "$BOT"
rc=$?
pkill -f "runner.ts $BOT" || true
exit $rc
