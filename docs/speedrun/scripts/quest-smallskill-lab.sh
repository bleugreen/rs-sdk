#!/usr/bin/env bash
# Lab harness for the small self-skill quest measurements (Monk's Friend, Sea Slug,
# Fishing Contest, Doric's Quest): docs/speedrun/quests/{monks_friend,sea_slug,
# fishing_contest,dorics_quest}.md. This child's port block (CONVENTIONS.md):
# WEB 9010, MGMT 9011, HISCORES 9012, NODE 43710, AGENT 7910.
#
#   bash docs/speedrun/scripts/quest-smallskill-lab.sh --engine     # foreground, in its own terminal
#   bash docs/speedrun/scripts/quest-smallskill-lab.sh --gateway    # foreground, in its own terminal
#   bash docs/speedrun/scripts/quest-smallskill-lab.sh <bot> <script.ts> [args...]
#
# The third form creates the bot if needed, logs it in with the headless lite
# runner, runs the script against it and stops the runner; output is also saved
# to $TMPDIR/smallskill-lab/<bot>.out. The engine and gateway run in the
# foreground because an agent batch waits for every process it started.
#
# NODE_TICKRATE defaults to 400, the demo's tick since 2026-10-22 (the worldfeed hello); dialogue and walking
# reactions depend on it (primitives.md). BUILD_LIVE_RELOAD=false keeps the dev
# reload thread from fs.watch()ing all of content/ (EMFILE on Linux).
set -u
cd "$(git rev-parse --show-toplevel)"
LOG=${TMPDIR:-/tmp}/smallskill-lab; mkdir -p "$LOG"
ulimit -n 65536 2>/dev/null || ulimit -n "$(ulimit -Hn)" 2>/dev/null || true

[ -d node_modules ] || bun install >/dev/null 2>&1
for d in server/engine server/gateway server/webclient; do
    [ -d "$d/node_modules" ] || (cd "$d" && bun install >/dev/null 2>&1)
done

case "${1:-}" in
    --engine)
        cd server/engine && exec env WEB_PORT=9010 WEB_MANAGEMENT_PORT=9011 HISCORES_WEB_PORT=9012 NODE_PORT=43710 \
            BUILD_VERIFY=false BUILD_LIVE_RELOAD=false NODE_TICKRATE=${NODE_TICKRATE:-400} LOCAL_STAFF_LEVEL=4 \
            bun run src/app.ts ;;
    --gateway)
        cd server/gateway && exec env AGENT_PORT=7910 WEB_MANAGEMENT_PORT=9011 bun run gateway ;;
esac

up() { curl -s -o /dev/null --max-time 2 "http://localhost:$1/"; }
up 9010 || { echo '[lab] engine not listening on 9010: start it with --engine'; exit 1; }

BOT=$1; shift
if [ ! -f "bots/$BOT/bot.env" ]; then
    bun bots/create-bot.ts "$BOT" --local >/dev/null
    sed -i.bak -e 's#^SERVER=.*#SERVER=localhost:9010#' -e 's#^GATEWAY_URL=.*#GATEWAY_URL=ws://localhost:7910#' \
        -e 's#^TELEMETRY=.*#TELEMETRY=false#' "bots/$BOT/bot.env" && rm -f "bots/$BOT/bot.env.bak"
fi

(cd server/webclient && exec bun src/lite/runner.ts "$BOT" > "$LOG/runner-$BOT.log" 2>&1) &
RUNNER=$!
sleep 8
bun "$@" "$BOT" 2>&1 | tee "$LOG/$BOT.out"
rc=${PIPESTATUS[0]}
kill $RUNNER 2>/dev/null; pkill -f "runner.ts $BOT" 2>/dev/null
wait 2>/dev/null
exit $rc
