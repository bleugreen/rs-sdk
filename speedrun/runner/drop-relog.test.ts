import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { relogNow, type PageRead, type RelogNowIO } from '../tools/relog-now';
import { ALREADY_LOGGED_IN, LoginRefused, LoginTimedOut } from '../lib/session';
import { tickMs } from '../lib/wait';
import { ADOPT_WAIT_TICKS, ALREADY_IN_BOUND_MS, ALREADY_IN_RETRY_MS, MAX_FALLS, RECHECK_TICKS, recoverDrop, type DropRelogDeps } from './drop-relog';
import { NO_DATA_TIMEOUT_MS } from '../../server/webclient/src/client/NoDataTimeout';
import { PAGE_HOLD_MARGIN_MS, pageHoldTicks } from './page-hold';
import { RelogBudget, RelogBudgetSpent } from './relog-budget';

const AT = { step: 'S07 woodcutting:oak-15-73', tick: 812 };
const dir = () => mkdtempSync(join(tmpdir(), 'drop-relog-'));

/**
 * Fake deps over a page whose in-game flag the test sets; `onTick` runs on each waited tick. The
 * session counts as back (link.restored resolves) from tick `backAt` (default 0: at once) until a
 * test says otherwise; `gateway` is whether our gateway answers at a tick (default up).
 */
function world(
    o: {
        page?: boolean | null;
        up?: boolean;
        gateway?: (ticks: number) => boolean;
        onTick?: (n: number) => void;
        advanced?: (ticks: number) => boolean;
        backAt?: number;
        onAdopt?: () => void;
    } = {}
) {
    const calls: string[] = [];
    let page: boolean | null = o.page === undefined ? false : o.page;
    let ticks = 0;
    let clock = 1_000_000;
    let expectIn = true;
    let backAt = o.backAt ?? 0;
    const waiters = new Set<() => void>();
    const wake = () => {
        if (ticks < backAt) return;
        for (const w of waiters) w();
        waiters.clear();
    };
    const deps: DropRelogDeps = {
        pageInGame: async () => page,
        worldUp: async () => o.up ?? true,
        gatewayUp: async () => o.gateway?.(ticks) ?? true,
        expectInWorld: () => expectIn,
        login: async () => {
            calls.push(`login@${ticks}`);
            page = true;
            expectIn = true;
            return { via: 'page', wallMs: 1_500 };
        },
        relaunch: async () => {
            calls.push(`relaunch@${ticks}`);
            page = true;
            expectIn = true;
            return { via: 'launch', wallMs: 20_000 };
        },
        adopt: tb => {
            calls.push(`adopt ${tb ?? '-'}`);
            expectIn = true;
            o.onAdopt?.();
        },
        restored: signal => {
            calls.push('restored');
            return new Promise<void>((resolve, reject) => {
                if (ticks >= backAt) return resolve();
                waiters.add(resolve);
                signal.addEventListener('abort', () => {
                    waiters.delete(resolve);
                    reject(new Error('stopped'));
                });
            });
        },
        advanced: () => o.advanced?.(ticks) ?? page === true,
        resumeWatchdog: () => void calls.push('resume watchdog'),
        waitTicks: async n => {
            ticks += n;
            clock += n * 400;
            o.onTick?.(ticks);
            wake();
        },
        pauseWatchdog: () => void calls.push('pause watchdog'),
        now: () => clock,
    };
    return {
        deps,
        calls,
        setPage: (v: boolean | null) => (page = v),
        setExpectIn: (v: boolean) => (expectIn = v),
        setBackAt: (n: number) => (backAt = n),
        ticks: () => ticks,
    };
}

/** The calls with the tick stripped from logins. */
const named = (calls: string[]) => calls.map(c => c.replace(/@\d+$/, ''));

describe('recoverDrop: a dropped page with the world up is relogged in page, against the budget', () => {
    test('the page out, the world up, no lock: one in-page relog, recorded with the step and tick of the drop', async () => {
        const budget = new RelogBudget(dir());
        const w = world();
        const r = await recoverDrop(budget, w.deps, 'client out of game', AT);
        expect(r.outcome).toBe('relogged');
        expect(named(w.calls)).toEqual(['pause watchdog', 'login']);
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

const SETTLE_TICKS = pageHoldTicks();

describe("a page that still says in game after the drop is given its hold window (page-hold.ts)", () => {
    test('it falls to the title screen 7 ticks later: relogged in page then, never relaunched', async () => {
        const budget = new RelogBudget(dir());
        const w = world({ page: true, advanced: () => false, onTick: n => n === 7 && w.setPage(false) });
        expect((await recoverDrop(budget, w.deps, 'no tick for 6824 ms', AT)).outcome).toBe('relogged');
        expect(named(w.calls)).toEqual(['pause watchdog', 'login']);
        expect(budget.entries().map(e => e.kind)).toEqual(['unplanned']);
    });

    test('it ticks again (its own reconnect): adopted', async () => {
        const budget = new RelogBudget(dir());
        const w = world({ page: true, advanced: n => n >= 3 });
        expect((await recoverDrop(budget, w.deps, 'x', AT)).outcome).toBe('adopted');
        expect(w.calls).toEqual(['pause watchdog', 'adopt -', 'restored']);
    });

    test('neither within the window, the world and our gateway up (the zombie: in game by its word, no tick for the whole window): its tab relaunched, never adopted, one unplanned relog', async () => {
        const budget = new RelogBudget(dir());
        const w = world({ page: true, advanced: () => false, backAt: Infinity });
        const r = await recoverDrop(budget, w.deps, 'no tick for ~18 ticks', AT);
        expect(r.outcome).toBe('relogged');
        // No in-page login on the zombie tab and no adopt of its claim: a fresh tab at the window's end.
        expect(w.calls).toEqual(['pause watchdog', `relaunch@${SETTLE_TICKS}`]);
        expect(budget.entries().map(e => [e.kind, e.by, e.via, e.step, e.tick])).toEqual([['unplanned', 'run', 'launch', AT.step, AT.tick]]);
        expect(budget.entries()[0]!.meta).toMatchObject({ zombie: true, attempts: { tries: 1, freshTabs: 1, timeouts: 0 } });
        expect(budget.holder()).toBeNull();
    });
});

describe('every wait keeps asking the page: an out page is relogged, never waited out (rs/659)', () => {
    test("attempt 3's 01:38:24Z sequence: the page reconnects and ticks, run.ts adopts it, a logout lands 1 tick later: relogged in page within the one recovery, on one budget entry", async () => {
        const budget = new RelogBudget(dir());
        let adoptedAt = -1;
        let logoutQueued = false;
        const w = world({
            page: true,
            advanced: n => n >= 1,
            backAt: Infinity, // logged out, the session never comes back by itself
            onAdopt: () => {
                adoptedAt = w.ticks();
                logoutQueued = true;
            },
            // The queued logout lands on the first tick after the adopt.
            onTick: () => {
                if (!logoutQueued) return;
                logoutQueued = false;
                w.setPage(false);
            },
        });
        const r = await recoverDrop(budget, w.deps, 'no tick for 40 ticks (gateway outage)', AT);
        expect(r.outcome).toBe('relogged');
        expect(named(w.calls)).toEqual(['pause watchdog', 'adopt -', 'restored', 'pause watchdog', 'login']);
        // Found out at the first recheck after the adopt, not after ADOPT_WAIT_TICKS.
        const loginTick = Number(w.calls.find(c => c.startsWith('login@'))!.split('@')[1]);
        expect(loginTick - adoptedAt).toBeLessThanOrEqual(RECHECK_TICKS);
        // One drop, one entry: the adopt's, now the relog's.
        expect(budget.entries().map(e => [e.kind, e.by, e.via, e.step, e.tick])).toEqual([['unplanned', 'run', 'page', AT.step, AT.tick]]);
        expect(budget.entries()[0]!.meta?.adoptedFirst).toMatchObject({ how: 'the page was back in the world, ticking' });
        expect(budget.used()).toEqual({ planned: 0, unplanned: 1 });
        expect(budget.holder()).toBeNull();
    });

    test('an adopt that keeps falling out is bounded: MAX_FALLS relogs, then the recover throws', async () => {
        const budget = new RelogBudget(dir());
        // A flapping page: back in game at the read under the lock after each fall, out again the tick after each adopt.
        let falling = false;
        let backUnderLock = false;
        const w = world({
            page: true,
            advanced: n => n >= 1,
            backAt: Infinity,
            onAdopt: () => (falling = true),
            onTick: () => {
                if (!falling) return;
                falling = false;
                w.setPage(false);
            },
        });
        w.deps.login = async () => {
            throw new Error('login must not be reached: the page is back in game under the lock');
        };
        const pause = w.deps.pauseWatchdog;
        w.deps.pauseWatchdog = () => {
            pause();
            if (w.calls.length > 1) backUnderLock = true;
        };
        const pageInGame = w.deps.pageInGame;
        let adoptsUnderLock = 0;
        w.deps.pageInGame = async () => {
            if (backUnderLock) {
                backUnderLock = false;
                adoptsUnderLock++;
                w.setPage(true);
            }
            return pageInGame();
        };
        await expect(recoverDrop(budget, w.deps, 'x', AT)).rejects.toThrow(`fell out of the world ${MAX_FALLS + 1} times`);
        expect(adoptsUnderLock).toBe(MAX_FALLS);
        // Every adopt after the first reused the first one's entry, and no login was sent: nothing charged.
        expect(budget.entries().map(e => e.kind)).toEqual(['adopt']);
        expect(budget.used()).toEqual({ planned: 0, unplanned: 0 });
        expect(budget.holder()).toBeNull();
    });

    test('the page out while our gateway is down: no login until the gateway answers, then one in-page relog', async () => {
        const budget = new RelogBudget(dir());
        const w = world({ page: false, backAt: Infinity, gateway: n => n >= 150 });
        const r = await recoverDrop(budget, w.deps, 'no tick for 6824 ms', AT);
        expect(r.outcome).toBe('relogged');
        expect(named(w.calls)).toEqual(['pause watchdog', 'resume watchdog', 'restored', 'pause watchdog', 'login']);
        const loginTick = Number(w.calls.find(c => c.startsWith('login@'))!.split('@')[1]);
        expect(loginTick).toBeGreaterThanOrEqual(150);
        expect(loginTick).toBeLessThan(150 + RECHECK_TICKS);
        expect(budget.used()).toEqual({ planned: 0, unplanned: 1 });
    });

    test('our gateway down past the hold window with the page in the world throughout: back when it is, no relog and nothing counted', async () => {
        const budget = new RelogBudget(dir());
        // 150 ticks (60 s at 400 ms) past the settle without a published tick; the page never left the world.
        const back = SETTLE_TICKS + 150;
        const w = world({ page: true, advanced: () => false, backAt: back, gateway: n => n >= back });
        const r = await recoverDrop(budget, w.deps, 'no tick for 40 ticks', AT);
        expect(r.outcome).toBe('default');
        expect(w.calls).toEqual(['pause watchdog', 'resume watchdog', 'restored']);
        expect(w.ticks()).toBeGreaterThanOrEqual(back);
        expect(w.ticks()).toBeLessThan(back + RECHECK_TICKS);
        expect(budget.entries()).toEqual([]);
    });

    test('the world down when the page fell out: relogged once the world is back, not before', async () => {
        const budget = new RelogBudget(dir());
        let up = false;
        const w = world({ page: false, backAt: Infinity, onTick: n => (up = n >= 90) });
        w.deps.worldUp = async () => up;
        expect((await recoverDrop(budget, w.deps, 'x', AT)).outcome).toBe('relogged');
        const loginTick = Number(w.calls.find(c => c.startsWith('login@'))!.split('@')[1]);
        expect(loginTick).toBeGreaterThanOrEqual(90);
        expect(budget.used()).toEqual({ planned: 0, unplanned: 1 });
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
        expect(w.calls).toEqual(['pause watchdog', 'adopt 830', 'restored']);
        expect(run.used()).toEqual({ planned: 0, unplanned: 1 });
        expect(w.ticks()).toBeGreaterThanOrEqual(3);
        expect(w.ticks()).toBeLessThanOrEqual(3 + RECHECK_TICKS);
    });

    test('the page found back in the world (its own reconnect, or a relog by hand outside relog-now): adopted and recorded as an adopt, never charged', async () => {
        const budget = new RelogBudget(dir());
        const w = world({ page: true });
        expect((await recoverDrop(budget, w.deps, 'client out of game', AT)).outcome).toBe('adopted');
        expect(w.calls).toEqual(['pause watchdog', 'adopt -', 'restored']);
        expect(budget.entries().map(e => [e.kind, e.by, e.via, e.step])).toEqual([['adopt', 'run', 'adopted', AT.step]]);
        expect(budget.used()).toEqual({ planned: 0, unplanned: 0 });
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

describe('an adopt never spends the budget (the 10 s socket hold: back by adopt in ~38 ticks)', () => {
    test('four short holds, each adopted with no login sent, leave the budget whole; a real in-page relog after them is charged unplanned', async () => {
        const budget = new RelogBudget(dir());
        for (let i = 0; i < 4; i++) {
            const w = world({ page: true, advanced: n => n >= 2 });
            expect((await recoverDrop(budget, w.deps, 'no tick for 7 s', { ...AT, tick: AT.tick + i })).outcome).toBe('adopted');
            expect(w.calls.filter(c => c.startsWith('login'))).toEqual([]);
        }
        expect(budget.entries().map(e => [e.kind, e.by, e.via])).toEqual(Array(4).fill(['adopt', 'run', 'adopted']));
        expect(budget.used()).toEqual({ planned: 0, unplanned: 0 });
        expect(budget.check('unplanned')).toBe(true);
        const w = world();
        expect((await recoverDrop(budget, w.deps, 'client out of game', AT)).outcome).toBe('relogged');
        expect(budget.used()).toEqual({ planned: 0, unplanned: 1 });
    });

    test('with the unplanned budget spent, an adopt still goes through: nothing is charged for it', async () => {
        const budget = new RelogBudget(dir());
        for (let i = 0; i < 3; i++) budget.record({ kind: 'unplanned', by: 'run', step: 'S0x', tick: i, via: 'page' });
        const w = world({ page: true, advanced: n => n >= 2 });
        expect((await recoverDrop(budget, w.deps, 'no tick for 7 s', AT)).outcome).toBe('adopted');
        expect(budget.used()).toEqual({ planned: 0, unplanned: 3 });
    });
});

describe('a login refused as already logged in is waited out (the 20 s socket hold: the server keeps the silent player 1,000 ticks)', () => {
    const refused = () =>
        new LoginRefused(ALREADY_LOGGED_IN, 'Your account is already logged in. Try again in 60 secs...', 1, 'scored: login refused after 1 attempt(s) (reply 5: Your account is already logged in. Try again in 60 secs...)');

    /**
     * world() whose tries (the in-page login, then fresh tabs) fail with `fail(n)` (n: the 1-based
     * try) while it returns an error, then get in; the wall time of each try.
     */
    function refusing(budget: RelogBudget, fail: (n: number) => Error | null) {
        const w = world();
        const tries: number[] = [];
        const lockHeld: boolean[] = [];
        const wrap = (inner: DropRelogDeps['login']) => async () => {
            tries.push(w.deps.now());
            lockHeld.push(budget.holder()?.by === 'run');
            const e = fail(tries.length);
            if (e) {
                w.calls.push(`refused@${w.ticks()}`);
                throw e;
            }
            return inner();
        };
        w.deps.login = wrap(w.deps.login);
        w.deps.relaunch = wrap(w.deps.relaunch);
        return { w, tries, lockHeld };
    }

    test('refused twice, then in: a retry every ALREADY_IN_RETRY_MS under the lock, each on a fresh tab, the watchdog paused throughout, one unplanned relog', async () => {
        const budget = new RelogBudget(dir());
        const { w, tries, lockHeld } = refusing(budget, n => (n <= 2 ? refused() : null));
        const r = await recoverDrop(budget, w.deps, 'client out of game', AT);
        expect(r.outcome).toBe('relogged');
        expect(named(w.calls)).toEqual(['pause watchdog', 'refused', 'refused', 'relaunch']);
        for (const i of [1, 2]) {
            expect(tries[i]! - tries[i - 1]!).toBeGreaterThanOrEqual(ALREADY_IN_RETRY_MS);
            expect(tries[i]! - tries[i - 1]!).toBeLessThan(ALREADY_IN_RETRY_MS + RECHECK_TICKS * 400);
        }
        // relog-now refuses while run.ts holds the lock, so no second login races the retries.
        expect(lockHeld).toEqual([true, true, true]);
        expect(budget.entries().map(e => [e.kind, e.by, e.via, e.step, e.tick])).toEqual([['unplanned', 'run', 'launch', AT.step, AT.tick]]);
        expect(budget.entries()[0]!.meta?.alreadyLoggedIn).toEqual({ refusals: 2, heldMs: tries[2]! - tries[0]! });
        expect(budget.holder()).toBeNull();
    });

    test('refused past the bound: fails as before, nothing recorded, the lock let go; no retry starts past ALREADY_IN_BOUND_MS', async () => {
        const budget = new RelogBudget(dir());
        const { w, tries } = refusing(budget, () => refused());
        const e = await recoverDrop(budget, w.deps, 'client out of game', AT).catch(err => err);
        expect(e).toBeInstanceOf(Error);
        expect((e as Error).message).toMatch(
            /^scored: login refused after 1 attempt\(s\) \(reply 5: .*\); \d+ relog attempt\(s\) failed over \d+ s after the drop at S07 woodcutting:oak-15-73 tick 812 \(\d+ refused as already logged in, 0 timed out\), past the 8-min bound/
        );
        expect(tries.at(-1)! - tries[0]!).toBeLessThanOrEqual(ALREADY_IN_BOUND_MS);
        expect(tries.at(-1)! - tries[0]! + ALREADY_IN_RETRY_MS).toBeGreaterThan(ALREADY_IN_BOUND_MS);
        expect(tries.length).toBe(Math.floor(ALREADY_IN_BOUND_MS / ALREADY_IN_RETRY_MS) + 1);
        expect(w.calls).not.toContain('resume watchdog');
        expect(budget.entries()).toEqual([]);
        expect(budget.holder()).toBeNull();
    });

    test('any other refusal (a bad password, a full world) or a login that ended without a timeout is not retried: one login, the error as it came', async () => {
        for (const err of [
            new Error('scored: login failed after 6 attempt(s) (exited, exit null)'),
            new LoginRefused(3, 'Invalid username or password.', 1, 'scored: login refused after 1 attempt(s) (reply 3: Invalid username or password.)'),
            new LoginRefused(7, 'This world is full. Please use a different world.', 1, 'scored: login refused after 1 attempt(s) (reply 7: This world is full.)'),
        ]) {
            const budget = new RelogBudget(dir());
            const { w, tries } = refusing(budget, () => err);
            await expect(recoverDrop(budget, w.deps, 'client out of game', AT)).rejects.toBe(err);
            expect(tries).toHaveLength(1);
            expect(budget.entries()).toEqual([]);
            expect(budget.holder()).toBeNull();
        }
    });

    test('a full world on a fresh tab is not retried either: the error as it came, nothing charged', async () => {
        const budget = new RelogBudget(dir());
        const full = new LoginRefused(7, 'This world is full.', 1, 'scored: fresh-tab login refused (reply 7)');
        const { w, tries } = refusing(budget, n => (n === 1 ? refused() : full));
        await expect(recoverDrop(budget, w.deps, 'client out of game', AT)).rejects.toBe(full);
        expect(tries).toHaveLength(2);
        expect(budget.entries()).toEqual([]);
        expect(budget.holder()).toBeNull();
    });
});

describe("a relog never fails the run after one attempt (the host's run D: a 60 s socket block on the dead path)", () => {
    const ticksOf = (ms: number) => Math.ceil(ms / tickMs());
    const LOGIN_TIMEOUT_TICKS = ticksOf(90_000);

    /**
     * Run D's page: in game and silent until its no-data timeout, then out; the in-page login spends its
     * 90 s and times out, leaving the page a zombie (in game by its word, 'Connecting to server...').
     */
    function runD(relaunch: (n: number) => Error | null) {
        const timeout = ticksOf(NO_DATA_TIMEOUT_MS);
        const w = world({ page: true, advanced: () => false, backAt: Infinity, onTick: n => n === timeout && w.setPage(false) });
        const budget = new RelogBudget(dir());
        const tries: { via: string; at: number; locked: boolean }[] = [];
        w.deps.login = async () => {
            tries.push({ via: 'page', at: w.deps.now(), locked: budget.holder()?.by === 'run' });
            w.calls.push(`login-timeout@${w.ticks()}`);
            await w.deps.waitTicks(LOGIN_TIMEOUT_TICKS);
            w.setPage(true);
            throw new LoginTimedOut('scored: login failed after 1 attempt(s) (timeout, in page)');
        };
        const fresh = w.deps.relaunch;
        let n = 0;
        w.deps.relaunch = async () => {
            tries.push({ via: 'launch', at: w.deps.now(), locked: budget.holder()?.by === 'run' });
            const e = relaunch(++n);
            if (e) {
                w.calls.push(`relaunch-failed@${w.ticks()}`);
                throw e;
            }
            return fresh();
        };
        return { w, budget, tries, timeout };
    }

    test('silent for the whole window, the in-page login times out, the account absent: a fresh tab gets in inside the loop, one unplanned relog, never a throw', async () => {
        const { w, budget, tries, timeout } = runD(() => null);
        const r = await recoverDrop(budget, w.deps, 'no tick for ~18 ticks (6800 ms)', AT);
        expect(r.outcome).toBe('relogged');
        expect(named(w.calls)).toEqual(['pause watchdog', 'login-timeout', 'relaunch']);
        expect(Number(w.calls[1]!.split('@')[1])).toBe(timeout);
        // The fresh tab one cadence after the timeout, under the lock, the watchdog never resumed.
        expect(tries.map(t => [t.via, t.locked])).toEqual([['page', true], ['launch', true]]);
        expect(tries[1]!.at - (tries[0]!.at + LOGIN_TIMEOUT_TICKS * tickMs())).toBeGreaterThanOrEqual(ALREADY_IN_RETRY_MS);
        expect(tries[1]!.at - (tries[0]!.at + LOGIN_TIMEOUT_TICKS * tickMs())).toBeLessThan(ALREADY_IN_RETRY_MS + RECHECK_TICKS * tickMs());
        expect(w.calls).not.toContain('resume watchdog');
        expect(budget.entries().map(e => [e.kind, e.by, e.via, e.step, e.tick])).toEqual([['unplanned', 'run', 'launch', AT.step, AT.tick]]);
        expect(budget.entries()[0]!.meta).toMatchObject({ attempts: { tries: 2, freshTabs: 1, timeouts: 1 } });
        expect(budget.used()).toEqual({ planned: 0, unplanned: 1 });
        expect(budget.holder()).toBeNull();
    });

    test('every fresh tab fails too: one every ALREADY_IN_RETRY_MS until the bound, then the recover throws, nothing charged, the lock let go', async () => {
        const fail = () => new Error('scored: refusing launch L: the page is in game but none of its states reached our gateway for 10000 ms; nothing was sent to the account');
        const { w, budget, tries } = runD(fail);
        const e = await recoverDrop(budget, w.deps, 'no tick for ~18 ticks', AT).catch(err => err);
        expect(e).toBeInstanceOf(Error);
        expect((e as Error).message).toMatch(/^scored: refusing launch L: .*; \d+ relog attempt\(s\) failed over \d+ s after the drop at .* \(0 refused as already logged in, 1 timed out\), past the 8-min bound/);
        expect(tries[0]!.via).toBe('page');
        expect(tries.slice(1).every(t => t.via === 'launch' && t.locked)).toBe(true);
        // Counted from the first failure, the in-page timeout's end.
        const firstFail = tries[0]!.at + LOGIN_TIMEOUT_TICKS * tickMs();
        expect(tries.at(-1)!.at - firstFail).toBeLessThanOrEqual(ALREADY_IN_BOUND_MS);
        expect(tries.at(-1)!.at - firstFail + ALREADY_IN_RETRY_MS).toBeGreaterThan(ALREADY_IN_BOUND_MS);
        expect(tries.length - 1).toBe(Math.floor(ALREADY_IN_BOUND_MS / ALREADY_IN_RETRY_MS));
        expect(w.calls).not.toContain('resume watchdog');
        expect(budget.entries()).toEqual([]);
        expect(budget.used()).toEqual({ planned: 0, unplanned: 0 });
        expect(budget.holder()).toBeNull();
    });
});

describe('a network hold: the page keeps its socket and says in game, and the recovery waits for it (page-hold.ts)', () => {
    const ticksOf = (ms: number) => Math.ceil(ms / tickMs());

    test('the window is the page\'s own no-data timeout plus the margin, in ticks', () => {
        expect(SETTLE_TICKS * tickMs()).toBeGreaterThanOrEqual(NO_DATA_TIMEOUT_MS + PAGE_HOLD_MARGIN_MS);
        expect(SETTLE_TICKS * tickMs()).toBeLessThan(NO_DATA_TIMEOUT_MS + PAGE_HOLD_MARGIN_MS + tickMs());
    });

    test('a 60 s silent hold: no relaunch, no relog; the ticks resume and the original session is adopted', async () => {
        const budget = new RelogBudget(dir());
        const resume = ticksOf(60_000);
        const w = world({ page: true, advanced: n => n >= resume });
        const r = await recoverDrop(budget, w.deps, 'no tick for ~18 ticks (6800 ms)', AT);
        expect(r.outcome).toBe('adopted');
        // The watchdog paused throughout (never resumed before the adopt), and nothing logged in.
        expect(w.calls).toEqual(['pause watchdog', 'adopt -', 'restored']);
        // Adopted on the tick the ticks resumed, plus at most the adopt's one recheck.
        expect(w.ticks()).toBeGreaterThanOrEqual(resume);
        expect(w.ticks()).toBeLessThanOrEqual(resume + RECHECK_TICKS);
        // The adopt is the only record: no login was charged (rs/733 keeps the adopt itself off the budget).
        expect(budget.entries().every(e => e.via === 'adopted')).toBe(true);
    });

    test('a 60 s outage read as 121.6 s of silence (61.6 s of TCP backoff after it, the host\'s run C): held and adopted, no relog, nothing charged', async () => {
        const budget = new RelogBudget(dir());
        const resume = ticksOf(60_000 + 61_600);
        const timeout = ticksOf(NO_DATA_TIMEOUT_MS);
        expect(resume).toBeLessThan(timeout);
        // The page as it is: in game until its own no-data timeout, unless the ticks come back first.
        const w = world({ page: true, advanced: n => n >= resume, onTick: n => n >= timeout && w.setPage(false) });
        const r = await recoverDrop(budget, w.deps, 'no tick for ~18 ticks (6800 ms)', AT);
        expect(r.outcome).toBe('adopted');
        expect(w.calls).toEqual(['pause watchdog', 'adopt -', 'restored']);
        expect(w.ticks()).toBeGreaterThanOrEqual(resume);
        expect(w.ticks()).toBeLessThanOrEqual(resume + RECHECK_TICKS);
        expect(budget.entries().every(e => e.via === 'adopted')).toBe(true);
        expect(budget.used()).toEqual({ planned: 0, unplanned: 0 });
    });

    test('a 250 s hold: the page times out at its no-data timeout (lostCon, out of the world), then the usual in-page relog', async () => {
        const budget = new RelogBudget(dir());
        const timeout = ticksOf(NO_DATA_TIMEOUT_MS);
        expect(timeout).toBeLessThan(ticksOf(250_000));
        const w = world({ page: true, advanced: () => false, backAt: Infinity, onTick: n => n >= timeout && w.setPage(false) });
        const r = await recoverDrop(budget, w.deps, 'no tick for ~18 ticks', AT);
        expect(r.outcome).toBe('relogged');
        expect(named(w.calls)).toEqual(['pause watchdog', 'login']);
        const loginTick = Number(w.calls.find(c => c.startsWith('login@'))!.split('@')[1]);
        expect(loginTick).toBe(timeout);
        expect(budget.entries().map(e => e.kind)).toEqual(['unplanned']);
    });

    test('a closed socket (the page reads out at once) is relogged at once, not after the window', async () => {
        const budget = new RelogBudget(dir());
        const w = world({ page: true, advanced: () => false, backAt: Infinity, onTick: n => n >= 2 && w.setPage(false) });
        expect((await recoverDrop(budget, w.deps, 'page out of game', AT)).outcome).toBe('relogged');
        expect(w.calls.filter(c => c.startsWith('login@'))).toEqual(['login@2']);
        const out = world({ page: false });
        expect((await recoverDrop(new RelogBudget(dir()), out.deps, 'page out of game', AT)).outcome).toBe('relogged');
        expect(out.calls).toEqual(['pause watchdog', 'login@0']);
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
