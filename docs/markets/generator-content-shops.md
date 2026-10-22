# Generators in content, shops, trade, bank and certs (markets Q1b)

Question (rs/499, under the markets mission rs/495): does any content script, or the engine's
trade, bank, shop, inventory or cert code, grant items in bulk, in a loop, or without consuming
inputs, so that it explains the two leaders of the wealth board (`/hiscores/bank?profile=main`)?
At the time of writing those are nickai3 at 16.14B (air rune x1.92B, raw shark x7.1M, coins at
2^31-1, raw bass x10.8M, mind rune x248M, oyster x2.1M) and banker at 8.02B (shark x18.0M, coins
at the cap, fire rune x65.9M, yew logs x419K). The board value is the sum of `ObjType.cost * count`
over the bank (`server/engine/src/server/login/LoginServer.ts`, `updateHiscores`).

## Answer

**No player-reachable path in this scope explains those stacks.** Every path an ordinary player
can reach in content, shops, trade, bank, duel, party room and certs conserves items and coins.
The lab confirms this for the count edges (counts above what is held, full 2^31-1 stacks, shop
round trips). What the code reading did find:

- One **latent engine bug** that scripts can't reach. `INV_MOVEITEM` and `INV_MOVEITEM_CERT`
  (`server/engine/src/engine/script/handlers/InvOps.ts`) compute the overflow they drop on the
  floor as `count - invAdd(completed)`, where `count` is the amount requested and `completed`
  is the amount actually deleted. A caller that asked to move more than it held would drop the
  difference as new items. Every call site in `server/content/scripts` clamps the count to
  `inv_total` (or a fixed 1) before calling, so nothing can reach it today. The correct expression is
  `completed - invAdd(...)`.
- **Small duplications of tools and quest items** (gnome restaurant utensils, the Legends' Quest
  machete). These are worth a few coins per cycle at most.
- **One cross-shop arbitrage** (ruby rings, Irksol to Grum), worth about 1,400 gp per restock.
- **Staff-made items fed into an eligible bank: open candidate, confirmed possible in the lab**
  (section 3). An ordinary player can't run a cheat, and a staff account can't hold a board row.
  But a staff account (level 3 or 4, which only whoever runs the demo can set in the account row)
  can `::give` items to itself and trade them to an ordinary account. Nothing in trade, bank or
  the GE checks staff level or where an item came from, and the receiver's bank counts in full. The lab
  moved 200M air runes this way and the receiver got a board row worth 800M. Whether this
  happened on the demo needs public evidence (timeline, GE volume, account-family census), which
  is rs/500's job.

**For the markets mission, the staff path is not a method available to us**: it needs a staff
level that only the operator can grant. The copyable lead is rs/500's fishing swarm.

The save-v8 recovery escrow (`Player.RECOVERABLE_INVENTORIES`, added 2026-09-07 in
`e5282efdd93`) was the other lead outside this scope. Sibling rs/498 has ruled it out
(`docs/markets/generator-ge-persistence.md`).

A duplication that doubles a stack needs about 31 iterations to reach 2^31 from 1, and a fixed
yield needs a loop. No player-reachable path found here has either shape.

## Lab setup

| | |
|---|---|
| Executor | `fedora` (linux x86_64) |
| Port block | M2: `WEB_PORT=9910 WEB_MANAGEMENT_PORT=9911 HISCORES_WEB_PORT=9912 NODE_PORT=44910 AGENT_PORT=7702 LAB_FRIEND_PORT=45910`, checked free with `ss -ltn` before each run |
| Tick rate | `NODE_TICKRATE=400` |
| Bound | `LAB_TIMEOUT=1500` |
| Bots | `mkt499a`, `mkt499b` (fresh accounts) |
| Script | `markets/research/content-edges.ts` |

```sh
NODE_TICKRATE=400 WEB_PORT=9910 WEB_MANAGEMENT_PORT=9911 HISCORES_WEB_PORT=9912 NODE_PORT=44910 \
  AGENT_PORT=7702 LAB_FRIEND_PORT=45910 LAB_TIMEOUT=1500 \
  speedrun/lab/lab.sh mkt499b markets/research/content-edges.ts
```

The lab runs accounts at staff level 4 (`LOCAL_STAFF_LEVEL=4`), and the board skips any account
above staff level 1 (`LoginServer.ts`, `hiscoreEligible`). The script therefore computes the board
value itself, with the same formula: `cost` comes from the `.obj` configs by way of
`server/content/pack/obj.pack`, and a cert costs what its linked item costs
(`ObjType.toCertificate`).

## Lab results (`content-edges.ts`, run 2)

| Probe | Before | After | Verdict |
|---|---|---|---|
| A. Withdraw-X of 1,000,100 iron ore, unnoted, bank holds 100 | bank 100, inv 0, ground 0 | bank 72, inv 28, ground 0 | conserved; count clamped (`bank.rs2` `bank_withdraw`), space-limited by `inv_itemspace2` |
| A. Withdraw-X of 1,000,200 iron ore, noted, bank holds 200 | bank 200, inv 0, ground 0 | bank 0, inv 200 (noted), ground 0 | conserved; `inv_moveitem_cert` moved exactly what was deleted |
| B. Deposit 1,000 coins into a bank stack at 2^31-1 | bank 2,147,483,647, inv 1,000 | unchanged; "You already have a full stack of that item in the bank." | refused (`bank_deposit_request`), nothing lost |
| B. Withdraw-all coins (2^31-1) while holding 1,000 | bank 2,147,483,647, inv 1,000 | bank 1,000, inv 2,147,483,647, ground 0 | conserved; withdraw reduced by `inv_itemspace2` overflow; no wrap |
| C. Varrock general store: sell 1 iron bar, buy it back | 10,000 gp, 1 bar | 9,976 gp, 1 bar | net -24 gp |
| C. Varrock general store: buy 1 pot, sell it back | 9,976 gp, 0 pots | 9,975 gp, 0 pots | net -1 gp |
| C. Sell an iron bar while holding 2^31-1 coins | 2^31-1 gp, 1 bar | unchanged (sale did not go through in the lab) | not tested; the code predicts lost proceeds (`shop.rs2` `sell_item` adds coins after moving the item, and `Inventory.add` caps the stack), which would be a loss, never a gain |

Run 1 got probes A right, but a staging mistake put the 2^31-1 stack in the inventory instead
of the bank, and probe C started with coins at the cap. Run 2 fixed both, and the table above is from run 2.

## Candidates examined

Paths are relative to `server/content/scripts/` unless they start with `server/`.

### 1. Engine inventory primitives (`server/engine/src/engine/Inventory.ts`, `InvOps.ts`, `Player.ts`)

| Candidate | Evidence | Verdict |
|---|---|---|
| Stack overflow at 2^31 | `Inventory.add` caps at `STACK_LIMIT` (0x7fffffff) and returns only what it added; `getItemCount` caps the sum | no wrap; the excess is refused or dropped, never minted (lab B) |
| `inv_moveitem` / `_cert` with count above held | overflow = `count - invAdd(completed)` | **latent bug**, unreachable: every caller clamps (trade `removefromtrade`/`movetotrade`, duel offer, party chest, bank withdraw/deposit, equip, death keep, trawler reward) |
| `inv_moveitem_uncert` | adds exactly `completed`; ignores add overflow | a full destination loses items (shop and bank check space first); never mints |
| `inv_movefromslot`, `both_moveinv` | delete the slot first, add, then drop real overflow | conserved |
| `inv_movetoslot` | swap of two slots | conserved |
| `obj_takeitem` | `World.removeObj` after the add | conserved |

### 2. Bank (`interface_bank/scripts/bank.rs2`, `bank_deposit.rs2`)

Withdraw clamps the requested number to `inv_total(bank)` and subtracts the inventory overflow
before moving. Deposit refuses when the bank stack would pass 2^31-1, and moves only
`amount - overflow`. Noted withdraw uses `inv_moveitem_cert` with the same clamped count.
**Ruled out** (lab A and B).

### 3. Developer cheats, staff level, and staff-made items

**What an ordinary player can do: no cheat.** `::give`, `::givemany` and the debug procs need
`staffModLevel >= 3`/`4`, and debug procs also need a non-production world
(`server/engine/src/network/game/client/handler/ClientCheatHandler.ts`). The demo runs with the
login server (`fly.toml`, `LOGIN_SERVER = "true"` since its first commit), so staff level comes from
the `account` row, which defaults to 0 (`server/engine/prisma/*/schema.prisma`). The old local-login
grant of staff level 4 on non-production worlds (removed in `e0de0694e6b`, 2026-02-02) never
applied to the demo. `NODE_DEBUG=true` only adds diagnostic messages. The lab confirms that a
staff-0 account's `::give` is ignored (probe H1 below).

**What a staff account can't do: hold a board row.** `hiscoreEligible` (`LoginServer.ts`) writes
no rows for an account above staff level 1, and every board query filters
`account.staffmodlevel <= 1` (rs/498's doc covers the queries). The lab confirms the staff giver
gets no row (probe H5).

**What is not ruled out: staff-made items fed into an eligible bank.** On the demo's non-production
config, `::giveother` and `::teleother` are production-only, so a staff account can `::give` only
to itself (rs/498). From there the items can reach an ordinary account in three ways. A plain
trade leaves no public trace. The GE shows up in `/api/market` history. A drop followed by a
pickup also leaves no trace: the receiver sees the drop once the reveal timer expires. Nothing on
these paths checks staff level or origin:

- `trade.rs2`, `bank.rs2`, `shop.rs2` and the GE code (`server/engine/src/engine/market/`) contain
  no staff checks. The only staff checks in content are death item loss (`death.rs2`) and a staff
  stat boost (`appearance.rs2`), and neither gates items.
- An inventory slot is `{ id, count }` (`Inventory.ts`), with no record of where it came from.

The lab ran this path end to end (section "Lab results: staff hand-off"). This is an **open
candidate**, and settling it on the demo needs public evidence (below and in rs/498's doc).
rs/498 also notes that the debug proc `~bank_preset` (`_test/scripts/cheats/cheat_bank.rs2`) fills
a bank with 2,147,483,647 of each rune type and coins, and 65,535 of each raw fish, ore, log and
gem.

**Public signals that would separate staff-fed stacks from a swarm or a dupe:**

| Signal | Staff-fed | Gathering swarm | Dupe or generator |
|---|---|---|---|
| GE volume (`/api/market` history) for the item | none, if fed by trade or drop | sales or none; feeders usually trade | none |
| Board timeline (bank snapshot dates and values) | the stack appears in one step between snapshots | a steady ramp matching gather rates times account count | a run of steps, doubling or fixed yield per cycle |
| Exact counts (bank board item search) | round numbers: 100,000,000, multiples of 65,535, 2,147,483,647 | irregular | multiples of the per-cycle yield |
| Feeder accounts | few or none; one staff account is enough | many accounts with the item's skill trained, seen on `/playerpositions` at the resource | one or two accounts |
| Skills of the holder and its family | unrelated to the items | matches the items (fishing for raw shark and bass) | anything |

nickai3's air rune count (1,923,311,135) and banker's shark count (18,044,690) aren't round
numbers or multiples of 65,535. That is weak evidence against a one-step staff give of those
stacks, but they could be the remainder after trading or spending. Coins at exactly 2,147,483,647
fit a staff give, `~bank_preset`, the Managing Miscellania coffers dupe (rs/498) and a long
accumulation that hit the cap equally well.

### 4. Trade (`interface_trade/scripts/trade.rs2`)

Offer and remove clamp to `inv_total`. Any offer change resets both players' accept status, and
the confirm screen re-checks inventory space. Completion is two `both_moveinv` calls, each moving a
whole container. Declining or closing returns the offer with `moveallinv`. **Ruled out** by code. The
mid-trade save snapshot is Q1a's escrow question.

### 5. Duel arena and party room

Duel offers clamp like trade (`duel_arena.rs2`), and settlement moves the loser's whole offer into the
winner's `duelwinnings`, which the winner claims with a space check, or the winnings drop to the floor
(`duel_arena_finish.rs2`, `duel_forfeit.rs2`). The party chest clamps the deposit to held count
and free space and moves whole slots to the drop inventory (`partyroom_chest.rs2`). **Ruled out**
by code. The balloon-pop script was not read; it can only drop what the chest holds.

### 6. Shops (`shop/scripts/shop.rs2`)

The buy loop charges per unit at the current stock, with a 1 gp floor. Sell clamps to the held count
(`calculate_items_amount_sold`) and prices on the unnoted object. `calc_shop_value` clamps the
stock term to [-5000, 1000] per mille and floors the multiplier at 100 per mille. It also catches a
negative `scale` result (it sets 2,000,000,000 and logs an error), but `scale` multiplies in floating
point before truncating (`server/engine/src/engine/script/handlers/NumberOps.ts`), so the guard needs
`cost` above about 300M. The most expensive object in the configs costs 500,000.

Arithmetic over every shopkeeper (126 NPCs with `owned_shop`; defaults from
`shop/configs/shopkeeper.param`: sell 100, buy 60, delta 10):

- **Single-shop round trip** (sell one then buy it back, or buy then sell back), at every stock
  level from 0 to the item's base plus 400: **0 profitable states out of 592,292**.
- **Cross-shop arbitrage**, buying from a stocking shop at base stock and selling to any shop that
  accepts the item, simulated until prices cross: 7 profitable pairs, all tiny. The best is ruby
  rings from Irksol (`cheapringshop`, sell multiplier 500) to Grum (`goldshop`, buy 700): 1,012 gp
  in, 1,417 gp out, 5 rings and about 1,418 gp per restock of Irksol's 5. Next are the same rings
  to Noterazzo (365 gp), and Tiadeche's raw karambwan to Noterazzo (12 gp).

**Ruled out** as a generator. The ruby-ring margin is real but bounded by restock.

### 7. Certs and notes

A cert's `cost` is its linked item's cost (`server/engine/src/cache/config/ObjType.ts`,
`toCertificate`). Noting and unnoting move exactly the deleted count (`INV_MOVEITEM_CERT`,
`INV_MOVEITEM_UNCERT`). **Ruled out** (lab A, noted).

### 8. Content scripts with computed-count grants

A sub-agent audit read about 50 `inv_add` sites with a computed or random count. They include
alchemy, bone conversion, coal trucks, the silk merchant, the tanner, thieving loot loops, smithing, every
fletching recipe, weapon poison, light sources, wine, the Dwarf Cannon ammo return, the Viking lyre and
firecrackers, Mort'ton serum coins, the Death Plateau dice game, Ape Atoll bones, Druidic Spirit points, the Mort'ton
catacomb chests, ranging tickets, the crystal chest, castle wars and agility tickets, runecraft and
fishing. Each one deletes its input with the same count in the same script, before any suspension,
or has no input and is bounded by a fixed table. Nothing pays by a count the player controls
without consuming the same count. Runecraft multiplies essence by a level-based factor and deletes
the essence (`skill_runecraft/scripts/runecraft.rs2`). Fishing Trawler pays oyster shells, not bass
(`minigames/game_trawler/scripts/trawler_win.rs2`).

Findings from that audit, all small:

| Site | Shape | Value | Status |
|---|---|---|---|
| `areas/area_gnome/scripts/gnome_restaurant.rs2`, the missing-utensil checks (`gnome_restaurant_missing_*`) | Aluft re-grants a batta tin, crunchy tray or gnomebowl mould when none is in `inv`; the bank and floor aren't checked, so bank or drop the tool and ask again | one tool per cycle | not lab-tested: low value, needs an active restaurant job |
| `quests/quest_legends/scripts/quest_legends.rs2`, machete cupboard | the gate counts inv, worn and bank but not the floor | one machete per cycle | not lab-tested: low value, quest-gated |
| `skill_combat/scripts/weapon_poison.rs2`, cloth branch of the `_weapon_*` handlers | would write the clean weapon into the cloth's slot | none | **dead code**: the engine runs the specific `[opheldu,tbwt_cleaning_cloth]` trigger before any category trigger, whichever item is the target (`OpHeldUHandler.ts`), and that handler cleans the weapon's own slot |
| `areas/area_karamja/scripts/trufitus.rs2`, `gnome_restaurant.rs2` job checks, `gnome_bar.rs2`, `holgart_ardougne.rs2`, `kaleb_paramaya.rs2` | the held count is read before a dialogue and deleted after it | 1-4 coins, one order payout, or one stage | only matters if the item can leave the inventory while a dialogue is open; not tested; bounded by stage or quest varps |

Not verified by the audit: the `afflicted.rs2` cure serum, the `mercenary.rs2` bet gate, the
treasure-trail casket open path, `gnome_bar.rs2` around the drink payout, and the Druidic Spirit points
derivation. Each of these is a one-shot or fixed-table reward, so none could produce millions of units.

## What would explain the leaders

No shop, gathering, crafting or content path above yields hundreds of millions of runes or tens
of millions of raw fish. The candidates left are outside this scope: the save-v8 recovery escrow and
Grand Exchange settlement (sibling Q1a), or a server-side change on the demo that the repository
doesn't show. A latent `inv_moveitem` overflow that a future script could reach is worth fixing
as a one-line engine change, but it explains nothing today.
