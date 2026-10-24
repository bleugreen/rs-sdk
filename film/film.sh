#!/usr/bin/env bash
# Film one clip on a lab of its own: starts the lab (speedrun/lab/lab.sh) with the world feed on and
# no lite runner (capture.ts launches the browser client itself), runs film/capture.ts in it, and
# stops everything. Port block 9700 by default, apart from the measurement labs' 9300.
#
#   film/film.sh <bot> --clip=film/clips/firemaking-80.json [--out=DIR] [--seconds=N]
#   film/film.sh <bot> --script=<path> [--setup=<setup.json>] [--opts=<options.json>] [--args=a,b] ...
#
# Arguments may not contain ':' (lab.sh splits a script's arguments on it). Env passes through to
# lab.sh: NODE_TICKRATE (default 400, the demo's), LAB_TIMEOUT, the port variables.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
if [ $# -lt 2 ]; then sed -n '2,10p' "$0"; exit 2; fi
BOT=$1; shift
export WORLD_FEED=true LAB_RUNNERS=0
export WEB_PORT=${WEB_PORT:-9700} WEB_MANAGEMENT_PORT=${WEB_MANAGEMENT_PORT:-9701} HISCORES_WEB_PORT=${HISCORES_WEB_PORT:-9702} NODE_PORT=${NODE_PORT:-44700} AGENT_PORT=${AGENT_PORT:-8700}
# lab.sh catches a port another lab holds only after the engine boots; check the block (and the
# browser's DevTools port, WEB_PORT + 5) first.
for p in "$WEB_PORT" "$WEB_MANAGEMENT_PORT" "$HISCORES_WEB_PORT" "$NODE_PORT" "$AGENT_PORT" $((WEB_PORT + 5)); do
    if lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
        echo "film.sh: port $p is already in use (another lab?); pick another block with WEB_PORT=... AGENT_PORT=... etc."
        exit 1
    fi
done
spec=film/capture.ts
for a in "$@"; do
    case "$a" in *:*) echo "film.sh: '$a' contains ':', which lab.sh uses to split arguments"; exit 2 ;; esac
    spec="$spec:$a"
done
exec "$ROOT/speedrun/lab/lab.sh" "$BOT" "$spec"
