# Engine sweep B: combat, minigames, areas and `_test`

Slice of rs/61 (xp grant audit by guard). Scope: every `stat_advance(` under
`server/content/scripts/skill_combat/**` (39), `minigames/**` (38), `areas/**` (23) and
`_test/**` (36), plus the combat-xp machinery and the Charge-shaped spell question.
No lab runs were made for this file; every rate is **read** (taken from the script and
engine) or **inferred** (derived from read code plus an assumption that is named), and the
measured route rates quoted for comparison come from `agent/rs-28-coordinator-0`
(`docs/speedrun/skills/*.md`).

## Units and engine facts used throughout (read)

- `stat_advance(stat, N)` adds `N * xpRate` to the stored stat, which is kept in tenths of
  an xp (`PlayerOps.ts:811-818`, `Player.ts:1878-1902`). The demo runs `NODE_XPRATE=25`
  (`fly.toml`, `WorldConfig.ts:102`). **Base xp in this file is `N / 10`**, the number the
  route docs use.
- The level table is the rs-sdk curve (`Player.ts:77-85`, `PATCHES.md:116`): 99 needs
  998,458 xp, which is **39,938 base xp**. Reference points: 300 base is level 30,
  2,500 base level 59, 5,000 base level 69, 7,175 base level 74, 10,687 base level 80.
- Each player decodes at most 5 user-event packets per tick (`ClientGameProtCategory.ts:5`,
  `NetworkPlayer.ts:69`). `IF_BUTTON`, `OPHELD*`, `OPLOC*`, `OPNPC*` and
  `RESUME_PAUSEBUTTON` are all user events (`network/game/client/model/*.ts`).
- `IF_BUTTON`, `OPHELDU` and `RESUME_PAUSEBUTTON` run their script immediately inside the
  packet handler (`IfButtonHandler.ts:43`, `OpHeldUHandler.ts:93-130`,
  `ResumePauseButtonHandler.ts:20`), so a delay-free script reached by one of them can fire
  up to 5 times a tick. `OPLOC`/`OPNPC` only set an interaction (`OpLocHandler.ts:54`,
  `OpNpcHandler.ts:48`), which is processed once per tick (inferred: one interaction
  target per player).
- `OPHELD*`, `OPLOC*` and `OPNPC*` are dropped while the player is delayed
  (`OpHeldUHandler.ts:16`, `OpLocHandler.ts:14`, `OpNpcHandler.ts:16`). An `IF_BUTTON` script
  is refused protected access while delayed (`Player.ts:2233`), and `p_finduid` fails when
  the player is delayed or has a modal open (`PlayerOps.ts:88`, `Player.ts:878-887`).
  `p_delay(n)` costs n+2 ticks from the click (`PlayerOps.ts:376-380`).

## `_test`: compiled in, not reachable by a staff-0 account (read)

- **Compiled:** the pack tooling walks all of `content/scripts` with no `_test` exclusion
  (`tools/pack/PackFile.ts:369-395`; no `.ts` under `server/` mentions `_test`).
- **Triggers:** 256 `[debugproc,...]`, 39 `[proc]`, 14 `[label]`, 4 `[queue]`, one
  `[ai_spawn,small_bat]` and one `[ai_despawn,small_bat]`. Every one of the 36
  `stat_advance` calls sits under a debugproc (`cheat_maxme.rs2:2`, `cheat_other.rs2:54`,
  `cheat_quest.rs2:1-8`, `debug_quests.rs2`). No production script calls a `_test` label
  (grep for `@`/`~`/`gosub` of `debug_completequests`, `complete_all_quests`, `debug_quests`,
  `maxme`, `addxp` outside `_test`: no hits). The queues are only queued from `_test`
  procs, and the `small_bat` triggers grant nothing (`cheat_npc.rs2:59-63`).
- **Gate:** debugprocs run only from `ClientCheatHandler.ts:57-62`, which needs
  `!production && staffModLevel >= 4`. The demo does not set `NODE_PRODUCTION`, so
  `production` is false (`WorldConfig.ts:103,245`); the remaining gate is staff level.
  Production runs `LOGIN_SERVER=true` (`fly.toml`), so the level comes from the account row,
  which defaults to 0 (`prisma/*/migrations/*_clean/migration.sql:15/17`).
  `LOCAL_STAFF_LEVEL` (default 0, `Environment.ts:58`) applies only without a login server
  (`LoginThread.ts:58-61`). The engine-side `::advancestat` path needs staff 3
  (`ClientCheatHandler.ts:189,483`). Any account above staff 1 is dropped from the hiscores
  anyway (`LoginServer.ts:87-92`).
- **Verdict:** not reachable. Per-row detail is skipped.

## How combat xp is granted (read)

- **One proc.** `give_combat_experience(damagestyle, damage, multiplier)`
  (`combat.rs2:88-168`) is called once per successful hit roll by melee
  (`player_melee.rs2:33`), ranged (`player_ranged.rs2:53`), magic
  (`player_magic.rs2:240`) and every PvM special (`specs/scripts/pvm_*.rs2`). Damage is capped
  at the NPC's current HP (`player_melee.rs2:32`). Per damage point: 4 base to the style's
  skill (accurate, aggressive, defensive, ranged accurate or rapid), 1.33 to each of
  Attack, Strength and Defence (controlled), 2 + 2 (ranged longrange), 2 Magic (normal
  cast) or 1.33 Magic + 1 Defence (defensive cast), plus 1.33 Hitpoints. A zero-damage hit
  grants nothing (`Player.ts:1885`). The NPC multiplier defaults to 1000 = 1x
  (`combat.param:165-167`); the only other values in the content are 25 (39 random-event
  NPCs) and 100 (one NPC), so no NPC boosts xp. The Black Knight Titan pays 1 per damage in
  every style (`combat.rs2:92-117`). PvP uses a copy capped at 1.125x for combat level
  (`pvp_combat.rs2:148-175`).
- **Cadence.** Every melee, ranged, special and combat-spell path is gated by
  `%action_delay`: melee checks at `player_melee.rs2:8` and sets `map_clock + attackrate`
  after the grant (`:56-60`); ranged sets it before the grant (`player_ranged.rs2:17-24`,
  rapid is attackrate - 1); specials check and set it at
  `player_special_attack.rs2:9-17`; combat spells check at `player_magic.rs2:95` and set
  `map_clock + 5` at `:188`. Crumble Undead, Iban's Blast and the three god spells use the
  same checks (`spells/scripts/*.rs2`). No combat style, special or spell path grants xp
  without passing that gate.
- **Xp without a hit.** Only magic: `pvm_spell_cast` gives the spell's base xp
  (`magic.rs2:108-109` via `player_magic.rs2:170`) before the hit roll, so a splash still
  pays base xp, once per 5 ticks. Best splash value: Stun 90 base (level 80), Enfeeble 83,
  Vulnerability 76 (`magic_combat_spells.dbrow:416-450`).
- **Xp before the hit lands.** All styles grant at roll time; the damage lands later from
  `npc_queue` (`player_melee.rs2:50`, `player_ranged.rs2:70`). The HP cap reads the NPC's
  current HP, not HP minus hits still in flight, so two pending hits can both earn xp
  for the same last HP (inferred; small at one attacker).
- **Charge versus combat spells.** Combat spells are `apnpct`/`opnpct` on an NPC, run
  `p_stopaction` and `if_close`, and share the 5-tick `%action_delay`. Charge is
  `[if_button,magic:charge]` (`charge.rs2:1-27`): its guards are `p_finduid` (`:3`), the
  Mage Arena var (`:4`) and `check_spell_requirements` (`:15`, which checks Magic 80 and
  runes at `magic.rs2:14-51`). It sets no delay, no `%action_delay` and no recast check;
  the 2005 recast guard is commented out (`:9-12`). `settimer(charge, 2)` only runs the
  buff countdown. So it fires on each of the 5 button packets a tick, 180 base each
  (`magic_spells.dbrow:206-212`). rs-28 measured exactly that (`magic.md`: 5 casts a tick,
  900 base a tick).
- **Same shape elsewhere?** No. Every other non-combat spell has a `p_delay`, and the
  `if_button` ones also check `p_finduid`, which refuses a second cast while delayed:
  bones to bananas grants and then `p_delay(2)` (`convert_bones.rs2:38-42`); teleports grant
  and then `p_delay(1)` (`teleport.rs2:48`, `:61`); alchemy, enchant, superheat and
  charge-orb grant on `opheldt`/`oploct` and then `p_delay` 1-3; telegrab delays before
  its grant (`telegrab.rs2:70-71`). Prayer activation grants no xp, and burying bones delays
  before its grant (`bury_bone.rs2:10,15`).

## Table 1: all rows, sorted by base xp per tick

Rates are the maximum the guards allow; "sustained" figures include restocking.
Once-only rewards are ranked by N over the claim dialogue; the quest that unlocks them is
the real cost and is named in Notes.

| Skill | Action (product) | Base xp per action | Level req (checked? where) | Trigger (opheld/opheldu/oploc/opnpc/if_button/resume_p/timer/queue/softtimer) | Item / location guards | Delay: kind (p_delay n / p_arrivedelay / weakqueue / queue n / none) and BEFORE or AFTER the grant | Busy/interface guard | Re-triggerable within a tick? | Actions per tick (max) | Base xp per tick | Source file:line (grant) + file:line (guard) | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Agility | Ticket trader, 1,000-ticket button | 320,000 | none | if_button (`agilityarena_trade:com_99/105`) | 1,000 `agilityarena_ticket` in inv; trade interface visible (Jackie `opnpc3` opens it) | none | none: no `p_finduid`; protected access fails only while delayed | yes | 5 (read) | 1,600,000 while tickets last (read) | `agilityarena_tickettrader.rs2:67`; `:61` (ticket count), `:48-49` | One click is 8x a full 99. Consumes 1,000 tickets. |
| Agility | Ticket trader, 100-ticket button | 28,000 | none | if_button (`com_98/104`) | 100 tickets | none | none | yes | 5 (read) | 140,000 (read) | `agilityarena_tickettrader.rs2:67`; `:61`, `:45-46` | 280 base per ticket |
| Agility | Ticket trader, 25-ticket button | 6,500 | none | if_button (`com_97/103`) | 25 tickets | none | none | yes | 5 (read) | 32,500 (read) | `:67`; `:61`, `:42-43` | 260 per ticket |
| Agility | Ticket trader, 10-ticket button | 2,480 | none | if_button (`com_96/102`) | 10 tickets | none | none | yes | 5 (read) | 12,400 (read) | `:67`; `:61`, `:39-40` | 248 per ticket |
| Fishing | Sea Slug reward (Caroline) | 7,175 once | quest state only | opnpc1 dialogue | `%seaslugquest` at the saved-Kennith stage | none | dialogue | no: var set before the grant | once | about 2,400 over about 3 claim ticks (inferred) | `caroline.rs2:45`; `:42` | Reaches level 74 from 0. Cost is the Sea Slug quest. |
| Fishing | Tai Bwo Wannai Trio reward (Tiadeche) | 5,000 once | quest state only | opnpc1 dialogue | `%tbwt_tiadeche = complete` | none | dialogue | no: var set first | once | about 1,700 over about 3 claim ticks (inferred) | `tbwt_tiadeche_final.rs2:21`; `:2-4`, `:20` | Level 69 from 0. Cost is the quest. |
| Cooking | Tai Bwo Wannai Trio reward (Tinsay) | 5,000 once | quest state only | opnpc1 dialogue | `%tbwt_tinsay = complete` | none | dialogue | no | once | about 1,700 (inferred) | `tbwt_tinsay_final.rs2:16`; `:2-4`, `:15` | Level 69. Cost is the quest. |
| Attack + Strength | Tai Bwo Wannai Trio reward (Tamayu) | 2,500 + 2,500 once | quest state only | opnpc1 dialogue (or opnpc3 redirect) | `%tbwt_tamayu = complete`; also gives the rune spear (kp) | none | dialogue | no | once | about 1,700 combined (inferred) | `tbwt_tamayu_final.rs2:22-23`; `:2-4`, `:21` | Level 59 in each. |
| Agility | Ticket trader, 1-ticket button | 240 | none | if_button (`com_94/95`) | 1 ticket | none | none | yes | 5 (read) | 1,200 (read) | `:67`; `:61`, `:36-37` | |
| Magic | Charge | 180 | 80, checked (`magic.rs2:22` via `charge.rs2:15`); members | if_button (`magic:charge`) | 3 fire + 3 blood + 3 air (a staff can replace one element, `magic.rs2:53-88`); `%magearena >= staff_given` (`charge.rs2:4`) | none (`settimer(charge,2)` is the buff only) | `p_finduid` (`charge.rs2:3`) | yes | 5 (read; measured by rs-28) | 900 (measured, rs-28 `magic.md`) | `charge.rs2:26`; `:3`, `:4`, `:15` | Recast guard commented out `:9-12`. Already the route above 80. |
| Firemaking | Make magic or yew pyre logs (sacred oil on logs) | 60 | **none** for making (Firemaking checked only when adding to a pyre, `mortton_pyre.rs2:75`) | opheldu (`_category_111`, oil on `category_22` logs) | oil with >= 4 doses (`:22`); `%morttonquest >= mortton_created_sacred_oil` (`:6`) | none | none (dropped only while delayed) | yes | 5 (inferred from the handler) | 300 burst; about 100 sustained with banks (inferred: 14 log + oil pairs per inventory) | `mortton_pyre.rs2:42`; `:6`, `:22`; `flamtaer_pyre.struct:51,63` | Consumes 1 magic or yew log + 1 sacred oil (4). Oiled logs are `category_2050`, so no re-oil loop (`mortton.obj:171-258`). |
| Firemaking | Make maple or willow pyre logs | 40 | none | opheldu | 3 doses | none | none | yes | 5 (inferred) | 200 burst (inferred) | `mortton_pyre.rs2:42`; `flamtaer_pyre.struct:27,39` | |
| Firemaking | Make normal or oak pyre logs | 20 | none | opheldu | 2 doses | none | none | yes | 5 (inferred) | 100 burst (inferred) | `mortton_pyre.rs2:42`; `flamtaer_pyre.struct:3,15` | One 4-dose oil makes two. |
| Cooking | Gnome restaurant hand-in (Aluft) | 60 per dish; 120-300 per job, 210 on average | **none** at hand-in | opnpc1 dialogue (resume_p pages) | the job's dishes in inv (`gnome_restaurant.rs2:383`); job state `%gnome_restaurant_progress` 8-16 | none | dialogue | no: one job, but delivery chains straight into a new job (`:377-380`) | about 1 job per 3-5 ticks (inferred: resumes run immediately, 5 a tick) | about 40-70 (inferred) | `gnome_restaurant.rs2:402`; `:383`, `:403` | Jobs are random among 10 orders (`:269-299`). Dishes are tradeable. Opening jobs 1-6 are scripted tutorial dishes. |
| Ranged | Combat hit, accurate or rapid | 4 per damage + 1.33 HP | weapon level on equip | opnpc2 / apnpc2 | ammo (`player_ranged.rs2:26-31`) | `%action_delay` attackrate (rapid -1), set BEFORE the grant (`:17-24`) | combat checks | no | 1 per attack interval | 5.4-8.75 knives alone; 11.5 cannon; 22.7 cannon + knives (measured, rs-28 `ranged.md`) | `combat.rs2:156`; `player_ranged.rs2:6` | |
| Magic | Combat spell (splash or hit) | spell base 5.5-90 + 2 per damage | checked (`magic.rs2:22`) | apnpct / opnpct; autocast via opnpc2 | runes; freeze and debuff guards (`player_magic.rs2:114-166`) | `%action_delay` +5 set after the base grant in the same script (`:188`), checked at `:95` | `if_close`, `p_stopaction` | no | 1 per 5 ticks | 18 for a Stun splash; Fire Wave 8.5 + 0.4 per damage (read) | `magic.rs2:109`; `combat.rs2:161`; `player_magic.rs2:95` | Base xp is paid on a splash. |
| Attack | Combat training camp dummy | 50 (6 hits, 300 total) | none | oploc1 | `%biodummy <= 5` (`:50`); not ranged or autocast (`:46`); camp gate needs Biohazard (`:39`) | p_delay(2) AFTER the grant (`:59`) | p_delay drops the next ops | no | 1 per 4 ticks | 12.5 (inferred) | `combat_training_camp.rs2:55`; `:50` | 300 base is level 30 Attack in about 24 ticks. |
| Attack/Strength/Defence | Melee hit | 4 per damage + 1.33 HP | weapon level on equip | opnpc2 / apnpc2 | | `%action_delay` attackrate, set AFTER the grant (`player_melee.rs2:56-60`), checked at `:8` | combat checks | no | 1 per 4 ticks (scimitar) | 9-10 near 99 (measured, rs-28 `combat.md`) | `combat.rs2:146-167`; `player_melee.rs2:8` | Specials share the gate (`player_special_attack.rs2:9-17`). |
| Firemaking + Prayer | Light a funeral pyre (magic pyre logs + Fiyr remains) | 404.5 FM + 100 Prayer (90 shade + 10 bonus) | Firemaking checked when adding logs (`mortton_pyre.rs2:75`) | oplocu logs, oplocu remains, oploc1/oplocu light then oploc4 | shade not above the log tier (`:253-260`); one pyre per player (`%pyre_loc`) | `%action_delay` +3 before the light roll (`:165-176`); then `queue*(funeral_pyre_reward,2)` blocks a new pyre (`:63,104,129,147`) | none | no | 1 pyre per about 7-9 ticks (inferred) | about 50 FM + 12 Prayer (inferred) | `mortton_pyre.rs2:201-202`; `:75`, `:173`, `:63` | FM 50-404.5 by log tier (`flamtaer_pyre.struct:4-64`); shade Prayer 25-90 (`mortton.obj:14-82`). |
| Agility | Agility Arena traps (spikes, pressure pad, saw blades, darts) | 24 / 26 / 28 / 30 | 20 / 20 / 40 / 40, checked (`agilityarena_zones.rs2:117,154,205,265`) | timer (1-tick timer set on entering trap tiles, `:3-26`) | standing on the trap tile; success roll | p_delay(0) before (spikes, pad, saws); darts p_delay(0) + p_delay(6) before | none | no | 1 per trap crossing | about 2.5-7 while crossing (inferred) | `agilityarena_zones.rs2:146,186,236,285` | Traps are sparse; walking dominates. |
| Crafting | Repair Flamtaer temple | resources / 2: 3.5-4.5, up to 35 at Crafting 99 | 20, checked (`flamtaer_temple.rs2:10`) | oploc1 then oploc3 loop | hammer; `%temple_resources >= 100` (800 per plank + 5 paste + brick, `:274-278`); quest stage (`:3`) | `%action_delay` +3 (`:46`) | none | no | 1 per 3 ticks | 1.2-11.7 (inferred) | `flamtaer_temple.rs2:136`; `:10`, `:21-25`, `:56-59` | A failed roll does not return (`:56-59`), so every attempt grants. |
| Agility | Yanille dungeon ledge / pipe | 22.5 / 7.5 | 40 / 49, checked (`agility_dungeon.rs2:31,2`) | oploc1 | start tile; obstacle-in-use vars (`:17-21,53-57`) | p_delay(0) before (`:79`, `:24`) | none | no | 1 per crossing | about 3.7 / 1.5 (inferred) | `agility_dungeon.rs2:82,28` | |
| Ranged | Ranging Guild target shot | points / 2: 0-50 | none | aploc1 | `%targetcount` 1-10 (`target.rs2:9`); 5+ tiles away (`:24`); bow and arrows only enforced near the judge (`:10-23`) | p_delay(2) BEFORE (`:34`) | none | no | 1 per 4 ticks | up to 12.5, about 3-5 typical (inferred) | `target.rs2:42`; `:9`, `:24` | 10 shots per competition. |
| Agility | Agility Arena obstacles (plank to handholds) | 6-22 | handholds 20 (`agilityarena.rs2:223`); others none | oploc1 / aploc1 | arena paid (`:2`) | p_delay(0) chains BEFORE every grant | none | no | 1 per crossing | about 1-2 (inferred) | `agilityarena.rs2:117,179,220,297,328,385,429,471,501` | |
| Fishing | Fishing Trawler reward, per roll | 1.2-115 | 15, checked (`trawler_win.rs2:61`) | oploc1 (net) after the game | `%trawler >= 3`, `%trawler_catch > 0` (`:56`) | p_delay(0) before the loop (`:66`) | modal reward inv | no: catch reset at `:77` | one game per 1,000+ ticks | about 2 solo (inferred: about 20 rolls a game) | `trawler_win.rs2:111-155`; `:56`, `:61`; `trawler_control.rs2:14` | Pool split by players present at the end (see table 2). |
| Firemaking | Light the Flamtaer temple altar | 160 | none | oploc1 / oplocu then oploc3 | tinderbox; sanctity >= 10% (`:178`); quest stage (`:173`) | `%action_delay` +3 (`:183-188`) | none | no | the altar then stays lit 99 ticks (`:232`) | about 1.6 (inferred) | `flamtaer_temple.rs2:233`; `:173`, `:178` | |
| Agility | Karamja dungeon stones, log, pipes | 7.5 / 10 / 10 / 8.5 | 12 / 30 / 34 / 22, checked (`karam_dungeon.rs2:169-170,247,289,319`) | oploc1 | pipe-in-use vars (`:303,333`) | p_arrivedelay + p_delay chains BEFORE | none | no | 1 per crossing | about 1 (inferred) | `karam_dungeon.rs2:200,231,281,311,341` | |
| Ranged + Agility | Gnomeball goal | 0.4-0.7 Ranged per goal; 30 + 30 on the fifth | none | aploc1 (goal) | ball in hand (`gnomeball_shoot.rs2:8`); on the pitch (`:4`) | p_delay(1) BEFORE, p_delay(flight) BEFORE, p_delay(3) after | none | no | 1 shot per about 11 ticks + fetching the ball | under 1 (inferred) | `gnomeball_shoot.rs2:42-45`; `:4-15` | |
| Woodcutting | Cut Kharidian cactus | 10 (0.4 on a fail) | none | oploc1 / oplocu | slashing weapon or knife | none; cactus empties for 100 ticks either way (`:74`) | none | no (one interaction a tick) | 1 per cactus per 100 ticks | about 0.1 per cactus (inferred) | `kharidian_cactus.rs2:67,70`; `:74` | |
| Thieving | Ogre rock-cake stall | 6.5 | 15, checked (`ogre_trader.rs2:22`) | oploc1 | no guard within 3 tiles (`:26`); free slot | none; stall empties 12 ticks (`:38`) | none | no | 1 per 12 ticks | 0.54 (read) | `ogre_trader.rs2:39`; `:22`, `:38` | |
| Crafting | Repair a trawler net | 5 | none | oploc1 | rope; a ripped net | p_delay(0) BEFORE (`trawler_net.rs2:102`) | none | no | one per rip | under 0.1 (inferred) | `trawler_net.rs2:104`; `:73`, `:79` | |
| Attack | Varrock sword dummy | 5 | Attack <= 7, checked (`attack_dummy.rs2:7`) | oploc2 | not ranged or autocast | p_delay(4) AFTER (`:15`) | p_delay drops ops | no | 1 per 6 ticks | 0.8 (read) | `attack_dummy.rs2:12`; `:7` | Attack 8 cap. |
| Fishing / Woodcutting / Mining / Herblore | Miscellania gathering (intercepted) | 0.1 | herblore 35 (`weed_herbs.rs2:15`) | from the skill scripts | inside the kingdom | as the skill | | | | 0.1 per action (read) | `fisherman_frodi.rs2:25`, `lumberjack_leif.rs2:28`, `miner_magnus.rs2:29`, `weed_herbs.rs2:54,92` | **Trap:** replaces the normal grant (`fishing.rs2:52-97`, `woodcut.rs2:177`, `mining.rs2:170`). Never fish, chop maples or mine coal in Miscellania. |
| all | `_test` debugprocs (maxme, addxp, quest cheats) | up to 200m | n/a | debugproc via `::` cheat | staff >= 4 and non-production | | | | 0 for a staff-0 account | 0 | `cheat_maxme.rs2:6-24`; `ClientCheatHandler.ts:57` | Unreachable (section above). |

## Table 2: missing or weak guard

| Grant | Weakness | Evidence | Exploit shape | Label |
|---|---|---|---|---|
| Agility Arena ticket trader | No level check, no delay, no `p_finduid`, no var cap; tickets are stackable and tradeable | `agilityarena_tickettrader.rs2:36-68`; `agilityarena.obj:1-13` (no `tradeable=no`) | Helpers tag pillars (1 ticket per 98-tick pillar move per account, `agilityarena_clerk.rs2:85`, `agilityarena.rs2:53-84`) and trade the tickets over; the main buys Agility 1 -> 99 with 147 tickets in 6 clicks | read (rates); inferred (helper supply) |
| Charge | No delay, no recast guard | `charge.rs2:1-26`, guard commented out `:9-12` | 5 casts a tick | read; measured by rs-28 |
| Pyre-log creation | No delay; no Firemaking level check (only at the pyre, `mortton_pyre.rs2:75`) | `mortton_pyre.rs2:1-42` | 5 creations a tick from Firemaking 1; 666 magic pyre logs to 99 | read; 5 a tick inferred |
| Gnome restaurant hand-in | No Cooking level check; dishes tradeable; delivery chains into the next job; dialogue paced, no delay | `gnome_restaurant.rs2:377-403` | Helpers cook the dishes; the main only delivers, 210 base Cooking per job on average | inferred |
| Fishing Trawler reward | Pool divided by players present at the final tick, though every player in the boat added to it | `trawler_control.rs2:14` (normal), `:50` (half-sunk), `:152-162` (accrual) | Helpers board, then log out before the 1,000th tick (teleports are blocked, `teleport.rs2:131`; relog lands ashore, `trawler.rs2:52-55`); the stayer collects about 20 rolls per helper | inferred; logout during the voyage not verified |
| Flamtaer temple repair | Failed Crafting roll falls through to the grant | `flamtaer_temple.rs2:56-59` (no `return`), grant `:136` | Every 3-tick attempt pays; still capped by the 3-tick delay and resources | read |
| Ranging Guild target | Missing bow or arrows only stops the shot when the judge is within 5 tiles | `target.rs2:10-23` | Shots without a bow or arrows; still 10 per competition | read |
| Combat (all styles) | Xp at roll time, capped by current NPC HP rather than HP net of pending hits | `player_melee.rs2:32`, `player_ranged.rs2:52`, `player_magic.rs2:239` | Overkill xp from several hits in flight; small for one attacker | inferred |
| Magic combat spells | Base xp before the hit roll (splash pays) | `player_magic.rs2:170` | Intended 2004 behaviour; 5-tick gate holds | read |
| Combat camp and Varrock dummies | Grant BEFORE `p_delay` | `combat_training_camp.rs2:55-59`, `attack_dummy.rs2:12-15` | None: the delay drops the next `OPLOC`; camp capped by `%biodummy` (6), Varrock by Attack 8 | read |
| Kharidian cactus | No Woodcutting level check; a fail still pays 0.4 | `kharidian_cactus.rs2:38-74` | Negligible (100-tick respawn) | read |
| Tai Bwo Wannai and Sea Slug rewards | Var set before the grant | `tbwt_*_final.rs2`, `caroline.rs2:42-45` | No bypass found | read |

## Delay-free grants in this slice

No `p_delay`, `p_arrivedelay`, queue or `%action_delay` before or after the grant:

- Agility Arena ticket trader, all five buttons (`agilityarena_tickettrader.rs2:67`), if_button.
- Charge (`charge.rs2:26`), if_button.
- Pyre-log creation (`mortton_pyre.rs2:42`), opheldu.
- Gnome restaurant hand-in (`gnome_restaurant.rs2:402`), dialogue.
- Tai Bwo Wannai rewards and Sea Slug reward (`tbwt_*_final.rs2`, `caroline.rs2:45`), dialogue, once.
- Kharidian cactus (`kharidian_cactus.rs2:67,70`) and the ogre rock-cake stall
  (`ogre_trader.rs2:39`), oploc, throttled only by the loc respawn.

`%action_delay` gates only (not `p_delay`, but re-triggering is refused): combat, temple
repair, temple altar, pyre lighting, Miscellania weeding.

## Candidates worth verifying (the later child's top-ten input)

Current route rates for comparison: melee 9-10, Ranged 11.5-22.7, Magic 900 (Charge),
Firemaking about 59 (157 logs in 650-700 ticks, rs-28 `firemaking.md`), Prayer 34.8
(rs-28 `prayer.md`). rs-28 has no Agility, Cooking or Fishing route doc, so those
candidates are compared against level-1 training cost.

1. **Agility 1 -> 99 from 147 Agility Arena tickets.** One 100-pack, one 25-pack, two
   10-packs and two singles give 39,940 base. That is 6 button clicks, 2 ticks at 5 a tick,
   after opening Jackie's interface (`opnpc3`, one click). Verify: tickets trade between
   accounts, and 5 buys land in one tick. Supply is helper time: 147 tags, each needing a
   consecutive-pillar streak, 1 per 98 ticks per helper. On the main this costs the trip to
   Brimhaven and a trade. Members only (`agilityarena.obj:12`). **Top finding.**
2. **Firemaking from pyre-log creation.** 666 magic pyre logs, 60 base each, no Firemaking
   level, 5 a tick. Inferred about 48 inventories of 14 at 3 ticks of clicks plus a bank
   visit: about 340-430 ticks against the route's 650-700, before the cost of reaching
   `mortton_created_sacred_oil` in Shades of Mort'ton and the oil supply (helpers can make
   oil; it is tradeable). Verify: 5 creations per tick, and the quest stage cost.
3. **Cooking from gnome restaurant hand-ins with helper-made dishes.** 210 base a job on
   average, about 190 jobs to 99, no Cooking level. Verify: dialogue pace (resumes per tick)
   and whether Aluft's opening tutorial jobs (progress 1-6) can be cleared with traded
   dishes.
4. **Fishing Trawler with departing helpers.** About 20 rolls per helper go to whoever stays;
   a manta-capable stayer (81+) averages tens of base per roll. Verify: helpers can log out
   mid-voyage, the 1,000-tick game cost, and any boarding cap (none found in
   `trawler_start.rs2`).
5. **One-off quest rewards in this slice:** Sea Slug 7,175 Fishing (level 74), Tai Bwo
   Wannai Trio 5,000 Fishing + 5,000 Cooking + 2,500 Attack + 2,500 Strength (levels 69 and
   59). Each is worth more than 300 ticks of training in a skill without a fast route; the
   question for the route owner is the quest's tick cost, not the claim.
6. **Combat camp dummy** (300 base Attack in about 24 ticks after Biohazard). It is worth
   about 50 ticks of early melee; list it only if Biohazard is already on the route.

No other spell or prayer has Charge's shape, and no combat path grants xp at zero delay.
