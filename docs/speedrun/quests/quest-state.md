# Quest state: what a client can observe, and how steps check it

A quest step needs a precondition (the quest is where the step starts) and a
postcondition (the step moved it), and the resume walk (runner/resume.ts) needs to
know where a restarted run stands. All of that has to come from the client,
because the scored run plays on the demo server, where `::getvar` is staff-only and
the content cannot be changed.

## What reaches the client

**Quest progress varps do not.** Every quest's progress varp (`%doricquest`,
`%elenaquest`, `%mm_main`, ...) is `scope=perm` without `transmit=yes`, and the
engine sends VARP_SMALL / VARP_LARGE only for transmitted varps (the `transmit`
checks in server/engine's Player). No client sees them, on any server running this
content. Making them transmitted would only change our local engine, not the demo.

Three signals do reach it, and the bot layer publishes them in `BotWorldState`
(server/webclient/src/bot/quest-state.ts, collected by StateCollector, so the
browser overlay and the lite client publish the same fields):

| Field | Source | Cost | Answers |
|---|---|---|---|
| `varps`, `questPoints` | The transmitted varps on a whitelist: `qp` (101), `option_run` (173), `bankcert` (115) | free, every tick | quest points (the Champions' Guild door), run toggle, bank note mode |
| `quests` | The quest tab's colours. The server sends IF_SETCOLOUR red / yellow / green for every quest at login (`~update_questlist`), when a quest starts (`~send_quest_progress`) and when it completes (`~send_quest_complete`), all in general/scripts/quests.rs2 | free, every tick | not started / started / complete for every quest on the list |
| `questJournal` | The journal scroll. Clicking a quest-tab entry runs `~quest_journal`, which sets the title and 50 lines and opens the scroll; the text is a function of the stage | one click and one close, about two ticks | the exact stage of a started quest |

`quests` lists only started and completed quests; a quest missing from it is not
started (the cache colours every entry red, so a client that has not had the login
update yet also reads as not started). `questJournal` stays published after the
scroll closes, with the tick it was last open, so a reader that closes it at once
still has the text.

The whitelist is deliberately short: the reactive path publishes every tick, and
most transmitted varps (music, prayers, interface toggles) are already published in
another form or are of no use to a step. Monkey Madness's temporary varps
(`mm_cutscene_part`, `varp_369`, ...; primitives.md section 8) are not transmitted
either, so its logout-unsafe stretches are known from the step, not from state.

Mage Arena is a miniquest: not on the quest list, no journal. Its evidence is its
items (the god cape, the god staff) and messages.

## Journal text to stage

speedrun/data/quest-stages.ts holds, for every route quest, the progress varp,
every stage value with the content line that sets it, the quest points, the
completion test, the quest-list component and a `journal` marker per stage: a
phrase that appears in that stage's journal text, whatever the inventory holds,
and in no other stage's. Stages whose text is identical share a marker, so a match
names exactly the stages the text can mean. A few started stages have no marker
because their whole text reappears at the next stage, or switches on something
other than the quest varp (each quest's `notes` say which); a text matching no
marker is one of those.

Markers compare with colour tags and all whitespace removed: the server wraps the
text into lines at its own breaks, and tags land mid-line.

## The helpers (speedrun/lib/quests.ts)

- `questStatus(state, key)`: the tab's status, or null when unobservable.
- `questStage(view, key)`: every stage the evidence allows. The tab decides not
  started and complete; for a started quest a journal narrows it if it is fresh:
  from a resume probe, or open in state within `JOURNAL_FRESH_TICKS`.
- `requireQuestStage(view, key, stage, { atLeast })`: `true` or the reason, in the
  shape of a step's `preconditions` / `postconditions`. When the evidence cannot
  tell `stage` from a neighbour it fails and says to read the journal.
- `questDone(key)`: for `Step.done`, the tab shows the quest complete.
- `readQuestStage(sdk, key)`: click, read, close. Skips the click when the tab
  alone leaves one stage. The click runs a protected script, which the engine
  skips silently while the player is busy (right after a teleport or a dialogue),
  so it clicks once more if the journal has not opened within three ticks.
- `journalProbe(key)` / `journalProbes(keys)`: the resume walk's probes, named
  `journal:<key>`; `questStage` reads their result from the observation.

A step inside a quest checks its start stage with `requireQuestStage` after a
journal read (or from a `journal:<key>` probe on resume), and its end with the tab
when the step finishes the quest. Example: speedrun/runner/example-quest.ts, which
starts Cook's Assistant.

## Verified

Demo, 2026-10-21, throwaway `cairn_q114` on the lite client: before the step the
tab and the journal ("The Cook's Quest", marker `not_started`) both read stage 0;
the step, gated by `requireQuestStage(s, 'cook', 'not_started')` and
`requireQuestStage(s, 'cook', 'started')`, took 75 ticks; after it the tab read
started and the journal matched `started` (1). The first attempt's journal click
right after the tutorial skip was skipped by the server, which is why
`readQuestStage` clicks twice when it has to.
