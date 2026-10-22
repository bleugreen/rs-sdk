# Assisted fastest-99 rows: pricing against the #1 entries

The operator asked whether to race a few helper-fed 99s while there is room on the boards. Tenet 18
(cairn://p/rs/tenets/18, approved 16:48 PDT) allows rows for skills whose fastest route is public
and whose supplies the fleet makes as a separate batch that never draws on SCORED's stockpile
([SUPPLIES.md](../SUPPLIES.md)). Rows that rely on an undisclosed lever wait until after the
scored run. This page prices the four eligible skills (Fletching, Firemaking, Crafting and
Smithing) against main's release rule: **a plan is released only if it beats the current #1 by at
least 5% of the #1 time** (rs/147, addendum 13). The issue is cairn://p/rs/216. No demo logins
and no lab runs were made for it. Every number below is copied from the cited source or computed
from it.

Labels follow [RUN-HOST.md](../RUN-HOST.md): **m** measured, **r** read (source or page), **i**
inferred (arithmetic or a model over m and r inputs, basis given).

## Summary

| Skill | #1 (ticks) | Bar (95%) | Our total from the parked name | Margin under the bar | Lever verdict | Supplies line | Logins (twin) | Verdict |
|---|---|---|---|---|---|---|---|---|
| Fletching | jackalopefr1 **58** | **55** | ~66 (i) | **-11** (over) | public: 5 actions per tick, shown by #1 | fletcher h76-h79; rune arrowtips not held | 1 + 1 giver for one trade | **NO**: structural floor |
| Firemaking | jackalopefm4 **706** | **670** | median 667-682 (i); P(at or under the bar) 45-57% | about 0 (coin flip) | none used | woodcutter h10-h14; free stock covers it | 1 (dropper on bbs) | Priced NO at the 5% bar. **Main: GO**, gated on P(#1) >= 90% on the model (see Rulings) |
| Crafting | nickgemcut **197** | **187** | ~189 with dragonstones, ~205-215 with diamonds (i) | **-2 to -28** (over) | public: 5 cuts per tick, shown by #1 | jeweller h80-h83; no diamonds, no dragonstones | n/a | **NO**: no supply, and over the bar anyway |
| Smithing | stunsmither **1,337** | **1,270** | ~1,160 (i, on a 1,024 m lab route) | **~+110** (~8%) | none used | bars h20-h29; ~365 adamantite bars not held | 2 (account + anvil helper) | Priced GO, gated on adamantite. **Main: DEFERRED** until SCORED's adamantite is met (see Rulings) |

In one line: **only Smithing has room**, about 110 ticks under its bar. It needs about 365
adamantite bars that the fleet doesn't hold. Fletching sits on a floor nobody can go under.
Firemaking's expected total lands on its bar, and Crafting has no gems. No skill here needs a
lever to be priced, so tenet 18's disclosure rule blocks none of them.

## Rulings

Main ruled on this pricing at 2026-10-21 17:17:07 PDT (cairn://p/rs/main/messages):

- **Smithing: DEFERRED, not GO.** The ~365 adamantite bars earmarked for SCORED stay with SCORED.
  No new farming line opens for an assisted batch while SCORED's stock is incomplete. Once rs/41
  reports SCORED's adamantite target met, with the two-account line otherwise idle, rs/147 may ask
  rs/41 for a separate surplus batch. The row then becomes GO on the prerequisites in the Smithing
  section: rs/197 and rs/188 lab-accepted, and one from-spawn lab run at about 1,180 or better.
  Not before.
- **Firemaking: GO.** The standard is restated, not relaxed. The 5% margin exists so a public row
  can't lose to variance, and the number that measures that is the probability of taking #1. So
  **the gate for an attempt row is P(#1) >= 90% on the model**, and the 5% margin stays the
  planning target. Conditions: only after tenet 18's verdict; the twin only, booked with host
  outside the gate reads and the Fishing window; no withheld lever (this route uses none).
- **Fletching and Crafting: NO** as priced.

**The Firemaking gate, checkable.** P(#1) is the share of simulated 1-99 lines whose total, the
line plus the fixed ticks before the first light, comes in under jackalopefm4's 706. That means
705 or less: a tie's rank isn't established, so a tie counts as a loss. Inputs:

- **The line:** 400,000 Monte Carlo runs on `firemaking-model.ts`'s level table (`Player.ts`
  levelExperience) and roll, `stat_random(firemaking, 64, 512)` (r, `firemaking.rs2`).
  - The highest log tier is used per level.
  - The first light starts the clock at +3 ticks, and every roll after it is +4, success or
    failure (m, firemaking.md §4: 4.00 ticks per fire on a dropped row).
  - The stamp lands one tick after the last roll.
  - Mean 658, p10 640, p90 680 (i).
- **The fixed ticks:** `cairn_burns`'s 8 parked (m, CLAIMS.md), about 3 login frames (m,
  HARNESS.md), and the walk from the spawn (3222,3222) to the row's first log.

| Fixed ticks before the first light | P(#1) | P(at or under the 670 bar) |
|---|---|---|
| 11-13 (a row starting at the spawn) | 95.7% | 56.7% |
| 14-17 | 94.3% | 47-57% |
| 18-21 | 92.5% | 37-47% |
| 22-25 | 90.1% | 26-37% |
| 26-29 (the road row at (3200,3226) at its far estimate) | 87.0% | 17-26% |

**So the gate holds only while the fixed ticks are 25 or fewer, which means a walk to the first
log of about 14 ticks or less.** The road row at (3200,3226) (12-15 ticks of walk, i) sits on the
edge, and a row at the spawn is comfortably inside. The model assumes every light lands by R+4,
and that no log is missing from the dropped row or taken by another player. Each missed light or
log gap costs 4 ticks or more and counts exactly like 4 more fixed ticks. So a row with 22 fixed
ticks has one such slip of slack before the gate fails.

## Converting a row to ticks

The player page carries the exact tick count in the time cell's hover title (`<span title="58
ticks">17s</span>`). The text is `floor(ticks x 0.3)` seconds. That held for all twelve rows read
on 2026-10-21 at about 17:20 PDT (m, `https://rs-sdk-demo.fly.dev/hiscores/player/<name>?profile=main`,
raw HTML). Examples: 58 ticks reads 17 s, 706 reads 3m 31s, 1,893 reads 9m 27s. Our own tick log
matches the page as well. The fourteen parked rehearsal names' hiscore playtime equals the
session's `endTick` on all fourteen ([CLAIMS.md](CLAIMS.md)), and rs/164's `cairn_smoke` matched
within 1 tick ([HARNESS.md](HARNESS.md)) (m). The issue's table was 1-3 ticks low because it
converted the rounded seconds. The exact rows:

| Skill (category) | #1 | #2 | #3 | Bar: floor(0.95 x #1) |
|---|---|---|---|---|
| Fletching (10) | jackalopefr1 58 | stunfletch 66 | nickfeather 98 | 55 |
| Firemaking (12) | jackalopefm4 706 | stunfiremake 836 | jackalopefm2 937 | 670 |
| Crafting (13) | nickgemcut 197 | crab26eba2 536 | nickcrafti 580 | 187 |
| Smithing (14) | stunsmither 1,337 | nickcrucible 1,839 | nickforged 1,893 | 1,270 |

**No per-level playtimes exist on these pages.** A row stores one stamp, the tick its current level
was reached ([competitors/hiscore-timestamps.md](../research/competitors/hiscore-timestamps.md)),
so a single-skill account's page shows only its 99 stamp (and Overall, equal to it). The #1 routes
below are therefore reconstructed from the total, the engine's rules and the other evidence named
in each section, not from xp per tick by band.

## The fixed overhead on a parked name

Each skill already has its rehearsal name claimed and parked at the Lumbridge spawn (3222,3222).
Each name went through the tutorial skip and a clean logout, and that playtime is spent:
`cairn_carves` (Fletching) 8, `cairn_burns` (Firemaking) 8, `cairn_crafts` (Crafting) 8,
`cairn_forges` (Smithing) 9 (m, [CLAIMS.md](CLAIMS.md)). Logging back in costs about 3 more ticks
before the first action, because the client counts 2-3 login frames before control (m,
[HARNESS.md](HARNESS.md); the first login on a fresh tab read tick 3). Logout costs nothing,
because the stamp is the tick 99 was reached. So **every total below carries about 11-12 ticks
before the first useful action**, plus any walk away from the spawn. The parked kit is the
tutorial's 18 items, leaving 10 free slots (r, SUPPLIES.md H1; `speedrun/skills/start.ts`).

## Fletching

**1. The #1 route, reconstructed.** jackalopefr1 reached 99 at tick 58 (m). A 1-99 needs 39,938
base xp. The best route is arrowtips on headless arrows, 15 per action, rune tips from 75: 240
actions (r, [skills/fletching.md](../skills/fletching.md) §2). The engine decodes at most 5
user events per player per tick (r, `ClientGameProtCategory.ts:6`), so 240 actions take at least
48 ticks. A fresh account also pays 2-3 login frames, the 3-4-tick tutorial skip and one supply
trade of 4-5 ticks (m, CLAIMS.md and [run-transitions.md](../research/run-transitions.md) §3),
about 10 in all. 48 + 10 = 58, so **jackalopefr1 sits exactly on the rune-arrow floor** (i, high).
An adamant cap (283 actions, at least 57 work ticks) cannot produce 58 (i). Rune darts from 81
save one action over the whole route (r, fletching.md §4), so darts make no difference. Lever:
none beyond the packet cap.

**2. Our best route.** The same route, measured at **50 ticks from level 1 to 99** (m, bbs, lite
client, 300 ms; fletching.md §2). The total from `cairn_carves` is 8 parked + ~3 login + ~5 for
the trade (seven stacks, between the measured 4 for one stack and 8 for 23; i) + 50 = **~66**.
A brand-new name in one session would be about 3 + 4 + 5 + 48 = **~60** (i). The bar is 55.
**Neither can reach it:** the 11 ticks spent before the first action plus the 48-tick packet
floor already make 59.

**3. Lever check.** The route's only special mechanism is 5 delay-free OPHELDU actions per tick at
the packet cap. That is route canon, not a withheld lever: it appears in
[engine-sweep.md](../research/engine-sweep.md) Table 1 (rows 6-7, "route (rs/37)"), and it is not
on main's withheld list (wine fermentation, Charge without cooldown, 5 dialogue pages a tick). The
loop has no dialogue. **jackalopefr1 (58) and stunfletch (66) already demonstrate it publicly**:
without it, a 1-99 takes about 240 ticks (i). Disclosure cost: zero.

**4. Supplies.** 3,600 headless arrows; arrowtips 60 bronze, 90 iron, 135 steel, 225 mithril, 495
adamant and 2,595 rune (r, fletching.md §7). Line: fletcher (h76-h79). rs/41's ledger snapshot
(about 15:05 PDT, sent to rs/216 on 2026-10-21): 4,410 headless arrows held, all earmarked; 570 rune arrowtips
held, earmarked for SCORED's S27 arrows; 1,220 adamant and 762 mithril tips held; 2,595 more rune
tips would take many hours of one account camping Hickton's shop at up to ~300 gp each. So no
free stock exists for the rune line. The adamant-cap variant (3,735 adamant tips) is slower and
worse.

**5. Logins.** The rehearsal account plus one giver for a single trade at the spawn. After the
trade, the loop is blind fixed-slot bursts with no reactions. The twin is still preferred, because
a burst of 5 must reach the server inside one 300 ms tick.

**6. Module.** STEP-MANIFEST.md entry 32 (`speedrun/skills/fletching.ts`) has no rs/186 child yet;
the in-stun form waits on rs/132. A rehearsal would add nothing to this decision.

**Verdict: NO.** Not a lever question: the #1 row is at the floor, and the parked name's
overhead alone crosses the bar. Nothing on this server opens room. There is no path to more than
5 Fletching actions per tick, and xp per action is fixed by `arrows.dbrow`.

## Firemaking

**1. The #1 route, reconstructed.** jackalopefm4 reached 99 at tick 706 (m). Every tinderbox roll
costs 4 ticks once chained, for every tier, and success is `stat_random(firemaking, 64, 512)` (r,
[skills/firemaking.md](../skills/firemaking.md) §4). 157 logs take 628 roll ticks plus the
failures. A Monte Carlo of the line (200,000 runs on `firemaking-model.ts`'s level table and
roll) gives **mean 658, p10 640, p50 656, p90 680**, with 7.6 failures on average, all below
level 43 (i). jackalopefm4's ~696 after a fresh account's ~10 ticks of overhead matches the
trade-refill line (~695: five more 6-tick refills; firemaking.md §2, i). A dropped row would need
bad luck to land there (the line comes out at 692 or more about 5% of the time, i). Most likely:
the highest log tier per level, refilled by trades (i, medium). stunfiremake's 836 looks like the
bank line plus walking (i, low). Lever: none. The rolls run on the server's own 4-tick clock.

**2. Our best route.** Logs dropped in a row by a helper, no refills: 4.00 ticks per fire
measured on a 54-log dropped row, and 634 and 666 measured end to end with the lab's restock gaps
cut (m, bgsrv-mac, lite, 300 ms; firemaking.md §1-2). The 157-log dropped row has never been run
end to end (r, firemaking.md §8). Total from `cairn_burns`: 8 parked + ~3 login + the walk to the
row start + the line:

| Row start | Fixed ticks before the line | Median total | P(at or under 670, the bar) | P(under 706, beats #1) |
|---|---|---|---|---|
| At the spawn (a clear row there is unconfirmed) | ~11 | 667 | 57% | 96% |
| ~4 tiles away | ~14 | 670 | 57% | 94% |
| The Lumbridge-Draynor road row at (3200,3226), the S03 assumption, ~12-15 ticks away (i, from run-transitions.md's Lumbridge legs) | ~22-26 | 678-682 | 27-37% | 87-90% |

All rows are i: the Monte Carlo above plus the fixed ticks. The 4-tick granularity makes the 11
and 14 rows equal on the bar.

**3. Lever check.** None. Tinderbox lines, the highest tier per level and a helper-dropped row are
ordinary play. The 100-tick private window on dropped items is a documented server rule, not a
bug that could be patched (firemaking.md §6). SCORED's S03 uses the same method, and publishing
it discloses nothing the server's operator would act on.

**4. Supplies.** Logs 2, oak 4, willow 7, maple 13, yew 24 and magic 107; the tinderbox comes in
the starter kit (r, firemaking.md §7). Line: woodcutter (h10-h14), dropped by the fm-row role
(rs/187). rs/41's ledger snapshot: 3,218 magic logs held against SCORED's 107; 96 yew, 68 maple
and 40 willow held against SCORED's 24, 13 and 7 (H2); normal and oak logs are trivial. A second
157-log batch fits inside free stock, and none of it comes from SCORED's H2 allocation (i). No GE
purchase is needed.

**5. Logins.** One on the twin, the rehearsal account. The next light must land by R+4, a 3-tick
window (firemaking.md §6), and next-tick reactions keep the chain. The dropper runs on the bbs
fleet: it drops 100-300 ticks ahead, so its timing doesn't touch the account's clock. It counts
toward tenet 16's fleet total, not the twin's cap. One risk is specific to this row: the spawn is
the busiest tile in the game, and a dropped log is anyone's 100 ticks after it is dropped.

**6. Module.** STEP-MANIFEST.md entry 16 (`speedrun/skills/firemaking.ts`) has no rs/186 child
yet. The dropper is rs/187 (PR #171 open). A rehearsal cannot move the odds, because luck below
level 43 decides them. A lab run would only confirm a clear row at the spawn and the dropper's
pacing.

**Verdict: NO under the 5% rule.** The expected total lands on the bar, at best 57% to clear it.
Stated plainly: the 5% margin exists so a bad minute can't cost a win, and here the luck of
the first eight logs is that bad minute. If main ever relaxes the margin for this row, it is
about a 95% chance at #1 on free supplies; that is main's call, not a recommendation. The only
lever that would open real room is pyre logs (~430 ticks; firemaking.md §5). They need Shades of
Mort'ton to stage 65 on the account itself, so a fresh account can't use them.

**Main's ruling (17:17:07 PDT): GO, gated on P(#1) >= 90% on the model**, with the conditions and
the checkable gate in the Rulings section above.

## Crafting

**1. The #1 route, reconstructed.** nickgemcut reached 99 at tick 197 (m). The only Crafting
line at 5 actions per tick that reaches 99 fast is gem cutting (r, engine-sweep.md Table 1, rows
18, 29, 36). The nick operator's twelve mules nickgem02-13 each banked 108 uncut dragonstones (r,
[competitors/hiscores.md](../research/competitors/hiscores.md)), so this is dragonstones from 55
(i, high). About 300 cuts take about 60 ticks of packets; the other ~137 ticks are walking and
refills. 108 per mule is 4 x 27, which fits trade-fed loads (i, low). Lever: none beyond the
packet cap.

**2. Our best route.** Gem cutting at a bank booth, 7 ticks per 27 gems (m, bbs; [skills/crafting.md](../skills/crafting.md) §1-2):
**130 ticks from level 1 with dragonstones** (m). With diamonds instead it is about 146: about
29 for levels 1-42, from the measured 130 minus the measured 101 for 42-99, plus 117 measured for
43-99 on diamonds (i). The parked name stands far from a booth. The nearest are Al Kharid
(3268,3167), 53 tiles through the toll gate, and Draynor (3091,3242), 131 tiles (r, map scan of
`server/content/maps`, loc 2213). Lumbridge has no booth in this revision. Total from
`cairn_crafts`: 8 + ~3 + ~5 for the kit trade + ~35-45 to Al Kharid with the gate's pages (i:
0.6-0.7 ticks per tile, from run-transitions.md's measured Lumbridge legs) + the route = **~189
with dragonstones, ~205-215 with diamonds** (i). The bar is 187. Trading gems at the spawn instead
of banking (~11-12 ticks per 27, i) would come to about 178, but each 27-gem load needs its own
pre-loaded helper (a helper can't un-note without a bank), about 14 helpers. That is far over the
twin's cap, and the gems don't exist anyway.

**3. Lever check.** None. 5 cuts per tick is the same public mechanism as Fletching, and
nickgemcut demonstrates it. The scored run's lever-adjacent piece, gems cut inside the wine
relog windows (STEP-MANIFEST.md entry 29), plays no part here.

**4. Supplies.** About 380 uncut diamonds (or 277 dragonstones from 55), a few low gems, and a
chisel. rs/41: no diamonds beyond what goes into SCORED's rings; the only bulk source is the Shilo
Village gem rocks (the quest is needed); GE diamonds were about 25,000 gp and too thin for 380.
**Treat as unavailable.** Dragonstones come only from the crystal chest (r, crafting.md §7). Line:
jeweller (h80-h83), with nothing spare.

**5. Logins.** Not priced further.

**6. Module.** STEP-MANIFEST.md entry 28 (`speedrun/skills/crafting.ts`) has no rs/186 child yet.

**Verdict: NO.** There is no supply. Even with dragonstones, the walk from the spawn to a bank
puts the route over the bar. No lever would change that: the cut and the bank cycle are already at
the packet floor (31 packets per 27 gems).

## Smithing

**1. The #1 route, reconstructed.** stunsmither reached 99 at tick 1,337 (m). Each anvil item takes
5 ticks whatever its bar count, so the platebody is the best item from level 33 (r/m,
[skills/smithing.md](../skills/smithing.md) §4). A fresh account must first walk from Lumbridge to
an anvil: the nearest is 182 tiles away and the Varrock west anvils are 199-204 (r, map scan,
loc 2783), about 110-125 ticks (i). 1,337 less ~10 of fresh-account overhead and ~120 of walk
leaves about 1,207 for the anvil. `smithing-model.ts` gives that at a 12-13-tick turnaround per
inventory (1,171 at 12; i). A bank cycle would come to about 1,330 before the walk. So stunsmither
is helper-fed by trade with slower turnarounds than ours (i, medium). Lever: none.

**2. Our best route.** Platebodies at the Varrock west anvil (3188,3426), one two-way trade per
inventory with the anvil helper on (3187,3427). rs/188's helper role, with the helper restocking at
the real booth, measured **1,024 ticks from the first trade request to 99** over 31 trades with
none failed (m, local engine, bgsrv-mac at load 5-6 of 12, 300 ms; `docs/speedrun/helpers/anvil.md`
on rs/188's branch, PR #179). Its mean turnaround was 8.9 ticks, the helper's half at its 3-tick
floor. Total from `cairn_forges`:

| Part | Ticks | Basis |
|---|---|---|
| Parked | 9 | m, CLAIMS.md |
| Login frames | ~3 | m, HARNESS.md |
| Walk, spawn (3222,3222) to the anvil (3188,3426), 204 tiles | ~115-125 | i: measured Lumbridge and Varrock legs run 0.55-0.68 ticks per tile (L01 73 tiles in 49-51, L25 72 in 39-49; run-transitions.md) |
| Starter-kit offload (18 items out before 24 bars and the hammer fit) | ~2-4 | i: offered back in trade 1, about 4 ticks of offer packets mostly inside the screens; dropping on the walk is untested |
| Route, first request to 99 | 1,024 | m, rs/188 |
| **Total** | **~1,155-1,165** | i |

That is about **110 ticks under the bar** (~8%) and about 175 under #1 (~13%). The older figures
in smithing.md (1,107 with the helper staged, 1,147 measured on a busier host) would give
1,236-1,288, so the margin rests on rs/188's newer measurement. Sensitivity: each tick of
turnaround is about 30 ticks over 31 inventories (model: 1,014 at a 7-tick turnaround, 1,111 at
10, 1,171 at 12; i). The bar holds up to about 3.5 ticks per trade above the lab's mean. **A
mithril-only route** (no adamantite) adds about 110 (85 mithril platebodies in place of 68 adamant;
i), about 1,270: on the bar with no margin, so it is a NO.

**3. Lever check.** None. Make-5 at the anvil and a two-way trade are ordinary play. The extra
tick per level-up at a trade is an engine floor, not a trick (anvil.md). SCORED's S25a uses the
same method, and a public row discloses nothing patchable.

**4. Supplies.** Bronze 15, iron 39, steel 120, mithril 305 and adamantite 365 bars, including
SUPPLIES.md v2's one-inventory margins, plus a hammer (r, rs/188's brief; smithing.md §7). Line:
bars/smelter (h20-h29). rs/41's ledger snapshot: about 1,000 mithril free (1,302 held against
SCORED's ~305); 68 bronze held (SCORED takes 15); 44 iron and 57 steel held, with 127 more steel
reserved after the cannonballs. Iron and steel are cheap on the GE, so the batch buys them. **The
adamantite is the gate:** the line is two accounts at ~18 bars per account-hour, all earmarked
for SCORED's ~365, and the GE shows no sellers. A separate 365 is about 20 more account-hours,
roughly 10 hours on the two accounts (i). None of this batch may come from SCORED's H21a stock.

**5. Logins.** Two on the twin during the run: the rehearsal account and the anvil helper. The step
is reactive, with about 4 reactions on the account's side per trade and 3 on the helper's. A
helper relayed from bbs lands each reaction 2-3 ticks late, about 200-300 ticks over the route
(anvil.md), so both belong on the twin. One helper is enough: its restock has about 15 ticks to
spare (m, anvil.md). The attempt's gate-tab phases (before and after) take a second login, so the
helper logs in after the before-read and out before the after-read. The alternative is main's
exception for 3, as rs/196 got.

**6. Module.** rs/197 is building `speedrun/skills/smithing.ts` and `lib/trade.ts` `swap()`
(STEP-MANIFEST.md entry 10). rs/188's anvil helper is lab-measured (PR #179 open). A rehearsal on
the lab would add the three unmeasured parts: the walk from the spawn, the kit offload, and the
browser webclient's turnaround. Run it from a fresh lab account standing at the spawn with the
18-item kit (no `::setstat`, no `::give` to the account). Pass: 99 within about 1,180 ticks of
login.

**Verdict: GO on price, gated on adamantite.** Smithing is the one row with real room (~110 ticks
under the bar) and no lever. Before an attempt: (1) main decides whether ~20 account-hours of
adamantite for a separate batch are worth it; (2) rs/197's module and rs/188's helper pass their
lab acceptance; (3) the from-spawn lab run above confirms the walk and offload. Without
adamantite, the mithril-only route is on the bar, so it's a NO.

**Main's ruling (17:17:07 PDT): DEFERRED.** No assisted batch draws on SCORED's adamantite, and
no new line opens for one. The row becomes GO on (2) and (3) only after rs/41 reports SCORED's
adamantite target met with the line otherwise idle (Rulings section).

## What this changes elsewhere

- **S25a's pricing (scored run).** rs/188's 1,024 lab ticks are below STEP-MANIFEST.md entry 10's
  expected 1,147 and best 1,107. They belong to rs/188, which owns the figure; rs/158 was copied.
- **The issue's rows** were 1-3 ticks low (Fletching 58, not 57; Firemaking 706, not 703), which
  moves two bars (55, 670).

## Open

- ~~Whether a clear Firemaking row starts within about 14 ticks of walk from the spawn tile.~~
  Answered in the lab (rs/228, [firemaking.md](firemaking.md)): a 51-tile lap starts 3 ticks from
  the spawn, and two full 1-99 lab runs had 12 ticks of overhead including the parked 7, so
  cairn_burns predicts P(#1) 95.7%.
- Whether OPHELD drops stop a running walk in this engine. If they don't, the kit offload costs
  nothing (lab, a few ticks).
- The rs/41 figures are a ledger snapshot from about 15:05 PDT, given by message. The per-role
  rates are in `docs/speedrun/helpers/<role>.md`.
