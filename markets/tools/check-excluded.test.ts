import { expect, test } from 'bun:test';
import { findNames } from './check-excluded.ts';

test('findNames matches whole names in any case, with spaces or underscores', () => {
    const text = 'row placeholder_one 12\nPlaceholder One stood here\nplaceholder_ones is someone else\nxplaceholder one';
    expect(findNames(text, ['placeholder one'])).toEqual([
        [1, 'placeholder one'],
        [2, 'placeholder one']
    ]);
});
