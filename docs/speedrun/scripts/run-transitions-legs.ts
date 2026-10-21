// Transition legs of the provisional run order v1 (cairn://p/rs/103), measured end to end.
//
//   WEB_PORT=9600 WEB_MANAGEMENT_PORT=9601 HISCORES_WEB_PORT=9602 NODE_PORT=44600 AGENT_PORT=8600 \
//     NODE_TICKRATE=300 bash speedrun/lab/lab.sh <bot> 'docs/speedrun/scripts/run-transitions-legs.ts:<ids|all>[:runs]'
//
// Each leg: untimed setup (route stats by ::setstat, items by ::give, quest varps by ::setvar,
// ::tele to the earlier step's end tile), then the clock runs from the tick the first action is
// sent to the first published state at the next step's start tile. One `RESULT leg {...}` line per
// run, with segments, tiles walked, clicks, door opens, web tries and the lowest hp seen.
// Leg ids and tiles: docs/speedrun/research/run-transitions.md.
import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';
import {
    castTele, cheb, cheat, type Ctx, ENCHANT_SAPPHIRE, ensureOffIsland, LegLog, opLoc, pos, result, rubGlory, setup, type Setup,
    TELE_RUNES, talkNpc, throughWebs, disembark, useItemOnLoc, waitTicks, walk, wildLevel,
} from './run-transitions-lib';

const near = (x: number, z: number, r = 2, level = 0) => (s: BotWorldState) => !!s.player && s.player.level === level && cheb({ x: s.player.worldX, z: s.player.worldZ }, { x, z }) <= r;
const underground = (s: BotWorldState) => !!s.player && s.player.worldZ > 4000;

// Route stats at each point (quests/README.md section 4 timeline, skills docs). Unlisted stats are 1, hitpoints 10.
const EARLY7 = { magic: 7 };
const EARLY59 = { magic: 59 };
const MID = { magic: 64, hitpoints: 20, prayer: 43, agility: 25 };
const WILD1 = { attack: 99, hitpoints: 42, magic: 73, prayer: 43, agility: 25 };
const MA = { attack: 99, hitpoints: 45, magic: 81, prayer: 43, ranged: 57, agility: 75 };
const COURSE = { ...MA, agility: 99 };
const LATE = { attack: 99, hitpoints: 60, magic: 99, prayer: 43, ranged: 57, agility: 99 };
const FINAL = { attack: 99, strength: 99, defence: 99, hitpoints: 99, ranged: 99, magic: 99, prayer: 43, agility: 75 };
const VARS = { elenaquest: 30, treequest: 9, grandtree: 160, magearena: 8 };
const WILD_KIT: [string, number][] = [['shark', 6], ['knife', 1]];

const DORIC = { x: 2952, z: 3451 };
const SPIDERS = { x: 3288, z: 3810 };
const KNIGHTS = { x: 2655, z: 3305 };
const RIDGE_SOUTH = { x: 2998, z: 3916 };
const COURSE_START = { x: 3004, z: 3937 }; // agility-course.ts wilderness start, by the pipe
const GT_DOOR = { x: 2465, z: 3489 };
const FM_ROW = { x: 3200, z: 3226 }; // assumed S03 row start (run-transitions.md, S03)

interface Leg { id: string; from: string; to: string; method: string; runs?: number; setup: Setup; run: (c: Ctx, log: LegLog) => Promise<void> }

async function enterCourse(c: Ctx, log: LegLog) {
    await log.seg('walk to the ridge gate', async () => { await walk(c, RIDGE_SOUTH, { tol: 1, eat: true }); });
    await log.seg('ridge gate and ridge', () => opLoc(c, { id: 2309 }, (s) => s.player!.worldZ >= 3929 && !s.dialog.isOpen, 40));
    await log.seg('walk to the pipe', async () => { await walk(c, COURSE_START, { tol: 0, eat: true }); });
}
async function leverToSpiders(c: Ctx, log: LegLog) {
    await log.seg('walk to the lever', async () => { await walk(c, { x: 2562, z: 3311 }, { tol: 1 }); });
    await log.seg('lever', () => opLoc(c, { name: /^lever$/i, op: /pull/i }, (s) => s.player!.worldZ > 3800, 30, [/Yes I'm brave/i]));
    await log.seg('keep web', () => throughWebs(c, [[3158, 3950], [3158, 3953]]));
    await log.seg('walk to the spiders', async () => { await walk(c, SPIDERS, { tol: 2, eat: true }); });
}
async function exitToGlory(c: Ctx, log: LegLog, dest: { x: number; z: number }) {
    await log.seg('walk to wilderness level 30', async () => { await walk(c, dest, { tol: 0, eat: true, stopWhen: (s) => wildLevel(s.player!.worldZ) <= 30 }); });
    await log.seg('glory to Edgeville', () => rubGlory(c, /Edgeville/i));
}
/** No glory (rs/123: charged glories are unobtainable on the demo): walk to Wilderness level 20, then a spell. */
async function exitToSpell(c: Ctx, log: LegLog, dest: { x: number; z: number }, spell: 'varrock' | 'ardougne') {
    await log.seg('walk to wilderness level 20', async () => { await walk(c, dest, { tol: 0, eat: true, stopWhen: (s) => wildLevel(s.player!.worldZ) <= 20 }); });
    await log.seg(`${spell} teleport`, () => castTele(c, spell));
}
/** No glory: into the Deserted Keep by its north web, then the lever out to Ardougne (2562,3311). */
async function leverOut(c: Ctx, log: LegLog) {
    await log.seg('walk to the keep web', async () => { await walk(c, { x: 3158, z: 3953 }, { tol: 1, eat: true }); });
    await log.seg('keep web', () => throughWebs(c, [[3158, 3950]]));
    // the out-lever stands beside the in-lever's landing (3154,3924), 26 tiles south of the web
    await log.seg('walk to the lever', async () => { await walk(c, { x: 3154, z: 3926 }, { tol: 3, eat: true }); });
    await log.seg('lever out', () => opLoc(c, { id: 1815 }, (s) => s.player!.worldZ < 3400, 40));
}
async function treesToStronghold(c: Ctx, log: LegLog, young: { x: number; z: number }) {
    await log.seg('walk to the young tree', async () => { await walk(c, young, { tol: 1 }); });
    await log.seg('young tree to the village tree', () => opLoc(c, { id: 1317 }, near(2542, 3169, 6), 40, [/Yes please/i]));
    await log.seg('village tree to the stronghold', () => opLoc(c, { id: 1294 }, near(2461, 3444, 6), 40, [/Where can I go/i, /Gnome stronghold/i]));
    await log.seg('walk to the Grand Tree door', async () => { await walk(c, GT_DOOR, { tol: 2 }); });
}

const LEGS: Leg[] = [
    { id: 'L01', from: 'S01', to: 'S02', method: 'walk', runs: 3, setup: { at: [3222, 3222], stats: EARLY7 }, run: async (c) => { await walk(c, { x: 3233, z: 3295 }, { tol: 2 }); } },
    { id: 'L02', from: 'S02', to: 'S03', method: 'walk', setup: { at: [3233, 3295], stats: EARLY7 }, run: async (c) => { await walk(c, FM_ROW, { tol: 0 }); } },
    // Item 3: the S03 -> S05 walk with and without enchants, and the teleport alternative
    { id: 'E0', from: 'S03', to: 'S05', method: 'walk Lumbridge road to Doric, no casts', setup: { at: [FM_ROW.x, FM_ROW.z], stats: EARLY7 }, run: async (c) => { await walk(c, DORIC, { tol: 1 }); } },
    {
        id: 'E1', from: 'S03', to: 'S05', method: 'walk to Doric, Lvl-1 Enchant every 3 ticks (26 rings, refilled twice by ::give)',
        setup: { at: [FM_ROW.x, FM_ROW.z], stats: EARLY7, items: [['cosmicrune', 100], ['waterrune', 100], ['sapphire_ring', 26]] },
        run: async (c, log) => {
            const xp0 = c.sdk.getSkill('Magic')!.experience;
            let refills = 0, sent = 0;
            const cast = async () => {
                const ring = c.sdk.getState()!.inventory.find((i) => /^sapphire ring$/i.test(i.name));
                if (!ring) {
                    if (refills >= 2 || sent >= 60) return false;
                    refills++;
                    // Stands in for a helper top-up (costed from the hand-off table): the recoil
                    // rings fill the inventory, so swap them out by staff command. Chat does not stop the run.
                    void c.sdk.sendSay('::~clearinv inv');
                    void c.sdk.sendSay('::give cosmicrune 100');
                    void c.sdk.sendSay('::give waterrune 100');
                    void c.sdk.sendSay('::give sapphire_ring 26');
                    return true;
                }
                if (sent >= 60) return false;
                await c.sdk.sendSpellOnItem(ring.slot, ENCHANT_SAPPHIRE);
                sent++;
                return true;
            };
            await log.seg('walk with casts', async () => {
                await walk(c, DORIC, { tol: 1, cast });
                await waitTicks(c.sdk, 2);
                const landed = Math.round((c.sdk.getSkill('Magic')!.experience - xp0) / 25 / 17.5);
                return `casts sent ${sent}, landed ${landed}, refills ${refills}`;
            });
        },
    },
    { id: 'L04', from: 'S04', to: 'S05', method: 'Falador teleport + walk', setup: { at: [FM_ROW.x, FM_ROW.z], stats: EARLY59, items: TELE_RUNES }, run: async (c, log) => { await log.seg('teleport', () => castTele(c, 'falador')); await log.seg('walk', async () => { await walk(c, DORIC, { tol: 1 }); }); } },
    { id: 'D1', from: 'S05', to: 'S05+DR', method: 'walk Doric to Kaqemeex (Druidic Ritual beside Doric)', setup: { at: [DORIC.x, DORIC.z], stats: EARLY59 }, run: async (c) => { await walk(c, { x: 2924, z: 3486 }, { tol: 1 }); } },
    {
        id: 'L05', from: 'S05', to: 'S06', method: 'Falador teleport + walk + air talisman on the ruins',
        setup: { at: [DORIC.x, DORIC.z], stats: EARLY59, items: [...TELE_RUNES, ['air_talisman', 1]] },
        run: async (c, log) => {
            await log.seg('teleport', () => castTele(c, 'falador'));
            await log.seg('walk to the ruins', async () => { await walk(c, { x: 2984, z: 3293 }, { tol: 2 }); });
            await log.seg('talisman entry', () => useItemOnLoc(c, /air talisman/i, { id: 2452 }, underground));
        },
    },
    {
        id: 'L05w', from: 'S05', to: 'S06', method: 'walk + air talisman on the ruins', runs: 1,
        setup: { at: [DORIC.x, DORIC.z], stats: EARLY59, items: [['air_talisman', 1]] },
        run: async (c, log) => {
            await log.seg('walk to the ruins', async () => { await walk(c, { x: 2984, z: 3293 }, { tol: 2 }); });
            await log.seg('talisman entry', () => useItemOnLoc(c, /air talisman/i, { id: 2452 }, underground));
        },
    },
    { id: 'L06', from: 'S06', to: 'S07', method: 'Falador teleport from the air altar room + walk', setup: { at: [2841, 4830], stats: EARLY59, items: TELE_RUNES }, run: async (c, log) => { await log.seg('teleport', () => castTele(c, 'falador')); await log.seg('walk', async () => { await walk(c, { x: 2912, z: 3495 }, { tol: 1 }); }); } },
    { id: 'L07', from: 'S07', to: 'S08', method: 'Camelot teleport + walk to Edmond', setup: { at: [2920, 3406], stats: EARLY59, items: TELE_RUNES }, run: async (c, log) => { await log.seg('teleport', () => castTele(c, 'camelot')); await log.seg('walk', async () => { await walk(c, { x: 2568, z: 3334 }, { tol: 1 }); }); } },
    { id: 'L08', from: 'S08', to: 'S09', method: 'walk Edmond to the zoo iron', setup: { at: [2568, 3334], stats: MID, vars: VARS }, run: async (c) => { await walk(c, { x: 2604, z: 3235 }, { tol: 2 }); } },
    { id: 'L08t', from: 'S08', to: 'S09', method: 'Ardougne teleport + walk to the zoo iron', setup: { at: [2568, 3334], stats: MID, vars: VARS, items: TELE_RUNES }, run: async (c, log) => { await log.seg('teleport', () => castTele(c, 'ardougne')); await log.seg('walk', async () => { await walk(c, { x: 2604, z: 3235 }, { tol: 2 }); }); } },
    { id: 'L09', from: 'S09', to: 'S10', method: 'walk the zoo to Elkoy', setup: { at: [2604, 3235], stats: MID, vars: VARS }, run: async (c) => { await walk(c, { x: 2504, z: 3191 }, { tol: 1 }); } },
    {
        id: 'L10', from: 'S10', to: 'S11', method: 'village spirit tree to the stronghold + walk to the gnome course',
        setup: { at: [2541, 3171], stats: MID, vars: VARS },
        run: async (c, log) => {
            await log.seg('village tree to the stronghold', () => opLoc(c, { id: 1294 }, near(2461, 3444, 6), 40, [/Where can I go/i, /Gnome stronghold/i]));
            await log.seg('walk to the course', async () => { await walk(c, { x: 2474, z: 3436 }, { tol: 0 }); });
        },
    },
    { id: 'L11a', from: 'S11 course', to: 'S11 Grand Tree', method: 'walk gnome course end to the Grand Tree door', setup: { at: [2484, 3437], stats: MID, vars: VARS }, run: async (c) => { await walk(c, GT_DOOR, { tol: 2 }); } },
    { id: 'L11', from: 'S11', to: 'S12', method: 'Ardougne teleport from the roots + walk to Lady Servil', setup: { at: [2464, 9897], stats: MID, vars: VARS, items: TELE_RUNES }, run: async (c, log) => { await log.seg('teleport', () => castTele(c, 'ardougne')); await log.seg('walk', async () => { await walk(c, { x: 2566, z: 3199 }, { tol: 1 }); }); } },
    { id: 'L13L', from: 'S13', to: 'S14', method: 'Ardougne teleport + lever + keep web + walk to the spiders', setup: { at: [2571, 3463], stats: WILD1, vars: VARS, items: [...TELE_RUNES, ...WILD_KIT] }, run: async (c, log) => { await log.seg('teleport', () => castTele(c, 'ardougne')); await leverToSpiders(c, log); } },
    { id: 'L13G', from: 'S13', to: 'S14', method: 'glory to Edgeville + walk to the spiders', setup: { at: [2571, 3463], stats: WILD1, vars: VARS, items: [['amulet_of_glory_4', 1], ...WILD_KIT] }, run: async (c, log) => { await log.seg('glory', () => rubGlory(c, /Edgeville/i)); await log.seg('walk to the spiders', async () => { await walk(c, SPIDERS, { tol: 2, eat: true }); }); } },
    { id: 'L26L', from: 'S26', to: 'S27', method: 'Ardougne teleport from the Elvarg exit tile + lever + walk to the spiders', runs: 1, setup: { at: [2846, 9636], stats: FINAL, vars: VARS, items: [...TELE_RUNES, ...WILD_KIT] }, run: async (c, log) => { await log.seg('teleport', () => castTele(c, 'ardougne')); await leverToSpiders(c, log); } },
    { id: 'X14', from: 'S14 (spiders)', to: 'out', method: 'walk to wilderness level 30 + glory to Edgeville', runs: 3, setup: { at: [SPIDERS.x, SPIDERS.z], stats: WILD1, vars: VARS, items: [['amulet_of_glory_4', 1], ...WILD_KIT] }, run: async (c, log) => { await exitToGlory(c, log, { x: 3288, z: 3740 }); } },
    { id: 'X14n', from: 'S14 (spiders)', to: 'out', method: 'no glory: walk to wilderness level 20 + Varrock teleport', runs: 3, setup: { at: [SPIDERS.x, SPIDERS.z], stats: WILD1, vars: VARS, items: [...TELE_RUNES, ...WILD_KIT] }, run: async (c, log) => { await exitToSpell(c, log, { x: 3288, z: 3660 }, 'varrock'); } },
    { id: 'X14l', from: 'S14 (spiders)', to: 'out', method: 'no glory: walk to the Deserted Keep, web, lever out to Ardougne', setup: { at: [SPIDERS.x, SPIDERS.z], stats: WILD1, vars: VARS, items: WILD_KIT }, run: async (c, log) => { await leverOut(c, log); } },
    { id: 'L14nv', from: 'S14 (Varrock landing)', to: 'S15', method: 'walk to the Varrock young tree, two tree rides, walk to the Grand Tree door', setup: { at: [3213, 3424], stats: WILD1, vars: VARS }, run: async (c, log) => { await treesToStronghold(c, log, { x: 3179, z: 3507 }); } },
    { id: 'L14nl', from: 'S14 (lever landing)', to: 'S15', method: 'walk from the Ardougne lever to the Khazard young tree, two tree rides, walk to the door', setup: { at: [2562, 3311], stats: WILD1, vars: VARS }, run: async (c, log) => { await treesToStronghold(c, log, { x: 2555, z: 3259 }); } },
    { id: 'L14v', from: 'S14 (Edgeville)', to: 'S15', method: 'walk to the Varrock young tree, two tree rides, walk to the Grand Tree door', setup: { at: [3087, 3496], stats: WILD1, vars: VARS }, run: async (c, log) => { await treesToStronghold(c, log, { x: 3179, z: 3507 }); } },
    { id: 'L14a', from: 'S14 (Edgeville)', to: 'S15', method: 'Ardougne teleport, Khazard young tree, two tree rides, walk to the door', setup: { at: [3087, 3496], stats: WILD1, vars: VARS, items: TELE_RUNES }, run: async (c, log) => { await log.seg('teleport', () => castTele(c, 'ardougne')); await treesToStronghold(c, log, { x: 2555, z: 3259 }); } },
    {
        id: 'L16A', from: 'S16', to: 'S17', method: 'chamber pool, cellar ladder, mage bank webs, walk, ridge gate', runs: 3,
        setup: { at: [2506, 4696], stats: MA, vars: VARS, items: WILD_KIT },
        run: async (c, log) => {
            await log.seg('return pool', () => opLoc(c, { id: 2879 }, near(2542, 4718, 3), 40));
            await log.seg('cellar ladder up', () => opLoc(c, { id: 2872 }, (s) => s.player!.worldZ < 4000, 30));
            // Only the web east of the ladder (3093,3957) stands between the ladder and the way west.
            await log.seg('mage bank web', () => throughWebs(c, [[3094, 3957]]));
            await enterCourse(c, log);
        },
    },
    {
        id: 'L17A', from: 'S17', to: 'S18', method: 'course gate out, walk to level 30, glory, Ardougne teleport, walk to the knights', runs: 3,
        setup: { at: [2994, 3933], stats: COURSE, vars: VARS, items: [['amulet_of_glory_4', 1], ...TELE_RUNES, ...WILD_KIT] },
        run: async (c, log) => {
            await log.seg('course gate and ridge out', async () => {
                const id = (await c.sdk.scanNearbyLocs(8)).some((l) => l.id === 2307) ? 2307 : 2308;
                return opLoc(c, { id }, (s) => s.player!.worldZ <= 3919 && !s.dialog.isOpen, 40);
            });
            await exitToGlory(c, log, { x: 2998, z: 3740 });
            await log.seg('teleport', () => castTele(c, 'ardougne'));
            await log.seg('walk to the knights', async () => { await walk(c, KNIGHTS, { tol: 3 }); });
        },
    },
    {
        id: 'L17n', from: 'S17', to: 'S18', method: 'no glory: course gate out, walk to wilderness level 20, Ardougne teleport, walk to the knights', runs: 3,
        setup: { at: [2994, 3933], stats: COURSE, vars: VARS, items: [...TELE_RUNES, ...WILD_KIT] },
        run: async (c, log) => {
            await log.seg('course gate and ridge out', async () => {
                const id = (await c.sdk.scanNearbyLocs(8)).some((l) => l.id === 2307) ? 2307 : 2308;
                return opLoc(c, { id }, (s) => s.player!.worldZ <= 3919 && !s.dialog.isOpen, 40);
            });
            await exitToSpell(c, log, { x: 2998, z: 3660 }, 'ardougne');
            await log.seg('walk to the knights', async () => { await walk(c, KNIGHTS, { tol: 3 }); });
        },
    },
    {
        id: 'L17nl', from: 'S17', to: 'S18', method: 'no glory: course gate out, walk to the Deserted Keep, web, lever out, walk to the knights',
        setup: { at: [2994, 3933], stats: COURSE, vars: VARS, items: WILD_KIT },
        run: async (c, log) => {
            await log.seg('course gate and ridge out', async () => {
                const id = (await c.sdk.scanNearbyLocs(8)).some((l) => l.id === 2307) ? 2307 : 2308;
                return opLoc(c, { id }, (s) => s.player!.worldZ <= 3919 && !s.dialog.isOpen, 40);
            });
            await leverOut(c, log);
            await log.seg('walk to the knights', async () => { await walk(c, KNIGHTS, { tol: 3 }); });
        },
    },
    { id: 'L16B', from: 'S16', to: 'S18', method: 'Ardougne teleport from the chamber + walk to the knights', runs: 3, setup: { at: [2506, 4696], stats: MA, vars: VARS, items: TELE_RUNES }, run: async (c, log) => { await log.seg('teleport', () => castTele(c, 'ardougne')); await log.seg('walk', async () => { await walk(c, KNIGHTS, { tol: 3 }); }); } },
    { id: 'LB', from: 'S27', to: 'S17', method: 'walk the spiders to the ridge gate + ridge', runs: 3, setup: { at: [SPIDERS.x, SPIDERS.z], stats: FINAL, vars: VARS, items: WILD_KIT }, run: async (c, log) => { await enterCourse(c, log); } },
    { id: 'L18', from: 'S18', to: 'S19', method: 'walk the market to Caroline', setup: { at: [KNIGHTS.x, KNIGHTS.z], stats: LATE, vars: VARS }, run: async (c) => { await walk(c, { x: 2716, z: 3302 }, { tol: 1 }); } },
    {
        id: 'L20G', from: 'S20', to: 'S21', method: 'glory to Karamja + walk + nature talisman on the ruins',
        setup: { at: [2820, 3487], stats: LATE, vars: VARS, items: [['amulet_of_glory_4', 1], ['nature_talisman', 1]] },
        run: async (c, log) => {
            await log.seg('glory to Karamja', () => rubGlory(c, /Karamja/i));
            await log.seg('walk to the ruins', async () => { await walk(c, { x: 2869, z: 3021 }, { tol: 2 }); });
            await log.seg('talisman entry', () => useItemOnLoc(c, /nature talisman/i, { id: 2460 }, underground));
        },
    },
    {
        id: 'L20S', from: 'S20', to: 'S21', method: 'Ardougne teleport + Captain Barnaby to Brimhaven + walk + talisman',
        setup: { at: [2820, 3487], stats: LATE, vars: VARS, items: [...TELE_RUNES, ['coins', 100], ['nature_talisman', 1]] },
        run: async (c, log) => {
            await log.seg('teleport', () => castTele(c, 'ardougne'));
            await log.seg('walk to Barnaby', async () => { await walk(c, { x: 2681, z: 3276 }, { tol: 2 }); });
            await log.seg('ship to the deck', () => talkNpc(c, /^captain barnaby$/i, [/^Yes please/i], (s) => s.player!.level === 1 || cheb({ x: s.player!.worldX, z: s.player!.worldZ }, { x: 2681, z: 3276 }) > 40, 60));
            await log.seg('disembark', () => disembark(c));
            await log.seg('walk to the ruins', async () => { await walk(c, { x: 2869, z: 3021 }, { tol: 2 }); });
            await log.seg('talisman entry', () => useItemOnLoc(c, /nature talisman/i, { id: 2460 }, underground));
        },
    },
    {
        id: 'L20P', from: 'S20', to: 'S21', method: 'no glory: Falador teleport, walk to Port Sarim, ship to Musa Point, walk + talisman',
        setup: { at: [2820, 3487], stats: LATE, vars: VARS, items: [...TELE_RUNES, ['coins', 100], ['nature_talisman', 1]] },
        run: async (c, log) => {
            await log.seg('teleport', () => castTele(c, 'falador'));
            await log.seg('walk to the sailors', async () => { await walk(c, { x: 3029, z: 3217 }, { tol: 2 }); });
            await log.seg('ship to the deck', () => talkNpc(c, /^(seaman lorris|seaman thresnor|captain tobias)$/i, [/^Yes please/i], (s) => s.player!.level === 1 || cheb({ x: s.player!.worldX, z: s.player!.worldZ }, { x: 3029, z: 3217 }) > 40, 60));
            await log.seg('disembark', () => disembark(c));
            await log.seg('walk to the ruins', async () => { await walk(c, { x: 2869, z: 3021 }, { tol: 2 }); });
            await log.seg('talisman entry', () => useItemOnLoc(c, /nature talisman/i, { id: 2460 }, underground));
        },
    },
    { id: 'L21', from: 'S21', to: 'S22', method: 'Lumbridge teleport from the nature altar room + walk to the fly spots', setup: { at: [2400, 4835], stats: LATE, items: TELE_RUNES }, run: async (c, log) => { await log.seg('teleport', () => castTele(c, 'lumbridge')); await log.seg('walk', async () => { await walk(c, { x: 3241, z: 3248 }, { tol: 0 }); }); } },
    { id: 'L22', from: 'S22', to: 'S23', method: 'walk the river to the castle cook', setup: { at: [3241, 3248], stats: LATE }, run: async (c) => { await walk(c, { x: 3209, z: 3215 }, { tol: 1 }); } },
    { id: 'L22t', from: 'S22', to: 'S23', method: 'Lumbridge teleport from the river + walk to the castle cook', setup: { at: [3241, 3248], stats: LATE, items: TELE_RUNES }, run: async (c, log) => { await log.seg('teleport', () => castTele(c, 'lumbridge')); await log.seg('walk', async () => { await walk(c, { x: 3209, z: 3215 }, { tol: 1 }); }); } },
    { id: 'L23', from: 'S23', to: 'S24', method: 'glory to Draynor + walk to the Rusty Anchor', setup: { at: [3209, 3215], stats: LATE, items: [['amulet_of_glory_4', 1]] }, run: async (c, log) => { await log.seg('glory', () => rubGlory(c, /Draynor/i)); await log.seg('walk', async () => { await walk(c, { x: 3045, z: 3257 }, { tol: 1 }); }); } },
    { id: 'L23w', from: 'S23', to: 'S24', method: 'no glory: walk the castle to the Rusty Anchor', setup: { at: [3209, 3215], stats: LATE }, run: async (c) => { await walk(c, { x: 3045, z: 3257 }, { tol: 1 }); } },
    { id: 'L23f', from: 'S23', to: 'S24', method: 'no glory: Falador teleport + walk to the Rusty Anchor', setup: { at: [3209, 3215], stats: LATE, items: TELE_RUNES }, run: async (c, log) => { await log.seg('teleport', () => castTele(c, 'falador')); await log.seg('walk', async () => { await walk(c, { x: 3045, z: 3257 }, { tol: 1 }); }); } },
    { id: 'L24a', from: 'S24 Port Sarim', to: 'S24 Taverley', method: 'Falador teleport + walk to Kaqemeex', setup: { at: [3045, 3257], stats: LATE, items: TELE_RUNES }, run: async (c, log) => { await log.seg('teleport', () => castTele(c, 'falador')); await log.seg('walk', async () => { await walk(c, { x: 2924, z: 3486 }, { tol: 1 }); }); } },
    { id: 'L24b', from: 'S24 Taverley', to: 'S24 Goblin Village', method: 'walk Kaqemeex to the generals', setup: { at: [2924, 3486], stats: LATE }, run: async (c) => { await walk(c, { x: 2957, z: 3511 }, { tol: 1 }); } },
    { id: 'L24d', from: 'S24 Port Sarim', to: 'S24 Goblin Village', method: 'Falador teleport + walk to the generals (Druidic Ritual moved to S05)', setup: { at: [3045, 3257], stats: LATE, items: TELE_RUNES }, run: async (c, log) => { await log.seg('teleport', () => castTele(c, 'falador')); await log.seg('walk', async () => { await walk(c, { x: 2957, z: 3511 }, { tol: 1 }); }); } },
    { id: 'L24c', from: 'S24 Goblin Village', to: 'S24 Varrock', method: 'Varrock teleport + walk to Romeo', setup: { at: [2957, 3511], stats: LATE, items: TELE_RUNES }, run: async (c, log) => { await log.seg('teleport', () => castTele(c, 'varrock')); await log.seg('walk', async () => { await walk(c, { x: 3211, z: 3425 }, { tol: 1 }); }); } },
    { id: 'L24e', from: 'S24', to: 'S25', method: 'walk Romeo to the west anvil', setup: { at: [3211, 3425], stats: LATE }, run: async (c) => { await walk(c, { x: 3188, z: 3426 }, { tol: 1 }); } },
    { id: 'L25', from: 'S25', to: 'S26', method: 'walk the booth to the Champions\' Guild door', setup: { at: [3185, 3436], stats: LATE }, run: async (c) => { await walk(c, { x: 3191, z: 3364 }, { tol: 1 }); } },
];

const [, , , which = 'all', runsArg] = process.argv;
const ids = which === 'all' ? LEGS.map((l) => l.id) : which.split(',');

await runScript(async ({ bot, sdk }) => {
    const c: Ctx = { sdk, bot };
    await ensureOffIsland(c);
    // warm-up: one untimed setup so the first counted leg does not start on a just-loaded login
    await setup(c, { at: [3222, 3218] });
    await waitTicks(sdk, 5);
    const summary: Record<string, number[]> = {};
    for (const id of ids) {
        const leg = LEGS.find((l) => l.id === id);
        if (!leg) { console.log(`unknown leg ${id}`); continue; }
        const n = runsArg ? Number(runsArg) : leg.runs ?? 2;
        for (let r = 0; r < n; r++) {
            try {
                await setup(c, leg.setup);
                const log = new LegLog(sdk);
                c.leg = log;
                await leg.run(c, log);
                const out = { id: leg.id, from: leg.from, to: leg.to, method: leg.method, run: r, ok: true, start: leg.setup.at, ...log.finish() };
                (summary[leg.id] ??= []).push(out.ticks);
                result('leg', out);
            } catch (e: any) {
                result('leg', { id: leg.id, run: r, ok: false, error: String(e?.message ?? e), at: pos(sdk), segs: c.leg?.segs });
                c.leg?.finish();
                if (sdk.getState()?.player?.hp === 0 || sdk.getState()?.player?.isDead) await waitTicks(sdk, 10);
            }
            c.leg = undefined;
            await cheat(sdk, 'setstat hitpoints 99');
        }
    }
    result('summary', summary);
}, { timeout: 4 * 3600_000, printState: false });
