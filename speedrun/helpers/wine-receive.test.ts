import { afterEach, describe, expect, test } from 'bun:test';
import type { BotWorldState, InventoryItem } from '../../sdk/types';
import { baseState, FakeSdk, type SentAction } from '../lib/fake-sdk';
import { ITEM } from './wine-common';
import { afterDeposit, depositButtons, receiveWine, splitDelivery, timerHeld, type ReceiverSdk } from './wine-receive';

describe('timerHeld / afterDeposit', () => {
    test('the bank must open before the due tick: the timer phase runs before interactions', () => {
        expect(timerHeld(119, 120)).toBe(true);
        expect(timerHeld(120, 120)).toBe(false);
        expect(afterDeposit(111, 120)).toBe('await-firing');
        expect(afterDeposit(120, 120)).toBe('relog');
        expect(afterDeposit(135, 120)).toBe('relog');
    });
});

describe('depositButtons', () => {
    test('29 is seven 10/5/1 clicks, no count dialog', () => {
        expect(depositButtons(29, 59)).toEqual([10, 10, 5, 1, 1, 1, 1]);
    });
    test('the whole stack is one All; more than ten clicks is one X amount', () => {
        expect(depositButtons(59, 59)).toEqual([-1]);
        expect(depositButtons(80, 59)).toEqual([-1]);
        expect(depositButtons(99, 450)).toEqual([99]);
    });
});

const BOOTH = { id: 2213, name: 'Bank booth', x: 3186, z: 3436, level: 0, distance: 1, options: ['Use-quickly', 'Use'], optionsWithIndex: [{ text: 'Use-quickly', opIndex: 1 }, { text: 'Use', opIndex: 2 }] };
const item = (slot: number, id: number, name: string, count: number): InventoryItem => ({ slot, id, name, count, optionsWithIndex: [] }) as unknown as InventoryItem;
const LEVEL_XP = (level: number) => level * 1_000;

/**
 * A fake engine with the rules the receiver depends on: the booth op opens the
 * bank `rtt` ticks after it is sent, deposits and the close land the tick after
 * that, a make adds one wine, and the fermenting_wine timer fires on the first
 * tick at or after its due tick on which no bank window is open, fermenting
 * every wine in the bank (each good, +1 level). A relog (the test's callback)
 * restarts the tick counter and re-arms the timer at login + 20.
 */
type Phase = 'input' | 'close' | 'interaction';

class FakeEngine {
    readonly sdk = new FakeSdk(baseState({ tick: 100, inGame: true, nearbyLocs: [BOOTH] as never }));
    due = Infinity;
    banked = 0;
    relogs = 0;
    firings: Array<{ tick: number; wines: number }> = [];
    private pending: Array<{ at: number; phase: Phase; fn: (s: BotWorldState) => Partial<BotWorldState> }> = [];
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(readonly loginTick: number, notes: number, level: number, opts: { kit?: boolean; rtt?: number } = {}) {
        const rtt = opts.rtt ?? 1;
        const inv = [item(0, ITEM.wineNote, 'Unfermented wine', notes)];
        if (opts.kit) inv.push(item(1, ITEM.grapes, 'Grapes', 1), item(2, ITEM.jugWater, 'Jug of water', 1));
        this.sdk.state = baseState({ tick: loginTick, inGame: true, nearbyLocs: [BOOTH] as never, inventory: inv, skills: [{ name: 'Cooking', level, baseLevel: level, experience: LEVEL_XP(level) }] as never });
        this.due = loginTick + 20;
        this.sdk.onSend = (a: SentAction) => this.onSend(a, rtt);
    }

    private later(ticks: number, phase: Phase, fn: (s: BotWorldState) => Partial<BotWorldState>): void {
        this.pending.push({ at: this.sdk.state!.tick + ticks, phase, fn });
    }

    private onSend(a: SentAction, rtt: number): void {
        if (a.method === 'sendInteractLoc') this.later(rtt, 'interaction', () => ({ bank: { isOpen: true, items: [], noteMode: false }, interface: { isOpen: true, interfaceId: 5292, options: [], inventories: [] } }));
        if (a.method === 'sendBankDeposit') {
            const amount = a.args[1] as number;
            this.later(rtt, 'input', s => {
                const note = s.inventory.find(i => i.id === ITEM.wineNote);
                if (!note || !s.bank.isOpen) return {};
                const n = amount === -1 ? note.count : Math.min(amount, note.count);
                this.banked += n;
                const left = note.count - n;
                return { inventory: left > 0 ? s.inventory.map(i => (i === note ? { ...i, count: left } : i)) : s.inventory.filter(i => i !== note) };
            });
        }
        if (a.method === 'sendCloseModal') this.later(rtt, 'close', () => ({ bank: { isOpen: false, items: [], noteMode: false }, interface: { isOpen: false, interfaceId: -1, options: [], inventories: [] } }));
        if (a.method === 'sendUseItemOnItem') {
            this.later(rtt, 'input', s => {
                this.due = s.tick + 20;
                const inv = s.inventory.filter(i => i.id !== ITEM.grapes && i.id !== ITEM.jugWater);
                return { inventory: [...inv, item(3, ITEM.wine, 'Unfermented wine', 1)] };
            });
        }
    }

    /** The callback a run passes as `relog`: a new session whose tick counter starts at `newLogin`. */
    relogTo(newLogin: number): () => Promise<number> {
        return async () => {
            this.relogs++;
            this.pending = [];
            this.sdk.state = { ...this.sdk.state!, tick: newLogin, bank: { isOpen: false, items: [], noteMode: false }, interface: { isOpen: false, interfaceId: -1, options: [], inventories: [] } };
            this.due = newLogin + 20;
            newLogin += 1_000;
            return this.sdk.state.tick;
        };
    }

    /** One engine tick in World.ts order: packets, then queues (a requested close), timers, then interactions. */
    private step(): void {
        const t = this.sdk.state!.tick + 1;
        let patch: Partial<BotWorldState> = {};
        let cur: BotWorldState = { ...this.sdk.state!, tick: t };
        const due = this.pending.filter(p => p.at <= t);
        this.pending = this.pending.filter(p => p.at > t);
        const apply = (phase: Phase) => {
            for (const p of due.filter(p => p.phase === phase)) {
                const d = p.fn(cur);
                patch = { ...patch, ...d };
                cur = { ...cur, ...d };
            }
        };
        apply('input');
        apply('close');
        // Timer phase: only when no bank window is open (a modal holds it).
        if (t >= this.due && !cur.bank.isOpen) {
            const wines = this.banked + (cur.inventory.find(i => i.id === ITEM.wine)?.count ?? 0);
            this.firings.push({ tick: t, wines });
            const c = cur.skills[0]!;
            const level = wines > 0 ? c.baseLevel + wines : c.baseLevel;
            patch = { ...patch, skills: [{ ...c, level, baseLevel: level, experience: c.experience + wines * 1_000 }] as never, inventory: cur.inventory.filter(i => i.id !== ITEM.wine) };
            this.banked = 0;
            this.due = Infinity;
            cur = { ...cur, ...patch };
        }
        apply('interaction');
        this.sdk.tick(patch);
    }

    start(): void {
        this.timer = setInterval(() => this.step(), 2);
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
    }
}

let engine: FakeEngine | null = null;
afterEach(() => engine?.stop());

function run(e: FakeEngine): ReceiverSdk {
    engine = e;
    e.start();
    return e.sdk as unknown as ReceiverSdk;
}

describe('receiveWine: the login-timer deadline fallback', () => {
    test('a deposit whose bank opened before login + 20 rides the login timer, no relog', async () => {
        const e = new FakeEngine(100, 29, 1);
        const r = await receiveWine({ sdk: run(e) }, 'maker', { loginTick: 100, relog: e.relogTo(5_000) });
        expect(r.held).toBe(true);
        expect(r.relogs).toBe(0);
        expect(r.deposited).toBe(29);
        expect(r.bankOpenTick).toBeLessThan(120);
        expect(e.relogs).toBe(0);
    });

    test('the bank opening on login + 20 is too late: the wine is still banked, then one clean relog re-arms the timer', async () => {
        const e = new FakeEngine(100, 29, 1, { rtt: 1 });
        e.sdk.state = { ...e.sdk.state!, tick: 119 };
        const r = await receiveWine({ sdk: run(e) }, 'maker', { loginTick: 100, relog: e.relogTo(5_000) });
        expect(r.bankOpenTick).toBe(120);
        expect(r.held).toBe(false);
        expect(r.deposited).toBe(29);
        expect(r.relogs).toBe(1);
        expect(r.loginTick).toBe(5_000);
        // The login timer fired at 120 on an empty bank (between the opening and nothing).
        expect(e.firings).toEqual([{ tick: 120, wines: 0 }]);
    });

    test('a late window with no relog given is an error, never a silent loss', async () => {
        const e = new FakeEngine(100, 29, 1);
        e.sdk.state = { ...e.sdk.state!, tick: 125 };
        await expect(receiveWine({ sdk: run(e) }, 'maker', { loginTick: 100 })).rejects.toThrow(/missed the login timer/);
    });
});

describe('splitDelivery', () => {
    test('on time with the default relog arming: first firing at login + 20, the rest banked before the relog and fermented at the new login + 20', async () => {
        const e = new FakeEngine(100, 59, 1);
        const r = await splitDelivery({ sdk: run(e) }, 'maker', { loginTick: 100, first: 29, relog: e.relogTo(5_000) });
        expect(r.tradeSkipped).toBe(true);
        expect(r.firstHeld).toBe(true);
        expect(r.missRelogs).toBe(0);
        expect(r.firstFermentTick).toBe(120);
        expect(r.arming).toBe('relog');
        expect(r.secondLoginTick).toBe(5_000);
        expect(r.secondFermentTick).toBe(5_020);
        expect(e.firings.map(f => f.wines)).toEqual([29, 30]);
    });

    test('a late first deposit: deposit anyway, relog, and the 29 ferment at the new login + 20', async () => {
        const e = new FakeEngine(100, 59, 1);
        e.sdk.state = { ...e.sdk.state!, tick: 121 };
        const r = await splitDelivery({ sdk: run(e) }, 'maker', { loginTick: 100, first: 29, arming: 'relog', relog: e.relogTo(5_000) });
        expect(r.firstHeld).toBe(false);
        expect(r.missRelogs).toBe(1);
        expect(r.loginTick).toBe(5_000);
        expect(r.firstFermentTick).toBe(5_020);
        expect(r.secondLoginTick).toBe(6_000);
        expect(e.firings.map(f => f.wines)).toEqual([0, 29, 30]);
    });

    test('make arming: the rest is banked and one make re-arms; the made wine ferments with it', async () => {
        const e = new FakeEngine(100, 59, 10, { kit: true });
        const r = await splitDelivery({ sdk: run(e) }, 'maker', { loginTick: 100, first: 29, arming: 'make', relog: e.relogTo(5_000) });
        expect(r.arming).toBe('make');
        expect(r.levelAfterFirst).toBeGreaterThanOrEqual(35);
        expect(r.rearmMakeTick).toBeGreaterThan(r.firstFermentTick);
        expect(r.secondFermentTick).toBe(r.rearmMakeTick + 20);
        expect(e.relogs).toBe(0);
        expect(e.firings.map(f => f.wines)).toEqual([29, 31]);
    });

    test('make arming below Cooking 35 falls back to the relog arming', async () => {
        const e = new FakeEngine(100, 59, 1, { kit: true });
        const r = await splitDelivery({ sdk: run(e) }, 'maker', { loginTick: 100, first: 4, arming: 'make', relog: e.relogTo(5_000) });
        expect(r.levelAfterFirst).toBeLessThan(35);
        expect(r.arming).toBe('relog');
        expect(r.secondFermentTick).toBe(5_020);
    });
});
