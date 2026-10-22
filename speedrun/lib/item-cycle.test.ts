import { describe, expect, test } from 'bun:test';
import type { ActionResult, BotWorldState } from '../../sdk/types';
import { baseState, drive, FakeSdk, type SentAction } from './fake-sdk';
import { planRoute, programParams, runItemCycle, stockFrom, type ItemCycleResult, type ItemRecipe } from './item-cycle';
import type { ProgramStatus } from './programs';
import { TickLog } from './ticks';
import { levelForXp, xpForLevel } from './xp';

// obj ids, server/content/pack/obj.pack
const GUAM = 91, TARROMIN = 95, HARRALANDER = 97, RANARR = 99, IRIT = 101, KWUARM = 105, CADANTINE = 107, DWARF_WEED = 109;
const EYE = 221, LIMPWURT = 225, WHITE_BERRIES = 239, WINE_OF_ZAMORAK = 245, CHOCOLATE_DUST = 1975;

const R = (name: string, level: number, xp: number, a: number, b: number, product: number): ItemRecipe => ({ name, level, xp, a, b, products: [product] });
const RECIPES: ItemRecipe[] = [
    R('attack', 3, 25, GUAM, EYE, 121),
    R('strength', 12, 50, TARROMIN, LIMPWURT, 115),
    R('energy', 26, 67.5, HARRALANDER, CHOCOLATE_DUST, 3010),
    R('defence', 30, 75, RANARR, WHITE_BERRIES, 133),
    R('superattack', 45, 100, IRIT, EYE, 145),
    R('superstrength', 55, 125, KWUARM, LIMPWURT, 157),
    R('superdefence', 66, 150, CADANTINE, WHITE_BERRIES, 163),
    R('ranging', 72, 162.5, DWARF_WEED, WINE_OF_ZAMORAK, 169)
];
/** Herblore after Druidic Ritual: 250 base. */
const POST_RITUAL = 250 * 25;
const stock = (entries: Array<[number, number]>) => new Map(entries);

describe('planRoute', () => {
    test('the start: Druidic Ritual leaves Herblore 28', () => {
        expect(levelForXp(POST_RITUAL)).toBe(28);
    });

    test('the supply-safe list from 28 (herblore.md section 7): 418 actions, attack then super attack', () => {
        const p = planRoute(POST_RITUAL, 99, RECIPES, stock([[GUAM, 27], [IRIT, 391], [EYE, 418]]));
        expect(p.reaches).toBe(true);
        expect(p.actions).toBe(418);
        expect(p.byRecipe).toEqual({ attack: 27, superattack: 391 });
        expect(p.xpShort).toBe(0);
        // 2 guam loads (14 + 13), 28 irit loads (27 x 14 + 13)
        expect(p.loads.length).toBe(30);
    });

    test('the ranging-cap list from 28: 258 actions over six bands', () => {
        const p = planRoute(POST_RITUAL, 99, RECIPES, stock([[HARRALANDER, 1], [CHOCOLATE_DUST, 1], [RANARR, 8], [IRIT, 10], [EYE, 10], [KWUARM, 17], [LIMPWURT, 17], [CADANTINE, 14], [WHITE_BERRIES, 22], [DWARF_WEED, 208], [WINE_OF_ZAMORAK, 208]]));
        expect(p.reaches).toBe(true);
        expect(p.actions).toBe(258);
        expect(p.byRecipe).toEqual({ energy: 1, defence: 8, superattack: 10, superstrength: 17, superdefence: 14, ranging: 208 });
    });

    test('shared secondaries go to the band that comes first: eye of newt to guam, then irit', () => {
        const p = planRoute(POST_RITUAL, 99, RECIPES, stock([[GUAM, 27], [IRIT, 391], [EYE, 300]]));
        expect(p.byRecipe.attack).toBe(27);
        expect(p.byRecipe.superattack).toBe(273);
        expect(p.left[EYE]).toBe(0);
        expect(p.left[IRIT]).toBe(118);
        expect(p.reaches).toBe(false);
    });

    test('limpwurt root to tarromin, then kwuarm: what the herb-table mix spends', () => {
        // the herb-table mix: guam/irit on eye of newt, tarromin/kwuarm on limpwurt (rs/41's working plan)
        const p = planRoute(POST_RITUAL, 99, RECIPES, stock([[GUAM, 14], [TARROMIN, 14], [IRIT, 80], [KWUARM, 300], [EYE, 94], [LIMPWURT, 300]]));
        // at 28 strength (50) beats attack (25): the tarromin go first and take 14 limpwurt
        expect(p.loads[0]!.recipe).toBe('strength');
        expect(p.byRecipe.strength).toBe(14);
        expect(p.byRecipe.superstrength).toBe(p.actions - 14 - (p.byRecipe.attack ?? 0) - (p.byRecipe.superattack ?? 0));
        expect(p.left[LIMPWURT]).toBe(300 - 14 - p.byRecipe.superstrength!);
    });

    test("rs/41's stock at 23:16 PDT: its four full pairs reach Herblore 79, about 29,660 base short", () => {
        // guam 92, tarromin 62, irit 25, kwuarm 17 unfinished; eye of newt 341, limpwurt 250 (harralander, ranarr, avantoe have no secondary)
        const p = planRoute(POST_RITUAL, 99, RECIPES, stock([[GUAM, 92], [TARROMIN, 62], [IRIT, 25], [KWUARM, 17], [EYE, 341], [LIMPWURT, 250]]));
        expect(p.reaches).toBe(false);
        expect(p.byRecipe).toEqual({ strength: 62, superattack: 25, superstrength: 17, attack: 92 });
        expect(p.level).toBe(79);
        expect(Math.round(p.xpShort / 25)).toBe(29663);
    });

    test('short supplies: reaches false with the xp still missing', () => {
        const p = planRoute(POST_RITUAL, 99, RECIPES, stock([[GUAM, 28], [EYE, 28]]));
        expect(p.reaches).toBe(false);
        expect(p.actions).toBe(28);
        expect(p.xpShort).toBe(xpForLevel(99) - POST_RITUAL - 28 * 25 * 25);
        expect(p.level).toBe(levelForXp(POST_RITUAL + 28 * 625));
    });

    test('a level band below 45 with no irit stops at the attack potions', () => {
        const p = planRoute(POST_RITUAL, 99, RECIPES, stock([[GUAM, 5], [IRIT, 400], [EYE, 500]]));
        expect(p.reaches).toBe(false);
        expect(p.byRecipe).toEqual({ attack: 5 });
    });

    test("expectedTicks: 4 per inventory plus each load's level-up pages beyond the first", () => {
        const p = planRoute(xpForLevel(90), 91, RECIPES, stock([[DWARF_WEED, 500], [WINE_OF_ZAMORAK, 500]]));
        expect(p.loads.reduce((n, l) => n + l.levelups, 0)).toBe(1);
        expect(p.expectedTicks).toBe(p.loads.length * 4); // a load's one page clears during its work ticks
        expect(planRoute(xpForLevel(90), 91, RECIPES, stock([[DWARF_WEED, 500], [WINE_OF_ZAMORAK, 500]]), { freePagesPerLoad: 0 }).expectedTicks).toBe(p.loads.length * 4 + 1);
        // herblore-accept L1 from 28 on the supply-safe list: 164 program ticks measured (bgsrv-mac, 3 of 3)
        expect(planRoute(POST_RITUAL - 1, 99, RECIPES, stock([[GUAM, 41], [IRIT, 405], [EYE, 432]])).expectedTicks).toBe(164);
    });
});

describe('stockFrom', () => {
    test('bank plus inventory, a banknote counted as its item', () => {
        const s = baseState({
            bank: { isOpen: false, noteMode: false, items: [{ slot: 0, id: IRIT, name: 'Unfinished potion', count: 30 }, { slot: 1, id: EYE, name: 'Eye of newt', count: 0 }] },
            inventory: [
                { slot: 0, id: IRIT + 1, name: 'Unfinished potion', count: 375, optionsWithIndex: [] },
                { slot: 1, id: EYE + 1, name: 'Eye of newt', count: 432, optionsWithIndex: [] },
                { slot: 2, id: GUAM, name: 'Unfinished potion', count: 1, optionsWithIndex: [] }
            ]
        });
        const m = stockFrom(s, new Map([[IRIT + 1, IRIT], [EYE + 1, EYE]]));
        expect(Object.fromEntries(m)).toEqual({ [IRIT]: 405, [EYE]: 432, [GUAM]: 1 });
    });
});

/** A FakeSdk with the page relay: a `program` start replies with a status; tests publish later statuses on ticks. */
class PageSdk extends FakeSdk {
    readonly actions: Array<Record<string, unknown>> = [];
    override sendAction(a: SentAction | Record<string, unknown>): Promise<ActionResult> {
        if ((a as { type?: unknown }).type !== 'program') return super.sendAction(a as SentAction);
        this.actions.push(a as Record<string, unknown>);
        return Promise.resolve({ success: true, message: 'started', data: status({ params: ((a as { params?: Record<string, unknown> }).params) ?? {} }) });
    }
}

function status(p: Partial<ProgramStatus>): ProgramStatus {
    const frames = { n: 0, p50: 0, p90: 0, max: 0, underHalfT: 0, overSevenSixthsT: 0, catchUps: 0, catchUpsLastMinute: 0, catchUpsPerMinute: 0, T: 300, TSource: 'driver' as const };
    return { runId: 7, name: 'item-cycle', phase: 'running', params: {}, startedTick: 100, tick: 100, progressTick: 100, counters: {}, gauges: {}, marks: {}, packets: 0, deferred: 0, skippedTicks: 0, maxTickMs: 0, frames, publish: frames, react: { n: 0, p50: 0, p90: 0, max: 0 }, loops: { last: 0, p10Last10s: 0, min: 0 }, ...p };
}

const RESULT: ItemCycleResult = { ended: 'target', actions: 28, sent: 28, visits: 3, resets: 1, drift: 0, levelups: 4, byRecipe: { attack: 28 }, ticks: 9, cycleGaps: [5, 4], sendsPerTick: { 5: 4, 2: 1 }, xpDropsPerTick: { 5: 4, 4: 2 } };

const SPEC = { mode: 'pair' as const, skill: 'herblore', recipes: RECIPES.slice(0, 1), booth: { x: 3186, z: 3436, id: 2213, option: 2 }, untilLevel: 40, step: 'S25e herblore' };

describe('runItemCycle', () => {
    test('programParams carries only what the program declares', () => {
        expect(programParams({ ...SPEC, maxActions: 28, log: () => {} })).toEqual({ mode: 'pair', skill: 'herblore', recipes: [{ ...RECIPES[0]! }], booth: SPEC.booth, untilLevel: 40, maxActions: 28 });
        // the stand tile reaches the program, which sends the booth click unrouted from it
        const stand = { x: 3185, z: 3436 };
        expect(programParams({ ...SPEC, booth: { ...SPEC.booth!, stand } }).booth).toEqual({ ...SPEC.booth, stand });
    });

    test('programParams carries held, bank and mixed when given (the cooking windows), and leaves them out otherwise', () => {
        const tool = { ...SPEC, mode: 'tool' as const, skill: 'crafting' };
        expect(programParams({ ...tool, held: true, bank: false, mixed: true })).toMatchObject({ held: true, bank: false, mixed: true });
        expect(Object.keys(programParams(tool))).not.toEqual(expect.arrayContaining(['held']));
        for (const k of ['held', 'bank', 'mixed']) expect(programParams(tool)).not.toHaveProperty(k);
        // clearTicks is the driver's, never the program's
        expect(programParams({ ...tool, clearTicks: 0 })).not.toHaveProperty('clearTicks');
        // fill (stack mode) only when given
        const stack = { mode: 'stack' as const, skill: 'fletching', recipes: [{ name: 'runearrow', level: 75, xp: 187.5, a: 53, b: 44, products: [892], per: 15 }], untilLevel: 99, step: 'S18d-fallback fletching' };
        expect(programParams({ ...stack, fill: true })).toMatchObject({ mode: 'stack', fill: true });
        expect(programParams(stack)).not.toHaveProperty('fill');
    });

    test('done: resolves with the result; one program row and one note; the watcher runs out its ticks', async () => {
        const sdk = new PageSdk(baseState({ tick: 100 }));
        const log = TickLog.memory('t');
        const progress: number[] = [];
        const p = runItemCycle({ sdk, session: { name: 'cairn_h85', sessionId: 1 }, log }, { ...SPEC, onProgress: st => progress.push(st.tick) });
        let n = 0;
        const r = await drive(sdk, p, 40, (s: BotWorldState) => {
            n++;
            const st = n < 3 ? status({ tick: s.tick + 1 }) : status({ tick: s.tick + 1, phase: 'done', endedTick: 109, result: RESULT, counters: { visits: 3 } });
            return { program: st } as Partial<BotWorldState>;
        });
        expect(r).toEqual(RESULT);
        expect(sdk.actions[0]).toMatchObject({ type: 'program', op: 'start', name: 'item-cycle', params: { mode: 'pair', untilLevel: 40 } });
        expect(progress.length).toBeGreaterThan(0);
        const [row, note] = log.rows;
        expect(row).toMatchObject({ kind: 'program', step: 'S25e herblore', ok: true, startTick: 100, endTick: 109, ticks: 9, account: 'cairn_h85' });
        expect((row!.meta as { result: { visits: number } }).result.visits).toBe(3);
        expect(note).toMatchObject({ kind: 'note', step: 'S25e herblore', meta: { what: 'item-cycle end', phase: 'done', sendsPerTick: { 5: 4, 2: 1 }, cycleGaps: [5, 4] } });
        expect(log.rows).toHaveLength(2);
    });

    test('fault: rejects with the page fault, and the rows say so', async () => {
        const sdk = new PageSdk(baseState({ tick: 100 }));
        const log = TickLog.memory('t');
        const p = runItemCycle({ sdk, session: { name: 'cairn_h85', sessionId: 1 }, log }, SPEC);
        const settled = p.then(() => 'resolved', (e: Error) => e.message);
        await drive(sdk, settled, 40, (s: BotWorldState) => ({ program: status({ tick: s.tick + 1, phase: 'fault', fault: 'out of supplies: no recipe at herblore 33', faultDetail: { ...RESULT, ended: null }, endedTick: s.tick + 1 }) }) as Partial<BotWorldState>);
        expect(await settled).toContain('out of supplies');
        expect(log.rows[0]).toMatchObject({ kind: 'program', ok: false, meta: { fault: 'out of supplies: no recipe at herblore 33' } });
        expect(log.rows[0]!.error).toContain('faulted');
        expect(log.rows[1]).toMatchObject({ kind: 'note', meta: { phase: 'fault', fault: 'out of supplies: no recipe at herblore 33' } });
    });

    test('a refused start throws before any row is written', async () => {
        const sdk = new PageSdk(baseState({ tick: 100 }));
        sdk.sendAction = () => Promise.resolve({ success: false, message: 'bad parameters: booth must be {x, z, id, option}' });
        const log = TickLog.memory('t');
        await expect(runItemCycle({ sdk, session: { name: 'x', sessionId: 1 }, log }, SPEC)).rejects.toThrow(/booth must be/);
        expect(log.rows).toHaveLength(0);
    });
});
