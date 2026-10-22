# Rival activity on the demo, from public pages

How to tell who is active on the demo, and how much, without logging in. Three scripts in
`docs/speedrun/scripts/` do it. All of them send polite GETs to public pages only.

| Script | What it reads | What it writes |
|---|---|---|
| `rival-positions-sample.ts --minutes M --interval 60 --out POS.jsonl.gz` | `/playerpositions` once per interval | one gzip member per sample: time, online count, every `[name, x, z, level]` |
| `rival-census.ts --out DIR [--rps 2.5]` | `/playerpositions` once, then every online name's hiscore page, then two pages of every board | `DIR/census-<time>.json` (about 8 minutes for 1,200 names at 2.5 requests per second) |
| `rival-active.ts active POS.jsonl.gz --minutes 60 [--census OLD --census NEW]` | the files above; makes no requests | "accounts active in the last hour": names whose tile changed, names first seen, and with two censuses the names whose hiscore rows changed |
| `rival-active.ts census CENSUS.json` | one census | batch patterns among online names (numbered stems, shared prefixes, known families) and each name's playtime at its last logout |

The hourly sweep keeps one sampler running and runs `rival-active.ts active` against it. Build-slot
scratch does not outlive a batch, so a sampler that must run for hours is started detached, writing
outside the slot (for example `/tmp/...` on the executor). Otherwise it runs as bounded chunks that
each commit their file.

## What each count measures

- **Position change is the activity measure.** A name that changes tile between two 60 s samples is
  logged in and doing something that moves it. A name that is online but never moves (a banker, a
  parked mule, a stall thief standing on one tile) does not count as active under this measure.
- **A hiscore stamp is playtime, not wall-clock time.** Each Time cell gives the account's playtime
  in ticks at the moment the level was reached; see `hiscore-timestamps.md` for the three title forms
  the demo has served. No public page carries a wall-clock time.
- **Hiscore rows change only at logout.** Two censuses taken 10.7 minutes apart on 2026-10-22
  (20:15Z and 20:25Z) differed in 11 skill rows on 10 accounts, with 2 Overall playtime stamps
  moved, while 1,097 names changed tile in the same hour. A count of new stamps between snapshots
  is therefore a count of logouts. It undercounts continuously online bots without limit, even
  with wall-clock snapshots.
- **Playtime is not account age.** It is a lower bound on how long an account has played. A batch
  of names that share a pattern and all have low playtime started recently. For a continuously
  online batch, wall-clock start is roughly now minus playtime, but only if it never logged out.

## 2026-10-22: the gate failure window

The run-day gate failed on both Ashburn machines from about 16:00Z. The question was whether rival
activity grew around then. Nobody kept a name-level snapshot that morning, so the only data is from
20:11Z on (`data/rival-2026-10-22/`).

- Online count rose from 1,045 at 20:11Z to 1,344 at 20:34Z. On 2026-10-21 it was about 1,640 at
  09:03Z, so the population was lower than the day before, not higher.
- The largest young uniform batch was 42 accounts named `z` plus a word (zsukiyaki, zkunai,
  zluffyx, zninja...). Each had 3.9 to 7.9 hours of playtime, Thieving 99 and combat around 84.
  41 of the 42 moved within the hour, and 37 stood in one 64-tile map square (x 2624-2687,
  z 3264-3327). If their sessions ran continuously, they started roughly between 12:30Z and
  16:30Z. That brackets the gate onset, but public pages cannot date it more precisely.
- Other young batches: bolthelp1-24 (0.1 to 8.3 hours, mostly Thieving 99, 21 of 24 moving),
  bankroll003-010 (under 1 hour, parked and not moving), and an adjective-noun combat set of
  about 14 accounts (4 to 6 hours each).
- The jackalope helpers are an old fleet: about 20 of the same names are in the 2026-10-21 09:03Z
  positions. Their young members are attempt accounts. No stun* account was online, and the
  asuka*, nick* and jackalope* counts did not change between censuses.
- Page changes, possible deploy markers: the hiscore Time title read 'N ticks' until about 19:34Z,
  then 'S seconds of game time', and since the about 19:56Z restart 'N ticks normalized to 400 ms
  per tick' (the demo now runs 400 ms ticks).

The lesson for next time: start a positions sampler and a census before a run day, so the next
such question has a baseline.
