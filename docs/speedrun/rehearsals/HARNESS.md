# Rehearsal harness: `speedrun/rehearse.ts`

The per-skill fastest-99 rehearsals (cairn://p/rs/147) all run through one harness: the gate
snapshot, a fresh account's tutorial skip (`speedrun/skills/start.ts`, S00), the kit receive,
one skill module's steps, a clean logout at the target level, and the tick log against the public
hiscore row. How it works and its flags are in `speedrun/README.md`, sections "skills/start.ts"
and "rehearse.ts". This page holds the measured results and the command lines a skill child runs.

## Lab acceptance (measured, 2026-10-21)

Local lab engine (`speedrun/lab/lab.sh`, `NODE_TICKRATE=300`, port block 9650), executor
bgsrv-mac (macOS arm64), lite client, a brand-new bot each run (`LAB_RUNNERS=0`, so the harness
launches the client itself and the session row starts at the login). Source: the tick logs of the
runs below; one sample each.

| Run | S00 | Steps | Boundary rows | Session | Overhead (session minus steps) |
|---|---|---|---|---|---|
| A: S00, chop stub to Woodcutting 15, logout | **3** | 68 | 0 ticks over 3 | 71 | 3 = 1.0 per boundary |
| B1: S00, idle part 1 of 3, SIGINT during it | **3** | 23 | 0 over 3 | 26 | 3 = 1.0 per boundary |
| B2: B's re-run with `--from=2`, parts 2 and 3 | - | 40 | 0 over 3 | 42 | 2 = 0.67 per boundary |
| Earlier: S00, `::give` kit (1 tick), chop stub, gate read by a second bot | **3** | 44 | 0 over 3 | 47 | 3 = 1.0 per boundary |
| C: S00, idle 1 tick, logout (rs/164, after the logout fix below) | **3** | 4 | 0 over 3 | 7 | 3 = 1.0 per boundary |

- **S00: 3 ticks, against the bar of 7.** The question page shows 1 tick after the pipelined
  design accept and talk, the choice page 1 tick after the continue, and Lumbridge with the 18
  starter items 1 tick after "Yes please." (the stock `bot.skipTutorial()` measured 6).
- **Boundaries: 0 ticks in every runner boundary row.** The whole overhead is 2-3 ticks of
  login frames the client counts before `openSession` sees an advancing state. The logout click
  lands on the last step's end tick (`logoutClean` latency 0). That meets "at most 1 tick per
  boundary".
- **A logout in the first 16 ticks no longer waits (run C, rs/164).** `logoutClean` used to read
  `lastDamageTick = -1` ("never damaged", `sdk/types.ts`) as a hit on tick -1. So a logout before
  tick 16 waited out a post-combat window first: rs/150's lab runs showed the click on tick 23
  instead of 6, twice. A negative `lastDamageTick` now means never. In run C, S00 ended on tick 6,
  the 1-tick stub on 7, and the click landed on tick 7 (logout latency 0), one tick after S00's
  end. A real hit within 16 ticks still waits (`session.test.ts`).
- **SIGINT mid-step:** sent 2 s into idle part 1, it logged out at the boundary after part 1, with
  the click on that part's end tick (26). The run exited 4, and the re-run resumed at part 2.
- **Direct gate read on the lab** (second bot, rs/96's CLI): 60/60 on time, tick p90 302 ms, 0
  catch-ups. The vantage check is not applicable to a local engine.
- **Not covered on the lab:** the hiscore comparison (the lab engine serves no hiscore page on
  its port, so the harness skips it), the browser client, the gate tab's in-page probes, and the
  kit trade from a giver (`receiveFrom` is measured in `speedrun/README.md`, "trade.ts"). These are
  for the demo run below.

## Demo acceptance (open)

Waiting on the rehearsal host (rs/149), token login on this branch (rs/138, main 96fc462a), and
a slot for the throwaway `cairn_smoke` (granted by rs/147). Pass: S00 at most 11 ticks, and the
hiscore playtime within 2 ticks of the session row. The plan: `cairn_smoke` through the browser
tab, S00, then `--skill=speedrun/runner/stub.ts --skill-opt=idle=50`. No level is gained, so
Overall is the logout playtime, which the session row predicts as its last tick + 1.

## The command a skill child runs on the host

On the rehearsal host, as RUN-HOST.md prescribes ("Rules for every launch": `exec timeout` as the
whole command of its own tmux session, logs by redirection). The ssh line, key and IP are in
`docs/speedrun/rehearsals/HOST.md` (rs/149). The page server, gateway and Chrome (with
`--remote-debugging-port`) must be up first (RUN-HOST.md step 3). The account's
`~/rs-sdk/bots/<ACCOUNT>/bot.env` (mode 600) needs `CLIENT_URL` (the proxy.ts page) and `CDP_URL`,
and the gate account `cairn_twin`'s needs the same. Off a local world the harness uses
`cairn_twin` when no `--gate-bot` is given; the command below names it anyway.
`cairn_gate` is rs/149's personal gate account, and the harness never uses it. Before launching: the slot (`~/rehearsal-slots/`) and the
leftover check.

```sh
# B: the bound, expected wall time x 1.5 (a 99 is about 1-3 h); ACCOUNT: the name rs/147 assigned.
B=4h; ACCOUNT=<account>; mkdir -p ~/rs-run
tmux -L rehearsal new-session -d -s "$ACCOUNT" \
  "cd ~/rs-sdk && exec timeout --kill-after=30s $B ~/.bun/bin/bun speedrun/rehearse.ts \
     --skill=<skill> --bot=$ACCOUNT --gate-bot=cairn_twin \
     --kit-from=<giver> --kit=<item:n,...> \
     --log=$HOME/rs-run/$ACCOUNT.jsonl >>$HOME/rs-run/$ACCOUNT.log 2>&1"
```

- At the bound, `timeout` sends SIGTERM and the harness logs out at once before it exits; the
  30 s kill-after covers the click. `tmux -L rehearsal kill-session -t $ACCOUNT` does the same.
- To stop at the next band boundary instead: `tmux -L rehearsal send-keys -t $ACCOUNT C-c`. A
  second C-c logs out at once.
- Exit 3 means the gate refused: nothing was logged in for the attempt. Wait and run again.
  Exit 4 means stopped or paused: run the same command again, with the same `--log`, and it resumes
  from game state.
- `/playercount` goes into the log every 10 minutes as a `(players)` row. The summary prints the
  count's range, plus a `MOVED` line if it swung by more than half (a demo restart and refill).
- Watch with `tail -f ~/rs-run/$ACCOUNT.log`; afterwards `bun speedrun/lib/ticks.ts report
  ~/rs-run/$ACCOUNT.jsonl`.

The lab form, for a dry run of a skill module (no browser, no gate tab, staff kit):

```sh
LAB_RUNNERS=0 speedrun/lab/lab.sh <fresh bot> \
  'speedrun/rehearse.ts:--skill=<skill>:--client=lite:--lab:--to=<level>:--kit=<item=n,...>'
```
