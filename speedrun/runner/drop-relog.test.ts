import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { relogNow, type PageRead, type RelogNowIO } from '../tools/relog-now';
import { ADOPT_WAIT_TICKS, recoverDrop, SETTLE_TICKS, type DropRelogDeps } from './drop-relog';
import { RelogBudget, RelogBudgetSpent } from './relog-budget';

const AT = { step: 'S07 woodcutting:oak-15-73', tick: 812 };
const dir = () => mkdtempSync(join(tmpdir(), 'drop-relog-'));

/** Fake deps over a page whose in-game flag the test sets; `onTick` runs on each waited tick. */
function world(o: { page?: boolean | null; up?: boolean; onTick?: (n: number) => void; advanced?: (ticks: number) => boolean } = {}) {
    const calls: string[] = [];
    let page: boolean | null = o.page === undefined ? false : o.page;
    let ticks = 0;
    let clock = 1_000_000;
    const deps: DropRelogDeps = {
        pageInGame: async () => page,
        worldUp: async () => o.up ?? true,
        login: async () => {
            calls.push('login');
            page = true;
            return { via: 'page', wallMs: 1_500 };
        },
        adopt: async tb => void calls.push(`adopt ${tb ?? '-'}`),
        restored: async () => void calls.push('restored'),
        advanced: () => o.advanced?.(ticks) ?? page === true,
        resumeWatchdog: () => void calls.push('resume watchdog'),
        waitTicks: async n => {
            ticks += n;
            clock += n * 400;
            o.onTick?.(ticks);
        },
        pauseWatchdog: () => void calls.push('pause watchdog'),
        now: () => clock,
    };
    return { deps, calls, setPage: (v: boolean | null) => (page = v), ticks: () => ticks };
}

describe('recoverDrop: a dropped page with the world up is relogged in page, against the budget', () => {
    test('the page out, the world up, no lock: one in-page relog, recorded with the step and tick of the drop', async () => {
        const budget = new RelogBudget(dir());
        const w = world();
        const r = await recoverDrop(budget, w.deps, 'client out of game', AT);
        expect(r.outcome).toBe('relogged');
        expect(w.calls).toEqual(['pause watchdog', 'login']);
        expect(budget.entries().map(e => [e.kind, e.by, e.step, e.tick, e.via])).toEqual([['unplanned', 'run', AT.step, AT.tick, 'page']]);
        expect(budget.holder()).toBeNull();
    });

    test('no page to ask, or the world down: the default path (the watchdog), no relog and nothing counted', async () => {
        for (const w of [world({ page: null }), world({ up: false })]) {
            const budget = new RelogBudget(dir());
            expect((await recoverDrop(budget, w.deps, 'x', AT)).outcome).toBe('default');
            expect(w.calls).toEqual(['pause watchdog', 'resume watchdog', 'restored']);
            expect(budget.entries()).toEqual([]);
        }
    });

    test('past the budget the recover throws with the reason and never logs in', async () => {
        const budget = new RelogBudget(dir());
        for (let i = 0; i < 3; i++) budget.record({ kind: 'unplanned', by: 'run', step: 'S0x', tick: i, via: 'page' });
        const w = world();
        const e = await recoverDrop(budget, w.deps, 'client out of game', AT).catch(err => err);
        expect(e).toBeInstanceOf(RelogBudgetSpent);
        expect((e as Error).message).toContain('relog budget spent: 3/3 unplanned relogs used');
        expect((e as Error).message).toContain(`${AT.step} tick ${AT.tick}`);
        expect(w.calls).not.toContain('login');
    });
});

test("out between the halves of S21's split planned relog is not a drop: no relog, nothing counted, the watchdog paused", async () => {
    const budget = new RelogBudget(dir());
    budget.beginPlanned('S21 relog', 4_210);
    const w = world();
    expect((await recoverDrop(budget, w.deps, 'client out of game', AT)).outcome).toBe('planned-out');
    expect(w.calls).toEqual(['pause watchdog']);
    expect(budget.used()).toEqual({ planned: 1, unplanned: 0 });
});

describe('a page that still says in game after the drop is given SETTLE_TICKS', () => {
    test('it falls to the title screen 7 ticks later: relogged in page then, never relaunched', async () => {
        const budget = new RelogBudget(dir());
        const w = world({ page: true, advanced: () => false, onTick: n => n === 7 && w.setPage(false) });
        expect((await recoverDrop(budget, w.deps, 'no tick for 6824 ms', AT)).outcome).toBe('relogged');
        expect(w.calls).toEqual(['pause watchdog', 'login']);
        expect(budget.entries().map(e => e.kind)).toEqual(['unplanned']);
    });

    test('it ticks again (its own reconnect): adopted', async () => {
        const budget = new RelogBudget(dir());
        const w = world({ page: true, advanced: n => n >= 3 });
        expect((await recoverDrop(budget, w.deps, 'x', AT)).outcome).toBe('adopted');
        expect(w.calls).toEqual(['pause watchdog', 'adopt -']);
    });

    test('neither within the bound (a frozen page): the watchdog path, resumed', async () => {
        const budget = new RelogBudget(dir());
        const w = world({ page: true, advanced: () => false });
        expect((await recoverDrop(budget, w.deps, 'x', AT)).outcome).toBe('default');
        expect(w.calls).toEqual(['pause watchdog', 'resume watchdog', 'restored']);
        expect(w.ticks()).toBe(SETTLE_TICKS);
        expect(budget.entries()).toEqual([]);
    });
});

describe('the race rule: a manual relog is adopted, never fought', () => {
    test("the operator's relog-now in flight while run.ts waits: run.ts never logs in, adopts the session and counts the operator's one relog", async () => {
        const d = dir();
        const operator = new RelogBudget(d, undefined, () => true, 22);
        const lock = operator.tryLock('operator');
        expect(lock.ok).toBe(true);
        const run = new RelogBudget(d, undefined, () => true, 11);
        const w = world({
            onTick: n => {
                if (n !== 3 || !lock.ok) return;
                // relog-now gets the page in, records its relog, and lets the lock go.
                w.setPage(true);
                operator.record({ kind: 'manual', by: 'operator', step: null, tick: -1, via: 'page', meta: { tickBase: 830 } });
                lock.release();
            },
        });
        const r = await recoverDrop(run, w.deps, 'client out of game', AT);
        expect(r.outcome).toBe('adopted');
        expect(w.calls).toEqual(['pause watchdog', 'adopt 830']);
        expect(run.used()).toEqual({ planned: 0, unplanned: 1 });
        expect(w.ticks()).toBe(3);
    });

    test('the page found back in the world (a relog by hand outside relog-now): adopted and counted as a manual relog', async () => {
        const budget = new RelogBudget(dir());
        const w = world({ page: true });
        expect((await recoverDrop(budget, w.deps, 'client out of game', AT)).outcome).toBe('adopted');
        expect(w.calls).toEqual(['pause watchdog', 'adopt -']);
        expect(budget.entries().map(e => [e.kind, e.by, e.via, e.step])).toEqual([['manual', 'run', 'adopted', AT.step]]);
    });

    test('an operator lock that never goes is bounded: the recover throws after ADOPT_WAIT_TICKS, still never logging in', async () => {
        const d = dir();
        expect(new RelogBudget(d, undefined, () => true, 22).tryLock('operator').ok).toBe(true);
        const w = world();
        await expect(recoverDrop(new RelogBudget(d, undefined, () => true, 11), w.deps, 'x', AT)).rejects.toThrow(`has held the relog lock for ${ADOPT_WAIT_TICKS} ticks`);
        expect(w.calls).toEqual(['pause watchdog']);
    });

    test("while run.ts relogs (it holds the lock), relog-now refuses and does nothing; afterwards run.ts's relog is the only one counted", async () => {
        const d = dir();
        const run = new RelogBudget(d, undefined, () => true, 11);
        const operator = new RelogBudget(d, undefined, () => true, 22);
        let refused = '';
        const w = world();
        const login = w.deps.login;
        w.deps.login = async () => {
            // relog-now started mid-way through run.ts's own login.
            const io: RelogNowIO = {
                budget: operator,
                read: async () => { throw new Error('relog-now must not touch the page'); },
                pageLogin: async () => { throw new Error('relog-now must not log in'); },
                navigate: async () => { throw new Error('relog-now must not navigate'); },
                waitTicks: async () => {},
                now: () => 0,
            };
            const r = await relogNow('scored_env', io);
            expect(r.ok).toBe(false);
            refused = r.line;
            return login();
        };
        expect((await recoverDrop(run, w.deps, 'client out of game', AT)).outcome).toBe('relogged');
        expect(refused).toMatch(/^failed: run\.ts \(pid 11\) is relogging scored_env itself/);
        expect(run.entries().map(e => [e.kind, e.by])).toEqual([['unplanned', 'run']]);
    });
});

describe('relog-now', () => {
    function io(o: { page: PageRead | null; start?: { started: boolean; reason?: string; tickBase: number | null }; afterLogin?: PageRead[]; afterNavigate?: PageRead[] }, budget = new RelogBudget(dir())) {
        const calls: string[] = [];
        let reads: PageRead[] = [];
        let current = o.page;
        const x: RelogNowIO = {
            budget,
            read: async () => (reads.length ? (current = reads.shift()!) : current),
            pageLogin: async () => {
                calls.push('pageLogin');
                reads = [...(o.afterLogin ?? [])];
                return { gatewayConnected: true, ...(o.start ?? { started: true, tickBase: 900 }) };
            },
            navigate: async () => {
                calls.push('navigate');
                reads = [...(o.afterNavigate ?? [])];
            },
            waitTicks: async () => {},
            now: () => 0,
        };
        return { io: x, calls, budget };
    }
    const out = (tick: number | null = 900): PageRead => ({ inGame: false, loggingIn: false, tick, message: 'Connection lost' });
    const loggingIn: PageRead = { inGame: false, loggingIn: true, tick: 900, message: '' };
    const inAt = (tick: number): PageRead => ({ inGame: true, loggingIn: false, tick, message: '' });

    test('in page: confirmed by the page in game with its tick advancing; one manual relog recorded; the lock let go', async () => {
        const t = io({ page: out(), afterLogin: [loggingIn, inAt(901), inAt(901), inAt(902)] });
        const r = await relogNow('scored_env', t.io);
        expect(r.ok).toBe(true);
        expect(r.line).toMatch(/^in: scored_env is back in the world via the page \(page tick 902/);
        expect(t.calls).toEqual(['pageLogin']);
        expect(t.budget.entries().map(e => [e.kind, e.by, e.via, e.meta?.tickBase])).toEqual([['manual', 'operator', 'page', 900]]);
        expect(t.budget.holder()).toBeNull();
    });

    test('the in-page login ends on the title screen: the token URL, as session.ts login falls back', async () => {
        const t = io({ page: out(), afterLogin: [out()], afterNavigate: [loggingIn, inAt(3), inAt(4)] });
        const r = await relogNow('scored_env', t.io);
        expect([r.ok, t.calls]).toEqual([true, ['pageLogin', 'navigate']]);
        expect(r.line).toContain('via the token URL');
    });

    test('already in the world: nothing done, nothing counted', async () => {
        const t = io({ page: inAt(500) });
        const r = await relogNow('scored_env', t.io);
        expect([r.ok, r.line, t.calls, t.budget.entries()]).toEqual([true, 'in: scored_env is already in the world (page tick 500); nothing done', [], []]);
    });

    test("between the halves of S21's split relog: refused before the page is touched, nothing counted", async () => {
        const budget = new RelogBudget(dir());
        budget.beginPlanned('S21 relog', 4_210);
        const t = io({ page: out() }, budget);
        const r = await relogNow('scored_env', t.io);
        expect([r.ok, r.line]).toEqual([false, 'failed: the planned S21 relog is open (SCORED is out on purpose until its login half); nothing done']);
        expect([t.calls, budget.used(), budget.holder()]).toEqual([[], { planned: 1, unplanned: 0 }, null]);
    });

    test('the budget spent or no tab: refused, nothing done', async () => {
        const spent = new RelogBudget(dir());
        for (let i = 0; i < 3; i++) spent.record({ kind: 'unplanned', by: 'run', step: 'S', tick: i, via: 'page' });
        const a = io({ page: out() }, spent);
        expect((await relogNow('scored_env', a.io)).line).toMatch(/^failed: relog budget spent: 3\/3/);
        expect(a.calls).toEqual([]);
        const b = io({ page: null });
        expect((await relogNow('scored_env', b.io)).line).toBe('failed: no tab with a game client for scored_env on the DevTools port');
    });
});
