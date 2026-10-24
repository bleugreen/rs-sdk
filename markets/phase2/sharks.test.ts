import { describe, expect, test } from 'bun:test';
import { afterAttempt, heldAfter, needsReread, isTransient, loadSharks, rebuyDecision, requestRebuy, retryDelayMs, SHARK_RETRY, sharksSettled, shortfall, shortForVoyage, type RebuyInput, type SharkState } from './sharks.ts';

const NOW = new Date('2026-10-24T09:00:00Z');

// records as errands.ts buySharks writes them, with the SDK's own messages
const withdrawTimeout = { kind: 'buy', item: 385, ceiling: 701, held: 40, withdraw: 'Timeout waiting for Coins to be withdrawn', result: 'refused', reason: '0 coins do not cover one shark at the ceiling of 701', banked: 40, at: '2026-10-24T06:10:00.000Z' };
const poor = { kind: 'buy', item: 385, ceiling: 701, held: 0, result: 'refused', reason: '350 coins do not cover one shark at the ceiling of 701', banked: 0 };
const aboveCeiling = { kind: 'buy', item: 385, result: 'refused', reason: 'best ask 750 is above the ceiling of 701', banked: 3 };
const noAsks = { kind: 'buy', item: 385, result: 'refused', reason: 'no asks', banked: 0 };
const filled = { kind: 'buy', item: 385, result: 'filled', quantity: 160, filled: 160, banked: 160, at: '2026-10-24T05:00:00.000Z' };
const unknown = { kind: 'buy', item: 385, result: 'unknown', reason: 'timeout: GE result was not observed. The action may have applied; inspect getGEState() before retrying.', banked: 0 };
const closedGE = { kind: 'buy', item: 385, result: 'not placed', reason: 'no_interface: Open the Grand Exchange at its table or teller first. Older clients need an update for GE state.', banked: 0 };
const slotsFull = { kind: 'buy', item: 385, result: 'not placed', reason: 'no_slot: Requested slot is occupied, or all six slots are full. Collect finished offers first.', banked: 0 };

describe('transient or permanent', () => {
    test('a coins refusal after a withdraw timeout is transient; a real shortage is not', () => {
        expect(isTransient({ record: withdrawTimeout })).toBe(true);
        expect(isTransient({ record: poor })).toBe(false);
    });
    test('the book refusals and an unknown placement are never retried', () => {
        expect(isTransient({ record: aboveCeiling })).toBe(false);
        expect(isTransient({ record: noAsks })).toBe(false);
        expect(isTransient({ record: unknown })).toBe(false);
        expect(isTransient({ record: filled })).toBe(false);
    });
    test('a closed Exchange interface is transient; full slots are not', () => {
        expect(isTransient({ record: closedGE })).toBe(true);
        expect(isTransient({ record: slotsFull })).toBe(false);
    });
    test('errors the errand throws', () => {
        expect(isTransient({ error: 'openBank: Timeout waiting for bank interface to open' })).toBe(true);
        expect(isTransient({ error: 'openGE: The table did not open a structured exchange. Update the client/server and inspect the interface.' })).toBe(true);
        expect(isTransient({ error: 'walk to the Varrock west bank: Walk timed out after 60000ms' })).toBe(true);
        expect(isTransient({ error: 'no game state' })).toBe(true);
        expect(isTransient({ error: 'could not leave Al-Kharid: the toll gate' })).toBe(false);
    });
});

describe('retries', () => {
    test('transient refusals retry up to the bound, then settle', () => {
        let s: SharkState | null = null;
        const seen: string[] = [];
        for (let i = 0; i < SHARK_RETRY.tries; i++) {
            s = afterAttempt(s, { record: withdrawTimeout }, NOW);
            seen.push(`${s.status}:${s.tries}`);
        }
        expect(seen).toEqual(['retry:1', 'retry:2', 'retry:3', 'done:4']);
        expect(s!.note).toMatch(/4 transient refusals/);
        expect(sharksSettled(s)).toBe(true);
    });
    test('a settled attempt resets the count; a permanent refusal settles at once', () => {
        const r = afterAttempt(null, { error: 'openBank: Timeout waiting for bank interface to open' }, NOW);
        expect(r).toMatchObject({ status: 'retry', tries: 1, last: { result: 'error' } });
        expect(afterAttempt(r, { record: filled }, NOW)).toMatchObject({ status: 'done', tries: 0 });
        expect(afterAttempt(null, { record: aboveCeiling }, NOW)).toMatchObject({ status: 'done', tries: 0, last: aboveCeiling });
    });
    test('a rebuy request starts the count afresh', () => {
        const done = afterAttempt(null, { record: filled }, NOW);
        const due = requestRebuy(done, NOW, 'rebuy');
        expect(due.status).toBe('due');
        expect(sharksSettled(due)).toBe(false);
        expect(afterAttempt(due, { record: withdrawTimeout }, NOW)).toMatchObject({ status: 'retry', tries: 1 });
    });
    test('backoff doubles to a cap', () => {
        expect([1, 2, 3, 4, 10].map(t => retryDelayMs(t))).toEqual([15_000, 30_000, 60_000, 120_000, 120_000]);
    });
});

describe('loading role-state', () => {
    test('nothing recorded: the stage has not run', () => {
        expect(loadSharks(undefined)).toBeNull();
        expect(sharksSettled(undefined)).toBe(false);
    });
    test('a record left by the runner before SharkState loads', () => {
        expect(loadSharks(filled)).toMatchObject({ status: 'done', tries: 0, last: filled, at: filled.at });
        expect(loadSharks(aboveCeiling)).toMatchObject({ status: 'done', last: aboveCeiling });
        // the demo's refused purchase: recorded as done then, retried now
        expect(loadSharks(withdrawTimeout)).toMatchObject({ status: 'retry', tries: 1, at: withdrawTimeout.at });
        expect(sharksSettled(withdrawTimeout)).toBe(false);
        expect(sharksSettled(filled)).toBe(true);
    });
    test('a SharkState round-trips', () => {
        const s = afterAttempt(null, { record: withdrawTimeout }, NOW);
        expect(loadSharks(JSON.parse(JSON.stringify(s)))).toEqual(s);
    });
});

describe('re-promotion', () => {
    const base: RebuyInput = { foodFrom: 'knights', method: 'guards', source: 'buy', runEnded: true, coins: 160 * 701, ceiling: 701, minSharks: 160, sharks: loadSharks(filled), nowMs: NOW.getTime() };
    test('a food-redirected knight whose coins cover the minimum at the ceiling goes back', () => {
        expect(rebuyDecision(base)).toEqual({ rebuy: true, reason: '112160 coins cover 160 sharks at the 701 ceiling (at least 160)' });
    });
    test('one coin short is not enough', () => {
        expect(rebuyDecision({ ...base, coins: 160 * 701 - 1 })).toMatchObject({ rebuy: false, reason: '112159 coins, 112160 needed for 160 sharks at the 701 ceiling' });
    });
    test('only accounts the food fallback moved', () => {
        // a ramp redirect (or a planned guard) has no food origin
        expect(rebuyDecision({ ...base, foodFrom: null })).toMatchObject({ rebuy: false, reason: 'not on the food fallback' });
        expect(rebuyDecision({ ...base, foodFrom: 'iron' })).toMatchObject({ rebuy: false });
        expect(rebuyDecision({ ...base, method: 'knights' })).toMatchObject({ rebuy: false });
    });
    test('only with a buying plan after the run', () => {
        expect(rebuyDecision({ ...base, source: 'bank' })).toMatchObject({ rebuy: false });
        expect(rebuyDecision({ ...base, runEnded: false })).toMatchObject({ rebuy: false });
    });
    test('a purchase the book refused holds the rebuy; a refusal for coins does not', () => {
        const refused = afterAttempt(null, { record: aboveCeiling }, new Date(NOW.getTime() - 10 * 60_000));
        expect(rebuyDecision({ ...base, sharks: refused })).toMatchObject({ rebuy: false });
        expect(rebuyDecision({ ...base, sharks: refused, nowMs: NOW.getTime() + 25 * 60_000 })).toMatchObject({ rebuy: true });
        const unfilled = afterAttempt(null, { record: { ...filled, result: 'unfilled', filled: 0 } }, NOW);
        expect(rebuyDecision({ ...base, sharks: unfilled })).toMatchObject({ rebuy: false });
        expect(rebuyDecision({ ...base, sharks: afterAttempt(null, { record: poor }, NOW) })).toMatchObject({ rebuy: true });
    });
});

describe('a short purchase', () => {
    const oneShark = { kind: 'buy', item: 385, ceiling: 701, held: 0, want: 160, quantity: 1, filled: 1, result: 'filled', banked: 1 };
    test('the cause: coins, the book, or neither', () => {
        expect(shortfall(poor, 28)).toBe('insufficient coins');
        expect(shortfall(oneShark, 28)).toBe('insufficient coins');
        expect(shortfall(aboveCeiling, 28)).toBe('the book');
        expect(shortfall({ ...oneShark, quantity: 160, filled: 20, result: 'partial', banked: 20 }, 28)).toBe('short');
        expect(shortfall(filled, 28)).toBeNull();
    });
    test('no voyage below the minimum: the bank seen this run, else the recorded purchase', () => {
        const short = { ...afterAttempt(null, { record: poor }, NOW), short: 'insufficient coins' };
        // a restart: nothing seen yet, the record says 0 banked
        expect(shortForVoyage({ bankSharks: null, carriedSharks: 0, sharks: short, minimum: 28 })).toBe('0 sharks recorded after the last purchase, below the minimum of 28 (insufficient coins): not sailing');
        expect(shortForVoyage({ bankSharks: 20, carriedSharks: 8, sharks: short, minimum: 28 })).toBeNull();
        expect(shortForVoyage({ bankSharks: 0, carriedSharks: 27, sharks: loadSharks(filled), minimum: 28 })).toMatch(/^27 sharks banked and carried/);
        // nothing known at all: let it sail, its first bank visit finds out
        expect(shortForVoyage({ bankSharks: null, carriedSharks: 0, sharks: null, minimum: 28 })).toBeNull();
    });
    test('the fresh path: 500 coins buy nothing, the guards earn the rebuy, the rebuy sails', () => {
        const plan = { ceiling: 701, minimum: 28, rebuyMinSharks: 160 };
        // first purchase at 500 coins: refused for coins, settled, short, no voyage
        const first = afterAttempt(null, { record: { kind: 'buy', item: 385, held: 0, want: 160, result: 'refused', reason: '500 coins do not cover one shark at the ceiling of 701', banked: 0 } }, NOW);
        first.short = shortfall(first.last, plan.minimum)!;
        expect(first).toMatchObject({ status: 'done', short: 'insufficient coins' });
        expect(shortForVoyage({ bankSharks: 0, carriedSharks: 0, sharks: first, minimum: plan.minimum })).not.toBeNull();
        // on the guards: no rebuy until the coins cover 160 at the ceiling; the coins refusal holds nothing
        const at = (coins: number) => rebuyDecision({ foodFrom: 'knights', method: 'guards', source: 'buy', runEnded: true, coins, ceiling: plan.ceiling, minSharks: plan.rebuyMinSharks, sharks: first, nowMs: NOW.getTime() + 60_000 });
        expect(at(60_000).rebuy).toBe(false);
        expect(at(112_160).rebuy).toBe(true);
        // the rebuy fills: settled, nothing short, it sails
        const due = requestRebuy(first, NOW, 'rebuy');
        const second = afterAttempt(due, { record: { kind: 'buy', item: 385, held: 0, want: 160, quantity: 160, filled: 160, result: 'filled', banked: 160 } }, NOW);
        expect(second.status).toBe('done');
        expect(shortfall(second.last, plan.minimum)).toBeNull();
        expect(shortForVoyage({ bankSharks: 160, carriedSharks: 0, sharks: second, minimum: plan.minimum })).toBeNull();
    });
});

describe('the count after a purchase', () => {
    test('a full fill that reads 0 is read again; so is a pack still holding sharks', () => {
        // run-b3 a07: 46 bought, 0 seen in the bank
        expect(needsReread({ bank: 0, pack: 0, uncollected: 0 }, 46)).toBe(true);
        expect(needsReread({ bank: 0, pack: 46, uncollected: 0 }, 46)).toBe(true);
        expect(needsReread({ bank: 46, pack: 0, uncollected: 0 }, 46)).toBe(false);
        // left on the Exchange after the collect's retry: counted, nothing to read again
        expect(needsReread({ bank: 0, pack: 0, uncollected: 46 }, 46)).toBe(false);
    });
    test('bank, pack and uncollected all count toward the minimum', () => {
        expect(heldAfter({ bank: 20, pack: 6, uncollected: 20 })).toBe(46);
    });
});
