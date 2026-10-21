#!/usr/bin/env bash
# One self-contained lab session: start the engine, the gateway and a headless
# lite client per bot on one port block, run a command, then tear it all down.
#
#   BOTS="dig16 tt16" docs/speedrun/scripts/quest-digsite-lab-session.sh \
#       bun docs/speedrun/scripts/quest-digsite-finds.ts dig16
#
# Why a wrapper: when an agent's long-lived terminals and its one-shot batches
# land on different machines, a lab started in terminals is unreachable from
# the scripts. Running the whole session inside one batch keeps every process
# on one machine, which docs/speedrun/LAB.md requires.
#
# Ports default to the Digsite/Tourist Trap block from
# docs/speedrun/quests/CONVENTIONS.md (WEB 9070, MGMT 9071, HISCORES 9072,
# NODE 43770, AGENT 7970); override WEB_PORT, NODE_PORT and AGENT_PORT.
# Bots that do not exist yet are created with bots/create-bot.ts --local and
# pointed at this block.
set -u

ROOT=$(git rev-parse --show-toplevel)
WEB=${WEB_PORT:-9070}
MGMT=$((WEB + 1))
HIS=$((WEB + 2))
NODE=${NODE_PORT:-43770}
AGENT=${AGENT_PORT:-7970}
LOG=${LAB_LOG_DIR:-${TMPDIR:-/tmp}/questlab-digsite-$WEB}
BOTS=${BOTS:-}
mkdir -p "$LOG"

pids=()
cleanup() {
    for p in "${pids[@]}"; do kill "$p" 2>/dev/null; done
    sleep 1
    for p in "${pids[@]}"; do kill -9 "$p" 2>/dev/null; done
}
trap cleanup EXIT INT TERM

for b in $BOTS; do
    env="$ROOT/bots/$b/bot.env"
    if [ ! -f "$env" ]; then
        (cd "$ROOT" && bun bots/create-bot.ts "$b" --local >/dev/null)
    fi
    sed -i.bak -e "s#^SERVER=.*#SERVER=localhost:$WEB#" -e "s#^GATEWAY_URL=.*#GATEWAY_URL=ws://localhost:$AGENT#" "$env"
    grep -q '^GATEWAY_URL=' "$env" || echo "GATEWAY_URL=ws://localhost:$AGENT" >> "$env"
    grep -q '^TELEMETRY=' "$env" && sed -i.bak -e 's#^TELEMETRY=.*#TELEMETRY=false#' "$env"
    rm -f "$env.bak"
done

(cd "$ROOT/server/engine" && WEB_PORT=$WEB WEB_MANAGEMENT_PORT=$MGMT HISCORES_WEB_PORT=$HIS NODE_PORT=$NODE \
    BUILD_VERIFY=false NODE_TICKRATE=${NODE_TICKRATE:-100} LOCAL_STAFF_LEVEL=4 \
    exec bun run src/app.ts) > "$LOG/engine.log" 2>&1 &
pids+=($!)

for i in $(seq 1 900); do
    grep -q 'World ready' "$LOG/engine.log" && break
    if ! kill -0 "${pids[0]}" 2>/dev/null; then echo "engine exited:"; tail -40 "$LOG/engine.log"; exit 1; fi
    sleep 1
done
grep -q 'World ready' "$LOG/engine.log" || { echo "engine not ready"; tail -40 "$LOG/engine.log"; exit 1; }
echo "[lab] engine ready on $WEB after ${i}s"

(cd "$ROOT/server/gateway" && AGENT_PORT=$AGENT WEB_MANAGEMENT_PORT=$MGMT exec bun run gateway.ts) > "$LOG/gateway.log" 2>&1 &
pids+=($!)
sleep 3

for b in $BOTS; do
    (cd "$ROOT/server/webclient" && exec bun src/lite/runner.ts "$b") > "$LOG/runner-$b.log" 2>&1 &
    pids+=($!)
done
sleep 8
echo "[lab] gateway on $AGENT, clients: ${BOTS:-none}"

cd "$ROOT"
"$@"
status=$?
echo "[lab] command exited $status"
exit $status
