# Fight Arena

**About 850 ticks (about 4.2 minutes at 300 ms) at 70/70/70 melee, for 12,175 base
Attack, 2,175 base Thieving and 2 quest points.** The Thieving alone takes a
level-1 account to 57 (measured), which replaces about 670-890 ticks of Ardougne
knight pickpocketing (`docs/speedrun/skills/thieving.md` on cairn://p/rs/2's
branch, via the quest-route coordinator), so the quest roughly pays for itself on
Thieving and the Attack and quest points come free. Do it while Thieving is still
low. General Khazard does **not** have to be killed: Lady Servil pays out as soon
as he turns hostile, which saves about 140 ticks.

All ticks are stock-client figures at the production tick rate (lab at
`NODE_TICKRATE=300`), measured with `docs/speedrun/scripts/quest-arena-run.ts`
unless labelled otherwise. Primitive costs come from `primitives.md`.

## Reward

- 12,175 base Attack and 2,175 base Thieving: `stat_advance(attack, 121750)` and
  `stat_advance(thieving, 21750)` (read, `quest_arena.rs2:270-271`). Measured:
  Thieving went from level 1 to 57 (54,375 game xp = 2,175 × 25).
- 2 quest points (read, `general/configs/quest.constant:72`), and 1,000 coins
  (`quest_arena.rs2:269`).
- The completion queue adds 2 to the stage: 12 → 14 if the General was left
  alive, 13 → 15 if he was killed (`quest_arena.rs2:268`). Both count as complete
  (`general/scripts/quests.rs2:209`).

## Requirements (as this server enforces them)

- **No quest or skill requirement.** Lady Servil starts it with no check
  (`lady_servil.rs2:27-44`), and no script in `quest_arena/` calls `stat()` or
  `stat_base()` (read, grep).
- **Members:** the Khazard armour is `members=yes` (`quest_arena.obj`). The lab ran
  as members.
- **Items the steps check:** wearing both Khazard helmet and Khazard armour for the
  prison door and the drunk guard (`quest_arena.rs2:48,56-60`,
  `khazard_guard.rs2:73,87,99`); 5 coins for the Khali brew
  (`khazard_barman.rs2:31-37`); the Khali brew for the guard
  (`khazard_guard.rs2:90`); the cell keys on Jeremy (`jeremy_servil.rs2:11`).
- **Combat:** the Khazard ogre, the scorpion and Bouncer must die to advance the
  stage. Nothing checks levels; the fights are the gate.
- **Wield requirements of the assumed gear** (outside the quest, `levelrequire/`,
  all `stat_base`, so boosts do not count): rune scimitar 40 Attack, rune
  kiteshield and rune platelegs 40 Defence (`tier40.rs2:8,22,23`,
  `levelrequire.rs2:7,15`). The Khazard armour has none.

## Items: helper-supplied and scored-account-only

| Item | Tradeable | Source for the run |
|---|---|---|
| Coins (5) | yes | helper (or carried) |
| Weapon, shield, legs, amulet, food (swordfish) | yes | helper |
| Runes for an Ardougne teleport, if used for the way in | yes | helper |
| Khazard helmet, Khazard armour | **no** (`quest_arena.obj:28,56`) | scored account: the chest in the guards' house |
| Khazard cell keys | **no** (`quest_arena.obj:70`) | scored account: the drunk guard |
| Khali brew | **no** (`quest_arena.obj:85`) | scored account: the Khazard barman, 5 coins |

One trade (9 ticks, `primitives.md` §6) carries the helper items. The Khazard
helmet and armour take the head and body slots for the whole quest; keeping them on
through the fights avoids two swaps.

## Step list

Quest varp `%arenaquest` (perm, `quest_arena.varp`), stages from
`quest_arena.constant`: 0, 1 started, 2 armour, 3 spoken to the drunk guard, 5
brew given, 6 ogre fight, 8 ogre dead, 9 sent to the cells, 10 scorpion dead, 11
Bouncer dead, 12 Servils freed, 13 General dead, 14/15 complete.

The measured column is the full run at 70/70/70 (rune scimitar on the default
accurate style, rune kiteshield, rune platelegs, amulet of power, Khazard helmet and
armour, 20 swordfish). Fight rows give the click-to-kill time; the part before
the first hitsplat is the cutscene finishing and is counted under waits in the
total.

| # | Where | Action | Varp | Raw counts | Ticks | Label |
|---|---|---|---|---|---|---|
| 0a | anywhere | Trade with a helper | | 1 trade | **9** | measured, `primitives.md` §6 |
| 0b | → Lady Servil (2566,3199) | Ardougne teleport (Magic 51 and Plague City, `primitives.md` §4) lands (2661,3301), then run | | 1 teleport, 139 route tiles | 4 + 70 = **74** | inferred from the measured primitives; with Tree Gnome Village done, the Battlefield of Khazard spirit tree lands 68 tiles away |
| 1 | Lady Servil | "Can I help you?" | 0 → 1 | 10 pages, 1 option | **25** | measured |
| 2 | → guards' house chest (2613,3189) | Run | | 46 tiles | **28** | measured |
| 3 | Chest (`arena_guard_chest_shut`) | Open, search, wear helmet and armour | 1 → 2 | 4 interactions, 1 message box | **14** | measured |
| 4 | → north prison door (2617,3171) | Run to (2617,3173) | | 27 tiles | **16** | measured |
| 5 | Prison door (`fightarena_door1`) | Open; the guard lets a uniformed player in | | 1 interaction, 2 pages | **8** | measured |
| 6 | → drunk guard (2615,3141) | Run down the corridor | | 31 tiles | **23** | measured |
| 7 | Drunk guard (`arena_guard2`) | Talk | 2 → 3 | 4 pages | **11** | measured |
| 8 | → west prison door (2585,3141) | Run | | 30 tiles | **20** | measured |
| 9 | West prison door | Open from inside, walk out | | 1 interaction | **2** | measured |
| 10 | → Khazard barman (2566,3140) | Run | | 28 tiles | **19** | measured |
| 11 | Barman | "I'd like a Khali brew please." (offered from stage 3, `khazard_barman.rs2:6-7`) | | 4 pages, 1 option | **13** | measured |
| 12 | → west prison door | Run to (2583,3141) | | 29 tiles | **17** | measured |
| 13 | West prison door | Open; the guard lets you in | | 1 interaction, 2 pages | **8** | measured |
| 14 | → drunk guard | Run | | 30 tiles | **17** | measured |
| 15 | Drunk guard | Talk; "Do you still fancy a drink?" path is automatic with the brew held | 3 → 5 | 14 pages | **31** | measured |
| 16 | → Jeremy (2616,3168) | Run to (2618,3167) | | 27 tiles | **17** | measured |
| 17 | Jeremy | Talk with the keys: frees him, cutscene into the arena (`jeremy_servil.rs2:57-93`, `p_delay` distance + 6 + `arena_enter`) | 5 → 6 | 3 pages, cutscene | **20** | measured |
| 18 | Arena | Ogre cutscene finishes (`jeremy_servil.rs2:95-146`), then **fight: Khazard ogre** | 6 → 8 | | **96** (28 cutscene + 68 fight) | measured; over 5 runs the fight part was 28-68, mean 45 |
| 19 | Arena | Ogre's death hook: Sir Servil, General Khazard, guards drag you to the cells (cutscene) | 8 → 9 | 7 pages, cutscene | **23** | measured |
| 20 | Cell | Talk to Hengrad (2598,3142): 10 pages, then the guard escorts you to the arena (`hengrad.rs2:7-70`, `p_delay` 0+9+4+0+1+1 plus forced walks) | | 10 pages, cutscene | **58** | measured |
| 21 | Arena | Scorpion released (`quest_arena.rs2:193-228`), then **fight: Khazard scorpion** | 9 → 10 | | **62** (13 release + 49 fight) | measured; 3 runs: fight part 33-77 |
| 22 | Arena | General summons Bouncer; Bouncer released | | 3 pages, cutscene | **7** | measured |
| 23 | Arena | **Fight: Bouncer** | 10 → 11 | | **142** (6 release + 136 fight; 83 damage taken, 6 swordfish) | measured; 3 runs: 125-142 |
| 24 | Arena | Bouncer's death hook: General frees the Servils and attacks you | 11 → 12 | 5 pages | **14** | measured |
| (25) | Arena | Optional **fight: General Khazard** | 12 → 13 | | **141** (21 damage taken) | measured; not on the route |
| 26 | → arena door (2606,3152) | Run | | 4 tiles | **3** | measured |
| 27 | Arena door (`fightarena_door2`) | Open from inside; forced walk out (`quest_arena.rs2:124-136`) | | 1 interaction | **5** | measured |
| 28 | → west prison door | Run | | 30 tiles | **17** | measured |
| 29 | West prison door | Open, out | | 1 interaction | **3** | measured |
| 30 | → Lady Servil | Run | | 58 tiles | **33** | measured |
| 31 | Lady Servil | Talk; completion queue | 12 → 14 | 4 pages | **11** | measured |

The fight chain (steps 17-24, keys in hand to stage 12) measured **435 ticks at
70/70/70** and **515 ticks at 50/50/50** (same gear, `--stats 50 --from 5`).

## Fights

Stats from `quest_arena.npc`; max hits inferred from the standard melee formula
(floor(0.5 + (strength + 8) × (strength bonus + 64) / 640)).

| Monster | Level | Hitpoints | Stats (att/str/def), bonuses | Style | Max hit (inferred) | Mechanic |
|---|---|---|---|---|---|---|
| Khazard ogre | 63 | 60 | 54/53/53, +22 att, +20 str | crush, attack rate 6 | 8 | spawned for 500 ticks by the cutscene |
| Khazard scorpion | 44 | 40 | 40/39/34 | stab | 5 | |
| Bouncer | 137 | 116 | 120/120/120 | stab | 13 | aggressive, size 2 |
| General Khazard (optional) | 112 | 170 | 75/78/80 | slash | 9 | attacks you at stage 12; leaving is fine |

Measured damage taken and food used:

| Melee | Ogre | Scorpion | Bouncer | Swordfish eaten | Chain (17-24) |
|---|---|---|---|---|---|
| 70/70/70 | 0-13 | 0 | 83-98 | 5-6 | 435 ticks (n=1 full chain; fight parts vary as above) |
| 50/50/50 | 16 | 0 | 142 | 9 | 515 ticks |

Minimum I would call safe: 50/50/50 with base 40 Attack and Defence for rune gear
and at least 15 swordfish (Bouncer alone took 142 hitpoints at 50). Below that,
Bouncer is a death risk. At 70 the danger is small, and Attack levels up several
times during the chain (the fight helper dismisses the level-up boxes; at 25x xp
they come every few kills, coordinator note from cairn://p/rs/12).

## Tick total

At 70/70/70, General left alive, from the measured full run (steps 1-31 without
25) plus the trade and the way in:

| Part | Ticks | Label |
|---|---|---|
| Travel | 210 (340 route tiles) + 74 way in | measured; way in inferred |
| Dialogue (69 pages, 2 options, standalone conversations and the cutscene pages) | 147 | measured (91 standalone, 56 inside cutscenes at 2 per page) |
| Interactions (chest, wearing, doors) | 40 | measured |
| Fights (from first hitsplat to the kill) | 253 | measured |
| Waits (cutscenes outside their pages, release animations) | 113 | measured |
| Trade | 9 | measured, `primitives.md` §6 |
| **Total** | **846** | |

Without the way in and the trade, the quest itself is **763 ticks** (measured
end to end in one run). Killing the General adds about 141 (measured 904 with
him). At 50/50/50 add about 80 for the slower chain. With the client fix
(cairn://p/rs/22) the 71 dialogue clicks cost 1 tick each, about 70 fewer.

## Risks and gotchas

- **Bouncer** is the only real danger: 116 hitpoints, max hit about 13, and
  120 Attack. Bring food scaled to the stats above.
- **The death hooks need the player in the arena.** Each monster's `ai_queue3`
  advances the stage at once if `p_finduid` succeeds, and otherwise queues a
  retry that only fires while you are inside the arena zone
  (`khazard_ogre.rs2:1-12`, `khazard_scorpion.rs2`, `bouncer.rs2`,
  `quest_arena.constant:15-16`). Do not run out of the arena the moment the
  monster dies. No lab run lost a hook.
- **Leftover spawns.** The ogre, scorpion and Bouncer are spawned for 500 ticks
  (`quest_arena.rs2:207,244`, `jeremy_servil.rs2:107`). Two players doing the
  quest within that window share them; a lab account rerunning the chain met the
  previous run's ogre and fought the wrong one.
- **Dialogue at the cell.** The guard's last line ("The General seems to have
  taken a liking to you") arrives about 5 ticks after the forced walk into the
  cell; talk to Hengrad only after it, or the click is lost.
- **The client drops some clicks.** The lite client refused the Hengrad talk and
  attacks on caged monsters as "no route" until its collision caught up; re-click.
- **General Khazard attacks at stage 12.** Walk out through the arena door; he
  did not stop the exit in the lab, and no guard intervenes on the way out unless
  you talk to one or open the arena door from outside
  (`quest_arena.rs2:93-109`, `khazard_guard.rs2:132-142`).
- **Logout:** `%arenaquest` is permanent, so the stage survives a logout. Logout is
  refused in combat (`primitives.md` §8). Logging out in the cell (stage 9) is
  harmless: Hengrad starts the escort again.
- **Pathfinding:** route to tiles beside the prison doors, not onto them;
  `bot.walkTo` aimed at a door tile retried for about 50 ticks.

## Open questions

- **Faster fights.** The lab used the accurate style; aggressive or a better
  weapon (whatever the plan has by then) would shorten the 253 fight ticks. The
  ogre and scorpion times varied by 2x between runs, so a few more samples would
  tighten the means.
- **The Attack reward's value** depends on where Fight Arena sits in the order: if
  earlier quests already cap Attack, only the Thieving and quest points count.
- **A cheaper way in.** If Tree Gnome Village is done, the Khazard spirit tree
  (68 tiles, plus the tree dialogue, about 8 pages and choices) may beat the
  Ardougne teleport; not measured.
