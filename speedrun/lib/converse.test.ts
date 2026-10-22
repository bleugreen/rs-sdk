import { describe, expect, test } from 'bun:test';
import type { DialogState } from '../../sdk/types';
import { burstTicks, converse, dialogueRuns } from './converse';
import { baseState, FakeSdk, flush } from './fake-sdk';
import { fakeClock, peek, tickEvery, useFakeTicks } from './fake-ticks';
import { IDLE_TICKS, STALLED } from './wait';

const words = (...text: string[]) => text.map((t, id) => ({ id, type: 4, buttonType: 0, option: '', text: t }));
const cont = (pageId: string, text = pageId, isWaiting = false): DialogState => ({
    isOpen: true, isWaiting, pageId, options: [{ index: 1, text: 'Click here to continue', buttonType: 6, componentId: 10 }], allComponents: words(text),
});
const choice = (pageId: string, ...opts: string[]): DialogState => ({
    isOpen: true, isWaiting: false, pageId, options: opts.map((text, i) => ({ index: i + 1, text, buttonType: 1, componentId: 20 + i })),
});
const closed: DialogState = { isOpen: false, options: [], isWaiting: false };

/** A server that shows `pages` in order, one per tick, advancing on any dialogue click. */
function script(sdk: FakeSdk, pages: DialogState[]) {
    let i = 0;
    sdk.onSend = (a, f) => {
        if (!/ClickDialog|clickDialogByText/.test(a.method)) return;
        const cur = f.state!.dialog;
        queueMicrotask(() => {
            f.push({ dialog: { ...cur, isWaiting: true } });
            const next = pages[++i] ?? closed;
            f.tick({ dialog: next });
        });
    };
    sdk.tick({ dialog: pages[0]! });
}

async function settle(sdk: FakeSdk, ticks: number) {
    for (let i = 0; i < ticks; i++) {
        await flush();
        sdk.tick();
    }
}

describe('converse', () => {
    test('answers continues and queued choices in order, then waits out the idle ticks', async () => {
        const sdk = new FakeSdk(baseState({ tick: 10 }));
        const p = converse(sdk as never, [/quest/i, 'yes']);
        script(sdk, [cont('a'), choice('c1', 'Talk about the quest', 'Bye'), cont('b'), choice('c2', 'Yes', 'No'), cont('c')]);
        await settle(sdk, 8);
        const r = await p;
        expect(r).toMatchObject({ ok: true, opened: true, pages: 3, options: 2, levelUps: 0, firstTick: 11 });
        expect(dialogueRuns(r.transcript)).toBe('1c, opt, 1c, opt, 1c');
        expect(r.remaining).toEqual([]);
        expect(sdk.sent.map(s => String(s.args[0]))).toEqual([
            '/^Click here to continue$/', '/^Talk about the quest$/', '/^Click here to continue$/', '/^Yes$/', '/^Click here to continue$/',
        ]);
        expect(r.ticks).toBe(r.endTick - 10);
    });

    test('endTick is the first tick seen closed, not the end of the idle wait', async () => {
        const sdk = new FakeSdk(baseState({ tick: 5, dialog: cont('a') }));
        sdk.onSend = (_a, f) => queueMicrotask(() => f.push({ dialog: cont('a', 'a', true) }));
        const p = converse(sdk as never, [], { idle: 3 });
        await flush();
        sdk.tick(); // 6: still waiting
        sdk.tick({ dialog: closed }); // 7: closed
        sdk.tick();
        sdk.tick();
        sdk.tick(); // 10: closed for 3 ticks
        expect(await p).toMatchObject({ firstTick: 5, endTick: 7, ticks: 2, pages: 1 });
    });

    test('keep: a priority list answers repeated menus', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1 }));
        const p = converse(sdk as never, [/^north/i], { keep: true });
        script(sdk, [choice('m1', 'North', 'South'), choice('m2', 'North', 'South')]);
        await settle(sdk, 6);
        expect(await p).toMatchObject({ options: 2, remaining: [/^north/i] });
    });

    test('an unanswerable choice page throws by default, or stops, or takes the first option', async () => {
        const page = choice('m', 'A', 'B');
        const thrower = new FakeSdk(baseState({ tick: 1, dialog: page }));
        await expect(converse(thrower as never, [/zzz/])).rejects.toThrow(/no choice matches \[A \| B\]/);
        expect(thrower.sent).toEqual([]);

        const stopper = new FakeSdk(baseState({ tick: 1, dialog: page }));
        expect(await converse(stopper as never, [], { unmatched: 'stop' })).toMatchObject({ ok: false, reason: 'no choice for [A | B]' });

        const taker = new FakeSdk(baseState({ tick: 1 }));
        const p = converse(taker as never, [], { unmatched: 'first' });
        script(taker, [page]);
        await settle(taker, 5);
        expect((await p).transcript.at(0)).toMatch(/> A \(default\)$/);
    });

    test('level-up pages are dismissed and counted apart from the conversation', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1 }));
        const p = converse(sdk as never);
        script(sdk, [cont('l', 'Congratulations, you just advanced a Prayer level.'), cont('n', 'Thank you, adventurer.')]);
        await settle(sdk, 6);
        expect(await p).toMatchObject({ pages: 1, levelUps: 1 });
    });

    test('a refused (stale) click is retried on the next page, without consuming the choice', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1 }));
        let refuse = true;
        const orig = sdk.clickDialogByText.bind(sdk);
        sdk.clickDialogByText = async (pat: string | RegExp) => {
            if (refuse) {
                refuse = false;
                queueMicrotask(() => sdk.tick({ dialog: choice('m2', 'Yes', 'No') })); // re-published under a new id
                return { success: false, message: 'stale', reason: 'stale_dialog' } as never;
            }
            return orig(pat);
        };
        const p = converse(sdk as never, [/yes/i], { unmatched: 'stop' });
        sdk.tick({ dialog: choice('m1', 'Yes', 'No') });
        await flush();
        await flush();
        sdk.tick({ dialog: closed });
        await settle(sdk, 4);
        const r = await p;
        expect(r).toMatchObject({ ok: true, options: 1, remaining: [] });
    });

    test('a refusal with no new publication waits instead of spinning on the same state', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, dialog: choice('m', 'Yes', 'No') }));
        let calls = 0;
        sdk.clickDialogByText = async () => {
            if (++calls > 3) throw new Error('retry loop on unchanged state');
            return { success: false, message: 'stale', reason: 'stale_dialog' } as never;
        };
        const p = converse(sdk as never, ['Yes'], { idle: 1 });
        await flush();
        expect(calls).toBe(1);
        sdk.tick({ dialog: closed });
        sdk.tick();
        expect(await p).toMatchObject({ options: 0, remaining: ['Yes'] });
    });

    test('nothing opens: resolves after openTicks with opened false', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1 }));
        const p = converse(sdk as never, [], { openTicks: 2 });
        await settle(sdk, 4);
        expect(await p).toMatchObject({ ok: true, opened: false, ticks: 0, reason: 'no dialogue opened' });
    });

    test('until: over only when the follow-up has landed', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1 }));
        let landed = false;
        const p = converse(sdk as never, [], { idle: 1, until: () => landed });
        script(sdk, [cont('a')]);
        await settle(sdk, 4);
        landed = true;
        await settle(sdk, 2);
        const r = await p;
        expect(r.endTick).toBeGreaterThan(r.firstTick + 3);
    });

    test('closeModals closes a chapter card and waits for it to go', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1 }));
        const p = converse(sdk as never, [], { closeModals: true, idle: 1 });
        script(sdk, [cont('a')]);
        await flush();
        sdk.tick({ modalOpen: true, modalInterface: 6020 });
        await flush();
        expect(sdk.sent.some(s => s.method === 'sendCloseModal')).toBe(true);
        sdk.tick({ modalOpen: false, modalInterface: -1 });
        sdk.tick();
        expect((await p).transcript.some(l => /modal 6020 closed/.test(l))).toBe(true);
    });
});

describe('converse on slow and silent clients', () => {
    useFakeTicks();
    // A page held open (`isWaiting`, as during a p_delay) is never clicked, so ticks alone drive these.
    const held = cont('a', 'a', true);

    test('a 400-tick conversation at 340 ms a tick resolves (136 s, past the old 126 s total budget)', async () => {
        const sdk = new FakeSdk(baseState({ tick: 0 }));
        const p = converse(sdk as never, [], { idle: 3 });
        tickEvery(sdk, 340, 396, { dialog: held });
        tickEvery(sdk, 340, 4, { dialog: closed });
        expect(await p).toMatchObject({ ok: true, opened: true, firstTick: 1, endTick: 397 });
        expect(sdk.state!.tick).toBe(400);
    });

    test('a client that stops publishing ends it IDLE_TICKS x tickMs after the last tick', async () => {
        const sdk = new FakeSdk(baseState({ tick: 0 }));
        const p = converse(sdk as never);
        tickEvery(sdk, 300, 5, { dialog: held });
        fakeClock.advanceTimersByTime(IDLE_TICKS * 300 - 1);
        expect(await peek(p)).toBeUndefined();
        fakeClock.advanceTimersByTime(1);
        expect(await p).toMatchObject({ ok: false, opened: true, reason: STALLED });
    });

    test('maxTicks keeps counting across a relaunch that restarts the tick clock', async () => {
        const sdk = new FakeSdk(baseState({ tick: 100 }));
        const p = converse(sdk as never, [], { maxTicks: 10 });
        tickEvery(sdk, 300, 6, { dialog: held });
        sdk.push({ tick: 0 });
        tickEvery(sdk, 300, 4, { dialog: held });
        expect(await peek(p)).toBeUndefined();
        tickEvery(sdk, 300, 1, { dialog: held });
        expect(await p).toMatchObject({ ok: false, reason: 'timeout' });
    });
});

describe('dialogueRuns / burstTicks', () => {
    test('CONVENTIONS.md notation and the burst estimate', () => {
        const t = ['[1] page: a', '[2] page: b', '[3] level-up', '[4] > Yes', '[5] page: c'];
        expect(dialogueRuns(t)).toBe('2c, opt, 1c');
        expect(burstTicks([...Array(7)].map((_, i) => `[${i}] page: x`))).toBe(2);
        expect(burstTicks(t)).toBe(3);
    });
});
