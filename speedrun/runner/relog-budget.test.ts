import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { RELOG_LOCK, RelogBudget } from './relog-budget';

const dir = () => mkdtempSync(join(tmpdir(), 'relog-budget-'));
const entry = (kind: 'planned' | 'unplanned' | 'manual', step = 'S07') => ({ kind, by: kind === 'manual' ? ('operator' as const) : ('run' as const), step, tick: 100, via: 'page' as const });

describe('the relog budget', () => {
    test('the planned S21 relog plus 3 unplanned, run.ts and the operator counted together', () => {
        const b = new RelogBudget(dir());
        expect(b.check('planned')).toBe(true);
        expect(b.check('unplanned')).toBe(true);
        b.record(entry('planned', 'S21 relog'));
        expect(b.check('planned')).toContain('planned relogs are spent (1/1)');
        expect(b.hasPlanned('S21 relog')).toBe(true);
        b.record(entry('unplanned'));
        b.record(entry('manual'));
        expect(b.check('unplanned')).toBe(true);
        b.record(entry('unplanned'));
        expect(b.check('unplanned')).toBe('relog budget spent: 3/3 unplanned relogs used (planned 1/1, unplanned 3/3)');
        expect(b.check('manual')).toContain('relog budget spent');
    });

    test('entries are read from disk, so a second process (relog-now) sees the run\'s and the run sees its', () => {
        const d = dir();
        const run = new RelogBudget(d, undefined, () => true, 11);
        const operator = new RelogBudget(d, undefined, () => true, 22);
        run.record(entry('unplanned'));
        operator.record(entry('manual'));
        expect(run.used()).toEqual({ planned: 0, unplanned: 2 });
        const f = JSON.parse(readFileSync(join(d, 'relogs.json'), 'utf8'));
        expect(f.entries.map((e: { kind: string; step: string; tick: number }) => [e.kind, e.step, e.tick])).toEqual([['unplanned', 'S07', 100], ['manual', 'S07', 100]]);
    });

    test('the lock is exclusive: a second taker sees the holder until it is released', () => {
        const d = dir();
        const run = new RelogBudget(d, undefined, () => true, 11);
        const operator = new RelogBudget(d, undefined, () => true, 22);
        const a = operator.tryLock('operator');
        expect(a.ok).toBe(true);
        const b = run.tryLock('run');
        expect(b.ok ? null : b.holder.by).toBe('operator');
        if (a.ok) a.release();
        expect(existsSync(join(d, RELOG_LOCK))).toBe(false);
        expect(run.tryLock('run').ok).toBe(true);
    });

    test('a lock whose process is gone is broken by the next taker', () => {
        const d = dir();
        writeFileSync(join(d, RELOG_LOCK), JSON.stringify({ by: 'operator', pid: 999_999, at: 'x' }));
        const run = new RelogBudget(d, undefined, pid => pid !== 999_999, 11);
        expect(run.holder()).toBeNull();
        expect(run.tryLock('run').ok).toBe(true);
    });

    test('release never removes a lock someone else took after a stale break', () => {
        const d = dir();
        const run = new RelogBudget(d, undefined, () => true, 11);
        const l = run.tryLock('run');
        writeFileSync(join(d, RELOG_LOCK), JSON.stringify({ by: 'operator', pid: 22, at: 'later' }));
        if (l.ok) l.release();
        expect(run.holder()?.by).toBe('operator');
    });

    test("a split planned relog (S21's logout half, then its login half) is one planned entry, open between the halves", () => {
        const b = new RelogBudget(dir());
        expect(b.planned('S21 relog')).toBeNull();
        b.beginPlanned('S21 relog', 4_210, { sends: 1, confirmTicks: 0 });
        expect([b.planned('S21 relog'), b.hasPlanned('S21 relog'), b.openPlanned()?.step]).toEqual(['open', false, 'S21 relog']);
        expect(() => b.beginPlanned('S21 relog', 4_211)).toThrow('already recorded');
        b.endPlanned('S21 relog', 'page', { wallMs: 1_800 });
        expect([b.planned('S21 relog'), b.hasPlanned('S21 relog'), b.openPlanned()]).toEqual(['closed', true, null]);
        expect(b.used()).toEqual({ planned: 1, unplanned: 0 });
        expect(b.entries()[0]!.meta).toMatchObject({ logout: { sends: 1, confirmTicks: 0 }, login: { wallMs: 1_800 } });
        expect(() => b.endPlanned('S21 relog', 'page')).toThrow('no open planned relog');
    });

    test('an adopt is recorded but never charged: four adopts leave the budget whole, and a real relog after them is charged', () => {
        const b = new RelogBudget(dir());
        b.record(entry('unplanned'));
        const before = b.check('unplanned');
        for (let i = 0; i < 4; i++) b.record({ kind: 'adopt', by: 'run', step: 'S07', tick: 100 + i, via: 'adopted' });
        expect(b.check('unplanned')).toBe(before);
        expect(b.used()).toEqual({ planned: 0, unplanned: 1 });
        expect(b.adopts()).toBe(4);
        expect(b.describe()).toBe('planned 0/1, unplanned 1/3, 4 adopts uncharged');
        b.record(entry('unplanned'));
        b.record(entry('manual'));
        expect(b.check('unplanned')).toContain('relog budget spent: 3/3');
    });

    test('clear forgets an earlier run', () => {
        const b = new RelogBudget(dir());
        b.record(entry('unplanned'));
        b.clear();
        expect(b.entries()).toEqual([]);
    });
});

test('amend rewrites one recorded entry in place, keeping its time; an entry not on file is refused', () => {
    const budget = new RelogBudget(mkdtempSync(join(tmpdir(), 'relog-amend-')));
    const first = budget.record({ kind: 'unplanned', by: 'run', step: 'S03', tick: 10, via: 'page' });
    const adopted = budget.record({ kind: 'manual', by: 'run', step: 'S07', tick: 812, via: 'adopted', meta: { how: 'ticking' } });
    const relog = budget.amend(adopted, { kind: 'unplanned', via: 'page', meta: { reason: 'fell out', adoptedFirst: adopted.meta } });
    expect(relog.at).toBe(adopted.at);
    expect(budget.entries().map(e => [e.kind, e.step, e.via])).toEqual([
        ['unplanned', 'S03', 'page'],
        ['unplanned', 'S07', 'page'],
    ]);
    expect(budget.used()).toEqual({ planned: 0, unplanned: 2 });
    expect(() => budget.amend({ ...first, at: '1999-01-01T00:00:00.000Z' }, { via: 'launch' })).toThrow('no unplanned relog recorded at 1999');
});
