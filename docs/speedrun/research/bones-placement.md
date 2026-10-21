# Where the dragon bones outside the stuns go

Question (cairn://p/rs/105, for RUN-ORDER open item O5): Prayer 1-99 is 555 dragon bones. 11 go
early (S10a, Prayer 43 before Tree Gnome Village) and about 196 ride the pickpocket stuns (S18b,
`skills/interleaving.md` section 8; cairn://p/rs/106 measures that pack). Where should the other
~348 go once the run uses the knife loops for Woodcutting, Fishing and Mining, which were
believed to leave no free tick for a bury? Plain 4-tick Woodcutting, Mining's respawn waits, fly
fishing, or the bank booth, net of the top-up trades?

**Answer: inside the knife Woodcutting loop itself.** A bury fits the 3-tick knife cycle at no
cost to the cycle, contrary to `interleaving.md` sections 3 and 7, if the re-click moves from
the tick after the roll to the tick of the next roll (section 2). With real top-up trades from
a helper standing at the tree, knife Woodcutting with a bury every cycle absorbs **0.30 bones
per tick** for **0.23 Woodcutting ticks per bone** (measured, oak, 2 x 600 ticks, 357 bones),
almost all of it the trades. That is against **2.07** ticks per bone at a booth, so each bone
saves about 1.84 ticks, double what plain 4-tick Woodcutting saves (0.9). S07 runs before
S10a and has ~3,460 knife ticks, of which **~1,200 absorb all 359 non-stun bones**, the 11
early ones included. The booth step S25b and S10a's burying disappear, and Prayer's tally line
falls from **742 / 583 to about 110 / 80** (expected / best, knife on; section 6).

Fly fishing and Mining are poorer hosts. Fly fishing cannot take a bury in the knife loop at all
(the lock breaks), and a 5-tick fly cycle with a bury costs as much as the booth. The planned
Mining lap has no respawn-wait ticks at the demo's respawn of 13 (measured), and a bury on a
move costs +2 ticks. A reordered lap with one "stay" transition takes one free bone per 15
ticks (measured), about 200 bones over Mining 64-99, which makes it a usable reserve host
but not a better one.

Labels follow `skills/README.md`: measured (m), read (r), inferred (i), estimated (e). Every
measurement was taken on the local lab engine at `NODE_TICKRATE=300`, on the fedora executor
(host `bginf-halo`, load 1-4), driving the headless lite client. Every run began with a
`tickmanip-latency.ts` probe: 60 of 60 packets landed on the next tick, in all five batches.

## 1. Per-host table

Standalone reference: **2.07 ticks per bone** at a bank booth, 58 ticks per 28-bone inventory
including the bank visit (r, `skills/prayer.md` section 1; the measured run averaged 2.20 with
stalls). "Host ticks lost per bone" is the host's base xp lost against its own knife figure,
converted to host ticks at the knife rate and divided by the bones buried. It includes the
trades, level-ups and any lost locks. "Saved per bone" is 2.07 minus that cost.

| Host loop | Bones per tick | Host base xp per tick (against its knife figure) | Trade cost per bone | Host ticks lost per bone | Saved per bone against the booth | Basis |
|---|---|---|---|---|---|---|
| **Knife Woodcutting + bury, oak, WC 60** (`knifebury`) | **0.298** m | 10.97 against 11.78 (-6.9%) m | 5 ticks per 23-bone load = **0.22** m (14 of 14 trades in 4 ticks, roll gap 8 instead of 3) | **0.23** m | **1.84** | `bones-wc.ts`, 2 x 600 ticks each mode (m1, m2), 357 bones |
| Knife Woodcutting + bury, willow, WC 88 | 0.294 m | 12.79 against 13.31 (-3.9%) m; willow's roll luck is about ±3.5% per 600 ticks, so the xp figure is noisy | 19 of 22 trades took 4 ticks (5 lost each), 3 took 30 (a level-up page made the helper's request bounce, section 3): 0.36 per bone i, 0.22 without the bounces | 0.13 m (xp, noisy); **0.36** i (from the trade gaps) | 1.7-1.9 | `bones-wc.ts`, 600 + 1,200 ticks each mode, 530 bones |
| Plain 4-tick Woodcutting + bury, oak | 0.230 m | 8.63 against knife 11.78 (-26.8%); against plain 8.88 (-2.8%) m | 5 ticks per 25-bone load (roll gap 9 instead of 4) m | **1.17** against knife; 0.12 against plain m | 0.90 against knife | `bones-wc.ts`, 600 ticks each mode, 138 bones |
| Plain 4-tick Woodcutting + bury, willow | 0.238 m | 9.56 against knife 13.31 (-28.2%) m | as oak m | 1.18 against knife m | 0.89 | 600 ticks, 143 bones |
| Knife fly fishing + bury in the bundle, Fishing 70 | 0.320 m | **0.48** against 14.03: the lock breaks (3 catches in 400 ticks) m | - | unusable | - | `bones-fly.ts --mode=knifebury`, 400 ticks |
| Fly fishing, 5-tick cycle with a bury (`bury5`) | 0.200 m | 8.30 against 14.03 (-40.8%) m | not run; 0.22 i (as Woodcutting) | 2.04 m + 0.22 i | **-0.2** (a loss) | `bones-fly.ts --mode=bury5`, 400 ticks, 80 bones |
| Knife Mining, demo lap (mining.md section 4): respawn waits | none: 0 wait ticks m | 11.67 (3.000 ticks per ore, 194 of 194 gaps at 3) m | - | - | - | `bones-mine.ts --rot=demo --bury=none`, 2 x 200 ores |
| Knife Mining, demo lap, a bury on every move | 0.154 m | 4.03 against 11.67 m: 5-tick transitions (+2 per bone) on 1-2 tile moves; the 3-tile move never rolled (65 of 65) | - | **2.0** on the moves that work m | 0 or worse | `bones-mine.ts --rot=demo --bury=all`, 200 ores x 2 runs |
| **Knife Mining, `stay2` lap, a bury on its short-entry stay** | **0.066** m | 11.47 against 11.67: 3.052 ticks per ore, 193 of 194 gaps at 3; the one slip was on the other stay, which carries no bone (section 4) m | 5 ticks per 24-bone load = 0.21 i | **0** on the bone's own transition m; at most 0.26 with the slip charged to it | ~1.8-2.07 | `bones-mine.ts --rot=stay2 --bury=short`, 200 ores, 40 bones; no-bone control 3.000 over 80 ores (m5) |

## 2. Why a bury fits the knife Woodcutting loop (read, then measured)

The knife loop (tick-manipulation.md section 5) sends, on the label of each roll R, `[knife on
logs, button 8889, drop, click]`. The knife writes `%action_delay = R+3` (`cut_logs.rs2:83-85`),
the click arrives on R+1, its first-click label finds the clock 2 ahead and continues, and the
continuation rolls on R+3. `interleaving.md` concluded that a bury has no room, because a bury's
`p_delay(0)` rejects every packet on the tick after it lands.

The bury does not need room if the click moves. `bones-wc.ts --mode=knifebury` sends `[knife on
logs, button 8889, drop, bury]` on R and only `[click]` on R+2:

- R+1: the knife writes R+3 first. Then the bury runs `p_stopaction` (clears the interaction,
  closes the fletching menu and with it the queued fletch, `Player.ts` closeModal) and
  `p_delay(0)`.
- R+2: every packet is rejected (`OpHeldHandler`, `MoveClickHandler`: delayed), but none is
  sent for R+2. The bone is deleted and the xp given (`bury_bone.rs2`).
- R+3: the click lands. Its first-click label finds `%action_delay = map_clock` and rolls at
  once (`woodcut.rs2:97-98`).

The roll keeps the 3-tick lattice, with 4 user events on R and 1 on R+2, the same budget as the
plain knife loop. The click on R+3 also closes a level-up page (OpLocHandler's
`clearPendingAction`), so Woodcutting and Prayer level-ups cost no roll: the oak runs had 57
level-ups each (40 of them Prayer) and kept 161 of 164 roll gaps at 3 ticks between trades.
The 0.23 ticks per bone is the trades (5 x 7 = 35 ticks per 600) plus three lost cycles.

**Fishing has no such branch.** `attempt_fish_trout_salmon` does not roll when the clock equals
`map_clock`; it hands over to `fish_trout_salmon`, which re-arms +4 (`freshfish.rs2:37-52`).
The knifebury bundle therefore breaks the fly lock (measured: 3 catches in 400 ticks). The best
fly cycle with a bone is `bury5`: `[drop, bury]` on R, `[knife, button, click]` on R+2, rolling
on R+5. That is 0.200 bones per tick for 40.8% of the fishing, 2.04 ticks per bone, no
better than the booth.

## 3. Top-up trades at the tree (measured)

`bones-wc.ts` runs the scored stand-in and a helper in one process (`speedrun/lib/session.ts`).
The helper stands on the tile beside the chopping tile (oak: 2913,3494 beside 2914,3494; willow:
2920,3407 beside 2920,3406) and offers all its bones with `speedrun/lib/trade.ts` `give`. The
scored account accepts with `receiveFrom` on a roll label once its last bone is buried, then
bootstraps the knife cycle again.

- **The helper requests first.** `trade.rs2 [opplayer4]` refuses a target that is busy (delayed
  or in a modal), and a bury keeps the scored account delayed on the tick it lands and the next.
  The helper's request is therefore sent on the label before a roll, when the scored account
  holds 2 bones, so that it lands while the scored account is free and waits (`%tradestatus` =
  received) until the scored account's own trade click opens both screens.
- **Cost: 4 ticks from the scored account's trade click to the bones in its inventory, and a
  roll gap of 8 instead of 3**, so 5 Woodcutting ticks per load (m, 14 of 14 oak trades, 19 of
  22 willow trades). A load is 23 bones with the knife loop's inventory: rune axe, knife, one
  normal log, the product log and one spare slot (25 on the plain loop).
- **Bounced requests.** 3 of the 22 willow trades took 30 ticks. In each, the helper's request
  landed while a Woodcutting level-up page was open ("... is busy at the moment"), and
  `trade.ts give` retried only about 20 ticks later. A helper that re-sends its request on the
  next tick after a refusal should recover these at 1-2 ticks (i, not run).

For a whole run that is about 16 loads for 359 bones (the first can come with the H4 hand-off),
so about 75-80 ticks of trades, plus a few bounces.

## 4. Mining (measured)

`bones-mine.ts` is a stripped-down `tickmanip-mine.ts`: open loop, knife starter, the demo's
respawn of 13 emulated by pinning `player_count.rs2` locally and deleting the built
`script.dat` before the engine starts (as in `skills/tick-manipulation.md` section 5; the pin is
never committed and the script cache is deleted again afterwards).

- **The planned lap has no respawn waits.** The demo lap (`mining.md` section 4, five rocks, 15
  ticks) is exactly the respawn + 2 a rock needs. Measured 3.000 ticks per ore, 194 of 194 gaps
  at 3, twice (m3, m4). There is no idle tick to bury in. (`interleaving.md` section 3's "15-tick
  gaps with 2 rocks" applies only to a bot that does not rotate.)
- **A bury on a move costs 2 ticks.** A delayed player's walk is dropped (`World.ts` decodes the
  packets, then calls `unsetMapFlag` for a delayed player with a path), and the tick after the
  bury rejects every packet. So the move has to wait: `[drop, bury]` on R, `[knife, button,
  walk]` on R+2, the click once the run ends, and the roll comes on R+5 instead of R+3 (m, 129
  of 129 on 1-2 tile moves). That costs the same 2 ticks the bone costs at the booth. The
  3-tile move with a bury never rolled (65 of 65).
- **A bury on a stay is free, after a short entry.** A stay is a transition in which the next
  rock is beside the same standing tile. The Woodcutting bundle works there unchanged:
  `[knife, button, drop, bury]` on R, `[click]` on R+2, roll at once on R+3
  (`mining.rs2:83-85`). The cluster allows two stays per five-rock lap: 2605,3234 touches
  2605,3235 and 2605,3233, and 2602,3235 touches 2602,3234 and 2602,3236. Measured:
  - a stay+bury entered by a knife move of 2 tiles rolled on time in every case (26 of 26 in m5,
    40 of 40 in m6), as did one entered by a plain restart (66 of 66, m4);
  - a stay+bury entered by a 3-tile knife move never rolled (67 of 67 and 26 of 26, both
    stays), and the plain stay after a 3-tile move failed in one lap order (65 of 65, m4), held
    in the other (32 of 32, m5), and failed once in 40 in m6. The rolls of the 3-tile moves
    themselves landed on the planned tile and tick. **The cause is not established**; a click
    that lands mid-run re-paths the player beside the rock (seen and fixed in `bones-mine.ts`),
    but the failures continued with the click after the run.
  - The geometry allows only one short-entry stay per lap. The lap
    `2603,3233>2602,3233 2605,3234>2605,3235 2605,3234>2605,3233 2602,3235>2602,3234
    2602,3235>2602,3236` (`--rot=stay2`) carries one bone per 15 ticks on its east stay:
    **0.066 bones per tick at 3.052 ticks per ore** over 200 ores (m6, one slip on the west
    stay, which carries no bone). The same lap with no bones held 3.000 over 80 ores (m5).

Over S09's ~3,134 knife ticks (Mining 64-99) that is **about 200 bones** of capacity (i). Each
costs nothing on its own transition, a share of a 24-bone top-up (~0.21, i, from Woodcutting's
trades), and the lap's own risk of a slip on the west stay (1 in 200 ores measured, ~10 ticks).
Use it only if Woodcutting cannot take the bones. It needs `stay2` adopted as the run's lap,
which is a change to S09 that Woodcutting does not need.

## 5. Recommended allocation of the 555 bones

| Bones | Where | Step | Prayer ticks (net of the host) | Basis |
|---|---|---|---|---|
| **359** (the 11 early ones and the 348 that were booth bones) | knife Woodcutting + bury from the oak tile (2914,3494), 23 per load, a helper at (2913,3494); continue at the Taverley willow tile if the oak band ends first | S07 | **~83** at 0.23 per bone (m rate); ~110 with willow-style bounces and margin | sections 1-3 |
| ~196 | pickpocket stuns, 1.96 per stun | S18b | 0 here; its ~9-10 top-ups are already in S18's overhead row (48) | `interleaving.md` section 8; pending rs/106 |
| 0 | booth | S25b | step removed (was 721) | |
| 0 | S10a | S10a | step removed (was 21): Prayer is about 94 when S07 ends (i, from prayer.md's 555 bones to 99) | |

- **Capacity.** 359 bones at 0.298 per tick need about 1,200 Woodcutting ticks of S07's ~3,460
  (in-page knife figure, RUN-ORDER S07). If the stun pack falls through (rs/106), Woodcutting
  can take all 544 non-early bones in about 1,830 ticks, at the same ~0.23 per bone, so Prayer
  would add ~45 ticks rather than ~400.
- **Order.** S07 comes before S10a, so the 11 early bones and S10a's purpose (Prayer 43 before
  Tree Gnome Village) are covered by the time S07 ends. Prayer at ~94 by then also covers
  Protect from Melee and Magic, and `prayer.md` notes that Prayer 70 removes the prayer
  potions S10a carried (i; the coordinator should check H7).
- **Wine waits** (rs/107, `research/wine-window.md`). 27 bones there save 37 ticks against the
  booth, about 1.4 each. Against Woodcutting's 0.23 per bone they save ~31, which ties the
  gem-cutting option (~31). With bones no longer at the booth, the wine waits can cut gems
  and keep every bone in S07.
- **Fishing takes none** (section 2). **Mining is the reserve host** (section 4), at about 200
  bones, only if S07 cannot carry them.

## 6. Corrected Prayer line for the tally

| | Expected | Best | Basis |
|---|---|---|---|
| Tally (main thread, 04:20) | 700 | 150 | |
| RUN-ORDER section 7, knife on (before this) | 742 | 583 | 21 at S10a + 721 at the booth |
| **Knife on (this study)** | **~110** | **~80** | 359 bones in S07 at 0.23 (m) to 0.30 (i) per bone; best is the trades alone, 16 x 5 = 80 (m cost per trade) |
| Knife off (plain 4-tick loop) | ~110 | ~75 | plain + bury costs 0.12 (m, xp) to 0.20 (i, trade gaps) per bone against the plain column |

**The double count.** The tally's best of 150 assumed the ~348 non-stun bones rode the idle
tick of plain 4-tick Woodcutting and 5-tick fly fishing, while the same best total priced
Woodcutting and Fishing at their knife figures. Those idle ticks exist only on the plain
clocks, and the plain clock is 25% slower than the knife: measured, burying on plain
Woodcutting costs **1.17 Woodcutting ticks per bone** against the knife loop, so it saves
0.9 per bone, not 2.07. RUN-ORDER section 7 removed the double count by sending the bones
back to the booth (742 / 583). This study finds a host that has the bone *and* the knife: the
knife loop with the click moved to the roll tick (section 2). That restores most of the
saving honestly: about 1.84 ticks per bone, leaving ~110 / ~80 for Prayer. The stun share is
unaffected.

## 7. What this does not establish

- **In-page client.** Everything here is the lite client against a local engine. RUN-ORDER
  prices S07 at M0550's in-page willow rate (4.83 ticks per log against the lite client's
  4.23). Knifebury uses the same per-tick event budget as the plain knife loop (4 events on R)
  plus one event on R+2, so it should degrade with it, but it has not been run in-page.
- **The run gate.** If the gate turns the knife off, plain + bury is the fallback (0.230
  bones per tick, 0.12-0.20 per bone against the plain column).
- **The bounce fix** (section 3) and the trade cost on Mining (taken from Woodcutting) are
  inferred.
- **The 3-tile stay failure in Mining** (section 4) is unexplained. It matters only if Mining
  becomes a bone host.
- Single 600-tick runs for the plain modes and 400-tick runs for Fishing; willow's per-tick
  xp is within roll noise of the knife figure.

## Scripts and logs

| Script | Runs |
|---|---|
| [`bones-wc.ts`](../scripts/bones-wc.ts) | `--tree=oak|willow --mode=knife|knifebury|plain|plainbury`, two sessions (scored stand-in + helper) with real trades; m1 (all 8 at 600 ticks), m2 (oak knife and knifebury at 600, willow at 1,200) |
| [`bones-fly.ts`](../scripts/bones-fly.ts) | `--mode=knife|knifebury|bury5`, Lumbridge (3241,3248), 400 ticks each (m2) |
| [`bones-mine.ts`](../scripts/bones-mine.ts) | `--rot=demo|stay|stay2 --bury=none|stay|short|all`, respawn 13; m3 and m4 (demo none/all, stay none/stay, 200 ores each), m5 (stay2 none/stay, 80 ores), m6 (stay2 short, 200 ores; its no-bone control ran under a load of 25 and is discarded) |

Run in one lab batch, for example:

```
WEB_PORT=9610 WEB_MANAGEMENT_PORT=9611 HISCORES_WEB_PORT=9612 NODE_PORT=44610 AGENT_PORT=8610 \
  NODE_TICKRATE=300 LAB_HELPERS=boneshelp bash speedrun/lab/lab.sh bonesrun \
  docs/speedrun/scripts/tickmanip-latency.ts \
  docs/speedrun/scripts/bones-wc.ts:--helper=boneshelp:--tree=oak:--mode=knifebury:--ticks=600
```
