#!/usr/bin/env bash
# Dragon Slayer lab: start a local engine, gateway and headless bot on the
# rs/11 port block, run the given measurement scripts, then tear down.
# Run from the repo root: bash docs/speedrun/scripts/quest-dragon-lab.sh <script> [args] [-- <script> [args]]...
# e.g. bash docs/speedrun/scripts/quest-dragon-lab.sh quest-dragon-elvarg.ts 70 3 -- quest-dragon-voyage.ts 2
#
# Engine flags beyond docs/speedrun/LAB.md:
#  NODE_TICKRATE=300     production tick, as primitives.md uses for dialogue timing
#  BUILD_LIVE_RELOAD=false  the hot-reload dev thread (server/engine/src/cache/DevThread.ts)
#                        watches the content tree and exhausts an 8192 open-file
#                        limit (EMFILE) on a fresh checkout; the lab doesn't need it
set -u
ROOT=$(git rev-parse --show-toplevel); cd "$ROOT"
W=9020; MGMT=9021; HS=9022; NODE=43720; AGENT=7920; BOT=${BOT:-dslab11}
LOG=${TMPDIR:-/tmp}/dslab; rm -rf "$LOG"; mkdir -p "$LOG"
for p in $W $MGMT $HS $NODE $AGENT; do fuser -k $p/tcp 2>/dev/null; done
pkill -f "^bun src/lite/runner[.]ts $BOT\$" 2>/dev/null; sleep 1
[ -d node_modules ] || bun install >/dev/null 2>&1
for d in server/engine server/webclient server/gateway; do [ -d $d/node_modules ] || (cd $d && bun install >/dev/null 2>&1); done
(cd server/engine && WEB_PORT=$W WEB_MANAGEMENT_PORT=$MGMT HISCORES_WEB_PORT=$HS NODE_PORT=$NODE BUILD_VERIFY=false BUILD_LIVE_RELOAD=false NODE_TICKRATE=300 LOCAL_STAFF_LEVEL=4 exec bun run src/app.ts >"$LOG/engine.log" 2>&1) &
EPID=$!; GPID=; RPID=
cleanup() { kill $RPID $GPID $EPID 2>/dev/null; sleep 1; for p in $W $MGMT $HS $NODE $AGENT; do fuser -k $p/tcp 2>/dev/null; done; }
trap cleanup EXIT
for i in $(seq 1 900); do grep -q 'World ready' "$LOG/engine.log" && break; kill -0 $EPID 2>/dev/null || { echo ENGINE DIED; tail -30 "$LOG/engine.log"; exit 1; }; sleep 1; done; sleep 8
(cd server/gateway && AGENT_PORT=$AGENT WEB_MANAGEMENT_PORT=$MGMT exec bun run gateway >"$LOG/gateway.log" 2>&1) &
GPID=$!; sleep 4
rm -rf bots/$BOT; bun bots/create-bot.ts $BOT --local >"$LOG/create.log" 2>&1
sed -i -e "s#^SERVER=.*#SERVER=localhost:$W#" -e "s#^GATEWAY_URL=.*#GATEWAY_URL=ws://localhost:$AGENT#" -e 's#^TELEMETRY=.*#TELEMETRY=false#' bots/$BOT/bot.env 2>/dev/null
(cd server/webclient && exec bun src/lite/runner.ts $BOT >"$LOG/runner.log" 2>&1) &
RPID=$!; sleep 40
grep -q 'logged into' "$LOG/runner.log" || { echo RUNNER NOT LOGGED IN; tail -20 "$LOG/runner.log"; exit 1; }
bun docs/speedrun/scripts/quest-primitives-setup.ts $BOT >/dev/null 2>&1
args=()
for a in "$@" --; do
    if [ "$a" = -- ]; then
        [ ${#args[@]} -gt 0 ] && { s=${args[0]}; echo "===== ${args[*]}"; timeout 1500 bun docs/speedrun/scripts/$s $BOT "${args[@]:1}" 2>&1 | tee -a "$LOG/results.log" | grep -E '^(RESULT|run |walkTo|\{|gear|equip|── Error|    at |Error)'; }
        args=()
    else args+=("$a"); fi
done
echo DONE
