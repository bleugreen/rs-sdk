import { describe, expect, test } from 'bun:test';

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { contentObjs, keepCost, keepPriciest, objOf, objTable, type ObjInfo } from '../lib/death-keep';
import { parseObjPack } from '../lib/obj-pack';
import { untradeable } from '../lib/items';
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
// The fixture's ids are its own, not obj.pack's, so the trade flag is the fixture's too: all tradeable.
const tradeable = () => false;
const x = (p: Partial<R8Phase> = {}, keep = 3) => r8Package({ ...PHASE, ...p }, { manifest: TABLE, objs: OBJS, keep, untradeable: tradeable });

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
    test("the content reader prices as the engine does: no cost= is 1 (ObjType.ts), cost=0 stays 0, destroy_death and unknown never kept", () => {
        const dir = mkdtempSync(join(tmpdir(), 'death-keep-'));
        mkdirSync(join(dir, 'q'));
        writeFileSync(join(dir, 'q', 'test.obj'), ['[omitted]', 'name=Omitted', '', '[free]', 'name=Free', 'cost=0', '', '[doomed]', 'name=Doomed', 'cost=50', 'param=destroy_death,^true', '', '[cert_omitted]', 'certtemplate=template_for_cert', ''].join('\n'));
        const t = contentObjs(dir, parseObjPack('1=omitted\n2=free\n3=doomed\n4=cert_omitted\n'));
        expect(t.byId.get(1)!.cost).toBe(1);
        expect(t.byId.get(2)!.cost).toBe(0);
        expect(t.byId.has(4)).toBe(false); // a note is priced as its item
        expect(keepCost(t.byId.get(1))).toBe(1);
        expect(keepCost(t.byId.get(3))).toBe(0);
        expect(keepCost(undefined)).toBe(0);
        // A cost-1 obj is kept over nothing, never over a pricier one; a destroy_death one never.
        const u = (name: string, cost: number) => ({ name, cost, worn: false, count: 1 });
        expect(keepPriciest([u('doomed', keepCost(t.byId.get(3))), u('omitted', keepCost(t.byId.get(1)))]).kept.map(k => k.name)).toEqual(['omitted']);
    });
    test('the live content: Monkey bones (3183, no cost= line) read cost 1', () => {
        expect(contentObjs().byId.get(3183)!.cost).toBe(1);
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
    test('the fixed form drops, at the respawn, what a death keeps beyond the need; the top-up form gives less instead', () => {
        const p = x({ deaths: [{ row: 'H1' }, { row: 'S2', deployed: true }] });
        const fixed = p.walks.find(w => w.form === 'fixed' && w.death.row === 'S2')!;
        // S2's keep holds a shark the fixed package (6) also brings: it goes before the trade.
        expect(fixed.entries[0]!.row.row).toBe('X drop');
        expect(fixed.entries[0]!.row.out).toEqual([{ name: 'shark', count: 1, reason: 'drop' }]);
        const topUp = p.walks.find(w => w.form === 'topUp' && w.death.row === 'S2')!;
        expect(topUp.entries[0]!.row.row).toBe('H94 X');
        expect(topUp.entries[0]!.row.in.find(e => e.name === 'shark')!.count).toBe(5);
    });
    test('an untradeable need is in neither form; a row that uses it then refuses the package', () => {
        const p = r8Package(PHASE, { manifest: TABLE, objs: OBJS, untradeable: id => id === 3 });
        expect(p.byId.some(l => l.id === 3)).toBe(false);
        expect(p.topUp.some(l => l.id === 3)).toBe(false);
        expect(p.unrecoverable).toEqual([{ item: 'shark', id: 3, death: 'H1', deployed: false, count: 6, needs: 'consume at S2; 1 eaten from 1 HP to 21', cost: 300, keptMin: 1000 }]);
        expect(p.recoverable).toBe(false);
        expect(p.package).toBeNull();
        expect(p.refusals.some(r => r.includes('shark out (consume) but neither held nor worn'))).toBe(true);
    });
});

describe('an untradeable need with no stand-in fails closed', () => {
    const objs = objTable([o('staff', 'Staff', 1000, 1, { wearable: true })]);
    const phase: R8Phase = { id: 'W', what: 'test', deaths: [{ row: 'H1' }], replay: [], resume: 'S2', to: 'S3', hp: 1, cannonBy: 'none' };
    const run = (table: string) => r8Package(phase, { manifest: table, objs, keep: 0, untradeable: id => id === 1 });
    test('worn through a step only: no row consumes or wields it, yet both forms are refused (rs/41 repro)', () => {
        const p = run(`
| row | in | out | equip | needAtStart | source |
|---|---|---|---|---|---|
| S1 | - | - | - | 0 | fixture (r) |
| H1 | staff x1 [u] | - | +staff | 1 | fixture (r) |
| S2 | - | - | - | 0 | fixture (r) |
| S3 | - | - | - | 0 | fixture (r) |
`);
        expect(p.unrecoverable.map(u => [u.item, u.death, u.needs])).toEqual([['staff', 'H1', 'worn through S2']]);
        expect(p.recoverable).toBe(false);
        expect(p.package).toBeNull();
        expect(p.topUpPackage).toBeNull();
        expect(p.refusals).toContain('both: W: unrecoverable by trade at the death at H1: staff x1 (worn through S2)');
    });
    test('wielded by a later row: the walk errors on the wield rather than dropping it', () => {
        const p = run(`
| row | in | out | equip | needAtStart | source |
|---|---|---|---|---|---|
| S1 | - | - | - | 0 | fixture (r) |
| H1 | staff x1 [u] | - | - | 1 | fixture (r) |
| S2 | - | - | +staff | 0 | fixture (r) |
| S3 | - | - | - | 0 | fixture (r) |
`);
        expect(p.package).toBeNull();
        expect(p.topUpPackage).toBeNull();
        for (const form of ['fixed', 'topUp'] as const) {
            const s2 = p.walks.find(w => w.form === form)!.entries.find(e => e.row.row === 'S2')!;
            expect(s2.verdict).toBe('ERROR');
            expect(s2.notes.join()).toContain('+staff: not held');
        }
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

// A tool only held for a leg: the knife T26-27's keep web needs (runner/legs.ts, `hopNeeds`). The row
// is named T26-27 so the check reads the runner's own leg (its teleport runes, the webs, food 2).
const HELD = `
| row | in | out | equip | needAtStart | source |
|---|---|---|---|---|---|
| S1 | - | - | - | 0 | fixture (r) |
| H1 | law rune x4 [s]; water rune x4 [s]; shark x4 [u]; knife x1 [u] | - | - | 4 | fixture (r) |
| T26-27 | - | law rune x2 (consume); water rune x2 (consume) | - | 0 | fixture (r) |
| S2 | - | shark x2 (consume) | - | 0 | fixture (r) |
| S3 | - | - | - | 0 | fixture (r) |
`;
const KNIFE = 8;
const HELD_OBJS = objTable([o('law_rune', 'Law rune', 10, 2), o('shark', 'Shark', 300, 3), o('knife', 'Knife', 6, KNIFE), o('water_rune', 'Water rune', 4, 9)]);
const KEEP: R8Phase = { id: 'K', what: 'test', deaths: [{ row: 'H1' }], replay: ['T26-27'], resume: 'S2', to: 'S3', hp: 1, cannonBy: 'none' };
const held = (p: Partial<R8Phase> = {}, untradeableId?: number) => r8Package({ ...KEEP, ...p }, { manifest: HELD, objs: HELD_OBJS, keep: 0, untradeable: id => id === untradeableId });

describe('a tool a leg only holds (the knife for the webs)', () => {
    test('needed where the recovery replays the leg: in both forms, not under notNeeded', () => {
        const p = held();
        expect(p.lines.find(l => l.item === 'knife')).toMatchObject({ id: KNIFE, need: 1, give: 1 });
        expect(p.lines.find(l => l.item === 'knife')!.why).toContain("held for T26-27's hops");
        expect(p.byId).toContainEqual({ id: KNIFE, amount: 1 });
        expect(p.topUp).toContainEqual({ id: KNIFE, topUp: { max: 1 } });
        expect(p.notNeeded).not.toContain('knife x1');
        expect(p.refusals).toEqual([]);
    });
    test('needed where the walk runs the leg from the ledger after the resume', () => {
        const p = held({ replay: [], resume: 'T26-27' });
        expect(p.byId).toContainEqual({ id: KNIFE, amount: 1 });
        expect(p.refusals).toEqual([]);
    });
    test('not needed where no leg the phase runs holds it: left out, under notNeeded', () => {
        const p = held({ deaths: [{ row: 'S2' }], replay: [], resume: 'S3', to: 'S3' });
        expect(p.lines.some(l => l.item === 'knife')).toBe(false);
        expect(p.notNeeded).toContain('knife x1');
        expect(p.package).not.toBeNull();
    });
    test("the leg's food comes on top of the heal eaten before it", () => {
        // Resuming at S3 after a replayed T26-27: no later row eats the 2 sharks held, so the 3 eaten
        // from 1 HP to 61 are all the package would bring, and T26-27 wants 2 held after them.
        const p = held({ deaths: [{ row: 'S2' }], resume: 'S3', to: 'S3', hp: 61 });
        expect(p.lines.find(l => l.item === 'shark')).toMatchObject({ need: 5, why: '3 eaten from 1 HP to 61; 2 food held for T26-27 (replayed)' });
        expect(p.byId).toContainEqual({ id: KNIFE, amount: 1 });
        expect(p.refusals).toEqual([]);
    });
});

describe('a kit missing what a leg holds fails closed', () => {
    const rows = parseLedger(HELD).rows;
    const base = { phase: KEEP, kept: [], cannon: [], heal: 0, target: { inv: [], worn: [] }, lost: [] };
    const give = (knife: number, shark: number) => [
        { item: 'law rune', kind: 's' as const, count: 2 },
        { item: 'water rune', kind: 's' as const, count: 2 },
        { item: 'shark', kind: 'u' as const, count: shark },
        ...(knife ? [{ item: 'knife', kind: 'u' as const, count: knife }] : []),
    ];
    test('with the knife and the food every row passes', () => {
        expect(respawnCheck(rows, { ...base, give: give(1, 4) }).map(e => e.verdict)).toEqual(['pass', 'pass', 'pass', 'pass']);
    });
    test('without the knife the runner refuses the replayed leg: the walk errors at T26-27', () => {
        const t = respawnCheck(rows, { ...base, give: give(0, 4) }).find(e => e.row.row === 'T26-27')!;
        expect(t.verdict).toBe('ERROR');
        expect(t.notes.join()).toContain('the runner refuses the leg: T26-27: a knife is needed for the webs');
    });
    test('with too little food the runner refuses it too', () => {
        const t = respawnCheck(rows, { ...base, give: give(1, 1) }).find(e => e.row.row === 'T26-27')!;
        expect(t.verdict).toBe('ERROR');
        expect(t.notes.join()).toContain('1 food held, 2 needed');
    });
    test('a knife no trade can restore: unrecoverable, both forms refused, never stageable', () => {
        const p = held({}, KNIFE);
        expect(p.unrecoverable.map(u => [u.item, u.death, u.count])).toEqual([['knife', 'H1', 1]]);
        expect(p.package).toBeNull();
        expect(p.topUpPackage).toBeNull();
        expect(p.refusals.some(r => r.includes('a knife is needed for the webs'))).toBe(true);
    });
});

/**
 * Phases with no stageable form on the current ledger, and why: a known supply gap (rs/579, reported
 * to rs/41), asserted rather than skipped so a ruling that fits the kit has to replace it.
 */
const UNFITTED: Readonly<Record<string, string>> = {
    R8d1: 'with the knife the kit is 26 slots against the 25 the kept cannon parts leave at H23 and in S27 packed',
};

describe("R8's phases on STEP-MANIFEST.md", () => {
    const phase = (id: string) => R8_PHASES.find(ph => ph.id === id)!;
    test('Knife (946) goes where the replayed leg crosses a web (T13-14, T15-16, T26-27), and nowhere else', () => {
        for (const id of ['R8a', 'R8c', 'R8d1', 'R8d2']) {
            const p = r8Package(phase(id));
            expect(p.byId).toContainEqual({ id: 946, amount: 1 });
            expect(p.notNeeded).not.toContain('knife x1');
        }
        const b = r8Package(phase('R8b'));
        expect(b.byId.some(l => l.id === 946)).toBe(false);
        expect(b.notNeeded).toContain('knife x1');
    });
    test("R8c: T15-16's 2 food on top of the 3 sharks the heal eats", () => {
        expect(r8Package(phase('R8c')).byId).toContainEqual({ id: 385, amount: 5 });
    });
    test(`R8d1 has no stageable form: ${UNFITTED.R8d1}`, () => {
        const p = r8Package(phase('R8d1'));
        expect(p.slots).toBe(26);
        expect(p.package).toBeNull();
        expect(p.topUpPackage).toBeNull();
        expect(p.unrecoverable).toEqual([]);
        const short = p.walks.filter(w => !w.death.deployed);
        expect(short).toHaveLength(4);
        for (const w of short) expect(w.entries.find(e => e.row.row === 'H94 R8d1')!.verdict).toBe('SHORT');
        for (const w of p.walks.filter(w => w.death.deployed)) expect(w.entries.every(e => e.verdict === 'pass')).toBe(true);
    });
    for (const phase of R8_PHASES) {
        test(`${phase.id}: a form passes the respawn check at every death point; no cannon, every line by id`, () => {
            const p = r8Package(phase);
            expect(p.package !== null || p.topUpPackage !== null).toBe(!UNFITTED[phase.id]);
            expect(p.lines.every(l => l.id !== undefined)).toBe(true);
            expect(p.lines.some(l => (CANNON as readonly string[]).includes(l.item))).toBe(false);
            expect(p.slots).toBeLessThanOrEqual(28);
        });
        test(`${phase.id}: no untradeable id in either form`, () => {
            const p = r8Package(phase);
            for (const l of [...p.byId, ...p.topUp]) expect(untradeable(l.id!)).toBe(false);
        });
    }
    test('the quest kit reads untradeable (quest_arena.obj, quest_mm.obj)', () => {
        for (const id of [74, 75, 4021]) expect(untradeable(id)).toBe(true);
        expect(untradeable(385)).toBe(false);
    });
    test("R8c: every death point keeps the m'speak amulet, so its line is 'kept at H13, S16, nothing needed'", () => {
        const p = r8Package(R8_PHASES.find(ph => ph.id === 'R8c')!);
        for (const w of p.walks) expect(w.kept.some(k => k.name === "m'speak amulet")).toBe(true);
        expect(p.lines.find(l => l.item === "m'speak amulet")!.why).toStartWith('kept at H13, S16, nothing needed');
        expect(p.recoverable).toBe(true);
    });
    test('R8a and R8b: the Khazard helmet and armour, kept at no death point, come back as the iron med helm and platebody, worn', () => {
        for (const id of ['R8a', 'R8b']) {
            const p = r8Package(R8_PHASES.find(ph => ph.id === id)!);
            for (const w of p.walks) expect(w.kept.some(k => /^khazard/.test(k.name))).toBe(false);
            const subs = p.lines.filter(l => l.substituteFor);
            expect(subs.map(l => l.why.split(' (')[0])).toEqual(['iron med helm for khazard helmet', 'iron platebody for khazard armour']);
            for (const s of subs) {
                expect(untradeable(s.id!)).toBe(false);
                expect(p.byId).toContainEqual({ id: s.id!, amount: 1 });
                for (const w of p.walks) expect(w.entries.find(e => e.row.row === `H94 ${id}`)!.worn).toContain(s.item);
            }
            expect(p.unrecoverable).toEqual([]);
            expect(p.recoverable).toBe(true);
        }
    });
});
