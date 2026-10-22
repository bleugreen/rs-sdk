# Generators in the GE ledger, escrow recovery and checkpointing (Q1a)

Question (rs/498, under the markets mission rs/495): does the server's
persistence or Grand Exchange code duplicate items, enough to explain the two
banks at the top of the demo's wealth board? nickai3 holds 16.14B (air runes
x1,923,311,135, raw shark x7,148,932, coins at the 2^31 cap, raw bass
x10,787,666, mind runes x247,717,228, oysters x2,105,389). banker holds 8.02B
(shark x18,044,690, coins at the cap, fire runes x65.9M).

**Answer: no.** Every candidate in this layer is ruled out by code reading and by
the lab, both in-process against the real engine modules and with bots on a
live lab engine through a SIGKILL. The stacks have to come from somewhere else;
see [Leads outside this layer](#leads-outside-this-layer).

## Why this layer cannot duplicate

Three properties hold together, and each candidate below breaks against one of
them.

1. **One cut for the whole world.** `World.checkpointPlayers`
   (`server/engine/src/engine/World.ts`) writes the save of every online player,
   plus every pending logout save, into the ledger's `accounts` table in one
   SQLite transaction. The autosave every 15 minutes (`savePlayers`), each
   logout (`flushPlayer`), the reconnect and takeover paths in `processLogins`,
   `Player.save()` with its default `checkpoint=true`, and every GE transfer
   (`GrandExchange.ts` `account().save`) all go through it. No path checkpoints
   one player alone.
2. **The ledger row is the save that loads.** `PlayerLoading.load`
   (`server/engine/src/engine/entity/PlayerLoading.ts`, start of `load`)
   replaces whatever save the login service passed in with the ledger row when
   one exists. Every player online since the GE shipped has a row, because each
   checkpoint enrolls everyone (`MarketStore.checkpoint(owner, save, true)`). So
   a crash rolls every player back to the same cut, and the login service's
   `.sav` files are never read for those players.
3. **Escrow is serialized once and recovered once.** `Player.save` writes the
   player-owned temporary inventories (`Player.RECOVERABLE_INVENTORIES`:
   tradeoffer, dueloffer, duelwinnings, partyroom_tempinv, deathkeep,
   trail_rewardinv, trawler_rewardinv, duelarrows) plus any saved overflow as a
   recovery list, without touching the live inventories. `load` moves that list
   into the backpack, then the bank (notes unnoted), and keeps only what still
   does not fit (`Player.recoverItems`). The temp inventories are not restored,
   so an item cannot come back both as escrow and as itself.

Within the GE, `MarketStore` (`server/engine/src/engine/market/MarketStore.ts`)
runs each placement and collection as one `IMMEDIATE` transaction that changes
the backpack, writes the offer rows and checkpoints the world. If anything throws,
including the checkpoint, the transaction aborts and `account.rollback()`
restores the backpack from the snapshot taken before the action
(`MarketStore.transfer`, `GrandExchange.ts` `account`).

## Candidates

Probes P1 to P7 are in `markets/research/rs498-ge-persistence-probe.ts`. Each step
checks one sum over the accounts involved: items held (every inventory, notes
folded into the base item, escrow, saved overflow), plus ledger escrow (open sell
remaining, open buy remaining × price), plus ledger claims (`offer.items`,
`offer.coins`), plus GE tax for coins. Any rise is reported as a duplication. A
"crash" rebuilds every player from its ledger row with nothing written since the
last checkpoint, which is what a SIGKILL leaves. L1 and L2 are in
`markets/research/rs498-lab-ge-escrow-crash.ts`, run on a lab engine with bots.

| # | Candidate | Code path | Test | Result |
|---|---|---|---|---|
| 1 | Cancel after a partial fill credits the remainder twice | `MarketStore.cancel`: only an `open` offer is refunded; the refund moves `remaining` into the claim and zeroes it | P1: sell 100 @10, buy 60 @12 (fills @10, 120 gp back to the buyer), cancel, cancel again, collect twice; then a buy partly filled by a later sell, cancelled. L1 repeats the main sequence with bots | Ruled out. Logs and coins constant at every step, in-process and in the lab |
| 2 | Collect-all with overflow re-credits a claim it already paid | `MarketStore.collectMany`: `give` returns what fit, only that is subtracted from the claim, and the guard rejects `items > o.items` | P2: buyer's backpack full; collect-all ×5, checkpoint, crash, then 5 slots free (collect unnoted), full again, 1 slot free (collect-all as notes) | Ruled out. The claim stays in the ledger across the crash and pays out exactly 5 + 45 |
| 3 | Failed transaction restores the backpack after the ledger committed | `MarketStore.transfer`: the checkpoint runs inside the transaction, so a throw aborts both; `rollback` restores only what `take`/`give` touched | P3: a bystander whose `save()` throws makes three collect-alls fail mid-checkpoint | Ruled out. The backpack and the claim are both unchanged after each failure; a later collect pays once |
| 4 | Escrow in the snapshot AND delivered, then recovered on reload | `Player.save` escrow serialization; `checkpointPlayers` cuts both traders together | P4: A's coins in tradeoffer at an autosave, trade completes, then a crash after no further checkpoint, after a recipient-only `save()`, after the donor's logout, after the recipient's logout. L2 does the first case with the real trade scripts and a SIGKILL | Ruled out. Either both roll back to the escrow cut (A recovers, B never received) or both carry forward; never both |
| 5 | Recovery runs more than once | `PlayerLoading.load` → `recoverItems`; escrow invs are temp-scoped and not restored | P5: escrow in dueloffer and tradeoffer, save and reload ×4 | Ruled out |
| 6 | Overflow retry re-adds without removing | `recoverItems` keeps `count - added` | P6: backpack and bank coins both at 2^31−1 plus 1000 in escrow; reload, retry ×5, reload ×2, free 400, retry | Ruled out. Overflow stays 1000, then 600 after 400 fit |
| 7 | Session takeover doubles escrow (old session removed without a save or logout trigger) | `World.processLogins` "player already logged in": `closeModal`, `save()` (a world checkpoint), `load` of that save into the new session, `removePlayerWithoutSave` | P7: both duel stakes in dueloffer mid-fight, takeover of one side, checkpoint, crash | Ruled out. The stake comes back once, to the new session |
| 8 | Relog during a pending logout save | `World.ts`: a login for a name in `logoutRequests` is refused at the login request, at the login response and in `processLogins`; `flushPlayer` checkpoints before the login-service acknowledgement | Covered by `server/engine/test/market-recovery.ts` ("pending logout donor cannot recover transferred coins twice") | Ruled out |
| 9 | The board counts value that does not exist (claims, overflow, escrow) | `LoginServer.ts` `updateWealthHiscores`, lines 256-287: sum of `ObjType.cost * count` over the `bank` inventory of `PlayerLoading.load(raw)` | P1 to P7 print the board value after each reload; P6 shows 2,147,483,647 with 1000 coins in saved overflow | Ruled out as inflation. GE claims, open offers and saved overflow are not counted. Escrow appears only once, as the bank items `recoverItems` actually placed (load runs it), and only when the backpack is full |

The brief also asked whether the counts look like one doubling step applied
about 31 times to a seed stack. A doubling generator would have to live in one
of the paths above, and none of them can create a unit, so this layer has no
such step. The counts are not caps or presets either (only coins sit at
2^31−1), which argues against a single `inv_add` of a fixed amount.

## Lab

- **Executor:** fedora (Linux x86_64).
- **Port block M1:** `WEB_PORT=9900 WEB_MANAGEMENT_PORT=9901 HISCORES_WEB_PORT=9902 NODE_PORT=44900 AGENT_PORT=7700 LAB_FRIEND_PORT=45900`, all checked free with `lsof` before each run. `NODE_TICKRATE=400`, `LAB_TIMEOUT=1500`.
- **GE in the lab:** `Environment.GE_ENABLED` defaults to true and `GE_DATABASE`
  defaults to `server/engine/data/market.sqlite`, so a lab engine runs the same
  ledger and the same "ledger row wins" loading as the demo, whose `fly.toml`
  only moves the file onto the volume. Nothing had to be enabled.
- **Accounts:** q1aseller, q1abuyer, q1achurn (lab only).

In-process probe, from a built engine (`BUILD_VERIFY=false bun run build` in
`server/engine`):

```sh
cd server/engine && bun ../../markets/research/rs498-ge-persistence-probe.ts
```

Result: `conserved` for P1, P2, P3, the four P4 variants, P5, P6 and P7.

Bot lab:

```sh
LAB_RUNNERS=0 LAB_BOTS="q1abuyer q1achurn" NODE_TICKRATE=400 \
WEB_PORT=9900 WEB_MANAGEMENT_PORT=9901 HISCORES_WEB_PORT=9902 NODE_PORT=44900 AGENT_PORT=7700 \
LAB_TIMEOUT=1500 speedrun/lab/lab.sh q1aseller \
  markets/research/rs498-lab-ge-escrow-crash.ts:--partner=q1abuyer:--churn=q1achurn
```

Recorded run:

| Step | Seller logs (held+ledger) | Seller coins | Buyer logs | Buyer coins | Tax | Totals (logs / coins) |
|---|---|---|---|---|---|---|
| start | 340+0 | 4570+0 | 60+0 | 7400+0 | 30 | 400 / 12000 |
| seller lists 100 @10 | 240+100 | 4570+0 | 60+0 | 7400+0 | 30 | 400 / 12000 |
| buyer bids 60 @12 | 240+40 | 4570+570 | 60+60 | 6680+120 | 60 | 400 / 12000 |
| seller cancels | 240+40 | 4570+570 | 60+60 | 6680+120 | 60 | 400 / 12000 |
| all collected | 280+0 | 5140+0 | 120+0 | 6800+0 | 60 | 400 / 12000 |

(The accounts carried items from earlier attempts, hence a start of 400 logs.)

Phase L2: the seller offered 1000 coins and q1achurn's logout checkpointed the
world. The seller's row then held 4140 in the backpack, 25 in the bank and 1000
as recovery; the buyer's row held 6800 + 25. The trade then completed live
(seller 4140, buyer 7800) and the engine was SIGKILLed. The rows the next logins
load were byte-for-byte the checkpoint's: 11,990 coins in the world at the kill,
in the checkpoint rows, and in the rows after the restart. The buyer's 1000 went
away with the crash and the seller gets them back as recovery: a rollback, not a
duplication. (The 25 bank coins per account come from the tutorial skip.)

The SDK's `getGEAvailability` derives its URL from the gateway URL and assumes a
local web server on port 8888 (`sdk/index.ts` `buildClientUrl`). On a lab with
another `WEB_PORT`, `bot.ge.open()` fails with "Unable to connect". The lab
script points the check at `WEB_PORT`.

## Leads outside this layer

The stacks need a source outside persistence and the GE. This section covers the
two that remain. The content audit is rs/499 (Q1b).

### Coins: the Managing Miscellania coffers dupe

- **Mechanism.** In the deposit handler before the fix
  (`managing_miscellania.rs2`, `[if_button,misc_both_manage:com_88]`), a
  requested amount above the coffers' free space was clamped to that space, and
  the clamp to the coins actually carried sat in an `else if` that never ran.
  `inv_del` removes only what the player carries, while `%misc_coffers` was
  credited the full amount. Carrying 1 coin and asking for more than the free
  space therefore credited up to 5,000,000, which the withdraw handler paid out
  as coins. The withdraw handler also accepted counts of 0 or less.
- **Window in this repo.** The script arrived with the LostCity 274 to 289
  upgrade, `8601955cfb` on 2026-10-09; revision 274 had no Managing
  Miscellania. The fix is `ca0fe09cc8` (Kaden Staker, 2026-10-11 17:29 -0600),
  merged as PR #73 in `e4441c6233` (2026-10-11 19:36 -0400) and hardened a minute
  later in `fb26497163` with a regression test
  (`server/engine/test/miscellania-coffers.test.ts`). The bug was in the code for
  about two days.
- **What the demo ran.** No public signal shows it. `/api/version` returns only
  the game revision (`web/pages/api.ts`, `handleVersionApi`), and no workflow
  deploys to Fly (`.github/workflows` holds ci, demo-latency-probe and
  upstream-watch), so deploys are manual and the deployed commit is not recorded.
  `fly.toml` changed on 2026-10-09 as well (`a6d124cec2`, which also hid local
  test presets from the boards). That fits a 289 deploy that day but does not
  prove one. The only dated public signal is each bank snapshot's date on the
  board.
- **Open question (for rs/500's board timeline):** did the leaders' coins jump
  between 2026-10-09 and 2026-10-11? A jump in that window would place the dupe
  on the demo; no jump would rule it out as the source of their coins.
- **Yield (arithmetic, not measured in the lab).** At most 5,000,000 coins per
  deposit-and-withdraw cycle, for 1 coin. Each handler waits on a message box, a
  count dialog and two `p_delay(0)` ticks, so about 5 ticks each and about 10
  per cycle: roughly 3 s at the demo's 300 ms tick and 1,200 cycles an hour, up
  to about 6B coins an hour. The 2,147,483,647 stack cap is reached after 430
  cycles, about 20 minutes.
- It makes coins and nothing else.

### Could coins at the cap have bought the stacks from shops?

No. A shop slot below its base stock gains one unit every `stockrate` ticks and
stops at the base stock (`World.ts`, shop restock in the cleanup phase). At the
demo's 300 ms tick (12,000 ticks an hour), the whole world's shops restock:

| Item | Shops (base stock, ticks per unit) | World restock per hour | Leader's stack | Hours to buy it |
|---|---|---|---|---|
| Air rune | Varrock (2000, 10), Port Sarim (1000, 10), `quest_mm` (1000, 10), Magic Guild (3000, 18), Mage Arena (200, 50) | 4,507 | 1,923,311,135 | about 427,000 (49 years) |
| Mind rune | Varrock (1000, 10), Port Sarim (1000, 10), Magic Guild (3000, 18), Mage Arena (140, 50) | 3,307 | 247,717,228 | about 74,900 (8.5 years) |
| Fire rune | the five air-rune shops | 4,507 | 65.9M | about 14,600 (1.7 years) |
| Raw shark | Canifis (1, 1000); the Catherby, Miscellania and Rellekka fish shops have base stock 0 | 12 | 7,148,932 | about 596,000 |
| Raw bass | fish shops with base stock 0 only | 0 | 10,787,666 | never |
| Shark | no shop | 0 | 18,044,690 | never |

Buying out the base stock after each restart adds a few thousand units at most.
The GE has run since 2026-09-07, about 1,100 hours before this was written.
So the stacks needed sellers (other players' items, by trade or GE) or a
generator. The GE itself creates nothing (this doc).

### Staff-made items

- **Where the level comes from and what it unlocks:** rs/499,
  `docs/markets/generator-content-shops.md` section 3. In short, the level comes
  from the account row (default 0); cheats need level 3 or 4; debug procs also
  need a non-production world; `NODE_DEBUG` lowers nothing.
- **Added here.** On the demo's non-production config, `giveother` and
  `teleother` are production-only (`ClientCheatHandler.ts`,
  `cmd === 'giveother' && Environment.node.production`). So a staff account can
  `::give` only to itself, and items reach another bank only by trade or the GE.
  The debug proc `~bank_preset` (`content/scripts/_test/scripts/cheats/cheat_bank.rs2`)
  clears the bank, then fills it with 2,147,483,647 coins, 2,147,483,647 of each
  of 14 rune types and of caskets, and 65,535 of each talisman, ore, bar, log,
  raw and cooked fish (raw shark and raw bass included) and uncut gem.
- **Public fields that mark a staff account: none.** `/playerpositions`
  (`web/worldfeed.ts`, `getPlayerPositionsJson`) carries x, z, level and name.
  The world feed's player rows carry slot, name, x, z, level and combat level.
  The boards carry no such field, but every board query, the player page
  included, filters `account.staffmodlevel <= 1` (`web/pages/hiscores.ts`,
  `RankedHiscoresWorker.ts`), and `hiscoreEligible` (`LoginServer.ts`) writes no
  rows above level 1. So any account visible on a board is level 0 or 1 when the
  page renders, and an account at level 2 or above is absent from every board.
  The chat crown would show the level, but only to someone logged in.
- **Public evidence that would settle it.** For staff-made items: GE history
  (`/api/market/*`) showing large volumes of these items at odd prices just
  before a leader's stack grew; counts in a bank that are whole multiples of the
  preset amounts (65,535 or 2,147,483,647; the bank board's item search gives
  exact counts); a single-snapshot jump in the board timeline. Against it: a
  ramp in the timeline that matches gathering or market volume. nickai at
  exactly 2,147M (coins at the cap and little else) is what either a
  `~bank_preset` coin line or a coffers run leaves, and public data alone cannot
  tell them apart.

### Other notes

- **Offline grants.** `server/engine/tools/server/grant-bank-item.ts` patches a
  `.sav` at version 7. Any player with a ledger row loads the row instead
  (property 2 above), so on the demo such a grant does not take effect for
  anyone who has played since the GE shipped.
- **Duel takeover (content, not a duplication).** The takeover path skips the
  `[logout]` trigger, so `~duel_arena_logout` does not reset the opponent.
  Probe P7 shows the stake comes back once. Whether the opponent's later forfeit
  can move their stake into the new session's `duelwinnings` (a transfer between
  two players, not a dup) is a content question.
