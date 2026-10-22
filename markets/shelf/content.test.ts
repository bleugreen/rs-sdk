import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_SCRIPTS, chooseInv, contentNpcShops, loadContent, parseInvConfigs, parseNpcShops } from './content';
import { STOPS } from './stops';

describe('content parsing', () => {
    test('inventory stock lines', () => {
        const invs = parseInvConfigs('[runeshop]\nscope=shared\nstock1=firerune,2000,10\nstock2=deathrune,1000\n\n[other]\nsize=4\n');
        expect(invs.get('runeshop')).toEqual([
            { obj: 'firerune', count: 2000, rate: 10 },
            { obj: 'deathrune', count: 1000, rate: 0 }
        ]);
        expect(invs.get('other')).toEqual([]);
    });

    test('shop-owning NPCs', () => {
        expect(parseNpcShops('[betty]\nname=Betty\nop3=Trade\nparam=owned_shop,magicshop\n[guard]\nname=Guard\n')).toEqual([{ debug: 'betty', name: 'Betty', inv: 'magicshop' }]);
    });

    test('of several inventories, the one whose stock is on the shelf', () => {
        const content = { stock: (inv: string) => (inv === 'staffshop' ? [{ obj: 'plainstaff', count: 5, rate: 1 }] : [{ obj: 'plainstaff', count: 5, rate: 1 }, { obj: 'battlestaff', count: 5, rate: 1 }]), objName: () => undefined };
        expect(chooseInv(['memberstaffshop', 'staffshop'], content, ['plainstaff', 'battlestaff'])).toBe('memberstaffshop');
        expect(chooseInv(['staffshop'], content, [])).toBe('staffshop');
    });
});

describe('the stop table against this checkout', () => {
    const content = loadContent();
    const npcs = contentNpcShops();

    test('every stop names inventories the content defines', () => {
        for (const s of Object.values(STOPS)) for (const inv of s.inv) expect({ stop: s.key, inv, defined: content.stock(inv) !== undefined }).toEqual({ stop: s.key, inv, defined: true });
    });

    test("each stop's shopkeeper owns its inventory", () => {
        for (const s of Object.values(STOPS)) {
            if (s.key === 'zaff') continue; // opened by zaff.rs2, below
            const owners = npcs.filter(n => s.npc.test(n.name));
            expect({ stop: s.key, owns: owners.some(n => n.inv === s.inv[0]) }).toEqual({ stop: s.key, owns: true });
        }
        const zaff = readFileSync(join(CONTENT_SCRIPTS, 'areas', 'area_varrock', 'scripts', 'zaff.rs2'), 'utf8');
        for (const inv of STOPS.zaff.inv) expect(zaff).toContain(`~openshop(${inv},`);
    });

    test('object names come from obj.pack', () => {
        expect(content.objName(554)).toBe('firerune');
        expect(content.objName(560)).toBe('deathrune');
    });
});
