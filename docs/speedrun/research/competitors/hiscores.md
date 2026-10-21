# How the accounts above us maxed: evidence from the demo hiscores

Scraped from the public rs-sdk-demo hiscores (read-only web pages; no game account was
touched). Tool: `speedrun/tools/hiscore-scrape.ts`. Raw data: `data/` next to this file.
First snapshot **2026-10-21 08:04 UTC** (`data/snapshot-2026-10-21T080427Z.json`): the overall
board ranks 1-315, ranks 1-42 of every skill board and Quest Points, the bank board (top 50 and
39 item searches), the equipment board (top 50), and 233 player pages (the overall top 25, the
top 10 of every board, every stun*, nick*, lach*, soko*, zayne*, asukalabs* account seen
anywhere, and the names in the brief). Seven climber passes followed, 08:12 to 09:54 UTC
(section 5); the last ranked-board pass is `data/boards-2026-10-21T093926Z.json`.

Ticks are 300 ms server ticks. "Base xp" is the unit our route documents use (game xp / 25;
level 99 is 39,938 base). Quest xp converts to levels with the server curve
(`Player.ts` `levelExperience`): 875 base is level 44, 1,300 is 49, 9,612 is 78, 13,750 is 83.

## 1. What a stamp means, and how to tell a true one from a fallback

From the engine audit (`docs/speedrun/playtime-audit.md` on the rs/28 branch): each skill row
stores `levelPlaytime[stat]`, the counter value when the current level was reached (save
version 9, upstream `55fa26cca`, committed 2026-10-18 22:31 -04:00). Rows are written only when
a logout save reaches the login server, and only when the level changed. A level reached on a
save older than version 9 has stamp 0, and its row falls back to the **logout playtime** of that
save, which is later than the true tick. Overall is the maximum of the per-skill stamps (it falls
back to logout playtime only when every stamp is 0). A skill has a row only from level 15.
rs/72 confirmed this live on 2026-10-21 (write-up: `hiscore-timestamps.md` on its branch): the
demo runs `55fa26cca`, deployed on or after 2026-10-19 02:31 UTC; a row stores the tick the level
was reached; nothing is published while the player is in the world, autosave included; rows
land at logout. **Levels reached before that deploy carry logout stamps.**

A second date matters for reading old accounts: the demo moved from LostCity revision 274 to
289 (the January 2005 content) on 2026-10-09 (upstream `8601955c`). Accounts trained before that
ran different content scripts, so an old method may no longer exist.

Two facts the audit does not spell out, read from the data:

- **The Quest Points row is not a level stamp.** It carries the playtime of the save that wrote
  it (rs/72: "QP is stamped at the save, never at a reach tick"). stunherblore shows Herblore 99
  at 465 and its 4 quest points at 468, although the quest must come first. Read a QP time as "the
  quests were done by then", nothing more; a skill stamp equal to the QP stamp is a logout value.
- **Every stamp is an upper bound on the true reach tick.** A true stamp is exact; a fallback is
  later. So "account X reached 99 by tick T" is always safe to read off a page, and every
  comparison below that says an account beats us is conservative.

Classification used in the tables, from the pattern alone:

| Pattern | Reading |
|---|---|
| One value on every row (gh_kadeski, asukalabs, sokobot, most of the top 25) | **fallback, one logout**: the whole account was trained on a pre-version-9 save and the board shows the playtime of the logout that wrote it |
| A few values, each shared by many unrelated skills (stunbaron: 3 values over 19 skills) | **fallback, logout batches**: one batch per logout; a skill's row sits in the batch of the last logout in which its level changed |
| Mostly distinct values (nickoverall: 15 values over 19 skills) | **probably exact reach ticks**: exact only if the levels were reached after the version-9 deploy, which the page cannot show (rs/72, `hiscore-timestamps.md`). Small identical groups can still be genuine (Attack, Defence and Strength hit 99 on the same tick under the controlled style); a tie between unrelated skills, such as nickoverall's Crafting and Herblore, is more simply a logout value |

The four stun accounts and gh_kadeski, five of the six accounts ahead of our best case, are
therefore **upper bounds**, not the tick they maxed: stunbaron's 35,916 is the playtime of a
logout at or after its last level-up. Only nickoverall's 45,443 is probably an exact reach tick.

## 2. Per-account ordering

Ordering is by stamp. "Gap" in the text is the ticks between consecutive stamps: it equals the
time on that skill only if the skill was trained alone, from scratch, in that window. Earlier
partial training makes it an underestimate; other skills trained in the window make it an
overestimate. Levels are 99 unless shown.

### 2a. The overall top 25 (all at total 1,881)

| # | Account | Overall ticks | Stamps | Ordering (stamp: skills) |
|---|---|---|---|---|
| 1 | stunbaron | 35,916 | fallback, logout batches | 12,006: Pray, WC, Fish, Mine; 17,697: Fletch, FM, Craft, Smith, Herb, QP 13; 35,916: Atk, Def, Str, HP, Rng, Mag, Cook, Agil, Thiev, RC |
| 2 | stunhard | 36,246 | fallback, logout batches | 12,507: Pray, WC, Fish, Mine; 18,156: Fletch, FM, Craft, Smith, Herb, QP 13; 36,246: Atk, Def, Str, HP, Rng, Mag, Cook, Agil, Thiev, RC |
| 3 | stunless | 36,325 | fallback, logout batches | 12,697: Pray, WC, Fish, Mine; 18,358: Fletch, FM, Craft, Smith, Herb, QP 13; 36,325: Atk, Def, Str, HP, Rng, Mag, Cook, Agil, Thiev, RC |
| 4 | stunking | 38,597 | fallback, logout batches | 12,070: WC, Fish, Mine; 18,920: Pray, Fletch, FM, Craft, Smith, Herb; 38,597: Atk, Def, Str, HP, Rng, Mag, Cook, Agil, Thiev, RC; 65,804: QP 33 |
| 5 | nickoverall | 45,443 | **probably exact** (Atk/Def/Str shared tick; Craft/Herb tie may be a logout) | 312: Fletch; 2,698: Craft, Herb; 2,725: Pray; 7,653: WC; 8,470: FM; 18,421: Atk, Def, Str; 18,864: HP; 21,269: Rng; 22,087: Mag; 26,675: Thiev; 27,210: QP 6; 30,033: Smith; 32,229: RC; 34,650: Fish; 34,821: Cook; 40,127: Mine; 45,443: Agil |
| 6 | gh_kadeski | 46,681 | fallback, one logout | 46,681: every skill, QP 8 |
| 7 | asukalabs1 | 198,277 | fallback, one logout | every skill, QP 4 |
| 8 | asukalabs | 423,135 | fallback, one logout | every skill, QP 4 |
| 9 | zayne | 639,986 | mixed | 224,513: Atk, Def, Str, HP, Cook, WC, Fletch, Fish, FM, Thiev; then one skill per stamp: Mine, Rng, Agil, Craft, RC, Mag, Smith, Herb, Pray (639,986) |
| 10 | claudefable5 | 670,390 | fallback, one logout | every skill, QP 5 |
| 11 | codexastra | 955,124 | fallback, one logout | every skill, QP 14 |
| 12 | 0hyl8lmri | 1,381,283 | fallback, logout batches | 1,248,171: Atk, Def, Str, HP, Cook, Fish, Thiev; 1,381,283: the rest; QP 135 |
| 13-25 | skylordafk, sokobot, simplereally, soko, nickai, inaribot1, vends, syn, eja620, bimmyglm53, claude46, jackthief, bimmydsv4 | 1.44M-5.70M | fallback (one logout, except bimmyglm53's six batches) | casual or AFK accounts; nothing to learn about speed |

Only six accounts are within reach of our model (expected 45,282, best 34,894): the four stun
accounts, nickoverall and gh_kadeski. The seventh is at 198,277.

### 2b. Partial and sibling runs of the same operators

| Account | Total | Overall ticks | Stamps | Ordering |
|---|---|---|---|---|
| stunlord | 797 | 13,997 | fallback, batches | 1,607: QP 3; 11,433: WC, Fish, Mine, Agil 49; 13,997: Mag 80, Cook 61, FM, Craft, Smith 93 |
| stunfast | 893 | 17,743 | fallback, batches | 1,913: QP 3; 15,057: Pray, WC, Fish, Mine, Agil 49; 15,891: Cook 65, FM; 17,743: Mag 80, Craft, Smith 85 |
| stunmaxing | 414 | 9,362 | fallback, one logout | 1,828: QP 3; 9,362: Mag 46, WC, Fish 74, FM 31, Mine, Agil 43 |
| nickmax | 1,783 | 51,152 | probably exact (Pray/Craft/Herb tie at 2,037 is likely a logout) | 287: Fletch; 2,037: Pray, Craft, Herb; 7,490: WC; 8,494: FM; 18,580: Atk, Def, Str; 21,398: HP, Rng; 22,179: Mag; 32,746: Thiev; 33,251: QP 6; 38,095: Mine; 44,781: Agil; 47,009: Smith; 48,634: RC; 51,152: Fish (Cooking still 1) |

### 2c. What the orderings say

**The stun route (stunbaron, stunhard, stunless, stunking, and the partial stunlord and
stunfast).** All four maxed accounts run the same script in three logged sessions. The batch
boundaries are logouts, so they give upper bounds on three cumulative milestones:

| Milestone | stunbaron | stunhard | stunless | stunking | Our ledger for the same set |
|---|---|---|---|---|---|
| 3 quests, then Prayer, Woodcutting, Fishing, Mining 99 | ≤12,006 | ≤12,507 | ≤12,697 | ≤12,070 (Prayer later) | ~12,200: Doric's + Sea Slug + Fishing Contest ~670, Mining 3,765, Fishing 3,410, Woodcutting 3,500, Prayer 850 (expected) |
| + Fletching, Firemaking, Crafting, Smithing, Herblore 99 and quests to 13 QP | +≤5,691 | +≤5,649 | +≤5,661 | +≤6,850 | ~1,930 skilling (Smithing 940, Firemaking 740, the four delay-free skills 250) plus whatever quests the stun set holds |
| + Attack, Defence, Strength, Hitpoints, Ranged, Magic, Cooking, Agility, Thieving, Runecraft 99 | +≤18,219 | +≤18,090 | +≤17,967 | +≤19,677 | ~27,700 by the tally (which still carries Merlin + Holy Grail and the Regicide and troll chains); ~22,200 by the newer quest README route (below) |

Reading:

- **The stun route does almost no questing: 13 quest points in total, all done by the second
  logout, and no quest points after it** (stunking's 33 QP were saved at 65,804, long after it
  maxed, so its extra quests came afterwards). stunlord and stunfast show the first 3 QP done by
  ~1,600-1,900 ticks, before any gathering 99. Doric's Quest, Sea Slug and Fishing Contest (one
  QP each) are the obvious three, and match what our route takes for the same skills. A
  consistent guess for the other 10 is Imp Catcher (1), Waterfall (1), Druidic Ritual (4), Tree
  Gnome Village (2) and Fight Arena (2), because their single-skill siblings show exactly those
  xp signatures (section 3). That set excludes Monkey Madness, the Grand Tree, Dwarf Cannon,
  Plague City and Merlin's Crystal. Confidence: medium for "few quests", low for the exact set.
- **Gathering is at parity with our model.** ≤12,006 for three quests and four gathering 99s
  against our ~12,200. Prayer sits in the gathering batch on three of the four accounts, which
  fits burying bones inside gathering wait ticks (rs/38's idea), though a logout batch cannot
  prove the interleaving.
- **The artisan block is at parity or slower.** ≤5,700 including about 10 QP of quests.
- **The whole gap is in the last session.** Ten skills, most of them combat plus Agility, in
  ≤18,000-19,700 ticks with no quest xp after it began. For the same set the tally (snapshot
  2026-10-20 21:15) costs ~27,700, a gap of ~9,500, which is all of the ~9,400 between our
  expected 45,282 and stunbaron's 35,916. The tally is stale here: `quests/README.md` (rs/3
  branch) has since dropped Merlin's Crystal, Holy Grail and the Regicide and troll chains. Its
  route prices the same set at about **22,200** expected (Tree Gnome Village, Monkey Madness,
  Dwarf Cannon and the cannon-led combat finish ~10,190; Grand Tree 1,660; Waterfall 888; Fight
  Arena 771; Mage Arena 581; Thieving ~1,952; Agility 4,817 after the Grand Tree; Runecraft
  ~1,100; Magic ~205; Cooking ~47), **still ~4,000 behind stun**. The hiscores cannot say how stun
  trains combat this fast; section 6 frames it as the first question for the lab and for in-game
  observation. The bound is generous to them (some of these skills may have had partial
  progress in the first two sessions), but the first two sessions are already at parity with us,
  so that progress cannot have been large.
- **Their own single-skill rates cannot explain that session either.** Priced at the stun
  family's single-skill times (section 3), the non-combat part is Agility 49-99 ~6,500
  (stunagile 6,772 less the ~3% of xp below 49), Thieving ~3,250 (stunthief), Runecraft ~2,400
  (stunrc), Magic and Cooking ~650: about 12,800. That leaves at most ~5,400 ticks for Attack,
  Defence, Strength, Hitpoints and Ranged, even if Waterfall, Tree Gnome Village and Fight Arena
  had already put Attack near 92 and Strength at 83. stundefence alone took ~6,700 ticks for
  Defence 1-99, and stunhitpoint's Strength 83-99 (~3,700 ticks, about 7.2 base per tick) is
  slower than our measured ogre rates. So the max accounts either gain combat xp several skills
  at a time from one source, or did much of their combat inside the first two sessions in a way
  the batches hide. Either answer is worth having (Q1).

**nickoverall is the one readable max.** Its stamps are probably exact reach ticks (exact if it
maxed after the version-9 deploy; rs/72), so its gaps are segment times if it trained
sequentially, and it lands at 45,443, almost exactly our
expected 45,282. Against our ledger, segment by segment:

| nickoverall segment | Ticks | Ours | Who is faster |
|---|---|---|---|
| Fletching, Crafting, Herblore, Prayer 99 | 2,725 | ~1,070 (48 + 80 + 89 + 850) | us |
| Woodcutting | 4,928 | 3,500 expected, 3,030 with knife | us |
| Firemaking | 817 | ~650-740 | us |
| Attack, Defence, Strength (one controlled-style block), Hitpoints, Ranged, Magic | 13,617 | ~13,950 (the combat quests, Ranged and Magic) | parity, with no quests on their side |
| Thieving (its 6 QP were saved by 27,210, so quests may sit in this window or the next) | 4,588 | 1,950 after Fight Arena | us |
| Smithing | 3,358 | 940-1,147 | us |
| Runecraft | 2,196 | 1,100-1,330 | us |
| Fishing | **2,421** | 3,410 from 78 (expected) | **them, by ~990**, if Sea Slug and Fishing Contest are among its 6 QP |
| Cooking | 171 | ~47 | us |
| Mining | 5,306 | 3,765 | us |
| Agility | 5,316 | 4,695 after the Grand Tree | us, but only with the Grand Tree |

nick's combat block is the useful reference: **six combat skills to 99 in ~13,600 ticks by plain
training with at most 6 QP**, as fast as our quest-heavy combat. The stun route must beat that by
several thousand ticks.

## 3. Per skill: fastest observed 1 to 99 against our model

Single-skill accounts (total 126: one 99, 17 skills at 1, Hitpoints 10) give an operator's
whole-account time for one skill from a fresh character, including walking, banking and any
quest they did first. Their one row cannot be classed true or fallback, but either way it is an
upper bound. "Ours" is the pure 1-to-99 figure from the route documents (rs/2 and rs/28 skill
documents, `interleaving.md`) where one exists, and the in-route figure from the tally otherwise.

| Skill | Fastest observed (ticks, upper bound) | Runners-up | Ours | Gap (theirs - ours) | Inferred method (basis) | Confidence |
|---|---|---|---|---|---|---|
| Attack | stunattacker **4,728** (Strength 83 at 1,248 = Waterfall; QP 4 by 3,427) | stunhitpoint 8,498, nickstriker 10,193 | ~4,390 pure (inferred); 0 extra in route (quest-capped) | +340 | Waterfall, then one more Attack quest (Tree Gnome Village or Fight Arena: 25,200-25,925 base = level 92), then melee to 99 | medium |
| Defence | stundefence **7,974** (Attack and Strength 83 at 1,273 = Waterfall) | nickwarden 9,814 | ~4,248 pure with Atk/Str 99; ~3,520 shared in route | n/a (different start) | Waterfall, then defensive melee 1-99 | medium |
| Strength | stunhitpoint **4,966** (Waterfall first) | stunstrong 7,553, nickflex 8,284 | ~4,898 pure with Atk 99; 0-522 in route | ~+70 | Waterfall, then aggressive melee 83-99 | medium |
| Hitpoints | stunhitpoint **17,058** (after Strength and Attack 99) | nickoverall 18,864 inside a max | by-product (Monkey Madness gives 35,000) | n/a | melee by-product | high |
| Ranged | nickslinger **5,595** (Hitpoints 82) | nickknives 7,477, lachrange002 8,918 | ~2,200 cannon pure, ~5,270 knives pure | +325 against knives | knives (bank shows nick holds rune, mithril and iron knives) | medium |
| Prayer | stunpray **1,281** | nickprays 2,028, lachpray001 2,224 | 1,151-1,221 | **+60 to +130** | bury dragon bones (dragon-bone stockpiles on the bank board) | high |
| Magic | stunmage **1,513** (Prayer 38 at 197, QP 1 by 492, Hitpoints 36 at 1,410) | nickmagi2 3,416, edwardmage1 10,045 | ~1,115 (Mage Arena 575 + enchant/Charge 540) | +400 | Protect from Magic (37), Mage Arena (the Hitpoints 36 is the Kolodion fight), Charge | medium |
| Cooking | jackalopeck3 **38** | stuncook 51, stuncookv2 53 | ~47 | **-9** | wine fermentation (stuncook banks 5K jugs of bad wine and 2K of wine) | high |
| Woodcutting | stunwc **3,653** | nickwc 5,324 | 3,960 no knife, 3,030 knife; tally 3,500 | -307 against our no-knife doc, +153 against the tally, +623 against the knife | unknown; faster than a plain 4-tick cycle, slower than our knife model | low |
| Fletching | stunfletch **66** | nickfeather 98, lachbow003 136 | ~48 | +18 | rune arrows (stun accounts bank ~2,580 rune arrows and 30 rune arrowtips each; asukalabs holds 36K headless arrows) | high |
| Fishing | stunfish **3,956** total (Firemaking 31 at 85 for Sea Slug, QP 2) | nickcaster 5,536 pure, jadefish 5,780 | ~4,030 with the same two quests (617 + 3,410); ~2,617 knife | **-74** against our expected | Sea Slug + Fishing Contest, then fly fishing; nickoverall's 78-99 in ≤2,421 points to a 3-tick or knife cycle | medium |
| Firemaking | jackalopefm4 **706** | stunfiremake 836, nickember 1,382 | ~650 measured | +56 | highest-tier logs | high |
| Crafting | nickgemcut **197** | crab26eba2 536, nickcrafti 580 | ~80 (gem cutting, `interleaving.md`) | +117 | gem cutting up to dragonstone, fed by 12 mule accounts (nickgem02-13) each holding 108 uncut dragonstones; nickcraft banks 783 sapphires | high |
| Smithing | stunsmither **1,337** | nickcrucible 1,839 | 1,107-1,147 measured | +190 | helper-fed anvil smithing | medium |
| Mining | stunmine **4,575** (Magic 45 at 136, QP 2 by 269) | nickquarry 6,015, lachmine003 8,374 | after Doric's Quest alone: ~3,390 with knife, ~4,060 without (`mining.md` section 2); 3,621 pure with knife | its mining after the quests (done by 269) is ≤~4,300: +240 against our no-knife figure, +910 against the knife | Doric's Quest (Mining 49) plus a second 1-QP quest (Imp Catcher fits Magic 45), then iron. **nickquarry is explained**: rs/2 `mining.md` section 4a, "The nickquarry mystery": Doric's Quest, then iron, emptying the rock at every ore on a busy server, 1.7x slower than our model. stunmine is faster than nickquarry but still slower than our no-knife model, so no gap remains | medium |
| Herblore | stunherblore **465** (incl. Druidic Ritual, QP 4) | jackalopehl1 1,146 (QP 4 by 630) | ~89 | +376 | ranging potions (stunherblore and all four stun max accounts bank 196-210 ranging potions(3)); both competitors did Druidic Ritual first, which this server does not require (`identify.rs2`: "early osrs had no druidic ritual check"; no quest check in mixing either) | high |
| Agility | stunagile **6,772** (Prayer 43 at 67) | nickagility 8,476 | 6,960 pure (inferred, `agility.md`); 4,695 after the Grand Tree | **-188** against pure | Prayer 43 first (protect prayers), which points at the Wilderness course | medium |
| Thieving | jackalopeth8 **2,935** | stunthief 3,253, nickpilfer 3,961 | 2,840 pure (55-99 measured, 1-55 inferred) | +95 | pickpocketing; our 1-55 is unmeasured, so call it parity | medium |
| Runecraft | stunrc **2,397** | nickaircraft 3,265 | ~1,330 helper-fed | +1,067 | not visible | low |

**Where someone beats us, per skill:** Cooking by 9 ticks (noise), Fishing by ~74 against our
expected (and nickoverall's 78-99 segment by ~990), Agility by ~188 against our pure figure,
Woodcutting by ~307 against our no-knife document only. On every other skill our modelled
method is as fast or faster than the best single-skill account on the server. **Per-skill
speed is not where we lose; composition is** (section 2c).

Other per-skill notes:

- **Magic 44-48 within the first ~140-1,300 ticks** recurs on stun accounts trained for other
  skills (stunmine, stunfish, stunattacker, stundefence, stunstrong, stunhitpoint, stunmaxing).
  Imp Catcher's 875 base is exactly level 44, and Imp Catcher with Witch's Potion (1,200 base) is
  48. It looks like a fixed stun opening, not a speed trick.
- **Prayer 43 at 67-197 ticks** opens every stun combat and Agility account: 787 base, which is
  eleven dragon bones, the same opening our route plans.

## 4. Bank and equipment boards

The bank board reflects the latest save; equipment is what is worn.

- **Stun leftovers are identical across all four maxed accounts and the single-skill
  siblings**: about 2,580 rune arrows and 30 rune arrowtips, 210 ranging potions(3) with 14
  attack and 14 defence potions, and a handful of opals. Same script, same supplies, fed from
  outside (none of them gathers these materials).
- **Feeder economies:** nick runs gem mules (nickgem02-13, 108 uncut dragonstones each) and
  nickai3 is a warehouse (1.9B air runes, 248M mind runes, 7M raw shark, 163K uncut sapphires,
  90K uncut emeralds, 45K uncut rubies, 11K uncut diamonds, 2,710 uncut dragonstones, 44,701
  cosmic talismans, 3,770 rune arrowtips). The soko and sokoherb families hold thousands of
  bones each; asukalabs holds 36K headless arrows, 258K bow strings and 138K yew logs.
- **Stockpiles that matter for our helper plans:** grapes are scarce (the largest holder has
  1,911; nickai3 1,633), so the ~450 grapes for wine are still available but not abundant.
  Wine of zamorak sits in ~2K stacks on the goo* farm. Dragon bones: tygem053-091 hold 3-5K
  each. Rune essence: 4.1M (anduril), 3.3M (stein). There is no pure essence on any bank.
- **Equipment:** the top two (nickai3, soko) wear identical dragon gear; ranks 6-25 are the goo*
  farm in identical berserker/dragon outfits. Nothing speed-relevant.

## 5. Climbers

**No competitor climbed during the window, so there are no progression rates to report.**

What was watched: seven passes, 08:12 to 09:54 UTC (01:12 to 02:54 PDT), about 17 minutes apart.
Each pass re-read every non-maxed account from the first snapshot plus every overall-board
account under 1.3M ticks (238 player pages), from 09:20 also the 29 family accounts that
`/playerpositions` showed online (267 pages), and every ranked board (overall ranks 1-315, ranks
1-42 of each skill board and Quest Points). `hiscore-scrape.ts diff` against the first snapshot
found **no changed row on any watched player page in any pass**.

Every row that moved on the boards in the window:

| Pass (UTC) | Board | Account | Change | Reading |
|---|---|---|---|---|
| 08:15 | Overall | dotsbot73 | 1,486 to 1,487 at 2,762,684 | slow farm account |
| 08:31 | Overall | dotsbot41 | 1,482 to 1,516; stamp +18,237 | 18,237 ticks is longer than the 27-minute window: one long session written at logout |
| 08:48 | Mining | cairn_h20 | new 99 at 48,363 | one of our helpers |
| 08:48 | Quest Points | dotsbot6 | new row, 83 QP | slow |
| 09:22 | Overall | dotsbot60, dotsbot69, dotsbot80 | +40, +3, +7 levels at 2.68-2.81M | slow |
| 09:39 | Thieving | cairn_h66, cairn_h67, cairn_h68 | new 99s at 8,913-10,131 | ours |

Why the window was empty, and what that means for the next attempt:

- **The boards are blind to a bot mid-session.** Rows land only at logout (rs/72), and dotsbot41
  shows a whole ~91-minute session arriving at once. A competitor maxing in one session would
  appear only when it finishes. Climbers have to be found on `/playerpositions` (every online
  name and tile) and then read on the boards after they log out.
- **The fast operators were offline.** At 09:03 and 09:57 UTC no stun* account was online (1,640
  and 1,670 players), and nick had only nickai (a 1.89M-tick max that idles). The jackalope
  operator had ~20 accounts online. Their tiles (`data/positions-2026-10-21T090330Z.json`) are
  banks, the Body altar, Taverley dungeon and the Cooks' Guild upper floor (jackalopevin, a
  likely grape source for wine). Their pages show feeders and utility accounts. The fastest
  figure among them is jackaloperc1, Runecraft 93 by 3,421, which is on pace for about 5,200 to
  99 and slower than stunrc. Their rows did not move in 50 minutes online, which is consistent
  with not having logged out.
- **Re-run when a stun account is online.** `players` on stunfast, stunlord and stunmaxing after
  they log out would give true (version 9) stamps for the part of the stun route the batches
  hide. That is the cheapest available evidence for Q1. rs/60 has the list (message of 01:35
  PDT).

## 6. Questions for the lab

**Q1. How does the stun route finish ten skills in ≤18,000 ticks with no quests?** (worth
~4,000 ticks against the current quest README route, ~9,500 against the tally.) After their
second logout the stun accounts take Attack, Defence, Strength, Hitpoints, Ranged, Magic,
Cooking, Agility, Thieving and Runecraft to 99 in at most 17,967-19,677 ticks, with no quest
points gained. Our quest-led plan for the same set costs ~22,200, and nickoverall's
plain-training combat alone costs ~13,600. Candidates to test, in
order of plausibility: (a) a combat method that levels several styles and Ranged at once at a
much higher damage rate than our ogres (multicannon plus melee in a dense multi-combat spot;
we have measured cannon only at poison spiders), (b) Agility on the Wilderness course from
level ~49 under Protect from Melee (the stun Prayer 43 opening), faster than our modelled
5,726 for that leg, (c) Magic 80-99 by Charge as in our route. The in-game observer (rs/71)
should watch any stun account that is mid-run; the hiscores cannot split this session.

**Q2. Is Fishing 78-99 in ~2,400 ticks real at scale?** (worth ~1,000 ticks against our expected.)
nickoverall's (probably exact) stamps put Fishing 99 2,421 ticks after its previous 99, with 6 QP banked
earlier. If those include Sea Slug and Fishing Contest, that is our modelled "best" (3-tick or
knife cycle, ~2,000) achieved on the live server, against the 3,410 our ledger expects. The lab
test is the 3-tick fly-fishing cycle on the demo's actual load (rs/53).

**Q3. Should the route drop quests that only buy combat xp?** (worth several thousand ticks if
Q1 resolves.) stun maxes with 13 QP and nick with 6 QP; our route holds 18 QP, including
Monkey Madness, the Grand Tree and Dwarf Cannon. Their value in `quests/README.md` assumes our
measured melee rates; if Q1 finds a faster combat method, each quest's tick saving must be
recomputed against it.
