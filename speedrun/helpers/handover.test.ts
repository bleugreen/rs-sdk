import { afterEach, describe, expect, test } from 'bun:test';
import type { InventoryItem } from '../../sdk/types';
import type { WithdrawSpec } from '../lib/bank';
import type { FakeSdk } from '../lib/fake-sdk';
import { borderGuard, guard, pathfinder, tollWorld } from '../lib/fake-toll-gate';
import { inAlKharid, isEastOfTollGate, type Tile } from '../lib/toll-gate';
import type { GiveResult } from '../lib/trade';
import { STALLED } from '../lib/wait';
import { refMatches, type ItemRef } from '../lib/items';
import { bankRefusal, finishOf, gameIo, giveOutcome, handoverKey, handoverOptions, leavesKandarin, offerSpecs, runHandovers, tollsAfterBank, withdrawSpecs, type Handover, type HandoverIo, type HandoverOptions } from './handover';
import { memoryRoleState, type RoleContext, type RoleState } from './role';

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

/** Take `n` of a handover line (by name, or by its item's or note's id) out of the inventory. */
function drop(fake: FakeSdk, ref: ItemRef, n: number): void {
    fake.push(s => ({ inventory: s.inventory.flatMap(i => (!refMatches(ref, i) ? [i] : i.count > n ? [{ ...i, count: i.count - n }] : [])) }));
}

const UNF = 'Unfinished potion';
const delivered = (items: Handover['items']): GiveResult => ({ ok: true, ticks: 3, sent: items.length + 1, gave: items.map(it => ({ slot: -1, id: it.id ?? 0, name: it.item ?? UNF, count: it.n })) });

/**
 * A donor at `at` carrying `carried` coins, border guards on both sides, a
 * pathfinder that stalls at the gate, and the real travel (travelTo). The bank
 * and the trade are stubs that record where they were used.
 */
function setup(
    at: Tile,
    carried: number,
    give?: (fake: FakeSdk, items: Handover['items'], to: string) => GiveResult,
    run: { state?: RoleState & { data: Record<string, unknown> }; abort?: AbortController } = {}
) {
    const state = run.state ?? memoryRoleState();
    const abort = run.abort ?? new AbortController();
    const fake = tollWorld(at, carried, { nearbyNpcs: [guard(4, 3269, 2), guard(2, 3266, 2)] });
    (fake as unknown as { getBankItems: () => [] }).getBankItems = () => [];
    borderGuard(fake);
    ticker = setInterval(() => fake.tick(), 1);
    const { bot, calls } = pathfinder(fake);
    const logs: string[] = [];
    const ctx = { bot, sdk: fake, account: 'cairn_h41', options: {}, log: (m: string) => logs.push(m), reportBank: () => {}, signal: abort.signal, state } as unknown as RoleContext;
    const here = () => `${fake.state!.player!.worldX},${fake.state!.player!.worldZ}`;
    const events: string[] = [];
    const withdrawn: WithdrawSpec[][] = [];
    const given: Handover['items'][] = [];
    const io: HandoverIo = {
        travel: gameIo.travel,
        leaveKandarin: async () => {
            throw new Error('no White Wolf Mountain crossing in this test');
        },
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
            if (give) return give(fake, items, to);
            for (const it of items) drop(fake, it, it.n);
            return delivered(items);
        }
    };
    return { fake, ctx, io, events, withdrawn, given, logs, walks: calls, state, abort };
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
            for (const it of items) drop(fake, it, it.n);
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

    test('the partner never answered and nothing left: retried up to three times, and left runnable', async () => {
        const t = setup(LUMBRIDGE, 50, () => ({ ok: false, ticks: 0, gave: [], sent: 0, reason: 'no_response' }));
        const report = await runHandovers(t.ctx, coinsTo76(145_000), t.io);
        expect(report.failed).toEqual([H76]);
        expect(t.given).toHaveLength(3);
        // Nothing moved, so nothing is recorded: running the list again tries again.
        expect(t.state.data).toEqual({});
    });

    test('giveOutcome', () => {
        const items = [{ item: 'Coins', n: 145_000 }];
        const none = new Map([['coins', 0]]);
        expect(giveOutcome(delivered(items), items, none)).toBe('delivered');
        expect(giveOutcome({ ...delivered(items), gave: [{ slot: -1, id: 995, name: 'Coins', count: 100 }] }, items, none)).toBe('uncertain');
        expect(giveOutcome({ ok: false, ticks: 0, gave: [], sent: 0, reason: 'player_not_found' }, items, none)).toBe('retry');
        expect(giveOutcome({ ok: false, ticks: 5, gave: [], sent: 2, reason: 'partner confirm offer is not acceptable' }, items, none)).toBe('retry');
        // a client that went silent mid-trade may have moved the items, like a timeout
        expect(giveOutcome({ ok: false, ticks: 5, gave: [], sent: 2, reason: 'timeout' }, items, none)).toBe('uncertain');
        expect(giveOutcome({ ok: false, ticks: 5, gave: [], sent: 2, reason: STALLED }, items, none)).toBe('uncertain');
        expect(giveOutcome({ ok: false, ticks: 5, gave: [], sent: 2, reason: 'closed before completing' }, items, new Map([['coins', 145_000]]))).toBe('uncertain');
    });
});

describe('a handover list is never repeated by a restarted run', () => {
    const H53 = 'cairn_h53';
    const H54 = 'cairn_h54';
    const H55 = 'cairn_h55';
    const coins = (...to: string[]): HandoverOptions => ({
        bank: VARROCK_WEST_BANK,
        meet: VARROCK_WEST_MEET,
        handovers: to.map(name => ({ to: name, items: [{ item: 'Coins', n: 100_000 }] }))
    });
    /** Who was traded with, from the stub's `give <to> <x>,<z>` events. */
    const receivers = (events: string[]) => events.filter(e => e.startsWith('give ')).map(e => e.split(' ')[1]);

    test('2026-10-21 h63: the list ran to the end and was started again; nothing is withdrawn or given twice', async () => {
        const first = setup(VARROCK_WEST_BANK, 0);
        expect(await runHandovers(first.ctx, coins(H53, H54), first.io)).toEqual({ done: [H53, H54], uncertain: [], failed: [] });
        expect(first.withdrawn.flat().map(s => s.n)).toEqual([100_000, 100_000]);

        // The supervisor's rerun, 17 s later: same account, same options, same role state.
        const again = setup(VARROCK_WEST_BANK, 0, undefined, { state: first.state });
        const report = await runHandovers(again.ctx, coins(H53, H54), again.io);
        expect(report).toEqual({ done: [H53, H54], uncertain: [], failed: [] });
        expect(again.withdrawn).toEqual([]);
        expect(again.given).toEqual([]);
        expect(again.logs.filter(m => m.startsWith('handover: already delivered'))).toHaveLength(2);
    });

    test('restart mid-list: the delivered one is skipped, the one killed mid-trade is uncertain, the rest go out once', async () => {
        const tos: string[] = [];
        // The role dies inside the trade with h54 (a crash, a supervisor restart): give never returns an outcome.
        const first = setup(VARROCK_WEST_BANK, 0, (fake, items, to) => {
            tos.push(to);
            if (to === H54) throw new Error('killed mid-trade');
            for (const it of items) drop(fake, it, it.n);
            return delivered(items);
        });
        await expect(runHandovers(first.ctx, coins(H53, H54, H55), first.io)).rejects.toThrow('killed mid-trade');
        expect(tos).toEqual([H53, H54]);
        expect(first.state.data[handoverKey(coins(H53, H54, H55), 1)]).toMatchObject({ outcome: 'giving', to: H54 });

        const again = setup(VARROCK_WEST_BANK, 0, (fake, items, to) => {
            tos.push(to);
            for (const it of items) drop(fake, it, it.n);
            return delivered(items);
        }, { state: first.state });
        const report = await runHandovers(again.ctx, coins(H53, H54, H55), again.io);
        expect(tos).toEqual([H53, H54, H55]);
        expect(report).toEqual({ done: [H53, H55], uncertain: [H54], failed: [] });
        expect(again.state.data[handoverKey(coins(H53, H54, H55), 1)]).toMatchObject({ outcome: 'uncertain', to: H54 });
        expect(again.logs.some(m => m.includes('stopped during this trade'))).toBe(true);
        expect(finishOf(report).attention).toContain(H54);
    });

    test('stopped between two handovers (a stall, a re-login): the rerun gives only the one left', async () => {
        const abort = new AbortController();
        const first = setup(VARROCK_WEST_BANK, 0, (fake, items) => {
            for (const it of items) drop(fake, it, it.n);
            abort.abort(new Error('stalled'));
            return delivered(items);
        }, { abort });
        await runHandovers(first.ctx, coins(H53, H54), first.io);
        expect(receivers(first.events)).toEqual([H53]);

        const again = setup(VARROCK_WEST_BANK, 0, undefined, { state: first.state });
        const report = await runHandovers(again.ctx, coins(H53, H54), again.io);
        expect(receivers(again.events)).toEqual([H54]);
        expect(report.done).toEqual([H53, H54]);
    });

    test('an uncertain trade stays uncertain on every rerun, and asks for a person', async () => {
        const first = setup(VARROCK_WEST_BANK, 0, (fake, items) => {
            for (const it of items) drop(fake, it, it.n);
            return { ok: false, ticks: 100, gave: [], sent: 2, reason: 'timeout' };
        });
        const report = await runHandovers(first.ctx, coins(H53), first.io);
        expect(finishOf(report)).toEqual({ attention: `handover uncertain to ${H53}: check the receiver before giving again` });
        const again = setup(VARROCK_WEST_BANK, 0, undefined, { state: first.state });
        expect((await runHandovers(again.ctx, coins(H53), again.io)).uncertain).toEqual([H53]);
        expect(again.given).toEqual([]);
        expect(finishOf({ done: [H53], uncertain: [], failed: [] })).toEqual({});
    });

    test('the same transfer on purpose takes a new id', async () => {
        const first = setup(VARROCK_WEST_BANK, 0);
        await runHandovers(first.ctx, coins(H53), first.io);
        const again = setup(VARROCK_WEST_BANK, 0, undefined, { state: first.state });
        await runHandovers(again.ctx, { ...coins(H53), id: 'second-100k' }, again.io);
        expect(again.given).toHaveLength(1);
        expect(handoverKey(coins(H53), 0)).toBe(handoverKey(coins(H53), 0));
        expect(handoverKey(coins(H53), 0)).not.toBe(handoverKey(coins(H54), 0));
        expect(handoverKey({ ...coins(H53), id: 'x' }, 2)).toBe('handover/x/2');
        expect(() => handoverOptions({ id: 'no spaces', handovers: [{ to: H53, items: [{ item: 'Coins', n: 1 }] }] })).toThrow(/options.id/);
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

describe('crossKandarin: a woodcutter at Seers trades on the Lumbridge side', () => {
    // 2026-10-21 (rs/237): cairn_h10 at the Seers magic trees, Firemaking droppers' logs for cairn_mule2 at Draynor.
    const SEERS_MAGIC = { x: 2696, z: 3423 };
    const DRAYNOR_BANK = { x: 3092, z: 3245 };
    const MULE2 = 'cairn_mule2';
    const logs = (o: Partial<HandoverOptions> = {}): HandoverOptions => ({ bank: DRAYNOR_BANK, handovers: [{ to: MULE2, items: [{ item: 'Magic logs', n: 111 }, { item: 'Yew logs', n: 25 }] }], ...o });

    /** Travel and the crossing are stubs that move the player; the plain walk cannot leave Kandarin. */
    function seers() {
        const t = setup(SEERS_MAGIC, 0);
        const moves: string[] = [];
        const at = () => ({ x: t.fake.state!.player!.worldX, z: t.fake.state!.player!.worldZ });
        const moveTo = (to: Tile) => t.fake.push(s => ({ player: { ...s.player!, worldX: to.x, worldZ: to.z } }));
        t.io.travel = async (_, to) => {
            moves.push(`walk ${to.x},${to.z}`);
            if (leavesKandarin(at(), to)) return { ok: false, paid: 0, reason: 'cant reach' };
            moveTo(to);
            return { ok: true, paid: 0 };
        };
        t.io.leaveKandarin = async (_, to) => {
            moves.push(`cross ${to.x},${to.z}`);
            moveTo(to);
            return { ok: true, paid: 0 };
        };
        return { ...t, moves };
    }

    test('leavesKandarin: only a leg from Kandarin to outside it', () => {
        expect(leavesKandarin(SEERS_MAGIC, DRAYNOR_BANK)).toBe(true);
        expect(leavesKandarin(SEERS_MAGIC, { x: 2725, z: 3492 })).toBe(false);
        expect(leavesKandarin(DRAYNOR_BANK, SEERS_MAGIC)).toBe(false);
        expect(leavesKandarin(DRAYNOR_BANK, VARROCK_WEST_BANK)).toBe(false);
    });

    test('with crossKandarin it crosses once, before any bank is opened, and delivers at Draynor', async () => {
        const t = seers();
        const report = await runHandovers(t.ctx, logs({ crossKandarin: true }), t.io);
        expect(report).toEqual({ done: [MULE2], uncertain: [], failed: [] });
        expect(t.moves).toEqual([`cross ${DRAYNOR_BANK.x},${DRAYNOR_BANK.z}`, `walk ${DRAYNOR_BANK.x},${DRAYNOR_BANK.z}`, `walk ${DRAYNOR_BANK.x},${DRAYNOR_BANK.z}`]);
        // Nothing is withdrawn before the crossing: the first bank opened is Draynor's.
        expect(t.events[0]).toBe(`openBank ${DRAYNOR_BANK.x},${DRAYNOR_BANK.z}`);
        expect(t.events).toContain(`give ${MULE2} ${DRAYNOR_BANK.x},${DRAYNOR_BANK.z}`);
        // More than one log is withdrawn as notes.
        expect(t.withdrawn[0]!.every(s => s.asNote)).toBe(true);
    });

    test('without crossKandarin the leg fails and no bank is opened', async () => {
        const t = seers();
        const report = await runHandovers(t.ctx, logs(), t.io);
        expect(report.failed).toEqual([MULE2]);
        expect(t.moves.some(m => m.startsWith('cross'))).toBe(false);
        expect(t.events.some(e => e.startsWith('openBank'))).toBe(false);
    });

    test('a failed crossing ends the attempt before the bank', async () => {
        const t = seers();
        t.io.leaveKandarin = async () => ({ ok: false, paid: 0, reason: 'kandarin: died walking to Taverley' });
        const report = await runHandovers(t.ctx, logs({ crossKandarin: true }), t.io);
        expect(report.failed).toEqual([MULE2]);
        expect(t.events.some(e => e.startsWith('openBank'))).toBe(false);
        expect(t.given).toHaveLength(0);
    });

    test('the option is a boolean, absent by default', () => {
        expect(handoverOptions(logs({ crossKandarin: true }) as unknown as Record<string, unknown>).crossKandarin).toBe(true);
        expect(handoverOptions(logs() as unknown as Record<string, unknown>).crossKandarin).toBeUndefined();
        expect(() => handoverOptions({ ...logs(), crossKandarin: 'yes' } as unknown as Record<string, unknown>)).toThrow(/crossKandarin/);
    });
});

// obj.pack: 91 guamvial / 92 cert_guamvial and 99 ranarrvial / 100 cert_ranarrvial, all named
// "Unfinished potion" in this revision; 563 lawrune has no note.
describe('id-addressed items (H21e: one unfinished potion type apart from another)', () => {
    const GUAM = 91;
    const GUAM_NOTE = 92;
    const RANARR = 99;
    const RANARR_NOTE = 100;
    const H84 = 'cairn_h84';
    const MULE1 = 'cairn_mule1';
    const unfs = (items: Handover['items']): HandoverOptions => ({ bank: VARROCK_WEST_BANK, handovers: [{ to: MULE1, items }] });
    const asRaw = (o: HandoverOptions) => o as unknown as Record<string, unknown>;
    const potion = (slot: number, id: number, count: number) => ({ slot, id, name: UNF, count }) as InventoryItem;

    test('options take id or item (exactly one); a note id cannot be noted: false; name lines keep their shape', () => {
        const o = handoverOptions(asRaw(unfs([{ id: GUAM_NOTE, n: 100 }, { id: RANARR, n: 50, noted: true }, { item: 'Eye of newt', n: 50 }])));
        expect(o.handovers[0]!.items).toEqual([{ id: GUAM_NOTE, n: 100 }, { id: RANARR, n: 50, noted: true }, { item: 'Eye of newt', n: 50 }]);
        // The default list id is a digest of the options: a name-only list digests as it always did.
        expect(handoverOptions({ handovers: [{ to: H84, items: [{ item: 'Coins', n: 1 }] }] }).handovers[0]!.items[0]).toEqual({ item: 'Coins', n: 1 });
        const bad = (item: Record<string, unknown>) => () => handoverOptions({ handovers: [{ to: MULE1, items: [item] }] });
        expect(bad({ item: UNF, id: GUAM, n: 1 })).toThrow(/exactly one of item/);
        expect(bad({ n: 1 })).toThrow(/exactly one of item/);
        expect(bad({ id: 9_999_999, n: 1 })).toThrow(/not in obj.pack/);
        expect(bad({ id: GUAM_NOTE, n: 1, noted: false })).toThrow(/is a note/);
        expect(bad({ id: GUAM, n: 0 })).toThrow(/positive n/);
    });

    test('noted ids round-trip: withdrawn from the bank by the item id, offered by the note id', () => {
        const items: Handover['items'] = [{ id: GUAM_NOTE, n: 1 }, { id: RANARR, n: 50 }, { id: GUAM, n: 1 }, { id: 563, n: 4 }];
        // The bank holds the item, never the note; a note's id or more than one asks for notes.
        expect(withdrawSpecs(items, 0).map(s => [s.item, s.n, s.asNote])).toEqual([[GUAM, 1, true], [RANARR, 50, true], [GUAM, 1, false], [563, 4, true]]);
        // Carried after a noted withdrawal: the notes, offered by their own ids.
        const carried = [potion(0, GUAM_NOTE, 1), potion(1, RANARR_NOTE, 50), { slot: 2, id: 563, name: 'Law rune', count: 4 } as InventoryItem];
        expect(offerSpecs([{ id: GUAM, n: 1 }, { id: RANARR_NOTE, n: 50 }, { id: 563, n: 4 }], carried)).toEqual([{ item: GUAM_NOTE, n: 1 }, { item: RANARR_NOTE, n: 50 }, { item: 563, n: 4 }]);
        // Carried unnoted (a single potion): offered by the item id.
        expect(offerSpecs([{ id: GUAM_NOTE, n: 1 }], [potion(0, GUAM, 1)])).toEqual([{ item: GUAM, n: 1 }]);
    });

    test('the bank refuses a shared name (give the id) and a short stack; ids pick their own stack', () => {
        const bank = [{ slot: 0, id: GUAM, name: UNF, count: 300 }, { slot: 1, id: RANARR, name: UNF, count: 40 }];
        expect(bankRefusal(withdrawSpecs([{ item: UNF, n: 100 }], 0), bank)?.reason).toMatch(/names obj 91 and obj 99: give the id/);
        expect(bankRefusal(withdrawSpecs([{ id: GUAM, n: 100 }, { id: RANARR_NOTE, n: 40 }], 0), bank)).toBeNull();
        const short = bankRefusal(withdrawSpecs([{ id: GUAM, n: 100 }, { id: RANARR, n: 50 }], 0), bank);
        expect(short?.reason).toBe('bank: 99 40/50');
        expect(short?.missing.map(s => s.item)).toEqual([RANARR]);
    });

    test('delivered needs each id given in full: another potion type of the same name does not count', () => {
        const items: Handover['items'] = [{ id: GUAM, n: 100 }, { id: RANARR, n: 50 }];
        const gave = (...g: [number, number][]): GiveResult => ({ ok: true, ticks: 3, sent: 3, gave: g.map(([id, count]) => ({ slot: -1, id, name: UNF, count })) });
        expect(giveOutcome(gave([GUAM_NOTE, 100], [RANARR_NOTE, 50]), items, new Map())).toBe('delivered');
        expect(giveOutcome(gave([GUAM_NOTE, 150]), items, new Map())).toBe('uncertain');
    });

    test('two potion types of one name are withdrawn, offered and counted apart', async () => {
        const t = setup(VARROCK_WEST_BANK, 0);
        let offered: unknown = null;
        t.io.withdraw = async (_, specs) => {
            t.withdrawn.push(specs);
            t.fake.push(s => ({
                inventory: specs.map((sp, slot) => potion(slot, sp.item === GUAM ? (sp.asNote ? GUAM_NOTE : GUAM) : sp.asNote ? RANARR_NOTE : RANARR, sp.n as number))
            }));
            return { ok: true };
        };
        // The partner takes the guam and the ranarr leaves too, but the trade reports only the guam.
        t.io.give = async (ctx, to, items) => {
            t.given.push(items);
            offered = offerSpecs(items, ctx.sdk.getInventory());
            drop(t.fake, { id: GUAM }, 100);
            return { ok: true, ticks: 3, sent: 3, gave: [{ slot: -1, id: GUAM_NOTE, name: UNF, count: 100 }] };
        };
        const report = await runHandovers(t.ctx, unfs([{ id: GUAM, n: 100 }, { id: RANARR_NOTE, n: 50 }]), t.io);
        expect(t.withdrawn[0]!.map(s => [s.item, s.n, s.asNote])).toEqual([[GUAM, 100, true], [RANARR, 50, true]]);
        expect(offered).toEqual([{ item: GUAM_NOTE, n: 100 }, { item: RANARR_NOTE, n: 50 }]);
        // 100 guam notes given is not 50 ranarr: the handover is uncertain, never repeated.
        expect(report).toEqual({ done: [], uncertain: [MULE1], failed: [] });
        expect(t.given).toHaveLength(1);
    });
});
