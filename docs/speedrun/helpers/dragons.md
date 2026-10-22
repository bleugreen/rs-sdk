# Adult blue dragons from a safe tile (`speedrun/helpers/dragons.ts`)

The dragons role farms adult blue dragons in Taverley dungeon with magic from a tile no
dragon can ever attack, telegrabs their dragon bones (72 base Prayer xp each, the top tier in
[bones.md](bones.md)), and banks them at Falador West. It needs no anti-dragon shield and no
quest. The role produces `/^dragon bones$/i` (role name `dragons`).

```
bun speedrun/helpers/dragons.ts <account>                                   # standalone
ROLE_OPTIONS='{"funders":["^cairn_(h|e)\\d+$"]}' bun speedrun/helpers/dragons.ts <account>
```

Labels: **read** (from the content or engine), **measured** (lab engine at 300 ms or
rs-sdk-demo.fly.dev at 25x xp, from bbs over a loopback gateway), **inferred** (estimated).

## Why a tile can be safe (read)

- Adult green, blue, red and black dragons attack only through `[ai_opplayer2,...]`
  (`server/content/scripts/npc/scripts/dragon.rs2`, the four `ai_opplayer2` lines after the
  commented-out block). Their approach-mode handlers `[ai_applayer2,...]` and the
  `ai_queue1` retaliation lines are commented out, so dragonfire (`[proc,dragon_fire]`, one
  attack in four) is only ever breathed from an op trigger.
- An op trigger runs only while the NPC is in operable distance of its target
  (`server/engine/src/engine/entity/Npc.ts`, the `checkOpTrigger() && inOperableDistance`
  branch of the interaction step), and before any of that, every targeting mode calls
  `validateTarget()`, which drops the target when `targetWithinMaxRange()` fails. For an
  op-trigger NPC that is a leash: the target's tile must be within `maxrange + 1`
  (Chebyshev) of the NPC's **spawn** tile, corners excluded. Outside it the NPC resets and
  never paths or attacks.
- `maxrange` defaults to `wanderrange + 2` (`server/engine/src/cache/config/NpcType.ts`,
  `postDecode`). `blue_dragon` (`server/content/scripts/_unpack/225/all.npc`) sets size 4,
  wanderrange 4, huntmode cowardly, 105 hitpoints, magic defence 60, respawn 60 ticks, and no
  maxrange, so its leash is 7 tiles from its spawn. Baby blue dragons have the same 6/7.
- **The dragons do attack first at close range.** Despite its name, the `cowardly` hunt
  (`server/content/scripts/_unpack/225/all.hunt`) is `type=player` with
  `find_newmode=opplayer2`: each tick a dragon may take any player within its `huntrange`
  (4 for adults, 2 for babies) with line of sight as its target, unless the player's combat
  level is over twice the dragon's (222 for adults), or either side fought in the last 8 ticks
  (`Npc.ts huntPlayers`). Measured in the lab (`speedrun/lab/measure-hunt.ts`, 2026-10-21): a
  combat-70 player that never attacked, standing for 16 ticks a given distance north of a
  living adult's footprint, was hit in 0 of 6 trials at 5-6 tiles and 4 of 9 trials at 2-4
  tiles (6, 21, 4 and 7 hp; the hits are not attributed between adults and babies).

So a tile outside every room NPC's leash, with line of sight and spell range to where the
adults wander, can never be hit, whether or not a dragon has it as its target. The adults
wander at most 4 tiles from their spawns, so none ever comes within hunt range of the safe
tile either. `leashHolds` and `outsideEveryLeash` in the role mirror the engine check, and the
unit tests pin it.

Walking to a drop instead of telegrabbing it would save the 2,991-gp law per bone, but a drop
lies on its dragon's SW tile, within a few tiles of the other living adults and the babies, so
the hunt above makes it unsafe. It was not pursued.

## The room (read, from `server/content/maps/m45_153.jm2`)

| What | Where |
|---|---|
| Adult blue dragon spawns (SW tile) | (2897, 9797), (2899, 9802), (2904, 9802) |
| Baby blue dragon spawns | (2892, 9799), (2904, 9796), (2909, 9806), (2911, 9797), (2911, 9808), (2917, 9801) |
| **Safe tile** | **(2901, 9810)**, the one tile in the room outside all nine leashes |
| Dusty-key door | (2924, 9803); the room is west of it |
| `SAFE_ROUTE` | door inside (2923, 9803) west to (2917, 9803), diagonally to (2910, 9810), then west along z 9810 to the tile |

The pathfinder's own route from the door cuts through adult leash ground at
(2903-2908, 9806-9809), and even a two-tile click along z 9810 has an equal-length
alternative through z 9809, so the role walks `SAFE_ROUTE` one tile per click. It crosses
only baby-leash ground, and babies have no dragonfire.

On the tile the role turns auto-retaliate and running off (`controls:com_3`/`com_4`), casts
only at dragons whose footprint is 1-9 tiles away with line of sight (offline
`collisionLineOfSight`, which rebuilds the projectile blockers the SDK's collision map lacks),
and telegrabs bones that land within 10 tiles in sight. A dragon at exactly 10 tiles is
refused by the engine, which then walks the player toward it: that is why the range is 9,
why a target SW tile whose cast moved the player is blacklisted for the session, and why
`watch()` walks the player straight back whenever it is off the tile. A dragon one hit from
death whose drop would land out of telegrab sight is held until it wanders somewhere better.

## What the role does

`decideStep` chooses each step afresh from the account's state (pack, bank, levels, where it
stands), so the role restarts from anywhere:

1. Tutorial, then melee on the Lumbridge cows to 20 (hitpoints and defence for the walk).
2. Wait at **Varrock West bank** for coins (any account matching `funders` that sends a trade
   request); `bidder.ts <earner> fund` delivers them there.
3. Buy law runes (exchange) first, then a staff of air (Zaff), chaos and death runes (Aubury,
   then Betty in Port Sarim for what his cap left short, then from Magic 66 the Magic Guild
   for what both left short) and sharks (exchange). The magic is the **wind spells with a staff of air**: wind strike
   (mind), wind bolt from 17 (one chaos, max 9), wind blast from 41 (one death, max 13, more than
   fire bolt's 12). The staff supplies every air rune, telegrab's too, so the role buys no air:
   the exchange has no air sellers (a 109k buy wall at 11 gp, [market.md](market.md)) and Aubury
   sells about 180 a visit, which cut fire-bolt trips to 55-70 casts. A trip carries 500 death
   and a 250-chaos fallback: wind blast until the deaths run out, then wind bolt.
   The Magic Guild in Yanille (over White Wolf Mountain, `speedrun/lib/kandarin.ts`, about 500
   ticks each way) sells only chaos and death to the role: on 2026-10-21 other players had
   drained its 40-gp laws to 1 (240 gp) and its air to none, so laws always come from the
   exchange. The crossing happens only when Aubury and Betty left the trip short; `guild: 100`
   turns it off.
4. Wind spells on cows to Magic 41, then the dusty key (`bones.ts fetchDustyKey`, the Jailer
   killed with wind blast).
5. Down the Taverley ladder, through the door, along `SAFE_ROUTE`, farm on the tile until the
   pack is full or a cast or a telegrab can't be paid for, then bank at Falador West.

Gates that came from demo failures:

- **Food.** A pack walks the dungeon only with at least `minFood` (2) food; a trip carries
  `tripFood` (4). The route's scorpions, dwarves and skeletons and the Jailer take a
  30-hitpoint account from full to nothing, and the eat guard (eats below half hitpoints,
  also while walking) can only eat what is carried. When runes and laws are in hand but food
  is short, the role buys sharks alone.
- **Casts.** Readiness counts casts as `farm()` spends them: wind blast until the deaths run
  out, then wind bolt on the chaos. Wind strike (max 2) never counts once wind bolt is known.
- **Cost.** A trip is priced by what pack and bank lack (`tripCost` takes the held kit), at
  expected prices (`shopPrices`: staff 1,500, mind 8, chaos 40, death 60, the average up to the
  caps; laws at their cap)
  rather than the caps in `prices`, which only bound each purchase. Pricing at the caps left
  accounts waiting for funding with coins for a whole trip. `decideStep`'s buy test and
  `purchasePlan` share that shortfall, so a `buy` step never meets an empty plan; laws are
  bought first, since a trip without them telegrabs nothing. Coins short of a full trip buy one
  with the laws they cover (at least 5).
- **Out of the dungeon first.** Every step that ends on the surface (bank, buy, fund, training)
  climbs out before walking. `buy` once did not, and an account whose kit dipped below
  `minCasts` at the Jailer stood at the jail failing to path until it died.

Options (`ROLE_OPTIONS`): `train` (20), `keyMagic` (41), `tripCasts` (500), `tripLaws` (25),
`tripFood` (4), `minFood` (2), `food` ("Shark"), `minCasts` (60), `buyTrips` (1), `blast`
(true: wind blast from 41; false keeps to wind bolt), `hides` (false), `guild` (66; 100 is
off), `lawMax` (3,500), `prices` (caps: chaos 60, death 90), `shopPrices` (estimates),
`funders`.

## Measured

**Lab** (local engine, 300 ms ticks; rs/112 comments #1, #2, #6): 34 kills at Magic 45-91 with
fire bolt then fire strike, 22/22 bones telegrabbed, **0 damage on the tile**, 0 deaths, about
165 ticks and 22 casts a kill. All damage came on the route in and out. An earlier trial died
when the script let the player step to (2898, 9804), inside an adult's leash: dragonfire 49,
consistent with the leash rule.

**Demo, 2026-10-21:**

- cairn_h56, first trip (19:49:36 UTC on the tile): 10 bones telegrabbed in about 10.5
  minutes, **0 dragon damage on the tile**, 0 deaths, Magic 40 to 73 on the dragons. The only
  hp lost on the tile was poison picked up on the route (1 hp every ~30 ticks, four times).
  That is about 55 bones per hour while on the tile, an upper bound until full trips with
  the bank walk and the guild run are timed.
- cairn_h55, second trip (20:34-20:48 UTC, sharing the room with cairn_h56): 10 bones in
  about 13 minutes on the tile, 0 damage there, Magic 72 to 85.
- With two accounts on three dragons, each often lands hits on a dragon the other kills and
  gets no drop: about 2 accounts saturate the room.
- Fire-staff trips (before the wind spells) ended on air, not a full pack: cairn_h56's third
  trip had 71 casts and 2 bones.
- Three deaths, all cairn_h55, all off the tile. 18:22 UTC: walking from the Jailer with 6 hp
  and no food, before the food gate existed (about 45k gp of runes and the key lost). 20:49:
  the role was restarted while it walked out through the dungeon; the role loop waited 30 s
  before relaunching, and an idle account there dies with no eat guard running (6 bones, the
  key and its laws lost). `ctl/role.sh` now relaunches 2 s after a deliberate SIGINT; restart a
  role only while the account is on the tile or the surface. 20:57: `buy` did not climb out of
  the dungeon first (above), so it stood at the jail until the Jailer killed it (about 85k).
  cairn_h56: 0 deaths.
- Other players in the room: only the fleet's own cairn_H53 (baby blues, [bones.md](bones.md)).

## Rune supply: the real ceiling

Every shop that sells chaos and death restocks them slowly: stock 1,000 each, **chaos 1 per
100 ticks, death 1 per 150 ticks** (`varrock.inv` runeshop; Betty's `port_sarim.inv`
magicshop is the same), and a shop's price is base x (1 + 1.25% per unit below stock)
(confirmed on the demo: Aubury's 163 deaths at a 90 cap is exactly 3x the 30 base). Once
drained, Aubury, Betty and the Magic Guild together sustain only about 300 casts an hour,
**about 14 dragon bones an hour for all accounts combined** at ~22 casts a kill. Fire bolt has
the same ceiling (chaos). The stock on the shelves is a one-off buffer of a few thousand casts.

The role buys at 3x base (`prices` chaos 60, death 90: 160 units below stock per shop, about
2x base on average), one trip at a time (`buyTrips` 1), from Aubury, Betty and from Magic 66
the Magic Guild. Draining deeper (10x caps, ~720 below stock, about 6,500 gp a bone) was
tried for one shopping run on 2026-10-21 and then turned down by main (rs/41): after rs/158's
recount only the next ~61 dragon bones were worth it. Raise the caps in `prices` only for a
shortfall the coordinator approves. **These are the shops the demo's own players use too.**
Buy only what a trip uses, and if players complain in chat, scale back (lower the caps, or
`guild: 100`).

## Costs (measured prices paid on the demo, 2026-10-21)

| Item | Paid | Source |
|---|---:|---|
| Law rune | 2,991 | Exchange (Magic Guild: 40 gp base, drained) |
| Chaos rune | 20 rising to the 60 cap as Aubury's stock drains; 42-49 averaged | Aubury |
| Death rune | 30 base (stock 1,000) | Aubury; Betty in Port Sarim also stocks 1,000 |
| Mind rune | 4-10 | Aubury (training only) |
| Shark | 616-655 | Exchange |
| Staff of air | 1,000 base | Zaff, once |
| Air rune (fire-staff trips, retired) | 6-14 Aubury (about 180 a visit), 22 exchange | |

A trip is one 2,991-gp exchange law per telegrabbed bone plus about 22 casts per kill. At
Aubury's first ~160 units below stock a wind blast costs ~30-90 gp (about 4,000 gp a bone);
drained deep it averages ~165 (**about 6,500 gp a bone**, inferred). The law is the floor: the
guild's 40-gp laws are not available, and walking to drops is unsafe (above).

## Operating

**Adopt an account into the fleet** (bbs, `speedrun/helpers/fleetctl`; funders must match the
earners that will fund it):

```
fleetctl assign cairn_h55 dragons --options '{"funders":["^cairn_(h|e)\\d+$"]}' && fleetctl reload
fleetctl assign cairn_h56 dragons --options '{"funders":["^cairn_(h|e)\\d+$"]}' && fleetctl reload
```

**Fund an account** (coordinator names the earner): disable the earner, run one bidder fund
trip, re-enable it, and check that the earner went back to earning:

```
fleetctl assign <earner> coins --disable && fleetctl reload
ROLE_OPTIONS='{"bidder":"<account>","amount":80000,"keep":1000}' bun speedrun/helpers/bidder.ts <earner> fund
fleetctl assign <earner> coins && fleetctl reload
```

The recipient must be waiting at Varrock West bank (its `waiting for funding` log line gives
its position and the coins it needs). A `fund: trade` line with `ok: false` means nothing
moved; the earner re-banks the coins.

**Watch it:** the role logs `step`, `banked`, `damage` (every hp loss, with the step and the
tile), `drift` (pulled off the tile), `died`, and `progress` after every telegrabbed bone
(`bones`, `bonesPerHour`, `deaths`, `damageOnTile`). Damage on the tile from anything but
route poison means the safe-tile assumption broke: stop the account and look.

**Restart only on the tile or the surface.** Find where an account is with
`bash ~/rs-dev/dragons/ctl/peek.sh <acct>` on bbs (the dev gateway's read-only `/state`) or the
last `step` line of its log.

## Open

- Full-trip bones per account-hour, including banking and shopping, from a clean hour.
- A cheaper law: a standing exchange bid below the 2,991 ask (`bidder.ts`).
- The lab's engine trace (`speedrun/lab/npc-target-trace.patch`) logged only each dragon's
  first state; it needs hooking where the engine processes every NPC every tick before it can
  attribute hits to a dragon's target.
- Green dragons (Wilderness) fall under the same `dragon.rs2` rule, but no safe tile there has
  been checked.
