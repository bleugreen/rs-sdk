import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { BotWorldState, InventoryItem, PlayerState } from '../../sdk/types';
import { parseLedger, walk, type OutEntry } from '../tools/slot-ledger';
import { parseTiles, resolveOptions, routeLogs } from '../skills/firemaking';
import { baseState, drive, FakeSdk, simulateWalking } from '../lib/fake-sdk';
import { TickLog } from '../lib/ticks';
import { inArea, SPELLS } from '../lib/travel';
import { arrived, dropDue, DROPS_PER_TICK, dropsDue, entersWilderness, leg, legById, legPreconditions, LEGS, legsAfter, legsFor, neededBy, netTotal, resumeHop, runLeg, splitLeg, TILES, type LegStep } from './legs';
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

    test('one leg per id, every RUN-ORDER.md section 2 leg, and the order total: 1,382 + T07a 12 + T16-18 8 + T02-03 43 (5 to 48) = 1,445 ticks', () => {
        const ids = LEGS.map(l => l.def.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toContain('T07a');
        expect(ids.filter(i => i.startsWith('L24'))).toEqual(['L24a', 'L24b', 'L24c']);
        expect(netTotal()).toBe(1445);
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

    test('the pattern takes every bone and nothing else SCORED holds at T07-08; no hop needs a bone', () => {
        const { drops = [], hops } = T0708().def;
        const takes = (name: string) => drops.some(p => p.test(name));
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

    test("T07-08's row drops the S07 last load's <bones>, which the leg's /bones$/i takes; the walk leaves H6 its 12", () => {
        expect(dropsOn('T07-08')).toEqual([{ name: 'bones', placeholder: true, count: 'all', reason: 'drop' }]);
        expect(rows.find(r => r.row === 'S07 last load')!.in).toContainEqual({ name: 'bones', placeholder: true, count: 21, kind: 'u' });
        const entries = walk(rows);
        const at = (row: string) => entries.find(e => e.row.row === row)!;
        expect(at('S07 last load')).toMatchObject({ verdict: 'pass', used: 25 });
        expect(at('T07-08')).toMatchObject({ verdict: 'pass', used: 2, held: 'knife x1, logs x1' });
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
