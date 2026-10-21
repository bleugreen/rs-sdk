# Booth work in the wine sequence's idle ticks

Question (cairn://p/rs/107, for RUN-ORDER step S25): the two-relog wine sequence at Varrock west
bank (`docs/speedrun/helpers/wine.md` on rs/41's branch, "Default sequence for the scored
account") spends most of its ~80 scored ticks waiting for the login timer and clicking through
level-up pages. Can SCORED cut gems, mix potions or bury dragon bones in those ticks without
breaking the deposit deadline, the timer, the page chain, the arming relog or the bank visits the
wine needs? If so, how much Crafting, Herblore or Prayer moves in?

**Answer: yes.** Carry **one 27-bone inventory of dragon bones** through the sequence and bury it
in every window. That saves **37 scored ticks** (measured). Without bones to spare, cut gems in
every window, which saves **about 31** (Crafting ticks moved into the sequence), or mix potions,
which saves **about 25**. Every timer fired on time, every deadline held and every relog was
clean in all 42 relogs of the headline batch.

Labels: *measured* (lab, script and sample named), *read* (source traced), *inferred* (reasoned
from measured or read figures), *estimated*.

## 1. Setup

- **Script:** [`docs/speedrun/scripts/wine-window-lab.ts`](../scripts/wine-window-lab.ts), run
  under `speedrun/lab/lab.sh` with the rs/107 port block:

  ```sh
  WEB_PORT=9630 WEB_MANAGEMENT_PORT=9631 HISCORES_WEB_PORT=9632 NODE_PORT=44630 AGENT_PORT=8630 \
  NODE_TICKRATE=300 LAB_RUNNERS=0 LAB_BOTS=wwrecv \
    bash speedrun/lab/lab.sh wwgive docs/speedrun/scripts/wine-window-lab.ts:--receiver=wwrecv:--variants=plain,gems,potions,bones,mix,mix2:--reps=3
  ```

  `wwrecv` plays SCORED; `wwgive` is the helper that waits beside the bank and trades it the 520
  noted wines when it logs back in. Each rep runs the whole default sequence: the planned relog,
  the trade, the 29 deposit (the bank must open by login + 19), the first firing at login + 20,
  the page chain with the booth click pending, the deposit of the rest, the arming relog, and
  the second firing at the new login + 20. The sequence logic is copied from rs/41's
  `wine-receive.ts` (`splitDelivery`, `openBankThroughPages`, two blind continues per tick). The
  booth loops are copied from `delayfree-cycle.ts` and `prayer-bury.ts`. Nothing under
  `speedrun/` was edited.
- **Host and rate:** bgsrv-mac (12 cores, load 1.4-4.3 during the runs), local engine at
  `NODE_TICKRATE=300`, lite client. 18 reps in the headline batch (6 variants x 3), plus 3
  unguarded bones reps. Two earlier batches on fedora agree (section 6). One more fedora batch
  ran at load 30-69; its reps show bot stalls (a booth click unanswered for 8 ticks with no page
  open) and are not used.
- **Levels:** Crafting 55 (dragonstones), Herblore 78 (Zamorak potions), Prayer 50, Cooking 1.
  Crafting 55 is the dense end of its route (26 gems take it to about 70), so the page effects
  in section 4 are at their worst here.
- **How the saving is measured.** Each work variant runs the wine sequence plus a fixed quota
  (160 gems, 112 potions or 28 bones) to the last action. The plain variant runs the sequence
  with no work, then each quota standalone at the booth, one segment per kind. So:

  saved = (plain sequence + the quota's standalone segment) - (variant, sequence and quota).

  Both ends are scored ticks: the planned relog's click to the last quota action seen, counted
  as wine.md's demo timeline counts them.
- **Normalising the Cooking roll.** The only thing that varied between reps was the first
  firing: 29 wines from Cooking 1 land between 42 and 60 and queue 7 to 22 Cooking level-up
  scripts, one tick each. The script tags every open page by skill ("you just advanced a cooking
  level"). Subtracting the first chain's Cooking pages leaves every variant's total **identical to
  the tick across its three reps**. The tables report that normalised figure, so add the chain
  (about 18 on average) for absolute ticks.

## 2. Variants (measured, bgsrv-mac, 300 ms, n = 3 each)

Windows, on the session's own clock: **W1** is from the 29 deposit's close to the first firing,
about 11 ticks. **P1** is the first firing's page chain, which ends when the bank opens for the
rest; this is the critical path to the arming relog. **W2** is from the second login to the
second firing, about 19 ticks. **P2** is the second firing's 13 pages and what follows.

| Variant | Work in W1 / P1 / W2 / P2 | Quota | Scored ticks, normalised (3 reps) | Plain + standalone quota | **Saved** |
|---|---|---|---|---|---|
| plain | none | none | 52, 52, 55* | | |
| gems | 26 / 0 / 54 / 27 gems | 160 gems | 75, 75, 76 | 52 + 54 = 106 | **30-31** |
| potions | 13 / 0 / 47 / 9 potions | 112 potions | 68, 68, 68 | 52 + 41 = 93 | **25** |
| **bones** | 5 / 0 / 9 / 13 bones | 28 bones | 73, 73, 73 | 52 + 58 = 110 | **37** |
| mix: bury + cut in W1 and W2 | 21 gems + 5 bones / 0 / 21 gems + 6 bones / 0 | 160 gems + 28 bones | 132, 132, 132 | 52 + 54 + 58 = 164 | 32 |
| mix2: bones in W1, bury + cut in W2 | 5 bones / 0 / 21 gems + 6 bones / 0 | 160 gems + 28 bones | 135, 135, 135 | 164 | 29 |
| bones, no due-tick guard | 6 / 0 / 9 / 12 bones | 28 bones | 73, 73, 73 | 110 | 37 |

\* Plain rep 0's trade took 7 receiver ticks instead of 4 (the helper's request landed late), so
its sequence ran 3 ticks long. The baseline uses 52.

Standalone segments in the plain runs (measured, identical in all 3 reps): 112 Zamorak potions
**41** ticks, 28 dragon bones **58**, 160 dragonstones **54**. In absolute terms the plain
sequence measured **67, 72 and 76** scored ticks (Cooking chains of 15, 20 and 21). That is the
lab's version of wine.md's demo **80**. The demo pays 10 trade ticks against 6 here, 0.9 pages
per tick against 1.0, and 1 tick per logout against 0.

Read the mixes against the bones variant plus a standalone gem segment: 73 + 54 = **127**. Both
mixes are worse than that (132 and 135). Section 4 explains why.

## 3. The constraints, one by one

| Constraint | What happened | Basis |
|---|---|---|
| **Deposit deadline** (bank open by login + 19) | Opened at login + 7 in 20 of 21 reps (12 ticks spare), + 10 once with a slow trade (9 spare). The work load is withdrawn in the same burst as the 29 deposit (10 events instead of 8), which costs nothing measurable: the deposit was done at + 9 with or without it (+ 10 for potions, whose load is 5 withdraw clicks). | measured |
| **First firing** at login + 20 | + 20 in every guarded rep. Gem cuts and potion mixes never delay the player. A level-up page left open would hold a normal timer (`Player.ts` `processTimers` needs `canAccess()`), but each cut, mix or continue in the due tick's packets closes it first (`OpHeldUHandler` calls `clearPendingAction`, which closes the modal), so the timer still fired on time. | measured; read |
| **Bury on the due tick** | A bury delays the player for the rest of its tick (`p_delay(0)`; `World.ts` clears `delayed` at the start of the next tick's player phase). A bury landing on the due tick therefore holds the timer one tick. Unguarded: the first firing came at + 21 in **3 of 3** reps. Guarded (no bury sent on the tick before the due tick): + 20 in 6 of 6. The total was the same either way, because the late firing buys one more bone. Keep the guard anyway, so the firing tick stays predictable. | measured; read |
| **Page chain P1** (one level-up script per tick; the bank opens in the tick the last one goes) | Cooking pages ran at 1 per tick, as in rs/88. Pages left over from W1 work are queued ahead of the Cooking pages and lengthen P1 one tick each: gems at Crafting 55 leaked **5** Crafting pages (every rep); potions and guarded bones leaked **0**; bury + cut leaked **8 Crafting + 3 Prayer**. | measured |
| **Arming relog** (removal waits for no delay, no modal and an empty engine queue: `World.ts` `processLogouts`, playtime-audit.md 1d) | Click to out: **0 ticks in 42 of 42** relogs on bgsrv-mac. The new session could act at its tick 1, so each relog cost 1 scored tick (wine.md's lab figure). Nothing is pending at the click: the bank only opens once the queue is empty, no work is sent in P1, and the rest deposit closes the bank in the same burst. | measured (local only; the demo's 2 ticks and 1-in-29 tail stand from wine.md) |
| **Second firing** at the new login + 20 | + 20 in every rep, including gem and potion runs that make booth visits in W2. A bank still open on the due tick would hold the timer until it closes (wine.md T2); it did not happen here, and at worst it costs a tick in which the work goes on anyway. | measured; read |
| **Bank access for the wine** | Only two wine visits: the 29 deposit (adds the first load's withdraw) and the rest deposit (deposits the products too, but **keeps** unused load items for session 2, so bones and leftover gems need no visit at the relog). | measured |

## 4. How the level-up pages interleave

- **In W1 and W2 they cost nothing.** A cut or mix closes the open page in the packet phase, and
  the next queued script starts the same tick (one per tick). Gem work cleared Crafting pages
  while it ran, then by continues once the load was gone.
- **In P1 each leaked page costs a scored tick.** P1 is the only critical path the work can
  touch: the arming relog waits for the bank, and the bank waits for the empty queue. 26 gems
  from Crafting 55 cross 15 levels in 6 cutting ticks. The 5 continue ticks left before the
  firing clear 10 of those pages, and 5 run into P1 ahead of the Cooking pages. At Crafting 80+
  a 26-gem load crosses about 3-4 levels, which clear before the firing (inferred from the xp
  table: `2^(L/10)`). The gems variant's W1 leak therefore shrinks to 0 later in Crafting's
  route.
- **Bury + cut is the worst case.** Every other tick is a bury delay, and the engine queue
  cannot start a page in a delayed tick, so pages drain at most 1 per 2 ticks. W1's 13 Crafting
  level-ups left 8 Crafting and 3 Prayer pages for P1 (measured, every rep).
- **In P2 nothing waits on them.** After the second firing Cooking is 99. The pages only delay
  the next booth visit, so work that needs no bank visit (bones) runs straight through them. In
  the gems variant Crafting pages interleaved with the 13 Cooking pages and the bank opened 4-5
  ticks later than plain, while cutting carried on.
- **Work during P1 itself** (variant `gemsP1`, fedora, 1 rep): nothing to do. W1 had already used
  the whole load, and a fresh load would need a bank visit across the due tick. Bones in P1 would
  halve the page drain, so each bone would lengthen the critical path by exactly its 2 standalone
  ticks: break-even (inferred). Leave P1 to the page clicker.

## 5. Recommended S25 sequence

Which variant to use depends on what S25 still holds when the wine is due. In order of preference:

**A. At least 27 dragon bones left for S25: bones in every window (saves 37, measured).**

1. Before the planned relog, SCORED holds no more than 27 items, so the trade has a slot for
   the noted wine. The bones stay banked.
2. Planned relog at Varrock west bank; the helper is beside it with the noted wines only.
3. Trade (receiver 4 ticks in the lab, about 8 on the demo).
4. Bank: deposit 29 (10, 10, 5, 1, 1, 1, 1), **withdraw-all dragon bones** (fills the 26 free
   slots), close: one burst, 9 events, bank open by login + 19.
5. **W1:** bury the lowest bone every tick (prayer.md's loop: the click in the delayed tick is
   refused harmlessly). **Do not send a bury on login + 19.** Click Continue before the bury
   when a Prayer page shows. About 5 bones.
6. First firing at login + 20. **P1:** stop burying. Send the booth click, two blind continues
   per tick, and nothing else.
7. Bank opens in the tick the last page goes: deposit-all wine notes, **keep the bones**,
   close. Arming relog.
8. **W2:** bury from the first tick; no bury sent on the new login + 19. About 9 bones.
9. Second firing at login + 20 (Cooking 99). **P2:** Continue + Bury each bury tick until the
   bones run out (about 13). Then the standalone S25 booth work resumes.

The inventory of 27 bones is the right size: 5 + 9 + 13 = 27. Nothing needs a bank visit
between the 29 deposit and the end of the final pages except the rest deposit, which the
sequence makes anyway.

**B. No spare bones: gems in every window (saves 30-31 at Crafting 55, measured).** Step 4
withdraws all uncut gems with the chisel already held. W1 cuts the load (5 per tick), then
continues. Step 7 deposits the cut gems too. W2 runs the normal 7-tick gem cycle with booth
visits. P2 keeps cutting, which clears the Cooking pages as it goes. That moves **107 gems,
about 36 of Crafting's 101 ticks, into the sequence**; 5 of them come back as pages leaked into
P1 at Crafting 55. Doing the wine later in Crafting's route avoids the leak, worth about 5 more
ticks (inferred, section 4). Alternatively, put potions or bones in W1 and keep gems for W2/P2.
That is the same leak-free effect, and was not measured as a variant.

**C. Potions only: saves 25 (measured).** 69 potions (13 + 47 + 9), **about 25 of Herblore's 112
ticks**. They lose to gems because a load is only 13-14 potions (W1 holds one load) and W2 needs
twice as many booth visits.

**Not recommended:** bury + cut loads inside the wine window (the mixes, 29-32 against bones +
standalone gems): the page leak into P1, the bank visits a 6-bone/21-gem load needs, and no bones
left for P2. P1 work of any kind (section 4).

Whatever goes in the windows, **S25 shrinks by that much**: order v1 counted the wine's ~80 and
the booth skills' standalone ticks separately.

## 6. Corroboration and limits

- **fedora** (bginf-halo, 32 cores, load 1.5-3 for these), 300 ms, same script before the
  bury + cut and page-tag additions: gems 96 and 91 against a 120 baseline, potions 85 and 81
  against 107, and bones 85 and 85 against 124, unnormalised. That is 24-29, 22-26 and 39 saved,
  the same picture within the Cooking roll. Firings, deadlines and logouts as above. 2 reps
  each.
- **Direct path.** Lab reactions land on the next tick (LAB.md "Direct path and relay"). Booth
  loops on the demo belong in the page (cairn://p/rs/97). The bury loop is blind and one click
  per 2 ticks, so it should carry over unchanged (inferred). The due-tick guard does not carry
  over as written: through a 1-2 tick relay it must skip the sends that could land on the due
  tick, i.e. login + 18 and + 19 on the client clock (inferred). Skipping one more tick at
  worst costs the bone-cadence slot, about 1 tick.
- **Levels.** Measured at Crafting 55, Herblore 78, Prayer 50. Herblore early in its route
  (from 28) levels much faster and would leak pages into P1 like the gems did: put it in W2/P2
  only (inferred).
- **Not measured:** the demo; wine counts other than 29 + 491; gems at high Crafting levels; a
  mixed plan that switches kinds at the rest deposit.
- **Failure modes and fallbacks.**
  - A bury lands on the due tick: the firing slips 1 tick (measured 3/3). Same total, so no
    fallback is needed beyond the guard.
  - Work pages leak into P1: P1 grows 1 tick per page (measured up to 11). Fallback: bones or
    potions in W1, or cut less than a full load.
  - The trade finds no free slot: the trade fails. Fallback: enter the relog with ≤ 27 items.
  - The bank opens late: wine.md's deadline relog applies unchanged. The work only starts
    after the deposit closes, so it cannot cause a late opening.
  - A logout is held: no game cause seen in 42 relogs (no delay, modal or queue at the click).
    One relog failed to log out on fedora at load 69, before any work had started, and is
    counted as a host failure. `logoutClean` waits up to 60 ticks, and wine.md's demo tail (1
    in 29, 46 ticks) is unaffected by this work.

## 7. A lead for S25 as a whole (not part of the window)

The bury + cut loads measured a cadence worth its own study: in W1, **21 gems + 5 bones in 11
ticks** (4 cuts and 1 bury every 2 ticks, every rep). That is about 7 standalone gem ticks plus
10 bone ticks in 11. A bury only delays the following tick, and cuts sent before the bury in
its own tick still land (`OpHeldUHandler` refuses only while delayed). So at the booth, Crafting
could ride almost free inside Prayer's 2-tick bury cadence for as long as both last (inferred:
up to Crafting's ~101 ticks, limited by bank visits and the slower page drain). It lost inside
the wine window because of the window's constraints (section 4). Standalone, the cost to measure
is the extra booth visits (a mixed inventory empties faster) against the pages draining at 1
per 2 ticks. Worth a lab of its own before RUN-ORDER fixes S25's internal order.
