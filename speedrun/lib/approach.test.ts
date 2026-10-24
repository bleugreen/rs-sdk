import { describe, expect, test } from 'bun:test';
import type { BotWorldState, NearbyLoc, NearbyNpc, PlayerState } from '../../sdk/types';
import { approachInRange, approachNpc, besideNpc, doorsBetween, footprintDistance, unroutedReply } from './approach';
import { talkTo } from './act';
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

describe('approachInRange: a tile in range of a target the sends cannot reach (rs/693)', () => {
    const SCORPION = (x: number, z: number, over: Partial<NearbyNpc> = {}) => npc(x, z, { name: 'Khazard Scorpion', index: 9, size: 2, reachable: false, ...over });
    const sighted = () => true;

    test('range 1 is beside it: the run ends within 1 of the footprint', async () => {
        const sdk = world(3200, 3200, { nearbyNpcs: [npc(3206, 3200, { reachable: false })] });
        simulateWalking(sdk);
        const r = await drive(sdk, approachInRange(sdk as never, DORIC, 1, { bot, sight: sighted }), 60);
        expect(r).toMatchObject({ ok: true, finds: 1, runs: 1 });
        expect(besideNpc(sdk, r.npc!)).toBe(true);
        expect(r.tile).toEqual(at(sdk));
    });

    test('a tile with line of sight is chosen over a nearer blind one', async () => {
        const sdk = world(3200, 3200, { nearbyNpcs: [npc(3210, 3200)] });
        simulateWalking(sdk);
        const r = await drive(sdk, approachInRange(sdk as never, DORIC, 5, { bot, sight: (_l, from) => from.x >= 3208 }), 60);
        expect(r).toMatchObject({ ok: true, runs: 1 });
        expect(at(sdk).x).toBe(3208);
    });

    test('the player already in range with line of sight: ok at once, nothing sent', async () => {
        const sdk = world(3200, 3200, { nearbyNpcs: [npc(3204, 3200)] });
        const r = await drive(sdk, approachInRange(sdk as never, DORIC, 10, { bot, sight: sighted }), 20);
        expect(r).toMatchObject({ ok: true, finds: 1, runs: 0, tile: { x: 3200, z: 3200 } });
        expect(sdk.sent).toEqual([]);
    });

    test('the live tile moved between finds: found again by index and approached again', async () => {
        const sdk = world(3200, 3200, { nearbyNpcs: [npc(3206, 3200)] });
        simulateWalking(sdk);
        let moved = false;
        const each = (s: BotWorldState): Partial<BotWorldState> => {
            const n = s.nearbyNpcs[0]!;
            if (moved || !besideNpc(s, n)) return {};
            moved = true;
            return { nearbyNpcs: [npc(n.x + 4, n.z)] };
        };
        const r = await drive(sdk, approachInRange(sdk as never, npc(3206, 3200), 1, { bot, sight: sighted, refinds: 1 }), 120, each);
        expect(r).toMatchObject({ ok: true, finds: 2, runs: 2 });
        expect(r.note).toBeUndefined();
        expect(besideNpc(sdk, r.npc!)).toBe(true);
    });

    test('no candidate routes (a caged scorpion behind its gate): ok false, the reason naming it and its tile, nothing sent', async () => {
        const sdk = world(2603, 3155, { nearbyNpcs: [SCORPION(2608, 3160)] });
        sdk.pathTo = () => ({ success: true, waypoints: [{ x: 2606, z: 3160, level: 0 }], reachedDestination: false });
        const r = await drive(sdk, approachInRange(sdk as never, /scorpion/i, 1, { bot, sight: sighted }), 20);
        expect(r).toMatchObject({ ok: false, finds: 1, runs: 0, reason: 'Khazard Scorpion not reachable for an attack from any tile (at 2608,3160)' });
        expect(sdk.sent).toEqual([]);
        const blind = world(2603, 3155, { nearbyNpcs: [SCORPION(2608, 3160)] });
        expect((await drive(blind, approachInRange(blind as never, /scorpion/i, 10, { bot, sight: () => false }), 20)).reason).toBe('Khazard Scorpion not reachable for a cast from any tile (at 2608,3160)');
    });

    test('never throws: a route lookup that throws, or a target never in sight, is ok false with the reason', async () => {
        const sdk = world(3200, 3200, { nearbyNpcs: [npc(3210, 3200)] });
        sdk.pathTo = () => { throw new Error('collision map gone'); };
        const r = await drive(sdk, approachInRange(sdk as never, DORIC, 1, { bot, sight: sighted }), 20);
        expect(r).toMatchObject({ ok: false, reason: 'approach: collision map gone' });
        const none = world(3200, 3200, { nearbyNpcs: [] });
        expect((await drive(none, approachInRange(none as never, npc(3210, 3200), 1, { bot, sight: sighted, findTicks: 3 }), 20)).reason).toBe('Doric not in sight within 3 ticks (find 1)');
    });

    test('footprintDistance: 0 on a size-2 footprint, 1 beside it', () => {
        expect(footprintDistance({ x: 2609, z: 3161 }, { x: 2608, z: 3160 }, 2)).toBe(0);
        expect(footprintDistance({ x: 2610, z: 3159 }, { x: 2608, z: 3160 }, 2)).toBe(1);
        expect(footprintDistance({ x: 2606, z: 3159 }, { x: 2608, z: 3160 }, 2)).toBe(2);
    });

    test('unroutedReply: the browser routed:false, its message, lite cant_reach; a routed or plain result is not', () => {
        expect(unroutedReply({ success: true, data: { routed: false } })).toBe(true);
        expect(unroutedReply({ success: true, message: 'Casting spell on NPC #5929 (unrouted - ap-range attempt)' })).toBe(true);
        expect(unroutedReply({ success: false, reason: 'cant_reach' })).toBe(true);
        expect(unroutedReply({ success: true, message: 'Casting spell on NPC #5929', userEvents: 2 })).toBe(false);
        expect(unroutedReply(undefined)).toBe(false);
    });
});

describe('talkTo on an NPC its click cannot reach (rs/693)', () => {
    const UNROUTED = { success: true, message: 'Interacting with NPC #7 (unrouted - ap-range attempt)', phase: 'dispatch', data: { routed: false } };
    const page = { isOpen: true, isWaiting: false, pageId: 'd1', options: [{ index: 1, text: 'Click here to continue', buttonType: 6, componentId: 10 }] } as BotWorldState['dialog'];
    const shut = { isOpen: false, options: [], isWaiting: false } as BotWorldState['dialog'];
    /** Talk-to answers with the NPC's page only from beside it; from anywhere else the client sends it unrouted. Continue closes the page. */
    function npcServer(sdk: FakeSdk) {
        let clicks = 0;
        const orig = sdk.sendInteractNpc.bind(sdk);
        (sdk as any).sendInteractNpc = async (i: number, o: number) => {
            await orig(i, o);
            clicks++;
            const n = sdk.state!.nearbyNpcs.find(x => x.index === i);
            if (!n || !besideNpc(sdk, n)) return UNROUTED;
            setTimeout(() => sdk.tick({ dialog: page }), 1);
            return { success: true, message: 'ok' };
        };
        const prev = sdk.onSend;
        sdk.onSend = (a, f) => {
            prev(a, f);
            if (f.state!.dialog.isOpen && !['sendInteractNpc', 'sendWalk', 'sendInteractLoc'].includes(a.method)) setTimeout(() => sdk.tick({ dialog: shut }), 1);
        };
        return { clicks: () => clicks };
    }

    test('behind a shut door (the Edmond shape): the unrouted click opens nothing, the door is opened, the run to within 1, the next click talks', async () => {
        const { sdk, each, DOOR } = shutIn({ x: 3206, z: 3200 });
        const srv = npcServer(sdk);
        const r = await drive(sdk, talkTo(sdk as never, DORIC, [], { idle: 1, openTicks: 5 }), 200, each);
        expect(r).toMatchObject({ ok: true, opened: true, clicks: 2, approachFinds: 1 });
        expect(srv.clicks()).toBeGreaterThanOrEqual(2);
        expect(sdk.sent.some(a => a.method === 'sendInteractLoc' && a.args[0] === DOOR.x)).toBe(true);
        expect(besideNpc(sdk, r.npc)).toBe(true);
    });

    test('a routed click is unchanged: no approach, nothing but the click', async () => {
        const sdk = world(3200, 3200, { nearbyNpcs: [npc(3201, 3200)] });
        npcServer(sdk);
        const r = await drive(sdk, talkTo(sdk as never, DORIC, [], { idle: 1, openTicks: 5 }), 60);
        expect(r).toMatchObject({ ok: true, opened: true, clicks: 1 });
        expect(r.approachFinds).toBeUndefined();
        expect(sdk.sent.filter(a => a.method === 'sendWalk' || a.method === 'sendInteractLoc')).toEqual([]);
    });

    test('with a caller\'s approach before the talk (rs/674), the two never exceed 2 re-finds in one talk', async () => {
        for (const before of [0, 1, 2]) {
            // It steps 3 east every time SCORED arrives beside it, so every find is used.
            const sdk = world(3200, 3200, { nearbyNpcs: [npc(3206, 3200, { reachable: false })] });
            simulateWalking(sdk);
            npcServer(sdk);
            const each = (s: BotWorldState): Partial<BotWorldState> => {
                const n = s.nearbyNpcs[0]!;
                return besideNpc(s, n) && !s.dialog.isOpen ? { nearbyNpcs: [npc(n.x + 3, n.z, { reachable: false })] } : {};
            };
            const a = await drive(sdk, approachNpc(sdk as never, DORIC, { bot, refinds: before }), 200, each);
            const r = await drive(sdk, talkTo(sdk as never, DORIC, [], { idle: 1, openTicks: 3, refinds: Math.max(0, 2 - (a.finds - 1)) }), 300, each);
            expect(a.finds - 1 + (r.approachFinds ?? 0)).toBeLessThanOrEqual(2);
        }
    });
});
