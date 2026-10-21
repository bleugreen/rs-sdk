#!/usr/bin/env bash
# Lab harness for the small self-skill quest measurements (Monk's Friend, Sea Slug,
# Fishing Contest, Doric's Quest): docs/speedrun/quests/{monks_friend,sea_slug,
# fishing_contest,dorics_quest}.md.
#
#   bash docs/speedrun/scripts/quest-smallskill-lab.sh <bot> <script.ts> [args...]
#
# Starts the engine and gateway on this child's port block (WEB 9010, MGMT 9011,
# HISCORES 9012, NODE 43710, AGENT 7910; CONVENTIONS.md) unless they are already
# listening, creates the bot if needed, logs it in with the headless lite runner,
# runs the script against it and stops the runner. Output is also saved to
# $TMPDIR/smallskill-lab/<bot>.out. Stop the lab with `--stop` as the only argument.
#
# NODE_TICKRATE=300 is the production tick (fly.toml:26); dialogue and walking
# reactions depend on it (primitives.md). BUILD_LIVE_RELOAD=false keeps the dev
# reload thread from fs.watch()ing all of content/ (EMFILE on Linux).
set -u
cd "$(git rev-parse --show-toplevel)"
LOG=${TMPDIR:-/tmp}/smallskill-lab; mkdir -p "$LOG"
if [ "${1:-}" = "--stop" ]; then
    pkill -f 'WEB_PORT=9010' 2>/dev/null; pkill -f 'AGENT_PORT=7910' 2>/dev/null
    lsof -ti tcp:9010 -ti tcp:43710 -ti tcp:7910 2>/dev/null | xargs kill 2>/dev/null
    exit 0
fi
BOT=$1; shift
ulimit -n 65536 2>/dev/null || ulimit -n "$(ulimit -Hn)" 2>/dev/null || true

[ -d node_modules ] || bun install >/dev/null 2>&1
for d in server/engine server/gateway server/webclient; do
    [ -d "$d/node_modules" ] || (cd "$d" && bun install >/dev/null 2>&1)
done

up() { curl -s -o /dev/null --max-time 2 "http://localhost:$1/"; }

if ! up 9010; then
    (cd server/engine && WEB_PORT=9010 WEB_MANAGEMENT_PORT=9011 HISCORES_WEB_PORT=9012 NODE_PORT=43710 \
        BUILD_VERIFY=false BUILD_LIVE_RELOAD=false NODE_TICKRATE=${NODE_TICKRATE:-300} LOCAL_STAFF_LEVEL=4 \
        nohup bun run src/app.ts > "$LOG/engine.log" 2>&1 &)
    for _ in $(seq 1 300); do grep -q 'World ready' "$LOG/engine.log" 2>/dev/null && break; sleep 1; done
    grep -q 'World ready' "$LOG/engine.log" || { echo '[lab] engine did not start'; tail -20 "$LOG/engine.log"; exit 1; }
fi
if ! up 7910; then
    (cd server/gateway && AGENT_PORT=7910 WEB_MANAGEMENT_PORT=9011 nohup bun run gateway > "$LOG/gateway.log" 2>&1 &)
    sleep 4
fi

if [ ! -f "bots/$BOT/bot.env" ]; then
    bun bots/create-bot.ts "$BOT" --local >/dev/null
    sed -i.bak -e 's#^SERVER=.*#SERVER=localhost:9010#' -e 's#^GATEWAY_URL=.*#GATEWAY_URL=ws://localhost:7910#' \
        -e 's#^TELEMETRY=.*#TELEMETRY=false#' "bots/$BOT/bot.env" && rm -f "bots/$BOT/bot.env.bak"
fi

(cd server/webclient && nohup bun src/lite/runner.ts "$BOT" > "$LOG/runner-$BOT.log" 2>&1 &)
sleep 8
bun "$@" "$BOT" 2>&1 | tee "$LOG/$BOT.out"
rc=${PIPESTATUS[0]}
pkill -f "runner.ts $BOT" || true
exit $rc
