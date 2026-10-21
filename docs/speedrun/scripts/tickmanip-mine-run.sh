#!/usr/bin/env bash
# Run tickmanip-mine.ts on rs/5's zoo-cluster rotations (docs/speedrun/skills/mining.md,
# section 4). Usage, inside a tickmanip lab session:
#   bash docs/speedrun/scripts/tickmanip-mine-run.sh <respawn 13|19> <bot> <starter:ores>...
#   bash docs/speedrun/scripts/tickmanip-mine-run.sh 13 tmmine eat:80 knife:80 none:40
# Respawn 13 (the demo at about 1,262 players) needs player_count.rs2 pinned locally and
# server/engine/data/pack/server/script.dat deleted before the engine starts; do not commit it.
S=docs/speedrun/scripts/tickmanip-mine.ts
D13="2604,3235>2605,3235 2602,3235>2602,3236 2603,3234>2602,3234 2603,3233>2602,3233 2605,3234>2605,3233"
D19="2602,3235>2602,3234 2603,3236>2602,3236 2605,3236>2605,3237 2606,3235>2605,3235 2605,3234>2605,3233 2603,3233>2602,3233"
D=$1; BOT=$2; shift 2
STEPS=$D13; [ "$D" = 19 ] && STEPS=$D19
for spec in "$@"; do
    starter=${spec%%:*}; n=${spec##*:}
    echo "---- respawn $D starter=$starter ores=$n"
    # shellcheck disable=SC2086
    bun $S "$BOT" --respawn="$D" --starter="$starter" --ores="$n" --loghead=0 --steps $STEPS 2>&1 | grep -v -E '^\[|Pathfinding'
done
