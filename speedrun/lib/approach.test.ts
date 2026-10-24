import { describe, expect, test } from 'bun:test';
import type { BotWorldState, NearbyLoc, NearbyNpc, PlayerState } from '../../sdk/types';
import { approachNpc, besideNpc, doorsBetween } from './approach';
import { baseState, drive, FakeSdk, flush, simulateWalking } from './fake-sdk';

const player = (worldX: number, worldZ: number) => ({ name: 'lab', x: worldX, z: worldZ, worldX, worldZ, level: 0, hp: 40, maxHp: 40 }) as PlayerState;
const door = (x: number, z: number, open = false): NearbyLoc => {
    const ops = open ? ['Close'] : ['Open'];
    return { id: open ? 1531 : 1530, name: 'Door', x, z, level: 0, distance: 1, optionsWithIndex: ops.map((text, i) => ({ text, opIndex: i + 1 })), options: ops };
};
const npc = (x: number, z: number, over: Partial<NearbyNpc> = {}): NearbyNpc =>
    ({ kind: 'npc', id: 284, index: 7, name: 'Doric', combatLevel: 0, x, z, tileX: x, tileZ: z, size: 1, distance: 1, hp: null, maxHp: null, healthPercent: null, targetIndex: -1, inCombat: false, lastCombatTick: null, animId: -1, spotanimId: -1, optionsWithIndex: [{ text: 'Talk-to', opIndex: 1 }], options: ['Talk-to'], ...over }) as NearbyNpc;
const world = (x: number, z: number, more: Partial<BotWorldState> = {}) => new FakeSdk(baseState({ tick: 100, player: player(x, z), ...more }));
const at = (sdk: FakeSdk) => ({ x: sdk.state!.player!.worldX, z: sdk.state!.player!.worldZ });
const DORIC = /^doric$/i;
const bot = { walkTo: async () => ({ success: false, message: 'test: no fallback' }) };

/**
 * A house: SCORED outside to the west, a door at (3203,3200) whose wall is on its east edge, the
 * NPC inside. The door opens a tick after its Open click lands (unless `stuck`), and while it is
 * shut the walk cannot step east of it and the client cannot route to the NPC.
 */
function shutIn(npcAt: { x: number; z: number }, opts: { stuck?: boolean; reachable?: boolean } = {}) {
    const DOOR = { x: 3203, z: 3200 };
    let open = false;
    const sdk = world(3200, 3200, { nearbyLocs: [door(DOOR.x, DOOR.z)], nearbyNpcs: [npc(npcAt.x, npcAt.z, opts.reachable === undefined ? { reachable: false } : {})] });
    const sim = simulateWalking(sdk, { blocked: x => !open && x > DOOR.x });
    const prev = sdk.onSend;
    let openAt = -1;
    sdk.onSend = (a, f) => {
        prev(a, f);
        if (a.method === 'sendInteractLoc' && a.args[0] === DOOR.x && a.args[1] === DOOR.z && !opts.stuck) openAt = f.state!.tick + 1;
    };
    const each = (s: BotWorldState): Partial<BotWorldState> => {
        if (open || openAt < 0 || s.tick + 1 < openAt) return {};
        open = true;
        return {
            nearbyLocs: [door(DOOR.x, DOOR.z, true)],
            nearbyNpcs: s.nearbyNpcs.map(n => (opts.reachable === undefined ? { ...n, reachable: true } : n)),
        };
    };
    return { sdk, sim, each, DOOR };
}

describe('doorsBetween: the closed doors the SDK route crosses', () => {
    test('a closed door on the route is found; one beside it, or open, is not', async () => {
        const sdk = world(3200, 3200, { nearbyLocs: [door(3203, 3200), door(3203, 3202), door(3205, 3200, true)] });
        expect((await doorsBetween(sdk as never, { x: 3206, z: 3200 })).map(d => [d.x, d.z])).toEqual([[3203, 3200]]);
        expect(await doorsBetween(sdk as never, { x: 3200, z: 3196 })).toEqual([]);
    });

    test('walking order along the SDK route, the door under the player first', async () => {
        const sdk = world(3203, 3200, { nearbyLocs: [door(3210, 3205), door(3203, 3200), door(3206, 3205)] });
        sdk.pathTo = (x, z) => ({ success: true, waypoints: [{ x: 3203, z: 3205, level: 0 }, { x, z, level: 0 }], reachedDestination: true });
        expect((await doorsBetween(sdk as never, { x: 3212, z: 3205 })).map(d => [d.x, d.z])).toEqual([[3203, 3200], [3206, 3205], [3210, 3205]]);
    });

    test('waits for a built scene before reading the loc list', async () => {
        const sdk = world(3200, 3200, { sceneReady: false, nearbyLocs: [] });
        const p = doorsBetween(sdk as never, { x: 3206, z: 3200 });
        await flush();
        sdk.tick({ sceneReady: true, nearbyLocs: [door(3203, 3200)] });
        expect((await p).map(d => [d.x, d.z])).toEqual([[3203, 3200]]);
    });
});

describe('approachNpc: the way to a wandering NPC before a talk', () => {
    test('the NPC within 1: ok at once, nothing sent', async () => {
        const sdk = world(3200, 3200, { nearbyNpcs: [npc(3201, 3201)] });
        const r = await drive(sdk, approachNpc(sdk as never, DORIC, { bot }));
        expect(r).toMatchObject({ ok: true, ticks: 0, finds: 1, runs: 0, doors: [] });
        expect(r.npc?.index).toBe(7);
        expect(sdk.sent).toEqual([]);
    });

    test('in sight with a clear route (the client routes to it, or no closed door on the way): nothing sent, the talk click walks', async () => {
        const reachable = world(3200, 3200, { nearbyLocs: [door(3203, 3200)], nearbyNpcs: [npc(3206, 3200, { reachable: true })] });
        expect(await drive(reachable, approachNpc(reachable as never, DORIC, { bot }))).toMatchObject({ ok: true, ticks: 0, runs: 0, doors: [] });
        expect(reachable.sent).toEqual([]);
        const unknown = world(3200, 3200, { nearbyLocs: [door(3203, 3204)], nearbyNpcs: [npc(3206, 3200)] });
        expect(await drive(unknown, approachNpc(unknown as never, DORIC, { bot }))).toMatchObject({ ok: true, ticks: 0, runs: 0, doors: [] });
        expect(unknown.sent).toEqual([]);
    });

    test('shut behind a closed door: the door is opened, then the run to within 1 of the live tile', async () => {
        const { sdk, each, DOOR } = shutIn({ x: 3206, z: 3200 });
        const r = await drive(sdk, approachNpc(sdk as never, DORIC, { bot }), 120, each);
        expect(r).toMatchObject({ ok: true, finds: 1, runs: 1, doors: [DOOR] });
        expect(r.note).toBeUndefined();
        expect(besideNpc(sdk, r.npc!)).toBe(true);
        const methods = sdk.sent.map(a => a.method);
        expect(methods[0]).toBe('sendInteractLoc');
        expect(methods.indexOf('sendWalk')).toBeGreaterThan(0);
    });

    test('the client does not say whether it can route: a closed door on the route still sends the approach', async () => {
        const { sdk, each, DOOR } = shutIn({ x: 3206, z: 3200 }, { reachable: true });
        sdk.state = { ...sdk.state!, nearbyNpcs: [npc(3206, 3200)] };
        const r = await drive(sdk, approachNpc(sdk as never, DORIC, { bot }), 120, each);
        expect(r).toMatchObject({ ok: true, runs: 1, doors: [DOOR] });
    });

    test('the NPC moves off the tile walked to: found again and approached, at most 2 more times, then the talk goes from there', async () => {
        // The client cannot route to it (another room's wall), and it steps 3 east each time SCORED arrives beside it.
        const sdk = world(3200, 3200, { nearbyNpcs: [npc(3206, 3200, { reachable: false })] });
        simulateWalking(sdk);
        let moves = 0;
        const each = (s: BotWorldState): Partial<BotWorldState> => {
            const n = s.nearbyNpcs[0]!;
            if (!besideNpc(s, n)) return {};
            moves++;
            return { nearbyNpcs: [npc(n.x + 3, n.z, { reachable: false })] };
        };
        const r = await drive(sdk, approachNpc(sdk as never, DORIC, { bot }), 200, each);
        expect(r).toMatchObject({ ok: true, finds: 3, runs: 3 });
        expect(r.note).toMatch(/moved off each tile walked to \(3 finds\)/);
        expect(moves).toBe(3);
    });

    test('the NPC moves once and then stands: the second find settles it', async () => {
        const sdk = world(3200, 3200, { nearbyNpcs: [npc(3206, 3200, { reachable: false })] });
        simulateWalking(sdk);
        let moved = false;
        const each = (s: BotWorldState): Partial<BotWorldState> => {
            const n = s.nearbyNpcs[0]!;
            if (moved || !besideNpc(s, n)) return {};
            moved = true;
            return { nearbyNpcs: [npc(n.x + 3, n.z, { reachable: true })] };
        };
        const r = await drive(sdk, approachNpc(sdk as never, DORIC, { bot }), 200, each);
        expect(r).toMatchObject({ ok: true, finds: 2, runs: 1 });
        expect(r.note).toBeUndefined();
    });

    test('the NPC never in sight: refused with the reason after the bounded wait, nothing sent, no throw', async () => {
        const sdk = world(3200, 3200, { nearbyNpcs: [] });
        const r = await drive(sdk, approachNpc(sdk as never, DORIC, { bot, findTicks: 5 }), 40);
        expect(r).toMatchObject({ ok: false, finds: 1 });
        expect(r.reason).toMatch(/not in sight within 5 ticks/);
        expect(sdk.sent).toEqual([]);
    });

    test('a door that will not open: refused with the door named, no throw', async () => {
        const { sdk, each } = shutIn({ x: 3206, z: 3200 }, { stuck: true });
        const r = await drive(sdk, approachNpc(sdk as never, DORIC, { bot }), 120, each);
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/the door at 3203,3200 did not open/);
        expect(at(sdk).x).toBe(3200);
    });

    test('near picks the candidate by its spawn, as the talk does', async () => {
        const sdk = world(3200, 3200, { nearbyNpcs: [npc(3201, 3200, { index: 1 }), npc(3230, 3200, { index: 2, reachable: true })] });
        const r = await drive(sdk, approachNpc(sdk as never, DORIC, { bot, near: { x: 3231, z: 3200 } }));
        expect(r.npc?.index).toBe(2);
        expect(sdk.sent).toEqual([]);
    });
});
