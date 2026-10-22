#!/usr/bin/env bash
# Run speedrun/lab/quests/dragon-slayer.ts specs on a private lab block and stop the lab once
# `TABLES` result tables have printed (lab.sh can hang in its shutdown after the scripts finish).
#   TABLES=2 speedrun/lab/quests/dragon-slayer-lab.sh <out-file> <spec>...
# A spec is lab.sh's "<script>:arg:arg"; every spec needs --launch (LAB_RUNNERS=0).
set -u
OUT=$1; shift
export LAB_LOG=${LAB_LOG:-${TMPDIR:-/tmp}/dslab258}
mkdir -p "$LAB_LOG"
export LAB_RUNNERS=0 WEB_PORT=${WEB_PORT:-9580} WEB_MANAGEMENT_PORT=${WEB_MANAGEMENT_PORT:-9581} HISCORES_WEB_PORT=${HISCORES_WEB_PORT:-9582} NODE_PORT=${NODE_PORT:-44580} AGENT_PORT=${AGENT_PORT:-8580}
LIMIT=${LAB_TIMEOUT:-3000}
bash "$(dirname "$0")/../lab.sh" "${BOT:-dslab258}" "$@" > "$OUT" 2>&1 &
LAB=$!
for _ in $(seq 1 "$LIMIT"); do
    sleep 1
    kill -0 $LAB 2>/dev/null || break
    [ "$(grep -c 'RESULT S26_table' "$OUT")" -ge "${TABLES:-1}" ] && break
done
kill -TERM $LAB 2>/dev/null; sleep 2
for p in $WEB_PORT $WEB_MANAGEMENT_PORT $AGENT_PORT $NODE_PORT; do lsof -ti tcp:$p -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null; done
true
