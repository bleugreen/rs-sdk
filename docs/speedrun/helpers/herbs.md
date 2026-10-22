# Herb gatherer (`speedrun/helpers/herbs.ts`)

The herb gatherer supplies the scored account's Herblore: unfinished potions and the eyes of
newt that finish the guam and irit ones. A helper kills chaos druids for herbs, does Druidic
Ritual, identifies the herbs and mixes them with vials of water at the bank, and buys and fills
vials and buys eyes of newt at Jatix's shop in Taverley. It is built on the bone collector's
combat engine (`bones.ts`: tutorial, combat training on cows, eating, fighting, looting,
banking), pointed at a chaos-druid spot. Role name `herbs`; it produces herbs, unfinished
potions, clean leaves, vials of water and eyes of newt.

```
bun speedrun/helpers/herbs.ts <account>                                         # standalone
ROLE_OPTIONS='{"spot":"chaos_druids_taverley","food":"none"}' bun speedrun/helpers/herbs.ts <account>
```

Labels: **read** (from the content or engine), **measured** (local engine on bbs at the demo's
~300 ms tick, so wall-clock rates carry over), **inferred** (estimated, not run).

## What the run needs

The manifest's supply-safe list was 41 guam and 405 irit unfinished potions. Irit is 8 of every
128 herb drops (read, `shared_droptables.rs2` `randomherb`), no shop sells it and the GE has never
traded it, so that list is a ~14,600-kill line. The run instead takes **the whole herb-table mix**
(`docs/speedrun/research/supply-fallbacks.md` section 5, rs/129): ~654 unfinished potions of
guam, tarromin, harralander, ranarr, irit, avantoe and kwuarm from ~891 herb drops, at a cost of
~+85 scored ticks against the irit list. The role's default mix list is exactly those seven
herbs, best potion first. Marrentill, cadantine, lantadyme and dwarf weed are banked unmixed:
their secondaries are scarce.

## Stages

Chosen afresh from observed state every cycle, so a restart resumes where the account is.

1. **Tutorial, combat training, kit** (`bones.ts`): train melee on cows to `train` (default 40).
2. **Druidic Ritual** (unless `ritual:false`): the four raw meats (cow, chicken, bear and giant
   rat near Lumbridge), Kaqemeex, Sanfew upstairs in the house with Jatix's shop, the Cauldron of
   Thunder in Taverley dungeon (each of the first two door opens animates a suit of armour, which
   the role fights), Sanfew, Kaqemeex. Done when Herblore is above 1. Measured end to end in the lab.
3. **Farm** the spot (`bones.ts` fight loop), looting herbs, vials of water, coins, law and nature
   runes, snape grass and limpwurt root.
4. **Process** after each bank visit: identify every herb the level allows, then mix the
   highest-level herb on the list that the level allows with vials of water, 14 at a time.
   Identification xp carries the gatherer from the ritual's level to the 45-55 that irit,
   avantoe and kwuarm need; unidentified herbs wait in the bank until then.
5. **Shop trip** from the Falador west bank (Taverley spot only) once the bank's needs reach
   `supplyBatch`: a vial of water for every herb on the mix list that is not in a vial yet, and an
   eye of newt for every guam and irit (herb or unfinished potion). One trip withdraws the coins
   and any banked empty vials, buys empty vials and then eyes of newt with the bag space left,
   fills the vials at the fountain north of the shop, and banks.

## Options

The bone collector's options (`train`, `food`, `eatAt`, `styleCap`, `trace`, ...) plus:

| Option | Default | Meaning |
|---|---|---|
| `spot` | `chaos_druids` | `chaos_druids_taverley` (6 spawns, Falador west bank, shop trips) or `chaos_druids` (Edgeville dungeon, 11 spawns, Wilderness 1-3, no shop trips) |
| `ritual` | true | Do Druidic Ritual before farming |
| `process` | true | Identify and mix at the bank |
| `unf` | the seven-herb mix | Herbs to mix, any of `guam marrentill tarromin harralander ranarr irit avantoe kwuarm` |
| `supply` | true | Shop trips to Jatix |
| `supplyBatch` | 20 | Vials plus eyes of newt wanted before a trip starts |
| `eyes` | one per guam and irit | Fixed eye of newt target instead |
| `reportMinutes` | 10 | Interval of the `herbs` rate report |

Use the Taverley spot for the account that processes (Druidic Ritual, Jatix, mixing). Shop
trips start only at the Falador west bank, so an Edgeville account banks its herbs and looted
vials unmixed until it is switched to the Taverley spot.

**Gather-only** (a borrowed combat account with no Druidic Ritual): `{"spot":"chaos_druids",
"fish":false,"food":"none","ritual":false,"process":false,"supply":false}`. `food:"none"` is
needed: without it the role fetches a fishing net (phase `kit:net`) before it farms. Food
already carried stays carried on every bank visit unless `keepFood` caps it (the bone engine's
option: most food left carried, the rest banked). A coin earner borrowed with 24 kebabs has
3 free slots and banks every 3 drops (measured, cairn_h51: ~31 herbs an hour against ~100-120
for the others), so give it `keepFood` around 10: about 17 free slots, still a small herb load
for the Wilderness. `maxCarry` (the bone engine's: bank once that many herbs are carried) caps
the load directly whatever the food; rs/41's Wilderness rule is about 10. The grimy herbs are identified and mixed later by an account with the ritual.

## Measured rates

Lab, 50-67 melee with an adamant longsword, per-fight trace (`trace:true`):

| Spot | Ticks per kill incl. banking | Kills / account-hour | Herbs / account-hour | Irit / account-hour |
|---|---|---|---|---|
| Taverley dungeon | 37 | ~320 (~215 at 48 melee) | ~155 | ~10 |
| Edgeville dungeon | 59 | ~200 | ~100 | ~6 |

- A kill is 20-50 ticks of fighting at either spot, and 4-5 free druids are always in view at
  Taverley, so the rate is **bound by damage, not by respawns** (Taverley's ceiling is 6 spawns
  per 50 ticks, ~1,440 kills/h). At Edgeville the bot's HP drained to 22% and it stopped to rest.
- Herbs per kill measured 0.48 (read: 0.445, with 11/128 kills dropping two). Vials of water drop
  0.08 per kill, so ~85% of the vials are bought.
- **The whole mix (~891 herb drops) is ~5.7 Taverley account-hours** (inferred from the rates).

### On the demo (2026-10-22, measured)

- **Taverley is shared, and a shared druid drops for someone else.** A drop goes to the player
  who did the most damage (`npc_findhero`). Over 13.6-18.9 hours cairn_h84 and cairn_h85 made
  282-345 kills an hour but looted only 0.127 herbs a kill (35-47 herbs an account-hour); law
  and nature runes came in at the same ~30%. With four of our 99-melee accounts there after
  13:18Z it collapsed: two of them looted nothing at all in 25 kills each ('Someone else is
  fighting that'), and h84 fell to 95 kills and 8 herbs an hour. Keep at most one account on
  Taverley's six spawns.
- **Edgeville dungeon, gather-only, 99 melee: the table rate.** The first banks of cairn_h41
  and cairn_h45 were 0.43-0.64 herbs a kill (16 herbs in 32 kills), against the table's 0.445.
  The room is in Wilderness levels 1-3.

Shop trips (lab):

- 27 empty vials: **64 gp, 329 ticks** from the Falador west bank through Jatix and the fountain
  and back. Eyes of newt ~3.4 gp each, ~150 ticks per bag.
- The whole line (inferred): ~650 vials in ~24 trips (~40 min of one account, ~1.6k gp), and
  ~278 eyes of newt (~1k gp) in the same trips. Jatix stocks 800 of each (read, `taverly.inv`).
- A shop buy sometimes comes back short (the SDK stops at a Buy-10 whose purchase it does not see
  within 5 s). The role retries while each attempt makes progress and logs `supply: short buy`
  with the SDK's reason; a short bag costs one extra trip.

## Secondaries

Read from `brew_potion.struct`, the shop inventories and the drop tables. Shares are of the
seven-herb mix.

| Herb | Potion (base xp) | Secondary | Need for the mix (inferred) | Source |
|---|---|---|---|---|
| guam, irit | attack (25), super attack (100) | eye of newt | ~278 | Jatix, covered by the role |
| ranarr, avantoe | prayer (87.5), fishing (112.5) | snape grass | ~118 | ground spawns (3 on the Rimmington coast), chaos druids 1/128 |
| harralander | energy (67.5) | chocolate dust | ~97 | gnome shops (5 stock each), or chocolate bars ground with a pestle and mortar |
| tarromin, kwuarm | strength (50), super strength (125) | limpwurt root | ~160 | no shop: hill giants 11/128 per kill, Taverley druids 3/128; chaos druids never drop it |

Attempts 2 and 3 use a limpwurt-free mix (rs/387): eye of newt, snape grass and **chocolate
dust** for harralander's energy potion (67.5 base; the Gnome Stronghold grocers on the first
floor, buyer.md, and bars ground with `brew`'s `grind`). Tarromin, kwuarm, cadantine,
lantadyme and dwarf weed stay unmixed. rs/158 accepted it at 214 S25e ticks for attempt 2
(1,010 new herbs plus banked harralander and marrentill) and 223 for attempt 3 (1,320 new
herbs), against attempt 1's 210.

Dragon scale dust would add kwuarm's weapon poison (137.5) and lantadyme's antifire (157.5)
and bring the two routes to 189 and 198 ticks, but it has no source the helpers can reach: the
blue dragon room's five scale spawns are out of line of sight from the dragons role's safe tile
(dragons.md, measured), and neither scales nor dust trade on the GE. Limpwurt is a natural
by-product of the hill-giant bone collectors.

## Other sources considered (read)

- **Irit** has three sources: the herb table, the sinister-key chest (one per key) and Managing
  Miscellania (~2 a day at most). The GE has no asks and a standing 200 gp x 1,001 bid.
- **Herb droppers** per kill: chaos druid 0.445, chaos druid warrior 0.42 (Yanille agility
  dungeon, gated), druid 0.20 (Taverley stone circle, 17 spawns), man 0.18.

## Running on the fleet

Accounts are cairn_h84-h87 (`HELPERS.md`). The fleet loads a role by file name, so adopting an
account is

```
fleetctl assign cairn_h84 herbs --options '{"spot":"chaos_druids_taverley","food":"none"}'
fleetctl reload
```

Keep two accounts per spot.
