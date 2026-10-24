#!/usr/bin/env bash
# Same-second --react-delay sweep on the run host and the twin (demo-latency.md section 3): the
# margin after a frame read from both Ashburn machines in the same minute, so a difference between
# them is the machine's own upstream path and not the demo's minute.
#
#   ashburn-pair-sweep.sh prep            fresh clone of main into ~/rs83 on both, deps, credentials
#   ashburn-pair-sweep.sh start [DELAYS]  both probes start on the same wall-clock second
#   ashburn-pair-sweep.sh status          last lines of both logs
#   ashburn-pair-sweep.sh fetch DIR       copy both JSON files and logs to DIR (off-repo; scrub first)
#
# Runs from the operator's Mac (Cairn executor `local`), which holds the keys and the address files in
# ~/.rs-fleet; addresses are read there and never printed. Each machine logs in ONE throwaway account
# (run host cairn_r83rh, twin cairn_r83tw, minted here and auto-registered on first login). It touches
# nothing but ~/rs83: not ~/rs-sdk, its worktrees, the gate timers or their account. Ask host first.
set -euo pipefail

F="$HOME/.rs-fleet"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes)
rh() { ssh "${SSH_OPTS[@]}" -i "$F/id_ed25519_ashburn" -o UserKnownHostsFile="$F/known_hosts_ashburn" "${RS_RUN_USER:-ubuntu}@$(cat "$F/ashburn-ip")" "$@"; }
tw() { ssh "${SSH_OPTS[@]}" -i "$F/id_ed25519_rehearsal" -o UserKnownHostsFile="$F/known_hosts_rehearsal" "${RS_TWIN_USER:-ubuntu}@$(cat "$F/twin-ip")" "$@"; }

[ -f "$F/id_ed25519_ashburn" ] && [ -f "$F/id_ed25519_rehearsal" ] || { echo "no fleet keys on $(uname -n); run from executor local" >&2; exit 2; }

# Clone (once; https, else the ssh URL), detach at origin/main, install deps without a rebuild, and
# mint a throwaway password for $1 if it has none.
REPO_SLUG=bleugreen/rs-sdk
prep_remote='set -euo pipefail
bot=$1; slug=$2
echo "host $(uname -n) $(date -u +%FT%TZ)"
if [ ! -d ~/rs83/.git ]; then
  git clone --quiet --branch main "https://github.com/$slug.git" ~/rs83 2>/dev/null || git clone --quiet --branch main "git@github.com:$slug.git" ~/rs83
fi
cd ~/rs83
git fetch --quiet origin main && git checkout --quiet --detach origin/main
echo "commit $(git rev-parse HEAD)"
bun install --frozen-lockfile >/dev/null 2>&1 && (cd server/webclient && bun install --frozen-lockfile >/dev/null 2>&1) && echo "deps ok"
mkdir -p "bots/$bot" out
if [ ! -f "bots/$bot/bot.env" ]; then
  printf "BOT_USERNAME=%s\nPASSWORD=%s\n" "$bot" "$(openssl rand -hex 8)" > "bots/$bot/bot.env"
  chmod 600 "bots/$bot/bot.env"
fi
grep -q "^BOT_USERNAME=$bot$" "bots/$bot/bot.env" && echo "credentials ok ($bot)"
chronyc tracking 2>/dev/null | grep -E "System time|Leap" || timedatectl show -p NTPSynchronized'

# $1 label, $2 bot, $3 start epoch, $4 delays. Detached, so the ssh session can end.
start_remote='set -euo pipefail
label=$1; bot=$2; at=$3; delays=$4
cd ~/rs83
nohup bash -c "sleep \$(( $at - \$(date +%s) )); SPEEDRUN_TICK_MS=400 timeout 900 bun docs/speedrun/scripts/demo-latency-probe.ts --label=$label --bot=$bot --phases=react --trials=10 --react-delay=$delays --out=out/sweep-$label.json" > "out/sweep-$label.log" 2>&1 < /dev/null &
echo "$(uname -n): $label armed for $(date -u -d @$at +%TZ)"'

case "${1:-}" in
  prep)
    rh bash -s -- cairn_r83rh "$REPO_SLUG" <<<"$prep_remote" &
    tw bash -s -- cairn_r83tw "$REPO_SLUG" <<<"$prep_remote" &
    wait ;;
  start)
    delays="${2:-0,50,100,150,200,250,300,300,250,200,150,100,50,0}"
    at=$(( ($(date +%s) / 60 + 1) * 60 )); [ $(( at - $(date +%s) )) -lt 25 ] && at=$(( at + 60 ))
    rh bash -s -- rh-pair cairn_r83rh "$at" "$delays" <<<"$start_remote"
    tw bash -s -- tw-pair cairn_r83tw "$at" "$delays" <<<"$start_remote"
    echo "both start at $(date -u -r "$at" +%TZ)" ;;
  status)
    echo "--- run host"; rh 'tail -n 4 ~/rs83/out/sweep-rh-pair.log; pgrep -f demo-latency-probe >/dev/null && echo running || echo done'
    echo "--- twin"; tw 'tail -n 4 ~/rs83/out/sweep-tw-pair.log; pgrep -f demo-latency-probe >/dev/null && echo running || echo done' ;;
  fetch)
    dir="${2:?fetch DIR}"; mkdir -p "$dir"
    rh 'cat ~/rs83/out/sweep-rh-pair.json' > "$dir/rh-pair.json"; rh 'cat ~/rs83/out/sweep-rh-pair.log' > "$dir/rh-pair.log"
    tw 'cat ~/rs83/out/sweep-tw-pair.json' > "$dir/tw-pair.json"; tw 'cat ~/rs83/out/sweep-tw-pair.log' > "$dir/tw-pair.log"
    ls -la "$dir" ;;
  *) sed -n '2,14p' "$0"; exit 2 ;;
esac
