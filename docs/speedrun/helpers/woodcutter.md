# woodcutter

`speedrun/helpers/woodcutter.ts` takes a brand-new demo account to the
Woodcutting level it needs and stockpiles logs in its bank for the scored
account's Firemaking (and later Fletching). Magic logs are the long pole; every
lower tier is banked on the way up as a by-product.

## What it does

| Phase (`ctx.log('phase')`) | Where | What |
|---|---|---|
| `tutorial` | Tutorial Island | `bot.skipTutorial()` |
| `train-hitpoints` | Lumbridge cow pen | Auto-retaliate off, run on, Strength style; kill cows until Hitpoints 30 (`crossingHitpoints`) |
| (no phase) | Draynor bank, Bob's Brilliant Axes | Bank the starter kit, so a death keeps the axe; buy the best axe the coins afford (a fresh account: bronze, 16 gp) |
| `trek` | Lumbridge -> Taverley -> Seers' Village | Over White Wolf Mountain, the only land route into Kandarin for a fresh account |
| `chop-<tier>` | Seers' Village and Catherby | `auto`: the best tier the level allows, moving up as it levels; banks only when the pack is full |
| `axe-upgrade` | Seers bank -> Arhein (Catherby) -> Bob (Lumbridge) -> Seers | Once, on reaching magic with a worse axe than steel: sell banked yews for 200 gp, buy Bob's steel axe, cross back |

Every bank visit calls `ctx.reportBank`. While chopping it logs a `chopping`
line every 2,000 ticks (10 minutes) with the logs carried, because a magic trip
can outlast the fleet's 20-minute stall window. A `trip` line after each bank
visit carries the logs banked, ticks, contention counts and running logs per
hour.

### Spots

Everything banks at Seers' Village (booths 2721-2729,3494) except the Catherby
spots (Catherby bank 2809,3439). Spot ids, in preference order per tier:

| Tier (level) | Spots | Notes |
|---|---|---|
| magic (75) | `seers-magic-north` (3 trees, ~74 tiles from the bank), `seers-magic-south` (4 trees, ~118) | The only magic trees outside quest areas: the others are in the Gnome Stronghold (bank upstairs) and Tirannwn (Regicide) |
| yew (60) | `catherby-yews` (7), `seers-yews` (3) | |
| maple (45) | `seers-maples`, `seers-maples-south` | |
| willow (30) | `seers-willows`, `catherby-willows` | |
| oak (15), normal | `seers-oaks`, `catherby-oaks`, `seers-trees`, `catherby-trees` | |

All stand tiles were checked offline with `sdk/pathfinding` (walkable, path
from the bank). At a spot the role picks the standing tree with the fewest other
players on it, clicks once and lets the server loop the chop, re-clicking on a
stump, a dialog, or 6 idle ticks. When every tree at the spot is a stump for 10
ticks, or every standing tree has 2 or more other players for 30 ticks, it moves
to another spot of the tier only if that spot visibly has a standing tree (a
40-tile scan sees both Seers magic clusters), or if it is out of sight and was
not given up within one respawn time. Otherwise it waits where it is: moving
blindly made accounts ping-pong between bare spots and arrive late to every
respawn.

## Options

| Option | Default | Meaning |
|---|---|---|
| `tree` | `auto` | `auto`, or one of `normal`, `oak`, `willow`, `maple`, `yew`, `magic`. A fixed tier above the account's level trains on `auto` until it is reached, then chops only that tier. |
| `location` | `''` (every spot) | A spot-id prefix: `seers`, `catherby`, or one spot id such as `seers-magic-north` to pin the account there (no spot moves then). Use it to spread accounts. |
| `target` | none | Stop once the bank holds this many logs of the chosen tier (`auto` counts magic logs). |
| `buyAxe` | `true` | Buy axe upgrades at Bob's when on the Lumbridge side, and make the one-off steel-axe trip at the magic tier. |
| `crossingHitpoints` | 30 | Hitpoints to train on cows before the first crossing. 0 skips it. |

## Engine facts it leans on

- **Axes.** No Woodcutting requirement in this revision, and an axe in the
  pack works: `woodcutting_axe_checker` takes the best of worn and carried,
  rune first. Wielding needs the Attack level, which a helper never trains, so
  the steel axe rides in the pack.
- **Chop rolls.** One roll every 4 ticks; a log when
  `floor(lo*(99-L)/98) + floor(hi*(L-1)/98) + 1` beats a random byte
  (`trees.dbrow` successchance). On a magic tree at level 75 that is 5/256 with
  bronze, 7 iron, 10 steel, 17 rune (`chopChance` in the role, unit-tested).
- **Depletion.** Each log has a 1/8 chance to fell the tree for everyone; it
  regrows after `respawnrate` ticks: magic 400, yew 200, maple 120, willow and
  oak 30.
- **Shops.** Arhein's general store (Catherby, beside the bank) pays
  `max(100, 400 - 30*held)/1000` of an item's value, so yews (value 160) fetch
  64, 59, 54, 49 gp. Three yews plus the starter 25 gp buy Bob's 200 gp steel
  axe. No axe above bronze is listed on the Grand Exchange (rune has a 100k bid
  and no seller), and the only Kandarin shop selling steel axes is the Combat
  Training Camp armoury past Ardougne, so the upgrade is Bob's.
- **xp.** 25x on the `2^(L/10)` curve, so Woodcutting 75 is minutes of yews.
  Random events are off on the demo.

## White Wolf Mountain

The crossing passes the White wolf sentries twice and the wolf pack once
(wolves hit 2-4, the level-73 Big Wolf up to 7, wanderrange 20). The dwarf
tunnel needs Fishing Contest, which can only be done on the far side.

| Setup | Result |
|---|---|
| 10 HP, auto-retaliate on | 4 deaths in 4: a hit queues `p_opnpc` and replaces the walk with a fight |
| 10 HP, auto-retaliate off, running | 2 deaths in 2 (10-17 damage per attempt, observed tick by tick) |
| 30 HP, auto-retaliate off, running | 10 successes, 3 deaths (arriving with 7-24 HP), including 4 axe-upgrade return trips |

A death costs about 2 minutes and keeps the axe (the starter kit is banked
first). Training 10 -> 30 HP on cows took 661-1,488 ticks (19-31 kills). More
hitpoints would not pay back at this death rate.

## Measured on the demo (2026-10-21, from bbs, 300 ms ticks)

### Fresh account to level

| Account | First login | HP 30 | At Seers | WC 60 | WC 75 |
|---|---|---|---|---|---|
| cairn_h13 | 05:56 | +5.4 min | +9.2 min | +17 min | +62 min |
| cairn_h12 | 05:01 | | (crash restart) | +33 min | +51 min |
| cairn_h11 | 04:47 | +6 min | +11 min | +32 min | +53 min |

So about **20 minutes to Woodcutting 60 and 50-60 minutes to 75**, then about
6 minutes for the steel axe. Yews 60 -> 75 took 18-22 minutes at an
uncontended spot and 45 minutes for h13, which spent its first 25 minutes
ping-ponging between bare yew spots (since fixed).

### Logs per account-hour

| Tier | Axe | Rate | Contention |
|---|---|---|---|
| magic | bronze | 21-36 | 15-22 other players within 5 tiles of the cluster |
| magic | steel | **55-74** (three 27-log trips: 56, 74, 55) | 12-27 others within 5 tiles; up to 26 on one tree |
| yew | bronze | 72-133 at Seers; 332 and 892 at Catherby when nobody else was on the tree | Seers 33-43 others around the 3 trees; Catherby went from empty to 60-80 players within half an hour |
| willow / maple | bronze | 200-340 (training trips) | |

The steel-axe upgrade trip took 5.8-6 minutes (4 runs: h10, h11, h12, h13).

### Contention at the magic trees

The Seers magic trees are camped: 15-27 other players stand at each cluster,
and nearly every regrown tree is felled within a minute. Each log goes to
whoever's roll lands first, so an account's share of a tree is roughly its
`chopChance` over everyone's. The seven trees produce at most about 8 logs per
regrowth, around 1,600 magic logs an hour for the whole server, and our three
steel accounts took about 180 of them. While our accounts are a small part of
the crowd, each extra one adds roughly its own 55-75 per hour rather than
taking from ours, so they do not meaningfully contend with each other, and the
north and south clusters measured the same.

For the fleet: **2-4 woodcutters on magic, split across the clusters with
`location`** (`seers-magic-north`, `seers-magic-south`). More would crowd a
contested spawn, which the etiquette rules out, and a rune axe (3.4x bronze)
would be worth more than extra accounts if one ever appears on the exchange.

### Against buying

Magic logs sell for about 2,250 gp on the exchange (35k listed). The coin role
earns 57-88k gp per account-hour (`coins.md`), which buys 25-39 magic logs; a
steel-axe woodcutter chops 55-75. So chopping is about twice as good per
account-hour once the account is levelled, and doesn't drain the market. Yews
list at about 400 gp (55k listed), so buying them is competitive with chopping.

## Running it

Standalone (the lite client must already be running for the account):

```
ROLE_OPTIONS='{"location":"seers-magic-north"}' bun speedrun/helpers/woodcutter.ts cairn_h10
```

In the fleet: `fleetctl assign <account> woodcutter --options '{"location":"seers-magic-south"}'`
and `fleetctl reload` (see HELPERS.md).

## Gotchas

- Auto-retaliate must be off before any walk past aggressive NPCs: one hit ends
  the walk. The role turns it off (component 151) at every start.
- A restart anywhere is safe: mid-trip it keeps chopping with what it carries;
  mid-upgrade it banks or carries the coins and finishes the trip. Restarted
  roles redo the one-off upgrade check, which costs nothing once steel is held.
- Bank banking is the stock `bot.depositItem` loop (27-110 ticks per trip). A
  trip is 20-30 minutes at magic, so switching to `speedrun/lib/bank.ts` would
  save under 1%; it is left for later.
