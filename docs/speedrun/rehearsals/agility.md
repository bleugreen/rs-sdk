# Agility rehearsal (rs/155): fastest 99 from a fresh account

Module: `speedrun/skills/agility.ts` (STEP-MANIFEST.md entry 1). Account:
`cairn_jumps` (assigned by main through rs/147). Labels: **measured** (lab or
demo, script and sample named), **read** (`file:line`), **inferred**
(arithmetic shown).

Status: lab acceptance done (section 1). Section 6 (rs/241) measured the Prayer 43 /
Protect from Melee plan and repriced from creation: **it cannot plausibly beat
stunagile's 6,772**. Protect as built slows the lap badly, and even a perfect
protect leaves the from-creation floor above the record.

## 1. Lab acceptance

All rows: local engine on bgsrv-ub (Linux x86_64, load 3-12 from other
agents), `NODE_TICKRATE=300`, headless Chrome tab on this checkout's bundle,
`docs/speedrun/scripts/tickprog-lab.sh` with `tickprog-measure.ts` modes
`agility` and `agility-steps`, technique `react`, 2026-10-21. One sample each.

| Check | Result |
|---|---|
| Manifest: 10 Wilderness laps at 99 | **9 of 9 measured laps at exactly 66** (pass; need 8 of 10 at 66 +-1). 3 HP of skeleton hits at 99 HP. |
| Gnome lap at 99 | **59 ticks** on 4 of 4 laps (the skill doc's 70.7 was at 100 ms). Steps: log 13, net 5, branch 4, rope 10, tree 4, net 6, pipe 16. |
| Gnome 1 -> 22, fresh 10 HP account | 187 ticks, of which about 80 were one stall: the first click after the lab's teleport was dropped. In the full chain below, 1 -> 22 took **114 ticks** (no teleport). |
| Wilderness at 10 HP, 52 -> 74 in 10 laps, eat line 6 | No death. 2 falls (rope swing: lap of 141; stones: lap of 82), 10 HP to falls, 5 to skeletons, 2 cake eats, ended on 8 of 10 HP. |
| Final logout, a fall within 16 ticks of the last level | Walked to the safe tile (3004,3937), waited 13 ticks, logged out with the logout button. |
| Walk, Gnome course -> Wilderness course (gate, lever, keep web, ridge) | **257 and 262 ticks** (2 runs): 3 slashes each, the ridge on the first try both times. |
| Walk, Lumbridge (3222,3222) -> Gnome course, 10 HP | Without food: **died on White Wolf Mountain** after 313 ticks. With food (eat line 6): reached the Gnome gate at 571-592 ticks; **595 ticks** to the course start in the full chain. |

**Full chain from level 1** (`agility-steps --level=1 --hp=10 --knife
--sharks=16 --at=3222,3222 --to=99`, one run; tick log
`speedrun/runs/agility-lab-1792616099515.jsonl` on bgsrv-ub):

| Step | Ticks | Notes |
|---|---|---|
| walk-gnome | 595 | 2 sharks eaten on White Wolf Mountain |
| gnome 1 -> 52 | 1,042 | 17 laps of 59; 1 -> 22 in 114 |
| walk-wilderness | 262 | |
| wilderness 52 -> 85 | 1,999 | 25 laps: 21 of 66, a first lap of 113, two rope-swing fall loops of 141-142; 1 stall of 80 at the rocks (a dropped click); **14 shark eats, 16 HP to falls, 69 HP to skeletons**; ended `no-food` on 4 HP and logged out |
| boundaries | 0 | 4 boundary rows, 0 ticks |

So the module runs from Lumbridge to the Wilderness course and laps there
unattended; the chain stopped only for food, through the designed `no-food`
path. 75 -> 85 took 858 ticks.

**Lab-predicted totals** (inferred from the chain above and
`agility-model.ts`'s 66-tick bands: 85 -> 99 is 3,078 at 66, scaled by the
chain's measured 52 -> 85 against the model, 1,999 / 1,830 = 1.09):

| Part | Lab (66-tick laps) | Demo (74-tick laps) |
|---|---|---|
| S00 + kit + drop | about 15 | about 15 |
| Lumbridge -> Gnome course | 595 | about 600 |
| Gnome 1 -> 52 | 1,042 | about 1,230 (inferred: 7 obstacles x about 1.6 ticks more per lap, 17 laps) |
| Gnome -> Wilderness course | 262 | about 265 |
| Wilderness 52 -> 99 | about 5,350 | about 6,000 |
| **Total from level 1** | **about 7,260** | **about 8,100** (40 min at 300 ms) |

Against the skill doc's no-quest figures (6,138 at 66, 6,733 at 74, travel
excluded): the bands alone come to about 6,390 in the lab, 4% over the doc,
from the 80-tick stall and the eats. The run's own bands, priced from the
chain's level ticks: **S11a 1 -> 22: 114** (manifest 122); **S17 75 -> 99:
about 4,210** at 66 (manifest 4,024), inferred as the measured 858 for
75 -> 85 plus 3,350 for 85 -> 99. SCORED's 99 Defence and Hitpoints change the
skeleton damage, not the falls or the lap.

## 2. Route decisions

- **Gnome to 52, not the Barbarian course from 35** (the plan's rule: Barbarian
  only if it wins by 50 ticks). Offline routes (`sdk/pathfinding.ts`
  `findLongPath`, doors open) put the Gnome course -> Barbarian course walk at
  about 320 tiles (59 to the stronghold gate, 253 on), not the plan's 118
  straight-line tiles, and Barbarian -> lever at about 275 against Gnome ->
  lever 201. Barbarian: Gnome 1 -> 35 + about 160 walk + Barbarian 35 -> 52
  (about 635) + about 145 to the lever. Gnome: 35 -> 52 on 59-tick laps (about
  700, inferred from the chain's level ticks: 959 -> 1,696 at 35 -> 52 is 737)
  + about 100 to the lever. Barbarian loses before its unmeasured fall exits.
- **The Gnome gate from the south** starts Femi's boxes scene on a first visit
  (`gnome_gate.rs2`, `%femi_help = 0` with Femi within 6 tiles). The walk goes
  through with the shared `passGate` (`speedrun/lib/travel.ts`,
  `GNOME_STRONGHOLD_GATE`): it declines ("Sorry, I'm a bit busy.", which sets
  `%femi_help = 1`), clicks again, and returns only once the player stands on
  the far side. A walk leg that fails for any reason tries the gate, but only
  when the leg ends across it from the player (rs/295's demo stop: the leg
  ended "Stuck at", the old module passed the gate only on "no path", and
  bot.walkTo's own door opener had clicked the gate and opened the scene). The
  scored run's S11a arrives by spirit tree; S15's walked zoo return meets this
  gate once.
- **bot.walkTo opens any "door" next to where its path goes, obstacles included.**
  `sdk/actions.ts` walkTo lists as doors every static-collision door on or
  cardinally beside a path waypoint (`sdk/pathfinding.ts` findDoorsAlongPath),
  the path's last tile included. Once the player is within 15 tiles of such a
  waypoint it clicks the loc's Open op (actions-helpers.ts `openDoorAt`). After
  3 `cant_reach` results it blocks the loc for a while and re-routes. It never
  asks what the Open op does. When the "door" is an obstacle whose Open op
  moves the player (an agility gate, a scripted one-way gate), a walk that only
  ends beside it sets the obstacle off mid-walk, then walks on from wherever the
  script left the player. The case found is loc 2309, the Wilderness course's
  ridge gate (rs/494). A walk that must end near such a loc should end two or
  more tiles from it, and the step should click the loc itself.
- **The ridge gate is the ridge.** Loc 2309's only op, Open, runs the ridge
  crossing (`wilderness_course.rs2`): the player is forcemoved north up the
  one-tile corridor (x 2998, z 3917-3930) into the course, or dropped into the
  wolf pit east of it. So the old route's last walk, to the gate's south tile
  (2998,3916), clicked the ridge mid-walk. bot.walkTo then walked on from inside
  the course and came back down through the course gate. In the lab (executor
  fedora, host bginf-halo, 400 ms, browser client, rs/494) that walk took
  100 ticks for 9 tiles with two fall rolls in one run, and ended "Stuck at"
  after 146 ticks in another. rs/310's session D stopped in the corridor at
  (2998,3918) this way. The unfixed module from that tile is a race: it failed
  1 of 2 lab runs. Walks now end on `RIDGE_GATE.stage` (2998,3914). `crossRidge`
  clicks the gate from there or from the corridor; a click from inside the
  corridor crosses too, in 16 ticks, 4 of 4 lab runs. From the wolf pit it walks
  back to the stage first (28 ticks, 2 of 2). `speedrun/lab/ridge-gate.ts`
  holds the cases. The scored run reaches the course from the south by T27-17
  and never takes this route.
- **Monkey bars** rejected as planned (level-6 Wilderness spiders and earth
  warriors against a 10 HP account).

## 3. Food at 10 HP: the open decision

Measured: skeletons are the main damage, not falls. In the chain, 69 HP to
skeletons and 16 to falls over 25 laps (2.8 and 0.6 per lap); in the 10-lap run,
5 and 10. Natural regeneration is 1 HP per 100 ticks (read, `stat.rs2:59-60`).
A shark at a 10 HP maximum restores at most 4 above the eat line of 6.

Inferred for 52 -> 99 (about 70 laps, about 5,350 ticks): skeletons 140-200 HP
(the two runs' range), falls about 25, less about 53 regenerated, so 110-170 HP
net, or **28-43 shark eats**, plus about 2 on White Wolf Mountain. The
inventory holds 25 sharks at most: 28 slots, the knife, the starter shrimp and
bread, after dropping the other 16 starter items. Options, for rs/147:

1. **A restock at the course gate** from the kit mule (rehearsal-only cost: the
   mule's walk, and about 10 ticks of trade on our clock).
2. **Eat line 4** (each shark restores 6): about 19-29 eats. Risk: at 1-3 HP a
   stones fall in the tick before the eat lands can kill (fall damage is 21.6%
   of HP + 1, read `wilderness_course.rs2:115`), and a death costs about 800.
3. Leave the band at the food line through `no-food` (as the lab did), bank at
   the Mage Bank and come back: about 200 ticks a trip (inferred).

SCORED in S17 is unaffected: at 99 HP a shark restores 20 and the same damage
is 8-12 sharks.

## 4. Wilderness policy as built

Food: the module passes the program `eatGap: 3` and `eatAt: 'land'` by default
(rs/270; `--skill-opt=eatAt=any` restores eating on the tick an eat falls due). With
'land' an eat that falls due on the walk to an obstacle is held and sent just before
the next click, so it can't cancel the obstacle (section 6.5); at 3 HP or less (one
skeleton hit) it eats at once.

Run default `pauseFor: 'none'` (rs/147): every player seen is logged with
whether the Wilderness rule lets them attack us; `wouldPause` counts how often
each rule would have fired. The lab had no other players, so the sighting rates
come from the demo attempt. A pause costs about 20 ticks of playtime per relog
on the demo (rs/164) plus the wait. A player's hit ends the band with a retreat
and logout; a death logs out at the respawn. Auto-retaliate stays on: the
client exposes no toggle (`sdk/` has none), so a skeleton's hit can start our
player swinging back. Whether that caused the stall at the rocks is not known.

Not yet drilled in the lab: the pause, attack and death paths against a second
lab bot (unit-tested on the fake SDK only).

## 5. Demo attempt

Not a record attempt: section 6 prices the plan below stunagile's row. Under
main's ruling (addendum 18 as amended 19:56 PDT), cairn_jumps runs to 99 as a
measurement once rs/147 grants it, with protect off and the kit in section 6.4.
The run itself, in its sessions, is section 7.

## 6. Prayer 43 and Protect from Melee (rs/241)

Lab rows: bgsrv-ub, `NODE_TICKRATE=300`, headless-shell Chrome tab on a bundle
built from rs/147's branch at 75ce523c (contains main 7711fdb7), `tickprog-lab.sh`
mode `agility`, 10 laps each, one sample each, 2026-10-21 19:24-20:01 PDT. Host
load 5-57 during the 10 HP rows.

### 6.1 Protect modes on the Wilderness course (measured)

10 HP, combat 3, Agility 52, Prayer 43, eat line 6 (eating in any phase), sharks:

| Protect | Ticks / lap | Skeleton HP | Fall HP | Eats | Prayer used | Toggles | Stuck obstacles |
|---|---|---|---|---|---|---|---|
| off | **67.8** | 7 | 2 | 1 | 0 | 0 | 0 |
| flick (gap 4) | 336.9 | 0 | 5 | 0 | **43 (all)** | 1,574 | 33 |
| near (range 3) | 116.9 | 6 | 7 | 1 | 30 | 41 | 4 |
| hold | 253.2 | 35 (after the points ran out) | 10 | 11 | 43 (all) | 991 | 21 |

SCORED's S17 stats (Agility 75, HP 99, Defence 98, Prayer 99), protect off, 12
laps: **70.3 ticks / lap** (66 clean; one log fall), skeletons 6 HP, falls 15, no
eats, ended on 84/99. S17 needs no protect and no eating in 12 laps.

What the rows show:
- **The prayer button breaks the lap.** The obstacles that stalled are the ones with
  a walk to the click tile (pipe 86 ticks against 17, log 90 against 17, rocks 86
  against 10). The program already skips toggles in the 3 ticks after a click, but
  a toggle later in the approach still cancels it (the button's
  `p_clearpendingaction`), and the step then times out (`stepTimeout` 40) and
  re-clicks. Every mode that toggles pays this; flick toggles most and pays most.
- **Flick does not avoid the drain.** Reading `prayer.rs2:30-43,163-178`, an off and
  on in one tick should clear and restart the 5-tick timer, so it never fires. In
  the lab the flick run still used all 43 points. Either the second toggle in a tick
  is not applied, or the timer restarts in a way the reading missed. Not
  investigated further, because the lap cost alone rules the mode out.
- **Hold** lasts about 215 ticks at 43 points (1 point per 5 ticks, as rs/158 read),
  about 3 laps. After that the program keeps sending toggles at 0 points, which
  keeps cancelling obstacles.
- Skeleton damage with protect off was 0.7 HP per lap here against 2.8 in
  section 1's chain: the rate varies a lot between runs.

**The cost of an eat inside a lap** (rs/158's question; S17 stats, eat line 98 so that
every hit eats, 14 laps): inconclusive.
- Every lap without an eat was exactly 66.
- All 5 eats fell in the two laps that also had a fall: 113 ticks (2 eats) and 160
  ticks (3 eats). The 160-tick lap includes one 40-tick obstacle timeout (`stuck`).
- An eat is an inventory click, and `OpHeldHandler.ts:55` runs `clearPendingAction`
  on it, the same path that lets the prayer button cancel the walk to an obstacle.
- So an eat sent during an obstacle approach very likely costs the 40-tick
  `stepTimeout` (inferred, one occurrence). Section 1's 80-tick "dropped click" at
  the rocks fits the same cause.
- An eat in the ticks an obstacle's own script holds the player should cost nothing
  (not separated here).

Section 6.5 settles this: the mechanism is confirmed, and with `eatAt: 'land'` an eat
costs nothing.

**Ruling for the module:** `protect` stays off (the default). The program's protect
keys remain declared and opt-in, but no plan should use them until a toggle that
never lands during an obstacle approach is built and measured.

### 6.2 Prayer 1-43 priced (read and inferred; not run)

Prayer 43 is 787.4 base xp (`Player.ts:77-85`; 37 is 504.9). Bury is 2 ticks per
bone (`prayer.md` section 4). Fleet stock per rs/41 (19:5x PDT): **no dragon bones
outside SCORED's**, about 250 spare babydragon bones, about 2,526 big bones; both
would be handed over as notes.

| Bones | Count | Bury ticks | Extra on the clock |
|---|---|---|---|
| babydragon (30) | 27 | about 53 | a second trade for food (about 8), or unnoting at a bank |
| big (15) | 53 | about 105 | two loads: a second trade |

Place: Lumbridge, right after S00. Drop the 16 starter items, take knife and
27 unnoted babydragon bones in one trade (28 slots), bury, then take the food.
About **70 ticks** in all against a no-Prayer start. stunagile's Prayer 43 at 20 s
(about 67 ticks, S00 and trade included) fits 11 dragon bones, which we don't have.

### 6.3 Repriced from creation (lab, ticks)

| Part | Floor | Central | Source |
|---|---|---|---|
| S00, kit, drop, top-up | 25 | 25 | measured parts (S00 4, kit 8 on the twin for Fishing; drop about 3) plus one more trade (inferred) |
| Prayer 1-43 | 0 (no protect) | 0 | 6.1: protect is not used |
| Lumbridge to the Gnome course | 595 | 595 | measured, section 1 |
| Gnome 1 -> 52 | 1,042 | 1,042 | measured, section 1 |
| Gnome to the Wilderness course | 257 | 262 | measured, section 1 |
| Wilderness 52 -> 99 | 4,908 | about 5,130 | floor: `agility-model.ts` at 66-tick clean laps with expected falls; central: the measured 67.8-70.3 laps (6.1) plus the first-lap entry (+47) |
| Restock trip | 0 | about 100 | inferred: course gate out, a trade, the ridge back in; not measured |
| **Total** | **about 6,830** | **about 7,150** | |

Spread (inferred): fall counts dominate the run-to-run spread, about +-200 ticks
(one standard deviation; about 14 falls expected over 52 -> 99 at about 50 ticks
each). Against 6,772:
- with every part at its floor, 6,830 +- 200 beats it about 40% of the time;
- at the central 7,150 +- 200, about 3% of the time.

The demo is not faster than the lab (section 1). That is far below main's
P(#1) >= 90%, and nowhere near the 6,433 planning bar. Neither number is calibrated
by a from-creation run with the final fixes.

A perfect protect (no lap cost, no drain) would remove the restock trip and some
skeleton stalls (about 100-180) and add Prayer 1-43 (about 70). It moves the central
figure to about 7,050, which still doesn't clear.

**What stunagile must be doing differently** (inferred). Its only stamps are Prayer
43 (20 s) and Agility 99 (33:51), so it trained at 10 HP. With our measured
pre-52 (about 1,925 plus its about 67 for Prayer), its 52 -> 99 would be about
4,780 ticks, which is about 64.3 ticks a lap with falls (4,780 / 4,908 x 66). Our clean lap is 66. So
the gap is in the lap's reaction ticks or in a faster 1 -> 52, not in Prayer.

Checked and rejected:
- **The Edgeville dungeon monkey bars** (20 base per 10.1-tick crossing, melee-only
  NPCs, so Protect from Melee would make them safe). They need 15 from the south
  end. Only the north end at z 9969 skips the check (`shortcuts.rs2:153`), and the
  north side is a pocket reachable only over the bars (`sdk/pathfinding.ts`
  offline routes).
- **Another 1 -> 15 near Lumbridge or Edgeville.** There is none: the Falador
  crumbling wall (2935,3355) needs 5, the island rope swing 10.
- **Gnome 1 -> 15, then the bars.** About 130 ticks slower than Gnome to 52,
  because of the Gnome -> Edgeville walk.

### 6.4 Kit for the measurement run (no Prayer, protect off)

At 10 HP and an eat line of 6, a shark restores at most 4 HP. A cake restores 4 per
bite, 3 bites a slot, so about 12 HP per slot. Expected net damage for
Walk + 52 -> 99 is about 20-200 HP (6.1 and section 1's rates, less about 50
regenerated).

| When | Items |
|---|---|
| At spawn, from the kit giver (10 free slots) | knife 1, cake 7, shark 2 |
| After `drop` clears the 16 starter items, top-up from the same giver | shark 18 |
| Courier restock near (2998,3916), only if food falls to 4 | shark 20 |

That carries about 164 HP of healing on top of regeneration. The restock covers
section 1's high rate.

### 6.5 The eat and the obstacle click (rs/270, measured)

Lab: bgsrv-ub, `NODE_TICKRATE=300`, headless-shell Chrome tab on a bundle built from
rs/270's branch at a9298868, `tickprog-lab.sh` block `agility`, one session,
2026-10-21 20:33-20:47 PDT, host load 3.6-4.6. Logs
`$TMPDIR/agl270-a.keep` on bgsrv-ub (scratch, not kept).

**(a) The mechanism** (`tickprog-measure.ts` mode `eat-probe`, Agility 99, HP 99). The
Wilderness log balance (3001,3945) clicked from (2996,3958), 13 tiles away; ticks from
the click to the log's 20 xp, three trials each:

| Trial | Click to xp | Eat landed (ticks after the click) | Ended on |
|---|---|---|---|
| click only | 16, 16, 16 | | (2994,3945), across |
| eat 3 ticks into the walk | **lost** x3 (no xp in 40 ticks) | 4, 4, 4 | (3001,3946): beside the log, not across |
| eat sent just before the click | **16, 16, 16** | 1, 1, 1 | (2994,3945), across |

An eat during the walk loses the obstacle: the player finishes the walk to the log and
stands there (`OpHeldHandler.ts` runs `clearPendingAction` on the inventory click, which
drops the pending loc interaction but not the walk). An eat sent with the click costs
nothing: the click after it sets the interaction again.

The same in the program, Agility 99, HP 99, 27 cakes, eat line 99, so that every eat
the gap allows is due:

| `eatAt` | Result |
|---|---|
| `'land'` (eats held to the click tick) | 10 laps, **every lap 66**, 5 eats in each lap (one per click), 50 eats, no stuck step |
| `'any'` (an eat every 3 ticks in any phase) | 4 obstacles in 278 ticks: stones 96 and log 90 ticks, 2 `stuck` (the 40-tick timeout), then out of food |

**(b) S17's arrival stats** (Agility 75, HP 99, Defence 98, Prayer 99, protect off), eat
line 98, `eatGap: 3, eatAt: 'land'`, 20 sharks, 16 laps (15 timed; the program times a lap
from one lap bonus to the next, and its per-lap counts include the untimed first lap):

| Laps | Ticks each | Falls in the lap | Eats in the lap |
|---|---|---|---|
| 10 | **66** | 0 | 0 |
| 2 | 82 | 1 stepping-stones fall | 2 each |
| 1 | 98 | 2 stepping-stones falls | 5 |
| 2 | 141 | 1 rope-swing fall (pit, ladder, resume at the stones) | 2 and 1 |

Mean 80.3 ticks a lap over the 15 (6 falls in 15 laps, a high draw: section 6.1's 12 laps
had 1). 13 eats in all (one in the untimed first lap), 118 HP to falls, 5 to skeletons,
**no stuck step**, ended on 99/99.

Every lap without a fall was 66, and every lap with eats also had a fall: at an eat line
of 98, only a fall's damage (21.6% of HP + 1) makes eats. Those laps cost exactly what a
fall alone cost in section 1's runs with no eats in the lap (82 for a stones fall, 141-142
for a rope-swing fall). So **an eat costs 0 ticks with `eatAt: 'land'`** (measured: the
50-eat run above, and every eat lap here equal to its fall's known cost). Section 6.1's
'any' run paid a 40-tick timeout in one of its two eat laps (160 against 120 for its
falls), which is the cost 'land' removes.

For S17's pricing (rs/158): eats add nothing to the lap; the lap's variance is the falls.
The stones fall costs 16 ticks and the rope-swing fall about 75.

### 6.6 Falls at 75-85 by obstacle (rs/270, measured; for rs/158's S17 pricing)

Lab: bgsrv-ub, `NODE_TICKRATE=300`, bundle at e56dd685, 2026-10-21 20:53-21:20 PDT, load
4-5.5. Five runs of `tickprog-measure.ts agility --level=75 --until=85` at S17's arrival
stats (HP 99, Defence 98, protect off), 20 sharks, eat line 60, `eatGap: 3, eatAt: 'land'`.
The driver's `LAPLOG` line gives each lap bonus's tick and each fall's tick; the obstacle is
the program's per-step fail count, matched to the fall by the zone the player stood in the
tick before (mid-crossing that is the next obstacle's zone: the zone named `log` is a
stepping-stones fall, `rocks` a log fall, `stones` a rope-swing fall; all five runs' counts
agree).

| Obstacle | Falls | Per lap (69 laps run) | Lap ticks with that one fall | Cost |
|---|---|---|---|---|
| stepping stones | 4 | 0.058 | 82, 82 | **+16** (back to the stones' start) |
| log balance | 3 | 0.043 | 113, 113 | **+47** (the pit, the ladder, resume at the stones) |
| rope swing | 5 | 0.072 | 141, 141 | **+75** (the pit, then the stones) |
| pipe, rocks | 0 | 0 | | |
| **all** | **12** | **0.17** | one lap with a rope swing and a stones fall: 157 (66 + 75 + 16) | |

63 timed laps: **56 without a fall, 55 of them at 66 and one at 68**. Mean 71.9 a lap. Expected
fall cost per lap at these rates, 0.058 x 16 + 0.043 x 47 + 0.072 x 75 = **8.4 ticks**, so an
expected lap of about 74 at 75-85 (inferred). The fall costs are fixed by the scripts; the
rates carry the sampling error (12 falls; with 6.1's 1 in 12 and 6.5's 6 in 15, 19 in about
95 laps, 0.20 a lap). Eats: 1 in all five runs at the eat line of 60; skeleton damage 4 HP.
Each run's 75 -> 85 from the start call (the teleport to the course start, so a first-lap
entry included): 1,011, 936, 1,016, 1,091 and 1,059 ticks.

### 6.7 Run mode, the lap floor, Protect's drain and the reprice (rs/270)

Asked by rs/147 after stunagile's player page (Prayer 43 at 20 s, no Hitpoints row): is our
66-tick lap the floor, does running help, and does a land-gated Protect from Melee change the price?

**Run mode is worth 0 ticks on both courses** (measured, bgsrv-ub lab, bundle at 0ccc56c7 and
a86d5d8b, `tickprog-measure.ts agility` with and without `--run`, which clicks the run button,
component 153, and prints the `option_run` varp: 0 before, 1 after):

| Course, level | Walking | Running |
|---|---|---|
| Wilderness, 99, 10 laps | 66 every lap; pipe 16.5, rope swing 7, stones 15, log 17, rocks 10 | identical, step for step |
| Gnome, 30, 6 laps | 59 every lap | 59 every lap |
| Wilderness, 52, 8 laps | clean laps 66; 194 one-tile and 160 two-tile moves | clean laps 66; 212 and 179 |

The two-tile moves with run off come from the obstacles' scripted movement (`p_exactmove`,
`~forcemove`, `p_teleport` in `wilderness_course.rs2`), which ignores run mode, and the approaches
end in a script that repositions the player anyway (the log teleports to its start, the rope swing
delays by distance, the stones and rocks `p_arrivedelay`). The module's walks between courses
already run: the webclient sends every walk click with run held (`ActionExecutor.ts`
`running ?? true`, the server's `tempRun`), so the 595 and 262 above are running figures.

**66 is the Wilderness floor and 59 the Gnome floor for a click-after-xp program** (read, then
measured above). A click that reaches the server while the player is delayed is dropped
(`OpLocHandler.ts`, "cannot interact while delayed"), so a click can't be queued during an
obstacle. The obstacle's script ends on tick T and its xp shows in T's state; the in-page reaction's
click lands on T + 1, the first tick the click can be accepted. Each step is its script's ticks plus
that one tick, with no slack left in the walks.

**Protect from Melee's drain** (read). The drain is a normal 5-tick timer
(`prayer.rs2` `[timer,prayer_drain]`; effect 12 x 5 = 60 a firing against a resistance of 60 = 1
point), and a normal timer fires only on a tick when the player is free (`Player.ts`
`processTimers`, `canAccess()`), so obstacle ticks don't drain. Not measured; I expect 43 points
to cover a few laps to perhaps ten, not 52 -> 99's 67 laps.

**Reprice from creation** (`agility-model.ts --lap=66 --sim`, 20,000 runs; inputs: the engine's
fail rolls `succ(200|180, 250, L)`, the measured fall costs of section 6.6, the measured 66; fixed
parts S00/kit/top-up 25, Lumbridge -> Gnome 595, Gnome 1 -> 52 1,042, Gnome -> Wilderness 262,
the first-lap entry 47, so 1,971):

| Band | Mean | SD | p5-p95 | Laps | Falls |
|---|---|---|---|---|---|
| 52 -> 99 | 4,935 | 160 | 4,721-5,230 | 67.2 | 11.5 |
| 75 -> 85 | 1,051 | 80 | 924-1,187 | 13.9 | 3.0 |
| 85 -> 99 | 3,128 | 109 | 2,967-3,314 | 43.9 | 5.1 |

| Plan | Total, mean | P(beat 6,772) |
|---|---|---|
| no restock trip | 6,906 | **21%** |
| with the courier restock (about 100) | 7,006 | 3% |
| a 65-tick clean lap (no such lap exists, above) | | 40% |
| a 64-tick clean lap | | 56% |

Section 6.3's central 7,150 used laps of 67.8-70.3 that carried eat stalls (fixed by `eatAt:
'land'`) and its ±200 was a guess; this replaces both. stunagile's 6,772 sits at our
distribution's 21st percentile: a run with fewer falls than expected explains it, with no faster
lap needed.

**What decides the row is the restock, not Protect.** At 10 HP a cake heals 4 a bite, 3 bites a
slot, about 12 HP a slot, against a shark's 4. The kit's 18-shark top-up as cakes (25 cakes and 2
sharks in all, about 300 HP) covers section 1's worst skeleton rate (2.8 HP a lap, about 190 HP
over 67 laps, less about 50 regenerated) with no restock. Protect could save at most that same
restock, and costs Prayer 1 -> 43 (about 70 ticks, section 6.2) plus toggles that must wait for a
safe tick, so its expected gain is about 0. Even so, P(#1) of 21% is far below main's 90%, so
cairn_jumps's run is a measurement, not a record attempt.

### 6.8 The clean Wilderness lap, tick by tick (rs/270, measured)

Lab: bgsrv-mac, `NODE_TICKRATE=300`, bundle at 08bd3f2f, 2026-10-21 22:35 PDT, Agility 99,
`tickprog-measure.ts agility --laps=3 --trace=260` (each tick's published position, xp gained and
animation). Three laps, every one 66 ticks and identical tick for tick. One lap, from the lap bonus
on tick 160 to the next on 226; "xp on T" means T's state shows the obstacle's xp, which the script
grants at its end:

| Obstacle | Click lands, first move | Approach walk | Then | Script ticks | Xp on | Ticks |
|---|---|---|---|---|---|---|
| pipe | 161 | (2994,3933) -> (3004,3937), 10 tiles in 5 ticks (161-165) | 166 on the entry tile; two squeezes 167-169 and 173-175 with the telejump at 172 | 12 (166-177) | 177 | **17** |
| rope swing | 178 | (3004,3950) -> (3005,3951), 1 tile (178) | 179 the interaction; 180 `p_teleport` to the swing tile, then `p_delay(distance)`; swing 183 | 6 (179-184) | 184 | **7** |
| stepping stones | 185 | (3005,3958) -> (3002,3960), 3 tiles in 2 ticks (185-186) | 187 `p_arrivedelay`; six jumps of 2 ticks each, 188-199 | 13 (187-199) | 199 | **15** |
| log balance | 200 | (2996,3960) -> (3001,3946), the log's north side, 14 tiles in 7 ticks (200-206) | 207 `p_teleport` to the log's east end (3002,3945); 8 tiles of forced walk, 208-215 | 10 (207-216) | 216 | **17** |
| rocks | 217 | (2994,3945) -> (2994,3937), 8 tiles in 4 ticks (217-220) | 221 `p_arrivedelay`; climb 222-225 | 6 (221-226) | 226 (with the lap bonus) | **10** |
| **lap** | | **19 walking ticks** | | **47** | | **66** |

What it shows:
- **No reaction tick is lost.** Each click lands on the tick after the xp shows, and the player
  moves on that same tick. **A click that reaches the server while the player is still delayed is
  dropped** (`server/engine/src/network/game/client/handler/OpLocHandler.ts`: "normal: cannot
  interact while delayed"), so no click can arrive earlier.
- **Every approach runs at 2 tiles a tick**, run setting on or off: an obstacle click's move runs
  (rs/280; section 6.7's walking-against-running laps). Only the stones' approach has an odd length
  (3 tiles, so its second tick moves 1).
- **No other approach tile saves a tick.** Each landing tile is fixed by the previous script, and
  each obstacle's script fixes where it starts:
  - the pipe needs its entry tile (`p_walk` there otherwise);
  - the rope swing teleports to its tile and waits out the distance (`p_delay($delay)`), so a nearer
    tile gains nothing;
  - the stones start from the tile east of the first stone, after a `p_arrivedelay`;
  - the log teleports to its east end once its north side is reached, which is the nearest
    reachable side from the stones' landing;
  - the rocks' approach is a straight 8 tiles south, followed by a `p_arrivedelay`.

So 66 is this engine's floor for the Wilderness lap, and stunagile's implied average of about 64.3
over 52 -> 99 can't come from a faster clean lap. Its 6,772 sits at our distribution's 21st percentile
(section 6.7): a run with fewer falls explains it. The cairn_jumps attempt's per-lap log will show
the demo's own spread of fall loops.

## 7. Demo run: cairn_jumps (rs/295, rs/310)

One account, `cairn_jumps`, one tick log (`~/rs-run/cairn_jumps.jsonl` on the twin) across every
session, so total playtime is one series; the hiscore is the authority on the total. Machine: the
twin (HOST.md), browser client on the xrdp display `:10`, Chrome 156, page served from the
attempt's worktree, gateway from `~/rs-sdk`. Module defaults throughout: `eatAt: 'land'`,
`eatGap: 3`, `pauseFor: 'threat'`, `playerRadius: 15`, `maxPauses: 3`, protect off. Every figure
is measured (m) from the tick log, the harness log and its summary, unless labelled.

### 7.1 Session A: creation to the Gnome south gate (rs/295, 2026-10-22 06:08-06:14Z)

Worktree `~/rs-295` at 82cadf6d; `--kit-from=cairn_mule2 --kit=knife:1,cake:7,shark:2`, the
top-up `topUpWant=cake:18` from `cairn_mule2`, and a drop of the starter items.

| Row | Result |
|---|---|
| `(gate) players` | 1,791 online |
| `(gate) direct` (cairn_twin, 06:08:38Z) | (a) 59/60, (c) 0 catch-ups/min, tick p90 481.5 ms (over the 400 report line); vantage edge iad, TCP connect p50 1.9 ms |
| `(gate) in-page before` (cairn_twin's tab) | (a) 58/60, (c) 0/min, loop p10 72.8/s, tick p90 503 ms |
| `(gate) recording` | `~/recordings/rs295-agility-20261022T060833Z.mkv` on `:10` |
| `(gate) live frame` | PASS: cairn_jumps's tab the only window, maximised, in front; frame difference 2.2 |
| S00 tutorial skip | **4 ticks** (2-6) |
| S01 kit | **8 ticks** (6-14) |
| `agility:top-up` | settled on tick 24 (the trade 6 ticks), inside walk-gnome |
| `agility:walk-gnome` | **561 ticks** (14-575), **failed at the gate**: `No path to (2461, 3386) from (2461, 3382)` |
| Logout | click on tick 575, confirmed by the page; session 576 ticks |
| `(players) end` | 1,790 |
| TICKMON | 0 glued ticks in every minute; tick period 327-368 ms |

One cake was eaten on the walk (rs/295's report). The player reached the gate tile (2461,3382)
about tick 570. The gate click opened Femi's first-visit scene ('Hello there.', tick 571), the
browser client's dialogue was not continued, and the retried walk met the closed gate (rs/309's
fault 1).

### 7.2 Session B: the first resume (rs/295, 06:24Z)

Worktree `~/rs-295` at e67edee1 (any failed leg tries the gate). The gate came from a direct read
taken just before (cairn_twin, 06:22:33Z: (a) 58/60, (c) 0/min, tick p90 475.6 ms; 1,795 online),
with no gate tab (`--gate-probe-trials=0`). The same recording was still running, and the live
frame passed (difference 2.3).

The harness resumed at `agility:walk-gnome` (S00 and the kit already done). The session started
under 'Loading - please wait': the old gate pass clicked the gate before the region was built and
returned success without the player moving (rs/309's fault 2), the walk failed again at (2461,3382),
and the step failed on tick 10. Logout click on tick 10; session 11 ticks; 1,793 online at the end.

### 7.3 Totals after rs/295

| | Ticks |
|---|---|
| Steps | S00 4, kit 8, walk-gnome 561 + 9 = 570; 582 in all |
| Sessions | 576 + 11 = 587 |
| Playtime by the log (each session's last tick + 1) | **589** |
| Hiscore Overall | **576**: session A's 577 less 1; session B's 12 don't show, because the row moves only on a level gain (HARNESS.md, "Relogs") |
| Agility | 1 (no hiscore row under 15) |

The model's fixed part to the Gnome course start is 25 (S00, kit, top-up) + 595 (Lumbridge to the
course start, the lab's 571-592 to the gate plus the pass, section 1) = 620. Session A was on that
pace to the gate (14 + 561 to arrive about tick 570, against the lab's 571-592).

### 7.4 Session C: the resume, Gnome 1 -> 52 (rs/310, 20:47-20:57Z)

Worktree `~/rs-310` at b1436d00 (rs/147's mission branch, carrying rs/309's #321 c4e2a681,
aa3f012c's auto-retaliate off and main's floor dd225788), page served from it. Served-page check
before login: `eatAt` 4 hits, rs/309's `sceneReady` 1 hit, served `client.js` byte-identical to
the worktree's build; `GNOME_STRONGHOLD_GATE` is Bun-side (in the worktree's `travel.ts` and
`agility.ts`). Launch: session B's line with the cairn_twin gate tab back (2 logins),
`--claim-owner=rs/310`, `SPEEDRUN_TICK_MS=400` (the harness's wall-clock bounds) and the same
`--log`. The Chrome profile was new (cold on-demand cache). Demo: **400 ms ticks** (worldfeed
hello `tickMs 400`), process token `mvjz3zys` at the start; 38 of our accounts online before the
claim. The claim kept the twin's gate timer off its :00/:30 reads from 20:46Z to 21:08Z.

| Row | Result |
|---|---|
| `(gate) players` | 1,237 online |
| `(gate) direct` (cairn_twin, 20:47:09Z) | (a) 60/60, (c) 0 catch-ups/min, tick p90 480.7 ms (report line 400 is a 300 ms calibration); edge iad, TCP connect p50 2.1 ms |
| `(gate) in-page before` | (a) 60/60, (c) 0/min, loop p10 72.5/s, tick p90 450 ms |
| `(gate) recording` | `~/recordings/rs310-agility-20261022T204646Z.mkv` on `:10` (1,108 s) |
| `(gate) live frame` | PASS: cairn_jumps's tab the only window, maximised, in front; difference 2.3 |
| Inventory at login | knife, 2 sharks, 25 cake slots (the kit's 7 and the top-up's 18, one partly eaten); S01 skipped |
| `agility:gate` north | **14 ticks, 2 clicks, 1 dialogue** (Femi's first visit cleared), ended north: rs/309's helper |
| `agility:walk-gnome` | **49 ticks** (4-53), from the gate to the course |
| `agility:gnome` 1 -> 52 | **1,043 ticks** (53-1096), 17 laps, 124 obstacles; clean laps 59 (one 60); 0 falls, 0 eats; program frames p50 400, p90 480 ms, 0 catch-ups |
| `agility:gate` south | 6 ticks, 1 click, 0 dialogues |
| `agility:walk-wilderness` | **failed** at tick 1191 after 95 ticks: `walk to (2561,3311): Stuck at (2537, 3351)` |
| Logout | click on tick 1191, confirmed by the page; session 1,194 ticks |
| `(gate) in-page after` | (a) 60/60, (c) 0/min, loop p10 72.8/s |
| `(players) end` | 1,260 |
| TICKMON | 0 glued ticks in every minute; period 399-400 ms |

**Why the walk failed** (measured on the recording, read in the code). The leg to (2539,3351)
arrived at 20:57:09Z, and `bot.walkTo(2561,3311)` started while the browser client was rebuilding
the scene: the frame at about 20:57:09.4Z shows 'Loading - please wait.' over the player. Both
tries returned `Stuck at` within about 1.6 s, and no walk toward the lever was sent. The map there
is open ground (the only door on the path is the lever house's at (2564,3310)). The chain: since
#321 a world click while `state.sceneReady` is false returns `scene_loading`, not success
(`sdk/index.ts`, `sendAction`); `walkStepToward` (`sdk/actions-helpers.ts`) turns any failed
dispatch into 'stuck' at once; and `walkTo` (`sdk/actions.ts`) turns three of those, with no
door nearby, into `Stuck at` within milliseconds. So on the browser client a walk leg that starts
during a rebuild fails outright: region crossings, and every teleport, lever or spirit-tree
landing or relog followed by a walk. The lab's lite client builds within the tick and never shows
it. The fix is rs/485 (walkStepToward waits for `sceneReady`, then judges movement and re-sends
once).

### 7.5 Totals after session C

| | Ticks |
|---|---|
| Sessions | 576 + 11 + 1,194 = 1,781 |
| Playtime by the log | **1,784** (each session's last tick + 1) |
| Agility 52 reached | playtime **1,685** by the log; hiscore **1,682** (Agility and Overall, at 400 ms/tick), 3 under the log |
| Model to 52 (section 6.7's fixed parts) | 25 + 595 + 1,042 = 1,662 |
| Divergence at 52 | **+23** by the log (+20 by the hiscore), all in the walk to the Gnome course: 561 + 9 + 49 = 619 against 595. That is the gate stall: session A's failed tries at the gate, session B's 11 ticks, and the relog and gate pass in session C. Gnome 1 -> 52 itself ran 1,043 against 1,042 |
| Lost to the walk-wilderness failure | the logout's 3 ticks, plus the next session's relog cost (about 20, HARNESS.md "Relogs"); the 95 ticks walked still count, since the resume starts from (2538,3350) |

The resume from (2538,3350) waits for rs/485's tested commit: main approved overlaying its sdk
files byte-identical on `~/rs-310` (the sdk runs outside the page, so the bundle is unchanged).
