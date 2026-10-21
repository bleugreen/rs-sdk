import { describe, expect, test } from 'bun:test';
import type { DialogState, SkillState } from '../../sdk/types';
import { advance, classifyPage, continueBurst } from './dialogue';
import { baseState, FakeSdk, flush } from './fake-sdk';
import { isLevelUp, levelUpStep, newWatcherMemory, startLevelUpWatcher } from './levelup';

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
        sdk.onSend = (a, f) => { if (a.method === 'sendClickDialog') queueMicrotask(() => f.push({ dialog: cont(f.state!.dialog.pageId!, true) })); };
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
        expect(sdk.sent).toEqual([{ method: 'clickDialogByText', args: [/yes/i] }]);
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
        sdk.tick({ dialog: closed });
        expect(await p).toEqual({ ok: true, mode: 'burst', ticks: 2 });
    });

    test('falls back to read-then-act when the client refuses continues after the first', async () => {
        const sdk = new FakeSdk(baseState({ tick: 10, dialog: cont('p1') }));
        let n = 0;
        const orig = sdk.sendClickDialog.bind(sdk);
        (sdk as unknown as { sendClickDialog: unknown }).sendClickDialog = async (o: number, opts?: unknown) => {
            n++;
            const busy = sdk.state!.dialog.isWaiting;
            await orig(o);
            if (busy || (opts && n > 1 && n <= 3)) return { success: false, message: 'Failed to click dialog option' };
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
        const s = baseState({ dialog: cont('l'), recentDialogs: [{ text: ['Congratulations, you just advanced a woodcutting level.', 'Your woodcutting level is now 15.'], tick: 1, interfaceId: 1 }] });
        expect(isLevelUp(s)).toBe(true);
        expect(isLevelUp({ ...s, dialog: choice('c') })).toBe(false);
        expect(isLevelUp({ ...s, recentDialogs: [{ text: ['Hello there'], tick: 1, interfaceId: 2 }] })).toBe(false);
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
});
