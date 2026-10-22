import { describe, expect, test } from 'bun:test';

import '../../lite/test-support/browser-globals.js';

import { createKnifeMine, failRunLimit, parseMineSteps, parseRate, parseSuccess } from './knife-mine.js';
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
 *
 * Below 63 (`fail`): a failed roll gives nothing, leaves the rock live and the
 * interaction running, which rolls again `rate`+1 later unless a packet interrupts
 * it. A click that swings prints "You swing your pick at the rock.": on landing when
 * the clock is ahead, a tick later when it had expired (`swings: false` hides them).
 */
function mine(opts: {
    starter: 'knife' | 'none';
    ticks: number;
    respawn?: number;
    drop?: (n: number, type: string) => boolean;
    params?: Record<string, unknown>;
    level?: number;
    rate?: number;
    fail?: (n: number, tick: number) => boolean;
    swings?: boolean;
    steps?: string;
    bones?: number;
}) {
    const D = opts.respawn ?? 13;
    const rate = opts.rate ?? 2;
    const list = opts.steps ?? D13;
    const steps = parseMineSteps(list);
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
    const fails: Array<{ tick: number; rock: string }> = [];
    const messages: Array<{ text: string; tick: number; id: number }> = [];
    let swingDue: { at: number; rock: string } | null = null;
    let attempts = 0;
    const swing = () => {
        if (opts.swings !== false) messages.push({ text: 'You swing your pick at the rock.', tick, id: messages.length + 1 });
    };
    const state = () => makeState({
        tick, x: pos[0], z: pos[1],
        skills: { Mining: { xp, level: opts.level ?? 99 }, Prayer: { xp: prayerXp } },
        messages: messages.slice(-10),
        inventory: ['Rune pickaxe', 'Knife', 'Logs', 'Logs', 'Iron ore', ...Array.from({ length: bones }, () => ({ name: 'Dragon bones', options: ['Bury', 'Drop'] }))],
        locs: rockTiles.map(k => {
            const [x, z] = k.split(',').map(Number);
            const live = (respawnAt.get(k) ?? 0) <= tick;
            return { id: live ? 2092 : 450, x: x!, z: z!, name: live ? 'Rocks' : 'Rocks', options: live ? ['Mine', 'Prospect'] : ['Prospect'] };
        })
    });
    h.start('mine', { steps: list, respawn: D, starter: opts.starter, maxTicks: opts.ticks, ...opts.params }, state());
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
                swingDue = null;
                delayedTo = tick + 1;
                continue;
            }
            if (p.type === 'useItemOnItem' && clock < tick) clock = tick + 2;
            if (p.type === 'useItemOnItem' || p.type === 'dropItem' || p.type === 'walkTo') { target = null; rollAt = null; swingDue = null; }
            if (p.type === 'walkTo') pos = [p.x!, p.z!];
            if (p.type === 'interactLoc') {
                const k = `${p.x},${p.z}`;
                if ((respawnAt.get(k) ?? 0) > tick) continue; // depleted: nothing to mine
                target = k;
                swingDue = null;
                if (clock >= tick) { rollAt = clock; swing(); }
                else { clock = tick + rate; rollAt = clock; swingDue = { at: tick + 1, rock: k }; }
            }
        }
        if (swingDue && swingDue.at === tick && target === swingDue.rock) { swing(); swingDue = null; }
        if (target && rollAt === tick) {
            if (opts.fail?.(attempts++, tick)) {
                fails.push({ tick, rock: target });
                clock = tick;
                rollAt = tick + 1 + rate;
            } else {
                xp += 350;
                rolls.push(tick);
                respawnAt.set(target, tick + D);
                target = null;
                rollAt = null;
            }
        }
        for (const s of h.step(state())) {
            if (opts.drop?.(n++, s.action.type)) continue;
            const a = s.action as { type: string; x?: number; z?: number };
            pending.push({ at: tick + 1, type: a.type, x: a.x, z: a.z });
        }
    }
    return { h, rolls, fails, buries, rejected };
}

/** Compact packet timeline (tick offset from the first packet, type and tile). */
function timeline(h: Harness): string {
    const t0 = h.sent[0]?.tick ?? 0;
    return h.sent.map(s => {
        const a = s.action as { type: string; x?: number; z?: number };
        return `${s.tick - t0}:${a.type}${a.x !== undefined ? `@${a.x},${a.z}` : ''}`;
    }).join(' ');
}

/** FNV-1a, enough to pin a timeline. */
function digest(s: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
    return h.toString(16);
}

/** The default-parameter scenarios whose packets must not change with the opt-in parameters. */
const REGRESSION = {
    knife: () => mine({ starter: 'knife', ticks: 300 }),
    plain: () => mine({ starter: 'none', ticks: 300 }),
    lostClick: () => { let d = false; return mine({ starter: 'knife', ticks: 300, drop: (n, type) => (!d && n > 40 && type === 'interactLoc' ? (d = true) : false) }); },
    lostStarter: () => { let d = false; return mine({ starter: 'knife', ticks: 200, drop: (n, type) => (!d && n > 40 && type === 'useItemOnItem' ? (d = true) : false) }); },
    plainD19: () => mine({ starter: 'none', ticks: 300, respawn: 19 })
};

const gapsOf = (t: number[]) => t.slice(1).map((v, i) => v - t[i]!);
const sends = (h: Harness) => h.sent.map(s => `T${s.tick} ${JSON.stringify(s.action)}`);

/** Digests of REGRESSION's timelines with main@8233253b's knife-mine.ts (no `success`, no `rate`). */
const GOLDEN: Record<string, string> = { knife: 'f066cb32', plain: '42c89bd8', lostClick: 'c016c8ef', lostStarter: '4b15bada', plainD19: 'c0b9ff8b' };

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

    test('without the opt-in parameters, every packet is as before (golden timelines from main@8233253b)', () => {
        const got = Object.fromEntries(Object.entries(REGRESSION).map(([k, run]) => [k, digest(timeline(run().h))]));
        expect(got).toEqual(GOLDEN);
    });

    test('selfStarter is inert under the knife and false is the default: the same packets', () => {
        for (const [starter, respawn, sel] of [['knife', 13, true], ['knife', 19, true], ['none', 13, false], ['none', 19, false]] as const) {
            const base = mine({ starter, ticks: 300, respawn });
            expect(timeline(mine({ starter, ticks: 300, respawn, params: { selfStarter: sel } }).h)).toBe(timeline(base.h));
        }
    });

    test('selfStarter: plain on the five-rock lap tricks on the next rock itself, 18 ticks per lap at D=13 and D=15', () => {
        for (const respawn of [13, 15]) {
            const { h, rolls } = mine({ starter: 'none', ticks: 600, respawn, params: { selfStarter: true } });
            const r = h.status.result as { slips: number; transitions: Record<string, number>; onPredictedTick: number; ores: number };
            expect(r.slips).toBe(0);
            expect(r.onPredictedTick).toBe(r.ores);
            const g = gapsOf(rolls.slice(5));
            // per lap: two trick transitions of 3 and three plain ones of 4
            const laps = Math.floor(g.length / 5);
            expect(g.slice(0, laps * 5).reduce((a, b) => a + b, 0)).toBe(laps * 18);
            expect(r.transitions.trick).toBeGreaterThan(0);
            expect(h.sent.some(s => s.action.type === 'useItemOnItem')).toBe(false);
        }
        // without it the same lap never tricks: 4 ticks per ore
        const plain = mine({ starter: 'none', ticks: 600 });
        expect((plain.h.status.result as { transitions: Record<string, number> }).transitions.trick).toBe(0);
    });

    test('success at 63+ and rate 2 are inert: the same packets as without them', () => {
        for (const [starter, respawn] of [['knife', 13], ['none', 13], ['none', 19]] as const) {
            const base = mine({ starter, ticks: 300, respawn });
            const opt = mine({ starter, ticks: 300, respawn, level: 63, params: { success: 'iron', rate: 2 } });
            expect(timeline(opt.h)).toBe(timeline(base.h));
            expect((opt.h.status.result as { failed: number }).failed).toBe(0);
        }
    });

    test('a failed roll with its swing seen is planned from like a success: no slip, the next roll 3 ticks on', () => {
        const { h, rolls, fails } = mine({ starter: 'knife', ticks: 400, level: 30, params: { success: 'iron' }, fail: n => n > 6 && n % 4 === 0 });
        const r = h.status.result as { slips: number; failed: number; ores: number };
        expect(fails.length).toBeGreaterThan(20);
        expect(r.slips).toBe(0);
        expect(r.failed).toBe(fails.length);
        // every attempt, success or failure, 3 ticks after the one before
        const attempts = [...rolls, ...fails.map(f => f.tick)].sort((a, b) => a - b);
        expect(gapsOf(attempts.slice(3)).every(g => g === 3)).toBe(true);
        // the transition after a failure goes out on the failed roll's own label
        const f = fails[3]!.tick;
        expect(h.sent.filter(s => s.tick === f).map(s => s.action.type)).toEqual(['useItemOnItem', 'clickComponent', 'dropItem', 'walkTo']);
    });

    test('a failed rock stays schedulable: its next visit does not wait for a respawn', () => {
        // respawn 20 on the 15-tick five-rock lap: every depleted rock makes the next visit wait
        const { h, fails } = mine({ starter: 'knife', ticks: 300, respawn: 20, level: 30, params: { success: 'iron' }, fail: n => n === 12 });
        expect(fails.length).toBe(1);
        const rock = fails[0]!.rock;
        const plans = h.logs.filter(l => /plan #\d+ \w+ .* rock /.test(l));
        const failLine = h.logs.findIndex(l => l.includes(`failed roll@${fails[0]!.tick}`));
        expect(failLine).toBeGreaterThan(-1);
        const next = h.logs.slice(failLine).find(l => l.includes(`rock ${rock} `) && l.includes('plan #'))!;
        expect(next).toContain(' starter ');
        expect(plans.filter(l => l.includes(' waited ')).length).toBeGreaterThan(5);
    });

    test('a miss without the swing message is left to the default handling, packet for packet', () => {
        // the player keeps mining the rock and rolls again rate+1 later: a late roll, or past
        // the slack a slip, exactly as without `success`
        for (const rate of [2, 7]) {
            const fail = (n: number) => n === 12 || n === 30;
            const base = mine({ starter: 'knife', ticks: 300, level: 30, rate, swings: false, fail, params: { rate } });
            const opt = mine({ starter: 'knife', ticks: 300, level: 30, rate, swings: false, fail, params: { success: 'iron', rate } });
            expect(timeline(opt.h)).toBe(timeline(base.h));
            const r = opt.h.status.result as { slips: number; failed: number };
            expect(r.failed).toBe(0);
            expect(r.slips).toBe(rate === 7 ? 2 : 0);
        }
    });

    test('a lost starter is late, not failed: one tick and no slip, as without success', () => {
        let dropped = false;
        const { h, rolls } = mine({ starter: 'knife', ticks: 200, level: 30, params: { success: 'iron' }, drop: (n, type) => (!dropped && n > 40 && type === 'useItemOnItem' ? (dropped = true) : false) });
        const r = h.status.result as { slips: number; failed: number };
        expect(r.slips).toBe(0);
        expect(r.failed).toBe(0);
        expect(gapsOf(rolls.slice(3)).filter(x => x !== 3)).toEqual([4]);
    });

    test('a run of misses the success chance does not explain is not taken for failures', () => {
        // level 62: 254/256, so one miss in a row is plausible and a second is not: it is
        // left to the default handling (here a late roll on the same rock)
        const { h, fails } = mine({ starter: 'knife', ticks: 300, level: 62, params: { success: 'iron' }, fail: n => n === 12 || n === 13 });
        const r = h.status.result as { slips: number; failed: number };
        expect(fails.length).toBe(2);
        expect(r.failed).toBe(1);
        expect(r.slips).toBe(0);
    });

    test('plain with a mithril pickaxe (rate 4) predicts every roll, failures included', () => {
        const { h, rolls, fails } = mine({ starter: 'none', ticks: 400, level: 25, rate: 4, params: { success: 'iron', rate: [[41, 2], [31, 3], [21, 4], [6, 5], [0, 7]] }, fail: n => n > 4 && n % 3 === 0 });
        const r = h.status.result as { slips: number; failed: number; onPredictedTick: number; ores: number };
        expect(fails.length).toBeGreaterThan(10);
        expect(r.slips).toBe(0);
        expect(r.failed).toBe(fails.length);
        expect(r.onPredictedTick).toBe(r.ores);
        expect(rolls.length).toBe(r.ores);
    });

    test('the knife holds 3 ticks with a bronze pickaxe (rate 7): the starter sets the clock whatever the tier', () => {
        const { h, rolls } = mine({ starter: 'knife', ticks: 300, level: 20, rate: 7, params: { success: 'iron', rate: 7 } });
        expect(gapsOf(rolls.slice(3)).every(g => g === 3)).toBe(true);
        expect((h.status.result as { slips: number }).slips).toBe(0);
    });

    test('parses success, rate and the miss-run limit', () => {
        expect(parseSuccess(undefined)).toBeNull();
        expect(parseSuccess('iron')).toEqual([96, 350]);
        expect(parseSuccess([128, 400])).toEqual([128, 400]);
        expect(() => parseSuccess('copper')).toThrow();
        expect(parseRate(undefined)(10)).toBe(2);
        const r = parseRate([[41, 2], [31, 3], [21, 4], [6, 5], [0, 7]]);
        expect([1, 6, 20, 21, 35, 41, 99].map(r)).toEqual([7, 5, 5, 4, 3, 2, 2]);
        expect(() => parseRate(0)).toThrow();
        expect(failRunLimit(1)).toBe(0);
        expect(failRunLimit(254 / 256)).toBe(1);
        expect(failRunLimit(133 / 256)).toBe(6); // 0.48^7 < 1% <= 0.48^6
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
