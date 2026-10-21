# fletcher

`speedrun/helpers/fletcher.ts` supplies the scored account's Fletching on the
adamant-cap list (`docs/speedrun/skills/fletching.md` section 7): **4,245
headless arrows**, and the arrowheads to tip them (bronze 60, iron 90, steel
135, mithril 225, adamant 3,735). Headless arrows are the main line. The
arrowheads are bought only cheaply from shop restocks, never smithed: rs/129
priced them at about zero scored ticks, so they are not worth adamant bars.

Two modes, one account each:

```
ROLE_OPTIONS='{"mode":"headless","target":4245}' bun speedrun/helpers/fletcher.ts cairn_h78
ROLE_OPTIONS='{"mode":"camp","shop":"hickton"}'   bun speedrun/helpers/fletcher.ts cairn_h76
ROLE_OPTIONS='{"mode":"camp","shop":"dargaud"}'   bun speedrun/helpers/fletcher.ts cairn_h77
```

## Headless mode

Each phase is chosen from the bank and pack counts (`headlessStep`), so a
restart resumes where the last run stopped.

| Phase (`ctx.log('phase')`) | Where | What |
|---|---|---|
| (start) | anywhere | Auto-retaliate off, run on; open Draynor bank to learn the counts |
| `knife` | Lumbridge knife spawn (3224,3202) | Pick up the ground-spawn knife (the GE asks 50,000 gp for one) |
| `shafts` | Woods west of Lumbridge castle (around 3165,3230) | Chop the nearest normal tree, cut each log into 15 shafts at once; bank the shafts at Draynor every ~20 minutes |
| `feathers` | Draynor bank, Gerrant (Port Sarim), Varrock west bank | Banked feathers first; else buy at Gerrant under `maxFeatherPrice`; short of coins, wait at Varrock west for a funder's trade (feathers or coins) |
| `attach` | Draynor bank | Feather on shaft, 15 arrows per action, one awaited action per tick |
| `done` | Draynor bank | The headless arrows are banked |

Shafts, feathers and headless arrows are all stackable, so the pack never fills
and the line needs no bank trips except to protect progress against a death.

### Where to chop, and the Draynor jail guards

Only normal logs make arrow shafts (`cut_logs.dbrow`). The obvious trees, the
cluster beside Draynor bank, are deadly for a fresh account: four level-26 Jail
guards (`huntmode=aggressive_melee`, `draynor.npc`) spawn among them, wander 5
tiles and chase to 7 from their spawn. cairn_h78 died there twice in a minute.
The role chops instead in the woods west of Lumbridge castle (map square
m49_50, about 100 normal trees). The goblins, spiders and rats there have no
hunt mode, so nothing starts a fight.

Every walk between the Lumbridge side and Draynor bank goes round the guards to
the south through `DRAYNOR_APPROACH` (`jailBypass`): the direct path passes one
guard spawn at 1 tile, while each leg of the detour stays 11 or more tiles from
all four (checked offline with `sdk/pathfinding`, both directions).

### Rates

| Step | Measured | Where |
|---|---|---|
| Cut one log into 15 shafts | 4.2 ticks | lab (`speedrun/lab/measure-fletch.ts`) |
| Feather on 15 shafts | 1 tick | lab |
| Shafts, chopping and cutting in the woods | 4,230 from 282 logs in 5,366 ticks: **9,460 per account-hour** including the walks and one Draynor bank visit (bursts of 11,000 while chopping) | demo, cairn_h78, 2026-10-21 |
| Feathers by trade at Varrock west | 12 ticks | demo |
| Attach 4,245 | 704 ticks including the walk from Varrock west to Draynor | demo |

The demo's experience rates took cairn_h78 from Woodcutting 23 to 70 during
the run, so the chop rate is near its ceiling almost at once. The whole line,
4,245 headless arrows banked, was **34 minutes of account time**.

Known rough edges: `bot.fletchLogs` often reports "Fletching timed out" although
the cut succeeded ("You carefully cut the wood into 15 arrow shafts"); the loop
simply carries on, but each false timeout wastes a few seconds. The walk from
Varrock west to Draynor bank (only taken after a feather trade) is outside the
`jailBypass` band and was not checked against the guards; it arrived safely
once.

### Feathers

One feather per arrow. The fleet's feather stock (cairn_h01-h03, about 22,000)
is several times the need, so the cheap path is a trade from one of them to the
headless account at Varrock west bank, with the bidder's fund trip:

```sh
ROLE_OPTIONS='{"bidder":"cairn_h78","item":"Feather","amount":4245}' bun speedrun/helpers/bidder.ts cairn_h01 fund
```

The giver is a fleet account, borrowed with `fleetctl assign <acct> coins
--disable && fleetctl reload` only once the receiver stands at the bank, and
handed back afterwards. A re-enabled coins role may start on its pre-trip
inventory (the fund trip banks everything it carries), so check `fleetctl logs
<acct> 30` and force a role restart with an options change if it is stale.
Buying 4,245 at Gerrant instead drains his 1,000 shelf, and the price rises 1%
per unit below it (`shelfPrice`).

## Camp mode: arrowheads from shop restocks

Shop stock is shared by the whole server and restocks one unit per `stockrate`
ticks whether or not anyone watches (`World.ts` processCleanup; a drained slot
keeps restocking). The two archery shops past White Wolf Mountain:

| Shop | Adamant arrowtips | Small tiers |
|---|---|---|
| Hickton (Catherby) | 200 shelf, +1 per 40 ticks (300/h) | deep shelves of bronze to mithril at about base price |
| Dargaud (Ranging Guild, Ranged 40 at the door) | 200 shelf, +1 per 50 ticks (240/h) | |

The price is base x (1 + 0.01 x (200 - shelf)) (`shop.rs2`, delta 10), so the
role's cap of 41 gp (`PATIENT_ADAMANT_PRICE`) buys only off a near-full shelf.
That yields the same restock rate as draining the shelf, at a third of the
price: about 150k gp for all 3,735 instead of about 450k. The GE listed no
arrowtips of any tier when checked.

A camper trains first (Hitpoints 40 on cows for the crossing; the Dargaud
camper trains Ranged 40 with a shortbow and arrows from Lowe), collects its
coins at Varrock west bank (waiting there for a funder's trade if short),
crosses to Kandarin (`speedrun/lib/kandarin.ts`), then buys each line in `CAMP_LINES` and
banks every `reportMinutes`. Hickton alone yields 300 adamant per hour, so its
default share of 2,075 takes about 7 hours; the rest is Dargaud's share.

## Options

| Option | Mode | Default | Meaning |
|---|---|---|---|
| `mode` | both | `headless` | `headless` or `camp` |
| `target` | headless | 4245 | Headless arrows to hold (bank + pack) |
| `maxFeatherPrice` | headless | 6 | Gerrant's live price cap per feather |
| `shop` | camp | (required) | `hickton` or `dargaud` |
| `lines` | camp | `CAMP_LINES[shop]` | `[{ item, quantity, maxPrice? }]` |
| `coins` | camp | `campBudget(lines)` (97,184 Hickton, 71,963 Dargaud) | Coins carried over the mountain |
| `crossingHitpoints` | camp | 40 | Hitpoints to train before the crossing |
| `reportMinutes` | camp | 30 | Bank and log holdings this often while camping |
| `funders` | both | `^cairn_h\d+$` | Accounts whose trades are accepted at Varrock west bank |

## Accounts and hand-over

| Account | Job | State |
|---|---|---|
| cairn_h76 | Hickton camper | Small lines bought; camping 2,075 adamant arrowtips |
| cairn_h77 | Dargaud camper | Not created: the other 1,660 adamant stay unbought unless asked for |
| cairn_h78 | Headless line | Done: 4,245 headless arrows in its bank; logged out |
| cairn_h79 | spare | Not created |

During development the accounts ran from a dev copy on bbs (`~/rs-dev/fletcher`,
`tmux -L rs41-fletcher`, session `fl`, gateway 127.0.0.1:7750), with their
`bot.env` files in `~/rs-dev/fletcher/bots/`. To stop the camper cleanly, end
its role window, then log it out with the logout button and stop its client:

```sh
ssh bleu@bbs 'tmux -L rs41-fletcher kill-window -t fl:role-h76; cd ~/rs-dev/fletcher && touch stop-cairn_h76 && GATEWAY_URL=ws://127.0.0.1:7750 ~/.bun/bin/bun logout.ts cairn_h76'
```

To adopt the accounts into the fleet once this role is on the deployed ref,
copy each `bot.env` into `~/rs-fleet/bots/<account>/` (700/600) and assign:

```sh
ssh bleu@bbs '~/rs-fleet/speedrun/helpers/fleetctl assign cairn_h76 fletcher --options "{\"mode\":\"camp\",\"shop\":\"hickton\"}" && ~/rs-fleet/speedrun/helpers/fleetctl reload'
```

The camper resumes from its bank counts: it banks and logs `camp holdings`
every `reportMinutes`, and a restart in Kandarin goes straight back to the
shop. cairn_h78 needs no role: its stock waits in its bank for the mule.
