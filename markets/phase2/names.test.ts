import { describe, expect, test } from 'bun:test';
import { Exclusion } from '../lib/accounts.ts';
import { aliasOf, nameScrubber, scrubRecord, unlistedAccounts } from './names.ts';

describe('names', () => {
    test('aliases follow plan order', () => {
        expect(aliasOf(0)).toBe('a01');
        expect(aliasOf(44)).toBe('a45');
    });

    test('the scrubber replaces every spelling of a name, longest first', () => {
        const scrub = nameScrubber(['Placeholder one', 'place', 'acct_two']);
        expect(scrub('placeholder_one banked; PLACEHOLDER ONE again')).toBe('a01 banked; a01 again');
        expect(scrub('acct two and acct_two and Acct  Two')).toBe('a03 and a03 and a03');
        expect(scrub('place')).toBe('a02');
        expect(scrub('nothing here')).toBe('nothing here');
    });

    test('scrubRecord rewrites string values and keeps keys', () => {
        const scrub = nameScrubber(['acct_two']);
        const rec = { kind: 'event', acct_two: 1, message: 'acct two logged in', data: [{ who: 'Acct_Two' }, 3, null] };
        expect(scrubRecord(rec, scrub)).toEqual({ kind: 'event', acct_two: 1, message: 'a01 logged in', data: [{ who: 'a01' }, 3, null] });
    });

    test('a real run needs every plan account on the names list', () => {
        const list = new Exclusion(['acct one'], '/names.txt');
        expect(unlistedAccounts(['acct_one'], list)).toEqual([]);
        expect(unlistedAccounts(['acct_one', 'acct three'], list)).toEqual(['a02 (accounts[1]) is not on the names list /names.txt: add it there before it runs']);
        expect(unlistedAccounts(['anyone'], new Exclusion([], null))).toEqual([]);
    });
});
