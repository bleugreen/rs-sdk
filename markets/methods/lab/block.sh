#!/usr/bin/env bash
# Source to export a markets lab port block (docs/markets/README.md 'Lab port blocks'):
#
#   . markets/methods/lab/block.sh M8 && speedrun/lab/lab.sh ...
#
# Refuses (returns 1) when any of the block's ports is already listening.
case "$1" in
    M8) b=0 ;;
    M9) b=10 ;;
    M10) b=20 ;;
    M11) b=30 ;;
    M18) b= ;;
    *) echo "block.sh: unknown block $1 (M8, M9, M10, M11 or M18)"; return 1 ;;
esac
export NODE_TICKRATE=400
if [ "$1" = M18 ]; then
    # assigned by rs/495 off the +10 pattern: its AGENT, LOGIN and LOGGER ports would collide with speedrun labs
    export WEB_PORT=10070 WEB_MANAGEMENT_PORT=10071 HISCORES_WEB_PORT=10072 NODE_PORT=45070
    export AGENT_PORT=8075 LAB_FRIEND_PORT=46070 LOGIN_PORT=44075 LOGGER_PORT=44076
else
    export WEB_PORT=$((9970 + b)) WEB_MANAGEMENT_PORT=$((9971 + b)) HISCORES_WEB_PORT=$((9972 + b)) NODE_PORT=$((44970 + b))
    export AGENT_PORT=$((7970 + b)) LAB_FRIEND_PORT=$((45970 + b)) LOGIN_PORT=$((43970 + b)) LOGGER_PORT=$((43971 + b))
fi
listening() {
    if command -v ss >/dev/null 2>&1; then ss -ltnH "sport = :$1" | grep -q .; else lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; fi
}
for p in $WEB_PORT $WEB_MANAGEMENT_PORT $HISCORES_WEB_PORT $NODE_PORT $AGENT_PORT $LAB_FRIEND_PORT $LOGIN_PORT $LOGGER_PORT; do
    if listening "$p"; then echo "block.sh: port $p of $1 is in use"; return 1; fi
done
