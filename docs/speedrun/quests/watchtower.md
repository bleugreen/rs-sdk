# Watchtower (feasibility: not worth it for its xp; a possible quest-point source)

**Verdict: skip it for xp.** The reward is 15,300 base Magic, which is worth
about **510 ticks** of training at best (inferred, below). The quest costs about
**1,100 ticks** on the stock client (inferred, range 900-1,500), plus about 210 to
get there from an Ardougne teleport. A lower bound that counts only the legs
that can't be avoided, at the fixed-client floor, is about **650**. So it loses
under every client assumption.

**Keep it in view as a quest-point source.** It gives 4 quest points, so its net
cost is about (1,100 − 510) / 4 ≈ **150 ticks per quest point** (range about
100-250). That is far cheaper than The Knight's Sword (about 675 per point,
`knights_sword.md`). If the plan needs quest points (Dragon Slayer's 32), this
quest becomes close, and its route should then be measured in full. The lab
harness and a route script are already committed (see Scripts).

The totals are estimates. They are built from step counts read in the
scripts, the measured primitives in `primitives.md`, and route lengths from the
SDK's route finder (`quest-wtikov-routes.ts`). One lab run of the route failed at
the geography (see What the lab showed), and I stopped measuring at the
coordinator's request once the value check came out negative.

## Reward

- 15,300 base Magic: `stat_advance(magic, 153000)` (read,
  `quest_itwatchtower.rs2:533`; tenths, multiplied 25x like every quest reward,
  see `knights_sword.md`).
- 4 quest points (read, `general/configs/quest.constant:107`).
- 5,000 coins and the Watchtower Teleport scroll (read,
  `quest_itwatchtower.rs2:534-535`). Reading the scroll sets the final stage 14
  (`quest_itwatchtower.rs2:554-559`). The spell needs Magic 58 and lands on the
  top floor of the Watchtower (`primitives.md` §4). No other quest in the plan
  needs Yanille, so the teleport is worth roughly nothing (inferred).

### What the Magic is worth

The skill model (inferred there, cairn://p/rs/main/task/per-skill) trains Magic by
enchanting jewellery to 80 (about 505 ticks), then Charge at about 900 base xp per
tick (about 35 ticks for 80→99): about 540 ticks in all.

On this server's table, level 99 is 39,938 base (`CONVENTIONS.md`, from
`Player.ts:77-85`). Scaling the standard table to that, level 80 is about 6,100 base,
and 15,300 base is about level 89 (inferred).

- **Done before any Magic training**, the quest skips all of the enchanting, and
  Charge needs (39,938 − 15,300) / 900 ≈ 27 ticks. The quest then replaces about
  540 − 27 ≈ **510 ticks**. Getting Magic 14 for the potion first costs a few casts
  (inferred, negligible).
- **Done after enchanting to 80**, it replaces only 15,300 / 900 ≈ **17 ticks** of
  Charge.

So it only has value early in the run, and 510 is the ceiling. One catch: the
Ardougne teleport assumed for travel needs Magic 51 and Plague City
(`primitives.md` §4). An account with no Magic training has to come in by ship
or on foot, which adds travel (see Tick estimate).

## Requirements (as this server enforces them)

| Check | Where | Level type | Needed on the shortcut route? |
|---|---|---|---|
| Agility 25 to jump the chasm | `quest_itwatchtower.rs2:393` | `stat()` (boostable) | yes (to reach the city guards) |
| Agility 18 for the Watchtower wall | `quest_itwatchtower.rs2:2` | `stat()` | no (the ladder works from stage 1) |
| Mining 40 and a usable pickaxe for the rock of Dalgroth | `quest_itwatchtower.rs2:483-491` | `stat()` | yes |
| Herblore 14 to mix the ogre potion | `ogre_potion.rs2:27,45,57,72` | `stat()` | yes |
| Magic 14 to use the magic ogre potion | `ogre_shaman.rs2:23` | `stat()` | yes |
| 20 coins for the chasm jump | `quest_itwatchtower.rs2:405` | | yes |
| A lit light source and the skavid map in the caves | `quest_itwatchtower.rs2:100-112` | | yes |
| Thieving 15 | journal only (`itwatchtower_journal.rs2`) | | not enforced by any script I found (read: no `stat(thieving)` in `quest_itwatchtower/`) |

No quest requirement. Every quest item is untradeable
(`quest_itwatchtower.obj`, all `tradeable=no`, including the crystals,
nightshade, rock cake, both potions and the skavid map), so the scored account
has to collect all of them itself.

## Helper-supplied items (one trade, 9 ticks)

Death rune, lit torch (`torch_lit`, category `light_source_lit`), rope (for the
swing to Grew), unfinished guam potion (`guamvial`), jangerberries, ground bat
bones, a pickaxe (rune), 20 coins, a weapon and food for Gorad. The gold bar is
only needed if the east gate turns out to lead to the city guards (it doesn't on
the collision map; see below).

## How the quest works here, and the shortcut the scripts allow

The quest varp is `%itwatchtower` (perm). Stages (`quest_itwatchtower.constant`):
0 not started, 1 started, 2 fingernails given, 3 relic made, 4 relic given, 5
riddle given, 6 riddle solved, 7 skavid crystal, 8 nightshade used, 9 potion
learned, 10 potion made, 11 all crystals, 13 complete (`quest.constant:40`), 14
scroll read. `%itwatchtower_bits` (perm) holds the relic parts, Grew's state, the
skavid words and the shaman kill count.

The usual walkthrough is: search bushes for fingernails, then get the relic from
three ogre chiefs (Og wants Toban's gold, Toban wants dragon bones, Grew wants
Gorad's tooth). The relic gets you through the west gate. Then you buy a rock cake
in the market for the battlement guard, jump the chasm, and solve the city
guard's riddle with a death rune. After that come the skavid caves, the enclave,
the potion, the shamans and the rock. **Several stage checks are looser than that
order, which allows a shorter route (read):**

- **The city guard accepts the death rune at any stage up to 5** and jumps the
  quest to 6 (`city_guard.rs2:47-56`). The riddle dialogue and the whole relic
  chain are not needed for the map.
- **Gorad drops his tooth whenever `%itwatchtower` < 4**, including 0
  (`gorad.rs2:27-34`).
- **Grew deals at any stage of 2 or more** (`grew.rs2:48`), and stage 6 counts.
  He hands over crystal 1.
- **The mad skavid sets stage 7 at any stage** once the four words are learned
  (`skavid.rs2:165-210`). Its prompt is random but always has a right answer:
  `random(3)` never picks the fourth prompt (`skavid.rs2:166`).
- **The wizard enchants an ogre potion at any stage below 13** and sets stage 10
  (`watchtower_wizard.rs2:294-302`). But mixing the potion needs stage 9 or more
  (`brew_potion.rs2:14-20`), and only the wizard's talk at stage 8 gives 9
  (`watchtower_wizard.rs2:54-60`). So the stage 8 → 9 visit stays.

So the quest never needs starting at the wizard, and the fingernails, Og, Toban,
the relic and the riddle are skipped. What decides whether the shortcut works is
**reaching the city guards without the relic**. The guards stand in a pen whose
only walkable link is the landing of the paid chasm jump (`quest-wtikov-routes.ts`:
pen ↔ jump landing 14 tiles; the inside of the east gold-bar gate does not reach
it). The jump starts in the city's south part, by ogre guard 4
(`quest_itwatchtower.rs2:392-420`). The collision snapshot links that south part
to the tile where Toban's ladder drops you at (2500,2988), but only one way. If the
link is real, the shortcut works. If it isn't, the south part is reached the
intended way, over the battlement with a rock cake, and that needs the west gate,
which opens only at stage 4 (`quest_itwatchtower.rs2:277`). That brings the relic
chain back. **Not verified** (see Open questions).

## Step list (shortcut route; estimates)

Pages are counted from the scripts (each `~chatnpc`, `~chatplayer`, `~mesbox`,
`~objbox` is one page; long text may split into two). Tiles are SDK route-finder
lengths (`quest-wtikov-routes.ts`) or marked as estimates. Ticks use
`primitives.md`: 0.5 per tile, 2 per page or option, climbs 2, `p_delay(n)` n + 2.

| # | Where | Action | Varp | Raw counts | Ticks | Label |
|---|---|---|---|---|---|---|
| 0 | anywhere | Trade with a helper (list above) | | 1 trade | 9 | measured, `primitives.md` §6 |
| 1 | Ardougne → Toban's tunnel (2499,2989) | Ardougne teleport, run | | 1 teleport, 409 tiles | 209 | inferred (route finder) |
| 2 | tunnel → Toban's plateau | Enter (`tobancave`, lands (2576,3029)) | | 1 interaction, 1 page | 4 | read `quest_itwatchtower.rs2:233-236` |
| 3 | Gorad (2577,3022) | Kill him (level 68, 80 hp, Defence 54, `area_yanille/configs/ogre.npc`); tooth arrives in an objbox | 0 | 7 tiles, fight, 1 page | 30-50 | inferred; the one lab attempt got no tooth (Open questions) |
| 4 | plateau → (2500,2988) | Toban's ladder down | | 9 tiles, 1 climb | 7 | read `quest_itwatchtower.rs2:238-240` |
| 5 | south city → chasm | Jump, paying ogre guard 4 | | ~40 tiles (estimate), 6 pages, 1 option | 35 | read `quest_itwatchtower.rs2:392-420` |
| 6 | city guard (2541,3031) | Use the death rune: skavid map | 0 → 6 | 14 tiles, 2 pages | 11 | read `city_guard.rs2:47-56` |
| 7 | back over the chasm, out of the city | Jump back (1 page); leave past the battlement guard, who pushes you out (about 6 pages) | | ~45 tiles (estimate), 7 pages | 37 | read `quest_itwatchtower.rs2:422-425`, `ogre_guard.rs2:113-144` |
| 8 | → cave 5 (2553,3033) | Scared skavid: "Okay, okay, I'm not going to hurt you." | bits: learning | ~100 tiles (estimate), 16 pages, 1 option, 2 cave climbs, 8 tiles below | 92 | read `skavid.rs2:106-143` |
| 9 | caves 4, 3, 2 | Skavids: "Cur.", "Ar.", "Ig."; pick up nightshade in cave 2 | bits: words | 69 tiles + 13 below, 9 pages, 3 options, 6 climbs, 1 pickup | 80 | read `skavid.rs2:1-104` |
| 10 | → Grew (2513,3083) | Rope swing over, talk ("Don't eat me; I can help you."), talk again with the tooth: crystal 1; swing back | bits: Grew 2 | ~65 tiles (estimate), 13 pages, 1 option, 2 swings | 75 | read `grew.rs2:33-67`, `quest_itwatchtower.rs2:289-309` |
| 11 | south city: caves 1 and 6 | Skavid "Nod."; mad skavid (answer by prompt): crystal 2; second nightshade | 6 → 7 | ~290 tiles (estimate) + 12 below, 7 pages, 2 options, 4 climbs, 1 pickup | 175 | read `skavid.rs2:41-52,145-210` |
| 12 | → west gate → enclave guard (2507,3036) | Gate opens at stage ≥ 4; nightshade on the guard, `p_delay(2)`, into the shaman cave; cross to the exit (2598,9468), out at (2540,3054) | 7 → 8 | ~180 tiles (estimate) + ~60 below, 1 page, 1 door, 1 climb | 135 | read `enclave_guard.rs2:24-42`, `quest_itwatchtower.rs2:462-463` |
| 13 | → Watchtower, top floor | Tower guard's ladder (1 page), ladder; wizard talk (about 7 pages); mix 2 items; potion to the wizard, `p_delay(3)`, 3 pages | 8 → 9 → 10 | 68 tiles, 2 climbs, 11 pages, 3 item uses | 70 | read `watchtower_wizard.rs2:46-60,403-412`, `quest_itwatchtower.rs2:87-94` |
| 14 | → enclave again | Down, west gate, nightshade (1 page); six shamans: potion on each, `p_delay(1)`, 5 pages; crystal 3; mine the rock, `p_delay(3)`: crystal 4; exit | bits: kills 6 | 125 + 39 + 163 below, 6 pages, 2 climbs down, 8 uses | 200 | read `ogre_shaman.rs2:15-55`, `quest_itwatchtower.rs2:470-498`; tiles from the route finder |
| 15 | → Watchtower, top floor | Wizard (5 pages): stage 11; lever, `p_delay(0)` + `p_delay(3)`, 4 pages; read the scroll (2 pages) | 10 → 11 → 13 → 14 | 68 tiles, 2 climbs, 11 pages, 2 interactions | 70 | read `watchtower_wizard.rs2:20-45,397-401`, `quest_itwatchtower.rs2:513-559` |

## Tick estimate

| Part | Ticks | Basis |
|---|---|---|
| Travel in (Ardougne teleport, 409 tiles) | ~210 | inferred, route finder |
| Walking inside the quest (about 1,450 route tiles) | ~730 | inferred: route finder plus estimated legs, 0.5 per tile |
| Dialogue (about 90 pages and 10 options) | ~200 (100 with the client fix) | read page counts × measured 2 |
| Climbs, caves, item uses, `p_delay` waits | ~110 | read, `primitives.md` |
| Gorad fight | ~30-50 | inferred (80 hp at 70/70/70) |
| Trade | 9 | measured, `primitives.md` §6 |
| **Total, quest only** | **~1,100** (range 900-1,500) | inferred |
| **Total with travel in** | **~1,300** | inferred |

**Lower bound (floor client, shortcut route, only the legs that can't be
avoided):** the second enclave trip alone is Watchtower → west gate → enclave →
shaman cave → exit → Watchtower, about 395 tiles (route finder). The first
enclave visit and the wizard visit add about 130 more. The six caves, Grew and
Gorad add at least about 400. That is about 930 tiles (465 ticks), plus at least
about 100 dialogue clicks at 1 tick and about 80 ticks of climbs and waits:
**about 650 ticks**, still above the 510 the reward is worth.

**If the shortcut doesn't work** and the relic chain is needed, add the
fingernail search (the bush is 180 route tiles from the tower ladder), the
wizard's fingernail and relic dialogues (about 25 pages), Og (2506,3116), Toban's
chest and the dragon bones (Toban's plateau, which is visited for Gorad anyway),
the west gate's two visits, and the market rock cake. That is about another
400-600 ticks (inferred).

## What the lab showed

One full run of `quest-watchtower-route.ts` (bot `wtr2`, `NODE_TICKRATE=300`)
failed in ways that fixed the geography, not the timings:

- **Gorad and Toban stand on a closed plateau.** The setup teleport put the bot
  there, and every later walk failed ("stops short ... separate room"). The
  route finder agrees: the plateau links only to itself. The way in is Toban's
  tunnel, and the way out is his ladder (`quest_itwatchtower.rs2:233-240`).
- **No tooth after 303 ticks** next to Gorad. The script didn't log whether the
  attack landed, so this is undiagnosed (Open questions).
- **The bot died once** walking near (2528,2987), south of the city, and
  respawned in Lumbridge. The cause wasn't logged.
- The run never reached a quest stage, so it gave no step timings.

## Risks and gotchas

- **Toban's plateau traps a careless route.** Enter only through the tunnel and
  leave by the ladder.
- **The gate guards push you out**: the east guard to the hill (2546,3065), the
  battlement guard to (2523,2998) (`ogre_guard.rs2:20,123,144`).
- **Talking to a shaman hits for 20** and attacking one inside the cave for 30
  (`ogre_shaman.rs2:1-13`). Only use the potion on them.
- **Mixing in the wrong order explodes the vial** for 5 damage and wastes it
  (`ogre_potion.rs2:92-101`). The right order is jangerberries onto the
  unfinished guam potion, then ground bat bones. Guam leaf onto the jangerberry
  vial explodes.
- **The dark caves.** Entering without a lit light source drops you in a dark
  cave with a search-for-a-rope exit (`quest_itwatchtower.rs2:177-195`).
- **Two nightshades are needed** (one per enclave visit). Nightshade is
  untradeable; there are spawns in caves 2 and 6 (map data). Respawn time not
  checked.
- **Logout-safe.** `%itwatchtower`, `%itwatchtower_bits` and `%gutanoth_gold` are
  all `scope=perm` (`quest_itwatchtower.varp`); no step uses a temporary varp
  (`primitives.md` §8).
- **Level-ups.** The final 15,300 Magic arrives after the last step, so it
  interrupts nothing.

## Open questions

- **Does the shortcut route work? (unverified; the first thing to measure if
  Watchtower's quest points are wanted.)** It decides between about 1,100 ticks
  and the relic route's about 1,500-1,700. Each gate it relies on, read:

  | Gate | What the script checks | Where |
  |---|---|---|
  | Gorad's tooth | given on his death only while `%itwatchtower` < 4 (stage 0 qualifies), with a free slot and no tooth already | `gorad.rs2:27`, `:31` |
  | City guard's map | death rune accepted while `%itwatchtower` ≤ 5; sets stage 6 and gives the map | `city_guard.rs2:49-52` |
  | Grew's crystal | first talk needs `%itwatchtower` ≥ 2 (stage 6 qualifies); second talk takes the tooth | `grew.rs2:48,58`, `:33-44` |
  | Mad skavid's crystal | needs the five skavid bits only; sets stage 7 at any stage | `skavid.rs2:165`, `:210` |
  | Enclave guard | nightshade refused below stage 7; sets 8 only from 7 | `enclave_guard.rs2:26-31` |
  | Potion | mixing needs stage ≥ 9; only the wizard's talk at stage 8 gives 9; the wizard enchants an ogre potion at any stage below 13 and sets 10 | `brew_potion.rs2:16`, `watchtower_wizard.rs2:54-60`, `:294-302` |
  | West gate | the guard intercepts while `%itwatchtower` < 4; at stage 6 it just opens | `quest_itwatchtower.rs2:276-284` |
  | East (gold-bar) gate | first talk pushes you to the hill; the second, with a gold bar, lets you in. Its inside does not reach the city guards on the collision map | `ogre_guard.rs2:3-29`, `quest-wtikov-routes.ts` |
  | Chasm jump into the guards' pen | Agility 25 (`stat()`), 20 coins, ogre guard 4 within 8 tiles | `quest_itwatchtower.rs2:392-420` |
  | Battlement (the intended way into the south city) | climbable only after the rock cake (market bits = 2); otherwise guard 3 talks and can push you out to (2523,2998) | `quest_itwatchtower.rs2:319-333`, `ogre_guard.rs2:88-144` |
  | **Toban's ladder into the south city** | the ladder drops you at (2500,2988). The SDK collision snapshot routes from there into the south city (3 tiles to (2499,2990)) **but not back**, so it may be a one-way gap or a snapshot artefact | `quest_itwatchtower.rs2:238-240`, `quest-wtikov-routes.ts` |

  The last row is the one that matters. If the gap is real, the shortcut works.
  If not, entering the south city needs the battlement, and that needs the west
  gate (stage 4, the relic). The fastest check is a lab bot standing on
  (2500,2988) walking to ogre guard 4 (2527,3020).
- **Why no tooth in the lab?** Log `bot.attack`'s result and Gorad's hit points.
  `ai_queue3` gives the tooth through `npc_findhero` and a player queue
  (`gorad.rs2:22-34`), which may fail like Mordred's hook did for the Holy Grail
  child.
- **What killed the bot near (2528,2987)?** Check for aggressive monsters south
  of Gu'Tanoth before routing a low-level account there.
- **Whether the 4 quest points are needed.** If so, measure the route; the
  harness and script are ready.

## Scripts

- `docs/speedrun/scripts/quest-wtikov-routes.ts`: route-finder lengths for every
  leg above (no server needed).
- `docs/speedrun/scripts/quest-watchtower-route.ts`: the shortcut route as a lab
  script, phase by phase, with `FROM=<phase>` to start mid-quest via `::setvar`.
  Its start teleport and walks need the geography fixes above before it gives
  timings.
- `docs/speedrun/scripts/quest-wtikov-lab.sh` and `quest-wtikov-lib.ts`: the lab
  harness (engine with `BUILD_LIVE_RELOAD=false`, which avoids an EMFILE crash from
  the dev file watcher, and the production tick rate) and the shared helpers.
