import { expect, test } from 'bun:test';
import { blockFile } from './poll.ts';

test('blockFile names the UTC block a poll falls in', () => {
    expect(blockFile(new Date('2026-10-22T22:17:00Z'), 6)).toBe('poll-2026-10-22T18Z.json');
    expect(blockFile(new Date('2026-10-23T05:59:59Z'), 6)).toBe('poll-2026-10-23T00Z.json');
    expect(blockFile(new Date('2026-10-23T05:59:59Z'), 4)).toBe('poll-2026-10-23T04Z.json');
});
