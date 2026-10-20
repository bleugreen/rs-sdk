# Thieving: fastest route to 99

Scripts: [`thieving-pickpocket.ts`](../scripts/thieving-pickpocket.ts) (pickpocket
cadence, stun, eating, end-to-end runs), [`thieving-stall.ts`](../scripts/thieving-stall.ts)
(stalls), [`thieving-model.ts`](../scripts/thieving-model.ts) (route model). Lab:
[../LAB.md](../LAB.md), thieving port block. Labels follow
[README.md](README.md#labels).

## 1. Recommendation

Pickpocket Knights of Ardougne in the East Ardougne market from level 55 to 99,
clicking the knight once every server tick. A success costs 2 ticks and a
failure 11 (measured), the knights' success chance reaches 94% at 99, and every
other target in the content earns less than half the knights' rate at any level
from 55 up (section 5). From 55 to 99 takes **about 2,200 ticks** (measured
end to end three times: 2,176 / 2,198 / 2,226). From a fresh account, Ardougne
men to 25, warrior women to 40 and guards to 55 add about 640 ticks (inferred),
so **1 -> 99 is about 2,840 ticks**. Fight Arena's 2,175 base xp starts the
account at 57 and makes it **about 1,950-2,000 ticks** (measured 1,952 from 57;
model 1,975). Sharks eaten between successes cost nothing; about 15 cover the
whole route at 40+ HP.

## 2. Route by level band

Base xp per tick is measured where a script and sample are named; band ticks
from 55 up are the mean of the three measured 55 -> 99 runs
(`thieving-pickpocket.ts --level=55 --hold=0 --until=99`, 548-558 rolls each);
bands below 55 are from `thieving-model.ts --overhead=0.2` (inferred, with the
per-target cadence and success rate measured).

| Band | Method | Location | Unlock | Base xp / success (read) | Ticks per roll (measured) | Success rate | Base xp / tick | Ticks for band |
|---|---|---|---|---|---|---|---|---|
| 1-25 | Pickpocket Man / Woman | East Ardougne market, e.g. (2614,3318) | none (members world) | 8.0 | 2 success / 11 fail | 70.7% at 1 -> 76% at 25 (read); 69.5% at 1, 70.0% at 20 (measured, 200 rolls each) | 1.17 at 1, 1.19 at 20 (measured) | 155 (inferred) |
| 25-40 | Pickpocket Warrior woman (Al-Kharid warrior is the same row) | Ardougne warrior women, e.g. (2629,3295); Al-Kharid (3282,3170) | Thieving 25 | 26.0 | 2 / 11 | 52.3% at 25 -> 60.9% at 40 (read); 56.5% at 25, 55.5% at 35 (measured, Al-Kharid, 200 each) | 2.46 at 25, 2.35 at 35 (measured) | 181 (inferred) |
| 40-55 | Pickpocket Guard | Ardougne market guards, e.g. (2659,3309) | Thieving 40 | 46.8 | 2 / 11 | 49.2% at 40 (read); 52.0% (measured, 200) | 3.72 at 40 (measured) | 305 (inferred) |
| 55-70 | Pickpocket Knight of Ardougne | Ardougne market, spawns (2653,3300), (2669,3298), (2671,3313), (2652,3318) | Thieving 55 | 84.3 | 2 / 11 | 60.5% at 55 -> 71.5% at 70 (read); 64.0% at 55, 71.3% at 70 (measured, 300 each) | 9.77 at 55, 12.68 at 70 (measured) | 422 (measured) |
| 70-85 | Knight of Ardougne | same | | 84.3 | 2 / 11 | 83.3% at 85 (read); 84.0% (measured, 300) | 20.12 at 85 (measured) | 619 (measured) |
| 85-93 | Knight of Ardougne | same | | 84.3 | 2 / 11 | | | 600 (measured) |
| 93-99 | Knight of Ardougne | same | | 84.3 | 2 / 11 | 94.1% at 99 (read); 96.3% (measured, 300) | 33.19 at 99 (measured) | 557 (measured) |

Totals:

| Start | Ticks to 99 | Basis |
|---|---|---|
| Level 1, no quests | ~2,840 | 641 inferred (1-55) + 2,200 measured (55-99) |
| Level 55 | 2,200 (runs: 2,176 / 2,198 / 2,226) | measured, 3 runs |
| Fight Arena, level 57 (2,175 base) | ~1,950-2,000 (run: 1,952 from 57.0) | measured, 1 run; model 1,975 |
| Fight Arena + Tourist Trap x2 (11,475 base, level 81) | ~1,270-1,390 | inferred: model 1,269 at 0.2 ticks/roll overhead, x1.096 for the measured-vs-model gap |

The spread is real. A 55 -> 99 run always needs exactly 452 successes (452 x
84.3 = 38,104 base xp >= the 38,077 needed), so the variance comes from the
failure count (96-106 measured; standard deviation of about 115 ticks,
inferred) and from how far the chosen knight wanders (section 6).

The 'all targets' model route (farmers 10-25, Rogues 32-40, Fremennik 45-55)
is only about 93 ticks faster from level 1 and needs the deep Wilderness and
The Fremennik Trials, so the Ardougne-only route is recommended.

## 3. Quest xp

| Quest | Thieving reward (base, read) | Start level it gives |
|---|---|---|
| Fight Arena | 2,175 (`quest_arena.rs2:270-271`) | 57 |
| Tourist Trap | 4,650 per pick, 2 picks among Fletching, Agility, Smithing, Thieving (`irena.rs2:77-91`) | FA + 1 pick: 73; FA + 2 picks: 81 |
| Legends' Quest | 7,650 per pick, 4 picks (`radimus_erkle.rs2:74-122`) | FA + TT2 + 1 pick: 88 |

Fight Arena removes the whole slow low-level route: about 670-890 ticks saved
(inferred: model 2,649 -> 1,975; measured-calibrated 2,840 -> ~1,950). Its
duration belongs to the quest route (rs/14 under rs/3), not here.

An extra Thieving pick is worth less than it looks, because it removes xp at
the knights' rate, not at the low-level rate (`thieving-model.ts`, inferred):

| Pick on top of | +4,650 (Tourist Trap) saves | +7,650 (Legends) saves |
|---|---|---|
| level 1 | 907 ticks | 1,132 ticks |
| Fight Arena | 402 ticks | 604 ticks |
| Fight Arena + Tourist Trap x2 | 260 ticks | 412 ticks |

After Fight Arena a pick removes xp at 11-12 base xp per tick. Any skill
trained more slowly than that at the levels the pick would cover (Agility at
about 8 per tick in the prior research) gains more from the same pick. So
Tourist Trap and Legends picks should go elsewhere unless every other skill's
document shows a higher rate. Quest xp only helps if it is claimed before the
Thieving training it replaces.

## 4. Mechanics

Scripts and engine rules (read):

- `[opnpc3,knight_of_ardougne]` jumps to `attempt_pick_pocket`
  (`pickpocket.rs2:43-44,100-142`). That label returns silently while
  `%stunned > map_clock` (`:130-132`), re-queues with `p_opnpc(3)` while
  `%action_delay > map_clock` (`:134-137`), refuses within 8 ticks of
  `%lastcombat` (`:125-128`), and checks the level with `stat(thieving)`
  (boostable, `:118-123`).
- `pick_pocket` prints "You attempt...", then `p_delay(0)`, and only then rolls
  (`thieving.rs2:4-12`). A success gives xp and coins and ends; it sets no
  clock (`:19-24`). A failure does `p_delay(0)` twice, deals the row's
  `stun_damage`, and sets `%action_delay` and `%stunned` to `map_clock + stun_ticks`
  (`thieving.rs2:29-51`).
- The roll is `stat_random(thieving, lo, hi)`:
  `floor(lo(99-L)/98) + floor(hi(L-1)/98) + 1 > rand(256)` on the current
  (boosted) level (`PlayerOps.ts:591-600`).
- **OPNPC clicks are rejected while delayed.** `OpNpcHandler.ts:16-20` returns
  `UNSET_MAP_FLAG` and drops the packet if `player.delayed`, and so does the
  routing move packet (`MoveClickHandler.ts:12-15`). The flag clears only in
  `processPlayers` (`World.ts:776`), after that tick's packets were handled
  (`World.ts:402,425`).

The cadence that follows (read, then measured). Take an attempt starting at
tick T, when a click lands and the interaction runs in `processPlayers`:

- **Success.** `p_delay(0)` delays to T+1. The click landing at T+1 is
  rejected, the roll happens at T+1, and the click at T+2 starts the next
  attempt. So **2 ticks per success**, and at most one attempt every 2 ticks.
- **Failure.** The roll is at T+1. Clicks at T+2 and T+3 are rejected
  (delayed). The stun is set at T+3 to T+11. Clicks at T+4 to T+10 pass the
  packet check but the script returns silently. The click at T+11 starts the
  next attempt. So **stun_ticks + 3 = 11 ticks** (13 for Heroes' 10-tick
  stun).

Measured (`thieving-pickpocket.ts`, clicking every tick):

| Run | Rolls | Success measured / predicted | Gap after success = 2 | Gap after failure = 11 (13 Hero) | Base xp / tick |
|---|---|---|---|---|---|
| Knight 55 (level held) | 300 | 0.640 / 0.607 | 180 / 191 | 87 / 108 | 9.77 |
| Knight 70 | 300 | 0.713 / 0.716 | 203 / 213 | 76 / 86 | 12.68 |
| Knight 85 | 300 | 0.840 / 0.833 | 248 / 251 | 41 / 48 | 20.12 |
| Knight 99 | 300 | 0.963 / 0.941 | 276 / 288 | 9 / 11 | 33.19 |
| Knight 55 -> 99, 10 HP | 554 | 0.816 / 0.835 | 416 / 451 | 73 / 102 | 2,176 ticks total |
| Knight 55 -> 99, 40 HP | 548 | 0.825 / 0.833 | 375 / 451 | 49 / 96 | 2,226 ticks total |
| Knight 55 -> 99, 99 HP | 558 | 0.810 / 0.827 | 428 / 451 | 83 / 106 | 2,198 ticks total |
| Knight 57 -> 99, 40 HP | 536 | 0.838 / 0.836 | 428 / 448 | 65 / 87 | 1,952 ticks total |
| Paladin 99 | 200 | 0.555 / 0.590 | 106 / 110 | 85 / 89 | 13.96 |
| Hero 99 | 200 | 0.380 / 0.395 | 72 / 75 | 110 / 124 (13) | 11.60 |
| Guard 40 | 200 | 0.520 / 0.493 | 100 / 104 | 75 / 95 | 3.72 |
| Al-Kharid warrior 25 / 35 | 200 / 200 | 0.565 / 0.528, 0.555 / 0.583 | 106 / 112, 101 / 111 | 81 / 87, 70 / 88 | 2.46 / 2.35 |
| Man/Woman 1 / 20 | 200 / 200 | 0.695 / 0.707, 0.700 / 0.750 | 136 / 139, 136 / 139 | 58 / 60, 60 / 60 | 1.17 / 1.19 |

Across about 3,100 knight successes, the measured count is within 0.1% of the
`stat_random` prediction. Gaps longer than 2 or 11 are walks after a wandering
knight: 0.1-0.5 extra ticks per roll depending on the knight (section 6).

What was measured to settle question 1:

- **Rejected while delayed: yes.** In the level-55 run, 141 of 191 success
  intervals carry exactly one tick with a server rejection (the click landing
  in the tick after the attempt started). Failure intervals carry 2-3 (the two
  delayed ticks after the roll). The SDK only counts rejections while the
  player stands still, which explains the intervals with 0. Measured
  throughput when clicking every tick is 0.18 rolls per tick at 55 and 0.41 at
  99. It can never exceed 0.5.
- **Clicks during a stun are dropped, not queued.** With `--stunprobe=5`, a
  single click was sent 5 ticks after each failed roll and clicking resumed at
  14. In 27 of 27 probes the next roll came 16-25 ticks after the failure,
  never at 11. The bot must keep clicking through the stun's last tick.
- **The stun is 8 ticks, and a failure costs 11 overall** (above). Moving
  during the stun is refused with "You're stunned!" (`walktrigger(stunned)`).
- **Level-up dialogs cost nothing measurable** when dismissed with
  `sdk.sendClickDialog(0)` in the same tick as the next click. The 55 -> 99 runs
  include all 44 level-ups and still show 2-tick gaps for 92-95% of successes.

## 5. Alternatives considered

Base xp per tick by level, from `thieving-model.ts --overhead=0.2` (inferred;
measured spot checks in section 4):

| Level | Knight | Paladin (70) | Watchman (65) | Gnome (75) | Hero (80) | Guard |
|---|---|---|---|---|---|---|
| 55 | 8.9 | | | | | 4.9 |
| 70 | 12.6 | 10.2 | 8.9 | | | |
| 80 | 16.5 | 11.6 | 10.7 | 9.8 | 9.1 | |
| 90 | 22.1 | 13.4 | 13.1 | 11.5 | 10.5 | |
| 99 | 29.1 (33.2 measured) | 15.2 (14.0 measured) | 15.6 | 13.5 | 12.2 (11.6 measured) | |

- **Paladins and Heroes exist** (`pickpocket.dbrow:105-155`, spawned in the
  Ardougne market and castle) but lose to knights at every level. Their low
  `hi` success values (150 and 100 against the knights' 240) cap them at 59% and
  39% at 99. Measured at 99: Paladin 13.96 and Hero 11.60 base xp per tick,
  against 33.19 for knights.
- **Watchman (65), Gnome (75), Fremennik (45, needs The Fremennik Trials)** lose
  for the same reason (inferred, model only).
- **Stalls are unusable in the Ardougne market** (measured, `thieving-stall.ts`,
  600 ticks each: baker's stall at 5 and silk stall at 20, **0 steals**). The
  owner (5 tiles, line of sight) or a guard (Ardougne guards and knights, plus
  paladins at the silver, spice and gem stalls) refuses the steal, and a guard
  retaliates (`stealing.rs2:98-121`). After that every click returns "You can't
  steal from the market stall during combat!" (`stealing.rs2:70-73`) until the
  account dies. Even unguarded, the best stall rate is low: the baker's stall
  gives 16 base per 8-tick respawn (read).
- **Trapped chests** need 10 ticks per open (`p_delay(1)` x3 + `p_delay(2)`,
  `thieving.rs2:141-164`) and respawn in 15-800 ticks (`trapped_chest.dbrow`).
  The best, the Ardougne castle chest (72, 500 base, 800-tick respawn), gives
  under 1 base xp per tick (read, inferred).
- **Locked doors** (`locked_door.dbrow`) give 3.8-50 base per pick through a
  door you then have to walk back through. Not competitive (read).

## 6. Gotchas

- **Damage and death.** Failure damage is fixed, not rolled: `damage(uid, 1,
  stun_damage)` (`damage.rs2:1-19`). It is 3 for knights, paladins and
  watchmen, 4 for heroes, 2 for warriors, guards and rogues, and 1 for men
  (read). Measured: knights 3 in 98% of failures; the 2s are a regeneration
  tick landing in the same tick. Over 55 -> 99 the account loses 285-317 HP
  (measured, 3 runs), about 350 from level 1 (inferred). The first lab run
  died at 99 HP after 35 knight failures with no food. Failing does not put
  the account in combat: there were no "during combat" refusals in any run.
- **Eating is free in a success window and costs exactly 3 ticks during a
  stun.** Eating adds 3 to `%action_delay` rather than setting it from the
  clock (`consume.rs2:129-131`). During a stun that pushes the next attempt from
  11 to 14 ticks after the failure: measured, `--eat=stun --eatdelay=4`, 54 of
  58 failure gaps were 14. Eating in the same tick as the click that follows a
  success, and at least 3 ticks after the last stun ended, leaves the 2-tick
  cadence intact: 12 of 12, 14 of 14 and 39 of 48 such eats measured (the rest
  coincided with a walk). An eat sent while the player is delayed (the tick
  after a click) is rejected like a click.
- **HP level.** At 40+ HP every eat can wait for a success window; the 40 and
  99 HP runs needed no forced eats. At 10 HP a failure streak forces eating
  mid-stun: 26 forced eats, about 12 of them costing 3 ticks, in the 10 HP
  run. That is about 40 ticks, smaller than the difference between knights.
  Train Thieving after Hitpoints has risen if the plan allows; it is not
  worth training Hitpoints for.
- **Inventory never fills.** Knights, guards, warriors and men drop only
  coins (`pickpocket.dbrow`), which stack. 55 -> 99 yields about 22,600
  coins. No banking.
- **Keep a knight in reach.** Knights have `wanderrange=15`
  (`_unpack/225/all.npc`, `[knight_of_ardougne]`). Re-clicking every tick
  follows them (the client routes, and the server walks then pickpockets), but
  a knight that walks off during a stun costs extra ticks, because the stunned
  player cannot follow. Measured overhead per roll by knight:

  | Knight | Overhead per roll |
  |---|---|
  | (2671,3313) | 0.16 |
  | (2669,3298) | 0.22 |
  | (2653,3300) | 0.26 (includes forced eats) |
  | (2652,3318) | 0.47, about 120 extra ticks over 55 -> 99 |

  Prefer the eastern knights.
- **Other players do not block a target.** Pickpocketing sets no delay on the
  NPC; only `npc.delayed` is checked (`OpNpcHandler.ts:27-31`). Two bots on
  the same knight both kept the 2-tick cadence: 146 of 163 and 164 of 175
  success gaps were 2 (measured, 200 rolls each at 85). The market guards,
  paladins and heroes ignore pickpocketing.
- **Members world only** (`pickpocket.rs2:101-104`). The demo server is
  members (`WorldConfig.ts:100`).
- **The bot must click every tick on production.** All measurements are on a
  local 100 ms engine with negligible latency. On production (300 ms ticks) a
  click that arrives one tick late turns a 2-tick success into 3. Per-tick
  clicking tolerates jitter up to one tick, because extra clicks are only
  rejected, never harmful.

## 7. Helper supply list

| Item | Count | Why |
|---|---|---|
| Shark | 20 | 285-317 HP lost over 55 -> 99 (measured), about 13-15 sharks eaten at 40+ HP (measured), plus spares. Sharks heal 20 per slot in one eat (`consume_normal.dbrow`). Pineapple pizza also heals 20 per slot but takes two eats. Add 5 for the low-level route without Fight Arena. |
| Cake (only if Hitpoints is 10) | 27 | Inferred. At 10 HP each shark restores at most 10; a cake gives 3 bites of 4 HP per slot, enough for the about 75 eats measured at 10 HP in one inventory. |

Nothing else is needed: no tools, no gloves, no banking.

## 8. Open questions

- **Production latency.** The 2-tick cadence depends on a click landing in the
  tick right after each roll. A short run on the public server, logging
  `gapAfterSuccess` with this script, would settle it.
- **Getting to Ardougne.** Travel to the market (walking, or the Ardougne
  teleport, which needs Magic and Plague City) is not costed here. Fight Arena
  ends near Ardougne, so the quest route may make it free.
- **The 1 -> 55 route is modelled, not run end to end.** Each target's rate was
  measured at one or two levels (200 rolls each). Walking between Ardougne
  men, warrior women and guards is not included, and is probably tens of
  ticks.
- **Measured 55 -> 99 is about 10% above the model** (2,200 against 2,007 at
  0.2 ticks per roll of overhead): about 100 failures against about 90
  expected, plus 0.16-0.47 ticks per roll of walking. More end-to-end runs at
  the best knight would narrow the planning figure.
- **Thieving boosts.** None exist apart from the poison chalice's random +1
  (`poison_chalice.rs2:58-62`). The level gate and the roll both use the
  boosted level, so a boost found later would matter.
