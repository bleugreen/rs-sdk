# Brewer (`speedrun/helpers/brew.ts`)

The brewer makes the run's finished potions (SUPPLIES.md's potion line: H7, H12, H13, H23) on a
herb gatherer that has the Herblore for them, from that account's own bank, and stops once it
holds the target count of each. Role name `brew`; finite, so it can be borrowed with `then`.

```
ROLE_OPTIONS='{"targets":[{"potion":"prayer","doses":4,"n":4},{"potion":"superattack","doses":3,"n":1}],
               "receiveFrom":"cairn_h51"}' bun speedrun/helpers/brew.ts <account>
```

Labels as in herbs.md: **read** (content or engine), **measured** (lab at 300 ms, or the demo),
**inferred**.

## Why it works this way

- **Brewing makes 3-dose potions only** (read, `brew_potion.struct`: every mixture is a `3dose...`).
  A (4) comes from **decanting**, pouring one partial potion into another of its kind:
  (3)+(3) gives (4)+(2), and a pour with a (4) in it is refused (read, `decant_potion.rs2`). So n
  (4)s cost ceil(4n/3) brews, and a target asks for each potion as `doses: 3` or `doses: 4`. A (4)
  also counts toward a (3) target. rs/158 rules which ledger rows take (3)s: where a step drinks at
  most 2 doses and the slot is not binding.
- **No pour splits a potion** (read, `decant_potion.rs2` only combines two partials of a kind;
  an empty vial takes nothing), so a (1) or (2) target (H12's superantipoison pre-dose) is
  **drunk down** from a potion the (4)s and (3)s leave spare, the smallest spare that holds
  enough. The (4)s and (3)s a target asks for are never drunk, but any other potion of that kind
  the account holds is a spare: list it as a target to keep it. One (4) cannot become two (1)s,
  so the planner brews where the spares are too few (a held (2) and one brew make two (1)s).
- **Brewing, grinding and decanting carry no delay** (read, `herblore.rs2`), so the uses go out
  back to back, as the herb gatherer's mixing does.
- **Every unfinished potion is named "Unfinished potion"**, so every bank and inventory item is
  chosen by id (herbs.ts `UNF`).
- **Ranging (Herblore 72) and magic (76) potions are not on the list:** no helper has the level, so
  those come from the Grand Exchange only. The agility potion is left off as well: toadflax is not
  in the herb drop table (`shared_droptables.rs2`) and comes only from Brimhaven Agility Arena
  tickets. The only shop that sells a finished potion is Jiminua's store in Tai Bwo Wannai,
  which sells antipoison(3) (read, `karamja.inv`).

## Stages

Each cycle starts at the Falador west bank, banks everything carried, and plans from bank plus
inventory (`plan()`), so a restart resumes and potions already held count:

1. **Unicorn horns**, when horn dust (antipoison, superantipoison) is short: the two unicorns south
   of Edgeville at (3084,3454) and (3090,3450), one horn per kill (read, `unicorn.rs2`). The four
   west of Falador (2838-2863, 3370-3378) are off the walkable mainland: every path there ends at
   Taverley's south edge (2879,3393) (measured in the lab and with the SDK pathfinder).
2. **Pestle and mortar** from Jatix in Taverley, when none is owned.
3. **Grind** the horns.
4. **Mix** clean herbs with vials of water, only when the unfinished potions are short
   (marrentill, which the herb gatherer leaves unmixed).
5. **Brew**, up to 14 a bank visit.
6. **Decant**: pour the two fullest partials together until the (4)s are made, keeping the (3)s a
   target asks for.
7. **Drink down** the spares assigned to (1) and (2) targets, a dose at a time.
8. **Inputs it cannot get itself** (unfinished potions, snape grass, eyes of newt, limpwurt root)
   block only the potions that need them: everything else is made first. Then, with `receiveFrom`
   set, it waits at the bank for that account's trade (a `handover` donor), takes it and carries
   on; without one, or after `receiveMinutes`, it stops with `attention` naming what is short.
   Three bank visits with nothing changed also stop it.

## Options

| Option | Default | Meaning |
|---|---|---|
| `targets` | required | `[{potion, doses: 1 to 4, n}]` ((1)s and (2)s are drunk down, see above); potions: `prayer`, `antipoison`, `superantipoison`, `superattack`, `superstrength` |
| `receiveFrom` | none | A `cairn_` account that will trade the missing inputs |
| `receiveMinutes` | 45 | How long to wait for it |
| `hornsPerTrip` | 27 | Horns gathered per trip |
| `grind` | none | `["scales", "chocolate"]`: grind every held blue dragon scale (243 into dragon scale dust 241) and chocolate bar (1973 into chocolate dust 1975), after the horns the targets need. With `grind`, `targets` may be left out: a grind-only run for S25e's secondaries |

## Measured

- Lab (300 ms, Herblore 63, attempt 1's kit from nothing but the herbs and secondaries): **971
  ticks** end to end, of which the unicorn trip was 627 (two spawns, 6 kills), the pestle trip
  ~150, and the grinding, mixing, 14 brews and decanting ~85.
- Demo (cairn_h84, 2026-10-22 11:00-11:07Z): the same 13 brews (all but the super strength,
  waiting on its limpwurt) in **6 minutes** from Taverley dungeon.

## The draw on the scored account's Herblore stock

The brewer's unfinished potions and secondaries come out of the herb gatherer's bank, which also
holds H21e's stock. A draw is allowed only while the S25e planner on banked stock still reaches
Herblore 99 with at least 2,000 base xp spare after it (rs/158's rule). Attempt 1's kit draws
ranarr 6, irit 4, kwuarm 1, snape grass 6, eye of newt 1 and limpwurt 1, about 1,069 base xp;
marrentill and unicorn horn cost the planner nothing.
