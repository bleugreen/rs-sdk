import { describe, expect, test } from 'bun:test';
import type { ActionResult } from '../../sdk/types';
import { baseState, FakeSdk, flush, type SentAction } from './fake-sdk';
import { awaitProgram, marksSince, overBudgetMeta, probeInPage, ProgramError, programCounters, type ProgramStatus, runProgram, startProgram } from './programs';
import { peek } from './fake-ticks';
import { sleep, TickPeriod } from './wait';

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
    return { runId: 1, name: 'x', phase: 'running', params: {}, startedTick: 100, tick: 100, progressTick: 100, counters: {}, gauges: {}, marks: {}, packets: 0, deferred: 0, skippedTicks: 0, maxTickMs: 0, frames: frames(), publish: frames(), react: { n: 0, p50: 0, p90: 0, max: 0 }, loops: { last: 0, p10Last10s: 0, min: 0 }, ...p };
}

function frames() {
    return { n: 0, p50: 0, p90: 0, max: 0, underHalfT: 0, overSevenSixthsT: 0, catchUps: 0, catchUpsLastMinute: 0, catchUpsPerMinute: 0, T: 300, TSource: 'driver' as const };
}

describe('speedrun programs', () => {
    test('start sends one program action over the relay', async () => {
        const sdk = new PageSdk(baseState());
        const s = await startProgram(sdk, 'knife-cycle', { method: 'fly', successes: 100 });
        expect(sdk.actions).toEqual([{ type: 'program', op: 'start', name: 'knife-cycle', params: { method: 'fly', successes: 100 }, reason: 'speedrun' }]);
        expect(s.runId).toBe(1);
    });

    test('marksSince returns the stamps a poller has not seen, and what it lost', () => {
        const at = (count: number, ticks: number[]) => status({ marks: { successes: { count, ticks } } });
        expect(marksSince(null, 'successes', 0)).toEqual({ count: 0, ticks: [], missed: 0 });
        let r = marksSince(at(2, [103, 106]), 'successes', 0);
        expect(r).toEqual({ count: 2, ticks: [103, 106], missed: 0 });
        r = marksSince(at(2, [103, 106]), 'successes', r.count);
        expect(r).toEqual({ count: 2, ticks: [], missed: 0 });
        r = marksSince(at(4, [103, 106, 109, 112]), 'successes', r.count);
        expect(r).toEqual({ count: 4, ticks: [109, 112], missed: 0 });
        // the window holds 2 here; 5 new stamps since the last poll lose 3
        expect(marksSince(at(9, [124, 127]), 'successes', 4)).toEqual({ count: 9, ticks: [124, 127], missed: 3 });
    });

    test('a refused start throws with the page message', async () => {
        const sdk = new PageSdk(baseState());
        sdk.reply = () => ({ success: false, message: 'bad parameters: give successes' });
        await expect(startProgram(sdk, 'knife-cycle')).rejects.toThrow(/give successes/);
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

    test('the default stale bound is 20 ticks of the observed period when it is longer than nominal', async () => {
        const saved = process.env.SPEEDRUN_TICK_MS;
        process.env.SPEEDRUN_TICK_MS = '2';
        try {
            const sdk = new PageSdk(baseState());
            sdk.runId = 1;
            const period = new TickPeriod();
            for (let k = 0; k <= 40; k++) period.see(k, k * 100);
            const p = awaitProgram(sdk, 1, { period });
            sdk.publish({});
            await sleep(20 * 2 + 20); // past 20 nominal ticks: still waiting
            expect(await peek(p)).toBeUndefined();
            sdk.publish({ phase: 'done' });
            expect((await p).phase).toBe('done');
        } finally {
            if (saved === undefined) delete process.env.SPEEDRUN_TICK_MS;
            else process.env.SPEEDRUN_TICK_MS = saved;
        }
    });

    test('maxTicks gives up on a run still going after that many ticks, but not on one that ends on the last', async () => {
        const sdk = new PageSdk(baseState());
        sdk.runId = 1;
        const p = awaitProgram(sdk, 1, { maxTicks: 3 });
        for (let i = 0; i < 4; i++) sdk.publish({});
        await expect(p).rejects.toThrow(/still running after 3 ticks/);
        const q = awaitProgram(sdk, 1, { maxTicks: 3 });
        for (let i = 0; i < 3; i++) sdk.publish({});
        sdk.publish({ phase: 'done' });
        expect((await q).phase).toBe('done');
    });

    test('probeInPage summarizes the page trials like the relay probe', async () => {
        const sdk = new PageSdk(baseState());
        const p = probeInPage(sdk, { trials: 4 });
        await flush();
        sdk.publish({ name: 'probe', phase: 'done', result: { trials: 4, latencies: [1, 1, 2, 1], lost: 0, ticks: 6, tickMs: [300, 301, 460, 120] } });
        const r = await p;
        expect(r).toMatchObject({ path: 'direct', source: 'in-page', trials: 4, onTime: 3, mode: 1, modeFraction: 0.75, tickArrivals: [0, 300, 601, 1061, 1181] });
        // the page's tick gaps are scored like any probe's arrivals: 460 then 120 is a catch-up
        expect(r.steadiness).toMatchObject({ n: 4, max: 460, catchUps: 1 });
        expect(sdk.actions[0]).toMatchObject({ op: 'start', name: 'probe', params: { trials: 4, maxWait: 8 } });
    });
});

describe('overBudgetMeta', () => {
    test("a program row's meta carries overBudget only when the page counted any", () => {
        expect(overBudgetMeta({ counters: { overBudget: 3, actions: 9 } })).toEqual({ overBudget: 3 });
        expect(overBudgetMeta({ counters: { actions: 9 } })).toEqual({});
        expect(overBudgetMeta({ counters: { overBudget: 0 } })).toEqual({});
        expect(overBudgetMeta(null)).toEqual({});
        expect(overBudgetMeta(undefined)).toEqual({});
    });
});
