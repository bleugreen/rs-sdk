## Samples

| PDT | source | vantage | online | direct 1:2:3 | relay 1:2 | p90 / max ms | late >450 /min | catch-ups /min | (a) | (b) | (c) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 10-21 02:43 | pair | ashburn | 1651 | 60:0:0 | 32:28 | 384 / 879 | 7.3 | 0.0 | pass | pass | pass |
| 10-21 02:51 | pair | ashburn | 1564 | 15:0:0 | 7:8 | 384 / 711 | 6.5 | 0.0 | pass | pass | pass |
| 10-21 03:05 | pair | east | 1649 | 56:4:0 | 36:24 | 387 / 677 | 8.8 | 0.8 | FAIL | pass | pass |
| 10-21 03:17 | pair | ashburn | 1658 | 60:0:0 | 40:20 | 376 / 612 | 3.2 | 0.0 | pass | pass | pass |
| 10-21 04:00 | window-react | home | 1673 |  |  | 438 / 605 | 18.2 | 11.7 |  | FAIL | FAIL |
| 10-21 04:00 | window (rebuilt) | home | 1673 |  |  | 395 / 794 | 10.3 | 5.5 |  | pass | FAIL |
| 10-21 04:04 | pair | ashburn | 1673 | 60:0:0 | 60:0 | 373 / 605 | 6.6 | 0.0 | pass | pass | pass |
| 10-21 04:13 | pair | ashburn | 1645 | 40:16:4 | 40:20 | 485 / 790 | 23.5 | 22.8 | FAIL | FAIL | FAIL |
| 10-21 04:18 | pair | ashburn | 1686 | 10:0:0 |  | 408 / 478 | 12.8 | 0.0 | pass | FAIL | pass |
| 10-21 04:24 | pair | ashburn | 1674 | 49:11:0 |  | 444 / 1061 | 18.4 | 11.5 | FAIL | FAIL | FAIL |
| 10-21 04:47 | pair | ashburn | 1686 | 60:0:0 |  | 383 / 872 | 5.4 | 0.8 | pass | pass | pass |
| 10-21 04:56 | pair | ashburn | 1216 | 59:0:0 |  | 365 / 631 | 4.8 | 0.0 | pass | pass | pass |
| 10-21 05:09 | pair | ashburn | 1443 | 60:0:0 |  | 372 / 496 | 3.3 | 1.6 | pass | pass | FAIL |
| 10-21 05:36 | pair | ashburn | 1719 | 36:22:1 |  | 506 / 1458 | 37.1 | 23.3 | FAIL | FAIL | FAIL |
| 10-21 06:00 | pair | ashburn | 1595 | 60:0:0 | 59:1 | 376 / 636 | 4.9 | 0.0 | pass | pass | pass |
| 10-21 06:00 | pair-window (rebuilt) | ashburn | 1595 |  |  | 378 / 641 | 6.0 | 1.2 |  | pass | FAIL |
| 10-21 06:10 | pair | ashburn | 1685 | 34:23:3 | 60:0 | 524 / 812 | 39.9 | 26.1 | FAIL | FAIL | FAIL |
| 10-21 06:10 | pair-window (rebuilt) | ashburn | 1685 |  |  | 505 / 812 | 36.8 | 23.3 |  | FAIL | FAIL |
| 10-21 06:37 | pair | ashburn | 1654 | 60:0:0 | 60:0 | 394 / 555 | 6.6 | 0.0 | pass | pass | pass |
| 10-21 06:37 | pair-window (rebuilt) | ashburn | 1654 |  |  | 385 / 845 | 7.1 | 1.9 |  | pass | FAIL |
| 10-21 07:01 | pair | ashburn | 1636 | 54:6:0 | 50:10 | 383 / 627 | 6.4 | 4.0 | FAIL | pass | FAIL |
| 10-21 07:01 | pair-window (rebuilt) | ashburn | 1636 |  |  | 379 / 627 | 6.6 | 4.5 |  | pass | FAIL |

Ashburn pairs where (b) agrees with (a): 13/15; where (c) agrees with (a): 14/15.

## P(miss) by the next tick interval (Ashburn direct probe, +0 ms trials)

| next interval ms | 0-50 | 50-100 | 100-150 | 150-200 | 200-250 | >= 250 |
|---|---|---|---|---|---|---|
| missed | 17/17 | 12/12 | 12/18 | 11/47 | 4/59 | 31/591 |

next < 150 ms: 41/47 missed (87%); otherwise 46/697 (6.6%).

## Bursts inside continuous windows (minutes failing (c))

- 02:51-02:54 pair-202610210248-39579740957.json/pair-window: ...  (catch-ups/min 0 0 0)
- 06:01-06:08 pair-202610210600-39604098048.json/pair-window: ..c.cc.  (catch-ups/min 0 1 2 0 3 2 1)
- 06:10-06:14 pair-202610210610-39605462121.json/pair-window: XXXX  (catch-ups/min 26 25 22 21)
- 06:37-06:45 pair-202610210637-39609432705.json/pair-window: .Xb.cc.c  (catch-ups/min 0 2 1 0 3 5 1 3)
- 07:01-07:09 pair-202610210701-39612921940.json/pair-window: cccc.ccX  (catch-ups/min 4 3 4 6 1 5 9 6)

Legend: . passes both, b fails (b) only, c fails (c) only, X fails both.
Bursts: 8 (4 closed, lengths 1, 1, 2, 2 min; censored >=4, >=1, >=4, >=3).

## Bursts across samples

- 04:13-04:14: 1 failing sample(s); lasted >= 1 min, <= 12 min
- 04:24-04:25: 1 failing sample(s); lasted >= 1 min, <= 29 min
- 05:09-07:08: 6 failing sample(s); lasted >= 119 min, <= open
Samples failing (c): 8/15.

## Severe bursts (>= 10 catch-ups/min over a sample) and demo restarts

Ashburn samples: calm (<= 1/min) 9, on time 444/445; simmer 2, 114/120; severe 4, 159/240.
- 04:13: 22.8/min; previous sample 04:04 at 0.0/min, next 04:18 at 0.0/min
- 04:24: 11.5/min; previous sample 04:18 at 0.0/min, next 04:47 at 0.8/min
- 05:36: 23.3/min; previous sample 05:09 at 1.6/min, next 06:00 at 0.0/min
- 06:10: 26.1/min; previous sample 06:00 at 0.0/min, next 06:37 at 0.0/min

Demo restarts seen in /playercount: 04:53 (last sample before: 04:47, 0.8/min, 5 min earlier); 06:14 (last sample before: 06:10, 26.1/min, 3 min earlier).

## What failing minutes line up with

| PDT hour | minutes failing (c) | failing (b) | catch-ups/min p50 | players p50 |
|---|---|---|---|---|
| 02:00 | 0/4 | 1/4 | 0.0 | 1564 |
| 03:00 | 0/2 | 0/2 | 0.0 | 1658 |
| 04:00 | 5/9 | 5/9 | 1.3 | 1673 |
| 05:00 | 4/4 | 2/4 | 21.2 | 1720 |
| 06:00 | 11/19 | 6/19 | 1.9 | 1671 |
| 07:00 | 7/8 | 1/8 | 4.8 | 1506 |

By player count (terciles at 1612 and 1673): failing (c) 8/15 / 7/14 / 12/17.
Pearson r (players, catch-ups/min) over 46 minutes: 0.30.

Fleet: minutes with >= 3 fleet logins/logouts in the 5 min before: failing (c) 2/5; others 25/41.
Within 10 min after a fleet restart: failing (c) 2/4; others 25/42.
