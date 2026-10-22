# questitems: the quests' hand-off items

`speedrun/helpers/questitems.ts` (cairn://p/rs/126) gathers and banks the tradeable items
the scored account's quests take from helpers: SUPPLIES.md hand-offs H4 (Doric's Quest),
H6 (Plague City), H12 (Monkey Madness), H15 (Sea Slug), H16 (Fishing Contest), H19 (Cook's
Assistant), H20 (Goblin Diplomacy, Druidic Ritual, Romeo & Juliet) and H22 (Dragon Slayer).
The item lists are in `docs/speedrun/quests/README.md` section 4.

    ROLE_OPTIONS='{"set":"southwest"}' bun speedrun/helpers/questitems.ts cairn_h94

## How it works

Every item comes from a **task**: a short errand with **held targets**, counts the account
should hold in bank plus inventory. The loop reads its holdings at the nearest bank, runs
the first task in its set that is short and ready, and repeats. A restart or a second run
therefore does only what is missing, and the role stops once every target in its set is
held. Tasks are listed in route order, so a fresh account walks its set once.

- A task can declare inputs it must hold first (`ready`) and items to carry (`carry`, withdrawn
  at the bank). The dyes wait for onions, redberries and woad; the bowl waits for soft clay.
- Three tries without progress park a task for half an hour and the loop moves on, so one
  unreachable spawn or empty shop never stalls the set.
- Shop lines go through `Buyer.buyAtShop` (`buyer.ts`), which follows the live price and waits
  out restocks. Wydin and Thessalia were added to its shop table for this role.
- Combat (the drops set) wields the tutorial's bronze sword and wooden shield, warms up on
  chickens, always trains the lowest of Attack, Strength and Defence, and rests to 80%
  Hitpoints below half. Helpers carry no food.
- Options: `set`, `spare` (default true: one spare of each item where it is cheap), `only` and
  `skip` (task ids), `float` (coins carried, default 400; under 100 the account pickpockets
  Lumbridge men back up to it), `counts` (held targets by item name that replace the tasks'
  own; a name no selected task gathers is refused at start).
- **Bulk runs.** `counts` turns any errand into a stockpile run: the loop banks whenever the
  pack fills and goes back until the held target is met. The Herblore secondaries line
  (cairn://p/rs/332) uses it for snape grass:
  `{"set":"drops","only":["snapegrass"],"counts":{"Snape grass":102}}`. The three spawns
  respawn 30 ticks after a pickup, shortened by the server's player-count scaling
  (`World.scaleByPlayerCount`), and the nearest booth is Falador west. The hobgoblins there
  hunt any player of combat level up to twice theirs (56 and 84) within one tile, so a
  10-Hitpoint coin earner is a poor fit; h96's drops-set combat is enough.

## Sets and sources

| Set (account) | Task | Items held (with spares) | Source |
|---|---|---|---|
| southwest (h94) | coins | float | pickpocket men east of Lumbridge castle |
| | knife | knife 2 | ground spawn, Lumbridge (3224,3202) |
| | buckets | bucket of water 5, bucket of milk 3 | buckets from the Lumbridge general store (stock 2, restocks); milk from the cows east of the river (`cow_milking.rs2`); water at the castle fountain |
| | egg | egg 2 | ground spawns, Lumbridge chicken farm |
| | onions | onion 4 (two per yellow dye) | Fred's field (3189,3267) |
| | logs | logs 7 | trees west of Lumbridge castle |
| | wydin | pot of flour 2, banana 6, raw beef 2, raw chicken 2 | Wydin, Port Sarim (stock 3/3/1/1, restocks) |
| | gerrant | fishing rod 2, fishing bait 5, lobster pot 2 | Gerrant, Port Sarim |
| | mine | copper ore 5, iron ore 3, clay 7 (+ clay for the bowl) | Rimmington mine; about six copper give Mining 15 for the iron at 25x |
| | softclay | soft clay for six pots and the bowls | clay on a bucket of water; buckets from the spawns at Sarah's farm, water at the sink beside them |
| | woad | woad leaf 4 | Wyson, Falador park: "How about 20 coins?" gives two |
| | mindbomb | wizard's mind bomb 2 | Rising Sun barmaid, 2 coins |
| | bowl | unfired bowl 2 | potter's wheel, Barbarian Village: six unfired pots give Crafting 8 (157.5 xp each at 25x), then the bowls; the pots are dropped |
| | silk | silk 2 | Thessalia, Varrock (stock 5) |
| | berries | cadava berries 2, redberries 6 | ground spawns south-east of Varrock |
| | dyes | orange dye 2, blue dye 2 | Aggie, Draynor: use 2 onions, 3 redberries or 2 woad leaves on her (5 coins each), then red on yellow makes orange |
| drops (h96) | goblinmail | goblin mail 4 | Lumbridge goblins, 5 in 128 per kill (`goblin.rs2`) |
| | ratmeat | raw rat meat 2 | giant rats, Lumbridge swamp (every kill) |
| | bearmeat | raw bear meat 2 | brown bears west of Lumbridge (every kill), after Attack 20 |
| | snapegrass | snape grass 2 | spawns on the hobgoblin peninsula, after Attack 20 |

Not yet in a set: the Karamja and Ardougne errands (unlit torch, rope and spade from
Jiminua's jungle store, monkey bones, swamp paste from the Port Khazard general store, ball
of wool, dwellberries and chocolate dust from the Gnome Stronghold, the three planks at the
Barbarian Outpost) and the Fishing Contest carp helper (h97). The gold bar and the 12 steel
nails come from the bars role (cairn://p/rs/119), which has the Smithing for them.

## Measured in the lab (local engine, 300 ms ticks, 25x xp)

| Stretch | Ticks | Notes |
|---|---|---|
| Lumbridge: knife, buckets, egg, onions, logs | 1,825 | about 470 waiting for bucket restocks and 700 for seven logs at Woodcutting 1 |
| Port Sarim: Wydin and Gerrant | 530 | Wydin's restocks (1 per 100 ticks) set it |
| Rimmington mine: 5 copper, 3 iron, 15 clay | 462 | |
| Soft clay, 8 | 113 | |
| Woad 4, mind bomb 2 | 133 | |
| Crafting 1 to 8 and the bowl, from 7 soft clay | 191 | |
| Onions, woad, berries and Aggie's dyes (no spares), from Lumbridge | 802 | |

## On the demo (bbs, gateway 7762)

Both sets ran to `done` unattended on 2026-10-21, each from a fresh account with spares on:

| Account | Set | Wall time | Final holdings | Errors (recovered by the loop's retry) |
|---|---|---|---|---|
| cairn_h94 | southwest | 42 min, including one restart for a code fix | knife 2, bucket of water 5, bucket of milk 3, egg 2, logs 7, pot of flour 2, banana 6, raw beef 2, raw chicken 2, fishing rod 2, fishing bait 5, lobster pot 2, copper ore 5, iron ore 3, clay 7, soft clay 1, wizard's mind bomb 2, unfired bowl 2, silk 2, cadava berries 2, orange dye 2, blue dye 2 | one "Mining operation was rejected" on iron, one barmaid dialogue that did not open |
| cairn_h96 | drops | 26 min | goblin mail 4, raw rat meat 2, raw bear meat 2, snape grass 2 | none |

The four goblin mails took 154 goblin kills, an unlucky run (at 5 in 128 four mails average
about 102 kills), which left the account at about 46 Attack, Strength and Defence. The rats, bears and snape grass
then took under three minutes together.

## Gotchas

- **Clicks during a one-tick delay are dropped.** Filling a bucket (`p_delay(0)`) and softening
  clay (`p_delay(1)`) delay the player; the next use sent inside the delay does nothing. The
  role waits a tick (two for item-on-item) after each success.
- **Aggie hands over the dye a tick after her dialogue closes**, so the task waits for the dye
  rather than checking at once.
- **Back-to-back withdrawals can address a stale slot** when the first empties its slot and
  the bank compacts; the role lets the bank state settle a tick between withdrawals.
- **The pottery menu labels carry literal `\n` padding** (`\n\n\n\nPot`); match them with the
  SDK's `resolveSkillDialogProduct`.
- **Spawns behind closed doors:** the spade spawns in Falador (inside a house) and Draynor
  Manor are unreachable to the pathfinder. A pickup gives up after five misses.
- **Lab fixtures:** `::give onion 4` gives one onion, so test the dyes from real onions.
