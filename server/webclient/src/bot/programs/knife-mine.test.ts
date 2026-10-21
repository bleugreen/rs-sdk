import { describe, expect, test } from 'bun:test';
import { createKnifeMine, parseMineSteps } from './knife-mine.js';
import { Harness, makeState } from './testkit.js';

// rs/5's zoo-cluster rotation at respawn 13 (tickmanip-mine-run.sh, mining.md section 4)
const D13 = '2604,3235>2605,3235 2602,3235>2602,3236 2603,3234>2602,3234 2603,3233>2602,3233 2605,3234>2605,3233';

// bones-placement.md section 4's `stay2` lap: the east stay (2605,3234) follows a 2-tile
// move, the west stay (2602,3235) a 3-tile move
const STAY2 = '2603,3233>2602,3233 2605,3234>2605,3235 2605,3234>2605,3233 2602,3235>2602,3234 2602,3235>2602,3236';

/**
 * The engine's mining clock (mining.rs2, cut_logs.rs2, as tick-manipulation.md reads it):
 * a swing that finds the clock expired sets it to swing+2 and rolls then; one that
 * finds it ahead or equal rolls when it comes due. A knife starter landing on R+1
 * (clock expired) sets the clock to R+3. Every roll at 63+ succeeds and depletes the
 * rock for `respawn` ticks. A run of up to 2 tiles lands in the walk's own tick.
 * A bury (bury_bone.rs2) stops the interaction, rejects every packet landing on the
 * next tick (p_delay(0)) and gives its Prayer xp then.
 */
function mine(opts: { starter: 'knife' | 'none'; ticks: number; respawn?: number; steps?: string; bones?: number; drop?: (n: number, type: string) => boolean; params?: Record<string, unknown> }) {
    const D = opts.respawn ?? 13;
    const rotation = opts.steps ?? D13;
    const steps = parseMineSteps(rotation);
    const rockTiles = [...new Set(steps.map(s => `${s.rock[0]},${s.rock[1]}`))];
    const h = new Harness('mine', createKnifeMine);
    let tick = 500;
    let xp = 0;
    let prayerXp = 0;
    let bones = opts.bones ?? 0;
    let delayedTo = -1;
    let pos = steps[0]!.stand;
    let clock = 0;
    let target: string | null = null;
    let rollAt: number | null = null;
    const respawnAt = new Map<string, number>();
    const pending: Array<{ at: number; type: string; x?: number; z?: number }> = [];
    const rolls: number[] = [];
    const buries: number[] = [];
    const rejected: Array<{ at: number; type: string }> = [];
    const state = () => makeState({
        tick, x: pos[0], z: pos[1],
        skills: { Mining: { xp }, Prayer: { xp: prayerXp } },
        inventory: ['Rune pickaxe', 'Knife', 'Logs', 'Logs', 'Iron ore', ...Array.from({ length: bones }, () => ({ name: 'Dragon bones', options: ['Bury', 'Drop'] }))],
        locs: rockTiles.map(k => {
            const [x, z] = k.split(',').map(Number);
            const live = (respawnAt.get(k) ?? 0) <= tick;
            return { id: live ? 2092 : 450, x: x!, z: z!, name: live ? 'Rocks' : 'Rocks', options: live ? ['Mine', 'Prospect'] : ['Prospect'] };
        })
    });
    h.start('mine', { steps: rotation, respawn: D, starter: opts.starter, maxTicks: opts.ticks, ...opts.params }, state());
    let n = 0;
    for (let i = 0; i < opts.ticks + 20 && h.status.phase === 'running'; i++) {
        tick++;
        if (delayedTo === tick) {
            bones--;
            prayerXp += 1800;
            buries.push(tick - 2); // the label the bury went out on
        }
        for (const p of pending.filter(p => p.at === tick)) {
            if (tick <= delayedTo) {
                rejected.push(p);
                continue;
            }
            if (p.type === 'useInventoryItem') {
                target = null;
                rollAt = null;
                delayedTo = tick + 1;
                continue;
            }
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
    return { h, rolls, buries, rejected };
}

const gapsOf = (t: number[]) => t.slice(1).map((v, i) => v - t[i]!);
const sends = (h: Harness) => h.sent.map(s => `T${s.tick} ${JSON.stringify(s.action)}`);

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

    test('bury: the stay2 lap buries one bone per lap on its east stay and keeps 3 ticks per ore', () => {
        const { h, rolls, buries, rejected } = mine({ starter: 'knife', ticks: 600, steps: STAY2, bones: 60, params: { bury: true } });
        expect(rejected).toEqual([]);
        expect(gapsOf(rolls.slice(3)).every(g => g === 3)).toBe(true);
        const r = h.status.result as { ores: number; slips: number; buried: number; burySent: number; bonesPerTick: number; noBoneStays: number; longEntryStays: number; transitions: Record<string, number>; ticksPerOre: number };
        expect(r.slips).toBe(0);
        expect(r.ticksPerOre).toBe(3);
        // the lap is 5 ores; its east stay carries the bone, its west stay (3-tile entry) does not
        expect(r.buried).toBe(buries.length);
        expect(Math.abs(r.buried - r.ores / 5)).toBeLessThanOrEqual(1);
        expect(r.transitions['stay+bury']).toBe(r.burySent);
        // every plain stay but the opening click is the west one
        expect(r.longEntryStays).toBe(r.transitions.stay! - 1);
        expect(r.noBoneStays).toBe(0);
        expect(r.bonesPerTick).toBeCloseTo(1 / 15, 2);
        // successive bones 15 ticks apart, each on a roll label
        expect(gapsOf(buries).every(g => g === 15)).toBe(true);
        expect(buries.every(b => rolls.includes(b))).toBe(true);
    });

    test('bury interleave: knife, button, drop and Bury on the roll label, nothing on R+1, the click alone on R+2', () => {
        const { h, rolls, buries } = mine({ starter: 'knife', ticks: 120, steps: STAY2, bones: 10, params: { bury: 'dragon bones' } });
        const R = buries[1]!;
        expect(h.timeline().filter(l => [R, R + 1, R + 2].includes(Number(l.slice(1).split(' ')[0])))).toEqual([
            `T${R} useItemOnItem,clickComponent,dropItem,useInventoryItem`,
            `T${R + 2} interactLoc`
        ]);
        expect(rolls).toContain(R + 3);
        expect(h.status.deferred).toBe(0);
    });

    test('bury unset: the stream is byte-identical with bones in the pack, bury false, or bury and no bones', () => {
        const base = sends(mine({ starter: 'knife', ticks: 300, steps: STAY2 }).h);
        expect(base.some(l => l.includes('useInventoryItem'))).toBe(false);
        expect(sends(mine({ starter: 'knife', ticks: 300, steps: STAY2, bones: 20 }).h)).toEqual(base);
        expect(sends(mine({ starter: 'knife', ticks: 300, steps: STAY2, bones: 20, params: { bury: false } }).h)).toEqual(base);
        expect(sends(mine({ starter: 'knife', ticks: 300, steps: STAY2, params: { bury: true } }).h)).toEqual(base);
        const plain = sends(mine({ starter: 'none', ticks: 300, steps: STAY2 }).h);
        expect(sends(mine({ starter: 'none', ticks: 300, steps: STAY2, bones: 20, params: { bury: true } }).h)).toEqual(plain);
        const r = mine({ starter: 'knife', ticks: 300, steps: STAY2 }).h.status.result as Record<string, unknown>;
        expect(r.buried).toBeUndefined();
    });

    test('bury: running out of bones turns the east stay plain and the lattice holds', () => {
        const { h, rolls } = mine({ starter: 'knife', ticks: 300, steps: STAY2, bones: 3, params: { bury: true } });
        const r = h.status.result as { buried: number; noBoneStays: number; slips: number };
        expect(r.buried).toBe(3);
        expect(r.noBoneStays).toBeGreaterThan(0);
        expect(r.slips).toBe(0);
        expect(gapsOf(rolls.slice(3)).every(g => g === 3)).toBe(true);
    });

    test('bury: the rs/5 lap has no stay, so it buries nothing and is unchanged', () => {
        const { h } = mine({ starter: 'knife', ticks: 200, bones: 20, params: { bury: true } });
        expect(sends(h)).toEqual(sends(mine({ starter: 'knife', ticks: 200 }).h));
        expect((h.status.result as { buried: number }).buried).toBe(0);
    });

    test('bury needs lead 0', () => {
        expect(() => createKnifeMine({ steps: STAY2, ores: 5, lead: 1, bury: true })).toThrow(/lead 0/);
    });

    test('parses both step forms', () => {
        expect(parseMineSteps('1,2>3,4')).toEqual([{ stand: [1, 2], rock: [3, 4] }]);
        expect(parseMineSteps([{ stand: [1, 2], rock: [3, 4], tiles: 3 }])).toEqual([{ stand: [1, 2], rock: [3, 4], tiles: 3 }]);
        expect(() => parseMineSteps('1,2')).toThrow();
    });

    test('a depleted rock (it keeps its Mine option) is not live at the start: fault, no cached id', () => {
        const at = (id: number) => makeState({ tick: 1, x: 2604, z: 3235, inventory: ['Rune pickaxe', 'Knife', 'Logs'], locs: [{ id, x: 2605, z: 3235, name: 'Rocks', options: ['Mine', 'Prospect'] }] });
        const empty = new Harness('mine', createKnifeMine);
        empty.start('mine', { steps: '2604,3235>2605,3235', ores: 5 });
        empty.step(at(450));
        expect(empty.status.phase).toBe('fault');
        expect(empty.status.fault).toContain('no live rock');
        // the same start on the live rock runs and clicks the live id
        const live = new Harness('mine', createKnifeMine);
        live.start('mine', { steps: '2604,3235>2605,3235', ores: 5 });
        live.step(at(2092));
        expect(live.status.phase).toBe('running');
        expect(live.sent.find(s => s.action.type === 'interactLoc')?.action).toMatchObject({ locId: 2092, optionIndex: 1 });
    });
});
