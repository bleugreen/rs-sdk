# Bone collector (`speedrun/helpers/bones.ts`)

The bone collector supplies the scored account's Prayer. A helper kills monsters for
their bones and also loots coins and small valuables. It catches and cooks its own food,
banks, and reports the bank after every visit through `ctx.reportBank`. The role
produces `/bones$/` (role name `bones`).

```
bun speedrun/helpers/bones.ts <account>                                  # standalone
ROLE_OPTIONS='{"spot":"hill_giants","train":50}' bun speedrun/helpers/bones.ts <account>
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

Every dragon drops its bones on every kill (`death_drop`), and every dragon is cowardly
(it doesn't attack first) and respawns after 60 ticks. Spawn counts come from the
`==== NPC ====` sections of `server/content/maps/m<X>_<Z>.jm2` (world x = 64X + x).

| Monster (bones) | Where | Spawns | Access | Danger |
|---|---|---:|---|---|
| Baby blue dragon (30), level 48, 50 hp | Taverley dungeon (2892-2909, 9763-9806) | 9 | Dusty key: kill the Jailer (2933, 9693), take the jail key (it always drops), unlock Velrak's cell (2931, 9690) and accept his key (`velrak_the_explorer.rs2`). The room is behind the dusty-key door (2924, 9803), entered from the east after a loop round the dungeon from the ladder | No fire. Hits a 85-defence helper about one fish's worth per kill. The route passes aggressive poison scorpions and chaos dwarves |
| Baby red dragon (30), level 65, 65 hp | Brimhaven dungeon (2696-2708, 9500-9524), among 6 red dragons | 8 | 875 gp to Saniboch once; vines need an axe and a Woodcutting level; stepping stones need Agility 12 (`karam_dungeon.rs2`) | No fire; red dragons nearby are cowardly |
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
| **Baby blue dragons**, Taverley dungeon | Dusty key (3 min to fetch, measured), melee about 60 | About 1 h (giants from 50 to 60, inferred) | **about 60 measured** (45 min probe: 10-15 bones per trip, food-bound) | 1,800 | 0.56 | 73.3 | One death on the walk in (the role does not eat while walking) | **Built; probed on cairn_h51** |
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
- **Baby blues.** At the measured ~60 an hour, 4 accounts make about 240 an hour (7,200
  base), so they could cover the whole target alone in about 5.5 hours. Before scaling
  them, the follow-up should add eating while walking (the probe's one death) and GE food
  instead of fishing.
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

At the spot the helper fights the nearest free giant. An NPC already attacking it comes
first, and targets in another player's fight are skipped. It eats below 55% and flees
below 35% with no food. It loots big bones, coins, law/nature/cosmic/death/chaos/blood/soul
runes, grimy herbs, limpwurt roots, uncut gems and talismans. It equips dropped melee
upgrades it has the level for (iron/steel kiteshields, full helms, longswords so far). With
a full bag it drops a spare fish for each bone, keeping `minFood + spareFood`, rather than
walk to the bank early. Raw net fish and burnt food left over from the kit stage are dropped
at the spot. Every `banked` line records `why` (full, out of food, fled, low hp/no food,
fetch net/coins/requirement, first look), what was `carried` (slots used, food, bones),
the bank's bone stock, and the session summary.

## Options (`ROLE_OPTIONS` JSON)

| Option | Default | Meaning |
|---|---|---|
| `spot` | `hill_giants` | `hill_giants`, or `baby_blue` (fetches its own dusty key; falls back to hill giants if that fails for 30 minutes; banks at Falador West) |
| `train` | 50 | Attack/Strength/Defence target on cows before the spot |
| `fish` | true | Catch and cook own food; false means rest at the bank when hurt (about 30 s per hp: useless in practice) |
| `fishPerTrip` | 10 | Raw fish per food run |
| `minFood` | 2 | Fetch food below this |
| `spareFood` | 3 | With a full bag, drop food for bones while more than `minFood + spareFood` are carried |
| `feathers` | 300 | Feathers per chicken run |
| `eatAt` / `fleeAt` / `restUntil` | 0.55 / 0.35 / 0.9 | Hitpoint fractions |
| `loot` | runes, herbs, gems, talismans, coins, keys | Extra loot regex on top of the spot's bones |
| `maxPlayersNearTarget` | 0 | Skip a target with more than this many other players adjacent |
| `styleCap` | 99 | Stop training a combat skill at this level |
| `trace` | false | Log every fight at the spot (outcome, game ticks, position, live and busy targets in view, players), for measuring kill rates |

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

**How many accounts.** The giants' room has 12 spawns and few other players. Three
helpers shared it without starving each other (see the measurements). A fourth is likely
fine; more than about five would crowd a public spot, which the etiquette rules out.

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
  shut), not by a coordinate box.
- Bank calls are still the stock `bot.depositItem` per item name, about 10 names a visit.
  Switching to `speedrun/lib/bank.ts` `depositMatching` would save a few seconds per
  visit; the 78-tile walk dominates, so it was left for later.
