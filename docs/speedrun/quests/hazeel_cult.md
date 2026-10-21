# Hazeel Cult (feasibility: not worth doing)

**Verdict: skip it.** The reward is 1,500 base Thieving, worth **about 130 ticks** on the
planned route (rs/2 `docs/speedrun/skills/thieving.md` section 2: with Fight Arena and
Biohazard already giving 3,425 base, Thieving to 99 drops from about 1,852 to 1,721 ticks,
`thieving-model.ts`, rs/2 branch at 0e184ef2; rs/26 is re-timing the knights at 300 ms and
may shift these rows a little). The cheaper side costs **about 325 ticks on the fixed
client** (about 430 stock, about 270 burst; inferred from the scripts), so it loses by
140-300 ticks. The travel alone (about 180 ticks) is more than the value.

Nothing was measured: the estimate is clearly above the value in every column, as the
coordinator's rule for these candidates asked (cairn://p/rs/3).

## Reward

- **1,500 base Thieving** and 2,000 coins (read, `quest_hazeelcult.rs2:169-175`).
- **1 quest point** (read, `quest.constant:99`).
- **Both sides give the same reward.** There is one completion queue,
  `hazeelcult_quest_complete`; the good side reaches it from the cupboard
  (`quest_hazeelcult.rs2:121`), the evil side from Hazeel's departure
  (`alomone.rs2:90-98`).

## Requirements (as this server enforces them)

None: no `stat()`, `stat_base()` or quest check in `quest_hazeelcult/` (read, grep). The
sewer raft only moves when the five valves are set (`quest_hazeelcult.rs2:11-53`). The
wiki lists no skill requirement either.

## The two sides

The good side (refuse Clivet, fight Alomone, expose Jones) is cheaper. The evil side
(accept, poison the range, get the amulet, then the scroll from the mansion and take it
back to Alomone) adds a second and third round trip between the Carnillean mansion and the
cult's cave, plus Hazeel's resurrection: about 35 more pages and a `p_delay(5)`
(`alomone.rs2:43-73`). Only the good side is costed.

## Good side: route and counts (read; estimates)

Locations from the map data (`quest-smallskill-locate.ts`). Mansion: Ceril on the ground
floor (2565,3271) and upstairs (2573,3268), the cupboard upstairs (2573,3267). Cave entrance
(2585,3233), Clivet inside at (2566,9683), Alomone at (2609,9670). Valves (2562,3247),
(2572,3263), (2585,3245), (2597,3263), (2609,3243); valve 3 turns left and the rest right
(`quest_hazeelcult.rs2:55-70`).

| # | Step | Varp | Raw counts | Ticks fixed (est.) |
|---|---|---|---|---|
| 0 | Trade (teleport runes, food) | | 1 trade | 5 |
| 1 | Ardougne teleport, run to Ceril | | ~100 tiles | 54 |
| 2 | Ceril: "What's wrong?", "Yes, of course, I'd be happy to help." (`ceril_carnillean.rs2:8-32`) | 0 → 2 | ~16 pages, 2 options | 19 |
| 3 | Run to the cave, enter (teleport into it) | | ~45 tiles | 25 |
| 4 | Clivet: "What do you mean?", then "You're crazy, I'd never help you."; he leaves on the raft (`clivet.rs2:8-19,89-133`) | 2 → 3 → 4 | ~19 pages, 2 options | 22 |
| 5 | Out, set the five valves (op1 or op2, one mesbox each), back to the cave | | ~120 tiles, 5 interactions | 72 |
| 6 | Raft to the end of the sewer, run to Alomone | | 1 raft, ~22 tiles | 15 |
| 7 | Alomone: 5 pages, then the fight (combat level 13, `quest_hazeelcult.npc:169-175`; trivial at 70 melee); take the armour (`alomone.rs2:115-123`) | 4 → 6 | 5 pages, fight, pickup | 25 |
| 8 | Raft back, out, run to the mansion, upstairs | | ~50 tiles, 2 climbs | 35 |
| 9 | Ceril upstairs: hand the armour over; Jones is cleared and you are paid 5 gold (a "fake" completion, `ceril_carnillean.rs2:108-139`) | 6 → 7 | ~14 pages | 15 |
| 10 | Open and search the cupboard: poison and amulet, Jones arrested, completion (`quest_hazeelcult.rs2:84-122`) | 7 → 9 | ~27 pages, 2 interactions | 32 |
| | **Total** | | ~99 clicks, ~340 tiles | **~320-330** |

Columns: about **430 stock** (+1 per click and reaction), **325 fixed**, **270 burst**
(most pages are long pure-continue runs). All inferred. The dialogue alone is about 100
clicks; the travel alone about 180 ticks.

## Marginal value

| Basis | Ticks saved | Source |
|---|---|---|
| Given Fight Arena + Biohazard (the planned route) | **~130** (1,852 → 1,721) | rs/2 `thieving.md` section 2 totals table, model, rs/2 branch at 0e184ef2 |
| With Tribal Totem too | ~270 for both together | same table (1,852 → 1,583) |

Even together with Tribal Totem (about 300 ticks fixed, `tribal_totem.md`), the pair costs
about 625 ticks against 270.

## Risks and gotchas

- Logout-safe: `%hazeelcultquest`, `%hazeelcult_valves` and `%hazeelcult_side` are all
  `scope=perm` (`quest_hazeelcult.varp`).
- On the good side, talking to the cultists in the hideout makes them attack
  (`hazeel_cultist.rs2:12-19`).

## Open questions

None that affect the verdict. Revisit only if a Thieving pick elsewhere (Tourist Trap,
Legends) is dropped and Thieving starts much lower, which raises the value of early xp.
