#!/usr/bin/env bash
# Source to export a markets lab port block (docs/markets/README.md 'Lab port blocks'):
#
#   . markets/methods/lab/block.sh M8 && speedrun/lab/lab.sh ...
#
# Refuses (returns 1) when any of the block's ports is already listening.
# s: M17's AGENT, LOGIN and LOGGER ports sit 5 above the block's pattern (8060 and 44060 belong to other labs).
s=0
case "$1" in
    M8) b=0 ;;
    M9) b=10 ;;
    M10) b=20 ;;
    M11) b=30 ;;
    M17) b=90 s=5 ;;
    *) echo "block.sh: unknown block $1 (M8, M9, M10, M11 or M17)"; return 1 ;;
esac
export NODE_TICKRATE=400
export WEB_PORT=$((9970 + b)) WEB_MANAGEMENT_PORT=$((9971 + b)) HISCORES_WEB_PORT=$((9972 + b)) NODE_PORT=$((44970 + b))
export AGENT_PORT=$((7970 + b + s)) LAB_FRIEND_PORT=$((45970 + b)) LOGIN_PORT=$((43970 + b + s)) LOGGER_PORT=$((43971 + b + s))
for p in $WEB_PORT $WEB_MANAGEMENT_PORT $HISCORES_WEB_PORT $NODE_PORT $AGENT_PORT $LAB_FRIEND_PORT $LOGIN_PORT $LOGGER_PORT; do
    if lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1; then echo "block.sh: port $p of $1 is in use"; return 1; fi
done
