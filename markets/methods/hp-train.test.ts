import { describe, expect, test } from 'bun:test';
import { parseOptions, pastTheMountain, SITES, TargetClaims } from './hp-train';
import type { BotWorldState } from '../../sdk/types';

const at = (x: number, z: number, level = 0) => ({ player: { worldX: x, worldZ: z, level } }) as unknown as BotWorldState;

describe('which side of White Wolf Mountain', () => {
    test("the crabs, Seers' and Catherby are past it; Lumbridge, the cows and Taverley are not", () => {
        expect(pastTheMountain(at(SITES.crabs.centre.x, SITES.crabs.centre.z))).toBe(true);
        expect(pastTheMountain(at(2725, 3491))).toBe(true);
        expect(pastTheMountain(at(2690, 3735))).toBe(true);
        expect(pastTheMountain(at(3253, 3285))).toBe(false);
        expect(pastTheMountain(at(2880, 3410))).toBe(false);
        expect(pastTheMountain(null)).toBe(false);
    });
});
import { parseArgs } from './probe-sampler';

describe('hp-train options', () => {
    test('defaults: Hitpoints 40, the site chosen from it, 1,700 coins, the crossing at 30, the kebab estimate, no Prayer', () => {
        const o = parseOptions(parseArgs(['acct01']));
        expect(o).toMatchObject({ account: 'acct01', to: 40, site: 'auto', coins: 1700, switchHp: 30, kebabs: -1, foodPerTrip: 20, prayer: 0, pray: false, finalBank: true, out: null });
        expect(parseOptions(parseArgs(['acct01', '--to', '70', '--site', 'crabs']))).toMatchObject({ to: 70, site: 'crabs' });
        expect(parseOptions(parseArgs(['acct01', '--site', 'goblins', '--final-bank', 'false']))).toMatchObject({ site: 'goblins', finalBank: false });
        expect(() => parseOptions(parseArgs(['acct01', '--final-bank', 'no']))).toThrow(/--final-bank/);
    });
    test('the Prayer-first variant', () => {
        const o = parseOptions(parseArgs(['acct01', '--to=99', '--prayer', '43', '--pray', '--site', 'cows']));
        expect(o).toMatchObject({ to: 99, prayer: 43, pray: true, site: 'cows' });
    });
    test('refusals', () => {
        expect(() => parseOptions(parseArgs([]))).toThrow(/account/);
        expect(() => parseOptions(parseArgs(['acct01', '--to', '100']))).toThrow(/at most 99/);
        expect(() => parseOptions(parseArgs(['acct01', '--to', '70', '--site', 'ogres']))).toThrow(/--site/);
        expect(() => parseOptions(parseArgs(['acct01', '--to', '70', '--pray', 'yes']))).toThrow(/--pray/);
        expect(() => parseOptions(parseArgs(['acct01', '--to', '70', '--bogus', '1']))).toThrow(/unknown option/);
    });
});

describe('npc claims between the bots of one process', () => {
    test('one npc per bot: a live claim refuses others, release and the ttl free it', () => {
        let now = 0;
        const c = new TargetClaims(20_000, () => now);
        expect(c.claim(5, 'a')).toBe(true);
        expect(c.claim(5, 'a')).toBe(true); // renewal
        expect(c.heldByOther(5, 'b')).toBe(true);
        expect(c.heldByOther(5, 'a')).toBe(false);
        expect(c.claim(5, 'b')).toBe(false);
        c.release(5, 'b'); // not b's to release
        expect(c.claim(5, 'b')).toBe(false);
        c.release(5, 'a');
        expect(c.claim(5, 'b')).toBe(true);
        now = 20_000; // b stalled: its claim lapses
        expect(c.heldByOther(5, 'a')).toBe(false);
        expect(c.claim(5, 'a')).toBe(true);
        c.claim(6, 'a');
        c.claim(7, 'b');
        c.releaseAll('a');
        expect(c.size).toBe(1);
    });
});
