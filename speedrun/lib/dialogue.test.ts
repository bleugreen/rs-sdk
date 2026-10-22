import { describe, expect, test } from 'bun:test';
import type { DialogState, SkillState } from '../../sdk/types';
import { advance, classifyPage, clickOption, continueBurst } from './dialogue';
import { baseState, FakeSdk, flush } from './fake-sdk';
import { isLevelUp, isLevelUpPage, levelUpChain, levelUpStep, newWatcherMemory, startLevelUpWatcher } from './levelup';

const cont = (pageId: string, isWaiting = false): DialogState => ({
    isOpen: true, isWaiting, pageId, options: [{ index: 1, text: 'Click here to continue', buttonType: 6, componentId: 10 }],
});
const choice = (pageId: string): DialogState => ({
    isOpen: true, isWaiting: false, pageId, options: [
        { index: 1, text: 'Yes', buttonType: 1, componentId: 11 },
        { index: 2, text: 'No', buttonType: 1, componentId: 12 },
    ],
});
const closed: DialogState = { isOpen: false, options: [], isWaiting: false };
const skill = (name: string, baseLevel: number): SkillState => ({ name, level: baseLevel, baseLevel, experience: 0 });

describe('classifyPage', () => {
    test('none / continue / choice', () => {
        expect(classifyPage(closed)).toBe('none');
        expect(classifyPage(cont('a'))).toBe('continue');
        expect(classifyPage({ isOpen: true, isWaiting: false, options: [] })).toBe('continue');
        expect(classifyPage(choice('b'))).toBe('choice');
        expect(classifyPage({ isOpen: true, isWaiting: false, options: [{ index: 1, text: 'Ok', buttonType: 1 }] })).toBe('choice');
    });
});

describe('advance', () => {
    test('continues a fresh page and waits for the next one before acting again', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, dialog: cont('p1') }));
        sdk.onSend = (a, f) => { if (/ClickDialog|clickDialogByText/.test(a.method)) queueMicrotask(() => f.push({ dialog: cont(f.state!.dialog.pageId!, true) })); };
        const r1 = await advance(sdk as never);
        expect(r1).toMatchObject({ ok: true, kind: 'continue' });
        const p2 = advance(sdk as never);
        await flush();
        expect(sdk.sent.length).toBe(1); // spent page p1 is not fresh
        sdk.tick({ dialog: cont('p2') });
        const r2 = await p2;
        expect(r2).toMatchObject({ ok: true, kind: 'continue', ticks: 1 });
        expect(sdk.sent.length).toBe(2);
    });

    test('an identical next page (same id after waiting) is fresh', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, dialog: cont('same') }));
        sdk.onSend = (_a, f) => queueMicrotask(() => f.push({ dialog: cont('same', true) }));
        await advance(sdk as never);
        const p = advance(sdk as never);
        sdk.tick({ dialog: cont('same', false) });
        expect((await p).ok).toBe(true);
        expect(sdk.sent.length).toBe(2);
    });

    test('choice pages need a pattern and use the guarded click', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, dialog: choice('c1') }));
        expect(await advance(sdk as never)).toMatchObject({ ok: false, kind: 'choice' });
        expect(sdk.sent).toEqual([]);
        const r = await advance(sdk as never, { choose: /yes/i });
        expect(r).toMatchObject({ ok: true, kind: 'choice' });
        expect(sdk.sent).toEqual([{ method: 'clickDialogByText', args: [/^Yes$/] }]);
    });

    test('a choice that is not on the page sends nothing', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, dialog: choice('c1') }));
        expect(await advance(sdk as never, { choose: /maybe/i })).toMatchObject({ ok: false, kind: 'choice', reason: 'absent' });
        expect(sdk.sent).toEqual([]);
    });
});

describe('continueBurst', () => {
    test('burst mode when every blind continue is accepted', async () => {
        const sdk = new FakeSdk(baseState({ tick: 10, dialog: cont('p1') }));
        const p = continueBurst(sdk as never, 7);
        await flush();
        expect(sdk.sent.length).toBe(7);
        expect(sdk.sent[0]!.args).toEqual([0, { blind: true }]);
        sdk.tick({ dialog: cont('p6') });
        sdk.tick({ dialog: closed }); // floor tick: landed
        sdk.tick({ dialog: closed }); // quiet tick confirms it
        expect(await p).toEqual({ ok: true, mode: 'burst', ticks: 3, landedTicks: 2 });
    });

    test('a burst split across ticks is not done while pages are still moving', async () => {
        const sdk = new FakeSdk(baseState({ tick: 10, dialog: cont('p1') }));
        let settled = false;
        const p = continueBurst(sdk as never, 10).then(r => { settled = true; return r; });
        await flush();
        sdk.tick({ dialog: cont('p4') }); // 3 landed
        sdk.tick({ dialog: cont('p9') }); // floor tick (t0+2): 8 landed, 2 still buffered
        await flush();
        expect(settled).toBe(false);
        sdk.tick({ dialog: choice('c') }); // the last 2 land
        await flush();
        expect(settled).toBe(false);
        sdk.tick({ dialog: choice('c') }); // quiet
        expect(await p).toMatchObject({ ok: true, mode: 'burst', ticks: 4, landedTicks: 3 });
    });

    test('until: resolves on the landing itself, skipping the quiet tick', async () => {
        const sdk = new FakeSdk(baseState({ tick: 10, dialog: cont('p1') }));
        const p = continueBurst(sdk as never, 10, { until: s => classifyPage(s.dialog) === 'choice' });
        await flush();
        sdk.tick({ dialog: cont('p6') });
        sdk.tick({ dialog: cont('p9') }); // floor, but not the landing
        sdk.tick({ dialog: choice('c') });
        expect(await p).toEqual({ ok: true, mode: 'burst', ticks: 3, landedTicks: 3 });
    });

    test('falls back to read-then-act when the client refuses continues after the first', async () => {
        const sdk = new FakeSdk(baseState({ tick: 10, dialog: cont('p1') }));
        let n = 0;
        const orig = sdk.sendClickDialog.bind(sdk);
        (sdk as unknown as { sendClickDialog: unknown }).sendClickDialog = async (o: number, opts?: unknown) => {
            const call = ++n;
            const busy = sdk.state!.dialog.isWaiting;
            await orig(o);
            if (busy || (opts && call > 1 && call <= 3)) return { success: false, message: 'Failed to click dialog option' };
            queueMicrotask(() => sdk.push({ dialog: cont(sdk.state!.dialog.pageId!, true) }));
            return { success: true, message: 'ok' };
        };
        const p = continueBurst(sdk as never, 3);
        await flush();
        sdk.tick({ dialog: cont('p2') });
        await flush();
        sdk.tick({ dialog: cont('p3') });
        await flush();
        sdk.tick({ dialog: closed });
        const r = await p;
        expect(r).toMatchObject({ ok: true, mode: 'fallback', ticks: 3 });
    });

    test('refuses to start anywhere but a fresh continue page', async () => {
        const sdk = new FakeSdk(baseState({ dialog: choice('c') }));
        expect((await continueBurst(sdk as never, 3)).ok).toBe(false);
        expect(sdk.sent).toEqual([]);
    });
});

describe('levelup', () => {
    test('isLevelUp reads the level-up text of a continue page', () => {
        const s = baseState({ tick: 100, dialog: cont('l'), recentDialogs: [{ text: ['Congratulations, you just advanced a woodcutting level.', 'Your woodcutting level is now 15.'], tick: 100, interfaceId: 1 }] });
        expect(isLevelUp(s)).toBe(true);
        expect(isLevelUp({ ...s, dialog: choice('c') })).toBe(false);
        expect(isLevelUp({ ...s, recentDialogs: [{ text: ['Hello there'], tick: 100, interfaceId: 2 }] })).toBe(false);
    });

    test('an old level-up history entry does not match a later page', () => {
        const entry = { text: ['Congratulations, you just advanced a mining level.'], tick: 50, interfaceId: 1 };
        expect(isLevelUp(baseState({ tick: 52, dialog: cont('l'), recentDialogs: [entry] }))).toBe(true);
        expect(isLevelUp(baseState({ tick: 90, dialog: cont('npc'), recentDialogs: [entry] }))).toBe(false);
    });

    test('a level-up entry ARM_TICKS old matches on both clients, though the browser stamps it a tick lower', () => {
        const text = ['Congratulations, you just advanced a mining level.'];
        const lite = { text, tick: 50, interfaceId: 1 };
        const browser = { text, tick: 49, interfaceId: 1 };
        expect(isLevelUp(baseState({ tick: 54, dialog: cont('l'), recentDialogs: [lite] }))).toBe(true);
        expect(isLevelUp(baseState({ tick: 54, dialog: cont('l'), recentDialogs: [browser] }))).toBe(true);
        expect(isLevelUp(baseState({ tick: 56, dialog: cont('npc'), recentDialogs: [browser] }))).toBe(false);
    });

    const page = (pageId: string, ...words: string[]): DialogState => ({
        ...cont(pageId),
        allComponents: [...words, 'Click here to continue'].map((text, id) => ({ id, type: 4, buttonType: 0, option: '', text })),
    });

    test('isLevelUpPage judges the page by its own words, not by recent history', () => {
        const levelUp = page('l', 'Congratulations, you just advanced an Attack level.', 'Your Attack level is now 20.');
        expect(isLevelUpPage(baseState({ dialog: levelUp }))).toBe(true);
        // A quest page right after a level-up: history still says level-up, the page does not.
        const history = [{ text: ['Congratulations, you just advanced a Hitpoints level.'], tick: 100, interfaceId: 1 }];
        const morgan = page('m', 'STOP! Please... spare my son.');
        expect(isLevelUp(baseState({ tick: 101, dialog: morgan, recentDialogs: history }))).toBe(true);
        expect(isLevelUpPage(baseState({ tick: 101, dialog: morgan, recentDialogs: history }))).toBe(false);
        // No page words published (older client): fall back to history.
        expect(isLevelUpPage(baseState({ tick: 101, dialog: cont('x'), recentDialogs: history }))).toBe(true);
        expect(isLevelUpPage(baseState({ dialog: choice('c') }))).toBe(false);
    });

    test('levelUpChain accepts unlock pages right after a level-up only', () => {
        const chain = levelUpChain();
        const unlock = page('u', 'You can now mine Iron.');
        expect(chain(baseState({ tick: 5, dialog: unlock }))).toBe(false); // no level-up before it
        expect(chain(baseState({ tick: 10, dialog: page('l', 'Your Mining level is now 15.') }))).toBe(true);
        expect(chain(baseState({ tick: 11, dialog: unlock }))).toBe(true);
        expect(chain(baseState({ tick: 12, dialog: page('q', 'Who goes there?') }))).toBe(false);
        expect(chain(baseState({ tick: 30, dialog: unlock }))).toBe(false);
    });

    test('a base level rising arms the watcher; unlock pages in the chain are dismissed too', () => {
        let mem = newWatcherMemory();
        const step = (tick: number, wc: number, dialog: DialogState) => {
            const r = levelUpStep(mem, baseState({ tick, skills: [skill('Woodcutting', wc)], dialog }));
            mem = r.mem;
            return r.click;
        };
        expect(step(1, 14, closed)).toBe(false);
        expect(step(2, 15, cont('lvl'))).toBe(true); // level-up page
        expect(step(2, 15, cont('lvl', true))).toBe(false); // spent
        expect(step(3, 15, cont('unlock'))).toBe(true); // objbox unlock page
        expect(step(4, 15, choice('q'))).toBe(false); // never a choice
        expect(step(20, 15, cont('npc'))).toBe(false); // long after: not ours
    });

    test('watcher sends one continue per level-up page', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, skills: [skill('Mining', 30)] }));
        const w = startLevelUpWatcher(sdk as never);
        sdk.tick({ skills: [skill('Mining', 31)], dialog: cont('x') });
        sdk.push({ dialog: cont('x', true) });
        sdk.tick({ dialog: closed });
        w.stop();
        expect(w.dismissed).toBe(1);
        expect(sdk.sent).toEqual([{ method: 'sendClickDialog', args: [0] }]);
    });

    test('advance sends a guarded continue when the page publishes one, else a plain continue', async () => {
        const closeOnSend = (_a: unknown, f: FakeSdk) => queueMicrotask(() => f.tick({ dialog: closed }));
        const sdk = new FakeSdk(baseState({ tick: 1, dialog: cont('only') }));
        sdk.onSend = closeOnSend;
        await advance(sdk as never, { maxTicks: 1 });
        expect(sdk.sent[0]).toEqual({ method: 'clickDialogByText', args: [/^Click here to continue$/] });
        const old = new FakeSdk(baseState({ tick: 1, dialog: { isOpen: true, isWaiting: false, options: [{ index: 1, text: 'Click here to continue' }] } }));
        old.onSend = closeOnSend;
        await advance(old as never, { maxTicks: 1 });
        expect(old.sent[0]).toEqual({ method: 'sendClickDialog', args: [0] });
    });
});

describe('clickOption', () => {
    test('resolves the option first and clicks its exact text', async () => {
        const sdk = new FakeSdk(baseState({ dialog: choice('c') }));
        expect(await clickOption(sdk as never, 'ye')).toEqual({ ok: true, text: 'Yes', options: ['Yes', 'No'] });
        expect(sdk.sent).toEqual([{ method: 'clickDialogByText', args: [/^Yes$/] }]);
    });

    test('absent option or no dialog: nothing is sent', async () => {
        const sdk = new FakeSdk(baseState({ dialog: choice('c') }));
        expect(await clickOption(sdk as never, /maybe/)).toMatchObject({ ok: false, reason: 'absent' });
        sdk.push({ dialog: closed });
        expect(await clickOption(sdk as never, /yes/i)).toMatchObject({ ok: false, reason: 'no_dialog' });
        expect(sdk.sent).toEqual([]);
    });

    test('a refusal from the page guard is reported, not hidden', async () => {
        const sdk = new FakeSdk(baseState({ dialog: choice('c') }));
        sdk.clickDialogByText = async () => ({ success: false, message: 'page changed', reason: 'stale_dialog' }) as never;
        expect(await clickOption(sdk as never, /yes/i)).toMatchObject({ ok: false, text: 'Yes', reason: 'stale_dialog' });
    });

    test('option text with regex metacharacters is matched literally', async () => {
        const sdk = new FakeSdk(baseState({ dialog: { isOpen: true, isWaiting: false, pageId: 'q', options: [{ index: 1, text: 'What? (again)', buttonType: 1, componentId: 3 }, { index: 2, text: 'No', buttonType: 1, componentId: 4 }] } }));
        await clickOption(sdk as never, 'what?');
        const re = sdk.sent[0]!.args[0] as RegExp;
        expect(re.test('What? (again)')).toBe(true);
        expect(re.test('What (again)')).toBe(false);
    });
});
