import { describe, expect, test } from 'bun:test';
import { DEFAULT_POLICY, LoginGate } from './gate.ts';

const gate = (o: Partial<typeof DEFAULT_POLICY> = {}) => new LoginGate({ ...DEFAULT_POLICY, spacingMs: 0, ...o });

describe('LoginGate', () => {
    test('never starts a second login for an account whose first has not answered', () => {
        const g = gate();
        expect(g.tryStart('a', 0).ok).toBe(true);
        const again = g.tryStart('a', 60_000_000);
        expect(again).toEqual({ ok: false, reason: 'its previous login has not answered', retryAt: Infinity });
        g.answered('a', { ok: true }, 1_000);
        expect(g.state('a')).toBe('in');
        expect(g.tryStart('a', 2_000).ok).toBe(false);
    });

    test('an attempt that ended unanswered holds the account for the login server bound', () => {
        const g = gate();
        g.tryStart('a', 0);
        g.unanswered('a', 500);
        expect(g.check('a', 500 + DEFAULT_POLICY.unansweredHoldMs - 1)).toMatchObject({ ok: false, retryAt: 500 + DEFAULT_POLICY.unansweredHoldMs });
        expect(g.check('a', 500 + DEFAULT_POLICY.unansweredHoldMs).ok).toBe(true);
    });

    test("holds sessions, pending logins included, at the plan's count", () => {
        const g = gate({ maxSessions: 2 });
        expect(g.tryStart('a', 0).ok).toBe(true);
        expect(g.tryStart('b', 0).ok).toBe(true);
        expect(g.tryStart('c', 0)).toMatchObject({ ok: false, reason: "2 sessions is the plan's 2" });
        g.answered('a', { ok: true }, 1);
        expect(g.tryStart('c', 2).ok).toBe(false);
        expect(g.sessions()).toEqual({ pending: 1, inWorld: 1 });
        g.answered('b', { ok: false, code: 3 }, 3);
        expect(g.tryStart('c', 4).ok).toBe(true);
        g.answered('c', { ok: true }, 5);
        g.ended('a', 10);
        expect(g.sessions()).toEqual({ pending: 0, inWorld: 1 });
        // the ended account waits out its short hold
        expect(g.check('a', 10).ok).toBe(false);
        expect(g.check('a', 10 + DEFAULT_POLICY.endedHoldMs).ok).toBe(true);
    });

    test('spaces login starts', () => {
        const g = gate({ spacingMs: 2_000 });
        g.tryStart('a', 1_000);
        expect(g.tryStart('b', 2_999)).toMatchObject({ ok: false, reason: 'spacing logins', retryAt: 3_000 });
        expect(g.tryStart('b', 3_000).ok).toBe(true);
    });

    test('refusals hold the account by code, and code 7 holds the address', () => {
        const g = gate();
        g.tryStart('a', 0);
        g.answered('a', { ok: false, code: 16 }, 0);
        expect(g.check('a', 15_999).ok).toBe(false);
        expect(g.check('a', 16_000).ok).toBe(true);
        g.tryStart('b', 0);
        g.answered('b', { ok: false, code: 7 }, 100);
        expect(g.check('c', 100)).toMatchObject({ ok: false, reason: 'the address is held after a code 7', retryAt: 60_100 });
        expect(g.check('c', 60_100).ok).toBe(true);
    });

    test('gives an account up after maxRefusals in a row; an answer that lets it in resets the count', () => {
        const g = gate({ maxRefusals: 2, otherRefusedHoldMs: 0 });
        g.tryStart('a', 0);
        g.answered('a', { ok: false, code: 3 }, 0);
        g.tryStart('a', 1);
        g.answered('a', { ok: true }, 1);
        g.ended('a', 2);
        g.tryStart('a', 10_000);
        g.answered('a', { ok: false, code: 3 }, 10_000);
        expect(g.state('a')).toBe('out');
        g.tryStart('a', 20_000);
        g.answered('a', { ok: false, code: 3 }, 20_000);
        expect(g.state('a')).toBe('failed');
        expect(g.check('a', 1e12)).toMatchObject({ ok: false, retryAt: Infinity });
    });

    test('an answer without a login in flight is a bug, not a state change', () => {
        expect(() => gate().answered('a', { ok: true }, 0)).toThrow('has no login in flight');
    });
});
