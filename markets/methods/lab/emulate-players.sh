#!/usr/bin/env bash
# Pin the engine's player count for respawn scaling (player_count.rs2 `scale_by_playercount`) to the
# demo's, then rebuild the content pack. Rock, tree and stall respawns in the lab then match a world
# of that many players: at 1,400, iron 20 -> 13 ticks, gem rocks 200 -> 130, runite 2,400 -> 1,560.
#
#   bash markets/methods/lab/emulate-players.sh 1400
#
# A worktree edit for one lab batch only: never commit it (the batch restores the tree).
set -eu
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
F=$ROOT/server/content/scripts/general/scripts/player_count.rs2
N=${1:?player count}
sed -i.bak -E "s/^def_int \\\$playercount = .*;/def_int \$playercount = $N;/" "$F" && rm -f "$F.bak"
grep -q "playercount = $N;" "$F" || { echo "emulate-players: edit failed"; cat "$F"; exit 1; }
(cd "$ROOT/server/engine" && BUILD_VERIFY=false bun run build)
