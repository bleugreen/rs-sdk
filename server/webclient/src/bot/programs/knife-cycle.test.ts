import { describe, expect, test } from 'bun:test';

import '../../lite/test-support/browser-globals.js';

import { readFileSync } from 'node:fs';
import { type Axe, AXES, axeOf, catchChance, createKnifeCycle, CYCLE_METHODS, type CycleMethod, lockWindow, SHAFTS_BUTTON, TREE_CHANCE } from './knife-cycle.js';
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
    /** A preset, or a method object (the small net). */
    method: 'willow' | 'oak' | 'fly' | 'tree' | CycleMethod;
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
    /** Each success puts this product in the first free slot; a landed drop empties its slot. */
    catches?: string;
    /** The runtime's draw for `hold` (default Math.random). */
    random?: () => number;
}) {
    const m = typeof opts.method === 'string' ? CYCLE_METHODS[opts.method]! : opts.method;
    const skill = m.skill === 'fishing' ? 'Fishing' : 'Woodcutting';
    const h = new Harness('cycle', createKnifeCycle, opts.random ? { random: opts.random } : {});
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
    const pending: Array<{ at: number; type: string; locId?: number; slot?: number }> = [];
    let rolls = 0;
    const rollTicks: number[] = [];
    const buryTicks: number[] = [];
    let maxInventory = 0;
    const inventory: Array<string | { name: string; options: string[] } | null> = [
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
        npcs: m.kind === 'npc' ? [{ index: 7, name: 'Fishing spot', x: spotX, z: 3200, options: ['Lure', 'Bait', 'Net'] }] : [],
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
            inventory.splice(inventory.findIndex(i => i !== null && typeof i !== 'string' && i.name === 'Dragon bones'), 1);
        }
        for (const p of pending.filter(p => p.at === tick)) {
            if (tick === delayedOn) continue; // p_delay(0) after a bury: every packet is rejected
            if (p.type === 'useItemOnItem' || p.type === 'dropItem' || p.type === 'useInventoryItem') interacting = false; // inventory ops clear the interaction
            if (opts.catches && p.type === 'dropItem' && p.slot !== undefined) inventory[p.slot] = null;
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
        if (opts.logsGoneAt === tick) for (let j = inventory.length - 1; j >= 0; j--) if (inventory[j] === 'Logs') inventory.splice(j, 1);
        if (felledAt !== null && tick > felledAt + (opts.fellLag ?? 0)) felledAt = null;
        if (interacting && nextRoll === tick) {
            lastRoll = tick;
            nextRoll = tick + m.plainCycle;
            if (!opts.miss?.(++rolls)) {
                xp += 500;
                rollTicks.push(tick);
                if (opts.catches) {
                    const free = inventory.indexOf(null);
                    if (free >= 0) inventory[free] = opts.catches;
                    else inventory.push(opts.catches);
                    maxInventory = Math.max(maxInventory, inventory.filter(i => i !== null).length);
                }
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
        for (const s of h.step(makeState(spec()), 1 + skipped)) pending.push({ at: tick + (opts.latency?.(n++) ?? 1), type: s.action.type, locId: (s.action as { locId?: number }).locId, slot: (s.action as { slot?: number }).slot });
        skipped = 0;
    }
    return { h, rollTicks, buryTicks, maxInventory };
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

    test('untilXp ends the run on the label that shows the xp', () => {
        const { h, rollTicks } = serverRun({ method: 'fly', ticks: 2000, params: { untilXp: 5000 } });
        expect(h.status.phase).toBe('done');
        expect(rollTicks).toHaveLength(10);
        expect(h.status.result).toMatchObject({ successes: 10 });
        expect(h.status.endedTick).toBe(rollTicks[9]);
        expect(() => createKnifeCycle({ method: 'fly', untilXp: 240300 })).not.toThrow();
    });

    test('a spot move records the gap that spans it', () => {
        const { h, rollTicks } = serverRun({ method: 'fly', ticks: 200, spotMovesAt: 1060 });
        const before = rollTicks.filter(t => t < 1060).at(-1)!;
        const after = rollTicks.find(t => t > 1060)!;
        expect(h.status.result).toMatchObject({ moves: 1, moveGaps: [after - before] });
    });

    test('the lost-lock window scales with the catch chance', () => {
        expect(lockWindow(CYCLE_METHODS.fly!, 99)).toBe(15);
        expect(lockWindow(CYCLE_METHODS.fly!, 20)).toBeGreaterThan(15);
        // no axe: no chance, the preset's window
        expect(lockWindow(CYCLE_METHODS.willow!, 30)).toBe(18);
    });
});

describe('knife cycle: plain fishing refinements', () => {
    const ROD = ['Fly fishing rod', 'Feather'];
    const firstClickAfter = (h: ReturnType<typeof serverRun>['h'], t: number) => h.sent.find(s => s.tick >= t && s.action.type === 'interactNpc')?.tick;

    test('followSpot: a moved spot is re-clicked on the label that shows its new tile', () => {
        const { h, rollTicks } = serverRun({ method: 'fly', technique: 'plain', ticks: 200, inventory: ROD, spotMovesAt: 1060, params: { followSpot: true } });
        expect(firstClickAfter(h, 1060)).toBe(1060);
        expect(h.status.result).toMatchObject({ moves: 1 });
        // the click lands on 1061 and the first roll comes r0 later; the plain cycle holds on either side
        expect(rollTicks.find(t => t > 1060)).toBe(1061 + CYCLE_METHODS.fly!.r0);
        expect(gapsOf(rollTicks.filter(t => t > 1060)).every(g => g === 5)).toBe(true);
    });

    test('without followSpot plain still waits for the stall window after a move', () => {
        const { h } = serverRun({ method: 'fly', technique: 'plain', ticks: 200, inventory: ROD, spotMovesAt: 1060 });
        expect(firstClickAfter(h, 1060)!).toBeGreaterThan(1065);
        expect(h.status.result).toMatchObject({ moves: 0 });
    });

    test('dropEach: the catch label drops it and re-clicks, and the 5-tick lattice holds', () => {
        const { h, rollTicks, maxInventory } = serverRun({ method: 'fly', technique: 'plain', ticks: 300, inventory: ROD, catches: 'Raw trout', params: { dropEach: true } });
        expect(gapsOf(rollTicks).every(g => g === 5)).toBe(true);
        expect(rollTicks.length).toBeGreaterThan(55);
        for (const r of rollTicks.slice(0, -1)) expect(h.sent.filter(s => s.tick === r).map(s => s.action.type)).toEqual(['dropItem', 'interactNpc']);
        expect(maxInventory).toBe(ROD.length + 1);
    });

    test('dropEach: a level-up on the catch label is answered first, then the drop and the click', () => {
        const base = serverRun({ method: 'fly', technique: 'plain', ticks: 100, inventory: ROD, catches: 'Raw trout', params: { dropEach: true } });
        const r = base.rollTicks[4]!;
        const { h, rollTicks } = serverRun({ method: 'fly', technique: 'plain', ticks: 100, inventory: ROD, catches: 'Raw trout', dialogAt: r, params: { dropEach: true } });
        expect(h.sent.filter(s => s.tick === r).map(s => s.action.type)).toEqual(['clickDialogOption', 'dropItem', 'interactNpc']);
        expect(gapsOf(rollTicks).every(g => g === 5)).toBe(true);
    });

    test('dropEach with followSpot: a move between catches gets a lone re-click, and the catches after it are dropped', () => {
        const base = serverRun({ method: 'fly', technique: 'plain', ticks: 200, inventory: ROD, catches: 'Raw trout', params: { dropEach: true } });
        const move = base.rollTicks[8]! + 2;
        const { h, rollTicks, maxInventory } = serverRun({ method: 'fly', technique: 'plain', ticks: 200, inventory: ROD, catches: 'Raw trout', spotMovesAt: move, params: { dropEach: true, followSpot: true } });
        expect(h.sent.filter(s => s.tick === move).map(s => s.action.type)).toEqual(['interactNpc']);
        expect(h.status.result).toMatchObject({ moves: 1, moveGaps: [rollTicks.find(t => t > move)! - (move - 2)] });
        const next = rollTicks.find(t => t > move)!;
        expect(h.sent.filter(s => s.tick === next).map(s => s.action.type)).toEqual(['dropItem', 'interactNpc']);
        expect(maxInventory).toBe(ROD.length + 1);
    });

    test('dropEach on the small net: drop and re-click on R+1 keep the 6-tick lattice', () => {
        const NET: CycleMethod = { skill: 'fishing', kind: 'npc', target: '^fishing spot$', option: '^net$', product: '^raw ', clickOnRoll: true, r0: 5, plainCycle: 6, lockWindow: 45 };
        const { h, rollTicks, maxInventory } = serverRun({ method: NET, technique: 'plain', ticks: 200, inventory: ['Small fishing net'], catches: 'Raw shrimps', params: { dropEach: true, followSpot: true } });
        expect(gapsOf(rollTicks).every(g => g === 6)).toBe(true);
        expect(h.sent.filter(s => s.tick === rollTicks[3]).map(s => s.action.type)).toEqual(['dropItem', 'interactNpc']);
        expect(h.sent.find(s => s.action.type === 'interactNpc')?.action).toMatchObject({ optionIndex: 3 });
        expect(maxInventory).toBe(2);
    });

    test('dropEach keeps keepProducts: the first products are never dropped', () => {
        const { h, rollTicks, maxInventory } = serverRun({ method: 'willow', technique: 'plain', ticks: 120, inventory: [], catches: 'Willow logs', params: { dropEach: true, keepProducts: 2 } });
        expect(gapsOf(rollTicks).every(g => g === 4)).toBe(true);
        const dropped = h.sent.filter(s => s.action.type === 'dropItem').map(s => (s.action as { slot: number }).slot);
        expect(dropped.length).toBe(rollTicks.length - 2);
        expect(dropped.every(slot => slot >= 2)).toBe(true);
        expect(maxInventory).toBe(3);
    });

    test('dropEach with a short budget: the click keeps its slot and the leftover drops go out on the next catch', () => {
        // six old catches and a level-up on the catch label: the dismissal, three drops and the click fill the 5 packets
        const base = serverRun({ method: 'fly', technique: 'plain', ticks: 100, inventory: [...ROD, ...Array(6).fill('Raw trout')], catches: 'Raw trout' });
        const r = base.rollTicks[0]!;
        const { h, rollTicks } = serverRun({ method: 'fly', technique: 'plain', ticks: 100, inventory: [...ROD, ...Array(6).fill('Raw trout')], catches: 'Raw trout', dialogAt: r, params: { dropEach: true } });
        expect(h.sent.filter(s => s.tick === r).map(s => s.action.type)).toEqual(['clickDialogOption', 'dropItem', 'dropItem', 'dropItem', 'interactNpc']);
        expect(h.status.deferred).toBe(0);
        expect(h.sent.filter(s => s.tick === rollTicks[1]).map(s => s.action.type)).toEqual(['dropItem', 'dropItem', 'dropItem', 'dropItem', 'interactNpc']);
        expect(gapsOf(rollTicks).every(g => g === 5)).toBe(true);
    });

    test('without dropEach plain keeps the catches until the inventory is full', () => {
        const { h, rollTicks, maxInventory } = serverRun({ method: 'fly', technique: 'plain', ticks: 100, inventory: ROD, catches: 'Raw trout' });
        expect(h.sent.some(s => s.action.type === 'dropItem')).toBe(false);
        expect(maxInventory).toBe(ROD.length + rollTicks.length);
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
        expect(() => createKnifeCycle({ method: 'fly', technique: 'plain', successes: 5, bury: true })).toThrow(/not supported/);
        expect(() => createKnifeCycle({ method: 'oak', technique: 'plain', successes: 5, bury: true })).not.toThrow();
        expect(() => createKnifeCycle({ method: 'oak', successes: 5, bury: '^dragon bones$' })).not.toThrow();
    });
});

describe('knife cycle: plain + bury', () => {
    const PACK = ['Rune axe', 'Oak logs'];
    const types = (h: ReturnType<typeof serverRun>['h'], tick: number) => h.sent.filter(s => s.tick === tick).map(s => s.action.type);
    type Res = { buried: number; burySent: number; resyncs: number; noBoneCycles: number; lateClicks: number; technique: string };

    test('R drops and clicks, R+1 buries, R+3 clicks alone and lands on the roll: a bone every plain cycle', () => {
        const { h, rollTicks, buryTicks } = serverRun({ method: 'oak', technique: 'plain', ticks: 160, inventory: PACK, bones: 60, params: { bury: true } });
        expect(gapsOf(rollTicks).every(g => g === 4)).toBe(true);
        for (const r of rollTicks.slice(1, -1)) {
            expect(types(h, r)).toEqual(['dropItem', 'interactLoc']);
            expect(types(h, r + 1)).toEqual(['useInventoryItem']);
            expect(types(h, r + 2)).toEqual([]);
            expect(types(h, r + 3)).toEqual(['interactLoc']);
            // the bone's xp comes on the tick after the bury lands, before the click's roll
            expect(buryTicks).toContain(r + 3);
        }
        const res = h.status.result as Res;
        expect(res).toMatchObject({ technique: 'plain', resyncs: 0, noBoneCycles: 0, lateClicks: 0 });
        expect(res.buried).toBe(buryTicks.length);
        expect(res.buried).toBeGreaterThanOrEqual(rollTicks.length - 2);
        expect(h.status.gauges.buriesPerTick).toBeGreaterThan(0.22);
        expect(h.status.gauges.lastSuccessGap).toBe(4);
    });

    test('when the bones run out the cycle is the plain one: no label is lost', () => {
        const { h, rollTicks, buryTicks } = serverRun({ method: 'oak', technique: 'plain', ticks: 160, inventory: PACK, bones: 10, params: { bury: true } });
        expect(buryTicks).toHaveLength(10);
        expect(gapsOf(rollTicks).every(g => g === 4)).toBe(true);
        const after = rollTicks.filter(t => t > buryTicks[9]! + 4);
        expect(after.length).toBeGreaterThan(5);
        for (const r of after.slice(0, -1)) {
            expect(types(h, r)).toEqual(['dropItem', 'interactLoc']);
            expect(types(h, r + 1)).toEqual([]);
            expect(types(h, r + 3)).toEqual([]);
        }
        expect(h.status.counters.noBoneCycles).toBeGreaterThan(0);
        expect(h.status.gauges.bonesLeft).toBe(0);
    });

    test('plain without bury is the plain loop: one click, no bones touched', () => {
        const { h, rollTicks } = serverRun({ method: 'oak', technique: 'plain', ticks: 100, inventory: [], bones: 20 });
        expect(gapsOf(rollTicks).every(g => g === 4)).toBe(true);
        expect(h.sent.map(s => s.action.type)).toEqual(['interactLoc']);
        expect(h.status.result).not.toHaveProperty('buried');
    });

    test('a level-up page on R+1 is answered with a click and that cycle carries no bone', () => {
        const base = serverRun({ method: 'oak', technique: 'plain', ticks: 80, inventory: PACK, bones: 40, params: { bury: true } });
        const r = base.rollTicks[4]!;
        const { h, rollTicks, buryTicks } = serverRun({ method: 'oak', technique: 'plain', ticks: 80, inventory: PACK, bones: 40, params: { bury: true }, dialogAt: r + 1 });
        expect(types(h, r + 1)).toEqual(['clickDialogOption', 'interactLoc']);
        expect(types(h, r + 3)).toEqual([]);
        expect(buryTicks).not.toContain(r + 3);
        expect(gapsOf(rollTicks).every(g => g === 4)).toBe(true);
        expect(types(h, r + 5)).toEqual(['useInventoryItem']);
        expect(h.status.result).toMatchObject({ resyncs: 0 });
    });

    test('a tree that falls, seen on its roll label: the click there re-arms the clock and the lattice holds', () => {
        const { h, rollTicks, buryTicks } = serverRun({ method: 'oak', technique: 'plain', ticks: 200, inventory: PACK, bones: 80, fellEvery: 8, params: { bury: true } });
        expect(h.status.result).toMatchObject({ resyncs: 0, switches: 0 });
        expect(gapsOf(rollTicks).every(g => g === 4)).toBe(true);
        const fell = rollTicks[7]!;
        expect((h.sent.find(s => s.tick === fell && s.action.type === 'interactLoc')!.action as { locId: number }).locId).toBe(2);
        expect(buryTicks.length).toBeGreaterThanOrEqual(rollTicks.length - 2);
    });

    test('a fallen tree still listed on its roll label: the click there goes to the standing one and the lattice holds', () => {
        const { h, rollTicks, buryTicks } = serverRun({ method: 'oak', technique: 'plain', ticks: 200, inventory: PACK, bones: 80, fellEvery: 8, fellLag: 1, params: { bury: true } });
        const fell = rollTicks[7]!;
        expect(h.sent.filter(s => s.tick === fell).map(s => [s.action.type, (s.action as { locId?: number }).locId])).toEqual([['dropItem', undefined], ['interactLoc', 2]]);
        expect(gapsOf(rollTicks).every(g => g === 4)).toBe(true);
        expect(h.status.result).toMatchObject({ resyncs: 0, switches: 0 });
        expect(buryTicks.length).toBeGreaterThanOrEqual(rollTicks.length - 2);
    });

    test('no other tree standing on the roll label: the bone cycle clicks the respawned one and re-anchors on its first roll', () => {
        const { h, rollTicks, buryTicks } = serverRun({ method: 'oak', technique: 'plain', ticks: 200, inventory: PACK, bones: 80, fellEvery: 8, fellLag: 1, allDownFor: 2, params: { bury: true } });
        const fell = rollTicks[7]!;
        // R's click went to the stump; the bury already out delays the player through R+3, so the
        // click on the live tree lands on R+4 and, the clock left on R, rolls r0 later
        const lone = h.sent.filter(s => s.tick === fell + 3);
        expect(lone.map(s => s.action.type)).toEqual(['interactLoc']);
        expect((lone[0]!.action as { locId: number }).locId).toBe(2);
        expect(rollTicks[8]! - fell).toBe(7);
        // no bone goes out while the schedule waits for that roll
        expect(h.sent.filter(s => s.tick > fell + 3 && s.tick < rollTicks[8]! && s.action.type === 'useInventoryItem')).toHaveLength(0);
        const falls = Math.floor(rollTicks.length / 8);
        expect(h.status.result).toMatchObject({ resyncs: 0, switches: falls });
        expect(gapsOf(rollTicks).filter(g => g !== 4)).toEqual(Array(falls).fill(7));
        expect(buryTicks.length).toBeGreaterThanOrEqual(rollTicks.length - 3);
    });

    test('a skipped click label (two ticks decoded at once) costs that roll and the cycle comes back', () => {
        const base = serverRun({ method: 'oak', technique: 'plain', ticks: 150, inventory: PACK, bones: 60, params: { bury: true } });
        const r = base.rollTicks[6]!;
        const { h, rollTicks } = serverRun({ method: 'oak', technique: 'plain', ticks: 150, inventory: PACK, bones: 60, params: { bury: true }, merged: t => t === r + 3 });
        expect(h.status.counters.lateClicks).toBe(1);
        const after = rollTicks.filter(t => t > r + 4);
        expect(after.length).toBeGreaterThan(10);
        expect(gapsOf(after).every(g => g === 4)).toBe(true);
        expect(h.status.result).toMatchObject({ resyncs: 0 });
    });

    test('the knife running out of logs falls back to plain + bury, still burying', () => {
        const { h, rollTicks, buryTicks } = serverRun({ method: 'oak', ticks: 200, inventory: ['Knife', 'Logs', 'Oak logs', 'Oak logs'], bones: 80, params: { bury: true }, logsGoneAt: 1060 });
        expect(h.status.result).toMatchObject({ technique: 'knife->plain', fellBack: 'out of logs' });
        const late = rollTicks.filter(t => t > 1080);
        expect(gapsOf(late).every(g => g === 4)).toBe(true);
        expect(buryTicks.filter(t => t > 1080).length).toBeGreaterThanOrEqual(late.length - 2);
    });
});

/** Every packet with its label and full action, FNV-1a hashed: enough to pin a run's stream. */
function streamDigest(h: ReturnType<typeof serverRun>['h']): string {
    const s = h.sent.map(x => `${x.tick} ${JSON.stringify(x.action)}`).join('\n');
    let d = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) d = Math.imul(d ^ s.charCodeAt(i), 0x01000193) >>> 0;
    return d.toString(16);
}

/** Default-parameter scenarios whose packets no opt-in may change. */
const DEFAULT_RUNS: Record<string, () => ReturnType<typeof serverRun>> = {
    willow: () => serverRun({ method: 'willow', ticks: 300, axe: 'Rune axe', level: 80 }),
    oakFalls: () => serverRun({ method: 'oak', ticks: 300, fellEvery: 8, fellLag: 1 }),
    oakAllDown: () => serverRun({ method: 'oak', ticks: 300, fellEvery: 8, allDownFor: 5 }),
    willowRespawnWait: () => serverRun({ method: 'willow', ticks: 400, axe: 'Rune axe', fellEvery: 8, allDownFor: 30 }),
    willowMisses: () => serverRun({ method: 'willow', ticks: 300, axe: 'Rune axe', level: 75, miss: r => r >= 20 && r < 30 }),
    oakBury: () => serverRun({ method: 'oak', ticks: 200, bones: 20, fellEvery: 8, allDownFor: 30, params: { bury: true } }),
    plain: () => serverRun({ method: 'willow', technique: 'plain', ticks: 200, fellEvery: 8, allDownFor: 30 }),
    tree: () => serverRun({ method: 'tree', ticks: 200 }),
    fly: () => serverRun({ method: 'fly', ticks: 200, spotMovesAt: 1060 })
};

/** DEFAULT_RUNS' digests with knife-cycle.ts as of rs/147's bad407ef (before `waitRespawn`). */
const DEFAULT_GOLDEN: Record<string, string> = {
    willow: 'eab56468', oakFalls: 'd6980233', oakAllDown: '83378a83', willowRespawnWait: '18bb1caa', willowMisses: '399c2e32',
    oakBury: '5b7aa5a3', plain: 'a8c3a668', tree: '2d7e32ef', fly: '96c97070'
};

describe('knife cycle: default stream', () => {
    test('without the opt-in parameters, every packet is as before (golden digests from bad407ef)', () => {
        const got = Object.fromEntries(Object.entries(DEFAULT_RUNS).map(([k, run]) => [k, streamDigest(run().h)]));
        expect(got).toEqual(DEFAULT_GOLDEN);
    });

    test('waitRespawn false is the default stream', () => {
        for (const k of ['willowRespawnWait', 'oakAllDown'] as const) {
            const base = DEFAULT_RUNS[k]!();
            const m = k === 'oakAllDown' ? 'oak' : 'willow';
            const off = k === 'oakAllDown'
                ? serverRun({ method: m, ticks: 300, fellEvery: 8, allDownFor: 5, params: { waitRespawn: false } })
                : serverRun({ method: m, ticks: 400, axe: 'Rune axe', fellEvery: 8, allDownFor: 30, params: { waitRespawn: false } });
            expect(streamDigest(off.h)).toBe(streamDigest(base.h));
        }
    });
});

/** S07's two bury loops as the burying bands run them (trees, waitRespawn, falls, a level-up, the bones running out, skipped labels). */
const TREES = [[3201, 3204], [3202, 3204]];
const BURY_RUNS: Record<string, (params?: Record<string, unknown>) => ReturnType<typeof serverRun>> = {
    knifeBuryOak: (p = {}) => serverRun({ method: 'oak', ticks: 300, level: 60, axe: 'Rune axe', bones: 40, fellEvery: 8, fellLag: 1, params: { bury: true, waitRespawn: true, trees: TREES, ...p } }),
    knifeBuryWillow: (p = {}) => serverRun({ method: 'willow', ticks: 400, level: 85, axe: 'Rune axe', bones: 60, fellEvery: 8, allDownFor: 30, dialogAt: 1100, params: { bury: true, waitRespawn: true, trees: TREES, ...p } }),
    knifeBuryMerged: (p = {}) => serverRun({ method: 'oak', ticks: 300, bones: 60, inventory: ['Knife', 'Logs', 'Oak logs'], merged: t => t % 37 === 0, params: { bury: true, ...p } }),
    plainBuryOak: (p = {}) => serverRun({ method: 'oak', technique: 'plain', ticks: 300, level: 60, axe: 'Rune axe', inventory: ['Oak logs'], bones: 60, fellEvery: 8, fellLag: 1, allDownFor: 2, params: { bury: true, trees: TREES, ...p } }),
    plainBuryWillow: (p = {}) => serverRun({ method: 'willow', technique: 'plain', ticks: 400, level: 85, axe: 'Rune axe', inventory: ['Willow logs'], bones: 30, fellEvery: 8, dialogAt: 1101, params: { bury: true, trees: TREES, ...p } }),
    plainBuryMerged: (p = {}) => serverRun({ method: 'oak', technique: 'plain', ticks: 300, inventory: ['Rune axe', 'Oak logs'], bones: 60, merged: t => t % 37 === 0, params: { bury: true, ...p } })
};

/** BURY_RUNS' digests with knife-cycle.ts as of f6ecd96f (before the on-time counters and the bury cycles' hold marks). */
const BURY_GOLDEN: Record<string, string> = {
    knifeBuryOak: 'baa52a7f', knifeBuryWillow: '593785dc', knifeBuryMerged: '6b20c200', plainBuryOak: 'eac0e18c', plainBuryWillow: '669084d8', plainBuryMerged: '787d9e69'
};

describe('knife cycle: the bury streams', () => {
    test('knife + bury and plain + bury send every packet as before, with hold unset and with hold 0 (golden digests from f6ecd96f)', () => {
        const got = Object.fromEntries(Object.entries(BURY_RUNS).map(([k, run]) => [k, streamDigest(run().h)]));
        expect(got).toEqual(BURY_GOLDEN);
        const zero = Object.fromEntries(Object.entries(BURY_RUNS).map(([k, run]) => [k, streamDigest(run({ hold: 0 }).h)]));
        expect(zero).toEqual(BURY_GOLDEN);
    });
});

describe('knife cycle: waitRespawn', () => {
    const WAIT = { method: 'willow', ticks: 400, axe: 'Rune axe', fellEvery: 8, allDownFor: 30 } as const;

    test('every listed tree down for longer than the lock window: no slip, no resync, and the lock resumes on the respawn', () => {
        const base = serverRun(WAIT);
        expect(base.h.status.counters.slips).toBeGreaterThan(0);
        const { h, rollTicks } = serverRun({ ...WAIT, params: { waitRespawn: true } });
        expect(h.status.counters.slips ?? 0).toBe(0);
        expect(h.status.counters.resyncs ?? 0).toBe(0);
        expect(h.status.counters.respawnWaits).toBeGreaterThan(0);
        // no starter goes out while every tree is down (it would fletch the log)
        const fell = rollTicks[7]!;
        expect(h.sent.filter(s => s.action.type === 'useItemOnItem' && s.tick > fell && s.tick <= fell + 30)).toHaveLength(0);
        // locked again between the respawn and the next fall (roll 16)
        const relocked = rollTicks.slice(9, 16);
        expect(relocked[0]! - fell).toBeLessThan(45);
        expect(gapsOf(relocked).every(g => g === 3)).toBe(true);
        // at least as many logs as the default, which pays a resync and a re-anchor for each wait
        expect(h.status.counters.successes!).toBeGreaterThanOrEqual(base.h.status.counters.successes!);
        const r = h.status.result as { respawnWaits: number[] };
        // the counter counts waits as they start; the list holds the finished ones (the run may end inside one)
        expect(r.respawnWaits.length).toBeGreaterThanOrEqual(h.status.counters.respawnWaits! - 1);
        expect(r.respawnWaits.length).toBeGreaterThan(0);
        expect(r.respawnWaits.every(w => w >= 29 && w <= 32)).toBe(true);
    });

    test('misses with a tree standing are still a lost lock', () => {
        const run = (params: Record<string, unknown>) => serverRun({ method: 'willow', ticks: 300, axe: 'Rune axe', level: 75, miss: r => r >= 20 && r < 30, params });
        const on = run({ waitRespawn: true });
        expect(on.h.status.counters.slips).toBe(1);
        expect(streamDigest(on.h)).toBe(streamDigest(run({}).h));
    });

    test('with bury, a respawn wait is no slip either', () => {
        const base = serverRun({ method: 'oak', ticks: 200, bones: 20, fellEvery: 8, allDownFor: 30, params: { bury: true } });
        const on = serverRun({ method: 'oak', ticks: 200, bones: 20, fellEvery: 8, allDownFor: 30, params: { bury: true, waitRespawn: true } });
        expect(base.h.status.counters.slips).toBeGreaterThan(0);
        expect(on.h.status.counters.slips ?? 0).toBe(0);
    });

    test('refused where nothing falls and respawns: fishing spots and normal trees', () => {
        expect(() => createKnifeCycle({ method: 'fly', successes: 5, waitRespawn: true })).toThrow(/waitRespawn/);
        expect(() => createKnifeCycle({ method: 'tree', successes: 5, waitRespawn: true })).toThrow(/waitRespawn/);
        expect(() => createKnifeCycle({ method: 'willow', successes: 5, waitRespawn: true })).not.toThrow();
    });
});
