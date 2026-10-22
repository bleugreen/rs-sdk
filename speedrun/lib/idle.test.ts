import { describe, expect, test } from 'bun:test';
import type { DialogState, PlayerState } from '../../sdk/types';
import { baseState, FakeSdk, flush } from './fake-sdk';
import { idle, settled } from './idle';
import { waitUntil } from './wait';

const player = (worldX = 10, worldZ = 10, level = 0, animId = -1) =>
    ({ worldX, worldZ, level, animId }) as PlayerState;
const closed: DialogState = { isOpen: false, isWaiting: false, options: [] };
const page = (pageId: string, text: string): DialogState => ({
    isOpen: true, isWaiting: false, pageId,
    allComponents: [{ id: 10, type: 4, buttonType: 0, option: '', text }],
    options: [{ index: 1, text: 'Click here to continue', buttonType: 6, componentId: 11 }],
});
const message = (tick: number, type = 0) => ({ tick, type, text: 'A message', sender: '', fromSelf: false });
const skill = (baseLevel: number) => ({ name: 'Agility', baseLevel, level: baseLevel, experience: 100 });
const ready = () => new FakeSdk(baseState({ player: player() }));

describe('message-based idle', () => {
    test('unchanged endpoint excludes the quiet tail; animations and old messages do not reset it', async () => {
        const sdk = new FakeSdk(baseState({ player: player(10, 10, 0, 42), gameMessages: [message(100)] }));
        const p = idle(sdk, { maxTicks: 60 });
        sdk.tick();
        sdk.push({}); // a same-tick publication is not another quiet tick
        sdk.tick();
        let finished = false;
        void p.then(() => { finished = true; });
        await flush();
        expect(finished).toBe(false);
        sdk.tick();
        expect(await p).toMatchObject({ ok: true, tick: 103, last: 100, changed: false, levelUps: 0 });
    });

    test('a message the browser stamped with the call tick, published after the call, is new', async () => {
        const sdk = new FakeSdk(baseState({ player: player(), gameMessages: [{ ...message(99), observationId: 40 }] }));
        const p = idle(sdk, { maxTicks: 60 });
        sdk.tick({ gameMessages: [{ ...message(99), observationId: 40 }, { ...message(100), observationId: 41 }] });
        for (let i = 0; i < 3; i++) sdk.tick();
        expect(await p).toMatchObject({ ok: true, last: 101, changed: true });
    });

    test('x, z, level and new game messages reset the endpoint, but player chat does not', async () => {
        const sdk = ready();
        const p = idle(sdk, { maxTicks: 80 });
        sdk.tick({ player: player(11) });
        sdk.tick({ player: player(11, 12) });
        sdk.tick({ player: player(11, 12, 1) });
        sdk.tick({ gameMessages: [message(104)] });
        sdk.tick();
        sdk.tick({ gameMessages: [message(104), message(106, 2)] });
        sdk.tick();
        expect(await p).toMatchObject({ ok: true, tick: 107, last: 104, changed: true });
    });

    test('supports the callers custom quiet periods without changing the measurement endpoint', async () => {
        for (const still of [1, 4, 6]) {
            const sdk = ready();
            const p = idle(sdk, { still, maxTicks: 80 });
            for (let i = 0; i < still; i++) sdk.tick();
            expect(await p).toMatchObject({ ok: true, tick: 100 + still, last: 100, changed: false });
        }
    });

    test('a quest continue after a skill gain and recent level-up text is returned, never dismissed', async () => {
        const sdk = ready();
        sdk.push({ skills: [skill(10)] });
        const p = idle(sdk, { maxTicks: 60 });
        sdk.tick({
            skills: [skill(11)],
            recentDialogs: [{ tick: 101, interfaceId: 1, text: ['Congratulations, you just advanced an Agility level.'] }],
            dialog: page('quest', 'Please help me cross the bridge.'),
        });
        expect(await p).toMatchObject({ ok: true, last: 101, tick: 101, changed: true, levelUps: 0 });
        expect(sdk.sent).toEqual([]);
    });

    test('dismisses each level-up/unlock page once and leaves the next quest page untouched', async () => {
        const sdk = ready();
        const p = idle(sdk, { maxTicks: 80 });
        sdk.tick({ dialog: page('level', 'Congratulations, you just advanced an Agility level.') });
        sdk.push({});
        expect(sdk.sent).toHaveLength(1);
        sdk.tick({ dialog: { ...page('level', ''), isWaiting: true } });
        sdk.tick({ dialog: page('unlock', 'You can now use the shortcut.') });
        sdk.push({});
        expect(sdk.sent).toHaveLength(2);
        sdk.tick({ dialog: page('quest', 'Now bring me the rope.') });
        expect(await p).toMatchObject({ ok: true, last: 104, tick: 104, levelUps: 2 });
        expect(sdk.sent.map(a => a.method)).toEqual(['clickDialogByText', 'clickDialogByText']);
        sdk.tick({ dialog: page('later', 'Congratulations, you just advanced an Agility level.') });
        expect(sdk.sent).toHaveLength(2); // no dismissal listener survives the wait
    });

    test('an already-open level-up is dismissed and its last open tick is the endpoint', async () => {
        const sdk = ready();
        sdk.push({ dialog: page('level', 'Your Agility level is now 11.') });
        const p = idle(sdk, { maxTicks: 60 });
        expect(sdk.sent).toHaveLength(1);
        sdk.tick({ dialog: closed });
        sdk.tick();
        sdk.tick();
        expect(await p).toMatchObject({ ok: true, tick: 103, last: 100, changed: true, levelUps: 1 });
    });

    test('a waiting quest page is not answered and only ends the wait when ready', async () => {
        const sdk = ready();
        const p = idle(sdk, { maxTicks: 60 });
        const quest = page('quest', 'Bring me the rope.');
        sdk.tick({ dialog: { ...quest, isWaiting: true } });
        sdk.tick();
        let finished = false;
        void p.then(() => { finished = true; });
        await flush();
        expect(finished).toBe(false);
        sdk.tick({ dialog: quest });
        expect(await p).toMatchObject({ ok: true, tick: 103, last: 103, levelUps: 0 });
        expect(sdk.sent).toEqual([]);
    });

    test('choice dialogue is never dismissed even if its words resemble a level-up', async () => {
        const sdk = ready();
        sdk.push({ dialog: { ...page('choice', 'You just advanced'), options: [{ index: 1, text: 'Go on', buttonType: 1 }] } });
        expect(await idle(sdk, { maxTicks: 60 })).toMatchObject({ ok: true, tick: 100, last: 100, changed: true, levelUps: 0 });
        expect(sdk.sent).toEqual([]);
    });

    for (const maxTicks of [60, 80]) {
        test('preserves waitUntil cap semantics at ' + maxTicks + ' ticks and cleans up after timeout', async () => {
            const sdk = ready();
            const p = idle(sdk, { maxTicks });
            let finished = false;
            void p.then(() => { finished = true; });
            for (let i = 1; i <= maxTicks; i++) sdk.tick({ player: player(i) });
            await flush();
            expect(finished).toBe(false);
            sdk.tick({ player: player(500) });
            expect(await p).toMatchObject({ ok: false, tick: 101 + maxTicks, last: 101 + maxTicks, changed: true });
            sdk.tick({ dialog: page('later', 'Your Agility level is now 11.') });
            expect(sdk.sent).toEqual([]);
        });
    }
});

describe('animation-based settled', () => {
    test('movement on every axis, animations and open dialogue reset the quiet window; messages do not', async () => {
        const sdk = ready();
        const p = waitUntil(sdk, settled(3), { maxTicks: 30 });
        sdk.tick({ player: player(11) });
        sdk.tick({ player: player(11, 12) });
        sdk.tick({ player: player(11, 12, 1) });
        sdk.tick({ player: player(11, 12, 1, 42) });
        sdk.tick(); // continuing animation keeps resetting
        sdk.tick({ player: player(11, 12, 1), dialog: page('quest', 'Bring me the rope.') });
        sdk.tick({ dialog: closed, gameMessages: [message(107)] });
        sdk.tick({ gameMessages: [message(107), message(108)] });
        sdk.tick();
        expect(await p).toMatchObject({ ok: true, tick: 109 }); // includes all three quiet ticks
        expect(sdk.sent).toEqual([]);
    });

    test('same-tick publications do not advance the quiet window', async () => {
        const sdk = ready();
        const p = waitUntil(sdk, settled(2), { maxTicks: 10 });
        for (let i = 0; i < 10; i++) sdk.push({});
        sdk.tick();
        let finished = false;
        void p.then(() => { finished = true; });
        await flush();
        expect(finished).toBe(false);
        sdk.tick();
        expect(await p).toMatchObject({ ok: true, tick: 102 });
    });

    test('open level-up dialogue times out untouched instead of being treated as settled', async () => {
        const sdk = ready();
        sdk.push({ dialog: page('level', 'Your Agility level is now 11.') });
        const p = waitUntil(sdk, settled(3), { maxTicks: 2 });
        sdk.tick();
        sdk.tick();
        sdk.tick();
        expect(await p).toMatchObject({ ok: false, tick: 103 });
        expect(sdk.sent).toEqual([]);
    });
});
