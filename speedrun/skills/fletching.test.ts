import { describe, expect, test } from 'bun:test';
import type { ActionResult, BotWorldState, InventoryItem } from '../../sdk/types';
import { ARROW_TIERS, HEADLESS_ARROW, type ArrowTier } from '../lib/arrows';
import { baseState, FakeSdk, flush, type SentAction } from '../lib/fake-sdk';
import type { ProgramStatus } from '../lib/programs';
import { TickLog } from '../lib/ticks';
import { levelForXp, XP_RATE, xpForLevel } from '../lib/xp';
import { Observation, resolveResume } from '../runner/resume';
import { runSteps, type RunnerSession } from '../runner/step';
import { finished, RESERVE_MARGIN, planFletch, preconditions, recipeFor, RUNE_KEEP, skill, STEP_ID, STEP_NAME, steps, stockOf, type FletchingOptions } from './fletching';

const T = Object.fromEntries(ARROW_TIERS.map(t => [t.tier, t])) as Record<ArrowTier, (typeof ARROW_TIERS)[number]>;

// ---------------------------------------------------------------- state fixtures

type Stack = [id: number, count: number];

const item = (slot: number, id: number, count: number): InventoryItem => ({ slot, id, name: `obj ${id}`, count, optionsWithIndex: [] });

/** Fletching at `level` (or `xp`), the stacks in slots 0.., `others` unrelated items after them. */
function world(o: { level?: number; xp?: number; stacks?: Stack[]; worn?: Stack[]; others?: number } = {}): BotWorldState {
    const xp = o.xp ?? (o.level === undefined || o.level === 1 ? 0 : xpForLevel(o.level));
    const level = levelForXp(xp);
    const stacks = o.stacks ?? today();
    const others = Array.from({ length: o.others ?? 0 }, (_, i) => item(stacks.length + i, 1351, 1));
    return baseState({
        player: { name: 'lab_f1', worldX: 3200, worldZ: 3200, x: 3200, z: 3200, level: 0 } as BotWorldState['player'],
        skills: [{ name: 'Fletching', level, baseLevel: level, experience: xp }],
        inventory: [...stacks.map(([id, n], slot) => item(slot, id, n)), ...others],
        equipment: (o.worn ?? []).map(([id, n], slot) => item(slot, id, n))
    });
}

/** Load 0 plus both courier tiers as SCORED would hold them after S18 with no stun fletched: today's 304-action stock. */
function today(o: { headless?: number; adamant?: number; rune?: number } = {}): Stack[] {
    return [
        [HEADLESS_ARROW, o.headless ?? 4560],
        [T.bronze.tips, 60],
        [T.iron.tips, 90],
        [T.steel.tips, 135],
        [T.mithril.tips, 1485],
        [T.adamant.tips, o.adamant ?? 2220],
        [T.rune.tips, o.rune ?? 570]
    ];
}

// ---------------------------------------------------------------- the page: item-cycle stack mode, tick by tick

interface StackParams {
    recipes: Array<{ name: string; level: number; xp: number; a: number; b: number; products: number[]; per?: number }>;
    untilLevel?: number;
    maxActions?: number;
    perTick?: number;
}

/**
 * The page's item-cycle program in stack mode (item-cycle.ts `stack()`) and the server's
 * make_arrows (arrows.rs2): each tick the program reads the published state (`lag` 2: one tick
 * staler than the engine gives), stops at untilLevel / maxActions / out of supplies, and sends
 * ceil(min(stacks) / 15) uses of the best tier the seen level allows, at most 5. The server applies
 * each with the true stacks and level: a level too low wastes it; a new arrow stack with no free
 * slot (and no input stack emptied first) goes to the floor (InvOps INV_ADD), counted in `dropped`.
 */
class StackPage extends FakeSdk {
    readonly starts: StackParams[] = [];
    dropped = 0;
    sentActions = 0;
    private runId = 0;
    private run: { params: StackParams; sent: number; landed: number; start: number; byRecipe: Record<string, number>; sends: Record<number, number>; ended?: string; status: ProgramStatus } | null = null;
    private history: BotWorldState[] = [];

    constructor(state: BotWorldState, readonly lag = 1) {
        super(state);
    }

    override sendAction(a: SentAction | Record<string, unknown>): Promise<ActionResult> {
        const act = a as { type?: unknown; op?: unknown; name?: unknown; params?: StackParams };
        if (act.type !== 'program') return super.sendAction(a as SentAction);
        if (act.op !== 'start') return Promise.resolve({ success: true, message: 'ok', data: this.run?.status ?? null });
        expect(act.name).toBe('item-cycle');
        const params = act.params!;
        this.starts.push(params);
        const tick = this.state!.tick;
        this.run = { params, sent: 0, landed: 0, start: tick, byRecipe: {}, sends: {}, status: status({ runId: ++this.runId, startedTick: tick, tick }) };
        return Promise.resolve({ success: true, message: 'ok', data: this.run.status });
    }

    /** One game tick: the program reads and sends, the server applies, the state is published. */
    step(): void {
        const s = this.state!;
        this.history.push(s);
        const seen = this.history[Math.max(0, this.history.length - this.lag)]!;
        const r = this.run;
        let inv = s.inventory.map(i => ({ ...i }));
        let xp = s.skills[0]!.experience;
        if (r && !r.ended) {
            const level = seen.skills[0]!.baseLevel;
            const has = (id: number) => seen.inventory.find(i => i.id === id && i.count > 0);
            const byXp = [...r.params.recipes].sort((x, y) => y.xp - x.xp);
            const recipe = byXp.find(x => x.level <= level && has(x.a) && has(x.b));
            const remaining = (r.params.maxActions ?? Infinity) - r.sent;
            if (r.params.untilLevel && level >= r.params.untilLevel) r.ended = 'target';
            else if (!recipe) r.ended = 'out of supplies';
            else if (remaining <= 0) r.ended = 'maxActions';
            else {
                const per = recipe.per ?? 15;
                const pending = Math.ceil(Math.min(has(recipe.a)!.count, has(recipe.b)!.count) / per);
                const k = Math.min(pending, remaining, r.params.perTick ?? 5);
                r.sends[k] = (r.sends[k] ?? 0) + 1;
                for (let i = 0; i < k; i++) {
                    r.sent++;
                    this.sentActions++;
                    const out = this.makeArrows(inv, xp, recipe);
                    inv = out.inv;
                    if (out.xp > xp) {
                        r.landed++;
                        r.byRecipe[recipe.name] = (r.byRecipe[recipe.name] ?? 0) + 1;
                    }
                    xp = out.xp;
                }
            }
            const t = s.tick + 1;
            r.status = r.ended
                ? status({ runId: r.status.runId, phase: 'done', startedTick: r.start, tick: t, endedTick: t, result: { ended: r.ended, actions: r.landed, sent: r.sent, visits: 0, resets: 0, drift: 0, levelups: 0, byRecipe: r.byRecipe, ticks: t - r.start, cycleGaps: [], sendsPerTick: r.sends, xpDropsPerTick: {} } })
                : status({ runId: r.status.runId, startedTick: r.start, tick: t });
        }
        const level = levelForXp(xp);
        this.tick({ inventory: inv, skills: [{ name: 'Fletching', level, baseLevel: level, experience: xp }], ...(r ? { program: r.status } : {}) } as Partial<BotWorldState>);
    }

    private makeArrows(inv: InventoryItem[], xp: number, r: StackParams['recipes'][number]): { inv: InventoryItem[]; xp: number } {
        if (levelForXp(xp) < r.level) return { inv, xp };
        const tips = inv.find(i => i.id === r.b && i.count > 0);
        const headless = inv.find(i => i.id === r.a && i.count > 0);
        if (!tips || !headless) return { inv, xp };
        const k = Math.min(15, tips.count, headless.count);
        tips.count -= k;
        headless.count -= k;
        inv = inv.filter(i => i.count > 0);
        const product = r.products[0]!;
        const stack = inv.find(i => i.id === product);
        if (stack) stack.count += k;
        else {
            const used = new Set(inv.map(i => i.slot));
            let slot = 0;
            while (slot < 28 && used.has(slot)) slot++;
            if (slot >= 28) this.dropped += k;
            else inv.push(item(slot, product, k));
        }
        return { inv, xp: xp + Math.round(k * (r.xp / 15) * XP_RATE) };
    }
}

function status(p: Partial<ProgramStatus>): ProgramStatus {
    const frames = { n: 0, p50: 0, p90: 0, max: 0, under150: 0, over350: 0, catchUps: 0, catchUpsLastMinute: 0, catchUpsPerMinute: 0 };
    return { runId: 1, name: 'item-cycle', phase: 'running', params: {}, startedTick: 100, tick: 100, progressTick: 100, counters: {}, gauges: {}, marks: {}, packets: 0, deferred: 0, skippedTicks: 0, maxTickMs: 0, frames, publish: frames, react: { n: 0, p50: 0, p90: 0, max: 0 }, loops: { last: 0, p10Last10s: 0, min: 0 }, ...p };
}

/** runSteps over steps(opts) against the page, ticking until it settles. */
async function drive(page: StackPage, opts: FletchingOptions = {}, maxTicks = 400) {
    const session = { sdk: page, bot: {}, name: 'lab_f1', sessionId: 1 } as unknown as RunnerSession;
    const log = TickLog.memory('t');
    let outcome: { ok: true; value: unknown } | { ok: false; error: unknown } | null = null;
    const run = runSteps(session, steps(opts), { log, c: {}, shouldStop: () => false, logout: async () => {}, tickMonitor: false });
    run.then(value => (outcome = { ok: true, value }), error => (outcome = { ok: false, error }));
    for (let i = 0; i < maxTicks && !outcome; i++) {
        await flush();
        page.step();
    }
    await flush();
    if (!outcome) throw new Error(`step still running after ${maxTicks} ticks`);
    return { outcome: outcome as { ok: true; value: unknown } | { ok: false; error: unknown }, log, state: page.getState()! };
}

const held = (s: BotWorldState, id: number) => s.inventory.filter(i => i.id === id).reduce((n, i) => n + i.count, 0) + s.equipment.filter(i => i.id === id).reduce((n, i) => n + i.count, 0);

// ---------------------------------------------------------------- module shape

describe('module', () => {
    test('convention: skill, one logout-safe step S18d-fallback, the program recipes from lib/arrows.ts', () => {
        expect(skill).toBe('fletching');
        expect(STEP_NAME).toBe('S18d-fallback fletching');
        expect(STEP_NAME.startsWith(STEP_ID)).toBe(true);
        const [s, ...rest] = steps();
        expect(rest).toEqual([]);
        expect(s!.logoutSafe).toBe(true);
        expect(recipeFor(T.rune)).toEqual({ name: 'runearrow', level: 75, xp: 187.5, a: 53, b: 44, products: [892], per: 15 });
        expect(recipeFor(T.bronze).xp).toBeCloseTo(19.5);
    });
});

// ---------------------------------------------------------------- the plan

describe('planFletch: tier order', () => {
    test('best tier the level allows, first: rune over adamant at 75, adamant over mithril at 60, mithril at 74 with rune held', () => {
        const first = (level: number, stacks: Stack[]) => Object.keys(planFletch(stockOf(world({ level, stacks })), { maxActions: 1, keepRune: 0 }).runs[0]?.byTier ?? {});
        const all: Stack[] = [[HEADLESS_ARROW, 1000], [T.mithril.tips, 150], [T.adamant.tips, 150], [T.rune.tips, 150]];
        expect(first(75, all)).toEqual(['rune']);
        expect(first(74, all)).toEqual(['adamant']);
        expect(first(60, all)).toEqual(['adamant']);
        expect(first(59, all)).toEqual(['mithril']);
        expect(first(44, all)).toEqual([]);
    });

    test("today's 304-action stock from 1: one route run, 291 actions, 60 work ticks with fill, every rune tip used, 13 mithril actions left", () => {
        const plan = planFletch(stockOf(world({ level: 1 })));
        expect(plan.runs.map(r => r.kind)).toEqual(['route']);
        expect(plan.runs[0]!.byTier).toEqual({ bronze: 4, iron: 6, steel: 9, mithril: 86, adamant: 148, rune: 38 });
        // bronze 4, iron 6 and steel 9 end on short ticks (the next tier needs the level that burst gives);
        // with fill, rune running out into adamant and adamant into mithril share their ticks
        expect([plan.actions, Math.ceil(plan.actions / 5), plan.ticks, plan.level, plan.runeArrows, plan.keeps]).toEqual([291, 59, 60, 99, 570, true]);
        expect([plan.left.tips.mithril, plan.left.headless]).toEqual([195, 195]);
    });

    test("fold-in 19's 294-action stock: every tip used, 99 with 2.18 base spare (the manifest's figure)", () => {
        const plan = planFletch(stockOf(world({ level: 1, stacks: today({ headless: 4410, adamant: 2070 }) })));
        expect([plan.actions, plan.ticks, plan.level, plan.left.headless]).toEqual([294, 61, 99, 0]);
        expect((plan.xp - xpForLevel(99)) / XP_RATE).toBeCloseTo(2.18, 2);
    });
});

describe('planFletch: the 570 rune keep', () => {
    test('below 75 with headless arrows short: the run to 75 is capped so the rune tips keep theirs', () => {
        // level 70: 75 is 2,219.68 base away, 15 adamant actions (225 headless); 820 headless leaves
        // 25 over the 570 the rune tips need, inside the lag margin, so the run to 75 is capped
        const st = stockOf(world({ level: 70, stacks: [[HEADLESS_ARROW, 820], [T.adamant.tips, 600], [T.rune.tips, 570]] }));
        const plan = planFletch(st, { toLevel: 80 });
        expect(plan.runs.map(r => r.kind)).toEqual(['reserve', 'route', 'rune']);
        expect(plan.runs[0]).toMatchObject({ tiers: ['adamant', 'mithril', 'steel', 'iron', 'bronze'], untilLevel: 75, maxActions: Math.floor((820 - 570) / 15), actions: 15, levelTo: 75 });
        // 75 to 80 on rune alone leaves rune tips at 80: the rune run makes the rest (and carries on to 84)
        expect(plan.runs[1]).toMatchObject({ untilLevel: 80, byTier: { rune: plan.runs[1]!.actions } });
        expect([plan.runeArrows, plan.keeps, plan.level]).toEqual([570, true, 84]);
    });

    test('when the lower tiers cannot reach 75 without the rune headless arrows, the plan names the block', () => {
        const plan = planFletch(stockOf(world({ level: 1, stacks: today({ headless: 1500 }) })));
        expect(plan.reserveBlock).toBe('reaching Fletching 75 needs the headless arrows the rune tips need: 1500 headless arrows, 570 kept for rune, take the lower tiers only to Fletching 73');
        expect(plan.runeArrows).toBe(0);
    });

    test("headless arrows to spare beyond the lag margin: no reserve run (today's stock has ~2,985 at 75)", () => {
        expect(RESERVE_MARGIN).toBe(750);
        const at = (h: number) => planFletch(stockOf(world({ level: 70, stacks: [[HEADLESS_ARROW, h], [T.adamant.tips, 600], [T.rune.tips, 570]] })), { toLevel: 80 }).runs.map(r => r.kind);
        // 225 to reach 75, 570 for the rune tips, 750 margin
        expect(at(225 + 570 + 750)).toEqual(['route', 'rune']);
        expect(at(225 + 570 + 749)).toEqual(['reserve', 'route', 'rune']);
    });

    test('99 reached with rune tips still held (a late courier): a rune-only run to the keep', () => {
        const st = stockOf(world({ level: 99, stacks: [[HEADLESS_ARROW, 400], [T.adamant.tips, 300], [T.rune.tips, 300], [T.rune.arrow, 270]] }));
        const plan = planFletch(st);
        expect(plan.runs).toHaveLength(1);
        expect(plan.runs[0]).toMatchObject({ kind: 'rune', tiers: ['rune'], maxActions: 20, actions: 20, byTier: { rune: 20 } });
        expect([plan.runeArrows, plan.keeps, plan.left.tips.adamant]).toEqual([570, true, 300]);
    });

    test('the quiver counts: 570 rune arrows worn already keep it', () => {
        const plan = planFletch(stockOf(world({ level: 97, stacks: [[HEADLESS_ARROW, 1500], [T.adamant.tips, 1500]], worn: [[T.rune.arrow, 570]] })));
        expect([plan.keeps, plan.runeArrows, plan.reaches]).toEqual([true, 570, true]);
    });
});

describe('planFletch: free slots', () => {
    test('a new arrow stack needs a free slot unless its action empties an input stack first', () => {
        const full = (stacks: Stack[]) => planFletch(stockOf(world({ level: 1, stacks, others: 28 - stacks.length })), { keepRune: 0, maxActions: 10 });
        expect(full([[HEADLESS_ARROW, 60], [T.bronze.tips, 60]]).slotFault).toBe('no free slot for bronze arrows at Fletching 1: make_arrows does not check space and the engine drops what does not fit (InvOps INV_ADD), so free a slot first');
        expect(full([[HEADLESS_ARROW, 60], [T.bronze.tips, 60], [T.bronze.arrow, 15]]).slotFault).toBeUndefined();
        // 15 tips: the one action empties their slot, and the arrows take it
        expect(full([[HEADLESS_ARROW, 60], [T.bronze.tips, 15]]).slotFault).toBeUndefined();
    });

    test("today's route from 1 needs 3 free slots: mithril, adamant and rune arrows each open while the tier below still holds tips", () => {
        const stacks = today();
        const fault = (free: number) => planFletch(stockOf(world({ level: 1, stacks, others: 28 - stacks.length - free }))).slotFault ?? 'fits';
        expect(fault(0)).toMatch(/^no free slot for bronze arrows at Fletching 1/);
        expect(fault(1)).toMatch(/^no free slot for adamant arrows at Fletching 60/);
        expect(fault(2)).toMatch(/^no free slot for rune arrows at Fletching 75/);
        expect(fault(3)).toBe('fits');
    });
});

// ---------------------------------------------------------------- refusals

describe('preconditions', () => {
    test("today's start passes; already finished passes (S18's stuns got there)", () => {
        expect(preconditions(world({ level: 1 }))).toBe(true);
        expect(preconditions(world({ level: 99, stacks: [[T.rune.arrow, 570]] }))).toBe(true);
        expect(preconditions(world({ level: 99, stacks: [], worn: [[T.rune.arrow, 570]] }))).toBe(true);
    });

    test('no headless arrows; no tips the level can use; members; an unknown tier', () => {
        expect(preconditions(world({ level: 50, stacks: [[T.mithril.tips, 150]] }))).toBe('no headless arrows held');
        expect(preconditions(world({ level: 10, stacks: [[HEADLESS_ARROW, 150], [T.rune.tips, 150]] }))).toBe('no arrowtips Fletching 10 can use held (bronze)');
        expect(preconditions(world({ level: 1 }), { members: false })).toBe('not a members world: arrows are members-only (arrows.rs2)');
        expect(preconditions(world({ level: 1 }), { tiers: ['dragon' as ArrowTier] })).toContain("unknown arrow tier 'dragon'");
    });

    test('the free-slot rule refuses with the tier and level', () => {
        const stacks = today();
        expect(preconditions(world({ level: 1, stacks, others: 28 - stacks.length }))).toMatch(/^no free slot for bronze arrows at Fletching 1/);
    });

    test('supplies short of 99, and the rune keep, refuse with how far they reach', () => {
        expect(preconditions(world({ level: 1, stacks: today({ adamant: 1000 }) }))).toBe('supplies short: 10698 base xp (they reach Fletching 94; 223 actions: rune 38, adamant 67, mithril 99, steel 9, iron 6, bronze 4)');
        expect(preconditions(world({ level: 1, stacks: today({ headless: 1500 }) }))).toBe('rune keep: reaching Fletching 75 needs the headless arrows the rune tips need: 1500 headless arrows, 570 kept for rune, take the lower tiers only to Fletching 73');
        expect(preconditions(world({ level: 1, stacks: today({ rune: 300, adamant: 3000 }) }))).toBe('rune keep: the stock ends with 300 rune arrows (pack and quiver), below 570 (rune tips 300, rune arrows 0, headless after the route 270)');
        expect(preconditions(world({ level: 1, stacks: today({ rune: 300, adamant: 3000 }) }), { keepRune: 300 })).toBe(true);
    });

    test('not in game', () => {
        expect(preconditions(baseState({ inGame: false }))).toBe('not in game');
    });
});

// ---------------------------------------------------------------- done and resume

describe('done, inProgress and resume', () => {
    const [step] = steps();
    const obs = (o: Parameters<typeof world>[0]) => new Observation(world(o));

    test('done: Fletching 99 and the keep held, or no rune tips left to fletch', () => {
        expect(step!.done!(obs({ level: 99, stacks: [[T.rune.arrow, 570]] }), {})).toBe(true);
        expect(step!.done!(obs({ level: 98, stacks: [[T.rune.arrow, 570]] }), {})).toBe(false);
        // 99 with rune tips unfletched: a resume must not pass the step
        expect(step!.done!(obs({ level: 99, stacks: [[HEADLESS_ARROW, 300], [T.rune.tips, 300], [T.rune.arrow, 270]] }), {})).toBe(false);
        // after S27 has fired most of them: still done (no tips left), so the walk never goes back
        expect(step!.done!(obs({ level: 99, stacks: [[T.rune.arrow, 30]] }), {})).toBe(true);
        expect(finished(world({ level: 99, stacks: [[T.rune.tips, 300]] }))).toBe(true); // tips with no headless: nothing to make
    });

    test('resume: a fresh account runs it, a mid-route logout resumes it, 99 with the keep is finished', async () => {
        const walk = async (o: Parameters<typeof world>[0]) => {
            const p = await resolveResume(steps(), new Observation(world(o)), {});
            return [p.step, p.mode];
        };
        expect(await walk({ level: 1 })).toEqual([STEP_NAME, 'run']);
        expect(await walk({ level: 63 })).toEqual([STEP_NAME, 'resume']);
        expect(await walk({ level: 99, stacks: [[HEADLESS_ARROW, 300], [T.rune.tips, 300], [T.rune.arrow, 270]] })).toEqual([STEP_NAME, 'resume']);
        expect((await resolveResume(steps(), new Observation(world({ level: 99, stacks: [[T.rune.arrow, 570]] })), {})).mode).toBe('finished');
    });
});

// ---------------------------------------------------------------- the step against the page

describe('the step on the page (item-cycle stack mode)', () => {
    test("today's stock from 1: one stack-mode run to 99 at 5 a tick, 570 rune arrows, nothing dropped", async () => {
        const page = new StackPage(world({ level: 1 }));
        const { outcome, log, state } = await drive(page);
        expect(outcome).toEqual({ ok: true, value: { completed: 1 } });
        expect(page.starts).toHaveLength(1);
        expect(page.starts[0]).toMatchObject({ mode: 'stack', skill: 'fletching', untilLevel: 99 });
        expect(page.starts[0]!.recipes.map(r => r.name)).toEqual(ARROW_TIERS.map(t => `${t.tier}arrow`));
        expect(state.skills[0]!.baseLevel).toBe(99);
        expect(held(state, T.rune.arrow)).toBe(570);
        expect(page.dropped).toBe(0);
        const program = log.rows.find(r => r.kind === 'program')!;
        expect(program).toMatchObject({ step: STEP_NAME, ok: true });
        // the plan's 291 actions plus at most one tick of the old tier at each band edge
        expect(page.sentActions).toBeGreaterThanOrEqual(291);
        expect(page.sentActions).toBeLessThanOrEqual(291 + 5);
    });

    test('99 with rune tips held: no route run, one rune-only run with maxActions, then done', async () => {
        const page = new StackPage(world({ level: 99, stacks: [[HEADLESS_ARROW, 400], [T.adamant.tips, 300], [T.rune.tips, 300], [T.rune.arrow, 270]] }));
        const { outcome, state } = await drive(page);
        expect(outcome).toEqual({ ok: true, value: { completed: 1 } });
        expect(page.starts.map(p => [p.recipes.map(r => r.name), p.untilLevel, p.maxActions])).toEqual([[['runearrow'], undefined, 20]]);
        expect(held(state, T.rune.arrow)).toBe(570);
        expect(held(state, T.adamant.tips)).toBe(300);
    });

    test('97 with the rune tips late: the route takes rune first to 99, then a rune-only run makes the rest', async () => {
        // 97 to 99 is 5,171.52 base; the 570 rune tips are 7,125
        const page = new StackPage(world({ level: 97, stacks: [[HEADLESS_ARROW, 1200], [T.adamant.tips, 630], [T.rune.tips, 570]] }));
        const { outcome, state } = await drive(page);
        expect(outcome).toEqual({ ok: true, value: { completed: 1 } });
        // the plan's rune run is 10; the burst that crosses 99 lands 2 more rune actions first
        expect(page.starts.map(p => [p.untilLevel, p.maxActions, p.recipes.length])).toEqual([[99, undefined, 6], [undefined, 8, 1]]);
        expect(state.skills[0]!.baseLevel).toBe(99);
        expect(held(state, T.rune.arrow)).toBe(570);
    });

    test('the demo shape: bronze only, maxActions 100, no keep: one run, ends on the cap', async () => {
        const page = new StackPage(world({ level: 1, stacks: [[HEADLESS_ARROW, 1500], [T.bronze.tips, 1500]] }));
        const { outcome, state } = await drive(page, { tiers: ['bronze'], maxActions: 100, keepRune: 0 });
        expect(outcome).toEqual({ ok: true, value: { completed: 1 } });
        expect(page.starts[0]).toMatchObject({ maxActions: 100, untilLevel: 99, recipes: [{ name: 'bronzearrow' }] });
        expect(held(state, T.bronze.arrow)).toBe(1500);
    });

    test('a refused start sends nothing', async () => {
        const page = new StackPage(world({ level: 1, stacks: today({ headless: 1500 }) }));
        const { outcome } = await drive(page);
        expect(outcome.ok).toBe(false);
        expect(String((outcome as { error: unknown }).error)).toContain('rune keep: reaching Fletching 75');
        expect(page.starts).toEqual([]);
    });
});

// ---------------------------------------------------------------- the hard rule

describe('the rune keep is a hard rule', () => {
    /**
     * Stocks around the reserve's edge (headless arrows short of the lower tiers plus the rune tips'
     * 570), with targets the stock reaches, so the keep alone decides: the step either refuses, or
     * ends at the target with 570 rune arrows and nothing dropped.
     */
    type Case = [name: string, w: Parameters<typeof world>[0], to: number];
    const cases: Case[] = [
        ['today from 1', { level: 1 }, 99],
        ...[1500, 1560, 1600, 1650, 1700, 2000].map(h => [`from 1, ${h} headless, to 80`, { level: 1, stacks: today({ headless: h }) }, 80] as Case),
        ...[700, 790, 800, 820, 860, 900, 1200].map(h => [`from 70, ${h} headless, to 80`, { level: 70, stacks: [[HEADLESS_ARROW, h], [T.mithril.tips, 300], [T.adamant.tips, 1500], [T.rune.tips, 570]] }, 80] as Case),
        ['from 97, rune late', { level: 97, stacks: [[HEADLESS_ARROW, 1500], [T.adamant.tips, 930], [T.rune.tips, 570]] }, 99],
        ['99, 300 rune tips left', { level: 99, stacks: [[HEADLESS_ARROW, 300], [T.rune.tips, 300], [T.rune.arrow, 270]] }, 99]
    ];

    /** Rune arrows held plus those the rune tips can still make: what the keep can still reach. */
    const runeReach = (s: BotWorldState) => held(s, T.rune.arrow) + (s.skills[0]!.baseLevel >= 75 ? Math.min(held(s, T.rune.tips), held(s, HEADLESS_ARROW)) : held(s, T.rune.tips) > 0 ? -1 : 0);

    for (const lag of [1, 2]) {
        test(`refuse, or end at the target with 570 rune arrows; a staler page never spends the rune share (page lag ${lag})`, async () => {
            const verdicts: string[] = [];
            for (const [name, o, to] of cases) {
                const s = world(o);
                const pre = preconditions(s, { toLevel: to });
                const page = new StackPage(s, lag);
                const { outcome, state } = await drive(page, { toLevel: to });
                if (pre !== true) {
                    expect({ name, ok: outcome.ok, starts: page.starts.length }).toEqual({ name, ok: false, starts: 0 });
                    verdicts.push(`${name}: refused`);
                    continue;
                }
                if (lag === 1) {
                    // the page as the engine runs it (fletching.md section 4): the step reaches the target with the keep
                    expect({ name, ok: outcome.ok, level: state.skills[0]!.baseLevel >= to, rune: held(state, T.rune.arrow) >= RUNE_KEEP, dropped: page.dropped }).toEqual({ name, ok: true, level: true, rune: true, dropped: 0 });
                } else {
                    // a tick staler: the step may fall short of its target, but never by spending the rune share
                    expect({ name, runeReach: runeReach(state) >= RUNE_KEEP, dropped: page.dropped }).toEqual({ name, runeReach: true, dropped: 0 });
                }
                verdicts.push(`${name}: ${outcome.ok ? 'kept' : 'short'}`);
            }
            // both outcomes are exercised: the edge sits inside the grid
            expect(verdicts.some(v => v.endsWith('refused'))).toBe(true);
            expect(verdicts.filter(v => v.endsWith('kept')).length).toBeGreaterThan(lag === 1 ? 8 : 4);
        });
    }
});
