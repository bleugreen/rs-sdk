# Local test lab for speedrun measurements

Every measured number under `docs/speedrun/` comes from a local engine driven by
the headless lite client. This page is the shared setup.

## Setup

```sh
bun install                                   # repo root
(cd server/engine && bun install)
(cd server/webclient && bun install)
```

Run three long-lived processes (use terminals, not one-shot batches):

```sh
cd server/engine && BUILD_VERIFY=false BUILD_LIVE_RELOAD=false NODE_TICKRATE=100 LOCAL_STAFF_LEVEL=4 bun run start
cd server/webclient && bun run watch
cd server/gateway && bun run gateway
```

- `BUILD_VERIFY=false` skips the pack checksum check (`server/PATCHES.md:178`).
- `BUILD_LIVE_RELOAD=false` is required on every executor. It turns off the dev
  content watcher (`server/engine/src/util/WorldConfig.ts:285`, used at
  `World.ts:360`), which `fs.watch()`es every directory under `content/`
  (`server/engine/src/cache/DevThread.ts:79`). That exceeds the executors'
  8,192 open-file cap and crashes the engine with EMFILE (a Bun panic in
  `us_create_timer`).
- `NODE_TICKRATE=100` runs 100 ms ticks, three times faster than production's
  300 ms (`fly.toml:26`). Report results in ticks, never in seconds. The bot
  reacts in wall-clock time, so anything that depends on landing a packet in a
  specific tick can come out differently at 100 ms and 300 ms. That includes a
  click on the tick after a roll, drops sent in the same tick as the next click,
  eating between attempts, and combat. Confirm any such headline cadence with
  at least one run at `NODE_TICKRATE=300`, and say in the document which rate
  each number was measured at.
- `LOCAL_STAFF_LEVEL=4` grants staff level 4 to every login when no login server
  is configured (`server/engine/src/server/login/LoginThread.ts`). It defaults to
  0, and production uses a login server (`fly.toml:22`), so the public server is
  unaffected. Staff 4 enables `::setstat <skill> <level>`, `::give <obj> <n>`,
  `::tele level,mx,mz,lx,lz` (map square x/z = tile >> 6, local = tile & 63; e.g.
  Varrock west bank (3185,3436) is `::tele 0,49,53,49,44`) and `::setvar`.

Bots:

```sh
bun bots/create-bot.ts <name> --local         # writes bots/<name>/bot.env (gitignored)
cd server/webclient && bun src/lite/runner.ts <name>   # headless client, leave running
bun bots/<name>/<script>.ts                   # scripts import runScript from sdk/runner
```

Lab scripts drive the lite client; the browser webclient holds the same loops (next
section). Do not use MCP `execute_code` for rapid-fire tests.

### Which client a number was taken on

Every measured number under `docs/speedrun/skills/` was taken on the **headless lite
client** (`server/webclient/src/lite/`) unless its row says otherwise. The scored run
will drive the **browser webclient** in a visible tab, because the recording must be
first-person. Since cairn://p/rs/82 the browser client has the lite client's tick
handling: it publishes a tick only after all of the tick's packets are decoded, and the bot
state reports entities at their server tile, not their eased draw position. Since
cairn://p/rs/113 the overlay runs an SDK action when its gateway message arrives, not on the
next game cycle, and flushes the game socket at the end of that task (`Client.flushNow`), so
a burst delivered together leaves as one websocket message. It publishes the post-action
state afterwards, in a task of its own. The game loop's own pass still drains `wait`
actions, expiry, and anything sent while the client was off the game screen.

The page also decodes each server tick when it arrives. The game socket's message event
wakes the run loop (`GameShell.wake`, `ClientStream.onReceive`), so the next pass, which
decodes at its start, runs at once instead of after the loop's sleep. Decoding stays
inside a normal pass, with the vanilla structures, order, `loopCycle` and error handling
(`lostCon` and `logout` still block the loop), and the draw never sees half a tick. The
decoded-tick callback (in-page programs, the overlay's state) therefore fires at arrival,
and the loop flushes straight after its decode, so what the callback writes leaves at
once. `run()` paces itself from measured frame times, so an early pass shifts the loop's
phase and not its rate. Reaction timing no longer waits on a timer, which a background
tab would throttle.

The overlay's reaction path, measured page-side with `overlay-trace-lab.sh` (every websocket
message the page sends or receives, on the page's clock) on bgsrv-mac, visible Chrome tab,
local engine at `NODE_TICKRATE=300`, 60 trials each, all 60 of 60 at 1 tick, load 2.8-4.0,
in ms p10 / p50 / p90:

| Hop | Before (main, #81) | rs/113 |
|---|---|---|
| Tick frame in to state out | 1.6 / 7.2 / 12.4 | 0.4 / 0.5 / 0.6 |
| State out to action in (gateway, SDK, gateway) | 2.7 / 2.9 / 3.6 | 2.4 / 2.8 / 3.6 |
| Action arrival to packet on the wire | 8.8 / 11.2 / 12.9 | 0.2 / 0.2 / 0.3 |
| Page reaction, tick frame in to packet out | 15.2 / 20.7 / 27.4 | 3.1 / 3.5 / 4.4 |
| Game loops and frames drawn per second | 74.2 and 74.2 | 74.2 and 74.2 |

What remains is the gateway and SDK round trip, outside the page.

The earlier warning that the browser freezes under rapid-fire input did not reproduce. In a
visible tab on a quiet Mac, the stock client sent 4 packets per cycle at 71 fps with no
event-loop stall over 50 ms. What the stock client did have was a tick of extra latency on
every reaction, the same defect #20 fixed in lite. Measured 2026-10-21 in a visible Chrome
tab on bgsrv-mac (16 cores), local engine at `NODE_TICKRATE=300`, with the load average
beside each number:

| Measure | Browser, rs/82 | Browser, stock | Lite (skills docs) | Load |
|---|---|---|---|---|
| `tickmanip-latency.ts`, 60 trials | 60 at 1 tick | 58 at 2, 2 at 3 | 60 at 1 | 10-12 (fixed), 3 (stock) |
| 5-packet burst every tick, 3,000 ticks | 3,000 walks land on the next tick, 0 unresolved, 71 fps, no stall over 50 ms | | | 3 |
| Knife mining, respawn 13, 200 ores | 3.05 ticks per ore (192 of 194 gaps at 3) | | 3.00 | 15-17 |
| Knife fly fishing, Lumbridge, level 26 to 99 | 4.16 ticks per catch over 674 catches, gap 3 on 516 of 665 | | about 5.1 | 13-15 |
| Pickpocket, Knight of Ardougne, level 55 | after a success 2 ticks on 170 of 181; after a fail 11 on 90 of 118 | | 2 / 11 | 4 |
| Pickpocket, level 99 | 2 ticks on 261 of 276; 0.35 rolls per tick | | 2 / 11 | 3 |

Ticks per catch depends on level (catch chance), so compare the fishing row's gap
histogram (the 3-tick knife cadence) rather than its average. The speedrun/lib watchdog
still catches a wedged tab: it relaunched 3.1 s after the wedge.

Two lite-client fixes the quest route depends on hold on the browser client too, checked
with `scripts/runclient-check.ts` on both clients against one local engine (the
`local` Mac, `NODE_TICKRATE=300`, load 150-190 on 16 cores, 2026-10-21, cairn://p/rs/116):

- **Sea Slug's bridged doors** (cairn://p/rs/54). For both platform doors, `loc_1533`
  (2765,3277) and `loc_1530` (2764,3285) upstairs, a routed `sendWalk` into the room
  stops at the door while it is shut and arrives in 1-2 ticks once the overlay has opened
  it, on both clients. The browser never had the lite defect: it applies loc changes to
  its own pushed-down scene and collision maps, as the original client does. These are
  the only doors on bridged tiles anywhere in the map. After a long `::tele` the browser
  needs the region fetched and rebuilt before its scene holds the door (46 ticks at that
  load); wait for the loc, not a fixed delay.
- **Monkey Madness's sliding puzzle** (cairn://p/rs/23). `sdk.sendUseItem(slot, 5, 11130)`
  sends OPHELD5 and moves a tile in 1-2 ticks on both clients; the last move reached the
  powered hangar 21 ticks later (lite 22). `sendClickComponentWithOption(11130, 5, slot)`
  sends INV_BUTTON5 and moves nothing on either client.

**Against the demo.** `server/webclient/proxy.ts` serves this build's bot bundle in front
of a remote world, and the page takes `?server=` (game socket) and `?gateway=` (overlay
gateway) parameters (`src/util/Endpoints.ts`). From bgsrv-mac, a throwaway account logged
into rs-sdk-demo.fly.dev from this build, and the probe run through a loopback gateway and
the page's overlay read 13 at 1 tick, 46 at 2 and 1 at 3 (load 2.3). That is the relay cost
described under "Direct path and relay" below, not a client defect. Reactive loops against
the demo therefore belong in the page (cairn://p/rs/97), and the knife loops still sit
behind the on-time probe at run time.

## Running several labs on one machine

Each process takes its ports from the environment, so parallel labs only need
distinct port blocks. Engine: `WEB_PORT`, `WEB_MANAGEMENT_PORT`, `HISCORES_WEB_PORT`,
`NODE_PORT` (`server/engine/src/util/WorldConfig.ts:234-241`, `Environment.ts`).
Gateway: `AGENT_PORT`, plus `WEB_MANAGEMENT_PORT` so it finds its engine
(`server/gateway/gateway.ts:20,141`). Bot: `SERVER=localhost:<WEB_PORT>` and
`GATEWAY_URL=ws://localhost:<AGENT_PORT>` in `bots/<name>/bot.env`
(`sdk/index.ts:71-84`, `server/webclient/src/lite/runner.ts:397,422`).

| Block | WEB_PORT | WEB_MANAGEMENT_PORT | HISCORES_WEB_PORT | NODE_PORT | AGENT_PORT |
|---|---|---|---|---|---|
| default | 8888 | 8898 | 8889 | 43594 | 7780 |
| agility | 8910 | 8911 | 8912 | 43610 | 7810 |
| mining | 8920 | 8921 | 8922 | 43620 | 7820 |
| woodcutting | 8930 | 8931 | 8932 | 43630 | 7830 |
| fishing | 8940 | 8941 | 8942 | 43640 | 7840 |
| thieving | 8950 | 8951 | 8952 | 43650 | 7850 |
| tickmanip | 8960 | 8961 | 8962 | 43660 | 7860 |

The default block belongs to whoever is not on this list (the fletch-menu client
hang fix, the quest-route issues). Quest-route children should take blocks from
9010 upward in the same pattern.

Example (mining block):

```sh
cd server/engine && WEB_PORT=8920 WEB_MANAGEMENT_PORT=8921 HISCORES_WEB_PORT=8922 NODE_PORT=43620 \
  BUILD_VERIFY=false BUILD_LIVE_RELOAD=false NODE_TICKRATE=100 LOCAL_STAFF_LEVEL=4 bun run start
cd server/gateway && AGENT_PORT=7820 WEB_MANAGEMENT_PORT=8921 bun run gateway
# bots/<name>/bot.env: SERVER=localhost:8920 and GATEWAY_URL=ws://localhost:7820
```

All of a lab's processes and scripts must run on the same machine; pin every
batch to one executor.

Pick a quiet one for anything tick-exact. A loaded host delays state publications and
pushes the bot's packets a tick late, and predicted loops collapse: on a Mac at load
average 100+ the knife iron rotation measured 8.6 ticks per ore against 3.00 on a quiet
host (`skills/tick-manipulation.md` section 6). Run
`bun docs/speedrun/scripts/tickmanip-latency.ts <bot>` first: against a local lab engine
every trial should read 1 (a packet sent on label c lands on tick c+1), and the publication
interval should sit at the tick rate. Against the demo through the SDK relay, 2 is normal
and what counts is the share at the dominant offset (the relay fallback of the run-time
gate, `skills/tick-manipulation.md` section 6).
Say in the document which host each number came from.

Measured on 2026-10-21 (`tickmanip-latency.ts`, 60 trials, lite client with the
rs/22 fix):

| Host and target | Load | Latency in ticks | Publication interval p50 / p90 / max | Send resolve p50 |
|---|---|---|---|---|
| bbs, local lab engine at 300 ms | 2.5 on 32 cores | 1: 60 of 60 | 304 / 306 / 309 ms | 20 ms |
| bbs, demo server (rs-sdk-demo.fly.dev), private loopback gateway, fleet 20-21 of 21 online | 4.0 | 2: 25, 3: 35, none at 1 | 291 / 385 / 626 ms | 20 ms |

bbs is the reference host for lab numbers. The Mac (`local`) is not: it ran at
load 80-112 during the rs/26 runs (main measured 11-18 on 16 cores at other
times tonight), and numbers taken there read pessimistic (the knights lost a
third of their 2-tick success gaps). On the demo the bot's own sends are as fast
as in the lab; the extra 1-2 ticks come after the packet leaves the host. A loop
that reacts to observed state (Agility obstacles, dialogue) pays them on every
step. A loop that clicks blindly every tick (pickpocketing) does not.

**Direct path and relay.** Those extra ticks are the SDK relay (runner, gateway, lite
client), not the host or the server's tick. From Azure eastus at about 1,655 online
(cairn://p/rs/86), reactions issued in-process on the engine websocket landed 60 of 60 on
the next tick, and through a private loopback gateway plus the lite client 32 at 1 and 28
at 2. A local lab engine gives 1-tick reactions through the relay, so **every loop figure
taken in this lab is a direct-path figure**. The scored run runs its reactive loops (knife
loops, pickpocket re-click, Agility obstacles) as in-page tick programs in the browser
webclient (cairn://p/rs/97) for that reason. Don't plan a relay-driven knife loop against
the demo.

Long-lived terminals may not be pinnable to the executor that runs your
scripts. In that case, run the whole lab inside one pinned batch:
`LAB_BLOCK=<block> NODE_TICKRATE=<ms> bash docs/speedrun/scripts/lab.sh <bot> <script.ts>[:arg:arg] ...`
starts the engine and gateway on that row of the port table, waits for
`World ready`, creates or repoints the bot, runs the scripts in order, then
stops everything. `LAB_BLOCK` defaults to `agility` and `NODE_TICKRATE` to 100.
Give the batch a long timeout, because the first boot packs the content.

On a loaded executor the bot itself can stall: at 300 ms on a machine at load
29 of 32 cores, single click round trips through the gateway and runner took up
to 29 s and the engine's own ticks stretched to over 2 s. A per-tick loop
cannot click during such a stall, so a cadence measured there mixes bot
latency into server cadence. Log wall-clock time beside ticks (as
`thieving-pickpocket.ts` does), report stall-free windows separately, and
prefer an idle executor for headline runs.

## Measuring

- Log the server tick of every xp change and report the gaps; that is the cycle
  time. Report base xp: the local engine defaults to the production rate of 25x
  (`server/engine/src/util/WorldConfig.ts:102`), so base xp = game xp / 25.
- Level-up chat dialogs freeze gathering loops; dismiss them
  (`sdk.sendClickDialog(0)`) as soon as they appear.
- The lite client does not list locs on bridge-flagged levels (for example the
  Lady Lumbridge gangplank). Interact with those by tile and loc id instead of
  looking them up in the nearby-loc list.
- Commit measurement scripts under `docs/speedrun/scripts/<skill>-<what>.ts` so
  a number labelled measured names a script someone can rerun. They import
  `runScript` from `../../../sdk/runner` and take the bot name as an argument:
  `bun docs/speedrun/scripts/mining-cycle.ts <botname>` (credentials come from
  `bots/<botname>/bot.env`).
