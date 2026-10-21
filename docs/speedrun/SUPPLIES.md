# Supplies manifest for the scored run

Every item a helper hands to SCORED (the brand-new scored account), by hand-off, in run order. The
step IDs and the order are [RUN-ORDER.md](RUN-ORDER.md)'s, aligned with
[STEP-MANIFEST.md](STEP-MANIFEST.md). This page is for the helper swarm (cairn://p/rs/41); the rs/103
coordinator sends it there. Issue: cairn://p/rs/109.

Built from every skill document's "Helper supply list" section (`docs/speedrun/skills/*.md`, section 7;
`combat.md` section 6), the quests' helper-trade column ([quests/README.md](quests/README.md) section
4) and the helper documents on cairn://p/rs/41/1/coordinator (`HELPERS.md`, `helpers/*.md`). Where
the documents disagree, section 4 says which count this page took.

## How hand-offs work

- **Two hosts.** The helpers whose timing must be tick-exact beside SCORED run on the **Ashburn run
  machine through the launcher cairn://p/rs/117** (under rs/41): a loopback gateway, lite runners with
  the #78 relay fix, logged in before SCORED's first login and staying in through its planned relogs,
  clean logout, independent of `fleetctl`, documented in HELPERS.md. They are the altar givers of the
  7-tick Runecraft cycle (S06, S21), the **trade giver** that serves SCORED's hand-offs, and the wine
  giver (S25c), which is the same account as the trade giver (main, 06:12). The altar givers follow
  rs/117's cue contract (cairn://p/rs/97/messages, 04:59). **Everything else stays on the bbs fleet**:
  it gathers, crafts and buys, and couriers stock to the trade giver ahead of each hand-off
  (helper-to-helper trades cost SCORED nothing). The giver column below says "Ashburn (rs/117)" or
  "bbs fleet" for each hand-off. rs/117 sizes the trade-giver pool; two accounts cover back-to-back
  hand-offs such as H11r then H12.
- **Roles.** The bbs roles that exist are in `HELPERS.md` (woodcutter, bars, essence, wine, bones,
  mule, coins and buyer, bidder); the ones planned without an owner yet are the fletcher-supplier, herb
  gatherer, gem supplier, rune and jewellery buyer, combat-supply buyer and quest-item gatherer
  (`HELPERS.md`, "Planned without an owner"). The "cannon helper" is a helper that has itself completed
  Dwarf Cannon (only such a player can buy the cannon or make cannonballs, `dwarf_cannon.md`; the ammo
  mould is untradeable).
- **The giver stands adjacent and requests first.** SCORED's receiver accepts only when the offer
  matches and its own offer is empty (`speedrun/lib/trade.ts`), so SCORED never gives in the same trade.
  Receiver cost: 4 ticks for one noted stack, 8 for 23 stacks (measured, `speedrun/README.md`). A
  return of items (H11r, products in S25) is a separate trade with SCORED as the giver.
- **Noted where possible.** Notes take one slot. Items SCORED must use from the inventory are unnoted
  (rings, bones buried on the spot, essence, bars at the anvil, logs on the line). Noted stacks go into
  SCORED's bank at Varrock west (S25); **never note unfermented wine into a helper's bank** (the bank
  stores deposited notes as fermenting wine, `helpers/wine.md`).
- **Staging and logout.** Almost every hand-off is staged while SCORED is logged in on an earlier step
  (free in parallel). If a hand-off is not staged when SCORED reaches the logout-safe boundary before it
  (RUN-ORDER.md section 4), SCORED logs out there and waits; each such pause costs ~3.6 ticks (2
  measured plus the relog tail), so it is the exception. S25's planned relog 1 doubles as its staging
  pause.
- **The run starts only when every line in section 2 is complete.** The run is about 35,000 ticks, about
  3 hours of wall time (35,000 x 0.3 s), so nothing can be gathered at helper rates while it runs.
- **Names.** No hand-off, cue file or log line in the repository names SCORED; rs/117's cue files carry
  its display name at runtime only and are gitignored.

Scarcity markers: **[scarce]** few or no sellers and slow sources; **[contested]** other players' bids
compete; **[unobtainable]** effectively no source; **[restricted]** tradeable but only a qualified
helper can obtain it; **[untradeable]** SCORED must get it itself in the quest.

## 1. Hand-offs

| ID | Step | Tile | When; SCORED logged out while staged? | Giver (host) | Items and counts |
|---|---|---|---|---|---|
| H1 | S01 | Lumbridge landing (3222,3222) | staged before S00; SCORED not yet in the world | trade giver, Ashburn (rs/117); stocked by the rune and jewellery buyer, bbs fleet | staff of water 1; cosmic rune 60 **[scarce]**; air rune 81; fire rune 80; earth rune 50; first ring load, unnoted: sapphire ring 12, emerald ring 9; air rune 4 and mind rune 4 (Wind Strike spares; the starter kit has both) |
| H2 | S03 | the Firemaking row beside the chicken coop (3233,3295) | dropped at least 100 ticks before SCORED reaches each log (a drop is private to the dropper for 100 ticks, then public); staged during S00-S02 | woodcutter, bbs fleet | 157 logs on the ground along the snake, one per tile, in order: logs 2, oak 4, willow 7, maple 13, yew 24, magic 107. Fallback: 6 trades of 27 unnoted by the trade giver (1: 2 + 4 oak + 7 willow + 13 maple + 1 yew; 2: 23 yew + 4 magic; 3-5: 27 magic; 6: 22 magic) |
| H3 | S04 | the row's end | during S03 | trade giver, Ashburn (rs/117) | two ring loads, unnoted: emerald ring 18 + ruby ring 3; ruby ring 13 + diamond ring 5 |
| H4 | S05 | Doric's house (2951,3451) | during S03-S04 | trade giver, Ashburn (rs/117); stocked by the quest-item gatherer | clay 6, copper ore 4, iron ore 2; Falador teleport runes for 3 casts (S05, T05-06, T06-07: 3 law, 9 air, 3 water); SCORED's air talisman 1; Woodcutting and Mining kits: rune axe 1, rune pickaxe 1, knife 1, normal logs 6 |
| H5 | S06 | air altar room, beside (2844,4832) | givers in the room and logged in before SCORED's first login; staged during S04-S05 | 7 altar givers, Ashburn (rs/117), following the cue contract | each giver: air talisman 1 + rune essence 27, unnoted (189 essence in all) |
| H6 | S08 | Plague City's start (after the Camelot teleport) | during S07 | trade giver, Ashburn (rs/117) | dwellberries, 4 buckets of water, spade, rope, chocolate dust, bucket of milk, snape grass (Plague City's list, quests/README.md step 2); Camelot runes 1 cast (1 law, 5 air); Ardougne runes 1 cast (2 law, 2 water) |
| H7 | S10a, S10b | maze entrance, Elkoy (2504,3191) | during S09 | trade giver, Ashburn (rs/117); bones from the bones role and the bidder, bbs fleet | **the pre-MM trade**: logs 6; dragon bones 11, unnoted **[scarce]**; staff of fire 1; amulet of magic 1; prayer potion(4) 2; antipoison(4) 1; shark 2; fight runes: death rune 110, chaos rune 40, air rune 550 (Fire Blast for the warlord and Fight Arena, Fire Bolt for the demon; see section 4) |
| H8 | S11a, S11b | Gnome Stronghold, by the course | during S10b | trade giver, Ashburn (rs/117) | agility potion(4) 1; Varrock runes 1 cast (1 law, 3 air, 1 fire); Ardougne runes 2 casts (4 law, 4 water) |
| H9 | S12 | Ardougne landing (2661,3301) | during S11b | trade giver, Ashburn (rs/117) | coins 5; Ardougne runes 1 cast; shark 3 (insurance: prayer makes food unnecessary, quests/README.md step 5) |
| H10 | S13 | Ardougne landing | during S12 | trade giver, Ashburn (rs/117) | Ardougne runes 2 casts and Falador runes 1 cast (dwarf_cannon.md) |
| H11 | S14 | Commander Lawgof (2571,3463) or the Ardougne lever (2561,3311) | during S13 | cannon helper **[restricted]**, bbs fleet (not tick-exact) | dwarf multicannon set (base, stand, barrels, furnace) 1; cannonballs 100; rune scimitar 1; Ardougne runes 1 cast; amulet of glory (charged, 4) 1; shark 2. The H7 antipoison is already held |
| H11r | after S14 | Edgeville glory landing (3087,3496) | right after the exit | cannon helper (receives), bbs fleet | SCORED gives back the cannon set and the leftover cannonballs (keeps the scimitar) |
| H12 | S15 | the Grand Tree, King Narnode | during S14 | trade giver, Ashburn (rs/117) | gold bar 1, ball of wool 1, monkey bones 1, bananas 5; magic shortbow 1 + rune arrows 100; prayer potion(4) 6; shark 15; antipoison(4) 1 (the second); Varrock runes 1 cast; Ardougne runes 2 casts |
| H13 | S16, S17 | Ardougne landing, before the lever | during S15 | trade giver, Ashburn (rs/117); stocked by the rune and combat-supply buyers | blood rune 70 + air rune 400 (Kolodion; the staff of fire covers fire); magic potion 1 (insurance only); prayer potion(4) 2; Ardougne runes 2 casts (S16 in, T17-18 out); shark 12 (for S17). SCORED's knife (from H4) cuts the webs |
| H14 | S18 | East Ardougne market, beside the knights (~2655,3305) | during S17 | trade giver, Ashburn (rs/117) (its timing inside the stun windows is tick-exact); stocked by the bones role and the fletcher-supplier | shark 20; first bone load 21, unnoted; Charge runes: blood rune 500 + air rune 500 (if the Charge stays in the stuns); Fletching stacks (adamant-cap list, section 2): headless arrow 4,245, bronze arrowheads 60, iron 90, steel 135, mithril 225, adamant 3,735 |
| H14.1-H14.9 | S18 | beside the knights, between stuns | as SCORED's bones run out, about every 12 stuns | trade giver, Ashburn (rs/117) | dragon bones, unnoted, ~21 per load (175 more, 196 in the stuns in all) **[scarce]** |
| H15 | S19 | Witchaven / Ardougne landing | during S18 | trade giver, Ashburn (rs/117) | swamp paste 1, unlit torch 1; Ardougne runes 1 cast |
| H16 | S20 | Hemenster, before the contest | during S19 | carp helper, bbs fleet, handing to the trade giver, Ashburn (rs/117) | raw giant carp 1 (the carp helper leaves the contest before its third catch, fishing_contest.md); fishing rod 1; fishing bait 1; coins 5; Camelot runes 3 casts (3 law, 15 air) |
| H17 | S21 | nature altar room, beside (2400,4839) | **a continuous roster**, staged during S18-S20 and running through S21; SCORED stays logged in | N altar givers, Ashburn (rs/117), N from rs/117's measured restock round trip; essence mined on bbs and couriered | each delivery: nature talisman 1 (the giver's own) + rune essence 27, unnoted; 161 deliveries, **4,347 essence** **[contested on the GE; gather]**. SCORED's own nature talisman 1 at the ruins (2868,3018). See the roster note below |
| H18 | S22 | Lumbridge river (3241,3248) | during S21 | trade giver, Ashburn (rs/117) | fly fishing rod 1; feather 580 (SCORED already holds the knife and a log) |
| H19 | S23 | Lumbridge castle kitchen (3209,3215) | during S22 | trade giver, Ashburn (rs/117) | egg 1, bucket of milk 1, pot of flour 1 |
| H20 | S24 | Draynor glory landing, then the chain | during S23 | trade giver, Ashburn (rs/117); stocked by the quest-item gatherer | goblin mail 3, orange dye 1, blue dye 1 (Goblin Diplomacy); raw rat meat, raw bear meat, raw beef, raw chicken, 1 each (Druidic Ritual; the enchanted meats are **[untradeable]**, SCORED dips them); Romeo and Juliet's items (quest_points.md has no step list: **to be listed by the quest-item gatherer**); Falador runes 1 cast, Varrock runes 1 cast; a glory recharge if needed |
| H21a | S25a | Varrock west anvil (3188,3426) | staged before S25 | trade giver, Ashburn (rs/117), at the anvil; bars from the bars role, bbs fleet | hammer 1; then 31 trades of 24-25 unnoted bars, each taking the 5 platebodies back: bronze bar 15, iron 39, steel 120, mithril 305, adamantite 365 (including one spare inventory of the top three tiers) **[scarce: GE not viable]** |
| H21b | S25b | Varrock west booth | before S25 | trade giver, Ashburn (rs/117); bones from the bones role and the bidder, bbs fleet | dragon bones 348, **noted**, one stack; deposited once **[scarce]** |
| H21c | S25c | Varrock west booth | the giver is beside the booth, requesting, as planned relog 1 lands; SCORED logged out at relog 1 while anything for S25 is still being staged | wine giver = the trade giver, Ashburn (rs/117); wine made by the wine maker, bbs fleet | unfermented wine, **noted**, one slot: 520 target, 450 minimum **[contested: grapes]**. Fallback for the make arming only: grapes 1, jug of water 1 |
| H21d | S25d | Varrock west booth | before S25 | trade giver, Ashburn (rs/117); gems from the gem supplier, bbs fleet | chisel 1; uncut diamond 391, noted (364 + one spare inventory) |
| H21e | S25e | Varrock west booth | before S25 | trade giver, Ashburn (rs/117); herbs from the herb gatherer, bbs fleet | supply-safe list, noted: guam potion (unf) 41, irit potion (unf) 405, eye of newt 432 (27, 391, 418 plus one spare inventory of 14 each); vials come inside the unfinished potions |
| H22 | S26 | Champions' Guild door (3191,3363) | during S25 | trade giver, Ashburn (rs/117); stocked by the quest-item gatherer and the combat-supply buyer | coins 12,000; wizard's mind bomb 1, silk 1, lobster pot 1, unfired bowl 1, plank 3, steel nails 12 (the hammer from H21a is held); rune full helm 1, rune chainbody 1, rune platelegs 1, amulet of strength 1; shark 10; Varrock, Lumbridge and Falador runes 1 cast each. The anti-dragon shield and the map pieces come from the quest itself **[untradeable]** |
| H23 | S27 | poison spiders (3288,3810), or Edgeville before the walk | during S26 | cannon helper, bbs fleet, with the trade giver, Ashburn (rs/117), for the kit | dwarf multicannon set 1 (the one from H11r); cannonballs 1,300; rune knife 760; ranging potion(4) 3 (9 doses); super antipoison(4) 1 (3 doses) + 1 spare; super attack(4) 1; super strength(4) 1; amulet of glory (charged) 1 for the kit |

Lookouts (bbs fleet, no items): one helper at each Wilderness stretch (S14, S16-S17, S27) and at the
zoo iron and the Taverley oaks before S09 and S07, reporting players in view (RUN-ORDER.md R8, R9).

**The nature altar roster (H17).** `runecraft.md` plans batches: N givers stand in the room, SCORED
logs in, takes N trades and logs out while they restock. With 20 givers that is ~9 batches and ~8
extra relogs, which main's two-relog rule allows only where each pays. A roster needs none: a giver
that has traded teleports out, banks, takes 27 essence and walks back in (glory to Karamja and ~80-90
ticks of walking each way, `runecraft.md` section 6), roughly 110 or more ticks per round trip
(inferred). At one delivery per 7 ticks that needs about 110 / 7 = 16 givers cycling, more if the
round trip is slower on the demo. **N is rs/117's to set from its measured round trip** (RUN-ORDER.md
O7). The givers must not log out and back in during S21: a giver that logs in after SCORED drops to the
robust 8-tick schedule for its own trades. Logging SCORED out while givers restock is the fallback,
used only when it pays (~3.6 ticks per relog against every logged-in wait).

## 2. Stockpile totals across the run

| Item | Total | Hand-offs | Source of the count | Scarcity |
|---|---|---|---|---|
| Dragon bones | **555** (11 unnoted + 196 unnoted in ~10 loads + 348 noted) | H7, H14, H14.x, H21b | `prayer.md` section 7; split by `interleaving.md` section 8 | **[scarce]**: GE dry since 08:57 UTC, 0 held at 10:50 UTC (cairn://p/rs/41 comment 16). Floor: 673 big bones banked (`helpers/bones.md`) |
| Unfermented wine, noted | **520** target, 450 minimum | H21c | `helpers/wine.md` (29 + 491, P(99) 99.83%; 29 + 421, 99.06%) | **[contested]**: grapes 423 of 520 held at 10:50 UTC |
| Rune essence | **4,536** (189 + 4,347) | H5, H17 | `runecraft.md` section 7 | **[contested]** on the GE; gathered (~1,000 per account-hour, `helpers/essence.md`) |
| Logs for Firemaking | 157: logs 2, oak 4, willow 7, maple 13, yew 24, magic 107 | H2 | `firemaking.md` section 7 (exact) | magic logs from the woodcutter role |
| Normal logs, other | 12 (6 for Tree Gnome Village, 6 for the knife loops) | H4, H7 | `quests/README.md` step 3; `mining.md`, `woodcutting.md`, `fishing.md` section 7 | easy |
| Bars | bronze 15, iron 39, steel 120, mithril 305, adamantite 365 | H21a | `smithing.md` section 7 (+25 margin on steel, mithril, adamantite) | **[scarce]**: no GE sellers; smelter 10-20 bars per account-hour (`helpers/smelter.md`) |
| Uncut diamonds | 391 (364 + 27 spare) | H21d | `crafting.md` section 7, diamonds-only fallback | GE: 10 offered at 25,000; gem rocks and drops |
| Uncut dragonstones | 0 (the 101-tick list needs 277) | - | `crafting.md` section 7 | **[unobtainable]**: crystal chest only |
| Herblore, supply-safe | guam (unf) 41, irit (unf) 405, eye of newt 432 | H21e | `herblore.md` section 7 | easy (Port Sarim magic shop for eye of newt) |
| Herblore, ranging-cap list (best case only) | harralander (unf) 1 + chocolate dust 1, ranarr (unf) 8, irit (unf) 10 + eye of newt 10, kwuarm (unf) 17 + limpwurt 17, cadantine (unf) 14, white berries 22, dwarf weed (unf) 208 + wine of Zamorak 208, vials 258 | H21e (alternative) | `herblore.md` section 7 | **[scarce]** white berries; **[contested]** dwarf weed; wine of Zamorak one spawn; torstol **[unobtainable]** |
| Fletching, adamant-cap list | headless arrow 4,245; arrowheads: bronze 60, iron 90, steel 135, mithril 225, adamant 3,735 | H14 | `fletching.md` section 7 | adamant: shops 200 + 200, restocking; or a Smithing-75 helper |
| Fletching, rune list (only if rune arrowheads are cheap) | headless 3,600; bronze 60, iron 90, steel 135, mithril 225, adamant 495, rune 2,595 | H14 (alternative) | `fletching.md` section 7 | rune arrowheads **[scarce]**: shops cover about a tenth |
| Feathers | 580 to SCORED; ~4,245 inside the headless arrows (helper side) | H18; H14 | `skills/README.md` Fishing row (~520 from 78) + 60 spare | easy (the fleet held 9,785 at 23:12 on 2026-10-20) |
| Rings | sapphire 12, emerald 27, ruby 16, diamond 5 (unnoted) | H1, H3 | `magic.md` section 7 | helper Crafting or the GE |
| Cosmic rune | 60 | H1 | `magic.md` section 7 | **[scarce]**: no sellers; the only shop is in the Wilderness, stock 20 (`helpers/market.md`) |
| Blood rune | 570 (70 Kolodion + 500 Charge) | H13, H14 | `magic.md` section 7; quests/README.md step 9 | Magic Guild shop |
| Death rune, chaos rune | 110, 40 | H7 | section 4 | Magic Guild; GE |
| Air rune | ~1,650 (enchants 81, fights 550, Kolodion 400, Charge 500, teleports ~100, Wind Strike 4, spares) | H1, H4, H6-H8, H13, H14, H16, H20, H22 | sum of the hand-offs | easy; S06's own air runes can cover part |
| Law rune | ~50 (about 40 casts' worth: 12 Ardougne x 2, 6 Falador, 4 Camelot, 4 Varrock, 2 Lumbridge, plus spares) | per hand-off | count of the run's teleports (RUN-ORDER.md) | rune shops |
| Water rune | ~30 (Ardougne 2 per cast, Falador 1); fire rune 80 + ~5; earth rune 50 + ~2; mind rune 4 | per hand-off | as above; `magic.md` | easy |
| Staves and amulets | staff of water 1, staff of fire 1, amulet of magic 1, amulet of strength 1, amulet of glory (charged) 2 | H1, H7, H11, H22, H23 | `magic.md`; quests/README.md steps 3, 13, 14 | Zaff, Magic Guild, GE |
| Sharks | ~64 (TGV 2, FA 3, cannon 2, MM 15, Agility 12, Thieving 20, Dragon Slayer 10); stock 70 | H7, H9, H11-H14, H22 | quests/README.md steps 3, 5, 8, 13; `agility.md`, `thieving.md` section 7 | GE ~900 gp (cairn://p/rs/41 comment 14) |
| Prayer potion(4) | 10 (2 + 6 + 2) | H7, H12, H13 | quests/README.md steps 3, 8, 9 (upper ends) | helper Herblore or GE |
| Antipoison(4) | 2 | H7, H12 | quests/README.md steps 3, 8 | helper Herblore or GE |
| Agility potion(4), magic potion | 1, 1 | H8, H13 | `agility.md`, `magic.md` section 7 | magic potion: helper Herblore 76 or GE (no shop) |
| Combat kit potions | ranging potion(4) 3, super antipoison(4) 2, super attack(4) 1, super strength(4) 1 | H23 | `ranged.md` section 7 (9, 3, 1 and 1 doses) | helper Herblore or GE |
| Cannonballs | 1,400 (100 for S14, 1,300 for S27) | H11, H23 | `ranged.md` section 7 (~1,000-1,300 with the kit over ~1,970 cannon ticks) + 100 margin | **[restricted]**: cannon helper (Smithing 35 with the mould, or Nulodion's shop) |
| Dwarf multicannon set | 1 (+1 spare against a Wilderness death) | H11, H23 | `ranged.md` section 7 | **[restricted]**: cannon helper buys from Nulodion, 750,000 coins |
| Rune knives | 760 (+40 spare) | H23 | `ranged.md` section 7 | Smithing/Fletching helper or GE |
| Gear and tools | rune axe, rune pickaxe, knife, rune scimitar, magic shortbow + 100 rune arrows, rune full helm, chainbody and platelegs, fly fishing rod, fishing rod + 1 bait, chisel, hammer | H4, H11, H12, H16, H18, H21, H22 | skill and quest lists | GE or shops |
| Talismans | air: 1 + 7 givers'; nature: 1 + each of the N rotating givers' | H4, H5, H17 | `runecraft.md` section 7 | nature talisman from the rare drop table or the GE |
| Quest items | Doric's, Plague City's, Monkey Madness's, Sea Slug's, Fishing Contest's carp, Cook's Assistant's, the filler's, Dragon Slayer's (H4, H6, H12, H15, H16, H19, H20, H22) | per hand-off | quests/README.md section 4 | Romeo and Juliet's list is still to be written |
| Coins | 12,010 (Dragon Slayer 12,000, Fight Arena 5, Fishing Contest 5) | H9, H16, H22 | quests/README.md steps 5, 11, 13 | coin earners |

## 3. Untradeable and restricted items on the route

- **Untradeable, SCORED gets them itself:** Druidic Ritual's enchanted meats (it dips the four raw meats
  helpers supply); Dragon Slayer's map pieces, Crandor map and maze keys (`tradeable=no`), and its
  anti-dragon shield from the Duke; the Mage Arena's god staff and cape (not needed); Monkey Madness's
  quest-made items (the enchanted bar, the gree-gree, the sigil). None of these is on a helper's list.
- **Restricted:** the cannon set and cannonballs (only a helper that completed Dwarf Cannon can buy or
  make them; the ammo mould is untradeable, `dwarf_cannon.md`).
- **Never trade notes of unfermented wine into a bank** on the helper side (they ferment there).
- Off the route, for the record: the law talisman (Troll Stronghold only) and the lava eel (Heroes'
  Quest) are untradeable, which is why neither route uses them.

## 4. Where the documents disagree, and which count this page took

| Item | Counts in the documents | Taken | Why |
|---|---|---|---|
| Dragon bones | ~400 (cairn://p/rs/41's first-pass list, which assumed Holy Grail); 555 (`prayer.md`) | 555 | Holy Grail is off the route (quests/README.md decision 2) |
| Rune essence | ~4,200 (rs/41 first pass, law altar); 4,536 (`runecraft.md`) | 4,536 | the route is air then nature; law needs Troll Stronghold on every giver |
| Wine | 450 + 1 grapes + 1 jug (`cooking.md`, one-login variant); 457 (`cooking.md`, two-login); 450-520 (`helpers/wine.md`) | 520 target, 450 minimum, no grapes or jug except the fallback | `helpers/wine.md` is the later, demo-measured design: the two-relog split (29 + rest) is main's decision |
| Cannonballs | ~1,500 (rs/41 first pass); ~2,300 or ~1,500 (rs/31's per-plan table in `ranged.md`); ~1,000-1,300 with the kit (`ranged.md` section 7) | 1,400 | the kit line is the route's; +100 margin, and its total already includes the pre-MM session |
| Fight runes before Monkey Madness | ~200 chaos + 600 air (Fire Bolt) and ~40 death + 160 air (Fight Arena) (`pre_mm_fights.md` via `magic.md`); flagged too high by rs/81: at the 5-tick spell delay a fight of T ticks fits at most ~T/5 casts (quests/README.md step 3) | death 110, chaos 40, air 550 | T/5 upper bounds: warlord 133/5 = ~27 Fire Blast (1 death, 4 air each), demon 153/5 = ~31 Fire Bolt (1 chaos, 3 air), Fight Arena 281/5 = ~56 Fire Blast; that is ~83 death, ~31 chaos, ~425 air, plus ~25-30% margin until a run logs actual casts |
| Charge runes | ~490 blood + 490 air for 156-163 casts (`magic.md`); ~500 + ~500 for ~165 (quests/README.md step 9) | 500 + 500 | the larger, 3 of each per cast |
| Feathers for Fishing | ~700 from 20 and ~320 from 90 (`fishing.md`); ~520 from 78 (`skills/README.md`) | 580 | the README row is the route's start level; +60 spare |
| Smithing bars | exact list plus "one inventory per tier" margin (`smithing.md`) | the list + 25 on steel, mithril, adamantite | the document's own margin |
| Herblore lines | full list (175 torstol), ranging cap, supply-safe (`herblore.md`) | supply-safe for the stockpile; ranging cap only if every line fills | torstol is unobtainable and wine of Zamorak has one spawn |
| Crafting gems | 277 dragonstones + 10 diamonds + 1 ruby (`crafting.md`) | 364 diamonds + 27 spare | dragonstones are unobtainable |
| Fletching | rune list (2,595 rune arrowheads) or adamant-cap (`fletching.md`) | adamant-cap | rune arrowheads are scarce; the cap costs ~7 standalone ticks, less in stuns |
| Sharks for Agility | ~10-12 (`agility.md`) | 12 | upper end |
| Prayer potions | 2 (TGV), 4-6 (MM), 1-2 (Mage Arena) (quests/README.md steps 3, 8, 9) | 2, 6, 2 | upper ends; the prayer re-toggle makes most of them insurance |
| Ring loads | "one trade covers the ladder, rings noted" (`magic.md`, with a bank) | three unnoted loads (H1, H3) | S04 runs at the Firemaking row's end with no bank (RUN-ORDER.md S04) |
| Runecraft deliveries | batches of ~20 givers with SCORED logging out between them (`runecraft.md` section 7) | a continuous roster of N givers on the run machine | main's two-relog rule and the tuned cycle's need for givers ahead of SCORED in the player loop (RUN-ORDER.md R12) |

## 5. Readiness checklist before the first login

1. Every total in section 2 is held, with the scarce lines first: 555 dragon bones, 450-520 noted wines,
   774 bars plus margin, 4,536 essence, 391 diamonds, the supply-safe herbs, the adamant-cap Fletching
   stacks, 60 cosmic runes, 1,400 cannonballs and two cannon sets.
2. rs/117's helpers on the run machine (the trade giver pool, the 7 air altar givers, the N nature
   altar givers) are logged in, before SCORED.
3. H1-H5 are staged (H1 at the landing tile, H2's row dropped and past its reveal, H4 at Doric's, H5's
   seven givers in the air altar room or ready to enter).
4. The H17 roster is staffed and rehearsed, or the logout fallback is agreed.
5. A lookout helper is assigned to each Wilderness stretch (S14, S16-S17, S27) and to the zoo and
   Taverley sites before S09 and S07.
