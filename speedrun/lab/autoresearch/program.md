# autoresearch for the run: program.md

This is the brief for an agent that improves the speedrun's step modules on its own, in
the shape of karpathy/autoresearch: one file edited per experiment, one fixed-budget
evaluation, keep or discard, a results log. The human edits this file; the agent edits
the step module.

## Setup

1. Agree a run tag with the human (for example `oct24-s12`) and work on a fresh branch
   `autoresearch/<tag>` cut from main. Nothing on it is ever merged as it stands (see
   "The hard rule").
2. Read for context: `docs/speedrun/RUN-ORDER.md` (the step's row: its expected, best
   and risks), the step module you will edit and its tests, `speedrun/README.md`'s
   "The step benchmark", and `speedrun/lab/bench-step.ts`'s header.
3. Get a lab: `speedrun/lab/lab.sh` with `NODE_TICKRATE=150` on a block nobody else
   holds, or a standing lab engine the human names (`LAB_EXTERNAL=1` and its ports).
   Never the demo, never a fleet or scored account: the bench refuses both, and you
   must not work around it.
4. Run the baseline: the bench, unchanged code, at the agreed K. That row is the score
   to beat. `results.tsv` starts with its header row.

## What you may edit

Exactly one file per experiment: the step module under `speedrun/quests/` or
`speedrun/skills/` that the target runs (S12 is `speedrun/quests/fight-arena.ts`; the
S07 oak band is `speedrun/skills/woodcutting.ts`). Its own test file may change with it.

Never: `speedrun/lib/`, `speedrun/runner/`, `speedrun/run.ts`, the ledger
(`docs/speedrun/STEP-MANIFEST.md`), `docs/speedrun/RUN-ORDER.md`, the bench and the
lab tools under `speedrun/lab/`, the webclient bundle, `sdk/`, the engine, or another
step's module. A change that needs any of those is not an experiment: write it up for
the human.

## The evaluation

```
LOCAL_STAFF_LEVEL=4 NODE_TICKRATE=150 LAB_RUNNERS=0 speedrun/lab/lab.sh benchlab \
  'speedrun/lab/bench-step.ts:<target>:--k=<K>:--tick-ms=150'
```

- The budget is fixed per target and does not change during a session: K runs (5
  unless the human says otherwise), each bounded by `--budget-min` (the bench's default
  is 3x the expected ticks plus 8 minutes of staging). S12 at 150 ms is about two
  minutes of wall time a run.
- The metric is the `SCORE` line, lower is better. With every run passing it is the
  median ticks; a failed run counts as its ticks + RUN-ORDER's manual restart + the
  step's expected again, so a faster change that sometimes fails loses.
- Know the noise floor before believing a gain. At 150 ms on the lab, S12's three
  runs spread 537 to 606 ticks, all in the fights' rolls (segments G and I); the oak
  band spread 726 to 806, in tree depletion. A gain smaller than the spread of the
  baseline's own runs is noise: re-run both at a larger K before keeping it.
- The tick rate is part of the evaluation. 150 ms is a lab speed, not the demo's 400:
  a change that relies on reacting within a tick (a re-send after one tick, an in-page
  timing) must also be checked at 400 ms before it is kept, and the note says so.

## The experiment loop

Loop until the human stops you:

1. Read `results.tsv` and the current module. Pick one idea, small and specific: a
   walk that takes a shorter route, a page answered a tick sooner, an eat rule that
   does not waste an action. One idea per experiment, so a result explains itself.
2. Edit the one file. Run `npx tsc --noEmit` and the module's own tests
   (`bun test speedrun/quests/<module>.test.ts` or `speedrun/skills/<module>.test.ts`)
   and `bun test speedrun/tools/slot-ledger.test.ts`. A red check is a discard, not a
   run.
3. Commit it on the branch with a one-line description of the idea.
4. Run the evaluation. Read the `BENCH` and `SCORE` lines, and each run's refusal if any.
5. Keep or discard:
   - **Keep** when the score is lower than the best kept score by more than the noise
     floor, every run passed, and no new cheat appears in the cheats column. The branch
     advances.
   - **Discard** otherwise (`git reset --hard HEAD~1`). A run that crashed, refused or
     never reached the step is a discard; fix an obvious slip and retry once at most.
   - A simpler module at an equal score is a keep: removing code is worth it.
6. The bench has already appended the K rows to `results.tsv`. Add nothing to git
   from it: the file is untracked by design.

Do not stop to ask whether to continue. If you run out of ideas, re-read the step's
RUN-ORDER row, its risks column and the module's measured history, and try the
opposite of what failed.

## The hard rule

Nothing from this loop enters a run commit directly. A kept change reaches the run
only the usual way: the human (or main) picks it, it is lab-passed through the
chain (`speedrun/lab/dress-rehearsal.ts` across the step's seams, not only the bench),
snapshotted to main with its tests, and named in a run commit under main's rules.
The bench stages a boundary by staff commands, so a kept score says the module is
faster from that staged state, not that the run is: say which boundary values were
approximate or unstaged (the bench prints them) when you hand a change over.
