import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { BotWorldState, InventoryItem, NearbyLoc, PlayerState } from '../../sdk/types';
import { baseState, drive, FakeSdk, flush, simulateWalking } from './fake-sdk';
import { sleep } from './wait';
import {
    deletesFollowerItem, expandRoute, GNOME_STRONGHOLD_GATE, hopNeeds, hopsDestination, LEVERS, passGate, RELOCATE_TILES, runesHeld, runTo, SPELLS, teleport, teleportRefusal, throughWebs, travel, wildernessLevel, type Hop, type Relocation,
} from './travel';

const player = (worldX: number, worldZ: number, level = 0) => ({ name: 'lab', x: worldX, z: worldZ, worldX, worldZ, level, hp: 40, maxHp: 40 }) as PlayerState;
const item = (slot: number, name: string, count = 1): InventoryItem => ({ slot, id: 1000 + slot, name, count, optionsWithIndex: [] }) as unknown as InventoryItem;
const loc = (id: number, name: string, x: number, z: number, ops: string[]): NearbyLoc =>
    ({ id, name, x, z, level: 0, distance: 1, optionsWithIndex: ops.map((text, i) => ({ text, opIndex: i + 1 })), options: ops });
const magic = (level: number) => [{ name: 'Magic', level, baseLevel: level, experience: 0 }];
const world = (x: number, z: number, more: Partial<BotWorldState> = {}) => new FakeSdk(baseState({ tick: 100, player: player(x, z), ...more }));
const at = (sdk: FakeSdk) => ({ x: sdk.state!.player!.worldX, z: sdk.state!.player!.worldZ });
const sends = (sdk: FakeSdk, method: string) => sdk.sent.filter(a => a.method === method).map(a => a.args);

describe('a hop waits for a built region', () => {
    test('no lookup or click goes out while the client rebuilds the region after a landing', async () => {
        const tree = loc(1294, 'Spirit tree', 2542, 3170, ['Talk-to']);
        const sdk = world(2542, 3169, { sceneReady: false, nearbyLocs: [] });
        const p = travel(sdk as never, [{ kind: 'tree', to: 'stronghold' }], { maxTicks: 10 });
        await flush();
        sdk.tick();
        await flush();
        expect(sdk.sent).toEqual([]);
        sdk.tick({ sceneReady: true, nearbyLocs: [tree] });
        for (let i = 0; i < 5; i++) await flush();
        expect(sends(sdk, 'sendInteractLoc')).toEqual([[2542, 3170, 1294, 1]]);
        sdk.tick({ player: player(2461, 3444) });
        await drive(sdk, p, 30);
    });
});

/**
 * The Gnome Stronghold gate's server side (gnome_gate.rs2, femi.rs2), one queued patch per tick: a
 * click from the south starts Femi's boxes scene while %femi_help is 0 (3 pages, the choice, 2
 * pages; declining sets it), else steps the player 3 tiles north by p_teleport, one a tick.
 */
function gnomeGate(sdk: FakeSdk, opts: { femi?: boolean; drop?: number } = {}) {
    const queue: Array<(s: BotWorldState) => Partial<BotWorldState>> = [];
    let femi = opts.femi ?? true;
    let drop = opts.drop ?? 0;
    const cont = (id: string) => ({ isOpen: true, isWaiting: false, pageId: id, options: [{ index: 1, text: 'Click here to continue', componentId: 4886, buttonType: 6 }] });
    const choice = { isOpen: true, isWaiting: false, pageId: 'p4', options: [{ index: 1, text: "Sorry, I'm a bit busy.", componentId: 2461, buttonType: 1 }, { index: 2, text: 'OK then.', componentId: 2462, buttonType: 1 }] };
    const pages = [cont('p1'), cont('p2'), cont('p3'), choice, cont('p5'), cont('p6')];
    let page = -1;
    const log = { clicks: 0, chose: [] as string[] };
    sdk.onSend = a => {
        if (a.method === 'sendInteractLoc' && a.args[2] === GNOME_STRONGHOLD_GATE.loc.id) {
            log.clicks++;
            if (drop-- > 0) return;
            if (femi && (sdk.state!.player!.worldZ <= 3382)) {
                page = 0;
                queue.push(() => ({ dialog: pages[0]! }));
                return;
            }
            const p = sdk.state!.player!;
            const step = (z: number) => (s: BotWorldState) => ({ player: { ...p, worldZ: z, z, teleportTick: s.tick + 1, teleportJump: false } as PlayerState });
            const dir = p.worldZ <= 3382 ? 1 : -1;
            queue.push(() => ({}), step(p.worldZ + dir), step(p.worldZ + 2 * dir), step(p.worldZ + 3 * dir));
        }
        if (a.method === 'clickDialogByText' && page >= 0) {
            const text = String(a.args[0]);
            if (/busy/.test(text)) {
                log.chose.push('busy');
                femi = false;
            }
            page++;
            const next = page < pages.length ? pages[page]! : { isOpen: false, options: [], isWaiting: false };
            queue.push(() => ({ dialog: next }));
            if (page >= pages.length) page = -1;
        }
    };
    return { each: (s: BotWorldState) => (queue.shift() ?? (() => ({})))(s), log };
}

describe('passGate: the Gnome Stronghold gate', () => {
    const gateLoc = loc(190, 'Gate', 2459, 3383, ['Open']);
    const north = GNOME_STRONGHOLD_GATE.sides.north;

    test("a first visit: Femi's scene is declined by text, the gate clicked again, and ok only once the player stands north", async () => {
        const sdk = world(2461, 3382, { nearbyLocs: [gateLoc] });
        const server = gnomeGate(sdk);
        const r = await drive(sdk, passGate(sdk as never, GNOME_STRONGHOLD_GATE, north), 120, server.each);
        expect(r).toMatchObject({ ok: true, clicks: 2, dialogues: 1, options: 1, pages: 5 });
        expect(server.log.chose).toEqual(['busy']);
        expect(at(sdk)).toEqual({ x: 2461, z: 3385 });
    });

    test('a dialogue already open when it starts (bot.walkTo clicked the gate) is answered first', async () => {
        const sdk = world(2461, 3382, { nearbyLocs: [gateLoc] });
        const server = gnomeGate(sdk);
        await sdk.sendInteractLoc(2459, 3383, 190, 1); // the walker's own door opener
        sdk.tick(server.each);
        expect(sdk.state!.dialog.isOpen).toBe(true);
        const r = await drive(sdk, passGate(sdk as never, GNOME_STRONGHOLD_GATE, north), 120, server.each);
        expect(r).toMatchObject({ ok: true, clicks: 1, dialogues: 1 });
        expect(at(sdk).z).toBe(3385);
    });

    test('after Femi: one click and through; already on the far side: no click', async () => {
        const sdk = world(2461, 3382, { nearbyLocs: [gateLoc] });
        const server = gnomeGate(sdk, { femi: false });
        const r = await drive(sdk, passGate(sdk as never, GNOME_STRONGHOLD_GATE, north), 120, server.each);
        expect(r).toMatchObject({ ok: true, clicks: 1, dialogues: 0 });
        const again = await passGate(sdk as never, GNOME_STRONGHOLD_GATE, north);
        expect(again).toMatchObject({ ok: true, clicks: 0, ticks: 0 });
    });

    test('north to south through the same gate: no dialogue from that side', async () => {
        const sdk = world(2461, 3385, { nearbyLocs: [gateLoc] });
        const server = gnomeGate(sdk);
        const r = await drive(sdk, passGate(sdk as never, GNOME_STRONGHOLD_GATE, GNOME_STRONGHOLD_GATE.sides.south), 120, server.each);
        expect(r).toMatchObject({ ok: true, clicks: 1, dialogues: 0 });
        expect(at(sdk).z).toBe(3382);
    });

    test('a dropped click is re-sent, and a gate that never opens is a failure, never ok', async () => {
        const sdk = world(2461, 3382, { nearbyLocs: [gateLoc] });
        const server = gnomeGate(sdk, { femi: false, drop: 1 });
        const r = await drive(sdk, passGate(sdk as never, GNOME_STRONGHOLD_GATE, north), 120, server.each);
        expect(r).toMatchObject({ ok: true, clicks: 2 });

        const stuck = world(2461, 3382, { nearbyLocs: [gateLoc] });
        const dead = gnomeGate(stuck, { femi: false, drop: 99 });
        const f = await drive(stuck, passGate(stuck as never, GNOME_STRONGHOLD_GATE, north, { maxClicks: 2 }), 400, dead.each);
        expect(f.ok).toBe(false);
        expect(f.reason).toMatch(/not through/);
        expect(at(stuck).z).toBe(3382);
    });

    test('while the region loads nothing is clicked; the click goes out once it is built', async () => {
        const sdk = world(2461, 3382, { nearbyLocs: [gateLoc], sceneReady: false });
        const server = gnomeGate(sdk, { femi: false });
        let n = 0;
        const each = (s: BotWorldState) => (++n === 6 ? { ...server.each(s), sceneReady: true } : server.each(s));
        const p = passGate(sdk as never, GNOME_STRONGHOLD_GATE, north);
        const r = await drive(sdk, p, 120, each);
        expect(r).toMatchObject({ ok: true, clicks: 1, settleTicks: 6 });
    });

    test('as a travel hop', async () => {
        const sdk = world(2461, 3382, { nearbyLocs: [gateLoc] });
        const server = gnomeGate(sdk);
        const r = await drive(sdk, travel(sdk as never, [{ kind: 'gate', gate: GNOME_STRONGHOLD_GATE, to: north }]), 120, server.each);
        expect(r).toMatchObject({ ok: true, clicks: 2 });
        expect(r.segments[0]).toMatchObject({ hop: 'through the Gnome Stronghold south gate', ok: true });
    });
});

describe('runTo: the chained run', () => {
    test('clicks the furthest route tile within 20 and re-sends 3 tiles before each click ends, so the player never stops', async () => {
        const sdk = world(3200, 3200);
        const sim = simulateWalking(sdk);
        const trail: number[] = [];
        sdk.onStateUpdate(s => trail.push(s.player!.worldX));
        const r = await drive(sdk, runTo(sdk as never, { x: 3240, z: 3200 }));
        expect(r).toMatchObject({ ok: true, ticks: 20, tiles: 40, clicks: 3 });
        expect(sim.clicks.map(c => c.x)).toEqual([3220, 3238, 3240]);
        // Each chained click went out while the previous one still had 1 to 3 tiles to run.
        for (let i = 1; i < sim.clicks.length; i++) {
            const left = Math.abs(sim.clicks[i - 1]!.x - sim.clicks[i]!.from.x);
            expect(left).toBeGreaterThanOrEqual(1);
            expect(left).toBeLessThanOrEqual(3);
        }
        // Two tiles every tick from the first click to the arrival.
        expect(trail.every((x, i) => i === 0 || x - trail[i - 1]! === 2)).toBe(true);
        expect(at(sdk)).toEqual({ x: 3240, z: 3200 });
    });

    test('a dropped click is re-sent to the same tile at the first tick the player stands idle', async () => {
        const sdk = world(3200, 3200);
        const sim = simulateWalking(sdk, { accept: n => n !== 1 });
        const r = await drive(sdk, runTo(sdk as never, { x: 3240, z: 3200 }));
        expect(r.ok).toBe(true);
        expect(sim.clicks[0]).toMatchObject({ x: 3220, tick: 100 });
        expect(sim.clicks[1]).toMatchObject({ x: 3220, tick: 101, from: { x: 3200, z: 3200 } });
        expect(r.ticks).toBe(21);
        expect(at(sdk)).toEqual({ x: 3240, z: 3200 });
    });

    test('a re-sent click that is dropped too is a stall 3 ticks after the first click, with a shorter reach', async () => {
        const sdk = world(3200, 3200);
        const sim = simulateWalking(sdk, { accept: n => n > 2 });
        const r = await drive(sdk, runTo(sdk as never, { x: 3240, z: 3200 }));
        expect(r.ok).toBe(true);
        expect(sim.clicks.slice(0, 3)).toMatchObject([{ x: 3220, tick: 100 }, { x: 3220, tick: 101 }, { x: 3210, tick: 103, from: { x: 3200, z: 3200 } }]);
        expect(at(sdk)).toEqual({ x: 3240, z: 3200 });
    });

    test('a forced move out of a door: the click it drops is re-sent once the move ends, and the door behind is never reopened', async () => {
        // The Grand Tree door (gnome_gate.rs2 open_tree_door): the run starts on the forced move's
        // last held tick, so its first click is dropped, and the move carries the player one more
        // tile. The closed door beside the start is the one just come through: opening it would
        // forcemove the player back inside (rs/185, ~50 ticks on each Grand Tree exit).
        const sdk = world(3200, 3200, { nearbyLocs: [loc(1, 'Tree Door', 3200, 3201, ['Open'])] });
        const sim = simulateWalking(sdk, { accept: n => n !== 1 });
        const r = await drive(sdk, runTo(sdk as never, { x: 3200, z: 3170 }), 600, s => (s.tick === 100 ? { player: player(3200, 3199) } : {}));
        expect(r.ok).toBe(true);
        expect(sends(sdk, 'sendInteractLoc')).toEqual([]);
        expect(sim.clicks[1]).toMatchObject({ x: 3200, z: 3180, tick: 102, from: { x: 3200, z: 3199 } });
        expect(r.ticks).toBe(17);
        expect(at(sdk)).toEqual({ x: 3200, z: 3170 });
    });

    test('a forced move out of a door that then stalls: the stall never opens the door behind', async () => {
        // As above, but the re-sent click is dropped too, so the run stalls 2 tiles from the door it
        // was just forcemoved through, which is closed again and the nearest door to the player.
        const sdk = world(3200, 3200, { nearbyLocs: [loc(1, 'Tree Door', 3200, 3201, ['Open'])] });
        const sim = simulateWalking(sdk, { accept: n => n > 2 });
        const r = await drive(sdk, runTo(sdk as never, { x: 3200, z: 3170 }), 600, s => (s.tick === 100 ? { player: player(3200, 3199) } : {}));
        expect(r.ok).toBe(true);
        expect(sim.clicks[2]).toMatchObject({ tick: 104, from: { x: 3200, z: 3199 } });
        expect(sends(sdk, 'sendInteractLoc')).toEqual([]);
        expect(at(sdk)).toEqual({ x: 3200, z: 3170 });
    });

    test('a run that starts on the tile of a shut door it must go back out through opens it at the first stall', async () => {
        // The Dwarf Cannon shed: the player stands inside on the door's tile, its wall on the tile's
        // west edge, and the content has shut it. The route starts one tile west, so it never lists
        // the door's tile.
        const sdk = world(3200, 3200, { nearbyLocs: [loc(1530, 'Door', 3200, 3200, ['Open'])] });
        let open = false;
        simulateWalking(sdk, { blocked: x => !open && x === 3199 });
        const openedAt: number[] = [];
        const prev = sdk.onSend;
        sdk.onSend = (a, f) => {
            prev(a, f);
            if (a.method === 'sendInteractLoc') {
                openedAt.push(f.state!.tick);
                open = true;
                queueMicrotask(() => f.tick({ nearbyLocs: [loc(1531, 'Door', 3200, 3200, ['Close'])] }));
            }
        };
        const r = await drive(sdk, runTo(sdk as never, { x: 3190, z: 3200 }));
        expect(r.ok).toBe(true);
        expect(sends(sdk, 'sendInteractLoc')).toEqual([[3200, 3200, 1530, 1]]);
        // The first click at 100 and its re-send at 101 do not move the player: the stall is at 103.
        expect(openedAt).toEqual([103]);
        expect(at(sdk)).toEqual({ x: 3190, z: 3200 });
    });

    test('a run that starts beside a shut door its route does not need leaves it alone when it stalls', async () => {
        const sdk = world(3200, 3200, { nearbyLocs: [loc(1530, 'Gate', 3200, 3201, ['Open'])] });
        const sim = simulateWalking(sdk, { accept: n => n > 2 });
        const r = await drive(sdk, runTo(sdk as never, { x: 3230, z: 3200 }));
        expect(r.ok).toBe(true);
        expect(sim.clicks[2]).toMatchObject({ tick: 103, from: { x: 3200, z: 3200 } });
        expect(sends(sdk, 'sendInteractLoc')).toEqual([]);
        expect(at(sdk)).toEqual({ x: 3230, z: 3200 });
    });

    test('a stall just past a door the run opened never reopens it', async () => {
        const sdk = world(3200, 3200, { nearbyLocs: [loc(1530, 'Door', 3210, 3200, ['Open'])] });
        const closedAt = (x: number, z: number) => sdk.state!.nearbyLocs.some(l => l.x === x && l.z === z && l.options.includes('Open'));
        // Something holds the player at 3212 until tick 115, right after the door has shut again behind them.
        simulateWalking(sdk, { blocked: (x, z) => closedAt(x, z) || (x === 3213 && sdk.state!.tick < 115) });
        const prev = sdk.onSend;
        sdk.onSend = (a, f) => {
            prev(a, f);
            if (a.method === 'sendInteractLoc') queueMicrotask(() => f.tick({ nearbyLocs: [loc(1531, 'Door', 3210, 3200, ['Close'])] }));
        };
        const shut = (s: BotWorldState) => (s.player!.worldX >= 3211 && s.nearbyLocs[0]!.options.includes('Close') ? { nearbyLocs: [loc(1530, 'Door', 3210, 3200, ['Open'])] } : {});
        const r = await drive(sdk, runTo(sdk as never, { x: 3230, z: 3200 }), 600, shut);
        expect(r.ok).toBe(true);
        expect(sends(sdk, 'sendInteractLoc')).toEqual([[3210, 3200, 1530, 1]]);
        expect(at(sdk)).toEqual({ x: 3230, z: 3200 });
    });

    test('arrives within the tolerance without running to the exact tile', async () => {
        const sdk = world(3200, 3200);
        simulateWalking(sdk);
        const r = await drive(sdk, runTo(sdk as never, { x: 3210, z: 3200, tol: 2 }));
        expect(r.ok).toBe(true);
        expect(at(sdk).x).toBe(3208);
    });

    test('a closed door on the route ahead is opened as part of the run and recorded closed', async () => {
        const door = loc(1530, 'Door', 3210, 3200, ['Open']);
        const sdk = world(3200, 3200, { nearbyLocs: [door] });
        const closedAt = (x: number, z: number) => sdk.state!.nearbyLocs.some(l => l.x === x && l.z === z && l.options.includes('Open'));
        simulateWalking(sdk, { blocked: closedAt });
        const prev = sdk.onSend;
        sdk.onSend = (a, f) => {
            prev(a, f);
            if (a.method === 'sendInteractLoc') queueMicrotask(() => f.tick({ nearbyLocs: [loc(1531, 'Door', 3210, 3200, ['Close'])] }));
        };
        const r = await drive(sdk, runTo(sdk as never, { x: 3230, z: 3200 }));
        expect(r.ok).toBe(true);
        expect(sdk.sent[0]).toEqual({ method: 'sendInteractLoc', args: [3210, 3200, 1530, 1] });
        expect(r.doors).toEqual([expect.objectContaining({ x: 3210, z: 3200, id: 1530, state: 'closed' })]);
        expect(at(sdk)).toEqual({ x: 3230, z: 3200 });
    });

    /**
     * S12 B on the browser (rs/484): the run's click tick fell on a frame the browser published while
     * it rebuilt the map region (sceneReady false), whose loc list lacked the house door. The click
     * went past the door, and only a stall found it again: +9 ticks against lite. `frame` says, for
     * the state of each new tick, whether it is a rebuild frame (an old region's loc, no door), lists
     * the closed door, or lists nothing; the door opens on the interact. A hop's first click already
     * waits for a built scene (rs/309), so the rebuild frames that matter fall mid-run.
     */
    function doorRun(doorX: number, goalX: number, frame: (s: BotWorldState) => 'rebuild' | 'door' | 'none') {
        const shut = loc(1530, 'Door', doorX, 3200, ['Open']);
        const sdk = world(3200, 3200);
        let open = false;
        const from: Array<{ tick: number; x: number }> = [];
        const sim = simulateWalking(sdk, { blocked: x => !open && x === doorX });
        const prev = sdk.onSend;
        sdk.onSend = (a, f) => {
            prev(a, f);
            if (a.method === 'sendInteractLoc') {
                from.push({ tick: f.state!.tick, x: f.state!.player!.worldX });
                open = true;
                queueMicrotask(() => f.tick({ sceneReady: true, nearbyLocs: [loc(1531, 'Door', doorX, 3200, ['Close'])] }));
            }
        };
        const each = (s: BotWorldState): Partial<BotWorldState> => {
            if (open) return {};
            const f = frame({ ...s, tick: s.tick + 1 });
            if (f === 'rebuild') return { sceneReady: false, nearbyLocs: [loc(1530, 'Door', 3120, 3120, ['Open'])] };
            return { sceneReady: true, nearbyLocs: f === 'door' ? [shut] : [] };
        };
        if (frame(sdk.state!) === 'door') sdk.state = { ...sdk.state!, nearbyLocs: [shut] };
        return { sdk, sim, from, run: () => drive(sdk, runTo(sdk as never, { x: goalX, z: 3200 }), 600, each) };
    }

    // The loc scan lists 15 tiles: the door at 3230 is first listed with the player at 3216 (tick 108),
    // between the first click (tick 100, to 3220) and the second (due at 3218, tick 109).
    const scan = (doorX: number) => (s: BotWorldState) => (s.player!.worldX >= doorX - 15 ? 'door' as const : 'none' as const);

    test('lite: a closed door on the route is opened on the first tick it is listed within reach, between clicks', async () => {
        const t = doorRun(3230, 3260, scan(3230));
        const r = await t.run();
        expect(r.ok).toBe(true);
        expect(t.from).toEqual([{ tick: 108, x: 3216 }]);
        // No click fell due before the door: the first click's walk was still running.
        expect(t.sim.clicks.filter(c => c.tick <= 108).map(c => c.x)).toEqual([3220]);
        expect(sends(t.sdk, 'sendInteractLoc')).toEqual([[3230, 3200, 1530, 1]]);
        expect(r.doors).toEqual([expect.objectContaining({ x: 3230, z: 3200, state: 'closed' })]);
        expect(at(t.sdk)).toEqual({ x: 3260, z: 3200 });
    });

    test('browser: the tick the door comes into the scan is a mid-rebuild frame: no click from it, the door opened on the next built tick', async () => {
        const t = doorRun(3230, 3260, s => (s.tick === 108 ? 'rebuild' : scan(3230)(s)));
        const r = await t.run();
        expect(r.ok).toBe(true);
        expect(t.from).toEqual([{ tick: 109, x: 3218 }]);
        expect(sends(t.sdk, 'sendInteractLoc')).toEqual([[3230, 3200, 1530, 1]]);
        expect(at(t.sdk)).toEqual({ x: 3260, z: 3200 });
    });

    test('browser: a door listed before a mid-rebuild click tick was already opened, never clicked past', async () => {
        // S12 B's shape: the door listed from tick 108, the click due at 109 on a rebuild frame.
        const t = doorRun(3230, 3260, s => (s.tick === 109 ? 'rebuild' : scan(3230)(s)));
        const r = await t.run();
        expect(r.ok).toBe(true);
        expect(t.from).toEqual([{ tick: 108, x: 3216 }]);
        // The walk clicks before the door opened stop short of it; the next goes out once it is open.
        expect(t.sim.clicks.filter(c => c.tick <= 109).map(c => c.x)).toEqual([3220]);
        expect(at(t.sdk)).toEqual({ x: 3260, z: 3200 });
    });

    test('a door past the 15-tile loc scan at the click is opened as soon as it is listed, before the player reaches it', async () => {
        const t = doorRun(3216, 3240, s => (s.player!.worldX >= 3216 - 15 ? 'door' : 'none'));
        const r = await t.run();
        expect(r.ok).toBe(true);
        expect(t.sim.clicks[0]).toMatchObject({ x: 3220, tick: 100 });
        // Listed from 3202 on (tick 101); opened on that tick, far short of the wall at 3216.
        expect(t.from).toEqual([{ tick: 101, x: 3202 }]);
        expect(at(t.sdk)).toEqual({ x: 3240, z: 3200 });
    });

    test('a mid-rebuild frame while the server walks to the door is not the door opening: one click per door', async () => {
        // T12-13 and T22-23 on the browser: the frame after the interact lacked the door, the run went
        // on as if it were open, then met it shut and clicked it again.
        const sdk = world(3200, 3200, { nearbyLocs: [loc(1530, 'Door', 3206, 3200, ['Open'])] });
        let openAt = Infinity;
        simulateWalking(sdk, { blocked: x => sdk.state!.tick < openAt && x === 3206 });
        const prev = sdk.onSend;
        sdk.onSend = (a, f) => {
            prev(a, f);
            if (a.method === 'sendInteractLoc') openAt = f.state!.tick + 4;
        };
        const each = (s: BotWorldState): Partial<BotWorldState> => {
            const t = s.tick + 1;
            if (t === 101) return { sceneReady: false, nearbyLocs: [] };
            return { sceneReady: true, nearbyLocs: [loc(t >= openAt ? 1531 : 1530, 'Door', 3206, 3200, [t >= openAt ? 'Close' : 'Open'])] };
        };
        const r = await drive(sdk, runTo(sdk as never, { x: 3220, z: 3200 }), 600, each);
        expect(r.ok).toBe(true);
        expect(sends(sdk, 'sendInteractLoc')).toEqual([[3206, 3200, 1530, 1]]);
        expect(at(sdk)).toEqual({ x: 3220, z: 3200 });
    });

    test('a door listed only on a frame published mid-rebuild is never opened from it', async () => {
        // The door reads closed only on rebuild frames (sceneReady false); every built frame lists none.
        const sdk = world(3200, 3200);
        simulateWalking(sdk);
        const ghost = loc(1530, 'Door', 3210, 3200, ['Open']);
        const r = await drive(sdk, runTo(sdk as never, { x: 3230, z: 3200 }), 600, s => (s.tick % 2 ? { sceneReady: false, nearbyLocs: [ghost] } : { sceneReady: true, nearbyLocs: [] }));
        expect(r.ok).toBe(true);
        expect(sends(sdk, 'sendInteractLoc')).toEqual([]);
    });

    test('an open door on the route is recorded open and never clicked', async () => {
        const sdk = world(3200, 3200, { nearbyLocs: [loc(1531, 'Door', 3210, 3200, ['Close'])] });
        simulateWalking(sdk);
        const r = await drive(sdk, runTo(sdk as never, { x: 3230, z: 3200 }));
        expect(r.ok).toBe(true);
        expect(sends(sdk, 'sendInteractLoc')).toEqual([]);
        expect(r.doors).toEqual([expect.objectContaining({ x: 3210, z: 3200, state: 'open' })]);
    });

    test('a door the route does not cross is found by the stall: opened, then the run goes on', async () => {
        // The pathfinder routes straight, but a door at (3206,3201) is what really holds the player at 3205.
        const sdk = world(3200, 3200, { nearbyLocs: [loc(1530, 'Gate', 3206, 3201, ['Open'])] });
        let open = false;
        simulateWalking(sdk, { blocked: x => !open && x === 3206 });
        const prev = sdk.onSend;
        sdk.onSend = (a, f) => {
            prev(a, f);
            if (a.method === 'sendInteractLoc') {
                open = true;
                queueMicrotask(() => f.tick({ nearbyLocs: [loc(1531, 'Gate', 3206, 3201, ['Close'])] }));
            }
        };
        const r = await drive(sdk, runTo(sdk as never, { x: 3220, z: 3200 }));
        expect(r.ok).toBe(true);
        expect(sends(sdk, 'sendInteractLoc')).toEqual([[3206, 3201, 1530, 1]]);
        expect(r.doors).toEqual([expect.objectContaining({ x: 3206, z: 3201, state: 'closed' })]);
    });

    test('via: the clicks follow the given points where the pathfinder has no map', async () => {
        const sdk = world(3200, 3200);
        sdk.pathTo = () => ({ success: false, waypoints: [] });
        const sim = simulateWalking(sdk);
        const r = await drive(sdk, runTo(sdk as never, { x: 3210, z: 3210 }, { via: [{ x: 3210, z: 3200 }] }));
        expect(r.ok).toBe(true);
        expect(sim.clicks.map(c => [c.x, c.z])).toEqual([[3210, 3200], [3210, 3210]]);
        // The corner's click is chained 3 tiles early, like any other.
        expect(sim.clicks[1]!.from.x).toBeGreaterThanOrEqual(3207);
    });

    test('gives up after maxStalls when nothing moves, with the reason; bot.walkTo carries it when given', async () => {
        const sdk = world(3200, 3200);
        simulateWalking(sdk, { blocked: () => true });
        const r = await drive(sdk, runTo(sdk as never, { x: 3240, z: 3200 }, { maxStalls: 2 }));
        expect(r).toMatchObject({ ok: false });
        expect(r.reason).toMatch(/stalled 2 times at 3200,3200/);

        const sdk2 = world(3200, 3200);
        simulateWalking(sdk2, { blocked: () => true });
        const bot = { walkTo: async (x: number, z: number) => { sdk2.state = { ...sdk2.state!, player: player(x, z) }; return { success: true, message: 'ok' }; } };
        const r2 = await drive(sdk2, runTo(sdk2 as never, { x: 3240, z: 3200 }, { maxStalls: 2, bot: bot as never }));
        expect(r2.ok).toBe(true);
        expect(r2.fellBack).toMatch(/^bot\.walkTo after: run to 3240,3200 stalled/);
    });

    test('stopIf halts the run on the tick it fires, with a walk to the tile stood on, and never falls back to bot.walkTo', async () => {
        const sdk = world(3200, 3200);
        const sim = simulateWalking(sdk);
        let walkToCalls = 0;
        const bot = { walkTo: async () => { walkToCalls++; return { success: true, message: '' }; } };
        const stopIf = (s: BotWorldState) => (s.tick >= 104 ? 'hit' : null);
        const r = await drive(sdk, runTo(sdk as never, { x: 3240, z: 3200 }, { stopIf, bot: bot as never }));
        expect(r).toMatchObject({ ok: false, stopped: 'hit', reason: 'run to 3240,3200: stopped: hit' });
        expect(sim.clicks.at(-1)).toMatchObject({ x: 3208, z: 3200, tick: 104, from: { x: 3208, z: 3200 } });
        expect(walkToCalls).toBe(0);
    });

    test('stopIf before a hop: the teleport is never cast', async () => {
        const sdk = world(3000, 3500, { inventory: [item(0, 'Air rune', 10), item(1, 'Water rune', 5), item(2, 'Law rune', 5)], skills: magic(40) });
        const r = await drive(sdk, teleport(sdk as never, 'falador', { stopIf: () => 'hit' }));
        expect(r).toMatchObject({ ok: false, stopped: 'hit', reason: 'stopped before falador teleport: hit' });
        expect(sends(sdk, 'sendClickComponent')).toEqual([]);
    });

    test('wildernessAtMost stops the run as soon as the level is low enough', async () => {
        const sdk = world(3288, 3700); // Wilderness 23
        simulateWalking(sdk);
        const r = await drive(sdk, runTo(sdk as never, { x: 3288, z: 3600 }, { wildernessAtMost: 20 }));
        expect(r.ok).toBe(true);
        expect(wildernessLevel(at(sdk))).toBe(20);
        expect(at(sdk).z).toBe(3678); // two tiles a tick from 3700: the first tile at level 20 or less
    });
});

describe('runTo: a client that stops publishing', () => {
    // 5 ms ticks: the stall bound is (STALL_TICKS + 10) x 5 = 150 ms of wall time.
    const prev = process.env.SPEEDRUN_TICK_MS;
    beforeAll(() => { process.env.SPEEDRUN_TICK_MS = '5'; });
    afterAll(() => { if (prev === undefined) delete process.env.SPEEDRUN_TICK_MS; else process.env.SPEEDRUN_TICK_MS = prev; });

    async function ticks(sdk: FakeSdk, n: number) {
        for (let i = 0; i < n; i++) {
            await flush();
            sdk.tick();
        }
        await flush();
    }

    test('rides out a stall inside the bound, then arrives', async () => {
        const sdk = world(3200, 3200);
        simulateWalking(sdk);
        const p = runTo(sdk as never, { x: 3240, z: 3200 });
        await ticks(sdk, 5);
        await sleep(60); // silent for 60 ms, under the 150 ms bound
        const r = await drive(sdk, p);
        expect(r.ok).toBe(true);
        expect(at(sdk)).toEqual({ x: 3240, z: 3200 });
    });

    test('past the bound: ok false with no tick, never a throw', async () => {
        const sdk = world(3200, 3200);
        simulateWalking(sdk);
        const p = runTo(sdk as never, { x: 3240, z: 3200 });
        await ticks(sdk, 5);
        const r = await p; // no more ticks
        expect(r.ok).toBe(false);
        expect(r.reason).toBe('run to 3240,3200: no tick');
    });
});

/**
 * A run that something else moves (T06-07 on the browser, rs/589: hitpoints 10, the player stood at
 * 2964,3413 from tick 20, and at tick 29 stood on Lumbridge's respawn square; the walker re-pathed
 * 502 tiles and reported ok). `at` places the player by the tick it is published on.
 */
describe('a walked hop relocated by something it did not do', () => {
    let warn: ReturnType<typeof spyOn>;
    beforeEach(() => { warn = spyOn(console, 'warn').mockImplementation(() => {}); });
    afterEach(() => warn.mockRestore());

    const hp = (n: number) => (s: BotWorldState) => ({ player: { ...s.player!, hp: n, maxHp: 10 } });
    /** The T06-07 death: hitpoints fall to 0 on ticks 104-105 where the player stands, then the respawn at 3222,3216 on 106. */
    const death = (s: BotWorldState): Partial<BotWorldState> => {
        const t = s.tick + 1;
        if (t === 104 || t === 105) return hp(0)(s);
        if (t === 106) return { player: { ...player(3222, 3216), hp: 10, maxHp: 10 } };
        return {};
    };
    const taverley = () => {
        const sdk = world(2964, 3413);
        sdk.state = { ...sdk.state!, player: { ...sdk.state!.player!, hp: 10, maxHp: 10 } };
        return { sdk, sim: simulateWalking(sdk) };
    };

    test('a death mid-run (T06-07, 10 hp, respawn at Lumbridge) fails on the tick it is published, with a respawn reason and the last hp', async () => {
        const { sdk, sim } = taverley();
        const seen: Relocation[] = [];
        const r = await drive(sdk, runTo(sdk as never, { x: 2920, z: 3413 }, { onRelocated: ev => (seen.push(ev), 'fail') }), 600, death);
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/^run to 2920,3413: relocated from 2952,3413 to 3222,3216: respawn \(270 tiles in 1 tick; hp 0 before it, lowest 0\)$/);
        expect(r.relocated).toMatchObject({ respawn: true, from: { x: 2952, z: 3413 }, to: { x: 3222, z: 3216 }, tick: 106, hp: 0, hpMin: 0 });
        expect(seen).toHaveLength(1);
        // No click from Lumbridge: the run ended on the respawn's own tick, and did not re-path.
        expect(sim.clicks.every(c => c.tick < 106)).toBe(true);
        expect(r.endTick).toBe(106);
        expect(warn).not.toHaveBeenCalled();
    });

    test('without a handler the run keeps re-pathing as it did, but logs the relocation loudly and reports it', async () => {
        const { sdk } = taverley();
        const r = await drive(sdk, runTo(sdk as never, { x: 2920, z: 3413 }), 600, death);
        expect(r.ok).toBe(true);
        expect(at(sdk)).toEqual({ x: 2920, z: 3413 });
        expect(r.relocated).toMatchObject({ respawn: true, to: { x: 3222, z: 3216 } });
        expect(r.ticks).toBeGreaterThan(150); // walked back from Lumbridge
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]![0])).toMatch(/RELOCATED during run to 2920,3413: relocated from .* respawn .*; re-pathing from 3222,3216 \(no onRelocated handler\)/);
    });

    test('a jump off the respawn square is a death or forced teleport; a webs hop and a click hop are watched too', async () => {
        const { sdk } = taverley();
        const away = (s: BotWorldState) => (s.tick + 1 === 103 ? { player: { ...s.player!, worldX: 3100, worldZ: 3100, x: 3100, z: 3100 } } : {});
        const r = await drive(sdk, runTo(sdk as never, { x: 2920, z: 3413 }, { onRelocated: () => 'fail' }), 600, away);
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/relocated from 2958,3413 to 3100,3100: death or forced teleport \(313 tiles in 1 tick; hp 10 before it, lowest 10\)/);
        expect(r.relocated?.respawn).toBe(false);

        const click = world(3200, 3200);
        simulateWalking(click);
        const c = await drive(click, travel(click as never, [{ kind: 'click', to: { x: 3210, z: 3200 } }], { onRelocated: () => 'fail' }), 600, s => (s.tick + 1 === 102 ? { player: player(3222, 3218) } : {}));
        expect(c.ok).toBe(false);
        expect(c.reason).toMatch(/^click to 3210,3200: relocated from 3202,3200 to 3222,3218: respawn/);
    });

    test("a teleport hop's landing and a lever's are the hop's own: the run after each starts from the landing, unflagged", async () => {
        const runes = [item(0, 'Air rune', 10), item(1, 'Water rune', 5), item(2, 'Law rune', 5)];
        const sdk = world(3000, 3500, { inventory: runes, skills: magic(40) });
        sdk.onSend = (a, f) => { if (a.method === 'sendClickComponent') queueMicrotask(() => f.tick({ player: player(2965, 3379) })); };
        simulateWalking(sdk);
        const r = await drive(sdk, travel(sdk as never, [{ kind: 'teleport', spell: 'falador' }, { kind: 'run', to: { x: 2985, z: 3379 } }], { onRelocated: () => 'fail' }));
        expect(r.ok).toBe(true);
        expect(r.relocated).toBeUndefined();

        const lever = loc(LEVERS.ardougne.loc, 'Lever', 2561, 3311, ['Pull']);
        const wild = world(2562, 3311, { nearbyLocs: [lever] });
        wild.onSend = (a, f) => { if (a.method === 'sendInteractLoc' && a.args[2] === LEVERS.ardougne.loc) queueMicrotask(() => f.tick({ player: player(3154, 3924), nearbyLocs: [] })); };
        simulateWalking(wild);
        const w = await drive(wild, travel(wild as never, [{ kind: 'lever', lever: 'ardougne' }, { kind: 'run', to: { x: 3154, z: 3904 } }], { onRelocated: () => 'fail' }));
        expect(w.ok).toBe(true);
        expect(w.segments.map(s => s.ok)).toEqual([true, true]);
        expect(w.relocated).toBeUndefined();
        expect(warn).not.toHaveBeenCalled();
    });

    test('a walk, a one-tile correction, a client silence the run rides out and a jump of the bound are not relocations; one more tile is', async () => {
        const fail = { onRelocated: () => 'fail' as const };
        const walk = world(3200, 3200);
        simulateWalking(walk, { speed: 1 });
        expect(await drive(walk, runTo(walk as never, { x: 3230, z: 3200 }, fail))).toMatchObject({ ok: true, ticks: 30 });

        const back = world(3200, 3200);
        simulateWalking(back);
        const nudge = (s: BotWorldState) => (s.tick + 1 === 104 ? { player: player(s.player!.worldX - 1, 3201) } : {});
        const b = await drive(back, runTo(back as never, { x: 3230, z: 3200 }, fail), 600, nudge);
        expect(b.ok).toBe(true);
        expect(b.relocated).toBeUndefined();

        // Six ticks unpublished, 20 tiles on: 15 + 2 for each tick past the first allows 25.
        const quiet = world(3200, 3200);
        simulateWalking(quiet);
        const gap = (s: BotWorldState) => (s.tick + 1 === 103 ? { tick: s.tick + 6, player: player(s.player!.worldX + 20, 3200) } : {});
        const q = await drive(quiet, runTo(quiet as never, { x: 3260, z: 3200 }, fail), 600, gap);
        expect(q.ok).toBe(true);
        expect(q.relocated).toBeUndefined();

        for (const [tiles, flagged] of [[RELOCATE_TILES, false], [RELOCATE_TILES + 1, true]] as const) {
            const sdk = world(3200, 3200);
            simulateWalking(sdk);
            const jump = (s: BotWorldState) => (s.tick + 1 === 103 ? { player: player(s.player!.worldX + tiles, 3200) } : {});
            const r = await drive(sdk, runTo(sdk as never, { x: 3260, z: 3200 }, fail), 600, jump);
            expect(r.ok).toBe(!flagged);
            expect(r.relocated === undefined).toBe(!flagged);
        }
    });

    test('a frame published mid-rebuild is never compared: the jump is measured between built frames', async () => {
        const sdk = world(3200, 3200);
        simulateWalking(sdk);
        // A rebuild frame with a stray position, then the walk goes on where it was.
        const stray = (s: BotWorldState) => {
            const t = s.tick + 1;
            if (t === 103) return { sceneReady: false, player: player(3100, 3100) };
            if (t === 104) return { sceneReady: true, player: player(3208, 3200) };
            return {};
        };
        const r = await drive(sdk, runTo(sdk as never, { x: 3240, z: 3200 }, { onRelocated: () => 'fail' }), 600, stray);
        expect(r.relocated).toBeUndefined();
        expect(r.ok).toBe(true);
    });
});

describe('teleport', () => {
    const runes = [item(0, 'Air rune', 10), item(1, 'Water rune', 5), item(2, 'Law rune', 5)];

    test('casts, then confirms the landing tile', async () => {
        const sdk = world(3000, 3500, { inventory: runes, skills: magic(40) });
        sdk.onSend = (a, f) => { if (a.method === 'sendClickComponent') queueMicrotask(() => f.tick({ player: player(2965, 3379) })); };
        const r = await drive(sdk, teleport(sdk as never, 'falador'));
        expect(r).toMatchObject({ ok: true, ticks: 1, clicks: 1 });
        expect(sends(sdk, 'sendClickComponent')).toEqual([[1170]]);
    });

    test('a jump that lands outside the spell landing is a failure', async () => {
        const sdk = world(3000, 3500, { inventory: runes, skills: magic(40) });
        sdk.onSend = (a, f) => { if (a.method === 'sendClickComponent') queueMicrotask(() => f.tick({ player: player(3100, 3100) })); };
        const r = await drive(sdk, teleport(sdk as never, 'falador'));
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/landed at 3100,3100, outside 2965,3378/);
    });

    test('refused from state (no runes): no click, and the next run hop walks instead', async () => {
        const sdk = world(3000, 3380, { skills: magic(40) });
        simulateWalking(sdk);
        const hops: Hop[] = [{ kind: 'teleport', spell: 'falador' }, { kind: 'run', to: { x: 2970, z: 3380 } }];
        const r = await drive(sdk, travel(sdk as never, hops));
        expect(r.ok).toBe(true);
        expect(sends(sdk, 'sendClickComponent')).toEqual([]);
        expect(r.fellBack).toMatch(/^walked: falador teleport refused \(runes short: 1 water \(have 0\)/);
        expect(r.segments.map(s => [s.hop, s.ok])).toEqual([['falador teleport', false], ['run to 2970,3380', true]]);

        const sdk2 = world(3000, 3380, { skills: magic(40) });
        const r2 = await drive(sdk2, travel(sdk2 as never, hops, { walkOnRefusal: false }));
        expect(r2.ok).toBe(false);
    });

    test('refused by the content ("A mysterious force blocks"): the walk takes over without waiting out the cast', async () => {
        const sdk = world(3000, 3380, { inventory: runes, skills: magic(40) });
        simulateWalking(sdk);
        const prev = sdk.onSend;
        sdk.onSend = (a, f) => {
            prev(a, f);
            if (a.method === 'sendClickComponent') {
                queueMicrotask(() => f.tick(s => ({ gameMessages: [{ type: 0, text: 'A mysterious force blocks your teleport spell!', sender: '', tick: s.tick + 1, fromSelf: false }] })));
            }
        };
        const hops: Hop[] = [{ kind: 'teleport', spell: 'falador' }, { kind: 'run', to: { x: 2990, z: 3380 } }];
        const r = await drive(sdk, travel(sdk as never, hops));
        expect(r.ok).toBe(true);
        expect(r.segments[0]).toMatchObject({ hop: 'falador teleport', ok: false, ticks: 1 });
        expect(r.fellBack).toMatch(/refused: A mysterious force/);
    });

    test('teleportRefusal: Magic level, Wilderness above 20, runes; a worn staff is unlimited runes of its element', () => {
        const s = (x: number, z: number, more: Partial<BotWorldState>) => baseState({ player: player(x, z), ...more });
        expect(teleportRefusal(s(3200, 3200, { skills: magic(36), inventory: runes }), 'falador')).toMatch(/Magic 36 is below 37/);
        expect(teleportRefusal(s(3200, 3700, { skills: magic(60), inventory: runes }), 'falador')).toMatch(/Wilderness level 23 is above 20/);
        expect(teleportRefusal(s(3200, 3679, { skills: magic(60), inventory: runes }), 'falador')).toBeNull();
        const staff = s(3200, 3200, { skills: magic(60), inventory: [item(0, 'Law rune', 1), item(1, 'Water rune', 1)], equipment: [item(3, 'Staff of air')] });
        expect(runesHeld(staff).air).toBe(Infinity);
        expect(teleportRefusal(staff, 'falador')).toBeNull();
    });
});

describe('hop data', () => {
    test('hopNeeds sums runes and coins and asks for a knife on webs', () => {
        const n = hopNeeds([{ kind: 'teleport', spell: 'ardougne' }, { kind: 'teleport', spell: 'falador' }, { kind: 'ship', route: 'brimhaven' }, { kind: 'webs', goals: [[1, 1]] }]);
        expect(n).toMatchObject({ runes: { water: 3, law: 3, air: 3 }, magic: 51, coins: 30, knife: true });
    });

    test('deletesFollowerItem: teleports, trees and the lever, never ships, gliders or Lumdo', () => {
        expect(deletesFollowerItem([{ kind: 'run', to: { x: 1, z: 1 } }, { kind: 'lever', lever: 'ardougne' }])).toBe(true);
        expect(deletesFollowerItem([{ kind: 'tree', to: 'village' }])).toBe(true);
        expect(deletesFollowerItem([{ kind: 'ship', route: 'brimhaven' }, { kind: 'glider', to: 'gandius' }, { kind: 'lumdo', to: 'ape_atoll' }])).toBe(false);
    });

    test('wildernessLevel matches wilderness_levels.rs2 at the zone edges', () => {
        expect(wildernessLevel({ x: 3200, z: 3519 })).toBe(0);
        expect(wildernessLevel({ x: 3200, z: 3520 })).toBe(1);
        expect(wildernessLevel({ x: 3200, z: 3679 })).toBe(20);
        expect(wildernessLevel({ x: 3200, z: 3680 })).toBe(21);
        expect(wildernessLevel({ x: 2943, z: 3700 })).toBe(0);
        expect(wildernessLevel({ x: 3100, z: 9930 })).toBe(2);
    });

    test('expandRoute steps one tile at a time and hopsDestination names the last landing', () => {
        expect(expandRoute({ x: 0, z: 0 }, [{ x: 2, z: 1 }])).toEqual([{ x: 1, z: 1 }, { x: 2, z: 1 }]);
        expect(hopsDestination([{ kind: 'run', to: { x: 5, z: 5 } }, { kind: 'teleport', spell: 'varrock' }])).toEqual(SPELLS.varrock.landing);
    });
});

/**
 * The Mage Bank web (web.rs2): a knife on it fails or slashes it, 50% each; a slash removes the web
 * and lets the player step through. The reply is stamped as each client publishes it: the browser
 * on the click's own tick, lite on the next (rs/308's probe: a click at tick 25 drew
 * "You fail to cut through it." stamped 25 on the browser), with a new publication id each time.
 */
describe('webs', () => {
    for (const client of ['browser', 'lite'] as const) {
        test(`each slash's reply is read on the tick it lands (${client} stamps)`, async () => {
            const web = loc(733, 'Web', 3095, 3957, ['Slash']);
            const sdk = world(3096, 3957, { nearbyLocs: [web], inventory: [item(0, 'Knife')] });
            sdk.pathTo = () => ({ success: true, reachedDestination: false, waypoints: [] });
            const replies = ['You fail to cut through it.', 'You fail to cut through it.', 'You slash the web apart.'];
            let publication = 500;
            sdk.onSend = (a, f) => {
                if (a.method === 'sendUseItemOnLoc') {
                    const text = replies.shift()!;
                    queueMicrotask(() => f.tick(s => ({
                        gameMessages: [...s.gameMessages, { type: 0, text, sender: '', tick: client === 'browser' ? s.tick : s.tick + 1, observationId: ++publication, fromSelf: false }],
                        ...(/apart/.test(text) ? { nearbyLocs: [] } : {}),
                    })));
                }
                if (a.method === 'sendWalk') queueMicrotask(() => f.tick({ player: player(3094, 3957) }));
            };
            const r = await drive(sdk, throughWebs(sdk as never, [[3094, 3957]]), 120);
            expect(r.ok).toBe(true);
            expect(r.webTries).toBe(3);
            expect(sends(sdk, 'sendUseItemOnLoc')).toHaveLength(3);
            expect(r.ticks).toBeLessThanOrEqual(6);
        });
    }
});
