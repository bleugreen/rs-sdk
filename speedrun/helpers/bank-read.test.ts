import { describe, expect, test } from 'bun:test';
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { InventoryItem } from '../../sdk/types';
import { baseState, FakeSdk } from '../lib/fake-sdk';
import { censusItems, role } from './bank-read';
import type { RoleContext } from './role';

describe('bank-read census', () => {
    test('items by id with counts; slots only where asked; empties dropped', () => {
        const inv = [
            { slot: 0, id: 536, name: 'Dragon bones', count: 1 },
            { slot: 1, id: -1, name: '', count: 0 },
            { slot: 2, id: 563, name: 'Law rune', count: 1 }
        ];
        expect(censusItems(inv, true)).toEqual([
            { id: 536, name: 'Dragon bones', count: 1, slot: 0 },
            { id: 563, name: 'Law rune', count: 1, slot: 2 }
        ]);
        expect(censusItems(inv, false)).toEqual([
            { id: 536, name: 'Dragon bones', count: 1 },
            { id: 563, name: 'Law rune', count: 1 }
        ]);
        expect(censusItems(undefined, true)).toEqual([]);
    });
});

describe('bank-read role flow: a read that changes nothing', () => {
    const item = (slot: number, id: number, name: string, count = 1) => ({ slot, id, name, count, optionsWithIndex: [] }) as unknown as InventoryItem;

    /**
     * The role on a fake SDK and a recording bot. Every bot method call, every packet the SDK would
     * send and every log line lands in `events`, in order. The bot opens and closes the fake bank; any
     * other bot method is recorded and does nothing.
     */
    const harness = (options: Record<string, unknown> = {}, o: { openFails?: boolean } = {}) => {
        const inventory = [item(0, 536, 'Dragon bones'), item(1, 563, 'Law rune'), item(2, 556, 'Air rune', 5)];
        const equipment = [item(3, 1351, 'Bronze axe')];
        const bank = [item(0, 536, 'Dragon bones', 65), item(1, 534, 'Babydragon bones', 211), item(2, 995, 'Coins', 25)];
        const sdk = new FakeSdk(baseState({ tick: 10, inventory, equipment, bank: { isOpen: false, items: bank, noteMode: false } } as never));
        sdk.state!.player = { ...sdk.state!.player!, worldX: 2945, worldZ: 3368, level: 0 };
        const events: string[] = [];
        const logs: Array<{ m: string; d?: Record<string, unknown> }> = [];
        sdk.onSend = a => events.push(`send:${a.method}`);
        const ext = Object.assign(sdk, {
            isBankOpen: () => sdk.state!.bank.isOpen,
            getBankItems: () => (sdk.state!.bank.isOpen ? sdk.state!.bank.items : []),
            waitForTicks: async () => {
                sdk.tick();
            }
        });
        const impl: Record<string, (...a: unknown[]) => Promise<unknown>> = {
            openBank: async () => {
                if (o.openFails) return { success: false, message: 'no booth' };
                sdk.push({ bank: { ...sdk.state!.bank, isOpen: true } });
                return { success: true, message: 'open' };
            },
            closeBank: async () => {
                sdk.push({ bank: { ...sdk.state!.bank, isOpen: false } });
                return { success: true };
            }
        };
        const bot = new Proxy({}, {
            get: (_t, name: string) => async (...a: unknown[]) => {
                events.push(`bot:${name}`);
                return impl[name] ? impl[name]!(...a) : { success: true, message: 'recorded, not acted' };
            }
        });
        const ctx = {
            sdk: ext as unknown as BotSDK,
            bot: bot as unknown as BotActions,
            account: 'cairn_b01',
            options,
            log: (m: string, d?: Record<string, unknown>) => {
                events.push(`log:${m}`);
                logs.push({ m, ...(d ? { d } : {}) });
            },
            reportBank: () => events.push('reportBank'),
            signal: new AbortController().signal,
            state: {} as never
        } as unknown as RoleContext;
        const before = JSON.stringify({ inventory: sdk.state!.inventory, equipment: sdk.state!.equipment, bank: sdk.state!.bank.items });
        const after = () => JSON.stringify({ inventory: sdk.state!.inventory, equipment: sdk.state!.equipment, bank: sdk.state!.bank.items });
        return { sdk, ctx, events, logs, before, after };
    };

    test('carried is logged first, the bank is read by id while open, then closed; inventory, equipment and bank unchanged; no packet sent', async () => {
        const h = harness();
        await role.run(h.ctx);
        expect(h.events).toEqual(['log:carried', 'bot:openBank', 'log:bank', 'bot:closeBank', 'log:carried after']);
        // No deposit, withdraw, trade, drop, eat, equip or any other packet.
        expect(h.sdk.sent).toEqual([]);
        expect(h.after()).toBe(h.before);
        expect(h.sdk.state!.bank.isOpen).toBe(false);
        const carried = h.logs.find(l => l.m === 'carried')!.d!;
        expect(carried.inventory).toEqual([
            { id: 536, name: 'Dragon bones', count: 1, slot: 0 },
            { id: 563, name: 'Law rune', count: 1, slot: 1 },
            { id: 556, name: 'Air rune', count: 5, slot: 2 }
        ]);
        expect(carried.equipment).toEqual([{ id: 1351, name: 'Bronze axe', count: 1, slot: 3 }]);
        expect(carried.at).toMatchObject({ x: 2945, z: 3368 });
        expect(h.logs.find(l => l.m === 'bank')!.d).toMatchObject({
            items: [
                { id: 536, name: 'Dragon bones', count: 65 },
                { id: 534, name: 'Babydragon bones', count: 211 },
                { id: 995, name: 'Coins', count: 25 }
            ],
            slotsUsed: 3
        });
        expect(h.logs.find(l => l.m === 'carried after')!.d!.inventory).toEqual(carried.inventory);
    });

    test('with a bank option already in reach it still logs carried before anything else, and still sends nothing', async () => {
        const h = harness({ bank: { x: 2946, z: 3368 } });
        await role.run(h.ctx);
        expect(h.events[0]).toBe('log:carried');
        expect(h.events.filter(e => e.startsWith('bot:'))).toEqual(['bot:openBank', 'bot:closeBank']);
        expect(h.sdk.sent).toEqual([]);
        expect(h.after()).toBe(h.before);
    });

    test('an invalid bank option refuses before any action or log', async () => {
        for (const bank of [{ x: 'a', z: 3368 }, { x: 2946 }, { x: 2946.5, z: 3368 }, null]) {
            const h = harness({ bank });
            await expect(role.run(h.ctx)).rejects.toThrow(/options.bank must be \{ x, z \} in whole tiles/);
            expect(h.events).toEqual([]);
            expect(h.sdk.sent).toEqual([]);
        }
    });

    test('a bank that will not open fails after carried is logged, with nothing moved and no bank snapshot', async () => {
        const h = harness({}, { openFails: true });
        await expect(role.run(h.ctx)).rejects.toThrow(/could not open a bank here/);
        expect(h.events[0]).toBe('log:carried');
        expect(h.events.filter(e => e.startsWith('bot:'))).toEqual(['bot:openBank', 'bot:openBank', 'bot:openBank']);
        expect(h.events).not.toContain('log:bank');
        expect(h.sdk.sent).toEqual([]);
        expect(h.after()).toBe(h.before);
    });
});
