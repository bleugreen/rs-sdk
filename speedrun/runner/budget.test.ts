import { describe, expect, test } from 'bun:test';
import { FakeSdk, flush } from '../lib/fake-sdk';
import { meterDispatch, TickWindow, USER_EVENTS_PER_TICK } from './budget';

describe('TickWindow', () => {
    test('acknowledged and pending actions both spend the window', () => {
        const w = new TickWindow(10, 0);
        expect(w.free()).toBe(USER_EVENTS_PER_TICK);
        w.dispatched();
        w.dispatched();
        expect(w.snapshot()).toEqual({ tick: 10, sent: 0, pending: 2, carry: 0, free: 3 });
        w.acknowledged();
        expect(w.snapshot()).toEqual({ tick: 10, sent: 1, pending: 1, carry: 0, free: 3 });
    });

    test('a burst past 5 carries into the next windows at 5 decoded per tick', () => {
        const w = new TickWindow(10, 0);
        for (let i = 0; i < 12; i++) { w.dispatched(); w.acknowledged(); }
        expect(w.free()).toBe(0);
        w.observe(11, 0);
        expect(w.snapshot()).toMatchObject({ carry: 7, free: 0 });
        w.observe(12, 0);
        expect(w.snapshot()).toMatchObject({ carry: 2, free: 3 });
        w.observe(14, 0);
        expect(w.snapshot()).toMatchObject({ carry: 0, free: 5 });
    });

    test('a tick label that goes backwards (client relaunch) clears the carry', () => {
        const w = new TickWindow(500, 0);
        for (let i = 0; i < 12; i++) w.acknowledged();
        w.observe(3, 0);
        expect(w.snapshot()).toMatchObject({ tick: 3, carry: 0, sent: 0, free: 5 });
    });

    test('age runs from the first publication of the current label', () => {
        const w = new TickWindow(10, 1000);
        w.observe(10, 1200); // a mid-tick republish does not restart the clock
        expect(w.ageMs(1250)).toBe(250);
        w.observe(11, 1300);
        expect(w.ageMs(1350)).toBe(50);
    });
});

describe('meterDispatch', () => {
    test('books every send through the SDK dispatch point until removed', async () => {
        const sdk = new FakeSdk();
        const w = new TickWindow(100, 0);
        const off = meterDispatch(sdk, w);
        const p = sdk.sendWalk(1, 2);
        expect(w.snapshot()).toMatchObject({ pending: 1, sent: 0 });
        await p;
        expect(w.snapshot()).toMatchObject({ pending: 0, sent: 1, free: 4 });
        off();
        await sdk.sendWalk(3, 4);
        await flush();
        expect(w.snapshot()).toMatchObject({ sent: 1 });
        expect(Object.prototype.hasOwnProperty.call(sdk, 'sendAction')).toBe(false);
        expect(sdk.sent.length).toBe(2);
    });

    test('actions that send no game packet are not booked', async () => {
        const sdk = new FakeSdk();
        const w = new TickWindow(100, 0);
        meterDispatch(sdk, w);
        await (sdk as unknown as { sendAction(a: unknown): Promise<unknown> }).sendAction({ type: 'scanNearbyLocs', reason: 'x' });
        expect(w.snapshot()).toMatchObject({ pending: 0, sent: 0 });
    });

    test('an SDK without the dispatch point is refused, not silently uncounted', () => {
        expect(() => meterDispatch({}, new TickWindow(0, 0))).toThrow('no sendAction');
    });
});
