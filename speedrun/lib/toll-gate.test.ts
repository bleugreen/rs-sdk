import { afterEach, describe, expect, test } from 'bun:test';
import type { BotWorldState, NearbyLoc, NearbyNpc } from '../../sdk/types';
import { baseState, FakeSdk, type SentAction } from './fake-sdk';
import { crossTollGate, inAlKharid, pickBorderGuard, TOLL_EAST, TOLL_WEST, type TollGateBot, type TollGateSdk } from './toll-gate';

const coins = (count: number) => ({ slot: 0, id: 995, name: 'Coins', count, optionsWithIndex: [] });
const guard = (index: number, x: number, distance: number): NearbyNpc =>
    ({ kind: 'npc', id: 1, index, name: 'Border Guard', combatLevel: 8, x, z: 3228, tileX: x, tileZ: 3228, distance, optionsWithIndex: [{ text: 'Talk-to', opIndex: 1 }] }) as unknown as NearbyNpc;
const gateLoc: NearbyLoc = { id: 2882, name: 'Gate', x: 3268, z: 3227, level: 0, distance: 1, optionsWithIndex: [{ text: 'Open', opIndex: 1 }], options: ['Open'] } as NearbyLoc;

function world(at: { x: number; z: number }, carried: number, extra: Partial<BotWorldState> = {}): FakeSdk {
    return new FakeSdk(
        baseState({
            player: { worldX: at.x, worldZ: at.z, hp: 10, maxHp: 10 } as BotWorldState['player'],
            inventory: carried > 0 ? [coins(carried)] : [],
            ...extra
        })
    );
}

const CHOICE = { isOpen: true, isWaiting: false, pageId: 'choice', options: [
    { index: 1, text: "No thank you, I'll walk around." },
    { index: 2, text: 'Who does my money go to?' },
    { index: 3, text: 'Yes, ok.' }
] };
const CLOSED = { isOpen: false, isWaiting: false, options: [] };

/** The border guard's script: a choice page, then the toll and a walk through, or the broke line. */
function borderGuard(fake: FakeSdk, opts: { refuse?: boolean } = {}): void {
    fake.onSend = (a: SentAction, sdk) => {
        if (a.method === 'sendInteractNpc' || a.method === 'sendInteractLoc') sdk.push({ dialog: CHOICE });
        if (a.method !== 'sendClickDialog') return;
        const s = sdk.state!;
        if (s.dialog.pageId === 'choice' && a.args[0] === 3) {
            const have = s.inventory[0]?.count ?? 0;
            if (opts.refuse || have < 10) {
                sdk.push({ dialog: { isOpen: true, isWaiting: false, pageId: 'broke', options: [], text: "Oh dear, I don't actually seem to have enough money." } });
                return;
            }
            const east = inAlKharid(s);
            const to = east ? TOLL_WEST : TOLL_EAST;
            sdk.push({ dialog: CLOSED, inventory: have > 10 ? [coins(have - 10)] : [], player: { ...s.player!, worldX: to.x, worldZ: to.z } });
        } else if (s.dialog.isOpen) {
            sdk.push({ dialog: CLOSED });
        }
    };
}

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
