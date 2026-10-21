# Herblore: fastest route to 99

Scripts: [`delayfree-cycle.ts`](../scripts/delayfree-cycle.ts) (`--skill=herblore`, bank cycle
and actions per tick, fast and stock), [`delayfree-model.ts`](../scripts/delayfree-model.ts)
(`routes`, `levels`). Lab: [`delayfree-lab.sh`](../scripts/delayfree-lab.sh), delayfree port
block (WEB 9270, management 9271, hiscores 9272, node 43970, agent 8170). Labels follow
[README.md](README.md#labels) on rs/2's branch.

**Host and rate.** Every measured figure here was taken on **bbs** (Linux, 32 cores, shared
with helper labs) at **`NODE_TICKRATE=300`** with the headless lite client, at Varrock west bank
(booth (3186,3436), player on (3185,3436)). No figure comes from the Mac executor.

## 1. Recommendation

**Druidic Ritual is a hard prerequisite.** Every Herblore action needs level 3 by default, and
nothing below level 3 gives Herblore xp except quest steps (section 3). So the scored account
starts Herblore at **level 28** after Druidic Ritual's 250 base, or at **level 57** if Digsite's
2,000 base has also been claimed. rs/3 has put Druidic Ritual on the route for this reason
(cairn://p/rs/3, quest README section 4 on `agent/rs-3-coordinator-0`).

Then mix finished potions at a bank booth, 14 unfinished potions + 14 secondaries per
inventory, 5 mixes per tick, best potion per band (super strength 55, super defence 66,
ranging 72, Zamorak 78). The bank visit is one tick: the booth click goes out with the last
mixes, and on the tick the bank is seen open the script sends withdraw-All of the secondary,
deposit-All of the potions, withdraw-All of the unfinished potions and close. Mixing resumes the
next tick. The steady cycle is **4 ticks per 14 potions**.

| Start | Ticks to 99, fast script | Ticks to 99, stock SDK | Basis |
|---|---|---|---|
| **57 (Druidic Ritual + Digsite + Watchtower steps, about 2,280 base), the on-route start if Herblore is trained after Digsite** | **84** | about 338 | fast measured (1 run); stock inferred (17 cycles x 21.1) |
| 28 (Druidic Ritual only) | **112** | about 381 | fast measured (1 run); stock inferred |
| 66 | **77** | **317** | measured, 1 run each |
| 1 without Druidic Ritual | impossible | impossible | read (section 4) |

Supply decides the top tier, not playtime (section 7). Zamorak potions need torstol, whose only
source in the content is a keyed chest. **Capping at ranging potions costs about 1 cycle, 5 ticks**;
capping at super defence about 3 cycles, 15 ticks (inferred). Pick the cap by what helpers can
actually gather.

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
| Watchtower | 10 per ogre-potion step, 3 steps (`ogre_potion.rs2:52,81,87`); the steps need Herblore 14 (`watchtower.md` on rs/3's branch) | +30 | yes |
| Digsite | 2,000 (`quest_itexam.rs2:42`) plus 2.5 per chemistry mix (`itexam_chemistry.rs2:35,49,68`); the mixes need Herblore 10 | 56 alone, **57 with Druidic Ritual** | yes |
| Jungle Potion | 775 (`quest_junglepotion.rs2:74`) | | off route |
| Heroes' Quest | 1,325 (`quest_hero.rs2:40`) | | off route |
| Eadgar's Ruse | 11,000 (`quest_eadgar.rs2:595`) | 79 | not costed by rs/3 |
| Shades of Mort'ton | 335 + 2,000 (`quest_mortton.rs2:55,66`) | | not costed |

**Hard dependency: Druidic Ritual must be on the route**, before Watchtower (Herblore 14) and
Digsite (Herblore 10), and before any Herblore training:

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

Train Herblore after Digsite if the order allows: 57 -> 99 is 84 ticks against 112 from 28
(28 ticks saved, measured). Digsite's chemistry and Watchtower's potion only need levels 10 and
14, which Druidic Ritual's 28 already covers.

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
  tick, and the booth click must be decoded a tick before the bank packets. The measured
  steady cycle is that floor (4-tick gaps). Mixing must wait one tick after the close because
  the lite client fills an OPHELDU's item ids from its own inventory view, which updates a tick
  later (`server/webclient/src/lite/actions.ts`, `useItemOnItem`).
- **Level-up boxes.** Each OPHELDU closes the chat modal (`clearPendingAction` in
  `OpHeldUHandler.ts`), so mixing never stalls. But a level-up is a queued `p_pausebutton` script
  per level gained (`levelup/scripts/levelup.rs2`), and while one is open the booth interaction
  waits; only one can be cleared per tick. When the last burst of an inventory crosses several
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
- **Super attack only (irit + eye of newt) from 45**: 378 actions from 57 instead of 224, about
  27 inventories = 137 ticks instead of 84 (inferred). Its secondary is a shop item, so this is
  the supply-safe fallback if no high-level herbs can be gathered.
- **Ranging cap** (no Zamorak potions): 238 actions from 57, about 5 more ticks. **Super defence
  cap**: 255 actions, about 15 more ticks (inferred).
- **Identifying herbs** (`identify.rs2`, OPHELD1, delay-free, 27 per inventory): torstol 15
  base, cadantine 12.5 (`herbs.obj`). About 48-60 base per tick, a tenth of mixing (inferred).
- **Grinding** (pestle and mortar) gives no xp (`herblore.rs2:27-36`).

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

Per 99 from level 57 (the on-route start), exact actions; add one spare inventory (14) of each
line if the scored account banks by fixed slot:

| Item | Quantity | Where helpers get it (read) | Scarcity on the demo (GE snapshot 2026-10-21) |
|---|---|---|---|
| Kwuarm potion (unf) | 16 | helper with Herblore 55: kwuarm + vial of water; kwuarm from the herb drop table (`shared_droptables.rs2`) | herbs: no GE sellers |
| Limpwurt root | 16 | drops: druids, giants, hobgoblins, chaos druid warriors, tribesmen | no GE market |
| Cadantine potion (unf) | 14 | Herblore 66; cadantine from herb drops | no GE sellers |
| White berries | 14 | 3 ground spawns (one deep in the Wilderness at (3214,3814)); drops from chaos druid warriors and Salarin | scarce |
| Dwarf weed potion (unf) | 19 | Herblore 72; dwarf weed from herb drops and the Miscellania kingdom | **contested**: a 7,000 gp bid for 839 dwarf weed, no sellers |
| Wine of Zamorak | 19 | one spawn at the Asgarnian Chaos Temple (telekinetic grab); Kalphite Queen drop | scarce |
| Torstol potion (unf) | 175 | Herblore 78; **torstol's only source is the sinister-key chest in the Yanille agility dungeon, one per key** (`agility_dungeon.rs2:101-124`) | **effectively unobtainable**: no GE market at all |
| Jangerberries | 175 | 4 bush spawns near Yanille (`maps/m39_48.jm2`) | slow |
| Vial of water (for the unf) | 224 | Karamja jungle store 50 in stock (`karamja.inv:48`), Ardougne, Shilo, Rellekka shops; or fill empty vials | easy |

**Realistic list (ranging cap)**, from 57: kwuarm unf 16 + limpwurt 16, cadantine unf 14 + white
berries 14, **dwarf weed unf 208 + wine of Zamorak 208**. Wine of Zamorak then becomes the hard
line (one spawn). **Supply-safe list**: irit unf 378 + eye of newt 378 (Port Sarim magic shop,
300 in stock, fast restock, `port_sarim.inv:50`), 137 ticks.

From level 28 add: harralander unf 1 + chocolate dust 1, ranarr unf 8 + white berries 8, irit
unf 10 + eye of newt 10, one more kwuarm unf + limpwurt.

**Hand-off.** Noted unfinished potions and secondaries in one trade (about 8-10 stacks; adjacent
helper 9 ticks stock, 5 floor), deposited at the training booth: one deposit-All per stack
(the noted stacks bank unnoted). The scored account must stand at a bank for the cycle.

## 8. Open questions

- **Herb supply rates.** The herb drop table and the Miscellania kingdom are the only herb
  sources apart from the keyed chest. How many herbs per helper-hour, and whether torstol is
  obtainable at all, belongs to the helper-supply issues under rs/41.
- **Order versus Digsite.** Training after Digsite saves 28 ticks (measured). rs/3's final order
  decides.
- **Level-up stalls** cost about 1 tick per pending level-up box at a bank visit. A route
  that banks on a tick where no level-up is pending would remove them; not tried.
- **Production latency** is not measured; a late packet is queued to the next tick, not
  dropped, so the worst case is a slipped tick per burst.
