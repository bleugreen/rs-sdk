# feathers

`speedrun/helpers/feathers.ts`. Kills chickens at a coop near Lumbridge, picks up only the feathers, and banks them at Draynor. Fletching needs a feather per headless arrow, so thousands of them; this is the cheapest source a brand-new account has. It is also the fleet's proof role (cairn://p/rs/43).

## What it does

1. Skips the tutorial if the account is still on Tutorial Island, and equips the starter Bronze dagger.
2. Walks to Draynor bank on its first pass, so the account appears in the ledger straight away.
3. At the coop: picks up any feather pile in the pen (a kill's drop is private to the killer for 100 ticks), otherwise attacks the nearest reachable chicken and waits for it to leave the npc list.
4. Banks when it carries `bankAt` feathers or every `bankMinutes`, deposits the feathers and calls `reportBank`.

Chickens have 3 hitpoints and cannot hurt a fresh account, so there is no food, no death handling and no training step. Half of all kills drop feathers (5 or 15; `wiki/npcs/chicken.md`), about 5 per kill on average. Bones and raw chicken are left on the ground: they would fill the inventory, while feathers stack in one slot. Attack and Hitpoints level as a side effect (an hour of this took a fresh account well past Attack 20).

## Options

| Option | Default | Meaning |
|---|---|---|
| `pen` | `east` | `east`: the coop north of the Lumbridge cow field, nine chickens at x 3225-3235, z 3297-3300 (map m50_51). `fred`: Fred the Farmer's, five chickens at x 3185-3191, z 3277-3279 (m49_51). |
| `bankAt` | 300 | Feathers carried before a bank trip. |
| `bankMinutes` | 30 | Bank at least this often, whatever is carried. |

Run at most two accounts per coop: more than that and they mostly wait for respawns (50 ticks), and it crowds other players.

## Rates

See the measured rates in the PR for cairn://p/rs/43 and `fleet-run/bank-history.jsonl` on the fleet host. The Lumbridge-to-Draynor walk takes about 30 s each way.
