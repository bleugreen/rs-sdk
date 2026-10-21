# The Dig Site

**Verdict: about 2,180 ticks on the stock client (about 1,930 with the client fix,
about 1,790 with dialogue bursts), for 15,300 Mining and 2,000 Herblore base.** The
Mining reward saves about 1,610 ticks of training (cairn://p/rs/2's `mining.md`: 4,034
-> 2,422 ticks after Doric's Quest, demo respawn). So Digsite loses about 180-570 ticks
as xp, and comes out about even only with bursts plus chained-click walking (about 95
ticks less travel). Do it only if its 2 quest points are needed, or if Mining is not
being trained at all. Three random finds make up a quarter of the time and have a long
tail: one measured run spent 1,207 ticks on the dig alone.

The quest was played start to finish on the lab server, twice, by
`docs/speedrun/scripts/quest-digsite-run.ts` at the production tick rate
(`NODE_TICKRATE=300`), with the stock lite client and `bot.walkTo`. The random finds
were also measured per attempt by `quest-digsite-finds.ts`. Tile counts come from
`quest-digsite-touristtrap-paths.ts`. Every script runs inside one lab session:

```sh
NODE_TICKRATE=300 BOTS=dig16 docs/speedrun/scripts/quest-digsite-lab-session.sh \
    bun docs/speedrun/scripts/quest-digsite-run.ts dig16 [cave]
```

(`quest-digsite-lab-session.sh` starts the engine, gateway and a headless client on
this child's port block and tears them down afterwards; `cave` starts at the mine shaft
permit.)

## Reward

- **15,300 Mining base**: `stat_advance(mining, 153000)` (read,
  `quest_itexam/scripts/quest_itexam.rs2:41`; tenths, so 15,300 xp, times 25 in game).
  Measured: the `cave` run gained exactly 382,500 game Mining xp at the hand-in.
- **2,000 Herblore base**: `stat_advance(herblore, 20000)` (read, `quest_itexam.rs2:42`).
- 2 gold bars (`quest_itexam.rs2:43`), 2 quest points (`general/configs/quest.constant:105`).
- Small xp on the way (read): 2 Mining and 2 Fishing base per pan
  (`area_digsite.rs2:27-28`), 8 Mining per level 3 dig (`:437`), 10.4 Thieving per
  successful pickpocket (`digsite_workman.rs2:85`), 2.5 Herblore per mix
  (`itexam_chemistry.rs2:35,49,68`), 2 Agility per winch descent (`area_digsite.rs2:624,677`).

**For cairn://p/rs/2's Mining question:** the quest gives exactly 15,300 base Mining
(level 85 alone, 86 after Doric) for about 2,180 ticks of playtime, of which none is
mining. It is the only large Mining quest reward in this content. rs/2 has since found
that the demo's top Mining account (nickquarry) did not do Digsite (`mining.md`
section 4a), so it doesn't explain that account.

## Requirements as enforced by this server

All three are checked with `stat()`, the boosted level, so a boost passes them. The
wiki lists the same three; this server enforces all of them and nothing else.

- **Thieving 25** to pickpocket a workman (`digsite_workman.rs2:62`). The pickpocket
  is the only source of Rock sample 1 and of a specimen brush.
- **Herblore 10** for the two later mixing steps (`itexam_chemistry.rs2:21,41,55`).
- **Agility 10** to climb down either winch (`area_digsite.rs2:617,670`).
- No quest or quest-point requirement.
- Every quest item is untradeable (`tradeable=no` throughout `quest_itexam.obj`): the
  samples, brush, jar, tray, trowel, talisman, letters, key, chemicals, root and
  tablet. The scored account has to find each one itself.

## Helper-supplied items (one trade, 9 ticks)

| Item | Qty | Why |
|---|---|---|
| Cup of tea | 1 | the panning guide's errand (`panning_guide.rs2:21-25`) |
| Opal (cut) | 1 | student 2's third-exam errand (`student3.rs2:96-103`) |
| Rope | 2 | one per winch (`area_digsite.rs2:598,653`) |
| Vial (empty) | 1 | nitroglycerin from the barrel (`area_digsite.rs2:820-824`) |
| Charcoal | 1 | ground into the compound (`itexam_chemistry.rs2:70-73`) |
| Pestle and mortar | 1 | grinding the charcoal |
| Tinderbox | 1 | lighting the compound (`area_digsite.rs2:723`) |
| 1 law, 3 air, 1 fire rune | | Varrock teleport (Magic 25) for the museum trip |

All are ordinary items with no `tradeable=no` flag (read). Leather gloves and boots
are checked only at the level 1 dig sites (`area_digsite.rs2:258-276`), which this route
never uses. There is no teleport near the Digsite
(the Varrock teleport landing is 195 route tiles from the examiner).

## Mechanics that shape the route (read)

- **Delivering the stamped letter starts the first exam at once**
  (`examiner.rs2:72-77`). The student errands are gated on stage 2 (`student1.rs2:5`,
  `student2.rs2:5`, `student3.rs2:5`), so one failed exam is unavoidable: 3 answer clicks
  and 18 pages.
- **A rock sample can be used on its student** (`student1.rs2:11-18`,
  `student2.rs2:11-18`, `student3.rs2:11-17`), which completes the errand without its
  start dialogue.
- **Each exam needs fresh notes.** Passing an exam resets all three errands
  (`quest_itexam.rs2:10-13`), and each student's notes for the next exam are stage-gated.
  So the examiner (south) to students (north) walk happens six times, about 60 ticks each.
- **The three random finds** (each ends the moment the item appears):
  - pickpocket: success `stat_random(thieving, 100, 240)` (`digsite_workman.rs2:67`);
    on a success, Rock sample 1 with chance 3/11 and a specimen brush with 3/11
    (`:87-115`). Both are needed: 5.5 successes expected. A failure stuns for 8 ticks
    (`:79-80`), and a click during the stun is silently dropped.
  - panning: Rock sample 2 with chance 3/40 per pan (`area_digsite.rs2:43-48`).
  - level 3 dig: the Talisman of Zaros with chance 1/20 per dig
    (`area_digsite.rs2:442-450`).
- `stat_random(stat, low, high)` succeeds with probability
  (⌊low(99-L)/98⌋ + ⌊high(L-1)/98⌋ + 1)/256 at current level L
  (`server/engine/src/engine/script/handlers/PlayerOps.ts:591-600`). For the pickpocket
  that is 52% at Thieving 25, 69% at 55 and 94% at 99.

## Step list

Start at the examiner (3361,3340), in the Exam Centre south of the dig. Quest varp
`%itexamlevel` (stage in bits 0-3), errands in `%itexam_errands`, flags in `%itexam_bits`
(all `scope=perm`, `quest_itexam.varp`). Ticks are **measured** (run 2 of
`quest-digsite-run.ts`, 300 ms ticks, stock client). "Runs" is the dialogue shape for
the burst column (CONVENTIONS.md, "Dialogue: three columns"): `Nc` is a run of N
continues, `opt` an option, `|` a new dialogue. Burst ticks charge ceil(N/5) per run and 1
per option, and don't separately cost state-changing pages, so they are a lower bound.

| # | Step (where; choices; varp) | Ticks | Pages + options | Runs | Burst | Clicks |
|---|---|---|---|---|---|---|
| 1 | Examiner (3360,3343): "Can I take an exam?" -> stage 1, unstamped letter | 30 | 11 + 1 | `6c,opt,5c` | 4 | 1 |
| - | Varrock teleport (helper runes) to (3213,3424) | 4 (primitives) | | | | 1 |
| 2 | Walk to the curator in the museum (3255,3445), 49 tiles | 27 | | | | |
| 3 | Curator: stamps the letter (no choice) | 19 | 6 + 0 | `6c` | 2 | 1 |
| 4 | Walk back to the examiner, 195 tiles | 120 | | | | |
| 5 | Examiner: hand in the letter -> stage 2, forced first exam, any answers (fails) | 44 | 18 + 3 | `6c,opt,3c,opt,3c,opt,6c` | 9 | 1 |
| 6 | Bush (3357,3372), Search: Rock sample 3 | 38 | 2 + 0 | `2c` | 1 | 1 |
| 7 | Panning tray off the ground near (3369,3378) | 17 | | | | 1 |
| 8 | Panning guide (3376,3377): talk with the tea -> tea bit (no choice) | 23 | 8 + 0 | `8c` | 2 | 1 |
| 9 | Pan at a panning point (3376,3372), search the tray; repeat until Rock sample 2 | **random**: 33 (2 pans) | 2 per pan | `1c` per pan | | 2 per pan |
| 10 | Pickpocket workmen until Rock sample 1 and a brush | **random**: 103 (9 tries) | | | | 1 per try |
| 11 | Sacks (3359,3398), Search: specimen jar | 12 | 2 + 0 | `2c` | 1 | 1 |
| 12 | Use each sample on its student (sample 1 on student1, 2 on student3, 3 on student2) -> 3 errands done | 81 | 12 + 0 | `4c \| 4c \| 4c` | 3 | 3 |
| 13 | Walk to the examiner | 60 | | | | |
| 14 | Exam 1: "Yes, I certainly am.", "The study of the earth, its contents, and history.", "All that have passed the appropriate Earth Sciences exam.", "Gloves and boots to be worn at all times; proper tools must be used." -> stage 3, trowel | 46 | 17 + 4 | `2c,opt,3c,opt,3c,opt,3c,opt,6c` | 10 | 1 |
| 15 | Walk to the barrels (3364,3378) | 64 | | | | |
| 16 | Trowel on a barrel (opens it, bit 4), vial on it: unidentified liquid | 8 | 2 + 0 | `1c \| 1c` | 2 | 2 |
| 17 | Walk to the students | 27 | | | | |
| 18 | Talk to student1, student3, student2 (notes, no choices) | 49 | 16 + 0 | `5c \| 6c \| 5c` | 4 | 3 |
| 19 | Walk to the examiner | 71 | | | | |
| 20 | Exam 2: "I am ready for the next exam.", "Samples taken in rough form; kept only in sealed containers.", "Finds must be carefully handled, and gloves worn.", "Always handle with care; strike cleanly on its cleaving point." -> stage 4 | 50 | 17 + 4 | `2c,opt,3c,opt,3c,opt,3c,opt,6c` | 10 | 1 |
| 21 | Walk to the students | 53 | | | | |
| 22 | Talk to student1, student3, then student2 twice (errand, then the opal) | 79 | 27 + 0 | `5c \| 6c \| 10c \| 6c` | 7 | 4 |
| 23 | Walk to the examiner | 63 | | | | |
| 24 | Exam 3: "I am ready for the last exam...", "Samples cleaned, and carried only in specimen jars.", "Brush carefully and slowly using short strokes.", "Handle bones very carefully and keep them away from other samples." -> stage 5 | 50 | 19 + 4 | `2c,opt,3c,opt,3c,opt,3c,opt,8c` | 10 | 1 |
| 25 | Walk to the level 3 site (x 3350-3357, z 3404-3412) | 54 | | | | |
| 26 | Trowel on soil until the Talisman of Zaros (jar and brush carried; drop the junk) | **random**: 190 (run 1, 22 digs); 1,207 (run 2, about 90 digs) | | | | 1 per dig, plus drops |
| 27 | Walk to the expert (3355,3333) | 61 | | | | |
| 28 | Expert: use the talisman (-> bit 7, invitation letter), use the liquid (-> nitroglycerin) | 35 | 14 + 0 | `10c \| 4c` | 3 | 2 |
| 29 | Walk to a workman | 50 | | | | |
| 30 | Invitation letter on a workman -> stage 6 | 8 | 2 + 0 | `2c` | 1 | 1 |
| 31 | Walk to the private winch (3370,3428) | 32 | | | | |
| 32 | Rope on the winch (bit 3), Operate: down to (3353,9818) | 5 | | | | 2 |
| 33 | Workman 2 (3352,9821): "I have been invited to research here.", "Do you know where to find a chest key?", "I don't suppose I could use it?", "Please?", "Aww... go on.", "Pretty please!", "Pretty please with sugar on top!" -> chest key | 53 | 18 + 7 | `2c,opt` x6, `3c,opt,3c` | 15 | 1 |
| 34 | Pick up an Arcenia root (ground spawn, (3348,9819) or (3351,9824)) | 7 | | | | 1 |
| 35 | Climb the rope (3353,9817) to (3370,3427) | 3 | | | | 1 |
| 36 | Walk to the chest (3374,3378) | 26 | | | | |
| 37 | Key on the chest (opens for 300 ticks), Search: chemical powder | 8 | 1 + 0 | `1c` | 1 | 2 |
| 38 | Walk to the expert | 48 | | | | |
| 39 | Expert: use the powder -> ammonium nitrate | 6 | 2 + 0 | `2c` | 1 | 1 |
| 40 | Mix: nitroglycerin on nitrate, pestle on charcoal, ground charcoal on the mixture, root on the mixture -> compound | 14 | 3 + 0 | `3c` | 1 | 4 |
| 41 | Walk to the public winch (3352,3417) | 57 | | | | |
| 42 | Rope on the winch (bit 2), Operate: down to (3370,9828) | 5 | | | | 2 |
| 43 | Stand on (3379,9826); compound on the bricks (3379,9825) -> stage 7; tinderbox on them: scripted run and blast -> stage 8, moved to (3368,9767) | 28 | 3 + 0 | `1c \| 2c` | 2 | 2 |
| 44 | Pick up the stone tablet (3374,9747), among level 25 skeletons | 18 | | | | 1 |
| 45 | Climb the rope (3370,9763) to (3354,3417) | 14 | | | | 1 |
| 46 | Walk to the expert | 56 | | | | |
| 47 | Tablet on the expert -> quest complete | 18 | 8 + 0 | `8c` | 2 | 1 |

## The random finds

Per attempt (**measured**, `quest-digsite-finds.ts dig16 2`, 300 ms ticks, stock client,
with the bot reacting the moment each result shows):

| Find | Ticks per attempt | Success per attempt (read) | Attempts (geometric) | Ticks: mean |
|---|---|---|---|---|
| Pickpocket (Thieving 25) | 11.6 mean (n=27): about 4.5 on a success, about 12.5 on a failure (2 + the 8-tick stun) | 52% (read); 48% measured over 46 tries | 5.5 successes, so about 11 tries | about 130 |
| Pan and search the tray | 19.3 mean (n=33) | 3/40 | 13.3 mean, 9 median, 30 at p90 | about 250 |
| Level 3 dig, with junk drops | 10.8 mean (n=27); 8.6 in run 1 including drops | 1/20 | 20 mean, 14 median, 45 at p90 | about 180-190 |

**All three together (inferred, 200,000 simulated quests using the measured per-attempt
ticks): mean 523 ticks, median 458, p90 934, p99 1,525.** The two playthroughs drew 340
(run 1) and 1,343 (run 2) ticks of finds. Run 2's dig needed about 90 digs: 18,000 game
Mining xp from digs at 200 each, against an expected 20 (a 1-in-100 draw). Higher Thieving
shortens the pickpocket: at 55, 8 tries instead of 11, saving about 40 ticks.

## Tick total

The two runs differ only in their random finds. Without them they took 1,628 and 1,650
ticks (**measured**), so the fixed part is about 1,640. The breakdown below uses run 2's
raw counts.

| Part | Stock client | Fixed client (rs/22) | Burst | Basis |
|---|---|---|---|---|
| Travel: 16 walks, `bot.walkTo` | 869 | 869 | 869 | measured; chained clicks would save about 11% (`primitives.md` §2) |
| Dialogue: 216 pages + 23 options | 478 | 239 | 98 | counts measured; 2 / 1 / burst per CONVENTIONS.md |
| Interactions and `p_delay` waits (no fights) | 293 | 293 or less | 293 or less | measured, by subtraction (1,640 - 869 - 478) |
| Random finds | 523 (p90 934) | about 520 | about 520 | inferred, model above |
| Varrock teleport cast | 4 | 4 | 4 | measured, `primitives.md` §4 |
| Helper trade | 9 | 5 | 5 | measured, `primitives.md` §6 |
| **Total** | **about 2,180** (p90 about 2,600) | **about 1,930** | **about 1,790** | |

The fixed-client column only removes the dialogue tick. The fix also saves a reaction tick
on every loc and item click (about 80), so treat that column as an upper bound. Not
included: getting to the examiner at the start (from Varrock it is another teleport plus
195 tiles, about 104 ticks). The base xp per tick is 17,300 / 2,180 = 7.9 on the stock client.

## Risks and gotchas

- **The talisman's tail** is the main risk: p99 for the finds is about 1,500 ticks, and
  one of two measured runs spent 1,207 ticks digging.
- **Pickpocket stun**: a click inside the 8-tick stun is dropped without a message, so
  the bot must wait out the stun. Each failure also deals 1 damage.
- **Inventory**: every dig and most pans add junk, so drop it as you go (counted in the
  dig figure). The level 3 dig refuses with a full inventory (`area_digsite.rs2:414`).
- **Skeletons** (level 25, 17 hp) in the altar cave: they hit the bot for 1-5 hp per run
  (measured; HP ended at 94 and 98 of 99). They're no danger at the stats this route has.
- **Don't drop the chemicals**: each one explodes for 25-65 damage (`area_digsite.rs2:830-893`).
- **Level-up dialogues** (Thieving, Mining, Herblore) appear as pages and are in the counts.
- **Logout**: all three quest varps are `scope=perm`, and none of the 16 temporary quest
  varps (`primitives.md` §8) belong to Digsite, so the quest is logout-safe throughout
  with one exception. **Don't log out between unlocking the chest and taking the powder.**
  The key is consumed (`area_digsite.rs2:784`) and the chest relocks after 300 ticks
  (`:787`), so a new key means going back down for the workman's 7-option begging scene.
- Clicking a loc from about 37 tiles away (the barrels from the Exam Centre) got "I can't
  reach that!" three times; walking closer first fixed it. Count the walk.

## Open questions

- The Herblore reward (2,000 base) has no training rate to weigh against yet; Herblore
  is helper-fed, so it is probably worth little playtime (inferred).
- The route here never uses a fixed-client or burst bot. Those columns are computed
  from the stock run's counts, not measured.
