# Coin earner role

`speedrun/helpers/coins.ts` takes a brand-new demo account to Thieving 99 by
pickpocketing and keeps it earning, banking the coins where it earns them. The
coins stay in each earner's bank; the mule (rs/49) consolidates them.

## What it does

| Phase | Target | Where | Pays | Failure costs | Food |
|---|---|---|---|---|---|
| Thieving 1-24 | Man / Woman | east of Lumbridge castle (3231,3218) | 3 gp | 1 hp | none: a death respawns two tiles away and the coins are picked back up |
| 25 until `guardLevel` | Al-Kharid warrior | Al-Kharid palace (3293,3172), bank (3270,3167) | 18 gp | 2 hp | kebabs, 1 gp each from Karim (3273,3180) |
| `guardLevel` (99) on | Guard | Varrock palace courtyard (3210,3462), Varrock west bank | 30 gp | 2 hp | kebabs carried from Al-Kharid |

All targets from warriors up share the success curve `success_chance,*,240`
(pickpocket.dbrow), so at 99 about 94% of rolls succeed and the rate is set by
coins per success and how often the bot leaves to eat, bank or restock. The
loop clicks the target once per server tick and lets the server drop the clicks
that land while the player is delayed or stunned (a success occupies 2 ticks, a
failure 11; docs/speedrun/skills/thieving.md on the research branch).

**Food rule.** It eats a kebab in the tick after a success once hp is 4 below
max (a kebab heals 3 hp 20 times in 32 and 7 hp 8 times in 32, kebab.rs2), or
at once when the next failure could kill. When the last kebab is eaten it
leaves the station at once for more, so it never pickpockets a food target
without food. (Before this rule every warrior earner thieved on without food
until a failure could kill, and logged `out of food` at hp 2-3 on every
restock.) The one exception is an earner in Al-Kharid with no coins anywhere:
it pickpockets the warriors without food until it can buy kebabs, stops at hp
3 and rests (1 hp per 100 ticks) before it goes on.

**The toll gate.** `walkTo` treats the Al-Kharid toll gate as a door and, when
its path runs through it, retries `cant_reach` at (3268,3227-3228) forever. The
role therefore never walks to a tile on the other side of the gate (its walk
refuses and logs `walk refused`); it crosses with `crossTollGate` from
`speedrun/lib/toll-gate.ts`, shared with the buyer. That talks to a border guard
on the player's side (clicking the gate itself starts the dialogue only when a
guard stands within 1 tile), answers "Yes, ok.", pays 10 gp and confirms by the
side the player ends on. It refuses up front with fewer than 10 coins and gives
up at once on the guard's "not enough money" line.

**Money errands** (`planErrand`, pure and unit-tested). The toll is charged only
for a crossing the earner needs: 10 gp, plus `kebabs` gp when it crosses east
for food. Once in Al-Kharid any coin buys a kebab (1 gp each). Money that is
short comes from the bank first, then from pickpocketing on the side the player
is on: the Lumbridge men in the west, the warriors in the east. Fresh earners
used to loop here: they die once on the men (losing their coins), earn back
exactly toll plus kebab money, pay the toll, and then, in Al-Kharid with 24 gp,
walked back west through the gate to earn the 10 gp they had just paid.

In `auto` mode a guard account whose kebabs fall below 10 goes back to
Al-Kharid, thieves the warriors until the kebabs run out, restocks and returns
to the guards. The measured guard rate below includes that cycle.

## Measured on the demo (2026-10-21, 300 ms ticks, from bbs)

Rates are net of kebabs and tolls and include banking and restocking, from the
role's own progress lines (`gpPerTick` over server ticks, `gp/hour` over wall
clock). One server tick took 302 ms on average.

| Account and window | Target | Level | Net gp | Ticks | gp/tick | gp per account-hour |
|---|---|---|---|---|---|---|
| cairn_h61, 05:07-06:01 UTC | auto (guards, warrior fallback) | 94-99 | 66,434 | 10,774 | 6.17 | **73,500** |
| cairn_h62, 05:26-06:03 | warriors only | 99 | 34,998 | 7,297 | 4.80 | **57,300** |
| cairn_h60, 05:39-06:05 | guards, including a kebab run from Varrock | 91-99 | 28,166 | 5,048 | 5.58 | 66,600 |
| cairn_h61, guard bank cycles only (7 cycles of 2,820 gp) | guards | 99 | 19,730 | 2,671 | 7.4 (4.8-9.7) | about 88,000 |
| cairn_h62, warrior bank cycles at 99 (4 cycles) | warriors | 99 | 11,232 | 2,089 | 5.4 (5.2-5.7) | about 64,000 |

From a fresh account: the tutorial skip and Thieving 1 -> 25 on the Lumbridge
men take about 2.5 minutes (one death each time, harmless), and Thieving 25 ->
99 on the warriors about 45 minutes of play (h61 and h62: 46-48 active minutes
from account creation to 99, at 1-6 gp per tick on the way). Over its whole
life including that levelling, h61 earned about 50,000 gp per account-hour and
h62 about 40,000.

The three accounts ended with 189,906 gp in coins (h60 36,485, h61 87,880, h62
65,541) after h60 gave 2,000 gp to cairn_h42 (rs/47's jug fund) and spent 9,270
gp proving the buyer. About 4 hours of account time in all, roughly 1 of it
spent on the gift and the buyer runs rather than earning.

## How it compares

| Method | gp per account-hour on the demo | Notes |
|---|---|---|
| Varrock guards with kebab runs (`auto` at 99) | **73,500** measured; about 88,000 between restocks | default |
| Al-Kharid warriors | 57,300 measured | simplest, no travel |
| Knights of Ardougne | not run; estimate 110,000-125,000 | 50 gp on the same success curve as guards (1.67x the guards' 73,500-88,000), but a fresh account must cross White Wolf Mountain or take two boats, and Ardougne sells no cheap food, so it needs sharks: 732-907 gp each on the GE, and the guard accounts ate about 450-500 hp an hour at 99 (110 kebabs in 0.9 h), so 16,000-23,000 gp of sharks an hour. The research route in docs/speedrun/skills/thieving.md is the starting point. |
| Lumbridge men | about 4,000 at 99 | levelling only |
| Rune essence sold into the GE bid | 80,000-95,000 (rs/46's trip time x 79 gp net) | competitive and needs only Rune Mysteries, but every essence sold is one the scored account's 4,200 does not get |
| Coal or grapes into their bids | not run | the deepest bids on the server (coal 150 gp for 6.85M, grapes 1,000 for 99,591), but both are supply lines we need ourselves (market.md) |
| Shop to GE resale | small or one-off | market.md, "Coin sources" |

Pickpocketing wins on independence: it competes with no supply line, needs no
quest, and survives restarts anywhere.

## Running it

```sh
# one gateway per host (or per role), on loopback
cd server/gateway && AGENT_PORT=8560 GATEWAY_HOSTNAME=127.0.0.1 bun gateway.ts
# per account
cd server/webclient && GATEWAY_URL=ws://127.0.0.1:8560 bun src/lite/runner.ts cairn_h61
GATEWAY_URL=ws://127.0.0.1:8560 ROLE_OPTIONS='{}' bun speedrun/helpers/coins.ts cairn_h61
```

| Option | Default | Meaning |
|---|---|---|
| `target` | `auto` | `auto`, `man`, `warrior` or `guard`. Pinning `guard` on a low-level account works but burns kebabs. |
| `guardLevel` | 99 | Thieving level at which `auto` moves to the Varrock guards. |
| `bankAt` | 3000 | Carried coins that trigger a bank trip. Bounds what a death can cost; at 99 the bot never died. |
| `keepCoins` | 200 | Coins kept after banking, for kebabs and the toll. |
| `kebabs` | 24 | Kebabs per restock (27 fills the pack beside the coins). |
| `reportTicks` | 1000 | Ticks between progress log lines. |

Log lines: `phase` (from, to, levels) on every target change, `progress` and
`banked` with cumulative `earned`, `spent`, `banked`, successes, failures,
eats, deaths and `gpPerTick`, plus `toll gate` (toEast, ok, paid, reason),
`kebabs`, `withdrew coins`, `earning` (pickpocketing for errand money),
`resting`, `walk refused` and `died`. `ctx.reportBank` is called after every bank visit.

## What the fleet needs

- **A local gateway.** Through the demo's public gateway, state reaches the
  script in multi-second bursts (30 ticks took 11.0 s with stalls of 2.3-5.4 s),
  which wrecks a per-tick loop. Through a loopback gateway the same 30 ticks
  took 9.04 s.
- **Re-login with backoff.** The lite runner exits when its session ends; the
  demo's login server locks out bursts of logins (`Too many login attempts`,
  code 16). The dev runs used a shell loop that waits 30-60 s, doubles to 30
  minutes, and waits at least 10 minutes after a code 16. All three sessions
  once dropped at the same moment (a server-side event), and the role resumed
  from its saved state each time.
- **Accounts worth running:** any number up to the IP budget. Nine
  Al-Kharid warriors and six palace guards spawn (map files), and other players
  do not block a target (two bots on one knight both kept the 2-tick cadence in
  the research lab), so 3-4 earners per spot is reasonable. Other players'
  presence at either spot was not measured; nothing in the runs suggested
  interference (the rates were steady from cycle to cycle).
- **Logging out.** Stop the role, then click logout (component 2458) out of
  combat; killing the lite client only drops the socket and leaves the account
  in the world for up to 1,000 ticks. `speedrun/lib/session.ts` `logoutClean`
  does this properly.

## Gotchas

- `bot.skipTutorial()` fails ("No tutorial NPC found") on an account that has
  already left Tutorial Island, so the role checks the position first.
- Display names show the underscore as a space (`Cairn H61`). Match players
  with `playerPattern(account)` from mule.ts.
- Some Lumbridge men spawn inside the castle and cannot be reached; the role
  skips targets the client marks `reachable: false` and any target that
  produces nothing for 40 ticks.
- Hitpoints stay at 10; nothing here trains them. The bot eats in success
  windows, so a higher level would only save a few forced eats.
