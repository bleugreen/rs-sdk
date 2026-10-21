#!/usr/bin/env bash
# Run the Draugen hunt on fresh bots, one at a time, against the Rellekka lab
# block (engine on 9100, gateway on 8000; see CONVENTIONS.md). Each bot is
# created, logged in with the headless client, hunts once, and is logged out.
#   bash docs/speedrun/scripts/quest-rellekka-draugen.sh <prefix> <count> [att str def hp]
set -u
prefix=$1; count=$2; shift 2
root=$(cd "$(dirname "$0")/../../.." && pwd)
for i in $(seq 1 "$count"); do
  bot="${prefix}${i}"
  (cd "$root" && bun bots/create-bot.ts "$bot" --local >/dev/null 2>&1)
  sed -i.bak 's#^SERVER=.*#SERVER=localhost:9100#; s#^GATEWAY_URL=.*#GATEWAY_URL=ws://localhost:8000#; s#^TELEMETRY=.*#TELEMETRY=false#' "$root/bots/$bot/bot.env"
  (cd "$root/server/webclient" && bun src/lite/runner.ts "$bot" >/tmp/rellekka-runner-$bot.log 2>&1) &
  runner=$!
  sleep 8
  (cd "$root" && bun docs/speedrun/scripts/quest-primitives-setup.ts "$bot" >/dev/null 2>&1)
  (cd "$root" && bun docs/speedrun/scripts/quest-rellekka-draugen.ts "$bot" "$@" 2>&1 | grep -E '^result|Error' | cut -c1-600)
  kill "$runner" 2>/dev/null; wait "$runner" 2>/dev/null
done
