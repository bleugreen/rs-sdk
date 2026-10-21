# Priest in Peril

**About 840 ticks (4.2 minutes at 300 ms), inferred, for 1,406 base Prayer, 1
quest point and the only way into Morytania.** On its own xp it is poor (about
1.7 base xp per tick); it is worth doing for what it unlocks, Haunted Mine's
22,000 base Strength first ([haunted_mine.md](haunted_mine.md)), so read the two
as one 2,040-tick block worth 23,406 base xp. Two Varrock round trips and the
43-page cell conversation are most of the cost. If the quest is started while
the route passes King Roald anyway, step 1 costs only its dialogue.

This quest was **not run end to end in the lab**. Dialogue counts are read from
the scripts and costed at the measured 2 ticks per page or choice plus 2-3 per
conversation ([primitives.md](primitives.md) §1); route lengths are pathfinder
routes measured offline with `docs/speedrun/scripts/quest-priestperil-routes.ts`
(Chebyshev tiles at the measured 0.5 ticks per tile); the iron-key monument was
checked in the lab with the same script. Everything else is labelled.

## Reward

- **1,406 base Prayer**: `stat_advance(prayer, 14060)` in the completion queue
  (read, `quest_priestperil/scripts/priestperil.rs2:7-11`).
- **1 quest point** (read, `general/configs/quest.constant:114`).
- The Wolfbane dagger (`priestperil.rs2:8`).
- **Morytania**: the holy barrier in the mausoleum lets you through only at
  `%priestperil` = 61 (`area_mausoleum/scripts/holy_barrier.rs2:1-9`), and 61 is
  set by talking to Drezel once more **after** completion (stage 60,
  `quest.constant:47`; `drezel.rs2:138-147`). Haunted Mine has no other gate
  (`haunted_mine.md`).

## Requirements (as this server enforces them)

- **None.** King Roald starts it with no check, not even members
  (`king_roald.rs2:37-41`); no script in `quest_priestperil/` or
  `area_mausoleum/` calls `stat()` or `stat_base()` as a requirement. The only
  calls are in the Zamorak monks' attack scripts, where they choose between
  weaken, confuse and curse (`evil_monks.rs2:7-31`).
- **Stage gates that shape the route:** the temple doors open from outside only at
  stage 4 or more (`temple_doors.rs2:10`); the dog can be attacked only at stage 2
  (`temple_guardian.rs2:14-22`); gate 1 in the mausoleum needs stage 5, gate 2
  stage 8 (`gates.rs2`); the golden key drops from the level-30 monk only below
  stage 6 (`evil_monks.rs2:49`); the cell door takes the iron key
  (`trapped_drezel.rs2:39-51`).
- **Items the steps check:** a bucket for the well (`well.rs2:8-15`); the
  golden key swapped at a monument for the iron key (`monuments.rs2:59-77`);
  murky water used on Drezel to bless it (`trapped_drezel.rs2:26-29,147-153`);
  blessed water on the coffin (`vampire_coffin.rs2:8-17`); **50 unnoted rune
  essence** given to Drezel in the mausoleum. Noted essence is refused with a
  joke line (`drezel.rs2:75-81`); each unnoted one moves the stage up by one, from
  10 to 60 (`drezel.rs2:83-107`).

## Items: helper-supplied and scored-account-only

| Item | Tradeable | Source |
|---|---|---|
| Rune essence × 50, **unnoted** | yes (`ores.obj`, no `tradeable=no`) | helper |
| Bucket | yes | helper |
| Weapon (and runes for Varrock teleport × 1) | yes | helper |
| Golden key | **no** (`priestperil.obj`) | kill the level-30 Monk of Zamorak |
| Iron key | **no** | swap the golden key at monument 3 |
| Murky water, blessed water | **no** | the well, then Drezel |
| Wolfbane dagger | **no** | reward |

**The essence.** No step needs more than 2 free slots, so the scored account can
carry 26 unnoted essence through the whole quest (bucket, key and 26 essence =
28; weapon worn, no food needed at 70 melee) and needs only one more trade of
24 at Drezel. Trades cost 9 ticks each (`primitives.md` §6). A helper can reach
Drezel's room only through the east trapdoor on the Morytania side, i.e. a
helper that has itself finished Priest in Peril (inferred from the gates above
and `holy_barrier.rs2:11-20`). Without such a helper: 26 at the start and a
second 24 brought in after leaving for a bank, which is far more expensive.

## Step list

Quest varp `%priestperil` (perm), stages from `priestperil.constant`: 0, 1
started, 2 agreed to kill the dog, 3 killed the dog, 4 told off by Roald, 5
looking for the key, 6 unlocked Drezel, 7 poured the water, 8 meet in the
mausoleum, 10-60 essence given, 60 complete, 61 barrier access. The monument
layout and swaps live in `%priestperilvar` (perm).

Page counts are the `~chatnpc`/`~chatplayer`/`~mesbox` lines the player sees up to
the line that sets the stage; you can walk away from the rest. Dialogue ticks =
2 × (pages + choices) + 3.

| # | Where | Action | Varp | Raw counts | Ticks | Label |
|---|---|---|---|---|---|---|
| 0 | anywhere | Trade: 26 essence, bucket, teleport runes | | 1 trade | **9** | measured primitive |
| 1 | Varrock teleport → King Roald (3222,3476) | Teleport, run into the palace | | 1 teleport, 58 tiles | **34** | inferred |
| 2 | King Roald | "Greetings", "Sure." (`king_roald.rs2:47-55`, `priestperil.rs2:1-5`) | 0 → 1 | 10 pages, 1 choice | **25** | inferred (read counts) |
| 3 | → Paterdomus temple doors (3408,3488) | Run east | | 230 tiles | **116** | inferred |
| 4 | Temple doors | Knock-at: "Roald sent me to check on Drezel.", "Sure." (`temple_doors.rs2:20-82`) | 1 → 2 | 12 pages, 2 choices | **31** | inferred |
| 5 | → Mausoleum trapdoor (3405,3507) | Run north, open, climb down to (3405,9906) | | 18 tiles, 1 open, 1 climb | **14** | inferred |
| 6 | Temple guardian (3405,9902) | Kill it (below) | 2 → 3 | 3 tiles, 1 fight | **37** | inferred |
| 7 | Ladder (3405,9907) → King Roald | Climb, Varrock teleport, run (walking is 244 tiles, 123 ticks) | | 1 climb, 1 teleport, 58 tiles | **36** | inferred |
| 8 | King Roald | Tell him (`king_roald.rs2:69-79`) | 3 → 4 | 10 pages | **23** | inferred |
| 9 | → Temple doors | Run east again, open the doors | | 230 tiles, 1 door | **118** | inferred |
| 10 | Staircase (3417,3484), ladder (3410,3485) | Up to Drezel's floor | | 21 tiles, 2 climbs | **15** | inferred |
| 11 | Cell door (3415,3489) | Talk-through: "Tell me anyway.", "Yes." Stage 5 is set only on the long branch (`trapped_drezel.rs2:59-141`; "You're right, we don't" never sets it) | 4 → 5 | 41 pages, 2 choices | **89** | inferred |
| 12 | Monk of Zamorak, level 30 (on each floor, e.g. (3416,3491)) | Kill it, pick up the golden key | | 1 fight, 1 pickup | **17** | inferred |
| 13 | → Mausoleum trapdoor → ladder foot | Down the ladder and stairs, out, down | | about 38 tiles, 4 climbs | **25** | inferred |
| 14 | Gate 1 (3405,9895) → monument 3 (3428,9890) → well (3423,9890) → ladder | Golden key on monument 3 (no studying, below); bucket on the well | | 1 gate, 99 tiles, 2 interactions, 1 climb | **62** | key swap measured (5); rest inferred |
| 15 | → Cell door | Back up to Drezel's floor | | about 38 tiles, 4 climbs | **25** | inferred |
| 16 | Cell door, Drezel, coffin (3413,3486) | Iron key on the door; murky water on Drezel; blessed water on the coffin; talk | 5 → 6 → 7 → 8 | 4 pages, 3 interactions | **20** | inferred |
| 17 | → Drezel in the mausoleum (3440,9895) | Down to the mausoleum, through both gates | | about 101 tiles, 4 climbs, 2 gates | **61** | inferred |
| 18 | Drezel | Talk (`drezel.rs2:30-48`) | 8 → 10 | 16 pages | **35** | inferred |
| 19 | Drezel | Use 26 essence on him, trade 24 from the helper, use them, final lines; completion queue | 10 → 36 → 60 | 2 interactions, 1 trade, 3 pages | **24** | inferred |
| 20 | Drezel, holy barrier (3440,9886) | Talk again (`drezel.rs2:138-147`), pass through to (3423,3485) | 60 → 61 | 8 pages, 8 tiles, 1 interaction | **25** | inferred |

**Monument 3, deterministic (measured).** The monument contents come from a
layout seed that is randomised only when you *study* a monument
(`monuments.rs2:16-21,40-42`); taking or swapping doesn't touch it. A player who
never studies keeps seed 0, which puts the iron key in
`priestperil_grave_base3`: `(0 + 3 × 17) mod 7 + 1 = 3 = pipkey_iron`
(`priestperil.enum:23-31`), the monument at (3428,9890). Lab check: golden key
used on it with `%priestperilvar` 0, "You swap the Golden key for the Iron
key.", 5 ticks.

## Fights

At 70 melee with helper-supplied gear and no food:

- **Temple guardian** (`priestperilguarddog`): combat 30, 45 hitpoints, Attack,
  Strength and Defence 20, size 2, stab (`priestperil.npc:83-103`). About 8
  scimitar swings, **about 35 ticks** (inferred). Its death hands the stage over
  through `p_finduid` with a queued fallback (`temple_guardian.rs2:1-12`), so the
  kill can't be lost. Minimum: any account that can kill a level-30.
- **Monk of Zamorak**, level 30 (`priestperilevilmonk3`): 25 hitpoints, Attack,
  Strength and Defence 25, Magic 40, sometimes zaps for up to 8
  (`evil_monks.rs2:38-45`). **About 15 ticks** (inferred). The golden key is
  dropped for the player it fought (`evil_monks.rs2:47-49`).

## Tick total

| Category | Ticks | Basis |
|---|---|---|
| Travel (runs, climbs, doors, gates, two teleports, the barrier) | **506** | inferred: offline route tiles × 0.5 + measured primitives |
| Dialogue | **248** | inferred: read page counts × 2 + 3 per conversation |
| Interactions (2 trades, key swap, well, coffin, essence gives, pickup) | **37** | trades and key swap measured, the rest inferred |
| Fights | **50** | inferred |
| Forced waits | **0** | read: no `p_delay` longer than a climb in the route |
| **Total** | **841** | inferred |

Dialogue is 30% of the quest. At the patched-client floor (cairn://p/rs/22) it
halves, saving about 110 ticks; a blind-continue client (`primitives.md` §1)
would save most of the rest, the 41-page cell conversation in particular.

## Risks and gotchas

- **The cell conversation has a dead-end branch.** "You're right, we don't."
  ends without setting stage 5; only "Tell me anyway." then "Yes." does.
- **Don't study the monuments.** Studying randomises the layout, and then the
  iron key could be in any of the seven.
- **Monks of Zamorak** fight back and cast weaken/confuse/curse; at 70 melee
  they are harmless, but a monk fight can interrupt the climb to Drezel.
- **Noted essence is refused**; the helper must trade it unnoted.
- **Logout-safe throughout**: `priestperil` and `priestperilvar` are permanent
  (`priestperil.varp`). The open trapdoor shuts again after 500 ticks
  (`holy_barrier.rs2:14`), costing one more open.
- **Barrier access needs the extra talk** (stage 61) after the quest completes.

## Open questions

- A lab run end to end, to replace the inferred figures (especially the two
  fights and the climbs inside the temple).
- Whether a helper can stand next to Drezel in the mausoleum for the essence
  trade without having finished the quest itself (I inferred that it can't).
- Whether the Varrock teleport landing is the best way to Roald for the scored
  account at that point in the route, or the quest should be started while
  passing the palace earlier.
