import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Segment } from '../skills/smithing';
import { handoverOptions } from './handover';
import { ADAMANT_MELEE, BAR_OBJ, barsOf, batches, COINS_OBJ, HAMMER_OBJ, PIECES, setHandovers, shortPieces, smithGiveOptions, smithPlan } from './smith-give';

const CONTENT = join(import.meta.dir, '../../server/content');
const SMITHING = join(CONTENT, 'scripts/skill_smithing/configs/smithing');
const H51 = 'cairn_h51';
const H52 = 'cairn_h52';
const two = smithGiveOptions({ receivers: [H51, H52] });
const BAR = BAR_OBJ.adamantite_bar!;

const held = (entries: Record<number, number>) => new Map(Object.entries(entries).map(([k, v]) => [Number(k), v]));
const made = (segs: readonly Segment[]) => segs.map(s => `${s.product.id} x${s.count}`);

describe('content', () => {
    test('PIECES match smithing.dbrow (level, bars), smithing.inv (column, slot) and obj.pack (obj id)', () => {
        const objs = new Map(readFileSync(join(CONTENT, 'pack/obj.pack'), 'utf8').split('\n').map(l => l.split('=') as [string, string]).map(([id, name]) => [name, Number(id)]));
        const dbrow = readFileSync(join(SMITHING, 'smithing.dbrow'), 'utf8');
        const inv = readFileSync(join(SMITHING, 'smithing.inv'), 'utf8');
        for (const p of Object.values(PIECES)) {
            const row = dbrow.split(`[${p.id}]\n`)[1]!.split('\n\n')[0]!;
            expect(row).toContain(`data=levelrequired,${p.level}\n`);
            expect(row).toContain(`data=bar,${p.bar}\n`);
            expect(row).toContain(`data=bar_amount,${p.bars}`);
            const col = inv.split(`[smithing_adamant${p.com - 1119 + 1}]\n`)[1]!.split('\n[')[0]!;
            expect(col).toContain(`stock${p.slot + 1}=${p.id},1`);
            expect(objs.get(p.id)).toBe(p.obj);
        }
        expect(objs.get('adamantite_bar')).toBe(BAR);
        expect(objs.get('hammer')).toBe(HAMMER_OBJ);
        expect(objs.get('coins')).toBe(COINS_OBJ);
    });
});

describe('options', () => {
    test('defaults: the adamant melee set, a stable id from receivers and pieces, trades at the bank', () => {
        expect(two.pieces.map(p => p.id)).toEqual([...ADAMANT_MELEE]);
        expect(two.id).toMatch(/^smith-give-[0-9a-f]{12}$/);
        expect(smithGiveOptions({ receivers: [H51, H52] }).id).toBe(two.id);
        expect(smithGiveOptions({ receivers: [H52, H51] }).id).not.toBe(two.id);
        expect(two.meet).toBeUndefined();
        expect(smithGiveOptions({ receivers: [H51], id: 'gear-1', meet: { x: 3185, z: 3436 } })).toMatchObject({ id: 'gear-1', meet: { x: 3185, z: 3436 } });
    });

    test('refuses bad receivers, unknown or repeated pieces, a bad meet or id', () => {
        expect(() => smithGiveOptions({})).toThrow(/receivers/);
        expect(() => smithGiveOptions({ receivers: [] })).toThrow(/receivers/);
        expect(() => smithGiveOptions({ receivers: ['SCORED'] })).toThrow(/not a cairn_ helper/);
        expect(() => smithGiveOptions({ receivers: [H51, H51] })).toThrow(/twice/);
        expect(() => smithGiveOptions({ receivers: [H51], pieces: ['rune_platebody'] })).toThrow(/unknown piece/);
        expect(() => smithGiveOptions({ receivers: [H51], pieces: ['adamant_scimitar', 'adamant_scimitar'] })).toThrow(/twice/);
        expect(() => smithGiveOptions({ receivers: [H51], meet: { x: 1 } })).toThrow(/meet/);
        expect(() => smithGiveOptions({ receivers: [H51], id: 'has space' })).toThrow(/id/);
    });
});

describe('the plan', () => {
    test('two sets from nothing: 2 of each piece, 24 adamantite bars, in one trip', () => {
        const r = smithPlan(two, held({ [BAR]: 422, [HAMMER_OBJ]: 1 }), 95);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(made(r.plan.make)).toEqual(['adamant_scimitar x2', 'adamant_full_helm x2', 'adamant_platebody x2', 'adamant_platelegs x2']);
        expect(r.plan.bars).toEqual({ adamantite_bar: 24 });
        expect(r.plan.buyHammer).toBe(false);
        expect(batches(r.plan.make)).toHaveLength(1);
        expect(barsOf(batches(r.plan.make)[0]!)).toEqual({ adamantite_bar: 24 });
    });

    test('exactly 24 bars and Smithing 88 is enough', () => {
        expect(smithPlan(two, held({ [BAR]: 24, [HAMMER_OBJ]: 1 }), 88).ok).toBe(true);
    });

    test('pieces already held count towards the sets; nothing left to make needs no bars, level or hammer', () => {
        const r = smithPlan(two, held({ [BAR]: 15, [PIECES.adamant_platebody!.obj]: 1, [PIECES.adamant_scimitar!.obj]: 2, [COINS_OBJ]: 5 }), 95);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(made(r.plan.make)).toEqual(['adamant_full_helm x2', 'adamant_platebody x1', 'adamant_platelegs x2']);
        expect(r.plan.bars).toEqual({ adamantite_bar: 15 });
        expect(r.plan.buyHammer).toBe(true);
        const all = held(Object.fromEntries(Object.values(PIECES).map(p => [p.obj, 2])));
        expect(smithPlan(two, all, 1)).toEqual({ ok: true, plan: { make: [], bars: {}, buyHammer: false } });
    });

    test('refuses a level below the highest piece still to make, short bars, and no hammer without coins', () => {
        expect(smithPlan(two, held({ [BAR]: 24, [HAMMER_OBJ]: 1 }), 87)).toEqual({ ok: false, reason: 'Smithing 87: Adamant platebody needs 88' });
        expect(smithPlan(two, held({ [BAR]: 23, [HAMMER_OBJ]: 1 }), 95)).toEqual({ ok: false, reason: 'Adamantite bar 23/24' });
        expect(smithPlan(two, held({ [BAR]: 24 }), 95)).toEqual({ ok: false, reason: 'no hammer, and no coins to buy one' });
        expect(smithPlan(two, held({}), 80)).toEqual({
            ok: false,
            reason: 'Smithing 80: Adamant platebody needs 88; Smithing 80: Adamant platelegs needs 86; Adamantite bar 0/24; no hammer, and no coins to buy one'
        });
        // The platebodies are held, so 86 (the platelegs) is the bar.
        expect(smithPlan(two, held({ [BAR]: 14, [HAMMER_OBJ]: 1, [PIECES.adamant_platebody!.obj]: 2 }), 86).ok).toBe(true);
    });

    test('trips are capped at 27 bars and keep the piece order', () => {
        const three = smithGiveOptions({ receivers: [H51, H52, 'cairn_h53'] });
        const r = smithPlan(three, held({ [BAR]: 36, [HAMMER_OBJ]: 1 }), 95);
        if (!r.ok) throw new Error(r.reason);
        const trips = batches(r.plan.make);
        expect(trips.map(made)).toEqual([
            ['adamant_scimitar x3', 'adamant_full_helm x3', 'adamant_platebody x3'],
            ['adamant_platelegs x3']
        ]);
        expect(trips.map(barsOf)).toEqual([{ adamantite_bar: 27 }, { adamantite_bar: 9 }]);
    });
});

describe('the trades', () => {
    test('one of every piece to each receiver, by obj id, unnoted, in receiver order', () => {
        const set = [{ id: 1331, n: 1 }, { id: 1161, n: 1 }, { id: 1123, n: 1 }, { id: 1073, n: 1 }];
        expect(setHandovers(two)).toEqual([
            { to: H51, items: set },
            { to: H52, items: set }
        ]);
        // handover.ts accepts the list as its own options would give it, and withdraws each line unnoted.
        const o = handoverOptions({ id: two.id, handovers: setHandovers(two) });
        expect(o.handovers).toEqual(setHandovers(two));
        expect(o.handovers.flatMap(h => h.items).every(it => it.n === 1 && it.noted === undefined)).toBe(true);
    });

    test('the bank check after smithing names every piece short of the receivers', () => {
        const full = held(Object.fromEntries(Object.values(PIECES).map(p => [p.obj, 2])));
        expect(shortPieces(two, full)).toEqual([]);
        full.set(PIECES.adamant_platelegs!.obj, 1);
        expect(shortPieces(two, full)).toEqual(['Adamant platelegs 1/2']);
    });
});
