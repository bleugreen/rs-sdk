#!/usr/bin/env bash
# Reach the run host (ashburn, AWS us-east-1) from an agent batch: the twin of bbs.sh.
#   speedrun/helpers/ashburn.sh 'hostname; ~/.bun/bin/bun --version'
#   speedrun/helpers/ashburn.sh push        # rsync this checkout's speedrun/ to ~/rs-sdk/speedrun/ (development deploys)
# The host is never a Cairn executor (permanently drained); everything on it goes
# through SSH. Agent sandboxes cannot read ~/.ssh, so this uses the dedicated key
# generated on each builder machine (~/.rs-fleet/id_ed25519_ashburn) with the VM's
# host key pinned, never StrictHostKeyChecking=no. Non-login commands do not have
# Bun on PATH: use ~/.bun/bin/bun or `bash -lc '...'`.
set -euo pipefail

HOST="${ASHBURN_HOST:-ubuntu@3.209.186.185}"
KEY="$HOME/.rs-fleet/id_ed25519_ashburn"
# The pinned key is always offered, beside the machine's own file when it has
# one, so a builder whose ~/.rs-fleet file predates an address change still
# verifies the host instead of failing. Public address first, then the
# Tailscale one (rs-ashburn). The VM kept its host key when its address moved
# from 54.242.152.95, which is no longer pinned.
PINNED="${TMPDIR:-/tmp}/ashburn_known_hosts"
# One file, not a space-separated list: push hands "${SSH[*]}" to rsync -e, which splits on spaces.
echo '3.209.186.185,100.66.164.37 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBYCG1nNhhY0ax6lRCgxT6oxfNh4NW7mlLOdQeoWZ0wE' >"$PINNED"
if [ -r "$HOME/.rs-fleet/known_hosts_ashburn" ]; then
  cat "$HOME/.rs-fleet/known_hosts_ashburn" >>"$PINNED"
fi
SSH=(ssh -o BatchMode=yes -o UserKnownHostsFile="$PINNED" -o StrictHostKeyChecking=yes -o CheckHostIP=no)
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
