import { describe, expect, test } from 'bun:test';
import { LOW_SITES, SITES } from '../methods/hp-train.ts';
import { defaultCaps, HpSites } from './hp-sites.ts';

describe('Hitpoints sites', () => {
    test('default caps: each low site its supply over 0.25, at least 1', () => {
        const caps = defaultCaps();
        expect(Object.keys(caps).sort()).toEqual([...LOW_SITES].sort());
        expect(caps).toMatchObject({ cows: 4, goblins: 3, chickens: 2, farm: 4, champions: 2, crafting: 4, sarim: 2 });
        expect(new HpSites(caps).capacity()).toBe(21);
    });

    test('accounts spread by supply per bot, never past a cap; full means null until one leaves', () => {
        const s = new HpSites({ cows: 2, farm: 1, sarim: 1 });
        // farm 0.98 > cows 0.89 > cows/2 0.445 = sarim 0.43 ...
        expect(['a', 'b', 'c', 'd'].map(a => s.take(a))).toEqual(['farm', 'cows', 'cows', 'sarim']);
        expect(s.take('e')).toBeNull();
        expect(s.hasRoom()).toBe(false);
        expect(s.take('b')).toBe('cows'); // an account keeps its site
        s.release('b');
        expect(s.hasRoom()).toBe(true);
        expect(s.take('e')).toBe('cows');
        expect(s.occupancy()).toEqual({ cows: 2, farm: 1, sarim: 1 });
    });

    test('a closed site takes nobody', () => {
        const s = new HpSites({ cows: 0, goblins: 1 });
        expect(s.take('a')).toBe('goblins');
        expect(s.take('b')).toBeNull();
        expect(s.occupancy()).toEqual({ goblins: 1 });
    });

    test('every low site: positive supply, its centre inside its area, no Kandarin crossing', () => {
        for (const id of LOW_SITES) {
            const x = SITES[id];
            expect(x.supply).toBeGreaterThan(0);
            expect(x.kandarin).toBe(false);
            expect(x.centre.x >= x.area.x1 && x.centre.x <= x.area.x2 && x.centre.z >= x.area.z1 && x.centre.z <= x.area.z2).toBe(true);
        }
    });
});
