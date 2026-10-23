import { describe, expect, test } from 'bun:test';

import { keepPriciest, objOf, objTable, type ObjInfo } from '../lib/death-keep';
import { parseLedger } from '../tools/slot-ledger';
import { CANNON, r8Package, R8_PHASES, respawnCheck, type R8Phase } from './r8-package';

// Rows in the inventory ledger's grammar; the items, costs and ids are the test's own.
const TABLE = `
| row | in | out | equip | needAtStart | source |
|---|---|---|---|---|---|
| S1 | - | - | - | 0 | fixture (r) |
| H1 | staff x1 [u]; law rune x4 [s]; shark x5 [u]; gem x1 [u]; cannon base x1 [u]; cannonball x50 [s] | - | +staff | 9 | fixture (r) |
| T1-2 | - | law rune x2 (consume) | - | 0 | fixture (r) |
| S2 | - | cannonball x40 (consume); shark x2 (consume) | - | 0 | fixture (r) |
| H2 | bow x1 [u] | gem x1 (swap); cannon base x1 (swap); cannonball all (swap) | - | 1 | fixture (r) |
| S3 | - | law rune x2 (consume); shark x3 (consume) | - | 0 | fixture (r) |
`;

const o = (debug: string, name: string, cost: number, id: number, extra: Partial<ObjInfo> = {}): ObjInfo => ({ debug, name, cost, destroy: false, id, ...extra });
const OBJS = objTable([
    o('staff', 'Staff', 1000, 1, { wearable: true }),
    o('law_rune', 'Law rune', 10, 2),
    o('shark', 'Shark', 300, 3),
    o('gem', 'Gem', 5000, 4),
    o('cannon_base', 'Cannon base', 9000, 5),
    o('cannonball', 'Cannonball', 5, 6),
    o('bow', 'Bow', 2000, 7),
]);

// A death carrying the kit H1 hands over, re-entering at S2 by replaying T1-2's cast.
const PHASE: R8Phase = { id: 'X', what: 'test', deaths: [{ row: 'H1' }], replay: ['T1-2'], resume: 'S2', to: 'S3', hp: 21, cannonBy: 'the cannon helper' };
const x = (p: Partial<R8Phase> = {}, keep = 3) => r8Package({ ...PHASE, ...p }, { manifest: TABLE, objs: OBJS, keep });

describe('the engine keep (death.rs2)', () => {
    const u = (name: string, cost: number, worn = false, count = 1) => ({ name, cost, worn, count });
    test('three units, priciest first, one unit of a stack', () => {
        const { kept, lost } = keepPriciest([u('arrow', 400, true, 570), u('shark', 300, false, 5), u('bow', 1600)]);
        expect(kept.map(k => k.name)).toEqual(['bow', 'arrow', 'arrow']);
        expect(lost.find(l => l.name === 'arrow')!.count).toBe(568);
    });
    test('on a tie the inventory item beats the worn one; a worn one wins only on a strictly higher cost', () => {
        expect(keepPriciest([u('worn amulet', 900, true), u('held amulet', 900)], 1).kept[0]!.name).toBe('held amulet');
        expect(keepPriciest([u('held', 900), u('worn', 901, true)], 1).kept[0]!.name).toBe('worn');
    });
    test('a cost of 0 (destroy_death, or unknown) is never kept; Protect Item keeps a fourth', () => {
        expect(keepPriciest([u('a', 0), u('b', 5)]).kept.map(k => k.name)).toEqual(['b']);
        expect(keepPriciest([u('a', 4), u('b', 3), u('c', 2), u('d', 1)], 4).kept).toHaveLength(4);
    });
    test('a name two objs share resolves only by wearability for a worn item', () => {
        const t = objTable([o('amulet_strung', 'Amulet', 550, 10, { wearable: true }), o('amulet_unstrung', 'Amulet', 500, 11)]);
        expect(objOf(t, { name: 'amulet', worn: true })?.id).toBe(10);
        expect(objOf(t, { name: 'amulet' })).toBeUndefined();
    });
});

describe('a respawn package from the ledger', () => {
    test('the held set at the resume row, less what is returned unused, plus the replay and the heal, less the kept units', () => {
        const p = x();
        // H1's death keeps the cannon base (9000), the gem (5000), then the worn staff (1000 > a held shark's 300).
        expect(p.walks[0]!.kept.map(k => k.name)).toEqual(['cannon base', 'gem', 'staff']);
        expect(p.lines.map(l => [l.item, l.need, l.kept, l.give])).toEqual([
            ['law rune', 4, 0, 4], // S3's 2, and T1-2's 2 cast again from the respawn
            ['shark', 6, 0, 6], // S2's and S3's 5, and 1 eaten from 1 HP to 21
            ['staff', 1, 1, 0], // worn through S2, and kept
        ]);
        expect(p.notNeeded).toEqual(['gem x1']); // H2 swaps it out before any step uses it
        expect(p.byId).toEqual([{ id: 2, amount: 4 }, { id: 3, amount: 6 }]);
        expect(p.topUp).toEqual([{ id: 2, topUp: { max: 4 } }, { id: 3, topUp: { max: 6 } }, { id: 1, topUp: { max: 1 } }]);
        expect(p.slots).toBe(7);
        expect(p.refusals).toEqual([]);
        expect(p.package).toEqual({ name: 'x', items: p.byId, scope: { step: 'X', family: 'mule' } });
        expect(p.topUpPackage?.scope).toEqual({ step: 'X', family: 'mule' });
    });
    test('the cannon is never in the package: the check takes it as re-supplied, less what the keep saved', () => {
        const p = x();
        expect(p.lines.some(l => (CANNON as readonly string[]).includes(l.item))).toBe(false);
        expect(p.walks[0]!.cannon).toEqual([{ item: 'cannonball', count: 50 }]);
        expect(p.walks[0]!.entries.map(e => e.row.row)).toEqual(['H94 X', 'X eat', 'T1-2', 'H the cannon helper', 'S2', 'H2', 'S3']);
    });
    test('a deployed cannon is not ranked for the keep; each death point keeps its own, the fixed form only what all keep', () => {
        const p = x({ deaths: [{ row: 'H1' }, { row: 'S2', deployed: true }] });
        expect(p.walks.find(w => w.death.row === 'S2')!.kept.map(k => k.name)).toEqual(['gem', 'staff', 'shark']);
        expect(p.kept.map(k => k.name)).toEqual(['gem', 'staff']);
        expect(p.walks).toHaveLength(4); // two forms, two death points
        expect(p.package).not.toBeNull();
    });
});

describe('the respawn check refuses', () => {
    const rows = parseLedger(TABLE).rows;
    const p = x();
    const base = { phase: PHASE, kept: p.walks[0]!.kept, cannon: [{ item: 'cannonball', kind: 's' as const, count: 50 }], heal: 1, target: { inv: [], worn: [{ name: 'staff', kind: 'u' as const, count: 1 }] }, lost: ['gem'] };
    const give = (law: number, shark: number) => [
        { item: 'law rune', kind: 's' as const, count: law },
        { item: 'shark', kind: 'u' as const, count: shark },
    ];
    test('the derived package passes every row', () => {
        expect(respawnCheck(rows, { ...base, give: give(4, 6) }).map(e => e.verdict)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass']);
    });
    test('a deliberately short package: two law runes short, S3 casts with none held', () => {
        const s3 = respawnCheck(rows, { ...base, give: give(2, 6) }).find(e => e.row.row === 'S3')!;
        expect(s3.verdict).toBe('ERROR');
        expect(s3.notes.join()).toContain('law rune out (consume) but neither held nor worn');
    });
    test('a package over the slots the kept units leave: the trade is short', () => {
        const trade = respawnCheck(rows, { ...base, give: give(4, 26) })[0]!;
        expect(trade.verdict).toBe('SHORT');
        expect(trade.notes.join()).toContain('the trade adds 27 slots, 25 free');
    });
    test('r8Package nulls both forms when the heal overflows the pack', () => {
        const big = x({ hp: 600 }); // 30 sharks to eat back
        expect(big.package).toBeNull();
        expect(big.topUpPackage).toBeNull();
        expect(big.refusals.some(r => r.startsWith('both: ') && r.includes('more than the helper'))).toBe(true);
    });
});

describe("R8's phases on STEP-MANIFEST.md", () => {
    for (const phase of R8_PHASES) {
        test(`${phase.id}: a form passes the respawn check at every death point; no cannon, every line by id`, () => {
            const p = r8Package(phase);
            expect(p.package !== null || p.topUpPackage !== null).toBe(true);
            expect(p.lines.every(l => l.id !== undefined)).toBe(true);
            expect(p.lines.some(l => (CANNON as readonly string[]).includes(l.item))).toBe(false);
            expect(p.slots).toBeLessThanOrEqual(28);
        });
    }
});
