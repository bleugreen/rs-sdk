#!/usr/bin/env bash
# Reach the run host (ashburn, AWS us-east-1) from an agent batch: the twin of bbs.sh.
#   speedrun/helpers/ashburn.sh 'hostname; ~/.bun/bin/bun --version'
#   speedrun/helpers/ashburn.sh push        # rsync this checkout's speedrun/ to ~/rs-sdk/speedrun/ (development deploys)
# The host is never a Cairn executor (permanently drained); everything on it goes
# through SSH. Agent sandboxes cannot read ~/.ssh, so this uses the dedicated key
# generated on each builder machine (~/.rs-fleet/id_ed25519_ashburn) with the VM's
# host key pinned, never StrictHostKeyChecking=no. Non-login commands do not have
# Bun on PATH: use ~/.bun/bin/bun or `bash -lc '...'`.
#
# The host's addresses never live in this repository (the fork is public). Set them
# in your local shell from cairn://p/rs/host:
#   RS_RUN_HOST     the run host's public address, bare or as user@address (user defaults to ubuntu)
#   RS_RUN_TAILNET  optional: its Tailscale address, pinned alongside the public one
set -euo pipefail

if [ -z "${RS_RUN_HOST:-}" ]; then
  echo "ashburn.sh: RS_RUN_HOST is not set; set it from cairn://p/rs/host" >&2
  exit 2
fi
case "$RS_RUN_HOST" in
  *@*) HOST="$RS_RUN_HOST" ;;
  *) HOST="ubuntu@$RS_RUN_HOST" ;;
esac
ADDRESS="${HOST#*@}"

KEY="$HOME/.rs-fleet/id_ed25519_ashburn"
KNOWN_HOSTS="$HOME/.rs-fleet/known_hosts_ashburn"
if [ ! -r "$KNOWN_HOSTS" ]; then
  KNOWN_HOSTS="${TMPDIR:-/tmp}/ashburn_known_hosts"
  # The host key survives address rotations; only the address list changes.
  echo "$ADDRESS${RS_RUN_TAILNET:+,$RS_RUN_TAILNET} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBYCG1nNhhY0ax6lRCgxT6oxfNh4NW7mlLOdQeoWZ0wE" >"$KNOWN_HOSTS"
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
