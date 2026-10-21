# Level-up pages: which totals already pay for them, and what they cost in the loops

For rs/103's per-step overhead model (`docs/speedrun/RUN-ORDER.md`), which replaces the tally's lump
line "banking, trades, travel, logins, level-ups". The run account is called SCORED.

**Answer.** A level-up costs **nothing measurable** in any of the route's training loops, provided
the loop answers the page on the label after the leveling action. That label is the state that
first shows the page, so the answer lands on the next tick. Answering means sending a continue, a
blind burst of continues, or the loop's own next op. Measured at 300 ms on the local engine:

- knife willow and oak: 0;
- knife iron: 0;
- knife fly fishing: about 0, 0.05 ± 0.10 rolls per level-up over six runs;
- plain 4-tick willow: 0;
- Wilderness laps: 0;
- enchanting: 0;
- the Runecraft 7-tick cycle: 0.

Not answering costs one full gathering cycle per level-up: **3 ticks** on knife oak (18 of 18) and
about one roll on willow and fly fishing. Two models charge level-ups a cost that was never
measured: Woodcutting at 1 tick each and Mining at 0.5. Those models are pessimistic by about 60
and 20 ticks. Of the level-up pages on the route, only about 15 quest reward pages and the 12 Gnome
course level-ups sit outside every quoted total. They cost about **15-30 ticks** in all
(inferred). So level-ups do not justify a lump allowance in the overhead model. The one thing to
build is the next-label answer in rs/97's in-page knife programs (section 4).

The brief's figure of "5 ticks per level-up" in Woodcutting came from a bot that waited to *see*
the new level before acting (woodcutting.md section 6 measured 3.4-4.4 that way). It is not a
property of the game.

## 1. Mechanism (read)

- **One page per xp drop, not per level.** `addXp` queues one `[advancestat,<stat>]` script on
  the engine queue for each call that raises the base level, however many levels that call
  crosses (`server/engine/src/engine/entity/Player.ts`, `addXp`). The page shows the final level
  (`levelup.rs2:29,53`). A quest reward that takes Strength from 1 to 98 is therefore one page.
  Monkey Madness's reward is about 3 pages, not the ~240 that the per-level reading in
  `herblore.md` section 4 would give. That reading ("a queued p_pausebutton script per level
  gained") is wrong; it should say per xp drop that gains a level.
- **Unlock pages.** A level listed in `levelup_unlocks.enum` shows one more page after the
  level-up box (`levelup.rs2:56-59`; every case in `levelup_unlocks_<skill>.rs2` is a single
  objbox or mesbox). Measured: every unlock level showed exactly 2 pages under the watcher, and
  every plain level 1 page (all runs in section 2).
- **When it opens, and what it blocks.** The engine queue runs in the player phase after that
  tick's client packets and before interactions (`World.ts` `processPlayers`). It runs only while
  the player `canAccess()` (`Player.ts` `processEngineQueue`), so queued level-ups pop **one per
  tick**, each once the previous page is closed. A roll on server tick R opens the page on R+1. It
  blocks R+1's interaction, but not R+1's packets, which were decoded first. While a modal is
  open and anything is queued, the player cannot walk either (`Player.ts` `updateMovement`).
- **Two ways to close it.**
  - **A continue** (RESUME_PAUSEBUTTON) resumes the script. A plain page closes; an unlock level
    opens the unlock page and needs a second continue.
  - **Any op that calls `clearPendingAction`** closes the modal and drops the paused script, so
    the unlock page never shows (`Player.ts` `closeModal`: PAUSEBUTTON scripts are nulled). That
    covers OPLOC, OPNPC, OPHELD, OPHELDU and OPHELDT (`interleaving.md` section 1). A walk does
    not, and neither does an IF_BUTTON such as Charge.
- **Consequence for a loop.** The page is first visible on label R+1, so an answer sent then
  lands on R+2. A loop whose next roll or step needs the interaction on R+2 or later loses
  nothing. Every knife loop rolls on R+3, the 4-tick plain loops on R+4, and enchants are 3
  ticks apart. A loop that answers on R+3 or later loses the roll, or the step, on that tick.

## 2. Measured cost per level-up, by loop

All at `NODE_TICKRATE=300` on the local engine with the headless lite client. The latency probe
read 60 of 60 reactions at 1 tick, with publications 298-303 ms apart
(`tickmanip-latency.ts`). Host: fedora (bginf-halo, 32 cores) on 2026-10-21. Load was 0.7-3
for most runs and spiked to 30-60 from other workloads during a few, noted per row. The lab is
`docs/speedrun/scripts/levelup-lab.sh` on port block 9640/9641/9642/44640/8640. Level-ups are
natural, from a low start level, and dismissed by one of these policies
(`docs/speedrun/scripts/levelup-dismiss.ts`):

| Policy | What is sent, on the label the page first shows |
|---|---|
| watcher | `speedrun/lib/levelup.ts` `startLevelUpWatcher`: one read-then-act continue per page, chained over the unlock page |
| burst | `pagesAt(level)` blind continues at once (rs/51), page count from `levelup_unlocks.enum` |
| click | the loop's own target click again (closes the modal and drops the unlock page) |
| none | nothing; the loop's next scheduled op closes it |

"Rolls lost per level-up" takes each counted gap that starts on a leveling drop and compares
its gap/cycle rolls with the 1/p rolls expected at the read catch chance p. Gaps that start on any
other drop are the control, which should read 0 (`tickmanip-cycle.ts` summary, "rolls lost").
"Close" is the label on which the page was gone, relative to the label that showed the new
level.

| Loop (script, sample) | Policy | Close label | Rolls lost per level-up (control) | Ticks per level-up |
|---|---|---|---|---|
| **Knife oak, Taverley tile, 55 -> 75** (`tickmanip-cycle.ts --mode=oak-knife`, 20 level-ups per run; read success 95-100%, so gaps are exact) | watcher | +2 (18), unlock +3 | 0.00 ± 0.02 (0.00); all 18 gaps 3 | **0** (measured) |
| | click | +2 | -0.01 ± 0.02; all 18 gaps 3 | **0** (measured) |
| | none (load 31) | +4 | **0.99 ± 0.02**; all 18 gaps 6 | **3** (measured) |
| **Knife willow, Draynor, 30 -> 70** (`--mode=wc-knife`, 34 level-ups per run) | watcher | +2 (31), unlock +3 | -0.48 ± 0.30 (0.00 ± 0.23) | 0 (measured, within noise) |
| | burst | +2, unlock +2 | -0.19 ± 0.29 (-0.13) | 0 (measured, within noise) |
| | click | +2, unlock +2 | -0.44 ± 0.28 (+0.17) | 0 (measured, within noise) |
| | none | +4 (23 of 31) | **+0.61 ± 0.30** (+0.01) | about 2 (measured) |
| **Plain 4-tick willow, 30 -> 60** (`--mode=wc-base`, 24 level-ups; load 41) | watcher | +2 | -0.21 ± 0.40 (-0.60), cycle 4 | 0 (measured, within noise) |
| **Knife fly fishing, Lumbridge, 40 -> 65** (`--mode=flylumb-knife`, 24 level-ups per run, 4 unlock) | watcher, 3 runs | +2, unlock +3 | +0.69, +0.33, -0.17 (each ± 0.24); pooled **0.28 ± 0.14** (controls -0.07, -0.11, -0.02) | about 0.8 (measured, 2 standard errors from 0) |
| | burst, 2 runs | +2, unlock +2 | -0.43, -0.01; pooled -0.22 ± 0.17 (+0.29, +0.01) | 0 (measured) |
| | click | +2, unlock +2 | -0.10 ± 0.24 (+0.02) | 0 (measured) |
| | none | +4 | **+1.11 ± 0.24** (-0.11) | about 3.3 (measured) |
| **Knife iron, zoo cluster, respawn 19 rotation, 63 -> 76** (`tickmanip-mine.ts --starter=knife`, 150 ores and 13 level-ups per run; every roll succeeds) | watcher | +2 | 0 slips; level-up gaps 3:12 6:1 (run 3:119 6:25) | **0** (measured) |
| | burst | +2 | 0 slips; 3:12 6:1 | **0** (measured) |
| | none | +2 (11 of 12) | 0 slips; 3:11 6:2 | **0** (measured): the move's scheduled rock click lands on R+2 and closes the page |
| | click | +2 (10), 4, 17 | **1 slip** (21-tick gap); 3:10 6:2 | 0 to 1.4: the re-click re-paths the bot; do not use it in a rotation |
| **Wilderness Agility course, 60 -> 76** (`agility-course.ts wilderness 10 60`, 13 level-ups per run, all at the lap bonus) | burst | +1 | clean laps 66 (9 of 9), the same as the level-99 lap with no level-ups (`agility.md` section 2); pipe after a level-up 17 ticks (9 of 9) | **0** (measured) |
| | watcher | +1 | clean laps 66 (7 of 9; the other two had falls); pipe after a level-up 17 (9 of 9), log after a level-up 17 (2) = log otherwise 17 | **0** (measured) |
| **Enchanting, 1 cast click per tick** (`magic-cadence.ts sapphire,emerald,ruby,diamond 27 1`, 104 casts, 60 level-ups: 21, 20, 11, 8) | none (OPHELDT closes the page) | | every gap 3 (26 of 26 per spell) | **0** (measured; agrees with `magic.md` section 4) |
| **Runecraft tuned 7-tick cycle, air altar from level 1** (`runecraft-cycle.ts --mode=tuned --altar=air --level=1`, 12 crafts, each a level-up) | the T+5 trade click closes it | | 10 of 11 gaps 7; one 31 (a missed trade at load 59) | **0** (measured; agrees with `runecraft.md` section 4, 8 of 8 at air 1) |

Notes on the table:

- The fishing watcher's pooled +0.28 rolls sits about 2 standard errors above both zero and the
  blind burst. Its pages closed on the same labels as the burst's (+2 on all 60 plain levels). It
  differs only on the 9 unlock levels, which close one label later (+3), so the explanation is
  more likely noise or host load than mechanism. Across all six answering runs (watcher, burst,
  click) the pooled loss is **0.05 ± 0.10 rolls per level-up**. That matches `fishing.md`
  section 6's "about half a tick, within the noise" for 38 level-ups. For fishing, prefer the
  burst or the re-click, which close the unlock page on +2.
- The first fly-fishing watcher run (`tickmanip-flylumb-knife-lv-watcher`) stalled at level 51.
  The bot froze for about 9 ticks at load 30 and the engine logged it out as idle 500 ticks
  later. Its first 9 level-ups behaved like the rows above. It is not in the table.
- **Gem cutting and potion mixing** were not re-measured: both `delayfree-cycle.ts` runs timed out
  in setup. Neither loop needs a dismissal, because each OPHELDU closes the page (`crafting.md`
  and `herblore.md` section 4). The cost appears only as a backlog at the bank visit: up to 5
  actions per tick can each queue a level-up, the queue pops one per tick, and every pending
  page holds the booth click for a tick. Inferred from those documents' measured end-to-end
  runs: Herblore 28 -> 99 averaged 6.24 ticks per cycle against 5.07 from 66 (no early levels),
  so about 21 ticks over 18 cycles for 62 level-ups, **about 0.3 ticks per level-up**. Crafting
  42 -> 99 averaged 9.3 against 8.2 from 55, about 12 ticks for 55 level-ups, **about 0.2**.
  Both are already inside their measured totals. `delayfree-cycle.ts` now also prints queued
  level-up scripts and the booth wait above its floor, for the next run.
- The figures are direct-path figures (1-tick reactions). Through the SDK relay, an answer that
  arrives one tick late misses R+2 and lands on R+3, the knife roll tick. A continue landing in
  R+3's packet phase still clears the page before the interaction, so the roll survives
  (inferred from the tick order in section 1). The watcher's unlock chain already relies on
  this. An answer two ticks late costs the roll.

## 3. Audit: which quoted totals already pay for their level-ups

Totals as quoted in `docs/speedrun/skills/README.md` and the documents named. "Level-ups" counts
level-up scripts, one per leveling xp drop (`levelup-count.ts`, from each document's per-action
xp; unlock pages in brackets). The quest rows come from a read of every on-route quest
document.

| Skill or quest | Quoted total (source) | Level-ups | Basis of the total | Level-ups inside it? |
|---|---|---|---|---|
| Agility 75-99 | about 4,024 (`agility.md` sections 1-2, `agility-model.ts --lap=66`) | 24 (0) | modelled from a lap measured at level 99, which has no level-ups | **No allowance, and none needed**: measured 0 (section 2) |
| Agility 1-22, Gnome course | 122 (`agility.md` section 1) | 12 (1) | inferred from 100 ms laps at 99 | no; at most about 1 tick each (inferred) |
| Mining 49/64-99 | 3,360 knife from 49, 3,134 from 64 (`mining.md` section 2) | 50 (4) from 49; 35 (2) from 64 | modelled, **0.5 ticks per level-up** (`mining.md` sections 2 and 6, from Fishing's knife figure) | yes, 18-25 ticks charged; measured 0, so the model is **pessimistic by 18-25** |
| Woodcutting 1-99 | 3,958 plain, 3,028 knife (`woodcutting.md` section 2) | 77 (6) | modelled, **1 tick per level-up** (`woodcutting.md` sections 2 and 6, inferred), knife column x0.765 | yes, about 77 plain and about 59 knife; measured 0, so **pessimistic by about 59** on the knife route |
| Fishing 78-99 | about 2,000 knife (2,032 and 1,978), 3,410 plain (`fishing.md` sections 1-2) | 21 (2) | **measured end to end** (`tickmanip-cycle.ts --dismiss=now`, two runs; `fishing-rate.ts`) | yes, as measured (knife about 0.5 each, plain 1.3 each) |
| Thieving 57-99 | 1,950-2,000 (`thieving.md` section 1) | 42 (6) | 55 -> 99 **measured end to end**; the 57 start from the model | yes (`thieving.md` section 4: cost nothing measurable, 44 level-ups) |
| Firemaking 1-99 | about 650 (`firemaking.md`) | 64 per run (read there) | **measured end to end** | yes (`firemaking.md` section 4: dismissed in the same tick as the next light, gaps 4) |
| Smithing 1-99 | 1,147 (`smithing.md`) | 58 (48) | **measured end to end** | yes (`smithing.md` section 4: make-5 not interrupted) |
| Prayer | 1,151; measured run 1,221 (`prayer.md`) | 67 over 1-99 (read there); 11 in S10 | measured cadence | yes (dismissed in the same tick as the next Bury, `prayer.md` section 6) |
| Runecraft 1-44, 44-99 | about 1,330 (`runecraft.md` section 2) | 7 (1), 46 (1) | 7-tick cycle **measured with level-ups** (air 1, nature 44, law 54); totals = crafts x 7 | yes, at the measured cost of 0 (section 2) |
| Magic: enchant 7-59 | part of about 245 (`magic.md`) | 42 (23) | measured cadences, inferred timeline | yes, at 0: OPHELDT closes the page (`magic.md` section 4; section 2 above) |
| Magic: Wind Strike 1-7 | part of about 245 | 5 (2) | measured cadence (`magic-strike.ts`) | partly: Wind Strike does not close pages, so the script dismisses them (`magic.md` section 6); at most about 1 tick each |
| Magic: Charge 80-99 | about 33 standalone, rides stuns (`magic.md`) | 19 (0) | measured (`mage_arena.md`: Charge measurement with level-up boxes in it) | yes standalone; **unmeasured inside stuns** (`magic.md`: "unmeasured for Charge itself") |
| Crafting 42-99 | 101 (`crafting.md` section 1) | 55 (23) | **measured end to end** (bbs, 1 run) | yes, about 0.2 each at the bank visit (section 2) |
| Herblore 28-99 | 112 (`herblore.md` section 1) | 62 (17) | **measured end to end** (bbs, 1 run) | yes, about 0.3 each at the bank visit |
| Fletching 1-99 | 50 standalone, rides stuns (`fletching.md`) | 72 (15) | measured standalone | yes standalone (OPHELDU closes it); **unmeasured inside stuns** |
| Cooking (wine) | 45-51 active (`cooking.md` section 2) | many per firing | measured by rs/47 (3 runs) | yes ("dismiss the level-up 5" is in the timeline) |
| Ranged, Defence, Hitpoints (cannon sessions) | 1,970 (`ranged.md`, `combat.md`) | about 49 (S14) and about 48 (S27) | measured rates (rs/31, rs/91), inferred totals | yes, inside the measured rates (`combat.md` section 6: cost nothing visible; `ranged.md` section 6: the cannon keeps firing) |
| Doric's Quest | 60-90 (`quests/dorics_quest.md`) | 1 reward page | measured end to end | yes, counted (line 18, 45) |
| Plague City | 564-737 (`plague_city.md`) | 1 reward page | measured segments | yes, counted (line 35, 118) |
| Tree Gnome Village | README 842-1,005 (`quests/README.md`) | warlord 15-23 at route levels; 1 reward page | measured (route-level fight from `pre_mm_fights.md`) | yes (`tree_gnome_village.md:170-171`; `pre_mm_fights.md:159-161`) |
| The Grand Tree | README 1,441-1,846 | black demon 10-12 at route levels; 3 reward pages (Agility, Attack, Magic) | measured full run plus route-level fight | fight yes; **reward pages not counted** |
| Fight Arena | README 598-720, route chain 281 measured | several Attack level-ups in the chain; 2 reward pages (Attack, Thieving) | measured run | chain yes (`fight_arena.md:134-136`); reward pages unclear |
| Dwarf Cannon | 918-1,078 (`dwarf_cannon.md`) | 1 reward page (Crafting) | measured end to end | not mentioned; at most 1 tick |
| Monkey Madness | 3,546-4,431 success (`monkey_madness.md`) | demon 3-4 (Ranged); 3 reward pages | summed segments | fight yes (line 258); **reward pages not counted** |
| Mage Arena | 540-606 (`mage_arena.md`) | Kolodion 3 per run | measured legs | yes (line 262) |
| Sea Slug | 340-495 (`sea_slug.md`) | 1 reward page | measured end to end | yes, counted (line 91) |
| Fishing Contest | 200-276 (`fishing_contest.md`) | 1 reward page | measured end to end | unclear; at most 1 tick |
| Cook's Assistant, Goblin Diplomacy, Druidic Ritual | modelled (`quest_points.md`) | 1 reward page each (Cooking 30 adds an unlock page) | modelled | **no** |
| Romeo & Juliet | modelled | none | modelled | n/a |
| Dragon Slayer | 925-1,120 (`dragon_slayer.md`) | Elvarg 1 at route levels; 2 reward pages (Strength, Defence) | partly measured | fight yes (line 176); **reward pages not counted** |

Two corrections to the brief's premise. Crafting (101) and Herblore (112) are measured end to
end, not fixed-level models, so their level-ups are inside. The Runecraft cycle was measured with
a level-up on every craft, so its modelled total is built on a cycle that already includes them.

**A quest reward page** costs about 1 tick (inferred). Pending pages pop one per tick and block
walking while any is queued (section 1), and a page costs 1 tick at the fixed-client floor
(`quests/primitives.md` section 2). If the next action is an op click, the click closes the first
page, but the next queued page still opens that tick. An unlock level adds one page if answered by
continue, none if answered by an op.

## 4. Level-up overhead per run step (order v1)

"Inside" is what the step's quoted total already charges for its level-ups. "Not inside" is the
expected cost at the run's policy (answer on the next label, section 5) that no quoted total
carries. Unlabelled counts come from `levelup-count.ts`. Ticks are at the measured 0 per level-up
unless a row says otherwise.

| Step | Level-ups | Inside the quoted total | Not inside (expected) | Basis of "not inside" |
|---|---|---|---|---|
| S02 Magic 1-7, Wind Strike | 5 (2 unlock) | measured cadence | 0-7 | inferred: Wind Strike does not close the page; answer with a burst on the next label |
| S03 Firemaking 1-99 | 64 | yes (measured end to end) | 0 | measured |
| S04 Magic 7-59, enchants | 42 (23) | yes, at 0 | 0 | measured (section 2) |
| S05 Doric's Quest | 1 | yes (counted) | 0 | read |
| S06 Runecraft 1-44 | 7 (1) | yes, at 0 | 0 | measured |
| S07 Woodcutting 1-99 | 77 (6) | **about 59 knife / 77 plain charged** | 0; the model's charge can be released (about -59) | measured (oak and willow) |
| S08 Plague City | 1 | yes (counted) | 0 | read |
| S09 Mining 64-99 (49-99 if Plague City drops) | 35 (2), or 50 (4) | **18 (25) charged** | 0; release about -18 (-25) | measured |
| S10 Prayer 1-43 + Tree Gnome Village | 11 (3) + 15-23 (warlord) + 1 reward | yes | 0 | measured cadence; quest reads |
| S11 Agility 1-22 + The Grand Tree | 12 (1) + 10-12 (demon) + 3 reward | demon yes; Gnome laps no; reward no | about 3 (reward) + 0-12 (Gnome) | inferred |
| S12 Fight Arena | several (chain) + 2 reward | chain yes | about 2 | inferred |
| S13 Dwarf Cannon | 1 reward | unclear | 0-1 | inferred |
| S14 cannon session, Ranged 1-50 | about 49, plus Hitpoints | yes (measured rate) | 0 | measured rates (rs/31) |
| S15 Monkey Madness | 3-4 (demon) + 3 reward | demon yes | about 3 | inferred |
| S16 Mage Arena (Charge unlock) | about 3 per Kolodion run | yes | 0 | read |
| S17 Agility 75-99 | 24 (0) | no allowance | 0 | measured (laps 66 = the level-99 lap) |
| S18 Thieving 57-99 + stun pack | 42 (6) Thieving; in stuns 19 Charge, 72 (15) Fletching, about 30 Prayer (bones from 43) | Thieving yes; the stun pack's level-ups are **unmeasured** | 0 if each stun drains its pages (see below); otherwise about 1 tick per page still pending when the stun ends | inferred |
| S19 Sea Slug | 1 | yes (counted) | 0 | read |
| S20 Fishing Contest | 1 | unclear | 0-1 | inferred |
| S21 Runecraft 44-99 | 46 (1) | yes, at 0 | 0 | measured |
| S22 Fishing 78-99 | 21 (2) | yes (measured run, about 0.5 each) | 0 | measured |
| S23 Cook's Assistant | 1 (+1 unlock at Cooking 30) | no | about 1-2 | inferred |
| S24 Goblin Diplomacy, Druidic Ritual, Romeo & Juliet | 2 | no | about 2 | inferred |
| S25 Varrock west: Smithing, Crafting, Herblore, bones, Cooking | 58, 55, 62, bones, wine firings | yes (all measured end to end) | 0 | measured; wine see below |
| S26 Dragon Slayer | 1 (Elvarg) + 2 reward | Elvarg yes | about 2 | inferred |
| S27 combat finish | about 48 | yes (measured rates) | 0 | measured rates (rs/91) |
| **Route** | about 1,000 level-up scripts, plus the stun pack's about 120 | | **about 15-30 ticks not inside; about 77-84 ticks charged in the Woodcutting and Mining models that can be released** | |

Two places the overhead model should watch, though neither has a number yet:

- **S18, level-ups inside pickpocket stuns.** A page that opens in a stun blocks nothing. The
  risk is a backlog. Fletching sends up to 5 actions per tick, early levels give a level-up on
  most of them, and the queue pops one page per tick. A page still queued when the stun ends
  opens on the tick of the next pickpocket click and blocks it, and the click itself only closes
  the page already showing. This is the mechanism behind `interleaving.md` section 5's 136
  Woodcutting ticks. Rule for the stun child: leave each stun with at most one pending level-up,
  and stop helper actions about one tick per pending level-up before the stun ends. At high
  Fletching and Charge levels (one level per several actions) this binds rarely (inferred).
- **S25 wine firings.** Each firing awards Cooking xp in many separate drops, so it can queue
  dozens of level-up scripts that pop one per tick and each need closing. rs/47's one-login
  timeline measured "dismiss the level-up 5". The two-login plan's second firing (65 -> 99 over
  25 batches) was not timed for its pages. The relog plan should not schedule an action right
  after a firing on the assumption of zero ticks (inferred from section 1).

## 5. For cairn://p/rs/97: level-up pages in the in-page knife programs

1. **Answer on the label that first shows the page** (the label after the leveling roll's xp).
   The answer lands on R+2, before the next roll on R+3 (section 1). Measured cost: 0 on oak,
   willow, iron and fly fishing (section 2). Missing it costs one cycle: 3 ticks per level-up on
   oak (18 of 18) and about one roll on willow and fly fishing.
2. **What to send.** Any one of these works:
   - a **blind burst of `pagesAt(level)` continues** (1, or 2 at an unlock level, from
     `levelup_unlocks.enum`; the page count is known in advance from the level);
   - for **trees and fishing spots, a re-click of the current target**, which closes the page and
     drops the unlock page in one packet (measured 0 on oak, willow and fly fishing).

   A read-then-act continue (the speedrun/lib watcher) also works, but it needs a second
   reaction on unlock levels, which closes on R+3 with no slack left (fly fishing's watcher read
   0.28 ± 0.14 rolls). **Do not re-click a rock in the mining rotation:** it re-paths the walk to
   the next stand (1 slip in 13). In the mining rotation the move's own scheduled rock click
   lands on R+2 and closes the page with nothing extra sent (measured, 0 slips). Only a "stay"
   transition needs the burst.
3. **The level-up is predictable before the page shows.** The xp drop on label R already shows
   the level. The answer still has to wait for label R+1, because a continue landing on R+1
   arrives before the page opens and is refused. The program can precompute the burst size on
   label R.
4. **Watch more than the trained skill.** A slipped knife cycle lets the fletch run, and an
   occasional Fletching level-up then opens its own page (seen once in the fly-fishing runs). The
   same next-label rule applies.

## 6. For the fold-in child (cairn://p/rs/103)

- `woodcutting.md` sections 2, 6 and 8: replace "1 tick per level-up (inferred)" and the open
  question with this document's measured 0 (knife oak and willow, plain willow). The totals drop
  by about 77 plain and 59 knife.
- `mining.md` sections 2, 6 and 8: replace "half a tick per level-up" with the measured 0 for the
  knife rotation. The totals drop by about 25 from 49 (18 from 64).
- `herblore.md` section 4: a level-up is one queued script per xp drop that gains a level, not
  per level gained.
- `skills/README.md` open question 3: the 5 ticks per level-up was a bot waiting to see the
  level. Answered on the next label, a level-up costs 0 in every loop measured here.
- RUN-ORDER.md's overhead model: level-ups add about 15-30 ticks (quest reward pages and the
  Gnome course), and the released model charges make the net negative.

## 7. Scripts

| Script | What |
|---|---|
| `levelup-lab.sh` | one-batch lab on the 9640 block (engine, gateway, one runner per bot, scripts in order); `NODE_TICKRATE` defaults to 300 |
| `levelup-dismiss.ts` | the four policies, `pagesAt` from `levelup_unlocks.enum`, per-episode logging (level label, open, close, pages) |
| `levelup-count.ts` | level-up scripts and unlock pages per run step (section 4) |
| `tickmanip-cycle.ts --dismiss=watcher\|burst\|click\|none` | knife and plain loops (new `oak` method; willow and oak catch chances); prints rolls lost after a level-up drop against the control |
| `tickmanip-mine.ts --dismiss=...` | the knife rotation, with level-up gaps and slips after level-ups |
| `agility-course.ts` with `LEVELUP_DISMISS=watcher\|burst` | obstacle ticks split by whether the previous drop raised the level |
| `delayfree-cycle.ts` | now prints level-up scripts queued and the booth wait above its floor |

Rerun the headline rows:

```sh
NODE_TICKRATE=300 bash docs/speedrun/scripts/levelup-lab.sh lvlab1 \
  docs/speedrun/scripts/tickmanip-cycle.ts:--mode=oak-knife:--level=55:--until=75:--gate=off:--dismiss=burst \
  docs/speedrun/scripts/tickmanip-cycle.ts:--mode=flylumb-knife:--level=40:--until=65:--gate=off:--reanchor=xp:--dismiss=burst
```

Use one lab per loop when the host is shared: a bot that stalls past 500 ticks is logged out as
idle, and every later script in the same lab then fails.
