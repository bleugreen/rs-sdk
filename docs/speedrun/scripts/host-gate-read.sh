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
#    the game process's start and uptime from the public page's client.js?v= token, and an engine
#    fingerprint: the hiscores Time hover's template, a hash of the hiscores page's static chrome,
#    a hash of /playercount's shape and the md5 of the served bot client. Each of these is null
#    when its fetch or parse fails; report-only, never a skip. All fetches run side by side.
#    Alongside them, host-gate-feed.ts (beside this script) opens the engine's login-free world
#    feed: its first $GATE_FEED_SECONDS (default and most 60) give the configured tick length and
#    the engine's own tick intervals, also under `preLogin`. Those seconds are the check's longest
#    part, and the budget below holds 75 s for them on top of the probe's own. The feed then stays
#    open beside the probe, logging every tick, and is stopped when the probe exits.
#    Under $GATE_MIN_PLAYERS (default 300) online, or no answer, means
#    `skip: restart suspected (players N)`: a server refilling after a restart is not a reading
#    of the run's conditions, and a login would only add to its rush.
# 5. ~/gate-history/<UTC>.json: commit, status, verdict, T (the tick length: the feed's configured
#    value, else the gate's tick p50 rounded), on-time, catch-ups per minute, tick p50 and p90,
#    players and Fly edge up front, the gate's own JSON under `gate`. A read that is not `ok`
#    also keeps the last 40 lines of the probe's output under `outputTail` (account name and
#    password redacted), since a Bun crash ends with its version banner, not its error.
#    `pathCheck` (host-gate-feed.ts --pathcheck) sets the probe's tick arrivals against the feed's
#    copy of the same ticks and labels each late or catch-up tick the server's or the path's; the
#    feed's ticks are kept compact under `feedLog`, after `gate`. Report-only: null when it cannot
#    be made, and never a skip or a change to status or verdict.
#    `earlyTicks` (host-gate-feed.ts --earlyticks, on the record just written) counts the probe's
#    tick intervals under 0.75 T, per minute, beside (b)'s p90: the short ticks after an overrun
#    that (c)'s T/2 does not count. Report-only as well; null on skips and on reads not `ok`.
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
feed_seconds=${GATE_FEED_SECONDS:-60}
[[ $feed_seconds =~ ^[1-9][0-9]?$ ]] && [ "$feed_seconds" -le 60 ] || feed_seconds=60
feed_helper="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/host-gate-feed.ts"
# the unit's hard stop is TimeoutStartSec=345; the probe gets what preparation left of this, after
# the pre-login check's 75 s (the feed read under its own `timeout`)
budget_end=$((SECONDS + 262 + 75))

utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
commit=
pre_players= pre_sid= pre_bn=
pre_start_token= pre_start_utc= pre_uptime_min=
pre_hover= pre_chrome= pre_pc_shape= pre_bundle_md5=
pre_feed=
feed_pid= pathcheck_out=
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
    local gatearg=(--argjson g '[null]') pcarg=(--argjson pc '[null]')
    [ -n "$gate" ] && [ -s "$gate" ] && jq -e . "$gate" >/dev/null 2>&1 && gatearg=(--slurpfile g "$gate")
    [ -n "$pathcheck_out" ] && jq -e 'type == "object"' "$pathcheck_out" >/dev/null 2>&1 && pcarg=(--slurpfile pc "$pathcheck_out")
    jq -n "${gatearg[@]}" "${pcarg[@]}" --arg utc "$utc" --arg end "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg host "$(hostname)" --arg commit "$commit" \
        --arg status "$status" --argjson exit "$code" --arg note "$note" --arg edge "$edge" --arg players "$players" \
        --arg tail "$tail" --arg pp "$pre_players" --arg psid "$pre_sid" --arg pbn "$pre_bn" \
        --arg pst "$pre_start_token" --arg psu "$pre_start_utc" --arg pup "$pre_uptime_min" \
        --arg phh "$pre_hover" --arg phc "$pre_chrome" --arg pps "$pre_pc_shape" --arg pbm "$pre_bundle_md5" \
        --arg pfeed "$pre_feed" '
        $g[0] as $j | ($pc[0] // {}) as $p |
        def orNull: if . == "" then null else . end;
        def num: if type == "number" then . else null end;
        ($pfeed | if . == "" then {} else (try fromjson catch {}) end | if type == "object" then . else {} end) as $f |
        # the p50 of tickSteadiness (speedrun/lib/hostgate-verdict.ts), else its nearest rank over the arrivals
        def p50ms: ($j.result.steadiness // {}) as $s |
            if ($s.p50 | type) == "number" and ($s.n // 1) > 0 then $s.p50
            else ([($j.result.tickArrivalsMs // []) as $a | range(1; $a | length) | $a[.] - $a[. - 1]] | sort) as $iv |
                if ($iv | length) == 0 then null
                else ($iv[[($iv | length) - 1, (($iv | length) * 0.5 | floor)] | min] * 10 + 0.5 | floor) / 10 end end;
        {utc: $utc, endUtc: $end, host: $host, commit: (if $commit == "" then null else $commit end), status: $status, exit: $exit,
         note: (if $note == "" then null else $note end),
         T: (($f.tickMsConfigured | num) // (p50ms | if . == null then null else (. + 0.5 | floor) end)),
         on: $j.verdict.on, onTime: $j.result.onTime, trials: $j.result.trials,
         catchUpsPerMinute: $j.result.steadiness.catchUpsPerMinute, tickP50Ms: p50ms, tickP90Ms: $j.result.steadiness.p90,
         earlyTicks: null,
         players: ($j.vantage.players // (if $players == "" then null else ($players | tonumber) end)),
         edge: ($j.vantage.edge // (if $edge == "" then null else $edge end)),
         connectP50Ms: $j.vantage.connectP50, failures: $j.verdict.failures,
         pathCheck: ($p.pathCheck | if type == "object" then . else null end),
         preLogin: (if ($pp + $psid + $pbn + $pst + $phh + $phc + $pps + $pbm + $pfeed) == "" then null
                    else {players: ($pp | orNull | if . == null then null else tonumber end),
                          flyMachine: ($psid | orNull), flyWorker: ($pbn | orNull),
                          serverStartUtc: ($psu | orNull), serverStartToken: ($pst | orNull),
                          serverUptimeMin: ($pup | orNull | if . == null then null else tonumber end),
                          feedTick: ($f.feedTick | num),
                          feedTickMs: ($f.feedTickMs | if type == "object" then {n, p50, p90, max, min} | map_values(num) else null end),
                          feedTickGaps: ($f.feedTickGaps | num),
                          tickMsConfigured: ($f.tickMsConfigured | num),
                          hiscoreHover: ($phh | orNull), hiscoreChromeSha: ($phc | orNull),
                          playercountShape: ($pps | orNull), botBundleMd5: ($pbm | orNull)} end),
         gate: $j,
         feedLog: ($p.feedLog | if type == "object" then . else null end)}
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
# Engine fingerprint. A digit run, with its thousands and decimal separators, becomes N, so
# "201,117 seconds" and "10,774.8 seconds" read alike; sha16 is the first 16 hex of a sha256.
digits_to_n() { perl -0777 -pe 's/[0-9]+(?:[,.][0-9]+)*/N/g'; }
sha16() { sha256sum | cut -c1-16; }
# hiscore_marks PAGE (/hiscores, server-rendered by the engine): sets pre_hover, the first
# title="..." holding a digit (the Time hover) as a template, and pre_chrome, a hash of the page
# with the text of every innermost table cell and every player link's href emptied. Tags and
# attributes stay, so the hover's wording counts while names, ranks, levels and times do not.
hiscore_marks() {
    local h
    grep -qai '</html>' "$1" 2>/dev/null || return 0
    h=$(grep -aoE 'title="[^"]*[0-9][^"]*"' "$1" | head -1 | sed -E 's/^title="(.*)"$/\1/' | digits_to_n)
    [[ $h =~ ^[[:print:]]{1,80}$ ]] && pre_hover=$h
    pre_chrome=$(perl -0777 -pe '
        s{(href="/hi(?:gh)?scores/player/)[^"]*"}{$1"}gi;
        s{(<td\b[^>]*>)((?:(?!<td\b|</td>).)*)(</td>)}{my ($o, $b, $c) = ($1, $2, $3); $b =~ s/(^|>)[^<]+/$1/g; "$o$b$c"}gsie;
        s/[0-9]+(?:[,.][0-9]+)*/N/g;
        s/\s+/ /g;' "$1" | sha16)
}
# playercount_shape BODY: the /playercount body's shape, each scalar's path and type for JSON,
# else the body with its digits as N.
playercount_shape() {
    [ -s "$1" ] || return 0
    if jq empty "$1" >/dev/null 2>&1; then
        pre_pc_shape=$(jq -c '[path(..) as $p | (getpath($p) | type) as $t
            | select($t != "object" and $t != "array") | [$p, $t]] | sort' "$1" | sha16)
    else
        pre_pc_shape=$(digits_to_n < "$1" | sha16)
    fi
}
# stop_feed: ends the world-feed helper (it closes its socket on SIGTERM); its log is on disk already
stop_feed() {
    [ -n "$feed_pid" ] || return 0
    kill -TERM "$feed_pid" 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
        kill -0 "$feed_pid" 2>/dev/null || break
        sleep 0.1
    done
    kill -KILL "$feed_pid" 2>/dev/null
    wait "$feed_pid" 2>/dev/null
    feed_pid=
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
trap 'stop_feed; rm -rf "$tmp"' EXIT
case "$server" in
    ""|localhost*|127.*) ;;
    *)
        # side by side, so the check waits no longer than the feed's first $feed_seconds; the
        # helper (exec'd, so $! is the process stop_feed signals) stays open through the probe
        feed_deadline=$((SECONDS + feed_seconds + 15))
        (cd "$tmp" && exec timeout $((budget_end + 10 - SECONDS)) "$bun" "$feed_helper" "$server" \
            --seconds="$feed_seconds" --log="$tmp/feed.log") > "$tmp/feed.out" 2>/dev/null &
        feed_pid=$!
        curl -s --max-time 8 -H 'flyio-debug: doit' -D "$tmp/pc.h" -o "$tmp/pc.json" "https://$server/playercount" &
        pc_pid=$!
        curl -s -f --max-time 8 -o "$tmp/hiscores.html" "https://$server/hiscores" &
        hs_pid=$!
        curl -s --max-time 8 -o "$tmp/page.html" "https://$server/" || true
        server_start "$tmp/page.html"
        if [ -n "$pre_start_token" ] &&
            curl -s -f --max-time 8 -o "$tmp/bot.js" "https://$server/bot/client.js?v=$pre_start_token"; then
            pre_bundle_md5=$(md5sum < "$tmp/bot.js" | cut -c1-32)
            [[ $pre_bundle_md5 =~ ^[0-9a-f]{32}$ ]] && [ -s "$tmp/bot.js" ] || pre_bundle_md5=
        fi
        wait "$pc_pid" "$hs_pid"
        while [ "$SECONDS" -lt "$feed_deadline" ] && kill -0 "$feed_pid" 2>/dev/null &&
            ! jq -e 'type == "object"' "$tmp/feed.out" >/dev/null 2>&1; do
            sleep 0.2
        done
        pre_feed=$(jq -c 'select(type == "object")' "$tmp/feed.out" 2>/dev/null | head -1)
        playercount_shape "$tmp/pc.json"
        hiscore_marks "$tmp/hiscores.html"
        pre_players=$(jq -r '.count // empty' "$tmp/pc.json" 2>/dev/null | grep -E '^[0-9]+$' || true)
        fly=$(sed -n 's/^flyio-debug:[[:space:]]*//Ip' "$tmp/pc.h" 2>/dev/null | tr -d '\r' | head -1)
        pre_sid=$(jq -r '.sid // empty' <<<"$fly" 2>/dev/null || true)
        pre_bn=$(jq -r '.bn // empty' <<<"$fly" 2>/dev/null || true)
        echo "pre-login: ${pre_players:-?} online, fly machine ${pre_sid:-?}," \
            "$(jq -r '"tick \(.tickMsConfigured // "?") ms, feed p50 \(.feedTickMs.p50 // "?") ms"' <<<"${pre_feed:-null}" 2>/dev/null)"
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

# the path check, report-only: the probe prints its end time as its last tick arrives, which puts
# its relative tick arrivals on the feed log's clock; it runs only in what the budget has left
stop_feed
if [ -s "$tmp/feed.log" ] && [ $((budget_end + 5 - SECONDS)) -ge 2 ]; then
    probe_end=$(sed -n 's/^probe (direct) from .* at \([0-9][0-9T:.-]*Z\), server .*$/\1/p' "$tmp/out.txt" | head -1)
    tick_conf=$(jq -r '.tickMsConfigured // empty' <<<"${pre_feed:-null}" 2>/dev/null || true)
    (cd "$tmp" && timeout $(( budget_end + 5 - SECONDS < 10 ? budget_end + 5 - SECONDS : 10 )) "$bun" "$feed_helper" --pathcheck \
        "$tmp/feed.log" "$tmp/gate.json" "${probe_end:-none}" ${tick_conf:+--tick-ms="$tick_conf"}) \
        > "$tmp/pathcheck.json" 2>/dev/null && pathcheck_out=$tmp/pathcheck.json
fi

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
# early ticks, report-only: from the written record's T and arrivals, filled in place (the record
# already stands with null, so a kill here loses only this field), in what the budget has left
if [ "$status" = ok ] && [ $((budget_end + 7 - SECONDS)) -ge 1 ]; then
    early=$(timeout $(( budget_end + 7 - SECONDS < 5 ? budget_end + 7 - SECONDS : 5 )) "$bun" "$feed_helper" --earlyticks "$record" 2>/dev/null) &&
        jq -e 'type == "object"' <<<"$early" >/dev/null 2>&1 &&
        jq --argjson e "$early" '.earlyTicks = $e' "$record" > "$record.tmp" && mv "$record.tmp" "$record"
    rm -f "$record.tmp"
fi
jq -r '(.pathCheck | if . == null then "null" else
        "slow:\(.serverSlow),catchup:\(.serverCatchUp),held:\(.pathHeld),unmatched:\(.unmatched),offset:\(.offsetMs)ms,spread:\(.offsetSpreadMs)ms,matched:\(.ticksMatched)" end) as $pc |
    (.earlyTicks | if type == "object" then "\(.perMinute)/min" else "null" end) as $early |
    "gate \(.utc) status=\(.status) on=\(.on) onTime=\(.onTime)/\(.trials) catchups/min=\(.catchUpsPerMinute) p90=\(.tickP90Ms) early=\($early) players=\(.players) edge=\(.edge) path=\($pc) commit=\(.commit[0:9]) -> '"$record"'"' "$record"
if [ "$status" != ok ]; then
    echo "$status (exit $code): $note"
    [ "$status" = not-probed ] || exit 1
fi
exit 0
