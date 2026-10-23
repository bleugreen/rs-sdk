# Cooking: fastest route to 99

Scripts: [`cooking-wine.ts`](../scripts/cooking-wine.ts) (wine bank fermentation on the scored
account, across a relog), [`delayfree-cycle.ts`](../scripts/delayfree-cycle.ts)
(`--skill=kebab`, ugthanki kebabs, fast and stock), [`cooking-range.ts`](../scripts/cooking-range.ts)
(raw food on a range or a fire), [`delayfree-model.ts`](../scripts/delayfree-model.ts) (`wine`:
Monte Carlo of the fermentation timer; `cook`: raw-food routes and the wine/fish hybrid). Lab:
[`delayfree-lab.sh`](../scripts/delayfree-lab.sh) (delayfree port block; its `@relog` step logs
the bot out and back in). Labels follow [README.md](README.md#labels) on rs/2's branch.

The helper side of the wine route (stockpiling grapes, making wine at Cooking 35, the
just-in-time hand-off) is rs/47's; its lab figures are cited here as **measured by rs/47**
(`wine-lab.ts` on rs/47's branch, local engine at 300 ms; summary in cairn://p/rs/47).

**Host and rate.** Every figure measured here was taken on **bbs** (Linux, shared with helper
labs) at **`NODE_TICKRATE=300`**. No figure comes from the Mac executor.

**Client.** Every figure here was taken on the headless lite client. The scored run drives the
browser webclient against the demo, where each reaction to observed state costs 1-2 more ticks
through the SDK relay from home and about 0.15 from Ashburn (rs/2; `docs/speedrun/LAB.md` on
main, "Which client a number was taken on" and the host-latency table under "Running several
labs on one machine"). The one-login wine route has **about 5-6 reactions** in its 45-51 active
ticks: the two trade screens, the bank opening twice, the level-up dismissal and the re-arming
make. The fermentation itself is a server timer. The kebab cycle has 1 reaction per 14 kebabs
(the bank seen open). Totals are not re-derived for the webclient.

## 1. Recommendation

Three routes, side by side (scored-account ticks):

| Route | Ticks 1 -> 99, fast | Ticks 1 -> 99, stock SDK | Helper supply | Basis |
|---|---|---|---|---|
| **1. Wine bank fermentation, one login** (rs/47's rule: deposit 29, let the login + 20 timer fire, deposit the other 421, make one wine to re-arm the timer) | **45-51 active ticks**, 73-77 from login to 99 (the two 20-tick waits are idle) | same | **450 unfermented wines** as notes + 1 grapes + 1 jug of water (grapes and jugs for a maker at Cooking 35) | measured by rs/47 (3 runs, all 99); P(99 in one login) 98.3%, 99.1% if a second login is allowed (rs/47 `wine.md`, 200k trials) |
| 1b. Wine, two logins (29 bank + 28 inventory, then 400 at the next login) | about 15-25 of hand-off; fermentation idle | same | 457 wines | measured end to end here (bbs, 300 ms); model 100% |
| **2. Ugthanki kebabs** (no wine) | **131** | about 528 | about 340 kebab mixtures + 340 pitta breads | fast measured; stock inferred from 3 measured cycles |
| 2b. Raw fish on a range (no wine, no kebabs) | about 980 (about 870 with helper-made cakes) | about the same | swordfish about 81 + sharks about 168, plus a few low-level fish | inferred from the measured 3 ticks per cook |
| **3. Hybrid: the wines you have, then fish** | 57 wines -> level about 67, then about 790 of fish | same | 57 wines + about 210 fish | inferred (model) |

**Recommendation.** If helpers can gather about 450 grapes, use **rs/47's one-login batch rule**
(`docs/speedrun/helpers/wine.md` on rs/41's branch): at a login, deposit 29 noted wines before
login + 20 (they roll singly: 15 batches of 1 + 14 singles), let the login timer ferment them
(Cooking 1 -> about 55), then deposit the other 421 and make one wine from the grapes and jug in
the trade, which re-arms the timer (`wine.rs2:20`; making needs Cooking 35, `wine.rs2:8`). 20
ticks later the rest ferments to 99. rs/47 measured it three times (99 every run, 45-51 active
ticks); P(99) is 98.3% in one login and 99.1% if a failed re-arm falls back to the next login.
**It must sit at a login boundary**, because the first firing is the login timer
(`login.rs2:70`). **Do not ferment all the wine at once**: one 450-wine firing reaches 99 only about
46% of the time (model here and rs/47's), and the measured 450-wine run from level 1 ended at
**Cooking 98** (3 of the 15 batch rolls failed, 90 bad wines). The two-login plan measured here
(29 bank + 28 inventory, then 400) also reached 99 and models at 100%, but needs a second login
and 28 loose wines held in the inventory across the logout. **If grapes are unobtainable** (the demo GE has a 1,650 gp bid for 99,658 grapes and
no sellers), use **ugthanki kebabs**: 131 ticks, no Cooking level needed, and every input can be
gathered or bought. Fish on a range is the last resort at about 980 ticks. Each 100 wines short
of 364 good wines costs about 36 ticks of kebabs or about 200 of sharks (inferred).

### Summary row

rs/2's columns for the Item-fed skills section of `docs/speedrun/skills/README.md`; column 5
is "with interleaving (net)", n/a where nothing is absorbable (section 5).

| Skill | Headline method | Start level (on-route quests) | Ticks to 99, normal | Ticks to 99, with interleaving (net) | Basis | Helper supplies | Document |
|---|---|---|---|---|---|---|---|
| Cooking | rs/47's one-login wine bank fermentation (deposit 29, let the login timer fire, deposit 421, make one wine) | 30 after Cook's Assistant ([quests README](../quests/README.md) step 12), else 1; irrelevant, one firing covers 1 -> 99 | 45-51 active ticks (73-77 from login to 99; the two 20-tick waits are idle) | n/a | measured by rs/47 (3 runs, all 99; P(99) 98.3% in one login) | 450 unfermented wines as notes, 1 grapes, 1 jug of water | cooking.md |

## 2. Route by level band

### Route 1: wine

No bands. The timer that ferments wine has no Cooking level check (`wine.rs2:22-70`), so one
firing can take level 1 to 99.

**One login (recommended), rs/47's timeline** (measured by rs/47, 3 runs, `wine-handoff.ts` on
rs/41's branch): accept the trade (450 notes, 1 grapes, 1 jug of water) 4 ticks; open bank, deposit
29 notes, close 5 (done about login + 9); idle to login + 20 (first firing, Cooking 1 -> 53-55);
dismiss the level-up 5; deposit the 421 notes, close, make one wine 28-36; idle 20 (second firing,
-> 99). About 45-51 active ticks, 73-77 from login to 99.

**Two logins (measured here):**

| Step | What | Ticks on the scored account | Basis |
|---|---|---|---|
| Before login A | 57 unfermented wines delivered as banknotes, deposited (they bank unnoted), 28 withdrawn into the inventory; logout | about 11 stock (trade 8 + deposit 3), about 7 at the floor (trade 5, deposit 1, withdraw 1) | rs/47 measured trade 8 + deposit 3; floor from `primitives.md` section 6 |
| Login A + 20 | the timer rolls 15 single bank wines, the 14 remainder singly, then the 28 inventory wines singly | 0 dedicated; the timer fires on the first tick after login + 20 when the account is not delayed and has no modal open | measured: xp seen at client tick 21 (server tick 20); level 1 -> 65, 35 of 57 good |
| After the firing | 400 more delivered as notes and deposited; logout | about 11 stock, about 6 floor | rs/47; inferred |
| Login B + 20 | 15 batches of 26 + 10 singles, all at level 65 or above | 0 dedicated | measured: level 65 -> 99, 400 of 400 good |

If a delivery lands inside a login window (within 20 ticks of a login, before the timer fires)
no extra relog is needed (measured by rs/47: trade + deposit at login + 11, fermented at login +
20). Logged-out time is not playtime, so each relog itself is free (`primitives.md` section 8).

### Route 2: ugthanki kebabs

| Band | Method | Unlock | Base xp / kebab | Success | Ticks / action | Base xp / tick | Actions | Ticks |
|---|---|---|---|---|---|---|---|---|
| 1-37 | Kebab mixture on pitta bread at a bank | none (no level check, `ugthanki_kebab.rs2:116-135`) | 120 | `stat_random(cooking,118,492)`: 46% at 1, 100% from 37 | 0.2 | 307.8 average over 1 -> 99 | about 10 attempts | included below |
| 37-99 | same | | 120 | 100% | 0.2 | | about 330 | |
| **1-99** | 14 mixtures + 14 pittas per inventory, 24 inventories | | | | | **307.8** | **336 kebabs** | **131 measured** |

Measured (`delayfree-cycle.ts --skill=kebab --level=1`): 1 -> 99 in 131 ticks, 24 bank cycles,
open-to-open gaps 4: 11, 5: 8, 6: 1, 8: 1, 12: 1, 16: 1 (mean 5.48); the long gaps are level-up
boxes after the first inventories crossed 50 levels. Stock SDK: 3 cycles, 20 and 24 ticks
open-to-open, 1 kebab per tick (measured), so about 528 ticks to 99 (inferred).

### Route 2b: raw food on a range

| Band | Food | Unlock | Base xp | Success on a range at the band start (read) | Ticks / cook | Expected base xp / tick |
|---|---|---|---|---|---|---|
| 1-15 | sardine, herring | 1, 5 | 40, 50 | 46% | 3 | 6.2 |
| 15-30 | trout, salmon | 15, 25 | 70, 90 | 54-58% | 3 | 12.5-17 |
| 30-45 | tuna, lobster | 30, 40 | 100, 120 | 59-61% | 3 | 20-24 |
| 45-80 | swordfish | 45 | 140 | 61% at 45, 89% at 70 | 3 | 28-41 |
| 80-99 | shark | 80 | 210 | 73% at 80, 91% at 99 | 3 | 51-64 |

Plus a bank trip every 28 items (about 18 ticks at Al Kharid, inferred), so about 980 ticks 1 ->
99 (model). Helper-made cakes (40, 180 base, the cake tin comes back) shorten it to about 870.

### Route 3: hybrid

The level a few single-rolled wines reach at one login (model, 5,000 trials): 14 wines -> about
37, 29 -> about 54, 43 -> about 62, **57 (29 bank + 28 inventory) -> about 67** (measured 65 in one
run). From 67 the fish route is about 790 ticks; from 68, kebabs to 99 are about 295 kebabs, 115
ticks. With any kebab supply at all, kebabs replace the fish.

## 3. Quest xp

| Quest | Cooking (base, read) | On route? |
|---|---|---|
| Cook's Assistant | 300 (`quest_cook.rs2:89`) | **yes**: Package B filler before Dragon Slayer ([quests README](../quests/README.md) step 12) |
| Big Chompy Bird Hunting | 1,470 (`quest_chompybird.rs2:47`) | no |
| Gertrude's Cat | 1,525 (`quest_fluffs.rs2:316`) | no |
| Heroes' Quest | 2,825 (`quest_hero.rs2:35`); also needs Cooking 53 for the lava eel | no (`legends.md`) |

Cook's Assistant is now on the route as Dragon Slayer filler, so the on-route start is **30**
(300 base = 7,500 game xp; `lib/xp.ts` puts level 30 at 7,345 and 31 at 7,952) if the wine
login falls after it, and 1 before it. The S25c lab was staged at 30. No wine count or step
logic depends on the start (section 4: the rolls use the current level, and the plan reaches 99
from 1). Quest xp cannot matter for the wine route in any case: one firing covers
1 -> 99, and the re-arming make's Cooking 35 is reached by the first firing either way.

## 4. Mechanics

**The fermentation timer** (`wine.rs2:22-70`, read):

- `[timer,fermenting_wine]` counts `jug_unfermented_wine` in the bank and the inventory. Bank:
  `$wines_per_batch = bank_total / 15`, then **15 batches**, each one `stat_random(cooking, 48,
  352)` roll for the whole batch (all good, +110 base each, or all bad), then `bank_total % 15`
  single rolls. Inventory wines roll singly. Then `cleartimer`.
- The roll uses the current level, which rises within the firing: `floor(48(99-L)/98) +
  floor(352(L-1)/98) + 1 > rand(256)` (`PlayerOps.ts`, STAT_RANDOM): **19.1% at level 1, 100%
  from 68** (`delayfree-model.ts wine`).
- So a big bank at level 1 bets 1/15 of the wines on each 19% roll until one passes. That is why
  450 wines in one firing reach 99 only 46% of the time, and why the measured run lost 90 wines.
  With 29 or fewer in the bank every roll is single (15 batches of 1 + up to 14 singles), and
  inventory wines are always single, so a first firing of 29 + 28 climbs past 60 on singles.
- **Arming.** Login runs `~ferment_wines_login` (`login.rs2:70`), which sets the timer to 20
  ticks (`wine.rs2:72-73`). Making a wine sets it too (`wine.rs2:20`), and `settimer` replaces the
  running timer (`Player.setTimer`, keyed by script). It is a NORMAL timer: it fires only when the
  player can be accessed (not delayed, no modal; `Player.processTimers`), so an open bank holds it
  (measured by rs/47: still unfermented after 35 ticks with the bank open, fermented 1 tick after
  closing).
- **Noted unfermented wine never ferments** (the timer counts obj 1995, the note is 1996; measured
  by rs/47 across a relog). Helpers stockpile notes; the scored account deposits them, and the
  bank stores them unnoted, ready for the next login.

Measured on the scored-account side (`cooking-wine.ts`, bbs, 300 ms):

| Run | Before | Fermented at | Result |
|---|---|---|---|
| 450 in the bank, one firing | Cooking 1 | client tick 21 after login | +39,600 base: **360 good, 90 bad, level 98** |
| 29 bank + 28 inventory | Cooking 1 | client tick 21 | +3,850 base: 35 good (24 of the 28 inventory wines), **level 65** |
| then 400 in the bank, next login | Cooking 65 | client tick 21 | +44,000 base: **400 good, level 99** |

The prep step checked for 10 ticks that banked wines did not ferment within the same session (the
login timer had already fired and cleared): unchanged in all three runs.

Monte Carlo (`delayfree-model.ts wine`, 20,000 trials each):

| Plan | Wines | P(99) |
|---|---|---|
| 450 at one login | 450 | 45.8% |
| 600 at one login | 600 | 72.1% |
| 1,200 at one login | 1,200 | 90.4% |
| 15, then 435 | 450 | 92.7% |
| 30, then 420 (rs/47's plan) | 450 | 96.6% |
| 29, then 420 | 449 | 99.1% |
| 29, then 421 re-armed in the same login (rs/47, 200k trials) | 450 | 98.3% in one login, 99.1% with a fallback login |
| **29 bank + 28 inventory, then 400** | **457** | **100.0%** |
| pre-levelled to 68 by kebabs, then 321 | 321 + 39 kebabs | 100.0% |

**Kebabs** (`ugthanki_kebab.rs2:116-135`): OPHELDU of pitta bread on a kebab mixture deletes both,
adds a bowl then a kebab (good or bad), and on success gives 120 base. No `p_delay`, no level gate.
The bowl lands in the mixture's slot and the kebab in the pitta's slot, so with mixtures in 0-13
and pittas in 14-27 action i is `pitta@14+i on mixture@i`. The bank visit deposits the kebabs,
withdraws-All the pittas into 14-27, deposits the bowls and withdraws-All the mixtures into 0-13
(5 packets plus close).

**Range and fire** (`cooking.rs2:17-195`): one item per OPLOCU click, `p_delay(1)` before the
result, and no make-X. A click while delayed is dropped, so 3 ticks per cook (`p_delay(n)` = n + 2
from the click). Measured (`cooking-range.ts`, 26 lobsters each): range, fast script 3-tick gaps
25 of 25; range, stock `bot.useItemOnLoc` 25 of 25; a fire the bot lit 25 of 25. Sharks on a range:
3 of 26 burnt at 80, 0 of 26 at 99 (read: 73% and 91% success).

## 5. Alternatives considered

- **One-login wine with a margin**: needs about 1,200 wines for 90% and never reaches certainty,
  because all 15 batch rolls can fail at level 1 (0.81^15 = 4%). The two-login plan is cheaper and
  safe.
- **Pizza toppings and chocolate cake** are also delay-free combinations (`pizza.rs2:113-133`:
  anchovy 39 at 55, pineapple 45 at 65, meat 26 at 45; `cakes.rs2:113-127`: chocolate cake 30 at
  50). All lose to kebabs (120, no level).
- **Gnome cocktails and dishes** finish delay-free for 60 and 30 base (`gnome_cocktail_finish.rs2:30`,
  `gnome_food_finish.rs2:34`) after multi-step preparation. They lose to kebabs.
- **The scored account making its own wine** needs Cooking 35 (`wine.rs2:8`; rs/47 measured a
  Cooking-20 receiver refused) and 450 makes plus banking. Not worth it.
- **Trading kebab inputs instead of banking**: an in-trade swap costs 5-9 ticks per 14 against a
  1-tick bank visit (inferred). Bank wins.

**Interleaving** (`interleaving.md` section 8, the absorbable-fractions table, which lists
Cooking as location-bound): **none of the wine route can be absorbed into self-only time.** Its
active ticks are a trade, bank deposits and one make, at a bank and at a login boundary
(section 4), so nothing in it is portable to a pickpocket stun or a gathering loop. Column 5 of
the summary row is n/a. The reverse is possible: the two 20-tick waits are idle, and other
self-only work can run in them, because a delay or modal only holds the timer until it clears
(section 6; inferred). The kebab fallback is delay-free but needs two non-stackable slots per
kebab and a bank, so, like Herblore, a top-up trade (5-9 ticks) per 14 costs more than the
1-tick bank visit it replaces.

## 6. Gotchas

- **Never hold unfermented wine across a login you do not intend to ferment on.** Any account that
  logs in with loose unfermented wine in its bank or inventory ferments it 20 ticks later
  (`login.rs2:70`). Helpers keep wine as notes.
- **Bank the wines after the login timer has fired.** Wines banked in the first 20 ticks of a
  session ferment at that session's timer, at whatever level the account has then. That is fine
  for the 57-wine first stage (rs/47's in-window delivery) and wrong for the 400.
- **A modal or delay holds the timer.** Do not sit in the bank interface at login + 20.
- **Inventory wines need 28 free slots at login A.** Withdraw them from the deposited notes
  before logging out; a 28-slot trade cannot carry 28 loose wines plus a noted stack.
- **Kebab level-up boxes.** The first inventories cross dozens of levels; each pending level-up
  holds the booth for a tick (the 12- and 16-tick gaps). Dismiss and re-click every tick.
- **Kebabs below 37 fail about half the time** (bad kebabs give no xp). Bring about 10 spare
  mixtures and pittas.
- **Burnt food.** Below 80 sharks burn about a quarter of the time on a range.

## 7. Helper supply list

**Route 1, wine (one login): 450 unfermented wines as notes, plus 1 grapes and 1 jug of water for
the re-arming wine** (two-login variant: 457 wines, no grapes or jug):

| Item | Quantity | Where helpers get it (read; rs/47) | Scarcity |
|---|---|---|---|
| Grapes | 451 | 2 ground spawns, respawn 80 ticks (`wine.obj`, `respawnrate=80`): the Cooking Guild top floor (3144,3450,2; Cooking 32 and a chef's hat) and the Phoenix Gang hideout (`maps/m50_152.jm2`); goblin drop 1/128 (`goblin.rs2:120-121`) | **contested**: GE bid 1,650 gp x 99,658, no sellers; rs/47 measured about 132 grapes per helper-hour at the guild |
| Jug of water | 451 | empty jugs in general stores (2 each, restocking) and 8 ground spawns; filled at a sink or fountain; jugs of water in the Shantay Pass, Bedabin and Rellekka shops | easy |
| Wine maker | 1 helper at Cooking 35 | `wine.rs2:8` | the maker's own timer ferments its loose wine 20 ticks after its last make: deposit and withdraw as notes in the same bank session (rs/47) |

**Route 2, kebabs (1 -> 99), about 340 of each (336 used in the measured run, plus spares for
failures below 37):**

| Item | Quantity | Where helpers get it (read) | Scarcity |
|---|---|---|---|
| Kebab mixture (`bowl_oniontomugthanki`) | 340 | helpers combine bowl + onion, + tomato, + cooked ugthanki meat (delay-free, no level, `ugthanki_kebab.rs2:73-113`) | depends on the meat |
| Cooked ugthanki meat (for the above) | 340 | raw meat drops from Ugthanki camels, 1 per kill (`ugthanki.rs2:1-11`); 25 spawns in the Kharidian desert (`maps/m49_47`..`m51_48`); cooked at level 1, 40 base for the helper. Gathered by the bones role's `ugthanki` spot (`docs/speedrun/helpers/bones.md`): about 125 per account-hour on one measured trip, desert ceiling about 385 an hour | no GE market (uncontested); combat helpers |
| Onion, tomato | 340 each | gnome and Miscellania shops; Port Sarim food shop (tomatoes, 3 in stock); farm spawns | moderate |
| Bowl | 340 for a stock made in advance (each noted mixture holds its bowl until the scored account makes the kebab; only then does the bowl come back) | Catherby and Yanille shops, 2 each | easy |
| Pitta bread | 340 | helper at **Cooking 58** cooks pitta dough (`cooking_generic.dbrow:131-138`); dough from flour + water | needs a Cooking-58 helper |

**Route 2b, fish (1 -> 99)**: about 80 swordfish + 170 sharks (+ about 20 low-level fish); fishing
helpers; no GE market.

**Hand-off.** Wine: two deliveries, one noted stack each (above). Kebabs: noted mixtures and pittas
in one trade, deposited at the training booth; the scored account must stand at a bank.

## 8. Open questions

- **Grape supply.** rs/47 measured about 132 grapes per helper-hour at the guild spawn in the lab;
  457 grapes is about 3.5 helper-hours at one spawn if uncontested. The live contention for the
  two spawns decides route 1 versus route 2.
- **Ugthanki meat rate** per combat helper per hour is not measured (camel respawn and kill time).
- **Kebab stock-SDK total** is inferred from 3 cycles, not run to 99.
- **The two firings on one continuous session** need a relog in the middle. Whether the scored run
  has natural session breaks to hide them in is for the run plan; the relog itself costs no
  playtime.

## 9. Module: `speedrun/skills/cooking.ts` (S25c, STEP-MANIFEST.md entry 29)

One step, `S25c cooking`, which **is** the run's two planned relogs at the Varrock west booth
(SCORED on (3185,3436), the wine giver on (3184,3436)). It ends logout-safe: Cooking 99, no notes
or gems held, no page or bank open.

### How the pieces fit

- **The wine** is rs/41's `splitDelivery` (`helpers/wine-receive.ts`), unchanged in what it
  sends. The module only fills its waits through four opt-in **window hooks**
  (`SplitOptions.windows`). With no hooks, the split sends exactly the packets it sent before:
  a test pins the packet-and-tick sequence captured on the base.
  - `firstBurst` and `restBurst` add packets to the two deposit bursts, before each close.
  - `firstWait` and `secondWait` run beside the two `awaitFiring` waits. `secondWait` replaces
    the final page drain, and the second firing gets 6 ticks of slack, because the gem cycle's
    bank visits can hold the timer.
- **The giver** is `giveWine(..., {afterRelog: true})` (`helpers/wine.ts`; role option
  `afterRelog`). It waits to see SCORED, then sees it gone (relog 1's logout), then back.
  Seen-first matters: the giver is staged before SCORED reaches the booth. It requests on the
  first observed state SCORED is back, and re-sends only a click the engine dropped
  (`DROPPED_TICKS`), never the 27-tick standing re-send, which would miss login + 19.
- **The gems** are item-cycle's tool mode (`speedrun/lib/item-cycle.ts` and the page program),
  through three opt-in parameters added for S25c:
  - `held`: start on the load already held, with no booth click first.
  - `bank: false`: no visit at all. In W1 the 491 notes still held must stay out of the bank
    until P1.
  - `mixed`: a tool-mode load is filled from several recipes in xp order. The blind plan is each
    type's slots ascending; `uncut_gem.rs2` deletes the first matching uncut gem and adds the cut
    one to the first free slot, so every cut lands in its own slot.

  The driver's `clearTicks: 0` skips the 3-tick level-up watcher, for W1 only.
- **The sequence**, phase by phase:
  1. **Burst 1** (inside the deposit-29 burst): withdraw the chisel (S25d stows it), then the
     fewest uncut stacks that fill the free slots. For the fleet's gems that is sapphire All
     (26), so the burst is 7 deposits + chisel + 1 stack + close = 10 events, 2 ticks.
     Withdrawing every type would be 12 events and 3 ticks. A short supply caps the windows'
     count; no gems at all falls back to the plain sequence.
  2. **W1**: `held` + `bank: false` + `mixed` on the 26, then blind continues on every state
     through **due − 1**. A level-up page open on the due tick holds the timer unless a continue
     in that tick's packets closes it (wine-window.md §3), so stopping when the chat merely looks
     quiet is not enough. The due tick's own sends are left to P1.
  3. **P1**: `splitDelivery`'s booth click and two blind continues a tick (4 events). Then one
     burst: the notes All, each cut gem All, close.
  4. **Relog 2.**
  5. **W2 + P2**: the booth cycle on `mixed` loads (27, 27, 27 for the fleet's gems) with
     `stow`, so the last visit banks the chisel and the cut gems. The cuts close the second
     firing's Cooking pages as they go.
- **Deadlines count from the armed tick, `tickBase + 1`.** A relog's first published state can
  be a tick later: the lab saw first states at + 1 and + 2, and firings at `tickBase + 21` every
  time.
- **The relog guard** (`relogGuarded`) is the only path to a relog. It refuses with a bank or
  trade open, drains any page, then calls `session.relog` (in page by default, navigation as
  the fallback). Every relog is logged with its kind (planned-1, planned-2, deadline), `via`,
  `tickBase`, `loginTick` and cost.

### Resume

Any login arms `fermenting_wine` at login + 20, so the watchdog's reconnect login is itself an
arming login, and a crash never costs an extra planned relog. The `wineBank` probe (exported as
`PROBES`) opens the booth for about 3 ticks and reads three things: unfermented wine (1995),
fermented wine (1993 and 1991), and cut and uncut gems. `splitStage` maps the notes held and
the bank to where `splitDelivery` re-enters (`SplitOptions.from`):

| Notes held | Bank | Stage |
|---|---|---|
| 0 | no wine | not in progress: `run` from relog 1 |
| > 0 | no wine | `deposit-first` |
| > 0 | unfermented only | `await-first` (W1 on whatever is held) |
| > 0 | fermented | `deposit-rest`: the rest rides this login's timer, **no relog 2** |
| 0 | unfermented and fermented | `await-second` (W2/P2) |
| 0 | fermented only, Cooking < 99 | refused: `wine exhausted at Cooking L` |

This holds only for a bank with no wine before S25c, which is true of SCORED's. Cooking 99 with
uncut gems still banked resumes as the gem cycle alone. `RunnerSession` carries `tickBase`
(optional), so a resumed step knows its login's tick.

### Preconditions (in code)

- Beside the booth, with the booth in view.
- The staged gems (option `stagedGems`, default H21d's row) are all gems the windows cut. Else the
  precondition refuses with the reason. The windows cut their total (`windowPlan`), and S25d's
  hand-off plus the windows' xp is 99 exactly (`craftingAfterWindows`).
- S25a done (Smithing 99), S25e done (Herblore 99), and S25d done: Crafting xp at or above
  crafting.ts's `craftingHandoffXp` of the same staged gems. The `lab` option skips these three.
- At most 27 slots used unless the notes are already held, else
  `N other items (...): need 1 free slots`.
- Not in combat, and not hit within 16 ticks.

The chisel is not the step's to clear: the plain sequence never touches it.

### Measured (lab, `speedrun/lab/cooking-accept.ts`, bgsrv-mac, browser client, 300 ms, 2026-10-22)

| Case | Scored ticks | Notes |
|---|---|---|
| run levels: Cooking 30, Crafting 96, the fleet's 108 gems, chisel banked | 77, 85 | Cooking 99; 107 cut (the 108th stays banked); peak 28/28; burst 1 opened at login + 8 or 9, done in 2 ticks |
| the same, chisel held | 81 | burst 1 also 2 ticks: **the chisel's withdraw costs 0** |
| resume: the session dropped at relog 2 | | probe read 491 unfermented, 29 fermented, 82 uncut, 26 cut; resumed `await-second`, no relog 2, Cooking 99, all 107 cut |
| WW §1 fixture, gems (Cooking 1, Crafting 55, dragonstones, 160-gem quota) | 114, 115, 115; **98** normalised | WW measured 75-76 |
| the same, plain (+ 160 standalone) | 133, 123, 133; 113-114 normalised | WW: 52 + 54 = 106 |

Across all reps: both firings at exactly login + 20, both relogs planned, relog cost 1-2 ticks
`via: launch` (the lab's loopback query login never takes the in-page path), logout latency 0.

**Against entry 29:** at the run's own levels S25c measured 77-85 with the 107 gems inside it,
against the entry's expected 80. Against WW's comparability fixture, the gem saving is **15-16
ticks, not 30-31**. Where the gap comes from (read from the reps; not yet decomposed tick by tick):
- W1 leaks 11 Crafting pages into P1 at Crafting 55, against WW's 5.
- Each item-cycle run ends with a stow visit and a page drain, which WW's single loop did not
  pay.
- Both the plain and the gems variant carry about 6-7 ticks of harness overhead against WW.

At the run's levels the P1 leak is 0, as WW §4 predicts for Crafting 80+.

### Demo (rehearsal twin, browser tab, 2026-10-22 13:20-13:28Z)

The default sequence, as run A, through the module under `speedrun/rehearse.ts`:
- **Receiver**: throwaway `cairn_wr339`, Cooking 1, in the twin's Chrome tab under rs/339's claim. It ran S00, then the `walkIn` step to the stand, then S25c with `windowWork: 'none'`.
- **Giver**: throwaway `cairn_wg339` on bbs (lite, its own loopback gateway). It trained Cooking to 42 on chickens and made the wine from fleet grapes and jugs, then ran `wine {receiver, afterRelog: true}`.
- **Wines: 52, not run A's 59**: the fleet held only 52 jugs of water. That is 29 + 23.

| | Tick | From the armed login |
|---|---|---|
| S25c start, at the stand | 139 | |
| relog 1: **in page**, cost 1, logout latency 0 | 140 | |
| trade (the giver's afterRelog cue fired on SCORED's return) | 7 ticks | |
| bank open, 29 deposited, closed | 151-153 | + 11 |
| first firing, Cooking 1 to 54 | 160 | **+ 20** |
| P1: 16 pages in 17 ticks, rest banked | to 178 | |
| relog 2: **in page**, cost 1, logout latency 0 | 179 | |
| second firing, 54 to 66 | 199 | **+ 20** |
| end, the pages cleared | 212 | |

**S25c: 73 ticks against run A's 80 (−9%): pass.** These are the run's tab relogs, at 1 tick
each. The step's postcondition (Cooking 99) failed only because the demo had 52 wines. The
hosts are clean: the twin has no process, the claim is released, the worktree and env are
removed; on bbs the giver is logged out and its env and clone deleted; neither name is listed.

Two harness findings (rs/147), neither in this module:
- The summary's row for a step that spans in-page relogs read 212, the page's end tick. The
  page count runs on across in-page sessions, so the step's span is end − start.
- `rehearse.ts` gives the resume walk no module probes, so a step that declares one (S25c's
  `wineBank`) can't be resumed there.
