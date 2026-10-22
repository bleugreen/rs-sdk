#!/usr/bin/env bash
# Reach the run host (ashburn, AWS us-east-1) from an agent batch: the twin of bbs.sh.
#   speedrun/helpers/ashburn.sh 'hostname; ~/.bun/bin/bun --version'
#   speedrun/helpers/ashburn.sh push        # rsync this checkout's speedrun/ to ~/rs-sdk/speedrun/ (development deploys)
# The host is never a Cairn executor (permanently drained); everything on it goes
# through SSH. Agent sandboxes cannot read ~/.ssh, so this uses the dedicated key
# generated on each builder machine (~/.rs-fleet/id_ed25519_ashburn) with the VM's
# host key pinned, never StrictHostKeyChecking=no. Non-login commands do not have
# Bun on PATH: use ~/.bun/bin/bun or `bash -lc '...'`.
# The host's address never lives in the repository: it comes from ASHBURN_HOST
# or the private, per-machine ~/.rs-fleet/ashburn-host (user@address, mode 600),
# and its pinned host key from ~/.rs-fleet/known_hosts_ashburn.
set -euo pipefail

HOST_FILE="$HOME/.rs-fleet/ashburn-host"
HOST="${ASHBURN_HOST:-$( [ -r "$HOST_FILE" ] && tr -d '[:space:]' <"$HOST_FILE" )}"
KEY="$HOME/.rs-fleet/id_ed25519_ashburn"
KNOWN_HOSTS="$HOME/.rs-fleet/known_hosts_ashburn"
if [ -z "$HOST" ] || [ ! -r "$KNOWN_HOSTS" ]; then
  echo "ashburn.sh: this machine lacks $HOST_FILE or $KNOWN_HOSTS; ask rs/41 or main to install them" >&2
  exit 2
fi
SSH=(ssh -o BatchMode=yes -o UserKnownHostsFile="$KNOWN_HOSTS" -o StrictHostKeyChecking=yes -o CheckHostIP=no)
if [ -r "$KEY" ]; then
  SSH+=(-o IdentitiesOnly=yes -i "$KEY")
fi

if [ "${1:-}" = push ]; then
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  # Only speedrun/: the host's fork clone is ~/rs-sdk, and its bots/ and runtime
  # files live outside speedrun/, so they are never touched.
  exec rsync -az -e "${SSH[*]}" --exclude node_modules "$ROOT/speedrun/" "$HOST:rs-sdk/speedrun/"
fi
exec "${SSH[@]}" "$HOST" "$@"
