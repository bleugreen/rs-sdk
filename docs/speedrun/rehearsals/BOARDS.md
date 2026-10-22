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
| **Runecraft** | solo air altar: Duke Horacio's talisman, Falador east bank to the air ruins and back, 27 essence a trip, 296 trips (this page; loop m in [altar-giver.md](../helpers/altar-giver.md)) | surplus: 8,000 rune essence of ~85,000 beyond three attempts' 16,260; the talisman is free / stock: none | one essence holder (h30 or h31, rs/41's fleet), one noted trade at Falador east bank, ~5 min; no staging child | none: plain play, ordinary dialogue | **~30,100** (27,700-32,700) | **6** (7 if trips average over ~108) | yes: no next-tick reaction; late reactions priced at +8 a trip | **YES**, on rs/41's count and a courier from h30/h31 (and a crafter loop to build) |
| **Fletching** | arrowheads on headless arrows ([fletching.md](../skills/fletching.md) §1-2; [ASSISTED.md](ASSISTED.md)) | surplus: ~15-27 mithril tips, nothing else / stock: the 1,500 mithril tips on mule1 are attempt 1's H14 load (1,485); attempts 2-3's are being rebought by h76 | none possible today | none (the packet cap is public, shown by #1 and #2) | ~66 (parked) or ~60 (new name), if supplied | 2-3 | yes (blind bursts), small spill risk | **NO**: no surplus tips |
| Attack, Defence, Strength, Hitpoints, Ranged, Prayer, Magic, Cooking, Crafting, Smithing, Herblore | pricing in progress | | | | | | | |

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
staging.

## Post-run queue (by expected rank)

In progress; the two priced rows so far:

| Order | Board | Row | Expected rank |
|---|---|---|---|
| - | Fletching | rune arrows on leftover tips, new name | 2 |
| - | Runecraft | solo air (if not run today) | 6 |

## Findings

- **The hiscore scraper no longer reads the boards.** Between 19:33 and 19:36 UTC the demo's time
  cell changed from `title="N ticks"` to `title="S seconds of game time"` (S = 0.3 N). `parseBoard`
  throws (`board columns disagree: 21/21/21/0`) and `ticksIn`, behind `parsePlayer`, returns null.
  rehearse.ts's post-logout hiscore read and the CLAIMS-style name checks go through it.
- **Fleet helpers already sit on three of these boards** under `cairn_` names: `cairn_h41`,
  `cairn_h51`, `cairn_h45` and `cairn_h52` on Defence (ranks 16-21) and Hitpoints (14-19), and
  `cairn_h56` and `cairn_h55` on Magic (13, 14) (m). Whether a helper's row counts as "a cairn on
  the board" is the operator's call.
