import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { BotWorldState, PlayerState } from '../../sdk/types';
import { baseState, FakeSdk, runToggleServer } from './fake-sdk';
import { ensureRun, ensureRunOn, IF_RUN_OFF, IF_RUN_ON, RUN_PRESSES, RunToggleError, runIsOn } from './run-mode';

const prevTick = process.env.SPEEDRUN_TICK_MS;
beforeAll(() => { process.env.SPEEDRUN_TICK_MS = '5'; });
afterAll(() => { if (prevTick === undefined) delete process.env.SPEEDRUN_TICK_MS; else process.env.SPEEDRUN_TICK_MS = prevTick; });

const LUMBRIDGE = { worldX: 3222, worldZ: 3222, runEnergy: 10_000 } as PlayerState;
const TUTORIAL_ISLAND = { worldX: 3094, worldZ: 3106, runEnergy: 10_000 } as PlayerState;

/** A client in the world that ticks every 2 ms; `run` is the published option_run (undefined: not published). */
function client(run: number | undefined, over: Partial<BotWorldState> = {}, ignore = 0) {
    const sdk = new FakeSdk(baseState({ tick: 10, player: LUMBRIDGE, varps: run === undefined ? undefined : { option_run: run }, ...over }));
    sdk.onSend = runToggleServer(sdk, { ignore });
    const timer = setInterval(() => sdk.tick(), 2);
    const presses = () => sdk.sent.filter(a => a.method === 'sendClickComponent').map(a => a.args[0]);
    return { sdk, presses, stop: () => clearInterval(timer) };
}

describe('ensureRun', () => {
    test('already on: nothing is pressed (the button would close an open modal)', async () => {
        const c = client(1);
        expect(await ensureRunOn(c.sdk)).toEqual({ on: true, presses: 0 });
        c.stop();
        expect(c.presses()).toEqual([]);
    });

    test('off after a login: one press of run on, confirmed from the published varp', async () => {
        const c = client(0);
        expect(await ensureRunOn(c.sdk)).toEqual({ on: true, presses: 1 });
        c.stop();
        expect(c.presses()).toEqual([IF_RUN_ON]);
        expect(runIsOn(c.sdk.getState())).toBe(true);
    });

    test('off on request presses run off', async () => {
        const c = client(1);
        expect(await ensureRun(c.sdk, false)).toEqual({ on: false, presses: 1 });
        c.stop();
        expect(c.presses()).toEqual([IF_RUN_OFF]);
    });

    test('a press the server ignored (busy player) is sent once more', async () => {
        const c = client(0, {}, 1);
        expect(await ensureRunOn(c.sdk)).toEqual({ on: true, presses: 2 });
        c.stop();
        expect(c.presses()).toEqual([IF_RUN_ON, IF_RUN_ON]);
    });

    test('still off after the re-send: ensureRunOn records and warns, naming the energy and the busy rule', async () => {
        const c = client(0, {}, Infinity);
        const warned: string[] = [];
        const r = await ensureRunOn(c.sdk, m => warned.push(m));
        c.stop();
        expect(r).toMatchObject({ on: false, presses: RUN_PRESSES });
        expect(r.reason).toContain(`run did not turn on after ${RUN_PRESSES} presses`);
        expect(r.reason).toContain('run energy 10000');
        expect(r.reason).toContain('p_finduid');
        expect(warned).toHaveLength(1);
        expect(warned[0]).toContain(r.reason!);
        expect(c.presses()).toEqual([IF_RUN_ON, IF_RUN_ON]);
    });

    test('still off after the re-send: ensureRun (the lab opt-out) throws a RunToggleError', async () => {
        const c = client(1, {}, Infinity);
        const err = await ensureRun(c.sdk, false).catch(e => e);
        c.stop();
        expect(err).toBeInstanceOf(RunToggleError);
        expect(err.message).toContain(`run did not turn off after ${RUN_PRESSES} presses`);
        expect(c.presses()).toEqual([IF_RUN_OFF, IF_RUN_OFF]);
    });

    test('on Tutorial Island the controls tab is hidden: unavailable, nothing pressed', async () => {
        const c = client(0, { player: TUTORIAL_ISLAND });
        expect(await ensureRunOn(c.sdk)).toEqual({ on: false, presses: 0, unavailable: 'tutorial-island' });
        c.stop();
        expect(c.presses()).toEqual([]);
    });

    test('a client that does not publish option_run cannot be confirmed: recorded and warned, nothing pressed', async () => {
        const c = client(undefined);
        const warned: string[] = [];
        const r = await ensureRunOn(c.sdk, m => warned.push(m));
        expect(r).toMatchObject({ on: null, presses: 0 });
        expect(r.reason).toContain('does not publish varps.option_run');
        expect(warned).toHaveLength(1);
        await expect(ensureRun(c.sdk, false)).rejects.toThrow('does not publish varps.option_run');
        c.stop();
        expect(c.presses()).toEqual([]);
    });

    test('out of the world is a fault for both (a caller bug)', async () => {
        const c = client(0, { inGame: false });
        await expect(ensureRunOn(c.sdk, () => {})).rejects.toThrow('not in the world');
        await expect(ensureRun(c.sdk, false)).rejects.toThrow('not in the world');
        c.stop();
    });

    test('runIsOn reads the varp', () => {
        expect(runIsOn(baseState({ varps: { option_run: 1 } }))).toBe(true);
        expect(runIsOn(baseState({ varps: { option_run: 0 } }))).toBe(false);
        expect(runIsOn(baseState({ varps: { qp: 3 } }))).toBe(null);
        expect(runIsOn(null)).toBe(null);
    });
});
