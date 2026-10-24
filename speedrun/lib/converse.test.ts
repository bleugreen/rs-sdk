import { describe, expect, test } from 'bun:test';
import type { BotWorldState, DialogState, PlayerState } from '../../sdk/types';
import { burstTicks, converse, dialogueRuns, HIT_CLOSE_TICKS, levelUpInterrupt, parseShape, shapeRuns, type ConverseOptions, type Interrupt } from './converse';
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

/**
 * A server for burst tests: dialogue clicks queue up and the test's ticks apply
 * at most 5 of them (the engine's per-tick cap), publishing once per tick. A
 * continue that reaches a choice page is refused and dropped, as the engine does.
 */
function tickServer(sdk: FakeSdk, pages: DialogState[]) {
    let i = 0;
    const owed: Array<'continue' | 'option'> = [];
    sdk.onSend = a => {
        if (a.method === 'sendClickDialog') owed.push('continue');
        else if (a.method === 'clickDialogByText') owed.push(/continue/i.test(String(a.args[0])) ? 'continue' : 'option');
    };
    sdk.tick({ dialog: pages[0]! });
    return {
        async run(ticks: number) {
            for (let t = 0; t < ticks; t++) {
                await flush();
                await flush();
                for (let n = 0; n < 5 && owed.length; n++) {
                    const kind = owed.shift()!;
                    const cur = pages[i];
                    if (!cur) continue;
                    const isChoice = cur.options.some(o => o.buttonType === 1);
                    if (kind === 'continue' && isChoice) continue;
                    i++;
                }
                sdk.tick({ dialog: pages[i] ?? closed });
            }
        },
    };
}

const conts = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => cont(`${prefix}${i + 1}`));
const blindSends = (sdk: FakeSdk) => sdk.sent.filter(s => s.method === 'sendClickDialog' && (s.args[1] as { blind?: boolean } | undefined)?.blind).length;

describe('converse burst mode', () => {
    const pages = () => [...conts('a', 2), choice('c', 'Yes', 'No'), ...conts('b', 7)];

    test('bursts each continue run of the shape and lands on the choice and on the close', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1 }));
        const p = converse(sdk as never, ['Yes'], { shape: '2c, opt, 7c', burst: true });
        const srv = tickServer(sdk, pages());
        await srv.run(10);
        const r = await p;
        expect(r).toMatchObject({ ok: true, pages: 9, options: 1 });
        expect(r.shape).toMatchObject({ burst: true, burstPages: 9, stepPages: 0, bursts: 2, failedBursts: 0, expected: '2c, opt, 7c', seen: '2c, opt, 7c', matches: true });
        expect(blindSends(sdk)).toBe(9);
        expect(dialogueRuns(r.transcript)).toBe('2c, opt, 7c');
    });

    test('fixed mode with a shape answers page by page and still checks the shape', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1 }));
        const p = converse(sdk as never, ['Yes'], { shape: '2c, opt, 7c' });
        const srv = tickServer(sdk, pages());
        await srv.run(16);
        const r = await p;
        expect(blindSends(sdk)).toBe(0);
        expect(r.shape).toMatchObject({ burst: false, burstPages: 0, stepPages: 9, bursts: 0, matches: true });
    });

    test('burst is faster than fixed on the same pages', async () => {
        const timed = async (burst: boolean) => {
            const sdk = new FakeSdk(baseState({ tick: 1 }));
            const p = converse(sdk as never, ['Yes'], { shape: '2c, opt, 7c', burst });
            const srv = tickServer(sdk, pages());
            await srv.run(16);
            return (await p).ticks;
        };
        const fixed = await timed(false);
        const burst = await timed(true);
        expect(fixed).toBe(11); // 9 pages + 1 option, a tick each, plus the first page's publication
        // First publication + ceil(2/5) + 1 option + ceil(7/5): the run after the option is burst whole from its
        // first observed page, a tick under CONVENTIONS.md's 1 + ceil((k-1)/5) rule.
        expect(burst).toBe(5);
    });

    test('a state page is answered alone and the run before it waits for a quiet tick', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1 }));
        const p = converse(sdk as never, [], { shape: '2c, state, 3c', burst: true });
        const srv = tickServer(sdk, [...conts('a', 2), cont('s'), ...conts('b', 3)]);
        await srv.run(12);
        const r = await p;
        expect(r.shape).toMatchObject({ burstPages: 5, stepPages: 1, bursts: 2, matches: true, expected: '6c' });
        const kinds = sdk.sent.map(s => (s.method === 'sendClickDialog' ? 'blind' : 'guarded'));
        expect(kinds).toEqual(['blind', 'blind', 'guarded', 'blind', 'blind', 'blind']);
    });

    test('an under-counted run does not land: bursting stops and the rest goes page by page', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1 }));
        const p = converse(sdk as never, ['Yes'], { shape: '2c, opt, 7c', burst: true });
        const srv = tickServer(sdk, [...conts('a', 3), choice('c', 'Yes', 'No'), ...conts('b', 2)]);
        await srv.run(20);
        const r = await p;
        expect(r.ok).toBe(true);
        expect(r.options).toBe(1);
        expect(r.shape!.failedBursts).toBe(1);
        expect(r.shape!.stopped).toMatch(/burst of 2 did not land/);
        expect(r.shape!.matches).toBe(false);
        expect(blindSends(sdk)).toBe(2); // none after the failure
    });

    test('a page the shape does not expect turns bursting off before anything is sent blind', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1 }));
        const p = converse(sdk as never, ['Yes'], { shape: 'opt, 5c', burst: true });
        const srv = tickServer(sdk, [...conts('a', 2), choice('c', 'Yes', 'No'), ...conts('b', 5)]);
        await srv.run(16);
        const r = await p;
        expect(blindSends(sdk)).toBe(0);
        expect(r.shape!.stopped).toMatch(/a continue page came at part 1, opt/);
        expect(r).toMatchObject({ ok: true, pages: 7, options: 1 });
    });

    test('a client that refuses blind continues falls back to one page per tick', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1 }));
        const orig = sdk.sendClickDialog.bind(sdk);
        sdk.sendClickDialog = (async (...args: unknown[]) => {
            if ((args[1] as { blind?: boolean } | undefined)?.blind) return { success: false, message: 'blind continue unsupported' };
            return orig(...args);
        }) as never;
        const p = converse(sdk as never, ['Yes'], { shape: '2c, opt, 7c', burst: true });
        const srv = tickServer(sdk, pages());
        await srv.run(16);
        const r = await p;
        expect(r).toMatchObject({ ok: true, pages: 9, options: 1 });
        expect(r.shape).toMatchObject({ burstPages: 0, stepPages: 9, bursts: 1, failedBursts: 1, matches: true });
        expect(r.shape!.stopped).toMatch(/burst refused: blind continue unsupported/);
    });

    test('burst without a shape, or a bad shape, rejects before sending', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, dialog: cont('a') }));
        await expect(converse(sdk as never, [], { burst: true })).rejects.toThrow(/needs the conversation's shape/);
        await expect(converse(sdk as never, [], { shape: '3c, maybe' })).rejects.toThrow(/bad shape token "maybe"/);
        expect(sdk.sent).toEqual([]);
    });
});

describe('parseShape / shapeRuns', () => {
    test('tokens, repeats and merging', () => {
        expect(parseShape('3c, opt, 3c, state, 8c, opt, 13c')).toEqual([
            { kind: 'continue', n: 3 }, { kind: 'opt' }, { kind: 'continue', n: 3 }, { kind: 'state' }, { kind: 'continue', n: 8 }, { kind: 'opt' }, { kind: 'continue', n: 13 },
        ]);
        expect(parseShape('3c, 2 opt, 2c, 1c')).toEqual([{ kind: 'continue', n: 3 }, { kind: 'opt' }, { kind: 'opt' }, { kind: 'continue', n: 3 }]);
        expect(shapeRuns('3c, opt, 3c, state, 8c, opt, 13c')).toBe('3c, opt, 12c, opt, 13c');
        expect(shapeRuns('state, 6c, state, 8c, opt, 4c')).toBe('16c, opt, 4c');
        expect(() => parseShape('0c')).toThrow();
    });
});

describe('converse interrupts', () => {
    const monkey: Interrupt = { name: 'monkey', match: s => /monkey in your backpack/i.test(s.dialog.allComponents?.map(c => c.text).join(' ') ?? ''), dismiss: 'continue' };

    test('an unsolicited page before the conversation is dismissed and does not count as it opening', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1 }));
        const p = converse(sdk as never, [], { interrupts: [monkey], openTicks: 3 });
        script(sdk, [cont('m', 'The monkey in your backpack... I\'m hungry!')]);
        await settle(sdk, 6);
        const r = await p;
        expect(r).toMatchObject({ opened: false, pages: 0, interrupts: 1, reason: 'no dialogue opened' });
    });

    test('mid-conversation: dismissed apart from the pages and the shape', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1 }));
        const p = converse(sdk as never, ['Yes'], { interrupts: [monkey], shape: '1c, opt, 1c' });
        script(sdk, [cont('a'), cont('m', 'The monkey in your backpack... Are we nearly there yet?'), choice('c', 'Yes', 'No'), cont('b')]);
        await settle(sdk, 10);
        const r = await p;
        expect(r).toMatchObject({ ok: true, pages: 2, options: 1, interrupts: 1 });
        expect(r.shape!.matches).toBe(true);
        expect(r.transcript.some(l => /interrupt monkey: The monkey/.test(l))).toBe(true);
    });

    test('close dismissal sends close-modal; without interrupts the field is absent', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, dialog: cont('m', 'The monkey in your backpack...') }));
        sdk.onSend = (a, f) => { if (a.method === 'sendCloseModal') queueMicrotask(() => f.tick({ dialog: closed })); };
        const p = converse(sdk as never, [], { interrupts: [{ ...monkey, dismiss: 'close' }], openTicks: 2 });
        await settle(sdk, 4);
        expect((await p).interrupts).toBe(1);
        expect(sdk.sent.map(s => s.method)).toEqual(['sendCloseModal']);
        const plain = new FakeSdk(baseState({ tick: 1 }));
        const q = converse(plain as never, [], { openTicks: 1 });
        await settle(plain, 3);
        expect('interrupts' in (await q)).toBe(false);
    });

    test('levelUpInterrupt matches level-up pages only', () => {
        const it = levelUpInterrupt();
        expect(it.match(baseState({ tick: 5, dialog: cont('l', 'Congratulations, you just advanced a Prayer level.') }))).toBe(true);
        expect(it.match(baseState({ tick: 6, dialog: cont('n', 'Thank you, adventurer.') }))).toBe(false);
    });
});

describe("converse expect: 'interrupt'", () => {
    const levelUp = cont('lu', 'Congratulations, you just advanced a Mining level.');
    const unlock = cont('un', 'You can now mine Iron.');
    // rs/416's call after Doric's hand-in (converse called at tick 44).
    const completion = { openTicks: 4, idle: 1, closeModals: true, interrupts: [levelUpInterrupt()] };

    /** A dialogue click shows its page waiting at once; what the next tick shows is the timeline's. */
    function waitingOnClick(sdk: FakeSdk) {
        sdk.onSend = (a, f) => {
            if (!/ClickDialog|clickDialogByText/.test(a.method)) return;
            const cur = f.state!.dialog;
            queueMicrotask(() => f.push({ dialog: { ...cur, isWaiting: true } }));
        };
    }

    /** Tick once at a time, publishing `at[tick]` on that tick, until `p` settles; the result and the tick it settled on. */
    async function timeline<T>(sdk: FakeSdk, p: Promise<T>, at: Record<number, Partial<BotWorldState>>, maxTicks = 30) {
        let settledAt = -1;
        p.then(() => { settledAt = sdk.state!.tick; }, () => {});
        for (let i = 0; i < maxTicks; i++) {
            await flush();
            if (settledAt >= 0) break;
            sdk.tick(at[sdk.state!.tick + 1] ?? {});
        }
        return { r: await p, at: settledAt };
    }

    test('the completion level-up page: over at idle after it closes, no openTicks wait', async () => {
        const sdk = new FakeSdk(baseState({ tick: 44 }));
        waitingOnClick(sdk);
        const p = converse(sdk as never, [], { ...completion, expect: 'interrupt' });
        const { r, at } = await timeline(sdk, p, { 45: { dialog: levelUp }, 46: { dialog: closed } });
        expect(at).toBe(47);
        expect(r).toMatchObject({ ok: true, opened: false, pages: 0, levelUps: 0, interrupts: 1, firstTick: 45, endTick: 46, ticks: 2 });
        expect(r.reason).toBeUndefined();
        expect(sdk.sent.map(s => s.method)).toEqual(['clickDialogByText']);
    });

    test('the same pages by default: the interrupt is answered and the whole openTicks waited out, as before', async () => {
        const sdk = new FakeSdk(baseState({ tick: 44 }));
        waitingOnClick(sdk);
        const p = converse(sdk as never, [], completion);
        const { r, at } = await timeline(sdk, p, { 45: { dialog: levelUp }, 46: { dialog: closed } });
        expect(at).toBe(49); // 44 + openTicks 4 + 1, rs/416's trace
        expect(r).toMatchObject({ ok: true, opened: false, pages: 0, levelUps: 0, interrupts: 1, firstTick: -1, endTick: -1, ticks: 0, reason: 'no dialogue opened' });
    });

    test('an interrupt page and then a real conversation inside the idle wait: both answered', async () => {
        const sdk = new FakeSdk(baseState({ tick: 44 }));
        waitingOnClick(sdk);
        const p = converse(sdk as never, ['Yes'], { ...completion, idle: 2, expect: 'interrupt' });
        const { r, at } = await timeline(sdk, p, {
            45: { dialog: levelUp }, 46: { dialog: closed }, 47: { dialog: cont('a', 'Well done, adventurer.') }, 48: { dialog: choice('c', 'Yes', 'No') }, 49: { dialog: closed },
        });
        expect(at).toBe(51);
        expect(r).toMatchObject({ ok: true, opened: true, pages: 1, options: 1, interrupts: 1, firstTick: 45, endTick: 49, remaining: [] });
        expect(dialogueRuns(r.transcript)).toBe('1c, opt');
    });

    test('a level-up chain (its unlock page after a closed tick) holds the idle wait open until the last page closes', async () => {
        const sdk = new FakeSdk(baseState({ tick: 44 }));
        waitingOnClick(sdk);
        const p = converse(sdk as never, [], { ...completion, idle: 2, expect: 'interrupt' });
        const { r, at } = await timeline(sdk, p, { 45: { dialog: levelUp }, 46: { dialog: closed }, 47: { dialog: unlock }, 48: { dialog: closed } });
        expect(at).toBe(50);
        expect(r).toMatchObject({ opened: false, interrupts: 2, endTick: 48 });
    });

    test('a dismissal still in flight when the chat closes is not taken for no page at all', async () => {
        const sdk = new FakeSdk(baseState({ tick: 44 }));
        let release = () => {};
        sdk.clickDialogByText = () => new Promise(res => { release = () => res({ success: true, message: 'ok' }); });
        const p = converse(sdk as never, [], { ...completion, openTicks: 0, expect: 'interrupt' });
        sdk.tick({ dialog: levelUp }); // 45
        await flush();
        sdk.tick({ dialog: closed }); // 46, the click not yet acknowledged
        await flush();
        expect(await peek(p)).toBeUndefined();
        release();
        await flush();
        sdk.tick(); // 47
        expect(await p).toMatchObject({ ok: true, opened: false, interrupts: 1, endTick: 46 });
    });

    test('no page at all still ends after openTicks with no dialogue opened; without interrupts it is refused', async () => {
        const sdk = new FakeSdk(baseState({ tick: 44 }));
        const p = converse(sdk as never, [], { ...completion, expect: 'interrupt' });
        const { r, at } = await timeline(sdk, p, {});
        expect(at).toBe(49);
        expect(r).toMatchObject({ ok: true, opened: false, interrupts: 0, endTick: -1, ticks: 0, reason: 'no dialogue opened' });
        await expect(converse(sdk as never, [], { expect: 'interrupt' })).rejects.toThrow(/needs interrupts/);
    });
});

/** The player as the hit rule reads it: `lastDamageTick` is the tick of the last hitsplat on them. */
const you = (lastDamageTick = -1) => ({ hp: 30, maxHp: 50, combat: { inCombat: false, targetIndex: -1, targetType: 'none', lastDamageTick } }) as unknown as PlayerState;

/**
 * An NPC's talk as the engine runs it: tickServer's paging (at most 5 dialogue clicks a tick, a continue refused at a
 * choice) plus the script's life. Page 0 shows at once (the talk click already went out); an interact (a re-engage)
 * opens page 0 again on the next tick; the click on the last page ends the script, closing the chat and running
 * `done`. Reaching a page index listed in `cuts` (each entry once) closes the chat on that tick instead, with a
 * poison hitsplat unless `hit` is false, and drops the script and the clicks owed to it (Player.closeModal).
 */
function npcTalk(sdk: FakeSdk, pages: DialogState[], o: { cuts?: number[]; hit?: boolean; done?: (tick: number) => Partial<BotWorldState> } = {}) {
    let i = 0;
    let opening = false;
    const cuts = [...(o.cuts ?? [])];
    const owed: Array<'continue' | 'option'> = [];
    const interacts: number[] = [];
    sdk.onSend = a => {
        if (a.method === 'sendInteractNpc') {
            opening = true;
            interacts.push(sdk.state!.tick);
        } else if (a.method === 'sendClickDialog') owed.push('continue');
        else if (a.method === 'clickDialogByText') owed.push(/continue/i.test(String(a.args[0])) ? 'continue' : 'option');
    };
    sdk.tick({ dialog: pages[0]! });
    return {
        interacts,
        async run(ticks: number) {
            for (let t = 0; t < ticks; t++) {
                await flush();
                await flush();
                const tick = sdk.state!.tick + 1;
                let patch: Partial<BotWorldState> = {};
                if (i < 0) {
                    owed.length = 0;
                    if (opening) i = 0;
                } else {
                    for (let n = 0; n < 5 && owed.length && i >= 0; n++) {
                        const kind = owed.shift()!;
                        if (kind === 'continue' && pages[i]!.options.some(op => op.buttonType === 1)) continue;
                        i++;
                        const cut = cuts.indexOf(i);
                        if (i >= pages.length) {
                            i = -1;
                            patch = { ...patch, ...o.done?.(tick) };
                        } else if (cut >= 0) {
                            cuts.splice(cut, 1);
                            i = -1;
                            if (o.hit !== false) patch = { ...patch, player: you(tick) };
                        }
                    }
                    if (i < 0) owed.length = 0;
                }
                opening = false;
                sdk.tick({ ...patch, dialog: i >= 0 ? pages[i]! : closed });
            }
        },
    };
}

const ORDERS = { slot: 0, id: 4005, name: 'Narnode\'s orders', count: 1, optionsWithIndex: [] };
const holdsOrders = (s: BotWorldState) => s.inventory.some(i => i.id === ORDERS.id);
/** S15:C, Narnode's orders (MM_SHAPES.narnodeOrders '10c, state, 3c'), handing over the orders as the script ends. */
const narnodeOrders = () => [...conts('o', 10), cont('state'), ...conts('p', 3)];
/** S15:F, Waydar's flight (MM_SHAPES.waydarFly '3c, opt, 1c, state'). */
const waydarFly = () => [...conts('w', 3), choice('fly', 'Yes', 'No'), cont('x'), cont('glider')];

describe('converse re-engage (a chat closed mid-talk with until unmet)', () => {
    const talk = (sdk: FakeSdk, o: ConverseOptions = {}, choices: Array<string | RegExp> = []) =>
        converse(sdk as never, choices, { idle: 6, maxTicks: 200, until: holdsOrders, reopen: () => sdk.sendInteractNpc(7, 1), ...o });

    test('the fixed chain: closed by a poison tick after page 2, one re-engage of the same NPC, the replay answered to its end', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: you() }));
        const p = talk(sdk);
        const srv = npcTalk(sdk, narnodeOrders(), { cuts: [2], done: () => ({ inventory: [ORDERS] }) });
        await srv.run(40);
        const r = await p;
        // Pages 1-2 at ticks 2-3, the hit's close at 4, the re-engage idle (6) ticks on at 10, the replay from 11.
        expect(srv.interacts).toEqual([10]);
        expect(r).toMatchObject({ ok: true, opened: true, pages: 2 + 14, reengages: 1, firstTick: 2, endTick: 25, ticks: 24 });
        expect(r.transcript.filter(l => !/page:/.test(l))).toEqual(['[10] re-engage 1: chat closed at 4 with until unmet (hit at 4)']);
        expect(holdsOrders(sdk.state!)).toBe(true);
    });

    test('without reopen the same close idles to maxTicks, as before', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: you() }));
        const p = talk(sdk, { reopen: undefined, maxTicks: 40 });
        const srv = npcTalk(sdk, narnodeOrders(), { cuts: [2], done: () => ({ inventory: [ORDERS] }) });
        await srv.run(45);
        expect(await p).toMatchObject({ ok: false, reason: 'timeout', pages: 2 });
        expect(srv.interacts).toEqual([]);
    });

    test('S15:C in burst mode: the cut burst leaves the shape, the hit marks the close, the replay goes a page a tick', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: you() }));
        const p = talk(sdk, { shape: '10c, state, 3c', burst: true });
        const srv = npcTalk(sdk, narnodeOrders(), { cuts: [2], done: () => ({ inventory: [ORDERS] }) });
        await srv.run(40);
        const r = await p;
        expect(r).toMatchObject({ ok: true, reengages: 1 });
        expect(r.shape!.stopped).toMatch(/burst of 10 did not land/);
        expect(r.transcript.some(l => /re-engage 1: chat closed at \d+ with until unmet \(hit at \d+\)/.test(l))).toBe(true);
        expect(holdsOrders(sdk.state!)).toBe(true);
    });

    test('S15:F, closed after the option: the choice queue starts over and the replayed menu is answered again', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: you() }));
        let flown = false;
        const p = talk(sdk, { idle: 4, until: () => flown }, [/^Yes$/]);
        const srv = npcTalk(sdk, waydarFly(), { cuts: [4], done: () => { flown = true; return {}; } });
        await srv.run(30);
        const r = await p;
        expect(r).toMatchObject({ ok: true, reengages: 1, options: 2, remaining: [] });
        expect(dialogueRuns(r.transcript)).toBe('3c, opt, 3c, opt, 2c');
    });

    test('evidence: a followed shape left unfinished re-engages with no hit; no shape and no hit keeps waiting', async () => {
        const shaped = new FakeSdk(baseState({ tick: 1, player: you() }));
        const p = talk(shaped, { shape: '10c, state, 3c' });
        await npcTalk(shaped, narnodeOrders(), { cuts: [2], hit: false, done: () => ({ inventory: [ORDERS] }) }).run(40);
        const r = await p;
        expect(r).toMatchObject({ ok: true, reengages: 1 });
        expect(r.transcript).toContain('[10] re-engage 1: chat closed at 4 with until unmet (the shape was at part 1, 10c (2 done))');

        const bare = new FakeSdk(baseState({ tick: 1, player: you() }));
        const q = talk(bare, { maxTicks: 30 });
        const srv = npcTalk(bare, narnodeOrders(), { cuts: [2], hit: false, done: () => ({ inventory: [ORDERS] }) });
        await srv.run(35);
        expect(await q).toMatchObject({ ok: false, reason: 'timeout' });
        expect(srv.interacts).toEqual([]);
    });

    test(`a hit more than HIT_CLOSE_TICKS (${HIT_CLOSE_TICKS}) before the close, or none, is no evidence; a slow until is waited for`, async () => {
        // The talk ends normally at 15; the effect lands at 25; a hit at 8 (in a p_delay, say) is too early to be the close's.
        const sdk = new FakeSdk(baseState({ tick: 1, player: you(8) }));
        let endedAt = -1;
        const p = talk(sdk, { idle: 3, until: s => endedAt >= 0 && s.tick >= endedAt + 10 });
        const srv = npcTalk(sdk, conts('k', 13), { done: tick => { endedAt = tick; return {}; } });
        await srv.run(30);
        expect(await p).toMatchObject({ ok: true, endTick: 25 });
        expect(srv.interacts).toEqual([]);
    });

    test('bounded: a third cut after two re-engages fails with a named reason and the transcript, long before maxTicks', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: you() }));
        const p = talk(sdk);
        const srv = npcTalk(sdk, narnodeOrders(), { cuts: [2, 2, 2], done: () => ({ inventory: [ORDERS] }) });
        await srv.run(60);
        const r = await p;
        expect(srv.interacts.length).toBe(2);
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/^chat closed mid-talk at \d+ with until unmet \(hit at \d+\) after 2 re-engages$/);
        expect(r.pages).toBe(6);
        expect(r.endTick - r.startTick).toBeLessThan(40);
    });

    test('a re-engage whose chat never reopens is spent after openTicks; the last one fails with a named reason', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: you() }));
        let clicks = 0;
        const p = talk(sdk, { openTicks: 5, reopen: async () => void clicks++ });
        await npcTalk(sdk, narnodeOrders(), { cuts: [2] }).run(40);
        const r = await p;
        expect(clicks).toBe(2);
        expect(r).toMatchObject({ ok: false, reengages: 2, reason: 're-engage 2 opened no dialogue in 5 ticks (chat closed at 4, hit at 4)' });
    });

    test('no until, or until held: a closed chat is over as before and never re-engaged', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: you() }));
        const p = talk(sdk, { until: undefined });
        const srv = npcTalk(sdk, narnodeOrders(), { cuts: [2] });
        await srv.run(20);
        expect(await p).toMatchObject({ ok: true, pages: 2, endTick: 4 });
        expect(srv.interacts).toEqual([]);
    });
});

describe('converse re-engage leaves the happy path alone', () => {
    // The same talk with and without `reopen`, no close: the result (its per-page ticks in the transcript) and every
    // send must be identical. The effect lands 3 ticks after the chat closes (a flight), so `until` is false for a while.
    async function run(o: ConverseOptions, pages: DialogState[], withReopen: boolean) {
        const sdk = new FakeSdk(baseState({ tick: 1, player: you() }));
        let endedAt = -1;
        const p = converse(sdk as never, ['Yes'], {
            idle: 3, maxTicks: 200, until: s => endedAt >= 0 && s.tick >= endedAt + 3, ...o,
            ...(withReopen ? { reopen: () => Promise.reject(new Error('re-engaged on the happy path')) } : {}),
        });
        await npcTalk(sdk, pages, { done: tick => { endedAt = tick; return {}; } }).run(30);
        return { r: await p, sent: sdk.sent };
    }

    test('the fixed chain: per-page ticks byte-identical', async () => {
        const pages = narnodeOrders();
        const plain = await run({}, pages, false);
        const reopen = await run({}, pages, true);
        expect(JSON.stringify(reopen)).toBe(JSON.stringify(plain));
        // One page a tick from tick 2; the last at 15 ends the script at 16; the effect at 19.
        expect(plain.r.transcript.map(l => Number(/^\[(\d+)\]/.exec(l)![1]))).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
        expect(plain.r).toMatchObject({ ok: true, pages: 14, endTick: 19 });
        expect('reengages' in plain.r || 'reengages' in reopen.r).toBe(false);
    });

    test('burst mode (S15:C\'s shape) and a choice (S15:F\'s): byte-identical', async () => {
        for (const [o, pages] of [[{ shape: '10c, state, 3c', burst: true }, narnodeOrders()], [{ shape: '3c, opt, 1c, state', burst: true }, waydarFly()], [{}, waydarFly()]] as const) {
            const plain = await run(o, pages, false);
            const reopen = await run(o, pages, true);
            expect(plain.r.ok).toBe(true);
            expect(JSON.stringify(reopen)).toBe(JSON.stringify(plain));
        }
    });
});
