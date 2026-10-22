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
  "cannon helper" is a helper that has completed Dwarf Cannon (cairn://p/rs/125's cairn_h92, which holds two
  sets and 1,416 balls): only such a player can buy the cannon from Nulodion or make
  cannonballs, and the ammo mould is untradeable (`dwarf_cannon.md`; supply-fallbacks.md section 9).
- **The giver stands adjacent and requests first.** SCORED's receiver accepts only when the offer
  matches and its own offer is empty (`speedrun/lib/trade.ts`). **Receiver cost, measured on a second
  host at all four staging tiles: 4 ticks for one noted stack, 8 for 23 stacks, 12 of 12 each**
  (run-transitions.md section 3). The exceptions are S18's top-ups, which SCORED requests itself at stun
  offset +2 (stun-pack.md section 5), and the S07 bone loads, which the giver requests while SCORED
  holds 2 bones. A return of items (H11r, products in S25) is a separate trade with SCORED as the giver
  (6 to 10 ticks on the giver's side).
- **A busy partner's retry.** A trade request that meets a busy partner (a level-up dialog, say)
  goes unanswered and is re-sent: after 8 s, **~27 ticks a retry, on today's run commit**, and on the
  second frame, **~2 ticks a retry, once 3042ae95's change reaches main** (rs/267's `lib/trade.ts` `openTrade`, a net patch on rs/41's mission branch, no PR yet; m,
  lab; a demo figure follows with rs/196's demo or rs/267's next slot). No hand-off row here prices a
  retry at ~27; the S07 and S18 givers re-request on their own schedules (H4.1-H4.n, H14.x).
- **The trade giver's timed re-request** (`mule.ts` `preRequest()`, every 15 s of wall clock, no check for an open trade) can close a hand-off it lands on (rs/285). The window is narrow, well under 5% a hand-off, and a hit costs one restarted hand-off, ~4-8 ticks, with nothing lost (e, rs/41's reading of `mule.ts:600-761`; at most ~10 over the run, a RUN-ORDER.md sensitivity, R25). rs/267 moves it onto `decideRequest` in game ticks, via rs/41's branch (commit pending); it must be on the helpers' deployed commit before the giver serves SCORED.
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
| H2 | S03 | the Firemaking row beside the chicken coop (3233,3295) | dropped at least 100 ticks before SCORED reaches each log (a drop is private to the dropper for 100 ticks, then public); staged before the run login | woodcutter, bbs fleet | **The droppers are in the world before the cue and use `cueAt: 'seen'`** until rs/41's child measures the observed tick period (`cueAt: 'written'` converts wall time at 300 ms and starts early on a slow demo; RUN-ORDER.md R23); demo: six droppers at 2 logins per host carried S03 to 681 m (rs/269). 157 logs on the ground along the snake, one per tile, in order: logs 2, oak 4, willow 7, maple 13, yew 24, magic 107. Fallback: **8 refills of 20** unnoted by the trade giver, because S03 starts holding 8 non-log items (rs/245; `firemaking.ts` `tradePlan`): 1: 2 logs + 4 oak + 7 willow + 7 maple; 2: 6 maple + 14 yew; 3: 10 yew + 10 magic; 4-7: 20 magic each; 8: 17 magic. Each trade is 4 ticks when the giver requests on the last held log's roll, ~719 in all (717 and 709 m). **Helper terms:** the giver's tile must be reachable from SCORED's on the collision map (a wall edge at the lab snake's west end failed a trade), and the giver must not request early (a request is a player op and walks it off its tile). The 6 trades of 27 before assumed an empty pack |
| H3 | S04 | the row's end | during S03 | trade giver, Ashburn (rs/117) | three ring loads of 20, unnoted: sapphire ring 12 + emerald ring 8; emerald ring 19 + ruby ring 1; ruby ring 15 + diamond ring 5 (cairn_h80 holds exactly the run's 12 / 27 / 16 / 5, rs/41). SCORED keeps the last load's 20 enchanted (`handBack: 'keep'`, rs/285) and gives them back at H4 |
| H4 | S05 | Doric's house (2951,3451) | during S03-S04; **staging precondition: the H4 package is the giver's entire inventory when it trades** (a staging rule in the run-machine package config, owned by rs/267) | trade giver, Ashburn (rs/117); stocked by the quest-item gatherer | clay 6, copper ore 4, iron ore 2; Falador teleport runes for 3 casts (T04-05, T05-06, T06-07: 3 law, 9 air, 3 water); SCORED's air talisman 1; Woodcutting and Mining kits: **rune axe 1** (budget item, section 5), rune pickaxe 1, knife 1, normal logs 6. **SCORED gives back the 20 enchanted rings from S04** in the same trade, a `swap()` in the same trade (`lib/trade.ts`, on main, #230; `trade.rs2:161-190` counts offered items as freed, so no extra slots): SCORED's half is rs/185's S05 module, `dorics-quest.ts`, using magic.ts's `enchantedRingSpecs(state)`; the trade giver's half already exists, HS1's `giveOpenTrade` (`speedrun/helpers/mule.ts:345-376`), which calls `lib/trade.ts` `give()` with `expectTheirs: ANY_OFFER` and re-accepts after SCORED's offer resets both accepts (`mule.test.ts:128` tests the two-way swap; rs/41). Fallback: a give-only trade at Doric's with the same giver, +4-8 (a sensitivity) (RUN-ORDER.md sensitivity); the swap costs 0 (6 ticks with the rings and 6 without, m, rs/285). **Slots:** H4 needs 23 free slots (22 unstackables and the new law stack); SCORED arrives with them only after dropping the 2 body runes with the starter junk on T01-02 and the 11 mind runes on T02-03 after S02 (rs/158's rule), 1 to spare |
| **H4.1-H4.n** | S07 (S25b's bones) | the oak tile (2914,3494), giver on (2913,3494); later the willow tile (2920,3406), giver on (2920,3407) | the first load before S07 reaches the oaks, then whenever SCORED holds 2 bones (about every 70 ticks at 0.329 bones per tick) | **four bone givers alternating, cairn_b01-b04, Ashburn (rs/117, rs/141's `bone-giver.ts`)**, logged in before SCORED, each **running** Falador west to the trees and back between its loads. The round trip on the demo, Falador west bank to the giver tile and back with a bank visit, is **199-215 ticks at the oaks (mean 205, n = 9) and 178-193 at the willows**, running; walking only it is 321-328; run energy did not drain (m, demo, rs/163, 14:45 PDT). That is the engine's infinite run: `NODE_INFINITE_RUN` defaults to true (`server/engine/src/util/Environment.ts:47`), `Player.ts` `updateEnergy()` pins run energy at 10,000, and the demo's `fly.toml` does not override it (r; on the demo by inference), so the trips are path-bound, not energy-bound, and no energy potion is needed anywhere in this manifest (STEP-MANIFEST.md entry 11). At one load per ~70 ticks, three givers leave each ~210 ticks a trip, no margin against 215, so rs/41 adds the fourth, **cairn_b04** (four leave ~280). Walking would need five. (rs/141's lab round trip was 158-161 at the oaks and 149-152 at the willows, ~160-170 with the bank.) bones from the bones role and the bidder, bbs fleet | **bones, unnoted, 23 per load (any type)**. n is S07's non-stun bones / 23: with every line held, **355 dragon bones, n = 16** (15 loads of 23 and one of 10); on the 21:20 UTC stock, **~978 bones, n = ceil(978 / 23) = 43** (42 loads of 23 and one of 12): the **49 dragon bones first** (loads 1 and 2, and 3 in load 3), then **929 babydragon**. Alternating, cairn_b01, b02 and b03 give 11 loads each (b01 loads 1, 5, ... 41; b03 loads 3, 7, ... 43) and cairn_b04 10. The 24 dragon bones held on the GE bidder h61 are collected and banked with the givers' stock before the start. The ~85 babydragon past S07 go to the S09 `stay2` lap in H4m.1-H4m.4 (`knife-mine`'s bury, on main, #159), or to the booth (H21b) only if that bury cannot fire (RUN-ORDER.md section 7) **[scarce]**. **On the forecast at 2026-10-23** (RUN-ORDER.md's row in force; ~413 dragon assumed, 341 babydragon): 554 non-stun bones, n = ceil(554 / 23) = **25** (24 loads of 23 and one of 2), the dragon bones first; H4m and the booth carry none. The giver keeps a request standing and re-sends on the tick after a "busy" refusal; refusals cost SCORED 0, a load 4 ticks (the first 5) (m, lab, cairn://p/rs/141) |
| H5 | S06 | air altar room, beside (2844,4832) | givers in the room and logged in before SCORED's run login; staged during S04-S05 | 7 altar givers, Ashburn (rs/117), following the cue contract | each giver: air talisman 1 + rune essence 27, unnoted (189 essence in all) |
| H6 | S08 | Plague City's start (after the Camelot teleport) | during S07 | trade giver, Ashburn (rs/117) | dwellberries, 4 buckets of water, spade, rope, chocolate dust, bucket of milk, snape grass (quests/README.md step 2); Camelot runes 1 cast (1 law, 5 air); Ardougne runes 1 cast (2 law, 2 water) |
| **H4m.1-H4m.4** (new) | S09 (the Mining `stay2` lap's bones; only on a stock that overflows S07, such as 21:20 UTC's) | the zoo iron cluster, on a free tile beside the lap's east stay (2605,3234), off its standing tiles | the first load as SCORED reaches the cluster after T08-09, then whenever SCORED holds 2 bones (about every 330 ticks at one bone per 15-tick lap) | trade giver, Ashburn (rs/117), with rs/141's `bone-giver.ts` request (a standing request, re-sent the tick after a refusal); it is in Ardougne already for H6 and stages H7 after the last load. The S07 bone givers stay on the Taverley route | **babydragon bones, unnoted, ~85 in 4 loads (24, 24, 24, 13)**, 24 a load as bones-placement.md section 4 priced it, fewer if SCORED's free slots are fewer. `knife-mine`'s `stay2` bury is **on main** (#159, rs/182; lab: ~0.21 ticks a bone in trades, at most +0.02 a Mining ore, one bone per ~15 ticks, ~205 over S09), so these loads are today's conservative row (RUN-ORDER.md O35, closed). S09 runs `stay2` only while bones remain, ~5 ores a bone, and each lap switch waits out the 13-tick respawn plus a start (~+30 for the ~85, rs/207; STEP-MANIFEST.md entry 4). The bury fires only while iron respawns in 13 ticks or less and not under the plain technique; if it cannot, the giver keeps the undelivered loads for the Varrock west booth (H21b). Not needed on the forecast at 2026-10-23, whose bones all fit S07 |
| H7 | S10b | maze entrance, Elkoy (2504,3191) | during S09 | trade giver, Ashburn (rs/117) | **the pre-MM trade**: logs 6; staff of fire 1; amulet of magic 1; antipoison(4) 1; shark 2; fight runes: death rune 110, chaos rune 40, air rune 550 (section 4). No dragon bones and no prayer potions: Prayer is ~94 when S07 ends |
| H8 | **S11b only** | **the Grand Tree door (2465,3489)**, through S11b's `kitFrom` at its first segment | the giver stages there during S10b | trade giver, Ashburn (rs/117) | agility potion(4) 1 (S11b drinks it in the tick or two before segment M's climb, the quest's only Agility check; S11a drinks nothing: a boost falls one level per 100 ticks and the climb is ~1,100 ticks after S11a, RUN-ORDER.md S11b); Varrock runes 1 cast (1 law, 3 air, 1 fire); Ardougne runes 2 casts (4 law, 4 water). SCORED needs 9 free slots at segment L after these and the quest's items (STEP-MANIFEST.md entry 8) |
| H9 | S12 | the Ardougne teleport landing (spread (2659-2663, 3299-3303)); helper on (2658,3301), or (2659,3301) if blocked, one tile west on the legs' route, pending rs/198's two-bot lab check (`teleport.rs2`: a random walkable tile within Chebyshev 2 of (2661,3301) with line of walk) | during S11b | trade giver, Ashburn (rs/117) | coins 5; Ardougne runes 1 cast; shark 3 (insurance) |
| H10 | S13 | the Ardougne teleport landing, helper as H9 | during S12 | trade giver, Ashburn (rs/117) | Ardougne runes 2 casts and Falador runes 1 cast (dwarf_cannon.md); **shark 8** from helper stock (stock ~298; rs/41 confirms): main's rule of the measured damage x1.5 (mean 76 over rs/257's six real-level runs, 114 HP) gives 6, and rs/158 sets 8 for margin (the 143-damage run ate all 6). **Slot line: S13 needs 14 free slots after H10 when it starts, 17 if SCORED holds none of the water, air and law stacks** (rs/257: Lawgof adds 6 unstackable railings at the end of segment A); SCORED's S12 exit inventory is not measured yet (RUN-ORDER.md O46) |
| H11 | S14 | **the Ardougne teleport landing (spread (2659-2663, 3299-3303)); helper on (2658,3301), or (2659,3301) if blocked, one tile west on the legs' route, pending rs/198's two-bot lab check**, on T13-14 right after the teleport (no helper in the Wilderness) | during S13 | cannon helper **[restricted]** (rs/125; `cannon.ts` serve mode gives the set and balls in one trade, 4 ticks lab, 6 demo, rs/189; SCORED's side, `helpers/cannon-receiver.ts`, is called by `run.ts`, rs/186, not the Ranged module), **cairn_h92 in serve mode (rs/41)**, bbs fleet (not tick-exact), with the trade giver for the rest | dwarf multicannon set (base, stand, barrels, furnace) 1; cannonballs 100 (S14 used 65-72 through rs/199's module, ~70); **mithril scimitar 1** (the rune scimitar is unobtainable, rs/124; rs/41 bought it); Ardougne runes 2 casts (T13-14 and T14-15); shark 2. The H7 antipoison is already held |
| H11r | after S14 | **the Ardougne teleport landing (spread (2659-2663, 3299-3303)); helper on (2658,3301), or (2659,3301) if blocked, as H11**, during T14-15 (stays: SCORED does not carry the set on to S27) | right after the teleport | cannon helper (receives), cairn_h92 in serve mode (rs/41), bbs fleet | SCORED gives back the cannon set and the leftover cannonballs (keeps the scimitar) |
| H12 | S15 | the Grand Tree, King Narnode | during S14 | trade giver, Ashburn (rs/117) | **Superseded and provisional** (rs/201, m, lab, segments H to M played as a human at 42 HP and Defence 1, 3 chains each; relayed by rs/158): the kit as first written (prayer potion(4) 6, so only 5 sharks fit) **died in 3 of 3 chains**, each with all 24 potion doses unused; **2 prayer potions and 9 sharks survived 3 of 3**, ending on 0-2 sharks, using ~70 of the base 94 prayer points plus 4-5 doses and 1 antipoison drink. H12 is now: gold bar 1, ball of wool 1, monkey bones 1, bananas 5; magic shortbow 1 + rune arrows 100 (SCORED keeps the bow and what is left of the arrows for S27); **prayer potion(4) 2**; antipoison(4) 1 (the second); **shark: the freed slots, 9 at the floor, final count pending** rs/201's N-to-Q and demon (X) measurements (rs/185 reports end-of-chain shark counts through Q); over N to P the floor kit held, sharks 8 to 5-7 over N and O and 5-9 left at P's end, HP 21-24, prayer 44-46 with 5 of 8 doses left, P from a pinned start ending on 3-4 doses (m, rs/201), and the prayer potions stay at the floor until the demon's chains measure dose use at 300 ms, a third pre-approved if P after a rope pin fails (RUN-ORDER.md R5); **Varrock runes 2 casts, each 1 law, 3 air and 1 fire**: segment Y's own teleport plus one spare for a rope-pin escape (rs/185's module rule, 23:15 PDT: wait 50 ticks, then teleport). The staff of fire does not cover these: it is handed back at the Grand Tree. Ardougne runes 2 casts. **Kit rule (main, 20:33 PDT):** size H12 for 3 of 3 clean chains *with margin*, not for chains ending on 0-2 sharks; 2 prayer potions and 9 sharks is the floor. If the inventory cannot carry the margin, a higher Hitpoints or Defence level before MM is priced against the order (RUN-ORDER.md O43). **Inventory-census precondition: 2 free slots at segment J** for the dentures and the mould (a full pack gets nothing from the crates). The 15:29 PDT count stands as the slot budget: the unstackables come to ~30 slots even with the bow and arrows worn, before the earlier rune stacks, the items already held and the untradeable quest items picked up on the way. No helper can reach the hangar or the atoll (SCORED gets there only through Daero's blindfold, segment D), so H12 can be split or moved only at the Grand Tree during segment C or D, and nothing in A-G uses its items. rs/158's order of preference: (a) fewer sharks and doses if the lab shows them unused (free); (b) a two-way trade at C or D (`lib/trade.ts` `swap()`, on main, #230), SCORED handing back what S15 doesn't need in the same trade that delivers H12 (a few offer clicks, no bank trip); (c) a Grand Tree bank deposit last (a bank trip; priced only when rs/201's counts arrive). The gold bar is not made yet (cairn_h20 mines and smelts it); the wool and monkey bones come from rs/173's far set; `returnMonkey: 'glider'` would add 30 coins, only if the lab picks it (rs/41) |
| H13 | S16 | Ardougne landing, before the lever | during S15 | trade giver, Ashburn (rs/117); stocked by the rune and combat-supply buyers | blood rune 70 + air rune 400 (Kolodion; the staff of fire covers fire); magic potion 1 (insurance only); prayer potion(4) 2; Ardougne runes 2 casts (S16 in, T16-18 out). SCORED's knife (from H4) cuts the webs. S17's sharks moved to H23 |
| H14 | S18 (load 0) | East Ardougne market, beside the knights (~2655,3305); precondition for the top-ups that follow: the courier on a side tile of SCORED (H14.1-H14.13) | during S16 | trade giver, Ashburn (rs/117); stocked by the bones role and the fletcher-supplier | blood rune 500 + air rune 500 (Charge: 163 casts x 3 = 489 each, stun-pack.md section 6, plus margin); headless arrow 4,410; arrowheads bronze 60, iron 90, steel 135, mithril 1,485; shark 2; dragon bones ~16, unnoted (every free slot less one; any type, babydragon on the 21:20 UTC stock). The staff of fire stays wielded from H7 |
| H14.1-H14.13 | S18 | beside the knights; **the courier holds an orthogonally adjacent tile of SCORED at each due stun + 2**, never a diagonal corner and never 2-3 tiles away (rectangle reach, and a stunned SCORED cannot step round; m, lab, rs/279: ~0 a top-up with a side tile, about 1 in 3 lost from a corner or a gap). The fix is rs/267's, pending on the helpers' deployed commit (RUN-ORDER.md R24); one unexplained miss in 10 with a side tile, for which rs/290 builds an opt-in re-send at + 3 | about every 90-190 ticks; **SCORED requests** at stun offset +2 (or +4 if the giver is not adjacent), never on the tick after a bury, and sizes the load when it requests. **The trade must be done before the program restarts, by stun + 9 at the latest**: the in-page `pickpocket` program clicks the knight on every tick, stun ticks included, and a click closes an open trade, so the Thieving module stops the program for the top-up and restarts it after (rs/132, e5f83a36; a top-up stun buries nothing). The in-program top-up (a `player` stun action with `idleOnInterface: true`, on main since #163) is preferred over the stop and restart (STEP-MANIFEST.md entry 6) | trade giver, Ashburn (rs/117) | dragon bones to fill (15-21 per load), **~184 more, ~200 in the stuns in all** **[scarce]** (babydragon on the 21:20 UTC stock, with the ~197 spare carried here for a stun count above 200, RUN-ORDER.md section 7); sharks back to 2; **adamant arrowheads 2,070** in one top-up and **rune arrowheads 570** in another, each when SCORED is down to one tier. 12-13 top-ups over the segment (stun-pack.md section 6) |
| H15 | S19 | Witchaven / Ardougne landing | during S18 | trade giver, Ashburn (rs/117) | swamp paste 1, unlit torch 1; Ardougne runes 1 cast |
| H16 | S20 | Hemenster, before the contest | during S19 | carp helper, bbs fleet, handing to the trade giver, Ashburn (rs/117) | raw giant carp 1 (the carp helper leaves the contest before its third catch); fishing rod 1; fishing bait 1; coins 5; Camelot runes 3 casts (3 law, 15 air); **for T20-21 on the body plan in force: Falador runes 1 cast (1 water, 3 air, 1 law) and no coins** (the Falador teleport and a run to the body ruins south of Edgeville, 69.3 m, rs/198; on the nature plan, Ardougne runes 1 cast and 30 coins for Captain Barnaby); **for T21-22: Lumbridge runes 1 cast** |
| H17 | S21 | **in force: the body altar room**, ruins (3052,3444) south of Edgeville (main, 15:17 PDT); the nature altar room beside (2400,4839) only if main switches | **a continuous roster**, staged during S18-S20 and running through S21; SCORED stays logged in | **22 body-altar givers, Ashburn (rs/117), no keeper**: N = ceil(142 / 7) + 1 on rs/163's measured restock round trip of **139-142 ticks** (mean 140.8, n = 9: trade given, exit portal, Edgeville bank (3094,3491), 27 essence, the body ruins, back on its tile; 12 of 12 tuned turns, every measurable gap 7 ticks; m, lab, 16:17 PDT). The lab gave the essence by a staff give, so a real withdraw is a few ticks either way; 142 has 6 ticks of headroom before N = 23 (at 148); essence mined on bbs and couriered | **Body plan:** each delivery rune essence 27, unnoted; each giver keeps its own body talisman (not consumed); 194 deliveries, **5,238 essence** (189 more in H5); **23 of the fleet's 57 body talismans**, SCORED's 1 and the 22 givers' (57 cover a round trip up to ~385 ticks); +142 on the score against the nature plan (supply-fallbacks.md section 7's +231 of crafts with the body route's shorter legs measured by rs/198; its +205 was against the glory leg; RUN-ORDER.md section 7). rs/41 holds **0 nature talismans** (15:00 PDT; a GE bid of 6 at 30,025, none ever sold). **Essence: 63,674 in the fleet ledger, complete.** **The nature altar** is a sensitivity in RUN-ORDER.md, not a plan (main, 15:17 PDT; decided after rs/194's 17:00 PDT report and rs/163's 22:05Z run-host slot): 161 deliveries, 4,347 essence, SCORED's nature talisman and a talisman keeper at the ruins (2868,3018), and **~52 tick-exact givers** on rs/163's measured no-glory round trip of ~355 ticks a restock (Captain Barnaby out 167-169, the customs officer back 169-176; m, lab), reaching the ruins by the Ardougne-Brimhaven ship; it would save 108 with 2 nature talismans, 142 with 4 or more |
| H18 | S22 | Lumbridge river (3241,3248) | during S21 | trade giver, Ashburn (rs/117) | fly fishing rod 1; feather 580; **normal logs 10** (the log margin, below; SCORED already holds the knife); Lumbridge runes 1 cast (T22-23) |
| H19 | S23 | Lumbridge castle kitchen (3209,3215) | during S22 | trade giver, Ashburn (rs/117) | egg 1, bucket of milk 1, pot of flour 1; Falador runes 1 cast (T23-24) |
| H20 | S24 | **the Rusty Anchor, Port Sarim (3045,3257)** | during S23 | trade giver, Ashburn (rs/117); stocked by the quest-item gatherer | goblin mail 3, orange dye 1, blue dye 1 (Goblin Diplomacy); raw rat meat, raw bear meat, raw beef, raw chicken, 1 each (Druidic Ritual; the enchanted meats are **[untradeable]**, SCORED dips them); **cadava berries 1** (Romeo and Juliet's only item: the apothecary makes the potion from them, r `apothecary.rs2:61-65`; rs/126 owns the full list); Falador runes 1 cast (to Kaqemeex) and Varrock runes 1 cast (to Romeo) |
| H21a | S25a | Varrock west anvil (3188,3426) | staged before S25 | trade giver, Ashburn (rs/117), at the anvil; bars from the bars role, bbs fleet | hammer 1; then 31 trades of 24-25 unnoted bars, each taking the 5 platebodies back: bronze bar 15, iron 39, steel 120, mithril 305, adamantite 365 (including one spare inventory of the top three tiers) **[scarce: GE not viable]**. Fallback with no adamantite: mithril platebodies above 88, about +425 mithril bars (supply-fallbacks.md section 2) |
| H21b | - | - | - | - | **retired** with every line held, on today's 21:20 UTC stock (H4m carries the ~85 past S07 on `knife-mine`'s `stay2` bury, on main, #159) and on the forecast at 2026-10-23 (the row in force). Only if the Mining bury cannot fire (iron respawning slower than 13 ticks) do H4m's undelivered bones come here, staged with S25's hand-offs, +1.75 each (+119 for the 85 against the lap; RUN-ORDER.md section 7) |
| H21c | S25c | Varrock west booth | the giver is beside the booth, requesting, as planned relog 1 lands; SCORED enters relog 1 holding **at most 27 items** (wine-window.md section 5) | wine giver = the trade giver, Ashburn (rs/117); wine from the wine maker, bbs fleet | unfermented wine, **noted**, one slot: **520 [held]**, unbanked by the wine giver (rs/118, 10:10 PDT 2026-10-21). Fallback for the make arming only: grapes 1, jug of water 1. **The kebab fallback is not stocked**: if the wine fails outright from SCORED's tab (RUN-ORDER.md R17), ugthanki kebabs are its cheap fallback (131 m, `cooking.md` route 2; +~42 i against the wine), but nobody holds their ~340 kebab mixtures and ~340 pitta breads. rs/184's measurements (16:40 PDT): **bowls 340**, not 14-28, because each noted mixture keeps its bowl until SCORED makes the kebab and the bowl comes back on SCORED's side, not the helper's; the pitta dough is made with a bowl of water (Shantay sells them), which returns an empty bowl, so the pitta line supplies the mixture bowls 1:1. Camel meat ~125 raw an account-hour bank to bank (m, cairn_h51: 20 in a 9.5-minute trip, 4 sharks eaten, no deaths); the desert caps at ~385 an hour (25 spawns, 700-tick respawn). Pitta needs no Cooking training: h51 (74) and h52 (60) are above 58, and pitta never burns at either. Projection (i): 340 mixtures and 340 pitta, noted, in ~4-5 hours of wall clock on two accounts once rs/41 funds them; nothing on the GE except sharks. Kebabs stay in no scenario row: they are the outright-wine-failure fallback, and with R17 at low likelihood since rs/174's relog fix, whether to build the stock is main's and rs/41's call; without them the fallback is fish on a range, +~890 i |
| H21d | S25d, S25c | Varrock west booth | before S25 | trade giver, Ashburn (rs/117); gems from the gem supplier, bbs fleet | chisel 1; uncut diamond 391, noted (364 + one spare inventory). **107 of them are cut in the wine windows**: SCORED withdraws all uncut gems in the burst that deposits the first 29 wines (wine-window.md section 5 B). Fallback: the gem-table mix (2-4 noted stacks, supply-fallbacks.md section 4) |
| H21e | S25e | Varrock west booth | before S25 | trade giver, Ashburn (rs/117); herbs from the herb gatherer, bbs fleet | supply-safe list, noted: guam potion (unf) 41, irit potion (unf) 405, eye of newt 432 (27, 391, 418 plus one spare inventory of 14 each). Fallback: the herb-table mix (10-14 stacks; the helpers need Herblore 50 and 55; supply-fallbacks.md section 5). H21d and H21e go in one trade |
| H22 | S26 | Champions' Guild door (3191,3363) | during S25 | trade giver, Ashburn (rs/117); stocked by the quest-item gatherer and the combat-supply buyer | **coins ~126,000**: 12,000 for the quest and ~114,000 for Scavvo's rune chainbody (50,000) and platelegs (64,000), which SCORED buys upstairs on arrival (supply-fallbacks.md section 12); wizard's mind bomb 1, silk 1, lobster pot 1, unfired bowl 1, plank 3, steel nails 12 (the hammer from H21a is held); **adamant full helm 1** (the rune helm drops only); **rune scimitar 1: GE bid standing (h61, 45,025, cap 47,250), not yet held, no sellers** (rs/41, 03:50Z; an upside only, priced from rs/258's measurement with it, the mithril pass's 107 the bound; H22 gains at most this 1 slot); Scavvo's chainbody and platelegs stay SCORED's purchase on arrival (one shared each, RUN-ORDER.md R22; no 32-QP helper); amulet of strength 1; shark 10; Varrock, Lumbridge and Falador runes 1 cast each; Ardougne runes 1 cast (T26-27). The anti-dragon shield and the map pieces come from the quest itself **[untradeable]** |
| H23 | S27, S17 | **the Ardougne teleport landing (spread (2659-2663, 3299-3303)); helper on (2658,3301), or (2659,3301) if blocked, one tile west on the legs' route, pending rs/198's two-bot lab check**, on T26-27 right after the teleport (no helper in the Wilderness) | during S26 | cannon helper, cairn_h92 in serve mode (rs/41; SCORED receives through `helpers/cannon-receiver.ts`, called by `run.ts`, rs/186, not the Ranged module), bbs fleet, with the trade giver, Ashburn (rs/117), for the kit | dwarf multicannon set 1 (the one from H11r); cannonballs **1,200**, the hand-off and S27's gate (rs/199: ~1,110 used, 0.6 a tick meleeing and 0.5-0.6 with the bow); ranging potion(4) 3 (12 doses; 1-3 per 400-tick bow window, rs/199); super antipoison(4) 1 + 1 spare; super attack(4) 1; super strength(4) 1; **shark 12 for S17**. No rune knives and no glory: SCORED fires the magic shortbow (H12) with the **570 rune arrows it fletched in S18** plus what is left of MM's 100 (~540 used at 0.32 a bow tick; gate 550, rs/199). rs/199 measured, per 400 ticks: 1 super antipoison dose, 1 dose each of super attack and super strength while meleeing, no sharks |

**Contingency, not a hand-off: the Crandor death kit** (S26; rs/258, rs/237). If SCORED dies on Crandor it keeps only the rune platelegs, chainbody and adamant helm (`death.rs2`), and the Karamja wall cannot be opened from outside first (`crandor.rs2`), so the return is the ship again. The re-supply is a mithril-or-better scimitar 1, shark 8, plank 3, steel nails 12 and a hammer 1, from the on-call helper **cairn_mule2** (`resupplyFrom`) at Lumbridge, Draynor or Port Sarim; rs/237 stages the kit. It is not part of H22 and costs nothing unless used; rs/258 rates the risk low (Elvarg's max hit is 10 with the shield, against ~97 HP).

Lookouts (bbs fleet, no items): one helper at each Wilderness stretch (S14, S16, S27, S17) and at the
zoo iron and the Taverley oaks before S09 and S07, reporting players in view (RUN-ORDER.md R8, R9).

**Log margin for knife loops** (main's ruling, 17:3x PDT 2026-10-21, relayed by rs/158). A knife
loop can complete an arrow-shaft fletch, which deletes a log (`cut_logs.rs2`). Two measured rates:

- **knife-cycle fly fishing: 1 log per 513 active knife ticks** (5 starter logs fletched by level 97
  in 2,566 knife ticks; m, demo, rs/195's cairn_casts attempt, `docs/speedrun/rehearsals/fishing.md`
  and `fishing-evidence.json` at 7c841f92). One attempt, so an estimate, not a bound.
- **knife-mine: 0 in 3,184 knife ticks** (1,050 ores, 10 logs at the start and the end; one-sided
  95% upper bound 0.94 per 1,000 knife ticks; m, lab, rs/226; `skills/mining.md` section 7, PR
  pending): the ore drop clears the fletch queue the tick it would fire.

For a loop that leaves the fletch queue standing, carry **logs = max(ceil(2 x K / 513), 2 x K /
600)**, K the step's active knife ticks. **S22** (K about 2,000): 8 by the rule, **10 carried**, as
rs/195's module does, delivered in H18. **S09**: about 5 (H4), no margin. **S07**: none, the loop
chops its own logs. H4 keeps its 6 normal logs for both kits. Normal logs don't stack: one slot
each.

**The nature altar roster (H17's alternative; the body altar is the plan in force).** A roster needs no SCORED relog: a giver that has traded leaves,
banks, takes 27 essence and comes back in. Without a glory the round trip is the Brimhaven ship,
about 160 ticks each way from Ardougne (run-transitions.md section 6). A giver that banks in Ardougne
therefore needs roughly 330 or more ticks per round trip, and the roster about 330 / 7 + 1 = 48 givers
(i). Givers that restock from essence couriers waiting outside the ruins need only the keeper's
pipeline, about 25 ticks per entry (supply-fallbacks.md section 7, e), so about 5 givers: the
couriers' own trips to the bank are helper time and free. **N and the restock method are rs/117's to
set** (RUN-ORDER.md O7). Talismans are not consumed: with the keeper, 4 or more talismans
run the cycle continuously; 2 cost ~+34 and 1 ~+52 in extra batches staged while SCORED is logged
out (supply-fallbacks.md section 7). At 0 nature talismans held (rs/41, 15:00 PDT) the keeper has
nothing to hand, so the plan in force is the body altar: 22 givers, each keeping its own body
talisman, no keeper (m, lab, rs/163; H17). The givers must not log out and back in during S21: a giver that
logs in after SCORED drops to the robust 8-tick schedule for its own trades.

### Peak concurrent logins (the swarm bound)

Tenet 16 (cairn://p/rs/tenets/16, approved 17:43 PDT) and main's working cap: **our simultaneous
demo logins, summed across every host, both Ashburn machines included, stay at or under 100, with a
working cap of 80.** The server's operator bans at 100
simultaneous connections per IP, and deliberately spreading across IPs to evade it is what gets
accounts banned. The count is taken across every host before SCORED's login (RUN-HOST.md step 7),
and fleet accounts not needed during the run are logged out. Rehearsals pause on both Ashburn machines from
the start of the run day's gate series until the run's teardown, the only logins on the machine not
chosen being gate probes, and anything of ours still logged in there counts (RUN-ORDER.md, rehearsals
on the machine not chosen, settled).

The rosters are this page's givers. Every rs/117 giver runs on SCORED's machine and logs in **before
SCORED's run login** ("How hand-offs work"; RUN-ORDER.md R12, measured): on one machine login order
decides the tuned Runecraft cycle and the bone givers' roll-label requests, and SCORED does not relog
until S25c. So **S21's givers are online from
the run login, not only in S21**, and the peak is at the start. An account no longer needed can log
out (the 7 air givers after S06, b01-b04 after S07's last load, the S21 givers after S21) without
disturbing the others' order (i).

**At the start gate**, before the machine is chosen (RUN-HOST.md step 5a): S06's 7 air-altar givers
and a gate account on **each** Ashburn machine, 16 in all, plus the ambassador and the bbs roles the
run uses; the rest of the roster logs in on the chosen machine after the choice, and the other
machine's 7 log out.

| Phase | SCORED and the ambassador | Trade-giver pool (the hand-offs, H4m, S18's top-ups, the wine) | Air altar givers (S06) | Bone givers b01-b04 (S07) | Body-altar givers (S21) | Run accounts | With the gathering fleet (~53) | Nature altar instead (~52 givers): run accounts; with the fleet |
|---|---|---|---|---|---|---|---|---|
| Before SCORED's login through S06 | 2 | 2 | 7 | 4 | 22 (idle) | **37** | **~90** | 67; ~120 |
| S07 | 2 | 2 | 0 | 4 | 22 (idle) | 30 | ~83 | 60; ~113 |
| S08-S20 | 2 | 2 | 0 | 0 | 22 (idle) | 26 | ~79 | 56; ~109 |
| S21 | 2 | 2 | 0 | 0 | 22 | 26 | ~79 | 56; ~109 |
| S22 to the final logout | 2 | 2 | 0 | 0 | 0 | 4 | ~57 | 4; ~57 |

(i: the counts are the hand-off table's rosters; the fleet's ~53 is main's figure, 15:35 PDT. The
bbs roles the run itself uses, the cannon helper cairn_h92 for H11, H11r and H23, the carp helper,
the couriers and the lookouts, are inside the fleet's ~53; about 5-10 of them are in at a time (e)
when the rest of the fleet is out.)

- **The body altar (in force)**, on rs/163's measured roster of 22 givers on 23 body talismans (m,
  lab, 16:17 PDT; H17), starts at **~90** with the gathering fleet still in: 10 over the working cap,
  under 100. **Logging out the fleet accounts the run does not need before the start is mandatory**
  (gathering is finished by run day; RUN-HOST.md step 7), not one of two fixes. Drawing the 7 air
  and 4 bone givers from the 22 body-altar givers also helps: 26 run accounts, ~79 with the fleet.
  rs/117 sets the roster.
- **Per machine.** From the run login through S06 the chosen machine holds SCORED and ~35 givers
  (7 air, 22 body, 4 bone, 2 trade; the ambassador is elsewhere), ~25 by S21. That is fine on the
  swarm side: the demo's bound is per IP and the cap a total, and main's "~20 a machine" was an
  observation, not a cap (main, 16:24 PDT). The CPU side is the giver-load check, pending
  (RUN-ORDER.md O41).
- **Settled: S21's givers log in before SCORED** (RUN-ORDER.md O38, settled; main, 16:35-16:36
  PDT), on SCORED's machine, so this table stands. The host plan of a later S21 login (16:15 PDT) is
  withdrawn.
- **The nature altar** (RUN-ORDER.md's sensitivity row) takes ~52 givers: ~107-109 through S21 with
  the fleet in, ~30 more givers than the body plan's 22, so it requires **logging out at least 30
  fleet accounts**, which is plausible because gathering is finished by run day. With the givers in
  before SCORED (settled), that holds **from before SCORED's run login through the end of S21**,
  not for S21 alone, and it is at least 40 unless the 7 air and 4 bone givers are drawn from the 52
  (~120 at the start otherwise). It stays eligible only if rs/194 holds 4 or more talismans before
  the run's eve and the ~65-client load check passes (main, 17:07 PDT; RUN-ORDER.md O41).

### Status by hand-off: rs/41's forecast to 2026-10-23

Main's ruling (14:55 PDT): the earliest plausible run date is 2026-10-23, more likely the 24th or
later, so RUN-ORDER.md's row in force prices the time-dependent lines at that date and today's stock
is its conservative row. Counts are rs/41's at ~22:00 UTC (15:00-15:05 PDT, from bank history, role
logs and the fleet ledger) and rs/123's rune lines, relayed on cairn://p/rs/192.

| Hand-off | Line (need) | Held at ~22:00 UTC | By 2026-10-23 | In RUN-ORDER.md's row in force |
|---|---|---|---|---|
| H1 | cosmic rune 60 | **62 banked** (rs/123) | complete | 0 |
| H1 | earth rune 50 | **45 short** (rs/123) | to buy (rune shops) | 0 once bought |
| H1 81, H7 550, H13 400, H14 500, and the teleport runes in H4, H6, H8, H16 | air rune ~1,650 | **~1,400 short** (rs/123) | to buy (easy). **For rs/41:** S06's 594 air runes no longer cover any of it: SCORED drops them on T06-07 (rs/158, 16:28 PDT; S21 refuses to start while they are held), so the purchase is the full shortfall, 594 more than if S06's had been used | 0 once bought |
| H4, H6, H8-H13, H15, H16, H18-H20, H22 (every teleport) | law rune ~55 | **49 short** (rs/123) | to buy (rune shops) | 0 once bought |
| H7 | death rune 110 | **110 banked** (rs/123) | complete | 0 |
| H13 70, H14 500 | blood rune 570 | a GE bid of 200 at 603, resting (rs/123) | to buy (Magic Guild shop) | 0 once bought |
| H4.1-H4.n, H14, H14.1-H14.13 | Prayer xp of 39,938 base | 49 dragon (25 banked, 24 on h61) and 1,411 babydragon at 21:20 UTC | ~413 dragon (assumed: ~14 an hour to a 00:00 UTC start; rs/112's firm forecast due 16:00 PDT); ~110 by tonight, which closes O35 too | +52 (today's stock +220, or +339 with its ~85 at the booth) |
| H11, H23 | cannon set and ~1,270 cannonballs (S27's 1,200 and S14's ~70, rs/199) | **two sets and 1,416 balls** (cairn_h92) | complete | 0 |
| H12 | gold bar 1, ball of wool 1, monkey bones 1 (H12's quantities provisional, rs/201) | the gold bar not made yet (cairn_h20 mines and smelts it); the wool and monkey bones from rs/173's far set (rs/41) | to make and fetch | 0 |
| H14, H14.1-H14.13 | arrowtips: rune 570, mithril 1,485, adamant 2,070 | rune **570 of 570**; mithril: h76's 750 complete, h91 buying ~735 at ~450 an hour; adamant **1,220 of 2,070** at ~190 an hour | complete (adamant ~09:30 UTC on the 22nd) | 0 |
| H5, H17 | rune essence: 189 + 5,238 (body plan in force) or 189 + 4,347 (nature plan) | **63,674** (fleet ledger); four miners add ~1,000 an account-hour | complete | 0 |
| H17 | nature talismans (4 or more with the keeper) | **0** (rs/194, 16:35 PDT); the GE's top bid of 30,025 has never traded; **57 body talismans** held | source: the gem table only (overground; underground the same roll gives a chaos talisman; `helpers/bones.md` "Nature talismans"); a farm measured at ~0.25 an hour (m: two 99-combat accounts, Asgarnia hobgoblin peninsula, ~510 kills an hour, 1 per 2,048), projected ~4 by midday on the 22nd and ~10 by the 23rd (i): 4 or more now look likely by the run date | +142: the body altar, 22 givers on 23 body talismans (m, lab, rs/163; its legs, rs/198) |
| H21a | adamantite bars 365 | ~107 at ~30 an hour | **365 by ~12:00 UTC on the 22nd** | 0 (today's stock +119) |
| H21d | uncut diamonds 391 | not gathered | not complete | +88 (the gem-table mix) |
| H21e | herbs, the supply-safe list | unmeasured | unknown | +85 (the herb-table mix) |

## 2. Stockpile totals across the run

| Item | Total | Hand-offs | Source of the count | Scarcity |
|---|---|---|---|---|
| Dragon bones | **555** (355 unnoted in 16 loads for S07 + ~200 unnoted in load 0 and 12-13 top-ups for S18) | H4.1-H4.n, H14, H14.1-H14.13 | `prayer.md` section 7; split by bones-placement.md section 5 and stun-pack.md section 6 | **[scarce]**: at 21:20 UTC (rs/41, 14:29 PDT) 49 dragon (25 banked by rs/112, 24 held on the GE bidder h61; 18 more bid but unfilled, not counted), 1,411 babydragon and ~3,100 big. The hard condition, Prayer xp in hand of at least 39,938 base, is met by 49 dragon + 1,214 babydragon with ~197 babydragon to spare and no big bones, so the bones are a tick cost. On that stock: ~978 to S07 (the 49 dragon and 929 babydragon, 43 loads), ~85 babydragon to the S09 `stay2` lap (H4m.1-H4m.4; `knife-mine`'s bury, on main, #159; STEP-MANIFEST.md entry 4), ~200 babydragon to the stuns, none at the booth: +220 against every line held (RUN-ORDER.md section 7, the conservative row); if the Mining bury cannot fire, the ~85 go to the Varrock west booth (H21b), +339. **On the forecast at 2026-10-23** (the row in force; ~413 dragon assumed, 341 babydragon): 554 to S07 in 25 loads, ~200 to the stuns, none on the lap or at the booth, +52. Any bone type rides the same slots at the same cost per bone, so a mix only adds bones |
| Unfermented wine, noted | **520 [held]** | H21c | `helpers/wine.md` (29 + 491, P(99) 99.83%) | held by the wine giver (rs/118) |
| Rune essence | **5,427** in force (189 + 5,238 at the body altar); 4,536 on the nature plan | H5, H17 | `runecraft.md` section 7 | **[contested]** on the GE; gathered (~1,000 per account-hour, `helpers/essence.md`); **63,674 held** (fleet ledger, 22:05 UTC): complete for the nature plan or the body plan in force (189 + 5,238, H17) |
| Logs for Firemaking | 157: logs 2, oak 4, willow 7, maple 13, yew 24, magic 107 | H2 | `firemaking.md` section 7 (exact) | magic logs from the woodcutter role |
| Normal logs, other | 12 (6 for Tree Gnome Village, 6 for the knife loops) | H4, H7 | `quests/README.md` step 3; `mining.md`, `woodcutting.md`, `fishing.md` section 7 | easy |
| Bars | bronze 15, iron 39, steel 120, mithril 305, adamantite 365 | H21a | `smithing.md` section 7 (+25 margin on steel, mithril, adamantite) | **[scarce]**: adamantite ore is the gap (rs/119); fallback +425 mithril. ~107 adamantite bars at ~22:00 UTC, 365 forecast by ~12:00 UTC on the 22nd (section 1, "Status by hand-off") |
| Uncut diamonds | 391 (364 + 27 spare), 107 of them cut in the wine windows | H21d | `crafting.md` section 7, diamonds-only fallback | 5 held at rs/129; the gem-table mix is the working plan (rs/41, 09:35) |
| Uncut dragonstones | 0 | - | `crafting.md` section 7 | **[unobtainable]** |
| Herblore, supply-safe | guam (unf) 41, irit (unf) 405, eye of newt 432 | H21e | `herblore.md` section 7 | irit at risk; the herb-table mix is the working plan (rs/41, 09:35) |
| Fletching | **headless arrow 4,410; arrowheads: bronze 60, iron 90, steel 135, mithril 1,485, adamant 2,070, rune 570** | H14, H14.x | RUN-ORDER.md section 7, "Fletching mix" (fletching.md section 2's band xp on the demo's level curve) | rune **570 held**; mithril (h76's 750 complete, h91 buying ~735) and adamant (1,220 of 2,070) forecast complete by the 23rd (section 1, "Status by hand-off") |
| Rune arrows (finished) | **100** (MM) | H12 | `quests/README.md` step 8 | S27's ~490-560 (rs/124) come from SCORED's own 570 fletched in S18, so no more are bought |
| Feathers | 580 to SCORED; ~4,410 inside the headless arrows (helper side) | H18; H14 | `skills/README.md` Fishing row (~520 from 78) + 60 spare | easy |
| Rings | sapphire 12, emerald 27, ruby 16, diamond 5 (unnoted) | H3 | `magic.md` section 7 | helper Crafting or the GE |
| Cosmic rune | 60 | H1 | `magic.md` section 7 | reachable from Lundail, ~25 minutes (rs/123) |
| Blood rune | 570 (70 Kolodion + 500 Charge) | H13, H14 | `magic.md` section 7; stun-pack.md section 6 | Magic Guild shop |
| Death rune, chaos rune | 110, 40 | H7 | section 4 | Magic Guild; GE |
| Air rune | ~1,650 (enchants 81, fights 550, Kolodion 400, Charge 500, teleports ~110, spares) | H1, H4, H6-H8, H13, H14, H16, H20, H22 | sum of the hand-offs | easy; none from S06, whose 594 are dropped on T06-07 (STEP-MANIFEST.md entry 9) |
| Law rune | ~55: 15 Ardougne casts (30), 7 Falador, 4 Camelot, 4 Varrock and 3 Lumbridge (18), plus spares | per hand-off | count of the run's teleports (RUN-ORDER.md section 2) | rune shops |
| Water rune | ~40 (Ardougne 2 per cast, Falador 1); fire rune 80 + ~5; earth rune 50 + ~5 | per hand-off | as above; `magic.md` | easy |
| Staves and amulets | staff of water 1, staff of fire 1, amulet of magic 1, amulet of strength 1 | H1, H7, H22 | `magic.md`; quests/README.md steps 3, 13 | Zaff, Magic Guild, GE |
| Amulet of glory | **0** | - | rs/123 | **[unobtainable]**: every leg is measured without one (run-transitions.md) |
| Sharks | ~60 (TGV 2, FA 3, Dwarf Cannon 8, cannon 2, MM 9 at the floor, final count pending rs/201 (H12; 15 before), Thieving 2 + top-ups ~12, Dragon Slayer 10, Agility 12) | H7, H9, H10, H11, H12, H14, H14.x, H22, H23 | quests/README.md steps 3, 5, 8, 13; rs/257 for H10; `agility.md`; stun-pack.md sections 6, 8 | **70 [held]** (rs/41, 10:10) |
| Prayer potion(4) | 4 (MM 2, H12, rs/201: the 6-potion kit died 3 of 3 with its doses unused; Mage Arena 2) | H12, H13 | quests/README.md steps 8, 9 | H7's 2 dropped (Prayer ~94 from S07); MM's 2 are measured use (4-5 doses a chain), the arena's insurance, open as RUN-ORDER.md O27 |
| Antipoison(4) | 2 | H7, H12 | quests/README.md steps 3, 8 | helper Herblore or GE |
| Agility potion(4), magic potion | 1, 1 | H8, H13 | `agility.md`, `magic.md` section 7 | magic potion: helper Herblore 76 or GE |
| Combat kit potions | ranging potion(4) 3, super antipoison(4) 2, super attack(4) 1, super strength(4) 1 | H23 | `ranged.md` section 7 | helper Herblore or GE |
| Cannonballs | **at least ~1,270** (S14 ~70 of its 100, S27's hand-off and gate of 1,200; rs/199); 1,400 target | H11, H23 | supply-fallbacks.md section 9 | **[restricted]**; **held**: two sets and 1,416 balls on cairn_h92 (rs/41, 15:00 PDT), so the start condition is met |
| Dwarf multicannon set | 1 | H11, H23 | `ranged.md` section 7 | **[restricted]**: Nulodion sells it to anyone who completed Dwarf Cannon and replaces a lost one for its owner (supply-fallbacks.md section 9) |
| Rune knives | **0** | - | rs/124 | **[unobtainable]**: no shop sells knives; the magic shortbow replaces them at no cost (rs/124) |
| Gear and tools | **rune axe** (budget item), rune pickaxe, knife, **mithril scimitar**, magic shortbow, **adamant full helm**, fly fishing rod, fishing rod + 1 bait, chisel, hammer | H4, H11, H12, H16, H18, H21, H22 | skill and quest lists; supply-fallbacks.md sections 10, 12, 13 | rune axe: GE only, bid ladder to 1M (C#16 on rs/111); rune scimitar and rune helm unobtainable (rs/124); SCORED buys the rune chainbody and platelegs from Scavvo in S26 |
| Talismans | air: 1 + 7 givers'; **body (in force): 23 of the 57 held, SCORED's 1 and 22 givers'**; nature (the alternative): SCORED's 1 + the keeper's stock (4 or more) | H4, H5, H17 | `runecraft.md` section 7; supply-fallbacks.md section 7 | nature talismans close to unobtainable: **0 held** (a GE bid of 6 at 30,025, none sold; rs/194 searches), so the plan in force is the body altar on 15 of the fleet's **57 body talismans** (H17; main, 15:17 PDT); with the keeper, 1-4 nature talismans would serve the nature altar, a sensitivity |
| Quest items | Doric's, Plague City's, Monkey Madness's, Sea Slug's, Fishing Contest's carp, Cook's Assistant's, the filler's (incl. cadava berries), Dragon Slayer's | H4, H6, H12, H15, H16, H19, H20, H22 | quests/README.md section 4 | easy |
| Coins | ~126,040 (Dragon Slayer 12,000, Scavvo ~114,000, the Brimhaven ship 30 on the nature plan only, Fight Arena 5, Fishing Contest 5) | H9, H16, H22 | quests/README.md steps 5, 11, 13; supply-fallbacks.md section 12 | the fleet held 2.34M (rs/124) |

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
| Cannonballs | ~1,500 (rs/41 first pass); ~1,000-1,300 with the kit (`ranged.md`); ~1,170 used (supply-fallbacks.md section 9) | at least ~1,270, 1,400 target | the start condition is ~1,270 since rs/199's module measured S27's use (~1,110, gate 1,200) and S14's (~70); the 1,416 held keep ~146 of margin |
| Fight runes before Monkey Madness | ~200 chaos + 600 air and ~40 death + 160 air (`pre_mm_fights.md` via `magic.md`); flagged too high by rs/81 | death 110, chaos 40, air 550 | T/5 upper bounds (warlord ~27 Fire Blast, demon ~31 Fire Bolt, Fight Arena ~56 Fire Blast) plus ~25-30% margin |
| Charge runes | ~490 + 490 (`magic.md`); 489 + 489 (stun-pack.md section 6); 500 + 500 (quests/README.md step 9) | 500 + 500 | the measured need is 489 each; the round figure is the margin |
| Feathers for Fishing | ~700 from 20 and ~320 from 90 (`fishing.md`); ~520 from 78 (`skills/README.md`) | 580 | the route's start level; +60 spare |
| Fletching | rune list (2,595 rune arrowheads) or adamant cap (3,735 adamant) (`fletching.md`); v1 took the adamant cap | 2,070 adamant + 570 rune, mithril 1,485, headless 4,410 | rs/41 holds or targets 2,075 adamant and ~560 rune; 570 rune arrows cover S27, so the arrow purchase shrinks to MM's 100; every mix fits the stuns at 0 ticks |
| Ranged ammunition for S27 | up to ~760 rune knives (`ranged.md`); ~500-560 rune arrows (supply-fallbacks.md section 8); 650 (rs/41's target via rs/124) | 570 fletched by SCORED + MM's leftovers (~540 used at 0.32 a bow tick, gate 550; rs/199) | knives are unobtainable; the bow costs nothing (rs/124) |
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
   are a tick cost, not readiness: +52 on the forecast at 2026-10-23 (~413 dragon, assumed), +220
   on today's stock (+339 if its ~85 Mining-lap bones go to the booth). Every adult blue bone (rs/112) counts as a dragon bone.
2. **Hard: a cannon set and at least ~1,270 cannonballs** (rs/125's helper; S27's 1,200 and S14's ~70, rs/199): **met**, two sets and
   1,416 balls on cairn_h92 (rs/41, 15:00 PDT).
3. **Budget item: the rune axe** in H4: held at 13:10 (rs/41). Without it Woodcutting would cost
   +388 (adamant) or +836 (mithril) with the knife.
4. **Budget:** the expected total plus the fallback deltas in force is under 35,916 (RUN-ORDER.md's
   headline scenario table: in force, the forecast at 2026-10-23, +367 and **36,121.5** expected;
   today's stock, the conservative row, +654 and 36,408.5, or +773 and 36,527.5 if its ~85 Mining-lap
   bones go to the booth). **On fold-in 15's figures the budget condition fails**: the start waits on
   a lever in RUN-ORDER.md section 7's go/no-go, fold-in 14's fast-dialogue move first.
5. **Held already:** 520 noted unfermented wines with the wine giver (rs/118); 70 sharks (rs/41, 10:10).
6. **Fletching:** 570 rune arrowheads held; 1,485 mithril and 2,070 adamant arrowheads forecast
   complete by the 23rd (adamant ~09:30 UTC on the 22nd); the bronze, iron and steel stacks; 4,410
   headless arrows. **Finished rune arrows: 100 only** (MM).
7. The rest of section 2, with the scarce lines first: 774 bars plus margin (adamantite forecast
   complete by ~12:00 UTC on the 22nd; or the mithril fallback), the essence (63,674 held), the gems
   and herbs (or their table mixes), the runes still short (air ~1,400, earth 45, law 49, blood;
   section 1, "Status by hand-off"), ~126,000 coins in H22.
8. rs/117's helpers on the run machine (the trade-giver pool, the four S07 bone givers, the 7 air altar
   givers, the N altar givers for S21, at the body altar while no nature talismans are held (22
   givers on 23 body talismans, m, lab, rs/163; they log in before SCORED, RUN-ORDER.md O38, settled), and the talisman keeper if they arrive) are logged in, before SCORED. "The run machine" is the Ashburn machine chosen at the gate (RUN-HOST.md step 5a).
9. H1-H5 and H4.1 are staged (H1 at the landing tile, H2's row dropped and past its reveal, H4 at
   Doric's, H4.1 at the oak tile, H5's seven givers in the air altar room or ready to enter).
10. The H17 roster is staffed and rehearsed, or the logout fallback is agreed.
11. A lookout helper is assigned to each Wilderness stretch (S14, S16, S27, S17) and to the zoo and
    Taverley sites before S09 and S07.
12. **The login cap:** our simultaneous demo logins, summed across every host, at most 80 (the
    working cap; 100 is the ban threshold) before SCORED's login, with the fleet accounts the run
    does not need logged out (section 1, "Peak concurrent logins"; RUN-HOST.md step 7).

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
| H17 | the nature altar with the keeper | **the body altar** on the fleet's 57 body talismans, 5,238 essence (63,674 held); the nature altar is a sensitivity (main, 15:17 PDT): rs/194 projects 4 or more nature talismans by the run date (i), and the open conditions are the ~52 givers' machine load (rs/163's run-host slot) and main's decision | 0 nature talismans held (rs/41, 15:00 PDT); supply-fallbacks.md section 7 |
| Status by hand-off (new, section 1) | - | each line's count at ~22:00 UTC and its forecast to 2026-10-23, with the rune lines from rs/123 | main's ruling of 14:55 PDT; rs/41's forecast (15:00-15:05 PDT) |
| H22 | coins 12,000; rune helm, chainbody, platelegs; glory | coins ~126,000 (Scavvo); adamant full helm; no glory; Ardougne runes 1 cast | rune armour unobtainable except Scavvo's chain and legs (supply-fallbacks.md section 12) |
| H23 | rune knives 760; glory; cannonballs 1,300 | no knives (the bow and SCORED's 570 rune arrows); no glory; 1,200 balls (S27's hand-off and gate, ~1,110 used, rs/199); shark 12 for S17 | rs/124; S17 last |
| Cannonballs | 1,400 | at least ~1,170 (a start condition), 1,400 target | supply-fallbacks.md section 9; main's policy |
| Readiness | "every line in section 2 complete"; 555 dragon bones | main's adopted policy: two hard conditions, the rune axe and the budget | supply-fallbacks.md; main 09:30 |
| H8 | at the Gnome course for S11a and S11b | **S11b's alone**, at the Grand Tree door (2465,3489) through S11b's `kitFrom`; the giver stages there during S10b | the climb in segment M is ~1,100 ticks after S11a, and a boost falls one level per 100 ticks (rs/202's planner; rs/158, 15:27 PDT) |
| H12 | fixed quantities | **superseded and provisional**: prayer potion(4) 2 (from 6), antipoison(4) 1, the freed slots in sharks (9 at the floor, final count pending rs/201); 2 free slots at segment J; split or moved only at the Grand Tree in segment C or D | rs/201 (15:29 PDT; H to M lab chains: the 6-potion kit died 3 of 3, 2 potions and 9 sharks survived 3 of 3); main's kit rule (20:33 PDT); rs/158's order of preference |
| H4m, H21b | H4m only once `knife-mine` buries; the ~85 at the booth until then | H4m carries them (`knife-mine`'s bury on main, #159); the booth only if the bury cannot fire | rs/182 |
| H14.x | the top-up at stun + 2 | the Thieving module stops the in-page program for the trade and restarts it by stun + 9 | rs/132 (e5f83a36): the program clicks the knight on every tick, which closes an open trade |
| Peak concurrent logins (new, section 1) | - | the rosters by run phase against main's 80-login working cap; readiness item 12 | main, 15:35 PDT; a tenet is proposed |
