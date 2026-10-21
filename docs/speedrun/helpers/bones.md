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

## How much Prayer needs (read)

- Base xp per bone (`skill_prayer/configs/bones.obj`, `bone_exp` in tenths): dragon 72,
  babydragon 30, big 15 (jogre bones are also 15), normal, bat and wolf 4.5.
  `bury_bone.rs2` buries one bone per click after `p_delay(0)`, so the scored account
  pays about 2 ticks per bone whatever the bone (cairn://p/rs/33 measures the exact
  cadence).
- This server uses a `2^(level/10)` curve where 99 is 39,938 base xp (cairn://p/rs/33).
  Holy Grail gives 11,000 base, so the scored account needs **28,938 base** after it.

| Bone | Bones for 28,938 base | Scored-account bury ticks (2 each) | Inventories of 28 | Bury ticks per 1,000 base |
|---|---:|---:|---:|---:|
| Dragon (72) | 402 | 804 | 15 | 27.8 |
| Babydragon (30) | 965 | 1,930 | 35 | 66.7 |
| Big (15) | 1,930 | 3,860 | 69 | 133.3 |
| Normal (4.5) | 6,431 | 12,862 | 230 | 444.4 |

The score is the scored account's ticks, so the bone type matters far more than its xp
ratio suggests. Burying big bones instead of dragon bones costs that account about
3,056 more ticks (15 minutes) and 54 more bank cycles. Helper hours are free on the
scoreboard; they cost only wall clock.

## Method comparison (per account-hour and per 1,000 base xp)

| Method | Requirement | Fresh helper to requirement | Bones per account-hour | Base xp per account-hour | Account-hours per 1,000 base | Account-hours for 28,938 base | Risk | Status |
|---|---|---|---:|---:|---:|---:|---|---|
| **Hill giants**, Edgeville dungeon (12 spawns, level 28) | Melee about 50, food | **0.42 h measured** (20 min to 50/50/50 on cows, 4.5 min fishing/cooking kit) | RATE_GIANTS | XP_GIANTS | HPK_GIANTS | TOTAL_GIANTS | None: no PvP, giants hit up to about 4 | **Built and running** |
| Baby blue dragons, Taverley dungeon (9 spawns, level 48, 50 hp, no fire) | Dusty key (Velrak, Taverley jail; the Jailer drops the jail key), melee about 60 | about 0.8 h inferred (giants to 60, plus the key) | about 60 inferred | about 1,800 | about 0.56 | about 16 | Low | Spot written (`spot: 'baby_blue'`), key fetch not written, never run |
| Blue dragons, Taverley dungeon (3 spawns; Brimhaven has 7) | Anti-dragon shield (the Duke gives it once Dragon Slayer is started, 32 quest points) or Protect from Magic, melee about 75 | Many hours (quest points) | about 20-30 inferred | 1,400-2,200 | 0.5-0.7 | 13-20 | Dragonfire max 30-50 unprotected (`dragon.rs2`) | Infeasible tonight |
| Green dragons, wilderness level 35-39 (5 spawns) | As for blue dragons, melee about 70 | Many hours, or Prayer 37 (about 36 big bones buried by the helper) for Protect from Magic, which drains during fights | about 20-30 inferred | 1,400-2,200 | 0.5-0.7 | 13-20 | **PvP is live**: anyone within the wilderness level of your combat level can attack (`pvp_combat.rs2`); a 280-tile wilderness walk to Edgeville bank | Not built |
| Moss giants, Varrock sewers (4 spawns, level 42) | Melee about 40 | about 0.35 h | below hill giants (a third of the spawns) | | | | None | Not built |
| **GE: dragon bones** (536) | Coins | | 0: **no sellers**; 1,455 wanted at a 5,000 gp bid (16 trades ever, all at 5,000) | | | | | Not a source |
| **GE: big bones** (532), babydragon (534) | Coins | | 0: never traded, no orders | | | | | Not a source |
| GE: bones (526) | Coins | | 3 wanted at 150 gp, no sellers | | | | | Not a source |

GE data read from `/api/market/items/<id>` at 05:50 UTC on 2026-10-21. Selling
is the opposite story: a dragon bone fetches 5,000 gp, which matters to the coin-earner
(cairn://p/rs/50), not to Prayer.

Dragonfire mechanics (read, `npc/scripts/dragon.rs2`): one attack in four is fire,
with a max of 30, or 50 when the dragon's magic roll beats the player's defence. Protect
from Magic (`%prayer12`) caps it at 10, the anti-dragon shield at 5, and an antifire
potion takes off 15 more. Under 25x xp, Prayer 37 is cheap for a helper (about 535 base,
36 big bones). Prayer points drain during a minute-long dragon fight, though, so without
prayer potions Protect from Magic doesn't sustain a farm.

**Recommendation.** Hill giants now. They're the only method that runs unattended
tonight with no risk, and 3-4 accounts cover the 1,930 big bones in a few wall-clock
hours. The worthwhile stage 2 is baby blue dragons, behind the dusty key. They give
about the same helper-hours per xp and halve the scored account's bury ticks and bank
cycles relative to big bones. Real dragon bones would save another 1,126 ticks over
babydragon bones. That needs Dragon Slayer quest points or a prayer-potion supply on a
helper, plus wilderness exposure for greens, and is not worth building before the
scored-account route says it is.

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
| `spot` | `hill_giants` | `hill_giants`, or `baby_blue` (needs a dusty key in the bank or inventory; falls back to hill giants without one) |
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

## Measured on the demo (2026-10-21 UTC)

MEASURED_SECTION

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
  04:31-04:32 and 04:43-04:44 UTC. The cycle's catch-and-backoff survived them.
- The lite client reports the brass-key door as a locked door and `walkTo` re-routes
  around it. That is harmless because the role walks to the tile outside and uses the key.
- Bank calls are still the stock `bot.depositItem` per item name, about 10 names a visit.
  Switching to `speedrun/lib/bank.ts` `depositMatching` would save a few seconds per
  visit; the 78-tile walk dominates, so it was left for later.
