# Prayer: fastest route to 99

Scripts: [`prayer-bury.ts`](../scripts/prayer-bury.ts) (banks and buries bones,
logging the tick of every xp drop, bank open and level-up dialog; `--mode=fast` is
the one-click-per-tick loop, `--mode=stock` the plain SDK calls) and
[`prayer-lab.sh`](../scripts/prayer-lab.sh) (one-batch lab on the Prayer port
block: WEB_PORT 9230, AGENT_PORT 8130). Labels follow
[README.md](README.md#labels) on `agent/rs-2-coordinator-0`. Every headline
number below was measured at `NODE_TICKRATE=300`. The 100 ms runs were
exploration only and are called out where they differ.

**Host.** The 300 ms batches ran on **fedora** (Linux, 32 cores), not the Mac. fedora was
heavily shared that night: up to nine of rs/28's labs plus rs/53's (rs/2 coordinator to rs/26,
00:22), and rs/56 recorded load ~25 there. The 12-89-tick bot stalls below are the ones main
attributes to host load rather than the game (cairn://p/rs/main, 00:36). So read the measured
end-to-end runs as a **busy host's figures, a few percent pessimistic**. The stall-free
58-tick cycle, and the 1,151 inferred from it, is the clean figure. rs/26 closed without a single correction factor; `docs/speedrun/LAB.md` on main (its host-latency table) names bbs the reference host and reads the Mac's figures as pessimistic, so no factor is applied.

**Client.** Every number here was taken on the headless lite client against a local lab engine,
where a reaction lands on the next tick. The scored run drives the browser webclient against the
demo, where each reaction to observed state costs 1-2 more ticks through the SDK relay from home
and about 0.15 from Ashburn (rs/2; `docs/speedrun/LAB.md` on main, "Which client a number was
taken on" and the host-latency table under "Running several labs on one machine"). The bank
cycle has **1 reaction per 28-bone inventory**: withdraw-all and close go out on the tick the
bank is seen open (section 4). Each of the 67 level-up dialogs is dismissed in the same tick as
the next Bury (section 6). The buries go out blind every 2 ticks. Totals are not re-derived for
the webclient.

## 1. Recommendation

Bury **dragon bones** (72 base, `bones.obj:82`) from level 1 to 99 at any bank
booth. Nothing in this content beats it. There is no altar bonus, no Ectofuntus
and no prayer-xp ashes, and the funeral pyre gives less than half the rate
(section 5). The account buries one bone every **2 ticks**. A 28-bone inventory,
including the bank visit, takes **58 ticks** with a one-click-per-tick loop and
**59** with the stock SDK calls (measured, 300 ms). That is 34.8 base xp per tick.

- **On route, from level 1: 555 dragon bones, 1,151 ticks** (inferred from the
  measured cadence). A full measured run took **1,221 ticks**; the extra 70
  were bot stalls, not game mechanics (measured, `prayer-bury.ts --mode=fast`,
  300 ms, 555 bones). No on-route quest gives Prayer xp: rs/3 dropped Holy
  Grail from the route on 2026-10-20, so the post-quest start *is* level 1.
  That still holds under rs/3's final **Package B** (01:08): Dragon Slayer and its filler
  (Goblin Diplomacy, Romeo & Juliet, Cook's Assistant) and Druidic Ritual give no Prayer
  (read, `quest_dragon.rs2:33-34`; rs/3 `quest_points.md`).
- **Only if Holy Grail returns** (11,000 base, level 80): 402 dragon bones,
  835 ticks (inferred). A measured run from level 80 (10,687 base, so 407
  bones) took **872 ticks**, including one 28-tick stall; its clean model is
  845.
- **Early Prayer for the quest fights: 11 dragon bones for Prayer 43**
  (Protect from Melee, which also covers Protect from Magic at 37), traded
  unnoted and buried on the spot. That is **21 ticks** of burying plus the trade,
  about 30 in all. Prayer 37 alone is 8 bones and 15 ticks. These bones are
  part of the 555, so the only extra cost is the separate trade. Package B
  confirms the need: the pre-MM fights are cast at Defence 1 and are survivable
  only under Protect from Melee, which took 0 damage in 20 measured fights (rs/3
  `pre_mm_fights.md`). The bones ride the helper trade before Tree Gnome Village,
  with 2 prayer potion(4) for the ~115-125 points the four fights use. Burying
  more early (Prayer 70 is 74 bones, ~150 ticks) removes the potions, not any
  damage, and only reorders ticks this route spends anyway (`pre_mm_fights.md`
  section 2).

### Summary row

rs/2's columns for the Item-fed skills section of `docs/speedrun/skills/README.md`; column 5
is "with interleaving (net)". The loop conditions are in section 5.

| Skill | Headline method | Start level (on-route quests) | Ticks to 99, normal | Ticks to 99, with interleaving (net) | Basis | Helper supplies | Document |
|---|---|---|---|---|---|---|---|
| Prayer | bury dragon bones at a bank booth; 11 early for Prayer 43 before TGV | 1 (no on-route quest gives Prayer; [quests README](../quests/README.md) section 4, step 0) | 1,151 (measured run 1,221 with stalls) | **~800** with the ~196 bones in pickpocket stuns: clean, Thieving has no knife column. **~80-110** with the other 359 in the knife Woodcutting loop, clean against WC's knife column (`research/bones-placement.md`) | measured cadence (fedora, busy host); interleaving totals inferred | 555 dragon bones (11 unnoted before TGV, the rest one noted stack) | prayer.md |

## 2. Route by level band

One method covers every band. Band boundaries are only where quest xp lands.
"Fast" is the measured one-click-per-tick loop: 2 ticks per bone, plus a 4-tick
gap at each bank visit. "Stock" uses `bot.openBank`, `bot.withdrawItem` and
`bot.closeBank`, with a 5-tick bank gap. Both include the 5 ticks from the first
booth click to the first xp drop.

| Band | Method | Location | Unlock | Base xp / action | Ticks / action | Success | Base xp / tick | Bones | Ticks (fast / stock) |
|---|---|---|---|---|---|---|---|---|---|
| 1 -> 37 | Bury dragon bones (traded unnoted, no bank) | anywhere | none | 72 | 2 | 100% | 36 | 8 | 15 + trade |
| 1 -> 43 | same | anywhere | none | 72 | 2 | 100% | 36 | 11 | 21 + trade |
| 1 -> 80 (the Holy Grail level) | Bury dragon bones, bank cycle | any bank booth; measured at Varrock west (3185,3436) | none | 72 | 2, plus 4 per 28 | 100% | **34.8** (measured, 58-tick cycles) | 149 | 311 / 316 |
| 80 -> 99 (only if Holy Grail returns to the route) | same | same | none | 72 | same | 100% | **34.8**; 33.6 overall in the measured run | 407 (402 from 11,000 base) | 845 / 859 (835 / 849 from 11,000) |
| **1 -> 99** | same | same | none | 72 | same | 100% | 34.8; **32.7 overall measured** | **555** | **1,151 / 1,170** (inferred); **measured 1,221 / 1,298** |

Arithmetic (inferred): with *n* bones and *v* = floor((*n* - 1) / 28) bank
visits, ticks = 5 + gap x *v* + 2 x (*n* - 1 - *v*), where the gap is 4 (fast),
5 (stock) or 3 (engine floor, section 4). The bone count is
ceil(xp needed / 72). Level xp comes from the curve in `Player.ts:77-85`:
37 = 504.9, 43 = 787.4, 80 = 10,686.8, 99 = 39,938.3.

Measured runs (all `prayer-bury.ts`, 300 ms, dragon bones, Varrock west bank):

| Run | Bones | Ticks, first booth click to last xp | Gaps inside an inventory | Bank-visit gaps | Cycle ticks (bank open to bank open) | Level-up dialogs |
|---|---|---|---|---|---|---|
| fast, 1 -> 99 | 555 | **1,221** | 526 of 535 were 2; stalls of 12, 18 and 22 | 18 x 4, 1 x 17 | 58 in 13 of 19; stalls 61-87 | 67 |
| stock, 1 -> 99 | 555 | **1,298** | 531 of 534 were 2; stalls of 7, 33 and 89 | 15 x 5, 4 x 6 | 59 in 13 of 19; one 146 | 67 |
| fast, 80 -> 99 | 407 | **872** | 391 of 392 were 2; one 28 | 13 x 4, 1 x 5 | 58 in 12 of 14 | 19 |
| stock, level 99 (no dialogs) | 84 | 177 | 81 of 81 were 2 | 2 x 5 | 59, 59, 59 | 0 |
| fast, 1 -> 66 | 60 | 129 | all 2, including the 32 after a dialog | 2 x 4 | 60, 58 | 34 |

## 3. Quest xp

| Quest | Prayer base xp (read) | Level reached from 1 | On route? | Bones it replaces |
|---|---|---|---|---|
| Holy Grail | **11,000** (`stat_advance(prayer, 110000)`, `quest_grail.rs2:116`) | **80**, not about 75: 80 needs 10,687 base and 81 needs 11,456 | **no**: rs/3 dropped it (with Merlin's Crystal) on 2026-10-20. Burying the same 11,000 base costs about 316 ticks (153 bones), and rs/3 judged the two quests not worth that | 153 (about 316 ticks) |
| Priest in Peril | 1,406 (`priestperil.rs2:9`) | 51 | **no**, per the rs/33 brief. `haunted_mine.md` says Haunted Mine needs it, so check if Haunted Mine stays on route | 19-20 (about 40 ticks) |
| The Restless Ghost | 1,125 (`quest_priest.rs2:98`) | 47 | no (`legends.md` leaves it out) | 15 (about 33 ticks) |
| Legends' Quest | 7,650 per pick (`radimus_erkle.rs2:119-122`) | n/a | no (`legends.md`: not worth doing) | 106 per pick |
| Nature Spirit (ghast kills) | 30 per ghast (`ghast.rs2:132`) | n/a | no | n/a |

No on-route quest gives Prayer xp, so the route is **555 dragon bones, about
1,151 ticks, from level 1**. Conditional figures: if Holy Grail returns, 402
bones and about 835 ticks from 11,000 base. If Priest in Peril joins the route
(1,406 base), 536 bones and about 1,113 ticks. With both, 383 bones and about
795 ticks.

**Ordering, if a quest returns.** The bone count depends only on the total
quest xp, so burying before or after the quest costs the same, with one
exception: xp past 99 is wasted. With Holy Grail, do not bury more than 402
bones before the quest.

## 4. Mechanics

- **The bury script** (`bury_bone.rs2:1-20`): `[opheld1,_bones]` plays the
  animation, calls `p_delay(0)`, and *after* the delay deletes the bone and runs
  `stat_advance(prayer, oc_param(bone, bone_exp))`. `bone_exp` is in tenths
  (dragon 720 = 72 base). The bone leaves the inventory and the xp lands in the
  tick after the click.
- **Why it is exactly 2 ticks, and why the second click cannot land early**
  (read). `p_delay(0)` sets `delayedUntil = currentTick + 1`
  (`PlayerOps.ts:376-380`). Packets are decoded in `processClientsIn`, but
  `delayed` is cleared later in the same tick, in `processPlayers`
  (`World.ts:776`). So in tick T+1 the player is still delayed when packets are
  read, and `OpHeldHandler` drops the click (`OpHeldHandler.ts:15-18`, "cannot
  interact while delayed"). Dropped means discarded, not queued. The earliest
  accepted click is in T+2. A second Bury packet in the same tick as the first
  is refused for the same reason. Five packets per tick do not help burying.
- **Strategy that hits the floor** (measured): each tick, click Bury on the
  lowest slot that still shows a bone. The click that lands in the delayed tick
  is dropped at no cost, and the next one lands on time. Over 1 -> 99 the fast
  loop sent 1,177 clicks for 555 bones.
- **Level-up dialogs** (read, measured). `[advancestat,prayer]` runs from the
  engine queue in the same tick as the xp (`Player.ts:1944-1947`). It opens a
  chat dialog and suspends on `p_pausebutton` (`levelup.rs2:51-54`), keeping
  protected access, so a Bury click is refused until the dialog is resumed
  (`Player.ts:2233`). Send Continue and Bury in the same tick, Continue first:
  `ResumePauseButtonHandler` finishes the script during packet decoding, and
  the Bury packet behind it then runs. Measured at 300 ms: 62 of 63
  post-dialog gaps were 2 ticks (fast), and 62 of 63 (stock). At 100 ms, 8 of
  32 cost an extra tick, because the bot reacts too slowly for 100 ms ticks.
- **Bank cycle** (read, measured). The last bury of an inventory resolves in
  T+1. The booth click is also refused while delayed (`OpLocHandler.ts:14`), so
  it lands in T+2 and the bank opens that tick, since the bot stands next to the
  booth. In T+3, withdraw-all and close go out together. The stock lite client
  will only send a Bury for a slot it has already seen filled
  (`Client.ts:1509-1515`), so the first Bury lands in T+4. That makes the
  bank-visit gap 4 ticks (measured at 300 ms: 31 of 33 fast bank visits) against
  2 for a plain bury, so +2 ticks per 28 bones. At 100 ms the fast loop measured
  5, because the bot's reaction cost a tick.
- **Engine floor, unmeasured** (inferred): with raw packets, withdraw, close and
  Bury slot 0 could all go in T+3, where the server's own `hasAt` check would
  pass. That gives a 3-tick gap: 57 ticks per inventory, 1,132 ticks from 1 and
  821 from 11,000. It needs a client that sends OPHELD for a slot it has not
  seen yet, and it saves only about 20 ticks over the whole skill.
- **The bank must be closed to bury**: the bank's side panel replaces the
  inventory, and `OpHeldHandler` refuses a component that is not visible.
- **Noted bones**: a noted dragon bone has no Bury option. Depositing the noted
  stack stores plain bones in the bank, and withdraw-all in item mode returns
  28 buryable bones.

## 5. Alternatives considered

| Method | Base xp / action | Ticks / action | Base xp / tick | Verdict |
|---|---|---|---|---|
| **Dragon bones** | 72 (`bones.obj:82`) | 2 (+4 per 28) | **34.8** (measured) | best |
| Babydragon bones | 30 (`bones.obj:69`) | 2 | 14.5 | 2.4x the ticks |
| Shaikahan bones (Tai Bwo Wannai) | 25 (`bones.obj:112`) | 2 | 12 | loses |
| Monkey Madness quest bones | 3-20 (`quest_mm.obj:15-122`) | 2 | at most 9.7 | loses |
| Big / jogre bones | 15 | 2 | 7.2 | loses |
| Bones, bat, wolf, burnt | 4.5 | 2 | 2.2 | loses |
| **Bones on an altar** | none | n/a | n/a | No such trigger exists. `altar.rs2` only handles Pray-at (`[oploc1,_prayer_altar]`), which restores points. No `[oplocu,...]` on any `prayer_altar` loc takes bones (read; searched every `oplocu` in the content). |
| **Ectofuntus / bonemeal** | n/a | n/a | n/a | Not in this revision: no script, obj or loc matches `ecto` or `bonemeal`. |
| **Ashes** | n/a | n/a | n/a | No ashes obj carries `bone_exp`. Only `bones.obj`, `tutorial.obj` and `quest_mm.obj` define it. |
| **Funeral pyre** (Shades of Mort'ton) | Fiyr remains 90 + magic pyre bonus 10 = **100** (`mortton.obj:82`, `flamtaer_pyre.struct:66`; `mortton_pyre.rs2:202`) | at least about 6: logs on the pyre, remains on, light (a 3-tick `%action_delay` loop, `mortton_pyre.rs2:164-184`), then a 2-tick reward queue that blocks the next pyre (`:63`, `:209`) | **at most about 17** (inferred) | Under half the bury rate. It also needs the quest at the pyre-logs stage (`%morttonquest`, `:59`), Firemaking 80 for magic pyre logs, sacred oil, and helpers killing shades for remains. The Firemaking doc reaches the same verdict for its own skill (`firemaking.md`). Not measured, because a 2x loss in the read cadence cannot flip. |
| Delivering 28 unnoted bones per trade instead of banking | 72 | trade 9 ticks (5 with the rs/22 fix, `primitives.md` section 6) against a 4-tick bank gap | lower | The bank wins by 1-5 ticks per inventory, and the helper doesn't need to stand by. |
| Genie lamp | any skill | n/a | n/a | Random-event reward, untradeable (`xplamp.obj:12`), and random events are off in production (`fly.toml:25`). |

**Interleaving: most of Prayer can be absorbed into self-only time** (`interleaving.md`
section 8, the absorbable-fractions table; per-stun and per-clock figures measured there at
300 ms, the totals here inferred). Burying is a 2-tick delayed action, so it fits in three
hosts: a pickpocket stun (1.96 bones per stun measured), the 3-tick knife Woodcutting loop (1
bone per cycle, measured, rs/105), and the wait ticks of an un-manipulated 4-tick Woodcutting
clock (1 bone per 4 ticks) or 5-tick fly fishing (1 per 5).

- **Pickpocket stuns.** Under Package B the Magic enchants no longer compete for the stuns:
  they all happen before Tree Gnome Village, and Thieving starts after Fight Arena
  (`magic.md` section 5). So all of Thieving's ~100 stuns go to bones: **~196 bones, ~392 bury
  ticks plus ~7 bank visits (~28), so ~420 standalone ticks absorbed**. Bones take a slot
  each, so a load of ~24 lasts ~12 stuns, and ~8 top-up trades (5 ticks fixed client, 9
  stock) are not absorbed. **This share is clean:** the host loop is the plain pickpocket
  loop, and Thieving has no knife column (no tick-manipulation variant) for it to net against.
  The stun's packets fit the budget (3 per tick at +2, +4, +6, measured). If Charge's or
  Fletching's stacks ride the same loads (magic.md section 5, fletching.md), each takes a slot
  from the bones, so a load drops to ~21-22 bones and the top-ups rise to ~9-10 (inferred).
- **The knife Woodcutting loop.** The other ~348 bones (555 - 11 early - 196), and the 11
  early ones, ride the 3-tick knife Woodcutting loop: `[knife, button, drop, bury]` on the
  roll label and the re-click alone two labels later, landing on the next roll tick
  (measured, rs/105, [`research/bones-placement.md`](../research/bones-placement.md)). One
  bone per cycle, 0.298 per tick, so ~1,200 of S07's knife ticks, at **0.23 Woodcutting ticks
  per bone** with real top-up trades (23 per load, 5 ticks each). That holds against
  Woodcutting's knife column. Plain 4-tick Woodcutting + bury costs 1.17 per bone against the
  knife column (measured), and 5-tick fly fishing + bury 2.04, no better than the booth; Mining
  is a reserve host (~200 bones on a reordered lap).

| Plan | Prayer's own ticks to 99 | Basis |
|---|---|---|
| Standalone (bank booth) | **1,151** (measured run 1,221 with stalls) | section 2 |
| Stuns only: 11 early + 196 in stuns + 348 standalone | **about 800** (21 + 723 + 40-72 of top-ups) | inferred |
| **Stuns + knife Woodcutting** (recommended) | **about 80-110** (359 bones x 0.23-0.30; no S10a or booth step) | 0.23 measured per bone with trades, oak; `research/bones-placement.md` sections 5-6 |
| Stuns + plain 4-tick WC, against WC's knife column | about 420 (359 x 1.17) | measured rate, `research/bones-placement.md` section 1 |

## 6. Gotchas

- **Level-up dialogs**: 67 over 1 -> 99. A click sent while the dialog is up is
  refused (section 4). Dismiss the dialog and click Bury in the same tick.
- **Do not wake a wait on "dialog open".** The first stock loop waited for
  "bone gone *or* dialog open". The dialog from the previous level-up was still
  showing, so the wait returned at once, the next click landed during the
  delay, the server dropped it, and the loop sat out a 5-second (17-tick)
  timeout. That run took **1,810 ticks** instead of 1,298 (measured, 40
  timeouts). Wait on the bone leaving its slot.
- **Seven dragon bones are not level 37.** They give 504.0 base and 37 needs
  504.9. Use 8, or 7 dragon bones plus any regular bone.
- **Bot stalls at 300 ms.** Every long run had a few multi-tick gaps with
  nothing in the game to explain them: 12-28 ticks in the fast runs and 33-89
  in the stock run. One 300 ms batch timed out outright and was rerun. They add
  about 6% to the fast run. Main attributes them to host load on the lab
  machines, not to the game (cairn://p/rs/main, 00:36; section 8).
- **Inventory**: the account carries nothing but the 28 bones. Deposit
  everything before the first cycle. Withdraw-all into a full inventory just
  prints "You don't have enough inventory space" and does no harm.
- **Hostile NPCs, damage, food, travel**: none. Any bank booth works; bank
  wherever the account already is. Random events can fire from a bury
  (`bury_bone.rs2:18-20`), but production runs with `NODE_RANDOM_EVENTS=false`.
- **xp past 99 is wasted.** That matters only if a Prayer quest returns to the
  route: with Holy Grail, bury at most 402 bones before the quest.

## 7. Helper supply list

| Item | Quantity | Form | Where helpers get it |
|---|---|---|---|
| Dragon bones | **555** on the current route (no quest xp). Conditional: 402 if Holy Grail returns, 536 with Priest in Peril, 383 with both | One **noted** stack (`cert_dragon_bones`) in a single trade. The account deposits it once, and the bank stores it unnoted. | Dragon kills: the King Black Dragon always drops one (`king_black_dragon.rs2:9`), and every red, blue, black, bronze, iron and steel dragon has `death_drop,dragon_bones` (`karamja.npc:596-680`, `_unpack/225/all.npc`). The Grand Exchange is the alternative. |
| Early Protect from Melee / Magic, before the first quest fights | **11** (for 43, which covers 37) of the above | **unnoted**, traded straight into the inventory and buried on the spot (no bank) | same; not extra bones, just delivered earlier |

Banking cadence: 555 bones are **20 inventories** (19 full plus 23 bones), or 544
after the 11 early bones. Each inventory is 58 ticks with the fast loop and 59
with the stock SDK. If Holy Grail returns, 402 bones are 15 inventories. On top of that comes one trade of a single noted stack plus one
deposit: about 9 ticks for an adjacent helper's trade (`primitives.md`
section 6) and a deposit of about 2 ticks (inferred, not measured; the lab used
`::give`).

## 8. Open questions

- **The raw-packet floor** (3-tick bank gap, about 20 ticks over the skill) is
  inferred. It needs a client that sends Bury for a slot it has not seen
  filled yet. That belongs in `speedrun/lib/`, if it is ever worth it.
- **The bot stalls** (12-89-tick gaps at 300 ms). The game state at each stall
  was ordinary: no dialog, bones in the inventory, bank closed. Main judges
  them host load (00:36): the labs ran on loaded executors (fedora here; the
  Mac at 11-18 on 16 cores for most of rs/28's skills), while bbs sits at ~3 on
  32 cores. rs/26 re-timed Thieving on bbs but published no single correction
  factor; `docs/speedrun/LAB.md` on main names bbs the reference host. Treat
  the measured runs as a few percent pessimistic and the 58-tick stall-free
  cycle as the clean rate.
- **Priest in Peril**: off route per the brief, but `haunted_mine.md` says
  Haunted Mine requires it. If it lands on the route, Prayer saves 19 bones
  (about 40 ticks).
- **The trade and deposit of the noted stack** were not measured here; the
  numbers come from `primitives.md`.
- **Bone supply rate** (dragon kills per hour, GE liquidity) belongs to the
  helper logistics and was not measured.

## 9. Module: the booth fallback (`speedrun/skills/prayer.ts`, S25b)

Prayer's primary path buries inside other modules: S07's knife loop (`woodcutting.ts`), the Mining
`stay2` lap and S18's stuns (STEP-MANIFEST.md entry 15). The step `prayer.ts` adds is
**booth-only**. It runs when bones are left over and buries them at the Varrock west booth
(3186,3436), from (3185,3436).

`prayer.ts` also exports `buryHeld`, the one primitive for burying the bones in the pack where the
account stands, with no booth: S07's pure-bury tail after Woodcutting 99 runs it (`woodcutting.md`),
and any other step that must bury a held pack should call it rather than add a loop. It sends
each Bury on the frame that shows the last bone gone, the first frame after the bury's delay has
cleared (section 4), so no click is dropped, and stops on `untilLevel`, a `keepOn` predicate, an
empty pack, `BURY_STALL` unanswered Burys in a row, or its tick bound. With a round trip inside a
tick that is one bone per two ticks, the booth loop's in-inventory rate.

- **Loop** (overlay-driven, one decision per observed tick). With bones in the pack, it clicks Bury
  on the lowest bone slot every tick. The server drops the click in each bury's delayed tick, so
  the accepted clicks land every 2 ticks (section 4). With none left, it clicks the booth (Use-quickly)
  on the first tick the pack shows none. When the bank is open, it sends `lib/bank.ts` `withdrawMany`
  (`n: 'fill'`, or exact counts when a second bone type completes the load) and close in the same
  tick. Level-up pages go through `lib/levelup`'s watcher, which listens ahead of the loop, so
  Continue leaves before that tick's Bury.
- **Event budget.** The budget never binds. The peak is 3 events in a tick: the routed booth click
  (MOVE_OPCLICK + OPLOC) beside a Continue, or a withdraw beside its close.
- **Parameters:** `bones` (a count or `'all'`), `untilLevel` (the last load takes only the bones
  it needs), `take` (bone types, dragon first and then babydragon), and `freeSlots` (default 28;
  the inventory ledger has no S25b row of its own).
- **Preconditions refuse, never throw.** They refuse when the account is not at the booth, when no
  bones are held or banked (judged only while the bank is open; with the bank closed, the first
  visit refuses with the same reason), and when the first withdrawal would not have its free slots.
- **Resume.** The step is logoutSafe between loads, and `run` works from any state at the booth, so
  held bones are buried first. A held noted stack is banked on the first visit, which costs that
  visit one tick. The `boneBank` probe lets `done` see a closed bank.

**Lab acceptance** (`speedrun/lab/prayer-accept.ts`): bgsrv-mac (macOS, 12 cores), load 1.8-3.8, local
engine at 300 ms, browser runs on a freshly built webclient bundle, measured 2026-10-22:

| Case | Client | Bones | Cycles, bank open to bank open | Step ticks | Level-up pages | Pass |
|---|---|---|---|---|---|---|
| inv5 | lite | 140 | 58, 58, 58, 58, 58 | 292 | 47 | yes |
| inv5 | browser | 140 | 58, 58, 58, 58, 58 | 292 | 47 | yes |
| cold, run 1 | browser | 56 | 58, 58 (bank open 1 tick after the step starts) | 118 | 34 | yes |
| cold, run 2 | browser | 56 | 58, 58 (1 tick) | 118 | 34 | yes |
| cold, run 3 | browser | 56 | 58, 58 (1 tick) | 118 | 34 | yes |

The bar is 58 + 5% = 60.9. Every in-inventory xp gap was 2 ticks and every bank gap was 4. No
booth click was dropped after the cold walk in from Varrock east bank (one per visit).
