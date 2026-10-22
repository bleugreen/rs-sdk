import { afterEach, describe, expect, test } from 'bun:test';
import type { ActionResult, BotWorldState, InventoryItem } from '../../sdk/types';
import { GEM } from '../helpers/jeweller';
import { ITEM as WINE } from '../helpers/wine-common';
import { baseState, FakeSdk, flush, type SentAction } from '../lib/fake-sdk';
import type { ProgramStatus } from '../lib/programs';
import type { RelogResult } from '../lib/session';
import { TickLog } from '../lib/ticks';
import { levelForXp, XP_RATE, xpForLevel } from '../lib/xp';
import { runSteps, type Observed, type RunnerSession, type StepContext } from '../runner/step';
import {
    BOOTH,
    CHISEL,
    chooseStacks,
    cookingStep,
    CRAFTING_AFTER_WINDOWS,
    CUT_IDS,
    firstBurst,
    GEM_RECIPES,
    GEMS_IN_WINDOWS,
    newRun,
    preconditions,
    relogGuarded,
    relogKind,
    restBurst,
    STEP_NAME,
    steps,
    UNCUT_IDS,
    windowGemBaseXp,
    WINDOW_GEMS,
    windowWorkFor,
    wineBankProbe,
    withdrawButtons,
    type WineBankProbe
} from './cooking';
import { CRAFTING_HANDOFF_XP, WINDOW_GEM_BASE_XP } from './crafting';

const STAND = { x: 3185, z: 3436 };
const BOOTH_LOC = { id: 2213, name: 'Bank booth', x: 3186, z: 3436, level: 0, distance: 1, options: ['Use', 'Use-quickly'], optionsWithIndex: [{ text: 'Use', opIndex: 1 }, { text: 'Use-quickly', opIndex: 2 }] };
const SAPPHIRE = GEM.sapphire;

const item = (slot: number, id: number, count = 1, name = `obj ${id}`): InventoryItem => ({ slot, id, name, count, optionsWithIndex: [] }) as unknown as InventoryItem;
const skillsOf = (o: { cooking?: number; crafting?: number; smithing?: number; herblore?: number }) =>
    [
        ['Cooking', o.cooking ?? xpForLevel(30)],
        ['Crafting', o.crafting ?? CRAFTING_HANDOFF_XP],
        ['Smithing', o.smithing ?? xpForLevel(99)],
        ['Herblore', o.herblore ?? xpForLevel(99)]
    ].map(([name, experience]) => ({ name, level: levelForXp(experience as number), baseLevel: levelForXp(experience as number), experience })) as never;

function player(o: { x?: number; z?: number; inCombat?: boolean; lastDamageTick?: number } = {}) {
    return { name: 'SCORED', worldX: o.x ?? STAND.x, worldZ: o.z ?? STAND.z, x: 0, z: 0, level: 0, combat: { inCombat: o.inCombat ?? false, targetIndex: -1, targetType: 'none', lastDamageTick: o.lastDamageTick ?? -1 } } as never;
}

function world(o: { inventory?: InventoryItem[]; skills?: Parameters<typeof skillsOf>[0]; tick?: number; at?: { x: number; z: number }; inCombat?: boolean; lastDamageTick?: number; locs?: boolean } = {}): BotWorldState {
    return baseState({ tick: o.tick ?? 100, player: player({ ...o.at, inCombat: o.inCombat, lastDamageTick: o.lastDamageTick }), skills: skillsOf(o.skills ?? {}), inventory: o.inventory ?? [], nearbyLocs: o.locs === false ? [] : ([BOOTH_LOC] as never) });
}

describe('the content', () => {
    test('the windows cut 107 gems, 6,567.5 base: exactly the hand-off to 99 (crafting.ts defines the hand-off)', () => {
        expect(GEMS_IN_WINDOWS).toBe(107);
        expect(WINDOW_GEMS).toEqual({ diamond: 2, ruby: 20, emerald: 23, sapphire: 62 });
        expect(windowGemBaseXp()).toBe(WINDOW_GEM_BASE_XP);
        expect(CRAFTING_AFTER_WINDOWS).toBe(xpForLevel(99));
        expect(CRAFTING_HANDOFF_XP + windowGemBaseXp() * XP_RATE).toBe(xpForLevel(99));
    });

    test('GEM_RECIPES: chisel on each uncut gem, its cut product and xp (jeweller.ts GEM)', () => {
        expect(GEM_RECIPES.map(r => [r.name, r.level, r.xp, r.a, r.tool, r.products])).toEqual([
            ['diamond', 43, 107.5, 1617, CHISEL, [1601]],
            ['ruby', 34, 85, 1619, CHISEL, [1603]],
            ['emerald', 27, 67.5, 1621, CHISEL, [1605]],
            ['sapphire', 20, 50, 1623, CHISEL, [1607]]
        ]);
        expect(BOOTH).toMatchObject({ x: 3186, z: 3436, id: 2213, stand: STAND });
    });
});

describe('burst 1: the fewest stacks that fill the free slots', () => {
    const stacks = [
        { id: 1617, count: 2, xp: 107.5 },
        { id: 1619, count: 20, xp: 85 },
        { id: 1621, count: 23, xp: 67.5 },
        { id: 1623, count: 62, xp: 50 }
    ];
    test('the run: sapphire All alone fills the 26 (one packet, the burst stays 10 events)', () => {
        expect(chooseStacks(stacks, 26)).toEqual([{ id: 1623, take: 26 }]);
    });
    test('two stacks fill it: the highest-xp one that fills alone wins', () => {
        expect(chooseStacks(stacks, 20)).toEqual([{ id: 1619, take: 20 }]);
    });
    test('no stack fills it: the largest first', () => {
        expect(chooseStacks(stacks.slice(0, 3), 26)).toEqual([{ id: 1621, take: 23 }, { id: 1619, take: 3 }]);
        expect(chooseStacks([], 26)).toEqual([]);
        expect(chooseStacks(stacks, 0)).toEqual([]);
    });
    test('withdrawButtons: All when it gives exactly the take, else 10/5/1', () => {
        expect(withdrawButtons(26, 26)).toEqual([-1]);
        expect(withdrawButtons(7, 26)).toEqual([5, 1, 1]);
    });
});

describe('preconditions', () => {
    test('at the booth with S25a, S25d and S25e done, nothing held: pass', () => {
        expect(preconditions(world())).toBe(true);
    });
    test('the free-slot rule: 28 items held refuse with the module template; 27 pass', () => {
        const inv = Array.from({ length: 28 }, (_, i) => item(i, 1511 + (i % 2), 1, i % 2 ? 'Oak logs' : 'Logs'));
        expect(preconditions(world({ inventory: inv }))).toBe('28 other items (Logs, Oak logs): need 1 free slots');
        expect(preconditions(world({ inventory: inv.slice(0, 27) }))).toBe(true);
        // the chisel is not "other", but it still takes the slot
        expect(preconditions(world({ inventory: [item(0, CHISEL, 1, 'Chisel'), ...inv.slice(1)] }))).toBe('27 other items (Oak logs, Logs): need 1 free slots');
        // a resume with the notes already held needs no slot for them
        expect(preconditions(world({ inventory: [item(0, WINE.wineNote, 491), ...inv.slice(1)] }))).toBe(true);
    });
    test('not beside the booth, or the booth not in view', () => {
        expect(preconditions(world({ at: { x: 3180, z: 3436 } }))).toMatch(/^not beside the booth/);
        expect(preconditions(world({ at: { x: 3184, z: 3436 } }))).toBe(true);
        expect(preconditions({ ...world(), nearbyLocs: [{ ...BOOTH_LOC, x: 3190 }] as never })).toMatch(/^no bank booth/);
    });
    test('S25a, S25e and S25d each not done; lab fixtures skip them', () => {
        expect(preconditions(world({ skills: { smithing: xpForLevel(98) } }))).toBe('S25a not done: Smithing 98');
        expect(preconditions(world({ skills: { herblore: xpForLevel(80) } }))).toBe('S25e not done: Herblore 80');
        expect(preconditions(world({ skills: { crafting: CRAFTING_HANDOFF_XP - 1 } }))).toMatch(/^S25d not done: Crafting xp/);
        expect(preconditions(world({ skills: { smithing: 0, herblore: 0, crafting: xpForLevel(55) } }), { lab: true })).toBe(true);
    });
    test('in combat, or hit within 16 ticks: refuse (the relog would wait it out on the scored clock)', () => {
        expect(preconditions(world({ inCombat: true }))).toMatch(/^in combat/);
        expect(preconditions(world({ tick: 100, lastDamageTick: 90 }))).toBe('hit 10 ticks ago: a relog waits 16 ticks out of combat');
        expect(preconditions(world({ tick: 100, lastDamageTick: 83 }))).toBe(true);
    });
    test('Cooking 99 passes (done); Crafting 99 turns the window work off', () => {
        expect(preconditions(world({ skills: { cooking: xpForLevel(99) }, at: { x: 0, z: 0 } }))).toBe(true);
        expect(windowWorkFor(world({ skills: { crafting: xpForLevel(99) } }))).toBe('none');
        expect(windowWorkFor(world())).toBe('gems');
        expect(windowWorkFor(world(), { windowWork: 'none' })).toBe('none');
    });
});

describe('relog labels', () => {
    test('the arming relog once the first firing shows; a deadline before it, and after a resume past it', () => {
        const s = world();
        const run = newRun(s);
        expect(relogKind(run, s)).toBe('deadline');
        const fired = world({ skills: { cooking: xpForLevel(53) } });
        expect(relogKind(run, fired)).toBe('planned-2');
        run.planned2 = true;
        expect(relogKind(run, fired)).toBe('deadline');
        expect(relogKind({ ...newRun(s), pastFirst: true }, fired)).toBe('deadline');
    });
});

// ---------------------------------------------------------------- the scripted world

function status(p: Partial<ProgramStatus>): ProgramStatus {
    const frames = { n: 0, p50: 0, p90: 0, max: 0, under150: 0, over350: 0, catchUps: 0, catchUpsLastMinute: 0, catchUpsPerMinute: 0 };
    return { runId: 1, name: 'item-cycle', phase: 'running', params: {}, startedTick: 0, tick: 0, progressTick: 0, counters: {}, gauges: {}, marks: {}, packets: 0, deferred: 0, skippedTicks: 0, maxTickMs: 0, frames, publish: frames, react: { n: 0, p50: 0, p90: 0, max: 0 }, loops: { last: 0, p10Last10s: 0, min: 0 }, ...p };
}

interface Obj {
    id: number;
    count: number;
}

const XP_PER_WINE = Math.ceil((xpForLevel(99) - xpForLevel(30)) / 520) + 1;
/** Cooking xp after the scripted first firing (29 good wines from 30). */
const AFTER_FIRST = xpForLevel(30) + 29 * XP_PER_WINE;
const CUT_OF = new Map(GEM_RECIPES.map(r => [r.a, r.products[0]!]));
const XP_OF = new Map(GEM_RECIPES.map(r => [r.a, r.xp]));

/**
 * SCORED at the booth, by the rules S25c rides on (wine-receive.ts's header; wine.md): each tick
 * runs the packets (deposits, withdrawals, continues, then a close), then the timer (fermenting_wine
 * fires on its due tick or the first later one with the bank shut, every banked wine good, and
 * queues level-up pages), then interactions (a booth click opens the bank once no page shows). A
 * continue ends one page a tick. A relog re-arms the timer at its login + 20 and runs out any page.
 * The page's item-cycle program is scripted: W1 (held) cuts the held uncut gems in place, W2 cuts
 * the banked ones and stows; its cuts close pages as they go.
 */
class Engine {
    readonly sdk: PageSdk;
    inv: Array<Obj | null> = Array(28).fill(null);
    bank: Obj[];
    bankOpen = false;
    cooking: number;
    crafting: number;
    pages = 0;
    due: number;
    loginTick: number;
    firings: Array<{ tick: number; wines: number }> = [];
    bankOpens: number[] = [];
    sends: Array<{ tick: number; method: string; args: unknown[] }> = [];
    relogs = 0;
    /** Ticks added before the bank opens on the first booth click after relog 1 (the deadline case). */
    firstOpenDelay = 0;
    /** Noted wines the giver's trade lands on relog 1's return (takeTrade then skips: they are held). */
    deliver = 520;
    /** Crafting level-up pages W1's cutting leaves queued when it ends (Crafting 55 leaves many). */
    w1Pages = 0;
    private openAt = -1;
    private continued = false;
    private queue: Array<() => void> = [];
    private program: { runId: number; params: Record<string, unknown>; endAt: number; result?: Record<string, unknown> } | null = null;
    private runs = 0;
    private timer: ReturnType<typeof setInterval> | null = null;
    private opensSinceRelog1 = 0;

    constructor(o: { tick?: number; inventory?: Array<Obj | null>; bank?: Obj[]; cooking?: number; crafting?: number; due?: number } = {}) {
        this.loginTick = o.tick ?? 100;
        (o.inventory ?? []).forEach((x, i) => (this.inv[i] = x ? { ...x } : null));
        this.bank = (o.bank ?? [{ id: CHISEL, count: 1 }, { id: 1617, count: 2 }, { id: 1619, count: 20 }, { id: 1621, count: 23 }, { id: 1623, count: 62 }]).map(b => ({ ...b }));
        this.cooking = o.cooking ?? xpForLevel(30);
        this.crafting = o.crafting ?? CRAFTING_HANDOFF_XP;
        this.due = o.due ?? Infinity;
        this.sdk = new PageSdk(this.state(this.loginTick));
        this.sdk.onSend = a => this.onSend(a);
        this.sdk.onProgram = p => this.startProgram(p);
    }

    state(tick: number): BotWorldState {
        const inventory = this.inv.flatMap((o, slot) => (o && o.count > 0 ? [item(slot, o.id, o.count)] : []));
        const bank = { isOpen: this.bankOpen, items: this.bank.map((b, slot) => ({ slot, id: b.id, name: `obj ${b.id}`, count: b.count })), noteMode: false };
        const p = this.program;
        return {
            ...world({ tick, inventory, skills: { cooking: this.cooking, crafting: this.crafting } }),
            bank,
            dialog: { isOpen: this.pages > 0, options: [], isWaiting: true },
            ...(p ? { program: status({ runId: p.runId, tick, startedTick: tick, ...(p.result ? { phase: 'done', endedTick: tick, result: p.result } : {}) }) } : {})
        } as BotWorldState;
    }

    private free(): number {
        return this.inv.findIndex(o => o === null);
    }

    private onSend(a: SentAction): void {
        const tick = this.sdk.state!.tick;
        this.sends.push({ tick, method: a.method, args: a.args });
        const [slot, amount] = a.args as [number, number];
        if (a.method === 'sendInteractLoc') {
            if (this.openAt < 0) this.openAt = tick + 1 + (this.relogs === 1 && this.opensSinceRelog1++ === 0 ? this.firstOpenDelay : 0);
        } else if (a.method === 'sendClickDialog') {
            this.queue.push(() => (this.continued = true));
        } else if (a.method === 'sendBankDeposit') {
            this.queue.push(() => {
                const it = this.inv[slot];
                if (!this.bankOpen || !it) return;
                const ids = it.id;
                let n = 0;
                if (it.id === WINE.wineNote) {
                    n = amount === -1 ? it.count : Math.min(amount, it.count);
                    it.count -= n;
                    if (it.count <= 0) this.inv[slot] = null;
                } else {
                    for (let i = 0; i < 28; i++) if (this.inv[i]?.id === ids) (n += this.inv[i]!.count), (this.inv[i] = null);
                }
                const id = ids === WINE.wineNote ? WINE.wine : ids;
                const b = this.bank.find(x => x.id === id);
                if (b) b.count += n;
                else this.bank.push({ id, count: n });
            });
        } else if (a.method === 'sendBankWithdraw') {
            this.queue.push(() => {
                const b = this.bank[slot];
                if (!this.bankOpen || !b) return;
                let want = amount === -1 ? b.count : Math.min(amount, b.count);
                while (want > 0 && this.free() >= 0 && b.count > 0) {
                    this.inv[this.free()] = { id: b.id, count: 1 };
                    b.count--;
                    want--;
                }
            });
        } else if (a.method === 'sendCloseModal') {
            this.queue.push(() => (this.bankOpen = false));
        }
    }

    private startProgram(params: Record<string, unknown>): void {
        const n = params.maxActions as number;
        const tick = this.sdk.state!.tick;
        const held = params.held === true;
        this.program = { runId: ++this.runs, params, endAt: tick + Math.ceil(n / 5) + (held ? 1 : 3 * Math.ceil(n / 27) + 1) };
    }

    private finishProgram(): void {
        const p = this.program!;
        const n = p.params.maxActions as number;
        const byRecipe: Record<string, number> = {};
        const credit = (uncut: number) => {
            this.crafting += XP_OF.get(uncut)! * XP_RATE;
            const name = GEM_RECIPES.find(r => r.a === uncut)!.name;
            byRecipe[name] = (byRecipe[name] ?? 0) + 1;
        };
        let done = 0;
        if (p.params.held) {
            this.pages += this.w1Pages;
            for (let i = 0; i < 28 && done < n; i++) {
                const o = this.inv[i];
                if (o && CUT_OF.has(o.id)) {
                    credit(o.id);
                    this.inv[i] = { id: CUT_OF.get(o.id)!, count: 1 };
                    done++;
                }
            }
        } else {
            // the booth cycle: every held item banked, the banked uncut cut in xp order, everything stowed
            for (let i = 0; i < 28; i++) {
                const o = this.inv[i];
                if (!o) continue;
                const b = this.bank.find(x => x.id === o.id);
                if (b) b.count += o.count;
                else this.bank.push({ ...o });
                this.inv[i] = null;
            }
            for (const r of GEM_RECIPES) {
                const b = this.bank.find(x => x.id === r.a);
                while (b && b.count > 0 && done < n) {
                    b.count--;
                    credit(r.a);
                    const cut = this.bank.find(x => x.id === r.products[0]);
                    if (cut) cut.count++;
                    else this.bank.push({ id: r.products[0]!, count: 1 });
                    done++;
                }
            }
        }
        p.result = { ended: held(p) ? 'load done' : 'maxActions', actions: done, sent: done, visits: held(p) ? 0 : Math.ceil(done / 27) + 1, resets: 0, drift: 0, levelups: 0, byRecipe, ticks: 0, cycleGaps: [], sendsPerTick: {}, xpDropsPerTick: {}, ...(held(p) ? {} : { stowed: true }) };
        function held(x: typeof p) {
            return x.params.held === true;
        }
    }

    /** relog's RelogResult for a tab relog that lands 2 ticks after its tick base. */
    relog = async (): Promise<RelogResult> => {
        this.relogs++;
        this.bankOpen = false;
        this.openAt = -1;
        this.pages = 0;
        this.program = null;
        this.queue = [];
        const tickBase = this.sdk.state!.tick;
        this.loginTick = tickBase + 2;
        // the login arms fermenting_wine on the session's tick 1 (tickBase + 1), before the first
        // published state (tickBase + 2 here): the lab measured every firing at tickBase + 21
        this.due = tickBase + 1 + 20;
        if (this.relogs === 1 && this.deliver > 0) {
            const at = this.free();
            this.inv[at] = { id: WINE.wineNote, count: this.deliver };
        }
        this.sdk.state = this.state(this.loginTick);
        return { logout: { ok: true, clickTick: tickBase, lastInWorldTick: tickBase, latencyTicks: 0, wallMs: 0 } as never, loginTick: this.loginTick, tickBase, via: 'page', loginWallMs: 0, attempts: 1 } as RelogResult;
    };

    private step(): void {
        const t = this.sdk.state!.tick + 1;
        const q = this.queue;
        this.queue = [];
        this.continued = false;
        // packets, in order (the close last of what was sent with it)
        for (const fn of q) fn();
        // a page open at the timer phase holds a normal timer, unless a continue (or a cut) in this
        // tick's packets closed it first (wine-window.md section 3)
        const cutting = !!this.program && !this.program.result;
        const pageHolds = this.pages > 0 && !this.continued && !cutting;
        if (this.continued && this.pages > 0) this.pages--;
        // timers: only with the bank shut
        if (t >= this.due && !this.bankOpen && !pageHolds) {
            const b = this.bank.find(x => x.id === WINE.wine);
            const wines = b?.count ?? 0;
            this.firings.push({ tick: t, wines });
            if (b) b.count = 0;
            if (wines) {
                const good = this.bank.find(x => x.id === WINE.jugWine);
                if (good) good.count += wines;
                else this.bank.push({ id: WINE.jugWine, count: wines });
                const before = levelForXp(this.cooking);
                this.cooking = Math.min(xpForLevel(99) + 1_000_000, this.cooking + wines * XP_PER_WINE);
                this.pages += Math.min(16, levelForXp(this.cooking) - before);
            }
            this.due = Infinity;
        }
        // the program: its cuts close pages; it ends on its tick
        if (this.program && !this.program.result) {
            if (this.pages > 0) this.pages--;
            if (t >= this.program.endAt) this.finishProgram();
        }
        // interactions
        if (this.openAt >= 0 && t >= this.openAt && this.pages === 0 && !this.bankOpen) {
            this.bankOpen = true;
            this.bankOpens.push(t);
            this.openAt = -1;
        }
        this.sdk.push(this.state(t));
    }

    start(): void {
        this.timer = setInterval(() => this.step(), 2);
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
    }

    /** User events sent on `tick` (a routed booth click is two on the browser client). */
    eventsAt(tick: number): number {
        return this.sends.filter(s => s.tick === tick).reduce((n, s) => n + (s.method === 'sendInteractLoc' ? 2 : 1), 0);
    }

    starts(): Array<Record<string, unknown>> {
        return this.sdk.starts;
    }
}

/** The page: a program start replies with its status and hands the params to the engine. */
class PageSdk extends FakeSdk {
    readonly starts: Array<Record<string, unknown>> = [];
    onProgram: (params: Record<string, unknown>) => void = () => {};
    override sendAction(a: SentAction | Record<string, unknown>): Promise<ActionResult> {
        const act = a as { type?: unknown; op?: unknown; params?: Record<string, unknown> };
        if (act.type !== 'program') return super.sendAction(a as SentAction);
        if (act.op === 'start') {
            this.starts.push(act.params ?? {});
            this.onProgram(act.params ?? {});
            return Promise.resolve({ success: true, message: 'ok', data: status({ runId: this.starts.length, tick: this.state!.tick, startedTick: this.state!.tick }) });
        }
        return Promise.resolve({ success: true, message: 'ok', data: status({ runId: this.starts.length }) });
    }
}

let engine: Engine | null = null;
afterEach(() => engine?.stop());

function sessionOf(e: Engine, tickBase?: number): RunnerSession {
    return { sdk: e.sdk, bot: {}, name: 'SCORED', sessionId: 1, ...(tickBase !== undefined ? { tickBase } : {}) } as unknown as RunnerSession;
}

async function runModule(e: Engine, opts: Parameters<typeof steps>[0] = {}) {
    engine = e;
    const log = TickLog.memory('t');
    e.start();
    const result = await runSteps(sessionOf(e), steps({ relog: e.relog, ...opts }), { log, c: {}, shouldStop: () => false, logout: async () => {}, tickMonitor: false });
    return { result, log, notes: log.rows.filter(r => r.kind === 'note').map(r => r.meta as Record<string, unknown>) };
}

const relogKinds = (notes: Array<Record<string, unknown>>) => notes.filter(n => n.what === 'relog').map(n => n.kind);

describe('S25c through runSteps (scripted world)', () => {
    test('the gems sequence: two relogs, burst 1 of 10 events, W1 on the held load with no booth click, the firings at login + 20, P1 within 4 events a tick, W2 mixed with stow', async () => {
        const e = new Engine();
        const { result, notes } = await runModule(e);
        expect(result).toEqual({ completed: 1 });
        expect(relogKinds(notes)).toEqual(['planned-1', 'planned-2']);
        const relogs = notes.filter(n => n.what === 'relog');
        expect(relogs.map(r => [r.via, r.cost])).toEqual([['page', 2], ['page', 2]]);
        const login1 = relogs[0]!.armedAt as number;
        const login2 = relogs[1]!.armedAt as number;
        // burst 1 on the bank-open tick: the seven 29 buttons, the chisel, sapphire All, the close
        const open1 = e.bankOpens[0]!;
        expect(open1).toBeLessThan(login1 + 20);
        expect(e.sends.filter(s => s.tick === open1).map(s => `${s.method} ${s.args.join(',')}`)).toEqual([
            ...['0,10', '0,10', '0,5', '0,1', '0,1', '0,1', '0,1'].map(a => `sendBankDeposit ${a}`),
            'sendBankWithdraw 0,1',
            'sendBankWithdraw 4,-1',
            'sendCloseModal '
        ]);
        expect(e.eventsAt(open1)).toBe(10);
        // W1: the held load, no bank
        expect(e.starts()[0]).toMatchObject({ mode: 'tool', skill: 'crafting', held: true, bank: false, mixed: true, maxActions: 26 });
        expect(e.starts()[0]!.booth).toBeUndefined();
        // the firings: 29 at login 1 + 20, the 491 at login 2 + 20
        expect(e.firings).toEqual([{ tick: login1 + 20, wines: 29 }, { tick: login2 + 20, wines: 491 }]);
        // nothing touches the booth between burst 1's close and the first firing
        expect(e.sends.filter(s => s.method === 'sendInteractLoc' && s.tick > open1 && s.tick < login1 + 20)).toEqual([]);
        // P1: the booth click and the continues, never more than 4 events a tick, then the rest burst
        const open2 = e.bankOpens[1]!;
        for (let t = login1 + 20; t < open2; t++) expect({ t, events: e.eventsAt(t) <= 4 }).toEqual({ t, events: true });
        expect(e.sends.filter(s => s.tick === open2).map(s => `${s.method} ${s.args.join(',')}`)).toEqual(['sendBankDeposit 0,-1', 'sendBankDeposit 2,-1', 'sendCloseModal ']);
        // W2 + P2: mixed loads with stow for the other 81
        expect(e.starts()[1]).toMatchObject({ mode: 'tool', skill: 'crafting', mixed: true, stow: true, maxActions: 81, booth: { ...BOOTH, option: 2 } });
        // the end: Cooking 99, Crafting 99, nothing held, every gem cut
        expect(levelForXp(e.cooking)).toBe(99);
        expect(e.crafting).toBe(xpForLevel(99));
        expect(e.inv.every(o => o === null)).toBe(true);
        expect(UNCUT_IDS.map(id => e.bank.find(b => b.id === id)?.count ?? 0)).toEqual([0, 0, 0, 0]);
        expect(CUT_IDS.map(id => e.bank.find(b => b.id === id)?.count ?? 0)).toEqual([2, 20, 23, 62]);
        // the slots, for rs/158's ledger row: 28 used at burst 1's end
        expect(notes.find(n => n.what === 'burst 1')).toMatchObject({ load: 26, slotsUsedBefore: 1, chiselWithdrawn: 1 });
    });

    test('W1 leaving level-up pages queued (Crafting 55): continues through due - 1, the firing still at login + 20, no deadline relog, P1 within 4 events', async () => {
        const e = new Engine();
        e.w1Pages = 12;
        const { result, notes } = await runModule(e);
        expect(result).toEqual({ completed: 1 });
        expect(relogKinds(notes)).toEqual(['planned-1', 'planned-2']);
        const login1 = notes.find(n => n.what === 'relog')!.armedAt as number;
        expect(e.firings[0]).toEqual({ tick: login1 + 20, wines: 29 });
        expect(e.starts()[0]).toMatchObject({ held: true });
        for (let t = login1 + 20; t < e.bankOpens[1]!; t++) expect({ t, events: e.eventsAt(t) <= 4 }).toEqual({ t, events: true });
    });

    test('the plain sequence (windowWork none): no program, the same two relogs, the chisel and gems left banked', async () => {
        const e = new Engine();
        const { result, notes } = await runModule(e, { windowWork: 'none' });
        expect(result).toEqual({ completed: 1 });
        expect(e.starts()).toEqual([]);
        expect(relogKinds(notes)).toEqual(['planned-1', 'planned-2']);
        expect(e.eventsAt(e.bankOpens[0]!)).toBe(8);
        expect(e.bank.find(b => b.id === SAPPHIRE.uncut)!.count).toBe(62);
    });

    test('no gems banked: the plain sequence by itself, no program started', async () => {
        const e = new Engine({ bank: [{ id: CHISEL, count: 1 }] });
        const { result, notes } = await runModule(e);
        expect(result).toEqual({ completed: 1 });
        expect(e.starts()).toEqual([]);
        expect(notes.some(n => n.what === 'no uncut gems banked: the plain sequence (Crafting then 121)')).toBe(true);
    });

    test('the deadline fallback: the bank opens on login + 20, the 29 and the gems are banked anyway, one deadline relog, then the sequence as planned', async () => {
        const e = new Engine();
        e.firstOpenDelay = 19;
        const { result, notes } = await runModule(e);
        expect(result).toEqual({ completed: 1 });
        expect(relogKinds(notes)).toEqual(['planned-1', 'deadline', 'planned-2']);
        const [r1, dl, r2] = notes.filter(n => n.what === 'relog').map(n => n.armedAt as number);
        // the first booth click went out on the first state (armedAt + 1); the bank opened 20 later
        expect(e.bankOpens[0]).toBe(r1! + 21);
        // the login timer fired on the empty bank; the deadline login's ferments the 29
        expect(e.firings).toEqual([{ tick: r1! + 20, wines: 0 }, { tick: dl! + 20, wines: 29 }, { tick: r2! + 20, wines: 491 }]);
        expect(e.starts()[0]).toMatchObject({ held: true, maxActions: 26 });
        expect(levelForXp(e.cooking)).toBe(99);
    });

    test('the relog guard: a page open is drained before the logout; an open bank refuses', async () => {
        const e = new Engine();
        engine = e;
        e.start();
        e.pages = 2;
        e.sdk.push(e.state(e.sdk.state!.tick));
        const ctx = { session: sessionOf(e), sdk: e.sdk, bot: {}, c: {}, log: TickLog.memory('t') } as unknown as StepContext<any>;
        const run = newRun(e.sdk.state!);
        await relogGuarded(ctx, run, 'planned-1', { relog: e.relog });
        const relogAt = e.sends.length;
        expect(e.sends.slice(0, relogAt).some(s => s.method === 'sendClickDialog')).toBe(true);
        expect(run.relogs.map(r => r.kind)).toEqual(['planned-1']);
        e.bankOpen = true;
        e.sdk.push(e.state(e.sdk.state!.tick));
        await expect(relogGuarded(ctx, run, 'deadline', { relog: e.relog })).rejects.toThrow('relog (deadline) with the bank open');
    });
});

describe('burst hooks on scripted state', () => {
    const ctxFor = (sdk: FakeSdk) => ({ session: { sdk, bot: {}, name: 'SCORED', sessionId: 1 }, sdk, bot: {}, c: {}, log: TickLog.memory('t') }) as unknown as StepContext<any>;
    const bankState = (inventory: InventoryItem[], bank: Obj[]) => ({ ...world({ inventory }), bank: { isOpen: true, items: bank.map((b, slot) => ({ slot, id: b.id, name: '', count: b.count })), noteMode: false } }) as BotWorldState;

    test('burst 1 with the chisel held: one packet, sapphire All', () => {
        const sdk = new FakeSdk(world());
        const n = firstBurst(ctxFor(sdk), newRun(world()))(bankState([item(0, WINE.wineNote, 491), item(1, CHISEL)], [{ id: 1623, count: 62 }, { id: 1619, count: 20 }]));
        expect(n).toBe(1);
        expect(sdk.sent).toEqual([{ method: 'sendBankWithdraw', args: [0, -1] }]);
    });

    test('burst 1 with no chisel anywhere: the plain sequence', () => {
        const sdk = new FakeSdk(world());
        const run = newRun(world());
        expect(firstBurst(ctxFor(sdk), run)(bankState([item(0, WINE.wineNote, 491)], [{ id: 1623, count: 62 }]))).toBe(0);
        expect(run.windowWork).toBe('none');
        expect(sdk.sent).toEqual([]);
    });

    test('burst 1 with a short supply: the windows cut what is on hand', () => {
        const sdk = new FakeSdk(world());
        const run = newRun(world());
        firstBurst(ctxFor(sdk), run)(bankState([item(0, WINE.wineNote, 491)], [{ id: CHISEL, count: 1 }, { id: 1623, count: 10 }]));
        expect(run.gems).toBe(10);
        expect(sdk.sent).toEqual([{ method: 'sendBankWithdraw', args: [0, 1] }, { method: 'sendBankWithdraw', args: [1, -1] }]);
    });

    test('the rest burst: deposit All of each cut gem held', () => {
        const sdk = new FakeSdk(world());
        const n = restBurst(ctxFor(sdk), newRun(world()))(bankState([item(0, WINE.wineNote, 491), item(1, CHISEL), item(2, 1607), item(3, 1607), item(4, 1601), item(5, 1623)], []));
        expect(n).toBe(2);
        expect(sdk.sent).toEqual([{ method: 'sendBankDeposit', args: [4, -1] }, { method: 'sendBankDeposit', args: [2, -1] }]);
    });
});

// ---------------------------------------------------------------- resume

async function resumeAt(e: Engine, tickBase: number, opts: Parameters<typeof steps>[0] = {}) {
    engine = e;
    e.start();
    const session = sessionOf(e, tickBase);
    const probe = await wineBankProbe(session);
    const observed: Observed = { state: e.sdk.state!, probed: { wineBank: probe } };
    const step = cookingStep({ relog: e.relog, ...opts });
    const log = TickLog.memory('t');
    const ctx = { session, sdk: e.sdk, bot: {}, c: {}, log, observed } as unknown as StepContext<any>;
    const inProgress = step.inProgress!(observed, {});
    const done = step.done!(observed, {});
    return { step, ctx, probe, inProgress, done, log, notes: () => log.rows.filter(r => r.kind === 'note').map(r => r.meta as Record<string, unknown>) };
}

const notes = (n: number): Obj => ({ id: WINE.wineNote, count: n });
const sapphires = (n: number, id: number = SAPPHIRE.uncut): Obj[] => Array.from({ length: n }, () => ({ id, count: 1 }));
const GEM_BANK = (s = 36): Obj[] => [{ id: 1617, count: 2 }, { id: 1619, count: 20 }, { id: 1621, count: 23 }, { id: SAPPHIRE.uncut, count: s }];

describe('resume after a mid-step logout (the reconnect login arms the timer: no extra planned relog)', () => {
    test('the wineBank probe reads the wine and the gems in about 3 ticks', async () => {
        const e = new Engine({ tick: 500, inventory: [notes(491)], bank: [{ id: WINE.wine, count: 29 }, ...GEM_BANK(), { id: SAPPHIRE.cut, count: 26 }], due: 520 });
        const { probe } = await resumeAt(e, 498);
        expect(probe).toEqual({ wine: { unfermented: 29, fermented: 0 }, uncutGems: 81, cutGems: 26 } satisfies WineBankProbe);
        expect(e.sdk.state!.tick - 500).toBeLessThanOrEqual(4);
    });

    test('notes held, nothing banked: deposit-first in this login, then the arming relog only', async () => {
        const e = new Engine({ tick: 500, inventory: [notes(520)], bank: [{ id: CHISEL, count: 1 }, ...GEM_BASE()], due: 520 });
        const r = await resumeAt(e, 498);
        expect(r.inProgress).toBe(true);
        await r.step.resume!(r.ctx);
        expect(relogKinds(r.notes())).toEqual(['planned-2']);
        expect(e.firings[0]).toEqual({ tick: 520, wines: 29 });
        expect(e.starts()[0]).toMatchObject({ held: true, maxActions: 26 });
        expect(levelForXp(e.cooking)).toBe(99);
        expect(e.crafting).toBe(xpForLevel(99));
    });

    test('the 29 banked, gems held (a crash in W1): await-first, W1 on what is held, then P1 and the arming relog', async () => {
        const e = new Engine({ tick: 500, crafting: CRAFTING_HANDOFF_XP + 10 * 50 * 25, inventory: [notes(491), { id: CHISEL, count: 1 }, ...sapphires(10, SAPPHIRE.cut), ...sapphires(16)], bank: [{ id: WINE.wine, count: 29 }, ...GEM_BANK()], due: 520 });
        const r = await resumeAt(e, 498);
        await r.step.resume!(r.ctx);
        // nothing deposited before the firing
        expect(e.firings[0]).toEqual({ tick: 520, wines: 29 });
        expect(e.starts()[0]).toMatchObject({ held: true, maxActions: 16 });
        expect(e.starts()[1]).toMatchObject({ stow: true, maxActions: 81 });
        expect(relogKinds(r.notes())).toEqual(['planned-2']);
        expect(e.crafting).toBe(xpForLevel(99));
    });

    test('the first firing done, the rest held (a logout between relog 1 and relog 2): the rest rides this login, NO relog 2', async () => {
        const e = new Engine({ tick: 500, cooking: AFTER_FIRST, crafting: CRAFTING_HANDOFF_XP + 26 * 50 * 25, inventory: [notes(491), { id: CHISEL, count: 1 }, ...sapphires(26, SAPPHIRE.cut)], bank: [{ id: WINE.jugWine, count: 29 }, ...GEM_BANK()], due: 520 });
        const r = await resumeAt(e, 498);
        expect(r.inProgress).toBe(true);
        await r.step.resume!(r.ctx);
        expect(e.relogs).toBe(0);
        expect(relogKinds(r.notes())).toEqual([]);
        expect(e.firings).toEqual([{ tick: 520, wines: 491 }]);
        expect(e.starts()).toHaveLength(1);
        expect(e.starts()[0]).toMatchObject({ stow: true, maxActions: 81 });
        expect(levelForXp(e.cooking)).toBe(99);
        expect(e.crafting).toBe(xpForLevel(99));
    });

    test('the same with the bank opening on login + 20: one deadline relog', async () => {
        const e = new Engine({ tick: 519, cooking: AFTER_FIRST, inventory: [notes(491)], bank: [{ id: WINE.jugWine, count: 29 }], due: 520 });
        const r = await resumeAt(e, 498, { windowWork: 'none' });
        await r.step.resume!(r.ctx);
        expect(relogKinds(r.notes())).toEqual(['deadline']);
        expect(e.firings.map(f => f.wines)).toEqual([0, 491]);
        expect(levelForXp(e.cooking)).toBe(99);
    });

    test('the rest banked (a logout after relog 2): await-second, W2 only', async () => {
        const e = new Engine({ tick: 500, cooking: AFTER_FIRST, crafting: CRAFTING_HANDOFF_XP + 26 * 50 * 25, inventory: [{ id: CHISEL, count: 1 }], bank: [{ id: WINE.wine, count: 491 }, { id: WINE.jugWine, count: 29 }, ...GEM_BANK(), { id: SAPPHIRE.cut, count: 26 }], due: 520 });
        const r = await resumeAt(e, 498);
        await r.step.resume!(r.ctx);
        expect(e.relogs).toBe(0);
        expect(e.firings).toEqual([{ tick: 520, wines: 491 }]);
        // 26 already cut (in the bank): 81 left
        expect(e.starts()[0]).toMatchObject({ stow: true, maxActions: 81 });
        expect(e.crafting).toBe(xpForLevel(99));
    });

    test('Cooking 99 with gems still banked (a logout in P2): only the gem cycle', async () => {
        const e = new Engine({ tick: 500, cooking: xpForLevel(99), crafting: CRAFTING_HANDOFF_XP + 26 * 50 * 25, bank: [{ id: CHISEL, count: 1 }, { id: WINE.jugWine, count: 520 }, ...GEM_BANK(), { id: SAPPHIRE.cut, count: 26 }] });
        const r = await resumeAt(e, 498);
        expect(r.done).toBe(false);
        expect(r.inProgress).toBe(true);
        await r.step.resume!(r.ctx);
        expect(e.starts()).toHaveLength(1);
        expect(e.starts()[0]).toMatchObject({ maxActions: 81 });
        expect(e.relogs).toBe(0);
    });

    test('done: Cooking 99, nothing held, and Crafting 99 or no uncut gem banked', async () => {
        const e = new Engine({ tick: 500, cooking: xpForLevel(99), crafting: xpForLevel(99), bank: [{ id: WINE.jugWine, count: 520 }] });
        const r = await resumeAt(e, 498);
        expect(r.done).toBe(true);
        expect(r.inProgress).toBe(false);
    });

    test('nothing delivered and nothing banked: not in progress (run from relog 1)', async () => {
        const e = new Engine({ tick: 500, bank: [{ id: CHISEL, count: 1 }, ...GEM_BASE()] });
        const r = await resumeAt(e, 498);
        expect(r.inProgress).toBe(false);
        expect(r.done).toBe(false);
    });

    test('the wine exhausted below 99, or no booth to probe: the resume refuses with the reason', async () => {
        const e = new Engine({ tick: 500, cooking: xpForLevel(80), bank: [{ id: WINE.jugWine, count: 520 }] });
        const r = await resumeAt(e, 498);
        expect(r.inProgress).toBe(true);
        await expect(r.step.resume!(r.ctx)).rejects.toThrow('wine exhausted at Cooking 80');
        const ctx = { ...r.ctx, observed: { state: e.sdk.state!, probed: { wineBank: null } } } as StepContext<any>;
        e.inv[0] = { id: WINE.wineNote, count: 491 };
        await expect(r.step.resume!(ctx)).rejects.toThrow('S25c resume needs the wineBank probe');
    });
});

function GEM_BASE(): Obj[] {
    return GEM_BANK(62);
}

describe('step fields', () => {
    test('walkIn (the demo harness): a walk-in step to the stand first; string options from --skill-opt read as booleans', () => {
        expect(steps({ walkIn: true }).map(s => s.name)).toEqual(['S25c walk-in', STEP_NAME]);
        expect(steps({ walkIn: 'true' as never }).map(s => s.name)).toEqual(['S25c walk-in', STEP_NAME]);
        expect(steps({ walkIn: 'false' as never }).map(s => s.name)).toEqual([STEP_NAME]);
        const [walk] = steps({ walkIn: true });
        expect(walk!.postconditions(world({ at: { x: 3222, z: 3222 } }), {})).toBe('not at the stand (3185,3436)');
        expect(walk!.postconditions(world(), {})).toBe(true);
        // lab 'false' is not lab: the S25 checks stay on
        expect(steps({ lab: 'false' as never })[0]!.preconditions(world({ skills: { smithing: xpForLevel(50) } }), {})).toBe('S25a not done: Smithing 50');
        expect(steps({ lab: 'true' as never })[0]!.preconditions(world({ skills: { smithing: xpForLevel(50) } }), {})).toBe(true);
    });

    test('one logout-safe step that probes the bank', () => {
        const [s] = steps();
        expect(steps()).toHaveLength(1);
        expect(s).toMatchObject({ name: STEP_NAME, logoutSafe: true, probes: ['wineBank'] });
    });
    test('postconditions: Cooking 99 with nothing of the step held and no page or bank open', () => {
        const [s] = steps();
        const at99 = world({ skills: { cooking: xpForLevel(99) } });
        expect(s!.postconditions(at99, {})).toBe(true);
        expect(s!.postconditions(world(), {})).toBe('Cooking 30 < 99');
        expect(s!.postconditions({ ...at99, inventory: [item(0, 1623, 1, 'Uncut sapphire')] }, {})).toBe('still held: Uncut sapphire');
        // the chisel is not the step's to clear: the plain sequence never touches it
        expect(s!.postconditions({ ...at99, inventory: [item(0, CHISEL, 1, 'Chisel')] }, {})).toBe(true);
        expect(s!.postconditions({ ...at99, dialog: { isOpen: true, options: [], isWaiting: true } } as BotWorldState, {})).toBe('a bank window or chat page is open');
    });
});

void flush;
