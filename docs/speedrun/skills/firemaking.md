# Firemaking: fastest route to 99

Scripts: [`firemaking-line.ts`](../scripts/firemaking-line.ts) (line cadence,
end-to-end runs, helper-dropped rows), [`firemaking-supply.ts`](../scripts/firemaking-supply.ts)
(trade and bank refills), the H6 role [`fm-row.ts`](../../../speedrun/helpers/fm-row.ts)
([helpers/fm-row.md](../helpers/fm-row.md); helpers drop a paced row), [`firemaking-pyre.ts`](../scripts/firemaking-pyre.ts)
(pyre logs), [`firemaking-rows.ts`](../scripts/firemaking-rows.ts) (static
scan for lines near banks), [`firemaking-model.ts`](../scripts/firemaking-model.ts)
(route model), [`firemaking-lab.sh`](../scripts/firemaking-lab.sh) (lab on the
firemaking port block 9250/9251/9252/43950/8150, `LAB_HELPERS` for helper
accounts). Lab: [../LAB.md](../LAB.md). Labels follow
[README.md](README.md#labels). **Every headline cadence below was measured at
`NODE_TICKRATE=300`** unless it says 100 ms.

**Host.** These batches were not pinned. The ones traced landed on **bgsrv-mac**, a second Mac
(user `dev`), not on the operator's Mac `local` that main measured at load 11-18 on 16 cores
(cairn://p/rs/main, 00:36). bgsrv-mac's load was not recorded at the time (rs/56 later saw
~2.5 there), so the busy-host caveat probably does not apply in full. Treat the end-to-end
runs as at most a few percent pessimistic. The 4-tick roll chain itself is a server rule. rs/26 closed without a single correction factor; `docs/speedrun/LAB.md` on main (its host-latency table) names bbs the reference host and reads the Mac's figures as pessimistic, so no factor is applied.

**Client.** Every number here was taken on the headless lite client against a local lab engine,
where a reaction lands on the next tick. The scored run drives the browser webclient against the
demo, where each reaction to observed state costs 1-2 more ticks through the SDK relay from home
and about 0.15 from Ashburn (rs/2; `docs/speedrun/LAB.md` on main, "Which client a number was
taken on" and the host-latency table under "Running several labs on one machine"). The reaction
cost sits in the refills: **a trade refill has about 3 reactions per 27 logs** (open on the
helper's request, accept, confirm) and a bank refill about the same; the helper-dropped row has
no refills. Totals are not re-derived for the webclient.

## 1. Recommendation

Light logs with a tinderbox, always the highest tier unlocked, from level 1
to 99 in one sitting. It takes **157 logs** (2 normal, 4 oak, 7 willow, 13
maple, 24 yew, 107 magic) and **about 650-700 ticks**. Every roll costs
exactly 4 ticks once rolls are chained, for every log tier (measured, 52 of
53 gaps at 99 and 147-150 of 151-157 gaps in two end-to-end runs). Failures
stop by level 43, which comes after the 25th log.

The player never has to walk back. Each success pushes it one tile west onto
the next fresh tile, and a return row eastward costs nothing either (section
4). So the line can be lit on almost any open ground, and only the refills
cost anything:

- **Helpers drop the logs in a row ahead of the account** (no refills):
  **~650 ticks** (measured end to end 634 and 666 with the lab's restock
  gaps removed; model 658; a 54-log dropped row measured at exactly 4.00
  ticks per fire, 75.95 base xp per tick).
- **An adjacent helper trades each inventory** (5 ticks per trade, measured
  6 of 6): **~695 ticks** (inferred: 658 + 5 refills x 6 + the first trade
  of 5).
- **Banking** at Falador east: ~735 ticks with raw clicks, ~755 with the
  stock SDK helpers (inferred from a measured 12 / 15-tick bank cycle).

The dropped row is about 45 ticks faster than trades. It needs helpers to
pace their drops around the 100-tick private window of a dropped item
(section 6). That pacing is the H6 role `speedrun/helpers/fm-row.ts`
([helpers/fm-row.md](../helpers/fm-row.md)): in two lab runs of all 157 logs
it lit 1 -> 99 in 658 ticks first to last fire, with no gap waiting on a log.
Use trades if the row can't be staffed.

**Ordering constraint, if Sea Slug is on the route: it needs Firemaking 30**
(`quest_seaslug.rs2:43`, `stat()`, boostable, but no Firemaking boost exists in this content).
Sea Slug depends on the rs/54 client fix; if it stays blocked, rs/3 replaces it with Sheep
Shearer and this constraint disappears. The
whole route is short enough to finish before Sea Slug. If it has to be
split, 1 -> 30 is **6 logs (2 normal, 4 oak) and about 50 ticks** plus one
5-tick trade, and it can be lit wherever the account stands (inferred, model
51; measured 28 and 60 ticks to level 30 inside the two end-to-end runs).
Splitting costs nothing else: 30 -> 99 then takes about 640 ticks (model 637
with trades). Reaching 43 also makes Sea Slug's dry-stick roll certain (same
`stat_random(firemaking, 64, 512)`, `quest_seaslug.rs2:48`).

No on-route quest gives Firemaking. The post-quest start level is 1, so
1 -> 99 and post-quest -> 99 are the same number.

### Summary row

rs/2's columns for the Item-fed skills section of `docs/speedrun/skills/README.md`; column 5
is "with interleaving (net)", n/a where nothing is absorbable.

| Skill | Headline method | Start level (on-route quests) | Ticks to 99, normal | Ticks to 99, with interleaving (net) | Basis | Helper supplies | Document |
|---|---|---|---|---|---|---|---|
| Firemaking | tinderbox line, highest log tier, on a helper-dropped row (or a trade per 27 logs) | 1 (no on-route quest gives Firemaking); 30 before Sea Slug if it stays on route ([quests README](../quests/README.md) section 4, step 0) | ~650 dropped row (measured 634 and 666); ~695 with trades | n/a | measured end to end (bgsrv-mac) | 157 logs (2 normal, 4 oak, 7 willow, 13 maple, 24 yew, 107 magic), tinderbox | firemaking.md |

## 2. Route by level band

Base xp per log is read from `firemaking.obj` (`productexp`, tenths). Ticks
per roll are measured: 4, chained, every tier. Success is
`stat_random(firemaking, 64, 512)` for every tier (`firemaking.rs2:61,105`).
Band ticks are the model (`firemaking-model.ts`, no refills), checked
against the two measured end-to-end runs (`firemaking-line.ts --logs=auto
--level=1 --hold=0 --until=99`, 300 ms).

| Band | Method | Location | Unlock | Base xp / log (read) | Ticks per roll | Success rate | Base xp / tick | Logs | Ticks for band (model / measured run 1, run 2) |
|---|---|---|---|---|---|---|---|---|---|
| 1-15 | Normal logs | anywhere open (section 4); lab row Falador east (3019,3362) | none | 40.0 (`firemaking.obj:104`) | 4 (measured) | 25.4% at 1 (read); 24.0% (measured, 167 rolls held at 1) | 2.4 at 1 (measured: 40 xp / 17.1 ticks) | 2 | 25 / 28, 8 (to 15) |
| 15-30 | Oak logs | same | Firemaking 15 | 60.0 (`:200`) | 4 | 59.0% at 20 (read); 62.5% (measured, 64 rolls held at 20) | ~9 at 20 (inferred) | 4 | 26 / 32, 20 |
| 30-45 | Willow logs | same | 30 | 90.0 (`:181`) | 4 | 77% at 30 -> 100% from 43 (read) | 17-22.5 | 7 | 31 / 28, 28 |
| 45-60 | Maple logs | same | 45 | 135.0 (`:162`) | 4 | 100% | 33.75 | 13 | 52 / 52, 52 |
| 60-75 | Yew logs | same | 60 | 202.5 (`:143`) | 4 | 100% | 50.6 | 24 | 96 / 100, 100 |
| 75-99 | Magic logs | same | 75 | 303.8 (`:124`) | 4 (measured 52 of 53 gaps; 53 of 53 from a dropped row) | 100% | **75.95** (measured, dropped row, 54 fires) | 107 | 428 / 450, 450 (each with 4 lab restocks) |

Totals:

| Start | Refill method | Ticks to 99 | Basis |
|---|---|---|---|
| Level 1 (also the post-quest level) | helper-dropped rows | **~650** | measured end to end 634 / 666 (lab restock gaps cut to 4); model 658 |
| Level 1 | adjacent-helper trade per 27 logs | **~695** | inferred: model 688 with 6 ticks per refill + 5 for the first trade |
| Level 1 | Falador east bank, raw clicks | ~735 | inferred: model 723 + first bank cycle 12 |
| Level 1 | Falador east bank, stock SDK | ~755 | inferred: model 738 + first bank cycle 15 |
| 1 -> 30 only (Sea Slug gate) | one trade | ~55 | inferred: model 51 + 5 |
| 30 -> 99 | trade | ~640 | inferred: model 637 |

The two measured runs differ by 32 ticks, all of it below level 30, where
the 25% and 59% rolls make the first eight logs a matter of luck. From 30 on
the runs match tick for tick.

## 3. Quest xp

| Quest | Firemaking reward (base, read) | On route? |
|---|---|---|
| Heroes' Quest | 1,575 (`quest_hero.rs2:37`) | No: rs/19 found its chain not worth doing (cairn://p/rs/3 comment 2) |
| Shades of Mort'ton | none directly. It unlocks pyre logs, the only bulk Firemaking source (section 5). | Not costed by any rs/3 child |
| Sea Slug | none; it *requires* Firemaking 30 (`quest_seaslug.rs2:43`) | Yes: the largest Fishing saving |

No on-route quest gives Firemaking xp (`docs/speedrun/quests/README.md` on
`agent/rs-3-coordinator-0`, checked at 22:00). The temple fire in Shades of
Mort'ton gives 160 base per lighting (`flamtaer_temple.rs2:233`), but the
altar stays lit for 99 ticks (`:232`), so it is worth about 1.6 base xp per
tick.

## 4. Mechanics

Scripts and engine rules (read):

- **One 4-tick clock for every tier.** Lighting from the inventory
  (`[opheldu,tinderbox]` or `[opheldu,_category_22]`, `firemaking.rs2:13-28`,
  `cut_logs.rs2:5`) drops the log on the player's tile, then runs the same
  clock as lighting a log on the ground (`[opobj4,_category_22]`). If
  `%action_delay < map_clock`, a fresh start sets it to `map_clock + 3`. When
  `%action_delay = map_clock`, it rolls `stat_random(firemaking, 64, 512)`,
  and success or failure both set `map_clock + 4`. In between it only
  re-queues `p_opobj(4)` (`firemaking.rs2:54-77, 98-117`). So a chain rolls
  every 4 ticks, a failed roll costs exactly 4 ticks and retries the same
  log, and a new light that arrives while the clock is still running is
  queued onto it rather than restarting.
- **The roll does not depend on the tier.** It is
  `floor(64(99-L)/98) + floor(512(L-1)/98) + 1 > rand(256)` (`PlayerOps.ts`
  STAT_RANDOM): 25.4% at 1, 41% at 10, 59% at 20, 77% at 30, 94.5% at 40,
  98.4% at 42, and **certain from 43**.
- **The push.** On success `~push_player` tries west, east, south, north in
  that order (`lineofwalk`), `p_teleport`s one tile and `p_delay(0)`s, and
  only then does `firemaking_success` award the xp, print "The fire catches",
  and `loc_add` a fire for 100-199 ticks (`firemaking.rs2:119-131,145-174`).
  The success message therefore arrives one tick after the roll (R+1). The
  player is delayed at R+1 (`OpHeldUHandler.ts:16`, `MoveClickHandler.ts:12`
  reject packets while delayed), and the next light must land at R+2, R+3 or
  R+4 to chain.
- **Where a fire may go.** `area_allow_loc_add` refuses a tile covered by
  any active loc (`map_locaddunsafe`, which includes a burning fire),
  a walk-blocked tile, and every bank zone (`bank_zones.dbrow`)
  (`firemaking.rs2:133-143`). Fires are `blockwalk=no`
  (`cooking_sources.loc:64`), so **fires never block a line, the push or
  walking. They only stop a second fire on their own tile.** Ashes are
  objects and block nothing.

What was measured (300 ms unless stated):

| Run | Fires | Gaps between successes | Notes |
|---|---|---|---|
| Magic at 99, inventory, 2-row snake (west along z=3362, back east along z=3361) | 54 | 52 x 4, 1 x 8 (a lab restock) | 0 rejected sends, 1.000 logs per success, 74.5 base/tick including the restock |
| Magic at 99, helper-dropped row, same snake | 54 | 53 x 4 | 75.95 base/tick; the ground op walks by itself, so no walk clicks |
| Normal logs held at level 1 | 40 | all multiples of 4 (4 to 56) | 40 of 167 rolls (24.0%; predicted 25.4%) |
| Normal logs held at level 20 | 40 | 23 x 4, 10 x 8, 4 x 12, 1 x 16 | 40 of 64 (62.5%; predicted 59.0%) |
| 1 -> 99 end to end, run 1 | 157 | 147 x 4 | 692 ticks; 666 with the 5 lab restock gaps cut to 4; 9 failures (4.6 expected) |
| 1 -> 99 end to end, run 2 | 157 | 150 x 4 | 660 ticks; 634 cut; 1 failure |
| 1 -> 30, normal logs only | 8 | 3 x 4, 3 x 8, 1 x 12 | 78 ticks including the first start |

The questions in the brief:

- **Ticks per fire including the step after lighting: 4.** The push is part
  of the success itself, so in a westward row the player is already standing
  on the next fresh tile. **The next light can be queued in the tick the
  previous one resolves.** Sending it on the success message lands it at
  R+2, and it rolls at R+4 with no "You attempt" message, so it was queued
  onto the running clock. That happened for 157 of 157 and 54 of 54
  sends with none rejected.
- **Rows in both directions are free.** Lighting while moving east, the push
  still goes west, onto the fire just lit. A 2-tile run step east (sent on the
  success message, landing at R+2) then a light at R+3 keeps the 4-tick
  chain: every eastward fire at 300 ms had a 4-tick gap, and so did the turn
  between rows. At 100 ms the bot's own round trip was about 2 ticks, and
  the same step cost 8 ticks. That is a lab artifact, which is why the
  headline runs are at 300 ms.
- **Line length before obstacles** (`firemaking-rows.ts`, collision data,
  then confirmed in the lab). Falador east: z=3362 and z=3361 are clear for
  27+ tiles west of (3019,·), 4-6 tiles north of the bank. z=3360 is blocked
  at x=3002-3003, and the first 300 ms run stalled there. The scan finds
  longer rows near other banks (all inferred, unconfirmed): Seers' Village
  (2733,3484)/(2733,3485) 54 and 53 tiles, 8-9 from the bank; Ardougne east
  (2664,3290) 54; Yanille (2610,3098) 45, 5 from the bank; Duel Arena
  (3391,3265) 67. A 2-row snake of 27 ends where it began, next to the
  bank, so **the walk back is zero**.
- **Do fires block subsequent lines?** No (`blockwalk=no`). The player
  stood on burning fires after every eastward push. **Existing fires do
  block lighting on their own tile** (read, `map_locaddunsafe`). A fire burns
  100-199 ticks (`firemaking.rs2:126`), so a snake of 54 tiles (216 ticks)
  can be reused from its start.
- **Bank cycle, 27 logs** (`firemaking-supply.ts --mode=bank`, Falador east,
  from the snake's end (3019,3361) to its start (3019,3362)): **15 ticks**
  with `bot.openBank` / `bot.withdrawItem` / `bot.closeBank` / `sendWalk` (3 of
  3). **12 ticks** with raw clicks: booth op, then withdraw-All, close and
  walk in the tick the bank opens (3 of 3). 6-7 of those ticks are the walk
  to the booth. The account starts each cycle holding only a tinderbox,
  because burnt logs leave nothing in the inventory, so no deposit is
  needed.
- **Trade, 27 logs, adjacent helper** (`--mode=trade`, helper requests
  first): **5 ticks** from the account's click to the logs in its inventory
  (6 of 6: open 1, offer accepted 2, confirm 1, items 1). That is already
  the 5-tick floor `primitives.md` §6 gives, so stock SDK calls driven every
  tick reach the floor here. In the chain a refill costs about 6 ticks: the
  trade, plus a fresh 3-tick start in place of the 4-tick chain step
  (inferred).
- **5-packets-per-tick floor.** Lighting sends one packet per 4 ticks, so it
  is clock-bound. The stock SDK and the floor are the same 4 ticks. Only the
  bank cycle differs (15 against 12).
- **Level-up dialogs** were dismissed in the same tick as the next light (64
  per run) and cost nothing measurable: the gaps across level-ups are 4.

## 5. Alternatives considered

- **Pyre logs (Shades of Mort'ton) are the only bulk, delay-free Firemaking
  action, and they are faster than lines. They are not recommended,
  because the account must first do most of the quest.** Using sacred oil on
  logs (`[opheldu,_category_111]` / `cut_logs.rs2:7-14` ->
  `create_sacred_logs`, `mortton_pyre.rs2:15-42`) has no delay and **no
  Firemaking level check**: it reads `pyre_level` and never tests it. Yew and
  magic pyre logs give 60 base for 4 doses, willow and maple 40 for 3, normal
  and oak 20 for 2 (`flamtaer_pyre.struct`). Measured
  (`firemaking-pyre.ts`, 300 ms, level 1): 14 yew pyre logs in 3 ticks (5, 5
  and 4 per tick, the packet limit), level 1 -> 43 in one inventory, no
  refusals. The full-inventory swap with an adjacent helper (14 yew logs + 14
  sacred oil(4) in, 14 pyre logs + 14 vials out) takes 5 ticks (6 of 6
  measured). That makes about 9 ticks per 840 base, so **~430 ticks to 99**
  (inferred, 666 yew logs + 666 sacred oil(4), 48 swaps), about 220-260 ticks
  less than lines. The cost:
  - The click is refused below `%morttonquest` 65, "created sacred oil"
    (`mortton_pyre.rs2:6`). That needs the quest's serum and five shade kills,
    and the account must rebuild the Flamtaer temple itself to
    `%temple_repaired_p = 100` before it may use the altar
    (`flamtaer_temple.rs2:80-84`). The repairs are a 3-tick, crafting-rolled
    loc loop (`flamtaer_temple.rs2:44-156`). This is very likely more than
    the ~250 ticks saved (inferred, not measured; nobody has costed the
    quest).
  - Every helper making oil also needs stage 60. Each oil(4) drains 108
    sanctity (`flamtaer_temple.rs2:294`) and needs at least 300. Sanctity is
    a temporary varp (no `scope=perm`, `quest_mortton.varp:13`) that drains
    30 every 100 ticks (`:161-165`) and is refilled only by temple repairs or
    shade kills. 666 oils need about 72,000 sanctity, which is roughly 90
    batches of planks, limestone bricks and swamp paste. Olive oil is sold
    as oil(3) at Razmire's general store (`all.inv`, `razmiregeneralstore`),
    and yew needs 4 doses, so it has to be decanted. Helper time doesn't
    count, but this is a large helper project.
  - Worth doing only if Shades of Mort'ton lands on the quest route for other
    reasons. Its 2,000 Crafting + 2,335 Herblore base (`quest_mortton.rs2:55,65-66`)
    would then also count. Lighting during the pyre swaps could add a few
    percent more (inferred upper bound ~80 base/tick combined). Not
    measured.
- **Bank lines** lose about 40-60 ticks to trades or dropped rows (section 2).
  The bank only matters if no helper stands nearby.
- **Jogre bones** (Big Chompy Bird Hunting, Firemaking 30) roll on a 3-tick
  timer for 90 base (`tbwt_jogre_bones.rs2:25-73`), about 30 base per tick,
  under half the magic line.
- **Temple fire altar**: 160 base per 99-tick lit period (section 3).
- **Fire arrows, torches, the funeral pyre itself**: lighting fire arrows and
  torches gives no Firemaking xp in this content (no `stat_advance` in those
  branches). Lighting a funeral pyre gives 404.5 base for magic pyre logs
  (`pyre_fm_experience`), but needs shade remains and a 49-tick pyre per
  burn. Not competitive.

**Interleaving** (`interleaving.md` section 8, the absorbable-fractions table): **none of
Firemaking can be absorbed into self-only time.** The line is location-bound in its own way:
each success `p_teleport`s the player one tile and `p_delay(0)`s (section 4), so it would pull
the account off a tree, fishing spot or knight. Lighting is an inventory use, so it would also
cancel a gathering interaction (interleaving.md rule 1). And it runs on `%action_delay`, the
same varp a pickpocket stun sets to `map_clock + 8` (interleaving.md section 4), so it cannot
share a stun either (inferred from the read scripts; not measured). The reverse, using the
line's 3 idle ticks per fire as a host for bury or delay-free actions, is an open question in
interleaving.md section 9. Column 5 of the summary row is therefore n/a.

## 6. Gotchas

- **Never resend a light that may already have taken.** `inv_dropslot` runs
  before the clock check (`firemaking.rs2:97`), so every accepted inventory
  light drops another log. A resend sent after the light was accepted puts a
  second log on the tile, and the second log can't be lit there afterwards.
  At 100 ms the bot's 2-tick round trip made resends premature.
  At 300 ms, waiting one tick for the inventory to change was exact (1.000
  logs per success over 368 fires). On production, resend only after the
  state shows the log still in the inventory.
- **The light must land by R+4.** That is a 3-tick window after the roll at R.
  A light landing at R+5 restarts the clock (+3 ticks). This tolerates up to
  two ticks of production lag. Measured locally with zero rejections.
- **Eastward rows need run.** The 2-tile step has to happen in one tick. The
  ctrl-run click needs at least 1% energy (`MoveClickHandler.ts:35`). With
  85 such steps per 99 the measured runs never ran out. Helper-dropped rows
  need no walk clicks at all, because the ground op walks.
- **Helper-dropped logs are private for 100 ticks and gone at 300**
  (`drop.rs2:22` gives 200 x 3/2, `World.ts` addObj with
  `NODE_OBJ_REVEAL_TICKS` 100, not set in `fly.toml`). Measured: a dropped
  log is in the scored account's view 99 ticks after the drop is confirmed
  (`speedrun/lab/fm-row.ts`, two runs). The fm-row role drops each log about
  105 ticks before the account can want it, one per 4-tick roll, so it is
  public about 5 ticks early (up to 48 for the logs dropped during the
  early failed rolls) and never near its 300-tick despawn. The scored
  account can stay logged out for the first 100 ticks (`primitives.md` §8).
- **The 2-row snake's lap turn costs 5 ticks.** After the last tile of the
  eastward row (3019,3361) the ground op walks round to (3019,3362) and the
  light starts fresh: a 9-tick gap at logs 54 and 108 in both fm-row lab
  runs, with the log already in view.
- **Interactable decorations refuse a fire** and collision data can't show
  them. Confirm any new row in the lab, or let the bot skip a refused tile
  (`firemaking-line.ts` skips a tile it can't reach in 4 ticks).
- **No Firemaking boost exists.** Liverbane Ale lowers Firemaking by 5
  (`bartender.rs2:66`); don't drink it before Sea Slug.
- **No damage, no food, no hostile NPCs, no depletion.** The tinderbox the
  tutorial hands out is enough.

## 7. Helper supply list

Failed rolls retry the same log, and xp per log is fixed, so these counts
are exact for 1 -> 99 (`firemaking-model.ts`, and both measured runs used
exactly 157).

| Item | Count | Where helpers get it |
|---|---|---|
| Logs | 2 | woodcutting (any tree) or the exchange |
| Oak logs | 4 | oak trees (Woodcutting 15) or the exchange |
| Willow logs | 7 | willows (30) or the exchange |
| Maple logs | 13 | maples (45) or the exchange |
| Yew logs | 24 | yews (60) or the exchange |
| Magic logs | 107 | magic trees (75) or the exchange |
| Tinderbox | 1 | the tutorial's (keep it); otherwise any general store |

Trade cadence: 6 hand-overs of 27 (the account holds a tinderbox).
1: 2 logs + 4 oak + 7 willow + 13 maple + 1 yew. 2: 23 yew + 4 magic. 3-5:
27 magic each. 6: 22 magic. Each is 5 ticks for the account. If 1 -> 30
happens before Sea Slug, the first hand-over is just 2 logs + 4 oak, and
30 -> 99 later takes 151 more, the same tiers in the same order (model:
7 willow, 13 maple, 25 yew, 106 magic, depending on how far past 30 the
oak logs land; `firemaking-model.ts --from=<level>` gives the exact list).

For dropped rows the same 157 logs go on the ground in this order along the
snake, one per tile.

## 8. Open questions

- **Production latency.** Every cadence here assumes the reply to the
  success message lands within 3 ticks of the roll. A short public-server
  run of `firemaking-line.ts` (logging gaps and `rejectedSendsPerFire`)
  would settle it.
- **Dropped rows on the demo.** The paced drop of all 157 logs has run end
  to end in the lab only (`helpers/fm-row.md`); the run's row beside the
  coop is unconfirmed, and the helper's bank restocks are unmeasured.
- **Shades of Mort'ton's cost.** If someone costs the quest to stage 65
  (temple fully rebuilt by the account) and it comes out under about 250
  ticks net of its Crafting and Herblore rewards, pyre logs win (section 5).
  No rs/3 child covers it.
- **Interleaving pyre logs with lighting** (pyre clicks in the three idle
  ticks of each fire, and the light re-sent last in the tick) is unmeasured.
  It only matters if the quest is done.
