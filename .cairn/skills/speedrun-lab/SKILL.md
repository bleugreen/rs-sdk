---
name: speedrun-lab
description: Use when running a bot against the local lab engine to measure tick costs or to work through a quest or training method — starting the lab, staff cheats (::give, ::setstat, ::tele, ::setvar, ::npcadd, ~debugprocs), reading timing from published state, and the silent server behaviours (dropped clicks, cleared attacks, lab-bot deaths) that corrupt a measurement without an error.
---

# Speedrun lab

The lab is a private engine + gateway + lite client on this machine, driven by
`speedrun/lab/lab.sh` (port block 9300). `speedrun/README.md` documents its
flags, bots and the measurements already taken; this skill holds the traps
that cost earlier sessions hours.

## Running the lab

- **Run the whole lab inside one `run` batch.** Background processes started
  in a batch are killed when the batch ends, and a terminal can be placed on a
  different executor than your batches. `lab.sh` starts the engine, gateway and
  clients, runs your scripts, and stops everything in one invocation; build on
  it rather than on a long-lived terminal.
- **Pin every lab batch to one executor.** The first engine boot on a machine
  packs the content (about 13 minutes on bgsrv-ub); later boots take seconds.
- **Keep `BUILD_LIVE_RELOAD=false`** (as `lab.sh` does). The dev reload thread
  (`server/engine/src/cache/DevThread.ts`) `fs.watch()`es every content
  directory; on Linux executors that exhausts file descriptors and Bun panics
  (`us_create_timer: returned null: 24`, EMFILE) right after "World ready".
- Concurrent scripts need distinct log paths; name them per bot.
- **A lab driven over ssh outlives its batch.** If a batch ssh's into another
  host instead of being placed on that executor, a batch that times out kills
  only the local ssh client and the remote job keeps running. Start long remote
  labs in a named tmux server (`tmux -L <name>`) with output tee'd to a file,
  read the file, and kill the session when you are done.

## Staff cheats

The lab engine runs with `LOCAL_STAFF_LEVEL=4`, so `::` commands work.
`speedrun/lab/setup.ts` wraps the common ones.

- **Content debugprocs need a `~` prefix:** `::~clearinv inv`, `::~energy`
  (`Environment.node.debugProcChar`, `server/engine/src/util/WorldConfig.ts`).
  Plain `::clearinv` is silently ignored, and a later `::give` then fails
  without a message once the tutorial items fill the inventory.
- `::give` lands 1-2 ticks after the chat packet; wait for the items to appear
  before equipping or using them.
- `::setstat` can lower xp, so ignore negative xp deltas around it.
- `::setvar` accepts varbit names as well as varp names, which is how to jump
  to a quest sub-stage.
- `::npcadd <npc>` spawns at your tile. It does not help for bosses gated on
  `%npc_aggressive_player`.
- In-game item names can differ from debug names (`raw_shrimp` is "Raw
  shrimps"); match loosely.

## Lab bots die quietly

A fresh level-3 lab bot can be killed by an aggressive NPC near its training
spot (a caster at the Draynor willows, around 3085,3234, kills one in about
40 ticks). It respawns in Lumbridge (3221,3217) with three items, which reads
like the bot "wandering off" or finding "no target", and a bot that eats
regularly hides the damage. Before measuring anywhere with aggressive NPCs,
`::setstat` hitpoints, attack, strength and defence to 70.

## Reading timing from state

- **Time actions from chat, not xp.** In the lite client's published state a
  script's game message ("You pick the...", "You fail to pick...") appears one
  tick before the matching xp update.
- **Round trip depends on the tick rate.** At the demo's rate (400 ms since
  2026-10-22, `lab.sh`'s default `NODE_TICKRATE`; earlier measurements used 300)
  a reply to tick T's state lands in T+1; at 100 ms the round trip is about 2
  ticks. Logic that re-sends "did my click take?" after one tick is only correct
  at the production rate, so measure at 400 ms.
- **Filming a lab run** (video, a per-action source-line trace, the world feed):
  `film/film.sh`, documented in `film/README.md`.
- `state.opFeedback.opRejectedCount` counts server `UNSET_MAP_FLAG` while the
  player stands still. One op click can count twice (the routing move packet
  and the op packet).
- `sdk.getNewChat()` drains a per-instance cursor, so two checks on it in one
  script starve each other. Keep your own watermark (on `observationId` or
  `tick`) over `getChat()` instead.
- Dialogue page text is in `state.dialog.allComponents[].text`;
  `dialog.text` is usually empty, so de-duplicate pages on component text.
- Interface component ids: in `server/content/pack/interface.pack` the number
  before `=` is the id, and line N holds id N-1. Misreading it by one is easy.

## Server behaviours that drop or cancel input silently

- **A click sent during a `p_delay` or a stun is dropped** with no message.
  Wait the delay out before re-sending.
- **A queued run survives a `p_delay`; a move click in the cast's tick kills it.**
  The walk queue keeps stepping while the player is delayed, so one run click plus
  an enchant every 3 ticks covers the same tiles in the same ticks as the run
  alone, and a level-up dialog doesn't stop it. A move click sent in the same tick
  as a cast stops the run completely. Click the run first, cast on later ticks,
  and re-click only on a free tick. Scripts that call `p_stopaction` (bury) do
  stop the walk (`docs/speedrun/research/travel-and-overhead.md`).
- Quest scenes often `if_close; p_delay(n)` mid-dialogue; a dialogue runner
  must not treat a short close as the end of the conversation.
- `bot.walkTo` aimed just in front of a door may open it and walk through.
- **Any inventory click (eat, drink, equip) clears the attack interaction**
  (`OpHeldHandler.ts` -> `clearPendingAction`). Re-send the attack; one sent in
  the same tick as the item click doesn't land through the SDK, so re-send on
  each of the next 2 ticks.
- A level-up page stops a ranged or magic attack until it is dismissed;
  re-attack when xp stops rising.
- **Eating adds 3 to `%action_delay` relative to its current value**
  (`consume.rs2`, `player_consume_item`). It is free when eaten 3+ ticks after
  the skill clock last fired and costs 3 ticks when a skill clock or stun is
  still pending. Potions add no delay.

## Pathing gaps

The SDK pathfinder does not model Ape Atoll's bamboo ladders and bridges or
the Grand Tree's scripted doors. Walk legs that cross them step by step in the
lab before trusting a route.

## Port blocks and quest varps

- **"World ready" prints before the engine binds its web port.** A block another lab already
  holds used to pass `lab.sh`'s readiness check, and the scripts then drove *that* lab's engine
  with no error. `lab.sh` now fails on a bind error. Before choosing a block, check it with
  `lsof -nP -iTCP:<port> -sTCP:LISTEN` for all five ports.
- **Bound long labs with `LAB_TIMEOUT=<seconds>`** (macOS has no `timeout(1)`) and run them in a
  terminal, waiting on an output sentinel. A signal exits `lab.sh` through its cleanup.
- **`::setvar <quest> <complete>` does not recolour the quest tab**, which is what `quests` and
  `questDone` read. The colours come from `~update_questlist`, which login runs, so relog once after
  the setvar: own the client with `LAB_RUNNERS=0`, `openSession(bot, {launch: true})`, then
  `relog(session)`.
