# Engine sweep: what guards every xp grant, and what is worth a route change

Deliverable of cairn://p/rs/61 (mechanical audit of every xp grant and item effect by what
guards it). Five section files hold the full census and are linked throughout:

| Section | File | Scope |
|---|---|---|
| A | [`engine-sweep/skills.md`](engine-sweep/skills.md) (rs/64) | 393 rows: every non-combat skill, `general/`, `tutorial/` |
| B | [`engine-sweep/combat-minigames-areas.md`](engine-sweep/combat-minigames-areas.md) (rs/65) | combat, minigames, areas, `_test` |
| C | [`engine-sweep/quests.md`](engine-sweep/quests.md) (rs/66) | 192 quest grants, reward reachability |
| D | [`engine-sweep/engine.md`](engine-sweep/engine.md) (rs/67) | packet budget, delay matrix, overlap paths, known-exploit guards, delay-free census |
| E | [`engine-sweep/economy.md`](engine-sweep/economy.md) (rs/68) | shops, restock, spawns, free sources, helper scaling |

This page (rs/92) merges them, measures the ten leading candidates on the lab, and gives the
verdict. **Server:** LostCity revision 289, the 17 January 2005 client
(`server/content/README.md:2`), not May 2004 as earlier briefs said (rs/59 `lostcity.md` section
1). **Labels:** *read* (source at the cited line), *measured* (lab, section 8 gives script and
host), *inferred* (derived from read code; the basis is named). **Units:** base xp is the
`stat_advance` argument / 10, before the server's 25x (`util/WorldConfig.ts:102`); 99 is 39,938
base. Script paths are under `server/content/scripts/` unless they start with `server/`.

## 1. Verdict

**No candidate in the sweep is worth more than ~300 route ticks, so no verification
sub-issue is spawned.** The reasons, in order of how much they cover:

1. **The route already uses the strong rows.** Every row above ~400 base xp per tick in Table 1
   is either already route canon (Charge, rune arrows and darts, potion mixing, gem cutting,
   wine) or blocked by supply (dragonstones, torstol, dart tips, genie lamps). The delay-free
   item-on-item shape that makes these rows fast (5 effects per tick at the packet cap) is
   the same shape rs/37 already measured for Crafting, Herblore, Fletching and Cooking, so a
   new row of that shape only matters if it beats the current row per action *and* can be
   supplied.
2. **The one row that looked like a jackpot is closed.** The Agility Arena ticket trader has no
   level check, delay or cap (`minigames/game_agilityarena/scripts/agilityarena_tickettrader.rs2:60-68`),
   but tickets are untradeable (`agilityarena.obj:15`): the trade screen refuses them
   (`interface_trade/scripts/trade.rs2:338-341`), a dropped ticket is visible only to its dropper
   (`server/engine/src/engine/script/handlers/InvOps.ts:724-726`) and the GE refuses untradeables
   (`server/engine/src/engine/market/MarketCatalog.ts:4`, `GrandExchange.ts:62`). The scored
   account can only earn its own, one per 98-tick pillar move (`agilityarena_clerk.rs2:78-87`,
   `agilityarena.rs2:53-84`): about 2.9 base xp per tick, below rs/2's Wilderness course (7.4).
   rs/65's "top finding" was wrong as written and is corrected in its file.
3. **Quest rewards cannot be double-granted or reached early** (section C): queued rewards are
   single-shot by the engine's queue rules, every direct grant sets its varp in the same
   segment, and the final-step items are untradeable. The quest-side savings that do exist are
   route shortcuts already measured by rs/59 (the Monkey Madness ladder drop, about 670
   expected ticks, section 6), not xp exploits.
4. **The engine's permissive spots are worth a few ticks per use, not hundreds.** Opening an
   inventory op straight out of the bank, free refused packets, and buttons with no delay check
   (section 5) shave a packet here and there; the route's banked loops gain at most a tick per
   cycle from them.
5. **The fallbacks pay only under a supply failure.** Battlestaves (Crafting) and ugthanki
   kebabs (Cooking) are real, measured fallbacks for when dragonstones or grapes run short;
   the magic potion saves 2-5 ticks in Herblore. None changes the route while supply holds.

**What changes in the route:** nothing structural. The lab (section 8) turns three engine
readings into rules the scripts can rely on, and one economy reading into a helper plan:

- **Over-send freely.** A refused packet does not spend one of the 5 USER slots (measured: 10
  refused buttons ahead of 10 identifies still identify 5 + 5). Blind continues past the last
  page and retries into a delay cost nothing but client-side pacing (#6).
- **Level-ups never stall a delay-free burst.** A 27-gem burst that crossed 31 levels cut at
  exactly the rate of a level-99 control (#4). Only weak-queue Make-X lines stop on a level-up
  (rs/59 `lostcity.md` row 6).
- **Never answer two make-X menus in one tick.** The second completion throws away the first
  one's product and drops every packet for the rest of that tick and the next (#7).
- **Hassan's jug of water costs one tick per jug** on a helper with a blind burst (#9): about
  5,000 jugs per helper-hour including the bank walk, so rs/47's ~520 jugs are a few helper
  minutes.

One engine reading does **not** pay with our client: the server accepts an inventory op with
the bank open, but skipping the close saved 0 ticks per bank cycle (#5), because the lite client
cannot address the withdrawn items until its inventory view updates a tick later.

**Closed leads:** Agility Arena tickets (untradeable); pyre logs (measured and set aside by
rs/28: 5 per tick from Firemaking 1, about 430 ticks to 99 against 650-700 for lines, but they
need most of Shades of Mort'ton, the temple rebuild and about 666 sacred oil(4);
`docs/speedrun/skills/firemaking.md` section 5 on `agent/rs-28-coordinator-0`); Charge beside
a gathering loop (engine.md O3) is already route canon (rs/28 `interleaving.md` rule 5);
genie lamps (random events are off on the demo, `fly.toml:25`, rs/59 `lostcity.md` section 5);
the `_test` cheats (staff level 4 only, section B); the Dragon Slayer wall (section C finding
1, checked on the lab in section 7).

## 2. Table 1: ranked by base xp per tick at the 5-packet cap

Merged from the three census files (A, B, C) in their shared schema: every row at or above 100
base xp per tick, plus the best repeatable row of every skill below that. The five ticket-trader
rows of B are represented by the 1,000-ticket row (the others differ only in the per-ticket
price). No quest row in C reaches 100 base per route tick (C prices each reward over its quest's
route ticks), so C contributes none; its rewards are summarised in section 6. Rates are as the
section files give them ("5 x base" = the delay-free item-on-item cap, *inferred* unless a
sibling measured it); "Sweep verdict" is this page's merge note. Full tables: A Table 1, B Table
1, C section 1.

| # | Skill | Action (product) | Base xp per action | Level req (checked? where) | Trigger | Item / location guards | Delay: kind and BEFORE or AFTER the grant | Busy/interface guard | Re-triggerable within a tick? | Actions per tick (max) | Base xp per tick | Source file:line (grant) + file:line (guard) | Notes | From | Sweep verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Fishing | Sea Slug reward (Caroline) | 7,175 once | quest state only | opnpc1 dialogue | `%seaslugquest` at the saved-Kennith stage | none | dialogue | no: var set before the grant | once | about 2,400 over about 3 claim ticks (inferred) | `caroline.rs2:45`; `:42` | Reaches level 74 from 0. Cost is the Sea Slug quest. | [B](engine-sweep/combat-minigames-areas.md) | On route (rs/3) |
| 2 | Fishing | Tai Bwo Wannai Trio reward (Tiadeche) | 5,000 once | quest state only | opnpc1 dialogue | `%tbwt_tiadeche = complete` | none | dialogue | no: var set first | once | about 1,700 over about 3 claim ticks (inferred) | `tbwt_tiadeche_final.rs2:21`; `:2-4`, `:20` | Level 69 from 0. Cost is the quest. | [B](engine-sweep/combat-minigames-areas.md) | Off route (`quests.md` finding 4) |
| 3 | Cooking | Tai Bwo Wannai Trio reward (Tinsay) | 5,000 once | quest state only | opnpc1 dialogue | `%tbwt_tinsay = complete` | none | dialogue | no | once | about 1,700 (inferred) | `tbwt_tinsay_final.rs2:16`; `:2-4`, `:15` | Level 69. Cost is the quest. | [B](engine-sweep/combat-minigames-areas.md) | Off route (`quests.md` finding 4) |
| 4 | Attack + Strength | Tai Bwo Wannai Trio reward (Tamayu) | 2,500 + 2,500 once | quest state only | opnpc1 dialogue (or opnpc3 redirect) | `%tbwt_tamayu = complete`; also gives the rune spear (kp) | none | dialogue | no | once | about 1,700 combined (inferred) | `tbwt_tamayu_final.rs2:22-23`; `:2-4`, `:21` | Level 59 in each. | [B](engine-sweep/combat-minigames-areas.md) | Off route (`quests.md` finding 4) |
| 5 | Any (genie lamp) | Genie lamp: 10 x the chosen skill's base level | 990 | none; Herblore needs Druidic Ritual, Runecraft needs Rune Mysteries, checked at selection (`xplamp.rs2:83-94`) | opheld1 lamp -> if_button skill -> if_button confirm | macro_genilamp (random-event reward); confirm does not re-check the lamp (`xplamp.rs2:107`) | none | interface must be open; confirm closes it (`xplamp.rs2:106`) | no (3 packets per lamp) | ~1.67 | 1650 (inferred: 5 packets per tick, 3 per lamp, at base level 99) | `xplamp.rs2:111` + `xplamp.rs2:83-94` | supply-limited: lamps only come from the genie random event | [A](engine-sweep/skills.md) | Unreachable on the demo: random events are off (`fly.toml:25`; rs/59 `lostcity.md` section 5) |
| 6 | Fletching | Feather darts: rune_dart x10 | 188 | 81, checked `darts.rs2:34` | opheldu (feather on dart tips) | members; 10 tips + 10 feathers | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 940 (inferred: 5 x base) | `darts.rs2:61` + `darts.rs2:34`; `darts.dbrow:37` | current route option from 81; tips need Tourist Trap on the smithing helper | [A](engine-sweep/skills.md) | Route option from 81 (rs/37 `fletching.md`) |
| 7 | Fletching | Attach arrowtips: rune_arrow x15 | 187.5 | 75, checked `arrows.rs2:64` | opheldu (tips on headless arrows) | members; 15 tips + 15 headless | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 937.5 (inferred: 5 x base) | `arrows.rs2:85` + `arrows.rs2:64`; `arrows.dbrow:41` | current Fletching route from 75 | [A](engine-sweep/skills.md) | Route from 75 (rs/37 `fletching.md`) |
| 8 | Magic | Cast charge | 180 | 80, checked `magic.rs2:22` (boosted level) | opheldt / if_button / oploct by spell | runes (+ target) | no delay, no cooldown | dropped while delayed | yes | 5 | 900 (no delay, no cooldown; measured by rs/28: 5 casts per tick) | `magic.rs2:109` (shared `give_spell_xp`) + `magic.rs2:22`; `magic_spells.dbrow:206` | current Magic route from 80 (KNOWN) | [A](engine-sweep/skills.md) | Route above 80 (rs/28 `magic.md`) |
| 9 | Magic | Charge | 180 | 80, checked (`magic.rs2:22` via `charge.rs2:15`); members | if_button (`magic:charge`) | 3 fire + 3 blood + 3 air (a staff can replace one element, `magic.rs2:53-88`); `%magearena >= staff_given` (`charge.rs2:4`) | none (`settimer(charge,2)` is the buff only) | `p_finduid` (`charge.rs2:3`) | yes | 5 (read; measured by rs-28) | 900 (measured, rs-28 `magic.md`) | `charge.rs2:26`; `:3`, `:4`, `:15` | Recast guard commented out `:9-12`. Already the route above 80. | [B](engine-sweep/combat-minigames-areas.md) | Route above 80 (rs/28 `magic.md`); measured again here (5 + 5) |
| 10 | Herblore | Mix 3dosepotionofzamorak | 175 | 78, checked `brew_potion.rs2:123` | opheldu (secondary on unfinished potion) | members; 1 unf potion + 1 secondary | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 875 (inferred: 5 x base) | `herblore.rs2:24` (via `brew_potion.rs2:146`) + `brew_potion.rs2:123`; `brew_potion.struct:199` | current Herblore route band (rs/37) | [A](engine-sweep/skills.md) | Route band 78-99 only if torstol is supplied (rs/37 `herblore.md`: effectively unobtainable) |
| 11 | Herblore | Mix 3dose1magic | 172.5 | 76, checked `brew_potion.rs2:123` | opheldu (secondary on unfinished potion) | members; 1 unf potion + 1 secondary | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 862.5 (inferred: 5 x base) | `herblore.rs2:24` (via `brew_potion.rs2:146`) + `brew_potion.rs2:123`; `brew_potion.struct:278` | CANDIDATE: 172.5 at 76 sits between ranging and Zamorak | [A](engine-sweep/skills.md) | Top ten #8: measured, worth 2-5 ticks |
| 12 | Herblore | Mix 3doserangerspotion | 162.5 | 72, checked `brew_potion.rs2:123` | opheldu (secondary on unfinished potion) | members; 1 unf potion + 1 secondary | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 812.5 (inferred: 5 x base) | `herblore.rs2:24` (via `brew_potion.rs2:146`) + `brew_potion.rs2:123`; `brew_potion.struct:190` | current Herblore route band (rs/37) | [A](engine-sweep/skills.md) | Route band from 72 (rs/37 `herblore.md`) |
| 13 | Herblore | Mix 3dose1antidragon | 157.5 | 69, checked `brew_potion.rs2:123` | opheldu (secondary on unfinished potion) | members; 1 unf potion + 1 secondary | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 787.5 (inferred: 5 x base) | `herblore.rs2:24` (via `brew_potion.rs2:146`) + `brew_potion.rs2:123`; `brew_potion.struct:182` |  | [A](engine-sweep/skills.md) |  |
| 14 | Fletching | Attach arrowtips: adamant_arrow x15 | 150 | 60, checked `arrows.rs2:64` | opheldu (tips on headless arrows) | members; 15 tips + 15 headless | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 750 (inferred: 5 x base) | `arrows.rs2:85` + `arrows.rs2:64`; `arrows.dbrow:33` |  | [A](engine-sweep/skills.md) |  |
| 15 | Fletching | Feather darts: adamant_dart x10 | 150 | 67, checked `darts.rs2:34` | opheldu (feather on dart tips) | members; 10 tips + 10 feathers | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 750 (inferred: 5 x base) | `darts.rs2:61` + `darts.rs2:34`; `darts.dbrow:30` |  | [A](engine-sweep/skills.md) |  |
| 16 | Herblore | Mix 3dose2defense | 150 | 66, checked `brew_potion.rs2:123` | opheldu (secondary on unfinished potion) | members; 1 unf potion + 1 secondary | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 750 (inferred: 5 x base) | `herblore.rs2:24` (via `brew_potion.rs2:146`) + `brew_potion.rs2:123`; `brew_potion.struct:166` | current Herblore route band (rs/37) | [A](engine-sweep/skills.md) |  |
| 17 | Herblore | Mix 3dose2restore | 142.5 | 63, checked `brew_potion.rs2:123` | opheldu (secondary on unfinished potion) | members; 1 unf potion + 1 secondary | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 712.5 (inferred: 5 x base) | `herblore.rs2:24` (via `brew_potion.rs2:146`) + `brew_potion.rs2:123`; `brew_potion.struct:251` |  | [A](engine-sweep/skills.md) |  |
| 18 | Crafting | Cut uncut_dragonstone | 137.5 | 55, checked `uncut_gem.rs2:31` | opheldu (chisel on uncut gem) | members gems need a members world; 1 uncut gem | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 687.5 (inferred: 5 x base) | `uncut_gem.rs2:63` + `uncut_gem.rs2:31`; `gem.dbrow:62` | current Crafting route (rs/37); dragonstones are scarce | [A](engine-sweep/skills.md) | Route from 55 if supplied; dragonstones effectively unobtainable (rs/37 `crafting.md`) |
| 19 | Crafting | Orb on battlestaff: air_battlestaff | 137.5 | 66, checked `battlestaves.rs2:26` | opheldu (orb on battlestaff) | members; 1 orb + 1 battlestaff | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 687.5 (inferred: 5 x base) | `battlestaves.rs2:38` + `battlestaves.rs2:26`; `battlestaves.struct:13` | CANDIDATE: see the candidates section | [A](engine-sweep/skills.md) | Top ten #2: measured; the realistic Crafting line (rs/37) |
| 20 | Herblore | Mix weapon_poison | 137.5 | 60, checked `brew_potion.rs2:123` | opheldu (secondary on unfinished potion) | members; 1 unf potion + 1 secondary | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 687.5 (inferred: 5 x base) | `herblore.rs2:24` (via `brew_potion.rs2:146`) + `brew_potion.rs2:123`; `brew_potion.struct:174` |  | [A](engine-sweep/skills.md) |  |
| 21 | Crafting | Orb on battlestaff: fire_battlestaff | 125 | 62, checked `battlestaves.rs2:26` | opheldu (orb on battlestaff) | members; 1 orb + 1 battlestaff | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 625 (inferred: 5 x base) | `battlestaves.rs2:38` + `battlestaves.rs2:26`; `battlestaves.struct:1` | CANDIDATE: see the candidates section | [A](engine-sweep/skills.md) |  |
| 22 | Herblore | Mix 3dose2strength | 125 | 55, checked `brew_potion.rs2:123` | opheldu (secondary on unfinished potion) | members; 1 unf potion + 1 secondary | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 625 (inferred: 5 x base) | `herblore.rs2:24` (via `brew_potion.rs2:146`) + `brew_potion.rs2:123`; `brew_potion.struct:116` |  | [A](engine-sweep/skills.md) |  |
| 23 | Cooking | Ugthanki kebab (pitta on finished mixture) | 120 | NONE anywhere on the path (`ugthanki_kebab.rs2:116-135`) | opheldu (pitta bread on onion-tomato-ugthanki bowl) | members; 1 pitta + 1 mixture; success stat_random(118,492): 46% at 1, 100% from ~37 | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 600 (inferred: 5 x 120 from ~37 (276 at level 1)) | `ugthanki_kebab.rs2:135` + none | CANDIDATE (fallback). Mixture steps also unchecked; the knife check prints but never returns (`:79-81`, `:98-100`) | [A](engine-sweep/skills.md) | Top ten #3: the wine fallback (rs/37 `cooking.md` route 2) |
| 24 | Herblore | Mix 3dose2energy | 117.5 | 52, checked `brew_potion.rs2:123` | opheldu (secondary on unfinished potion) | members; 1 unf potion + 1 secondary | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 587.5 (inferred: 5 x base) | `herblore.rs2:24` (via `brew_potion.rs2:146`) + `brew_potion.rs2:123`; `brew_potion.struct:269` |  | [A](engine-sweep/skills.md) |  |
| 25 | Fletching | Attach arrowtips: mithril_arrow x15 | 112.5 | 45, checked `arrows.rs2:64` | opheldu (tips on headless arrows) | members; 15 tips + 15 headless | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 562.5 (inferred: 5 x base) | `arrows.rs2:85` + `arrows.rs2:64`; `arrows.dbrow:25` |  | [A](engine-sweep/skills.md) |  |
| 26 | Crafting | Orb on battlestaff: earth_battlestaff | 112.5 | 58, checked `battlestaves.rs2:26` | opheldu (orb on battlestaff) | members; 1 orb + 1 battlestaff | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 562.5 (inferred: 5 x base) | `battlestaves.rs2:38` + `battlestaves.rs2:26`; `battlestaves.struct:19` | CANDIDATE: see the candidates section | [A](engine-sweep/skills.md) |  |
| 27 | Herblore | Mix 3dosefisherspotion | 112.5 | 50, checked `brew_potion.rs2:123` | opheldu (secondary on unfinished potion) | members; 1 unf potion + 1 secondary | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 562.5 (inferred: 5 x base) | `herblore.rs2:24` (via `brew_potion.rs2:146`) + `brew_potion.rs2:123`; `brew_potion.struct:132` |  | [A](engine-sweep/skills.md) |  |
| 28 | Fletching | Feather darts: mithril_dart x10 | 112 | 52, checked `darts.rs2:34` | opheldu (feather on dart tips) | members; 10 tips + 10 feathers | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 560 (inferred: 5 x base) | `darts.rs2:61` + `darts.rs2:34`; `darts.dbrow:23` |  | [A](engine-sweep/skills.md) |  |
| 29 | Crafting | Cut uncut_diamond | 107.5 | 43, checked `uncut_gem.rs2:31` | opheldu (chisel on uncut gem) | members gems need a members world; 1 uncut gem | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 537.5 (inferred: 5 x base) | `uncut_gem.rs2:63` + `uncut_gem.rs2:31`; `gem.dbrow:1` | current fallback when dragonstones run out | [A](engine-sweep/skills.md) | rs/37 fallback when dragonstones run out |
| 30 | Herblore | Mix 3dose2antipoison | 106.3 | 48, checked `brew_potion.rs2:123` | opheldu (secondary on unfinished potion) | members; 1 unf potion + 1 secondary | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 531.5 (inferred: 5 x base) | `herblore.rs2:24` (via `brew_potion.rs2:146`) + `brew_potion.rs2:123`; `brew_potion.struct:149` |  | [A](engine-sweep/skills.md) |  |
| 31 | Crafting | Orb on battlestaff: water_battlestaff | 100 | 54, checked `battlestaves.rs2:26` | opheldu (orb on battlestaff) | members; 1 orb + 1 battlestaff | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 500 (inferred: 5 x base) | `battlestaves.rs2:38` + `battlestaves.rs2:26`; `battlestaves.struct:7` | CANDIDATE: see the candidates section | [A](engine-sweep/skills.md) |  |
| 32 | Herblore | Mix 3dose2attack | 100 | 45, checked `brew_potion.rs2:123` | opheldu (secondary on unfinished potion) | members; 1 unf potion + 1 secondary | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 500 (inferred: 5 x base) | `herblore.rs2:24` (via `brew_potion.rs2:146`) + `brew_potion.rs2:123`; `brew_potion.struct:91` |  | [A](engine-sweep/skills.md) |  |
| 33 | Fletching | Tip bolts: barbed_bolt x10 | 95 | 51, checked `bolts.rs2:60` | opheldu (tips on bolts) | members; 10 tips + 10 bolts | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 475 (inferred: 5 x base) | `bolts.rs2:87` + `bolts.rs2:60`; `bolts.dbrow:38` |  | [A](engine-sweep/skills.md) |  |
| 34 | Fletching | String bow: magic_longbow | 91.5 | 85, checked `bows.rs2:29` | opheldu (string on unstrung bow) | members; 1 unstrung bow + 1 bow string | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 457.5 (inferred: 5 x base) | `bows.rs2:41` + `bows.rs2:29`; `bows.dbrow:78` | one bow per action | [A](engine-sweep/skills.md) |  |
| 35 | Herblore | Mix 3doseprayerrestore | 87.5 | 38, checked `brew_potion.rs2:123` | opheldu (secondary on unfinished potion) | members; 1 unf potion + 1 secondary | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 437.5 (inferred: 5 x base) | `herblore.rs2:24` (via `brew_potion.rs2:146`) + `brew_potion.rs2:123`; `brew_potion.struct:124` |  | [A](engine-sweep/skills.md) |  |
| 36 | Crafting | Cut uncut_ruby | 85 | 34, checked `uncut_gem.rs2:31` | opheldu (chisel on uncut gem) | members gems need a members world; 1 uncut gem | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 425 (inferred: 5 x base) | `uncut_gem.rs2:63` + `uncut_gem.rs2:31`; `gem.dbrow:17` |  | [A](engine-sweep/skills.md) |  |
| 37 | Fletching | String bow: magic_shortbow | 83.2 | 80, checked `bows.rs2:29` | opheldu (string on unstrung bow) | members; 1 unstrung bow + 1 bow string | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 416 (inferred: 5 x base) | `bows.rs2:41` + `bows.rs2:29`; `bows.dbrow:71` | one bow per action | [A](engine-sweep/skills.md) |  |
| 38 | Herblore | Mix blamish_oil | 80 | 25, checked `brew_potion.rs2:123` | opheldu (secondary on unfinished potion) | members; 1 unf potion + 1 secondary | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 400 (inferred: 5 x base) | `herblore.rs2:24` (via `brew_potion.rs2:146`) + `brew_potion.rs2:123`; `brew_potion.struct:207` |  | [A](engine-sweep/skills.md) |  |
| 39 | Herblore | Mix 3dose1agility | 80 | 34, checked `brew_potion.rs2:123` | opheldu (secondary on unfinished potion) | members; 1 unf potion + 1 secondary | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 400 (inferred: 5 x base) | `herblore.rs2:24` (via `brew_potion.rs2:146`) + `brew_potion.rs2:123`; `brew_potion.struct:243` |  | [A](engine-sweep/skills.md) |  |
| 40 | Herblore | Mix eadgar_ground_troll_thistle_potion | 77.5 | 31, checked `brew_potion.rs2:123` | opheldu (secondary on unfinished potion) | members; 1 unf potion + 1 secondary | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 387.5 (inferred: 5 x base) | `herblore.rs2:24` (via `brew_potion.rs2:146`) + `brew_potion.rs2:123`; `brew_potion.struct:309` |  | [A](engine-sweep/skills.md) |  |
| 41 | Fletching | Attach arrowtips: steel_arrow x15 | 75 | 30, checked `arrows.rs2:64` | opheldu (tips on headless arrows) | members; 15 tips + 15 headless | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 375 (inferred: 5 x base) | `arrows.rs2:85` + `arrows.rs2:64`; `arrows.dbrow:17` |  | [A](engine-sweep/skills.md) |  |
| 42 | Fletching | Feather darts: steel_dart x10 | 75 | 37, checked `darts.rs2:34` | opheldu (feather on dart tips) | members; 10 tips + 10 feathers | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 375 (inferred: 5 x base) | `darts.rs2:61` + `darts.rs2:34`; `darts.dbrow:16` |  | [A](engine-sweep/skills.md) |  |
| 43 | Fletching | String bow: yew_longbow | 75 | 70, checked `bows.rs2:29` | opheldu (string on unstrung bow) | members; 1 unstrung bow + 1 bow string | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 375 (inferred: 5 x base) | `bows.rs2:41` + `bows.rs2:29`; `bows.dbrow:64` | one bow per action | [A](engine-sweep/skills.md) |  |
| 44 | Herblore | Mix 3dose1defense | 75 | 30, checked `brew_potion.rs2:123` | opheldu (secondary on unfinished potion) | members; 1 unf potion + 1 secondary | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 375 (inferred: 5 x base) | `herblore.rs2:24` (via `brew_potion.rs2:146`) + `brew_potion.rs2:123`; `brew_potion.struct:158` |  | [A](engine-sweep/skills.md) |  |
| 45 | Fletching | String bow: yew_shortbow | 67.5 | 65, checked `bows.rs2:29` | opheldu (string on unstrung bow) | members; 1 unstrung bow + 1 bow string | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 337.5 (inferred: 5 x base) | `bows.rs2:41` + `bows.rs2:29`; `bows.dbrow:57` | one bow per action | [A](engine-sweep/skills.md) |  |
| 46 | Crafting | Cut uncut_emerald | 67.5 | 27, checked `uncut_gem.rs2:31` | opheldu (chisel on uncut gem) | members gems need a members world; 1 uncut gem | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 337.5 (inferred: 5 x base) | `uncut_gem.rs2:63` + `uncut_gem.rs2:31`; `gem.dbrow:9` |  | [A](engine-sweep/skills.md) |  |
| 47 | Herblore | Mix 3dose1energy | 67.5 | 26, checked `brew_potion.rs2:123` | opheldu (secondary on unfinished potion) | members; 1 unf potion + 1 secondary | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 337.5 (inferred: 5 x base) | `herblore.rs2:24` (via `brew_potion.rs2:146`) + `brew_potion.rs2:123`; `brew_potion.struct:260` |  | [A](engine-sweep/skills.md) |  |
| 48 | Herblore | Mix 3dose1restore | 62.5 | 22, checked `brew_potion.rs2:123` | opheldu (secondary on unfinished potion) | members; 1 unf potion + 1 secondary | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 312.5 (inferred: 5 x base) | `herblore.rs2:24` (via `brew_potion.rs2:146`) + `brew_potion.rs2:123`; `brew_potion.struct:99` |  | [A](engine-sweep/skills.md) |  |
| 49 | Cooking | Finish a gnome cocktail (last garnish) | 60 | NONE: no `stat(cooking)` anywhere in `skill_cooking/scripts/gnome_cooking/` | opheldu (topping on unfinished dish) | unfinished cocktail + correct garnish (wrong one spoils it) | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 300 (inferred: 5 x base) | `gnome_cocktail_finish.rs2:30` + none | no level check | [A](engine-sweep/skills.md) | Loses to wine and kebab |
| 50 | Firemaking | Make magic or yew pyre logs (sacred oil on logs) | 60 | **none** for making (Firemaking checked only when adding to a pyre, `mortton_pyre.rs2:75`) | opheldu (`_category_111`, oil on `category_22` logs) | oil with >= 4 doses (`:22`); `%morttonquest >= mortton_created_sacred_oil` (`:6`) | none | none (dropped only while delayed) | yes | 5 (inferred from the handler) | 300 burst; about 100 sustained with banks (inferred: 14 log + oil pairs per inventory) | `mortton_pyre.rs2:42`; `:6`, `:22`; `flamtaer_pyre.struct:51,63` | Consumes 1 magic or yew log + 1 sacred oil (4). Oiled logs are `category_2050`, so no re-oil loop (`mortton.obj:171-258`). | [B](engine-sweep/combat-minigames-areas.md) | Measured and set aside by rs/28 (`firemaking.md` section 5) |
| 51 | Fletching | String bow: maple_longbow | 58.2 | 55, checked `bows.rs2:29` | opheldu (string on unstrung bow) | members; 1 unstrung bow + 1 bow string | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 291 (inferred: 5 x base) | `bows.rs2:41` + `bows.rs2:29`; `bows.dbrow:50` | one bow per action | [A](engine-sweep/skills.md) |  |
| 52 | Fletching | String bow: maple_shortbow | 50 | 50, checked `bows.rs2:29` | opheldu (string on unstrung bow) | members; 1 unstrung bow + 1 bow string | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 250 (inferred: 5 x base) | `bows.rs2:41` + `bows.rs2:29`; `bows.dbrow:43` | one bow per action | [A](engine-sweep/skills.md) |  |
| 53 | Crafting | Cut uncut_sapphire | 50 | 20, checked `uncut_gem.rs2:31` | opheldu (chisel on uncut gem) | members gems need a members world; 1 uncut gem | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 250 (inferred: 5 x base) | `uncut_gem.rs2:63` + `uncut_gem.rs2:31`; `gem.dbrow:25` |  | [A](engine-sweep/skills.md) |  |
| 54 | Herblore | Mix 3dose1strength | 50 | 12, checked `brew_potion.rs2:123` | opheldu (secondary on unfinished potion) | members; 1 unf potion + 1 secondary | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 250 (inferred: 5 x base) | `herblore.rs2:24` (via `brew_potion.rs2:146`) + `brew_potion.rs2:123`; `brew_potion.struct:108` |  | [A](engine-sweep/skills.md) |  |
| 55 | Herblore | Mix mort_serum3_tarrominvial | 50 | 15, checked `brew_potion.rs2:123` | opheldu (secondary on unfinished potion) | members; 1 unf potion + 1 secondary; Shades of Mort'ton var (`brew_potion.rs2:111`) | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 250 (inferred: 5 x base) | `herblore.rs2:24` (via `brew_potion.rs2:146`) + `brew_potion.rs2:123`; `brew_potion.struct:286` |  | [A](engine-sweep/skills.md) |  |
| 56 | Herblore | Mix mort_serum3_ashesvial | 50 | 15, checked `brew_potion.rs2:123` | opheldu (secondary on unfinished potion) | members; 1 unf potion + 1 secondary; Shades of Mort'ton var (`brew_potion.rs2:111`) | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 250 (inferred: 5 x base) | `herblore.rs2:24` (via `brew_potion.rs2:146`) + `brew_potion.rs2:123`; `brew_potion.struct:294` |  | [A](engine-sweep/skills.md) |  |
| 57 | Cooking | Pizza topping: pineapple_topping | 45 | 65, checked `pizza.rs2:121` | opheldu (topping on plain pizza) | 1 plain pizza + topping | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 225 (inferred: 5 x base) | `pizza.rs2:131` + `pizza.rs2:121`; `pizza.struct:8` |  | [A](engine-sweep/skills.md) |  |
| 58 | Crafting | Studs on leather: studded_chaps | 42 | 44, checked `studded.rs2:44` | opheldu (studs on leather body/chaps) | members; 1 steel studs + 1 leather item | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 210 (inferred: 5 x base) | `studded.rs2:56` + `studded.rs2:44`; `studded.struct:9` |  | [A](engine-sweep/skills.md) |  |
| 59 | Fletching | String bow: willow_longbow | 41.5 | 40, checked `bows.rs2:29` | opheldu (string on unstrung bow) | members; 1 unstrung bow + 1 bow string | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 207.5 (inferred: 5 x base) | `bows.rs2:41` + `bows.rs2:29`; `bows.dbrow:36` | one bow per action | [A](engine-sweep/skills.md) |  |
| 60 | Crafting | Studs on leather: studded_body | 40 | 41, checked `studded.rs2:44` | opheldu (studs on leather body/chaps) | members; 1 steel studs + 1 leather item | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 200 (inferred: 5 x base) | `studded.rs2:56` + `studded.rs2:44`; `studded.struct:1` |  | [A](engine-sweep/skills.md) |  |
| 61 | Firemaking | Make maple or willow pyre logs | 40 | none | opheldu | 3 doses | none | none | yes | 5 (inferred) | 200 burst (inferred) | `mortton_pyre.rs2:42`; `flamtaer_pyre.struct:27,39` |  | [B](engine-sweep/combat-minigames-areas.md) |  |
| 62 | Cooking | Pizza topping: anchovy_topping | 39 | 55, checked `pizza.rs2:121` | opheldu (topping on plain pizza) | 1 plain pizza + topping | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 195 (inferred: 5 x base) | `pizza.rs2:131` + `pizza.rs2:121`; `pizza.struct:1` |  | [A](engine-sweep/skills.md) |  |
| 63 | Fletching | Feather darts: iron_dart x10 | 38 | 22, checked `darts.rs2:34` | opheldu (feather on dart tips) | members; 10 tips + 10 feathers | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 190 (inferred: 5 x base) | `darts.rs2:61` + `darts.rs2:34`; `darts.dbrow:9` |  | [A](engine-sweep/skills.md) |  |
| 64 | Fletching | Attach arrowtips: iron_arrow x15 | 37.5 | 15, checked `arrows.rs2:64` | opheldu (tips on headless arrows) | members; 15 tips + 15 headless | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 187.5 (inferred: 5 x base) | `arrows.rs2:85` + `arrows.rs2:64`; `arrows.dbrow:9` |  | [A](engine-sweep/skills.md) |  |
| 65 | Herblore | Mix 3doseantipoison | 37.5 | 5, checked `brew_potion.rs2:123` | opheldu (secondary on unfinished potion) | members; 1 unf potion + 1 secondary | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 187.5 (inferred: 5 x base) | `herblore.rs2:24` (via `brew_potion.rs2:146`) + `brew_potion.rs2:123`; `brew_potion.struct:140` |  | [A](engine-sweep/skills.md) |  |
| 66 | Crafting | Hard leather body (needle on hard leather) | 35 | 28, checked `leather.rs2:91` | opheldu (needle on hard leather); skips the leather interface | 1 hard leather + thread (1 reel per 5 items) | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 175 (inferred: 5 x base) | `leather.rs2:120` + `leather.rs2:91`; `leather.dbrow:64` | only leather product with no queue | [A](engine-sweep/skills.md) |  |
| 67 | Fletching | String bow: willow_shortbow | 33.2 | 35, checked `bows.rs2:29` | opheldu (string on unstrung bow) | members; 1 unstrung bow + 1 bow string | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 166 (inferred: 5 x base) | `bows.rs2:41` + `bows.rs2:29`; `bows.dbrow:29` | one bow per action | [A](engine-sweep/skills.md) |  |
| 68 | Crafting | Snail shell into snelm | 32.5 | 15, checked `snelm.rs2:7` | opheldu (chisel on shell, category_3) | 1 snail shell | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 162.5 (inferred: 5 x base) | `snelm.rs2:15` + `snelm.rs2:7` | script comment: weakqueued in OSRS, instant here | [A](engine-sweep/skills.md) |  |
| 69 | Fletching | Tip bolts: pearl_bolt x10 | 32 | 41, checked `bolts.rs2:60` | opheldu (tips on bolts) | members; 10 tips + 10 bolts | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 160 (inferred: 5 x base) | `bolts.rs2:87` + `bolts.rs2:60`; `bolts.dbrow:31` |  | [A](engine-sweep/skills.md) |  |
| 70 | Cooking | Finish gnome food (last topping) | 30 | NONE: no `stat(cooking)` anywhere in `skill_cooking/scripts/gnome_cooking/` | opheldu (topping on unfinished dish) | unfinished crunchies/batta/bowl + topping; gnome spice is never consumed (`gnome_food_finish.rs2:24`) | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 150 (inferred: 5 x base) | `gnome_food_finish.rs2:34` + none | no level check | [A](engine-sweep/skills.md) |  |
| 71 | Cooking | Chocolate cake (chocolate on cake) | 30 | 50, checked `cakes.rs2:114` | opheldu | 1 cake + 1 chocolate | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 150 (inferred: 5 x base) | `cakes.rs2:127` + `cakes.rs2:114` |  | [A](engine-sweep/skills.md) |  |
| 72 | Thieving | Pickpocket hero | 273.3 | 80, checked in the npc op label | opnpc (pickpocket) | success stat_random(6,100); 10-tick stun on a fail | p_delay(0) BEFORE grant (`thieving.rs2:5`) | interaction; dropped while delayed | no | 0.5 | 136.65 (inferred upper bound: 2 ticks per success) | `thieving.rs2:22` + npc label; `pickpocket.dbrow:140` |  | [A](engine-sweep/skills.md) | Upper bound; rs/2 owns Thieving |
| 73 | Cooking | Pizza topping: meat_topping | 26 | 45, checked `pizza.rs2:121` | opheldu (topping on plain pizza) | 1 plain pizza + topping | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 130 (inferred: 5 x base) | `pizza.rs2:131` + `pizza.rs2:121`; `pizza.struct:15` |  | [A](engine-sweep/skills.md) |  |
| 74 | Fletching | String bow: oak_longbow | 25 | 25, checked `bows.rs2:29` | opheldu (string on unstrung bow) | members; 1 unstrung bow + 1 bow string | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 125 (inferred: 5 x base) | `bows.rs2:41` + `bows.rs2:29`; `bows.dbrow:22` | one bow per action | [A](engine-sweep/skills.md) |  |
| 75 | Crafting | Cut uncut_red_topaz | 25 | 16, checked `uncut_gem.rs2:31` | opheldu (chisel on uncut gem) | members gems need a members world; 1 uncut gem | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 125 (inferred: 5 x base) | `uncut_gem.rs2:63` + `uncut_gem.rs2:31`; `gem.dbrow:42` | smash chance stat_random(100,245); a smash still grants (xp+2)/4 at `uncut_gem.rs2:54` | [A](engine-sweep/skills.md) |  |
| 76 | Herblore | Mix 3dose1attack | 25 | 3 (param default, `brew_potion.param:1-3`), checked `brew_potion.rs2:123` | opheldu (secondary on unfinished potion) | members; 1 unf potion + 1 secondary | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 125 (inferred: 5 x base) | `herblore.rs2:24` (via `brew_potion.rs2:146`) + `brew_potion.rs2:123`; `brew_potion.struct:84` |  | [A](engine-sweep/skills.md) |  |
| 77 | Crafting | Cut uncut_jade | 20 | 13, checked `uncut_gem.rs2:31` | opheldu (chisel on uncut gem) | members gems need a members world; 1 uncut gem | none | dropped only while `delayed` (`OpHeldUHandler.ts:16`); no modal check | yes | 5 | 100 (inferred: 5 x base) | `uncut_gem.rs2:63` + `uncut_gem.rs2:31`; `gem.dbrow:53` | smash chance stat_random(90,240); a smash still grants (xp+2)/4 at `uncut_gem.rs2:54` | [A](engine-sweep/skills.md) |  |
| 78 | Firemaking | Make normal or oak pyre logs | 20 | none | opheldu | 2 doses | none | none | yes | 5 (inferred) | 100 burst (inferred) | `mortton_pyre.rs2:42`; `flamtaer_pyre.struct:3,15` | One 4-dose oil makes two. | [B](engine-sweep/combat-minigames-areas.md) |  |
| 79 | Woodcutting | Chop magic_tree | 250 | 75, checked `woodcut.rs2:140` | oploc tree, p_oploc(3) loop | axe; a free slot | `%action_delay` +3; roll BEFORE grant | interaction | no | <=0.33 | 83.33 (inferred upper bound: one roll per 3 ticks at 100% success) | `woodcut.rs2:181` + `woodcut.rs2:140`; `trees.dbrow:145` |  | [A](engine-sweep/skills.md) |  |
| 80 | Smithing | Anvil, smithing_runite_bar: 75 per bar (5-bar platebody = 375) | 375 | per item from the smithing dbrow, checked in `smithing.rs2` before the anvil proc | if_button smithing interface (make 1/5/x) | hammer; bars | p_delay(1) BEFORE and p_delay(2) AFTER each grant | button must be visible (`IfButtonHandler.ts`); script closes the interface | no | 0.2 | 75 (measured by rs/28: 5 ticks per item at 300 ms) | `smithing.rs2:283` + `smithing.rs2`; `smithing.struct:56` | current Smithing route: platebodies (5 ticks whatever the bar count) | [A](engine-sweep/skills.md) | Route (rs/28 `smithing.md`) |
| 81 | Mining | Mine runite_rock | 125 | 85, checked `mining.rs2:101` | oploc rock, p_oploc(3) loop | pickaxe | `%action_delay` + pickaxe rate; roll BEFORE grant (normal rocks add p_delay(0), `mining.rs2:157`) | interaction | no | <=0.33 | 41.67 (inferred upper bound: one roll per 3 ticks at 100% success) | `mining.rs2:173` + `mining.rs2:101`; `mine.dbrow:149` |  | [A](engine-sweep/skills.md) |  |
| 82 | Runecraft | Bind essence at the death altar (per essence) | 10 | 65, checked in `runecraft.rs2` before `:70` | oploc altar | talisman/tiara + essence (whole inventory per click) | grant BEFORE p_delay(3) (`runecraft.rs2:99`) | one interaction per tick (`OpLocUHandler.ts:79`, `World.ts:801`) | no | 27 essence per click | 38.57 (measured by rs/28: 27 essence per 7-tick craft + trade cycle) | `runecraft.rs2:95` + `runecraft.rs2`; `runecraft.dbrow:151` |  | [A](engine-sweep/skills.md) | Route (rs/28 `runecraft.md`) |
| 83 | Fishing | Catch shark | 110 | checked in the spot label (`fishing_spots/*.rs2`); standard 76, not re-read | opnpc spot, p_opnpc loop | tool + bait | `%action_delay` +5 (3 with the knife cycle); roll BEFORE grant | interaction | no | <=0.33 | 36.67 (inferred upper bound: one roll per 3 ticks at 100% success) | `fishing.rs2:54`/`:68` (npc spots) or `:85`/`:100` (loc spots) + spot label; `fishing.struct:61` |  | [A](engine-sweep/skills.md) |  |
| 84 | Prayer | Bury dragon_bones | 72 | none (no Prayer requirement) | opheld1 (bury) | 1 bone | p_stopaction; p_delay(0) BEFORE grant (`bury_bone.rs2:8-10`) | dropped only while `delayed` (`OpHeldHandler.ts`); no modal check | no | 0.5 | 36 (measured by rs/28: 2 ticks per bone) | `bury_bone.rs2:15` + none; `bones.obj:71` | KNOWN, guard confirmed: hard 2 ticks; current route | [A](engine-sweep/skills.md) | Route (rs/28 `prayer.md`) |
| 85 | Ranged | Combat hit, accurate or rapid | 4 per damage + 1.33 HP | weapon level on equip | opnpc2 / apnpc2 | ammo (`player_ranged.rs2:26-31`) | `%action_delay` attackrate (rapid -1), set BEFORE the grant (`:17-24`) | combat checks | no | 1 per attack interval | 5.4-8.75 knives alone; 11.5 cannon; 22.7 cannon + knives (measured, rs-28 `ranged.md`) | `combat.rs2:156`; `player_ranged.rs2:6` |  | [B](engine-sweep/combat-minigames-areas.md) | Route (rs/28 `ranged.md`) |
| 86 | Attack | Combat training camp dummy | 50 (6 hits, 300 total) | none | oploc1 | `%biodummy <= 5` (`:50`); not ranged or autocast (`:46`); camp gate needs Biohazard (`:39`) | p_delay(2) AFTER the grant (`:59`) | p_delay drops the next ops | no | 1 per 4 ticks | 12.5 (inferred) | `combat_training_camp.rs2:55`; `:50` | 300 base is level 30 Attack in about 24 ticks. | [B](engine-sweep/combat-minigames-areas.md) | Only if Biohazard is on route |
| 87 | Attack/Strength/Defence | Melee hit | 4 per damage + 1.33 HP | weapon level on equip | opnpc2 / apnpc2 |  | `%action_delay` attackrate, set AFTER the grant (`player_melee.rs2:56-60`), checked at `:8` | combat checks | no | 1 per 4 ticks (scimitar) | 9-10 near 99 (measured, rs-28 `combat.md`) | `combat.rs2:146-167`; `player_melee.rs2:8` | Specials share the gate (`player_special_attack.rs2:9-17`). | [B](engine-sweep/combat-minigames-areas.md) | Route (rs/28 `combat.md`) |
| 88 | Agility | Wilderness course lap (12.5 + 20 + 20 + 20 + 0 + bonus 498.9) | 571.4 | 52 ridge gate and 49 pipe (`wilderness_course.rs2:2`, `:53`) | oploc obstacles | Wilderness levels 50-56 | forcemove/exactmove and p_delay per obstacle, BEFORE each grant | one interaction per tick (`OpLocUHandler.ts:79`, `World.ts:801`) | no | one lap per 77-99 ticks | 7.4 (measured by rs/2: 77 ticks per clean lap (5.8-7.1 with falls)) | `wilderness_course.rs2:76`, `:102`, `:125`, `:148`, `:176` + `:2`, `:53` | current route | [A](engine-sweep/skills.md) | rs/2 Agility route |

## 3. Table 2: missing or weak guard, one row per effect family

Merged from A Table 2, B Table 2, C sections 2a-2c and D sections 4 and 6, sorted by the best
base xp per tick in the family. "No delay" is authentic for most item-on-item rows and is how the
current routes already work; the rows with another named weakness come first within a rate.

| Family (rows) | Best rate in family (base xp per tick) | Grant / guard file:line | Weakness | Route consequence |
|---|---|---|---|---|
| Agility Arena ticket trader (5 buttons) | 2.9 sustained (corrected) | `agilityarena_tickettrader.rs2:60-68`; `agilityarena.obj:15` | no level check, no delay, no cap, no `p_finduid` | none: tickets are untradeable (closed lead, section 1) |
| Genie lamp | 1,650 (inferred) | `general/scripts/xplamp/xplamp.rs2:107-111` | confirm does not re-check the lamp | none: no lamps on the demo (random events off) |
| Wine fermentation timer | all stock in one tick | `skill_cooking/scripts/cooking_inv/scripts/wine/wine.rs2:22-70`; armed `:20`, `login_logout/login.rs2:70` | no Cooking check on the grant; the whole bank ferments at once | KNOWN; the Cooking route (rs/37, rs/47); measured at Cooking 1 here (#10) |
| Fletching: rune to bronze darts (6), arrowtips (6), bolts and bolt tips (6), bows (12), ogre arrows (3) | 940 (rune darts) | `skill_fletching/scripts/darts.rs2:34,61`; `arrows.rs2:64,85`; `bolts.rs2:60,87`; `bows.rs2:29,41`; `ogre_arrows.rs2:79,107` | no delay: one effect per accepted packet, 5 a tick | route (rs/37) |
| Fletching: headless arrows | 75 | `arrows.rs2:46` | no level check, no delay | none: level 1 item anyway |
| Magic: Charge and the charge-orb family (5) | 900 | `skill_magic/scripts/spells/charge.rs2:1-27` (recast guard commented out `:8-12`) | no delay, no cooldown; overlay tab, so it runs beside a loop | KNOWN, route above 80 (rs/28) |
| Herblore: potion mixing (24) | 875 (Zamorak) | `skill_herblore/scripts/herblore.rs2:24` via `brewing/brew_potion.rs2:123,146` | no delay | route (rs/37); magic potion is #8 |
| Herblore: identify herbs (19) | 75 | `identifying/identify.rs2:65-73` | no Druidic Ritual check (only the level) | none: identify is never the Herblore line |
| Crafting: gem cutting (8) | 687.5 (dragonstone) | `skill_crafting/scripts/gem/uncut_gem.rs2:31,63`; smash still grants `:54` | no delay | route (rs/37) |
| Crafting: battlestaves (4) | 687.5 (air) | `battlestaves/battlestaves.rs2:26,38` | no delay | fallback, #2 |
| Crafting: studded leather (2), snelm, amulet stringing, cape dye | 210 | `studded.rs2:44,56`; `snelm.rs2:7,15`; `stringing.rs2:71`; `dye_cape.rs2:120` | no delay; stringing and dye have no level check | none: lose to gems |
| Crafting: hard leather body | 175 | `leather.rs2:91,120` | cheaper trigger: needle on hard leather skips the interface and the weak queue every other leather item uses | none: loses to gems (rs/37) |
| Crafting: gold jewellery (20) | 50 | `jewellery.rs2:193,225-248` | first item not re-checked after the furnace interface opens | none: the interface closes before the delay |
| Crafting: pottery firing (6), spinning (3) | 3.75 | `pottery.rs2:103-181`; `spinning.rs2` | no level check (pottery, golden fleece); grant before the delay | none |
| Cooking: ugthanki kebab and its mixture steps | 600 (from ~37) | `skill_cooking/scripts/cooking_inv/scripts/ugthanki_kebab.rs2:73-135`; roll `:127` | no Cooking check anywhere; no delay; the knife check prints but never returns (`:79-81`, `:98-100`) | wine fallback, #3 |
| Cooking: gnome cocktail and food finishing | 300 | `gnome_cooking/.../gnome_cocktail_finish.rs2:30`; `gnome_food_finish.rs2:24,34` | no Cooking check; no delay; gnome spice never consumed | none: loses to wine and kebab |
| Cooking: pizza toppings (3), chocolate cake, oomlie wrap | 225 | `pizza.rs2:121,131`; `cakes.rs2:114,127`; `oomlie_bird_meat.rs2:17,30` | no delay | none |
| Cooking: gnome restaurant hand-in (Aluft) | 40-70 (inferred) | `minigames/.../gnome_restaurant.rs2:377-403` | no Cooking check at hand-in; dishes tradeable; delivery chains into the next job | none: wine and kebab are faster |
| Cooking: toad batta baking | 20 | `gnome_battas.rs2` | grant before the delay | none |
| Firemaking: pyre-log creation | 300 burst | `quests/quest_mortton/.../mortton_pyre.rs2:6,22,42` | no delay, no Firemaking check (only at the pyre, `:75`) | measured and set aside by rs/28 (section 1) |
| Fletching + Crafting: wolfbone arrowtips | 50 to each | `ogre_arrows.rs2:48-67` | one action grants two skills | none |
| Runecraft: binding (11 altars) | 38.57 (measured, rs/28) | `skill_runecraft/scripts/runecraft.rs2:95-99` | grant before `p_delay(3)` | none: the delay still paces the next craft |
| Thieving: lock picking (10 doors) | 12.5 | `locked_door.rs2:169-172` | grant before the delay; a failed pick has no delay | none |
| Fishing: big net | 6.4 | `skill_fishing/scripts/memberfish.rs2:150-215` | several grants per cycle, no free-space check between them | none |
| Fishing: Trawler reward pool | ~2 solo (inferred) | `minigames/.../trawler_control.rs2:14,50,152-162` | pool split by players present at the end, though every boarder added to it | none worth a route; helper log-outs unverified (B) |
| Mining: rune essence | 1.67 | `skill_mining/scripts/mining.rs2:217-226` | no success roll, no depletion | none |
| Smithing via Superheat | 16.67 | `superheat.rs2:67` | grant before the delay | none |
| Crafting: Flamtaer temple repair | up to 11.7 | `flamtaer_temple.rs2:56-59,136` | a failed roll falls through to the grant | none |
| Ranged: Ranging Guild target | up to 12.5 | `minigames/game_ranging/scripts/target.rs2:10-23` | bow and arrows enforced only near the judge | none: 10 shots per competition |
| Combat (all styles): overkill | small | `player_melee.rs2:32`, `player_ranged.rs2:52`, `player_magic.rs2:239` | xp at roll time, capped by current HP not HP net of pending hits | none for one attacker |
| Magic combat spells: splash | 18 (Stun) | `player_magic.rs2:170` | base xp before the hit roll | authentic; the 5-tick gate holds |
| Attack: combat camp and Varrock dummies | 12.5 | `combat_training_camp.rs2:50-59`, `attack_dummy.rs2:7-15` | grant before `p_delay` | none: capped by `%biodummy` / Attack 8 |
| Woodcutting: Kharidian cactus | ~0.1 | `kharidian_cactus.rs2:38-74` | no Woodcutting check; a fail pays 0.4 | none |
| Prayer points: zero-drain flicking (not xp) | n/a | `skill_prayer/scripts/prayer.rs2:30-34` (drain timer set only from all-off), `:42-44` (cleared when the last prayer goes off), `:163-181` (the only drain) | a prayer held for under 5 ticks at a time never drains | measured by rs/59 (`helper-fed-and-combat.md` row 2): 0 points flicking vs 90 held over 150 ticks; already in rs/59's combat plan |
| Thieving: Ape Atoll stalls; zoo-monkey release | 3.3 | `quests/quest_mm/scripts/aa_market.rs2:14,74-75`; `mm_zoo_monkey.rs2:98` | no quest varp, only the Thieving level | none: 65-tick stall respawn; one monkey at a time |
| Quest varps written relative to themselves (Fight Arena, Legends, Tourist Trap) or not by the reward (Priest in Peril, Gertrude) | n/a | C section 2b | would multiply a reward if the trigger could re-enter | none: the triggers are single-shot (C) |
| Engine: refused USER events | n/a | `server/engine/src/engine/entity/NetworkPlayer.ts:141-147` | a refused event spends a CLIENT slot (20), not a USER slot (5) | #6: over-sending is free |
| Engine: inventory op with the bank open | n/a | `Player.ts:2185-2187` (tabs stay visible), `OpHeldHandler.ts:54-56` | the server closes the bank and runs the op; `sdk/index.ts:1183-1186` says it is dropped | #5: 0 ticks per bank cycle with the lite client (measured) |
| Engine: IF_BUTTON, RESUME_* and CLOSE_MODAL have no delay check | n/a | `IfButtonHandler.ts`, `ResumePauseButtonHandler.ts:7-21`, `CloseModalHandler.ts:13` | overlay-tab buttons run during a delay; continues carry no page id | KNOWN (Charge, dialogue bursts) |
| Engine: OPPLAYER op not validated; RESUME_P_COUNTDIALOG takes any signed int | n/a | `OpPlayerHandler.ts:34`; `ResumePCountDialogHandler.ts:12-17` | content decides | none found |

## 4. Delay-free actions, by skill

Each runs from an item-on-item (OPHELDU), item op (OPHELD) or interface button with no
`p_delay`, `p_arrivedelay` or queue between the click and the effect, so it repeats once per
accepted packet, 5 a tick (read; measured for herb identify, wine, Charge, gem cutting,
battlestaves, kebabs and magic potions in D section 7 and section 8 here). Sources: A "Delay-free
actions", B "Delay-free grants", D section 5 (`speedrun/lab/census-delayfree.ts`: 273 FREE
triggers of 944 with an effect).

- **Agility:** Agility Arena ticket trader buttons (`agilityarena_tickettrader.rs2:36-68`);
  ticket-bound, see section 1.
- **Cooking:** wine making (`wine.rs2:7-20`) and the fermentation timer (`:22-70`, all stock at
  once); ugthanki kebab and its mixture steps (`ugthanki_kebab.rs2:73-135`); gnome cocktail and
  food finishing (`gnome_cocktail_finish.rs2:1-31`, `gnome_food_finish.rs2:5-35`); pizza toppings
  (`pizza.rs2:113-133`); chocolate cake (`cakes.rs2:113-129`); oomlie wraps
  (`oomlie_bird_meat.rs2:11-30`); gnome restaurant hand-in (dialogue, `gnome_restaurant.rs2:402`).
- **Crafting:** gem cutting (`uncut_gem.rs2:15-63`); battlestaves (`battlestaves.rs2:15-38`); hard
  leather body (`leather.rs2:116-134`); snelms (`snelm.rs2:6-16`); studded leather
  (`studded.rs2:40-59`); amulet stringing (`stringing.rs2:59-78`); cape and dye mixing
  (`dye_cape.rs2:109-139`).
- **Firemaking:** pyre-log creation (`mortton_pyre.rs2:15-42`), behind Shades of Mort'ton.
- **Fletching:** arrowtips (`arrows.rs2:50-86`), headless arrows (`:25-47`), darts
  (`darts.rs2:20-62`), bolt tipping and bolt-tip chiselling (`bolts.rs2:17-88`), bow stringing
  (`bows.rs2:18-42`), the chompy ogre-arrow chain (`ogre_arrows.rs2:19-144`).
- **Herblore:** potion finishing (`brew_potion.rs2:98-146`), herb identification
  (`identify.rs2:59-73`), grinding and decanting (items, no xp).
- **Magic:** Charge (`charge.rs2`), an overlay-tab IF_BUTTON that also runs beside a gathering
  loop (D overlap O3; rs/28 `interleaving.md` rule 5).
- **Fishing, Woodcutting, Mining, Thieving:** none at the cap. Loc and NPC ops run once per tick
  at most (D section 3); the ogre rock-cake stall and the Kharidian cactus are delay-free but
  throttled by the loc respawn (B). Loc-triggered delay-free: molten glass at a furnace
  (`glass.rs2:22-53`, 1 per tick).
- **Non-xp producers:** water sources (`general_use/scripts/water_sources.rs2:1-61`), shop and
  tanner buttons (`shop.rs2:163-170`, `tanner.rs2:67-131`), trade offers and accepts, Hassan's jug
  (dialogue, `hassan.rs2:12-16`).

## 5. Engine rules (summary; full text in [engine.md](engine-sweep/engine.md))

- **Packets execute inline at the top of each tick**, before NPCs, queues, timers and
  interactions (`World.ts:402`, `NetworkPlayer.ts:137-138`). Held ops and buttons run inside the
  handler; loc/NPC/obj/player ops only set a target that runs later in the tick.
- **5 accepted USER events per tick**; the rest stay buffered for the next tick. A USER event the
  handler refuses is consumed and counts against the 20-per-tick CLIENT budget instead
  (`NetworkPlayer.ts:69, 141-147`; measured in section 8, #6).
- **While delayed, every op packet and MOVE_CLICK is dropped, not queued.** A `p_delay(n)` from a
  click costs n+2 ticks. IF_BUTTON, RESUME_* and CLOSE_MODAL have no delay check (D 2.2-2.3).
- **Every op packet, inventory op and MOVE_CLICK cancels the interaction, closes modals and
  clears the weak queue.** IF_BUTTON, INV_BUTTON and CLOSE_MODAL never touch the interaction.
- **Normal timers wait for `canAccess()`**: any open modal, including a level-up chat, holds
  them; re-arming restarts the clock (measured, D section 7).
- **One make-X completion per tick**: a second completion in the same tick pays `p_delay(0)`
  (`interface_chat/scripts/chat.rs2:734-738, 1101-1119`; measured in section 8, #7).
- **Inventory ops are accepted with the bank open** (the server closes the bank and runs the op;
  measured by D). Worth 0 ticks per bank cycle with the lite client (#5).

Overlap paths (D section 3.3), the ones that matter:

| # | Two effects in one tick | Same tick? |
|---|---|---|
| O1 | up to 4 delay-free held ops, then a click whose op runs in the player phase | yes |
| O2 | a click, then a held op | no: the held op cancels the click |
| O3 | Charge (overlay-tab button) beside a running gathering loop | yes (measured by D; route canon, rs/28 `interleaving.md` rule 5) |
| O4 | a normal timer (wine) beside an interaction | yes, if no modal is open (measured in #10) |
| O7/O8 | weak queue beside a click or a loc loop | no: the click or `p_oploc` clears it |
| O10 | 5 delay-free held ops | yes, 5 a tick |
| O11 | a resumed dialogue page, then the interaction | yes, once the last page closes the chat |

## 6. Quest-reward and economy findings (short; full text in C and E)

**Quests ([quests.md](engine-sweep/quests.md)).**

- No quest reward can be granted twice or reached without its quest's last step: 46 of 58 reward
  events are queued and single-shot by the queue rules; the 12 direct grants set their varp in
  the same segment; final-step items are untradeable except Imp Catcher's beads (875 Magic).
- Dragon Slayer: no on-foot route to Elvarg; the Karamja-side wall needs `%dragon_wall`
  (`quests/quest_dragon/scripts/crandor.rs2:12-25`). Checked on the lab in section 7.
- Tai Bwo Wannai Trio (16,500 base, 6,500 of it Fishing) is missing from rs/3's plan; almost
  certainly off route. The Observatory's 875 bonus can be rerolled into Defence or Hitpoints.
- **Monkey Madness temple ladder drop (missed by C; found and measured by rs/59).** The
  ladder-top script drops the player onto their own tile one floor down,
  `p_teleport(movecoord(coord, 0, -1, 0))` (`quests/quest_mm/scripts/quest_mm.rs2:766-771`), and
  neither the bamboo ladders nor the trapdoor check a quest stage (`quest_mm.rs2:759-771`,
  `mm_temple.rs2:1-17`). In `maps/m43_43.jm2` a ladder sits at local (53,33) (`:7891`, loc 4772)
  and the trapdoor at (55,33) = (2807,2785) (`:7937`, loc 4879), so standing east of the ladder's
  top lands the player on the trapdoor's access tile inside the guard box (read; rs/59 gives
  the floor-1 top at jm2 line 9294). rs/59 measured 33-36 ticks against 102 for the documented
  route, about 670 expected ticks saved including the failure budget (`quest-speedrun.md` row 1
  on `agent/rs-59-coordinator-0`). It is an out-of-order *path*, not a reward exploit, which is
  why C's reward-label search did not find it; it is already measured and needs no child here.

**Economy ([economy.md](engine-sweep/economy.md)).**

- **Hassan's free jug of water** (`areas/area_alkharid/scripts/hassan.rs2:12-16`): unlimited,
  dialogue only, scales linearly with helpers that never start Prince Ali Rescue. Measured in #9.
- **Grapes are the binding wine input**: two spawns in the game (Cooking Guild, Phoenix Gang
  hideout), no shop, an empty GE. A second helper on the hideout spawn halves the wall time.
- Shop stock is shared and restock is a world clock, so N helpers at one shop pull what one
  pulls; only spreading across shops scales. Feathers restock 1 per tick at every fishing shop.
- Blood runes: buy the Magic Guild's 1,000 once (restock 40 an hour). Cosmic runes: Lundail holds
  20 + 120 an hour. Dragon bones have no free source (kills or GE).
- No duplication bug in the shop, water or wine scripts.

## 7. The LostCity record, mapped onto this sweep

rs/59's [`lostcity.md`](https://github.com/bleugreen/rs-sdk/blob/agent/rs-59-coordinator-0/docs/speedrun/research/lostcity.md)
(branch `agent/rs-59-coordinator-0`) lists the upstream project's known bugs and fixes that are
live in revision 289. Each live item against this sweep:

| rs/59 row | Live item | Sweep row | Note |
|---|---|---|---|
| 1 | Knife-on-logs `%action_delay` starter | D section 4 ("Knife-on-log tick manipulation") | guard confirmed by D; outside the xp census (it shortens gathering clocks, grants nothing itself) |
| 2 | Charge with no recast cooldown | A and B Charge rows; Table 2 Magic | same guard (`charge.rs2:8-12`), measured again in section 8 |
| 3 | Five user events per tick | D section 1.2; every "5 a tick" in Table 1 | the cap this page measures against; the refused-event rule is #6 |
| 4 | Wine bank fermentation (upstream TODO) | A wine row; Table 2; #10 | measured at Cooking 1 here |
| 5 | Optional level-up interface (rs-sdk PR, not enabled) | none: not in our revision | #4 measures what level-ups cost a delay-free burst today |
| 6 | Weak queue cleared when a dialogue resumes | D section 2.1 (weak queue row), overlap O7/O8 | affects weak-queue Make-X lines, not the delay-free rows; #4 |
| 7 | Irksol's cheap ruby rings | E, free source 6 | economy, 0 scored ticks |
| 8 | Miscellania coffer dupe (patched by rs-sdk) | outside the sweep | patched; economy |
| 9, 10 | Cannon damage-cap refactor; tick eating (open upstream PRs) | outside the sweep | not in our revision |

## 8. Top ten, verified (lab, `NODE_TICKRATE=300`, 3 samples each)

Script: [`speedrun/lab/measure-sweep.ts`](../../../speedrun/lab/measure-sweep.ts) (one probe per
row, `--probe=` to pick). "Tick k" counts published client ticks from the burst's tick; xp is
base xp (published xp / 25). All 3 samples agreed unless a range is shown.

| # | Candidate | Measured (3 samples) | Route step it would replace | Ticks saved | Basis |
|---|---|---|---|---|---|
| 1 | **Agility Arena tickets** | 5 presses of the 100-ticket button with 600 tickets in hand: all 5 landed on tick 1, 500 tickets spent, 140,000 base Agility in one tick (2 of 3; the third sample's trader interface did not open, a setup miss, so nothing was pressed). A trade offer of tickets was refused with "You can't trade this item." while coins in the same trade went through (3 of 3). A dropped ticket was visible to the dropper and not to the other player standing beside it (3 of 3) | none: Agility is rs/2's Wilderness course (7.4 base per tick) | **0, closed.** The button burst is real but supply is the scored account's own tags, one per 98-tick pillar move: about 2.9 base per tick of arena time, below the course | measured (burst, trade, drop); read (supply, `agilityarena_clerk.rs2:78-87`) |
| 2 | **Battlestaves** (air orb on battlestaff) | 14 fired at once: 5, 5, 4 per tick; 137.5 base each, so 687.5 base per tick inside the burst | rs/37 `crafting.md` dragonstone line from 55 (86 ticks 55 -> 99) | **0 while dragonstones are supplied.** rs/37 already measured the air-staff cycle (4.78 ticks per 14, 90 ticks 66 -> 99) and lists it as the fallback. It pays about 17 ticks over the diamond line (about 104 against about 121 from 42, rs/37) when dragonstones are unobtainable, which rs/37 says they are, provided helpers can supply 276 battlestaves and 276 orbs (828 cosmic runes) | measured (burst); route figures rs/37 |
| 3 | **Ugthanki kebab** | 13 fired at once: 5, 5, 3 per tick at both levels. Cooking 1: 11, 13 and 2 good of 13 (the roll `ugthanki_kebab.rs2:127` runs at the level reached so far, so one lucky early roll snowballs). Cooking 37: 13 of 13 good, 1,560 base, so 600 base per tick inside the burst. The three mixture steps (onion, tomato, meat into a bowl) each ran 5 a tick with no level and no xp | rs/37 `cooking.md` route 1 (wine, about 15-25 ticks); kebabs are its route 2 (131 ticks) | **0 while grapes hold.** One packet per kebab at the main when helpers make the mixture (4 if the main makes it). Per 100 wines short of 364 good ones, kebabs cost about 36 ticks against about 200 for sharks (rs/37), so they save about 160 ticks per 100 wines short over fish | measured |
| 4 | **Level-up dialogs in a delay-free burst** | 27 sapphires fired at once from Crafting 20: 5, 5, 5, 5, 5, 2 per tick, 31 levels gained, a level-up chat open on every tick of the burst. The Crafting 99 control cut on exactly the same ticks | every rs/37 delay-free burst | **0: nothing to save.** Each OPHELDU closes the open level-up chat (`clearPendingAction` -> `closeModal`) and runs, so a burst never stalls. rs/37's 14-23 tick bank gaps come from level-ups still pending at the booth, not from the burst | measured |
| 5 | **Inventory op with the bank open** | 27-gem bank cycle (deposit-All cut, withdraw-All uncut, 27 cuts, booth click in the last burst): **7, 7, 7 ticks** with a CLOSE_MODAL and **7, 7, 7** without (3 samples x 3 cycles each). Without the close the first cut closed the bank and ran, as D measured | the close in rs/37's bank cycle (`crafting.md` section 4) | **0 with the lite client.** The client fills OPHELDU item ids from its own inventory view, which shows the withdrawn gems a tick after the bank tick, so the first cut cannot ride in the bank tick either way, and the close only uses a spare slot (3 of 5) in a tick that has them. A client that wrote item ids blind could put 3 cuts in the bank tick and save about 1 tick per cycle (about 11-19 cycles per rs/37 skill), but that means changing the client under `server/`, which tenet 6 rules out | measured; saving with a raw client inferred |
| 6 | **Refused USER events on the CLIENT budget** | k refused IF_BUTTONs (the bank note toggle, component 5386, with the bank closed: "component not visible") fired ahead of 10 herb identifies. **At `NODE_TICKRATE=2000`: 5 + 5 identifies for k = 0, 5 and 10** (3 of 3 each). At 300 ms: 5 + 5 for k = 0 and 5; k = 10 split 1-2, 5, 3-4, because the lite client spaces its sends about 20 ms apart and 20 packets outlast a 300 ms tick | speculative sends (blind continues, retries into a delay) | **0 directly**; it licenses over-sending. Refusals cost CLIENT slots (20 a tick), not USER slots (5) (`NetworkPlayer.ts:141-147`) | measured. The 2,000 ms tick replaces the raw socket the brief asked for: the count rule does not depend on tick length, and a long tick lets 20 paced sends land in one decode |
| 7 | **One make-X completion per tick** | knife on logs, make-1, knife on logs, make-1 in one tick, then one identify a tick: the identifies sent on that tick and the next were **dropped**, the one two ticks later was accepted, and only **one** log was fletched (xp on tick 3, as in the one-completion control). Same at 300 ms and 2,000 ms (3 of 3 each) | rs/2's knife-on-log starter, which already answers one menu per tick | **0; it confirms the rule.** A second completion in the same tick costs its `p_delay(0)`: packets dropped for the rest of that tick and the next (`chat.rs2:734-738`, armed by `if_close` at `:1101-1119`). And the first completion's product is lost, because the second knife's `clearPendingAction` empties the weak queue its fletch was waiting in | measured |
| 8 | **Magic potion, Herblore 76+** | 14 fired at once at Herblore 76: 5, 5, 4 per tick; 172.5 base each (2,415 per 14), 862.5 base per tick inside the burst | rs/37 `herblore.md` ranging band (162.5) | **About 2-5 ticks.** If Zamorak potions are supplied it covers only 76-78: 7 potions instead of 8, under 1 tick. With the realistic ranging cap (no torstol) it replaces ranging from 76 to 99: 185 potions instead of 196, 11 fewer mixes (about 2 ticks) and up to one fewer 14-potion bank cycle (about 4-5 ticks). Needs about 185 potato cactus, whose supply E did not cost | measured (burst); xp arithmetic from the level table (`Player.ts:77-85`) |
| 9 | **Hassan's jug of water** | after one read-then-act pass to learn the pages (greeting, three-way choice, player line, NPC line, item box), a blind burst each tick of [continue, IF_BUTTON 2472 (`multi3:com_2`, "It's just too hot here"), continue, continue, Talk-to Hassan]: **1 jug per tick**, 10 jugs in 10 bursts, first to last 9 ticks (3 of 3). The Talk-to closes the item box and starts the next greeting in the same tick | rs/47's jug sourcing (economy.md finding 1: about 520 jugs at about 100 an hour from shops and spawns) | **0 scored ticks; about 5 helper-hours saved.** 27 jugs take about 28 ticks of dialogue; with the Al Kharid bank trip (about 33 tiles each way, inferred about 37 ticks with the bank tick) a cycle is about 65 ticks, so about **5,000 jugs per helper-hour**, linear in helpers. The choice cannot be answered by `sendClickDialog(0, {blind: true})` (a blind continue never answers a choice); it needs the raw IF_BUTTON on the static component | measured (dialogue); bank trip inferred |
| 10 | **Wine fermentation from Cooking 1** | 27 unfermented wines in the bank, Cooking set to 1, relog: fermented 19 published ticks after login (server tick 20); 17, 16 and 18 good; **base xp exactly 110 x good** in all three (1,870, 1,760, 1,980); level 1 -> 54-55. Beside fly fishing at Cooking 99 (no level-up chat), the timer fired 21 ticks after the wine was made while the loop, never re-clicked, kept catching after it in 2 of 3 samples (in the third the loop had stopped at tick 11, before the timer, consistent with the spot moving) | rs/37 `cooking.md` route 1 | **0: it confirms the canon.** No Cooking check at fermentation is now measured, not only read (D could not read the xp cleanly). O4 holds: a normal timer and a gathering loop grant in the same run | measured |

Also checked: **Dragon Slayer wall** (C finding 1). Standing at (2836,9599) with
`%dragon_wall` = 0, "Open" on loc 2606 at (2836,9600) gave "Nothing interesting happens." and
the player stayed on (2836,9599) (3 of 3). The ship is mandatory, as C read.

**Host and method.** Executor bgsrv-mac (macOS arm64), stock headless lite client, this branch
(rs/61 base plus rs/92's lab script), `speedrun/lab/lab.sh` on port block 9350 (web 9350,
management 9351, hiscores 9352, node 44050, gateway 8350), `LOCAL_STAFF_LEVEL=4`. Bots `srlab92a`
(measured) and `srlab92b` (trade and drop partner, own client launched by the script). Commands:

```
LAB_BOTS=srlab92b NODE_TICKRATE=300 WEB_PORT=9350 WEB_MANAGEMENT_PORT=9351 HISCORES_WEB_PORT=9352 \
  NODE_PORT=44050 AGENT_PORT=8350 speedrun/lab/lab.sh srlab92a 'speedrun/lab/measure-sweep.ts:--n=3:--helper=srlab92b'
NODE_TICKRATE=2000 ... speedrun/lab/lab.sh srlab92a 'speedrun/lab/measure-sweep.ts:--probe=refused,makex:--n=3'
```

Lab gotchas found on the way (measured):

- `sdk.sendUseItemOnItem` refuses client-side while the bank is open (`sdk/index.ts:1188-1194`);
  probe #5 sends the same client action without that guard. The server accepts it.
- A helper relaunched by a script while `lab.sh` also runs a lite runner for it ends in
  "Connection closed": give the helper `LAB_BOTS` (no runner) and launch its client from the
  script.
- `::give` of a name shared by two objs (good and bad ugthanki kebabs are both "Ugthanki kebab")
  must be counted by obj id; the script does.
