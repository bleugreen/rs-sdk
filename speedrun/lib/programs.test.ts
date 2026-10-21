import { describe, expect, test } from 'bun:test';
import type { ActionResult } from '../../sdk/types';
import { baseState, FakeSdk, flush, type SentAction } from './fake-sdk';
import { awaitProgram, probeInPage, ProgramError, programCounters, type ProgramStatus, runProgram, startProgram } from './programs';

/** A FakeSdk with the relay the page answers: records program actions, replies like ProgramRuntime.command. */
class PageSdk extends FakeSdk {
    readonly actions: Array<Record<string, unknown>> = [];
    runId = 0;
    reply: (a: Record<string, unknown>) => ActionResult = a => {
        if (a.op !== 'start') return { success: true, message: 'ok', data: null };
        this.runId++;
        return { success: true, message: 'started', data: status({ runId: this.runId, name: String(a.name), params: (a.params as Record<string, unknown>) ?? {} }) };
    };
    /** FakeSdk records its typed sends through here too; a `program` action is the page relay. */
    override sendAction(a: SentAction | Record<string, unknown>): Promise<ActionResult> {
        if ((a as { type?: unknown }).type !== 'program') return super.sendAction(a as SentAction);
        this.actions.push(a as Record<string, unknown>);
        return Promise.resolve(this.reply(a as Record<string, unknown>));
    }
    publish(p: Partial<ProgramStatus> | null) {
        this.tick(s => ({ program: p === null ? null : status({ runId: this.runId, ...p }) }) as never);
    }
}

function status(p: Partial<ProgramStatus>): ProgramStatus {
    return { runId: 1, name: 'x', phase: 'running', params: {}, startedTick: 100, tick: 100, progressTick: 100, counters: {}, gauges: {}, packets: 0, deferred: 0, skippedTicks: 0, maxTickMs: 0, frames: frames(), publish: frames(), react: { n: 0, p50: 0, p90: 0, max: 0 }, loops: { last: 0, p10Last10s: 0, min: 0 }, ...p };
}

function frames() {
    return { n: 0, p50: 0, p90: 0, max: 0, under150: 0, over350: 0, catchUps: 0, catchUpsLastMinute: 0, catchUpsPerMinute: 0 };
}

describe('speedrun programs', () => {
    test('start sends one program action over the relay', async () => {
        const sdk = new PageSdk(baseState());
        const s = await startProgram(sdk, 'knife-cycle', { method: 'fly', rolls: 100 });
        expect(sdk.actions).toEqual([{ type: 'program', op: 'start', name: 'knife-cycle', params: { method: 'fly', rolls: 100 }, reason: 'speedrun' }]);
        expect(s.runId).toBe(1);
    });

    test('a refused start throws with the page message', async () => {
        const sdk = new PageSdk(baseState());
        sdk.reply = () => ({ success: false, message: 'bad parameters: give rolls' });
        await expect(startProgram(sdk, 'knife-cycle')).rejects.toThrow(/give rolls/);
    });

    test('runProgram resolves on done, reporting progress on the way', async () => {
        const sdk = new PageSdk(baseState());
        const seen: number[] = [];
        const p = runProgram(sdk, 'pickpocket', { rolls: 10 }, { onProgress: s => seen.push(s.counters.rolls ?? 0) });
        await flush();
        sdk.publish({ counters: { rolls: 3 } });
        expect(programCounters(sdk)).toEqual({ rolls: 3 });
        sdk.publish({ counters: { rolls: 10 }, phase: 'done', result: { rollsPerTick: 0.17 } });
        const end = await p;
        expect(end.result).toEqual({ rollsPerTick: 0.17 });
        expect(seen).toEqual([3]);
    });

    test('a fault rejects with the status attached', async () => {
        const sdk = new PageSdk(baseState());
        const p = runProgram(sdk, 'knife-mine', {});
        await flush();
        sdk.publish({ phase: 'fault', fault: 'no live rock at 1,2' });
        const e = await p.catch(x => x);
        expect(e).toBeInstanceOf(ProgramError);
        expect((e as ProgramError).status?.fault).toBe('no live rock at 1,2');
    });

    test('a later run in the page means this one was replaced', async () => {
        const sdk = new PageSdk(baseState());
        const p = awaitProgram(sdk, 1);
        sdk.runId = 2;
        sdk.publish({ name: 'probe' });
        expect((await p).phase).toBe('replaced');
    });

    test('a reloaded page (tick back, run gone) rejects', async () => {
        const sdk = new PageSdk(baseState({ tick: 500 }));
        const p = awaitProgram(sdk, 3);
        sdk.push({ tick: 12, program: null } as never);
        await expect(p).rejects.toThrow(/reloaded/);
    });

    test('a page that stops publishing rejects as wedged', async () => {
        const sdk = new PageSdk(baseState());
        sdk.runId = 1;
        sdk.publish({});
        await expect(awaitProgram(sdk, 1, { staleMs: 20 })).rejects.toThrow(/wedged/);
    });

    test('probeInPage summarizes the page trials like the relay probe', async () => {
        const sdk = new PageSdk(baseState());
        const p = probeInPage(sdk, { trials: 4 });
        await flush();
        sdk.publish({ name: 'probe', phase: 'done', result: { trials: 4, latencies: [1, 1, 2, 1], lost: 0, ticks: 6, tickMs: [300, 301] } });
        const r = await p;
        expect(r).toMatchObject({ path: 'direct', source: 'in-page', trials: 4, onTime: 3, mode: 1, modeFraction: 0.75, publishMs: [300, 301] });
        expect(sdk.actions[0]).toMatchObject({ op: 'start', name: 'probe', params: { trials: 4, maxWait: 8 } });
    });
});
