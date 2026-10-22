# Fishing rehearsal: cairn_casts

**Measured result:** Fishing #1 at **3,425 ticks (17m 07s displayed)** on 2026-10-21.
The [ranked table](https://rs-sdk-demo.fly.dev/hiscores?category=11&profile=main)
listed cairn_casts first at 17:29:38 PDT. Its
[player page](https://rs-sdk-demo.fly.dev/hiscores/player/cairn_casts?profile=main)
and the harness agree within one tick. The previous leader, stunfish, has **3,956 exact
ticks**, so the lead is **531 ticks, 13.4%**. The mission brief's 3,953 was a rounded-time
estimate; this result clears both its 3,755 release bar and 95% of the exact rival time.

Labels: **m** measured in retained logs or public rows; **r** read from code; **i** inferred.
The companion [evidence file](fishing-evidence.json) preserves the full demo tick rows,
four lab tick logs, lab launch/incident excerpts, public-page snapshots and provenance.
Annotation rows overlap step rows and must not be added to their totals.

## Rates first: ticks per expected roll

These are **elapsed segment ticks divided by expected rolls for the segment's observed XP
change**, using `expectedRolls` in `speedrun/skills/fishing.ts`. The numerator is measured;
the roll denominator is modeled from the content's catch probabilities, not an observed
count of server RNG rolls. Small samples can therefore depart substantially from the
nominal cadence. Per-catch figures are secondary and depend on level.

| Demo segment (client ticks) | Technique | Ticks / expected roll | Ticks / catch | Elapsed ticks | Catches |
|---|---|---:|---:|---:|---:|
| Net 1–20, 97–334 | Plain | 6.551 | 23.700 | 237 | 10 |
| Fly 20–78, 445–635 | Knife | 2.884 | 6.129 | 190 | 31 |
| Fly 20–78, 645–1,235 | Knife | 3.040 | 4.403 | 590 | 134 |
| Fly 78–97, 1,274–3,060 | Knife | 3.164 | 3.900 | 1,786 | 458 |
| Fly 97–99, 3,060–3,426 | Plain | 4.558 | 5.631 | 366 | 65 |

Fly 20–78 combined is **3.000 ticks/expected roll**, 780 program ticks and 165 catches.
Fly 78–99 combined is **3.338**, 2,152 program ticks and 523 catches (m/model).
The historical full-band plain-fly reference is **5.35 ticks/expected roll** (r,
`PLAIN_TICKS_PER_ROLL`); this attempt's short high-level plain tail is not a matched
whole-band comparison. No new pure-plain 1–99 run was made.

The program's own `result.ticksPerExpectedRoll` is a different estimator: it weights
successful catches by catch probability and excludes some discontinuities. For example,
the 78–97 knife result reads 3.003, whereas the inclusive XP-based segment above reads
3.164. Do not substitute one for the other or compare either with ticks per catch.

## Account, launch and gate

- **Account:** cairn_casts, fresh rehearsal account; no relog or death during the attempt.
- **PDT on October 21:** harness/gate start 17:03:51; first session activity approximately
  17:06:00; Fishing 99 at **17:24:30.789**; page-confirmed logout **17:24:31.220** (m).
  UTC timestamps in the evidence are October 22.
- **Host:** rs-ashburn-rehearsal, xrdp display :10, browser client and on-host recording.
  No attempt ran on the scored-run host or from bbs.
- **Raced hash:** `d2a47238a6`, recorded in the launch output, the auto-rebased
  lab-accepted `8d3ee447`. The page server ran from `~/rs-195`, not the host clone.
  Before login, served `/bot/client.js` contained `followSpot` and `untilXp`
  (one match each); `host-reserved: none` was recorded.
- **Kit:** cairn_mule2 supplied fly fishing rod 1, feather 800, knife 1, logs 5 at
  Lumbridge. The net and food came from the starter kit. Receiver and giver each
  measured 8 ticks for the handoff; receiver wall time was 1,929 ms (m).
- **Players:** 1,678 at gate start, 1,610 during the run, 1,654 after logout (m).
  No refill-sized swing was observed.

Launch (inside the granted two-login slot; both tabs used the attempt's served page):

```sh
bun speedrun/rehearse.ts --skill=fishing --bot=cairn_casts --gate-bot=cairn_twin \
  --kit-from=cairn_mule2 --kit=fly_fishing_rod:1,feather:800,knife:1,logs:5 \
  --skill-opt=spiderGuard=true --log=/home/ubuntu/rs-run/rs195-ticks.log
```

The actual launch used `timeout --kill-after=60s 46m` in tmux; it completed naturally.

| Gate read | On time | Catch-ups/min | Tick interval p90 | Loop p10 |
|---|---:|---:|---:|---:|
| Direct, cairn_twin, before | 60/60 | 0 | 416.8 ms | Not measured |
| In-page, cairn_twin, before | 60/60 | 0 | 417 ms | 72.0/s |
| In-page, cairn_twin, after | 58/60 | 0 | 417 ms | 70.8/s |

All pass the 58/60 floor and catch-up rule; the after read is marginal, not a refusal.
Tick p90 exceeds the 400 ms **report-only** line. Two on-account band-start probes
each returned 20/20, costing 21 and 39 ticks. There was no additional 60-trial
probe on cairn_casts; the 60-trial before/after probes ran on cairn_twin (m).

**Clock correction:** the demo's nominal tick is **300 ms**, not 600 ms. The earlier
slot estimate using 600 ms was wrong. Observed wall time can exceed nominal game time
because ticks overrun; hiscore time is not wall-clock duration.

## Full accounting

| Step | Client ticks | Measured ticks |
|---|---|---:|
| Tutorial skip | 2–6 | 4 |
| Kit receipt | 6–14 | 8 |
| Walk to Draynor | 14–97 | 83 |
| Net 1–20 | 97–334 | 237 |
| Walk to river | 334–424 | 90 |
| Fly 20–78 | 424–1,235 | 811 |
| Fly 78–99 | 1,235–3,426 | 2,191 |
| **Step total** | 2–3,426 | **3,424** |
| Before first step / outside runner | 0–2 | 2 |
| **Session interval** | 0–3,426 | **3,426** |

The first published state was tick 3; tutorial measurement starts at tick 2.
Reach-99 is tick 3,426; Fishing and Overall hiscores both read **3,425**, a difference
of -1 within the harness's two-tick tolerance. Its inclusive session estimator is
3,427 (last in-world tick + 1); that is a separate convention, not a different race.
Logout was clicked at 3,426 and page-confirmed 428 ms later, with zero extra in-world
ticks. Boundaries added no measured waits.

Fly 20–78 = 21 probe + 190 knife + **10 guard** + 590 knife.
Fly 78–99 = 39 probe + 1,786 knife + **366 plain**.
The 77 program level-up handling counts (10 net, 46 first fly band, 21 second)
are included in these elapsed times. Their standalone tick cost was not instrumented;
these counters are not 77 separately chargeable pauses.

## The scored run's S22 band

The manifest prices S22 from **9,612 base XP = 240,300 game XP** at **1,995 ticks**
(expected), 1,969 best, 3,410 plain fallback (r).
This demo's fly-78–99 step started at **241,000 XP**, slightly above the quest-start
threshold because a fish overshot it, and ended at 998,750 XP (m).

Its **2,191 ticks** are **196 above expected (+9.8%)**. This is a real mixed-technique
demo result, not a measured all-knife S22. The high-level knife portion retained
**79.6% gap-3 share** (360 of 452 measured gaps); the lab comparator was 81.6%.
The clean knife cadence therefore survived the demo conditions. Six spot moves,
39 probe ticks and the loss of the log supply are all included in the band's cost.

**Log exhaustion:** at tick 3,060, Fishing 97, the last of the five supplied logs was
gone. Fletching reached 9 on that tick. The module aborted its knife segment with
`kitLost: out of logs at Fishing 97` and explicitly restarted plain until 99.
This was **not a gate switch-off**; the gate history contains no switched entry.
The plain tail cost 366 ticks for 80.291 modeled rolls. Replacing it with a hypothetical
3-tick cadence would save about 125 ticks (i), not an observed improved result.

The content's `process_fletch_logs` queue in
`server/content/scripts/skill_fletching/scripts/cut_logs.rs2` consumes a log and awards
Fletching XP whenever a queued shaft action completes (r). The knife path normally
interrupts that work; this run demonstrates that some completions still occur.
The saved log does not identify which packet ordering caused each completion.

**Supply recommendation:** do not treat one log, or the five-log rehearsal kit, as a
proved sufficient supply. S22's exact-start fresh kit needs its own consumption allowance,
and the run-order owner must price the demonstrated plain fallback until that allowance
is validated. This 1–99 attempt does not establish an exact safe log count for S22.
The 800 feathers covered the attempt; 688 fly catches were recorded.

### Moving spots, not depletion respawns

Fishing spots relocate rather than deplete. `fishing_movement.rs2` delays two ticks
then teleports and schedules another move after `280 + random(250)` ticks (r).
There is no tree/rock depletion-to-respawn D to measure here. The observed
cross-move catch gaps were 21 and 14 in fly 20–78, and 11, 11, 11, 18, 16 in the
high-level knife segment (m); that last segment counted six moves but retained only
five completed cross-move gaps. Subtracting the median catch gap of 3 gives costs
18/11 and 8/8/8/15/13 (i). Do not label these as NPC respawn times.

## Spider guard and lab reconfirmation

`steps({ spiderGuard: true })` opts the fly bands into the guard; default behavior and
the net band are unchanged. On a qualifying damage event with a giant spider close by
at 8 HP or below, or an NPC-attributed hit at 4 HP or below, the program stops and the
guard runs to (3239,3256). It waits for ten hit-free ticks with no matching spider
within six tiles, eats starter food at 4 HP or below, and fights a spider that still
reaches it. The band resumes with the same gate rather than paying a new probe (r).
The normal river spiders cannot pursue to that safe tile from their spawn positions.

**Demo engagement:** tick 635–645, Giant spider, 8 HP to 8 HP, fled, no food, no fight,
then resumed fishing. No other guard engagement was logged (m).

The browser labs ran on **bbs via SSH**, isolated in `~/rs-195-lab`, at
`NODE_TICKRATE=300`, headless browser, not the demo. bgsrv-mac's earlier port collision
was not used as acceptance evidence.

| Retained lab | Measured result |
|---|---|
| `fly78`, 16:14–16:24 PDT | High band 1,973 ticks = 39 probe + 1,934 knife; 3.003 ticks/expected roll, 3.748/catch, 81.6% gap-3 |
| `chain`, 16:15–16:31 PDT | Level 1/default stats to 99: 3,274 ticks = 83 walk + 140 net + 91 walk + 924 fly + 2,036 fly; no guard engagement |
| `guard3`, 15:55–16:04 PDT, earlier successful pass | Natural spider fled in 10 ticks; spawned spider fought/killed in 45; no food |
| `guard4`, 16:33–16:42 PDT, final-hash rerun | Spawned spider fought/killed in **99 ticks**, HP 8→8, no food; resumed to Fishing 94 |

Both guard passes started with default combat stats, spawned three spiders, and observed
combat 5 after the first kill; the later spawned spiders did not attack (m).
The content's cowardly hunt refuses a player above twice the spider's combat level
(2), explaining that immunity (r). A fight is **not a fixed 45-tick charge**:
the final pass cost 99. Eating is unit-tested, but these successful live fights did not
exercise it.

**Correction to the readiness report:** `fly78` began at the level-78 floor,
232,501 XP, then spent 47 ticks reaching 242,001 XP before its 1,973-tick high band.
That is 68.04 base XP above the exact 9,612 base start. The chain's high band started
at 241,000 XP. Thus these reproduce the near-start timing (1,973 vs prior 1,998,
3,274 vs prior 3,338), but **neither is an exact-XP-start reconfirmation**.
The driver deliberately catches up to the threshold and can overshoot by a fish;
an exact-start measurement remains unproven. The earlier report also omitted the
later 99-tick guard result. Both corrections are retained rather than hidden by rounding.

The first guard implementation trusted `damage_taken.sourceIndex` and died in the lab.
The retained final-run excerpt names Fishing spot #2854 while Giant spider #8143 was
the threat. The collector uses the player's facing target, which is not necessarily
the attacker. The accepted guard resolves nearby matching spiders by route tile instead.
The API attribution defect is tracked separately in [rs/220](cairn://p/rs/220);
no SDK/collector behavior was changed here.

## Reaction telemetry: what this run cannot prove

The requested **late reactions/minute binned by catch-ups/minute**, including late
reactions per 100 rolls, cannot be recovered honestly from this run. The harness stores
final program and segment aggregates, not the live `marks.successes` stream or
timestamped starter/bundle deadline misses. Catch gaps not divisible by three are not
a count of late reactions: level dialogs, movement, resynchronization and missed rolls
confound them. The earlier promise to derive the bins from those gaps was incorrect.

Available measured frame aggregates, not per-minute bins:

| Fly segment | Frame catch-ups total | Final reported catch-ups/min | XP-based ticks/expected roll |
|---|---:|---:|---:|
| Knife 445–635 | 0 | 0 | 2.884 |
| Knife 645–1,235 | 0 | 0 | 3.040 |
| Knife 1,274–3,060 | 1 | 0.10 | 3.164 |
| Plain 3,060–3,426 | 1 | 0.52 | 4.558 |

Skipped program ticks and deferred packets were zero in these segments, but that does
**not** prove zero late server reactions. Future measurement needs timestamped intended
and observed action ticks plus aligned frame/catch-up samples; no extra login was made
to fill this optional telemetry gap.

## Recording, release and verification

Recording: `rs195-casts-20261022T000329Z.mkv`, 1920×1080 yuv420p, 1,311.3 seconds,
39,339 frames, 30 fps, **zero dropped frames**, 174,763,855 bytes (m).
It remains on the twin under `~/recordings/` and was copied to the Mac's
`~/Movies/rs-run/`. Recording CPU was **not sampled**; do not borrow a previous
host run's CPU figure. Operator viewing through live.soko.tools was not verified.

Both tabs reported `no tab in game` at 17:25:20 PDT. Recording was finalized before
stopping the stack. At **17:26:10 PDT**, there was no tmux server and no
Chrome/ffmpeg/Bun/timeout/Xvfb process; the inspected attempt worktree and rs-195 slot
were removed. No other worktree was removed. Logs and the cached player page were
preserved outside the worktree first.

The ranked board was still stale at 17:27 but showed cairn_casts first at 17:29:38.
The code defaults to a five-minute, request-triggered ranking cache with background
refresh; player stats are read directly. The live cache override is unknown (r/m).

Focused regression check on the current implementation: **32 fishing tests pass,
149 assertions**. They cover threat attribution, safe retreat, following spiders,
fight/eat behavior, death, opt-in boundaries and log-exhaustion fallback.
Prior development reported 445 tests and both typechecks passing at the accepted hash.
A new reusable project verdict could not be obtained:
`cairn check run test typecheck typecheck:webclient` reports that the current commit
declares **no configured checks**. No build/lint/full-suite green claim is made here.
