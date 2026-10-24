# Bone collector (`speedrun/helpers/bones.ts`)

The bone collector supplies the scored account's Prayer. A helper kills monsters for
their bones and also loots coins and small valuables. It buys its food at the Grand
Exchange (baby blue dragons) or catches and cooks it (hill giants), banks, and reports the
bank after every visit through `ctx.reportBank`. The role produces `/bones$/` (role name
`bones`).

```
bun speedrun/helpers/bones.ts <account>                                  # standalone
ROLE_OPTIONS='{"spot":"hill_giants","train":50}' bun speedrun/helpers/bones.ts <account>
ROLE_OPTIONS='{"spot":"baby_blue","coinsFrom":"^cairn_h(6\\d|5[1-4])$"}' bun speedrun/helpers/bones.ts <account>
```

Labels: **read** (from the content or engine), **measured** (on rs-sdk-demo.fly.dev,
300 ms ticks, 25x xp, from bbs over a loopback gateway), **inferred** (estimated, not run).

## How much Prayer needs

- Base xp per bone (read, `skill_prayer/configs/bones.obj`, `bone_exp` in tenths): dragon 72,
  babydragon 30, big 15 (jogre bones are also 15), normal, bat and wolf 4.5.
- This server uses a `2^(level/10)` curve where 99 is 39,938 base. Holy Grail is off the
  route (rs/3), so the scored account buries the whole 39,938. **The plan (main, 2026-10-21)
  is 555 dragon bones for all of it** (rs/33 measured 1,221 ticks from level 1 to 99). The
  673 big bones banked on 2026-10-21 (10,095 base) are only a fallback. The table below
  prices the 29,843 base that would be left if that fallback were used.
- Cadence (measured by cairn://p/rs/33, PR `cairn://p/rs/33/1/builder/create-pr`): 2 ticks
  per bury is a hard floor for every bone (`bury_bone.rs2`, `p_delay(0)`). A 28-bone bank
  cycle costs 58 ticks, and 555 dragon bones took 1,221 ticks from level 1 to 99, about
  **2.2 scored ticks per bone all-in**.

| Bone | Bones for the remaining 29,843 base | Scored ticks (2.2 per bone) | Scored ticks per 1,000 base |
|---|---:|---:|---:|
| Dragon (72) | 415 | about 913 | 30.6 |
| Babydragon (30) | 995 | about 2,189 | 73.3 |
| Big (15) | 1,990 | about 4,378 | 146.7 |

Helper hours are free on the scoreboard; the scored account's ticks are not. The tier is a
5x lever: 415 dragon bones cost about 3,465 fewer scored ticks than 1,990 big bones. The
673 big bones already banked will cost about 1,481 ticks to bury, against about 308 ticks
for the 140 dragon bones that give the same 10,095 base.

## Where each tier comes from (read: npc configs, map spawns, scripts)

Every dragon drops its bones on every kill (`death_drop`) and respawns after 60 ticks. Every
dragon has huntmode `cowardly`, which despite the name **does attack first at close range**:
the hunt is `type=player` with `find_newmode=opplayer2` (`all.hunt`), so a dragon takes any
player within its `huntrange` (2 for baby blues, 4 for adult blues) as a target once neither
has fought for 8 ticks (`Npc.ts huntPlayers`); measured in [dragons.md](dragons.md). Spawn counts come from the
`==== NPC ====` sections of `server/content/maps/m<X>_<Z>.jm2` (world x = 64X + x).

| Monster (bones) | Where | Spawns | Access | Danger |
|---|---|---:|---|---|
| Baby blue dragon (30), level 48, 50 hp | Taverley dungeon (2892-2909, 9763-9806) | 9 | Dusty key: kill the Jailer (2933, 9693), take the jail key (it always drops), unlock Velrak's cell (2931, 9690) and accept his key (`velrak_the_explorer.rs2`). The room is behind the dusty-key door (2924, 9803), entered from the east after a loop round the dungeon from the ladder | No fire. Hits a 85-defence helper about one fish's worth per kill. The route passes aggressive poison scorpions and chaos dwarves |
| Baby red dragon (30), level 65, 65 hp | Brimhaven dungeon (2696-2708, 9500-9524), among 6 red dragons | 8 | 875 gp to Saniboch once; vines need an axe and a Woodcutting level; stepping stones need Agility 12 (`karam_dungeon.rs2`) | No fire; the red dragons nearby hunt players within their huntrange (see above) |
| Blue dragon (72), level 111, 105 hp | Taverley dungeon, in the baby blues' room; under the Ogre enclave south of Yanille (2568-2590, 9437-9461) | 4; 6 | As for baby blues; the Ogre enclave is not checked | Dragonfire |
| Green dragon (72), level 79 | Wilderness (3078-3098, 3810-3821), level 35-39 | 5 | Walk-in | Dragonfire; **PvP is live**: anyone within the wilderness level of your combat level can attack (`pvp_combat.rs2`) |
| Red dragon (72), level 152 | Brimhaven dungeon; deep wilderness (3181-3223, 3819-3850) | 6; 4 | As for baby reds; wilderness | Dragonfire; PvP |
| Black dragon (72), level 227 | Taverley dungeon (2829-2835, 9824-9826); wilderness dungeon | 2; 2 | | Dragonfire |
| King Black Dragon (72) | Wilderness lair | 1 | | Out of reach |

Dragonfire (read, `npc/scripts/dragon.rs2`): one attack in four, max 30, or 50 when the
dragon's magic roll beats the player's defence. Protect from Magic (`%prayer12`) caps it at
10, the anti-dragon shield at 5, and an antifire potion takes 15 off. The Duke gives the
shield only after Oziach has told you about it in Dragon Slayer, or after the quest
(`duke_horacio.rs2`), and Dragon Slayer needs 32 quest points to start. Protect from Magic
drains 1 point per 3 seconds (`prayer.rs2`: a 5-tick timer, drain effect 12 against a base
resistance of 60). A blue dragon takes an 85-combat helper with a steel longsword about a
minute, so about 20 points per kill: two kills per altar visit at Prayer 43.

## Method comparison (per account-hour and per 1,000 base xp)

| Method | Requirement | Fresh helper to requirement | Bones per account-hour | Base xp per account-hour | Account-hours per 1,000 base | Scored ticks per 1,000 base | Risk | Status |
|---|---|---|---:|---:|---:|---:|---|---|
| **Hill giants**, Edgeville dungeon (12 spawns, level 28) | Melee about 50, food | **0.42 h measured** (20 min to 50/50/50 on cows, 4.5 min fishing/cooking kit) | **161-166 measured** (117 in a fresh account's first hour) | 2,475 | 0.40 | 146.7 | None | **Built; ran 3 accounts unattended** |
| **Baby blue dragons**, Taverley dungeon, GE sharks | Dusty key (3 min to fetch), melee 75+ (food cost below), coins | 1 h on cows to 60 (measured); 75+ cheapest on hill giants | **about 98 measured** at 90 combat alone (bag-bound: 20-24 bones a trip); see the 4-account run below | 2,940 | 0.34 | 73.3 | Aggressive monsters on the approach; two bootstrap deaths recorded (see below) | **Built; 4 accounts run (rs/87)** |
| Baby red dragons, Brimhaven dungeon | 875 gp, axe and Woodcutting, Agility 12 | About 1.5 h (inferred) | about 50 inferred | 1,500 | 0.67 | 73.3 | Low | Not built |
| Blue dragons with Protect from Magic, Taverley | Prayer 43 (about 28 babydragon bones buried by the helper), dusty key, melee about 85 | About 2 h (inferred) | about 20-25 inferred (2 kills per altar trip) | 1,600 | 0.6 | 30.6 | Dragonfire up to 10 per breath | Not built |
| Green dragons, wilderness | As above, plus PvP | | about 20 inferred | | | 30.6 | **PvP** and a 280-tile wilderness walk | Not built |
| **GE: dragon bones** (536) | Coins | | **Sell flow about 15 an hour** (below) | | | 30.6 | Price competition | Not yet bought |
| GE: big bones (532), babydragon bones (534) | Coins | | 0: never traded | | | | | Not a source |

**GE: dragon bones**, read from `/api/market/items/536` and `/history` at 08:30 UTC on
2026-10-21. There is never a standing ask, because sellers fill the highest bid at once. A
standing bid of 5,000 gp for 1,374 more (someone else's) has absorbed every sale:
118 dragon bones in the last 8 hours, in lots of 9-41 (hours starting 23:00, 03:00, 04:00,
06:00 and 07:00 UTC), all at 5,000 gp. At ~200k gp per coin-earner hour, 415 bones at
5,000-5,500 gp cost 2.1-2.3M gp, about 11 coin-earner hours. Babydragon and big bones
have never traded.

## Tier choice

**Decided (main, 2026-10-21): 555 dragon bones, filled in the order dragon bones from the
GE, then baby blue dragons, then the banked big bones.** No more big bones are gathered.

| Fill order | Source | Covers | Scored ticks |
|---|---|---|---|
| 1 | GE dragon bones (rs/63's bidder: 6,000 gp, +1,000 per stalled hour, cap 12,000) | 555 for the whole 39,938; the first 11 (Prayer 43) early | 1,221 for 555 (measured, rs/33) |
| 2 | Baby blue dragons, farmed (`spot: 'baby_blue'`, up to 4 accounts) | (39,938 - 72 x dragon bones) / 30 babydragon bones: 1,332 if no dragon bones arrive | about 2.2 per bone |
| 3 | The 673 banked big bones | 10,095 base, if 1 and 2 fall short | about 1,481 |

Costs and capacity:

- **GE.** 555 bones cost 3.3M gp at 6,000, up to 6.7M at the 12,000 cap: 17-33 hours of
  coin earners at ~200k gp per hour.
- **Baby blues.** About 98 an hour from a 90-combat account (measured, rs/87), at about
  0.3 sharks per bone. 1,332 babydragon bones (the whole target with no dragon bones)
  would be about 14 account-hours at 90 combat. The food is the cost: see 'Baby blue
  dragons with GE food' below.
- **Coins per Prayer xp** (rs/87): baby blues at 0.25-0.35 sharks per bone and ~900 gp a
  shark cost **about 8-10 gp per base xp** from a 90-combat helper, rising to about 30
  from a 65-combat one. GE dragon bones at 5,000-6,000 gp cost 70-83 gp per xp. Per coin,
  baby blues buy 3-10x more Prayer xp. Per scored tick, dragon bones still win (30.6
  against 73.3 scored ticks per 1,000 base).
- **No farmed dragon bones tonight.** Every 72-xp dragon breathes fire. The anti-dragon
  shield needs Dragon Slayer (32 quest points). Protect from Magic drains about 20 points a
  kill. Green dragons are in PvP wilderness. If the GE dries up before the early 11 arrive,
  the backstop is a Prayer-43 helper (about 28 of its own babydragon bones) taking the four
  Taverley blue dragons under Protect from Magic, two kills per altar visit. That is not
  built.

**Another fleet is on the same Prayer lever.** The standing 5,000 gp bid for dragon bones
is not ours, and it is large. At 05:50 UTC on 2026-10-21 it wanted 1,455 (7.3M gp in
escrow); by 08:30 it wanted 1,374, so it bought 81 in under three hours. All 19 dragon
bone trades ever recorded on the demo (626 bones) were at 5,000 gp, which suggests that
bid, or a predecessor at the same price, has taken every sale. Hourly fills in the
`/api/market/items/536/history` read at 08:30 UTC:

| Hour starting (UTC, 2026-10-20/21) | Bones | Trades |
|---|---:|---:|
| 23:00 | 11 | 1 |
| 03:00 | 17 | 2 |
| 04:00 | 9 | 1 |
| 06:00 | 41 | 2 |
| 07:00 (last fill about 07:08) | 40 | 1 |

So sellers come in a few lots an hour, 9-41 bones each, and the market price is set by
that bid. Any bid above 5,000 takes the next lot. The other buyer can answer by raising
theirs, which is why rs/63's bidder escalates. Someone who buries 1,455 dragon bones is
chasing roughly 99 Prayer under the same 25x curve. If they also race on ticks, every lot
we win is one they don't.

## Stages (re-chosen from observed state every cycle; each change logged as `phase`)

1. `tutorial`: `bot.skipTutorial()`. The starter kit has 25 coins, a small net, a bronze
   sword and a wooden shield.
2. `train`: Lumbridge cows (they never hurt) until Attack, Strength and Defence reach
   `train` (default 50). The style picker trains the lowest of the three.
3. `kit:net`, `kit:rod`, `kit:feathers`, `kit:cook`: Draynor net fishing to Fishing 20.
   Gerrant in Port Sarim (3013, 3225) sells the fly fishing rod for 5 gp. Lumbridge
   chickens drop feathers (305 from 76 chickens in 7 minutes). Shrimps are cooked to
   Cooking 15, since trout needs 15 and salmon 25 (`cooking_generic.dbrow`). Below the
   level the fire answers with a **mesbox** and cooks nothing; that never appears in
   `gameMessages`.
4. `food:fish`, `food:cook`: fly fishing at Barbarian Village (3104, 3424), cooking on the
   fire **inside the longhall**. The helper stands at (3079, 3444) and enters from the south.
   The fire is walled in from the north, where the server answers "I can't reach that!".
   `fishPerTrip` (default 10) raw fish per run.
5. `bones:hill_giants`. The first entry is through the Edgeville trapdoor (3097, 3468). The
   helper then picks up the **brass key** from its ground spawn (3131, 9862) and keeps it.
   From then on it uses the brass-key house north-west of Varrock: use the key on the door
   (3115, 3450) both ways, take the ladder (3116, 3452) to (3116, 9853) straight into the
   giants' room, and bank at **Varrock West**, 78 tiles away. Without the key the walk is
   about 210 tiles past aggressive zombies and skeletons, which took a fresh 30-combat
   helper to 10 hp.

## Eating: the eat guard (`speedrun/helpers/eat-guard.ts`)

The role eats whenever hitpoints are below `eatAt` (55%), whatever it is doing: walking,
looting, fighting, waiting at a bank or the exchange. An `EatGuard` watches every published
state for the whole session and sends the Eat option on the first carried food (never a
banknote) when hitpoints are low. It holds off while a bank, shop, trade or exchange window
is open, because the engine's OPHELD handler closes the window, and eats as soon as the
window closes. After an eat it waits 3 ticks: `consume.rs2` refuses an eat within 2 ticks
of the last one. If hitpoints are still low (poison, a missed eat), it eats again.
A client tick-counter rollback clears the cooldown, so reconnecting cannot suppress food
until the previous session's tick number is reached. Logged-out states never trigger eating.

Engine facts it relies on (read, `OpHeldHandler.ts`, `Player.clearPendingAction`): eating
keeps the walk queue, so a walk carries on; and it clears the current interaction, so the
fight loop re-attacks its target when the guard's eat count changes. Eating adds 3 ticks to
the attack timer and sets no player delay, so the re-attack is accepted at once and swings
3 ticks later.

**Why.** rs/48's probe ate only at the top of a cycle and inside the fight loop. On
2026-10-21 at 08:12:01 UTC cairn_h51 died at (2901, 9800), just inside the dusty-key door,
1 minute 49 seconds after leaving the Barbarian Village fire. One cycle's `spot.enter`
covered the whole walk (Falador, Taverley, the dungeon loop past aggressive poison
scorpions and chaos dwarves) without a single eat. `eat-guard.test.ts` replays that walk
with `speedrun/lib/fake-sdk.ts`: hitpoints fall while nothing but the guard runs, and it
must eat.

At the spot the helper fights the nearest free target. An NPC already attacking it comes
first, and targets in another player's fight are skipped. The guard eats below 55%; the
helper flees below 35% with no food. It loots big bones, coins, law/nature/cosmic/death/chaos/blood/soul
runes, grimy herbs, limpwurt roots, uncut gems and talismans. It equips dropped melee
upgrades it has the level for (iron/steel kiteshields, full helms, longswords so far). With
a full bag it drops a spare fish for each bone, keeping `minFood + spareFood`, rather than
walk to the bank early. Raw net fish and burnt food left over from the kit stage are dropped
at the spot. Every `banked` line records `why` (full, out of food, fled, low hp/no food,
fetch net/coins/requirement, first look), what was `carried` (slots used, food, bones),
the bank's bone stock, and the session summary.

## Baby blue dragons with GE food

`food: "ge"` buys sharks through the shared `Buyer`, which uses
`pointMarketAtServer` to route market reads to `SERVER`, not the loopback gateway.
Before buying, the role collects existing fills; it buys toward `buyFood` (150 held),
limited by available coins and `maxFoodPrice` (900 gp). It banks notes and withdraws
10 edible sharks per trip. Bought food is never dropped to make room for bones.
Normal baby-blue deposits use **Falador West**; buying and receiving funds use
**Varrock West**. Every successful bank visit calls `reportBank`; bank stock is shared
between locations.

**Market observation:** the demo `/api/market/items/385` at 17:22 UTC on 2026-10-21
quoted a shark ask of **676 gp**, with 3,588 offered. This is a dated quote, not a
standing price guarantee. Sharks heal 20 hp and save inventory slots; the measured
high-level trips use roughly 0.25–0.35 per bone. At that quote, food alone costs about
5.6–7.9 gp per base Prayer xp. The earlier 900-gp budget estimate above is conservative.

Food is obtained **before** attempting the Jailer/key route. If neither food nor enough
coins remain, an account with `coinsFrom` waits at Varrock West for up to `coinWaitMin`
(20 minutes), then fishes for 30 minutes before retrying GE food. This fallback keeps it
productive but is not evidence of a funded GE-food run. If fishing equipment is missing,
the role keeps GE buying and coin receiving enabled and backs off fishing retries for
30 minutes; without an approved donor it waits at a bank, rather than entering combat
without a replenishable food source. Funding shortages must be
reported to the coordinator rather than silently borrowing another role's account.

The receiver accepts only coins or its configured food, never offers anything, and
checks an anchored login-name pattern. The current approved receivers use
`^cairn_(h(6\d|5[1-4])|e\d\d)$`. Permissions to move funds remain account-specific:
a matching name is not authorization to commandeer it. The approved 2026-10-21 top-ups
were e06→h53 at 17:39:49, e04→h51 at 17:45:10, and e08→h52 at 17:46:12 UTC,
**50,000 coins each**. Each earner was disabled through `fleetctl`, borrowed for its
coins-only bidder-fund trip, logged out cleanly, then re-enabled and checked. Temporary
credential symlinks were removed; no earner credentials remain in the dev copy.
See [mule/courier](mule.md) for the transfer protocol.

### Recovering a missing key

The requested spot remains immutable. Missing-key recovery waits for the shared
`speedrun/lib/fresh-state.ts` guarantee, then opens the bank and withdraws the key before
attempting acquisition. A cached empty bank or failed bank action is not proof that the
key is lost. The 30-minute acquisition budget starts when recovery begins, not when the
role process started. If it expires, the helper makes one hill-giant trip, preserves any
preferred-spot key, and retries baby blues after banking. Each downgrade logs inventory,
bank stock and reason. Routing exits the dungeon actually occupied before entering a
different one, including escape from Velrak's cell and the brass-key house.

Previously a late stale inventory read could permanently replace the requested spot
with hill giants. That explains why the baby-bone total stayed at 470 while big bones
kept accumulating. Regression tests cover stale inventory, banked keys, late recovery,
retry after a fallback bank, cross-dungeon routing and the brass-house door tile.

### Scaling observations

All intervals below are on the demo on 2026-10-21 UTC. Counts are **bank deposits**:
last bank before the start to last bank before the exclusive end, divided by the entire
wall-clock interval. Bones carried across either boundary are not inventory-adjusted.
`stats.ts` includes the first in-window deposit; the old first-to-last-in-window estimator
incorrectly discarded it and used different denominators for each account.

| Active accounts | Window (UTC) | Deposits per account | Total | Total/hour | Mean/account-hour |
|---|---|---|---:|---:|---:|
| 1 (h51) | 09:16:00–09:53:10 | 61 | 61 | 98.48 | 98.48 |
| 2 (h53, h54) | 17:50–18:10 | 44, 24 | 68 | 204 | 102 |
| 3 (h51–h53) | 10:01:00–10:27:51 | 24, 27, 14 | 65 | 145.25 | 48.42 |
| 4 (h51–h54), historical | 10:40–11:40 | 91, 63, 20, 49 | 223 | 223 | 55.75 |
| **4 (h51–h54), unattended** | **18:15–19:15** | **72, 59, 70, 88** | **289** | **289** | **72.25** |

These are operational observations, **not a controlled scaling curve**. The one-account
window includes a gate-fix restart. The three-account window includes h53's bootstrap;
its individual rates were 53.63, 60.34 and 31.28/h. In the historical four-account hour,
h53 ran short of food and h54 received manual funding at 11:39; despite zero logged
deaths it does **not** satisfy uninterrupted unattended acceptance. The two-account
window had no deaths, restarts or funding interventions, at 132/h for h53 and 72/h for
h54. Levels and trip boundaries differ between cohorts, so these numbers cannot prove
that three accounts are worse than two or identify an optimal count.

For the two-account window, completed fight invocations (attack through loot, **not
weapon attack cadence**) took p10/p50/p90 **53/78/103 ticks** for h53 (31 samples) and
**55/77/100 ticks** for h54 (40 samples). The measured complete trips took 11.4 and
11.9 minutes, including 9.4 and 10.2 minutes in the room, and deposited 23 and 24 bones.
The engine attack and eat delays are separate from this end-to-end distribution.

**Unattended acceptance, 18:15–19:15 UTC:** all four original role processes remained
alive, with zero logged deaths, cycle errors, downgrades, starts/stops or manual funding.
Automatic GE purchases are part of the role, not interventions. Bank stock grew from
622 to **911 baby bones** (348/199/162/202 on h51/h52/h53/h54). The hour deposited
**289 bones**, or **72.25 per account-hour**. Live process and advancing fight events
were checked again at 19:15:57. No clients or roles were restarted during the window.

| Account | Deposits/hour | Bank visits | Fight samples | Fight ticks p10/p50/p90 | Complete-trip minutes p10/p50/p90 |
|---|---:|---:|---:|---|---|
| h51 | 72 | 6 | 103 | 50 / 71 / 97 | 5.1 / 12 / 18.2 |
| h52 | 59 | 5 | 109 | 47 / 73 / 103 | 10.3 / 16.6 / 16.6 |
| h53 | 70 | 3 | 111 | 51 / 71 / 102 | 13.5 / 18.3 / 25 |
| h54 | 88 | 4 | 109 | 47 / 71 / 98 | 13.1 / 17.4 / 18.8 |

Bank visits include food purchases and partial deposits; trip quantiles exclude the
first trip after a process restart and zero-kill trips. Fight samples are attack-through-loot
invocations; multiple helpers can observe a disappearing target, so they are **not**
independent confirmed kills. Banked bones, not those fight counts, determine throughput.

**Recommendation: retain four funded accounts**, which delivered 289 total/hour against
204/hour in the two-account observation. The gain is about 42% for twice the accounts;
this is an operational recommendation, not proof of an optimal count. Do not add a fifth
on these data. All four tend to meet in the southern room, and trace logs show waits for
occupied targets. Ordinary-player etiquette remains mandatory: skip occupied targets and
observe contention. A nearby combat flag alone never makes another player's NPC our
target; only the player's exact active NPC target gets that exception.

**Runtime provenance:** h51/h52 resumed at 18:11:54 with the cooldown-reset fix;
h53/h54 retained their 17:46 processes. All four ran the preferred-key recovery/routing
and food-before-key changes. Shared freshness integration was deployed to disk during
the hour without restarting them. The later failed-fishing fallback and stricter logout
fixes were unit-tested separately; this hour does not exercise those failure paths.
The acceptance observation is complete and is not being extended to hide these differences.

## Nature talismans (rs/194)

The scored account's Runecraft step S21 wants at least 4 nature talismans (plus the keeper's). The fleet held none on 2026-10-21, and none had ever traded on the GE. This section is the drop survey behind the `nature_hobgoblins` spot. Labels as above: **read**, **measured**, **inferred**.

**The only source is the gem table (read).** In this revision `nature_talisman` appears in exactly one place a player can get it from: `randomjewel` in `drop tables/scripts/shared_droptables.rs2:66-75`. It is not in any shop inventory or quest reward. There are no ground spawns (no object 1462 or 1463 in any map's `==== OBJ ====` section), and the only other mention is the staff cheat bank. The gem table rolls `random(128)`. On a members world, results 61-64 give a talisman: a **nature** talisman when the killer is overground (`coordz(coord) <= 6400`), and a **chaos** talisman below that. With Legends' Quest done, result 61 goes to the mega-rare table instead (no fleet account has it). A worn **ring of wealth** shortens the roll to `random(65)`, so 4/65 instead of 4/128, nearly double. So for an NPC whose own drop table sends `w` of its `d` rolls to the gem table, one kill gives a nature talisman with probability `(w/d) x (4/128)`, and only on the surface. The gem table is also reached through the ultra-rare table (20/128 of it), which adds under 1% to the NPCs that have one. The random-event monsters that roll the gem table (dryad, watchman, rock golem, zombie) don't matter here: the demo has random events off.

**Confirmation on the demo (measured, qualitative).** cairn_h51 banked one *chaos* talisman from the underground baby blue room, which is the underground branch of the same roll. So the members-only talisman branch fires on this server.

**Every NPC that rolls it, by kills per nature talisman** (read: drop scripts, `all.npc` levels, map spawns; the Wilderness is x 2944-3391, z 3520-3967):

| NPC (level) | Gem share, cited | Kills per talisman | Overground outside the Wilderness | Wilderness | Underground (chaos instead) |
|---|---|---:|---|---:|---:|
| Fire giant (86) | 11/128, `fire_giant.rs2:50` | 372 | none | 0 | 28 |
| Green dragon (79) | 5/128, `green_dragon.rs2:55` | 819 | none | 5 | 0 |
| Chaos dwarf (48) | 5/128, `chaos_dwarf.rs2:56` | 819 | none | 7 | 10 |
| Greater demon (92), red dragon (152) | 5/128, `greater_demon.rs2:52`, `red_dragon.rs2:55` | 819 | none | 4 each | 17, 6 |
| Blue dragon (111), black demon (172) | 5/128, `blue_dragon.rs2:55`, `black_demon.rs2:53` | 819 | none | 0 | 10, 11 |
| **Moss giant (42)** | 4/128, `moss_giant.rs2:69` | **1,024** | 12: Kandarin (2549-2556, 3401-3409) 4, walkable; north-west Karamja (2691-2699, 3204-3216) 5, no walking path; Crandor 3 | 3 | 27 |
| Ice giant (53) | 4/128, `ice_giant.rs2:66` | 1,024 | 4 at (2804-2824, 3506-3514), fenced off: the pathfinder ends 4-5 tiles short of every one | 9 | 10 |
| Lesser demon (82) | 4/128, `lesser_demon.rs2:13` | 1,024 | 6: Crandor 2, a caged one on the Wizards' Tower, 3 at (2412-2416, 4677-4684) | 8 | 19 |
| Black knight (33) | 3/128, `black_knight.rs2:61` | 1,365 | 20: Black Knights' Fortress 15 (3014-3032, 3502-3517, three floors, behind two doors), 5 scattered | 11 | 19 |
| Hill giant (28) | 3/128, `giant.rs2:58` | 1,365 | 3 at (2507-2548, 3144-3149) | 6 | 18 |
| Ice warrior (57) | 3/128, `ice_warrior.rs2:43` | 1,365 | 2, beside the fenced ice giants | 26 | 25 |
| **Hobgoblin (28 and 42)** | 2/128, `hobgoblin.rs2:68` and `:128` | **2,048** | 30: **Asgarnia peninsula (2905-2920, 3266-3295) 10, walkable from Falador with no door**; (2443-2451, 3329-3362) 6; Crandor 4; Karamja 3; (2656-2675, 3720-3731) 5 | 26 | 29 |
| Paladin (62), armed skeleton (22) | 2/128, `paladin.rs2:45`, `skeleton.rs2:110` | 2,048 | Ardougne castle 22; Crandor and a plane-2 room, 15 | 0, 28 | 0, 37 |
| Tribesman (32) | 2/138, `tribesman.rs2:59` | 2,208 | Karamja 21 | 0 | 0 |
| Jogre, pirate, chaos druid, dwarf, zombie, unarmed skeleton, Gunthor | 1/128 | 4,096 | various | | |

Some NPCs roll the gem table too but weren't mapped to spawns here (their drop label is a category): bandits (3/128, `bandit.rs2:52`), bandit camp leaders (2/128), Morytania vampires (4/128, `vampire.rs2:44`), shadow warriors (8/128, `shadow_warrior.rs2:37`, in the Legends' Guild basement, so underground), white knights (1/128), the troll general (5/128), Tyras guards (5/128), and werewolves and Canifis citizens (1/512 and 1/512 of their rolls). The Kalphite workers' and soldiers' 3-4/128 are all in the underground lair.

**The site chosen (inferred until measured).** Every wide slot is underground (chaos) or in the Wilderness (PvP is live there, see Where each tier comes from). The best walkable overground site is Kandarin's 4 moss giants (1 in 1,024 per kill). Getting there crosses White Wolf Mountain (`speedrun/lib/kandarin.ts`), and its nearest bank is not in this role's list. The `nature_hobgoblins` spot takes Asgarnia's peninsula instead: 10 spawns, a door-free walk from Falador west bank, and monsters that barely hurt a 98-99 combat helper (so `food: none` by default). The peninsula's ceiling is set by respawns: 10 spawns at 100 ticks each, plus about 6 ticks a kill, is at most about 1,130 kills an hour, so about **0.55 talismans an hour for the whole site**. One account kills fast enough to approach that ceiling, and a second one mostly shares it. The moss giants' ceiling is 4 spawns at 60 ticks, about 670 kills an hour or 0.65 talismans an hour. Running both sites would roughly double the rate. A ring of wealth nearly doubles every figure here.

## Ugthanki camels (meat for the kebab fallback)

`spot: 'ugthanki'` gathers raw ugthanki meat, the meat in the kebab mixtures of Cooking route 2
(`docs/speedrun/skills/cooking.md`, section 4). It uses the same fighter, eat guard, GE food and
banking as the other spots. Only the spot is new.

- **The camels:** 25 spawns (npc 840, `maps/m49_47`..`m51_48`), level 42, 45 hp, cowardly,
  respawning after 700 ticks, with one raw meat per kill (`ugthanki.rs2`). They are too spread
  out to see from one tile, so with no target in view the role walks a patrol loop, a
  nearest-first tour of all 25 spawns starting at the gate (`patrolTour`).
- **Getting in:** the Shantay Pass gate takes one Shantay pass going south and is free going
  north (`shantay_pass.rs2`). The role buys 40 passes at a time from Shantay (5 gp each),
  fetching coins from the bank first, and clicks through the guard's dialogue.
- **Banking:** at Shantay's chest, north of the gate. The chest's only option is Open, which
  shows a message box and then the bank (`shantay_chest.rs2`). The SDK's `openBank` now accepts
  it (`sdk/actions.ts`, a candidate for upstream). The desert side of the gate is not counted
  as near the chest.
- **Kept items:** passes and coins stay carried over bank visits (`Spot.keep`). The coins pay
  for passes and for the Al Kharid toll gate, which walks across the fence go through
  (`speedrun/lib/toll-gate.ts` `travelTo`). The desert is always left by the Shantay gate.
- **Desert heat** (`desert_heat.rs2`) does 1-10 damage every 50-190 ticks without a waterskin.
  The eat guard covers it, and the role carries no waterskins.
- **Food:** `ge` by default (sharks).

**Measured (the line's only record; the line is parked).** cairn_h51 (99 melee) on the demo,
2026-10-21 23:31-23:44 UTC: 32 kills, 32 raw ugthanki meat, 8 sharks eaten, 0 deaths. The
first trip, chest to chest, brought back 20 meat in 9.5 minutes: **about 125 meat per
account-hour. This is a single-trip rate, not a steady-state one.** Part of that trip killed
camels already standing, and the hour-long measurement never happened because h51 ran out of
food and starved into the coin loop described below. The desert's ceiling is 25 camels each
back after 700 ticks: about 385 an hour at the ~330 ms tick the demo actually delivers (about
430 at the configured 300 ms), so two accounts fit without competing much.

## Options (`ROLE_OPTIONS` JSON)

| Option | Default | Meaning |
|---|---|---|
| `spot` | `hill_giants` | `hill_giants`; `baby_blue` (withdraws or fetches its dusty key; a 30-minute acquisition failure uses hill giants for one trip, then retries; banks at Falador West); `blue_dragon` (adult blues in melee, below); `ugthanki` (raw ugthanki meat in the Kharidian desert; banks at Shantay's chest; see below); or `nature_hobgoblins` (nature talismans, below; banks at Falador West) |
| `train` | the spot's own (70 for `blue_dragon`), else 50 | Attack/Strength/Defence target on cows before the spot |
| `food` | the spot's own (`ge` for `baby_blue` and `ugthanki`, `none` for `nature_hobgoblins`), else `fish` | `ge`: buy `foodItem` at the Grand Exchange (below); `fish`: catch and cook trout/salmon; `none`: rest at the bank when hurt (about 30 s per hp: useless in practice) |
| `foodItem` | `Shark` | GE food: the item bought and eaten |
| `foodPerTrip` | 10 | GE food: taken out of the bank per trip |
| `buyFood` | 150 | GE food: how many to hold after an exchange visit, coins permitting |
| `maxFoodPrice` | 900 | GE food: never pay more per item; above it a bid rests at this price |
| `coinsFrom` | none | GE food: login-name RegExp of accounts whose coins (or `foodItem`) this account accepts by trade while it waits at Varrock West. Nothing else is accepted, and nothing is given |
| `coinWaitMin` | 20 | GE food: minutes to wait for coins before catching fish for 30 minutes |
| `fishPerTrip` | 10 | Raw fish per food run |
| `minFood` | 2 | Fetch food below this |
| `spareFood` | 3 | Fish only: with a full bag, drop food for bones while more than `minFood + spareFood` are carried (bought food is never dropped) |
| `feathers` | 300 | Feathers per chicken run |
| `eatAt` / `fleeAt` / `restUntil` | 0.55 / 0.35 / 0.9 | Hitpoint fractions |
| `loot` | runes, herbs, gems, talismans, coins, keys | Extra loot regex on top of the spot's bones |
| `maxPlayersNearTarget` | 0 | Skip a target with more than this many other players adjacent |
| `styleCap` | 99 | Stop training a combat skill at this level |
| `trace` | false | Log every fight at the spot (outcome, game ticks, position, live and busy targets in view, players), for measuring kill rates |

## Adult blue dragons in melee (`spot: 'blue_dragon'`)

The 3 adult blues of the Taverley baby blue room. Their spawns, the room box and the engine's
leash rule live in `speedrun/helpers/taverley-dragons.ts`, which `dragons.ts` (the magic killers)
shares. The route, the dusty key and the Falador West bank are the baby blues'.

- **Respawn and ceiling (read).** `respawnrate=60` ticks, dragon bones on every kill. With
  instant kills the room tops out at 3 x 9,000 / 60 = 450 bones an hour at 400 ms; allowing for
  kill time it is about 300-350. Melee killers stay far below it, so a melee pair beside the
  magic pair adds bones rather than taking the magic pair's kills.
- **No other adult blue site is reachable.** The Ogre Enclave's 6 (m40_147) sit behind the
  enclave guard, who needs Watchtower progress (`enclave_guard.rs2`). The Heroes' Guild
  basement's 1 (m45_154, (2908, 9905)) is behind Heroes' Quest. The SDK collision map has no
  path to either from the Taverley ladder.
- **Shield (read).** Item 1540 is named "Dragonfire shield" in this revision
  (`antidragonbreathshield`), so the spot matches it by id. Dragonfire hits up to 50 without it
  and 5 with it (`dragon.rs2`). The spot's `worn` requirement keeps the helper out of the
  dungeon until 1540 is equipped. It equips a carried shield and takes a banked one out, and with
  none owned it waits at the bank, looking again every 5 minutes. Gear upgrades never take the
  shield slot.
- **Targets and loot.** Only `^blue dragon$` is attacked, never a baby. An adult already hitting
  the player is fought first: in single combat the server refuses any other target while it
  hits. Dragon bones are looted by exact name.
- **Room gate.** At most 2 players (this one included) inside an adult's leash. The magic pair's
  safe tile and route are outside every leash, so they never count. With the room full, the
  helper waits inside the door.
- **Gear.** `wieldBanked`: bank visits take out melee gear that ranks above what is worn
  (`gearRank`), and the next cycle wields it. Only this spot does that.
- **Levels.** The spot assumes 99 Attack/Strength/Defence/Hitpoints (h51/h52). `train`
  defaults to 70 so a fresh account is never sent in at 50.

**Lab (measured, 2026-10-24, bgsrv-mac, 400 ms, `speedrun/lab/measure-blue-dragon.ts`).** Setup:
99 melee, adamant scimitar, full helm, platebody and platelegs, the shield, 16 sharks a trip,
bank to bank from Falador West, no other players.

- Results: 13 kills and 13 dragon bones banked over two trips (3,256 ticks). That is
  **36 bones an hour** at **2.4 sharks a bone**.
- Safety: 140 dragonfire breaths, every one absorbed by the shield. Lowest HP 46, no deaths.
- Trips: both ended on food, after 5 and 8 kills, at 6-9 minutes in the room and 2-3 minutes of
  walking.
- Kills take about 170 ticks with the adamant scimitar.

Two fight bugs surfaced on this spot and were fixed in `Run.fight` / `pickTarget`:
- A fight that ran to its 120-second deadline counted as a kill.
- The adult already on the player was skipped as "in combat", so the role clicked a refused
  target while it was breathed on.

With them in place, kills equal bones (`swingCheck` re-attacks when the target shows no hitsplat
for two swings).

## Measured on the demo (2026-10-21 UTC)

Three accounts shared the hill giants through the loopback gateway on bbs. The headline
hour, 06:14-07:14 UTC, ran on the final code with nobody touching it:

| Account | Start of the hour | Big bones looted in the hour | Bank visits (why) | Rate | Levels at the end |
|---|---|---:|---|---:|---|
| cairn_h50 | 62 combat, at the giants | 147 in 0.91 h | 10 (full 8, out of food 2) | 161 / h | 83/83/83, HP 83 |
| cairn_h51 | 72 combat, at the giants | 159 in 0.96 h | 11 (full 10, out of food 1) | 166 / h | 85/84/84, HP 84 |
| cairn_h52 | **fresh account at 05:47**; at the giants from 06:12 | 116 in 0.99 h | 9 (full 5, out of food 3, surface 1) | 117 / h (includes the feather stop) | 75/75/74, HP 75 |

In that hour there were no deaths, flees or cycle errors. Trips carried 12-18 bones once
the bag was no longer full of fish; with 20 fish per trip, trips had carried 4-6 bones.
Drops besides bones, per account-hour: about 1,100-1,300 coins, 6-18 nature, 4-10 law,
4-8 cosmic runes, 6-15 limpwurt roots, 1-5 body talismans, the odd uncut gem (sapphire,
emerald, ruby, diamond), and iron/steel armour and steel longswords, which are worn.

Fresh-account bootstrap (cairn_h52, measured): tutorial skip 2 s; cows to 50/50/50 in
20.4 min; net fishing to Fishing 20 in 2.7 min; rod 0.6 min; cooking practice to Cooking 25
in 1.2 min. Total: **25 minutes from first login to the giants.** Training continues at the
giants (50 -> 75 in an hour).

**Banks at hand-over (07:20 UTC, Varrock West):**

| Account | Big bones | Coins | Other |
|---|---:|---:|---|
| cairn_h50 | 260 | 2,163 | law, nature, cosmic, death runes; limpwurt roots; uncut sapphires, emerald; body talisman |
| cairn_h51 | 279, plus **34 babydragon bones** from the probe (bank at Falador West) | 1,920 | law, nature, cosmic, chaos, death runes; 24 limpwurt roots; 7 body talismans; uncut diamond |
| cairn_h52 | 134 | 1,142 | law, nature, cosmic, chaos, death runes; limpwurt roots; uncut rubies, sapphire |
| **Total** | **673 big + 34 babydragon** (11,115 base Prayer xp, 28% of 39,938) | 5,225 | |

**Baby blue dragon probe** (cairn_h51, 85 combat, `spot: 'baby_blue'`, 07:47-08:33 UTC):
Varrock West to the dusty key in 3 minutes (walk, Jailer kill, jail key, Velrak's cell,
dialogue). In the room it made about 2 kills a minute and ate about one fish per kill. Each
trip ended "out of food" with 9-15 bones. Banking at Falador West, fishing and cooking at
Barbarian Village and walking back took about 6 minutes. That gives about 60 babydragon
bones an hour once settled; 34 were banked in the 45 minutes, including one death. The
death (08:12) came on the way back in: the role doesn't eat during a long walk, and the
route passes aggressive monsters. It respawned in Lumbridge, rebought the rod and
feathers, fetched a new dusty key and carried on. A gateway stall at 08:22-08:24 UTC
ended in a lite-client relogin, which it survived. It was logged out cleanly at the Falador
West booth.

## Running it

One lite client per account and the role, both through the same gateway. On bbs, use a
loopback gateway (the public gateway delivers state in multi-second bursts, which hurts
combat and eating):

```
cd server/gateway && AGENT_PORT=8550 GATEWAY_HOSTNAME=127.0.0.1 bun gateway.ts
cd server/webclient && GATEWAY_URL=ws://127.0.0.1:8550 bun src/lite/runner.ts cairn_h50
GATEWAY_URL=ws://127.0.0.1:8550 bun speedrun/helpers/bones.ts cairn_h50
```

The role never relogs; whatever runs the lite client must, with exponential jittered
backoff. Development used a loop that waits at least 300 s after `Too many login attempts
(code 16)`. The fleet supervisor (cairn://p/rs/43) owns that in production.

**Development harness (`docs/speedrun/scripts/bones-dev/`).** The baby blue accounts ran
outside the fleet from a dev copy on bbs (`~/rs-dev/babyblue`, `BONES_DEV`), with a
loopback gateway on 127.0.0.1:7782 and everything in the private tmux server
`tmux -L rs41-babyblue`:

| Script | What |
|---|---|
| `start.sh ACCOUNT...` | Gateway (if down), plus per account a relogin loop (`lite-loop.sh`, jittered backoff, at least 300 s after code 16) and a role loop (`role-loop.sh`, options from `run/ACCOUNT.options.json`, paused while `run/pause-ACCOUNT` exists) |
| `stop.sh [ACCOUNT...]` | Per account: SIGINT the role, log out with the logout button while the client is still connected (`logout.ts` waits out combat and eats if hurt), then let the client loop exit; refuses to stop a live client if logout is unconfirmed. With no account left, stop the gateway and the tmux server. Only recorded PIDs are signalled |
| `give.ts FROM TO Coins=N Shark=M` | Hand coins and banknoted items between dev accounts at Varrock West (FROM paused; TO waiting for coins) |
| `peek.ts ACCOUNT...` | Read-only look (observe mode) |
| `stats.ts SINCE_ISO UNTIL_ISO [bone name] [accounts...]` | Fixed-window bank deposits, trip and fight-tick distributions; unknown if no baseline or stock was withdrawn |

**How many accounts.** The giants' room has 12 spawns and few other players. Three
helpers shared it without starving each other (see the measurements). A fourth is likely
fine; more than about five would crowd a public spot, which the etiquette rules out.

### Adopt h51–h54 into the fleet

The development accounts are left **running** in `~/rs-dev/babyblue`, private tmux
socket `rs41-babyblue`, gateway port 7782. The operator should first deploy the merged
role to the fleet, then stop the dev cohort cleanly:

```sh
cd ~/rs-dev/babyblue
bash docs/speedrun/scripts/bones-dev/stop.sh cairn_h51 cairn_h52 cairn_h53 cairn_h54
```

A successful stop requires a fresh account-specific server LOGOUT line in the lite log,
then runner exit and loop shutdown. A missing runner, reconnect backoff, disconnect,
old logout line or replaced/truncated log is not enough. If the script exits nonzero,
do not start a second client. Preserve any existing connection and inspect the result.
For a partial cohort stop, retry **only the remaining accounts**; do not re-certify an
already stopped account from an old log. If logout was never acknowledged, investigate
or re-establish the dev client before trying again. Only after all four have individually
printed clean-logout success, run these on bbs (using the fleet's existing credentials):

```sh
F=~/rs-fleet/speedrun/helpers/fleetctl
$F assign cairn_h51 bones --options '{"spot":"baby_blue","food":"ge","foodPerTrip":10,"buyFood":150,"coinsFrom":"^cairn_(h(6\\d|5[1-4])|e\\d\\d)$","trace":true}'
$F assign cairn_h52 bones --options '{"spot":"baby_blue","food":"ge","foodPerTrip":10,"buyFood":150,"coinsFrom":"^cairn_(h(6\\d|5[1-4])|e\\d\\d)$","trace":true}'
$F assign cairn_h53 bones --options '{"spot":"baby_blue","food":"ge","foodPerTrip":10,"buyFood":150,"coinsFrom":"^cairn_(h(6\\d|5[1-4])|e\\d\\d)$","trace":true,"train":60}'
$F assign cairn_h54 bones --options '{"spot":"baby_blue","food":"ge","foodPerTrip":10,"buyFood":150,"coinsFrom":"^cairn_(h(6\\d|5[1-4])|e\\d\\d)$","trace":true,"train":60}'
$F reload
```

Do not include h50. It is outside this cohort. The adoption gap should be minutes, not a
second simultaneous login. Check the first fresh-session line and subsequent baby-blue
`banked` snapshots in each fleet log after reload.

## Gotchas

- The bootstrap's clutter (raw shrimps, cooked shrimps, the net) once filled a helper's
  bag at the giants after 2 bones. It is now food or dropped.
- A full bag of fish was the bottleneck at higher combat levels. With 20 fish per trip,
  every bank visit was "full" with 17-20 food and only 4-6 bones, because a 66-combat
  helper barely gets hit. Hence `fishPerTrip` 10 and the drop-food-for-bones rule.
- Gateway stalls (`waitForTicks safety timeout - no state updates received`) at 04:24-04:25,
  04:31-04:32 and 04:43-04:44 UTC, before the loopback gateway. The cycle's
  catch-and-backoff survived them. There were none in the 06:14-07:20 run.
- **Stopping cleanly.** Giants are aggressive, so a helper stopped in their room may never
  be out of combat long enough to log out. Stop the role right after a `banked` line,
  while the helper is at the bank booth. Then click logout (component 2458) **before**
  stopping whatever relaunches the lite client, and stop the relauncher while it waits out
  its backoff. Closing the relauncher's tmux pane first hangs up the lite client too.
  That is a drop: the account stays in the world until the 500-tick no-connection timeout.
  It happened at this hand-over, harmlessly, at the bank.
- The lite client reports the brass-key door as a locked door and `walkTo` re-routes
  around it. That is harmless because the role walks to the tile outside and uses the key.
- Other players' spare dusty keys lie in the baby blue room; the role loots a key only
  when it carries none and drops spare copies and the spent jail key.
- The baby blue room is walled off from the Taverley ladder. The role decides which side
  of the dusty-key door it is on by offline reachability (`findLongPath` with the door
  shut), not by a coordinate box, and the gate tile (2924, 9803) itself counts as outside
  (`inBabyBlueRoom`). A helper leaving with a full bag once stopped on the gate tile
  ("The gate locks shut behind you"). It took itself for still inside and tried to walk
  back to (2923, 9803) through the locked gate, looping there while an aggressive lesser
  demon hit it; the eat guard kept it alive until it got out.
- **Food before the key.** A fresh account at 60 combat with no food went for its dusty key
  first: cairn_h53 died to the Jailer on 2026-10-21 at 09:54 UTC (it had nothing to lose
  but its bronze starter sword and wooden shield). GE food is now fetched before the
  spot's requirement.
- **Uncollected exchange fills.** `Buyer.buyAtGE` counts bank and inventory, not items
  waiting in the exchange, and a filled offer no longer counts as open, so a second visit
  would buy the whole lot again. The role collects first, then buys toward a held target.
- The shared trade giver offers one inventory slot per item id. Sharks withdrawn as notes
  can leave both ordinary sharks and banknotes (two ids) in the pack, so `give.ts` gives
  every id carried under a name.
- A courier that starts in Al Kharid gets stuck at the toll gate (its walk does not pay).
  The first funding trip crossed it with `crossTollGate` (now `speedrun/lib/toll-gate.ts`).
- **Kept coins are not a haul.** With GE food unaffordable, the role falls back to fishing,
  and the fishing fallback banks any haul it carries first. It used to count every carried
  coin as haul. The ugthanki spot keeps its coins over bank visits, so each visit left the
  coins, and the next cycle sent it straight back: cairn_h51 made 979 visits to Shantay's
  chest in 32 minutes. `fishingHaul` counts coins only on a spot that banks them.
- Bank calls are still the stock `bot.depositItem` per item name, about 10 names a visit.
  Switching to `speedrun/lib/bank.ts` `depositMatching` would save a few seconds per
  visit; the 78-tile walk dominates, so it was left for later.
