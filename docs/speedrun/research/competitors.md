# Competitors: how the accounts above us reached their times, and what they do that we do not

This is the synthesis of the four competitor section documents beside it:

| Section | Question | Issue |
|---|---|---|
| [competitors/hiscores.md](competitors/hiscores.md) | Scrape of the demo hiscores and a per-account reconstruction | rs/69 |
| [competitors/public-code.md](competitors/public-code.md) | Published code, routes and writeups by other participants | rs/70 |
| [competitors/observation.md](competitors/observation.md) | In-game observation with a throwaway observer, plus position tracking | rs/71 |
| [competitors/hiscore-timestamps.md](competitors/hiscore-timestamps.md) | What a hiscore time means, tested live | rs/72 |

Raw data: [competitors/data/](competitors/data/) (hiscore snapshots, board passes, bank
searches, positions, the climber watchlist) and
[competitors/observation-data/](competitors/observation-data/) (per-leg summaries, events, chat,
position tracks).

**Our model** is the newest snapshot of the tally ledger (`cairn://p/rs/main/db`, table `tally`,
`at` = 2026-10-21 04:20): **38,742 ticks expected, 31,324 best**. The section documents were
valued against the 2026-10-20 21:15 snapshot (45,282 / 34,894) and an earlier quest route; this
page re-prices every comparison against 04:20 and says where a conclusion changes. **The record**
is stunbaron at **35,916**. A read of the live overall board on 2026-10-21 at about 11:30 UTC
showed the same top 21 in the same order as the 08:04 UTC snapshot.

Ticks are 300 ms server ticks of logged-in playtime. The server is LostCity revision 289 (the
January 2005 content), not May 2004; the demo moved from revision 274 to 289 on 2026-10-09.
"Gap" always means the competitor's lead over our **expected** figure, in ticks; our best case is
given beside it. Confidence is high, medium or low, as in the section documents.

## 1. Answer in brief

**Who is ahead.** Against the 04:20 model only the four stun accounts beat our expected time
(stunbaron ≤35,916, stunhard ≤36,246, stunless ≤36,325, stunking ≤38,597). nickoverall (45,443)
and gh_kadeski (46,681) are now behind it, and no account on the board beats our best case. The
next account after those six is at 198,277
([hiscores.md](competitors/hiscores.md) section 2a).

**How the stun accounts got under 36,000 ticks (three hours).** All four ran one script in three
logged sessions: about three quests and the four gathering 99s (Prayer, Woodcutting, Fishing,
Mining) in at most ~12,000-12,700; the five artisan 99s and quests to 13 points in at most a
further ~5,650-6,850; then Attack, Defence, Strength, Hitpoints, Ranged, Magic, Cooking, Agility,
Thieving and Runecraft in at most ~18,000-19,700, with no quest points gained
([hiscores.md](competitors/hiscores.md) section 2c). The materials are fed from outside: every
stun account, including the single-skill siblings, banks the same leftovers of about 2,580 rune
arrows and 210 ranging potions ([hiscores.md](competitors/hiscores.md) section 4). Their single-skill
siblings show no knife-style tick manipulation: Woodcutting and Fishing sit near our normal-cycle
figures and well above our knife figures. Prayer 99 lands inside the gathering session on three
of the four. **Confidence:** high that this is one helper-fed scripted route in three sessions;
medium that it does very few quests (13 QP); low on which quests, and low on how the last session
trains combat.

**Every stun time is an upper bound.** Their stamps are logout values written under the old rule,
so each true reach tick is at or before the number shown. Only nickoverall's and nickmax's
distinct stamps are probably exact, and that is not proven ([hiscore-timestamps.md](competitors/hiscore-timestamps.md)
section 3). For ranking this changes nothing: the number to beat is 35,916.

**Where they beat us: composition, not per-skill speed.** On skill and quest lines alone our
expected model sums to **35,942**, 26 ticks above the record. The whole expected gap of 2,826 is
our overhead allowance of 2,800 (banking, trades and travel 1,500; contention 1,000; demo latency
300), which the stun totals already contain. Split along the stun sessions (section 3, second
table), we lose about 1,460 in the gathering session, mostly because the tally prices Prayer at
700 where stun shows it absorbed into gathering. We win about 3,260 in the artisan session. The
last session is behind by somewhere between about 210 and about 1,830, depending on whether
Tree Gnome Village and Fight Arena were done in stun's second session (section 4, row 2). Per
skill, the only places any account beats our expected figure are Fishing (nickoverall's 78-99
segment by ~990; stunfish by ~100), Woodcutting (stunwc by ~305), Cooking (~42) and Firemaking
(~34). Our best methods are faster than every one of them. **Confidence:** high on the
arithmetic; medium on the split, because the session boundaries are logouts.

**What this means for us.** The record falls on our best case (31,324, ahead by ~4,590), and the
best case depends on two things the competitors do not show: the knife loops working on the demo
(about 3,010 ticks, rs/95 and rs/97 in progress) and overhead well under its allowance (the run
order). The competitor evidence adds three things. First, Prayer can be absorbed into gathering
at no visible cost, which also shows the tally's two Prayer figures sit in the wrong columns
(section 7, item 2). Second, an account on the live server took Fishing 78-99 in at most 2,421,
which is evidence that a faster-than-normal cycle holds on the demo. Third, the stun combat
method is the one thing we cannot reconstruct; it is worth a few hundred ticks on the likeliest
reading, and watching a stun run is the cheap way to settle it. Nobody above us has published
code or a writeup ([public-code.md](competitors/public-code.md) section 1). The in-game watch found
no stun account online and no technique with a positive tick estimate
([observation.md](competitors/observation.md), Summary).

## 2. What a hiscore time means

From the live test in [hiscore-timestamps.md](competitors/hiscore-timestamps.md) (throwaway
`cairn_hsp1`, 2026-10-21):

- **A skill row stores the playtime tick at which the current level was reached**, not playtime
  at logout. Upstream commit 55fa26cca (save version 9) is live on the demo. Proof: Woodcutting 17
  was reached at client tick 72 of a session that began at playtime 6,261, and the row reads
  6,333. The session lasted at most ~220 ticks, so the logout rule cannot produce that value
  (section 2 there).
- **Overall is the largest skill stamp.** It falls back to logout playtime only while every stamp
  is 0.
- **Rows are written only at a clean logout**, and appear about 3 s after it. Nothing moves while
  the account is in the world, including across a 1,500-tick autosave.
- **The Quest Points row is stamped at a save** (autosave or logout), never at the tick a quest
  finished. A skill stamp equal to the QP stamp is therefore a logout value
  ([hiscores.md](competitors/hiscores.md) section 1).
- **Levels reached before the deploy show logout playtime.** 55fa26cca has been live since some
  time between 2026-10-19 02:31 and 2026-10-21 08:33 UTC, most likely 2026-10-19 (inferred).
  Every stamp, true or fallback, is an upper bound on the true reach tick
  ([hiscore-timestamps.md](competitors/hiscore-timestamps.md) section 1).

Which competitor stamps are true reach ticks:

| Accounts | Pattern | Reading |
|---|---|---|
| stunbaron, stunhard, stunless, stunking (ranks 1-4, the record included) | three values, each shared by many unrelated skills; QP inside a batch | **Logout batches: upper bound on every row** |
| nickoverall (rank 5), nickmax | 16 distinct values over 19 skills; Attack, Defence and Strength share one tick (fits the controlled style) | **Probably exact (not proven)**: exact only if the levels were reached after the deploy. nickoverall's Crafting and Herblore tie at 2,698 and nickmax's Prayer, Crafting and Herblore tie at 2,037 are more simply logouts |
| gh_kadeski (rank 6), asukalabs1, asukalabs, claudefable5, codexastra and most of ranks 13-25 | one value on every row | **One logout: upper bound**; the gaps between skills cannot be recovered |
| zayne, bimmyglm53, 0hyl8lmri | a batch plus some single values | batch rows are upper bounds; singles exact only if post-deploy |
| single-skill accounts (stunmine, nickquarry, stunwc, stunagile, ...) | one 99 row | exact if post-deploy, otherwise an upper bound; either way "reached 99 by tick T" is safe |

Consequences for our run ([hiscore-timestamps.md](competitors/hiscore-timestamps.md) section 4):
our Overall stamp will be our exact last-99 tick, so time after it is free; a stun re-run under
version 9 could show a lower time than its current one by the slack between its last 99 and that
logout; an interim logout publishes our rows to anyone watching, so the run stays in the world and
is monitored from our own tick log. The dropped-login incident found during the probe (about
4,600 unobserved ticks in the world after a failed login) was an orphaned lite runner that kept
the session alive, not the server. After a drop the player stays 500 ticks if the socket closed,
1,000 if it stayed open but silent, and indefinitely while a client with nothing driving it keeps
sending keepalives. `startWatchdog` now logs a wedged client out cleanly within about 10 ticks
([hiscore-timestamps.md](competitors/hiscore-timestamps.md) section 5.1; cairn://p/rs/101).

## 3. Per-account ordering reconstructions

Stamps from the 08:04 UTC snapshot ([hiscores.md](competitors/hiscores.md) sections 2a and 2b,
re-checked at 10:50 UTC in [hiscore-timestamps.md](competitors/hiscore-timestamps.md) section 3).
All levels are 99 unless shown. A "batch" is a logout value shared by the listed skills.

| Account | Total level, overall ticks | 99s in stamp order (stamp: skills) | Batches | Inferred plan (confidence) |
|---|---|---|---|---|
| stunbaron | 1,881, ≤35,916 | 12,006: Prayer, Woodcutting, Fishing, Mining · 17,697: Fletching, Firemaking, Crafting, Smithing, Herblore, QP 13 · 35,916: Attack, Defence, Strength, Hitpoints, Ranged, Magic, Cooking, Agility, Thieving, Runecraft | **3 batches**, every row | Three-session stun script: about three 1-QP quests (Doric's, Sea Slug, Fishing Contest fit) and the gathering 99s with Prayer buried inside; helper-fed artisan skills plus ~10 QP of quests; then combat, Agility, Thieving, Runecraft, Magic, Cooking with no further quests (medium; the quest set low) |
| stunhard | 1,881, ≤36,246 | 12,507 · 18,156 · 36,246, same split as stunbaron | **3 batches** | Same script (high) |
| stunless | 1,881, ≤36,325 | 12,697 · 18,358 · 36,325, same split | **3 batches** | Same script (high) |
| stunking | 1,881, ≤38,597 | 12,070: Woodcutting, Fishing, Mining · 18,920: Prayer and the five artisan skills · 38,597: the other ten · QP 33 saved at 65,804, after maxing | **3 batches** | Same script, Prayer one session later; its extra quests came after it maxed (high) |
| nickoverall | 1,881, 45,443 | 312: Fletching · 2,698: Crafting, Herblore · 2,725: Prayer · 7,653: Woodcutting · 8,470: Firemaking · 18,421: Attack, Defence, Strength · 18,864: Hitpoints · 21,269: Ranged · 22,087: Magic · 26,675: Thieving · (QP 6 saved by 27,210) · 30,033: Smithing · 32,229: Runecraft · 34,650: Fishing · 34,821: Cooking · 40,127: Mining · 45,443: Agility | probably exact; the 2,698 tie is likely a logout | Sequential, one skill at a time: helper-fed skills first, gathering spread through, plain-trained combat block of ~13,600 for six skills with at most 6 QP (medium) |
| gh_kadeski | 1,881, ≤46,681 | every skill and QP 8 at 46,681 | **one logout** | Not recoverable; its owner publishes tooling, not training code ([public-code.md](competitors/public-code.md) section 3) |
| nickmax (partial, same operator as nickoverall) | 1,783, 51,152 | 287: Fletching · 2,037: Prayer, Crafting, Herblore · 7,490: Woodcutting · 8,494: Firemaking · 18,580: Attack, Defence, Strength · 21,398: Hitpoints, Ranged · 22,179: Magic · 32,746: Thieving · (QP 6 by 33,251) · 38,095: Mining · 44,781: Agility · 47,009: Smithing · 48,634: Runecraft · 51,152: Fishing · Cooking still 1 | probably exact; the 2,037 tie is likely a logout | nickoverall's script again, slower (medium) |
| stunfast (partial) | 893, ≤17,743 | QP 3 by 1,913 · 15,057: Prayer, Woodcutting, Fishing, Mining, Agility 49 · 15,891: Cooking 65, Firemaking · 17,743: Magic 80, Crafting, Smithing 85 | batches | Stun script, first two sessions; the first 3 QP well before any gathering 99 (medium) |
| stunlord (partial) | 797, ≤13,997 | QP 3 by 1,607 · 11,433: Woodcutting, Fishing, Mining, Agility 49 · 13,997: Magic 80, Cooking 61, Firemaking, Crafting, Smithing 93 | batches | Same (medium) |
| stunmaxing (partial) | 414, ≤9,362 | QP 3 by 1,828 · 9,362: Woodcutting, Mining, Fishing 74, Magic 46, Firemaking 31, Agility 43 | one logout | Same, abandoned or paused (medium) |
| ranks 7-25 | 1,881, 198,277 to 5.70M | one logout or a few batches each | upper bounds | Casual, AFK or fleet mains; nothing to learn about speed |

**The stun sessions against our model.** Our lines are the 04:20 tally assigned by skill to the
stun session that holds the same 99. The 12,260-tick quest line is split pro rata to the quest
README's fixed-client figures ([../quests/README.md](../quests/README.md) section 3). Session 1
gets Doric's Quest, Plague City, Sea Slug and Fishing Contest (1,366), session 2 gets Druidic
Ritual (251), and session 3 gets the rest (10,643). Prayer is in session 1 because stun's is.
Cooking (80) is in session 3, and the rest of the delay-free line (290) is in session 2.

| Stun session | Contents | stunbaron | stunhard | stunless | stunking | Ours expected | Ours best |
|---|---|---|---|---|---|---|---|
| 1 | ~3 QP; Prayer, Woodcutting, Fishing, Mining 99 | ≤12,006 | ≤12,507 | ≤12,697 | ≤12,070 (Prayer in 2) | 13,468 | 9,730 |
| 2 | Fletching, Firemaking, Crafting, Smithing, Herblore 99; QP to 13 | +≤5,691 | +≤5,649 | +≤5,661 | +≤6,850 | 2,428 | 2,131 |
| 3 | Attack, Defence, Strength, Hitpoints, Ranged, Magic, Cooking, Agility, Thieving, Runecraft 99 | +≤18,219 | +≤18,090 | +≤17,967 | +≤19,677 | 20,046 | 18,263 |
| overhead | banking, trades, travel, contention, latency | inside the figures above | | | | 2,800 | 1,200 |
| **Total** | | **≤35,916** | ≤36,246 | ≤36,325 | ≤38,597 | **38,742** | **31,324** |

Two readings follow. First, **session 1 is explained by the stun single-skill accounts.** stunwc
(3,653), stunfish (3,956, with Sea Slug and Fishing Contest) and stunmine (4,575, with Doric's
Quest and a second 1-QP quest) sum to 12,184. That is already 178 more than stunbaron's whole
session, Prayer included. So in the max run Prayer cost them nothing visible on top of the
gathering. Second, **session 2 is slower than ours by ~3,260**, more than their artisan singles
explain. Their artisan singles (Fletching 66, Firemaking 836, Smithing 1,337, Herblore 465 with
Druidic Ritual, and Crafting a few hundred) come to roughly 3,000. That leaves about 2,500-2,700
for the quests that take them to 13 QP. That is close to what Waterfall, Tree Gnome Village and
Fight Arena cost us (888 + 896 + 645 = 2,429 fixed). Those three are also the quests the stun
single-skill siblings' xp signatures point to ([hiscores.md](competitors/hiscores.md) sections 2c
and 3). If that reading is right, stun reaches its last session with Attack near 97 and Strength
83 already banked (inferred, low).

## 4. They beat us here

Sorted by gap: the competitor's lead over our expected figure, in ticks. Their figures are upper
bounds, so each gap is at least the value shown. "Ours" is the 04:20 tally (best case in
brackets).

| # | Where | Their figure (account) | Ours | Gap | Inferred method | Evidence | Confidence |
|---|---|---|---|---|---|---|---|
| 1 | **Whole account** | ≤35,916 (stunbaron) | 38,742 (31,324) | **≥2,826**; our best leads by ~4,590 | Composition, not per-skill speed: rows 2, 3 and 5 plus our 2,800 overhead allowance, which their total already contains | hiscore ([hiscores.md](competitors/hiscores.md) 2a); tally | high on the numbers |
| 2 | **Stun last session**: ten skills to 99, no quests | ≤18,219 (stunbaron); ≤17,967 (stunless) | 20,046 (18,263) | **~1,830** (2,080 against stunless) if their session 2 held no combat quests; **~210** (~460) if Tree Gnome Village and Fight Arena sat in session 2, as section 3 infers (ours then 18,430) | Not visible. By their own single-skill rates the non-combat part (Agility ~6,500, Thieving ~3,250, Runecraft ~2,400, Magic and Cooking ~650) leaves at most ~5,400-5,700 for Defence 1-99, Strength 83-99, Ranged 1-99 and Hitpoints. stundefence alone took ~6,700 for Defence, so the max run must gain combat xp several skills at a time, or faster than any stun single shows | hiscore batches and singles ([hiscores.md](competitors/hiscores.md) 2c, 3); not observed ([observation.md](competitors/observation.md)) | low on the method; medium that the like-for-like gap is a few hundred |
| 3 | **Stun gathering session**: ~3 QP, Prayer, Woodcutting, Fishing, Mining | ≤12,006 (stunbaron) | 13,468 (9,730) | **≥1,462**; our best leads by ~2,280 | Prayer absorbed into gathering (row 5, ~700); Woodcutting (row 6, ~305); Fishing (row 7, ~100); about 180 below the sum of their own singles; the remaining ~180 is Plague City against stunmine's quest-plus-Mining, an allocation effect (we take Plague City for the Ardougne teleport) | hiscore batches; singles | medium |
| 4 | **Fishing 78-99** | ≤2,421, probably exact (nickoverall, Fishing 99 after Runecraft 99 at 32,229) | 3,410 (2,000 knife) | **~989**; our knife leads by ~420 | A faster-than-normal cycle on the live server (3-tick fly or equivalent), if Sea Slug and Fishing Contest are among its 6 QP | hiscore ([hiscores.md](competitors/hiscores.md) 2c, Q2) | medium: the 6 QP set is unverified, and the segment assumes nothing else was trained in it |
| 5 | **Prayer inside gathering** (part of row 3) | ~0 marginal (stun session 1 is below the sum of its gathering singles) | 700 (150) | **~700** | Burying dragon bones in the wait ticks of 4-tick Woodcutting and 5-tick fly fishing, rs/38's measured mechanism | hiscore batch: Prayer in the gathering batch on 3 of 4 stun accounts; dragon-bone stockpiles on the bank board | medium. Our own prayer.md prices this at 150-220 on normal clocks (section 7, item 2) |
| 6 | **Woodcutting 1-99** | ≤3,653 (stunwc) | 3,958 measured on the demo (3,028 knife) | **≥305**; our knife leads by ~625 | Unknown: faster than our measured 4-tick cycle, slower than the knife | hiscore single | low |
| 7 | **Fishing 1-99 with Sea Slug and Fishing Contest** | ≤3,956 (stunfish; Firemaking 31 at 85 is Sea Slug's check) | ~4,057 (~2,565) | **≥~100** | The same two quests, then fly fishing | hiscore single | medium |
| 8 | **Cooking 1-99** | ≤38 (jackalopeck3); stuncook 51 | 80, measured on the demo with a relog | **≥42** | Wine (stuncook banks ~5K jugs of bad wine and ~2K of wine); possibly without the relog our hand-off needs | hiscore single; bank board | medium |
| 9 | **Firemaking 1-99** | ≤706 (jackalopefm4) | 740 inferred (600) | **≥34** | Highest-tier logs; our 740 is still the unfolded estimate, and rs/35's measured ~650 would close it | hiscore single | high |

**No longer gaps under the current model**, although the section documents list them:

- **Agility.** stunagile's 6,772 was compared with a pure figure of 6,960. `agility.md` on main
  now gives about 6,730 without quests (6,290 with the Edgeville monkey bars), and our route's
  Agility after the Grand Tree is 4,146 ([../skills/agility.md](../skills/agility.md)).
- **Mining.** stunmine's 4,575 includes Doric's Quest and a second 1-QP quest. Ours is Doric's
  Quest plus 4,034 = 4,099, so we lead by ~476. nickquarry's 6,015 is explained by rs/2
  (`mining.md`: Doric's Quest, then iron emptying the rock at every ore). Neither is open.
- **Herblore.** stunherblore's 465 includes Druidic Ritual, which is **mandatory** on this server:
  no script checks the quest, but every Herblore action needs level 3 and the quest's 250 base
  is the only practical source (measured by rs/37; [../quests/README.md](../quests/README.md)
  section 1). Ours is ~239 + ~89, so we lead by ~135. `hiscores.md` said the quest was not
  required; that row is corrected.
- **The nickoverall combat block.** Six combat skills in ~13,600 by plain training. Our
  equivalent (the combat quests, Mage Arena, the combat finish and Magic) is ~12,750, and it also
  buys Agility and Thieving xp.

**Where we are faster everywhere** (best single-skill account against our expected): Prayer
standalone, Magic, Ranged, Smithing, Crafting, Fletching, Runecraft, Herblore, Mining, Agility,
and Thieving at parity ([hiscores.md](competitors/hiscores.md) section 3), plus the whole artisan
session (section 3 above).

## 5. Public code and writeups

**No account above us has published code, a route or a writeup**, and nothing published beats our
route. Detail and pinned links are in [public-code.md](competitors/public-code.md).

| Source | What it is | Technique relevant to us | Ticks for us |
|---|---|---|---|
| [rs2b2t/rs2b0t](https://github.com/rs2b2t/rs2b0t) | A 2004scape bot client on the same revision (289), with ~40 live-run quest pitfall notes | Fight Arena stage 8-9 skip; Grand Tree stand tiles and gate direction; Underground Pass and Regicide still recipes | public-code.md estimated 200-500 against the route of 2026-10-20. **Now about 100-200 (inferred)**: its two largest targets, the Regicide chain (1,000 failure allowance) and the troll chain (500), are off the route. The on-route pages it covers are Fight Arena, Grand Tree, Tree Gnome Village, Sea Slug and Fishing Contest. On main only `quests/regicide.md` cites it |
| [UberMouse/rs-sdk](https://github.com/UberMouse/rs-sdk) | Measured skill learnings on a local server | Smithing 3-tick bar lockout; roll-tick mining clicks gain nothing | 0 (inside our measured cycles) |
| [GoonMachine/rs-sdk](https://github.com/GoonMachine/rs-sdk) | King of the Hill playbooks, quest-xp combat bootstrap, a Discord sample (2026-08-15) | Quest bootstrap order; production tick 300.3 ms | 0 (valued in our quest docs) |
| [TestingPurposes/rs-sdk-fleet](https://github.com/TestingPurposes/rs-sdk-fleet) | Headless 1,800-bot client | A second login kicks the first session; the update packet shows at most 250 players on one floor | 0 (one process per scored account); 0-150 (uncrowded hand-off tiles) |
| [msalmeida-boomer/runescaper](https://github.com/msalmeida-boomer/runescaper), [AuburyEssentian/rs-sdk](https://github.com/AuburyEssentian/rs-sdk) | Early all-skills and fishing bots | Stock methods | 0 (superseded) |
| [markeljan/rs-sdk-dashboard](https://github.com/markeljan/rs-sdk-dashboard), [kadeski/rs-world](https://github.com/kadeski/rs-world) | Fleet dashboard (soko, 0hyl8lmri); live world viewer (gh_kadeski) | `/playerpositions` and `/worldfeed`, the passive way to watch competitors | 0 (observation tool) |
| [MaxBittker/rs-sdk](https://github.com/MaxBittker/rs-sdk) PR #67, commits 415491a1 and 55fa26cc | The hiscore rule change | Prompted by a fairness bug, not by gaming; no one exploited either rule | 0 |

The record history is the one strategic fact: the fastest max was 143h 52m on 2026-08-15
(simplereally) and is under three hours now, so everyone in today's top group maxed in the
last two months on an unpublished route ([public-code.md](competitors/public-code.md) section 3).
The rs-sdk Discord is the only likely home of a stun or nick writeup and was not read
(section 8).

## 6. In-game observation log

Full log: [observation.md](competitors/observation.md). Raw data:
[observation-data/](competitors/observation-data/) (`leg1`-`leg4` summaries, events and chat;
`positions-1.jsonl` and `positions-2.jsonl`).

The observer was throwaway `cairn_obs1`, with a no-interaction guard on every action. It was in
game from 08:09 to 09:53 UTC on 2026-10-21 in four legs: Lumbridge, Draynor and Falador; Varrock,
Edgeville and Barbarian Village; Seers'; and Ardougne, the Fishing Guild and the magic trees.
Public `/playerpositions` was also polled every 3 s from 08:55 to 10:05 UTC. In summary:

- **No stun account was online at any point** (spot-checked again at 10:14 UTC), and no nick
  account except nickai. The runs that matter (stunfast, stunlord, stunmaxing, nickmax) could
  not be watched.
- **The online target accounts were maxed and idle.** Asukalabs, Soko, Sokobot and Sokogp2 stood
  on one tile for an hour. Nickai did the Brimhaven Agility Arena, then moved between towns in
  short stops (quests or clues).
- **Training fleets use our methods or slower ones.** The Z* fleet (~25 accounts) pickpockets
  the Knights of Ardougne, our Thieving method. Others mine at Barbarian Village and Varrock
  south-west and chop yews south of Seers', fletching in place for gold.
- **No technique seen in game has a positive tick estimate against our route.**
- The hiscore climber watch over the same window (seven passes, 08:12-09:54 UTC) found **no
  competitor climbing**. Rows land only at logout, so a bot mid-session is invisible on the
  boards ([hiscores.md](competitors/hiscores.md) section 5).

Next time, start from `/playerpositions` (`bun speedrun/tools/observe.ts positions --min 120`)
and stand beside a stun account only once one logs in (section 7, brief A).

## 7. What we should adopt

Ranked by expected ticks saved. "Lab" means a measurement child the mission coordinator may
spawn.

1. **Prove and run the knife loops on the demo: ~3,010 ticks** (Mining 674, Woodcutting 930,
   Fishing 1,410: the tally's expected-to-best difference on those lines). This is not a
   competitor technique. It is our edge, because no stun single-skill account shows it. Its
   relevance here is that nickoverall's Fishing 78-99 in at most 2,421 (section 4, row 4) is the
   only live-server evidence that a faster-than-normal gathering cycle holds on the demo. The
   demo proofs are already in flight (rs/95 for the browser path from Ashburn, rs/97 for the
   in-page tick programs). No new lab; see the candidate table for one acceptance figure to
   add.
2. **Price Prayer by the gathering clock the run actually uses: ~480-550 ticks on the expected
   path**, a ledger correction with no lab needed. `prayer.md` and `interleaving.md` (rs/28
   branch) measure the mechanism. With bones in pickpocket stuns plus 4-tick Woodcutting and
   5-tick fishing, Prayer costs about 150-220, but only against those skills' normal (no-knife)
   columns. With the knife on Woodcutting, it costs about 500-570. The 04:20 tally pairs the
   other way round: the expected column has normal-clock gathering with Prayer at 700, and the
   best column has knife gathering with Prayer at 150. Corrected, expected falls to about
   38,190-38,260 and best rises to about 31,670-31,740, still ~4,200 under the record. Stun's
   gathering session, below the sum of its own singles with Prayer inside, corroborates the
   normal-clock figure at scale. Owner: the main thread's tally.
3. **Treat overhead as the deciding line: up to 2,800 ticks.** Our skill and quest lines
   alone reach 35,942; stun's whole account, overhead included, fits in at most 35,916. The
   expected path beats the record only if overhead comes in well under its allowance, the knife
   lands, or both. Stun's gathering session comes in about 180 under the sum of its singles, and
   each single carries its own banking and travel. That says a scripted multi-skill session need
   not add overhead beyond what each skill's own line already carries (inferred, medium). This
   is the run-order work the main thread named as its next lever on 2026-10-21 04:20, not a lab.
4. **Watch a stun run before changing the combat plan: 0 to ~1,830, most likely ~200-460**
   (section 4, row 2). Observation, not a lab, comes first (brief A).
5. **A no-knife Woodcutting fallback: at least ~305**, needed only if the knife cannot be proven
   on the demo (brief B).
6. **Run hygiene from the timestamp work: 0 ticks, but it protects the score.** Stay in the world
   until the last 99 and then log out cleanly, so interim rows do not publish our progress. Run
   exactly one process per scored account, since a second login kicks the first
   ([public-code.md](competitors/public-code.md) section 6.2). Run under the watchdog with its
   clean-logout policy, because a dropped login left a throwaway in the world for ~4,600 ticks:
   an orphaned runner holds the player indefinitely, a closed socket for 500 ticks
   ([hiscore-timestamps.md](competitors/hiscore-timestamps.md) section 5.1; cairn://p/rs/101).
7. **Below the ~300 bar; fold into existing work rather than a lab:** the rs2b0t pitfall review
   (~100-200, into the run-order dry run of the on-route quests); Firemaking (~34, by folding
   rs/35's measured figure into the tally); Cooking (~42, check whether jackalopeck3's 38 means
   the wine split can skip its relog); stunfish (~100, inside item 1); uncrowded hand-off tiles
   (0-150).

**Rejected:** skipping Druidic Ritual (impossible: Herblore needs level 3 and the quest is the
only practical source); the Brimhaven Agility Arena (≤2.9 base xp per tick against 6.1-7.4 on the
Wilderness course); chop-and-fletch yews (a gold method); Waterfall, which stun probably does
(our measured value for it is negative under Package B, [../quests/README.md](../quests/README.md)
section 3).

### Lab candidates

For the mission coordinator. "Value" is against our expected figure.

| Candidate | Value (ticks) | Confidence | Clears ~300? | Recommendation |
|---|---|---|---|---|
| Knife loops on the demo (item 1) | ~3,010 | medium (measured locally; demo proof pending) | yes | **No new child**: rs/95 and rs/97 own it. Add an acceptance figure to rs/97: a demo fly-fishing segment from 78 to 99 at or under ~2,400, nickoverall's live figure |
| Prayer pricing (item 2) | ~480-550 expected (best worsens ~350-420) | high (mechanism measured) | yes | **No lab**: a tally correction by the main thread |
| Stun combat method (item 4) | 0 to ~1,830; likely ~200-460 | low | uncertain | **Not yet a lab**: run brief A (observation) first; spawn a lab only if it names a method faster per tick than our cannon-led finish |
| Woodcutting without the knife (item 5) | ≥305 | low | barely | **Conditional**: spawn brief B only if rs/95 or rs/97 fail to prove the knife on the demo |
| nickoverall Fishing 78-99 (section 4, row 4) | ~989 | medium | yes | **Covered by the knife child** (row 1); no separate lab |
| rs2b0t quest pitfall review | ~100-200 | medium | no | No lab: a reading pass in the run-order dry run |
| Skip Druidic Ritual | 0 | high | no | **Closed**: mandatory |
| Cooking, Firemaking, stunfish | ~34-100 each | medium-high | no | No lab |

**Brief A: observe a stun account's last session (observation, about 2-3 hours of watching).**
Run `bun speedrun/tools/observe.ts positions --min 120` from the rs/71 tooling (no login) until
a stun or nickmax name appears in `/playerpositions`. stunfast, stunlord and stunmaxing are the
partial runs most likely to resume, and any of them would be in its third session. When one
appears, run the tour with `--spots @<name>` and repeat it as the account moves. Record its
tile, animation, worn items, combat target and bank trips every few seconds, plus any cannon or
other player standing with it. Do not route over White Wolf Mountain, and switch auto-retaliate
off. After it logs out, read its player page with `speedrun/tools/hiscore-scrape.ts`. Levels
reached after the deploy carry exact version-9 stamps, so consecutive stamps give base xp per
tick for each combat level band. Success: name the method and place stun uses for Defence,
Strength, Ranged and Hitpoints, with a rate in base xp per tick. Compare it with our finish
(cannon plus rapid rune knives with the rs/91 kit: 21.95 base Ranged per tick at Ranged 85) and
with Monkey Madness (28.2 base xp per tick over the quest). Spawn a 300 ms lab only if the
observed method beats both on the skills it covers. Tenet 6 applies throughout: never interact,
trade, chat or follow.

**Brief B: a no-knife Woodcutting route at or under ~3,650 ticks (lab, only if the knife fails
on the demo).** stunwc reached Woodcutting 99 in at most 3,653. Our measured normal route is 3,958
on the demo, and the knife route is 3,028 ([../skills/woodcutting.md](../skills/woodcutting.md)).
First run `woodcutting-model.ts` with the measured rates to see which no-knife plan could reach
≤3,650. Candidates: a different oak and willow split, or a less contested three-tree tile on the
busy demo; partial manipulation that survives the demo's reaction latency (for example the knife
on the willow band only); and the 2-tick flinch, already a lab as rs/90. Then measure the best
candidate for 200 rolls on the local engine at 300 ms and for a short segment on the demo from
the Ashburn vantage. Done when a no-knife route at ≤3,650 is measured, or the trace shows why none
exists, and `woodcutting.md` carries the result.

## 8. Open questions

1. **How does the stun last session train Defence, Strength, Ranged and Hitpoints so fast?**
   The hiscores bound it but cannot split it (section 4, row 2; brief A).
2. **Which quests make up stun's 13 QP, and in which session?** This decides whether the
   last-session gap is ~210 or ~1,830. The quest list is not on the boards. Version-9 stamps from
   a resumed partial stun run, or watching one, would show it.
3. **Did nickoverall do Sea Slug and Fishing Contest, and were its stamps written after the
   deploy?** Both conditions sit under the ~989 Fishing figure. If nickmax finishes Cooking, its
   new stamps will be exact and dated.
4. **What is stunwc's method?** It is faster than our measured normal cycle and slower than the
   knife (brief B).
5. **How small is a real max run's overhead?** Stun's totals bound overhead plus skills together,
   not overhead alone. Our first full dry run of the run order is the measurement.
6. **Will the stun operator re-run under version 9?** A re-run would publish exact stamps and
   could lower the record by its logout slack, which the page cannot show today. A rule to watch
   the board for new stun names (rs/29's upstream and record watch) would catch it.
7. **How many ticks does a dropped login cost the scored account?** Answered by
   cairn://p/rs/101: 500 (socket closed), 1,000 (socket silent), unbounded (client alive, nothing
   driving it); about 10 under the watchdog's clean logout. Open residue: a SIGKILLed controller
   cannot run its exit guard, and a browser-client tab is not a child process
   ([hiscore-timestamps.md](competitors/hiscore-timestamps.md) section 5.1).
8. **Unread public sources.** The rs-sdk Discord (`99str-contest`, `share-progress`,
   `agent-techniques`) needs an account; reading it is the operator's call. Max Bittker's
   2026-10-17 RuneBench talk has no fetchable transcript
   ([public-code.md](competitors/public-code.md) section 9).

## What changed against the section documents

The section documents stand as written, with the factual fixes below. This page supersedes their
values where the model has moved since they were written:

- **Re-priced to the 04:20 tally.** hiscores.md's last-session gap of ~4,000 (~9,500 against the
  21:15 tally) came from the quest route before Package B, the rs/91 combat kit and the 66-tick
  Agility laps. Against the current lines it is ~210-1,830 (section 4, row 2).
- **Agility and Mining are no longer gaps** (section 4). Herblore's comparison now includes the
  mandatory Druidic Ritual.
- **The rs2b0t review is worth ~100-200, not 200-500** (section 5): the Regicide and troll chains
  it mostly addressed are off the route.

Factual fixes made in the section documents with this page:

- `hiscores.md`: Druidic Ritual is mandatory (the Herblore row said this server does not require
  it); nickoverall has 16 distinct stamps, not 15 (as hiscore-timestamps.md counts); the
  timestamp write-up is beside it, not on another branch.
- `public-code.md`: stamps fall back to logout playtime for levels reached before 55fa26cca's
  **deploy** (between 2026-10-19 02:31 and 2026-10-21 08:33 UTC), not before 2026-10-18; and
  whether the rule is live is now answered (yes, hiscore-timestamps.md).
- `hiscore-timestamps.md`: rs/69's snapshot is beside it, not on the rs/69 branch.
