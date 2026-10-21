# Supply fallbacks: what each at-risk supply line costs the run

For every supply line that the helper swarm (cairn://p/rs/41) reports at risk, this page gives:

- the fallback method or methods;
- the tick delta against [RUN-ORDER.md](../RUN-ORDER.md)'s step rows, expected and best, as a
  curve over the quantity held where a partial stock is likely;
- the breakpoint, and whether the line should be a start condition or degrade gracefully;
- the knock-on changes to the order and to [SUPPLIES.md](../SUPPLIES.md)'s hand-offs.

**SCORED** is the brand-new scored account (its real name never appears in this repository).
Issue: cairn://p/rs/129, under cairn://p/rs/103. cairn://p/rs/111 folds these deltas into
RUN-ORDER.md and SUPPLIES.md; this page edits neither.

Holdings are rs/41's report of 14:40 UTC on 2026-10-21 (the issue's table), plus four lines the
rs/103 coordinator forwarded on 2026-10-21:

- **rs/124 (combat supplies, cairn://p/rs/124 comment 2):** rune knives are unobtainable, and so
  are the rune scimitar and the rune armour; the rune axe is uncertain.
- **rs/119 (bars):** adamantite ore is the only gap in the bars.
- **rs/123 (first report):** the charged glory looks unobtainable; nature talismans are close to
  unobtainable; 60 cosmic runes are reachable.

The arithmetic lives in [`supply-fallback-model.ts`](../scripts/supply-fallback-model.ts)
(`bun docs/speedrun/scripts/supply-fallback-model.ts [section]`). That script re-uses the existing
models' inputs and needs no server. **No engine lab was run.** Every fallback below rests on a
cadence already measured by its skill document, or on a read formula applied to measured rates.
The two candidates for a lab dropped out:

- **Knife tiers:** no shop sells knives of any metal, and rs/124 is measuring the magic shortbow
  that replaces them.
- **Hard leather:** it is dominated by the gem-table mix.

The largest estimated figures (the glory legs) belong to rs/104, which is re-measuring them.

## Labels

As in RUN-ORDER.md: **m** measured, as the source reports it; **r** read from a script or engine
line; **i** inferred, arithmetic on m or r inputs (here, or in the cited model); **e** estimated by
judgement on this page. "Model" means `supply-fallback-model.ts`, with its section name.

## Summary

Deltas are against RUN-ORDER.md's knife-on columns (expected 35,321, best 32,325; the record is
35,916). Where expected and best differ, both are given as expected / best. The "now" column
prices the holdings reported today.

| Supply | Held now | Needed | Fallback | Delta at today's holdings (exp / best) | Curve | Breakpoint | Start condition? |
|---|---|---|---|---|---|---|---|
| Dragon bones | 0 (470 babydragon, 673 big) | 555 | babydragon bones, then big bones; adult blues count as dragon bones | **+1,608** if 525 more babydragon bones are farmed; **infeasible** on today's stock (short 15,743 base) | **+2.90 per dragon bone short** (babydragon), +7.87 (big) | today's stock reaches 99 only from 219 dragon bones; Prayer alone stays inside the expected margin (595) from ~350 | **yes: Prayer xp in hand >= 39,938 base**; the dragon-bone count is a budget item |
| Adamantite bars | 0 | 365 (340 + 25) | mithril platebodies above 88 | **+119** | +0.35 per bar short | none | no: degrade (needs +425 mithril bars) |
| Adamant arrowheads | at risk (shops 200 + 200, restocking) | 3,735 | mithril cap, partial adamant | +17 standalone at 0; **~+5 / 0** in the stuns | +0.005 per arrowhead short | none | no |
| Uncut diamonds | 5 | 391 (364 + 27) | gem-table mix (sapphire, emerald, ruby), or rubies | **+88** (mix), +31 (rubies) | per diamond short: +0.08 (ruby) to +0.38 (sapphire) | none | no |
| Irit potion (unf) | at risk | 405 (391 + 14) | the whole herb-table mix | **+85** (whole mix), +106 (no irit at all) | per irit short: +0.27 (mix) to +1.09 (guam) | none | no |
| Cosmic runes | resolved (rs/123: Lundail, ~25 min) | 60 | none needed; Low Alchemy as insurance | 0 | | | no |
| Nature talismans | close to unobtainable | 1 + ~17 givers | a talisman keeper at the ruins; batches of givers staged while SCORED is logged out | **+52 (1 held), +34 (2), 0 (4 or more)** with a keeper | table in section 7 | 4 talismans with a keeper; without one, the air altar (+868) beats batching below 2 | no, if the keeper is built; else yes, 4+ |
| Rune knives | unobtainable (rs/124) | 800 | magic shortbow + rune arrows (~560 arrows) | **-4 (i)**: the bow's +69 attack lifts the cannon's accuracy | | none | no |
| Cannon set + 1,400 balls | at risk: a Dwarf Cannon helper | 1-2 sets, 1,400 balls | set: SCORED buys its own from Nulodion after S13; balls: no fallback but a helper or the GE | 0 with the helper; **+50-100 (e)** if SCORED buys the set; **~+1,900-2,100** with no cannon at all | balls: +2.18 per ball short in S27, +9.2 in S14 | the balls (~1,170 used) | **yes: a cannon set and ~1,170 cannonballs** |
| Rune scimitar (rs/124) | unobtainable | 1 | rune longsword (a 32-QP helper buys it from Scavvo), or a mithril scimitar | -1 (longsword), +21 (mithril) | | none | no |
| Amulet of glory (rs/123) | unobtainable | 2 | no glory in the S27 kit; walked legs | S27 +20 with the bow (+50 with knives); legs **~+290 (e, rs/104 measuring)** | | none | no |
| Rune armour (rs/124) | helm by drop only; chain and legs Scavvo only | 1 set | SCORED buys chain and legs from Scavvo during S26; adamant helm | **~+15-20 (e)** | | none | no |
| Rune axe (rs/124) | none; competing bid 100,001 | 1 | adamant axe, mithril axe | **+457 / +523** knife / plain (adamant); +960 / +1,098 (mithril) | | | **budget item: worth far more than its price** |

Two of these lines decide the start: dragon bones and the rune axe. The rest add **~+640 (i/e)**
when every one of them falls back, and two thirds of that is the glory legs, which are still
estimates. The cannon is a hard requirement, but only its cannonballs are hard to get.

## Recommended policy for the start decision

1. **Two hard start conditions.**
   - **Prayer xp in hand: at least 39,938 base, in any bone mix.** Below it, S25b cannot finish.
     Today's 470 babydragon and 673 big bones give 24,195 base, so the run needs 219 dragon
     bones or 525 more babydragon bones (about 1.3 hours of four baby-blue farmers at ~98 per
     account-hour, rs/41).
   - **A cannon set and ~1,170 cannonballs.** Without the cannon the finish costs ~+1,900-2,100
     (section 9). SCORED can buy the set itself, so the line that binds is the balls: a helper
     who has done Dwarf Cannon makes them from ~300 steel bars.
2. **Replace "555 dragon bones" with a tick budget.** Price the holdings at decision time from the
   summary's curves and add them up. If expected + sum < 35,916 (sum at most ~595), the expected
   path beats the record, so start. If only best + sum < 35,916 (sum at most ~3,591), starting is a
   bet on the best case, and waiting buys ticks at these rates:
   - 2.90 per dragon bone (or adult blue bone);
   - 457 for a rune axe;
   - 0.35 per adamantite bar;
   - under 0.4 per gem or herb.
3. **Spend coins where the ticks are.** The rune axe is worth ~457 ticks, and a competitor's
   100,001 bid is the only obstacle; bid well above it. Dragon bones are worth 2.9 ticks each,
   against the GE bid of 11,000. Every other line is worth under 0.4 ticks per unit.
4. **Never wait for the graceful lines.** These are adamantite bars, arrowheads, diamonds, irit,
   talismans (once the keeper exists), knives, the scimitar, the armour and the glory. Each has a
   fallback that is ready now; the hand-off changes are listed in each section.

**Scenarios** (i, sums of this page's deltas; the glory legs are e):

| Scenario | Sum of deltas | Expected | Best | Against the record (exp / best) |
|---|---|---|---|---|
| Everything held | 0 | 35,321 | 32,325 | -595 / -3,591 |
| 555 dragon bones and the rune axe held; every other line falls back (adamantite 0, diamonds 5, the irit mix, 2 talismans + keeper, bow, longsword, no glory, Scavvo armour, cannon from a helper) | ~+640 | ~35,960 | ~32,965 | **~+45** / -2,950 |
| As above, with no rune axe (adamant) | ~+1,100 | ~36,420 | ~33,420 | +505 / -2,495 |
| Today: no dragon bones (babydragons farmed to 99), rune axe held, the rest falling back | ~+2,250 | ~37,570 | ~34,575 | +1,655 / -1,340 |
| Today, and no rune axe | ~+2,705 | ~38,025 | ~35,030 | +2,110 / -885 |

The scenarios are additive (i); the lines barely interact, because they touch different steps.
The exception is the glory and the talisman keeper, which share the givers' round trip
(section 7). With dragon bones and a rune axe in hand, the expected path sits about at the record.
The difference is inside the glory legs' estimate, which rs/104 replaces with measurements.
Without dragon bones, only the best case beats the record.

## 1. Dragon bones (S10a, S18b, S25b; H7, H14, H14.x, H21b)

**Fallback.** Bury the best bones held. A bury is 2 ticks whatever the bone, plus 2 ticks per
28-bone bank visit (m, prayer.md section 4). Base xp per bone is dragon 72, babydragon 30 and big
15 (r, `bones.obj` via prayer.md section 5). An adult blue dragon from rs/112's safe spot drops a
dragon bone, so it counts in D. rs/112 has no rate yet (its builder was still in the lab at
14:37 UTC).

**Model (model, `prayer`).** The account needs 39,938.3 base (r, level table). The stun allocation
is capacity-bound: ~196 bones in ~100 pickpocket stuns (i, interleaving.md section 8, 1.96 per
stun m). That count does not depend on the bone type. So a lower-xp mix adds **booth bones**
in S25b at 58/28 = 2.07 ticks each (m, prayer.md section 2, the figure S25b uses). S10a takes the
best bones held for Prayer 43 (787.4 base): 11 dragon bones (21 ticks, m), or 27 babydragon
bones (53 ticks, i).

**Curve A, babydragon bones farmed as needed** (expected and best alike, i):

| Dragon bones D | Babydragon bones | Total bones | S25b booth bones | Delta |
|---|---|---|---|---|
| 555 | 0 | 555 | 348 | 0 |
| 500 | 132 | 632 | 425 | +159 |
| 450 | 252 | 702 | 495 | +304 |
| 400 | 372 | 772 | 565 | +449 |
| 350 | 492 | 842 | 635 | +594 |
| 300 | 612 | 912 | 705 | +739 |
| 250 | 732 | 982 | 775 | +884 |
| 200 | 852 | 1,052 | 845 | +1,029 |
| 100 | 1,092 | 1,192 | 985 | +1,319 |
| 0 | 1,332 | 1,332 | 1,109 | +1,608 (S10a +32 included) |

RUN-ORDER R6 quotes +~1,700 for the no-dragon-bone case. That figure took BONES' 2.2 ticks per
bone, which includes the measured run's host stalls; the 2.07 here is the stall-free cycle
that S25b itself uses.

**Curve B, today's stock: 470 babydragon and 673 big bones, nothing more farmed** (i). Big bones
cost 2.07 more ticks per 15 base than babydragon bones do.

| D | Babydragon used | Big used | Delta, or the shortfall |
|---|---|---|---|
| 450 | 252 | 0 | +304 |
| 350 | 470 | 43 | +638 |
| 300 | 470 | 283 | +1,031 |
| 250 | 470 | 523 | +1,425 |
| 219 | 470 | 672 | +1,669 |
| 200 | 470 | 673 | short 1,343 base (45 more babydragon) |
| 0 | 470 | 673 | short 15,743 base (525 more babydragon) |

**Marginal cost (i):** each dragon bone not held costs **+2.90** ticks when babydragon bones
replace it, or **+7.87** when big bones do. Each babydragon bone replaced by big bones costs
+2.07.

**Breakpoint.** Waiting costs wall time, not score. A farmed babydragon bone (~98 per
account-hour, rs/41 comment of 09:53 UTC) saves 2.07 ticks over a big bone. An adult blue saves
2.90 over a babydragon bone. Three cases follow:

- **Feasibility is the hard line.** Below 39,938 base in hand, S25b cannot finish.
- **Prayer alone fits the expected margin from ~350 dragon bones.** With the other fallbacks
  added, the expected path needs ~555.
- **Big bones lose to babydragon bones everywhere.** Farm babydragons rather than bury big bones
  whenever an hour is available: 673 big bones cost 1,394 booth ticks (i), against 701 for the
  337 babydragon bones that give the same xp.

**Start condition: yes, as Prayer xp in hand.** The dragon-bone count itself is a budget item
(policy above).

**Knock-on.**

- **S10a.** Without 11 dragon bones, H7 carries 27 babydragon bones (unnoted), and S10a takes
  53 ticks instead of 21.
- **S18b and H14.x.** Unchanged in count: ~196 bones in ~9-10 top-up loads. The bone type in the
  stuns does not change the ticks.
- **S25b and H21b.** One noted stack per bone type (2-3 stacks, +~2 i per extra deposit). The
  booth runs **40 inventories instead of 13 at D = 0** (1,109 bones, ~2,297 ticks), all before
  planned relog 1. Order the stacks dragon, then babydragon, then big, so that any shortfall is in
  the last stack.
- **Knife-off column.** If the knife gate fails all night, the booth bones ride the plain
  4-tick Woodcutting and 5-tick fly-fishing clocks. Those clocks have room for ~1,670 bones
  (3,958/4 + 3,410/5, i), so the extra bones cost only top-up trades: ~5 ticks per 21 bones,
  about +185 at D = 0 (i) instead of +1,608.

## 2. Adamantite bars (S25a; H21a)

**Fallback.** Mithril platebodies above Smithing 88. Every platebody costs 5 ticks whatever its
metal (m: adamant 40 of 40 gaps, mithril 8 of 8, smithing.md section 4), plus a share of the
trade turnaround: 35 ticks per inventory of five (m, smithing.md section 2). The xp is per bar
(r): mithril 50, adamantite 62.5, so 250 and 312.5 per platebody. Nothing above mithril beats the
mithril platebody without adamantite. Superheat, furnace smelting and cannonballs all lose
(smithing.md section 5).

**Curve (model `smithing`, i, expected and best alike):**

| Adamantite bars held | Adamant platebodies | Mithril platebodies (68-99) | Mithril bars needed (+25 margin) | Delta |
|---|---|---|---|---|
| 365 | 69 | 56 | 305 | 0 |
| 300 | 60 | 67 | 360 | +14 |
| 200 | 40 | 92 | 485 | +49 |
| 100 | 20 | 117 | 610 | +84 |
| 0 | 0 | 142 | 735 | **+119** |

**Marginal:** +0.35 ticks per adamantite bar short (i).

**Breakpoint:** none. Smithing degrades smoothly, and each bar is worth too little to wait for.

**Start condition: no.**

**Knock-on.**

- **H21a:** about +425 mithril bars at zero adamantite (735 against 305 + 25 margin). rs/41
  reports mithril as covered at 305; the extra must come from the bars role (rs/119).
- **S25a:** about four more trades (142 + 2 against 125 platebody inventories), already
  inside the 7 ticks per platebody.

## 3. Adamant arrowheads (S18d; H14)

**Fallback.** The mithril cap (fletching.md section 5), or partial adamant: use adamant
arrowheads from Fletching 60 while they last. The cadence is 0.2 ticks per action (m, 5 per tick,
fletching.md section 2).

**Curve (model `fletching`, i):**

| Adamant arrowheads held | Adamant actions | Mithril actions | Total | Mithril arrowheads | Headless arrows | Standalone delta | Stuns used by the top tiers |
|---|---|---|---|---|---|---|---|
| 3,735 | 249 | 15 | 283 | 225 | 4,245 | 0 | 36 |
| 2,000 | 133 | 169 | 321 | 2,535 | 4,815 | +8 | 41 |
| 1,000 | 66 | 259 | 344 | 3,885 | 5,160 | +12 | 45 |
| 400 (one shop round) | 26 | 312 | 357 | 4,680 | 5,355 | +15 | 46 |
| 0 | 0 | 347 | 366 | 5,205 | 5,490 | +17 | 48 |

**In the stuns** (S18d is 20 expected, 5 best): a stun carries 7.3 delay-free actions beside its
bones (m, interleaving.md section 4). Charge takes ~22 of the ~100 stuns, and the mithril cap
needs ~48. So the extra actions fit, and the net delta is **~+5 (e) expected and 0 best**: the
low tiers' standalone share grows by a few ticks if rs/106 finds less room. If S18d runs
standalone (50 m), the delta is the standalone column (+17 at most).

**Breakpoint:** none. **Start condition: no.**

**Knock-on (H14):** mithril arrowheads up to 5,205 (shops: Ranging Guild 200, Catherby, restocking;
`ranging.inv` r) and headless arrows up to 5,490 (+1,245 feathers and shafts). Feathers are covered
(9,785 held, SUPPLIES.md).

## 4. Uncut diamonds (S25d; H21d)

**Fallback.** Cut the next gem down. Every gem cuts at 5 per tick on the same 7-tick, 27-gem
bank cycle (m, crafting.md sections 2 and 4). Xp per gem (r): sapphire 50, emerald 67.5, ruby
85, diamond 107.5. All four are open from S25d's start level of 45.

The realistic supply is the **jewel drop table** (r, `shared_droptables.rs2` `randomjewel`: of
128 rolls, sapphire 32, emerald 16, ruby 8, diamond 2). Hill giant helpers already loot it. 364
diamonds alone need ~23,000 jewel-table drops. The table's own mix, at 61.6 base per gem, needs
~1,400 drops for 634 gems.

**Curve (model `crafting`; 121/364 = 0.33 ticks per gem, i, from RUN-ORDER S25d):**

| Diamonds held | Rest in rubies | Rest in emeralds | Rest in sapphires | Rest in the table mix |
|---|---|---|---|---|
| 364 | 0 | 0 | 0 | 0 |
| 250 | +10 | +22 | +43 | +28 |
| 150 | +19 | +42 | +81 | +53 |
| 50 | +27 | +61 | +120 | +77 |
| **5 (now)** | **+31** | +70 | +137 | **+88** |

Hard leather bodies only would take 1,116 bodies at ~7.5 ticks per 26 (i, crafting.md section 2),
about 322 ticks, +201. Every gem line beats them.

**Breakpoint:** none. Rubies are contested (a 10,000 gp bid wall for 10,148, crafting.md
section 7), so take whatever the gem supplier has and cut the best first.

**Start condition: no.**

**Knock-on (H21d):** 2-4 noted stacks instead of one (+~2 i per extra deposit), plus one spare
inventory per gem type for the blind withdraw (crafting.md section 6).

## 5. Irit potion (unf) (S25e; H21e)

**Fallback.** The supply-safe list (guam 27 to Herblore 45, then 391 irit) is the most
herb-hungry list there is. Irit is 8 of every 128 herb drops (r, `shared_droptables.rs2`
`randomherb`), so 391 irit sit behind ~6,256 drops. Those same drops leave the gatherer ~1,560
guam, ~880 tarromin, ~680 harralander, ~540 ranarr, ~290 avantoe and ~240 kwuarm.

**Fallback: mix the whole herb table, best potion first.** Xp per potion (r, `brew_potion.struct`):

| Herb | Share of drops (of 128) | Potion | Base xp | Secondary | Level |
|---|---|---|---|---|---|
| guam | 32 | attack | 25 | eye of newt (Port Sarim shop) | 3 |
| tarromin | 18 | strength | 50 | limpwurt root (hill giant drops, 6-15 per account-hour, BONES) | 12 |
| harralander | 14 | energy | 67.5 | chocolate dust (shops) | 26 |
| ranarr | 11 | prayer | 87.5 | snape grass (ground spawns) | 38 |
| irit | 8 | super attack | 100 | eye of newt | 45 |
| avantoe | 6 | fishing | 112.5 | snape grass | 50 |
| kwuarm | 5 | super strength | 125 | limpwurt root | 55 |

Marrentill, cadantine, lantadyme and dwarf weed are left out: their secondaries (unicorn horn
dust, white berries, dragon scale dust, wine of Zamorak) are scarce.

**Curve (model `herblore`; 5.07 ticks per 14 mixes m, herblore.md section 2):**

| Irit held | Rest as attack (guam) | Rest as strength (tarromin) | Rest as energy (harralander) | Rest as the non-irit table mix |
|---|---|---|---|---|
| 391 | 0 | 0 | 0 | 0 |
| 300 | +98 | +33 | +16 | +24 |
| 200 | +206 | +69 | +33 | +52 |
| 100 | +315 | +105 | +50 | +79 |
| 0 | +424 | +141 | +68 | **+106** |

The whole table mix including irit is 654 potions, **+85** (i), and needs only ~891 herb drops.

**Breakpoint:** none. Never wait for irit: a guam-only fill is the one expensive case (+1.09 per
irit short), and the gatherer never holds guam alone.

**Start condition: no.**

**Knock-on (H21e).**

- **Stacks:** ~10-14 noted stacks (each herb's unfinished potion and its secondary), so the booth
  deposit grows by a few ticks (+~2 i per stack).
- **Helper Herblore levels:** the helpers need Herblore 50 and 55 for the avantoe and kwuarm
  unfinished potions (`brew_potion.struct` r).
- **Secondaries:** limpwurt roots and snape grass join the herb gatherer's list.

## 6. Cosmic runes (S04; H1): resolved

rs/123 reports 60 cosmic runes reachable from Lundail in ~25 minutes, so no fallback is needed.
For the record, the insurance is cheap. Low Alchemy (level 21, 31 base, 3.00 ticks per cast m,
magic.md section 4) on **one noted stack** works with no bank and no ring trades: `alchemy.rs2`
deletes one item from whatever stack it is cast on, with no note check (r). It needs one nature
rune per cast (Magic Guild, 1,000 in stock, `magic_guild.inv` r). Low Alchemy beats the sapphire
enchant per tick (10.3 against 5.8 base, m) and sits near the emerald (12.3). From 43, Superheat
(17.7) sits near the ruby (19.7). So cosmics are worth ~5-6 ticks each only on Magic 7-21, where
the alternative is Wind Strike. Twelve cosmics (the sapphire band) keep a cosmic shortfall under
~30 ticks (e). It changes nothing at 51 or 59: both gates are reached, only later in S04.

## 7. Nature talismans (S21; H17)

**What binds.** A talisman is used on the ruins to enter and is not consumed. The exit portal
needs none (r, `runecraft.rs2:1-45`, runecraft.md section 4). So a talisman only has to be
**outside the ruins at the moment a giver enters**. rs/123's **talisman keeper** (proposed to
rs/117) stands at the ruins. Each giver hands it the talisman on the way out and takes one on the
way in. Separately, SCORED can stage givers while it is logged out. Logged-out ticks are free,
and SCORED's relog puts it behind the givers in the player loop, which the 7-tick cycle needs
(RUN-ORDER section 4).

**Model (model `runecraft`).**

- **Plan:** S21 is 161 crafts at 7 ticks (1,132; m cycle).
- **Extra batch:** each extra batch of givers costs one relog (3.6 i: 2 m plus the tail) and one
  session-opening trade (5 m), so 8.6.
- **Keeper pipeline:** about **R = 25 ticks per entry (e)**: keeper trade ~5, enter 2-3, walk 3,
  the turn, walk 3, exit, hand back ~5. While SCORED is in, a keeper with T talismans feeds T/25
  givers per tick against the 1/7 the cycle consumes. While SCORED is out, it can stage the whole
  roster of ~17 givers with any T.

| Nature talismans held (all accounts) | With a keeper | Without a keeper (relog batches of T givers) |
|---|---|---|
| 1 | **+52** (7 batches) | +1,376 (161 batches) |
| 2 | **+34** (5 batches) | +688 (81 batches) |
| 4 | **0** (continuous) | +344 (41 batches) |
| 6 | 0 | +224 (27 batches) |
| 17 (one each) | 0 | 0 (rs/117's roster) |

**Altars and fallbacks that need no nature talismans** (model `runecraft`; crafts at 7 ticks; travel
change against T20-21's 90 i, e):

| Fallback | Crafts 44-99 | Essence | Delta | Talisman |
|---|---|---|---|---|
| Body altar, 7.5 base per essence, ruins (3052,3444) south of Edgeville | 194 | 5,238 (+891) | **+205** | body: hill giants drop 1-5 per account-hour (BONES); rs/41's banks held 7+ at 07:20 UTC |
| Fire altar, 7.0 | 207 | 5,589 (+1,242) | +322 | not checked |
| Air altar, 5.0, ruins (2984,3291) | 290 | 7,830 (+3,483) | **+868** | Duke Horacio, goblins |
| SCORED leaves the room each cycle (nature, its own talisman, 26 per trade) | 168 | 4,368 | **+3,073** at 25 ticks stock (m, runecraft.md section 4); ~+2,230 at ~20 tuned (e) | 1 |

The issue's "32 ticks per cycle" is the law altar's figure. At the nature altar, leaving the room
measured 25 (runecraft.md section 4).

**Breakpoint.**

- **With a keeper:** four talismans run the cycle continuously, and one or two cost +34 to +52.
- **Without a keeper:** batching beats the air altar from 2 talismans (+688 against +868), but
  only by piling up dozens of relogs, each carrying the relog tail (R1). Below ~6 talismans
  without a keeper, take the body altar if body talismans are in hand (+205), else the air altar.
- **Never the leave-the-room cycle.**

**Start condition: no, if rs/117 builds the keeper**; otherwise yes, at 6 or more talismans or a
change of altar.

**Knock-on.**

- **H17:** the keeper becomes a role, and the roster sizes givers, not talismans.
- **Without a glory (section 11):** the givers' round trip grows from ~110 ticks toward ~200-250
  (e). That costs wall time while SCORED is logged out, not score. In the batch plan the batch size
  is set by the giver accounts, not the round trip. Without a keeper, a longer round trip only
  makes the continuous roster worse.
- **Main's relog rule (RUN-ORDER section 4):** 4-6 extra relogs (keeper, 1-2 talismans) pay for
  themselves against any altar change.
- **Body or air altar:** S21 moves. T20-21 becomes a Falador teleport and a walk (-26 to -35, e),
  and H17 needs the extra essence. Essence is covered at 4,536, not at 5,238 or 7,830.

## 8. Rune knives (S27; H23): unobtainable (rs/124)

No shop in this revision sells knives or darts of any metal (r: `ranging.inv` sells arrowheads,
arrows, javelins and thrownaxes; knives exist only as `smithing.inv` products, 5 per bar). Rune
knives need Smithing 92 and 160 runite bars. Adamant and mithril knives need the bars that are
already short. rs/124's substitute is the **magic shortbow and rune arrows** (Dargaud, Ranging Guild,
400 in stock).

**Delta (model `combat`, i).**

- **Hand share:** the bow's own hand rate is 0.905 of the knives' (m, ranged.md section 4: 7.36
  against 8.13 at Ranged 70, no cannon).
- **Cannon share:** the cannon rolls on the wielded weapon's style and bonus (r, `cannon_fire.rs2:116`).
  The bow's +69 ranged attack against the knife's +25 lifts its hit chance on the spiders from
  0.800 to 0.861 (r formula, helper-fed-and-combat.md section 1), so the cannon's share rises by
  ~8%.
- **Net:** S27 1,853 against 1,857, **-4**, well inside the error.

rs/124 is measuring cannon + bow at Ranged 70, 85 and 99. Its figure replaces this one when it
lands.

**Start condition: no.**

**Knock-on.**

- **H23:** ~500-560 rune arrows (0.3 shots per tick over the phase, e; rs/124 has the same
  figure) in place of 760 knives. The magic shortbow is already in H12.
- **S27 script:** wield the bow from Ranged 70 instead of knives. The 3-tick rapid clock changes
  the flick schedule's re-attack tick (helper-fed-and-combat.md section 3), which rs/124's lab
  should check.

## 9. The cannon: set and 1,400 cannonballs (S13, S14, S27; H11, H11r, H23)

**What is restricted.** Setting a cannon up needs Dwarf Cannon complete (r, `cannon_setup.rs2:52-56`).
SCORED completes it at S13, so the restricted part is only who supplies the set and the balls.

- **The set.** Nulodion sells the full set to anyone with `%mcannon` complete: 750,000 coins, or
  200,000 per part (r, `nulodion.rs2:68-80`). **SCORED can buy it itself after S13.** That is a
  detour from Lawgof to the Black Guard base in the Dwarven Mine, then to the Edgeville lever
  instead of the Ardougne one: **~+50-100 ticks (e**, matrix rule; rs/104 can measure it). The
  coins ride H10, and the fleet holds 2.34M (rs/124). After S14, H11r and H23 can be done by any
  helper; holding cannon parts needs no quest.
- **The cannonballs** are the hard part. No shop sells them (r: Nulodion's `mcannonshop` stocks
  the four parts, the manual and the mould only). Only a player who has completed Dwarf Cannon can
  make them, with the untradeable mould, from steel bars. So the line is **one helper who has done
  Dwarf Cannon** (helper time is free) **plus ~290 steel bars** for ~1,170 balls (4 per bar, r,
  `cannonballs.rs2`), or GE balls.

**Balls actually used (i).** About 0.59 shots per tick in the finish (m: 20.9-23.1 Ranged per ball
at 12.35-13.66 Ranged per tick, helper-fed-and-combat.md section 3), so ~1,100 over S27's 1,857.
S14 uses ~58 (bare scimitar, 22.5 per ball at 11.52 per tick, m). That is **~1,160-1,170 in
all**, and SUPPLIES.md's 1,400 keeps ~230 of margin.

**Partial stock (model `combat`, i).** Give the balls to S14 first, where each is worth ~9.2
ticks: 19.6 Ranged per ball against the knives-only 1-50 average. In the finish, each ball short
costs **+2.18**: its 20.9 Ranged is earned at the hand share of 9.60 per tick instead.

**No cannon at all.** Dwarf Cannon's value on Package B (i, model `combat` plus quests README
sections 3 and 6):

| Change | Ticks | Basis |
|---|---|---|
| S13 Dwarf Cannon dropped | -976 | Q section 3 (i) |
| Its quest point: Sheep Shearer | +68 | Q section 7 (i) |
| Crafting from a lower start | +29 | crafting.md section 3 (Dwarf Cannon saves ~29) |
| S14: Ranged 1-50 by hand with bows (knives are unobtainable) in place of 123 | ~+600 | e: ranged.md's 628 for rune knives, x ~1.15 for bows |
| T13-14 and T14-15 (146 + 129) replaced by a non-Wilderness leg to the Grand Tree | ~-145 | e |
| S27 by hand: magic shortbow + ranging potion, Defence gap at the ogres (9.34, rs/30) | +2,441 (4,298 against 1,857) | i: ranged.md sweep x 0.905 for the bow, x 1.21 for the potion |
| T26-27 (164) to a non-Wilderness site | ~-100 | e |
| **Net** | **~+1,900** | the quests README's value table has +2,090 with knives (no kit) |

Without a hand weapon the sum is larger. Without a cannon but with knives, S27 by hand is 4,695 (i).

**Breakpoint.** The set: a helper's, or SCORED buys it (+50-100). The balls: ~1,170. Short of
that, each ball costs 2.18 ticks, so a few hundred short is still far better than no cannon.

**Start condition: yes: a cannon set (helper's or bought) and at least ~1,170 cannonballs.** Start
a helper through Dwarf Cannon now. This needs no SCORED time and also removes R8's spare-set
worry, because Nulodion replaces a lost cannon for its owner (`nulodion.rs2:91-143`).

**Knock-on if SCORED buys the set.**

- **H10:** +750,000 coins (one stack).
- **H11:** no cannon set and no cannonballs at Lawgof; the balls meet SCORED at the lever or the
  spiders instead.
- **T13-14:** re-routed via Nulodion and the Edgeville lever.
- **H11r and H23:** any helper can take them.

## 10. Rune scimitar (S14, S27; H11): unobtainable (rs/124)

The cannon's accuracy in the cannon-only phases (S14, and S27 up to Ranged 70) uses the wielded
weapon's slash roll. The defensive-melee phase (168 ticks) uses its strength and speed too.
Weapon bonuses (r, `scimitars.obj`, `longswords.obj`, `2hswords.obj`):

- rune scimitar: slash +45, strength +44, 4 ticks;
- rune longsword: +47, +49, 5 ticks;
- adamant scimitar: +29, +28;
- mithril scimitar: +21, +20;
- rune 2h sword: +69, +70, 7 ticks.

The hit chances follow helper-fed-and-combat.md section 1's formula (model `combat`, i):

| Weapon | S14 delta (113 m) | S27 cannon factor | S27 melee Defence factor | S27 delta | Source |
|---|---|---|---|---|---|
| rune scimitar (plan) | 0 | 1.00 | 1.00 | 0 | |
| **rune longsword** | -1 | 1.00 | 0.87 (5-tick swing) | -1 | Scavvo, 32 QP: a helper with 32 quest points buys it |
| adamant scimitar | +5 | 0.97 | 0.86 | +7 | not in Zeke's stock (rs/124) |
| **mithril scimitar** | +9 | 0.96 | 0.77 | +12 | Zeke, Al Kharid |
| rune 2h sword, cannon-only phases only | -5 | 1.03 | (not for melee) | -7 | not checked |

**Start condition: no.** The mithril scimitar costs +21 at most, and a 32-QP helper's rune
longsword costs nothing. The longsword's slower swing barely matters, because the Defence gap is
only 1,288 base. Knock-on: H11 carries the fallback weapon.

## 11. Amulet of glory, charged (S27 kit; T14-15, T20-21, S24, T26-27; H11, H20, H23): unobtainable (rs/123)

**The S27 kit (model `combat`, i).** The glory adds +10 to every attack bonus and +6 melee strength.

- **Without it, with knives:** the ranged hit chance falls from 0.800 to 0.777, and the melee hit
  chance from 0.855 to 0.841 with a max hit of 24 against 25. **+50**.
- **Without it, with the bow (section 8):** **+20** against the plan.

helper-fed-and-combat.md section 3 measured the glory only together with the ranging potion
(config 3), so these are formula estimates on measured shares.

**The legs (e, T&O matrix rule; rs/104 is re-measuring all of them without glories):**

| Leg | Today | Without a glory | Delta (e) |
|---|---|---|---|
| T14-15 | walk to Wilderness 30, glory to Edgeville, spirit trees (129 i) | walk ~80 tiles further south to Wilderness 20, Varrock teleport, walk to the young spirit tree | ~+50 |
| T20-21 | glory to Karamja, ~150 tiles (90 i) | Ardougne teleport and the Brimhaven ship, or the Port Sarim ship to Musa Point, then ~130-240 tiles | ~+110-130 |
| S24 | glory to Draynor, the Rusty Anchor | Falador teleport, ~145 tiles south to Port Sarim | ~+55 |
| T26-27 | the lair's exit, glory to Edgeville, the lever to the spiders (164 i) | Varrock teleport, ~130 tiles to the Edgeville lever | ~+75 |
| **Legs in all** | | | **~+290 (e)** |

The nature-altar givers' round trip also used a glory to Karamja. In the keeper and batch plan
(section 7) that costs wall time only.

**Start condition: no.** Knock-on: H11, H20 and H23 drop their glories, and each leg adds its
teleport runes: Varrock and Falador runes in H11 and H20, Ardougne runes and the ship fare for
T20-21.

## 12. Rune armour (S26 Dragon Slayer; H22): helm by drop only, chain and legs from Scavvo (rs/124)

Scavvo trades only with 32-QP players, upstairs in the Champions' Guild. **S26 starts inside that
guild**: the Dragon Slayer start is the Guildmaster at the door. So SCORED can buy the chainbody
and platelegs itself on arrival: stairs both ways, one shop session, **~+15-20 ticks (e)**. The
base prices are 50,000 and 64,000 coins; with H22's existing 12,000 that is ~130,000 in all.
The rune full helm (drops only) falls back to an adamant full helm, worth a few Defence bonus
points at Elvarg: **~+5 (e)**.

The all-adamant fallback (rs/41's insurance set) re-prices Elvarg (measured at 99 ticks in rune)
and Melzar's Maze through the damage taken and the eating it causes. That is **~+20-60 (e)**,
unmeasured.

**Start condition: no.** Knock-on: H22 gains ~115,000 coins, and S26 opens with the Scavvo
purchase.

## 13. Rune axe (S07; H4): no seller, a competitor bids 100,001 (rs/124)

The axe sets only the success roll's lo/hi pair; every axe swings on the same 4-tick clock, or
3-tick with the knife (r, `woodcut.rs2:249-262`, `trees.dbrow`; woodcutting.md section 4). The
formula matched 5,707 measured rolls (m, woodcutting.md section 4), and the pairs are read
(`trees.dbrow`):

| Tree | Rune | Adamant | Mithril |
|---|---|---|---|
| oak | 112/350 | 96/300 | 80/250 |
| willow | 56/175 | 48/150 | 40/125 |

Model `woodcutting` integrates the ideal rate per level, taking the best tree for each axe. The
ratio applies to both of S07's columns (i). The model ignores tree depletion, which a slower axe
meets less often, so the ratios are a little high.

| Axe | Willow beats oak from | Ticks ratio | S07 knife delta (3,460) | S07 plain delta (3,958) |
|---|---|---|---|---|
| rune (plan) | 73 | 1.00 | 0 | 0 |
| adamant | 92 | 1.13 | **+457** | +523 |
| mithril | 99 | 1.28 | +960 | +1,098 |

**Breakpoint.** A rune axe is worth ~457 ticks, far more than any other single item on the list.
It can be bought (a competitor bids 100,001 for 43), or smithed (Smithing 86 plus one runite bar,
~40,000 gp, rs/124). Bid well above the competitor, or put a helper on smithing it.

**Start condition:** a budget item, like the dragon bones. It must be in H4, staged before
SCORED's first login.

**Knock-on:** with an adamant axe, the willow tile (T07a) moves from Woodcutting 73 to 92, and the
oak stretch lengthens. No adamant axe is sold in any shop either (rs/124), so the fallback axe
itself needs a seller.

## Open items

- **rs/112:** an adult blue rate. Every adult blue bone counts as a dragon bone here (+2.90 ticks
  saved over a babydragon bone).
- **rs/124:** cannon + magic shortbow at Ranged 70, 85 and 99. It replaces section 8's -4 (i).
- **rs/104:** the legs without glories. They replace section 11's ~+290 (e), the largest
  estimate on this page.
- **rs/117:** the talisman keeper's pipeline time (R = 25 e) and the number of giver accounts. It
  sets section 7's batches.
- **rs/119:** an adamantite rate, plus the extra mithril bars (section 2) and the ~290 steel bars
  for cannonballs (section 9).
- **Unmeasured fallbacks:**
  - Elvarg in adamant armour (section 12);
  - the no-cannon route's hand-ranged 1-50 with bows (section 9; it matters only if the cannon
    fails);
  - SCORED's Nulodion detour (section 9).
