import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { BotWorldState, InventoryItem, NearbyLoc, PlayerState } from '../../sdk/types';
import { baseState, drive, FakeSdk, flush, simulateWalking } from './fake-sdk';
import { sleep } from './wait';
import {
    deletesFollowerItem, expandRoute, hopNeeds, hopsDestination, runesHeld, runTo, SPELLS, teleport, teleportRefusal, travel, wildernessLevel, type Hop,
} from './travel';

const player = (worldX: number, worldZ: number, level = 0) => ({ name: 'lab', x: worldX, z: worldZ, worldX, worldZ, level, hp: 40, maxHp: 40 }) as PlayerState;
const item = (slot: number, name: string, count = 1): InventoryItem => ({ slot, id: 1000 + slot, name, count, optionsWithIndex: [] }) as unknown as InventoryItem;
const loc = (id: number, name: string, x: number, z: number, ops: string[]): NearbyLoc =>
    ({ id, name, x, z, level: 0, distance: 1, optionsWithIndex: ops.map((text, i) => ({ text, opIndex: i + 1 })), options: ops });
const magic = (level: number) => [{ name: 'Magic', level, baseLevel: level, experience: 0 }];
const world = (x: number, z: number, more: Partial<BotWorldState> = {}) => new FakeSdk(baseState({ tick: 100, player: player(x, z), ...more }));
const at = (sdk: FakeSdk) => ({ x: sdk.state!.player!.worldX, z: sdk.state!.player!.worldZ });
const sends = (sdk: FakeSdk, method: string) => sdk.sent.filter(a => a.method === method).map(a => a.args);

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
