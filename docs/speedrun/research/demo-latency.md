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
| `flyio-debug` from home (fedora, Mac, bgsrv-ub, bgsrv-mac; one egress IP, 174.65.237.102) | `nr=lax` (Los Angeles edge), `sr=iad`, `sdc=iad2`, `bn=worker-cf-iad2-ce4c`, mesh hop via edge-dp-ash1/ash2, `mrtt` 56-86 ms | curl with `flyio-debug: doit`, 01:36-02:37 |
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
| Browser tab, overlay path (rs/82's branch) | browser | pending | | | | | | | | rs/95 |
| Browser tab, in-page program (rs/97's branch) | browser | pending | | | | | | | | rs/95 |

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
= 6/171 = 3.5%, all from the overloaded run. The misses at 04:13 that followed a normal interval
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
| 03:47-03:57 | Mac, one session, 10 min, no input | 1,576-1,680 | 179 / 299 / 404 / 803 ms; 210 of 2,021 intervals over 400 ms (10%) | hour sample |
| 04:00-04:12 | fedora, one session, 10 min (load 19 of 32 cores) | 1,623-1,675 | 171 / 291 / 394 / 794 ms; 194 of 2,071 over 400 ms (9%). Direct reactions from home: +0 ms 1/14/0, +25 ms 1/14/0 | fedora sampler 1 |

The interval p10 of 118 ms from home is the engine's catch-up after a long tick (`World.ts` lets
the next cycle start early to recover up to two ticks of backlog). Samples at other hours are
still to come (open question 3).

**How often would a steadiness gate pass?** Over 1-minute windows of tick arrivals
(`demo-latency-analyze.ts --window-min=1`):

| Series | Windows passing p90 <= 400 ms | Passing p90 <= 400 and max <= 600 ms |
| --- | --- | --- |
| Ashburn direct sessions, 02:43-04:13 (one window each, plus three at 02:48) | 7 of 8; the one failure is 04:13 | 2 of 8; rejects the three 60/60 runs at 02:43, 03:17 and 04:04 |
| fedora, 10-minute sample at 04:00, 1,623-1,675 online | 11 of 19 | 1 of 19 |

The max criterion does not separate good minutes from bad: single long ticks are common and
harmless on their own. The p90 criterion does, on this data: it passes every Ashburn session that
landed 60 of 60 and fails the one that did not. At 04:00 a little over half the minutes would
pass.

**Should the run go at a quiet hour?** Not settled. Overruns are load-dependent, so a quieter
hour may have fewer of them, but 04:04 (1,673 online) had none while 04:13 (1,645-1,669) had many,
so the player count alone does not predict them. A quieter hour also costs elsewhere: rocks and
trees respawn faster with more players online
(`server/content/scripts/general/scripts/player_count.rs2:1-4`, capped at 2,000), and rs/2 costs
Mining at about 4,034 ticks at 1,260 online against about 4,288 at a quiet hour. The fedora sampler
(one session, 45 minutes apart) is collecting the hour series; until it shows a pattern, start at
a normal hour and let the run-night gate decide minute by minute (section 10).

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
- Level-up dismissals, re-clicks after a felled tree or a stun, pickpocket re-clicks, trades,
  bank steps and quest dialogue each pay one reaction. rs/3's quest README models dialogue at
  fixed ticks per page; a reaction that lands a tick late adds a tick per page or click. The
  route-wide count of those steps is not tallied here (open question 5).

**What the run-night probe must read before starting**, from the run machine, on the run's own
route (local webclient build, loopback gateway, in-page probe; cairn://p/rs/96 and rs/97), at the
real player count:

1. `GET /playercount`, recorded.
2. `flyio-debug` shows `nr=iad`, `sr=iad`, no mesh hop; TCP connect p50 under 5 ms (rs/86's
   workflow refuses to log in above 10 ms).
3. The direct in-page probe lands **60 of 60 on the next tick (floor 58)**.
4. The blind sender lands at least 95% on the aimed tick, and a burst of the knife's bundle lands
   on one tick.
5. **Tick steadiness over the probe's minute: publication interval p90 <= 400 ms.** If it fails,
   wait and re-measure; do not start on a minute of overruns. A cap on the maximum interval (for
   example 600 ms) is not recommended: on the data so far it rejects the minutes that scored 60
   of 60. Keep checking during the run; a reactive loop that sees back-to-back ticks (an interval
   under 50 ms) should expect its next reaction to miss.
6. If the SDK drives any step that reacts, the relay probe for that step, gated by
   `speedrun/lib/hostgate.ts`.

Until the in-page probe exists, `demo-latency-probe.ts --phases=react,burst,blind` from the run
machine is the stand-in for items 3 and 4.

## 11. Open questions

1. **The Ashburn VM row** and the Ashburn burst and blind distributions (rs/86 is running them).
2. **The relay fix's tail.** rs/98's fixed lite runner landed 60 of 60 from Ashburn (section 5).
   State collection's tail (40 ms p90 on a loaded host) is the remaining risk; run-night
   re-measures keep testing it.
3. **Other hours.** The reaction distribution and tick intervals at two or three other hours and
   player counts. The sampler command: `demo-latency-probe.ts --phases=react,sample
   --react-delay=0,25 --trials=15 --minutes=10`.
4. **The HTTP wait.** Ashburn's 404 waits run up to about 380 ms, longer than the reaction data
   allows for the engine's busy time. Other work served between cycles is the likely cause
   (inferred); it does not affect the run's route.
5. **A route-wide count of reactive steps** (level-ups, re-clicks, dialogue pages, trades, bank
   steps) to price the run exactly.
6. **The public-relay path** from home and from Ashburn, for completeness. The gateway's HTTP
   numbers already show it is the worst path, and the run does not use it.
7. **Websocket ping** as a cross-check on the one-way latency estimates, and the related mismatch
   between the home and Ashburn delay sweeps (section 3): either the game socket's home RTT is
   lower than `mrtt` suggests, or each account's frame leaves at a different point in the
   engine's output batch. A sweep from two accounts at once from Ashburn would separate them.
8. **The browser-path rows** (rs/95): the tab's overlay on rs/82's branch and the in-page program
   on rs/97's branch.

9. **When overruns happen.** They took the Ashburn direct path from 60/60 at 04:04 to 40/16/4 at
   04:13 with about the same player count. The fedora sampler's hour series, with tick p90 per
   window, should show whether they cluster by hour, by player count, or by something else on the
   demo (saves every 15 minutes at `World.PLAYER_SAVERATE`, other users' load).

Corrected: an earlier draft ruled out long server ticks as a cause. They are a cause, through the
engine's catch-up scheduling (sections 2 and 3).
