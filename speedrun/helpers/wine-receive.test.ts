import { afterEach, describe, expect, test } from 'bun:test';
import type { BotWorldState, InventoryItem } from '../../sdk/types';
import { baseState, FakeSdk, type SentAction } from '../lib/fake-sdk';
import { ITEM } from './wine-common';
import { fakeClock, peek, tickEvery, useFakeTicks } from '../lib/fake-ticks';
import { IDLE_TICKS, STALLED } from '../lib/wait';
import { afterDeposit, awaitFiring, depositButtons, drainChat, receiveWine, SECOND_WAIT_SLACK, splitDelivery, splitStage, timerHeld, wineBankOf, type ReceiverSdk } from './wine-receive';

describe('timerHeld / afterDeposit', () => {
    test('the bank must open before the due tick: the timer phase runs before interactions', () => {
        expect(timerHeld(119, 120)).toBe(true);
        expect(timerHeld(120, 120)).toBe(false);
        expect(afterDeposit(111, 120)).toBe('await-firing');
        expect(afterDeposit(120, 120)).toBe('relog');
        expect(afterDeposit(135, 120)).toBe('relog');
    });
});

describe('waits on a slow minute (fake timers)', () => {
    useFakeTicks();
    const cookingXp = (experience: number) => ({ skills: [{ name: 'Cooking', level: 40, baseLevel: 40, experience }] as never });

    test('awaitFiring 300 ticks out at 340 ms a tick sees the firing on its due tick (102 s, past the old 97 s budget)', async () => {
        const sdk = new FakeSdk(baseState({ tick: 0, ...cookingXp(1_000) }));
        const p = awaitFiring(sdk, 300);
        tickEvery(sdk, 340, 299);
        expect(await peek(p)).toBeUndefined();
        tickEvery(sdk, 340, 1, cookingXp(1_100));
        expect(await p).toMatchObject({ fired: true, tick: 300, xpGained: 100 });
    });

    test('a client that stops publishing ends drainChat as STALLED, and awaitFiring as not fired', async () => {
        const sdk = new FakeSdk(baseState({ tick: 0, ...cookingXp(1_000) }));
        const drain = drainChat(sdk);
        const firing = awaitFiring(sdk, 300);
        fakeClock.advanceTimersByTime(IDLE_TICKS * 300 - 1);
        expect(await peek(drain)).toBeUndefined();
        fakeClock.advanceTimersByTime(1);
        expect(await drain).toMatchObject({ ok: false, reason: STALLED });
        expect(await firing).toMatchObject({ fired: false, tick: -1 });
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

/** Every send with the tick it went out on. */
function recordTicks(e: FakeEngine): Array<[number, string, unknown[]]> {
    const out: Array<[number, string, unknown[]]> = [];
    const orig = e.sdk.onSend;
    e.sdk.onSend = (a, f) => {
        out.push([e.sdk.state!.tick, a.method, a.args]);
        orig(a, f);
    };
    return out;
}

describe('splitDelivery window hooks (S25c, skills/cooking.ts)', () => {
    test('no windows: exactly the packets, on exactly the ticks, the split sent before the hooks existed', async () => {
        // captured from agent/rs-186-coordinator-0 at 023d8842, before the hooks
        const e = new FakeEngine(100, 59, 1);
        const seq = recordTicks(e);
        await splitDelivery({ sdk: run(e) }, 'maker', { loginTick: 100, first: 29, relog: e.relogTo(5_000) });
        expect(seq).toEqual([
            [100, 'sendInteractLoc', [3186, 3436, 2213, 1]],
            [101, 'sendBankDeposit', [0, 10]],
            [101, 'sendBankDeposit', [0, 10]],
            [101, 'sendBankDeposit', [0, 5]],
            [101, 'sendBankDeposit', [0, 1]],
            [101, 'sendBankDeposit', [0, 1]],
            [101, 'sendBankDeposit', [0, 1]],
            [101, 'sendBankDeposit', [0, 1]],
            [101, 'sendCloseModal', []],
            [120, 'sendInteractLoc', [3186, 3436, 2213, 1]],
            [121, 'sendBankDeposit', [0, -1]],
            [121, 'sendCloseModal', []]
        ]);
    });

    test('the hooks fire at their points: bursts before each close, the waits beside each firing with its due tick', async () => {
        const e = new FakeEngine(100, 59, 1);
        const seq = recordTicks(e);
        const calls: string[] = [];
        const sdk = run(e);
        const r = await splitDelivery({ sdk }, 'maker', {
            loginTick: 100,
            first: 29,
            relog: e.relogTo(5_000),
            windows: {
                firstBurst: s => {
                    calls.push(`firstBurst bank open ${s.bank.isOpen}`);
                    void e.sdk.sendBankWithdraw(7, -1);
                    void e.sdk.sendBankWithdraw(8, -1);
                    return 2;
                },
                firstWait: async due => {
                    calls.push(`firstWait ${due} at ${sdk.getState()!.tick}`);
                },
                restBurst: () => {
                    calls.push('restBurst');
                    void e.sdk.sendBankDeposit(5, -1);
                    return 1;
                },
                secondWait: async due => {
                    calls.push(`secondWait ${due} at ${sdk.getState()!.tick}`);
                }
            }
        });
        expect(calls).toEqual(['firstBurst bank open true', 'firstWait 120 at 102', 'restBurst', 'secondWait 5020 at 5000']);
        // burst 1: the seven 29 buttons, the two withdrawals, then the close; P1: All, the gem deposit, the close
        expect(seq.filter(x => x[0] === 101).map(x => `${x[1]} ${JSON.stringify(x[2])}`)).toEqual([
            ...['[0,10]', '[0,10]', '[0,5]', '[0,1]', '[0,1]', '[0,1]', '[0,1]'].map(a => `sendBankDeposit ${a}`),
            'sendBankWithdraw [7,-1]',
            'sendBankWithdraw [8,-1]',
            'sendCloseModal []'
        ]);
        expect(seq.filter(x => x[0] === 121).map(x => x[1])).toEqual(['sendBankDeposit', 'sendBankDeposit', 'sendCloseModal']);
        expect(r.firstFermentTick).toBe(120);
        expect(r.secondFermentTick).toBe(5_020);
        // secondWait replaces the final drainChat: it owns the second firing's pages
        expect(r.finalPages).toBe(0);
        expect(e.firings.map(f => f.wines)).toEqual([29, 30]);
    });

    test('a window still running past the firing: the split waits for both, and a window failure is the split failure', async () => {
        const e = new FakeEngine(100, 59, 1);
        const sdk = run(e);
        let windowEnd = -1;
        const r = await splitDelivery({ sdk }, 'maker', {
            loginTick: 100,
            first: 29,
            relog: e.relogTo(5_000),
            windows: {
                secondWait: async () => {
                    await e.sdk.waitForCondition(st => st.tick >= 5_030, 10_000);
                    windowEnd = sdk.getState()!.tick;
                }
            }
        });
        expect(r.secondFermentTick).toBe(5_020);
        expect(windowEnd).toBe(5_030);
        const e2 = new FakeEngine(100, 59, 1);
        await expect(splitDelivery({ sdk: run(e2) }, 'maker', { loginTick: 100, first: 29, relog: e2.relogTo(5_000), windows: { firstWait: async () => { throw new Error('gem window faulted'); } } })).rejects.toThrow('gem window faulted');
    });

    test(`the second firing is awaited with ${SECOND_WAIT_SLACK} ticks of slack under a window (its bank visits hold the timer)`, async () => {
        const e = new FakeEngine(100, 59, 1);
        const sdk = run(e);
        const r = await splitDelivery({ sdk }, 'maker', {
            loginTick: 100,
            first: 29,
            relog: e.relogTo(5_000),
            windows: {
                // a bank visit open across the due tick, closed at 5,024
                secondWait: async () => {
                    await e.sdk.waitForCondition(st => st.tick >= 5_018, 10_000);
                    void e.sdk.sendInteractLoc(3186, 3436, 2213, 1);
                    await e.sdk.waitForCondition(st => st.tick >= 5_023, 10_000);
                    void e.sdk.sendCloseModal();
                }
            }
        });
        expect(r.secondFermentTick).toBe(5_024);
        expect(r.levelAfterSecond).toBeGreaterThan(r.levelAfterFirst);
    });
});

describe('splitStage and the resume stages', () => {
    test('splitStage: one stage per row of the resume table', () => {
        expect(splitStage(0, { unfermented: 0, fermented: 0 })).toBe('trade');
        expect(splitStage(520, { unfermented: 0, fermented: 0 })).toBe('deposit-first');
        expect(splitStage(491, { unfermented: 29, fermented: 0 })).toBe('await-first');
        expect(splitStage(491, { unfermented: 0, fermented: 29 })).toBe('deposit-rest');
        expect(splitStage(0, { unfermented: 491, fermented: 29 })).toBe('await-second');
        expect(splitStage(0, { unfermented: 0, fermented: 520 })).toBe('exhausted');
        // everything banked before any firing: this login's firing rolls it all
        expect(splitStage(0, { unfermented: 520, fermented: 0 })).toBe('await-second');
        expect(wineBankOf([{ id: ITEM.wine, count: 491 }, { id: ITEM.jugWine, count: 20 }, { id: ITEM.badWine, count: 9 }, { id: 1755, count: 1 }])).toEqual({ unfermented: 491, fermented: 29 });
    });

    test("from 'deposit-first': no trade, the 29 deposited for this login's timer, then the usual rest and relog", async () => {
        const e = new FakeEngine(100, 520, 1);
        const r = await splitDelivery({ sdk: run(e) }, 'maker', { loginTick: 100, first: 29, relog: e.relogTo(5_000), from: 'deposit-first' });
        expect(r.tradeSkipped).toBe(true);
        expect(r.firstFermentTick).toBe(120);
        expect(e.firings.map(f => f.wines)).toEqual([29, 491]);
        expect(e.relogs).toBe(1);
    });

    test("from 'await-first': nothing sent before the firing; the first wait runs", async () => {
        const e = new FakeEngine(100, 491, 1);
        e.banked = 29;
        const seq = recordTicks(e);
        const waits: number[] = [];
        const r = await splitDelivery({ sdk: run(e) }, 'maker', { loginTick: 100, first: 29, relog: e.relogTo(5_000), from: 'await-first', windows: { firstWait: async due => void waits.push(due) } });
        expect(waits).toEqual([120]);
        // P1's booth click goes out on the firing tick itself, as in the full sequence
        expect(seq.filter(x => x[0] < 120)).toEqual([]);
        expect(r.firstFermentTick).toBe(120);
        expect(e.firings.map(f => f.wines)).toEqual([29, 491]);
    });

    test("from 'deposit-rest' (a reconnect after the first firing): the rest rides this login's timer, no arming relog", async () => {
        const e = new FakeEngine(100, 491, 50);
        const bursts: number[] = [];
        const r = await splitDelivery({ sdk: run(e) }, 'maker', { loginTick: 100, first: 29, relog: e.relogTo(5_000), from: 'deposit-rest', windows: { restBurst: s => (bursts.push(s.tick), 0) } });
        expect(bursts).toHaveLength(1);
        expect(e.relogs).toBe(0);
        expect(r.secondFermentTick).toBe(120);
        expect(e.firings).toEqual([{ tick: 120, wines: 491 }]);
    });

    test("from 'deposit-rest' with the bank opening on login + 20: the deadline relog, and the rest ferments at the new login + 20", async () => {
        const e = new FakeEngine(100, 491, 50);
        e.sdk.state = { ...e.sdk.state!, tick: 119 };
        const r = await splitDelivery({ sdk: run(e) }, 'maker', { loginTick: 100, first: 29, relog: e.relogTo(5_000), from: 'deposit-rest' });
        expect(r.missRelogs).toBe(1);
        expect(r.secondLoginTick).toBe(5_000);
        expect(r.secondFermentTick).toBe(5_020);
        expect(e.firings.map(f => f.wines)).toEqual([0, 491]);
    });

    test("from 'await-second': no packets; the second wait runs beside this login's firing", async () => {
        const e = new FakeEngine(100, 0, 50);
        e.sdk.state = { ...e.sdk.state!, inventory: [] };
        e.banked = 491;
        const seq = recordTicks(e);
        const r = await splitDelivery({ sdk: run(e) }, 'maker', { loginTick: 100, first: 29, from: 'await-second' });
        expect(seq).toEqual([]);
        expect(r.secondFermentTick).toBe(120);
        expect(e.relogs).toBe(0);
    });
});
