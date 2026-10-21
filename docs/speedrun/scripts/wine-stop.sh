#!/usr/bin/env bash
# Stop the rs/47 wine helpers on bbs (dev setup in ~/rs-dev/wine, private tmux
# server rs41-wine, loopback gateway 127.0.0.1:8540) without leaving anyone in
# the world. Per account: the stop file (so neither loop restarts), the role
# window, a logout through the logout button while the client is still
# connected (wine-logout.ts), and only then the client window. A client whose
# logout failed is left running and reported. When no account window is left,
# the tmux server goes, and with it the gateway. Touches nothing outside
# rs41-wine.
#
#   bash ~/rs-dev/wine/docs/speedrun/scripts/wine-stop.sh [account ...]   (default: every account window)
set -u
T="tmux -L rs41-wine"
CTL=~/rs-dev/wine-ctl
cd ~/rs-dev/wine || exit 1
export PATH=$HOME/.bun/bin:$PATH GATEWAY_URL=ws://127.0.0.1:8540

windows() { $T list-windows -t wine -F '#{window_name}' 2>/dev/null; }
accts=("$@")
[ ${#accts[@]} -gt 0 ] || mapfile -t accts < <(windows | sed -n 's/^c-//p')

failed=0
for a in "${accts[@]}"; do
    touch "$CTL/stop-$a"
    $T kill-window -t "wine:r-$a" 2>/dev/null && echo "$a: role stopped"
done
sleep 5
for a in "${accts[@]}"; do
    if ! windows | grep -qx "c-$a"; then echo "$a: no client window"; continue; fi
    if bun docs/speedrun/scripts/wine-logout.ts "$a"; then
        # client.sh exits by itself once the session has ended and the stop file is there.
        for _ in $(seq 1 30); do windows | grep -qx "c-$a" || break; sleep 1; done
        $T kill-window -t "wine:c-$a" 2>/dev/null
        echo "$a: logged out, client stopped"
    else
        failed=1
        echo "$a: LOGOUT FAILED, client left running (rerun this script for $a)"
    fi
done
if ! windows | grep -qE '^[cr]-'; then
    $T kill-server 2>/dev/null && echo "rs41-wine tmux server and gateway stopped"
fi
exit $failed
