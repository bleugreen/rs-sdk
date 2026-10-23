# Speedrun supplies priced in gold

What each speedrun supply costs in coins and how fast gold can turn into it: every item on
[SUPPLIES.md](../speedrun/SUPPLIES.md) section 2 that names an item, the quest items the fleet's
quest-item gatherer buys (`speedrun/helpers/questitems.ts`), and a few neighbours (nature runes, raw
sharks, cut gems). For each item: every NPC shop that sells it, with its base price, price curve,
restock rate and requirements, and the live Grand Exchange book. This tells markets what gold is worth
to the speedrun, both for after the scored run and for the next one. Issue: cairn://p/rs/503, under
cairn://p/rs/495.

This is a table, not a purchase plan. Nothing on SUPPLIES.md is bought before main announces that the
scored run has ended (tenet 28), and no account logged in to build it: the GE figures come from the
public market API, and the shop figures come from the game content.

## How the figures are made

**Shop prices** follow `shop.rs2` `calc_shop_value`: with `stock` units on a shelf configured for
`base`, the next unit costs `cost x max(100, sell - clamp((stock - base) x delta, -5000, 1000)) / 1000`,
at least 1 gp. `cost` is the obj's `cost=`; `sell` and `delta` are the shopkeeper's
`shop_sell_multiplier` and `shop_delta` params (defaults 100 and 10 in `shopkeeper.param`), or the
arguments of a scripted `~openshop`. Each unit below base therefore adds `cost x delta / 1000` gp (the
*Step/unit* column), up to a ceiling of `(sell + 5000)/1000 x cost` reached `5000/delta` units below
base. Most shops sell at 1000 per mille with delta 10 (1% of cost a unit, 6x at 500 down), but the
multipliers vary: Jiminua charges 1.5x, Irksol 0.5x, and the gem shops, Lundail and the fishmongers
climb three times as fast (delta 30). `buy_item` prices every unit of a purchase separately.

**Restock** (`World.ts`, the inventory pass): on every tick where `tick % stockrate == 0`, each line of
a `restock=yes` inventory below its base gains one unit, and each line above it loses one. The clock is
global and every shelf is shared by the whole world, so the *Shop restock/h* column (9,000 ticks an hour
at the demo's 400 ms) is an upper bound on what everyone together can take from that shop. It does not
grow with more buyers. A shelf configured at 0 only holds what players sell to it and drains back to 0.
An inventory without `restock=yes` (the Ape Atoll shops) never restocks. A server restart refills every
shelf to its base (runes.md, *Drained shelves*).

**Coins for the need** buys the run's count one unit at a time from whichever source is cheapest at that
moment: each shop from a full shelf (one visit, no waiting for restocks) and the GE at its best ask
(`markets/supplies/plan.ts`). The public API reports the book's total quantity and value, not its price
levels, so the GE part is a lower bound; where the book's mean ask is more than 20% above the best ask,
the summary shows it. The fill takes every shop whatever it requires (Magic 66, a quest, a ship); the
shop detail lists the requirements. *n only, x* means every source together offers only n units.

**Live shelves.** A full shelf is what the config describes and what a restart leaves, not what a buyer
finds on a contested shelf. Live counts come from a read-only shelf-reader role that markets runs on its
own VM before 12:30Z on 2026-10-23, relayed through cairn://p/rs/495. The *Live shelf* column shows
*pending* until they arrive (`markets/shelf/export-supplies.ts` writes them in the shape the render
reads). Four shops stay *config only*: the reader account has neither Magic 66 for the Magic Guild,
Ranged 40 for Dargaud's Ranging Guild shop (training it is tied to buying rune arrows, a SUPPLIES.md
item) nor Lost City for Irksol, and Lundail is skipped because a Wilderness death costs the reader's
gear.

**Nearest bank** is the straight-line (Chebyshev) distance in tiles from the shopkeeper's spawn to the
nearest bank the fleet uses (`speedrun/helpers/buyer.ts` `BANKS`). Run energy never drains on the demo
(SUPPLIES.md, H4.1), so a trip takes at least half that many ticks each way. A dash marks a shop behind a
ship, a quest area or the Wilderness. *Fleet key* names the buyer's `SHOPS` entry when the fleet already
buys there.

## Findings

**Gold buys about half the list, and almost none of the scarce part.** Of the 85 lines with a run
count, 45 can be bought in full, 8 in part and 32 not at all. At config shelf prices and the asks of
2026-10-22 22:25-22:36Z, everything purchasable for one attempt costs about **1.24M gp**. About 0.77M
of that is five lines: magic logs 241k (GE), steel bars 180k (GE), rune arrows
160k, blood runes 108k and mithril arrowtips 86k. What no seller offers at any price today: every
potion, every ring and amulet except Irksol's ruby rings, uncut diamonds, adamantite and mithril bars,
the rune axe, headless arrows, the Herblore secondaries other than eye of newt, the unfinished potions,
and most of the rune essence (1,625 of 5,427 offered) and dragon bones (3 of 555). Those stay
gather-or-bid lines, and gold is worth nothing to them beyond funding bids.

**Blood runes are the largest gold sink, and their price depends on timing.** 570 from a full Magic
Guild shelf cost 108,250 gp (190 each; the same figure as runes.md's lab measurement), but the live shelf
sits empty between restarts and another player takes each restock (rs/347). A unit taken off an empty
shelf costs the 300 gp ceiling, and only 30 restock per hour across the world. The GE has 82 for sale at
1,321 under a 1,301 bid for 17,916, so it cannot supply the run. The workable gold route is an account
with Magic 66 standing in the store across a server restart (runes.md). On the margin a blood rune is
worth about 1,300 gp today.

**Rune arrows cost about 800-1,060 gp each.** Dargaud is the only stocked seller (400 at 400 gp, plus
4 gp per arrow missing, 69 an hour world-wide; Hickton's line is configured at 0). 200 cost 159,600 from
a full shelf. From the 329-340 the shelf held live on 2026-10-21 (rune-arrows.md) they cost 211,600. The
GE has no asks. Arrowtips run out before the need: the shops hold 250 rune tips against 570 and 400
adamant tips against 2,220, and restock 375 and 405 an hour, so a shop route for the tips is a wait of
about 50 minutes for the rune tips and four and a half hours for the adamant ones, shared with every other buyer.

**Sharks are the one deep food market.** The GE asks 533 for 2.0M sharks (book mean 700) and trades
about 550 an hour, so 60 cost about 32k. No shop sells cooked sharks. Raw sharks appear only on
player-sold fishmonger shelves and Rufus's single one.

**Potions cannot be bought.** Jiminua's Antipoison(3) (10 at 432 gp, 60 an hour) is the only potion any
NPC sells. The GE has bids and no asks for every potion on the list (prayer 9,000 x18, super strength
4,000 x6, ranging 6,000 x8), so potions are Herblore or nothing.

**Jewellery and gems: only Irksol's ruby rings.** 5 at 1,012 gp, 18 an hour, Lost City. Grum's and
Davon's lines are configured at 0 (player-sold only; the shelf reader will show whether anyone stocked
them). The gem shops hold 0-1 of each gem and restock one every 15,000-60,000 ticks. The GE's uncut gems
have deep bids (2,500-3,500 for 8,500-10,000 each) and no real asks; the 11,988 sapphires at 20,000 are
the listing market.md already called not a market.

**Runes other than blood and cosmic are cheap.** Law 55 for 2,424 (Magic Guild; the GE asks 2,300
each), death 110 for 3,777, chaos 40 for 616, the elementals 4 gp. Air for the full ~1,650 costs about
18k across five shops (the GE asks 21). Cosmic runes are the exception: Lundail stocks 20 and the GE
lists one at 10,000, so 60 needs three Lundail visits or about 27 minutes of his restock (90 an hour).

**The quest items and tools are trivial**: each costs under 50 gp at a shop the fleet already visits.
The exceptions among the tools are the rune pickaxe (Nurmof, one at 32,000), the magic shortbow (GE,
19,998 x96) and the rune axe (no asks; a 150,000 bid for 43 stands unfilled).

## Refreshing

- `bun markets/supplies/build.ts ge --origin=<game HTTP origin>` re-reads every item's quote, and its
  7-day history when it traded, one request every 4 seconds (about 11 minutes), into
  `markets/supplies/data/ge.json`. The origin goes on the command line only; the file holds none.
- `bun markets/shelf/export-supplies.ts <readings.jsonl>` turns the shelf reader's readings into
  `markets/supplies/data/shelf.json`.
- `bun markets/supplies/build.ts render` regenerates the block below from the content, that file and,
  when present, `markets/supplies/data/shelf.json`: the shelf reader's counts as
  `[{"inv": "magicshop", "obj": "airrune", "count": 950, "price": 4, "at": "2026-10-23T09:12:00Z"}]`,
  `inv` and `obj` being the content's names shown in the shop detail.
- The supply list, the run counts and the shop places live in `markets/supplies/items.ts`; the counts
  follow SUPPLIES.md section 2, so a new SUPPLIES.md version means editing that list and re-rendering.
- Tests: `bun test markets` (`markets/supplies/supplies.test.ts`, on fixtures).

<!-- supplies:generated:begin (bun markets/supplies/build.ts render) -->

GE figures read 2026-10-22 22:25Z to 2026-10-22 22:36Z (public market API, read-only). Shop figures are the content's configuration (`server/content`), which a full shelf after a server restart matches; the Live shelf column carries the read-only shelf reader's counts as they arrive.

### Summary by item

#### Runes

| Item | Run need | Need note | Cheapest stocked shop: price x stock | Shop restock/h (world) | GE ask x depth | GE bid x depth | GE 7-day volume | Coins for the need | gp/unit |
|---|---|---|---|---|---|---|---|---|---|
| Blood rune | 570 | Kolodion 70 + Charge 500 | Magic Store owner: 50 x1,000 | 30 | 1,321 x82 | 1,301 x17,916 | 12,935 (77/h) | 108,250 | 190 |
| Death rune | 110 |  | Betty: 30 x1,000 (+3 more) | 240 | 395 x858 | none | 25,364 (151/h) | 3,777 | 34 |
| Chaos rune | 40 |  | Betty: 15 x1,000 (+3 more) | 360 | none | none | 763 (4.5/h) | 616 | 15 |
| Law rune | 55 | ~55: the run's teleports | Magic Store owner: 40 x1,000 (+2 more) | 60 | 2,300 x1,109 | 101 x5,055 | 6,571 (39.1/h) | 2,424 | 44 |
| Cosmic rune | 60 |  | Lundail: 15 x20 | 90 | 10,000 x1 | 1,000 x1 | 70 (0.4/h) | 21 only, 10,376 | 494 (mixed) |
| Air rune | 1,650 | ~1,650 | Aubury: 4 x2,000 (+4 more) | 2,480 | 21 x154,231 | 5 x101,281 | 703,131 (4,185.3/h) | 18,345 | 11 |
| Fire rune | 85 | 80 + ~5 | Aubury: 4 x2,000 (+4 more) | 2,480 | 40 x27 | none | 3,305 (19.7/h) | 340 | 4 |
| Water rune | 40 | ~40 | Aubury: 4 x2,000 (+4 more) | 2,480 | none | 10 x300 | 2,026 (12.1/h) | 160 | 4 |
| Earth rune | 55 | 50 + ~5 | Aubury: 4 x2,000 (+4 more) | 2,480 | none | none | 2,314 (13.8/h) | 220 | 4 |
| Mind rune | - | helper Magic training only | Betty: 3 x1,000 (+3 more) | 2,480 | none | 6 x1,988 | 81 (0.5/h) | - | - |
| Nature rune | - | not on the list (alching) | Magic Store owner: 20 x1,000 (+1 more) | 60 | 621 x607,586 | none | 22,362 (133.1/h) | - | - |

#### Arrows and fletching

| Item | Run need | Need note | Cheapest stocked shop: price x stock | Shop restock/h (world) | GE ask x depth | GE bid x depth | GE 7-day volume | Coins for the need | gp/unit |
|---|---|---|---|---|---|---|---|---|---|
| Rune arrow | 200 | Monkey Madness | Bow and Arrow salesman: 400 x400 | 69 | none | 400 x6 | 0 | 159,600 | 798 |
| Rune arrowtips | 570 |  | Hickton: 200 x100 (+1 more) | 375 | none | none | 0 | 250 only, 82,250 | 329 |
| Adamant arrowtips | 2,220 |  | Hickton: 40 x200 (+1 more) | 405 | none | none | 0 | 400 only, 31,760 | 79 |
| Mithril arrowtips | 1,485 |  | Hickton: 16 x400 (+3 more) | 675 | none | none | 12 (0.1/h) | 86,194 | 58 |
| Steel arrowtips | 135 |  | Hickton: 6 x600 (+3 more) | 975 | none | none | 0 | 927 | 6.9 |
| Iron arrowtips | 90 |  | Hickton: 2 x800 (+3 more) | 1,800 | none | none | 0 | 180 | 2 |
| Bronze arrowtips | 60 |  | Hickton: 1 x1,000 (+3 more) | 3,600 | none | 12 x1,650 | 0 | 60 | 1 |
| Headless arrow | 4,560 |  | none | - | none | none | 0 | no seller | - |
| Arrow shaft | 4,560 | inside the headless arrows | Bow and Arrow salesman: 1 x1,000 | 180 | none | none | 226 (1.3/h) | 1,000 only, 4,500 | 4.5 |
| Feather | 5,140 | 580 to SCORED + 4,560 in headless arrows | Gerrant: 2 x1,000 (+6 more) | 54,180 | 75 x245 (book mean 106) | none | 870 (5.2/h) | 49,595 | 9.6 |

#### Potions

| Item | Run need | Need note | Cheapest stocked shop: price x stock | Shop restock/h (world) | GE ask x depth | GE bid x depth | GE 7-day volume | Coins for the need | gp/unit |
|---|---|---|---|---|---|---|---|---|---|
| Prayer potion(4) | 5 |  | none | - | none | 9,000 x18 | 2 (0/h) | no seller | - |
| Superantipoison(4) | 2 |  | none | - | none | 2,000 x2 | 0 | no seller | - |
| Antipoison(4) | 3 | 2 + the combat kit's 1 | none | - | none | 2,000 x2 | 0 | no seller | - |
| Antipoison(3) | - | the shop's dose; H7 takes any dose | Jiminua: 432 x10 | 60 | none | 1,200 x101 | 0 | - | - |
| Agility potion(4) | 1 |  | none | - | none | 2,000 x1 | 0 | no seller | - |
| Magic potion(4) | 1 |  | none | - | none | 2,000 x1 | 0 | no seller | - |
| Super attack(4) | 1 |  | none | - | none | 3,500 x6 | 0 | no seller | - |
| Super strength(4) | 1 |  | none | - | none | 4,000 x6 | 0 | no seller | - |
| Ranging potion(4) | - | none planned; only if a bid fills | none | - | none | 6,000 x8 | 94 (0.6/h) | - | - |

#### Food

| Item | Run need | Need note | Cheapest stocked shop: price x stock | Shop restock/h (world) | GE ask x depth | GE bid x depth | GE 7-day volume | Coins for the need | gp/unit |
|---|---|---|---|---|---|---|---|---|---|
| Shark | 60 | ~60 | none | - | 533 x2,002,978 (book mean 700) | none | 91,932 (547.2/h) | 31,980 | 533 (GE) |
| Raw shark | - | cook to sharks | Rufus: 390 x1 | 9 | none | none | 1 (0/h) | - | - |
| Swordfish | - | fallback food | Alfonse the waiter: 260 x2 (+1 more) | 48 | none | none | 0 | - | - |
| Lobster | - | fallback food | Alfonse the waiter: 195 x3 | 3.5 | 160 x278 | 120 x43 | 1,025 (6.1/h) | - | - |
| Cooked karambwan | - | fallback food | Alfonse the waiter: 325 x3 | 10 | none | none | 0 | - | - |
| Cake | - | the knights' stall food | Baker: 50 x3 | 11 | none | none | 0 | - | - |

#### Gems and jewellery

| Item | Run need | Need note | Cheapest stocked shop: price x stock | Shop restock/h (world) | GE ask x depth | GE bid x depth | GE 7-day volume | Coins for the need | gp/unit |
|---|---|---|---|---|---|---|---|---|---|
| Sapphire ring | 12 |  | player-sold shelves only | - | none | none | 0 | no seller | - |
| Emerald ring | 27 |  | player-sold shelves only | - | none | none | 0 | no seller | - |
| Ruby ring | 16 |  | Irksol: 1,012 x5 | 18 | none | none | 0 | 5 only, 5,263 | 1,053 |
| Diamond ring | 5 |  | player-sold shelves only | - | none | none | 0 | no seller | - |
| Amulet of magic | 1 |  | player-sold shelves only | - | none | none | 0 | no seller | - |
| Amulet of strength | 1 |  | player-sold shelves only | - | none | 5,500 x101 | 0 | no seller | - |
| Gold bar | - | 1 per ring or amulet (62) + Monkey Madness 1 | player-sold shelves only | - | none | 1,200 x3 | 2 (0/h) | - | - |
| Uncut diamond | 391 | Crafting | player-sold shelves only | - | none | 3,500 x9,668 | 476 (2.8/h) | no seller | - |
| Uncut ruby | - |  | player-sold shelves only | - | 10,000 x1 | 2,501 x9,978 | 1,059 (6.3/h) | - | - |
| Uncut emerald | - |  | Gem trader: 50 x1 | 0.2 | none | 2,500 x9,423 | 586 (3.5/h) | - | - |
| Uncut sapphire | - |  | Herquin: 25 x1 (+1 more) | 0.7 | 20,000 x11,988 | 2,500 x8,499 | 3,928 (23.4/h) | - | - |
| Diamond | - | cut: for the rings | player-sold shelves only | - | none | 4,500 x11 | 3 (0/h) | - | - |
| Ruby | - | cut: for the rings | Gem merchant: 1,500 x1 | 0.2 | none | none | 0 | - | - |
| Emerald | - | cut: for the rings | Gem trader: 500 x1 (+1 more) | 0.5 | none | none | 0 | - | - |
| Sapphire | - | cut: for the rings | Herquin: 250 x1 (+2 more) | 1.8 | none | none | 0 | - | - |

#### Staves

| Item | Run need | Need note | Cheapest stocked shop: price x stock | Shop restock/h (world) | GE ask x depth | GE bid x depth | GE 7-day volume | Coins for the need | gp/unit |
|---|---|---|---|---|---|---|---|---|---|
| Staff of water | 1 |  | zaff: 1,500 x2 (+1 more) | 18 | none | none | 0 | 1,500 | 1,500 |
| Staff of fire | 1 |  | zaff: 1,500 x2 (+1 more) | 18 | none | none | 0 | 1,500 | 1,500 |
| Staff of air | - |  | zaff: 1,500 x2 (+1 more) | 18 | none | none | 0 | - | - |

#### Bars and ores

| Item | Run need | Need note | Cheapest stocked shop: price x stock | Shop restock/h (world) | GE ask x depth | GE bid x depth | GE 7-day volume | Coins for the need | gp/unit |
|---|---|---|---|---|---|---|---|---|---|
| Adamantite bar | 365 |  | none | - | none | 1,666 x24,886 | 114 (0.7/h) | no seller | - |
| Mithril bar | 305 |  | none | - | none | 360 x25 | 0 | no seller | - |
| Steel bar | 120 |  | none | - | 1,497 x3,609 | 89 x9,650 | 73,672 (438.5/h) | 179,640 | 1,497 (GE) |
| Iron bar | 39 |  | player-sold shelves only | - | none | 100 x99,412 | 683 (4.1/h) | no seller | - |
| Bronze bar | 15 |  | Shantay: 8 x10 (+2 more) | 54 | none | none | 0 | 140 | 9.3 |
| Adamantite ore | - | 365 bars need 365 + 2,190 coal | none | - | none | 1,148 x18,226 | 6,489 (38.6/h) | - | - |
| Mithril ore | - |  | none | - | none | none | 0 | - | - |
| Iron ore | - |  | player-sold shelves only | - | 115 x19 | 80 x999,283 | 552,355 (3,287.8/h) | - | - |
| Coal | - |  | player-sold shelves only | - | none | 80 x6,848,105 | 11,509 (68.5/h) | - | - |

#### Skill supplies

| Item | Run need | Need note | Cheapest stocked shop: price x stock | Shop restock/h (world) | GE ask x depth | GE bid x depth | GE 7-day volume | Coins for the need | gp/unit |
|---|---|---|---|---|---|---|---|---|---|
| Rune essence | 5,427 |  | none | - | 58 x1,625 | 55 x522,198 | 516,344 (3,073.5/h) | 1,625 only, 94,250 | 58 (GE) |
| Dragon bones | 555 |  | none | - | 19,000 x3 | 5,001 x1,257 | 583 (3.5/h) | 3 only, 57,000 | 19,000 (GE) |
| Babydragon bones | - | the bone mix's filler | none | - | none | none | 0 | - | - |
| Grapes | 520 | one per wine (520 held) | none | - | none | 1,000 x97,804 | 2,795 (16.6/h) | no seller | - |
| Jug of water | 520 | one per wine | Shantay: 1 x10 (+2 more) | 198 | none | none | 0 | 20 only, 20 | 1 |
| Eye of newt | 481 |  | Jatix: 3 x800 (+3 more) | 2,250 | none | none | 0 | 3,063 | 6.4 |
| Limpwurt root | 249 |  | none | - | none | none | 4 (0/h) | no seller | - |
| Snape grass | 206 |  | none | - | none | none | 3 (0/h) | no seller | - |
| Vial of water | - | one per unfinished potion | Aemad / Kortan: 2 x500 (+5 more) | 543 | none | none | 0 | - | - |
| Guam potion (unf) | 358 |  | none | - | none | none | 0 | no seller | - |
| Tarromin potion (unf) | 198 |  | none | - | none | none | 0 | no seller | - |
| Ranarr potion (unf) | 128 |  | none | - | none | none | 0 | no seller | - |
| Irit potion (unf) | 82 |  | none | - | none | none | 0 | no seller | - |
| Avantoe potion (unf) | 60 |  | none | - | none | none | 0 | no seller | - |
| Kwuarm potion (unf) | 50 |  | none | - | none | none | 0 | no seller | - |
| Magic logs | 107 | Firemaking | none | - | 2,250 x54,741 | none | 9,590 (57.1/h) | 240,750 | 2,250 (GE) |
| Yew logs | 24 |  | none | - | 399 x53,416 | none | 352,894 (2,100.6/h) | 9,576 | 399 (GE) |
| Maple logs | 13 |  | none | - | none | none | 40,449 (240.8/h) | no seller | - |
| Willow logs | 7 |  | none | - | none | none | 527 (3.1/h) | no seller | - |
| Oak logs | 4 |  | none | - | none | none | 661 (3.9/h) | no seller | - |
| Logs | 10 | Firemaking 2 + 8 other | none | - | none | none | 247 (1.5/h) | no seller | - |

#### Gear and tools

| Item | Run need | Need note | Cheapest stocked shop: price x stock | Shop restock/h (world) | GE ask x depth | GE bid x depth | GE 7-day volume | Coins for the need | gp/unit |
|---|---|---|---|---|---|---|---|---|---|
| Rune axe | 1 |  | none | - | none | 150,000 x43 | 11 (0.1/h) | no seller | - |
| Rune pickaxe | 1 |  | Nurmof: 32,000 x1 | 13 | none | none | 51 (0.3/h) | 32,000 | 32,000 |
| Mithril scimitar | 1 |  | Daga: 1,040 x6 (+1 more) | 2.3 | none | 2,356 x3 | 19 (0.1/h) | 1,040 | 1,040 |
| Adamant full helm | 1 |  | Peksa: 3,520 x1 | 0.8 | none | none | 0 | 3,520 | 3,520 |
| Magic shortbow | 1 |  | none | - | 19,998 x96 | none | 15 (0.1/h) | 19,998 | 19,998 (GE) |
| Knife | 1 |  | Hudo: 6 x5 (+6 more) | 468 | 50,000 x4 | none | 1 (0/h) | 6 | 6 |
| Fly fishing rod | 1 |  | Gerrant: 5 x5 (+4 more) | 450 | none | none | 0 | 5 | 5 |
| Fishing rod | 1 |  | Harry: 5 x5 (+5 more) | 540 | none | none | 0 | 5 | 5 |
| Fishing bait | 4 |  | Gerrant: 3 x1,500 (+6 more) | 63,000 | none | none | 0 | 12 | 3 |
| Chisel | 1 |  | Wistan: 1 x2 (+23 more) | 1,782 | none | none | 0 | 1 | 1 |
| Hammer | 1 |  | Wistan: 1 x5 (+24 more) | 1,800 | none | none | 0 | 1 | 1 |
| Cannonball | 1,270 | restricted: Dwarf Cannon | none | - | none | none | 0 | no seller | - |

#### Quest items

| Item | Run need | Need note | Cheapest stocked shop: price x stock | Shop restock/h (world) | GE ask x depth | GE bid x depth | GE 7-day volume | Coins for the need | gp/unit |
|---|---|---|---|---|---|---|---|---|---|
| Pot of flour | 1 | Cook's Assistant | Frenita: 10 x8 (+4 more) | 1,215 | none | none | 0 | 10 | 10 |
| Banana | 5 | Monkey Madness | Wydin: 2 x3 (+1 more) | 90 | none | none | 0 | 10 | 2 |
| Raw beef | 1 | Druidic Ritual | Wydin: 1 x1 (+1 more) | 180 | 13 x10 (book mean 226) | none | 9 (0.1/h) | 1 | 1 |
| Raw chicken | 1 | Druidic Ritual | Wydin: 1 x1 (+1 more) | 180 | none | none | 0 | 1 | 1 |
| Lobster pot | 1 | Dragon Slayer | Harry: 20 x2 (+4 more) | 113 | none | none | 0 | 20 | 20 |
| Silk | 1 |  | Thessalia: 30 x5 | 18 | none | none | 0 | 30 | 30 |
| Rope | 1 | Plague City | Ifaba: 18 x8 (+8 more) | 840 | none | none | 0 | 18 | 18 |
| Spade | 1 |  | Sigmund The Merchant: 3 x10 (+3 more) | 72 | none | none | 0 | 3 | 3 |
| Swamp paste | 1 | Sea Slug | razmire_keelgan: 31 x1,000 (+1 more) | 1,350 | none | none | 0 | 31 | 31 |
| Ball of wool | 1 | Monkey Madness | Aemad / Kortan: 2 x30 (+1 more) | 90 | none | none | 2 (0/h) | 2 | 2 |
| Dwellberries | 1 | Plague City | Hudo: 4 x3 (+1 more) | 180 | none | none | 0 | 4 | 4 |
| Chocolate dust | 1 | Plague City | Hudo: 2 x5 (+1 more) | 180 | none | none | 0 | 2 | 2 |
| Bucket | 6 | Plague City water 4 + milk 2 | Arhein: 2 x10 (+19 more) | 1,566 | none | none | 0 | 12 | 2 |

### Shop detail

| Item | Shopkeeper (inv) | Where; needs | Nearest bank, tiles | Fleet key | Base stock | 1st unit | Step/unit | Ceiling | Run's need from a full shelf | Restock | Live shelf |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Blood rune | Magic Store owner (`magicguildshop`) | Magic Guild 1st floor, Yanille; Magic 66 (guild door) | yanille 18 + stairs | magicGuild | 1,000 | 50 | +0.5 | 300 after 500 | 108,250 | 1 per 300 t, 30/h | config only (no reader with Magic 66) |
| Death rune | Betty (`magicshop`) | Betty's, Port Sarim | draynor 80 | betty | 1,000 | 30 | +0.3 | 180 after 500 | 5,049 | 1 per 150 t, 60/h | pending |
| Death rune | Aubury (`runeshop`) | Aubury's, Varrock east | varrockEast 19 | aubury | 1,000 | 30 | +0.3 | 180 after 500 | 5,049 | 1 per 150 t, 60/h | pending |
| Death rune | Magic Store owner (`magicguildshop`) | Magic Guild 1st floor, Yanille; Magic 66 (guild door) | yanille 18 + stairs | magicGuild | 1,000 | 30 | +0.3 | 180 after 500 | 5,049 | 1 per 150 t, 60/h | config only (no reader with Magic 66) |
| Death rune | Lundail (`magearena_runeshop`) | Mage Arena cellar (Lundail); Wilderness ~53 via the Ardougne lever; three webs | - |  | 250 | 30 | +0.9 | 180 after 167 | 8,646 | 1 per 150 t, 60/h | config only (skipped: Wilderness death risk) |
| Chaos rune | Betty (`magicshop`) | Betty's, Port Sarim | draynor 80 | betty | 1,000 | 15 | +0.15 | 90 after 500 | 698 | 1 per 100 t, 90/h | pending |
| Chaos rune | Aubury (`runeshop`) | Aubury's, Varrock east | varrockEast 19 | aubury | 1,000 | 15 | +0.15 | 90 after 500 | 698 | 1 per 100 t, 90/h | pending |
| Chaos rune | Magic Store owner (`magicguildshop`) | Magic Guild 1st floor, Yanille; Magic 66 (guild door) | yanille 18 + stairs | magicGuild | 1,000 | 15 | +0.15 | 90 after 500 | 698 | 1 per 100 t, 90/h | config only (no reader with Magic 66) |
| Chaos rune | Lundail (`magearena_runeshop`) | Mage Arena cellar (Lundail); Wilderness ~53 via the Ardougne lever; three webs | - |  | 250 | 15 | +0.45 | 90 after 167 | 932 | 1 per 100 t, 90/h | config only (skipped: Wilderness death risk) |
| Law rune | Magic Store owner (`magicguildshop`) | Magic Guild 1st floor, Yanille; Magic 66 (guild door) | yanille 18 + stairs | magicGuild | 1,000 | 40 | +0.4 | 240 after 500 | 2,772 | 1 per 300 t, 30/h | config only (no reader with Magic 66) |
| Law rune | Tutab (`mm_magic_shop`) | Ape Atoll (Tutab); Monkey Madness, monkey greegree; never restocks | - |  | 250 | 40 | +0.4 | 240 (not reached; last unit 139) | 2,772 | never | pending |
| Law rune | Lundail (`magearena_runeshop`) | Mage Arena cellar (Lundail); Wilderness ~53 via the Ardougne lever; three webs | - |  | 250 | 40 | +1.2 | 240 after 167 | 3,960 | 1 per 300 t, 30/h | config only (skipped: Wilderness death risk) |
| Cosmic rune | Lundail (`magearena_runeshop`) | Mage Arena cellar (Lundail); Wilderness ~53 via the Ardougne lever; three webs | - |  | 20 | 15 | +0.45 | 90 (not reached; last unit 23) | 376 for 20 | 1 per 100 t, 90/h | config only (skipped: Wilderness death risk) |
| Air rune | Aubury (`runeshop`) | Aubury's, Varrock east | varrockEast 19 | aubury | 2,000 | 4 | +0.04 | 24 after 500 | 34,350 | 1 per 10 t, 900/h | pending |
| Air rune | Betty (`magicshop`) | Betty's, Port Sarim | draynor 80 | betty | 1,000 | 4 | +0.04 | 24 after 500 | 18,750 for 1,000 | 1 per 10 t, 900/h | pending |
| Air rune | Magic Store owner (`magicguildshop`) | Magic Guild 1st floor, Yanille; Magic 66 (guild door) | yanille 18 + stairs | magicGuild | 3,000 | 4 | +0.04 | 24 after 500 | 34,350 | 1 per 18 t, 500/h | config only (no reader with Magic 66) |
| Air rune | Tutab (`mm_magic_shop`) | Ape Atoll (Tutab); Monkey Madness, monkey greegree; never restocks | - |  | 1,000 | 4 | +0.04 | 24 after 500 | 18,750 for 1,000 | never | pending |
| Air rune | Lundail (`magearena_runeshop`) | Mage Arena cellar (Lundail); Wilderness ~53 via the Ardougne lever; three webs | - |  | 200 | 4 | +0.12 | 24 after 167 | 3,043 for 200 | 1 per 50 t, 180/h | config only (skipped: Wilderness death risk) |
| Fire rune | Aubury (`runeshop`) | Aubury's, Varrock east | varrockEast 19 | aubury | 2,000 | 4 | +0.04 | 24 after 500 | 445 | 1 per 10 t, 900/h | pending |
| Fire rune | Betty (`magicshop`) | Betty's, Port Sarim | draynor 80 | betty | 1,000 | 4 | +0.04 | 24 after 500 | 445 | 1 per 10 t, 900/h | pending |
| Fire rune | Magic Store owner (`magicguildshop`) | Magic Guild 1st floor, Yanille; Magic 66 (guild door) | yanille 18 + stairs | magicGuild | 3,000 | 4 | +0.04 | 24 after 500 | 445 | 1 per 18 t, 500/h | config only (no reader with Magic 66) |
| Fire rune | Tutab (`mm_magic_shop`) | Ape Atoll (Tutab); Monkey Madness, monkey greegree; never restocks | - |  | 1,000 | 4 | +0.04 | 24 after 500 | 445 | never | pending |
| Fire rune | Lundail (`magearena_runeshop`) | Mage Arena cellar (Lundail); Wilderness ~53 via the Ardougne lever; three webs | - |  | 200 | 4 | +0.12 | 24 after 167 | 728 | 1 per 50 t, 180/h | config only (skipped: Wilderness death risk) |
| Water rune | Aubury (`runeshop`) | Aubury's, Varrock east | varrockEast 19 | aubury | 2,000 | 4 | +0.04 | 24 after 500 | 175 | 1 per 10 t, 900/h | pending |
| Water rune | Betty (`magicshop`) | Betty's, Port Sarim | draynor 80 | betty | 1,000 | 4 | +0.04 | 24 after 500 | 175 | 1 per 10 t, 900/h | pending |
| Water rune | Magic Store owner (`magicguildshop`) | Magic Guild 1st floor, Yanille; Magic 66 (guild door) | yanille 18 + stairs | magicGuild | 3,000 | 4 | +0.04 | 24 after 500 | 175 | 1 per 18 t, 500/h | config only (no reader with Magic 66) |
| Water rune | Tutab (`mm_magic_shop`) | Ape Atoll (Tutab); Monkey Madness, monkey greegree; never restocks | - |  | 1,000 | 4 | +0.04 | 24 after 500 | 175 | never | pending |
| Water rune | Lundail (`magearena_runeshop`) | Mage Arena cellar (Lundail); Wilderness ~53 via the Ardougne lever; three webs | - |  | 200 | 4 | +0.12 | 24 after 167 | 235 | 1 per 50 t, 180/h | config only (skipped: Wilderness death risk) |
| Earth rune | Aubury (`runeshop`) | Aubury's, Varrock east | varrockEast 19 | aubury | 2,000 | 4 | +0.04 | 24 after 500 | 255 | 1 per 10 t, 900/h | pending |
| Earth rune | Betty (`magicshop`) | Betty's, Port Sarim | draynor 80 | betty | 1,000 | 4 | +0.04 | 24 after 500 | 255 | 1 per 10 t, 900/h | pending |
| Earth rune | Magic Store owner (`magicguildshop`) | Magic Guild 1st floor, Yanille; Magic 66 (guild door) | yanille 18 + stairs | magicGuild | 3,000 | 4 | +0.04 | 24 after 500 | 255 | 1 per 18 t, 500/h | config only (no reader with Magic 66) |
| Earth rune | Tutab (`mm_magic_shop`) | Ape Atoll (Tutab); Monkey Madness, monkey greegree; never restocks | - |  | 1,000 | 4 | +0.04 | 24 after 500 | 255 | never | pending |
| Earth rune | Lundail (`magearena_runeshop`) | Mage Arena cellar (Lundail); Wilderness ~53 via the Ardougne lever; three webs | - |  | 200 | 4 | +0.12 | 24 after 167 | 373 | 1 per 50 t, 180/h | config only (skipped: Wilderness death risk) |
| Mind rune | Betty (`magicshop`) | Betty's, Port Sarim | draynor 80 | betty | 1,000 | 3 | +0.03 | 18 after 500 | - | 1 per 10 t, 900/h | pending |
| Mind rune | Aubury (`runeshop`) | Aubury's, Varrock east | varrockEast 19 | aubury | 1,000 | 3 | +0.03 | 18 after 500 | - | 1 per 10 t, 900/h | pending |
| Mind rune | Magic Store owner (`magicguildshop`) | Magic Guild 1st floor, Yanille; Magic 66 (guild door) | yanille 18 + stairs | magicGuild | 3,000 | 3 | +0.03 | 18 after 500 | - | 1 per 18 t, 500/h | config only (no reader with Magic 66) |
| Mind rune | Lundail (`magearena_runeshop`) | Mage Arena cellar (Lundail); Wilderness ~53 via the Ardougne lever; three webs | - |  | 140 | 3 | +0.09 | 18 (not reached; last unit 15) | - | 1 per 50 t, 180/h | config only (skipped: Wilderness death risk) |
| Nature rune | Magic Store owner (`magicguildshop`) | Magic Guild 1st floor, Yanille; Magic 66 (guild door) | yanille 18 + stairs | magicGuild | 1,000 | 20 | +0.2 | 120 after 500 | - | 1 per 300 t, 30/h | config only (no reader with Magic 66) |
| Nature rune | Lundail (`magearena_runeshop`) | Mage Arena cellar (Lundail); Wilderness ~53 via the Ardougne lever; three webs | - |  | 250 | 20 | +0.6 | 120 after 167 | - | 1 per 300 t, 30/h | config only (skipped: Wilderness death risk) |
| Rune arrow | Bow and Arrow salesman (`ranging_guild_bowshop`) | Ranging Guild, Kandarin; Ranged 40 (guild door) | seers 57 | dargaud | 400 | 400 | +4 | 2,400 (not reached; last unit 1,996) | 159,600 | 1 per 130 t, 69.2/h | config only (no reader with Ranged 40) |
| Rune arrow | Hickton (`archeryshop2`) | Hickton's, Catherby | catherby 13 | hickton | 0 | 400 | +4 | 2,400 | - | none (player-sold) | pending |
| Rune arrowtips | Hickton (`archeryshop2`) | Hickton's, Catherby | catherby 13 | hickton | 100 | 200 | +2 | 1,200 (not reached; last unit 398) | 29,900 for 100 | 1 per 40 t, 225/h | pending |
| Rune arrowtips | Bow and Arrow salesman (`ranging_guild_bowshop`) | Ranging Guild, Kandarin; Ranged 40 (guild door) | seers 57 | dargaud | 150 | 200 | +2 | 1,200 (not reached; last unit 498) | 52,350 for 150 | 1 per 60 t, 150/h | config only (no reader with Ranged 40) |
| Adamant arrowtips | Hickton (`archeryshop2`) | Hickton's, Catherby | catherby 13 | hickton | 200 | 40 | +0.4 | 240 (not reached; last unit 119) | 15,880 for 200 | 1 per 40 t, 225/h | pending |
| Adamant arrowtips | Bow and Arrow salesman (`ranging_guild_bowshop`) | Ranging Guild, Kandarin; Ranged 40 (guild door) | seers 57 | dargaud | 200 | 40 | +0.4 | 240 (not reached; last unit 119) | 15,880 for 200 | 1 per 50 t, 180/h | config only (no reader with Ranged 40) |
| Mithril arrowtips | Hickton (`archeryshop2`) | Hickton's, Catherby | catherby 13 | hickton | 400 | 16 | +0.16 | 96 (not reached; last unit 79) | 18,976 for 400 | 1 per 40 t, 225/h | pending |
| Mithril arrowtips | Gulluck (`gnomeshop_gulluck`) | Grand Tree 2nd floor, Gnome Stronghold | ardougneNorth 154 + stairs |  | 140 | 16 | +0.16 | 96 (not reached; last unit 38) | 3,730 for 140 | 1 per 80 t, 112.5/h | pending |
| Mithril arrowtips | Bow and Arrow salesman (`ranging_guild_bowshop`) | Ranging Guild, Kandarin; Ranged 40 (guild door) | seers 57 | dargaud | 200 | 16 | +0.16 | 96 (not reached; last unit 47) | 6,288 for 200 | 1 per 40 t, 225/h | config only (no reader with Ranged 40) |
| Mithril arrowtips | Shop keeper (`lathastrainingstore`) | Combat Training Camp, north of West Ardougne; Biohazard (camp gate) | ardougneNorth 101 |  | 800 | 24 | +0.16 | 104 after 500 | 62,920 for 800 | 1 per 80 t, 112.5/h | pending |
| Steel arrowtips | Hickton (`archeryshop2`) | Hickton's, Catherby | catherby 13 | hickton | 600 | 6 | +0.06 | 36 after 500 | 1,287 | 1 per 40 t, 225/h | pending |
| Steel arrowtips | Gulluck (`gnomeshop_gulluck`) | Grand Tree 2nd floor, Gnome Stronghold | ardougneNorth 154 + stairs |  | 160 | 6 | +0.06 | 36 (not reached; last unit 15) | 1,287 | 1 per 40 t, 225/h | pending |
| Steel arrowtips | Bow and Arrow salesman (`ranging_guild_bowshop`) | Ranging Guild, Kandarin; Ranged 40 (guild door) | seers 57 | dargaud | 300 | 6 | +0.06 | 36 (not reached; last unit 23) | 1,287 | 1 per 30 t, 300/h | config only (no reader with Ranged 40) |
| Steel arrowtips | Shop keeper (`lathastrainingstore`) | Combat Training Camp, north of West Ardougne; Biohazard (camp gate) | ardougneNorth 101 |  | 800 | 9 | +0.06 | 39 after 500 | 1,692 | 1 per 40 t, 225/h | pending |
| Iron arrowtips | Hickton (`archeryshop2`) | Hickton's, Catherby | catherby 13 | hickton | 800 | 2 | +0.02 | 12 after 500 | 220 | 1 per 20 t, 450/h | pending |
| Iron arrowtips | Gulluck (`gnomeshop_gulluck`) | Grand Tree 2nd floor, Gnome Stronghold | ardougneNorth 154 + stairs |  | 180 | 2 | +0.02 | 12 (not reached; last unit 5) | 220 | 1 per 20 t, 450/h | pending |
| Iron arrowtips | Bow and Arrow salesman (`ranging_guild_bowshop`) | Ranging Guild, Kandarin; Ranged 40 (guild door) | seers 57 | dargaud | 400 | 2 | +0.02 | 12 (not reached; last unit 9) | 220 | 1 per 20 t, 450/h | config only (no reader with Ranged 40) |
| Iron arrowtips | Shop keeper (`lathastrainingstore`) | Combat Training Camp, north of West Ardougne; Biohazard (camp gate) | ardougneNorth 101 |  | 800 | 3 | +0.02 | 13 after 500 | 310 | 1 per 20 t, 450/h | pending |
| Bronze arrowtips | Hickton (`archeryshop2`) | Hickton's, Catherby | catherby 13 | hickton | 1,000 | 1 | +0.01 | 6 after 500 | 60 | 1 per 10 t, 900/h | pending |
| Bronze arrowtips | Gulluck (`gnomeshop_gulluck`) | Grand Tree 2nd floor, Gnome Stronghold | ardougneNorth 154 + stairs |  | 200 | 1 | +0.01 | 6 (not reached; last unit 2) | 60 | 1 per 10 t, 900/h | pending |
| Bronze arrowtips | Shop keeper (`lathastrainingstore`) | Combat Training Camp, north of West Ardougne; Biohazard (camp gate) | ardougneNorth 101 |  | 800 | 1 | +0.01 | 6 after 500 | 70 | 1 per 10 t, 900/h | pending |
| Bronze arrowtips | Bow and Arrow salesman (`ranging_guild_bowshop`) | Ranging Guild, Kandarin; Ranged 40 (guild door) | seers 57 | dargaud | 500 | 1 | +0.01 | 6 after 500 | 60 | 1 per 10 t, 900/h | config only (no reader with Ranged 40) |
| Arrow shaft | Bow and Arrow salesman (`ranging_guild_bowshop`) | Ranging Guild, Kandarin; Ranged 40 (guild door) | seers 57 | dargaud | 1,000 | 1 | +0.01 | 6 after 500 | 4,500 for 1,000 | 1 per 50 t, 180/h | config only (no reader with Ranged 40) |
| Feather | Gerrant (`fishingshop`) | Gerrant's, Port Sarim | draynor 79 | gerrant | 1,000 | 2 | +0.02 | 12 after 500 | 9,250 for 1,000 | 1 per 1 t, 9,000/h | pending |
| Feather | Roachey (`fishingguild`) | Fishing Guild, Hemenster; Fishing 68 (guild door) | ardougneNorth 67 |  | 1,500 | 2 | +0.02 | 12 after 500 | 15,250 for 1,500 | 1 per 1 t, 9,000/h | pending |
| Feather | Fish monger (`viking_fishmonger`) | Rellekka fishmonger; Fremennik Trials | - |  | 1,000 | 2 | +0.06 | 12 after 167 | 11,180 for 1,000 | 1 per 1 t, 9,000/h | pending |
| Feather | Fishmonger (`etc_fishmonger`) | Etceteria fishmonger; Fremennik Trials (ship) | - |  | 1,000 | 2 | +0.06 | 12 after 167 | 11,180 for 1,000 | 1 per 1 t, 9,000/h | pending |
| Feather | Fishmonger (`misc_fishmonger`) | Miscellania fishmonger; Fremennik Trials (ship) | - |  | 1,000 | 2 | +0.06 | 12 after 167 | 11,180 for 1,000 | 1 per 1 t, 9,000/h | pending |
| Feather | Shantay (`shantayshop`) | Shantay Pass; toll gate (10 gp) from Lumbridge | alKharid 44 | shantay | 500 | 2 | +0.02 | 12 after 500 | 3,250 for 500 | 1 per 50 t, 180/h | pending |
| Antipoison(3) | Jiminua (`junglestore`) | Jiminua's, Karamja jungle; ship to Karamja (30 gp) | - | jiminua | 10 | 432 | +5.76 | 1,872 (not reached; last unit 483) | - | 1 per 150 t, 60/h | pending |
| Raw shark | Rufus (`werewolfstore1`) | Rufus's, Canifis; Priest in Peril | - |  | 1 | 390 | +9 | 1,890 (not reached; last unit 390) | - | 1 per 1,000 t, 9/h | pending |
| Raw shark | Harry (`fishingshop2`) | Harry's, Catherby | catherby 25 |  | 0 | 300 | +3 | 1,800 | - | none (player-sold) | pending |
| Raw shark | Fish monger (`viking_fishmonger`) | Rellekka fishmonger; Fremennik Trials | - |  | 0 | 390 | +9 | 1,890 | - | none (player-sold) | pending |
| Raw shark | Fishmonger (`etc_fishmonger`) | Etceteria fishmonger; Fremennik Trials (ship) | - |  | 0 | 390 | +9 | 1,890 | - | none (player-sold) | pending |
| Raw shark | Fishmonger (`misc_fishmonger`) | Miscellania fishmonger; Fremennik Trials (ship) | - |  | 0 | 390 | +9 | 1,890 | - | none (player-sold) | pending |
| Swordfish | Alfonse the waiter (`karamja_fishrestaurant`) | Shrimp and Parrot, Brimhaven; ship to Brimhaven | - |  | 2 | 260 | +6 | 1,260 (not reached; last unit 266) | - | 1 per 2,900 t, 3.1/h | pending |
| Swordfish | Fionella (`generallegends`) | Legends' Guild 1st floor; Legends' Quest | catherby 84 + stairs |  | 20 | 310 | +2 | 1,310 (not reached; last unit 348) | - | 1 per 200 t, 45/h | pending |
| Swordfish | Roachey (`fishingguild`) | Fishing Guild, Hemenster; Fishing 68 (guild door) | ardougneNorth 67 |  | 0 | 200 | +2 | 1,200 | - | none (player-sold) | pending |
| Lobster | Alfonse the waiter (`karamja_fishrestaurant`) | Shrimp and Parrot, Brimhaven; ship to Brimhaven | - |  | 3 | 195 | +4.5 | 945 (not reached; last unit 204) | - | 1 per 2,600 t, 3.5/h | pending |
| Lobster | Roachey (`fishingguild`) | Fishing Guild, Hemenster; Fishing 68 (guild door) | ardougneNorth 67 |  | 0 | 150 | +1.5 | 900 | - | none (player-sold) | pending |
| Cooked karambwan | Alfonse the waiter (`karamja_fishrestaurant`) | Shrimp and Parrot, Brimhaven; ship to Brimhaven | - |  | 3 | 325 | +7.5 | 1,575 (not reached; last unit 340) | - | 1 per 900 t, 10/h | pending |
| Cake | Baker (`bakery`) | Bakery stall, East Ardougne market | ardougneSouth 28 |  | 3 | 50 | +1 | 300 (not reached; last unit 52) | - | 1 per 800 t, 11.3/h | pending |
| Sapphire ring | Grum (`goldshop`) | Grum's, Port Sarim | draynor 79 |  | 0 | 900 | +18 | 5,400 | - | none (player-sold) | pending |
| Emerald ring | Grum (`goldshop`) | Grum's, Port Sarim | draynor 79 |  | 0 | 1,275 | +25.5 | 7,650 | - | none (player-sold) | pending |
| Ruby ring | Irksol (`cheapringshop`) | Irksol's, Zanaris; Lost City | - |  | 5 | 1,012 | +20.25 | 11,137 (not reached; last unit 1,093) | 5,263 for 5 | 1 per 500 t, 18/h | config only (no reader with Lost City) |
| Ruby ring | Grum (`goldshop`) | Grum's, Port Sarim | draynor 79 |  | 0 | 2,025 | +40.5 | 12,150 | - | none (player-sold) | pending |
| Diamond ring | Grum (`goldshop`) | Grum's, Port Sarim | draynor 79 |  | 0 | 3,525 | +70.5 | 21,150 | - | none (player-sold) | pending |
| Amulet of magic | Davon (`amuletshop`) | Davon's, Brimhaven; ship to Brimhaven | - |  | 0 | 1,080 | +18 | 5,580 | - | none (player-sold) | pending |
| Amulet of strength | Davon (`amuletshop`) | Davon's, Brimhaven; ship to Brimhaven | - |  | 0 | 2,430 | +40.5 | 12,555 | - | none (player-sold) | pending |
| Gold bar | Drogo dwarf (`miningstore`) | Drogo's, Dwarven Mine; underground (Ice Mountain trapdoor) | edgeville 57 + ladder |  | 0 | 300 | +6 | 1,800 | - | none (player-sold) | pending |
| Uncut diamond | Herquin (`gemshop`) | Herquin's, Falador | faladorWest 35 |  | 0 | 200 | +6 | 1,200 | - | none (player-sold) | pending |
| Uncut diamond | Gem trader (`gemshop2`) | Gem trader, Al Kharid; toll gate (10 gp) from Lumbridge | alKharid 45 |  | 0 | 200 | +6 | 1,200 | - | none (player-sold) | pending |
| Uncut ruby | Herquin (`gemshop`) | Herquin's, Falador | faladorWest 35 |  | 0 | 100 | +3 | 600 | - | none (player-sold) | pending |
| Uncut ruby | Gem trader (`gemshop2`) | Gem trader, Al Kharid; toll gate (10 gp) from Lumbridge | alKharid 45 |  | 0 | 100 | +3 | 600 | - | none (player-sold) | pending |
| Uncut emerald | Gem trader (`gemshop2`) | Gem trader, Al Kharid; toll gate (10 gp) from Lumbridge | alKharid 45 |  | 1 | 50 | +1.5 | 300 (not reached; last unit 50) | - | 1 per 40,000 t, 0.2/h | pending |
| Uncut emerald | Herquin (`gemshop`) | Herquin's, Falador | faladorWest 35 |  | 0 | 50 | +1.5 | 300 | - | none (player-sold) | pending |
| Uncut sapphire | Herquin (`gemshop`) | Herquin's, Falador | faladorWest 35 |  | 1 | 25 | +0.75 | 150 (not reached; last unit 25) | - | 1 per 25,000 t, 0.4/h | pending |
| Uncut sapphire | Gem trader (`gemshop2`) | Gem trader, Al Kharid; toll gate (10 gp) from Lumbridge | alKharid 45 |  | 1 | 25 | +0.75 | 150 (not reached; last unit 25) | - | 1 per 25,000 t, 0.4/h | pending |
| Diamond | Herquin (`gemshop`) | Herquin's, Falador | faladorWest 35 |  | 0 | 2,000 | +60 | 12,000 | - | none (player-sold) | pending |
| Diamond | Gem trader (`gemshop2`) | Gem trader, Al Kharid; toll gate (10 gp) from Lumbridge | alKharid 45 |  | 0 | 2,000 | +60 | 12,000 | - | none (player-sold) | pending |
| Diamond | Gem merchant (`ardougnegemstall`) | Gem stall, East Ardougne market | ardougneSouth 20 |  | 0 | 3,000 | +60 | 13,000 | - | none (player-sold) | pending |
| Ruby | Gem merchant (`ardougnegemstall`) | Gem stall, East Ardougne market | ardougneSouth 20 |  | 1 | 1,500 | +30 | 6,500 (not reached; last unit 1,500) | - | 1 per 60,000 t, 0.2/h | pending |
| Ruby | Herquin (`gemshop`) | Herquin's, Falador | faladorWest 35 |  | 0 | 1,000 | +30 | 6,000 | - | none (player-sold) | pending |
| Ruby | Gem trader (`gemshop2`) | Gem trader, Al Kharid; toll gate (10 gp) from Lumbridge | alKharid 45 |  | 0 | 1,000 | +30 | 6,000 | - | none (player-sold) | pending |
| Emerald | Gem trader (`gemshop2`) | Gem trader, Al Kharid; toll gate (10 gp) from Lumbridge | alKharid 45 |  | 1 | 500 | +15 | 3,000 (not reached; last unit 500) | - | 1 per 35,000 t, 0.3/h | pending |
| Emerald | Gem merchant (`ardougnegemstall`) | Gem stall, East Ardougne market | ardougneSouth 20 |  | 1 | 750 | +15 | 3,250 (not reached; last unit 750) | - | 1 per 35,000 t, 0.3/h | pending |
| Emerald | Herquin (`gemshop`) | Herquin's, Falador | faladorWest 35 |  | 0 | 500 | +15 | 3,000 | - | none (player-sold) | pending |
| Sapphire | Herquin (`gemshop`) | Herquin's, Falador | faladorWest 35 |  | 1 | 250 | +7.5 | 1,500 (not reached; last unit 250) | - | 1 per 15,000 t, 0.6/h | pending |
| Sapphire | Gem trader (`gemshop2`) | Gem trader, Al Kharid; toll gate (10 gp) from Lumbridge | alKharid 45 |  | 1 | 250 | +7.5 | 1,500 (not reached; last unit 250) | - | 1 per 15,000 t, 0.6/h | pending |
| Sapphire | Gem merchant (`ardougnegemstall`) | Gem stall, East Ardougne market | ardougneSouth 20 |  | 2 | 375 | +7.5 | 1,625 (not reached; last unit 382) | - | 1 per 15,000 t, 0.6/h | pending |
| Staff of water | zaff (`memberstaffshop`) | Zaff's, Varrock | varrockWest 18 | zaff | 2 | 1,500 | +30 | 9,000 (not reached; last unit 1,530) | 1,500 | 1 per 1,000 t, 9/h | pending |
| Staff of water | Magic Store owner (`magicguildshop`) | Magic Guild 1st floor, Yanille; Magic 66 (guild door) | yanille 18 + stairs | magicGuild | 2 | 1,500 | +15 | 9,000 (not reached; last unit 1,515) | 1,500 | 1 per 1,000 t, 9/h | config only (no reader with Magic 66) |
| Staff of fire | zaff (`memberstaffshop`) | Zaff's, Varrock | varrockWest 18 | zaff | 2 | 1,500 | +30 | 9,000 (not reached; last unit 1,530) | 1,500 | 1 per 1,000 t, 9/h | pending |
| Staff of fire | Magic Store owner (`magicguildshop`) | Magic Guild 1st floor, Yanille; Magic 66 (guild door) | yanille 18 + stairs | magicGuild | 2 | 1,500 | +15 | 9,000 (not reached; last unit 1,515) | 1,500 | 1 per 1,000 t, 9/h | config only (no reader with Magic 66) |
| Staff of air | zaff (`memberstaffshop`) | Zaff's, Varrock | varrockWest 18 | zaff | 2 | 1,500 | +30 | 9,000 (not reached; last unit 1,530) | - | 1 per 1,000 t, 9/h | pending |
| Staff of air | Magic Store owner (`magicguildshop`) | Magic Guild 1st floor, Yanille; Magic 66 (guild door) | yanille 18 + stairs | magicGuild | 2 | 1,500 | +15 | 9,000 (not reached; last unit 1,515) | - | 1 per 1,000 t, 9/h | config only (no reader with Magic 66) |
| Iron bar | Drogo dwarf (`miningstore`) | Drogo's, Dwarven Mine; underground (Ice Mountain trapdoor) | edgeville 57 + ladder |  | 0 | 28 | +0.56 | 168 | - | none (player-sold) | pending |
| Bronze bar | Shantay (`shantayshop`) | Shantay Pass; toll gate (10 gp) from Lumbridge | alKharid 44 | shantay | 10 | 8 | +0.08 | 48 (not reached; last unit 8) | 80 for 10 | 1 per 500 t, 18/h | pending |
| Bronze bar | Obli (`shilojunglestore`) | Obli's, Shilo Village; Shilo Village | - |  | 10 | 12 | +0.16 | 52 (not reached; last unit 13) | 123 for 10 | 1 per 500 t, 18/h | pending |
| Bronze bar | Jiminua (`junglestore`) | Jiminua's, Karamja jungle; ship to Karamja (30 gp) | - | jiminua | 10 | 12 | +0.16 | 52 (not reached; last unit 13) | 123 for 10 | 1 per 500 t, 18/h | pending |
| Bronze bar | Drogo dwarf (`miningstore`) | Drogo's, Dwarven Mine; underground (Ice Mountain trapdoor) | edgeville 57 + ladder |  | 0 | 8 | +0.16 | 48 | - | none (player-sold) | pending |
| Iron ore | Drogo dwarf (`miningstore`) | Drogo's, Dwarven Mine; underground (Ice Mountain trapdoor) | edgeville 57 + ladder |  | 0 | 17 | +0.34 | 102 | - | none (player-sold) | pending |
| Coal | Drogo dwarf (`miningstore`) | Drogo's, Dwarven Mine; underground (Ice Mountain trapdoor) | edgeville 57 + ladder |  | 0 | 45 | +0.9 | 270 | - | none (player-sold) | pending |
| Jug of water | Shantay (`shantayshop`) | Shantay Pass; toll gate (10 gp) from Lumbridge | alKharid 44 | shantay | 10 | 1 | +0.01 | 6 (not reached; last unit 1) | 10 for 10 | 1 per 100 t, 90/h | pending |
| Jug of water | Jossik (`lighthouseshop`) | Lighthouse (Jossik); Horror from the Deep | - |  | 5 | 1 | +0.03 | 6 (not reached; last unit 1) | 5 for 5 | 1 per 500 t, 18/h | pending |
| Jug of water | Bedabin Nomad (`bedabincampshop`) | Bedabin Camp, Kharidian Desert; Shantay pass, desert heat | alKharid 125 |  | 5 | 1 | +0.03 | 6 (not reached; last unit 1) | 5 for 5 | 1 per 100 t, 90/h | pending |
| Eye of newt | Jatix (`herbloreshop`) | Jatix's, Taverley | faladorWest 58 |  | 800 | 3 | +0.09 | 18 after 167 | 7,317 | 1 per 20 t, 450/h | pending |
| Eye of newt | Betty (`magicshop`) | Betty's, Port Sarim | draynor 80 | betty | 300 | 3 | +0.03 | 18 (not reached; last unit 11) | 2,097 for 300 | 1 per 10 t, 900/h | pending |
| Eye of newt | Ogre merchant (`herbloreshopogre`) | Gu'Tanoth ogre merchant; Watchtower | yanille 85 |  | 50 | 3 | +0.09 | 18 (not reached; last unit 8) | 280 for 50 | 1 per 20 t, 450/h | pending |
| Eye of newt | Frincos (`herbloreshop2`) | Frincos's, Entrana; ship to Entrana (no weapons or armour) | - |  | 50 | 3 | +0.06 | 18 (not reached; last unit 5) | 199 for 50 | 1 per 20 t, 450/h | pending |
| Vial of water | Aemad / Kortan (`adventurershop`) | Aemad and Kortan's, East Ardougne | ardougneNorth 39 | aemad | 500 | 2 | +0.04 | 12 after 250 | - | 1 per 30 t, 300/h | pending |
| Vial of water | razmire_keelgan (`razmiregeneralstore`) | Razmire's, Mort'ton; Shades of Mort'ton | - |  | 100 | 2 | +0.06 | 12 (not reached; last unit 8) | - | 1 per 100 t, 90/h | pending |
| Vial of water | Jossik (`lighthouseshop`) | Lighthouse (Jossik); Horror from the Deep | - |  | 100 | 2 | +0.06 | 12 (not reached; last unit 8) | - | 1 per 500 t, 18/h | pending |
| Vial of water | Sigmund The Merchant (`viking_general_store`) | Rellekka general store; Fremennik Trials | - |  | 10 | 2 | +0.06 | 12 (not reached; last unit 3) | - | 1 per 200 t, 45/h | pending |
| Vial of water | Obli (`shilojunglestore`) | Obli's, Shilo Village; Shilo Village | - |  | 50 | 3 | +0.04 | 13 (not reached; last unit 4) | - | 1 per 200 t, 45/h | pending |
| Vial of water | Jiminua (`junglestore`) | Jiminua's, Karamja jungle; ship to Karamja (30 gp) | - | jiminua | 50 | 3 | +0.04 | 13 (not reached; last unit 4) | - | 1 per 200 t, 45/h | pending |
| Rune pickaxe | Nurmof (`pickaxeshop`) | Nurmof's, Dwarven Mine; underground (Ice Mountain trapdoor) | faladorWest 75 + ladder | nurmof | 1 | 32,000 | +640 | 192,000 (not reached; last unit 32,000) | 32,000 | 1 per 700 t, 12.9/h | pending |
| Mithril scimitar | Daga (`mm_scimitar_shop`) | Ape Atoll (Daga); Monkey Madness, monkey greegree; never restocks | - |  | 6 | 1,040 | +20.8 | 6,240 (not reached; last unit 1,144) | 1,040 | never | pending |
| Mithril scimitar | Zeke (`scimitarshop`) | Zeke's, Al Kharid; toll gate (10 gp) from Lumbridge | alKharid 23 | zeke | 1 | 1,040 | +20.8 | 6,240 (not reached; last unit 1,040) | 1,040 | 1 per 4,000 t, 2.3/h | pending |
| Adamant full helm | Peksa (`helmetshop`) | Peksa's, Barbarian Village | edgeville 62 | peksa | 1 | 3,520 | +35.2 | 21,120 (not reached; last unit 3,520) | 3,520 | 1 per 12,000 t, 0.8/h | pending |
| Knife | Hudo (`gnomeshop_hudo`) | Grand Tree 1st floor (Hudo) | ardougneNorth 176 + stairs | hudo | 5 | 6 | +0.06 | 36 (not reached; last unit 6) | 6 | 1 per 200 t, 45/h | pending |
| Knife | Heckel Funch (`gnomeshop_heck`) | Grand Tree 1st floor (Heckel Funch) | ardougneNorth 155 + stairs | heckel | 5 | 6 | +0.06 | 36 (not reached; last unit 6) | 6 | 1 per 200 t, 45/h | pending |
| Knife | Jossik (`lighthouseshop`) | Lighthouse (Jossik); Horror from the Deep | - |  | 10 | 6 | +0.18 | 36 (not reached; last unit 8) | 6 | 1 per 500 t, 18/h | pending |
| Knife | Shantay (`shantayshop`) | Shantay Pass; toll gate (10 gp) from Lumbridge | alKharid 44 | shantay | 10 | 6 | +0.06 | 36 (not reached; last unit 6) | 6 | 1 per 100 t, 90/h | pending |
| Knife | Bedabin Nomad (`bedabincampshop`) | Bedabin Camp, Kharidian Desert; Shantay pass, desert heat | alKharid 125 |  | 5 | 7 | +0.18 | 37 (not reached; last unit 7) | 7 | 1 per 100 t, 90/h | pending |
| Knife | Jiminua (`junglestore`) | Jiminua's, Karamja jungle; ship to Karamja (30 gp) | - | jiminua | 2 | 9 | +0.12 | 39 (not reached; last unit 9) | 9 | 1 per 100 t, 90/h | pending |
| Fly fishing rod | Gerrant (`fishingshop`) | Gerrant's, Port Sarim | draynor 79 | gerrant | 5 | 5 | +0.05 | 30 (not reached; last unit 5) | 5 | 1 per 100 t, 90/h | pending |
| Fly fishing rod | Fernahei (`shilofishingshop`) | Fernahei's, Shilo Village; Shilo Village | - |  | 5 | 5 | +0.1 | 30 (not reached; last unit 5) | 5 | 1 per 100 t, 90/h | pending |
| Fly fishing rod | Fish monger (`viking_fishmonger`) | Rellekka fishmonger; Fremennik Trials | - |  | 5 | 6 | +0.15 | 31 (not reached; last unit 7) | 6 | 1 per 100 t, 90/h | pending |
| Fly fishing rod | Fishmonger (`etc_fishmonger`) | Etceteria fishmonger; Fremennik Trials (ship) | - |  | 5 | 6 | +0.15 | 31 (not reached; last unit 7) | 6 | 1 per 100 t, 90/h | pending |
| Fly fishing rod | Fishmonger (`misc_fishmonger`) | Miscellania fishmonger; Fremennik Trials (ship) | - |  | 5 | 6 | +0.15 | 31 (not reached; last unit 7) | 6 | 1 per 100 t, 90/h | pending |
| Fishing rod | Harry (`fishingshop2`) | Harry's, Catherby | catherby 25 |  | 5 | 5 | +0.05 | 30 (not reached; last unit 5) | 5 | 1 per 100 t, 90/h | pending |
| Fishing rod | Gerrant (`fishingshop`) | Gerrant's, Port Sarim | draynor 79 | gerrant | 5 | 5 | +0.05 | 30 (not reached; last unit 5) | 5 | 1 per 100 t, 90/h | pending |
| Fishing rod | Fernahei (`shilofishingshop`) | Fernahei's, Shilo Village; Shilo Village | - |  | 5 | 5 | +0.1 | 30 (not reached; last unit 5) | 5 | 1 per 100 t, 90/h | pending |
| Fishing rod | Fish monger (`viking_fishmonger`) | Rellekka fishmonger; Fremennik Trials | - |  | 5 | 6 | +0.15 | 31 (not reached; last unit 7) | 6 | 1 per 100 t, 90/h | pending |
| Fishing rod | Fishmonger (`etc_fishmonger`) | Etceteria fishmonger; Fremennik Trials (ship) | - |  | 5 | 6 | +0.15 | 31 (not reached; last unit 7) | 6 | 1 per 100 t, 90/h | pending |
| Fishing bait | Gerrant (`fishingshop`) | Gerrant's, Port Sarim | draynor 79 | gerrant | 1,500 | 3 | +0.03 | 18 after 500 | 12 | 1 per 1 t, 9,000/h | pending |
| Fishing bait | Harry (`fishingshop2`) | Harry's, Catherby | catherby 25 |  | 1,200 | 3 | +0.03 | 18 after 500 | 12 | 1 per 1 t, 9,000/h | pending |
| Fishing bait | Roachey (`fishingguild`) | Fishing Guild, Hemenster; Fishing 68 (guild door) | ardougneNorth 67 |  | 2,000 | 3 | +0.03 | 18 after 500 | 12 | 1 per 1 t, 9,000/h | pending |
| Fishing bait | Fish monger (`viking_fishmonger`) | Rellekka fishmonger; Fremennik Trials | - |  | 1,500 | 3 | +0.09 | 18 after 167 | 14 | 1 per 1 t, 9,000/h | pending |
| Fishing bait | Fishmonger (`etc_fishmonger`) | Etceteria fishmonger; Fremennik Trials (ship) | - |  | 1,500 | 3 | +0.09 | 18 after 167 | 14 | 1 per 1 t, 9,000/h | pending |
| Chisel | Wistan (`death_generalshop`) | Burthorpe general store | catherby 119 |  | 2 | 1 | +0.03 | 6 (not reached; last unit 1) | 1 | 1 per 100 t, 90/h | pending |
| Chisel | Bolkoy (`gnomeshop`) | Bolkoy's, Tree Gnome Village | yanille 86 + stairs |  | 2 | 1 | +0.03 | 6 (not reached; last unit 1) | 1 | 1 per 100 t, 90/h | pending |
| Chisel | Shop keeper / Shop assistant (`generalshop4`) | Falador general store | faladorWest 17 |  | 2 | 1 | +0.03 | 6 (not reached; last unit 1) | 1 | 1 per 100 t, 90/h | pending |
| Chisel | Arhein (`arheinstore`) | Arhein's, Catherby | catherby 9 |  | 2 | 1 | +0.03 | 6 (not reached; last unit 1) | 1 | 1 per 100 t, 90/h | pending |
| Chisel | Shop keeper (`khazardshop`) | Port Khazard general store | yanille 79 | khazard | 2 | 1 | +0.01 | 6 (not reached; last unit 1) | 1 | 1 per 100 t, 90/h | pending |
| Chisel | Shop keeper / Shop assistant (`generalshop1`) | Lumbridge general store | alKharid 80 | lumbridgeGeneral | 2 | 1 | +0.03 | 6 (not reached; last unit 1) | 1 | 1 per 100 t, 90/h | pending |
| Chisel | Shop keeper / Shop assistant (`generalshop2`) | Varrock general store | varrockWest 33 | varrockGeneral | 2 | 1 | +0.03 | 6 (not reached; last unit 1) | 1 | 1 per 100 t, 90/h | pending |
| Chisel | Jiminua (`junglestore`) | Jiminua's, Karamja jungle; ship to Karamja (30 gp) | - | jiminua | 10 | 1 | +0.02 | 6 (not reached; last unit 1) | 1 | 1 per 500 t, 18/h | pending |
| Hammer | Wistan (`death_generalshop`) | Burthorpe general store | catherby 119 |  | 5 | 1 | +0.03 | 6 (not reached; last unit 1) | 1 | 1 per 100 t, 90/h | pending |
| Hammer | Bolkoy (`gnomeshop`) | Bolkoy's, Tree Gnome Village | yanille 86 + stairs |  | 5 | 1 | +0.03 | 6 (not reached; last unit 1) | 1 | 1 per 100 t, 90/h | pending |
| Hammer | Shop keeper / Shop assistant (`generalshop4`) | Falador general store | faladorWest 17 |  | 5 | 1 | +0.03 | 6 (not reached; last unit 1) | 1 | 1 per 100 t, 90/h | pending |
| Hammer | Arhein (`arheinstore`) | Arhein's, Catherby | catherby 9 |  | 5 | 1 | +0.03 | 6 (not reached; last unit 1) | 1 | 1 per 100 t, 90/h | pending |
| Hammer | Shop keeper (`khazardshop`) | Port Khazard general store | yanille 79 | khazard | 5 | 1 | +0.01 | 6 (not reached; last unit 1) | 1 | 1 per 100 t, 90/h | pending |
| Hammer | Shop keeper / Shop assistant (`generalshop1`) | Lumbridge general store | alKharid 80 | lumbridgeGeneral | 5 | 1 | +0.03 | 6 (not reached; last unit 1) | 1 | 1 per 100 t, 90/h | pending |
| Hammer | Shop keeper / Shop assistant (`generalshop2`) | Varrock general store | varrockWest 33 | varrockGeneral | 5 | 1 | +0.03 | 6 (not reached; last unit 1) | 1 | 1 per 100 t, 90/h | pending |
| Hammer | Jiminua (`junglestore`) | Jiminua's, Karamja jungle; ship to Karamja (30 gp) | - | jiminua | 10 | 1 | +0.02 | 6 (not reached; last unit 1) | 1 | 1 per 500 t, 18/h | pending |
| Hammer | Shantay (`shantayshop`) | Shantay Pass; toll gate (10 gp) from Lumbridge | alKharid 44 | shantay | 10 | 1 | +0.01 | 6 (not reached; last unit 1) | 1 | 1 per 500 t, 18/h | pending |
| Pot of flour | Frenita (`cookeryshop`) | Frenita's, Yanille | yanille 47 |  | 8 | 10 | +0.1 | 60 (not reached; last unit 10) | 10 | 1 per 100 t, 90/h | pending |
| Pot of flour | Hudo (`gnomeshop_hudo`) | Grand Tree 1st floor (Hudo) | ardougneNorth 176 + stairs | hudo | 5 | 10 | +0.1 | 60 (not reached; last unit 10) | 10 | 1 per 200 t, 45/h | pending |
| Pot of flour | Wydin (`wydinstore`) | Wydin's, Port Sarim | draynor 78 | wydin | 3 | 10 | +0.1 | 60 (not reached; last unit 10) | 10 | 1 per 100 t, 90/h | pending |
| Pot of flour | razmire_keelgan (`razmiregeneralstore`) | Razmire's, Mort'ton; Shades of Mort'ton | - |  | 100 | 13 | +0.3 | 63 (not reached; last unit 42) | 13 | 1 per 10 t, 900/h | pending |
| Pot of flour | Shop keeper (`khazardshop`) | Port Khazard general store | yanille 79 | khazard | 30 | 14 | +0.1 | 64 (not reached; last unit 16) | 14 | 1 per 100 t, 90/h | pending |
| Banana | Wydin (`wydinstore`) | Wydin's, Port Sarim | draynor 78 | wydin | 3 | 2 | +0.02 | 12 (not reached; last unit 2) | 6 for 3 | 1 per 100 t, 90/h | pending |
| Banana | Solihib (`mm_food_shop`) | Ape Atoll (Solihib); Monkey Madness; never restocks | - |  | 10 | 2 | +0.04 | 12 (not reached; last unit 2) | 10 | never | pending |
| Raw beef | Wydin (`wydinstore`) | Wydin's, Port Sarim | draynor 78 | wydin | 1 | 1 | +0.01 | 6 (not reached; last unit 1) | 1 | 1 per 100 t, 90/h | pending |
| Raw beef | Rufus (`werewolfstore1`) | Rufus's, Canifis; Priest in Peril | - |  | 10 | 1 | +0.03 | 6 (not reached; last unit 1) | 1 | 1 per 100 t, 90/h | pending |
| Raw chicken | Wydin (`wydinstore`) | Wydin's, Port Sarim | draynor 78 | wydin | 1 | 1 | +0.01 | 6 (not reached; last unit 1) | 1 | 1 per 100 t, 90/h | pending |
| Raw chicken | Rufus (`werewolfstore1`) | Rufus's, Canifis; Priest in Peril | - |  | 10 | 1 | +0.03 | 6 (not reached; last unit 1) | 1 | 1 per 100 t, 90/h | pending |
| Lobster pot | Harry (`fishingshop2`) | Harry's, Catherby | catherby 25 |  | 2 | 20 | +0.2 | 120 (not reached; last unit 20) | 20 | 1 per 400 t, 22.5/h | pending |
| Lobster pot | Gerrant (`fishingshop`) | Gerrant's, Port Sarim | draynor 79 | gerrant | 2 | 20 | +0.2 | 120 (not reached; last unit 20) | 20 | 1 per 400 t, 22.5/h | pending |
| Lobster pot | Fish monger (`viking_fishmonger`) | Rellekka fishmonger; Fremennik Trials | - |  | 2 | 26 | +0.6 | 126 (not reached; last unit 26) | 26 | 1 per 400 t, 22.5/h | pending |
| Lobster pot | Fishmonger (`etc_fishmonger`) | Etceteria fishmonger; Fremennik Trials (ship) | - |  | 2 | 26 | +0.6 | 126 (not reached; last unit 26) | 26 | 1 per 400 t, 22.5/h | pending |
| Lobster pot | Fishmonger (`misc_fishmonger`) | Miscellania fishmonger; Fremennik Trials (ship) | - |  | 2 | 26 | +0.6 | 126 (not reached; last unit 26) | 26 | 1 per 400 t, 22.5/h | pending |
| Silk | Thessalia (`clotheshop`) | Thessalia's, Varrock | varrockWest 21 | thessalia | 5 | 30 | +0.3 | 180 (not reached; last unit 31) | 30 | 1 per 500 t, 18/h | pending |
| Rope | Ifaba (`mm_general_shop`) | Ape Atoll (Ifaba); Monkey Madness; never restocks | - |  | 8 | 18 | +0.36 | 108 (not reached; last unit 20) | 18 | never | pending |
| Rope | Jossik (`lighthouseshop`) | Lighthouse (Jossik); Horror from the Deep | - |  | 10 | 19 | +0.54 | 109 (not reached; last unit 24) | 19 | 1 per 200 t, 45/h | pending |
| Rope | Chadwell (`upassgeneralshop`) | Chadwell's, Underground Pass entrance | ardougneNorth 151 |  | 3 | 21 | +0.36 | 111 (not reached; last unit 22) | 21 | 1 per 100 t, 90/h | pending |
| Rope | Aemad / Kortan (`adventurershop`) | Aemad and Kortan's, East Ardougne | ardougneNorth 39 | aemad | 20 | 23 | +0.36 | 113 (not reached; last unit 30) | 23 | 1 per 100 t, 90/h | pending |
| Rope | Arhein (`arheinstore`) | Arhein's, Catherby | catherby 9 |  | 2 | 23 | +0.54 | 113 (not reached; last unit 23) | 23 | 1 per 300 t, 30/h | pending |
| Rope | Shop keeper (`khazardshop`) | Port Khazard general store | yanille 79 | khazard | 30 | 25 | +0.18 | 115 (not reached; last unit 30) | 25 | 1 per 20 t, 450/h | pending |
| Rope | Jiminua (`junglestore`) | Jiminua's, Karamja jungle; ship to Karamja (30 gp) | - | jiminua | 10 | 27 | +0.36 | 117 (not reached; last unit 30) | 27 | 1 per 200 t, 45/h | pending |
| Spade | Sigmund The Merchant (`viking_general_store`) | Rellekka general store; Fremennik Trials | - |  | 10 | 3 | +0.09 | 18 (not reached; last unit 4) | 3 | 1 per 500 t, 18/h | pending |
| Spade | Jossik (`lighthouseshop`) | Lighthouse (Jossik); Horror from the Deep | - |  | 10 | 3 | +0.09 | 18 (not reached; last unit 4) | 3 | 1 per 500 t, 18/h | pending |
| Spade | Obli (`shilojunglestore`) | Obli's, Shilo Village; Shilo Village | - |  | 10 | 4 | +0.06 | 19 (not reached; last unit 5) | 4 | 1 per 500 t, 18/h | pending |
| Spade | Jiminua (`junglestore`) | Jiminua's, Karamja jungle; ship to Karamja (30 gp) | - | jiminua | 10 | 4 | +0.06 | 19 (not reached; last unit 5) | 4 | 1 per 500 t, 18/h | pending |
| Swamp paste | razmire_keelgan (`razmirebuildingstore`) | Razmire's builders' store, Mort'ton; Shades of Mort'ton | - |  | 1,000 | 31 | +1.2 | 181 after 125 | 31 | 1 per 10 t, 900/h | pending |
| Swamp paste | Shop keeper (`khazardshop`) | Port Khazard general store | yanille 79 | khazard | 500 | 42 | +0.3 | 192 after 500 | 42 | 1 per 20 t, 450/h | pending |
| Ball of wool | Aemad / Kortan (`adventurershop`) | Aemad and Kortan's, East Ardougne | ardougneNorth 39 | aemad | 30 | 2 | +0.04 | 12 (not reached; last unit 3) | 2 | 1 per 100 t, 90/h | pending |
| Ball of wool | Hamab (`mm_crafting_shop`) | Ape Atoll (Hamab); Monkey Madness; never restocks | - |  | 100 | 2 | +0.04 | 12 (not reached; last unit 5) | 2 | never | pending |
| Dwellberries | Hudo (`gnomeshop_hudo`) | Grand Tree 1st floor (Hudo) | ardougneNorth 176 + stairs | hudo | 3 | 4 | +0.04 | 24 (not reached; last unit 4) | 4 | 1 per 100 t, 90/h | pending |
| Dwellberries | Heckel Funch (`gnomeshop_heck`) | Grand Tree 1st floor (Heckel Funch) | ardougneNorth 155 + stairs | heckel | 3 | 4 | +0.04 | 24 (not reached; last unit 4) | 4 | 1 per 100 t, 90/h | pending |
| Chocolate dust | Hudo (`gnomeshop_hudo`) | Grand Tree 1st floor (Hudo) | ardougneNorth 176 + stairs | hudo | 5 | 2 | +0.02 | 12 (not reached; last unit 2) | 2 | 1 per 100 t, 90/h | pending |
| Chocolate dust | Heckel Funch (`gnomeshop_heck`) | Grand Tree 1st floor (Heckel Funch) | ardougneNorth 155 + stairs | heckel | 5 | 2 | +0.02 | 12 (not reached; last unit 2) | 2 | 1 per 100 t, 90/h | pending |
| Bucket | Arhein (`arheinstore`) | Arhein's, Catherby | catherby 9 |  | 10 | 2 | +0.06 | 12 (not reached; last unit 3) | 12 | 1 per 100 t, 90/h | pending |
| Bucket | Wistan (`death_generalshop`) | Burthorpe general store | catherby 119 |  | 2 | 2 | +0.06 | 12 (not reached; last unit 2) | 4 for 2 | 1 per 100 t, 90/h | pending |
| Bucket | Bolkoy (`gnomeshop`) | Bolkoy's, Tree Gnome Village | yanille 86 + stairs |  | 2 | 2 | +0.06 | 12 (not reached; last unit 2) | 4 for 2 | 1 per 100 t, 90/h | pending |
| Bucket | Shop keeper / Shop assistant (`generalshop4`) | Falador general store | faladorWest 17 |  | 2 | 2 | +0.06 | 12 (not reached; last unit 2) | 4 for 2 | 1 per 100 t, 90/h | pending |
| Bucket | Chadwell (`upassgeneralshop`) | Chadwell's, Underground Pass entrance | ardougneNorth 151 |  | 2 | 2 | +0.04 | 12 (not reached; last unit 2) | 4 for 2 | 1 per 100 t, 90/h | pending |
| Bucket | Shop keeper (`khazardshop`) | Port Khazard general store | yanille 79 | khazard | 2 | 2 | +0.02 | 12 (not reached; last unit 2) | 4 for 2 | 1 per 100 t, 90/h | pending |
| Bucket | Shop keeper / Shop assistant (`generalshop1`) | Lumbridge general store | alKharid 80 | lumbridgeGeneral | 2 | 2 | +0.06 | 12 (not reached; last unit 2) | 4 for 2 | 1 per 100 t, 90/h | pending |
| Bucket | Shop keeper / Shop assistant (`generalshop2`) | Varrock general store | varrockWest 33 | varrockGeneral | 2 | 2 | +0.06 | 12 (not reached; last unit 2) | 4 for 2 | 1 per 100 t, 90/h | pending |
| Bucket | Shantay (`shantayshop`) | Shantay Pass; toll gate (10 gp) from Lumbridge | alKharid 44 | shantay | 0 | 2 | +0.02 | 12 | - | none (player-sold) | pending |

At most 5 shops per item, cheapest stocked first, plus any the fleet buys at. Further shops, none cheaper at a full shelf, not listed: Feather 1, Knife 1, Fishing rod 1, Fishing bait 2, Chisel 16, Hammer 16, Rope 2, Bucket 12.

### Grand Exchange detail

| Item (id) | Bid x qty | Ask x qty | Mean ask | Last trade | 7-day volume (trades) | 7-day low-high | Read |
|---|---|---|---|---|---|---|---|
| Blood rune (565) | 1,301 x17,916 | 1,321 x82 | 1,321 | 1,258 (2026-10-22 21:41Z) | 12,935 (77) | 578-1,258 | 2026-10-22 22:25Z |
| Death rune (560) | none | 395 x858 | 400 | 394 (2026-10-22 22:22Z) | 25,364 (832) | 349-669 | 2026-10-22 22:25Z |
| Chaos rune (562) | none | none | - | 60 (2026-10-21 08:47Z) | 763 (19) | 26-60 | 2026-10-22 22:25Z |
| Law rune (563) | 101 x5,055 | 2,300 x1,109 | 2,302 | 2,300 (2026-10-22 22:25Z) | 6,571 (498) | 1-4,000 | 2026-10-22 22:25Z |
| Cosmic rune (564) | 1,000 x1 | 10,000 x1 | 10,000 | 1,000 (2026-10-21 05:11Z) | 70 (13) | 1,000-1,500 | 2026-10-22 22:26Z |
| Air rune (556) | 5 x101,281 | 21 x154,231 | 21 | 21 (2026-10-22 19:22Z) | 703,131 (1,712) | 4-40 | 2026-10-22 22:26Z |
| Fire rune (554) | none | 40 x27 | 40 | 40 (2026-10-22 21:58Z) | 3,305 (12) | 40-40 | 2026-10-22 22:26Z |
| Water rune (555) | 10 x300 | none | - | 35 (2026-10-22 18:06Z) | 2,026 (8) | 1-40 | 2026-10-22 22:26Z |
| Earth rune (557) | none | none | - | 35 (2026-10-22 17:21Z) | 2,314 (13) | 1-66 | 2026-10-22 22:26Z |
| Mind rune (558) | 6 x1,988 | none | - | 5 (2026-10-22 13:26Z) | 81 (6) | 3-5 | 2026-10-22 22:26Z |
| Nature rune (561) | none | 621 x607,586 | 621 | 621 (2026-10-22 22:22Z) | 22,362 (211) | 400-988 | 2026-10-22 22:26Z |
| Rune arrow (892) | 400 x6 | none | - | 1,800 (2026-10-12 11:05Z) | 0 (0) | - | 2026-10-22 22:27Z |
| Rune arrowtips (44) | none | none | - | - | 0 (0) | - | 2026-10-22 22:27Z |
| Adamant arrowtips (43) | none | none | - | - | 0 (0) | - | 2026-10-22 22:27Z |
| Mithril arrowtips (42) | none | none | - | 24 (2026-10-21 05:08Z) | 12 (1) | 24-24 | 2026-10-22 22:27Z |
| Steel arrowtips (41) | none | none | - | - | 0 (0) | - | 2026-10-22 22:27Z |
| Iron arrowtips (40) | none | none | - | - | 0 (0) | - | 2026-10-22 22:27Z |
| Bronze arrowtips (39) | 12 x1,650 | none | - | - | 0 (0) | - | 2026-10-22 22:27Z |
| Headless arrow (53) | none | none | - | - | 0 (0) | - | 2026-10-22 22:27Z |
| Arrow shaft (52) | none | none | - | 27 (2026-10-22 03:53Z) | 226 (5) | 26-27 | 2026-10-22 22:27Z |
| Feather (314) | none | 75 x245 | 106 | 70 (2026-10-21 09:46Z) | 870 (5) | 70-70 | 2026-10-22 22:27Z |
| Prayer potion(4) (2434) | 9,000 x18 | none | - | 8,000 (2026-10-21 04:49Z) | 2 (2) | 8,000-8,000 | 2026-10-22 22:27Z |
| Superantipoison(4) (2448) | 2,000 x2 | none | - | - | 0 (0) | - | 2026-10-22 22:28Z |
| Antipoison(4) (2446) | 2,000 x2 | none | - | 5,000 (2026-10-12 16:46Z) | 0 (0) | - | 2026-10-22 22:28Z |
| Antipoison(3) (175) | 1,200 x101 | none | - | - | 0 (0) | - | 2026-10-22 22:28Z |
| Agility potion(4) (3032) | 2,000 x1 | none | - | - | 0 (0) | - | 2026-10-22 22:28Z |
| Magic potion(4) (3040) | 2,000 x1 | none | - | - | 0 (0) | - | 2026-10-22 22:28Z |
| Super attack(4) (2436) | 3,500 x6 | none | - | 2,700 (2026-10-13 06:13Z) | 0 (0) | - | 2026-10-22 22:28Z |
| Super strength(4) (2440) | 4,000 x6 | none | - | 3,300 (2026-10-13 06:14Z) | 0 (0) | - | 2026-10-22 22:28Z |
| Ranging potion(4) (2444) | 6,000 x8 | none | - | 4,800 (2026-10-19 23:48Z) | 94 (25) | 4,800-4,800 | 2026-10-22 22:28Z |
| Shark (385) | none | 533 x2,002,978 | 700 | 533 (2026-10-22 22:22Z) | 91,932 (780) | 443-1,100 | 2026-10-22 22:28Z |
| Raw shark (383) | none | none | - | 1,120 (2026-10-17 01:16Z) | 1 (1) | 1,120-1,120 | 2026-10-22 22:28Z |
| Swordfish (373) | none | none | - | - | 0 (0) | - | 2026-10-22 22:28Z |
| Lobster (379) | 120 x43 | 160 x278 | 160 | 160 (2026-10-22 22:14Z) | 1,025 (44) | 95-160 | 2026-10-22 22:29Z |
| Cooked karambwan (3144) | none | none | - | - | 0 (0) | - | 2026-10-22 22:29Z |
| Cake (1891) | none | none | - | - | 0 (0) | - | 2026-10-22 22:29Z |
| Sapphire ring (1637) | none | none | - | - | 0 (0) | - | 2026-10-22 22:29Z |
| Emerald ring (1639) | none | none | - | - | 0 (0) | - | 2026-10-22 22:29Z |
| Ruby ring (1641) | none | none | - | - | 0 (0) | - | 2026-10-22 22:29Z |
| Diamond ring (1643) | none | none | - | - | 0 (0) | - | 2026-10-22 22:29Z |
| Amulet of magic (1727) | none | none | - | 900 (2026-10-12 11:06Z) | 0 (0) | - | 2026-10-22 22:29Z |
| Amulet of strength (1725) | 5,500 x101 | none | - | - | 0 (0) | - | 2026-10-22 22:29Z |
| Gold bar (2357) | 1,200 x3 | none | - | 1,200 (2026-10-22 18:13Z) | 2 (1) | 1,200-1,200 | 2026-10-22 22:29Z |
| Uncut diamond (1617) | 3,500 x9,668 | none | - | 3,500 (2026-10-22 20:19Z) | 476 (18) | 3,500-25,000 | 2026-10-22 22:29Z |
| Uncut ruby (1619) | 2,501 x9,978 | 10,000 x1 | 10,000 | 2,500 (2026-10-22 10:37Z) | 1,059 (111) | 2,500-10,500 | 2026-10-22 22:30Z |
| Uncut emerald (1621) | 2,500 x9,423 | none | - | 2,500 (2026-10-22 20:19Z) | 586 (21) | 111-15,000 | 2026-10-22 22:30Z |
| Uncut sapphire (1623) | 2,500 x8,499 | 20,000 x11,988 | 20,000 | 2,500 (2026-10-22 22:28Z) | 3,928 (290) | 2,250-20,000 | 2026-10-22 22:30Z |
| Diamond (1601) | 4,500 x11 | none | - | 4,500 (2026-10-22 20:18Z) | 3 (3) | 3,000-4,500 | 2026-10-22 22:30Z |
| Ruby (1603) | none | none | - | - | 0 (0) | - | 2026-10-22 22:30Z |
| Emerald (1605) | none | none | - | - | 0 (0) | - | 2026-10-22 22:30Z |
| Sapphire (1607) | none | none | - | - | 0 (0) | - | 2026-10-22 22:30Z |
| Staff of water (1383) | none | none | - | - | 0 (0) | - | 2026-10-22 22:30Z |
| Staff of fire (1387) | none | none | - | - | 0 (0) | - | 2026-10-22 22:30Z |
| Staff of air (1381) | none | none | - | - | 0 (0) | - | 2026-10-22 22:30Z |
| Adamantite bar (2361) | 1,666 x24,886 | none | - | 1,666 (2026-10-18 02:51Z) | 114 (4) | 1,666-1,666 | 2026-10-22 22:31Z |
| Mithril bar (2359) | 360 x25 | none | - | - | 0 (0) | - | 2026-10-22 22:31Z |
| Steel bar (2353) | 89 x9,650 | 1,497 x3,609 | 1,497 | 1,497 (2026-10-22 22:20Z) | 73,672 (213) | 500-1,660 | 2026-10-22 22:31Z |
| Iron bar (2351) | 100 x99,412 | none | - | 2,000 (2026-10-21 15:57Z) | 683 (38) | 27-2,000 | 2026-10-22 22:31Z |
| Bronze bar (2349) | none | none | - | 50 (2026-10-12 11:06Z) | 0 (0) | - | 2026-10-22 22:31Z |
| Adamantite ore (449) | 1,148 x18,226 | none | - | 1,148 (2026-10-22 22:28Z) | 6,489 (126) | 1,148-1,148 | 2026-10-22 22:31Z |
| Mithril ore (447) | none | none | - | - | 0 (0) | - | 2026-10-22 22:31Z |
| Iron ore (440) | 80 x999,283 | 115 x19 | 115 | 80 (2026-10-22 22:26Z) | 552,355 (1,859) | 80-116 | 2026-10-22 22:31Z |
| Coal (453) | 80 x6,848,105 | none | - | 80 (2026-10-22 22:20Z) | 11,509 (268) | 80-302 | 2026-10-22 22:31Z |
| Rune essence (1436) | 55 x522,198 | 58 x1,625 | 58 | 55 (2026-10-22 22:31Z) | 516,344 (3,077) | 1-500 | 2026-10-22 22:32Z |
| Dragon bones (536) | 5,001 x1,257 | 19,000 x3 | 19,000 | 19,000 (2026-10-22 21:22Z) | 583 (29) | 5,000-100,000 | 2026-10-22 22:32Z |
| Babydragon bones (534) | none | none | - | - | 0 (0) | - | 2026-10-22 22:32Z |
| Grapes (1987) | 1,000 x97,804 | none | - | 1,000 (2026-10-22 22:20Z) | 2,795 (131) | 1,000-2,343 | 2026-10-22 22:32Z |
| Jug of water (1937) | none | none | - | - | 0 (0) | - | 2026-10-22 22:32Z |
| Eye of newt (221) | none | none | - | - | 0 (0) | - | 2026-10-22 22:32Z |
| Limpwurt root (225) | none | none | - | 5,000 (2026-10-21 22:28Z) | 4 (3) | 5,000-5,000 | 2026-10-22 22:32Z |
| Snape grass (231) | none | none | - | 5,000 (2026-10-17 01:28Z) | 3 (3) | 5,000-5,000 | 2026-10-22 22:32Z |
| Vial of water (227) | none | none | - | - | 0 (0) | - | 2026-10-22 22:32Z |
| Guam potion (unf) (91) | none | none | - | - | 0 (0) | - | 2026-10-22 22:33Z |
| Tarromin potion (unf) (95) | none | none | - | - | 0 (0) | - | 2026-10-22 22:33Z |
| Ranarr potion (unf) (99) | none | none | - | - | 0 (0) | - | 2026-10-22 22:33Z |
| Irit potion (unf) (101) | none | none | - | - | 0 (0) | - | 2026-10-22 22:33Z |
| Avantoe potion (unf) (103) | none | none | - | - | 0 (0) | - | 2026-10-22 22:33Z |
| Kwuarm potion (unf) (105) | none | none | - | - | 0 (0) | - | 2026-10-22 22:33Z |
| Magic logs (1513) | none | 2,250 x54,741 | 2,250 | 2,250 (2026-10-22 21:02Z) | 9,590 (34) | 2,250-2,251 | 2026-10-22 22:33Z |
| Yew logs (1515) | none | 399 x53,416 | 399 | 399 (2026-10-22 12:23Z) | 352,894 (36) | 300-630 | 2026-10-22 22:33Z |
| Maple logs (1517) | none | none | - | 240 (2026-10-22 06:44Z) | 40,449 (79) | 240-250 | 2026-10-22 22:33Z |
| Willow logs (1519) | none | none | - | 40 (2026-10-22 06:36Z) | 527 (2) | 40-40 | 2026-10-22 22:33Z |
| Oak logs (1521) | none | none | - | 20 (2026-10-22 06:36Z) | 661 (16) | 18-150 | 2026-10-22 22:34Z |
| Logs (1511) | none | none | - | 5 (2026-10-21 05:02Z) | 247 (21) | 1-10 | 2026-10-22 22:34Z |
| Rune axe (1359) | 150,000 x43 | none | - | 100,001 (2026-10-22 01:50Z) | 11 (4) | 100,000-150,001 | 2026-10-22 22:34Z |
| Rune pickaxe (1275) | none | none | - | 48,000 (2026-10-22 15:36Z) | 51 (18) | 48,000-100,000 | 2026-10-22 22:34Z |
| Mithril scimitar (1329) | 2,356 x3 | none | - | 988 (2026-10-16 16:47Z) | 19 (1) | 988-988 | 2026-10-22 22:34Z |
| Adamant full helm (1161) | none | none | - | - | 0 (0) | - | 2026-10-22 22:34Z |
| Magic shortbow (861) | none | 19,998 x96 | 19,999 | 23,749 (2026-10-22 19:19Z) | 15 (6) | 5,000-25,000 | 2026-10-22 22:34Z |
| Knife (946) | none | 50,000 x4 | 50,000 | 50,000 (2026-10-22 21:59Z) | 1 (1) | 50,000-50,000 | 2026-10-22 22:34Z |
| Fly fishing rod (309) | none | none | - | - | 0 (0) | - | 2026-10-22 22:35Z |
| Fishing rod (307) | none | none | - | - | 0 (0) | - | 2026-10-22 22:35Z |
| Fishing bait (313) | none | none | - | - | 0 (0) | - | 2026-10-22 22:35Z |
| Chisel (1755) | none | none | - | - | 0 (0) | - | 2026-10-22 22:35Z |
| Hammer (2347) | none | none | - | - | 0 (0) | - | 2026-10-22 22:35Z |
| Cannonball (2) | none | none | - | - | 0 (0) | - | 2026-10-22 22:35Z |
| Pot of flour (1933) | none | none | - | 10 (2026-10-12 20:20Z) | 0 (0) | - | 2026-10-22 22:35Z |
| Banana (1963) | none | none | - | 500 (2026-10-07 13:44Z) | 0 (0) | - | 2026-10-22 22:35Z |
| Raw beef (2132) | none | 13 x10 | 226 | 13 (2026-10-19 03:32Z) | 9 (1) | 13-13 | 2026-10-22 22:35Z |
| Raw chicken (2138) | none | none | - | 1 (2026-10-12 11:02Z) | 0 (0) | - | 2026-10-22 22:35Z |
| Lobster pot (301) | none | none | - | - | 0 (0) | - | 2026-10-22 22:35Z |
| Silk (950) | none | none | - | - | 0 (0) | - | 2026-10-22 22:35Z |
| Rope (954) | none | none | - | 1,000 (2026-10-03 02:53Z) | 0 (0) | - | 2026-10-22 22:36Z |
| Spade (952) | none | none | - | - | 0 (0) | - | 2026-10-22 22:36Z |
| Swamp paste (1941) | none | none | - | - | 0 (0) | - | 2026-10-22 22:36Z |
| Ball of wool (1759) | none | none | - | 100 (2026-10-22 03:09Z) | 2 (1) | 100-100 | 2026-10-22 22:36Z |
| Dwellberries (2126) | none | none | - | - | 0 (0) | - | 2026-10-22 22:36Z |
| Chocolate dust (1975) | none | none | - | - | 0 (0) | - | 2026-10-22 22:36Z |
| Bucket (1925) | none | none | - | 1 (2026-10-12 11:02Z) | 0 (0) | - | 2026-10-22 22:36Z |

<!-- supplies:generated:end -->
