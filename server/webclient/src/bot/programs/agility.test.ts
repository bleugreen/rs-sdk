import { describe, expect, test } from 'bun:test';

import '../../lite/test-support/browser-globals.js';

import type { NearbyPlayer } from '../types.js';
import { canAttack, classifyHit, createAgility, DEFAULT_THREAT, threatOf, wildernessLevel, type Me } from './agility.js';
import { AGILITY_COURSES, stepFromPosition, type AgilityCourse } from './agility-courses.js';
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
    let msgId = 0;
    const msgs: Array<{ text: string; tick: number; id: number }> = [];
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
            else msgs.push({ text: 'You slip and fall.', tick, id: msgId++ });
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
});
