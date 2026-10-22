import { describe, expect, test } from 'bun:test';

import { allocate, batches, essencePerGiver, giverEntries, launchConfig, provisionPlan, roster, type Stockpile } from './roster';
import { parseLaunchConfig } from './standalone';

describe('roster', () => {
    test('22 primary names in order', () => {
        const r = roster();
        expect(r.accounts.length).toBe(22);
        expect(r.accounts[0]).toBe('cairn_t01');
        expect(r.accounts[21]).toBe('cairn_t22');
        expect(r.substituted).toEqual({});
    });

    test('a refused name keeps its place and takes the next spare', () => {
        const r = roster(22, ['cairn_t05', 'cairn_t23', 'cairn_t09']);
        expect(r.accounts[4]).toBe('cairn_t24');
        expect(r.accounts[8]).toBe('cairn_t25');
        expect(r.substituted).toEqual({ cairn_t05: 'cairn_t24', cairn_t09: 'cairn_t25' });
        expect(new Set(r.accounts).size).toBe(22);
    });

    test('runs out of spares rather than inventing names', () => {
        const six = ['cairn_t01', 'cairn_t02', 'cairn_t03', 'cairn_t04', 'cairn_t05', 'cairn_t06'];
        expect(() => roster(22, six)).toThrow(/ask rs\/41/);
        expect(() => roster(0)).toThrow();
        expect(() => roster(23)).toThrow();
    });
});

describe('launcher entries', () => {
    test('generated configs preserve the direct roster through the real launcher parser', () => {
        const accounts = roster(22, ['cairn_t05']).accounts;
        for (const role of ['idle', 'altar-giver'] as const) {
            const generated = launchConfig(accounts, { role, gatewayPort: 7796 });
            const parsed = parseLaunchConfig(JSON.parse(JSON.stringify(generated)));
            expect(parsed.accounts.map(a => a.account)).toEqual(accounts);
            expect(parsed.accounts.every(a => a.path === 'direct' && a.role === role && !a.receiver && !a.final)).toBe(true);
            expect(parsed.accounts.map(a => a.options)).toEqual(giverEntries(accounts, { role }).map(a => a.options as Record<string, unknown>));
            expect(parsed.gatewayPort).toBe(7796);
            expect(parsed.stopDeadlineMs).toBe(25_000);
        }
    });

    test('run-day givers: body altar, direct path, slots round-robin', () => {
        const e = giverEntries(roster(4).accounts, { role: 'altar-giver', acceptFrom: '^cairn_h31$' });
        expect(e.map(x => (x.options as { slot: number }).slot)).toEqual([0, 1, 2, 0]);
        expect(e[0]).toEqual({ account: 'cairn_t01', role: 'altar-giver', path: 'direct', options: { altar: 'body', slot: 0, essence: 27, restock: { kind: 'bank', acceptFrom: '^cairn_h31$' }, scope: { step: 'S21', family: 'altar' } } });
        expect(giverEntries(['cairn_t01'], { role: 'altar-giver' })[0]!.options).toMatchObject({ restock: { kind: 'bank' } });
        expect(e.every(x => !('receiver' in x) && !('final' in x))).toBe(true);
    });

    test('the load check: idle on the direct path, own gateway port', () => {
        const c = launchConfig(roster().accounts, { role: 'idle', gatewayPort: 7796 }) as { gatewayPort: number; accounts: Record<string, unknown>[] };
        expect(c.gatewayPort).toBe(7796);
        expect(c.accounts.length).toBe(22);
        expect(c.accounts[0]).toEqual({ account: 'cairn_t01', role: 'idle', path: 'direct', options: { heartbeatMinutes: 1 } });
    });
});

describe('provisioning', () => {
    test('batches of at most five', () => {
        expect(batches(roster().accounts).map(b => b.length)).toEqual([5, 5, 5, 5, 2]);
        expect(() => batches([1], 0)).toThrow();
    });

    test('essence: fair share rounded up to whole 27-loads', () => {
        expect(essencePerGiver()).toEqual({ perGiver: 243, trips: 9 });
        expect(essencePerGiver(270, 2)).toEqual({ perGiver: 135, trips: 5 });
    });

    const stock: Stockpile = {
        accounts: {
            cairn_h51: { bank: [{ name: 'Body talisman', count: 2 }] },
            cairn_h52: { bank: [{ name: 'Body talisman', count: 3 }] },
            cairn_h30: { bank: [{ name: 'Rune essence', count: 1000 }] },
            cairn_dot_md: { bank: [{ name: 'Body talisman', count: 99 }] },
            cairn_t02: { bank: [{ name: 'Body talisman', count: 5 }] }
        }
    };

    test('talismans come from the biggest holder first, never a giver or a forbidden name', () => {
        const t = allocate(stock, 'Body talisman', ['cairn_t01', 'cairn_t02', 'cairn_t03', 'cairn_t04'], 1);
        expect(t.map(x => `${x.from}>${x.to}`)).toEqual(['cairn_h52>cairn_t01', 'cairn_h52>cairn_t02', 'cairn_h52>cairn_t03', 'cairn_h51>cairn_t04']);
        expect(() => allocate(stock, 'Body talisman', roster(6).accounts, 1)).toThrow(/need 6, the stockpile holds 5/);
    });

    test('a giver that needs more than one holder has is split', () => {
        const t = allocate({ accounts: { cairn_h30: { bank: [{ name: 'Rune essence', count: 300 }] }, cairn_h31: { bank: [{ name: 'Rune essence', count: 200 }] } } }, 'Rune essence', ['cairn_t01', 'cairn_t02'], 243);
        expect(t).toEqual([
            { from: 'cairn_h30', to: 'cairn_t01', item: 'Rune essence', count: 243 },
            { from: 'cairn_h30', to: 'cairn_t02', item: 'Rune essence', count: 57 },
            { from: 'cairn_h31', to: 'cairn_t02', item: 'Rune essence', count: 186 }
        ]);
    });

    test('the whole plan', () => {
        const p = provisionPlan(stock, roster(3), 270);
        expect(p.batches).toEqual([['cairn_t01', 'cairn_t02', 'cairn_t03']]);
        expect(p.essence).toEqual({ perGiver: 108, trips: 4 });
        expect(p.talismans.length).toBe(3);
        expect(p.essenceTransfers.reduce((n, x) => n + x.count, 0)).toBe(324);
    });
});


describe('roster input boundaries', () => {
    test('unknown refusals do not silently select a different roster', () => {
        expect(() => roster(22, ['cairn_typo'])).toThrow(/unknown/);
    });

    test('configs reject duplicate, forbidden and empty accounts', () => {
        for (const accounts of [[], ['cairn_t01', 'cairn_t01'], ['cairn_dot_md']]) {
            expect(() => launchConfig(accounts, { role: 'idle' })).toThrow();
        }
        expect(() => launchConfig(roster().accounts, { role: 'idle', gatewayPort: NaN })).toThrow();
        expect(() => giverEntries(roster().accounts, { role: 'altar-giver', acceptFrom: '[' })).toThrow();
    });

    test('quantities and batches must be finite positive integers within the limit', () => {
        for (const value of [0, -1, NaN, Infinity, 1.5]) {
            expect(() => essencePerGiver(value)).toThrow();
            expect(() => essencePerGiver(100, value)).toThrow();
        }
        expect(() => batches(roster().accounts, 6)).toThrow();
        expect(() => allocate({ accounts: {} }, 'Rune essence', roster(1).accounts, NaN)).toThrow();
    });

    test('malformed stock is rejected instead of producing a partial plan', () => {
        for (const count of [-1, NaN, Infinity, 0.5]) {
            expect(() => allocate({ accounts: { cairn_h30: { bank: [{ name: 'Rune essence', count }] } } }, 'Rune essence', roster(1).accounts, 1)).toThrow(/invalid stockpile/);
        }
    });

    test('donors count toward the five-client provisioning cap', () => {
        const stock: Stockpile = { accounts: {
            cairn_h51: { bank: [{ name: 'Body talisman', count: 57 }] },
            cairn_h33: { bank: [{ name: 'Rune essence', count: 10000 }] }
        } };
        const p = provisionPlan(stock, roster());
        expect(p.batches.map(b => b.length)).toEqual([3, 3, 3, 3, 3, 3, 3, 1]);
        expect(p.batches.flat()).toEqual(p.roster.accounts);
        expect(p.essenceTransfers.reduce((n, t) => n + t.count, 0)).toBe(5346);
    });
});
