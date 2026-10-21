// Level-up pages per run step (docs/speedrun/research/levelup-cost.md section 3).
//
//   bun docs/speedrun/scripts/levelup-count.ts
//
// A level-up script is queued once per xp drop that raises the base level (Player.ts addXp), and
// it shows one page plus one unlock page when the level it lands on is listed in
// levelup_unlocks.enum (levelup.rs2, levelup_unlocks.rs2). This walks each step's xp drops (base
// xp per action by band, read from the skill documents) from its start xp to its end level and
// counts level-up scripts and unlock pages. Pure arithmetic: no lab.
import { unlockLevels } from './levelup-dismiss';

// Base xp needed for each level (Player.ts level table; the engine keeps tenths, x25 server rate).
const BASE: number[] = [0, 0];
for (let L = 1, acc = 0; L < 99; L++) { acc += Math.floor(L + Math.pow(2, L / 10) * 300); BASE[L + 1] = Math.floor(acc / 4) / 25; }
const levelOf = (xp: number) => { let L = 1; while (L < 99 && xp >= BASE[L + 1]! - 1e-9) L++; return L; };

/** A band: drops of `xp` base each until `until` (a level, or a count of drops with n). */
type Band = { xp: number[]; until?: number; n?: number };
interface Row { step: string; stat: string; from: number; bands: Band[] }

function walk(r: Row) {
    let xp = r.from;
    let scripts = 0, unlocks = 0, drops = 0;
    const unl = unlockLevels(r.stat);
    for (const b of r.bands) {
        for (let i = 0; ; i++) {
            if (b.n !== undefined ? i >= b.n : levelOf(xp) >= (b.until ?? 99)) break;
            for (const d of b.xp) {
                const before = levelOf(xp);
                xp += d;
                drops++;
                const after = levelOf(xp);
                if (after > before) { scripts++; if (unl.has(after)) unlocks++; }
            }
        }
    }
    return { from: levelOf(r.from), to: levelOf(xp), drops, scripts, unlocks };
}

// Per-action base xp (read): magic_spells.dbrow via magic.md; trees.dbrow via woodcutting.md;
// mining.md (iron 35); prayer.md (dragon bones 72); agility.md (course obstacle tables);
// thieving.md (knight 84.3); fishing.md (trout 50 / salmon 70, salmon about 60% of catches
// at 78-99, inferred); runecraft.md (27 x 5 air, 27 x 9 nature); crafting.md and herblore.md
// band tables; smithing.md (platebodies, 5 bars each). Start xp from the quest rewards
// (skills README, quests README).
const ROWS: Row[] = [
    { step: 'S02 Magic 1-7, Wind Strike', stat: 'magic', from: 0, bands: [{ xp: [5.5], until: 7 }] },
    { step: 'S04 Magic 7-59, enchant ladder', stat: 'magic', from: BASE[7]!, bands: [{ xp: [17.5], until: 27 }, { xp: [37], until: 49 }, { xp: [59], until: 57 }, { xp: [67], until: 59 }] },
    { step: 'S06 Runecraft 1-44, air', stat: 'runecraft', from: 0, bands: [{ xp: [135], until: 44 }] },
    { step: 'S07 Woodcutting 1-99', stat: 'woodcutting', from: 0, bands: [{ xp: [25], until: 15 }, { xp: [37.5], until: 73 }, { xp: [67.5], until: 99 }] },
    { step: 'S09 Mining 64-99 (Doric + Plague City 3,725)', stat: 'mining', from: 3725, bands: [{ xp: [35], until: 99 }] },
    { step: 'S09 Mining 49-99 (Doric only, 1,300)', stat: 'mining', from: 1300, bands: [{ xp: [35], until: 99 }] },
    { step: 'S10 Prayer 1-43, 11 dragon bones', stat: 'prayer', from: 0, bands: [{ xp: [72], n: 11 }] },
    { step: 'S11 Agility 1-22, Gnome course', stat: 'agility', from: 0, bands: [{ xp: [7.5, 7.5, 5, 7.5, 5, 7.5, 7.5 + 39], until: 22 }] },
    { step: 'S17 Agility 75-99, Wilderness course', stat: 'agility', from: 7900, bands: [{ xp: [12.5, 20, 20, 20, 498.9], until: 99 }] },
    { step: 'S18 Thieving 57-99, knights', stat: 'thieving', from: 2175, bands: [{ xp: [84.3], until: 99 }] },
    { step: 'S18 Charge 80-99 (in stuns)', stat: 'magic', from: BASE[80]!, bands: [{ xp: [180], until: 99 }] },
    { step: 'S18 Fletching 1-99 (in stuns), 15 arrows per action', stat: 'fletching', from: 0, bands: [{ xp: [15 * 1], until: 15 }, { xp: [15 * 2.5], until: 30 }, { xp: [15 * 5], until: 45 }, { xp: [15 * 7.5], until: 60 }, { xp: [15 * 10], until: 75 }, { xp: [15 * 12.5], until: 99 }] },
    { step: 'S21 Runecraft 44-99, nature', stat: 'runecraft', from: BASE[44]!, bands: [{ xp: [243], until: 99 }] },
    { step: 'S22 Fishing 78-99, fly', stat: 'fishing', from: 9612, bands: [{ xp: [70, 50, 70, 70, 50], until: 99 }] },
    { step: 'S25 Smithing 1-99, platebodies', stat: 'smithing', from: 0, bands: [{ xp: [62.5], n: 3 }, { xp: [125], n: 8 }, { xp: [187.5], n: 19 }, { xp: [250], n: 56 }, { xp: [312.5], until: 99 }] },
    { step: 'S25 Crafting 42-99, gems', stat: 'crafting', from: 750, bands: [{ xp: [85], until: 43 }, { xp: [107.5], until: 55 }, { xp: [137.5], until: 99 }] },
    { step: 'S25 Herblore 28-99, potions', stat: 'herblore', from: 250, bands: [{ xp: [67.5], until: 30 }, { xp: [75], until: 45 }, { xp: [100], until: 55 }, { xp: [125], until: 66 }, { xp: [150], until: 72 }, { xp: [162.5], until: 78 }, { xp: [175], until: 99 }] },
];

console.log('| Step | Levels | Drops | Level-up scripts (pages) | Unlock pages |');
console.log('|---|---|---|---|---|');
for (const r of ROWS) {
    const w = walk(r);
    console.log(`| ${r.step} | ${w.from} -> ${w.to} | ${w.drops} | ${w.scripts} | ${w.unlocks} |`);
}
