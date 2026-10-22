import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BotActions } from '../../sdk/actions';
import { BotSDK } from '../../sdk/index';
import { isRefused, readOnlyBot, readOnlySdk, ReadOnlyViolation, SHOP_STOCK_COMPONENT, VALUE_OPTION } from './read-only';

/** Every method that buys, sells, trades, drops or uses the Grand Exchange, on the real SDK classes. */
const TRADING = [
    'sendShopBuy',
    'sendShopSell',
    'buyFromShop',
    'sellToShop',
    'sendDropItem',
    'dropItem',
    'sendTradeRequest',
    'sendOfferItem',
    'sendRetractItem',
    'sendAcceptTrade',
    'sendGESearch',
    'openGE',
    'searchGE',
    'placeGEOffer',
    'cancelGEOffer',
    'collectGEOffer',
    'collectGE',
    'offerTradeItems',
    'acceptTrade',
    'trade',
    'serveTrades'
];

/** What the reader and the speedrun walkers it hands the views to call. */
const USED = {
    sdk: ['getState', 'getSkill', 'waitForCondition', 'onStateUpdate', 'sendClickComponentWithOption', 'sendInteractLoc', 'sendInteractNpc', 'sendClickDialog', 'waitForTicks'],
    bot: ['walkTo', 'openShop', 'closeShop', 'interactLoc', 'talkTo', 'dismissBlockingUI', 'skipTutorial']
};

const methods = (proto: object) => Object.getOwnPropertyNames(proto).filter(n => n !== 'constructor');

describe('read-only views', () => {
    test('every trading method exists on the real classes and is refused', () => {
        const real = new Set([...methods(BotSDK.prototype), ...methods(BotActions.prototype)]);
        for (const name of TRADING) {
            expect(real.has(name)).toBe(true);
            expect(isRefused(name)).toBe(true);
        }
    });

    test('the methods the reader needs pass', () => {
        for (const name of [...USED.sdk, ...USED.bot]) expect(isRefused(name)).toBe(false);
    });

    test('a refused method throws instead of reaching the target', () => {
        const calls: string[] = [];
        const fake = Object.fromEntries([...TRADING, ...USED.bot].map(n => [n, () => calls.push(n)]));
        const bot = readOnlyBot(fake);
        for (const name of TRADING) expect(() => (bot[name] as () => void)()).toThrow(ReadOnlyViolation);
        (bot.walkTo as () => void)();
        expect(calls).toEqual(['walkTo']);
    });

    test('inventory buttons: only Value on the shop stock goes through', () => {
        const sent: unknown[][] = [];
        const sdk = readOnlySdk({ sendClickComponentWithOption: (...a: unknown[]) => sent.push(a), sendShopBuy: () => sent.push(['buy']) });
        sdk.sendClickComponentWithOption(SHOP_STOCK_COMPONENT, VALUE_OPTION, 3);
        for (const option of [2, 3, 4, 5]) expect(() => sdk.sendClickComponentWithOption(SHOP_STOCK_COMPONENT, option, 3)).toThrow(ReadOnlyViolation);
        expect(() => sdk.sendClickComponentWithOption(3823, 1, 0)).toThrow(ReadOnlyViolation); // the shop's side inventory: sell
        expect(() => sdk.sendClickComponentWithOption(3322, 1, 0)).toThrow(ReadOnlyViolation); // the trade side inventory: offer
        expect(() => sdk.sendShopBuy()).toThrow(ReadOnlyViolation);
        expect(sent).toEqual([[SHOP_STOCK_COMPONENT, VALUE_OPTION, 3]]);
    });

    test('methods stay bound to the real object', () => {
        class Counter {
            #n = 0;
            bump() {
                return ++this.#n;
            }
        }
        const c = readOnlySdk(new Counter());
        c.bump();
        expect(c.bump()).toBe(2);
    });
});

describe('reader sources', () => {
    const dir = import.meta.dir;
    /** The role's own modules: everything here but tests and the lab-only scripts in lab/. */
    const sources = readdirSync(dir)
        .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
        .map(f => ({ f, text: readFileSync(join(dir, f), 'utf8') }));

    test('never name a trading method', () => {
        expect(sources.map(s => s.f).sort()).toEqual(['read-only.ts', 'shelf-reader.ts', 'stops.ts']);
        // `trade` is also an English word in the comments: as a method it is only ever reached as `.trade`.
        const named = new RegExp(`\\b(${TRADING.filter(n => n !== 'trade').join('|')})\\b|\\.trade\\b`);
        for (const { f, text } of sources) expect({ f, hit: named.exec(text)?.[0] ?? null }).toEqual({ f, hit: null });
    });

    test('import only the SDK types, the role launcher and the speedrun walkers', () => {
        const allowed = [
            /^node:/,
            /^\.\/(read-only|stops)$/,
            /^\.\.\/\.\.\/sdk\/(types|actions|index)$/,
            /^\.\.\/\.\.\/speedrun\/helpers\/role$/,
            /^\.\.\/\.\.\/speedrun\/lib\/(ships|toll-gate|underground|wait|world)$/
        ];
        for (const { f, text } of sources) {
            for (const m of text.matchAll(/from '([^']+)'/g)) expect({ f, spec: m[1], ok: allowed.some(a => a.test(m[1]!)) }).toEqual({ f, spec: m[1], ok: true });
        }
        // The SDK classes only as types: the views wrap the instances the launcher hands over.
        for (const { text } of sources) expect(text).not.toMatch(/^import \{[^}]*\b(BotSDK|BotActions)\b[^}]*\} from '\.\.\/\.\.\/sdk/m);
    });
});
