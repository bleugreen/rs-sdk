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

Shop stock is shared by the whole server. Each item restocks one unit per
`stockrate` ticks up to its configured stock, whether or not anyone watches
(`World.ts` processCleanup). A shelf at its configured stock stops
restocking. The two archery shops past White Wolf Mountain:

| Shop | Arrowtips (configured stock, restock) | Notes |
|---|---|---|
| Hickton (Catherby; `archeryshop2` in catherby.inv) | bronze 1,000 / iron 800 / steel 600 / mithril 400 / adamant 200 / rune 100, each +1 per 40 ticks (300/h per item) | Rune arrows stock 0 |
| Dargaud (Ranging Guild, Ranged 40 at the door) | adamant 200, +1 per 50 ticks (240/h) | rs/124 found its rune stock drained by an outside buyer |

The price is base x (1 + 0.01 x (stock - shelf)) (`shop.rs2`, delta 10). The
restock is the limit on how many a camper gets per hour whatever it pays, so
the role's caps sit just above base and buy only off a near-full shelf
(`PATIENT_*_PRICE`, pinned by tests):

| Item | Cap | Buys from a shelf of |
|---|---|---|
| Adamant arrowtips | 41 | 196+ of 200 |
| Rune arrowtips | 210 | 95+ of 100 |
| Mithril arrowtips | 18 | 382+ of 400 |

A higher cap only buys the starting shelf once and then pays more for every
restocked unit after that: at 1.5x base, 560 rune tips would cost ~165k gp
instead of ~117k. The GE listed no arrowtips of any tier when checked.

The default Hickton list (`CAMP_LINES.hickton`, from supply-fallbacks.md
section 3) is the small tiers, then adamant 2,075, rune 560 (the Fletching-75+
stand-ins) and mithril 1,500 (which fill the adamant shortfall; shared with
the Dargaud buyer of rs/124). Dargaud's default is the other 1,660 adamant,
unused for now.

A camper trains first (Hitpoints 40 on cows for the crossing; the Dargaud
camper trains Ranged 40 with a shortbow and arrows from Lowe), collects its
coins at Varrock west bank (waiting there for a funder's trade if short), and
crosses to Kandarin (`speedrun/lib/kandarin.ts`). There it runs passes: each
line buys what its cap allows and waits at most `passTicks` for a restock, so
no shelf sits full while another line waits. It banks and logs `camp holdings`
(held, and per-item purchases per hour) every `reportMinutes`. When a line runs
out of coins, it banks, walks back over the mountain to Varrock west bank, and
waits there for a funder. Then it crosses again carrying `remainingBudget`,
which is what's left at the caps, plus 5% and 500. Measured at Hickton with
three lines: about 10 seconds per pass, each shelf taken back to its cap as
it restocks.

## Options

| Option | Mode | Default | Meaning |
|---|---|---|---|
| `mode` | both | `headless` | `headless` or `camp` |
| `target` | headless | 4245 | Headless arrows to hold (bank + pack) |
| `maxFeatherPrice` | headless | 6 | Gerrant's live price cap per feather |
| `shop` | camp | (required) | `hickton` or `dargaud` |
| `lines` | camp | `CAMP_LINES[shop]` | `[{ item, quantity, maxPrice? }]` |
| `coins` | camp | `remainingBudget(lines)` | Coins carried over the mountain (a fixed number overrides) |
| `crossingHitpoints` | camp | 40 | Hitpoints to train before the crossing |
| `passTicks` | camp | 20 | How long each line waits for a restock per pass |
| `reportMinutes` | camp | 30 | Bank and log holdings this often while camping |
| `funders` | both | `^cairn_h\d+$` | Accounts whose trades are accepted at Varrock west bank |

## Accounts and hand-over

| Account | Job | State |
|---|---|---|
| cairn_h76 | Hickton camper | Small tiers bought; camping adamant, rune and mithril arrowtips |
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
