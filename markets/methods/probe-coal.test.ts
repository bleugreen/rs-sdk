import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../sdk/types';
import { COAL_ID, expectedProceeds, liveRock, marketOrigin, parseCoal, SELL_CAP, sellDecision } from './probe-coal';
import { parseArgs } from './probe-sampler';

const parse = (...argv: string[]) => parseCoal(parseArgs(argv));

describe('options', () => {
    test('defaults: no sale, floor 80, a 10-minute fill wait', () => {
        expect(parse('acc', '--minutes', '20')).toEqual({ account: 'acc', minutes: 20, out: null, sell: 0, floor: 80, fillMinutes: 10 });
    });
    test('the sell cap is hard', () => {
        expect(SELL_CAP).toBe(5);
        expect(parse('acc', '--minutes', '0', '--sell', '5').sell).toBe(5);
        expect(() => parse('acc', '--minutes', '0', '--sell', '6')).toThrow(/hard cap of 5/);
        expect(() => parse('acc', '--minutes', '0', '--sell', '500')).toThrow(/hard cap/);
        expect(() => parse('acc', '--minutes', '0', '--sell', '2.5')).toThrow(/whole/);
        expect(() => parse('acc', '--minutes', '0', '--sell', '-1')).toThrow(/at least 0/);
    });
    test('floor and fill wait', () => {
        expect(parse('acc', '--minutes', '0', '--floor', '95', '--fill-minutes', '2')).toMatchObject({ floor: 95, fillMinutes: 2 });
        expect(() => parse('acc', '--minutes', '0', '--floor', '0')).toThrow(/at least 1/);
        expect(() => parse('acc', '--minutes', '0', '--fill-minutes', '11')).toThrow(/at most 10/);
    });
});

describe('the floor check', () => {
    test('sells at or above the floor only', () => {
        expect(sellDecision(80, 80)).toEqual({ sell: true });
        expect(sellDecision(120, 80)).toEqual({ sell: true });
        expect(sellDecision(79, 80)).toEqual({ sell: false, reason: 'best bid 79 gp is below the floor of 80 gp' });
        expect(sellDecision(null, 80)).toEqual({ sell: false, reason: 'no open bid for coal' });
    });
    test('proceeds: the gross less the fee, the fee rounded down (MarketStore.ts)', () => {
        // measured in the lab: 5 coal at 85 paid 404 gp
        expect(expectedProceeds(5, 85)).toBe(404);
        expect(expectedProceeds(5, 80)).toBe(380);
        expect(expectedProceeds(1, 19)).toBe(19);
    });
});

test('coal is obj 453', () => {
    expect(COAL_ID).toBe(453);
});

test('the market origin follows SERVER, plain http only on loopback', () => {
    expect(marketOrigin('localhost:9950')).toBe('http://localhost:9950');
    expect(marketOrigin('127.0.0.1:8888')).toBe('http://127.0.0.1:8888');
    expect(marketOrigin('game.example')).toBe('https://game.example');
    expect(marketOrigin('wss://game.example/ws')).toBe('https://game.example');
});

test('a rock is live with a Mine op and not an empty-rock id', () => {
    const loc = (id: number) => ({ x: 3087, z: 3431, id, name: 'Rocks', optionsWithIndex: [{ text: 'Mine', opIndex: 1 }] });
    expect(liveRock({ nearbyLocs: [loc(2096)] } as unknown as BotWorldState, { x: 3087, z: 3431 })?.id).toBe(2096);
    expect(liveRock({ nearbyLocs: [loc(450)] } as unknown as BotWorldState, { x: 3087, z: 3431 })).toBeUndefined();
});
