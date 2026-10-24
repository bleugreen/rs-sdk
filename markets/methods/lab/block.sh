#!/usr/bin/env bash
# Source to export a markets lab port block (docs/markets/README.md 'Lab port blocks'):
#
#   . markets/methods/lab/block.sh M8 && speedrun/lab/lab.sh ...
#
# Refuses (returns 1) when any of the block's ports is already listening.
# M8 is the base; each later block adds 10 to every port (docs/markets/README.md has the owners). From M13 the
# AGENT, LOGIN and LOGGER ports sit 5 higher still: 8020, 44040, 44050, 8060, 44060, 8090 and 44090 belong to
# other labs.
case "$1" in
    M8 | M9 | M10 | M11 | M12 | M13 | M14 | M15 | M16 | M17 | M18 | M19 | M20 | M21 | M22) b=$(( (${1#M} - 8) * 10 )) ;;
    *) echo "block.sh: unknown block $1 (M8 to M22)"; return 1 ;;
esac
shift5=0
[ "${1#M}" -ge 13 ] && shift5=5
export NODE_TICKRATE=400
export WEB_PORT=$((9970 + b)) WEB_MANAGEMENT_PORT=$((9971 + b)) HISCORES_WEB_PORT=$((9972 + b)) NODE_PORT=$((44970 + b))
export AGENT_PORT=$((7970 + b + shift5)) LAB_FRIEND_PORT=$((45970 + b)) LOGIN_PORT=$((43970 + b + shift5)) LOGGER_PORT=$((43971 + b + shift5))
for p in $WEB_PORT $WEB_MANAGEMENT_PORT $HISCORES_WEB_PORT $NODE_PORT $AGENT_PORT $LAB_FRIEND_PORT $LOGIN_PORT $LOGGER_PORT; do
    if lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1; then echo "block.sh: port $p of $1 is in use"; return 1; fi
done
