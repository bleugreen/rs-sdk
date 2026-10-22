# stunhitpoint's melee rate: no hidden mechanism (rs/272)

The question (cairn://p/rs/272): stunhitpoint's page reads Strength 99 at 24m49s, Attack 99 at
42m29s and Hitpoints 99 at 1h25m17s on a fresh account, which the issue priced at ~2,626 Strength
xp per tick, far past any melee hit rate. What engine mechanism gives that, what does it cost, and is
it a lever our run order lacks?

Script: [`speedrun/lab/measure-stun-melee.ts`](../../../speedrun/lab/measure-stun-melee.ts). Labels
follow [skills/README.md](../skills/README.md#labels): m measured, r read, i inferred, e estimated.

## 1. Answer

- **There is no mechanism to find. The 2,626 xp per tick is a units error.** It divides
  RuneScape's level-99 xp, 13,034,431, by the stamp. This server levels on `2^(level/10)`, not
  `2^(level/7)` (`server/engine/src/engine/entity/Player.ts:77-85`, mirrored in
  `speedrun/lib/xp.ts`), so level 99 is **998,458 game xp = 39,938 base** at the demo's 25x
  (`fly.toml:27`, `NODE_XPRATE`; applied in `Player.ts:1889-1890`). Strength 99 at tick 4,966 is
  therefore **8.04 base xp per tick from account creation** (201 game xp per tick), opening
  included. That is ordinary melee: our ogre samples run 7.58-10.08 (`skills/strength.md` section
  2).
- **The page is plain melee after Waterfall, and the lab reproduces every segment of it** (m,
  section 3): Strength 83-99 in 3,286-3,857 ticks against their ~3,430-3,700, Attack 83-99 in
  3,482 against their 3,532, Hitpoints 86-99 at 2.595 base per tick, which predicts 8,531 ticks
  against their 8,560.
- **Prayer 43 is Protect from Melee.** It zeroes NPC melee damage (`npc_combat_melee.rs2:44-46`),
  so a Defence-1, Hitpoints-10 account can melee ogres with no armour and no food: 0 damage taken
  in all four lab runs (10,625 ticks). Prayer 43 at "53 s" is tick **178**, not ~106 (the issue
  converted at 0.5 s a tick; the demo runs at 300 ms, `fly.toml:26`, and the hover title reads 178).
  787 base is 11 dragon bones, 22 ticks of burying at 2 ticks a bone; the rest is fetching them.
- **It is not a lever for us. Ticks saved: 0** (section 5). Our Attack comes from three quests in
  2,857 ticks that melee would need ~4,540 for; Monkey Madness gives 110,000 base of combat xp in
  4,764 expected ticks, ~23 base per tick against melee's ~11 (Strength plus Hitpoints), and
  stunhitpoint never trained Defence.
- **The page has not changed since 2026-10-21 08:04 UTC** (our scrape,
  `competitors/data/snapshot-2026-10-21T080427Z.json`: Strength 4,966, Attack 8,498, Hitpoints
  17,058, Prayer 178, Magic 1,260, 2 QP by 1,538). It is not a new lever from tonight.

## 2. What the engine awards for melee (read)

Every candidate in the issue was checked against the scripts.

| Candidate | Finding | Source |
|---|---|---|
| Overkill xp | Damage is capped at the NPC's remaining hitpoints **before** xp is given | `player_melee.rs2:31-33` (`$damage_capped = min($damage, npc_stat(hitpoints))`) |
| A per-NPC xp multiplier | Every hit's xp is scaled by the NPC's `combat_xp_multiplier`, default 1000 = 1x. No NPC sets it above 1000: 39 random-event NPCs set 25 (0.025x) and one Vampire Slayer NPC 100 (0.1x) | `combat.rs2:88`, `combat.rs2:143-167`; `skill_combat/configs/combat.param:164-167`; `macro events/configs/antimacro.npc`; `quest_vampire.npc:40` |
| The xp formula | Accurate / aggressive / defensive: 4 base per damage to the style's skill, 1.33 to Hitpoints; controlled 1.33 to each. The Black Knight Titan is the one special case, and it gives *less* (1 per damage) | `combat.rs2:92-117`, `combat.rs2:143-167` |
| A special attack that scales xp | Every PvM special (dragon dagger, longsword, mace, halberd, rune claws, thrownaxe, magic bows) calls the same `give_combat_experience` with the same capped damage | `skill_combat/scripts/player/specs/scripts/pvm_*.rs2` |
| Scripted xp without a hit roll | Two dummies: the Varrock dummy stops at Attack 8 (`attack_dummy.rs2:7-12`, 2 base a hit); the Ardougne training-camp dummy gives 20 base six times, once, after Biohazard (`combat_training_camp.rs2:50-55`). Nothing else awards Attack, Strength or Hitpoints outside combat and quest rewards | `grep stat_advance(attack|strength|hitpoints` over `server/content/scripts` |
| Engine-side xp | `addXp` is reached only from `STAT_ADVANCE` (`PlayerOps.ts:811-817`) and the staff `::setstat`/`::advancestat` cheats | `server/engine/src` |
| Multi-target melee | None in this revision: no melee weapon or special hits more than one NPC | the specs above |
| Magic 47 (a spell multiplier, Charge) | The melee path never reads Magic. The lab set Magic 47 and cast nothing | section 3 |

## 3. Lab reproduction (measured)

Setup: local engine, `NODE_TICKRATE=300`, lite client, `speedrun/lab/lab.sh`, executor bgsrv-mac
(load ~2 before the four labs), four labs side by side on port blocks 9640-9670 (2026-10-21
23:50 PDT). Fixture by staff command, as the account would stand after Waterfall: Attack and
Strength 83 (13,750 base each, `quest_waterfall.rs2:491-492`), Defence 1, Prayer 43, Magic 47,
Hitpoints at the phase's real level, rune scimitar and amulet of strength (Defence 1 wears nothing
else that adds damage), the ogres west of Yanille (2499,3093). Protect from Melee throughout;
`--boost=1` adds Ultimate Strength and Incredible Reflexes. Prayer was put back to 43 by
`::setstat` below 10 points, a stand-in for prayer potions (section 4).

| Run | Phase | Ticks | Base xp / tick, trained skill | Game xp / tick | Issue's 13M scale | Hitpoints base / tick | Mean swing | Kills | Damage taken | Prayer points used |
|---|---|---|---|---|---|---|---|---|---|---|
| `--phase=str` | Strength 83-99, aggressive, Attack 83 | **3,857** | 6.96 | 174 | 2,270 | 2.30 (HP 10-77) | 7.08 | 111 | 0 | 771 |
| `--phase=str --boost=1` | same, with Ultimate Strength and Incredible Reflexes | **3,286** | 8.15 | 204 | 2,660 | 2.70 (HP 10-77) | 8.45 | 110 | 0 | 1,974 |
| `--phase=att` | Attack 83-99, accurate, Strength 99 | **3,482** | 7.69 | 192 | 2,510 | 2.55 (HP 76-86) | 7.88 | 111 | 0 | 697 |
| `--phase=hp --ticks=1000` | Attack and Strength 99, aggressive (xp to a capped skill) | 1,000 | 2.60 (Hitpoints) | 65 | 847 | 2.60 (HP 87-89) | 8.22 | 32 | 0 | 200 |

"13M scale" multiplies game xp by 13,034,431 / 998,458 = 13.05, the issue's units, so the rows
compare directly with its 2,626: the boosted Strength run is 2,660.

Level stamps (ticks from the first swing), Strength plain / boosted: 90 at 1,255 / 1,060, 95 at
2,557 / 2,144, 99 at 3,857 / 3,286. Attack: 90 at 1,078, 95 at 2,206, 99 at 3,482.

### Against the page

| Segment | stunhitpoint (stamps) | Lab | Reading |
|---|---|---|---|
| Opening: Prayer 43, Magic 47, Waterfall + one 1-QP quest | Prayer 178, Magic 1,260, QP saved by 1,538 (a save stamp, an upper bound) | Waterfall ~1,060 measured end to end (`quests/waterfall.md`) | fits |
| Strength 83-99 | 4,966 less the opening's end (1,260-1,538): **~3,430-3,700** | 3,286 boosted, 3,857 plain | between the two prayer setups (or partial boosting) |
| Attack 83-99 | 8,498 - 4,966 = **3,532** | **3,482** | -1.4% |
| Hitpoints to 99 | 17,058 - 8,498 = **8,560** | 39.2 + (8,887 + 8,874) = ~17,800 base after the two phases (level ~86); 22,138 more at 2.595 = **8,531** | -0.3% |

The account's whole page, opening, melee and the wasted-xp Hitpoints grind, is reproduced by
ordinary ogre melee under Protect from Melee to within the noise of one run.

## 4. What the method costs

| Item | Strength 83-99 | Attack 83-99 | Hitpoints ~86-99 | Basis |
|---|---|---|---|---|
| Ticks | 3,286 boosted / 3,857 plain | 3,482 | ~8,531 | m / m / i (rate m) |
| Prayer points | 1,974 / 771 | 697 | ~1,706 | m (Protect from Melee alone drains 0.200 a tick, 1 point per 5 ticks; with both boosts 0.60) |
| Prayer potion doses (17 points at Prayer 43) | 116 / 45 | 41 | ~100 | i |
| Food | none | none | none | m: 0 damage taken |
| Gear | rune scimitar (Attack 40), amulet of strength | same | same | |
| Prerequisites | Prayer 43 (~11 dragon bones), Waterfall for 83/83 | | | r |

A real dose is an inventory op and clears the attack (`OpHeldHandler.ts`, speedrun-lab skill), so
each costs about one re-attack; the `::setstat` stand-in does not, which makes the lab a tick or so
per dose optimistic (i). Magic 47 is not needed by the method. It fits Imp Catcher (875 base Magic,
level 44, `quest_imp.rs2:4`) plus some casting as the account's second quest point, but the page
cannot show which quest it was (i).

## 5. Priced against our route

Our route trains no Attack or Strength by melee (`skills/attack.md`, `skills/strength.md`,
`skills/combat.md` summary). Rows from `STEP-MANIFEST.md`'s ranked table (expected column) and
`RUN-ORDER.md`:

| Our step | Ticks (expected) | What it gives | Melee equivalent (this method) | Verdict |
|---|---|---|---|---|
| Attack: S10b Tree Gnome Village 793 + S11b The Grand Tree 1,493 + S12 Fight Arena 571 | **2,857** | Attack 99 (42,025 base, `quest_tree.rs2:98`, `quest_grandtree.rs2:200`, `quest_arena.rs2:270`), plus 9 QP, the MM gate (Tree Gnome Village), the spirit trees, Magic from the cast fights, Thieving xp | Waterfall ~1,060 + Attack 83-99 3,482 = **~4,540** for Attack alone, none of the rest | quests win by ~1,700 before counting what else they carry |
| Strength, Hitpoints, Defence: S15 Monkey Madness option 1 | **4,764** (best 4,300, fallback 5,298) | 35,000 Strength, 35,000 Hitpoints, 20,000 Attack, 20,000 Defence (`mm_daero.rs2:295-298`): 110,000 base, ~23 a tick; 3 QP | Waterfall ~1,060 + Strength 83-97 2,719 (boosted, m) + Defence 1-89 ~2,170 (19,961 base at ~9.2, `combat.md`) + the Hitpoints still short of 97, ~21,000 base at ~2.65 = ~7,900: **~13,850** (i) | MM wins by ~9,000 even in its fallback; melee is deterministic but no answer to MM's risk |
| Strength 97-99, Defence 89-98: S26 Dragon Slayer | 1,380 | 18,650 Strength and Defence (`quest_dragon.rs2:33`), 2 QP, the rune platebody | Strength 97-99 alone is ~570 boosted (m, 97@2,719 to 99@3,286), but the quest also carries Defence and QP | no change |
| Hitpoints 97-99, Defence 98-99: S27 combat finish | 1,972 | Ranged ~54-99 by cannon and bow with Defence and Hitpoints riding it | Hitpoints by melee: 2.6-2.7 base a tick, a by-product only | S27 is far faster per tick; nothing to move |

**Ticks saved: 0.** The method trains Strength and Hitpoints together at ~11 base a tick at best,
half of what Monkey Madness gives per tick, and Defence not at all.

## 6. What this says about the stun record

stunhitpoint is a three-skill account trained the slow, safe way, and it is not where the stun
maxes' combat speed comes from. The open question in
[competitors/hiscores.md](competitors/hiscores.md) section 2 (how the max accounts fit Attack,
Defence, Strength, Hitpoints and Ranged into ~5,400 ticks of their third session) stays open; this
account's rates (7-8 base a tick) make that gap larger, not smaller. Section 2's line that
stunhitpoint's Strength 83-99 "is slower than our measured ogre rates" is explained: it trained at
Attack 83, without potions, under Protect from Melee, which the lab measures at 6.96-8.15.

## 7. Reproducing

```
speedrun/lab/lab.sh <bot> speedrun/lab/measure-stun-melee.ts:--phase=str[:--boost=1]
speedrun/lab/lab.sh <bot> speedrun/lab/measure-stun-melee.ts:--phase=att
speedrun/lab/lab.sh <bot> speedrun/lab/measure-stun-melee.ts:--phase=hp:--ticks=1000
```

Each phase is ~17-20 minutes of wall time at 300 ms on a quiet host; on a host at load 60+ the
same run took over 90 minutes and timed out, so pin it to a quiet executor and send its output to a
file rather than through a pipe filter (a killed batch loses a buffered `grep`).
