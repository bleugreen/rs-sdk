import { describe, expect, test } from 'bun:test';
import type { ActionResult, BotWorldState, InventoryItem } from '../../sdk/types';
import { baseState, FakeSdk, flush, type SentAction } from '../lib/fake-sdk';
import type { ProgramStatus } from '../lib/programs';
import { TickLog } from '../lib/ticks';
import type { Step, StepContext } from '../runner/step';
import { ARDOUGNE_SOUTH_BANK, BANDS, eatPolicy, FOODS, foodPattern, RETALK_QUIET_TICKS, retalkDue, steps, TOPUP_RESTART_BY, topUpAction, topUpDue, TopUpReceiver } from './thieving';

describe('sail retalk', () => {
    test('re-sends only after RETALK_QUIET_TICKS with neither a click nor a dialogue page', () => {
        expect(retalkDue(100 + RETALK_QUIET_TICKS - 1, 100, -1)).toBe(false);
        expect(retalkDue(100 + RETALK_QUIET_TICKS, 100, -1)).toBe(true);
        // a dialogue page after the click restarts the quiet window (the ship's own delay follows it)
        expect(retalkDue(100 + RETALK_QUIET_TICKS, 100, 105)).toBe(false);
        expect(retalkDue(105 + RETALK_QUIET_TICKS, 100, 105)).toBe(true);
    });
});

const item = (slot: number, name: string, opts: { count?: number; eat?: boolean } = {}): InventoryItem => ({
    slot, id: 100 + slot, name, count: opts.count ?? 1,
    optionsWithIndex: opts.eat === false ? [] : [{ text: 'Eat', opIndex: 1 }, { text: 'Drop', opIndex: 5 }]
});

function world(o: { level: number; x: number; z: number; inventory?: InventoryItem[]; browser?: boolean; maxHp?: number }): BotWorldState {
    const s = baseState({
        player: { name: 't', worldX: o.x, worldZ: o.z, level: 0, hp: o.maxHp ?? 10, maxHp: o.maxHp ?? 10 } as never,
        skills: [{ name: 'Thieving', level: o.level, baseLevel: o.level, experience: 0 }] as never,
        inventory: o.inventory ?? []
    });
    return o.browser === false ? s : ({ ...s, program: null } as BotWorldState);
}

/**
 * The page side: a program start is answered like ProgramRuntime.command, and the
 * run's end is published a tick later from `ending` (a status patch per run).
 */
class PageSdk extends FakeSdk {
    readonly starts: Array<Record<string, unknown>> = [];
    ending: Array<(s: BotWorldState) => { status: Partial<ProgramStatus>; state?: Partial<BotWorldState> }> = [];
    private runId = 0;
    override sendAction(a: SentAction | Record<string, unknown>): Promise<ActionResult> {
        const act = a as Record<string, unknown>;
        if (act.type !== 'program') return super.sendAction(a as SentAction);
        if (act.op !== 'start') return Promise.resolve({ success: true, message: 'ok', data: null });
        const runId = ++this.runId;
        this.starts.push(act.params as Record<string, unknown>);
        const end = this.ending.shift() ?? ((): { status: Partial<ProgramStatus>; state?: Partial<BotWorldState> } => ({ status: { result: { reason: 'level' } } }));
        const status = (p: Partial<ProgramStatus>): ProgramStatus => ({ runId, name: 'pickpocket', phase: 'running', params: {}, startedTick: 0, tick: 0, progressTick: 0, counters: {}, gauges: {}, packets: 0, deferred: 0, skippedTicks: 0, maxTickMs: 0, ...p } as ProgramStatus);
        setTimeout(() => {
            const e = end(this.state!);
            this.tick(s => ({ ...e.state, program: status({ phase: 'done', ...e.status }) }) as never);
        }, 0);
        return Promise.resolve({ success: true, message: 'started', data: status({}) });
    }
}

function levelTo(n: number) {
    return (s: BotWorldState) => ({ status: { result: { reason: 'level' } }, state: { skills: [{ ...s.skills[0]!, level: n, baseLevel: n }] } });
}

function harness(sdk: FakeSdk) {
    const walks: Array<[number, number]> = [];
    const bot = {
        walkTo: async (x: number, z: number) => {
            walks.push([x, z]);
            sdk.tick(s => ({ player: { ...s.player!, worldX: x, worldZ: z } }));
            return { success: true, message: 'ok' };
        },
        openBank: async () => {
            sdk.tick(s => ({ bank: { ...s.bank, isOpen: true } }));
            return { success: true, message: 'ok' };
        }
    };
    const ctx = { session: { sdk, bot, name: 't', sessionId: 1 }, sdk, bot, c: {}, log: TickLog.memory() } as unknown as StepContext<Record<string, never>>;
    return { ctx, walks };
}

async function runAll(list: Step[], ctx: StepContext<Record<string, never>>): Promise<string[]> {
    const ran: string[] = [];
    for (const step of list) {
        const pre = step.preconditions(ctx.sdk.getState()!, {});
        if (pre !== true) throw new Error(`${step.name}: ${pre}`);
        const before = (ctx.sdk as unknown as PageSdk).starts.length;
        await step.run(ctx);
        if ((ctx.sdk as unknown as PageSdk).starts.length > before) ran.push(step.name);
        const post = step.postconditions(ctx.sdk.getState()!, {});
        if (post !== true) throw new Error(`${step.name} post: ${post}`);
    }
    return ran;
}

describe('thieving steps', () => {
    test('names and order: men, the leg, the bank stop, then the Ardougne bands', () => {
        expect(steps().map(s => s.name)).toEqual([
            'thieving:men', 'thieving:to-ardougne', 'thieving:provision',
            'thieving:warrior-women', 'thieving:guards', 'thieving:knights-55', 'thieving:knights'
        ]);
        // every band is a logout-safe milestone; the leg and the bank stop are transient
        for (const s of steps()) expect(s.logoutSafe).toBe(true);
        expect(steps().filter(s => s.done).map(s => s.name)).toEqual(BANDS.map(b => b.name));
    });

    test('`to` caps the last band, and the bands past it are done at once', () => {
        const list = steps({ to: 50 });
        const at50 = world({ level: 50, x: 2662, z: 3305 });
        for (const s of list.filter(s => s.done)) expect(s.done!({ state: at50, probed: {} }, {})).toBe(true);
        const guards = list.find(s => s.name === 'thieving:guards')!;
        expect(guards.done!({ state: world({ level: 49, x: 0, z: 0 }), probed: {} }, {})).toBe(false);
        expect(guards.inProgress!({ state: world({ level: 45, x: 0, z: 0 }), probed: {} }, {})).toBe(true);
    });

    test('from 57 in the market with sharks, only thieving:knights starts the program', async () => {
        const sdk = new PageSdk(world({ level: 57, x: 2668, z: 3303, maxHp: 40, inventory: [item(0, 'Coins', { count: 500, eat: false }), item(1, 'Shark'), item(2, 'Shark')] }));
        sdk.ending = [levelTo(99)];
        const { ctx, walks } = harness(sdk);
        const ran = await runAll(steps(), ctx);
        expect(ran).toEqual(['thieving:knights']);
        expect(walks).toEqual([]);
        expect(sdk.starts).toEqual([{
            npc: '^Knight of Ardougne$', untilLevel: 99, food: foodPattern(FOODS.shark), heal: 20, eat: 'window',
            eatBelow: 20, forcedBelow: 3, stopWhenFoodBelow: 1, retargetTicks: 12
        }]);
    });

    test('from 1 at the tutorial exit, thieving:men starts on the Lumbridge men with the starter food', async () => {
        const sdk = new PageSdk(world({ level: 1, x: 3222, z: 3222, inventory: [item(0, 'Shrimps'), item(1, 'Bread'), item(2, 'Cake', { count: 38, eat: false })] }));
        sdk.ending = [levelTo(25)];
        const { ctx } = harness(sdk);
        await steps({ food: 'cake' })[0]!.run(ctx);
        expect(sdk.starts[0]).toMatchObject({ npc: '^(Man|Woman)$', untilLevel: 25, eatBelow: 6, forcedBelow: 1 });
        expect(new RegExp(String(sdk.starts[0]!.food), 'i').test('Shrimps')).toBe(true);
        expect(new RegExp(String(sdk.starts[0]!.food), 'i').test('2/3 cake')).toBe(true);
    });

    test('eatPolicy: a bite must fit under the cap and the window eat comes before the forced one', () => {
        expect(eatPolicy(10, FOODS.cake.heal, 1)).toEqual({ eatBelow: 6, forcedBelow: 1 });
        expect(eatPolicy(10, FOODS.shark.heal, 3)).toEqual({ eatBelow: 4, forcedBelow: 3 });
        expect(eatPolicy(40, FOODS.shark.heal, 3)).toEqual({ eatBelow: 20, forcedBelow: 3 });
        expect(eatPolicy(10, FOODS.cake.heal, 3)).toEqual({ eatBelow: 6, forcedBelow: 3 });
    });

    test('a food stop restocks at the south bank and starts the program again; a done run does not', async () => {
        const sdk = new PageSdk(world({ level: 60, x: 2670, z: 3305, inventory: [item(0, 'Coins', { count: 900, eat: false })] }));
        sdk.state = { ...sdk.state!, bank: { isOpen: false, noteMode: false, items: [{ slot: 0, id: 500, name: 'Cake', count: 11 }] } } as BotWorldState;
        sdk.onSend = (a, s) => {
            if (a.method === 'sendBankWithdraw') s.tick(st => ({ inventory: [...st.inventory, ...Array.from({ length: 11 }, (_, i) => item(i + 1, 'Cake'))] }));
        };
        sdk.ending = [() => ({ status: { result: { reason: 'food' } } }), levelTo(99)];
        const { ctx, walks } = harness(sdk);
        await steps({ food: 'cake' }).find(s => s.name === 'thieving:knights')!.run(ctx);
        expect(sdk.starts.length).toBe(2);
        expect(walks).toEqual([[ARDOUGNE_SOUTH_BANK.x, ARDOUGNE_SOUTH_BANK.z], [2670, 3305]]);
        expect(sdk.sent.filter(a => a.method === 'sendBankWithdraw').length).toBe(1);
        const detail = ctx.log.rows.find(r => r.step === 'thieving:knights:detail')!;
        expect(detail.ticks).toBe(0);
        expect((detail.meta!.restocks as unknown[]).length).toBe(1);

        const sdk2 = new PageSdk(world({ level: 60, x: 2670, z: 3305, inventory: [item(0, 'Cake')] }));
        sdk2.ending = [levelTo(99)];
        const h2 = harness(sdk2);
        await steps({ food: 'cake' }).find(s => s.name === 'thieving:knights')!.run(h2.ctx);
        expect(sdk2.starts.length).toBe(1);
        expect(h2.walks).toEqual([]);
    });

    test('food cake,shark: a stop that finds no cakes fills with sharks, and the next run eats them at the shark threshold', async () => {
        const sdk = new PageSdk(world({ level: 80, x: 2670, z: 3305, inventory: [item(0, 'Coins', { count: 90, eat: false }), item(1, 'Cake')] }));
        sdk.state = { ...sdk.state!, bank: { isOpen: false, noteMode: false, items: [{ slot: 0, id: 501, name: 'Shark', count: 20 }] } } as BotWorldState;
        sdk.onSend = (a, s) => {
            if (a.method === 'sendBankWithdraw') s.tick(st => ({ inventory: [st.inventory[0]!, ...Array.from({ length: 20 }, (_, i) => item(i + 1, 'Shark'))] }));
        };
        sdk.ending = [(s: BotWorldState) => ({ status: { result: { reason: 'food' } }, state: { inventory: [s.inventory[0]!] } }), levelTo(99)];
        const { ctx } = harness(sdk);
        await steps({ food: 'cake,shark' }).find(s => s.name === 'thieving:knights')!.run(ctx);
        expect(sdk.starts.map(p => [p.eatBelow, p.heal])).toEqual([[6, 4], [4, 20]]);
        expect(new RegExp(String(sdk.starts[1]!.food), 'i').test('Shark')).toBe(true);
        // one withdraw that gained sharks; the cake lookup found none and withdrew nothing
        expect(sdk.sent.filter(a => a.method === 'sendBankWithdraw').length).toBe(1);
        const detail = ctx.log.rows.find(r => r.step === 'thieving:knights:detail')!;
        expect((detail.meta!.runs as Array<{ food: string }>).map(r => r.food)).toEqual(['Cake', 'Shark']);
    });

    test('food lists: names, arrays and comma strings parse in order; an unknown name throws', () => {
        expect(() => steps({ food: 'cake,bread' })).toThrow(/unknown food 'bread'/);
        expect(() => steps({ food: ['cake', 'shark'] })).not.toThrow();
        expect(() => steps({ food: 'cake' })).not.toThrow();
    });

    test('the bank stop with cake,shark notes deposits both and withdraws cakes first', async () => {
        const inv = [item(0, 'Coins', { count: 100, eat: false }), item(1, 'Cake', { count: 30, eat: false }), item(2, 'Shark', { count: 20, eat: false })];
        const sdk = new PageSdk(world({ level: 25, x: 2665, z: 3290, inventory: inv }));
        sdk.onSend = (a, s) => {
            if (a.method === 'sendBankDeposit') {
                const slot = a.args[0] as number;
                s.tick(st => ({ inventory: st.inventory.filter(i => i.slot !== slot), bank: { ...st.bank, items: [...st.bank.items, { slot: st.bank.items.length, id: 900 + slot, name: st.inventory.find(i => i.slot === slot)!.name, count: slot === 1 ? 30 : 20 }] } }));
            }
            if (a.method === 'sendBankWithdraw') s.tick(st => ({ inventory: [...st.inventory, ...Array.from({ length: 27 }, (_, i) => item(i + 1, 'Cake'))] }));
        };
        const { ctx } = harness(sdk);
        const provision = steps({ food: 'cake,shark' }).find(s => s.name === 'thieving:provision')!;
        expect(provision.preconditions(sdk.state!, {})).toBe(true);
        await provision.run(ctx);
        await flush();
        expect(sdk.sent.filter(a => a.method === 'sendBankDeposit').map(a => a.args[0]).sort()).toEqual([1, 2]);
        expect(sdk.state!.inventory.filter(i => i.name === 'Cake').length).toBe(27);
        expect(provision.postconditions(sdk.state!, {})).toBe(true);
    });

    test('the bank stop deposits all but coins and fills the inventory with unnoted food', async () => {
        const inv = [item(0, 'Bronze axe', { eat: false }), item(1, 'Coins', { count: 100, eat: false }), item(2, 'Cake', { count: 38, eat: false })];
        const sdk = new PageSdk(world({ level: 25, x: 2665, z: 3290, inventory: inv }));
        sdk.onSend = (a, s) => {
            if (a.method === 'sendBankDeposit') {
                const slot = a.args[0] as number;
                s.tick(st => ({ inventory: st.inventory.filter(i => i.slot !== slot), bank: { ...st.bank, items: [...st.bank.items, { slot: st.bank.items.length, id: 900 + slot, name: st.inventory.find(i => i.slot === slot)!.name, count: 1 }] } }));
            }
            if (a.method === 'sendBankWithdraw') s.tick(st => ({ inventory: [...st.inventory, ...Array.from({ length: 27 }, (_, i) => item(i + 2, 'Cake'))] }));
        };
        const { ctx } = harness(sdk);
        const provision = steps({ food: 'cake' }).find(s => s.name === 'thieving:provision')!;
        expect(provision.preconditions(sdk.state!, {})).toBe(true);
        await provision.run(ctx);
        await flush();
        const deposited = sdk.sent.filter(a => a.method === 'sendBankDeposit').map(a => a.args[0]);
        expect(deposited.sort()).toEqual([0, 2]);
        expect(provision.postconditions(sdk.state!, {})).toBe(true);
    });

    test('the leg and the bank stop are no-ops in the market with food', async () => {
        const sdk = new PageSdk(world({ level: 30, x: 2630, z: 3297, inventory: [item(0, 'Cake')] }));
        const { ctx, walks } = harness(sdk);
        const [, leg, provision] = steps({ food: 'cake' });
        await leg!.run(ctx);
        await provision!.run(ctx);
        expect(walks).toEqual([]);
        expect(sdk.sent).toEqual([]);
        expect(leg!.postconditions(sdk.state!, {})).toBe(true);
    });

    test('a top-up needs a giver, below >= 1 and a known mode', () => {
        expect(() => steps({ topUp: { giver: '', below: 3 } })).toThrow(/topUp needs/);
        expect(() => steps({ topUp: { giver: 'g', below: 0 } })).toThrow(/topUp needs/);
        expect(() => steps({ topUp: { giver: 'g', below: 3, mode: 'later' as never } })).toThrow(/topUp needs/);
        expect(steps({ topUp: { giver: 'g', below: 3, mode: 'restart' } }).length).toBe(7);
    });

    test('the stun pack is a seam, not an implementation', () => {
        expect(() => steps({ stunPack: { giver: 'x' } })).toThrow(/stun pack not implemented \(rs\/132/);
    });

    test('a band with work left fails its precondition on the lite client; a finished one does not', () => {
        const knights = steps().find(s => s.name === 'thieving:knights')!;
        expect(knights.preconditions(world({ level: 60, x: 2670, z: 3305, browser: false }), {})).toMatch(/browser client/);
        expect(knights.preconditions(world({ level: 99, x: 2670, z: 3305, browser: false }), {})).toBe(true);
        expect(knights.preconditions(world({ level: 40, x: 2670, z: 3305 }), {})).toMatch(/below/);
    });
});

// ------------------------------------------------------------------ helper top-ups

const GIVER = 'cairn_mule2';
const CAKE_ID = 1891;
const cake = (slot: number): InventoryItem => ({ ...item(slot, 'Cake'), id: CAKE_ID });
const OFFER = [{ slot: 0, id: CAKE_ID, name: 'Cake', count: 10 }];
const CLOSED = { isOpen: false, screen: null, partner: null, myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false };
const screen = (which: 'offer' | 'confirm', partner = GIVER, partnerAccepted = which === 'offer') =>
    ({ isOpen: true, screen: which, partner, myOffer: [], theirOffer: OFFER, myAccepted: false, partnerAccepted });
const withCakes = (s: BotWorldState, n: number) => [...s.inventory, ...Array.from({ length: n }, (_, i) => cake(s.inventory.length + i))];

/** A page whose program runs until the test ends it; `stop` publishes `stopped` a tick later. */
class ManualPageSdk extends FakeSdk {
    readonly starts: Array<{ tick: number; params: Record<string, unknown> }> = [];
    readonly ops: string[] = [];
    private runId = 0;
    status(p: Partial<ProgramStatus>, tick: number): ProgramStatus {
        return { runId: this.runId, name: 'pickpocket', phase: 'running', params: {}, startedTick: 0, tick, progressTick: 0, counters: {}, gauges: {}, packets: 0, deferred: 0, skippedTicks: 0, maxTickMs: 0, ...p } as ProgramStatus;
    }
    publish(p: Partial<ProgramStatus>, patch: Partial<BotWorldState> = {}): void {
        this.tick(s => ({ ...patch, program: this.status(p, s.tick + 1) }) as never);
    }
    override sendAction(a: SentAction | Record<string, unknown>): Promise<ActionResult> {
        const act = a as Record<string, unknown>;
        if (act.type !== 'program') return super.sendAction(a as SentAction);
        this.ops.push(String(act.op));
        if (act.op === 'stop') {
            queueMicrotask(() => this.publish({ phase: 'stopped' }));
            return Promise.resolve({ success: true, message: 'stopped', data: null });
        }
        this.runId++;
        this.starts.push({ tick: this.state!.tick, params: act.params as Record<string, unknown> });
        queueMicrotask(() => this.publish({}));
        return Promise.resolve({ success: true, message: 'started', data: this.status({}, this.state!.tick) });
    }
}

async function settle(until: () => boolean, rounds = 50): Promise<void> {
    for (let i = 0; i < rounds && !until(); i++) await flush();
}

describe('thieving helper top-ups', () => {
    test('TopUpReceiver: nothing while closed, accepts both screens, records the items', () => {
        const rx = new TopUpReceiver(GIVER);
        let s = world({ level: 60, x: 2670, z: 3305, maxHp: 40, inventory: [cake(0), cake(1)] });
        const at = (patch: Partial<BotWorldState>) => (s = { ...s, ...patch, tick: s.tick + 1 } as BotWorldState);
        expect(rx.step(s)).toBeNull();
        expect(rx.step(at({ trade: screen('offer') as never }))).toBe('accept');
        expect(rx.step(at({ trade: { ...screen('offer'), myAccepted: true } as never }))).toBeNull();
        expect(rx.step(at({ trade: screen('confirm') as never }))).toBe('accept');
        expect(rx.step(at({ trade: CLOSED as never, inventory: withCakes(s, 10) }))).toBeNull();
        expect(rx.trades).toEqual([{ openTick: 101, endTick: 104, ok: true, received: 10 }]);
        expect(rx.step(at({}))).toBeNull();
    });

    test('TopUpReceiver: a trade with anyone else is declined once, then left to close', () => {
        const rx = new TopUpReceiver(GIVER);
        let s = world({ level: 60, x: 2670, z: 3305, maxHp: 40 });
        const at = (patch: Partial<BotWorldState>) => (s = { ...s, ...patch, tick: s.tick + 1 } as BotWorldState);
        expect(rx.step(at({ trade: screen('offer', 'stranger') as never }))).toBe('decline');
        expect(rx.step(at({ trade: screen('offer', 'stranger') as never }))).toBeNull();
        expect(rx.step(at({ trade: CLOSED as never }))).toBeNull();
        expect(rx.trades.map(t => t.ok)).toEqual([false]);
        expect(rx.trades[0]!.reason).toMatch(/wrong partner/);
    });

    test('topUpDue: a new failure with food below the bar', () => {
        expect(topUpDue({ counters: { fails: 3 }, gauges: { food: 2 } }, 2, 4)).toBe(true);
        expect(topUpDue({ counters: { fails: 3 }, gauges: { food: 2 } }, 3, 4)).toBe(false);
        expect(topUpDue({ counters: { fails: 3 }, gauges: { food: 4 } }, 2, 4)).toBe(false);
        expect(topUpDue({ counters: { fails: 3 }, gauges: {} }, 2, 4)).toBe(false);
    });

    test('idle mode: the program requests on +2 and idles; the module only accepts the two screens', async () => {
        const sdk = new ManualPageSdk(world({ level: 60, x: 2670, z: 3305, maxHp: 40, inventory: [cake(0), cake(1)] }));
        const { ctx } = harness(sdk);
        const topUp = { giver: GIVER, below: 4 };
        const done = steps({ food: 'cake', topUp }).find(s => s.name === 'thieving:knights')!.run(ctx);
        await settle(() => sdk.starts.length === 1);
        expect(sdk.starts[0]!.params).toMatchObject({ idleOnInterface: true, stunActions: [topUpAction(topUp, FOODS.cake)], retargetTicks: 12 });
        const action = topUpAction(topUp, FOODS.cake) as { fewer: Array<{ item: string; than: number }> };
        expect(action).toMatchObject({ name: 'topup', kind: 'player', player: '^cairn_mule2$', window: [2, 2] });
        expect(action.fewer[0]!.than).toBe(4);
        for (const n of ['Cake', '2/3 cake', 'Slice of cake']) expect(new RegExp(action.fewer[0]!.item, 'i').test(n)).toBe(true);
        expect(new RegExp(action.fewer[0]!.item, 'i').test('Shrimps')).toBe(false);

        sdk.tick({ trade: screen('offer') as never });
        sdk.tick({ trade: { ...screen('offer'), myAccepted: true } as never });
        sdk.tick({ trade: screen('confirm') as never });
        sdk.tick(s => ({ trade: CLOSED as never, inventory: withCakes(s, 10) }));
        sdk.publish({ phase: 'done', result: { reason: 'level' } }, { skills: [{ name: 'Thieving', level: 99, baseLevel: 99, experience: 0 }] as never });
        await done;

        expect(sdk.sent.map(a => a.method)).toEqual(['sendAcceptTrade', 'sendAcceptTrade']);
        expect(sdk.ops).toEqual(['start']);
        const meta = ctx.log.rows.find(r => r.step === 'thieving:knights:detail')!.meta as { topUp: { mode: string; trades: Array<{ ok: boolean; received: number }> } };
        expect(meta.topUp.mode).toBe('idle');
        expect(meta.topUp.trades.map(t => [t.ok, t.received])).toEqual([[true, 10]]);
    });

    test('restart mode: stop at the failure, receive the trade, restart within TOPUP_RESTART_BY ticks', async () => {
        const sdk = new ManualPageSdk({ ...world({ level: 60, x: 2670, z: 3305, maxHp: 40, inventory: [cake(0), cake(1)] }), nearbyPlayers: [{ index: 7, name: GIVER, distance: 1 }] } as never);
        sdk.onSend = (a, s) => {
            const t = s.state!.trade;
            if (a.method === 'sendTradeRequest') queueMicrotask(() => s.tick({ trade: screen('offer') as never }));
            if (a.method === 'sendAcceptTrade' && t?.screen === 'offer') queueMicrotask(() => s.tick({ trade: screen('confirm') as never }));
            if (a.method === 'sendAcceptTrade' && t?.screen === 'confirm') queueMicrotask(() => s.tick(st => ({ trade: CLOSED as never, inventory: withCakes(st, 10) })));
        };
        const { ctx } = harness(sdk);
        const done = steps({ food: 'cake', topUp: { giver: GIVER, below: 4, mode: 'restart' } }).find(s => s.name === 'thieving:knights')!.run(ctx);
        await settle(() => sdk.starts.length === 1);
        expect(sdk.starts[0]!.params.idleOnInterface).toBeUndefined();
        expect(sdk.starts[0]!.params.stunActions).toBeUndefined();

        // a failure with 3 food left (fewer than 4): the program's status shows it on F
        sdk.publish({ counters: { fails: 0 }, gauges: { food: 3 } });
        sdk.publish({ counters: { fails: 1 }, gauges: { food: 3 } });
        const failTick = sdk.state!.tick;
        await settle(() => sdk.starts.length === 2);
        expect(sdk.ops).toEqual(['start', 'stop', 'start']);
        expect(sdk.starts[1]!.tick - failTick).toBeLessThanOrEqual(TOPUP_RESTART_BY);
        expect(sdk.sent.map(a => a.method)).toEqual(['sendTradeRequest', 'sendAcceptTrade', 'sendAcceptTrade']);

        sdk.publish({ phase: 'done', result: { reason: 'level' } }, { skills: [{ name: 'Thieving', level: 99, baseLevel: 99, experience: 0 }] as never });
        await done;
        const meta = ctx.log.rows.find(r => r.step === 'thieving:knights:detail')!.meta as { topUp: { restarts: Array<{ ok: boolean; received: number; failTick: number; restartTick: number }> } };
        expect(meta.topUp.restarts.map(r => [r.ok, r.received])).toEqual([[true, 10]]);
    });

    test('restart mode: a failure with food at or above the bar keeps the program running', async () => {
        const sdk = new ManualPageSdk(world({ level: 60, x: 2670, z: 3305, maxHp: 40, inventory: [cake(0)] }));
        const { ctx } = harness(sdk);
        const done = steps({ food: 'cake', topUp: { giver: GIVER, below: 4, mode: 'restart' } }).find(s => s.name === 'thieving:knights')!.run(ctx);
        await settle(() => sdk.starts.length === 1);
        sdk.publish({ counters: { fails: 1 }, gauges: { food: 9 } });
        await flush();
        sdk.publish({ phase: 'done', result: { reason: 'level' } }, { skills: [{ name: 'Thieving', level: 99, baseLevel: 99, experience: 0 }] as never });
        await done;
        expect(sdk.ops).toEqual(['start']);
        expect(sdk.sent).toEqual([]);
    });
});
