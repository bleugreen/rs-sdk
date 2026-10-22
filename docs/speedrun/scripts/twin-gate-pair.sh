#!/usr/bin/env bash
# One gate read on rs-ashburn-rehearsal, started on a given UTC second, so it pairs with the run
# host's gate timer read in the same minute (rs/83's timer fires at :00:00 and :30:00 UTC).
# Runs on the twin as ubuntu, fed over HOST.md's ssh line from bgsrv-ub or the Mac:
#
#   ssh <HOST.md's ssh options> ubuntu@$RS_TWIN_HOST 'bash -s -- 21:00:00' < docs/speedrun/scripts/twin-gate-pair.sh
#
# Environment: BOT (default cairn_gate), O, the slot owner (default rs-170), REPO, the checkout
# whose CLI runs (default ~/rs-sdk), DRY=1 to check everything and launch nothing.
#
# Order: leftover check; skip (exit 3) if other owners' live slots hold two logins (a slot without
# a "logins" field counts as two), if a chrome, bun or ffmpeg process runs with no slot, or if the
# account is still in the world; take the slot for 6 min;
# start rs/96's direct gate CLI (RUN-HOST.md step 6, its defaults: 60 trials, --no-tele) on the
# second, bounded by `timeout --kill-after=30s 5m`. The CLI logs out at the end (rs/168), but a
# CLI killed by the timeout may not, and a dropped account stays in the world about 500 ticks on
# the demo (hiscore-timestamps.md section 5.1). So the script holds the slot until
# /playerpositions no longer lists the account, then releases it and runs the leftover check
# again. Every loop it starts runs under its own timeout.
set -u
T=${1:?usage: twin-gate-pair.sh HH:MM:SS (UTC, today)}
BOT=${BOT:-cairn_gate}
O=${O:-rs-170}
REPO=${REPO:-$HOME/rs-sdk}
D=$HOME/rehearsal-slots
NAME=$(echo "$BOT" | tr _ ' ' | awk '{for (i = 1; i <= NF; i++) $i = toupper(substr($i, 1, 1)) substr($i, 2)} 1')
TS=$(date -u -d "today $T" +%Y%m%dT%H%M%SZ)
LOG=$HOME/rs-run/pair-$TS.log
JSON=$HOME/rs-run/pair-$TS.json
PP=$HOME/rs-run/pair-$TS.inworld
export NAME

leftover() {
    for s in /tmp/tmux-$(id -u)/*; do [ -S "$s" ] && echo "tmux -L $(basename $s): $(tmux -S $s ls 2>&1 | tr '\n' ' ')"; done
    ps -o pid,etime,comm -p "$(pgrep -d, '^(chrome.*|ffmpeg|bun|timeout|Xvfb)$')" 2>/dev/null || echo 'no chrome, ffmpeg, bun, timeout or Xvfb process'
    cat $D/*.json 2>/dev/null || echo 'no slots held'
}
# Live slots of other owners, one per line.
others() {
    for f in $D/*.json; do
        [ -f "$f" ] && [ "$f" != "$D/$O.json" ] || continue
        U=$(sed -n 's/.*"until": *"\([^"]*\)".*/\1/p' "$f")
        [ -n "$U" ] && [ "$(date -d "$U" +%s)" -gt "$(date +%s)" ] && cat "$f"
    done
}
take() {
    printf '{"owner":"%s","until":"%s","logins":1,"reason":"%s"}\n' "$O" "$(date -u -d "now + $1 minutes" +%Y-%m-%dT%H:%M:%SZ)" "paired gate read, $BOT at $T UTC" >$D/$O.json.tmp && mv $D/$O.json.tmp $D/$O.json
}
release() { rm -f $D/$O.json; }
# 1 if the account is in the world, 0 if not; fails when the endpoint gives nothing.
present() {
    local o
    o=$(curl -s -m 4 https://rs-sdk-demo.fly.dev/playerpositions </dev/null) && [ -n "$o" ] || return 1
    case "$o" in *"\"name\":\"$NAME\""*) echo 1 ;; *) echo 0 ;; esac
}
# From /playerpositions on stdin: the account's tile, level and 64-tile region, and how many
# other players stand within 15 tiles on its level (about the client's view).
where() {
    tr '}' '\n' | sed -n 's/.*"x":\([0-9]*\),"z":\([0-9]*\),"level":\([0-9]*\),"name":"\([^"]*\)".*/\1 \2 \3 \4/p' |
        awk -v n="$NAME" '{ x[NR] = $1; z[NR] = $2; l[NR] = $3; nm = $0; sub(/^[0-9]+ [0-9]+ [0-9]+ /, "", nm); if (nm == n) me = NR }
            END { if (!me) { print "not listed"; exit } c = 0
                  for (i = 1; i <= NR; i++) if (i != me && l[i] == l[me] && (x[i] - x[me]) ^ 2 <= 225 && (z[i] - z[me]) ^ 2 <= 225) c++
                  printf "tile %d,%d level %d, region %d_%d, %d others within 15 tiles, %d listed\n", x[me], z[me], l[me], int(x[me] / 64), int(z[me] / 64), c, NR }'
}
# Prints a line whenever the account enters or leaves the world, and its position every 15 s.
watch_world() {
    local prev= c o last=0
    while :; do
        if o=$(curl -s -m 4 https://rs-sdk-demo.fly.dev/playerpositions </dev/null) && [ -n "$o" ]; then
            case "$o" in *"\"name\":\"$NAME\""*) c=1 ;; *) c=0 ;; esac
            [ "$c" != "$prev" ] && echo "$(date -u +%T) in_world=$c"
            prev=$c
            if [ "$c" = 1 ] && [ $(($(date +%s) - last)) -ge 15 ]; then
                echo "$(date -u +%T) $(echo "$o" | where)"
                last=$(date +%s)
            fi
        fi
        sleep 2
    done
}
export -f present where watch_world

main() {
    echo "== $BOT read at $T UTC, owner $O, twin $(hostname), $(date -u +%T)"
    echo '== leftover check, before'
    leftover
    mkdir -p $D $HOME/rs-run
    exec 9>$D/.lock
    flock -w 10 9 || { echo 'SKIP: slot lock busy'; exit 3; }
    local held
    held=$(others)
    if [ -n "$held" ]; then
        # A slot states its logins ("logins":N); one without the field counts as the cap's two.
        local n
        n=$(echo "$held" | awk '{ if (match($0, /"logins": *[0-9]+/)) { s = substr($0, RSTART, RLENGTH); sub(/.*: */, "", s); t += s } else t += 2 } END { print t + 0 }')
        if [ "$n" -ge 2 ]; then echo "SKIP: other owners' live slots hold $n logins: $held"; exit 3; fi
        echo "== sharing the twin within the cap, other slots hold $n login: $held"
    elif pgrep '^(chrome.*|ffmpeg|bun)$' >/dev/null; then
        echo 'SKIP: a chrome, bun or ffmpeg process is running with no slot'
        exit 3
    fi
    local c
    c=$(present) || { echo 'SKIP: /playerpositions unreadable'; exit 3; }
    [ "$c" = 0 ] || { echo "SKIP: $NAME is still in the world"; exit 3; }
    local now tgt d
    now=$(date +%s.%N)
    tgt=$(date -u -d "today $T" +%s)
    d=$(awk -v a="$tgt" -v b="$now" 'BEGIN { printf "%.3f", a - b }')
    awk -v d="$d" 'BEGIN { exit !(d > 0 && d < 300) }' || { echo "ABORT: $T is $d s away"; exit 1; }
    if [ "${DRY:-}" = 1 ]; then echo "DRY: would take the slot and start in $d s"; exit 0; fi
    take 6
    flock -u 9
    echo "== slot taken: $(cat $D/$O.json); start in $d s"

    cd "$REPO" || { release; exit 1; }
    echo "== CLI from $REPO at $(git log -1 --format=%h)"
    timeout --kill-after=10s 7m bash -c watch_world >$PP 2>&1 &
    local wp=$!
    sleep "$d"
    local s e rc
    s=$(date -u +%T.%3N)
    timeout --kill-after=30s 5m ~/.bun/bin/bun docs/speedrun/scripts/tickmanip-latency.ts "$BOT" --path=direct --no-tele --json="$JSON" </dev/null >$LOG 2>&1
    rc=$?
    e=$(date -u +%T.%3N)
    kill $wp 2>/dev/null
    wait $wp 2>/dev/null
    take 8
    echo "== CLI start $s end $e UTC, exit $rc"
    grep -v -E '^\[(Runner|BotSDK)\]|Pathfinding|LOGOUT DEBUG' $LOG | cut -c1-400
    echo '== in-world transitions during the read'
    cat $PP

    local t0 i gone=
    t0=$(date +%s)
    for i in $(seq 200); do
        if c=$(present) && [ "$c" = 0 ]; then gone=$(date -u +%T); break; fi
        sleep 3
    done
    if [ -n "$gone" ]; then
        echo "== $NAME out of the world at $gone UTC, $(($(date +%s) - t0)) s after the CLI exit"
    else
        echo "== $NAME STILL in the world 10 min after the CLI exit"
    fi
    release
    echo '== leftover check, after'
    leftover
}
main "$@"
exit
