# Herblore: fastest route to 99

Scripts: [`delayfree-cycle.ts`](../scripts/delayfree-cycle.ts) (`--skill=herblore`, bank cycle
and actions per tick, fast and stock), [`delayfree-model.ts`](../scripts/delayfree-model.ts)
(`routes`, `levels`). Lab: [`delayfree-lab.sh`](../scripts/delayfree-lab.sh), delayfree port
block (WEB 9270, management 9271, hiscores 9272, node 43970, agent 8170). Labels follow
[README.md](README.md#labels) on rs/2's branch.

**Host and rate.** Every measured figure here was taken on **bbs** (Linux, 32 cores, shared
with helper labs) at **`NODE_TICKRATE=300`** with the headless lite client, at Varrock west bank
(booth (3186,3436), player on (3185,3436)). No figure comes from the Mac executor.

**Client.** The scored run drives the browser webclient against the demo, where each reaction to
observed state costs 1-2 more ticks through the SDK relay from home and about 0.15 from Ashburn
(rs/2; `docs/speedrun/LAB.md` on main, "Which client a number was taken on" and the host-latency
table under "Running several labs on one machine"). The 4-tick cycle has **1 reaction per 14
potions**: withdraw, deposit, withdraw and close go out on the tick the bank is seen open
(section 1). The mixes are blind, 5 per tick. Totals are not re-derived for the webclient.

## 1. Recommendation

**Druidic Ritual is a hard prerequisite.** Every Herblore action needs level 3 by default, and
nothing below level 3 gives Herblore xp except quest steps (section 3). So the scored account
starts Herblore at **level 28** after Druidic Ritual's 250 base. rs/3 has put Druidic Ritual on the
route for this reason; Digsite and Watchtower are off it ([quests README](../quests/README.md)
sections 1 and 4; Druidic Ritual is step 12). **On-route: 28 -> 99 = 112 ticks** (measured).

Then mix finished potions at a bank booth, 14 unfinished potions + 14 secondaries per
inventory, 5 mixes per tick, best potion per band (super strength 55, super defence 66,
ranging 72, Zamorak 78). The bank visit is one tick: the booth click goes out with the last
mixes, and on the tick the bank is seen open the script sends withdraw-All of the secondary,
deposit-All of the potions, withdraw-All of the unfinished potions and close. Mixing resumes the
next tick. The steady cycle is **4 ticks per 14 potions**.

| Start | Ticks to 99, fast script | Ticks to 99, stock SDK | Basis |
|---|---|---|---|
| **28 (Druidic Ritual, 250 base), the on-route start** | **112** | about 381 | fast measured (1 run); stock inferred (18 cycles x 21.1) |
| 57, only if Digsite (and Watchtower) return to the route (about 2,280 base) | 84 | about 338 | fast measured (1 run); stock inferred |
| 66 | **77** | **317** | measured, 1 run each |
| 1 without Druidic Ritual | impossible | impossible | read (section 4) |

Supply decides the top tier, not playtime (section 7). Zamorak potions need torstol, whose only
source in the content is a keyed chest. From 28, **capping at ranging potions costs about 1 cycle,
5 ticks**; capping at super defence about 2 cycles, 10 ticks (inferred). Pick the cap by what
helpers can actually gather.

### Summary row

rs/2's columns for the Item-fed skills section of `docs/speedrun/skills/README.md`; column 5
is "with interleaving (net)", n/a where nothing is absorbable net (section 5).

| Skill | Headline method | Start level (on-route quests) | Ticks to 99, normal | Ticks to 99, with interleaving (net) | Basis | Helper supplies | Document |
|---|---|---|---|---|---|---|---|
| Herblore | mix finished potions at a bank booth, 14 + 14 per inventory, 5 per tick | 28 after Druidic Ritual's 250 (mandatory; [quests README](../quests/README.md) step 12) | 112 from 28 (about 117 with the ranging cap) | n/a: no net absorption (two slots per potion, 71 level-ups; section 5) | measured (bbs, 1 run) | 245 unfinished potions and secondaries by band, 245 vials; torstol is effectively unobtainable, so the realistic list caps at ranging (208 dwarf weed unf + 208 wine of Zamorak) | herblore.md |

## 2. Route by level band

Base xp per potion is `brew_potion_exp` / 10 (`brew_potion.struct`, read). Ticks per action
0.2 (5 per tick) is measured on every work tick (4 or 5 landed on each). "Ticks for band" is
inventories x the measured mean cycle of 5.07 ticks (inferred from the measured cycle; the
end-to-end runs are in the totals table).

| Band | Potion (unfinished + secondary) | Unlock | Base xp | Ticks / action | Base xp / tick (in cycle) | Actions from 28 | Actions from 57 |
|---|---|---|---|---|---|---|---|
| 3-12 | Attack (guam unf + eye of newt) | Herblore 3 (struct default, `brew_potion.param`) | 25 | 0.2 | 69 | | |
| 12-26 | Strength (tarromin unf + limpwurt root) | 12 | 50 | 0.2 | 138 | | |
| 26-30 | Energy (harralander unf + chocolate dust) | 26 | 67.5 | 0.2 | 186 | 1 | |
| 30-45 | Defence (ranarr unf + white berries) | 30 | 75 | 0.2 | 207 | 8 | |
| 45-55 | Super attack (irit unf + eye of newt) | 45 | 100 | 0.2 | 276 | 10 | |
| 55-66 | Super strength (kwuarm unf + limpwurt root) | 55 | 125 | 0.2 | 345 | 17 | 16 |
| 66-72 | Super defence (cadantine unf + white berries) | 66 | 150 | 0.2 | 414 | 14 | 14 |
| 72-78 | Ranging (dwarf weed unf + wine of Zamorak) | 72 | 162.5 | 0.2 | 449 | 20 | 19 |
| 78-99 | Zamorak (torstol unf + jangerberries) | 78 | 175 | 0.2 | 483 | 175 | 175 |
| **Total** | | | | | | **245** | **224** |

"Base xp / tick (in cycle)" is 14 x xp / 5.07 ticks. Intermediate potions (antipoison 5,
restore 22, agility 34, prayer 38, fishing 50, super energy 52, weapon poison 60, super
restore 63, antifire 69, magic 76) each lose to the row above them by a few xp per potion
and add a supply line; dropping them changes the totals by at most one inventory (inferred).

End to end (measured, `delayfree-cycle.ts --skill=herblore`):

| Run | Span | Base xp/tick | Bank cycles | Open-to-open gaps (ticks: count) |
|---|---|---|---|---|
| 66 -> 99, fast | **77 ticks** | 468.2 | 15 | 4: 3, 5: 9, 6: 1, 8: 1 (mean 5.07) |
| 57 -> 99, fast | **84 ticks** | 454.2 | 17 | 4: 9, 5: 3, 6: 1, 7: 2, 10: 1 (mean 5.06) |
| 28 -> 99, fast | **112 ticks** | 358.4 | 18 | 4: 6, 5: 6, 7: 2, 10: 1, 13: 1, 15: 1 (mean 6.24) |
| 66 -> 99, stock SDK | **317 ticks** | 113.7 | 15 | 20: 1, 21: 11, 22: 1, 23: 1 (mean 21.14) |

## 3. Quest xp

| Quest | Herblore (base, read) | Start level | On route? |
|---|---|---|---|
| **Druidic Ritual** | 250 (`quest_druid.rs2:3`) | **28** | **yes, mandatory** (moved onto the route by rs/3 for this finding) |
| Watchtower | 10 per ogre-potion step, 3 steps (`ogre_potion.rs2:52,81,87`); the steps need Herblore 14 (`watchtower.md` on rs/3's branch) | +30 | **off route** (rs/3 quest README, section 1) |
| Digsite | 2,000 (`quest_itexam.rs2:42`) plus 2.5 per chemistry mix (`itexam_chemistry.rs2:35,49,68`); the mixes need Herblore 10 | 56 alone, 57 with Druidic Ritual | **off route** (rs/3 quest README, section 1) |
| Jungle Potion | 775 (`quest_junglepotion.rs2:74`) | | off route |
| Heroes' Quest | 1,325 (`quest_hero.rs2:40`) | | off route |
| Eadgar's Ruse | 11,000 (`quest_eadgar.rs2:595`) | 79 | not costed by rs/3 |
| Shades of Mort'ton | 335 + 2,000 (`quest_mortton.rs2:55,66`) | | not costed |

**Hard dependency: Druidic Ritual must be on the route** before any Herblore training (and before
Watchtower or Digsite, which need Herblore 14 and 10, if either returns to the route):

- `brew_potion_level` defaults to 3 (`skill_herblore/configs/brewing/brew_potion.param:1-3`).
  The attack potion and every unfinished potion without an explicit level (`unf_guam_potion`,
  `3dose1attack` in `brew_potion.struct`) use it, and `attempt_brew_potion` refuses below it
  (`brew_potion.rs2:120-134`).
- `identified_herb_level` defaults to 3 (`identifying/identify.param:1-3`); guam has no
  explicit level (`herbs.obj:1-17`), and `attempt_identify_herb` refuses below it
  (`identify.rs2:65-72`).
- The only Herblore xp a level-1 account can earn: Druidic Ritual (250), Miscellania weeding (0.1
  base per action, `weed_herbs.rs2:54,92`, needs the Fremennik kingdom), and quest steps that
  themselves need Herblore 10 or 14.
- Measured: at Herblore 1 the attack-potion mix sends cleanly and does nothing; the ladder run
  from level 1 cycled the bank for an hour with no xp.

**On-route start: 28** (Druidic Ritual only), 112 ticks to 99 (measured). If Digsite (and
Watchtower) return to the route, train Herblore after them: 57 -> 99 is 84 ticks, 28 fewer
(measured). Their Herblore gates (10 and 14) are already covered by Druidic Ritual's 28.

## 4. Mechanics

- **Delay-free mixing.** OPHELDU of a secondary on an unfinished potion runs
  `~attempt_brew_potion` (`brew_potion.rs2:98-147`) -> `~brew_potion` (`herblore.rs2:10-24`):
  delete both, add the potion, award xp. No `p_delay`, queue or `%action_delay`. There is no
  Druidic Ritual varp check anywhere in mixing or identifying (`brew_potion.rs2`,
  `identify.rs2:58-73`); the level-3 default is the gate.
- **5 per tick.** OPHELDU is a USER_EVENT, 5 decoded per tick (`ClientGameProtCategory.ts:6`),
  the surplus queued to the next tick. Measured: 4 or 5 mixes landed on every work tick (5 on
  the full ticks, 4 on the tick that also carries the booth click).
- **Fixed slots.** With 14 unfinished potions in slots 0-13 and 14 secondaries in 14-27, mix i
  sends `secondary@14+i on unf@i`. `inv_del` removes the first matching item and `inv_add` fills
  the first free slot, so the potion lands in slot i and the next pair is untouched
  (`herblore.rs2:11-14`). The script fires all mixes without waiting for state.
- **The bank visit (fast).** Withdraw-All fills free slots only, so with the 14 potions still in
  slots 0-13, withdraw-All of the secondary fills exactly 14-27; then deposit-All of the potion
  (one INV_BUTTON4 on `bank_side`, `bank_deposit.rs2:4`), withdraw-All of the unfinished potion
  into 0-13 (`bank.rs2:4`), close (CLOSE_MODAL). Four packets, one tick. No count dialog.
- **Packet floor.** 14 mixes + booth click + 4 bank packets = 19 user events = 4 ticks at 5 per
  tick, and the booth click must be decoded a tick before the bank packets. That counts the
  booth click as one event, which holds for the lite client's bare OPLOC. The browser client's
  `interactLoc` routes first and writes a MOVE_OPCLICK ahead of the OPLOC even from the adjacent
  tile (`Client.tryMove`), so its click is two events and the floor becomes 5 ticks unless the
  click is sent unrouted (section 9). The measured
  steady cycle is that floor (4-tick gaps). Mixing must wait one tick after the close because
  the lite client fills an OPHELDU's item ids from its own inventory view, which updates a tick
  later (`server/webclient/src/lite/actions.ts`, `useItemOnItem`).
- **Level-up boxes.** Each OPHELDU closes the chat modal (`clearPendingAction` in
  `OpHeldUHandler.ts`), so mixing never stalls. But a level-up is a queued `p_pausebutton` script
  per xp drop that gains a level, however many levels that drop crosses
  (`levelup/scripts/levelup.rs2`; [levelup-cost.md](../research/levelup-cost.md) section 1), and
  while one is open the booth interaction waits; only one can be cleared per tick. When the last burst of an inventory crosses several
  levels the bank opens a few ticks late. This is the 5-15 tick gaps in the low-level runs and
  why 28 -> 99 averaged 6.2 ticks per cycle against 5.1 from 57. The script answers the dialog
  and re-clicks the booth every tick.
- **Stock SDK.** `bot.openBank`, `bot.depositItem`, `bot.withdrawItem` (X = 14, count dialog),
  `bot.closeBank`, then one awaited `sendUseItemOnItem` per potion with a wait for the
  inventory to change: 1 mix per tick and 6-9 ticks from booth click to refilled inventory, 21.1
  ticks per cycle (measured).

## 5. Alternatives considered

- **Trade instead of bank** (the scored account away from a bank): a helper's in-trade swap
  (14 unfinished + 14 secondaries in, 14 potions out, the rs/34 pattern) costs 5 ticks at the
  floor and 9 with the stock client (`primitives.md` section 6 on rs/3's branch), plus 3 mixing
  ticks: 8-12 ticks per 14 against 4-5 at a booth (inferred). Bank wins by about 2x; use trades
  only if the account is not at a bank anyway.
- **The scored account makes its own unfinished potions** (herb on vial of water, 0 xp,
  delay-free): 9 herbs + 9 vials + 9 secondaries per inventory, 18 actions per 9 potions, about
  5 ticks per 9 potions, roughly 1.7x the ticks (inferred). Only if no helper has the Herblore
  level for the unfinished potion.
- **Attack to 45, then super attack (guam/irit + eye of newt)**: 418 actions from 28 instead of
  245, 30 inventories instead of 18, about 60 more ticks (inferred: about 170 against the
  measured 112). Its secondary is a shop item, so this is the supply-safe fallback if no
  high-level herbs can be gathered.
- **Ranging cap** (no Zamorak potions): 258 actions from 28, about 5 more ticks. **Super defence
  cap**: 276 actions, about 10 more ticks (inferred).
- **Identifying herbs** (`identify.rs2`, OPHELD1, delay-free, 27 per inventory): torstol 15
  base, cadantine 12.5 (`herbs.obj`). About 48-60 base per tick, a tenth of mixing (inferred).
- **Grinding** (pestle and mortar) gives no xp (`herblore.rs2:27-36`).

**Interleaving** (`interleaving.md` section 8, the absorbable-fractions table): mixing is
delay-free, so all ~245 mixes fit by packets, but **net, none of it is worth absorbing**. Each
potion needs two non-stackable slots, so a load is 14 potions, and a top-up trade away from a
bank costs 5-9 ticks (`primitives.md` section 6) against the measured 4-tick bank cycle it
replaces. The trade costs more than it saves. Herblore's 71 level-ups from 28 would also cost
more Woodcutting than the 112 standalone ticks if they fell in a gathering loop
(interleaving.md section 5, measured). In pickpocket stuns the potions would displace the bones,
which are worth more per stun. Column 5 of the summary row is n/a against the plain pickpocket
loop, plain Woodcutting and the knife loop alike.

## 6. Gotchas

- **Below level 3 nothing works and nothing tells you**: the attack potion silently refuses
  (a mesbox, no xp). Do Druidic Ritual first.
- **Members only** (`brew_potion.rs2:106-109`).
- **Helpers need Herblore too.** Making an unfinished potion has the herb's level (kwuarm 55,
  cadantine 66, dwarf weed 72, torstol 78; `brew_potion.struct:49-82`) and identifying the herb
  its own level (54, 65, 70, 75; `herbs.obj`). So every potion helper also needs Druidic
  Ritual and training (its own playtime, which is free).
- **Keep a spare inventory of each supply in the bank.** Withdraw-All by bank slot is blind;
  an emptied stack reorganises the bank on close (`bank.rs2:25-35`) and shifts the slots.
- **Band changes** leave nothing behind when every inventory is a full 14: the potions in 0-13
  make the same withdraw-B-first trick work with the new pair.
- **Wrong order explodes only the Watchtower potion**, not these (that is `ogre_potion.rs2`).
- **Busy host.** bbs was running other labs; the fast runs still hit the 4-tick floor on most
  cycles, so the measured totals are a few percent pessimistic at most.

## 7. Helper supply list

Per 99 from level 28 (the on-route start, after Druidic Ritual), exact actions (245); add one spare
inventory (14) of each line if the scored account banks by fixed slot:

| Item | Quantity | Where helpers get it (read) | Scarcity on the demo (GE snapshot 2026-10-21) |
|---|---|---|---|
| Harralander potion (unf) + chocolate dust | 1 + 1 | Herblore 22 (harralander, herb drops); chocolate bars from Port Sarim, Yanille, gnome shops, ground with a pestle | easy |
| Ranarr potion (unf) | 8 | Herblore 30 (ranarr, herb drops) | herbs: no GE sellers |
| Irit potion (unf) + eye of newt | 10 + 10 | Herblore 45 (irit, herb drops); eye of newt from the Port Sarim magic shop (300, `port_sarim.inv:50`) | eye of newt easy |
| Kwuarm potion (unf) | 17 | helper with Herblore 55: kwuarm + vial of water; kwuarm from the herb drop table (`shared_droptables.rs2`) | herbs: no GE sellers |
| Limpwurt root | 17 | drops: druids, giants, hobgoblins, chaos druid warriors, tribesmen | no GE market |
| Cadantine potion (unf) | 14 | Herblore 66; cadantine from herb drops | no GE sellers |
| White berries | 22 (8 defence + 14 super defence) | 3 ground spawns (one deep in the Wilderness at (3214,3814)); drops from chaos druid warriors and Salarin | scarce |
| Dwarf weed potion (unf) | 20 | Herblore 72; dwarf weed from herb drops and the Miscellania kingdom | **contested**: a 7,000 gp bid for 839 dwarf weed, no sellers |
| Wine of Zamorak | 20 | one spawn at the Asgarnian Chaos Temple (telekinetic grab); Kalphite Queen drop | scarce |
| Torstol potion (unf) | 175 | Herblore 78; **torstol's only source is the sinister-key chest in the Yanille agility dungeon, one per key** (`agility_dungeon.rs2:101-124`) | **effectively unobtainable**: no GE market at all |
| Jangerberries | 175 | 4 bush spawns near Yanille (`maps/m39_48.jm2`) | slow |
| Vial of water (for the unf) | 245 | Karamja jungle store 50 in stock (`karamja.inv:48`), Ardougne, Shilo, Rellekka shops; or fill empty vials | easy |

**Realistic list (ranging cap)**, from 28 (258 actions, about 117 ticks): harralander unf 1 +
chocolate dust 1, ranarr unf 8, irit unf 10 + eye of newt 10, kwuarm unf 17 + limpwurt 17,
cadantine unf 14, white berries 22, **dwarf weed unf 208 + wine of Zamorak 208**, 258 vials of
water. Wine of Zamorak then becomes the hard line (one spawn). **Supply-safe list**, from 28
(418 actions, about 170 ticks): guam unf 27 + irit unf 391 + eye of newt 418 (Port Sarim magic
shop, 300 in stock, fast restock, `port_sarim.inv:50`).

If Digsite returns to the route and Herblore is trained after it (from 57, 224 actions): kwuarm
unf 16 + limpwurt 16, cadantine unf 14 + white berries 14, dwarf weed unf 19 + wine of Zamorak
19, torstol unf 175 + jangerberries 175, 224 vials.

**Hand-off.** Noted unfinished potions and secondaries in one trade (about 8-10 stacks; adjacent
helper 9 ticks stock, 5 floor), deposited at the training booth: one deposit-All per stack
(the noted stacks bank unnoted). The scored account must stand at a bank for the cycle.

## 8. Open questions

- **Herb supply rates.** The herb drop table and the Miscellania kingdom are the only herb
  sources apart from the keyed chest. How many herbs per helper-hour, and whether torstol is
  obtainable at all, belongs to the helper-supply issues under rs/41.
- **Digsite off the route.** If Digsite (and Watchtower) return to the route, training Herblore
  after Digsite saves 28 ticks (measured, 84 from 57 against 112 from 28).
- **Level-up stalls** cost one tick per level-up page still queued at the booth click: a load
  whose mixes gain u levels delays its bank visit by about u - 1 ticks (measured, section 9).
  A route that banks on a tick where no page is pending would remove them; not tried.
- **Production latency** is not measured; a late packet is queued to the next tick, not
  dropped, so the worst case is a slipped tick per burst.

## 9. Module

S25e (STEP-MANIFEST.md entry 27) is `speedrun/skills/herblore.ts`. It runs on the page's
`item-cycle` program (`server/webclient/src/bot/programs/item-cycle.ts`), started and awaited
through `speedrun/lib/item-cycle.ts` (`runItemCycle`, `planRoute`, `stockFrom`). The same
program serves Crafting S25d (tool mode, with `keep` for the thread and `stow` on the last
visit) and Cooking S25c's wine windows (`held`, `bank: false`, `mixed`), and will serve the
Fletching fallback (entry 32, stack mode). Every one of those settings is opt-in; Herblore
turns on `stow` alone, for its close. The lab acceptance is `speedrun/lab/herblore-accept.ts`.

### Why the cycle runs in the page

The 4-tick cycle depends on two reactions per inventory. The bank packets must go out on the
tick the bank is seen open. The first mixes must go out on the tick the refilled inventory is
seen, because the client builds the OPHELDU from its own inventory view. Driven from the
overlay, each reaction is a round trip through the gateway, about 0.15 ticks from a remote
host, and over 30-47 inventories that adds up to about the whole 5% margin. In the page, the
program's `onTick` runs after the tick is decoded and its sends leave in the same pass, so
every reaction lands on the next tick. The program also budgets its own sends in user events
(`userEventsOf`), so a burst never spills a sixth event into the next tick: every lab run
below reported `overBudget` 0.

### The pair cycle

- **Work.** On the refill tick the program reads the inventory once and builds the slot list:
  secondary at 14+i on unfinished potion at i. The sends are blind, because each one touches
  only slots no earlier send in the cycle changed (section 4, fixed slots). The booth click
  rides in the burst that carries the last 4 mixes.
- **Opening.** Until the bank is seen open, the program re-clicks the booth every tick, which
  also clears a level-up page. With room to spare it sends one dialogue continue.
- **Banking**, on the tick the bank is seen open. The recipe is re-chosen every visit: the
  highest-xp recipe the level allows whose two inputs are both on hand (bank plus inventory).
  A **canonical visit** is withdraw-All of the secondary, deposit-All of the potion,
  withdraw-All of the unfinished potion, then close: 4 packets, one tick. Anything else (the
  first visit, a resume, a partial last load, a recipe switch with fewer than 14 of an input)
  is a **reset visit**: deposit everything, withdraw exactly n = min(A, B, 14) of each with
  the 10/5/1 buttons (never the count dialogue, which is asynchronous), close last.
- **Refill check.** On the first tick after the close, the layout must be canonical (A in
  0..n-1, B in 14..13+n). If it isn't, that is a `drift` and the next visit is a reset; a
  second drift in a row faults rather than mixing the wrong slots.
- **Ending.** At `untilLevel`, one more visit (the `stow`) deposits every stack held, the last
  load's unused halves and its potions, and closes, so S25c starts at the booth with 28 free. A
  run started past the target only stows, and with nothing held it ends at once without a
  visit. Faults `out of supplies` (with the counts) when no recipe is fillable short of the
  target, `no booth` when the booth leaves view, or on a stall.

The H21e notes need no special case: the first visit is a reset visit, and its deposit-All of
every stack banks the notes unnoted. SCORED needs no vials.

### The booth click: Use-quickly, unrouted from the stand tile

The booth is Varrock west's `bankbooth` (2213) at (3186,3436), clicked with **op 2,
Use-quickly** (`[oploc2,bankbooth] @openbank`), never op 1, Use, which starts the banker
dialogue. `boothFor` reads the op index from the loc's own options.

The browser client's `interactLoc` routes before it clicks and writes a MOVE_OPCLICK even from
the adjacent tile, so a routed booth click is two user events. Four mixes plus that click make
6 events against the engine's 5, the OPLOC lands a tick late, and every inventory takes 5
ticks instead of 4. The first L1 measured exactly that: 181 ticks against a bound of 178, with
24 of 29 cycle gaps at 5. So `Booth.stand` names the tile the account banks from, (3185,3436).
While the observed state puts the player on it, the program sends the click with
`route: false` (the OPLOC alone, one event). Anywhere else, or if the client refuses the
unrouted click as `not_in_reach`, it sends the routed click and counts `routedClicks` or
`unroutedRefused`. With the unrouted click, L1 is 167.

### Level-up pages and the planner

Each xp drop that gains a level queues one level-up page. A mix closes the open page, but the
next queued page opens the following tick, and a page still queued when the booth is clicked
holds the click a tick. Measured per visit on L1, a load whose 14 mixes gained u levels
delayed its bank visit by about u - 1 ticks (loads of 11, 6, 12, 6, 5 and 3 level-ups: booth
waits of 9, 4, 10, 4, 3 and 1). So `planRoute`'s `expectedTicks` is 4 per inventory plus, for
each load, its level-ups beyond the first (`freePagesPerLoad`, default 1). That model gives
164 for L1 (164 measured), 210 for L3 (214, +1.9%) and 125 for L2 (118, -6%). The earlier flat
0.3 ticks per level-up (inferred) was 14-30% low. Partial loads take fewer work ticks and reset
visits cost a little more, which the model ignores; L2, with 7 resets on a list of small
stacks, is where that shows.

### The step

`steps()` returns one step, `S25e herblore`, logout-safe at every inventory boundary. Its
preconditions are reason strings, never throws:

- Herblore at least 3 (Druidic Ritual; every potion's level gate);
- a members world (mixing is members-only);
- the booth in view (skipped right after a login, before the scene's locs arrive);
- **28 free slots**: anything held that is not a recipe input, product or input note blocks a
  working slot (`N other items (...): need 28 free slots`);
- the supplies in sight reach the target, when they are in sight (the bank open, or the H21e
  notes held). Otherwise it refuses with `supplies short: N base xp (they reach Herblore L;
  M mixes: ...)`. Stock banked out of sight is judged by the program's first visit instead.

`done` is Herblore at the target with none of the cycle's own items held (any recipe's inputs,
their notes, its potions); `inProgress` is any xp past the post-ritual 6,250 short of it, or the
target reached with those items still held. So after a mid-band logout the resume walk resumes
the step and its first visit is a reset visit, and after a logout between the target and the
stow it resumes into the stow alone. The postcondition names whatever the stow left held. `handOff` is H21e as data. The stock comes from seven helpers (rs/117's giver gathers
it, rs/331 stages it), and the module assumes nothing about who gave it: it plays whatever is
banked or held.

### Measured

Lab, `herblore-accept.ts` on port block 12, bgsrv-mac, a browser tab (headless), 300 ms ticks,
2026-10-22, the mission tip 9a161cf2. Staging leaves Tutorial Island through S00's tutorialSkip
before any teleport; L1 arrives on foot from Varrock east bank, so the first booth click lands
on a freshly loaded region. Step ticks include the program's start and the level-up watcher
after it (3 ticks).

| Run | Start, supplies | Ticks | Pass | Notes |
|---|---|---|---|---|
| L1 (3 runs) | Herblore 28, supply-safe list held as notes (guam unf 41, irit unf 405, eye of newt 432) | step **167**, program 164 (all three identical) | bound 178 (170 + 5%): pass | 420 mixes, 30 visits, 1 reset, 0 drift, 71 level-ups; 90 of 90 work ticks sent 5 events and landed next tick; cycle gaps 4 x14, 5 x10, 7, 8 x2, 14, 15; booth waits 41 ticks in all |
| L2 | `::setstat` 28, ranging-cap list banked | step **121**, program 118 | bound 123 (117 + 5%): pass | 258 mixes over six recipes, 21 visits, 7 resets; 53 of 57 work ticks full, 57 of 57 landed |
| L3 | 28, the staged H21e stock as notes (below) | program **214** to 99 | 210 expected: +1.9%, pass | 547 mixes: strength 166, superattack 74, superstrength 45, fishing 53, prayer 115, attack 94; 42 visits, 11 resets |
| L5 | L1's list, clean logout at Herblore 50 | step 167 in two parts (27 + 134 program ticks) | resumes, reaches 99 | the resume walk resumed S25e; its first visit was a reset visit |

On the stock rs/323 counted at 02:16 PDT (before cairn_h96's 100 snape grass joined H21e) the
step refuses with `supplies short: 1714 base xp (they reach Herblore 98; 673 mixes: strength
166, superattack 74, superstrength 45, fishing 53, prayer 37, attack 298)`. On rs/41's 23:16
stock it refused at Herblore 79, and the lab's program then ran to `out of supplies` at
exactly 79, as planned. On the staged H21e stock (SUPPLIES.md: guam 298, tarromin 166, ranarr
115, irit 74, avantoe 53, kwuarm 45 unfinished; eye of newt 418, limpwurt 250, snape grass
190) the planner reaches 99 with 5,112 base xp spare.

L4, the overlay-path comparison through `delayfree-cycle.ts`, was not run: it is evidence
only, and the in-page L1 already shows every reaction landing next tick.

### Demo

Entry 27's demo, 2026-10-22 14:08:36-14:09:09Z, measured: rs/41's cairn_h85 (Druidic Ritual
done, Herblore 63) in a visible Chrome tab on the rehearsal twin, its overlay on a loopback
gateway on the twin, under rs/302's claim; the mission tip 9dc3d50f plus the script fixes
below. `herblore-accept.ts demo`: recipes `['attack']`, `maxActions: 28`, h85's own guam unf
and eye of newt, Falador west's booth (2945,3367) from (2945,3368). No staff commands. It
measures the cadence on the demo world, not S25e's band.

| | Demo | L1 |
|---|---|---|
| Mixes, visits | 28 (2 inventories), 2 visits, 1 reset | 420, 30 visits, 1 reset |
| Program ticks | 12, so 6.0 per inventory with the first reset visit | 164, 5.47 per inventory |
| Cycle gaps | 6 x1 | 4 x14, 5 x10, 7, 8 x2, 14, 15 (mean 5.45) |
| Level-ups | 3 (63 to 66); booth waits past the steady one, per visit, 1 and 1 | 71 |
| Work ticks sending 5 events | 5 of 6 | 90 of 90 |
| Work ticks landing next tick | 6 of 6 | 90 of 90 |
| overBudget | 0 | 0 |

The sixth work tick is the last load's 4-mix tick. On L1 that tick also carries the booth
click, so it sends 5; the demo stops at 28 mixes, so it has no click. Every send landed the
next tick and none spilled, so the burst survives the demo world from the browser tab as it
does in the lab. Per inventory the demo is 6.0 ticks against L1's 5.47 (+9.7%). The one
measurable gap is 6 ticks, where L1's relation (4, plus the visit's booth wait past the
steady one) gives 5 for a visit that waited 1: one tick the model does not explain, in a
sample of one. The timeline that would place it was not kept. L1 (164 against 164 modelled)
and L3 (+1.9%) stand; the gap went to rs/158.

The demo found two faults in the acceptance script, both fixed there. Right after a login the
page publishes the position before the scene's locs: the first two logins saw no locs at all,
the second after a 30-tick wait, so the demo now waits up to 60 ticks for a Use-quickly booth
(as `crafting-accept.ts` does) and names the tick, locs and npcs when it gives up. And the
hand-back ran only when the account started holding something, so h85, which started empty,
was left holding its last 14 potions; the demo now restores an empty inventory too. h85 was
left with its inventory empty and Attack potion(3) x28 and eye of newt 183 banked.
