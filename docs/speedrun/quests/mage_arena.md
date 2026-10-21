# Mage Arena (the Charge unlock)

**About 580 ticks (about 3 minutes at 300 ms) with Plague City done, and it buys
the Charge spell, which takes Magic from 80 to 99 in 163 casts: 33 ticks.**
Charge is the only check that matters, `%magearena >= 8`, and it does not look at
the god staff or cape. The fight against Kolodion's five forms is about 300 ticks,
and it needs **Protect from Magic (Prayer 37, for example from Holy Grail)**:
without it the bot died twice, because his Flames of Zamorak drain Magic below
the level of the bot's spells. Travel in is about 155 ticks through the Ardougne
lever and the Deserted Keep (Ardougne teleport, so Plague City is a soft
prerequisite), or about 340 from Edgeville without it.

All ticks are stock-client figures at the production tick rate (lab at
`NODE_TICKRATE=300`) unless marked "100 ms lab". Measured with
`docs/speedrun/scripts/quest-magearena-run.ts` (the unlock),
`quest-magearena-travel.ts` (the way in) and `quest-magearena-charge.ts` (the
Charge rate). Primitive costs come from `primitives.md`.

## Reward

- **No xp reward.** The fight itself gives about 2,400 base Magic at 80 Magic
  with Fire Wave (measured once, 100 ms lab; the later runs' xp line was broken by
  the setup order and is fixed in the script now), which is 13 Charge casts.
- **Charge** (Magic 80): `[if_button,magic:charge]` refuses with "This spell can
  only be learnt in the Mage Arena." while `%magearena < ^mage_arena_staff_given`
  (8) (read, `skill_magic/scripts/spells/charge.rs2:4-7`). It gives 1,800 tenths =
  **180 base Magic per cast** (read, `skill_magic/configs/magic_spells.dbrow:206-212`;
  measured 4,500 game xp per cast). It has no delay and no recast cooldown (the
  2005 "current Charge is too strong" check is commented out,
  `charge.rs2:8-12`).
- The three god spells (Saradomin Strike, Claws of Guthix, Flames of Zamorak):
  castable only inside the arena until 100 casts each (`%saramage` etc.,
  `saradomin_strike.rs2:9-14,28-34`). Not needed for the plan.
- The god cape and god staff (untradeable, `mage_arena.obj:34,69,104,136,169,203`).
  More staves are sold by the chamber guardian for 80,000 once `%magearena >= 8`
  (`chamber_guardian.rs2:44-49`, `mage_arena.inv:22-33`).
- No quest points (it is a miniquest; no `send_quest_complete`).

## Requirements (as this server enforces them)

| Requirement | Where | Check |
|---|---|---|
| Magic 60 to start | `kolodion.rs2:6` | `stat_base(magic) < 60` refuses: a boost does not count |
| No weapons or armour held or worn when entering | `kolodion.rs2:93-96`, `mage_arena.rs2:100-138` | categories: gloves, helmet, body, legs, shield, every melee/ranged weapon category, arrows, unstrung bows, logs, bow strings, clue scrolls, caskets, cannon parts. **Staves are allowed** (not a listed category), and so are amulets, capes, boots, rings, food, runes and a knife |
| Only magic inside the arena | `npc_combat.rs2:133-136` | melee/ranged attack is refused ("Kolodion allows only magical combat within the arena.") unless autocast is on |
| The current form only | `npc_combat.rs2:263-277` | casting on a leftover form from an earlier stage is refused |
| Charge | `charge.rs2:4`, `magic.rs2:12-51` | `%magearena >= 8`; `stat(magic) >= 80` (**boosted** level counts, `magic.rs2:22`); 3 fire, 3 blood, 3 air runes (a staff of fire or air removes one kind, `magic.rs2:53-`) |
| Protect from Magic | `prayers.dbrow:103-109` | Prayer 37. Not a script requirement, but the measured fight is not survivable at 80 Magic without it (below) |

What the wiki lists but this server does not check: no god-spell cast count, no
cape or staff for Charge, no Prayer requirement.

The stages, from `area_mage_arena/configs/mage_arena.constant:1-8`: 1 started
(human form), 2 ogre, 3 spider, 4 ethereal, 5 demon, 6 complete, 7 prayed at a
statue, 8 staff given. All arena varps are `scope=perm`
(`_unpack/225/all.varp:313-329`), so the unlock is logout-safe at any stage (you
cannot log out within 16 ticks of combat anyway, `primitives.md` §8).

## Helper-supplied items (one trade)

| Item | Tradeable | Why |
|---|---|---|
| Staff of fire (or any staff) | yes | wieldable in the arena, saves the Fire Wave fire runes; no wield requirement (`levelrequire/tier1.rs2:86`) |
| About 70 blood runes and 400 air runes | yes | Fire Wave is 1 blood, 7 fire, 5 air (`magic_combat_spells.dbrow:286-295`); a slow fight is about 70 casts |
| 489 blood, 489 air (and 489 fire without a fire staff) | yes | the 163 Charge casts for 80 to 99 |
| A knife | yes | slashes the three webs on the way in; a knife has no weapon category, so Kolodion accepts it |
| 2 prayer potions (insurance) | yes | only if Prayer is under about 75 (see the fight) |
| Runes for Ardougne teleport in, any teleport out | yes | Ardougne teleport needs Plague City (`teleport.rs2:22-25`) |

Nothing the scored account must make itself: the cape and staff come from the
chamber, and the knife and food can stay in the inventory.

## Step list

Start: anywhere a teleport works. Counts are from the scripts; ticks are 300 ms
measurements.

1. **Ardougne teleport** to (2661,3301): 4 ticks (primitive). Plague City needed.
2. **Walk to the wilderness lever** at (2561,3311), about 100 route tiles: 59-65
   ticks (61 at 300 ms).
3. **Pull the lever** (`wilderness_lever.rs2:3-29`): the first pull shows a warning
   mesbox and a 3-way choice, pick "Yes I'm brave." ("Yes please, don't show this
   message again." sets `%warning_wilderness_teleport_lever` for later pulls).
   Lands at the Deserted Keep (3154,3924), wilderness level 51. 1 page, 1 option:
   15 ticks.
4. **Deserted Keep to the mage bank ladder** at (3091,3957). The keep's only exit
   is the web in its north wall at (3158,3951); two more webs at (3095,3957) and
   (3093,3957) guard the ladder. Use the knife on each web (`web.rs2:10-33`): 50%
   per try (`random(2)`), 1 tick plus a `p_delay(1)` on success; a slashed web
   stays open 100 ticks. About 26 + 40 route tiles. Measured 71 ticks with 4 tries
   (100 ms lab) and 93 with 12 tries (300 ms); expect about 6 tries and 75 ticks.
   The lite client's static collision still blocks a slashed web, so the script
   steps through with a server-side walk (`sdk.sendWalk`).
5. **Climb down the ladder** (`mage_arena.rs2:1-7`) to the cellar (2543,4713): 3
   ticks. The cellar is outside the wilderness zone (x < 2944,
   `wilderness_zones.dbrow:4`), so teleports work from here on.
6. **Talk to Kolodion** at (2541,4715) (`kolodion.rs2:1-101`): "Can I fight
   here?", "Yes indeedy.", "Ok, let's fight."; 13 pages and 3 options by reading.
   Switch Protect from Magic on first. Sets `%magearena = 1` (`kolodion.rs2:99`)
   and teleports you into the arena at (3105,3934), wilderness level 52, after
   `p_delay`s of 3 and 3 (`kolodion.rs2:120-194`). **39 ticks** at 300 ms (twice),
   24-36 at 100 ms.
7. **The fight**, five forms in order, each spawned where the last one died. Cast
   Fire Wave on whichever form is current; a click while the attack delay is
   pending re-queues itself (`player_magic.rs2:95-97`), so the bot clicks every 2
   ticks. Each form's death sets the next stage (`kolodion_fight.rs2:23-139`).
   After the demon, `finish_mage_arena` waits 3 + 2 ticks and teleports you to the
   cellar (2540,4716) (`mage_arena.rs2:146-158`). Measured **312 and 314 ticks**
   at 300 ms, and 240, 246, 298 and 354 at 100 ms (the fight is server-paced, so
   the rates agree): mean 294. See Fights.
8. **Kolodion's congratulations** in the cellar: 2-5 ticks measured (the page
   came and went before the script counted it).
9. **Step into the sparkling pool** at (2541,4719) (`mage_arena.rs2:15-77`): at
   `%magearena >= 6` a mesbox (2 pages counted), a jump and a teleport to the
   chamber (2509,4689). **12-14 ticks.**
10. **Pray at a statue**: Saradomin (2500,4721), Guthix (2507,4724) or Zamorak
    (2516,4721) (`chamber.rs2:1-22`); the god only decides which god spell you can
    cast later. Two mesboxes, `p_delay(2)`; sets `%magearena = 7` and drops the
    cape on the ground below the statue for 200 ticks; **take the cape**. About
    25 tiles from the pool. **32 ticks** (twice).
11. **Talk to the chamber guardian** at (2506,4696) (`chamber_guardian.rs2:1-17`)
    with the cape held or worn: 5 pages, he hands over the matching staff and sets
    `%magearena = 8`. The staff is `inv_add`ed and **drops on the ground with a
    full inventory** (it happened once in the lab with 20 sharks). About 25 tiles.
    **24-28 ticks.**
12. **Teleport out**: 4 ticks (any teleport; the chamber is outside the
    wilderness).

## Tick total

| Part | Raw counts | Ticks | Basis |
|---|---|---|---|
| Travel in (Ardougne route) | 1 teleport, about 166 tiles, 1 lever (1 page, 1 option), 3 webs (about 6 knife tries), 1 ladder | 4 + 61 + 15 + 75 + 3 = **158** | measured (`quest-magearena-travel.ts`, 300 ms: 172 with 12 web tries), teleport primitive |
| Travel in without Plague City | glory to Edgeville, about 470 tiles north, 2 webs, 1 ladder | 6 + **335** = 341 | measured (`FROM=edgeville`, 5 web tries), glory primitive |
| Talk to Kolodion | 13 pages, 3 options, arena teleport | **39** | measured |
| Fight | about 60 casts, 150 clicks | **about 300** (240-354) | measured, 6 runs |
| Congratulations, pool, statue and cape, guardian | 1 + 2 + 2 + 5 pages, about 50 tiles, 1 pickup | 3 + 13 + 32 + 26 = **74** | measured |
| Teleport out | 1 teleport | **4** | primitive |
| **Total, Ardougne route** | | **about 575** | |
| **Total, Edgeville route** | | **about 760** | |

The unlock (talk to staff) measured 421 and 430 ticks at 300 ms. Then Charge: 163
casts in **33 ticks** for Magic 80 to 99 (below), so the Mage Arena route costs
about 610 ticks for 29,251 base Magic.

## Charge, measured after the unlock

`quest-magearena-charge.ts` clicks Charge (interface component 1193) a fixed
number of times per tick for 20 ticks and reads Magic xp every tick.

| Clicks per tick | Casts per tick, 300 ms | Casts per tick, 100 ms lab |
|---|---|---|
| 1 | 1 every tick | 1 |
| 3 | 3 every tick | 3 on average (1-5 per tick) |
| 5 | **5 every tick** | 5 on average (2-5 per tick) |
| 10 | **5 every tick** (the surplus waits in the queue) | 4.55 sustained (200 casts over 44 ticks) |

So the per-skill report's 5 casts per tick is right at the production tick rate:
**900 base Magic per tick**. The cap is the engine's, not the script's: it decodes
at most 5 user-event packets per player per tick and IF_BUTTON is one
(`server/engine/src/network/game/client/ClientGameProtCategory.ts:6`,
`model/IfButton.ts:5`). At 100 ms the client could not keep the queue full every
tick, hence 4.55. Level-up boxes did not slow it (`charge.rs2` opens with
`if_close`); the test went from 80 to 99.

Magic 80 is 267,169 game xp (10,687 base) and 99 is 998,458 (39,938 base)
(measured with `::setstat`; the curve is `Player.ts:77-85`), so 80 to 99 is 29,251
base = 163 casts = 33 ticks, and 489 each of blood, air and fire runes (fire free
with a staff of fire).

## Fights

**Kolodion**, five forms, all `vislevel=hide` except the demon (112). Read from
`area_mage_arena/configs/mage_arena.npc`:

| Form | npc | Hitpoints | Defence | Magic | Line | His spells |
|---|---|---|---|---|---|---|
| Human | kolhuman (907) | 3 | 20 | 15 | 145-183 | Flames, Claws or Strike |
| Ogre | kologre (908) | 65 | 72 | 50 | 185-223 | same |
| Spider | kolspider (909) | 78 | 47 | 70 | 225-255 | Flames or Claws |
| Ethereal | kolethereal (910) | 78 | 58 | 30 | 257-302 | Claws or Strike |
| Demon | koldemon (911) | 107 | 105 | 80 | 304-337 | Flames or Strike |

331 hitpoints in all. Every form attacks only with god spells, max hit 20 every 5
ticks (`kolodion_fight.rs2:1-11`, `magic_combat_spells.dbrow:478-530`). The
spells he casts are the player versions, so their side effects apply: **Flames of
Zamorak drains Magic by 1 + 5%**, Claws of Guthix drains Defence the same way, and
Saradomin Strike drains Prayer by 1, every successful hit, stacking
(`npc_combat_magic.rs2:37-40,122-140`).

- **Without Protect from Magic it fails at 80 Magic** (measured): with Fire Wave
  (level 75) the bot was refused "Your Magic level is not high enough for this
  spell." after two Flames hits and died in the ogre form; with Fire Blast (level
  59) it reached the spider and died there, drained below 59. A Magic potion or
  restore potions might carry it, not tested.
- **With Protect from Magic he never hits** (`npc_combat_magic.rs2:37` skips the
  hit when `check_protect_prayer(^magic_style)`): no damage taken in any of the 6
  completed runs, no drains, no food eaten. The prayer drains about **1 point per
  5.2 ticks**: 48 points over 246 ticks, 58/298, 67/354 (100 ms), 59/312 and
  60/314 (300 ms). One run lost its 70 points at tick 408 of the fight and died.
  **Prayer budget**: about 60 points for a typical fight and 70 for a slow one.
  Holy Grail's 11,000 base Prayer (`quest_grail.rs2:116`) is Prayer **80** on this
  curve (80 needs 10,687 base, 81 needs 11,456), so with Holy Grail done there are
  80 points, enough for about 420 fight ticks; bring a prayer potion only below
  about Prayer 75.
- **Fight length at 80 Magic, Fire Wave, staff of fire, no other bonuses:** 240,
  246, 298, 354, 312, 314 ticks (mean 294). The spread is accuracy and damage
  rolls; the cast cadence was one cast per 5 ticks throughout. The fight is the
  same at 70/70/70 melee: melee is not allowed and Defence does not matter under
  the prayer.
- **Faster options (inferred):** Iban Blast (Underground Pass, max 25,
  `magic_combat_spells.dbrow:532-`) is a staff spell and should cut about 20%; an
  amulet of magic or other magic-bonus amulet, cape or boots is allowed in the
  arena (those slots are not checked) and raises accuracy. Doing the arena at 60
  Magic works too under the prayer (Fire Blast, max 16) but is slower and gives
  nothing before 80.
- **Kill credit:** each form hands over to the next only if the player has the
  kill credit (`npc_findhero`, `kolodion_fight.rs2:24-29`). Solo this is always
  true. `p_finduid` there only adds a 1-tick delay, so the coordinator's Mordred
  risk (a lost stage on a delayed player) does not apply.
- **No killing-blow check:** any spell damages any form; nothing checks a god
  spell or item at hp 0.

## Risks and gotchas

- **Death in the arena** (wilderness level 52) loses all but 3 items and leaves the
  current form alive for its 1,000-tick lifetime. Returning to Kolodion resumes at
  the same stage (`kolodion.rs2:15-16,103-112`), and the teleport deletes a stale
  boss of the current stage only (`kolodion.rs2:135-141`); a leftover later form
  is refused ("You have already killed Kolodion in his arachnid form.") and a bot
  must target the current stage's npc id (907 + stage), as the script does.
- **No teleport out of the wilderness legs.** Spells are blocked above level 20
  and jewellery above 30 (`teleport.rs2:17-21`, `amulet_of_glory.rs2:19-24`); the
  keep (51), the ladder (55) and the arena (52) are all deep. The cellar and the
  chamber are outside the wilderness, so leave from there.
- **Full inventory at the guardian** drops the staff on the floor; leave a slot.
- **The pool needs its mesbox clicked** before the jump (`mage_arena.rs2:47-50`).
- **Aggressive battle mages** in the arena only hunt players with
  `%magearena > 5` (`mage_arena.hunt:7`), so they ignore you during the fight.
- Level-up boxes during the fight (3 per run at 80 Magic) do not stop casting
  when dismissed; the script dismisses them.
- **Lab tooling:** the lite client re-publishes a dialogue page under a new
  `pageId`; an unguarded `sendClickDialog` on the stale copy lands on the next
  page. The scripts use `clickDialogByText`, which binds the click to the page.

## Open questions

- Fire Wave vs Iban Blast fight time, and a magic-bonus amulet: not measured.
- Whether another delay-free spell gives more than Charge's 180 base per click at
  5 clicks per tick (the same engine cap would apply); not checked here.
- The arena could be done before 80 Magic (start needs 60) to overlap travel with
  another wilderness or Ardougne trip; the README ordering should decide.
