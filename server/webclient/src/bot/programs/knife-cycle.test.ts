import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { type Axe, AXES, axeOf, catchChance, createKnifeCycle, CYCLE_METHODS, lockWindow, SHAFTS_BUTTON, TREE_CHANCE } from './knife-cycle.js';
import { Harness, makeState, type StateSpec } from './testkit.js';
import { statRandom } from './util.js';

/**
 * A deterministic stand-in for the engine's gathering loop (tick-manipulation.md
 * section 5): a click on an idle player rolls r0 ticks after it lands; each roll
 * re-arms the next one plainCycle later; a knife starter landing on R+1 pulls the
 * next roll to R+3. The knife sets the clock 2 ahead, and a click landing on that
 * tick rolls at once. A bury clears the interaction, rejects every packet on the
 * next tick and gives its Prayer xp then (bones-placement.md section 2). Packets
 * sent on label c land on c + latency.
 */
function serverRun(opts: {
    method: 'willow' | 'oak' | 'fly' | 'tree';
    technique?: 'knife' | 'plain';
    ticks: number;
    latency?: (n: number) => number;
    params?: Record<string, unknown>;
    inventory?: string[];
    /** Dragon bones added to the inventory. */
    bones?: number;
    /** A non-depleting tree falls on every Nth roll and another one stands. */
    fellEvery?: number;
    /** Ticks after such a fall with no live tree at all (every reachable tree down). */
    allDownFor?: number;
    spotMovesAt?: number;
    dialogAt?: number;
    logsGoneAt?: number;
    /** Ticks a felled tree stays listed after its log (the browser shows it one more tick). */
    fellLag?: number;
    /** Tree tiles that never yield (out of reach). */
    deadTrees?: number;
    /** Labels the page never sees on their own: decoded together with the next (server overrun). */
    merged?: (tick: number) => boolean;
    /** The skill's level (99 if not given). */
    level?: number;
    /** An axe added to the inventory, and items worn. */
    axe?: string;
    equipment?: string[];
    /** Rolls (counted from 1) that fail: the cadence goes on, no xp and no log. */
    miss?: (roll: number) => boolean;
}) {
    const m = CYCLE_METHODS[opts.method]!;
    const skill = m.skill === 'fishing' ? 'Fishing' : 'Woodcutting';
    const h = new Harness('cycle', createKnifeCycle);
    let tick = 1000;
    let xp = 0;
    let nextRoll: number | null = null;
    let lastRoll = -100;
    let interacting = false;
    let spotX = 3201;
    let treeId = 1;
    let felledAt: number | null = null;
    let clickedTree = 0;
    let dialog = false;
    let clock = -1;
    let downUntil = -1;
    let delayedOn = -1;
    let prayerXp = 0;
    let buryXpOn = -1;
    const pending: Array<{ at: number; type: string; locId?: number }> = [];
    let rolls = 0;
    const rollTicks: number[] = [];
    const buryTicks: number[] = [];
    const inventory: Array<string | { name: string; options: string[] }> = [
        ...(opts.inventory ?? ['Knife', 'Logs', 'Logs', 'Logs', 'Logs', 'Logs']),
        ...(opts.axe ? [opts.axe] : []),
        ...Array.from({ length: opts.bones ?? 0 }, () => ({ name: 'Dragon bones', options: ['Bury', 'Drop'] }))
    ];
    const treeName = opts.method === 'tree' ? 'Tree' : opts.method === 'oak' ? 'Oak' : 'Willow';
    // successive trees stand on alternating tiles, so a fallen one still listed keeps its own tile
    const treeX = (id: number) => 3201 + (id % 2);
    const spec = (): StateSpec => ({
        tick,
        skills: { [skill]: { xp, level: opts.level }, Prayer: { xp: prayerXp } },
        inventory,
        equipment: opts.equipment,
        animId: interacting ? 1 : -1,
        dialogOpen: dialog,
        npcs: m.kind === 'npc' ? [{ index: 7, name: 'Fishing spot', x: spotX, z: 3200, options: ['Lure', 'Bait'] }] : [],
        locs: m.kind === 'loc'
            ? [
                ...Array.from({ length: opts.deadTrees ?? 0 }, (_, i) => ({ id: 900 + i, x: 3200, z: 3200 + i, name: treeName, options: ['Chop down'] })),
                ...(tick > downUntil ? [{ id: treeId, x: treeX(treeId), z: 3204, name: treeName, options: ['Chop down'] }] : []),
                ...(felledAt !== null ? [{ id: treeId - 1, x: treeX(treeId - 1), z: 3204, name: treeName, options: ['Chop down'] }] : [])
            ]
            : []
    });
    h.start('cycle', { method: opts.method, technique: opts.technique ?? 'knife', maxTicks: opts.ticks, ...opts.params }, makeState(spec()));
    let n = 0;
    let skipped = 0;
    for (let i = 0; i < opts.ticks + 50 && h.status.phase === 'running'; i++) {
        tick++;
        // packets landing this tick, in the order sent
        let starter = false;
        if (buryXpOn === tick) {
            prayerXp += 72 * 25;
            buryTicks.push(tick);
            inventory.splice(inventory.findIndex(i => typeof i !== 'string' && i.name === 'Dragon bones'), 1);
        }
        for (const p of pending.filter(p => p.at === tick)) {
            if (tick === delayedOn) continue; // p_delay(0) after a bury: every packet is rejected
            if (p.type === 'useItemOnItem' || p.type === 'dropItem' || p.type === 'useInventoryItem') interacting = false; // inventory ops clear the interaction
            if (p.type === 'useItemOnItem') clock = tick + 2;
            if (p.type === 'useItemOnItem' && tick === lastRoll + 1) starter = true;
            if (p.type === 'useInventoryItem') {
                delayedOn = tick + 1;
                buryXpOn = tick + 1;
            }
            if (p.type === 'clickDialogOption') dialog = false;
            if (p.type === 'interactLoc' && (p.locId !== treeId || tick <= downUntil)) {
                interacting = false; // a dead or felled tree: nothing happens
                continue;
            }
            if (p.type === 'interactLoc') dialog = false; // OpLocHandler closes a level-up page
            if (p.type === 'interactLoc' || p.type === 'interactNpc') {
                interacting = true;
                clickedTree++;
                if (starter) nextRoll = lastRoll + 3;
                else if (clock === tick) nextRoll = tick; // the first-click label rolls at once on a due clock
                else if (nextRoll === null || nextRoll < tick) nextRoll = tick + m.r0;
            }
        }
        if (opts.spotMovesAt === tick) { spotX = 3205; interacting = false; nextRoll = null; }
        if (opts.dialogAt === tick) dialog = true;
        if (opts.logsGoneAt === tick) inventory.splice(0, inventory.length, 'Knife');
        if (felledAt !== null && tick > felledAt + (opts.fellLag ?? 0)) felledAt = null;
        if (interacting && nextRoll === tick) {
            lastRoll = tick;
            nextRoll = tick + m.plainCycle;
            if (!opts.miss?.(++rolls)) {
                xp += 500;
                rollTicks.push(tick);
                if (m.depletes || (opts.fellEvery && rollTicks.length % opts.fellEvery === 0)) {
                    treeId++;
                    interacting = false;
                    nextRoll = null;
                    if (opts.fellLag) felledAt = tick;
                    if (opts.allDownFor && !m.depletes) downUntil = tick + opts.allDownFor;
                }
            }
        }
        if (opts.merged?.(tick)) { skipped++; continue; }
        for (const s of h.step(makeState(spec()), 1 + skipped)) pending.push({ at: tick + (opts.latency?.(n++) ?? 1), type: s.action.type, locId: (s.action as { locId?: number }).locId });
        skipped = 0;
    }
    return { h, rollTicks, buryTicks };
}

const gapsOf = (ticks: number[]) => ticks.slice(1).map((t, i) => t - ticks[i]!);

describe('knife cycle', () => {
    test('willow: locks on the first roll and then rolls every 3 ticks', () => {
        const { h, rollTicks } = serverRun({ method: 'willow', ticks: 200 });
        const gaps = gapsOf(rollTicks);
        // the first gap is the plain continuation the anchor waits for, then 3s
        expect(gaps.slice(1).every(g => g === 3)).toBe(true);
        expect(rollTicks.length).toBeGreaterThan(60);
        expect(h.status.result).toMatchObject({ resyncs: 0 });
        expect((h.status.result as { ticksPerSuccess: number }).ticksPerSuccess).toBeLessThan(3.05);
        // no axe in the pack: no catch chance, so no expected-roll figure is claimed
        const r = h.status.result as { ticksPerExpectedRoll: number; axe: string | null };
        expect(r.axe).toBeNull();
        expect(Number.isNaN(r.ticksPerExpectedRoll)).toBe(true);
        expect(h.status.gauges).not.toHaveProperty('ticksPerExpectedRoll');
    });

    test('willow with a rune axe reports ticks per expected roll at the rune chance', () => {
        // rune on willow at 60: floor(56*39/98) + floor(175*59/98) + 1 = 128, so p = 1/2
        const { h } = serverRun({ method: 'willow', ticks: 200, level: 60, axe: 'Rune axe' });
        const r = h.status.result as { ticksPerSuccess: number; ticksPerExpectedRoll: number; axe: string; resyncs: number };
        expect(r).toMatchObject({ axe: 'rune', resyncs: 0 });
        expect(r.ticksPerExpectedRoll).toBeCloseTo(r.ticksPerSuccess / 2, 2);
        expect(h.status.gauges.ticksPerExpectedRoll).toBe(r.ticksPerExpectedRoll);
    });

    test('a worn axe counts, and the best axe worn or carried is the one used', () => {
        const { h } = serverRun({ method: 'oak', ticks: 60, level: 60, axe: 'Bronze axe', equipment: ['Adamant axe'] });
        const r = h.status.result as { ticksPerSuccess: number; ticksPerExpectedRoll: number; axe: string };
        expect(r.axe).toBe('adamant');
        expect(r.ticksPerExpectedRoll).toBeCloseTo(r.ticksPerSuccess * catchChance(CYCLE_METHODS.oak!, 60, 'adamant')!, 2);
    });

    test('bronze on oak at 60: ten honest misses in a row keep the lock; the old 18-tick window called them a lost lock', () => {
        const miss = (r: number) => r >= 20 && r < 30;
        const sized = serverRun({ method: 'oak', ticks: 200, level: 60, axe: 'Bronze axe', miss });
        expect(lockWindow(CYCLE_METHODS.oak!, 60, 'bronze')).toBe(48);
        expect(sized.h.status.result).toMatchObject({ resyncs: 0 });
        expect(sized.h.status.counters.slips ?? 0).toBe(0);
        // the lattice holds through the misses: one 33-tick gap, 3s otherwise
        expect(gapsOf(sized.rollTicks).slice(1).filter(g => g !== 3)).toEqual([33]);
        const fixed = serverRun({ method: 'oak', ticks: 200, level: 60, axe: 'Bronze axe', miss, params: { window: 18 } });
        expect(fixed.h.status.counters.slips).toBeGreaterThanOrEqual(1);
    });

    test('the starter bundle goes out on the label that shows the roll, in order', () => {
        const { h, rollTicks } = serverRun({ method: 'willow', ticks: 40 });
        const r = rollTicks[3]!;
        const bundle = h.sent.filter(s => s.tick === r).map(s => s.action);
        expect(bundle.map(a => a.type)).toEqual(['useItemOnItem', 'clickComponent', 'interactLoc']);
        expect(bundle[1]).toMatchObject({ componentId: SHAFTS_BUTTON });
        // nothing between rolls
        expect(h.sent.filter(s => s.tick === r + 1 || s.tick === r + 2)).toHaveLength(0);
    });

    test('fly: 3-tick cycle after a 5-tick first gap', () => {
        const { rollTicks } = serverRun({ method: 'fly', ticks: 150 });
        const gaps = gapsOf(rollTicks);
        expect(gaps[0]).toBe(5);
        expect(gaps.slice(1).every(g => g === 3)).toBe(true);
    });

    test('drops one product per starter, ahead of the click', () => {
        const { h, rollTicks } = serverRun({ method: 'fly', ticks: 40, inventory: ['Knife', 'Logs', 'Raw trout', 'Raw trout'] });
        const r = rollTicks[2]!;
        expect(h.sent.filter(s => s.tick === r).map(s => s.action.type)).toEqual(['useItemOnItem', 'clickComponent', 'dropItem', 'interactNpc']);
    });

    test('a level-up dialog is answered first and the bundle still fits the 5-packet budget', () => {
        const { h, rollTicks } = serverRun({ method: 'fly', ticks: 60, dialogAt: 1020, inventory: ['Knife', 'Logs', 'Raw trout', 'Raw trout'] });
        const r = rollTicks.find(t => t >= 1020)!;
        expect(h.sent.filter(s => s.tick === r).map(s => s.action.type)).toEqual(['clickDialogOption', 'useItemOnItem', 'clickComponent', 'dropItem', 'interactNpc']);
        expect(h.status.deferred).toBe(0);
    });

    test('a spot move re-anchors on the next catch and locks again', () => {
        const { h, rollTicks } = serverRun({ method: 'fly', ticks: 200, spotMovesAt: 1060 });
        expect(h.status.result).toMatchObject({ moves: 1, resyncs: 1 });
        const after = rollTicks.filter(t => t > 1075);
        expect(gapsOf(after).slice(1).every(g => g === 3)).toBe(true);
    });

    test('a late starter costs one roll: the off-phase roll re-anchors the schedule', () => {
        // one starter bundle lands a tick late
        const { h, rollTicks } = serverRun({ method: 'willow', ticks: 200, latency: n => (n >= 60 && n < 63 ? 2 : 1) });
        expect(h.status.counters.phaseResyncs).toBe(1);
        const gaps = gapsOf(rollTicks).slice(1);
        // one plain-length gap where the starter was late, 3s otherwise
        expect(gaps.filter(g => g !== 3)).toEqual([4]);
    });

    test('hold: a held starter bundle goes out whole on the next label; hold 0 sends exactly what no hold sends', () => {
        const plain = serverRun({ method: 'willow', ticks: 120 });
        expect(serverRun({ method: 'willow', ticks: 120, params: { hold: 0 } }).h.timeline()).toEqual(plain.h.timeline());
        const held = serverRun({ method: 'willow', ticks: 120, params: { hold: 1 } });
        const first = plain.h.sent.find(s => s.action.type === 'useItemOnItem')!.tick;
        expect(held.h.sent.filter(s => s.tick === first)).toHaveLength(0);
        expect(held.h.sent.filter(s => s.tick === first + 1).map(s => s.action.type)).toEqual(['useItemOnItem', 'clickComponent', 'interactLoc']);
        expect(held.h.status.counters.held).toBe(held.h.status.counters.starters);
        expect(held.rollTicks.length).toBeLessThan(plain.rollTicks.length);
    });

    test('two ticks decoded at once (a skipped starter label) re-lock on the next roll', () => {
        const skips = new Set([1040, 1100, 1160]);
        const { h, rollTicks } = serverRun({ method: 'fly', ticks: 220, merged: t => skips.has(t) });
        expect(h.status.skippedTicks).toBe(3);
        const gaps = gapsOf(rollTicks).slice(1);
        expect(gaps.filter(g => g !== 3).length).toBeLessThanOrEqual(3);
        expect(rollTicks.length).toBeGreaterThan(60);
    });

    test('normal trees: each log starts the next tree with a starter bundle on the same label', () => {
        const { h, rollTicks } = serverRun({ method: 'tree', ticks: 120 });
        expect(rollTicks.length).toBeGreaterThan(20);
        const r = rollTicks[2]!;
        // the product is the knife's own log: three are kept for the starter, the rest dropped
        expect(h.sent.filter(s => s.tick === r).map(s => s.action.type)).toEqual(['useItemOnItem', 'clickComponent', 'dropItem', 'interactLoc']);
    });

    test('starting without logs is a fault the step script must fix', () => {
        const { h, rollTicks } = serverRun({ method: 'willow', ticks: 80, inventory: ['Knife'] });
        expect(h.status.phase).toBe('fault');
        expect(h.status.fault).toContain('logs');
        expect(rollTicks.length).toBe(0);
    });

    test('normal trees: a felled tree still listed for a tick is not clicked again', () => {
        const { h, rollTicks } = serverRun({ method: 'tree', ticks: 120, fellLag: 1 });
        expect(rollTicks.length).toBeGreaterThan(20);
        expect(h.status.result).toMatchObject({ resyncs: 0 });
        // every log after the first is started by a starter bundle on the label that shows it
        expect((h.status.result as { starters: number }).starters).toBeGreaterThanOrEqual(rollTicks.length - 1);
    });

    test('ticks per expected roll weights each success by the catch chance at its level', () => {
        // every roll in the stand-in succeeds; the harness level is 99, where bronze's p is 201/256
        const { h } = serverRun({ method: 'tree', ticks: 120, axe: 'Bronze axe' });
        const r = h.status.result as { ticksPerSuccess: number; ticksPerExpectedRoll: number };
        const p = catchChance(CYCLE_METHODS.tree!, 99, 'bronze')!;
        expect(p).toBe(201 / 256);
        expect(r.ticksPerExpectedRoll).toBeCloseTo(r.ticksPerSuccess * p, 2);
        expect(r.ticksPerExpectedRoll).toBeLessThan(r.ticksPerSuccess);
        expect(h.status.gauges.ticksPerExpectedRoll).toBe(r.ticksPerExpectedRoll);
    });

    test('a tree that yields nothing is avoided and the next one is tried', () => {
        const { rollTicks } = serverRun({ method: 'tree', ticks: 200, deadTrees: 2 });
        expect(rollTicks.length).toBeGreaterThan(10);
    });

    test('falls back to the plain loop when the logs run out mid-run', () => {
        const { h, rollTicks } = serverRun({ method: 'willow', ticks: 120, logsGoneAt: 1040 });
        expect(h.status.counters.fellBack).toBe(1);
        expect(h.status.result).toMatchObject({ technique: 'knife->plain', fellBack: 'out of logs' });
        expect(gapsOf(rollTicks.filter(t => t > 1060)).every(g => g === 4)).toBe(true);
    });

    test('plain technique clicks once and rolls on the plain cycle', () => {
        const { h, rollTicks } = serverRun({ method: 'willow', technique: 'plain', ticks: 100, inventory: [] });
        expect(gapsOf(rollTicks).every(g => g === 4)).toBe(true);
        expect(h.sent.filter(s => s.action.type === 'interactLoc')).toHaveLength(1);
    });

    test('every success is stamped in the status as it happens', () => {
        // a scripted stream: xp on chosen ticks, the status read after every tick
        const h = new Harness('cycle', createKnifeCycle);
        const xpOn = new Set([1005, 1009, 1012, 1015, 1021]);
        const state = (tick: number, xp: number) => makeState({ tick, skills: { Woodcutting: { xp } }, inventory: ['Knife', 'Logs', 'Logs'], locs: [{ id: 1, x: 3201, z: 3204, name: 'Willow', options: ['Chop down'] }] });
        let xp = 0;
        h.start('cycle', { method: 'willow', maxTicks: 100 }, state(1000, xp));
        const seen: number[] = [];
        for (let t = 1001; t <= 1025; t++) {
            if (xpOn.has(t)) {
                xp += 500;
                seen.push(t);
            }
            h.step(state(t, xp));
            expect(h.status.phase).toBe('running');
            expect(h.status.marks.successes ?? { count: 0, ticks: [] }).toEqual({ count: seen.length, ticks: seen });
        }
        expect(h.status.counters.successes).toBe(5);
    });

    test('ends after the requested successes with a summary', () => {
        const { h } = serverRun({ method: 'willow', ticks: 500, params: { successes: 20 } });
        expect(h.status.phase).toBe('done');
        expect(h.status.result).toMatchObject({ successes: 20, technique: 'knife' });
        expect(h.status.counters.successes).toBe(20);
    });

    test('rejects a start with no end condition or an unknown method', () => {
        expect(() => createKnifeCycle({ method: 'willow' })).toThrow(/give successes/);
        expect(() => createKnifeCycle({ method: 'nope', successes: 5 })).toThrow(/unknown method/);
    });

    test('a tree that falls on a roll keeps the lock: the bundle clicks a live one', () => {
        const { h, rollTicks } = serverRun({ method: 'oak', ticks: 200, fellEvery: 8 });
        expect(h.status.result).toMatchObject({ resyncs: 0 });
        expect((h.status.result as { switches: number }).switches).toBeGreaterThanOrEqual(7);
        expect(gapsOf(rollTicks).slice(1).every(g => g === 3)).toBe(true);
    });

    test('a fallen tree still listed for a tick: the cycle re-clicks a live one before the roll', () => {
        const { h, rollTicks } = serverRun({ method: 'oak', ticks: 200, fellEvery: 8, fellLag: 1 });
        expect(h.status.result).toMatchObject({ resyncs: 0 });
        expect(gapsOf(rollTicks).slice(1).every(g => g === 3)).toBe(true);
        // the fallen tree is listed on R and R+1, so it is seen gone on R+2 and the re-click
        // goes out then, alone, landing on the roll tick itself
        const fell = rollTicks[7]!;
        expect(h.sent.filter(s => s.tick === fell + 1)).toHaveLength(0);
        expect(h.sent.filter(s => s.tick === fell + 2).map(s => s.action.type)).toEqual(['interactLoc']);
    });

    test('every tree down: no starter goes out (it would fletch the log), and the lock resumes on the respawn', () => {
        const { h, rollTicks } = serverRun({ method: 'oak', ticks: 200, fellEvery: 8, allDownFor: 5 });
        const fell = rollTicks[7]!;
        const knives = h.sent.filter(s => s.action.type === 'useItemOnItem' && s.tick > fell && s.tick <= fell + 5);
        expect(knives).toHaveLength(0);
        expect(h.status.counters.noTarget).toBeGreaterThan(0);
        expect(h.status.result).not.toHaveProperty('fellBack');
        // locked again between the respawn and the next fall (roll 16)
        const relocked = rollTicks.slice(9, 16);
        expect(relocked[0]! - fell).toBeLessThan(20);
        expect(gapsOf(relocked).every(g => g === 3)).toBe(true);
    });

    test('the lost-lock window scales with the catch chance', () => {
        expect(lockWindow(CYCLE_METHODS.fly!, 99)).toBe(15);
        expect(lockWindow(CYCLE_METHODS.fly!, 20)).toBeGreaterThan(15);
        // no axe: no chance, the preset's window
        expect(lockWindow(CYCLE_METHODS.willow!, 30)).toBe(18);
    });
});

/** trees.dbrow's successchance rows, by preset name. */
function contentTreeTable(): Record<'tree' | 'oak' | 'willow', Record<string, [number, number]>> {
    const text = readFileSync(new URL('../../../../content/scripts/skill_woodcutting/configs/trees.dbrow', import.meta.url), 'utf8');
    const rows: Record<string, Record<string, [number, number]>> = {};
    for (const block of text.split(/\n(?=\[)/)) {
        const name = /^\[(\w+)\]/.exec(block)?.[1];
        if (!name) continue;
        rows[name] = Object.fromEntries([...block.matchAll(/^data=successchance,(\w+)_axe,(\d+),(\d+)$/gm)].map(m => [m[1]!, [Number(m[2]), Number(m[3])] as [number, number]]));
    }
    return { tree: rows.normal_tree_table!, oak: rows.oak_tree_table!, willow: rows.willow_tree_table! };
}

describe('knife cycle: catch chance from the axe', () => {
    const content = contentTreeTable();
    const trees = ['tree', 'oak', 'willow'] as const;

    test('the presets carry trees.dbrow for every axe', () => {
        for (const tree of trees) {
            expect(Object.keys(content[tree]).sort()).toEqual([...AXES].sort());
            expect(TREE_CHANCE[tree]).toEqual(content[tree] as Record<Axe, [number, number]>);
            expect(CYCLE_METHODS[tree]!.catchChance).toBe(TREE_CHANCE[tree]);
        }
    });

    test('p(L) for every axe on tree, oak and willow at levels 1, 50 and 99, from the content bounds', () => {
        // stat_random: floor(lo*(99-L)/98) + floor(hi*(L-1)/98) + 1 out of 256 (PlayerOps.ts STAT_RANDOM)
        for (const tree of trees) {
            for (const [axe, [lo, hi]] of Object.entries(content[tree]) as Array<[Axe, [number, number]]>) {
                const p = (L: number) => catchChance(CYCLE_METHODS[tree]!, L, axe)!;
                expect(p(1) * 256).toBe(lo + 1);
                // a value over 256 always beats the 0..255 draw (rune on a normal tree from about 48)
                expect(p(50) * 256).toBe(Math.min(Math.floor(lo / 2) + Math.floor(hi / 2) + 1, 256));
                expect(p(99) * 256).toBe(Math.min(hi + 1, 256));
            }
        }
        // the figures quoted for rs/130's oak run and the rune willow lab run
        expect(catchChance(CYCLE_METHODS.oak!, 60, 'bronze')).toBe(73 / 256);
        expect(catchChance(CYCLE_METHODS.willow!, 60, 'rune')).toBe(128 / 256);
    });

    test('the lock window is 3k ticks for the least k misses at or under 0.5%, never below the preset', () => {
        expect(lockWindow(CYCLE_METHODS.oak!, 60, 'bronze')).toBe(48);
        expect(lockWindow(CYCLE_METHODS.willow!, 60, 'rune')).toBe(24);
        expect(lockWindow(CYCLE_METHODS.willow!, 30, 'bronze')).toBeGreaterThan(lockWindow(CYCLE_METHODS.willow!, 30, 'rune'));
        for (const tree of trees) {
            const m = CYCLE_METHODS[tree]!;
            for (const axe of AXES) {
                for (const L of [1, 15, 30, 45, 60, 75, 99]) {
                    const w = lockWindow(m, L, axe);
                    const q = 1 - catchChance(m, L, axe)!;
                    expect(w % 3).toBe(0);
                    if (w > m.lockWindow) {
                        expect(q ** (w / 3)).toBeLessThanOrEqual(0.005);
                        expect(q ** (w / 3 - 1)).toBeGreaterThan(0.005);
                    } else {
                        expect(w).toBe(m.lockWindow);
                        expect(q ** (m.lockWindow / 3)).toBeLessThanOrEqual(0.005);
                    }
                }
            }
            // no axe worn or carried: no chance, the preset's window
            expect(catchChance(m, 60)).toBeUndefined();
            expect(lockWindow(m, 60)).toBe(m.lockWindow);
        }
    });

    test('regression: bronze on normal trees keeps the chance and window the preset had', () => {
        for (let L = 1; L <= 99; L++) {
            const p = statRandom(L, 64, 200);
            const before = p >= 1 ? 18 : Math.max(18, 3 * Math.ceil(Math.log(0.005) / Math.log(1 - p)));
            expect(catchChance(CYCLE_METHODS.tree!, L, 'bronze')).toBe(p);
            expect(lockWindow(CYCLE_METHODS.tree!, L, 'bronze')).toBe(before);
        }
    });

    test('cage uses lobster (fishing.struct 6/95) and fly is unchanged', () => {
        expect(catchChance(CYCLE_METHODS.cage!, 40)).toBe(41 / 256);
        expect(lockWindow(CYCLE_METHODS.cage!, 99)).toBe(45);
        expect(lockWindow(CYCLE_METHODS.cage!, 40)).toBeGreaterThan(45);
        expect(catchChance(CYCLE_METHODS.fly!, 25)).toBe(statRandom(25, 32, 192));
    });

    test('axeOf picks the best axe worn or carried, as woodcutting_axe_checker does', () => {
        expect(axeOf(makeState({ tick: 1, inventory: ['Bronze axe'], equipment: ['Rune axe'] }))).toBe('rune');
        expect(axeOf(makeState({ tick: 1, inventory: ['Iron axe', 'Steel axe'] }))).toBe('steel');
        expect(axeOf(makeState({ tick: 1, inventory: ['Black axe', 'Steel axe'] }))).toBe('black');
        expect(axeOf(makeState({ tick: 1, inventory: ['Knife', 'Logs'] }))).toBeUndefined();
    });
});

describe('knife cycle: bury variant', () => {
    const KIT = ['Knife', 'Logs', 'Oak logs', 'Oak logs'];
    const types = (h: ReturnType<typeof serverRun>['h'], tick: number) => h.sent.filter(s => s.tick === tick).map(s => s.action.type);

    test('the roll label sends knife, button, drop and bury; the click goes alone two labels later', () => {
        const { h, rollTicks, buryTicks } = serverRun({ method: 'oak', ticks: 150, inventory: KIT, bones: 60, params: { bury: true } });
        const gaps = gapsOf(rollTicks);
        expect(gaps.slice(1).every(g => g === 3)).toBe(true);
        const r = rollTicks[4]!;
        expect(types(h, r)).toEqual(['useItemOnItem', 'clickComponent', 'dropItem', 'useInventoryItem']);
        expect(types(h, r + 1)).toEqual([]);
        expect(types(h, r + 2)).toEqual(['interactLoc']);
        // one bone per roll once locked, its xp on the tick after the bury lands
        expect(buryTicks).toContain(r + 2);
        const res = h.status.result as { buried: number; burySent: number; resyncs: number; noBoneCycles: number };
        expect(res.resyncs).toBe(0);
        expect(res.noBoneCycles).toBe(0);
        expect(res.buried).toBe(buryTicks.length);
        expect(res.burySent - res.buried).toBeLessThanOrEqual(1);
        expect(res.buried).toBeGreaterThanOrEqual(rollTicks.length - 3);
        expect(h.status.gauges.buriesPerTick).toBeGreaterThan(0.3);
        expect(h.status.gauges.lastSuccessGap).toBe(3);
    });

    test('when the bones run out the roll label sends the plain knife bundle and no label is lost', () => {
        const { h, rollTicks, buryTicks } = serverRun({ method: 'oak', ticks: 150, inventory: KIT, bones: 12, params: { bury: true } });
        expect(buryTicks).toHaveLength(12);
        expect(gapsOf(rollTicks).slice(1).every(g => g === 3)).toBe(true);
        const after = rollTicks.find(t => t > buryTicks[11]! + 3)!;
        expect(types(h, after)).toEqual(['useItemOnItem', 'clickComponent', 'dropItem', 'interactLoc']);
        expect(h.status.result).toMatchObject({ buried: 12, resyncs: 0 });
        expect(h.status.gauges.bonesLeft).toBe(0);
        expect(h.status.counters.noBoneCycles).toBeGreaterThan(0);
    });

    test('a level-up page: the dismiss and the bury bundle fit the 5-packet budget', () => {
        const base = serverRun({ method: 'oak', ticks: 60, inventory: KIT, bones: 30, params: { bury: true } });
        const r = base.rollTicks[5]!;
        const { h, rollTicks } = serverRun({ method: 'oak', ticks: 60, inventory: KIT, bones: 30, params: { bury: true }, dialogAt: r });
        expect(types(h, r)).toEqual(['clickDialogOption', 'useItemOnItem', 'clickComponent', 'dropItem', 'useInventoryItem']);
        expect(h.status.deferred).toBe(0);
        expect(gapsOf(rollTicks).slice(1).every(g => g === 3)).toBe(true);
    });

    test('a tree that falls keeps the lock: the lone click goes to a live tree', () => {
        for (const fellLag of [0, 1]) {
            const { h, rollTicks, buryTicks } = serverRun({ method: 'oak', ticks: 200, inventory: KIT, bones: 80, fellEvery: 8, fellLag, params: { bury: true } });
            expect(h.status.result).toMatchObject({ resyncs: 0 });
            expect(gapsOf(rollTicks).slice(1).every(g => g === 3)).toBe(true);
            expect(buryTicks.length).toBeGreaterThanOrEqual(rollTicks.length - 3);
            // no re-click: the bury cycle's click had not gone out yet
            const fell = rollTicks[7]!;
            expect(types(h, fell + 1)).toEqual([]);
            expect(types(h, fell + 2)).toEqual(['interactLoc']);
        }
    });

    test('a skipped click label (two ticks decoded at once) costs that roll and the lock comes back', () => {
        const base = serverRun({ method: 'oak', ticks: 150, inventory: KIT, bones: 60, params: { bury: true } });
        const r = base.rollTicks[6]!;
        const { h, rollTicks } = serverRun({ method: 'oak', ticks: 150, inventory: KIT, bones: 60, params: { bury: true }, merged: t => t === r + 2 });
        expect(h.status.counters.lateClicks).toBe(1);
        const after = rollTicks.filter(t => t > r + 12);
        expect(after.length).toBeGreaterThan(10);
        expect(gapsOf(after).every(g => g === 3)).toBe(true);
    });

    test('trees restricts the clicks to the listed tiles', () => {
        // a nearer dead tree off the list is never clicked
        const { h, rollTicks } = serverRun({ method: 'oak', ticks: 120, inventory: KIT, bones: 40, deadTrees: 1, params: { bury: true, trees: [[3201, 3204], [3202, 3204]] } });
        expect(h.sent.some(s => s.action.type === 'interactLoc' && (s.action as { x: number }).x === 3200)).toBe(false);
        expect(gapsOf(rollTicks).slice(1).every(g => g === 3)).toBe(true);
        expect(() => createKnifeCycle({ method: 'oak', successes: 5, trees: [] })).toThrow(/trees/);
        expect(() => createKnifeCycle({ method: 'oak', successes: 5, trees: [[1, 2, 3]] })).toThrow(/trees\[0\]/);
    });

    test('bury is refused where the lock cannot carry it', () => {
        expect(() => createKnifeCycle({ method: 'fly', successes: 5, bury: true })).toThrow(/not supported/);
        expect(() => createKnifeCycle({ method: 'tree', successes: 5, bury: true })).toThrow(/not supported/);
        expect(() => createKnifeCycle({ method: 'oak', technique: 'plain', successes: 5, bury: true })).toThrow(/knife technique/);
        expect(() => createKnifeCycle({ method: 'oak', successes: 5, bury: '^dragon bones$' })).not.toThrow();
    });
});
