# Engine sweep D: packets, delays, cancellation and overlap (rs/67)

Part of cairn://p/rs/61 (audit every effect by what guards it). The sibling census children
cover the content scripts' xp rows; this file covers the **engine rules** that turn a script's
guards into an achievable rate, the known exploits' guards, and which flows can be driven
blind.

Conventions. Paths are under `server/engine/src/` unless they start with `content/`, which
means `server/content/scripts/`. Every claim carries a label:

- **read**: read in the source at the cited lines.
- **measured**: observed on the lab (section 7 gives the script, host and sample).
- **inferred**: follows from read code, not observed.

Source is `main @ 9c1397eb9` (this branch's base). Nothing under `server/` or `sdk/` was
changed.

## 0. Summary for the run planner

1. Packets are decoded and **executed inline** at the start of each tick, before NPCs, queues,
   timers and interactions (`engine/World.ts:402`, `engine/entity/NetworkPlayer.ts:137-138`;
   read). An OPHELD/IF_BUTTON/INV_BUTTON script runs inside the packet handler; an
   OPLOC/OPNPC/OPOBJ/OPPLAYER only sets a target that runs later in the same tick.
2. Each tick takes at most **5 successful USER events** per player; the rest stay in the socket
   buffer for the next tick. A USER event the handler **refuses** is consumed and dropped, and
   counts against the 20-per-tick CLIENT budget instead, so refusals are nearly free
   (`NetworkPlayer.ts:69, 141-147`, `network/game/client/ClientGameProtCategory.ts:5-8`; read).
3. While `delayed` (p_delay, p_arrivedelay) every op packet and MOVE_CLICK is **dropped, not
   queued**. IF_BUTTON, RESUME_PAUSEBUTTON, RESUME_P_COUNTDIALOG and CLOSE_MODAL have no delay
   check. A `p_delay(n)` started on tick T blocks packets on T+1 .. T+1+n; the next accepted
   packet is on T+2+n (read; measured for bury: 5 clicks at once bury 1, one click a tick buries
   every 2 ticks, section 7).
4. Every op packet, every inventory op and MOVE_CLICK cancels the current interaction, closes
   modals and **clears the weak queue**. IF_BUTTON, INV_BUTTON and CLOSE_MODAL never touch
   the interaction. Buttons on the four "overlay" side tabs (magic, prayer, stats,
   staff spells) run **unprotected**, so Charge can be cast up to 5 times a tick beside a
   running gathering loop, and both grant xp in the same tick (measured, section 7; section 3
   lists every overlap path).
6. Normal timers (wine fermentation) wait for `canAccess()`: any open modal, including a
   level-up chat, holds them; every new wine restarts the 20-tick clock (measured).
7. The server accepts an inventory-tab op while the bank is open: it closes the bank and runs
   the op in the same packet (measured). `sdk/index.ts:1183-1186` says the opposite.
5. About 270 inventory and button triggers produce an item or xp with no delay, queue or menu
   on any path (static census, `speedrun/lab/census-delayfree.ts`), so they run at 5 per tick.
   Make-X menus can be answered blind in the same tick, but the content allows **one** menu
   completion per tick; a second costs a `p_delay(0)` (`content/interface_chat/scripts/chat.rs2:734-738`).

## 1. Tick order and the packet budget

### 1.1 One world tick (`engine/World.ts:384-468`, read)

| Step | Code | What runs |
|---|---|---|
| 1 | `processWorld` (`World.ts:395, 616-679`) | world queue scripts, delayed obj spawns, NPC hunt |
| 2 | `processClientsIn` (`World.ts:402, 685-729`) | per player, in player-loop order: **`playtime++`** (`World.ts:692`), afk-event roll every `AFK_EVENTRATE` ticks (`:694-696`), input tracking, then `decodeIn` (`:701`), which reads and **executes** packets one by one |
| 3 | `processNpcEventQueue`, `processNpcs` (`World.ts:405, 414`) | NPC spawn/despawn triggers, then every NPC's turn (scripts, timers, queues, movement, modes) |
| 4 | `processPlayers` (`World.ts:425, 771-824`) | per player: clear `delayed` if `currentTick >= delayedUntil` (`:776`); resume a SUSPENDED script (`:779-781`); strong/normal queue then weak queue (`:785`); normal timers, then soft timers, skipped while logging out (`:786-791`); engine queue (`:793`); face target; **interaction + movement** (`:801`); recover items; run energy |
| 5 | `processLogouts` (`World.ts:428, 826-904`) | logout requests honoured against `p_preventlogout` and the queue |
| 6 | `processLogins` (`World.ts:434`) | new players enter after everything ran, so their first `playtime++` is the next tick |
| 7 | zones, info, `processClientsOut` (`World.ts:440-458`) | the state the client sees for this tick |

Consequences (read unless marked):

- **Playtime** is counted at the top of client input for every player in the player loop, before
  their packets (`World.ts:692`). A player who logs out on tick T is removed in step 5 of T, so T
  is counted; the login tick is not (step 6 runs after step 2).
- A packet that lands on tick T acts **before** that tick's queues, timers and interaction. That
  is why a starter on R+1 overwrites `%action_delay` before the gathering script on R+1
  (`docs/speedrun/skills/tick-manipulation.md` on the rs/2 branch, section 2).
- Catch-up is capped at 2 ticks of backlog (`World.ts:387-389`): after a stall the server runs
  up to 2 ticks back to back, which is when "on-time" packets land a tick late. rs/62
  (cairn://p/rs/62) gates the knife loops on this; it is not repeated here.

### 1.2 How many packets per tick (read)

`decodeIn` loops `while (userLimit < 5 && clientLimit < 20 && restrictedLimit < 2 && read())`
(`NetworkPlayer.ts:69`; limits `ClientGameProtCategory.ts:5-8`). `read()` decodes one packet
and calls its handler synchronously (`NetworkPlayer.ts:132-138`). Then (`:141-147`):

- a USER_EVENT whose handler returned **true** increments `userLimit`;
- a RESTRICTED_EVENT increments `restrictedLimit` (no packet is in that category: every model
  under `network/game/client/model/` is USER_EVENT or CLIENT_EVENT);
- **everything else, including a USER_EVENT the handler refused, increments `clientLimit`**.

Categories (read, `network/game/client/model/*.ts`): every gameplay packet is USER_EVENT:
OPHELD*, OPHELDU, OPHELDT, OPLOC*, OPLOCU/T, OPNPC*, OPNPCU/T, OPOBJ*, OPOBJU/T, OPPLAYER*,
OPPLAYERU/T, IF_BUTTON, INV_BUTTON*, INV_BUTTOND, RESUME_PAUSEBUTTON, RESUME_P_COUNTDIALOG,
MOVE_*CLICK, CLOSE_MODAL, chat, friends, cheats (`::` commands), TUT_CLICKSIDE.
CLIENT_EVENT: mouse/camera/focus/idle/anticheat.

What happens to the rest:

- **Buffered.** When 5 USER events have succeeded, the loop stops; unread bytes stay in the
  socket buffer and are decoded first next tick (`NetworkPlayer.ts:69`, comment at
  `ClientGameProtCategory.ts:10`). A burst of k accepted events costs ceil(k/5) ticks
  (measured for bank/dialogue in `speedrun/README.md`; measured again here for a
  delay-free OPHELD, section 7).
- **Dropped.** A packet whose handler refuses it (delayed, item not in slot, component not
  visible, no pending dialog) has already been read: it is gone, and it cost a CLIENT slot,
  not a USER slot. Up to 20 refusals fit in a tick before decoding stops.

So over-sending is cheap: blind continues past the last page, or a held op sent into a delay,
are refused without eating the 5-event budget for the packets behind them (inferred from
`:141-147`).

## 2. Delays, protection and what each packet does to them

### 2.1 The state variables (read)

| State | Set by | Cleared | Meaning |
|---|---|---|---|
| `delayed`, `delayedUntil` | `p_delay(n)`: until = now + 1 + n (`engine/script/handlers/PlayerOps.ts:376-380`); `p_arrivedelay`: until = now + 1, only if the player moved this tick or last (`lastMovement >= map_clock`, `PlayerOps.ts:359-367`; `lastMovement = tick + 1` after a step, `engine/entity/Player.ts:747-749`) | `World.ts:776`, in step 4, **after** that tick's packets | the active script is SUSPENDED and resumes at `World.ts:779-781` |
| modal (`busy()`) | `if_openmain/chat/side` | `closeModal` (`Player.ts:817-871`) | `busy() = delayed or a main or chat modal is open` (`Player.ts:878-880`) |
| `protect` | a protected script while it runs (`Player.ts:2239-2248`); kept while that script is paused in a delay, a pause button or a count dialog (`Player.ts:2283-2284`) | end of script; `closeModal` when not delayed (`Player.ts:821-823`) | `canAccess() = !protect && !busy()` (`Player.ts:882-889`) |
| interaction (`target`, `targetOp`) | op packets and `p_op*` (`engine/entity/PathingEntity.ts:534-561`) | `clearInteraction` (`PathingEntity.ts:563-569`), via `clearPendingAction` (`Player.ts:1027-1030`) or `stopAction` (`Player.ts:1021-1024`) | runs in step 4 when `canAccess()` (`Player.ts:1314, 1346`) |
| weak queue | `weakqueue` (`PlayerOps.ts:124-133`) | **every** `closeModal()` call (`Player.ts:818-820`), and resuming the active script with no main modal (`Player.ts:2268-2270`) | runs in step 4 when `canAccess()` and its delay has elapsed (`Player.ts:973-983`) |
| normal/strong queue | `queue`, `strongqueue`, `longqueue` (`PlayerOps.ts:100-181`) | the script runs, or `clearqueue` | runs when `canAccess()` (`Player.ts:961`); a strong entry first closes modals (`Player.ts:932-942`) |
| timers | `settimer` (normal) / `softtimer` (`PlayerOps.ts:875-901`); re-setting restarts the clock (`Player.ts:985-996`) | `cleartimer` | normal needs `canAccess()`, soft runs even while busy (`Player.ts:1008-1010`) |
| `p_preventlogout` | `PlayerOps.ts:641-645` | time | only gates logout (`World.ts:845-857`); no packet looks at it |

`p_stopaction` = clear interaction + close modal + clear walk (`PlayerOps.ts:430-432`).
`p_oploc/p_opnpc/p_opobj/p_opplayer` call `stopAction` and then set a SCRIPT interaction
(`PlayerOps.ts:387-415, 1048-1078`), so **every tick a p_oploc loop continues it closes modals and
clears the weak queue** (inferred from read). `p_opheld` is unimplemented and throws
(`PlayerOps.ts:382-384`).

### 2.2 Matrix: packet x state (read; "dropped" = handler returns false, packet consumed)

Columns: **Delayed** (p_delay/p_arrivedelay active). **Modal** (a main or chat interface is
open, including a paused dialogue). **Interaction** (a loc/npc/obj/player target is pending or a
p_op* loop is running). **Weak queue** (an entry is pending). **Protected** (a protected script
is paused, e.g. an NPC dialogue page or a make-X menu, so `protect = true`).

| Packet | Delayed | Modal | Interaction | Weak queue | Protected |
|---|---|---|---|---|---|
| OPHELD1-5 (`network/game/client/handler/OpHeldHandler.ts`) | **dropped** (`:16-19`) | accepted; **closes** it unless the item's component belongs to the open main modal (`:54-56`); script runs at once | **cancelled** (`:55`) | **cleared** (via `closeModal`) | accepted: `closeModal` drops protect (`Player.ts:821-823`), script runs |
| OPHELDU (`OpHeldUHandler.ts`) | **dropped** (`:16-19`) | accepted, closes (`:86`) | **cancelled** (`:86`; also on a stale slot, `:56-57, 73-74`) | cleared | accepted, runs |
| OPHELDT (`OpHeldTHandler.ts`) | **dropped** (`:16-19`) | accepted, closes (`:57`) | **cancelled** | cleared | accepted, runs |
| OPLOC1-5, OPLOCU (`OpLocHandler.ts`, `OpLocUHandler.ts`) | **dropped** + map flag unset (`:14-18` / `:16-20`) | accepted, closes (`:53` / `:68`); target set, runs in step 4 | **replaced** (`:53-54`) | cleared | accepted; interaction waits for `canAccess` |
| OPNPC1-5 (`OpNpcHandler.ts`) | **dropped** (`:16-20`); also dropped if the NPC is delayed (`:27-31`) | accepted, closes (`:47`) | **replaced** (`:47-48`) | cleared | accepted |
| OPOBJ1-5 (`OpObjHandler.ts`) | **dropped** (`:14-18`) | accepted, closes (`:45`) | **replaced** | cleared | accepted |
| OPPLAYER1-5 (`OpPlayerHandler.ts`) | **dropped** (`:15-19`) | accepted, closes (`:37`) | **replaced** | cleared | accepted |
| IF_BUTTON (`IfButtonHandler.ts`) | **accepted (counts as a USER event)**, no delay check. A registered resume button runs the paused script with force (`:29-37`). A button on an overlay tab runs unprotected (`:41-42`): it executes, but any `p_finduid` inside fails (`PlayerOps.ts:88`), so Charge etc. refuse. Any other button: the script is **silently not run** (`Player.ts:2233-2237`) | accepted if the component is visible (`:20-23`); does **not** close the modal | **coexists**: never touches the interaction | **kept** (a resumed script may clear it, `Player.ts:2268-2270`) | resume buttons and overlay-tab buttons run; any other button is **silently not run** but still spends a USER slot |
| INV_BUTTON1-5 (`InvButtonHandler.ts`) | **dropped** (`:15-18`) | accepted (bank, shop, trade, smithing use this) | **coexists** | kept | runs only if the root is an overlay; otherwise silently not run |
| INV_BUTTOND (`InvButtonDHandler.ts`) | **dropped**, client slot visual reverted (`:40-44`) | accepted | coexists | kept | as INV_BUTTON |
| RESUME_PAUSEBUTTON (`ResumePauseButtonHandler.ts`) | no delay check; needs a script paused on `p_pausebutton` (`:8-10`), which cannot coexist with a delay (one active script), so dropped in practice | the normal case: resumes with force (`:20`) | coexists | kept unless the resumed script closes the chat (`Player.ts:2290-2293` -> `closeModal(false)` keeps it) | runs (force) |
| RESUME_P_COUNTDIALOG (`ResumePCountDialogHandler.ts`) | as above for `p_countdialog` (`:12-14`) | resumes with force, `last_int` = any signed 32-bit value (`codec/ResumePCountDialogDecoder.ts`, `g4s`) | coexists | kept | runs |
| MOVE_CLICK (`MoveClickHandler.ts`) | **dropped** + map flag unset (`:12-15`) | accepted, closes (`:30-32`) unless it is the walk half of an op click | **cancelled** unless op click (`:30-32`) | cleared | accepted. Walking is refused while busy **and** a normal/engine queue entry is pending (`Player.ts:729-731`, flag from `World.ts:708-712`) |
| CLOSE_MODAL (`CloseModalHandler.ts`) | **accepted**; the close happens at the start of step 4 (`:13`, `Player.ts:939-942`), protect is kept while delayed (`Player.ts:821`) | closes it, runs `if_close` triggers, kills a paused dialogue (`Player.ts:831-835`) | **kept** | **cleared** | accepted |

Notes on the matrix (read):

- "Accepted" for OPLOC etc. means the target is set; whether the op script runs this tick depends
  on reach (section 3).
- A dropped packet is not retried. The client is not told, except op packets and MOVE_CLICK,
  which unset the minimap flag.
- `processClientsIn` also discards a path or op that was accepted earlier in the same decode loop
  if a later packet in that loop put the player in a delay (`World.ts:702-706`).
- `p_preventlogout` changes nothing in this table; it only defers `loggingOut`
  (`World.ts:845-857`). The logout button is a normal (protected) IF_BUTTON: it does nothing
  while delayed or while a protected script is paused (read; consistent with
  `speedrun/lib/session.ts` retrying a refused logout).

### 2.3 What a p_delay costs in packet ticks (read; measured for bury)

A `p_delay(n)` called on tick T (in a packet handler or in step 4) sets `delayedUntil = T+1+n`.
The flag clears in step 4 of T+1+n, which is after that tick's packets. So packets are dropped
on T+1 .. T+1+n and accepted again on **T+2+n**; the script's tail (xp, item) runs in step 4 of
T+1+n. A `p_delay(0)` held op therefore repeats at most every 2 ticks, whatever the client
sends. If the delay starts in step 4 of T (from an interaction or queue), that tick's packets
were already accepted, so the next accepted packet is also T+2+n.

## 3. Interactions and overlap

### 3.1 Setting and running an op (read)

- An op packet runs `clearPendingAction` and `setInteraction(ENGINE, target, AP*)`
  (`OpLocHandler.ts:52-55`, `OpNpcHandler.ts:46-49`, `OpObjHandler.ts:44-47`,
  `OpPlayerHandler.ts:36-39`). `setInteraction` stores the target, the op, `apRange = 10`
  and the target's type for change detection (`PathingEntity.ts:534-561`).
- In step 4, `processInteraction` (`Player.ts:1304-1371`):
  1. If `canAccess()`: validate (same level, no `changetype`, still valid, `Player.ts:1290-1302`),
     then `tryInteract(false)` **before movement** (`:1314-1327`).
  2. If nothing ran: path toward a moving target, walktrigger, **move**, then
     `tryInteract(stepsTaken === 0)` **after movement** (`:1329-1354`). Nothing ran, no path and no
     step means "I can't reach that!" and the interaction is cleared (`:1350-1353`).
  3. If the script called `p_op*`, the new target becomes current for next tick
     (`:1357-1360`, `nextTarget` from `:1237, 1259`); otherwise a completed op clears it
     (`:1363-1365`).
- `tryInteract` (`Player.ts:1217-1288`) prefers the **op** trigger (`OPLOC = APLOC + 7`,
  `Player.ts:1074`) when in operable distance (adjacent / `reachedLoc`, `Player.ts:1203-1215`),
  but for locs and objs only when `allowOpScenery` is true (`:1227`): never before movement, and
  after movement only if the player **did not step this tick**. NPC and player targets can be
  op'd before movement on the click's own tick. Otherwise the **ap** trigger runs when within
  `apRange` (`:1243-1274`); `p_aprange` inside it means "not yet" (`:1266-1272`).

Consequences (inferred from read):

- A loc/obj op on a target already in reach runs on the packet's own tick. One that needs a
  walk runs on the tick **after** the last step, never on the arrival tick; an NPC op can run on
  the arrival tick.
- `p_arrivedelay` (243 uses in `content/`) adds a further tick after any movement on this or the
  previous tick (`PlayerOps.ts:359-367`); on a loc op reached by walking it always fires, because
  `lastMovement` is the arrival tick + 1.

### 3.2 A second packet in the same or next tick (read)

| Second packet | Effect on a pending interaction |
|---|---|
| another op packet (OPLOC/NPC/OBJ/PLAYER, any U/T form) | **replaces** it; only the last op of a tick runs |
| OPHELD*, OPHELDU, OPHELDT | **cancels** it (except OPHELD on a component of the open main modal) |
| MOVE_CLICK | **cancels** it, except the walk half of an op click |
| IF_BUTTON, INV_BUTTON*, RESUME_*, CLOSE_MODAL | **coexists** |

There is no way to run two loc/npc ops in one tick: the target is a single slot.

### 3.3 Overlap paths: two xp/item effects in one tick

| # | Path | Same tick? | Evidence |
|---|---|---|---|
| O1 | Held ops first, then a click: up to 4 delay-free held scripts run during decode, the click's op runs in step 4 | **yes** | read (`NetworkPlayer.ts:137-138`, `World.ts:402, 425`); the rs/2 knife cycle (drop + click in one tick) relies on it |
| O2 | Click first, then a held op | **no**, the held op cancels the click | read (`OpHeldHandler.ts:55`) |
| O3 | Overlay-tab IF_BUTTON (Charge, `content/skill_magic/scripts/spells/charge.rs2`) beside a running p_oploc/p_opnpc loop | **yes**, the button never clears the interaction and `if_close` only closes modals; up to 5 casts a tick while the loop keeps rolling. Needs `canAccess()` at decode time (no delay, no modal) | read (`IfButtonHandler.ts:39-43`, `charge.rs2:2-3`, `Player.ts:817-871`); **measured**: fly fishing kept catching through 52 casts without a re-click, with same-tick Magic + Fishing xp (section 7) |
| O3b | The same loop + one OPHELD | no: the loop stops (0 catches in 25 ticks) | measured, section 7 |
| O4 | Normal timer + interaction (e.g. wine fermentation + a gathering roll) | **yes**: timers run before the interaction in step 4 (`World.ts:788, 801`), both need only `canAccess()`; an open modal holds the timer (measured, section 7) | read |
| O5 | Soft timer + anything | yes, soft timers run even while busy or delayed (`Player.ts:1008-1010`) | read |
| O6 | Normal/strong queue + interaction | **yes** (`World.ts:785` then `:801`) if the queue script does not delay | read |
| O7 | Weak queue + a click in the same tick | **no**: the click's `clearPendingAction` empties the weak queue during decode, before step 4 | read (`Player.ts:818-820`) |
| O8 | Weak queue + a running p_oploc loop | only for an entry already due: in step 4 the weak queue runs before the interaction (`World.ts:785, 801`), so an entry due on tick T runs, and then the loop's `p_oploc` (`stopAction`, `PlayerOps.ts:396`) empties whatever is left. A weak-queued product loop therefore cannot keep running beside a loc/npc loop | read, inferred |
| O9 | IF_BUTTON/INV_BUTTON (delay-free, e.g. shop buy, tanner) + interaction | yes, if no modal is open; but those interfaces are main modals, which make `canAccess()` false and stall the interaction | read |
| O10 | Delay-free held op x5 in one tick | yes, 5 effects per tick (e.g. bow stringing `content/skill_fletching/scripts/bows.rs2:22-41`, herb identify, gem cutting) | read; measured for herb identify and wine (5 per tick, the rest the next tick), section 7 |
| O11 | Resumed dialogue page + interaction | no: a paused dialogue is a modal; resuming to the end closes the chat (`Player.ts:2290-2293`), after which the interaction can run in step 4 of the same tick | read |

The queue speedup quirk: an entry added to the **end** of the normal queue during the queue pass
can run in the same pass (`Player.ts:949-953`, authentic).

## 4. Known exploits: the guards (do not re-derive the rates)

| Exploit | Guard and why it is open | Label |
|---|---|---|
| **Charge, no cooldown** | `[if_button,magic:charge]` (`content/skill_magic/scripts/spells/charge.rs2:1-27`): the 2005 cooldown is commented out (`:8-12`), there is no `p_delay`, and `settimer(charge, 2)` only restarts the fade timer. The spellbook root is `type=overlay` (`content/skill_magic/interfaces/magic.if:1`), so the handler runs it unprotected (`IfButtonHandler.ts:41-42`); the script then takes protected access with `p_finduid(uid)` (`charge.rs2:3`), which succeeds whenever `canAccess()` (`PlayerOps.ts:78-97`). Requirements: Mage Arena progress `%magearena >= 8` (`charge.rs2:4`, `content/areas/area_mage_arena/configs/mage_arena.constant:8`), Magic 80, 3 fire + 3 blood + 3 air runes, members (`content/skill_magic/configs/magic_spells.dbrow:206-212`, `content/skill_magic/scripts/magic.rs2:12-50`). The cap is the 5-USER-event budget. A cast while delayed or with a modal open is refused by `p_finduid`, not by the handler | read; **measured**: 10 casts fired at once land 5 + 5 (section 7) |
| **5 dialogue pages a tick** | `ResumePauseButtonHandler.ts:7-21`: no component id in the packet (`codec/ResumePauseButtonDecoder.ts`), no delay check, no modal check; only "a script is paused on p_pausebutton and no choice buttons are registered" (`:8-18`), then a forced resume. Each accepted continue is one USER event (5 a tick); a continue with no pause pending is refused and costs a CLIENT slot | read; measured by rs/51 (`speedrun/README.md`, dialogue.ts) |
| **Knife-on-log tick manipulation** | The write is `if (%action_delay < map_clock) %action_delay = map_clock + 2` in `process_fletch_logs` (`content/skill_fletching/scripts/cut_logs.rs2:83-85`), reached only after the `skill_multi3`/`skill_multi2` menu returns (`cut_logs.rs2:38-47`, `content/interface_chat/scripts/chat.rs2:711-754` and the multi3 twin). The menu's buttons are registered resume buttons, so a blind IF_BUTTON in the same tick is accepted (`IfButtonHandler.ts:29-37`). The fletch itself is a weak queue (`cut_logs.rs2:86`) that the same-tick re-click empties (`Player.ts:818-820`). What shortens the gather cycle is that `%action_delay` is a single shared clock and the gathering labels only test equality or expiry (`content/skill_mining/scripts/mining.rs2:76-86, 118-124`, `content/skill_woodcutting/scripts/woodcut.rs2:55-62, 97-101`). One menu completion per tick: closing a multi menu stamps `%weakqueue_map_clock = map_clock` (`chat.rs2:1101-1119`), and a menu answered on that same tick does `if_close; p_delay(0)` (`chat.rs2:734-738`), which then drops the cycle's later packets. The host gate is cairn://p/rs/62 | read (mechanism and rates: rs/2 `tick-manipulation.md`) |
| **Bury: hard 2 ticks** | `content/skill_prayer/scripts/bury_bone.rs2:3-16`: `p_stopaction` (clears the interaction, closes modals, clears the walk), `p_delay(0)`, then delete + xp. `p_delay(0)` on T means delayed until T+1 (`PlayerOps.ts:376-380`), cleared in step 4 of T+1 after the packets (`World.ts:776`), so an OPHELD on T+1 is dropped (`OpHeldHandler.ts:16-19`) and the next bury is accepted on T+2 | read; **measured**: 5 clicks at once bury 1; a click every tick buries every 2 ticks (section 7) |
| **Wine fermentation, no Cooking check** | Making: `[opheldu,grapes]` -> `make_wine` checks Cooking 35 only at make time, has no delay, and calls `settimer(fermenting_wine, 20)` (`content/skill_cooking/scripts/cooking_inv/scripts/wine/wine.rs2:7-20`). Every new wine restarts the 20-tick clock (`Player.ts:985-996`). The timer (`wine.rs2:22-70`) has no stat check: it converts every unfermented jug in the **bank and the inventory**, rolling `stat_random(cooking, 48, 352)` each and granting 110 xp per success; bank jugs go in 15 batches whose xp is multiplied by the batch size (`:26-41`). It is a normal timer, so it fires on the first tick at or after the 20th on which `canAccess()` holds (`Player.ts:1010`). Every login arms it unconditionally (`content/login_logout/login.rs2:70`, `wine.rs2:72-73`) | read; **measured**: 5 wines a tick, fermentation 21 ticks after the last wine, held by an open dialog (section 7); the missing level check is read only |

## 5. Delay-free and blind-drivable flows

### 5.1 The static census (`speedrun/lab/census-delayfree.ts`)

`bun speedrun/lab/census-delayfree.ts [--all]` reads every `content/**/*.rs2` (except
`_test/`), takes every `opheld1-5`, `opheldu`, `opheldt`, `if_button` and `inv_button1-5`
trigger, follows `@label`, `jump()` and `~proc` calls transitively, and records whether any
reachable block has an item or xp effect (`inv_add`, `inv_setslot`, `inv_moveitem*`,
`stat_advance`, ...) and whether it has a `p_delay`/`p_arrivedelay`, a queue, a make-X/chat
menu, or only a message box. It ignores branches, so "FREE" is conservative (no reachable
delay at all); a trigger with a delay only on an error branch is reported as gated.

Result on this base: 944 effect triggers; **273 FREE** and 93 FREE+box (a message box is
reachable, which in every case read is the level-too-low refusal); 365 reach a delay, 46 reach
a menu but no delay.

Delay-free item or xp producers outside quests (each one held op = one effect, so 5 a tick;
read, census):

| Family | Triggers (`content/...`) | Effect |
|---|---|---|
| Fletching: stringing bows, arrows, headless/ogre arrows, bolts, darts | `skill_fletching/scripts/bows.rs2:2,8`, `arrows.rs2:2,9,15`, `ogre_arrows.rs2`, `bolts.rs2`, `darts.rs2:2` | item + xp |
| Crafting: gem cutting, amulet stringing, studded leather, snelms, battlestaves, cape dyeing | `skill_crafting/scripts/gem/uncut_gem.rs2:1`, `jewellery/stringing.rs2`, `studded/studded.rs2`, `snelm/snelm.rs2`, `battlestaves/battlestaves.rs2`, `dye_cape/dye_cape.rs2` | item + xp |
| Herblore: identify herbs (OPHELD1), potion finishing (OPHELDU vial + secondary), grinding, decanting | `skill_herblore/scripts/identifying/identify.rs2`, `brewing/brew_potion.rs2:27-95` (via `~attempt_brew_potion`, `:98+`), `grinding/grind_ingredient.rs2`, `decanting/decant_potion.rs2` | item + xp (identify, finish); item (grind, decant) |
| Cooking (inventory): wine, pies, pizzas, stews, cakes, kebabs, dough, gnome cooking, oomlie | `skill_cooking/scripts/cooking_inv/...`, `skill_cooking/scripts/gnome_cooking/...` | item, some xp (pizza toppings, chocolate cake, gnome finishing) |
| Water sources and the like | `general_use/scripts/water_sources.rs2:34-48` (fill on item-on-item) | item |
| Magic | `[if_button,magic:charge]` | xp |
| Equipment | `[inv_button1,wornitems:wear]` (`player/scripts/equip.rs2:3`) | item move |

Not delay-free (census "delay"/"menu", read): unfinished potions (`brew_potion.rs2:1,14`, a
multi menu and a delay), cutting logs and tinderbox (menu / delay + queue), glassblowing,
needle-on-leather, pottery, smelting, smithing (`skill_smithing/scripts/smithing/smithing.rs2`,
INV_BUTTON + delay), alchemy, enchanting, superheat and teleports (OPHELDT/IF_BUTTON + delay).

### 5.2 Interfaces that produce items (read)

| Interface | Packets | Delay | Notes |
|---|---|---|---|
| Make-X menus `skill_multi2..5` (`content/interface_chat/scripts/chat.rs2:711-1099`) | IF_BUTTON make1/5/10/X (registered resume buttons) | none in the menu; the product loop is usually a weak queue | blind-answerable in the same tick (resume buttons, `IfButtonHandler.ts:29-37`); X = `p_countdialog`, then RESUME_P_COUNTDIALOG with any `g4s` count; **one completion per tick**, a second same-tick menu pays `p_delay(0)` (`chat.rs2:734-738, 1101-1119`) |
| Bank (`content/interface_bank/scripts/bank.rs2:1-5`, `bank_deposit.rs2:1-5`) | INV_BUTTON1-5 = 1/5/10/All/X | none (X opens a count dialog) | slot + object id are validated (`InvButtonHandler.ts:41-47`); a stale slot is refused, never misapplied |
| Shops (`content/shop/scripts/shop.rs2:163-170`) | INV_BUTTON2-4 buy/sell 1/5/10 | none | FREE in the census |
| Trade (`content/interface_trade/scripts/trade.rs2:75, 257, 295-327`) | INV_BUTTON offer, IF_BUTTON accept | none | both accepts FREE; offer-X uses a count dialog |
| Tanner (`content/areas/area_alkharid/scripts/tanner.rs2:67-131`) | IF_BUTTON per hide x 1/5/10/X | none | FREE |
| Ticket traders (agility arena, ranging guild, castle wars) | IF_BUTTON | none | agility arena tickets also grant Agility xp (`minigames/game_agilityarena/scripts/agilityarena_tickettrader.rs2:36-49`) |
| `xplamp` (`content/general/scripts/xplamp/xplamp.rs2:25`) | IF_BUTTON confirm | none | xp |

### 5.3 What the server validates on a blind button (read)

- **RESUME_PAUSEBUTTON**: nothing about the page. The packet has no payload
  (`codec/ResumePauseButtonDecoder.ts`); the server resumes whatever script is paused on
  `p_pausebutton`, provided no choice buttons are registered (`ResumePauseButtonHandler.ts:8-18`).
  Any run of pure continue pages can be sent blind, 5 a tick; extras are refused for free
  (section 1.2).
- **IF_BUTTON** on a choice or make-X page: the component must be one of the registered resume
  buttons (`IfButtonHandler.ts:29`) and visible, i.e. its root is the open main/chat/side modal, a
  tab interface or the tutorial overlay (`Player.ts:2185-2187`). Component ids are static per
  interface, so a choice whose page is known in advance can be answered blind; the server does
  not bind the click to a page beyond that.
- **IF_BUTTON** that is not a resume button: visible component with a button type
  (`IfButtonHandler.ts:16-23`), then the `[if_button,...]` script. The open modal is not
  otherwise checked.
- **INV_BUTTON**: visible component with that iop, a listened inventory, and the object id at
  the slot (`InvButtonHandler.ts:20-47`).
- **RESUME_P_COUNTDIALOG**: a script paused on `p_countdialog`; the value is not range-checked by
  the engine (`ResumePCountDialogHandler.ts:12-17`); the content decides.

Buttons accepted while a different interface (or none) is open: every **tab** interface stays
"visible" to the server while a main or side modal covers it, because `isComponentVisible`
checks `tabs[]`, which opening a modal does not change (`Player.ts:2056-2166, 2185-2187`).
So spellbook, prayer, stats, equipment, logout and the **inventory tab (3214)** are accepted with
the bank or a shop open. The client hides them; the server does not (section 6).

## 6. More permissive than the client implies (read unless marked)

1. **Inventory ops while banking.** An OPHELD on the inventory tab (component 3214) while the bank
   or a shop is open passes the visibility check (tabs are unchanged, `Player.ts:2185-2187`), then
   `clearPendingAction` closes the bank and the op runs (`OpHeldHandler.ts:54-56`). The SDK says
   the server drops it (`sdk/index.ts:1183-1186`, for `sendUseItemOnItem`, which refuses client-side
   with the bank or a shop open); the server accepts it. Measured with OPHELD (`sendUseItem`), 3 of
   3: the bank closed and the op ran. OPHELDU goes through the same visibility check
   (`OpHeldUHandler.ts:26-42`) and the same `clearPendingAction` (`:86`), so it should behave the
   same (inferred). A bot can therefore skip the separate CLOSE_MODAL before an inventory op.
2. **Refused USER events are budget-free** (`NetworkPlayer.ts:141-147`): speculative packets cost
   CLIENT slots (20 a tick), not USER slots.
3. **IF_BUTTON has no delay check** (`IfButtonHandler.ts`); overlay-tab buttons run unprotected
   during a delay or a paused protected script. Content that takes `p_finduid` still refuses.
4. **RESUME_PAUSEBUTTON carries no component**; **RESUME_P_COUNTDIALOG** takes any signed int.
5. **OPPLAYER** accepts any op 1-5 on a visible player without checking the op is set
   (`OpPlayerHandler.ts:34`, "todo: validate set_player_op").
6. **OPLOC/OPOBJ range** is only "within 52 tiles of the build-area origin and the loc exists"
   (`OpLocHandler.ts:20-35`); reach is decided later by pathing ("I can't reach that!"). No
   gain, but no early refusal either.
7. **OPHELD on a main-modal component** does not clear the interaction (`OpHeldHandler.ts:54`):
   only inventories drawn inside the open main modal (puzzles, some minigame grids).
8. **CLOSE_MODAL during a delay** is accepted: it closes interfaces and empties the weak queue
   while protect stays set (`Player.ts:821`).
9. **Members gate** on OPHELDU/OPLOCU is the world flag only (`OpHeldUHandler.ts:88-91`); the demo
   world is members.

Not permissive (read): OPHELD/OPHELDU/OPHELDT/INV_BUTTON validate slot and object id
(`OpHeldHandler.ts:37-43`, `OpHeldUHandler.ts:51-76`, `InvButtonHandler.ts:41-47`); a held op on an
item not in the named slot is refused. IF_BUTTON on a closed interface is refused (not visible).

## 7. Lab

**Setup.** `speedrun/lab/probe-engine.ts` (one file, `--probe=bury,held,charge,wine,bankheld`,
`--n=3`), run through `speedrun/lab/lab.sh` on port block 9340, which `lab.sh` now takes from the
environment (defaults unchanged):

```
WEB_PORT=9340 WEB_MANAGEMENT_PORT=9341 HISCORES_WEB_PORT=9342 NODE_PORT=44040 AGENT_PORT=8340 \
  NODE_TICKRATE=300 speedrun/lab/lab.sh srlab67 'speedrun/lab/probe-engine.ts:--n=3'
```

Host **bgsrv-mac** (macOS arm64, load average 2-5 during the runs), stock headless lite client,
main @ 9c1397eb9, 300 ms ticks, 3 trials per row; all 3 identical unless a range is shown.
"Tick k" counts published client ticks from the tick on which the burst was fired. Every
burst was fired from a fresh state tick; the lite client sends FIFO about 20 ms apart.

| Probe | Result | Claim it tests |
|---|---|---|
| 5 bury clicks (5 different bones) fired at once | **1** buried (3 of 3) | OPHELD during a `p_delay` is **dropped, not queued** (`OpHeldHandler.ts:16-19`) |
| one bury click on every tick for 8 ticks | 4 buried, Prayer xp on ticks 2, 4, 6, 8: **every 2 ticks** (3 of 3) | `p_delay(0)` held op repeats every 2 ticks (section 2.3, `bury_bone.rs2:8-10`) |
| 10 herb identifies (OPHELD1, delay-free) fired at once | all **10** identified: **5** on tick 1, **5** on tick 2 (3 of 3) | 5 accepted USER events per tick; the excess is **buffered** to the next tick, not dropped (`NetworkPlayer.ts:69`) |
| bury + 4 identifies in one burst | 1 buried, **0** identified (3 of 3) | the delay blocks a different item through the same packet type |
| 10 Charge casts (IF_BUTTON 1193) fired at once (Magic 99, `%magearena` 8, runes) | all **10** cast: **5 + 5** over two ticks; 4,500 Magic xp each (1,800 tenths x `NODE_XPRATE` 25) | Charge has no cooldown and runs at the 5-event cap (`charge.rs2`) |
| fly fishing (Barbarian Village, Fishing 99) clicked once, then 4 Charges every 3 ticks for 43 ticks, never re-clicking the spot | fishing kept going: **7** catches; 52 of 52 casts landed; Magic and Fishing xp rose on the **same tick** 3, 2 and 2 times | overlap O3: an overlay-tab IF_BUTTON does not cancel the interaction, and both grant xp in one tick |
| control: one herb identify (OPHELD) while fishing | **0** catches in the next 25 ticks (3 of 3) | an OPHELD cancels the interaction (`OpHeldHandler.ts:55`) |
| 5 wines (OPHELDU grapes on jug) fired at once | **5** made on tick 1 | wine making is delay-free |
| 5 wines, 10 ticks later 5 more, then `::setstat cooking 1` | all 10 fermented **21** ticks after the second burst (32 after the first); 4-6 wines and 4-6 bad wines per trial | each new wine **restarts** the 20-tick timer (`Player.ts:985-996`); the timer fired after the level was lowered |
| 3 wines, then a level-up chat (`::advancestat woodcutting 2`) held open until tick 30 | fermented on tick **32-33**, 2-3 ticks after the dialog was dismissed, not at tick ~21 | a normal timer needs `canAccess()`: any open modal holds it (`Player.ts:1010`) |
| bank open (Varrock west), then OPHELD bury on inventory slot (component 3214) | **accepted**: the bank closed and the bone was buried, Prayer xp granted (3 of 3) | inventory ops while banking (section 6, item 1) |

What the wine rows do not show: the Cooking level and xp read from the state at the fermentation
tick were not consistent with either "the level was 1" or "the level was 35" (the stats seem to
publish a tick after the inventory change), so **"no Cooking check at fermentation" stays
read** (`wine.rs2:22-70` has no `stat` test). The timing rows are measured.

**Lab gotchas found on the way** (measured):

- A bot made by `bots/create-bot.ts` is still in the tutorial: its side tabs (inventory, magic,
  prayer, ...) are not set, so the server refuses **every** held op and tab button as
  "component not visible" (`Player.ts:2185-2187`), silently, while NPC ops still work. The first
  run of these probes showed exactly that (0 of every held op). Tabs are set at login off
  Tutorial Island (`content/login_logout/login.rs2:84-89, 95-118`), so `probe-engine.ts` first does
  `::setvar tutorial 1000`, a teleport and a relog (`--setup=0` skips it).
- The lab and the demo both run `NODE_XPRATE=25` (`util/WorldConfig.ts:102`, `fly.toml:27`), so a
  single fermented jug at Cooking 1 is worth many levels, and the level-up dialogs it queues then
  hold every later normal timer until they are answered (the row above).

Not probed (read only): refused USER events are budget-free (the lite client's 20 ms pacing
smears any burst across tick boundaries, so a clean test needs a raw socket); CLOSE_MODAL and
IF_BUTTON during a delay; OPHELD on a main-modal component.
