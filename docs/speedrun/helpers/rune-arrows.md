# Rune-arrows role

`speedrun/helpers/rune-arrows.ts` buys rune arrows at Dargaud's Bow and Arrows
in the Ranging Guild and banks them at Seers' Village. On the scored run they
go with the magic shortbow, which replaced the 800 rune knives (cairn://p/rs/124:
no shop sells knives of any metal, and the Grand Exchange has no sellers), and
100 of them are Monkey Madness's.

```sh
ROLE_OPTIONS='{"target":650,"maxPrice":410}' bun speedrun/helpers/rune-arrows.ts <account>
```

| Option | Default | Meaning |
|---|---|---|
| `target` | 650 | Rune arrows to hold, bank and pack. |
| `maxPrice` | 410 | Most to pay for one arrow. |
| `bankEvery` | 100 | Arrows bought between trips to the Seers' bank; also how many arrows' worth of coins it carries. |
| `crossingHitpoints` | 30 | Hitpoints to train before White Wolf Mountain (`speedrun/lib/kandarin.ts`). |
| `extras` | none | More of Dargaud's stock to buy between rune-arrow waits, each `{"item", "target", "maxPrice"}`: a holding target and a unit cap. Rune arrows come first; while extras are wanted, each rune-arrow wait is 400 ticks instead of 1,200, and each bank trip carries coins for up to 300 of each. The role runs until rune arrows and every extra reach their targets. |

The account needs the coins in its bank. A fresh account works: the role trains
it first.

## Why Dargaud's, and what the cap buys

Dargaud's is the only shop with rune arrows on the shelf
(`ranging.inv`: 400 at 400 gp, one restocked every 130 ticks; Hickton's in
Catherby lists them with stock 0, so it never has any). The shelf is shared by
every player, and the guild door opens only for Ranged 40
(`ranging_guild_door.rs2`).

A shop's price rises by 1% of base for every unit its shelf is below the
configured stock (`shop_delta` 10), so the next arrow costs 400 gp plus 4 gp per
arrow missing. The restock rate, not the price, sets throughput: one arrow per
130 ticks is about 92 an hour on the demo's 300 ms ticks whatever the cap.
A cap a few gp over 400 therefore buys every arrow within a restock or two of a
full shelf, at about 405 gp each. A higher cap only front-loads: draining 100
arrows from a full shelf costs about 600 gp each.

That arithmetic holds only for an uncontended shelf. Live on the demo
(cairn_h91, 2026-10-21) someone outside the fleet took about every restock:
the shelf sat at 329-340 for an hour, so the next arrow cost 640-684 gp, and a
410 cap bought nothing. At a 700 cap the role won about 75 arrows an hour at
700 gp each. Read the shelf before choosing a cap. The role logs
`perHour` and `averagePrice` for each item with every `buying` line, which
shows the share of restocks it is winning.

The buyer remembers the price it measured, per shop and item, across calls
(`Buyer.buyAtShop`). Without that, each wait for a restock would start with a
one-arrow probe at whatever price the shelf had reached.

## Phases

Each is skipped when already done, so a restart resumes.

1. **Train** to Ranged 40 and Hitpoints 30 on the Lumbridge cows: a shortbow
   and 400 bronze arrows from Lowe's in Varrock, rapid style. On this server's
   experience curve (`2^(level/10)` at 25x, `Player.ts`) Ranged 40 is about
   160 damage dealt and Hitpoints 30 about 190, so Hitpoints is the long one
   and Ranged ends a little past 40.
2. **Trek**: bank the pack at Draynor (a death keeps only three items), turn
   auto-retaliate off and run on, and walk through Taverley and over White Wolf
   Mountain to the Seers' bank. Coins come out of the bank on the far side.
3. **Buy**: through the guild door, buy while the next arrow is under the cap,
   wait for restocks otherwise (logging every 1,200 ticks), and bank at Seers'
   every `bankEvery` arrows. It stops when the bank holds `target`, or when
   there are not enough coins for one more arrow at the cap.

The guild door is a diagonal door on the compound's north-west corner, at
(2658, 3438). Its script counts anywhere west or north of it as outside, and
teleports a Ranged 40 player two tiles south-east (and back). The role opens it
explicitly from (2657, 3439) rather than leaving it to `walkTo`: the SDK's
collision map finds a way round through the diagonal barricade on the
compound's north-east side, which may not be passable in the game.
