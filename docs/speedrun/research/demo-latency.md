# Demo-server reaction latency

rs/85 under cairn://p/rs/83, 2026-10-21. This document explains why a reaction on the demo
server (rs-sdk-demo.fly.dev, LostCity revision 289, the 17 January 2005 client,
`NODE_TICKRATE=300`) used to land 2-3 ticks after the state that prompted it, when a local
engine lands it on the next tick, and where the scored run's client must sit. Scripts are in
[`docs/speedrun/scripts/`](../scripts/), raw data in [`data/`](data/). Every time is PDT on
2026-10-21 unless stated.

**Summary.** The app runs on one machine in Fly's iad region (Ashburn, Virginia). The engine
spends most of each 300 ms tick computing on the same thread that reads sockets, so a client's
reply lands on the next tick only if its whole round trip, including its own turnaround, fits
in the idle gap after the tick's output is flushed. At about 1,550-1,680 players online, a client
in Ashburn has about 50 ms after a tick's frame arrives (median) to get its reply out. Two things
decide whether a reaction fits:

1. **Placement.** From Southern California the network round trip is about 80-90 ms, which leaves
   0-25 ms on most ticks and nothing on the rest. From Ashburn it is about 3 ms.
2. **The client path.** Reacting in-process on the game socket costs under 1 ms. The SDK relay
   (lite runner, gateway, SDK script) costs 73 ms at the median, almost all of it in two 20 ms
   timers inside the lite runner. The public gateway is saturated and costs hundreds of ms more.

From Ashburn, a direct in-process reaction landed on the next tick 180 of 180 times over three
paired runs, and the SDK relay 123 of 180. A third cause hits every client wherever it sits: when
a tick overruns, the engine starts the next one almost at once to catch up, so there is no idle gap
and a reaction to the long tick misses. At 04:13 that took the Ashburn direct path to 40/16/4
(section 3).

## 1. Where the app runs

| Evidence | Value | Source |
| --- | --- | --- |
| `fly.toml` | `primary_region = "iad"`, one `performance-2x` machine | repo |
| `flyio-debug` from home (fedora, Mac, bgsrv-ub, bgsrv-mac; one egress IP) | `nr=lax` (Los Angeles edge), `sr=iad`, `sdc=iad2`, `bn=worker-cf-iad2-ce4c`, mesh hop via edge-dp-ash1/ash2, `mrtt` 56-86 ms | curl with `flyio-debug: doit`, 01:36-02:37 |
| `flyio-debug` from GitHub Actions, Azure centralus (Des Moines) | `nr=ord` (Chicago edge), `sr=iad`, `mrtt` 22-25 ms | rs/86 runs 1 and 3 |
| `flyio-debug` from GitHub Actions, Azure eastus (Dulles, VA) | `nr=iad` (edge-dp-ash2), `sr=iad`, no mesh hop (`mhn` and `mrtt` null), TCP connect 2-3 ms | rs/86 runs 2 and 4 |
| Path trace from fedora (`mtr`, 30 cycles, 02:37) | 11 hops via Cox and Comcast Los Angeles and CDN77 to Fly anycast 66.241.125.86, 21 ms average | `mtr -rwbc 30` |

The app machine is in Fly's iad region, datacenter iad2. A client in Ashburn reaches an Ashburn
edge that proxies straight to the worker. A client anywhere else reaches its nearest edge, which
forwards over Fly's mesh to Ashburn; `mrtt` is that edge-to-app round trip.

The four home machines share one egress IP and the Los Angeles edge, so network-wise they are
one vantage point. bbs was not probed separately in this pass: its executor is draining, and the
sandboxed executor user on the other machines has no ssh key for `bleu@bbs`.

### One-way latency per vantage point

One-way latency to the app is estimated as (client-to-edge RTT + `mrtt`) / 2. Client-to-edge RTT
is the TCP connect time, since the Fly edge completes the handshake. (Plain `http://` requests
are answered by the edge with a redirect, but Fly holds that redirect about 540 ms, so it is no
use as a control.) The cross-check against a websocket ping is still open.

| Vantage | Executor / host | PDT | Fly edge | TCP connect p50 (p10-p90) | `mrtt` p50 (range) | One-way to app | Samples |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Home, fedora | fedora (bginf-halo) | 02:37 | lax | 20 ms (15-27) | 70 ms (56-86) | **~45 ms** | 40 |
| Home, Mac | local (bbl.local) | 01:45 | lax | 35 ms (25-56) | 75 ms (56-83) | ~55 ms | 4 |
| Home, bgsrv-ub | bgsrv-ub | 01:41 | lax | 32 ms | 70 ms | ~51 ms | 1 |
| Home, bgsrv-mac | bgsrv-mac | 01:41 | lax | 31 ms | 70 ms | ~51 ms | 1 |
| Des Moines | GitHub Actions centralus | 01:54, 02:25 | ord | 24-25 ms | 22-25 ms | ~24 ms | 20 + 20 |
| Ashburn | GitHub Actions eastus | 01:57, 02:43 | iad | 2-3 ms | none (no mesh hop) | **~1.5 ms** | 20 + 20 |
| Ashburn VM (operator) | pending | | | | | | |

## 2. How a tick handles input and output

The engine (`server/engine/src/engine/World.ts`, `cycle()`) runs one synchronous cycle per tick
on the main thread:

1. `processWorld`, then `processClientsIn`, which decodes the input bytes **already buffered** for
   each player (`NetworkPlayer.decodeIn` never waits on the socket).
2. NPCs, then players. Movement and interactions run here, in the same tick as the input.
   Then logins, zones, and info.
3. `processClientsOut`, which encodes every player's tick output and hands it to the socket
   synchronously, in one batch (`WSClientSocket.beginBatch`/`endBatch`).
4. Cleanup, then `setTimeout` for the rest of the 300 ms. The schedule is a fixed 300 ms grid with
   catch-up: `World.ts:386-390` takes the start time, clamps the backlog to two ticks
   (`nextTick = max(nextTick, start - 2 * tickRate)`) and computes `drift = start - nextTick`;
   `World.ts:589` advances `nextTick` by 300; `World.ts:593` waits
   `max(0, tickRate - cycleTime - drift)`. So after a cycle that overran, the next one is scheduled
   with a delay of 0 or close to it, and the two ticks run nearly back to back.

The game websocket (`wss://host/`, path `/` on port 8080), the `/gateway` relay, and every HTTP
route share this one thread (`server/engine/src/web/index.ts`, `web/websocket.ts`), so sockets are
read only between cycles. Cycle statistics (`/tickstats`, `/prometheus`) are served only on the
management port 8898, which `fly.toml` does not publish, so the cycle time has to be measured from
outside. The public read-only signal is `GET /playercount`.

The gateway (`server/gateway/gateway.ts`) is a separate Bun process. It listens on 7780, which the
engine's `/gateway` relay reaches, and on 7781, which Fly publishes as `wss://host:7443`.

### Timing model

Call the time the tick-T output is flushed `F_T`, the start of the next cycle `S_{T+1}`, and the
idle gap between them `W = S_{T+1} - F_T`. A packet sent `r` ms after the tick-T frame reaches the
client lands on tick T+k when

    r + RTT  <  W + (k-1) * 300

where RTT is the full app-to-client-and-back time including Fly's proxies. The next-tick condition
is `r + RTT < W`, and every 300 ms of extra latency costs one more tick. The probe's
`--react-delay` sweep adds known values of `r` to find where reactions flip from 1 tick to 2,
which reads `W` from outside.

## 3. Reaction-tick distributions per vantage point

The trial: on a fresh tick, walk one tile, and count the ticks until the step shows. Three paths:

- **Direct**: `demo-latency-probe.ts --phases=react`. It reacts in-process on the game socket's
  message event, with no 20 ms polling and no gateway. This is the floor for a client at that
  placement, and the shape of an in-page tick program in the browser.
- **Private relay**: `tickmanip-latency.ts` (or `relay-latency.ts`) through
  `sdk-path-latency.sh <bot> private`: lite runner, a gateway on loopback, and the SDK script on
  the same host. This is rs/26's setup.
- **Public relay**: the lite runner publishes to the demo's own gateway. Not yet sampled; the
  gateway's HTTP numbers in section 4 already show it is the worst path.
- **Browser tab**: `demo-latency-probe.yml` with `mode=browser` (rs/95). It runs the direct probe
  first as the reference row, then a branch's browser webclient (`browser_ref`: its bundle,
  `proxy.ts` page server and gateway) in headless Chrome on the same runner, with the game socket
  straight to the demo and the overlay to a loopback gateway. `variant=overlay` reacts from
  `tickmanip-latency.ts` over that gateway; `variant=in-page` runs rs/97's `rsPrograms` probe in
  the page. Each run follows with the knife woodcutting loop and a plain control at the trees west
  of Lumbridge castle, scores the run-night gate on its direct row, and breaks every reaction into
  page-side hops from Chrome's own websocket frame times (`demo-browser-page.ts frames`).

| Vantage | Path | PDT | Fly edge | `mrtt` | Online | Trials | 1 tick | 2 ticks | 3+ ticks | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Home (bbs) | private relay | ~01:30 | lax | 56-61 ms | not recorded | 60 | 0 | 25 | 35 | rs/26 |
| Home (Mac) | direct | 01:46 | lax | 56-83 ms | 1,586 | 10 | 4 | 6 | 0 | smoke run |
| Home (Mac) | direct, +0 ms | 02:45 | lax | 56-86 ms | 1,660 | 15 | 10 | 5 | 0 | [`data/mac-0247.json`](data/mac-0247.json) |
| Home (Mac) | private relay | 02:35 | lax | 56-86 ms | 1,556-1,653 | 60 | 3 | 56 | 1 | `sdk-path-latency.sh` |
| Home (Mac) | private relay, traced | 02:53 | lax | 56-86 ms | 1,673 | 60 | 3 | 44 | 13 (9 at 3, 3 at 4, 1 at 5) | [`data/relay-trace-mac-0252/`](data/relay-trace-mac-0252/) |
| Des Moines | private relay | 01:54 | ord | 25 ms | 1,631 | 60 | 26 | 34 | 0 | [rs/86 run 1](https://github.com/bleugreen/rs-sdk/actions/runs/39572597129) |
| Ashburn | private relay | 01:57 | iad | none | 1,636 | 60 | 51 | 9 | 0 | [rs/86 run 2](https://github.com/bleugreen/rs-sdk/actions/runs/39573031339) |
| Des Moines | private relay | 02:25 | ord | 22 ms | 1,549 | 60 | 44 | 16 | 0 | [rs/86 run 3](https://github.com/bleugreen/rs-sdk/actions/runs/39576693034) |
| Ashburn | **direct** | 02:43:53 | iad | none | ~1,655 | 60 | **60** | 0 | 0 | [rs/86 run 4](https://github.com/bleugreen/rs-sdk/actions/runs/39579095329) |
| Ashburn | private relay | 02:45:38 | iad | none | ~1,655 | 60 | 32 | 28 | 0 | rs/86 run 4, same runner 26 s later |
| Ashburn | direct, +0 ms | 02:49 | iad | none | 1,564-1,672 | 15 | 15 | 0 | 0 | [rs/86 run 5](https://github.com/bleugreen/rs-sdk/actions/runs/39579740957) |
| Quebec (Azure CanadaEast) | direct | 03:05 | **iad**, but TCP 24 ms | none | 1,649-1,653 | 60 | 56 | 4 | 0 | [rs/86 run 6](https://github.com/bleugreen/rs-sdk/actions/runs/39581904913) |
| Quebec (Azure CanadaEast) | private relay | 03:05 | iad, TCP 24 ms | none | 1,649-1,653 | 60 | 36 | 24 | 0 | rs/86 run 6 |
| Ashburn | direct | 03:17 | iad | none | 1,659-1,668 | 60 | 60 | 0 | 0 | [rs/86 run 7](https://github.com/bleugreen/rs-sdk/actions/runs/39583303736) |
| Ashburn | private relay | 03:17 | iad | none | 1,659-1,668 | 60 | 40 | 20 | 0 | rs/86 run 7 |
| Ashburn | direct | 04:04 | iad | none | 1,673 | 60 | 60 | 0 | 0 | [rs/98 pair](https://github.com/bleugreen/rs-sdk/actions/runs/39589100761) |
| Ashburn | private relay, **rs/98's fixed lite runner** (agent/rs-98-builder-0@589f7823, PR #78) | 04:06 | iad | none | 1,673 | 60 | **60** | 0 | 0 | rs/98 pair |
| Home (fedora) | direct, +0 ms | 04:00 | lax | 56-86 ms | 1,623-1,675 | 15 | 1 | 14 | 0 | fedora hour sampler 1; probe turnaround p50 0.3 ms (clean) |
| Ashburn | direct, lite on main after #78 | 04:13 | iad | none | 1,645-1,669 | 60 | 40 | 16 | 4 | [rs/86 run](https://github.com/bleugreen/rs-sdk/actions/runs/39590172234); publication p10 136 / p50 305 / p90 513 / max 824 |
| Ashburn | private relay, lite on main after #78 | 04:13 | iad | none | 1,645-1,669 | 60 | 40 | 20 | 0 | same run |
| Home (Mac) | direct, +0 ms, **host loaded** | 03:46 | lax | 56-86 ms | 1,674 | 15 | 0 | 14 | 1 | hour sample; probe turnaround p50 10 ms, p90 76 ms (normally under 1 ms), so not a clean reading |
| Ashburn VM (operator) | direct and relay | pending | | | | | | | | placeholder |
| Ashburn (Azure eastus2) | direct lite probe, reference for the row below | 04:24-04:26 | iad | none; TCP 6-7 ms | 1,670-1,677 | 60 | 49 | 11 | 0 | [rs/95](https://github.com/bleugreen/rs-sdk/actions/runs/39591572716) |
| Ashburn (Azure eastus2) | **browser tab, overlay to a loopback gateway** (rs/82 @ 8f98807c7, = #81); **overlay, burst minute: gate failed** (5.3 catch-ups per minute) | 04:26-04:27 | iad | none; TCP 6-7 ms | 1,670-1,677 | 60 | 33 | 27 | 0 | rs/95, same run; calm row pending |
| Ashburn (Azure eastus) | direct lite probe, reference for the row below | 04:47 | iad | none; TCP 3 ms | 1,685 | 60 | 60 | 0 | 0 | [rs/95](https://github.com/bleugreen/rs-sdk/actions/runs/39594411731); the in-page attempt itself produced no row (rs/97's pushed head lacked the page wiring) |
| Ashburn (Azure eastus) | direct lite probe, reference for the row below | 04:55 | iad | none; TCP 3 ms | 1,122-1,482 | 60 | 59 | 0 | 0 (1 lost) | [rs/95](https://github.com/bleugreen/rs-sdk/actions/runs/39595481831) |
| Ashburn (Azure eastus) | **browser tab, overlay to a loopback gateway, main 5575f37a5 (#81 + #78)**; gate failed on (c) only | 04:55 | iad | none; TCP 3 ms | 1,122-1,482 | 60 | **57** | 3 | 0 | rs/95, same run; page-side reaction p50 22 / p90 26 ms |
| Ashburn (Azure eastus) | direct lite probe, reference for the row below | 05:35 | iad | none; TCP 3 ms | 1,672-1,717 | 60 | 36 | 22 | 1 (+1 at 7) | [rs/95](https://github.com/bleugreen/rs-sdk/actions/runs/39600705668); gate failed on a, b, c (p90 473, max 1,457, 13.8 catch-ups per minute) |
| Ashburn (Azure eastus) | **browser tab, overlay to a loopback gateway, rs/113 @ 9c4c3c11e** (execute on arrival, decode on arrival); **burst minute: gate failed** | 05:38 | iad | none; TCP 3 ms | 1,672-1,717 | 60 | **38** | 20 | 2 | rs/95, same run; page-side reaction p50 7 / p90 8 ms; within 2 trials of direct |
| Ashburn run machine (AWS us-east-1c, c7i.2xlarge) | direct lite probe, reference for the row below | 10:45 | iad | none; TCP 2.0 ms | 1,615-1,616 | 60 | 57 | 3 | 0 | rs/130, [`data/browser-rows/host-20261021T1745-in-page/`](data/browser-rows/host-20261021T1745-in-page/); gate failed on (c): 8.7 catch-ups per minute |
| Ashburn run machine | **browser tab, in-page program, main ae6d5664d (#94's program host)**, headless Chrome 156; **burst minute: gate failed** | 10:46-10:47 | iad | none; TCP 2.0 ms | 1,615-1,616 | 60 | **53** | 7 | 0 | rs/130, same session; decision 1 ms, action packet out 0.7 ms p50 / 2.0 max after its tick; 0 catch-ups in its own 21 s window |
| Ashburn run machine | direct lite probe, reference for the row below | 12:45 | iad (iad2) | none; TCP 2.0 ms | 1,624-1,679 | 60 | 51 | 9 | 0 | rs/130, [`data/browser-rows/host-20261021T1945-in-page/`](data/browser-rows/host-20261021T1945-in-page/); gate failed on (a) and (c): 11.7 catch-ups per minute, p90 427 |
| Ashburn run machine | **browser tab, in-page program, main ae6d5664d**, headless Chrome 156; **burst minute: gate failed** | 12:47 | iad (iad2) | none; TCP 2.0 ms | 1,624-1,679 | 60 | **47** | 12 | 1 | rs/130, same session; decision 1 ms, action packet out 0.7 ms p50 / 2.5 max after its tick; 5 catch-ups per minute in its own window |
| Ashburn run machine | direct lite probe, reference for the row below | 13:15 | iad (iad2) | none; TCP 2.3 ms | 1,474-1,597 | 60 | 59 | 1 | 0 | rs/130, [`data/browser-rows/host-20261021T2015-overlay/`](data/browser-rows/host-20261021T2015-overlay/); gate failed on (c) only, narrowly: 2.4 catch-ups per minute (3 in 1.2 min), p90 363 |
| Ashburn run machine | **browser tab, overlay to a loopback gateway, main ae6d5664d**, headless Chrome 156; near-calm minute, gate failed on (c) | 13:17 | iad (iad2) | none; TCP 2.3 ms | 1,474-1,597 | 60 | **59** | 1 | 0 | rs/130, same session; equal to direct; page-side reaction p50 6 / p90 7 ms; 0 catch-ups in its own 19 s window |
| Ashburn run machine | direct lite probe, reference for the row below | 13:35 | iad (iad2) | none; TCP 2.3 ms | 1,593-1,603 | 60 | 41 | 17 | 1 (+1 lost) | rs/130, [`data/browser-rows/host-20261021T2035-in-page-oak/`](data/browser-rows/host-20261021T2035-in-page-oak/); gate failed on (a) and (c): 12.2 catch-ups per minute |
| Ashburn run machine | **browser tab, in-page program, main ae6d5664d**; **burst minute: gate failed** | 13:37 | iad (iad2) | none; TCP 2.3 ms | 1,593-1,603 | 60 | **51** | 7 | 2 | rs/130, same session; action packet out p50 1.1 / max 2.0 ms after its tick |
<!-- rs130-1115 -->

Runs 2, 4 and 7 used the same relay path from the same region; 51/9, 32/28 and 40/20 show how
much that path varies between draws. Across the three paired Ashburn runs the direct path landed
180 of 180, and the relay 72 of 120 on the next tick.

**An `iad` edge does not by itself mean Ashburn.** The Quebec runner reached the demo through the
`iad` edge with no mesh hop, but with a 24 ms TCP connect, and it missed 4 of 60 on the direct
path. The run-night gate must check the connect time as well as the edge (section 10).

Publication intervals (tick state to tick state at the client) were p10 196-245 / p50 245-306 /
p90 348-407 / max 486-879 ms across the runs before 04:13, and p10 136 / p90 513 / max 824 at 04:13.

**Long ticks are a cause, and they hit every client.** An earlier draft of this document ruled
them out, because three Ashburn direct runs landed 60 of 60 even across an 879 ms tick interval.
That was wrong: those runs simply had few overruns. At 04:13 the same Ashburn setup gave direct
40/16/4. The mechanism is the engine's catch-up (section 2): after a tick that overruns, the next
starts almost at once, so there is no idle gap for a reaction to the long tick. A single long
interval does no harm by itself; what does harm is the back-to-back tick after it. This is
load-dependent and placement-independent: no placement and no client avoids it.

Per trial, for the Ashburn direct runs that carry per-trial fields (02:48, 03:17, 04:04, 04:13; 231
trials at +0 ms; `demo-latency-analyze.ts` over rs/86's `direct.json` artifacts), by the interval
from the trigger frame to the next frame:

| Next tick arrived | Missed the next tick | Of which at 04:13 |
| --- | --- | --- |
| under 50 ms after (back to back) | 5 of 5 | 5 of 5 |
| 50-200 ms after | 9 of 24 | 9 of 9 (the calm runs: 0 of 15) |
| 200 ms or more after | 6 of 171 | 6 of 46 (the calm runs: 0 of 125) |

So P(miss | next interval under 200 ms) = 14/29 = 48% (100% at 04:13), against P(miss | otherwise)
= 6/171 = 3.5%, all from the overloaded run. cairn://p/rs/102's finer cut over 255 trials puts the
edge at about 150 ms: next interval under 50 ms, 5 of 5 missed; 50-100, 4 of 4; 100-150, 3 of 4;
150-200, 2 of 16; 200-250, 1 of 21; 250 or more, 9 of 205. A bare count of intervals under 200 ms
is no use as a signal (clean minutes have 6-18 of them from arrival jitter alone); the signal is a
**catch-up**: an interval under 150 ms immediately after one over 350 ms. These were measured at
300 ms ticks; the gate now states them as fractions of the tick length T, under 1/2 T after over
7/6 T (section 10).

**Counting ticks from raw frames needs care.** The demo sends small non-tick frames (1-4 bytes)
between ticks, and a catch-up tick can arrive within a few ms of the one before it. Grouping
frames 60 ms apart into ticks, as the probe's `frameStats` first did (its old `under200` field),
hides catch-up ticks inside their predecessors. The scripts now group frames of at least 5 bytes
that arrive under 8 ms apart, which rs/102 measured recovering 99.4% of decoded ticks. Even so,
raw-frame reconstruction is noisy by about one catch-up per minute (it reads 0.8-1.6 per minute
in runs that rs/102's decoded ticks count as 0), so a gate should count from decoded ticks. The misses at 04:13 that followed a normal interval
mostly came after a long previous tick (2 of the 5 trials whose previous interval exceeded 400 ms).
The Quebec runner's 4 misses all followed normal intervals; its 24 ms connect, not overruns,
explains them.

### The margin after a frame, read from the delay sweep

Ticks to land, 15 trials per added delay `r`, direct path:

| Added delay `r` | Home (Mac), 02:45, 1,660 online: 1 / 2 / 3 | Ashburn (rs/86 run 5), 02:49, 1,564-1,672 online: 1 / 2 / 3 |
| --- | --- | --- |
| +0 ms | 10 / 5 / 0 | **15** / 0 / 0 |
| +25 ms | 1 / 14 / 0 | 13 / 2 / 0 |
| +50 ms | 1 / 13 / 1 | 9 / 6 / 0 |
| +75 ms | 0 / 15 / 0 | 2 / 13 / 0 |
| +100 ms | 0 / 15 / 0 | 1 / 14 / 0 |
| +150 ms | 0 / 15 / 0 | 0 / 15 / 0 |
| +200 ms | 0 / 11 / 4 | 0 / 13 / 2 |

The margin a client has after the tick-T frame arrives, `W - RTT`, is what this sweep reads
directly. **From Ashburn it is about 50 ms at the median** (87% of ticks give at least 25 ms, 60%
at least 50 ms, 13% at least 75 ms). **From home it is 0-25 ms on about 60% of ticks and negative
on the rest.** Trials at +200 ms that slipped to 3 ticks, from both places, need a margin below
about -100 ms on those ticks: an occasional long cycle.

The two sweeps do not fit a single `W` with a home RTT of 90 ms: that would leave home a margin
of about -36 ms and no next-tick reactions, yet home got 10 of 15. Either the game socket's real
home RTT is nearer 50-60 ms than Fly's `mrtt` suggests, or the frame for each account leaves the
engine at a different point in the output batch (accounts are flushed one after another in
`processClientsOut`), or the load differed between the two minutes. This is listed as open; the
measured per-vantage margins are what the recommendation uses.

**22 October, 400 ms ticks.** The demo has run 400 ms ticks since its 19:56:28Z restart (the
spectator feed's hello reads `tickMs: 400`; section 9). The same sweep from the run host at
20:35-20:39Z (token `mvjz3zys`, 1,255-1,329 online, 10 trials per delay run up then down, so 20
per delay, SPEEDRUN_TICK_MS=400, no restart during the sweep):

| Added delay `r` | Run host, 22 Oct 20:35Z, T = 400 ms: 1 / 2 ticks |
| --- | --- |
| +0, +25, +50, +100 ms | 20 / 0 at each |
| +150 ms | 18 / 2 |
| +200 ms | 13 / 7 |
| +250 ms | 13 / 7 |

The margin after a frame is now above 250 ms at the median, over 0.6 T, against about 50 ms (0.17 T)
on 21 October at 300 ms. The tick grew by 100 ms but the margin by about 200 ms, so the engine's
work per tick also fell, to roughly 150-200 ms from about 250. The probe's warm GETs agree: the
engine answered a GET in 4-48 ms (median) when it arrived 0-150 ms after a frame, and in 94-174 ms
when it arrived 200-350 ms after, which is a busy stretch of about 200 ms at the end of each 400 ms
cycle. The fall in work fits the lower population (about 1,250-1,350 online against 1,650-1,800,
after the per-address cap went from 100 to 50 at the same restart), but the engine is also
running unpublished code since 19:36Z, so the two can't be separated from here (inference). At
this margin (a) is close to certain on any calm minute, and next-tick reactions no longer depend
on sending within a few ms of the frame. Raw output:
[`data/sweep-runhost-20261022T2035/`](data/sweep-runhost-20261022T2035/) (`sweep.json`, `summary.txt`).

The blind senders (section 6) agree with the sweeps: from home, sends within 50 ms of a frame hit
the next tick 86% of the time and later sends never did; from Ashburn, 76% within 50 ms, 43% at
50-100 ms, 12% at 100-150 ms, and none later.

## 4. HTTP and websocket timing

From fedora at 02:37 (1,648-1,653 online), 40 fresh connections per target, spaced about 3 s apart:

| Target | TCP connect p50 | TLS done p50 | First byte p10 / p50 / p90 / max | First byte - TLS - `mrtt` p10 / p50 / p90 / max |
| --- | --- | --- | --- | --- |
| Engine, 404 path (`https://host/...`) | 20 ms | 49 ms | 148 / 214 / 402 / 543 ms | 19 / 108 / 275 / 422 ms |
| Gateway process, fallback text (`https://host:7443/...`) | 22 ms | 49 ms | 208 / 607 / 1,545 / 2,100 ms | 91 / 482 / 1,412 / 1,983 ms |

| Websocket handshake, fresh TCP + TLS + upgrade (fedora, 6 each) | p10 | p50 | p90 |
| --- | --- | --- | --- |
| Game path `wss://host/` (engine) | 153 ms | 252 ms | 459 ms |
| Relay `wss://host/gateway` (engine, then gateway) | 139 ms | 273 ms | 468 ms |
| Gateway direct `wss://host:7443` | 155 ms | 276 ms | 611 ms |

From Ashburn (rs/86 run 2), with about 3 ms of network, the engine's 404 first byte minus TLS was
spread roughly evenly from about 30 to 380 ms. That is the engine's event-loop wait, and it says
the thread is busy for most of each tick. It is wider than the reaction data allows for game
sockets (Ashburn's ~50 ms margin after each frame means the thread reads game input for a good
part of every tick), so HTTP requests
probably also queue behind other work served between cycles (other users' HTTP, the `/gateway`
relay, the world feed). That is inferred and listed as open.

Warm keep-alive requests from the Mac, placed against tick phase (02:45, 49 each): engine 404
p50 203 ms with no clear phase dependence; gateway p50 465 ms, p90 1,676 ms, max 4,775 ms.

The gateway's fallback response is a short static text, yet it waits hundreds of ms beyond the
network. **The public gateway process is saturated.** Anything routed through it, including the
browser's bot overlay (section 7), pays that wait.

## 5. Decomposition

Home (Mac or fedora, Los Angeles edge) at about 1,650 online, and what changes in Ashburn.

| Part | Home | Ashburn | Fixed or placement-dependent | Basis |
| --- | --- | --- | --- | --- |
| Client to Fly edge, one way | ~10 ms | ~1 ms | placement | TCP connect p50 20 ms; mtr 21 ms; Ashburn TCP 2-3 ms |
| Fly edge to app over the mesh, one way | ~35 ms | 0 (no mesh hop) | placement | `mrtt` p50 70 ms |
| Fly proxy processing | a few ms | a few ms | fixed, small | Ashburn TLS done at 25 ms with TCP at 2-3 ms; not separated further |
| **Network round trip (RTT)** | **~90 ms** | **~3-5 ms** | placement | sum of the above |
| Margin after the frame, `W - RTT` | 0-25 ms on ~60% of ticks, negative on the rest | ~50 ms median (25 ms on 87%, 75 ms on 13%) | placement and load | delay sweeps, section 3 |
| Engine busy part of the tick, and occasional long cycles | most of each tick; some cycles run past 300 ms | same | load (player count), not placement | sweeps at +200 ms; HTTP waits, section 4 |
| Input read | once, at cycle start, after `processWorld` | same | fixed | `World.ts` |
| Output flush | once, near cycle end | same | fixed | `World.ts` |
| Client turnaround, direct in-process | 0.3-0.6 ms p50, under 25 ms max | same | fixed | probe `reactMs` |
| Client turnaround, private SDK relay, before rs/98's fix | 73 ms p50 (p10 46, p90 511) | same | fixed by client code; tails by host load | relay trace below |
| Client turnaround, browser tab overlay to a loopback gateway (rs/82 @ 8f98807c7) | 22 ms p50 (28 p90): state out 7, gateway and SDK round trip 6, overlay drain to packet out 10 | same | fixed by the page's ~20 ms game loop | rs/95, Chrome DevTools frame times |
| Client turnaround, browser tab overlay after rs/113 (9c4c3c11e: execute on arrival, decode on arrival) | 7 ms p50 (8 p90): state out 1, gateway and SDK round trip 5, overlay drain to packet out 1 | same | fixed by the SDK script's round trip | rs/95, Chrome DevTools frame times, 05:38 |
| Client turnaround, private SDK relay, after rs/98's fix | 1.7 ms p50 (2.0 p90) frame to wire, local lab; state collection (3 ms p50, 40 ms p90) now runs after the send | same | fixed by client code | "After the relay fix (rs/98)" below |
| Public gateway wait | +340-2,000 ms per request | same | load on the demo | section 4 |

**Threshold for a 1-tick reaction:** client turnaround `r` < `W - RTT`. At home that is 0-25 ms on
most ticks and negative on the rest, so even a perfect client lands on the next tick only about
two times in three. In Ashburn it is about 50 ms at the median and at least 25 ms on 87% of ticks.

**Distribution in Ashburn:** direct, all on the next tick (measured 180 of 180 across three paired
runs). Private relay, about 60% (measured 51/9, 32/28, 40/20), because the relay's 46-73 ms typical
turnaround sits right on Ashburn's ~50 ms median margin, and its tail runs past it.

### Where the relay's time goes (Mac, private relay, 02:53, 60 trials)

`relay-trace-preload.ts` wraps the lite runner's `LiteClient` methods and both processes'
websockets at runtime (`bun --preload`, no change under `server/` or `sdk/`), and
`relay-latency.ts` records the SDK side of each trial. All times are on one clock. Each hop is
measured from the previous one, in ms:

| Hop | p10 | p50 | p90 | max | Where |
| --- | --- | --- | --- | --- | --- |
| Game frame arrives, then the lite session drains it | 0.1 | 0.6 | 24.9 | 161 | `session.ts:212` sleeps `LOOP_MS = 20` between drains |
| State collection (`collectBotState`, ~36 KB of JSON) | 1.1 | 3.1 | 39.6 | 106 | `runner.ts:289-291` |
| Gateway forwards state to SDK | 0.8 | 1.1 | 8.1 | 193 | `gateway.ts` (loopback) |
| SDK parses, script decides, SDK sends | 0.3 | 0.4 | 0.8 | 6 | `sdk/index.ts` |
| Gateway forwards action to lite runner | 0 | 0.5 | 162 | 1,049 | `gateway.ts` (loopback) |
| Action waits for the runner's tick | 0.2 | **19.6** | 46 | 504 | `runner.ts:84` `setInterval(tick, TICK_MS = 20)` (`runner.ts:29`) |
| Executed, then waits for the session loop's flush | 20.6 | **22.1** | 80 | 387 | `walkTo` is synchronous; bytes go out at `session.ts:192` |
| **Frame arrival to packet on the wire** | **46** | **73** | **511** | **1,121** | |

Trials that landed in 2 ticks had a median total of 64 ms; 3 ticks, 228 ms; 4 ticks, 594 ms.

**The cause is the send path, not the publication cadence.** State reaches the SDK script about
5 ms after the frame arrives at the median. The publication interval's p50 of about 300 ms is
simply the server's tick as the client sees it. About 40 ms of fixed delay comes from the lite
runner's two timers: the action waits for the next 20 ms runner tick, then for the next 20 ms
session flush, and the two timers run in near-lockstep, so together they cost close to their full
periods rather than half. Up to 20 ms more comes from the inbound poll. The large tails (gateway
forwarding at 162 ms p90, runner waits up to 500 ms) are event-loop stalls on a busy host: the Mac
was running about a dozen other jobs.

**A relay fix is plausible.** Three changes in the lite runner, none in the gateway or the SDK,
would remove the fixed part (this is diagnosis only; nothing was changed):

1. Execute a gateway action when it arrives (`runner.ts`, `handleMessage` to `onAction`, lines
   159-184), instead of on the next `setInterval` tick (`runner.ts:84`).
2. Flush the game socket right after executing (`GameConnection.flush`), instead of on the next
   session loop (`session.ts:192`).
3. Drain the game socket on its message event, as the probe does, instead of every 20 ms
   (`session.ts:212`).

What would remain is state collection (3 ms median, 40 ms p90) and two loopback hops of about
1 ms. That would put the relay at about 5-10 ms typical, inside Ashburn's ~50 ms median margin
(the direct path landed 13 of 15 even at +25 ms), with state collection's tail as the remaining
risk. That prediction is inferred and needs the
same paired Ashburn sample to confirm. The browser tab has the same class of delay: its overlay
executes queued actions in the draw loop (`Client.gameDraw`, `BotOverlay.tick`, about 14-20 ms
frames) and publishes through the engine's `/gateway`, which is why main chose in-page programs
for the reactive steps (section 7).

### After the relay fix (rs/98)

rs/98 made the three changes above. The lite runner executes a gateway action on arrival and flushes the game socket before it collects and publishes state. The session drains on the socket's message event. The 20 ms client cycle is kept for the frame counter, keepalive and idle watchdog only.

Local traced lab (bgsrv-mac, NODE_TICKRATE=300, this section's tracer, 60 trials): frame arrival to packet on the wire went from 56.4 ms p50 (63.3 p90) on main to 1.7 ms (2.0). The action-wait and flush-wait hops fell from about 21 ms each to 0.

Ashburn pair (Azure eastus, edge iad, TCP p50 3 ms, 1,673 online, 04:04-04:06 PDT, lite_ref agent/rs-98-builder-0@589f7823; https://github.com/bleugreen/rs-sdk/actions/runs/39589100761): direct 60:0:0, relay **60:0:0**, against unfixed relay baselines of 32:28 (run 39579095329, 02:43) and 40:20 (03:17). SDK send resolve is 0 ms p50 and 2 ms max, down from 20. State collection (3 ms p50, 40 ms p90 on a loaded host) is now the only client-side cost between a frame and the reaction. It no longer sits between the action and the wire. It cost no tick in these 60 trials, but one sample can't rule out its tail; run-night re-measures keep testing it.

## 6. Burst and blind sending

Both modes walk inside a 2 by 2 block of open ground (Lumbridge courtyard). Every tile of the
block is adjacent to every other, so the position at a tick names the last packet the server
processed. A packet that never shows was absorbed by the next one on the same tick.

**Burst** (`--phases=burst`): on a fresh tick, three walks sent 0, 70 and 140 ms after the frame.

| Vantage | PDT | Online | Bursts | Packet 0 ticks after T | Packet 1 relative to packet 0 | Packet 2 relative to packet 0 |
| --- | --- | --- | --- | --- | --- | --- |
| Home (Mac), direct | 02:44 (smoke) | 1,652 | 4 | 2:3, 3:1 | same tick 4 of 4 | same tick 4 of 4 |
| Home (Mac), direct | 02:47 | 1,660 | 20 | 1:6, 2:13, 3:1 | same 16, +1 tick 4 | same 11, +1 tick 9 |
| Ashburn, direct | 02:49-02:56 | 1,564-1,672 | 20 | 1:20 | same 9, +1 tick 11 | same 1, +1 tick 19 |

From Ashburn the first packet always makes the next tick. A packet sent 70 ms after the frame
misses it about half the time, and one sent 140 ms after almost always does: the input-read cut
falls 50-100 ms after the frame arrives, as the sweep says. From home the cut falls much earlier,
so most of a burst lands together one tick later. Either way, **a multi-packet bundle that must
share a tick (the knife's starter plus its button) has to go out as one flush, immediately on the
frame**, not spread across the tick.

**Blind every-tick sender** (`--phases=blind`): 200 walks on a fixed 300 ms clock, not waiting for
state (the knife loop's shape), each aimed at the tick after the latest one seen.

| Vantage | PDT | Online | Sends | On the aimed tick | +1 tick | +2 ticks | On-aim share by send time after the frame |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Home (Mac), direct | 02:44 (smoke) | 1,652 | 40 | 0 | 39 | 1 | 0% at every phase |
| Home (Mac), direct | 02:47 | 1,660 | 200 | 31 (16%) | 158 (79%) | 11 (6%) | 0-50 ms: 86%; 50-100 ms: 8%; later: 0% |
| Ashburn, direct | 02:49-02:56 | 1,564-1,672 | 200 (20 absorbed) | 45 (23%) | 155 (78%) | 0 | 0-50 ms: 76%; 50-100 ms: 43%; 100-150 ms: 12%; later: 0% |

A free-running 300 ms clock drifts against the server's ticks, which are not exactly 300 ms, so its
sends fall at every phase of the tick and only the early ones make the aimed tick: 23% even from
Ashburn. The dominant offset is +1 tick at 78-79% from both places. Section 8 uses that share.
**An in-page tick program should send on the frame's arrival, not on its own clock**: from Ashburn
that lands 15 of 15 (sweep at +0) where the free-running clock lands 23%.

### Decode cap: how many actions one tick applies (22 October)

The engine reads a player's buffered input once per tick and stops at the first category to
reach its limit: `userLimit < 5`, `clientLimit < 20`, `restrictedLimit < 2`
(server/engine/src/engine/entity/NetworkPlayer.ts:69, limits in
server/engine/src/network/game/client/ClientGameProtCategory.ts:5-8). Whatever is left stays in
the socket buffer and is read at the start of the next tick. Only a USER_EVENT whose handler
returns true counts as one; a failed one counts toward the client limit (NetworkPlayer.ts:141-147).
A packet with no decoder, such as NO_TIMEOUT, counts toward nothing (NetworkPlayer.ts:136).

`docs/speedrun/scripts/decode-cap-probe.ts` measures the cap instead of reading it. It logs in on
the lite client's direct game socket (no gateway relay). On the frame of a settled tick it writes
a whole burst as one websocket message, so the server reads every packet of it at the same input
read. Then it reads the inventory frames tick by tick:

- **user N**: N chained INV_BUTTOND drags (opcode 253, USER_EVENT per
  server/engine/src/network/game/client/model/InvButtonD.ts:5) of one tracer item, an item held
  once, slot p to p+1 to p+2 and so on. `[inv_buttond,inventory]` runs inline
  (InvButtonDHandler.ts:49-52, then `inv_movetoslot` in player/scripts/inventory.rs2), so the
  tracer's slot in a tick's frame is the number of drags applied by then.
- **client K**: a drag, K EVENT_CAMERA_POSITION (opcode 193, CLIENT_EVENT, only recorded by
  InputTracking), then a second drag. The second drag shares the first one's tick only if the
  client limit was not reached first.
- **failed K**: a drag, K drags out of an empty slot (InvButtonDHandler.ts:35-38 returns false),
  then a second drag.
- **ifbutton N** (lab only): N clicks of Charge, IF_BUTTON 1193 (opcode 86, USER_EVENT,
  model/IfButton.ts:5), the click rs/466 sent. Casts are counted from the drop in the blood-rune
  stack. `[if_button,magic:charge]` casts inline: `settimer`, runes and xp in one script, with
  no queue (skill_magic/scripts/spells/charge.rs2:1-26).

There were three repeats of each, and every one is in
`docs/speedrun/research/data/decode-cap-20261022/` with the account name redacted. A cell gives
the actions applied in the landing tick / the next tick / later.

| Class | N (or K) | Lab (fedora, T = 300) | Demo (fedora, direct, T = 400) |
| --- | --- | --- | --- |
| user (drag) | 5 | 5 / 0 / 0 (3 of 3) | 5 / 0 / 0 (3 of 3) |
| user (drag) | 6 | 5 / 1 / 0 (3 of 3) | 5 / 1 / 0 (3 of 3) |
| user (drag) | 8 | 5 / 3 / 0 (3 of 3) | 5 / 3 / 0 (3 of 3) |
| ifbutton (Charge) | 5 | 5 / 0 / 0 (3 of 3) | not run (no Charge on a throwaway) |
| ifbutton (Charge) | 6 | 5 / 1 / 0 (3 of 3) | not run |
| ifbutton (Charge) | 8 | 5 / 3 / 0 (3 of 3) | not run |
| client: drag + K camera + drag | 5, 6, 8, 19 | 2 / 0 / 0 (3 of 3 each) | 2 / 0 / 0 (3 of 3 each) |
| client: drag + K camera + drag | 20, 21 | 1 / 1 / 0 (3 of 3 each) | 1 / 1 / 0 (3 of 3 each) |
| failed: drag + K failed drags + drag | 5, 8 | 2 / 0 / 0 (3 of 3 each) | 2 / 0 / 0 (3 of 3 each) |

In the lab every burst went out 0.1-0.9 ms after the frame and landed on the next tick. The lab
reproduces the fork's rule exactly, which validates the method. Charge behaves like the drag, so on
our engine nothing in its script holds it to one cast per tick.

The demo run was one session, 23:26:41-23:28:21Z on 22 October, from fedora (a home address) on
the direct game socket. The page token was mvjz3zys before and after (no restart). Tick
intervals ran p10 289, p50 400, p90 516 ms over 236 ticks. Every burst went out as one write
0.2-0.8 ms after its frame (one at 5.9 ms). The account's inventory was empty, so the probe's
`--bank` mode borrowed one item from its own bank at a Varrock west booth and deposited it back
before a confirmed logout. Five of 33 repeats first showed on the second tick after the send
instead of the first. That is path latency (the whole burst arrived after that tick's input
read); the split within the landing tick was the same as in the others.

**Rule, measured on the demo engine as of 22 October 23:27Z: at most 5 successful user events per
tick and at most 20 client events (failed user events included). The rest carry over to the next
tick, in order. Nothing is dropped.** The cap is the fork's, unchanged by the engine change of
19:36Z.

**On the demo, through the run's own path.** rs/396 re-ran rs/287's Father Aereck driver
(`speedrun/lab/quests/aereck-burst.ts <acct> --launch --client=browser`) at 20:52:46-20:54:43Z on
22 October. That was after the 19:36Z engine change, at T = 400, with demo token mvjz3zys. It ran on
the browser client: headless Chrome on the run host through a loopback gateway.ts and proxy.ts,
with served bundle client.js md5 9e1fe24a. Dialogue continue is RESUME_PAUSEBUTTON, a USER_EVENT
(model/ResumePauseButton.ts:5), and the driver sends a burst's k continues in one volley
(speedrun/lib/dialogue.ts:221). **All 24 bursts landed in their sending tick, 8 of them five-page
bursts**, and every burst talk took 8.00 ticks, the floor. A deferred fifth page would read 9.00
(rs/185's analysis, cairn://p/rs/185/1/coordinator/task/burst-cap/artifact). So the demo engine
decoded five user events in one tick on the browser path. That is the measurement main's pricing
ruling of 5 rests on.

The browser row is a dialogue burst, not a drag burst. A drag-level browser row would need an
in-page program that sends N drags on one tick. BotAction has no drag action, and
`window.rsPrograms` starts only registered programs (server/webclient/src/bot/programs/host.ts
`controls`), so that needs a webclient change. The in-page runtime also refuses a sixth send in a
tick on its own (`USER_EVENTS_PER_TICK = 5`, server/webclient/src/bot/programs/runtime.ts), so a
program can't probe past 5 there anyway.

rs/466's Charge result (5 clicks via the gateway relay, 4 casts in the tick and the 5th 'a few
ticks later') is not the decode cap. The demo applies 5 drags in one tick, and on the lab Charge
behaves exactly like the drag. Of rs/83's candidates, (a), a lower cap, is out on the demo, and
(c), a script queue, is out on our engine. That leaves (b), the relay delivering the five clicks
across a tick boundary, or a demo-side change specific to spells, which a throwaway can't test.

## 7. The browser tab's sockets, and the route the run's input must take

On the demo, the browser webclient opens two sockets:

- **Game socket**: the engine's own websocket at `wss://<page host>/`
  (`server/webclient/src/client/Client.ts:4191`, `ClientStream.openSocket` in
  `server/webclient/src/io/ClientStream.ts:9-12`). Clicks made by hand go straight out here.
- **Bot overlay gateway socket**: `wss://<page host>/gateway`
  (`server/webclient/src/bot/GatewayConnection.ts:71-76`), the engine-relayed path, not the direct
  port 7443. Confirmed live at 02:45: `https://rs-sdk-demo.fly.dev/bot` loads `./bot/client.js`
  (556,749 bytes), which builds that URL and never mentions 7443. The engine's `/gateway` is a
  proxy inside the engine process (`server/engine/src/web/websocket.ts:35-49, 116-175`).

So a script-driven tab served by the demo reacts through engine socket, tab, `/gateway` relay on
the tick thread, the saturated gateway, the SDK, and back the same way. That is worse than every
path measured above.

**Decided route (cairn://p/rs/main, via rs/83):** our fork's webclient is served on the run host.
Its game socket goes to `wss://rs-sdk-demo.fly.dev/`, and its bot overlay goes to a loopback
gateway on the run host. The engine upgrades the client socket at `/` and `/bot` with a plain
`server.upgrade` and no origin check (`server/engine/src/web/websocket.ts:72-80`, read by main), so
a page served from another origin can connect. A tab loaded from rs-sdk-demo.fly.dev itself cannot
be used, because it runs the demo's own build. The reactive steps (knife loops, the 2-tick
pickpocket re-click, Agility obstacles, the probe) run inside the page on the game socket
(cairn://p/rs/82 and cairn://p/rs/97). The SDK drives only the non-reactive steps through the
loopback gateway. rs/82 owns the implementation.

**The overlay path, measured (rs/95, Ashburn, 04:24-04:37).** With rs/82's build (8f98807c7, =
#81) the tab's overlay talks to a loopback gateway, and a script drove it with
`tickmanip-latency.ts --no-tele`. The page-side reaction is a steady 22 ms at the median (28 ms
p90): 7 ms from the tick's frame to the state going out, 6 ms for the gateway and SDK round trip,
and 10 ms from the action arriving to the game packet going out, the first and last tied to the
page's ~20 ms game loop. On-time and late trials took the same time (21 against 24 ms), so the
misses came from the minute's overruns (5.3 catch-ups per minute), not from slow hops. Still, in
that minute 22 ms was enough to lose a tick 45% of the time (33/27) where the 0.3 ms direct path
lost 18% (49/11). cairn://p/rs/113 makes the overlay execute on arrival and decode on arrival,
which removes the game-loop part of that 22 ms; these rows predate it.

In a calmer minute (04:55, main 5575f37a5 with #81 and #78, 1,122-1,482 online, gate failing only
on 2 catch-ups), the overlay landed **57 of 60** next to the direct path's 59 of 60, with the same
22 ms page-side turnaround (p90 26). So the overlay to a loopback gateway is close to direct in a
calm minute and loses badly in a burst. Knife woodcutting over it in that run read 13.49 ticks per
log, 8.17 per expected roll (59 logs at Woodcutting 64 and up, in a window with 2.1 catch-ups per
minute and one 1.87 s gap); section 8 has the plain control taken later.

**With rs/113's overlay (05:35-05:45, 9c4c3c11e, 1,672-1,717 online).** Executing gateway actions
on arrival and decoding ticks on arrival took the page-side reaction from 22 ms to **7 ms p50**
(8 p90): the tick's frame to the state going out fell from 7 ms to 1, and the action's arrival to
the game packet going out from 10 ms to 1. What is left is the gateway and SDK script round trip
(5 ms). The minute was a heavy burst (gate failed on all three criteria, 13.8 catch-ups per
minute), and the overlay landed 38/20/2 against the direct path's 36/22/1 on the same runner, so
within rs/113's two-trial bar but not yet a calm-minute row.

**Browser rows on main (rs/130).** Main has carried rs/113's overlay since #90 and rs/97's program
host since #94. The rows were first taken from GitHub's Ashburn runners and then, once it existed,
from the run machine itself (AWS us-east-1c, TCP p50 2 ms to the demo, headless Chrome 156,
`~/rs130/session.sh`, which runs the workflow's browser mode by hand under a hard 595 s stop and a
`~/host-reserved.json` sentinel; copy in
[`data/browser-rows/host-scripts/`](data/browser-rows/host-scripts/)); rs/176 reran it from
14:45. Until 15:45 every minute measured failed the gate; 15:45 is the first in-page row in a
gate-passing minute:

| PDT, host | Variant, page from | Direct (gate) | Browser | Page side |
| --- | --- | --- | --- | --- |
| 09:10, GitHub eastus (history) | overlay, main 85a28dc8d | 59/1/0, 10.8 catch-ups/min (burst) | **60/0/0** | tick output in to game packet out p10 3 / **p50 5** / p90 8 / max 21 ms: page publication 1, gateway and SDK script 3, overlay flush 1 |
| 09:51, GitHub eastus (history) | in-page, main c9a6c31be | 53/6/1, 13.2/min (burst) | 46/11/3 | decision (`react`) p50 2 ms; game loop 75/s (p10 71, min 22); 8 catch-ups over the probe |
| 10:45, run machine | in-page, main ae6d5664d | 57/3/0, 8.7/min (burst) | 53/7/0 | decision p50 1 ms; action packet out p50 0.7 / max 2.0 ms after its tick; loop p10 72/s, min 37.5; 0 catch-ups in the probe's window |
| 12:45, run machine | in-page, main ae6d5664d | 51/9/0, 11.7/min (burst) | 47/12/1 | decision p50 1 ms; action packet out p50 0.7 / max 2.5 ms after its tick; 5.0 catch-ups/min over the probe |
| 13:15, run machine | overlay, main ae6d5664d | 59/1/0, 2.4/min (fails (c) narrowly) | **59/1/0** | tick output in to game packet out p10 5 / **p50 6** / p90 7 / max 33 ms: page publication 1, gateway and SDK script 4, overlay flush 0; 0 catch-ups in the probe's window |
| 13:35, run machine | in-page, main ae6d5664d | 41/17/1, 12.2/min (burst) | 51/7/2 | action packet out p50 1.1 / max 2.0 ms after its tick; 7.0 catch-ups/min over the probe |
| 14:45, run machine | in-page, main c14428fc5 | 57/3/0, 3.9/min (burst) | 58/2/0 | decision p50 1 ms; loop p10 72.5/s, min 42.9; program counter 1 catch-up over the probe's 62 ticks |
| 15:15, run machine | in-page, main c14428fc5 | 56/4/0, 4.5/min (burst) | 52/8/0 | decision p50 1 ms; loop p10 72.1/s, min 68.2; program counter 2 catch-ups over 68 ticks, one of them a tick 7 ms after a 451 ms one |
| 15:45, run machine | in-page, main c14428fc5 | **58/2/0, 0.7/min (gate pass)** | **60/0/0** | decision p50 1 ms; loop p10 72.4/s, min 71.2; program counter 0 catch-ups over 60 ticks (p90 380, max 523 ms) |
<!-- rs130-1115-s7 -->

**The calm-minute in-page row (rs/176, 15:45 PDT = 22:45 UTC).** In the first session whose direct
reference passed the gate, the in-page probe landed **60 of 60** on the next tick, against the
direct path's 58: in a calm minute the page path loses nothing to the direct reference. In the two
burst sessions before it the page landed 58 and 52 of 60 against direct's 57 and 56. All three
rows: run machine, edge iad, TCP connect p50 1.8-2.0 ms, 1,423-1,635 online, page built once at
main c14428fc5 (rs/159's per-log marks, before rs/175's oak lock window), probes from 5ed37d629,
the route to the demo plain (per-route quickack not applied, its delayed-ACK mechanism refuted by
the host thread's capture); data in `data/browser-rows/host-20261021T{2145,2215,2245}-in-page-oak/`,
with each session's raw frame arrivals (`page/frames.jsonl`, epoch ms), the direct reference's
(`direct.json`), its TCP state and its crowd (`crowd.jsonl`: 6-28 other players within 15 tiles
throughout, so the account was never alone). One timing to know for back-to-back logins: after the
page closes its game socket, the account stays listed on `/playerpositions` for about 2.5 minutes
(22:21:54 to 22:24:27 UTC).

The overlay's page-side reaction is now **5-6 ms at the median**, against 22 ms before #90 and 7 at
05:38; what is left is the gateway and SDK script round trip. At 13:15, in the calmest minute
measured on the run machine (direct 59/60, 2.4 catch-ups per minute), the overlay landed 59/60,
equal to direct, which closes rs/113's two-trial check. Its 60/60 came in a 21 s probe window
that itself saw 0 catch-ups, so it is a fair reading of the path even though the direct row's
minute failed.

**The in-page program sends at once.** Matching the 60 outbound 9-byte walk packets in Chrome's
frame log to the 60 trials (`docs/speedrun/scripts/page-send-delays.ts`), every action packet at
10:45 left 0.6-2.0 ms after the first frame of the tick it reacted to, the late trials no slower
than the on-time ones. The 140 ms p90 that `demo-browser-page.ts frames` prints for "game packet
out after its tick's output arrived" is a different population: 46 of the 106 outbound frames in
the window are the client's own traffic (44 of them 3 bytes, p50 146 / p90 323 ms after a tick),
not decisions, so that line must not be read as a send delay. The 7 late trials instead had a
short next interval (123-336 ms, median about 208, against 285 for on-time trials), most after a
430-490 ms tick: overrun and catch-up pairs too soft for the gate's 350/150 rule, which scored the
window at 0. The 12:45 session repeated the pattern: all 60 action packets out within 2.5 ms of
their tick, and 11 of the 13 late trials right after a tick of 365-705 ms followed by one of
66-241 ms (on-time trials' next interval p50 343), of which only 5 meet 350/150. Whether such soft
pairs should count is open (rs/102 is testing a soft-pair rule against its series; cairn://p/rs/142
looked at the in-page side and closed), and is not a diagnosis yet.

## 8. Knife-loop analysis (question 4)

Not re-measured here. rs/62 (merged, PR #71) built the run-time host gate
(`speedrun/lib/hostgate.ts`) and measured the knife on the demo from bbs; its results are in
`docs/speedrun/skills/tick-manipulation.md` on the rs/2 branch, "Run-time host gate".

The points from rs/62 that decide the question:

- **A constant latency costs nothing.** The predicted loops anchor every starter on their own
  bootstrap click, so if every packet takes L ticks the whole schedule shifts by L and the lock
  holds. A schedule anchored on an observed roll must send early by the dominant offset minus 1.
- **A late starter costs about one plain cycle and does not lose the lock**, because the knife's
  write is absolute (`cut_logs.rs2:83-85`). Measured on bbs with 15% of starters held one tick:
  iron 3.51 ticks per ore against 3.53 on time and 3.84 plain; willow 5.76 against 5.03 and 5.84;
  fly 4.92 against 3.86 and 6.61.
- **Decision rule:** manipulate when `3 + (1 - p) * missCost < plainCycle`, where `p` is the share
  at the dominant offset. That needs `p` above about 0.75 for Woodcutting, 0.60 for fly fishing,
  and 0.39 for the iron rotation.
- **Demo check from bbs through the relay:** 480 probe trials, 139 / 336 / 5 at 1 / 2 / 3 ticks,
  so `p` = 0.70 at 2 ticks. Knife forced on read 5.44 ticks per expected roll against 5.67 plain,
  within noise.

What the distributions measured here do to a loop aimed at R+1:

| Distribution | Dominant share `p` | Woodcutting (needs 0.75) | Fly (0.60) | Iron (0.39) |
| --- | --- | --- | --- | --- |
| Home, bbs, relay, rs/26: 0/25/35 | 0.58 at 3 | fails: 3 + 0.42 x 4 = 4.7 > 4 | fails, about even: 5.1 vs 5 | passes: 3.4 vs 3.61 |
| Home, Mac, relay, 02:35: 3/56/1 | 0.93 at 2 | passes | passes | passes |
| Home, Mac, blind direct sender, 02:47 | 0.79 at +1 | passes, narrowly | passes | passes |
| Ashburn, blind direct sender (free-running clock), 02:49 | 0.78 at +1 | passes, narrowly | passes | passes |
| Ashburn, relay, runs 2, 4, 7 combined: 123/57/0 | 0.68 at 1 | fails | passes | passes |
| Ashburn, relay, 02:45: 32/28/0 | 0.53 at 1 | fails | fails | passes |
| Ashburn, direct, sending on the frame: 180/0/0 over three runs | 1.00 at 1 | passes, full gain | passes, full gain | passes, full gain |
| Ashburn, direct, during overruns, 04:13: 40/16/4 | 0.67 at 1 | fails: 3 + 0.33 x 4 = 4.3 > 4 | passes narrowly: 4.7 vs 5 | passes |

Measured on the browser overlay path (rs/95, Ashburn eastus2, 04:27-04:37, in the burst minute
above; knife woodcutting with the gate off, normal trees west of Lumbridge castle, Woodcutting
33-64): 127 logs at 15.55 ticks per log, **8.28 ticks per expected roll**, against rs/62's 5.44
(knife) and 5.67 (plain) from bbs. 210 arrow shafts were fletched, a sign of starter bundles split
across ticks (section 6).

**The control (rs/95, Ashburn eastus, 05:38-05:45, rs/113's overlay, burst minutes).** Knife
woodcutting and then plain woodcutting at the same trees in the same session, 59 logs each,
weighted by `tickmanip-demo-report.ts`:

| Loop | Woodcutting | Ticks per log | Ticks per expected roll | Catch-ups in the window (page frames) |
| --- | --- | --- | --- | --- |
| Knife, gate off | 73-76 | 13.80 | **8.92** | 60 in 4.5 min (13.3 per minute) |
| Plain | 76-78 | 9.58 | **6.36** | 17 in 3.0 min (5.7 per minute) |

Plain reads within 12% of rs/62's 5.67 from bbs, and the knife is 40% worse than plain in the
same session. So the trees, levels and weighting are not the problem: the knife cycle itself loses
on this path in these minutes. Two caveats keep it from being a clean verdict on the overlay. The
knife's window was more than twice as bursty as the plain one, and the probe in the same minute put
only 63% of reactions on the next tick, below Woodcutting's 0.75 line, so rs/62's rule already
predicts the knife to lose here (3 + 0.37 x 4 = 4.5 > 4). It loses by more than that rule's
one-plain-cycle-per-miss model, though. The knife also completed 75 fletches (210 in the 04:27
run), which by the script's design the same-tick tree click should prevent. That is unexplained.
A calm-minute knife and plain pair is still needed.

**The in-page knife (rs/130, Ashburn run machine, main ae6d5664d, burst minutes).** rs/97's
`knife-cycle` program counts a `roll` each time the skill's xp rises
(`server/webclient/src/bot/programs/knife-cycle.ts`), so its `ticksPerRoll` is ticks per **log**,
not per expected roll. Put in this section's unit: ticks per expected roll = ticks / Σ 1/p(L)
over the logs, L the Woodcutting level each log was cut at and p(L) = stat_random(L, lo, hi) =
(floor(lo(99 - L)/98) + floor(hi(L - 1)/98) + 1)/256, the tree's success chance for a bronze axe
(trees.dbrow: normal tree lo, hi = 64, 200; oak 32, 100). `tickmanip-demo-report.ts` computes it
for the lite runner's logs and `docs/speedrun/scripts/knife-minutes.ts` for the in-page program's;
for 12:45 the levels come from the program's level-up counter. All rows are Ashburn, all burst or
near-burst minutes:

| Session | Loop | Tree, Woodcutting, p | Ticks per log | Ticks per expected roll (Σ1/p) | Catch-ups in the window |
| --- | --- | --- | --- | --- | --- |
| 13:35 run machine | Knife, in-page program | oak, 63-66, p 0.29-0.30 | 10.89 | **3.25** (63.6 over 19 gaps) | 16 in 1 min (12-17 per minute) |
| 13:35 run machine | Plain, in-page program (`technique: 'plain'`) | oak, 66-68, p 0.30-0.31 | 12.28 | **3.76** (58.7 over 18 gaps) | 11 in 1.1 min (9-11 per minute) |
| 13:15 run machine | Knife, rs/113's overlay | normal, 56-60, p 0.55-0.57 | 14.72 | **8.27** | 10 in 2.4 min (4.2 per minute) |
| 13:15 run machine | Plain, lite runner through the page's gateway | normal, 61-63, p 0.57-0.59 | 12.47 | **7.23** | 5 in 1.4 min |
| 12:45 run machine | Knife, in-page program | normal, 19-52, p 0.35-0.53 | 8.59 | **3.94** (128.7) | 14 in 2.7 min (5.1 per minute) |
| 12:45 run machine | Plain, lite runner through the page's gateway | normal, 52-56, p 0.53-0.55 | 11.95 | **6.44** | 5 in 1.3 min |
| 09:51 GitHub eastus | Knife, in-page program | normal, about 82-84, p about 0.69-0.70 | 5.32 | about **3.7** | 1.7 per minute |
| 09:10 GitHub eastus | Knife, rs/113's overlay | normal, 78-80 | 13.61 | **9.20** | |
| 09:10 GitHub eastus | Plain | normal, 80-82 | 9.32 | **6.39** | |

The 09:51 plain control (21 logs at 29.10 per expected roll) is left out as broken. In the page
the knife beats plain by about 40% even in a burst minute, close to its lab 3 plus the walk between
normal trees; through the overlay it loses by about 40%, as at 05:38. The 12:45 knife's gaps
between logs, in ticks: 3 (14), 4 (2), 6 (9), 7 (5), 8 (2), 9 (7), 10 (4), 11 (1), 12 (4), 15 (2),
18 (1), 19 (2), 20 (2), 21 (1), 24 (1). 39 of the 57 are exact multiples of 3, the knife's cadence
with honest misses at p 0.35-0.53; the rest are walks to a further tree and the 2 lost locks (the
program counted no off-phase rolls). So the long gaps are misses at the knife's own cadence, not
several plain cycles lost per miss. They cannot be tied to individual catch-ups from this run,
because the program stamps only its last 13 logs with ticks. Why the overlay's knife loses where
the page's wins is not measured yet; the overlay adds the gateway and SDK script round trip
(section 7) to every starter.

**Oak, in the page, 13:35.** Oaks fall on one log in eight (`woodcut.rs2`), so on oak neither
loop walks between most logs, and both ran as the same in-page program on the nearest oak to the
Lumbridge stand, the plain one being the scored run's fallback when the gate turns the knife off.
The knife read 3.25 ticks per expected roll against plain's 3.76, about 14% better, but on 19 and
18 gaps, where one lucky or unlucky roll moves either figure by several per cent: plain's 3.76 is
below its own 4-tick swing cycle, which only luck on the rolls allows. Every minute of the session was a burst (9-17 catch-ups per
minute), so the split by minute that would answer whether the knife holds in calm minutes has no
calm side yet. Of the knife's 17 gaps longer than 3 ticks, 11 contain a 350/150 catch-up and 15 a
soft pair; of its 2 gaps of 3, none and 1. The knife counted 4 off-phase rolls and 6 resyncs in 25
logs, against none of either at 12:45. The per-log stamps come from the program's final logTail
(20 of the knife's 25 logs, all 19 of plain's): its `status()` has no logTail mid-run, so polling
it cannot stamp a longer run (rs/159 since added `marks.successes`; the rows below stamp every log).

**Oak, every log stamped (rs/176, run machine, 21:45-22:53 UTC = 14:45-15:53 PDT).** Three
sessions of the in-page knife then the in-page plain loop on the oaks at 3203,3240 and 3203,3246,
bronze axe, page at main c14428fc5 (oak lock window 18 ticks, as at 13:35; rs/175's 48 is not in
it, so the resync counts compare with 13:35's). The harness polls knife-cycle's status every 2.5 s
for `marks.successes` and the counters, so every log has its tick (0 missed in all six runs);
`docs/speedrun/scripts/knife-minutes.ts` does the weighting, p(L) = stat_random(L, 32, 100) at the
level each log was rolled at. Catch-up figures in this subsection are labelled by counter: *gate* is
the direct reference's decoded ticks (section 10's (c)), *program* the page program's own frame
statistics, fed from each PLAYER_INFO message's arrival (the page's true tick timeline). The page's
websocket frame groups are not used: one tick's output arrives in paced pieces (frames 4.3 ms apart,
parts up to about 70 ms later), so grouping frames over-counts ticks (873 groups against 541 decoded
ticks in the 21:45 knife run).

| UTC (PDT), gate | Loop | Woodcutting, p | Logs | Ticks per log | Ticks per expected roll (Σ1/p over gaps) | Program catch-ups in the run |
| --- | --- | --- | --- | --- | --- | --- |
| 21:45 (14:45), fail 3.9/min | Knife | 69-74, p 0.309-0.324 | 56 | 9.75 | **3.07** (174.3 over 55) | 13 in 2.9 min (4.5/min) |
| 21:45 (14:45), fail | Plain | 74-77, p 0.324-0.332 | 47 | 12.43 | **4.06** (140.9 over 46) | 17 in 2.9 min (5.8/min) |
| 22:15 (15:15), fail 4.5/min | Knife | 77-79, p 0.332-0.336 | 29 | 9.61 | **3.19** (84.3 over 28) | 4 in 1.6 min (2.6/min) |
| 22:15 (15:15), fail | Plain | 79-80, p 0.336-0.340 | 35 | 11.26 | **3.81** (100.6 over 34) | 1 in 2.2 min (0.5/min) |
| 22:45 (15:45), **pass** 0.7/min | Knife | 80-83, p 0.340-0.348 | 54 | 9.98 | **3.42** (154.8 over 53) | 2 in 2.7 min (0.7/min) |
| 22:45 (15:45), pass | Plain | 83-85, p 0.348-0.352 | 58 | 10.28 | **3.58** (163.6 over 57) | 8 in 3.0 min (2.6/min) |
| All three | Knife | 69-83 | 139 | 9.81 | **3.23** (413.4 over 136) | |
| All three | Plain | 74-85 | 140 | 11.25 | **3.80** (405.1 over 137) | |

Roll luck alone puts about ±11% (one standard deviation) on a single run's figure here: at p about
0.33 the rolls behind one log vary with a coefficient of about √(1-p) = 0.82, over about 50 gaps.
Pooled, that is ±7%: the knife's 3.23 ± 0.22 against plain's 3.80 ± 0.26, so **the in-page knife
beats plain on oak by about 15% (± 9%)**, close to its lab cadence of 3 against plain's 4.

By minute, on the program's timeline (polled from 22:45 UTC only, so the 22:45 session alone; the
earlier sessions have only the whole-run rates above). Each gap between logs is put in the
wall-clock minute of the log that ends it, the minute binned by its program catch-ups per minute:

| Loop, 22:45 UTC | 0-2 per minute | 2-5 | 5-10 | over 10 |
| --- | --- | --- | --- | --- |
| Knife | **3.76** (43 gaps, Σ1/p 125.4, 2.3 min) | 1.97 (10 gaps, Σ1/p 29.4, 0.4 min) | none | none |
| Plain | **3.42** (38 gaps, Σ1/p 109.1, 2.0 min) | 3.10 (14 gaps, Σ1/p 40.3, 0.7 min) | 6.19 (5 gaps, Σ1/p 14.2, 0.4 min) | none |

The calm bin's knife figure, 3.76 ± 0.47, is the knife's worst; it is also the session where the
oaks fell most often under a crowd of 8-24 other players within 15 tiles (10 tree switches and 6
checks with no live oak, against 6 and 2 at 21:45), so walks and waits, not timing, are the likely
cost (inferred). Across sessions the knife's figure does not rise with the program catch-up rate
(3.42 at 0.7 per minute, 3.19 at 2.6, 3.07 at 4.5, and 13:35's 3.25 at 12.4), so **no per-minute or
per-catch-up cost is visible at these rates**; a cost of a few ticks per catch-up (one plain cycle
each would add about 10% at 4.5 per minute) is at or below this series' resolution.

Resyncs split the same way in all three knife runs. Every 'resync (no xp)' (`counters.slips`: 6, 3,
5) is matched by a gap of 21 ticks or more with no phase resync on its end log (6, 4, 5): honest miss
runs, which at p about 0.33 are expected on (1-p)^6, about 9% of logs (5.7, 2.4, 4.2 expected). The
timing class, a 4-tick gap or an off-phase roll (`phaseResyncs`), counted 4, 3 and 4 (phase resyncs
2, 0, 4), and does not follow the program catch-ups either (13, 4, 2 in those runs). So on oak the
knife's slips are the 18-tick lock window tripping on honest misses, which rs/175's longer window
addresses, not timing lost to overruns.

Two cautions for reading these as the run's numbers. Every run-host session above ran on the
machine's former address, so its catch-up rates include ticks that Fly's delivery
path held for that address and released glued to the next one (section 9, 'Ticks held on one
address's path'). For the knife those were a real cost on that address, but they overstate the
server's own overruns; the address was replaced at 23:11 UTC and the new one reads clean. And the
oak figures are small samples against a 15% effect; the pooled pair is the one to use.

Overruns therefore matter for the knife as well: in a minute like 04:13 even the in-page direct
path falls under Woodcutting's line. That is what the steadiness check in the run-night gate
(section 10) and rs/62's measured override (which switches the knife off when its measured rate
is not better) are for.

Two conclusions. First, what hurts a predicted loop is a **split** distribution, not a long one:
the steady 2-tick world from home through the relay keeps the lock better than the 50/50 world
from Ashburn through the relay, because a reaction that lands right at the deadline flips between
ticks. Second, from Ashburn on the direct path the knife loops run at their lab rates, so the
figures in rs/2's tables apply unchanged (Mining about 670 ticks saved, Fishing about 1,400,
Woodcutting about 930, by rs/2's estimates). Through the relay from Ashburn they would not, and
the gate would correctly keep the knife off on trees and fly.

## 9. Tick steadiness and player count

| PDT | Vantage | Online | Tick interval p10 / p50 / p90 / max | Source |
| --- | --- | --- | --- | --- |
| 02:45-02:50 | Mac, direct session | 1,567-1,660 | 118 / 259 / 357 / 580 ms | `data/mac-0247.json` |
| 02:43 | Ashburn, direct session | ~1,655 | p50 245 / p90 348 / max 879 ms | rs/86 run 4 |
| 01:54-02:45 | GitHub runners, relay publication | 1,549-1,663 | p10 224-245 / p50 289-306 / p90 368-388 / max 486-670 ms | rs/86 runs 1-4 |
| 03:47-03:57 | Mac, one session, 10 min, no input. *Home vantage, reference only: inflated by path jitter* | 1,576-1,680 | 179 / 299 / 404 / 803 ms | hour sample |
| 04:00-04:12 | fedora, one session, 10 min. *Home vantage, reference only: inflated by path jitter* | 1,623-1,675 | 171 / 291 / 394 / 794 ms. Direct reactions from home: +0 ms 1/14/0, +25 ms 1/14/0 | [`data/fedora-0400.json`](data/fedora-0400.json), [`data/fedora-samples.log`](data/fedora-samples.log) |

The interval p10 of about 120 ms is the engine's catch-up after a long tick (section 2).

**Home windows cannot score overruns.** cairn://p/rs/102 aligned the fedora 04:00 window tick by
tick with the Ashburn pair at 04:04 that ran inside it. Home sees the same ticks 63-73 ms later
(223 of 245 matched within 15 ms, interval correlation 0.67), and it does see the server's real
overruns, but the home path adds single-tick hiccups of its own that look exactly like an overrun
and its catch-up (480 then 101 ms at home where Ashburn saw 273 then 307). Over the same 1.2
minutes, home counted 13 catch-ups and Ashburn 0; ticks over 450 ms, 14 against 8. So every home
steadiness number above is reference only, and the steadiness gate must be measured from the run
machine (section 10). The fedora sampler was stopped after its first sample for that reason; its
raw output is in `data/fedora-0400.json` and `data/fedora-samples.log`.

**Steadiness from Ashburn**, per direct session (one minute or so each; p90 from
`demo-latency-analyze.ts`, catch-ups per minute counted by rs/102 from decoded ticks):

| Session | Direct result | Tick p90 | Catch-ups per minute | Passes (c), at most 2 per minute |
| --- | --- | --- | --- | --- |
| 02:43 eastus | 60/0/0 | 374 ms | 0 | yes |
| 03:05 Quebec | 56/4/0 | 386 ms | 0.8 | yes (its misses come from its 24 ms connect) |
| 03:17 eastus | 60/0/0 | 373 ms | 0 | yes |
| 04:04 eastus | 60/0/0 | 372 ms | 0 | yes |
| 04:13 eastus | 40/16/4 | 486 ms | 22.6 (31 in 1.4 min) | **no** |
| 04:24 eastus2 (rs/95, probe minute) | 49/11/0 | 391 ms | 10.8 (15 in 1.4 min) | **no** (fails a, c) |
| 04:47 eastus (rs/95) | 60/0/0 | 350 ms | 0.8 (1 in 1.3 min) | yes |
| 04:55 eastus (rs/95) | 59/0/0 (1 lost) | 346 ms | 0 | yes |
| 05:35 eastus (rs/95) | 36/22/1 (+1 at 7) | 473 ms | 23.3 (32 in 1.4 min) | **no** (fails a, c) |

Corrected: earlier drafts gave 3.3, 1.5, 14 and 13.8 catch-ups per minute for 04:47, 04:55, 04:24
and 05:35. Recounted from each session's decoded ticks over its wall time with
`docs/speedrun/scripts/demo-burst-analysis.ts`, they are 0.8, 0, 10.8 and 23.3, so 04:47 and 04:55
pass (c) and are not evidence that a few catch-ups are harmless.

A cap on the maximum interval does not separate good minutes from bad: single long ticks are common
and harmless on their own, and a 600 ms cap rejected the minutes at 02:43, 03:17 and 04:04 that
scored 60 of 60. The catch-up count does. rs/95's 04:24 session shows why it is needed as well as
p90: its p90 of 391 ms passes, but 10.8 catch-ups per minute cost the direct path 11 of 60. The
overnight series below calibrates the limit at 2 per minute.

**Should the run go at a quiet hour?** No hour can be chosen in advance (next subsection): the
player count barely predicts overruns, and a quieter hour also costs elsewhere, since rocks and
trees respawn faster with more players online
(`server/content/scripts/general/scripts/player_count.rs2:1-4`, capped at 2,000) and rs/2 costs
Mining at about 4,034 ticks at 1,260 online against about 4,288 at a quiet hour. Start at a normal
hour and let the run-night gate decide minute by minute (section 10).

### Overrun bursts overnight

cairn://p/rs/102 sampled the demo from Ashburn from 02:43 to 12:30 PDT on 21 October: every 30-60
minutes, a GitHub Azure eastus runner behind the `iad` edge (TCP connect 2-3 ms) ran the direct
reaction probe (60 trials at +0 ms), and from 06:00 kept the same session open for 6-17 more
minutes of tick spacing. rs/95's and rs/130's runs on the same runner are included, which gives
24 Ashburn samples (the 03:05 Quebec runner is excluded). Between samples, the public
`/playercount`, a no-login websocket upgrade and a hash of `/bot/client.js` were read every 20 s,
60 s and 5 min. Scripts: `docs/speedrun/scripts/demo-burst-sampler.ts` and
`demo-burst-analysis.ts`; raw logs, per-pair JSON, the per-minute series and the analysis output are
in [`data/overnight-bursts/`](data/overnight-bursts/). Catch-ups are counted as in section 10 (an
interval under 150 ms right after one over 350 ms) from decoded ticks.

**Three regimes, not a continuum.** Per sample, over the probe's own 1.3 minutes:

| Regime | Catch-ups per minute | Ashburn samples | Direct reactions on the next tick |
| --- | --- | --- | --- |
| Calm | 2 or fewer | 18 | 971 of 985 (98.6%) |
| Simmer | 2-10 | 1 (07:01, 4.0) | 54 of 60 |
| Severe burst | 10 or more | 5 (04:13, 04:24, 05:36, 06:10, 09:51; 11-26 per minute) | 212 of 300 (71%) |

The long windows show simmer to be far more common than one sample suggests: inside them, single
minutes with 3-9 catch-ups come and go all morning.

**How long bursts last.**

- *Severe bursts* were each seen in exactly one sample, with calm samples on both sides. The
  upper bounds, from the gaps between those calm samples: 04:13 at most 12 minutes (calm at 04:04
  and 04:18), 04:24 at most 29, 05:36 at most 50 and 09:51 at most about 65. Only one was watched
  continuously: 06:10, at 19-23 catch-ups in each of 4 minutes, which ended with the demo's restart
  at 06:14. So a severe burst lasts at least the 1.4 minutes of a probe (4 minutes the one time it
  was watched throughout) and, in every case followed, was gone by the next sample, 5-52 minutes
  after it was seen.
- *Simmer minutes* (3 or more catch-ups in a single minute) come in short runs: 26 runs inside the
  long windows, of which 21 closed inside a window at 1-4 minutes (median 1); the other 5 were cut
  off by a window's edge at 1-5 minutes.
- *Simmer stretches* last much longer. From 08:36 to 11:36 the demo was rarely calm for five
  minutes at a time (table below), and the direct probe lost 6 and 5 of 60 at 10:43 and 11:18 at
  only 1.6 and 0.8 catch-ups per minute in the probe's own span. 12:02-12:21 was the calmest long
  window of the night.

**Which hours would have passed the gate.** (a) at 58 of 60 or better and (c) at 2 or fewer per
minute, per sample; and, for the long windows, the share of overlapping 5-minute windows with (c) at
2 or fewer:

| PDT hour | Samples passing (a) and (c) | 5-minute windows passing (c) | Online (median) |
| --- | --- | --- | --- |
| 02:00 | 2 of 2 | (no long window) | 1,564-1,651 |
| 03:00 | 1 of 1 | (no long window) | 1,658 |
| 04:00 | 4 of 6 | (no long window) | 1,673 |
| 05:00 | 1 of 2 | (no long window) | 1,720 |
| 06:00 | 2 of 3 | 4 of 5 | 1,671 |
| 07:00 | 2 of 3 | 16 of 20 | 1,631 |
| 08:00 | 1 of 1 | 5 of 14 | 1,699 |
| 09:00 | 2 of 3 | 1 of 2 | 1,690 |
| 10:00 | 0 of 1 | 0 of 14 | 1,605 |
| 11:00 | 0 of 1 | 6 of 13 | 1,626 |
| 12:00 | 1 of 1 | 13 of 13 | 1,518 |

No hour was clean throughout, and the worst stretch (10:00-11:30) was neither the busiest nor the
quietest. The 02:00-03:59 samples all passed, but they are three short samples, too few to call
that hour safe.

**What bursts line up with.**

- *Player count:* weakly at most. Over 159 scored minutes, the correlation between players online
  and catch-ups per minute is 0.20, and the share of minutes failing (c) by player-count tercile
  (below 1,612, 1,612-1,676, above) is 44%, 30% and 47%. All five severe samples were at
  1,645-1,719 online, but so were nine calm ones (for example 1,701 at 09:10 and 1,696 at 08:36).
- *Hour:* no pattern beyond the one in the table.
- *The helper fleet:* not testable from this night. rs/41's per-minute series covers 02:00-04:30
  only (12 scored minutes), and the fleet is about 30 of 1,650 accounts. The severe 04:13 sample sat
  in a stable stretch with no fleet logins or logouts.
- *Restarts:* the demo restarted at 01:22 (from rs/41's fleet log), 04:53 and 06:14, and not again
  through at least 12:21: the bundle hash, Fly machine and worker stayed the same all morning, the
  player count never dropped, and all 238 websocket upgrades from 07:44 to 12:00 returned 101. Four
  of the five severe bursts (04:13, 04:24, 05:36, 06:10) fell within 40 minutes before one of the
  two restarts, and in the six hours after 06:14 there was one severe burst (09:51) and no restart. That fits a game process that degrades before
  it exits (for example memory growth and long garbage-collection pauses on the 4 GB machine), but
  it is inferred from two restarts and nothing on the server side has been seen. The longest silence
  without a restart was 1,987 ms, at 07:50.
- *Refill after a restart* (`playercount.tsv`, 20 s samples, no login). 04:53: 0 online at
  04:53:58, 198 a minute later, 1,216 at +2 min, 1,426 at +3.3, about 1,500 by +6 and 1,600-1,670
  by +18 (05:11-05:14), against 1,680 before. 06:14: 0 at 06:14:55, held at 3-10 for 1.4 minutes
  (logins not yet open), then 473 at +1.7 min, 1,160 at +2.4, 1,439 at +5.4, 1,587 at +10 and
  1,610 at +15.5, against 1,687 before. So about 70% of the count is back within 2.5 minutes of
  the server answering and 85% within 5; the last 5-10% takes 10-18 minutes. A probable third
  restart at about 20:00 UTC (13:00 PDT), about 14 hours after 06:14, fits the same curve: 38
  online at the gate timer's 20:00 read, 1,411 at 20:12 (rs/147's twin host), 1,597 at 20:21. That
  restart is inferred from the count; the gate's error text was lost (rs/140 now keeps it).
- *The per-player save cadence* (`World.PLAYER_SAVERATE`) was not tested: its phase on the demo is
  unknown.

**Calibrating (c).** Agreement of (c) with (a) over the 24 Ashburn samples, by limit:

| (c) limit, catch-ups per minute | Agrees with (a) | False passes | False fails |
| --- | --- | --- | --- |
| 1 | 21 | 1 (11:18) | 2 (05:09 and 12:02, both 60/60 at 1.6) |
| **2** | **22** | 2 (10:43, 11:18) | 0 |
| 3 | 22 | 2 | 0 |
| 4 | 21 | 3 (adds 07:01's simmer) | 0 |
| 5 | 21 | 3 | 0 |

Two is the lowest limit with no false fails and keeps margin below the first bad simmer (4.0).
Both false passes are the late-morning simmer stretch, and (a) caught both, which is why (a) stays a
pass line beside (c). The 10:43 sample lost 6 of 60 at 1.6 catch-ups per minute, the same rate at
which 05:09 scored 60 of 60; most of its misses followed runs of two or three short ticks after one
overrun, where the rule counts only the first. No rule tried separates the two, and both sit at the
resolution limit of one 60-trial sample.

Softer overrun rules do no better per sample. With each at its best limit, agreement with (a) is
22 of 24 for 350/150 (the rule above), 21 for 400/200, 21 for 400/225, 21 for 400/250, 22 for a
bare count of intervals under 150 ms (with two false fails instead of two false passes) and 22 for
"two ticks summing under 400 ms after one over 350". The softer the rule, the more calm samples it
fails, because jitter fills calm minutes with long-then-shortish pairs (up to 4.9 per minute in a
60 of 60 sample).

(b), publication p90 at most 400 ms, agreed with (a) on 17 of 24. Six of its seven disagreements
failed samples that lost at most one reaction (04:18 at 10 of 10; 07:41, 08:36, 09:10, 09:31 and
12:02 at 59-60 of 60; p90 408-455 ms with 0-1.6 catch-ups per minute), and one passed the bad 07:01 simmer at 383 ms. The p90
drifted above 400 ms from about 07:40 without costing reactions, so (b) stays context, not a pass
line.

#### Miss rate by the next tick interval

Per reaction, what decides a miss is how soon the tick after the reaction's frame comes. Over the
1,284 Ashburn +0 ms trials with a known next interval:

| Next interval | All trials missed | Missed, when the previous interval was over 400 ms |
| --- | --- | --- |
| under 150 ms | 51 of 59 (86%) | 27 of 28 |
| 150-200 ms | 13 of 74 (18%) | 8 of 14 (57%) |
| 200-225 ms | 2 of 30 (7%) | 0 of 2 |
| 225-250 ms | 5 of 92 (5%) | 3 of 8 |
| 250 ms or more | 36 of 1,029 (3.5%) | 10 of 120 (8%) |

This is what the in-page programs' resync logic should expect: a reaction whose frame is followed
by a catch-up tick almost always lands a tick late; a moderately short tick after a long one
(150-200 ms) misses about half the time; and a normal interval still misses about 1 in 30. Soft
pairs are real per reaction even though counting them does not improve the per-minute gate, so the
in-run monitor can count them as a warning, not a gate.

**For the run.** A start time cannot dodge overruns: they are not tied to the clock or, much, to
the player count, and severe bursts strike out of calm samples. What the night does support:

- Read the gate right before starting (rs/140's timer now reads it at :00 and :30 UTC from the
  run host). A severe reading was gone by the next sample in every case followed (the quickest
  within 5 minutes), so the response to one is to wait and re-read, not to give up on the night.
- A simmer stretch can last hours (08:36-11:36 here). If the gate fails on simmer more than twice in
  a row, starting on a passing read is still right, with the in-run pause above about 5 per minute.
- A severe burst that lasts more than a few minutes may precede a restart (06:10-06:14 here; 4 of 5
  severe bursts fell within 40 minutes before one). That suits the restart-warning hook of
  cairn://p/rs/127, with its threshold as a parameter, not a gate on its own.

### Ticks held on one address's path

From 18:10 to 23:00 UTC on 21 October every gate read on the run host failed, while every read on
rs/147's twin (the same instance type, zone us-east-1c and image) passed. Five reads were matched to
the second, the run host's gate timer against cairn://p/rs/170 on the twin, 60 direct trials each,
then two more after the run host's address was replaced:

| UTC | Online | Run host: (a), (c) per minute | Twin (`rs-ashburn-rehearsal`): (a), (c) per minute |
| --- | --- | --- | --- |
| 21:00 | 1,579 | old address: 57/60, 4.98, fail | 60/60, 1.0, pass |
| 21:30 | 1,602 | old address: 57/60, 15.0, fail | 59/60, 1.0, pass |
| 22:00 | 1,627 | old address: 55/60, 6.0, fail | 60/60, 0, pass (with rs/174's tab, gateway and probe running on it) |
| 22:30 | 1,502 | old address: 58/60, 4.98, fail on (c) | 60/60, 0, pass |
| 23:00 | 1,597 | old address: 51/60, 8.99, fail | 60/60, 0, pass |
| 23:30 | 1,545 | new address: 60/60, 1.0, **pass** | 60/60, 1.0, pass |
| 00:00 (22 Oct) | 1,670 | new address: 60/60, 1.0, **pass** | 60/60, 1.0, pass |

What the host thread (cairn://p/rs/host) established, in order:

- **The server sent on time; the path held the tick.** Aligned tick by tick against the twin, the
  run host was never more than about 5 ms early, but about 13% of its ticks arrived 135-218 ms
  after the twin's copy, and every glued pair (two ticks 0.1-0.3 ms apart after a long gap) was one
  of those. The gate counted them as catch-ups. They cost reactions too, since a reaction cannot
  leave before its frame.
- **Not the machine's own stack.** A packet capture during the 22:00 read showed acknowledgements
  leaving at a median of 0.04 ms (max 41 ms), no tick released just after one of our
  acknowledgements, and each tick reaching the probe 0.1-0.4 ms after the network card. Already
  ruled out: hardware, kernel and network settings, the check command, the Fly app machine (both
  hosts reached 82962dc77ee3e8), and Tailscale, which the demo's traffic does not use.
- **Not the account or where it stands.** In the 22:30 minute two accounts on the run host, the gate
  account alone on Tutorial Island and one in the crowd at the Lumbridge oaks, received each tick
  within 0.1 ms p50 of each other. That also rules out delayed acknowledgement of small updates to
  a lone account.
- **It followed the address.** The run host's Elastic IP was replaced at 23:11 UTC. In the 23:30 and
  00:00 pairs the two machines' arrivals aligned to 0.3-0.4 ms, with no tick late by more than
  40 ms and no glued pairs, where 23:00 on the old address had 18 late and 7 glued. The 00:30 timer
  read on the new address, unpaired, was 60/60 with 0 catch-ups at 1,731 online.

So the hold was tied to the old address. That is inferred from one change of address, with two
clean pairs and one clean read after it; where inside Fly the tick was held is not identified
(section 11). Two consequences, both in section 10: a run-class host's gate must be read from that
machine at its current address, and a new address is a fresh draw that needs a matched gate pair
before it is trusted. Run-host rows before 23:11 UTC in sections 7, 8 and 10 were measured on the
held address, so their catch-up rates overstate the server's own overruns.

### 22 October: a demo-side loss at 300 ms, operator restarts, then 400 ms ticks

Every gate row in sections 9 and 10 above is at T = 300 ms. The demo's tick length changed at its
19:56:28Z restart on 22 October. From then on, rows are T = 400 ms, and the gate's thresholds
are read in T (tenet 12's principle, re-expressed by main: (c) a catch-up is an interval under
0.5T right after one over 7/6 T; (b) is reported with T, not used as a pass line).

**The loss, 16:00-19:30Z, T = 300.** Gate reads from the run host (its third address, from
17:39Z) and the twin, both at Lumbridge from the evening on:

| UTC | Run host (a) | Twin (a) | Note |
| --- | --- | --- | --- |
| 13:00-15:30 | 58-59/60 | 59-60/60 | normal |
| 16:00, 16:30 | 56, 53 | 60, 59 | |
| 16:41:28 | | | demo restart after a stall (process-start token; rs/41's fleet dropped together) |
| 17:00-18:30 | 40, 26, 41, 34 | no reads (lab claims) | |
| 19:00 | 26/60 | 25/60 | same reactions lost on both, offset about four trials |
| 19:24:45 | | | restart |
| 19:30 | 60/60, (c) 0 | 60/60, (c) 0 | 1,060 online, refilling |

In the 19:00 pair the ticks arrived on time and evenly on both machines: 3 run-host ticks more
than 40 ms behind the twin, none in the 135-218 ms held band, no glued pairs. So this was not
the held-address fault of 21 October. The decline didn't follow the online count (1,610-1,714
after 16:00Z, fewer than the morning's better minutes) or our own logins (59-61 at every claim).
It began at the 16:41Z restart, and the first read after it, 19 minutes into the process, was
already bad, so it was not uptime. The operator said in public at 16:35Z that he was 'working on
this' and blamed bot load. The likeliest reading is per-tick work grown past the 50 ms margin
(section 2) without the ticks themselves running late. That was not measured directly.

**Operator changes, 19:36-20:08Z** (dated by the page's process-start token, `client.js?v=`,
which the engine sets to `Date.now()` at start; server/engine/src/web/pages/client.ts:13):

- 19:36:00Z: restart after a 'Server is being updated' countdown (login code 14). The hiscore Time
  hover changed from 'N ticks' to 'N seconds of game time', a string in neither upstream b565f2d9
  nor our fork (server/engine/src/web/pages/hiscores.ts:59-68). The served `bot/client.js` was
  byte-identical (md5 353760e9), which the published server/Dockerfile can't produce after an
  engine change, so the demo runs unpublished engine code from a private build.
- 19:56:28.9Z: restart. **T = 400 ms from here**: the engine's spectator feed
  (`wss://<host>/worldfeed`, login-free) reports `tickMs: 400` in its hello (World.tickRate,
  server/engine/src/web/worldfeed.ts:141) and per-tick server intervals with a median of 397-402 ms.
  rs/41's fleet tick counters agree (0.3015 s per tick at 19:50Z, 0.4000 at 20:00Z). The
  per-address session cap fell from 100 to 50 (the operator, in public; `MAX_PLAYERS_PER_IP`,
  server/engine/src/engine/World.ts:1052-1058, refuses with code 7 'World is full', the same code
  as the world cap), and the world held about 1,050-1,350 online afterwards against 1,650-1,800
  before.
- 20:08:12Z: restart. The hover became 'N ticks normalized to 400 ms per tick' (it had the old
  form at 19:57:48Z), and the bundle was again unchanged.

**After, T = 400.** 20:00Z: both machines 60/60, (c) 0, tick p90 447 (1.12T). 20:30Z: run host
60/60, (c) 0, p90 488 (1.22T); the twin skipped on a claim. The 20:35Z delay sweep (section 2)
puts the margin after a frame above 250 ms at the median, over 0.6T. While 400 ms holds, (a) is
near-certain on any calm minute.

The gate records carry this from 21:00Z on: each read records the feed's configured tick length,
60 s of the engine's own tick intervals, a `T` field, the process start and an engine fingerprint
(section 10, 'Gate history timer'). Older history files are not rewritten; read them with T = 300
before 19:56:28Z on 22 October and T = 400 after.

## 10. Run-host recommendation

**Where.** The machine that shows the visible browser tab runs in Ashburn: Fly's iad region, AWS
us-east-1, or Azure eastus. It must reach the demo through the Ashburn edge (`flyio-debug`
`nr=iad` with no mesh hop) **and** with TCP connect under 5 ms; an `iad` edge alone is not enough
(the Quebec runner had it at 24 ms and missed 4 of 60 on the direct path). The operator needs a desktop session they
can watch (VNC or RDP), Chrome, and the client watchdog from `speedrun/lib` (rs/40).

**Route.** As decided (section 7): our webclient served on the run host, game socket to
`wss://rs-sdk-demo.fly.dev/`, bot overlay to a loopback gateway, reactive steps in-page on the
game socket, non-reactive steps through the SDK. Never route anything through the public gateway.
The decided route alone does not make reactive steps fast if they are driven through the SDK with
the unfixed lite runner: that relay from Ashburn landed only about 60% of its reactions on the
next tick (section 5). rs/98's fixed lite runner landed 60 of 60 from Ashburn through the relay,
so SDK-driven reactive steps are viable on that client; the browser tab's overlay has the same
class of delay and is not fixed by it, so the tab's reactive steps still run in-page unless main
decides otherwise.

**What it saves.** Per reactive step, the direct path from Ashburn turns a 2-3 tick reaction (home
through the relay) into 1. On the route:

- Agility pays one reaction per obstacle: rs/2 measured 66-tick laps with 1-tick reactions against
  about 74 through the relay from home, so about **4,024 against 4,512 ticks** for the course
  segment, about 490 saved (`docs/speedrun/skills/README.md` on the rs/2 branch).
- The knife loops pay off only with a dominant-offset share above their thresholds (section 8).
  From Ashburn on the direct path they run at lab rates: about **3,000 ticks** across Mining,
  Fishing and Woodcutting by rs/2's estimates, which a home host through the relay does not reliably
  get.
- Level-up dismissals, re-clicks, quest dialogue, trades and bank steps each pay one reaction.
  A bounded route-wide estimate follows.

**Route-wide estimate of the other reaction-paying steps** (inferred, order of magnitude). Method:
count or bound the reactions by class from rs/2's `docs/speedrun/skills/` and rs/3's
`docs/speedrun/quests/README.md`, then price each at what the two placements cost. Home through
the unfixed relay lands a reaction in 2-3 ticks (0/25/35 to 3/56/1, section 3); Ashburn direct
lands it in 1. So each reaction saves 1-2 ticks. Every rs/2 and rs/3 figure was taken with
1-tick reactions, so these savings are what the run keeps by sitting in Ashburn, not gains on
top of those tables.

| Class | Reactions on the route (low-high) | How counted | Ticks saved at 1-2 each |
| --- | --- | --- | --- |
| Quest dialogue pages and option clicks | 800-1,680 | rs/3's whole on-route set is ~13,190 ticks at 2 per page (stock) against ~11,510 at 1 per page (fixed), so about 1,680 read-then-act pages and clicks. The burst column (~10,630) cuts that to about 800 reactions, since a blind burst of continues needs one reaction per run. | 800-3,360 |
| Level-ups to dismiss | 700-1,130 | Levels gained by training, not by quest jumps, from rs/2's start levels: self-only skills 256 (Agility 1-22 and 75-99, Mining 49-99, Woodcutting 1-99, Fishing 78-99, Thieving 57-99); item-fed skills about 870 (Ranged, Prayer, Smithing, Firemaking, Runecraft and Fletching 98 each, Magic about 85, Herblore 71, Cooking 69, Crafting 57, Defence and Hitpoints 3). The low end allows for several levels gained in one tick or one login (Fletching and Crafting at 5 actions per tick, Cooking's single firing). rs/2 measured 5 ticks per Woodcutting level-up against the 1 it models. | 700-2,260 |
| Trades and bank turnarounds | 700-1,300 | Runecraft trades 27 essence per 7-tick cycle (~170 cycles of ~1,180 ticks); Smithing trades 25 bars in and 5 products out per cycle (~31 cycles); bank loads for Prayer (555 bones), Herblore (245 potions), Crafting, Magic's enchanting and cannonball refills; at 2-4 reactions per trade or turnaround. | 700-2,600 |
| Re-clicks outside the in-page loops | 100-200 | Felled trees (1 in 8 logs, about 90-150 over Woodcutting) and fishing-spot moves. Rock transitions, pickpocket stuns and Agility obstacles belong to the in-page tick programs and are counted with them. | 100-400 |
| **Total** | **2,300-4,300** | | **2,300-8,600** |

With Agility's ~490 and the knife loops' ~3,010, **sitting in Ashburn with direct reactions saves
roughly 5,800-12,100 ticks** against home through the unfixed relay, on a route whose rs/2 and rs/3
tables sum to roughly 36,000 ticks (about 17,520 self-only, 6,800 item-fed, 11,510 quests). The
range is wide because both the per-reaction cost from home (1 or 2 extra ticks) and the reaction
counts are bounded, not tallied. The exact tally is open question 5.

**What the run-night probe must read before starting**, from the run machine, on the run's own
route (local webclient build, loopback gateway, in-page probe; cairn://p/rs/96 and rs/97), at the
real player count:

Preconditions:

1. `GET /playercount`, recorded.
2. `flyio-debug` shows `nr=iad`, `sr=iad`, no mesh hop; TCP connect p50 under 5 ms (rs/86's
   workflow refuses to log in above 10 ms).

**The gate** (cairn://p/rs/tenets/12, approved; supersedes 11), measured from the run machine itself, since a distant
vantage adds path jitter that looks like overruns (section 9):

- **(c), primary:** **at most 2 catch-ups per minute** over a 3-5 minute window (tenet 12;
  over 24 Ashburn samples (02:43-12:02), at most 2 agreed with (a) on 22 with no false fails; its
  two false passes, 10:43 and 11:18 (54 and 55 of 60 at 1.6 and 0.8 per minute), were caught by
  (a), which is why (a) stays a pass line; at most 1 also failed 05:09 and 12:02 at 60 of 60, and
  at most 4 passed 07:01; section 9, 'Overrun bursts overnight'), a catch-up being an
  interval under 1/2 T immediately after one over 7/6 T, T the server's tick length (150 and 350 ms
  at the 300 ms ticks these samples ran at; `server/webclient/src/bot/programs/tick-rule.ts`),
  counted from decoded ticks (not from raw frames grouped 60 ms apart, which hides them;
  section 3). Recalibrating the limit of 2 against (a) at 400 ms ticks is still to do.
  (b)'s report line is likewise 4/3 T: 400 ms at T = 300.
- **(a)** the direct in-page probe lands **at least 58 of 60** reactions on the next tick;
- **(d)** the tab's machine meets item 4 below.
- **(b), reported as context, not a pass line:** tick publication interval p90. It agreed with (a)
  on 17 of 24. Six of its seven disagreements failed samples that lost at most one reaction (p90
  408-455 ms), and the seventh passed the 07:01 simmer minute that lost six.

If (a), (c) or (d) fails, wait and re-measure; do not start on a minute of overruns. No cap on the
maximum interval: it rejects minutes that scored 60 of 60. Keep checking during the run: a reactive
loop that sees a catch-up should expect its next reaction to miss, and reactive and knife steps
pause while catch-ups run above about 5 per minute (rs/102's in-run rule). Per-reaction miss rates
by the next tick interval, which the programs' resync logic should expect, are in section 9, 'Miss
rate by the next tick interval'.

**Gate samples from run-class hosts** (AWS us-east-1c, edge iad, TCP about 2 ms), 21 October:

| UTC | Host | Online | (a) direct | (c) catch-ups per minute | Verdict |
| --- | --- | --- | --- | --- | --- |
| 18:10 | run host, gate timer's first (hand) read | 1,587 | 54/60 | 3.97 | fail |
| 19:45 | run host, rs/130's reference row | 1,679-1,624 | 51/60 | 11.7 | fail |
| 20:15 | run host, rs/130's reference row | 1,474-1,597 | 59/60 | 2.4 | fail on (c) only; overlay 59/60 in the same minute |
| 20:35 | run host, rs/130's reference row | 1,593-1,603 | 41/60 | 12.2 | fail |
| 20:12 | rs/147's twin (same zone and image), Xvfb with recording | 1,411 | 60/60; in-page probe 60/60 | 0 | **pass** (loop p10 72-73/s) |
| 20:22 | rs/147's twin in the run-night configuration: RDP disconnected, on-host recording at 29.9 fps with 0 dropped, xrdp display 1920x1080 | 1,589-1,604 | 60/60; in-page probe 60/60 at 20:29 | 0 (tick p90 377) | **pass** ((d) loop p10 70.8-72.9/s over 30 samples; host 31-33% busy) |
| 21:45 | run host, rs/176's reference row | 1,604-1,630 | 57/60 | 3.9 | fail; in-page probe 58/60 |
| 22:15 | run host, rs/176's reference row | 1,635-1,556 | 56/60 | 4.5 | fail; in-page probe 52/60 |
| 22:45 | run host, rs/176's reference row | 1,423-1,564 | 58/60 | 0.7 (tick p90 343) | **pass**; in-page probe 60/60 in the same session |
| 23:30 | run host on its new address, gate timer | 1,546 | 60/60 | 1.0 | **pass**; twin 60/60, 1.0 in the same minute |
| 00:00 (22 Oct) | run host, new address, gate timer | 1,670 | 60/60 | 1.0 | **pass**; twin 60/60, 1.0 in the same minute |
| 00:30 (22 Oct) | run host, new address, gate timer | 1,731 | 60/60 | 0 (tick p90 515) | **pass**; slow but even ticks, (b) context only |

Run-host rows before 23:11 UTC were taken on its former address, whose delivery path
held ticks; the twin's matched reads against them are in section 9, 'Ticks held on one address's
path'. The twin's reads of record are kept in `docs/speedrun/rehearsals/HOST.md` (rs/147, rs/149).

**Which machine starts.** Both run-class machines stay run-capable: the run host (`rs-ashburn-run`) and
the twin (`rs-ashburn-rehearsal`); their current addresses are kept by the host thread, not here. Read the
gate on both and start on one that passes (main's ruling after the address finding). If either
machine's address changes, its first reads count only once a matched pair agrees with the other
machine.

The 20:12 pass came about 12 minutes after the probable 20:00 restart, and 05:09 (60/60, 16
minutes after the 04:53 restart) was calm too, but 05:36 (43 minutes after it) was a severe burst.
Three samples don't show that the time after a restart is systematically calm, and restarts can't
be scheduled (about 14 hours apart this time, 1.5-3.5 overnight). So the start policy stays
'start when the gate passes'; a restart during the wait is a reason to re-read the gate once the
world has refilled, not a window to wait for.

Also before starting:

3. **Bundles and timing.** Every multi-packet bundle (the knife's starter and button, for example)
   goes out as one flush on the frame's arrival, and the burst check lands it on one tick. No
   program sends on a free-running clock. The blind sender's on-aim share is diagnostic only: it
   tops out at about 76% even from Ashburn when sent within 50 ms of the frame, and 23% free-running
   (section 6), so it cannot be a pass/fail line.
4. **The tab's machine**: decided, the gate's (d) in cairn://p/rs/tenets/12. On macOS
   with a display attached, rs/97 saw no throttling; the run VM must reproduce that, not assume
   it. Until cairn://p/rs/113's
   decode-on-arrival lands, an in-page reaction includes up to one game-loop period (about
   13.5 ms at 74 loops per second), and Chrome throttles hidden or occluded tabs. So: the tab's
   loop rate p10 at least about 50 per second; the remote-desktop session DISCONNECTED during the
   run, with the operator on the low-rate live view (tenet 12: rs/134 measured the tab's loop at
   about 72 per second in all four conditions, and the on-host recording at 29.9 fps with RDP
   disconnected against 23 fps connected); screensaver
   and sleep off; Chrome started with `--disable-background-timer-throttling
   --disable-renderer-backgrounding --disable-backgrounding-occluded-windows`.
5. If the SDK drives any step that reacts, the relay probe for that step, gated by
   `speedrun/lib/hostgate.ts`.

Until the in-page probe exists, `demo-latency-probe.ts --phases=react,burst,blind` from the run
machine is the stand-in for (a) and item 3, and `demo-latency-analyze.ts` over its JSON gives (b);
for (c), count catch-ups over the probe's decoded tick timeline (`react.ticks` in the JSON), as
rs/102 does.

### Gate history timer

The gate's own history (the gate of tenet 12) accumulates on the run host
(`ubuntu@$RS_RUN_HOST`, `rs-ashburn-run`) and, since 02:30 UTC on 22 October, on its twin
(`ubuntu@$RS_TWIN_HOST`, `rs-ashburn-rehearsal`; see 'Twin' below) until the scored run, without an agent. It's a systemd user timer owned by
mission rs/83. The user lingers, so the timer runs with no one logged in. The units and scripts are
in `docs/speedrun/scripts/host-gate/`, and the read itself is `docs/speedrun/scripts/host-gate-read.sh`.
`install.sh` copies all of them to `~/.local/lib/rs-gate` on the host, and the timer runs that copy.

- **What fires when.** `rs-gate-read.timer` starts `rs-gate-read.service` at :00 and :30. The host
  clock is UTC, and the minutes are the same in PDT. Each firing:
  1. skips while a reservation is live;
  2. skips while the host is busy: a Chrome with its own profile, app URL, headless flag or open
     connection, ffmpeg, bun, or a tmux server that still answers;
  3. pins the gate's code. It reads `~/run-commit` (one full commit hash, written only by the
     runbook's step 0) and checks that commit out detached in the timer's own clone,
     `~/gate/rs-sdk`, so moving `~/rs-sdk` never changes the gate mid-series. If `~/run-commit` is
     missing, the firing skips with `no run-commit`;
  4. checks the server without logging in. It reads the public `/playercount`, with Fly's machine
     (`sid`) and worker (`bn`) from the `flyio-debug` header. Under 300 online, or no answer, it
     skips with `restart suspected (players N)`: a server refilling after a restart doesn't
     reflect the run's conditions, and a login would only add to its rush. The 20:00Z read on
     21 October crashed with 38 online, a restart inferred from the count alone;
  5. runs the #101 gate, `tickmanip-latency.ts gate --path=direct --no-tele`, under
     `timeout 240`.

  The account is a throwaway whose name and password exist only in the clone's `bots/gate/bot.env`
  (mode 600, on the host). The wrapper redacts the name and password from everything it keeps. A read takes
  about 4 minutes: the pre-login check's 60 s world-feed read, then the gate. If it hangs, systemd
  kills the unit's whole control group at 345 s (the wrapper's budget holds 75 s for the feed
  read on top of the probe's unchanged 200-240 s), so nothing is left running.
- **Where the history lives.** Each firing writes one file, `~/gate-history/<UTC timestamp>.json`.
  A read's file starts with `utc` and `endUtc`, `commit`, `status` (`ok`, `not-probed`, `timeout`
  or `error`), `T`, `on`, `onTime`, `catchUpsPerMinute`, `tickP50Ms`, `tickP90Ms`, `players` and `edge`, then
  `preLogin` (players, `flyMachine`, `flyWorker`, `serverStartUtc`, `serverStartToken`,
  `serverUptimeMin`, the feed read and the engine fingerprint from step 4), with the gate's own JSON under
  `gate`. A change of `flyMachine` between files marks a redeploy or machine swap. The three
  `server*` fields come from the token in the public page's `client.js?v=<token>` import, which
  the engine sets once at process start to `Date.now().toString(36)` (so base 36 decodes to the
  start in epoch ms), and they're null when the page or token can't be read. The uptime is
  measured to the read's `utc`. A change of `serverStartToken` marks a restart, which the player
  count alone can miss: on 22 October the world restarted at 19:24:45Z and had 740 online
  1.6 minutes later, well over the 300 floor. `tickP50Ms` is the gate's median tick interval
  (`result.steadiness.p50`); about 300 against about 600 tells the two tick rates apart, so it
  dates a return to 600 ms ticks to a read. Before login, `host-gate-feed.ts` (beside the
  wrapper) reads the engine's login-free world feed (`wss://<server>/worldfeed`,
  `server/engine/src/web/worldfeed.ts`) for 60 s on an empty 1x1 tile. It records the hello
  frame's `tickMsConfigured` (`World.tickRate`, the configured rate) and `feedTick`, plus
  `feedTickMs` {n, p50, p90, max, min} (the engine's own interval between ticks, with the first
  frame dropped because it can span the time since the last feed client) and `feedTickGaps`
  (frames whose tick number jumps by more than 1). These are null when the feed can't be read.
  On 22 October at 20:19Z it read `tickMsConfigured` 400, p50 401 over 149 intervals. The
  top-level `T` is the read's tick length: `tickMsConfigured` when the feed was read, else
  `tickP50Ms` rounded, else null. Records written before `T` existed are labelled in the
  tables, not rewritten: T = 300 before the 19:56:28Z restart on 22 October and T = 400 after
  (main's ruling). `preLogin` also carries an engine fingerprint, from public pages fetched
  alongside the player count, each field null when its fetch fails (`tickMsConfigured` belongs
  with it):
  - `hiscoreHover` is the first numeric hover on `/hiscores` (the Time column) with every
    number as `N`. Upstream b565f2d9 and our fork render `N ticks`. On 22 October the demo
    rendered `N seconds of game time` from about 19:34Z, then `N ticks normalized to N ms per tick`
    (400 ms in the live text) after its 20:08Z restart. A change in it is a change in the
    engine's own wording.
  - `hiscoreChromeSha` hashes `/hiscores` with the text of every innermost table cell, every
    player link and every number blanked. Names, ranks, levels and times don't move it; a change
    in the engine's page template does.
  - `playercountShape` hashes the `/playercount` response's keys and value types (its text with
    numbers as `N` if it isn't JSON), so it moves only when that endpoint's format changes.
  - `botBundleMd5` is the md5 of the served `/bot/client.js`. A webclient rebuild changes it,
    even from identical source (UPSTREAM-WATCH.md, "Which commit is the demo serving?"), so it
    dates client rebuilds separately from the engine.

  A change in `hiscoreHover` or `hiscoreChromeSha` with `botBundleMd5` unchanged means an
  engine-side deploy. The 19:36Z "Server is being updated" restart on 22 October is the first
  known engine change. The 20:08Z restart that day is the first one seen with the md5
  unchanged (`353760e9…` before and after). The published `server/Dockerfile` would have rebuilt
  the bundle, so the demo's engine is deployed some other way, and an unchanged md5 across a
  restart says nothing about the engine. A skip writes `status: skip` and its reason in `note`. A broken read (`error`, `timeout`,
  `not-probed`) puts its first error line in `note` and the last 40 lines of the probe's output in
  `outputTail`, with the account name and password redacted. The journal keeps one line per
  firing: `journalctl --user -t rs-gate-read`. Use `-t`, not `-u`: `-u` can miss the summary line,
  which is printed as the read exits; `-u` shows systemd's own start, failure and kill lines. Check
  the next firing with
  `systemctl --user list-timers rs-gate-read.timer`.
- **Every 15 minutes from two hours before the start.** On the host, run
  `bash ~/.local/lib/rs-gate/install.sh --every 15`. It moves the timer to :00, :15, :30 and :45 in
  place, and `--every 30` switches it back.
- **Reserving the host.** Anyone who needs the host quiet (the run script, rehearsals, a slot
  holder) writes `~/host-reserved.json` and removes it afterwards:
  `{"owner": "rs/NNN", "until": "2026-10-22T03:00:00Z", "reason": "rehearsal"}`, with `until` in
  UTC. Until then every firing logs `skip: reserved by rs/NNN` and does nothing. A stale file whose
  `until` has passed is ignored, so a forgotten removal costs nothing. This is how the run keeps the
  host quiet without anyone having to remember the timer. A slot holder that wants one read inside
  its own reservation fires it with `systemctl --user set-environment RS_GATE_OWNER=rs/NNN`, then
  `systemctl --user start rs-gate-read.service`, then
  `systemctl --user unset-environment RS_GATE_OWNER`.
- **Stopping and removing.** To pause, run `systemctl --user disable --now rs-gate-read.timer`; to
  resume, run `bash ~/.local/lib/rs-gate/install.sh`. To remove it, run
  `bash ~/.local/lib/rs-gate/uninstall.sh`. That also stops a read in progress, and it keeps
  `~/gate-history` and the clone.
- **Twin.** Tenet 17 keeps both Ashburn machines run-capable and gates both, so the twin runs the
  same timer, installed by rs/249 at 02:29-02:32 UTC on 22 October, item for item from the run
  host. It has the same five files (identical sha256), byte-identical unit text and the same
  `:00`/`:30` schedule, enabled. Its blob-less clone `~/gate/rs-sdk` is detached at the run host's
  `~/run-commit`, with the same dependency stamp, and lingering is on. Its account is its own fresh
  `cairn_` throwaway, whose name and password exist only in the twin's mode-600 `bots/gate/bot.env`.
  The two machines fire in the same minutes, and each keeps its own history, so files with the same
  name on the two machines are one same-minute pair: the paired series tenet 17 asks for, read
  without anyone running it. The twin's first scheduled firing (02:30) skipped as reserved by
  rs/249's install claim. Its first read, inside that claim, passed (60/60, 0 catch-ups per minute,
  tick p90 426 ms, 1,561 online, edge iad) and logged out. From then on step 0 writes `~/run-commit`
  on both machines together.

## 11. Open questions

1. **The operator's Ashburn VM row.** (The Ashburn burst and blind distributions are in, from
   rs/86 run 5, section 6.)
2. **The relay fix's tail.** rs/98's fixed lite runner landed 60 of 60 from Ashburn (section 5).
   State collection's tail (40 ms p90 on a loaded host) is the remaining risk; run-night
   re-measures keep testing it.
3. **Other hours.** Answered for 02:43-12:30 PDT on one night (section 9, 'Overrun bursts
   overnight'): no hour is reliably clean, and the gate has to decide at the moment of starting.
   Still open: the evening and a second night. The run host's gate timer (rs/140, :00 and :30 UTC)
   extends the series without a GitHub runner.
4. **The HTTP wait.** Ashburn's 404 waits run up to about 380 ms, longer than the reaction data
   allows for the engine's busy time. Other work served between cycles is the likely cause
   (inferred); it does not affect the run's route.
5. **An exact route-wide tally of reactive steps** (level-ups, re-clicks, dialogue pages, trades,
   bank steps). Section 10 bounds it at about 2,300-4,300 reactions; a tally per step script
   would narrow the 2,300-8,600 tick range.
6. **The public-relay path** from home and from Ashburn, for completeness. The gateway's HTTP
   numbers already show it is the worst path, and the run does not use it.
7. **Websocket ping** as a cross-check on the one-way latency estimates, and the related mismatch
   between the home and Ashburn delay sweeps (section 3): either the game socket's home RTT is
   lower than `mrtt` suggests, or each account's frame leaves at a different point in the
   engine's output batch. A sweep from two accounts at once from Ashburn would separate them.
8. **Browser rows in a gate-passing minute.** Answered for the in-page program: at 15:45 PDT
   (22:45 UTC) the run machine's direct row passed the gate (58/60, 0.7 catch-ups per minute) and
   the in-page probe landed 60/60 (section 7). The overlay still has only its near-calm 13:15 row
   (59/60, equal to direct, 2.4 catch-ups per minute). The knife's split per log is measured
   (section 8, rs/176): on oak the in-page knife runs 3.23 ticks per expected roll against the
   in-page plain loop's 3.80 over three sessions, and shows no cost from catch-ups at the program
   counter's 0.7-5.8 per minute; its slips are honest miss runs. The overlay's knife loses
   (8.3-9.2 against 6.4-7.2 on normal trees). Still open: a longer calm-minute knife sample (the
   0-2 per minute bin is 43 gaps, too few to resolve a few per cent), whether the in-page misses in
   a window with no 350/150 catch-ups come from soft overrun pairs (section 7), and the overlay
   knife's completed fletches.
9. **What drives overruns.** Not the hour, and barely the player count (correlation 0.20 per
   minute; section 9, 'Overrun bursts overnight'). Four of five severe bursts fell within 40
   minutes before one of the demo's restarts, which suggests a process degrading before it exits,
   but that is two restarts and no server-side data. Untested: the phase of the per-player saves
   (`World.PLAYER_SAVERATE`) and the helper fleet beyond 04:30.
10. **Where Fly held the old address's ticks.** The hold followed the run host's old address and not the twin's
   or the replacement address (section 9), but the place it happened is not identified. On the old
   address `flyio-debug` showed edge node `edge-dp-ash2-914f` and app worker `worker-cf-iad2-ce4c`;
   recording the edge node for each new address would show whether one edge node is involved. A
   Fly Machine in `iad`, which reaches the app over Fly's private network and bypasses the public
   edge, would test the edge directly; it is blocked on the Fly account's trial limits (machines
   stop after 5 minutes). The gate timer keeps reading the new address at :00 and :30 UTC.

Corrected: an earlier draft ruled out long server ticks as a cause. They are a cause, through the
engine's catch-up scheduling (sections 2 and 3).
