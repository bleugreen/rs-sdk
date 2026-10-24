# Tick audit long shot L1: delay-free xp actions, stacked actions and offline progression

Issue cairn://p/rs/655 (parent rs/158). This is a read-only engine and content scan. No code, test or
run-order document changed. No demo login. No lab run: every tick figure here is read or
inferred, and each candidate names the lab probe that would settle it. **Any long shot that reaches
the run needs its own lab pass.**

Paths are under `server/engine/src/` (engine) or `server/content/scripts/` (content) unless
stated otherwise. The source is this branch's base, 1e536f76968.

| Label | Meaning |
|---|---|
| **m** | measured, as the cited document reports it |
| **r** | read from a script or engine line |
| **i** | inferred: arithmetic shown here, from m and r inputs |
| **e** | estimated by judgement |

The rs/61 sweep ([engine-sweep/engine.md](../engine-sweep/engine.md) and
[engine-sweep/skills.md](../engine-sweep/skills.md)) already holds the packet rules and the
per-row xp census. This page does not repeat them. It answers the two questions against the
run as priced in RUN-ORDER.md today, and adds the mechanisms that sweep left open: the queue
iterator quirk, the handlers' return values, the level-up queue, the login tick and
real-time catch-up.

## Answer in one paragraph

Every skilling action the issue names is either **already in the run at its engine floor** or
**capped by a delay that no packet can bypass**. The 5-per-tick delay-free actions (gem cutting,
arrowtips, bow stringing, herb identify and mixing, needle on hard leather, wine making, Charge)
are already on the route at 5 a tick. Bury, smelting, the anvil, cooking on a range, enchant,
alchemy and superheat all reach a `p_delay` or a `%action_delay` weak queue, and **every handler
drops the packet while the player is delayed**. No handler runs a script and then returns false,
so nothing escapes the 5-event cap. The level-up page that throttles booth work sits on the
engine queue, which no packet clears. The one real lever is in the wine. **The two-firing split
was designed and priced from Cooking 1**, where each bank batch rolls at 19%. **The run reaches
S25c at Cooking 30**, where a batch rolls at 54%, and **a single firing of the same 520 wines
reaches 99 in 97.9% of firings** (i, below). Hosted inside S25e's mixing, that takes about
**45-52 ticks** off the S25 block (i). For offline progression, wine is still the only thing that
moves SCORED's xp. Managing Miscellania catches up in real time, but it pays resources, needs
Throne of Miscellania, and its interval is 24 real hours.

## 1. Ranked table (payoff x plausibility)

Saved ticks are against the RUN-ORDER rows: **S25c 81 m** (rs/339, lab, browser: 77 / 85 / 81,
107 gems cut inside it), **S25d 91 i** and **S25e 167 m**.

| # | Candidate | Mechanism (file:line) | Steps it replaces or shortens | Ticks saved if it works (arithmetic) | Plausibility | Cheapest probe that settles it | Owner |
|---|---|---|---|---|---|---|---|
| 1 | **One wine firing at Cooking 30, hosted inside S25e's mixing** | The bank batch roll reads the current level for each of the 15 batches (`wine.rs2:30-35`, `stat_random` `PlayerOps.ts:591-599`). At Cooking 30 the value is 138/256 = 53.9% (r). One success adds 34 x 110 base and lifts Cooking past 70, where the value is 256 or more, so every later batch succeeds (i). Any login arms the timer (`login.rs2:70`, `wine.rs2:72-73`). The timer runs in step 4 *before* the engine queue (timers then engine queue, `World.ts` step 4 per engine.md 1.1), so a mixing tick, whose OPHELDU closed the last page (`OpHeldUHandler.ts:86`), lets it fire on time (i) | S25c as a separate step; the 107 window gems move back to S25d | **~45-52 i**. S25c's 81 is replaced by about 29: the noted wines join S25e's opening hand-off (+0 to +5: 0 if they share an existing trade, a separate trade 4-7 m, cooking.md:406), the 520 deposit is one All event inside S25e's first booth burst (+0-1 i), the arming relog at the booth (+1-2 m, cooking.md:382), about 11 Cooking pages at one booth stall each (11.0 mean, model below, at the herblore.md:325 rule of one stall per extra page, m) and the 107 gems standalone in S25d (+15-16, the windows' measured saving, cooking.md:385-387). 81 - (0.5..5 + 1.5 + 11 + 16) = 47-52, less the shortfall risk 2.2 (below): **~45-50** | **medium-high**: the odds are exact from source (the same model gives 65.2% for one firing at Cooking 1 against wine.md's own 65.0%); the open parts are the page-stall count with Herblore and Cooking pages mixed, and the precondition reorder (S25c currently requires S25e done, cooking.md:364) | (a) odds, 10 min: lab, `::setstat cooking 30`, 520 unfermented wine banked by staff give, relog, read Cooking xp at login + 20; 20 trials should give about 19-20 at 99. (b) ticks, 30 min: herblore's L1 lab (herblore.md:363, step 167) with the wine notes in the opening trade, the deposit in visit 1 and a relog after it; pass if S25e + wine <= 167 + 16 | rs/186 (cooking.ts, herblore.ts); rs/41 for the trade stack |
| 1c | Same, **keeping the 29 + 491 split** but hosted in S25e (zero change in odds) | As 1, with two firings and two relogs | as 1 | **~30 i**: 81 - (2 relogs 3 + 2 deposits 1 + pages 18.7 + 11.0 + gems 16) = 31 | **high**: no new odds; only the hosting is new | the (b) lab of row 1 with the split | rs/186 |
| 1a | Same single firing, **left in S25c** (no reorder) | As 1 | S25c's P1, relog 2 and W2 | **~28 i**: removes P1's 17 + relog 2's 1 + W2's 20 = 38 from the critical path (cooking.md:402-412, m phases), loses about 54 window gems at 15.5/107 a gem = 8 (i), less risk 2.2 | **high** | `cooking-accept.ts run` with the split's `first` set to 520 (an option plumb, `SplitOptions.first`, `wine-receive.ts:540-541`), 3 reps, about 25 min | rs/186 |
| 2 | Re-arm the second firing by a squeeze *under* P1's pages, not after the rest deposit | `make_wine` arms the same timer (`wine.rs2:8,20`; Cooking 35, met after the first firing). Re-setting a timer restarts its clock (`Player.ts:985-996`). Today's `'make'` arming squeezes only after the deposit (`wine-receive.ts:636-649`), which saves just the relog | S25c (if 1 is not taken) | **~0-7 i**: the second firing moves from firing + ~39 to ~+24 (-15), but W2's ~54 window gems go back to S25d (+8). The rest deposit must land by squeeze + 20 while P1 holds the booth for ~17-19 pages (C30 model mean 18.7), so a late deposit costs a +21 recovery | **low-medium**: a tight deadline, and the net is near zero | the lab of 1a with arming moved before the deposit | rs/186 |

The single-firing risk, in numbers (i, 2-3 x 10^5 Monte Carlo trials on the engine's curve,
`speedrun/lib/xp.ts` = `Player.ts:77-85`, and its roll; start at 7,500 game xp, S23's grant):

| Wines | Held back for a second firing | P(99 in the first firing) | P(second firing needed) | P(short of 99 after both) | Mean shortfall when short | Expected fallback ticks at ~40 base a tick |
|---|---|---|---|---|---|---|
| 520 (held today) | 0 | 97.9% | - | 2.1% | 4,272 base | 2.2 |
| 520 | 60 | 95.2% | 4.8% | 1.0% | 5,071 base | 1.3 |
| 615 (+95) | 100 | 97.9% | 2.1% | 0.2% | 5,186 base | 0.3 |
| 29 + 491 split (today) | - | - | always | 0.001% | - | 0 |

At Cooking 30 one firing tolerates the first 4 batches failing (520 wines: 34 a batch, 361
needed, (15 - k) x 34 + 10 >= 361 for k <= 4), so P(short) = 0.461^5 = 2.1% (i). A shortfall
leaves Cooking at 45-97 (i). The ~40 base a tick fallback is SK:cooking's fish rate (980 i for
39,638 base). A second wine delivery would be cheaper if rs/41 holds spare wine. The mean pages
per firing are 11.0 for one firing and 18.7 + 11.0 for the split (i).

## 2. Specs for the top candidates

### 2.1 One wine firing at Cooking 30, inside S25e (rows 1 and 1c)

Move the wine from its own step into S25e's booth loop at Varrock west. The giver's 520 noted
unfermented wines ride the opening herblore hand-off as one extra stack (one slot). If S25e has no
trade, they ride a separate trade at the booth on SCORED's first booth visit. In that first booth
burst, SCORED deposits the wine stack with one All (one more INV_BUTTON event in the 5-event
burst), then makes one in-page relog at the booth (the arming relog: `login.rs2:70` sets
`fermenting_wine` at login + 20), and goes straight back to the mixing loop. The timer fires on the
first step 4 at or after login + 20 with no modal open. A mixing tick qualifies, because the
OPHELDU at decode closed the last page and timers run before the engine queue reopens the next.
So the fermentation needs no wait of its own (i). All 520 roll at the Cooking 30 batch odds above.
The ~11 Cooking level-up pages then share S25e's page stalls (herblore.md:325, one booth tick per
extra page). S25d cuts the 107 gems the windows used to host, standalone. Code changes for the
builder: S25c's preconditions (`cooking.md` section 9: S25e done, the crafting hand-off
`craftingAfterWindows`), a `first: 'all'` or `receiveWine` path in `skills/cooking.ts`, a wine
hook in herblore's booth burst, and the resume table (`splitStage` already maps 'unfermented
only' to `await-first`). 1c is the same with the split kept (deposit 29, relog, fire, bank the
rest on a later visit, relog, fire). It costs about 20 ticks more and changes no odds.
**Lab acceptance:** on a local engine at 400 ms, S25e's L1 fixture (Herblore 28, the
supply-safe notes) plus Cooking 30 and 520 noted wines in the hand-off, 3 reps: Cooking 99 and
Herblore 99 in every rep, both firings or the single firing at login + 20 to + 23, and S25e's step
ticks at or below 167 + 16 (the wine's cost cap, which still beats S25c's 81 + the gems' 16). Plus
the odds check of row 1(a), 20 single firings from Cooking 30 at 19 or more reaching 99. A run that
fails either keeps today's S25c.

### 2.2 Single firing left in S25c (row 1a), the minimal change

If the reorder is unwelcome, keep S25c where it is and set `first` to the whole delivery.
Relog 1, trade, deposit 520 with one All, W1 with the 26 gems, the firing at login + 20, then the
P2-style booth cycle that closes the ~11 pages with gem cuts and stows. Relog 2, P1 and W2
disappear. **Lab acceptance:** `cooking-accept.ts run` (Cooking 30, the fleet's gems, chisel
banked), 3 reps: Cooking 99 every rep, the firing at login + 20, step ticks at or below 53
(81 - 28). The odds check of 1(a) as above.

## 3. Question A: per action, what N packets in one tick do

The engine rules that decide every row (r, details in engine.md sections 1-2):

- **Cap.** `decodeIn` stops after 5 successful USER events, 20 client events or 2 restricted
  ones (`NetworkPlayer.ts:69`). A handler's return value decides the bucket (`:138-147`). The
  excess stays in the socket and is decoded first next tick. rs/507 measured 5 / 6 / 8 drags
  landing 5 then 0 / 1 / 3.
- **Order.** Packets are decoded and run in arrival order at the top of the player's turn. Held,
  item-on-item and button scripts run inside the handler. Loc, NPC and object ops only set a target
  that runs once in step 4, and the last op of the tick wins (engine.md 3.1-3.2).
- **Serialisation.** There is no per-player action queue for packets. The only serialiser is
  `delayed`: OPHELD, OPHELDU, OPHELDT, INV_BUTTON and every OPLOC, OPNPC and OPOBJ return false
  while delayed (`OpHeldUHandler.ts:16-19` and the matrix in engine.md 2.2). A `p_delay(n)` from a
  packet on T drops packets on T+1..T+1+n, and the next is accepted on T+2+n. `busy` (a main or
  chat modal) does not drop held ops, which close the modal instead (`OpHeldUHandler.ts:86`).
- **Weak vs strong queue.** Skill loops use the weak queue with `%action_delay`. Any held op, loc
  op or walk calls `closeModal()`, which **clears the weak queue** (`Player.ts:817-820`). The normal
  and strong queues survive it, and a strong entry closes modals first (`Player.ts:931-946`). No
  skill product loop uses the normal or strong queue (grep of `skill_*` for `queue(` finds only
  combat damage, poison, death and the stall timers).

| Action | Handler (grant line) | Guard before or after the grant | N packets in one tick | In the run today |
|---|---|---|---|---|
| Bury bones | `[opheld1,_bones]` `bury_bone.rs2:1`, grant `:15` | `p_stopaction; p_delay(0)` **before** the grant (`:8-10`) | **1** bury; the rest are dropped (m, rs/67: 5 clicks bury 1; one click a tick buries every 2 ticks) | S25b inside S07, 145 i (trades only) |
| Cut gems | `uncut_gem.rs2:1`, grant `:63` | none | 5 (r; m for the same handler class, identify, 5 + 5) | S25d, S25c windows |
| Arrowtips, headless arrows | `arrows.rs2:2,9,15`, grants `:85`, `:46` | none | 5 (r; main verified rune arrows) | S18d inside the stuns |
| Arrow shafts, bows (knife on log) | `cut_logs.rs2:38-47` menu, `:83-86` | `%action_delay = map_clock + 2`, weak queue | 1 product per 2-3 ticks; one menu completion a tick (`chat.rs2:734-738`) | the knife-cycle trick only |
| Stringing bows | `bows.rs2:2,8`, grant `:41` | none | 5 (r) | no (arrowtips pay more per stackable slot) |
| Darts | `darts.rs2:2`, grant `:61` | none | 5 (r) | no |
| Herblore identify | `identify.rs2`, grant via `herblore.rs2:7` (`identify.rs2:73`) | none | 5 (m, rs/67) | n/a (the run buys unf potions) |
| Herblore unfinished potion | `brew_potion.rs2:1,14` | multi menu + delay (census, engine.md 5.1) | 1 a tick at most | no |
| Herblore finished potion | `brew_potion.rs2:98-147`, grant `herblore.rs2:24` | none | 5 (m, herblore.md:130: 5 on full ticks, 4 on the booth tick) | S25e, 167 m |
| Cooking on range or fire | `cooking.rs2`, grant `:180` | `p_delay(1)` before the grant | 1 per 3 ticks (r) | no (wine) |
| Wine (make) | `wine.rs2:1-20` | none; arms the timer | 5 (m, rs/67) | the helpers |
| Wine (ferment) | `[timer,fermenting_wine]` `wine.rs2:22-70` | normal timer: needs `canAccess` (`Player.ts:1010`) | every bank and inventory jug in one tick | S25c, 81 m |
| Hard leather body (needle) | `leather.rs2:120` | none | 5 (r) | S25d's 928 bodies |
| Dragonhide and leather menu | `leather.rs2:142` | weak queue on `%action_delay` | ~1 per 3 ticks | no |
| Spinning | `spinning.rs2:87,98` | weak queue, 3 then 2 | ~1 per 2-3 ticks | no |
| Smelting | `smelting.rs2:114` (`p_arrivedelay`), `:157-162`, grant `:224` | `%action_delay + 3`, weak queue, re-queue at 4 (`:227`) | 1 per ~3-4 ticks | no |
| Anvil | `smithing.rs2:1-36` (INV_BUTTON) -> `:271-301` | `p_delay(1)`, grant (`:283`), `p_delay(2)`, recurse | **1 item per 5 ticks**; INV_BUTTON is dropped while delayed (`InvButtonHandler.ts:15-18`) | S25a, 940 |
| Superheat | `[opheldt,magic:superheat_item]` `superheat.rs2:1`, grant `:54-60` | grant, then `p_delay(1)` (`:67`) | 1 per 3 ticks; on its tick, the cast can come last after 4 delay-free actions | S18, cast last |
| Enchant | `enchant.rs2:1-5`, grant `:41-43` | grant, then `p_delay(1)` (`:53`) | 1 per 3 ticks | S04, gaps 3 (m) |
| High alchemy | `alchemy.rs2:1`, grant `:22-23` | grant, then `p_delay(3)` (`:37`) | 1 per 5 ticks | no |
| Low alchemy | `alchemy.rs2:2`, grant `:58-59` | grant, then `p_delay(1)` (`:69`) | 1 per 3 ticks | no |
| Charge | `charge.rs2:1-27` | no delay; `p_finduid` (`:3`) needs `canAccess` | 5 (m, rs/67, rs/507) | S18c inside the stuns |

**Prayer, directly (the issue's question).** No. Bury is a hard 2 ticks a bone, because the
delay comes before the grant and every OPHELD is dropped for the next tick. Prayer 1-99 standalone
would be 39,938 / 72 = 555 dragon bones x 2 = 1,110 ticks at best, or about 1,928 for the staged
964 mixed bones (i). Inside S07 it costs 145 i. No other Prayer source beats it: the only other
`stat_advance(prayer` grants are quest rewards and the Mort'ton pyre (`mortton_pyre.rs2:202`).
There is no Ectofuntus in this revision.

## 4. Question C: stacking two actions in one tick, and offline progression

**Stacking.** engine.md 3.3 lists every overlap path (O1-O11) and the run already uses the
productive ones: held ops before a click (knife cycles), an overlay-tab button beside a loop (Charge
in the stuns), a timer beside an interaction (the cannon timer beside melee in S14 and S27, the wine
beside the gem windows), and a delay-free action before a delayed cast (Superheat last in S18). The
new checks on this page:

- **A grant inside another action's delay** is impossible. During a `p_delay` only IF_BUTTON,
  RESUME and CLOSE_MODAL are accepted. The only overlay-tab buttons that grant xp, Charge
  (`charge.rs2:3`) and Bones to Bananas (`convert_bones.rs2:6`), take `p_finduid`, which fails
  while delayed (`PlayerOps.ts:78-97`). So nothing rides the anvil's 5-tick delay chain or the
  bury's delay.
- **Superheat stacked into the anvil cycle** is impossible both ways. A held op or OPHELDT
  before the INV_BUTTON closes the smithing modal (`clearPendingAction`), so the button is
  refused as not visible. After the INV_BUTTON the player is delayed, so the OPHELDT is dropped.
- **Two skill queues at once** cannot happen. Two weak entries could coexist only if one were
  added without a `closeModal`, and every skill loop starts from a held op, a loc op or a menu
  that clears the weak queue (`Player.ts:817-820`).
- **Spare delay-free slots in the stuns** total about 198 (i: 7.8 x 84 = 655 slots against 457
  used, SP section 2 and S18d's row). Only stackable inputs fit a full stun inventory
  (arrowtips, darts, bolts, runes), and Fletching and Magic already reach 99 there. Herblore and
  gem inputs do not stack. Worth 0.

**Offline and login-tick progression.**

- Player timers run only while logged in (`processPlayers`). The login hook
  (`login.rs2:1-94`) re-arms timers (stat regen, boost restore, wine at `:70`), stall timers and
  quest state. Only the wine affects xp, and its hook only calls `settimer(fermenting_wine, 20)`
  (`wine.rs2:72-73`). Nothing is granted on the login tick itself. That tick runs in
  `processLogins` after the tick's `playtime++` (engine.md 1.1), so an immediate grant there would
  have been free.
- Of the 63 `[timer` and `[softtimer` scripts in the content, only `fermenting_wine` advances a
  skill. The others are environment damage, quest traps, the cannon, regen, poison and decay
  (grep `^\[(timer|softtimer),`).
- **Managing Miscellania** (`managing_miscellania.rs2:145-185`) is the one real-time catch-up in
  the revision. It runs on `date_minutes`, in steps of `^MISCELLANIA_INTERVAL` = 1,440 minutes
  (`managing_miscellania.constant:1`), up to 30 steps. But it needs `%misc_quest` complete
  (`:146`) and pays noted resources, not xp, and the island's own gathering pays 0.1 base a
  success (`weed_herbs.rs2:54`). Worth 0 to SCORED.
- `%last_logout` (`logout.rs2:9`) is read only by Castle Wars (`castlewars.rs2:250`).

## 5. Ruled out, with what was checked

| Idea | What was checked | Why it cannot pay (ticks) |
|---|---|---|
| A handler that runs a script and returns false, so the packet is charged to the 20-event budget | Every script-running handler: `OpHeldUHandler.ts:117-128`, `OpHeldHandler.ts:68-73`, `OpHeldTHandler.ts:63-73`, `InvButtonHandler.ts:58-63`, `InvButtonDHandler.ts:52-57`, `IfButtonHandler.ts:39-48`, `ResumePauseButtonHandler.ts:20-21`, `ResumePCountDialogHandler.ts:17-18` | All return true after the script. The one false-after-side-effect path, OPHELDU's members refusal (`OpHeldUHandler.ts:88-91`), runs no script. **0** |
| The queue speedup quirk (`Player.ts:948-953`) turning a skill loop into several actions a tick | `LinkList.all()` caches the next link before each yield (`LinkList.ts:97-111`); the weak queue uses the same iterator (`Player.ts:973-983`) | An entry appended during the pass is visited in the same pass only if another entry trails it. A skill loop holds one entry, and a second cannot be added without a `closeModal` clearing both (`Player.ts:817-820`). Even when it applies, the effect is one early decrement of a fresh entry's delay, not a repeat. No step on the route uses a weak-queue product loop as its xp source. **0** |
| Removing S25e's level-up booth stalls (41 of its 167 ticks, herblore.md:363) | `[advancestat]` is enqueued on the **engine** queue (`Player.ts:1944-1946`). The engine queue runs in step 4 before the interaction (engine.md 1.1), one entry per tick while `canAccess` (`Player.ts:713-723`). The page opens a chat modal and pauses (`levelup.rs2:54-55`). `closeModal` clears only the weak queue | Each pending page reopens before the booth interaction every tick, and nothing a packet does removes it. The stall is about level-ups less visits (71 - 30). The hiscore stamp is taken in `addXp` (`Player.ts:1905`), so pages never move it. **0** |
| A faster anvil (S25a, 940) | `smithing.rs2:271-301`: `p_delay(1)`, grant, `p_delay(2)`, recurse in the same resume, so there is no undelayed tick between items | 5 ticks an item is the floor. The platebody's 5 bars is the most xp per item. Superheat pays 37.5 base per 3 ticks (adamantite) against the anvil's 312.5 per 5. **0** |
| A quest Smithing lump | `stat_advance(smithing` grants: Knight's Sword `quest_squire.rs2:223` (12,725 base), Elemental Workshop `quest_elemental_workshop.rs2:275` (5,000), Tourist Trap's reward `irena.rs2:86` (4,650), Hero's Quest `quest_hero.rs2:38` (2,275) | Already priced by the quest audit: Knight's Sword costs ~911 ticks to play against ~236 ticks of Smithing saved (`quests/README.md:313`, OFF). rs/185's domain. **-601** |
| Herblore or gems riding a gathering loop (overlap O1) | O1 is legal (engine.md 3.3). Inputs: an inventory of ~20 free slots in S09 or S22 holds ~10 mix pairs; a mid-loop trade costs 4 (m, rs/141) | 0.4 ticks a mix in trades, against 0.4 a mix at the booth (14 mixes in 3 ticks plus ~2-3 at the booth). It breaks even before adding the gathering loop's lost ticks to each level-up page. **<= 0** |
| Agility arena tickets, genie lamps | free-xp.md section 2 | Untradeable (`agilityarena.obj:15`, `xplamp.obj:12-13`), and random events are off on the demo. **0** |
| Prayer from a better source | `stat_advance(prayer` grants (section 3) | Quest rewards and the pyre only; no Ectofuntus. **0** |
| Wine on the login tick | `wine.rs2:72-73` | It only arms the 20-tick timer. **0** |

## 6. Provenance

Every line citation was read at 1e536f76968. The wine odds come from a Monte Carlo of the
engine's own `stat_random` (`PlayerOps.ts:591-599`) and level curve (`Player.ts:77-85`, as
`speedrun/lib/xp.ts`), run inline on the Linux x86_64 executor. They are not committed, so the
method is stated here: 2-3 x 10^5 trials a row, Cooking starting at 7,500 game xp, 110 base x 25
per success, the bank in 15 batches of floor(n/15) then n mod 15 singles, as `wine.rs2:26-55`
does. The check against a measured anchor is that the same model gives 65.2% for one 520-wine
firing at Cooking 1, where `helpers/wine.md` gives 65.0%. Nothing here was measured on a lab
engine. Row 1's probe (a) is the first measurement it needs.
