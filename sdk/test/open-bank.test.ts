/**
 * Logic test for bot.openBank()'s "already open" shortcut — no bot required.
 *
 * Regression for rs/87: a Grand Exchange window left open after a buy made
 * openBank() answer "Bank already open". The bones role then deposited into
 * nothing, read getBankItems() as [] and decided its 88 banked sharks did not
 * exist (and reported an empty bank to the fleet ledger).
 */

import { describe, expect, test } from 'bun:test';
import { BotSDK } from '../index';
import { BotActions } from '../actions';
import type { BotWorldState } from '../types';

function mount(open: { iface: boolean; bank: boolean }) {
    const state = {
        tick: 1,
        interface: { isOpen: open.iface, interfaceId: open.bank ? 5292 : 26000 },
        bank: { isOpen: open.bank, items: [], noteMode: false },
        dialog: { isOpen: false, options: [], isWaiting: false },
        nearbyLocs: [],
        nearbyNpcs: [],
        gameMessages: []
    } as unknown as BotWorldState;
    const sdk = new BotSDK({ botUsername: 'test' });
    (sdk as any).state = state;
    (sdk as any).getState = () => state;
    const closes: number[] = [];
    (sdk as any).sendCloseModal = async () => {
        closes.push(state.tick);
        state.interface.isOpen = false;
        state.bank.isOpen = false;
        return { success: true, message: 'closed' };
    };
    (sdk as any).waitForCondition = async (pred: (s: BotWorldState) => boolean) => {
        if (!pred(state)) throw new Error('timeout');
        return state;
    };
    (sdk as any).waitForTicks = async () => state;
    (sdk as any).waitForStateChange = async () => state;
    return { bot: new BotActions(sdk), closes };
}

describe('openBank() already-open shortcut', () => {
    test('an open bank is reused', async () => {
        const { bot, closes } = mount({ iface: true, bank: true });
        const r = await bot.openBank();
        expect(r).toMatchObject({ success: true, message: 'Bank already open' });
        expect(closes).toEqual([]);
    });

    test('another open window is closed, not taken for the bank', async () => {
        // No booth or banker in the stub, so after closing the exchange the open fails honestly.
        const { bot, closes } = mount({ iface: true, bank: false });
        const r = await bot.openBank(100);
        expect(closes.length).toBe(1);
        expect(r.success).toBe(false);
        expect(r.message).not.toBe('Bank already open');
    });
});
