# Hand-off staging for the scored attempts

Every hand-off row of SCORED's inventory ledger, with the giver account that holds its package,
where the stock is now, whether it is staged, and, if not, the gap, how it closes and who owns
it. A per-attempt section follows, because several items leave the fleet with SCORED on every
attempt and must be staged fresh for the next one. Issue: cairn://p/rs/331 (under rs/41).

**Authority.** The rows and counts are STEP-MANIFEST.md's **Inventory ledger** (rs/158's slot
ledger, on rs/158's branch at 4ebdcdf5, fold-in 16). SUPPLIES.md's hand-off table follows it
(fold-in 18, rs/318). This page applies the changes from rs/158 (00:35) and main (01:3x) on
2026-10-22 ahead of fold-in 18, plus rs/158's bone rule relayed by rs/41 at 01:5x. If a fold-in
moves a count, the ledger wins, and the row here is re-staged to match. **SCORED** is the scored
account; its name and credentials appear nowhere here.

**How stock was read (2026-10-22, 08:30-09:30 UTC).** Fleet accounts come from
`~/rs-fleet/stockpile.json`. Accounts outside the fleet (dev copies, the kit giver, the
quest-item and gear helpers) come from the latest `"bank":[...]` line in their own logs under
`~/rs-dev`, read with a one-off scan over `speedrun/helpers/bbs.sh`. Two limits apply. Only
**banks** are read, so what a helper carries in its inventory is missing, which matters for the
noted wine on cairn_h40. And accounts that have never logged a bank line (cairn_h93, h95, h97,
b01-b04, h70-h75) show nothing. Every move below was confirmed on both sides: the donor's
`handover` outcome `delivered` and the receiving mule's `received` line.

## Givers

| Giver | Account | Host on run day | Rows |
|---|---|---|---|
| Trade giver 1 (`mule` role, packages served in order) | **cairn_mule1** (fleet, Varrock west bank; `serve` set on run day) | Ashburn run machine; credentials go there only through host, on run day | H1, H3, H4, H4k, H4p, H6-H10, H12-H16, H18-H20, H21d, H21e, H22, H23's potions and sharks |
| Trade giver 2 | **cairn_mule2** (outside fleet.json, credentials in `~/rs-fleet/bots`; the rehearsal-kit giver until the run; named by rs/41, 01:36) | Ashburn, as above | **H21c, the wine giver** (below), and any hand-off trade giver 1 cannot reach in time (rs/117 splits them); holds attempt 2's axe and pickaxe |
| Cannon helper | cairn_h92 (`cannon.ts` serve mode, dev copy `~/rs-dev/cannon`) | bbs | H11, H11r, H23's cannon, balls and shortbow; H11r's Monkey Madness shortbow and rune arrows |
| Bone givers | cairn_b01-b04 (`bone-giver.ts`) | Ashburn | H4.1-H4.n; the last load also gives T07-08's Camelot runes |
| Air-altar givers (S06) | 7 givers: h70, h71, h72 staged by rs/196's morning sequence, 4 not yet named | Ashburn | H5 |
| Body-altar givers (S21) | cairn_t01-t22, spares t23-t27 (`roster.ts`) | Ashburn | H17 |
| S18 stun-pack courier | the trade-giver pool, on a side tile of SCORED (never a corner, rs/279) | Ashburn | H14 (load 0) and H14.x (the top-ups) |
| Quest-item spares | cairn_h95 (far set: 2 spades banked 16:45 UTC, then stranded at Brimhaven with 8 coins and logged out; questitems' fare bug is rs/430) and cairn_h97 (carp set: garlic; the carp is untradeable and unused), both outside fleet.json, credentials in `~/rs-fleet/bots` | bbs | H16's spade and garlic for attempts 2-3 |
| Anvil giver | **cairn_a01** (rs/41, 02:38 PDT; `anvil.ts`, rs/188). Credentials created 09:39 UTC in `~/rs-fleet/bots/cairn_a01` (700/600), outside fleet.json; the demo account was created by its first login at 09:41 | Ashburn, credentials via host on run day | H21a |
| Firemaking droppers | the six droppers (rs/269's demo used two per host) | Ashburn (`start: 'cue'`) or bbs (`'sighted'`) | H2 |

## Trade giver 1's bank (cairn_mule1, 17:35 UTC)

mule1's bank holds, beyond its starter kit: staff of water 3, staff of fire 3, rune axe 1, rune
pickaxe 3, knife 5; cosmic 190, air 5,378, fire 285, earth 171, water 95, law 145, death 700,
chaos 120, blood 640; rings 12 / 27 / 16 / 5; ball of wool 3, gold bar 1, banana 6, monkey bones
2, spade 2, garlic 1, plank 4, nails 12; magic shortbow 2 (attempt 3's two for h92); headless
arrow 4,410; arrowtips bronze 60, iron 90, steel 135, mithril 1,500, adamant 2,075, rune 570;
shark 174; prayer potion(4) 4, antipoison(4) 1, antipoison(3) 1, superantipoison(4) 2, super
attack(3) 1, super strength(3) 1; unfinished potions 330 / 198 / 128 / 82 / 60 / 50, eye of newt
453, snape grass 206; hard leather 1,169, uncut sapphire 28, emerald 2, ruby 1; coins 126,059.

**Air total:** 5,378 against ~1,740 per attempt across mule1's rows (H13's 550 and H14's 500 the
largest), so 5,220 for three attempts and 158 spare (h68's 500 from the GE at 22 gp, 17:09 UTC).

## Hand-off rows (attempt 1)

"In" is what SCORED receives, and "back" is what SCORED gives the giver in the same trade
(`swap()`). **Staged** means the whole package sits in the named giver's bank (or, for the wine,
inventory), ready to withdraw. **Partly** means the giver holds everything except the items
named in the gap column.

| Row | Giver | In / back | Where the stock is | Staged | Gap, how it closes (owner) |
|---|---|---|---|---|---|
| H1 | mule1 | in: staff of water 1, cosmic 60, air 81, fire 80, earth 50, law 1 | mule1 | **yes** | - |
| H2 | droppers | 157 logs on the ground: logs 2, oak 4, willow 7, maple 13, yew 24, magic 107 | woodcutters h10-h13 (magic 5,258, yew 67, maple 53, willow 32, oak 19) | no (dropped at run time) | Loaded onto the droppers before the run by the fm-row restock (rs/41) |
| H3 | mule1 | in: sapphire ring 12 + emerald 8; emerald 19 + ruby 1; ruby 15 + diamond 5 | mule1 (exactly 12 / 27 / 16 / 5) | **yes** | - |
| H4 | mule1 | in: clay 6, copper ore 4, iron ore 2, air talisman 1, law 2, air 6; back: the 20 enchanted rings | mule1 (clay 7, copper 5, iron 3 from h94, rs/173 09:38 UTC) | **yes** | Package precondition: the giver's entire inventory (`mule.ts` `stagedExactly`, rs/267) |
| H5 | air-altar givers | in: rune essence 26 a load, 7 loads (182); each giver keeps its own air talisman | essence 101,782 (h30-h33) | h70-h72 by rs/196's sequence | Each S06 giver holds exactly 26 a load, and `altar-giver.ts` offers exactly `essence` by count (rs/329 item 2). Four givers to name (rs/41, rs/196) |
| H4k | mule1 | in: rune axe 1, knife 1, normal logs 1 | mule1 | **yes** | A separate trade at the Taverley trees (2912,3495), not b01's first bone load |
| H4.x | b01-b04 | in: bones 23 a load; **every dragon bone first, then babydragon, until S07's bury reaches 39,938 base Prayer xp (Prayer 99)**: since fold-in 23 S18 buries none (its courier carries Superheat ore), so the babydragon once set aside for S18 go to S07 (rs/158 via rs/41, 07:39 PDT); **the last load is 21 bones + law 1 + air 5**; SCORED gives nothing | dragon 172 (h56 91, h55 49, h61 32; h55/h56 still farming); babydragon ~1,515 fleet-wide (h51-h54); big 2,526 | no | **At staging:** every dragon bone held (172 x 72 = 12,384 base), then babydragon at 30 base to 39,938: on 172 dragon that is **919 babydragon, 1,091 bones, ~48 loads of 23** (rounded so every load before the last is a full 23; main #293 `boneLastLoad=21`, rs/329's `finalN`/`finalExtras`, the law and air from mule1's surplus). Load i goes to b0((i-1) mod 4 + 1), dragon bones in the earliest loads, ~12 loads per giver. Each extra dragon bone farmed replaces 2.4 babydragon, so re-run it at staging (rs/331, rs/330). Spare after attempt 1: ~600 babydragon and every big bone. The axe is not handed back |
| H6 | mule1 | in: dwellberries 1, bucket of water 4, spade 1, rope 1, chocolate dust 1, bucket of milk 1, snape grass 1, law 2, water 2 (Ardougne only; the Camelot runes ride H4.x's last load) | snape grass, buckets of water 5, milk 3 and runes on mule1; **dwellberries, spade, rope, chocolate dust: none held** | **yes** | rs/173's far set landed on mule1 at 11:52 UTC (`rs173-h95-mule1-20261022T1150Z`, deltas verified): dwellberries, spade, rope, chocolate dust x2 each (a spare of each) |
| H4p | mule1 | in: rune pickaxe 1, normal logs 2 | mule1 | **yes** | On the forecast stock H4m has no loads, so there is no trade at the zoo to merge into: H4p is its own trade at S09's arrival. If H4m fires (an overflow stock), H4p rides H4m.1 |
| H7 | mule1 | in: logs 6, staff of fire 1, amulet of magic 1, antipoison(4) 1, shark 2, death 110, chaos 40, air 550 | mule1, including antipoison(3) (rs/348, 11:55 UTC; the (3) per rs/158); **amulet of magic: not yet** | partly | Amulet of magic: rs/347 (h88 enchants h80's sapphire amulet) |
| H8 | mule1 | in: agility potion(4) 1, law 5, air 3, fire 1, water 4 | runes on mule1; **agility potion: none** (GE-only; h62's bid rests unfilled) | partly | rs/348: GE-only; the +37 i no-potion fallback is in force (rs/158) |
| H9 | mule1 | in: coins 5, law 2, water 2, shark 3 | mule1 | **yes** | - |
| H10 | mule1 | in: law 5, water 5, air 3, sharks up to 8 in all (8 staged; the giver tops up to 8 by what SCORED holds) | mule1 | **yes** | - |
| H11 | h92 | in (main, fold-in 23): cannon set 1, cannonballs 100, mithril scimitar 1, law 4, water 4, sharks to 9 counting held. **Fold-in 24 (rs/427; not on main at 827cc66a): the cannon set and 100 balls only, no sharks** | h92's bank (17:35 UTC): cannon sets 2, cannonballs 1,416, mithril scimitar 2, law 12, water 18, shark 7 (and H11r's and H23's bows and arrows) | partly | The run-day serve runs from the fleet's code with `serve.extras` (rs/344) for the scimitar and runes; h92's dev copy (`~/rs-dev/cannon`) predates it (rs/41). h92's `cannon` role keeps `food: 5` and can eat banked sharks (rs/41). The third scimitar is on h63, to h92 with the next consolidation (rs/331) |
| H11r | h92 | back: the cannon set's 4 parts, cannonball all; in: magic shortbow 1, rune arrow 200 (Monkey Madness's), one two-way `swap()` (main, fold-in 23; `serve.returnExtras`, deployed with fleet snapshot 6) | **h92: magic shortbow 4, rune arrow 200** (from mule1, rs331-mule1-h92-h11r-1, 17:35:55 UTC; bank lines on both sides: mule1 bow 3 to 2, arrows 200 to 0; h92 bow 3 to 4, arrows 0 to 200) | **yes** | h92 gives 2 bows per attempt (H11r, H23): its 4 cover attempts 1-2, mule1's 2 are attempt 3's. Rune arrows 200 per attempt: attempts 2-3's are cairn_h91's rebuy (`rune-arrows` target 200; 35 held, Dargaud's at ~930 against its 700 cap) |
| H12 | mule1 | in (main, fold-in 23): gold bar 1, ball of wool 1, monkey bones 1, prayer potion(4) 4, antipoison(4) 1 (the second), sharks to 15 counting held, law 6, air 6, fire 2, water 4; back: staff of fire, H7's antipoison(3), mithril scimitar, knife, coins all, death and chaos all. One trade; no bow or arrows (H11r's now), no bananas, H12m dropped | mule1 (17:35 UTC): gold bar 1, ball of wool 3, monkey bones 2, prayer potion(4) 4, antipoison(4) 1, shark 174, runes | **yes** (main's kit, pending rs/201's 3 clean chains) | The 4 prayer potions are all mule1 holds, so H13's 1 is short (below). Attempts 2-3's potions: rs/348 |
| H13 | mule1 | in (main, fold-in 23): blood 90, death 25 (the Fire Blast guard), air 550, magic potion(4) 1 (best effort), prayer potion(4) 1, law 4, water 4, staff of fire 1 and knife 1 (both back from H12); back: the magic shortbow, rune arrows all, amulet of magic, khazard helmet and armour, coins, diamonds, antipoison(*), fire runes | mule1 (17:35 UTC): blood 640, death 700, air 5,378, staff of fire 3, knife 5, runes; **prayer potion(4): 4 held, all H12's** | partly | **Attempt 1 is 1 prayer potion(4) short** (H12 4 + H13 1 = 5 against 4): pending rs/158 (one brew on h84 from attempts 2-3's ranarr; rs/41). Magic potion: GE bid on h62, best effort. Blood: 640 covers attempt 1's 590 (H13 90 + H14 500) with 50 spare; attempts 2-3's 1,180 are rs/347's |
| H14 | S18 courier (trade-giver pool) | **load 0** (main, fold-in 23): blood 500, air 500, headless arrow 4,560, arrowtips bronze 60, iron 90, steel 135, mithril 1,485, sharks to 2, **nature rune 180, copper ore 7, tin ore 7** (Superheat; no bones since fold-in 23); back: magic potion(*), knife, death runes all | mule1: blood (500 of 640), air, headless 4,410, tips bronze 60, iron 90, steel 135, mithril 1,500, sharks; mule2: the Superheat stock (row below) | partly | Headless: mule1 is 150 short of 4,560; cairn_h78 holds 9,270 more (attempts 2-3's 9,120 + those 150), moving to mule1 today (rs/331, rs/41's ETA ~12:30 PDT). The courier's run-day `carry` loads from mule1 and mule2 (rs/330's courier half) |
| H14 margin (fold-in 20) | S18 courier | the +150 headless (in H14's 4,560) and +150 adamant tips (in H14.x's 2,220) | headless: mule1 4,410, cairn_h78 9,270 (made 13:13-14:49 UTC from h02/h03's feathers); adamant: mule1 2,075, cairn_h76 1,195 (camping Hickton's, target 2,520) | partly | Three attempts: headless 13,680 needed, **13,680 held**. Adamant 6,660 needed, 3,270 held; h76's target 2,520 leaves attempt 3's ~2,000 unplanned (rs/41). Rune tips 570 per attempt: mule1 570; h76's line (570) buys attempt 2's, attempt 3's unplanned (rs/41) |
| H14.x | S18 courier | ~13 top-ups (main, fold-in 23): iron ore 8-15 a load (14 at most beside the nature stack), copper ore 5 + tin ore 5 on the first, sharks back to 2, and adamant tips 2,220 and rune tips 570 once each, on the top-up SCORED's ask names when it is down to one tier (run config `carry`, `bone-giver.ts` on-request mode; no bones) | adamant 2,075 and rune tips 570 on mule1; iron, copper, tin on mule2 | partly | Adamant: mule1 is 145 short of 2,220; h76's 1,195 cover it, moving to mule1 today (rs/331). Ore: the Superheat row |
| H15 | mule1 | in: swamp paste 1, unlit torch 1, law 2, water 2 | mule1: swamp paste 2, "Torch" 2 (rs/173, 11:52 UTC), runes | **yes** | The game names the unlit torch **"Torch"**; the ledger's `unlit torch` must read so for handoff.ts (sent to rs/158 with "Nails") |
| H16 | mule1 | in (main, fold-in 22): fishing rod 1, spade 1, garlic 1, coins 5, law 4, air 18, water 1, body talisman 1 (SCORED's own); no carp (untradeable), no bait (the worm is the bait) | mule1: spade 2, garlic 1, fishing rod, coins, runes, body talisman | **yes** | Attempts 2-3: mule1's second spade, plus h95's 2 (stranded on Karamja until h97 brings it coins, after rs/422's demo); garlic from h97's carp-set errand, 2 to mule1 and 1 to h55 for rs/396's demo (rs/331) |
| H17 | body-altar givers | in: essence 27 a delivery, 194 deliveries (5,238); **H17e, the hand-back (rs/383): cairn_t19** (roster slot 18, or the spare that replaces it) banks **216 essence (8 loads, not 243), 1 body talisman, law 1, air 3, earth 1**, unnoted at Edgeville; its launcher entry carries `"handBack": [{"item":"Law rune","n":1},{"item":"Air rune","n":3},{"item":"Earth rune","n":1}]` and every altar giver's options `"scope": {"step": "S21", "family": "altar"}` (both from `roster.ts config`); 21 x 243 + 216 = 5,319 staged | essence 101,782 (h30-h33); 22 body talismans of 57; t19's runes from mule1's surplus | no | Staged by `roster.ts plan` before the run (rs/383, rs/41); t19's runes moved from mule1 then (rs/331) |
| H18 | mule1 | in: fly fishing rod 1, feather 580, logs 10, law 1, air 3, earth 1, knife 1 (back from H16) | mule1 (logs 19) | **yes** | - |
| H19 | mule1 | in: egg 1, bucket of milk 1, pot of flour 1, law 1, air 3, water 1 | mule1 (from h94, rs/173) | **yes** | - |
| H20 | mule1 | in: goblin mail 3, orange dye 1, blue dye 1, raw rat meat 1, raw bear meat 1, raw beef 1, raw chicken 1, cadava berries 1, law 2, air 6, water 1, fire 1 | mule1 (from h94 and h96, rs/173 09:38-09:40 UTC) | **yes** | - |
| H21a | **cairn_a01** | in: hammer 1, then 31 loads of 24-25 bars (bronze 15, iron 39, steel 120, mithril 305, adamant 365), each taking 5 platebodies back; takes every dead item back | **a01 (11:01 UTC): adamantite 365, steel 120, mithril 305, iron 39, bronze 15, hammer 1** (from h20 09:44, h23 10:49 by rs/266's live test `rs266-live-1`, h21 11:00) | **yes** | The Dwarven Mine climb-out is rs/266's (db87995c, PR pending); h21 went through its checkout's launcher. a01 is logged out until run day |
| H21c | **mule2** (wine giver) | in: unfermented wine 520, noted, one slot | **h40's inventory** (520, never banked) at Varrock west | yes, on h40 | One inventory-to-inventory trade h40 → mule2 close to the run, with h40's own `wine` role (`giveWine`, `receiver: cairn_mule2`), never `handover`: handover deposits the donor's inventory first, which unnotes the wine and starts fermentation. mule2 must hold it in its inventory, never run a banking role while it does, and on run day gives it from tile (3184,3436) to SCORED at (3185,3436) with rs/339's `afterRelog`. Why mule2: mule1's `mule` role banks whatever a courier hands it. Owners rs/331 (plan), rs/41 (the trade, on the run eve), rs/339 and rs/158 told. **Attempts 2-3 (rs/41, 07:11 PDT):** after its run-eve trade h40 makes 1,040 more by the path it used for attempt 1 (make, deposit, re-withdraw as notes in one bank session), holds them noted in its inventory between attempts, never runs a banking role while it does, and hands 520 to the attempt's wine giver before each. Inputs (17:4x UTC): grapes 586 on cairn_h46 (`grapes {"source":"guild"}`; toll fix 1301ae02); jugs of water from cairn_h67 (`jugs` target 250, Varrock) and the dev-copy earners cairn_h42 (Falador, 51) and cairn_h01 (Lumbridge, 55), target 250 each (jugs store option d3c8fa13) |
| H21d | mule1 | in: chisel 1, uncut diamond 391 (noted) | chisel on mule1; **uncut diamonds: 2** (GE bid wall 6,000 for 9,787, no sellers) | partly | No buying (25,000 each; rs/41). rs/158's gem-table fallback (+88) is in force: the 108 mixed uncut gems are consolidated, noted, onto **mule1, the H21d giver** (2-4 stacks), and **the leather line is on mule1** (rs/350, 11:55 UTC: hard leather 1,169, thread 250, needle 2, against 1,142 / 230 / 1; four handovers `rs350-mule1-h51-1`, `-h41-1`, `-h45-1`, `-h51-2`). **On mule1 so far: sapphire 19, emerald 2** (from h20, 09:44 UTC); the rest follows the h21/h23 moves (sapphire 8; sapphire 11, emerald 2, ruby 3) and h22, h51-h54, h80. **Mixed uncut gems held (banks 08:15-08:32 UTC):** sapphire 63 (h20 19, h54 15, h23 11, h21 8, h53 8, h22 1, h80 1), emerald 23 (h53 6, h54 6, h51 3, h80 3, h20 2, h23 2, h22 1), ruby 20 (h54 5, h52 4, h80 4, h23 3, h53 3, h22 1), diamond 2 (h51, h52); none on mule1, no dragonstone, opal, jade or topaz. rs/158 sends the mix with fold-in 18 |
| H21e | mule1 | **attempt 1 only, untouchable** (rs/41, rs/158): rs/302's list reaches 99 with spare; every stack as notes, by item id (notes are id + 1): guam unf (91) 358, tarromin (95) 198, ranarr (99) 128, irit (101) 82, avantoe (103) 60, kwuarm (105) 50, eye of newt (221) 481, limpwurt (225) 247, snape grass (231) 206 | **mule1 (17:35 UTC): unfinished potions 330 / 198 / 128 / 82 / 60 / 50 (guam to kwuarm), eye of newt 453, snape grass 206**: by id from h84 (rs331-h84-h21e-1, 16:36:22 UTC: 91 x190, 95 x101, 99 x62, 101 x40, 103 x30, 105 x27, 221 x220, 231 x44) and h85 (rs331-h85-h21e-1, 17:10:33 UTC: 91 x140, 95 x97, 99 x66, 101 x42, 103 x30, 105 x23, 221 x183, 231 x60), with mule1's earlier eyes 50 and snape 102 | partly | Guam 330 and eyes 453 are 28 under the list: rs/302's attack-potion demo used 28 of each (rs/387); rs/302 confirms 99 still holds. **Limpwurt 247: none on mule1** (h51-h54 and h84's 2, rs/387's courier). Whatever h84/h85 hold above these counts is attempts 2-3's |
| H22 | mule1 | in: **coins topped up to 126,000** (fold-in 20: netted against what SCORED holds, e.g. Fight Arena's 1,000 taken back at H12),  wizard's mind bomb 1, silk 1, lobster pot 1, unfired bowl 1, plank 3, nails 12, adamant full helm 1, amulet of strength 1, shark 10, law 5, air 9, fire 1, earth 1, water 3, mithril scimitar 1 (back from H12) | coins, helm, sharks, runes, and wizard's mind bomb, silk, lobster pot, unfired bowl, nails 12 ("Nails", id 1539; from h94), plank 4 (rs/173, 11:52 UTC) on mule1; **amulet of strength: not yet** (rs/347 enchants h80's ruby amulet) | partly | Planks: rs/173's far-set lab picked up 4 at the Barbarian Outpost; fallback the Rimmington spawn. Amulet of strength: h80's ruby amulet enchanted (Enchant 3, Magic 49) by a helper (rs/41) |
| H23 | h92 + mule1 | in (main, fold-in 23): cannon set, cannonballs 1,200 and h92's own magic shortbow 1 in h92's cannon trade (`serve.extras`, rs/344); ranging potion(4) 3, superantipoison(4) 2, super attack(3) 1, super strength(3) 1, sharks to 12 (mule1). **Fold-in 24 (rs/427; not on main at 827cc66a): one trade from h92 with all of it and a fixed 2 sharks**; the potions move mule1 to h92 once it is on main (rs/41) | h92: cannon sets 2, cannonballs 1,416, magic shortbow 4, shark 7; mule1: superantipoison(4) 2, super attack(3) 1, super strength(3) 1, sharks; **ranging potion(4): none** (GE-only, resting on h63) | partly | Ranging: rs/348. Cannonballs: 1,416 cover attempt 1 only |
| Superheat (H14 load 0 and H14.x; fold-in 23, per attempt nature ~180, copper 12, tin 12, iron ~160) | mule2 | nature rune, copper, tin and iron ore, noted; kept apart from S21's givers and a01's S25a bars | **mule2 (13:02 UTC): nature 518, iron ore 454, copper ore 36, tin ore 36**. h68: nature 60, copper 6 (bought ~14:0x UTC, not yet moved). h66: iron ore 23, 29 resting at 115 (#20423) | partly | Three attempts: nature 540 (mule2 22 short; h68's 60 cover it), copper 36, tin 36, iron ~480 (held). h68's nature and copper to mule2 at mule2's next login (rs/331). Budget used: ~40,000 of 300,000 |
| DS re-supply (contingency, rs/258) | mule2 | mithril scimitar, hammer, 8 sharks; planks 3, nails 12 | on mule2: scimitar, hammer, sharks | partly | Planks and nails: GE bids rest on mule2 (#19502 at 450, #19505 at 200), neither ever traded; fallback nails smithed by a smelter (h20/h21 steel), planks from the Rimmington spawn. Re-run `kits/mule2-ds.json` to collect fills (rs/41, low priority) |

**Fully staged (17:45 UTC):** H1, H3, H4, H4k, H4p, H6, H9, H10, H11r, H12 (main's kit pending rs/201's chains), H15, H16, H18, H19, H20 and H21a. Partly: H7 and H22 (the amulets, rs/347), H8 (agility potion, GE-only), H11 and H23 (fold-in 24 pending; ranging potions), H13 (1 prayer potion), H14 and H14.x (150 headless, 145 adamant tips from h78 and h76, moving today), H21d (gem mix), H21e (limpwurt). Not yet: H4.x (b01-b04's banks at staging), H5 and H17 (the altar givers, `roster.ts`).

**The executed contract is main's ledger.** `speedrun/runner/handoff.ts` (rs/320, on main at
272f2ab6) builds each hand-off from the row's `in`, `out` and `equip` in STEP-MANIFEST.md's
ledger on main, which is still the pre-fold-in-18 version. It disagrees with this page (the
rulings this page follows) on H4k/H4p, H6, H10 (top-up), H12's out (knife, coins, dead items),
H13 (staff of fire and knife in, bow out), H16 (body talisman in, knife out), H17's last-giver
runes, H18 (knife), H21a (dead items back), H22 (scimitar; and `steel nails` should read
"Nails", the game's name for id 1539) and H23 (bow, now h92's). Sent to rs/158 (03:12 PDT) for
fold-in 18. mule1's stock covers both versions; the givers' package definitions follow whatever
the ledger on main says when the run starts. Leftover kits after an attempt go back with
`speedrun/tools/kit-return.ts` (on main), not ad-hoc trips. The cannon set
and balls (H11, H23) are on h92, and the wine (H21c) is on h40. Every other row is partly staged,
with the missing items named above.

**Two magic shortbows per attempt (rs/158's ruling, 02:4x PDT), both now h92's.** rs/158 has
since moved Monkey Madness's bow and its 200 rune arrows from H12 (mule1) to H11r: h92 gives
them in the take-back trade at the Ardougne landing after S14 (`serve.returnExtras`), and SCORED
wields them at once. h92's second bow goes in H23's cannon trade, with the set and balls
(`serve.extras`, rs/344). So h92 holds **2 magic shortbows and 200 rune arrows per attempt**,
carried from its bank. There is no mid-run bow transfer. rs/346 fletched them; mule1's bows and
rune arrows, no longer needed at H12, are the stock to move to h92. Fallback if they are late: a
willow shortbow from the Ranging Guild shop (stock 20), 2 per attempt bought by cairn_h91 when
rs/158 or rs/185 asks (rs/41).

## Per attempt

SCORED gives nothing back at the end of an attempt, scored or abandoned (main's ruling: no axe
hand-back). So everything handed over and not taken back is spent per attempt. Items that cycle
inside an attempt need only one copy: the knife (H4k, back at H12, H13, back at H16, H18), the
staff of fire (H7, back at H12, H13), the mithril scimitar (H11, back at H12, H22) and the cannon
set (H11, back at H11r, H23). Each still leaves with SCORED at the end, so one of each per
attempt. The magic shortbow is not one of them: two bows go out per attempt, both h92's (H11r
and H23, above).

### The rune axe and rune pickaxe pair, per attempt

| Attempt | Rune axe (H4k) | Rune pickaxe (H4p) | Status |
|---|---|---|---|
| 1 | mule1 (rs/124's GE axe, from h90) | mule1 (rs/124's, from h91) | **staged** |
| 2 | mule2 (the kit giver's GE-bought second axe) | mule2 (Nurmof) | held on trade giver 2; moved to whichever giver serves H4k/H4p before attempt 2 |
| 3 | h90's GE line, first fill | mule1 (Nurmof, 32,000, bought 09:02 UTC) | pickaxe staged; axe bidding (#19610 at 100,025, top of the book over a 100,000 wall for 42; max 150,000) |
| spare | h90's GE line, second fill | mule1 (Nurmof, 32,000) | as above |

An attempt that dies or is abandoned after H4k still spends its pair. The next attempt's pair is
moved to the giver that serves H4k and H4p before that attempt's run login.

### Run-day runes, banked on each giver (rs/158: never bought on the night)

Every rune a giver hands over is in that giver's bank before the run login. Need per attempt
against held at 09:57 UTC:

| Giver | Rows | Per attempt | Held now | Attempt 1 | Attempts 2-3 |
|---|---|---|---|---|---|
| cairn_mule1 | H1, H4, H6-H10, H12, H13, H14, H15, H16, H18-H20, H22 | air 1,591; law 43; water 29; fire 85; earth 53; cosmic 60; death 110; chaos 40; blood 570 | **10:18 UTC:** air 4,878; law 157; water 107; fire 285; earth 171; cosmic 190; chaos 120; death 700 (330 for three attempts, the 300 Fire Blast hedge from h67, 70 spare); blood 456 (rs/347, 11:51 UTC) | held except blood: H13's 70 held, S18's 500 has 386 (rs/347 delivering) | 3 attempts (plus the small sets below) need air ~4,800, law ~147, cosmic 180, chaos 120, fire 255, water 99, earth 162, death 330: **held** except death, 30 short; h65's resting GE offer #19933 (41 at 400) covers it once it fills and moves to mule1 (rs/331) |
| cairn_h92 | H11 | law 4, water 4 | 0 | from mule1's surplus with the H11 extras (rs/344) | as attempt 1 |
| b01-b04 (the last bone load) | H4.x | law 1, air 5 | 0 | from mule1's surplus once the b-accounts are stocked | as attempt 1 |
| last body-altar giver | H17 | law 1, air 3, earth 1 | 0 | from mule1's surplus once rs/330's option lands | as attempt 1 |

mule1's surplus after attempt 1's own needs: law 14, air 87, water 38, earth 78, fire 200, which
covers the three small sets above (law 6, air 8, water 4, earth 1).

### Spent per attempt, against stock today (3 attempts planned)

| Item | Per attempt | Held now | Attempts covered | Next ones from |
|---|---|---|---|---|
| Rune axe | 1 | mule1 1, mule2 1 | 2 | h90's GE line, 2 more (approved to 300,000) |
| Rune pickaxe | 1 | mule1 3, mule2 1 | 4 | - |
| Mithril scimitar | 1 | mule1 2, h63 1 (bought 09:35; mule2's 1 is the contingency's) | 3 | Zeke (Al Kharid, ~1,050) |
| Magic shortbow | **2** (both h92's: H11r and H23) | mule1 3, h92 3 | 3 once mule1's move to h92 (h92 alone: 1) | rs/346 fletched them; hedge: yew shortbow 2 on mule2, willow shortbows at the Ranging Guild via h91 |
| Staff of water | 1 | mule1 3 | 3 | Zaff (Varrock, 1,500, stock 2) |
| Staff of fire | 1 | mule1 3 (+ h55, h56 casting) | 3 | Zaff |
| Knife | 1 | mule1 3, h94 2 | 5 | Shantay, 6 gp |
| Rings (sapphire 12, emerald 27, ruby 16, diamond 5) | 60 | exactly 60 on mule1 | 1 | the jeweller from uncut gems and gold bars; the 5 diamond rings have no stock (2 uncut diamonds held) |
| Clay 6, copper 4, iron 2 | 12 | clay 7 (h94) | 1 | rs/173's southwest set re-run |
| Unfermented wine | 520 | 520 (h40) | 1 | 883 grapes and 501 jugs of water held: ~880 more from h40's `wine` role |
| Cannon set | 1 | 2 (h92) | 2 | Nulodion, the cannon helper only (rs/41) |
| Cannonballs | ~1,270 (1,300 out, ~30 back at H11r) | 1,416 | 1 | h92 makes them from steel bars (352 held, 4 a bar) |
| Uncut diamond | 391 | 2 | 0 | the gem-table fallback, every attempt |
| Adamantite bars | 365 | 354 | 0.97 | smelting; the mithril-platebody fallback (+425 mithril bars) for later attempts |
| Blood runes | 570 | 0 | 0 | rs/347: GE (h90's #19732 at 725 for 200 rests) and the Magic Guild via h88 |
| Bones (Prayer) | the S07/S09/S18 mix, ~1,645 bones on the forecast | dragon 172, babydragon 1,533, big 2,526 | 1 on the fast mix; later attempts fall back to big bones (rs/158 prices the ticks) |
| Rune arrows | 200 | mule1 200 | 1 | h91's `rune-arrows` loop (target 200) is rebuying (attempt 2's) |
| Arrowtips, headless arrows | rune 570, adamant 2,070, mithril 1,485, headless 4,410, the rest small | exactly one attempt's (mule1) | 1 | h76 is back camping Hickton's toward its targets (attempt 2's) |
| Potions (prayer 4, antipoison 2, agility 1, ranging 3, supers 4; magic 1 as insurance) | 14 (+1) | 0 | 0 | rs/348; resting GE bids from rs/331 (below) |
| Sharks | ~52 | mule1 60; ~148 elsewhere outside mule2 | 3+ | GE ask ~557 |
| Law runes | ~49 | mule1 57; ~600 in the fleet | 13 | - |
| Air / fire / earth / water runes | ~1,600 / 85 / 54 / 33 | mule1 1,678 / 285 / 131 / 67 | 1 / 3 / 2 / 2 | GE air at 21-22; Aubury (fire, earth; water ran out at 31) |
| Rune essence | 5,420 | 101,782 | 18 | - |
| Feathers | 580 | mule1 580; 18,287 elsewhere | 32 | - |

## Operations log

Every move: the account, what changed, and how it was restored. Times are UTC, 2026-10-22.
Borrowed fleet accounts went through `fleetctl assign ... --return` and `reload`, and each log
was checked within a minute of its return. Non-fleet accounts were stopped by their own stop
flag, or by SIGINT to the single recorded PID, never by pattern. One-shot handovers kept their
state in `~/rs-dev/staging-331/role-state` (non-fleet) or the fleet's role state, each with a
fresh id `rs331-<donor>-mule1-1`. fleet.json backups are in `~/rs-dev/staging-331/`.

| Time | Account | Action | Restored to |
|---|---|---|---|
| 08:38 | cairn_h90 (gear dev copy, `tmux -L rs41-gear`) | bidder options: rune axe target 1 → 0; magic shortbow (861) target 1 → 3, max 12,000 → 20,000; mithril scimitar target 1 → 0 (cancelled #17091). Backup `run/opts/bidder-h90.json.bak-20261022T083801Z`; SIGINT to bidder PID 2171412, the loop restarted it | same loop, new options; shortbow offer #19530 at 13,025 |
| 08:41-08:45 | cairn_h91 (gear) | stop flag; the `rune-arrows` loop exited at its natural end | - |
| 08:55-09:17 | cairn_h64 (fleet) | `buyer`: staff of water 2 and staff of fire 2 (Zaff, 1,515 each), fire rune 200, earth 120, water 31 (Aubury timed out), rune pickaxe 2 (Nurmof, 32,000 each), mithril scimitar 2 (Zeke out of stock for the third), knife 2 (Shantay). Spent 74,481 | `coins` {} |
| 08:57 | cairn_h90 | stop flag + SIGINT; handover rs331-h90-mule1-1: rune axe 1 → mule1 | bidder loop restarted in window `bid-h90` with its original command; rune axe line target 2, min 100,025, max 150,000, step 10,000 after 30 idle minutes (backup `...bak-20261022T085915Z`); offer #19610 at 100,025 |
| 09:05 | cairn_h91 | handover rs331-h91-mule1-1 (crossed from Seers', 30 → 15 HP): rune pickaxe 1, knife 1, rune arrow 200, adamant full helm 1, fishing rod 1, fishing bait 5, fly fishing rod 1, chisel 1, shark 60, mithril arrowtips 750 → mule1 | `rune-arrows` loop restarted in window `rune-h91` with its original command; flag renamed `.used-*` |
| 09:08 | cairn_h80 (fleet, disabled) | handover rs331-h80-mule1-1 `--then idle`: sapphire ring 12, emerald 27, ruby 16, diamond 5, ball of wool 1 → mule1 | `jeweller` with its exact options, disabled; logged out 09:09 |
| 09:10 | cairn_h88 (runes dev copy, logged out) | standalone launcher on port 7781 (1 extra login), handover rs331-h88-mule1-1: staff of water 1, staff of fire 1, cosmic 62, fire 85, death 110, chaos 40, air talisman 3, air 253, water 30, earth 7, law 1 → mule1 | logged out (server LOGOUT) 09:11 |
| 09:13 | cairn_h01, cairn_h51 (fleet) | handovers: feather 580; law rune 56 and body talisman 1 → mule1 | `coins` {} |
| 09:15 | cairn_h76 (fleet) | handover rs331-h76-mule1-1 (from Catherby): arrowtips adamant 2,075, rune 570, mithril 750, bronze 60, iron 90, steel 135 → mule1 | `fletcher` camp at Hickton's, exact options (it now rebuys toward its targets) |
| 09:21 | cairn_h96 (questitems dev copy, logged out; freed by rs/332) | launcher on port 7782 (1 extra login), handover: snape grass 102 → mule1. Goblin mail and meats left for rs/173 | logged out 09:22 |
| 09:21 | cairn_h60 (fleet) | handover: eye of newt 50 → mule1 | `coins` {} |
| 09:23 | cairn_h64 | `buyer`: air rune 1,400 on the GE (29,400) | `coins` {} |
| 09:24 | cairn_h78 (fleet, disabled) | handover `--then idle`: headless arrow 4,410 → mule1 | `fletcher` headless, target 4,410, disabled; logged out 09:24 |
| 09:25 | cairn_h64 | handover rs331-h64-mule1-1: coins 126,010, air 1,400, earth 120, fire 200, water 31, staff of water 2, staff of fire 2, rune pickaxe 2, mithril scimitar 2, knife 2 → mule1 | `coins` {} |
| 09:26-09:29 | cairn_h13 (fleet) | handover rs331-h13-mule1-1: normal logs 3 → mule1 (crossed from Seers') | `woodcutter` {} |

| 09:32 | cairn_h90 | bidder line added: blood rune target 570, tranche 200, min 725, max 1,000, +25 after 30 idle minutes (backup `...bak-20261022T093141Z`); SIGINT to the bidder child, the loop restarted it | offer #19732 at 725 for 200 |
| 09:33-09:36 | cairn_h63 (fleet) | `buyer` by item id: prayer(4) #19735 at 9,000 for 4, ranging(4) #19737 at 6,000 for 3, super attack(4) #19740 at 3,500, super strength(4) #19741 at 4,000 (all resting, no sellers); mithril scimitar 1 at Zeke (1,050), banked on h63 | `coins` {} |
| 09:33-09:35 | cairn_h62 (fleet) | `buyer` by item id: superantipoison(4) #19742 for 2, antipoison(4) #19743 for 2, agility(4) #19744, magic(4) #19746, each at 2,000 (resting) | `coins` {} |

| 09:38-09:40 | cairn_h94, cairn_h96 (rs/173's own run, ids rs173-h94-mule1-20261022T0938Z and rs173-h96-mule1-20261022T0940Z) | h94's southwest quest stock (24 lines, incl. clay 7, gold bar 1, nails 12) and h96's goblin mail 4, rat 2, bear 2 → mule1, verified by rs/173 | logged out |
| 09:39-09:41 | cairn_a01 (new) | `bot.env` created with `accounts.ts` `createAccountEnv` (not forbidden; no prior env on bbs; the demo hiscores answered 404 for it); first login through a launcher on port 7783 as a `mule` receiver at Varrock west (`couriers: ^cairn_h2[0-3]$`) | logged out 09:48 (launcher stop, `logout: out`) |
| 09:43-09:44 | cairn_h20 (bars dev copy, `tmux -L rs41-bars`) | `stop-cairn_h20` + SIGINT to smelter PID 3354088; handover rs331-h20-a01-1 through gateway 7766: adamantite 144, steel 120, mithril 305, iron 17, hammer 1 → a01; uncut sapphire 19, emerald 2 → mule1 | flag removed, `role-h20` window restarted with `role-loop.sh cairn_h20 '{"mode":"full","addy":"alkharid","iron":17}'` |
| 09:43, 09:45 | cairn_h21 (bars dev copy), cairn_h23 (fleet) | handovers rs331-h21-a01-1, -2 and rs331-h23-a01-1 failed before withdrawing: no path out of the Dwarven Mine | h21: `role-h21` restarted with `'{"mode":"full","steel":151,"iron":9}'`; h23: `smelter` {"mode":"full"} by `--return` |
| 09:53-09:56 | cairn_h90 | magic shortbow line target 3 → 0 (backup `...bak-20261022T095343Z`; rs/347's blood-rune edit kept as found); SIGINT to the bidder child, the loop restarted it | #19530 cancelled |
| 09:55-09:58 | cairn_mule2 (outside the fleet) | launcher on port 7784 (1 extra login) as a `mule` receiver at Varrock west, `couriers: ^cairn_h78$` | logged out 09:58 (`logout: out`) |
| 09:56 | cairn_h78 (fleet, disabled) | handover rs331-h78-bows-1 `--then idle`: magic shortbow 5 → mule1; yew shortbow 2 → mule2 | `fletcher` headless, target 4,410, disabled; logged out 09:58 |
| 09:59-10:02 | cairn_h65 (fleet) | `buyer`: air rune 3,200 at 21 (67,200), death rune 131 (45,719), 59 more resting at 349 (#19864); then handover rs331-h65-mule1-1: death 131, air 3,200 → mule1 | `coins` {} |
| 10:02-10:03 | cairn_h52, cairn_h51 (fleet) | handovers rs331-h52-mule1-1 (cosmic 20), rs331-h51-mule1-2 (cosmic 16) → mule1 | `coins` {} |
| 10:04-10:09 | cairn_h53, cairn_h54 (rs/41's transient unit `rs194-talisman`) | unit saved (`~/rs-dev/staging-331/rs194-talisman.unit.saved`, `.show.saved`); SIGINT to its MainPID 3647196; both confirmed out of the world; launcher on port 7785: rs331-h54-mule1-1 (cosmic 54), rs331-h53-mule1-1 (cosmic 38, chaos 80, law 100) → mule1; nature talismans left in place | unit recreated with `systemd-run`, identical properties (diff empty); both on `bones` at `nature_hobgoblins` by 10:09:31 |
| 10:11-10:18 | cairn_h65 (fleet) | `buyer` at Betty's (Port Sarim): water 40, earth 40 (350 gp); death out of stock there. `buyer` on the GE: the earlier #19864 had filled (59 held), 41 more resting at 400 (#19933). Handover rs331-h65-mule1-2: death 59, water 40, earth 40 → mule1 | `coins` {} |
| 10:35-10:36 | cairn_h66 (fleet) | `buyer`: iron ore 506 at max 125: 18 bought at 110 (1,980), 488 resting at 110 (#20026) | `coins` {} |
| 10:36-10:42 | cairn_mule2 | launcher on port 7784 as a `mule` receiver, `couriers: ^cairn_h5[1-4]$` | logged out 10:42 |
| 10:37-10:38 | cairn_h51, cairn_h52 (fleet) | handovers rs331-h51-mule2-1 (nature 84), rs331-h52-mule2-1 (nature 78) → mule2 | `coins` {} |
| 10:39-10:41 | cairn_h53, cairn_h54 (`rs194-talisman`) | unit re-saved (identical to the first save), SIGINT to MainPID 4173854, both out of the world; launcher on port 7785: rs331-h53-mule2-1 (nature 268), rs331-h54-mule2-1 (nature 88) → mule2 | unit recreated with `systemd-run`, identical (diff empty); both on `bones` at `nature_hobgoblins` by 10:41:36 |
| 10:43 | cairn_h20 (bars dev copy) | options backed up (`opts-cairn_h20.json.bak-20261022T104333Z`; the file itself unchanged); stop flag + SIGINT to smelter PID 4119939; `role-h20` restarted with `{"mode":"mine","addy":"alkharid","iron":245}` (mine iron to ~490 ore, never smelt) | mining; restore pending |
| 10:53-10:54 | cairn_h67 (fleet) | `buyer`: death rune 300 at max 500 (rs/185's possible Fire Blast): 125 bought at 399 (49,875), 175 resting at 399 (#20121) | `coins` {} |
| 10:54-11:02 | cairn_a01 | launcher (port 7783) as the receiver | logged out 11:02 |
| 10:56-11:01 | cairn_h21 (bars dev copy) | rs331-h21-a01-3 failed before connecting (rs/266's checkout has no `bots/`; nothing traded, no state written); then stop flag, SIGINT to the smelter (77060) and the lite runner (3496843), both loops exited, out of the world by 10:59:29; rs/266's launcher (`~/rs-dev/handover-266`, db87995c, port 7786, `final`) ran rs331-h21-a01-4: adamantite 162, bronze 2, iron 9 → a01; uncut sapphire 9, ruby 1 → mule1; climbed out of the mine; logout out 11:00:59 | `up.sh cairn_h21 '{"mode":"full","steel":151,"iron":9}'` (both windows, as rs/119 started them); smelting by 11:01:49 |
| 11:48-11:51 | cairn_h20 (bars dev copy) | stop flag + SIGINT to the mining smelter (51562); mule2 up as a receiver (port 7784, `couriers: ^cairn_h20$`); handover rs331-h20-mule2-iron-1 through gateway 7766: iron ore 454 → mule2 | `role-h20` restarted with the original `{"mode":"full","addy":"alkharid","iron":17}` (matches `opts-cairn_h20.json`); mule2 logged out 11:51 |
| 12:12-12:16 | cairn_h66 (fleet) | `bidder` line Iron ore target 18 (= held): cancelled #20026 (488 at 110, unfilled), collected 53,680; then `buyer` Iron ore to 52 at max 125: 5 at 115 (575), 29 resting at 115 (#20423) | `coins` {} (by hand after the parked bidder, then `--then coins`) |
| 12:12 | cairn_h78 (fleet, disabled) | enabled on `fletcher {"mode":"headless","target":9270}` (rs/41 execution 2) | running; restore to its disabled `{"mode":"headless","target":4410}` when done |
| 12:17-12:21 | cairn_h92 (cannon dev copy, `tmux -L rs41-cannon`) | role options saved (`~/rs-dev/staging-331/h92-role-options.saved`); SIGINT to the cannon role (3057404); a `mule` receiver from the fleet's code through h92's gateway (7760), couriers `^cairn_mule1$`; mule1 (fleet, `--return`) handover rs331-mule1-h92-extras-1: mithril scimitar 2, law 12, water 12, shark 6, magic shortbow 3 → h92; receiver stopped | `role.sh cairn_h92` in window `role-1400` with identical options (diffed); mule1 back on `mule {"serve":"www_cairn_md","packages":[]}` |
| 12:24-12:27 | cairn_h67, cairn_h65 (fleet) | `buyer` re-runs collected h67's last 175 death runes (300 held) and h65's 41; h65's list still read 100, so it bought **59 more at ~394 (23,246) unasked** (kept as margin, rs/41); handovers rs331-h67-mule1-death-1 (300), rs331-h65-mule1-death-3 (100) → mule1 | `coins` {} |
| 12:53-12:56 | cairn_h78, cairn_h30 (fleet) | h78 had died and lost its axe (fletcher looped on "no axe"); h78 briefly a `mule` receiver for h30; handover rs331-h30-h78-axe-1: bronze axe → h78 | h30 `essence` by `--return`; h78 parked on its disabled entry 13:01 |
| 12:56-13:03 | cairn_mule2 | launcher on port 7784 as a receiver for `^cairn_h94$` (rs/173's ore) | logged out 13:03 |
| 13:04-13:07 | cairn_h85 (herbs dev copy) | stopped its role loop by PID (1894449, 1894451) before rs/41's note that h84/h85 are rs/387's arrived; H21e handover by id failed cleanly (Taverley Dungeon, no way up) | relaunched; then moved into tmux session `h85role` (`run/acct.sh cairn_h85 role`, same tmux server as before); hunting again 13:07:28 |
| 13:09-13:13 | cairn_h78 (outside the fleet) | launcher (port 7788) as a receiver for h02/h03; handovers rs331-h02-h78-feathers-1 (7,630), rs331-h03-h78-feathers-1 (1,640); then the headless launcher | h02, h03 `coins` by `--return`; h78 fletching |
| ~14:07 | cairn_h68 (fleet) | `buyer`: sharks 120 at 545 (65,400), nature rune 60 (37,320), copper ore 6; handover rs331-h68-mule1-sharks-1: shark 120 to mule1 (174 after) | `coins` {} by `--return` |
| 13:13-14:49 | cairn_h78 (outside the fleet, dev copy `~/rs-dev/headless-331`, launcher port 7788) | `fletcher` headless 9,270 (rs/331's axe fix), feathers from h02/h03; died twice in the Lumbridge woods (13:38, 16:44), lost nothing banked | 9,270 headless banked; then 1,650 more for rs/422's demo (h03's 1,650 feathers, 16:27) |
| 16:52-16:58 | cairn_h78, cairn_h97 | handover rs331-h78-h97-headless-1: headless 1,650 to h97 (receiver launcher, port 7771); h78 logged out 16:53:05 (fleet entry back to rs/41: `coins` {}); h97 withdrew them to its inventory (one-off role) and logged out 16:58:38 for rs/422 | both out of the world, confirmed on /playerpositions |
| 16:36, 17:10 | cairn_h84, cairn_h85 (fleet) | H21e handovers by item id to mule1 (above), h85's started right after a `[herbs] banked` at Edgeville (rs/387's window) | `brew` and `herbs` entries by `--return` |
| 16:2x | cairn_h46, cairn_h67 (fleet) | from `coins` to `grapes {"source":"guild"}` and `jugs {"target":250}`, each through a one-jug `buyer` run chained with `--then`, which pays the Al Kharid toll | running; restore to `coins` {} when done |
| 16:38-16:48 | cairn_h95 (outside the fleet) | questitems far set (spade) then carp set (garlic): 2 spades banked at 16:45; the carp route then sailed it to Brimhaven short of the 30-coin fare (rs/430) | logged out at Brimhaven, 8 coins |
| 17:04-17:10 | cairn_h68 (fleet) | `buyer`: air rune 500 at 22; handover to mule1 at 17:09:49 | `coins` {} |
| 17:12 | cairn_h42, cairn_h01 (fleet) | set disabled (`coins` {}), then `jugs` from the dev copy at d3c8fa13: h42 `store: falador`, h01 `store: lumbridge`, target 250 each; both paid the toll out of Al Kharid | restore to `coins` {} enabled at 250 (told rs/41) |
| 17:15-17:36 | cairn_h91 (gear dev copy) | stop flag; its loop exited "out of coins"; crossed east (dev copy `crossFromKandarin`), received 60,000 from cairn_h68 (rs331-h68-h91-coins-1, 17:31:22; h68 back on `coins` {}); crossed west (`crossToKandarin`, rested to 30 HP), 17:32-17:35 | exact loop restored in `tmux -L rs41-gear` window `rune-h91`, buying 500 bronze arrowtips (rs/422) besides its targets |
| 17:35:55 | cairn_mule1 (fleet), cairn_h92 | H11r: handover rs331-mule1-h92-h11r-1, magic shortbow 1 and rune arrow 200 to h92 (receiver from the fleet's code on h92's gateway 7760) | mule1 back on `mule {"serve":"www_cairn_md","packages":[]}` by `--return` |
| 17:36 | cairn_h92 (cannon dev copy) | its `cannon` role had died at 16:42:29 (`waitForTicks` timeout in the server stall), the lite runner keeping it in the world | `role.sh cairn_h92` in window `role-1400`, options identical to the saved copy (diffed) |

Re-running the same buyer list on h62 or h63 collects any fills and buys only the shortfall.
Those offers, and h90's blood-rune line, are handed to rs/347 and rs/348, which own blood runes
and potions from 02:40 PDT.

Funding used: 74,481 + 29,400 on h64 and 1,050 on h63. GE escrow: h90's axe 100,025, shortbow
13,025 and blood runes up to 200,000 from its own coins; h62/h63's potions ~73,500. All within
rs/41's approvals (axe 300,000, pickaxes and scimitars 80,000, the buyer extras ~100,000, blood
runes ~570,000, potions 250,000).
