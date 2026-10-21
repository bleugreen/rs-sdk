# Altar giver (Runecraft essence on the blind cycle)

The scored account trains Runecraft without leaving the altar room: it stands south of the altar while helpers trade it 27 rune essence each, and it crafts the moment each trade completes (`skills/runecraft.md` section 4). The cycle is blind. Nobody reacts to anything: the giver's trade request lands on T+5 after the scored account's craft on T, its offer and accept on T+6, both confirms on T+7, and the next craft on T+7. One tick late anywhere costs the whole cycle. This page covers the giver side of that cycle (`speedrun/helpers/altar-giver.ts`), the cue that tells each giver when to go (`speedrun/helpers/altar-cue.ts`), and the stand-in scored side used to measure it (`speedrun/helpers/altar-receiver.ts`). The scored side itself is the run's Runecraft step, built by cairn://p/rs/131 (an in-page program) and relayed by rs/103's `run.ts`.

Givers run on the run machine through `speedrun/helpers/standalone.ts`, never in the bbs fleet (HELPERS.md, "Helpers on the run machine").

## What a giver does

A loop, restartable from any state:

1. **Restock** to exactly one talisman and 27 rune essence (`altar-room.ts` `restock`). Kinds: `bank` (leave by the exit portal, walk to the altar's bank, deposit everything but one talisman, withdraw 27 essence; when the bank is short it accepts a supply trade from `acceptFrom`), `trade` (wait at `restockAt`, default the exit tile, for a courier's trade) and `cheat` (lab only).
2. **Enter** by using the talisman on the mysterious ruins.
3. **Stand** on its slot tile next to the scored account's tile.
4. **Serve**: publish `ready`, wait for a turn naming it in the cue, run its half of the schedule on its own frames, and judge the outcome. After a trade it goes back to 1.

The talisman is the 28th slot, so a giver gives 27 essence. The scored account drops its own talisman after entering (it doesn't need it again) and keeps the rune stack in its 28th slot.

**Tiles.** With the altar's south-west corner at (ax, az), the scored account stands on (ax+1, az-1). The giver slots are 0 east (ax+2, az-1), 1 west (ax, az-1) and 2 south (ax+1, az-2). A request from a diagonal or the same tile makes the requester step first, which the schedule can't absorb. Several givers may share a slot tile (players stack), so a roster larger than three needs no extra tiles.

## Options (`ROLE_OPTIONS`)

| Option | Default | Meaning |
|---|---|---|
| `altar` | `air` | `air` (levels 1-44) or `nature` (44-99) |
| `slot` | 0 | 0 east, 1 west, 2 south of the scored tile |
| `essence` | 27 | essence per trade |
| `schedule` | follow the cue | `robust` forces the 8-tick schedule for every turn |
| `restock` | `{ kind: 'bank' }` | `{ kind, bank?, acceptFrom?, restockAt?, labStock? }` as above |
| `gapMs` | 0 | wait after a frame arrives before sending (0: send on arrival) |
| `cueDir` | `RC_CUE_DIR`, else `run-machine/rc-cue` | the cue directory |

## The cue contract

One directory (`RC_CUE_DIR`, default `<checkout>/run-machine/rc-cue/`, gitignored; both sides refuse a directory git would track). The scored side writes `cue.json`; each giver writes `giver-<account>.json`. Every write replaces the whole file (tmp + rename). Givers watch the directory and also poll every 20 ms. Files rather than a socket mean either side can restart and re-read, and nothing has to be listening first.

**`cue.json`** (written by the scored side; `CueWriter` in `altar-cue.ts`):

    { v: 1, session, seq, receiver: { sha256 }, beacons: [{ tick, ms }, ...], schedule: 'tuned' | 'robust',
      open: 5, turns: [{ giver, T, schedule? }, ...], stop?, ms }

- `receiver.sha256` is the sha256 of the scored account's canonical name (lower case, runs of spaces and underscores become `_`). **No file names the scored account.** Givers hash the names of nearby players to find its player index, and check the trade partner the same way. `new CueWriter(dir, receiverName)` does the hashing.
- `beacons` are the scored client's recent frames: its tick count and the wall-clock time (Date.now() scale) the frame arrived. Send several (up to 8). A single beacon is refused if two of the giver's frames sit within 100 ms of it (a catch-up after an overrun); several resolve it by pattern.
- `session` changes on every scored login; `seq` increases on every write.
- `turns` is the session's whole list. A giver acts on the newest turn naming it. T is the tick the scored account's craft lands on, **in the scored client's numbering**. A per-turn `schedule` overrides the cue's.
- `stop: true` cancels any armed turn whose first packet has not gone out.

**The clock.** `state.tick` counts the frames one client has received, so the scored account's T means nothing to a giver directly. Both clients get each server frame within a few ms of each other on one machine, so a giver matches the beacons against its own frames' arrival times and learns a constant offset between the two numberings. Each side then fires on its own frame arrivals. The cue only has to arrive early, and no relay hop sits on the reaction path.

**Timing.** A packet group that should land on tick L goes out on the first arrival of the frame for L-1. The giver's half: request lands T+K (K = `open`, 5), offer all and accept T+K+1, confirm T+K+2; robust adds a second confirm on T+K+3. A giver must see its turn by its frame for T+K-2, so a turn written at the scored craft click (T) has 4 ticks to spare. The stand-in writes each next turn at its craft click and never had a late turn. For a session's first trade, use a virtual T whose T+K-1 is at least 3 frames ahead.

**`giver-<account>.json`** (heartbeat every second):

    { v: 1, account, phase: 'start'|'restock'|'travel'|'ready'|'armed'|'fault'|'off', loggedInAt, essence,
      tile, inRoom, readyAt, armed?, last?: { session, T, outcome, myT?, detail?, ms }, gave, detail?, ms }

Pick givers that are `ready` or `armed`, `inRoom`, with a heartbeat under 5 s, standing orthogonally next to the scored tile; oldest `readyAt` first. A client can't see its own player index, so it isn't in the file; giver names are not secret, so look the giver up by name among nearby players. Outcomes: `gave`, `missed` (the schedule ran and the essence is still held), `late` (the turn arrived after its first packet's frame), `clock` (no offset could be resolved), `not-ready` (named while restocking), `no-receiver` (nobody in sight matches the hash), `cancelled` (stop or a new session before the first packet).

**Tuned or robust.** Tuned needs every giver handled before the scored account in each tick, which means logged in before the scored account's current login. `launcher.json` (`helpersReady`, each account's `loggedInAt`) and each giver's own `loggedInAt` (updated when it relogs) tell the scored side. Robust is the safe default; use tuned only for a giver that logged in before the scored login. The stand-in does this per giver with `autoRobust`.

## Rosters and batches

The giver doesn't know which of these it is in. It serves whenever it is ready and named.

- **Air altar (H5 in rs/103's SUPPLIES.md):** 7 givers stand loaded in the room before the scored account's first login and give one trade each.
- **Nature altar (H17): a continuous roster.** The scored account stays logged in. A giver that has traded leaves, restocks and comes back, and the scored side names the next ready giver at each craft click. N givers keep the chain unbroken when N >= ceil(restock round trip / 7) + 1. Givers must not relog during it (a relog puts a giver behind the scored account, and it drops to robust).
- **Batches (the fallback):** N loaded givers, N trades in 7N ticks, then the scored account logs out while they restock. A new login is a new `session`. Armed givers stand down on the session change and are named again in the new session.

When a turn fails, the stand-in stops the cue, declines any open screen, burns what it holds and starts a new chain with a fresh virtual T. The run's step should do the same.

## Measured

Lab (local engine at `NODE_TICKRATE=300`, the launcher with 3 givers and the stand-in on the build slot, air altar; `speedrun/lab/altar-givers.ts`):

| Variant | Login order | Turns given | Craft-to-craft gaps |
|---|---|---|---|
| tuned | givers before the receiver | 21/21 (two runs) | 20 gaps, all 7 |
| tuned | receiver first | 0/21 | every trade declined |
| robust | receiver first | 21/21 | 20 gaps, all 8 |
| tuned, real restock (portal, Falador east bank, 27 essence, ruins) | givers first | 21/21 in 7 batches of 3 | 14 in-batch gaps, all 7 |

Restock round trip at the air altar via Falador east bank: 91-93 ticks (mean 91.7, n=18).

Demo (rs-sdk-demo.fly.dev, 2026-10-21 16:27-16:36 UTC, the launcher on bgsrv-ub, San Diego, 14 ms TCP connect; 3 givers logged in before the stand-in; 26 essence per trade so the stand-in can keep its talisman):

| Variant | Turns given |
|---|---|
| tuned | 1/21 |
| robust | 0/9 |

The relay is the cause, not the schedule or the login order. `docs/speedrun/scripts/tickmanip-latency.ts` through the same loopback gateway and lite client landed 9 of 60 packets on the tick after the state they were sent on and 51 a tick later (the demo published ticks at a median 309 ms). A blind turn needs about six packets on exact ticks across the two sides, so one late packet anywhere loses the turn. The lab passes because its engine is on loopback. Processing order is not the cause either: the engine processes players in 8 buckets keyed by the client's IP (on the demo, the `fly-client-ip` header) and in login order within a bucket, so clients on one host share a bucket and login order holds. Robust failed too.

From the run host (ashburn, AWS us-east-1, 1.8 ms to the demo; 2026-10-21 16:58-17:00 UTC, 2 givers logged in before the stand-in, tuned): **6 of 8 turns gave, and both measurable gaps were 7 ticks**. The 2 misses were the first turn of a batch. That minute was an overrun burst (7 catch-ups; `speedrun/lab/tick-health.ts`), so it needs repeating in a calm minute before it counts.

So a giver driven through the SDK relay is tick-exact only where that relay is: measure it on the run machine with the same probe before trusting the tuned or the robust schedule. Where it isn't, the giver's schedule has to fire on raw frame arrival inside the client process (the counterpart of the scored side's in-page programs).

## The direct path

A giver with `path: 'direct'` in the launcher config drives its own lite client in-process, with no gateway (HELPERS.md, "The direct path"; `speedrun/lib/direct.ts`). The role code is the same module. Its `onStateUpdate` listener runs inside the client's tick callback, and the request, offer+accept and confirm it fires there are on the wire before that callback returns. Through the relay, the same packets cross two more processes and four loopback socket hops first.

Lab (local engine at `NODE_TICKRATE=300`, bbl, 2026-10-21 20:34-20:49 UTC, givers logged in before the stand-in, tuned, the stand-in on the relay):

| Run | Givers | Turns given | Craft-to-craft gaps |
|---|---|---|---|
| direct | 3 (h70-h72) | 21/21 | 20 gaps, all 7 |
| direct | 2 (h70, h71) | 20/21 | 17 gaps at 7, 1 at 8; the miss: the stand-in had a Runecraft level-up page open and refused the request ("busy") |
| direct | 2 | 6/6 | 5 gaps, all 7 |
| mixed, same minutes | h70, h72 direct; h71 relay | 20/21: direct 13/13, relay 7/8 | 18 gaps, all 7. The miss: the relay giver's request, offer+accept and confirm reached the gateway within 200 ms of each other, so steps meant for separate ticks landed together |
| mixed | the same | 9/9 | 8 gaps, all 7 |
| relay (control) | 3 | 9/9 | 8 gaps, all 7 |

One more mixed run went 0/21 and is set aside, for a reason outside the givers: every turn, the stand-in (relay) sent its whole half of the turn (request, accept, confirm, craft) to the gateway within one millisecond, and it had level-up pages open. So each giver request found it busy. The next run on the same engine went 9/9.

The latency probe (`speedrun/lab/path-side-by-side.ts`, both paths concurrently in the same minutes, 60 trials each): **relay 58/60 on time, direct 60/60** (direct catch-ups 0/min, tick arrival p90 355 ms).

On loopback the relay is nearly always in time, so the lab shows that the direct path works and is never later than the relay. The comparison that decides it is on the run host. There, rs/141 measured relay 44/60 against direct 53/60 in the same minutes, with tuned two-giver turns on the relay at 11/19.

**Notes are not a load.** A supply trade of 200 rune essence arrives as one noted stack with the essence's name, so restock checks count only the item ids themselves (`NOTE_IDS` in `altar-room.ts`). Before that fix a giver walked into the room with 200 notes it could not hand over.
