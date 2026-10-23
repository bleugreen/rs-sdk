import { describe, expect, test } from 'bun:test';
import { baseState, FakeSdk } from '../lib/fake-sdk';
import type { LoginResult, RelogResult, Session } from '../lib/session';
import { TickLog } from '../lib/ticks';
import { loginReplyCode, scoredRelogStep, WORLD_FULL, type ScoredRelogDeps } from './scored-relog';
import type { StepContext } from './step';

const relogResult = (o: Partial<RelogResult> = {}): RelogResult => ({ logout: { ok: true } as RelogResult['logout'], loginTick: 5, tickBase: 0, via: 'page', loginWallMs: 1_200, attempts: 1, ...o });
const loginResult = (o: Partial<LoginResult> = {}): LoginResult => ({ wallMs: 900, attempts: 1, via: 'page', tickBase: 0, run: {} as LoginResult['run'], retaliate: {} as LoginResult['retaliate'], ...o });

function setup(deps: (calls: string[], session: Session) => Partial<ScoredRelogDeps>) {
    const sdk = new FakeSdk(baseState({ tick: 50, inGame: true }));
    const session = { sdk, bot: {}, name: 'lab_scored', sessionId: 1, launchedAt: 1_000, client: 'browser', expectInWorld: true } as unknown as Session;
    const log = TickLog.memory('relog-test');
    const calls: string[] = [];
    const ctx = { session, sdk, bot: {}, c: {}, log } as unknown as StepContext<unknown>;
    const sleep = async (ms: number) => void calls.push(`sleep ${ms}`);
    return { session, log, calls, ctx, deps: { sleep, ...deps(calls, session) } };
}

const note = (log: TickLog) => log.rows.find(r => r.kind === 'note' && r.step === 'S21 relog');

describe("SCORED's relog before S21", () => {
    test('one relog through lib/session.ts relog; its note carries how it got in and the login time giverSchedule reads', async () => {
        const t = setup((calls, s) => ({
            relog: async () => {
                calls.push('relog');
                s.launchedAt = 5_000;
                return relogResult();
            },
            login: async () => { throw new Error('no login expected'); },
            replyCode: async () => { throw new Error('no reply read expected'); },
        }));
        const step = scoredRelogStep({ deps: t.deps });
        expect([step.name, step.logoutSafe]).toEqual(['S21 relog', true]);
        await step.run(t.ctx);
        expect(t.calls).toEqual(['relog']);
        expect(note(t.log)).toMatchObject({ ok: true, ticks: 0, meta: { kind: 'scored-relog', via: 'page', attempts: 1, loginWallMs: 1_200, worldFull: 0, loggedInAt: 5_000 } });
    });

    test("a code 7 reply (world full) waits backoff.ts's 60 s and logs in again; it is not a failure", async () => {
        const t = setup((calls, s) => ({
            relog: async () => {
                calls.push('relog');
                s.expectInWorld = false;
                throw new Error('lab_scored: login failed after 6 attempt(s) (timeout, in page)');
            },
            login: async () => {
                calls.push('login');
                s.launchedAt = 7_000;
                s.expectInWorld = true;
                return loginResult({ attempts: 2, wallMs: 3_000 });
            },
            replyCode: async () => (calls.push('reply'), WORLD_FULL),
        }));
        await scoredRelogStep({ deps: t.deps }).run(t.ctx);
        expect(t.calls).toEqual(['relog', 'reply', 'sleep 60000', 'login']);
        expect(note(t.log)).toMatchObject({ ok: true, meta: { worldFull: 1, via: 'page', attempts: 2, loginWallMs: 3_000, loggedInAt: 7_000 } });
    });

    test('any other refusal fails at once with its code, an unreadable reply with the relog error; neither logs in again', async () => {
        for (const [code, want] of [[9, 'login reply 9'], [null, 'login failed after 6 attempt(s)']] as const) {
            const t = setup(calls => ({
                relog: async () => { calls.push('relog'); throw new Error('lab_scored: login failed after 6 attempt(s) (exited, in page)'); },
                login: async () => (calls.push('login'), loginResult()),
                replyCode: async () => code,
            }));
            await expect(scoredRelogStep({ deps: t.deps }).run(t.ctx)).rejects.toThrow(want);
            expect(t.calls).toEqual(['relog']);
            expect(note(t.log)).toMatchObject({ ok: false, meta: { worldFull: 0 } });
        }
    });

    test('a world still full after the retries fails, naming how many', async () => {
        const t = setup(calls => ({
            relog: async () => { calls.push('relog'); throw new Error('full'); },
            login: async () => { calls.push('login'); throw new Error('full'); },
            replyCode: async () => WORLD_FULL,
        }));
        await expect(scoredRelogStep({ deps: t.deps, worldFullRetries: 2 }).run(t.ctx)).rejects.toThrow('the world was full on 3 logins in a row (retried 2 times)');
        expect(t.calls).toEqual(['relog', 'sleep 60000', 'login', 'sleep 60000', 'login']);
    });

    test("the title screen's text names the reply (Client.ts's login messages)", () => {
        expect(loginReplyCode('This world is full. Please use a different world.')).toBe(7);
        expect(loginReplyCode('Unable to connect. Login server offline.')).toBe(8);
        expect(loginReplyCode('Login limit exceeded. Too many connections from your address.')).toBe(9);
        expect(loginReplyCode('The server is being updated. Please wait 1 minute and try again.')).toBe(14);
        expect(loginReplyCode('Login attempts exceeded. Please wait 1 minute and try again.')).toBe(16);
        expect(loginReplyCode('Connecting to server...')).toBeNull();
        expect(loginReplyCode('')).toBeNull();
    });
});
