# Jeweller (rings and amulets for enchanting)

`speedrun/helpers/jeweller.ts` (role `jeweller`) takes a fresh demo account to the
Crafting, Mining and Smithing levels it needs, makes its own gold bars, cuts the uncut
gems it holds or receives, and banks the scored run's enchanting loads: by default
**unnoted rings sapphire 12, emerald 27, ruby 16, diamond 5**, plus one strung sapphire
and one strung ruby amulet. It keeps the chisel, so the bank also holds the chisel the
Crafting step needs. The [enchant](enchant.md) role turns the two strung amulets into the
amulet of magic (H7) and amulet of strength (H22).

```
ROLE_OPTIONS='{"rings":{"emerald":27},"geBuy":{"emerald":15000}}' bun speedrun/helpers/jeweller.ts cairn_h80
```

## Options

| Option | Default | Meaning |
|---|---|---|
| `rings` | `{sapphire:12, emerald:27, ruby:16, diamond:5}` | Rings to hold. Keys left out keep their default. |
| `amulets` | `{sapphire:1, ruby:1}` | Strung amulets to hold. |
| `gold` | `mine` | `mine`: train Mining and Smithing to 40, mine gold ore at Rimmington and smelt it at Falador. `receive`: use only gold bars handed over by trade. |
| `couriers` | the mule's courier list | Account-name patterns whose trades are accepted (they give, the jeweller gives nothing). |
| `receiveMinutes` | `20` | How long to wait at Varrock west bank for couriers before re-planning. |
| `geBuy` | none | Gem to maximum price per uncut gem, for gems still missing after cutting everything held. Needs coins in the bank. |

## How a cycle works

Each cycle derives the next step from what it observes (levels, inventory, the last bank
snapshot), so the role restarts cleanly from any state, and products already made count
against the targets, so a restart never overshoots. The planner (`plan`, `nextStep`,
`withBankKnown`) is pure and covered by `jeweller.test.ts`.

1. **tutorial**: `bot.skipTutorial()`.
2. **wool**: Crafting 1 to 5 (gold rings need 5). Shears from the Lumbridge general store,
   the sheep north of Lumbridge, the castle's spinning wheel. The balls also string the
   amulets.
3. **smith**: Mining and Smithing 40 (gold rocks and gold smelting both need 40), by running
   the smelter role in `full` mode ([smelter.md](smelter.md)) until both are reached.
4. **tools**: chisel, ring mould and amulet mould from Rommik in Rimmington.
5. **gold** and **smelt**: Rimmington's two gold rocks, the Falador furnace's Smelt 10,
   Falador west bank.
6. **train**: Crafting 5 to 20 on plain gold rings (7 bars from Crafting 6 on h80).
7. **cut**: uncut gems to cut gems at the bank, only as many as the remaining products use.
   Cutting comes before crafting, so the cuts alone carry Crafting past each product's level.
8. **craft** and **string**: rings and amulets at the Falador furnace, 13 per trip.
9. **receive**: anything still missing. Wait at Varrock west bank for courier trades (gems,
   gold bars, coins) and buy missing gems on the GE (`geBuy`).

While the bank is unseen (after a start, a relog, or the smelter phase) every step that
decides from bank counts first takes a **look** step: open Falador west bank, deposit, read
it. Without it, banked balls of wool read as missing (another shearing trip) and banked
gems as missing (a 20-minute courier wait).

**Levels** (`jewellery` structs, `gem.dbrow`): sapphire 20, emerald 27, ruby 34, diamond 43,
the same for cutting the gem and making its ring; sapphire amulet 24, ruby amulet 50; gold
ring 5. At the demo's 25x the default load's cuts take Crafting from 20 to about 51 (about
111k xp), and its rings to about 64 (another 88k).
**Gold bars**: one per ring or amulet (62 for the default load) plus the training rings, so
about 69 from a fresh account. Nobody sells gold bars or gold ore on the GE, and the
Dwarven Mine and Port Sarim shops list them at base stock 0.

## Where gems come from

Surveyed from `server/content` for cairn://p/rs/121 (the full table with file and line
references is in that issue's reports 1a, 1b and the Shilo correction).

- **The Shilo Village gem mine** (7 gem rocks, 1/32 of gems are diamonds) is the only
  real diamond source, about 12-13 diamonds per hour for the whole mine, capped by rock
  respawn and shared by every player. It needs **Shilo Village complete**: the inner
  wooden gate refuses un-quested players (`quest_zombiequeen.rs2`), and the bank and rocks
  are behind it. Shilo needs Jungle Potion and Druidic Ritual, none of them scripted.
- **Without the quest, every free source is the per-swing random gem roll while mining
  any ore** (`mining.rs2`, 1/256 per swing, 1/86 with a charged glory). Measured on the
  fleet's smelter miners cairn_h20-h23 (Mining Guild, contended rocks): **1.6 uncut gems
  per account-hour** (sapphire 0.8, emerald 0.55, ruby 0.13, diamond 0.16). An uncontended
  miner's bound is about 7 gems per account-hour.
- Monster jewel drops, the Ardougne gem stall (Thieving 75, 600-tick respawn) and big-net
  caskets are each well under 0.2 diamonds per account-hour. The gem shops start at stock 0.
- **Ruby rings without rubies**: Zanaris's `cheapringshop` sells ruby rings (stock 5,
  restock 500 ticks, `lostcity.inv`), but needs Lost City.
- **GE (2026-10-21)**: uncut emeralds offered at 15,000; uncut diamonds at 25,000; no
  uncut ruby sellers, only a standing bid wall at 10,000 that sellers fill regularly, so a
  resting bid just above it is first in line.

So 391 uncut diamonds is not reachable in a reasonable time without Shilo Village, and
even with it is about 30 hours of the whole mine. The ring loads are the part this role
owns; the fleet's stock covers the sapphires and diamonds, and emeralds and rubies come
from couriers, the GE, or the role's own random gems while it mines gold.

## Getting gems and coins to it

The receive step accepts trades from `couriers` and gives nothing back, so any account
that can walk to Varrock west bank can deliver. The gold step accepts them too, between
rocks, so while the role is mining a courier can deliver at Rimmington's gold rocks
(`meet` 2976,3235) instead of waiting for the bars to be finished. Deliver noted where you
can: a trade lands in an inventory that is filling with ore, and notes take one slot
each (the next bank visit unnotes them). For exact amounts from a fleet account the
simplest route stays inside the fleet: assign it the `handover` role
(`speedrun/helpers/handover.ts`, `{meet:{x:3185,z:3436}, handovers:[{to:"cairn_h80",
items:[{item:"Uncut emerald",n:9}]}]}`) with `--return`, and the fleet gives it its role back when the handover finishes. For whole stacks or
coin funding, the delivery is one trip outside the fleet: take the account out (`fleetctl assign <acct> <role> --disable`,
`reload`), log it in on another gateway, run `courierTrip` (mule.ts; options
`{mule:"cairn_h80", items:["^uncut "]}`) or `fundTrip` (bidder.ts; options
`{bidder:"cairn_h80", keep:1000}`), log it out with `logoutClean`, and give it its role
back. The fleet itself cannot run either trip: it loads only the `role` export of
`<name>.ts`. Two traps:

- **Underground accounts.** A smelter miner may be in the Mining Guild cellar or the Dwarven
  Mine, separate maps the pathfinder cannot route out of. Climb out first with
  `climbToSurface` (`speedrun/lib/underground.ts`; `travelTo` does it on its own).
- **Stale state on return.** When the account rejoins the fleet, the fleet gateway first
  hands its role the state published before the trip. The `coins` role started on that
  (coins and kebabs it no longer carried) and idled. Restarting the role (any options
  change plus `reload`) fixes it.

h80 can take an early receive window with `gold: "receive"`, which skips Smithing and
gold and goes straight to Varrock; switch back to `mine` afterwards.

## Measured on the demo

cairn_h80 on rs-sdk-demo.fly.dev, 2026-10-21, through a loopback gateway on bbs
(`tmux -L rs41-gems`, 127.0.0.1:7752):

| Step | Result |
|---|---|
| tutorial, wool | Tutorial skipped, shears bought, wool sheared and spun to Crafting 6: 15:00-15:04 UTC |
| smith | Mining 1 to 70 and Smithing 1 to 29 in about 65 minutes of the smelter phase (bought an adamant pickaxe on the way) |
| look after a restart | About 45-60 s to Falador west bank and back to the right step |
| tools | Chisel from Rommik in under a minute when already nearby |
| receive | Two courier trades and four fund trades in 11 minutes; each fund trade took about 1 minute from the earner's login |
| smith (to 40) | Smithing 29 to 40 in about 6 minutes of steel bars |
| gold | 6 trips, 16:27-17:25 UTC: 67 gold ore (9-14 per trip, about 9.5 minutes each), smelted into 69 bars, Smithing 40 to 57. **About 70 bars per hour.** Every trip ended on its 1,200-tick budget for waiting on depleted rocks: Rimmington's two gold rocks had 7-16 other players in view |
| train, cut, craft, string | 17:25-17:29 UTC, about 4 minutes in all: 7 gold rings (Crafting 6 to 20); cut 13 sapphires, 11 emeralds, 5 rubies, 3 diamonds (to 57); crafted 12 sapphire, 11 emerald, 5 ruby, 3 diamond rings and the sapphire amulet, strung it (to 65) |

Again on 2026-10-23 for attempt 3 (cairn://p/rs/630), h80 at Crafting 80, Mining 81, Smithing 59,
with gems handed over at the rocks during its gold trips: 53 bars in 5 trips, 20:13-21:06 UTC
(14, 12, 9, 12 and 5 ore; 6-15 players in view, so **about 75 bars per hour**), then all 60
gems cut and the 60 rings crafted in 5 minutes (Crafting 80 to 88).
And on 2026-10-24 for attempt 4 (cairn://p/rs/678): 60 bars in 7 trips, 03:26-04:35 UTC (13, 8, 7, 11,
11, 7 and 3 ore; 12-18 players in view), so **about 52 bars per hour** when the rocks are
busy. Plan on 50-75 bars per hour, not the upper figure alone.

So a fresh account with the gems in hand takes about 2 h 30 min, nearly all of it
Smithing and Mining training (about 75 minutes) and gold (about 60 minutes). An account
that already has Mining and Smithing 40, or gold bars handed over (`gold: "receive"`),
needs well under an hour.
