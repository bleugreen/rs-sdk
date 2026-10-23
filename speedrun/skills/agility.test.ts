import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findDoorsAlongPath, findLongPath } from '../../sdk/pathfinding';
import type { ActionResult, BotWorldState } from '../../sdk/types';
import { createAgility } from '../../server/webclient/src/bot/programs/agility';
import { baseState, FakeSdk, flush, type SentAction } from '../lib/fake-sdk';
import type { ProgramStatus } from '../lib/programs';
import { TickLog } from '../lib/ticks';
import type { StepContext } from '../runner/step';
import {
    AgilityStop, COURSE_GATE, DEFAULT_FOOD, defaultEatBelow, engaged, finalLogout, midLap, parseOptions, parseWant, PAUSE_STEP, pausesTaken, planBands, retreat, RIDGE_GATE, ridgeSide, ROUTES, routeStart, SAFE_TILE, skill, steps
} from './agility';

function player(o: Partial<NonNullable<BotWorldState['player']>> & { x?: number; z?: number } = {}): BotWorldState['player'] {
    return {
        name: 'cairn_jumps', combatLevel: 3, hp: 10, maxHp: 10, x: 0, z: 0, worldX: o.x ?? 3004, worldZ: o.z ?? 3945, level: 0, runEnergy: 100, runWeight: 0,
        animId: -1, spotanimId: -1, combat: { inCombat: false, targetIndex: -1, targetType: 'none', lastDamageTick: -1 }, isDead: false, lifeId: 0, respawnCount: 0, lastDeathTick: null,
        ...o
    } as BotWorldState['player'];
}

function world(o: { agility?: number; x?: number; z?: number; hp?: number; lastDamageTick?: number; tick?: number; inventory?: BotWorldState['inventory']; extra?: Partial<BotWorldState> } = {}): BotWorldState {
    const p = player({ ...(o.x !== undefined ? { x: o.x } : {}), ...(o.z !== undefined ? { z: o.z } : {}), hp: o.hp ?? 10 })!;
    p.combat.lastDamageTick = o.lastDamageTick ?? -1;
    return baseState({
        tick: o.tick ?? 100,
        player: p,
        skills: [{ name: 'Agility', level: o.agility ?? 52, baseLevel: o.agility ?? 52, experience: 0 }],
        inventory: o.inventory ?? [],
        ...o.extra
    });
}

const cake = (slot: number) => ({ slot, id: 1891, name: 'Cake', count: 1, optionsWithIndex: [{ text: 'Eat', opIndex: 1 }] }) as unknown as BotWorldState['inventory'][number];

/** A FakeSdk that answers the page's program relay (as lib/programs.test.ts does). */
class PageSdk extends FakeSdk {
    runId = 0;
    starts: Array<Record<string, unknown>> = [];
    override sendAction(a: SentAction | Record<string, unknown>): Promise<ActionResult> {
        if ((a as { type?: unknown }).type !== 'program') return super.sendAction(a as SentAction);
        const act = a as Record<string, unknown>;
        if (act.op !== 'start') return Promise.resolve({ success: true, message: 'ok', data: null });
        this.runId++;
        this.starts.push(act);
        return Promise.resolve({ success: true, message: 'started', data: status({ runId: this.runId, phase: 'running' }) });
    }
    end(result: Record<string, unknown>, patch: Partial<BotWorldState> = {}) {
        this.tick(s => ({ ...patch, program: status({ runId: this.runId, phase: 'done', result: { levelTicks: {}, sightings: [], wouldPause: { any: 0, threat: 0 }, ...result }, endedTick: s.tick + 1 }) }) as never);
    }
}

function status(p: Partial<ProgramStatus>): ProgramStatus {
    const f = { n: 0, p50: 0, p90: 0, max: 0, underHalfT: 0, overSevenSixthsT: 0, catchUps: 0, catchUpsLastMinute: 0, catchUpsPerMinute: 0, T: 300, TSource: 'driver' as const };
    return { runId: 1, name: 'agility', phase: 'running', params: {}, startedTick: 100, tick: 100, progressTick: 100, counters: {}, gauges: {}, packets: 0, deferred: 0, skippedTicks: 0, maxTickMs: 0, frames: f, publish: f, react: { n: 0, p50: 0, p90: 0, max: 0 }, loops: { last: 0, p10Last10s: 0, min: 0 }, marks: {}, ...p } as ProgramStatus;
}

function ctxFor(sdk: FakeSdk, log = TickLog.memory()): StepContext<unknown> {
    const bot = { walkTo: async () => ({ success: true, message: 'ok' }) };
    return { session: { sdk, bot, name: 'cairn_jumps', sessionId: 1 }, sdk, bot, c: {}, log } as unknown as StepContext<unknown>;
}

const step = (list: ReturnType<typeof steps>, name: string) => list.find(s => s.name === name)!;

/** The player moved to (x, z) on `plane`, for a state patch. */
const tile = (sdk: FakeSdk, x: number, z: number, plane = 0) => ({ ...sdk.getState()!.player!, worldX: x, worldZ: z, level: plane });

/** `world()` on a plane. */
function onPlane(s: BotWorldState, plane: number): BotWorldState {
    s.player!.level = plane;
    return s;
}

describe('agility bands end at a lap boundary on the ground', () => {
    test('midLap: a course zone other than the lap start', () => {
        expect(midLap('gnome', onPlane(world({ x: 2483, z: 3420 }), 2))).toBe(true); // the rope's landing
        expect(midLap('gnome', world({ x: 2487, z: 3420 }))).toBe(true); // down the tree, before the second net
        expect(midLap('gnome', world({ x: 2484, z: 3437 }))).toBe(false); // the pipe's landing, T11a's start
        expect(midLap('gnome', world({ x: 2487, z: 3437 }))).toBe(false); // the other pipe's
        expect(midLap('gnome', world({ x: 2465, z: 3489 }))).toBe(false); // the Grand Tree door: off the course
        expect(midLap('wilderness', world({ x: 2994, z: 3933 }))).toBe(false); // the rocks' landing
        expect(midLap('wilderness', world({ x: 3004, z: 3937 }))).toBe(false); // the pipe
        expect(midLap('wilderness', world({ x: 3005, z: 3958 }))).toBe(true);
        expect(midLap('wilderness', world({ x: 3001, z: 10357 }))).toBe(true); // the pit
    });

    test('S11a resumed with 25 reached on the rope platform: in progress, not done; the band finishes the lap and ends on the ground', async () => {
        const band = step(steps({ to: 25 }), 'agility:gnome');
        const s = onPlane(world({ agility: 25, x: 2483, z: 3420 }), 2);
        expect(band.done!({ state: s, probed: {} }, {} as never)).toBe(false);
        expect(band.inProgress!({ state: s, probed: {} }, {} as never)).toBe(true);
        expect(band.preconditions(s, {} as never)).toBe(true);
        expect(band.postconditions(s, {} as never)).toMatch(/partway through a lap, at \(2483,3420\) plane 2/);
        const sdk = new PageSdk(s);
        const run = band.run(ctxFor(sdk) as never);
        await flush();
        expect(sdk.starts[0]!.params).toMatchObject({ course: 'gnome', untilLevel: 25, untilLevelAt: 'lap', startStep: 'auto' });
        sdk.end({ ended: 'level', level: 25, afterLevel: { ticks: 40, obstacles: 3 } }, { player: tile(sdk, 2484, 3437) });
        await run;
        expect(sdk.starts.length).toBe(1);
        const end = sdk.getState()!;
        expect(band.postconditions(end, {} as never)).toBe(true);
        expect(band.done!({ state: end, probed: {} }, {} as never)).toBe(true);
        expect(band.inProgress!({ state: end, probed: {} }, {} as never)).toBe(false);
    });

    test('S11a reaching 25 on the rope platform with a program that ends on the level tick (an older bundle): the band runs it again to finish the lap', async () => {
        const sdk = new PageSdk(world({ agility: 24, x: 2474, z: 3436 }));
        const band = step(steps({ to: 25 }), 'agility:gnome');
        const log = TickLog.memory();
        const run = band.run(ctxFor(sdk, log) as never);
        await flush();
        sdk.end({ ended: 'level', level: 25 }, { skills: [{ name: 'Agility', level: 25, baseLevel: 25, experience: 0 }], player: tile(sdk, 2483, 3420, 2) });
        for (let k = 0; k < 10 && sdk.starts.length < 2; k++) await flush();
        expect(sdk.starts.length).toBe(2);
        expect(sdk.starts[1]!.params).toMatchObject({ course: 'gnome', untilLevel: 25, untilLevelAt: 'lap', startStep: 'auto' });
        sdk.end({ ended: 'level', level: 25, afterLevel: { ticks: 40, obstacles: 3 } }, { player: tile(sdk, 2484, 3437) });
        await run;
        expect(log.rows.map(r => r.step)).toEqual(['agility:finish-lap']);
        expect(log.rows[0]!.meta).toMatchObject({ band: 'agility:gnome', ended: 'level', x: 2483, z: 3420, plane: 2 });
        expect(band.done!({ state: sdk.getState()!, probed: {} }, {} as never)).toBe(true);
    });

    test('S11a with 25 reached at the lap start: done, and the band sends nothing', async () => {
        const band = step(steps({ to: 25 }), 'agility:gnome');
        const s = world({ agility: 25, x: 2484, z: 3437 });
        expect(band.done!({ state: s, probed: {} }, {} as never)).toBe(true);
        const sdk = new PageSdk(s);
        await band.run(ctxFor(sdk) as never);
        expect(sdk.starts).toEqual([]);
        expect(sdk.sent).toEqual([]);
    });
});

describe('agility options and bands', () => {
    test('defaults: to 99 with the final logout, react, no player pause', () => {
        expect(skill).toBe('agility');
        const o = parseOptions();
        expect(o).toMatchObject({ to: 99, technique: 'react', eatAt: 'land', finish: 'final-logout', pauseFor: 'none', playerRadius: 15, maxPauses: 3, pauseLimitAck: false });
        expect(parseOptions({ eatAt: 'any' }).eatAt).toBe('any');
        expect(() => parseOptions({ eatAt: 'walk' })).toThrow(/eatAt/);
        expect(parseOptions({ to: '22' })).toMatchObject({ to: 22, finish: 'stay' });
        expect(parseOptions({ technique: 'knife' }).technique).toBe('react');
        expect(parseOptions({ technique: 'plain', pauseFor: 'threat', playerRadius: '10', eatBelow: '5' })).toMatchObject({ technique: 'plain', pauseFor: 'threat', playerRadius: 10, eatBelow: 5 });
        expect(() => parseOptions({ pauseFor: 'sometimes' })).toThrow(/pauseFor/);
        expect(() => parseOptions({ to: 'x' })).toThrow(/to must be a number/);
    });

    test('bands: Gnome to min(to, 52), then the Wilderness course', () => {
        expect(planBands(22)).toEqual([{ course: 'gnome', from: 1, to: 22 }]);
        expect(planBands(52)).toEqual([{ course: 'gnome', from: 1, to: 52 }]);
        expect(planBands(99)).toEqual([{ course: 'gnome', from: 1, to: 52 }, { course: 'wilderness', from: 52, to: 99 }]);
        expect(steps({ to: 22 }).map(s => s.name)).toEqual(['agility:walk-gnome', 'agility:gnome']);
        const all = steps();
        expect(all.map(s => s.name)).toEqual(['agility:walk-gnome', 'agility:gnome', 'agility:walk-wilderness', 'agility:wilderness']);
        expect(all.every(s => s.logoutSafe)).toBe(true);
        expect(all.filter(s => s.done).map(s => s.name)).toEqual(['agility:gnome', 'agility:wilderness']);
    });

    test('the eat line: 60% of max HP on the Wilderness course, none on the Gnome course', () => {
        expect(defaultEatBelow('wilderness', 10)).toBe(6);
        expect(defaultEatBelow('wilderness', 99)).toBe(60);
        expect(defaultEatBelow('gnome', 10)).toBe(0);
    });

    test("S17's survival floor: the Wilderness band refuses with 1 food held and starts with 2 or 12, by the band's food list; the Gnome band asks none", () => {
        const band = step(steps(), 'agility:wilderness');
        const shark = (slot: number) => ({ ...cake(slot), id: 385, name: 'Shark' });
        const sharks = (n: number) => Array.from({ length: n }, (_, i) => shark(i));
        const at = (inventory: BotWorldState['inventory']) => world({ agility: 75, x: 3004, z: 3940, inventory });
        expect(band.preconditions(at(sharks(1)), {} as never)).toBe('agility:wilderness: 1 food held, at least 2 needed on the Wilderness course');
        expect(band.preconditions(at([]), {} as never)).toMatch(/0 food held/);
        expect(band.preconditions(at(sharks(2)), {} as never)).toBe(true);
        expect(band.preconditions(at(sharks(12)), {} as never)).toBe(true);
        expect(band.preconditions(at([shark(0), cake(1)]), {} as never)).toBe(true);
        // The band's own food list decides what counts.
        expect(step(steps({ food: '^shark$' }), 'agility:wilderness').preconditions(at([shark(0), cake(1)]), {} as never)).toMatch(/1 food held/);
        // Done already (99): nothing to refuse; the Gnome band holds no floor.
        expect(band.preconditions(world({ agility: 99, x: 3004, z: 3940 }), {} as never)).toBe(true);
        expect(step(steps(), 'agility:gnome').preconditions(world({ agility: 1, x: 2476, z: 3430 }), {} as never)).toBe(true);
    });

    test('S17 state (75, inside the course): only the Wilderness band has work', async () => {
        const all = steps();
        const s = world({ agility: 75, x: 3004, z: 3940, inventory: [cake(0), cake(1)] });
        for (const st of all) expect(st.preconditions(s, {} as never)).toBe(true);
        expect(step(all, 'agility:gnome').done!({ state: s, probed: {} }, {} as never)).toBe(true);
        expect(step(all, 'agility:wilderness').done!({ state: s, probed: {} }, {} as never)).toBe(false);
        expect(step(all, 'agility:wilderness').inProgress!({ state: s, probed: {} }, {} as never)).toBe(true);
        const sdk = new FakeSdk(s);
        await step(all, 'agility:walk-gnome').run(ctxFor(sdk) as never);
        await step(all, 'agility:walk-wilderness').run(ctxFor(sdk) as never);
        expect(sdk.sent).toEqual([]);
    });

    test('a fresh account fails the Wilderness preconditions until 52; away from the course the band defers to its walk', () => {
        const all = steps();
        const fresh = world({ agility: 1, x: 3222, z: 3222 });
        expect(step(all, 'agility:walk-gnome').preconditions(fresh, {} as never)).toBe(true);
        expect(step(all, 'agility:gnome').preconditions(fresh, {} as never)).toMatch(/not at the gnome course/);
        expect(step(all, 'agility:gnome').preconditions(world({ agility: 1, x: 2476, z: 3430 }), {} as never)).toBe(true);
        expect(step(all, 'agility:walk-wilderness').preconditions(world({ agility: 40, x: 2476, z: 3430 }), {} as never)).toMatch(/below the ridge gate/);
        expect(step(all, 'agility:wilderness').preconditions(world({ agility: 60, x: 2998, z: 3922 }), {} as never)).toMatch(/not at the wilderness course/); // the wolf pit
    });

    test('routeStart: the point after the nearest one once reached, else the nearest', () => {
        const r: Array<[number, number]> = [[0, 0], [50, 0], [100, 0]];
        expect(routeStart(r, 1, 1)).toBe(1);
        expect(routeStart(r, 30, 0)).toBe(1);
        expect(routeStart(r, 99, 0)).toBe(2);
        expect(routeStart(r, 500, 0)).toBe(2);
    });

    test('engaged: a hit inside the 16-tick window, in combat, or an NPC beside us on a player', () => {
        expect(engaged(world({ tick: 100, lastDamageTick: 84 }))).toBe(true);
        expect(engaged(world({ tick: 100, lastDamageTick: 83 }))).toBe(false);
        expect(engaged(world({ extra: { nearbyNpcs: [{ distance: 1, targetIndex: 32768 + 4 }] as never } }))).toBe(true);
        expect(engaged(world({ extra: { nearbyNpcs: [{ distance: 1, targetIndex: 3 }] as never } }))).toBe(false);
    });
});

describe('agility Wilderness decisions', () => {
    test('pausesTaken counts this process and earlier launches in the same log file, per band', () => {
        const dir = mkdtempSync(join(tmpdir(), 'agility-'));
        const path = join(dir, 'run.jsonl');
        const row = (band: string, at: string) => JSON.stringify({ v: 1, runId: 'r', account: 'a', sessionId: 1, step: PAUSE_STEP, startTick: 1, endTick: 1, ticks: 0, wallMs: 0, ok: true, meta: { band }, tickMs: 300, at });
        writeFileSync(path, [row('agility:wilderness', 'a1'), row('agility:wilderness', 'a2'), row('agility:gnome', 'a3')].join('\n') + '\n');
        const log = TickLog.open('r', path);
        expect(pausesTaken(log, 'agility:wilderness')).toBe(2);
        log.append(JSON.parse(row('agility:wilderness', 'a4')));
        expect(pausesTaken(log, 'agility:wilderness')).toBe(3);
        expect(pausesTaken(TickLog.memory(), 'agility:wilderness')).toBe(0);
    });

    test('a player pause logs out at once, records the pause and throws a typed stop', async () => {
        const sdk = new PageSdk(world({ agility: 60, x: 3004, z: 3940 }));
        let logouts = 0;
        const band = step(steps({ pauseFor: 'threat', logout: async () => void logouts++ }), 'agility:wilderness');
        const log = TickLog.memory();
        const run = band.run(ctxFor(sdk, log) as never);
        await flush();
        expect(sdk.starts[0]!.params).toMatchObject({ course: 'wilderness', untilLevel: 99, startStep: 'auto', eatBelow: 6, eatGap: 3, eatAt: 'land', food: DEFAULT_FOOD, pauseFor: 'threat', playerRadius: 15 });
        // S17 is the run's last band: it ends on the level tick, as before (LAP_END)
        expect(sdk.starts[0]!.params).not.toHaveProperty('untilLevelAt');
        // the page faults on an undeclared key (ProgramRuntime), so every key the module sends must be declared
        const declared: readonly string[] = createAgility.params;
        expect(Object.keys(sdk.starts[0]!.params as object).filter(k => !declared.includes(k))).toEqual([]);
        sdk.end({ ended: 'player', level: 60, player: { name: 'pker', combatLevel: 40, distance: 2, why: 'targeting' } });
        const err = await run.catch(e => e);
        expect(err).toBeInstanceOf(AgilityStop);
        expect((err as AgilityStop).kind).toBe('paused-for-player');
        expect(logouts).toBe(1);
        expect(log.rows.filter(r => r.step === PAUSE_STEP).map(r => r.meta?.n)).toEqual([1]);
    });

    test('more than maxPauses in a band refuses to resume until acknowledged', async () => {
        const log = TickLog.memory();
        for (let k = 0; k < 4; k++) log.append({ v: 1, runId: 'r', account: 'a', sessionId: 1, step: PAUSE_STEP, startTick: 1, endTick: 1, ticks: 0, wallMs: 0, ok: true, meta: { band: 'agility:wilderness' }, tickMs: 300, at: `x${k}` });
        const sdk = new PageSdk(world({ agility: 60, x: 3004, z: 3940 }));
        const err = await step(steps(), 'agility:wilderness').run(ctxFor(sdk, log) as never).catch(e => e);
        expect((err as AgilityStop).kind).toBe('pause-limit');
        expect(sdk.starts).toEqual([]);
        const ack = step(steps({ pauseLimitAck: 'true', logout: async () => undefined }), 'agility:wilderness').run(ctxFor(sdk, log) as never);
        await flush();
        expect(sdk.starts.length).toBe(1);
        sdk.end({ ended: 'level', level: 99 }, { skills: [{ name: 'Agility', level: 99, baseLevel: 99, experience: 0 }] });
        await ack;
    });

    test('reaching 99 partway round the lap: the final logout runs on the level tick, and the postcondition accepts the logged-out end', async () => {
        // (3004,3940) is past the pipe, before the rope swing: S17 does not finish the lap
        const sdk = new PageSdk(world({ agility: 98, x: 3004, z: 3940 }));
        let logouts = 0;
        const band = step(steps({ logout: async () => void logouts++ }), 'agility:wilderness');
        const log = TickLog.memory();
        const run = band.run(ctxFor(sdk, log) as never);
        await flush();
        sdk.end({ ended: 'level', level: 99, levelTicks: { 99: 101 } }, { skills: [{ name: 'Agility', level: 99, baseLevel: 99, experience: 0 }] });
        await run;
        expect(logouts).toBe(1);
        expect(log.rows.map(r => r.step)).toEqual(['agility:final-logout']);
        expect(sdk.starts.length).toBe(1);
        expect(band.postconditions(baseState({ inGame: false }), {} as never)).toBe(true);
        // and a resume finding 99 mid-lap is done, as before
        const mid = world({ agility: 99, x: 3005, z: 3958 });
        expect(band.done!({ state: mid, probed: {} }, {} as never)).toBe(true);
        expect(band.inProgress!({ state: mid, probed: {} }, {} as never)).toBe(false);
    });

    test('restock: low-food leaves by the course gate, trades with the courier, crosses back and laps on (once)', async () => {
        const sdk = new PageSdk(world({ agility: 78, x: 2994, z: 3933, inventory: [cake(0)] }));
        sdk.onSend = (a, f) => {
            if (a.method !== 'sendInteractLoc') return;
            if (a.args[2] === COURSE_GATE.id) setTimeout(() => f.tick(s => ({ player: { ...s.player!, worldX: 2998, worldZ: 3916 } })), 0);
            if (a.args[2] === RIDGE_GATE.id) setTimeout(() => f.tick(s => ({ player: { ...s.player!, worldX: 2998, worldZ: 3933 } })), 0);
        };
        const trades: string[] = [];
        let logouts = 0;
        const band = step(steps({
            restockGiver: 'courier1', restockWant: 'shark:20', restockBelow: '4',
            logout: async () => void logouts++,
            receive: async (_s: unknown, giver: string, want: Array<{ amount?: number }>) => {
                trades.push(`${giver}:${want[0]!.amount}`);
                return { ok: true, ticks: 4, received: [] };
            }
        }), 'agility:wilderness');
        const log = TickLog.memory();
        const run = band.run(ctxFor(sdk, log) as never);
        await flush();
        expect(sdk.starts[0]!.params).toMatchObject({ restockBelow: 4 });
        sdk.end({ ended: 'low-food', level: 78, food: 4 });
        for (let k = 0; k < 10 && sdk.starts.length < 2; k++) await flush();
        expect(sdk.sent.filter(a => a.method === 'sendInteractLoc').map(a => a.args[2])).toEqual([COURSE_GATE.id, RIDGE_GATE.id]);
        expect(trades).toEqual(['courier1:20']);
        expect(sdk.starts.length).toBe(2);
        expect(sdk.starts[1]!.params).not.toHaveProperty('restockBelow'); // one restock per band
        sdk.end({ ended: 'level', level: 99 }, { skills: [{ name: 'Agility', level: 99, baseLevel: 99, experience: 0 }] });
        await run;
        expect(log.rows.map(r => r.step)).toEqual(['agility:restock', 'agility:final-logout']);
        expect(log.rows[0]!.meta).toMatchObject({ giver: 'courier1', ok: true });
        expect(logouts).toBe(1);
    });

    test('restock: no courier means no-food, logged out', async () => {
        const sdk = new PageSdk(world({ agility: 78, x: 2994, z: 3933 }));
        sdk.onSend = (a, f) => {
            if (a.method === 'sendInteractLoc' && a.args[2] === COURSE_GATE.id) setTimeout(() => f.tick(s => ({ player: { ...s.player!, worldX: 2998, worldZ: 3916 } })), 0);
        };
        let logouts = 0;
        const band = step(steps({ restock: { giver: 'courier1', want: 'shark:20', below: 4 }, logout: async () => void logouts++, receive: async () => ({ ok: false, ticks: 0, received: [], reason: 'no trade' }) }), 'agility:wilderness');
        const run = band.run(ctxFor(sdk) as never);
        await flush();
        sdk.end({ ended: 'low-food', level: 78, food: 4 });
        const err = await run.catch(e => e);
        expect((err as AgilityStop).kind).toBe('no-food');
        expect(logouts).toBe(1);
    });

    test('walk-gnome drops the starter items, then takes the food top-up, before walking', async () => {
        const inv = ['Bronze axe', 'Tinderbox', 'Shrimps', 'Bread', 'Air rune', 'Knife'].map((name, slot) => ({ slot, id: slot, name, count: 1, optionsWithIndex: [] })) as unknown as BotWorldState['inventory'];
        const sdk = new FakeSdk(world({ agility: 1, x: 3222, z: 3222, inventory: inv }));
        (sdk as unknown as { sendDropItem: (slot: number) => Promise<unknown> }).sendDropItem = slot => {
            sdk.sent.push({ method: 'sendDropItem', args: [slot] });
            setTimeout(() => sdk.tick(s => ({ inventory: s.inventory.filter(i => i.slot !== slot) })), 0);
            return Promise.resolve({ success: true, message: 'ok' });
        };
        const order: string[] = [];
        const ctx = ctxFor(sdk);
        (ctx.bot as unknown as { walkTo: () => Promise<unknown> }).walkTo = async () => { order.push('walk'); return { success: true, message: 'ok' }; };
        const walk = step(steps({ drop: '^(bronze .*|tinderbox|.* rune)$', topUpGiver: 'cairn_mule2', topUpWant: 'shark:16', receive: async (_s: unknown, g: string, w: Array<{ amount?: number }>) => { order.push(`trade ${g} ${w[0]!.amount}`); return { ok: true, ticks: 4, received: [] }; } }), 'agility:walk-gnome');
        await walk.run(ctx as never);
        expect(sdk.sent.filter(a => a.method === 'sendDropItem').map(a => a.args[0])).toEqual([0, 1, 4]);
        expect(sdk.getState()!.inventory.map(i => i.name)).toEqual(['Shrimps', 'Bread', 'Knife']);
        expect(order[0]).toBe('trade cairn_mule2 16');
        expect(order.slice(1).every(x => x === 'walk')).toBe(true);
    });

    describe('walk-gnome and the Gnome Stronghold gate (lib/travel.ts passGate)', () => {
        const gate = { id: 190, name: 'Gate', x: 2459, z: 3383, distance: 1, optionsWithIndex: [{ text: 'Open', opIndex: 1 }], options: ['Open'] };
        /** The gate's script: Femi's scene on a first visit from the south, else 3 p_teleport steps through. */
        function gateServer(sdk: FakeSdk, femi: boolean) {
            let page = -1;
            const cont = (id: string) => ({ isOpen: true, isWaiting: false, pageId: id, options: [{ index: 1, text: 'Click here to continue', componentId: 4886, buttonType: 6 }] });
            const pages = [cont('p1'), cont('p2'), cont('p3'), { isOpen: true, isWaiting: false, pageId: 'p4', options: [{ index: 1, text: "Sorry, I'm a bit busy.", componentId: 2461, buttonType: 1 }, { index: 2, text: 'OK then.', componentId: 2462, buttonType: 1 }] }, cont('p5'), cont('p6')];
            const closed = { isOpen: false, options: [], isWaiting: false };
            sdk.onSend = a => {
                if (a.method === 'sendInteractLoc' && a.args[2] === 190) {
                    if (femi) {
                        page = 0;
                        setTimeout(() => sdk.tick({ dialog: pages[0]! }), 1);
                        return;
                    }
                    const z0 = sdk.state!.player!.worldZ;
                    for (let k = 1; k <= 3; k++) setTimeout(() => sdk.tick(s => ({ player: { ...s.player!, worldZ: z0 + k, teleportTick: s.tick + 1, teleportJump: false } })), k);
                }
                if (a.method === 'clickDialogByText' && page >= 0) {
                    if (/busy/.test(String(a.args[0]))) femi = false;
                    page++;
                    const next = page < pages.length ? pages[page]! : closed;
                    if (page >= pages.length) page = -1;
                    setTimeout(() => sdk.tick({ dialog: next }), 1);
                }
            };
        }
        const walker = (ctx: StepContext<unknown>, stuckOnce: (x: number, z: number) => boolean) => {
            const walks: string[] = [];
            (ctx.bot as unknown as { walkTo: (x: number, z: number) => Promise<unknown> }).walkTo = async (x, z) => {
                walks.push(`${x},${z}`);
                return stuckOnce(x, z) && walks.filter(w => w === `${x},${z}`).length === 1 ? { success: false, message: `Stuck at (2461, 3382)` } : { success: true, message: 'Arrived' };
            };
            return walks;
        };

        test('goes through the gate whatever the failed walk said ("Stuck at" on the demo; e67edee1, rs/295)', async () => {
            const sdk = new FakeSdk(world({ agility: 1, x: 2461, z: 3382, extra: { nearbyLocs: [gate] as unknown as BotWorldState['nearbyLocs'] } }));
            gateServer(sdk, false);
            const ctx = ctxFor(sdk);
            const walks = walker(ctx, (x, z) => x === 2461 && z === 3386);
            await step(steps(), 'agility:walk-gnome').run(ctx as never);
            expect(sdk.sent.filter(a => a.method === 'sendInteractLoc')).toEqual([{ method: 'sendInteractLoc', args: [2459, 3383, 190, 1] }]);
            expect(walks.filter(w => w === '2461,3386')).toHaveLength(2);
        });

        test("a fresh account's first pass: Femi's scene is declined and the player ends north of the gate", async () => {
            const sdk = new FakeSdk(world({ agility: 1, x: 2461, z: 3382, extra: { nearbyLocs: [gate] as unknown as BotWorldState['nearbyLocs'] } }));
            gateServer(sdk, true);
            const log = TickLog.memory();
            const ctx = ctxFor(sdk, log);
            walker(ctx, (x, z) => x === 2461 && z === 3386);
            // the server's clock: converse ends a conversation on a quiet tick after the last page
            const clock = setInterval(() => sdk.tick(), 5);
            await step(steps(), 'agility:walk-gnome').run(ctx as never).finally(() => clearInterval(clock));
            expect(sdk.sent.filter(a => a.method === 'sendInteractLoc')).toHaveLength(2);
            expect(sdk.sent.some(a => a.method === 'clickDialogByText' && /busy/.test(String(a.args[0])))).toBe(true);
            expect(sdk.getState()!.player!.worldZ).toBe(3385);
            expect(log.rows.find(r => r.step === 'agility:gate')?.meta).toMatchObject({ to: 'north', ok: true, clicks: 2, dialogues: 1 });
        });

        test('a resume just inside the gate whose nearest route point is across it starts on its own side', async () => {
            // (2465,3385), inside the gate's north band: 4 tiles (Chebyshev) from both (2461,3382) and
            // (2461,3386), and the south one comes first in the route, so routeStart picks it
            const sdk = new FakeSdk(world({ agility: 1, x: 2465, z: 3385, extra: { nearbyLocs: [gate] as unknown as BotWorldState['nearbyLocs'] } }));
            gateServer(sdk, false);
            const ctx = ctxFor(sdk);
            const walks = walker(ctx, () => false);
            await step(steps(), 'agility:walk-gnome').run(ctx as never);
            expect(walks[0]).toBe('2461,3386');
            expect(sdk.sent.filter(a => a.method === 'sendInteractLoc')).toEqual([]);
        });

        test('a failed leg inside the Stronghold never goes back through the gate: the walk is retried once', async () => {
            // (2461,3390): north of the gate and 46 tiles from the course start, so walk-gnome runs its route
            const sdk = new FakeSdk(world({ agility: 1, x: 2461, z: 3390, extra: { nearbyLocs: [gate] as unknown as BotWorldState['nearbyLocs'] } }));
            gateServer(sdk, false);
            const ctx = ctxFor(sdk);
            const walks = walker(ctx, (x, z) => x === 2461 && z === 3386);
            await step(steps(), 'agility:walk-gnome').run(ctx as never);
            expect(sdk.sent.filter(a => a.method === 'sendInteractLoc')).toEqual([]);
            expect(walks.filter(w => w === '2461,3386')).toHaveLength(2);
        });
    });

    describe('walk-wilderness and the ridge gate (rs/494)', () => {
        /** Tiles whose path, ending there, makes the SDK's walkTo click the ridge gate: the gate's cardinal neighbours. */
        const besideGate = (x: number, z: number) => Math.abs(x - RIDGE_GATE.x) + Math.abs(z - RIDGE_GATE.z) === 1;

        /** The server: a ridge click from the gate's south side or the corridor crosses (or, `falls` times first, drops into the pit). */
        function ridgeServer(sdk: FakeSdk, falls = 0) {
            sdk.onSend = (a, f) => {
                if (a.method !== 'sendInteractLoc' || a.args[2] !== RIDGE_GATE.id) return;
                const side = ridgeSide(f.state);
                if (side !== 'gate' && side !== 'corridor') return;
                const fall = falls-- > 0;
                setTimeout(() => f.tick(s => ({
                    player: { ...s.player!, worldX: fall ? 3001 : 2998, worldZ: fall ? 3923 : 3931 },
                    ...(fall ? { gameMessages: [{ text: 'You lose your footing and fall into the wolf pit.', tick: s.tick + 1, type: 0 }] as never } : {})
                })), 0);
            };
        }
        /** bot.walkTo that arrives on its target tile. */
        function arrivingWalker(sdk: FakeSdk, ctx: StepContext<unknown>) {
            const walks: Array<[number, number]> = [];
            (ctx.bot as unknown as { walkTo: (x: number, z: number) => Promise<unknown> }).walkTo = async (x, z) => {
                walks.push([x, z]);
                sdk.tick(s => ({ player: { ...s.player!, worldX: x, worldZ: z } }));
                return { success: true, message: 'Arrived' };
            };
            return walks;
        }
        const legs = (log: TickLog) => log.rows.find(r => r.step === 'agility:walk-wilderness:legs')!.meta;

        test('ridgeSide: north of the gate is never at the gate; the corridor and the pit are told apart', () => {
            expect(ridgeSide(world({ x: 2998, z: 3918 }))).toBe('corridor');
            expect(ridgeSide(world({ x: 2998, z: 3930 }))).toBe('corridor');
            expect(ridgeSide(world({ x: 3001, z: 3923 }))).toBe('north'); // a fall's landing
            expect(ridgeSide(world({ x: 3000, z: 3917 }))).toBe('north');
            expect(ridgeSide(world({ x: RIDGE_GATE.approach[0], z: RIDGE_GATE.approach[1] }))).toBe('gate');
            expect(ridgeSide(world({ x: RIDGE_GATE.stage[0], z: RIDGE_GATE.stage[1] }))).toBe('gate');
            expect(ridgeSide(world({ x: 3004, z: 3940 }))).toBe('course');
            expect(ridgeSide(world({ x: 3006, z: 3911 }))).toBe('away');
            expect(ridgeSide(world({ x: 3158, z: 3953 }))).toBe('away'); // the keep web's far side
        });

        test('from the corridor north of the gate (rs/310\'s stop): no walk, the gate clicked from there, in the course', async () => {
            const sdk = new FakeSdk(world({ x: 2998, z: 3918 }));
            ridgeServer(sdk);
            const log = TickLog.memory();
            const ctx = ctxFor(sdk, log);
            const walks = arrivingWalker(sdk, ctx);
            await step(steps(), 'agility:walk-wilderness').run(ctx as never);
            expect(walks).toEqual([]);
            expect(sdk.sent.filter(a => a.method === 'sendInteractLoc').map(a => a.args)).toEqual([[RIDGE_GATE.x, RIDGE_GATE.z, RIDGE_GATE.id, 1]]);
            expect(ridgeSide(sdk.getState())).toBe('course');
            expect(legs(log)).toMatchObject({ ridgeFrom: 'corridor', ridgeTries: 1 });
        });

        test('from the keep web: the route ends on the stage, no walk ends beside the gate, one click crosses', async () => {
            const sdk = new FakeSdk(world({ x: 3158, z: 3953 }));
            ridgeServer(sdk);
            const log = TickLog.memory();
            const ctx = ctxFor(sdk, log);
            const walks = arrivingWalker(sdk, ctx);
            await step(steps(), 'agility:walk-wilderness').run(ctx as never);
            expect(walks).toEqual(ROUTES.keepToRidge.slice(1).map(([x, z]) => [x, z]));
            expect(walks.at(-1)).toEqual(RIDGE_GATE.stage);
            expect(walks.some(([x, z]) => besideGate(x, z))).toBe(false);
            expect(sdk.sent.filter(a => a.method === 'sendInteractLoc')).toHaveLength(1);
            expect(legs(log)).toMatchObject({ ridgeFrom: 'away', ridgeTries: 1 });
        });

        test('a fall into the wolf pit walks back to the stage, never to the approach, and clicks again', async () => {
            const sdk = new FakeSdk(world({ x: RIDGE_GATE.stage[0], z: RIDGE_GATE.stage[1] }));
            ridgeServer(sdk, 1);
            const log = TickLog.memory();
            const ctx = ctxFor(sdk, log);
            const walks = arrivingWalker(sdk, ctx);
            const run = step(steps(), 'agility:walk-wilderness').run(ctx as never);
            // crossRidge waits 3 ticks after a fall before walking back
            for (let k = 0; k < 20 && sdk.sent.filter(a => a.method === 'sendInteractLoc').length < 2; k++) {
                await flush();
                sdk.tick();
            }
            await run;
            expect(walks).toEqual([RIDGE_GATE.stage]);
            expect(sdk.sent.filter(a => a.method === 'sendInteractLoc')).toHaveLength(2);
            expect(ridgeSide(sdk.getState())).toBe('course');
            expect(legs(log)).toMatchObject({ ridgeFrom: 'gate', ridgeTries: 2 });
        });

        test('the SDK pathfinder sees no door on any walk the module makes to the ridge (and does see one on a walk to the approach)', () => {
            const route = ROUTES.keepToRidge;
            const gateOn = (from: readonly [number, number], to: readonly [number, number]) =>
                findDoorsAlongPath(findLongPath(0, from[0], from[1], to[0], to[1], 500)).some(d => d.x === RIDGE_GATE.x && d.z === RIDGE_GATE.z);
            for (let i = 0; i + 1 < route.length; i++) expect(gateOn(route[i]!, route[i + 1]!)).toBe(false);
            // the wolf pit (a fall lands on 3001,3923) and the ridge beside the corridor, back to the stage
            for (const from of [[3001, 3923], [3003, 3919], [3000, 3918], [3005, 3926], [3010, 3920]] as const) expect(gateOn(from, RIDGE_GATE.stage)).toBe(false);
            // why the stage: a walk ending on the approach has walkTo's door opener click the ridge itself
            expect(gateOn(route[route.length - 2]!, RIDGE_GATE.approach)).toBe(true);
        });
    });

    test('parseWant takes the kit syntax', () => {
        expect(parseWant('shark:20')).toEqual([{ item: /^shark$/i, amount: 20 }]);
        expect(parseOptions({ restockGiver: 'c', restockBelow: '3' }).restock).toEqual({ giver: 'c', want: [{ item: /^shark$/i, amount: 20 }], below: 3 });
        expect(parseOptions().restock).toBeUndefined();
    });

    test('finalLogout walks to the safe tile and waits out the window when a fight is on', async () => {
        const sdk = new FakeSdk(world({ agility: 99, x: 2995, z: 3940, tick: 200, lastDamageTick: 198 }));
        let loggedOutAt = -1;
        const done = finalLogout(ctxFor(sdk) as never, { ...parseOptions(), logout: async () => void (loggedOutAt = sdk.getState()!.tick) });
        await flush();
        expect(sdk.sent[0]).toEqual({ method: 'sendWalk', args: [SAFE_TILE[0], SAFE_TILE[1], true] });
        for (let t = 201; t <= 220; t++) {
            sdk.tick(s => ({ player: { ...s.player!, worldX: t >= 205 ? SAFE_TILE[0] : 2995, worldZ: t >= 205 ? SAFE_TILE[1] : 3940 } }));
            await flush();
        }
        const r = await done;
        expect(r.moved).toBe(true);
        expect(loggedOutAt).toBe(215); // the first tick past lastDamageTick + 16
    });

    test('finalLogout logs out at once when nothing is fighting us', async () => {
        const sdk = new FakeSdk(world({ agility: 99, tick: 300, lastDamageTick: 100 }));
        let calls = 0;
        const r = await finalLogout(ctxFor(sdk) as never, { ...parseOptions(), logout: async () => void calls++ });
        expect(r).toEqual({ waited: 0, moved: false });
        expect(calls).toBe(1);
        expect(sdk.sent).toEqual([]);
    });

    test('retreat never attacks: it eats at the line, steps away from the attacker, and clears after the window', async () => {
        const sdk = new FakeSdk(world({ hp: 5, tick: 100, lastDamageTick: 100, x: 3000, z: 3945, inventory: [cake(3)] }));
        const out = retreat(sdk as never, { eatBelow: 6 }, { x: 3002, z: 3945 });
        await flush();
        expect(sdk.sent.map(a => a.method)).toEqual(['sendUseItem', 'sendWalk']);
        expect(sdk.sent[1]!.args[0]).toBeLessThan(3000); // west, away from the attacker in the east
        for (let t = 101; t <= 118; t++) {
            sdk.tick({ player: { ...sdk.getState()!.player!, hp: 10 } });
            await flush();
        }
        expect(await out).toBe('clear');
        expect(sdk.sent.every(a => ['sendUseItem', 'sendWalk'].includes(a.method))).toBe(true);
    });
});
