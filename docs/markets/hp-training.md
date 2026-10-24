# Fresh-account Hitpoints trainer (rs/553)

Phase 2's setup step (`phase2.md` 'Setup'): bring a fresh account's Hitpoints up before it pickpockets the
Ardougne knights or heroes, so it stops eating on almost every failure. Code: `markets/methods/hp-train.ts` (the
trainer, which rs/544's runner calls), `markets/methods/hp-model.ts` (its pure logic, tested in
`hp-model.test.ts`), `markets/methods/lab/hp-run.ts` (the lab measurement from a truly fresh account),
`lab/hp-report.ts` (the table below from the runs' JSONL) and `lab/hp-site.ts` (the site probe).

Labels: m measured in the lab, i inferred (the model, or arithmetic on measured parts).

```sh
bun markets/methods/hp-train.ts acct01 [--to 40] [--out FILE]      # the defaults: the cows, no shop, no coins
bun markets/methods/hp-train.ts acct01 --site farm                  # any low site (section 2b)
bun markets/methods/hp-train.ts acct01 --to 70                      # the crabs route (auto above ~52 HP)
bun markets/methods/hp-train.ts acct01 --to 40 --prayer 31 --pray   # the Prayer-first variant (slower; see below)
```

It attaches to the account's running lite client like the live probes (`probe-sampler.ts` `runProbe`: a JSONL
sample every 50 ticks, events, and one totals line with the tick and wall time of every Hitpoints mark, the
kit, food, bank trips, altar visits, deaths and coins), and always leaves through `logoutClean`.

## 1. Answer

| Target | Plain (the default) | Prayer-first | Basis |
|---|---|---|---|
| **HP 40** | **1,707 and 1,972 ticks (11.4 and 13.1 min)**, mean 1,840; Attack 30, Strength 52, Defence 1; 0 coins, no food bought, no deaths | **~2,720 ticks (18.1 min)** with Prayer 31: HP 40 at 2,634, Prayer 31 at 2,717 after 71 cow bones; 0 coins; one altar visit, 31 prayer points used | m, 2 plain bots and 1 Prayer bot in parallel |
| HP 70 | **6,028 ticks (40.2 min)**, Attack 53, Strength 84; 32 kebabs, 1 bank trip; iron and steel only | 8,707 (Prayer 34), 10,507 (31), 11,798 (43) | m, 1 clean plain sample; 3 Prayer bots |
| HP 80 | 9,855 ticks (65.7 min), Attack 61, Strength 94; 46 kebabs, 2 bank trips | not run | m, 1 sample |
| HP 99 | not reached in this session (the plain bots were still climbing, past 80); **~24,400 ticks by the model** with the full kit, ~26,000 with iron and steel (i); the lab ran ~1.4x the model to 70 | not run | i |

- **Plain wins at every level measured.** Prayer-first loses because the bones come from cows: Prayer 31 is 71
  cow bones, 34 is 90 and 43 is 175 (m), each picked up and buried between kills, while the boost they buy
  lasts ~107 ticks of Ultimate Strength and Incredible Reflexes per altar visit (0.4 points a tick,
  `prayer.rs2`). Even with both prayers on for the whole climb, which nothing near the sites can restore, the
  model saves only ~420 ticks to 70 and ~40 to 40 (i). No Prayer target (31, 34 or 43) beats plain to 40, 70
  or 99. It stays behind `--prayer N --pray`.
- **To 40 the trainer ties rs/543's measurement of the fleet's `bones.ts` cow trainer** (1,822 ticks, bgsrv-ub,
  402.7 ms). It does not train Defence (useless for pickpocketing), so it arrives at Attack 30 and Strength 52
  rather than three skills in the 20s, and it scales: above ~52 HP it switches to the rock crabs, where `bones.ts`
  would stay on the cows (rs/543's timeline flattens after 50; 7,620 ticks to 70 on cows by the model, i).
- **Compared with nick's ~13,600 ticks for six combat skills to 99** (`speedrun/research/competitors/hiscores.md`):
  that block feeds Hitpoints from melee, Ranged and Magic at once (each gives 1.33 Hitpoints xp a damage), so it is
  not a melee-only figure. Melee alone, Attack and Strength trained on the way, needs ~24,400 ticks to 99 by the
  model (i).

## 2. Method

**Hitpoints xp is 1.33 base per damage in every melee style** (`combat.rs2`), so the trainer maximises damage per
tick. `hp-model.ts` holds the engine's formulas (`player_combat_stat.rs2`, `combat.rs2`, `npc_combat.rs2`): hit when
`randominc(attack roll) > randominc(defence roll)`, uniform 0 to max hit, capped at the npc's hitpoints, and
`expectedSwings` turns that into the expected swings per kill. At Attack and Strength 40 with a mithril scimitar
it gives 0.72 damage a tick at the crabs; the lab probe measured 0.71. On the cows it put a fresh account at
Hitpoints 30 on Attack 20 and Strength 40 after 660 ticks of fighting; the lab measured 634 at the same levels.

**Style.** `chooseStyle` trains Attack (accurate) or Strength (aggressive), never Defence: whichever next level adds
more damage per tick per xp it costs, with each level judged on the best weapon it can wield, so the Attack level
that unlocks a carried scimitar counts its jump. In practice Strength leads Attack by ~20 levels (20/40 at HP 30,
53/84 at 70). The style is set again after every kill.

**Site.** `chooseSite`: the Lumbridge cows for targets up to ~52 HP, the cows to 30 and then the rock crabs above.

| Target | HP / defence / defence bonus | Damage per tick, Attack and Strength 40, mithril (i) | Notes |
|---|---|---|---|
| **Rock crabs**, north-east of Rellekka (34 spawns, `quest_viking/configs/horror_rockcrab.npc`) | 50 / 1 / 0 | **0.72** (0.71 m) | Max hit 1. Dormant as "Rocks" until a player stands next to one. The whole field is multi-combat (`multiway.csv`), so the trainer works only its sparser middle and east (20 spawns) and kills a crab hitting it before waking another. Seers' bank is 153 ticks away (m). |
| Lumbridge cows | 8 / 1 / -21 | 0.46 | Max hit 1. Every kill costs a retarget, so the rate flattens as the max hit passes 8. |
| Hill giants | 35 / 26 / 0 | 0.55 | Hit back hard enough to need food from 10 HP. |
| Moss giants, ogres | 60 / 30-43 / 0 | 0.48-0.56 | The same, and further from a bank. |

An earlier note (`speedrun/research/helper-fed-and-combat.md`) read the crabs as quest-only; their spawns are in
the open world (maps `m41_58`, `m42_58`) and reachable on foot from Seers' Village.

**Route above ~52 HP** (`--to 70`): Draynor bank for coins, the Al Kharid toll (10), Zeke for the scimitars, Karim
for kebabs, the cows to 30 HP, then White Wolf Mountain to Seers' (`speedrun/lib/kandarin.ts`; 12 of 14 arrived at
30 HP), eating up to 30 first instead of resting (regeneration is 1 per 100 ticks), then the crabs, with a bank
trip to Seers' for kebabs when the pack is empty. It ends in Kandarin, ~100 tiles from the Ardougne knights.

**Kit.** The tutorial's bronze sword to 52 HP: `shopPays` weighs Zeke's errand (~390 ticks of walking) against
what the scimitars save on the cows, 144 ticks to 40 (i), so the 40 route spends nothing. Above, one visit to Zeke
buys every tier the coins cover (iron 112, steel 400, mithril 1,040; no shop sells adamant or rune scimitars, and
the Champions' Guild's rune weapons need 32 quest points), each wielded as Attack reaches it (5 for steel, 20 for
mithril). One visit is the cheapest path in time: a second is a walk back over the mountain. **Zeke stocks one
mithril scimitar (one back per ~4,000 ticks, `alkharid.inv`) and two steel**: in the lab the second and later bots
found them gone. Iron and steel to 70 cost ~6% against the full kit (i). With 45 accounts most will lack mithril
unless it comes from the Grand Exchange.

**Food.** None to 40 on the cows; the tutorial's shrimps and bread are eaten at 4 HP. On the crabs route,
kebabs from Karim in Al Kharid (1 coin each, next to Zeke): they heal 3 + 7%, 6 + 14% or 7 + 24% of base Hitpoints
(`kebab.rs2`), ~6 at 30 HP and ~10 at 80, and are eaten at half of maximum Hitpoints, below which none is wasted.
34 bought (the default estimate, `kebabsFor`) carry an account from 30 to ~70; the plain run ate 32 to 70 and 46 to
80 (m). The bank is one bank, so the spares deposited in Al Kharid are withdrawn at Seers'. The crabs take ~0.07 hp
a tick from a Defence-1 account (142 in 1,943 ticks, m).

**Deaths.** A fresh lab bot was killed on the cows by something that was not a cow (a random-event npc, i).
The trainer recovers from up to 3 deaths: the respawn keeps the three most valuable items (the scimitars), so it
wields again and walks or crosses back.

## 2b. Many fresh accounts at once: the low sites and npc claims (rs/632)

One site cannot feed many bots. A site gives back only its spawns' hitpoints over their respawn times, and a bot at
full pace on the cows deals ~0.6 a tick (1,085 damage from HP 10 to 40 at 25x xp, ~136 cow kills). The Lumbridge
pen's 10 cows give 0.89 a tick, about 1.5 bots' worth: in rs/544's lab 20 accounts there took 3,389 ticks and more,
and most were still under 30 after 5,300. So the trainer has seven low sites, each holding only targets with Attack
and Strength 1 and negative bonuses (cows, goblins, chickens), which hit a Defence-1 account as seldom as the cows
do (no food needed). `Site.supply` is Σ hitpoints / respawnrate over the site's map spawns:

| Site (`--site`) | Spawns | Supply (hp a tick) | Default cap (accounts) |
|---|---|---|---|
| `cows`: the Lumbridge pen | 10 cows | 0.89 | 4 |
| `goblins`: east of the Lumbridge river | 21 goblins | 0.75 | 3 |
| `chickens`: the Lumbridge farm pen | 9 chickens | 0.54 | 2 |
| `farm`: between Draynor and Falador | 7 cows, 6 chickens | 0.98 | 4 |
| `champions`: south of the Champions' Guild | 7 cows | 0.62 | 2 |
| `crafting`: south of the Crafting Guild | 10 cows | 0.89 | 4 |
| `sarim`: west of Port Sarim | 12 goblins | 0.43 | 2 |

Left out on purpose: giant rats (`cowardly` hunt mode attacks weaker players), men and women (the coins earner's
thieving targets), ducks (on water), imps (they teleport). Every weak target within reach of Lumbridge totals only
~5-11 hp a tick, so these seven sites are most of what exists for melee-only fresh accounts.

**Claims.** Bots on one site pick the same idle npc in the same tick: live, markets saw three of ours click one cow
within a second. `TargetClaims` (one per process, the phase-2 runner's) gives each npc to one bot: a bot never picks
an npc another holds, an npc another bot holds no longer counts as hitting it, and a kill stays claimed for 5 s (the
killer sees the death a tick before the others, and without the hold a second bot clicked the corpse 0.1-0.75 s
later). A claim lapses after 20 s without renewal, so a stalled bot frees its npc. Each pick, drop, switch and
end-of-fight release is an event, which `markets/phase2/report.ts` `hpCollisions` checks.

The allocation of accounts to sites and the queue when every site is full are the runner's (`phase2.md` 'Running').
Measured: 22 fresh accounts at once, all at HP 40 within 25 minutes of login (`phase2.md` 'Hitpoints sites in the
lab').

## 3. The Prayer-first variant

`--prayer N` loots and buries the cows' bones until Prayer N before leaving the cows; `--pray` then keeps the best
melee prayers on (Ultimate Strength 31, Incredible Reflexes 34, and Protect from Melee at 43 on the crabs, where it
would save food), restoring at Lumbridge church (80 tiles from the cows) during the cow phase and at Seers' church
on each crab bank trip. Every altar is 212 or more tiles from the crabs.

| Bot | Kit | Prayer reached (m) | HP 40 | HP 70 | Prayer points used at the crabs |
|---|---|---|---|---|---|
| Prayer 31 | iron | 31 at tick 4,236, 71 bones | 3,447 | 10,507 | 217 |
| Prayer 34 | iron | 34 at 4,885, 90 bones | 3,267 | 8,707 | 68 |
| Prayer 43 | iron, steel | 43 at 7,079, 175 bones | 3,311 | 11,798 | 258 |
| Plain (for comparison) | iron, steel | - | 2,307 | 6,028 | - |

These ran the crabs route (`--to 70`) beside the plain bots. Their kit was iron (Zeke's steel had gone), worth
~6% (i), not the 2,700-5,800 ticks they lost. They never needed an altar: each finished the cow phase with full
points and spent them in its first crab trip, before any bank trip. To 40 on the short route (the cows, no shop)
the Prayer-31 bot took ~2,720 ticks against 1,707-1,972 plain: HP 30 at 1,655 against 859-1,028, the bones
costing ~10 ticks a kill to pick up and bury, and its prayers were on for one pool of points before the target.
**Prayer 31 minimises the variant's time to 40 and to 70 (34 measured faster to 70, inside the spread of single
runs); none of 31, 34 or 43 beats plain at any target.**

## 4. How it was measured

- **Host** fedora, `NODE_TICKRATE=400` (`observedMsPerTick` 400 in every totals line), port block M10, the lab
  copied to `/tmp/rs553-lab` and run in a tmux server so the 3-hour labs outlived their batches. One-minute load
  1.8-31 across the night (another tenant's builds); the bot reacts in wall time, so a busy host is a few percent
  pessimistic.
- **Fresh accounts:** a new name per bot (`hp-run.ts`): Tutorial Island left through S00's skip, 2,000 coins (and,
  for the 99 runs, 260 kebabs, reported as staged food) put in the bank at Draynor by `::give`, a teleport back to
  the Lumbridge spawn. No `::setstat`: every level was earned. Bots ran 2-5 at a time on one engine, 10-30 s
  apart, so they shared the cows, the crabs and Zeke's stock, which is the crowding a phase-2 address would see.
- **Runs that count:** the 40-HP pair and the Prayer-31-to-40 bot on the final code; the 70 and 80 rows from the
  run before it, whose only changes since are the death recovery, the site choice and the mountain-side test
  below. **Runs that do not:** the first lab night's bots died at the crabs (they woke several crabs at once in
  the dense corner), one stood ~1,500 ticks beside a rock it could not reach, the lab bot killed on the cows ended
  its run, and the mithril bot of the 70 run (8,309 to 70) walked back over the mountain from the crabs and died
  there, because Kandarin was tested by the towns' box, which ends south of the crabs. Each is fixed in the code
  and covered where it is pure logic.
- **Damage taken** is counted from hitsplats with a source: the lite client also publishes the player's own hits
  on its target as `damage_taken` with source -1 (`lab/hp-site.ts`'s diagnostics).

```sh
# the 40-HP headline: two plain bots and a Prayer-31 bot, fresh, on block M10
. markets/methods/lab/block.sh M10 && LAB_HELPERS="b2 b3" speedrun/lab/lab.sh b1 \
  'markets/methods/lab/hp-run.ts:--bots=b1,b2,b3@prayer=31@pray=1:--stagger=10:--out=/tmp/hp40'
# the long route, to 99, with staged spare food
. markets/methods/lab/block.sh M10 && LAB_HELPERS="b2" LAB_TIMEOUT=21000 speedrun/lab/lab.sh b1 \
  'markets/methods/lab/hp-run.ts:--bots=b1,b2:--stagger=30:--to=99:--kebabs=34:--bank-kebabs=260:--out=/tmp/hp99'
bun markets/methods/lab/hp-report.ts /tmp/hp40-*.jsonl /tmp/hp99-*.jsonl
```

## 5. On the demo, not measured here

- The relay's reaction delay costs a few ticks a kill (the loop retargets once per kill, 8 HP cows die in 1-3
  swings, so it matters more on the cows than on the crabs).
- Other players at the cow pen and the crabs: in the lab the plain crab bot had another bot within 5 tiles in 22%
  of its samples; the demo's ~1,400 players were not emulated.
- Random-event npcs: the lab killed one bot; the trainer recovers, the time does not.
