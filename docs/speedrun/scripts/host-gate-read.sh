#!/usr/bin/env bash
# One run-night gate read on either Ashburn machine (the run host or its twin), as rs-gate-read.timer
# fires it (host-gate/) or by hand.
# Operations: docs/speedrun/research/demo-latency.md, section 10, "Gate history timer".
#
#   bash ~/.local/lib/rs-gate/host-gate-read.sh        (the copy install.sh puts there)
#
# In order, each skip exits 0 and leaves a record:
# 1. Reservation: ~/host-reserved.json {owner, until, reason} with `until` (ISO UTC) in the future
#    means `skip: reserved by <owner>`, unless owner equals $RS_GATE_OWNER, which only the
#    reserving slot sets for its own firing. An unreadable `until` counts as reserved.
# 2. Busy host: ffmpeg, bun, a tmux server that answers (stale sockets do not count), another
#    gate read, or a Chrome with its own profile, an --app URL, --headless or an open TCP
#    connection. An idle default-profile desktop Chrome is reported, not busy. Command lines
#    are never printed: a launch URL may carry a password.
# 3. Pinned code: ~/run-commit holds one full commit of bleugreen/rs-sdk, written only by the
#    runbook's step 0. $GATE_REPO (~/gate/rs-sdk, the timer's own clone) is checked out detached
#    at it, fetching it if needed, with dependencies re-installed only when a lockfile changed.
#    Missing or unresolvable means `skip: no run-commit`.
# 4. The gate (#101): tickmanip-latency.ts --path=direct under `timeout 240`, as
#    bots/$GATE_BOT (default `gate`, an alias directory whose mode-600 bot.env holds the
#    throwaway account). The account name is redacted from everything this script keeps.
#    Just before it, a no-login check of the bot.env server's public /playercount, with Fly's
#    machine (sid) and worker (bn) from the flyio-debug header, recorded under `preLogin`, with
#    the game process's start and uptime from the public page's client.js?v= token (null when
#    the page or token is unreadable; report-only, never a skip).
#    Under $GATE_MIN_PLAYERS (default 300) online, or no answer, means
#    `skip: restart suspected (players N)`: a server refilling after a restart is not a reading
#    of the run's conditions, and a login would only add to its rush.
# 5. ~/gate-history/<UTC>.json: commit, status, verdict, on-time, catch-ups per minute, tick p90,
#    players and Fly edge up front, the gate's own JSON under `gate`. A read that is not `ok`
#    also keeps the last 40 lines of the probe's output under `outputTail` (account name and
#    password redacted), since a Bun crash ends with its version banner, not its error.
#    One summary line goes to stdout (the journal). Exit 0 for skips and every verdict, red
#    included; 1 when the read itself broke (timeout, crash), with its record still written.
set -uo pipefail

repo=${GATE_REPO:-$HOME/gate/rs-sdk}
bot=${GATE_BOT:-gate}
history=${GATE_HISTORY:-$HOME/gate-history}
sentinel=${GATE_SENTINEL:-$HOME/host-reserved.json}
run_commit_file=${GATE_RUN_COMMIT_FILE:-$HOME/run-commit}
bun=${BUN:-$HOME/.bun/bin/bun}
min_players=${GATE_MIN_PLAYERS:-300}
# the unit's hard stop is TimeoutStartSec=270; the probe gets what preparation left of this
budget_end=$((SECONDS + 262))

utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
commit=
pre_players= pre_sid= pre_bn=
pre_start_token= pre_start_utc= pre_uptime_min=
mkdir -p "$history"
record="$history/$(date -u -d "$utc" +%Y-%m-%dT%H%M%SZ).json"
n=1
while [ -e "$record" ]; do n=$((n + 1)); record="$history/$(date -u -d "$utc" +%Y-%m-%dT%H%M%SZ)-$n.json"; done

# write_record STATUS EXIT NOTE [GATE_JSON] [PROBE_OUT]
write_record() {
    local status=$1 code=$2 note=$3 gate=${4:-} out=${5:-} edge= players= tail=
    if [ -n "$out" ] && [ -f "$out" ]; then
        edge=$(sed -n 's/^vantage: edge \([^,]*\),.*/\1/p' "$out" | head -1)
        players=$(sed -n 's/^vantage: .*, \([0-9]*\) online$/\1/p' "$out" | head -1)
        [ "$status" = ok ] || tail=$(grep -v '^[[:space:]]*$' "$out" | tail -40)
    fi
    local gatearg=(--argjson g '[null]')
    [ -n "$gate" ] && [ -s "$gate" ] && jq -e . "$gate" >/dev/null 2>&1 && gatearg=(--slurpfile g "$gate")
    jq -n "${gatearg[@]}" --arg utc "$utc" --arg end "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg host "$(hostname)" --arg commit "$commit" \
        --arg status "$status" --argjson exit "$code" --arg note "$note" --arg edge "$edge" --arg players "$players" \
        --arg tail "$tail" --arg pp "$pre_players" --arg psid "$pre_sid" --arg pbn "$pre_bn" \
        --arg pst "$pre_start_token" --arg psu "$pre_start_utc" --arg pup "$pre_uptime_min" '
        $g[0] as $j |
        def orNull: if . == "" then null else . end;
        {utc: $utc, endUtc: $end, host: $host, commit: (if $commit == "" then null else $commit end), status: $status, exit: $exit,
         note: (if $note == "" then null else $note end),
         on: $j.verdict.on, onTime: $j.result.onTime, trials: $j.result.trials,
         catchUpsPerMinute: $j.result.steadiness.catchUpsPerMinute, tickP90Ms: $j.result.steadiness.p90,
         players: ($j.vantage.players // (if $players == "" then null else ($players | tonumber) end)),
         edge: ($j.vantage.edge // (if $edge == "" then null else $edge end)),
         connectP50Ms: $j.vantage.connectP50, failures: $j.verdict.failures,
         preLogin: (if ($pp + $psid + $pbn + $pst) == "" then null
                    else {players: ($pp | orNull | if . == null then null else tonumber end),
                          flyMachine: ($psid | orNull), flyWorker: ($pbn | orNull),
                          serverStartUtc: ($psu | orNull), serverStartToken: ($pst | orNull),
                          serverUptimeMin: ($pup | orNull | if . == null then null else tonumber end)} end),
         gate: $j}
        + (if $tail == "" then {} else {outputTail: ($tail | split("\n"))} end)' > "$record.tmp" && mv "$record.tmp" "$record"
}
# server_start PAGE: the page imports client.js?v=<token>, Date.now().toString(36) taken once at
# the game process's start (server/engine/src/web/pages/client.ts). Sets pre_start_token,
# pre_start_utc (ms) and pre_uptime_min (to $utc, one decimal) together, or leaves all three empty.
server_start() {
    local tok ms s d t sign=
    tok=$(grep -aoE 'client\.js\?v=[0-9a-z]{6,12}([^0-9a-z]|$)' "$1" 2>/dev/null | head -1 |
        sed -E 's/^client\.js\?v=([0-9a-z]+).*$/\1/')
    [[ $tok =~ ^[0-9a-z]{6,12}$ ]] || return 0
    ms=$((36#$tok))
    s=$(date -u -d "@$((ms / 1000))" +%Y-%m-%dT%H:%M:%S 2>/dev/null) && [[ $s =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]] || return 0
    d=$(( $(date -u -d "$utc" +%s) * 1000 - ms ))
    [ "$d" -lt 0 ] && { sign=-; d=$((-d)); }
    t=$(( (d + 3000) / 6000 ))
    [ "$t" -eq 0 ] && sign=
    pre_start_token=$tok
    pre_start_utc=$(printf '%s.%03dZ' "$s" $((ms % 1000)))
    pre_uptime_min="$sign$((t / 10)).$((t % 10))"
}
skip() {
    echo "skip: $1"
    write_record skip 0 "$1"
    exit 0
}

# 1. reservation
if [ -e "$sentinel" ]; then
    owner=$(jq -r '.owner // "unknown"' "$sentinel" 2>/dev/null || echo unknown)
    until_iso=$(jq -r '.until // empty' "$sentinel" 2>/dev/null || true)
    until_s=$(date -u -d "$until_iso" +%s 2>/dev/null || true)
    if [ -z "$until_s" ]; then
        skip "reserved by $owner (no readable until in $sentinel)"
    elif [ "$until_s" -gt "$(date +%s)" ]; then
        if [ -n "${RS_GATE_OWNER:-}" ] && [ "$owner" = "$RS_GATE_OWNER" ]; then
            echo "reserved by $owner until $until_iso: this is $owner's own firing, reading"
        else
            skip "reserved by $owner until $until_iso"
        fi
    fi
fi

# 2. busy host
exec 9>"$history/.lock"
flock -n 9 || skip "busy: another gate read is running"
busy=()
notes=()
pgrep -x ffmpeg >/dev/null && busy+=("ffmpeg ($(pgrep -x ffmpeg | wc -l))")
pgrep -x bun >/dev/null && busy+=("bun ($(pgrep -x bun | wc -l))")
for s in /tmp/tmux-"$(id -u)"/*; do
    [ -S "$s" ] && tmux -S "$s" ls >/dev/null 2>&1 && busy+=("tmux server ${s##*/}")
done
chrome_re='chrome|chromium|chromium-browse|headless_shell'
chrome_pids=$(pgrep -d'|' -x "$chrome_re" || true)
if [ -n "$chrome_pids" ]; then
    if ss -Htnp state established 2>/dev/null | grep -qE "pid=($chrome_pids),"; then
        busy+=("chrome with open TCP connections")
    fi
    for pid in $(pgrep -x "$chrome_re"); do
        args=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null) || continue
        case "$args" in *--type=*) continue ;; esac
        case "$args" in
            *--user-data-dir=*|*--app=*|*--headless*) busy+=("chrome pid $pid (own profile, app or headless)") ;;
            *) notes+=("idle desktop chrome pid $pid") ;;
        esac
    done
fi
[ ${#notes[@]} -gt 0 ] && echo "preflight note: ${notes[*]}"
[ ${#busy[@]} -gt 0 ] && skip "busy: $(IFS=';'; echo "${busy[*]}")"

# 3. pinned code
want=$(tr -d ' \t\r\n' 2>/dev/null < "$run_commit_file" || true)
[[ $want =~ ^[0-9a-f]{40}$ ]] || skip "no run-commit (${run_commit_file} missing or not a 40-hex commit)"
commit=$want
[ -d "$repo/.git" ] || skip "no run-commit checkout: $repo is not a clone"
if [ "$(git -C "$repo" rev-parse HEAD 2>/dev/null)" != "$want" ]; then
    if ! git -C "$repo" cat-file -e "$want^{commit}" 2>/dev/null; then
        timeout 60 git -C "$repo" fetch -q origin "$want" 2>/dev/null || skip "no run-commit: cannot fetch $want"
    fi
    git -C "$repo" -c advice.detachedHead=false checkout -q --force --detach "$want" 2>/dev/null ||
        skip "no run-commit: checkout of $want failed"
    echo "checked out run-commit $want"
fi
stamp_file="$repo/.git/rs-gate-deps"
locks=$(cd "$repo" && cat bun.lock server/webclient/bun.lock 2>/dev/null | sha256sum | cut -c1-64)
if [ "$locks" != "$(cat "$stamp_file" 2>/dev/null)" ] || [ ! -d "$repo/node_modules" ] || [ ! -d "$repo/server/webclient/node_modules" ]; then
    (cd "$repo" && timeout 90 "$bun" install --frozen-lockfile >/dev/null 2>&1 &&
        cd server/webclient && timeout 90 "$bun" install --frozen-lockfile >/dev/null 2>&1) ||
        skip "no run-commit: bun install failed at $want"
    echo "$locks" > "$stamp_file"
    echo "installed dependencies for $want"
fi

# 4. the gate
env_file="$repo/bots/$bot/bot.env"
[ -r "$env_file" ] || { echo "error: no $env_file"; write_record error 1 "no bots/$bot/bot.env"; exit 1; }
account=$(sed -n 's/^BOT_USERNAME=//p' "$env_file" | tr -d '\r')
password=$(sed -n 's/^PASSWORD=//p' "$env_file" | tr -d '\r')
server=$(sed -n 's/^SERVER=//p' "$env_file" | tr -d '\r')
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
case "$server" in
    ""|localhost*|127.*) ;;
    *)
        curl -s --max-time 8 -H 'flyio-debug: doit' -D "$tmp/pc.h" -o "$tmp/pc.json" "https://$server/playercount" || true
        pre_players=$(jq -r '.count // empty' "$tmp/pc.json" 2>/dev/null | grep -E '^[0-9]+$' || true)
        fly=$(sed -n 's/^flyio-debug:[[:space:]]*//Ip' "$tmp/pc.h" 2>/dev/null | tr -d '\r' | head -1)
        pre_sid=$(jq -r '.sid // empty' <<<"$fly" 2>/dev/null || true)
        pre_bn=$(jq -r '.bn // empty' <<<"$fly" 2>/dev/null || true)
        curl -s --max-time 8 -o "$tmp/page.html" "https://$server/" || true
        server_start "$tmp/page.html"
        echo "pre-login: ${pre_players:-?} online, fly machine ${pre_sid:-?}"
        if [ -z "$pre_players" ]; then
            skip "restart suspected (playercount unavailable)"
        elif [ "$pre_players" -lt "$min_players" ]; then
            skip "restart suspected (players $pre_players)"
        fi ;;
esac
left=$((budget_end - SECONDS))
[ "$left" -lt 200 ] && skip "preparing $want took too long (${left}s left for the probe); next firing reads"
limit=$(( left < 240 ? left : 240 ))
(cd "$repo" && timeout --kill-after=10 "$limit" "$bun" docs/speedrun/scripts/tickmanip-latency.ts "$bot" \
    --path=direct --no-tele --json="$tmp/gate.json") > "$tmp/out.txt" 2>&1
code=$?
# literal (not regex) replacement, so neither value needs escaping
redact() { # FILE VALUE LABEL
    [ -n "$2" ] && [ -f "$1" ] || return 0
    V="$2" L="$3" perl -pi -e 's/\Q$ENV{V}\E/$ENV{L}/g' "$1"
}
for f in "$tmp/out.txt" "$tmp/gate.json"; do
    redact "$f" "$password" '<gate password>'
    redact "$f" "$account" '<gate account>'
done
gateline=$(grep -m1 '^gate (direct):' "$tmp/out.txt" || true)

# 5. the record
case $code in
    0|1) if [ -s "$tmp/gate.json" ]; then status=ok; else status=error; fi ;;
    2) status=not-probed ;;
    124|137) status=timeout ;;
    *) status=error ;;
esac
note=$gateline
# a Bun crash prints its error first and its version banner last, so prefer the first error line
lastline() { grep -v -e '^[[:space:]]*$' -e '^Bun v[0-9]' "$tmp/out.txt" | tail -1; }
errline() { grep -v '^Bun v[0-9]' "$tmp/out.txt" | grep -m1 -iE 'error|panic|exception|refused|timed? ?out' || true; }
[ "$status" = ok ] || note="${gateline:-$(errline)}"
[ "$status" = ok ] || [ -n "$note" ] || note=$(lastline)
write_record "$status" "$code" "$note" "$tmp/gate.json" "$tmp/out.txt"
jq -r '"gate \(.utc) status=\(.status) on=\(.on) onTime=\(.onTime)/\(.trials) catchups/min=\(.catchUpsPerMinute) p90=\(.tickP90Ms) players=\(.players) edge=\(.edge) commit=\(.commit[0:9]) -> '"$record"'"' "$record"
if [ "$status" != ok ]; then
    echo "$status (exit $code): $note"
    [ "$status" = not-probed ] || exit 1
fi
exit 0
