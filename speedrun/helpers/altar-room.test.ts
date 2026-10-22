import { describe, expect, test } from 'bun:test';
import { FakeSdk } from '../lib/fake-sdk';
import { fakeClock, peek, tickEvery, useFakeTicks } from '../lib/fake-ticks';
import { IDLE_TICKS } from '../lib/wait';
import { baseState } from '../lib/fake-sdk';
import { altarData, altarRoomOf, bankWithdrawals, holdsItems, until } from './altar-room';

describe('altarRoomOf', () => {
    const at = (worldX: number, worldZ: number, level = 0) => baseState({ player: { worldX, worldZ, level } as never });
    test("names the room a helper was left in (cairn_h75 in the air room after rs/196's demo), null outside", () => {
        expect(altarRoomOf(at(2844, 4832))).toBe('air');
        expect(altarRoomOf(at(2946, 3368))).toBeNull();
        expect(altarRoomOf(baseState({}))).toBeNull();
    });
});

describe('bankWithdrawals: an essence load, or the hand-back once the essence has run out', () => {
    const body = altarData('body');
    const RUNES = [
        { item: 'Law rune', n: 1 },
        { item: 'Air rune', n: 3 },
        { item: 'Earth rune', n: 1 }
    ];
    const bankRunes = [
        { name: 'Law rune', count: 1 },
        { name: 'Air rune', count: 3 },
        { name: 'Earth rune', count: 1 }
    ];
    const withTalisman = baseState({ inventory: [{ slot: 0, id: 1446, name: 'Body talisman', count: 1, optionsWithIndex: [] }] });
    const names = (r: ReturnType<typeof bankWithdrawals>) => r.specs.map(s => [s.item.source, s.n]);

    test('a bank that can make a load gives essence, the hand-back staying banked', () => {
        const r = bankWithdrawals([{ name: 'Rune essence', count: 27 }, ...bankRunes], withTalisman, body, { essence: 27, handBack: RUNES });
        expect(r.runesOnly).toBe(false);
        expect(names(r)).toEqual([['^rune essence$', 27]]);
    });

    test('the hand-back giver whose essence ran out takes exactly the runes, no essence (the runes-only trip)', () => {
        const r = bankWithdrawals([{ name: 'Rune essence', count: 26 }, ...bankRunes, { name: 'Air rune', count: 50 }], withTalisman, body, { essence: 27, handBack: RUNES });
        expect(r.runesOnly).toBe(true);
        expect(names(r)).toEqual([['^Law rune$', 1], ['^Air rune$', 3], ['^Earth rune$', 1]]);
    });

    test('the talisman comes too when none is carried', () => {
        const r = bankWithdrawals([{ name: 'Body talisman', count: 1 }, ...bankRunes], baseState({ inventory: [] }), body, { essence: 27, handBack: RUNES });
        expect(r.runesOnly).toBe(true);
        expect(names(r)[0]).toEqual([body.talisman.source, 1]);
    });

    test('short of essence and of a rune, or not a hand-back giver: the bank is short, nothing is taken', () => {
        expect(bankWithdrawals([{ name: 'Law rune', count: 1 }, { name: 'Air rune', count: 3 }], withTalisman, body, { essence: 27, handBack: RUNES })).toEqual({ specs: [], runesOnly: false });
        expect(bankWithdrawals(bankRunes, withTalisman, body, { essence: 27 })).toEqual({ specs: [], runesOnly: false });
    });

    test('holdsItems counts each item by its exact name', () => {
        const inv = (items: [string, number][]) => baseState({ inventory: items.map(([name, count], slot) => ({ slot, id: 550 + slot, name, count, optionsWithIndex: [] })) });
        expect(holdsItems(inv([['Law rune', 1], ['Air rune', 3], ['Earth rune', 1]]), RUNES)).toBe(true);
        expect(holdsItems(inv([['Law rune', 1], ['Air rune', 2], ['Earth rune', 1]]), RUNES)).toBe(false);
        expect(holdsItems(inv([['Law rune', 1], ['Dust rune', 3], ['Earth rune', 1]]), RUNES)).toBe(false);
        expect(holdsItems(inv([]), [])).toBe(false);
    });
});

describe('until', () => {
    useFakeTicks();

    test('counts 2 x (ticks + 5) ticks however slowly they come (30 at 340 ms is 10.2 s, past the old 9 s budget)', async () => {
        const sdk = new FakeSdk();
        const ctx = { sdk: sdk as never };
        const hit = until(ctx, s => s.tick >= 130, 10);
        const miss = until(ctx, () => false, 10);
        tickEvery(sdk, 340, 30);
        expect(await hit).toBe(true);
        expect(await peek(miss)).toBeUndefined();
        tickEvery(sdk, 340, 1);
        expect(await miss).toBe(false);
    });

    test('a client that stops publishing ends it false', async () => {
        const sdk = new FakeSdk();
        const p = until({ sdk: sdk as never }, () => false, 1_000);
        fakeClock.advanceTimersByTime(IDLE_TICKS * 300);
        expect(await p).toBe(false);
    });
});
