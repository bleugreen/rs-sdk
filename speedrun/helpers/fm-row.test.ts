import { describe, expect, setSystemTime, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RoleContext } from './role';

import {
    advance,
    advanceFresh,
    blockLast,
    catchUp,
    cuePeriod,
    cueTick,
    dropTarget,
    earliestDrop,
    FIRE_OUT_TICKS,
    FireLedger,
    fireOutBy,
    FmRow,
    GO_FILE,
    fmRowOptions,
    inventoryOf,
    LAB_ROW,
    latestDrop,
    loadFor,
    maxRestockTicks,
    NO_PROGRESS,
    needTick,
    occupied,
    ownLogs,
    pathTile,
    placeSlot,
    plannedTiles,
    REVEAL_TICKS,
    ROLL_TICKS,
    resumeCursor,
    rowPlan,
    shortestRevisit,
    snakeTile,
    type Pace,
    type Progress
} from './fm-row';
import { S03_LOGS as ROUTE_LOGS } from './fm-row';

const plan = rowPlan(LAB_ROW);

describe('row plan', () => {
    test('157 logs in firemaking.md order, one per snake tile', () => {
        expect(plan.length).toBe(157);
        const counts = new Map<string, number>();
        for (const l of plan) counts.set(l.tier.name, (counts.get(l.tier.name) ?? 0) + 1);
        expect([...counts]).toEqual([['Logs', 2], ['Oak logs', 4], ['Willow logs', 7], ['Maple logs', 13], ['Yew logs', 24], ['Magic logs', 107]]);
        expect(plan[6]!.tier.name).toBe('Willow logs');
    });

    test('the snake is firemaking-line.ts: west along z, back east one row south, then from the start again', () => {
        expect(snakeTile(LAB_ROW, 0)).toEqual({ x: 3019, z: 3362 });
        expect(snakeTile(LAB_ROW, 26)).toEqual({ x: 2993, z: 3362 });
        expect(snakeTile(LAB_ROW, 27)).toEqual({ x: 2993, z: 3361 });
        expect(snakeTile(LAB_ROW, 53)).toEqual({ x: 3019, z: 3361 });
        expect(snakeTile(LAB_ROW, 54)).toEqual({ x: 3019, z: 3362 });
    });

    test('inventories of 28, shared out by part', () => {
        expect(ownLogs(157, 0, 1)).toHaveLength(157);
        const odd = ownLogs(157, 1, 2);
        expect(odd[0]).toBe(28);
        expect(odd.filter(i => inventoryOf(i) === 1)).toHaveLength(28);
        expect(new Set(odd.map(inventoryOf))).toEqual(new Set([1, 3, 5]));
        expect(odd.at(-1)).toBe(156);
        expect(odd).toHaveLength(28 + 28 + 17);
        expect(ownLogs(157, 0, 2).at(-1)).toBe(139);
    });

    test('a load is the rest of the current inventory, by tier', () => {
        const own = ownLogs(157, 0, 1);
        expect(loadFor(plan, own, 0).map(l => [l.tier.name, l.n])).toEqual([['Logs', 2], ['Oak logs', 4], ['Willow logs', 7], ['Maple logs', 13], ['Yew logs', 2]]);
        expect(loadFor(plan, own, 28).map(l => [l.tier.name, l.n])).toEqual([['Yew logs', 22], ['Magic logs', 6]]);
        expect(loadFor(plan, own, 140).map(l => [l.tier.name, l.n])).toEqual([['Magic logs', 17]]);
        expect(loadFor(plan, own, 150).map(l => [l.tier.name, l.n])).toEqual([['Magic logs', 7]]);
    });

    test('a restart resumes after the last own log lying on its tile', () => {
        const own = ownLogs(157, 0, 1);
        const lying = (i: number) => ({ name: plan[i]!.tier.name, ...plan[i]!.tile });
        expect(resumeCursor(plan, own, [])).toBe(0);
        expect(resumeCursor(plan, own, [lying(10), lying(11), lying(12)])).toBe(13);
        // Another tier on the tile (ashes, someone's bones) is not ours.
        expect(resumeCursor(plan, own, [{ name: 'Ashes', ...plan[20]!.tile }])).toBe(0);
    });
});

describe('SCORED progress', () => {
    test('fires move the frontier over consecutive dropped logs only', () => {
        const fires = new Set(['3019,3362', '3018,3362', '3016,3362']);
        const burning = (t: { x: number; z: number }) => fires.has(`${t.x},${t.z}`);
        const p = advance(NO_PROGRESS, plan, burning, () => true, 40);
        expect(p).toEqual({ lit: 2, litTick: 40 });
        expect(advance(p, plan, burning, () => true, 41)).toBe(p);
        expect(advance(NO_PROGRESS, plan, burning, i => i < 1, 40)).toEqual({ lit: 1, litTick: 40 });
    });

    test('before the first success, log i is due a roll per log after log 0, or later if SCORED has not lit by now', () => {
        expect(needTick(NO_PROGRESS, 0, 0, 105)).toBe(105);
        expect(needTick(NO_PROGRESS, 3, 0, 105)).toBe(117);
        // At 115 nothing has caught: the success of log 0 is at least a tick away.
        expect(needTick(NO_PROGRESS, 1, 115, 105)).toBe(116);
        expect(needTick(NO_PROGRESS, 2, 115, 105)).toBe(120);
    });

    test('after a success, the next log is due at once and each later log one roll later', () => {
        const p: Progress = { lit: 5, litTick: 50 };
        expect(needTick(p, 4, 50, 0)).toBe(Number.NEGATIVE_INFINITY);
        expect(needTick(p, 5, 50, 0)).toBe(50);
        expect(needTick(p, 6, 50, 0)).toBe(54);
        expect(needTick(p, 8, 50, 0)).toBe(62);
        // A failed roll at 54: no success seen by 55, so log 6 is due no sooner than 56.
        expect(needTick(p, 6, 55, 0)).toBe(56);
    });
});

describe('drop targets', () => {
    const pace: Pace = { reveal: REVEAL_TICKS, lead: 4, restockTicks: 6, dropTicks: 2 };

    test('a log is dropped so it turns public `lead` ticks before it is due', () => {
        // Decided at T, it lands at T + 1 and turns public at T + 1 + reveal.
        const T = latestDrop(500, pace);
        expect(T + 1 + REVEAL_TICKS).toBe(500 - pace.lead);
        expect(earliestDrop(500, pace) + 1 + REVEAL_TICKS).toBe(500 - REVEAL_TICKS);
        expect(dropTarget(10, 27, null, i => 100 + 4 * i, pace)).toBe(latestDrop(140, pace));
    });

    test('before a restock the rest of the inventory is pulled forward so the next one is down in time', () => {
        const need = (i: number) => 1000 + 4 * i;
        const slow = { ...pace, restockTicks: 60 };
        // The next own log (28) is due at 1112; the restock must start 60 ticks before its latest drop.
        const leave = latestDrop(need(28), slow) - 60;
        expect(dropTarget(27, 27, 28, need, slow)).toBe(leave);
        expect(dropTarget(20, 27, 28, need, slow)).toBe(leave - 2 * 7);
        // A 60-tick trip pulls the whole inventory forward; a 6-tick one only its last log.
        expect(dropTarget(0, 27, 28, need, slow)).toBe(leave - 2 * 27);
        expect(dropTarget(0, 27, 28, need, pace)).toBe(latestDrop(need(0), pace));
        expect(dropTarget(26, 27, 28, need, pace)).toBe(latestDrop(need(26), pace));
        expect(dropTarget(27, 27, 28, need, pace)).toBe(latestDrop(need(28), pace) - 6);
    });
});

// ------------------------------------------------------------------ a tick simulation of the pacing

const ROLL = 4;

interface SimResult {
    /** Logs SCORED wanted before they were public, with how many ticks it waited. */
    late: Array<{ i: number; waited: number }>;
    /** For each log, ticks between turning public and SCORED wanting it. */
    ahead: number[];
    gaps: Map<number, number>;
    end: number;
}

/**
 * SCORED wants log 0 at `arrive`, lights each log as soon as it is public, and
 * chains 4-tick rolls, failing `fails[i]` rolls on log i. Droppers decide on
 * every tick from the fires they would see (SCORED's successes so far), drop at
 * most one log per `dropTicks`, and spend `restockTicks` between inventories.
 */
function simulate(o: { parts: number; pace: Pace; fails: (i: number) => number; arrive?: number; trigger?: number }): SimResult {
    const { pace } = o;
    const trigger = o.trigger ?? 0;
    const start = trigger + 1 + pace.reveal + pace.lead;
    const arrive = o.arrive ?? start;
    const pub = new Array<number>(plan.length).fill(Infinity);
    const droppers = Array.from({ length: o.parts }, (_, part) => ({ own: ownLogs(plan.length, part, o.parts), cursor: 0, lastDrop: -99, busyUntil: -1 }));
    const success: number[] = [];
    const late: SimResult['late'] = [];
    let want = arrive;
    let i = 0;
    let rolling: { done: number } | null = null;
    let chained = false;
    for (let t = trigger; t < 5000 && success.length < plan.length; t++) {
        // SCORED, on tick t: its state shows every success up to t.
        if (rolling && t === rolling.done) {
            success.push(t);
            rolling = null;
            i++;
            want = t;
        }
        if (!rolling && i < plan.length && t >= want && pub[i]! <= t) {
            if (pub[i]! > want) late.push({ i, waited: pub[i]! - want });
            // Chained: the light lands two ticks after the success seen and rolls on the 4-tick clock;
            // a fresh start (the first log, or after a wait) rolls 3 ticks after the light lands.
            const first: number = chained && t === want ? t + ROLL : t + 1 + 3;
            rolling = { done: first + ROLL * o.fails(i) };
            chained = true;
        }
        const p: Progress = success.length ? { lit: success.length, litTick: success.at(-1)! } : NO_PROGRESS;
        for (const d of droppers) {
            if (d.cursor >= d.own.length || t < d.busyUntil) continue;
            const j = d.own[d.cursor]!;
            const k = inventoryOf(j);
            let c = d.cursor;
            while (c + 1 < d.own.length && inventoryOf(d.own[c + 1]!) === k) c++;
            const target = dropTarget(j, d.own[c]!, d.own[c + 1] ?? null, x => needTick(p, x, t, start), pace);
            if (t < target || t - d.lastDrop < pace.dropTicks) continue;
            pub[j] = t + 1 + pace.reveal;
            d.lastDrop = t;
            d.cursor++;
            // The restock starts with the inventory's last drop and ends `restockTicks` later.
            if (d.cursor < d.own.length && inventoryOf(d.own[d.cursor]!) !== k) d.busyUntil = t + pace.restockTicks;
        }
    }
    const wants = [arrive, ...success.slice(0, -1)];
    const gaps = new Map<number, number>();
    for (let n = 1; n < success.length; n++) gaps.set(success[n]! - success[n - 1]!, (gaps.get(success[n]! - success[n - 1]!) ?? 0) + 1);
    return { late, ahead: wants.map((w, n) => w - pub[n]!), gaps, end: success.at(-1)! };
}

/** firemaking.md's measured run 1 had 9 failures below level 43; spread them over the first 25 logs. */
const NINE_FAILS = (i: number) => ([0, 0, 2, 1, 0, 1, 2, 0, 1, 0, 0, 1, 0, 0, 0, 1] as number[])[i] ?? 0;

describe('pacing, simulated', () => {
    const pace: Pace = { reveal: REVEAL_TICKS, lead: 4, restockTicks: 6, dropTicks: 2 };

    test('one dropper with lab restocks: SCORED never waits after log 0 and nothing is public over 100 ticks early', () => {
        const r = simulate({ parts: 1, pace, fails: NINE_FAILS });
        expect(r.late).toEqual([]);
        expect(Math.max(...r.ahead)).toBeLessThanOrEqual(REVEAL_TICKS);
        expect(Math.min(...r.ahead)).toBeGreaterThanOrEqual(0);
        // Every log after the failures is public exactly `lead` ticks before it is wanted.
        expect(r.ahead.slice(40).every(a => a === pace.lead || a > pace.lead)).toBe(true);
        // Seven logs after log 0 have failed rolls; every other gap is the 4-tick chain.
        expect(r.gaps.get(4)).toBe(156 - 7);
    });

    test('no failures: 156 gaps of 4', () => {
        const r = simulate({ parts: 1, pace, fails: () => 0 });
        expect(r.late).toEqual([]);
        expect([...r.gaps]).toEqual([[4, 156]]);
    });

    test('one dropper affords a 56-tick bank trip at 2 ticks a drop (28 rolls = 112 ticks per inventory)', () => {
        expect(maxRestockTicks(1, pace)).toBe(112 - 56);
        const fits = simulate({ parts: 1, pace: { ...pace, restockTicks: 56 }, fails: NINE_FAILS });
        expect(fits.late).toEqual([]);
        expect(Math.max(...fits.ahead)).toBeLessThanOrEqual(REVEAL_TICKS);
        // Over it, each inventory starts later than the last; `lead` hides the first few ticks of it.
        const over = simulate({ parts: 1, pace: { ...pace, restockTicks: 80 }, fails: () => 0 });
        expect(over.late.length).toBeGreaterThan(0);
    });

    test('a 150-tick bank trip needs two droppers: one alone falls behind, two keep up inside the window', () => {
        expect(maxRestockTicks(2, pace)).toBeGreaterThanOrEqual(150);
        const one = simulate({ parts: 1, pace: { ...pace, restockTicks: 150 }, fails: NINE_FAILS });
        expect(one.late.length).toBeGreaterThan(0);
        const two = simulate({ parts: 2, pace: { ...pace, restockTicks: 150 }, fails: NINE_FAILS });
        expect(two.late).toEqual([]);
        expect(Math.max(...two.ahead)).toBeLessThanOrEqual(REVEAL_TICKS);
    });

    test('a shorter private window caps the trip instead: the last log before it must not turn public too early', () => {
        const fast = { ...pace, dropTicks: 1 };
        expect(maxRestockTicks(1, fast)).toBe(112 - 28);
        const short = { ...fast, reveal: 50 };
        expect(maxRestockTicks(1, short)).toBe(50 + 4 - short.lead);
        const r = simulate({ parts: 1, pace: { ...short, restockTicks: maxRestockTicks(1, short) }, fails: () => 0 });
        expect(r.late).toEqual([]);
        expect(Math.max(...r.ahead)).toBe(50);
    });

    test('SCORED arriving 60 ticks after log 0 is public: the dropper holds back instead of running ahead', () => {
        const r = simulate({ parts: 1, pace, fails: () => 0, arrive: 1 + REVEAL_TICKS + pace.lead + 60 });
        expect(r.late).toEqual([]);
        // Log 0 waited the 60 ticks; nothing waited longer than the window.
        expect(r.ahead[0]).toBe(pace.lead + 60);
        expect(Math.max(...r.ahead)).toBeLessThanOrEqual(REVEAL_TICKS);
    });
});

describe('options', () => {
    test('defaults: the lab row, one part, sighted, bank restock at Falador east', () => {
        const o = fmRowOptions({}, {});
        expect(o.row).toEqual(LAB_ROW);
        expect([o.part, o.parts, o.start, o.restock.kind, o.lead]).toEqual([0, 1, 'sighted', 'bank', 4]);
        expect(o.restockTicks).toBeGreaterThan(20);
        expect(fmRowOptions({ restock: { kind: 'cheat' } }, {}).restockTicks).toBe(6);
    });

    test('refuses a name in place of the hash, and a part outside parts', () => {
        expect(() => fmRowOptions({ scoredSha256: 'cairn_f02' }, {})).toThrow(/sha-256/);
        expect(() => fmRowOptions({ part: 2, parts: 2 }, {})).toThrow(/part/);
        expect(() => fmRowOptions({ start: 'later' }, {})).toThrow(/start/);
    });
});

// ------------------------------------------------------------------ opt-ins (all default off)

const LIST = Array.from({ length: 50 }, (_, n) => ({ x: 3240 - n, z: 3218 }));

describe('tiles: an explicit list in place of the snake', () => {
    test('the plan walks the list in order and cycles it', () => {
        const p = rowPlan(LIST);
        expect(p[0]!.tile).toEqual({ x: 3240, z: 3218 });
        expect(p[49]!.tile).toEqual({ x: 3191, z: 3218 });
        expect(p[50]!.tile).toEqual(p[0]!.tile);
        expect(pathTile(LAB_ROW, 27)).toEqual(snakeTile(LAB_ROW, 27));
    });

    test('options: [x, z] pairs, never with row, and the bank trip measured from the first tile', () => {
        const o = fmRowOptions({ tiles: [[3240, 3218], [3239, 3218]] }, {});
        expect(o.tiles).toEqual([{ x: 3240, z: 3218 }, { x: 3239, z: 3218 }]);
        expect(o.restockTicks).toBe(Math.max(3240 - 3013, 3357 - 3218) + 20);
        expect(fmRowOptions({}, {}).tiles).toBeNull();
        expect(() => fmRowOptions({ tiles: [[1, 2]], row: LAB_ROW }, {})).toThrow(/not both/);
        expect(() => fmRowOptions({ tiles: [] }, {})).toThrow(/non-empty/);
        expect(() => fmRowOptions({ tiles: [[1, 2, 3]] }, {})).toThrow(/tiles\[0\]/);
        expect(() => fmRowOptions({ tiles: [[1, 'a']] }, {})).toThrow(/tiles\[0\]\.z/);
    });
});

describe('skipOccupied: blocks with spares, skips, fresh-fire progress', () => {
    test('spareTiles: off by default, 2 per block with parts > 1, 0 with one dropper, overridable to 0', () => {
        expect([fmRowOptions({}, {}).skipOccupied, fmRowOptions({}, {}).spareTiles]).toEqual([false, 0]);
        expect(fmRowOptions({ skipOccupied: true }, {}).spareTiles).toBe(0);
        expect(fmRowOptions({ skipOccupied: true, parts: 6 }, {}).spareTiles).toBe(2);
        expect(fmRowOptions({ skipOccupied: true, parts: 6, spareTiles: 0 }, {}).spareTiles).toBe(0);
        expect(() => fmRowOptions({ spareTiles: 2 }, {})).toThrow(/skipOccupied/);
        expect(() => fmRowOptions({ skipOccupied: 'yes' }, {})).toThrow(/skipOccupied/);
    });

    test('plannedTiles: each inventory is 28 logs then its spares, carried by part k % parts', () => {
        const layout = plannedTiles(LIST, 6, 2);
        expect(layout).toHaveLength(157 + 6 * 2);
        expect(layout.map(t => t.slot)).toEqual(layout.map((_, n) => n));
        expect(layout[27]).toMatchObject({ slot: 27, inventory: 0, part: 0, log: 27 });
        expect(layout[28]).toMatchObject({ slot: 28, inventory: 0, part: 0, log: null });
        expect(layout[29]).toMatchObject({ inventory: 0, log: null });
        expect(layout[30]).toMatchObject({ slot: 30, inventory: 1, part: 1, log: 28, tile: LIST[30] });
        // The last inventory is 17 logs and its 2 spares.
        expect(layout.filter(t => t.inventory === 5).map(t => t.log)).toEqual([...Array.from({ length: 17 }, (_, m) => 140 + m), null, null]);
        // The plan agrees with the layout; with no spares it is the old one-log-per-slot plan.
        const p = rowPlan(LIST, undefined, 2);
        for (const t of layout) if (t.log !== null) expect(p[t.log]).toMatchObject({ slot: t.slot, tile: t.tile });
        expect(rowPlan(LAB_ROW, undefined, 0)).toEqual(rowPlan(LAB_ROW).map((l, i) => ({ ...l, slot: i })));
        expect(plannedTiles(LIST, 6, 0).map(t => t.log)).toEqual(Array.from({ length: 157 }, (_, n) => n));
    });

    test('a skip stays inside its block when parts > 1, and has no limit with one dropper', () => {
        expect(blockLast(0, 157, 2, 6)).toBe(29);
        expect(blockLast(55, 157, 2, 6)).toBe(59);
        expect(blockLast(150, 157, 2, 6)).toBe(150 + 17 + 2 - 1);
        expect(blockLast(0, 157, 0, 6)).toBe(27);
        expect(blockLast(0, 157, 0, 1)).toBe(Number.POSITIVE_INFINITY);
    });

    test('placeSlot takes the first free slot, else the block’s last one', () => {
        const taken = new Set([10, 11]);
        expect(placeSlot(9, 29, s => taken.has(s))).toEqual({ slot: 9, full: false });
        expect(placeSlot(10, 29, s => taken.has(s))).toEqual({ slot: 12, full: false });
        expect(placeSlot(10, 11, s => taken.has(s))).toEqual({ slot: 11, full: true });
        // The previous log already went on the block's last slot.
        expect(placeSlot(30, 29, () => false)).toEqual({ slot: 29, full: true });
        expect(placeSlot(5, Number.POSITIVE_INFINITY, s => s < 8)).toEqual({ slot: 8, full: false });
    });

    test('occupied: a fire, or any ground item but ashes', () => {
        const t = { x: 3230, z: 3218 };
        expect(occupied(t, [], [])).toBe(false);
        expect(occupied(t, [{ name: 'Fire', ...t }], [])).toBe(true);
        expect(occupied(t, [{ name: 'Daisies', ...t }, { name: 'Fire', x: 3231, z: 3218 }], [])).toBe(false);
        expect(occupied(t, [], [{ name: 'Ashes', ...t }])).toBe(false);
        expect(occupied(t, [], [{ name: 'Bones', ...t }])).toBe(true);
        expect(occupied(t, [], [{ name: 'Magic logs', ...t }])).toBe(true);
    });

    test('FireLedger: a fire counts only if its tile was seen clear first; clearing forgets it', () => {
        const a = { x: 1, z: 1 };
        const b = { x: 2, z: 1 };
        const l = new FireLedger();
        l.watch(a, true, 10);
        expect(l.freshSince(a)).toBeNull();
        l.watch(a, true, 11);
        expect(l.freshSince(a)).toBeNull();
        l.watch(b, false, 10);
        l.watch(b, true, 12);
        l.watch(b, true, 13);
        expect(l.freshSince(b)).toBe(12);
        // Burnt out, then relit on the next lap.
        l.watch(a, false, 200);
        l.watch(a, true, 260);
        expect(l.freshSince(a)).toBe(260);
        l.watch(b, false, 300);
        expect(l.freshSince(b)).toBeNull();
    });

    test('advanceFresh moves over consecutive found fires, searching on from the last one’s slot', () => {
        // Log 0 burns at slot 0; log 1 was pushed to slot 2; log 2 has no fire yet.
        const fires = new Map([[0, 0], [2, 1]]);
        const seenFrom: number[] = [];
        const fireAt = (i: number, from: number) => {
            seenFrom.push(from);
            for (const [s, log] of fires) if (log === i && s >= from) return s;
            return null;
        };
        const r = advanceFresh(NO_PROGRESS, -1, 157, fireAt, 50);
        expect(r).toEqual({ progress: { lit: 2, litTick: 50 }, litSlot: 2 });
        expect(seenFrom).toEqual([0, 1, 3]);
        const same = advanceFresh(r.progress, r.litSlot, 157, () => null, 51);
        expect(same.progress).toBe(r.progress);
        expect(advanceFresh({ lit: 157, litTick: 9 }, 160, 157, () => 0, 52).progress.lit).toBe(157);
    });
});

describe('restock held: preloaded droppers', () => {
    test('parts 6: each part holds its one inventory and never restocks', () => {
        for (let part = 0; part < 6; part++) {
            const o = fmRowOptions({ parts: 6, part, restock: { kind: 'held' } }, {});
            expect([o.restock.kind, o.restockTicks]).toEqual(['held', 0]);
        }
        // The loads rs/228 sends to the droppers, by part.
        const own = (part: number) => ownLogs(157, part, 6);
        expect(loadFor(plan, own(0), 0).map(l => [l.tier.name, l.n])).toEqual([['Logs', 2], ['Oak logs', 4], ['Willow logs', 7], ['Maple logs', 13], ['Yew logs', 2]]);
        expect(loadFor(plan, own(1), 0).map(l => [l.tier.name, l.n])).toEqual([['Yew logs', 22], ['Magic logs', 6]]);
        expect(loadFor(plan, own(5), 0).map(l => [l.tier.name, l.n])).toEqual([['Magic logs', 17]]);
    });

    test('refuses a part that owns more than one inventory, or none', () => {
        expect(() => fmRowOptions({ parts: 2, restock: { kind: 'held' } }, {})).toThrow(/owns 3/);
        expect(() => fmRowOptions({ restock: { kind: 'held' } }, {})).toThrow(/parts must be 6/);
        expect(() => fmRowOptions({ parts: 7, part: 6, restock: { kind: 'held' } }, {})).toThrow(/owns 0/);
        expect(() => fmRowOptions({ restock: { kind: 'mule' } }, {})).toThrow(/held/);
    });
});

describe('cueAt written: staggered droppers count from when the cue was written', () => {
    test('cueTick: one tick per tickMs back from the tick it was seen, never ahead of it', () => {
        expect(cueTick(5000, 1_000_000, 1_000_000 - 30_000, 300)).toBe(5000 - 100);
        expect(cueTick(5000, 1_000_000, 1_000_000 - 30_000, 600)).toBe(5000 - 50);
        expect(cueTick(5000, 1_000_000, 1_000_000 - 140, 300)).toBe(5000);
        expect(cueTick(5000, 1_000_000, 1_000_000 - 160, 300)).toBe(4999);
        expect(cueTick(5000, 1_000_000, 1_000_000 + 9_000, 300)).toBe(5000);
    });

    test('options: seen by default, written only with start cue, tickMs from wait.ts unless given', () => {
        expect(fmRowOptions({}, {}).cueAt).toBe('seen');
        expect(fmRowOptions({ start: 'cue', cueAt: 'written' }, { NODE_TICKRATE: '300' }).tickMs).toBe(300);
        expect(fmRowOptions({ start: 'cue', cueAt: 'written' }, { NODE_TICKRATE: '600', SPEEDRUN_TICK_MS: '420' }).tickMs).toBe(420);
        expect(fmRowOptions({ start: 'cue', cueAt: 'written', tickMs: 600 }, { NODE_TICKRATE: '300' }).tickMs).toBe(600);
        expect(() => fmRowOptions({ cueAt: 'written' }, {})).toThrow(/start 'cue'/);
        expect(() => fmRowOptions({ start: 'cue', cueAt: 'later' }, {})).toThrow(/cueAt/);
        expect(() => fmRowOptions({ start: 'cue', cueAt: 'written', tickMs: 0 }, {})).toThrow(/tickMs/);
    });

    test('cuePeriod: observed, else the writer\'s, else nominal; a measured period is held to 250-600 ms', () => {
        expect(cuePeriod(350, 340, 300)).toEqual({ tickMs: 350, from: 'observed' });
        expect(cuePeriod(null, 340, 300)).toEqual({ tickMs: 340, from: 'cue' });
        expect(cuePeriod(null, undefined, 300)).toEqual({ tickMs: 300, from: 'nominal' });
        expect(cuePeriod(null, 'x', 300)).toEqual({ tickMs: 300, from: 'nominal' });
        expect(cuePeriod(null, 0, 300)).toEqual({ tickMs: 300, from: 'nominal' });
        expect(cuePeriod(120, undefined, 300)).toEqual({ tickMs: 250, from: 'observed' });
        expect(cuePeriod(null, 2_000, 300)).toEqual({ tickMs: 600, from: 'cue' });
        // The nominal option is configuration, taken as given.
        expect(cuePeriod(null, undefined, 700)).toEqual({ tickMs: 700, from: 'nominal' });
    });

    test('catchUp: a late dropper takes the frontier from the highest burning pair SCORED can have reached', () => {
        const burning = new Set([30, 31, 40, 60, 61]);
        const fireSlot = (i: number) => (burning.has(i) ? i : null);
        // At 200, SCORED can be at most 49 logs on; 60-61 are someone else's, 40 alone is not a pair.
        const c = catchUp(157, fireSlot, 0, 200)!;
        expect(c).toEqual({ progress: { lit: 32, litTick: 196 }, litSlot: 31 });
        // The next log is wanted from the next tick on, not one roll per log after log 0.
        expect(needTick(c.progress, 32, 200, 0)).toBe(196);
        expect(needTick(c.progress, 33, 200, 0)).toBe(201);
        expect(catchUp(157, fireSlot, 0, 100)).toBeNull();
        expect(catchUp(157, i => (i === 0 ? 0 : null), 0, 4)).toEqual({ progress: { lit: 1, litTick: 0 }, litSlot: 0 });
        expect(catchUp(157, i => (i === 0 ? 0 : null), 0, 3)).toBeNull();
    });
});

// ------------------------------------------------------------------ the role's wiring, against a fake client

type Item = { name: string; x: number; z: number };

function fakeRole(options: Record<string, unknown>) {
    const logs: Array<{ m: string; d?: Record<string, unknown> }> = [];
    const state = {
        tick: 1000,
        player: { worldX: LIST[0]!.x, worldZ: LIST[0]!.z },
        inventory: [] as Array<{ name: string; count: number; slot: number }>,
        nearbyLocs: [{ name: 'Tree', x: 0, z: 0 }] as Item[],
        groundItems: [] as Item[],
        nearbyPlayers: []
    };
    const listeners = new Set<(s: typeof state) => void>();
    const onStateUpdate = (l: (s: typeof state) => void) => (listeners.add(l), () => void listeners.delete(l));
    const sdk = { getState: () => state, onStateUpdate, scanNearbyLocs: async () => state.nearbyLocs, scanGroundItems: async () => state.groundItems };
    const ctx = { sdk, bot: {}, account: 'cairn_d01', options, log: (m: string, d?: Record<string, unknown>) => logs.push({ m, d }), signal: new AbortController().signal } as unknown as RoleContext;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const role = new FmRow(ctx) as any;
    /** The client publishes tick `tick` now. */
    const publish = (tick: number) => {
        state.tick = tick;
        for (const l of listeners) l(state);
    };
    return { role, state, logs, publish, listeners };
}

/** A client ticking every `ms` from tick 1000 at `t0` (the fake system clock moves with it) to `ticks` later. */
function tickAt(publish: (tick: number) => void, t0: number, ms: number, ticks: number): void {
    for (let k = 1; k <= ticks; k++) {
        setSystemTime(new Date(t0 + ms * k));
        publish(1000 + k);
    }
}

describe('role wiring', () => {
    test('restock held: checks the load and throws if short, spares allowed; never walks', async () => {
        const { role, state, logs } = fakeRole({ tiles: LIST.map(t => [t.x, t.z]), parts: 6, part: 5, restock: { kind: 'held' } });
        state.inventory = [{ name: 'Magic logs', count: 10, slot: 0 }];
        await expect(role.restock()).rejects.toThrow(/short of 17 Magic logs \(holds 10\)/);
        state.inventory = Array.from({ length: 22 }, (_, slot) => ({ name: 'Magic logs', count: 1, slot }));
        await role.restock();
        expect(logs.map(l => l.m)).toEqual(['held']);
    });

    test('skipOccupied: a foreign item moves the log on, inside its block; a full block logs it', () => {
        const { role, state, logs } = fakeRole({ tiles: LIST.map(t => [t.x, t.z]), parts: 6, part: 0, skipOccupied: true });
        state.groundItems = [{ name: 'Bones', ...LIST[0]! }, { name: 'Ashes', ...LIST[1]! }];
        expect(role.chooseTile(0, state)).toEqual(LIST[1]);
        expect(logs.at(-1)).toMatchObject({ m: 'skip', d: { i: 0, from: 0, to: 1 } });
        // Log 27 is the block's last log; with slots 27-29 taken it goes on 29 anyway.
        role.placed.set(26, { slot: 27, tick: 0 });
        state.player = { worldX: LIST[28]!.x, worldZ: LIST[28]!.z };
        state.nearbyLocs = [{ name: 'Fire', ...LIST[28]! }, { name: 'Fire', ...LIST[29]! }];
        state.groundItems = [];
        expect(role.chooseTile(27, state)).toEqual(LIST[29]);
        expect(logs.at(-1)).toMatchObject({ m: 'skip: block full', d: { i: 27, from: 28, to: 29 } });
    });

    test('skipOccupied progress: only fresh fires count, an own log only where it was dropped', async () => {
        const { role, state } = fakeRole({ tiles: LIST.map(t => [t.x, t.z]), parts: 6, part: 0, skipOccupied: true });
        // A foreign fire already burning on log 0's tile when the dropper first looks.
        state.nearbyLocs = [{ name: 'Tree', x: 0, z: 0 }, { name: 'Fire', ...LIST[0]! }];
        await role.observe(state);
        role.placed.set(0, { slot: 1, tick: 1001 });
        role.dropped.set(0, 1001);
        state.groundItems = [{ name: 'Logs', ...LIST[1]! }];
        state.tick = 1100;
        await role.observe(state);
        expect(role.progress.lit).toBe(0);
        // Our log 0 lit on slot 1, the tile it was dropped on (seen clear since the first look).
        state.tick = 1120;
        state.nearbyLocs.push({ name: 'Fire', ...LIST[1]! });
        await role.observe(state);
        expect([role.progress.lit, role.litSlot]).toEqual([1, 1]);
    });

    test('cueAt written: a go file written 30 s ago at 300 ms a tick counts from 100 ticks back', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'fm-row-cue-'));
        writeFileSync(join(dir, GO_FILE), JSON.stringify({ v: 1, ms: Date.now() - 30_000 }));
        const { role, logs } = fakeRole({ start: 'cue', cueAt: 'written', tickMs: 300, cueDir: dir });
        expect(await role.trigger()).toBe(900);
        expect(logs.at(-1)).toMatchObject({ m: 'cue', d: { seenTick: 1000, cueTick: 900 } });
        const seen = fakeRole({ start: 'cue', cueDir: dir });
        expect(await seen.role.trigger()).toBe(1000);
    });

    describe('on a 0.35 s tick with a nominal 300 ms', () => {
        const T0 = 1_800_000_000_000;
        const cueDirAt = (go: Record<string, unknown>) => {
            const dir = mkdtempSync(join(tmpdir(), 'fm-row-cue-'));
            writeFileSync(join(dir, GO_FILE), JSON.stringify({ v: 1, ...go }));
            return dir;
        };

        test('a dropper logged in 20 s after the cue counts it back at the period it observed', async () => {
            setSystemTime(new Date(T0));
            try {
                // The cue was written 20 s before the dropper's tick 1000, which is 57 of its ticks back.
                const dir = cueDirAt({ ms: T0 - 20_000 });
                const { role, logs, publish, listeners } = fakeRole({ start: 'cue', cueAt: 'written', tickMs: 300, cueDir: dir });
                tickAt(publish, T0, 350, 100);
                // 55 s at 350 ms is 157 ticks; at the nominal 300 it would be 183, placing the cue 26 ticks early.
                expect(await role.trigger()).toBe(1100 - 157);
                expect(logs.at(-1)).toMatchObject({ m: 'cue', d: { seenTick: 1100, tickMs: 350, tickMsFrom: 'observed', observedTickMs: 350, nominalTickMs: 300, cueTick: 943 } });
                expect(listeners.size).toBe(0);
            } finally {
                setSystemTime();
            }
        });

        test('before 20 s of ticks: the writer\'s period if the go file has one, else nominal, and the log says which', async () => {
            setSystemTime(new Date(T0));
            try {
                const a = fakeRole({ start: 'cue', cueAt: 'written', tickMs: 300, cueDir: cueDirAt({ ms: T0 - 20_000, tickMs: 350 }) });
                tickAt(a.publish, T0, 350, 40);
                expect(await a.role.trigger()).toBe(1040 - 97);
                expect(a.logs.at(-1)).toMatchObject({ m: 'cue', d: { tickMs: 350, tickMsFrom: 'cue', observedTickMs: null, writerTickMs: 350 } });
                setSystemTime(new Date(T0));
                const b = fakeRole({ start: 'cue', cueAt: 'written', tickMs: 300, cueDir: cueDirAt({ ms: T0 - 20_000 }) });
                tickAt(b.publish, T0, 350, 40);
                expect(await b.role.trigger()).toBe(1040 - 113);
                expect(b.logs.at(-1)).toMatchObject({ m: 'cue', d: { tickMs: 300, tickMsFrom: 'nominal', observedTickMs: null, writerTickMs: null } });
            } finally {
                setSystemTime();
            }
        });

        test('a held dropper at the row triggers on the nominal period, then places the cue again once it has 20 s of ticks', async () => {
            setSystemTime(new Date(T0));
            try {
                const { role, logs, publish, listeners } = fakeRole({ start: 'cue', cueAt: 'written', tickMs: 300, cueDir: cueDirAt({ ms: T0 - 20_000 }) });
                tickAt(publish, T0, 350, 10);
                // 23.5 s since the cue: 78 nominal ticks, 67 observed ones.
                const t = await role.trigger();
                expect(t).toBe(1010 - 78);
                role.start = role.startOf(t);
                role.refineCue();
                expect(role.start).toBe(1010 - 78 + 105);
                expect(listeners.size).toBe(1);
                for (let k = 11; k <= 70; k++) {
                    setSystemTime(new Date(T0 + 350 * k));
                    publish(1000 + k);
                }
                role.refineCue();
                expect(role.start).toBe(1010 - 67 + 105);
                expect(logs.slice(-2)).toMatchObject([
                    { m: 'cue: refined', d: { seenTick: 1010, seenMs: T0 + 3_500, tickMs: 350, tickMsFrom: 'observed', cueTick: 943 } },
                    { m: 'start', d: { logZeroDue: 1048, was: 1037 } }
                ]);
                expect(listeners.size).toBe(0);
                // Placed on an observed period, it stays put.
                role.refineCue();
                expect(logs.at(-1)!.m).toBe('start');
            } finally {
                setSystemTime();
            }
        });

        test('cueAt seen is unchanged: it starts on the tick it sees the go file and watches no ticks', async () => {
            setSystemTime(new Date(T0));
            try {
                const { role, logs, publish, listeners } = fakeRole({ start: 'cue', tickMs: 300, cueDir: cueDirAt({ ms: T0 - 20_000, tickMs: 350 }) });
                expect(listeners.size).toBe(0);
                tickAt(publish, T0, 350, 100);
                expect(await role.trigger()).toBe(1100);
                expect(logs.some(l => l.m === 'cue')).toBe(false);
            } finally {
                setSystemTime();
            }
        });
    });
});

// ------------------------------------------------------------------ rs/228's lab: the 51-tile lapped row

const run = (x0: number, x1: number, z: number) => Array.from({ length: Math.abs(x1 - x0) + 1 }, (_, n) => ({ x: x0 + Math.sign(x1 - x0) * n, z }));
/** `3222-3218@3219;3218-3243@3218;3242-3223@3219`, confirmed in the lab: every gap a 4-tick chain. */
const ROW51 = [...run(3222, 3218, 3219), ...run(3218, 3243, 3218), ...run(3242, 3223, 3219)];
const ROW51_OPTS = { tiles: ROW51.map(t => [t.x, t.z]), parts: 6 };

describe('lapped row: a held dropper that logs in late', () => {
    const plan51 = rowPlan(ROW51);
    const own5 = ownLogs(157, 5, 6);
    // Inventory 3's logs 95-99, down and not lit yet, lie on the tiles of part 5's logs 146-150.
    const foreign = [95, 96, 97, 98, 99].map(i => ({ name: 'Magic logs', ...plan51[i]!.tile }));

    test('resumeCursor: still carrying its whole load, it has dropped nothing, whatever lies on its tiles', () => {
        expect(ROW51).toHaveLength(51);
        expect(plan51[146]!.tile).toEqual(plan51[95]!.tile);
        // From the ground alone the other droppers' logs read as its own.
        expect(resumeCursor(plan51, own5, foreign)).toBe(11);
        const holds = (n: number) => (tier: { name: string }) => (tier.name === 'Magic logs' ? n : 0);
        // 17 logs plus spares, or exactly 17.
        expect(resumeCursor(plan51, own5, foreign, holds(21))).toBe(0);
        expect(resumeCursor(plan51, own5, foreign, holds(17))).toBe(0);
        // Some already dropped: a real restart, resumed from the ground as before.
        expect(resumeCursor(plan51, own5, foreign, holds(10))).toBe(11);
    });

    test('the role takes the fresh-start path (arm, held check, cue) instead of `resume`', async () => {
        const { role, state, logs } = fakeRole({ ...ROW51_OPTS, part: 5, restock: { kind: 'held' }, start: 'cue', cueAt: 'written' });
        state.groundItems = foreign;
        state.inventory = Array.from({ length: 21 }, (_, slot) => ({ name: 'Magic logs', count: 1, slot }));
        expect(await role.resume()).toBe(false);
        expect(role.cursor).toBe(0);
        expect(logs.map(l => l.m)).not.toContain('resume');
        // Not a held dropper: the ground decides, as before.
        const bank = fakeRole({ ...ROW51_OPTS, part: 5 });
        bank.state.groundItems = foreign;
        bank.state.inventory = state.inventory;
        expect(await bank.role.resume()).toBe(true);
        expect(bank.logs.at(-1)).toMatchObject({ m: 'resume', d: { cursor: 11 } });
    });
});

describe('lapped row: skipOccupied and the last lap’s fire', () => {
    test('fireOutBy: a fire seen lit at F is out for a log needed at F + 200 or later; unseen starts never are', () => {
        expect(FIRE_OUT_TICKS).toBe(200);
        expect(fireOutBy(900, 1100)).toBe(true);
        expect(fireOutBy(900, 1099)).toBe(false);
        expect(fireOutBy(null, 1_000_000)).toBe(false);
        const t = { x: 3230, z: 3218 };
        expect(occupied(t, [{ name: 'Fire', ...t }], [], true)).toBe(false);
        expect(occupied(t, [{ name: 'Fire', ...t }], [{ name: 'Bones', ...t }], true)).toBe(true);
    });

    async function litAt(lit: number, start: number) {
        const f = fakeRole({ ...ROW51_OPTS, part: 0, skipOccupied: true, spareTiles: 0 });
        f.state.player = { worldX: ROW51[0]!.x, worldZ: ROW51[0]!.z };
        // The dropper watches log 0's tile clear, then sees the last lap's fire lit on it.
        f.state.tick = lit - 10;
        await f.role.observe(f.state);
        f.state.nearbyLocs = [...f.state.nearbyLocs, { name: 'Fire', ...ROW51[0]! }];
        f.state.tick = lit;
        await f.role.observe(f.state);
        f.state.tick = lit + 100;
        f.role.start = start;
        return f;
    }

    test('a fire it saw lit 200 ticks before the log is needed takes the log; a younger one is skipped', async () => {
        const out = await litAt(900, 1100);
        expect(out.role.ledger.freshSince(ROW51[0])).toBe(900);
        expect(out.role.chooseTile(0, out.state)).toEqual(ROW51[0]);
        expect(out.logs.map(l => l.m)).not.toContain('skip');
        const young = await litAt(900, 1099);
        expect(young.role.chooseTile(0, young.state)).toEqual(ROW51[1]);
        expect(young.logs.at(-1)).toMatchObject({ m: 'skip', d: { i: 0, from: 0, to: 1 } });
    });

    test('a fire already burning when first seen stays occupied', async () => {
        const f = fakeRole({ ...ROW51_OPTS, part: 0, skipOccupied: true, spareTiles: 0 });
        f.state.player = { worldX: ROW51[0]!.x, worldZ: ROW51[0]!.z };
        f.state.nearbyLocs = [{ name: 'Tree', x: 0, z: 0 }, { name: 'Fire', ...ROW51[0]! }];
        await f.role.observe(f.state);
        f.role.start = 1_000_000;
        expect(f.role.chooseTile(0, f.state)).toEqual(ROW51[1]);
    });

    test('shortestRevisit: spares bring a 51-lap round in 47 logs; spareTiles 0 there, or 1 on a 53-lap, keeps 51', () => {
        expect(shortestRevisit(plannedTiles(ROW51, 6, 2))).toBe(47);
        expect(ROLL_TICKS * 47).toBeLessThan(FIRE_OUT_TICKS);
        expect(shortestRevisit(plannedTiles(ROW51, 6, 0))).toBe(51);
        const ROW53 = [...ROW51, { x: 3222, z: 3220 }, { x: 3222, z: 3221 }];
        expect(shortestRevisit(plannedTiles(ROW53, 6, 1))).toBe(51);
        // S03's default snake comes round in 54.
        expect(shortestRevisit(plannedTiles(LAB_ROW, 1, 0))).toBe(54);
        expect(shortestRevisit(plannedTiles(LIST.slice(0, 1).concat(Array.from({ length: 200 }, (_, n) => ({ x: n, z: 0 }))), 1, 0))).toBeNull();
    });
});


describe('logs: an explicit log list in place of the route', () => {
    test('the default plan is the route, identical to rowPlan with S03_LOGS', () => {
        const o = fmRowOptions({}, {});
        expect(o.logs).toBe(ROUTE_LOGS);
        expect(JSON.stringify(rowPlan(LAB_ROW, o.logs))).toBe(JSON.stringify(rowPlan(LAB_ROW, ROUTE_LOGS)));
        expect(rowPlan(LAB_ROW, o.logs)).toHaveLength(157);
    });

    test('[{obj: logs, n: 20}] plans 20 normal logs along the path, one inventory', () => {
        const o = fmRowOptions({ logs: [{ obj: 'logs', n: 20 }] }, {});
        const plan = rowPlan(LAB_ROW, o.logs);
        expect(plan).toHaveLength(20);
        expect(plan.every(l => l.tier.obj === 'logs' && l.tier.name === 'Logs')).toBe(true);
        expect(plan.map(l => l.slot)).toEqual([...Array(20).keys()]);
        expect(loadFor(plan, ownLogs(plan.length, 0, 1), 0)).toEqual([{ tier: plan[0]!.tier, n: 20 }]);
        const mixed = rowPlan(LAB_ROW, fmRowOptions({ logs: [{ obj: 'logs', n: 2 }, { obj: 'oak_logs', n: 3 }] }, {}).logs);
        expect(mixed.map(l => l.tier.obj)).toEqual(['logs', 'logs', 'oak_logs', 'oak_logs', 'oak_logs']);
    });

    test('a bad obj or n throws', () => {
        expect(() => fmRowOptions({ logs: [{ obj: 'teak_logs', n: 5 }] }, {})).toThrow(/logs\[0\]\.obj/);
        expect(() => fmRowOptions({ logs: [{ obj: 'logs', n: 0 }] }, {})).toThrow(/logs\[0\]\.n/);
        expect(() => fmRowOptions({ logs: [{ obj: 'logs', n: 2.5 }] }, {})).toThrow(/logs\[0\]\.n/);
        expect(() => fmRowOptions({ logs: [{ obj: 'logs' }] }, {})).toThrow(/logs\[0\]\.n/);
        expect(() => fmRowOptions({ logs: [] }, {})).toThrow(/non-empty/);
        expect(() => fmRowOptions({ logs: { obj: 'logs', n: 20 } }, {})).toThrow(/non-empty/);
    });

    test('parts = 2 splits a list by inventory: 20 logs are one inventory, so part 1 owns none and is refused', () => {
        expect(ownLogs(20, 0, 2)).toEqual([...Array(20).keys()]);
        expect(fmRowOptions({ logs: [{ obj: 'logs', n: 20 }], parts: 2, part: 0 }, {}).parts).toBe(2);
        expect(() => fmRowOptions({ logs: [{ obj: 'logs', n: 20 }], parts: 2, part: 1 }, {})).toThrow(/owns no logs/);
        expect(ownLogs(40, 0, 2)).toHaveLength(28);
        expect(ownLogs(40, 1, 2)).toEqual([...Array(12).keys()].map(k => 28 + k));
        expect(fmRowOptions({ logs: [{ obj: 'logs', n: 40 }], parts: 2, part: 1, restock: { kind: 'held' } }, {}).restock.kind).toBe('held');
    });
});
