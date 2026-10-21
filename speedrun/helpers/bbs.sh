#!/usr/bin/env bash
# Reach the fleet host (bbs) from the Mac.
#   speedrun/helpers/bbs.sh '~/rs-fleet/speedrun/helpers/fleetctl status'
#   speedrun/helpers/bbs.sh push            # rsync this checkout's speedrun/ to ~/rs-fleet/speedrun/ (development deploys)
# In a normal shell plain `ssh bleu@bbs` does the same. Agent sandboxes cannot
# read ~/.ssh/known_hosts, so this pins bbs's host key itself (never
# StrictHostKeyChecking=no). The key needs to be loaded in the Mac's ssh-agent.
set -euo pipefail

HOST="${BBS_HOST:-bleu@bbs}"
KNOWN_HOSTS="${TMPDIR:-/tmp}/bbs_known_hosts"
echo 'bbs,10.10.10.10 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHX0YRbTQDZxermLPksxlrvr46dBCcZ67pMi79Vo54S6' >"$KNOWN_HOSTS"
SSH=(ssh -o BatchMode=yes -o UserKnownHostsFile="$KNOWN_HOSTS" -o StrictHostKeyChecking=yes -o CheckHostIP=no)

if [ "${1:-}" = push ]; then
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  # Only speedrun/: the rest of the host's checkout tracks origin (fleetctl update),
  # which may be ahead of a development branch, and bots/ and the fleet's runtime
  # files live outside speedrun/, so they are never touched.
  exec rsync -az -e "${SSH[*]}" --exclude node_modules "$ROOT/speedrun/" "$HOST:rs-fleet/speedrun/"
fi
exec "${SSH[@]}" "$HOST" "$@"
