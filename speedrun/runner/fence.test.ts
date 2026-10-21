import { describe, expect, test } from 'bun:test';
import { baseState, FakeSdk } from '../lib/fake-sdk';
import { Fence, FencedError, patchMethod } from './fence';

describe('patchMethod', () => {
    test('unwinds in order and out of order without dropping anyone', async () => {
        const sdk = new FakeSdk(baseState());
        const calls: string[] = [];
        const tag = (name: string) => (send: (a: unknown) => Promise<unknown>) => (a: unknown) => {
            calls.push(name);
            return send(a);
        };
        const unA = patchMethod(sdk, 'sendAction', tag('a'));
        const unB = patchMethod(sdk, 'sendAction', tag('b'));
        unA(); // out of order: a is under b, so it becomes a pass-through
        await sdk.sendClickComponent(1);
        expect(calls).toEqual(['b']);
        unB();
        calls.length = 0;
        await sdk.sendClickComponent(2);
        expect(calls).toEqual([]);
        expect(sdk.sent.map(s => s.args[0])).toEqual([1, 2]);
    });

    test('in-order unwinds leave the instance as it was', () => {
        const sdk = new FakeSdk(baseState());
        const unA = patchMethod(sdk, 'sendAction', send => send);
        const unB = patchMethod(sdk, 'sendAction', send => send);
        unB();
        unA();
        expect(Object.prototype.hasOwnProperty.call(sdk, 'sendAction')).toBe(false);
    });
});

describe('Fence', () => {
    test('an aborted attempt cannot send and stops hearing state; other code is untouched', async () => {
        const sdk = new FakeSdk(baseState({ tick: 0 }));
        const fence = new Fence();
        const unfence = fence.install(sdk);
        const old = fence.open();
        const heard: number[] = [];
        await fence.run(old, async () => {
            sdk.onStateUpdate(s => heard.push(s.tick));
            await sdk.sendClickComponent(1);
        });
        sdk.tick();
        old.abort('link lost');
        sdk.tick();
        // A listener registered inside the attempt fires no more, and the attempt's sends are refused.
        expect(heard).toEqual([1]);
        const late = fence.run(old, () => sdk.sendClickComponent(2));
        await expect(late).rejects.toBeInstanceOf(FencedError);
        // A fresh attempt and code outside any attempt send normally.
        await fence.run(fence.open(), () => sdk.sendClickComponent(3));
        await sdk.sendClickComponent(4);
        expect(sdk.sent.map(s => s.args[0])).toEqual([1, 3, 4]);
        unfence();
    });

    test('a send fired from a listener of an aborted attempt is refused too', async () => {
        const sdk = new FakeSdk(baseState({ tick: 0 }));
        const fence = new Fence();
        fence.install(sdk);
        const a = fence.open();
        const errors: unknown[] = [];
        let fire = false;
        await fence.run(a, async () => {
            sdk.onStateUpdate(() => { if (fire) void sdk.sendClickComponent(9).catch(e => errors.push(e)); });
        });
        // The listener belongs to the attempt; its sends run in the attempt's context.
        fire = true;
        sdk.tick();
        expect(sdk.sent.map(s => s.args[0])).toEqual([9]);
        a.abort('dropped');
        sdk.tick();
        expect(sdk.sent.length).toBe(1);
    });
});
