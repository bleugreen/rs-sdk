# Quest route documents: shared conventions

Every `docs/speedrun/quests/<quest>.md` follows these rules so the README can
put all quests into one xp-per-tick table and one ordering. If a rule here turns
out to be wrong on this server, say so in your document and tell the quest-route
coordinator (cairn://p/rs/3); do not silently diverge.

## What we are optimising

The scored account's playtime: ticks logged in (300 ms each on production,
`fly.toml:26`). Xp is 25x for quests too, and level 99 is 39,938 base xp
(`server/engine/src/engine/entity/Player.ts:77-85`). Report all xp as **base**
xp (game xp / 25).

Count only what the scored account spends logged in: travel, dialogue, loc and
item interactions, fights, cutscenes and forced waits. Helper accounts can hand
over any **tradeable** item, so gathering or crafting a tradeable quest item
costs zero, but the trade itself costs ticks (count one trade as a segment).
Anything untradeable, or anything a script ties to the player (a varp, a spawned
item only the player can pick up), must be done by the scored account and counted.

## Labels on every number

- **read**: `path:line` in `server/content/scripts/**` (or `server/engine/**`).
- **measured**: on a local server, naming the committed script that produced it
  (`docs/speedrun/scripts/quest-<quest>-<what>.ts`, run as
  `bun docs/speedrun/scripts/quest-<quest>-<what>.ts <botname>`).
- **inferred**: anything else, with a one-line basis.

## Record raw counts as well as ticks

The tick cost of the timing primitives (a dialogue page, a door, a ladder, a
teleport, a boat ride, a trade) is **measured** in `primitives.md`, which has the
full tables, the scripts and the floor figures for a fixed client. Use the
values below, and **also record the raw counts** per segment, so the README can
recompute every quest if the client fix (cairn://p/rs/22) lands:

| Primitive | Ticks (stock lite client) | Basis |
|---|---|---|
| Run, per route tile | 0.5 (2 tiles/tick, run energy infinite); 0.57 with `bot.walkTo` | measured, `primitives.md` §2 |
| Dialogue page or option click | **2** (1 with the client fix) | measured, `primitives.md` §1 |
| Ladder, trapdoor or stairs climb | 1-2 plus the run to it | measured, `primitives.md` §3 |
| Door or gate open | 2 plus the run to it, then walk through | measured, `primitives.md` §3 |
| Loc/NPC interaction with `p_delay(n)` | n + 2 from the click; each further `p_delay(m)` m + 1 | read, `PlayerOps.ts:376-380`; consistent with every delay in `primitives.md` |
| Teleport spell | 4 | measured, `primitives.md` §4 |
| Amulet of glory / games necklace | 6 / 8 | measured, `primitives.md` §4 |
| Ship ride (talk to sailor to ashore) | 21-32 by route | measured, `primitives.md` §5 |
| Trade from an adjacent helper | 9 (5 with the client fix) | measured, `primitives.md` §6 |

So each step-list segment carries: tiles walked (or the route), dialogue pages
and option clicks, interactions, fight ticks, forced waits (`p_delay`, timers,
cutscenes, `~delay` style waits) and then the tick estimate.

## Travel

State where each segment starts. For each long walk, name the fastest travel
option and what it needs (a Magic level and runes for a spell, an item such as a
charged amulet of glory, a ship fare, a gnome glider, a quest unlock), and give
the walking figure too. Check that the option actually exists in this content
(e.g. grep the obj/loc configs). Runes and jewellery are helper-supplied.

## Fights

For each fight give the monster, its combat level and hitpoints and any special
mechanic (read from the `.npc` config and the script), the minimum stats you
think are safe, and the fight's tick estimate at the stats you assume. Say which
combat stats you assumed: the plan is likely to reach high melee from earlier
quests, so give a figure at about 70/70/70 melee with helper-supplied gear and
food as well as at the minimum.

## Requirements

List each quest, skill and item requirement **as enforced by this server's
scripts**, with the line. Note whether the check uses `stat()` (boosted level,
so a potion or other boost may satisfy it) or `stat_base()` (real level), and
which checks the wiki lists but this server does not enforce.

## Document shape

```
# <Quest name>

Reward (base xp, quest points, unlocks), with lines.
Requirements (quests, skills with stat()/stat_base(), items), with lines.
Helper-supplied items: a list a helper can pack into one trade.
Step list: numbered; each step names the NPC/loc/obj, the coordinates, the
  dialogue options to pick, the varp value it sets, and its raw counts and ticks.
Tick total: travel / dialogue / interactions / fights / waits / total, each labelled.
Risks and gotchas (deaths, random failures, aggressive monsters, level-up dialogs,
  logout-unsafe steps).
Open questions.
```

The quest varp and its stage values come from the quest's `.varp` and
`.constant` configs; `::setvar <varp> <value>` jumps a lab account to a stage,
which is how a long quest can be measured segment by segment.

## Local lab

Setup is documented in `docs/speedrun/LAB.md` (from the sibling skill-route
issue cairn://p/rs/2; if it has not merged into your branch yet, read it with
`read file:docs/speedrun/LAB.md?branch=cairn://p/rs/2/1/coordinator`). In short:

```sh
bun install; (cd server/engine && bun install); (cd server/webclient && bun install)
cd server/engine && WEB_PORT=<W> WEB_MANAGEMENT_PORT=<W+1> HISCORES_WEB_PORT=<W+2> NODE_PORT=<N> \
  BUILD_VERIFY=false NODE_TICKRATE=100 LOCAL_STAFF_LEVEL=4 bun run start
cd server/webclient && bun run watch
cd server/gateway && AGENT_PORT=<A> WEB_MANAGEMENT_PORT=<W+1> bun run gateway
bun bots/create-bot.ts <name> --local   # then set SERVER=localhost:<W>, GATEWAY_URL=ws://localhost:<A> in bots/<name>/bot.env
cd server/webclient && bun src/lite/runner.ts <name>
```

Run the long-lived processes in terminals, and pin every batch of one lab to one
executor. Never use the browser client or MCP `execute_code` for timing.
`LOCAL_STAFF_LEVEL` is already on this branch.

Port blocks for the quest-route children (the skill-route issue owns 8910-8962,
the defaults belong to cairn://p/rs/1):

| Child | WEB_PORT | WEB_MANAGEMENT_PORT | HISCORES_WEB_PORT | NODE_PORT | AGENT_PORT |
|---|---|---|---|---|---|
| gnome chain (Tree Gnome Village, Grand Tree, Monkey Madness) | 9010 | 9011 | 9012 | 43710 | 7910 |
| Dragon Slayer and the 32 quest points | 9020 | 9021 | 9022 | 43720 | 7920 |
| Merlin's Crystal and Holy Grail | 9030 | 9031 | 9032 | 43730 | 7930 |
| Priest in Peril and Haunted Mine | 9040 | 9041 | 9042 | 43740 | 7940 |
| Waterfall, Fight Arena, Knight's Sword | 9050 | 9051 | 9052 | 43750 | 7950 |
| Regicide chain | 9060 | 9061 | 9062 | 43760 | 7960 |
| Digsite and Tourist Trap | 9070 | 9071 | 9072 | 43770 | 7970 |
| Watchtower and Temple of Ikov | 9080 | 9081 | 9082 | 43780 | 7980 |
| Troll chain (Death Plateau, Troll Stronghold, Troll Romance) | 9090 | 9091 | 9092 | 43790 | 7990 |
| Legends' Quest | 9100 | 9101 | 9102 | 43800 | 8000 |
| Mage Arena and Dwarf Cannon | 9110 | 9111 | 9112 | 43810 | 8010 |
| Timing primitives | 9120 | 9121 | 9122 | 43820 | 8020 |

## Shared prerequisite quests

Some prerequisite quests appear in more than one chain (Waterfall is in Legends;
Underground Pass is in Regicide and Legends; Merlin's Crystal is in Holy Grail
and possibly Heroes'). The child named in the table above for a quest owns its
document; other children link to it and use its tick total rather than writing a
second one.
