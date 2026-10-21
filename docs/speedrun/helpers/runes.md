# Runes role (`speedrun/helpers/runes.ts`)

One helper account buys the scored run's magic supplies (`docs/speedrun/SUPPLIES.md` section 2): the rune lines, staff of water and staff of fire, and 3 spare air talismans. It trains Magic to 66 on the way, so it can shop at the Magic Guild. The amulets of magic and strength, the charged glories and the nature talismans are not in this role (see *Lines this role does not cover*).

```
ROLE_OPTIONS='{"funders":["^cairn_h47$"],"minCoins":30000}' bun speedrun/helpers/runes.ts cairn_h88
```

Fleet: `fleetctl assign cairn_h88 runes --options '{"phases":["shops","talismans","magic","guild","lundail"]}'`. One account is enough, and two would contend for the same shelves.

## Phases

Every target is a holding (bank + inventory + worn), so a restart, a death or a second run only does what is missing. The role passes over the phase list up to `rounds` (8) times, until every phase is done or skipped.

| Phase | Where | What |
|---|---|---|
| `fund` | Varrock west bank | Waits for trades from `funders` until the bank holds `minCoins`. Funding goes through `bidder.ts <earner> fund` with an `amount`. |
| `shops` | Zaff (Varrock) | Staff of water, staff of fire, and a staff of earth while training. |
| `talismans` | Duke Horacio (Lumbridge castle, plane 1) | 3 air talismans: the Duke hands one over whenever the account holds none anywhere (`duke_horacio.rs2`), so the role drops each one, asks again, and picks them back up. |
| `magic` | Aubury, Betty, Lumbridge cows | To Magic 66, 300 casts at a time: buy that many air and mind runes (Aubury, then Betty for what Aubury's shelf won't give under the cap), strike cows with all of them (Wind Strike, then Earth Strike with a staff of earth from 9), bank, repeat. About 1,530 casts from level 1 at 25x. |
| `guild` | Magic Guild store, Yanille (Magic 66) | Every manifest rune but cosmic: blood, law, death, chaos and the elementals. The shelves hold 1,000 (blood, law, death, chaos, nature) or 3,000 (elementals) at base price. |
| `lundail` | Mage Arena cellar, via the Ardougne lever | Cosmic runes (the only shop), and laws if the guild left any short. |

## Coins: never carry more than one capped purchase

A death drops everything carried, and this role's account is the easiest kind to kill: low level, and it never fights back. On the first demo run it lost about 137k that way (rs/123). So:

- Every purchase is cut to `maxCarry` (30k) at its price caps (`limitToCarry`). The guild's 570 blood therefore takes several trips from Yanille bank, which is a short walk.
- `walk()` refuses to move while the account carries more coins than the current purchase allows, and logs `carry guard`.
- The buyer banks everything, coins included, at the end of each purchase.
- No idle waits in shops (`shopWaitTicks` 0). Above a cap, the role leaves, and a later round or chunk comes back after restocks.

## Hazards

- **Combat random events.** Each player has a 1-in-24 chance of a random event every 500 ticks, 1-in-12 while it hasn't changed zones (`World.ts` AFK_EVENTRATE/AFK_CHANCE). The Swarm is aggressive (`macro_event_swarm.rs2`), and a Triffid turns hostile if its fruit isn't picked. At 10-15 hitpoints the account dies.
- **White Wolf Mountain.** The shortest land route from Asgarnia to Kandarin (Ardougne, Yanille) crosses it, and its wolves kill a combat-3 account. The `guild` and `lundail` phases wait for Hitpoints `minHitpointsWest` (30). Magic combat gives Hitpoints xp (`combat.rs2`), so the training gets the account there. Dying on the way east with nothing carried is harmless: the respawn in Lumbridge is closer.
- **The Deserted Keep web.** The Ardougne lever lands inside the Deserted Keep (Wilderness ~53), whose only way out is north through a web at (3158, 3951) (`bigweb_slashable` in m49_61). Cutting it needs a wielded weapon with a slash animation (`slash_checker.rs2`): the tutorial's bronze axe or sword will do. A cut succeeds half the time, and the web regrows after 100 ticks, so the trip cuts it on the way in and again on the way out. The role takes coins and that weapon into the Wilderness, nothing else. The SDK's pathfinder treats the web tile as blocked, so the role cuts the web and steps through it by hand (`crossWeb`).
- **Lundail's cellar** (2536, 4718) is outside every `wilderness_zones` rectangle, so no PvP there. The walk from the keep's web to the ladder at (3091, 3956) is at Wilderness level ~53-55. Cosmics restock 1 per 100 ticks; the role waits in the cellar for them (`lundailWaitTicks`) only at Hitpoints 30 or more.
- **Drained shelves.** Shops are shared with other players. Aubury's air and mind were above 3x base after a few dozen units on 2026-10-21; Betty's were full.
- **Dropped sessions.** When the server logs the account out (the demo restarted at ~20:00 UTC on 2026-10-21), the role waits for the relog instead of spending its rounds.

## Sources, prices and rates

Shop prices follow `shop.rs2` `calc_shop_value`: each unit below the configured stock adds `delta/1000` of base, up to 6x. Restock is 1 unit per `restock` ticks while below stock (`*.inv`). The tests in `runes.test.ts` encode the formula.

| Line | Source | Cost (full shelf) | Notes |
|---|---|---|---|
| Cosmic 62 | Lundail | 20 for 376 gp | Stock 20, +1 per 100 ticks (120/hour). The GE has no sellers (bid 1,000). 62 includes 2 for enchanting the two amulets. |
| Blood 570 | Magic Guild | 108,250 gp | Lab: 502 bought for 87,760 before the 300 gp cap. The GE is 578 bid / 959 ask. |
| Law 50 | Magic Guild (or Lundail) | ~2,500 gp | The GE ask is ~3,000 each. |
| Death 110, chaos 40 | Magic Guild (Aubury, Betty) | ~5,000 / ~700 gp | |
| Elementals (air 1,650, fire 85, water 30, earth 52, mind 4) | Magic Guild | base 4-5 gp | 3,000 of each. |
| Staff of water, staff of fire | Zaff | 1,500 each | Stock 2. |
| Air talisman 3 | Duke Horacio | free | About 20 seconds on the demo. |
| Magic training (~1,530 casts) | Aubury, Betty | ~4-12 gp per rune | Air and mind, one of each per cast. |

## Lines this role does not cover

- **Amulet of glory (charged), 2:** unobtainable as far as this revision allows. No GE sellers; another player bids 300k for 70 uncharged ones; charging needs the Heroes' Guild fountain, behind Heroes' Quest (`heroes_entrance.rs2`). rs/103 and rs/129 plan the run without glories.
- **Nature talismans (N+1 for the altar givers):** the only source is the surface jewel drop table (`randomjewel` in `shared_droptables.rs2`, 4/128), about 1 in 800-2,000 kills depending on the monster, and the GE has never had a seller. A probe bid (6 at up to 35k) belongs on the standing bidder as a line (`bidder.md`). A talisman isn't consumed when entering the ruins, so a talisman keeper at the ruins would cut the count; rs/117 decides.
- **Amulets of magic and strength:** no sellers. They are made from a strung sapphire and a strung ruby amulet (rs/121), then enchanted (Magic 7 and 49, one cosmic each).

## Lab

`speedrun/lab/runes-lab.ts` runs one phase per scenario on a local engine, set up with staff commands:

```
WEB_PORT=9560 WEB_MANAGEMENT_PORT=9561 HISCORES_WEB_PORT=9562 NODE_PORT=44560 AGENT_PORT=8560 \
  speedrun/lab/lab.sh rnlab speedrun/lab/runes-lab.ts:--only=talismans,magic,guild,lundail
```

The lab checks the walking, banking and shop parts (the guild scenario's capped trips work there), but not the parts that use an inventory item or a spell. On this lab setup, strikes on the cows, wielding the bronze axe and using it on the keep web were all ignored by the engine with no game message, while the same actions work on the demo. Until that is understood, Magic training and the web crossing are checked on the demo. If the crossing fails there, the role pulls the keep lever and leaves rather than staying in the Wilderness.
