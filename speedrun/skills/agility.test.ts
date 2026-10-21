import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ActionResult, BotWorldState } from '../../sdk/types';
import { baseState, FakeSdk, flush, type SentAction } from '../lib/fake-sdk';
import type { ProgramStatus } from '../lib/programs';
import { TickLog } from '../lib/ticks';
import type { StepContext } from '../runner/step';
import {
    AgilityStop, defaultEatBelow, engaged, finalLogout, parseOptions, PAUSE_STEP, pausesTaken, planBands, retreat, routeStart, SAFE_TILE, skill, steps
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
    const f = { n: 0, p50: 0, p90: 0, max: 0, under150: 0, over350: 0, catchUps: 0, catchUpsLastMinute: 0, catchUpsPerMinute: 0 };
    return { runId: 1, name: 'agility', phase: 'running', params: {}, startedTick: 100, tick: 100, progressTick: 100, counters: {}, gauges: {}, packets: 0, deferred: 0, skippedTicks: 0, maxTickMs: 0, frames: f, publish: f, react: { n: 0, p50: 0, p90: 0, max: 0 }, loops: { last: 0, p10Last10s: 0, min: 0 }, ...p };
}

function ctxFor(sdk: FakeSdk, log = TickLog.memory()): StepContext<unknown> {
    const bot = { walkTo: async () => ({ success: true, message: 'ok' }) };
    return { session: { sdk, bot, name: 'cairn_jumps', sessionId: 1 }, sdk, bot, c: {}, log } as unknown as StepContext<unknown>;
}

const step = (list: ReturnType<typeof steps>, name: string) => list.find(s => s.name === name)!;

describe('agility options and bands', () => {
    test('defaults: to 99 with the final logout, react, no player pause', () => {
        expect(skill).toBe('agility');
        const o = parseOptions();
        expect(o).toMatchObject({ to: 99, technique: 'react', finish: 'final-logout', pauseFor: 'none', playerRadius: 15, maxPauses: 3, pauseLimitAck: false });
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

    test('S17 state (75, inside the course): only the Wilderness band has work', async () => {
        const all = steps();
        const s = world({ agility: 75, x: 3004, z: 3940 });
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
        expect(sdk.starts[0]!.params).toMatchObject({ course: 'wilderness', untilLevel: 99, startStep: 'auto', eatBelow: 6, pauseFor: 'threat', playerRadius: 15 });
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

    test('reaching 99: the final logout runs, and the postcondition accepts the logged-out end', async () => {
        const sdk = new PageSdk(world({ agility: 98, x: 3004, z: 3940 }));
        let logouts = 0;
        const band = step(steps({ logout: async () => void logouts++ }), 'agility:wilderness');
        const log = TickLog.memory();
        const run = band.run(ctxFor(sdk, log) as never);
        await flush();
        sdk.end({ ended: 'level', level: 99, levelTicks: { 99: 101 } }, { skills: [{ name: 'Agility', level: 99, baseLevel: 99, experience: 0 }] });
        await run;
        expect(logouts).toBe(1);
        expect(log.rows.map(r => r.step)).toEqual(['agility:level', 'agility:program', 'agility:final-logout']);
        expect(band.postconditions(baseState({ inGame: false }), {} as never)).toBe(true);
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
