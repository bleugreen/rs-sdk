import { describe, expect, test } from 'bun:test';
import { dragsApplied, pickTracer, slotOf, summarize } from './decode-cap-probe';

describe('dragsApplied', () => {
    test('counts along the chain in either direction', () => {
        expect(dragsApplied(10, 10, 1, 5)).toBe(0);
        expect(dragsApplied(14, 10, 1, 5)).toBe(4);
        expect(dragsApplied(6, 10, -1, 5)).toBe(4);
    });
    test('null off the chain', () => {
        expect(dragsApplied(9, 10, 1, 5)).toBeNull();
        expect(dragsApplied(16, 10, 1, 5)).toBeNull();
        expect(dragsApplied(-1, 10, 1, 5)).toBeNull();
    });
});

describe('summarize', () => {
    const s = (rel: number, k: number | null, glued = false) => ({ rel, k, glued });
    test('fork cap: 5 of 8 in the landing tick, 3 the next', () => {
        expect(summarize([s(1, 5), s(2, 8), s(3, 8)], 8)).toEqual({ firstRel: 1, sameTick: 5, nextTick: 3, later: 0, missing: 0, glued: false });
    });
    test('landing two ticks after the send, a straggler later', () => {
        expect(summarize([s(1, 0), s(2, 4), s(3, 4), s(4, 5)], 5)).toEqual({ firstRel: 2, sameTick: 4, nextTick: 0, later: 1, missing: 0, glued: false });
    });
    test('nothing landed', () => {
        expect(summarize([s(1, 0), s(2, null)], 6).missing).toBe(6);
    });
    test('a glued frame at the landing or the tick after flags the repeat', () => {
        expect(summarize([s(1, 5, true), s(2, 6)], 6).glued).toBe(true);
        expect(summarize([s(1, 5), s(2, 6), s(5, 6, true)], 6).glued).toBe(false);
    });
});

describe('tracer', () => {
    test('slotOf needs exactly one occurrence', () => {
        expect(slotOf([0, 5, 6, 5], 6)).toBe(2);
        expect(slotOf([0, 5, 6, 5], 5)).toBe(-1);
        expect(slotOf([0, 5], 9)).toBe(-1);
    });
    test('pickTracer prefers a unique item near the middle', () => {
        const inv = new Array(28).fill(0);
        inv[0] = 7;
        inv[12] = 9;
        inv[13] = 4;
        inv[20] = 4;
        expect(pickTracer(inv)).toBe(9);
        expect(pickTracer(new Array(28).fill(0))).toBeNull();
    });
});
