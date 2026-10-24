import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { ActionResult, BotWorldState, InventoryItem, NearbyLoc } from '../../sdk/types';
import { baseState, FakeSdk, flush, type SentAction } from '../lib/fake-sdk';
import type { ProgramStatus } from '../lib/programs';
import { TickLog } from '../lib/ticks';
import { planRoute } from '../lib/item-cycle';
import { xpForLevel } from '../lib/xp';
import { Observation, resolveResume } from '../runner/resume';
import { runSteps, type RunnerSession } from '../runner/step';
import { EXCLUDED_STRUCTS, handOff, HERB_NOTES, HERB_RECIPES, POST_RITUAL_XP, preconditions, recipesFor, skill, STEP_NAME, steps, VARROCK_WEST } from './herblore';

const ROOT = join(import.meta.dir, '../..');

// ---------------------------------------------------------------- the content tables

function objPack(): Map<string, number> {
    const m = new Map<string, number>();
    for (const line of readFileSync(join(ROOT, 'server/content/pack/obj.pack'), 'utf8').split('\n')) {
        const r = line.match(/^(\d+)=(\S+)/);
        if (r) m.set(r[2]!, Number(r[1]));
    }
    return m;
}

function structRows(): Map<string, Record<string, string>> {
    const rows = new Map<string, Record<string, string>>();
    let cur: Record<string, string> | null = null;
    for (const line of readFileSync(join(ROOT, 'server/content/scripts/skill_herblore/configs/brewing/brew_potion.struct'), 'utf8').split('\n')) {
        const h = line.match(/^\[(\w+)\]$/);
        if (h) rows.set(h[1]!, (cur = {}));
        const p = line.match(/^param=(\w+),(.*)$/);
        if (p && cur) cur[p[1]!] = p[2]!.trim();
    }
    return rows;
}

describe('HERB_RECIPES', () => {
    const pack = objPack();
    const rows = structRows();

    test('every row matches brew_potion.struct (level, xp in tenths) and obj.pack ids', () => {
        for (const r of HERB_RECIPES) {
            const row = rows.get(r.struct);
            expect({ name: r.name, row: !!row }).toEqual({ name: r.name, row: true });
            expect({
                name: r.name,
                level: Number(row!.brew_potion_level ?? 3),
                xp: Number(row!.brew_potion_exp) / 10,
                unf: row!.brew_potion_solvent,
                secondary: row!.brew_potion_ingredient,
                product: row!.brew_potion_mixture
            }).toEqual({ name: r.name, level: r.level, xp: r.xp, unf: r.unf, secondary: r.secondary, product: r.product });
            expect({ name: r.name, ids: [r.a, r.b, r.products[0]] }).toEqual({ name: r.name, ids: [pack.get(r.unf), pack.get(r.secondary), pack.get(r.product)] });
        }
    });

    test('every struct row that brews an unfinished potion with xp is a recipe or a named exclusion', () => {
        const brewed = [...rows].filter(([, p]) => Number(p.brew_potion_exp ?? 0) > 0 && /vial$/.test(p.brew_potion_solvent ?? '') && p.brew_potion_solvent !== 'vial_water').map(([k]) => k);
        const covered = new Set([...HERB_RECIPES.map(r => r.struct), ...Object.keys(EXCLUDED_STRUCTS)]);
        expect(brewed.filter(k => !covered.has(k))).toEqual([]);
        expect(brewed.length).toBe(HERB_RECIPES.length + Object.keys(EXCLUDED_STRUCTS).length);
    });

    test('HERB_NOTES maps each input note (cert_<name>) to its item', () => {
        for (const r of HERB_RECIPES) {
            for (const name of [r.unf, r.secondary]) expect({ name, note: HERB_NOTES.get(pack.get(`cert_${name}`)!) }).toEqual({ name, note: pack.get(name) });
        }
    });

    test('module convention and hand-off data', () => {
        expect(skill).toBe('herblore');
        expect(handOff).toMatchObject({ id: 'H21e', tile: { x: 3185, z: 3436 }, booth: { x: 3186, z: 3436 }, vials: 0 });
        expect(() => recipesFor(['attack', 'nope'])).toThrow(/unknown herblore recipe 'nope'/);
    });
});

// ---------------------------------------------------------------- state fixtures

const BOOTH_LOC = { id: 2213, x: 3186, z: 3436, name: 'Bank booth', level: 0, distance: 1, options: ['Use', 'Use-quickly'], optionsWithIndex: [{ text: 'Use', opIndex: 1 }, { text: 'Use-quickly', opIndex: 2 }] } as unknown as NearbyLoc;

const item = (slot: number, id: number, count = 1, name = `obj ${id}`): InventoryItem => ({ slot, id, name, count, optionsWithIndex: [] });
/** H21e as delivered: the supply-safe list in notes (SUPPLIES.md). */
const H21E = [item(0, 92, 41, 'Unfinished potion'), item(1, 102, 405, 'Unfinished potion'), item(2, 222, 432, 'Eye of newt')];

function world(o: { level?: number; xp?: number; inventory?: InventoryItem[]; bank?: Array<[number, number]>; booth?: boolean; tick?: number } = {}): BotWorldState {
    const xp = o.xp ?? (o.level === undefined ? POST_RITUAL_XP : xpForLevel(o.level));
    const level = o.level ?? 28;
    return baseState({
        tick: o.tick ?? 100,
        player: { name: 'lab_h1', worldX: 3185, worldZ: 3436, x: 3185, z: 3436, level: 0 } as BotWorldState['player'],
        skills: [{ name: 'Herblore', level, baseLevel: level, experience: xp }],
        inventory: o.inventory ?? H21E,
        nearbyLocs: o.booth === false ? [{ ...BOOTH_LOC, id: 1, x: 3000 }] : [BOOTH_LOC],
        ...(o.bank ? { bank: { isOpen: true, noteMode: false, items: o.bank.map(([id, count], slot) => ({ slot, id, name: `obj ${id}`, count })) } } : {})
    });
}

/** SUPPLIES.md H21e as staged: rs/323's 09:10Z banked count across seven helpers plus cairn_h96's 100 snape grass (rs/332). */
const STAGED_H21E: Array<[number, number]> = [[91, 298], [95, 166], [99, 115], [101, 74], [103, 53], [105, 45], [221, 418], [225, 250], [231, 190]];

describe('preconditions', () => {
    test('the real start: Herblore 28 at the booth holding H21e passes', () => {
        expect(preconditions(world())).toBe(true);
    });

    test('Herblore 1: Druidic Ritual first', () => {
        expect(preconditions(world({ level: 1, xp: 0 }))).toBe('Herblore 1 is below 3: Druidic Ritual first (every potion needs level 3, brew_potion.param)');
    });

    test('short supplies, held or banked, say by how much and how far they reach', () => {
        const short = preconditions(world({ inventory: [item(0, 92, 14), item(1, 222, 14)] }));
        expect(short).toMatch(/^supplies short: \d+ base xp \(they reach Herblore \d+; 14 mixes: attack 14\)$/);
        expect(preconditions(world({ inventory: [], bank: [[91, 92], [95, 62], [101, 25], [105, 17], [221, 341], [225, 250]] }))).toMatch(/^supplies short: 29664 base xp \(they reach Herblore 79; 196 mixes/);
        // rs/323's 02:16 PDT count (banked 09:10Z), from BEFORE cairn_h96's 100 snape grass joined H21e;
        // not today's stock (that is STAGED_H21E). All six potions play; snape grass was the gap.
        const preH96: Array<[number, number]> = [[91, 298], [95, 166], [99, 115], [101, 74], [103, 53], [105, 45], [221, 418], [225, 250], [231, 90]];
        expect(preconditions(world({ inventory: [], bank: preH96 }))).toBe('supplies short: 1714 base xp (they reach Herblore 98; 673 mixes: strength 166, superattack 74, superstrength 45, fishing 53, prayer 37, attack 298)');
        // banked and the bank closed: out of sight, the program's first visit judges them
        expect(preconditions(world({ inventory: [] }))).toBe(true);
    });

    test("the staged H21e stock (SUPPLIES.md H21e: rs/323's count plus h96's 100 snape grass) reaches 99 with 5,112 base spare", () => {
        expect(preconditions(world({ inventory: [], bank: STAGED_H21E }))).toBe(true);
        const plan = planRoute(POST_RITUAL_XP, 99, recipesFor(), new Map(STAGED_H21E));
        expect([plan.reaches, plan.level, plan.xpShort, plan.actions]).toEqual([true, 99, 0, 547]);
        // the spare: the overshoot past 99 plus every mix the stock still holds, at its base xp
        const left = new Map(Object.entries(plan.left).map(([id, n]) => [Number(id), n] as [number, number]));
        let spare = (plan.loads.at(-1)!.xpAfter - xpForLevel(99)) / 25;
        for (const r of [...HERB_RECIPES].sort((x, y) => y.xp - x.xp)) {
            const n = Math.min(left.get(r.a) ?? 0, left.get(r.b!) ?? 0);
            left.set(r.a, (left.get(r.a) ?? 0) - n);
            left.set(r.b!, (left.get(r.b!) ?? 0) - n);
            spare += n * r.xp;
        }
        expect(Math.round(spare)).toBe(5112);
    });

    test('no booth in view', () => {
        expect(preconditions(world({ booth: false }))).toBe('no bank booth (3186,3436) in view (at 3185,3436)');
    });

    test('free slots: anything not a supply, product or note blocks the 28-slot working inventory', () => {
        const held = [...H21E, item(3, 1755, 1, 'Chisel'), item(4, 2347, 1, 'Hammer')];
        expect(preconditions(world({ inventory: held }))).toBe('2 other items (Chisel, Hammer): need 28 free slots');
        // potions and unnoted supplies left from an earlier session are the cycle's own
        expect(preconditions(world({ inventory: [...H21E, item(3, 121), item(4, 91)] }))).toBe(true);
    });

    test('not members; an unknown recipe; a band already passed', () => {
        expect(preconditions(world(), { members: false })).toBe('not a members world: mixing is members-only (brew_potion.rs2)');
        expect(preconditions(world(), { recipes: ['tea'] })).toContain("unknown herblore recipe 'tea'");
        expect(preconditions(world({ level: 99, booth: false, inventory: [item(0, 2347, 1, 'Hammer')] }))).toBe(true);
        expect(preconditions(baseState({ inGame: false }))).toBe('not in game');
    });
});

/** The close as rs/764's run 1 census found it (the last strength load's 4 + 4 and its 10 potions), with eye of newt and snape grass. */
const LEFTOVERS = [item(0, 95, 4, 'Unfinished potion'), item(1, 225, 4, 'Limpwurt root'), item(2, 221, 3, 'Eye of newt'), item(3, 231, 2, 'Snape grass'), ...Array.from({ length: 10 }, (_, i) => item(4 + i, 115, 1, 'Strength potion(3)'))];

describe('steps', () => {
    test('one logout-safe step, S25e; done is the target reached AND nothing of the cycle held', () => {
        const [s, ...rest] = steps({ to: 70 });
        expect(rest).toEqual([]);
        expect(s!.name).toBe(STEP_NAME);
        expect(s!.logoutSafe).toBe(true);
        const obs = (level: number, inventory: InventoryItem[] = [], xp = xpForLevel(level)) => new Observation(world({ level, xp, inventory }));
        expect(s!.done!(obs(70), {})).toBe(true);
        expect(s!.done!(obs(69), {})).toBe(false);
        expect(s!.inProgress!(obs(28, H21E, POST_RITUAL_XP), {})).toBe(false);
        expect(s!.inProgress!(obs(50, LEFTOVERS), {})).toBe(true);
        expect(s!.inProgress!(obs(70), {})).toBe(false);
        // the target reached before the stow (a logout between them): not done, in progress
        expect(s!.done!(obs(70, LEFTOVERS), {})).toBe(false);
        expect(s!.inProgress!(obs(70, LEFTOVERS), {})).toBe(true);
        for (const one of LEFTOVERS.slice(0, 5)) expect({ held: one.name, done: s!.done!(obs(70, [one]), {}) }).toEqual({ held: one.name, done: false });
        // a potion outside opts.recipes still holds the step: the stow deposits it too
        expect(steps({ to: 70, recipes: ['attack'] })[0]!.done!(obs(70, [item(0, 115, 1, 'Strength potion(3)')]), {})).toBe(false);
        // an item that is not the cycle's does not
        expect(s!.done!(obs(70, [item(0, 2347, 1, 'Hammer')]), {})).toBe(true);
        // the step record has S25e: done for the rest of the attempt, whatever herb potion a later step holds
        const marked = { has: (n: string) => n === STEP_NAME };
        const superantipoison3 = [item(0, 181, 1, 'Superantipoison(3)')];
        const recordedObs = new Observation(world({ level: 70, inventory: superantipoison3 }), {}, undefined, marked);
        expect(s!.done!(recordedObs, {})).toBe(true);
        expect(s!.inProgress!(recordedObs, {})).toBe(false);
        // not recorded (the stop reached, the close not yet passed): the leftovers keep it in progress
        const unmarked = new Observation(world({ level: 70, inventory: LEFTOVERS }), {}, undefined, { has: () => false });
        expect(s!.done!(unmarked, {})).toBe(false);
        expect(s!.inProgress!(unmarked, {})).toBe(true);
        expect(s!.postconditions(world({ level: 69, inventory: [] }), {})).toBe('Herblore 69 < 70');
        expect(s!.postconditions(world({ level: 70, inventory: LEFTOVERS }), {})).toBe('the stow left Unfinished potion, Limpwurt root, Eye of newt, Snape grass, Strength potion(3) in the inventory');
        expect(s!.postconditions(world({ level: 70, inventory: [] }), {})).toBe(true);
    });

    test('resume: a mid-band logout resumes the step; 28 starts it; 99 stowed finishes; 99 unstowed resumes into the stow', async () => {
        const walk = async (level: number, o: { xp?: number; inventory?: InventoryItem[] } = {}) => {
            const p = await resolveResume(steps(), new Observation(world({ level, ...o })), {});
            return [p.step, p.mode];
        };
        expect(await walk(28, { xp: POST_RITUAL_XP })).toEqual([STEP_NAME, 'run']);
        expect(await walk(61)).toEqual([STEP_NAME, 'resume']);
        expect((await resolveResume(steps(), new Observation(world({ level: 99, inventory: [] })), {})).mode).toBe('finished');
        expect(await walk(99, { inventory: LEFTOVERS })).toEqual([STEP_NAME, 'resume']);
        // recorded: a later state holding a 3-dose herb potion walks past S25e
        const later = new Observation(world({ level: 99, inventory: [item(0, 181, 1, 'Superantipoison(3)')] }), {}, undefined, { has: (n: string) => n === STEP_NAME });
        expect((await resolveResume(steps(), later, {})).mode).toBe('finished');
    });
});

// ---------------------------------------------------------------- one scripted pass

/** The page: a program start replies with a status; the test publishes the run's end. */
class PageSdk extends FakeSdk {
    readonly starts: Array<Record<string, unknown>> = [];
    override sendAction(a: SentAction | Record<string, unknown>): Promise<ActionResult> {
        const act = a as { type?: unknown; op?: unknown; params?: Record<string, unknown> };
        if (act.type !== 'program') return super.sendAction(a as SentAction);
        if (act.op === 'start') this.starts.push(act.params ?? {});
        return Promise.resolve({ success: true, message: 'ok', data: status({}) });
    }
}

function status(p: Partial<ProgramStatus>): ProgramStatus {
    const frames = { n: 0, p50: 0, p90: 0, max: 0, underHalfT: 0, overSevenSixthsT: 0, catchUps: 0, catchUpsLastMinute: 0, catchUpsPerMinute: 0, T: 300, TSource: 'driver' as const };
    return { runId: 3, name: 'item-cycle', phase: 'running', params: {}, startedTick: 100, tick: 100, progressTick: 100, counters: {}, gauges: {}, marks: {}, packets: 0, deferred: 0, skippedTicks: 0, maxTickMs: 0, frames, publish: frames, react: { n: 0, p50: 0, p90: 0, max: 0 }, loops: { last: 0, p10Last10s: 0, min: 0 }, ...p };
}

/**
 * runSteps over steps({ to: 40 }) from `start`, the page scripted: the run reaches Herblore 40 with
 * the last load's leftovers held, then ends (phase done) holding `end` (what its stow left).
 */
async function scripted(start: BotWorldState, end: InventoryItem[], run: { startMode?: 'resume' } = {}) {
    const sdk = new PageSdk(start);
    const session = { sdk, bot: {}, name: 'lab_h1', sessionId: 1 } as unknown as RunnerSession;
    const log = TickLog.memory('t');
    const at40 = { skills: [{ name: 'Herblore', level: 40, baseLevel: 40, experience: xpForLevel(40) }] };
    const p = runSteps(session, steps({ to: 40 }), { log, c: {}, shouldStop: () => false, logout: async () => {}, tickMonitor: false, ...(run.startMode ? { startMode: run.startMode, observed: new Observation(start) } : {}) });
    let settled = false;
    let outcome: unknown;
    p.then(
        r => (outcome = r),
        e => (outcome = e)
    ).finally(() => (settled = true));
    for (let i = 0; i < 60 && !settled; i++) {
        await flush();
        if (!sdk.starts.length) {
            sdk.tick();
            continue;
        }
        // ticks 4-6: the target shows and the stow visit is under way; tick 7 on: the run has ended
        const stopped = i > 3;
        const done = i > 6;
        sdk.tick(s => ({
            ...(stopped ? { ...at40, inventory: done ? end : LEFTOVERS } : {}),
            program: status({ tick: s.tick + 1, ...(done ? { phase: 'done', endedTick: s.tick + 1, result: { ended: 'target', actions: 56, sent: 56, visits: 5, resets: 1, drift: 0, levelups: 9, byRecipe: { strength: 56 }, ticks: 20, cycleGaps: [], sendsPerTick: {}, xpDropsPerTick: {}, stowed: end.length === 0 } } : {}) })
        }) as Partial<BotWorldState>);
    }
    return { outcome, sdk, log };
}

describe('runSteps over steps()', () => {
    test('S25e starts the program in pair mode at the quick-bank op with stow, and passes once the target is reached and the close deposited the leftovers', async () => {
        const { outcome, sdk, log } = await scripted(world(), []);
        expect(outcome).toEqual({ completed: 1 });
        expect(sdk.starts).toHaveLength(1);
        expect(sdk.starts[0]).toMatchObject({ mode: 'pair', skill: 'herblore', untilLevel: 40, stow: true, booth: { ...VARROCK_WEST, option: 2, stand: { x: 3185, z: 3436 } } });
        expect((sdk.starts[0]!.recipes as unknown[]).length).toBe(HERB_RECIPES.length);
        expect(log.rows.find(r => r.kind === 'program')).toMatchObject({ step: STEP_NAME, ok: true, meta: { result: { stowed: true } } });
        expect(log.rows.find(r => !r.kind && r.step === STEP_NAME)).toMatchObject({ ok: true });
        // the step itself sends nothing: the page's program makes every click, the stow's deposits too
        expect(sdk.sent).toEqual([]);
        expect(sdk.state!.inventory).toEqual([]);
    });

    test('a close that leaves leftovers held fails the postcondition, naming them', async () => {
        const { outcome } = await scripted(world(), LEFTOVERS.slice(0, 2));
        expect(outcome).toBeInstanceOf(Error);
        expect((outcome as Error).message).toContain('the stow left Unfinished potion, Limpwurt root in the inventory');
    });

    test('the target reached with the leftovers held (a logout before the close): the resume starts the program only to stow', async () => {
        const start = world({ level: 40, inventory: LEFTOVERS });
        const point = await resolveResume(steps({ to: 40 }), new Observation(start), {});
        expect([point.step, point.mode]).toEqual([STEP_NAME, 'resume']);
        const { outcome, sdk } = await scripted(start, [], { startMode: 'resume' });
        expect(outcome).toEqual({ completed: 1 });
        expect(sdk.starts).toHaveLength(1);
        expect(sdk.starts[0]).toMatchObject({ untilLevel: 40, stow: true });
        expect(sdk.state!.inventory).toEqual([]);
    });

    test('the target reached with nothing held: the step is finished, nothing starts', async () => {
        const point = await resolveResume(steps({ to: 40 }), new Observation(world({ level: 40, inventory: [] })), {});
        expect(point.mode).toBe('finished');
    });
});
