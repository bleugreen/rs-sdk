import { describe, expect, test } from 'bun:test';
import { NO_DATA_TIMEOUT_MS } from '../../server/webclient/src/client/NoDataTimeout';
import { PAGE_HOLD_MS, pageHoldStandDown, pageHoldTicks } from './page-hold';

describe('page-hold', () => {
    test('the window is the client\'s own no-data timeout plus the margin, converted by the tick length', () => {
        expect(NO_DATA_TIMEOUT_MS).toBe(120_000);
        expect(PAGE_HOLD_MS).toBe(NO_DATA_TIMEOUT_MS + 15_000);
        const prev = process.env.SPEEDRUN_TICK_MS;
        try {
            process.env.SPEEDRUN_TICK_MS = '400';
            expect(pageHoldTicks()).toBe(Math.ceil(PAGE_HOLD_MS / 400));
            expect(pageHoldTicks()).toBe(338);
            process.env.SPEEDRUN_TICK_MS = '600';
            expect(pageHoldTicks()).toBe(Math.ceil(PAGE_HOLD_MS / 600));
        } finally {
            if (prev === undefined) delete process.env.SPEEDRUN_TICK_MS;
            else process.env.SPEEDRUN_TICK_MS = prev;
        }
    });

    test('the stand-down holds a silence-driven logout or relaunch only inside the window with the page in game', async () => {
        const inGame = async () => true;
        expect(await pageHoldStandDown({ verdict: 'logout', msSinceAdvance: 60_000 }, inGame)).toMatch(/^the page still says in game/);
        expect(await pageHoldStandDown({ verdict: 'relaunch', msSinceAdvance: 60_000 }, inGame)).toMatch(/^the page still says in game/);
        expect(await pageHoldStandDown({ verdict: 'logout', msSinceAdvance: PAGE_HOLD_MS + 1 }, inGame)).toBeNull();
        expect(await pageHoldStandDown({ verdict: 'logout', msSinceAdvance: 60_000 }, async () => false)).toBeNull();
        expect(await pageHoldStandDown({ verdict: 'logout', msSinceAdvance: 60_000 }, async () => null)).toBeNull();
        expect(await pageHoldStandDown({ verdict: 'stop', msSinceAdvance: 0 }, inGame)).toBeNull();
    });
});
