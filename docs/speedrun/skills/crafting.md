# Crafting: fastest route to 99

Scripts: [`delayfree-cycle.ts`](../scripts/delayfree-cycle.ts) (`--skill=crafting` for gems,
`--skill=battlestaff`; bank cycle and actions per tick, fast and stock),
[`delayfree-model.ts`](../scripts/delayfree-model.ts) (`routes`, `levels`). Lab:
[`delayfree-lab.sh`](../scripts/delayfree-lab.sh), delayfree port block (WEB 9270, management
9271, hiscores 9272, node 43970, agent 8170). Labels follow [README.md](README.md#labels) on
rs/2's branch.

**Host and rate.** Every measured figure here was taken on **bbs** (Linux, 32 cores, shared
with helper labs) at **`NODE_TICKRATE=300`** with the headless lite client, at Varrock west bank
(booth (3186,3436), player on (3185,3436)). No figure comes from the Mac executor.

**Client.** The scored run drives the browser webclient against the demo, where each reaction to
observed state costs 1-2 more ticks through the SDK relay from home and about 0.15 from Ashburn
(rs/2; `docs/speedrun/LAB.md` on main, "Which client a number was taken on" and the host-latency
table under "Running several labs on one machine"). The 7-tick cycle has **1 reaction per 27
gems**: deposit, withdraw and close go out on the tick the bank is seen open (section 4). The cuts
are blind, 5 per tick. The lite client fills OPHELDU item ids from its own inventory view;
whether the webclient does the same is unconfirmed (LAB.md). Totals are not re-derived for the
webclient.

## 1. Recommendation

Cut gems at a bank booth: chisel in slot 0 and 27 uncut gems, 5 cuts per tick, best gem per
band (ruby 34, diamond 43, dragonstone 55). The bank visit is one tick (deposit-All of the cut
gems, withdraw-All of the next uncut stack, close), so the steady cycle is **7 ticks per 27
gems**. From the on-route start of **42** (Dwarf Cannon's 750 base) **42 -> 99 took 101 ticks**
(measured).

**Dragonstones are the problem.** Their only source in the content is the crystal chest, and the
demo GE has a 1,000,000 gp bid for 100 with no seller and no trade ever (section 7). The
realistic plan is the best line helpers can supply:

| Route from 42 | Ticks to 99, fast | Ticks to 99, stock SDK | Supply per 99 | Basis |
|---|---|---|---|---|
| Ruby, diamond, **dragonstone** from 55 | **101** | about 351 | 277 uncut dragonstones | fast measured; stock inferred (11 cycles x 31.9) |
| Ruby, diamond, then **earth/fire/air battlestaves** from 58/62/66 | about 104 | about 450 | 276 battlestaves + 276 elemental orbs (828 cosmic runes) | inferred from the measured staff cycle (4.78 ticks per 14) |
| Ruby, then **diamond** to 99 | about 121 | about 447 | 364 uncut diamonds | measured 117 from 43 |
| **Ruby** to 99 | about 150 | about 550 | about 460 uncut rubies | inferred |
| **Hard leather body** from 28 to 99 | about 320 | about 1,370 | about 1,120 hard leather | inferred from the gem cycle |

With the stock SDK every line is about 3.5-4x slower (1 cut per tick plus a 5-tick bank visit,
measured 31.9 ticks per 27-gem cycle).

### Summary row

rs/2's columns for the Item-fed skills section of `docs/speedrun/skills/README.md`; column 5
is "with interleaving (net)", n/a where nothing is absorbable net (section 5).

| Skill | Headline method | Start level (on-route quests) | Ticks to 99, normal | Ticks to 99, with interleaving (net) | Basis | Helper supplies | Document |
|---|---|---|---|---|---|---|---|
| Crafting | cut gems at a bank booth, 5 per tick, best gem per band (ruby, diamond, dragonstone from 55) | 42 after Dwarf Cannon's 750; 45 if trained after Goblin Diplomacy's 200 ([quests README](../quests/README.md) section 3, steps 6 and 12) | 101 from 42 (130 from 1) | n/a: no net absorption (one slot per gem, 57 level-ups; section 5) | measured (bbs) | chisel, 1 uncut ruby, 10 uncut diamonds, 277 uncut dragonstones (effectively unobtainable; fallback 364 uncut diamonds, about 121 ticks) | crafting.md |

## 2. Route by level band

Base xp per cut is `gem_cutting_table:experience` / 10 (`gem.dbrow`, read). Ticks per action
0.2 (5 per tick) is measured on every full work tick. Opal, jade and red topaz can smash: a
failed `stat_random` gives a crushed gemstone and a quarter of the xp (`uncut_gem.rs2:49-59`).

| Band | Method | Unlock | Base xp / action | Success | Ticks / action | Base xp / tick (in cycle) | Actions from 1 | Actions from 42 |
|---|---|---|---|---|---|---|---|---|
| 1-20 | Cut opal | Crafting 1 | 15 (3.8 on a smash) | 50% at 1 (`stat_random(128,250)`) | 0.2 | about 25 | 9 | |
| 20-27 | Cut sapphire | 20 | 50 | 100% | 0.2 | 165 | 2 | |
| 27-34 | Cut emerald | 27 | 67.5 | 100% | 0.2 | 222 | 3 | |
| 34-43 | Cut ruby | 34 | 85 | 100% | 0.2 | 280 | 5 | 1 |
| 43-55 | Cut diamond | 43 | 107.5 | 100% | 0.2 | 354 | 10 | 10 |
| 55-99 | Cut dragonstone | 55 | 137.5 | 100% | 0.2 | 453 | 277 | 277 |
| 66-99 (alt.) | Air battlestaff (battlestaff + air orb) | 66 | 137.5 | 100% | 0.2 | 403 (14 per inventory) | | |
| 28-99 (alt.) | Hard leather body (needle on hard leather) | 28 | 35 | 100% | 0.2 | about 120 (26 per inventory) | | |

"Base xp / tick (in cycle)" is 27 x xp / 8.2 ticks (the measured mean dragonstone cycle), 14 x
xp / 4.78 for battlestaves, and 26 x 35 / about 7.5 for hard leather (inferred).

End to end (measured, `delayfree-cycle.ts`):

| Run | Span | Base xp/tick | Bank cycles | Open-to-open gaps (ticks: count) |
|---|---|---|---|---|
| 55 -> 99 dragonstone, fast | **86 ticks** | 447.7 | 11 | 7: 8, 9: 1, 17: 1 (mean 8.2) |
| 42 -> 99 ruby/diamond/dragonstone, fast | **101 ticks** | 390.3 | 11 | 7: 5, 8: 3, 14: 1, 20: 1 (mean 9.3) |
| 43 -> 99 diamond only, fast | **117 ticks** | 336.3 | 14 | 7: 8, 8: 3, 11: 1, 21: 1 (mean 8.6) |
| 1 -> 99 opal...dragonstone, fast | **130 ticks** | 312.3 | 13 | 7: 7, 8: 1, 9: 1, 17: 1, 20: 1, 23: 1 (mean 10.5) |
| 66 -> 99 air battlestaff, fast | **90 ticks** | 400.3 | 19 | 4: 7, 5: 9, 6: 1, 7: 1 (mean 4.8) |
| 55 -> 99 dragonstone, stock SDK | **331 ticks** | 115.1 | 11 | 31: 1, 32: 9 (mean 31.9) |

## 3. Quest xp

| Quest | Crafting (base, read) | Start level | On route? |
|---|---|---|---|
| Dwarf Cannon | 750 (`quest_mcannon.rs2:25`; [`dwarf_cannon.md`](../quests/dwarf_cannon.md)) | **42** | **yes** (quests README step 6) |
| Goblin Diplomacy | 200 (`quest_gobdip.rs2:62`, via the [quests README](../quests/README.md) section 3) | 45 with Dwarf Cannon | **yes**, Package B filler (step 12) |
| Shilo Village | 3,875 (`quest_zombiequeen.rs2:1632`) | 65 | off route (`legends.md`) |
| The Fremennik Trials | 2,812.4 | 60 | off route |
| Shades of Mort'ton | 2,000 (`quest_mortton.rs2:65`) | 56 | not costed |
| Legends' Quest | 7,650 per pick | | off route |

On the route Dwarf Cannon applies first: **start at 42, 42 -> 99 = 101 ticks** (measured).
Goblin Diplomacy, now Package B filler before Dragon Slayer, adds 200 more: 950 base is level
**45** (inferred from the server's xp table, `Player.ts`) if Crafting is trained after it. That
saves about a tick (200 base at the ruby/diamond rates, inferred); 101 stays the measured,
slightly pessimistic figure. From
level 1 it is 130 (measured); Dwarf Cannon saves about 29 ticks. Its railings roll on Crafting
(`dwarf_cannon.md`: 44% at 60, 59% at 99), so training Crafting first speeds the quest a little;
that trade belongs to the quest plan.

## 4. Mechanics

- **Delay-free cutting.** OPHELDU of chisel and uncut gem runs `[opheldu,chisel]` ->
  `@crafting_gem` (`uncut_gem.rs2:1-63`): level check, delete, roll (opal, jade, red topaz
  only), add, xp. No `p_delay`, no queue.
- **5 per tick, fixed slots.** The chisel stays in slot 0. `inv_del` removes the first uncut
  gem and `inv_add` puts the cut gem in the first free slot, which is the slot just emptied,
  so cut k is `chisel@0 on uncut@1+k` with no state read. 5 cuts landed on every full work
  tick (measured), up to the 5-user-event cap (`ClientGameProtCategory.ts:6`).
- **The bank visit.** Booth click in the burst with the last 2 cuts; on the tick the bank is
  seen open, deposit-All of the cut gem (INV_BUTTON4 on `bank_side`, `bank_deposit.rs2:4`),
  withdraw-All of the uncut gem (fills the 27 free slots, `bank.rs2:4`), close. Cutting resumes
  the tick after (the lite client fills OPHELDU item ids from its own inventory view, which
  updates a tick later). Packet count: 27 cuts + 4 = 31 = 7 ticks at 5 per tick, which is the
  measured steady cycle (7-tick gaps).
- **Battlestaves** (`battlestaves.rs2:15-38`) are the same delay-free shape with a pair of
  inputs (battlestaff + orb), 14 per inventory: measured 4-5 ticks per cycle, like Herblore.
- **Hard leather body** is the one leather item crafted directly: `[opheldu,hard_leather]` with a
  needle calls `@craft_leather(hardleather_body, 1)`, which makes it at once without the queue
  every other leather item uses (`leather.rs2:36,47-48,116-134`). A body needs one thread held,
  and every fifth body deletes one (`%thread_used`), so n bodies take floor((n-1+s)/5)+1 thread
  for a starting `%thread_used` of s (0-4): 224 for 1,116 bodies.
  Not measured; inferred to run like gems (26 per inventory with needle and thread).
- **Level-up boxes.** OPHELDU closes the chat modal, so cutting never stalls. At a bank visit
  each pending level-up (a queued `p_pausebutton` script, `levelup.rs2`) holds the booth for a
  tick; the 14-23 tick gaps in the runs are bursts that crossed several levels at once.
- **Stock SDK** (porcelain bank calls, then one awaited cut per observed tick): 1 cut per tick
  and 4-5 ticks from booth click to a refilled inventory, 31.9 ticks per cycle (measured).

## 5. Alternatives considered

- **Every other delay-free Crafting action** (read, `skill_crafting/scripts/`):
  battlestaves (above), hard leather bodies (above), amulet stringing (4 base,
  `stringing.rs2:71`), snelms (32.5 base, needs snail shells, `snelm.rs2:15`), cape dyeing (2.5
  base, `dye_cape.rs2:120`). None beat cut gems except battlestaves, which tie dragonstone per
  action at half the items per inventory.
- **Delayed or queued Crafting** (read): gold and silver jewellery (`p_delay(2)` and a 2-tick
  weakqueue, `jewellery.rs2:220,324`), glassblowing, pottery, spinning and leather (2-3 tick
  queues). At best 1 action per 2-3 ticks; they lose.
- **Diamonds instead of dragonstones**: +77 actions, about +20 ticks (measured 117 from 43
  against the inferred 97 for dragonstone from 43).
- **Battlestaves instead of dragonstones**: tie on xp per action; about the same total (the
  14-item cycle is shorter but twice as many cycles). Each orb costs a helper a Charge Orb cast
  (Magic 56/60/63/66, 3 cosmic + 30 elemental runes, at an obelisk, `magic_spells.dbrow:125-160`,
  `charge_orb.rs2`) plus an unpowered orb
  (helper glassblowing at Crafting 46, `glass.struct:12-14`).
- **Trading instead of banking**: an in-trade swap of 27 gems costs 5-9 ticks (`primitives.md`
  section 6) against a 1-tick bank visit plus the click. Bank wins.

**Interleaving** (`interleaving.md` section 8, the absorbable-fractions table): cutting is
delay-free and lands 3 per tick beside a gathering click (measured there), so all ~288 cuts fit
by packets. **Net, none of it is worth absorbing**, for two costs that table's capacity figure
(~80 standalone ticks) leaves out:

- **The inventory binds.** One slot per gem, so a load is 27 gems, and refilling it away from a
  bank is a top-up trade of 5-9 ticks (`primitives.md` section 6). Standalone, those 27 gems cost
  the measured 7-tick bank cycle. The trade eats the whole saving. In pickpocket stuns the gems
  would also take the bones' slots, and a stun's bones are worth more (4 standalone ticks against
  ~1.5 for its 7 helper actions, interleaving.md section 8).
- **Level-ups are expensive in a gathering loop.** One helper skill's early level-ups cost about
  136 Woodcutting ticks over 29 dialog episodes (interleaving.md section 5, measured); Crafting's
  57 from 42 would cost far more Woodcutting than its 101 standalone ticks.

So column 5 of the summary row is n/a against either host loop: the plain pickpocket loop (no
knife column) or plain 4-tick Woodcutting. rs/9's knife loop leaves even less room: it needs the
knife and a log in the inventory and puts 4 packets on the tick after each roll
(interleaving.md section 7, inferred).

## 6. Gotchas

- **Dragonstone, opal and battlestaves are members** (`uncut_gem.rs2:16-21`,
  `battlestaves.rs2:16-19`). The demo is members.
- **Smashing below 20.** Opal smashes half the time at level 1; deposit the crushed gemstones
  with the products each visit (one more deposit packet).
- **Keep a spare inventory per gem in the bank**; an emptied stack reorganises the bank on
  close and shifts the blind withdraw slot (`bank.rs2:25-35`).
- **Level check per cut** reads `stat(crafting)` (boostable). A band edge inside an inventory
  is harmless: the script changes gem type only at a bank visit.
- **Busy host.** bbs was running other labs; the runs hit the 7-tick floor on most cycles.

## 7. Helper supply list

Per 99 from 42 (exact actions; add one spare inventory per line for blind withdraws):

| Item | Quantity | Where helpers get it (read) | Scarcity (demo GE, 2026-10-21) |
|---|---|---|---|
| Chisel | 1 | most general stores (`varrock.inv`, `lumbridge.inv`, ...) | easy |
| Uncut ruby | 1 | gem traders (Al Kharid, Falador) stock 0 and restock slowly (`alkharid.inv:69`, `falador.inv:11`); gem rocks, drops | GE: bid wall 10,000 gp x 10,148, 852 traded |
| Uncut diamond | 10 | gem rocks (`gem_rock_table.dbrow:10`), mining random gems (`mining.rs2:270`), the gem drop table (`shared_droptables.rs2:53`), gem stalls, fishing caskets | GE: 10 offered at 25,000 |
| **Uncut dragonstone** | **277** | **crystal chest only** (`crystal_chest.rs2:24`; needs a crystal key) | **effectively unobtainable**: 1,000,000 gp bid for 100, no sellers, never traded |

Fallback lists (from 42):

- **Battlestaves**: diamonds 14, battlestaves 276, earth orbs 7, fire orbs 8, air orbs 261.
  Battlestaves: Zaff, Varrock (5 in stock, `varrock.inv:150`) and the Magic Guild (5,
  `magic_guild.inv:22`), restocking. Orbs: helper Charge Orb at the obelisks, 3 cosmic runes and
  30 elemental runes each, so **828 cosmic runes** (GE: 370 ever traded, no sellers now) and
  276 unpowered orbs (molten glass + glassblowing pipe, Crafting 46).
- **Diamonds only**: 364 uncut diamonds, chisel.
- **Hard leather bodies**: 1,142 hard leather for 1,116 bodies plus a spare inventory, 1 needle,
  224 thread (230 staged). There is no GE market for hard leather and only a handful of cowhides
  (2026-10-22), so the `hides` helper role takes cowhides in the Lumbridge fields and has the
  Al Kharid tanner tan them at 3 gp each: about 250-550 leather per account-hour, measured
  ([helpers/hides.md](../helpers/hides.md)). Supply-safe.

**Hand-off.** One trade of noted gems (1-3 stacks) plus the chisel, deposited at the training
booth. The scored account must stand at a bank for the cycle.

## 8. Open questions

- **Which line helpers can actually fill.** Dragonstones look unobtainable; diamonds (364) and
  cosmic runes (828 for orbs) are the next constraints. The helper-supply issues under rs/41
  should price each line in helper-hours; the scored-account cost difference is only about 20
  ticks between dragonstone, battlestaves and diamonds.
- **Hard leather cadence** is inferred from the gem cycle, not measured.
- **Crafting before Dwarf Cannon** would speed the railings; that trade is for the quest plan.
- **Production latency** not measured; late packets slip a tick, they are not dropped.
