# film/

Capture tooling for the write-up's "code karaoke": a clip of a bot playing on the local lab, beside a
trace that maps every action the bot sent to the source line that sent it, on the same clock as the
video, plus the engine's world feed for a 3D replay (rs-dash). Lab only: `capture.ts` refuses a bot
whose `bot.env` points anywhere but this machine, and nothing here touches the run's code paths.

## Filming a clip

Prepare the checkout once (as CI does; on a fresh executor slot, in the same batch):

```sh
bun install --frozen-lockfile
(cd server/webclient && bun install --frozen-lockfile && bun run build)   # the page the client runs
(cd server/engine && bun install --frozen-lockfile && BUILD_VERIFY=false bun run build)
```

Then one command starts a lab, films, and stops the lab:

```sh
film/film.sh filmfm1 --clip=film/clips/firemaking-80.json --out=film/out/fm80
```

`film.sh` runs `speedrun/lab/lab.sh` with `WORLD_FEED=true`, no lite runner, port block 9700
(DevTools on 9705), and `NODE_TICKRATE=400`, the demo's tick length. It refuses a port that is
already in use. Run the whole thing in one `run` batch pinned to one executor (the speedrun-lab
skill). A 48 s clip takes about two minutes end to end on fedora.

### A clip spec

`film/clips/<name>.json`:

| key | |
| --- | --- |
| `script` | The bot script. A file exporting `steps(options)` (a step module: `speedrun/skills/*.ts`, `speedrun/quests/*.ts`) runs once under `film/run-steps.ts` with `runSteps`, the run's own runner. Anything else runs as `bun <script> <bot> <args...>`, the lab's convention, and must attach to the bot's client rather than launch one. |
| `opts` | The step module's options. |
| `args` | A plain script's arguments. |
| `setup` | Staging before filming (below). |
| `seconds` | The longest the script runs (default 60). The clip ends a second after the script exits or is stopped. |
| `fps`, `crf`, `area` | Output frame rate (25), quality (x264 scale, 26), feed area side in tiles (192). |

Flags override the spec: `--script=`, `--setup=<setup.json>`, `--opts=<options.json>`, `--args=a,b`,
`--seconds=`, `--fps=`, `--crf=`, `--area=`, `--codec=`, `--out=`. No argument may contain `:`,
because `lab.sh` splits a script's arguments on it.

### A setup spec

Applied in this order through the lab's staff commands (`film/setup.ts`, on `speedrun/lab/setup.ts`):

```json
{
  "leaveTutorial": true,
  "clearInventory": true,
  "stats": { "firemaking": 80, "hitpoints": 70 },
  "give": { "tinderbox": 1, "magic_logs": 27 },
  "tele": [3019, 3362, 0],
  "cheats": ["~energy"],
  "settleTicks": 3
}
```

Names are debug names (`server/content/**/*.obj`). Set combat stats to 70 anywhere near aggressive
npcs: a level-3 lab bot dies quietly (the speedrun-lab skill).

## What a clip directory holds

| file | |
| --- | --- |
| `clip.mp4` | The game as the browser client renders it, 764 x 502 (the client's 765 x 503 canvas, 1:1, cropped even), constant frame rate, no overlay. `clip.webm` where ffmpeg has no H.264 encoder. |
| `trace.jsonl` | One line per event, sorted by `videoMs` (below). |
| `feed.jsonl` | The world feed, every server frame verbatim: `{"recv":ms,"frame":...}`, and `{"recv":ms,"sent":...}` for this recorder's own subscriptions. |
| `meta.json` | Script, options, setup, git commit, tick length (configured, the feed's hello, observed), start and end (ms, server tick, client tick), xp gained and levels per skill, video and capture statistics, feed areas. |
| `steps.jsonl` | A step module's own tick log (fires, bands, summary). |
| `script.out.log`, `script.err.log` | The script's output. |
| `sync.json`, `sync-sheet.jpg`, `sync-regions.jpg` | The sync check's report, contact sheet and measured regions (`bun film/sync-check.ts <dir>`). |

### The clock

Everything runs on one machine, so every `ms` is wall-clock epoch milliseconds from the same clock:
the hook's send time in the script's process, the observer's receive time, the feed recorder's
receive time, and each video frame's compositor timestamp from Chrome. `videoMs = ms - meta.start.ms`
is the offset into the clip. `tick` is the server tick in force at `ms` (the latest feed tick frame
received by then), so it lines up with `feed.jsonl`'s `k`. `clientTick` is the browser client's own
tick count, as the SDK's state carries it.

### trace.jsonl

| kind | fields beyond `ms`, `videoMs`, `tick`, `clientTick` |
| --- | --- |
| `action` | `bot`, `action` (the SDK action type), `args` (the action as sent), `file`, `line`, `col`, `fn`: the line that issued it; `site`: `script` when that frame is in the filmed script, `caller` when it is only the first frame outside `sdk/`; `stack`: every non-SDK frame, innermost first. |
| `start` | The opening state: tile, plane, every skill's level and xp. Clamped to `videoMs` 0. |
| `pos` | The player's tile, plane and animation, once per client tick. |
| `xp`, `level` | A skill's xp change (`xp`, `delta`, `level`), a level change (`from`, `to`). |
| `chat` | A game message the first time it is published (`type`, `sender`, `text`). |

For a step module, `file:line` is the line in the module that sent the click: in the sample, every
light is `speedrun/skills/firemaking.ts:963` (`sdk.sendUseItemOnItem` in `lightRow`) and every
level-up dismissal `:960`.

## How the action trace works

`film/hook.ts` is preloaded into the script's process (through `BUN_OPTIONS`, so Bun processes the
script starts load it too). It wraps `BotSDK.prototype.sendAction`, the one dispatch point every
`sdk.send*` call and every `BotActions` helper goes through, and appends each action with its stack
to a log. The SDK's source is not changed; a script run any other way loads none of this. Bun keeps
async frames (`at async fn`), so a script line survives the awaits between it and the SDK.

Actions sent from an in-page tick program (`speedrun/lib/programs.ts`: agility, fishing, mining,
runecraft, thieving and woodcutting run their loops in the page) never reach the SDK, so they are not
in the trace. The video and the feed still show them; the trace has only the SDK actions around
them, such as the program's start.

## The sync check

```sh
bun film/sync-check.ts film/samples/firemaking-80
```

It decodes the clip, counts the pixels of a region that change by more than 24 grey levels from one
frame to the next, and for each trace event finds the first frame where the region changes:

- **chat**: a game message against the chatbox. The client draws a message and publishes it in the
  same tick, so this measures the clock sync between the trace and the video.
- **action**: a held-log light (`useItemOnItem`) against the log leaving the inventory: when a sent
  action lands, a server round trip later.
- **feed**: the player's tile in `feed.jsonl` against the same tile in the client's state.

The sample (`film/samples/firemaking-80`, 49 s, 400 ms ticks, Firemaking 80 to 88 over 27 fires):

| measure | found | offset |
| --- | --- | --- |
| chat in the chatbox after its `videoMs` | 36 / 36 | 22 to 68 ms, median 41 ms (0.10 ticks) |
| a light's log leaving the inventory after it was sent | 27 / 27 | 419 to 481 ms, median 436 ms (1.09 ticks) |
| the client's tile change after the feed's | 28 | median 1 ms, max 409 ms (one tick, once) |

So the trace and the video agree to within two output frames (40 ms each); a highlighted line lands
one tick before its effect shows, which is the game's own round trip.

## Capture method

Chrome DevTools `Page.startScreencast` in chrome-headless-shell (the lab's one launcher,
`speedrun/lab/browser.ts`), on the bot page's `?minimal` canvas with a 765 x 503 viewport. Each
JPEG frame carries its compositor timestamp; `film/screencast.ts` re-times them onto a constant rate
(each output frame shows the latest capture by then) and encodes with ffmpeg: libx264 if present,
else libopenh264 (Fedora's ffmpeg), else VP9 WebM. In the sample the screencast delivered 58.6 fps
(frame gaps median 16.6 ms, p95 21.3 ms, max 63.6 ms), so a 25 fps output frame is at most 43 ms
stale and 17 ms at p95.

## The world feed recorder

`film/feed-recorder.ts` stands alone: a ws URL, a centre or a player to follow, and an output path.
It writes the same lines as the document thread's live recorder, so one replay loader reads a lab
clip and the real run alike: roster on, one area re-centred on the followed player's roster position
(more than 48 tiles, at most every 10 s), a 30 s ping, reconnects backing off from 30 s to 5 min and
stopping after 6 disconnects in an hour. It never prints player names.

```sh
bun film/feed-recorder.ts --url=ws://localhost:9700/worldfeed --out=feed.jsonl --centre=3019,3362 [--follow=NAME] [--seconds=N]
```

The CLI refuses a non-loopback host without `--remote`.

## Helper bots

The tool films one bot's client. A lab script that drives helpers (`LAB_HELPERS=...` passes through
`film.sh` to `lab.sh`, which gives each a headless lite runner) works as it is: the helpers show in
the filmed client and the feed, and since the hook rides in `BUN_OPTIONS`, a helper's actions are in
the trace too, tagged by `bot`, whether the script drives it in its own process or a child one. Two
things it does not do yet: render a second client (one screencast per page, one clip per bot on the
same clock, would be the extension), and drive a script that launches its own browser client
(`--client=browser`): that would take the film tool's DevTools port and tab.

## Tests

`bun test film`: stack parsing and site choice, the frame schedule, the clock merge, the state diff,
the feed recorder against a local WebSocket server, setup validation, and the sync measures.
