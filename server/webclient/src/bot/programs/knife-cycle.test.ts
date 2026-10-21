import { describe, expect, test } from 'bun:test';
import { createKnifeCycle, CYCLE_METHODS, lockWindow, SHAFTS_BUTTON } from './knife-cycle.js';
import { Harness, makeState, type StateSpec } from './testkit.js';

/**
 * A deterministic stand-in for the engine's gathering loop (tick-manipulation.md
 * section 5): a click on an idle player rolls r0 ticks after it lands; each roll
 * re-arms the next one plainCycle later; a knife starter landing on R+1 pulls the
 * next roll to R+3. Packets sent on label c land on c + latency.
 */
function serverRun(opts: {
    method: 'willow' | 'fly' | 'tree';
    technique?: 'knife' | 'plain';
    ticks: number;
    latency?: (n: number) => number;
    params?: Record<string, unknown>;
    inventory?: string[];
    spotMovesAt?: number;
    dialogAt?: number;
    logsGoneAt?: number;
    /** Ticks a felled tree stays listed after its log (the browser shows it one more tick). */
    fellLag?: number;
    /** Tree tiles that never yield (out of reach). */
    deadTrees?: number;
    /** Labels the page never sees on their own: decoded together with the next (server overrun). */
    merged?: (tick: number) => boolean;
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
    const pending: Array<{ at: number; type: string; locId?: number }> = [];
    const rollTicks: number[] = [];
    const inventory = opts.inventory ?? ['Knife', 'Logs', 'Logs', 'Logs', 'Logs', 'Logs'];
    const spec = (): StateSpec => ({
        tick,
        skills: { [skill]: { xp } },
        inventory,
        animId: interacting ? 1 : -1,
        dialogOpen: dialog,
        npcs: m.kind === 'npc' ? [{ index: 7, name: 'Fishing spot', x: spotX, z: 3200, options: ['Lure', 'Bait'] }] : [],
        locs: m.kind === 'loc'
            ? [
                ...Array.from({ length: opts.deadTrees ?? 0 }, (_, i) => ({ id: 900 + i, x: 3200, z: 3200 + i, name: opts.method === 'tree' ? 'Tree' : 'Willow', options: ['Chop down'] })),
                { id: treeId, x: 3201, z: 3204, name: opts.method === 'tree' ? 'Tree' : 'Willow', options: ['Chop down'] },
                ...(felledAt !== null ? [{ id: treeId - 1, x: 3202, z: 3204, name: 'Tree', options: ['Chop down'] }] : [])
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
        for (const p of pending.filter(p => p.at === tick)) {
            if (p.type === 'useItemOnItem' || p.type === 'dropItem') interacting = false; // inventory ops clear the interaction
            if (p.type === 'useItemOnItem' && tick === lastRoll + 1) starter = true;
            if (p.type === 'clickDialogOption') dialog = false;
            if (p.type === 'interactLoc' && p.locId !== treeId) {
                interacting = false; // a dead or felled tree: nothing happens
                continue;
            }
            if (p.type === 'interactLoc' || p.type === 'interactNpc') {
                interacting = true;
                clickedTree++;
                if (starter) nextRoll = lastRoll + 3;
                else if (nextRoll === null || nextRoll < tick) nextRoll = tick + m.r0;
            }
        }
        if (opts.spotMovesAt === tick) { spotX = 3205; interacting = false; nextRoll = null; }
        if (opts.dialogAt === tick) dialog = true;
        if (opts.logsGoneAt === tick) inventory.splice(0, inventory.length, 'Knife');
        if (felledAt !== null && tick > felledAt + (opts.fellLag ?? 0)) felledAt = null;
        if (interacting && nextRoll === tick) {
            xp += 500;
            rollTicks.push(tick);
            lastRoll = tick;
            nextRoll = tick + m.plainCycle;
            if (m.depletes) { treeId++; interacting = false; nextRoll = null; if (opts.fellLag) felledAt = tick; }
        }
        if (opts.merged?.(tick)) { skipped++; continue; }
        for (const s of h.step(makeState(spec()), 1 + skipped)) pending.push({ at: tick + (opts.latency?.(n++) ?? 1), type: s.action.type, locId: (s.action as { locId?: number }).locId });
        skipped = 0;
    }
    return { h, rollTicks };
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
        expect((h.status.result as { ticksPerRoll: number }).ticksPerRoll).toBeLessThan(3.05);
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

    test('ends after the requested rolls with a summary', () => {
        const { h } = serverRun({ method: 'willow', ticks: 500, params: { rolls: 20 } });
        expect(h.status.phase).toBe('done');
        expect(h.status.result).toMatchObject({ rolls: 20, technique: 'knife' });
    });

    test('rejects a start with no end condition or an unknown method', () => {
        expect(() => createKnifeCycle({ method: 'willow' })).toThrow(/rolls/);
        expect(() => createKnifeCycle({ method: 'nope', rolls: 5 })).toThrow(/unknown method/);
    });

    test('the lost-lock window scales with the catch chance', () => {
        expect(lockWindow(CYCLE_METHODS.fly!, 99)).toBe(15);
        expect(lockWindow(CYCLE_METHODS.fly!, 20)).toBeGreaterThan(15);
        expect(lockWindow(CYCLE_METHODS.willow!, 1)).toBe(18);
    });
});
