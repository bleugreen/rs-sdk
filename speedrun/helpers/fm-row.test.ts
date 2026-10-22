import { describe, expect, test } from 'bun:test';

import {
    advance,
    dropTarget,
    earliestDrop,
    fmRowOptions,
    inventoryOf,
    LAB_ROW,
    latestDrop,
    loadFor,
    maxRestockTicks,
    NO_PROGRESS,
    needTick,
    ownLogs,
    REVEAL_TICKS,
    resumeCursor,
    rowPlan,
    snakeTile,
    type Pace,
    type Progress
} from './fm-row';

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
