# Engine sweep C: quest xp census and quest-reward reachability

Part of the rs/61 engine sweep (cairn://p/rs/61). Scope: the 192 `stat_advance(` calls under
`server/content/scripts/quests/**`, plus the quest rewards that live outside that tree (Sea
Slug's in `areas/area_ardougne_east/scripts/caroline.rs2`, Tai Bwo Wannai Trio's three in
`areas/area_karamja/scripts/tbwt_*_final.rs2`). Every route-tick figure comes from the rs/3
quest plan (`docs/speedrun/quests/README.md` on `agent/rs-3-coordinator-0`, section 3, fixed
column) unless marked otherwise. All xp is **base** xp: the `stat_advance` argument divided by 10
(the server multiplies by 25; 99 is 39,938).

Labels: **r** read (a script or engine line, cited), **i** inferred (basis given). No lab runs
were made for this page. The later verification child should check the items marked *verify*.

## Headline

**No candidate worth more than ~300 route ticks.** Every quest reward is reachable only by its
quest's last step, and none can be granted twice. The reasons, in order of how much they
cover:

1. **Queued rewards cannot be double-granted (r, engine).** 46 of the 58 one-off quest
   reward events (Ikov's two endings counted separately) are `[queue,...]` scripts, and all
   but two of those set the completion varp themselves. Priest in Peril uses an essence
   counter, and Gertrude's Cat sets the varp at the caller (table 2b). The 12 direct grants
   set the varp in the same uninterrupted script segment as the grant. A normal `queue()` runs only when the player can be accessed (no modal, not
   delayed), any op packet closes the modal, and queues run before interactions in the
   player's turn. So the reward always lands before a second trigger could reach the
   `queue()` call again. Details are in [Why queued rewards are single-shot](#why-queued-rewards-are-single-shot).
2. **No reward is granted before a pause with its varp set after the pause.** I checked
   every direct (non-queued) grant: Daero, Radimus, Irena, the Observatory, Lubufu, the three
   Tai Bwo Wannai finals, Caroline, the Haunted Mine crystal, the Watchtower lever and the
   Mort'ton apothecary. Each one either sets the varp first or has no pause between the grant
   and the varp write (table 2).
3. **Final-step guards are exact stages or untradeable items.** I checked every final trigger
   that tests only "not complete" plus holding an item: Waterfall's chalice, Witch's House's
   ball, Scorpion Catcher's cage, Knight's Sword, Tribal Totem, Holy Grail, Heroes', Elemental
   Workshop and Shilo Village. All of those items are `tradeable=no` (table 3). The single
   exception is Imp Catcher's beads, worth 875 Magic.
4. **The two open shortcut questions in rs/3's documents close on reading.** The Karamja-side
   Crandor wall cannot be opened before `%dragon_wall` is set, and Elvarg's lair gates refuse
   entry below stage 9; both were resolved from the map files ([finding 1](#1-dragon-slayer-no-on-foot-route-to-elvarg-closes-rs3s-open-question)).
   Monkey Madness's chapter-skip squares are entered only through the real chapter triggers
   ([finding 2](#2-monkey-madness-the-login-chapter-completion-is-the-only-skip)).

What the sweep did turn up, all small or off-route:

- **Tai Bwo Wannai Trio is missing from the rs/3 plan.** It gives 6,500 Fishing, 5,000
  Cooking, 2,500 Attack and 2,500 Strength (16,500 base, r). Only the Fishing counts on this
  route, and the quest needs Jungle Potion plus four sub-chains, so it is almost certainly off.
  It should still get a row ([finding 4](#4-tai-bwo-wannai-trio-unvalued-16500-base-xp)).
- **The Observatory's constellation can be rerolled** before the reward dialogue, so its 875
  bonus can be steered into Defence or Hitpoints ([finding 5](#5-observatory-reroll-the-875-bonus-into-defence-or-hitpoints)).
- **The only repeatable quest grants are tiny.** Ape Atoll stalls (21 or 10 per steal, one
  stall cycle per 65 ticks), zoo-monkey releases (2 × base Thieving level per Karamja round
  trip), ghast kills (30 Prayer each), and agility and crafting steps worth under 25 each.
  None comes near a training method (table 2).

## Why queued rewards are single-shot

All **r**:

- `queue(script, 0, 0)` adds a NORMAL request (`Player.ts:898-907`). `processQueue` runs a
  request only if `canAccess()` (`Player.ts:961`). That needs not `protect` and not `busy()`,
  and `busy()` is `delayed` or a main or chat modal open (`Player.ts:873-888`).
- In the player's turn, queues run before interactions (`World.ts:783-801`: resume suspended
  script, `processQueues`, timers, engine queue, then `processInteraction`). An interaction also
  needs `canAccess()` (`Player.ts:1218`).
- Every op packet calls `clearPendingAction()`, which closes the modal (`OpNpcHandler.ts:47`,
  `OpLocHandler.ts:53`, `OpHeldHandler.ts:54-56`; `Player.ts:1027-1030`). Closing the modal
  discards a script suspended on a dialogue page (`Player.ts:832-835`). Op packets are refused
  outright while `delayed` (`OpNpcHandler.ts:16-20`, `OpHeldHandler.ts:16-19`).
- Dialogue continues and choices resume the script inside packet processing
  (`ResumePauseButtonHandler.ts:20`), up to 5 per tick. They cannot start a new trigger.

Consequence: suppose a trigger reaches `queue(x_complete)` and the dialogue then continues.
The reward waits while the chat is open. The only way to re-enter the trigger is a new op
packet. That packet closes the chat, so the reward runs at the next `processQueues`, before
`processInteraction` can run the trigger again, and the trigger then sees the completed varp.
Two packets in one tick do not help, because interactions run at most once per player per
tick, after the queue. The one queued reward with a delay, Vampire Slayer's
`queue(quest_vampire_complete, 3, 0)` (`count_draynor.rs2:79`), is guarded by
`%vampire < ^vampire_complete` at the call (`:78`). Re-entering it would need a second stake
kill of Count Draynor inside 3 ticks, and the Count is already dying (`npc_queue(4,...)`,
`:77`) (i).

A reward script that is **not** queued and grants xp **before** a pause, with the varp set
**after** the pause, could be double-granted: abandon the dialogue after the grant and
re-enter. None exists in this tree (table 2, column "Delay").

## 1. Quest xp rows, sorted by base xp

One row per reward event. Multi-skill rewards list the split in the Action column; "Base xp per
action" is the total. "Base xp per tick" is the total over the quest's **fixed-client route
ticks** from the rs/3 README section 3, whether or not the xp is useful there. "n/c" means rs/3
did not cost the quest. Shorthand used throughout: **Q0** is a queued completion, delay 0. Per
the engine section it runs AFTER the dialogue closes or at the next op packet, and it is
single-shot.

| Skill | Action (quest: reward or step) | Base xp per action | Level req (checked? where) | Trigger | Item / location guards | Delay: kind and BEFORE or AFTER the grant | Busy/interface guard | Re-triggerable within a tick? | Actions per tick (max) | Base xp per tick | Source file:line (grant) + file:line (guard) | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Str 35,000, HP 35,000, Att 20,000, Def 20,000 (option 1; option 2 swaps them) | Monkey Madness: Daero's training | 110,000 | none | opnpc1 Daero → p_choice2 (`mm_daero.rs2:252`) | `%mm_main = ^mm_complete` (`mm_daero.rs2:16`) | p_delay ×~15 (fade, "several hours later") BEFORE; varp set `:293` immediately before the grants | delayed throughout, so ops are refused | no: varp set before the grant, no pause after | 1 | 28.5 (3,865 success) | `mm_daero.rs2:294-307` + `:16`, `:293` | on route. One reward, chosen once |
| Str 18,650, Def 18,650 | Dragon Slayer: Elvarg's death | 37,300 | none (32 QP at the Guildmaster, per rs/3) | ai_queue3 Elvarg death → Q0 | `%dragonquest < ^dragon_complete` only (`elvarg.rs2:13`), plus last-hit credit (`:5-10`); the lair needs stage 9 (finding 1) | Q0; varp `quest_dragon.rs2:32` before the grants | queue | no | 1 | 36.9 (1,010; + 546 filler for Package B) | `quest_dragon.rs2:33-34` + `elvarg.rs2:13` | Package B candidate |
| Att/Def/Str/HP/Prayer/Magic/WC/Craft/Smith/Herb/Agi/Thv: 4 picks of 7,650 | Legends' Quest: Radimus' training | 30,600 | Legends steps check `stat()` (e.g. `quest_legends.rs2:327,414,457,524`) | opnpc1 Radimus → p_choice4 menus | `%legendsquest` from `^legends_returned_to_radimus` to below `^legends_radimus_training_4` (`radimus_erkle.rs2:6,10,74`) | none; varp `+5` (`:121`) set BEFORE each grant (`:122`), same segment | dialogue | no: 4 picks by design, each atomic with its varp step | 1 per choice | 1.4 (~22,500) | `radimus_erkle.rs2:122` + `:74,121` | off |
| Att/Def/Str/HP 3,075 each, Rng 2,075, Fish 2,725, Cook 2,825, WC/FM 1,575, Smith 2,275, Mine 2,575, Herb 1,325 | Heroes' Quest | 29,250 | `has_hero_quest_requirements` (`quest_hero.rs2:1-3`) | opnpc Achietties → Q0 | hot feather, lava eel, thief armband, all untradeable (table 3) (`achietties.rs2:12`) | Q0; varp `quest_hero.rs2:28` before | queue | no | 1 | ~9.8 (~3,000 i) | `quest_hero.rs2:29-40` + `achietties.rs2:6,12` | off |
| Att 18,400, Agi 7,900, Mag 2,150 | The Grand Tree | 28,450 | Agility `stat()` < 25 at the climb (`quest_grandtree.rs2:25`), boostable | opnpc1 Narnode → Q0 | case `^grandtree_searching_daconia` + Daconia rock (untradeable) (`king_narnode.rs2:15,17`) | Q0; varp `quest_grandtree.rs2:198` before | queue | no | 1 | 17.1 (1,660) | `quest_grandtree.rs2:199-201` + `king_narnode.rs2:15-35` | on route |
| 10 skills × 2,812.4 | The Fremennik Trials | 28,124 | step checks: WC 40, Craft 40, Fletch 25, `stat()` (`viking_olaf.rs2:148,175,230`) | opnpc1 Brundt → Q0 | 7 council votes (`viking_brundt.rs2:25-28`) | Q0; grants BEFORE varp `quest_viking.rs2:145`, same queue segment, no pause | queue | no | 1 | 10.7 (2,640) | `quest_viking.rs2:135-144` + `viking_brundt.rs2:25` | off |
| Att 13,750, Str 13,750 | Waterfall: urn on the chalice | 27,500 | none | oplocu chalice → Q0 | not complete + full urn (`quest_waterfall.rs2:461-462`); the chalice room is reached only via the statue at stage 6 → 8 (`:414,425`) or the key door at ≥ 8 (`:399`) | p_delay(0) + p_delay(2) BEFORE the queue call (`:472-474`), Q0; varp `:487` before | queue | no | 1 | 31.0 (888) | `quest_waterfall.rs2:491-492` + `:462,414` | on route (conditional) |
| Prayer 11,000, Def 15,300 | Holy Grail | 26,300 | none read | opnpc1 King Arthur → Q0 | Grail (untradeable) and `%grail = ^grail_given_whistle` (`king_arthur.rs2:28`) | Q0; varp `quest_grail.rs2:114` before | queue | no | 1 | 22.8 (1,152) | `quest_grail.rs2:116-117` + `king_arthur.rs2:28` | off |
| Str 22,000 | Haunted Mine: cut a crystal | 22,000 | none | oploc1 or chisel on crystal (`hauntedmine_crystals.rs2:31-33,59`) | `%hauntedmine = ^hauntedmine_rewarddoor_found` (`:52`) | none; varp `:53` set BEFORE the grant `:54`, not queued | none needed: the varp flips in the same segment | no | 1 | 20.5 (1,072 success; 3,700+ expected) | `hauntedmine_crystals.rs2:54` + `:52` | off |
| Rng 10,500, Fletch 8,000 | Temple of Ikov (either ending) | 18,500 | Thieving 42 `stat()` gate in the dungeon (`ikov_dungeon.rs2:158`) | Lucien killed (`lucien.rs2:109-120`) or staff handed over (`lucien.rs2:34-43`) → Q0 | `%ikov = ^ikov_helping_armadyl` (`:109`) or `^ikov_paid_winelda` + staff (`:34`) | Q0; varp `quest_ikov.rs2:61` or `:71` before | queue | no | 1 | 24.7 (~750 i) | `quest_ikov.rs2:62-63, 73-74` + `lucien.rs2:28,109` | off. Both endings reachable, but each sets a terminal varp (`:61`,`:71`) and the other trigger refuses it (`lucien.rs2:28`) |
| Mining 15,300, Herb 2,000 | The Dig Site | 17,300 | none at the reward | opnpcu expert with talisman → Q0 | talisman untradeable; bit `^itexam_bit_shown_ancient_symbol` (`arcaeological_expert.rs2:68-69,89`) | Q0; varp `quest_itexam.rs2:40` before | queue | no | 1 | 9.0 (1,930) | `quest_itexam.rs2:41-42` + `arcaeological_expert.rs2:89-102` | off |
| Fishing 5,000 / Cooking 5,000 / Att 2,500 + Str 2,500 / Fishing 1,500 | **Tai Bwo Wannai Trio**: Tiadeche, Tinsay, Tamayu finals; Lubufu's lesson | 16,500 | sub-chains need Fishing for karambwanji, Agility for Tamayu, Herblore and Cooking items (i, not read) | opnpc1 on each `*_final` NPC; Lubufu opnpc1 | each brother's `_complete` stage (`tbwt_tiadeche_final.rs2:3`, `tbwt_tinsay_final.rs2:3`, `tbwt_tamayu_final.rs2:3`); Lubufu `^tbwt_lubufu_became_apprentice` (`tbwt_lubufu.rs2:36`); all start from Timfraku after Jungle Potion (`tbwt_timfraku.rs2:51,131`) | none; varp set BEFORE the grant in the three finals (`:20`, `:15`, `:21`); Lubufu grants (`:365`) then sets varp (`:366`) in the same segment | dialogue | no | 1 each | n/c | `tbwt_tiadeche_final.rs2:21`, `tbwt_tinsay_final.rs2:16`, `tbwt_tamayu_final.rs2:22-23`, `tbwt_lubufu.rs2:365` | **not in the rs/3 plan**, finding 4 |
| Att 12,175, Thv 2,175 | Fight Arena | 14,350 | none | opnpc1 Lady Servil → Q0 | case `^arena_freed_servils` or `^arena_defeated_genkhazard` (`lady_servil.rs2:8`) | Q0; varp **relative** `+2` (`quest_arena.rs2:268`) before | queue | no: one Q0 per trigger, and the varp then leaves both case values | 1 | 18.6 (771) | `quest_arena.rs2:270-271` + `lady_servil.rs2:8-13` | on route. The relative write is safe only because the trigger is single-shot |
| Mag, Str, Rng 4,662 each | Horror from the Deep | 13,986 | none | Dagannoth mother death → Q0 | `%horrorquest = ^horror_defeated_dagjr` (`horror_dagannoth.rs2:223`); in the lighthouse zone (`quest_horror.rs2:486`) | Q0; grants BEFORE varp `:495`, same segment | queue | no | 1 | ~15.5 (~900 i) | `quest_horror.rs2:491-493` + `horror_dagannoth.rs2:223` | off |
| Agility 13,750 | Regicide | 13,750 | none at the reward | opnpc1 King Lathas → Q0 | stage `^regicide_spoken_arianwyn` + Iorwerth message (`king_lathas.rs2:7,10`) | Q0; grant BEFORE varp `quest_regicide.rs2:853`, same segment | queue | no | 1 | 4.5 (3,063) | `quest_regicide.rs2:852` + `king_lathas.rs2:10` | off |
| Smithing 12,725 | The Knight's Sword | 12,725 | Mining 10 shown in the journal only (`squire_journal.rs2:7`, `stat_base`) | opnpc Squire → Q0 | Faladian sword (untradeable) at `^squire_looking_blurite` (`quest_squire.rs2:86-101`) | Q0; varp `:220` before | queue | no | 1 | 15.2 (837) | `quest_squire.rs2:223` + `:86-101` | off |
| Attack 11,450 | Tree Gnome Village | 11,450 | none | opnpc1 King Bolren → Q0 | case `^tree_defeated_warlord` + orbs (untradeable) (`king_bolren.rs2:83,86`) | Q0; varp `quest_tree.rs2:96` before | queue | no | 1 | 12.4 (927) | `quest_tree.rs2:98` + `king_bolren.rs2:83-100` | on route |
| Herblore 11,000 | Eadgar's Ruse | 11,000 | none read | Sanfew dialogue → Q0 | goutweed stage (`sanfew.rs2:158-160`) | Q0; varp `quest_eadgar.rs2:594` before | queue | no | 1 | n/c | `quest_eadgar.rs2:595` + `sanfew.rs2:160` | off |
| Craft 5,000, Smith 5,000 | Elemental Workshop: first elemental shield | 10,000 | Smithing 20 `stat()` (`quest_elemental_workshop.rs2:252`) | elemental bar on workbench → Q0 | completion bit clear (`:267`), shield book, hammer, bar; bar and book untradeable | p_delay(3) BEFORE (`:264`), then +20 Smithing (`:266`) and Q0; bit `:273` | queue | no | 1 | n/c | `quest_elemental_workshop.rs2:274-275` + `:267` | off. The final guard tests only the completion bit, but every input is untradeable |
| Str 4,000, Agi 8,000 | Troll Romance | 12,000 | Agility 28 `stat()` for the sled (`quest_troll_love.rs2:2`) | defeat Ug → Q0 | `ug.rs2:108-116` | Q0; varp `quest_troll_love.rs2:299` before | queue | no | 1 | (chain 2,735 for 3 quests) | `quest_troll_love.rs2:304-305` + `ug.rs2:116` | off |
| Craft 3,000, HP 2,000, Def 2,000 | Nature Spirit | 7,000 | none read | Filliman dialogue → Q0 | `%druidspirit = ^druidspirit_killed_ghast3` (`filliman.rs2:132`) | Q0 then p_delay (`filliman.rs2:140-142`); varp `quest_druidspirit.rs2:422` before | queue | no | 1 | n/c | `quest_druidspirit.rs2:423-425` + `filliman.rs2:132` | off |
| Fishing 7,175 | Sea Slug | 7,175 | Firemaking 30 `stat()` (`quest_seaslug.rs2:43`) | Caroline dialogue | stage chain to `^seaslug_saved_kennith` (`caroline.rs2`, via `caroline_savedkennith`) | none; varp `caroline.rs2:42` set BEFORE the direct grant `:45`, same segment | dialogue | no | 1 | 18.2 (394) | `caroline.rs2:45` + `:42` | on route. The grant is outside `quests/`; the queue at `quest_seaslug.rs2:124` only shows the scroll |
| Str 6,625 | Scorpion Catcher | 6,625 | none read | Thormac dialogue → Q0 | any started stage + full cage (untradeable) (`thormac.rs2:5,65`) | Q0; varp `quest_scorpcatcher.rs2:57` before | queue | no | 1 | n/c | `quest_scorpcatcher.rs2:60` + `thormac.rs2:65` | off |
| HP 6,325 | Witch's House | 6,325 | none | opnpc1 boy → Q0 | **any started stage** + ball (untradeable) (`boy.rs2:27-28`) | Q0; varp `quest_ball.rs2:200` before | queue | no | 1 | ~38.8 (~163 i, `quest_points.md`) | `quest_ball.rs2:202` + `boy.rs2:28` | no-MM-only candidate. The final step skips the stage check, but the ball cannot be traded |
| Agi 3,000, Att 3,000 | Underground Pass | 6,000 | Thieving 50 `stat()` at a cage (`quest_upass.rs2:248`) | opnpc1 King Lathas → Q0 | case `^upass_defeated_iban` (`king_lathas.rs2:81`) | Q0; varp `quest_upass.rs2:799` before | queue | no | 1 | 2.4 (2,553) | `quest_upass.rs2:800-801` + `king_lathas.rs2:81-87` | off |
| Attack 4,825 | Vampire Slayer | 4,825 | none | stake kill → `queue(...,3,0)` | `%vampire < complete` at the call (`count_draynor.rs2:78`), stake + hammer (`:58-70`) | queue delay 3; grant BEFORE `set_progress` (`quest_vampire.rs2:43`), same segment | queue | no (i, engine section) | 1 | n/c | `quest_vampire.rs2:42` + `count_draynor.rs2:78` | off; Attack is capped anyway |
| Mining 2,425 | Plague City | 2,425 | none | opnpc1 Edmond → Q0 | case `^quest_elena_freed_elena` (`edmond.rs2:38`) | Q0; grant BEFORE `set_progress` `quest_elena.rs2:13`, same segment | queue | no | 1 | 3.9 (620) | `quest_elena.rs2:12` + `edmond.rs2:38-41` | on route |
| Craft 2,250 + one of Str/Def/HP/Att 875 (or items) | Observatory | 2,250-3,125 | none | look through the telescope → `queue(constellation_dialogue)` → dialogue | `%itgronigen` below complete (`quest_itgronigen.rs2:191`); professor within 7 (`:206`) | chatnpc pauses BEFORE; varp `:263` AFTER the grants with no pause between (`:225-263`) | dialogue | no | 1 | n/c | `quest_itgronigen.rs2:225-261` + `:191,263` | off. Rerollable, finding 5 |
| Crafting 3,875 | Shilo Village | 3,875 | crafting steps 15-20, agility 32, `stat()` (`quest_zombiequeen.rs2:390,1254,1285`) | corpse on dolmen → Q0 | `%zombiequeen = ^zombiequeen_retrieved_corpse` (`:1123`) | Q0; varp `:1631` before | queue | no | 1 | n/c | `quest_zombiequeen.rs2:1632` + `:1123` | off |
| Herb 2,000, Craft 2,000 (+ Herb 335 for the diary) | Shades of Mort'ton | 4,335 | Crafting 12 for bricks (`quest_mortton.rs2:76`) | Ulsquire → Q0; diary on the apothecary | `^mortton_lit_pyre` (`ulsquire_shauncy.rs2:106`); diary bit set before its grant (`quest_mortton.rs2:54-55`) | Q0; varp `quest_mortton.rs2:64` before | queue | no | 1 | n/c | `quest_mortton.rs2:65-66, 55` + `ulsquire_shauncy.rs2:106` | off |
| Att/Def/Str/HP/Craft 600 each | In Search of the Myreque | 3,000 | none read | stranger dialogue → Q0 | `^routequest_spoke_to_stranger` (`routequest_vanstorm.rs2:21,33`) | Q0; varp `quest_routequest.rs2:25` before | queue | no | 1 | n/c | `quest_routequest.rs2:26-30` + `routequest_vanstorm.rs2:21` | off |
| Attack 3,000 | Death Plateau | 3,000 | none | Denulth dialogue → Q0 | map + combination bits (`death_ig_commander.rs2:216`) | Q0; varp `quest_death.rs2:218` before | queue | no | 1 | (troll chain) | `quest_death.rs2:221` + `death_ig_commander.rs2:216` | off |
| Fishing 2,437 | Fishing Contest | 2,437 | none | tunnel dwarf → Q0 | `^fishingcompo_won_comp` + trophy (untradeable) (`mountain_dwarf.rs2:93,96`) | Q0; varp `quest_fishingcompo.rs2:109` before | queue | no | 1 | 10.9 (223) | `quest_fishingcompo.rs2:112` + `mountain_dwarf.rs2:93` | on route |
| Fletch 262, Cook 1,470, Rng 735 | Big Chompy Bird Hunting | 2,467 | Cooking 30 at the spit (`raw_chompy.rs2:15`) | hand the chompy to Rantz → Q0 | `rantz.rs2:333-344` | Q0; varp `quest_chompybird.rs2:44` before | queue | no | 1 | n/c | `quest_chompybird.rs2:46-48` + `rantz.rs2:344` | off |
| Woodcutting 2,000 | Monk's Friend | 2,000 | none | party sequence → Q0 | `quest_drunkmonk.rs2:14-42` | Q0; varp `:85` before | queue | no | 1 | 6.2 (325) | `quest_drunkmonk.rs2:89` + `:42` | off |
| Thieving 1,775 | Tribal Totem | 1,775 | none | Kangai Mau → Q0 | totem (untradeable) and `%totemquest = 4` (`kangai_mau.rs2:68`) | Q0; varp `quest_totem.rs2:160` before | queue | no | 1 | 5.9 (300) | `quest_totem.rs2:163` + `kangai_mau.rs2:68` | off |
| Cooking 1,525 | Gertrude's Cat | 1,525 | none | opnpc1 Gertrude → Q0 | case `^fluffs_rescued` (`gertrude.rs2:41`) | varp set `gertrude.rs2:53` BEFORE the queue call `:60`; the queue sets none | queue | no | 1 | n/c | `quest_fluffs.rs2:316` + `gertrude.rs2:53` | off |
| Thieving 1,500 | Hazeel Cult (either side) | 1,500 | none | Hazeel's departure or Ceril's cupboard → Q0 | `^hazeelcult_given_armour_or_scroll` + side (`alomone.rs2:32`, `quest_hazeelcult.rs2:85`) | Q0; varp `quest_hazeelcult.rs2:170` before | queue | no | 1 | 4.6 (325) | `quest_hazeelcult.rs2:172` + `:85` | off |
| Prayer 1,406 | Priest in Peril | 1,406 | none | 50 blank runes to Drezel → Q0 | `%priestperil` counts +1 per essence (`drezel.rs2:95`); the label is reached only at exactly `^priestperil_end_bring_essence` (`:103`) | Q0 sets **no** varp; the counter is the completion | queue | no: the exact-count gate is passed once | 1 | 1.7 (841) | `priestperil.rs2:9` + `drezel.rs2:103` | off |
| Crafting 1,406 | Murder Mystery | 1,406 | none | guard dialogue → Q0 | `murder_guard.rs2:132-152` | Q0; varp `quest_murder.rs2:424` before | queue | no | 1 | n/c | `quest_murder.rs2:428` + `murder_guard.rs2:152` | off |
| Mining 1,300 | Doric's Quest | 1,300 | none | opnpc1 Doric at stage 10, or an item on Doric's anvil with Doric within 5 (`smithing.rs2:59-61`) → Q0 | 6 clay, 4 copper, 2 iron, all tradeable (`quest_doric.rs2:70`) | Q0; varp `:98` before | queue | no | 1 | 20.0 (65) | `quest_doric.rs2:99` + `:70` | on route. Already helper-fed |
| Thieving 1,250 | Biohazard | 1,250 | none | King Lathas → Q0 | `%biohazard = ^biohazard_reported_elena` (`king_lathas.rs2:41`) | Q0; grant BEFORE varp `quest_biohazard.rs2:160`, same segment | queue | no | 1 | 0.9 (1,402) | `quest_biohazard.rs2:159` + `king_lathas.rs2:41` | off |
| Prayer 1,125 | The Restless Ghost | 1,125 | none | skull on the altar → Q0 | `^priest_obtained_skull` (`quest_priest.rs2:54`) | Q0; varp `:95` before | queue | no | 1 | n/c | `quest_priest.rs2:98` + `:54` | off |
| Magic 875 | Imp Catcher | 875 | none | Mizgog → Q0 | `^imp_started` + 4 beads, **tradeable** (`wizard_mizgog.rs2:6,8`; `quest_imp.obj` has no `tradeable=no`) | Q0; varp `quest_imp.rs2:2` before | queue | no | 1 | n/c | `quest_imp.rs2:4` + `wizard_mizgog.rs2:8` | off. Helper beads skip the imp hunt: finding 6 |
| Herblore 775 | Jungle Potion | 775 | none read | Trufitus → Q0 | `trufitus.rs2:421-423` | Q0; varp `quest_junglepotion.rs2:73` before | queue | no | 1 | n/c | `quest_junglepotion.rs2:74` | off; gates Tai Bwo Wannai |
| Crafting 750 | Dwarf Cannon | 750 | none | Lawgof → Q0 | case `^mcannon_return_to_dwarf_commander_with_notes` + mould + notes (untradeable) (`lawgof2.rs2:13,187`) | Q0; varp `quest_mcannon.rs2:24` before | queue | no | 1 | 0.8 (976) | `quest_mcannon.rs2:25` + `lawgof2.rs2:13` | on route for the cannon, not the xp |
| Magic 325 / Cooking 300 / Herb 250 / Craft 200 / Craft 150 | Witch's Potion / Cook's Assistant / Druidic Ritual / Goblin Diplomacy / Sheep Shearer | 150-325 | none | NPC or cauldron → Q0 | stage + items (`quest_hetty.rs2:2`, `quest_cook.rs2:77-85`, `kaqemeex.rs2:85-87`, `quest_gobdip.rs2:52-58,77`, `fred_the_farmer.rs2:81`) | Q0; varp set first in each | queue | no | 1 | n/c | `quest_hetty.rs2:11`, `quest_cook.rs2:89`, `quest_druid.rs2:3`, `quest_gobdip.rs2:62`, `quest_sheep.rs2:5` | QP filler (rs/3 section 7) |
| Ranged 30,000 | Big Chompy Bird: the 4,000th chompy kill | 30,000 | none | chompy death → queue | quest complete; kill counter `== 4000` (`chompy_bird.rs2:205,211`) | queue | queue | no: exact-count gate | 1 | ~0 (4,000 kills, i) | `chompy_bird.rs2:212` + `:211` | off |

## 2. Missing or weak guard

What each rule means for the route. None of these rows is exploitable for more than a few
hundred base xp.

### 2a. Grants with a weak or no quest-varp guard (repeatable or stage-free)

| Skill | Grant | Base xp per action | Guard actually present | Why it does not pay | Source |
|---|---|---|---|---|---|
| Thieving | Ape Atoll stalls: scimitar | 210 | Thieving 65 `stat()`; no greegree; out of combat 10 ticks; Padulah not in line of sight. **No quest varp** | the stall turns into a desk for 65 ticks (`loc_change(mm_desk, $respawn_ticks)`), so 210 per stall per 65 ticks. You must stand on the atoll as a human among aggressive guards. p_delay(0) BEFORE the grant | `aa_market.rs2:14,74-75` |
| Thieving | Ape Atoll stalls: magic / crafting / food / general | 100 / 16 / 16 / 16 | Thieving 65 or 5, as above | respawns 65 or 32 ticks | `aa_market.rs2:2-11,74` |
| Thieving | Release a zoo monkey from your backpack in Karamja | 2 × base Thieving level (198 at 99) | none: pick-up needs only the monkey-speak amulet worn (`mm_zoo_monkey.rs2:6`), no varp | the monkey is untradeable (`quest_mm.obj:1162`), one at a time (`mm_zoo_monkey.rs2:2`), picked up at Ardougne zoo and released only in Karamja map squares (`:96`). A glory and Ardougne-teleport loop is ~60 ticks (i), so ~3.3 per tick at level 99 | `mm_zoo_monkey.rs2:98` |
| Prayer | Ghast killed by you | 30 | kill credit only (`ghast.rs2:88`) | ghasts appear in Mort Myre; one kill is far below bone burying | `ghast.rs2:132` |
| Cooking | Cook a chompy (after the quest) | 14 | Cooking 30 `stat()` | needs a chompy kill per cook | `raw_chompy.rs2:15,80` |
| Ranged | Dwarf multicannon hit | 2 × damage × npc multiplier | cannon placed with balls; target attackable | already on the route (rs/31). Listed because it lives under `quests/` | `cannon_fire.rs2:119` |
| Mining, Fishing | Dig Site panning | 2 + 2 | panning guide's tea bit (`area_digsite.rs2:7`) | p_delay(2)+(1) BEFORE; the tray must be emptied between pans | `area_digsite.rs2:27-28` |
| Mining | Dig Site digging, sites 0-3 | 5 / 6 / 7 / 8 | quest stage per site (`area_digsite.rs2:157,165,173`); gloves, boots, jar and brush | **grant BEFORE p_delay(6)**. It is still 1 per 7 ticks, because ops are refused while delayed | `area_digsite.rs2:200,278,346,437` |
| Thieving | Pickpocket a dig-site workman | 10.4 | Thieving 25 `stat()`, checked AFTER p_delay(2) | stun on failure | `digsite_workman.rs2:62,85` |
| Agility | Yanille hole (Watchtower) | 4 | none: no level, no delay | a one-way teleport into the tunnel; repeating it needs the walk back | `quest_itwatchtower.rs2:449-453` |
| Agility | Troll Romance sled rides | 25 | Agility 28 `stat()`, waxed toboggan worn | each ride is ~30 p_delay(0) walk steps | `quest_troll_love.rs2:2,223,294` |
| Agility | Nature Spirit swamp jump | 15 (2 on a fall) | none | ~4 ticks per jump (i) | `quest_druidspirit.rs2:57,61` |
| Agility, Thieving | Troll Stronghold rocks, Underground Pass pipes and cages, Shilo rocks and bridge, Horror basalt rocks and bridge, Dig Site winches, Watchtower jump | 0.4-10 | Agility 15-32 or Thieving 50 `stat()` where present | under 10 base per action, each with p_delays | `quest_troll.rs2:37-195`, `upass_obstacles.rs2:77,366`, `quest_upass.rs2:236,263`, `quest_zombiequeen.rs2:405-1500`, `basalt_rocks.rs2:33-58`, `quest_horror.rs2:94,108`, `area_digsite.rs2:624,677`, `quest_itwatchtower.rs2:411` |
| Craft, Smith, Herb, Fletch, FM, Mag, Cook | One-off item steps: elemental bar and shield, ogre potion, Dig Site chemicals, lyre steps, Desert Rescue dart and bar bend, Jogre bones, monkey amulet, golden bowl, limestone bricks, ivory beads | 0.1-200 | item consumed per action | each needs a quest item made or held, so none can be repeated freely | as in the census list: `quest_elemental_workshop.rs2:240,266`, `ogre_potion.rs2:52,81,87`, `itexam_chemistry.rs2:35,49,68`, `viking_olaf.rs2:168,184,238`, `quest_desertrescue.rs2:220,226,669`, `tbwt_jogre_bones.rs2:11,20-21,70`, `quest_mm.rs2:1079,1088`, `quest_legends.rs2:442,542,1503`, `quest_mortton.rs2:86,91`, `quest_zombiequeen.rs2:663-1290`, `mcannon_broken_cannon.rs2:70`, `mm_jail.rs2:9` |

### 2b. Completion varp written relative to itself, or not written by the reward

These patterns would multiply a reward if the trigger could be re-entered. It cannot (engine
section), so each is listed only so a later change to the engine's queue rules can be checked
against it.

| Quest | Pattern | Why it holds | Source |
|---|---|---|---|
| Fight Arena | `%arenaquest = calc(%arenaquest + 2)` inside the reward queue | the only trigger is two case values at Lady Servil; after +2 neither matches | `quest_arena.rs2:268`, `lady_servil.rs2:8` |
| Legends' Quest | `%legendsquest = add(%legendsquest, 5)` per pick, 4 picks | set before each grant in the same segment; the menu re-checks the remaining count | `radimus_erkle.rs2:79,121` |
| Tourist Trap | `%desertrescue = calc(%desertrescue + 1)` per pick, 2 picks | p_choice4 → grant → +1 has no pause between; Irena's two `picked_first_skill` branches are duplicates (`irena.rs2:28,31`), both harmless | `irena.rs2:78-93` |
| Priest in Peril | the reward queue sets no varp; completion is the essence counter | the counter only moves forward per essence given, and the label needs the exact end value | `priestperil.rs2:7-11`, `drezel.rs2:95,103` |
| Gertrude's Cat | the reward queue sets no varp | the varp is set at the caller before `queue()` | `gertrude.rs2:53,60` |
| Fremennik, Regicide, Horror, Biohazard, Plague City, Vampire, Observatory, Lubufu | grant before the varp write | the same uninterrupted segment, no pause between | rows in section 1 |
| Watchtower | varp set, then `p_delay(3)`, then the grant | the varp is set first; the delay makes the player unreachable | `quest_itwatchtower.rs2:521,532-533` |

### 2c. Level and skill requirements the reward path does not enforce

- **No quest reward checks a skill level.** Every in-quest skill check is `stat()` at a step
  (boostable), and `stat_base()` appears only in the quest journals (display), e.g.
  `grandtree_journal.rs2:9` against the enforcing `quest_grandtree.rs2:25`, and
  `itwatchtower_journal.rs2:8-28` against `quest_itwatchtower.rs2:2,393,483` (r, grep of
  `stat(`/`stat_base(` in `quests/`). So every quest requirement can be met with a potion or
  stat boost at the step. That matches rs/3's per-quest documents.
- **On-route quests with no skill check anywhere on their path** (r, the same grep): Doric's
  Quest, Plague City, Tree Gnome Village, Waterfall, Fight Arena, Dwarf Cannon and Fishing
  Contest. Monkey Madness's Daero reward has none; its Ranged-50 bow is an item requirement
  (rs/3, `tier50.rs2:6`).
- **Mid-quest grants with no level check**: Yanille hole (above), Ape Atoll stall level
  `stat()` only, zoo-monkey release (none), Dig Site panning (none), Watchtower's jump at
  Agility 25 `stat()`.

## 3. Reachable out of order: findings

Each finding gives the sequence as read; *verify* marks what the later child should confirm
on the local engine.

### 1. Dragon Slayer: no on-foot route to Elvarg (closes rs/3's open question)

`dragon_slayer.md` (rs/3) asks whether the Karamja-side secret wall can be opened before
`%dragon_wall` is set (`crandor.rs2:12-25`). The answer is no (r):

- `dragonsecretdoor` (loc 2606, `pack/loc.pack:2607`) sits at mapsquare 44_150 local (20,0),
  shape 0, angle 3 (south) (`maps/m44_150.jm2:5608`), i.e. absolute (2836,9600) with the wall
  on the tile's south edge. `check_axis_locactive` returns true when the player's z equals the
  loc's z (`door_procs.rs2:90-101`). So `$entering` is true on the Crandor side (z 9600) and
  false on the Karamja-dungeon side (z 9599, mapsquare 44_149). From Karamja the door opens
  only once `%dragon_wall` or completion is set (`crandor.rs2:12-25`).
- Elvarg's gates (2607/2608) are at (2847,9636) and (2847,9637), angle 0 (west)
  (`m44_150.jm2:6233-6234`). Her lair is x ≥ 2847 (`quest_dragon.rs2:27`), so `$entering` is
  true inside the lair. Going in (`$entering` false) is refused unless
  `%dragonquest = ^quest_dragon_sailed_to_crandor` (`crandor.rs2:31-45`), which only Ned's
  voyage sets (`dragonslayer_ned.rs2:22`).

So the reward's loose guard (`%dragonquest < ^dragon_complete`, `elvarg.rs2:13`) is not
reachable early: the ship is mandatory, as rs/3 assumed. *Verify* (cheap): stand at (2836,9599)
with `%dragon_wall` = 0 and op the wall; expect the default "nothing interesting" message.

### 2. Monkey Madness: the login chapter-completion is the only skip

`mm_login` and three walktriggers advance `%mm_main` to `arrived_atoll`, `completed_ch2` or
`completed_ch3` when the player is in, or leaves, the cutscene map squares 0_40_71, 0_41_71
and 1_41_71 (`quest_mm.rs2:10-34, 258-270, 361-372, 489-500`). Those squares are entered only
by the chapter cutscenes, and each is started by a real trigger: Waydar's "convey the human"
dialogue (`mm_waydar.rs2:94`), Zooknock's talisman (`mm_zooknock.rs2:224`, guarded by the
talisman checks `:203-215`), and Garkor once Awowogei's mission is done (`mm_garkor.rs2:128-137`).
So the only gain is the one rs/3 already lists: logging out inside a cutscene completes it on
the next login (README section 6, "worth up to ~150"). Nothing here skips a chapter's
content. No new ticks.

### 3. Waterfall: the stage chain is tight beyond the known book jump

The chalice reward checks only "not complete" plus the urn (`quest_waterfall.rs2:461-462`), but
the chalice room is reached only by the statue (stage 6 → 8, `:414-425`) or the key door at
stage ≥ 8 (`:399`). Stage 6 needs 5 (`:397`), 5 needs 4 (`:269`) and 4 needs 3 (`:120`). The
book sets 3 from any lower stage (`baxtorian_book.rs2:6-8`), but the bookcase gives it only
from stage 2 (`quest_waterfall.rs2:303-305`). The pebble, amulet and urn have no stage check
(`golrie.rs2:10`, `quest_waterfall.rs2:128,146`), but all are untradeable (`waterfall.obj`). This
matches `waterfall.md`'s requirements section; no new ticks.

### 4. Tai Bwo Wannai Trio: unvalued, 16,500 base xp

Not in the rs/3 value table (README section 3) or the skip list. The rewards (r): Tiadeche
5,000 Fishing (`tbwt_tiadeche_final.rs2:21`), Tinsay 5,000 Cooking (`tbwt_tinsay_final.rs2:16`),
Tamayu 2,500 Attack + 2,500 Strength (`tbwt_tamayu_final.rs2:22-23`), Lubufu 1,500 Fishing
(`tbwt_lubufu.rs2:365`). It starts at Timfraku only after Jungle Potion (`tbwt_timfraku.rs2:51,75`).
Each brother's reward is gated on his own `_complete` stage, and every grant sets its varp
in the same segment. On this route only the 6,500 Fishing counts: Cooking is done by wine,
Attack is capped, and Strength is covered by MM option 1 plus Waterfall or Dragon Slayer.

Rough value (i): Sea Slug's 7,175 Fishing replaces ~955 ticks given Fishing Contest (README
row), so 6,500 more Fishing is worth perhaps 500-800 ticks depending on where it lands on the
curve. The cost is Jungle Potion plus four Karamja sub-chains: Tamayu's Shaikahan fight and
agility, Tinsay's banana rum, seaweed sandwich and marinated Jogre bones, Tiadeche's karambwan
and manual, and Lubufu's 20 karambwanji. That is very likely well over 1,500 ticks, so a net
loss. Lubufu's chain alone (1,500 Fishing) still needs Jungle Potion and Timfraku's start
(`tbwt_lubufu.rs2:151-165`). **Recommendation:** add it to rs/3's skip list with this
estimate; do not cost it further unless Fishing becomes the binding skill.

### 5. Observatory: reroll the 875 bonus into Defence or Hitpoints

Each telescope look rolls `random(12)` and queues the reward dialogue with that
constellation (`quest_itgronigen.rs2:187-199`). An op packet before the reward page closes the
dialogue and discards it (engine section), so looking again rerolls (r; the script's own
comment says so, `:196-197`). Four of the twelve give xp (Strength, Defence, Hitpoints,
Attack 875 each, `:225-244`); the rest give items. Expected ~3 looks to land a chosen combat
skill, or ~12 for a specific one. Defence and Hitpoints are the post-MM gaps (README section 6),
but 875 is ~95 ticks of defensive melee at ~9.3/tick. The Observatory itself is not costed by
rs/3 and would need Crafting 2,250 to matter too. Off-route either way (i).

### 6. Imp Catcher with helper beads

The final step tests only `%imp = ^imp_started` and the four beads (`wizard_mizgog.rs2:6-8`),
and the beads are tradeable (no `tradeable=no` in `quest_imp.obj:1-48`). So a run would be:
opnpc1 Mizgog (start), trade 4 beads from a helper, opnpc1 Mizgog again, for 875 Magic and 1
QP. That is about 875 / 26 ≈ 34 ticks of enchanting (rs/28 rate) against the trip to the
Wizards' Tower plus two short dialogues and a trade (~60-100, i). It is relevant only as 1 QP
of Dragon Slayer filler; rs/3 section 7 already prices filler quests.

### 7. Final-step guards that skip stage checks, all blocked by untradeable items

Witch's House (any started stage + ball, `boy.rs2:27-28`), Scorpion Catcher (any started stage
+ cage, `thormac.rs2:5,65`), Elemental Workshop (completion bit only + bar + book,
`quest_elemental_workshop.rs2:247-267`) and Waterfall (above). Their items: ball, full cage,
elemental bar, shield book and full urn are all `tradeable=no` (table 3). No helper shortcut.

### Table 3: tradeability of every item a final step tests

All **r** from the `.obj` configs (an absent `tradeable` line means tradeable,
`ObjType.ts:181`).

| Item | Tradeable | Config |
|---|---|---|
| black/white/yellow/red bead (Imp Catcher) | **yes** | `quest_imp.obj:1-48` |
| clay, copper ore, iron ore (Doric) | yes | standard items |
| raw giant carp (Fishing Contest) | no | `fishing.obj:362` (rs/3 relies on a helper catching it *inside the contest*; see `fishing_contest.md`) |
| ball, full scorpion cage, Faladian sword, tribal totem, Holy Grail, hot feather, lava eel, thief armband, ghost skull, Death Plateau map and combination, Shilo corpse, Daconia rock, orbs of protection, knight's portrait, Hazeel scroll, staff of Armadyl, Elena picture, fishing trophy, ammo mould, Nulodion's notes, karambwanji, Legends totem and map, MM sigil and orders, Glarial's urn, power crystals, Dig Site talisman, seasoned chompy, monkey-speak amulet, enchanted bar, amulet mould, goutweed, serum book, Ana in a barrel, Ardougne scroll, elemental ore and bar, elemental shield book, monkey in backpack | no | `quest_ball.obj:1`, `quest_scorpcatcher.obj:99`, `quest_squire.obj:1,12`, `quest_totem.obj:1`, `quest_grail.obj:62`, `quest_hero.obj:43,69`, `food_cooked.obj:60`, `quest_priest.obj:20`, `quest_death.obj:1,33`, `quest_zombiequeen.obj:81`, `quest_grandtree.obj:149`, `quest_tree.obj:1,13`, `quest_hazeelcult.obj:1`, `quest_ikov.obj:130`, `picture.obj:1`, `quest_fishingcompo.obj:18`, `quest_mcannon.obj:41,54`, `fishing.obj:221`, `quest_legends.obj:20,595`, `quest_mm.obj:696,725,827,841,1150,1178`, `waterfall.obj:59`, `quest_itwatchtower.obj:105`, `quest_itexam.obj:154`, `quest_chompybird.obj:120`, `quest_eadgar.obj:1`, `quest_mortton.obj:1`, `desertrescue.obj:47`, `teleportscroll.obj:1`, `quest_elemental_workshop.obj:1,83,99` |

## Coverage

- All 192 `stat_advance(` calls under `quests/` were mapped to their enclosing label and every
  caller (non-test). The `_test/` cheat scripts (`cheat_quest.rs2`, `debug_quests.rs2`) also
  queue every reward, but they are staff-only and out of bounds (tenet 6).
- Quest rewards outside `quests/`: Sea Slug (`caroline.rs2:45`) and Tai Bwo Wannai Trio
  (`tbwt_*_final.rs2`) were found by a sweep of `areas/` for `stat_advance` near a quest
  varp. Miscellania and the Mort'ton and gnomeball minigame grants belong to sweep B (rs/65).
- Not done: lab verification (left to the later child); a full stage-write audit for
  off-route quests (only the on-route varps `%doricquest`, `%elenaquest`, `%treequest`,
  `%grandtree`, `%waterfall_quest`, `%arenaquest`, `%mcannon`, `%fishingcompo`,
  `%seaslugquest`, `%mm_main`, `%mm_narnode` and `%mm_daero` had every write listed and
  checked for forward jumps; the only ones are Waterfall's book and MM's cutscene-login
  writes, both above).
