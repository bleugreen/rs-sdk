import { describe, expect, test } from 'bun:test';
import type { BankState, InventoryItem } from '../../sdk/types';
import { depositAll, depositMatching, NOTE_MODE_OFF, NOTE_MODE_ON, planDeposits, planWithdraws, slotSafe, withdrawMany } from './bank';
import { baseState, FakeSdk } from './fake-sdk';
import { amountButtons } from './items';

const inv = (slot: number, id: number, name: string, count = 1): InventoryItem => ({ slot, id, name, count, optionsWithIndex: [] });
const bank = (items: Array<[number, number, string, number]>, noteMode = false): BankState => ({
    isOpen: true,
    noteMode,
    items: items.map(([slot, id, name, count]) => ({ slot, id, name, count })),
});

describe('planDeposits', () => {
    test('one entry per distinct id, first slot', () => {
        const plan = planDeposits([inv(3, 440, 'Iron ore'), inv(0, 440, 'Iron ore'), inv(1, 1511, 'Logs'), inv(2, 995, 'Coins', 50)]);
        expect(plan).toEqual([
            { slot: 0, id: 440, name: 'Iron ore' },
            { slot: 1, id: 1511, name: 'Logs' },
            { slot: 2, id: 995, name: 'Coins' },
        ]);
    });

    test('patterns filter by id, substring and regexp', () => {
        const items = [inv(0, 440, 'Iron ore'), inv(1, 1511, 'Logs'), inv(2, 995, 'Coins'), inv(3, 1521, 'Oak logs')];
        expect(planDeposits(items, [995]).map(p => p.id)).toEqual([995]);
        expect(planDeposits(items, ['logs']).map(p => p.id)).toEqual([1511, 1521]);
        expect(planDeposits(items, [/^iron/i, 995]).map(p => p.id)).toEqual([440, 995]);
    });
});

describe('amountButtons', () => {
    test('single buttons and All', () => {
        expect(amountButtons(1, 100)).toEqual([1]);
        expect(amountButtons(5, 100)).toEqual([5]);
        expect(amountButtons(10, 100)).toEqual([10]);
        expect(amountButtons(100, 100)).toEqual([-1]);
        expect(amountButtons(500, 100)).toEqual([-1]);
    });

    test('up to three 10/5/1 clicks, else X', () => {
        expect(amountButtons(2, 100)).toEqual([1, 1]);
        expect(amountButtons(15, 100)).toEqual([10, 5]);
        expect(amountButtons(25, 100)).toEqual([10, 10, 5]);
        expect(amountButtons(30, 100)).toEqual([10, 10, 10]);
        expect(amountButtons(4, 100)).toEqual([4]);
        expect(amountButtons(28, 100)).toEqual([28]);
    });
});

describe('planWithdraws', () => {
    test('descending bank slot so a stack leaving does not shift later sends', () => {
        const b = bank([[0, 1, 'A', 5], [1, 2, 'B', 5], [2, 3, 'C', 5]]);
        const plan = planWithdraws(b, [{ item: 'A', n: 'all' }, { item: 'C', n: 'all' }, { item: 'B', n: 'all' }]);
        expect(plan.sends.map(s => (s.kind === 'withdraw' ? s.slot : 'note'))).toEqual([2, 1, 0]);
        expect(plan.sends.every(s => s.kind === 'withdraw' && s.amount === -1)).toBe(true);
    });

    test('groups by note mode, current mode first, one toggle', () => {
        const b = bank([[0, 1, 'A', 5], [1, 2, 'B', 50], [2, 3, 'C', 5], [3, 4, 'D', 50]]);
        const plan = planWithdraws(b, [
            { item: 'A', n: 1 },
            { item: 'B', n: 10, asNote: true },
            { item: 'C', n: 1 },
            { item: 'D', n: 10, asNote: true },
        ]);
        expect(plan.sends).toEqual([
            { kind: 'withdraw', spec: 2, slot: 2, id: 3, name: 'C', amount: 1 },
            { kind: 'withdraw', spec: 0, slot: 0, id: 1, name: 'A', amount: 1 },
            { kind: 'note', noteMode: true, component: NOTE_MODE_ON },
            { kind: 'withdraw', spec: 3, slot: 3, id: 4, name: 'D', amount: 10 },
            { kind: 'withdraw', spec: 1, slot: 1, id: 2, name: 'B', amount: 10 },
        ]);
        expect(plan.finalNoteMode).toBe(true);
    });

    test('no toggle when every spec matches the current mode', () => {
        const b = bank([[0, 1, 'A', 50]], true);
        const plan = planWithdraws(b, [{ item: 'A', n: 'all', asNote: true }]);
        expect(plan.sends.filter(s => s.kind === 'note')).toEqual([]);
    });

    test('falls back to global descending order when grouping is not slot-safe', () => {
        // Item-mode A at slot 0 may empty (All); note-mode B at slot 5 would shift if grouped after A.
        const b = bank([[0, 1, 'A', 3], [5, 2, 'B', 50]]);
        const plan = planWithdraws(b, [{ item: 'A', n: 'all' }, { item: 'B', n: 10, asNote: true }]);
        // Either B first (needs toggle on, then off for A) or descending: both put slot 5 before slot 0.
        const slots = plan.sends.filter(s => s.kind === 'withdraw').map(s => (s.kind === 'withdraw' ? s.slot : -1));
        expect(slots).toEqual([5, 0]);
        expect(slotSafe(plan.sends.filter(s => s.kind === 'withdraw').map(s => ({ slot: (s as { slot: number }).slot, mayEmpty: (s as { amount: number }).amount === -1 })))).toBe(true);
    });

    test('X amounts go last', () => {
        const b = bank([[0, 1, 'A', 100], [1, 2, 'B', 100], [2, 3, 'C', 100]]);
        const plan = planWithdraws(b, [{ item: 'C', n: 28 }, { item: 'A', n: 10 }, { item: 'B', n: 1 }]);
        const amounts = plan.sends.map(s => (s.kind === 'withdraw' ? `${s.name}${s.amount}` : 'note'));
        expect(amounts).toEqual(['B1', 'A10', 'C28']);
    });

    test('fill and all map to one Withdraw-All; missing specs are reported', () => {
        const b = bank([[4, 440, 'Iron ore', 300]]);
        const plan = planWithdraws(b, [{ item: 'Iron ore', n: 'fill' }, { item: 'Rune ore', n: 1 }]);
        expect(plan.sends).toEqual([{ kind: 'withdraw', spec: 0, slot: 4, id: 440, name: 'Iron ore', amount: -1 }]);
        expect(plan.missing).toEqual([{ item: 'Rune ore', n: 1 }]);
    });

    test('restoreNoteMode appends the toggle back', () => {
        const b = bank([[0, 1, 'A', 50]]);
        const plan = planWithdraws(b, [{ item: 'A', n: 'all', asNote: true }], { restoreNoteMode: true });
        expect(plan.sends.map(s => s.kind === 'note' ? s.component : 'w')).toEqual([NOTE_MODE_ON, 'w', NOTE_MODE_OFF]);
        expect(plan.finalNoteMode).toBe(false);
    });
});

describe('depositAll', () => {
    test('fires every deposit before the first state change, then confirms once', async () => {
        const sdk = new FakeSdk(baseState({
            tick: 10,
            bank: { isOpen: true, items: [], noteMode: false },
            inventory: [inv(0, 1, 'A'), inv(1, 1, 'A'), inv(2, 2, 'B', 10), inv(3, 3, 'C')],
        }));
        const p = depositAll(sdk as never);
        expect(sdk.sent.map(s => s.args)).toEqual([[0, -1], [2, -1], [3, -1]]);
        sdk.tick();
        sdk.tick({ inventory: [] });
        const r = await p;
        expect(r).toEqual({ ok: true, ticks: 2, sent: 3, remaining: [] });
    });

    test('refuses when the bank is closed', async () => {
        const sdk = new FakeSdk(baseState({ inventory: [inv(0, 1, 'A')] }));
        expect((await depositAll(sdk as never)).reason).toBe('bank_not_open');
        expect(sdk.sent).toEqual([]);
    });

    test('reports what remained on timeout (full bank)', async () => {
        const sdk = new FakeSdk(baseState({
            tick: 0,
            bank: { isOpen: true, items: [], noteMode: false },
            inventory: [inv(0, 1, 'A'), inv(1, 2, 'B')],
        }));
        const p = depositMatching(sdk as never, ['A', 'B']);
        for (let i = 0; i < 6; i++) sdk.tick({ inventory: [inv(1, 2, 'B')] });
        const r = await p;
        expect(r.ok).toBe(false);
        expect(r.reason).toBe('timeout');
        expect(r.remaining.map(i => i.name)).toEqual(['B']);
    });
});

describe('withdrawMany', () => {
    test('confirms on expected counts', async () => {
        const sdk = new FakeSdk(baseState({
            tick: 0,
            bank: bank([[0, 1, 'A', 50], [1, 2, 'B', 3]]),
            inventory: [],
        }));
        const p = withdrawMany(sdk as never, [{ item: 'A', n: 10 }, { item: 'B', n: 'all' }]);
        expect(sdk.sent.map(s => [s.method, ...s.args])).toEqual([
            ['sendBankWithdraw', 1, -1],
            ['sendBankWithdraw', 0, 10],
        ]);
        sdk.tick({ inventory: [inv(0, 2, 'B', 3), inv(1, 1, 'A', 10)] });
        const r = await p;
        expect(r.ok).toBe(true);
        expect(r.ticks).toBe(1);
        expect([...r.gained]).toEqual([['A', 10], ['B', 3]]);
        expect(r.partial).toBe(false);
    });

    test('a full inventory ends the wait as a partial fill', async () => {
        const sdk = new FakeSdk(baseState({ tick: 0, bank: bank([[0, 440, 'Iron ore', 300]]), inventory: [] }));
        const p = withdrawMany(sdk as never, [{ item: 'Iron ore', n: 'fill' }]);
        sdk.tick({ inventory: Array.from({ length: 28 }, (_, i) => inv(i, 440, 'Iron ore')) });
        const r = await p;
        expect(r.ok).toBe(true);
        expect(r.partial).toBe(true);
        expect(r.gained.get('Iron ore')).toBe(28);
    });
});
