import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fallbackMix, nextFallback, parsePlan, PlanError, planWarnings, rampSteps, roleOptions, sequenceFor, type MethodId } from './plan.ts';

const accounts = (n: number, method: string, prefix = 'acct') => Array.from({ length: n }, (_, i) => ({ account: `${prefix}${String(i + 1).padStart(2, '0')}`, method }));
const problems = (raw: unknown): string[] => {
    try {
        parsePlan(raw);
    } catch (e) {
        if (e instanceof PlanError) return e.problems;
        throw e;
    }
    return [];
};

describe('parsePlan', () => {
    test('fills the defaults', () => {
        const p = parsePlan({ accounts: accounts(3, 'knights') });
        expect(p.maxSessions).toBe(3);
        expect(p.hp).toBe(40);
        expect(p.sharks).toEqual({ source: 'bank', perAccount: 200, perLoginHour: 40, hours: 72, ceiling: 701, minimum: 28, fillMinutes: 10, rebuyMinSharks: 200 });
        expect(p.ramp?.steps).toEqual([3]);
        expect(p.ramp?.dropPct).toBe(10);
        expect(p.ramp?.fallbackMix).toEqual({ iron: 12, heroes: 8, guards: 23 });
        expect(p.foodFallbackMix).toEqual({ iron: 12, guards: 23 });
        expect(p.ledger).toEqual({ everyTicks: 50, bookMinutes: 15 });
        expect(p.sell.enabled).toBe(false);
    });

    test("allocation A: the knights ramp keeps 8, 20 and caps its last step at the plan's 43", () => {
        const p = parsePlan({ accounts: [...accounts(1, 'shilo', 'gem'), ...accounts(1, 'guards', 'g'), ...accounts(43, 'knights')] });
        expect(p.ramp?.steps).toEqual([8, 20, 43]);
        expect(p.maxSessions).toBe(45);
        expect(rampSteps([8, 20, 43], 16)).toEqual([8, 16]);
        expect(rampSteps([8, 20, 43], 0)).toEqual([]);
    });

    test('the committed example parses', () => {
        const p = parsePlan(JSON.parse(readFileSync(join(import.meta.dir, 'plan.example.json'), 'utf8')));
        expect(p.accounts.length).toBeGreaterThan(0);
        expect(p.accounts.every(a => /^acct\d+$/.test(a.account))).toBe(true);
    });

    test('lists every problem at once', () => {
        const ps = problems({
            accounts: [{ account: 'a', method: 'knights' }, { account: 'A', method: 'steel' }, { account: 'much_too_long_name', method: 'iron' }, { account: 'b', method: 'fishing', extra: 1 }],
            maxSessions: 46,
            sharks: { source: 'shop', ceiling: 0 },
            ramp: { steps: [20, 8] },
            sell: { enabled: true, cap: 100_000 },
            colour: 'red'
        });
        expect(ps).toContain("unknown key 'colour'");
        expect(ps.some(p => /accounts\[1\]: account 'A' is listed twice/.test(p))).toBe(true);
        expect(ps.some(p => /'steel' is not supported: no complete steel loop/.test(p))).toBe(true);
        expect(ps.some(p => /accounts\[2\]: account must be 1-12/.test(p))).toBe(true);
        expect(ps).toContain("accounts[3]: unknown key 'extra'");
        expect(ps.some(p => /accounts\[3\]: method must be one of/.test(p))).toBe(true);
        expect(ps).toContain('maxSessions must be at most 45');
        expect(ps).toContain("sharks.source must be 'bank' or 'buy'");
        expect(ps).toContain('sharks.ceiling must be at least 1');
        expect(ps).toContain('ramp.steps must rise');
        expect(ps).toContain('sell.cap must be at most 5000');
        expect(ps).toContain('sell.enabled needs sell.floors: nothing is sold without a floor');
    });

    test('sales run only from methods that can reach the Exchange', () => {
        const sell = { enabled: true, floors: { 'Iron ore': 80 } };
        const ps = problems({ accounts: accounts(2, 'iron'), sell });
        expect(ps.some(p => /sell.enabled: iron accounts cannot reach the Exchange/.test(p))).toBe(true);
        expect(problems({ accounts: accounts(2, 'guards'), sell })).toEqual([]);
        // knights bring the ramp's fallback mix in, and with it the heroes and iron
        expect(problems({ accounts: [...accounts(1, 'guards'), ...accounts(1, 'knights', 'k')], sell }).some(p => /knights, iron, heroes accounts cannot/.test(p))).toBe(true);
    });

    test('refuses more accounts than one address holds, or than its sessions', () => {
        expect(problems({ accounts: accounts(46, 'guards') })).toContain('46 accounts is more than the 45 logins one address holds (scaling-limits.md)');
        expect(problems({ accounts: accounts(5, 'guards'), maxSessions: 4 }).some(p => /maxSessions 4 is below the 5 accounts/.test(p))).toBe(true);
    });

    test('fallback mixes cannot send logins to the knights, and the food fallback not to the heroes', () => {
        const ps = problems({ accounts: accounts(2, 'knights'), ramp: { fallbackMix: { knights: 1 } }, foodFallbackMix: { heroes: 1, guards: 1 } });
        expect(ps).toContain('ramp.fallbackMix cannot send logins to the knights');
        expect(ps.some(p => /foodFallbackMix cannot use the heroes/.test(p))).toBe(true);
        expect(problems({ accounts: accounts(2, 'knights'), foodFallbackMix: { guards: 0 } })).toContain('foodFallbackMix needs at least one method with a weight above 0');
    });

    test('ramp null admits every knights login at once', () => {
        expect(parsePlan({ accounts: accounts(2, 'knights'), ramp: null }).ramp).toBeNull();
    });
});

describe('sequenceFor', () => {
    const plan = parsePlan({ accounts: accounts(1, 'knights') });
    const dos = (method: MethodId, p = plan, hp?: number) => sequenceFor({ method, hp }, p).map(s => s.do + ('to' in s ? `:${s.to}` : 'n' in s ? `:${s.n}` : ''));

    test('knights: Hitpoints, Thieving 55, the ramp, then ship coins and the voyage', () => {
        expect(dos('knights')).toEqual(['tutorial', 'hp:40', 'thieving:55', 'admission', 'coins:100', 'to-ardougne', 'method']);
    });
    test('the rebuy minimum defaults to perAccount and stays between the minimum and perAccount', () => {
        const one = accounts(1, 'knights');
        expect(parsePlan({ accounts: one, sharks: { source: 'buy', perAccount: 160 } }).sharks.rebuyMinSharks).toBe(160);
        expect(parsePlan({ accounts: one, sharks: { source: 'buy', perAccount: 160, rebuyMinSharks: 60 } }).sharks.rebuyMinSharks).toBe(60);
        expect(problems({ accounts: one, sharks: { source: 'buy', perAccount: 160, rebuyMinSharks: 200 } })).toContain('sharks.rebuyMinSharks must be at most 160');
        expect(problems({ accounts: one, sharks: { source: 'buy', perAccount: 160, rebuyMinSharks: 10 } })[0]).toMatch(/rebuyMinSharks 10 is below sharks.minimum 28/);
        // banked sharks never rebuy
        expect(problems({ accounts: one, sharks: { source: 'bank', perAccount: 10 } })).toEqual([]);
    });
    test('a buying plan whose food fallback earns no coins is warned about', () => {
        const knights = accounts(2, 'knights');
        expect(planWarnings(parsePlan({ accounts: knights, sharks: { source: 'buy' } }))).toEqual([
            'foodFallbackMix sends shark eaters to iron, which banks no coins: an account sent there never earns its rebuy and stays. For a buying plan use foodFallbackMix: { guards: 1 }'
        ]);
        expect(planWarnings(parsePlan({ accounts: knights, sharks: { source: 'buy' }, foodFallbackMix: { guards: 1 } }))).toEqual([]);
        // banked sharks never rebuy, and a plan with no shark eaters has none to strand
        expect(planWarnings(parsePlan({ accounts: knights }))).toEqual([]);
        expect(planWarnings(parsePlan({ accounts: accounts(2, 'guards'), sharks: { source: 'buy' } }))).toEqual([]);
    });
    test('a bought shark supply adds the purchase before the voyage', () => {
        const buy = parsePlan({ accounts: accounts(1, 'knights'), sharks: { source: 'buy' }, ramp: null });
        expect(dos('knights', buy)).toEqual(['tutorial', 'hp:40', 'thieving:55', 'buy-sharks', 'coins:100', 'to-ardougne', 'method']);
        expect(dos('heroes', buy)).toEqual(['tutorial', 'hp:40', 'thieving:80', 'buy-sharks', 'coins:100', 'to-ardougne', 'method']);
    });
    test('guards train Hitpoints only; an account at hp 10 skips it', () => {
        expect(dos('guards')).toEqual(['tutorial', 'hp:40', 'method']);
        expect(dos('guards', plan, 10)).toEqual(['tutorial', 'method']);
    });
    test('iron: ship coins, Mining 15, a wielded pickaxe, the voyage', () => {
        expect(dos('iron')).toEqual(['tutorial', 'coins:100', 'mining:15', 'wield', 'to-ardougne', 'method']);
    });
    test('shilo needs a staged account', () => {
        expect(dos('shilo')).toEqual(['method']);
    });
    test('role options: method defaults, then the plan, then the account', () => {
        const p = parsePlan({ accounts: [{ account: 'a', method: 'knights', options: { bankAt: 10 } }], options: { knights: { foodPerTrip: 4, bankAt: 20 } } });
        expect(roleOptions(p.accounts[0]!, p)).toEqual({ target: 'knight', food: 'Shark', foodPerTrip: 4, bankAt: 10 });
    });
});

describe('fallback split', () => {
    test("35 knights logins go to plan B's mix", () => {
        const m = fallbackMix(35, { iron: 12, heroes: 8, guards: 23 });
        expect(Object.fromEntries(m)).toEqual({ iron: 10, heroes: 6, guards: 19 });
        expect([...m.values()].reduce((a, b) => a + b)).toBe(35);
    });
    test('the whole mix at its own size, and nothing for none', () => {
        expect(Object.fromEntries(fallbackMix(43, { iron: 12, heroes: 8, guards: 23 }))).toEqual({ iron: 12, heroes: 8, guards: 23 });
        expect(fallbackMix(0, { guards: 1 }).size).toBe(0);
        expect(Object.fromEntries(fallbackMix(1, { iron: 12, guards: 23 }))).toEqual({ iron: 0, guards: 1 });
    });
    test('one at a time ends where the split at once does', () => {
        const mix = { iron: 12, guards: 23 };
        const assigned = new Map<MethodId, number>();
        for (let i = 0; i < 20; i++) {
            const m = nextFallback(assigned, mix)!;
            assigned.set(m, (assigned.get(m) ?? 0) + 1);
        }
        expect(Object.fromEntries(assigned)).toEqual(Object.fromEntries([...fallbackMix(20, mix)].filter(([, n]) => n > 0)));
    });
});

describe('hpSites', () => {
    test('default caps from the sites, overridden per site, refused when unknown or all closed', () => {
        expect(parsePlan({ accounts: accounts(2, 'knights') }).hpSites).toMatchObject({ cows: 4, farm: 4 });
        expect(parsePlan({ accounts: accounts(2, 'knights'), hpSites: { cows: 1, goblins: 0 } }).hpSites).toEqual({ cows: 1, goblins: 0 });
        expect(problems({ accounts: accounts(2, 'knights'), hpSites: { crabs: 3, cows: 1.5 } })).toEqual(['hpSites.crabs: not a low Hitpoints site (cows, goblins, chickens, farm, champions, crafting, sarim)', 'hpSites.cows must be a whole number']);
        expect(problems({ accounts: accounts(2, 'knights'), hpSites: { cows: 0 } })).toEqual(['hpSites closes every site, so no account could train Hitpoints']);
        expect(problems({ accounts: accounts(2, 'iron'), hpSites: { cows: 0 } })).toEqual([]);
    });
});
