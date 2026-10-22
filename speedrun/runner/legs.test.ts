import { describe, expect, test } from 'bun:test';
import type { BotWorldState, InventoryItem, PlayerState } from '../../sdk/types';
import { baseState, drive, FakeSdk, simulateWalking } from '../lib/fake-sdk';
import { TickLog } from '../lib/ticks';
import { inArea, SPELLS } from '../lib/travel';
import { arrived, leg, legById, legPreconditions, LEGS, legsAfter, legsFor, netTotal, resumeHop, runLeg, splitLeg, TILES } from './legs';
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
        const sdk = new FakeSdk(state(TILES.firemakingRow.x, TILES.firemakingRow.z, { inventory: FALADOR_RUNES }));
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

    test('Wilderness level at most 20 when the leg opens with a spell', () => {
        const s = state(3200, 3712, { inventory: [...ARDOUGNE_RUNES, item(4, 'Knife'), item(5, 'Shark'), item(6, 'Shark')] }); // level 25
        expect(pre('T13-14', s)).toBe('T13-14: Wilderness level 25 is above 20 for the ardougne teleport');
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

    test('one leg per id, every RUN-ORDER.md section 2 leg, and the order total: 1,382 + T07a 12 + T16-18 8 = 1,402 ticks', () => {
        const ids = LEGS.map(l => l.def.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toContain('T07a');
        expect(ids.filter(i => i.startsWith('L24'))).toEqual(['L24a', 'L24b', 'L24c']);
        expect(netTotal()).toBe(1402);
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
