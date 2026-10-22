import { describe, expect, test } from 'bun:test';
import { PRAYER_INDICES, type BotWorldState, type PrayerName } from '../../sdk/types';
import { baseState } from './fake-sdk';
import { consumeIsSafe, DRAIN_TIMER, FlickScheduler, type FlickPlan } from './flick';

const PFM: PrayerName = 'protect_from_melee';
const US: PrayerName = 'ultimate_strength';
const IR: PrayerName = 'incredible_reflexes';

const active = (on: Iterable<PrayerName>) => {
    const a = Array.from({ length: 15 }, () => false);
    for (const p of on) a[PRAYER_INDICES[p]] = true;
    return a;
};
const st = (tick: number, on: Iterable<PrayerName> = [], points = 99): BotWorldState =>
    baseState({ tick, prayers: { activePrayers: active(on), prayerPoints: points, prayerLevel: 99 } });

/**
 * A model server: the drain rule of prayer.rs2 (a 5-tick timer from all-off to
 * on, cleared at all-off), buttons applied the tick after they are sent, and
 * buttons dropped while a consume's delay holds. Returns the points drained.
 */
function simulate(prayers: PrayerName[], period: number, ticks: number, consumeEvery = 0, lag = 1) {
    const f = new FlickScheduler({ prayers, period });
    const on = new Set<PrayerName>();
    let timer: number | null = null;
    let drained = 0;
    let delayedUntil = -1;
    const inFlight: { at: number; toggles: PrayerName[]; consume: boolean }[] = [];
    const shown: Set<PrayerName>[] = [];
    let upTicks = 0;
    let lastConsume = -Infinity;
    for (let t = 0; t < ticks; t++) {
        // server tick t: decode what arrived, then the timer
        for (const pkt of inFlight.filter(p => p.at === t)) {
            const delayed = t <= delayedUntil;
            for (const p of pkt.toggles) {
                if (delayed) continue;
                const wasNone = on.size === 0;
                if (on.has(p)) on.delete(p);
                else on.add(p);
                if (on.size === 0) timer = null;
                else if (wasNone) timer = t;
            }
            if (pkt.consume) delayedUntil = t + 2;
        }
        if (timer !== null && t - timer >= DRAIN_TIMER) {
            drained++;
            timer = t;
        }
        if (prayers.every(p => on.has(p))) upTicks++;
        shown[t] = new Set(on);
        // the client sees tick t's state and plans
        const plan: FlickPlan = f.plan(st(t, shown[Math.max(0, t - lag + 1)] ?? []));
        let consume = false;
        if (consumeEvery && plan.consume && t - lastConsume >= consumeEvery) {
            consume = true;
            lastConsume = t;
            f.consumed(t);
        }
        inFlight.push({ at: t + lag, toggles: plan.toggles, consume });
    }
    return { drained, upShare: upTicks / ticks, bursts: f.bursts, restores: f.restores };
}

describe('FlickScheduler', () => {
    test('three prayers: phase 0 is all off then the first on (with the attack), phase 1 the rest on', () => {
        const f = new FlickScheduler({ prayers: [PFM, US, IR] });
        const p0 = f.plan(st(10, [PFM, US, IR]));
        // the offs go in prayer-index order; the first wanted prayer comes back on last
        expect(p0).toEqual({ toggles: [US, IR, PFM, PFM], attack: true, consume: false, free: false, phase: 0 });
        const p1 = f.plan(st(11, [PFM, US, IR]));
        expect(p1).toEqual({ toggles: [US, IR], attack: true, consume: true, free: false, phase: 1 });
        expect(f.plan(st(12, [PFM])).free).toBe(true);
        expect(f.plan(st(13, [PFM, US, IR]))).toMatchObject({ toggles: [], free: true, phase: 3 });
        expect(f.plan(st(14, [PFM, US, IR])).toggles).toEqual([US, IR, PFM, PFM]);
    });

    test('from all off, the first burst only switches the first one on', () => {
        const f = new FlickScheduler({ prayers: [PFM, IR] });
        expect(f.plan(st(0)).toggles).toEqual([PFM]);
        expect(f.plan(st(1)).toggles).toEqual([IR]);
    });

    test('one prayer: off and on in one tick, a consume may go on phase 0 or 1, and phases 1-3 are free', () => {
        const f = new FlickScheduler({ prayers: [PFM] });
        expect(f.plan(st(0, [PFM]))).toEqual({ toggles: [PFM, PFM], attack: true, consume: true, free: false, phase: 0 });
        expect(f.plan(st(1, [PFM]))).toMatchObject({ toggles: [], consume: true, free: true });
        expect(f.plan(st(2, [PFM]))).toMatchObject({ consume: false, free: true });
    });

    test('a consume blocks the next two ticks and pushes a period-3 burst past them', () => {
        const f = new FlickScheduler({ prayers: [PFM, US, IR], period: 3 });
        f.plan(st(0, [PFM, US, IR]));
        expect(f.plan(st(1, [PFM])).consume).toBe(true);
        f.consumed(1);
        expect(f.plan(st(2, [PFM, US, IR]))).toMatchObject({ toggles: [], free: false });
        expect(f.plan(st(3, [PFM, US, IR]))).toMatchObject({ toggles: [], free: false });
        expect(f.plan(st(4, [PFM, US, IR])).toggles).toEqual([US, IR, PFM, PFM]);
    });

    test('a dropped on is sent again once its toggle is old enough to show', () => {
        const f = new FlickScheduler({ prayers: [PFM, US, IR] });
        f.plan(st(0, [PFM, US, IR]));
        f.plan(st(1, [PFM]));
        expect(f.plan(st(3, [PFM, US]))).toMatchObject({ toggles: [IR] });
        expect(f.restores).toBe(1);
    });

    test('a dropped off is believed on, so the next burst turns it off', () => {
        const f = new FlickScheduler({ prayers: [PFM] });
        f.plan(st(0, [PFM]));
        f.plan(st(2, [PFM]));
        expect(f.on.has(PFM)).toBe(true);
    });

    test('a prayer on at the start that is not wanted goes off in the first burst', () => {
        const f = new FlickScheduler({ prayers: [PFM] });
        expect(f.plan(st(0, [PFM, US])).toggles).toEqual([US, PFM, PFM]);
    });

    test('setPrayers: the next tick bursts, turning off what is no longer wanted', () => {
        const f = new FlickScheduler({ prayers: [PFM, US, IR] });
        f.plan(st(0, [PFM, US, IR]));
        f.plan(st(1, [PFM]));
        f.setPrayers([PFM]);
        expect(f.plan(st(2, [PFM, US, IR])).toggles).toEqual([US, IR, PFM, PFM]);
        expect(f.plan(st(3, [PFM])).toggles).toEqual([]);
        expect(f.plan(st(6, [PFM])).toggles).toEqual([PFM, PFM]);
    });

    test('no prayer points: no buttons', () => {
        const f = new FlickScheduler({ prayers: [PFM, IR] });
        expect(f.plan(st(0, [], 0)).toggles).toEqual([]);
        expect(f.plan(st(1, [], 0)).toggles).toEqual([]);
    });

    test('periods outside 1-4 are refused, and two prayers need at least 2', () => {
        expect(() => new FlickScheduler({ prayers: [PFM], period: 5 })).toThrow();
        expect(() => new FlickScheduler({ prayers: [PFM, IR], period: 1 })).toThrow();
        expect(() => new FlickScheduler({ prayers: [] })).toThrow();
    });
});

describe('zero drain against the prayer.rs2 timer model', () => {
    for (const [prayers, period] of [[[PFM], 4], [[PFM], 3], [[PFM, IR], 4], [[PFM, US, IR], 4], [[PFM, US, IR], 3]] as [PrayerName[], number][]) {
        test(`${prayers.length} prayer(s), period ${period}: flat over 400 ticks, with a consume every 40`, () => {
            const r = simulate(prayers, period, 400, 40);
            expect(r.drained).toBe(0);
            expect(r.restores).toBe(0);
            // One prayer is never down; with two or more, the rest are off from the
            // burst until phase 1's toggles land: one tick in `period`.
            expect(r.upShare).toBeGreaterThan(prayers.length === 1 ? 0.95 : (period - 1) / period - 0.05);
        });
    }

    test('the same model drains a held prayer once every 5 ticks', () => {
        // sanity check of the model itself: a burst period of 5 is not flat
        let drained = 0;
        let timer = 0;
        for (let t = 1; t <= 400; t++) if (t - timer >= DRAIN_TIMER) { drained++; timer = t; }
        expect(drained).toBe(80);
    });

    test('consumeIsSafe: phase 1 at period 4 is safe, phase 2 is not', () => {
        expect(consumeIsSafe(0, 1, 4)).toBe(true);
        expect(consumeIsSafe(0, 2, 4)).toBe(false);
        expect(consumeIsSafe(0, 0, 3)).toBe(true);
    });
});
