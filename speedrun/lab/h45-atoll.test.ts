import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bankPlan, CHAPTER_2, packageTotals, packCensus } from './h45-atoll';

const ENTRY = JSON.parse(readFileSync(join(import.meta.dir, '..', '..', 'docs', 'speedrun', 'scripts', 'h45-carried-packages.json'), 'utf8'));
const shark = (slot: number) => ({ slot, id: 385, name: 'Shark', count: 1 });

describe('h45-atoll', () => {
    test('the package totals come from the generated entry: 24 sharks and 1 Superantipoison(4)', () => {
        expect([...packageTotals(ENTRY)]).toEqual([[385, 24], [2448, 1]]);
    });

    test('the journal mark is the G chapter heading', () => {
        expect(CHAPTER_2).toBe('Chapter 2:');
    });

    test('census passes on exactly the package plus up to 3 others', () => {
        const inv = [...Array.from({ length: 24 }, (_, i) => shark(i)), { slot: 24, id: 2448, name: 'Superantipoison(4)', count: 1 }];
        expect(packCensus(inv, packageTotals(ENTRY))).toMatchObject({ ok: true, packageSlots: 25, otherSlots: 0 });
        const plus3 = [...inv, ...[25, 26, 27].map(slot => ({ slot, id: 1, name: 'x', count: 1 }))];
        expect(packCensus(plus3, packageTotals(ENTRY)).ok).toBe(true);
    });

    test('census fails short, over, noted, or with a 4th other slot', () => {
        const totals = packageTotals(ENTRY);
        const base = [...Array.from({ length: 24 }, (_, i) => shark(i)), { slot: 24, id: 2448, name: 'Superantipoison(4)', count: 1 }];
        expect(packCensus(base.slice(1), totals).problems[0]).toContain('id 385: holds 23');
        expect(packCensus([...base, shark(25)], totals).ok).toBe(false);
        expect(packCensus([...base.slice(2), { slot: 26, id: 385, name: 'Shark', count: 2 }], totals).problems.join()).toContain('unstacked');
        expect(packCensus([...base, ...[25, 26, 27].map(slot => ({ slot, id: 1, name: 'x', count: 1 })), { slot: 28, id: 2, name: 'y', count: 1 }], totals).ok).toBe(false);
    });

    test('the bank plan deposits coins and the five Grand Tree items, keeps the package, refuses anything else', () => {
        const keep = new Set([385, 2448]);
        const inv = [
            { slot: 0, id: 995, name: 'Coins' }, shark(1), { slot: 2, id: 0, name: "Hazelmere's scroll" }, { slot: 3, id: 0, name: 'Translation book' },
            { slot: 4, id: 0, name: "Glough's journal" }, { slot: 5, id: 0, name: 'Lumber order' }, { slot: 6, id: 0, name: "Glough's key" },
        ];
        expect(bankPlan(inv, keep)).toEqual({ deposit: [0, 2, 3, 4, 5, 6], unexpected: [] });
        expect(bankPlan([...inv, { slot: 7, id: 1127, name: 'Rune platebody' }], keep).unexpected).toEqual(['Rune platebody @1127']);
    });
});
