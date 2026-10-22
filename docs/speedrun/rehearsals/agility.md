# Agility rehearsal (rs/155): fastest 99 from a fresh account

Module: `speedrun/skills/agility.ts` (STEP-MANIFEST.md entry 1). Account:
`cairn_jumps` (assigned by main through rs/147). Labels: **measured** (lab or
demo, script and sample named), **read** (`file:line`), **inferred**
(arithmetic shown).

Status: lab acceptance done (section 1); the demo attempt waits for a slot and
for the kit decision in section 3.

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

Pending a slot from rs/147 and the food decision in section 3.
