import { expect, test } from 'bun:test';
import { ALWAYS_EXCLUDED } from '../lib/accounts.ts';
import { findNames, scannedNames } from './check-excluded.ts';

test('findNames matches whole names in any case, with spaces or underscores', () => {
    const text = 'row placeholder_one 12\nPlaceholder One stood here\nplaceholder_ones is someone else\nxplaceholder one';
    expect(findNames(text, ['placeholder one'])).toEqual([
        [1, 'placeholder one'],
        [2, 'placeholder one']
    ]);
});

test('the code\'s own whole excluded names are not scanned, but prefixed names still are', () => {
    expect(scannedNames([...ALWAYS_EXCLUDED.names, 'money placeholder', 'placeholder one'])).toEqual(['money placeholder', 'placeholder one']);
});
