# Tick audit long shot L2: competitor forensics from the hiscore level stamps

cairn://p/rs/656, for rs/158. Read-only: public hiscore pages only, no logins, no new rows. The question:
what do the stamps of stunbaron's record (35,916) and of every per-skill top-10 99 that is faster than our
expected row say about methods we lack, once like is compared with like?

Labels: **m** a stamp as the page shows it (page and read time cited); **i** inferred, with the arithmetic
here; **e** estimated. Our rows are RUN-ORDER.md section 2's expected figures (the knife-on step table,
which sums to 33,987.0; the row in force adds 1,751.4 of allowances and supply fallbacks, for 35,738.4).

## Answer

- **One actionable lever, worth about 22 ticks (i): ferment all of S25c's wine in one firing.** Every
  Cooking leader's stamp (stuncookv3 20, jackalopeck3 38, stuncook 51, stuncookv2 53) is a single
  fermentation firing from Cooking 1 on a bank of thousands of wines. We run two firings because the plan
  was sized at Cooking 1, where the first batch roll passes 19% of the time. SCORED reaches S25c at
  Cooking 30, where it passes 54%. From 30, one firing of the 520 held wines reaches 99 in **98.2%** of
  200,000 trials (i), against 100% for the current 29-then-491 plan. Taking it removes the first page
  chain, the rest deposit and the arming relog. Row 1 below.
- **No other per-skill leader beats our route like-with-like.** Only three skills have a top-10 entry
  under our row on raw ticks: Cooking (above), Crafting (nickgemcut 197 against S25d's 263 on hard
  leather, a supply difference, row 2) and Woodcutting (stunwcv4 3,181, faster only than the knife-off
  plain row). Every other leader (Mining's miner3 and nickquarry included) is slower than our band once
  the band's start level and the trip are counted (section 3).
- **stunbaron's stamps cannot be split per skill, and they localise no faster band.** The page carries
  three logout batches, and a batch bounds only when a skill reached 99, not when it was trained. On our
  step table the stun route is **at least 5,051 ticks behind us** over its first two batches and **at least
  3,294 ahead** over the third. Their own single-skill accounts, plus our measured Agility band, explain
  the third batch to within about 1,900 ticks (e), and some skills visibly had progress in earlier batches.
  The content change from revision 274 to 289 does not explain it either: the Wilderness course's and
  melee's xp did not change (section 1).
- **One stamp our model cannot produce:** stuncookv3's Cooking 99 at playtime **20** (and jackalopeck3's
  38) needs a large wine stack banked within about 18-19 ticks of the account's first login, tutorial skip
  included. Our rough walk estimate for that is about 26 (e). This is open, and worth at most a few ticks
  to us (row 4).

## How the stamps were read

The source is `speedrun/tools/hiscore-scrape.ts`, with no edits: two pages of each skill board
(`/hiscores?category=N&profile=main`), the overall board's first page, and the player page
(`/hiscores/player/NAME?profile=main`) of every top-10 name. **Read 2026-10-24 01:47:48Z (18:47 PDT
2026-10-23)**, at the scraper's one request per 550 ms. The world feed said `tickMs` 400. Every hover title was in the form
`N ticks normalized to 400 ms per tick`. The raw HTML is in the scraper's cache on the executor and is
not committed.

- **N is raw ticks in both eras.** cairn_burns (rs/269's run, 300 ms, 2026-10-22 03:43Z) still reads
  **690**, and cairn_ashes (rs/439's run, 400 ms) reads **664**. Both match their rehearsal records. Only
  the displayed seconds changed: they are N x 0.4 s for every row, so a level reached in the 300 ms era
  shows a wall time 4/3 too long. No stamp below needed converting.
- **A page shows one stamp per skill, the tick its current level was reached** (`Player.ts`:
  `levelPlaytime[stat] = this.playtime` on a base-level rise; `World.ts` increments `playtime` once per
  tick for every player in the loop, from 0 at account creation). So a single-skill account (total 126)
  gives only its whole 1-99 time from creation. Per-level pace cannot be read from any page. Where a
  "pace" appears below, it is the 1-99 total, or an earlier skill's stamp on the same page.
- **Ties between unrelated skills are logout fallbacks** (levels carrying stamp 0 from a save made before
  version 9; `research/competitors/hiscore-timestamps.md` section 3). They are upper bounds, not
  simultaneous gains: miner3's four rows at 3,964, jadefish's Magic 24 with Fishing 99, and most
  nick*, lach*, vnds* and edward* single-skill pages.
- **New since our last snapshot** (2026-10-21 09:39Z, `competitors/data/`): stuncookv3, stunwcv4, stunwcv2,
  stuntester, stunfletchv2, jackalopefr1, jackalopefma, jackalopehl2, jackaloperc6, jackalopemg3 and
  nickprayrec. Each has a distinct stamp. The rest of the top 10s are unchanged.

## 1. stunbaron (Q1)

### What the page says (m, `/hiscores/player/stunbaron`, 01:47:48Z)

| Batch (logout playtime) | Skills at 99 by then | QP |
|---|---|---|
| ≤12,006 | Prayer, Woodcutting, Fishing, Mining | |
| ≤17,697 (+5,691) | Fletching, Firemaking, Crafting, Smithing, Herblore | 13, saved in this batch |
| ≤35,916 (+18,219) | Attack, Defence, Strength, Hitpoints, Ranged, Magic, Cooking, Agility, Thieving, Runecraft | |

The page is unchanged since 2026-10-21. stunhard, stunless and stunking show the same three-way split
(stunking's Prayer sits in its second batch). **When it ran:** the last archive capture of the overall board
(web.archive.org, 2026-10-05 18:33Z) has no stun account, and asukalabs led at 35h 15m. The record
was on the board by 2026-10-21 03:30Z, and its last batch predates the version-9 stamps (around 10-19).
So the run fell between 10-05 and about 10-19, at 300 ms or slower. That window straddles the 10-09
switch from revision 274 to 289 (upstream 8601955c, in our history).

### Durations: what can and cannot be derived

A batch's value is the logout at or after which each of its skills reached 99. A skill in the third batch
could have been at 98 by 12,006. **The gaps are therefore not per-skill or per-band durations**, and no
skill order inside a batch can be read. What the page does fix is three cumulative milestones. Against our
own step table, skill set by skill set (i, the step-table expected figures; legs go with the step they lead
into):

| Skill set | Theirs (m, upper bound) | Ours, same set (i) | Who is ahead on that set |
|---|---|---|---|
| Prayer, WC, Fishing, Mining 99 (with ~3 QP) | ≤12,006 | **9,822.4**: S05 17 + T04-05 51.7; S07 3,054.5 + T07a 58 + S25b 145; S08 402.7 + T07-08 138.7; S09 3,157 + T08-09 49.3; S19 311 + T18-19 49; S20 319 + T19-20 40.5; S22 1,995 + T21-22 34 | us, by ≥2,184 (≥~1,670 if our 5.15% of allowances is spread pro rata: 9,822.4 x 1.0515 = 10,328) |
| + Fletching, FM, Crafting, Smithing, Herblore 99, QP to 13 | ≤5,691 more | **2,823.6**: S03 661.3 + T02-03 52; S25a 940; S25d 263 (91 + the leather route's 172, in force); S25e 167; S24 492 + its legs 137.3 + T23-24 98 + T24-25 13; Fletching inside S18 at 0 | us, by ≥2,867, though their window also holds ~10 QP of quests (below) |
| + the ten others | ≤18,219 more | **21,513.0**: every other row, 9,984.9 of it quest rows (S10b, S11b, S12, S13, S15, S16, S26) | them, by ≥3,294 |
| Whole account | ≤35,916 | 33,987.0 step, **35,738.4** in force | us, by 177.6 in force |

### Method per window, from the stun single-skill accounts (exact stamps, m, same read)

- **Window 1, gathering with Prayer inside.** Prayer shares the gathering batch on 3 of the 4 max
  accounts, which fits bones buried inside the gathering loops (our S07 does this). The siblings' 3 QP
  appear by 1,607-1,913 (stunlord, stunfast, stunmaxing). Doric's Quest, Sea Slug and Fishing Contest fit
  (stunmine: Magic 45 at 136, QP 2 by 269; stunfish: Firemaking 31 at 85, QP 2 by 2,883). stunlord's
  Agility 49 and stunmaxing's 43 sit in their gathering batches, so **Agility 1-52 (the Wilderness course's
  gate) happens in or beside window 1**. At today's sibling times this window sums to 11,712: stunwcv4
  3,181, stunfish 3,956, stunmine 4,575. That is 472 under the 12,184 their siblings summed on 2026-10-21.
- **Window 2, helper-fed artisans plus about 10 QP.** The artisan siblings are FM 836 (stunfiremake),
  Smithing 1,337 (stunsmither), Fletching 57-66 (rune arrows), Herblore 465 (stunherblore, Druidic Ritual
  included) and Crafting ~200-500, about 2,900 in all. The QP rise from 3 to 13 fits Imp Catcher (Magic
  44-48 at 136-1,278 on six siblings), Waterfall (stundefence: Attack 83 and Strength 83 on one tick,
  1,273), Druidic Ritual, Tree Gnome Village and Fight Arena (1 + 1 + 4 + 2 + 2). At our measured quest
  rows plus Waterfall ~888 (e, hiscores.md) and Imp Catcher ~150 (e) that is about 2,300. So window 2
  is about 5,200 of ≤5,691 (i), with about 500 to spare.
- **Window 3, plain training, no quests.** Ogre melee under Protect from Melee after Waterfall (rs/272
  reproduced stunhitpoint's page), the Wilderness course (stunagile; rs/270 closed it as luck, not a faster
  lap), knights pickpocketing (stunthief 3,253), Mage Arena then Charge (stunmage: Hitpoints 36 at 1,410,
  the Kolodion fight, then Magic 99 at 1,513), a wine firing, Runecraft (stunrc 2,397, method not
  visible), and Ranged (no stun sibling; ~2,580 rune arrows in every stun bank). Summed at the best known
  rate for each, it comes to about **20,600 (e)**:

  | Skill | Ticks | Basis |
  |---|---|---|
  | Agility 52-99 | 4,886 | m, cairn_jumps' band |
  | Thieving | ~2,840 | i |
  | Runecraft | 2,397 | m, stunrc |
  | Magic | ~800 | e |
  | Cooking | ~50 | e |
  | Attack 92-99 | ~1,900 | e |
  | Strength 83-99 | ~3,500 | m, rs/272 |
  | Defence 1-99 | ~4,250 | e, hiscores.md |
  | Ranged | 0 | e, assumes a cannon beside the melee |

  Against ≤18,219 plus window 2's ~500 spare, that leaves **~1,900 (e) unexplained**. This is within the
  error of those estimates. No mechanism is needed, and none is visible.

**Where their band beats our equivalent rows, and by how much.** Only window 3, by ≥3,294 on step
ticks. It is most simply their skills carrying progress from windows 1-2: Agility 43-49 and the Attack and
Strength quests are visible, and window 2 has about 500 spare. Plain training is also not faster than our
quest rows per tick: Monkey Madness gives ~23 base combat xp a tick against melee's ~11, rs/272. We are
ahead by ≥5,051 over windows 1-2 and behind by ≥3,294 in window 3. A rerun by them on today's
siblings would be faster: WC -472, Cooking -31 and Fletching -9 since 2026-10-21 (i), before any
connection gain. That bears on RUN-ORDER's competitor bar, not on our ticks.

**Revision 274 against 289 (r, `git diff 8601955c~1 8601955c -- '*.rs2'`).** `wilderness_course.rs2`
changed loc names and sound flags, and made one stepping-stone hop 1 tick faster in 289. Its xp per
obstacle (125, 200, 200, ...) is identical. In `player_melee.rs2` only the crystal-necklace bonus is new,
and `combat.rs2` gained only a sound proc. Revision 289 also added Haunted Mine's 22,000 base Strength,
which `quests/haunted_mine.md` already prices. **A run on 274 content had no Agility or melee advantage
we lack.**

## 2. The ranked table (payoff x plausibility)

| # | Competitor + skill/band | Their ticks vs our row | Inferred method | Would it beat ours on our route (ticks, i/e with arithmetic) | Plausibility | Cheapest probe (lab engine) | Owner |
|---|---|---|---|---|---|---|---|
| 1 | **stuncookv3, jackalopeck3, stuncook, stuncookv2: Cooking** | **20 / 38 / 51 / 53 m** (1-99 from creation) vs **S25c 81 m** (30-99, two firings) + S23 12 | **One fermentation firing** (`wine.rs2`: the login timer at +20 rolls the bank in 15 batches of bank/15, then the remainder singly) on a stack of thousands (stuncook banks ~5K bad wine and ~2K wine, hiscores.md section 3). The stamp is the firing tick: 98 levels in one tick | **Yes, about -22 i.** From Cooking 30, one firing of the 520 held wines reaches 99 in **98.2%** of trials (200k, the `wine.rs2` rule; the model gives 47.2% for 450 from level 1 and 90.5% for 1,200, against cooking.md's 45.8% and 90.4%). Removed: P1's page chain, which is S25c's critical path (18.8 level-crossing events at 1 page a tick, i, ~19-21 at the demo's 0.9 a tick); the rest-deposit visit ~2 (e); the arming relog, 2 on the demo plus its 1-in-29 46-tick tail, ~3.6 (i); W2's unfilled remainder, ~1 (i: about 19 ticks holding 54 gems, which are 18.2 standalone ticks at 54/160, wine-window section 2). The ~11 firing pages are cleared by gem cutting as P2's are today, at 0. Less the 1.8% shortfall (p50 11 wines, max 147; no wine left, so cook on a range at ~3 a cook, ~100 e) ≈ 2. **Net ≈ 24 - 2 = 22**, range ~15-28 (e). +80 wines (600) raise P(99) to **99.2%** (i) | **medium-high**: the rule is read and the model reproduces cooking.md's figures; the competitors' stamps show single firings working at scale. The open part is that the firing's page count under booth work is not measured | (a) Free: `delayfree-model.ts wine` from 300 base, one firing of 520 and 600. (b) Lab: S25c with SCORED at Cooking 30 (`::setstat`), all 520 notes deposited in the first burst (deposit-all, before login + 19), gems in W1 and after the firing, browser, n = 3; compare the step with rs/339's 81 | **rs/186** (S25c, STEP-MANIFEST entry 29); **rs/41** for +80 wines |
| 2 | **nickgemcut: Crafting** | **197 m** (1-99) vs **S25d 263 m** (45-99, hard leather, in force); 91 i on the diamond basis | Gem cutting, 5 a tick (the decode cap) up to dragonstones, fed by nick's gem mules (108 uncut dragonstones each, hiscores.md section 4) | **Yes, about -183 i, but only with ~236 uncut dragonstones.** S25d's stop is 99 less the windows' 6,567.5 base, 39,027 - 6,567.5 = 32,460 base (from 45, 911 base); 32,460 / 137.5 = 236 dragonstones, at the measured 0.3375 ticks a gem standalone (160 in 54, wine-window section 2) = ~80, against 263. It is the method we already planned on diamonds; the gap is supply | **low**: diamonds were already unobtainable by the 23rd (rs/41), dragonstones are scarcer, and the visible holders are competitors (nickai3 2,710; nickgem02-13) | No lab needed: the rate is measured. A supply read (the public bank board's `uncut dragonstone` search, read-only) then a buy decision | **rs/41** (with the markets thread) |
| 3 | **stunbaron: the last batch** (ten skills) | **≤18,219 m** vs our same set **21,513 i** | Plain training after ~13 QP (section 1): ogre melee under Protect from Melee, the Wilderness course, knights, Mage Arena + Charge, a wine firing, Runecraft | **0 i on this evidence.** Nothing faster than our rows is localised: their siblings and our measured Agility band explain it to ~1,900 (e), and ≥5,051 of our lead in windows 1-2 is the same composition seen from the other side. The ceiling if a faster method did exist is ~3,300 (e) | **low** (≤5%, e) that an adoptable mechanism exists | No lab probe until a method is named. Cheapest: the stun* boards after their next max under version-9 stamps (exact per-skill reach ticks), and `/playerpositions` while one is online | **rs/185** (quest-versus-training composition) |
| 4 | **stuncookv3: Cooking 99 at playtime 20** (and jackalopeck3 at 38) | **20 m** (needs the wine banked by the first session's login + 19) | Not producible by our model: playtime starts at 0 and counts every tick (`World.ts`), and the stamp is the login timer of the very first session. A fresh account must skip the tutorial (~4-6 m, S00 rehearsals), take a trade (~4) and reach a bank: Lumbridge castle's top floor, ~15-18 tiles and two staircases, **~26 in all (e, unmeasured)**. jackalopeck3's 38 implies the same in ≤18 | **≤ ~13 e beyond row 1**, and only if it reveals a way to ferment without the pre-firing deposit. SCORED's wine sits on a planned relog anyway | **low** for a usable lever; **medium** that the demo's fresh-account flow or engine differs from ours (the demo has run unpublished engine code since 2026-10-22 19:34Z) | Lab: a fresh account, the fastest skip, trade and Lumbridge bank deposit, logging the tick of the deposit. If it is ≥ 20, the 20 cannot be made on our engine and the difference is the demo's | **rs/186** |
| 5 | **stunwcv4 (stunwcv2, stuntester): Woodcutting** | **3,181 / 3,403 / 3,485 m** vs **S07 knife 3,054.5 i** (plain 4,026.5 i) | A knife-equivalent 3-tick loop. cairn_chops' 3,330 session was 225 of overhead (login 2, skip 4, kit 7, walks 160 + 52) and 3,105 of chopping with +103 bad luck at willow 73-85 (m, `rehearsals/woodcutting.md`). stunwcv4 at ~50-80 overhead (e, trees near Lumbridge) chops ~3,100-3,130, our knife's pace | **No: 0.** It is ~+126 over S07's knife row raw and at parity like-with-like. It beats only the knife-off plain row (by ~845), and the method there is the knife we already have, under the same host conditions | n/a | none | rs/186 (bar note only) |
| 6 | **jackalopefma: Firemaking** | **673 m** vs **S03 661.3 m** (+ T02-03 52) | Highest-tier logs on a line at 4 ticks a fire | **No: 0.** 673 includes the skip and kit (~8-11 e), so their line is ~662-665, the same 4.00-a-log floor S03 measured | n/a | none | - |

## 3. Top three, one paragraph each

**1. One firing for S25c (about -22 i).** The current sequence ferments 29 wines at relog 1's timer,
waits out that firing's ~19 page ticks (P1, the critical path, since the bank must reopen), deposits the
other 491, relogs to re-arm, and ferments them at relog 2's timer. That ordering came from cooking.md's
level-1 analysis, where one 450-wine firing reaches 99 only 46% of the time. cooking.md's own note that
"one firing covers 1 -> 99" does not account for how much Cooking 30 changes the first batch roll (54%
against 19%). The proposed S25c: relog 1 with ≤27 items, the trade, then **deposit-all 520 notes** and
withdraw the gems in one burst, bank closed by login + 9 (the deadline is + 19), cut in W1, fire at +20
(30 -> 99 in 98.2%), then keep cutting through the ~11 Cooking pages. **No arming relog, no rest
deposit, no P1.** The fallback is for the 1.8% case that ends at Cooking ~94-98 with no wine left: either
stage +80 wines (600 in one firing, 99.2%), or keep the current plan as the documented fallback by
holding back 29 notes: 491 in one firing is 98.2%, and the 29 held back then cover the median shortfall
(11) but not the tail. The lab check is the step at Cooking 30 on the browser, n = 3, read against
rs/339's 81.

**2. Dragonstones for S25d (about -183 i, supply-bound).** nickgemcut's 197 from creation is pure gem
cutting at the 5-action cap. That is our own diamond plan with a higher-xp gem (137.5 base against
107.5). S25d at 236 uncut dragonstones would run ~80 ticks against hard leather's 263. Nothing in the
method is new; the question is whether ~240 uncut dragonstones can be bought on the demo before a run.
The only visible stacks are competitor banks (nickai3's 2,710, the nickgem mules' 108 each), so the read
is rs/41's and the markets thread's: a public bank-board search, then a price. If it is bought, S25d's
stop is already computed from the staged gems (`craftingHandoffXp`, #362), so the module change is a
ledger row.

**3. stunbaron's last batch (0 i today; ceiling ~3,300 e).** The record's third batch is ten skills in
≤18,219 with no quests. Our same set costs 21,513 on the step table, 9,985 of it quest rows that also
buy Agility 25-75, Thieving 1-57 and most of Attack, Strength and Defence. The stamps cannot place a
faster band: summed at the best known rates, the batch is explained to ~1,900 (e). Two siblings show
Agility 43-49 already done in the gathering batch, and the quest signatures (Waterfall's paired Attack
and Strength 83) put Attack and Strength progress in window 2. Revision 274's content offered no
Agility or melee xp we lack. The cheapest real evidence is a future stun max under version-9 stamps:
its per-skill reach ticks would turn this row into numbers. Until then nothing here is a lever.

## 4. Entries checked that do not beat us (one line each)

Every top-10 name on every skill board was read (01:47:48Z). "Raw" is their 1-99 against our row;
"like" adjusts for start level, trip and shared work. Names beginning `cairn_` are our own rehearsals,
listed for reference. Our scored accounts appear by role label only (SCORED-a1, SCORED-a2, the rehearsal
account (a3)), never by name.

- **Attack**: stunattacker 4,728 m (Waterfall Strength 83 at 1,248, QP 4 by 3,427), stunhitpoint 8,498 m;
  nickstriker 10,193, lachatk001 12,073, nickattack 12,433, nickoverall 18,421, nickmax 18,580, deepseek
  25,306, nicktgtbravo 26,340, nicktgtalpha 28,538 (most are logout batches). Against S10b + S11b +
  S12 = 2,556.2 m, quests that also give Agility, Thieving and Magic. No (rs/272).
- **Defence**: stundefence 7,974 m (Waterfall first), nickwarden 9,814, lachdef001 12,333, nickdef 13,674,
  nickoverall and nickmax ~18,500, stunbaron family. Ours comes from S26 and S27. No (rs/272).
- **Strength**: stunhitpoint 4,966 m, stunstrong 7,553 m, nickflex 8,284, lachstr001 10,448, nickbrawn
  10,961, nickstrong 12,595, wfl_kz5 14,641, nickstr 15,304, vnds39 17,675, vnds41 17,677. Ours is
  Monkey Madness (~23 base combat xp a tick) and Dragon Slayer, against melee's ~11. No (rs/272).
- **Hitpoints**: stunhitpoint 17,058 m, nickoverall 18,864, nickmax 21,398, the nicktgt* and stun max
  accounts. A by-product for us. No.
- **Ranged**: nickslinger 5,595, nickknives 7,477, lachrange002 8,918, nickarcher 11,754 (all batches),
  nickoverall 21,269, nickmax 21,398, pevqonir 29,779, zamvulqe 29,971. Against S14 118 + S27 1,972 =
  2,090. No.
- **Prayer**: nickprayrec 1,272 m, stunpray 1,281 m, nickprays 2,028, nickmax 2,037, lachpray001 2,224,
  nickoverall 2,725, srpray1 9,243. Against S25b 145 i, bones ridden inside S07. No.
- **Magic**: jackalopemg3 1,324 m (QP 1 by 353; 44 -> 99 at ~40 base a tick), stunmage 1,513 m,
  nickmagi2 3,416, edwardmage1 10,045, nickoverall 22,087, nickmax 22,179, edwardmagic 27,883. Against
  S02 20.3 + S04 198 + S16 382 = 600.3, with 80-99 free inside S18's stuns. No.
- **Fletching**: stunfletchv2 57 m, jackalopefr1 58 m, stunfletch 66, nickfeather 98, lachbow003 136,
  nickmax 287, nickoverall 312, nickfletch 611, lachbow001 1,274, edwardfletch 2,873. That is ~213
  rune-tip actions at 5 a tick ≈ 43 + setup (i), the same cap S18d uses inside the stuns at 0 (+9 i
  finish). No.
- **Fishing**: cairn_casts 3,425 (ours, #1), stunfish 3,956 m, nickcaster 5,536, jadefish 5,780 (batch),
  lachfish002 6,002, nickfisher1 8,247, lachfish001 8,668, nicklure 8,839, stunlord 11,433 (batch).
  Against S19 311 + S20 319 + S22 1,995 = 2,625, plus legs 123.5. No.
- **Firemaking**: cairn_ashes 664 (ours, #1), jackalopefma 673 m (row 6), cairn_burns 690, jackalopefm4 706,
  two of our own scored accounts at 786 and 805 (named by role only, SCORED-a1 / SCORED-a2 / the
  rehearsal account (a3), never by account name), stunfiremake 836, jackalopefm2 937, nickember 1,382, lachfire002
  1,676. Parity at best.
- **Crafting**: nickgemcut 197 m (row 2), crab26eba2 536, nickcrafti 580, nickcrafts 878, nickcrafty
  1,195, nickmax 2,037, nickoverall 2,698, nickcraft 2,995, edwardcraft 9,355, stunlord 13,997. Beyond
  nickgemcut, none is under S25d's 263.
- **Smithing**: stunsmither 1,337 m, nickcrucible 1,839, nickforged 1,893, nicktemper 2,021, lachsmith001
  2,032, nickbellows 2,519, nicksmiths 4,643, edwardsmith 5,858. Against S25a 940 from ~53 (1,028 m for
  1-99). No.
- **Mining**: **miner3 3,964** (a batch with Attack 42, Strength 40 and Hitpoints 40, so an upper bound;
  no QP), cairn_rocks 4,317 (ours), stunmine 4,575 m, **nickquarry 6,015 m** (QP 1 by 764), lachmine003
  8,374, stunmaxing 9,362, nickminer1 9,850. Like-with-like against S09 (64-99, 3,157 i at the demo's
  3.019 an ore; S09 starts in Ardougne with no trip, after Plague City):
  - miner3: 63-99 is ~1,048 ores at the 3.00 floor ≈ 3,150 wherever it is mined, and its other ~814 is
    1-63 plus the trip, against our zoo rehearsal's 436 + 387 (`rehearsals/mining.md` section 5). Equal
    on S09's band, 0.
  - nickquarry: 5,251 for Mining 49-99 after Doric's (97.0% of the xp), so 64-99 is ≈ 5,251 x 91.2 / 97.0
    ≈ 4,937 i, +1,780 over S09. It is iron emptied at every ore on a busy server, 1.7x our pace
    (`skills/mining.md` 4a).
  - stunmine: ≤4,306 for 49-99, so 64-99 is ≈ 4,048 i, +891.

  No.
- **Herblore**: jackalopehl2 447 m (QP 4 saved at 450), stunherblore 465 m (468), jackalopehl1 1,146,
  nickmax 2,037, nickherblore 2,474, nickoverall 2,698. After Druidic Ritual (~239, hiscores.md) their
  mixing is ≲200, against S25e's 167 m for 28-99. Parity or us.
- **Agility**: stunagile 6,772 m (Prayer 43 at 67), cairn_jumps 7,111 (ours), nickagility 8,476, sragil2
  39,436. rs/270 closed it: the 21st percentile of S17's fall distribution, with a 66-tick lap floor. No.
- **Thieving**: jackalopeth8 2,935 m, stunthief 3,253 m, cairn_steals 3,342 (ours), jackalopeth2 3,364,
  nickpilfer 3,961, lachthief001 4,017, nickfilch 4,385, nickthief 5,666, mmtha0205 6,182, pocketrocket
  7,397. Against our 1-99 ~2,840 i and S18's 57-99 at 2,026, which carries Magic 80-99, Fletching and
  Smithing. Parity, no.
- **Runecraft**: jackaloperc6 2,354 m, stunrc 2,397 m, nickaircraft 3,265, nickrc 4,339, nickairrunes
  4,668. Against S06 60 + S21 1,136 + legs 225 = 1,421. No.
- **Cooking**: beyond row 1, jackalopeck2 142, jackalopeck1 155, nickvintner 212, lachcook001 304,
  winein20 315 and nickcook 1,021 are all over 81.

## 5. Mechanics implied by the stamps (Q3)

| Pattern | Where (m, 01:47:48Z) | Reading | A mechanic we don't use? |
|---|---|---|---|
| Many levels in one tick | stuncookv3 Cooking 1 -> 99 at 20; all four Cooking leaders | One wine firing: one `[timer,fermenting_wine]` run awards every batch in its tick | We use it, in two firings; **one firing from 30 is row 1** |
| Many levels in a few ticks | stunfletchv2 57, jackalopefr1 58 (Fletching); nickgemcut 197 (Crafting) | The 5-actions-a-tick cap (rs/507) on delay-free combines | Used (S18d, the wine windows) |
| Two skills on one tick | stundefence Attack 83 = Strength 83 at 1,273 | Waterfall's two rewards in one script | Known (quest rewards), priced in our quest rows |
| Unrelated skills sharing a stamp | miner3 (4 rows, 3,964), jadefish (Magic 24 + Fishing 99), nick*, lach*, vnds*, edward* pages | Logout fallbacks on zero stamps (hiscore-timestamps.md section 3): upper bounds, not simultaneous gains | No |
| Logout on the 99 | jackalopehl2 Herblore 447 / QP 450; stunherblore 465 / 468; stunattacker Hitpoints 69 at 4,748, 20 after Attack 99 | They log out at once on completion, or a few ticks after | We do the same (time after the last 99 is free) |
| **Xp with almost no playtime** | stuncookv3 20; jackalopeck3 38 | Needs ≥~1,000 unnoted wines banked by the first session's login + 19 (or a first session of ≤18 before a relog). Our rough path estimate is ~26 (e) | **Open: row 4.** No stamp shows a true offline gain (playtime counts every in-world tick from 0) |

## Sources

- The demo's public hiscore boards and player pages, read 2026-10-24 01:47:48Z with
  `speedrun/tools/hiscore-scrape.ts` (world feed 400 ms; every title in the normalized-ticks form).
- web.archive.org's 2026-10-05 18:33Z capture of the overall board.
- RUN-ORDER.md section 2 (step expected figures; the headline's in-force total);
  `skills/cooking.md` (the fermentation rule, the P(99) table); `research/wine-window.md` (W1, P1, W2, P2
  and the 160-dragonstone segment); SUPPLIES.md H21c (520 noted wines) and H21d (S25d's leather and
  `craftingHandoffXp`); `rehearsals/woodcutting.md` (cairn_chops' per-step table);
  `rehearsals/mining.md` sections 5 and 10 (miner3, cairn_rocks); `research/melee-rate.md` (rs/272);
  `rehearsals/agility.md` (rs/270); `research/competitors/hiscores.md` and `hiscore-timestamps.md`.
- Engine and content reads: `server/engine/src/engine/World.ts` (playtime per tick),
  `entity/Player.ts` (`levelPlaytime`), `skill_cooking/.../wine.rs2` and `login_logout/login.rs2:70`
  (the login timer), and `git diff 8601955c~1 8601955c` over `*.rs2` (revision 274 to 289).
- The Monte Carlo is an inline script over `speedrun/lib/xp.ts`'s curve and `wine.rs2`'s batch rule:
  200,000 trials per case, Cooking 30 at 300 base, 110 base a good wine. It reproduces cooking.md's
  level-1 figures to within 1.4 points.
