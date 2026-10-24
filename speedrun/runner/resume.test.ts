import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { BotWorldState, PlayerState } from '../../sdk/types';
import { baseState, FakeSdk, runToggleServer } from '../lib/fake-sdk';
import { IF_RUN_ON, runIsOn } from '../lib/run-mode';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ALREADY_LOGGED_IN, LoginRefused, type Session } from '../lib/session';
import { recoverDrop, type DropRelogDeps } from './drop-relog';
import { RelogBudget } from './relog-budget';
import { TickLog } from '../lib/ticks';
import { sleep, TickPeriod, waitUntil } from '../lib/wait';
import { FencedError } from './fence';
import { awaitScene } from '../lib/wait';
import { journalProbeName } from '../lib/quests';
import {
    DROP_STEP,
    LOST_AFTER_TICKS,
    moduleProbes,
    Observation,
    RESUME_STEP,
    ResumeError,
    resolveResume,
    runResumable,
    sessionLink,
    stepProbes,
    type Link,
} from './resume';
import type { RunnerSession, Step } from './step';
import { tutorialSkip } from '../skills/start';

const prevTick = process.env.SPEEDRUN_TICK_MS;
beforeAll(() => { process.env.SPEEDRUN_TICK_MS = '5'; });
afterAll(() => { if (prevTick === undefined) delete process.env.SPEEDRUN_TICK_MS; else process.env.SPEEDRUN_TICK_MS = prevTick; });

// A toy manifest over a toy world: walk to the rocks (x=10), mine to level 5,
// walk to the bank (x=20), then a quest whose stage only a journal probe shows.
type C = { trace: string[]; fenced: number };

const mining = (s: BotWorldState) => s.skills.find(k => k.name === 'Mining')?.baseLevel ?? 1;
const x = (s: BotWorldState) => s.player?.x ?? 0;
const world = (lvl: number, px: number, tick = 0): Partial<BotWorldState> => ({
    tick, inGame: true,
    skills: [{ name: 'Mining', level: lvl, baseLevel: lvl, experience: lvl * 100 }],
    player: { name: 'lab', x: px, z: 0, worldX: px, worldZ: 0, level: 0 } as PlayerState,
});

function manifest(journal: { stage: string }): Step<C>[] {
    const mineLoop = (label: string) => async ({ sdk, c }: { sdk: RunnerSession['sdk']; c: C }) => {
        c.trace.push(label);
        while (mining(sdk.getState()!) < 5) {
            const t = sdk.getState()!.tick;
            try {
                await sdk.sendClickComponent(1);
            } catch (e) {
                if (e instanceof FencedError) c.fenced++;
                throw e;
            }
            await waitUntil(sdk, s => s.tick > t, { maxTicks: 3 });
        }
    };
    return [
        { name: 'walk-to-rocks', preconditions: s => x(s) < 10 || `at x=${x(s)}`, run: async ({ sdk, c }) => { c.trace.push('walk'); (sdk as unknown as FakeSdk).push(world(mining(sdk.getState()!), 10, sdk.getState()!.tick)); }, postconditions: s => x(s) === 10 || 'not at the rocks', logoutSafe: true },
        {
            name: 'mine-to-5', preconditions: s => x(s) === 10 || 'not at the rocks', run: mineLoop('mine:run'), resume: mineLoop('mine:resume'),
            postconditions: s => mining(s) >= 5 || 'below 5', logoutSafe: true,
            done: o => mining(o.state) >= 5,
            inProgress: o => x(o.state) === 10 && mining(o.state) > 1,
        },
        { name: 'walk-to-bank', preconditions: s => x(s) === 10 || 'not at the rocks', run: async ({ sdk, c }) => { c.trace.push('bank'); (sdk as unknown as FakeSdk).push(world(mining(sdk.getState()!), 20, sdk.getState()!.tick)); }, postconditions: () => true, logoutSafe: true },
        {
            name: 'quest', preconditions: s => x(s) === 20 || 'not at the bank', run: async ({ c }) => { c.trace.push('quest'); journal.stage = 'complete'; }, postconditions: () => true, logoutSafe: true,
            done: o => o.probed.journal === 'complete', probes: ['journal'],
        },
    ];
}

function observe(state: Partial<BotWorldState>, journal: string, calls: string[]): Observation {
    const probes = { journal: async () => { calls.push('probe'); return journal; } };
    return new Observation(baseState(state), probes, {} as RunnerSession);
}

describe('resolveResume', () => {
    const steps = manifest({ stage: '' });
    const c: C = { trace: [], fenced: 0 };

    test('a fresh account starts at the first step', async () => {
        const calls: string[] = [];
        const p = await resolveResume(steps, observe(world(1, 0), 'not started', calls), c);
        expect([p.index, p.mode, p.firstUndone, p.lastDone]).toEqual([0, 'run', 1, -1]);
        expect(calls).toEqual([]); // the journal probe is not needed to decide this
    });

    test('mid-Mining at the rocks resumes Mining through its resume handler', async () => {
        const p = await resolveResume(steps, observe(world(3, 10), 'x', []), c);
        expect([p.index, p.mode, p.step]).toEqual([1, 'resume', 'mine-to-5']);
    });

    test('a transient whose effect is already there is skipped; the probe runs once, only when needed', async () => {
        const calls: string[] = [];
        const p = await resolveResume(steps, observe(world(5, 20), 'started', calls), c);
        expect([p.index, p.mode, p.lastDone, p.firstUndone]).toEqual([3, 'run', 1, 3]);
        expect(calls).toEqual(['probe']);
    });

    test('the latest step that can start wins: Mining done, still at the rocks, so the walk to the bank', async () => {
        const p = await resolveResume(steps, observe(world(5, 10), 'started', []), c);
        expect([p.index, p.step]).toEqual([2, 'walk-to-bank']);
    });

    test('every milestone done is finished', async () => {
        const p = await resolveResume(steps, observe(world(5, 20), 'complete', []), c);
        expect(p.mode).toBe('finished');
    });

    test('nothing can start: stop for the operator with every reason', async () => {
        const err = await resolveResume(steps, observe(world(1, 50), 'x', []), c).catch(e => e);
        expect(err).toBeInstanceOf(ResumeError);
        expect((err as ResumeError).candidates).toEqual([{ step: 'mine-to-5', why: 'not at the rocks' }, { step: 'walk-to-rocks', why: 'at x=50' }]);
    });
});

/**
 * A fake client that can drop and come back: ticks every 2 ms while online; a
 * mine click raises Mining by one on the next tick. `drop()` stops it and
 * publishes inGame false; `restore(lvl)` comes back on a new session with the
 * tick counter reset and Mining rolled back to the last checkpoint.
 */
function droppingClient(start: Partial<BotWorldState>) {
    const sdk = new FakeSdk(baseState(start));
    const session = { sdk, bot: {}, name: 'lab', sessionId: 1 } as unknown as RunnerSession & { sessionId: number };
    let online = true;
    let detected = false;
    let clicks = 0;
    let offlineSends = 0;
    sdk.onSend = a => {
        // A send between the drop and its detection goes into the dead socket and
        // cannot be fenced; one after detection would be the abandoned attempt's.
        if (!online && detected) offlineSends++;
        if (a.method === 'sendClickComponent' && a.args[0] === 1) clicks++;
    };
    const timer = setInterval(() => {
        if (!online) return;
        const gain = clicks > 0 ? 1 : 0;
        clicks = 0;
        sdk.tick(s => ({ skills: [{ name: 'Mining', level: mining(s) + gain, baseLevel: mining(s) + gain, experience: 0 }] }));
    }, 2);
    const link: Link = {
        isLost: () => !online,
        lost: async signal => {
            while (!signal.aborted) {
                if (!online) {
                    detected = true;
                    return 'client out of game';
                }
                await sleep(2);
            }
            return 'stopped';
        },
        restored: async () => {
            while (!online) await sleep(2);
            await sleep(10);
        },
    };
    return {
        sdk, session, link,
        get offlineSends() { return offlineSends; },
        drop() { online = false; sdk.push({ inGame: false }); },
        restore(lvl: number) {
            session.sessionId++;
            sdk.push({ ...world(lvl, 10, 0) });
            online = true;
            detected = false;
        },
        stop() { clearInterval(timer); },
    };
}

describe('runResumable', () => {
    test('a client that drops mid-step comes back rolled back, and the manifest resumes at that step', async () => {
        const journal = { stage: 'not started' };
        const steps = manifest(journal);
        const client = droppingClient(world(1, 0, 0));
        const c: C = { trace: [], fenced: 0 };
        const log = TickLog.memory('t');
        let dropped = false;
        // Drop when Mining reaches 3; come back 100 ms later at the checkpointed level 2.
        client.sdk.onStateUpdate(s => {
            if (!dropped && s.inGame && mining(s) >= 3) {
                dropped = true;
                queueMicrotask(() => client.drop());
                setTimeout(() => client.restore(2), 100);
            }
        });
        const events: string[] = [];
        const r = await runResumable(client.session, steps, {
            log, c, link: client.link, shouldStop: () => false,
            probes: { journal: async () => journal.stage },
            onEvent: e => events.push(e.kind === 'resume' ? `resume ${e.point.step} ${e.point.mode}` : e.kind),
        });
        await sleep(120); // let the abandoned attempt reach its own backstop
        client.stop();

        expect(r.drops).toBe(1);
        expect(events).toEqual(['resume walk-to-rocks run', 'drop', 'restored', 'resume mine-to-5 resume']);
        expect(c.trace).toEqual(['walk', 'mine:run', 'mine:resume', 'bank', 'quest']);
        expect(mining(client.sdk.getState()!)).toBe(5);
        // Nothing was sent between the drop's detection and the restore, and the
        // abandoned attempt's later sends were refused.
        expect(client.offlineSends).toBe(0);
        expect(c.fenced).toBeGreaterThanOrEqual(1);
        const kinds = log.rows.map(row => row.step).filter(s => s === RESUME_STEP || s === DROP_STEP);
        expect(kinds).toEqual([RESUME_STEP, DROP_STEP, RESUME_STEP]);
        expect(log.rows.find(row => row.step === 'mine-to-5' && row.meta?.resumed)).toBeDefined();
    });

    describe('with the drop recovery, a login refused as already logged in (the server still holding the dropped player)', () => {
        /**
         * runResumable over droppingClient with recoverDrop as its recover: the page reads the
         * client's own inGame, the first `refusals` logins are refused with reply 5, the next one
         * restores the client at the checkpointed Mining level 2. Waits advance a fake wall clock.
         */
        async function dropAndRelog(refusals: number) {
            const journal = { stage: 'not started' };
            const client = droppingClient(world(1, 0, 0));
            const budget = new RelogBudget(mkdtempSync(join(tmpdir(), 'resume-relog-')));
            const log = TickLog.memory('t');
            const c: C = { trace: [], fenced: 0 };
            let clock = 0;
            let logins = 0;
            const deps: DropRelogDeps = {
                pageInGame: async () => client.sdk.getState()?.inGame ?? null,
                worldUp: async () => true,
                gatewayUp: async () => true,
                expectInWorld: () => true,
                login: async () => {
                    if (++logins <= refusals) {
                        throw new LoginRefused(ALREADY_LOGGED_IN, 'Your account is already logged in. Try again in 60 secs...', 1, 'lab: login refused after 1 attempt(s) (reply 5: Your account is already logged in. Try again in 60 secs...)');
                    }
                    client.restore(2);
                    return { via: 'page', wallMs: 900 };
                },
                adopt: () => {},
                restored: async () => {},
                waitTicks: async n => {
                    clock += n * 400;
                    await Promise.resolve();
                },
                advanced: () => false,
                pauseWatchdog: () => {},
                resumeWatchdog: () => {},
                now: () => clock,
            };
            let dropped = false;
            client.sdk.onStateUpdate(s => {
                if (!dropped && s.inGame && mining(s) >= 3) {
                    dropped = true;
                    queueMicrotask(() => client.drop());
                }
            });
            const events: string[] = [];
            const run = runResumable(client.session, manifest(journal), {
                log, c, link: client.link, shouldStop: () => false,
                probes: { journal: async () => journal.stage },
                recover: async (reason, at) => void (await recoverDrop(budget, deps, reason, at)),
                onEvent: e => events.push(e.kind === 'resume' ? `resume ${e.point.step} ${e.point.mode}` : e.kind),
            }).then(r => ({ r }), (e: unknown) => ({ e }));
            const out = await run;
            await sleep(20);
            client.stop();
            return { out, events, c, budget, logins, drops: log.rows.filter(row => row.step === DROP_STEP), client };
        }

        test('refused twice, then in: one unplanned relog, one (drop) row, and the step resumes', async () => {
            const t = await dropAndRelog(2);
            expect('r' in t.out && t.out.r.drops).toBe(1);
            expect(t.events).toEqual(['resume walk-to-rocks run', 'drop', 'restored', 'resume mine-to-5 resume']);
            expect(t.c.trace).toEqual(['walk', 'mine:run', 'mine:resume', 'bank', 'quest']);
            expect(t.logins).toBe(3);
            expect(t.budget.entries().map(e => [e.kind, e.by, e.via, e.step])).toEqual([['unplanned', 'run', 'page', 'mine-to-5']]);
            expect(t.budget.entries()[0]!.meta?.alreadyLoggedIn).toMatchObject({ refusals: 2 });
            expect(t.drops).toHaveLength(1);
            expect(t.drops[0]!.meta).toMatchObject({ step: 'mine-to-5', reason: 'client out of game' });
            expect(t.drops[0]!.meta?.failed).toBeUndefined();
        });

        test('refused past the bound: the run fails as before, with its (drop) row on the record and no relog charged', async () => {
            const t = await dropAndRelog(Infinity);
            expect('e' in t.out && (t.out.e as Error).message).toMatch(/past the 8-min bound/);
            expect(t.events).toEqual(['resume walk-to-rocks run', 'drop']);
            expect(t.drops).toHaveLength(1);
            expect(t.drops[0]!.ok).toBe(false);
            expect(t.drops[0]!.meta).toMatchObject({ step: 'mine-to-5', reason: 'client out of game' });
            expect(String(t.drops[0]!.meta?.failed)).toMatch(/^Error: lab: login refused .*past the 8-min bound/);
            expect(t.budget.entries()).toEqual([]);
        });
    });

    test("a step that fails with rs/97's 'page reloaded' after the link is back resumes, it is not a failure", async () => {
        const client = droppingClient(world(1, 10, 0));
        let tries = 0;
        const c: C = { trace: [], fenced: 0 };
        const steps: Step<C>[] = [{
            name: 'program', preconditions: () => true, postconditions: () => true, logoutSafe: false, done: () => false,
            run: async () => {
                if (++tries === 1) throw new Error('program run 3 is not in the page\'s state (page reloaded?)');
                c.trace.push('ran');
            },
        }];
        const r = await runResumable(client.session, steps, { log: TickLog.memory(), c, link: client.link, shouldStop: () => false });
        client.stop();
        expect(r.drops).toBe(1);
        expect(c.trace).toEqual(['ran']);
    });

    test('a failure with the link healthy is thrown, not retried', async () => {
        const client = droppingClient(world(1, 0, 0));
        const steps: Step<C>[] = [{ name: 'a', preconditions: () => true, run: async () => {}, postconditions: () => 'wrong', logoutSafe: false, done: () => false }];
        const p = runResumable(client.session, steps, { log: TickLog.memory(), c: { trace: [], fenced: 0 }, link: client.link, shouldStop: () => false });
        await expect(p).rejects.toThrow('postcondition failed: wrong');
        client.stop();
    });

    test('a session that comes back walking (relaunch, reloaded page) has run turned on before the walk', async () => {
        const journal = { stage: 'not started' };
        const client = droppingClient(world(1, 0, 0));
        const dropping = client.sdk.onSend;
        const serve = runToggleServer(client.sdk);
        client.sdk.onSend = (a, s) => { dropping(a, s); serve(a); };
        const c: C = { trace: [], fenced: 0 };
        const log = TickLog.memory('t');
        let dropped = false;
        let runAtResume = null as boolean | null;
        client.sdk.onStateUpdate(s => {
            if (!dropped && s.inGame && mining(s) >= 3) {
                dropped = true;
                queueMicrotask(() => client.drop());
                // The new login left the toggle off, and nothing called login() to fix it.
                setTimeout(() => { client.restore(2); client.sdk.push({ varps: { option_run: 0 } }); }, 100);
            }
        });
        const steps = manifest(journal).map(s => s.name !== 'mine-to-5' ? s : {
            ...s,
            resume: async (ctx: Parameters<Step<C>['run']>[0]) => { runAtResume = runIsOn(ctx.sdk.getState()); return s.resume!(ctx); },
        });
        const r = await runResumable(client.session, steps, { log, c, link: client.link, shouldStop: () => false, probes: { journal: async () => journal.stage } });
        await sleep(120);
        client.stop();
        expect(r.drops).toBe(1);
        expect(runAtResume).toBe(true);
        expect(client.sdk.sent.filter(a => a.method === 'sendClickComponent' && a.args[0] === IF_RUN_ON)).toHaveLength(1);
        const walks = log.rows.filter(row => row.step === RESUME_STEP).map(row => row.meta?.run);
        expect(walks).toEqual([{ on: true, presses: 0 }, { on: true, presses: 1 }]);
        expect(client.offlineSends).toBe(0);
    });

    test('a session that comes back still loading its scene is observed only once sceneReady holds, and no step runs before', async () => {
        const journal = { stage: 'not started' };
        const client = droppingClient(world(1, 0, 0));
        const c: C = { trace: [], fenced: 0 };
        const log = TickLog.memory('t');
        let dropped = false;
        let loadingTicks = -1;
        const sendsWhileLoading: string[] = [];
        const dropping = client.sdk.onSend;
        client.sdk.onSend = (a, s) => {
            dropping(a, s);
            if (s.getState()?.sceneReady === false) sendsWhileLoading.push(a.method);
        };
        client.sdk.onStateUpdate(s => {
            if (!dropped && s.inGame && mining(s) >= 3) {
                dropped = true;
                queueMicrotask(() => client.drop());
                setTimeout(() => { client.restore(2); client.sdk.push({ sceneReady: false }); loadingTicks = 0; }, 100);
            }
            // The scene finishes loading 20 ticks after the login (link.restored itself waits ~5).
            if (loadingTicks >= 0 && s.sceneReady === false && ++loadingTicks > 20) queueMicrotask(() => client.sdk.push({ sceneReady: true }));
        });
        let readyAtResume = null as boolean | null;
        let observedReady = null as boolean | undefined | null;
        const steps = manifest(journal).map(s => s.name !== 'mine-to-5' ? s : {
            ...s,
            resume: async (ctx: Parameters<Step<C>['run']>[0]) => {
                readyAtResume = ctx.sdk.getState()!.sceneReady !== false;
                observedReady = ctx.observed?.state.sceneReady;
                return s.resume!(ctx);
            },
        });
        const r = await runResumable(client.session, steps, { log, c, link: client.link, shouldStop: () => false, probes: { journal: async () => journal.stage } });
        await sleep(120);
        client.stop();
        expect(r.drops).toBe(1);
        expect(readyAtResume).toBe(true);
        expect(observedReady).toBe(true);
        expect(sendsWhileLoading).toEqual([]);
        const scenes = log.rows.filter(row => row.step === RESUME_STEP).map(row => row.meta?.scene as { ready: boolean; ticks: number });
        expect(scenes[0]).toEqual({ ready: true, ticks: 0 });
        expect(scenes[1]!.ready).toBe(true);
        expect(scenes[1]!.ticks).toBeGreaterThanOrEqual(10);
    });

    test('awaitScene: an older client without sceneReady counts as ready at once; a scene that never loads gives up at the bound', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1 }));
        expect(await awaitScene(sdk as unknown as RunnerSession['sdk'], 5)).toEqual({ ready: true, ticks: 0 });
        sdk.push({ sceneReady: false });
        const timer = setInterval(() => sdk.tick(), 2);
        const r = await awaitScene(sdk as unknown as RunnerSession['sdk'], 5);
        clearInterval(timer);
        expect(r.ready).toBe(false);
        expect(r.ticks).toBeGreaterThan(5);
    });

    test('a scene that never loads within the bound is walked anyway, tagged ready: false, not thrown', async () => {
        const client = droppingClient({ ...world(5, 20, 0), sceneReady: false });
        const log = TickLog.memory('t');
        const r = await runResumable(client.session, manifest({ stage: 'complete' }), {
            log, c: { trace: [], fenced: 0 }, link: client.link, shouldStop: () => false, sceneMaxTicks: 3, probes: { journal: async () => 'complete' },
        });
        client.stop();
        expect(r.points[0]?.mode).toBe('finished');
        const scene = log.rows.find(row => row.step === RESUME_STEP)?.meta?.scene as { ready: boolean; ticks: number };
        expect(scene.ready).toBe(false);
        expect(scene.ticks).toBeGreaterThan(3);
    });

    test('the operator --from overrides only the first walk', async () => {
        const client = droppingClient(world(5, 20, 0));
        const journal = { stage: 'complete' };
        const c: C = { trace: [], fenced: 0 };
        const r = await runResumable(client.session, manifest(journal), { log: TickLog.memory(), c, link: client.link, shouldStop: () => false, from: 'quest', probes: { journal: async () => journal.stage } });
        client.stop();
        // The walk would have said 'finished' (the journal reads complete); --from wins once.
        expect(c.trace).toEqual(['quest']);
        expect(r.points[0]?.reason).toBe('operator --from');
    });

    describe("S00 on a re-run whose first frame carries no player (rs/562 D)", () => {
        const LUMBRIDGE = { name: 'lab', x: 3222, z: 3218, worldX: 3222, worldZ: 3218, level: 0 } as PlayerState;
        const chain = (trace: string[]): Step<C>[] => [
            tutorialSkip as Step<C>,
            { name: 'next', logoutSafe: true, preconditions: s => (s.player ? true : 'no player'), postconditions: () => true, run: async () => void trace.push('next'), done: () => false },
        ];

        test('the walk waits for the player, then reads S00 done and starts after it', async () => {
            const client = droppingClient({ tick: 0, inGame: true, player: null });
            client.sdk.onStateUpdate(s => {
                if (!s.player && s.tick >= 3) queueMicrotask(() => client.sdk.push({ player: LUMBRIDGE }));
            });
            const c: C = { trace: [], fenced: 0 };
            const log = TickLog.memory('t');
            const r = await runResumable(client.session, chain(c.trace), { log, c, link: client.link, shouldStop: () => false });
            client.stop();
            expect(r.points.map(p => [p.step, p.mode, p.lastDone])).toEqual([['next', 'run', 0]]);
            expect(c.trace).toEqual(['next']);
            const player = log.rows.find(row => row.step === RESUME_STEP)?.meta?.player as { ready: boolean; ticks: number };
            expect(player.ready).toBe(true);
            expect(player.ticks).toBeGreaterThanOrEqual(3);
        });

        test('a player that never comes: the wait ends at its bound in observed ticks and the walk observes anyway', async () => {
            const client = droppingClient({ tick: 0, inGame: true, player: null });
            const log = TickLog.memory('t');
            const p = runResumable(client.session, chain([]), { log, c: { trace: [], fenced: 0 }, link: client.link, shouldStop: () => false, playerMaxTicks: 8 });
            await expect(p).rejects.toThrow(ResumeError);
            await expect(p).rejects.toThrow('S00 tutorial skip: not in game');
            client.stop();
            expect(client.sdk.getState()!.tick).toBeGreaterThan(8);
        });
    });
});

describe('sessionLink', () => {
    function fakeSession() {
        const sdk = new FakeSdk(baseState({ tick: 1 }));
        const s = { name: 'lab', client: 'lite', sdk, child: {}, childExit: null as number | null, expectInWorld: true, lastAdvanceAt: Date.now() } as unknown as Session;
        return { s, sdk };
    }

    test('lost on a lite exit, restored on an advancing tick after it', async () => {
        const { s, sdk } = fakeSession();
        const link = sessionLink(s, { pollMs: 2 });
        const ac = new AbortController();
        const lost = link.lost(ac.signal);
        (s as { childExit: number | null }).childExit = 1;
        expect(await lost).toBe('client exited (1)');
        const back = link.restored(1_000);
        await sleep(5);
        (s as { childExit: number | null }).childExit = null;
        const timer = setInterval(() => { sdk.tick(); (s as { lastAdvanceAt: number }).lastAdvanceAt = Date.now(); }, 2);
        await back;
        clearInterval(timer);
        expect(link.isLost()).toBe(false);
    });

    test('a lite exit after an intended logout is not a drop', () => {
        const { s } = fakeSession();
        const link = sessionLink(s, { pollMs: 2 });
        (s as { expectInWorld: boolean }).expectInWorld = false;
        (s as { childExit: number | null }).childExit = 1;
        expect(link.isLost()).toBe(false);
        (s as { expectInWorld: boolean }).expectInWorld = true;
        expect(link.isLost()).toBe(true);
    });

    test('lost when the tick stops for staleTicks; quiet while the account is meant to be out', async () => {
        const { s } = fakeSession();
        const link = sessionLink(s, { staleTicks: 2, pollMs: 2 });
        (s as { lastAdvanceAt: number }).lastAdvanceAt = Date.now() - 50;
        expect(link.isLost()).toBe(true);
        (s as { expectInWorld: boolean }).expectInWorld = false;
        expect(link.isLost()).toBe(false);
    });

    const atTickMs = (ms: number, body: () => Promise<void>) => async () => {
        process.env.SPEEDRUN_TICK_MS = String(ms);
        try {
            await body();
        } finally {
            process.env.SPEEDRUN_TICK_MS = '5';
        }
    };
    const silentFor = (s: Session, ms: number) => ((s as { lastAdvanceAt: number }).lastAdvanceAt = Date.now() - ms);

    for (const t of [300, 400]) {
        test(`at ${t} ms ticks: lost after the same ${LOST_AFTER_TICKS} ticks of silence, and the reason counts them`, atTickMs(t, async () => {
            const { s } = fakeSession();
            (s as { period: TickPeriod }).period = new TickPeriod();
            const link = sessionLink(s);
            silentFor(s, (LOST_AFTER_TICKS - 0.5) * t);
            expect(link.isLost()).toBe(false);
            silentFor(s, (LOST_AFTER_TICKS + 0.5) * t);
            expect(await link.lost(new AbortController().signal)).toMatch(/^no tick for ~18 ticks \(\d+ ms\)$/);
        }));
    }

    test('an observed period slower than nominal (600 against 400 ms) lengthens the bound to 17 observed ticks', atTickMs(400, async () => {
        const { s } = fakeSession();
        const period = new TickPeriod();
        for (let k = 0; k <= 40; k++) period.see(k, k * 600);
        (s as { period: TickPeriod }).period = period;
        const link = sessionLink(s);
        silentFor(s, (LOST_AFTER_TICKS + 0.5) * 400);
        expect(link.isLost()).toBe(false);
        silentFor(s, (LOST_AFTER_TICKS + 0.5) * 600);
        expect(await link.lost(new AbortController().signal)).toMatch(/^no tick for ~18 ticks \(\d+ ms\)$/);
    }));
});

describe('stepProbes', () => {
    const wineBank = async () => ({ wine: 3 });

    test('a module exporting PROBES gives the steps that read them', () => {
        expect(stepProbes([{ name: 'S25c', probes: ['wineBank'] }, { name: 'S25c again', probes: ['wineBank'] }], [{ PROBES: { wineBank } }])).toEqual({ wineBank });
    });

    test('a module without PROBES, whose steps read none, gives none (as before)', () => {
        expect(stepProbes([{ name: 'a' }, { name: 'b', probes: [] }], [{}])).toEqual({});
        expect(moduleProbes({})).toEqual({});
    });

    test("a quest's journal names resolve from lib/quests; a list of names provides no probe itself", () => {
        const name = journalProbeName('dragon');
        expect(moduleProbes({ PROBES: [name] })).toEqual({});
        const p = stepProbes([{ name: 'S17 Dragon Slayer', probes: [name] }], [{ PROBES: [name] }]);
        expect(Object.keys(p)).toEqual([name]);
        expect(typeof p[name]).toBe('function');
    });

    test('only the probes a step reads; one nothing provides refuses, naming it and its step', () => {
        expect(stepProbes([], [{ PROBES: { wineBank } }])).toEqual({});
        expect(() => stepProbes([{ name: 'S25c', probes: ['wineBank'] }, { name: 'q', probes: ['journal:nosuchquest'] }], [{}])).toThrow(
            'no probe for "wineBank" (S25c), "journal:nosuchquest" (q)'
        );
    });
});
