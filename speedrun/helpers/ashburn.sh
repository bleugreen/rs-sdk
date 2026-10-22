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
# The host's addresses never live in this repository (the fork is public). Take them
# from cairn://p/rs/host:
#   RS_RUN_HOST     the run host's public address, bare or as user@address (user defaults to ubuntu)
#   RS_RUN_TAILNET  optional: its Tailscale address, pinned beside the public one
# When RS_RUN_HOST is unset, the private per-machine file ~/.rs-fleet/ashburn-ip
# (same forms, one line, never committed) supplies it; the variable wins over the file.
set -euo pipefail

die() {
  echo "ashburn.sh: $*" >&2
  exit 2
}

HOST_FILE="$HOME/.rs-fleet/ashburn-ip"
DEST="${RS_RUN_HOST:-}"
if [ -z "$DEST" ] && [ -r "$HOST_FILE" ]; then
  read -r DEST <"$HOST_FILE" || true
  DEST="${DEST%$'\r'}"
fi
[ -n "$DEST" ] || die "RS_RUN_HOST is not set (nor $HOST_FILE); set it from cairn://p/rs/host"
case "$DEST" in
  *@*) HOST="$DEST" ;;
  *) HOST="ubuntu@$DEST" ;;
esac
# Both parts start with a letter or digit, so the destination can never reach ssh as an option.
[[ "$HOST" =~ ^[A-Za-z0-9_][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9.-]*$ ]] ||
  die "RS_RUN_HOST must be an address or user@address (see cairn://p/rs/host)"
TAILNET="${RS_RUN_TAILNET:-}"
[ -z "$TAILNET" ] || [[ "$TAILNET" =~ ^[A-Za-z0-9][A-Za-z0-9.:-]*$ ]] ||
  die "RS_RUN_TAILNET must be a bare address (see cairn://p/rs/host)"

KEY="$HOME/.rs-fleet/id_ed25519_ashburn"
# The host key survives address rotations, so it is pinned for whatever addresses are
# configured now, followed by the machine's own known_hosts_ashburn if it has one (an
# older copy may still name a previous address). A fresh mktemp file, never a fixed
# path another user could pre-create as a symlink; removed on exit.
PINNED="$(mktemp "${TMPDIR:-/tmp}/ashburn_known_hosts.XXXXXX")"
trap 'rm -f "$PINNED"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
printf '%s ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBYCG1nNhhY0ax6lRCgxT6oxfNh4NW7mlLOdQeoWZ0wE\n' "${HOST#*@}${TAILNET:+,$TAILNET}" >"$PINNED"
if [ -r "$HOME/.rs-fleet/known_hosts_ashburn" ]; then
  cat "$HOME/.rs-fleet/known_hosts_ashburn" >>"$PINNED"
fi
# One known_hosts file, not a list: push hands "${SSH[*]}" to rsync -e, which splits on spaces.
SSH=(ssh -o BatchMode=yes -o UserKnownHostsFile="$PINNED" -o StrictHostKeyChecking=yes -o CheckHostIP=no)
if [ -r "$KEY" ]; then
  SSH+=(-o IdentitiesOnly=yes -i "$KEY")
fi

# No exec below: the EXIT trap has to outlive ssh/rsync to remove the pin.
if [ "${1:-}" = push ]; then
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  # Only speedrun/: the host's fork clone is ~/rs-sdk, and its bots/ and runtime
  # files live outside speedrun/, so they are never touched.
  rsync -az -e "${SSH[*]}" --exclude node_modules "$ROOT/speedrun/" "$HOST:rs-sdk/speedrun/"
  exit
fi
"${SSH[@]}" "$HOST" "$@"
