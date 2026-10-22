import { expect, test } from 'bun:test';
import type { BankTop } from '../lib/snapshots.ts';
import { roundness, stackChanges } from './timeline.ts';

test('roundness finds the largest power of ten dividing a stack', () => {
    expect(roundness(21_000_000)).toBe(1_000_000);
    expect(roundness(1_923_311_135)).toBeNull();
    expect(roundness(5_000)).toBe(1_000);
    expect(roundness(999)).toBeNull();
});

test('stackChanges reports first, last and hourly rate per item', () => {
    const tops: BankTop[] = [
        { at: '2026-10-21T08:00:00.000Z', source: 'a', rows: [{ rank: 1, name: 'x', gp: 1, items: [{ id: 363, count: 1000 }] }] },
        { at: '2026-10-21T10:00:00.000Z', source: 'b', rows: [{ rank: 1, name: 'x', gp: 2, items: [{ id: 363, count: 3000 }, { id: 995, count: 7 }] }] }
    ];
    expect(stackChanges(tops, 'x', new Map([[363, 'Raw bass']]))).toEqual([
        { id: 363, name: 'Raw bass', first: { at: '2026-10-21T08:00:00.000Z', count: 1000 }, last: { at: '2026-10-21T10:00:00.000Z', count: 3000 }, perHour: 1000, round: 1000 },
        { id: 995, name: 'item 995', first: { at: '2026-10-21T10:00:00.000Z', count: 7 }, last: { at: '2026-10-21T10:00:00.000Z', count: 7 }, perHour: null, round: null }
    ]);
});
