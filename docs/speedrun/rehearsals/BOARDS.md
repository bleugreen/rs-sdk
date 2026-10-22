# A cairn on every board: pricing the boards without a cairn row

The operator would like a cairn row on every hiscore board, even without 90% confidence of #1
(main's ruling, 2026-10-22 12:3x PDT, cairn://p/rs/main/chat). Every row priced here is a
**measurement row under addendum 18** (rs/147, amended 19:56 PDT 2026-10-21): it runs to 99, it
is not a record attempt unless its own gate says so, and the row stands wherever it lands. This
page prices the thirteen boards without one and builds the queue. Issue: cairn://p/rs/455 (under
rs/147). **No account logged in for it, no lab ran, and the twin was not touched.**

Labels follow [RUN-HOST.md](../RUN-HOST.md): **m** measured, **r** read (source or page), **i**
inferred (arithmetic or a model over m and r inputs, basis given).

## Main's 'today' test

A row may start today only if **all** of these hold: a public, exploit-free route; **surplus
stock only** (never the scored account's staged lines, never attempts 2-3's: their bones, herbs,
essence, gems, bars, arrows); **no twin**; **no helper time from the staging children** (rs/331,
rs/383, rs/387, rs/443, rs/439); the **lite client from bbs**; **inside the login cap** with rs/41's
count; and **not Cooking, Magic or any burst-dialogue route** before the run (tenet 18). Nothing
starts before rs/41 confirms the account and the count, and nothing outranks attempt 1's staging.

## The boards (read 2026-10-22, 19:33-19:38 UTC)

Read from the public pages (`https://rs-sdk-demo.fly.dev/hiscores?category=N&profile=main`), one
request at a time through `speedrun/tools/hiscore-scrape.ts`'s `PoliteFetcher` (m). Ticks are the
time cell's hover title. **The page format changed during the read:** the first seven boards
carried `title="N ticks"`, the last six (and a re-read of all thirteen) `title="S seconds of game
time"`, with S = ticks x 0.3 exactly (11.4 s is 38 ticks). The repository's scraper parses only the
old form (see Findings).

| Board (category) | #1 | #2 | #3 | Next rows that matter |
|---|---|---|---|---|
| Attack (1) | stunattacker 4,728 | stunhitpoint 8,498 | nickstriker 10,193 | #4-8: 12,073, 12,433, 18,421, 18,580, 25,306 |
| Defence (2) | stundefence 7,974 | nickwarden 9,814 | lachdef001 12,333 | #4-7: 13,674, 18,421, 18,580, 35,916 |
| Strength (3) | stunhitpoint 4,966 | stunstrong 7,553 | nickflex 8,284 | #4-8: 10,448, 10,961, 12,595, 14,641, 15,304 |
| Hitpoints (4) | stunhitpoint 17,058 | nickoverall 18,864 | nickmax 21,398 | #4-7: 26,340, 28,538, 28,944, 35,916 |
| Ranged (5) | nickslinger 5,595 | nickknives 7,477 | lachrange002 8,918 | #4-7: 11,754, 21,269, 21,398, 35,916 |
| Prayer (6) | stunpray 1,281 | nickprays 2,028 | nickmax 2,037 | #4-7: 2,224, 2,725, 9,243, 12,006 |
| Magic (7) | jackalopemg3 1,324 | stunmage 1,513 | nickmagi2 3,416 | #4-5: 10,045, 22,087 |
| Cooking (8) | jackalopeck3 38 | stuncook 51 | stuncookv2 53 | #4-8: 142, 155, 212, 304, 1,021 |
| Fletching (10) | jackalopefr1 58 | stunfletch 66 | nickfeather 98 | #4-10: 136, 287, 312, 611, 1,274, 2,873, 17,697 |
| Crafting (13) | nickgemcut 197 | crab26eba2 536 | nickcrafti 580 | #4-9: 878, 1,195, 2,037, 2,698, 2,995, 9,355 |
| Smithing (14) | stunsmither 1,337 | nickcrucible 1,839 | nickforged 1,893 | #4-9: 2,021, 2,032, 2,519, 4,643, 5,858, 17,697 |
| Herblore (16) | jackalopehl2 447 | stunherblore 465 | jackalopehl1 1,146 | #4-7: 2,037, 2,474, 2,698, 17,697 |
| Runecraft (21) | jackaloperc6 2,354 | stunrc 2,397 | nickaircraft 3,265 | #4-7: 4,339, 4,668, **32,229**, 35,916 |

Every row on these pages is level 99. A row ranks by time among the 99s, so an expected rank is 1
plus the number of 99s faster than it.

## Summary

| Board | Route (doc) | Supplies: surplus / scored-run stock | Helpers (role, time, collision) | Tenet 18 | Ticks from the parked name (i) | Expected rank | Lite from bbs? | Passes today? |
|---|---|---|---|---|---|---|---|---|
| **Runecraft** (rs/461) | solo air altar: Duke Horacio's talisman, Falador east bank to the air ruins and back, 27 essence a trip, 296 trips (this page; loop m in [altar-giver.md](../helpers/altar-giver.md)) | surplus: 8,000 rune essence of ~85,000 beyond three attempts' 16,260; the talisman is free / stock: none | one essence holder (h30 or h31, rs/41's fleet), one noted trade at Falador east bank, ~5 min; no staging child | none: plain play, ordinary dialogue | **~30,100** (27,700-32,700) | **6** (7 if trips average over ~108) | yes: no next-tick reaction; late reactions priced at +8 a trip | **YES**, on rs/41's count, a courier from h30/h31, a crafter loop to build, and a new name (keep `cairn_binds` for the post-run rank-1 row) |
| **Fletching** | arrowheads on headless arrows ([fletching.md](../skills/fletching.md) §1-2; [ASSISTED.md](ASSISTED.md)) | surplus: ~15-27 mithril tips, nothing else / stock: the 1,500 mithril tips on mule1 are attempt 1's H14 load (1,485); attempts 2-3's are being rebought by h76 | none possible today | none (the packet cap is public, shown by #1 and #2) | ~66 (parked) or ~60 (new name), if supplied | 2-3 | yes (blind bursts), small spill risk | **NO**: no surplus tips |
| Smithing | platebodies at the Varrock west anvil, one two-way trade an inventory ([ASSISTED.md](ASSISTED.md) Smithing; rs/188) | surplus: none of the 365 adamantite bars (attempt 1 holds 354; attempts 2-3 have none) / stock: a01's H21a bars | the anvil helper for the whole route; a01 is H21a's giver (rs/331) | none | ~1,160 twin; ~1,400 bbs | **1** (twin), 2 (bbs) | no for rank 1: ~4 reactions a trade | NO: bars, helper, twin |
| Ranged | dwarf multicannon at the level-37 Wilderness poison spiders, rune knives from 70 ([ranged.md](../skills/ranged.md) §1; [combat.md](../skills/combat.md)) | surplus: none: h92's 2 sets and 1,416 balls are attempts 1-2's set and attempt 1's balls; rune knives scarce / stock: H11, H23 | the cannon helper (h92) for a third set (Nulodion, 750,000) and balls from steel bars; the account does Dwarf Cannon itself | the cannon spot is S27's method: post-run | ~3,500 with knives; ~4,950 cannon alone | **1** | possible, but PvP and reloads favour the twin | NO |
| Defence | Waterfall (13,750 Attack and Strength), Prayer 43, defensive melee on the Yanille ogres under Protect from Melee ([melee-rate.md](../research/melee-rate.md); [combat.md](../skills/combat.md)) | surplus: none: prayer potions (GE-only, attempts' bids), rune scimitar (none held), bones for Prayer 43 (attempts 2-3's fallback) / stock: the potions and bones | none after a supply trade | none (stunhitpoint shows the route) | ~6,300 (i, low) | **1-2** | yes, slower: +2-3 a kill re-target | NO: supplies |
| Hitpoints | the same route, any style; Hitpoints rides at 1.33 a damage ([melee-rate.md](../research/melee-rate.md) §3-4) | as Defence | as Defence | none | ~16,800 (i, low) | **1-2** (stunhitpoint 17,058) | yes, slower | NO: supplies |
| Attack | Waterfall, then accurate melee 83-99 on the ogres ([melee-rate.md](../research/melee-rate.md) §5: ~4,540 for Attack alone) | as Defence | as Defence | none | ~4,900 | **2** | yes, slower | NO: supplies |
| Strength | Waterfall, then aggressive melee 83-99 (3,857 m plain, 3,286 m boosted) | as Defence | as Defence | none | ~5,300 | **2** | yes, slower | NO: supplies |
| Crafting | hard leather bodies from 28 (needle, delay-free, ~7 ticks per 26 on the browser), leather items 1-28 ([crafting.md](../skills/crafting.md) §2, §9) | surplus: none: mule1's 1,169 hard leather is attempt 1's S25d; rs/350's hides line makes attempts 2-3's; gems none / stock: H21d | a leather courier; the hides line is rs/41's | the direct hard-leather craft is S25d's piece: post-run | ~420 twin; ~720 bbs | **2** (twin), 4 (bbs) | rank 4 only | NO |
| Magic | enchant 7-80 by rings, Mage Arena at 80, Charge to 99 ([magic.md](../skills/magic.md) §7) | surplus: none: diamond 37 and dragonstone 78 rings are unobtainable on the demo; the run's 60 rings and 570 blood runes are attempt stock | the jeweller (rings) and blood-rune line | **never before the run** (Charge without cooldown is withheld) | ~1,300-1,700 (i, low) | 2-3 | yes for casting | **NO** (tenet 18) |
| Herblore | Druidic Ritual (250 base, to 28), then finished potions at a bank booth, 5 a tick: 112 from 28 ([herblore.md](../skills/herblore.md) §1) | surplus: none: H21e is attempt 1's and untouchable; attempts 2-3's herbs are rs/387's / stock: H21e | rs/387's gatherers | 5 mixes a tick is public (#1, #2); Druidic Ritual read page by page, never burst | ~800-1,100 (i, low: the quest unwalked here) | **3-4** | yes | NO: herbs |
| Cooking | wine bank fermentation, one login (rs/47; [cooking.md](../skills/cooking.md) §1); kebabs as the no-wine route | surplus: none: H21c's 520 wines are attempt 1's; grapes for 2-3 / stock: H21c | the wine maker (h40) | **never before the run** (wine fermentation is withheld) | ~85 wine; ~150 kebabs | **4** (wine), 5 (kebabs) | yes | **NO** (tenet 18) |
| Prayer | bury bones at a bank booth, ~2.07 ticks a bone ([prayer.md](../skills/prayer.md) §1: 555 dragon bones, 1,151) | surplus: none: S07 takes every dragon bone and ~719 babydragon; the ~594 babydragon and 2,526 big bones left are attempts 2-3's fallback (staging.md) / stock: H4.x, H14 | a bones courier (h51-h56: rs/387 owns h51/h52) | none | ~2,800 babydragon; ~5,500 big bones; ~1,200 dragon | **6** (1 only on 555 dragon bones) | yes | NO: bones |

## Fletching

**The 1,512 mithril arrowtips are not surplus.** The figure comes from rs/331's staging record,
`helpers/staging.md`, H14 margin row: "The fleet's 1,512 mithril tips stay unused" (commit
c1796596, 05:15 PDT). In context it means the Fletching margin is taken in **adamant**, not
mithril (rs/376 item 3: "mithril would open 2 new stacks"), so the mithril tips are *not used for
the margin*. It does not mean they are spare (r):

- **mule1's bank holds mithril arrowtips 1,500** (staging.md, "Trade giver 1's bank", 09:25 UTC):
  750 from h91 and 750 from h76 (operations log, 09:05 and 09:15 UTC).
- **H14, S18's courier load 0, takes mithril arrowtips 1,485 every attempt** (staging.md H14;
  STEP-MANIFEST.md's ledger rows H14 and S18: `mithril arrowtips x1485`, consumed in S18, with
  Fletching 99 reached inside S18 on 4,560 headless arrows and 1.3-12.5 base an arrow).
- **The per-attempt table says the tips held are "exactly one attempt's (mule1)"**, and "h76 is
  back camping Hickton's toward its targets (attempt 2's)".

So at most **15 tips** on mule1 (27 if the 1,512 counted a dozen elsewhere) are free, against the
3,600 headless arrows and the six tiers a 1-99 needs. Any arrowtip bought today competes with h76's
attempt-2 buying at the same shops.

**Price if it were supplied** (r, [ASSISTED.md](ASSISTED.md) Fletching, rs/216): the route is at
the packet floor (240 actions at 5 a tick, 48 ticks; 50 m from level 1 on bbs). From the parked
`cairn_carves` (8 ticks spent, CLAIMS.md): 8 + ~3 login + ~5 trade + 50 = **~66**, which ties
stunfletch's 66, so **rank 3** (a tie lists the earlier stamp first, i). A brand-new name is ~60,
**rank 2**. jackalopefr1's 58 is the floor plus a fresh account's ~10 ticks: nobody can pass it.
No lever: 5 delay-free actions a tick is public, and #1 and #2 show it. The loop is blind fixed-slot
bursts, so the lite client from bbs works; a burst that straddles a tick spills a few ticks, not
more.

**The logs route on fleet surplus** (r, `cut_logs.rs2`: one cut per 2 ticks, `%action_delay`
+2; `cut_logs.dbrow`: 7.5 base for 15 shafts from a normal log, magic shortbow 83.3 at 80, magic
longbow 91.5 at 85). Below 80 the only fleet-surplus log is the normal log, and yew, maple and
willow are short of S03's three attempts (staging.md H2: yew 67 against 72). So: normal-log shafts
with feathers attached (22.5 base a log in ~2.2 ticks) to 80, about 475 logs and 7,100 feathers,
then 325 magic logs to 99. About **2,050 ticks** (i), **rank 9** (between nickfletch's 1,274 and
2,873). It fails today twice over: the normal logs must be chopped (new production, not stock) and
the feather count beyond attempts 2-3 is unconfirmed; and the magic logs move through the
woodcutter-to-mule2 hop that rs/439's droppers use (kits.md, "Loading full packs").

**Verdict: NO today.** Post-run: the rune-arrow route on whatever tips the attempts leave (rank 2
from a new name, 3 from `cairn_carves`), or the logs route after rs/439 (rank 9).

## Runecraft (solo, walked)

No givers today means the account banks for itself. Three facts set the route (r):

- **Run is infinite on the demo** (`NODE_INFINITE_RUN`, `Player.ts:754-757`;
  [travel-and-overhead.md](../research/travel-and-overhead.md)), so walks are 2 tiles a tick at any
  weight, and rune essence weighs 2 g (`ores.obj`).
- **A talisman is needed to enter and is not consumed** ([runecraft.md](../skills/runecraft.md) §4).
  Air talismans come free from Duke Horacio at Rune Mysteries' start (`duke_horacio.rs2:35`). The
  fleet's are spoken for: mule1's 3 are one per attempt (H4), and the S06 givers keep theirs. The
  fleet's 57 body talismans are on h51-h54 (altar-giver.md, 00:01Z), and every one of those
  accounts is in a staging line today (h51/h52 are rs/387's; h53/h54 feed H21e's limpwurt).
  No earth, fire or water talisman is recorded anywhere in the fleet.
- **The bank-to-ruins legs** (r, `sdk/pathfinding.ts` `findLongPath` on the collision map, tiles
  summed between waypoints): Falador east bank to the air ruins 78, Varrock east bank to the earth
  ruins 75, Edgeville bank to the body ruins 116, Al Kharid bank to the fire ruins 90; spawn to
  Falador east bank 319.

**The route: air, 1-99, from Falador east bank.** 39,938.3 base / 5.0 a essence = **7,988 essence,
296 trips of 27** (the talisman takes the 28th slot) (r, `speedrun/lib/xp.ts`; i). The trip is the
S06 givers' restock loop with a craft in place of the trade, which rs/196 measured: **Falador east
bank to the air ruins and back, 91-93 ticks, mean 91.7, n = 18** (m, lab, 300 ms; altar-giver.md
"Measured"; the lab bank's essence was a staff give, so a real withdraw adds ~1). From bbs on the
lite client each of the trip's ~4 reactions (bank open, room arrival, craft end, portal) lands 2-3
ticks late, so **~101 a trip** (i).

| Part | Ticks | Basis |
|---|---|---|
| `cairn_binds` parked | 8 | m, CLAIMS.md |
| Login frames | ~3 | m, HARNESS.md |
| Duke Horacio upstairs in Lumbridge castle, Rune Mysteries' start, the air talisman | ~45 | i: ~20 tiles and a staircase each way, ~8 dialogue pages at 2-3 ticks each from bbs |
| Lumbridge to Falador east bank, 319 tiles | ~160 | r (path), i (2 tiles a tick) |
| The courier's trade: 8,000 noted essence, one stack | ~6 | m: 4 ticks a noted stack (run-transitions.md §3), plus the bbs reaction |
| Deposit all, withdraw the talisman and 27 essence | ~6 | i |
| 296 trips at ~101 | ~29,900 | m (91.7 lab) + i (real withdraw, bbs reactions) |
| The last trip stops at the 99 craft (no walk back) | -45 | i |
| **Total** | **~30,100** | i; 27,700 at the lab's 93 a trip, 32,700 at 110 |

**Rank 6** against today's board: between nickairrunes' 4,668 and nickoverall's 32,229. It holds
while trips average under ~108 ticks; at 108-120 it is rank 7 (stunbaron 35,916). Every row above
it is helper-fed (i: 2,354-4,668 is in-room trading, runecraft.md §2).

**Alternatives priced and rejected for today.**

| Variant | Trips | Ticks a trip (i) | Total (i) | Why not today |
|---|---|---|---|---|
| Air 1-20, then body 20-99 from Edgeville (7.5 a essence) | 1 + 197 | ~150 (the givers' measured Edgeville loop, 139-143, plus bbs reactions) | ~29,900 | needs one fleet body talisman, and every holder is in a staging line; no faster |
| Air 1-9, then earth 9-99 from Varrock east (6.5 a essence) | 1 + 228 | ~108 | ~24,900 | no earth talisman held anywhere; a GE buy would be new stock |
| Air 1-14, then fire from Al Kharid (7.0) | 1 + 211 | ~123 | ~26,200 | no fire talisman held |

**Supplies.** Rune essence 8,000 (7,988 plus a dozen spare), against 101,782 held on h30-h33 at
09:30 UTC (staging.md; ~114,000 now per the issue) and 5,420 an attempt (16,260 for three). It is
surplus by a wide margin. rs/383's S21 roster draws its 5,346 from h33 (altar-giver.md), and the
S06 givers are h70-h72, so **the courier is h30 or h31**: one `handover` (bank = meet = Falador east
bank, a fresh id, `--return`), the procedure in altar-giver.md ("stage givers' essence"). About five
minutes of one essence miner and no staging child's account.

**Lever check.** None. Banking, walking and one craft a trip is ordinary play; Duke Horacio's
dialogue is a quest start read page by page, not a burst. The row is slow because it is honest, so
it shows nothing about the scored run's S06/S21 cycle.

**Client and host.** Lite client from bbs. The loop has no next-tick reaction: each late reaction
costs its 2-3 ticks once, and they are in the ~101. `cairn_binds`' credentials are on bbs
(`~/rs-fleet/bots`, copied by rs/41 from rs/167's claims).

**Logins.** One account for ~2.7 hours of wall time (30,100 ticks at ~0.32 s), plus the courier's
short login if it is not already in the world. rs/41 confirms the count.

**What it still needs.** A crafter loop: no solo crafter exists. altar-giver.ts already walks this
exact loop (`ROUTE_ALTARS.air`, the Falador east restock), so the loop is that walk with a craft and
a portal click where the trade was. It needs building and a short lab check before the login,
which are not this child's.

**Verdict: YES today**, conditional on rs/41's count and an h30/h31 courier, behind attempt 1's
staging. rs/147 filed it as cairn://p/rs/461 (the loop on altar-giver.ts, a lab check, then the
bbs run once the operator names the account).

**Use a new name, not `cairn_binds`.** A name races once, and Runecraft has a much better row
after the run: the scored run's own in-room cycle with its givers. From a fresh account, air 1-44
is 7 crafts and the body altar 44-99 is S21's 194 crafts: **~1,360 crafting at the tuned 7, ~1,750
at the stock 9** (RUN-ORDER.md S21: "~1,746 at the body altar's 194"), plus ~260 of login, travel
(spawn to the air ruins 280 tiles, the air ruins to the body ruins 206) and entries. **~1,650-2,050
(i), rank 1** against jackaloperc6's 2,354. It needs the twin, the S06 and S21 givers and 23 body
talismans, and it shows S06/S21's cycle, so it is post-run only. Spending `cairn_binds` on the solo
row today (~30,100) would leave that rank-1 row needing another name anyway; a fresh name for the
solo row keeps the parked one for it.

## The other eleven boards

Each of these fails today on supplies, on tenet 18, or on both. None needs a lever to be priced
below; the two that use one (Cooking, Magic) wait for the run in any case. Ticks are from the
board's parked name ([CLAIMS.md](CLAIMS.md): 6-9 ticks spent) plus ~3 login frames.

### Smithing

Priced by rs/216 ([ASSISTED.md](ASSISTED.md) Smithing): platebodies at the Varrock west anvil fed
by one two-way trade an inventory, rs/188's helper measured at 1,024 ticks from the first request
(m, lab); from `cairn_forges` with the 204-tile walk, **~1,155-1,165** (i), **rank 1** against
stunsmither's 1,337. The mithril-only variant is ~1,270, still under 1,337 but with no margin. The
gate is the bars: 365 adamantite an attempt, 354 held for attempt 1 (staging.md, "Spent per
attempt": 0.97 of one attempt), none for attempts 2-3. **Main's ruling stands (2026-10-21
17:17): deferred until SCORED's adamantite is met and the line is otherwise idle.** The step is
reactive (about 4 reactions a trade on each side), so the anvil helper and the account belong on the
twin; from bbs the reactions add ~200-300 (anvil.md), ~1,400, **rank 2**. a01, the only anvil
helper, is H21a's giver (rs/331).

### Ranged

The cannon at the level-37 Wilderness poison spiders, a melee weapon wielded to 70 and rune knives
from 70: **Ranged 1-99 about 2,200 ticks**, plus the Dwarf Cannon quest (1,078) the account needs
to set the cannon (r, [ranged.md](../skills/ranged.md) §1), plus ~250 of travel and login:
**~3,500** (i). Cannon alone from 1 is ~3,620 (ranged.md, 11.03 a tick): ~4,950. Either is **rank
1** against nickslinger's 5,595. Supplies: a third cannon set (h92 holds two, attempts 1-2's;
Nulodion sells only to a Dwarf Cannon player, 750,000), ~1,300 balls a row (h92's 1,416 are
attempt 1's ~1,270), up to ~760 rune knives (scarce), a rune scimitar, food. **Tenet 18: post-run.**
The spot and the cannon-on-melee-style roll are S27's method, and a 3,500 row discloses them.
Risk: any player within 37 combat levels can attack a combat-3 account there (`pvp_combat.rs2`).
One account would also post Defence and Hitpoints rows (the scored run's kit takes both to 99
inside the Ranged row); tenet 13 is one skill per account, so that is main's call.

### Attack, Strength, Defence, Hitpoints

stunhitpoint's page is ordinary melee, reproduced in the lab (r/m, [melee-rate.md](../research/melee-rate.md)):
Waterfall (13,750 base Attack and Strength, 1,060 ticks measured end to end, `quests/waterfall.md`),
Prayer 43 for Protect from Melee (~11 dragon bones or ~53 big bones buried), then the ogres west of
Yanille with a rune scimitar and an amulet of strength, taking 0 damage. Measured: Strength 83-99
3,857 plain (3,286 with both boost prayers), Attack 83-99 3,482, Hitpoints at 2.6 base a tick.
On that route (i, low: the travel and the bone fetch are not measured):

| Board | Route | Ticks (i) | Board rows around it | Expected rank |
|---|---|---|---|---|
| Attack | Waterfall + Attack 83-99 (melee-rate.md §5: ~4,540 for Attack alone) + ~350 | ~4,900 | stunattacker 4,728; stunhitpoint 8,498 | **2** |
| Strength | Waterfall + Strength 83-99 plain + ~350 | ~5,300 | stunhitpoint 4,966; stunstrong 7,553 | **2** |
| Defence | Waterfall (for the max hit) + defensive 1-99 at ~8 base a tick (combat.md's 9.2 at higher Strength) + ~350 | ~6,300 | stundefence 7,974; nickwarden 9,814 | **1-2** |
| Hitpoints | Waterfall + any style; 39,900 base at ~2.58 a tick (lab 2.55-2.60) + ~350 | ~16,800 | stunhitpoint 17,058; nickoverall 18,864 | **1-2** |

Supplies, none surplus: prayer potions, 41-116 doses a phase (melee-rate.md §4; GE-only, and the
attempts' own bids rest unfilled), or food instead (the sharks are attempts'); a rune scimitar (none
held; the mithril scimitars are one an attempt); an amulet of strength (the attempts' is still being
enchanted, rs/347); Prayer 43's bones (attempts 2-3's fallback). Waterfall's dialogue is read page
by page, never burst. From bbs on the lite client each kill's re-target lands 2-3 ticks late: about
+300 a 111-kill phase, inside the figures above only roughly. No lever: stunhitpoint's page shows
the route publicly.

### Crafting

Gems are out (no diamonds, no dragonstones; the 108 mixed gems are cut in attempt 1's wine windows).
Hard leather bodies are crafted delay-free with a needle, 26 an inventory, measured at 7.0 ticks per
26 on the browser client (r, [crafting.md](../skills/crafting.md) §9), ~320 from 28 on ~1,120 hard
leather; leather items take 1-28 (~250 base, ~50 ticks queued, i). From `cairn_crafts` with the walk
to a booth: **~420 on the twin, rank 2** (nickgemcut 197; crab26eba2 536). It is bank-cycle bound,
so from bbs the ~43 cycles' reactions add ~300: ~720, **rank 4**. Supplies: mule1's 1,169 hard
leather, 250 thread and 2 needles are attempt 1's S25d (staging.md H21d); rs/350's hides line makes
more, which attempts 2-3 need first. **Tenet 18: post-run**: the direct hard-leather craft is S25d's
piece of the scored run.

### Magic

**Never before the run** (tenet 18: Charge without its cooldown is a withheld lever). From level 1
the route enchants rings 7-80 (sapphire 12, emerald 27, ruby 16, diamond 37, dragonstone 78), takes
the Mage Arena at 80 and Charges to 99 (r, [magic.md](../skills/magic.md) §7, "From level 1"):
about 450 ticks of casting plus the arena and its walk, **~1,300-1,700 (i, low), rank 2-3**
(jackalopemg3 1,324; stunmage 1,513; nickmagi2 3,416). Even after the run it has no supply:
diamonds and dragonstones are unobtainable on the demo (rs/41), so the ring ladder needs another
top tier, and the blood runes are the scored run's scarcest line.

### Herblore

Druidic Ritual is mandatory (Herblore 3 gates every action; the quest gives 250 base, level 28),
then finished potions at a bank booth, 5 a tick: **112 ticks from 28** (m, bbs; [herblore.md](../skills/herblore.md) §1).
The quest is not walked in any doc here; with the meats, the dungeon cauldron and Taverley's walks
it is ~600-900 (i, low). From `cairn_brews`: **~800-1,100, rank 3-4** (jackalopehl1 1,146;
nickmax 2,037). Five mixes a tick is public (jackalopehl2's 447 and stunherblore's 465 show it);
the quest's dialogue must be read page by page, not in bursts. Supplies: 245 unfinished potions and
their secondaries. Attempt 1's (H21e) are untouchable, and attempts 2-3's herb stock is rs/387's. Post-run only.

### Cooking

**Never before the run** (tenet 18: wine fermentation is withheld). rs/47's wine route is 45-51
active ticks, 73-77 from login (m, [cooking.md](../skills/cooking.md) §1), so from `cairn_cooks`
(8 parked) **~85, rank 4** (stuncookv2 53; jackalopeck2 142). The kebab route (131 m) gives ~150, **rank 5**
(jackalopeck1 155). jackalopeck3's 38 is below anything here. Supplies: 450 unfermented wines (H21c's
520 are attempt 1's; h40's grapes make attempts 2-3's), or ~340 kebab mixtures and pittas.

### Prayer

Bury at a bank booth: 555 dragon bones in 1,151 ticks from level 1 (r, [prayer.md](../skills/prayer.md) §1;
~2.07 a bone with banking). Dragon bones would make **~1,200, rank 1** (stunpray 1,281), but S07
takes every one held. On babydragon (30 base, 1,331 bones) **~2,800**, on big bones (15 base, 2,663)
**~5,500**: both **rank 6** (lachpray001 2,224, nickoverall 2,725; srpray1 9,243). Supplies: the
~594 babydragon and 2,526 big bones left after attempt 1 are attempts 2-3's Prayer fallback
(staging.md, "Spent per attempt"). Post-run, from whatever bones the attempts leave.

## Post-run queue (by expected rank)

Ordered by expected rank, then by how much of the scored apparatus a row needs (least first).
Every row is a measurement row under addendum 18 unless its own P(#1) gate passes.

| Order | Board | Row | Ticks (i) | Expected rank | Needs |
|---|---|---|---|---|---|
| 1 | Runecraft | helper-fed, S06/S21's roster, on `cairn_binds` | ~1,650-2,050 | 1 | twin, the S06 and S21 givers, 23 body talismans |
| 2 | Smithing | anvil platebodies, `cairn_forges` | ~1,160 | 1 | twin, an anvil helper, 365 adamantite bars (main: after SCORED's are met) |
| 3 | Ranged | cannon at the poison spiders, rune knives from 70 | ~3,500 | 1 | a third cannon set, ~1,300 balls, rune knives, Dwarf Cannon on the account |
| 4 | Defence | Waterfall + defensive melee under Protect from Melee | ~6,300 | 1-2 | prayer potions or food, rune scimitar, Prayer 43 bones |
| 5 | Hitpoints | the same route | ~16,800 | 1-2 | as Defence |
| 6 | Fletching | rune arrows, a new name | ~60 | 2 | 3,600 headless, 2,595 rune tips (or the adamant cap) |
| 7 | Attack | Waterfall + accurate melee | ~4,900 | 2 | as Defence |
| 8 | Strength | Waterfall + aggressive melee | ~5,300 | 2 | as Defence |
| 9 | Crafting | hard leather bodies | ~420 | 2 (twin) | ~1,130 hard leather beyond the attempts |
| 10 | Magic | rings, Mage Arena, Charge | ~1,300-1,700 | 2-3 | a ring ladder without diamonds and dragonstones (none exists today) |
| 11 | Herblore | Druidic Ritual + mixing | ~800-1,100 | 3-4 | 245 herbs and secondaries beyond attempts 2-3 |
| 12 | Cooking | wine fermentation | ~85 | 4 | 450 unfermented wines |
| 13 | Prayer | babydragon or big bones | ~2,800-5,500 | 6 | bones beyond attempts 2-3 |
| 14 | Runecraft (solo) | the air loop, if it does not run today (rs/461), on a new name | ~30,100 | 6 | essence only |
| 15 | Fletching (logs) | normal-log shafts and feathers to 80, magic logs to 99 | ~2,050 | 9 | ~475 normal logs, ~7,100 feathers, 325 magic logs |

**Passes today: only the solo Runecraft row (rs/461).** Every other board fails on supplies (all
but Cooking and Magic), and Cooking and Magic fail tenet 18 as well.

## Findings

- **The hiscore scraper no longer reads the boards.** Between 19:33 and 19:36 UTC the demo's time
  cell changed from `title="N ticks"` to `title="S seconds of game time"` (S = 0.3 N). `parseBoard`
  throws (`board columns disagree: 21/21/21/0`) and `ticksIn`, behind `parsePlayer`, returns null.
  rehearse.ts's post-logout hiscore read and the CLAIMS-style name checks go through it. The fix
  is cairn://p/rs/460, under main; this page's read parsed both forms inline.
- **Fleet helpers already sit on three of these boards** under `cairn_` names: `cairn_h41`,
  `cairn_h51`, `cairn_h45` and `cairn_h52` on Defence (ranks 16-21) and Hitpoints (14-19), and
  `cairn_h56` and `cairn_h55` on Magic (13, 14) (m). Whether a helper's row counts as "a cairn on
  the board" is the operator's call; rs/147 is putting it to them.
- **The parked names are worth more than their 6-9 ticks.** A name races once. Runecraft's parked
  `cairn_binds` belongs to the post-run rank-1 row, so the solo row should run on a fresh name.
  For Fletching, a fresh name is ~6 ticks faster than `cairn_carves` and that is the difference
  between rank 2 and a tie for 3.
