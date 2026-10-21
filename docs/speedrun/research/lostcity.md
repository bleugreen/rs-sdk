# The 2004scape / LostCity project's record: known bugs and exploit fixes, mapped onto our revision

Coordinator: cairn://p/rs/59. Node: cairn://p/rs/78. This page mines the upstream project's public
record (GitHub commits, issues and pull requests for LostCityRS/Engine-TS, LostCityRS/Content,
LostCityRS/Server, the archived 2004scape/Server monorepo and our direct upstream
MaxBittker/rs-sdk; the 2004scape.org news changelogs; the LostCity forum) and the RS2 2004-2005
era's documented glitches. For each candidate it asks whether our `server/` still has the
behaviour and what it is worth in ticks on our route. Sibling pages, not repeated here:
`competitors.md` (rs/60) and `engine-sweep.md` (rs/61, the mechanical audit of every
`stat_advance` and guard).

Labels: **m** measured, **r** read (code or source), **i** inferred. Ticks are 300 ms server ticks,
xp is base xp (game xp / 25).

## 1. Our base revision

| Tree | Upstream it equals | How it was determined |
|---|---|---|
| `server/engine` | LostCityRS/Engine-TS branch `289` at [`ca82af8`](https://github.com/LostCityRS/Engine-TS/commit/ca82af8a8f6afa80cf55356bda3bba794dfb189f) (2026-09-30), the branch tip; no later commit exists on `289` as of 2026-10-21 | `diff -r` of `src/engine` and `src/network` against `ca82af8`: every differing file is an rs-sdk patch listed in `server/PATCHES.md` (GE hooks, trade and kill ledgers, the choice-dialog resume guard, chat, logging). The upgrade commit `8601955cf` (2026-10-09) says "34 engine commits past our 274 base", and `git rev-list --count 4c0d036..ca82af8` is 34 (r). |
| `server/content` | LostCityRS/Content branch `289` at [`460d0fde`](https://github.com/LostCityRS/Content/commit/460d0fde) (2026-10-04) | `diff -rq` of `scripts/` against `460d0fde` leaves 20 files, all rs-sdk patches (GE, pvp death mark, random-events toggle, Miscellania coffers fix, duel-death fix, runite hiscore hook); against the later tip `8efdb336` it leaves 22. The upgrade commit counts 165 content commits past the 274 base, and `git rev-list --count 85d62c8bd..460d0fde` is 165 (r). |
| The demo (rs-sdk-demo.fly.dev) | MaxBittker/rs-sdk `main` at `b565f2d9` (2026-10-19) | `git ls-remote` of upstream `main` gives `b565f2d9`, which is an ancestor of our branch. Since then our branch changes `server/engine` only in `LoginThread.ts` and `Environment.ts` (the lab's `LOCAL_STAFF_LEVEL`) and `server/content` not at all (r). So "present in our revision" below also means "live on the demo". |

Two consequences frame everything below.

- **Upstream has almost nothing newer than us.** Engine `289` has zero commits after our base and
  content `289` has one, [`8efdb336`](https://github.com/LostCityRS/Content/commit/8efdb336)
  (Troll Romance sled animation, irrelevant). The 274 and 377 branches carry parallel copies of
  the same fixes. The category "fixed upstream after our base, so still live here" is therefore
  empty for engine and content; what remains live is (a) open upstream issues and PRs, (b) era bugs
  that LostCity reproduces on purpose, and (c) rs-sdk's own divergences.
- **Revision 289 is the January 17, 2005 client, not May 2004.** `server/content/README.md:2`
  reads "Lost City - January 17, 2005" (r). The mission brief's "about May 2004 content" dates from
  the 245-254 era. Era sources must be read up to January 2005: anything Jagex patched before then
  is fixed here, and content released after it (Slayer at revision 290, Mage Training Arena, player
  houses) is absent.

## 2. Summary

- **No live upstream-documented bug saves ticks on our route.** Every exploit and timing fix in
  the upstream record that could touch an account racing to 99 is either already in our base,
  patched by rs-sdk, or needs content our revision does not have. The rows with value are risk
  findings: behaviours the route relies on and what upstream has done or signalled about them.
- **The knife-on-logs starter (about 3,100 ticks at risk, i) is safe on every upstream branch.**
  It rests on `closeModal` clearing the weak queue. Upstream changed weak-queue clearing twice in
  the last year (Engine-TS #49 on 377, #125 in our 289 base) and neither touched the drop and
  re-click path the trick uses. Old School still has the same mechanic, so a "fix" would be
  inauthentic.
- **Charge with no cooldown (about 1,130 ticks at risk, i) is a deliberate upstream choice.**
  2004scape/Server #969 removed the cooldown on video evidence, and the commented-out check is
  identical on the 377 branch. The comment dates the cooldown to "sometime in 2005", so it could
  return only if rs-sdk moves to a revision after it.
- **Wine (about 200-500 ticks at risk, i) is the one relied-on behaviour upstream has marked
  unfinished.** `wine.rs2:6` carries `//todo: Finish wines, jug of bad wine, proper queue
  clearing`, unchanged on 377.
- **The five-user-event cap has never moved on any upstream branch** (5 / 20 / 2 on 289, 377-wip,
  377-node and 530-wip).
- **One base-revision behaviour to know:** Engine-TS #125 (in our base) clears the weak queue when a
  dialogue resumes, so dismissing a level-up ends any Make-X batch running on the weak queue
  (fletching, crafting, smelting). The route's smithing uses the make-5 anvil chain and is not
  affected; the small Fletching and Crafting lines are.
- **Economy items, recorded observationally for tenet 6:** the 289 coin dupe reported upstream
  yesterday (LostCityRS/Server #21) is the Managing Miscellania coffers bug that rs-sdk already
  patched (`ca0fe09cc`, `fb2649716`); rs-sdk #56 (open) reports a shared Lost City shop selling ruby
  rings below their high-alchemy value.

## 3. Ranked table

Sorted by the size of the tick figure, savings and risks together. "At risk" means the ticks the
route would lose if upstream changed the behaviour; it is not a saving.

| # | Technique or bug | Source | Present in revision (our file:line; upstream fix link if any) | Route line affected | Ticks saved or at risk (label) | Cost | Test status |
|---|---|---|---|---|---|---|---|
| 1 | Knife-on-logs `%action_delay` starter (risk) | Engine-TS [#49](https://github.com/LostCityRS/Engine-TS/pull/49) (377 only), [#125](https://github.com/LostCityRS/Engine-TS/pull/125) (in base); Content [#453](https://github.com/LostCityRS/Content/pull/453) fletch-X | Yes: `cut_logs.rs2:80-86` writes `map_clock + 2`; the drop or re-click's `clearPendingAction` -> `closeModal()` clears the weak queue (`Player.ts:817-820`, `1027-1030`). #49 only stops the clear when a dialogue *finishes* (`Player.ts:2292`, `closeModal(false)`); #125 clears before a resumed script runs (`Player.ts:2266-2270`), which happens before `process_fletch_logs` queues the fletch. No branch changes the op path. | Woodcutting, Fishing, Mining (rs/2) | **~3,100 at risk (i)**: woodcutting 3,960 -> 3,030 = 930 (r, external.md); fly 78-99 3,410 -> 1,978 = 1,432 (m, tick-manipulation.md); mining 3.61 -> 3.00 ticks/ore on ~3,765 = ~765 (i). Probability low (r: unchanged on every branch; authentic in OSRS). | none | Behaviour tested by rs/2 and rs/53 (m); upstream risk needs no lab |
| 2 | Charge with no recast cooldown (risk) | 2004scape/Server [#948](https://github.com/2004scape/Server/pull/948), [#969](https://github.com/2004scape/Server/pull/969) ("this video shows charge had no cooldown") | Yes: `charge.rs2:8-12`, check commented with "this was added sometime in 2005"; byte-identical on Content `377-wip` (r) | Magic 76/80 -> 99 (rs/28 magic.md) | **~1,130 at risk (i)**: Charge from the sip is 41 ticks (m); without it, 80 -> 99 is ~29,300 base at dragonstone enchanting's 26 base/tick = ~1,130 plus banks (i). Probability low: needs an rs-sdk upgrade past the 2005 change, and upstream's 2006 branch still omits it. | none | Behaviour measured (rs/20); no lab |
| 3 | Five user events decoded per tick (risk) | Engine-TS `ClientGameProtCategory.ts` history; [`1d95f01`](https://github.com/LostCityRS/Engine-TS/commit/1d95f01) removed priority buffering (2025-12) | Yes: `ClientGameProtCategory.ts:5-8` (20 / 5 / 2), `NetworkPlayer.ts:69, 141-145`. Identical on 289, 377-wip, 377-node, 530-wip (r). The class comment still says "todo: measure how many events we should expect". | Dialogue bursts, batched banking and trades, interleaving (rs/3, rs/28) | **~1,000 or more at risk (i, rough)** if the cap fell to 1: it multiplies every batched burst on the quest and overhead lines (~11,750 and ~2,500-3,500, r external.md). Probability very low: no branch has touched the values. | none | No lab |
| 4 | Wine bank fermentation (risk) | Upstream TODO in the script itself; LostCityRS/Server [#16](https://github.com/LostCityRS/Server/issues/16) (wine shop restock, settled as authentic) | Yes: `wine.rs2:6` `//todo: Finish wines, jug of bad wine, proper queue clearing`; the timer rolls `stat_random` once per bank batch (`wine.rs2:22-70`). Same file on 377-wip apart from a semicolon (r). | Cooking (rs/37, rs/47): ~11 ticks of scored time (r, main thread 2026-10-20) | **~200-500 at risk (i)**: the no-wine fallback (rs/37's ugthanki kebab, 120 base each) needs ~333 makes; at 1-4 per tick plus ~12 bank trips of ~12 ticks that is ~230-480 ticks (i). Probability: unknown; this is the only relied-on script upstream has flagged as unfinished. | none | Behaviour measured (rs/37, rs/47); no lab |
| 5 | Optional level-up interface (rs-sdk [#79](https://github.com/MaxBittker/rs-sdk/pull/79), open PR) | MaxBittker/rs-sdk | Not in our revision; default would leave the demo unchanged. Only a `fly.toml` edit (`NODE_LEVELUP_INTERFACE=false`) by the maintainer would switch it on. | Every level-up on the route | **~200-500 saved (i) only if the maintainer enables it**: ~450 gathering level-ups at ~0.5 tick each (m, tick-manipulation.md section 6) plus Make-X restarts and the tick a dialog pops during interleaving. Not something we can do; a watch item. | none | Not applicable (maintainer-side) |
| 6 | Weak queue cleared when a dialogue resumes, so a dismissed level-up ends a Make-X batch | Engine-TS [#125](https://github.com/LostCityRS/Engine-TS/pull/125) (in our base, merged 2026-09-30) | Yes: `Player.ts:2266-2270`; weak scripts run only when not busy (`Player.ts:878-887`), so leaving the dialog open stalls the batch too. Weak-queue Make-X skills: `cut_logs.rs2`, `smelting.rs2`, `leather/pottery/glass/jewellery/spinning/snelm.rs2`, `alchemy.rs2` (r). Authentic (OSRS level-ups stop Make-X). | Fletching and Crafting (rs/37, ~250 for four skills); smithing's anvil make-5 is not on the weak queue and was measured unaffected (rs/28 smithing.md:114-116) | **0 saved; a cost of ~2-3 ticks per level-up that lands mid-batch (i)**, bounded by the ~250-tick line and already inside rs/37's measurements on this tree (r) | none | Read; no lab |
| 7 | Cheap ruby rings: Irksol (Lost City) sells below alch value and below Grum's buy price | rs-sdk [#56](https://github.com/MaxBittker/rs-sdk/issues/56) (open) | Yes: `area_lostcity/configs/lostcity.npc` `cheapringshop` `shop_sell_multiplier=500` (r, per the issue) | Magic enchanting, ruby band 49 -> 57 (16 casts, rs/28) | **0 scored ticks (r)**: rings are helper-supplied either way; buying saves helper crafting only. The shop is shared (stock 5), so buying it out is an economy action. **Flag for the coordinator (tenet 6).** | ~1,012 gp per ring | Not tested (economy; observational only) |
| 8 | 289 coin dupe (Managing Miscellania coffers) | LostCityRS/Server [#21](https://github.com/LostCityRS/Server/issues/21) (open, 2026-10-20) | **Patched here**: rs-sdk `ca0fe09cc` and `fb2649716`, `managing_miscellania.rs2`; regression test `server/engine/test/miscellania-coffers.test.ts`. Upstream LostCity has not shipped its own fix yet. | none | 0 (r). **Flag (tenet 6): touches the shared economy; observational only.** | n/a | Not tested, by rule |
| 9 | Combat refactor would change the cannon's damage cap (risk) | Content [#772](https://github.com/LostCityRS/Content/pull/772) (open) | Not in our revision. The diff keeps `~player_npc_hit_roll(%damagetype)` for the cannon (the wielded-melee-style roll the route uses) and only swaps `~npc_max_dealt(30, 0)` for `npc_param(max_dealt)`, which differs for the Horror from the Deep dagannoths (`npc_combat.rs2:401-420`, `cannon_fire.rs2:116-117`). | Ranged with the cannon (rs/28 ranged.md) | **~0 at risk (r)** for our cannon targets | none | No lab |
| 10 | Tick eating (OSRS-style) not implemented | Content [#626](https://github.com/LostCityRS/Content/pull/626) (open) | Not in our revision: food eaten on the tick a hit lands does not save the player | Quest boss fights (rs/3) | 0 (survival only; no xp or tick effect) | none | No lab |

No row is worth over ~100 ticks as an untested saving, so there are no lab briefs. Rows 1-4 are
risks on behaviours that are already measured; their mitigation is watching, not a lab.

## 4. Risk findings for the upstream watch

The nightly watch (`UPSTREAM-WATCH.md`) diffs MaxBittker/rs-sdk only, so it reports a LostCity
change when rs-sdk vendors it, which has happened every two to five months (245.2 -> 254 in March,
254 -> 274 in May, 274 -> 289 in October 2026). Specific places to watch:

- **Knife starter (row 1). Added to the watch on this branch.** `cut_logs.rs2` used to fall under
  the general "Fletching" entry, whose reason was fletching xp. It now has its own entry,
  `knife-starter`, above Magic and Fletching in `speedrun/tools/upstream-watchlist.json`, and the
  `Player.ts` entry's reason now names the weak-queue clears in `closeModal`,
  `clearPendingAction` and `executeScript` that the starter and Make-X batches depend on. The
  table in `UPSTREAM-WATCH.md` was regenerated with `--write-doc`, and the watch's tests pass
  (16 of 16).
- **Charge (row 2).** Already a dedicated entry. Upstream's own comment names the trigger: a
  revision after Jagex added the cooldown in 2005.
- **Wine (row 4).** Already a dedicated entry. Upstream's TODO says it will change when someone
  finishes it.
- **Packet cap (row 3).** Already watched. Unchanged upstream everywhere.
- **Level-up interface (row 5).** A positive change if the maintainer enables it; `fly.toml` is
  already watched.

## 5. Checked and not applicable

Each of these appears in the upstream record or the era sources and was checked against our tree.

- **Run energy while delayed (the "Old Journal infinite run energy" thread, lostcity.rs forum).**
  Present: `updateEnergy` returns early while `delayed` (`Player.ts` `updateEnergy`), yet
  `processInteraction` still moves the player (`Player.ts:1344`). Not applicable: run energy is
  infinite on this server (r and m, rs/3 `quests/primitives.md`).
- **Delay ending one tick early** (2004scape/Server [#1048](https://github.com/2004scape/Server/pull/1048),
  "previously you could smelt and cook 1t faster"). Fixed in our base.
- **Failed packets counting toward the per-tick budget** ([#1065](https://github.com/2004scape/Server/pull/1065)).
  Fixed in our base; the route already relies on failures costing a client-event slot
  (interleaving.md section 1).
- **Firemaking stall on an adjacent tile** ([#1375](https://github.com/2004scape/Server/pull/1375)).
  Fixed in our base; firemaking is measured at 4 ticks per roll (rs/28 firemaking.md).
- **Success delays on mining and stall thieving** (Content [#48](https://github.com/LostCityRS/Content/pull/48),
  `mining.rs2:156-157` `p_delay(0)`). In our base and inside rs/2's measured mining cycle.
- **Wilderness course timing** (Content #31, #653; 2004scape #1721) and the 274 agility rebalance.
  In our base; the agility route was measured on it.
- **One-way safespots** ([#1626](https://github.com/2004scape/Server/pull/1626), symmetric line of
  sight). Fixed in our base.
- **Old dupes**: pickup ([#325](https://github.com/2004scape/Server/pull/325)), cooking last item
  ([#679](https://github.com/2004scape/Server/issues/679)), spam-click obj ([#1066](https://github.com/2004scape/Server/pull/1066)),
  trading stackables ([#1205](https://github.com/2004scape/Server/pull/1205)), duel death skip
  (rs-sdk #55, patched in `death.rs2:11-16`). All fixed; economy items, observational.
- **Historical bugs LostCity reproduces on purpose**: duel-arena smuggling and three-way duels
  ([#1737](https://github.com/2004scape/Server/pull/1737)), the Shantay Pass return teleport
  ([#1739](https://github.com/2004scape/Server/pull/1739)), the random-event double spawn
  ([#1362](https://github.com/2004scape/Server/pull/1362)), the Ikov bridge west-side cancel
  (`ikov_dungeon.rs2:41`), the games-room skill and chair bugs (`boardgames.rs2:2-3`). None grants
  xp or saves a tick on our route; the item-smuggling ones also touch other players.
- **Random events and their lamps.** The demo runs with `NODE_RANDOM_EVENTS = "false"`
  (`fly.toml:25`), and rs-sdk's patch returns early from `macro_event_allowed`
  (`macro_events.rs2`). No random event, glitch or lamp is reachable.
- **Era xp glitches in Svew's Bug Abuse Notes** (se7ensins). The one xp exploit (coin deposits at
  the Mage Training Arena) needs content from after January 2005; the rest are 2005-2008 forced
  teleports and item smuggling.
- **2013 Old School fixes to 2004 bugs** (2004Scape wiki "Runescape Patch History", Patched Rev
  468+): a second alchemy cast was ignored rather than queued (no gain), anvil smithing locked the
  player (the route uses make-5), a gnome ball could interrupt other players' Make-X (touches
  others), action priority by IP address, potions pausing a walk, toy-mouse agility xp (player
  houses, not in 289). None saves a tick here.
- **Open upstream PRs off our route**: Knight's Sword blurite sword in bank (Content #752; the
  quest is OFF in rs/3's README), Ghosts Ahoy and the Ectofuntus (#758, unmerged and post-289),
  hiscore time freeze (rs-sdk #67, superseded by `55fa26cc`).
- **Upstream commits after our base**: content `8efdb336` (sled animation) and the 274-branch
  slayer fixes `f4e09ff4` (Slayer arrives at revision 290). Not applicable.
- **Jagex changes after January 17, 2005 that our revision predates.** The 2005 news posts up to
  March (runescape.wiki `2005`, "Wilderness Capes, and Changes" of 22 February, "Mountain Daughter
  and Changes" of 7 March, "Magic and Wilderness Updates" of 14 March) change mechanics in one
  place we could use: the magic shortbow special went from 35% to 55% of the bar. Our tree has the
  older 35% (`skill_combat/configs/ranged/bows.obj:313`, `sa_energy=350`), but the ranged route
  uses the cannon, and at 10% regeneration per 50 ticks a 1,000-tick phase buys about 8 extra
  arrows, under 10 ticks (i). None of the posts mentions Charge, so its cooldown date is still
  only "sometime in 2005".
- **`stat_random` clamped at level 99** (Engine-TS [#110](https://github.com/LostCityRS/Engine-TS/pull/110), in base):
  boosts above 99 add nothing to success rolls. No route line boosts above 99.

## 6. Sources

- LostCityRS/Engine-TS and LostCityRS/Content: branches `289`, `274`, `377-wip`, `377-node`,
  `530-wip` (blobless clones, 2026-10-21); commits and PRs cited inline.
- LostCityRS/Server issues [#16](https://github.com/LostCityRS/Server/issues/16) and
  [#21](https://github.com/LostCityRS/Server/issues/21).
- 2004scape/Server (archived monorepo): 1,750 issues and PRs scanned by title; PRs #948, #969,
  #1048, #1049, #1054, #1065, #1362, #1375, #1737, #1739 read in full.
- MaxBittker/rs-sdk: 85 issues and PRs scanned; #55, #56, #67, #73, #79 read.
- 2004Scape news changelogs, https://2004.lostcity.rs/news/170 to /229 (scanned for exploit, dupe
  and xp items).
- RuneScape Wiki, the `2005` update list and the posts "Wilderness Capes, and Changes",
  "Mountain Daughter and Changes" and "Magic and Wilderness Updates".
- 2004Scape GitHub wiki, "Runescape Patch History"
  (https://github.com/2004Scape/Server/wiki/Runescape-Patch-History).
- Svew's Bug Abuse Notes, se7ensins, 2011
  (https://www.se7ensins.com/forums/threads/svews-bug-abuse-notes-everything-about-glitches-and-finding-them-in-runescape.437147/).
- LostCity forum, "Whats the stance on the Old Journal 'infinite' run energy exploit?"
  (https://lostcity.rs/t/whats-the-stance-on-the-old-journal-infinite-run-energy-exploit/6748;
  the page body was behind a captcha, so only its title and first line were read).
- Route documents: rs/2 `skills/tick-manipulation.md`, rs/28 `skills/magic.md`,
  `skills/smithing.md`, `skills/firemaking.md`, `skills/interleaving.md`, rs/3
  `quests/README.md`, `quests/primitives.md`, rs/37 `scripts/cooking-wine.ts`, and the main
  thread's wine correction (cairn://p/rs/main/chat/turn/73).
