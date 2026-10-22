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
| `altar` | `air` | `air` (levels 1-44), `nature` (44-99) or `body` (20-99, the S21 fallback while nature talismans are at 0; banks at Edgeville) |
| `slot` | 0 | 0 east, 1 west, 2 south of the scored tile |
| `essence` | 27 | essence per trade, **exactly by count**: holding at least `essence` counts as loaded, and the offer is one All press only when exactly `essence` is held, else 10/5/1 presses on the highest essence slot in the same tick as the accept (the engine takes from the lowest slot first, and decodes 5 user events a tick), else one Offer-X (a tick late; the stock turn's `give()` uses it). S06 runs 26 (rs/158) |
| `schedule` | follow the cue | `robust` forces the 8-tick schedule for every turn |
| `restock` | `{ kind: 'bank' }` | `{ kind, bank?, acceptFrom?, restockAt?, labStock? }` as above |
| `gapMs` | 0 | wait after a frame arrives before sending (0: send on arrival) |
| `handBack` | none | `[{ item, n }]`, bank restock only: this is the hand-back giver ("The hand-back" below). S21's: `[{"item":"Law rune","n":1},{"item":"Air rune","n":3},{"item":"Earth rune","n":1}]` |
| `cueDir` | `RC_CUE_DIR`, else `run-machine/rc-cue` | the cue directory |
| `scope` | required | `{ step, family: 'altar' }`: the cue this giver serves (`S06` or `S21`; "The cue contract") |

## The cue contract

One directory (`RC_CUE_DIR`, default `<checkout>/run-machine/rc-cue/`, gitignored; both sides refuse a directory git would track). The scored side writes `cue.json`; each giver writes `giver-<account>.json`. Every write replaces the whole file (tmp + rename). Givers watch the directory and also poll every 20 ms. Files rather than a socket mean either side can restart and re-read, and nothing has to be listening first.

**`cue.json`** (written by the scored side; `CueWriter` in `altar-cue.ts`):

    { v: 1, scope: { step, family }, session, seq, receiver: { sha256 }, beacons: [{ tick, ms }, ...],
      schedule: 'tuned' | 'robust', open: 5, turns: [{ giver, T, schedule? }, ...], stop?, final?, ms }

- `scope` says whom the cue is for: one run step (`step`, run.ts's id: 'S06', 'S07', 'S18', 'S21', ...) and one helper family (`family`: 'altar', 'bone' for S07's bone givers, 'courier' for S18's, 'anvil', 'cannon', and 'mule' for the trade giver's top-up packages, which read only a scoped top-up ask, [mule.md](mule.md)). The family list only ever grows: a new family is appended, and nothing existing changes. Every reader role takes the same `scope` option and acts only on a cue that matches it (`cueAddresses` in `altar-cue.ts`), its `stop` included; a cue for another step or family, or one with no scope, is ignored and logged once. So a cue is never a global stop: Runecraft's S06 cue ends with `stop: true`, and the S07 bone givers and the S18 courier reading the same directory don't see it. `CueWriter` takes the scope and refuses a cue without one, and the run writes a fresh cue, with no stop, for each helper step. There is no fallback for a scope-less cue.

- `receiver.sha256` is the sha256 of the scored account's canonical name (lower case, runs of spaces and underscores become `_`). **No file names the scored account.** Givers hash the names of nearby players to find its player index, and check the trade partner the same way. `new CueWriter(dir, receiverName)` does the hashing.
- `beacons` are the scored client's recent frames: its tick count and the wall-clock time (Date.now() scale) the frame arrived. Send several (up to 8). A single beacon is refused if two of the giver's frames sit within 100 ms of it (a catch-up after an overrun); several resolve it by pattern.
- `session` changes on every scored login; `seq` increases on every write.
- `turns` is the session's whole list. A giver acts on the newest turn naming it. T is the tick the scored account's craft lands on, **in the scored client's numbering**. A per-turn `schedule` overrides the cue's.
- `stop: true` cancels any armed turn whose first packet has not gone out. A new `session` cancels it too, and the giver then reads on: the new session's first cue may already name it (a program restart, the stock rung).
- `final: true`, only with `stop`, marks the scope's last session: the step is done with this family. Givers ignore it (any stop stands them down); the launcher's cue gate logs a `stopOn` account out on it, and leaves the account in on a plain stop (HELPERS.md, "The cue gate").
- A turn with `schedule: 'stock'` is the scored side's last fallback, the reacting cycle. The giver trades as soon as the turn is armed, through `lib/trade.ts` `give` (request or answer, offer all, accept, confirm, each on what the frames show), until the judge tick T+K+22. T sets only the judge tick and the lateness rules (`chooseTurn`).

**The stock cycle: 9 ticks** (lab, 300 ms, nature 44, `runecraft-accept.ts --junk-after=3 --junk-clear-stock`, 8 of 8 gaps; each trade 8 ticks from SCORED's first click, the rung's first 5). The scored side writes the turn on the frame its craft lands. Three engine facts set the timing (`OpPlayerHandler`, `trade.rs2` [opplayer4]). A trade click from a delayed player is dropped without a word, so SCORED's request on that frame is lost. Every processed request says something to its sender: "Sending trade offer...", "<name> is busy at the moment.", or the trade opens. And the level-up dialog that opens as the craft's delay ends makes SCORED "busy" to the giver's requests until SCORED's own next click closes it. `openTrade` therefore re-sends a request that drew no answer by the second frame after it; the giver re-sends on every busy refusal. Before that, SCORED re-sent only after 8 s, and the cycle was 31 ticks.

**The clock.** `state.tick` counts the frames one client has received, so the scored account's T means nothing to a giver directly. Both clients get each server frame within a few ms of each other on one machine, so a giver matches the beacons against its own frames' arrival times and learns a constant offset between the two numberings. Each side then fires on its own frame arrivals. The cue only has to arrive early, and no relay hop sits on the reaction path.

**Timing.** A packet group that should land on tick L goes out on the first arrival of the frame for L-1. The giver's half: request lands T+K (K = `open`, 5), offer all and accept T+K+1, confirm T+K+2; robust adds a second confirm on T+K+3. A giver must see its turn by its frame for T+K-2, so a turn written at the scored craft click (T) has 4 ticks to spare. The stand-in writes each next turn at its craft click and never had a late turn. For a session's first trade, use a virtual T whose T+K-1 is at least 3 frames ahead.

**`giver-<account>.json`** (heartbeat every second):

    { v: 1, account, phase: 'start'|'restock'|'travel'|'ready'|'armed'|'fault'|'off', loggedInAt, essence,
      tile, inRoom, readyAt, armed?, last?: { session, T, outcome, myT?, detail?, ms }, gave, detail?, ms }

Pick givers that are `ready` or `armed`, `inRoom`, with a heartbeat under 5 s, standing orthogonally next to the scored tile; oldest `readyAt` first. A client can't see its own player index, so it isn't in the file; giver names are not secret, so look the giver up by name among nearby players. Outcomes: `gave`, `missed` (the schedule ran and the essence is still held), `late` (the turn arrived after its first packet's frame), `clock` (no offset could be resolved), `not-ready` (named while restocking), `no-receiver` (nobody in sight matches the hash), `cancelled` (stop or a new session before the first packet).

**Tuned or robust.** Tuned needs every giver handled before the scored account in each tick, which means logged in before the scored account's current login. `launcher.json` (`helpersReady`, each account's `loggedInAt`) and each giver's own `loggedInAt` (updated when it relogs) tell the scored side. Robust is the safe default; use tuned only for a giver that logged in before the scored login. The stand-in does this per giver with `autoRobust`.

**Relaunch mid-cycle (the skip rule).** After a turn that did not give, the scored side skips that giver until it reports ready *after the turn was named*: its status `readyAt` must be later than the first cue write that carried the turn (`MissBench` in `altar-cue.ts`; the stand-in `altar-receiver.ts` uses the same rule). A live giver renews `readyAt` with every turn result short of a trade, so a slip costs it nothing beyond the failed turn. The renewal happens only while its client delivers ticks (a new tick within the last 5): on the relay path the role outlives a dead client, arms the turns it is named for and fails them on its wall-clock fallback, and renewing then would lift the skip turn after turn. A relaunched giver reports ready from its new process, and a new login makes the scored side forget the tick order it observed in the previous session. A turn that no cue write carried before its first packet's frame benches nobody, since the giver never saw it. So a giver killed mid-cycle costs the schedule the one turn it was named for when it died. Lab (300 ms ticks, nature altar, three givers, one SIGKILLed three times when the cue named it): one missed turn per kill on both the relay and direct paths, none missed by the others; the time away is the launcher's growing restart backoff (about 15, 35 and 70 s).

## The hand-back (S21's end)

SCORED leaves the body room needing T21-22's Lumbridge teleport: 1 law, 3 air and 1 earth rune (SUPPLIES.md H17e). Every essence load fills a giver's pack with its talisman, so no essence giver can carry them, and SCORED enters S21 holding only its talisman so that every load stays 27. So one giver makes a last, **runes-only trip** after its essence trades. That giver is the **hand-back giver**, and its launcher entry carries the `handBack` option.

- **The switch.** At a bank visit where the bank can't make an essence load any more, but holds every hand-back item, the giver withdraws its talisman and exactly those items and no essence (`altar-room.ts` `bankWithdrawals`). Staging sets this up: it banks exactly its essence trades' worth of essence, plus the runes. The rule needs no counter, so a relaunch mid-S21 changes nothing; a relaunched giver that already carries the runes goes straight back in.
- **In the room.** It stands on its slot tile with `phase: 'ready'`, `essence: 0`, and the items under `handBack` in its status. Holding no essence keeps it out of the scored side's essence feed (`giverFeed` takes only givers holding a load).
- **The trade.** After the band's last craft, SCORED names it in a `stock` cue turn carrying `items` (rs/196's `runecraft.ts` `HandBack`, `handBackGiver`). The giver reacts as on any stock turn (request at once, then re-send on each busy refusal) and offers exactly the items, by exact name, through `lib/trade.ts give`. SCORED offers nothing back. The result reads `gave` with the detail `hand-back: 1 Law rune, 3 Air rune, 1 Earth rune`. Afterwards the giver publishes `off` ("hand-back given") and idles until the launcher stops it. It is not counted in `gave`, which counts essence trades.
- **Turn kinds are checked.** A hand-back giver named for an essence turn, or an essence giver named for a turn with `items`, reports `not-ready` with the reason and sends nothing.
- **Which giver.** The roster serves in strict rotation: oldest `readyAt` first, and the ~140-tick round trip is shorter than the 22 × 7 = 154 ticks each giver waits for its turn. So delivery k (counting from 0) goes to roster slot k mod N. The turn after the last of D deliveries falls to slot D mod N, which by then has made floor(D / N) trades (`roster.ts` `handBackSlot`). **S21: 194 deliveries on 22 givers, so slot 18, cairn_t19, after 8 trades** (216 essence). Its runes-only trip starts after delivery 173, about 21 turns (≈140 ticks) before the last craft, so it arrives about as that craft lands. SCORED waits up to `giverWaitTicks` (300) for it. A refused t19 keeps its place in the roster, and its spare becomes the hand-back giver. Missed turns can shift the rotation by a turn or two. That changes only which giver makes the last essence delivery: t19 still stops after its 8 loads, and the three spare loads on t20-t22 cover the shift.

## Rosters and batches

The giver doesn't know which of these it is in. It serves whenever it is ready and named.

- **Air altar (H5 in rs/103's SUPPLIES.md):** 7 givers stand loaded in the room before the scored account's first login and give one trade each.
- **Nature altar (H17): a continuous roster.** The scored account stays logged in. A giver that has traded leaves, restocks and comes back, and the scored side names the next ready giver at each craft click. N givers keep the chain unbroken when N >= ceil(restock round trip / 7) + 1. Givers must not relog during it (a relog puts a giver behind the scored account, and it drops to robust).
- **Batches (the fallback):** N loaded givers, N trades in 7N ticks, then the scored account logs out while they restock. A new login is a new `session`. Armed givers stand down on the session change and are named again in the new session.

When a turn fails, the stand-in stops the cue, declines any open screen, burns what it holds and starts a new chain with a fresh virtual T. The run's step should do the same.

## Roster (S21, body altar)

The body-altar roster is **22 givers** and **23 body talismans**, including the scored account's own. The lab restock round trip via Edgeville bank was 139–142 ticks, so $N = \lceil142/7\rceil + 1 = 22$ (rs/163). The lab supplied essence at the bank with a staff command; a fully stocked real-bank withdrawal still needs confirmation before treating this as a measured demo throughput guarantee.

`speedrun/helpers/roster.ts` generates the roster, direct-path launcher config and a **plan only** for provisioning. It never logs in, moves stock or changes fleet assignments. Use a checkout carrying rs/163's body route and direct-path launcher; older launchers ignore `path` and would measure a different workload.

### Accounts and launch order

Use `cairn_t01` through `cairn_t22` in order. Their credentials are on bbs at `~/rs-fleet/bots/<name>/bot.env`; the first demo login claims the name. A refused primary keeps its place and takes the next unused spare, t23–t27. Record every refusal and substitution. Do not invent names, treat an already-online account as a free spare, or retry a refused login aggressively.

```sh
bun speedrun/helpers/roster.ts config > run-machine/body-roster.json
bun speedrun/helpers/roster.ts config --refused=cairn_t05 > run-machine/body-roster.json
bun speedrun/helpers/roster.ts config --role=idle --gateway-port=7796 > run-machine/load-check.json
bun speedrun/helpers/roster.ts plan --stockpile=/private/path/stockpile.json
```

Every body giver entry has this shape; slots rotate 0, 1, 2 (east, west, south), then repeat. Several givers can share a tile.

```json
{ "account": "cairn_t01", "role": "altar-giver", "path": "direct",
  "options": { "altar": "body", "slot": 0, "essence": 27,
               "restock": { "kind": "bank" }, "scope": { "step": "S21", "family": "altar" } },
  "loginOn": { "step": "S21", "family": "altar" } }
```

On run day the S21 givers log in only when S21's cue opens: each entry also carries `"loginOn": { "step": "S21", "family": "altar" }`. `runecraft.ts`'s pre-login step opens the cue before SCORED's relog and waits for every giver to report ready, so the givers are still handled before SCORED. S21's segment stops leave them in the world for the next session (the robust restart, the stock rung, the hand-back); S21's final stop logs them out. The S06 air givers carry `"stopOn": { "step": "S06", "family": "altar" }` and log out on S06's final stop. A giver's role does not end on a stop by itself: it only cancels an armed turn. The launcher ends the role and logs the account out when the scope closes (HELPERS.md, "The cue gate"). `roster.ts config` adds `loginOn` to every generated giver entry; the `--role=idle` load check logs in at once.

Slot 18's entry (cairn_t19) also carries `"handBack": [{"item":"Law rune","n":1},{"item":"Air rune","n":3},{"item":"Earth rune","n":1}]` (`roster.ts config` adds it). No giver is `receiver` or `final`. All helpers log in **on the chosen scored machine before SCORED**, and share its local cue directory. A lower processing bucket on another machine is not a placement plan: the cue is local, not cross-machine. A giver that relogs after SCORED loses tuned ordering and takes robust turns until SCORED next relogs.

### Run-day provisioning procedure

Obtain rs/41's approval and fresh headroom first, including every donor and recipient. The simultaneous demo total across all hosts must stay at or below 80. Provision at most **five clients at once, donors included**. The planner reserves donor places: with two donors it emits recipient batches of three (seven batches of three, then one), not five recipients plus two donors.

1. Read bbs `~/rs-fleet/forbidden-accounts.txt` and `stockpile.json` read-only. Check all recipients and donors against the current forbidden list; copy that list into the provisioning checkout so the shared validator also enforces it. Never use the scored account. Never modify the fleet checkout, its supervisor or port 7790. Only rs/41 borrows fleet donors.
2. Refresh the plan against that ledger and have rs/41 reserve stock. At 2026-10-22 00:01Z the banks held 57 body talismans: h51 28, h52 15, h53 8, h54 6. Essence banks h30–h33 held 17,643 / 17,468 / 17,895 / 18,004. That snapshot allocates 22 talismans from h51 and 5,346 essence from h33; retain the scored account's separate talisman. These are observed holdings, **not completed transfers**.
3. For each approved batch, use an isolated checkout and gateway outside bbs ports 7790–7799. Complete and verify the tutorial skip (S00, `speedrun/skills/start.ts`); the altar-giver startup also calls `ensureOutOfTutorial`. An idle load check does **not** complete this step. Fresh idle accounts remain on Tutorial Island.
4. Supply each giver with **one real body talisman and 243 essence**, nine loads of 27, except the hand-back giver (cairn_t19, or its spare): **216 essence (eight loads), 1 law, 3 air and 1 earth rune** ("The hand-back"; `roster.ts plan` lists it under `handBack`). Give it no more essence than that: a ninth load would delay its runes-only trip by a whole round. S21's requirement is 5,238 essence; 21 × 243 + 216 gives 5,319 total. Essence may arrive noted, but must be deposited and withdrawn unnoted before serving. Use the giver's bank restock at Edgeville (3094,3491), with `restock.acceptFrom` anchored to the approved donor names during provisioning.
5. rs/41 assigns each donor its own one-shot `handover` list and unique batch id, with `--return` to restore its previous role. Generate each donor's items from the plan: h51 gives talismans and h33 gives essence, so this snapshot needs **two donor trades per giver**, not one fictitious combined-stock donor. The donor walks to the agreed Edgeville meeting tile; the giver accepts supply trades while short of either item (`acceptFrom` listens only while its bank is short, so a giver that logs in loaded never takes one; the lab-verified way to fill banks ahead of time is "Pre-run essence staging" below). Do not resend an `uncertain` handover: inspect the recipient and reconcile the donor's durable role state first.
6. Verify each giver has finished S00, entered the body altar, and published `ready` on its assigned tile with one talisman and 27 unnoted essence. Verify its bank contains the remaining 216 essence (243 total provisioned, 27 carried), and the donor records show delivered. Capture this per-account readiness ledger. Stop the batch with confirmed clean logouts before starting the next; remove temporary credentials after teardown.
7. On run night only, stage mode-600 credentials on the two candidate hosts confirmed by rs/host: **rs-ashburn-run** and **rs-ashburn-rehearsal** (resolve their current addresses from the private host thread; use the canonical `ashburn.sh` private configuration documented by the host owner; never commit a destination address). Coordinate with the twin's owner; do not upload there during an unrelated rehearsal. Gate and select the machine using RUN-HOST.md, then start the full roster on the selected machine before SCORED. Never log the same account into both hosts. Remove unused host copies and remove run-host copies after the run.

Before the run, repeat the actual-bank readiness check with the final launcher and record all 22 accounts' tutorial state, tile, talisman, carried/banked essence, credential destination and clean logout. The load check alone proves none of those provisioning requirements.

### Giver-load check

Use `standalone.ts` with `role: "idle", path: "direct"` when the accounts are not provisioned for a real loop. This exercises one game-stream-decoding process per helper; it is not an altar-throughput test. The launcher's sequential limiter and jittered exponential backoff govern login attempts.

Follow the host's booked window, reservation and leftover check from RUN-HOST.md. Do not start until rs/41 posts the fleet log-down confirmation. Use only the named accounts from an isolated host folder, credentials transferred without passwords in argv and stored mode 600. Start under `exec timeout --kill-after=30s <bound>`, with explicit teardown before the slot end. Use a launcher whose bounded shutdown reaps its detached children; an outer timeout alone does not reap detached process groups in older launchers. Never pattern-kill.

Record login successes/refusals/substitutions, first and last login timestamps, per-account state and reconnect count, full-roster duration, confirmed logout and removal of every copied credential. Post the post-teardown leftover check to rs/host and the roster issue. Host owns the simultaneous tab/recording measurements: pass lines are loop-rate p10 at least 50/s and recording at least 29 fps with zero drops. A 22-client point measures the body givers alone; the 34-client point includes the other co-located helpers. Neither substitutes for the run-night gate.

## Measured

### Idle roster load, 2026-10-22

The run host accepted t01–t22 on the direct path without refusals or substitutions. Launcher start was 00:35:41.170 UTC; first login 00:35:45.240, last 00:38:55.004 (193.834 seconds from launch). All accounts logged in once and remained on Tutorial Island at 3094,3106. This did not skip S00 or provision supplies. Per-account login, heartbeat and logout evidence is in [giver-load-20261022.json](../rehearsals/giver-load-20261022.json).

SIGTERM arrived at 00:52:00.065. Thirteen accounts confirmed server LOGOUT; nine reached the launcher's account-stop deadline and were killed at 00:52:23.067. Several of those nine already had stale state before the signal. All processes and all 27 copied credential files (22 primaries plus five unused spares) were gone by 00:52:54. The nine killed accounts remained listed by the server at 00:54:22 and were absent by 00:56:50. Process cleanup was bounded, but **22 clean logouts were not achieved**. The cause (rs/238): the server removes at most one logging-out player per tick world-wide, so 22 logouts sent at once queue behind each other and behind the rest of the world's, and the nine were still in that queue at the 25 s deadline. The kill hid the outcome; it did not hold them in. The launcher now reports each account's stop as `out`, `queued` or `unconfirmed` (`HELPERS.md`, "Stopping"), and the run-day rule is to stop the givers minutes before they must be gone. On a quiet world the same stop is quick: 34 out, none queued or killed, in 12.5 s on the run host (rs/250), and in the lab (`speedrun/lab/launcher-stop.ts --accounts=22`, local engine at 600 ms) 22 out in 2.0 s; with one client SIGKILLed first, 21 out in 2.0 s and the killed one listed until the server timed it out, its relaunch waiting 295 s for that copy to leave before logging in.

The host-owned tab/recording job did not run, so this check supplies **no gate (d) or recording-fps verdict**. It is not evidence that a scored-style tab passes with the roster present. That simultaneous measurement remains required. The planned 34-client follow-up was deferred by rs/41 at 01:01 UTC because host confirmation and a reservation were absent; no second-slot credentials were transferred and no second launcher started. A replacement slot needs host approval and fresh fleet headroom if it falls outside the original log-down window.


Lab (local engine at `NODE_TICKRATE=300`, the launcher with 3 givers and the stand-in on the build slot, air altar; `speedrun/lab/altar-givers.ts`):

| Variant | Login order | Turns given | Craft-to-craft gaps |
|---|---|---|---|
| tuned | givers before the receiver | 21/21 (two runs) | 20 gaps, all 7 |
| tuned | receiver first | 0/21 | every trade declined |
| robust | receiver first | 21/21 | 20 gaps, all 8 |
| tuned, real restock (portal, Falador east bank, 27 essence, ruins) | givers first | 21/21 in 7 batches of 3 | 14 in-batch gaps, all 7 |

Restock round trip at the air altar via Falador east bank: 91-93 ticks (mean 91.7, n=18).

Body altar (the S21 fallback while nature talismans are at 0), bgsrv-mac, 2026-10-21 23:12Z, `altar-givers.ts --variant=bank --altar=body --cycles=12`: 12/12 tuned turns, all 8 measurable gaps 7. Restock round trip via Edgeville bank: **139-142 ticks** (mean 140.8, n=9), so a continuous body roster needs N = ceil(142 / 7) + 1 = **22 givers** (23 body talismans with the scored account's). As for the air figure, the lab bank is empty and the essence is a staff give at the bank. Through the direct path (`--path=direct`, 3 givers, 23:21Z): 9/9, all gaps 7.

**With real withdrawals** (bgsrv-mac, 2026-10-22 13:24-13:33Z, `altar-givers.ts --variant=realbank --altar=body --cycles=15 --handback`): each giver's bank was seeded once on its first visit (`labSeed`), so every load after that was a real Edgeville withdrawal. 15/15 tuned turns, all 10 measurable gaps 7. Restock round trip **140-143 ticks** (mean 141.3, n = 12), within a tick of the staff-given 139-142, so N = ceil(143 / 7) + 1 = **22** stands (23 only at 148). The hand-back giver (cairn_h73, one load and the Lumbridge runes) traded its one load. Its next bank visit was the runes-only trip ("the essence has run out, taking the hand-back"), 42.0 s from the trade back to `ready` on its tile, about 140 ticks, the same as an essence trip. It came back with `essence: 0` and the runes under `handBack`, and was never named for essence again. With no glory anywhere on the route, these are the body plan's legs. The no-glory nature legs (Ardougne south bank and the Brimhaven ship, about 345 ticks a round trip, so N = 52; rs/163) stay unbuilt in the role while the plan is the body altar.

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

The ashburn slot for this comparison (2026-10-21 22:05-22:12 UTC; h70 direct, h71 relay, h75 stand-in on the relay; tuned):

| Measurement | Relay | Direct |
|---|---|---|
| latency probe, same minutes, 60 trials each | 57/60 on time (h75 through the launcher) | 56/60 (h72, in-process) |
| mixed tuned turns (23 by the receiver's count) | 5/10 | 6/13 |

Both chained gaps were exactly 7. Those minutes were overrun minutes: 9-23 catch-ups per minute and tick arrival p90 446-507 ms (`speedrun/lab/tick-health.ts` via h71). So in that slot the direct path made no measurable difference. The relay was much better than in rs/141's slot (57/60 against 44/60), and both paths lost blind turns to the demo's catch-up bursts. The direct path stays the mechanism for the givers because it is tick-exact in the lab and removes four hops. But it does not rescue the tuned schedule in overrun minutes; that falls to the scored side's fallback rungs (robust, then the stock reacting cycle).

**Notes are not a load.** A supply trade of 200 rune essence arrives as one noted stack with the essence's name, so restock checks count only the item ids themselves (`NOTE_IDS` in `altar-room.ts`). Before that fix a giver walked into the room with 200 notes it could not hand over.

## Pre-run essence staging

A giver's `restock.acceptFrom` listens only while its bank is short, so it can't fill a bank ahead of time. Stage givers' essence before the run instead. Log each giver in under the `mule` role standing at its restock bank (`stand` = that bank's tile, `couriers` = the donor's name). The donor's one-shot `handover` (bank = meet = that bank, `--return`, a fresh `id`) trades the notes, and the mule banks everything it holds, talisman included. The mule's last `bank` line is the giver's total. Log the givers out, then run them as altar-givers, which withdraw from the shared bank. A giver logged in at another bank walks to its restock bank by itself. Never resend an `uncertain` handover. Lab 2026-10-22 (rs/196, 300 ms engine, mission tip d02f405d): 180 each delivered 3 s apart, banks 220 / 180, then 14 s from login to `ready` in the air room. A giver starting at Varrock west walked to Falador east in 46 s.
