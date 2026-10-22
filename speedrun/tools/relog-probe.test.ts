import { describe, expect, test } from 'bun:test';
import { formatSamples, pageTimeline, type PageSample } from './relog-probe';

const s = (at: number, doc: number, progress: number, inGame: number, loggingIn: number, tick: number, gateway: number): PageSample => ({ at, doc, progress, inGame, loggingIn, tick, gateway });

describe('pageTimeline', () => {
    test('a navigation: new document, load, login, world, first tick, and the gateway socket late', () => {
        const out = 1_000;
        const samples = [
            s(900, 1, 100, 0, 0, 57, 1), // the old page, logged out
            s(1_400, 2, 0, 0, 0, -1, -1), // new document
            s(6_000, 2, 100, 0, 0, -1, -1),
            s(6_100, 2, 100, 0, 1, -1, -1),
            s(7_000, 2, 100, 1, 1, 0, 0), // in world, overlay made, socket not yet up
            s(7_600, 2, 100, 1, 0, 1, 0),
            s(19_000, 2, 100, 1, 0, 19, 1), // socket up at tick 19
        ];
        expect(pageTimeline(samples, out, 20_000, 0)).toEqual({
            newDocumentMs: 400,
            loadedMs: 5_000,
            loginStartMs: 5_100,
            inGameMs: 6_000,
            firstTickMs: 6_600,
            gatewayUpMs: 18_000,
            gatewayUpTick: 19,
        });
    });

    test('in the page: no new document, the socket up throughout, ticks counted on from the base', () => {
        const samples = [s(900, 1, 100, 0, 0, 57, 1), s(1_100, 1, 100, 0, 1, 57, 1), s(1_900, 1, 100, 1, 1, 57, 1), s(2_400, 1, 100, 1, 0, 58, 1)];
        expect(pageTimeline(samples, 1_000, 5_000, 57)).toEqual({
            newDocumentMs: null,
            loadedMs: null,
            loginStartMs: 100,
            inGameMs: 900,
            firstTickMs: 1_400,
            gatewayUpMs: 0,
            gatewayUpTick: 0,
        });
    });

    test('a socket that dropped in the page counts from when it came back', () => {
        const samples = [s(900, 1, 100, 0, 0, 57, 1), s(1_100, 1, 100, 0, 0, 57, 0), s(1_900, 1, 100, 1, 0, 58, 0), s(4_000, 1, 100, 1, 0, 61, 1)];
        expect(pageTimeline(samples, 1_000, 5_000, 57)).toMatchObject({ gatewayUpMs: 3_000, gatewayUpTick: 4 });
    });
});

test('formatSamples prints one row per relog, with dashes for what was not measured', () => {
    const lines = formatSamples(
        [
            {
                relog: 1, via: 'page', got: 'page', clickTick: 60, lastInWorldTick: 60, latencyTicks: 0, confirmedBy: 'page', clickToOutMs: 250, outToInWorldMs: 1_800,
                outToFirstStateMs: 1_400, firstStateTick: 1, tickBase: 60, bankClickTick: 2, bankOpenTick: null, page: null, loginAttempts: 1,
            },
        ],
        600
    );
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain('page      page');
    expect(lines[2]).toContain('no page timeline');
});
