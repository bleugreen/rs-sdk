import { expect, test } from 'bun:test';
import { blockFile, jumpNeighbours } from './poll.ts';

test('jumpNeighbours lists who stands near an online jumper', () => {
    const ps = [
        { name: 'Stein', x: 100, z: 100, level: 0 },
        { name: 'Near', x: 105, z: 96, level: 0 },
        { name: 'Upstairs', x: 100, z: 100, level: 1 },
        { name: 'Far', x: 120, z: 100, level: 0 }
    ];
    expect(jumpNeighbours([{ name: 'stein' }, { name: 'offline' }], ps)).toEqual({ stein: [{ name: 'Near', x: 105, z: 96, level: 0 }], offline: null });
});

test('blockFile names the UTC block a poll falls in', () => {
    expect(blockFile(new Date('2026-10-22T22:17:00Z'), 6)).toBe('poll-2026-10-22T18Z.json');
    expect(blockFile(new Date('2026-10-23T05:59:59Z'), 6)).toBe('poll-2026-10-23T00Z.json');
    expect(blockFile(new Date('2026-10-23T05:59:59Z'), 4)).toBe('poll-2026-10-23T04Z.json');
});
