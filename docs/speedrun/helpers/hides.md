# hides

`speedrun/helpers/hides.ts`. Supplies the hard leather for S25d Crafting's hard-leather-body line (`docs/speedrun/skills/crafting.md`). It takes cowhides in a Lumbridge cow field, has the Al Kharid tanner tan them to hard leather, and banks the leather at Al Kharid. It can also buy the line's thread and needles at Dommik's. It finishes once the account's bank holds `target` hard leather and the thread and needles asked for, so a borrowed account goes back to its own job by itself (cairn://p/rs/350).

## What it does

1. **First bank visit.** Walks to Al Kharid bank (crossing the toll gate with `travelTo`), deposits everything but coins, and carries `carryCoins` out. A borrowed earner's food goes into its bank; the earner role buys its own again. If the bank holds cowhides, it withdraws as many as fit, so hides stranded by an interruption still get tanned.
2. **Gather.** In the field it picks up any cowhide pile it can stand on, otherwise attacks the nearest reachable cow nobody is fighting, waits for it to leave the npc list, and takes the hide the tick after. Raw beef and bones stay on the ground.
3. **Tan.** With 27 hides (or enough to reach the target) it crosses the gate and uses the tanner's `Trade` option (op3, interface 679), then clicks hard leather 'All' (`tanner:com_98`, component 8690): 3 gp a hide (`tanner.rs2`, `tanner.constant`).
4. **Bank** the leather, then go back to the field.
5. **Shop**, at most once per trip: when the bank is short of `thread` or `needle`, it buys what Dommik's shelf holds (craftingshop2: needle 3, thread 100). A bank visit that only banks the purchase doesn't send it back, so it never shuttles between shop and bank.

It is meant for accounts that one-hit a cow (8 hitpoints, max hit 1 against them): cows respawn 90 ticks after death (`all.npc`), so the spawns set the pace, not the kills. A combat-3 account would work too, much more slowly.

## Options

| Option | Default | Meaning |
|---|---|---|
| `field` | `east` | `east`: ten cows at x 3243-3261, z 3258-3295 (m50_50, m50_51), between Lumbridge and the Al Kharid fence. `north`: seven cows at x 3154-3203, z 3318-3342 (m49_51, m49_52). |
| `target` | required | Hard leather to have in this account's bank before finishing. |
| `thread` | 0 | Thread to have in the bank (bought at Dommik's). |
| `needle` | 0 | Needles to have in the bank. |
| `carryCoins` | 1000 | Coins carried out of each bank visit (at least 101: 27 tans and two tolls). |

## Thread

`leather.rs2` `@craft_leather` refuses a hard leather body unless one thread is held. It then increments `%thread_used` (a saved varp) and deletes a thread when the count passes 4, i.e. on every fifth body. So n bodies need floor((n-1+s)/5)+1 thread, where s is the crafter's starting `%thread_used` (0-4). That gives 224 for 1,116 bodies at any s, and 230 for 1,142 in the worst case (`threadNeeded` in the role, tested). With no thread held, a body attempt opens an objbox instead of failing quietly.

## Rates (demo, 2026-10-22, rs/350)

Three 99-melee coin earners, borrowed and run standalone from a dev copy on bbs, each on its own loopback gateway:

| Account | Field | Leather per account-hour | Notes |
|---|---|---|---|
| cairn_h45 | east | about 515 | Mostly public cowhides that other players' bots leave in the field |
| cairn_h51 | east | about 550 | Same field |
| cairn_h41 | north | about 245 | Its own kills: close to the clean spawn rate |

One trip (27 hides, then the gate, the tanner, the bank and back) takes about 3 minutes and costs about 100 gp (81 tanning, 20 toll). The east field's free hides depend on who else is there; about 250 an hour is the floor from kills alone. Dommik's thread shelf refilled far faster than the inventory's 1 per 5 ticks suggests (176 bought in about 3 minutes).

## Delivery

The leather stays in each account's bank. A one-shot `handover` (fresh `id`, `bank` = Al Kharid 3269,3167, `meet` = Varrock west 3185,3436) withdraws it as notes and trades it to a receiver running `mule` with default options at Varrock west, which banks what it gets.
