# Demo market survey: buy, gather, or both, for every supply line

What the scored account's helpers can buy on the demo server
(rs-sdk-demo.fly.dev), what they must gather, and where coins come from.
The supply list is the one in cairn://p/rs/41.

**Snapshot:** Grand Exchange quotes read from
`https://rs-sdk-demo.fly.dev/api/market/items/<id>` on 2026-10-21 at 04:17 UTC
(21:17 PDT). Volume is units traded in the last 7 days. Shop rows come from
`wiki/shops/*.md` and show the base price at full stock and the configured
stock level, not live shelf stock. Re-read the live book before acting on any
number here; the shark ask moved from 487 to 907 gp in under an hour on the
same day.

## How to read the market

- **The demo GE is a buyers' book.** 51 items had open bids and most had no
  sellers at all. Anything with no ask cannot be bought on the GE, however
  many coins we have. The lines that *can* be bought there are few: sharks,
  magic, yew and maple logs, iron ore, nature, death, blood and law runes,
  feathers, steel bars, and a handful of oddities.
- **Contested lines.** Large standing bids with no sellers mean other players
  want the same thing we gather. Our gatherers will not find those items
  for sale, and every unit we gather has a high resale value (opportunity
  cost). Notable ones: Grapes (bid 1,000 gp for 99,591, zero sellers), Coal
  (150 gp for 6.85M), Rune essence (83 gp for 1.0M), Adamantite ore (1,148
  for 19,774), Adamantite bar (1,666 for 24,886), Runite bar (11,005 for
  4,968), Dragon bones (5,000 for 1,455), Dwarf weed (7,000 for 839), Uncut
  ruby (10,000 for 242), Rune knife (2,010 for 25,000), Prayer potion(4)
  (8,000 for 14).
- **Seller tax is 5%** (`sdk/MARKET.md`), so a sale into a bid nets 95%.
- **Shop prices climb as stock drains.** A unit costs
  `base x (shop_sell - clamp((stock - configured) x shop_delta, -5000, 1000)) / 1000`
  (`server/content/scripts/shop/scripts/shop.rs2`, `calc_shop_value`). With
  the default `shop_delta` of 10, every unit below the configured stock adds
  1% of base, up to 6x base. Shops restock one unit per line every
  `stockrate` ticks (`World.ts`; for example blood runes at the Magic Guild
  restock one per 300 ticks). So shops are great for a few hundred units at
  a time and poor for thousands at once.
- **2004 item names.** Arrowheads are `... arrowtips`. Every unidentified
  herb is called `Herb` and every unfinished potion `Unfinished potion`, so
  buy or track those by id (table at the end).

## Verdicts by supply line

Prices in gp. "Bid" is the highest open buy and its total quantity; "ask" is
the lowest open sell and its total quantity.

### Wine ingredients

| Item (id) | Bid | Ask | Vol 7d | Shop source | Verdict |
|---|---|---|---|---|---|
| Grapes (1987) | 1,000 x99,591 | none | 409 | none | **Gather** (rs/47). Heavily contested: someone bids 99.6M gp in total and nobody sells. |
| Jug (1935) | none | none | 0 | ~20 general stores at 1 gp, stock 2 each (Lumbridge, Varrock, Falador, Al-Kharid, Edgeville, Rimmington, ...) | **Buy** from general stores (buyer `lumbridgeGeneral`, `varrockGeneral`); stock 2 per store and slow restock, so tour several stores. |
| Jug of water (1937) | none | none | 0 | Shantay Pass 1 gp stock 10, Bedabin 5 | **Gather**: fill jugs at a fountain or sink. |
| Unfermented wine (1995) | none | none | 0 | none | Make (Cooking 35). |

### Bones

| Item (id) | Bid | Ask | Vol 7d | Shop | Verdict |
|---|---|---|---|---|---|
| Dragon bones (536) | 5,000 x1,455 | none | 545 | none | **Gather** (rs/48). Contested. |
| Big bones (532) | none | none | 0 | none | **Gather**. |
| Babydragon bones (534), Jogre bones (3125) | none | none | 0 | none | Gather. |
| Bones (526) | 150 x3 | none | 10 | none | Gather. |

### Bars, ores, coal

| Item (id) | Bid | Ask | Vol 7d | Shop | Verdict |
|---|---|---|---|---|---|
| Adamantite bar (2361) | 1,666 x24,886 | none | 114 | none | **Gather** (rs/45). Contested. |
| Mithril bar (2359) | none | none | 0 | none | **Gather**. |
| Adamantite ore (449) | 1,148 x19,774 | none | 5,226 | none | Gather. Contested. |
| Mithril ore (447) | none | none | 0 | none | Gather. |
| Coal (453) | 150 x6,852,743 | none | 96,411 | Drogo's (Falador) 45 gp, stock 0 (player-sold only) | **Gather**. Each adamant bar needs 6 coal and each mithril bar 4, and no one sells coal. It is also the deepest bid on the server: selling coal is a coin source. |
| Iron ore (440) | none | 109 x39,835 | 555,798 | Drogo's, stock 0 | Buy if a steel line appears; not on the list. |
| Steel bar (2353) | 700 x13,999 | 1,501 x1,001 | 55,304 | none | Not needed. |
| Runite bar (2363), ore (451) | 11,005 x4,968; 5,001 x133 | none | 1,036; 336 | none | Gather if rune arrowtips are chosen (see Fletching). |
| Gold bar (2357) | 1,200 x5 | none | 0 | Drogo's 300, stock 0 | Gather (jewellery). |

### Logs

| Item (id) | Bid | Ask | Vol 7d | Verdict |
|---|---|---|---|---|
| Magic logs (1513) | none | 2,250 x34,999 | 14,302 | **Both.** The ask is deep: 150 logs cost about 337,500 gp, about 2.5-3.5 earner-hours at the warrior rate (coins.md). Buy if coins are idle; otherwise the woodcutter (rs/44). |
| Yew logs (1515) | none | 399 x55,557 | 319,949 | **Buy** for the low tiers if Firemaking wants them: liquid market. |
| Maple logs (1517) | none | 240 x168 | 14,891 | Buy (shallow), or gather. |
| Willow, Oak, Logs (1519, 1521, 1511) | none | none | 27-477 | **Gather** (cheap and quick). |

### Essence and talismans

| Item (id) | Bid | Ask | Vol 7d | Verdict |
|---|---|---|---|---|
| Rune essence (1436) | 83 x1,001,182 | 92 x1,287 | 17,392 | **Gather** (rs/46): 4,200 needed and only 1,287 for sale. Contested; also a coin source (rs/46 reports 28 essence per 85-100 s trip, about 1,000-1,200 essence or 80-95k gp per account-hour sold into the bid). |
| Law talisman | not tradeable on the GE | | | Quest/drop; not buyable. |
| Nature (1462), Cosmic (1454) talismans | 25,000 x2; none | none | 0 | Not buyable. |

### Fletching

| Item (id) | Bid | Ask | Vol 7d | Shop | Verdict |
|---|---|---|---|---|---|
| Rune arrowtips (44) | none | none | 0 | none | **Make** (Smithing from runite bars). |
| Adamant arrowtips (43) | none | none | 0 | none | Make (adamant bars, rs/45). |
| Mithril arrowtips (42) | none | 24 x12 | 0 | none | Make; the GE has 12. |
| Rune dart tip (824), Adamant dart tip (823) | none | none | 0 | none | Make. |
| Headless arrow (53) | none | none | 0 | none | **Make** from arrow shafts and feathers. |
| Arrow shaft (52) | none | 26 x205 | 21 | Dargaud's (Ranging Guild, Ranged 40) 1 gp, stock 1,000 | Fletch from logs, or buy at Dargaud's. |
| Feather (314) | none | 70 x673 | 442 | **Gerrant (Port Sarim) 2 gp, stock 1,000**; Fishing Guild 1,500; Shantay Pass 500 | **Both.** Gerrant's: 200 cost 640 gp (3.2 each, measured), over 20x cheaper than the GE ask; buyer line `{"item":"Feather","source":"shop","shop":"gerrant","maxPrice":6}`. For thousands, the `feathers` role (chickens near Lumbridge, free) avoids draining the shop's price up. |
| Bow string (1777) | 1 x1,418,258 | 146 x870 | 0 | none | Gather/spin if needed (not on the list). |

### Herbs and secondaries

No herb, unfinished potion or herblore secondary had a single seller except one
`Herb` (205, harralander) at 4,000. Everything here is **gather/make** unless a
shop sells it.

| Item (id) | Bid | Ask | Shop | Verdict |
|---|---|---|---|---|
| Torstol (269), Cadantine (265), Kwuarm (263), Irit leaf (259), Ranarr weed (257) | none | none | none | Gather (drops). |
| Dwarf weed (267) | 7,000 x839 | none | none | Gather. Contested. |
| Unidentified herbs (`Herb`, ids below) | none | 205 only: 4,000 x1 | none | Gather. |
| Unfinished potions (`Unfinished potion`, ids below) | none | none | none | Make (vial of water + clean herb). |
| Jangerberries (247), Wine of zamorak (245), White berries (239), Limpwurt root (225), Red spiders' eggs (223) | none | none | none | Gather. |
| Snape grass (231) | none | none (last 5,000) | none | Gather. |
| Eye of newt (221) | none | none | **Betty (Port Sarim) 3 gp, stock 300**; Jatix (Taverley) 800 | **Buy** (shop `betty`). |
| Vial of water (227) | none | none | Aemad's (East Ardougne) 2 gp, stock 500 | Buy, or fill vials. |
| Vial (229) | none | none | Jatix (Taverley) 2 gp, stock 800 | Buy. |

### Uncut gems

| Item (id) | Bid | Ask | Vol 7d | Shop | Verdict |
|---|---|---|---|---|---|
| Uncut dragonstone (1631) | none | none (last 200,000) | 0 | none | **Gather.** Not buyable. |
| Uncut diamond (1617) | none | 25,000 x10 | 0 | Herquin (Falador), Gem Trader (Al-Kharid): 200 gp, stock 0 | Gather; 10 for sale at 25k. |
| Uncut ruby (1619) | 10,000 x242 | none | 758 | same shops, 100 gp, stock 0 | Gather. Contested. |
| Uncut emerald (1621) | none | 111 x2 | 0 | 50 gp, stock 0-1 | Gather. |
| Uncut sapphire (1623) | 2,250 x6,763 | 20,000 x11,989 | 3,249 | Herquin, Gem Trader: 25 gp, stock 1 each | Gather. Someone lists 12k sapphires at 20,000 gp each, which is not a real market. A gem shop's single sapphire bought at 25 and sold into the 2,250 bid nets 2,100 gp; it restocks slowly, so this is a curiosity, not an income. |

### Jewellery (for enchanting)

No ring or amulet of any tier has a bid or an ask. Grum's Gold Exchange (Port
Sarim) lists them all at 350-3,525 gp but holds stock 0 (it only resells what
players sell it). **Make** (Crafting: gold bar + cut gem at a furnace), so this
line is really gold bars and gems.

| Item (id) | Market | Shop |
|---|---|---|
| Gold ring (1635), Gold amulet (1673) | none | Grum 350, stock 0 |
| Sapphire ring (1637), amulet (1675) | none | Grum 900, stock 0 |
| Emerald ring (1639), amulet (1677) | none | Grum 1,275, stock 0 |
| Ruby ring (1641), amulet (1679) | none | Grum 2,025, stock 0; irksol (Zanaris) ruby ring 1,012, stock 5 |
| Diamond ring (1643), amulet (1681) | none | Grum 3,525, stock 0 |
| Dragonstone ring (1645), `Dragonstoneamulet` (1683 unstrung, 1702) | none | none |

### Runes

| Item (id) | Bid | Ask | Vol 7d | Shop | Verdict |
|---|---|---|---|---|---|
| Cosmic rune (564) | 1,000 x9 | none | 361 | Lundail (Mage Arena, deep Wilderness) 15 gp, stock 20 | **Gather/make**: no sellers, and the only shop is in the Wilderness with 20 stock. Runecraft cosmics (Lost City for the altar) or bid and wait. |
| Blood rune (565) | 578 x15,623 | 959 x99 | 12,878 | **Magic Guild (Yanille, needs Magic 66) 50 gp, stock 1,000** (restock 1 per 300 ticks) | **Buy at the Magic Guild** once a helper has Magic 66. Draining all 1,000 from full stock costs about 237,000 gp at the climbing price (the price hits the 6x cap of 300 after 500 units). The 99 on the GE cost 959 each. |
| Fire rune (554) | none | none | 0 | Aubury (Varrock) 4 gp, stock 2,000; Betty 1,000; Magic Guild 3,000 | **Buy** from shops (or use a fire staff). |
| Air rune (556) | 11 x109,049 | none | 860,730 | Aubury 4 gp, stock 2,000; Betty 1,000; Magic Guild 3,000 | **Buy** from shops (or use an air staff). The 860k weekly volume at 11 gp is other players draining rune shops into this bid. |
| Law rune (563) | 100 x5,055 | 2,673 x93 | 5,875 | Magic Guild 40 gp, stock 1,000 | Buy at the Magic Guild. |
| Nature rune (561) | none | 441 x515,020 | 11,945 | Magic Guild 20 gp, stock 1,000 | Buy at the Magic Guild, or GE at 441 (deep). |
| Death rune (560) | none | 440 x321 | 26,767 | Aubury 30 gp, stock 1,000; Betty 1,000 | Buy from shops. |

### Food, potions and gear (combat)

| Item (id) | Bid | Ask | Vol 7d | Shop | Verdict |
|---|---|---|---|---|---|
| Shark (385) | none | **907 x1,002,308** (487 at 03:55 UTC) | 185,828 | none | **Buy** on the GE: one deep seller. 20 sharks cost about 9,700-18,100 gp depending on which price is up. |
| Lobster (379), Swordfish (373) | none | none | 0-45 | Brimhaven restaurants 3/2 stock; Legends' Guild swordfish 310 gp, stock 20 | Fallback food. |
| Prayer potion(4) (2434) | 8,000 x14 | none | 0 | none | **Make** (Herblore). Contested. |
| Super strength(4) (2440), Super attack(4) (2436) | 3,500 x5; 3,000 x5 | none | 0 | none | Make. |
| Antipoison(4) (2446), (3) (175) | none | none | 0 | Jiminua's (Karamja) (3) 432 gp, stock 10 | **Buy** at Jiminua's, or make. |
| Rune scimitar (1333) | 45,000 x1 | none | 0 | none | **Not buyable.** Drop or smith (Smithing 90, 2 runite bars). |
| Rune platebody (1127) | none | none | 0 | Oziach (Edgeville) 84,500, stock 2, **needs Dragon Slayer** | Not buyable before Dragon Slayer; smith otherwise. |
| Rune platelegs (1079) | none | none | 0 | Scavvo's (Champions' Guild, 32 QP) 64,000, stock 1 | Buy at Scavvo's once a helper has the quest points; otherwise smith. |
| Rune full helm (1163), kiteshield (1201) | none | none (helm last 60,000) | 0 | none | Smith or drop. |
| Adamant platebody (1123) | none | none | 0 | Valaine's (Champions' Guild) 16,640, stock 1 | Buy (QP-gated) or smith (rs/45 bars). |
| Adamant platelegs (1073) | none | none (last 9,924) | 0 | Louie's (Al-Kharid) 6,400, stock 1 | **Buy** at Louie's (buyer shop to add). |
| Adamant full helm (1161) | none | none | 0 | Helmet Shop (Barbarian Village) 3,520, stock 1 | **Buy.** |
| Adamant kiteshield (1199) | none | none | 0 | none | Smith. |
| Magic shortbow (72) | none | none | 0 | none | **Make** (Fletching 80 from magic logs). |
| Rune arrow (892) | none | none (last 1,800) | 0 | Dargaud's (Ranging Guild, Ranged 40) 400 gp, stock 400; Hickton's (Catherby) 400, stock 0 | **Buy** at Dargaud's. |
| Rune knife (868) | 2,010 x25,000 | none | 0 | none | **Not buyable.** Someone has 50M gp bid and no seller exists. |
| Cannonball (2) | none | none | 0 | none | **Make** (Smithing 35 from steel bars, needs Dwarf Cannon). |

## Coin sources this market implies

Selling into standing bids is the main coin source the market offers, and it
competes with our own needs for the same goods:

- Coal at 150 (142.5 net), rune essence at 83 (78.9 net) and grapes at 1,000
  (950 net) have deep bids that outlast anything a few helpers produce. Every
  grape or essence our helpers sell is one the scored account does not get.
- Shop-to-GE resale: rune shops' air runes (4 gp) into the 11 gp bid nets
  about 6 per rune until the shop price creeps past 10 (about 150 units per
  shop visit), which others are already doing at 860k runes a week. Magic
  Guild blood runes (50 gp) into the 578 gp bid nets about 300k gp per full
  shop drain, but only once (the shop then restocks one rune per 300 ticks),
  and those runes are better spent on the Charge casts.
- Pickpocketing needs no market at all. Measured rates are in
  [coins.md](coins.md).

## Id table for ambiguous names

| Herb (grimy, `Herb`) | Clean | Unfinished potion |
|---|---|---|
| 199 guam | 249 | 91 |
| 201 marrentill | 251 | 93 |
| 203 tarromin | 253 | 95 |
| 205 harralander | 255 | 97 |
| 207 ranarr | 257 | 99 |
| 209 irit | 259 | 101 |
| 211 avantoe | 261 | 103 |
| 213 kwuarm | 263 | 105 |
| 215 cadantine | 265 | 107 |
| 217 dwarf weed | 267 | 109 |
| 219 torstol | 269 | 111 |
| 2485 lantadyme | 2481 | 2483 |
| 3049 toadflax | 2998 | 3002 |
| 3051 snapdragon | 3000 | 3004 |

(Verified against `server/content/pack/obj.pack`: `unidentified_<herb>`,
`<herb>`, `<herb>vial`.)

## Refreshing this survey

The numbers were pulled with the market API in one pass. To refresh, resolve
each name with `GET /api/market/items?q=<name>` (take the exact-name hit) and
read `/api/market/items/<id>`; shop rows come from `wiki/shops/*.md`. The
buyer role (`speedrun/helpers/buyer.ts`) reads the live ask before every GE
line and the live shop price before every 10 units, so it never relies on
this page's numbers.
