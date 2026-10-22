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

The in-page `pickpocket` program carries this plan as `stunActions: ['bury', 'charge',
'arrows']` (cairn://p/rs/132; `tick-programs.md`, server/webclient/src/bot/programs/stun-actions.ts),
measured at 3.00 bones per stun with the next attempt unchanged.

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
- **The demo's tick bursts** (RUN-ORDER R2) are not exercised here. The plan sends at most 4
  stun actions per tick, inside interleaving.md section 6's safe budget. The browser client's
  routed knight click (2 packets, not 1) is section 13.

## 13. Browser client: the 6-event stun window and route:false (rs/317)

The question (cairn://p/rs/317): the browser client's routed OPNPC sends MOVE_OPCLICK first
(`server/webclient/src/client/Client.ts`, `tryMove` with an op click), so a window tick that
carries four delay-free actions and the knight click is 6 user events against the engine's 5.
What does that cost S18, and what would `route: false` on the re-click save?

Scripts: [`stun-pack-browser.ts`](../scripts/stun-pack-browser.ts) (the in-page `pickpocket`
program with `stunActions: ['bury', 'charge', 'arrows']` in a browser tab, through
`tickprog-lab.sh`), [`stun-trace.ts`](../scripts/stun-trace.ts) (the server's view of every
stun, tick by tick, from an engine log written with a temporary decode trace). Setup as section 3
except: browser client (headless Chrome, `HEADLESS=1`), bgsrv-mac (12 cores, load ~4), bones and
sharks refilled by `::give` on success ticks (no helper, so no top-up stuns).

### How the engine counts the 5 (read)

`NetworkPlayer.decodeIn` decodes while fewer than 5 user events have been *accepted* that tick.
An event whose handler refuses it (a delayed player: `MoveClickHandler` and `OpNpcHandler` both
return false while `player.delayed`) counts as a client event, not a user event. A 6th accepted
event is not dropped: decoding stops with its bytes in the socket buffer, and the next tick
decodes them first. So the browser's extra MOVE_OPCLICK costs a slot only on a tick where the
click is accepted.

### The stun, tick by tick (measured)

Letters are the decoded user events per server tick, upper case accepted, lower case refused
(C Charge, A arrows, B bury, R page resume, M MOVE_OPCLICK, N OPNPC); `|` is a tick the 5-event
limit cut short. T is the attempt tick; T+11 the next attempt.

| Stun | T+4 (k 2) | T+5 | T+6 | T+7 | T+8 | T+9 | T+10 | T+11 |
|---|---|---|---|---|---|---|---|---|
| stocked (bones) | CCCBmn | mn | RCCBmn | mn | RCCBmn | mn | RMN | RMN |
| dry (no bones) | CCCCM\| | NCCCC\| | MNrCCC\| | MNCCC\| | CMNrCC\| | CMNCC\| | CCMNM\| | NMN |

- **Stocked stuns never reach 6.** The bury's `p_delay(0)` makes the click behind it a refused
  pair, so a bury tick counts 4 (three delay-free actions and the bury) and the rest tick counts
  0; the click-only ticks at k = 7-8 count 2-3. Deferrals in the stocked 57-99 run: **1 stun of
  90**, one that had run short of bones (m).
- **Dry stuns cascade.** With no bury, every window tick sends four delay-free actions and an
  accepted M + N: 6 events, 5 decoded, one carried. The carry grows by one a tick from k = 2 to
  k = 7 and drains on T+10-T+11. Deferrals: 50 of 51 dry stuns, on every tick k = 2..8 (m).
- **Nothing is lost and the attempt is on time.** No delay-free action was refused in any run
  (T+4..T+10 all accept), and the next attempt came on T+11 as often as in stocked stuns (below).
  What the carry does move is xp: in a dry stun ~1.8 delay-free actions land on T+10 (94 in 50
  stuns), the tick the pack's window (k <= 7) keeps clear because a level-up there opens a page on
  T+11 that blocks the attempt (section 2). Stocked stuns landed 2 actions on T+10 in 90 stuns.

### Phase 1: fixed Thieving 80, 1,000 ticks each (measured, browser)

| Variant | Rolls (S / F) | Mean success gap | Fail to next | Next attempt - F (server; 10 on time) | Delay-free landed per stun | On T+10 | Stuns with a deferral |
|---|---|---|---|---|---|---|---|
| stocked (bones) | 229 (173 / 56) | 2.06 | 11.64 | 10.64 (43 of 56 on time) | 8.34 (+2.86 bones) | 2 | 2 / 56 |
| dry (`--bones=off`) | 247 (196 / 51) | 2.10 | 11.72 | 10.72 (38 of 51 on time) | 21.45 | 94 | 50 / 51 |
| lite, 3 bones (section 4) | 275 (229 / 46) | 2.05 | 11.52 | | 7.85 casts (+3.00 bones) | | |

Dry against stocked: **+0.08 ticks per stun** (10.72 against 10.64), inside the noise (standard
error of the difference ~0.3). The late attempts in both are knight walks and page stuns.

### Phase 1: Thieving 57-99 with the pack (measured, browser, one run)

| Run | Client | Span (program ticks) | Successes / failures | Mean success gap | Fail to next | Normalised | Bones / casts / arrows | Stuns with a deferral |
|---|---|---|---|---|---|---|---|---|
| pack-1 / pack-a / pack-b | lite (section 3) | 1,908 / 2,098 / 1,997 | 449 / 84-93 | 2.03-2.18 | 11.83-12.15 | 1,906 / 1,976 / 1,992 | 194-213 / 163-165 / 240 | not traced |
| rs/317 | browser | **2,056** (first to last roll 2,049) | 449 / 90 | 2.15 | 12.08 | **1,981** | 267 / 165 / 240 | 1 / 90 |

The browser run is inside the lite range on every measure, and normalised (section 3's formula)
it sits between pack-a and pack-b. It had no top-up stuns (worth ~0.1-0.3 each in the lite runs),
so the like-for-like gap is a few ticks at most. **The 6-event window costs a stocked S18 nothing
measurable (m).** Magic 80-99 and Fletching 1-99 finished inside the stuns as on lite; Prayer
reached 89 because `::give` kept every stun stocked (267 bones).

### What the deferral can cost the route (inferred)

Only dry stuns form the 6-event bundle: a stun the helper failed to stock (pack-a had 18) while
Charge or arrows are still due. Top-up stuns don't (the request owns its tick and the program
holds every packet while the trade is open), and nor do stuns after Magic and Fletching reach 99.
A dry stun's cost is the page risk of its ~1.8 actions on T+10: low during Charge (19 levels over
165 casts), higher during Fletching (98 levels over 240 actions, roughly an even chance that one
of them levels), each page about +0.5 to +1.5 ticks (section 9). So **0 for a run whose helper
keeps up (pack-b, rs/317), up to ~10 ticks for a pack-a-like run** (i).

Two levers remove it. `route: false` on the re-click when SCORED is adjacent to the knight (the
bundle becomes 5) is phase 2 below. The other needs no packet change: count the routed click as
2 in the stun pack's per-tick budget, so a dry tick carries 3 delay-free actions, not 4. A dry stun
has 24 slots against the ~4.8 the pack needs per stun (section 2), so the dropped slot is free.

### Phase 2: route:false (deferred)

Not measured: the most it can save is the 0 to ~10 ticks above, and nothing in a run whose
helper keeps every stun stocked. **Trigger:** price it only if a run's stuns are not kept stocked
(dry stuns while Charge or arrows are still due), once the opt-in `route: false` for
`interactNpc` (cairn://p/rs/302's builder, for rs/186) is on main. The measurement then: an
opt-in pickpocket param that sends the re-click unrouted when SCORED is adjacent to the knight
and routed otherwise (knights wander), default packets unchanged; the dry variant above rerun
with it (does the bundle come to 5, does T+10 stay clear) and the 57-99 run. The decode trace is
re-applied for that lab with `git show cb742c6a9d | git apply` (see `stun-trace.ts`).

## 14. Browser client: the wired stunPack through skills/thieving.ts (rs/324, rs/335)

rs/324 wired the pack into `speedrun/skills/thieving.ts` as `stunPack` (off by default; needs
`topUp`; `thieving:knights` 57-99 only): idle mode sends
`stunActions: [topUpAction, topup:bones, 'bury', 'charge', 'arrows']`, restart mode the three
presets. rs/335 lab-accepted it on the browser client: bgsrv-mac, block 24, 300 ms, headless, fresh
accounts. The lab giver held a side tile by ::tele and stood in for the courier. rs/317's decode
trace (cb742c6a9d) was applied for the labs only; the engine-side deferral counts come from it.

Command: `DECODE_TRACE=<bot> HELPER=<h> LAB_BLOCK=24 NODE_TICKRATE=300 HEADLESS=1 bash docs/speedrun/scripts/tickprog-lab.sh <bot> speedrun/lab/measure-thieving.ts:pack:--helper=<h>:--mode=idle|restart`
(alphanumeric bot names; create-bot.ts rejects underscores).

| Run | Band ticks | S / F | Success gap | Fail to next | Normalised | Walk overhead per roll | Bones (Prayer) | Charge (Magic) | Arrow actions (Fletching) | Top-ups due / fired / completed | Giver on +2: side / corner / same / further | Cost per top-up | Deferrals (page / engine stuns) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| idle 1 (cairnsp335a) | 2,025 | 449 / 76 | 2.26 | 13.17 | 2,123 | 0.55 | 180 (43→83) | 164 (80→99) | 34 (1→60; courier arrowtips defect) | 18 / 16 / 16 | 15 / 1 / 0 / 2 | 0.73 | 0 / 0 |
| restart (cairnsp335c) | 1,800 | 449 / 72 | 2.11 | 11.79 | 1,942 | 0.21 | 162 (43→82) | 164 (80→99) | 238 (1→98) | 18 / 18 / 18 | 16 / 0 / 1 / 1 | 0.65 | 0 / 0 |
| idle (cairnsp335b, courier fixed) | failed at Thieving 68 (346) | 32 / 22 | | | | | 34 | 156 | 0 | 12 / 11 / 1 | 11 / 0 / 0 / 1 | | 0 / 9 stuns (k6, k7) |
| idle (cairnsp335d, courier fixed) | 2,052 | 449 / 89 | 2.10 | 12.44 | 1,990 | 0.33 | 201 (43→85) | 164 (80→99) | 240 (1→99) | 25 / 21 / 20 | 21 / 0 / 0 / 4 | -0.82 (noise) | 0 / 2 |

Baselines: rs/317's browser run 2,056 (normalised 1,981); lite 1,906-1,992 normalised. Restart
(1,942) and idle cairnsp335d (1,990) are inside both. rs/158 accepted S18 on these runs, and idle
is cleared: SCORED runs the default idle mode.

**Default top-up mode: `idle` (the module's default); `restart` stays selectable** (rs/158's ruling
on robustness, 2026-10-22; run.ts passes no override). Idle is the default because it degrades
more gently on a live server. The program never stops: while the trade window is open it only
holds its clicks, so a late or missed top-up costs nothing while food lasts and the next due stun
covers it (idle rerun: 21 of 21 requests fired from side tiles, 20 completed, 0 corners). The
pack's bury, Charge and arrow actions stay in the same program, on the same stun schedule.
Restart stops and restarts the program at every top-up, so every top-up carries a restart
deadline (by stun +9) that a slow or bunched tick can miss, losing the next pickpocket. That is one
more failure point per top-up, about 17-20 times in S18. The 48-tick gap between the two runs
(restart 1,800 band ticks / 1,942 normalised; idle 2,052 / 1,990; one run each, inside the row's
noise) is noise at n = 1 and was not the basis.

- **Idle 1's overhead** is knight wander, not pack cost: the decode trace shows its window ticks
  clean (3 delay-free actions and a bury per tick, 0 deferrals), and every late stun is a walk
  after a wandering knight from T+11 onwards (walk 0.55 a roll against 0.21-0.33 in the other
  runs).
- **Corners (rs/158's ask).** One corner showed up mid-run (idle 1, the failure at tick 1078,
  giver at (-1,-1) on +2). The request fired at +2, the trade opened at +4 and completed, so no
  top-up was lost on a corner. 'Further' cases (distance > 1) fire no request by design, and the
  next due stun's top-up covers them.
- **Bones** come out at exactly (failures - top-ups) x 3: 180 = (76-16) x 3, 162 = (72-18) x 3.
  That's below the ~200 planned when food at `below: 2` fires its own top-ups (each takes a stun's
  3 bones). Making the sharks ride with the bones trades is a lever.
- **A top-up cost 0.65-0.73 ticks** in the first two runs, against 0.1-0.3 on lite. The trades
  open at +4 and close at +9 (+7 with one item offered), and the program holds the k = 7-8 clicks
  while the trade is open.
- **The 6-event bundle** forms only in bone-less stuns with Charge due (cairnsp335b, after its
  top-ups stopped: 9 stuns deferred at k6-k7, with no attempt delay, 10.11 against 10.31), as
  section 13 predicted.
- **Fletching:** cairnsp335d reached 99 inside the stuns (240 actions). Restart's 98 came from
  fewer stuns; finishing it is at most 2 rune actions, about 1 tick. That figure is derived from
  xp, not timed (the finishing driver found Fletching already at 99).
- **cairnsp335b's stall** was a lab-giver problem (it sent no commands for ~60 s while 11 requests
  came in, then ran out of sharks), not a module or program one. Its logs were lost with the
  executor's scratch.
- **Lab tooling fixes** (rs/335): tickprog-lab.sh now shows create-bot's output and stops without
  a bot.env (rs/324's earlier failure was an underscore in the name); the courier stand-in looked
  for `arrowheads`, but the items are `<tier> arrowtips`.

**Charge on boosted Magic (rs/361).** The Charge precondition checks **boosted** Magic 80, as the
engine does (`stat(magic)`, magic.rs2:22). `stunPack.sipForCharge` (default on) drinks one
magic-potion dose at base 79 with boosted below 80, before the band's first program run (after the
resume re-check), outside every stun, so the stun schedule and the packet stream are unchanged: the
program starts on params identical to the base-80 run, and the test asserts it. The cost is the
dose's `p_delay(1)`, about one tick, once. One dose is enough: the +4 (consume_effects.dbrow
`stat_change,magic,4`) decays one level per 100 ticks, so 83 keeps Charge open for at least 300
ticks, while base 79 to 80 is at most 3.99 casts (two stocked stuns) at 180 base xp and 25x. The sip
comes before the program, not in a stun window, because the program gates stun actions on base
level with no fire-once rule, so a sip action would repeat every stun. The refusal string names
base, boosted, and whether a potion is held.

## 15. Blood-rune shortfall: Charge to N, then the cheapest completion (rs/367)

The question (cairn://p/rs/367, main's spec via rs/158): the pack prices Magic 80-99 as 163 Charge
casts inside the stuns, about 489 blood runes, and only 100 are held. S16's Kolodion fight keeps 70
(SUPPLIES.md H13, rs/185). For N = 100, 250 and 400 blood runes held in total, how far does Charge
take Magic, what is the cheapest completion to 99, and what does it cost against the full-Charge
plan? Model: [`stun-pack-shortfall.ts`](../scripts/stun-pack-shortfall.ts) (`bun
docs/speedrun/scripts/stun-pack-shortfall.ts [N ...]`, no server). No lab was run: every candidate's
stun-castability is either already measured inside knight stuns (interleaving.md section 4) or
read from the scripts below, and the one open figure, the in-page attempt cost of a delayed spell,
needs the stun action this section names (see Open).

### The engine facts the table rests on (read)

- **Charge**: 3 blood, 3 fire, 3 air, 180 base, Magic 80 (`magic_spells.dbrow`), the staff of fire
  covering the fire (`magic.rs2` `staff_runes`). So S18 gets N - 70 runes and floor((N - 70) / 3)
  casts. Full Charge from the bottom of 80 is 163 casts and 489 blood, so N = 559 is the break-even.
- **The curve**: base 80 = 10,686.8, 99 = 39,938.3 (`Player.ts` `levelExperience`, `lib/xp.ts`),
  29,251.6 base to find from 80. A start at 81 (a high Kolodion yield) is 769 base, 4.3 casts, less.
- **The stun is a varp, not a `p_delay`.** A failure sets `%stunned` and `%action_delay`
  (`thieving.rs2:49-50`) and the pickpocket script returns while they hold (`pickpocket.rs2:130-137`).
  No spell script reads either varp, so **every spell is castable inside a stun**; what limits it
  is its own `p_delay`, which rejects every op packet on the following ticks (`OpHeldTHandler` and
  the other handlers refuse while `player.delayed`; an IF_BUTTON is accepted but Charge's protected
  script does not run). The window is T+4..T+10, T+10 must stay undelayed for the knight click
  (section 2's k = 8), and nothing with xp lands on T+10.
- **What a stun holds** (delaying ticks T+4..T+9): three buries (2 ticks each, the plan in force), or
  **two `p_delay(1)` spells at T+4 and T+7** (Superheat, the enchants, Low Alchemy), or one High
  Alchemy (`p_delay(3)`, 5 ticks). Measured inside knight stuns at Thieving 80 (interleaving.md
  section 4, lite, observation-driven): enchant at +2 and +5 landed **1.92 a stun**, High Alchemy
  **1.00 a stun (28 of 28)**. A delayed spell therefore displaces the stun's three bones, and the
  delay-free slots drop from 9 to 8 (4 before each cast, less ~1.2 page resumes), still above the
  ~4.8 Charge plus arrows need (section 2).
- **Blood runes cannot be made.** This revision has no blood altar (`runecraft.md`: soul and blood
  have no `rune_type`). They come from the Magic Guild shelf (1,000 at 50 gp, restocking 1 per 300
  ticks, shared, found empty on 2026-10-21, `helpers/runes.md`) or the GE (ask 959 for 99, bid 578
  for 15,623, `helpers/market.md`, 2026-10-21 snapshot).

### The completion candidates

| Spell | Runes (fire from the staff of fire) | Base a cast | In a stun | Base a stun | Standalone | Supply (who makes more) | Verdict |
|---|---|---|---|---|---|---|---|
| **Superheat Item** | 1 nature (+4 fire) | 53 r | 2 (T+4, T+7), r; as enchant's 1.92 m | **106** | 3.00 ticks a cast m (magic.md section 4), 17.7 base a tick | nature: Magic Guild 1,000 at 20 gp, GE ask 441 for 515,020 (market.md); iron ore: GE ask 109 for 39,835, or the smelter role mines it (`helpers/smelter.md`); copper and tin, any helper. Needs Smithing 1 (bronze, copper + tin) then 15 (iron), r: `superheat.rs2:37`, `smelting.struct`; SCORED is Smithing 1 until S25a, so the first 12 casts are bronze | **chosen** |
| High Alchemy | 1 nature (+5 fire) | 65 r | 1, m | 65 | 5 ticks m, 13.0 base a tick | nature as above; any item (noted items are not refused by `alchemy.rs2` or `OpHeldTHandler`, r, untested, so one slot could hold the whole stack) | the fallback if ore top-ups fail: 61% of Superheat's xp a stun |
| Low Alchemy | 1 nature (+3 fire) | 31 r | 2, r | 62 | 3 ticks m, 10.3 | as High Alchemy | loses to High Alchemy on runes |
| Enchant, Lvl-5 / Lvl-4 | 15 earth + 15 water + 1 cosmic / 10 earth + 1 cosmic | 78 / 67 r | 2, m (1.92) | 156 / 134 | 3 ticks m | dragonstones **unobtainable**, diamonds 5 held and owed to S25d (SUPPLIES.md) | no supply |
| Enchant, Lvl-3 / Lvl-2 | 5 fire + 1 cosmic / 3 air + 1 cosmic | 59 / 37 r | 2 | 118 / 74 | 3 ticks | rubies contested (GE bid 10,000), rings need gold bars and a jeweller | ruby would beat Superheat by 12 a stun, not worth a gem line |
| Fire Blast (combat) | 1 death + 4 air (+5 fire) | 34.5 + 2 a damage r | **no**: attacking sets `%lastcombat` and the pickpocket refuses for 8 ticks (`pickpocket.rs2:125`) | - | ~8 base a tick in S27 (i) | death: Magic Guild 1,000, 110 banked | a lever for the remainder (below) |
| Bones to Bananas, Telekinetic Grab, Charge Orb, teleports | | 25 / 43 / 66-76 / 35-68 | 1 at best, or impossible (an obelisk, a ground item, a move) | | | | out |

Charge is the only delay-free xp spell, so nothing can ride the stuns' delay-free slots in its place.
The cheapest completion is **Superheat in the stuns first**, in every stocked stun (~70, i, from
section 3 and 14's 54-81 failures less top-ups), with the stun's bones moved to S07's knife loop
at **0.26 a bone** (r: RUN-ORDER section 7, '200 more bones in S07 (+52)'; BP measured 0.23; S07
has room, RUN-ORDER's today's-stock row puts 978 bones there). Each such stun is 106 base for
~0.8 ticks, against 6.6 ticks standalone. What the stuns cannot hold goes **after S18, as a
standalone Superheat row (S18e)** at the market with the courier swapping 20 ore for 20 bars a load:
3.00 a cast m plus 6 a swap i, 3.3 ticks a cast. It must come before S25a, because Superheat also pays
Smithing (6.2 base on bronze, 12.5 on iron, r), and S25a's slowest band is its first: 1-48 cost 128
ticks for 1,131 base (smithing.md section 2, m), so the credit runs ~1.4 S25a ticks a cast at first
and ~0.35 later (i, the bands scaled to S25a's 1,065).

### The table

Against the full-Charge plan (S18 as priced, 2,000 m: Charge 0 ticks inside the stuns, ~200 bones
buried there). Figures from `stun-pack-shortfall.ts`.

| | N = 100 | N = 250 | N = 400 | No Charge (worst) |
|---|---|---|---|---|
| Blood for S18 (N - 70) | 30 | 180 | 330 | 0 |
| **Charge casts** | **10** r | **60** r | **110** r | 0 |
| **Magic reached by Charge** (base xp) | **82** (12,487) r | **90** (21,487) r | **95** (30,487) r | 80 (10,687) |
| Base xp still to find | 27,452 | 18,452 | 9,452 | 29,252 |
| **Completion** | Superheat: 140 in 70 stuns, **378 after S18** | Superheat: 140 in the stuns, **209 after** | Superheat: 140 in the stuns, **39 after** | Superheat: 140 in the stuns, 412 after |
| Runes and ore | 518 nature; 12 copper, 12 tin, 506 iron ore | 349 nature; 12 + 12, 337 iron | 179 nature; 12 + 12, 167 iron | 552 nature; 12 + 12, 540 iron |
| Inside or after the stuns | both; after = S18e at the market, before T18-19 | both | both, after is ~135 ticks | both |
| Bones moved to S07 (~210) | +55 i | +55 i | +55 i | +55 i |
| **Ticks against the full-Charge plan, gross** | **+1,313** i | **+755** i | **+194** i | **+1,425** i |
| Smithing credit in S25a | -286 i | -228 i | -152 i | -297 i |
| **Net** | **+1,027** i | **+527** i | **+42** i | **+1,128** i |
| Worst-route ticks (no Charge at all; pure standalone, no stuns, in brackets) | +1,425 gross / +1,128 net (+1,828 / +1,530) | same | same | |
| Lever: the remainder by Fire Blast in S27 in place of the bow (net) | +813 i | +414 i | +15 i | +893 i |
| Lever's extra cannonballs (~306 spare) | 488 | 269 | 50 | 532 |

Sensitivities (i, the model's rows): stocked stuns 55 or 80 in place of 70, **+87 / -58** at every
N; the lite enchant's measured +1.1 ticks a stun to the next attempt (13.4 against 12.3), **+77** if
the in-page program shows it too. It came from observation jitter landing the second cast on T+9
(interleaving.md's own reading), which a tick-locked program does not have, so 0 is the central
figure and +77 the bound. Gross includes ~5 e for the ~75 Smithing levels' pages inside the stuns.

**The curve** (Charge until the runes run out, then Superheat, stuns first):

| N | 70 | 120 | 170 | 220 | 270 | 320 | 370 | 420 | 436 | 470 | 520 | 559 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Charge casts | 0 | 16 | 33 | 50 | 66 | 83 | 100 | 116 | 122 | 133 | 150 | 163 |
| Superheat stuns / after | 140 / 412 | 140 / 358 | 140 / 300 | 140 / 243 | 140 / 188 | 140 / 131 | 140 / 73 | 140 / 18 | 138 / 0 | 101 / 0 | 43 / 0 | 0 |
| Gross | +1,425 | +1,247 | +1,056 | +868 | +686 | +498 | +307 | +125 | +59 | +43 | +19 | 0 |
| Net of Smithing | +1,128 | +967 | +795 | +625 | +468 | +305 | +139 | -18 | -75 | -74 | -28 | 0 |

Below N = 436 every 3 blood runes are 180 base, 3.4 Superheats after S18, **~11 ticks gross (~3.7 a
rune)**; above it the stuns hold the whole remainder and the cost is only the bones moved (~0.8 a
stun), which the Smithing credit outweighs.

### What the table does not change, and what it needs

- **The "+~120" check.** The '~+120 pack's work elsewhere' is RUN-ORDER section 7's stun-pack-fails
  row (R31): plain pickpocket -25, Charge standalone +33, Fletching standalone +59, 200 bones in S07
  +52. Its +33 is 163 casts at 5 a tick, so it **assumes the full 489 blood runes and prices none of
  this**. If the pack fails and the runes are short as well, there are no stuns to superheat in:
  Charge standalone takes 2 / 12 / 22 ticks and every Superheat is after S18, which adds **+1,398 /
  +909 / +434** (net of Smithing) to that row at N = 100 / 250 / 400 (i, the model's last row).
- **The S27 lever** (i, unmeasured): in S27's bow phase the cannon pays ~13.0 Ranged a tick and the
  bow lifts it to ~20.1 (RG, m), so a tick of Fire Blast in place of the bow costs only 0.35 S27
  ticks and pays ~8 Magic (34.5 a cast over the 5-tick delay plus damage; 7-9.8 is the honest range,
  Kolodion's Fire Wave measured 8.8). That is ~23 base a tick against Superheat's 16-19, about 200
  ticks better at N = 100, but it needs a cast phase in `combatFinish`, ~490 more cannonballs than
  the ~306 spare at N = 100, and one death rune a cast (~500). It is a lever to measure if N = 100
  holds at staging, not the column.
- **Blood-side levers** (i): each blood rune moved into Charge is worth ~3.7 ticks below N = 436.
  Kolodion's fight is about 50-58 Fire Waves (magic.md section 1, inferred), so the 70 reserve
  holds ~12-20 runes of margin; a Fire Blast Kolodion (death runes) would free all 70 for ~23 casts,
  ~250 ticks at N = 100, against a slower fight that is unmeasured. The GE's 99 at 959 and the guild
  shelf's 1 per 300 ticks are the only top-ups.
- **A lead beyond the shortfall** (i): the curve goes negative from N ~420, so Superheat in the stuns
  pays through S25a even at full blood: 140 casts for Smithing alone, ~-75 net, at the cost of the
  bones moved and a tighter delay-free budget (163 casts + 294 arrows against ~476 slots). For rs/147
  to weigh; it is not in the table's baseline.

**Module and staging changes the completion needs** (none made here; for rs/147 to file):

1. A `superheat` stun action in the in-page `pickpocket` program
   (`server/webclient/src/bot/programs/stun-actions.ts`): OPHELDT Superheat on the first ore at k = 2
   and k = 5, up to 4 delay-free actions before each in the same tick, no bury in those stuns, no xp
   action on T+10. Its acceptance lab is the open figure: the next attempt against stocked bury
   stuns (0 or the lite +1.1).
2. `skills/thieving.ts` `stunPack`: ore in place of bones in load 0 and the top-ups (bronze for the
   first 12 casts, iron after Smithing 15; no coal held, or Smithing 30 turns iron into steel,
   `superheat.rs2:27`), the bars dropped or swapped back, a nature-rune precondition, and the Charge
   action stopping when the blood runs out (it already does: 'Charge while Magic < 99 and runes last').
3. A standalone Superheat step (S18e) after S18, with the courier's ore swaps; before S25a.
4. Staging: ~210 more bones in S07's loads (H4.x), the courier's loads switched to ore, and the
   nature runes and ore bought (rs/41's fleet stock of nature runes and iron ore is not in
   SUPPLIES.md's ledger; cairn_h51 holds some nature runes, count not recorded).
