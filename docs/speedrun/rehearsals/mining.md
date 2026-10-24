# Mining rehearsal: cairn_rocks (lab acceptance and reprice; demo measurement run to 99 in section 10)

**Result so far (lab):** from account creation to Mining 99 the module runs **about 4,013
ticks** on the zoo route: 4,001 measured from the kit plus about 12 for the tutorial skip
and kit hand-off (Fishing's demo figures). That is about 49 ticks **slower** than miner3's
3,964 and 247 over the 3,766 planning target, so it does not clear addendum 18's
P(#1) >= 90% gate. No route found in content closes the gap (section 5). Under addendum 18
as amended (19:56 PDT), cairn_rocks would run to 99 as a measurement, not as a record
attempt. That demo measurement run has since happened: Mining 99 at **4,322 ticks** of playtime
by the tick log, **4,317** on the hiscore (section 10).

Labels: **m** measured in the lab logs quoted here; **r** read from code or a public page;
**i** inferred. Lab: bgsrv-mac, `NODE_TICKRATE=300`, `tickprog-lab.sh` with this branch's
bundle (after main 23ea9f77, so declared parameters are enforced), default stats (combat 3,
10 hitpoints) unless stated, respawn pinned in content (section 7).

## 1. From-creation total (lab chain, `speedrun/lab/measure-mining.ts chain`)

One chain from level 1 on a fresh lab account, 2026-10-21 19:11-19:31 PDT, the module's
own steps through `runner/step.ts`, kit by `::give` (steel, mithril, adamant, rune pickaxes
beside the starter bronze, knife, 4 logs, 60 coins). The world's iron respawn was **15**
(the module's watcher saw 15 on 1,130 of 1,134 depletions).

| Step | Ticks | Label | Notes |
|---|---:|---|---|
| S00 tutorial skip | ~4 | i | Fishing's demo row (rs/195); the lab skip is off the clock |
| S01 kit hand-off | ~8 | i | Fishing's demo receiver ticks (rs/147 comment 20) |
| `mining.prep` | 1 | m | drops 4 starter items (5 drops land per tick, section 4) |
| `mining.copper` 1-16 | 218 | m | walk Lumbridge to Rimmington 152, then 5 ores in 66 |
| travel: Port Sarim | 30 | m | |
| travel: ship to Karamja | 21 | m | 30 coins |
| travel: Brimhaven | 109 | m | HP 10 -> 8 once at 2853,3185 (an NPC on Karamja), no death |
| travel: ship to Ardougne | 23 | m | customs, 30 coins |
| travel: zoo | 52 | m | |
| `mining.iron-15` 16-63 | 373 | m | gate probe 29; 91 ores, 16 failed rolls, 0 slips; one restart (scheduled respawn 13 < observed 15) |
| `mining.iron-63` 63-99 | 3,174 | m | **1,048 ores in 3,158 program ticks, 3.012 per ore**, 1,044 on the predicted tick, 0 slips |
| **Total** | **~4,013** | m + i | 4,001 measured from the kit |

The skill doc's model (`skills/mining.md` section 2) prices the mining at 3,621 from level 1
with no travel; the bands measure 66 + 373 + 3,174 = 3,613 (m), so the model holds and the
difference is the walks and ships (387 ticks, m), which the model never included.

Because the five-rock knife lap holds 3.00 at both D=13 and D=15 (section 2), this total
stands for any demo minute with about 1,000 or more players online (D <= 15). At D=19
(fewer than about 200 online) the six-rock lap's 3.50 makes the 63-99 band about +520 (i).

Only one from-creation chain has run; addendum 18 asks for five (or a calibrated
simulation) before a P(#1) claim. With a central figure 49 ticks over the #1 time, more runs
cannot change the verdict, so I stopped at one.

## 2. Hold rule, laps and techniques at each respawn (m)

`mine` mode, level 99, rune pickaxe, 300 ms. Ticks per ore (every roll succeeds at 99, so
ticks per ore = ticks per expected roll).

| D | Lap | Technique | Ores | Ticks / ore | Slips | Notes |
|---:|---|---|---:|---:|---:|---|
| 13 | five | knife | 150 | **3.04** | 0 | two 6-tick gaps |
| 13 | five | knife + `selfStarter` | 150 | **3.00** | 0 | knife path unchanged by the option |
| 13 | five | plain + `selfStarter` | 150 / 200 | **3.62 / 3.61** | 0 / 0 | 59 / 79 tricks; the 200 ran on a D=15 world, where this lap is identical (its rocks recur every 18 ticks) |
| 15 | five | knife | 150 | **3.02** | 0 | |
| 15 | six | knife | 150 | **3.00** | 0 | |
| 15 | five | plain (no `selfStarter`) | 100 | 3.99 | 0 | no trick ever qualifies |
| 19 | five | knife | 120 | 4.16 | 0 | a 9-tick wait once a lap |
| 19 | six | knife | 120 | **3.50** | 0 | |
| 19 | six | plain | 100 | 4.17 | 0 | |
| 19 | six | plain + `selfStarter` | 100 | **3.83** | 0 | the lite script's 3.84 |

**Hold rule.** knife-mine holds 3.00 while 3 x rocks >= D: the five-rock lap to D=15, the
six-rock to D=18, as the program's planning rule (`lapModel` in mining.ts) says. That is
looser than the S09 table's "five-rock at D <= 13". Circuit per D: five-rock up to 15, six-rock
from 16 (`rotationFor`).

**Plain 4.00 against 3.61 (rs/158's question): a program rule, not the tiles.** knife-mine's
plain trick refused the next rock itself as the timer starter. The lite script
(`mining-rotation.ts`) allows it, and on the five-rock lap the next rock is the only live
one beside two of the five stands, so plain never tricked (4.00 per ore = 20 ticks a lap).
With the new opt-in `selfStarter` it tricks on those two transitions: 18 ticks a lap,
**3.61-3.62 measured**. No other tiles are needed. mining.ts passes it on every iron band
(inert under the knife).

**The gate's measured window: 120 drops** (`GATE_MEASURE_DROPS` in mining.ts, main's 20:08 ruling
that each knife module passes its own). One gate serves both iron bands. Below 63 an iron roll
can fail (53% at 16), so a stretch's ticks per expected roll carries roll luck; from 63 every
roll succeeds and drops sit on the 3-tick lattice, disturbed only by late starters. Simulated
over the 15-63 band (92 ores, knife 3.00 per roll, 0.38 late starters per 100, plain reference
3.61; i), the switch-off fires on luck alone in 2.6% of bands at 30 drops, 0.4% at 45, 0.1% at
60 and never at 90 or more. A false fire holds plain for 3,000 ticks, about +550 on the 63-99
band at +0.61 per ore. Waiting 120 drops rather than 60 costs about 60 more ores of a genuinely
slow knife (about +15 ticks at 3.8 per ore), and it also rides out a short burst minute's late
starters instead of locking plain for 3,000 ticks. So the window is 120, the shared default.

**Delayed starter on waited transitions** (rs/153's estimate 3.50 -> 3.33 at D=19): not
built. At D=19 the six-rock lap already measures 3.50 and the run's demo minutes are D <= 13,
so it is worth at most ~0.17 per ore on a quiet server only.

## 3. Restarts wait for the live lap

knife-mine faults at start unless every rock of its lap is live (rs/207), and 4 of 5 are
depleted on a running lap. Two places now wait instead of faulting:

- `ironBand` before each `runGatedProgram` call (relog, resume, respawn change): waits for
  every lap rock (up to D + 10). An empty `nearbyLocs` after a relog reads as not live, so
  the wait also covers rs/186's scene-load lag.
- `runGatedProgram`'s new opt-in `beforeRestart` hook, awaited before every start after the
  first (a measured switch, a re-probe's return, a pause/resume). mining.ts passes the same
  wait; knife-cycle callers pass nothing and are unchanged.

Measured (D=13, `mine --gated --plain-per-ore=2.9`, which forces a measured switch-off):
after 30 knife ores at 3.00 the switch to plain found **1 of 5 rocks live and waited 13
ticks** (= D), then plain ran 120 ores with 0 slips. After a 20-tick re-probe at D=13-15
the lap is already live and the wait is 0 (m, 7 of 7 restarts). So: price a switch at +D,
a re-probe's return at +probe only.

## 4. Kit numbers for rs/224

**(a) Logs.** The knife starter burned **no log** in the whole 63-99 band (3,159 knife
ticks, 1,047 starters) or anywhere else: 0 in the chain's 3,493 knife ticks (1,153 starters)
and 0 in 14 `mine` runs with the knife (about 7,000 knife ticks), every run starting and
ending at 4 logs (m). Inferred cause: on every Mining transition the walk or the rock click
closes the fletch on the next tick, before cut_logs makes a shaft; Fishing's 1 per 513
comes from its own cycle. **The kit needs 1 log; 2 keeps a spare.**

**(b) Drops.** A fresh account holds 18 items after the tutorial skip (10 free): bronze
axe, tinderbox, small net, shrimps, bucket, pot, bread, bronze pickaxe, dagger, sword,
wooden shield, shortbow, bronze arrows, air, mind, water, earth and body runes (m). Ten drop
packets sent in one tick went **5 per tick**: dropping N items costs ceil(N/5) ticks
(m, `measure-mining.ts drops`).

With 2 logs the kit is 8 items (4 pickaxes, knife, coins, 2 logs) and fits the 10 free slots
in one hand-off at Lumbridge; even the 4-log kit (10 items) fits exactly. `mining.prep`
then drops starter junk to 4 free slots in 1 tick (m). **No drop before S01 and no second
hand-off is needed.** The bronze pickaxe stays (it never wins the rate table after 6, but
dropping it costs a tick).

## 5. Against miner3 (3,964), and what would close the gap

miner3's player page (r, 2026-10-21 19:5x PDT): Mining 99 at 19m 49s, plus Attack 42,
Strength 40 and Hitpoints 40, no Defence, no quest points. So it took combat xp on the way
(i: aggressive NPCs at its mine, with auto-retaliate) and did no quest.

Our ~4,013 splits into a fixed core and the trip:

- 63-99 is 1,048 ores at a 3.00 floor: about 3,150 wherever it is mined (m).
- 15-63 about 370 and copper about 66 (m).
- Travel to the zoo: 387 (m), the only part that can move.

`mining-rotation-plan.ts --free-starter --run 2` (r, every iron cluster in the maps) gives
3.00 per ore at D=13-15 only at the Ardougne zoo, north of East Ardougne, Rellekka and the
level-31 Wilderness, all far from Lumbridge. Al Kharid, 50 tiles from Lumbridge with copper
and tin beside it, plans 4.35 (its rocks are two groups 7 tiles apart), which is +1,400 on
the 63-99 band. The Dwarven Mine plans 4.76. So no nearer lap exists, and the zoo route
stays ~50 over miner3. To beat 3,964 by a 90% margin the trip would have to cost under about
280, about 110 less than measured. Lumbridge swamp copper saves about 45 (i). Nothing
else found saves the remaining ~65.

## 6. Late-starter rate (lab only)

The demo table rs/158 asked for (per minute, binned by catch-ups per minute) needs the
demo; the lab had 0 catch-ups in every minute, so it has one bin.

| Catch-ups / min | Minutes | Ores | Late starters / 100 ores | Ticks / ore |
|---:|---:|---:|---:|---:|
| 0 (lab, chain 63-99) | 17 | 1,048 | 0.38 (4 counted: predicted-tick misses, each a 6-tick gap) | 3.012 |

Counted per event from knife-mine's `onPredictedTick`, not estimated.

## 7. Lab incidents

- **A pinned respawn needs a repack.** The engine packs content only when
  `server/engine/data/pack/server/script.dat` is missing (`server/engine/src/app.ts`), and the
  pack survives between batches on an executor slot. Editing `player_count.rs2` without
  deleting `script.dat` keeps the old pack. Here the first pin (1,000 players, D=15) stuck
  for the next three batches. Their "D=19" runs were D=15 and their "D=13" knife runs
  slipped once a lap (respawn 13 assumed on a 15 world). Section 2 keeps only runs on a
  verified pack, and every later batch deleted `script.dat` before and after.
  The module's own watcher (`observedRespawn`) caught it, and it is the oracle to check.
- `git checkout` of the pinned file failed on the executor (`index.lock: Operation not
  permitted`); restore it with a copy instead.
- The first chain stopped at the Karamja deck: "no gangplank beside the deck". The ship moves
  the player to another region and its locs arrive some ticks later. Disembark now waits up
  to 15 ticks for the gangplank, and the second chain went through.

## 8. Divergence from rs/158's S09

- Five-rock holds 3.00 to D=15, six-rock to D=18 (the table had five-rock to 13, six to 14-16).
- Plain at D <= 15 is **3.61**, not 4.00, with `selfStarter` (the run's knife-off figure).
- A knife restart costs +D only after a switch that follows mining (measured 13 at D=13).
  After a probe of 20 ticks or more, the lap is live and the restart costs only the start.
- The kit needs 1-2 logs, not 4-5.

## 9. Open

- The demo measurement run to 99 happened (rs/259, on the twin): **4,322 ticks** of playtime by
  the tick log, **4,317** on the hiscore. Its findings are in section 10.
- The live late-starter table, player count and observed respawn per band from that run are in
  section 10.
- The 100-ore knife against plain comparison after the 99 (main's approval) is not done.

## 10. Demo measurement run (rs/259): cairn_rocks, Mining 1-99

**Not a record attempt** (addendum 18 amended): miner3 is 3,964. **Mining 99 at 4,322 ticks of playtime by the tick log, 4,317 on the hiscore** (-5; the gap grows by 1 per session, so it is the relog convention, not lost play). Twin, rs/259's claim, 04:41:55-05:35Z (2026-10-22), from `~/rs-259` at 314989e9, then 3fa6fbe4 from session 4. Five sessions, each ended by a clean logout confirmed by the page (latency 0). Recordings: `~/recordings/rehearsal-cairn_rocks-20261022T044155Z.mkv` (session 1, 96 MB) and `...T045226Z.mkv` (sessions 2-5, 2,513.5 s, 75,406 frames, 0 dropped). Labels: m measured (tick log `cairn_rocks.jsonl`), r read, i inferred.

### Per step (m)

| Step | Ticks | Lab | Notes |
|---|---:|---:|---|
| S00 tutorial skip | 4 | ~4 | ticks 2-6 |
| S01 kit (cairn_mule2, Lumbridge) | 9 | ~8 | 6-15; 8 items in one hand-off, no drop first; giver logged 04:44:07Z |
| mining.prep | 1 | 1 | |
| mining.copper 1-16 | 208 | 218 | 5 ores in 56 (the band row 168-224) |
| travel: Port Sarim / ship / Brimhaven / ship / zoo | 29 / 18 / 107 / 23 / 49 = **226** | 235 | |
| iron 15-63 | 91 ores; program 291 + 30 (10 failed rolls) | 373 | split across sessions 2-3 by contention |
| iron 63-99 | **1,047 ores**: 647 in 1,956 at **3.019**, 337 in 1,025, 63 in 191 | 3,174 (1,048 at 3.012) | |
| **Total to 99** | **4,322** (hiscore 4,317) | ~4,013 | about 335 lost to stops, below |

Sessions (m): 473 (04:44-04:46Z) + 392 (04:54-04:56) + 2,121 (05:00-05:12) + 1,117 (05:21-05:26) + 215 (05:31-05:32). Outside the runner: 7 ticks over 5 sessions (0.44 per boundary).

### The 63-99 band (the run's band) and the late-starter table (m)

- Uncontested knife: **3.019 ticks per ore over 647 ores**, histogram 637 gaps of 3 and 4 of 6, 0 slips. Over the band: 3,172 program ticks for 1,047 ores = 3.03, including the segment starts.
- Gate every start: in-page 20/20 on time (four band starts and re-probes), 0 catch-ups.
- Required table: the tick monitor read **0 glued (catch-up) ticks in every minute** of sessions 2-5 (1 in session 1's second minute), and the knife-mine rows show 0 catch-ups. So there is one bin, as in the lab. knife-mine keeps end-of-run counters, not per-minute ones, so a bad-minute bin would need a per-minute counter in the program (not built).

| Catch-ups / min | Minutes (63-99) | Ores | Late starters / 100 ores | Ticks / ore |
|---:|---:|---:|---:|---:|
| 0 (demo, 1,541-1,744 online) | ~17 | 1,047 | **0.38** (4 predicted-tick misses in 1,046 uncontested ores; plus 1 contention slip) | 3.019 program / 3.03 band |
| 0 (lab) | 17 | 1,048 | 0.38 | 3.012 |

### Respawn D and players per band (m)

| Band | Players (/playercount) | Scheduled D | Observed respawn (watcher histogram) |
|---|---|---:|---|
| iron 15-63 | 1,583-1,688 | 12 | 11 x45, 12 x51; plus 3, 9 and 11-tick gaps in session 1 (foreign miners) |
| iron 63-92 | 1,683 -> 1,534 | 12 -> 13 (restart at T2021) | 11 x484, 12 x165, plus single 2, 5 and 8 |
| iron 92-98 | 1,583-1,709 | 12 | 11 x127, 12 x219 |
| iron 98-99 | 1,731-1,744 | 12 | 11 x59 |

The five-rock lap held 3.00 at every observed D (11-12), as the hold rule says.

### Gate and probes (m)

Direct reads on cairn_twin were all 60/60 on time with 0 catch-ups per minute: 04:42Z (p90 471 ms), 04:52Z (396), 05:19Z (386), 05:30Z (461). Session 3 reused the 04:52 read via `--gate-json`. The 60-trial gate-tab probes were 59/60 at 04:43Z and 59/60 at 04:48Z (loop p10 72.9 and 72.3/s), and were skipped on the resumes (`--gate-probe-trials=0`) to log in inside an empty window. Live frame: PASS on all 5 logins (diff 1.8-2.2 against contrast ~49). Edge iad, TCP connect p50 2.0-2.3 ms.

### Incidents

1. **Contested zoo (S09 run-day risk).** A mining group works the zoo iron. /playerpositions (r): 7-10 on the cluster at 04:46-04:50Z (Methionine, Tau, Ziggurat, Nautilus, Lodestone, Foxglove, Muon, Umbra, Abacus, Numu, Cuttlefish, Petrichor, Mandrake, Zz, Axolotl); empty 04:51:47Z; Tau back 04:55:35Z; 6-7 at 04:58-04:59Z, standing on our stand (2602,3235) and beside (2602,3233/3234); empty 04:59:50-05:00:36Z; back about 05:26Z; clear 05:29:27Z. On the hiscores Tau is Mining 97 and Methionine 99. A second group (Wboson, Zboson, Tesseract...) holds the north Ardougne cluster (2713,3330). Effects: the lap's start check (`not all live after D+10`) refused in session 1; in sessions 2 and 4 a rock went missing mid-lap (no xp on the roll, a slip, a 20-tick re-probe, then a 23-tick wait that failed), and the band stopped with a clean logout. A rock the group mines stayed empty ~55 ticks against D=12. Main has filed the fallback (contested-lap detection and an alternate circuit) as its own child.
2. **A full pack stalled the band at 92 (module defect, fixed in 3fa6fbe4).** knife-mine drops each ore the tick after it lands, so every interruption left an ore behind, and prep keeps only 4 free slots. After the two contention stops and the respawn-change restart (1,534 players: D 12 -> 13 at T2021), 5 ores filled the pack: no xp, three slips, `stalled: no progress for 41 ticks`. A frame of the recording at 05:12Z shows the full pack and no other player. `dropOres` now clears ores before every iron-band start and restart (5 per tick); on the next relog it dropped the 5 on tick 2.
3. **Cost of the stops** (m, from the rows): 23 (session 1 block) + 76 (session 2 from the slip) + 100 (session 3 from the restart) + 69 (session 4 from the slip) + 3 extra re-probes x 20 + 1 drop tick + ~5 relog overhead = **about 335**. **Uncontested, this run would have read about 3,990 from creation** (i), against the lab's 4,013, because copper and travel ran 19 under.
4. **Kit return after 99: the steel pickaxe was lost** (m, rs/296, twin claim 06:52-07:00Z on 2026-10-22). `speedrun/tools/kit-return.ts` logged cairn_rocks in where it had logged out, at the zoo (2603,3234), and walked it by pathfinder toward cairn_mule2 at Lumbridge. At combat 3 and 10 HP it died about 75 ticks into the walk (exit 1, clean logout). It kept its three most valuable items and respawned at (3221,3220), beside the giver. One more login gave the rune, adamant and mithril pickaxes in one 7-tick trade (exit 0), and mule2 banked them (rs/237). The steel pickaxe, the knife, the 60 coins and the logs dropped at the death site and are gone. A return from a far-off logout tile needs a safe route or a home teleport first; rs/147 is fixing the tool before the Ardougne and Wilderness returns.

### Divergence from rs/158's S09 (64-99)

- The 63-99 knife rate on the demo is **3.019 per ore** (the lab's 3.012). The model holds where the lap is uncontested.
- New risks: the lap can be contested by other players (refused start, or mid-band slips), and a restart without `dropOres` can stall on a full pack. Interruptions cost about 70-100 ticks each, mostly in the re-probe and the failed live-lap wait.
- Level-up and logout at 99: the logout click landed on the last step's end tick (latency 0), confirmed by the page in 334 ms. Level-up dialogs cost nothing visible (the program ran continuous 3-tick gaps through every level from 63).

## 11. Contested rocks: the S09 fallback (rs/286, rs/311, rs/340)

Code: `speedrun/skills/mining.ts` (`ContestWatch`, `CONTEST_RETRIES`, `CONTEST_WINDOW`, `MAX_SWITCHES`, `SITES`, `nextSite`, `parseFallback`, `combatGate`); lab driver `speedrun/lab/measure-mining.ts contest`. Labels: m measured (lab), r read, i inferred.

**Default: off.** `fallback: 'none'` (or the option absent) is the zoo-only band main had; contest events are logged in the band row and nothing else changes (pinned by mining.test.ts, 'fallback none, and no fallback, behave as main did'). rs/158's ruling for SCORED: run.ts passes `fallback: 'auto'`.

**Detection (r).** A contest event is either (a) a lap rock seen live and then depleted on a label with no Mining xp of ours within one label of it, or (b) a wait of D+10 ticks that never saw the whole lap live. Our own success depletes the rock and gives its xp on the same tick (mining.rs2), so every depletion of ours pairs with an xp rise. A rock out of view (scene not loaded, after a walk) is forgotten rather than carried, so a depletion first seen after a scene reload isn't paired with the next ore (rs/311's lab false positive at ardougneNorth, fixed in 3e238115 with a test).

**Retries and the switch (r).** With a fallback, each event stops knife-mine and retries in place once the lap is whole again. The third event within `CONTEST_WINDOW` = 600 ticks (`CONTEST_RETRIES` = 2) leaves the site. A retry costs D/2 to D+10, so two retries cost about one walk: a passer-by's one or two ores are waited out, while three in three minutes means someone is mining the lap. `dropOres` runs before the new site's first lap, as before every start. After `MAX_SWITCHES` = 2 the band fails (clean logout).

**Site choice and combat (r).** `nextSite` prefers a site not contested in the last 600 ticks, then the nearest. Under `'auto'` or a named list a site is allowed only at combat >= its `safeFrom`: ardougneNorth 43 (brown bears, combat 21, cowardly: they attack combat <= 42 outside the Wilderness), Rellekka 129 (wolf 64, black unicorns 27 on the walks), wilderness31 never (hobgoblins attack anyone there, and so may players). At combat 43 (SCORED at Prayer 94) `'auto'` means ardougneNorth or nothing. Below every allowed site's `safeFrom` the fallback is unavailable, and that never stops the band (main's ruling, 17:53 PDT 2026-10-22, to rs/186): the zoo is safe from combat 0 (`SITES.zoo.safeFrom` 0), so a lower combat only risks whether the fallback is available and needs no extra training. An iron band at the zoo therefore always starts. With no safe site it logs one line naming the `safeFrom` values (`fallback unavailable at combat 3: no site it may use is safe (ardougneNorth needs 43, rellekka 129, wilderness31 never); mining the zoo through any contest`). Contested, it mines the zoo laps as the zoo-only band does. Each event is logged, nothing stops knife-mine, it never walks, and it never fails on the event count. The one difference from `'none'` is that a lap not whole after D+10 is logged as an event and waited out rather than failing the band. The cost is the no-fallback row below (rs/340 C, +849). A named list follows the same rule, so `['rellekka']` at 42 starts at the zoo with the fallback unavailable. If combat rises mid-band so a site becomes safe, the fallback becomes available and the next events count toward the switch as usual. `acceptHazards: true` allows every listed site whatever the combat, for rehearsals (the lab driver's `--acceptHazards=true`). With `'none'` or no fallback none of this applies. Mid-band `nextSite` never switches into a site unsafe at the current combat unless `acceptHazards`, so a named `['ardougneNorth','rellekka']` at 43 skips rellekka and goes back to the zoo. A band resumed at a fallback site keeps rs/158's start gate (`combatGate`). It refuses if no site the fallback may use is safe at its combat (`combat 42: no site the contested-rock fallback may use is safe (ardougneNorth needs 43)`), unless `acceptHazards`. The `safeFrom` values rest on content (r), not an observed attack (m): in five lab runs SCORED at combat 43 took 0 damage at ardougneNorth (a bear came within 2 tiles for 2 ticks once). rs/311's combat-3 helper on an ardougneNorth stand for 400 ticks wasn't attacked either (nearest bear 4 tiles), so the lab hasn't shown the bears attacking at all. ardougneNorth's five-rock lap holds 3.00 at D 13-15 (lapModel) and 3.6-4.2 at 16-19 (no six-rock lap).

**Measured (m).** Lab on bgsrv-mac, 300 ms, browser client, D pinned in `player_count.rs2`. SCORED at S09 combat (Prayer 94, Magic 59, HP 10: 43), Mining 95 to 99, knife, rune pickaxe. After 90 uncontested ores at the zoo, a tick-perfect combat-3 rival mines the lap's first rock (2605,3235) from beside it on every respawn: it primes its clock on a spare rock and lands its click on R + D. 'Before' means the rival was logged in first (tickprog-lab.sh `GIVERS=<helper>`, `contest --attach=1`), so the server handles it first. 'After' means it was launched after SCORED. Cost is the band's ticks against 832, the same 277 ores uncontested (rs/311's D=15 run, where the rival took none).

| Run | D | Rival | fallback | Rival ores | Leave after 1st take | Walk | 1st ore after deciding | ardougneNorth | Band | Cost |
|---|---:|---|---|---:|---:|---:|---:|---|---:|---:|
| rs/311 (x3, identical) | 13 | after | auto | 3 of 4 clicks | 29 | 74 | 78 | 182 at 3.017 | 939 | **+107** |
| rs/311 | 15 | after | auto | 0 of 38 | none | | | | 832 | 0 |
| rs/340 A | 15 | before | auto | 3 of 3 | 32 | 74 | 78 | 187 at 3.000 | 942 | **+110** |
| rs/340 D | 15 | before | auto | 3 of 4 | 32 | 74 | 78 | 182 at 3.017 | 945 | **+113** |
| rs/340 B | 15 | before | none | 27 (its pack filled) | | | | | 1,090 | +258 |
| rs/340 C | 15 | before | none | 94 (drops each ore) | | | | | 1,681 | **+849** |

- **D=13:** the rival lands on R+13, 2 ticks before the knife lap's R+15, so it wins whatever the player order.
- **D=15:** both land on R+15, and **the server's player order decides every tie**: 0 of 38 with the rival handled after SCORED, and 3 of 3 / 3 of 4 with it handled first. The demo's order between SCORED and a rival is whatever login order gives (i), so price D=15 like D=13.
- **The switch** repeats to the tick: it leaves 29-32 ticks after the rival's first take, walks 74 ticks (107 tiles), and mines again 78 ticks after deciding. ardougneNorth then holds 3.00-3.017 with 0 slips. **About +110 per switch** (m, n=5 at D=13 and 15).
- **Without the fallback, a contested lap costs about +9 ticks per ore the rival takes** (C: 849 / 94; B: 258 / 27). About every second take lands a 21-tick slip on SCORED (47 slips in C, 14 in B), so SCORED's contested ores come at **7.48 ticks per ore** against 3.00. At D=15 the band survived because knife-mine kept running through the slips. Any restart under contention meets the start check (lap not whole after D+10) and fails the band, as rs/311 recorded at D=13.
- **Scale (i):** a rival on one lap rock for all of S09's ~1,047 ores (section 10) would cost about +4,700 without the fallback, against about +110 with it. Section 10's real group (7-10 players on the cluster) is the worse case.

**Open.** SCORED's combat at S09 (43 needed for `'auto'` to have a site; below it the band mines the zoo with the fallback unavailable; rs/158). The lab rival is one account on one rock; a group on several rocks trips the switch sooner (three events arrive faster) and hasn't been measured. ardougneNorth has its own group (section 10, incident 1), and a second contested site fails the band after `MAX_SWITCHES`.

## 12. Bones on the `stay2` lap: H4m (rs/701)

Attempt 4's H4m variant (main, 10-24 04:5xZ) closes S07 below Prayer 99. The run config's `s07PrayerTo` is 98, and S09 buries the rest: babydragon bones (main's ruling, 06:5xZ) from H4m's carrier (cairn_h55), 20 at a time. `knife-mine`'s `bury` on the `stay2` lap (#159, rs/182) costs the lap at most +0.021 ticks an ore, against 1-3.9 ticks a bone anywhere else. This section covers the step side. The lab is still to come.

**The module (`mining.ts` `bury`, `buryLoads`, `buryPrayerTo`).** `bury` adds one step per load, `mining.bury: load k`, between the iron bands. Each step works like this:

1. With bones held, Prayer below `buryPrayerTo` and Mining below `to`, it runs the band on `BURY_LAP` with knife-mine's `bury`. The band stops on the frame that shows the last bone gone, so the next load's trade follows at once.
2. Whatever the lap could not bury, it buries by hand with prayer.ts `buryHeld` (rs/700's one bury primitive, 2 ticks a bone). This covers Mining reaching `to` mid-load, iron respawning over 13 ticks (the stays take no bone), and a contested lap the fallback would leave. With the fallback unavailable at this combat (section 11) a contest leaves the lap burying, as the zoo-only band mines through it. The band never walks to another site with bones held, because the next load is traded at the zoo.
3. It drops anything held once Prayer is at `buryPrayerTo`.
4. With no bones held it is a 0-tick pass.

The lap is not in `ROTATIONS`, so respawn never chooses it. While a bury step owes bones, the iron band neither starts nor reads as in progress, so a resume enters the bury step. The exit drops bones a resume walked past. `bury: true` means any bones (`bones$`, as S07's reader); the run passes its row's own bone.

**Slots.** At S09 SCORED holds the knife, 2 logs and the pickaxe, so 24 free. A load is at most 24 - FREE_SLOTS = 20, taken with **no** bone held. A load taken with 1 held leaves 3 free, and the band refuses.

**The chain (`runner/chain.ts` `h4mPlan`, `s09WithH4m`).**

- **The switch.** `s07PrayerTo` below 99 turns H4m on. At 99 (or absent) the chain is today's, step for step.
- **The loads.** These are the carrier generator's: `h4mLoadRows` over STEP-MANIFEST's fallback row `H4m.1-H4m.N`, so N has one source. The chain refuses whenever the run config and the ledger disagree: P below 99 with no row, or P = 99 with one.
- **The bone.** It comes from the row's id through one table, `H4M_BONES`: prayer.ts's BONE_TYPES (dragon @536 72 base, babydragon @534 30) and big bones @532 15. The table sets the guard's price and the bury steps' pattern. Any other bone, a noted load, or a top-up refuses.
- **The other refusals.** P below 94 (S09's combat 43). Loads whose `N x 20 x base` falls short of P's floor to 99: S07 closes the first time Prayer reaches P, so possibly at the floor. The by-hand stop buries only what was traded, so it adds nothing to the guard. At P = 98 the need is 2,675.32 base: 5 babydragon loads (3,000) clear it and 4 (2,400) refuse; in big bones 9 loads (2,700) clear it and 8 refuse. P = 97 needs 173 babydragon. Also a missing hand-off record.
- **S09's shape.** H4p, then for each load its hand-off H4m.k and its bury step, then the band to 99 and the exit.
- **Each H4m.k hand-off.** It is its own delivery row (a carrier serves a session once), cue-served. Its precondition is room for 20, not the carrier in view, because the {H4m.k, mule} cue's open waits on the carrier's readiness. SCORED walks onto the east stay (2605,3234), the one tile beside the carrier's stand (2606,3234; rs/705's reach check), then sends the request itself.
- **Resume.** A bury step is done once the next load is recorded (the last one once its own load is recorded and nothing is held), or at Prayer 99, which also supersedes the loads left.
- **The postcondition.** The last bury step carries the chain's Prayer 99, read from the level, not the points.

**The fallback stop.** The bury steps are the fallback stop: at the zoo, before T09-10, with the carrier still standing there. Any load traded after Mining 99 is buried by hand there, so Prayer 99 is reached before S10b's first protect fight. Points track the level when unused (Player.ts addXp), so S10b B's 75 is met at 98 or 99.

**Price (i, rs/158 fold-in 42).** About 15 ticks a load (knife stop ~5, trade ~8, restart ~2, the restart waiting for the lap to be live, rs/207), so about +75 for the band with 5 loads.
