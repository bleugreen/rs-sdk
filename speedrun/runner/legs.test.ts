import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { findDoorsAlongPath, getDoorAt } from '../../sdk/pathfinding';
import type { BotWorldState, CombatEvent, InventoryItem, NearbyLoc, PlayerState } from '../../sdk/types';
import { parseLedger, walk, type OutEntry } from '../tools/slot-ledger';
import { parseTiles, resolveOptions, routeLogs } from '../skills/firemaking';
import { baseState, drive, FakeSdk, simulateWalking, type WalkSim } from '../lib/fake-sdk';
import { TickLog } from '../lib/ticks';
import { eatAt, eatDue, HP_FLOOR, inArea, SPELLS, SPIRIT_TREES, type Area, type Hop } from '../lib/travel';
import { arrived, CHURCH_ALTAR, dropDue, DROPS_PER_TICK, dropsDue, entersWilderness, hostileLeg, hostileLegIds, leg, LEG_URGENT_HP, legById, legPreconditions, LEGS, legsAfter, legsFor, neededBy, netTotal, resumeHop, runLeg, splitLeg, startFloor, startFloorShort, TILES, type LegStart, type LegStep, type LegStopRecord } from './legs';
import { WaitUpkeep } from './wait-guard';
import { PLACEMENT } from './chain';
import { Observation, resolveResume } from './resume';
import type { RunnerSession, Step, StepContext } from './step';

const player = (worldX: number, worldZ: number, level = 0) => ({ name: 'lab', x: worldX, z: worldZ, worldX, worldZ, level, hp: 40, maxHp: 40 }) as PlayerState;
const item = (slot: number, name: string, count = 1): InventoryItem => ({ slot, id: 1000 + slot, name, count, optionsWithIndex: [] }) as unknown as InventoryItem;
const magic = (level: number) => [{ name: 'Magic', level, baseLevel: level, experience: 0 }];
const FALADOR_RUNES = [item(0, 'Air rune', 3), item(1, 'Water rune', 1), item(2, 'Law rune', 1)];
const ARDOUGNE_RUNES = [item(0, 'Water rune', 2), item(1, 'Law rune', 2)];
const state = (x: number, z: number, more: Partial<BotWorldState> = {}) => baseState({ tick: 100, player: player(x, z), skills: magic(60), ...more });

function ctxFor(sdk: FakeSdk): StepContext<unknown> {
    const session = { sdk, bot: {}, name: 'lab', sessionId: 1 } as unknown as RunnerSession;
    return { session, sdk: session.sdk, bot: session.bot, c: undefined, log: TickLog.memory('legs-test') };
}

/** S04 done, the leg to Doric, S05 not done: S05 can start only at Doric's. */
function manifest(): Step<unknown>[] {
    const milestone = (name: string, done: boolean, pre: (s: BotWorldState) => true | string): Step<unknown> => ({
        name, preconditions: pre, run: async () => {}, postconditions: () => true, logoutSafe: true, done: () => done,
    });
    return [
        milestone('S04', true, () => true),
        legById('T04-05'),
        milestone('S05', false, s => inArea(s, TILES.doric) || 'not at Doric'),
    ];
}

describe('legs and the resume walk', () => {
    test('a restart mid-leg resumes the leg at its remaining hops: no second teleport', async () => {
        // Past the Falador teleport, partway up the run to Doric's.
        const sdk = new FakeSdk(state(2962, 3400, { inventory: FALADOR_RUNES }));
        const p = await resolveResume(manifest(), new Observation(sdk.state!), undefined);
        expect([p.index, p.mode, p.step]).toEqual([1, 'resume', 'T04-05 Falador teleport + run']);

        simulateWalking(sdk);
        const ctx = ctxFor(sdk);
        await drive(sdk, legById('T04-05').resume!(ctx));
        expect(sdk.sent.some(a => a.method === 'sendClickComponent')).toBe(false);
        expect(inArea(sdk.state!, TILES.doric)).toBe(true);
        const row = ctx.log.rows.find(r => r.kind === 'travel')!;
        expect(row).toMatchObject({ step: 'T04-05 Falador teleport + run', ok: true, meta: { fromHop: 1 } });
    });

    test('a restart where the next step can already start skips the leg', async () => {
        const sdk = new FakeSdk(state(TILES.doric.x, TILES.doric.z));
        const p = await resolveResume(manifest(), new Observation(sdk.state!), undefined);
        expect([p.index, p.mode, p.step]).toEqual([2, 'run', 'S05']);
    });

    test('a restart at the leg start (or anywhere before its first checkpoint) runs the whole leg', async () => {
        const sdk = new FakeSdk(state(TILES.s03End.x, TILES.s03End.z, { inventory: FALADOR_RUNES }));
        const p = await resolveResume(manifest(), new Observation(sdk.state!), undefined);
        expect([p.index, p.mode]).toEqual([1, 'run']);
        sdk.onSend = (a, f) => { if (a.method === 'sendClickComponent') queueMicrotask(() => f.tick({ player: player(2965, 3378) })); };
        simulateWalking(sdk);
        await drive(sdk, legById('T04-05').run(ctxFor(sdk)));
        expect(sdk.sent[0]).toEqual({ method: 'sendClickComponent', args: [1170] });
        expect(inArea(sdk.state!, TILES.doric)).toBe(true);
    });

    test('arrived turns run into a no-op: no click, no travel row', async () => {
        const sdk = new FakeSdk(state(TILES.doric.x + 1, TILES.doric.z, { inventory: FALADOR_RUNES }));
        const ctx = ctxFor(sdk);
        const l = legById('T04-05');
        await l.run(ctx);
        expect(sdk.sent).toEqual([]);
        expect(ctx.log.rows).toEqual([]);
        expect(await runLeg(l.def, ctx)).toBeNull();
        expect(l.postconditions(sdk.state!, undefined)).toBe(true);
    });

    test("the next step's own start counts as arrived", async () => {
        const l = leg('TX', { x: 3200, z: 3200 }, { x: 3240, z: 3200 }, [{ kind: 'run', to: { x: 3240, z: 3200 } }], {
            after: 'A', before: 'B', method: 'run', nextStart: { x: 3245, z: 3200, tol: 1 },
            expected: { ticks: 20, label: 'i', source: 'test', net: 20 },
        });
        expect(arrived(l.def, state(3246, 3200))).toBe(true);
        expect(l.postconditions(state(3246, 3200), undefined)).toBe(true);
        expect(l.postconditions(state(3230, 3200), undefined)).toMatch(/^TX: not within 0 of 3240,3200 \(at 3230,3200\)/);
    });

    test('resumeHop reads the checkpoints: after the teleport, in the keep, north of the keep', () => {
        const t1314 = legById('T13-14').def;
        expect(resumeHop(t1314, state(TILES.lawgof.x, TILES.lawgof.z))).toBe(0);
        expect(resumeHop(t1314, state(2660, 3305))).toBe(1); // Ardougne landing, the run to the lever next
        expect(resumeHop(t1314, state(3154, 3924))).toBe(3); // in the keep: the webs next
        expect(resumeHop(t1314, state(3158, 3955))).toBe(4); // through the web: the run to the spiders
        expect(legById('T13-14').inProgress!({ state: state(3154, 3924), probed: {} }, undefined)).toBe(true);
        expect(legById('T13-14').inProgress!({ state: state(TILES.lawgof.x, TILES.lawgof.z), probed: {} }, undefined)).toBe(false);
    });
});

describe('leg preconditions', () => {
    const pre = (id: string, s: BotWorldState) => legPreconditions(legById(id).def, s);

    test('runes and Magic for the spell', () => {
        expect(pre('T21-22', state(2400, 4835))).toMatch(/^T21-22: runes short: 1 earth \(have 0\), 3 air \(have 0\), 1 law \(have 0\)/);
        const lumbridge = [item(0, 'Earth rune', 1), item(1, 'Air rune', 3), item(2, 'Law rune', 1)];
        expect(pre('T21-22', state(2400, 4835, { inventory: lumbridge }))).toBe(true);
        expect(pre('T21-22', state(2400, 4835, { inventory: lumbridge, skills: magic(30) }))).toBe('T21-22: Magic 30 is below 31');
    });

    test('food on the Wilderness legs', () => {
        const s = (inventory: InventoryItem[]) => state(TILES.lawgof.x, TILES.lawgof.z, { inventory: [...ARDOUGNE_RUNES, item(4, 'Knife'), ...inventory] });
        expect(pre('T13-14', s([]))).toBe('T13-14: 0 food held, 2 needed');
        expect(pre('T13-14', s([item(5, 'Swordfish'), item(6, 'Lobster')]))).toBe(true);
    });

    test('a knife for the webs', () => {
        const s = state(TILES.lawgof.x, TILES.lawgof.z, { inventory: [...ARDOUGNE_RUNES, item(5, 'Shark'), item(6, 'Shark')] });
        expect(pre('T13-14', s)).toBe('T13-14: a knife is needed for the webs');
    });

    test('Wilderness level at most 20 when the leg opens with a spell and has no deep-Wilderness run to resume by', () => {
        const s = state(3200, 3712, { inventory: [...ARDOUGNE_RUNES, item(4, 'Knife'), item(5, 'Shark'), item(6, 'Shark')] }); // level 25
        expect(pre('T12-13', s)).toBe('T12-13: Wilderness level 25 is above 20 for the ardougne teleport');
    });

    test('deep in the Wilderness off every checkpoint, a leg past its lever resumes by its run to the spiders, not the refused teleport (rs/511)', () => {
        const t1314 = legById('T13-14').def;
        const s = state(3200, 3712, { inventory: [...ARDOUGNE_RUNES, item(4, 'Knife'), item(5, 'Shark'), item(6, 'Shark')] }); // level 25, south of the north-of-keep box
        expect(resumeHop(t1314, s)).toBe(4);
        expect(t1314.hops[4]).toMatchObject({ kind: 'run', to: { x: TILES.spiders.x, z: TILES.spiders.z } });
        expect(pre('T13-14', s)).toBe(true);
        expect(legById('T13-14').inProgress!({ state: s, probed: {} }, undefined)).toBe(true);
        // T26-27 is the same route; T15-16 resumes at its run to the Mage Bank webs.
        expect(resumeHop(legById('T26-27').def, s)).toBe(4);
        expect(legById('T15-16').def.hops[resumeHop(legById('T15-16').def, state(3110, 3700))]).toMatchObject({ kind: 'run', to: { x: 3097, z: 3957 } });
        // At level 20 or below, or outside the Wilderness, nothing changes: hop 0.
        expect(resumeHop(t1314, state(3200, 3672))).toBe(0);
        expect(resumeHop(t1314, state(TILES.lawgof.x, TILES.lawgof.z))).toBe(0);
    });

    test('30 coins for the ship and the talisman for the altar', () => {
        const base = [...ARDOUGNE_RUNES, item(4, 'Nature talisman')];
        expect(pre('T20-21', state(TILES.contestDwarf.x, TILES.contestDwarf.z, { inventory: [...base, item(5, 'Coins', 29)] }))).toBe('T20-21: 30 coins needed for the ship');
        expect(pre('T20-21', state(TILES.contestDwarf.x, TILES.contestDwarf.z, { inventory: [...ARDOUGNE_RUNES, item(5, 'Coins', 30)] }))).toMatch(/^T20-21: no /);
        expect(pre('T20-21', state(TILES.contestDwarf.x, TILES.contestDwarf.z, { inventory: [...base, item(5, 'Coins', 30)] }))).toBe(true);
    });

    test('only the hops still ahead count: past the ship, no coins are asked for', () => {
        const s = state(2780, 3200, { inventory: [item(4, 'Nature talisman')] }); // Brimhaven, past checkpoint 2
        expect(pre('T20-21', s)).toBe(true);
    });

    test('never the start tile: a run-only leg can start from anywhere, and an arrived leg always can', () => {
        expect(pre('T07a', state(3000, 3000))).toBe(true);
        expect(pre('T21-22', state(TILES.flySpots.x, TILES.flySpots.z))).toBe(true);
        expect(pre('T21-22', { ...state(0, 0), inGame: false })).toBe('not in game');
    });
});

describe('the catalogue', () => {
    test('logoutSafe is false exactly on the legs into or out of the Wilderness above level 20', () => {
        const unsafe = LEGS.filter(l => !l.logoutSafe).map(l => l.def.id);
        expect(unsafe).toEqual(['T13-14', 'T14-15', 'T15-16', 'T26-27', 'T27-17']);
    });

    test("one leg per id, every RUN-ORDER.md section 2 leg, and the order total: 1,382 + T07a 12 + T16-18 8 + T02-03 43 (5 to 48) + T14-15 at its measured 185 (11.5 over 173.5 i) = 1,456.5 ticks", () => {
        const ids = LEGS.map(l => l.def.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toContain('T07a');
        expect(ids.filter(i => i.startsWith('L24'))).toEqual(['L24a', 'L24b', 'L24c']);
        expect(netTotal()).toBe(1456.5);
    });

    test("T02-03 ends on S03's row entry and T04-05 leaves from where S03's 157th log leaves SCORED", () => {
        // The measured castle lap (docs/speedrun/rehearsals/firemaking.md), the run config's firemakingTiles.
        const row = parseTiles('3222-3218@3219;3218-3243@3218;3242-3223@3219');
        expect(row).toHaveLength(51);
        const t0203 = legById('T02-03').def;
        expect([t0203.dest.x, t0203.dest.z, t0203.dest.tol]).toEqual([...resolveOptions({ tiles: row }).entry!, 0]);
        expect(t0203.expected).toMatchObject({ ticks: 48, net: 48 });

        // A lap (51 logs at 4 ticks) outlasts the longest fire (199 ticks), so no lap skips a tile:
        // the last log lies on planned tile (n - 1) mod 51, and its success pushes SCORED west.
        const logs = routeLogs(0, 99).length;
        expect(logs).toBe(157);
        expect(row.length * 4).toBeGreaterThan(199);
        const [x, z] = row[(logs - 1) % row.length]!;
        expect([x, z]).toEqual([3219, 3219]);
        expect<{ x: number; z: number }>(TILES.s03End).toEqual({ x: x - 1, z });
        expect(legById('T04-05').def.start).toEqual(TILES.s03End);
    });

    test("T07a: 58 m (run-transitions section 10), between woodcutting's own emitted band names", () => {
        const t = legById('T07a').def;
        expect(t.expected).toMatchObject({ ticks: 58, label: 'm', net: 58 });
        expect([t.after, t.before]).toEqual(['woodcutting:oak-15-73', 'woodcutting:willow-73-99']);
        expect(legsAfter('woodcutting:oak-15-73').map(l => l.def.id)).toEqual(['T07a']);
    });

    test("T16-18 ends at S18's knights anchor (2670,3305), within thieving's 8-tile no-walk radius, priced +8 i", () => {
        const t = legById('T16-18').def;
        expect(t.dest).toMatchObject({ x: 2670, z: 3305 });
        expect(t.expected).toMatchObject({ ticks: 14, label: 'i', net: 14 });
        expect(Math.max(Math.abs(t.dest.x - 2670), Math.abs(t.dest.z - 3305)) + (t.dest.tol ?? 0)).toBeLessThanOrEqual(8);
    });
});

describe('splitLeg', () => {
    const ARDOUGNE_SPLITS: [string, number, number?][] = [['T11-12', 0], ['T12-13', 0], ['T13-14', 0], ['T14-15', 1, 70], ['T15-16', 0], ['T26-27', 0]];

    test('part a is hops 0..afterHop into the landing, part b the rest from it; the nets sum to the leg exactly', () => {
        for (const [id, after, first] of ARDOUGNE_SPLITS) {
            const l = legById(id);
            const [a, b] = splitLeg(l, after, first ? { firstTicks: first } : {});
            expect([a.def.id, b.def.id]).toEqual([`${id}a`, `${id}b`]);
            expect([...a.def.hops, ...b.def.hops]).toEqual([...l.def.hops]);
            expect(a.def.dest).toEqual(SPELLS.ardougne.landing);
            expect(b.def.start).toEqual(SPELLS.ardougne.landing);
            expect(b.def.dest).toEqual(l.def.dest);
            expect([a.def.after, a.def.before, b.def.after, b.def.before]).toEqual([l.def.after, `${id}b`, `${id}a`, l.def.before]);
            expect(Math.round((a.def.expected.net + b.def.expected.net) * 10) / 10).toBe(l.def.expected.net);
            expect(Math.round((a.def.expected.ticks + b.def.expected.ticks) * 10) / 10).toBe(l.def.expected.ticks);
            expect(b.def.countedBy ?? null).toBe(l.def.countedBy ?? null);
        }
        // The landing is SUPPLIES' meeting spread, 2659-2663 x 3299-3303.
        expect(SPELLS.ardougne.landing).toEqual({ x: 2661, z: 3301, tol: 2 });
    });

    test('the food check goes only to the part that enters the Wilderness: a teleport part needs none (T15-16a runs before H13 brings the food)', () => {
        for (const [id, after, first] of ARDOUGNE_SPLITS) {
            const l = legById(id);
            if (!l.def.food) continue;
            for (const p of splitLeg(l, after, first ? { firstTicks: first } : {})) {
                expect(p.def.food ?? 0).toBe(entersWilderness(p.def.hops, p.def.dest) ? l.def.food : 0);
            }
        }
        const [a, b] = splitLeg(legById('T15-16'), 0);
        expect(a.def.food).toBeUndefined();
        expect(b.def.food).toBe(2);
        const oneShark = (x: number, z: number) => state(x, z, { inventory: [...ARDOUGNE_RUNES, item(5, 'Shark'), item(6, 'Knife')] });
        expect(legPreconditions(a.def, oneShark(TILES.daero.x, TILES.daero.z))).toBe(true);
        expect(legPreconditions(b.def, oneShark(2661, 3301))).toBe('T15-16b: 1 food held, 2 needed');
        // A leg out of the Wilderness keeps it on the part that is still in it (T14-15's run to level 20).
        const [a1415, b1415] = splitLeg(legById('T14-15'), 1, { firstTicks: 70 });
        expect([a1415.def.food, b1415.def.food]).toEqual([2, undefined]);
        // Hostility (the start floor and the upkeep) goes to both parts: T14-15b holds no food check but passes the Khazard battlefield poisoned (rs/762).
        expect([hostileLeg(a1415.def), hostileLeg(b1415.def)]).toEqual([true, true]);
        expect([a.def.hostile, b.def.hostile]).toEqual([true, true]);
        expect(hostileLeg(legById('T12-13').def)).toBe(false);
        expect(entersWilderness([{ kind: 'teleport', spell: 'ardougne' }], SPELLS.ardougne.landing)).toBe(false);
    });

    test("T13-14: part a ends on the landing; b's checkpoints are the original's renumbered, so a restart in the keep resumes at the web", () => {
        const [a, b] = splitLeg(legById('T13-14'), 0);
        expect(a.def.expected).toMatchObject({ ticks: 4, net: 4 });
        expect(a.logoutSafe).toBe(true);
        expect(b.logoutSafe).toBe(false);
        expect(b.def.checkpoints?.map(c => c.after)).toEqual([1, 2]);
        expect(b.def.hops[resumeHop(b.def, state(3150, 3930))]?.kind).toBe('webs');
        // On the landing, a is arrived (no second teleport) and b starts with the run to the lever.
        const s = state(2662, 3300, { inventory: [item(0, 'Shark', 2), item(1, 'Knife')] });
        expect(arrived(a.def, s)).toBe(true);
        expect(resumeHop(b.def, s)).toBe(0);
        expect(legPreconditions(b.def, s)).toBe(true);
    });

    test('T14-15 splits after its second hop (the Ardougne teleport), with part a priced from X14n 66 + the teleport 4', () => {
        const [a, b] = splitLeg(legById('T14-15'), 1, { firstTicks: 70 });
        expect(a.def.hops.map(h => h.kind)).toEqual(['run', 'teleport']);
        expect(b.def.hops[0]).toMatchObject({ kind: 'run' });
        expect(b.def.checkpoints?.map(c => c.after)).toEqual([1, 2]);
        expect(() => splitLeg(legById('T14-15'), 1)).toThrow('firstTicks');
    });

    test('refuses a split it cannot price or place', () => {
        expect(() => splitLeg(legById('T13-14'), 4)).toThrow('cannot split');
        expect(() => splitLeg(legById('T13-14'), 1)).toThrow('not a teleport');
        expect(() => splitLeg(legById('T13-14'), 0, { firstTicks: 500 })).toThrow('outside');
    });
});

describe('the catalogue, continued', () => {

    test('every leg whose destination a quest counts carries its full measured figure', () => {
        expect(legById('T09-10').def.expected).toMatchObject({ ticks: 55.5, net: -47.5 });
        for (const l of LEGS) if (l.def.countedBy) expect(l.def.expected.ticks).toBeGreaterThan(0);
    });

    test('the body altar swaps T20-21 and T21-22 in place: no ship, no coins, a body talisman', () => {
        const body = legsFor({ s21Altar: 'body' });
        expect(body.map(l => l.def.id)).toEqual(LEGS.map(l => l.def.id));
        const t2021 = legById('T20-21', body);
        expect(t2021.def.hops.map(h => h.kind)).toEqual(['teleport', 'run', 'item-on-loc']);
        expect(t2021.def.dest).toEqual(TILES.bodyAltar);
        expect(legById('T21-22', body).def.start).toEqual(TILES.bodyAltar);
        const s = state(TILES.contestDwarf.x, TILES.contestDwarf.z, { inventory: [...FALADOR_RUNES, item(4, 'Body talisman')] });
        expect(legPreconditions(t2021.def, s)).toBe(true);
        expect(legsFor({ s21Altar: 'nature' })).toEqual([...LEGS]);
    });

    test("T25-26 ends on exactly (3191,3365), with no door on it or beside it (the guild door is (3191,3363))", () => {
        const t = legById('T25-26').def;
        expect(t.dest).toEqual({ x: 3191, z: 3365, tol: 0 });
        expect(t.hops.at(-1)).toEqual({ kind: 'run', to: { x: 3191, z: 3365, tol: 0, level: 0 } });
        expect(getDoorAt(0, 3191, 3363)).toBeDefined();
        expect(findDoorsAlongPath([{ x: t.dest.x, z: t.dest.z, level: 0 }])).toEqual([]);
    });

    test('legsAfter interleaves by step id', () => {
        expect(legsAfter('S13').map(l => l.def.id)).toEqual(['T13-14']);
        expect(legsAfter('S24:D9-kaqemeex-reward').map(l => l.def.id)).toEqual(['L24b']);
    });
});

// ------------------------------------------------------------------ drops

/**
 * The server's drop: a dropped slot is empty from the next tick. `ignore(n)` loses the n-th drop
 * sent, as the server does for a player in a delay. Records each send's slot and tick.
 */
function serveDrops(sdk: FakeSdk, ignore: (n: number) => boolean = () => false): { slot: number; tick: number }[] {
    const sends: { slot: number; tick: number }[] = [];
    let pending = new Set<number>();
    const prev = sdk.onSend;
    sdk.onSend = (a, f) => {
        prev(a, f);
        if (a.method !== 'sendDropItem') return;
        const slot = a.args[0] as number;
        sends.push({ slot, tick: f.state!.tick });
        if (!ignore(sends.length)) pending.add(slot);
    };
    const tick = sdk.tick.bind(sdk);
    sdk.tick = patch => {
        const gone = pending;
        pending = new Set();
        if (gone.size) sdk.state = { ...sdk.state!, inventory: sdk.state!.inventory.filter(i => !gone.has(i.slot)) };
        return tick(patch);
    };
    return sends;
}

/** A teleport click lands the player at `at` on the next microtask. Records what was held at each teleport click. */
function serveTeleport(sdk: FakeSdk, at: { x: number; z: number }): string[][] {
    const heldAtCast: string[][] = [];
    const prev = sdk.onSend;
    sdk.onSend = (a, f) => {
        prev(a, f);
        if (a.method !== 'sendClickComponent') return;
        heldAtCast.push(f.state!.inventory.map(i => i.name));
        queueMicrotask(() => f.tick({ player: player(at.x, at.z) }));
    };
    return heldAtCast;
}

const kinds = (sdk: FakeSdk) => sdk.sent.map(a => a.method).filter((m, i, all) => i === 0 || m !== all[i - 1]);

describe('leg drops', () => {
    const T0405 = () => legById('T04-05');
    const s04Exit = (more: InventoryItem[] = []) => state(TILES.s03End.x, TILES.s03End.z, { inventory: [...FALADOR_RUNES, item(3, 'Tinderbox'), item(4, 'Earth rune', 4), ...more] });

    test("T04-05 drops S04's tinderbox and earth runes in one burst, confirmed, before the teleport click", async () => {
        const sdk = new FakeSdk(s04Exit());
        const drops = serveDrops(sdk);
        const held = serveTeleport(sdk, SPELLS.falador.landing);
        simulateWalking(sdk);
        await drive(sdk, T0405().run(ctxFor(sdk)));
        expect(drops.map(d => d.slot)).toEqual([3, 4]);
        expect(drops[0]!.tick).toBe(drops[1]!.tick);
        expect(kinds(sdk).slice(0, 2)).toEqual(['sendDropItem', 'sendClickComponent']);
        // The cast went out only once the drops had landed.
        expect(held[0]).toEqual(['Air rune', 'Water rune', 'Law rune']);
        expect(inArea(sdk.state!, TILES.doric)).toBe(true);
    });

    test('a drop the server ignored (a delayed player) is sent again before the first hop', async () => {
        const sdk = new FakeSdk(s04Exit());
        const drops = serveDrops(sdk, n => n === 1);
        serveTeleport(sdk, SPELLS.falador.landing);
        simulateWalking(sdk);
        await drive(sdk, T0405().run(ctxFor(sdk)));
        expect(drops.map(d => d.slot)).toEqual([3, 4, 3]);
        expect(drops[2]!.tick).toBeGreaterThan(drops[0]!.tick);
        expect(kinds(sdk).slice(0, 2)).toEqual(['sendDropItem', 'sendClickComponent']);
    });

    test('a drop that never lands fails the leg naming the item, and the first hop is never sent', async () => {
        const sdk = new FakeSdk(s04Exit());
        const drops = serveDrops(sdk, (n) => n === 1 || n > 2);
        serveTeleport(sdk, SPELLS.falador.landing);
        const run = T0405().run(ctxFor(sdk));
        await expect(drive(sdk, run)).rejects.toThrow(/^T04-05: still holding Tinderbox after 4 drop batches$/);
        expect(drops.length).toBe(5);
        expect(sdk.sent.some(a => a.method !== 'sendDropItem')).toBe(false);
    });

    test('T11-12 drops the five Grand Tree leftovers in one tick before the cast and keeps an agility potion (no longer a leg drop)', async () => {
        const left = ['Translation book', "Hazelmere's scroll", "Glough's journal", 'Lumber order', "Glough's key", 'Agility potion(2)'];
        const sdk = new FakeSdk(state(TILES.narnodeRoots.x, TILES.narnodeRoots.z, { inventory: [...ARDOUGNE_RUNES, ...left.map((n, i) => item(2 + i, n))] }));
        const drops = serveDrops(sdk);
        const held = serveTeleport(sdk, SPELLS.ardougne.landing);
        simulateWalking(sdk);
        await drive(sdk, legById('T11-12').run(ctxFor(sdk)));
        expect(drops.map(d => d.slot)).toEqual([2, 3, 4, 5, 6]);
        expect(new Set(drops.slice(0, DROPS_PER_TICK).map(d => d.tick)).size).toBe(1);
        expect(held[0]).toEqual(['Water rune', 'Law rune', 'Agility potion(2)']);
        expect(inArea(sdk.state!, TILES.ladyServil)).toBe(true);
    });

    test("T06-07 keeps the air runes its Falador teleport spends and drops them after the landing, before the run's first click", async () => {
        const sdk = new FakeSdk(state(TILES.airAltar.x, TILES.airAltar.z, { inventory: [item(0, 'Air rune', 575), item(1, 'Water rune', 1), item(2, 'Law rune', 2)] }));
        const drops = serveDrops(sdk);
        const held = serveTeleport(sdk, SPELLS.falador.landing);
        simulateWalking(sdk);
        await drive(sdk, legById('T06-07').run(ctxFor(sdk)));
        expect(held[0]).toContain('Air rune');
        expect(kinds(sdk).slice(0, 3)).toEqual(['sendClickComponent', 'sendDropItem', 'sendWalk']);
        expect(drops.map(d => d.slot)).toEqual([0]);
        expect(sdk.state!.inventory.map(i => i.name)).toEqual(['Water rune', 'Law rune']);
    });

    test('a resume drops only what is still held: arrived with the tinderbox, it is dropped and nothing else sent; arrived without, nothing', async () => {
        const at = state(TILES.doric.x, TILES.doric.z, { inventory: [item(2, 'Law rune', 1), item(3, 'Tinderbox')] });
        expect(T0405().postconditions(at, undefined)).toBe('T04-05: still holding Tinderbox, which the leg drops');
        const sdk = new FakeSdk(at);
        const drops = serveDrops(sdk);
        await drive(sdk, T0405().run(ctxFor(sdk)));
        expect(drops.map(d => d.slot)).toEqual([3]);
        expect(sdk.sent.every(a => a.method === 'sendDropItem')).toBe(true);
        expect(T0405().postconditions(sdk.state!, undefined)).toBe(true);
        const again = new FakeSdk(sdk.state!);
        await drive(again, T0405().run(ctxFor(again)));
        expect(again.sent).toEqual([]);
    });

    test('neededBy: a spell\'s runes, an item used on a loc, the webs\' knife; dropsDue skips them until no later hop needs them', () => {
        const t0607 = legById('T06-07').def;
        expect(neededBy(t0607.hops, 'Air rune')).toBe(true);
        expect(neededBy(t0607.hops.slice(1), 'Air rune')).toBe(false);
        expect(neededBy(legById('T26-27').def.hops, 'Knife')).toBe(true);
        expect(neededBy(legById('T20-21', legsFor({ s21Altar: 'body' })).def.hops, 'Body talisman')).toBe(true);
        const s = state(0, 0, { inventory: [item(0, 'Air rune', 575)] });
        expect(dropsDue(t0607, s, 0)).toEqual([]);
        expect(dropsDue(t0607, s, 1).map(i => i.name)).toEqual(['Air rune']);
    });
});

describe("T07-08 drops the last load's unburied bones before the Camelot teleport (rs/664)", () => {
    const T0708 = () => legById('T07-08');
    /** S07's close at the willow stand: the Camelot runes, the knife, the kept log, then `n` bones. */
    const s07End = (bones: string, n: number) => state(TILES.taverleyWillows.x, TILES.taverleyWillows.z, {
        inventory: [item(0, 'Law rune', 1), item(1, 'Air rune', 5), item(2, 'Knife'), item(3, 'Logs'), ...Array.from({ length: n }, (_, i) => item(4 + i, bones))],
    });
    const travelRow = (ctx: StepContext<unknown>) => ctx.log.rows.find(r => r.kind === 'travel')!;

    for (const bones of ['Babydragon bones', 'Dragon bones']) {
        test(`21 ${bones}: all dropped, ${DROPS_PER_TICK} a tick, before the teleport click; the runes, knife and log kept`, async () => {
            const sdk = new FakeSdk(s07End(bones, 21));
            const drops = serveDrops(sdk);
            const held = serveTeleport(sdk, SPELLS.camelot.landing);
            simulateWalking(sdk);
            const ctx = ctxFor(sdk);
            await drive(sdk, T0708().run(ctx));
            expect(drops.map(d => d.slot)).toEqual(Array.from({ length: 21 }, (_, i) => 4 + i));
            // 5 + 5 + 5 + 5 + 1: five batches, one tick each.
            expect([...new Set(drops.map(d => d.tick))].map(t => drops.filter(d => d.tick === t).length)).toEqual([5, 5, 5, 5, 1]);
            expect(kinds(sdk).slice(0, 2)).toEqual(['sendDropItem', 'sendClickComponent']);
            expect(held).toEqual([['Law rune', 'Air rune', 'Knife', 'Logs']]);
            expect(inArea(sdk.state!, TILES.edmond)).toBe(true);
            const [burst, ...more] = (travelRow(ctx).meta as { drops: { at: number; ok: boolean; dropped: string[]; batches: number; ticks: number }[] }).drops;
            expect(more).toEqual([]);
            expect(burst).toMatchObject({ at: 0, ok: true, batches: 5, dropped: Array(21).fill(bones) });
            expect(burst!.ticks).toBe(drops.at(-1)!.tick - drops[0]!.tick + 1);
            expect(T0708().postconditions(sdk.state!, undefined)).toBe(true);
        });
    }

    test('no bones held: a no-op, no drop sent, no drop rows, 0 ticks before the teleport click', async () => {
        expect(await dropDue(new FakeSdk(s07End('', 0)) as never, T0708().def, 0)).toEqual({ at: 0, ok: true, dropped: [], ticks: 0, batches: 0 });
        const sdk = new FakeSdk(s07End('', 0));
        const drops = serveDrops(sdk);
        const castTicks: number[] = [];
        const prev = sdk.onSend;
        sdk.onSend = (a, f) => {
            if (a.method === 'sendClickComponent') castTicks.push(f.state!.tick);
            prev(a, f);
        };
        serveTeleport(sdk, SPELLS.camelot.landing);
        simulateWalking(sdk);
        const ctx = ctxFor(sdk);
        await drive(sdk, T0708().run(ctx));
        expect(drops).toEqual([]);
        expect(sdk.sent[0]!.method).toBe('sendClickComponent');
        expect(castTicks).toEqual([100]);
        expect(travelRow(ctx).meta).not.toHaveProperty('drops');
        expect(inArea(sdk.state!, TILES.edmond)).toBe(true);
    });

    test("S07's real close holds its willow band's kept log: dropped before the teleport click (knife-mine takes a normal log only); the knife and runes kept", async () => {
        const end = state(TILES.taverleyWillows.x, TILES.taverleyWillows.z, { inventory: [item(0, 'Law rune', 1), item(1, 'Air rune', 5), item(2, 'Knife'), item(3, 'Willow logs')] });
        const sdk = new FakeSdk(end);
        const drops = serveDrops(sdk);
        const held = serveTeleport(sdk, SPELLS.camelot.landing);
        simulateWalking(sdk);
        await drive(sdk, T0708().run(ctxFor(sdk)));
        expect(drops.map(d => d.slot)).toEqual([3]);
        expect(kinds(sdk).slice(0, 2)).toEqual(['sendDropItem', 'sendClickComponent']);
        expect(held).toEqual([['Law rune', 'Air rune', 'Knife']]);
        expect(T0708().postconditions(sdk.state!, undefined)).toBe(true);
    });

    test('the patterns take every bone and the willow log, nothing else SCORED holds at T07-08; no hop needs either', () => {
        const { drops = [], hops } = T0708().def;
        const takes = (name: string) => drops.some(p => p.test(name));
        expect([takes('Willow logs'), neededBy(hops, 'Willow logs')]).toEqual([true, false]);
        for (const b of ['Bones', 'Big bones', 'Babydragon bones', 'Dragon bones', 'babydragon bones']) {
            expect(takes(b)).toBe(true);
            expect(neededBy(hops, b)).toBe(false);
        }
        for (const kept of ['Law rune', 'Air rune', 'Knife', 'Logs', 'Staff of water']) expect(takes(kept)).toBe(false);
        expect(neededBy(hops, 'Law rune')).toBe(true);
        expect(neededBy(hops, 'Air rune')).toBe(true);
        expect(dropsDue(T0708().def, s07End('Dragon bones', 21), 0).map(i => i.slot)).toEqual(Array.from({ length: 21 }, (_, i) => 4 + i));
    });
});

// ------------------------------------------------------------------ the ledger contract

const MANIFEST = readFileSync(join(import.meta.dir, '../../docs/speedrun/STEP-MANIFEST.md'), 'utf8');
/** The catalogue the run uses (the body altar plan, RUN-ORDER.md O7). */
const IN_FORCE: readonly LegStep[] = legsFor({ s21Altar: 'body' });

/**
 * Ledger drops on a leg row that a step module performs, not the leg (each `row item`). Empty since
 * rs/158's fold-in 33 moved the talismans (runecraft.ts dropTalisman) and S16's god staff and cape
 * (mage-arena.ts exitDrop) onto the modules' own rows.
 */
const MODULE_EXIT_DROPS: Readonly<Record<string, string>> = {};

/** Ledger drops on a leg row no code performs yet, each with the ruling it waits on. */
const PENDING_DROPS: Readonly<Record<string, string>> = {};

const sampleName = (o: OutEntry) => (o.family ? `${o.name}(2)` : o.name);

describe('leg drops: the STEP-MANIFEST ledger contract', () => {
    const rows = parseLedger(MANIFEST).rows;
    const legRows = rows.filter(r => IN_FORCE.some(l => l.def.id === r.row));
    const dropsOn = (row: string) => legRows.find(r => r.row === row)?.out.filter(o => o.reason === 'drop') ?? [];

    test('the ledger has leg rows with drops to check', () => {
        expect(legRows.filter(r => r.out.some(o => o.reason === 'drop')).map(r => r.row)).toEqual(
            ['T01-02', 'T04-05', 'T06-07', 'T07-08', 'T11-12', 'T20-21', 'T21-22', 'T22-23', 'T26-27'],
        );
    });

    test("T07-08's row drops `<bones> any` and `willow logs any`, the leg's /bones$/i and /^willow logs$/i; S07's last load brings no bone (rs/663), so the walk drops the willow log only, leaving the knife and H6 its 12", () => {
        const drops = dropsOn('T07-08');
        expect(drops[0]).toEqual({ name: 'bones', placeholder: true, count: 'any', reason: 'drop' });
        expect(drops[1]).toMatchObject({ name: 'willow logs', count: 'any', reason: 'drop' });
        expect(drops).toHaveLength(2);
        expect(legById('T07-08').def.drops).toEqual([/bones$/i, /^willow logs$/i]);
        expect(rows.find(r => r.row === 'S07 last load')!.in.some(i => i.name === 'bones')).toBe(false);
        const entries = walk(rows);
        const at = (row: string) => entries.find(e => e.row.row === row)!;
        expect(at('S07 last load')).toMatchObject({ verdict: 'pass', used: 4 });
        expect(at('T07-08')).toMatchObject({ verdict: 'pass', used: 1, held: 'knife x1' });
        expect(at('H6')).toMatchObject({ verdict: 'pass', need: 12 });
    });

    test('every drop on a leg row has exactly one performer: the leg, a named module exit, or a pending ruling', () => {
        const problems: string[] = [];
        for (const r of legRows) {
            const l = IN_FORCE.find(x => x.def.id === r.row)!;
            for (const o of dropsOn(r.row)) {
                const key = `${r.row} ${o.name}`;
                const by = [
                    (l.def.drops ?? []).some(p => p.test(sampleName(o))) ? 'the leg' : null,
                    MODULE_EXIT_DROPS[key] ? `module (${MODULE_EXIT_DROPS[key]})` : null,
                    PENDING_DROPS[key] ? `pending (${PENDING_DROPS[key]})` : null,
                ].filter(Boolean);
                if (by.length !== 1) problems.push(`${key}: ${by.length ? by.join(' and ') : 'no performer'}`);
            }
        }
        expect(problems).toEqual([]);
    });

    test('every pattern a leg drops names a drop on its own ledger row', () => {
        const extra = IN_FORCE.flatMap(l => (l.def.drops ?? []).filter(p => !dropsOn(l.def.id).some(o => p.test(sampleName(o)))).map(p => `${l.def.id} ${p}`));
        expect(extra).toEqual([]);
    });

    test('the module-exit and pending lists name real ledger drops', () => {
        const real = new Set(legRows.flatMap(r => dropsOn(r.row).map(o => `${r.row} ${o.name}`)));
        expect([...Object.keys(MODULE_EXIT_DROPS), ...Object.keys(PENDING_DROPS)].filter(k => !real.has(k))).toEqual([]);
    });
});

// ------------------------------------------------------------------ splits keep the drops

describe("splitLeg keeps the drops: part a makes the whole leg's, part b none", () => {
    const rows = parseLedger(MANIFEST).rows;
    const inLedger = new Set(rows.map(r => r.row));
    /** The splits buildChain makes: each PLACEMENT leg row the ledger in force has. */
    const chainSplits = Object.entries(PLACEMENT).flatMap(([row, p]) => ('leg' in p && inLedger.has(row) ? [{ row, ...p }] : []));
    const split = (c: (typeof chainSplits)[number]) => splitLeg(legById(c.leg, IN_FORCE), c.afterHop, c.firstTicks ? { firstTicks: c.firstTicks } : {});
    const dropSamples = (id: string) => rows.find(r => r.row === id)!.out.filter(o => o.reason === 'drop').map(sampleName);
    const names = (xs: readonly InventoryItem[]) => xs.map(i => i.name);

    test('the chain splits two dropping legs: T11-12 at H9 and T26-27 at H23', () => {
        expect(chainSplits.filter(c => legById(c.leg, IN_FORCE).def.drops?.length).map(c => `${c.leg} ${c.row}`)).toEqual(['T11-12 H9', 'T26-27 H23']);
    });

    test('part a drops, before each of its hops and on its arrival, exactly what the unsplit leg drops there; part b drops nothing', () => {
        for (const c of chainSplits) {
            const l = legById(c.leg, IN_FORCE);
            if (!l.def.drops?.length) continue;
            const [a, b] = split(c);
            expect(a.def.drops).toEqual(l.def.drops);
            expect(b.def.drops).toBeUndefined();
            const s = state(0, 0, { inventory: [...ARDOUGNE_RUNES, item(2, 'Knife'), item(3, 'Shark', 2), ...dropSamples(c.leg).map((n, i) => item(4 + i, n))] });
            expect(dropsDue(a.def, s, 0).length).toBeGreaterThan(0);
            for (let at = 0; at <= c.afterHop; at++) expect(names(dropsDue(a.def, s, at))).toEqual(names(dropsDue(l.def, s, at)));
            expect(names(dropsDue(a.def, s, a.def.hops.length))).toEqual(names(dropsDue(l.def, s, c.afterHop + 1)));
            expect(dropsDue(b.def, s, 0)).toEqual([]);
        }
    });

    test('in the chain, T11-12a drops the five Grand Tree leftovers before its cast, and T11-12b, after H9, drops nothing', async () => {
        const [a, b] = split(chainSplits.find(c => c.leg === 'T11-12')!);
        const left = ['Translation book', "Hazelmere's scroll", "Glough's journal", 'Lumber order', "Glough's key"];
        const sdk = new FakeSdk(state(TILES.narnodeRoots.x, TILES.narnodeRoots.z, { inventory: [...ARDOUGNE_RUNES, ...left.map((n, i) => item(2 + i, n))] }));
        const drops = serveDrops(sdk);
        const held = serveTeleport(sdk, SPELLS.ardougne.landing);
        simulateWalking(sdk);
        await drive(sdk, a.run(ctxFor(sdk)));
        expect(drops.map(d => d.slot)).toEqual([2, 3, 4, 5, 6]);
        expect(kinds(sdk).slice(0, 2)).toEqual(['sendDropItem', 'sendClickComponent']);
        expect(held[0]).toEqual(['Water rune', 'Law rune']);
        expect(a.postconditions(sdk.state!, undefined)).toBe(true);
        // Whatever H9 hands over at the landing stays: part b has no drops.
        sdk.state = { ...sdk.state!, inventory: [item(7, 'Translation book')] };
        const sent = sdk.sent.length;
        await drive(sdk, b.run(ctxFor(sdk)));
        expect(sdk.sent.slice(sent).some(x => x.method === 'sendDropItem')).toBe(false);
        expect(inArea(sdk.state!, TILES.ladyServil)).toBe(true);
    });

    test('a split whose part b needs what a drop takes is refused: a rune for its spell, an item it uses on a loc', () => {
        const fal: Hop = { kind: 'teleport', spell: 'falador' };
        const toRuins: Hop = { kind: 'run', to: { x: 2984, z: 3293, tol: 2 } };
        const opts = (drops: RegExp[]) => ({ after: 'A', before: 'B', method: 'm', drops, expected: { ticks: 20, label: 'i' as const, source: 'test', net: 20 } });
        const twice = leg('TX', TILES.doric, TILES.airAltar, [fal, toRuins, fal, toRuins], opts([/^air rune$/i]));
        expect(() => splitLeg(twice, 0)).toThrow('TX: cannot split after hop 0: /^air rune$/i takes the Air rune part b needs');
        const talisman: Hop = { kind: 'item-on-loc', item: /^air talisman$/i, loc: { id: 2452 }, arrive: TILES.airAltar };
        expect(() => splitLeg(leg('TY', TILES.doric, TILES.airAltar, [fal, toRuins, talisman], opts([/talisman$/i])), 0)).toThrow('/talisman$/i takes the air talisman part b needs');
        // A drop part b does not need splits as before, and part a keeps what part b needs (keepFor).
        const [a] = splitLeg(leg('TZ', TILES.doric, TILES.airAltar, [fal, toRuins, talisman], opts([/^air rune$/i])), 0);
        expect(a.def.keepFor).toEqual([toRuins, talisman]);
    });

    test('no drop a split leg makes takes what the hand-off between its parts brings (a resumed part a drops what is held)', () => {
        const problems: string[] = [];
        for (const c of chainSplits) {
            const brought = rows.find(r => r.row === c.row)!.in.map(e => (e.family ? `${e.name}(2)` : e.name));
            for (const p of legById(c.leg, IN_FORCE).def.drops ?? []) for (const n of brought) if (p.test(n)) problems.push(`${c.leg} ${p} takes ${c.row}'s ${n}`);
        }
        expect(problems).toEqual([]);
    });

    test('every field of a split leg reaches one of its parts (a new LegDef field must be carried by splitLeg)', () => {
        const own = new Set(['id', 'start', 'dest', 'hops', 'after', 'before', 'method', 'expected']);
        for (const c of chainSplits) {
            const l = legById(c.leg, IN_FORCE);
            const [a, b] = split(c);
            const carried = new Set([...Object.keys(a.def), ...Object.keys(b.def)]);
            expect([c.leg, Object.keys(l.def).filter(k => !own.has(k) && !carried.has(k))]).toEqual([c.leg, []]);
        }
    });
});

// ------------------------------------------------------------------ T14-15's church altar

describe("T14-15 prays at the East Ardougne church altar when Prayer points are short (main's R2)", () => {
    const T1415 = () => legById('T14-15');
    const H11R = { firstTicks: 70 };
    const prayers = (points: number, level = 99) => ({ activePrayers: [] as boolean[], prayerPoints: points, prayerLevel: level });
    /** loc 409 `altar` (skill_prayer/configs/altars.loc: op1 Pray-at), at (2617,3309) on map m40_51. */
    const ALTAR = { id: 409, x: 2617, z: 3309, level: 0, name: 'Altar', distance: 5, options: ['Pray-at'], optionsWithIndex: [{ text: 'Pray-at', opIndex: 1 }] };
    const DOOR_AT = { x: 2650, z: 3308 };
    const door = (open: boolean) => ({ id: 1530, ...DOOR_AT, level: 0, name: 'Door', distance: 3, options: [open ? 'Close' : 'Open'], optionsWithIndex: [{ text: open ? 'Close' : 'Open', opIndex: 1 }] });
    /** T14-15b's first hop (the run to the Khazard tree) with its stop: the leg from the landing, as the chain runs it after H11r. */
    const fromLanding = () => {
        const [, b] = splitLeg(T1415(), 1, H11R);
        return leg('T14-15b', SPELLS.ardougne.landing, TILES.khazardTree, [b.def.hops[0]!], {
            after: 'H11r', before: 'S15', method: 'test', stops: b.def.stops, expected: { ticks: 100, label: 'i', source: 'test', net: 100 },
        });
    };
    /** The altar's script: a Pray-at sets the points to the level on the next tick. Records each op's tick. */
    const serveAltar = (sdk: FakeSdk): number[] => {
        const prayed: number[] = [];
        const prev = sdk.onSend;
        sdk.onSend = (a, f) => {
            prev(a, f);
            if (a.method !== 'sendInteractLoc' || a.args[2] !== 409) return;
            prayed.push(f.state!.tick);
            queueMicrotask(() => f.tick(s => ({ prayers: { ...s.prayers, prayerPoints: s.prayers.prayerLevel } })));
        };
        return prayed;
    };
    const landing = (points: number, more: Partial<BotWorldState> = {}) =>
        state(SPELLS.ardougne.landing.x, SPELLS.ardougne.landing.z, { prayers: prayers(points), nearbyLocs: [ALTAR] as never, ...more });
    const stopsOf = (ctx: StepContext<unknown>) => (ctx.log.rows.find(r => r.kind === 'travel')!.meta as { stops?: LegStopRecord[] }).stops;
    const inChurch = (c: { x: number; z: number }) => c.x >= 2613 && c.x <= 2621 && c.z >= 3304 && c.z <= 3310;

    test('the stop: loc 409 Pray-at from the aisle head (2617,3308), before hop 2; the hops, checkpoints and Khazard arrival are as before', () => {
        const d = T1415().def;
        expect(d.stops).toHaveLength(1);
        expect(d.stops![0]).toMatchObject({ before: 2, label: 'East Ardougne church altar', loc: { id: 409, x: 2617, z: 3309 } });
        expect(String(d.stops![0]!.op)).toBe(String(/^pray-at$/i));
        expect(d.stops![0]!.hops).toEqual([{ kind: 'run', to: { x: 2617, z: 3308, tol: 1, level: 0 } }]);
        expect(d.hops.map(h => h.kind)).toEqual(['run', 'teleport', 'run', 'tree', 'tree', 'run']);
        expect(d.hops[2]).toEqual({ kind: 'run', to: { x: 2555, z: 3259, tol: 1, level: 0 } });
        expect(d.checkpoints!.map(c => c.after)).toEqual([3, 4]);
        expect(d.method).toMatch(/church altar/);
        expect(d.expected).toMatchObject({ ticks: 185, label: 'm', net: 185 });
        expect(CHURCH_ALTAR.wanted(landing(20))).toBe(true);
        expect(CHURCH_ALTAR.wanted(landing(99))).toBe(false);
    });

    test('the checkpoints still place a restart: the landing and the church resume at hop 2 (where the stop asks again), the trees after them', () => {
        const d = T1415().def;
        expect(resumeHop(d, landing(20))).toBe(2);
        expect(resumeHop(d, state(2617, 3308))).toBe(2);
        expect(resumeHop(d, state(2580, 3280))).toBe(2);
        expect(resumeHop(d, state(2540, 3170))).toBe(4);
        expect(resumeHop(d, state(2460, 3440))).toBe(5);
    });

    test("H11r's split puts the stop in part b at its hop 0, never in part a (which ends at the landing)", () => {
        const [a, b] = splitLeg(T1415(), 1, H11R);
        expect(a.def.stops).toBeUndefined();
        expect(b.def.stops!.map(st => st.before)).toEqual([0]);
        expect(b.def.checkpoints!.map(c => c.after)).toEqual([1, 2]);
    });

    test('part a, drained, runs from Wilderness 20 and teleports: no altar op, no walk to the church', async () => {
        const [a] = splitLeg(T1415(), 1, H11R);
        const sdk = new FakeSdk(state(3288, 3660, { prayers: prayers(20), nearbyLocs: [ALTAR] as never, inventory: [...ARDOUGNE_RUNES, item(3, 'Shark', 2)] }));
        serveTeleport(sdk, SPELLS.ardougne.landing);
        const sim = simulateWalking(sdk);
        await drive(sdk, a.run(ctxFor(sdk)));
        expect(arrived(a.def, sdk.state!)).toBe(true);
        expect(sdk.sent.some(x => x.method === 'sendInteractLoc')).toBe(false);
        expect(sim.clicks.filter(inChurch)).toEqual([]);
        expect(sdk.state!.prayers.prayerPoints).toBe(20);
    });

    test('prayer drained: the leg walks into the church, prays, and runs on to the Khazard tree with the points at the level', async () => {
        const l = fromLanding();
        const sdk = new FakeSdk(landing(20));
        const prayed = serveAltar(sdk);
        simulateWalking(sdk);
        const ctx = ctxFor(sdk);
        await drive(sdk, l.run(ctx));
        expect(prayed).toHaveLength(1);
        expect(sdk.sent.find(x => x.method === 'sendInteractLoc')!.args).toEqual([2617, 3309, 409, 1]);
        expect(sdk.state!.prayers.prayerPoints).toBe(99);
        expect(inArea(sdk.state!, TILES.khazardTree)).toBe(true);
        // The altar op went out from the aisle head, and the walk to the tree only after it.
        const op = sdk.sent.findIndex(x => x.method === 'sendInteractLoc');
        expect(sdk.sent.slice(op + 1).some(x => x.method === 'sendWalk')).toBe(true);
        const [rec] = stopsOf(ctx)!;
        expect(rec).toMatchObject({ at: 0, label: 'East Ardougne church altar', made: true, ok: true, before: 'Prayer 20 of 99', after: 'Prayer 99 of 99' });
        expect(rec!.ticks).toBeGreaterThan(0);
    });

    test('prayer full: no altar steps at all, 0 ticks, the first click straight for the tree', async () => {
        const l = fromLanding();
        const sdk = new FakeSdk(landing(99));
        const prayed = serveAltar(sdk);
        const sim = simulateWalking(sdk);
        const ctx = ctxFor(sdk);
        await drive(sdk, l.run(ctx));
        expect(prayed).toEqual([]);
        expect(sdk.sent.some(x => x.method === 'sendInteractLoc')).toBe(false);
        expect(sim.clicks.filter(inChurch)).toEqual([]);
        expect(sim.clicks[0]!.tick).toBe(100);
        expect(inArea(sdk.state!, TILES.khazardTree)).toBe(true);
        expect(stopsOf(ctx)).toEqual([{ at: 0, label: 'East Ardougne church altar', made: false, ok: true, ticks: 0, before: 'Prayer 99 of 99' }]);
    });

    test('a door shut on the way to the altar is opened by the walk, then the leg prays', async () => {
        const l = fromLanding();
        const sdk = new FakeSdk(landing(20, { nearbyLocs: [ALTAR, door(false)] as never }));
        let open = false;
        const prev = sdk.onSend;
        sdk.onSend = (a, f) => {
            prev(a, f);
            if (a.method === 'sendInteractLoc' && a.args[2] === 1530) {
                open = true;
                queueMicrotask(() => f.tick(s => ({ nearbyLocs: s.nearbyLocs.map(x => (x.id === 1530 ? door(true) : x)) as never })));
            }
        };
        const prayed = serveAltar(sdk);
        simulateWalking(sdk, { blocked: (x, z) => !open && x === DOOR_AT.x && z === DOOR_AT.z });
        const ctx = ctxFor(sdk);
        await drive(sdk, l.run(ctx));
        const ops = sdk.sent.filter(x => x.method === 'sendInteractLoc').map(x => x.args[2]);
        expect(ops[0]).toBe(1530);
        expect(ops.at(-1)).toBe(409);
        expect(prayed).toHaveLength(1);
        expect(sdk.state!.prayers.prayerPoints).toBe(99);
        expect(inArea(sdk.state!, TILES.khazardTree)).toBe(true);
        expect(stopsOf(ctx)![0]!.doors).toMatchObject([{ x: DOOR_AT.x, z: DOOR_AT.z, id: 1530, state: 'closed' }]);
    });

    test('an altar that never refills fails the leg, naming the altar and the points', async () => {
        const l = fromLanding();
        const sdk = new FakeSdk(landing(20));
        simulateWalking(sdk);
        await expect(drive(sdk, l.run(ctxFor(sdk)))).rejects.toThrow(/^T14-15b: East Ardougne church altar: Altar at 2617,3309 left Prayer 20 of 99 after 20 ticks$/);
    });

    test('a stop must come before one of the leg hops', () => {
        expect(() => leg('TX', TILES.doric, TILES.doric, [{ kind: 'run', to: TILES.doric }], {
            after: 'A', before: 'B', method: 'm', stops: [{ ...CHURCH_ALTAR, before: 1 }], expected: { ticks: 1, label: 'i', source: 'test', net: 1 },
        })).toThrow("TX: stop 'East Ardougne church altar' comes before hop 1 of 1");
    });
});

describe("a death on a leg (rs/709 on rs/593's relocation detector)", () => {
    const legTo = (to: { x: number; z: number }, hops: Hop[], start = { x: 3240, z: 3250 }) => leg('TX', { ...start, tol: 1 }, { ...to, tol: 1 }, hops, {
        after: 'A', before: 'B', method: 'test', expected: { ticks: 1, label: 'i', source: 'test', net: 1 },
    });
    const north = legTo({ x: 3240, z: 3300 }, [{ kind: 'run', to: { x: 3240, z: 3300, tol: 1 } }]);
    const ctxDied = (sdk: FakeSdk) => ctxFor(sdk) as StepContext<unknown> & { session: RunnerSession };

    test('the run hop lands on the respawn with hp at 0 before it: the leg fails DIED, recorded on the session', async () => {
        const sdk = new FakeSdk(state(3240, 3250));
        simulateWalking(sdk);
        const ctx = ctxDied(sdk);
        const dying = (s: BotWorldState): Partial<BotWorldState> => {
            const t = s.tick + 1;
            if (t === 104 || t === 105) return { player: { ...s.player!, hp: 0 } };
            if (t === 106) return { player: { ...s.player!, ...player(3222, 3218), hp: 40 } };
            return {};
        };
        await expect(drive(sdk, north.run(ctx), 600, dying)).rejects.toThrow(/^TX: SCORED died on TX: \(3240,32\d\d,0\) on tick 105 to \(32\d\d,32\d\d,0\) on tick \d+ \(dead, respawn-tile; hp 40 at the start, lowest 0, /);
        expect(ctx.session.died).toMatchObject({ signs: ['dead', 'respawn-tile'], tick: 104, hpMin: 0 });
        const row = ctx.log.rows.find(r => r.kind === 'travel')!;
        expect(row.ok).toBe(false);
        expect(row.error).toMatch(/^run to 3240,3300: relocated from 3240,32\d\d to 3222,3218: respawn \(\d+ tiles in 1 tick; hp 0 before it, lowest 0\)$/);
    });

    test('a long jump off the route that is not a respawn re-paths as before and the leg arrives', async () => {
        const sdk = new FakeSdk(state(3240, 3250));
        simulateWalking(sdk);
        const ctx = ctxDied(sdk);
        const pushed = (s: BotWorldState): Partial<BotWorldState> => (s.tick + 1 === 104 ? { player: { ...s.player!, ...player(3200, 3260) } } : {});
        const r = await drive(sdk, runLeg(north.def, ctx), 600, pushed);
        expect(r?.ok).toBe(true);
        expect(r?.relocated).toMatchObject({ respawn: false, to: { x: 3200, z: 3260 } });
        expect(inArea(sdk.state!, { x: 3240, z: 3300, tol: 1 })).toBe(true);
        expect(ctx.session.died).toBeUndefined();
    });

    test('a forced teleport onto the respawn square mid-run, hp as it was, re-paths: not a death', async () => {
        const sdk = new FakeSdk(state(3240, 3250));
        simulateWalking(sdk);
        const ctx = ctxDied(sdk);
        const pushed = (s: BotWorldState): Partial<BotWorldState> => (s.tick + 1 === 104 ? { player: { ...s.player!, ...player(3222, 3218), hp: s.player!.hp } } : {});
        const r = await drive(sdk, runLeg(north.def, ctx), 600, pushed);
        expect(r?.ok).toBe(true);
        expect(r?.relocated).toMatchObject({ respawn: true });
        expect(ctx.session.died).toBeUndefined();
    });

    test('a Lumbridge Teleport hop lands on the respawn square and is never flagged', async () => {
        const runes = [item(0, 'Earth rune', 1), item(1, 'Air rune', 3), item(2, 'Law rune', 1)];
        const sdk = new FakeSdk(state(3240, 3250, { inventory: runes }));
        serveTeleport(sdk, SPELLS.lumbridge.landing);
        const ctx = ctxDied(sdk);
        const home = legTo(SPELLS.lumbridge.landing, [{ kind: 'teleport', spell: 'lumbridge' }]);
        const r = await drive(sdk, runLeg(home.def, ctx));
        expect(r?.ok).toBe(true);
        expect(inArea(sdk.state!, SPELLS.lumbridge.landing)).toBe(true);
        expect(ctx.session.died).toBeUndefined();
    });
});

// ------------------------------------------------------------------ the leg upkeep under poison

describe("the leg upkeep under poison (attempt 4: T14-15b reached hpMin 1 with 3 sharks held and 0 eaten; rs/762)", () => {
    const MAX_HP = 40;
    const shark = (slot: number): InventoryItem => ({ slot, id: 385, name: 'Shark', count: 1, optionsWithIndex: [{ text: 'Eat', opIndex: 1 }] }) as unknown as InventoryItem;
    const superAnti = (slot: number, doses = 4): InventoryItem => ({ slot, id: 2448, name: `Superantipoison(${doses})`, count: 1, optionsWithIndex: [{ text: 'Drink', opIndex: 1 }] }) as unknown as InventoryItem;
    /** spirit_tree.rs2's locs: 1317 a young tree (village only), 1294 the village's tree (`stronghold_ent`). */
    const tree = (id: number, x: number, z: number) => ({ id, x, z, level: 0, name: 'Spirit tree', distance: 1, options: ['Talk-to'], optionsWithIndex: [{ text: 'Talk-to', opIndex: 1 }] }) as unknown as NearbyLoc;
    const YOUNG_TREE = tree(1317, TILES.khazardTree.x + 1, TILES.khazardTree.z + 1);
    const VILLAGE_TREE = tree(1294, SPIRIT_TREES.village.landing.x, SPIRIT_TREES.village.landing.z + 1);
    const T14_15B = () => splitLeg(legById('T14-15'), 1, { firstTicks: 70 })[1];

    interface PoisonSim {
        eats: number[];
        drinks: number[];
        /** The lowest hitpoints any published frame showed. */
        hpMin: number;
        /** The lowest hitpoints a frame showed from the first eat's heal on (rs/764's acceptance: never under the floor after it). */
        hpMinAfterEat: number;
        treeClicks: number[];
        rides: number[];
    }

    /**
     * The poison and the transports, frame by frame. Poison: poison.rs2's [timer,poison], a hit of
     * (severity + 4) / 5 every `every` ticks from `firstAt`, the severity down by 1 a hit, each one a
     * damage_taken with hitmark 2. A Shark eaten heals 20 on the next frame; an antipoison drunk ends
     * the poison and leaves the potion a dose less. A spirit tree interact lands `rideTicks` later on
     * its landing (the young tree to the village, the village's tree to the stronghold).
     */
    function poisonWorld(sdk: FakeSdk, walk: WalkSim, o: { severity: number; firstAt: number; every?: number; rideTicks?: number }): { sim: PoisonSim; each: (s: BotWorldState) => Partial<BotWorldState> } {
        let severity = o.severity;
        let nextHit = o.firstAt;
        let eat: number | null = null;
        let drink: number | null = null;
        let ride: { at: number; to: Area; locs: NearbyLoc[] } | null = null;
        const sim: PoisonSim = { eats: [], drinks: [], hpMin: sdk.state!.player!.hp, hpMinAfterEat: Infinity, treeClicks: [], rides: [] };
        let healed = false;
        const prev = sdk.onSend;
        sdk.onSend = (a, f) => {
            prev(a, f);
            const t = f.state!.tick;
            if (a.method === 'sendUseItem') {
                const it = f.state!.inventory.find(i => i.slot === a.args[0]);
                if (it && /^shark$/i.test(it.name)) { sim.eats.push(t); eat = it.slot; }
                if (it && /antipoison/i.test(it.name)) { sim.drinks.push(t); drink = it.slot; }
            }
            if (a.method === 'sendInteractLoc' && (a.args[2] === 1317 || a.args[2] === 1294)) {
                sim.treeClicks.push(t);
                const village = a.args[2] === 1317;
                ride ??= { at: t + (o.rideTicks ?? 4), to: SPIRIT_TREES[village ? 'village' : 'stronghold'].landing, locs: village ? [VILLAGE_TREE] : [] };
            }
        };
        const each = (s: BotWorldState): Partial<BotWorldState> => {
            const t = s.tick + 1;
            const p = s.player!;
            let hp = p.hp;
            let inventory = s.inventory;
            let combatEvents = s.combatEvents;
            if (eat !== null) {
                const slot = eat;
                inventory = inventory.filter(i => i.slot !== slot);
                hp = Math.min(p.maxHp, hp + 20);
                eat = null;
                healed = true;
            }
            if (drink !== null) {
                const slot = drink;
                inventory = inventory.flatMap(i => {
                    if (i.slot !== slot) return [i];
                    const n = Number(/\((\d)\)$/.exec(i.name)![1]);
                    return n > 1 ? [{ ...i, name: i.name.replace(/\(\d\)$/, `(${n - 1})`) }] : [];
                });
                severity = 0;
                drink = null;
            }
            if (severity > 0 && t >= nextHit) {
                const damage = Math.floor((severity + 4) / 5);
                hp = Math.max(0, hp - damage);
                severity--;
                nextHit = t + (o.every ?? 30);
                const hit = { tick: t, type: 'damage_taken', damage, sourceType: 'npc', sourceIndex: -1, targetType: 'player', targetIndex: -1, hitmark: 2 };
                combatEvents = [...combatEvents, hit as unknown as CombatEvent];
            }
            let player = { ...p, hp };
            const more: Partial<BotWorldState> = {};
            if (ride && t >= ride.at) {
                player = { ...player, worldX: ride.to.x, worldZ: ride.to.z, x: ride.to.x, z: ride.to.z };
                more.nearbyLocs = ride.locs;
                walk.target = null;
                sim.rides.push(t);
                ride = null;
            }
            sim.hpMin = Math.min(sim.hpMin, hp);
            if (healed) sim.hpMinAfterEat = Math.min(sim.hpMinAfterEat, hp);
            return { player, inventory, combatEvents, ...more };
        };
        return { sim, each };
    }

    const at = (x: number, z: number, hp: number, more: Partial<BotWorldState> = {}) =>
        state(x, z, { player: { ...player(x, z), hp, maxHp: MAX_HP }, prayers: { activePrayers: [], prayerPoints: 99, prayerLevel: 99 } as never, ...more });
    const travelRow = (ctx: StepContext<unknown>) => ctx.log.rows.find(r => r.kind === 'travel')!.meta as { ate: number; cured?: number; hpMin: number; start?: LegStart };

    test('the floor rule: eat at or under 25 at SCORED\'s maximum (15 + one poison hit 6 + one hit 4), 10 under a small maximum, never under the old rule', () => {
        expect(eatAt(40)).toBe(25);
        expect(eatAt(99)).toBe(25);
        expect(eatAt(30)).toBe(20);
        expect(eatAt(20)).toBe(14);
        expect(LEG_URGENT_HP).toBe(21);
        const s = (hp: number) => at(3288, 3660, hp, { inventory: [shark(3)] });
        expect(eatDue(s(25), {}, -99)?.name).toBe('Shark');
        expect(eatDue(s(26), {}, -99)).toBeNull();
        expect(eatDue(s(25), {}, s(25).tick - 2)).toBeNull();
        // An explicit `below` keeps its meaning: under it.
        expect(eatDue(s(14), { below: 15 }, -99)?.name).toBe('Shark');
        expect(eatDue(s(15), { below: 15 }, -99)).toBeNull();
    });

    test('a leg poisoned from 20 HP on its tree rides eats before 15 and never reaches 1, the eat landing inside a ride', async () => {
        const rides = leg('TX', TILES.khazardTree, { ...SPIRIT_TREES.stronghold.landing }, [{ kind: 'tree', to: 'village' }, { kind: 'tree', to: 'stronghold' }], {
            after: 'A', before: 'B', method: 'two tree rides', hostile: true, expected: { ticks: 10, label: 'i', source: 'test', net: 10 },
        });
        // 27 HP: above the floor rule, so no eat before the first ride; the poison takes 6 inside it.
        const sdk = new FakeSdk(at(TILES.khazardTree.x, TILES.khazardTree.z, 27, { inventory: [shark(3), shark(4), shark(5)], nearbyLocs: [YOUNG_TREE] }));
        const walk = simulateWalking(sdk);
        const { sim, each } = poisonWorld(sdk, walk, { severity: 27, firstAt: 102, every: 3, rideTicks: 6 });
        const ctx = ctxFor(sdk);
        await drive(sdk, rides.run(ctx), 200, each);
        expect(inArea(sdk.state!, SPIRIT_TREES.stronghold.landing)).toBe(true);
        expect(sim.rides).toHaveLength(2);
        expect(sim.eats.length).toBeGreaterThanOrEqual(1);
        // The first eat goes while the first ride is under way: after its click, before its landing.
        expect(sim.eats[0]!).toBeGreaterThan(sim.treeClicks[0]!);
        expect(sim.eats[0]!).toBeLessThan(sim.rides[0]!);
        expect(sim.hpMin).toBeGreaterThanOrEqual(HP_FLOOR);
        expect(travelRow(ctx).ate).toBe(sim.eats.length);
    });

    test("T14-15b as attempt 4 ran it: poisoned at 20 HP from the landing with 3 sharks, the run, both tree rides and the run to the door; it ends above the floor", async () => {
        const b = T14_15B();
        expect(b.def.hops.map(h => h.kind)).toEqual(['run', 'tree', 'tree', 'run']);
        expect(b.def.food).toBeUndefined();
        const landing = SPELLS.ardougne.landing;
        const sdk = new FakeSdk(at(landing.x, landing.z, 20, { inventory: [shark(3), shark(4), shark(5)], nearbyLocs: [YOUNG_TREE] }));
        const walk = simulateWalking(sdk);
        const { sim, each } = poisonWorld(sdk, walk, { severity: 27, firstAt: 103 });
        const ctx = ctxFor(sdk);
        await drive(sdk, b.run(ctx), 400, each);
        expect(arrived(b.def, sdk.state!)).toBe(true);
        expect(sim.rides).toHaveLength(2);
        expect(sim.eats.length).toBeGreaterThanOrEqual(1);
        expect(sim.hpMin).toBeGreaterThanOrEqual(HP_FLOOR);
        expect(sdk.state!.player!.hp).toBeGreaterThan(HP_FLOOR);
        const row = travelRow(ctx);
        expect(row.hpMin).toBeGreaterThanOrEqual(HP_FLOOR);
        expect(row.ate).toBe(sim.eats.length);
    });

    test('no food held: part a refuses as today, part b (no food check) travels and eats nothing', async () => {
        const [a, b] = splitLeg(legById('T14-15'), 1, { firstTicks: 70 });
        expect(legPreconditions(a.def, at(3288, 3700, 30, { inventory: ARDOUGNE_RUNES }))).toBe('T14-15a: 0 food held, 2 needed');
        const landing = SPELLS.ardougne.landing;
        const sdk = new FakeSdk(at(landing.x, landing.z, 30, { nearbyLocs: [YOUNG_TREE] }));
        const walk = simulateWalking(sdk);
        const { sim, each } = poisonWorld(sdk, walk, { severity: 0, firstAt: 9999 });
        const ctx = ctxFor(sdk);
        await drive(sdk, b.run(ctx), 400, each);
        expect(arrived(b.def, sdk.state!)).toBe(true);
        expect(sim.eats).toEqual([]);
        expect(travelRow(ctx).ate).toBe(0);
    });

    test('the upkeep holds an eat while a chat is open above LEG_URGENT_HP and sends it at or under; the antipoison always waits for the chat', () => {
        const sdk = new FakeSdk(at(2555, 3259, 24, { inventory: [shark(3), superAnti(4)] }));
        let sick = true;
        const cure = { poisoned: () => sick, cureDose: (s: BotWorldState) => s.inventory.find(i => /antipoison/i.test(i.name)) ?? null, noteAntipoison: () => { sick = false; } };
        const u = new WaitUpkeep(sdk, { holdInDialog: true, urgentHp: LEG_URGENT_HP, cure });
        const chat = (hp: number, tick: number, isOpen: boolean) => ({ ...sdk.state!, tick, player: { ...sdk.state!.player!, hp }, dialog: { ...sdk.state!.dialog, isOpen } });
        u.see(chat(24, 100, true));
        u.see(chat(30, 101, true));
        expect(sdk.sent).toEqual([]);
        u.see(chat(21, 102, true));
        expect(sdk.sent).toEqual([{ method: 'sendUseItem', args: [3, 1] }]);
        u.see(chat(40, 110, true));
        expect(sdk.sent).toHaveLength(1);
        u.see(chat(40, 111, false));
        expect(sdk.sent.at(-1)).toEqual({ method: 'sendUseItem', args: [4, 1] });
        expect([u.eats, u.cures]).toEqual([1, 1]);
    });

    test('a poisoned leg drinks one antipoison dose, once, and the poison stops', async () => {
        const b = T14_15B();
        const landing = SPELLS.ardougne.landing;
        // A tick base past every other test's: segments.ts keeps the run's last dose for the process.
        const base = 300_000;
        const sdk = new FakeSdk(at(landing.x, landing.z, 35, { tick: base, inventory: [shark(3), shark(4), superAnti(5)], nearbyLocs: [YOUNG_TREE] }));
        const walk = simulateWalking(sdk);
        const { sim, each } = poisonWorld(sdk, walk, { severity: 27, firstAt: base + 2 });
        const ctx = ctxFor(sdk);
        await drive(sdk, b.run(ctx), 400, each);
        expect(arrived(b.def, sdk.state!)).toBe(true);
        expect(sim.drinks).toHaveLength(1);
        // On the frame the first poison hit shows.
        expect(sim.drinks[0]!).toBe(base + 2);
        expect(sdk.state!.inventory.map(i => i.name)).toContain('Superantipoison(3)');
        expect(travelRow(ctx).cured).toBe(1);
        expect(sim.hpMin).toBeGreaterThanOrEqual(HP_FLOOR);
    });
});

// ------------------------------------------------------------------ the hostile legs' start floor

describe("the hostile legs' start floor (main 19:1xZ; rs/764's run 1: T14-15b from 12 of 42 HP with 7 sharks, ate nothing, dead after a tree ride)", () => {
    const MAX_HP = 42;
    const fish = (slot: number, name = 'Shark'): InventoryItem => ({ slot, id: 385 + slot, name, count: 1, optionsWithIndex: [{ text: 'Eat', opIndex: 1 }] }) as unknown as InventoryItem;
    const sharks = (n: number) => Array.from({ length: n }, (_, i) => fish(3 + i));
    const YOUNG = { id: 1317, x: TILES.khazardTree.x + 1, z: TILES.khazardTree.z + 1, level: 0, name: 'Spirit tree', distance: 1, options: ['Talk-to'], optionsWithIndex: [{ text: 'Talk-to', opIndex: 1 }] } as unknown as NearbyLoc;
    const landing = SPELLS.ardougne.landing;
    const T14_15B = () => splitLeg(legById('T14-15'), 1, { firstTicks: 70 })[1];
    const at = (hp: number, inventory: InventoryItem[], more: Partial<BotWorldState> = {}) =>
        state(landing.x, landing.z, { player: { ...player(landing.x, landing.z), hp, maxHp: MAX_HP }, prayers: { activePrayers: [], prayerPoints: 99, prayerLevel: 99 } as never, inventory, nearbyLocs: [YOUNG], ...more });
    const travelRow = (ctx: StepContext<unknown>) => ctx.log.rows.find(r => r.kind === 'travel')?.meta as { ate: number; hpMin: number; start?: LegStart } | undefined;

    test('the hostile legs are the table\'s food legs, both parts of a split one, and no other', () => {
        expect(hostileLegIds(LEGS)).toEqual(['T13-14', 'T14-15', 'T15-16', 'T26-27', 'T27-17']);
        expect(hostileLegIds(legsFor({ s21Altar: 'body' }))).toEqual(hostileLegIds(LEGS));
        expect(hostileLegIds(splitLeg(legById('T14-15'), 1, { firstTicks: 70 }))).toEqual(['T14-15a', 'T14-15b']);
        expect(hostileLegIds(splitLeg(legById('T15-16'), 0))).toEqual(['T15-16a', 'T15-16b']);
    });

    test('the floor is the eat line, 25 at SCORED\'s 38-42, never above the maximum', () => {
        expect([startFloor(38), startFloor(42), startFloor(99)]).toEqual([25, 25, 25]);
        expect(startFloor(30)).toBe(20);
        expect(startFloor(12)).toBe(12);
    });

    test('a start under the floor that the food held cannot heal to is refused by name, at the boundary; a non-hostile leg is not judged', () => {
        const b = T14_15B().def;
        expect(startFloorShort(b, at(12, []))).toBe("T14-15b: 12 HP, and the 0 food held heals 0, short of the leg's start floor of 25");
        expect(legPreconditions(b, at(12, [fish(3, 'Trout')]))).toBe("T14-15b: 12 HP, and the 1 food held heals 7, short of the leg's start floor of 25");
        expect(legPreconditions(b, at(12, [fish(3, 'Trout'), fish(4, 'Trout')]))).toBe(true);
        expect(legPreconditions(b, at(12, sharks(1)))).toBe(true);
        expect(legPreconditions(b, at(25, []))).toBe(true);
        expect(startFloorShort(legById('T12-13').def, at(3, []))).toBeNull();
    });

    test("rs/764's shape: T14-15b from 12 HP with 7 sharks, poisoned, eats to the floor before the first hop and never falls under it after", async () => {
        const b = T14_15B();
        const sdk = new FakeSdk(at(12, sharks(7)));
        const walk = simulateWalking(sdk);
        const eats: number[] = [];
        const firstMove: number[] = [];
        let eat: number | null = null;
        let nextHit = 103;
        let ride: { at: number; to: Area } | null = null;
        let healed = false;
        let hpAfter = Infinity;
        const prev = sdk.onSend;
        sdk.onSend = (a, f) => {
            prev(a, f);
            const t = f.state!.tick;
            if (a.method === 'sendUseItem') {
                eats.push(t);
                eat = a.args[0] as number;
            } else if (!firstMove.length) firstMove.push(t);
            if (a.method === 'sendInteractLoc' && (a.args[2] === 1317 || a.args[2] === 1294)) {
                const village = a.args[2] === 1317;
                ride ??= { at: t + 4, to: SPIRIT_TREES[village ? 'village' : 'stronghold'].landing };
            }
        };
        const each = (s: BotWorldState): Partial<BotWorldState> => {
            const t = s.tick + 1;
            let { hp } = s.player!;
            let inventory = s.inventory;
            if (eat !== null) {
                const slot = eat;
                inventory = inventory.filter(i => i.slot !== slot);
                hp = Math.min(MAX_HP, hp + 20);
                eat = null;
                healed = true;
            }
            // Poison at severity 27 every 10 ticks (a hit of 6, then 6, 5 ...) and a 3 from a trooper each 4 ticks: far over rs/764's rate.
            if (t >= nextHit) {
                hp -= 6;
                nextHit = t + 10;
            }
            if (t % 4 === 0) hp -= 3;
            hp = Math.max(0, hp);
            let player = { ...s.player!, hp };
            const more: Partial<BotWorldState> = {};
            if (ride && t >= ride.at) {
                player = { ...player, worldX: ride.to.x, worldZ: ride.to.z, x: ride.to.x, z: ride.to.z };
                more.nearbyLocs = ride.to === SPIRIT_TREES.village.landing ? [{ ...YOUNG, id: 1294, x: ride.to.x, z: ride.to.z + 1 }] : [];
                walk.target = null;
                ride = null;
            }
            if (healed) hpAfter = Math.min(hpAfter, hp);
            return { player, inventory, ...more };
        };
        const ctx = ctxFor(sdk);
        await drive(sdk, b.run(ctx), 600, each);
        expect(arrived(b.def, sdk.state!)).toBe(true);
        // The first eat goes on the leg's first frame, and the first hop's click only once the heal shows.
        expect(eats[0]).toBe(100);
        expect(firstMove[0]!).toBeGreaterThan(eats[0]!);
        expect(travelRow(ctx)!.start).toEqual({ hp: 12, floor: 25, reached: 32, ticks: 1 });
        expect(hpAfter).toBeGreaterThanOrEqual(HP_FLOOR);
        expect(sdk.state!.player!.hp).toBeGreaterThan(0);
    });

    test('at or above the floor the start costs 0 ticks and eats nothing first', async () => {
        const b = T14_15B();
        const sdk = new FakeSdk(at(25, sharks(2)));
        const sends: string[] = [];
        const prev = sdk.onSend;
        sdk.onSend = (a, f) => {
            prev(a, f);
            sends.push(`${f.state!.tick} ${a.method}`);
        };
        simulateWalking(sdk);
        const ctx = ctxFor(sdk);
        // No ride is simulated: the leg ends failing at the young tree, its travel row written.
        await drive(sdk, b.run(ctx).catch(() => {}), 400);
        // The upkeep eats 25 on the first frame as ever, beside the first hop's click: no wait between.
        expect(sends.filter(x => x.startsWith('100 '))).toContain('100 sendUseItem');
        expect(sends.some(x => x.startsWith('100 ') && !x.endsWith('sendUseItem'))).toBe(true);
        expect(travelRow(ctx)?.start).toBeUndefined();
    });

    test('a resumed hostile leg (no precondition check) under the floor with too little food refuses before it sends anything', async () => {
        const b = T14_15B();
        const sdk = new FakeSdk(at(12, [fish(3, 'Trout')]));
        const ctx = ctxFor(sdk);
        await expect(drive(sdk, b.resume!(ctx), 20)).rejects.toThrow("T14-15b: 12 HP, and the 1 food held heals 7, short of the leg's start floor of 25");
        // The upkeep's first-frame eat (the trout) is the only click: no hop went.
        expect(sdk.sent.every(a => a.method === 'sendUseItem')).toBe(true);
    });
});
