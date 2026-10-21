import { afterEach, describe, expect, test } from 'bun:test';
import type { InventoryItem } from '../../sdk/types';
import type { WithdrawSpec } from '../lib/bank';
import type { FakeSdk } from '../lib/fake-sdk';
import { borderGuard, guard, pathfinder, tollWorld } from '../lib/fake-toll-gate';
import { inAlKharid, isEastOfTollGate, type Tile } from '../lib/toll-gate';
import type { GiveResult } from '../lib/trade';
import { gameIo, giveOutcome, runHandovers, tollsAfterBank, withdrawSpecs, type Handover, type HandoverIo, type HandoverOptions } from './handover';
import type { RoleContext } from './role';

const AL_KHARID = { x: 3290, z: 3170 };
const AL_KHARID_BANK = { x: 3270, z: 3167 };
const LUMBRIDGE = { x: 3222, z: 3218 };
const VARROCK_WEST_BANK = { x: 3185, z: 3438 };
const VARROCK_WEST_MEET = { x: 3185, z: 3436 };
const H76 = 'cairn_h76';

let ticker: ReturnType<typeof setInterval> | null = null;
afterEach(() => {
    if (ticker) clearInterval(ticker);
    ticker = null;
});

const nameOf = (spec: WithdrawSpec) => (spec.item instanceof RegExp ? spec.item.source.replace(/^\^|\$$/g, '') : String(spec.item));

/** Add `n` of `name` to the inventory, stacking onto what is there. */
function carry(fake: FakeSdk, name: string, n: number): void {
    fake.push(s => {
        const have = s.inventory.find(i => i.name.toLowerCase() === name.toLowerCase());
        if (have) return { inventory: s.inventory.map(i => (i === have ? { ...i, count: i.count + n } : i)) };
        return { inventory: [...s.inventory, { slot: s.inventory.length, id: name === 'Coins' ? 995 : 1000 + s.inventory.length, name, count: n } as InventoryItem] };
    });
}

function drop(fake: FakeSdk, name: string, n: number): void {
    fake.push(s => ({ inventory: s.inventory.flatMap(i => (i.name.toLowerCase() !== name.toLowerCase() ? [i] : i.count > n ? [{ ...i, count: i.count - n }] : [])) }));
}

const delivered = (items: Handover['items']): GiveResult => ({ ok: true, ticks: 3, sent: items.length + 1, gave: items.map(it => ({ slot: -1, id: 0, name: it.item, count: it.n })) });

/**
 * A donor at `at` carrying `carried` coins, border guards on both sides, a
 * pathfinder that stalls at the gate, and the real travel (travelTo). The bank
 * and the trade are stubs that record where they were used.
 */
function setup(at: Tile, carried: number, give?: (fake: FakeSdk, items: Handover['items']) => GiveResult) {
    const fake = tollWorld(at, carried, { nearbyNpcs: [guard(4, 3269, 2), guard(2, 3266, 2)] });
    (fake as unknown as { getBankItems: () => [] }).getBankItems = () => [];
    borderGuard(fake);
    ticker = setInterval(() => fake.tick(), 1);
    const { bot, calls } = pathfinder(fake);
    const logs: string[] = [];
    const ctx = { bot, sdk: fake, account: 'cairn_h41', options: {}, log: (m: string) => logs.push(m), reportBank: () => {}, signal: new AbortController().signal } as unknown as RoleContext;
    const here = () => `${fake.state!.player!.worldX},${fake.state!.player!.worldZ}`;
    const events: string[] = [];
    const withdrawn: WithdrawSpec[][] = [];
    const given: Handover['items'][] = [];
    const io: HandoverIo = {
        travel: gameIo.travel,
        openBank: async () => (events.push(`openBank ${here()}`), true),
        closeBank: async () => {},
        depositAll: async () => {
            events.push('deposit');
            fake.push({ inventory: [] });
        },
        withdraw: async (_, specs) => {
            withdrawn.push(specs);
            for (const s of specs) carry(fake, nameOf(s), s.n as number);
            return { ok: true };
        },
        waitForPartner: async () => true,
        give: async (_, to, items) => {
            events.push(`give ${to} ${here()}`);
            given.push(items);
            if (give) return give(fake, items);
            for (const it of items) drop(fake, it.item, it.n);
            return delivered(items);
        }
    };
    return { fake, ctx, io, events, withdrawn, given, logs, walks: calls };
}

const coinsTo76 = (n: number, o: Partial<HandoverOptions> = {}): HandoverOptions => ({ bank: VARROCK_WEST_BANK, meet: VARROCK_WEST_MEET, handovers: [{ to: H76, items: [{ item: 'Coins', n }] }], ...o });

describe('handover across the Al Kharid toll gate', () => {
    test('donor in Al Kharid, bank and meet in Varrock: pays the toll once, opens only the Varrock bank, delivers', async () => {
        // 2026-10-21: cairn_h41 earning in Al Kharid, 145k for cairn_h76 at Varrock west.
        const t = setup(AL_KHARID, 1566);
        const report = await runHandovers(t.ctx, coinsTo76(145_000), t.io);
        expect(report).toEqual({ done: [H76], uncertain: [], failed: [] });
        expect(t.events).toEqual([
            `openBank ${VARROCK_WEST_BANK.x},${VARROCK_WEST_BANK.z}`,
            'deposit',
            `give ${H76} ${VARROCK_WEST_BANK.x},${VARROCK_WEST_BANK.z}`,
            `openBank ${VARROCK_WEST_BANK.x},${VARROCK_WEST_BANK.z}`,
            'deposit'
        ]);
        // Bank and meet are both west: no toll coins on top of the handover.
        expect(t.withdrawn.map(w => w.map(s => s.n))).toEqual([[145_000]]);
        expect(t.fake.sent.filter(a => a.method === 'sendInteractNpc')).toHaveLength(1);
        // No walk ever asked the pathfinder for a tile across the fence.
        expect(t.walks.every(w => isEastOfTollGate({ x: w.to[0], z: w.to[1] }) === w.fromEast)).toBe(true);
    });

    test('bank in Al Kharid, meet in Varrock: carries the toll out and back, and returns to the Al Kharid bank', async () => {
        const t = setup(AL_KHARID_BANK, 0);
        const report = await runHandovers(t.ctx, coinsTo76(1000, { bank: AL_KHARID_BANK }), t.io);
        expect(report.done).toEqual([H76]);
        expect(t.withdrawn.map(w => w.map(s => [nameOf(s), s.n]))).toEqual([[['Coins', 1020]]]);
        expect(t.given).toEqual([[{ item: 'Coins', n: 1000 }]]);
        expect(t.events.filter(e => e.startsWith('openBank'))).toEqual([`openBank ${AL_KHARID_BANK.x},${AL_KHARID_BANK.z}`, `openBank ${AL_KHARID_BANK.x},${AL_KHARID_BANK.z}`]);
        expect(t.fake.sent.filter(a => a.method === 'sendInteractNpc')).toHaveLength(2);
        expect(inAlKharid(t.fake.state!)).toBe(true);
    });

    test('donor west, bank in Al Kharid: crosses east before opening a bank', async () => {
        const t = setup(LUMBRIDGE, 50);
        const report = await runHandovers(t.ctx, { bank: AL_KHARID_BANK, handovers: [{ to: H76, items: [{ item: 'Rune essence', n: 300 }] }] }, t.io);
        expect(report.done).toEqual([H76]);
        expect(t.events[0]).toBe(`openBank ${AL_KHARID_BANK.x},${AL_KHARID_BANK.z}`);
        // No meet: the trade happens at the bank, so no toll coins are taken.
        expect(t.withdrawn[0]!.map(s => nameOf(s))).toEqual(['Rune essence']);
    });

    test('fewer than 10 coins for the toll: no bank is opened anywhere and the handover stops', async () => {
        const t = setup(AL_KHARID, 5);
        const report = await runHandovers(t.ctx, coinsTo76(145_000), t.io);
        expect(report).toEqual({ done: [], uncertain: [], failed: [H76] });
        expect(t.events).toEqual([]);
        expect(t.walks).toEqual([]);
        expect(t.logs.filter(m => m.includes('not opening a bank'))).toHaveLength(1);
        expect(t.logs).toContain('handover: could not get back to the bank; keeping what is carried');
    });

    test('a route that fails on its own side: retried, but never opens the bank it happens to stand by', async () => {
        const t = setup(LUMBRIDGE, 50);
        (t.ctx.bot as { walkTo: unknown }).walkTo = async () => ({ success: false, message: 'no path' });
        const report = await runHandovers(t.ctx, coinsTo76(145_000), t.io);
        expect(report.failed).toEqual([H76]);
        expect(t.events).toEqual([]);
        expect(t.logs.filter(m => m.includes('not opening a bank'))).toHaveLength(3);
    });
});

describe('trade outcomes are never doubled', () => {
    test('give times out with the coins gone: uncertain, given once, never repeated', async () => {
        const t = setup(LUMBRIDGE, 50, (fake, items) => {
            for (const it of items) drop(fake, it.item, it.n);
            return { ok: false, ticks: 100, gave: [], sent: 2, reason: 'timeout' };
        });
        const report = await runHandovers(t.ctx, coinsTo76(145_000), t.io);
        expect(report).toEqual({ done: [], uncertain: [H76], failed: [] });
        expect(t.given).toHaveLength(1);
        expect(t.logs.some(m => m.includes('outcome uncertain'))).toBe(true);
    });

    test('a trade the giver could not settle is uncertain even with the items still carried', async () => {
        const t = setup(LUMBRIDGE, 50, () => ({ ok: false, ticks: 20, gave: [], sent: 2, reason: 'no settlement seen after declining: my confirm offer is not what was planned' }));
        const report = await runHandovers(t.ctx, coinsTo76(10), t.io);
        expect(report.uncertain).toEqual([H76]);
        expect(t.given).toHaveLength(1);
    });

    test('the partner never answered and nothing left: retried up to three times', async () => {
        const t = setup(LUMBRIDGE, 50, () => ({ ok: false, ticks: 0, gave: [], sent: 0, reason: 'no_response' }));
        const report = await runHandovers(t.ctx, coinsTo76(145_000), t.io);
        expect(report.failed).toEqual([H76]);
        expect(t.given).toHaveLength(3);
    });

    test('giveOutcome', () => {
        const items = [{ item: 'Coins', n: 145_000 }];
        const none = new Map([['coins', 0]]);
        expect(giveOutcome(delivered(items), items, none)).toBe('delivered');
        expect(giveOutcome({ ...delivered(items), gave: [{ slot: -1, id: 995, name: 'Coins', count: 100 }] }, items, none)).toBe('uncertain');
        expect(giveOutcome({ ok: false, ticks: 0, gave: [], sent: 0, reason: 'player_not_found' }, items, none)).toBe('retry');
        expect(giveOutcome({ ok: false, ticks: 5, gave: [], sent: 2, reason: 'partner confirm offer is not acceptable' }, items, none)).toBe('retry');
        expect(giveOutcome({ ok: false, ticks: 5, gave: [], sent: 2, reason: 'closed before completing' }, items, new Map([['coins', 145_000]]))).toBe('uncertain');
    });
});

describe('toll coins for the crossings after the bank', () => {
    test('tollsAfterBank counts the way out to meet and back to bank', () => {
        expect(tollsAfterBank(VARROCK_WEST_BANK, { bank: VARROCK_WEST_BANK, meet: VARROCK_WEST_MEET })).toBe(0);
        expect(tollsAfterBank(AL_KHARID_BANK, { bank: AL_KHARID_BANK, meet: VARROCK_WEST_MEET })).toBe(2);
        expect(tollsAfterBank(AL_KHARID_BANK, { meet: VARROCK_WEST_MEET })).toBe(1);
        expect(tollsAfterBank(AL_KHARID_BANK, { bank: AL_KHARID_BANK })).toBe(0);
    });

    test('withdrawSpecs adds the toll to a coins line, or takes coins on their own', () => {
        expect(withdrawSpecs([{ item: 'Coins', n: 1000 }], 20).map(s => [nameOf(s), s.n])).toEqual([['Coins', 1020]]);
        expect(withdrawSpecs([{ item: 'Air talisman', n: 1 }], 10).map(s => [nameOf(s), s.n, s.asNote])).toEqual([['Air talisman', 1, false], ['Coins', 10, false]]);
        expect(withdrawSpecs([{ item: 'Rune essence', n: 300 }], 0).map(s => [nameOf(s), s.n, s.asNote])).toEqual([['Rune essence', 300, true]]);
    });
});
