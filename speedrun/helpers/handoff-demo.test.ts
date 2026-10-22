import { describe, expect, test } from 'bun:test';
import { handOffFrom } from '../runner/handoff';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { demoBar, giveBackSpecs } from './handoff-demo';

describe('demoBar: rs/49 demo figures, +1', () => {
    test('at the measured points', () => {
        expect(demoBar(1)).toEqual({ expected: 6.7, limit: 7.7 });
        expect(demoBar(10)).toEqual({ expected: 8, limit: 9 });
        expect(demoBar(20)).toEqual({ expected: 10, limit: 11 });
    });
    test('H1 is six stacks: between 1 and 10', () => {
        expect(demoBar(6)).toEqual({ expected: 7.42, limit: 8.42 });
    });
    test('flat outside the measured range', () => {
        expect(demoBar(0).expected).toBe(6.7);
        expect(demoBar(25).expected).toBe(10);
    });
});

describe('the H1 demo stand-in row', () => {
    const plan = handOffFrom(readFileSync(join(import.meta.dir, '..', 'lab', 'fixtures', 'handoff-h1-demo.md'), 'utf8'), 'H1');
    test("H1's shape: six entries received, one unstackable, nothing given or worn", () => {
        expect(plan.receive.length).toBe(6);
        expect(plan.receive.filter(r => r.kind === 'u').length).toBe(1);
        expect(plan.give).toEqual([]);
        expect(plan.wield).toEqual([]);
    });
    test('every count is above the starter kit, so done cannot hold before the trade', () => {
        const starter: Record<string, number> = { 'air rune': 25, 'mind rune': 15, 'water rune': 6, 'earth rune': 4, 'body rune': 2 };
        for (const r of plan.receive) expect(r.count).toBeGreaterThan(starter[r.name] ?? 0);
    });
    test('the give-back offers each entry at its count, by an exact-name pattern', () => {
        const specs = giveBackSpecs(plan);
        expect(specs.map(s => s.n)).toEqual(plan.receive.map(r => r.count));
        const air = specs[plan.receive.findIndex(r => r.name === 'air rune')]!;
        expect(air.item.test('Air rune')).toBe(true);
        expect(air.item.test('Air talisman')).toBe(false);
    });
});
