import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { baseName, censusVsWalk, main, place, readCensus, type Allowance } from './census-vs-walk';
import { parseLedger } from './slot-ledger';

const HEAD = '| row | in | out | equip | needAtStart | source |\n|---|---|---|---|---|---|\n';
// H1 traded inside S01 (as PLACEMENT's `as`), a sub-row inside S02, H9 placed inside leg T02-03.
const LEDGER = HEAD + [
    '| S00 | knife x1 [u]; air rune x10 [s]; tinderbox x1 [u] | - | - | 0 | the kit (m) |',
    '| H1 | staff of water x1 [u]; law rune x2 [s]; prayer potion(4) x1 [u] | - | - | 3 | (m) |',
    '| S01 | - | - | +staff of water | 0 | (m) |',
    '| T01-02 | - | tinderbox x1 (drop); law rune x1 (consume) | - | 0 | (m) |',
    '| S02 entry | - | air rune x5 (consume) | - | 0 | a sub-row (m) |',
    '| S02 | quest key x1 [u] | - | - | 0 | (m) |',
    '| T02-03 | - | quest key x1 (drop) | - | 0 | (m) |',
    '| H9 | shark x2 [u] | - | - | 2 | (m) |',
    '| S03 | - | - | - | 0 | (m) |',
].join('\n') + '\n';
const rows = parseLedger(LEDGER).rows;
const opts = {
    tradedIn: (r: string) => (r === 'H1' ? 'S01' : undefined),
    placedInLeg: (r: string) => (r === 'H9' ? 'T02-03' : undefined),
    wornInPack: [{ item: 'staff of water', from: 'S01', to: 'T01-02', cite: 'the test allowance' }] as Allowance[],
};

type Item = [name: string, count: number, id?: number];
const census = (before: string, id: string, tick: number, inv: Item[], worn: string[] = []) =>
    JSON.stringify({ v: 1, kind: 'note', step: '(census)', startTick: tick, at: '', meta: { before, id, inventory: inv.map(([name, count, oid]) => ({ name, count, ...(oid ? { id: oid } : {}) })), worn } });
const KIT: Item[] = [['Knife', 1], ['Air rune', 10]];
const LOG = [
    JSON.stringify({ v: 1, kind: 'gate', step: '(gate) dress rehearsal', startTick: -1, meta: { staffed: [] } }),
    census('S00 start', 'S00', 0, []),
    census('H1 hand-off', 'S01', 5, [...KIT, ['Tinderbox', 1]]),
    // The staff still in the pack (the allowance), a part-drunk potion (rule B).
    census('T01-02 run', 'T01-02', 10, [...KIT, ['Tinderbox', 1], ['Staff of water', 1], ['Law rune', 2], ['Prayer potion(2)', 1]]),
    // S02's boundary is before its sub-row: air 10, not 5. An empty vial is never allowed.
    census('S02:A-start', 'S02', 20, [...KIT, ['Law rune', 1], ['Prayer potion(2)', 1], ['Vial', 1]], ['Staff of water']),
    // Mid-step: the quest's own item, and the vial again, are the step's business (rule C).
    census('S02:B-key', 'S02', 30, [...KIT, ['Law rune', 1], ['Quest key', 1], ['Picture', 1], ['Vial', 1]], ['Staff of water']),
    census('S02:B-key', 'S02', 31, [...KIT, ['Law rune', 1], ['Quest key', 1], ['Picture', 1], ['Vial', 1]], ['Staff of water']),
    // The vial outlives S02 (FAIL); air 7 against the walk's 5 compares by name (rule A); the potion is drunk (info).
    census('T02-03a run', 'T02-03a', 40, [['Knife', 1], ['Air rune', 7], ['Law rune', 1], ['Quest key', 1], ['Vial', 1]], ['Staff of water']),
    census('H9 hand-off', 'H9', 50, [['Knife', 1], ['Air rune', 7], ['Law rune', 1], ['Vial', 1]], ['Staff of water']),
    // After H9: three sharks against two (rule A), the band's shafts (FAIL), a second knife (surplus).
    census('T02-03b run', 'T02-03b', 60, [['Knife', 1], ['Knife', 1], ['Air rune', 7], ['Law rune', 1], ['Vial', 1], ['Shark', 1], ['Shark', 1], ['Shark', 1], ['Arrow shaft', 30]], ['Staff of water']),
].join('\n');

describe('place: where a census sits on the walk', () => {
    const { census: c } = readCensus(LOG, 'run.jsonl');
    const { placed } = place(c, rows, opts);
    const at = (i: number) => ({ at: rows[placed[i]!.at]?.row ?? '(end)', phase: placed[i]!.phase });

    test('every census row is read, in log order', () => {
        expect(c.map(x => x.before)).toEqual(['S00 start', 'H1 hand-off', 'T01-02 run', 'S02:A-start', 'S02:B-key', 'S02:B-key', 'T02-03a run', 'H9 hand-off', 'T02-03b run']);
        expect(c[3]!.worn).toEqual(['Staff of water']);
    });

    test('a step starts before the hand-offs its module trades and its sub-rows', () => {
        expect(at(1)).toEqual({ at: 'H1', phase: 'boundary' });
        expect(at(3)).toEqual({ at: 'S02 entry', phase: 'boundary' });
    });

    test('later censuses of a step, and a retry of the same step, are mid-step', () => {
        expect(at(4).phase).toBe('mid');
        expect(at(5).phase).toBe('mid');
    });

    test("a split leg's part b sits after the hand-offs placed inside the leg", () => {
        expect(at(6)).toEqual({ at: 'T02-03', phase: 'boundary' });
        expect(at(7)).toEqual({ at: 'H9', phase: 'boundary' });
        expect(at(8)).toEqual({ at: 'S03', phase: 'boundary' });
    });

    test('a staff-supplied row is not in the span: its supply comes before the step census', () => {
        const { placed: p } = place(c, rows, { ...opts, staffed: new Set(['H1']) });
        expect(rows[p[1]!.at]!.row).toBe('S01');
    });
});

describe('censusVsWalk: the allow-list', () => {
    const r = censusVsWalk([{ name: 'run.jsonl', text: LOG }], rows, opts);
    const of = (item: string) => r.findings.filter(g => g.item === item).map(g => ({ verdict: g.verdict, kind: g.kind, rule: g.rule, first: g.first.before, rows: g.rows }));

    test('the defect class: live past a boundary, not in the walk', () => {
        // One unbroken run: its FAIL rows (S02's boundary and the leg's three) and its mid-step rows.
        expect(of('Vial')).toEqual([
            { verdict: 'FAIL', kind: 'not in walk', rule: undefined, first: 'S02:A-start', rows: 4 },
            { verdict: 'allowed', kind: 'not in walk', rule: 'C', first: 'S02:B-key', rows: 2 },
        ]);
        expect(of('Arrow shaft')).toEqual([{ verdict: 'FAIL', kind: 'not in walk', rule: undefined, first: 'T02-03b run', rows: 1 }]);
    });

    test('a pack item the walk has worn is allowed only inside its allowance (rule D)', () => {
        expect(of('Staff of water')).toEqual([{ verdict: 'allowed', kind: 'worn in walk', rule: 'D', first: 'T01-02 run', rows: 1 }]);
        const strictD = censusVsWalk([{ name: 'run.jsonl', text: LOG }], rows, { ...opts, wornInPack: [] });
        expect(strictD.findings.find(g => g.item === 'Staff of water')?.verdict).toBe('FAIL');
    });

    test('loose stacks compare by name and place; doses are stripped; quest items mid-step are allowed', () => {
        expect(of('Air rune')).toEqual([]);
        expect(of('Shark')).toEqual([]);
        expect(of('Prayer potion(2)')).toEqual([]);
        // In S02's own `in`: matched mid-step. Not in the ledger at all: the step's business (rule C).
        expect(of('Quest key')).toEqual([]);
        expect(of('Picture')).toEqual([{ verdict: 'allowed', kind: 'not in walk', rule: 'C', first: 'S02:B-key', rows: 2 }]);
        expect(baseName('Superantipoison(4)')).toBe('superantipoison');
    });

    test('more of an unstackable than the walk holds is a slot it does not count', () => {
        const knife = r.findings.find(g => g.item === 'Knife')!;
        expect({ verdict: knife.verdict, kind: knife.kind, live: [...knife.live], walk: [...knife.walk] }).toEqual({ verdict: 'FAIL', kind: 'surplus', live: [2], walk: [1] });
    });

    test('in the walk but not live is informational, boundary rows only', () => {
        expect(r.missing.map(g => [g.item, g.first.before, g.rows])).toEqual([['prayer potion(4)', 'T02-03a run', 3]]);
        expect(r.failed).toBe(3);
    });
});

describe('main', () => {
    const dir = mkdtempSync(join(tmpdir(), 'census-vs-walk-'));
    const ledger = join(dir, 'ledger.md');
    writeFileSync(ledger, LEDGER);
    const clean = join(dir, 'clean.jsonl');
    writeFileSync(clean, [census('S00 start', 'S00', 0, []), census('T01-02 run', 'T01-02', 10, [...KIT, ['Tinderbox', 1], ['Law rune', 2], ['Prayer potion(4)', 1]], ['Staff of water'])].join('\n'));
    const dirty = join(dir, 'dirty.jsonl');
    writeFileSync(dirty, [census('S00 start', 'S00', 0, []), census('T01-02 run', 'T01-02', 10, [...KIT, ['Tinderbox', 1], ['Vial', 1]], ['Staff of water'])].join('\n'));
    const quiet = <T>(f: () => T): T => {
        const log = console.log;
        const err = console.error;
        console.log = console.error = () => {};
        try {
            return f();
        } finally {
            console.log = log;
            console.error = err;
        }
    };

    test('--strict exits 1 on a FAIL, 0 without; a clean log is 0 either way', () => {
        expect(quiet(() => main([dirty, `--ledger=${ledger}`, '--strict']))).toBe(1);
        expect(quiet(() => main([dirty, `--ledger=${ledger}`]))).toBe(0);
        expect(quiet(() => main([clean, `--ledger=${ledger}`, '--strict', '--rows']))).toBe(0);
    });

    test('an unreadable log or ledger exits 2', () => {
        expect(quiet(() => main([join(dir, 'missing.jsonl'), `--ledger=${ledger}`]))).toBe(2);
        expect(quiet(() => main([clean, `--ledger=${join(dir, 'none.md')}`]))).toBe(2);
        expect(quiet(() => main([]))).toBe(2);
    });
});
