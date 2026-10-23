/**
 * walkTo when the client refuses a walk (rs/548). The browser client routes a walk itself (Client.ts
 * walkTo -> tryMove over its own collision map) and refuses one it finds no route for: no packet goes
 * out and the action comes back `client_rejected` at once. Monkey Madness K on the browser walked
 * into a region rebuild at (2725,9137): every leg was refused, walkStepToward called each refusal
 * 'stuck' without a tick passing, and walkTo re-sent the same three waypoints 12 times inside one
 * tick before reporting "Stuck at". The lite client, sent the same legs, walked them.
 *
 * A refused walk now waits for the next observed tick before anything else is sent: a region that
 * is loading is waited out (as for scene_loading), the waypoint is re-sent once, and a second
 * refusal tries nearer tiles on the way to it. No tile is ever sent twice in one tick.
 *
 * The fake world ticks every few ms; the real walkTo loop and the real walkStepToward run against it.
 */
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { BotSDK } from '../index';
import { BotActions } from '../actions';
import { tilesToward } from '../actions-helpers';

const START = { x: 2737, z: 3137 };
const MID = { x: 2725, z: 3137 };
const DEST = { x: 2716, z: 3137 };

type Send = { tick: number; x: number; z: number; ok: boolean };
type Refuse = (s: any, x: number, z: number) => string | null;

function world(opts: { refuse: Refuse; sceneAt?: (tick: number) => boolean }) {
    const sdk = new BotSDK({ botUsername: 'test' });
    const s: any = {
        tick: 1, inGame: true, sceneReady: true,
        player: { worldX: START.x, worldZ: START.z, x: START.x, z: START.z, level: 0, lifeId: 1, isDead: false },
        gameMessages: [], nearbyLocs: [], nearbyNpcs: [], inventory: [],
        dialog: { isOpen: false, options: [], isWaiting: false }, interface: { isOpen: false },
        shop: { isOpen: false }, bank: { isOpen: false },
    };
    (sdk as any).state = s;
    let target: { x: number; z: number } | null = null;
    const sends: Send[] = [];
    (sdk as any).sendWalk = async (x: number, z: number) => {
        const reason = opts.refuse(s, x, z);
        sends.push({ tick: s.tick, x, z, ok: reason === null });
        // The browser ActionExecutor's answer when Client.walkTo emitted no MOVE packet.
        if (reason) return { success: false, phase: 'validation', reason, message: 'Failed to walk' };
        target = { x, z };
        return { success: true, phase: 'dispatch', message: `Walking to (${x}, ${z})` };
    };
    // Plans from where the player stands, as the real path-finder does: waypoints already passed
    // (the walk runs west) are not handed back.
    (sdk as any).sendFindPath = async () => ({
        success: true, reachedDestination: true,
        waypoints: [MID, DEST].filter(w => w.x < s.player.worldX).map(w => ({ x: w.x, z: w.z, level: 0 })),
    });
    const bot = new BotActions(sdk);
    (bot as any).dismissBlockingUI = async () => {};
    (bot as any).helpers.tryOpenBlockingDoor = async () => false;

    const timer = setInterval(() => {
        s.tick++;
        if (opts.sceneAt) s.sceneReady = opts.sceneAt(s.tick);
        if (target) {
            const p = s.player;
            const step = (from: number, to: number) => from + Math.max(-2, Math.min(2, to - from));
            const x = step(p.worldX, target.x), z = step(p.worldZ, target.z);
            s.player = { ...p, worldX: x, worldZ: z, x, z };
        }
        for (const listener of (sdk as any).stateListeners) listener(s);
    }, 2);
    stops.push(() => clearInterval(timer));
    return { bot, sends, state: s };
}

/** Every (tick, tile) pair sent more than once: a walker re-sending inside one tick. */
function sameTickRepeats(sends: Send[]): string[] {
    const seen = new Map<string, number>();
    for (const w of sends) {
        const k = `t${w.tick} ${w.x},${w.z}`;
        seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    return [...seen].filter(([, n]) => n > 1).map(([k, n]) => `${k} x${n}`);
}

const stops: Array<() => void> = [];
afterEach(() => { while (stops.length) stops.pop()!(); });

describe('tilesToward', () => {
    test('one step short, then halving toward the start, on the diagonal-then-straight line', () => {
        expect(tilesToward({ x: 0, z: 0 }, { x: 12, z: 0 })).toEqual([{ x: 11, z: 0 }, { x: 5, z: 0 }, { x: 2, z: 0 }, { x: 1, z: 0 }]);
        expect(tilesToward({ x: 2725, z: 9137 }, { x: 2722, z: 9140 })).toEqual([{ x: 2723, z: 9139 }, { x: 2724, z: 9138 }]);
        expect(tilesToward({ x: 0, z: 0 }, { x: 1, z: 1 })).toEqual([]);
    });
});

describe('walkTo when the client refuses the walk (client_rejected)', () => {
    test('a rebuild that refuses walks before sceneReady turns false is waited out, and the walk arrives', async () => {
        const log = spyOn(console, 'log').mockImplementation(() => {});
        try {
            // Ticks 1-7 the client is rebuilding: it refuses every walk. The state it last published
            // (tick 1) still says sceneReady; ticks 2-7 say false; from tick 8 the region is built.
            const { bot, sends } = world({
                refuse: s => (s.tick < 8 ? 'client_rejected' : null),
                sceneAt: t => t >= 8 || t < 2,
            });
            const r = await bot.walkTo(DEST.x, DEST.z, 0);
            expect(sameTickRepeats(sends)).toEqual([]);
            expect(r).toMatchObject({ success: true, message: 'Arrived' });
            expect(sends.filter(w => !w.ok).length).toBeLessThanOrEqual(3);
        } finally {
            log.mockRestore();
        }
    });

    test('a waypoint the client keeps refusing is approached through nearer tiles', async () => {
        // A client whose own collision finds no route beyond 4 tiles of the player.
        const { bot, sends } = world({
            refuse: (s, x, z) => (Math.max(Math.abs(x - s.player.worldX), Math.abs(z - s.player.worldZ)) > 4 ? 'client_rejected' : null),
        });
        const r = await bot.walkTo(DEST.x, DEST.z, 0);
        expect(sameTickRepeats(sends)).toEqual([]);
        expect(r).toMatchObject({ success: true, message: 'Arrived' });
    });

    test('a walk refused every time never re-sends a tile inside one tick, and fails on ticks, not in one', async () => {
        const { bot, sends, state } = world({ refuse: () => 'client_rejected' });
        const r = await bot.walkTo(DEST.x, DEST.z, 0);
        expect(r).toMatchObject({ success: false, message: `Stuck at (${START.x}, ${START.z})` });
        expect(sameTickRepeats(sends)).toEqual([]);
        // Each waypoint attempt costs an observed tick before its re-send (the old loop: 0 ticks).
        const waypointSends = sends.filter(w => (w.x === MID.x && w.z === MID.z) || (w.x === DEST.x && w.z === DEST.z));
        expect(state.tick - 1).toBeGreaterThanOrEqual(waypointSends.length / 2);
    });

    test('a client that accepts every walk (lite) sends exactly one walk per waypoint, as before', async () => {
        const { bot, sends } = world({ refuse: () => null });
        const r = await bot.walkTo(DEST.x, DEST.z, 0);
        expect(r).toMatchObject({ success: true, message: 'Arrived' });
        expect(sends.map(w => [w.x, w.z])).toEqual([[MID.x, MID.z], [DEST.x, DEST.z]]);
    });
});
