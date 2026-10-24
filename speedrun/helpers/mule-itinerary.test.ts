import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BANKS } from './questitems';
import { findDoorsAlongPath, getDoorAt, isTileWalkable } from '../../sdk/pathfinding';
import type { PlayerState } from '../../sdk/types';
import { deliveryTradeReach } from './mule';
import { TILES } from '../runner/legs';
import { MULE1_ORDER, MULE1_ON_REQUEST } from './mule-ledger';
import { assertMuleTopology, H4M_STAND, muleDelivery, muleItinerary, muleTopologyConflicts, type ItineraryOptions } from './mule-itinerary';
import { crossForDelivery } from './delivery-cross';
import type { NearbyLoc } from '../../sdk/types';
import { baseState, FakeSdk } from '../lib/fake-sdk';
import { crossingsBetween, PASSAGES, type Tile } from '../lib/passages';

describe('actual delivery passage planning', () => {
    for (const row of ['H8', 'H12']) test(row + ' enters and leaves through the Stronghold gate', () => {
        const { at, bank } = muleDelivery(row);
        const gate = PASSAGES[0]!;
        expect(crossingsBetween(bank, at)).toEqual([{ passage: gate, from: gate.sides[0], to: gate.sides[1] }]);
        expect(crossingsBetween(at, bank)).toEqual([{ passage: gate, from: gate.sides[1], to: gate.sides[0] }]);
        expect(crossingsBetween(at, { x: 2654, z: 3283 })).toEqual([{ passage: gate, from: gate.sides[1], to: gate.sides[0] }]);
    });
});

describe('delivery crossing inputs and cancellation', () => {
    const gate = PASSAGES[0]!;
    const crossing = { passage: gate, from: gate.sides[0], to: gate.sides[1] };
    function world() {
        const sdk = new FakeSdk(baseState({ tick: 0 }));
        const move = (t: Tile) => sdk.push({ player: { ...sdk.state!.player!, worldX: t.x, worldZ: t.z, x: t.x, z: t.z, level: 0, hp: 10, isDead: false } });
        move(crossing.from);
        let stopped = false;
        let scans = 0;
        let walks = 0;
        let onTick = () => {};
        let onScan = () => {};
        const loc = { id: 190, name: 'Gate', ...gate.at, level: 0, distance: 2, optionsWithIndex: [{ text: 'Open', opIndex: 2 }] } as NearbyLoc;
        Object.assign(sdk, {
            scanNearbyLocs: async () => { scans++; onScan(); return [loc]; },
            waitForTicks: async () => { sdk.tick(); onTick(); }
        });
        const c = { sdk: sdk as never, stopped: () => stopped, log: () => {}, walk: async (t: Tile) => { walks++; move(t); } };
        return { sdk, c, move, loc, stop: () => { stopped = true; }, ticks: (f: () => void) => { onTick = f; }, scans: (f: () => void) => { onScan = f; }, counts: () => ({ scans, walks }) };
    }

    test('dispatches the scanned option once and waits for observed passage position', async () => {
        const w = world();
        w.ticks(() => { if (w.sdk.state!.tick === 3) w.move(crossing.to); });
        await crossForDelivery(w.c, crossing);
        expect(w.sdk.sent.filter(a => a.method === 'sendInteractLoc').map(a => a.args)).toEqual([[2459, 3383, 190, 2]]);
        expect(w.sdk.state!.tick).toBe(3);
        expect(w.sdk.state!.player).toMatchObject({ worldX: 2461, worldZ: 3385 });
    });

    test('an acknowledged click without movement retries, then fails boundedly', async () => {
        const w = world();
        await expect(crossForDelivery(w.c, crossing)).rejects.toThrow('could not cross');
        expect(w.sdk.sent.filter(a => a.method === 'sendInteractLoc')).toHaveLength(6);
        expect(w.sdk.state!.tick).toBe(96);
    });

    test('a dropped first click can succeed on the second attempt', async () => {
        const w = world();
        let clicks = 0;
        w.sdk.onSend = a => { if (a.method === 'sendInteractLoc' && ++clicks === 2) w.move(crossing.to); };
        await crossForDelivery(w.c, crossing);
        expect(clicks).toBe(2);
        expect(w.sdk.state!.tick).toBe(16);
    });

    test('a stopped crossing neither walks nor scans', async () => {
        const w = world();
        w.stop();
        await expect(crossForDelivery(w.c, crossing)).rejects.toThrow('stopped');
        expect(w.counts()).toEqual({ scans: 0, walks: 0 });
        expect(w.sdk.sent).toHaveLength(0);
    });

    test('cancellation during an awaited scan prevents the loc click', async () => {
        const w = world();
        w.scans(w.stop);
        await expect(crossForDelivery(w.c, crossing)).rejects.toThrow('stopped');
        expect(w.sdk.sent).toHaveLength(0);
    });

    test('cancellation during crossing polling prevents retry clicks', async () => {
        const w = world();
        w.ticks(w.stop);
        await expect(crossForDelivery(w.c, crossing)).rejects.toThrow('stopped');
        expect(w.sdk.sent.filter(a => a.method === 'sendInteractLoc')).toHaveLength(1);
    });

    test('dialogue clicks obey cancellation before and after each awaited input', async () => {
        for (const stopAt of ['before', 'after']) {
            const w = world();
            w.sdk.onSend = a => {
                if (a.method === 'sendInteractLoc') {
                    w.sdk.push({ dialog: { ...w.sdk.state!.dialog, isOpen: true, isWaiting: false, options: [{ index: 1, text: "Sorry, I'm a bit busy." }] } });
                    if (stopAt === 'before') w.stop();
                }
                if (a.method === 'sendClickDialog') w.stop();
            };
            await expect(crossForDelivery(w.c, crossing)).rejects.toThrow('stopped');
            expect(w.sdk.sent.filter(a => a.method === 'sendInteractLoc')).toHaveLength(1);
            expect(w.sdk.sent.filter(a => a.method === 'sendClickDialog')).toHaveLength(stopAt === 'before' ? 0 : 1);
        }
    });
});

const coordinates: Record<string, [number, number]> = {
    H1: [3222, 3222], H4: [2951, 3451], H4k: [2911, 3494], H6: [2568, 3334],
    H4p: [2604, 3235], H7: [2504, 3191], H8: [2465, 3489], H9: [2658, 3301],
    H10: [2658, 3301], H12: [2465, 3489], H13: [2658, 3301], H14: [2670, 3305],
    H15: [2716, 3302], H16: [2820, 3486], H18: [3241, 3248], H19: [3209, 3215],
    H20: [3045, 3257], H21d: [3185, 3436], H22: [3191, 3366],
    H4e: [2920, 3406],
};

describe('canonical delivery itinerary', () => {
    test('every production and conditional row has its authoritative helper tile and a canonical ground bank', () => {
        const rows = [...MULE1_ORDER, ...MULE1_ON_REQUEST];
        expect(Object.keys(coordinates)).toEqual(rows);
        for (const entry of muleItinerary(rows)) {
            const [x, z] = coordinates[entry.row]!;
            expect(entry.at).toEqual({ x, z, level: 0 });
            expect(BANKS).toContainEqual({ x: entry.bank.x, z: entry.bank.z });
            expect(entry.bank.level).toBe(0);
        }
    });

    test('meeting and bank tiles are clear in the bundled collision snapshot; H4k remains inside receiver tolerance', () => {
        for (const p of muleItinerary([...MULE1_ORDER, ...MULE1_ON_REQUEST])) {
            expect(isTileWalkable(p.at.level, p.at.x, p.at.z)).toBe(true);
            expect(isTileWalkable(p.bank.level, p.bank.x, p.bank.z)).toBe(true);
        }
        const h4k = muleDelivery('H4k').at;
        expect(Math.max(Math.abs(h4k.x - TILES.taverleyNormals.x), Math.abs(h4k.z - TILES.taverleyNormals.z))).toBeLessThanOrEqual(TILES.taverleyNormals.tol);
        expect(isTileWalkable(0, TILES.taverleyNormals.x, TILES.taverleyNormals.z)).toBe(false);
    });

    test('H3 is rehearsal-only, uses supplied canonical geometry, and fails closed on missing or invalid planes', () => {
        expect(() => muleDelivery('H3')).toThrow('ring givers');
        for (const at of [undefined, null, {}, { x: 3223, z: 3219 }, { x: 3223, z: 3219, level: 4 }, { x: '3223', z: 3219, level: 0 }]) {
            expect(() => muleDelivery('H3', { rehearsal: { firemakingEnd: at } } as ItineraryOptions)).toThrow('firemaking end');
        }
        const firemakingEnd = { x: 3223, z: 3219, level: 0 };
        expect(muleDelivery('H3', { rehearsal: { firemakingEnd } }).at).toEqual(firemakingEnd);
        const alternate = { x: 3230, z: 3220, level: 1 };
        expect(muleDelivery('H3', { rehearsal: { firemakingEnd: alternate } }).at).toEqual(alternate);
        expect(MULE1_ORDER as readonly string[]).not.toContain('H3');
    });

    test('no fallback for unknown, duplicate or empty selections, and callers cannot mutate canonical tiles', () => {
        for (const row of ['H12o-M', 'H99', 'toString', '__proto__', '', 'H4m', 'H4m.0', 'H4m.01', 'H4m.x', 'H4m.1-H4m.10']) expect(() => muleDelivery(row)).toThrow('No canonical');
        expect(() => muleItinerary([])).toThrow('nonempty');
        expect(() => muleItinerary(['H4', 'H4'])).toThrow('Duplicate');
        const binding = muleDelivery('H4');
        binding.at.x = 0;
        binding.bank.x = 0;
        expect(muleDelivery('H4').at.x).toBe(2951);
        expect(muleDelivery('H4').bank).toEqual({ ...BANKS[1]!, level: 0 });
    });
});

describe("H22 meets SCORED clear of the Champions' Guild door", () => {
    const door = { x: 3191, z: 3363 };
    const tradeReach = (mule: { x: number; z: number }, scored: { x: number; z: number }) => deliveryTradeReach(baseState({
        player: { worldX: mule.x, worldZ: mule.z, level: 0 } as PlayerState,
        nearbyPlayers: [{ kind: 'player', index: 9, name: 'Cairn Scored', combatLevel: 3, x: scored.x, z: scored.z, distance: Math.max(Math.abs(mule.x - scored.x), Math.abs(mule.z - scored.z)) }]
    }), 'cairn_scored');

    test('the collision data has the guild door, and it refuses every stand beside its neighbour (3191,3364)', () => {
        expect(getDoorAt(0, door.x, door.z)).toBeDefined();
        const beside = { x: door.x, z: door.z + 1 };
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) expect(tradeReach({ x: beside.x + dx!, z: beside.z + dz! }, beside)).toBe(false);
    });

    test("the stand (3191,3366) is north of T25-26's single arrival tile (3191,3365), with no door on or beside either, and the delivery guard accepts it", () => {
        const scored = { x: TILES.championsGuild.x, z: TILES.championsGuild.z, level: 0 };
        const stand = muleDelivery('H22').at;
        expect(scored).toEqual({ x: 3191, z: 3365, level: 0 });
        expect(TILES.championsGuild.tol).toBe(0);
        expect(stand).toEqual({ x: 3191, z: 3366, level: 0 });
        // findDoorsAlongPath checks each tile and its four cardinal neighbours.
        expect(findDoorsAlongPath([scored])).toEqual([]);
        expect(findDoorsAlongPath([stand])).toEqual([]);
        expect(Math.abs(stand.x - scored.x) + Math.abs(stand.z - scored.z)).toBe(1);
        expect(tradeReach(stand, scored)).toBe(true);
    });
});

describe("H4m's loads meet SCORED at S09's zoo iron lap, clear of doors and hunters", () => {
    const eastStay = { x: 2605, z: 3234, level: 0 };
    const tradeReach = (mule: { x: number; z: number }, scored: { x: number; z: number }) => deliveryTradeReach(baseState({
        player: { worldX: mule.x, worldZ: mule.z, level: 0 } as PlayerState,
        nearbyPlayers: [{ kind: 'player', index: 9, name: 'Cairn Scored', combatLevel: 3, x: scored.x, z: scored.z, distance: Math.max(Math.abs(mule.x - scored.x), Math.abs(mule.z - scored.z)) }]
    }), 'cairn_scored');

    test('every load row has the one stand (2606,3234) and banks at Ardougne south', () => {
        expect(H4M_STAND).toEqual({ x: 2606, z: 3234, level: 0 });
        for (const row of ['H4m.1', 'H4m.2', 'H4m.10', 'H4m.18']) {
            expect(muleDelivery(row)).toEqual({ row, at: H4M_STAND, bank: { ...BANKS[6]!, level: 0 } });
        }
        expect(muleDelivery('H4m.1').bank).toEqual(muleDelivery('H4p').bank);
        expect(muleDelivery('H4m.1').bank).toEqual({ x: 2654, z: 3283, level: 0 });
        const binding = muleDelivery('H4m.3');
        binding.at.x = 0;
        expect(muleDelivery('H4m.3').at).toEqual(H4M_STAND);
    });

    test("the stand is beside the lap's east stay only, with no door on or beside either, and the delivery guard accepts it", () => {
        // The cluster's rocks (rs/701): the stand is none of them, and SCORED's other stays are not beside it.
        for (const [x, z] of [[2602, 3233], [2602, 3234], [2602, 3236], [2605, 3233], [2605, 3235], [2605, 3237]]) expect(isTileWalkable(0, x!, z!)).toBe(false);
        expect(isTileWalkable(0, H4M_STAND.x, H4M_STAND.z)).toBe(true);
        expect(isTileWalkable(0, eastStay.x, eastStay.z)).toBe(true);
        // findDoorsAlongPath checks each tile and its four cardinal neighbours; none within 10 tiles at all.
        expect(findDoorsAlongPath([H4M_STAND])).toEqual([]);
        expect(findDoorsAlongPath([eastStay])).toEqual([]);
        for (let x = H4M_STAND.x - 10; x <= H4M_STAND.x + 10; x++) for (let z = H4M_STAND.z - 10; z <= H4M_STAND.z + 10; z++) expect(getDoorAt(0, x, z)).toBeUndefined();
        expect(tradeReach(H4M_STAND, eastStay)).toBe(true);
        for (const other of [{ x: 2603, z: 3233 }, { x: 2602, z: 3235 }]) expect(tradeReach(H4M_STAND, other)).toBe(false);
        // The second choice (2606,3233) only reaches (2605,3233), a rock.
        expect(tradeReach({ x: 2606, z: 3233 }, eastStay)).toBe(false);
    });

    test('no NPC that hunts players can reach the stand: every hunter spawns further off than its wander + hunt range', () => {
        const content = join(import.meta.dir, '..', '..', 'server', 'content');
        const files = (dir: string, ext: string): string[] => readdirSync(dir).flatMap(f => {
            const p = join(dir, f);
            return statSync(p).isDirectory() ? files(p, ext) : p.endsWith(ext) ? [p] : [];
        });
        const blocks = (ext: string) => {
            const out: Record<string, Record<string, string>> = {};
            for (const f of files(join(content, 'scripts'), ext)) {
                let cur: Record<string, string> | null = null;
                for (const line of readFileSync(f, 'utf8').split('\n')) {
                    const head = /^\[(\w+)\]/.exec(line);
                    const kv = /^(\w+)=(.*)$/.exec(line.trim());
                    if (head) cur = out[head[1]!] = {};
                    else if (cur && kv) cur[kv[1]!] = kv[2]!;
                }
            }
            return out;
        };
        const npcs = blocks('.npc');
        const hunts = blocks('.hunt');
        const names = new Map(readFileSync(join(content, 'pack', 'npc.pack'), 'utf8').split('\n')
            .map(l => /^(\d+)=(\w+)$/.exec(l.trim())).filter(m => m !== null).map(m => [Number(m[1]), m[2]!]));
        const hunters: { name: string; margin: number; vislevel: number; anyLevel: boolean }[] = [];
        let spawns = 0;
        // The stand's square, m40_50, and its eight neighbours: 64 tiles or more in every direction.
        for (let mx = 39; mx <= 41; mx++) for (let mz = 49; mz <= 51; mz++) {
            const map = readFileSync(join(content, 'maps', `m${mx}_${mz}.jm2`), 'utf8');
            const at = map.indexOf('==== NPC ====');
            if (at < 0) continue;
            for (const m of map.slice(at).split('==== OBJ')[0]!.matchAll(/^0 (\d+) (\d+): (\d+)$/gm)) {
                spawns++;
                const name = names.get(Number(m[3]))!;
                const cfg = npcs[name]!;
                expect(cfg).toBeDefined();
                const hunt = hunts[cfg.huntmode ?? ''];
                if (hunt?.type !== 'player') continue;
                // NpcType: wanderrange defaults to 5, huntrange to 0; it hunts from wherever it has wandered.
                const reach = Number(cfg.wanderrange ?? 5) + Number(cfg.huntrange ?? 0);
                const d = Math.max(Math.abs(mx * 64 + Number(m[1]) - H4M_STAND.x), Math.abs(mz * 64 + Number(m[2]) - H4M_STAND.z));
                hunters.push({ name, margin: d - reach, vislevel: Number(cfg.vislevel), anyLevel: hunt.check_nottoostrong !== 'outside_wilderness' });
            }
        }
        expect(spawns).toBeGreaterThan(50);
        expect(hunters.length).toBeGreaterThan(0);
        expect(hunters.every(h => h.margin > 0)).toBe(true);
        const nearest = hunters.reduce((a, b) => (b.margin < a.margin ? b : a));
        expect(nearest).toEqual({ name: 'scorpion', margin: 19, vislevel: 14, anyLevel: false });
        // h55 (HP 90, Attack 29, Defence 27, Strength 27, Magic 99, Prayer 1) is combat 77 by
        // Player.getCombatLevel, Magic's term the largest. Outside the Wilderness `cowardly` passes over
        // a player above 2 x vislevel (Npc.ts huntPlayers); `aggressive_melee` (Fight Arena) checks no level.
        const combat = Math.floor(0.25 * (27 + 90 + Math.floor(1 / 2)) + Math.max(0.325 * (29 + 27), 0.325 * (Math.floor(99 / 2) + 99)));
        expect(combat).toBe(77);
        const huntsH55 = hunters.filter(h => h.anyLevel || combat <= 2 * h.vislevel);
        expect(huntsH55.reduce((a, b) => (b.margin < a.margin ? b : a))).toEqual({ name: 'jogre', margin: 33, vislevel: 53, anyLevel: false });
    });
});

describe('delivery topology', () => {
    test('reports both actual ordered mountain crossings, not just the first', () => {
        const conflicts = muleTopologyConflicts(muleItinerary(MULE1_ORDER));
        expect(conflicts.map(c => [c.fromRow, c.toRow, c.kind])).toEqual([
            ['H4k', 'H6', 'ordered'], ['H16', 'H18', 'ordered'],
        ]);
        expect(() => assertMuleTopology(muleItinerary(MULE1_ORDER))).toThrow('H4k -> H6');
    });

    test('conditional deliveries are checked on entry and return, even with no ordered crossing', () => {
        // A western row inserted conditionally (H4m's loads are ordered in production; any west tile serves).
        const selected = [...muleItinerary(['H1', 'H4']), { ...muleDelivery('H4m.1'), onRequest: true }];
        expect(muleTopologyConflicts(selected).map(c => [c.fromRow, c.toRow, c.kind])).toEqual([
            ['H1', 'H4m.1', 'conditional'], ['H4', 'H4m.1', 'conditional'],
            ['H4m.1', 'H1', 'conditional'], ['H4m.1', 'H4', 'conditional'],
        ]);
        expect(() => assertMuleTopology(selected)).toThrow('conditional');
        expect(() => assertMuleTopology([{ ...muleDelivery('H4e'), onRequest: true }, { ...muleDelivery('H4m.1'), onRequest: true }])).toThrow('conditional');
    });

    test('each bank must also be in its meeting region; same-region selections are not a feasibility claim', () => {
        const h4 = muleDelivery('H4');
        expect(muleTopologyConflicts([{ ...h4, bank: muleDelivery('H6').bank }])[0]?.kind).toBe('staging');
        expect(muleTopologyConflicts(muleItinerary(['H4', 'H4k']))).toEqual([]);
        expect(muleTopologyConflicts(muleItinerary(['H6', 'H4p', 'H4m.1', 'H4m.2', 'H4m.10', 'H7']))).toEqual([]);
        const farWest = { rehearsal: { firemakingEnd: { x: 2600, z: 3300, level: 0 } } };
        expect(muleTopologyConflicts(muleItinerary(['H3'], farWest))[0]?.kind).toBe('staging');
    });
});

describe('module load order', () => {
    for (const order of [['./questitems', './mule-itinerary'], ['./mule-itinerary', './questitems'], ['./questitems', './mule'], ['./mule', './questitems']]) {
        test(order.join(' then ') + ' both load in a fresh process', () => {
            const code = order.map(m => `await import(${JSON.stringify(new URL(m + '.ts', import.meta.url).pathname)});`).join(' ') + " console.log('LOADED');";
            const r = Bun.spawnSync([process.execPath, '-e', code], { stdout: 'pipe', stderr: 'pipe' });
            expect(r.stderr.toString()).not.toContain('before initialization');
            expect(r.exitCode).toBe(0);
            expect(r.stdout.toString()).toContain('LOADED');
        });
    }
});
