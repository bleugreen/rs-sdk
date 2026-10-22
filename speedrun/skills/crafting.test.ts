import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { ActionResult, BotWorldState, InventoryItem, NearbyLoc } from '../../sdk/types';
import { baseState, FakeSdk, flush, type SentAction } from '../lib/fake-sdk';
import type { ProgramStatus } from '../lib/programs';
import { TickLog } from '../lib/ticks';
import { levelForXp, xpForLevel } from '../lib/xp';
import { Observation, resolveResume } from '../runner/resume';
import { runSteps, type RunnerSession } from '../runner/step';
import {
    bodiesTo,
    CRAFTING_99_XP,
    craftingHandoffXp,
    gemBaseXp,
    GEM_ROW,
    HANDOFF_BANKED,
    HARD_LEATHER_BODY,
    ITEM,
    loadStagedGems,
    LOAD,
    plannedBodies,
    preconditions,
    skill,
    stagedGemCounts,
    stagedGemsFrom,
    STEP_NAME,
    steps,
    supplyFor,
    threadFor,
    XP_PER_BODY,
    type StagedGem
} from './crafting';
import { HERB_NOTES, VARROCK_WEST } from './herblore';

/** rs/158's full window mix, by name as H21d's row writes it: 107 gems, 6,567.5 base. */
const FULL: StagedGem[] = [
    { name: 'uncut sapphire', count: 62 },
    { name: 'uncut emerald', count: 23 },
    { name: 'uncut ruby', count: 20 },
    { name: 'uncut diamond', count: 2 }
];
/** rs/41's short mix, by id: 6 sapphire, 5 emerald and 3 ruby fewer (93 gems, 892.5 base less). */
const SHORT: StagedGem[] = [
    { name: 'uncut sapphire', id: 1623, count: 56 },
    { name: 'uncut emerald', id: 1621, count: 18 },
    { name: 'uncut ruby', id: 1619, count: 17 },
    { name: 'uncut diamond', id: 1617, count: 2 }
];
/** The tests' own staged list, so a change to H21d's row does not move their numbers. */
const O = { stagedGems: FULL };
const HANDOFF = craftingHandoffXp(FULL);

const ROOT = join(import.meta.dir, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

function objPack(): Map<string, number> {
    const m = new Map<string, number>();
    for (const line of read('server/content/pack/obj.pack').split('\n')) {
        const r = line.match(/^(\d+)=(\S+)/);
        if (r) m.set(r[2]!, Number(r[1]));
    }
    return m;
}

// ---------------------------------------------------------------- the content

describe('the content', () => {
    const pack = objPack();

    test('HARD_LEATHER_BODY matches leather.dbrow (level, productexp in tenths) and obj.pack', () => {
        const dbrow = read('server/content/scripts/skill_crafting/configs/leather/leather.dbrow');
        const row = dbrow.split(/\n(?=\[)/).find(b => b.startsWith('[craft_hardleather_body]'))!;
        expect(row).toContain('data=leather,hard_leather,1');
        expect(row).toContain('data=product,hardleather_body');
        expect(row).toContain('data=members,false');
        expect(Number(row.match(/data=levelrequired,(\d+)/)![1])).toBe(HARD_LEATHER_BODY.level);
        expect(Number(row.match(/data=productexp,(\d+)/)![1]) / 10).toBe(HARD_LEATHER_BODY.xp);
        expect(ITEM as Record<string, number>).toEqual({
            needle: pack.get('needle')!,
            thread: pack.get('thread')!,
            hardLeather: pack.get('hard_leather')!,
            hardLeatherNote: pack.get('cert_hard_leather')!,
            body: pack.get('hardleather_body')!,
            bodyNote: pack.get('cert_hardleather_body')!,
            chisel: pack.get('chisel')!
        });
        expect(HARD_LEATHER_BODY).toMatchObject({ a: ITEM.hardLeather, tool: ITEM.needle, keep: [{ id: ITEM.thread, every: 5 }], products: [ITEM.body] });
    });

    test('leather.rs2: needle on hard leather makes the body at once; a thread worn every 5th; none opens an objbox', () => {
        const rs = read('server/content/scripts/skill_crafting/scripts/leather/leather.rs2');
        expect(rs).toContain('[opheldu,hard_leather]\nif (last_useitem = needle) @craft_leather(hardleather_body, 1);');
        expect(rs).toContain('case hard_leather : @craft_leather(hardleather_body, 1);');
        expect(rs).toMatch(/if\(\$product = hardleather_body\) \{[^}]*stat_advance[^}]*%thread_used = calc\(%thread_used \+ 1\);\s*if \(%thread_used > 4\)/);
        expect(rs).toMatch(/if \(inv_total\(inv, thread\) < 1\) \{\s*~objbox\(thread/);
        // %thread_used is server-only (not transmitted): the module assumes the worst case
        expect(read('server/content/scripts/_unpack/225/all.varp')).toMatch(/\[thread_used\]\nscope=perm\n\n/);
    });

    test('needle and thread stack (one slot each)', () => {
        const obj = read('server/content/scripts/skill_crafting/configs/crafting.obj');
        for (const name of ['needle', 'thread']) expect(obj.split(/\n(?=\[)/).find(b => b.startsWith(`[${name}]`))).toContain('stackable=yes');
    });

    test('HANDOFF_BANKED: the chisel, every cert_uncut_ gem and the herb notes', () => {
        const gems = [...pack].filter(([n]) => /^cert_uncut_/.test(n)).map(([, id]) => id);
        expect(new Set(HANDOFF_BANKED)).toEqual(new Set([pack.get('chisel')!, ...gems, ...HERB_NOTES.keys()]));
    });

    test('module convention', () => {
        expect(skill).toBe('crafting');
        expect(STEP_NAME).toBe('S25d crafting');
        expect(LOAD).toBe(26);
    });
});

// ---------------------------------------------------------------- the stop and the supply

describe('the hand-off and the supply', () => {
    test('the full mix: 6,567.5 base, the hand-off 834,270.5, Crafting 96', () => {
        expect(stagedGemCounts(FULL)).toEqual({ sapphire: 62, emerald: 23, ruby: 20, diamond: 2 });
        expect(gemBaseXp(stagedGemCounts(FULL) as never)).toBe(6567.5);
        expect(HANDOFF).toBe(xpForLevel(99) - 6567.5 * 25);
        expect(HANDOFF).toBe(834270.5);
        expect(levelForXp(HANDOFF)).toBe(96);
        expect(CRAFTING_99_XP).toBe(xpForLevel(99));
        expect(XP_PER_BODY).toBe(875);
    });

    test('the short mix: 892.5 base fewer moves the stop up 22,312.5 xp, still Crafting 96', () => {
        expect(gemBaseXp(stagedGemCounts(SHORT) as never)).toBe(6567.5 - 892.5);
        expect(craftingHandoffXp(SHORT)).toBe(xpForLevel(99) - 5675 * 25);
        expect(craftingHandoffXp(SHORT)).toBe(856583);
        expect(craftingHandoffXp(SHORT) - HANDOFF).toBe(892.5 * 25);
        expect(levelForXp(craftingHandoffXp(SHORT))).toBe(96);
    });

    test('an empty mix: Crafting goes to 99 itself', () => {
        expect(craftingHandoffXp([])).toBe(CRAFTING_99_XP);
        expect(plannedBodies(world(), { stagedGems: [] })).toBe(1116);
        expect(craftingHandoffXp([{ name: 'uncut ruby', count: 0 }])).toBe(CRAFTING_99_XP);
    });

    test('by name or by id, any case; two stacks of one gem add', () => {
        expect(craftingHandoffXp([{ name: 'Uncut Diamond', count: 1 }])).toBe(CRAFTING_99_XP - 107.5 * 25);
        expect(craftingHandoffXp([{ id: 1617, count: 1 }])).toBe(CRAFTING_99_XP - 107.5 * 25);
        // with an id the name is only a label (the ledger's rule)
        expect(craftingHandoffXp([{ name: 'gems', id: 1623, count: 2 }])).toBe(CRAFTING_99_XP - 100 * 25);
        expect(stagedGemCounts([{ name: 'uncut sapphire', count: 30 }, { id: 1623, count: 32 }])).toMatchObject({ sapphire: 62 });
    });

    test('an unknown gem, a noted id or a count not whole: refused with the reason, in craftingHandoffXp and the precondition', () => {
        const known = 'uncut sapphire @1623, uncut emerald @1621, uncut ruby @1619, uncut diamond @1617';
        expect(() => craftingHandoffXp([...FULL, { name: 'uncut dragonstone', id: 1631, count: 1 }])).toThrow(`uncut dragonstone @1631 is not an uncut gem the windows cut (${known})`);
        expect(() => craftingHandoffXp([{ name: 'uncut opal', count: 3 }])).toThrow('uncut opal is not an uncut gem the windows cut');
        // the ledger's @ID is the unnoted id: a cert id is not a gem
        expect(stagedGemCounts([{ name: 'uncut sapphire', id: 1624, count: 62 }])).toMatch(/^uncut sapphire @1624 is not an uncut gem/);
        expect(stagedGemCounts([{ name: 'uncut ruby', count: null }])).toBe('uncut ruby: count ? is not a whole number of gems');
        expect(stagedGemCounts([{ name: 'uncut ruby', count: 2.5 }])).toBe('uncut ruby: count 2.5 is not a whole number of gems');
        expect(preconditions(world(), { stagedGems: [{ id: 1631, count: 1 }] })).toBe(`staged gems (H21d): gem @1631 is not an uncut gem the windows cut (${known})`);
        // an explicit untilXp needs no gems
        expect(preconditions(world({ inventory: [] }), { stagedGems: [{ id: 1631, count: 1 }], untilXp: CRAFTING_99_XP })).toBe(true);
        // the step refuses to run, and is neither done nor in progress
        const [s] = steps({ stagedGems: [{ id: 1631, count: 1 }] });
        expect(s!.done!(new Observation(world({ xp: CRAFTING_99_XP, inventory: [] })), {})).toBe(false);
    });

    test('per attempt from 45 (Goblin Diplomacy): the full mix 928 bodies, 954 leather, 187 thread; the short mix 953, 979, 192', () => {
        expect(levelForXp(950 * 25)).toBe(45);
        expect(supplyFor(xpForLevel(45), HANDOFF)).toEqual({ bodies: 928, hardLeather: 954, thread: 187, needle: 1 });
        expect(supplyFor(xpForLevel(42), HANDOFF).bodies).toBe(933);
        expect(supplyFor(xpForLevel(45), craftingHandoffXp(SHORT))).toEqual({ bodies: 953, hardLeather: 979, thread: 192, needle: 1 });
        expect(supplyFor(xpForLevel(45), CRAFTING_99_XP).bodies).toBe(1116);
    });

    test('the stop at untilXp and not past it: the body that reaches it is the last', () => {
        const x = xpForLevel(45);
        const n = bodiesTo(x, HANDOFF);
        expect(x + n * XP_PER_BODY).toBeGreaterThanOrEqual(HANDOFF);
        expect(x + (n - 1) * XP_PER_BODY).toBeLessThan(HANDOFF);
        expect(bodiesTo(HANDOFF, HANDOFF)).toBe(0);
        expect(bodiesTo(HANDOFF + 1000, HANDOFF)).toBe(0);
        expect(bodiesTo(HANDOFF - 875, HANDOFF)).toBe(1);
        expect(bodiesTo(HANDOFF - 875.5, HANDOFF)).toBe(2);
    });

    test('threadFor: the worst-case wear (one with the first body, then every 5th)', () => {
        expect([0, 1, 2, 6, 7, 26, 27, 928].map(threadFor)).toEqual([0, 1, 2, 2, 3, 6, 7, 187]);
    });
});

// ---------------------------------------------------------------- H21d's row

describe('the staged gems from the inventory ledger', () => {
    const ledger = (h21d: string) =>
        [
            '## Inventory ledger',
            '',
            '| row | in | out | equip | needAtStart | source |',
            '|---|---|---|---|---|---|',
            '| H21c | unfermented wine x520 [n] | - | - | 1 | (r) |',
            `| H21d | ${h21d} | - | - | 17 | (r) |`,
            ''
        ].join('\n');

    test("H21d's gem entries, by name as the manifest writes them, and nothing else of the row", () => {
        const row = 'chisel x1 [u]; uncut sapphire x62 [n]; uncut emerald x23 [n]; uncut ruby x20 [n]; uncut diamond x2 [n] (the 107); hard leather x954 [n]; needle x1 [u]; thread x187 [s]; guam potion (unf) @91 x358 [n]';
        const gems = stagedGemsFrom(ledger(row));
        expect(gems).toEqual(FULL);
        expect(craftingHandoffXp(gems)).toBe(834270.5);
    });

    test('by id (rs/365), an unknown uncut gem kept so that it is refused, the row or the table missing', () => {
        expect(stagedGemsFrom(ledger('uncut ruby @1619 x17 [n]; needle x1 [u]'))).toEqual([{ name: 'uncut ruby', id: 1619, count: 17 }]);
        const opal = stagedGemsFrom(ledger('uncut sapphire x62 [n]; uncut opal x3 [n]'));
        expect(opal).toHaveLength(2);
        expect(() => craftingHandoffXp(opal)).toThrow('uncut opal is not an uncut gem the windows cut');
        expect(stagedGemsFrom(ledger('hard leather x954 [n]'))).toEqual([]);
        expect(() => stagedGemsFrom(ledger('x').replace('| H21d |', '| H21x |'))).toThrow('the inventory ledger has no row H21d');
        expect(() => stagedGemsFrom('no table')).toThrow(/^the inventory ledger does not parse/);
    });

    test("STEP-MANIFEST.md's own H21d row reads as known gems (the default the steps take)", () => {
        expect(GEM_ROW).toBe('H21d');
        const gems = loadStagedGems();
        expect(gems.length).toBeGreaterThan(0);
        expect(typeof stagedGemCounts(gems)).toBe('object');
        expect(levelForXp(craftingHandoffXp(gems))).toBeGreaterThanOrEqual(90);
        const [s] = steps();
        expect(s!.done!(new Observation(world({ xp: craftingHandoffXp(gems), inventory: [] })), {})).toBe(true);
    });
});

// ---------------------------------------------------------------- state fixtures

const BOOTH_LOC = { id: 2213, x: 3186, z: 3436, name: 'Bank booth', level: 0, distance: 1, options: ['Use', 'Use-quickly'], optionsWithIndex: [{ text: 'Use', opIndex: 1 }, { text: 'Use-quickly', opIndex: 2 }] } as unknown as NearbyLoc;

const item = (slot: number, id: number, count = 1, name = `obj ${id}`): InventoryItem => ({ slot, id, name, count, optionsWithIndex: [] });
/** The hand-off as delivered: needle, a 230-thread stack, 954 leather notes, and H21d/H21e's stacks for later steps. */
const HANDED = [item(0, ITEM.needle, 1, 'Needle'), item(1, ITEM.thread, 230, 'Thread'), item(2, ITEM.hardLeatherNote, 954, 'Hard leather'), item(3, ITEM.chisel, 1, 'Chisel'), item(4, 1618, 107, 'Uncut diamond'), item(5, 102, 405, 'Unfinished potion')];

function world(o: { level?: number; xp?: number; inventory?: InventoryItem[]; bank?: Array<[number, number]>; booth?: boolean } = {}): BotWorldState {
    const xp = o.xp ?? xpForLevel(o.level ?? 45);
    const level = levelForXp(xp);
    return baseState({
        tick: 100,
        player: { name: 'lab_c1', worldX: 3185, worldZ: 3436, x: 3185, z: 3436, level: 0 } as BotWorldState['player'],
        skills: [{ name: 'Crafting', level, baseLevel: level, experience: xp }],
        inventory: o.inventory ?? HANDED,
        nearbyLocs: o.booth === false ? [{ ...BOOTH_LOC, id: 1, x: 3000 }] : [BOOTH_LOC],
        ...(o.bank ? { bank: { isOpen: true, noteMode: false, items: o.bank.map(([id, count], slot) => ({ slot, id, name: `obj ${id}`, count })) } } : {})
    });
}

describe('preconditions', () => {
    test('the real start: Crafting 45 at the booth holding the hand-off passes (H21d/H21e stacks are banked, not blocking)', () => {
        expect(preconditions(world(), O)).toBe(true);
        expect(preconditions(world({ level: 42 }), O)).toBe(true);
    });

    test('below 28: hard leather bodies need 28', () => {
        expect(preconditions(world({ level: 27 }), O)).toBe('Crafting 27 is below 28: hard leather bodies need 28 (leather.dbrow craft_hardleather_body)');
    });

    test('free slots: anything not the cycle or the hand-off stacks blocks the 28-slot working inventory', () => {
        expect(preconditions(world({ inventory: [...HANDED, item(6, 2347, 1, 'Hammer'), item(7, 1351, 1, 'Bronze axe')] }), O)).toBe('2 other items (Hammer, Bronze axe): need 28 free slots');
        // bodies, unnoted leather and notes of either are the cycle's own (a resume mid-inventory)
        expect(preconditions(world({ inventory: [item(0, ITEM.needle), item(1, ITEM.thread, 187), item(2, ITEM.body), item(3, ITEM.hardLeather), item(4, ITEM.hardLeatherNote, 954), item(5, ITEM.bodyNote, 3)] }), O)).toBe(true);
        // a caller can name what its own first visit banks
        expect(preconditions(world({ inventory: [...HANDED, item(6, 2347, 1, 'Hammer')] }), { ...O, banksFirst: [...HANDOFF_BANKED, 2347] })).toBe(true);
    });

    test('leather notes held short of the bodies say so', () => {
        const inv = [item(0, ITEM.needle), item(1, ITEM.thread, 230), item(2, ITEM.hardLeatherNote, 900, 'Hard leather')];
        expect(preconditions(world({ inventory: inv }), O)).toBe('supplies short: 900 hard leather for 928 bodies to 834270.5 xp (they reach Crafting 95)');
        // 928 exactly is enough; the spare inventory is the hand-off's margin, not a precondition
        expect(preconditions(world({ inventory: [...inv.slice(0, 2), item(2, ITEM.hardLeatherNote, 928)] }), O)).toBe(true);
    });

    test('the short mix moves the stop: the full mix\'s 187 thread refuse, leather short of 953 bodies refuses, the short mix\'s package passes', () => {
        const pack = (leather: number, thread: number) => [item(0, ITEM.needle), item(1, ITEM.thread, thread), item(2, ITEM.hardLeatherNote, leather, 'Hard leather')];
        const short = { stagedGems: SHORT };
        expect(preconditions(world({ inventory: pack(954, 187) }), O)).toBe(true);
        expect(preconditions(world({ inventory: pack(954, 187) }), short)).toBe('thread short: 187 for 953 bodies (one worn every 5th, 192 at the worst-case wear)');
        expect(preconditions(world({ inventory: pack(952, 230) }), short)).toBe('supplies short: 952 hard leather for 953 bodies to 856583 xp (they reach Crafting 96)');
        expect(preconditions(world({ inventory: pack(979, 192) }), short)).toBe(true);
        // the bank in sight: its stock and the pack's together
        expect(preconditions(world({ inventory: [], bank: [[ITEM.hardLeather, 979], [ITEM.thread, 191], [ITEM.needle, 1]] }), short)).toBe('thread short: 191 for 953 bodies (one worn every 5th, 192 at the worst-case wear)');
    });

    test('with the bank open: thread on both sides of the worst-case bound, the needle, the leather', () => {
        const bank = (thread: number, needle = 1, leather = 954): Array<[number, number]> => [[ITEM.hardLeather, leather], [ITEM.thread, thread], [ITEM.needle, needle]];
        expect(preconditions(world({ inventory: [], bank: bank(187) }), O)).toBe(true);
        expect(preconditions(world({ inventory: [], bank: bank(186) }), O)).toBe('thread short: 186 for 928 bodies (one worn every 5th, 187 at the worst-case wear)');
        expect(preconditions(world({ inventory: [item(0, ITEM.thread, 100)], bank: bank(87) }), O)).toBe(true);
        expect(preconditions(world({ inventory: [], bank: bank(187, 0) }), O)).toBe('no needle held or banked');
        expect(preconditions(world({ inventory: [], bank: bank(187, 1, 927) }), O)).toMatch(/^supplies short: 927 hard leather for 928 bodies/);
        // banked and the bank closed: out of sight, the program's first visit judges them
        expect(preconditions(world({ inventory: [] }), O)).toBe(true);
    });

    test('no booth in view; a bad untilXp; the stop already reached; not in game', () => {
        expect(preconditions(world({ booth: false }), O)).toBe('no bank booth (3186,3436) in view (at 3185,3436)');
        expect(preconditions(world(), { untilXp: 0 })).toContain('untilXp 0 is not a Crafting xp');
        expect(preconditions(world(), { untilXp: CRAFTING_99_XP + 1 })).toContain('is not a Crafting xp');
        expect(preconditions(world({ xp: HANDOFF, booth: false, inventory: [item(0, 2347, 1, 'Hammer')] }), O)).toBe(true);
        expect(preconditions(baseState({ inGame: false }))).toBe('not in game');
    });

    test('the standalone stop (99) asks for the bodies to 99', () => {
        const inv = [item(0, ITEM.needle), item(1, ITEM.thread, 230), item(2, ITEM.hardLeatherNote, 954)];
        expect(preconditions(world({ inventory: inv }), { untilXp: CRAFTING_99_XP })).toMatch(/^supplies short: 954 hard leather for 1116 bodies to 998458 xp/);
    });
});

describe('steps', () => {
    test('one logout-safe step, S25d; done is the stop reached AND the cycle stowed', () => {
        const [s, ...rest] = steps(O);
        expect(rest).toEqual([]);
        expect(s!.name).toBe(STEP_NAME);
        expect(s!.logoutSafe).toBe(true);
        const obs = (xp: number, inventory: InventoryItem[] = []) => new Observation(world({ xp, inventory }));
        expect(s!.done!(obs(HANDOFF), {})).toBe(true);
        expect(s!.done!(obs(HANDOFF - 1), {})).toBe(false);
        // reached, but the last visit has not deposited the needle yet: not done, in progress
        const unstowed = [item(0, ITEM.needle), item(1, ITEM.thread, 40), item(2, ITEM.body, 1)];
        expect(s!.done!(obs(HANDOFF + 400, unstowed), {})).toBe(false);
        expect(s!.inProgress!(obs(HANDOFF + 400, unstowed), {})).toBe(true);
        // S25c's later chisel and gems do not undo it
        expect(s!.done!(obs(HANDOFF + 400, [item(0, ITEM.chisel), item(1, 1617, 27)]), {})).toBe(true);
        expect(s!.inProgress!(obs(xpForLevel(45), HANDED), {})).toBe(true);
        expect(s!.inProgress!(obs(xpForLevel(45), []), {})).toBe(false);
        expect(s!.postconditions(world({ xp: HANDOFF - 1, inventory: [] }), {})).toBe(`Crafting xp ${HANDOFF - 1} < ${HANDOFF}`);
        expect(s!.postconditions(world({ xp: HANDOFF, inventory: unstowed }), {})).toBe('the stow left Needle, obj 1131 in the inventory'.replace('Needle', 'obj 1733'));
        expect(s!.postconditions(world({ xp: HANDOFF, inventory: [] }), {})).toBe(true);
        // the standalone stop is 99
        const [solo] = steps({ untilXp: CRAFTING_99_XP });
        expect(solo!.done!(obs(HANDOFF), {})).toBe(false);
        expect(solo!.done!(obs(CRAFTING_99_XP), {})).toBe(true);
    });

    test('resume: mid-inventory resumes; 45 with nothing held starts; the stop stowed finishes; the stop unstowed resumes', async () => {
        const walk = async (xp: number, inventory: InventoryItem[]) => {
            const p = await resolveResume(steps(O), new Observation(world({ xp, inventory })), {});
            return p.mode === 'finished' ? ['finished'] : [p.step, p.mode];
        };
        const mid = [item(0, ITEM.needle), item(1, ITEM.thread, 120), ...[...Array(10).keys()].map(i => item(2 + i, ITEM.body)), ...[...Array(16).keys()].map(i => item(12 + i, ITEM.hardLeather))];
        expect(await walk(xpForLevel(70) + 875 * 3, mid)).toEqual([STEP_NAME, 'resume']);
        expect(await walk(xpForLevel(45), [])).toEqual([STEP_NAME, 'run']);
        expect(await walk(HANDOFF + 400, [])).toEqual(['finished']);
        expect(await walk(HANDOFF + 400, [item(0, ITEM.needle), item(1, ITEM.thread, 40)])).toEqual([STEP_NAME, 'resume']);
    });

    test('plannedBodies: from the state the step starts in, capped by maxActions', () => {
        expect(plannedBodies(world(), O)).toBe(928);
        expect(plannedBodies(world(), { ...O, maxActions: 26 })).toBe(26);
        expect(plannedBodies(world({ xp: HANDOFF }), O)).toBe(0);
        expect(plannedBodies(world(), { stagedGems: SHORT })).toBe(953);
    });
});

// ---------------------------------------------------------------- one scripted pass

/** The page: a program start replies with a status; the test publishes the run's end. */
class PageSdk extends FakeSdk {
    readonly starts: Array<Record<string, unknown>> = [];
    override sendAction(a: SentAction | Record<string, unknown>): Promise<ActionResult> {
        const act = a as { type?: unknown; op?: unknown; params?: Record<string, unknown> };
        if (act.type !== 'program') return super.sendAction(a as SentAction);
        if (act.op === 'start') this.starts.push(act.params ?? {});
        return Promise.resolve({ success: true, message: 'ok', data: status({}) });
    }
}

function status(p: Partial<ProgramStatus>): ProgramStatus {
    const frames = { n: 0, p50: 0, p90: 0, max: 0, under150: 0, over350: 0, catchUps: 0, catchUpsLastMinute: 0, catchUpsPerMinute: 0 };
    return { runId: 3, name: 'item-cycle', phase: 'running', params: {}, startedTick: 100, tick: 100, progressTick: 100, counters: {}, gauges: {}, marks: {}, packets: 0, deferred: 0, skippedTicks: 0, maxTickMs: 0, frames, publish: frames, react: { n: 0, p50: 0, p90: 0, max: 0 }, loops: { last: 0, p10Last10s: 0, min: 0 }, ...p };
}

/** runSteps over steps(opts) from `start`; the program "ends" at `endXp` with the inventory stowed. */
async function scripted(start: BotWorldState, opts: Parameters<typeof steps>[0], endXp: number) {
    const sdk = new PageSdk(start);
    const session = { sdk, bot: {}, name: 'lab_c1', sessionId: 1 } as unknown as RunnerSession;
    const log = TickLog.memory('t');
    const run = runSteps(session, steps(opts), { log, c: {}, shouldStop: () => false, logout: async () => {}, tickMonitor: false });
    let settled = false;
    void run.finally(() => (settled = true));
    for (let i = 0; i < 60 && !settled; i++) {
        await flush();
        if (!sdk.starts.length) {
            sdk.tick();
            continue;
        }
        const done = i > 6;
        const level = levelForXp(endXp);
        sdk.tick(s => ({
            ...(done ? { skills: [{ name: 'Crafting', level, baseLevel: level, experience: endXp }], inventory: [] } : {}),
            program: status({ tick: s.tick + 1, ...(done ? { phase: 'done', endedTick: s.tick + 1, result: { ended: 'maxActions', actions: 928, sent: 928, visits: 37, resets: 1, drift: 0, levelups: 51, byRecipe: { hardleather_body: 928 }, ticks: 240, cycleGaps: [], sendsPerTick: {}, xpDropsPerTick: {}, stowed: true } } : {}) })
        }) as Partial<BotWorldState>);
    }
    return { result: await run, starts: sdk.starts, log };
}

describe('runSteps over steps()', () => {
    test('S25d starts the program in tool mode: exact maxActions to the hand-off, untilXp, stow, the thread kept, the quick-bank op', async () => {
        const { result, starts, log } = await scripted(world(), O, xpForLevel(45) + 928 * 875);
        expect(result).toEqual({ completed: 1 });
        expect(starts).toHaveLength(1);
        expect(starts[0]).toMatchObject({ mode: 'tool', skill: 'crafting', maxActions: 928, untilXp: HANDOFF, stow: true, booth: { ...VARROCK_WEST, option: 2, stand: { x: 3185, z: 3436 } } });
        expect(starts[0]!.recipes).toEqual([{ name: 'hardleather_body', level: 28, xp: 35, a: 1743, tool: 1733, keep: [{ id: 1734, every: 5 }], products: [1131] }]);
        expect(log.rows.find(r => r.kind === 'program')).toMatchObject({ step: STEP_NAME, ok: true });
        expect((log.rows.find(r => r.kind === 'program')!.meta as { result: { stowed: boolean } }).result.stowed).toBe(true);
        expect(log.rows.find(r => !r.kind && r.step === STEP_NAME)).toMatchObject({ ok: true });
    });

    test('standalone (untilXp 99): 1,116 bodies from 45, on a standalone hand-off (rs/350 stages 1,142)', async () => {
        const solo = [item(0, ITEM.needle), item(1, ITEM.thread, 230), item(2, ITEM.hardLeatherNote, 1142)];
        const { starts } = await scripted(world({ inventory: solo }), { untilXp: CRAFTING_99_XP }, CRAFTING_99_XP);
        expect(starts[0]).toMatchObject({ maxActions: 1116, untilXp: CRAFTING_99_XP, stow: true });
    });

    test('resume mid-inventory: maxActions counts from the xp the state shows, one body short of the stop is one', async () => {
        const mid = [item(0, ITEM.needle), item(1, ITEM.thread, 30), item(2, ITEM.body), item(3, ITEM.hardLeather)];
        const { starts } = await scripted(world({ xp: HANDOFF - 875, inventory: mid }), O, HANDOFF);
        expect(starts[0]).toMatchObject({ maxActions: 1, stow: true });
    });

    test('the stop reached but the needle still held (a logout before the last visit): the program only stows', async () => {
        const { result, starts } = await scripted(world({ xp: HANDOFF + 400, inventory: [item(0, ITEM.needle), item(1, ITEM.thread, 40), item(2, ITEM.body, 1)] }), O, HANDOFF + 400);
        expect(result).toEqual({ completed: 1 });
        expect(starts[0]).toMatchObject({ maxActions: 0, stow: true });
    });
});
