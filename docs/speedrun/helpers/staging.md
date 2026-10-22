# Hand-off staging for the scored attempts

Every hand-off row of SCORED's inventory ledger, with the giver account that holds its package,
where the stock is now, whether it is staged, and, if not, the gap, how it closes and who owns
it. A per-attempt section follows, because several items leave the fleet with SCORED on every
attempt and must be staged fresh for the next one. Issue: cairn://p/rs/331 (under rs/41).

**Authority.** The rows and counts are STEP-MANIFEST.md's **Inventory ledger** (rs/158's slot
ledger, on rs/158's branch at 4ebdcdf5, fold-in 16). SUPPLIES.md's hand-off table follows it
(fold-in 18, rs/318). This page applies the changes from rs/158 (00:35) and main (01:3x) on
2026-10-22 ahead of fold-in 18. If a fold-in moves a count, the ledger wins, and the row here is
re-staged to match. **SCORED** is the scored account; its name and credentials appear nowhere
here.

**Stock as of 2026-10-22 08:30 UTC.** Fleet accounts come from `~/rs-fleet/stockpile.json`.
Accounts outside the fleet (dev copies, kit giver, quest-item and gear helpers) come from the
latest `"bank":[...]` line in their own logs under `~/rs-dev`, read with a one-off scan over
`speedrun/helpers/bbs.sh`. Two limits apply. Only **banks** are read, so what a helper carries
in its inventory is missing, which matters for the noted wine on cairn_h40. And accounts that
have never logged a bank line (cairn_h93, h95, h97, b01-b04, h70-h75) show nothing.

## Givers

| Giver | Account | Host on run day | Rows |
|---|---|---|---|
| Trade giver 1 (`mule` role, packages served in order) | **cairn_mule1** (fleet, Varrock west bank, `serve` set on run day) | Ashburn run machine; credentials go there only through host, on run day | H1, H3, H4, H4k, H4p, H6-H10, H12-H16, H18-H20, H21c (wine giver), H21d, H21e, H22, H23's potions and bow |
| Trade giver 2 | **cairn_mule2** (outside fleet.json, credentials in `~/rs-fleet/bots`; rehearsal-kit giver until the run, rs/41 01:36) | Ashburn, as above | the back-to-back hand-offs trade giver 1 cannot reach in time (rs/117 splits them) |
| Cannon helper | cairn_h92 (`cannon.ts` serve mode, bbs dev copy `~/rs-dev/cannon`) | bbs | H11, H11r, H23's cannon and balls |
| Bone givers | cairn_b01-b04 (`bone-giver.ts`) | Ashburn | H4.1-H4.n (the last load also gives T07-08's Camelot runes, rs/329) |
| Air-altar givers (S06) | 7 givers; h70, h71, h72 named and staged by rs/196's morning sequence, 4 not named here | Ashburn | H5 |
| Body-altar givers (S21) | cairn_t01-t22, spares t23-t27 (`roster.ts`) | Ashburn | H17 |
| Carp helper | cairn_h97 (rs/173; **not created yet**) | bbs, hands the carp to trade giver 1 | H16's carp |
| Anvil giver | not named (rs/188's role; the lab used cairn_a01) | Ashburn | H21a |
| Firemaking droppers | the six droppers (rs/269's demo used two per host) | Ashburn (`start: 'cue'`) or bbs (`'sighted'`) | H2 |

## Hand-off rows (attempt 1)

"In" is what SCORED receives, and "back" is what SCORED gives the giver in the same trade
(`swap()`). Staged means the package sits in the named giver's bank in full, ready for the giver
to withdraw; trade giver 1's bank holds every package it serves. Holder counts are banked stock
at the time above.

| Row | Giver | In / back | Stock now | Staged | Gap, how it closes (owner) |
|---|---|---|---|---|---|
| H1 | mule1 | in: staff of water 1, cosmic 60, air 81, fire 80, earth 50, law 1 | staff of water: **h88 1 (the only one)**; cosmic h88 62; fire h88 85; air plenty; earth h88 7 + starter stacks; law h53 154, h54 144 | no | Handover h88 → mule1 (the staff, cosmic 60, fire 80). Earth 50 is short in any one bank: buy at Aubury on the h64 buyer run (rs/331) |
| H2 | droppers | 157 logs on the ground: logs 2, oak 4, willow 7, maple 13, yew 24, magic 107 | magic 5,258; yew 67; maple 53; willow 32; oak 19; logs 26 (woodcutters h10-h13, mule1 16) | no (dropped at run time) | Loaded onto the droppers on run day by the fm-row restock (rs/41) |
| H3 | mule1 | in: sapphire ring 12 + emerald 8; emerald 19 + ruby 1; ruby 15 + diamond 5 (3 loads) | **h80 exactly 12 / 27 / 16 / 5** | no | Handover h80 → mule1 once the fleet is back (rs/331). Exactly one attempt's worth (see per-attempt) |
| H4 | mule1 | in: clay 6, copper ore 4, iron ore 2, air talisman 1, law 2, air 6; back: the 20 enchanted rings | clay **h94 7 (the only clay)**; copper h94 5; iron h94 3, h92 25; air talisman h88 3 | no | h94 belongs to rs/173 and is held until rs/173 or rs/41 clears it; then handover h94 → mule1. Talisman from h88's handover. **Staging precondition: the package is the giver's entire inventory** (`mule.ts` `stagedExactly`, rs/267) |
| H5 | air-altar givers | in: rune essence 26 a load, 7 loads (182); each giver keeps its own air talisman | essence 101,782 (h30-h33) | h70-h72 staged with ≥189 each by rs/196's sequence (pending its morning run) | **Each S06 giver holds exactly 26 a load**, and `altar-giver.ts` must offer exactly `essence` by count (rs/329 item 2). Four more givers to name (rs/41, rs/196) |
| H4k | mule1 | in: rune axe 1, knife 1, normal logs 1 | rune axe **h90 1**; knife h91 1, h94 2; logs mule1 16 | no | Handover h90 → mule1 (axe; h90's bidder axe line set to target 0 first, done 08:38 UTC) and h91 → mule1 (knife). A separate trade at the Taverley trees (2912,3495), not b01's first bone load |
| H4.x | b01-b04 | in: bones 23 a load (n loads); **the last load also gives law 1, air 5** (T07-08's Camelot teleport); SCORED gives nothing | dragon 172 (h56 91, h55 49, h61 32); babydragon 1,533 (h51-h54); big 2,526 | no | Bone givers' banks are staged by rs/330 (b01-b04 on the demo) once rs/158 fixes n for the stock. The final-load runes need rs/329 item 1 (`finalExtras`). The axe is not handed back (main's ruling) |
| H6 | mule1 | in: dwellberries 1, bucket of water 4, spade 1, rope 1, chocolate dust 1, bucket of milk 1, snape grass 1, **law 2, water 2** (Ardougne only; the Camelot runes moved to H4.x's last load) | buckets of water h94 5; milk h94 3; snape grass h96 2 (h84/h85's are rs/323's, not touched); **dwellberries, spade, rope, chocolate dust: none held** | no | The four missing items are rs/173's `far` set on cairn_h95, which is not created (rs/173 is paused). Owner rs/41 to resume rs/173. h96 is in use by rs/332 until it logs out |
| H4p | mule1 | in: rune pickaxe 1, normal logs 2 | rune pickaxe **h91 1** (rs/124's; confirmed in its 08:25 UTC bank); logs mule1 16 | no | Handover h91 → mule1. On the forecast stock H4m has no loads, so there is no trade at the zoo to merge into: H4p is its own trade at S09's arrival. If H4m fires (an overflow stock), it rides H4m.1 |
| H7 | mule1 | in: logs 6, staff of fire 1, amulet of magic 1, antipoison(4) 1, shark 2, death 110, chaos 40, air 550 | staff of fire h88 1 (h55/h56's are their casting staffs); death h88 110; chaos h88 40; air h55 1,343, h56 1,362, h60 332; **amulet of magic: none; antipoison(4): none** | no | Handover h88 → mule1 (staff, death, chaos). Amulet of magic: h80's sapphire amulet enchanted (Enchant 1, Magic 7) by a helper (rs/41, jeweller). Antipoison: Jiminua's sells (3)-dose at 432, or rs/323 mixes it (marrentill unf on h85). Owner rs/41 |
| H8 | mule1 | in: agility potion(4) 1, law 5, air 3, fire 1, water 4 | **agility potion: none** (no GE bid or ask) | no | Herblore 34 (toadflax + toad's legs): ask rs/323 to add it to h84/h85's plan; otherwise rs/41 |
| H9 | mule1 | in: coins 5, law 2, water 2, shark 3 | sharks h91 65, mule2 70, h53 26, h54 25; coins plenty | no | Fleet stock: courier law runes and sharks to mule1 (rs/331 after fleet back) |
| H10 | mule1 | in: law 5, water 5, air 3, **sharks up to 8 in all** (8 staged; the giver tops up to 8 by what SCORED holds) | as H9 | no | As H9 |
| H11 | h92 | in: cannon set 1, cannonballs 100, mithril scimitar 1, law 4, water 4, shark 2 | h92: **2 sets, 1,416 balls**; **mithril scimitar: none held for the run** | balls and set: yes (h92) | Scimitar: Zeke's (Al Kharid, ~1,050) on the h64 buyer run (rs/331, 3 bought for 3 attempts), then handed to h92. Runes and sharks to h92 |
| H11r | h92 | back: cannon set, leftover balls (~30) | - | n/a | h92 receives (serve `returnTile`) |
| H12 | mule1 | in: gold bar 1, ball of wool 1, monkey bones 1, banana 5, magic shortbow 1, **rune arrow 200**, prayer potion(4) 2, antipoison(4) 1, shark 9, law 6, air 6, **fire 2** (two real Varrock sets), water 4; back: staff of fire, mithril scimitar, knife, Fight Arena's 1,000 coins, dead items | gold bar h94 1; wool h80 6; bananas h94 6; rune arrows **h91 200**; **monkey bones: none; magic shortbow: none; prayer potions: none** | no | Shortbow: h90's GE bid raised to 20,000 for 3 (rs/331, 08:38 UTC; resting at 13,025 against a 13,000 wall; the last 3 trades were ~9,300). Monkey bones: rs/173 `far`. Prayer potions: GE bid wall 8,000, no sellers, so mix (Herblore 38, ranarr + snape grass, both on h84/h85): rs/323. Arrows: handover h91 → mule1 |
| H13 | mule1 | in: blood 70, air 400, magic potion(4) 1 (insurance), prayer potion(4) 2, law 4, water 4, **staff of fire 1, knife 1** (both back from H12); back: the magic shortbow | **blood runes: none** (h88's 570 bid at 603-650 never filled); magic potion: none | no | Blood runes: GE ask 960 x98, bid wall 700 x16k; Magic Guild sells at 50+ with Magic 66 (no helper has it). Owner rs/41: raise h88's blood-rune line to ~1,000 for 570 (~570,000) or train a Magic 66 buyer. Magic potion is insurance only: drop it if unmade |
| H14 | mule1 | in: blood 500, air 500, headless arrow 4,410, arrowtips bronze 60, iron 90, steel 135, mithril 1,485, shark 2, bones ~16 | headless h78 4,410; tips h76 (60/90/135/750) + h91 mithril 750; blood: none | no | Tips and headless arrows to mule1 by courier/handover (h76 and h78 are fleet; after fleet back). Blood as H13 |
| H14.x | mule1 | in: bones to fill (~184 over the stuns), adamant tips 2,070, rune tips 570, sharks back to 2 | adamant tips h76 2,075; rune tips h76 570 | no | As H14 |
| H15 | mule1 | in: swamp paste 1, unlit torch 1, law 2, water 2 | **none held** | no | rs/173 `far` (Port Khazard store, Jiminua's) |
| H16 | mule1 + h97 | in: raw giant carp 1, fishing rod 1, bait 1, coins 5, law 5, air 21, water 1, earth 1, **SCORED's body talisman 1**; back: the knife | rod h94 2, h91 1; bait h91 5, h94 5; body talismans h51 28, h52 15, h53 8, h54 6; **carp: none** | no | Carp: rs/173 `carp` set on h97, not created. Body talisman: courier 1 from h51 |
| H17 | body-altar givers | in: essence 27 a delivery, 194 deliveries (5,238); **the last giver also gives Lumbridge runes: law 1, air 3, earth 1** | essence 101,782; 22 body talismans of 57 | no | Givers staged by `roster.ts plan`. The last giver's runes need an altar-giver final-extras option like rs/329's bone-giver one: **not yet in rs/329's scope** (rs/41) |
| H18 | mule1 | in: fly fishing rod 1, feather 580, logs 10, law 1, air 3, earth 1, **knife 1** (back from H16) | fly rods h51-h54, h91; feathers 18,867 (h01-h03); logs as above | no | Courier feathers and a rod to mule1 (fleet, after fleet back) |
| H19 | mule1 | in: egg 1, bucket of milk 1, pot of flour 1, law 1, air 3, water 1 | h94 (egg 2, milk 3, flour 2) | no | h94 held for rs/173, as H4 |
| H20 | mule1 | in: goblin mail 3, orange dye 1, blue dye 1, raw rat meat 1, raw bear meat 1, raw beef 1, raw chicken 1, cadava berries 1, law 2, air 6, water 1, fire 1 | goblin mail h96 4; meats h96 2 each, h94 beef/chicken 2; dyes, berries h94 2 | no | h94 (rs/173) and h96 (rs/332's, ~1 h) held; then handovers |
| H21a | anvil giver | in: hammer 1, then 31 loads of 24-25 bars (bronze 15, iron 39, steel 120, mithril 305, adamant 365), each taking 5 platebodies back; **takes every dead item back** | bars: adamant **354 (11 short)**, others ample (h20-h23); hammer h91 1, h20 1 | no | Adamant: h22/h23 are smelting now (rs/41 forecast 365 by ~12:00 UTC). Anvil giver account to be named (rs/41, rs/188) |
| H21c | mule1 (wine giver) | in: unfermented wine 520, noted, one slot | **h40: 520 noted in its inventory** (rs/118; never banked, so not in any bank line) | yes, on h40 | Move h40 → mule1 only by trade, never via a bank. Confirm the count from h40's inventory before the run (rs/41) |
| H21d | mule1 | in: chisel 1, uncut diamond 391 (noted) | chisel h80 1, h91 1; **uncut diamonds: 2** (GE bid wall 6,000 x9,787, no sellers) | no | Unreachable by 23 Oct. rs/158's fallback, the gem-table mix (+88): uncut sapphire 35, emerald 21, ruby 16 held. Owner rs/158 (which mix), rs/41 (stock) |
| H21e | mule1 | in: noted unfinished potions and secondaries | h84/h85 | no | **Pending rs/323** (h84/h85 not touched) |
| H22 | mule1 | in: coins 126,000, wizard's mind bomb 1, silk 1, lobster pot 1, unfired bowl 1, plank 3, nails 12, adamant full helm 1, amulet of strength 1, shark 10, law 5, air 9, fire 1, earth 1, water 3, **mithril scimitar 1** (back from H12) | quest items h94; nails h94 12 ("Nails", id 1539); adamant full helm **h91 1**; coins plenty; **plank: none; amulet of strength: none** | no | Planks: rs/173's far-set lab picked up 4 at the Barbarian Outpost; the Rimmington spawn is the fallback. Amulet of strength: h80's ruby amulet enchanted (Enchant 3, Magic 49) by a helper (rs/41). Helm: handover h91 → mule1 |
| H23 | h92 + mule1 | in: cannon set 1, cannonballs 1,200 (h92); ranging potion(4) 3, super antipoison(4) 2, super attack(4) 1, super strength(4) 1, shark 12, **magic shortbow 1** (back from H13; mule1) | h92 as H11; **no potions held** | set and balls: yes (h92) | Potions: rs/323 (irit/kwuarm unf on h85, eye of newt, limpwurt on h51-h54); ranging needs Herblore 72. GE: ranging bid 5,000, no sellers |
| DS re-supply (contingency) | mule2 | mithril scimitar, hammer, 8 sharks; planks 3, nails 12 | on mule2: scimitar, hammer, sharks | partly | Planks and nails: GE bids rest on mule2 (#19502 at 450, #19505 at 200) but neither has ever traded; fallback: nails smithed by a smelter (h20/h21 steel), planks from the Rimmington spawn. Re-run `kits/mule2-ds.json` to collect fills (rs/41, low priority) |

**One conflict to settle.** rs/329's item 3 says H23 "takes back the magic shortbow". The inputs
here have H13 take it back and H23 give it again, because S27 fires it. This page follows the
inputs: the bow returns to trade giver 1 at H13, and trade giver 1 gives it in H23 beside h92's
cannon trade. If H23 is one trade from h92 alone, the bow moves mule1 → h92 between S16 and S26.

## Per attempt

SCORED gives nothing back at the end of an attempt, scored or abandoned (main's ruling: no axe
hand-back). So everything handed over and not taken back is spent per attempt. Items that cycle
inside an attempt need only one copy: the knife (H4k, back at H12, H13, back at H16, H18), the
staff of fire (H7, back at H12, H13), the mithril scimitar (H11, back at H12, H22), the magic
shortbow (H12, back at H13, H23) and the cannon set (H11, back at H11r, H23). Each still leaves
with SCORED at the end, so one of each per attempt.

### Spent per attempt, against stock today (3 attempts planned)

| Item | Per attempt | Held today | Attempts covered | Next ones from |
|---|---|---|---|---|
| **Rune axe** | 1 | h90 1, mule2 1 | 2 | h61's GE line, 2 more (rs/331; approved to 300,000) |
| **Rune pickaxe** | 1 | h91 1, mule2 1 | 2 | Nurmof x2 on the h64 buyer run (rs/331; at most 80,000) |
| Mithril scimitar | 1 | 0 (mule2's 1 is the Dragon Slayer contingency's) | 0 | Zeke x3 on the h64 buyer run |
| Magic shortbow | 1 | 0 | 0 | h90's bid, target 3, to 20,000 |
| Staff of water | 1 | h88 1 | 1 | Zaff (Varrock, 1,500, stock 2) x2 on the h64 buyer run |
| Staff of fire | 1 | h88 1 (+ h55, h56 casting) | 1 | Zaff x2, same run |
| Knife | 1 | h91 1, h94 2 | 3 | Shantay 6 gp |
| Rings (sapphire 12, emerald 27, ruby 16, diamond 5) | 60 | exactly 60 on h80 | 1 | the jeweller (h80) from uncut gems and gold bars; the 5 diamonds have no stock (2 uncut held) |
| Clay 6, copper 4, iron 2 | 12 | clay 7 (h94) | 1 | quest-item southwest set re-run (rs/173) |
| Unfermented wine | 520 | 520 (h40) | 1 | 883 grapes and 501 jugs of water held, so ~880 more can be made (h40's `wine` role) |
| Cannon set | 1 | 2 (h92) | 2 | Nulodion, the cannon helper only (rs/41) |
| Cannonballs | ~1,270 net (1,300 out, ~30 back at H11r) | 1,416 | 1 | h92 makes them from steel bars (352 held, 4 balls a bar) |
| Uncut diamond | 391 | 2 | 0 | gem-table fallback, every attempt |
| Adamantite bars | 365 | 354 | 0.97 | smelting now; the mithril-platebody fallback (+425 mithril bars) for later attempts |
| Blood runes | 570 | 0 | 0 | GE or the Magic Guild |
| Bones (Prayer) | the whole S07/S09/S18 mix, ~1,645 bones on the forecast | dragon 172, babydragon 1,533, big 2,526 | 1 on the fast mix; later attempts fall back to big bones (rs/158 prices the ticks) |
| Rune arrows | 200 | 200 (h91) | 1 | h91's `rune-arrows` role (target 200) rebuys when its stack moves to mule1 |
| Arrowtips and headless arrows | rune 570, adamant 2,070, mithril 1,485, the rest small | exactly one attempt's | 1 | the fletcher (h76-h79) |
| Potions (prayer 4, antipoison 2, agility 1, ranging 3, supers 4) | 14 | 0 | 0 | rs/323's Herblore plan |
| Sharks | ~52 | ~208 outside mule2 (and 297 in the fleet's ledger) | 3+ | GE ask ~557 |
| Law runes | ~49 | 669 | 13 | - |
| Rune essence | 5,420 | 101,782 | 18 | - |
| Feathers | 580 | 18,867 | 32 | - |

### The rune axe and rune pickaxe pair, per attempt

| Attempt | Rune axe (H4k) | Rune pickaxe (H4p) | Status |
|---|---|---|---|
| 1 | h90's (GE, 150,001, rs/124) → mule1 | h91's (rs/124) → mule1 | handovers pending |
| 2 | mule2's (the kit giver's GE-bought second axe) | mule2's (Nurmof, 32,000) | held on mule2, the second trade giver; free once its rehearsal duty ends (rs/41) |
| 3 | h61's GE line, first fill | h64's Nurmof run, first | bidding / to buy |
| spare | h61's GE line, second fill | h64's Nurmof run, second | bidding / to buy |

An attempt that dies or is abandoned after H4k still spends its pair (SCORED gives nothing back).
The next attempt's pair is moved to the trade giver that serves H4k and H4p before that
attempt's run login.

## Operations log

Every move: the account, what changed, and how it was restored. Times are UTC.

- **2026-10-22 08:38 cairn_h90** (dev copy `~/rs-dev/gear`, bidder loop in `tmux -L rs41-gear`
  window `bid-h90`, rs/41's account since rs/124 closed). Options backed up to
  `run/opts/bidder-h90.json.bak-20261022T083801Z`. Rune axe line target 1 → 0 (the axe can leave
  h90 without a replacement bid). Magic shortbow (861) target 1 → 3, maxPrice 12,000 → 20,000.
  Mithril scimitar target 1 → 0, which cancelled offer #17091 (2,000 gp collected); Zeke covers
  it. SIGINT to the bidder's own PID (2171412, child of the loop 2171408); the loop restarted it
  on the new file at 08:38:59. The new shortbow offer is #19530 at 13,025.
- **08:41 cairn_h91**: `run/stop-role-cairn_h91` set so its `rune-arrows` loop (PID 3751699,
  finished at target 200 and only re-running) exits at its next natural end, ahead of the h91
  handover.
