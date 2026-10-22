import { describe, expect, test } from 'bun:test';
import { Gatherer, parseCounts, TASKS, withCounts } from './questitems';

/** makes() for the drop tasks reads only the spare rule. */
const gatherer = (spare: boolean) => ({ n: (base: number, extra = 1) => (spare ? base + extra : base) }) as unknown as Gatherer;

describe('questitems counts option', () => {
    test('absent counts leave every task untouched', () => {
        const counts = parseCounts(undefined);
        expect(counts.size).toBe(0);
        expect(withCounts(TASKS.snapegrass!, counts)).toBe(TASKS.snapegrass!);
    });

    test('a count replaces the held target for its item, by name in any case', () => {
        const t = withCounts(TASKS.snapegrass!, parseCounts({ 'snape GRASS': 102 }));
        expect(t.makes(gatherer(true))).toEqual([{ item: 'Snape grass', count: 102 }]);
        expect(t.makes(gatherer(false))).toEqual([{ item: 'Snape grass', count: 102 }]);
        expect(t.id).toBe('snapegrass');
        expect(t.run).toBe(TASKS.snapegrass!.run);
    });

    test('items the count does not name keep the task target', () => {
        const t = withCounts(TASKS.bearmeat!, parseCounts({ 'Snape grass': 102 }));
        expect(t.makes(gatherer(true))).toEqual([{ item: 'Raw bear meat', count: 2 }]);
    });

    test('malformed counts are refused at the boundary', () => {
        expect(() => parseCounts([])).toThrow(/must be an object/);
        expect(() => parseCounts('Snape grass')).toThrow(/must be an object/);
        expect(() => parseCounts(null)).toThrow(/must be an object/);
        expect(() => parseCounts({ 'Snape grass': -1 })).toThrow(/non-negative integer/);
        expect(() => parseCounts({ 'Snape grass': 1.5 })).toThrow(/non-negative integer/);
        expect(() => parseCounts({ 'Snape grass': '100' })).toThrow(/non-negative integer/);
    });

    test("a running task reads its targets from the loop's current task, counts applied", () => {
        // The task's own done check must use the counted target, or a bulk run stops at the default.
        const g = Object.assign(Object.create(Gatherer.prototype) as Gatherer, { spare: true });
        expect(() => g.target('Snape grass')).toThrow(/no task is running/);
        g.current = TASKS.snapegrass!;
        expect(g.target('Snape grass')).toBe(2);
        g.current = withCounts(TASKS.snapegrass!, parseCounts({ 'Snape grass': 102 }));
        expect(g.target('Snape grass')).toBe(102);
        expect(g.wants()).toEqual([{ item: 'Snape grass', count: 102 }]);
        expect(g.target('Raw bear meat')).toBe(0);
    });
});
