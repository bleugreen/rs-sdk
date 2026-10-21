import { describe, expect, test } from 'bun:test';
import { createKnifeMine, parseMineSteps } from './knife-mine.js';
import { Harness, makeState } from './testkit.js';

// rs/5's zoo-cluster rotation at respawn 13 (tickmanip-mine-run.sh, mining.md section 4)
const D13 = '2604,3235>2605,3235 2602,3235>2602,3236 2603,3234>2602,3234 2603,3233>2602,3233 2605,3234>2605,3233';

/**
 * The engine's mining clock (mining.rs2, cut_logs.rs2, as tick-manipulation.md reads it):
 * a swing that finds the clock expired sets it to swing+2 and rolls then; one that
 * finds it ahead or equal rolls when it comes due. A knife starter landing on R+1
 * (clock expired) sets the clock to R+3. Every roll at 63+ succeeds and depletes the
 * rock for `respawn` ticks. A run of up to 2 tiles lands in the walk's own tick.
 */
function mine(opts: { starter: 'knife' | 'none'; ticks: number; respawn?: number; drop?: (n: number, type: string) => boolean; params?: Record<string, unknown> }) {
    const D = opts.respawn ?? 13;
    const steps = parseMineSteps(D13);
    const rockTiles = [...new Set(steps.map(s => `${s.rock[0]},${s.rock[1]}`))];
    const h = new Harness('mine', createKnifeMine);
    let tick = 500;
    let xp = 0;
    let pos = steps[0]!.stand;
    let clock = 0;
    let target: string | null = null;
    let rollAt: number | null = null;
    const respawnAt = new Map<string, number>();
    const pending: Array<{ at: number; type: string; x?: number; z?: number }> = [];
    const rolls: number[] = [];
    const state = () => makeState({
        tick, x: pos[0], z: pos[1],
        skills: { Mining: { xp } },
        inventory: ['Rune pickaxe', 'Knife', 'Logs', 'Logs', 'Iron ore'],
        locs: rockTiles.map(k => {
            const [x, z] = k.split(',').map(Number);
            const live = (respawnAt.get(k) ?? 0) <= tick;
            return { id: live ? 2092 : 450, x: x!, z: z!, name: live ? 'Rocks' : 'Rocks', options: live ? ['Mine', 'Prospect'] : ['Prospect'] };
        })
    });
    h.start('mine', { steps: D13, respawn: D, starter: opts.starter, maxTicks: opts.ticks, ...opts.params }, state());
    let n = 0;
    for (let i = 0; i < opts.ticks + 20 && h.status.phase === 'running'; i++) {
        tick++;
        for (const p of pending.filter(p => p.at === tick)) {
            if (p.type === 'useItemOnItem' && clock < tick) clock = tick + 2;
            if (p.type === 'useItemOnItem' || p.type === 'dropItem' || p.type === 'walkTo') { target = null; rollAt = null; }
            if (p.type === 'walkTo') pos = [p.x!, p.z!];
            if (p.type === 'interactLoc') {
                const k = `${p.x},${p.z}`;
                if ((respawnAt.get(k) ?? 0) > tick) continue; // depleted: nothing to mine
                target = k;
                if (clock >= tick) rollAt = clock;
                else { clock = tick + 2; rollAt = clock; }
            }
        }
        if (target && rollAt === tick) {
            xp += 350;
            rolls.push(tick);
            respawnAt.set(target, tick + D);
            target = null;
            rollAt = null;
        }
        for (const s of h.step(state())) {
            if (opts.drop?.(n++, s.action.type)) continue;
            const a = s.action as { type: string; x?: number; z?: number };
            pending.push({ at: tick + 1, type: a.type, x: a.x, z: a.z });
        }
    }
    return { h, rolls };
}

const gapsOf = (t: number[]) => t.slice(1).map((v, i) => v - t[i]!);

describe('knife mining: hold', () => {
    test('hold 0 sends exactly what no hold sends; hold 1 holds every starter tick a label', () => {
        const base = mine({ starter: 'knife', ticks: 120 });
        expect(mine({ starter: 'knife', ticks: 120, params: { hold: 0 } }).h.timeline()).toEqual(base.h.timeline());
        const held = mine({ starter: 'knife', ticks: 120, params: { hold: 1 } });
        const first = base.h.sent.find(s => s.action.type === 'useItemOnItem')!.tick;
        const bundle = (h: typeof base.h, t: number) => h.sent.filter(s => s.tick === t).map(s => s.action.type);
        expect(bundle(held.h, first + 1).slice(0, 2)).toEqual(['useItemOnItem', 'clickComponent']);
        expect(bundle(held.h, first)).not.toContain('useItemOnItem');
        expect(held.h.status.counters.held).toBeGreaterThan(0);
    });
});

describe('knife mining', () => {
    test('holds 3 ticks per ore at respawn 13 on the five-rock rotation', () => {
        const { h, rolls } = mine({ starter: 'knife', ticks: 400 });
        expect(rolls.length).toBeGreaterThan(120);
        expect(gapsOf(rolls.slice(3)).every(g => g === 3)).toBe(true);
        const r = h.status.result as { ticksPerOre: number; slips: number; onPredictedTick: number; ores: number };
        expect(r.ticksPerOre).toBe(3);
        expect(r.slips).toBe(0);
        expect(r.onPredictedTick).toBe(r.ores);
    });

    test('a move sends knife, button, drop and walk on the roll label, the click a tick later', () => {
        const { h, rolls } = mine({ starter: 'knife', ticks: 60 });
        const r = rolls[4]!;
        expect(h.sent.filter(s => s.tick === r).map(s => s.action.type)).toEqual(['useItemOnItem', 'clickComponent', 'dropItem', 'walkTo']);
        expect(h.sent.filter(s => s.tick === r + 1).map(s => s.action.type)).toEqual(['interactLoc']);
        expect(h.status.deferred).toBe(0);
    });

    test('the plain fallback runs slower but without slips', () => {
        const { h, rolls } = mine({ starter: 'none', ticks: 400 });
        const r = h.status.result as { ticksPerOre: number; slips: number };
        expect(rolls.length).toBeGreaterThan(80);
        expect(r.slips).toBe(0);
        expect(r.ticksPerOre).toBeGreaterThan(3);
        expect(h.sent.some(s => s.action.type === 'useItemOnItem')).toBe(false);
    });

    test('a lost rock click restarts the rotation and it locks again', () => {
        let dropped = false;
        const { h, rolls } = mine({ starter: 'knife', ticks: 300, drop: (n, type) => { if (!dropped && n > 40 && type === 'interactLoc') { dropped = true; return true; } return false; } });
        const r = h.status.result as { slips: number };
        expect(r.slips).toBe(1);
        const tail = rolls.slice(-30);
        expect(gapsOf(tail).every(g => g === 3)).toBe(true);
    });

    test('a lost starter costs one tick and no slip (closed loop)', () => {
        let dropped = false;
        const { h, rolls } = mine({ starter: 'knife', ticks: 200, drop: (n, type) => { if (!dropped && n > 40 && type === 'useItemOnItem') { dropped = true; return true; } return false; } });
        expect((h.status.result as { slips: number }).slips).toBe(0);
        const g = gapsOf(rolls.slice(3));
        expect(g.filter(x => x !== 3)).toEqual([4]);
    });

    test('ends after the requested ores', () => {
        const { h } = mine({ starter: 'knife', ticks: 1000, params: { ores: 50 } });
        expect(h.status.phase).toBe('done');
        expect((h.status.result as { ores: number }).ores).toBe(50);
    });

    test('faults when a rotation rock is not live at the start', () => {
        const h = new Harness('mine', createKnifeMine);
        h.start('mine', { steps: D13, ores: 5 });
        h.step(makeState({ tick: 1, inventory: ['Knife', 'Logs'] }));
        expect(h.status.phase).toBe('fault');
        expect(h.status.fault).toContain('no live rock');
    });

    test('parses both step forms', () => {
        expect(parseMineSteps('1,2>3,4')).toEqual([{ stand: [1, 2], rock: [3, 4] }]);
        expect(parseMineSteps([{ stand: [1, 2], rock: [3, 4], tiles: 3 }])).toEqual([{ stand: [1, 2], rock: [3, 4], tiles: 3 }]);
        expect(() => parseMineSteps('1,2')).toThrow();
    });
});
