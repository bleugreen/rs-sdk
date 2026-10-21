# The Thieving stun pack at route levels (rs/106)

The question (cairn://p/rs/106): can each Knight of Ardougne pickpocket stun carry dragon bones,
Charge 80-99 and Fletching 1-99 at once, at SCORED's post-Monkey Madness stats, with a helper
topping the pack up beside the knights, and what does that cost Thieving?

Scripts: [`stun-pack-thieve.ts`](../scripts/stun-pack-thieve.ts) (the pack, the top-up trades,
the variants), [`stun-pack-probe.ts`](../scripts/stun-pack-probe.ts) (which stun offsets accept
which action), [`stun-pack-summary.ts`](../scripts/stun-pack-summary.ts) (one row per run and a
fail-normalised comparison). They are copies extended from `interleave-thieve.ts` and
`thieving-pickpocket.ts`, which are unchanged. Labels follow
[skills/README.md](../skills/README.md#labels): m measured, r read, i inferred, e estimated.

Setup for every figure here: local engine, `NODE_TICKRATE=300`, lite client, 1-tick
reactions, fedora (shared 32-core host, load 1-3), port block 9620-9622 / 44620 / 8620,
`speedrun/lab/lab.sh`. SCORED was set by staff command to the post-Monkey Madness and Mage Arena
stats: Hitpoints 97, Defence 89, Prayer 43, Magic 80, Fletching 1, Thieving 57, Mage Arena
finished (`%magearena` 8), staff of fire wielded. The helper was a second lite runner driven from
the same process through `speedrun/lib/trade.ts` (`decideReceiver` on SCORED, `planOffers` and
`decideGiver` on the helper). The helper's own restocking (its bank trips) is a `::give` stand-in,
because helper time is free; every SCORED-side tick is real.

## 1. Result

- **The whole pack fits.** In three end-to-end runs from Thieving 57 to 99, every run also took
  Magic 80 to 99 (163-165 Charge casts), Fletching 1 to 99 (240 arrow actions, 3,600 arrows) and
  Prayer 43 to 84-85 (194-213 dragon bones), all inside the stuns, with nothing done outside
  them (m, section 3).
- **Thieving 57-99 with the pack took 1,908 / 2,098 / 1,997 ticks** (m, 84 / 93 / 84 failures),
  against **1,986** plain (m, 1 run, 88 failures) and thieving.md's model of 1,975. Fail counts
  alone move a run by about 100 ticks. Compared at a common 84 failures, the pack runs come to
  1,906 / 1,976 / 1,992 against plain 1,939, or about 1,854 from the second plain run's per-roll
  costs (it died at level 87, section 3). **The pack costs Thieving about 20-100 ticks, ~60
  central** (i), from top-up stuns, level-up pages and wander noise, which this sample cannot
  separate further.
- **It replaces about 470-510 standalone ticks**: 388-426 of burying (2 per bone), ~33 of Charge
  and ~48 of Fletching (i, section 7). **The net saving is about 370-490 ticks, ~420 central** (i).
- **3 bones per stun, not 2.** Burying at stun offsets +2, +4 and +6, each with three delay-free
  actions before it, landed 3.00 bones in every stocked stun (m, 62 + 71 + 46 stuns in three
  runs). Interleaving.md section 4 expected the third bone to land only about 2/3 of the time.
  The stuns can therefore hold about (failures - top-ups) x 3 = **~210 bones** at 84 failures
  (pack-b buried 213), more than the 196 the route plans (section 6).
- **Top-ups cost about nothing in time.** A trade requested by SCORED at stun offset +2 completes
  inside the stun, and the next attempt still comes 11 ticks after the failure in most cases
  (m, 9 of 13 in pack-b; mean 12.15 against 12.03 for the other stuns). Its real cost is the
  stun's bones, which it displaces. That is 12-13 top-ups over 57-99, against RUN-ORDER's
  ~9-10 x 5 = 48 unabsorbed ticks (section 5).
- **Charge stays inside stuns.** Outside them, three casts before each knight click slowed every
  success by 0.66 ticks, and only 48% of the casts landed (m, section 4).
- Eating 11-12 sharks in success windows cost 0 ticks (m, 11 of 11 eats kept the 2-tick success
  gap). The knights hit 3 per stun (sometimes 2), and minimum HP was 41-71 (m, section 8).

## 2. The stun plan

Engine timing (r: interleaving.md section 4, `thieving.rs2`, `pickpocket.rs2`): for an attempt
landing on server tick T, the roll is at T+1 and the failure message is published in T+1's state
(offset k = 0 here). T+2 and T+3 are delayed, T+4..T+10 accept every packet while the stun just
makes the pickpocket script return, and T+11 is the next attempt. A packet sent on observing
offset k lands on T+2+k, so k = 2..8 is the usable window.

| k (sent on) | Lands | Sent | Why |
|---|---|---|---|
| 2 | T+4 | 3 x h, bury | bury's `p_delay(0)` rejects T+5, so k = 3 sends nothing |
| 3 | T+5 | - | |
| 4 | T+6 | 3 x h, bury | |
| 5 | T+7 | - | |
| 6 | T+8 | 3 x h, bury | |
| 7 | T+9 | knight click | |
| 8 | T+10 | knight click | xp landing on T+10 queues a level-up page that pops on T+11 and blocks the attempt (m, smoke run: 12 ticks to the next roll with a page, 11 without), so no xp actions here |

`h` is one delay-free action: Charge while Magic < 99 and runes last, otherwise an arrow action
(the highest arrowhead tier held and usable), otherwise dropping a finished lower-tier arrow
stack. An open level-up page is resumed first, at the cost of one `h` slot (section 9). Inside a
tick the order is helpers, then bury, then the click, because an arrow action (OPHELDU) clears
the interaction (r: interleaving.md section 1).

Demand against capacity: 163 casts plus 240 arrow actions is 403 delay-free actions over ~84
stuns, 4.8 per stun (i). The plan offers 9 per stun, less about 1.2 page resumes (m: 99-103
resumes over 84 stuns). Charge finished at stun 31 (tick 462) and Fletching at stun 69
(tick 1,282) in the first pack run (m, `--hfirst=charge`), leaving slots idle after that.

## 3. End-to-end runs, Thieving 57 to 99 (measured)

`stun-pack-thieve.ts sp106s --helper=sp106h [--sharks=2]` (pack) and `--bones=0 --charge=off
--fletch=off` (plain). "Fail to next" is the mean ticks from a failure message to the next
roll. "Normalised" is successes x mean success gap + 84.2 x mean fail-to-next, which puts every
run at the same failure count (`stun-pack-summary.ts`).

| Run | Script state | Span | Successes / failures | Mean success gap | Fail to next | Normalised | Bones / casts / arrows | Top-ups ok / tried | Eats | Min HP |
|---|---|---|---|---|---|---|---|---|---|---|
| plain-1 | | **1,986** | 449 / 88 | 2.08 | 11.94 | 1,939 | - | - | 12 | - |
| plain-2 | died at Thieving 87 (4 sharks, no refills: a lab setting) | (1,201 to level 87) | 187 / 63 | 2.02 | 11.24 | ~1,854 | - | - | 4 | 0 |
| pack-1 | first load sizing (overflowed, section 5) | **1,908** | 449 / 84 | 2.03 | 11.83 | 1,906 | 194 / 165 / 240 | 14 / 21 | 11 | 60 |
| pack-a | fixed sizing; helper left behind for ~300 ticks | **2,098** | 449 / 93 | 2.12 | 12.15 | 1,976 | 194 / 163 / 240 | 12 / 12 | 12 | 41 |
| pack-b | fixed sizing; helper kept beside SCORED | **1,997** | 449 / 84 | 2.18 | 12.05 | 1,992 | 213 / 164 / 240 | 13 / 13 | 11 | 71 |
| pack, top-ups after successes | first load sizing | 2,245 | 449 / 93 | 2.60 | 11.60 | 2,142 | 257 / 163 / 240 | 17 / 36 | 12 | 70 |

Every pack run ended with Magic 99 and Fletching 99; Prayer ended at 84 (194 bones) or 85 (213).
In pack-a, 18 stuns ran dry of bones (and arrows, whose rune tier was due in the same top-up)
while the helper stood 28 tiles away. In pack-b the helper was kept within 3 tiles (57
teleports, a stand-in for walking), and no stocked stun was dry. Stuns that ran past 11 ticks
were, in the plain run, all knight walks (each involved SCORED changing tile); in the pack runs
most were walks as well, some with a page resume.

Pack minus plain, normalised, per pack run (pack-1 / pack-a / pack-b): against plain-1 (1,939)
-33 / +37 / +53; against plain-2's per-roll costs (1,854) +52 / +122 / +138; on the means,
+61 (1,958 against 1,897). With two plain samples and per-run noise of about ±50, **+20 to
+100, ~60 central** (i) is the honest range. The fixed-level variants (section 4) show the stun plan
itself adds nothing; what remains is the top-up stuns (section 5), stuns with a level-up page
(+0.5 to +1.5 ticks each, ~11 per run, section 9) and success gaps (2.03-2.18 against 2.02-2.08),
where knight wandering dominates.

## 4. Variants at fixed Thieving 80 (measured)

`--level=80 --hold=1 --ticks=1000 --topup=give`: Thieving held at 80 by `::setstat`, Magic reset
to 80 whenever it reached 99, rune arrowheads only, bones and sharks refilled by `::give` outside
the stun (no trade cost). One run of 1,000 ticks each.

| Variant | Rolls (S / F) | Mean success gap | Fail to next | Per stun |
|---|---|---|---|---|
| plain | 234 (181 / 53) | 2.11 | 11.58 | - |
| 3 bones, Charge inside (`--bones=3`) | 275 (229 / 46) | 2.05 | 11.52 | 3.00 bones, 7.85 casts |
| 2 bones, Charge inside (`--bones=2`) | 272 (227 / 45) | 2.12 | 11.34 | 2.00 bones, 11.16 casts |
| 3 bones, Charge outside (`--charge=out`) | 209 (164 / 45) | **2.71** | **12.02** | 3.00 bones; outside: 843 of 1,764 casts landed |

- **3 bones against 2:** no difference in the next attempt (11.52 against 11.34, within noise)
  and one more bone per stun. Both leave more delay-free slots than the pack needs (7.85 casts
  per stun against the 4.8 needed), so 3 bones it is.
- **Charge outside the stuns:** three IF_BUTTON casts sent with each knight click outside a stun
  slowed the success gap from 2.05 to 2.71 (73 of 163 gaps took 3 ticks) and the stun's next
  attempt by 0.5, and only 48% of the casts landed. Over 57-99's 449 successes that is about
  +300 ticks (i), against nothing gained, since the stuns have room for all 163 casts.
- **Top-up inside a stun or after a success:** from the end-to-end runs (section 3). The 17
  trades that completed after a success cost 6-16 ticks of success gap each (mean 8.2 against
  2, m). The inside-stun trade costs ~0.1 (section 5). Inside the stun wins.

## 5. Top-ups (measured)

### Procedure

1. The helper stands cardinally adjacent to SCORED. It must keep up as SCORED moves between
   wandering knights: in pack-a a helper that only followed while a top-up was due was left 28
   tiles behind for ~300 ticks and 18 stuns ran dry. Within 3 tiles at all times held it
   (pack-b).
2. When SCORED holds fewer bones than one stun uses (3), it sends the trade request itself in
   the next stun at offset **k = 2**, or k = 4 if the helper is not adjacent at 2, and **never on
   the tick after a bury**: the bury's `p_delay(0)` swallows the request (m: both requests at k = 3
   after a k = 2 bury never opened a trade). SCORED's own OPPLAYER closes any level-up page it has
   open, so it is never "busy" to the helper. The helper answers the request on the next tick.
3. SCORED sizes the load **when it sends the request**: its free slots then (bones still held
   count as occupied), less the sharks coming back, less one slot if an arrowhead tier rides
   along, less one slot of margin for a new arrow product stack. While a trade is open SCORED
   sends nothing else (Charge's `if_close`, an inventory op or a knight click would close it), so
   its free slots cannot shrink before the trade completes.
4. The helper offers **each item with one press**: All, or one Offer-X with the count. Two
   presses on the same slot of an unstackable item (Offer-10 then Offer-5 for 15 bones) land only
   the first. The helper accepts, SCORED accepts the offer and confirm screens.

### Cost

| Run | Requested at | Request to done | Next attempt after the top-up stun's failure | Bones buried in the top-up stun |
|---|---|---|---|---|
| pack-b | k = 2 in 13 of 13 | 6 ticks (Offer-X) | 11 in 9 of 13; mean 12.15 (other stuns 12.03) | 0 |
| pack-a | k = 2 in 5, k = 4 in 7 | 6 (one 5) | mean 12.42 (other stuns 12.11) | 0.58 |
| pack-1 | k = 2 mostly | 5 ticks (All) | 11 in 16 of 21, 12 in 5 (all attempts, failed ones included) | 0.24 |

So a top-up started at k = 2 costs about 0.1-0.3 Thieving ticks (m), and one started at k = 4
about 1 (m: it completes at k = 10 and the attempt slips). An Offer-X count costs the helper one
extra tick (6 against 5); a load the helper holds exactly, offered with All, would finish at
k = 7 (inferred from pack-1's 5-tick trades). What a top-up stun loses is its three bones: it
cannot bury while the trade is open. Capacity is therefore (failures - top-ups) x 3.

### Lab lessons that apply to the run's bot

- Every failure in the first runs was one of these: the load sized at staging time overflowed
  SCORED's inventory ("You don't have enough inventory space for this trade", 5 of 7 failures
  inside stuns and all 19 after successes), a request sent on the tick after a bury (2 of 7),
  multi-press offers of bones (all 5 timeouts in an aborted run), and the helper falling behind.
  With all four fixed, pack-b's 13 top-ups all completed.
- A short offer the helper has accepted will not change. SCORED declines it at once rather than
  waiting out a timeout with nothing sent.
- The multi-press behaviour comes from `speedrun/lib/items.ts` `amountButtons`, which
  `planOffers` uses for every item. Any helper trade of an unstackable item in a count that is not
  1, 5, 10 or All is exposed to it (cairn://p/rs/136; this lab works around it in its own copy).

## 6. Inventory and supply plan

Slots outside the bones: blood runes, air runes, headless arrows, the arrowhead tiers held, the
current arrow product, coins (pickpocket loot) and the sharks. The staff of fire is wielded and
supplies Charge's fire runes. Carrying all six arrowhead tiers from the start cost six slots of
bones in every early load (12-bone loads in pack-1). Delivering adamant and rune in top-ups, one
tier whenever SCORED is down to one, raised loads to 15-21 (pack-b).

**Load 0 (hand-off H14, before Thieving):**

| Item | Count | Slots |
|---|---|---|
| Staff of fire | 1 | wielded |
| Blood runes, air runes | 489 each (163 casts x 3) | 2 |
| Headless arrows | 3,600 | 1 |
| Bronze, iron, steel, mithril arrowheads | 60, 90, 135, 225 | 4, falling to 1 as they are used |
| Sharks | 2 | 2 |
| Dragon bones | ~16 (every free slot less one) | ~16 |

**Top-ups (H14.1 onwards), beside the knights, every ~90-190 ticks:** dragon bones to fill
(15-21), sharks back to 2 (0-2), and once each the adamant arrowheads (495) and rune
arrowheads (2,595), each when SCORED is down to one tier. Pack-b's top-ups came at ticks 80, 172,
287, 399, 530, 678, 866, 1,032, 1,221, 1,363, 1,456, 1,708 and 1,928 of the segment. **Over
57-99: 12-13 top-ups for 194-213 bones** (m); for the route's 196, about 12 (i). The helper needs
about 200 unnoted dragon bones over the segment, in loads of up to 21, so it banks between
top-ups (at least 90 ticks apart: the East Ardougne bank trip fits, e). Sharks: 11-12 over the
segment, so H14's 20 is a comfortable surplus.

**How many bones the stuns can take:** (failures - top-ups) x 3. At 84 failures and 13 top-ups
that is 213 (pack-b); at 80 failures, 204. The route's 196 fits with margin. Any bones above
196 that the supply allows (up to ~210) come off O5's standalone pile at 2 ticks each (i).

## 7. Net saving

| Absorbed | Count (m) | Standalone ticks replaced | Basis |
|---|---|---|---|
| Burying | 194-213 bones | 388-426 | 2 ticks per bone (prayer.md section 5; its bank visits, ~28 for 196, are not counted) |
| Charge 80-99 | 163-165 casts | ~33 | 5 casts per tick standalone (interleaving.md section 6, magic.md) |
| Fletching 1-99 | 240 actions | ~48 | 5 actions per tick standalone (fletching.md section 1: 50 measured) |
| Top-ups | 12-13 trades | 0 against RUN-ORDER's 48 i | inside the Thieving figure (section 5) |
| **Total** | | **~470-510** | i |
| Less the pack's cost to Thieving | | 20-100 (~60) | section 3, i |
| **Net** | | **~370-490 (~420)** | i |

Level-up pages are not in the standalone column. Standalone, Fletching's 98 and Prayer's ~41
pages would each cost at least a tick; in the stuns they cost an `h` slot (section 9).

## 8. Damage and eating (measured)

At Hitpoints 97 and Defence 89 the knights' stun hit 3 in 81-91 of 84-93 stuns per run and 2 in
the rest: 249-277 HP over the segment. SCORED ate a shark in a success window (on the success,
with the next click, at or below 77 HP and at least 4 ticks after a stun) 11-12 times per run.
All 11 eats in pack-1 kept the 2-tick success gap, so they cost nothing. Eating inside a stun
costs 3 ticks (r: thieving.md section 4; `consume.rs2` adds the food's delay to
`%action_delay`), so it is kept for emergencies (at or below 6 HP) and never happened. Minimum HP
was 60 (pack-1), 41 (pack-a, while the helper was away) and 71 (pack-b). No deaths with a helper.
The plain-2 death is a lab setting: 4 sharks and no refills.

## 9. Level-up pages (measured)

Most level-up chat messages never reach the bot's published state: plain-1 saw no Thieving
level-up message in 42 levels, and the pack runs saw 6-8 of ~41 Prayer and 16-18 of 98 Fletching
level-ups. The page itself does arrive, so count dialog opens, not messages. A pack run saw
109-111 page opens inside stuns and 34 outside (m, pack-a and pack-b).

- Inside a stun, a page is resumed first (RESUME_PAUSEBUTTON) at the cost of one `h` slot
  (99-104 resumes per run). Charge's `if_close` or an inventory op would close it underneath
  instead; resuming is the path the measured runs used, and closing was not measured cleanly.
- Stuns in which a level-up message was seen took 12.4-13.4 ticks to the next attempt against
  11.9 for the rest (m, n = 10-12 per run): about +10 ticks per run (i).
- Outside a stun (Thieving's own level-ups, on a success), the page is resumed in the same tick
  as the next click. 98% of success gaps stayed at 2 ticks in pack-1.

## 10. Per-action delays inside a stun (read; for cairn://p/rs/132)

Only scripts that write `%action_delay` cost the next pickpocket attempt. Of the stun actions,
only eating does.

| Action | Packet | Script | Writes `%action_delay` | Other delay | Cost inside the stun |
|---|---|---|---|---|---|
| Bury a bone | OPHELD (Bury) | `skill_prayer/scripts/bury_bone.rs2` | no | `p_stopaction`, `p_delay(0)`: the next tick's packets are rejected | 0 to the attempt; leave the next tick empty (m) |
| Charge | IF_BUTTON `magic:charge` | `skill_magic/scripts/spells/charge.rs2` | no | none; `if_close` closes an open page or trade | 0 (m) |
| Arrows | OPHELDU arrowheads on headless arrows | `skill_fletching/scripts/arrows.rs2` | no | none; clears the interaction, so a click goes after it | 0 (m) |
| Eat | OPHELD (Eat) | `player/scripts/consumption/consume.rs2` | **yes** (adds the food's delay) | | 3 ticks (thieving.md section 4) |
| Trade request, accepts | OPPLAYER4, IF_BUTTON | `interface_trade/scripts/trade.rs2` | no (not among the scripts that write it) | refused while the target is busy (delayed or a modal open) | ~0.1-0.3 at k = 2 (m, section 5) |
| Page resume | RESUME_PAUSEBUTTON | `levelup/scripts/levelup.rs2` (`p_pausebutton`) | no | | one packet slot |
| Drop a finished arrow stack | OPHELD (Drop) | not read | | | not measured separately |

## 11. The row RUN-ORDER.md should use for S18

One row replaces S18a-S18d, and the leg row's top-up line goes into the figure:

| ID | Kind | Where (tiles) | Step | Levels | Expected | Best | Supplies in, items out | Helper, hand-off | Login / logout-safe | Fallback if the fast path fails | Risks |
|---|---|---|---|---|---|---|---|---|---|---|---|
| S18 | I | East Ardougne market knights (~2655,3305) | pickpocket, in-page re-click; each stun: 3 delay-free actions and a bury at +2, +4, +6 (Charge until Magic 99, then arrowheads on headless arrows), clicks at +7 and +8, top-up trades requested by SCORED at +2 | Thieving 57-99, Magic 80-99, Fletching 1-99, Prayer 43-~85 | **2,000 m** (stun-pack.md section 3: 1,908 / 2,098 / 1,997 with the pack, 84-93 failures; plain 1,986 m) | **1,908 m** | in: H14 (staff of fire wielded, 489 blood and 489 air runes, 3,600 headless arrows, bronze-mithril arrowheads, 2 sharks, ~16 dragon bones); top-ups H14.1-H14.12 (15-21 bones, sharks to 2; adamant 495 and rune 2,595 arrowheads ride two of them) | trade giver beside the knights, within 3 tiles at all times | safe at any attempt boundary, not while a trade is open | top-up at k = 4 if not adjacent at k = 2 (~+1 each); plain pickpocket if the pack fails (1,975 i) and the skills standalone (~470) | knights wander, so the helper must keep up (18 dry stuns when it did not); a request on the tick after a bury is lost; offer each item with one press |

What it absorbs, against today's rows: S18b's ~196 bones (0 net, unchanged; up to ~210 fit),
S18c's 163 casts (0, unchanged), S18d's 20 i (now 0, inside the 2,000), and the S18 leg row's
"bone top-ups ~9-10 x 5 = 48 i" (now inside the 2,000). The 2,000 replaces 1,975 + 20 + 48 =
2,043 (i), about 40 ticks lower. The stun budget row ("~196 bones (1.96 per stun m) ... ~9-10
bone top-up trades not absorbed") becomes about 200 bones at 3.00 per stocked stun (m) and 12-13
top-ups absorbed.

## 12. Open questions

- **Two plain samples are too few** to pin the pack's Thieving cost inside 20-100. A third plain
  run with enough sharks (`--sharks=14`) would tighten it. Wander noise is the bulk of the spread.
- **The helper keeping up on the demo** is untested: the lab teleported the helper next to
  SCORED (57 times in pack-b) in place of walking. A walking helper that lags on a knight change
  delays the next top-up, not the stun. The bot should top up early (with 6 bones left rather
  than 2) when the helper is far.
- **Exact loads with All** (5-tick trades, completing at k = 7) need the helper to hold the exact
  load. That means SCORED announcing it a stun ahead, or a fixed load size. Worth ~0.2 ticks per
  top-up; not tried.
- **The browser run client and the demo's tick bursts** (RUN-ORDER R2) are not exercised here.
  The plan sends at most 4 packets per tick, inside interleaving.md section 6's safe budget.
