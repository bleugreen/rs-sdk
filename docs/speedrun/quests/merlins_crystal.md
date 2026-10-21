# Merlin's Crystal

**About 820 ticks (about 4 minutes at 300 ms) at 70/70/70 melee, for 6 quest points
and no xp.** The quest is worth doing only as the gate to Holy Grail and for its
quest points toward Dragon Slayer's 32. Half of its playtime is travel between
five far-apart sites (Camelot, the Catherby crate, Taverley, Port Sarim and the
Wilderness chaos altar); the Sir Mordred fight is about 40 ticks.

All ticks are stock-client figures, using `primitives.md`'s measured values where
this document did not measure a segment itself. Lab runs used `NODE_TICKRATE=100`;
every figure is in server ticks, so it carries over to 300 ms, except that fight
loops (eating, re-attacking) react within a tick at either rate (see Open questions).

## Reward

- 6 quest points (read, `general/configs/quest.constant:73`, `^arthur_questpoints`).
- No xp. The completion queue only sets `%arthur` to 7 and shows the scroll
  (read, `quest_arthur.rs2:273-276`).
- Unlocks Holy Grail: King Arthur starts it only at `%arthur` = 7 (read,
  `king_arthur.rs2:41-45`). It also leaves you with Excalibur.

## Requirements (as this server enforces them)

- **No quest or skill requirement.** No script in `quests/quest_arthur/` or in the
  NPC scripts it uses calls `stat()` or `stat_base()` (read, grep over
  `quest_arthur`, `area_camelot`, `area_catherby`, `area_taverly`, `area_entrana`
  and `brother_galahad.rs2`).
- **Members world.** Only the jeweller's ladder checks `map_members`
  (`quest_arthur.rs2:230`); that ladder is not on the route. The lab ran as members.
- **Items the steps check**: a bucket of wax for the black candle
  (`candle_maker.rs2:4`), bread for the beggar (`beggar.rs2:24`), a lit black
  candle and bat bones at the magic symbol (`quest_arthur.rs2:150-152`), and
  Excalibur used on the crystal (`quest_arthur.rs2:248-250`). Excalibur is *used*
  on the crystal, not wielded, so its 20 Attack wield requirement does not apply
  here.
- **Combat**: Sir Mordred must be fought to his death trigger (below). There is no
  level check, only the fight.

## Items: helper-supplied and scored-account-only

Tradeability is read from each obj config (`tradeable=no` means untradeable).

| Item | Tradeable | Source for the run |
|---|---|---|
| Bread | yes (`dough.obj`) | helper |
| Bucket of wax | yes (`area_seers/configs/bees.obj`) | helper |
| Tinderbox | yes (`firemaking.obj`) | helper |
| Bat bones | yes (`skill_prayer/configs/bones.obj`) | helper |
| Black candle (unlit) and lit black candle | **no** (`quest_arthur.obj`) | scored account: the candle maker gives it in exchange for the wax, then a tinderbox lights it |
| Excalibur | **no** (`quest_arthur.obj`) | scored account: the beggar (Lady of the Lake) gives it |
| Combat gear, food, runes (Camelot and Falador teleports), a charged amulet of glory | yes | helper |

One trade (9 ticks, `primitives.md` §6) carries everything: bread, bucket of wax,
tinderbox, bat bones, swordfish, 2 Camelot and 1 Falador teleport worth of runes,
and a glory with at least 2 charges (Draynor Village and Edgeville).

## Step list

Quest varp `%arthur` (perm), stages from `quest_arthur.constant`: 0 not started, 1
started, 2 spoken to Gawain, 3 spoken to Lancelot, 4 spoken to Morgan Le Faye, 5
Excalibur bound, 6 Merlin freed, 7 complete. The bitfield
`%excalibur_components_progress` (perm) tracks the chaos altar (bit 0), the
candle (bit 1) and the Excalibur test (bits 2-4).

"Measured" dialogue ticks run from the talk-to (or loc) click to the dialogue
closing, with the bot clicking each page as soon as it shows; they are consistent
with `primitives.md` §1 (2 ticks per page or option click). Travel rows give route
tiles from `quest-arthur-grail-routes.ts` at 0.5 ticks per tile + 1.

| # | Where | Action | Varp | Raw counts | Ticks | Label |
|---|---|---|---|---|---|---|
| 1 | anywhere → Camelot | Camelot teleport (Magic 45), run 34 tiles to King Arthur (2764,3515) | | 1 teleport, 34 tiles, 2 doors open in the castle | 4 + 18 = **22** | measured teleport (`primitives.md`), inferred route |
| 2 | King Arthur | Talk; "I want to become a Knight of the Round Table!" | 0 → 1 | 8 pages, 1 option | **22** | measured, `quest-merlins-crystal-segments.ts camelot` |
| 3 | → Sir Gawain (2763,3506) | Run 5 tiles | | 5 tiles | **4** | inferred |
| 4 | Sir Gawain | "Do you know how Merlin got trapped?", then "Thank you for the information." | 1 → 2 | 7 pages, 2 options | **24** | measured, same script |
| 5 | → Sir Lancelot (2759,3515, floor 1) | Run 11 tiles to the hall staircase (2750,3510), climb, run 26 tiles | | 37 tiles, 1 climb | 7 + 2 + 14 = **23** | inferred |
| 6 | Sir Lancelot | "Any ideas on how to get into Morgan Le Faye's stronghold?" (offered only at `%arthur` = 2, `sir_lancelot.rs2:15`) | 2 → 3 | 6 pages, 1 option | **16** | measured, same script |
| 7 | → Catherby crate (2801,3442) | Camelot teleport from upstairs, run 54 tiles (walking down and out is 83 tiles, 43 ticks) | | 1 teleport, 54 tiles | 4 + 28 = **32** | inferred |
| 8 | Crate (`merlincrate_empty`) | Hide-in, "Yes.", 20 message pages of the voyage, "Yes." to climb out; lands at (2778,3401) inside the keep | `%arhein_crate_coord` | 22 pages, 2 options, no `p_delay` | **51** (click to landed) | measured, same script `crate` |
| 9 | Keep | Up two staircases to Sir Mordred's floor (2769,3401, floor 2) | | 2 climbs, about 15 tiles | **17** (16-22, n=5) | measured, `quest-merlins-crystal-mordred.ts` |
| 10 | Sir Mordred | Fight to his death trigger; Morgan Le Faye appears and talks | | fight | **40** median at 70/70/70 (see Fights) | measured, same script |
| 11 | Morgan Le Faye | "Tell me how to untrap Merlin and I might.", then "OK I will go do all that." | 3 → 4 | 12 pages, 2 options | **28** | measured, same script |
| 12 | Keep → candle maker (2800,3439) | Down two staircases, out of the front door (one-way from inside), run 66 tiles | | 2 climbs, 1 door, 66 tiles | 13-14 + 8-9 + 39-41 = **61** | measured, same script (the walk uses `bot.walkTo`) |
| 13 | Candle maker | "Have you got any black candles?"; talk again to exchange the bucket of wax; use the tinderbox on the black candle | bit 1 set, then cleared | 12 pages, 1 option, 1 item-on-item | 31 + 8 + 2 = **41** | measured, same script `candle` |
| 14 | → Lady of the Lake (2924,3405) | Falador teleport (Magic 37), run 129 tiles (walking from Catherby is 317 tiles, 160 ticks) | | 1 teleport, 129 tiles | 4 + 66 = **70** | inferred |
| 15 | Lady of the Lake | "I seek the sword Excalibur." | bit 2 set | 9 pages, 1 option | **22** | measured, same script `lady` |
| 16 | → Port Sarim jeweller's door (3016,3246) | Glory to Draynor Village, run 105 tiles (Falador teleport: 153 tiles, 82 ticks) | | 1 glory, 105 tiles | 6 + 54 = **60** | inferred |
| 17 | Jeweller's door | Open it: the beggar spawns and talks; "Yes certainly." with bread; he turns into the Lady and hands over Excalibur | bit 4 set | 8 pages, 1 option | **20** | measured, same script `beggar` |
| 18 | → chaos altar (3239,3608), Wilderness level 12 | Glory to Edgeville, run 204 tiles (Varrock teleport: 255 tiles, 133 ticks) | | 1 glory, 204 tiles | 6 + 103 = **109** | inferred |
| 19 | Chaos altar (`thrantaxaltar`) | Check: the inscription | bit 0 set | 1 page | **6** | measured, same script `altar` |
| 20 | → Camelot magic symbol (2780,3515) | Camelot teleport (allowed up to Wilderness level 20), run 50 tiles | | 1 teleport, 50 tiles | 4 + 26 = **30** | inferred |
| 21 | Magic symbol | Drop bat bones within 1 tile of the symbol, holding the lit candle; Thrantax appears; pick "Snarthon Candtrick Termanto" (the three options are shuffled each time, `quest_arthur.rs2:164-170`) | 4 → 5 | 10 pages, 1 option | **26** | measured, same script `thrantax` |
| 22 | → giant crystal (2767,3493, floor 2) | Run 77 tiles round to the tower ladder (2769,3493), climb, 3 tiles, climb (2767,3491) | | 80 tiles, 2 climbs | 40 + 2 + 3 + 2 + 2 = **49** | inferred |
| 23 | Giant crystal | Use Excalibur on it | 5 → 6 | 4 pages | **11** | measured, same script `crystal` |
| 24 | → King Arthur | Two ladders down, run 20 tiles | | 23 tiles, 2 climbs | **18** | inferred |
| 25 | King Arthur | Talk: "I have freed Merlin from his crystal!" | 6 → 7 | 2 pages | **6** | measured, same script `reward` |

What the order is free to change: steps 13-21 all need `%arthur` = 4 (the altar,
the candle and the summoning check for exactly 4; the Lady checks at least 4), so
none can move before the keep. Their order is set by travel. The Lady must come
before the jeweller's door, which only spawns the beggar once bit 2 is set
(`quest_arthur.rs2:216`).

## Fights

**Sir Mordred** (read, `keep_le_faye.npc`): combat level 39, 38 hitpoints,
attack/strength/defence 33, slash attacks, defence bonuses stab 99, slash 82,
**crush 45**. His death trigger (`ai_queue3`, `sir_mordred.rs2:7-14`) heals him to
full and opens Morgan Le Faye's dialogue instead of killing him, if the player
is the one he is fighting and `%arthur` is between 3 and 6.

Measured with `quest-merlins-crystal-mordred.ts` (rune scimitar on aggressive,
rune full helm, chainbody, platelegs and kiteshield, amulet of strength), attack
click to Morgan's dialogue:

| Stats | Ticks per run | Median | Food | Level-up dialogues |
|---|---|---|---|---|
| 70/70/70, 70 hp | 25, 40, 76, 44, 36, 40, 60 | **40** (mean 46) | none; lowest hp 65 | none |
| 40/40/40, 40 hp | 68, 200; one run failed (below) | about 70-200 | none; lowest hp 31 | 2-5 per fight |

At 40 stats the 25x xp produces a level-up dialogue every few hits, and each one
interrupts the fight until it is dismissed and the attack is clicked again.
40/40/40 is safe (never below 31 of 40 hp). A crush weapon should be faster
than the scimitar, because his crush defence (45) is about half his slash
defence (82) (inferred; not measured).

## Tick total

| Part | Ticks | Basis |
|---|---|---|
| Travel (steps 1, 3, 5, 7, 9, 12, 14, 16, 18, 20, 22, 24) | 495 | measured where the step says so, otherwise route tiles at 0.5/tile + 1 |
| Dialogue (113 page and option clicks at 2 ticks) | 226 | measured (the step totals), consistent with `primitives.md` |
| Interactions (talk-to approaches, loc clicks, the candle, the bones) | 47 | measured: step totals minus the dialogue clicks |
| Fight (Sir Mordred, 70/70/70) | 40-46 | measured |
| Forced waits | 0 | read: the crate ride is message pages only; no step has a `p_delay` beyond those inside the measured totals |
| Trade (one helper trade) | 9 | measured, `primitives.md` §6 |
| **Total** | **about 820** | |

With the client fix cairn://p/rs/22 (1 tick per page), the dialogue drops to
about 113 and the total to about 710.

## Risks and gotchas

- **Morgan Le Faye's interrupt can be missed.** The death trigger only branches
  to her if `p_finduid` succeeds, and the script's own comment says it fails if
  the player is delayed (`sir_mordred.rs2:10`). Then Mordred simply dies
  (`npc_default_death`), `%arthur` stays 3, and you wait out his 50-tick respawn
  (`respawnrate=50`) and fight again. Seen once in three runs at 40/40/40, where
  level-ups were frequent; never at 70/70/70 (n=7).
- **Level-up dialogues interrupt combat** at 25x xp; a fight loop must dismiss
  them and re-attack. It must not dismiss Morgan's dialogue by mistake, which
  costs the whole interrupt (it happened in one lab run).
- **The keep is hostile.** Renegade knights killed a level-3 lab account during
  exploration; at 70 combat they did not engage on the measured path.
- **The chaos altar is in the Wilderness** (level 12, `wilderness_levels.rs2`
  formula in `primitives.md` §4). Teleports out still work there.
- **The Thrantax words are shuffled.** A wrong choice costs the lit candle and
  sets Thrantax (combat level 92, 80 hitpoints) on you (`quest_arthur.rs2:172-200`);
  a new candle needs another bucket of wax. Pick by text, never by position.
- **Drop the bat bones with a raw drop.** The quest intercepts the drop
  (`opheld5`), so an SDK helper that waits for the item to land on the ground
  hangs.
- **Logout-safe.** `%arthur`, `%excalibur_components_progress` and
  `%arhein_crate_coord` are all `scope=perm` (`quest_arthur.varp`), so the quest
  can be split across sessions anywhere. Only short-lived spawns (Morgan,
  Thrantax, the beggar) vanish, and their steps recreate them.
- **Losing Excalibur** is recoverable: the Lady sells it back for 500 coins once
  `%arthur` > 5 (`lady_of_the_lake.rs2:20-35`).

## Open questions

- Fight loops were timed at a 100 ms tick. Eating and re-attacking react within
  one tick at 100 ms and should within one tick at 300 ms as well, but the
  Mordred figures were not re-run at 300 ms.
- Not tried: the second crate at (2722,3492, floor 1, near Seers' Village; same
  `merlincrate_empty` loc and the same ride), which could beat the Catherby crate
  from a Camelot teleport; and the keep's return crate (2779,3401, floor 1) as an
  alternative to walking out.
- Crush weapons against Mordred (inferred faster, not measured).
- The interior legs inside Camelot (steps 5, 22, 24) are route figures, not
  measured walks.

## Scripts

- `docs/speedrun/scripts/quest-merlins-crystal-segments.ts <bot> [segment...]`:
  every non-fight segment (camelot, crate, candle, lady, beggar, altar, thrantax,
  crystal, reward), each from standing next to its NPC or loc.
- `docs/speedrun/scripts/quest-merlins-crystal-mordred.ts <bot> [att str def hp] [weapon]`:
  the keep, from the crate's landing tile to the candle maker, including the fight.
- `docs/speedrun/scripts/quest-arthur-grail-routes.ts`: route tiles for every
  travel leg in this document and in `holy_grail.md` (offline; no server needed).
- `docs/speedrun/scripts/quest-lab.ts`: shared helpers (dialogue driver that
  counts pages and clicks, staff commands, level-up handling).
