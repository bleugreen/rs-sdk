# Interleaving: helper-fed actions inside self-only time

Scripts: [`interleave-lab.sh`](../scripts/interleave-lab.sh) (one-batch lab, port block
9280/9281/9282/43980/8180, `NODE_TICKRATE=300` by default),
[`interleave-gather.ts`](../scripts/interleave-gather.ts) (every-tick bursts on a gathering loop),
[`interleave-phase.ts`](../scripts/interleave-phase.ts) (per-phase packet plans locked to the
gathering clock: bury, enchant), [`interleave-thieve.ts`](../scripts/interleave-thieve.ts)
(packets during pickpocket delays and stuns). Every number below was measured at
`NODE_TICKRATE=300` on a local engine driven by the headless lite client, unless it is
labelled read or inferred. Base xp = game xp / 25.

**Host.** The 300 ms batches ran on the Mac executor `local`, which main measured at load 11-18
on 16 cores that night (cairn://p/rs/main, 00:36). Read the measured rates as a **busy host's
figures, a few percent pessimistic**. That matters more here than elsewhere: the phase-locked
plans and the 4-events-per-tick budget depend on packets landing on predicted ticks, and a
loaded host pushes some of them a tick late (the Fishing lock losses in section 2 and the
~1-tick enchant recovery in section 4 may partly be that). rs/26's bbs correction factor had not
been published when this was written (01:15).

## Checklist for bot authors

The rules a `speedrun/lib` interleaver must follow (each is measured below):

1. **Helpers first, click last.** Any inventory op (OPHELD, item on item, spell on item)
   cancels the gathering interaction. A re-click sent after it in the same tick restores the
   loop with its clock intact. A click sent before the helpers, or no click, ends the loop.
2. **At most 4 user events per tick, never 5.** The server decodes 5 per tick and carries the
   rest over in order. If one 5-event burst straddles a tick boundary, the late click heads
   the next tick's window, that tick's helpers cancel it, and because every later burst is
   also 5 the 1-packet backlog never drains. Measured: 205 dead ticks with helpers landing
   every tick. If you do send 5, add a click-only tick whenever the player goes idle.
3. **No helpers while walking.** A click on an out-of-reach target is 2 events
   (MOVE_OPCLICK + OP). On a target switch or while moving, send only the click (or drop to
   2 helpers).
4. **Fishing: never re-click on the roll tick, and phase-lock the helpers.** The fishing
   first-click label never rolls. A re-click every tick catches nothing.
5. **Charge needs no re-click.** It is an interface button, not an inventory op.
6. **Delayed actions (bury, alch, enchant) go only into free ticks**: the wait ticks of a
   4-tick Woodcutting or 5-tick Fishing clock (bury only), or a pickpocket stun (all three).
7. **Thieving: interleave inside stuns only.** Helpers between attempts slow pickpocketing.
8. **Level-ups cost gathering ticks.** Each one opens a chat dialog that makes the player
   busy for the tick it pops. Let helper skills level where no gathering roll is waiting
   (inside stuns, or standalone).

## 1. Mechanism (read)

- Client packets are decoded before players are processed each tick (`World.ts:402,425`).
  At most 5 *successful* USER_EVENT packets are decoded per tick. Decoding stops there and
  resumes next tick in order (`ClientGameProtCategory.ts:5-8`, `NetworkPlayer.ts:69`). A
  handler that returns false (for example "player is delayed") is counted as a CLIENT_EVENT
  (limit 20), not a user event (`NetworkPlayer.ts:138-147`). So rejected packets are consumed
  and dropped, never queued, and do not use the budget.
- `OpHeldHandler` calls `clearPendingAction()` when the inventory is not part of the open
  main modal (`OpHeldHandler.ts:54-56`). `OpHeldUHandler` (item on item) and
  `OpHeldTHandler` (spell on item) always call it (`OpHeldUHandler.ts:86`,
  `OpHeldTHandler.ts:57`). `clearPendingAction` clears the interaction and closes modals
  (`Player.ts:1027-1030`). That ends a `p_oploc`/`p_opnpc` gathering loop.
- `IfButtonHandler` never clears the interaction (`IfButtonHandler.ts`), and Charge only
  `if_close`s (`charge.rs2:2`, `PlayerOps.ts:246-248` = `closeModal`). Charge therefore leaves
  the gathering loop alone.
- The gathering clock is the varp `%action_delay`, not the interaction. A fresh click runs the
  first-click label, which rolls when `%action_delay = map_clock` and re-arms only when the
  clock has passed (`woodcut.rs2:55-101`, `mining.rs2:76-86`). Those are the same branches
  as the continue label (`woodcut.rs2:153-160`, `mining.rs2:118-124`). So a same-tick
  re-click keeps the cadence. The interaction only has to be live on the arming tick and the
  roll tick.
- Fishing differs: `attempt_fish_trout_salmon` arms or messages and never rolls
  (`freshfish.rs2:25-56`), so a re-click that lands on the roll tick costs that roll.
- Every op handler rejects while `player.delayed` (`OpHeldHandler.ts:16`,
  `OpLocHandler.ts:14`, `OpNpcHandler.ts:16`, ...). `p_delay(n)` sets
  `delayedUntil = tick + 1 + n` (`PlayerOps.ts:376-380`), and the flag clears in the player
  phase (`World.ts:776`). So an action with `p_delay(n)` sent on tick T rejects every packet
  on ticks T+1..T+n+1 and cancels the interaction on T. That is n+2 ticks with no gathering.
  An `IF_BUTTON` while delayed is accepted, but its protected script does not run
  (`Player.ts:2233`).
- Level-ups: `addXp` queues `[advancestat,*]` on the engine queue (`Player.ts:1944-1946`). It
  runs in the player phase before `processInteraction` (`World.ts:793-801`), opens a chat
  modal and pauses (`levelup.rs2`). The player is then `busy()` (`Player.ts:873-880`) and no
  interaction runs that tick. One level-up pops per tick, and the next packet's
  `clearPendingAction` closes the dialog.
- The real client path: the SDK sends actions to the gateway, and the lite runner executes
  one queued action per 20 ms in FIFO order (`runner.ts:29,186-249`, `ActionQueue.ts`). The
  session loop flushes every 20 ms (`session.ts:25,192`). Packets are never reordered or
  coalesced, and a 4-5 action burst leaves the client over ~80-100 ms.

Delay class of each helper-fed candidate (read):

| Action | Packet | Delay | Clears interaction |
|---|---|---|---|
| Attach arrowheads / dart tips (`arrows.rs2`, `darts.rs2`), 15 / 10 per action | OPHELDU | none | yes |
| Mix potion (`herblore.rs2:10-24`) | OPHELDU | none | yes |
| Cut gem (`uncut_gem.rs2`) | OPHELDU | none | yes |
| Charge (`charge.rs2`) | IF_BUTTON | none | **no** |
| Bury bones (`bury_bone.rs2`) | OPHELD | `p_stopaction` + `p_delay(0)`: 2 ticks | yes |
| Enchant (`enchant.rs2`), Superheat (`superheat.rs2:67`) | OPHELDT | `p_delay(1)`: 3 ticks, xp first | yes |
| High Alchemy (`alchemy.rs2:23-37`) | OPHELDT | `p_delay(3)`: 5 ticks, xp first | yes |

## 2. Gathering with and without interleaving (measured)

Woodcutting: Draynor willows, level 99, rune axe. Mining: Al Kharid iron, 2 adjacent rocks,
rune pickaxe. Fishing: Barbarian Village lure. All runs at 300 ms.

| Run (script, flags) | Ticks | Gather base xp/tick | Helper actions/tick | Notes |
|---|---|---|---|---|
| WC baseline, click once (`interleave-gather --skill=wc`) | 600 / 400 | 11.14 / 11.64 | 0 | gaps 4:55 8:9 ... |
| WC, re-click every tick, no helpers (`--reclick=every`) | 400 | 10.46 | 0 | |
| WC, `[3 x arrows, click]` every tick (`--helper=arrows --k=3`) | 600 | **12.71** | **2.80** | exactly 3 landed every non-drop tick; gaps 4:62 5:7 8:18 9:2 12:2 |
| WC, `[4 x arrows, click]` + idle drain (`--k=4 --drain`) | 600 | 11.25 | 3.52 | 18 drain ticks |
| WC, `[4 x arrows, click]` no drain (`--k=4`) | 600 | 1.80 | 3.91 | backlog failure (rule 2) |
| WC, `[5 x Charge]`, no re-click (`--helper=charge --k=5 --order=noclick`) | 400 | 9.79 | 4.73 Charge casts | all gaps multiples of 4 |
| WC, click before helpers (`--order=before`) | 60 | 0 | 2.25 | control |
| WC, no click (`--order=noclick`, arrows) | 60 | 0 | 1.60 | control |
| Mining baseline (`--skill=mine`) | 450 | 5.056 (65 ores) | 0 | gaps 3:43 15:21 (respawn waits) |
| Mining, `[3 x arrows, click]` (`--skill=mine --helper=arrows --k=3`) | 450 | 5.056 (65 ores) | 1.36 | helpers only while a rock was live |
| Fishing baseline (`--skill=fish`) | 450 | 9.56 | 0 | gaps 5:57 10:12 |
| Fishing, re-click every tick | 450 | **0** | 2.95 | rule 4 |
| Fishing, phase-locked `1:hhhc,2:hhhc,3:hhhc,4:hhhc,0:-` (`interleave-phase --skill=fish`) | 450 | 7.89 | 2.10 | lost locks, see below |

The interleaved willow rate (12.71) is above the baseline (11.14) because of willow roll
noise (about 150 rolls per run at roughly 50-60% success, σ ≈ 6 logs) and the baseline's
drop-all handling. It is not an early roll: no gap was shorter than 4 ticks, and the
first-click label rolls only when `%action_delay = map_clock` (read). Nothing here is a
faster Woodcutting route.

The Fishing interleave shortfall (7.9 against 9.6) comes from the bot, not the engine. The
bot takes its phase from observed catches, and the lite client sometimes reports xp one tick
late. A late lock puts the re-click on the true roll tick, rolls are lost until the lock
times out (gaps 21-37), and when a roll is lost nothing re-locks it. Two equidistant spots
also flipped the target. A "sticky spot" fix made it worse (4.4 per tick) and is not data.
A lib implementation needs a better phase source than xp drops. Woodcutting and Mining are
immune, because a re-click on any tick is harmless there.

## 3. Delayed actions in the free ticks of a gathering clock (measured)

`interleave-phase.ts`, dragon bones, 450 ticks per run. Phase 0 is the tick whose packets land
on the roll tick, and phase 1 is the arming tick. Bones and rings are topped up with `::give`
as a stand-in for a helper trade.

| Clock, plan | Gather base xp/tick | Extra landed | Helpers/tick |
|---|---|---|---|
| WC 4-tick, `0:hhhc,1:hhhc,2:hhhc,3:hhhc` (control) | 10.95 | - | 2.01 |
| WC 4-tick, `1:hhhc,2:hhhb,3:-,0:hhhc` | 10.65 | **96 bones = 0.213/tick** (1 per 4 locked ticks) | 1.76 |
| WC 4-tick, `1:hhhc,2:hhhe,3:-,0:hhhc` (enchant) | **0.45** (collapse) | 18 enchants | 0.25 |
| Fish 5-tick, `1:hhhc,2:hhhb,3:-,4:hhhc,0:-` | 8.47 (control 7.89) | **86 bones = 0.191/tick** | 1.54 |
| Fish 5-tick, `1:hhhc,2:hhhe,3:-,4:-,0:-` (enchant) | **0.38** (collapse) | 18 enchants | 0.25 |

Why (read, consistent with the runs): bury on phase 2 rejects phase 3 and is over before
phase 0. Enchant's 3-tick blackout always covers the next arming or roll tick, so the clock
slips every cycle. On Fishing the re-click for phase 0 has to go on phase 4, which a
`p_delay(1)` from phase 2 rejects.

Not fitting by reading (unmeasured): bury on the 3-tick iron clock and on rs/9's 3-tick
eat-manipulated WC/fishing (no 2-tick gap); High Alchemy anywhere in gathering (5 ticks).
Mining's rock-respawn waits (15-tick gaps with 2 rocks) are free ticks for anything,
but that was not measured.

## 4. Packets during forced delays: Thieving and Agility

Pickpocket (read, `thieving.rs2:1-49`, `pickpocket.rs2:126-137`; cadence from rs/2
`thieving.md`): an attempt on T does `p_delay(0)` (T+1 rejects everything). A failure adds
two more `p_delay(0)` (T+2, T+3 reject), then sets `%stunned` and `%action_delay` to
`map_clock + 8`. **The stun is not a `p_delay`**: on T+4..T+10 the player is not delayed,
every packet runs, and the pickpocket script just returns. T+11 is the next attempt.

Measured with `interleave-thieve.ts` (Knight of Ardougne, Thieving 80, 600 ticks, 21-28
stuns per run). Offsets count from the observed "You fail to pick" tick, and offset k lands
near T+2+k.

| In each stun | Landed per stun | Mean failure to next attempt |
|---|---|---|
| nothing (`--outside=0`) | - | 12.3 ticks |
| bury at +2, +4, +6 with 3 helpers each | 1.96 bones, 7.3 helpers | 12.2 |
| enchant at +2, +5 with 3 helpers each | 1.92 enchants, 5.2 helpers | 13.4 |
| High Alchemy at +2 with 3 helpers | 1.00 alch (28 of 28), 3.0 helpers | 12.0 |
| 4 helpers per tick at +2..+7 | 22.5 helpers | 11.5 |
| 5 helpers per tick at +1..+6 | 28.0 helpers | slower (rule 2) |

So stun-time actions do not delay the next attempt, except enchanting at about +1 tick per
stun. A third bone per stun (T+4, T+6, T+8) is possible by reading but lands about 2/3 of the
time with the observation jitter.

Outside the stun the success cadence is click on T, everything rejected on T+1. Helpers
before the click do land (1.4-1.8 per tick), but they slow the pickpocket loop: 3.23 ticks
per attempt against a failure-adjusted 2.87 at level 99, and 6.25 against 4.41 at level 80
(knights wander, so clicks often need a route). **Interleave Thieving only inside stuns.**

Agility (read, not measured): obstacles run under `p_delay`/`exactmove`, so every op and
inventory packet is rejected during an obstacle, and an IF_BUTTON's script does not run.
Only the obstacle click tick and any walking between obstacles can carry helpers, with the
usual helpers-before-click rule. rs/2's chosen course has no forced walking
(`agility.md:13-15`). Inferred: Agility hosts very little.

## 5. Level-ups (measured)

`interleave-gather --skill=wc --helper=arrows --k=3 --helperlevel=1`, 300 ticks: Fletching
rose from 1 by about 17,100 base xp, the bot saw 29 dialog episodes, and Woodcutting fell to
**6.08** base/tick against ~11-12.7 (gaps off the 4-tick grid: 5, 7, 9, 13). That is about
136 Woodcutting ticks lost to one helper skill's early levels (inferred from the rate gap).
A helper skill's 98 level-ups therefore cost more gathering than its ~50-90 standalone ticks.
Level the delay-free skills inside stuns (dialogs there block nothing) or standalone. A 99
helper skill (or Charge 80-99, 19 level-ups) is harmless.

## 6. Packets per tick through the real path (measured)

- 5 Charge casts sent per tick landed 4.73 per tick on average (328 of 400 ticks at 5, the
  rest 3-4 with the surplus landing next tick). 3 helpers + click landed exactly 3 on all
  559 non-drop ticks. No reordering or coalescing was seen. A burst that straddles a tick
  boundary moves its tail into the next tick in order, which is what makes 5-event bursts
  fragile (rule 2).
- At 300 ms a bot reacting to the observed tick lands its packets on the next server tick.
  The 20 ms per action pacing leaves about 200 ms of slack for a 4-event burst (inferred
  from `runner.ts:29`).

## 7. Interplay with tick manipulation (rs/9)

rs/9's eat technique sends `[eat, drop?, click]` on the tick after each roll for a 3-tick
Woodcutting/fly-fishing cycle. Eat is an inventory op, so it is one more "helper" before the
click. Delay-free helpers compose with it within the 4-event budget, as `[eat, h, h, click]`
then `[h, h, h, click]` (and nothing on fishing's roll tick) (inferred, not measured
together). Delayed actions compete with it: bury needs the 4-tick clock's 2-tick gap, which
the 3-tick cycle removes. Per bone that is 1 extra Woodcutting tick (4 instead of 3) against
2 standalone bury ticks saved, so 4-tick WC + bury is worth +1 tick per bone over 3-tick WC +
standalone bury, before trade logistics (inferred).

## 8. Which helper-fed skills fit, and how much (inferred from the measurements above)

Stun budget: Thieving 55-99 needs 452 successes and had 96-106 failures in rs/2's three
runs (`thieving.md:67-70`). That is about 100 stuns and about 700 usable stun ticks. Plans
share the stuns. Standalone ticks saved per stun: 2 bones = 4 ticks, 2 enchants = 6 ticks
(3 ticks each, less the ~1-tick recovery), 1 alch = 5 ticks, 22 delay-free actions =
~4.5 ticks at 5 per tick.

| Skill / action | Fits | Absorbable | Inventory constraint |
|---|---|---|---|
| Fletching (arrows, darts) | anywhere, delay-free | all ~213 rune-arrow actions (~48 standalone ticks); level-ups only in stuns or standalone | 2-3 stack slots |
| Herblore (mixing) | anywhere, delay-free | all ~270 potions (~89 standalone ticks) | 2 non-stackable slots per potion: ~13 per load, so the top-up trades dominate |
| Crafting (gem cutting) | anywhere, delay-free | all ~290 gems (~80 standalone ticks) | 1 slot per gem + chisel |
| Magic, Charge 80-99 | anywhere, no re-click | all (~33 standalone ticks), 5 per tick | 3 rune stacks |
| Prayer, bury dragon bones | 4-tick WC (1/4 ticks), 5-tick fishing (1/5), stuns (~2) | ~200 of ~555 bones in stuns; the rest needs ~4 WC ticks or ~5 fishing ticks per bone | 1 slot per bone; a top-up every ~12 stuns or ~50-100 gathering ticks |
| Magic, enchant / Superheat (`p_delay(1)`) | stuns only (~2 per stun) | ~190 casts by capacity; **0 on rs/3's Package B route**, whose 60 enchants all come before Thieving starts (below) | 1 slot per item |
| Magic, High Alchemy (`p_delay(3)`) | stuns only (1 per stun) | ~100 casts | 1 slot per item, plus natures |
| Smithing (anvil), Firemaking (lines), Runecraft (altar), Cooking (range), combat | **no**: they need a location or are the self-only activity | - | - |

Totals are small for the delay-free skills (~250 standalone ticks together). The larger
prizes are Prayer (~400 ticks of burying absorbable in stuns, more in 4-tick WC or fishing)
and, on routes where it comes late enough, Magic enchanting (~190 casts in stuns). Each top-up
trade is real time that is not absorbed, so the saving is the standalone action time, not the
logistics.

### Stun allocation on rs/3's Package B route (inferred from the per-stun figures above)

The earlier allocation (rs/28 coordinator, 23:56) spent about 80 stuns on Magic's enchant
ladder 7 -> 71 (~150-170 enchants, ~450 standalone ticks absorbed) and about 20 on dragon bones
(~40 bones, ~80 ticks): about 530 ticks in all. Package B changes the Magic side completely.
The pre-MM fights are cast and pay ~3,600 base Magic, so the ladder now stops at 59 (60
enchants) and the Mage Arena is reached at base 76-77 without more (`magic.md` section 1). Those
60 enchants must all be done **before Tree Gnome Village**: the Ardougne teleport at 51 and the
warlord's Fire Blast at 59. Thieving is trained only **after Fight Arena**, whose 2,175 Thieving
is worth most while Thieving is low (rs/3 README section 4). So no enchant can be in a stun.

| Use of Thieving's ~100 stuns (55 -> 99) | Before (Package A plan) | Package B |
|---|---|---|
| Enchants | ~80 stuns, ~150-170 casts, ~450 ticks | **0** |
| Dragon bones (1.96 per stun, measured) | ~20 stuns, ~40 bones, ~80 ticks | **~100 stuns, ~196 bones: ~392 bury ticks + ~7 bank visits (~28), so ~400-420 ticks** |
| Top-up trades (not absorbed) | ~8 | ~8 (bones at ~24 per load, ~12 stuns each) |
| **Standalone ticks absorbed** | **~530** | **~400-420** |

The measured per-stun figures are unchanged; only the allocation moves. Prayer's other ~348
bones (555 - 11 early - 196) can still ride un-manipulated 4-tick Woodcutting or 5-tick fly
fishing (section 3), which would absorb up to ~700 more standalone ticks (`prayer.md` section
5). A third bone per stun (T+4, T+6, T+8) lands about 2/3 of the time by reading, which would
lift the stun share to ~260 bones (~520 ticks); unmeasured as a sustained plan. Charge 80 -> 99
(~33 standalone ticks, after the Mage Arena) is absorbable into any later gathering session
(`magic.md` section 5).

## 9. Open questions

- A reliable fishing phase source (rule 4). With xp-drop locking the Fishing interleave lost
  ~18% of catches. A lock from the animation or a server-side roll signal would remove that.
- Mining rock-respawn waits and the Firemaking 4-tick light chain (rs/28 firemaking.md) as
  hosts for bury and delay-free actions: unmeasured.
- Agility: whether a helper burst before each obstacle click is accepted without delaying
  the obstacle. Unmeasured.
- Production latency: all numbers are local. On rs-sdk-demo.fly.dev the jitter is larger, so
  rule 2's slack and the drain tick matter more. Measure the straddle rate there before
  relying on 4 events per tick.
- Enchant in stuns costs ~1 tick per stun on average (4 of 24 stuns recovered late). The
  cause is unconfirmed, probably the same observation jitter putting the second cast on T+8.
