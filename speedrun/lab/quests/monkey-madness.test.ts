import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

import { SEGMENTS } from '../../quests/monkey-madness';
import { FIXTURES, fixtureItems, FREE_KEPT, KIT, MM_VARS, remainingKit, slotsNeeded } from './monkey-madness';

const packNames = (kind: string) => new Set(readFileSync(join(import.meta.dir, '..', '..', '..', 'server', 'content', 'pack', `${kind}.pack`), 'utf8').split('\n').map(l => l.slice(l.indexOf('=') + 1).trim()));

describe('fixtures', () => {
    test('one per segment, in order', () => {
        expect(FIXTURES.map(f => f.letter)).toEqual(SEGMENTS.map(s => s.letter));
    });

    test('every var is an MM varp or varbit the engine defines', () => {
        const varbits = readFileSync(join(import.meta.dir, '..', '..', '..', 'server', 'content', 'scripts', 'quests', 'quest_mm', 'configs', 'quest_mm.varbit'), 'utf8');
        for (const v of MM_VARS) expect([v, v === 'mm_main' || varbits.includes(`[${v}]`)]).toEqual([v, true]);
        for (const f of FIXTURES) for (const k of Object.keys(f.vars)) expect(MM_VARS as readonly string[]).toContain(k);
    });

    test('every item is an obj debug name; worn items are given', () => {
        const objs = packNames('obj');
        for (const k of Object.keys(KIT)) expect([k, objs.has(k)]).toEqual([k, true]);
        for (const f of FIXTURES) {
            for (const k of Object.keys(f.items)) expect([f.letter, k, objs.has(k)]).toEqual([f.letter, k, true]);
            for (const w of f.worn ?? []) expect([f.letter, w, w in f.items || w in remainingKit(f.letter)]).toEqual([f.letter, w, true]);
        }
    });

    test('mm_main never decreases along the route', () => {
        const mains = FIXTURES.map(f => f.vars.mm_main ?? 0);
        for (let i = 1; i < mains.length; i++) expect(mains[i]!).toBeGreaterThanOrEqual(mains[i - 1]!);
    });

    test('kit is spent by the segment that uses it', () => {
        expect(remainingKit('L').gold_bar).toBe(1);
        expect(remainingKit('M').gold_bar).toBeUndefined();
        expect(remainingKit('P').banana).toBeUndefined();
        // Z still holds the spare Varrock set (a temple rope pin's escape), on top of Ardougne's last cast.
        expect(remainingKit('Z')).toMatchObject({ lawrune: 3, airrune: 3, firerune: 1, waterrune: 2 });
        expect(remainingKit('A', { sharks: 4 }).shark).toBe(4);
    });

    test('the full H12 kit does not fit 28 slots (the census rs/158 is deciding on)', () => {
        expect(slotsNeeded('A')).toBeGreaterThan(28);
        // With few enough sharks every fixture fits.
        for (const f of FIXTURES) expect([f.letter, slotsNeeded(f.letter, { sharks: 3 }) <= 28]).toEqual([f.letter, true]);
    });

    test('fixture items put the quest items first and fill only the free slots with sharks', () => {
        for (const f of FIXTURES) {
            const items = fixtureItems(f.letter);
            expect(items.slice(0, Object.keys(f.items).length).map(([k]) => k)).toEqual(Object.keys(f.items));
            const sharks = items.find(([k]) => k === 'shark')?.[1] ?? 0;
            expect([f.letter, slotsNeeded(f.letter, { sharks })]).toEqual([f.letter, Math.min(28 - FREE_KEPT, slotsNeeded(f.letter))]);
        }
        expect(fixtureItems('K', { sharks: 2 }).find(([k]) => k === 'shark')).toEqual(['shark', 2]);
    });
});
