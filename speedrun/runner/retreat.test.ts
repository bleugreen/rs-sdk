import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { BotWorldState, PlayerState } from '../../sdk/types';
import { runAttempt } from '../lib/attempt';
import { baseState, FakeSdk } from '../lib/fake-sdk';
import { ReservationWatch } from '../lib/host-reservation';
import { LOGOUT_REFUSED_COMBAT, type LogoutResult, type Session } from '../lib/session';
import { TickLog } from '../lib/ticks';
import { sleep, waitUntil } from '../lib/wait';
import { inCombatWindow } from '../lib/world';
import { FencedError } from './fence';
import type { Link } from './resume';
import { RETREAT_MAX_TICKS, RETREAT_STEP } from './retreat';
import type { Step, StepContext } from './step';

// runAttempt's failure path with a scripted state and a fake logout (run.test.ts drives the real
// logoutClean through run.ts, and the death). The state is the host's second S14 death
// (run-20261024-062622): S14 failed at tick 235 on the spot, hp 25 of 38, under the spiders.

const prevTick = process.env.SPEEDRUN_TICK_MS;
beforeAll(() => { process.env.SPEEDRUN_TICK_MS = '5'; });
afterAll(() => { if (prevTick === undefined) delete process.env.SPEEDRUN_TICK_MS; else process.env.SPEEDRUN_TICK_MS = prevTick; });

const FIGHTING = { inCombat: true, targetIndex: 7, targetType: 'npc', lastDamageTick: 235 } as const;
const CLEAR = { inCombat: false, targetIndex: -1, targetType: 'none', lastDamageTick: -1 } as const;
const scored = (combat: PlayerState['combat'], x = 3288, z = 3810) =>
    ({ name: 'lab', worldX: x, worldZ: z, x, z, level: 0, hp: 25, maxHp: 38, isDead: false, lifeId: 1, respawnCount: 0, lastDeathTick: null, combat }) as unknown as PlayerState;

const link: Link = {
    isLost: () => false,
    lost: async signal => { while (!signal.aborted) await sleep(2); return 'stopped'; },
    restored: async () => {},
};

const FAILED = 'FAILED: step "S14 cannon session" precondition failed: Attack 94: the cannon\'s accuracy is the scimitar\'s at Attack 99';

/** S14 refused at its precondition (the first death's shape), with `retreat` when given. */
const s14 = (retreat?: Step<any>['retreat']): Step<any> => ({
    name: 'S14 cannon session', preconditions: () => "Attack 94: the cannon's accuracy is the scimitar's at Attack 99", run: async () => {}, postconditions: () => true,
    logoutSafe: false, startsInCombat: true, ...(retreat ? { retreat } : {}),
});

/**
 * A client ticking every 2 ms, the spiders hitting every tick while `fighting`; the logout records
 * the state it was called on and answers `answer(n)` for the nth call (default: out).
 */
function world(o: { fighting: boolean; answer?: (n: number) => Partial<LogoutResult> }) {
    const sdk = new FakeSdk(baseState({ tick: 235, player: scored(o.fighting ? FIGHTING : CLEAR) }));
    const session = { sdk, bot: {}, name: 'lab', sessionId: 1, expectInWorld: true } as unknown as Session;
    const w = {
        sdk, session, fighting: o.fighting,
        logouts: [] as { tick: number; inWindow: boolean; sent: number }[],
        log: TickLog.memory('retreat'),
    };
    const timer = setInterval(() => sdk.tick((s: BotWorldState) => (w.fighting ? { player: { ...s.player!, combat: { ...FIGHTING, lastDamageTick: s.tick + 1 } } } : {})), 2);
    const logout = async (): Promise<LogoutResult> => {
        const s = sdk.getState()!;
        w.logouts.push({ tick: s.tick, inWindow: inCombatWindow(s), sent: sdk.sent.length });
        session.expectInWorld = false;
        return { ok: true, clickTick: s.tick, lastInWorldTick: s.tick, latencyTicks: 0, wallMs: 0, sends: 1, ...(o.answer?.(w.logouts.length) ?? {}) };
    };
    const dir = mkdtempSync(join(tmpdir(), 'retreat-'));
    const attempt = (step: Step<any>) =>
        runAttempt(session, [step], {
            log: w.log, account: 'lab', link, from: 0, reservation: new ReservationWatch(join(dir, 'none.json')),
            stopAsked: () => false, gateStop: () => null, logout, label: 'run',
        }).finally(() => {
            clearInterval(timer);
            rmSync(dir, { recursive: true, force: true });
        });
    const rows = () => w.log.rows.filter(r => r.step === RETREAT_STEP);
    return Object.assign(w, { attempt, rows });
}

/** A retreat that walks SCORED out of reach on the spot's south line and waits out the combat window. */
const walkOut = (w: { fighting: boolean; sdk: FakeSdk }, calls: number[], logouts: () => number) => async (ctx: StepContext<any>) => {
    calls.push(logouts());
    w.fighting = false;
    w.sdk.state = { ...w.sdk.state!, player: { ...w.sdk.state!.player!, worldX: 3288, worldZ: 3768, x: 3288, z: 3768 } };
    await waitUntil(ctx.sdk, st => !inCombatWindow(st), { maxTicks: 40 });
};

describe('the exit after a failed step that declares retreat (rs/725)', () => {
    test('without retreat, in combat: exactly as before; no logout here (the caller makes it), nothing sent, no row', async () => {
        const w = world({ fighting: true });
        const r = await w.attempt(s14());
        expect(r).toEqual({ outcome: FAILED, code: 1, paused: null });
        expect(w.logouts).toEqual([]);
        expect(w.sdk.sent).toEqual([]);
        expect(w.rows()).toEqual([]);
    });

    test('with retreat, in combat: the retreat runs first, the combat window ends, then one logout; the row and the outcome say it retreated', async () => {
        const w = world({ fighting: true });
        const calls: number[] = [];
        const r = await w.attempt(s14(walkOut(w, calls, () => w.logouts.length)));
        expect(calls).toEqual([0]);
        expect(w.logouts).toHaveLength(1);
        expect(w.logouts[0]!.inWindow).toBe(false);
        expect(r.code).toBe(1);
        expect(r.outcome).toMatch(new RegExp(`^${FAILED.replace(/[()"'.]/g, '\\$&')}; retreated out of reach \\(combat window; \\(3288,3810\\) to \\(3288,3768\\), \\d+ ticks\\), then logged out$`));
        const [row] = w.rows();
        expect(row).toMatchObject({ kind: 'note', ok: true, meta: { step: 'S14 cannon session', why: 'combat window', from: { x: 3288, z: 3810 }, to: { x: 3288, z: 3768 }, logout: { ok: true, sends: 1 } } });
        expect(row!.endTick - row!.startTick).toBeGreaterThanOrEqual(17);
    });

    test('a retreat that throws: the logout is still made, and both are reported', async () => {
        const w = world({ fighting: true });
        const r = await w.attempt(s14(async () => { throw new Error('no path south'); }));
        expect(w.logouts).toHaveLength(1);
        expect(r.outcome).toMatch(/; retreat FAILED \(combat window; \(3288,3810\) to \(3288,3810\), \d+ ticks\): no path south; logged out anyway$/);
        expect(w.rows()).toMatchObject([{ ok: false, error: 'no path south', meta: { why: 'combat window', logout: { ok: true } } }]);
    });

    test('a retreat that overruns its bound: the logout goes ahead at the bound, the retreat is fenced off, and both are reported', async () => {
        const w = world({ fighting: true });
        let fenced = 0;
        const r = await w.attempt(s14(async ctx => {
            for (;;) {
                const t = ctx.sdk.getState()!.tick;
                try {
                    await ctx.sdk.sendWalk(3288, 3700);
                } catch (e) {
                    if (e instanceof FencedError) { fenced++; return; }
                    throw e;
                }
                await waitUntil(ctx.sdk, st => st.tick > t, { maxTicks: 3 });
            }
        }));
        expect(w.logouts).toHaveLength(1);
        expect(r.outcome).toMatch(new RegExp(`; retreat FAILED \\(combat window; .*\\): still walking after its ${RETREAT_MAX_TICKS}-tick bound; logged out anyway$`));
        const [row] = w.rows();
        expect(row).toMatchObject({ ok: false, meta: { timedOut: true, logout: { ok: true } } });
        expect(row!.endTick - row!.startTick).toBeGreaterThanOrEqual(RETREAT_MAX_TICKS);
        // The abandoned walk sends nothing from the logout on: its next click meets the fence.
        await sleep(300);
        expect(w.sdk.sent.slice(w.logouts[0]!.sent).filter(a => a.method === 'sendWalk')).toEqual([]);
        expect(fenced).toBe(1);
    });

    test('a failure out of combat: no retreat runs, one logout, no row', async () => {
        const w = world({ fighting: false });
        const calls: number[] = [];
        const r = await w.attempt(s14(async () => { calls.push(1); }));
        expect(calls).toEqual([]);
        expect(w.logouts).toHaveLength(1);
        expect(r.outcome).toBe(`${FAILED}; logged out`);
        expect(w.rows()).toEqual([]);
        expect(w.sdk.sent).toEqual([]);
    });

    test('out of combat but the logout refused for combat (a hit with the click): the retreat, then a second logout', async () => {
        const w = world({ fighting: false, answer: n => (n === 1 ? { ok: false, reason: LOGOUT_REFUSED_COMBAT } : {}) });
        const calls: number[] = [];
        const r = await w.attempt(s14(walkOut(w, calls, () => w.logouts.length)));
        expect(calls).toEqual([1]);
        expect(w.logouts).toHaveLength(2);
        expect(r.outcome).toMatch(/; retreated out of reach \(logout refused; \(3288,3810\) to \(3288,3768\), \d+ ticks\), then logged out$/);
        expect(w.rows()).toMatchObject([{ ok: true, meta: { why: 'logout refused', logout: { ok: true } } }]);
    });

    test('any other failed logout out of combat is reported as before, with no retreat', async () => {
        const w = world({ fighting: false, answer: () => ({ ok: false, reason: 'still in game after timeout' }) });
        const calls: number[] = [];
        const r = await w.attempt(s14(async () => { calls.push(1); }));
        expect(calls).toEqual([]);
        expect(w.logouts).toHaveLength(1);
        expect(r.outcome).toBe(`${FAILED}; logout NOT confirmed (still in game after timeout)`);
    });
});
