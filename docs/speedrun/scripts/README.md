# Research scripts

These are reproducible measurements and probes, not scored-run entry points.
Use the bot and arguments documented in each script's header and the local-engine
instructions in [LAB.md](../LAB.md). Never run staff fixtures on the demo account.

## Shared implementation

Quest scripts import generic behavior directly from `../../../speedrun/lib`:

| Module | Responsibility |
|---|---|
| `wait` | Tick waits, predicate waits and throwing waits |
| `world`, `paths` | Published-world queries, inventory/skill counts, config ids, walked tiles and collision-map path lengths |
| `dialogue`, `converse`, `levelup` | Guarded option clicks, conversations, dialogue shape and page-aware level-up recognition |
| `act` | Single action plus effect/retry, action plus dialogue, NPC talks, loc/item/door actions and travel |
| `combat` | One-target fights, scripted boss outcomes, protection-prayer stall recovery and upkeep |
| `idle` | Message-based quiet waits and animation-based settled predicates |

`../../../speedrun/lab/setup` owns staff setup: variable reads/writes, inventory
clearing/giving, stats and teleports. `../../../speedrun/lab/record` owns research
segments, trace rows, statistics and result printing. The scored primitives never
import the lab layer.

The old quest-family `*-lib.ts` and helper `*-lab.ts` files have been removed.
Quest-specific route planners and data modules remain, as do skill-specific
research models outside that consolidation. The Underground Pass route executor
and its flags live in its segments script; Digsite-specific steps live in their
measurement scripts; Fremennik flags live with the trial that uses each flag.
Thin closures that label/record a particular quest action are not alternative
implementations of the action. Plague City and Biohazard share their recording
wrapper, whose action/dialogue behavior is `actConverse`.

Raw packet sends remain where they are the experiment itself, for example the
dialogue-burst, transport and movement probes, exact-tile bridge interactions,
lock picking, cannon reloads and quest-specific obstacle/casting strategies.
Do not replace the measured operation with a different abstraction merely to
make its imports uniform.

## Results and historical measurements

`Recorder` emits `SEG` lines, a Markdown table and
`RESULT <name> {"total": ..., "segments": ...}`. A segment begins before the
action and ends at its latest explicit effect mark, or at the current tick if
unmarked. `rec.dialogue` adds page/choice/level-up counts and marks the final
dialogue close. Use another mark after a later effect. This excludes the
confirmation wait while retaining the effect's observed tick. Route estimates
and actual walked tiles are distinct; teleport jumps are not walked tiles.

The helper consolidation preserves historical numbers in the quest documents,
not byte-for-byte console formats or newly measured timings. Generic output
replaces the old STEP/JSON ledgers; level-ups are counted separately; combat
food/potion counters count sends; failures carry explicit reasons. Retries,
strict failed staff teleports and effect-based endpoints can change future
measurements. The migration's build and unit tests are not a new live quest
measurement. Rerun on the documented lab/client before publishing replacement
numbers.

## Verification

Install the locked root dependencies first (`bun install --frozen-lockfile`);
without them, scripts that reach `puppeteer` or `open` fail to bundle. Build each
TypeScript entry independently with `bun build --target=bun`, writing
output outside the repository, and run `bun test speedrun`. Include newly added
scripts when enumerating the directory. The root TypeScript configuration does
not include this directory: checking script types requires extending its
`include` set, and comparing diagnostics against the same base revision and
dependency environment. A passing bundle is not a typecheck or a live game run.
