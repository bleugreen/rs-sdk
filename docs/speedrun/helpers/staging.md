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
| Trade giver 1 (`mule` role, packages served in order) | **cairn_mule1** (fleet, Varrock west bank; `serve` set on run day) | Ashburn run machine; credentials go there only through host, on run day | H1, H3, H4, H4k, H4p, H6-H10, H12-H16, H18-H20, H21d, H21e, H22, H23's potions, sharks and bow |
| Trade giver 2 | **cairn_mule2** (outside fleet.json, credentials in `~/rs-fleet/bots`; the rehearsal-kit giver until the run; named by rs/41, 01:36) | Ashburn, as above | **H21c, the wine giver** (below), and any hand-off trade giver 1 cannot reach in time (rs/117 splits them); holds attempt 2's axe and pickaxe |
| Cannon helper | cairn_h92 (`cannon.ts` serve mode, dev copy `~/rs-dev/cannon`) | bbs | H11, H11r, H23's cannon and balls |
| Bone givers | cairn_b01-b04 (`bone-giver.ts`) | Ashburn | H4.1-H4.n; the last load also gives T07-08's Camelot runes |
| Air-altar givers (S06) | 7 givers: h70, h71, h72 staged by rs/196's morning sequence, 4 not yet named | Ashburn | H5 |
| Body-altar givers (S21) | cairn_t01-t22, spares t23-t27 (`roster.ts`) | Ashburn | H17 |
| S18 bone courier | the trade-giver pool | Ashburn | H14, H14.x bones |
| Carp helper | cairn_h97 (rs/173; **not created yet**) | bbs, hands the carp to mule1 | H16's carp |
| Anvil giver | not named (rs/188's role; the lab used cairn_a01) | Ashburn | H21a |
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
| H4 | mule1 | in: clay 6, copper ore 4, iron ore 2, air talisman 1, law 2, air 6; back: the 20 enchanted rings | talisman and runes on mule1; clay **h94 7 (the only clay)**, copper h94 5, iron h94 3 | partly | h94 is rs/173's and held until rs/173 or rs/41 clears it; then a handover h94 → mule1 (rs/331 or rs/41). Package precondition: the giver's entire inventory (`mule.ts` `stagedExactly`, rs/267) |
| H5 | air-altar givers | in: rune essence 26 a load, 7 loads (182); each giver keeps its own air talisman | essence 101,782 (h30-h33) | h70-h72 by rs/196's sequence | Each S06 giver holds exactly 26 a load, and `altar-giver.ts` offers exactly `essence` by count (rs/329 item 2). Four givers to name (rs/41, rs/196) |
| H4k | mule1 | in: rune axe 1, knife 1, normal logs 1 | mule1 | **yes** | A separate trade at the Taverley trees (2912,3495), not b01's first bone load |
| H4.x | b01-b04 | in: bones 23 a load; **every dragon bone first, then babydragon** (rs/158: Prayer 96 and combat 43 by S09, for the Mining fallback beside brown bears); **the last load also gives law 1, air 5**; SCORED gives nothing | dragon 172 (h56 91, h55 49, h61 32); babydragon 1,533 (h51-h54) | no | b01-b04's banks staged by rs/330 once rs/158 fixes n: the dragon bones from h55, h56 and h61 onto the first loads' givers, babydragon onto the later loads. The final-load runes need rs/329 item 1 (`finalExtras`). The axe is not handed back (main's ruling) |
| H6 | mule1 | in: dwellberries 1, bucket of water 4, spade 1, rope 1, chocolate dust 1, bucket of milk 1, snape grass 1, law 2, water 2 (Ardougne only; the Camelot runes ride H4.x's last load) | snape grass and runes on mule1; buckets of water h94 5, milk h94 3; **dwellberries, spade, rope, chocolate dust: none held** | partly | The four are rs/173's `far` set on cairn_h95, not created (rs/173 paused); owner rs/41 to resume it. Buckets: h94, as H4 |
| H4p | mule1 | in: rune pickaxe 1, normal logs 2 | mule1 | **yes** | On the forecast stock H4m has no loads, so there is no trade at the zoo to merge into: H4p is its own trade at S09's arrival. If H4m fires (an overflow stock), H4p rides H4m.1 |
| H7 | mule1 | in: logs 6, staff of fire 1, amulet of magic 1, antipoison(4) 1, shark 2, death 110, chaos 40, air 550 | mule1, except the amulet and antipoison | partly | **Amulet of magic: none**: h80's sapphire amulet enchanted (Enchant 1, Magic 7) by a helper (rs/41). **Antipoison: none**: Jiminua's sells (3)-dose at 432, or mixed from h85's marrentill (rs/41) |
| H8 | mule1 | in: agility potion(4) 1, law 5, air 3, fire 1, water 4 | runes on mule1; **agility potion: none** (no GE bid or ask) | partly | Herblore 34 (toadflax + toad's legs) on h84/h85 (rs/41, herb line) |
| H9 | mule1 | in: coins 5, law 2, water 2, shark 3 | mule1 | **yes** | - |
| H10 | mule1 | in: law 5, water 5, air 3, sharks up to 8 in all (8 staged; the giver tops up to 8 by what SCORED holds) | mule1 | **yes** | - |
| H11 | h92 | in: cannon set 1, cannonballs 100, mithril scimitar 1, law 4, water 4, shark 2 | set and 1,416 balls on h92; scimitar, runes and sharks on mule1 | partly | Move a scimitar, law 4, water 4 and shark 2 from mule1 to h92, and have `cannon.ts` serve offer them with the set (it serves set + balls today): rs/329 or rs/41 |
| H11r | h92 | back: cannon set, leftover balls (~30) | - | n/a | h92 receives (serve `returnTile`) |
| H12 | mule1 | in: gold bar 1, ball of wool 1, monkey bones 1, banana 5, magic shortbow 1, rune arrow 200, prayer potion(4) 2, antipoison(4) 1, shark 9, law 6, air 6, fire 2 (two real Varrock sets), water 4; back: staff of fire, mithril scimitar, knife, Fight Arena's 1,000 coins, dead items | wool, arrows, sharks, runes on mule1; gold bar and bananas h94; **monkey bones, magic shortbow, prayer potions: none** | partly | Shortbow: h90's GE bid (target 3, to 20,000; resting at 13,025 over a 13,000 wall; recent trades ~9,300), rs/331 set it. Monkey bones: rs/173 `far`. Prayer potions: no GE sellers (8,000 bid wall); mix (Herblore 38, ranarr + snape grass) on h84/h85 (rs/41). Gold bar, bananas: h94 (rs/173) |
| H13 | mule1 | in: blood 70, air 400, magic potion(4) 1 (insurance), prayer potion(4) 2, law 4, water 4, staff of fire 1, knife 1 (both back from H12); back: the magic shortbow | air and runes on mule1; **blood runes, magic potion, prayer potions: none** | partly | Blood: GE ask 960 for 98, bid wall 700 for 16k; the Magic Guild sells at 50+ to Magic 66. Owner rs/41 (raise h88's 570 line from 603-650 to ~1,000, or train a Magic 66 buyer). The magic potion is insurance only |
| H14 | mule1 | in: blood 500, air 500, headless arrow 4,410, arrowtips bronze 60, iron 90, steel 135, mithril 1,485, shark 2, bones ~16 (babydragon only) | all on mule1 except blood and bones | partly | Blood as H13. Bones: babydragon from h51-h54 to the S18 courier (rs/41) |
| H14.x | mule1 | in: babydragon bones to fill (~184), adamant tips 2,070, rune tips 570, sharks back to 2 | tips and sharks on mule1 | partly | Bones as H14 |
| H15 | mule1 | in: swamp paste 1, unlit torch 1, law 2, water 2 | runes on mule1; **paste and torch: none** | partly | rs/173 `far` (Port Khazard store, Jiminua's) |
| H16 | mule1 + h97 | in: raw giant carp 1, fishing rod 1, bait 1, coins 5, law 5, air 21, water 1, earth 1, SCORED's body talisman 1; back: the knife | all on mule1 except the carp | partly | Carp: rs/173 `carp` set on h97, not created (rs/41 to resume rs/173) |
| H17 | body-altar givers | in: essence 27 a delivery, 194 deliveries (5,238); **the last giver also gives Lumbridge runes: law 1, air 3, earth 1** | essence 101,782; 22 body talismans of 57 | no | Givers staged by `roster.ts plan`. The last giver's runes need an altar-giver final-extras option like rs/329's bone-giver one, **not yet in rs/329's scope** (rs/41) |
| H18 | mule1 | in: fly fishing rod 1, feather 580, logs 10, law 1, air 3, earth 1, knife 1 (back from H16) | mule1 (logs 19) | **yes** | - |
| H19 | mule1 | in: egg 1, bucket of milk 1, pot of flour 1, law 1, air 3, water 1 | runes on mule1; egg, milk, flour h94 | partly | h94 (rs/173), as H4 |
| H20 | mule1 | in: goblin mail 3, orange dye 1, blue dye 1, raw rat meat 1, raw bear meat 1, raw beef 1, raw chicken 1, cadava berries 1, law 2, air 6, water 1, fire 1 | runes on mule1; goblin mail and meats h96, the rest h94 | partly | h94 and h96's quest items wait for rs/173 (rs/41 01:5x) |
| H21a | anvil giver | in: hammer 1, then 31 loads of 24-25 bars (bronze 15, iron 39, steel 120, mithril 305, adamant 365), each taking 5 platebodies back; takes every dead item back | adamant **354 (11 short)**, the rest ample (h20-h23); hammer h20, h91 | no | Adamant: h22/h23 smelting (rs/41's forecast 365 by ~12:00 UTC). Anvil giver to name (rs/41, rs/188) |
| H21c | **mule2** (wine giver) | in: unfermented wine 520, noted, one slot | **h40's inventory** (520, never banked) at Varrock west | yes, on h40 | One inventory-to-inventory trade h40 → mule2 close to the run, with h40's own `wine` role (`giveWine`, `receiver: cairn_mule2`), never `handover`: handover deposits the donor's inventory first, which unnotes the wine and starts fermentation. mule2 must hold it in its inventory, never run a banking role while it does, and on run day gives it from tile (3184,3436) to SCORED at (3185,3436) with rs/339's `afterRelog`. Why mule2: mule1's `mule` role banks whatever a courier hands it. Owners rs/331 (plan), rs/41 (the trade, on the run eve), rs/339 and rs/158 told |
| H21d | mule1 | in: chisel 1, uncut diamond 391 (noted) | chisel on mule1; **uncut diamonds: 2** (GE bid wall 6,000 for 9,787, no sellers) | partly | Unreachable by 23 Oct. rs/158's fallback, the gem-table mix (+88): uncut sapphire 35, emerald 21, ruby 16 held. Owner rs/158 (which mix), rs/41 (stock) |
| H21e | mule1 | in: noted unfinished potions and their secondaries (counts per rs/302's planner and rs/158's ledger) | snape grass 102 (100 for H21e) and eye of newt 50 on mule1; h84 (~483 unf after processing, eyes, snape grass), h85 (~360 unf), limpwurt 250 on h51-h54 | partly | **Code gap:** `handover` (and the `mule` package spec) address items by exact name, and in this revision every unfinished potion is "Unfinished potion" and every grimy herb "Herb", so neither can move one potion type, or keep types apart. Needs id-addressed items (noted ids differ from the banked ones). Until then, h84/h85's unf stay put. Owner rs/41 (file or fold into rs/329) |
| H22 | mule1 | in: coins 126,000, wizard's mind bomb 1, silk 1, lobster pot 1, unfired bowl 1, plank 3, nails 12, adamant full helm 1, amulet of strength 1, shark 10, law 5, air 9, fire 1, earth 1, water 3, mithril scimitar 1 (back from H12) | coins, helm, sharks, runes on mule1; quest items and nails 12 ("Nails", id 1539) on h94; **planks, amulet of strength: none** | partly | Planks: rs/173's far-set lab picked up 4 at the Barbarian Outpost; fallback the Rimmington spawn. Amulet of strength: h80's ruby amulet enchanted (Enchant 3, Magic 49) by a helper (rs/41) |
| H23 | h92 + mule1 | in: cannon set 1, cannonballs 1,200 (h92); ranging potion(4) 3, super antipoison(4) 2, super attack(4) 1, super strength(4) 1, shark 12, magic shortbow 1 (back from H13; mule1) | set, balls on h92; sharks on mule1; **no potions held** | partly | Potions from the herb line (rs/41): irit and kwuarm unf on h85, eye of newt, limpwurt; ranging needs Herblore 72. GE: ranging bid 5,000, no sellers |
| DS re-supply (contingency, rs/258) | mule2 | mithril scimitar, hammer, 8 sharks; planks 3, nails 12 | on mule2: scimitar, hammer, sharks | partly | Planks and nails: GE bids rest on mule2 (#19502 at 450, #19505 at 200), neither ever traded; fallback nails smithed by a smelter (h20/h21 steel), planks from the Rimmington spawn. Re-run `kits/mule2-ds.json` to collect fills (rs/41, low priority) |

**Fully staged today:** H1, H3, H4k, H4p, H9, H10 and H18. The cannon set
and balls (H11, H23) are on h92, and the wine (H21c) is on h40. Every other row is partly staged,
with the missing items named above.

**One conflict to settle.** rs/329's item 3 says H23 "takes back the magic shortbow". The inputs
here have H13 take it back and H23 give it again, because S27 fires it. This page follows the
inputs: the bow returns to mule1 at H13, and mule1 gives it in H23 beside h92's cannon trade.

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

### Spent per attempt, against stock today (3 attempts planned)

| Item | Per attempt | Held now | Attempts covered | Next ones from |
|---|---|---|---|---|
| Rune axe | 1 | mule1 1, mule2 1 | 2 | h90's GE line, 2 more (approved to 300,000) |
| Rune pickaxe | 1 | mule1 3, mule2 1 | 4 | - |
| Mithril scimitar | 1 | mule1 2 (mule2's 1 is the contingency's) | 2 | Zeke (Al Kharid, ~1,050) was out of stock after 2; one more on a later buyer run |
| Magic shortbow | 1 | 0 | 0 | h90's bid, target 3, to 20,000 |
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
| Blood runes | 570 | 0 | 0 | GE or the Magic Guild |
| Bones (Prayer) | the S07/S09/S18 mix, ~1,645 bones on the forecast | dragon 172, babydragon 1,533, big 2,526 | 1 on the fast mix; later attempts fall back to big bones (rs/158 prices the ticks) |
| Rune arrows | 200 | mule1 200 | 1 | h91's `rune-arrows` loop (target 200) is rebuying (attempt 2's) |
| Arrowtips, headless arrows | rune 570, adamant 2,070, mithril 1,485, headless 4,410, the rest small | exactly one attempt's (mule1) | 1 | h76 is back camping Hickton's toward its targets (attempt 2's) |
| Potions (prayer 4, antipoison 2, agility 1, ranging 3, supers 4) | 14 | 0 | 0 | the herb line (rs/41) |
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

Funding used: 74,481 + 29,400 on h64; h90's two open GE offers escrow 100,025 (axe) and 13,025
(shortbow) from its own 468,995. Under the 480,000 rs/41 approved.
