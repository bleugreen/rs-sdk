#!/usr/bin/env bash
# Browser-row session on the Ashburn run machine (rs/130, then rs/176): the demo-latency-probe.yml
# browser mode, run by hand. Usage: [OWNER=rs/N] session.sh overlay|in-page|in-page-oak
# (one session at a time; nothing left running). in-page-oak needs a page at main c14428fc or later:
# it stamps every log from knife-cycle's status.marks.successes (rs/159).
set -uo pipefail
export PATH=$HOME/.bun/bin:$PATH PUPPETEER_SKIP_DOWNLOAD=true
VARIANT=${1:?overlay or in-page}
OWNER=${OWNER:-rs/130}
export DEMO=rs-sdk-demo.fly.dev TRIALS=60 VARIANT
# A host slot is 10 min: the session stops itself at BUDGET s. Knife rolls: in-page 60 (about 2 min);
# overlay 30 logs (about 14 ticks each). The plain control runs PLAIN_ROLLS logs or until the budget ends.
BUDGET=${BUDGET:-570}; T0=$(date +%s)
case "$VARIANT" in in-page) CYCLES=${CYCLES:-60} ;; *) CYCLES=${CYCLES:-30} ;; esac
export CYCLES PLAIN_ROLLS=${PLAIN_ROLLS:-20}
left() { echo $(( BUDGET - ($(date +%s) - T0) )); }
export GATEWAY_PORT=7861 PAGE_PORT=8909 MGMT_PORT=8963
export BROWSER_DIR=$HOME/rs130/browser CHROME_PATH=/usr/bin/google-chrome
export OUT=$HOME/rs130/out/$(date -u +%Y%m%dT%H%M)-$VARIANT
set -a; . $HOME/rs130/account.env; set +a
export BOT BOT_USERNAME=$BOT
cd $HOME/rs130/probe
# Host reservation (rs/83, 12:33): rs/140's gate timer skips while this file names a future 'until'.
RES=$HOME/host-reserved.json
if [ -f "$RES" ] && [ "$(jq -r .owner "$RES" 2>/dev/null)" != "$OWNER" ] && [ "$(date -u -d "$(jq -r .until "$RES")" +%s 2>/dev/null || echo 0)" -gt "$(date -u +%s)" ]; then echo "RESERVED, not starting:"; cat "$RES"; exit 3; fi
jq -n --arg until "$(date -u -d "@$(( $(date +%s) + 600 ))" +%FT%TZ)" --arg v "$VARIANT" --arg o "$OWNER" '{owner: $o, until: $until, reason: ($o + " browser-row session, " + $v + ", hard stop 595 s")}' > "$RES"
trap 'rm -f "$RES"' EXIT
trap 'exit 143' TERM
mkdir -p "$OUT/page" "$OUT/knife"

# Refuse to share the machine: another probe, client or rs/96's tmux session.
echo "== preflight $(TZ=America/Los_Angeles date '+%T %Z')"; pgrep -a chrome; pgrep -a ffmpeg; pgrep -a bun; echo '== end preflight'
busy=$(pgrep -fa 'demo-latency-probe|tickmanip-|demo-browser-page|lite/runner|hostgate|gateway.ts|proxy.ts' | grep -v "$$" | grep -v pgrep || true)
if [ -n "$busy" ] || pgrep chrome >/dev/null || pgrep ffmpeg >/dev/null || tmux -L rs96 ls >/dev/null 2>&1 || tmux -L rs134 ls >/dev/null 2>&1; then echo "BUSY, not starting:"; echo "$busy"; tmux -L rs96 ls 2>&1; exit 3; fi
for p in $GATEWAY_PORT $PAGE_PORT $MGMT_PORT; do ss -ltn | grep -q ":$p " && { echo "port $p in use"; exit 3; }; done

# Vantage, as the workflow records it.
path="/latency-probe-nonexistent-$(date +%s)"
curl -s -o /dev/null -D "$OUT/flyio-headers.txt" -H 'flyio-debug: doit' "https://$DEMO$path"
grep -i '^flyio-debug:' "$OUT/flyio-headers.txt" | cut -d' ' -f2- | tr -d '\r' | jq . > "$OUT/flyio-debug.json" || echo '{}' > "$OUT/flyio-debug.json"
for i in $(seq 10); do curl -s -o /dev/null -w '%{time_connect} %{time_appconnect} %{time_starttransfer}\n' "https://$DEMO$path"; sleep 0.3; done > "$OUT/http-timing.txt"
pct() { awk -v c="$1" '{print $c * 1000}' "$OUT/http-timing.txt" | sort -n | awk -v p="$2" '{a[NR]=$1} END {i=int(p*NR); if (i<1) i=1; if (i>NR) i=NR; printf "%.1f", a[i]}'; }
players=$(curl -s --max-time 5 "https://$DEMO/playercount" | jq -r '.count // ""' 2>/dev/null || echo '')
jq -n --arg pdt "$(TZ=America/Los_Angeles date '+%Y-%m-%d %H:%M %Z')" --argjson fly "$(cat "$OUT/flyio-debug.json")" --arg players "$players" \
  --arg tcp50 "$(pct 1 0.5)" --arg tcp90 "$(pct 1 0.9)" --arg tls50 "$(pct 2 0.5)" --arg ttfb50 "$(pct 3 0.5)" \
  '{time_pdt: $pdt, host: "Ashburn run machine (AWS us-east-1c, c7i.2xlarge)", edge_region: $fly.nr, app_region: $fly.sr, app_dc: $fly.sdc, mrtt_ms: $fly.mrtt,
    players_online: ($players|tonumber? // null), http_ms: {tcp_connect: {p50: ($tcp50|tonumber), p90: ($tcp90|tonumber)}, tls_done_p50: ($tls50|tonumber), ttfb_404_p50: ($ttfb50|tonumber)}, flyio_debug: $fly}' > "$OUT/vantage.json"
cat "$OUT/vantage.json"

run_probe() {
  echo "probe start $(TZ=America/Los_Angeles date '+%F %T %Z'): $2" | tee "$OUT/$1.txt"
  local rc=0 t0; t0=$(date +%s%3N)
  timeout "${3:-1200}" bash -c "$2" > "$OUT/$1-full.log" 2>&1 || rc=$?
  echo "$1 $t0 $(date +%s%3N)" >> "$OUT/marks.tsv"
  grep -vE 'Pathfinding|\[Runner\]|\[BotSDK\]|LOGOUT DEBUG|^chop:' "$OUT/$1-full.log" >> "$OUT/$1.txt" || true
  echo "probe end $(TZ=America/Los_Angeles date '+%F %T %Z'), exit $rc" | tee -a "$OUT/$1.txt"
  return $rc
}
write_bot_env() { mkdir -p "bots/$BOT"; ( umask 077; printf 'BOT_USERNAME=%s\nPASSWORD=%s\nSERVER=%s\nSHOW_CHAT=false\nTELEMETRY=false\nGATEWAY_URL=ws://127.0.0.1:%s\n' "$BOT" "$PASSWORD" "$DEMO" "$GATEWAY_PORT" > "bots/$BOT/bot.env" ); }
export -f run_probe

direct_path() {
  local rc=0
  for attempt in 1 2 3 4; do
    rc=0; run_probe direct 'bun docs/speedrun/scripts/demo-latency-probe.ts --label=ashburn-host --out=$OUT/direct.json --phases=react --trials=$TRIALS --react-delay=0' || rc=$?
    grep -q 'Account already logged in' "$OUT/direct-full.log" || return $rc
    echo "direct: account still logged in (attempt $attempt), retrying in 45 s"; sleep 45
  done; return $rc
}
browser_path() {
  write_bot_env
  (cd "$BROWSER_DIR/server/gateway" && AGENT_PORT=$GATEWAY_PORT GATEWAY_HOSTNAME=127.0.0.1 WEB_MANAGEMENT_PORT=$MGMT_PORT exec bun run gateway.ts) > "$OUT/gateway.log" 2>&1 &
  GW=$!
  (cd "$BROWSER_DIR/server/webclient" && exec bun run proxy.ts --world="https://$DEMO" --port="$PAGE_PORT" --gateway="ws://127.0.0.1:$GATEWAY_PORT") > "$OUT/page-server.log" 2>&1 &
  PS=$!
  sleep 2
  bun --no-install docs/speedrun/scripts/demo-browser-page.ts open --dir="$OUT/page" --url="http://127.0.0.1:$PAGE_PORT/bot?bot=$BOT" \
    --chrome="$CHROME_PATH" --gateway-port="$GATEWAY_PORT" > "$OUT/page-driver.log" 2>&1 &
  PG=$!
  # sdk/runner.ts skips bots/<bot>/bot.env when PASSWORD is in the environment, so the setup and
  # plain runners would go to the default gateway; the workflow unsets it here too.
  unset PASSWORD
  stop() { set +e; touch "$OUT/page/stop"; for i in $(seq 20); do kill -0 $PG 2>/dev/null || break; sleep 1; done
    kill $PG $PS $GW 2>/dev/null; sleep 1; kill -9 $PG $PS $GW 2>/dev/null; rm -rf "bots/$BOT"; }
  trap stop EXIT
  for i in $(seq 240); do [ -f "$OUT/page/ready" ] && break; kill -0 $PG 2>/dev/null || break; sleep 1; done
  [ -f "$OUT/page/ready" ] || { echo 'the page did not log in'; tail -30 "$OUT/page-driver.log"; exit 1; }
  for i in $(seq 60); do grep -q 'Bot connected' "$OUT/gateway.log" && break; sleep 1; done
  grep -q 'Bot connected' "$OUT/gateway.log" || { echo 'overlay did not register with the gateway'; tail -20 "$OUT/gateway.log"; exit 1; }
  sleep 3
  local page='bun --no-install docs/speedrun/scripts/demo-browser-page.ts eval --dir="$OUT/page" --progress="rsPrograms.status()"'
  # Every log's tick: the progress line is cut at 400 chars, so poll a compact view of knife-cycle's
  # logTail (its xp and level lines only) every 3 s; 10 entries cover about 30 ticks.
  export KPROG='(() => { const s = rsPrograms.status(); return { t: s.tick, r: s.counters && s.counters.rolls, x: (s.logTail || []).filter(l => / (xp|level)/.test(l)).map(l => l.replace(/ \(.*$/, "")).slice(-10) }; })()'
  local kpage='bun --no-install docs/speedrun/scripts/demo-browser-page.ts eval --dir="$OUT/page" --every=3 --progress="$KPROG"'
  local setup='bun docs/speedrun/scripts/tickmanip-demo-setup.ts "$BOT" --logs=1'
  local bp kn
  case "$VARIANT" in
    overlay) bp='bun docs/speedrun/scripts/tickmanip-latency.ts "$BOT" --no-tele --trials="$TRIALS"'
             kn="$setup"' && bun docs/speedrun/scripts/tickmanip-cycle.ts "$BOT" --mode=tree-knife --gate=off --demo --rolls="$CYCLES" --log="$OUT/knife/r1-knife.log"' ;;
    in-page|in-page-oak) bp="$page"' --json="$OUT/browser-probe.json" "rsPrograms.run(\"probe\", { trials: $TRIALS })"'
             kn="$setup && $kpage"' --json="$OUT/knife.json" --timeout-min=30 "rsPrograms.run(\"knife-cycle\", { method: \"tree\", rolls: $CYCLES, maxTicks: 6000 })"' ;;
  esac
  local plain='bun docs/speedrun/scripts/tickmanip-cycle.ts "$BOT" --mode=tree-base --demo --rolls="$PLAIN_ROLLS" --log="$OUT/knife/r1-plain.log"'
  local rc=0
  run_probe browser-probe "$bp" || rc=$?
  local t; t=$(( $(left) - 75 )); [ $t -lt 60 ] && t=60
  if [ "$VARIANT" = in-page-oak ]; then
    # Oaks fall on 1 log in 8 (woodcut.rs2), so neither loop walks between most logs. Both run as
    # the in-page knife-cycle program (technique knife, then plain) on the oaks at 3203,3240 and
    # 3203,3246, each sized in ticks (about 2.8 per second in bursts) from the time left: the knife
    # takes 62% after setup, plain the rest (sized at 2.6 per second, so it ends inside its timeout). Every 2.5 s the poll records the program's tick, its
    # success count with the last 12 success ticks (marks.successes; a stamp's index is count - 12 + i),
    # and the counters that classify resyncs (phaseResyncs, slips, resyncs, levelUps, switches).
    export KPROG='(() => { const s = rsPrograms.status(); if (!s) return null; const m = (s.marks && s.marks.successes) || { count: 0, ticks: [] }; const c = s.counters || {}; return { id: s.runId, ph: s.phase, t: s.tick, n: m.count, k: m.ticks.slice(-12), pr: c.phaseResyncs || 0, sl: c.slips || 0, rs: c.resyncs || 0, lu: c.levelUps || 0, sw: c.switches || 0 }; })()'
    kpage='bun --no-install docs/speedrun/scripts/demo-browser-page.ts eval --dir="$OUT/page" --every=2.5 --progress="$KPROG"'
    local oaks='trees: [[3203, 3240], [3203, 3246]]'
    local kt=$(( ( t - 40 ) * 62 / 100 * 28 / 10 )); [ $kt -gt 900 ] && kt=900; [ $kt -lt 150 ] && kt=150
    kn="$setup && $kpage"' --json="$OUT/knife.json" --timeout-min=10 "rsPrograms.run(\"knife-cycle\", { method: \"oak\", '"$oaks"', maxTicks: '"$kt"' })"'
    echo "knife: maxTicks $kt, $t s left in the slot"
    run_probe knife "$kn" $t || rc=$?
    t=$(( $(left) - 25 )); [ $t -lt 30 ] && t=30
    local pt=$(( ( t - 8 ) * 26 / 10 )); [ $pt -lt 60 ] && pt=60
    plain="$kpage"' --json="$OUT/plain.json" --timeout-min=10 "rsPrograms.run(\"knife-cycle\", { method: \"oak\", technique: \"plain\", '"$oaks"', maxTicks: '"$pt"' })"'
    echo "plain control: maxTicks $pt, $t s left in the slot"
  else
    run_probe knife "$kn" $t || rc=$?
    t=$(( $(left) - 25 )); [ $t -lt 30 ] && t=30
    echo "plain control: up to $PLAIN_ROLLS logs, $t s left in the slot"
  fi
  run_probe plain "$plain" $t || rc=$?
  bun docs/speedrun/scripts/tickmanip-demo-report.ts "$OUT/knife" >> "$OUT/plain.txt" 2>&1 || true
  curl -s --max-time 5 "https://$DEMO/playercount" | jq -r '.count // ""' > "$OUT/players-end.txt" 2>/dev/null || true
  return $rc
}

code=0
( direct_path ) || code=$?
sleep 15
( browser_path ) || code=$?
rm -rf "bots/$BOT"
echo "logged out at $(TZ=America/Los_Angeles date '+%T %Z'), $(( $(date +%s) - T0 )) s after start" | tee "$OUT/elapsed.txt"
unset PASSWORD

# Results
if [ -s "$OUT/page/frames.jsonl" ]; then
  for f in browser-probe knife plain; do
    read -r _ t0 t1 < <(grep "^$f " "$OUT/marks.tsv") || continue
    bun --no-install docs/speedrun/scripts/demo-browser-page.ts frames --dir="$OUT/page" --from="$t0" --to="$t1" > "$OUT/frames-$f.txt" 2>&1 || true
  done
fi
pw=$(sed -n 's/^PASSWORD=//p' $HOME/rs130/account.env)
[ -n "$pw" ] && { grep -rlF -- "$pw" "$OUT" | PW="$pw" xargs -r perl -pi -e 's/\Q$ENV{PW}\E/[redacted]/g' || true; }
unset pw
# Gate on the direct row, current rule (demo-latency.md section 10): (a) >= 58/60 next tick, (c) <= 2 catch-ups/min
# (an interval < 150 ms right after one > 350 ms; frames within 20 ms are one tick), (b) p90 reported as context.
gate=$(jq -r '
  (.react.trials // []) as $tr | ($tr | map(select(.ticks == 1)) | length) as $on | ($tr | length) as $n |
  (.react.frames.raw // [] | map(.[0])) as $f |
  (reduce $f[] as $x ({b: [], last: null}; if .last == null or $x - .last > 20 then {b: (.b + [$x]), last: $x} else .last = $x end) | .b) as $t |
  [range(1; $t | length) as $i | $t[$i] - $t[$i - 1]] as $iv | ($iv | sort) as $s | ($s | length) as $m |
  (if $m > 0 then $s[[($m * 0.9 | floor), $m - 1] | min] else null end) as $p90 | ($s[-1] // null) as $max |
  ([range(1; $iv | length) as $i | select($iv[$i] < 150 and $iv[$i - 1] > 350)] | length) as $cu |
  (if ($t | length) > 1 then ($t[-1] - $t[0]) / 60000 else 0 end) as $mins | (if $mins > 0 then $cu / $mins else null end) as $rate |
  ($n > 0 and $on * 60 >= 58 * $n) as $a | ($rate != null and $rate <= 2) as $c |
  "\(if $a and $c then "PASS" else "FAIL (burst)" end): a \($on)/\($n) \(if $a then "ok" else "fail" end); c \($cu) catch-ups in \($mins * 10 | floor / 10) min = \($rate // 0 | . * 10 | floor / 10)/min \(if $c then "ok" else "fail" end); b (context) frame interval p90 \($p90 // 0 | floor) max \($max // 0 | floor)"
' "$OUT/direct.json" 2>/dev/null || echo 'not scored (no direct row)')
echo "$gate" > "$OUT/gate.txt"
{ echo "session $OUT exit $code"; echo "browser page from main @ $(git -C $BROWSER_DIR rev-parse --short=9 HEAD), probes from $(git rev-parse --short=9 HEAD)"; echo "gate: $gate"; grep -h 'react delay +0' "$OUT/direct.txt"; grep -hE '^(latency in ticks|on time|decoded tick|server frame|page publication|state publication)' "$OUT/browser-probe.txt"; for f in browser-probe knife plain; do [ -s "$OUT/frames-$f.txt" ] && { echo "-- frames $f"; cat "$OUT/frames-$f.txt"; }; done; echo '-- knife/plain'; grep -hE '^(knife-cycle:|ALL |segment:)' "$OUT/knife.txt" "$OUT/plain.txt"; echo "players end $(cat $OUT/players-end.txt 2>/dev/null)"; } | tee "$OUT/summary.txt"
echo "SESSION DONE $OUT"
exit $code
