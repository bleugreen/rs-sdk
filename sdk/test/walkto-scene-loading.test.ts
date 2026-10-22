/**
 * walkTo across a region rebuild on the browser client (rs/485). A walk sent while state.sceneReady
 * is false comes back `reason: 'scene_loading'` and may not have been routed. walkStepToward used to
 * call that 'stuck' at once, so a walkTo leg that started during "Loading - please wait." failed
 * with "Stuck at" on open ground within a second (rs/310, cairn_jumps on the demo). It now waits for
 * sceneReady, bounded in observed ticks, and re-sends once.
 *
 * The fake world ticks every few ms: the real walkTo loop and the real walkStepToward run against
 * it. Its walk routes only while the region is built, like the browser client with stale maps.
 */
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { BotSDK } from '../index';
import { BotActions } from '../actions';
import { SCENE_READY_TICKS } from '../actions-helpers';

const START = { x: 2539, z: 3351 };
const DEST = { x: 2561, z: 3311 };

function world(opts: { readyAtTick: number | null; walkFails?: string }) {
    const sdk = new BotSDK({ botUsername: 'test' });
    const s: any = {
        tick: 1, inGame: true, sceneReady: opts.readyAtTick === 0,
        player: { worldX: START.x, worldZ: START.z, x: START.x, z: START.z, level: 0, lifeId: 1, isDead: false },
        gameMessages: [], nearbyLocs: [], nearbyNpcs: [], inventory: [],
        dialog: { isOpen: false, options: [], isWaiting: false }, interface: { isOpen: false },
        shop: { isOpen: false }, bank: { isOpen: false },
    };
    (sdk as any).state = s;
    let target: { x: number; z: number } | null = null;
    const sends: Array<{ tick: number; sceneReady: boolean }> = [];
    (sdk as any).sendWalk = async (x: number, z: number) => {
        sends.push({ tick: s.tick, sceneReady: s.sceneReady });
        if (opts.walkFails) return { success: false, reason: opts.walkFails, message: 'refused' };
        if (s.sceneReady === false) return { success: false, phase: 'dispatch', reason: 'scene_loading', message: 'walkTo sent while the client was still loading the region' };
        target = { x, z };
        return { success: true, message: 'Walking' };
    };
    (sdk as any).sendFindPath = async () => ({
        success: true, reachedDestination: true,
        waypoints: [{ x: 2550, z: 3331, level: 0 }, { x: DEST.x, z: DEST.z, level: 0 }],
    });
    const bot = new BotActions(sdk);
    (bot as any).dismissBlockingUI = async () => {};
    (bot as any).helpers.tryOpenBlockingDoor = async () => false;

    const timer = setInterval(() => {
        s.tick++;
        if (opts.readyAtTick !== null && s.tick >= opts.readyAtTick) s.sceneReady = true;
        if (target) {
            const p = s.player;
            const step = (from: number, to: number) => from + Math.max(-2, Math.min(2, to - from));
            s.player = { ...p, worldX: step(p.worldX, target.x), worldZ: step(p.worldZ, target.z), x: step(p.worldX, target.x), z: step(p.worldZ, target.z) };
        }
        for (const listener of (sdk as any).stateListeners) listener(s);
    }, 2);
    stops.push(() => clearInterval(timer));
    return { bot, sends, state: s };
}

const stops: Array<() => void> = [];
afterEach(() => { while (stops.length) stops.pop()!(); });

describe('walkTo while the region loads (scene_loading)', () => {
    test('waits for sceneReady, re-sends once and arrives', async () => {
        const log = spyOn(console, 'log').mockImplementation(() => {});
        try {
            const { bot, sends } = world({ readyAtTick: 8 });
            const r = await bot.walkTo(DEST.x, DEST.z, 0);
            expect(r).toMatchObject({ success: true, message: 'Arrived' });
            // The walk sent during the load, then its one re-send once the region was built.
            expect(sends[0]).toEqual({ tick: 1, sceneReady: false });
            expect(sends[1]!.sceneReady).toBe(true);
            expect(sends.every((w, i) => i === 0 || w.sceneReady)).toBe(true);
            expect(log.mock.calls.some(c => /scene_loading.*sceneReady after \d+ ticks, re-sending once/.test(String(c[0])))).toBe(true);
        } finally {
            log.mockRestore();
        }
    });

    test('a region that never builds fails after one bounded wait, naming scene_loading', async () => {
        const warn = spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const { bot, sends, state } = world({ readyAtTick: null });
            const r = await bot.walkTo(DEST.x, DEST.z, 0);
            expect(r.success).toBe(false);
            expect(r.message).toBe(`Stuck at (${START.x}, ${START.z})`);
            // One wait of the bound, not one per walk step.
            expect(state.tick).toBeGreaterThanOrEqual(1 + SCENE_READY_TICKS);
            expect(state.tick).toBeLessThan(1 + 2 * SCENE_READY_TICKS);
            expect(sends.length).toBeGreaterThan(1);
            expect(warn.mock.calls.some(c => /scene_loading.*still false after \d+ observed ticks/.test(String(c[0])))).toBe(true);
        } finally {
            warn.mockRestore();
        }
    });

    test('any other dispatch failure is still stuck at once, with no wait', async () => {
        const { bot, state } = world({ readyAtTick: 0, walkFails: 'cant_reach' });
        const r = await bot.walkTo(DEST.x, DEST.z, 0);
        expect(r).toMatchObject({ success: false, message: `Stuck at (${START.x}, ${START.z})` });
        expect(state.tick).toBeLessThan(20);
    });
});
