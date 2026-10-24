import { describe, expect, test } from 'bun:test';

import '../../lite/test-support/browser-globals.js';

import type { NearbyPlayer } from '../types.js';
import { canAttack, classifyHit, createAgility, DEFAULT_THREAT, threatOf, wildernessLevel, type Me } from './agility.js';
import { AGILITY_COURSES, stepFromPosition, zoneAt, type AgilityCourse } from './agility-courses.js';
import { Harness, makeState, type StateSpec } from './testkit.js';

const COURSE: AgilityCourse = {
    start: [3000, 3000, 0],
    lapBonus: 40,
    resume: { b: 'a' },
    steps: [
        { name: 'a', locs: [[1, 3001, 3000]], xp: 10 },
        { name: 'b', locs: [[2, 3002, 3000]], xp: 10 },
        { name: 'c', locs: [[3, 3003, 3000]], xp: 10 + 40 }
    ]
};
const DURATION: Record<number, number> = { 1: 5, 2: 7, 3: 6 };

/** Each obstacle completes `DURATION[id]` ticks after its click lands; `failAt` makes that click fail. */
function run(opts: { ticks: number; params?: Record<string, unknown>; failClick?: number; spec?: (tick: number, xp: number) => Partial<StateSpec> }) {
    const h = new Harness('agl', createAgility);
    let tick = 50;
    let xp = 0;
    const msgs: Array<{ text: string; tick: number }> = [];
    const done: Array<{ at: number; id: number; ok: boolean }> = [];
    const completions: Array<{ tick: number; id: number }> = [];
    const xpOf: Record<number, number> = { 1: 10, 2: 10, 3: 50 };
    let clicks = 0;
    const state = () => makeState({
        tick,
        skills: { Agility: { xp: xp * 25 } },
        locs: [1, 2, 3].map(id => ({ id, x: 3000 + id, z: 3000, name: `obstacle ${id}`, options: ['Cross'] })),
        messages: msgs.slice(-10),
        ...opts.spec?.(tick, xp)
    });
    h.start('agl', { course: COURSE, maxTicks: opts.ticks, ...opts.params }, state());
    const pending: Array<{ at: number; id: number }> = [];
    for (let i = 0; i < opts.ticks + 5 && h.status.phase === 'running'; i++) {
        tick++;
        for (const p of pending.filter(p => p.at === tick)) {
            const fail = clicks++ === opts.failClick;
            done.push({ at: tick + (fail ? 2 : DURATION[p.id]!), id: p.id, ok: !fail });
        }
        for (const d of done.filter(d => d.at === tick)) {
            if (d.ok) { xp += xpOf[d.id]!; completions.push({ tick, id: d.id }); }
            else msgs.push({ text: 'You slip and fall.', tick });
        }
        for (const s of h.step(state())) if (s.action.type === 'interactLoc') pending.push({ at: tick + 1, id: s.action.locId });
    }
    return { h, completions };
}

describe('agility course', () => {
    test('clicks the next obstacle on the label that shows the previous one done', () => {
        const { h, completions } = run({ ticks: 200 });
        const clickTicks = h.sent.filter(s => s.action.type === 'interactLoc').map(s => s.tick);
        for (const c of completions.filter(c => c.tick < h.status.endedTick!)) expect(clickTicks).toContain(c.tick);
        // a lap is 3 clicks of 1 tick latency plus 5 + 7 + 6
        const r = h.status.result as { ticksPerLap: number; laps: number };
        expect(r.ticksPerLap).toBe(21);
        expect(r.laps).toBeGreaterThan(8);
    });

    test('the plain fallback waits a tick after each completion', () => {
        const { h } = run({ ticks: 200, params: { technique: 'plain', settleTicks: 1 } });
        expect((h.status.result as { ticksPerLap: number }).ticksPerLap).toBe(24);
    });

    test('a fall waits for the fail script and resumes at the course resume step', () => {
        const { h } = run({ ticks: 120, failClick: 1 }); // the first 'b' fails
        expect(h.status.counters.fails).toBe(1);
        const order = h.sent.filter(s => s.action.type === 'interactLoc').map(s => (s.action as { locId: number }).locId);
        // a, b (fail), then back to a per resume, then b, c
        expect(order.slice(0, 5)).toEqual([1, 2, 1, 2, 3]);
    });

    test('ends after the requested laps', () => {
        const { h } = run({ ticks: 500, params: { laps: 4, maxTicks: undefined } });
        expect(h.status.phase).toBe('done');
        expect((h.status.result as { laps: number }).laps).toBe(4);
    });

    test('knows the lab courses by name', () => {
        expect(() => createAgility({ course: 'wilderness', laps: 1 })).not.toThrow();
        expect(() => createAgility({ course: 'nowhere', laps: 1 })).toThrow(/unknown course/);
        expect(() => createAgility({ course: 'gnome' })).toThrow(/untilLevel/);
    });

    test('untilLevel ends the tick the level is reached, mid-lap, and logs each level crossed', () => {
        // level 1 + one per 25 base xp: the lap's last obstacle (xp 20 -> 70) crosses 2 and 3, the next one (80) makes 4
        const { h, completions } = run({ ticks: 500, params: { maxTicks: undefined, untilLevel: 4 }, spec: (_t, xp) => ({ skills: { Agility: { xp: xp * 25, level: 1 + Math.floor(xp / 25) } } }) });
        const r = h.status.result as { ended: string; levelTicks: Record<number, number>; laps: number };
        expect(h.status.phase).toBe('done');
        expect(r.ended).toBe('level');
        expect(r.laps).toBe(1);
        expect(h.status.endedTick).toBe(completions[3]!.tick);
        expect(r.levelTicks[2]).toBe(completions[2]!.tick);
        expect(r.levelTicks[3]).toBe(completions[2]!.tick);
        expect(r.levelTicks[4]).toBe(completions[3]!.tick);
    });

    describe("untilLevelAt 'lap'", () => {
        // level 1 + one per 25 base xp, as above: lap 1's last obstacle makes 3, lap 2's first makes 4
        const levels = (_t: number, xp: number) => ({ skills: { Agility: { xp: xp * 25, level: 1 + Math.floor(xp / 25) } } });
        const lapRun = (untilLevel: number, extra: Record<string, unknown> = {}, spec: (t: number, xp: number) => Partial<StateSpec> = levels) =>
            run({ ticks: 500, params: { maxTicks: undefined, untilLevel, ...extra }, spec });
        const clicks = (h: Harness) => h.sent.filter(s => s.action.type === 'interactLoc').map(s => [s.tick, (s.action as { locId: number }).locId]);

        test('the level reached mid-lap: it clicks the rest of the lap and ends at its close, on the ground', () => {
            const { h, completions } = lapRun(4, { untilLevelAt: 'lap' });
            const levelTick = completions[3]!.tick; // lap 2's first obstacle
            const r = h.status.result as { ended: string; laps: number; levelTicks: Record<number, number>; afterLevel: { ticks: number; obstacles: number } };
            expect(h.status.phase).toBe('done');
            expect(r.ended).toBe('level');
            expect(r.levelTicks[4]).toBe(levelTick);
            // the lap's other two obstacles, then the end on the lap bonus's tick
            expect(clicks(h).filter(([t]) => t! >= levelTick).map(([, id]) => id)).toEqual([2, 3]);
            expect(h.status.endedTick).toBe(completions[5]!.tick);
            expect(r.laps).toBe(2);
            expect(r.afterLevel).toEqual({ ticks: completions[5]!.tick - levelTick, obstacles: 2 });
            // up to the level tick it sends what the tick end sends
            const tickEnd = lapRun(4).h;
            expect(tickEnd.status.endedTick).toBe(levelTick);
            expect(clicks(h).filter(([t]) => t! < levelTick)).toEqual(clicks(tickEnd));
        });

        test("the level reached on the lap's last obstacle: it ends at once, as the tick end does", () => {
            const { h, completions } = lapRun(3, { untilLevelAt: 'lap' });
            const tickEnd = lapRun(3).h;
            expect(h.status.endedTick).toBe(completions[2]!.tick);
            expect(tickEnd.status.endedTick).toBe(completions[2]!.tick);
            expect(h.sent).toEqual(tickEnd.sent);
            expect(h.status.result).toMatchObject({ ended: 'level', laps: 1, afterLevel: { ticks: 0, obstacles: 0 } });
        });

        test("absent, or 'tick', it ends on the level tick, packet for packet the same", () => {
            const absent = lapRun(4).h;
            const tick = lapRun(4, { untilLevelAt: 'tick' }).h;
            expect(tick.sent).toEqual(absent.sent);
            expect(tick.status.endedTick).toBe(absent.status.endedTick);
            expect(tick.status.result).toEqual(absent.status.result);
            expect(absent.status.result).not.toHaveProperty('afterLevel');
        });

        test('it needs untilLevel, and takes only tick or lap', () => {
            expect(() => createAgility({ course: 'gnome', laps: 1, untilLevelAt: 'lap' })).toThrow(/needs untilLevel/);
            expect(() => createAgility({ course: 'gnome', untilLevel: 25, untilLevelAt: 'ground' })).toThrow(/untilLevelAt/);
            expect(() => createAgility({ course: 'gnome', untilLevel: 25, untilLevelAt: 'lap' })).not.toThrow();
        });

        test('in the Wilderness, a player, a player hit or no food still ends it at once, mid-lap', () => {
            // the level comes at lap 2's first obstacle (tick 78); each exit fires at 82, before the lap closes at 93
            const W = { x: 3004, z: 3940 };
            const pker = { index: 7, name: 'pker', x: W.x + 1, z: W.z, combatLevel: 40, combatTargetType: 'player' as const, inCombat: true };
            const cases: Array<{ ended: string; params: Record<string, unknown>; spec: (t: number) => Partial<StateSpec> }> = [
                { ended: 'player', params: { pauseFor: 'any' }, spec: t => ({ players: t >= 82 ? [pker] : [] }) },
                {
                    ended: 'attacked',
                    params: { pauseFor: 'none' },
                    spec: t => ({
                        players: t >= 82 ? [pker] : [],
                        combatEvents: t >= 82 ? [{ tick: 82, type: 'damage_taken' as const, damage: 3, sourceType: 'other_player' as const, sourceIndex: 7, targetType: 'player' as const, targetIndex: -1 }] : []
                    })
                },
                { ended: 'no-food', params: { eatBelow: 50, eatGap: 3 }, spec: t => ({ hp: t >= 82 ? 30 : 99 }) }
            ];
            for (const c of cases) {
                const { h, completions } = lapRun(4, { untilLevelAt: 'lap', ...c.params }, (t, xp) => ({ ...W, ...levels(t, xp), ...c.spec(t) }));
                expect(completions[3]!.tick).toBe(78);
                expect(h.status.result).toMatchObject({ ended: c.ended, level: 4 });
                expect(h.status.endedTick).toBe(82);
            }
        });

        /** A lap whose middle step has two pipes (ids 2 and 4); a click landing while `locked(id, tick)` is refused with the game's message and no xp. */
        function pipeRun(locked: (id: number, tick: number) => boolean, params: Record<string, unknown>) {
            const course: AgilityCourse = {
                start: [3000, 3000, 0],
                lapBonus: 40,
                steps: [
                    { name: 'a', locs: [[1, 3001, 3000]], xp: 10 },
                    { name: 'pipe', locs: [[2, 3002, 3000], [4, 3004, 3000]], xp: 10 },
                    { name: 'c', locs: [[3, 3003, 3000]], xp: 10 + 40 }
                ]
            };
            const dur: Record<number, number> = { 1: 5, 2: 7, 4: 7, 3: 6 };
            const gain: Record<number, number> = { 1: 10, 2: 10, 4: 10, 3: 50 };
            const h = new Harness('agl', createAgility);
            let tick = 50;
            let xp = 0;
            const msgs: Array<{ text: string; tick: number }> = [];
            const done: Array<{ at: number; id: number }> = [];
            const pending: Array<{ at: number; id: number }> = [];
            const state = () => makeState({
                tick, x: 3000, z: 3000, messages: msgs.slice(-10),
                skills: { Agility: { xp: xp * 25, level: 1 + Math.floor(xp / 25) } },
                locs: [1, 2, 3, 4].map(id => ({ id, x: 3000 + id, z: 3000, name: `obstacle ${id}`, options: ['Cross'] }))
            });
            h.start('agl', { course, ...params }, state());
            for (let k = 0; k < 300 && h.status.phase === 'running'; k++) {
                tick++;
                for (const p of pending.filter(q => q.at === tick)) {
                    if (locked(p.id, tick)) msgs.push({ text: 'The pipe is being used', tick });
                    else done.push({ at: tick + dur[p.id]!, id: p.id });
                }
                for (const d of done.filter(q => q.at === tick)) xp += gain[d.id]!;
                for (const s of h.step(state())) if (s.action.type === 'interactLoc') pending.push({ at: tick + 1, id: s.action.locId });
            }
            return h;
        }
        // the level (4) comes with lap 2's first obstacle at tick 78, and its pipe click goes out then and lands at 79
        const finish = { untilLevel: 4, untilLevelAt: 'lap', stepTimeout: 40 };

        test('finishing the lap, a pipe another player holds sends the click to the other pipe on the same tick', () => {
            const h = pipeRun((id, t) => id === 2 && t >= 75, finish);
            expect(clicks(h).filter(([t]) => t! >= 78)).toEqual([[78, 2], [79, 4], [87, 3]]);
            // the lap's close (xp 140) is level 6 in this fake
            expect(h.status.result).toMatchObject({ ended: 'level', level: 6, levelTicks: { 4: 78 }, afterLevel: { obstacles: 2 } });
            expect(h.status.counters.inUse).toBe(1);
            expect(h.status.endedTick).toBe(94);
        });

        test('both pipes held: it re-clicks the first to come free inside its lock window, and still ends on the ground', () => {
            const h = pipeRun((id, t) => (id === 2 && t >= 75 && t <= 85) || (id === 4 && t >= 75 && t <= 88), finish);
            const after = clicks(h).filter(([t]) => t! >= 78);
            expect(after.map(([, id]) => id)).toEqual([2, 4, 2, 3]);
            // pipe 2 was refused at 79: back to it once its 12-tick lock has surely lapsed, not at stepTimeout
            expect(after[2]![0]).toBe(79 + 13);
            expect(h.status.result).toMatchObject({ ended: 'level', level: 6, levelTicks: { 4: 78 } });
            expect(h.status.counters.inUse).toBe(2);
        });

        test('before the level is reached a held pipe is waited out as today (the switch is for finishing the lap only)', () => {
            // lap 1's pipe click goes out at 57 and lands at 58
            const h = pipeRun((id, t) => id === 2 && t >= 55 && t <= 60, finish);
            expect(clicks(h).some(([t, id]) => id === 4 && t! < 57 + 40)).toBe(false);
            expect(h.status.counters.inUse).toBeUndefined();
        });

        /** The real Gnome course from (x, z, plane), each click done 4 ticks after it lands; the pipe pays its own 7.5 and the bonus only on a lap seen from its start. */
        function gnomeFrom(x: number, z: number, plane: number, params: Record<string, unknown>, level = 25) {
            const course = AGILITY_COURSES.gnome!;
            const xpOf: Record<number, number> = {};
            const locs: Array<{ id: number; x: number; z: number; name: string; options: string[] }> = [];
            for (const st of course.steps) for (const [id, lx, lz] of st.locs) {
                xpOf[id] = st.xp;
                if (!locs.some(l => l.id === id && l.x === lx && l.z === lz)) locs.push({ id, x: lx, z: lz, name: `loc ${id}`, options: ['Cross'] });
            }
            const h = new Harness('agl', createAgility);
            let tick = 50;
            let xp = 0;
            let seenFromLog = false;
            const pending: Array<{ at: number; id: number }> = [];
            const done: Array<{ at: number; id: number }> = [];
            const state = () => makeState({ tick, x, z, level: plane, skills: { Agility: { xp: Math.round(xp * 25), level } }, locs });
            h.start('agl', { course: 'gnome', startStep: 'auto', ...params }, state());
            for (let k = 0; k < 200 && h.status.phase === 'running'; k++) {
                tick++;
                for (const p of pending.filter(q => q.at === tick)) done.push({ at: tick + 4, id: p.id });
                for (const d of done.filter(q => q.at === tick)) {
                    if (d.id === 2295) seenFromLog = true;
                    const pipe = d.id === 154 || d.id === 4058;
                    xp += pipe ? 7.5 + (seenFromLog ? 39 : 0) : xpOf[d.id]!;
                    if (pipe) { seenFromLog = false; x = d.id === 154 ? 2484 : 2487; z = 3437; plane = 0; }
                }
                for (const s of h.step(state())) if (s.action.type === 'interactLoc') pending.push({ at: tick + 1, id: s.action.locId });
            }
            return h;
        }

        test('a lap joined partway pays no bonus: the pipe is done on its own 7.5, and the level band ends there on the ground', () => {
            const h = gnomeFrom(2487, 3420, 0, { untilLevel: 25, untilLevelAt: 'lap' }); // down the tree, before the second net
            expect(clicks(h).map(([, id]) => id)).toEqual([2286, 154]);
            expect(h.status.result).toMatchObject({ ended: 'level', laps: 0, afterLevel: { obstacles: 2 } });
            expect(h.status.endedTick).toBe(51 + 5 + 5);
        });

        test('without the new keys, a partway start still goes on after a bonusless pipe (no stall), and the next lap needs its bonus as before', () => {
            const h = gnomeFrom(2487, 3420, 0, { laps: 1 }, 10);
            const ids = clicks(h).map(([, id]) => id);
            expect(ids.slice(0, 3)).toEqual([2286, 154, 2295]); // the log, on the tick the pipe's 7.5 lands
            expect(clicks(h)[2]![0]).toBe(61);
            expect(h.status.result).toMatchObject({ ended: 'laps', laps: 1 });
            expect(ids.slice(2)).toEqual([2295, 2285, 2313, 2312, 2315, 2286, 154]);
        });

        test('a Gnome resume on the rope platform with the level reached finishes the lap from the tree; at the lap start it ends at once', () => {
            const gnome = { course: 'gnome', untilLevel: 25, untilLevelAt: 'lap', startStep: 'auto' };
            const at = (tick: number, x: number, z: number, level: number) => makeState({ tick, x, z, level, skills: { Agility: { xp: 8740 * 10, level: 25 } } });
            const h = new Harness('agl', createAgility);
            h.start('agl', gnome, at(1, 2483, 3420, 2));
            expect(h.step(at(2, 2483, 3420, 2)).map(s => s.action)).toMatchObject([{ type: 'interactLoc', locId: 2314 }]); // tree-down
            expect(h.status.phase).toBe('running');
            const atEnd = new Harness('agl', createAgility);
            atEnd.start('agl', gnome, at(1, 2484, 3437, 0));
            expect(atEnd.step(at(2, 2484, 3437, 0))).toEqual([]);
            expect(atEnd.status.result).toMatchObject({ ended: 'level', afterLevel: { ticks: 0, obstacles: 0 } });
        });
    });

    test('with eatGap, eats while waiting on an obstacle, at most once per eat gap', () => {
        let hp = 99;
        const { h } = run({
            ticks: 40,
            params: { eatBelow: 50, eatGap: 3, food: '^cake$' },
            spec: t => {
                if (t === 54) hp = 40; // between clicks, inside the first obstacle's wait
                return { hp, inventory: [{ name: 'Cake', options: ['Eat'] }] };
            }
        });
        const eats = h.sent.filter(s => s.action.type === 'useInventoryItem');
        expect(eats[0]!.tick).toBe(54);
        expect(h.sent.some(s => s.tick === 54 && s.action.type === 'interactLoc')).toBe(false);
        // HP never rises in this fake, so it eats again every 3 ticks
        expect(eats.map(e => e.tick).slice(0, 3)).toEqual([54, 57, 60]);
    });

    test("eatAt 'land' holds an eat through the obstacle wait and sends it just before the next click", () => {
        let hp = 99;
        const { h } = run({
            ticks: 40,
            params: { eatBelow: 50, eatGap: 3, eatAt: 'land', food: '^cake$' },
            spec: t => {
                if (t === 54) hp = 40;
                return { hp, inventory: [{ name: 'Cake', options: ['Eat'] }] };
            }
        });
        const clicks = h.sent.filter(s => s.action.type === 'interactLoc').map(s => s.tick);
        const eats = h.sent.filter(s => s.action.type === 'useInventoryItem');
        const nextClick = clicks.find(c => c > 54)!;
        expect(eats[0]!.tick).toBe(nextClick);
        // same tick, eat first: the click sets the interaction the eat cleared
        const order = h.sent.filter(s => s.tick === nextClick).map(s => s.action.type);
        expect(order).toEqual(['useInventoryItem', 'interactLoc']);
        // never inside a wait: every eat is on a click tick
        for (const e of eats) expect(clicks).toContain(e.tick);
    });

    test("eatAt 'land' eats at once mid-wait when HP is within a skeleton hit of death", () => {
        let hp = 99;
        const { h } = run({
            ticks: 20,
            params: { eatBelow: 6, eatGap: 3, eatAt: 'land', food: '^cake$' },
            spec: t => {
                if (t === 54) hp = 3;
                return { hp, inventory: [{ name: 'Cake', options: ['Eat'] }] };
            }
        });
        expect(h.sent.find(s => s.action.type === 'useInventoryItem')!.tick).toBe(54);
    });

    test("eatAt 'land' needs eatGap", () => {
        expect(() => createAgility({ course: 'wilderness', laps: 1, eatBelow: 6, eatAt: 'land' })).toThrow(/needs eatGap/);
        expect(() => createAgility({ course: 'wilderness', laps: 1, eatAt: 'sometimes' })).toThrow(/eatAt/);
    });

    test('with eatGap, ends no-food when HP is at or below eatBelow and nothing is left to eat', () => {
        const { h } = run({ ticks: 40, params: { eatBelow: 50, eatGap: 3 }, spec: t => ({ hp: t >= 55 ? 30 : 99 }) });
        expect(h.status.phase).toBe('done');
        expect((h.status.result as { ended: string }).ended).toBe('no-food');
        expect(h.status.endedTick).toBe(55);
    });

    test('restockBelow ends low-food between obstacles when the food runs down', () => {
        const { h } = run({ ticks: 100, params: { restockBelow: 4 }, spec: t => ({ inventory: Array.from({ length: t >= 60 ? 4 : 6 }, () => 'Shark') }) });
        expect(h.status.phase).toBe('done');
        expect(h.status.result).toMatchObject({ ended: 'low-food', food: 4 });
        // never mid-obstacle: the end tick is a click tick, where the next obstacle would have been clicked
        expect(h.sent.filter(s => s.action.type === 'interactLoc' && s.tick >= h.status.endedTick!)).toEqual([]);
    });

    test('a death faults the run', () => {
        const { h } = run({ ticks: 40, spec: t => ({ lifeId: t >= 60 ? 1 : 0 }) });
        expect(h.status.phase).toBe('fault');
        expect(h.status.fault).toBe('died');
    });

    test('in the Wilderness: a fall hit is the fall, a hit with a skeleton beside us is npcDamage, a player hit ends the run (with pauseFor given)', () => {
        const WILD = { x: 3004, z: 3940 };
        const hit = (tick: number, damage: number, sourceType: 'npc' | 'other_player', sourceIndex = -1) => ({ tick, type: 'damage_taken' as const, damage, sourceType, sourceIndex, targetType: 'player' as const, targetIndex: -1 });
        let events: ReturnType<typeof hit>[] = [];
        const attempt = (params: Record<string, unknown>) => run({
            ticks: 200,
            failClick: 1,
            params,
            spec: t => {
                // the fake's fall message for click 1 lands at tick 60; a hit then is the fall's
                if (t === 60) events.push(hit(60, 2, 'npc'));
                if (t === 80) events.push(hit(80, 3, 'npc'));
                if (t === 100) events.push(hit(100, 4, 'other_player', 7));
                return {
                    ...WILD,
                    combatEvents: events.slice(),
                    npcs: t >= 80 && t < 90 ? [{ index: 3, name: 'Skeleton', x: WILD.x + 1, z: WILD.z, targetIndex: 32768 + 12 }] : [],
                    players: t >= 100 ? [{ index: 7, name: 'pker', x: WILD.x + 1, z: WILD.z, combatLevel: 40, combatTargetType: 'player', inCombat: true }] : []
                };
            }
        });
        const { h } = attempt({ pauseFor: 'none' });
        const r = h.status.result as { ended: string; fallDamage: number; npcDamage: number; attacker: { name: string } };
        expect(r.fallDamage).toBe(2);
        expect(r.npcDamage).toBe(3);
        expect(r.ended).toBe('attacked');
        expect(r.attacker.name).toBe('pker');
        expect(h.status.endedTick).toBe(100);
        // without pauseFor the hit is counted and the run carries on, as before the watch
        events = [];
        const quiet = attempt({}).h.status.result as { ended: string; playerDamage: number };
        expect(quiet).toMatchObject({ ended: 'maxTicks', playerDamage: 4 });
    });

    test('players are logged as sightings; the pause rule decides whether one ends the run', () => {
        const WILD = { x: 3004, z: 3940 };
        const spec = (t: number) => ({ ...WILD, players: t >= 60 ? [{ index: 9, name: 'walker', x: WILD.x + 5, z: WILD.z, combatLevel: 20 }] : [] });
        const none = run({ ticks: 100, spec }).h.status.result as { ended: string; sightings: Array<{ name: string; any: boolean; canAttack: boolean; threat?: string }>; wouldPause: { any: number; threat: number } };
        expect(none.ended).toBe('maxTicks');
        expect(none.sightings).toMatchObject([{ name: 'walker', any: true, canAttack: true }]);
        expect(none.sightings[0]!.threat).toBeUndefined();
        expect(none.wouldPause).toEqual({ any: 1, threat: 0 });
        // standing still 5 tiles off is no threat; 'any' pauses for it
        expect((run({ ticks: 100, spec, params: { pauseFor: 'threat' } }).h.status.result as { ended: string }).ended).toBe('maxTicks');
        const any = run({ ticks: 100, spec, params: { pauseFor: 'any' } }).h;
        expect((any.status.result as { ended: string; player: { name: string; why: string } }).player).toMatchObject({ name: 'walker', why: 'any' });
        expect(any.status.endedTick).toBe(60);
    });

    test('with none of the opt-in keys it sends what it sent before them, packet for packet (addendum 6)', () => {
        // Wilderness tile, a skeleton and two attackable players beside us, NPC hits and a player's hit,
        // a fall, and HP under eatBelow on and off: every new path is in reach, none of their keys is given.
        // The expected packets are main's program (before untilLevel, eatGap, restockBelow, protect* and
        // the Wilderness watch) on this same script.
        const W = { x: 3004, z: 3940 };
        const hit = (tick: number, damage: number, sourceType: 'npc' | 'other_player', sourceIndex: number) => ({ tick, type: 'damage_taken' as const, damage, sourceType, sourceIndex, targetType: 'player' as const, targetIndex: -1 });
        const { h } = run({
            ticks: 150,
            failClick: 1,
            params: { eatBelow: 50 },
            spec: t => ({
                ...W,
                combatLevel: 60,
                hp: t % 30 < 4 ? 40 : 80,
                inventory: [{ name: 'Cake', options: ['Eat'] }, { name: 'Shrimps', options: ['Eat'] }],
                npcs: [{ index: 3, name: 'Skeleton', x: W.x + 1, z: W.z, targetIndex: 32768 + 12 }],
                players: [
                    { index: 7, name: 'fighter', x: W.x + 2, z: W.z, combatLevel: 61, combatTargetType: 'player', inCombat: true },
                    { index: 8, name: 'walker', x: W.x + 12 - Math.min(9, Math.max(0, t - 80)), z: W.z + 3, combatLevel: 58 }
                ],
                combatEvents: [hit(70, 2, 'npc', 3), hit(95, 1, 'npc', 3), hit(110, 4, 'other_player', 7)].filter(e => e.tick <= t)
            })
        });
        const sent = h.sent.map(s => {
            const a = s.action as { type: string; locId?: number; slot?: number };
            return [s.tick, a.type === 'interactLoc' ? a.locId : a.type === 'useInventoryItem' ? `eat ${a.slot}` : a.type];
        });
        expect(sent).toEqual([
            [51, 1], [57, 2], [64, 1], [70, 2], [78, 3], [85, 1], [91, 'eat 0'], [91, 2], [99, 3], [106, 1], [112, 2], [120, 'eat 0'], [120, 3],
            [127, 1], [133, 2], [141, 3], [148, 1], [154, 2], [162, 3], [169, 1], [175, 2], [183, 'eat 0'], [183, 3], [190, 1], [196, 2]
        ]);
        expect(h.status.phase).toBe('done');
        expect(h.status.endedTick).toBe(202);
    });

    test('a plain lap with none of the opt-in keys sends what it sent before them, in both techniques', () => {
        // Two clean laps off the Wilderness, only `laps` and `technique` given. The expected clicks and
        // the end tick are main's program (before untilLevel, eatGap, eatAt, restockBelow, protect* and
        // the Wilderness watch) on this same script.
        const expected = {
            react: { clicks: [[51, 1], [57, 2], [65, 3], [72, 1], [78, 2], [86, 3]], end: 93 },
            plain: { clicks: [[51, 1], [58, 2], [67, 3], [75, 1], [82, 2], [91, 3]], end: 98 }
        };
        for (const technique of ['react', 'plain'] as const) {
            const { h } = run({ ticks: 200, params: { laps: 2, technique } });
            expect(h.sent.map(s => s.action.type)).toEqual(Array(6).fill('interactLoc'));
            expect(h.sent.map(s => [s.tick, (s.action as { locId: number }).locId])).toEqual(expected[technique].clicks);
            expect(h.status.phase).toBe('done');
            expect(h.status.endedTick).toBe(expected[technique].end);
            expect(h.status.result).toMatchObject({ ended: 'laps', laps: 2, technique });
        }
    });

    test('in the pit with no ladder listed yet, it clicks the known pit ladder', () => {
        const h = new Harness('agl', createAgility);
        h.start('agl', { course: 'wilderness', laps: 1 }, makeState({ tick: 1, x: 3001, z: 10357 }));
        const first = h.step(makeState({ tick: 2, x: 3001, z: 10357 }));
        expect(first.map(s => s.action)).toMatchObject([{ type: 'interactLoc', locId: 1755, x: 3005, z: 10363, optionIndex: 1 }]);
        expect(h.status.phase).toBe('running');
        // still in the pit 12 ticks later: try again
        expect(h.step(makeState({ tick: 14, x: 3001, z: 10357 })).length).toBe(1);
    });

    test("startStep 'auto' from a Gnome start-area tile or any Wilderness tile sends the base program's packets (the Gnome zones change nothing there)", () => {
        // Two laps on the real course tables, every obstacle done 4 ticks after its click lands, the
        // player held on its start tile. The expected streams are agent/rs-186-coordinator-9's program
        // (before the Gnome zones and untilLevelAt) on this same script.
        const stream = (name: string, x: number, z: number) => {
            const course = AGILITY_COURSES[name]!;
            const locs: Array<{ id: number; x: number; z: number; name: string; options: string[] }> = [];
            const xpOf: Record<number, number> = {};
            for (const st of course.steps) for (const [id, lx, lz] of st.locs) {
                xpOf[id] = st.xp;
                if (!locs.some(l => l.id === id && l.x === lx && l.z === lz)) locs.push({ id, x: lx, z: lz, name: `loc ${id}`, options: ['Cross'] });
            }
            const h = new Harness('agl', createAgility);
            let tick = 50;
            let xp = 0;
            const pending: Array<{ at: number; id: number }> = [];
            const done: Array<{ at: number; id: number }> = [];
            const state = () => makeState({ tick, x, z, skills: { Agility: { xp: Math.round(xp * 25), level: 50 } }, locs });
            h.start('agl', { course: name, startStep: 'auto', laps: 2 }, state());
            for (let k = 0; k < 200 && h.status.phase === 'running'; k++) {
                tick++;
                for (const p of pending.filter(q => q.at === tick)) done.push({ at: tick + 4, id: p.id });
                for (const d of done.filter(q => q.at === tick)) xp += xpOf[d.id]!;
                for (const s of h.step(state())) if (s.action.type === 'interactLoc') pending.push({ at: tick + 1, id: s.action.locId });
            }
            const sent = h.sent.map(s => {
                const a = s.action as { type: string; locId: number; x: number; z: number; optionIndex: number };
                return a.type === 'interactLoc' ? `${s.tick}:${a.locId}@${a.x},${a.z}/${a.optionIndex}` : `${s.tick}:${a.type}`;
            });
            return `${sent.join(' ')} end:${h.status.endedTick}`;
        };
        const gnomeLap = (net: string, net2: string) =>
            `51:2295@2474,3435/1 56:2285@${net}/1 61:2313@2473,3422/1 66:2312@2478,3420/1 71:2315@2487,3420/1 76:2286@${net2}/1 81:154@2484,3431/1 ` +
            `86:2295@2474,3435/1 91:2285@${net}/1 96:2313@2473,3422/1 101:2312@2478,3420/1 106:2315@2487,3420/1 111:2286@${net2}/1 116:154@2484,3431/1 end:121`;
        const W = ['2288@3004,3938', '2283@3005,3952', '2311@3001,3960', '2297@3001,3945'];
        const wild = (from: number, rocks: string, laps: number) => {
            const order = [...W, `2328@${rocks}`];
            const seq = Array.from({ length: order.length * laps - from }, (_, k) => order[(from + k) % order.length]!);
            return `${seq.map((c, k) => `${51 + 5 * k}:${c}/1`).join(' ')} end:${51 + 5 * seq.length}`;
        };
        const expected: Record<string, string> = {
            'gnome 2474,3436': gnomeLap('2473,3425', '2483,3426'),
            'gnome 2474,3438': gnomeLap('2473,3425', '2485,3426'),
            'gnome 2484,3437': gnomeLap('2473,3425', '2485,3426'),
            'gnome 2487,3437': gnomeLap('2475,3425', '2485,3426'),
            'gnome 2470,3441': gnomeLap('2473,3425', '2485,3426'),
            'wilderness 3004,3937': wild(0, '2995,3936', 2),
            'wilderness 2994,3933': wild(0, '2994,3936', 2),
            'wilderness 3004,3950': wild(1, '2994,3936', 2),
            'wilderness 3005,3958': wild(2, '2994,3936', 2),
            'wilderness 2996,3960': wild(3, '2994,3936', 2),
            'wilderness 2994,3945': wild(4, '2994,3936', 2),
            'wilderness 2980,3900': wild(0, '2994,3936', 2)
        };
        for (const [key, want] of Object.entries(expected)) {
            const [name, at] = key.split(' ') as [string, string];
            const [x, z] = at.split(',').map(Number) as [number, number];
            expect(`${key}: ${stream(name, x, z)}`).toBe(`${key}: ${want}`);
        }
    });

    test('startStep auto picks the step from the tile', () => {
        const h = new Harness('agl', createAgility);
        h.start('agl', { course: 'wilderness', laps: 1, startStep: 'auto' }, makeState({ tick: 1, x: 2994, z: 3945 }));
        const sent = h.step(makeState({ tick: 2, x: 2994, z: 3945 }));
        expect(sent.map(s => (s.action as { locId?: number }).locId)).toEqual([2328]); // the rocks
    });
});

describe('Protect from Melee', () => {
    /** Ticks 1..n standing still, the prayer state following the toggles sent; `npcAt(t)` places a skeleton. */
    function drive(params: Record<string, unknown>, n: number, npcAt: (t: number) => boolean = () => true) {
        const h = new Harness('agl', createAgility);
        let on = false;
        const state = (t: number) => {
            const s = makeState({ tick: t, x: 3004, z: 3940, npcs: npcAt(t) ? [{ index: 2, name: 'Skeleton', x: 3005, z: 3940 }] : [] });
            (s as unknown as { prayers: unknown }).prayers = { activePrayers: Array.from({ length: 15 }, (_, i) => i === 14 && on), prayerPoints: 43, prayerLevel: 43 };
            return s;
        };
        h.start('agl', { course: COURSE, maxTicks: 1000, ...params }, state(0));
        const toggles: number[] = [];
        for (let t = 1; t <= n; t++) {
            for (const sent of h.step(state(t))) if (sent.action.type === 'togglePrayer') { on = !on; toggles.push(t); }
        }
        return toggles;
    }

    test('off sends nothing; hold turns it on once', () => {
        expect(drive({}, 20)).toEqual([]);
        expect(drive({ protect: 'hold' }, 20).length).toBe(1);
    });

    test('flick turns it off and on in one tick every flickGap ticks, outside the 3 ticks after a click', () => {
        const t = drive({ protect: 'flick' }, 30);
        expect(t.length).toBeGreaterThan(3);
        // after the first on, toggles come in same-tick pairs
        const pairs = t.slice(1);
        for (let k = 0; k < pairs.length; k += 2) expect(pairs[k]).toBe(pairs[k + 1]);
    });

    test('near: on while a skeleton is close, off when it is gone', () => {
        const t = drive({ protect: 'near' }, 40, tick => tick < 20);
        expect(t.length).toBe(2);
        expect(t[1]).toBeGreaterThanOrEqual(20);
    });
});

describe('Wilderness rules', () => {
    const me: Me = { x: 3004, z: 3940, combatLevel: 3, wild: wildernessLevel(3004, 3940) };
    const player = (o: Partial<NearbyPlayer> & { x: number; z: number }): NearbyPlayer => ({ kind: 'player', index: 1, name: 'p', combatLevel: 30, distance: Math.max(Math.abs(o.x - me.x), Math.abs(o.z - me.z)), combatTargetType: 'none', ...o });

    test('levels and the attack rule', () => {
        expect(wildernessLevel(2998, 3917)).toBe(50); // the ridge gate
        expect(wildernessLevel(3001, 3960)).toBe(56); // the stepping stones
        expect(wildernessLevel(3005, 10363)).toBe(56); // the pit ladder
        expect(wildernessLevel(3222, 3218)).toBe(0);
        expect(canAttack(3, 53, 56, 53)).toBe(true);
        expect(canAttack(3, 53, 57, 53)).toBe(false);
        expect(canAttack(3, 0, 3, 53)).toBe(false);
    });

    test('a threat targets a player beside us, or walks toward us from off the lap', () => {
        const lap = AGILITY_COURSES.wilderness!.lapArea;
        expect(threatOf(player({ x: 3005, z: 3940, combatTargetType: 'player' }), me, [], 100, DEFAULT_THREAT, lap)).toBe('targeting');
        expect(threatOf(player({ x: 3005, z: 3940, combatTargetType: 'player', combatLevel: 99 }), me, [], 100, DEFAULT_THREAT, lap)).toBeNull();
        // off the lap (west of the rocks), moved from 14 tiles off to 10 in 4 ticks
        const p = player({ x: 2990, z: 3926 });
        expect(threatOf({ ...p, x: 2994, z: 3930, distance: 10 }, me, [[96, 2990, 3926]], 100, DEFAULT_THREAT, lap)).toBe('closing');
        // the same distances from standing still while we walk toward them: no
        expect(threatOf({ ...p, distance: 10 }, me, [[96, 2990, 3926]], 100, DEFAULT_THREAT, lap)).toBeNull();
        // another course user walking the lap toward us: no
        expect(threatOf(player({ x: 3004, z: 3944 }), me, [[96, 3004, 3950]], 100, DEFAULT_THREAT, lap)).toBeNull();
    });

    test('who dealt a hit', () => {
        const ev = (tick: number, sourceType = 'npc', sourceIndex = -1) => ({ tick, sourceType, sourceIndex });
        expect(classifyHit(ev(100), 98, [], [], me).source).toBe('fall');
        expect(classifyHit(ev(100), 90, [], [], me).source).toBe('npc');
        expect(classifyHit(ev(100, 'other_player', 1), 0, [player({ x: 3005, z: 3940 })], [], me).source).toBe('player');
        expect(classifyHit(ev(100, 'other_player', 1), 0, [], [], me).source).toBe('npc'); // a stale facing, nobody in view
        expect(classifyHit(ev(100), 0, [player({ x: 3007, z: 3940, combatTargetType: 'player' })], [{ distance: 1, targetIndex: 32770 }], me).source).toBe('npc');
        expect(classifyHit(ev(100), 0, [player({ x: 3007, z: 3940, combatTargetType: 'player' })], [], me).source).toBe('player');
    });

    test('stepFromPosition maps the Wilderness landing tiles', () => {
        const w = AGILITY_COURSES.wilderness!;
        expect(stepFromPosition(w, 3004, 3937)).toBe('pipe');
        expect(stepFromPosition(w, 2994, 3933)).toBe('pipe');
        expect(stepFromPosition(w, 3004, 3950)).toBe('ropeswing');
        expect(stepFromPosition(w, 3005, 3958)).toBe('stones');
        expect(stepFromPosition(w, 2996, 3960)).toBe('log');
        expect(stepFromPosition(w, 2994, 3945)).toBe('rocks');
        expect(stepFromPosition(w, 3005, 10363)).toBe('stones');
        expect(stepFromPosition(AGILITY_COURSES.gnome!, 2400, 3400)).toBe('log');
    });

    test('stepFromPosition maps the Gnome landing tiles, plane by plane', () => {
        const g = AGILITY_COURSES.gnome!;
        expect(stepFromPosition(g, 2474, 3436, 0)).toBe('log'); // the start
        expect(stepFromPosition(g, 2474, 3429, 0)).toBe('net');
        expect(stepFromPosition(g, 2473, 3424, 1)).toBe('branch');
        expect(stepFromPosition(g, 2473, 3420, 2)).toBe('rope');
        expect(stepFromPosition(g, 2483, 3420, 2)).toBe('tree-down'); // where the rope lands
        expect(stepFromPosition(g, 2487, 3420, 0)).toBe('net2');
        expect(stepFromPosition(g, 2485, 3427, 0)).toBe('pipe');
        expect(stepFromPosition(g, 2484, 3433, 0)).toBe('pipe'); // inside the pipe
        expect(stepFromPosition(g, 2484, 3437, 0)).toBe('log'); // the pipe's landing: the next lap
        expect(stepFromPosition(g, 2487, 3437, 0)).toBe('log');
        expect(zoneAt(g, 2465, 3489, 0)).toBeUndefined(); // the Grand Tree door: off the course
    });
});
