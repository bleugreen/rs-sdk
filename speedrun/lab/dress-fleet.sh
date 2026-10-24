#!/usr/bin/env bash
# The full-chain lab dress rehearsal with the whole helper fleet (rs/760, for rs/186): one lab engine on
# its own port block, every helper family named, the run's chain from a fresh lab SCORED. Lab only:
# lab.sh starts a loopback engine with LOCAL_STAFF_LEVEL=4 and dress-rehearsal.ts refuses anything else
# (stand-ins.ts labRefusal). No account here exists outside the lab engine's own account store.
#
#   LAB_CONFIG=<lab run config json> speedrun/lab/dress-fleet.sh [--until=<id>] [--from=<id>] [--log=<file>] ...
#   MODE=ready speedrun/lab/dress-fleet.sh        # pre-flight: the new families to ready and back out, no SCORED chain
#
# The lab accounts: SCORED (a fresh lab name, $SCORED), the ring givers and the wine giver (lab.sh
# LAB_HELPERS: lab.sh writes their bot.env with bots/create-bot.ts and keeps a lite runner up for each),
# and every cairn_ helper below (each family's launcher writes its bot.env and the lab engine creates the
# account on its first login). Extra arguments go to dress-rehearsal.ts as they are.
#
# Host rule: bgsrv-mac (never local or fedora), from a scratch tree pinned to one commit, under
# `timeout --kill-after=30s <bound>` (BOUND, default 6h; gtimeout on macOS, else lab.sh's LAB_TIMEOUT).
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT" || exit 2

SCORED=${SCORED:-labdress$(date +%H%M)}
RINGERS=${RINGERS:-labring1,labring2,labring3}
WINE=${WINE:-labwine1}
ALTAR=${ALTAR:-cairn_da01,cairn_da02,cairn_da03,cairn_da04,cairn_da05,cairn_da06,cairn_da07}
DROPPERS=${DROPPERS:-cairn_df01,cairn_df02,cairn_df03,cairn_df04,cairn_df05,cairn_df06}
BONES=${BONES:-cairn_db01,cairn_db02,cairn_db03,cairn_db04}
ANVIL=${ANVIL:-cairn_dan01}
CANNON=${CANNON:-cairn_dch92}
# The carriers take the roles of cairn_mule1, cairn_h55 and cairn_h03, in that order.
CARRIERS=${CARRIERS:-cairn_dm01,cairn_dw55,cairn_de03}
S21=${S21:-$(printf 'cairn_ds%02d,' $(seq 1 22) | sed 's/,$//')}
COURIER=${COURIER:-cairn_dc15}
H12O=${H12O:-cairn_d45}
CLIENT=${CLIENT:-browser}
BOUND=${BOUND:-6h}

# Its own port block, clear of lab.sh's default. The gateway stays in the lab block 8300-8399 (stand-ins.ts
# labRefusal), with room for every family launcher above it (AGENT_PORT+5..+15).
export WEB_PORT=${WEB_PORT:-9640} WEB_MANAGEMENT_PORT=${WEB_MANAGEMENT_PORT:-9641} HISCORES_WEB_PORT=${HISCORES_WEB_PORT:-9642} NODE_PORT=${NODE_PORT:-44640} AGENT_PORT=${AGENT_PORT:-8340}
export NODE_TICKRATE=${NODE_TICKRATE:-400} LOCAL_STAFF_LEVEL=4
export LAB_LOG=${LAB_LOG:-${TMPDIR:-/tmp}/dress-fleet-$SCORED}
# SCORED's client is dress-rehearsal.ts's own (it launches it); lab.sh runs only the LAB_HELPERS runners.
export LAB_RUNNERS=0
export LAB_HELPERS="$(echo "$RINGERS" | tr ',' ' ') $WINE"

spec() { # script, then colon-joined args
    local s=$1; shift
    local a
    for a in "$@"; do s="$s:$a"; done
    printf '%s' "$s"
}

if [ "${MODE:-rehearsal}" = "ready" ]; then
    export LAB_HELPERS=""
    SPEC=$(spec speedrun/lab/dress-fleet-ready.ts "--s21-givers=$S21" "--courier=$COURIER" "--h12o=$H12O" "--carriers=$CARRIERS" "$@")
else
    : "${LAB_CONFIG:?LAB_CONFIG=<lab run config json> is required (partners, firemakingTiles, rings, bones, courier, anvil)}"
    SPEC=$(spec speedrun/lab/dress-rehearsal.ts "--config=$LAB_CONFIG" "--client=$CLIENT" \
        "--ringers=$RINGERS" "--wine-giver=$WINE" "--altar-givers=$ALTAR" "--droppers=$DROPPERS" "--bone-givers=$BONES" \
        "--anvil=$ANVIL" "--cannon-holder=$CANNON" "--carriers=$CARRIERS" "--s21-givers=$S21" "--courier=$COURIER" "--h12o=$H12O" "$@")
fi
echo "dress-fleet: SCORED $SCORED, lab log $LAB_LOG, ports web $WEB_PORT agent $AGENT_PORT"
echo "dress-fleet: $SPEC"

if command -v timeout >/dev/null 2>&1; then T=(timeout --kill-after=30s "$BOUND")
elif command -v gtimeout >/dev/null 2>&1; then T=(gtimeout --kill-after=30s "$BOUND")
else
    T=()
    case "$BOUND" in *h) secs=$(( ${BOUND%h} * 3600 ));; *m) secs=$(( ${BOUND%m} * 60 ));; *s) secs=${BOUND%s};; *) secs=$BOUND;; esac
    export LAB_TIMEOUT=${LAB_TIMEOUT:-$secs}
fi
# PRE=<lab.sh spec>: a script run on the same lab before the rehearsal (e.g. one that takes a fresh
# SCORED off Tutorial Island with auto-retaliate off: the rehearsal's retaliate gate cannot pass there).
# ${T[@]+...}: macOS's bash 3.2 calls an empty array unbound under set -u.
exec ${T[@]+"${T[@]}"} bash speedrun/lab/lab.sh "$SCORED" ${PRE:+"$PRE"} "$SPEC"
