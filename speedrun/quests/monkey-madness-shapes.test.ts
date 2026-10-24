import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

import { parseShape } from '../lib/converse';
import { AUNT_BACK_IN, AUNT_BOX, AUNT_DOOR_CLEAR, DEFAULT_OPTIONS, NO_DWELL, steps, tilePrayer } from './monkey-madness';
import { CHILD_TALISMAN, CHILD_TALKS, childLoops, childTalkNeed, lumdoRefuses, MM_SHAPES, narnodeComplete, shapeTicks, type MmShapeName } from './monkey-madness-shapes';
import { talkShape } from './segments';

const QUESTS = join(import.meta.dir, '..', '..', 'server', 'content', 'scripts', 'quests');
const files = new Map<string, string[]>();
const lines = (file: string) => {
    if (!files.has(file)) files.set(file, readFileSync(join(QUESTS, file), 'utf8').split('\n'));
    return files.get(file)!;
};
const MM = (f: string) => `quest_mm/scripts/${f}.rs2`;

/** A page-emitting chat call: chatnpc, .chatnpc, chatnpcnoturn, chatnpc_specific, chatplayer, mesbox, objbox, doubleobjbox. */
const PAGE = /~\.?(chat[a-z_]*|mesbox|objbox|doubleobjbox)\(/;
/** A choice: p_choiceN (with or without a header) or an @multiN menu. */
const CHOICE = /~p_choice\d|@multi\d/;

/** The script lines one conversation shows: inclusive line ranges on the branch the route takes, and the lines of its choices. */
interface Cite {
    pages: ReadonlyArray<readonly [file: string, from: number, to: number]>;
    choices?: ReadonlyArray<readonly [file: string, line: number]>;
}

const pagesIn = (c: Cite) => c.pages.flatMap(([f, a, b]) => lines(f).slice(a - 1, b).map((t, i) => ({ at: `${f}:${a + i}`, t })).filter(l => PAGE.test(l.t)));
const continues = (shape: string) => parseShape(shape).reduce((n, p) => n + (p.kind === 'continue' ? p.n : p.kind === 'state' ? 1 : 0), 0);
const options = (shape: string) => parseShape(shape).filter(p => p.kind === 'opt').length;

/**
 * Each shape's citation (the branch the module takes, as each MM_SHAPES entry's comment says). The menu of Daero's
 * orders opens one submenu per topic and the module returns from each, so its seven clicks are seven menu lines.
 */
const CITES: Record<MmShapeName, Cite> = {
    narnodeStart: { pages: [[MM('mm_narnode'), 70, 74], [MM('mm_narnode'), 103, 115], [MM('mm_narnode'), 129, 134]], choices: [[MM('mm_narnode'), 125]] },
    shipyardGate: { pages: [['quest_grandtree/scripts/shipyardworker.rs2', 66, 68], [MM('mm_caranock'), 46, 57]] },
    caranock: { pages: [[MM('mm_caranock'), 23, 43]] },
    narnodeOrders: { pages: [[MM('mm_narnode'), 144, 148], [MM('mm_narnode'), 179, 183], [MM('mm_narnode'), 188, 189], [MM('mm_narnode'), 193, 194], [MM('mm_narnode'), 200, 202]] },
    daeroOrders: {
        pages: [[MM('mm_daero'), 26, 30], [MM('mm_daero'), 101, 102], [MM('mm_daero'), 110, 110], [MM('mm_daero'), 114, 126], [MM('mm_daero'), 203, 204], [MM('mm_daero'), 207, 208], [MM('mm_daero'), 213, 214]],
        choices: [[MM('mm_daero'), 131], [MM('mm_daero'), 137], [MM('mm_daero'), 131], [MM('mm_daero'), 141], [MM('mm_daero'), 131], [MM('mm_daero'), 145], [MM('mm_daero'), 131], [MM('mm_daero'), 205]],
    },
    daeroWaydar: { pages: [[MM('mm_daero'), 67, 71], [MM('mm_daero'), 76, 93]] },
    daeroReinit: { pages: [[MM('mm_daero'), 37, 48]] },
    waydarFly: { pages: [[MM('mm_waydar'), 7, 9], [MM('mm_waydar'), 15, 16]], choices: [[MM('mm_waydar'), 13]] },
    waydarIntro: { pages: [[MM('mm_waydar'), 66, 70]] },
    waydarLumdo: { pages: [[MM('mm_waydar'), 74, 93], [MM('quest_mm'), 288, 343]], choices: [[MM('mm_waydar'), 63]] },
    daeroReturn: { pages: [[MM('mm_daero'), 219, 219], [MM('mm_daero'), 222, 223]], choices: [[MM('mm_daero'), 220]] },
    waydarReturn: { pages: [[MM('mm_waydar'), 11, 11], [MM('mm_waydar'), 15, 16]], choices: [[MM('mm_waydar'), 13]] },
    lumdoSail: { pages: [[MM('mm_lumdo'), 19, 20]] },
    garkorFirst: { pages: [[MM('mm_garkor'), 96, 115], [MM('mm_garkor'), 120, 126]] },
    dentureCrate: { pages: [[MM('quest_mm'), 924, 932]], choices: [[MM('quest_mm'), 928]] },
    // The landing mesbox (987/991) comes after the arrival the search ends on; the walk out closes it.
    holeCrate: { pages: [[MM('quest_mm'), 968, 968], [MM('quest_mm'), 974, 974]], choices: [[MM('quest_mm'), 969]] },
    mouldCrate: { pages: [[MM('quest_mm'), 934, 942]], choices: [[MM('quest_mm'), 938]] },
    zooknockStory: {
        pages: [[MM('mm_zooknock'), 29, 36], [MM('mm_zooknock'), 333, 344], [MM('mm_zooknock'), 348, 363], [MM('mm_zooknock'), 369, 371], [MM('mm_zooknock'), 319, 329], [MM('mm_zooknock'), 305, 312], [MM('mm_zooknock'), 260, 260], [MM('mm_zooknock'), 166, 166], [MM('mm_zooknock'), 277, 277]],
        choices: [[MM('mm_zooknock'), 316], [MM('mm_zooknock'), 262]],
    },
    zooknockDentures: { pages: [[MM('mm_zooknock'), 65, 65], [MM('mm_zooknock'), 42, 42], [MM('mm_zooknock'), 201, 201]] },
    zooknockGoldBar: { pages: [[MM('mm_zooknock'), 79, 79], [MM('mm_zooknock'), 42, 42], [MM('mm_zooknock'), 201, 201]] },
    zooknockMould: { pages: [[MM('mm_zooknock'), 93, 93], [MM('mm_zooknock'), 42, 42], [MM('mm_zooknock'), 186, 197]] },
    zooknockTalisman: { pages: [[MM('mm_zooknock'), 133, 133], [MM('mm_zooknock'), 42, 42], [MM('mm_zooknock'), 209, 209]] },
    zooknockBones: { pages: [[MM('mm_zooknock'), 119, 119], [MM('mm_zooknock'), 42, 42], [MM('mm_zooknock'), 216, 228]] },
    chapter3: { pages: [[MM('quest_mm'), 386, 458]] },
    childHello: { pages: [[MM('mm_monkey_child'), 4, 4], [MM('mm_monkey_child'), 13, 16]] },
    childUncle: { pages: [[MM('mm_monkey_child'), 6, 6], [MM('mm_monkey_child'), 18, 20], [MM('mm_monkey_child'), 176, 179]], choices: [[MM('mm_monkey_child'), 22]] },
    childBananasWanted: { pages: [[MM('mm_monkey_child'), 27, 32], [MM('mm_monkey_child'), 155, 161]], choices: [[MM('mm_monkey_child'), 33]] },
    childBananas: { pages: [[MM('mm_monkey_child'), 37, 37], [MM('mm_monkey_child'), 42, 42], [MM('mm_monkey_child'), 137, 144]] },
    childTalisman: { pages: [[MM('mm_monkey_child'), 45, 45], [MM('mm_monkey_child'), 47, 55]] },
    garkorAlliance: { pages: [[MM('mm_garkor'), 62, 63], [MM('mm_garkor'), 73, 73], [MM('mm_garkor'), 139, 140]] },
    elderGuardFirst: { pages: [[MM('mm_elder_guard'), 19, 19], [MM('mm_elder_guard'), 44, 48]] },
    kruk: { pages: [[MM('mm_kruk'), 9, 9], [MM('mm_kruk'), 14, 18], [MM('mm_kruk'), 25, 25]] },
    awowogeiMission: { pages: [[MM('mm_awowogei'), 64, 70], [MM('mm_awowogei'), 72, 91]] },
    minderIn: { pages: [[MM('mm_monkey_minder'), 29, 29], [MM('mm_monkey_minder'), 35, 41]] },
    zooMonkey: { pages: [[MM('mm_zoo_monkey'), 6, 6], [MM('mm_zoo_monkey'), 15, 32]] },
    // The last two pages (23-24) come after the teleport the talk ends on; T's dismiss answers them.
    minderOut: { pages: [[MM('mm_monkey_minder'), 13, 15]] },
    elderGuardIn: { pages: [[MM('mm_elder_guard'), 19, 19], [MM('mm_elder_guard'), 28, 29]] },
    awowogeiCaptive: { pages: [[MM('mm_awowogei'), 42, 44], [MM('mm_awowogei'), 105, 115]] },
    elderGuardOut: { pages: [[MM('mm_elder_guard'), 19, 22]] },
    garkorChapter4: { pages: [[MM('mm_garkor'), 131, 136]] },
    chapter4: { pages: [[MM('quest_mm'), 514, 612]] },
    garkorSigil: { pages: [[MM('mm_garkor'), 26, 47]] },
    daeroTraining: { pages: [[MM('mm_daero'), 242, 251]], choices: [[MM('mm_daero'), 252]] },
};

const SOURCE = readFileSync(join(import.meta.dir, 'monkey-madness.ts'), 'utf8');

describe('S15 conversation shapes', () => {
    test('every shape parses, has a citation, and is used by the module', () => {
        for (const [name, shape] of Object.entries(MM_SHAPES)) {
            expect(() => parseShape(shape)).not.toThrow();
            expect(CITES[name as MmShapeName]).toBeDefined();
            expect(SOURCE.includes(`MM_SHAPES.${name}`) || CHILD_TALKS.some(t => t.shape === shape) || CHILD_TALISMAN.shape === shape).toBe(true);
        }
    });

    for (const [name, shape] of Object.entries(MM_SHAPES) as Array<[MmShapeName, string]>) {
        test(`${name} '${shape}' matches its script's pages and choices`, () => {
            const c = CITES[name];
            const seen = pagesIn(c);
            expect({ name, pages: seen.length, lines: seen.map(l => l.at) }).toMatchObject({ name, pages: continues(shape) });
            const ch = c.choices ?? [];
            expect(ch.length).toBe(options(shape));
            for (const [f, l] of ch) expect({ at: `${f}:${l}`, choice: CHOICE.test(lines(f)[l - 1]!) }).toEqual({ at: `${f}:${l}`, choice: true });
        });
    }

    test("Lumdo's first talk shows the seal only when it is held (mm_lumdo.rs2:39-45)", () => {
        const base = [[MM('mm_lumdo'), 33, 37], [MM('mm_lumdo'), 51, 68]] as const;
        expect(pagesIn({ pages: [...base, [MM('mm_lumdo'), 40, 42]] }).length).toBe(continues(lumdoRefuses(true)));
        expect(pagesIn({ pages: [...base, [MM('mm_lumdo'), 44, 45]] }).length).toBe(continues(lumdoRefuses(false)));
    });

    test("Narnode's report shows the sigil's objbox only when it is held or worn (mm_narnode.rs2:26)", () => {
        const tail = [[MM('mm_narnode'), 27, 27], [MM('mm_narnode'), 90, 90], [MM('mm_narnode'), 99, 99], [MM('mm_narnode'), 80, 86]] as const;
        expect(pagesIn({ pages: [[MM('mm_narnode'), 15, 26], ...tail] }).length).toBe(continues(narnodeComplete(true)));
        expect(pagesIn({ pages: [[MM('mm_narnode'), 15, 25], ...tail] }).length).toBe(continues(narnodeComplete(false)));
        expect(lines(MM('mm_narnode'))[25]).toMatch(/mm_sigil.*objbox/);
    });

    test('the module routes every conversation through a shape except the stray-page dismiss and the west gate (no dialogue as a monkey)', () => {
        const calls = SOURCE.split('\n').map((l, i) => ({ l, i: i + 1 })).filter(({ l }) => /\b(talkTo|actConverse|converse)\(sdk|await talk\(/.test(l));
        const unshaped = calls.filter(({ i }) => !/shaped\(|shape:/.test(SOURCE.split('\n').slice(i - 1, i + 3).join('\n')));
        expect(unshaped.map(({ l }) => l.trim())).toEqual([
            expect.stringContaining('await converse(sdk, [], { openTicks: 1, idle: 2'),
            expect.stringContaining('await actConverse(sdk, await locClick(sdk, WEST_GATE'),
        ]);
    });
});

describe('S15 dialogue modes', () => {
    test("the default stays 'fixed', and both modes build the same 26 steps", () => {
        expect(DEFAULT_OPTIONS.dialogue).toBe('fixed');
        const fixed = steps();
        const burst = steps({ dialogue: 'burst' });
        expect(burst.map(s => s.name)).toEqual(fixed.map(s => s.name));
        expect(burst.map(s => s.logoutSafe)).toEqual(fixed.map(s => s.logoutSafe));
        expect(burst).toHaveLength(26);
    });

    test('talkShape bursts only in burst mode', () => {
        expect(talkShape({ dialogue: 'fixed' }, MM_SHAPES.garkorFirst)).toEqual({ shape: '25c', burst: false });
        expect(talkShape({ dialogue: 'burst' }, MM_SHAPES.garkorFirst)).toEqual({ shape: '25c', burst: true });
    });

    test("CONVENTIONS' columns: fixed a tick a page; burst ceil(k/5), 1 + ceil((k-1)/5) after an option or state page", () => {
        expect(shapeTicks('25c', 'fixed')).toBe(25);
        expect(shapeTicks('25c', 'burst')).toBe(5);
        expect(shapeTicks('4c, opt, 6c, state, 2c', 'burst')).toBe(7); // CONVENTIONS.md's worked example
        expect(shapeTicks('55c, opt, 2c, opt, 1c', 'burst')).toBe(11 + 1 + 2 + 1 + 1);
    });
});

describe("O: the child's talks against the aunt's loop, by dialogue mode", () => {
    test('fixed keeps the measured needs; burst takes off only the dialogue ticks it saves', () => {
        expect(CHILD_TALKS.map(t => childTalkNeed(t, 'fixed'))).toEqual([12, 12, 16, 16]);
        expect(childTalkNeed(CHILD_TALISMAN, 'fixed')).toBe(20);
        // hello 4 -> 1, uncle 7 -> 4, bananas wanted 12 -> 4, bananas 6 -> 4, talisman 7 -> 3.
        expect(CHILD_TALKS.map(t => childTalkNeed(t, 'burst'))).toEqual([9, 9, 8, 14]);
        expect(childTalkNeed(CHILD_TALISMAN, 'burst')).toBe(16);
    });

    // The window from the door's clearance to two ticks before her return; the wait tile (2749,2791) is 6 from the child
    // (2743,2795); the five bananas are 5 searches of 2 ticks, and a chain arriving with one free slot sets four sharks
    // down (a 1-tick drop, 3 ticks each to take back), all inside the bananas' window as the module plans it.
    const window = AUNT_BACK_IN - 2 - AUNT_DOOR_CLEAR;
    const sharks = { window, walkIn: 6, beforeBananas: 5 * 2 + 1 + 4 * 3, bananasExtraNeed: 5 * 2 + 1 + 4 * 3 };
    const room = { window, walkIn: 6, beforeBananas: 5 * 2, bananasExtraNeed: 5 * 2 };

    test('burst: all four talks in one of her loops, with the sharks set down or not (inferred; the lab measures it)', () => {
        expect(window).toBe(54);
        expect(childLoops('burst', sharks)).toBe(1);
        expect(childLoops('burst', room)).toBe(1);
    });

    test('fixed: the bananas wait for a second loop', () => {
        expect(childLoops('fixed', sharks)).toBe(2);
        expect(childLoops('fixed', room)).toBe(2);
    });

    test('the talks stand in the aunt\'s box under Melee, the same in both modes: the prayer rule is by tile, not by when a talk ends', () => {
        for (const t of [{ x: 2743, z: 2795 }, { x: 2749, z: 2791 }]) {
            expect(t.x >= AUNT_BOX.x0 && t.x <= AUNT_BOX.x1 && t.z >= AUNT_BOX.z0 && t.z <= AUNT_BOX.z1).toBe(true);
            expect(tilePrayer(t, 0)).toBe('protect_from_melee');
        }
        // Garkor's tile (I's talk as a human) is no corridor no-dwell tile: a shorter talk only shortens the stand.
        const garkor = { x: 2805, z: 2762 };
        expect(NO_DWELL.some(n => n.x === garkor.x && n.z === garkor.z)).toBe(false);
    });
});
