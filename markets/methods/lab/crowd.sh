#!/usr/bin/env bash
# Crowding: the same method run by 1, 2, 4 ... bots at once on one lab engine, one count after
# another, so every count shares the same spawn group (docs/markets/phase2.md 'Crowding').
#
#   markets/methods/lab/crowd.sh <block M8|M9> <method> <bot prefix> <ticks> <counts> [rate.ts args...]
#   markets/methods/lab/crowd.sh M8 knight m8k 3600 "1 2 4 8" --hp=99
#
# Every bot of the largest count is logged in for the whole lab; a count's idle bots stand at the
# bank or in Lumbridge. Each count prints rate.ts's RESULT lines tagged with its bots.
set -u
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
BLOCK=$1 METHOD=$2 PREFIX=$3 TICKS=$4 COUNTS=$5
shift 5
. "$ROOT/markets/methods/lab/block.sh" "$BLOCK" || exit 1
max=0
for n in $COUNTS; do [ "$n" -gt "$max" ] && max=$n; done
helpers=""
for i in $(seq 2 "$max"); do helpers="$helpers ${PREFIX}$i"; done
extra=$(IFS=,; echo "$*")
specs=()
for n in $COUNTS; do
    spec="markets/methods/lab/parallel.ts"
    for i in $(seq 1 "$n"); do spec="$spec:${PREFIX}$i=$METHOD,--ticks=$TICKS${extra:+,$extra}"; done
    specs+=("$spec")
done
cd "$ROOT" && LAB_HELPERS="$helpers" speedrun/lab/lab.sh "${PREFIX}1" "${specs[@]}"
