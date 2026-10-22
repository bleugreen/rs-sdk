import { describe, expect, test } from 'bun:test';
import { xpForLevel } from '../lib/xp';
import { BAND_ENDS, bands, LOAD, loadFor, nextAction, resolveOptions, steps, XP_PER_ESSENCE, type TripView } from './rc-solo';

const TARGET = xpForLevel(99);
const view = (v: Partial<TripView> = {}): TripView => ({ xp: 0, inRoom: false, essence: 0, talisman: true, ...v });

describe('loadFor', () => {
    test('a full load until the last trip, which takes only what reaches the target', () => {
        expect(XP_PER_ESSENCE).toBe(125);
        expect(loadFor(0, TARGET)).toBe(LOAD);
        // 7,988 essence from 0 xp to 99 (rs/455): 295 full loads and 23 on the last trip.
        expect(Math.ceil(TARGET / XP_PER_ESSENCE)).toBe(7988);
        expect(loadFor(295 * LOAD * XP_PER_ESSENCE, TARGET)).toBe(23);
        expect(loadFor(TARGET - 1, TARGET)).toBe(1);
        expect(loadFor(TARGET, TARGET)).toBe(0);
    });
});

describe('nextAction: the trip state', () => {
    const o = { targetXp: TARGET, bankEssence: 5000 };
    test('in the room with essence: craft', () => {
        expect(nextAction(view({ inRoom: true, essence: 27 }), o)).toEqual({ kind: 'craft' });
        // a partial load still crafts (resumed mid-trip, or the last trip)
        expect(nextAction(view({ inRoom: true, essence: 3 }), o)).toEqual({ kind: 'craft' });
    });
    test('outside with a load and the talisman: enter', () => {
        expect(nextAction(view({ essence: 27 }), o)).toEqual({ kind: 'enter' });
    });
    test('in the room with nothing left: restock a full load (the portal first)', () => {
        expect(nextAction(view({ inRoom: true, essence: 0, xp: 1000 }), o)).toEqual({ kind: 'restock', essence: LOAD });
    });
    test('outside short of a load: restock tops it up to the load', () => {
        expect(nextAction(view({ essence: 10 }), o)).toEqual({ kind: 'restock', essence: LOAD });
    });
    test('the last trip restocks only what reaches the target', () => {
        const xp = TARGET - 23 * XP_PER_ESSENCE + 1;
        expect(nextAction(view({ xp, inRoom: true }), o)).toEqual({ kind: 'restock', essence: 23 });
        expect(nextAction(view({ xp, essence: 23 }), o)).toEqual({ kind: 'enter' });
    });
    test('at the target: done, wherever the account stands', () => {
        expect(nextAction(view({ xp: TARGET, inRoom: true, essence: 27 }), o)).toEqual({ kind: 'done' });
        expect(nextAction(view({ xp: TARGET + 50, talisman: false }), o)).toEqual({ kind: 'done' });
    });
});

describe('nextAction: restock and refusal when the essence runs out', () => {
    test('before the first bank visit the bank is unknown: restock (the supply arrives there)', () => {
        expect(nextAction(view(), { targetXp: TARGET, bankEssence: null })).toEqual({ kind: 'restock', essence: LOAD });
    });
    test('a bank that can make the load: restock', () => {
        expect(nextAction(view(), { targetXp: TARGET, bankEssence: 27 })).toEqual({ kind: 'restock', essence: LOAD });
        // carried essence counts toward the load
        expect(nextAction(view({ essence: 20 }), { targetXp: TARGET, bankEssence: 7 })).toEqual({ kind: 'restock', essence: LOAD });
    });
    test('a bank short of the load: refuse, naming what is left', () => {
        const a = nextAction(view({ inRoom: true, xp: 10_000 }), { targetXp: TARGET, bankEssence: 26 });
        expect(a.kind).toBe('refuse');
        expect(a.kind === 'refuse' && a.reason).toContain('bank holds 26 rune essence');
        expect(nextAction(view(), { targetXp: TARGET, bankEssence: 0 }).kind).toBe('refuse');
    });
    test('a short bank is enough when it covers the last trip', () => {
        const xp = TARGET - 10 * XP_PER_ESSENCE;
        expect(nextAction(view({ xp }), { targetXp: TARGET, bankEssence: 10 })).toEqual({ kind: 'restock', essence: 10 });
        expect(nextAction(view({ xp }), { targetXp: TARGET, bankEssence: 9 }).kind).toBe('refuse');
    });
    test('no talisman: refuse rather than walk to ruins it cannot enter', () => {
        const a = nextAction(view({ talisman: false, essence: 27 }), { targetXp: TARGET, bankEssence: 5000 });
        expect(a.kind).toBe('refuse');
        expect(a.kind === 'refuse' && a.reason).toContain('talisman');
        // in the room it can still craft what it holds
        expect(nextAction(view({ talisman: false, inRoom: true, essence: 27 }), { targetXp: TARGET, bankEssence: 5000 })).toEqual({ kind: 'craft' });
    });
});

describe('bands and options', () => {
    test('bands run from 1 to the target, contiguous, ending on the band ends below it', () => {
        const all = bands(99);
        expect(all[0]!.from).toBe(1);
        expect(all.at(-1)!.to).toBe(99);
        expect(all.map(b => b.to)).toEqual([...BAND_ENDS]);
        for (let i = 1; i < all.length; i++) expect(all[i]!.from).toBe(all[i - 1]!.to);
        expect(bands(64)).toEqual([{ from: 1, to: 50 }, { from: 50, to: 64 }]);
        expect(bands(30)).toEqual([{ from: 1, to: 30 }]);
    });
    test('options from strings', () => {
        expect(resolveOptions({})).toEqual({ to: 99 });
        expect(resolveOptions({ to: '64', labSeed: '800', courier: '^cairn_h30$' })).toEqual({ to: 64, labSeed: 800, courier: '^cairn_h30$' });
        expect(resolveOptions({ toLevel: 70 })).toEqual({ to: 70 });
        expect(() => resolveOptions({ to: '100' })).toThrow();
        expect(() => resolveOptions({ to: 1 })).toThrow();
        expect(() => resolveOptions({ labSeed: '-5' })).toThrow();
        expect(() => resolveOptions({ courier: '(' })).toThrow();
    });
    test('steps: the talisman, then one logout-safe band step per band, each with done', () => {
        const s = steps({ to: '64' });
        expect(s.map(x => x.name)).toEqual(['rc-solo:talisman', 'rc-solo:air-1-50', 'rc-solo:air-50-64']);
        expect(s.every(x => x.logoutSafe && typeof x.done === 'function')).toBe(true);
    });
});
