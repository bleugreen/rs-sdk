# Runecraft: a solo air-altar row (rs/461, `speedrun/tools/rc-solo.ts`)

A **measurement row, not a record attempt** (addendum 18): one fresh account crafts air runes
alone from level 1 to 99 and runs to 99 whatever its rank. Every row above it on the board is
helper-fed in-room trading (rs/455, [BOARDS.md](BOARDS.md) "Runecraft (solo, walked)" on rs/455's
branch), which this row does not attempt. It shows nothing about the scored run's S06/S21 cycle.
`cairn_binds` is reserved for the post-run helper-fed attempt; this row runs under a name the
operator picks.

**Status: stopped at Runecraft 70 by operator decision** (2026-10-22, 15:28 PDT): the solo row
is not worth the login. It measures nothing the scored run uses (the scored Runecraft is
helper-fed), and a rank-6 row is not worth 3+ hours of a bbs login. It is resumable, since
offline time doesn't count: `cairn_runes` holds the talisman and enough essence to finish (see
"Demo run: stopped at 70").

Figures carry their source: (m) measured, (r) read from code or a public page, (i) inferred.

## The module

`speedrun/tools/rc-solo.ts` is a skill module for `speedrun/rehearse.ts`, kept out of the scored
run's step chain. rehearse.ts does the tutorial skip (S00, `skills/start.ts`) and the clean logout;
the module's steps are:

1. `rc-solo:talisman`. Up the Lumbridge castle stairs, Duke Horacio's "Have you any quests for
   me?" / "Sure, no problem." (Rune Mysteries' start, `duke_horacio.rs2`), answered one page at a
   time and never in bursts, then down again. The air talisman is free and is never banked.
2. Level bands of trips (`rc-solo:air-1-50`, `-50-70`, `-70-80`, `-80-85`, `-85-90`, `-90-93`,
   `-93-96`, `-96-98`, `-98-99`). Each band is logout-safe and level-driven, so a re-run resumes
   from game state. A trip goes: the exit portal, Falador east bank (the runes go in, one load of
   27 comes out), the air ruins, the altar.

The walk is the S06 givers' own. `helpers/altar-room.ts`'s `restock` (bank kind, the air altar's
Falador east bank) and `enterRoom` are imported, not copied; the craft replaces the giver's trade.
Two things are the crafter's own:

- **The portal after a craft.** The craft ends in `p_delay(3)`, delayed through T+4, and a loc
  click sent while delayed is dropped without a message (`skills/runecraft.md` section 4). The
  loop sends the portal click on the frame T+4 of the craft's bind message, so it lands on T+5 and
  closes the level-up dialog that opens on T+4. `act` re-sends it if it draws nothing.
- **The decisions** (`nextAction`, unit-tested in `rc-solo.test.ts`). From any position: at the
  target, done; in the room with essence, craft; outside with a load and the talisman, enter;
  else restock. The load is 27, and on the last trip only what reaches the target (23 for 99).
  The bank's essence is read at each visit, so a bank that can't make the next load **refuses**,
  and the step fails with the count, before any walk. `restock`'s new opt-in `refuseShort`
  (`BankShort`) covers the first visit, where the bank is not yet known. The giver's default,
  wait and retry, is unchanged.

The essence arrives on the first bank visit: a supply trade from `--skill-opt=courier=<regexp>`
on the demo (restock's `acceptFrom`, used on that visit only), or `--skill-opt=labSeed=<n>` noted
essence staff-given into the pack on the lab. From then on every load is one real withdrawal.
Each craft writes a zero-tick `rc-solo:trip` note row (`ticks` from craft to craft, and the legs
`out`, `bank`, `enter`, `craft`) that never counts toward a total.

rehearse.ts now exports the attempt account's `SERVER` into the process when unset. Helper code
decides lab-or-not from it (`isLocalServer`, which gates `labSeed`, `cheat` and `labTele`). The
first lab run had no seed because of this and refused at the bank, which also exercised the
refusal: "bank short: 27 essence missing from the load; the bank holds 0 rune essence", then a
clean logout (m).

## Lab (m)

Local lab engine (`lab.sh`, `NODE_TICKRATE=300`, port block 9670), lite client, a brand-new bot
(`rcsolo2`), 2026-10-22 20:15-20:28Z, on this branch (after main aa3f012c). **Machine
unconfirmed:** the batch was sent to executor bgsrv-mac, but it did not record `uname -n`, and
Cairn has been placing named batches on the wrong executor (rs/147's note, bug filed). The lab log
was in the batch's `$TMPDIR` and is no longer on bgsrv-mac or bgsrv-ub (searched 22:30-22:39Z, each
search with its `uname -n`). Read the 96 below as "a lab engine at 300 ms", not as bgsrv-mac's.
The demo figures below, all recorded with `uname -n`, supersede it.

```sh
WEB_PORT=9670 WEB_MANAGEMENT_PORT=9671 HISCORES_WEB_PORT=9672 NODE_PORT=44070 AGENT_PORT=8370 LAB_RUNNERS=0 LAB_TIMEOUT=3000 \
  speedrun/lab/lab.sh rcsolo2 'speedrun/rehearse.ts:--skill=speedrun/tools/rc-solo.ts:--client=lite:--lab:--to=64:--skill-opt=labSeed=800:--log=<dir>/rcsolo2.jsonl'
```

Runecraft 1 to 64: 26 crafts, chain done, logout confirmed on the last step's end tick.

| Part | Ticks | Notes |
|---|---:|---|
| S00 tutorial skip | 4 | |
| `rc-solo:talisman` | 49 | Duke Horacio's dialogue 11 of them (8 pages, 2 options) |
| First trip: Lumbridge to Falador east bank, the first visit (18 starter items in, the seeded notes in, 27 out), the ruins, the craft | 275 | the walk is 319 tiles (rs/455, r) |
| Trips 2-26 | **96 each, 25 of 25** | legs: out 7, bank 46, enter 40, craft 3 on every trip |
| Session | 2,737 | 3 ticks of login frames outside the runner, 0 per boundary |

**96 ticks a trip, every trip** (n = 25), against the S06 givers' 91-93 (mean 91.7, staff-given
essence, altar-giver.md). The difference is the crafter's own trip (i): the walk from the room's
entry to the altar and the craft (3), and a real withdrawal (rs/455 priced it at about +1). The
portal click was re-sent once on 22 of the 25 trips, yet the `out` leg was 7 on all 25, the same
with and without a re-send. So the re-send cost nothing measurable: a click that lands on T+5,
then a step or two to the portal (i).

## Projection, 1-99 from creation

| Basis | Ticks a trip | Total (i) | Rank on rs/455's board read (19:33Z) |
|---|---:|---:|---|
| Lab as measured: 4 + 49 + 275 + 295 x 96 (+3 login frames) | 96 | **~28,650** | 6 |
| rs/455's bbs pricing: about 8 more a trip for late reactions from bbs on the lite client | ~104 | ~31,000 | 6 |
| Rank-6 line: nickoverall's 32,229 | ~108 | 32,229 | 6 / 7 |
| Rank-7 line: stunbaron's 35,916 | ~120 | 35,916 | 7 / 8 |
| **Demo as measured to 70** (below): 4,542 + 256 x 101 | 101 | **~30,400** | 6 |

The demo adds the courier's trade on the first visit (about 6 ticks, plus any wait for the
courier, which is on the clock). The last trip ends at the 99 craft with no walk back, and the
skill row stamps at that level's tick, so the logout's few ticks don't count. **The demo runs
400 ms ticks since 19:56Z** (rs/147), so ~30,000 ticks is about 3.3-3.5 hours of wall time.
Every wait in the loop counts observed ticks; set `SPEEDRUN_TICK_MS=400` so the idle backstops
match.

## Demo run: stopped at 70 (m)

`cairn_runes`, run from bbs on the lite client through `~/rs-461/run/launch.sh` (the line below,
`src` at 3a5e5f66). Every figure here came from a batch that recorded `uname -n`: the ssh
client was `bbl.local` (executor `local`), and the remote end it reached was `bbs` (Linux
x86_64). The run is `rehearse-runecraft-20261022-215846`, logged in at 21:58:46Z (14:58 PDT).
h30's trade (rs/331), 8,000 noted rune essence, came at 15:02:36 PDT.

| Part | Ticks |
|---|---:|
| S00 tutorial skip | 7 |
| `rc-solo:talisman` (Duke Horacio's dialogue 14 of them) | 44 |
| `rc-solo:air-1-50`, the first trip included | 1,488 |
| `rc-solo:air-50-70` | 3,003 |
| Steps | **4,542** |
| Session (login frames and logout outside the runner: 62) | 4,604 |

- **The hiscore row:** Runecraft 70, rank 1,529, time 30m 17s (read about 22:34Z). 30m 17s is
  4,542 ticks x 0.4 s. The page's time column now uses the demo's 400 ms tick, where rs/455's
  read had it at ticks x 0.3. It matches the log's step total, not the session's 4,604.
  rehearse.ts's own end-of-run hiscore check printed "no row (under level 15)", so its parser
  doesn't read the current page.
- **Trips:** 40 crafts, Runecraft 20 after the first and 70 after the last. The first trip
  took 552 ticks: the 319-tile walk from Lumbridge, the wait at the bank for h30's trade, and
  the first visit.

| Trips after the first | n | Mean | Median | Min | Max |
|---|---:|---:|---:|---:|---:|
| Level band 1-50 | 8 | 101.6 | 103 | 96 | 107 |
| Level band 50-70 | 31 | 100.8 | 99 | 96 | 123 |
| All | 39 | **101.0** | 99 | 96 | 123 |

- **Legs (means):** out 7.2, bank 48.7, enter 41.9, craft 3.2, against the lab's 7 / 46 / 40 / 3.
  The bank and ruins legs carry the difference. bbs on the lite client cost **about 5 ticks a
  trip**, under rs/455's +8 pricing. The portal click was re-sent on 28 of 39 trips; the craft
  click never was.
- **Players** (`/playercount`): 1,368 at the start and 1,335 at the end, with a low of 1,326 and
  a high of 1,479 over 5 reads.
- **The stop:** one SIGINT to the run's own bun process at 22:28:24Z, after a check that its
  command line named `cairn_runes`. The run finished `air-50-70` and logged out at the
  boundary in the air altar's room; it exited 4 (stopped, resumable). `logoutClean` reported
  "NOT confirmed (still in game after timeout)", then the socket closed. At 22:34:47Z
  `lib/demo-status.ts` `listedInWorld` found no `cairn_runes` among 1,352 players on
  `/playerpositions`. The run's gateway session on bbs was closed after that.
- **What the account holds:** the air talisman and the last trip's air runes in the pack, no
  essence (the last trip crafted its full load), and **6,920 rune essence in the bank**. Nothing
  was dropped. 70 to 99 needs 6,908, so a resume finishes without another hand-off.

**To resume** (if ever): rerun `launch.sh` unchanged with the same `--log`. The walk starts from
game state at `rc-solo:air-70-80`, and offline time adds nothing to the hiscore time. It needs its
own gateway on a free loopback port, rs/41's window and count on bbs, and the coordinators' go.
At the measured 101 a trip, it would take about 25,900 ticks (2.9 hours at 400 ms) for a 1-99 of
about 30,400: rank 6.

The credentials file stays under rs/41's store procedure: rs/41/2 copies
`~/rs-461/bots/cairn_runes/bot.env` into the fleet's credential store, and `~/rs-461` is removed
only after that. Done: rs/41/2 copied it to `~/rs-fleet/bots/cairn_runes/bot.env` (700/600, with
`GATEWAY_URL` dropped since the fleet supplies it, and not in `fleet.json`), and `~/rs-461` was
removed at 23:06Z once nothing held it open. A resume restages the folder and its own gateway.

## Demo run: the procedure

Nothing logs into the demo until all of these are in:

- rs/147 sends the operator's name.
- rs/41/2 hands over the essence: 8,000 from h30 (h31 if busy, never h33) at Falador east bank.
  Both the hand-off and this row's one bbs login come after rs/439's cairn_ashes race and the
  fleet's "fleet back".
- The per-IP count on bbs, measured just before the login, is at most 45 with this login in.
- The command below has been dry-run on bbs and its output recorded.
- rs/147 says go, with a start time agreed with rs/41/2.

Check the hiscores show no such player right before the first login. Run from bbs on the lite
client, in an own folder (never the twin, the fleet's folders or its terminals), on main aa3f012c
or later:

```sh
SPEEDRUN_TICK_MS=400 bun speedrun/rehearse.ts --skill=speedrun/tools/rc-solo.ts --client=lite \
  --bot=<name> --skill-opt=courier='^cairn_h30$' --kind=measurement --no-gate-read \
  --log=<folder>/<name>.jsonl
```

**On bbs.** Everything goes through `speedrun/helpers/bbs.sh` from executor `local`, as an ssh
client only: the fleet key, and bbs's host key pinned in `~/.rs-fleet/known_hosts_bbs`, strict.
The working folder is `~/rs-461`:

- `src/` holds a `git archive` of this branch, with `REV` naming its commit, and its own
  `bun install` (root and `server/webclient`).
- `bots/<name>/bot.env` (directory 700, file 600) is created on bbs under rs/41's procedure. The
  password is generated there and never printed, logged, committed or put on a command line. The
  keys are `BOT_USERNAME`, `PASSWORD`, `SERVER=rs-sdk-demo.fly.dev`,
  `GATEWAY_URL=ws://127.0.0.1:<port>`, `TELEMETRY=false` and `SHOW_CHAT=false`. A demo session
  must use a loopback gateway (`lib/session.ts`).
- The run's own gateway runs from `src/server/gateway` with `AGENT_PORT=<port>`. The port is
  outside the fleet's 7790-7799 and checked free at launch.
- `run/` holds the tick log and the output.

Nothing under `~/rs-fleet` is read or written. After the row and a confirmed logout, rs/41/2
copies the bot.env into the fleet's credential store itself; only then is `~/rs-461` removed.

The dry run is the same line with `--dry-run` added. It prints the argv as the shell delivered it,
the parsed arguments, every login in order (here only `<name>`), the gate, and the steps, then exits
0 before any network or login.

### The account and the dry run (2026-10-22)

- The operator named the account **`cairn_runes`**, and rs/147 confirmed it. At 14:37 PDT the
  demo's player page answered "not found" for it.
- rs/41/2 added it to all nine `forbidden-accounts.txt` lists on bbs. A read-only check (exact
  line, counts only) found it once in each.
- `bots/cairn_runes/bot.env` was made with `helpers/accounts.ts` `createAccountEnv`, with the
  password regenerated at 16 characters (rs/41's floor; the engine accepts up to 20). Its keys are
  `BOT_USERNAME`, `PASSWORD`, `SERVER`, `SHOW_CHAT`, `GATEWAY_URL=ws://127.0.0.1:7861` and
  `TELEMETRY=false`. Every reader (`lib/session.ts` `loadBotEnv`, the sdk, `proxy.ts`) looks under
  the repo root's `bots/`, so `src/bots/cairn_runes` is a symlink to `~/rs-461/bots/cairn_runes`.
  `src` is a `git archive` extract, not a checkout.
- The launch line is `~/rs-461/run/launch.sh`. It `cd`s to `src` and `exec`s the line above for
  `cairn_runes`, with the log at `~/rs-461/run/cairn_runes.jsonl` and any extra arguments
  forwarded. The dry run is `launch.sh --dry-run`, so it tests the exact file the run uses.

The dry run on bbs (bash 5.2, `src` at 3a5e5f66) exited 0 and wrote no tick log. Its plan line,
trimmed to the fields that matter:

```
[rehearse] DRY RUN: nothing logged in, no network
[rehearse] logins it would make, in order: cairn_runes (the attempt, lite client)
[rehearse] gate: none (--no-gate-read: no gate account, no direct read)
argv: --skill=speedrun/tools/rc-solo.ts --client=lite --bot=cairn_runes
      --skill-opt=courier=^cairn_h30$ --kind=measurement --no-gate-read
      --log=/home/bleu/rs-461/run/cairn_runes.jsonl --dry-run
world rs-sdk-demo.fly.dev, local false, kind measurement, to 99, tickMs 400
steps: S00 tutorial skip, rc-solo:talisman, air-1-50, 50-70, 70-80, 80-85, 85-90,
       90-93, 93-96, 96-98, 98-99, logoutClean
```

The login waits for rs/41/2's window after about 16:30 PDT, shared with h30's hand-off.
bbs was at 42 clients at 14:50, and rs/383's and rs/443's batches hold the headroom until then.

**The gate: none, by rs/147's ruling.** A gate read measures next-tick reactions, and this row has
no next-tick reaction: each late reaction costs its 2-3 ticks once a trip, as priced. A gate
account would also be a second login against bbs's count, and `cairn_twin` (the harness's default
off a local world) is the twin's account. `--no-gate-read` therefore runs the measurement with no
gate account and no direct read; `/playercount` still has to answer. A `(gate) no read` row in the
log records it.

