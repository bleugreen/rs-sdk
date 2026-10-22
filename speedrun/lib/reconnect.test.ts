import { describe, expect, test } from 'bun:test';
import { DemoMonitor, type DemoSample } from './demo-status';
import { FakeSdk } from './fake-sdk';
import { outageStep, reconnectAfterOutage, serverDownProbe, type OutageEvent } from './reconnect';
import type { Session } from './session';

function session(): Session {
    return {
        name: 'srtest', client: 'lite', env: { BOT_USERNAME: 'srtest', PASSWORD: 'x', SERVER: 'localhost:9300' }, sdk: new FakeSdk(),
        sessionId: 1, expectInWorld: true, child: null, childExit: null, lastInWorldTick: 100, lastAdvanceAt: 0, launchedAt: 0,
        ticksSinceProgress: 0, watchdog: null, logPath: '/dev/null',
    } as unknown as Session;
}

/** A clock that only moves when the code under test sleeps. */
function virtualTime(start = 0) {
    let t = start;
    return { now: () => t, sleep: async (ms: number) => { t += ms; } };
}

test('outageStep', () => {
    expect(outageStep({ reachable: false, now: 0, deadline: 10, childExit: null })).toBe('wait');
    expect(outageStep({ reachable: true, now: 0, deadline: 10, childExit: 1 })).toBe('login');
    expect(outageStep({ reachable: true, now: 0, deadline: 10, childExit: 3 })).toBe('give_up');
    expect(outageStep({ reachable: false, now: 10, deadline: 10, childExit: null })).toBe('give_up');
});

describe('reconnectAfterOutage', () => {
    test('the 06:14 shape: ~50 s of no answer, code 8 for ~90 s, then in on the first accepted try', async () => {
        const clock = virtualTime();
        // /playercount: unreachable for the first 50 s, then answering.
        const sample = async (): Promise<DemoSample> => ({ at: clock.now(), players: clock.now() < 50_000 ? null : 12, ms: 1 });
        // Logins refused until 140 s after the drop.
        const tries: number[] = [];
        const login = async () => {
            tries.push(clock.now());
            if (clock.now() < 140_000) throw new Error('login failed after 1 attempt(s) (exited, exit 1)');
        };
        const events: OutageEvent['kind'][] = [];
        const s = session();
        const r = await reconnectAfterOutage(s, { sample, login, ...clock, onEvent: e => events.push(e.kind) });
        expect(r.answerAfterMs).toBe(50_000);
        expect(tries).toEqual([50_000, 60_000, 70_000, 80_000, 90_000, 100_000, 110_000, 120_000, 130_000, 140_000]);
        expect(r).toMatchObject({ attempts: 10, refusals: 9, wallMs: 140_000 });
        expect(events.filter(k => k === 'unreachable')).toHaveLength(10);
        expect(events.slice(-2)).toEqual(['refused', 'in-world']);
        // Logged in at most one retry interval after logins were accepted.
        expect(r.wallMs - 140_000).toBeLessThanOrEqual(10_000);
    });

    test('the login-order gate runs before every attempt', async () => {
        const clock = virtualTime();
        const order: string[] = [];
        await reconnectAfterOutage(session(), {
            ...clock,
            sample: async () => ({ at: clock.now(), players: 5, ms: 1 }),
            beforeLogin: async () => { order.push('gate'); },
            login: async () => { order.push('login'); if (order.length < 4) throw new Error('refused'); },
        });
        expect(order).toEqual(['gate', 'login', 'gate', 'login']);
    });

    test('gives up at the deadline, and at once on an outdated client', async () => {
        const clock = virtualTime();
        const never = reconnectAfterOutage(session(), { ...clock, deadlineMs: 60_000, sample: async () => ({ at: clock.now(), players: null, ms: 1 }) });
        await expect(never).rejects.toThrow(/not back after 60 s/);
        const s = session();
        const outdated = reconnectAfterOutage(s, {
            ...clock, sample: async () => ({ at: clock.now(), players: 3, ms: 1 }),
            login: async (x: Session) => { (x as { childExit: number | null }).childExit = 3; throw new Error('exit 3'); },
        });
        await expect(outdated).rejects.toThrow(/exit 3/);
    });

    test('records our login outcomes on the shared monitor, so the status line shows the outage', async () => {
        const clock = virtualTime(1_000_000);
        const replies: (number | null)[] = [1700, null, 0, 0];
        const mon = new DemoMonitor('o', { file: null, sample: async () => ({ at: clock.now(), players: replies.length ? replies.shift()! : 40, ms: 1 }) });
        await mon.sampleNow(); // up, 1,700
        const down = serverDownProbe(mon);
        expect(await down()).toBe(true); // unreachable
        let n = 0;
        await reconnectAfterOutage(session(), { ...clock, monitor: mon, login: async () => { if (++n < 3) throw new Error('code 8'); } });
        const st = mon.tracker.status();
        expect(st.lastRestart?.refusals).toBe(2);
        expect(st.lastRestart?.loginAt).not.toBeNull();
        expect(st.phase).toBe('recovering');
    });
});
