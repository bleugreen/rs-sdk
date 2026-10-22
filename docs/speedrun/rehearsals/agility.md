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
  (`gnome_gate.rs2`, `%femi_help = 0` with Femi within 6 tiles). The walk
  declines ("Sorry, I'm a bit busy.", which sets `%femi_help = 1`) and clicks
  again. The scored run's S11a arrives by spirit tree, so its Grand Tree quest
  never sees this.
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
