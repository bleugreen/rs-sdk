# Helper role: essence miner

`speedrun/helpers/essence.ts` takes a brand-new demo account through Rune
Mysteries, then mines rune essence through Aubury's teleport in Varrock and
banks it at Varrock east bank, forever or until a trip/stock limit. It is the
Runecraft supply line for the scored account (cairn://p/rs/36).

## What it does

1. **Tutorial.** On Tutorial Island it calls `bot.skipTutorial()`. The account
   arrives in Lumbridge with the starter kit, which includes a bronze pickaxe,
   and 25 coins in the bank.
2. **Rune Mysteries** (no requirements, no items). Duke Horacio (Lumbridge castle,
   first floor) gives an air talisman; Sedridor (Wizards' Tower basement) takes it
   and gives a research package; Aubury (Varrock rune shop) takes the package and,
   on a second talk, gives research notes; Sedridor takes the notes, completes the
   quest and hands the air talisman back. Scripts: `duke_horacio.rs2`,
   `sedridor.rs2`, `aubury.rs2`, `quest_runemysteries.rs2`.
3. **First bank visit** deposits the whole starter kit except the pickaxe, which it
   wields. The air talisman goes to the bank too.
4. **Mining loop.** Aubury's Teleport option (op4, no dialogue) puts the account at
   a random spot in the essence mine. It mines the nearest of the four essence
   rocks until the pack is full (28 with the pickaxe wielded), takes the nearest
   exit portal (which returns it to Aubury's shop), walks to Varrock east bank,
   deposits the essence, reports the bank, and walks back to Aubury.

The quest stage is not published to the SDK, so the role reads it from what the
account holds (talisman, package, notes) and from what the NPCs offer, which
makes it restartable from any point: a restart near Varrock tries Aubury's
teleport first (a few ticks), a restart near the Wizards' Tower asks Sedridor
first, and anything else starts from the Duke, who re-issues a lost talisman
while the quest is in progress.

## Engine facts it relies on (read)

- **Only rune essence exists** in this revision: obj `blankrune`, "Rune essence"
  (`skill_mining/configs/ores.obj`). There is no pure essence, and every altar
  binds rune essence (`skill_runecraft/scripts/runecraft.rs2`).
- **Essence has no success roll.** `get_ore_essence` (`skill_mining/scripts/mining.rs2`)
  adds one essence every pickaxe cycle. A cycle is `mining_rate + 1` ticks:
  bronze 8, iron 7, steel 6, mithril 5, adamant 4, rune 3 (`pickaxes.obj`). Mining
  level only gates which pickaxe can be used (1/1/6/21/31/41); it does not change
  the rate.
- **The rocks never deplete and the mine is shared, not instanced.** Four 5x5
  rocks, each with an exit portal within about six tiles
  (`maps/m45_75.jm2`). Many players can mine one rock at once, so accounts do not
  contend.
- **Mining xp is 50 base per essence** (1,250 at the demo's 25x), so a fresh
  account passes Mining 41 within its first trip.
- **A wielded pickaxe counts** (`pickaxe_checker.rs2` checks the right hand), which
  frees the 28th slot. Wielding needs Attack 1/1/5/20/30/40 for
  bronze/iron/steel/mithril/adamant/rune (`levelrequire/scripts/tier*.rs2`); an
  unwieldable pickaxe still works from the pack (27 per trip).
- **Random events are off on the demo** (`NODE_RANDOM_EVENTS = "false"` in
  `fly.toml`), so nothing interrupts the loop except level-up dialogs, which the
  role dismisses.

## Measured on the demo (rs-sdk-demo.fly.dev, 300 ms ticks, bbs, loopback gateway)

Four accounts (cairn_h30-h33) ran concurrently and unattended from 05:07 UTC on
2026-10-21, 89 trips in the first 38 minutes with no failed cycle.

| What | Measured |
|---|---|
| Rune Mysteries, tutorial skip to quest complete | 3 min 45 s and 3 min 54 s (two fresh accounts, no retries); a third finished on its own across a server restart mid-quest |
| One trip, bronze pickaxe, 28 essence | 326 ticks on average (93-109 s): 14.5 to reach the mine, 237 mining, 74.5 leaving, banking and walking back to Aubury |
| Mining time per essence, bronze | 8.5 ticks (engine cycle 8, plus re-clicks) |
| Essence per account-hour, bronze | 1,024-1,026 on each of the four accounts |
| Levels trained | Mining only: 41 during the first trip, about 69 after an hour; nothing else |

**Mining level does not change the rate.** Ticks per essence by Mining level,
bronze pickaxe, over 145 full trips: below 41, 9.1 (frequent level-up dialogs
interrupt the first trip); 41-54, 8.5; 55-64, 8.5; 65 and up, 8.5.

**The pickaxe does.** Projected from the cycle formula and the measured 89 ticks of
non-mining overhead per trip, with the pickaxe carried in the pack (27 per trip,
since a helper has Attack 1 and cannot wield adamant or rune): adamant about
1,550 essence per account-hour, rune about 1,780 (inferred, not run).
Wielding it (Attack 30/40) adds one essence per trip, about 1%.

## Options

| Option | Meaning |
|---|---|
| `trips` | stop after this many banked trips (default: no limit) |
| `target` | stop once the bank holds this many essence (default: no limit) |

The role uses the best pickaxe it holds or finds in the bank, so a better pickaxe
can be upgraded by placing it in the account's bank (by trade from the mule or
fleet). Nurmof's pickaxe shop in the Dwarven Mine stocks bronze to rune
(`area_falador/configs/dwarven_mine.inv`, `[pickaxeshop]`: two adamant at 3,200 gp
base, one rune at 32,000 gp base, restocking). The GE had no adamant or rune
pickaxe for sale on 2026-10-21. Adamant is the cheap upgrade (+50%); the role does
not buy pickaxes itself.

**Essence is valuable on the demo market**: on 2026-10-21 rune essence traded at
78-87 gp with about a million units of open buy orders, so one bronze account-hour
is worth about 80,000 gp. Selling an hour's essence would buy an adamant pickaxe
many times over, and a rune pickaxe for one account.

## Running it

**In the fleet** (the normal way): the role has no required options, so adopting
an account is `fleetctl assign cairn_h30 essence` then `fleetctl reload`
(`docs/speedrun/HELPERS.md`). A brand-new account in the range goes straight in
with `fleetctl add h30-h34 --count 1 --role essence`. The fleet owns the gateway,
re-logins and clean logouts; the role logs `phase {from, to}` (tutorial, quest,
mine), which `fleetctl status` shows, and a `trip` line about every 100 s.

**Standalone** (development), from the repo root, with the account's lite client
already running:

    bun speedrun/helpers/essence.ts cairn_h30

On bbs, run a loopback gateway (`server/gateway/gateway.ts` with
`AGENT_PORT=<port> GATEWAY_HOSTNAME=127.0.0.1`; the public gateway delivers state
in bursts) and set `GATEWAY_URL=ws://127.0.0.1:<port>` for both the lite runner
and the role, in a development copy's own `bots/<account>/bot.env` only. Never
add it to `~/rs-fleet/bots/`: the fleet refuses an env file that bypasses its
gateway. Wrap client and role in restart loops: the demo server restarts
occasionally (one logged everyone out at 04:31 UTC on 2026-10-21 and refused
logins for about a minute), and the role resumes from wherever the account is.
To stop, click logout (component 2458, `speedrun/lib/session.ts` `logoutClean`)
before ending the client: SIGINT to the lite runner only closes the socket, which
leaves the account in the world for up to 500 ticks.

**How many accounts.** The mine does not contend: four accounts mining at once
measured the same 1,024-1,026 essence per hour each, matching a single account,
and the rocks never deplete. The count is limited only by the per-IP session
budget. Four accounts make about 4,100 essence per hour with bronze pickaxes, so
the first-pass target of 4,200 takes about an hour of four accounts.

**Relogin.** If the client wrapper restarts the lite client, back off
exponentially with jitter and wait minutes after a `Too many login attempts`
(code 16) refusal; the role itself waits on wall-clock timers for the session to
come back and resumes from wherever the account is.

## Gotchas

- **The SDK's collision map encloses the Wizards' Tower ladder top** (3105,3162),
  so `bot.walkTo` finds no route out of the tower after climbing up from the
  basement. The role takes one client-routed step (`sdk.sendWalk`) to the north
  doorway first; the client's own router uses the live map.
- **The SDK names the essence rock "Rocks rune essence ore"**, not "Rune Essence".
- **Message boxes publish "Click here to continue" as a dialogue option**, so a
  conversation loop must treat it as a continue.
- **`recentDialogs` records a page only when the chat interface changes**
  (newest first), so consecutive pages of the same type are missing from it.
- Back off on wall-clock timers, not `waitForTicks`: after a dropped session no
  ticks arrive and a tick wait throws.

## Talismans for the Runecraft route (investigated, not built)

- **Air talisman:** every helper that completes Rune Mysteries gets one back from
  Sedridor (this role banks it). Goblins also drop them (`drop tables/scripts/goblin.rs2`).
  Tradeable.
- **Law talisman: not tradeable** (`tradeable=no`, `skill_runecraft/configs/runecraft.obj`),
  and an untradeable item dropped on the ground is never revealed to other players
  (`server/engine/src/engine/zone/Zone.ts`). The only sources are the Troll
  Stronghold reward (`quest_troll.rs2`) and Dunstan in Burthorpe, who re-issues one
  once Troll Stronghold is complete (`death_smithy.rs2`). So the scored account
  must complete Death Plateau and Troll Stronghold itself; helpers cannot supply it.
  There are no tiaras in this revision. The law altar is on Entrana
  (ruins at 2858,3381; `runecraft.dbrow`), whose monk refuses weapons and armour,
  so an essence giver there must carry no pickaxe. A helper cannot enter the law
  altar room without its own law talisman, so a hand-off at the altar means a
  helper waiting outside the ruins unless that helper also does Troll Stronghold.
- **Other tradeable drops:** mind (imps, wizards), water and fire (dark wizards),
  earth (men, farmers, rogues), body (giants, guards), fire (skeletons); chaos and
  nature from the members rare-drop table (`shared_droptables.rs2`). No drop source
  was found for cosmic, death, blood or soul talismans.
