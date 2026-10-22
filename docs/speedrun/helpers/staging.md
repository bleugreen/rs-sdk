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
| Cannon helper | cairn_h92 (`cannon.ts` serve mode, dev copy `~/rs-dev/cannon`) | bbs | H11, H11r, H23's cannon, balls and shortbow |
| Bone givers | cairn_b01-b04 (`bone-giver.ts`) | Ashburn | H4.1-H4.n; the last load also gives T07-08's Camelot runes |
| Air-altar givers (S06) | 7 givers: h70, h71, h72 staged by rs/196's morning sequence, 4 not yet named | Ashburn | H5 |
| Body-altar givers (S21) | cairn_t01-t22, spares t23-t27 (`roster.ts`) | Ashburn | H17 |
| S18 stun-pack courier | the trade-giver pool, on a side tile of SCORED (never a corner, rs/279) | Ashburn | H14 (load 0) and H14.x (the top-ups) |
| Carp helper | cairn_h97 (rs/173; **not created yet**) | bbs, hands the carp to mule1 | H16's carp |
| Anvil giver | **cairn_a01** (rs/41, 02:38 PDT; `anvil.ts`, rs/188). Credentials created 09:39 UTC in `~/rs-fleet/bots/cairn_a01` (700/600), outside fleet.json; the demo account was created by its first login at 09:41 | Ashburn, credentials via host on run day | H21a |
| Firemaking droppers | the six droppers (rs/269's demo used two per host) | Ashburn (`start: 'cue'`) or bbs (`'sighted'`) | H2 |

## Trade giver 1's bank (cairn_mule1, 09:25 UTC)

After this morning's moves (operations log below), mule1's bank holds, beyond its starter kit:
staff of water 3, staff of fire 3, rune axe 1, rune pickaxe 3, mithril scimitar 2, knife 3; cosmic
62, air 1,678, fire 285, earth 131, water 67, law 57, death 110, chaos 40; air talisman 3, body
talisman 1; sapphire ring 12, emerald ring 27, ruby ring 16, diamond ring 5; ball of wool 1;
rune arrow 200; headless arrow 4,410; arrowtips bronze 60, iron 90, steel 135, mithril 1,500,
adamant 2,075, rune 570; adamant full helm 1; shark 60; feather 580; fly fishing rod 1, fishing
rod 1, fishing bait 5; chisel 1; normal logs 19 (cairn_h13's 3 landed 09:29); snape grass 102;
eye of newt 50; coins 126,059. Attempt 1 uses one of each tool; the spare staffs, pickaxes,
scimitars and knives are attempts 2 and 3's (per-attempt section).

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
| H4.x | b01-b04 | in: bones 23 a load; **every dragon bone first, then babydragon**, until S07's bury reaches **30,264.5 base Prayer xp (Prayer 95 at S07's end, for combat 43 by S09)** (rs/158 via rs/41, 03:0x PDT; dragon 72 base, babydragon 30); **the last load also gives law 1, air 5**; SCORED gives nothing | dragon **172** (h56 91, h55 49, h61 32; h55/h56 still farming); babydragon **1,533** (h51 563, h52 403, h53 274, h54 293); big 2,526 (bank lines 08:48-09:56 UTC) | no | On 172 dragon, S07 = 172 dragon + **597 babydragon = 769 bones, ~34 loads** (the row in force assumed 413 dragon + 141 babydragon, 554 bones). Each extra dragon bone farmed removes 2.4 babydragon, down to 554 bones at 325 dragon. rs/158 returns per-account counts for b01-b04, then rs/331 stages them. Final-load runes: rs/329 item 1 (`finalExtras`), from mule1's surplus. The axe is not handed back |
| H6 | mule1 | in: dwellberries 1, bucket of water 4, spade 1, rope 1, chocolate dust 1, bucket of milk 1, snape grass 1, law 2, water 2 (Ardougne only; the Camelot runes ride H4.x's last load) | snape grass, buckets of water 5, milk 3 and runes on mule1; **dwellberries, spade, rope, chocolate dust: none held** | partly | The four are rs/173's `far` set on cairn_h95 (rs/173 execution 2, delivering to mule1) |
| H4p | mule1 | in: rune pickaxe 1, normal logs 2 | mule1 | **yes** | On the forecast stock H4m has no loads, so there is no trade at the zoo to merge into: H4p is its own trade at S09's arrival. If H4m fires (an overflow stock), H4p rides H4m.1 |
| H7 | mule1 | in: logs 6, staff of fire 1, amulet of magic 1, antipoison(4) 1, shark 2, death 110, chaos 40, air 550 | mule1, except the amulet and antipoison | partly | **Amulet of magic: none**: h80's sapphire amulet enchanted (Enchant 1, Magic 7) by a helper (rs/41). **Antipoison: none**: Jiminua's sells (3)-dose at 432, or mixed from h85's marrentill (rs/41) |
| H8 | mule1 | in: agility potion(4) 1, law 5, air 3, fire 1, water 4 | runes on mule1; **agility potion: none** (no GE bid or ask) | partly | Herblore 34 (toadflax + toad's legs) on h84/h85 (rs/41, herb line) |
| H9 | mule1 | in: coins 5, law 2, water 2, shark 3 | mule1 | **yes** | - |
| H10 | mule1 | in: law 5, water 5, air 3, sharks up to 8 in all (8 staged; the giver tops up to 8 by what SCORED holds) | mule1 | **yes** | - |
| H11 | h92 | in: cannon set 1, cannonballs 100, mithril scimitar 1, law 4, water 4, shark 2 | set and 1,416 balls on h92; scimitar, runes and sharks on mule1 | partly | rs/344 (PR pending) adds `serve.extras` to `cannon.ts`: `"extras":[{"item":"Mithril scimitar","count":1},{"item":"Law rune","count":4},{"item":"Water rune","count":4},{"item":"Shark","count":2}]`, offered in the same trade (10 slots with set and balls). The serve withdraws from h92's bank, so these move mule1 → h92's bank once it lands (rs/331) |
| H11r | h92 | back: cannon set, leftover balls (~30) | - | n/a | h92 receives (serve `returnTile`) |
| H12 | mule1 | in: gold bar 1, ball of wool 1, monkey bones 1, banana 5, magic shortbow 1, rune arrow 200, prayer potion(4) 2, antipoison(4) 1, shark 9, law 6, air 6, fire 2 (two real Varrock sets), water 4; back: staff of fire, mithril scimitar, knife, Fight Arena's 1,000 coins, dead items | gold bar, bananas, wool, arrows, sharks, runes on mule1; **monkey bones, magic shortbow, prayer potions, the second antipoison: none** | partly | Shortbow: **on mule1** (rs/346 fletched 6; mule1 holds all 6: 3 for H12 over three attempts, 3 for h92). h90's GE bid cancelled 09:56 UTC. Monkey bones: rs/173 `far`. Prayer potions and antipoison: rs/348 (resting bids below) |
| H13 | mule1 | in: blood 70, air 400, magic potion(4) 1 (insurance), prayer potion(4) 2, law 4, water 4, staff of fire 1, knife 1 (both back from H12); back: the magic shortbow | air and runes on mule1; **blood runes, magic potion, prayer potions: none** | partly | Blood: rs/347 (GE asks and the Magic Guild via h88, Magic 66); h90's line (below) rests at 725. Potions: rs/348. The magic potion is insurance only |
| H14 | S18 courier (trade-giver pool) | **load 0** at S18's start: blood 500 and air 500 (Charge, 163 casts x 3 = 489 each), headless arrow 4,410, arrowtips bronze 60, iron 90, steel 135, mithril 1,485, shark 2, babydragon bones to every free slot less one (~16) | all on mule1 except blood and bones | partly | Blood: rs/347. Bones: babydragon only (rs/158), from h51-h54 to the courier (rs/41) |
| H14.x | S18 courier | **~13 top-ups, one trade each**, SCORED requesting at a stun's +2 from a side tile when food falls below `topUp.below` or bones below 3 (`StunPackOptions.bonesBelow`, `STUN_PACK_BONES_BELOW`, `thieving.ts` on main #280). The module sizes nothing ("sizing the load is the giver's"), so each top-up carries: babydragon bones to fill (15-21), sharks back to 2, and, once each, adamant tips 2,070 and rune tips 570 (when SCORED is down to one tier). Blood and air come in load 0 only. Per attempt: ~200 babydragon bones in all (~16 + ~184), ~4 more sharks | tips and sharks on mule1 | partly | Bones as H14 |
| H15 | mule1 | in: swamp paste 1, unlit torch 1, law 2, water 2 | runes on mule1; **paste and torch: none** | partly | rs/173 `far` (Port Khazard store, Jiminua's) |
| H16 | mule1 + h97 | in: raw giant carp 1, fishing rod 1, bait 1, coins 5, law 5, air 21, water 1, earth 1, SCORED's body talisman 1; back: the knife | all on mule1 except the carp | partly | Carp: rs/173 `carp` set on h97, not created (rs/41 to resume rs/173) |
| H17 | body-altar givers | in: essence 27 a delivery, 194 deliveries (5,238); **the last giver also gives Lumbridge runes: law 1, air 3, earth 1** | essence 101,782; 22 body talismans of 57 | no | Givers staged by `roster.ts plan`. The last giver's runes need an altar-giver final-extras option like rs/329's bone-giver one, **not yet in rs/329's scope** (rs/41) |
| H18 | mule1 | in: fly fishing rod 1, feather 580, logs 10, law 1, air 3, earth 1, knife 1 (back from H16) | mule1 (logs 19) | **yes** | - |
| H19 | mule1 | in: egg 1, bucket of milk 1, pot of flour 1, law 1, air 3, water 1 | mule1 (from h94, rs/173) | **yes** | - |
| H20 | mule1 | in: goblin mail 3, orange dye 1, blue dye 1, raw rat meat 1, raw bear meat 1, raw beef 1, raw chicken 1, cadava berries 1, law 2, air 6, water 1, fire 1 | mule1 (from h94 and h96, rs/173 09:38-09:40 UTC) | **yes** | - |
| H21a | **cairn_a01** | in: hammer 1, then 31 loads of 24-25 bars (bronze 15, iron 39, steel 120, mithril 305, adamant 365), each taking 5 platebodies back; takes every dead item back | **a01 (09:44 UTC): adamant 144, steel 120, mithril 305, iron 17, hammer 1**. Still to come: adamant 221, bronze 15, iron 22. Held: h21 adamant 174, bronze 14, iron 9; h23 adamant 59, iron 13, bronze 13; h22 adamant 62 | partly | h21 and h23 bank inside the Dwarven Mine, and `handover`'s walker finds no path out ("unreachable … requires a ladder"); both attempts failed cleanly with nothing withdrawn. Fix: a handover leg that climbs out first, as `~/rs-dev/bars-scratch/sibling-trip.ts` already does for the Mining Guild, or catch them above ground. Owner rs/41 (code) then rs/331 (the move). a01 logs in again (launcher, `mule` role, `couriers: ^cairn_h2[0-3]$`) to receive |
| H21c | **mule2** (wine giver) | in: unfermented wine 520, noted, one slot | **h40's inventory** (520, never banked) at Varrock west | yes, on h40 | One inventory-to-inventory trade h40 → mule2 close to the run, with h40's own `wine` role (`giveWine`, `receiver: cairn_mule2`), never `handover`: handover deposits the donor's inventory first, which unnotes the wine and starts fermentation. mule2 must hold it in its inventory, never run a banking role while it does, and on run day gives it from tile (3184,3436) to SCORED at (3185,3436) with rs/339's `afterRelog`. Why mule2: mule1's `mule` role banks whatever a courier hands it. Owners rs/331 (plan), rs/41 (the trade, on the run eve), rs/339 and rs/158 told |
| H21d | mule1 | in: chisel 1, uncut diamond 391 (noted) | chisel on mule1; **uncut diamonds: 2** (GE bid wall 6,000 for 9,787, no sellers) | partly | No buying (25,000 each; rs/41). rs/158's gem-table fallback (+88) is in force: the 108 mixed uncut gems are consolidated, noted, onto **mule1, the H21d giver** (2-4 stacks), and rs/350 delivers the rest of the line (1,142 hard leather, needle, thread) to mule1. **On mule1 so far: sapphire 19, emerald 2** (from h20, 09:44 UTC); the rest follows the h21/h23 moves (sapphire 8; sapphire 11, emerald 2, ruby 3) and h22, h51-h54, h80. **Mixed uncut gems held (banks 08:15-08:32 UTC):** sapphire 63 (h20 19, h54 15, h23 11, h21 8, h53 8, h22 1, h80 1), emerald 23 (h53 6, h54 6, h51 3, h80 3, h20 2, h23 2, h22 1), ruby 20 (h54 5, h52 4, h80 4, h23 3, h53 3, h22 1), diamond 2 (h51, h52); none on mule1, no dragonstone, opal, jade or topaz. rs/158 sends the mix with fold-in 18 |
| H21e | mule1 | in: noted unfinished potions and their secondaries (counts per rs/302's planner and rs/158's ledger) | snape grass 102 (100 for H21e) and eye of newt 50 on mule1; h84 (~483 unf after processing, eyes, snape grass), h85 (~360 unf), limpwurt 250 on h51-h54 | partly | Was blocked on a code gap: `handover` and the `mule` package spec matched items by exact name, and every unfinished potion is "Unfinished potion". rs/344 (PR pending) adds id lines: `{ id, n }` in handover and `{ id, amount }` in a mule package, optional `noted`; ids from `server/content/pack/obj.pack` (guam unf 91, note 92; ranarr unf 99, note 100). A name matching two bank items is now refused. Once it lands, h84/h85 consolidate to mule1 with the stop-flag procedure (rs/331; rs/41 cleared h84 to stop) |
| H22 | mule1 | in: coins 126,000, wizard's mind bomb 1, silk 1, lobster pot 1, unfired bowl 1, plank 3, nails 12, adamant full helm 1, amulet of strength 1, shark 10, law 5, air 9, fire 1, earth 1, water 3, mithril scimitar 1 (back from H12) | coins, helm, sharks, runes, and wizard's mind bomb, silk, lobster pot, unfired bowl, nails 12 ("Nails", id 1539; from h94) on mule1; **planks, amulet of strength: none** | partly | Planks: rs/173's far-set lab picked up 4 at the Barbarian Outpost; fallback the Rimmington spawn. Amulet of strength: h80's ruby amulet enchanted (Enchant 3, Magic 49) by a helper (rs/41) |
| H23 | h92 + mule1 | in: cannon set 1, cannonballs 1,200 and h92's own magic shortbow 1 in h92's trade (`serveExtras`, rs/344); ranging potion(4) 3, super antipoison(4) 2, super attack(4) 1, super strength(4) 1, shark 12 (mule1) | set, balls on h92; sharks on mule1; **no potions, no bow held** | partly | Potions: rs/348 (resting GE bids below, from rs/331). Bow: 3 on mule1 for h92 (one per attempt), moved into h92's bank with H11's extras when rs/344's `serve.extras` lands, served as `[{"item":"Magic shortbow","count":1}]`. Hedge: 2 yew shortbows on mule2 (rs/346; rs/41) |
| DS re-supply (contingency, rs/258) | mule2 | mithril scimitar, hammer, 8 sharks; planks 3, nails 12 | on mule2: scimitar, hammer, sharks | partly | Planks and nails: GE bids rest on mule2 (#19502 at 450, #19505 at 200), neither ever traded; fallback nails smithed by a smelter (h20/h21 steel), planks from the Rimmington spawn. Re-run `kits/mule2-ds.json` to collect fills (rs/41, low priority) |

**Fully staged today:** H1, H3, H4, H4k, H4p, H9, H10, H18, H19 and H20. The cannon set
and balls (H11, H23) are on h92, and the wine (H21c) is on h40. Every other row is partly staged,
with the missing items named above.

**Two magic shortbows per attempt (rs/158's ruling, 02:4x PDT).** mule1 gives one at H12 and
takes it back at H13, where it stays. h92 holds its own from the start and gives it in H23's
cannon trade, with the set and balls (rs/344 adds `serveExtras` to `cannon.ts` serve). There is
no mid-run bow transfer. rs/346 fletches them, one to mule1 and one to h92 per attempt. Fallback
if they are late: a willow shortbow from the Ranging Guild shop (stock 20), 2 per attempt bought
by cairn_h91 when rs/158 or rs/185 asks (rs/41).

## Per attempt

SCORED gives nothing back at the end of an attempt, scored or abandoned (main's ruling: no axe
hand-back). So everything handed over and not taken back is spent per attempt. Items that cycle
inside an attempt need only one copy: the knife (H4k, back at H12, H13, back at H16, H18), the
staff of fire (H7, back at H12, H13), the mithril scimitar (H11, back at H12, H22), the magic
shortbow (H12, back at H13, H23) and the cannon set (H11, back at H11r, H23). Each still leaves
with SCORED at the end, so one of each per attempt.

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
| cairn_mule1 | H1, H4, H6-H10, H12, H13, H14, H15, H16, H18-H20, H22 | air 1,591; law 43; water 29; fire 85; earth 53; cosmic 60; death 110; chaos 40; blood 570 | air 1,678; law 57; water 67; fire 285; earth 131; cosmic 62; death 110; chaos 40; blood 0 | held except blood (rs/347) | short per attempt: air ~1,600, cosmic 60, death 110, chaos 40, law ~49. Cosmic (h51-h54: 122), chaos (h53, h54: 221) and law (h52-h54: 340) are in the fleet; death (36 held) and air need GE buys (proposed to rs/41: ~190 death, ~3,200 air) |
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
| Magic shortbow | **2** (mule1's for H12-H13, h92's for H23) | mule1 6 | 3 | rs/346 fletched them; hedge: yew shortbow 2 on mule2, willow shortbows at the Ranging Guild via h91 |
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

Re-running the same buyer list on h62 or h63 collects any fills and buys only the shortfall.
Those offers, and h90's blood-rune line, are handed to rs/347 and rs/348, which own blood runes
and potions from 02:40 PDT.

Funding used: 74,481 + 29,400 on h64 and 1,050 on h63. GE escrow: h90's axe 100,025, shortbow
13,025 and blood runes up to 200,000 from its own coins; h62/h63's potions ~73,500. All within
rs/41's approvals (axe 300,000, pickaxes and scimitars 80,000, the buyer extras ~100,000, blood
runes ~570,000, potions 250,000).
