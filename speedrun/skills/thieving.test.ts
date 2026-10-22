import { describe, expect, test } from 'bun:test';
import { createHash } from 'crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTopUpAsk } from '../helpers/altar-cue';

// The top-up bands write the courier's ask to the cue directory: never the checkout's run-machine/,
// which on the run machine is the live one.
const CUE = mkdtempSync(join(tmpdir(), 'thieving-cue-'));
process.env.RC_CUE_DIR = CUE;
import type { ActionResult, BotWorldState, InventoryItem } from '../../sdk/types';
import { createPickpocket } from '../../server/webclient/src/bot/programs/pickpocket';
import type { ProgramAction, ProgramContext, TickProgram } from '../../server/webclient/src/bot/programs/types';
import { baseState, FakeSdk, flush, type SentAction } from '../lib/fake-sdk';
import type { ProgramStatus } from '../lib/programs';
import { TickLog } from '../lib/ticks';
import type { Step, StepContext } from '../runner/step';
import { parseStunActions, STUN_PRESETS } from '../../server/webclient/src/bot/programs/stun-actions';
import { Spells } from '../../sdk/spells';
import { parseIn } from '../tools/slot-ledger';
import { xpForLevel } from '../lib/xp';
import {
    ARDOUGNE_SOUTH_BANK, ARROWHEAD_TIERS, BANDS, bonesTopUpAction, chargeSipPotion, type ChargeSip, chooseKnight, DROP_BARS, type KnightChoice, parseKnight, eatPolicy, FOODS, foodPattern, oreTopUpAction, packReport, parseStunPack, RETALK_QUIET_TICKS, retalkDue, steps, STUN_PACK_ACTIONS, STUN_PACK_BONES_BELOW,
    stunActionsFor, stunPackCheck, SUPERHEAT_BRONZE_CASTS, SUPERHEAT_SPELL, superheatActions, superheatLoad, TOPUP_RESTART_BY, topUpAction, topUpAsk, TopUpAsker, topUpDue, TopUpReceiver
} from './thieving';

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
    /** The run's counters so far: a stop publishes them, as the page's stopped status does. */
    private counters: Record<string, number> = {};
    publish(p: Partial<ProgramStatus>, patch: Partial<BotWorldState> = {}): void {
        if (p.counters) this.counters = p.counters;
        this.tick(s => ({ ...patch, program: this.status(p, s.tick + 1) }) as never);
    }
    override sendAction(a: SentAction | Record<string, unknown>): Promise<ActionResult> {
        const act = a as Record<string, unknown>;
        if (act.type !== 'program') return super.sendAction(a as SentAction);
        this.ops.push(String(act.op));
        if (act.op === 'stop') {
            queueMicrotask(() => this.publish({ phase: 'stopped', counters: this.counters }));
            return Promise.resolve({ success: true, message: 'stopped', data: null });
        }
        this.runId++;
        this.counters = {};
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
        const meta = ctx.log.rows.find(r => r.step === 'thieving:knights:detail')!.meta as { topUp: { mode: string; trades: Array<{ ok: boolean; received: number }>; asks: Array<{ items: unknown }> } };
        expect(meta.topUp.mode).toBe('idle');
        expect(meta.topUp.trades.map(t => [t.ok, t.received])).toEqual([[true, 10]]);
        // the courier's ask, written on the open frame: 2 slots of cake held, one kept for coins, cake in the other 25
        const ask = [{ item: '^(Cake|2\\/3 cake|Slice of cake)$', count: 25 }];
        expect(meta.topUp.asks.map(a => a.items)).toEqual([ask]);
        expect(readTopUpAsk(CUE)!.items).toEqual(ask);
    });

    test('topUpAsk with the pack: bones to fill, food back to 2, the next courier tier once at one tier held, one slot for arrows', () => {
        const skills = (fletching: number) => [{ name: 'Thieving', level: 60, baseLevel: 60, experience: 0 }, { name: 'Fletching', level: fletching, baseLevel: fletching, experience: 0 }] as never;
        const pack = (tiers: string[], o: { fletching?: number; coins?: boolean; sharks?: number } = {}) => {
            const names = ['Blood rune', 'Air rune', 'Headless arrow', ...tiers.map(t => `${t} arrowtips`), 'Mithril arrow', ...(o.coins === false ? [] : ['Coins']), 'Babydragon bones', 'Babydragon bones'];
            const inv = names.map((n, i) => item(i, n, { eat: false }));
            for (let k = 0; k < (o.sharks ?? 1); k++) inv.push(item(inv.length, 'Shark'));
            return { ...world({ level: 60, x: 2670, z: 3305 }), skills: skills(o.fletching ?? 50), inventory: inv } as BotWorldState;
        };
        const mem = { tiers: new Set<string>() };
        // 9 slots held, coins among them: 19 free; 1 shark back, the adamant tier's slot, one for a new arrow stack: 16 bones
        expect(topUpAsk(pack(['Mithril']), FOODS.shark, true, mem)).toEqual([{ item: 'bones$', count: 16 }, { item: '^(Shark)$', count: 1 }, { item: '^adamant arrow(head|tip)s$', count: 'all' }]);
        // two tiers held: no tier; the adamant one was asked for once
        expect(topUpAsk(pack(['Mithril', 'Adamant'], { sharks: 2 }), FOODS.shark, true, mem)).toEqual([{ item: 'bones$', count: 16 }]);
        // down to adamant: rune, then nothing more
        expect(topUpAsk(pack(['Adamant'], { sharks: 2 }), FOODS.shark, true, mem).at(-1)).toEqual({ item: '^rune arrow(head|tip)s$', count: 'all' });
        expect(topUpAsk(pack(['Rune'], { sharks: 2 }), FOODS.shark, true, mem).map(a => a.item)).toEqual(['bones$']);
        // no coins yet: one slot stays for the loot; Fletching 99: no tier and no arrow slot
        expect(topUpAsk(pack(['Mithril'], { coins: false }), FOODS.shark, true, { tiers: new Set() })[0]).toEqual({ item: 'bones$', count: 16 });
        expect(topUpAsk(pack(['Mithril'], { fletching: 99, sharks: 2 }), FOODS.shark, true, { tiers: new Set() })).toEqual([{ item: 'bones$', count: 18 }]);
    });

    test('TopUpAsker: writes once per trade with the courier, on the frame that shows it open; nothing for anyone else', () => {
        const dir = mkdtempSync(join(tmpdir(), 'asker-'));
        const asker = new TopUpAsker(GIVER, dir, [FOODS.cake], false);
        let s = world({ level: 60, x: 2670, z: 3305, maxHp: 40, inventory: [cake(0), cake(1)] });
        const at = (patch: Partial<BotWorldState>) => (s = { ...s, ...patch, tick: s.tick + 1 } as BotWorldState);
        expect(asker.step(s)).toBeNull();
        expect(asker.step(at({ trade: screen('offer', 'stranger') as never }))).toBeNull();
        expect(readTopUpAsk(dir)).toBeNull();
        expect(asker.step(at({ trade: CLOSED as never }))).toBeNull();
        expect(asker.step(at({ trade: screen('offer') as never }))).toEqual([{ item: '^(Cake|2\\/3 cake|Slice of cake)$', count: 25 }]);
        expect(asker.step(at({ trade: screen('confirm') as never }))).toBeNull();
        expect(readTopUpAsk(dir)!.items[0]!.count).toBe(25);
        expect(asker.asks.map(a => a.tick)).toEqual([s.tick - 1]);
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

// ------------------------------------------------------------------ the program's packets

const KNIGHTS_AT = { x: 2670, z: 3305 };

/** The params the knights band starts the program with, from a run of the step on a page that ends it at once. */
async function knightsParams(opts: Parameters<typeof steps>[0], s: BotWorldState): Promise<Record<string, unknown>> {
    const sdk = new ManualPageSdk(s);
    const { ctx } = harness(sdk);
    const done = steps(opts).find(x => x.name === 'thieving:knights')!.run(ctx);
    await settle(() => sdk.starts.length === 1);
    const params = sdk.starts[0]!.params;
    sdk.publish({ phase: 'done', result: { reason: 'level' } }, { skills: [...sdk.state!.skills.filter(k => k.name !== 'Thieving'), { name: 'Thieving', level: 99, baseLevel: 99, experience: 0 }] as never });
    await done;
    return params;
}

/** An inventory as the scripted program sees it, by slot. */
type KitItem = { name: string; options?: string[]; count?: number };

/**
 * The page runtime's part a packet trace needs (programs/runtime.ts): the program as the page
 * builds it, its declared keys, and the engine's 5 user events per tick as the send budget.
 * The webclient's own testkit pulls in ActionExecutor, which the root typecheck cannot resolve.
 */
class ProgramDriver {
    readonly sent: Array<{ tick: number; action: ProgramAction }> = [];
    readonly status: { phase: 'running' | 'done' | 'fault'; fault?: string; counters: Record<string, number> } = { phase: 'running', counters: {} };
    private readonly program: TickProgram;

    constructor(params: Record<string, unknown>) {
        const declared = new Set<string>(createPickpocket.params);
        const unknown = Object.keys(params).filter(k => !declared.has(k));
        if (unknown.length) throw new Error(`pickpocket does not declare ${unknown.join(', ')}`);
        this.program = createPickpocket(params);
    }

    step(state: BotWorldState): void {
        if (this.status.phase !== 'running') return;
        let budget = 5;
        const status = this.status;
        const sent = this.sent;
        const ctx: ProgramContext = {
            // the SDK's published shape, which the page's carries (the page's adds menuActions)
            state: state as unknown as ProgramContext['state'], tick: state.tick, ticksAdvanced: 1, nowMs: 0, wallMs: 0, frames: [],
            get budget() { return budget; },
            send(action) {
                if (budget <= 0) return false;
                budget--;
                sent.push({ tick: state.tick, action });
                return true;
            },
            count(name, by = 1) { status.counters[name] = (status.counters[name] ?? 0) + by; },
            gauge() {}, starter() {}, mark() {}, share() {}, progress() {}, log() {},
            done() { status.phase = 'done'; },
            fault(reason) { status.phase = 'fault'; status.fault = reason; }
        };
        this.program.onTick(ctx);
    }
}

function programState(tick: number, o: TraceOpts, msgs: ReadonlyArray<{ text: string; tick: number; id: number }>): BotWorldState {
    const skill = (name: string, level: number) => ({ name, level, baseLevel: level, experience: 0 });
    const giver = o.giverAt;
    return baseState({
        tick,
        player: { name: 'cairn_test', worldX: KNIGHTS_AT.x, worldZ: KNIGHTS_AT.z, level: 0, hp: 40, maxHp: 40, isDead: false } as never,
        skills: [skill('Thieving', 60), skill('Magic', o.magic ?? 80), skill('Fletching', o.fletching ?? 1), skill('Prayer', 43), skill('Hitpoints', 40), ...(o.smithing === undefined ? [] : [skill('Smithing', o.smithing)])],
        inventory: o.inventory.map((it, slot) => ({ slot, id: 1000 + slot, name: it.name, count: it.count ?? 1, optionsWithIndex: (it.options ?? ['Use', 'Drop']).map((text, i) => ({ text, opIndex: i + 1 })) })),
        nearbyNpcs: [{ index: 12, name: 'Knight of Ardougne', distance: 1, x: KNIGHTS_AT.x, z: KNIGHTS_AT.z - 1, optionsWithIndex: ['Talk-to', 'Attack', 'Pickpocket'].map((text, i) => ({ text, opIndex: i + 1 })) }] as never,
        nearbyPlayers: giver ? [{ kind: 'player', index: 7, name: GIVER, combatLevel: 3, x: KNIGHTS_AT.x + giver[0], z: KNIGHTS_AT.z + giver[1], distance: Math.max(Math.abs(giver[0]), Math.abs(giver[1])) }] as never : [],
        gameMessages: msgs.map(m => ({ type: 0, text: m.text, sender: '', tick: m.tick, observationId: m.id, fromSelf: false })) as never
    });
}

interface TraceOpts {
    ticks?: number;
    inventory: readonly KitItem[];
    magic?: number;
    fletching?: number;
    /** Base Smithing; omitted: no Smithing row in the state. */
    smithing?: number;
    /** The giver's tile less the account's; omitted: no giver in sight. */
    giverAt?: [number, number];
}

/**
 * Every packet the real pickpocket program sends on `params`, by tick, over a scripted (open-loop)
 * stretch at the knights: a success every 2 ticks, every fifth roll a failure and the next roll 11
 * ticks later. The inventory does not change, so the stun actions each tick resolve the same way.
 */
function packetTrace(params: Record<string, unknown>, o: TraceOpts): string[] {
    return programTrace(params, o).lines;
}

function programTrace(params: Record<string, unknown>, o: TraceOpts): { lines: string[]; h: ProgramDriver; fails: number[] } {
    const h = new ProgramDriver(params);
    const ticks = o.ticks ?? 120;
    const rolls = new Map<number, boolean>();
    for (let t = 202, n = 0; t < 200 + ticks; n++) {
        const ok = n % 5 !== 4;
        rolls.set(t, ok);
        t += ok ? 2 : 11;
    }
    const msgs: Array<{ text: string; tick: number; id: number }> = [];
    let id = 0;
    const state = (tick: number) => programState(tick, o, msgs.slice(-20));
    h.step(state(200));
    for (let tick = 201; tick < 200 + ticks && h.status.phase === 'running'; tick++) {
        const r = rolls.get(tick);
        if (r === true) msgs.push({ text: "You pick the knight's pocket.", tick, id: id++ });
        if (r === false) msgs.push({ text: "You fail to pick the knight's pocket.", tick, id: id++ }, { text: "You've been stunned!", tick, id: id++ });
        h.step(state(tick));
    }
    if (h.status.phase !== 'running') throw new Error(`the program ended ${h.status.phase}: ${h.status.fault ?? ''}`);
    return { lines: h.sent.map(s => `${s.tick} ${JSON.stringify(s.action)}`), h, fails: [...rolls].filter(([, ok]) => !ok).map(([t]) => t) };
}

const sha = (lines: readonly string[]) => createHash('sha256').update(lines.join('\n')).digest('hex');
const shark = (): { name: string; options: string[] } => ({ name: 'Shark', options: ['Eat', 'Drop'] });

describe('thieving: the packets without the stun pack', () => {
    // The knights band's params with no stunPack, run through the real program. Pinned on the module
    // before the stun pack was wired (rs/324), so a run without it sends exactly what it did.
    const at = (inventory: InventoryItem[]) => ({ ...world({ level: 57, ...KNIGHTS_AT, maxHp: 40, inventory }), nearbyPlayers: [{ index: 7, name: GIVER, distance: 1, x: KNIGHTS_AT.x + 1, z: KNIGHTS_AT.z }] } as never as BotWorldState);
    const sharks = [item(0, 'Shark'), item(1, 'Shark')];
    const SCENARIOS: Record<string, { opts: Parameters<typeof steps>[0]; inventory: TraceOpts['inventory'] }> = {
        plain: { opts: { food: 'shark' }, inventory: [shark(), shark()] },
        // one shark against below 2: the request goes out on every stun's +2
        idle: { opts: { food: 'shark', topUp: { giver: GIVER, below: 2 } }, inventory: [shark()] },
        restart: { opts: { food: 'shark', topUp: { giver: GIVER, below: 2, mode: 'restart' } }, inventory: [shark()] }
    };
    // from the module before stunPack (thieving.ts at 407dd863), with this harness
    const GOLDEN: Record<string, { packets: number; sha256: string }> = {
        plain: { packets: 120, sha256: 'a93d631d4e7f54552dda4deffd33b2e4476244cd4b1a904989be2543612509e5' },
        idle: { packets: 102, sha256: '2b0cee7947e00b07eff43b3e9f21ef6a9a27ca403dc30e8fe31f0ab30e2fbf9e' },
        restart: { packets: 120, sha256: 'a93d631d4e7f54552dda4deffd33b2e4476244cd4b1a904989be2543612509e5' }
    };

    test('the knights band sends exactly the pre-pack packets', async () => {
        const now: Record<string, { packets: number; sha256: string }> = {};
        for (const [k, sc] of Object.entries(SCENARIOS)) {
            const t = packetTrace(await knightsParams(sc.opts, at(sharks)), { inventory: sc.inventory, giverAt: [1, 0] });
            now[k] = { packets: t.length, sha256: sha(t) };
        }
        if (process.env.THIEVING_GOLDEN_PRINT) console.log(JSON.stringify(now, null, 4));
        expect(now).toEqual(GOLDEN);
    });
});

// ------------------------------------------------------------------ the stun pack

const named = (slot: number, name: string, count = 1, options: string[] = []): InventoryItem => ({ slot, id: 300 + slot, name, count, optionsWithIndex: options.map((text, i) => ({ text, opIndex: i + 1 })) });

/** Load 0 (stun-pack.md section 6) at the knights, the giver on the east side tile. */
function packWorld(o: { magic?: number; boosted?: number; fletching?: number; giverAt?: [number, number] | null; inventory?: InventoryItem[]; equipment?: string[]; drop?: RegExp } = {}): BotWorldState {
    const inventory = o.inventory ?? [
        named(0, 'Shark', 1, ['Eat']), named(1, 'Shark', 1, ['Eat']), named(2, 'Blood rune', 489), named(3, 'Air rune', 489), named(4, 'Headless arrow', 3600),
        named(5, 'Bronze arrowheads', 60), named(6, 'Iron arrowheads', 90), named(7, 'Steel arrowheads', 135), named(8, 'Mithril arrowheads', 225),
        ...Array.from({ length: 16 }, (_, i) => named(9 + i, 'Dragon bones', 1, ['Bury']))
    ];
    const s = world({ level: 57, ...KNIGHTS_AT, maxHp: 97, inventory: inventory.filter(i => !o.drop?.test(i.name)) });
    const giverAt: [number, number] | null = o.giverAt === undefined ? [1, 0] : o.giverAt;
    return {
        ...s,
        skills: [...s.skills, { name: 'Magic', level: o.boosted ?? o.magic ?? 80, baseLevel: o.magic ?? 80, experience: 1000 }, { name: 'Fletching', level: o.fletching ?? 1, baseLevel: o.fletching ?? 1, experience: 0 }, { name: 'Prayer', level: 43, baseLevel: 43, experience: 500 }],
        equipment: (o.equipment ?? ['Staff of fire']).map((n, i) => named(i, n)),
        nearbyPlayers: giverAt ? [{ kind: 'player', index: 7, name: GIVER, combatLevel: 3, x: KNIGHTS_AT.x + giverAt[0], z: KNIGHTS_AT.z + giverAt[1], distance: Math.max(Math.abs(giverAt[0]), Math.abs(giverAt[1])) }] : []
    } as BotWorldState;
}

const PACK = { chargeUnlocked: true };
const TOPUP = { giver: GIVER, below: 2 };

/** The scripted program's inventory: Load 0's kinds, as the pickpocket program sees them. */
function kit(o: { bones?: number; sharks?: number } = {}): KitItem[] {
    return [
        ...Array.from({ length: o.sharks ?? 2 }, () => ({ name: 'Shark', options: ['Eat', 'Drop'] })),
        { name: 'Blood rune', count: 489 }, { name: 'Air rune', count: 489 }, { name: 'Headless arrow', count: 3600 }, { name: 'Bronze arrowheads', count: 60 },
        ...Array.from({ length: o.bones ?? 16 }, () => ({ name: 'Dragon bones', options: ['Bury', 'Drop'] }))
    ];
}

/** Each failure's packets by stun offset k (k = 0 is the tick whose state shows the failure), as action types. */
function byOffset(t: ReturnType<typeof programTrace>, k: number): string[][] {
    return t.fails.filter(f => f + 8 < 320).map(f => t.h.sent.filter(s => s.tick === f + k).map(s => s.action.type));
}

describe('thieving: the stun pack', () => {
    test('off by default, and false is off: the same params as no option at all', async () => {
        const s = packWorld();
        const none = await knightsParams({ food: 'shark', topUp: TOPUP }, s);
        expect(await knightsParams({ food: 'shark', topUp: TOPUP, stunPack: false }, s)).toEqual(none);
        expect(none.stunActions).toEqual([topUpAction(TOPUP, FOODS.shark)]);
    });

    test('options: needs a top-up; bonesBelow a whole number >= 1; no unknown keys', () => {
        expect(() => steps({ stunPack: true })).toThrow(/stunPack needs topUp/);
        expect(() => steps({ topUp: TOPUP, stunPack: { bonesBelow: 0 } })).toThrow(/bonesBelow/);
        expect(() => steps({ topUp: TOPUP, stunPack: { bonesBelow: 2.5 } })).toThrow(/bonesBelow/);
        expect(() => steps({ topUp: TOPUP, stunPack: { giver: 'x' } as never })).toThrow(/no option 'giver'/);
        expect(() => steps({ topUp: TOPUP, stunPack: { chargeUnlocked: 'yes' } as never })).toThrow(/chargeUnlocked/);
        expect(() => steps({ topUp: TOPUP, stunPack: { sipForCharge: 'yes' } as never })).toThrow(/sipForCharge must be true or false/);
        expect(() => steps({ topUp: TOPUP, stunPack: 'on' as never })).toThrow(/stunPack must be/);
        expect(steps({ topUp: TOPUP, stunPack: true }).length).toBe(7);
        expect(STUN_PACK_BONES_BELOW).toBe(3);
    });

    test('idle mode: the food top-up, the bones top-up, then bury, charge and arrows; every key one the program declares', async () => {
        const params = await knightsParams({ food: 'shark', topUp: TOPUP, stunPack: PACK }, packWorld());
        expect(params.stunActions).toEqual([topUpAction(TOPUP, FOODS.shark), bonesTopUpAction(TOPUP, 3), 'bury', 'charge', 'arrows']);
        expect(bonesTopUpAction(TOPUP, 3)).toEqual({ name: 'topup:bones', kind: 'player', player: '^cairn_mule2$', fewer: [{ item: 'bones$', than: 3 }], window: [2, 2] });
        expect(params.idleOnInterface).toBe(true);
        expect(params).not.toHaveProperty('stunWindow');
        expect(params).not.toHaveProperty('stunPerTick');
        const declared = new Set<string>(createPickpocket.params);
        expect(Object.keys(params).filter(k => !declared.has(k))).toEqual([]);
        expect(() => createPickpocket(params)).not.toThrow();
        // only the 57-99 band: knights-55 starts without it
        const sdk = new PageSdk(packWorld());
        sdk.state = { ...sdk.state!, skills: sdk.state!.skills.map(k => (k.name === 'Thieving' ? { ...k, level: 55, baseLevel: 55 } : k)) };
        sdk.ending = [levelTo(57)];
        await steps({ food: 'shark', topUp: TOPUP, stunPack: PACK }).find(x => x.name === 'thieving:knights-55')!.run(harness(sdk).ctx);
        expect(sdk.starts[0]!.stunActions).toEqual([topUpAction(TOPUP, FOODS.shark)]);
    });

    test('arrowhead tiers agree with the program\'s arrows preset; the pack is its presets', () => {
        const preset = STUN_PRESETS.arrows!.map(a => [a.name, a.from]);
        expect(preset).toEqual(ARROWHEAD_TIERS.map(([t, l]) => [`arrows:${t}`, l]));
        for (const n of STUN_PACK_ACTIONS) expect(STUN_PRESETS[n]).toBeDefined();
        expect(STUN_PRESETS.bury![0]!.item).toBe('bones$');
    });

    test('the packets: a stocked stun sends three Charges and a bury at +2, +4 and +6, the click alone on the rest ticks and +7', async () => {
        const params = await knightsParams({ food: 'shark', topUp: TOPUP, stunPack: PACK }, packWorld());
        const t = programTrace(params, { ticks: 120, inventory: kit(), giverAt: [1, 0] });
        const stocked = ['clickComponent', 'clickComponent', 'clickComponent', 'useInventoryItem', 'interactNpc'];
        for (const k of [2, 4, 6]) for (const ticks of byOffset(t, k)) expect(ticks).toEqual(stocked);
        for (const k of [3, 5, 7]) for (const ticks of byOffset(t, k)) expect(ticks).toEqual(['interactNpc']);
        expect(t.h.sent.some(s => s.action.type === 'interactPlayer')).toBe(false);
        // the bury is the bones, the button is Charge
        const k2 = t.h.sent.filter(s => s.tick === t.fails[0]! + 2);
        expect(k2.filter(s => s.action.type === 'clickComponent').every(s => (s.action as { componentId: number }).componentId === 1193)).toBe(true);
        expect(t.h.status.counters['stun:bury']).toBe(3 * byOffset(t, 2).length);
    });

    test('the packets: at Magic 99 the delay-free slots fletch arrows', async () => {
        const params = await knightsParams({ food: 'shark', topUp: TOPUP, stunPack: PACK }, packWorld({ magic: 99 }));
        const t = programTrace(params, { ticks: 120, inventory: kit(), magic: 99, giverAt: [1, 0] });
        for (const ticks of byOffset(t, 2)) expect(ticks).toEqual(['useItemOnItem', 'useItemOnItem', 'useItemOnItem', 'useInventoryItem', 'interactNpc']);
        expect(t.h.status.counters['stun:charge']).toBeUndefined();
        expect(t.h.status.counters['stun:arrows:bronze']).toBeGreaterThan(0);
    });

    test('the packets: with bones below the bar the request owns +2, nothing goes out while it waits, and the stun buries after the hold', async () => {
        const params = await knightsParams({ food: 'shark', topUp: TOPUP, stunPack: PACK }, packWorld());
        const t = programTrace(params, { ticks: 120, inventory: kit({ bones: 2 }), giverAt: [1, 0] });
        for (const ticks of byOffset(t, 2)) expect(ticks).toEqual(['interactPlayer']);
        for (const k of [3, 4, 5]) for (const ticks of byOffset(t, k)) expect(ticks).toEqual([]);
        // no trade opened (scripted): the program carries on at +6, two bones and the click
        for (const ticks of byOffset(t, 6)) expect(ticks).toEqual(['clickComponent', 'clickComponent', 'clickComponent', 'useInventoryItem', 'interactNpc']);
        expect(t.h.status.counters['stun:topup:bones']).toBe(byOffset(t, 2).length);
        expect(t.h.status.counters['stun:topup']).toBeUndefined();
    });

    test('the packets: food and bones both low send one request, the food one; a giver on a corner gets none', async () => {
        const params = await knightsParams({ food: 'shark', topUp: TOPUP, stunPack: PACK }, packWorld());
        const both = programTrace(params, { ticks: 120, inventory: kit({ bones: 2, sharks: 1 }), giverAt: [1, 0] });
        for (const ticks of byOffset(both, 2)) expect(ticks).toEqual(['interactPlayer']);
        expect(both.h.status.counters['stun:topup']).toBe(byOffset(both, 2).length);
        expect(both.h.status.counters['stun:topup:bones']).toBeUndefined();
        // the program's own reach is distance <= 1, corners included; the start check refuses a corner
        expect(stunPackCheck(packWorld({ giverAt: [1, 1] }), GIVER, { chargeUnlocked: true, sipForCharge: true })).toMatch(/not on a side tile/);
        const far = programTrace(params, { ticks: 120, inventory: kit({ bones: 2 }), giverAt: [2, 0] });
        expect(far.h.sent.some(s => s.action.type === 'interactPlayer')).toBe(false);
    });

    test('the packets with the pack differ from the ones without it only in the stuns', async () => {
        const s = packWorld();
        const without = packetTrace(await knightsParams({ food: 'shark', topUp: TOPUP }, s), { inventory: kit(), giverAt: [1, 0] });
        const withPack = packetTrace(await knightsParams({ food: 'shark', topUp: TOPUP, stunPack: PACK }, s), { inventory: kit(), giverAt: [1, 0] });
        const clicks = (lines: string[]) => lines.filter(l => l.includes('"interactNpc"'));
        expect(clicks(withPack)).toEqual(clicks(without));
        expect(withPack.length).toBeGreaterThan(without.length);
    });
});

describe('thieving: the stun pack\'s start check', () => {
    const pack = { bonesBelow: 3, chargeUnlocked: false, sipForCharge: true };
    const check = (s: BotWorldState, p = pack) => stunPackCheck(s, GIVER, p);
    const god = (extra: Parameters<typeof packWorld>[0] = {}) => packWorld({ equipment: ['Staff of fire'], ...extra, inventory: [...packWorld().inventory, named(30, 'Saradomin staff')] });

    test('passes on Load 0 with a god staff held, or worn, or chargeUnlocked from the record', () => {
        expect(check(god())).toBe(true);
        expect(check(packWorld({ equipment: ['Staff of fire', 'Zamorak staff'] }))).toBe(true);
        expect(check(packWorld(), { ...pack, chargeUnlocked: true })).toBe(true);
    });

    test('each refusal', () => {
        expect(check(packWorld({ magic: 79 }), { ...pack, chargeUnlocked: true })).toBe("the stun pack's Charge needs Magic 80: base 79, boosted 79, no magic potion held");
        expect(check(packWorld())).toMatch(/Mage Arena stage 8/);
        expect(check(god({ equipment: [] }))).toMatch(/staff of fire wielded/);
        expect(check(packWorld({ drop: /^blood rune$/i }), { ...pack, chargeUnlocked: true })).toMatch(/3 blood and 3 air runes \(holding 0 and 489\)/);
        expect(check(packWorld({ drop: /^headless arrow$/i }), { ...pack, chargeUnlocked: true })).toMatch(/need headless arrows/);
        expect(check(packWorld({ drop: /^bronze arrowheads$/i }), { ...pack, chargeUnlocked: true })).toMatch(/arrowheads Fletching 1 can use \(bronze\)/);
        expect(check(packWorld({ giverAt: null }), { ...pack, chargeUnlocked: true })).toMatch(/not in sight/);
        expect(check(packWorld({ giverAt: [-1, 1] }), { ...pack, chargeUnlocked: true })).toMatch(/at -1,1 from the account, not on a side tile/);
        expect(check(packWorld({ giverAt: [0, 2] }), { ...pack, chargeUnlocked: true })).toMatch(/not on a side tile/);
    });

    test('Charge checks boosted Magic 80, as the engine does; base 79 passes on a magic potion to sip', () => {
        const unlocked = { ...pack, chargeUnlocked: true };
        const withPotion = (o: Parameters<typeof packWorld>[0] = {}) => packWorld({ ...o, inventory: [...packWorld().inventory, MAGIC_POTION(3)] });
        expect(check(packWorld({ magic: 80 }), unlocked)).toBe(true);
        expect(chargeSipPotion(withPotion({ magic: 80 }), unlocked)).toBeUndefined();
        // a boost already up needs no sip
        expect(check(packWorld({ magic: 79, boosted: 80 }), unlocked)).toBe(true);
        expect(chargeSipPotion(packWorld({ magic: 79, boosted: 80, inventory: [...packWorld().inventory, MAGIC_POTION(1)] }), unlocked)).toBeUndefined();
        // base 79, boosted 79: any dose held passes, and is the one to sip
        expect(check(withPotion({ magic: 79 }), unlocked)).toBe(true);
        expect(chargeSipPotion(withPotion({ magic: 79 }), unlocked)?.name).toBe('Magic potion(3)');
        expect(check(packWorld({ magic: 79 }), unlocked)).toBe("the stun pack's Charge needs Magic 80: base 79, boosted 79, no magic potion held");
        // a drained level counts as the engine counts it
        expect(check(packWorld({ magic: 80, boosted: 78 }), unlocked)).toBe("the stun pack's Charge needs Magic 80: base 80, boosted 78, no magic potion held");
        // the potion held but not sipped: the refusal says why
        expect(check(withPotion({ magic: 79 }), { ...unlocked, sipForCharge: false })).toBe("the stun pack's Charge needs Magic 80: base 79, boosted 79, a magic potion held (sipForCharge off)");
        expect(check(withPotion({ magic: 78 }), unlocked)).toBe("the stun pack's Charge needs Magic 80: base 78, boosted 78, a magic potion held (the sip is for base 79 only)");
    });

    test('Charge is not checked at Magic 99, nor the arrows at Fletching 99', () => {
        expect(check(packWorld({ magic: 99, equipment: [], drop: /rune$/i }))).toBe(true);
        expect(check(packWorld({ fletching: 99, drop: /arrow/i }), { ...pack, chargeUnlocked: true })).toBe(true);
        // mithril only, at Fletching 44: no usable tier
        expect(check(packWorld({ fletching: 44, drop: /^(bronze|iron|steel) arrowheads$/i }), { ...pack, chargeUnlocked: true })).toMatch(/can use \(steel, iron, bronze\)/);
    });

    test('the band refuses at its start; a finished band does not check', () => {
        const knights = steps({ topUp: TOPUP, stunPack: true }).find(s => s.name === 'thieving:knights')!;
        expect(knights.preconditions(packWorld({ giverAt: [1, 1] }), {})).toMatch(/Mage Arena stage 8/);
        expect(knights.preconditions(god({ giverAt: [1, 1] }), {})).toMatch(/not on a side tile/);
        expect(knights.preconditions(god(), {})).toBe(true);
        const done = { ...packWorld({ giverAt: null }), skills: [{ name: 'Thieving', level: 99, baseLevel: 99, experience: 0 }] } as BotWorldState;
        expect(knights.preconditions(done, {})).toBe(true);
        // without the pack the band does not look for the giver
        expect(steps({ topUp: TOPUP }).find(s => s.name === 'thieving:knights')!.preconditions(packWorld({ giverAt: null }), {})).toBe(true);
    });

    test('a resumed band (no precondition walk) refuses before its first packet', async () => {
        const sdk = new ManualPageSdk(packWorld({ giverAt: [1, 1] }));
        const { ctx } = harness(sdk);
        await expect(steps({ topUp: TOPUP, stunPack: PACK }).find(s => s.name === 'thieving:knights')!.run(ctx)).rejects.toThrow(/not on a side tile/);
        expect(sdk.starts).toEqual([]);
        expect(sdk.sent).toEqual([]);
    });
});

/** A magic potion as the client lists it (potions.obj: iop1 Drink, iop4 Empty), in slot 25, after Load 0. */
const MAGIC_POTION = (doses: number): InventoryItem => ({ slot: 25, id: 3040, name: `Magic potion(${doses})`, count: 1, optionsWithIndex: [{ text: 'Drink', opIndex: 1 }, { text: 'Empty', opIndex: 4 }] });

describe('thieving: the stun pack\'s sip for Charge', () => {
    const magicTo = (st: BotWorldState, level: number) => st.skills.map(k => (k.name === 'Magic' ? { ...k, level } : k));
    /** The band on a page whose engine answers a dose: +4 boosted Magic and one dose fewer, on the next tick. */
    function sipping(s: BotWorldState) {
        const sdk = new ManualPageSdk(s);
        sdk.onSend = (a, f) => {
            if (a.method !== 'sendUseItem') return;
            queueMicrotask(() => f.tick(st => ({
                skills: magicTo(st, st.skills.find(k => k.name === 'Magic')!.level + 4) as never,
                inventory: st.inventory.map(i => (i.slot === a.args[0] ? MAGIC_POTION(Number(/\((\d)\)/.exec(i.name)![1]) - 1) : i))
            })));
        };
        const { ctx } = harness(sdk);
        const done = steps({ food: 'shark', topUp: TOPUP, stunPack: PACK }).find(x => x.name === 'thieving:knights')!.run(ctx);
        const finish = async () => {
            sdk.publish({ phase: 'done', result: { reason: 'level' } }, { skills: [...sdk.state!.skills.filter(k => k.name !== 'Thieving'), { name: 'Thieving', level: 99, baseLevel: 99, experience: 0 }] as never });
            await done;
            return (ctx.log.rows.find(r => r.step === 'thieving:knights:detail')!.meta as { pack: Record<string, unknown> }).pack;
        };
        return { sdk, done, finish };
    }

    test('stunPack.sipForCharge defaults on', () => {
        expect(parseStunPack(true, TOPUP)).toEqual({ bonesBelow: 3, chargeUnlocked: false, sipForCharge: true });
        expect(parseStunPack({ sipForCharge: false }, TOPUP)).toMatchObject({ sipForCharge: false });
    });

    test('base 80: no sip, and the program starts on the same params', async () => {
        const world80 = packWorld({ inventory: [...packWorld().inventory, MAGIC_POTION(4)] });
        const { sdk, finish } = sipping(world80);
        await settle(() => sdk.starts.length === 1);
        expect(sdk.sent).toEqual([]);
        const pack = await finish();
        expect(pack).not.toHaveProperty('sip');
        expect(sdk.state!.inventory.some(i => i.name === 'Magic potion(4)')).toBe(true);
    });

    test('base 79 with a potion: exactly one sip, the boost observed, then the program on the base-80 params', async () => {
        const base80 = await knightsParams({ food: 'shark', topUp: TOPUP, stunPack: PACK }, packWorld());
        const { sdk, finish } = sipping(packWorld({ magic: 79, inventory: [...packWorld().inventory, MAGIC_POTION(4)] }));
        const t0 = sdk.state!.tick;
        await settle(() => sdk.starts.length === 1);
        // the dose, by its Drink op, before the program (which sends every Charge) starts
        expect(sdk.sent).toEqual([{ method: 'sendUseItem', args: [25, 1] }]);
        expect(sdk.state!.skills.find(k => k.name === 'Magic')).toMatchObject({ level: 83, baseLevel: 79 });
        expect(sdk.starts[0]!.tick).toBeGreaterThan(t0);
        // the stun schedule is the base-80 one: the same params, so the same packets
        expect(sdk.starts[0]!.params).toEqual(base80);
        const pack = await finish();
        expect(sdk.sent.filter(a => a.method === 'sendUseItem')).toHaveLength(1);
        expect(pack.sip).toEqual({ potion: 'Magic potion(4)', base: 79, from: 79, to: 83, sentTick: t0, boostedTick: t0 + 1, resends: 0 } satisfies ChargeSip);
        expect(sdk.starts[0]!.tick).toBeGreaterThanOrEqual((pack.sip as ChargeSip).boostedTick);
    });

    test('base 79 without a potion: the band refuses with base, boosted and no potion, before any packet', async () => {
        const { sdk, done } = sipping(packWorld({ magic: 79 }));
        await expect(done).rejects.toThrow("the stun pack's Charge needs Magic 80: base 79, boosted 79, no magic potion held");
        expect(sdk.starts).toEqual([]);
        expect(sdk.sent).toEqual([]);
        const knights = steps({ topUp: TOPUP, stunPack: PACK }).find(s => s.name === 'thieving:knights')!;
        expect(knights.preconditions(packWorld({ magic: 79 }), {})).toBe("the stun pack's Charge needs Magic 80: base 79, boosted 79, no magic potion held");
        expect(knights.preconditions(packWorld({ magic: 79, inventory: [...packWorld().inventory, MAGIC_POTION(1)] }), {})).toBe(true);
    });

    test('a dose that never shows fails the band after CHARGE_SIP_MAX_TICKS, re-sent once', async () => {
        const sdk = new ManualPageSdk(packWorld({ magic: 79, inventory: [...packWorld().inventory, MAGIC_POTION(4)] }));
        const { ctx } = harness(sdk);
        const done = steps({ food: 'shark', topUp: TOPUP, stunPack: PACK }).find(x => x.name === 'thieving:knights')!.run(ctx);
        let failed: unknown;
        done.catch(e => { failed = e; });
        for (let i = 0; i < 12 && !failed; i++) {
            await flush();
            sdk.tick();
        }
        await settle(() => !!failed);
        expect(String(failed)).toMatch(/sip for Charge did not raise Magic to 80 within 8 ticks: base 79, boosted 79 \(Magic potion\(4\)\)/);
        expect(sdk.sent.map(a => a.method)).toEqual(['sendUseItem', 'sendUseItem']);
        expect(sdk.starts).toEqual([]);
    });
});

describe('thieving: the stun pack across top-ups and restarts', () => {
    test('topUpDue: with the pack, a new failure with bones below the bar is due even with food', () => {
        const st = { counters: { fails: 3 }, gauges: { food: 2 } };
        expect(topUpDue(st, 2, 2)).toBe(false);
        expect(topUpDue(st, 2, 2, { held: 2, below: 3 })).toBe(true);
        expect(topUpDue(st, 2, 2, { held: 3, below: 3 })).toBe(false);
        expect(topUpDue(st, 3, 2, { held: 0, below: 3 })).toBe(false);
    });

    test('restart mode: the presets alone, a stop on the bones, the trade, and a restart with the same pack within TOPUP_RESTART_BY ticks', async () => {
        const sdk = new ManualPageSdk(packWorld({ inventory: [named(0, 'Shark', 1, ['Eat']), named(1, 'Shark', 1, ['Eat']), named(2, 'Blood rune', 489), named(3, 'Air rune', 489), named(4, 'Headless arrow', 3600), named(5, 'Bronze arrowheads', 60), named(6, 'Dragon bones', 1, ['Bury']), named(7, 'Dragon bones', 1, ['Bury'])] }));
        const BONE_ID = 536;
        const bones = (st: BotWorldState) => [...st.inventory, ...Array.from({ length: 15 }, (_, i) => ({ ...named(10 + i, 'Dragon bones', 1, ['Bury']), id: BONE_ID }))];
        const offer = (which: 'offer' | 'confirm') => ({ ...screen(which), theirOffer: [{ slot: 0, id: BONE_ID, name: 'Dragon bones', count: 15 }] });
        sdk.onSend = (a, s) => {
            const t = s.state!.trade;
            if (a.method === 'sendTradeRequest') queueMicrotask(() => s.tick({ trade: offer('offer') as never }));
            if (a.method === 'sendAcceptTrade' && t?.screen === 'offer') queueMicrotask(() => s.tick({ trade: offer('confirm') as never }));
            if (a.method === 'sendAcceptTrade' && t?.screen === 'confirm') queueMicrotask(() => s.tick(st => ({ trade: CLOSED as never, inventory: bones(st) })));
        };
        const { ctx } = harness(sdk);
        const done = steps({ food: 'shark', topUp: { giver: GIVER, below: 2, mode: 'restart' }, stunPack: PACK }).find(s => s.name === 'thieving:knights')!.run(ctx);
        await settle(() => sdk.starts.length === 1);
        expect(sdk.starts[0]!.params.stunActions).toEqual([...STUN_PACK_ACTIONS]);
        expect(sdk.starts[0]!.params.idleOnInterface).toBeUndefined();

        // two sharks (not below 2) and two bones (below 3): the failure's status stops the program
        sdk.publish({ counters: { fails: 0 }, gauges: { food: 2 } });
        sdk.publish({ counters: { fails: 1, 'stun:bury': 3, stunFired: 12 }, gauges: { food: 2 } });
        const failTick = sdk.state!.tick;
        await settle(() => sdk.starts.length === 2);
        expect(sdk.ops).toEqual(['start', 'stop', 'start']);
        expect(sdk.starts[1]!.tick - failTick).toBeLessThanOrEqual(TOPUP_RESTART_BY);
        expect(sdk.starts[1]!.params).toEqual(sdk.starts[0]!.params);
        expect(sdk.sent.map(a => a.method)).toEqual(['sendTradeRequest', 'sendAcceptTrade', 'sendAcceptTrade']);

        sdk.publish({ phase: 'done', result: { reason: 'level' }, counters: { fails: 4, 'stun:bury': 9, 'stun:charge': 20, stunFired: 29 } }, { skills: [...sdk.state!.skills.filter(k => k.name !== 'Thieving'), { name: 'Thieving', level: 99, baseLevel: 99, experience: 0 }] as never });
        await done;
        const meta = ctx.log.rows.find(r => r.step === 'thieving:knights:detail')!.meta as { topUp: { restarts: Array<{ ok: boolean; received: number }> }; pack: ReturnType<typeof packReport> };
        expect(meta.topUp.restarts.map(r => [r.ok, r.received])).toEqual([[true, 15]]);
        // the stopped run's counters count too
        expect(meta.pack).toMatchObject({ buried: 12, charges: 20, fired: 41 });
    });

    test('idle mode: the detail row reports what the pack sent and the experience it gained', async () => {
        const sdk = new ManualPageSdk(packWorld());
        const { ctx } = harness(sdk);
        const done = steps({ food: 'shark', topUp: TOPUP, stunPack: PACK }).find(s => s.name === 'thieving:knights')!.run(ctx);
        await settle(() => sdk.starts.length === 1);
        const after = sdk.state!.skills.map(k => {
            if (k.name === 'Thieving') return { ...k, level: 99, baseLevel: 99 };
            if (k.name === 'Prayer') return { ...k, level: 85, baseLevel: 85, experience: 500 + 14400 };
            if (k.name === 'Magic') return { ...k, level: 99, baseLevel: 99, experience: 1000 + 29700 };
            if (k.name === 'Fletching') return { ...k, level: 99, baseLevel: 99, experience: 130000 };
            return k;
        });
        sdk.publish({ phase: 'done', result: { reason: 'level' }, counters: { fails: 84, 'stun:bury': 200, 'stun:charge': 165, 'stun:arrows:bronze': 4, 'stun:arrows:rune': 173, 'stun:topup': 1, 'stun:topup:bones': 12, stunFired: 555, stunRejected: 0 } }, { skills: after as never });
        await done;
        const meta = ctx.log.rows.find(r => r.step === 'thieving:knights:detail')!.meta as { pack: ReturnType<typeof packReport> };
        expect(meta.pack).toMatchObject({
            bonesBelow: 3, buried: 200, charges: 165, arrowActions: 177, topUpRequests: 13, fired: 555, rejected: 0,
            xp: { prayer: 14400, magic: 29700, fletching: 130000 }, levels: { prayer: [43, 85], magic: [80, 99], fletching: [1, 99] }
        });
        expect(meta.pack.counters).not.toHaveProperty('fails');
    });
});

// ------------------------------------------------------------------ superheat

const SH = { chargeUnlocked: true, superheat: true };

/** Load 0 with superheat (stun-pack.md section 16): nature runes and ore in place of the bones. */
function shWorld(o: { magic?: number; smithing?: number; ore?: Array<[string, number]>; drop?: RegExp; equipment?: string[]; giverAt?: [number, number] | null } = {}): BotWorldState {
    let slot = 9;
    const ore = (o.ore ?? [['Iron ore', 16]]).flatMap(([name, n]) => Array.from({ length: n }, () => named(slot++, name, 1, ['Use', 'Drop'])));
    const inventory = [
        named(0, 'Shark', 1, ['Eat']), named(1, 'Shark', 1, ['Eat']), named(2, 'Blood rune', 489), named(3, 'Air rune', 489), named(4, 'Headless arrow', 3600),
        named(5, 'Bronze arrowheads', 60), named(6, 'Iron arrowheads', 90), named(7, 'Nature rune', 160), ...ore
    ].filter(i => !o.drop?.test(i.name));
    const s = packWorld({ inventory, ...(o.magic === undefined ? {} : { magic: o.magic }), ...(o.equipment ? { equipment: o.equipment } : {}), ...(o.giverAt === undefined ? {} : { giverAt: o.giverAt }) });
    const smithing = o.smithing ?? 15;
    return { ...s, skills: [...s.skills, { name: 'Smithing', level: smithing, baseLevel: smithing, experience: xpForLevel(smithing) }] } as BotWorldState;
}

/** The scripted program's superheat kit: runes, arrows, ore and any bars already made. */
function shKit(o: { iron?: number; copper?: number; tin?: number; bars?: number; blood?: number } = {}): KitItem[] {
    const n = (k: number, name: string, options = ['Use', 'Drop']) => Array.from({ length: k }, () => ({ name, options }));
    return [
        ...n(2, 'Shark', ['Eat', 'Drop']), { name: 'Blood rune', count: o.blood ?? 489 }, { name: 'Air rune', count: 489 }, { name: 'Nature rune', count: 160 }, { name: 'Headless arrow', count: 3600 }, { name: 'Bronze arrowheads', count: 60 },
        // a bar publishes no options (its obj declares no ops; the client's Drop is implicit)
        ...n(o.iron ?? 0, 'Iron ore'), ...n(o.copper ?? 0, 'Copper ore'), ...n(o.tin ?? 0, 'Tin ore'), ...n(o.bars ?? 0, 'Iron bar', [])
    ];
}

describe('thieving: the stun pack with superheat', () => {
    test('off by default: superheat false, or not passed, sends the bury pack', async () => {
        const s = packWorld();
        const pack = await knightsParams({ food: 'shark', topUp: TOPUP, stunPack: PACK }, s);
        expect(await knightsParams({ food: 'shark', topUp: TOPUP, stunPack: { ...PACK, superheat: false } }, s)).toEqual(pack);
        expect(pack.stunActions).toEqual([topUpAction(TOPUP, FOODS.shark), bonesTopUpAction(TOPUP, 3), 'bury', 'charge', 'arrows']);
        expect(parseStunPack(true, TOPUP)).not.toHaveProperty('superheat');
    });

    test('options: true is 2 casts and oreBelow 2; casts 1 or 2; no unknown keys; bonesBelow refused beside it', () => {
        expect(parseStunPack({ superheat: true }, TOPUP)!.superheat).toEqual({ casts: 2, oreBelow: 2 });
        expect(parseStunPack({ superheat: { casts: 1 } }, TOPUP)!.superheat).toEqual({ casts: 1, oreBelow: 1 });
        expect(parseStunPack({ superheat: { oreBelow: 4 } }, TOPUP)!.superheat).toEqual({ casts: 2, oreBelow: 4 });
        expect(() => parseStunPack({ superheat: { casts: 3 } }, TOPUP)).toThrow(/casts must be 1 or 2/);
        expect(() => parseStunPack({ superheat: { oreBelow: 0 } }, TOPUP)).toThrow(/oreBelow must be a whole number/);
        expect(() => parseStunPack({ superheat: { ore: 'iron' } as never }, TOPUP)).toThrow(/superheat has no option 'ore'/);
        expect(() => parseStunPack({ superheat: 'on' as never }, TOPUP)).toThrow(/superheat must be true or/);
        expect(() => parseStunPack({ superheat: true, bonesBelow: 3 }, TOPUP)).toThrow(/bonesBelow has no effect with superheat/);
        expect(() => parseStunPack({ superheat: true }, undefined)).toThrow(/its ore arrive through the top-up trade/);
        expect(SUPERHEAT_SPELL).toBe(Spells.SUPERHEAT);
        // 12 bronze bars at 155 game xp reach Smithing 15's 1,860 (rs/367's 12 copper and 12 tin)
        expect(SUPERHEAT_BRONZE_CASTS).toBe(12);
    });

    test('idle params: the food and ore top-ups, iron then bronze casts, the bar drops, charge, arrows; the program parses them', async () => {
        const params = await knightsParams({ food: 'shark', topUp: TOPUP, stunPack: SH }, shWorld());
        expect(params.stunActions).toEqual([topUpAction(TOPUP, FOODS.shark), oreTopUpAction(TOPUP, 2), ...superheatActions({ casts: 2, oreBelow: 2 }, true), DROP_BARS, 'charge', 'arrows']);
        expect(oreTopUpAction(TOPUP, 2)).toEqual({ name: 'topup:ore', kind: 'player', player: '^cairn_mule2$', fewer: [{ item: '^(iron|copper) ore$', than: 2 }], window: [2, 2] });
        const declared = new Set<string>(createPickpocket.params);
        expect(Object.keys(params).filter(k => !declared.has(k))).toEqual([]);
        const tpl = parseStunActions(params.stunActions);
        expect(tpl.filter(t => t.name.startsWith('superheat')).map(t => [t.name, t.delay, t.rest, t.skipClick, t.window])).toEqual([['superheat:iron', 'tick2', 2, true, [2, 5]], ['superheat:bronze', 'tick2', 2, true, [2, 5]]]);
        // restart mode: the actions alone
        expect(stunActionsFor({ ...TOPUP, mode: 'restart' }, FOODS.shark, parseStunPack(SH, TOPUP))).toEqual([...superheatActions({ casts: 2, oreBelow: 2 }, true), DROP_BARS, 'charge', 'arrows']);
        // no fire staff worn: each cast also needs its 4 fire runes
        expect(superheatActions({ casts: 1, oreBelow: 1 }, false)[0]).toMatchObject({ needs: [{ item: '^nature runes?$', count: 1 }, { item: '^fire runes?$', count: 4 }], window: [2, 2] });
    });

    test('the program refuses a tick2 window past +5 and any unknown action key', () => {
        expect(() => parseStunActions([{ ...superheatActions({ casts: 2, oreBelow: 2 }, true)[0], window: [2, 6] }])).toThrow(/window ending by \+5/);
        expect(() => parseStunActions([{ ...DROP_BARS, rest: 2 }])).toThrow(/has no key 'rest'/);
        expect(() => parseStunActions([{ ...DROP_BARS, op: 6 }])).toThrow(/OPHELD op, 1 to 5/);
        expect(() => parseStunActions([{ name: 'x', kind: 'item', item: 'bar$' }])).toThrow(/needs item and option \(or op\)/);
        expect(() => parseStunActions([{ ...DROP_BARS, skipClick: true }])).toThrow(/skipClick needs a 'tick' or 'tick2' delay/);
    });

    test('the packets: a stocked stun casts on +2 and +5 behind four delay-free actions and no click, rests +3, +4, +6 and +7', async () => {
        const params = await knightsParams({ food: 'shark', topUp: TOPUP, stunPack: SH }, shWorld());
        const t = programTrace(params, { ticks: 120, inventory: shKit({ iron: 10 }), smithing: 20, giverAt: [1, 0] });
        const cast = ['clickComponent', 'clickComponent', 'clickComponent', 'clickComponent', 'spellOnItem'];
        for (const k of [2, 5]) for (const ticks of byOffset(t, k)) expect(ticks).toEqual(cast);
        for (const k of [3, 4, 6, 7, 8]) for (const ticks of byOffset(t, k)) expect(ticks).toEqual(['interactNpc']);
        const k2 = t.h.sent.filter(s => s.tick === t.fails[0]! + 2).map(s => s.action);
        // Superheat on the first iron ore (slot 7 in shKit), by its IF component
        expect(k2[4]).toEqual({ type: 'spellOnItem', slot: 7, spellComponent: Spells.SUPERHEAT });
        const stuns = byOffset(t, 2).length;
        expect(t.h.status.counters['stun:superheat:iron']).toBe(2 * stuns);
        expect(t.h.status.counters.stunClickSkips).toBe(2 * stuns);
        expect(t.h.status.counters['stun:bury']).toBeUndefined();
        // the clicks outside the stuns are the bury pack's
        const bury = packetTrace(await knightsParams({ food: 'shark', topUp: TOPUP, stunPack: PACK }, packWorld()), { inventory: kit(), giverAt: [1, 0] });
        const inStun = (line: string) => t.fails.some(f => { const tick = Number(line.split(' ')[0]); return tick > f && tick <= f + 7; });
        const clicks = (lines: string[]) => lines.filter(l => l.includes('"interactNpc"') && !inStun(l));
        expect(clicks(t.lines)).toEqual(clicks(bury));
    });

    test('the packets: bars held are dropped first, then Charge; out of blood, arrows fill the slots', async () => {
        const params = await knightsParams({ food: 'shark', topUp: TOPUP, stunPack: SH }, shWorld());
        const t = programTrace(params, { ticks: 120, inventory: shKit({ iron: 10, bars: 2 }), smithing: 20, giverAt: [1, 0] });
        for (const ticks of byOffset(t, 2)) expect(ticks).toEqual(['useInventoryItem', 'useInventoryItem', 'clickComponent', 'clickComponent', 'spellOnItem']);
        // the two bars (slots 17 and 18, after ten ores) by OPHELD5, the client's Drop
        const drops = t.h.sent.filter(s => s.tick === t.fails[0]! + 2 && s.action.type === 'useInventoryItem').map(s => s.action);
        expect(drops).toEqual([{ type: 'useInventoryItem', slot: 17, optionIndex: 5 }, { type: 'useInventoryItem', slot: 18, optionIndex: 5 }]);
        const dry = programTrace(params, { ticks: 120, inventory: shKit({ iron: 10, blood: 0 }), smithing: 20, giverAt: [1, 0] });
        for (const ticks of byOffset(dry, 2)) expect(ticks).toEqual(['useItemOnItem', 'useItemOnItem', 'useItemOnItem', 'useItemOnItem', 'spellOnItem']);
        expect(dry.h.status.counters['stun:charge']).toBeUndefined();
    });

    test('the packets: below Smithing 15 bronze, copper with tin; iron waits for 15', async () => {
        const params = await knightsParams({ food: 'shark', topUp: TOPUP, stunPack: SH }, shWorld({ smithing: 1, ore: [['Copper ore', 6], ['Tin ore', 6]] }));
        const t = programTrace(params, { ticks: 120, inventory: shKit({ iron: 4, copper: 4, tin: 4 }), smithing: 1, giverAt: [1, 0] });
        const k2 = t.h.sent.filter(s => s.tick === t.fails[0]! + 2).map(s => s.action);
        // the first copper ore (slots 7-10 hold iron)
        expect(k2[4]).toEqual({ type: 'spellOnItem', slot: 11, spellComponent: Spells.SUPERHEAT });
        expect(t.h.status.counters['stun:superheat:iron']).toBeUndefined();
        expect(t.h.status.counters['stun:superheat:bronze']).toBe(2 * byOffset(t, 2).length);
        // copper without tin casts nothing
        const noTin = programTrace(params, { ticks: 120, inventory: shKit({ copper: 4 }), smithing: 1 });
        expect(noTin.h.sent.some(s => s.action.type === 'spellOnItem')).toBe(false);
    });

    test('the packets: no ore and no giver beside it, no cast: every window tick carries four delay-free actions and the click', async () => {
        const params = await knightsParams({ food: 'shark', topUp: TOPUP, stunPack: SH }, shWorld());
        const t = programTrace(params, { ticks: 120, inventory: shKit(), smithing: 20 });
        expect(t.h.sent.some(s => s.action.type === 'spellOnItem' || s.action.type === 'interactPlayer')).toBe(false);
        for (const k of [2, 3, 4, 5, 6, 7]) for (const ticks of byOffset(t, k)) expect(ticks).toEqual(['clickComponent', 'clickComponent', 'clickComponent', 'clickComponent', 'interactNpc']);
        expect(t.h.status.counters.stunClickSkips).toBeUndefined();
    });

    test('the packets: ore below oreBelow with the giver on a side tile, the ore top-up owns +2 and the stun casts nothing while it holds', async () => {
        const params = await knightsParams({ food: 'shark', topUp: TOPUP, stunPack: SH }, shWorld());
        const t = programTrace(params, { ticks: 120, inventory: shKit({ iron: 1 }), smithing: 20, giverAt: [1, 0] });
        for (const ticks of byOffset(t, 2)) expect(ticks).toEqual(['interactPlayer']);
        for (const k of [3, 4, 5]) for (const ticks of byOffset(t, k)) expect(ticks).toEqual([]);
        expect(t.h.status.counters['stun:topup:ore']).toBe(byOffset(t, 2).length);
        expect(t.h.sent.some(s => s.action.type === 'spellOnItem')).toBe(false);
        // low on sharks as well: one request, the food one (the courier brings the ore with it)
        const both = programTrace(params, { ticks: 120, inventory: shKit({ iron: 1 }).filter((it, i) => !(it.name === 'Shark' && i === 0)), smithing: 20, giverAt: [1, 0] });
        expect(both.h.status.counters['stun:topup']).toBe(byOffset(both, 2).length);
        expect(both.h.status.counters['stun:topup:ore']).toBeUndefined();
    });

    test('casts 1: one cast on +2, and +5 carries delay-free actions and the click', async () => {
        const params = await knightsParams({ food: 'shark', topUp: TOPUP, stunPack: { ...SH, superheat: { casts: 1 } } }, shWorld());
        const t = programTrace(params, { ticks: 120, inventory: shKit({ iron: 10 }), smithing: 20, giverAt: [1, 0] });
        for (const ticks of byOffset(t, 2)) expect(ticks.at(-1)).toBe('spellOnItem');
        for (const ticks of byOffset(t, 5)) expect(ticks).toEqual(['clickComponent', 'clickComponent', 'clickComponent', 'clickComponent', 'interactNpc']);
    });
});

describe('thieving: the superheat start check', () => {
    const check = (s: BotWorldState) => stunPackCheck(s, GIVER, { chargeUnlocked: true, sipForCharge: true, superheat: { casts: 2, oreBelow: 2 } });

    test('passes on its Load 0; each refusal names what is missing', () => {
        expect(check(shWorld())).toBe(true);
        expect(check(shWorld({ drop: /^nature rune$/i }))).toBe("the stun pack's Superheat needs nature runes (holding 0)");
        expect(check(shWorld({ ore: [] }))).toBe("the stun pack's Superheat needs ore for a cast: iron ore at Smithing 15 or more, or copper and tin ore (Smithing 15; holding 0 iron, 0 copper, 0 tin)");
        expect(check(shWorld({ smithing: 1 }))).toMatch(/\(Smithing 1; holding 16 iron, 0 copper, 0 tin\)/);
        expect(check(shWorld({ smithing: 1, ore: [['Copper ore', 1], ['Tin ore', 1]] }))).toBe(true);
        // no fire staff: Charge refuses first while its runes are held; without them Superheat wants fire runes
        expect(check(shWorld({ equipment: [] }))).toMatch(/Charge needs a staff of fire wielded/);
        expect(check(shWorld({ equipment: [], drop: /^blood rune$/i }))).toBe("the stun pack's Superheat needs a staff of fire wielded or 4 fire runes a cast (holding 0 fire runes)");
    });

    test('without blood runes Charge is not checked (Superheat carries Magic); with them it is', () => {
        expect(check(shWorld({ magic: 79, drop: /^blood rune$/i }))).toBe(true);
        expect(check(shWorld({ magic: 79 }))).toMatch(/Charge needs Magic 80: base 79/);
        // the bury pack still refuses without blood runes
        expect(stunPackCheck(shWorld({ drop: /^blood rune$/i }), GIVER, { chargeUnlocked: true, sipForCharge: true })).toMatch(/3 blood and 3 air runes \(holding 0 and 489\)/);
        expect(check(shWorld({ magic: 40, drop: /^blood rune$/i }))).toBe("the stun pack's Superheat needs Magic 43: boosted 40");
    });

    test('the band refuses before its first packet', async () => {
        const sdk = new ManualPageSdk(shWorld({ ore: [] }));
        await expect(steps({ topUp: TOPUP, stunPack: SH }).find(s => s.name === 'thieving:knights')!.run(harness(sdk).ctx)).rejects.toThrow(/Superheat needs ore for a cast/);
        expect(sdk.starts).toEqual([]);
        expect(sdk.sent).toEqual([]);
    });
});

describe('thieving: the superheat top-up', () => {
    const smith = (s: BotWorldState, xp: number) => ({ ...s, skills: s.skills.map(k => (k.name === 'Smithing' ? { ...k, experience: xp, level: 1, baseLevel: xp >= 1860 ? 15 : 1 } : k)) }) as BotWorldState;

    test('superheatLoad: bronze pairs while bronze casts are due, iron in the rest; a slot-ledger `in` cell', () => {
        const s = shWorld({ smithing: 1, ore: [] });
        expect(superheatLoad(smith(s, 0), 16)).toBe('copper ore to 8 [u]; tin ore to 8 [u]');
        // 8 bars made: 4 bronze casts still due, then iron
        expect(superheatLoad(smith(s, 8 * 155), 16)).toBe('copper ore to 4 [u]; tin ore to 4 [u]; iron ore to 8 [u]');
        expect(superheatLoad(smith(shWorld({ ore: [['Iron ore', 3]] }), 1860), 13)).toBe('iron ore to 16 [u]');
        expect(superheatLoad(s, 0)).toBe('');
        expect(parseIn('copper ore to 4 [u]; tin ore to 4 [u]; iron ore to 8 [u]')).toEqual([
            { name: 'copper ore', count: 4, kind: 'u', topUp: true }, { name: 'tin ore', count: 4, kind: 'u', topUp: true }, { name: 'iron ore', count: 8, kind: 'u', topUp: true }
        ]);
    });

    test('restart mode stops for a top-up on ore below the bar', () => {
        const st = { counters: { fails: 3 }, gauges: { food: 2 } };
        expect(topUpDue(st, 2, 2, { held: 1, below: 2 })).toBe(true);
        expect(topUpDue(st, 2, 2, { held: 2, below: 2 })).toBe(false);
    });

    test('the detail row: casts, bar drops, skipped clicks and Smithing', async () => {
        const sdk = new ManualPageSdk(shWorld({ smithing: 1, ore: [['Copper ore', 8], ['Tin ore', 8]] }));
        const { ctx } = harness(sdk);
        const done = steps({ food: 'shark', topUp: TOPUP, stunPack: SH }).find(s => s.name === 'thieving:knights')!.run(ctx);
        await settle(() => sdk.starts.length === 1);
        const after = sdk.state!.skills.map(k => (k.name === 'Thieving' ? { ...k, level: 99, baseLevel: 99 } : k.name === 'Smithing' ? { ...k, level: 53, baseLevel: 53, experience: 41860 } : k));
        sdk.publish({ phase: 'done', result: { reason: 'level' }, counters: { fails: 90, 'stun:superheat:bronze': 12, 'stun:superheat:iron': 128, 'stun:drop:bars': 139, 'stun:charge': 163, 'stun:topup:ore': 9, 'stun:topup': 2, stunClickSkips: 140, stunFired: 600 } }, { skills: after as never });
        await done;
        const meta = ctx.log.rows.find(r => r.step === 'thieving:knights:detail')!.meta as { pack: ReturnType<typeof packReport> };
        expect(meta.pack).toMatchObject({ superheat: { casts: 2, oreBelow: 2 }, superheats: 140, barDrops: 139, clickSkips: 140, charges: 163, buried: 0, topUpRequests: 11, xp: { smithing: 41860 }, levels: { smithing: [1, 53] } });
    });
});

// ------------------------------------------------------------------ knight choice

describe('thieving: the knight choice', () => {
    // A is the nearer knight (2 tiles from the account), B the farther (4); the page lists B first
    const A = { index: 21, x: 2669, z: 3303 };
    const B = { index: 22, x: 2671, z: 3309 };
    const KNIGHT = /^Knight of Ardougne$/i;
    const cheb = (x: number, z: number) => Math.max(Math.abs(x - KNIGHTS_AT.x), Math.abs(z - KNIGHTS_AT.z));
    const knight = (k: typeof A) => ({ kind: 'npc', index: k.index, name: 'Knight of Ardougne', x: k.x, z: k.z, distance: cheb(k.x, k.z), optionsWithIndex: [{ text: 'Pickpocket', opIndex: 3 }] });
    function knightWorld(players: Array<[string, number, number]>, inventory: InventoryItem[] = [item(0, 'Shark'), item(1, 'Shark')]): BotWorldState {
        const s = world({ level: 57, ...KNIGHTS_AT, maxHp: 40, inventory });
        return {
            ...s,
            nearbyNpcs: [knight(B), knight(A)],
            nearbyPlayers: players.map(([name, x, z], i) => ({ kind: 'player', index: 30 + i, name, combatLevel: 99, x, z, distance: cheb(x, z) }))
        } as never as BotWorldState;
    }
    // two rivals next to A (one diagonal), one on A's own tile and one two tiles from B: neither of those counts
    const CROWD_ON_A: Array<[string, number, number]> = [['zalpha', 2670, 3304], ['zbravo', 2668, 3303], ['zcharlie', 2669, 3303], ['zdelta', 2673, 3309]];
    const UNCROWDED = { knight: { prefer: 'uncrowded' as const } };

    test('off by default, and prefer nearest is off: no prefer param and no knight row', async () => {
        const s = knightWorld(CROWD_ON_A);
        const off = await knightsParams({ food: 'shark' }, s);
        expect(off).not.toHaveProperty('prefer');
        expect(await knightsParams({ food: 'shark', knight: { prefer: 'nearest' } }, s)).toEqual(off);
        expect(await knightsParams({ food: 'shark', knight: {} }, s)).toEqual(off);

        const sdk = new PageSdk(s);
        sdk.ending = [levelTo(99)];
        const { ctx } = harness(sdk);
        await steps({ food: 'shark' }).find(x => x.name === 'thieving:knights')!.run(ctx);
        expect(ctx.log.rows.find(r => r.step === 'thieving:knights:detail')!.meta).not.toHaveProperty('knight');
    });

    test('a crowded knight A and an empty knight B: B is chosen and A is the retarget', async () => {
        expect(chooseKnight(knightWorld(CROWD_ON_A), KNIGHT, [])).toEqual({
            candidates: [{ index: 21, x: 2669, z: 3303, distance: 2, players: 2 }, { index: 22, x: 2671, z: 3309, distance: 4, players: 0 }],
            chosen: 22, retarget: 21
        });
        const sdk = new PageSdk(knightWorld(CROWD_ON_A));
        sdk.ending = [levelTo(99)];
        const { ctx } = harness(sdk);
        await steps({ food: 'shark', ...UNCROWDED }).find(x => x.name === 'thieving:knights')!.run(ctx);
        expect(sdk.starts[0]).toMatchObject({ prefer: [22, 21], retargetTicks: 12 });
        const meta = ctx.log.rows.find(r => r.step === 'thieving:knights:detail')!.meta as { knight: { prefer: string; choices: KnightChoice[] } };
        expect(meta.knight.prefer).toBe('uncrowded');
        expect(meta.knight.choices).toEqual([{ tick: 100, why: 'start', candidates: chooseKnight(knightWorld(CROWD_ON_A), KNIGHT, []).candidates, chosen: 22, retarget: 21 }]);
    });

    test('ties keep the nearest; the account\'s courier and the account itself never count', () => {
        // one rival next to each knight
        expect(chooseKnight(knightWorld([['zalpha', 2670, 3304], ['zbravo', 2672, 3310]]), KNIGHT, [])).toMatchObject({ chosen: 21, retarget: 22 });
        // nobody but the courier next to A, and a player named as the account next to A
        const s = knightWorld([[GIVER, 2670, 3304], ['t', 2668, 3302]]);
        expect(chooseKnight(s, KNIGHT, [GIVER])).toMatchObject({ chosen: 21, retarget: 22, candidates: [{ players: 0 }, { players: 0 }] });
        // without the exclusion the courier would push the choice to B
        expect(chooseKnight(s, KNIGHT, [])).toMatchObject({ chosen: 22 });
    });

    test('the band passes the courier as excluded: a courier next to A keeps A', async () => {
        const s = knightWorld([[GIVER, 2670, 3304]], [item(0, 'Shark')]);
        const params = await knightsParams({ food: 'shark', topUp: { giver: GIVER, below: 2 }, ...UNCROWDED }, s);
        expect(params.prefer).toEqual([21, 22]);
    });

    test('one knight in sight is the only choice; none leaves the program its default', () => {
        const one = { ...knightWorld(CROWD_ON_A), nearbyNpcs: [knight(A)] } as never as BotWorldState;
        expect(chooseKnight(one, KNIGHT, [])).toMatchObject({ chosen: 21, retarget: null });
        expect(chooseKnight({ ...one, nearbyNpcs: [] }, KNIGHT, [])).toEqual({ candidates: [], chosen: null, retarget: null });
    });

    test('the retarget the program publishes goes to the other knight and is recorded', async () => {
        const sdk = new ManualPageSdk(knightWorld(CROWD_ON_A));
        const { ctx } = harness(sdk);
        const done = steps({ food: 'shark', ...UNCROWDED }).find(x => x.name === 'thieving:knights')!.run(ctx);
        await settle(() => sdk.starts.length === 1);
        expect(sdk.starts[0]!.params.prefer).toEqual([22, 21]);
        const statuses: Array<Partial<ProgramStatus>> = [{ gauges: { target: 22 } }, { gauges: { target: 22 }, counters: { rolls: 4 } }, { gauges: { target: 21 }, counters: { retargets: 1 } }];
        for (const p of statuses) {
            await flush();
            sdk.publish(p);
        }
        await flush();
        sdk.publish({ phase: 'done', result: { reason: 'level' } }, { skills: [{ name: 'Thieving', level: 99, baseLevel: 99, experience: 0 }] as never });
        await done;
        const meta = ctx.log.rows.find(r => r.step === 'thieving:knights:detail')!.meta as { knight: { choices: KnightChoice[] } };
        expect(meta.knight.choices.map(c => [c.why, c.chosen])).toEqual([['start', 22], ['retarget', 21]]);
        expect(meta.knight.choices[1]!.candidates.map(c => [c.index, c.players])).toEqual([[21, 2], [22, 0]]);
    });

    test('a restock chooses again on the way back', async () => {
        const sdk = new PageSdk(knightWorld(CROWD_ON_A, [item(0, 'Coins', { count: 900, eat: false })]));
        sdk.state = { ...sdk.state!, bank: { isOpen: false, noteMode: false, items: [{ slot: 0, id: 501, name: 'Shark', count: 11 }] } } as BotWorldState;
        sdk.onSend = (a, s) => {
            // the crowd has moved to B by the time the account is back
            if (a.method === 'sendBankWithdraw') s.tick(st => ({ inventory: [...st.inventory, ...Array.from({ length: 11 }, (_, i) => item(i + 1, 'Shark'))], nearbyPlayers: [{ kind: 'player', index: 40, name: 'zecho', combatLevel: 99, x: 2672, z: 3310, distance: 5 }] }) as never);
        };
        sdk.ending = [() => ({ status: { result: { reason: 'food' } } }), levelTo(99)];
        const { ctx } = harness(sdk);
        await steps({ food: 'shark', ...UNCROWDED }).find(x => x.name === 'thieving:knights')!.run(ctx);
        expect(sdk.starts.map(p => p.prefer)).toEqual([[22, 21], [21, 22]]);
        const meta = ctx.log.rows.find(r => r.step === 'thieving:knights:detail')!.meta as { knight: { choices: KnightChoice[] } };
        expect(meta.knight.choices.map(c => [c.why, c.chosen])).toEqual([['start', 22], ['restock', 21]]);
    });

    test('parseKnight refuses what it does not know', () => {
        expect(parseKnight(undefined)).toBeUndefined();
        expect(parseKnight({ prefer: 'nearest' })).toBeUndefined();
        expect(parseKnight({ prefer: 'uncrowded' })).toBe('uncrowded');
        expect(() => parseKnight({ prefer: 'emptiest' })).toThrow("knight.prefer must be 'nearest' or 'uncrowded'");
        expect(() => parseKnight({ prefer: 'uncrowded', radius: 2 })).toThrow("knight has no option 'radius'");
        expect(() => parseKnight('uncrowded')).toThrow('knight must be');
        expect(() => steps({ knight: { prefer: 'emptiest' as never } })).toThrow();
    });
});
