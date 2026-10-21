# Wine supply: grapes, jugs of water, the wine maker and the hand-off

The scored account takes Cooking from 1 to 99 in one login by fermenting about
450 unfermented wines in its bank. Helpers gather grapes and jugs of water, a
Cooking-35 helper turns them into **noted** unfermented wine, and the scored
account receives one noted stack, deposits it and lets its fermentation timer
fire. Owner: cairn://p/rs/47. The Cooking route itself is cairn://p/rs/37's.

Code:

| File | What |
|---|---|
| `speedrun/helpers/grapes.ts` | role `grapes`: Cooking Guild camper (`source: guild`), Phoenix Gang hideout camper (`source: phoenix`, joins the gang first) or Goblin Village camper (`source: goblins`), from a fresh account |
| `speedrun/helpers/jugs.ts` | role `jugs`: buys jugs at the Varrock general store, fills them at the fountain, banks at Varrock east |
| `speedrun/helpers/wine.ts` | role `wine` (maker), `makeNotedWine`, `giveWine` / `giveWineKit` (giver), `receiveWine` / `splitDelivery` (the scored account's side) |
| `speedrun/helpers/wine-ferment.ts` | model of the fermentation timer and a Monte Carlo of delivery plans (`bun speedrun/helpers/wine-ferment.ts`) |
| `speedrun/lab/measure-wine.ts` | lab measurements T1-T9 (`speedrun/lab/lab.sh` with `LAB_PORTS`) |
| `docs/speedrun/scripts/wine-handoff.ts` | the same hand-off between two helper accounts on the demo |

## How fermentation works (`wine.rs2`, `login.rs2`)

- Using grapes on a jug of water needs Cooking 35. It makes one
  `jug_unfermented_wine` (obj 1995) and calls `settimer(fermenting_wine, 20)` on
  the maker. Every login calls the same `settimer` (`~ferment_wines_login`).
- When the timer fires it rolls every obj 1995 in the **bank** and the
  **inventory**: the bank in 15 equal batches of floor(N/15), then the N % 15
  remainder one at a time, then the inventory one at a time. Each roll is
  `stat_random(cooking, 48, 352)` at the current level (about 19% at 1, 78% at
  50, certain from 68). A success turns the whole batch into jugs of wine and
  gives 110 xp per wine (times the server's xp rate, 25 on the demo) before the
  next roll. A failure turns the batch into jugs of bad wine and gives nothing.
  There is no Cooking-level check on the timer itself.
- `settimer` replaces a running timer, so each make pushes the firing 20 ticks
  out. A normal timer does not fire while a modal (bank, trade, a level-up chat
  box) is open (`Player.processTimers` needs `canAccess`). It fires on the first
  tick the account is free again.
- **Noted unfermented wine (obj 1996) is invisible to the timer.** It never
  ferments, through any number of timers and logins. The bank stores deposited
  notes as obj 1995, so a helper must never bank its notes.

This engine's level curve is `2^(level/10)`, not the classic `2^(level/7)`: 99 is
998,458 xp, which is 39,938 base xp at 25x or **364 perfectly fermented wines**.

### Lab results (local engine, 300 ms ticks; ticks on the named bot's own clock)

| Test | Result |
|---|---|
| T1: second make 16 ticks after the first | fermented 20 ticks after the second make (36 after the first) |
| T2: bank left open 35 ticks after a make | still unfermented at close; fermented 1 tick after closing |
| T3: 28 wines from banked ingredients, noted as they go | 28 ticks, 3 rounds |
| T3b, T4: 28 notes held 30 ticks, then a logout and login and 30 more | all 28 still noted, nothing fermented |
| T5: hand 28 notes to a Cooking-1 receiver, deposit, relog | trade 5 + deposit 4 receiver ticks; fermented at login+20; 12 good, 16 bad; Cooking 1 -> 50 |
| T6: deliver inside the receiver's login window | trade from login+1, deposit done at login+8, fermented at login+20, no extra relog |
| T7: grapes on a jug of water at Cooking 20 | refused ("You need a Cooking level of 35") |
| T8: 450 wines made, one trade, one deposit, one firing at Cooking 1 | made in 349 maker ticks (35 rounds, 0.78 ticks per wine); trade 4 + deposit 3 receiver ticks; 330 good, 120 bad: **Cooking 97**, not 99 |
| T9: single-login split, 29 then 421 (re-armed by one make) | Cooking 1 -> 55 at login+20, -> **99** at login+76; receiver actions 45 ticks (see below) |

The model in `wine-ferment.ts` reproduces the lab exactly: 12 good wines from
level 1 give level 50, and 330 give 97.

## The hand-off (default: the single-login split)

One firing over a big bank is fifteen all-or-nothing rolls, starting at 19%.
T8 shows the cost: 450 wines at Cooking 1 reached 97. A small first batch
lifts Cooking before the big one is rolled. 29 wines roll 29 times (15 batches
of 1 plus 14 singles), so the first level is reliable. At that level the
receiver can make one wine itself, which re-arms the timer for the rest in the
same login.

Monte Carlo (40,000 trials per plan, `bun speedrun/helpers/wine-ferment.ts`):

| Plan (wines per firing) | P(99) | 5th percentile level | P(first firing leaves Cooking < 35) |
|---|---|---|---|
| 450 in one firing | 46% | 63 | |
| 520 in one firing | 65% | 68 | |
| 600 in one firing | 72% | 67 | |
| 15 + 435 | 93% | 98 | 20% |
| 30 + 420 | 97% | 99 | 6.7% |
| **29 + 421** | **99.1%** | 99 | **1.1%** |
| 44 + 406 | 99.1% | 99 | 0.9% |
| 29 + 491 (520) | 99.9% | 99 | 1.0% |
| 29 + 120 + 301 (three firings) | 100% | 99 | 0.9% |

30 is worse than 29 because 30 rolls as fifteen batches of 2.

**Procedure** (`giveWineKit` on the helper, `splitDelivery` on the scored account):

1. Before the scored account logs in, the maker stands at Varrock west bank
   holding the noted wines plus one grapes and one jug of water, and keeps
   requesting a trade.
2. The scored account logs in at the bank, accepts the trade (notes, grapes,
   jug: one trade, three slots) and deposits 29 notes. The login timer ferments
   them at login+20; keep the account out of modals then.
3. After that firing (Cooking about 55), dismiss the level-up, deposit the rest
   of the notes, close the bank and make one wine. That re-arms the timer, and 20
   ticks later the rest ferments. Dismiss the final level-up.
4. If the first firing left Cooking below 35 (about 1%), the rest stays banked
   and ferments at the next login. That is the two-login variant, which also
   reaches 99 at 99.1%.

Receiver ticks (lab T9, 450 wines): trade 4, first deposit 5, then 36 for the
level-up dismissal, the second deposit and the make, so 45 active ticks out of
76 from login to 99. The waits in between (login+8 to +20 and the 20 ticks
after the make) cost no actions, and the scored account can do anything there
that opens no modal. Two re-runs meant to time the level-up dismissal apart from
the bank and make (T9b) died on a slow lab host before the hand-off (the client
stopped publishing state), so the 36 ticks are not split further.

**On the demo** (rs-sdk-demo.fly.dev over a loopback gateway on bbs, 2026-10-21
07:14 UTC, `docs/speedrun/scripts/wine-handoff.ts cairn_h40 cairn_h44 --mode=window`):
the maker (cairn_h40, Cooking 35) made 17 noted wines in 25 ticks (2 rounds);
the receiver (cairn_h44, Cooking 1) logged in at the bank, its trade started at
login+1, took 8 ticks, the deposit 6, done at login+15, and the login timer
fermented them at login+20 with no extra relog: 6 good, 11 bad, Cooking 1 -> 40.
The giver's side took 9 ticks. The giver must wait until the receiver is in
sight before it opens the trade (`waitForPlayer` in wine.ts): the lib's
`openTrade` gives up after 5 ticks without a sighting, and a demo login takes
longer, which failed the first demo attempt and the lab on slow hosts.

**Two-login variant** (no grapes and jug in the trade): the same first part,
and the rest is deposited at any later login the route already makes. Its
receiver cost is the trade (4) + deposit (3-5) + a second deposit (3) at the
later login.

**Receiver makes the wine itself?** Not below Cooking 35 (T7), and above it
making costs about 0.78 ticks per wine on the scored clock (T8: 349 ticks for
450) against one trade. Handing over grapes + jugs is never worth it; only the
one re-arming wine is made by the receiver.

## Making the wine (helper side)

`makeNotedWine` repeats one round per bank visit: deposit the loose wine, withdraw
it straight back as notes (`withdrawMany` with `asNote`), deposit everything
but the notes, withdraw grapes and jugs of water, close the bank, and fire every
make at once (the engine takes 5 per tick). The bank is open between makes, so
the timer is held. Rounds withdraw 12 pairs (10+1+1 clicks), never an X
amount: two X withdrawals in one burst lost the second on the lab (0 grapes,
13 jugs). The noted stack lives in the maker's inventory indefinitely, so the
maker can work days ahead and needs no timing against the scored account.
The maker needs Cooking 35. The `grapes` role trains it on chickens (cooked on
the cooking pot in the house at the Lumbridge chicken pen, 3225,3290; the
Lumbridge castle range is the Cook's and refuses anyone without Cook's
Assistant). Cooking 1 -> 35 took one inventory of chickens on the demo (25x).

## Grape sources and rates

There are exactly two grape spawns (obj 1987 in `server/content/maps`): the
Cooking Guild top floor (3144,3450, level 2) and the Phoenix Gang hideout
(3237,9761). Both respawn every 80 ticks (`wine.obj`). The Goblin Village
goblins (all 21 spawns are the armoured types that use
`goblin_village_drop_table`) drop grapes 1/128. No shop sells grapes, and no
other drop table or quest reward has them.

| Source | Ceiling | Measured on the demo (2026-10-21 UTC) |
|---|---|---|
| Cooking Guild spawn | 150/h for the only taker (12,000 ticks/h over 80) | **contested**: another player (Jackalopevin) camps the next tile. The first version got about 36/h. The racer (stand on the tile, poll every tick when due, raw pickup) holds **60/h**: cairn_h40, 60 grapes in its first hour, 107 of 167 respawns taken by the other camper |
| Phoenix Gang hideout spawn | 150/h for the only taker | Lab: 21 grapes in 0.25 h including joining the gang; camping alone it takes every respawn. Demo: cairn_h46 joined in about 11 minutes from Goblin Village (one Jonny kill), then **about 100/h** (30 grapes in its first 0.29 h, bank trips included); also contested, another player took 10 of the first 27 respawns |
| Goblin Village, per account | 3/h at 1/128 | 360-440 kills per account-hour at combat about 25; 14 grapes in about 2,500 kills over four accounts (1 in 180), so 2-4/h per account |
| Goblin Village, all players together | about 25/h | 21 goblins, 70-tick respawn: about 3,000 kills/h for the whole village. About 8 accounts saturate it; more accounts only take kills from each other and from other players |
| Grand Exchange | | a 1,000 gp bid for 99,536 grapes and no asks; 464 grapes have traded, all at 1,000 gp (20 trades), about 22/h flowing into that bid. We do not bid against it |

Jugs are not the constraint. The `jugs` role makes about 120-146 jugs of water
per hour (cairn_h42: 243 banked in its first 1.9 hours on the demo) from the Varrock general store (stock 2, one restock per 100 ticks,
1-2 gp each) and the fountain. The guild camper picks up the guild's jug spawn
and fills it at the sink there. 520 jugs take one account about 4 hours and
about 700 gp. A faster free source, not built or measured here: Hassan in the
Al Kharid palace hands a jug of water to anyone whose Prince Ali Rescue is not
started, every time the "It's just too hot here" option is picked
(`hassan.rs2`), so jugs cost only dialogue pages there.

### Hours to 520 grapes (450 + 15%)

| Setup | Grapes/h | Hours to 520 |
|---|---|---|
| Guild racer only, contested as measured | 60 | ~8.7 |
| Guild racer + Phoenix camper, both contested as measured | ~160 | ~3.3 |
| The same + 3 goblin campers (as run on 2026-10-21) | ~170 | ~3.1 |
| Guild + Phoenix, both uncontested | up to 300 | ~1.7 |

On 2026-10-21 rs/41 decided to buy the 520 on the Grand Exchange (rs/63's
bidder on cairn_h61) and keep the gatherers running as the reserve on top.

The lever is the second spawn. Main's estimate of 30-60 goblin helpers for 50-100
grapes/h doesn't hold: the village's 70-tick respawn caps everyone together
near 25/h, and a crowd there would also crowd out other players.

## What a shortfall costs the scored account

At 25x, 99 needs 39,938 base xp; each good wine is 110. With the split plan:

| Wines delivered | P(99) | Mean base xp short of 99 |
|---|---|---|
| 364 | 0% | 1,844 |
| 380 | 69% | 599 |
| 400 | 88% | 194 |
| 420 | 96.5% | 96 |
| 450 | 99.2% | 28 |
| 520 | 99.8% | 17 |

Each 100 wines short is 11,000 base xp (275,000 at 25x) the scored account must
cook as food instead, for example 53 sharks (210 xp, Cooking 80), 92 lobsters
(120, Cooking 40) or 157 trout (70, Cooking 15). `cooking.rs2` delays the
player one tick per item, so that is on the order of 2 ticks per item plus
banking and someone supplying the raw fish. The per-item cost is not measured
here; cairn://p/rs/37 owns that comparison.

## Running it (bbs, dev setup)

Roles run like every rs/41 helper (`speedrun/helpers/role.ts`). Options:

- `grapes`: `{"source":"guild"}` or `{"source":"phoenix"}` (one account per
  spawn: etiquette, and each spawn is a race) or `{"source":"goblins"}` (up to
  about 8 accounts in the village). The Phoenix camper joins the gang first and
  needs 20 coins for Baraek and enough combat for Jonny the Beard (level 2).
  Both spawn campers bank at Varrock east.
  Optional `cooking` (default 35), `bankAt` (26), `fightLevel` (10).
- `jugs`: `{"target":600}`. It needs coins in its bank (a fresh account sells its
  starter kit for the first few).
- `wine`: `{"acceptFrom":"^cairn_(h\\d+|mule\\d)$","receiver":"..."}` on the
  Cooking-35 account at Varrock west bank. It accepts trades of noted grapes and
  jugs of water from couriers or the mule (`speedrun/helpers/mule.ts` courier
  role), banks them, keeps making noted wine, and gives it to `receiver` when
  that account is in sight.

### Stopping and handing over to the fleet

The dev setup on bbs (`~/rs-dev/wine`, control scripts in `~/rs-dev/wine-ctl`)
runs one lite client and one role loop per account on the private tmux server
`rs41-wine`, with its own gateway on 127.0.0.1:8540. Stop it with

```sh
ssh bleu@bbs 'bash ~/rs-dev/wine/docs/speedrun/scripts/wine-stop.sh'            # every account
ssh bleu@bbs 'bash ~/rs-dev/wine/docs/speedrun/scripts/wine-stop.sh cairn_h47'  # one account
```

Per account it writes the stop file (so neither loop restarts), closes the
role window, logs the account out through the logout button while its client
is still connected (`wine-logout.ts`, the lib's `logoutClean`, which waits out
combat), and only then lets the client go. Closing the clients first would leave
the accounts idle in the world for up to 500 ticks and block the fleet's next
login. A failed logout leaves that client running and makes the script exit 1;
rerun it for that account. When no account is left it stops the tmux server and
the gateway with it. Tested on cairn_h47 mid-fight on 2026-10-21: out of the
world in the click's tick, 11 s for the whole stop.

Then adopt the accounts (credentials are already in `~/rs-fleet/bots/`):

```sh
F=~/rs-fleet/speedrun/helpers/fleetctl
$F assign cairn_h40 grapes --options '{"source":"guild"}'
$F assign cairn_h46 grapes --options '{"source":"phoenix"}'
$F assign cairn_h41 grapes --options '{"source":"goblins"}'
$F assign cairn_h45 grapes --options '{"source":"goblins"}'
$F assign cairn_h47 grapes --options '{"source":"goblins"}'
$F assign cairn_h42 jugs --options '{"target":600}'
$F reload
```

cairn_h40 is also the wine maker (Cooking 35). When the wine is due, reassign it
(`$F assign cairn_h40 wine --options '{"acceptFrom":"^cairn_(h\\d+|mule\\d)$","receiver":"<scored account>"}'`)
and deliver the bought grapes and the jugs of water to it by trade at Varrock
west bank. cairn_h44 is the test receiver; it stays logged out.

Gotchas found on the demo:

- The guild door (`chefdoor`) is on the south edge of 3143,3444. A walk from
  Varrock that aims straight at it routes through the brick house east of the
  guild (door at 3155,3438, east wall), whose door can close behind the
  account, leaving it walled in at 3149,3441. The role goes round by the
  south-west and opens that house's door if it ever finds itself inside.
- A fresh account's tutorial kit fills the inventory together with 12 cooked
  chickens; the role banks the kit then (it used to spin forever).
- Quest items go by their display names: the Shield of Arrav book shows as
  "Book" and Jonny the Beard's intelligence report as "Scroll", so the role
  matches them by id (757, 761).
- The hideout grapes lie on a table (loc 595) that blocks their tile; a walk
  to it fails as "destination tile is blocked", so the camper stands on
  3237,9762 and picks up from there.
- The SDK's offline map treats doors as open, so a closed door shows up as "no
  path" or as a server walk that does not move.
