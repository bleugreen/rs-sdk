# Wine supply: grapes, jugs of water, the wine maker and the hand-off

The scored account takes Cooking from 1 to 99 by fermenting about 450 unfermented
wines in its bank. Helpers gather grapes and jugs of water, a Cooking-35 helper
turns them into **noted** unfermented wine, and the scored account receives one
noted stack, banks it in two parts and lets its fermentation timer fire twice.
Owners: cairn://p/rs/47 (supply), cairn://p/rs/88 (the scored account's side).
The Cooking route itself is cairn://p/rs/37's.

Code:

| File | What |
|---|---|
| `speedrun/helpers/grapes.ts` | role `grapes`: Cooking Guild camper (`source: guild`), Phoenix Gang hideout camper (`source: phoenix`, joins the gang first) or Goblin Village camper (`source: goblins`), from a fresh account |
| `speedrun/helpers/jugs.ts` | role `jugs`: buys jugs at the Varrock general store, fills them at the fountain, banks at Varrock east |
| `speedrun/helpers/wine.ts` | role `wine` (maker), `makeNotedWine`, `giveWine` / `giveWineKit` (giver) |
| `speedrun/helpers/wine-receive.ts` | the scored account's side: `splitDelivery` (default), `receiveWine` (one firing), the login-timer deadline fallback, `openBankThroughPages` / `drainChat` (level-up pages) |
| `speedrun/helpers/wine-ferment.ts` | model of the fermentation timer and a Monte Carlo of delivery plans (`bun speedrun/helpers/wine-ferment.ts`) |
| `speedrun/lib/session.ts` | `logoutClean`, `relog` (returns the new session's first in-world tick) |
| `speedrun/lab/measure-wine.ts` | lab measurements T1-T9 (`speedrun/lab/lab.sh` with `LAB_PORTS`) |
| `speedrun/lab/measure-wine-pages.ts` | lab: the level-up page chain, old and new dismissal, continues per tick, logout with pages queued |
| `docs/speedrun/scripts/wine-handoff.ts` | the hand-off between two helper accounts on the demo (`--mode=split --runs=N`) |
| `docs/speedrun/scripts/wine-relog-cost.ts` | the scored-tick cost of a clean relog on the demo, and a fresh account's first-login cost |

## How fermentation works (`wine.rs2`, `login.rs2`)

- Using grapes on a jug of water needs Cooking 35 (`wine.rs2:8-11`). It makes
  one `jug_unfermented_wine` (obj 1995) and calls `settimer(fermenting_wine, 20)`
  on **the account that mixed it** (`wine.rs2:20`). Every login calls the same
  `settimer` on the account logging in (`login.rs2:70` ->
  `~ferment_wines_login`, `wine.rs2:72-73`). Those are the only two ways the
  timer is armed: a helper's mixing arms the helper's timer, never the
  receiver's.
- When the timer fires (`wine.rs2:22-70`) it rolls every obj 1995 in the
  **bank** and the **inventory**. The bank goes in 15 equal batches of
  floor(N/15), **one `stat_random(cooking, 48, 352)` roll per batch, all or
  nothing**, with the batch's xp added by `stat_advance` inside the loop, so
  each later batch rolls at the level the earlier ones raised (`:26-41`). The
  N % 15 remainder then rolls one wine at a time (`:43-55`), then the
  inventory's wines one at a time (`:57-69`). The chance is about 19% at
  Cooking 1, 78% at 50, certain from 68. A success gives 110 xp per wine
  (times the server's xp rate, 25 on the demo). A failure turns the batch into
  jugs of bad wine and gives nothing. There is no Cooking-level check on the
  timer itself.
- `settimer` replaces a running timer, so each make pushes the firing 20 ticks
  out. A normal timer does not fire while a modal (bank, trade, a chat page) is
  open (`Player.ts` `processTimers`: a non-soft timer needs `canAccess()`). It
  fires on the first tick the account is free again.
- **Noted unfermented wine (obj 1996) is invisible to the timer.** It never
  ferments, through any number of timers and logins. The bank stores deposited
  notes as obj 1995, so a helper must never bank its notes.

This engine's level curve is `2^(level/10)`, not the classic `2^(level/7)`: 99 is
998,458 xp, which is 39,938 base xp at 25x or **364 perfectly fermented wines**.

### The engine's tick order, and what it means for the hand-off

Each tick the engine handles the client's packets, then per player its queues,
timers, engine queue and interactions, in that order (`World.ts` processPlayers).
Three consequences:

- **The login timer's deadline is the bank opening, not the deposit.** The bank
  is a modal, so once it is open the timer waits for it to close, and a deposit
  may land after the due tick (lab T2: a bank held open 35 ticks after a make
  held the timer until it closed). The timer phase runs before interactions, so
  a bank that opens on the due tick is too late. For the login timer the bank
  must open by **login + 19** on the receiver's clock. Between the trade window
  closing and the bank opening the account is free, and a timer that comes due
  then fires on whatever the bank holds.
- **Every level a firing gains queues its own chat page.** Each `stat_advance`
  that crosses a level enqueues a level-up script on the engine queue
  (`Player.ts`, after `getLevelByExp`), and each shows a page; if the final
  level is one of Cooking's 25 unlock levels (`levelup_unlocks.enum`: 5, 10,
  ..., 50, 53, 55, 58, ...) every one of them shows a second page (the unlock
  objbox). Dismissing a page ends its script in the packet phase, and the next
  script starts in the same tick's engine-queue phase, before interactions. So
  the bank cannot open until the last page is gone, and the chain costs at least
  **one tick per level-up script**.
- **A logout does not skip them.** The engine removes a player only once its
  engine queue is empty, running one queued script per tick until then
  (`World.ts` processLogouts). A logout with 20 level-ups queued leaves the world
  about 20 ticks later (lab: a logout click with pages queued left after 16
  ticks). The pages are paid either way; clear them before any relog.

### Lab results (local engine, 300 ms ticks; ticks on the named bot's own clock)

| Test | Result |
|---|---|
| T1: second make 16 ticks after the first | fermented 20 ticks after the second make (36 after the first) |
| T2: bank left open 35 ticks after a make | still unfermented at close; fermented 1 tick after closing |
| T3: 28 wines from banked ingredients, noted as they go | 28 ticks, 3 rounds |
| T3b, T4: 28 notes held 30 ticks, then a logout and login and 30 more | all 28 still noted, nothing fermented |
| T5: hand 28 notes to a Cooking-1 receiver, deposit, relog | trade 5 + deposit 4 receiver ticks; fermented at login+20; 12 good, 16 bad; Cooking 1 -> 50 |
| T6: deliver inside the receiver's login window | trade from login+1, deposit done at login+8, fermented at login+20, no extra relog |
| T7: grapes on a jug of water at Cooking 20 | refused ("You need a Cooking level of 35") |
| T8: 450 wines made, one trade, one deposit, one firing at Cooking 1 | made in 349 maker ticks (35 rounds, 0.78 ticks per wine); trade 4 + deposit 3 receiver ticks; 330 good, 120 bad: **Cooking 97**, not 99 |
| T9 (three runs, before rs/88): single-login split, 29 then 421 (re-armed by one make) | first firing at login+20 every run (Cooking 1 -> 53-55), second at login+73 to +77, **99** every run; receiver active ticks 45, 47, 51 |
| T9 (rs/88): the default sequence, 29 then 30, relog arming | trade 4, deposit 29 4 (bank open at login+8), first firing at login+20 (Cooking 1 -> 53), 15 level-up scripts in 15 ticks, rest deposited 1 tick later, relog, second firing at the new login+20 (-> 68), 13 final pages in 13 ticks |

The model in `wine-ferment.ts` reproduces the lab exactly: 12 good wines from
level 1 give level 50, and 330 give 97.

## The hand-off (default: split across a relog)

One firing over a big bank is fifteen all-or-nothing rolls, starting at 19%.
T8 shows the cost: 450 wines at Cooking 1 reached 97. A small first batch
lifts Cooking before the big one is rolled. 29 wines roll 29 times (15 batches
of 1 plus 14 singles), so the first level is reliable. The rest ferments in a
second firing, armed by a second login.

Monte Carlo (`bun speedrun/helpers/wine-ferment.ts`). It implements the batch
rule above exactly (`fermentBank` mirrors `wine.rs2:26-55`: fifteen
all-or-nothing rolls of floor(N/15) at the level reached so far, then N % 15
single rolls). It never used independent per-wine rolls; that is why one firing
over 450 reaches only 46%. Every delivery is deposited in the bank, so no
inventory wines are modelled.

**450 and 520 wines under the recommended split** (200,000 trials each, xp
rate 25):

| Plan | P(99) | P(first firing leaves Cooking < 35) |
|---|---|---|
| 450 in one firing | 46.2% | |
| **29 + 421** | **99.06%** | 0.99% |
| 44 + 406 | 99.09% | 0.97% |
| 520 in one firing | 65.0% | |
| **29 + 491** | **99.83%** | 1.04% |
| 44 + 476 | 99.80% | 0.98% |

With the relog arming the level after the first firing no longer matters: the
second login re-arms the timer at any level, so P(99) is the whole story. (The
old make arming needed Cooking 35 to mix the re-arming wine and reached 99 in
one login only 98.29% of the time for 29 + 421.)

Other plans (40,000 trials each):

| Plan (wines per firing) | P(99) | 5th percentile level |
|---|---|---|
| 450 in one firing | 46% | 63 |
| 520 in one firing | 65% | 68 |
| 600 in one firing | 72% | 67 |
| 15 + 435 | 93% | 98 |
| 30 + 420 | 97% | 99 |
| **29 + 421** | **99.1%** | 99 |
| 44 + 406 | 99.1% | 99 |
| 29 + 491 (520) | 99.9% | 99 |
| 29 + 120 + 301 (three firings) | 100% | 99 |

30 is worse than 29 because 30 rolls as fifteen batches of 2.

### Default sequence for the scored account (main's decision, 2026-10-21)

`splitDelivery(ctx, giver, { loginTick, relog })` in `wine-receive.ts`; the
giver runs `giveWine` with the noted wines only.

1. **Relog standing at Varrock west bank** (a planned relog of the run), with
   the giver already beside it, requesting a trade.
2. Take the trade: the noted wines only (520), one slot.
3. Open the bank, deposit 29 (10, 10, 5, 1, 1, 1, 1 clicks: no count dialog)
   and close in one burst. The bank must open by login + 19.
4. Wait, out of modals, for the login timer at login + 20: the first firing
   (Cooking 1 -> about 55).
5. Click through the level-up pages: the bank-booth click is sent at once and
   stays pending, two blind continues go out every tick, and the bank opens in
   the tick the last page goes.
6. Deposit the rest and close, in one burst.
7. **Relog.** No page is queued by then (the bank could only open once the
   queue was empty), so the logout is a plain 1-2 tick one.
8. Wait, out of modals, for the new login's timer at login + 20: the second
   firing (-> 99). Click through the final pages.

The two waits cost no actions: the account can do anything there that opens no
modal and keeps it at the bank.

**Fallback, the make arming** (`arming: 'make'`): if a second login ever failed
to re-arm the timer, the receiver mixes one wine itself instead of step 7
(the trade then carries one grapes and one jug of water too; needs Cooking 35).
It costs the make plus a level-up page or two more than the relog, and the
lab confirms the relog re-arms (T9 rs/88: second firing at the new login + 20,
with the wines in the bank and none in the inventory).

### The login-timer deadline fallback (`receiveWine`, `splitDelivery`)

The trade plus the first deposit must get the bank open before the login
timer is due. The code does nothing clever about it:

- It always finishes the trade and the deposit, then judges the bank-opening
  tick against the due tick (`timerHeld(bankOpenTick, loginTick + 20)`: open by
  login + 19 holds the timer).
- If the bank opened too late, the timer has already fired on what the bank
  held before (nothing). The wine is banked anyway, and the account makes **one
  clean relog** (the caller's `relog`, normally `speedrun/lib/session.ts`
  `relog`). The new login's timer ferments the batch at its login + 20 with no
  further action: the same sequence with the trade and the deposit already
  done. A run that restarts after a crash also skips the trade when the notes
  are already held.
- No relog given is an error, never a silent loss.
- Should a firing that was expected show no xp (the bank opened on the boundary
  tick, or all 29 rolls failed, 0.2%), the split relogs once and waits again.

Price: one relog, **2 scored ticks on the demo** (below), plus the 20-tick wait
of the new window, which needs no actions. Unit tests: `wine-receive.test.ts`
runs both functions against a fake engine (`speedrun/lib/fake-sdk.ts`) that
fires the timer before interactions and only with no bank window open: on time
(no relog), the bank opening on login + 20 (one relog, the empty firing at +20,
the batch at the new login + 20), and no relog given (error).

### What a clean relog costs (demo, n = 8)

`docs/speedrun/scripts/wine-relog-cost.ts cairn_h48 --n=8`, 2026-10-21 about
09:20 UTC, loopback gateway on bbs. Per sample: the old session's ticks after
the logout click (the click's own tick not counted), plus the new session's
ticks before its first action could be sent (the client's tick counter restarts
at launch and counts in-world ticks). A bank-booth click sent at that first
state opened the bank 2 ticks later (4 the first time), the round trip any
action has.

| Sample | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| Click -> last in-world tick | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 1 |
| New session's first actionable tick | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| **Scored ticks** | **2** | **2** | **2** | **2** | **2** | **2** | **1** | **2** |

Min 1, median 2, max 2, mean 1.88. Offline wall time between logout and the
first in-world state was 3.3-8.1 s (free: no ticks pass while logged out), no
login needed a retry. A second set at about 09:54 UTC (n = 10, same account):
**2, 1, 2, 2, 3, 2, 2, 2, 2, 3** (click -> out 0-2, first action at the new
session's tick 1). Together, n = 18: min 1, median 2, max 3, mean 2.0. Lab:
1 tick every time (0 + 1). It prices the deadline fallback, the arming relog
of the default sequence, and the ~1% case where the first firing leaves
Cooking below 35 (which no longer matters with the relog arming).

### Relog risk (for every planned relog, not only wine)

The scored clock is the server's per-player `playtime`, incremented every
tick for every player in the world (`World.ts` processClientsIn,
`player.playtime++`). Logged-out time does not count, so only two parts of a
relog can cost: the ticks between the logout click and the player's removal,
and the new session's ticks before its first action.

- **The login side is free and flat.** In all 29 demo relogs the new session
  could act at its tick 1; login wall time (3.3-8.1 s, one retry never needed)
  passes with no character in the world. A slow login costs wall time only.
- **The logout side is where the risk is.** 28 of 29 demo logouts left the
  world 0-2 ticks after the click. One (run C's arming relog, 2026-10-21 09:46
  UTC) left **46 ticks** after it, with no level-up page, modal, trade or
  combat. Those ticks **were on the scored clock**: the client kept counting
  PLAYER_INFO ticks of the old session to tick 71 (the server sends them only
  to players in the world), and the wall clock agrees (the session ran 18.3 s
  longer than run D's, 13.5 s of it the 45 extra ticks at 300 ms).
- **What holds a removal** (`World.ts` processLogouts): the logout request
  itself is taken in the same tick; removal then waits for (a) the post-combat
  window (`preventLogoutUntil`, which sends "You can't log out", not seen), (b)
  an empty engine queue and no non-discardable queued script, with no modal or
  delay (`canAccess`; queued level-ups do this, one tick each, but this firing
  gained no level), and (c) the removal budget: line `removed >= 10 ||
  (removed > 0 && performance.now() - started >= budgetMs)` defers a player
  only when another player was already removed earlier in the same tick and
  the 50 ms budget (`budgetMs`, `tickRate / 6`) is spent, or 10 were removed.
  **The budget hypothesis is unconfirmed:** it needs a removal ahead of ours
  (in player-loop order) in each of 46 consecutive ticks with a slow world
  checkpoint, i.e. a burst of other players logging out of the shared demo.
  Only the demo's own `[LOGOUT DEBUG]` lines could confirm it. The outlier did
  not reproduce in 10 further relogs.
- **Delayed logout, not delayed login.** The stall was in the old session
  (ticks after the click); the next login was ordinary. So the run script
  cannot move it off the scored clock: the logout is requested at once and
  the character is in the world until the server removes it, whenever the
  click is sent; and a login before the removal is refused (already logged
  in), costing only wall time. What the run can do: clear level-up pages
  before any relog (they cost one in-world tick each during a logout), avoid
  combat in the 16 ticks before it, and budget **2 ticks per relog with a rare
  tail of tens of ticks** (1 in 29 here). `logoutClean` waits up to 60 ticks
  before it reports a failure, so a stall like this one still completes.

### The level-up pages, and the second bank visit

The old split's second bank visit (deposit the rest after the first firing)
took 28-31 ticks against 5 for the first (lab T9). The cause is the page chain
above: 29 wines from Cooking 1 succeed about 16 times, most of them crossing a
level, and the landing level is often an unlock level, which doubles the pages.
Our part was dismissing them read-then-act (about 1.3 ticks per page in the
lab, more at demo latency) and only then walking into the bank.

Pages queued by the first firing (model, 50,000 trials, unlock pages counted):

| Firing | Level-up scripts | Pages: mean | median | p90 | max |
|---|---|---|---|---|---|
| First (29 at Cooking 1) | mean 16, mostly 13-21 | 23.6 | 21 | 40 | 44 |
| Second (421 at about 55) | 13 | 13 | 13 | 13 | 13 |

The fix (`openBankThroughPages`): the booth click is sent first and stays
pending through the pages; two blind continues (rs/51's `{blind:true}`) go out
every tick, so the server ends a level-up script per tick however long the
round trip is; the bank opens in the tick of the last page; deposit and close
go in one burst. Lab, the same 29-wine firing from Cooking 1:

| Lab, firing to the rest banked | Before (old splitDelivery) | After |
|---|---|---|
| Level-up pages (final level 56, no unlock page) | 18 in 23 ticks | 18 in 18 ticks |
| Bank open, deposit, close | 3 | 1 |
| **Total** | **26** | **19** |

**Continues per tick (main asked for the 5-continue burst).** The engine starts
the next queued level-up script only in the player phase, after packets, so a
second continue in the same tick finds no paused script, except inside the
same script: the unlock page a level-up shows at an unlock level. Measured in
the lab over 17 firings (`measure-wine-pages.ts --only=E`):

| Continues per tick | Not an unlock level | At an unlock level |
|---|---|---|
| 1 | 1 page per tick (18/18, 19/19, 21/21, 21/21) | 2 ticks per level-up (level 55: 33 ticks; level 58: 39) |
| 5 | 1 page per tick (21/21, 13/13) | **1 tick per level-up** (level 55: 17, 17, 17; level 58: 20; level 40: 6) |
| 2 | 1 page per tick (20/20) | same as 5 (one level-up page plus one unlock page) |

So the burst halves the chain at the unlock levels and does nothing elsewhere:
the floor is **one tick per level-up script**, about 16 after the first firing
and 13 after the second. `CONTINUES_PER_TICK` is 2, which captures all of it;
more are ignored by the engine but could push a deposit click into the next
tick under the five-events-per-tick limit. Demo pages per tick: see the demo
timeline below.

A further saving, not built: the 20-tick wait after an arming could overlap
the pages if the arming went out mid-chain (with a make: dismiss and mix in one
burst once the remaining pages fit in 20 ticks; the number of level-ups is
computable exactly from the xp gained, since every success of a 29-wine firing
adds the same 2,750 xp). That would save about 16 ticks, but a misjudged chain
lets the timer fire before the rest is banked, and it is not measured.

### Demo timeline (the default sequence, n = 5)

`docs/speedrun/scripts/wine-handoff.ts cairn_h40 cairn_h48 --mode=split
--launch-maker --trace` (relog arming), rs-sdk-demo.fly.dev over a loopback
gateway on bbs, 2026-10-21 09:35-09:48 UTC. Maker cairn_h40 (Cooking 35) made
74 noted wines in 7 rounds (93 + 18 maker ticks). Receiver cairn_h48, created
for this (Cooking 1). Run A is the real shape: 29 + 30 wines from Cooking 1.
Runs B-E repeat the sequence with 2 + 1 wines at Cooking 70-73, to price the
steps again and re-prove the second login's firing without spending grapes:
their first firings queue no pages. Every tick is on the receiver's own clock;
each login's counter starts at 1.

**Run A, step by step** (all measured on the demo):

| Step | Session tick | Scored ticks |
|---|---|---|
| 1. Planned relog at the bank (click -> last in-world tick) | | 1 |
| First state of the new session | 1 | |
| 2. Trade: window open at 4, confirm screen at 8, 59 notes in the inventory at 10 | 1-10 | |
| 3. Bank open (deadline 19: 7 ticks spare), 29 deposited (10,10,5,1,1,1,1), closed | 12, 14, 15 | |
| 4. Idle until the login timer | 15-21 | |
| First firing: Cooking 1 -> 56 (18 level-ups, 56 is no unlock level) | 21 | |
| 5. Level-up pages: a fresh page every tick 21-40 but 22 and 39 (18 scripts in 20 ticks, 0.9 per tick) | 21-41 | |
| 6. Bank open in the tick of the last page; rest (30) deposited and closed in one burst | 41, 43 | |
| 7. Arming relog: no page open at the click; click -> last in-world tick | 43 -> 44 | session 1: **44** |
| 8. Second login: idle until its timer | 1-21 | |
| Second firing with the wines in the bank and none in the inventory: Cooking 56 -> 70 | 21 | |
| Final pages: 13 scripts in 13 ticks | 21-34 | session 2: **35** |
| **Whole sequence, both relogs included** | | **80** |

**All five runs:**

| Run | Cooking before | Wines | Trade | Bank open after login | First firing after login | Pages after it | Arming relog: click -> out | Second firing after the new login | Total scored ticks |
|---|---|---|---|---|---|---|---|---|---|
| A | 1 | 29 + 30 | 8 | +11 | +20 | 18 in 20 ticks | 1 | +20 | **80** |
| B | 70 | 2 + 1 | 8 | +12 | +20 | 0 | 1 | +20 | 49 |
| C | 71 | 2 + 1 | (held from a trade the receiver had misread as declined) | +3 | +20 | 0 | **46** | +20 | 94 |
| D | 71 | 2 + 1 | 7 | +10 | +20 | 1 | 1 | +20 | 49 |
| E | 72 | 2 + 1 | 8 | +10 | +20 | 1 | 0 | +20 | 46 |

- **The second login re-arms the timer with the wines already banked: 5 of 5**
  (and lab T9), always at the new login + 20. The make fallback was not needed.
- **The deadline held in all runs**: the bank opened at login + 3 to + 12
  against the + 19 limit; the fallback relog never fired on the demo (it is
  unit-tested).
- **Pages per tick on the demo: 0.9** (18 scripts in 20 ticks, run A); the lab
  gives 1.0. A missing tick is a round trip that landed late; the blind
  continues keep the pipe full, so it does not compound.
- **Arming relog, click -> out, runs A-E: 1, 1, 46, 1, 0.** The 46 were in
  the world, on the scored clock; see Relog risk above (cause unconfirmed,
  did not reproduce in 10 more relogs).
- One trade (not in the table) was reported declined on the confirm screen
  although its 3 notes arrived. The receiver now counts a trade by the notes
  that arrived, and `speedrun/lib/trade.ts` waits 3 ticks on an empty confirm
  offer before declining (`CONFIRM_EMPTY_GRACE_TICKS`).

**Projected for 29 + 421 on the demo:** session 1 as in run A, 44 ticks with
18 level-up scripts (the first firing queues 13-21 scripts in most firings,
one tick each with the burst; an unlock landing level costs no more); session
2 as in run A, 35 ticks (the second firing of 421 queues 13 scripts, the same as
30 did); plus the planned relog's 1-2. **About 80 scored ticks from the planned
relog's click to the last page (75-85 across the usual page counts)**, of which
about 26 are idle waits that need no actions. Before rs/88 (lab T9, make
arming): 73-77 ticks from login to the second firing plus the final pages,
about 90 in all, with 28-31 for the second bank visit alone.

**Accounts after these runs (2026-10-21 about 09:57 UTC).** cairn_h40 (the
maker): logged out, **disabled** in fleet.json until rs/93 merges; by count
from its makes, 31 grapes and 7 jugs of water in its bank and 3 noted
unfermented wines in its inventory. cairn_h48 (test receiver, Cooking 73):
logged out, credentials in `~/rs-fleet/bots/`, not in fleet.json; it holds the
fermented wine (jugs of wine and bad wine) in its bank. cairn_h42 gave 30
jugs of water to cairn_h40 and is back on its jugs role.

### Where the Cooking step goes in the run

**After a planned relog at Varrock west bank, never in the first login.** The
login timer is armed in the first tick of every login, and a brand-new account
cannot reach a bank in 19 ticks: on the demo cairn_h48's first login skipped
the tutorial by its tick 11 and then needed **159 ticks** to walk from
Lumbridge (3222,3222) to Varrock west bank (lab: tick 8, then 124). The first
login's timer would fire on an empty bank, and the only other ways to arm it
are a make (Cooking 35, which a new account does not have) or another login.
So a Cooking step at the very start of the run means: tutorial, walk to the
bank, relog (2 ticks), then the sequence above, which is the same as placing
it after any planned relog at that bank. Any later relog at Varrock west bank
works equally well; the step needs the giver beside the bank at that login and
no modal at login + 20.

### Window variant (one firing)

`receiveWine(ctx, giver, { loginTick, relog })`: take the trade, deposit
everything for the current login's timer (same deadline fallback). One firing
over 450 reaches 99 only 46% of the time (T8: 97), so it is for small
deliveries and measurements. Demo, one sample (rs/47, 2026-10-21 07:14 UTC,
cairn_h40 to cairn_h44): trade from login+1 for 8 ticks, deposit 6, done at
login+15, fermented at login+20 with no extra relog (17 wines, Cooking 1 ->
40). The giver must wait until the receiver is in sight before it opens the
trade (`waitForPlayer` in wine.ts): the lib's `openTrade` gives up after 5
ticks without a sighting, and a demo login takes longer.

**Receiver makes the wine itself?** Not below Cooking 35 (T7), and above it
making costs about 0.78 ticks per wine on the scored clock (T8: 349 ticks for
450) against one trade. Handing over grapes + jugs is never worth it.

## Making the wine (helper side)

`makeNotedWine` repeats one round per bank visit: deposit the loose wine, withdraw
it straight back as notes (`withdrawMany` with `asNote`), deposit everything
but the notes, withdraw grapes and jugs of water, close the bank, and fire every
make at once (the engine takes 5 per tick). The bank is open between makes, so
the timer is held. Rounds withdraw 12 pairs (10+1+1 clicks), never an X
amount: two X withdrawals in one burst lost the second on the lab (0 grapes,
13 jugs). The noted stack lives in the maker's inventory indefinitely, so the
maker can work days ahead and needs no timing against the scored account.
The maker needs Cooking 35. The `grapes` role trains it on chickens (cooked on
the cooking pot in the house at the Lumbridge chicken pen, 3225,3290; the
Lumbridge castle range is the Cook's and refuses anyone without Cook's
Assistant). Cooking 1 -> 35 took one inventory of chickens on the demo (25x).

## Grape sources and rates

There are exactly two grape spawns (obj 1987 in `server/content/maps`): the
Cooking Guild top floor (3144,3450, level 2) and the Phoenix Gang hideout
(3237,9761). Both respawn every 80 ticks (`wine.obj`). The Goblin Village
goblins (all 21 spawns are the armoured types that use
`goblin_village_drop_table`) drop grapes 1/128. No shop sells grapes, and no
other drop table or quest reward has them.

| Source | Ceiling | Measured on the demo (2026-10-21 UTC) |
|---|---|---|
| Cooking Guild spawn | 150/h for the only taker (12,000 ticks/h over 80) | **contested**: another player (Jackalopevin) camps the next tile. The first version got about 36/h. The racer (stand beside the table the grape lies on, poll every tick when due, raw pickup) holds **60/h**: cairn_h40, 60 grapes in its first hour, 107 of 167 respawns taken by the other camper |
| Phoenix Gang hideout spawn | 150/h for the only taker | Lab: 21 grapes in 0.25 h including joining the gang; camping alone it takes every respawn. Demo: cairn_h46 joined in about 11 minutes from Goblin Village (one Jonny kill), then **about 100/h** (30 grapes in its first 0.29 h, bank trips included); also contested, another player took 10 of the first 27 respawns |
| Goblin Village, per account | 3/h at 1/128 | 360-440 kills per account-hour at combat about 25; 14 grapes in about 2,500 kills over four accounts (1 in 180), so 2-4/h per account |
| Goblin Village, all players together | about 25/h | 21 goblins, 70-tick respawn: about 3,000 kills/h for the whole village. About 8 accounts saturate it; more accounts only take kills from each other and from other players |
| Grand Exchange | | a 1,000 gp bid for 99,536 grapes and no asks; 464 grapes have traded, all at 1,000 gp (20 trades), about 22/h flowing into that bid. We do not bid against it |

Jugs are not the constraint. The `jugs` role makes about 120-146 jugs of water
per hour (cairn_h42: 243 banked in its first 1.9 hours on the demo) from the Varrock general store (stock 2, one restock per 100 ticks,
1-2 gp each) and the fountain. The guild camper picks up the guild's jug spawn
and fills it at the sink there. 520 jugs take one account about 4 hours and
about 700 gp. A faster free source, not built or measured here: Hassan in the
Al Kharid palace hands a jug of water to anyone whose Prince Ali Rescue is not
started, every time the "It's just too hot here" option is picked
(`hassan.rs2`), so jugs cost only dialogue pages there.

### Hours to 520 grapes (450 + 15%)

| Setup | Grapes/h | Hours to 520 |
|---|---|---|
| Guild racer only, contested as measured | 60 | ~8.7 |
| Guild racer + Phoenix camper, both contested as measured | ~160 | ~3.3 |
| The same + 3 goblin campers (as run on 2026-10-21) | ~170 | ~3.1 |
| Guild + Phoenix, both uncontested | up to 300 | ~1.7 |

On 2026-10-21 rs/41 decided to buy the 520 on the Grand Exchange (rs/63's
bidder on cairn_h61) and keep the gatherers running as the reserve on top.

The lever is the second spawn. Main's estimate of 30-60 goblin helpers for 50-100
grapes/h doesn't hold: the village's 70-tick respawn caps everyone together
near 25/h, and a crowd there would also crowd out other players.

## What a shortfall costs the scored account

At 25x, 99 needs 39,938 base xp; each good wine is 110. With the split plan:

| Wines delivered | P(99) | Mean base xp short of 99 |
|---|---|---|
| 364 | 0% | 1,844 |
| 380 | 69% | 599 |
| 400 | 88% | 194 |
| 420 | 96.5% | 96 |
| 450 | 99.2% | 28 |
| 520 | 99.8% | 17 |

Each 100 wines short is 11,000 base xp (275,000 at 25x) the scored account must
cook as food instead, for example 53 sharks (210 xp, Cooking 80), 92 lobsters
(120, Cooking 40) or 157 trout (70, Cooking 15). `cooking.rs2` delays the
player one tick per item, so that is on the order of 2 ticks per item plus
banking and someone supplying the raw fish. The per-item cost is not measured
here; cairn://p/rs/37 owns that comparison.

## Running it (bbs, dev setup)

Roles run like every rs/41 helper (`speedrun/helpers/role.ts`). Options:

- `grapes`: `{"source":"guild"}` or `{"source":"phoenix"}` (one account per
  spawn: etiquette, and each spawn is a race) or `{"source":"goblins"}` (up to
  about 8 accounts in the village). The Phoenix camper joins the gang first and
  needs 20 coins for Baraek and enough combat for Jonny the Beard (level 2).
  The guild camper banks at Varrock west, the Phoenix camper at Varrock east.
  Optional `cooking` (default 35), `bankAt` (26), `fightLevel` (10).

### Restarts

The fleet restarts a role wherever its account happens to be, so `grapes`
decides every cycle from what it observes, never from what an earlier run did
(`situation` and `choosePhase` in `grapes.ts`, unit-tested in `grapes.test.ts`):

- A camper that can camp camps: the guild source with its hat worn and the
  Cooking it needs, and the Phoenix source when it is a member. Food, the
  tutorial kit and the fight level gate only the phases that fight (chickens,
  the hat hunt, goblins, Jonny the Beard), and Cooking gates only the guild.
- Phoenix Gang membership is a varp the SDK does not expose. An account in the
  spawn room (3232-3243, 9760-9773) is a member, because the members' door is
  the only way in. Elsewhere, an account that can fight goes to camp and the
  door decides: Straven stopping it marks it a non-member, which sends it to
  the quest. One carrying Jonny's report goes straight back to Straven.
- A phase that works on the surface first climbs out of the hideout or down out
  of the guild.
- A goblin camper restarted mid-fight finishes the goblin already on it
  before it picks a new one.

A failed cycle waits 5, 10, 20, ... ticks, capped at 200. After 5 failures in
a row the role logs the phase `stuck` (with the phase it was trying and the
error), which `fleetctl status` shows until a cycle succeeds again. `walkNear`
does not retry a route the SDK's offline map calls unreachable (another plane)
or blocked; other walk failures are retried 3, 6 and 12 ticks apart.

Verified on the demo on 2026-10-21 (standalone, loopback gateway): cairn_h40
(guild) restarted three times at its stand and once on the walk back from the
bank, and cairn_h46 (Phoenix) twice at the spawn and once on the walk back from
the bank. Every restart was camping within 1 to 17 s and took a grape after it.
The fleet had sent h46, restarted at the spawn, to the chicken pen (no food,
membership unknown), and h40 had been trying every tick to walk onto the
table.
- `jugs`: `{"target":600}`. It needs coins in its bank (a fresh account sells its
  starter kit for the first few).
- `wine`: `{"acceptFrom":"^cairn_(h\\d+|mule\\d)$","receiver":"..."}` on the
  Cooking-35 account at Varrock west bank. It accepts trades of noted grapes and
  jugs of water from couriers or the mule (`speedrun/helpers/mule.ts` courier
  role), banks them, keeps making noted wine, and gives it to `receiver` when
  that account is in sight.

### Stopping and handing over to the fleet

The dev setup on bbs (`~/rs-dev/wine`, control scripts in `~/rs-dev/wine-ctl`)
runs one lite client and one role loop per account on the private tmux server
`rs41-wine`, with its own gateway on 127.0.0.1:8540. Stop it with

```sh
ssh bleu@bbs 'bash ~/rs-dev/wine/docs/speedrun/scripts/wine-stop.sh'            # every account
ssh bleu@bbs 'bash ~/rs-dev/wine/docs/speedrun/scripts/wine-stop.sh cairn_h47'  # one account
```

Per account it writes the stop file (so neither loop restarts), closes the
role window, logs the account out through the logout button while its client
is still connected (`wine-logout.ts`, the lib's `logoutClean`, which waits out
combat), and only then lets the client go. Closing the clients first would leave
the accounts idle in the world for up to 500 ticks and block the fleet's next
login. A failed logout leaves that client running and makes the script exit 1;
rerun it for that account. When no account is left it stops the tmux server and
the gateway with it. Tested on cairn_h47 mid-fight on 2026-10-21: out of the
world in the click's tick, 11 s for the whole stop.

Then adopt the accounts (credentials are already in `~/rs-fleet/bots/`):

```sh
F=~/rs-fleet/speedrun/helpers/fleetctl
$F assign cairn_h40 grapes --options '{"source":"guild"}'
$F assign cairn_h46 grapes --options '{"source":"phoenix"}'
$F assign cairn_h41 grapes --options '{"source":"goblins"}'
$F assign cairn_h45 grapes --options '{"source":"goblins"}'
$F assign cairn_h47 grapes --options '{"source":"goblins"}'
$F assign cairn_h42 jugs --options '{"target":600}'
$F reload
```

cairn_h40 is also the wine maker (Cooking 35). When the wine is due, reassign it
(`$F assign cairn_h40 wine --options '{"acceptFrom":"^cairn_(h\\d+|mule\\d)$","receiver":"<scored account>"}'`)
and deliver the bought grapes and the jugs of water to it by trade at Varrock
west bank. cairn_h44 is the test receiver; it stays logged out.

Gotchas found on the demo:

- The guild door (`chefdoor`) is on the south edge of 3143,3444. A walk from
  Varrock that aims straight at it routes through the brick house east of the
  guild (door at 3155,3438, east wall), whose door can close behind the
  account, leaving it walled in at 3149,3441. The role goes round by the
  south-west and opens that house's door if it ever finds itself inside.
- A fresh account's tutorial kit fills the inventory together with 12 cooked
  chickens; the role banks the kit then (it used to spin forever).
- Quest items go by their display names: the Shield of Arrav book shows as
  "Book" and Jonny the Beard's intelligence report as "Scroll", so the role
  matches them by id (757, 761).
- Both spawns' grapes lie on tables that block their tiles, so a walk to the
  grape fails as "destination tile is blocked". In the hideout (loc 595) the
  camper stands on 3237,9762. In the guild, bigtable (loc 594, rotated)
  covers 3144,3449-3450, and the camper stands on 3143,3450.
- The guild door's script moves the player through and puts an invisible wall
  in the doorway while the door swings, also when another player passes. The
  SDK's `openDoor` reports success once the door is gone, so the role instead
  waits until it is inside the guild, and if the door is mid-swing it waits
  and asks again.
- The SDK's offline map treats doors as open, so a closed door shows up as "no
  path" or as a server walk that does not move.
