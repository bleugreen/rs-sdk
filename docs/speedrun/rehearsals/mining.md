# Mining rehearsal: cairn_rocks (lab acceptance and reprice; no demo login yet)

**Result so far (lab):** from account creation to Mining 99 the module runs **about 4,013
ticks** on the zoo route: 4,001 measured from the kit plus about 12 for the tutorial skip
and kit hand-off (Fishing's demo figures). That is about 49 ticks **slower** than miner3's
3,964 and 247 over the 3,766 planning target, so it does not clear addendum 18's
P(#1) >= 90% gate. No route found in content closes the gap (section 5). Under addendum 18
as amended (19:56 PDT), cairn_rocks would run to 99 as a measurement, not as a record
attempt; no demo login has happened and no slot has been used.

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

- No demo login yet. A measurement run to 99 needs this branch on rs/147's branch and the
  twin (the page must declare `selfStarter`, or knife-mine faults at start), then a slot.
- The live late-starter table, player count and observed respawn per band come from that run.
- The 100-ore knife against plain comparison after the 99 (main's approval) is not done.
