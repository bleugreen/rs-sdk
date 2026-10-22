import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBank } from './boards.ts';
import { census, familyOf } from './families.ts';
import { parsePositions, zoneOf } from './positions.ts';

const fixture = (name: string) => readFileSync(join(import.meta.dir, 'fixtures', name), 'utf8');
const positions = parsePositions(JSON.parse(fixture('playerpositions.json')));

describe('positions (recorded 2026-10-22 ~22:1xZ)', () => {
    test('parses every player, bare array or wrapped', () => {
        expect(positions).toHaveLength(1405);
        expect(parsePositions({ players: [{ name: 'A', x: 1, z: 2, level: 0 }, { name: 'bad' }] })).toEqual([{ name: 'A', x: 1, z: 2, level: 0 }]);
        expect(() => parsePositions({})).toThrow('no player list');
    });

    test('places soko and banker at the Varrock west bank', () => {
        expect(zoneOf(positions.find(p => p.name === 'Soko')!)).toBe('Varrock west bank (GE)');
        expect(zoneOf(positions.find(p => p.name === 'Banker')!)).toBe('Varrock west bank (GE)');
        expect(zoneOf({ x: 3222, z: 3218, level: 0 })).toBeNull();
    });
});

describe('family census', () => {
    test('classifies by display or board name', () => {
        expect(familyOf('Nickai3')).toBe('nick');
        expect(familyOf('kurobanker')).toBe('kuro');
        expect(familyOf('Goo021')).toBe('goo');
        expect(familyOf('Goondelf')).toBeNull();
        expect(familyOf('Marketmaker')).toBeNull();
    });

    test('counts members across the bank board and who is online where', () => {
        const c = Object.fromEntries(census({ bank: parseBank(fixture('bank.html')) }, positions).map(f => [f.family, f]));
        expect(c.soko!.online).toHaveLength(18);
        expect(c.soko!.zones).toEqual({ 'Varrock west bank (GE)': 18 });
        expect(c.goo!.online).toHaveLength(30);
        expect(c.banker!.online).toEqual(['banker', 'banker2']);
        expect(c.nick!.sources.bank).toEqual(['nickai3', 'nickai', 'nickai2']);
        expect(c.kuro!.online).toEqual([]);
        expect(c.kuro!.accounts).toEqual(['kurobanker']);
    });
});
