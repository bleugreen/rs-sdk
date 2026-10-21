# Supplies manifest for the scored run

Every item a helper hands to SCORED (the scored account; its real name never appears in this
repository), by hand-off, in run order. The step IDs and the order are [RUN-ORDER.md](RUN-ORDER.md)'s
(v2), aligned with [STEP-MANIFEST.md](STEP-MANIFEST.md). This page is for the helper swarm
(cairn://p/rs/41); the rs/103 coordinator sends it there. Issues: cairn://p/rs/109 (v1),
cairn://p/rs/111 (this version). **Section 6 lists every change since the v1 the coordinator sent to
rs/41.**

Built from every skill document's "Helper supply list" section (`docs/speedrun/skills/*.md`, section 7;
`combat.md` section 6), the quests' helper-trade column ([quests/README.md](quests/README.md) section
4), the helper documents on cairn://p/rs/41/1/coordinator (`HELPERS.md`, `helpers/*.md`), and the labs
RUN-ORDER.md folds in: [run-transitions.md](research/run-transitions.md) (rs/104, hand-off costs),
[bones-placement.md](research/bones-placement.md) (rs/105), [stun-pack.md](research/stun-pack.md)
(rs/106), [wine-window.md](research/wine-window.md) (rs/107) and
[supply-fallbacks.md](research/supply-fallbacks.md) (rs/129). Where the documents disagree, section 4
says which count this page took.

## How hand-offs work

- **Two hosts.** The helpers whose timing must be tick-exact beside SCORED run on the **Ashburn run
  machine through the launcher cairn://p/rs/117** (under rs/41): a loopback gateway, lite runners with
  the #78 relay fix, logged in before SCORED's run login and staying in through its planned relogs,
  clean logout, independent of `fleetctl`, documented in HELPERS.md. They are the altar givers of the
  7-tick Runecraft cycle (S06, S21), the **trade giver** that serves SCORED's hand-offs, the **bone
  givers** beside the tree in S07, four alternating (cairn_b01-b04, separate from the altar givers;
  their request lands on a roll label, so it is tick-relevant, bones-placement.md section 3), the **stun-pack giver** beside the knights in S18 (the trade giver
  pool), and the wine giver (S25c), which is the same account as the trade giver (main, 06:12). The
  altar givers follow rs/117's cue contract. **Everything else stays on the bbs fleet**: it gathers,
  crafts and buys, and couriers stock to the Ashburn givers ahead of each hand-off (helper-to-helper
  trades cost SCORED nothing). The giver column below says "Ashburn (rs/117)" or "bbs fleet" for each
  hand-off. rs/117 sizes the trade-giver pool; two accounts cover back-to-back hand-offs.
- **Roles.** The bbs roles that exist are in `HELPERS.md` (woodcutter, bars, essence, wine, bones,
  mule, coins and buyer, bidder); the planned ones without an owner are the fletcher-supplier, herb
  gatherer, gem supplier, rune and jewellery buyer, combat-supply buyer and quest-item gatherer. The
  "cannon helper" is a helper that has completed Dwarf Cannon (cairn://p/rs/125 is doing it now, with
  ~290 steel bars for ~1,170 balls): only such a player can buy the cannon from Nulodion or make
  cannonballs, and the ammo mould is untradeable (`dwarf_cannon.md`; supply-fallbacks.md section 9).
- **The giver stands adjacent and requests first.** SCORED's receiver accepts only when the offer
  matches and its own offer is empty (`speedrun/lib/trade.ts`). **Receiver cost, measured on a second
  host at all four staging tiles: 4 ticks for one noted stack, 8 for 23 stacks, 12 of 12 each**
  (run-transitions.md section 3). The exceptions are S18's top-ups, which SCORED requests itself at stun
  offset +2 (stun-pack.md section 5), and the S07 bone loads, which the giver requests while SCORED
  holds 2 bones. A return of items (H11r, products in S25) is a separate trade with SCORED as the giver
  (6 to 10 ticks on the giver's side).
- **One press per offered item.** A helper offers each item with a single All or Offer-X; two presses
  on the same slot of an unstackable item land only the first (stun-pack.md section 5; `trade.ts`
  `amountButtons`, cairn://p/rs/136).
- **Drop and pick up** saves 0-3 ticks against a trade (1, 2 or 3 ticks for 1-3 items on the pile;
  pickups one at a time), and needs SCORED away for the 100-tick private window (run-transitions.md
  section 3). Only H2's log row uses it.
- **Noted where possible.** Notes take one slot. Items SCORED must use from the inventory are unnoted
  (rings, bones buried on the spot, essence, bars at the anvil). Noted stacks go into SCORED's bank at
  Varrock west (S25); **never note unfermented wine into a helper's bank** (the bank stores deposited
  notes as fermenting wine, `helpers/wine.md`).
- **No amulet of glory anywhere**: charged glories are unobtainable on the demo (rs/123). Every leg
  uses a spell teleport or a ship (RUN-ORDER.md section 2), so the runes below include them.
- **Staging and logout.** Almost every hand-off is staged while SCORED is logged in on an earlier step
  (free in parallel). If a hand-off is not staged when SCORED reaches the logout-safe boundary before it
  (RUN-ORDER.md section 4), SCORED logs out there and waits; each such pause is a tab relog at ~21.6
  ticks (RUN-ORDER.md section 4), so it pays only against a logged-in wait longer than ~22 and is
  the exception. S25's planned relog 1 doubles as its staging pause.
- **The run starts only on main's start conditions** (section 5). The run is about 35,000 ticks, about
  3 hours of wall time, so nothing can be gathered at helper rates while it runs.
- **Names.** No hand-off, cue file or log line in the repository names SCORED; rs/117's cue carries a
  hash of the name, never the name.

Scarcity markers: **[scarce]** few or no sellers and slow sources; **[contested]** other players' bids
compete; **[unobtainable]** effectively no source; **[restricted]** tradeable but only a qualified
helper can obtain it; **[untradeable]** SCORED must get it itself in the quest; **[held]** in the
fleet's hands as of the date given.

## 1. Hand-offs

| ID | Step | Tile | When; SCORED logged out while staged? | Giver (host) | Items and counts |
|---|---|---|---|---|---|
| H1 | S01 | Lumbridge landing (3222,3222) | staged before SCORED's run login (SCORED is parked there since the claim) | trade giver, Ashburn (rs/117); stocked by the rune and jewellery buyer, bbs fleet | staff of water 1; cosmic rune 60 (Lundail, rs/123); air rune 81; fire rune 80; earth rune 50. **No rings**: the starter kit fills 18 of 28 slots. The starter kit's air and mind runes cover Wind Strike |
| H2 | S03 | the Firemaking row beside the chicken coop (3233,3295) | dropped at least 100 ticks before SCORED reaches each log (a drop is private to the dropper for 100 ticks, then public); staged before the run login | woodcutter, bbs fleet | 157 logs on the ground along the snake, one per tile, in order: logs 2, oak 4, willow 7, maple 13, yew 24, magic 107. Fallback: 6 trades of 27 unnoted by the trade giver (1: 2 + 4 oak + 7 willow + 13 maple + 1 yew; 2: 23 yew + 4 magic; 3-5: 27 magic; 6: 22 magic) |
| H3 | S04 | the row's end | during S03 | trade giver, Ashburn (rs/117) | three ring loads of 20, unnoted: sapphire ring 12 + emerald ring 8; emerald ring 19 + ruby ring 1; ruby ring 15 + diamond ring 5 |
| H4 | S05 | Doric's house (2951,3451) | during S03-S04 | trade giver, Ashburn (rs/117); stocked by the quest-item gatherer | clay 6, copper ore 4, iron ore 2; Falador teleport runes for 3 casts (T04-05, T05-06, T06-07: 3 law, 9 air, 3 water); SCORED's air talisman 1; Woodcutting and Mining kits: **rune axe 1** (budget item, section 5), rune pickaxe 1, knife 1, normal logs 6 |
| **H4.1-H4.n** | S07 (S25b's bones) | the oak tile (2914,3494), giver on (2913,3494); later the willow tile (2920,3406), giver on (2920,3407) | the first load before S07 reaches the oaks, then whenever SCORED holds 2 bones (about every 70 ticks at 0.329 bones per tick) | **four bone givers alternating, cairn_b01-b04, Ashburn (rs/117, rs/141's `bone-giver.ts`)**, logged in before SCORED, each **running** Falador west to the trees and back between its loads. The round trip on the demo, Falador west bank to the giver tile and back with a bank visit, is **199-215 ticks at the oaks (mean 205, n = 9) and 178-193 at the willows**, running; walking only it is 321-328; run energy did not drain (m, demo, rs/163, 14:45 PDT). At one load per ~70 ticks, three givers leave each ~210 ticks a trip, no margin against 215, so rs/41 adds the fourth, **cairn_b04** (four leave ~280). Walking would need five. (rs/141's lab round trip was 158-161 at the oaks and 149-152 at the willows, ~160-170 with the bank.) bones from the bones role and the bidder, bbs fleet | **bones, unnoted, 23 per load (any type)**. n is S07's non-stun bones / 23: with every line held, **355 dragon bones, n = 16** (15 loads of 23 and one of 10); on the 21:20 UTC stock, **~978 bones, n = ceil(978 / 23) = 43** (42 loads of 23 and one of 12): the **49 dragon bones first** (loads 1 and 2, and 3 in load 3), then **929 babydragon**. Alternating, cairn_b01, b02 and b03 give 11 loads each (b01 loads 1, 5, ... 41; b03 loads 3, 7, ... 43) and cairn_b04 10. The 24 dragon bones held on the GE bidder h61 are collected and banked with the givers' stock before the start. The ~85 babydragon past S07 go to the S09 `stay2` lap in H4m.1-H4m.4, none to the booth (RUN-ORDER.md section 7) **[scarce]**. The giver keeps a request standing and re-sends on the tick after a "busy" refusal; refusals cost SCORED 0, a load 4 ticks (the first 5) (m, lab, cairn://p/rs/141) |
| H5 | S06 | air altar room, beside (2844,4832) | givers in the room and logged in before SCORED's run login; staged during S04-S05 | 7 altar givers, Ashburn (rs/117), following the cue contract | each giver: air talisman 1 + rune essence 27, unnoted (189 essence in all) |
| H6 | S08 | Plague City's start (after the Camelot teleport) | during S07 | trade giver, Ashburn (rs/117) | dwellberries, 4 buckets of water, spade, rope, chocolate dust, bucket of milk, snape grass (quests/README.md step 2); Camelot runes 1 cast (1 law, 5 air); Ardougne runes 1 cast (2 law, 2 water) |
| **H4m.1-H4m.4** (new) | S09 (the Mining `stay2` lap's bones; only on a stock that overflows S07, such as 21:20 UTC's) | the zoo iron cluster, on a free tile beside the lap's east stay (2605,3234), off its standing tiles | the first load as SCORED reaches the cluster after T08-09, then whenever SCORED holds 2 bones (about every 330 ticks at one bone per 15-tick lap) | trade giver, Ashburn (rs/117), with rs/141's `bone-giver.ts` request (a standing request, re-sent the tick after a refusal); it is in Ardougne already for H6 and stages H7 after the last load. The S07 bone givers stay on the Taverley route | **babydragon bones, unnoted, ~85 in 4 loads (24, 24, 24, 13)**, 24 a load as bones-placement.md section 4 priced it, fewer if SCORED's free slots are fewer. **Usable only once `knife-mine` buries on the `stay2` lap** (STEP-MANIFEST.md entry 4; RUN-ORDER.md O35, which ~61 more dragon bones would also settle); until then these ~85 are staged at the Varrock west booth with S25's hand-offs (H21b) |
| H7 | S10b | maze entrance, Elkoy (2504,3191) | during S09 | trade giver, Ashburn (rs/117) | **the pre-MM trade**: logs 6; staff of fire 1; amulet of magic 1; antipoison(4) 1; shark 2; fight runes: death rune 110, chaos rune 40, air rune 550 (section 4). No dragon bones and no prayer potions: Prayer is ~94 when S07 ends |
| H8 | S11a, S11b | Gnome Stronghold, by the course | during S10b | trade giver, Ashburn (rs/117) | agility potion(4) 1; Varrock runes 1 cast (1 law, 3 air, 1 fire); Ardougne runes 2 casts (4 law, 4 water) |
| H9 | S12 | Ardougne landing (2661,3301) | during S11b | trade giver, Ashburn (rs/117) | coins 5; Ardougne runes 1 cast; shark 3 (insurance) |
| H10 | S13 | Ardougne landing | during S12 | trade giver, Ashburn (rs/117) | Ardougne runes 2 casts and Falador runes 1 cast (dwarf_cannon.md) |
| H11 | S14 | Commander Lawgof (2571,3463) or the Ardougne lever (2561,3311) | during S13 | cannon helper **[restricted]** (rs/125), bbs fleet (not tick-exact), with the trade giver for the rest | dwarf multicannon set (base, stand, barrels, furnace) 1; cannonballs 100 (S14 uses ~58); **mithril scimitar 1** (the rune scimitar is unobtainable, rs/124; rs/41 bought it); Ardougne runes 2 casts (T13-14 and T14-15); shark 2. The H7 antipoison is already held |
| H11r | after S14 | **Ardougne teleport landing (2661,3301)**, during T14-15 | right after the teleport | cannon helper (receives), bbs fleet | SCORED gives back the cannon set and the leftover cannonballs (keeps the scimitar) |
| H12 | S15 | the Grand Tree, King Narnode | during S14 | trade giver, Ashburn (rs/117) | gold bar 1, ball of wool 1, monkey bones 1, bananas 5; magic shortbow 1 + rune arrows 100 (SCORED keeps the bow and what is left of the arrows for S27); prayer potion(4) 6; shark 15; antipoison(4) 1 (the second); Varrock runes 1 cast; Ardougne runes 2 casts |
| H13 | S16 | Ardougne landing, before the lever | during S15 | trade giver, Ashburn (rs/117); stocked by the rune and combat-supply buyers | blood rune 70 + air rune 400 (Kolodion; the staff of fire covers fire); magic potion 1 (insurance only); prayer potion(4) 2; Ardougne runes 2 casts (S16 in, T16-18 out). SCORED's knife (from H4) cuts the webs. S17's sharks moved to H23 |
| H14 | S18 (load 0) | East Ardougne market, beside the knights (~2655,3305) | during S16 | trade giver, Ashburn (rs/117); stocked by the bones role and the fletcher-supplier | blood rune 500 + air rune 500 (Charge: 163 casts x 3 = 489 each, stun-pack.md section 6, plus margin); headless arrow 4,410; arrowheads bronze 60, iron 90, steel 135, mithril 1,485; shark 2; dragon bones ~16, unnoted (every free slot less one; any type, babydragon on the 21:20 UTC stock). The staff of fire stays wielded from H7 |
| H14.1-H14.13 | S18 | beside the knights; the giver stays within 3 tiles of SCORED at all times | about every 90-190 ticks; **SCORED requests** at stun offset +2 (or +4 if the giver is not adjacent), never on the tick after a bury, and sizes the load when it requests | trade giver, Ashburn (rs/117) | dragon bones to fill (15-21 per load), **~184 more, ~200 in the stuns in all** **[scarce]** (babydragon on the 21:20 UTC stock, with the ~197 spare carried here for a stun count above 200, RUN-ORDER.md section 7); sharks back to 2; **adamant arrowheads 2,070** in one top-up and **rune arrowheads 570** in another, each when SCORED is down to one tier. 12-13 top-ups over the segment (stun-pack.md section 6) |
| H15 | S19 | Witchaven / Ardougne landing | during S18 | trade giver, Ashburn (rs/117) | swamp paste 1, unlit torch 1; Ardougne runes 1 cast |
| H16 | S20 | Hemenster, before the contest | during S19 | carp helper, bbs fleet, handing to the trade giver, Ashburn (rs/117) | raw giant carp 1 (the carp helper leaves the contest before its third catch); fishing rod 1; fishing bait 1; coins 5; Camelot runes 3 casts (3 law, 15 air); **for T20-21: Ardougne runes 1 cast and 30 coins for Captain Barnaby; for T21-22: Lumbridge runes 1 cast** |
| H17 | S21 | nature altar room, beside (2400,4839) | **a continuous roster**, staged during S18-S20 and running through S21; SCORED stays logged in | N altar givers, Ashburn (rs/117), N = ceil(restock / 7) + 1 from rs/117's measured round trip; a **talisman keeper** at the ruins (2868,3018) hands each giver a talisman on the way in and takes it back on the way out (supply-fallbacks.md section 7); essence mined on bbs and couriered | each delivery: rune essence 27, unnoted; 161 deliveries, **4,536 essence in all with H5** **[contested on the GE; gather]**. SCORED's own nature talisman 1. The givers reach the ruins by the Ardougne-Brimhaven ship, about 160 ticks each way (run-transitions.md section 6; no glory) |
| H18 | S22 | Lumbridge river (3241,3248) | during S21 | trade giver, Ashburn (rs/117) | fly fishing rod 1; feather 580 (SCORED already holds the knife and a log); Lumbridge runes 1 cast (T22-23) |
| H19 | S23 | Lumbridge castle kitchen (3209,3215) | during S22 | trade giver, Ashburn (rs/117) | egg 1, bucket of milk 1, pot of flour 1; Falador runes 1 cast (T23-24) |
| H20 | S24 | **the Rusty Anchor, Port Sarim (3045,3257)** | during S23 | trade giver, Ashburn (rs/117); stocked by the quest-item gatherer | goblin mail 3, orange dye 1, blue dye 1 (Goblin Diplomacy); raw rat meat, raw bear meat, raw beef, raw chicken, 1 each (Druidic Ritual; the enchanted meats are **[untradeable]**, SCORED dips them); **cadava berries 1** (Romeo and Juliet's only item: the apothecary makes the potion from them, r `apothecary.rs2:61-65`; rs/126 owns the full list); Falador runes 1 cast (to Kaqemeex) and Varrock runes 1 cast (to Romeo) |
| H21a | S25a | Varrock west anvil (3188,3426) | staged before S25 | trade giver, Ashburn (rs/117), at the anvil; bars from the bars role, bbs fleet | hammer 1; then 31 trades of 24-25 unnoted bars, each taking the 5 platebodies back: bronze bar 15, iron 39, steel 120, mithril 305, adamantite 365 (including one spare inventory of the top three tiers) **[scarce: GE not viable]**. Fallback with no adamantite: mithril platebodies above 88, about +425 mithril bars (supply-fallbacks.md section 2) |
| H21b | - | - | - | - | **retired** with every line held: the booth bones ride S07 (H4.1-H4.n). On the 21:20 UTC bone stock none overflow to the booth while the Mining lap buries (H4m); if it does not, its ~85 are staged at the Varrock west booth with S25's hand-offs (+154, RUN-ORDER.md section 7) |
| H21c | S25c | Varrock west booth | the giver is beside the booth, requesting, as planned relog 1 lands; SCORED enters relog 1 holding **at most 27 items** (wine-window.md section 5) | wine giver = the trade giver, Ashburn (rs/117); wine from the wine maker, bbs fleet | unfermented wine, **noted**, one slot: **520 [held]**, unbanked by the wine giver (rs/118, 10:10 PDT 2026-10-21). Fallback for the make arming only: grapes 1, jug of water 1. **The kebab fallback is not stocked**: if the wine fails outright from SCORED's tab (RUN-ORDER.md R17), ugthanki kebabs are its cheap fallback (131 m, `cooking.md` route 2; +~42 i against the wine), but nobody holds their ~340 kebab mixtures and ~340 pitta breads (the pittas need a Cooking-58 helper, the mixtures ugthanki meat from camels). Main and rs/41 decide whether to stock them; without them the fallback is fish on a range, +~890 i |
| H21d | S25d, S25c | Varrock west booth | before S25 | trade giver, Ashburn (rs/117); gems from the gem supplier, bbs fleet | chisel 1; uncut diamond 391, noted (364 + one spare inventory). **107 of them are cut in the wine windows**: SCORED withdraws all uncut gems in the burst that deposits the first 29 wines (wine-window.md section 5 B). Fallback: the gem-table mix (2-4 noted stacks, supply-fallbacks.md section 4) |
| H21e | S25e | Varrock west booth | before S25 | trade giver, Ashburn (rs/117); herbs from the herb gatherer, bbs fleet | supply-safe list, noted: guam potion (unf) 41, irit potion (unf) 405, eye of newt 432 (27, 391, 418 plus one spare inventory of 14 each). Fallback: the herb-table mix (10-14 stacks; the helpers need Herblore 50 and 55; supply-fallbacks.md section 5). H21d and H21e go in one trade |
| H22 | S26 | Champions' Guild door (3191,3363) | during S25 | trade giver, Ashburn (rs/117); stocked by the quest-item gatherer and the combat-supply buyer | **coins ~126,000**: 12,000 for the quest and ~114,000 for Scavvo's rune chainbody (50,000) and platelegs (64,000), which SCORED buys upstairs on arrival (supply-fallbacks.md section 12); wizard's mind bomb 1, silk 1, lobster pot 1, unfired bowl 1, plank 3, steel nails 12 (the hammer from H21a is held); **adamant full helm 1** (the rune helm drops only); amulet of strength 1; shark 10; Varrock, Lumbridge and Falador runes 1 cast each; Ardougne runes 1 cast (T26-27). The anti-dragon shield and the map pieces come from the quest itself **[untradeable]** |
| H23 | S27, S17 | poison spiders (3288,3810), or the Ardougne landing before the walk | during S26 | cannon helper, bbs fleet, with the trade giver, Ashburn (rs/117), for the kit | dwarf multicannon set 1 (the one from H11r); cannonballs ~1,100 (1,300 target); ranging potion(4) 3 (9 doses); super antipoison(4) 1 + 1 spare; super attack(4) 1; super strength(4) 1; **shark 12 for S17**. No rune knives and no glory: SCORED fires the magic shortbow (H12) with the **570 rune arrows it fletched in S18** plus what is left of MM's 100 |

Lookouts (bbs fleet, no items): one helper at each Wilderness stretch (S14, S16, S27, S17) and at the
zoo iron and the Taverley oaks before S09 and S07, reporting players in view (RUN-ORDER.md R8, R9).

**The nature altar roster (H17).** A roster needs no SCORED relog: a giver that has traded leaves,
banks, takes 27 essence and comes back in. Without a glory the round trip is the Brimhaven ship,
about 160 ticks each way from Ardougne (run-transitions.md section 6). A giver that banks in Ardougne
therefore needs roughly 330 or more ticks per round trip, and the roster about 330 / 7 + 1 = 48 givers
(i). Givers that restock from essence couriers waiting outside the ruins need only the keeper's
pipeline, about 25 ticks per entry (supply-fallbacks.md section 7, e), so about 5 givers: the
couriers' own trips to the bank are helper time and free. **N and the restock method are rs/117's to
set** (RUN-ORDER.md O7). Talismans are not consumed: with the keeper, 4 or more talismans
run the cycle continuously; 2 cost ~+34 and 1 ~+52 in extra batches staged while SCORED is logged
out (supply-fallbacks.md section 7). The givers must not log out and back in during S21: a giver that
logs in after SCORED drops to the robust 8-tick schedule for its own trades.

## 2. Stockpile totals across the run

| Item | Total | Hand-offs | Source of the count | Scarcity |
|---|---|---|---|---|
| Dragon bones | **555** (355 unnoted in 16 loads for S07 + ~200 unnoted in load 0 and 12-13 top-ups for S18) | H4.1-H4.n, H14, H14.1-H14.13 | `prayer.md` section 7; split by bones-placement.md section 5 and stun-pack.md section 6 | **[scarce]**: at 21:20 UTC (rs/41, 14:29 PDT) 49 dragon (25 banked by rs/112, 24 held on the GE bidder h61; 18 more bid but unfilled, not counted), 1,411 babydragon and ~3,100 big. The hard condition, Prayer xp in hand of at least 39,938 base, is met by 49 dragon + 1,214 babydragon with ~197 babydragon to spare and no big bones, so the bones are a tick cost. On that stock: ~978 to S07 (the 49 dragon and 929 babydragon, 43 loads), ~85 babydragon to the S09 `stay2` lap (H4m.1-H4m.4; it needs `stay2` adopted as S09's lap and its bury built in the page, STEP-MANIFEST.md entry 4), ~200 babydragon to the stuns, none at the booth: +185 against every line held (RUN-ORDER.md section 7). Any bone type rides the same slots at the same cost per bone, so a mix only adds bones |
| Unfermented wine, noted | **520 [held]** | H21c | `helpers/wine.md` (29 + 491, P(99) 99.83%) | held by the wine giver (rs/118) |
| Rune essence | **4,536** (189 + 4,347) | H5, H17 | `runecraft.md` section 7 | **[contested]** on the GE; gathered (~1,000 per account-hour, `helpers/essence.md`) |
| Logs for Firemaking | 157: logs 2, oak 4, willow 7, maple 13, yew 24, magic 107 | H2 | `firemaking.md` section 7 (exact) | magic logs from the woodcutter role |
| Normal logs, other | 12 (6 for Tree Gnome Village, 6 for the knife loops) | H4, H7 | `quests/README.md` step 3; `mining.md`, `woodcutting.md`, `fishing.md` section 7 | easy |
| Bars | bronze 15, iron 39, steel 120, mithril 305, adamantite 365 | H21a | `smithing.md` section 7 (+25 margin on steel, mithril, adamantite) | **[scarce]**: adamantite ore is the gap (rs/119); fallback +425 mithril |
| Uncut diamonds | 391 (364 + 27 spare), 107 of them cut in the wine windows | H21d | `crafting.md` section 7, diamonds-only fallback | 5 held at rs/129; the gem-table mix is the working plan (rs/41, 09:35) |
| Uncut dragonstones | 0 | - | `crafting.md` section 7 | **[unobtainable]** |
| Herblore, supply-safe | guam (unf) 41, irit (unf) 405, eye of newt 432 | H21e | `herblore.md` section 7 | irit at risk; the herb-table mix is the working plan (rs/41, 09:35) |
| Fletching | **headless arrow 4,410; arrowheads: bronze 60, iron 90, steel 135, mithril 1,485, adamant 2,070, rune 570** | H14, H14.x | RUN-ORDER.md section 7, "Fletching mix" (fletching.md section 2's band xp on the demo's level curve) | adamant: 2,075 held or targeted (Dargaud's drained by an outside buyer); rune: ~560 targeted from Hickton's, Catherby (100 stock, one per ~40 ticks); **buy 570** (a multiple of 15) |
| Rune arrows (finished) | **100** (MM) | H12 | `quests/README.md` step 8 | S27's ~490-560 (rs/124) come from SCORED's own 570 fletched in S18, so no more are bought |
| Feathers | 580 to SCORED; ~4,410 inside the headless arrows (helper side) | H18; H14 | `skills/README.md` Fishing row (~520 from 78) + 60 spare | easy |
| Rings | sapphire 12, emerald 27, ruby 16, diamond 5 (unnoted) | H3 | `magic.md` section 7 | helper Crafting or the GE |
| Cosmic rune | 60 | H1 | `magic.md` section 7 | reachable from Lundail, ~25 minutes (rs/123) |
| Blood rune | 570 (70 Kolodion + 500 Charge) | H13, H14 | `magic.md` section 7; stun-pack.md section 6 | Magic Guild shop |
| Death rune, chaos rune | 110, 40 | H7 | section 4 | Magic Guild; GE |
| Air rune | ~1,650 (enchants 81, fights 550, Kolodion 400, Charge 500, teleports ~110, spares) | H1, H4, H6-H8, H13, H14, H16, H20, H22 | sum of the hand-offs | easy; S06's own air runes can cover part |
| Law rune | ~55: 15 Ardougne casts (30), 7 Falador, 4 Camelot, 4 Varrock and 3 Lumbridge (18), plus spares | per hand-off | count of the run's teleports (RUN-ORDER.md section 2) | rune shops |
| Water rune | ~40 (Ardougne 2 per cast, Falador 1); fire rune 80 + ~5; earth rune 50 + ~5 | per hand-off | as above; `magic.md` | easy |
| Staves and amulets | staff of water 1, staff of fire 1, amulet of magic 1, amulet of strength 1 | H1, H7, H22 | `magic.md`; quests/README.md steps 3, 13 | Zaff, Magic Guild, GE |
| Amulet of glory | **0** | - | rs/123 | **[unobtainable]**: every leg is measured without one (run-transitions.md) |
| Sharks | ~58 (TGV 2, FA 3, cannon 2, MM 15, Thieving 2 + top-ups ~12, Dragon Slayer 10, Agility 12) | H7, H9, H11, H12, H14, H14.x, H22, H23 | quests/README.md steps 3, 5, 8, 13; `agility.md`; stun-pack.md sections 6, 8 | **70 [held]** (rs/41, 10:10) |
| Prayer potion(4) | 8 (MM 6, Mage Arena 2) | H12, H13 | quests/README.md steps 8, 9 | H7's 2 dropped (Prayer ~94 from S07); MM's and the arena's are insurance, open as RUN-ORDER.md O27 |
| Antipoison(4) | 2 | H7, H12 | quests/README.md steps 3, 8 | helper Herblore or GE |
| Agility potion(4), magic potion | 1, 1 | H8, H13 | `agility.md`, `magic.md` section 7 | magic potion: helper Herblore 76 or GE |
| Combat kit potions | ranging potion(4) 3, super antipoison(4) 2, super attack(4) 1, super strength(4) 1 | H23 | `ranged.md` section 7 | helper Herblore or GE |
| Cannonballs | **at least ~1,170** (S14 ~58, S27 ~1,100); 1,400 target | H11, H23 | supply-fallbacks.md section 9 | **[restricted]**: rs/125 makes them from ~290 steel bars. A start condition |
| Dwarf multicannon set | 1 | H11, H23 | `ranged.md` section 7 | **[restricted]**: Nulodion sells it to anyone who completed Dwarf Cannon and replaces a lost one for its owner (supply-fallbacks.md section 9) |
| Rune knives | **0** | - | rs/124 | **[unobtainable]**: no shop sells knives; the magic shortbow replaces them at no cost (rs/124) |
| Gear and tools | **rune axe** (budget item), rune pickaxe, knife, **mithril scimitar**, magic shortbow, **adamant full helm**, fly fishing rod, fishing rod + 1 bait, chisel, hammer | H4, H11, H12, H16, H18, H21, H22 | skill and quest lists; supply-fallbacks.md sections 10, 12, 13 | rune axe: GE only, bid ladder to 1M (C#16 on rs/111); rune scimitar and rune helm unobtainable (rs/124); SCORED buys the rune chainbody and platelegs from Scavvo in S26 |
| Talismans | air: 1 + 7 givers'; nature: SCORED's 1 + the keeper's stock (4 or more for no delta) | H4, H5, H17 | `runecraft.md` section 7; supply-fallbacks.md section 7 | nature talismans close to unobtainable: the keeper is what makes 1-4 enough |
| Quest items | Doric's, Plague City's, Monkey Madness's, Sea Slug's, Fishing Contest's carp, Cook's Assistant's, the filler's (incl. cadava berries), Dragon Slayer's | H4, H6, H12, H15, H16, H19, H20, H22 | quests/README.md section 4 | easy |
| Coins | ~126,040 (Dragon Slayer 12,000, Scavvo ~114,000, the Brimhaven ship 30, Fight Arena 5, Fishing Contest 5) | H9, H16, H22 | quests/README.md steps 5, 11, 13; supply-fallbacks.md section 12 | the fleet held 2.34M (rs/124) |

## 3. Untradeable, restricted and unobtainable items on the route

- **Untradeable, SCORED gets them itself:** Druidic Ritual's enchanted meats (it dips the four raw meats
  helpers supply); Dragon Slayer's map pieces, Crandor map and maze keys (`tradeable=no`), and its
  anti-dragon shield from the Duke; the Mage Arena's god staff and cape (not needed beyond Charge's
  stage 8); Monkey Madness's quest-made items. None of these is on a helper's list.
- **Restricted:** the cannon set and cannonballs (only a helper that completed Dwarf Cannon can buy or
  make them; the ammo mould is untradeable).
- **Unobtainable on the demo:** charged glories (rs/123), rune knives, the rune scimitar and the rune
  full helm (rs/124), uncut dragonstones and torstol. Each has a fallback above that is ready now.
- **Never trade notes of unfermented wine into a bank** on the helper side (they ferment there).
- Off the route, for the record: the law talisman (Troll Stronghold only) and the lava eel (Heroes'
  Quest) are untradeable, which is why neither route uses them.

## 4. Where the documents disagree, and which count this page took

| Item | Counts in the documents | Taken | Why |
|---|---|---|---|
| Dragon bones | ~400 (rs/41's first pass, with Holy Grail); 555 (`prayer.md`); 11 + 196 + 348 (v1) | 555: 355 in S07, ~200 in S18 | Holy Grail is off the route; bones-placement.md puts the non-stun bones in S07; stun-pack.md measured 194-213 in the stuns, so ~200 there and the rest in S07 |
| Rune essence | ~4,200 (rs/41 first pass, law altar); 4,536 (`runecraft.md`) | 4,536 | the route is air then nature |
| Wine | 450 + 1 grapes + 1 jug (`cooking.md`, one login); 450-520 (`helpers/wine.md`) | 520 (held) | `helpers/wine.md` is the demo-measured two-relog design |
| Cannonballs | ~1,500 (rs/41 first pass); ~1,000-1,300 with the kit (`ranged.md`); ~1,170 used (supply-fallbacks.md section 9) | at least ~1,170, 1,400 target | the start condition is ~1,170; the target keeps ~230 of margin |
| Fight runes before Monkey Madness | ~200 chaos + 600 air and ~40 death + 160 air (`pre_mm_fights.md` via `magic.md`); flagged too high by rs/81 | death 110, chaos 40, air 550 | T/5 upper bounds (warlord ~27 Fire Blast, demon ~31 Fire Bolt, Fight Arena ~56 Fire Blast) plus ~25-30% margin |
| Charge runes | ~490 + 490 (`magic.md`); 489 + 489 (stun-pack.md section 6); 500 + 500 (quests/README.md step 9) | 500 + 500 | the measured need is 489 each; the round figure is the margin |
| Feathers for Fishing | ~700 from 20 and ~320 from 90 (`fishing.md`); ~520 from 78 (`skills/README.md`) | 580 | the route's start level; +60 spare |
| Fletching | rune list (2,595 rune arrowheads) or adamant cap (3,735 adamant) (`fletching.md`); v1 took the adamant cap | 2,070 adamant + 570 rune, mithril 1,485, headless 4,410 | rs/41 holds or targets 2,075 adamant and ~560 rune; 570 rune arrows cover S27, so the arrow purchase shrinks to MM's 100; every mix fits the stuns at 0 ticks |
| Ranged ammunition for S27 | up to ~760 rune knives (`ranged.md`); ~500-560 rune arrows (supply-fallbacks.md section 8); 650 (rs/41's target via rs/124) | 570 fletched by SCORED + MM's leftovers | knives are unobtainable; the bow costs nothing (rs/124) |
| Smithing bars | exact list plus "one inventory per tier" margin (`smithing.md`) | the list + 25 on steel, mithril, adamantite | the document's own margin |
| Herblore lines | full list (175 torstol), ranging cap, supply-safe (`herblore.md`) | supply-safe; the herb-table mix if irit falls short | torstol is unobtainable |
| Crafting gems | 277 dragonstones + 10 diamonds + 1 ruby (`crafting.md`) | 364 diamonds + 27 spare; the gem-table mix if they fall short | dragonstones are unobtainable |
| Sharks for Agility and Thieving | ~10-12 (`agility.md`); 20 (`thieving.md`); 11-12 eaten, 2 carried (stun-pack.md section 8) | 12 (H23) and 2 + top-ups | measured eating in the pack |
| Prayer potions | 2 (TGV), 4-6 (MM), 1-2 (Mage Arena) | 0, 6, 2 | Prayer ~94 from S07 makes TGV's unnecessary (bones-placement.md section 5, citing `prayer.md`); the others stay as insurance |
| Ring loads | one load in H1 and two in H3 (v1) | three loads of 20 in H3 | the starter kit leaves H1 about 10 free slots |
| Runecraft deliveries | batches of ~20 givers with SCORED logging out between them (`runecraft.md` section 7) | a continuous roster of N givers on the run machine, with the talisman keeper | main's two-relog rule and the tuned cycle's need for givers ahead of SCORED (RUN-ORDER.md R12) |

## 5. Readiness checklist before SCORED's run login

Main adopted rs/129's start policy at 09:30 (supply-fallbacks.md, "Recommended policy"; RUN-ORDER.md
section 1).

1. **Hard: Prayer xp in hand of at least 39,938 base**, in any bone mix (dragon 72, babydragon 30, big
   15 per bone). Met at rs/41's 21:20 UTC count by dragon and babydragon alone: 49 dragon and 1,214
   of the 1,411 babydragon, with ~197 babydragon to spare and no big bones (~3,100 held), so the bones
   are a tick cost, not readiness. Every adult blue bone (rs/112) counts as a dragon bone.
2. **Hard: a cannon set and at least ~1,170 cannonballs** (rs/125's helper).
3. **Budget item: the rune axe** in H4: held at 13:10 (rs/41). Without it Woodcutting would cost
   +388 (adamant) or +836 (mithril) with the knife.
4. **Budget:** the expected total plus the fallback deltas in force is under 35,916 (RUN-ORDER.md's
   headline scenario table: +326 for rs/41's 09:35 plan, +185 more on the 21:20 UTC bone stock: 34,921 expected).
5. **Held already:** 520 noted unfermented wines with the wine giver (rs/118); 70 sharks (rs/41, 10:10).
6. **To buy for Fletching:** 570 rune arrowheads (Hickton's), 2,070 adamant arrowheads, 1,485 mithril
   arrowheads, and the bronze, iron and steel stacks; 4,410 headless arrows. **Finished rune arrows:
   100 only** (MM).
7. The rest of section 2, with the scarce lines first: 774 bars plus margin (or the mithril fallback),
   4,536 essence, the gems and herbs (or their table mixes), 60 cosmic runes, ~126,000 coins in H22.
8. rs/117's helpers on the run machine (the trade-giver pool, the four S07 bone givers, the 7 air altar
   givers, the N nature altar givers and the talisman keeper) are logged in, before SCORED.
9. H1-H5 and H4.1 are staged (H1 at the landing tile, H2's row dropped and past its reveal, H4 at
   Doric's, H4.1 at the oak tile, H5's seven givers in the air altar room or ready to enter).
10. The H17 roster is staffed and rehearsed, or the logout fallback is agreed.
11. A lookout helper is assigned to each Wilderness stretch (S14, S16, S27, S17) and to the zoo and
    Taverley sites before S09 and S07.

## 6. Changes since v1 (the version the coordinator sent to rs/41)

| Hand-off or line | v1 | Now | Why |
|---|---|---|---|
| Dragon bones | H7 11; H14 21 + H14.1-H14.9 (~175); H21b 348 noted at the booth | **H4.1-H4.16: 355 unnoted at the S07 trees**; H14 ~16 + H14.1-H14.13 (~184) | bones-placement.md: the bones ride the S07 knife loop at ~0.23-0.31 ticks each against 2.07 at the booth; stun-pack.md: ~200 fit the stuns |
| H21b | 348 noted dragon bones | **retired** | as above |
| H4.x (new) | - | the S07 bone giver, Ashburn (rs/117), 23 per load, re-requests on a refusal | its request lands on a roll label (bones-placement.md section 3) |
| H4m.x (new) | - | the trade giver at the zoo iron, ~85 babydragon in 4 loads for the S09 `stay2` lap | the 21:20 UTC stock overflows S07's ~978 by ~85 (RUN-ORDER.md section 7) |
| H7 | 11 dragon bones, 2 prayer potions | neither | Prayer ~94 from S07 |
| H14 | sharks 20; 500 + 500 Charge runes; adamant-cap stacks (headless 4,245, adamant 3,735) in one load | load 0 per stun-pack.md section 6: sharks 2, headless 4,410, bronze-mithril (mithril 1,485), ~16 bones; adamant 2,070 and rune 570 ride two top-ups | stun-pack.md: carrying every tier cost bone slots; the arrowtip holdings (rs/41, 10:50) |
| H14.x | ~9 top-ups of ~21 bones in success windows, by the giver | 12-13 top-ups, **requested by SCORED at stun offset +2**, sized at request time; the giver within 3 tiles | stun-pack.md section 5: inside a stun a top-up costs ~0.1-0.3, after a success 6-16 |
| H1 | first ring load (sapphire 12, emerald 9) | no rings | the starter kit leaves ~10 free slots |
| H3 | two ring loads | three loads of 20 | the rings H1 no longer carries |
| H11 | rune scimitar; glory; Ardougne runes 1 cast | **mithril scimitar**; no glory; Ardougne runes 2 casts | rune scimitar and glory unobtainable (rs/123, rs/124); T14-15 is now an Ardougne teleport |
| H11r | at the Edgeville glory landing | **at the Ardougne landing**, during T14-15 | no glory (run-transitions.md section 2) |
| H13 | shark 12 for S17 | moved to H23 | S17 is now the last step, after S27 (run-transitions.md section 4) |
| H16 | Camelot runes, rod, bait, carp | + Ardougne runes 1 cast, 30 coins (the Brimhaven ship), Lumbridge runes 1 cast | T20-21 by ship, T21-22 by Lumbridge teleport (run-transitions.md section 6) |
| H17 | givers by glory to Karamja (~110-tick round trip) | givers by the Brimhaven ship (~160 each way); the **talisman keeper** | no glory; nature talismans close to unobtainable (supply-fallbacks.md section 7) |
| H18, H19 | no runes | Lumbridge runes 1 cast; Falador runes 1 cast | T22-23 and T23-24 are teleports (run-transitions.md section 2) |
| H20 | at the Draynor glory landing; glory recharge; Romeo and Juliet's list to be written | **at the Rusty Anchor**; no glory; **cadava berries 1** | no glory; R&J's one item, read from `apothecary.rs2` |
| H21c | 450-520 target | **520 held** | rs/118 |
| H21d | all diamonds cut standalone | 107 cut in the wine windows; SCORED enters relog 1 with at most 27 items | wine-window.md section 5 B |
| H22 | coins 12,000; rune helm, chainbody, platelegs; glory | coins ~126,000 (Scavvo); adamant full helm; no glory; Ardougne runes 1 cast | rune armour unobtainable except Scavvo's chain and legs (supply-fallbacks.md section 12) |
| H23 | rune knives 760; glory; cannonballs 1,300 | no knives (the bow and SCORED's 570 rune arrows); no glory; ~1,100 balls (1,300 target); shark 12 for S17 | rs/124; S17 last |
| Cannonballs | 1,400 | at least ~1,170 (a start condition), 1,400 target | supply-fallbacks.md section 9; main's policy |
| Readiness | "every line in section 2 complete"; 555 dragon bones | main's adopted policy: two hard conditions, the rune axe and the budget | supply-fallbacks.md; main 09:30 |
