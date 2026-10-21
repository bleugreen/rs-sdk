import { afterEach, describe, expect, test } from 'bun:test';
import type { FakeSdk } from './fake-sdk';
import { borderGuard, gateLoc, guard, pathfinder, tollWorld as world } from './fake-toll-gate';
import { crossTollGate, isEastOfTollGate, pickBorderGuard, TOLL_EAST, TOLL_WEST, travelTo, WEST_OF_GATE, type TollGateBot, type TollGateSdk } from './toll-gate';

const bot: TollGateBot = { walkTo: async () => ({ success: true, message: 'ok' }) };
const asSdk = (f: FakeSdk) => f as unknown as TollGateSdk;

let ticker: ReturnType<typeof setInterval> | null = null;
function run(fake: FakeSdk): void {
    ticker = setInterval(() => fake.tick(), 1);
}
afterEach(() => {
    if (ticker) clearInterval(ticker);
    ticker = null;
});

describe('pickBorderGuard', () => {
    test('takes the nearest guard on the player side of the fence', () => {
        const npcs = [guard(1, 3268, 1), guard(2, 3267, 3), guard(3, 3266, 2)];
        expect(pickBorderGuard(npcs, false)?.index).toBe(3);
        expect(pickBorderGuard(npcs, true)?.index).toBe(1);
        expect(pickBorderGuard([guard(1, 3268, 1)], false)).toBeUndefined();
    });
});

describe('crossTollGate', () => {
    test('already on the requested side: nothing to do', async () => {
        const fake = world(TOLL_EAST, 50);
        expect(await crossTollGate(bot, asSdk(fake), true)).toEqual({ ok: true, paid: 0 });
        expect(fake.sent).toEqual([]);
    });

    test('fewer than 10 coins: refuses without talking to anyone', async () => {
        const fake = world({ x: 3290, z: 3170 }, 9, { nearbyNpcs: [guard(1, 3268, 1)] });
        const r = await crossTollGate(bot, asSdk(fake), false);
        expect(r).toEqual({ ok: false, paid: 0, reason: 'no toll' });
        expect(fake.sent).toEqual([]);
    });

    test('west to east: talks to the west guard, answers Yes, pays 10', async () => {
        // The east guard is nearer, but only a guard on the player's side can start the crossing.
        const fake = world(TOLL_WEST, 34, { nearbyNpcs: [guard(7, 3268, 1), guard(9, 3266, 2)] });
        borderGuard(fake);
        run(fake);
        const r = await crossTollGate(bot, asSdk(fake), true);
        expect(r).toEqual({ ok: true, paid: 10 });
        expect(fake.sent.find(a => a.method === 'sendInteractNpc')?.args[0]).toBe(9);
        expect(fake.sent.some(a => a.method === 'sendClickDialog' && a.args[0] === 3)).toBe(true);
        expect(fake.state!.player!.worldX).toBe(TOLL_EAST.x);
    });

    test('east to west with no guard in view: uses the gate', async () => {
        const fake = world(TOLL_EAST, 26, { nearbyLocs: [gateLoc] });
        borderGuard(fake);
        run(fake);
        const r = await crossTollGate(bot, asSdk(fake), false);
        expect(r).toEqual({ ok: true, paid: 10 });
        expect(fake.sent[0]).toEqual({ method: 'sendInteractLoc', args: [3268, 3227, 2882, 1] });
        expect(fake.state!.player!.worldX).toBe(TOLL_WEST.x);
    });

    test('the guard says there is not enough money: gives up at once and closes the dialogue', async () => {
        const fake = world(TOLL_EAST, 10, { nearbyNpcs: [guard(4, 3269, 1)] });
        borderGuard(fake, { refuse: true });
        run(fake);
        const r = await crossTollGate(bot, asSdk(fake), false);
        expect(r).toEqual({ ok: false, paid: 0, reason: 'no toll' });
        expect(fake.sent.filter(a => a.method === 'sendInteractNpc')).toHaveLength(1);
        expect(fake.state!.dialog.isOpen).toBe(false);
    });

    test('nothing to click: three attempts, then reports it', async () => {
        const fake = world(TOLL_WEST, 50);
        run(fake);
        const r = await crossTollGate(bot, asSdk(fake), true);
        expect(r).toEqual({ ok: false, paid: 0, reason: 'no guard or gate' });
    });
});

const VARROCK_WEST_BANK = { x: 3185, z: 3436 };
const AL_KHARID_BANK = { x: 3270, z: 3167 };
const LUMBRIDGE = { x: 3222, z: 3218 };

describe('travelTo', () => {
    test('from Al Kharid to Varrock west bank: pays the toll, steps clear of the gate, then walks', async () => {
        const fake = world({ x: 3290, z: 3170 }, 1566, { nearbyNpcs: [guard(4, 3269, 2)] });
        borderGuard(fake);
        run(fake);
        const { bot, calls } = pathfinder(fake);
        const r = await travelTo(bot, asSdk(fake), VARROCK_WEST_BANK);
        expect(r).toEqual({ ok: true, paid: 10 });
        expect(fake.sent.find(a => a.method === 'sendInteractNpc')?.args[0]).toBe(4);
        // Up to the gate on the east side, then only west-side destinations from the west side.
        expect(calls).toEqual([
            { to: [TOLL_EAST.x, TOLL_EAST.z], fromEast: true },
            { to: [WEST_OF_GATE.x, WEST_OF_GATE.z], fromEast: false },
            { to: [VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z], fromEast: false }
        ]);
        expect(fake.state!.player).toMatchObject({ worldX: VARROCK_WEST_BANK.x, worldZ: VARROCK_WEST_BANK.z });
    });

    test('from the west into Al Kharid: pays the toll eastward, no westward step', async () => {
        const fake = world(LUMBRIDGE, 30, { nearbyNpcs: [guard(2, 3266, 2)] });
        borderGuard(fake);
        run(fake);
        const { bot, calls } = pathfinder(fake);
        const r = await travelTo(bot, asSdk(fake), AL_KHARID_BANK);
        expect(r).toEqual({ ok: true, paid: 10 });
        expect(calls.map(c => c.to)).toEqual([[TOLL_WEST.x, TOLL_WEST.z], [AL_KHARID_BANK.x, AL_KHARID_BANK.z]]);
        expect(calls.every(c => isEastOfTollGate({ x: c.to[0], z: c.to[1] }) === c.fromEast)).toBe(true);
    });

    test('fewer than 10 coins: fails before any walk toward the other side', async () => {
        const fake = world({ x: 3290, z: 3170 }, 5, { nearbyNpcs: [guard(4, 3269, 2)] });
        const { bot, calls } = pathfinder(fake);
        const r = await travelTo(bot, asSdk(fake), VARROCK_WEST_BANK);
        expect(r).toEqual({ ok: false, paid: 0, reason: 'toll gate: no toll' });
        expect(calls).toEqual([]);
        expect(fake.sent).toEqual([]);
    });

    test('same side: just walks, no toll', async () => {
        const fake = world(LUMBRIDGE, 0);
        const { bot, calls } = pathfinder(fake);
        expect(await travelTo(bot, asSdk(fake), VARROCK_WEST_BANK)).toEqual({ ok: true, paid: 0 });
        expect(calls.map(c => c.to)).toEqual([[VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z]]);
        expect(fake.sent).toEqual([]);
    });

    test('a walk that never arrives reports cant reach after its attempts', async () => {
        const fake = world(LUMBRIDGE, 0);
        let n = 0;
        const stuck: TollGateBot = { walkTo: async () => (n++, { success: false, message: 'no path' }) };
        const r = await travelTo(stuck, asSdk(fake), VARROCK_WEST_BANK, { attempts: 4 });
        expect(r).toEqual({ ok: false, paid: 0, reason: 'cant reach' });
        expect(n).toBe(4);
    });
});
