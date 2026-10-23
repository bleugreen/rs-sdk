import { describe, expect, test } from 'bun:test';
import { parseOptions } from './hp-train';
import { parseArgs } from './probe-sampler';

describe('hp-train options', () => {
    test('defaults: the crabs, 1,700 coins, the crossing at 30, the kebab estimate, no Prayer', () => {
        const o = parseOptions(parseArgs(['acct01', '--to', '70']));
        expect(o).toMatchObject({ account: 'acct01', to: 70, site: 'crabs', coins: 1700, switchHp: 30, kebabs: -1, foodPerTrip: 20, prayer: 0, pray: false, out: null });
    });
    test('the Prayer-first variant', () => {
        const o = parseOptions(parseArgs(['acct01', '--to=99', '--prayer', '43', '--pray', '--site', 'cows']));
        expect(o).toMatchObject({ to: 99, prayer: 43, pray: true, site: 'cows' });
    });
    test('refusals', () => {
        expect(() => parseOptions(parseArgs(['acct01']))).toThrow(/--to/);
        expect(() => parseOptions(parseArgs(['acct01', '--to', '100']))).toThrow(/at most 99/);
        expect(() => parseOptions(parseArgs(['acct01', '--to', '70', '--site', 'ogres']))).toThrow(/--site/);
        expect(() => parseOptions(parseArgs(['acct01', '--to', '70', '--pray', 'yes']))).toThrow(/--pray/);
        expect(() => parseOptions(parseArgs(['acct01', '--to', '70', '--bogus', '1']))).toThrow(/unknown option/);
    });
});
