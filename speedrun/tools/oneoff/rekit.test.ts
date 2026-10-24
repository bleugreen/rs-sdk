import { describe, expect, test } from 'bun:test';
import { censusShort, parseRekit, type RekitConfig } from './rekit';

const base = ['--couriers=aaaaaa,bbbbbb', '--meet=3222,3218'];
const cfg = (argv: string[], files: Record<string, string> = {}) => parseRekit(argv, p => {
    if (!(p in files)) throw new Error('no such file');
    return files[p]!;
});

describe('parseRekit', () => {
    test('couriers by hash, in order, with their defaults', () => {
        const c = cfg(base) as RekitConfig;
        expect(c.couriers).toEqual(['aaaaaa', 'bbbbbb']);
        expect(c.giveTo).toBe('aaaaaa');
        expect(c.meet).toEqual({ x: 3222, z: 3218, level: 0 });
        expect(c.optionalWaitS).toBe(600);
        expect(c.walkTimeoutS).toBe(480);
        expect(c.teleport).toBeNull();
        expect(c.to).toBeNull();
    });

    test('refuses names (not hashes), duplicates, and a missing --meet', () => {
        expect(cfg(['--couriers=cairn_h61', '--meet=1,1'])).toContain('hex digits');
        expect(cfg(['--couriers=aaaaaa,aaaaaa', '--meet=1,1'])).toContain('named twice');
        expect(cfg(['--couriers=aaaaaa'])).toContain('--meet');
    });

    test('optional couriers are a subset, never the first, never --give-to', () => {
        expect(cfg([...base, '--optional=cccccc'])).toContain('not in --couriers');
        expect(cfg([...base, '--optional=aaaaaa'])).toContain('first courier');
        expect(cfg([...base, '--optional=bbbbbb', '--give-to=bbbbbb'])).toContain('--give-to');
        expect((cfg([...base, '--optional=bbbbbb', '--optional-items=1727']) as RekitConfig).optionalItems).toEqual([1727]);
    });

    test('--want from a JSON file, less --drop', () => {
        const c = cfg([...base, '--want=w.json', '--drop=1351'], { 'w.json': '{"385": 15, "1351": 1, "563": 4}' }) as RekitConfig;
        expect(c.want).toEqual({ 385: 15, 563: 4 });
        expect(cfg([...base, '--want=w.json'], { 'w.json': '[1,2]' })).toContain('JSON object');
        expect(cfg([...base, '--want=w.json'], { 'w.json': '{"shark": 1}' })).toContain('not an id');
        expect(cfg([...base, '--want=missing.json'])).toContain('missing.json');
    });

    test('--teleport is a known spell; --to a tile', () => {
        expect((cfg([...base, '--teleport=ardougne', '--to=2658,3301']) as RekitConfig).to).toEqual({ x: 2658, z: 3301, level: 0 });
        expect(cfg([...base, '--teleport=home'])).toContain('--teleport takes one of');
        expect(cfg([...base, '--to=2658'])).toContain('--to takes');
        expect(cfg([...base, '--swap-give=shark'])).toContain('obj ids');
    });
});

describe('censusShort', () => {
    test('shortfalls by id, leaving out a missed optional courier\'s items', () => {
        expect(censusShort({ 385: 15, 1727: 1 }, { 385: 15 })).toEqual(['1727: have 0, want 1']);
        expect(censusShort({ 385: 15, 1727: 1 }, { 385: 15 }, [1727])).toEqual([]);
        expect(censusShort({ 385: 15 }, { 385: 14 })).toEqual(['385: have 14, want 15']);
    });
});
