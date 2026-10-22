#!/usr/bin/env bash
# Reach the fleet host (bbs) from the Mac.
#   speedrun/helpers/bbs.sh '~/rs-fleet/speedrun/helpers/fleetctl status'
#   speedrun/helpers/bbs.sh push            # rsync this checkout's speedrun/ to ~/rs-fleet/speedrun/ (development deploys)
# In a normal shell plain `ssh bleu@bbs` does the same. Agent sandboxes cannot
# read ~/.ssh, so this brings its own key and host key (never
# StrictHostKeyChecking=no): the dedicated fleet key and pinned host key in
# ~/.rs-fleet when the machine has them (installed on the macOS executors),
# otherwise whatever key the ssh-agent holds, with bbs's host key pinned from
# the environment.
#
# bbs's address and host key never live in this repository (the fork is public).
# Without ~/.rs-fleet, take them from the host's private record:
#   RS_BBS_HOST         bbs's address (pinned beside the name `bbs`)
#   RS_BBS_HOSTKEY      its host key, "ssh-ed25519 AAAA..."
# or RS_BBS_KNOWN_HOSTS, the path of a known_hosts file outside the tree that pins it.
set -euo pipefail

die() {
  echo "bbs.sh: $*" >&2
  exit 2
}

HOST="${BBS_HOST:-bleu@bbs}"
FLEET_KEY="$HOME/.rs-fleet/id_ed25519_fleet"
FLEET_KNOWN_HOSTS="$HOME/.rs-fleet/known_hosts_bbs"
if [ -r "$FLEET_KEY" ] && [ -r "$FLEET_KNOWN_HOSTS" ]; then
  SSH=(ssh -o BatchMode=yes -o IdentitiesOnly=yes -i "$FLEET_KEY" -o UserKnownHostsFile="$FLEET_KNOWN_HOSTS" -o StrictHostKeyChecking=yes -o CheckHostIP=no)
else
  KNOWN_HOSTS="${RS_BBS_KNOWN_HOSTS:-}"
  if [ -n "$KNOWN_HOSTS" ]; then
    [ -r "$KNOWN_HOSTS" ] || die "RS_BBS_KNOWN_HOSTS ($KNOWN_HOSTS) is not readable"
  else
    ADDR="${RS_BBS_HOST:-}"
    HOSTKEY="${RS_BBS_HOSTKEY:-}"
    [ -n "$ADDR" ] && [ -n "$HOSTKEY" ] ||
      die "no ~/.rs-fleet fleet key, and RS_BBS_HOST + RS_BBS_HOSTKEY (or RS_BBS_KNOWN_HOSTS) are not set; set them from the host's private record"
    [[ "$ADDR" =~ ^[A-Za-z0-9][A-Za-z0-9.:-]*$ ]] || die "RS_BBS_HOST must be a bare address"
    [[ "$HOSTKEY" =~ ^ssh-ed25519\ [A-Za-z0-9+/]+=*$ ]] || die "RS_BBS_HOSTKEY must be 'ssh-ed25519 <base64>'"
    # A fresh mktemp file, never a fixed path another user could pre-create as a
    # symlink; removed on exit.
    KNOWN_HOSTS="$(mktemp "${TMPDIR:-/tmp}/bbs_known_hosts.XXXXXX")"
    trap 'rm -f "$KNOWN_HOSTS"' EXIT
    trap 'exit 129' HUP
    trap 'exit 130' INT
    trap 'exit 143' TERM
    printf 'bbs,%s %s\n' "$ADDR" "$HOSTKEY" >"$KNOWN_HOSTS"
  fi
  SSH=(ssh -o BatchMode=yes -o UserKnownHostsFile="$KNOWN_HOSTS" -o StrictHostKeyChecking=yes -o CheckHostIP=no)
fi

# No exec below: the EXIT trap has to outlive ssh/rsync to remove a temporary pin.
if [ "${1:-}" = push ]; then
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  # Only speedrun/: the rest of the host's checkout tracks origin (fleetctl update),
  # which may be ahead of a development branch, and bots/ and the fleet's runtime
  # files live outside speedrun/, so they are never touched.
  rsync -az -e "${SSH[*]}" --exclude node_modules "$ROOT/speedrun/" "$HOST:rs-fleet/speedrun/"
  exit
fi
"${SSH[@]}" "$HOST" "$@"
