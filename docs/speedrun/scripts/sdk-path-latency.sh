#!/usr/bin/env bash
# SDK-path reaction latency against the demo, through a private loopback gateway or the public one.
#
#   docs/speedrun/scripts/sdk-path-latency.sh <bot> private|public [trials]
#
# private: gateway.ts on 127.0.0.1:7790, the lite runner and the SDK script both attach to it
#          (rs/26's setup). public: the lite runner publishes to the demo's own gateway
#          (wss://host:7443, else /gateway) and the SDK script controls it from there, which is
#          the path a browser tab plus a remote script takes.
set -euo pipefail
bot=$1; mode=$2; trials=${3:-60}
root=$(cd "$(dirname "$0")/../../.." && pwd)
env="$root/bots/$bot/bot.env"
[ -f "$env" ] || { echo "missing $env" >&2; exit 1; }
pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; wait 2>/dev/null || true; }
trap cleanup EXIT
(cd "$root" && bun install --silent >/dev/null)
(cd "$root/server/webclient" && bun install --silent >/dev/null)
log=${TMPDIR:-/tmp}/sdk-path-$bot-$mode
if [ "$mode" = private ]; then
    (cd "$root/server/gateway" && bun install --silent >/dev/null)
    (cd "$root/server/gateway" && AGENT_PORT=7790 GATEWAY_HOSTNAME=127.0.0.1 exec bun gateway.ts) >"$log-gateway.log" 2>&1 &
    pids+=($!)
    sleep 2
    export GATEWAY_URL=ws://127.0.0.1:7790
    sdk_server=ws://127.0.0.1:7790
else
    unset GATEWAY_URL || true
    sdk_server=rs-sdk-demo.fly.dev
fi
# TRACE=1: hop-timestamp both processes (relay-trace-preload.ts) and run the per-trial script.
preload=(); script=docs/speedrun/scripts/tickmanip-latency.ts
if [ "${TRACE:-}" = 1 ]; then
    trace=${TRACE_DIR:-${TMPDIR:-/tmp}/relay-trace}; mkdir -p "$trace"; rm -f "$trace"/*.jsonl
    preload=(--preload "$root/docs/speedrun/scripts/relay-trace-preload.ts")
    script=docs/speedrun/scripts/relay-latency.ts
    echo "trace dir $trace"
fi
(cd "$root/server/webclient" && RELAY_TRACE_FILE=${trace:+$trace/lite.jsonl} RELAY_TRACE_LITE=1 exec bun ${preload[@]+"${preload[@]}"} src/lite/runner.ts "$bot") >"$log-runner.log" 2>&1 &
pids+=($!)
for _ in $(seq 60); do grep -q 'Gateway connected' "$log-runner.log" 2>/dev/null && break; sleep 1; done
grep -E 'logged into|Connecting to gateway|Gateway connected' "$log-runner.log" || { cat "$log-runner.log"; exit 1; }
echo "start $(TZ=America/Los_Angeles date '+%F %T %Z') mode=$mode players=$(curl -s https://rs-sdk-demo.fly.dev/playercount)"
(cd "$root" && set -a && . "$env" && set +a && SERVER=$sdk_server RELAY_TRACE_FILE=${trace:+$trace/sdk.jsonl} RELAY_TRIALS_OUT=${trace:+$trace/trials.jsonl} bun ${preload[@]+"${preload[@]}"} "$script" "--trials=$trials") 2>&1 | grep -vE '^\[(Runner|SDK|BotSDK)\]' | tail -8
echo "end $(TZ=America/Los_Angeles date '+%F %T %Z') players=$(curl -s https://rs-sdk-demo.fly.dev/playercount)"
