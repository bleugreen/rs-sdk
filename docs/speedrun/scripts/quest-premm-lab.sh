#!/usr/bin/env bash
# Pre-Monkey-Madness fights lab (docs/speedrun/quests/pre_mm_fights.md): start a
# local engine at the demo's 400 ms tick (NODE_TICKRATE), a gateway and a headless bot on
# the pre-MM port block, run the given scripts in order, then tear down.
# Run from the repo root:
#   bash docs/speedrun/scripts/quest-premm-lab.sh <script> [args] [-- <script> [args]]...
#   e.g. bash docs/speedrun/scripts/quest-premm-lab.sh quest-premm-fight.ts warlord 3 mode=fire_bolt
# Each script is called as `bun docs/speedrun/scripts/<script> <bot> [args]`.
# NODE_TICKRATE=100 overrides the tick (only for non-reactive segments).
#
# Same shape as quest-dragon-lab.sh (this block's previous owner). Engine flags
# beyond docs/speedrun/LAB.md: BUILD_LIVE_RELOAD=false (the dev content watcher
# exhausts the executors' open-file limit, EMFILE).
# Portable to Linux and macOS executors (lsof, perl; `timeout` only if present).
# Run it on a lightly loaded executor: an overloaded host stalls the engine, and
# the SDK's 5 s state waits then time out mid-fight.
set -u
ROOT=$(git rev-parse --show-toplevel); cd "$ROOT"
W=9020; MGMT=9021; HS=9022; NODE=43720; AGENT=7920; BOT=${BOT:-premm56}; TICK=${NODE_TICKRATE:-400}
LOG=${TMPDIR:-/tmp}/premmlab; rm -rf "$LOG"; mkdir -p "$LOG"
killports() { for p in $W $MGMT $HS $NODE $AGENT; do pids=$(lsof -ti tcp:$p 2>/dev/null); [ -n "$pids" ] && kill -9 $pids 2>/dev/null; done; }
TO=$(command -v timeout || command -v gtimeout || true)
killports
pkill -f "^bun src/lite/runner[.]ts $BOT\$" 2>/dev/null; sleep 1
[ -d node_modules ] || bun install >/dev/null 2>&1
for d in server/engine server/webclient server/gateway; do [ -d $d/node_modules ] || (cd $d && bun install >/dev/null 2>&1); done
(cd server/engine && WEB_PORT=$W WEB_MANAGEMENT_PORT=$MGMT HISCORES_WEB_PORT=$HS NODE_PORT=$NODE BUILD_VERIFY=false BUILD_LIVE_RELOAD=false NODE_TICKRATE=$TICK LOCAL_STAFF_LEVEL=4 exec bun run src/app.ts >"$LOG/engine.log" 2>&1) &
EPID=$!; GPID=; RPID=
cleanup() { kill $RPID $GPID $EPID 2>/dev/null; sleep 1; killports; }
trap cleanup EXIT
for i in $(seq 1 1800); do grep -q 'World ready' "$LOG/engine.log" && break; kill -0 $EPID 2>/dev/null || { echo ENGINE DIED; tail -30 "$LOG/engine.log"; exit 1; }; sleep 1; done; sleep 8
(cd server/gateway && AGENT_PORT=$AGENT WEB_MANAGEMENT_PORT=$MGMT exec bun run gateway >"$LOG/gateway.log" 2>&1) &
GPID=$!; sleep 4
rm -rf bots/$BOT; bun bots/create-bot.ts $BOT --local >"$LOG/create.log" 2>&1
perl -pi -e "s#^SERVER=.*#SERVER=localhost:$W#; s#^GATEWAY_URL=.*#GATEWAY_URL=ws://localhost:$AGENT#; s#^TELEMETRY=.*#TELEMETRY=false#" bots/$BOT/bot.env 2>/dev/null
# The headless client ends its session if the server is silent for ~60 s
# (server/webclient/src/lite/session.ts IDLE_CYCLES); restart it before a
# script if it has gone, so one stall does not lose the rest of the batch.
start_runner() {
    (cd server/webclient && exec bun src/lite/runner.ts $BOT >>"$LOG/runner.log" 2>&1) &
    RPID=$!
    for i in $(seq 1 60); do [ "$(grep -c 'logged into' "$LOG/runner.log")" -gt "${1:-0}" ] && return 0; sleep 2; done
    echo RUNNER NOT LOGGED IN; tail -20 "$LOG/runner.log"; exit 1
}
start_runner 0; sleep 10
bun docs/speedrun/scripts/quest-primitives-setup.ts $BOT >/dev/null 2>&1
args=()
for a in "$@" --; do
    if [ "$a" = -- ]; then
        [ ${#args[@]} -gt 0 ] && kill -0 $RPID 2>/dev/null || { [ ${#args[@]} -gt 0 ] && { echo "(restarting the headless client)"; start_runner "$(grep -c 'logged into' "$LOG/runner.log")"; sleep 5; }; }
        [ ${#args[@]} -gt 0 ] && { s=${args[0]}; echo "===== ${args[*]}"; NODE_TICKRATE=$TICK ${TO:+$TO 5400} bun docs/speedrun/scripts/$s $BOT "${args[@]:1}" 2>&1 | tee -a "$LOG/results.log" | grep -E '^(RESULT|run |SEG|SETUP|fight|final|hp |  ?[0-9]|\||── Error|    at |Error|\{| ")'; }
        args=()
    else args+=("$a"); fi
done
echo DONE
