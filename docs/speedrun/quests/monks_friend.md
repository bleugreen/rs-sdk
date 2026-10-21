# Monk's Friend

**Verdict: skip (break-even at best).** Woodcutting from level 1 to 99 is 3,958 ticks,
and from 2,000 base it is 3,657, so the quest's Woodcutting is worth **301 ticks** on the
normal oak/willow cycle and **230** on the 3-tick knife cycle (inferred, rs/6's
`woodcutting-model.ts` via rs/2, 2026-10-20 22:11). Against 325 fixed that is -24 (normal)
or -95 (knife); only burst dialogue on the normal cycle reaches +14, which is inside the
error of the model. Added by the quest-route coordinator (cairn://p/rs/3); the original
pending verdict and decision rule follow.

**Original verdict: pending the Woodcutting route (cairn://p/rs/6), and likely worth doing.** It
costs **about 397 ticks on the stock client (inferred), 325 on the fixed client
(measured) and about 287 with bursts (inferred)**, trade included. Its 2,000 base
Woodcutting (level 1 → 55) is the only Woodcutting quest xp on the planned route, so its
value is simply Woodcutting ticks from level 1 to 99 minus ticks from 2,000 base to 99.
rs/6 has not published `woodcutting.md` yet (its builder was still on the rate model at
20:08), so that number is not available, and this document does not invent one.

**The decision rule:** do Monk's Friend if rs/6's Woodcutting route spends more than
**about 325 ticks (fixed client) getting from level 1 to 2,000 base xp** (397 stock,
287 burst). For scale only (inferred, not a Woodcutting figure): in the two gathering skills
rs/2 has published, the first 1,300-2,437 base xp cost 282 ticks of Mining and 755 of
Fishing from level 1 (`mining.md`, `fishing.md` section 3). The prior flat late-level rate
of about 11.6 base per tick (cairn://p/rs/main/task/per-skill) would value it at only
about 170 ticks, but early levels are much slower than that in both measured skills.

Measured twice end to end with `docs/speedrun/scripts/quest-smallskill-drunkmonk.ts`
through `quest-smallskill-lab.sh`, `NODE_TICKRATE=300`, fixed lite client: 320 and 327
ticks of steps.

## Reward

- **2,000 base Woodcutting** (read, `stat_advance(woodcutting, 20000)`, `quest_drunkmonk.rs2:89`;
  measured 50,000 game xp, Woodcutting 1 → 55).
- **1 quest point** (read, `quest.constant:89`), 8 law runes (`quest_drunkmonk.rs2:88`).

## Requirements (as this server enforces them)

None: no `stat()`, `stat_base()`, `map_members` or quest check in `quest_drunkmonk/` or the
monks' scripts (read: `brother_omad.rs2`, `brother_cedric.rs2`, `ardounge_monk.rs2`). Items
checked: the child's blanket (`brother_omad.rs2:44`), a jug of water
(`brother_cedric.rs2:32`) and logs (`brother_cedric.rs2:62`). The Ardougne teleport used
here needs Plague City and Magic 51 (`plague_city.md`).

## Helper-supplied items

One trade: a jug of water, logs, Ardougne teleport runes (2 law, 2 water). The child's
blanket is `tradeable=no` (`quest_drunkmonk.obj:12`) and is a ground spawn in the thieves'
cave at (2570,9604) (`maps/m40_150.jm2`).

## Step list

Quest varp `%drunkmonkquest` (perm): 0, 10, 20, 30, 40, 50, 60, 70, 80
(`quest_drunkmonk.constant`, `quest.constant:21`).

| # | Where | Action | Varp | Raw counts | Fixed (run 2; run 1) | Label |
|---|---|---|---|---|---|---|
| 0 | anywhere | helper trade | | 1 trade | 5 (9 stock) | measured, `primitives.md` |
| 1 | → Ardougne (2661,3301) | Ardougne teleport | | 1 cast | 4 | measured |
| 2 | → Brother Omad (2604,3209), the monastery | run south-west | | 106 route tiles | 60 (59) | measured, `bot.walkTo` |
| 3 | Omad | "Why can't you sleep, what's wrong?", "Can I help at all?"; starts the ladder timer (`brother_omad.rs2:35-36`) | 0 → 10 | 11 pages + 2 options; `2c, opt, 5c, opt, 4c` | 15 (14) | measured |
| 4 | → ring of stones (2561,3222) | the ladder appears while you stand within 2 tiles (`quest_drunkmonk.rs2:1-6`) | | 62 route tiles | 32 (30), ladder there on arrival (0) | measured |
| 5 | ladder `wildymirrorladdertop1` 1765 | climb down to (2561,9621) (`ladders.rs2:104-108`) | | 1 climb | 5 (4) | measured |
| 6 | thieves' cave | take the child's blanket (2570,9604), back to the ladder (2561,9622), climb up | | 39 tiles, 1 pickup, 1 climb | 31 (31) | measured |
| 7 | → Omad | run back | | 60 route tiles | 31 (32) | measured |
| 8 | Omad | hand over the blanket | 10 → 20 | 7 pages; `7c` (objbox, then the varp) | 9 (8) | measured |
| 9 | Omad | "Who's Brother Cedric?", "Where should I look?" | 20 → 30 | 14 pages + 2 options; `7c, opt, 4c, opt, 3c` | 17 (17) | measured |
| 10 | → Brother Cedric (2614,3259), forest north of the monastery | run north (he wanders) | | 48 route tiles | 25 (24) | measured |
| 11 | Cedric | he asks for water | 30 → 40 | 5 pages; `5c` | 6 (6) | measured |
| 12 | Cedric | water, then "Yes, I'd be happy to!" (the water and cart chats run as one, `brother_cedric.rs2:32-58`) | 40 → 60 | 11 pages + 1 option; `8c, opt, 3c` | 13 (13) | measured |
| 13 | Cedric | logs | 60 → 70 | 5 pages; `5c` | 6 (6) | measured |
| 14 | → Omad | run back | | 49 route tiles | 25 (23) | measured |
| 15 | Omad | 6 pages, then the party: dancing and balloons with the chat box closed, 34 ticks of `p_delay`, then the queued completion (`quest_drunkmonk.rs2:14-42`) | 70 → 80 | 6 pages; `6c` + 34-tick forced wait | 41 (56: Omad had wandered, approach 17) | measured |
| | | **Total** | | 64 clicks, 2 climbs, 1 pickup, 364 route tiles | **325** (320 + 5; run 1: 327 + 5) | measured |

## Tick total

| Part | Stock | Fixed | Burst | Label |
|---|---|---|---|---|
| Travel (teleport and 364 route tiles) | 202 | 202 | 202 | measured (`bot.walkTo`; chained clicks would save about 15) |
| Dialogue (7 conversations, 64 clicks) | ~137 | 73 | ~35 | fixed measured; stock = fixed + 1 per click (inferred); burst from the recorded runs with the CONVENTIONS.md rule (7, 2, 8, 1, 5, 1, 2 plus approaches) |
| Forced wait (the party) | 34 | 34 | 34 | measured; read 1 + 5x1 + 9x3 = 33 from the `p_delay`s |
| Interactions (2 climbs, 1 pickup) | ~15 | 11 | 11 | measured |
| Trade | 9 | 5 | 5 | measured, `primitives.md` |
| **Total** | **~397** | **325** | **~287** | |

## Marginal value

| Basis | Ticks saved | Source |
|---|---|---|
| Woodcutting from level 1 to 99 minus from 2,000 base to 99 (no other on-route Woodcutting quest xp) | **pending** | cairn://p/rs/6 (`woodcutting.md` not published at the time of writing) |
| Prior flat rate, 11.6 base per tick | ~170 | cairn://p/rs/main/task/per-skill; undervalues early levels, shown for scale only |

## Risks and gotchas

- **The party is a forced 34-tick wait.** It cannot be dodged by logging out: a logout
  waits while the player is delayed (`primitives.md` section 8), and the completion is
  a `queue` at the party's end.
- **Omad and Cedric wander.** In one run Omad's approach took 17 ticks instead of 2.
- **The thieves' cave** has two thieves and a head thief near the blanket
  (`maps/m40_150.jm2`); none attacked a 70-combat lab account in two runs.
- **Logout-safe:** `%drunkmonkquest` is `scope=perm`. The ladder is a
  temporary loc added by a timer that runs only after Omad's first talk
  (`brother_omad.rs2:36`); after a logout the timer is gone, so talk to Omad again or
  check the ladder before relying on it.

## Open questions

- The value: one subtraction once rs/6 publishes Woodcutting ticks from level 1 and from
  2,000 base. The rule above decides the verdict.
