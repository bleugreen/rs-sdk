# Haunted Mine

**About 1,070 ticks (5.4 minutes at 300 ms) from the zealot to the crystal, for
22,000 base Strength and 2 quest points**, plus about 125 ticks to walk from the
Priest in Peril holy barrier to the zealot. That is about 20 base xp per tick
for the quest itself, and 22,000 is 55% of level 99 (39,938). The route through
the mine is measured end to end at the production tick rate. The Treus Dayth
fight (about 325 ticks) is the one large uncertainty: a lab bot killed it once
in six serious attempts, and in at least two runs the boss was left at 0-11% and
never died (see Risks).

All ticks are stock-client figures. The route segments were measured with
`docs/speedrun/scripts/quest-hauntedmine-run.ts` at `NODE_TICKRATE=300`
(production rate); a second full run at `NODE_TICKRATE=100` gave the same
counts within a few ticks per segment. Primitive costs come from
[primitives.md](primitives.md).

## Reward

- **22,000 base Strength**: `stat_advance(strength, 220000)` when you cut a
  crystal at stage 10 (read, `hauntedmine_crystals.rs2:52-55`). Measured: +550,000
  game xp (= 22,000 × 25).
- **2 quest points** (read, `general/configs/quest.constant:98`).
- A crystal shard (`crystalshard_necklace_unstrung`) and access to the crystal
  chamber; the quest scroll also names Tarn's Lair, which this content does not
  have.

**The reward is claimable at once after the fight, and it needs a later step,
not the crystal.** Killing Treus Dayth sets stage 9 (`hauntedmine_boss_ghost.rs2:252`).
Taking the key again gives the `hauntedmine_reward_key` (`:30-35`). Opening
the crystal-chamber door with the key from the chamber side sets stage 10
(`hauntedmine_crystals.rs2:13,28`, the zone `0_43_69_20_33`-`21_34`; measured: one
open from the north side set it). Cutting **any** crystal at stage 10 then pays
the xp (`:52-55`); the xp line is `stat_advance` itself, not a queued completion,
so it lands the tick you cut. The crystal is a `crystalshard_necklace_unstrung`
that needs nothing else for the reward.

## Requirements (as this server enforces them)

- **No skill requirement.** The journal lists Agility 15 and Crafting 35 with
  `stat_base` (`hauntedmine_journal.rs2:10,13`), but that is display text only:
  no script in `quest_hauntedmine/` calls `stat()` or `stat_base()` (read, grep),
  the obstacle cart and cart tunnels have no Agility check, and the crystal needs
  only a chisel (`hauntedmine_crystals.rs2:40`).
- **No quest check either.** Nothing reads `%priestperil` outside the journal
  (`hauntedmine_journal.rs2:16`). The real gate is getting into Morytania: the
  Priest in Peril holy barrier needs `%priestperil` = 61
  (`area_mausoleum/scripts/holy_barrier.rs2:2`), see [priest_in_peril.md](priest_in_peril.md).
- **Items the steps check:** the zealot's key on the lift valve
  (`hauntedmine_lift.rs2:72-79`); a glowing fungus to go down the dark stairs before
  stage 8 (`hauntedmine_darkstairs.rs2:36`); a chisel for the crystal; one free
  slot for the crystal (`hauntedmine_crystals.rs2:44`).
- **The fight:** the journal says "defeat a level 95 enemy". Treus Dayth is not
  attackable by anyone but the player who woke it (`npc_combat.rs2:195,306`).

## Items: helper-supplied and scored-account-only

| Item | Tradeable | Source |
|---|---|---|
| Chisel | yes | helper |
| Food (sharks) | yes | helper, about 15 |
| Runes for Crumble Undead (air, earth, chaos), or a melee weapon | yes | helper |
| Zealot's key (`hauntedmine_lift_key`) | **no** (`hauntedmine.obj`) | pickpocket the zealot |
| Glowing fungus | **no** | the mushroom pool, then the cart puzzle |
| Crystal-mine key (`hauntedmine_reward_key`) | **no** | the boss's key after the fight |

One trade (9 ticks) before the quest covers chisel, food and runes. Don't carry
a light source or tinderbox into the lift: the flooded chamber extinguishes and
soaks them (`hauntedmine_lift.rs2:31-41`). Fungus crumbles in sunlight
(`hauntedmine_fungus.rs2:30-52`), on a teleport (`teleport.rs2:114`) and on death
(`death.rs2:30`), so the route never carries it outside.

## Step list

Quest varp `%hauntedmine` (perm), stages from `hauntedmine.constant`: 0, 1
started, 3 found the secondary entrance, 4 found the lift, 5 used the lift, 6/7
dark/light stairs, 8 boss found, 9 boss defeated, 10 reward door, 11 complete.
Bits are in `%hauntedmine_bits` (perm).

Measured column: one end-to-end run at `NODE_TICKRATE=300` (zealot to the boss
room) plus the reward route measured separately; tiles are the pathfinder's
route tiles the script logged.

| # | Where | Action | Varp | Raw counts | Ticks | Label |
|---|---|---|---|---|---|---|
| 0 | Holy barrier exit (3423,3485) → zealot (3444,3256) | Run south through Morytania | | 244 route tiles | **123** | inferred: `quest-priestperil-routes.ts` route, 0.5/tile + 1 |
| 1 | Saradominist zealot (3445,3257) | Talk: "Saradomin", "seeking challenges", "What quest is that", "other way into the mines"; then Pickpocket (no Thieving check, no fail, `zealot.rs2:287-304`) | 0 → 1, bit 10 | 21 pages, 4 options, 1 pickpocket | **54** | measured |
| 2 | Obstacle cart (3445,3236) → cart tunnel (3440,3232) | Cross the cart, crawl in | 1 → 3 | 27 tiles, 2 interactions | **23** | measured |
| 3 | Main half → back entrance 1 (3404,9631) out → back entrance 2 (3429,3225) in | The zealot's side reaches the second half only via the surface ledge | | 42 tiles, 2 crawls | **28** | measured |
| 4 | Ladders 3422,9625 → 2798,4567 → cart-1 corridor → 2725,4486 | Three ladders; dodge cart 1 in its corridor (below) | | 66 tiles, 3 climbs, cart wait 22 | **78** (83 at 100 ms) | measured |
| 5 | Glowing mushroom (2791,4496) | Pick the fungus | | 13 tiles | **9** | measured |
| 6 | Puzzle cart (2778,4506) | Use the fungus on it | bit 0 | 15 tiles | **9** | measured |
| 7 | Points settings (2769,4522) | View the panel: randomises the levers the first time (`hauntedmine_points.rs2:2-5`) | bit 21 | 24 tiles | **14** | measured |
| 8 | Levers 1-5 (2784-2786, 4515-4517), 6-8 (2768-2770, 4533) | Pull the wrong ones (2.5 expected, below) | bits 1-8 | 3 pulls, 50 tiles | **29** (26 for 2 pulls) | measured |
| 9 | Points settings | Send the cart: success animation, fungus to the end cart | bit 9 | 1 click, 1 page, 49 tiles | **41** | measured |
| 10 | Mushroom half → surface → back entrance 1 → ladders 3413,9633 → 2797,4599 → 2710,4540 | Out the way you came (cart 1 again), in at the other entrance, down to the end cart | | 198 tiles, 6 climbs, 2 crawls, cart wait 31 | **114 + 56 = 170** | measured |
| 11 | End cart (2774,4537) | Search, "Take it" | | 3 tiles, 1 option | **7** | measured |
| 12 | Ladders 2774,4540 up, 2732,4529 down | Cross cart 4's track (below) | | 50 tiles, 2 climbs, cart wait 3 | **37** (35-44, n=5) | measured |
| 13 | Water valve (2808,4496) | Use the zealot's key | 3 → 4 | 41 tiles | **22** (22-23, n=5) | measured |
| 14 | → Lift (2807,4492) | 59-step route through the cheeky ghost's zone; ride down | 4 → 5 | 60 tiles, 3 clicks (below) | **37** | measured |
| 15 | Flooded level (2725,4452) → dark stairs (2746,4436) | Carrying the fungus: the lit stairs | 5 → 7 | 38 tiles | **24** | measured |
| 16 | → Innocent looking key (2788,4455) | Through the boss door (2799,4453) | | 25 tiles, 1 door | **7** | measured |
| 17 | Key | Take: cutscene, Treus Dayth appears | 7 → 8 | 2 pages, `p_delay` 1+1+1+2 | **16** (16-17, n=8) | measured |
| 18 | Boss room | **Fight Treus Dayth** (below) | 8 → 9 | about 40 casts, 10 sharks | **about 325** | measured once at 99 Magic/99 Hitpoints (kill between ticks 312 and 337); see Fights |
| 19 | Key | Take it again: the crystal-mine key | | 1 page | **7** (6-8, n=2) | measured |
| 20 | Boss door → east stairs (2812,4452) up | The crystal chamber is not connected to the boss room | | 24 tiles, 1 door, 1 climb | **17** | measured |
| 21 | Flooded level west → west stairs (2692,4436) down | Wading: walking pace, about 1 tile per tick | | 70 tiles, 1 climb | **88** | measured |
| 22 | Large door (2772,4450) | Open with the key from the north | 9 → 10 | 16 tiles, 1 door | **12** | measured |
| 23 | Crystal outcrop (2788,4428) | Cut with the chisel | 10 → 11 | 27 tiles, 1 interaction | **16** | measured: +550,000 Strength xp |

The end-to-end runs: `--from=zealot --to=stairs` at 300 ms (steps 1-15: 559
ticks), boss and reward at 100 ms (`--from=boss`, `--from=reward`).

### The cart puzzle (steps 6-9)

Viewing the panel sets the eight lever bits to `random(256)`
(`hauntedmine_points.rs2:2-5`); pulling a lever toggles its bit
(`:130-148`). The cart reaches the end only with b=1, a=1, c=0, d=0, j=0
(`:20-29`), i.e. levers 1 and 2 up, 3, 4 and 7 down; e, i and k don't matter.
So each of the five relevant levers is wrong with probability 1/2: **2.5 pulls
expected** (0 to 5), about 9 ticks each with the walking, and lever 7 means a
trip to the northern alcove (half the time). A wrong send sinks the cart and
loses the fungus (measured: "the mine cart seems to have sunk", bit 0 cleared),
so fetching a new fungus and repeating costs about 60 ticks.

**Reading the lever state.** The panel shows the points through
`if_setmodel` (`hauntedmine_points.rs2:6-13`); the lab script reads the varp with
`::getvar` instead. The lite client receives those model ids
(`server/webclient/src/lite/protocol/incoming.ts`, `IF_SETMODEL`) but the bot
state does not expose them (`InterfaceState` in `server/webclient/src/bot/types.ts`).
A production bot needs that small addition to solve the puzzle in one go;
without it the only information is the failure animation, at about 60 ticks per
wrong guess.

### Moving carts (steps 4, 10, 12)

Cart NPCs patrol one-tile corridors and push anyone on the tile ahead of them
back a tile, half the time for 0-2 damage (`hauntedmine_cart.rs2`).

- **Cart 1** patrols x=2727 between z=4491 and 4509, parking 3 ticks at each end
  (`hauntedmine.npc`, `hauntedmine_cart1`). Its corridor is the only way between
  the mushroom half and the ladders, with two one-tile alcoves at (2728,4503) and
  (2726,4496). The crossing: step into the alcove between you and the cart, let
  it pass, run the rest behind it. Measured waits per crossing: 22-31 ticks
  (entry 9-16, alcove 13-15), twice per quest.
- **Cart 4** patrols x=2739 between z=4528 and 4531 (14-tick cycle, 4 ticks
  parked at each end) and is the only way to the lift-area ladder. Wait at
  (2739,4532) for it to arrive at its south end, then run down to (2738,4529):
  3 ticks of crossing plus 3-12 waiting (measured, n=5).

### The lift and the cheeky ghost (steps 13-14)

The valve and the lift are on opposite sides of a wall, and the only route
between them (59 steps) crosses the cheeky ghost's zone (local 48_32-51_36). Once
the lift is powered, entering that zone spawns a ghost that turns the valve off
25 ticks later (`hauntedmine_lift.rs2:94-149`). The run takes about 17 ticks
after the zone, so there is no slack for a wasted click: the click route from the
valve stops two tiles short at (2805,4493), and a second click from there enters
the lift (measured, 3 clicks). Of the three lift panels only the side ones
(4937, 4938) can be reached from the entrance.

## Fights

**Treus Dayth** (`hauntedmine_boss_ghost`): 100 hitpoints, Attack 70, Strength
70, Defence 100, stab/slash/crush defence +5, **magic defence -5**, undead
(`hauntedmine.npc:174-216`). Every 5 ticks it makes one attack, chosen by where
you stand: a mine cart along your track zone or a crane next to you (1/3 chance
of 0-10), otherwise a thrown pickaxe (1/3 chance of 0-15, 0-10 with Protect from
Missiles) (`hauntedmine_boss_ghost.rs2:125-241`). None needs line of sight. On
half of the hits it takes it fades and runs to one of six spots round the room
(`:244-349`, `movechance` 2, `movecount` 6); while faded it can't be attacked. It
spawns with a **1,000-tick lifetime** (`:54`) and despawns if you leave the room
or log out (`:113-123`); taking the key again spawns a new one at full health.

Measured (bot, `quest-hauntedmine-run.ts --style=magic|melee`):

| Setup | Result |
|---|---|
| 99 Magic, 99 Hitpoints, Crumble Undead | **killed between ticks 312 and 337** of the fight; 10 sharks, down to 29 HP (n=1) |
| 99 Magic, Crumble Undead | two runs got it to 0-11% by about tick 470 and it never died (stage stayed 8); one stalled in positioning |
| 70 Magic, 70 Hitpoints, Crumble Undead | 100% → 8% in 260 ticks, then died on bot positioning stalls (20 sharks); another run reached 0% and it never died |
| 70 melee, rune scimitar | never killed; best 80 damage in 358 ticks. Defence 100 against a rune scimitar, and every fade-and-move needs a fresh approach |

**Inferred plan: Crumble Undead (Magic 39; helper-supplied air, earth and chaos
runes), about 325 ticks, about 15 sharks at 70 Hitpoints.** Its maximum hit is
fixed by the spell, and with magic defence -5 almost every cast lands, so 70
and 99 Magic hit about the same; the difference is the hitpoint pool. Melee is
slower and needs a free path to every spot.

Why a bot finds it hard (all measured): the cranes (size 3) and mine carts are
blocking NPCs that the SDK pathfinder and the lite client's click route don't
know about, so clicks into the room go nowhere when a cart is parked across a
corridor; the cranes also block line of sight for spells although the static
collision doesn't show it; the room is 31 tiles north-south, more than the
15-tile NPC view, so from one end the boss is invisible while it keeps hitting
you; and standing in a cart zone makes the boss move a cart, which can shut you
in a pocket. The script's `--style=magic` loop handles these with an
NPC-aware path search, a per-spot casting-tile table, and a "safe region" that
no cart can cut off. It is still not reliable.

## Tick total

| Category | Ticks | Basis |
|---|---|---|
| Travel (runs, climbs, crawls, doors, the lift ride, flooded-level wading) | **475** | measured (steps 2-4, 10, 12-16, 20-21 less the cart waits) |
| Dialogue (zealot, end cart, cutscene, key twice, kill message) | **86** | measured (steps 1, 11, 17, 19) + 2 inferred for the kill page |
| Interactions (fungus, panel, levers, send, door, crystal) | **130** | measured (steps 5-9, 22-23); 3 lever pulls, 2.5 expected |
| Fights | **325** | measured once at 99/99 (step 18) |
| Forced waits (carts 1 and 4) | **56** | measured (22 + 31 + 3) |
| **Total, zealot to crystal** | **1,072** | |
| Plus the walk from the holy barrier to the zealot | 123 | inferred (step 0) |

At the patched-client floor (cairn://p/rs/22) the zealot conversation drops by
about 25 ticks and the other dialogue by about 6 (inferred from primitives.md).

## Risks and gotchas

- **The kill can fail to count.** In two of the 99-Magic runs and one 70 run the
  boss reached 0-11%, stopped taking damage and later despawned while
  `%hauntedmine` stayed 8. The death handler exists only for the normal boss type
  (`[ai_queue3,hauntedmine_boss_ghost]`, `hauntedmine_boss_ghost.rs2:247-249`); the
  faded type has none, and NPC queue entries are consumed whether or not the
  current type has a handler (`Npc.ts` `processQueue`). A death that comes due
  while it is faded would explain it, but I didn't establish the exact order.
  Cost: another key, another full-health boss.
- **The 1,000-tick boss lifetime** (`:54`): a slow fight ends with nothing.
- **Cart puzzle guesses sink the fungus** (about 60 ticks each, above).
- **The lift window**: a wasted click after the ghost's zone loses the valve;
  re-turning it means the 59-step route again.
- **Fungus**: crumbles in sunlight, on teleport and on death; the route keeps it
  underground.
- **Logout:** all quest state is permanent (`hauntedmine.varp`). Logging out
  mid-fight despawns the boss; the lift's valve-off timer is a queue and is lost
  on logout (harmless).
- **Level-up dialogues** interrupt the fight (one or two per fight at these
  levels, measured), and Strength jumps by 22,000 base at the crystal.
- **Lab-only artefacts I hit, for the next measurer:** the mime random event
  clears all side tabs (`macro_event_mime.rs2`), and `::tele`ing away leaves
  them cleared, so every inventory op is silently dropped until a relog; and an
  op sent while a previous one is pending replaces it, so wait for each op's own
  message (by message index, not by tick).

## Open questions

- Why the kill sometimes doesn't count (above), and whether a melee or a
  slower spell avoids it. Worth a lab test that sets the boss's hitpoints low.
- A reliable bot fight at the account's real stats; the measured kill is n=1.
- Exposing `if_setmodel` model ids in the bot state, so a production bot can read
  the points panel.
- Whether a Morytania teleport in this content shortens step 0 (I found none
  usable before this quest).
