// Zero-drain prayer flicking: wanted prayers stay up and prayer points stay flat.
//
// The drain (prayer.rs2) is a 5-tick timer started when a prayer goes on from
// all-off and cleared when the last one goes off. A burst that turns every
// wanted prayer off and the first one back on in one tick therefore restarts
// it, and a burst at least every 4 ticks means it never fires: zero drain,
// measured flat in every flicked run (rs/59 prayer-flick.ts, rs/91 cannon-kit.ts).
//
// The schedule, by phase = ticks since the last burst:
//   phase 0  each wanted prayer believed on: off; then the first back on;
//            the attack re-sent behind the toggles (each one runs p_clearpendingaction)
//   phase 1  the rest back on, then the attack again (two or more prayers)
//   other    free ticks for the caller's other clicks
// Three prayers and an attack are the server's 5 user events a tick on phase 0
// (NetworkPlayer.ts), which is why the rest wait for phase 1.
//
// A sip or an eat holds the player in a p_delay over the next two ticks, and a
// prayer button sent then is dropped (protected access, Player.ts canAccess),
// leaving the prayer on for the timer to fire. So a consume goes on phase 1
// after its toggles (phase 0 with one prayer), and the next burst moves past the
// two blocked ticks when the period is shorter than that leaves room for.
//
// The scheduler decides from what it sent (the published prayer state shows a
// toggle a tick or two late) and checks that belief against the published state
// once its own toggles are old enough to show: a prayer believed on but shown
// off (a dropped on) is switched on again, and one believed off but shown on (a
// dropped off) is believed on, so the next burst turns it off.
//
// It runs SDK-side: the burst only has to land within the 4-tick window, which a
// steady one-tick round trip does. `period: 3` leaves a tick of slack for a path
// whose latency jitters (the relay).

import { PRAYER_INDICES, PRAYER_NAMES, type BotWorldState, type PrayerName } from '../../sdk/types';

export const DRAIN_TIMER = 5;
/** The longest period that keeps every burst inside the drain timer. */
export const MAX_PERIOD = DRAIN_TIMER - 1;
/** Ticks a consume's p_delay drops prayer buttons for, after the consume's own tick. */
export const CONSUME_BLOCK = 2;
/** Ticks before a sent toggle can be trusted to show in the published state. */
export const SHOW_LAG = 2;

export interface FlickOptions {
    /** The wanted prayers; the first is the one switched back on in the burst itself (the protect prayer). */
    prayers: readonly PrayerName[];
    /** Ticks between bursts, 1 to 4 (default 4). */
    period?: number;
}

export interface FlickPlan {
    /** Prayer buttons to send this tick, in order. */
    toggles: PrayerName[];
    /** A burst tick: re-send the attack after the toggles. */
    attack: boolean;
    /** A sip or an eat may go this tick, after the toggles (then call `consumed`). */
    consume: boolean;
    /** No prayer button is due this tick or blocked by a consume: other clicks may go. */
    free: boolean;
    /** Phase in the cycle, 0 on a burst. */
    phase: number;
}

const isOn = (s: BotWorldState, p: PrayerName) => s.prayers?.activePrayers?.[PRAYER_INDICES[p]] === true;

export class FlickScheduler {
    prayers: readonly PrayerName[];
    readonly period: number;
    /** Bursts sent. */
    bursts = 0;
    /** Toggles re-sent because the published state disagreed with what was sent. */
    restores = 0;
    private believed = new Set<PrayerName>();
    private origin: number | null = null;
    private nextBurst = -Infinity;
    private blockedUntil = -Infinity;
    private lastToggle = -Infinity;

    constructor(o: FlickOptions) {
        if (o.prayers.length === 0) throw new Error('FlickScheduler: no prayers');
        const period = o.period ?? MAX_PERIOD;
        if (!Number.isInteger(period) || period < 1 || period > MAX_PERIOD) throw new Error(`FlickScheduler: period must be 1 to ${MAX_PERIOD}, got ${o.period}`);
        if (o.prayers.length > 1 && period < 2) throw new Error('FlickScheduler: two or more prayers need a period of at least 2');
        this.prayers = [...o.prayers];
        this.period = period;
    }

    /**
     * Change the wanted prayers (a phase change). Prayers that are on and no
     * longer wanted go off in the next burst with the rest, which comes at once.
     */
    setPrayers(prayers: readonly PrayerName[]): void {
        if (prayers.length === 0) throw new Error('FlickScheduler: no prayers');
        if (prayers.length > 1 && this.period < 2) throw new Error('FlickScheduler: two or more prayers need a period of at least 2');
        if (prayers.length === this.prayers.length && prayers.every((p, i) => p === this.prayers[i])) return;
        this.prayers = [...prayers];
        this.nextBurst = -Infinity;
    }

    /** The prayers the scheduler believes are on. */
    get on(): ReadonlySet<PrayerName> {
        return this.believed;
    }

    private toggle(p: PrayerName, out: PrayerName[], tick: number) {
        out.push(p);
        if (this.believed.has(p)) this.believed.delete(p);
        else this.believed.add(p);
        this.lastToggle = tick;
    }

    /** The plan for the tick `s` was published for. Call once per tick. */
    plan(s: BotWorldState): FlickPlan {
        const t = s.tick;
        const toggles: PrayerName[] = [];
        const points = s.prayers?.prayerPoints ?? 0;
        // Every prayer shown on counts at the start, wanted or not: the first burst turns them all off.
        if (this.origin === null) for (const p of PRAYER_NAMES) if (isOn(s, p)) this.believed.add(p);

        const blocked = t <= this.blockedUntil;
        if (!blocked && t - this.lastToggle >= SHOW_LAG && this.origin !== null) {
            for (const p of this.prayers) {
                const shown = isOn(s, p);
                if (this.believed.has(p) && !shown && points > 0 && t - this.origin !== 0) {
                    // A dropped on: send it again (not on a burst tick, which turns it off anyway).
                    this.believed.delete(p);
                    this.toggle(p, toggles, t);
                    this.restores++;
                } else if (!this.believed.has(p) && shown) {
                    this.believed.add(p); // a dropped off: the next burst turns it off
                }
            }
        }

        const due = this.origin === null || t >= this.nextBurst;
        if (due && !blocked && toggles.length === 0) {
            this.origin = t;
            this.nextBurst = t + this.period;
            this.bursts++;
            for (const p of PRAYER_NAMES) if (this.believed.has(p)) this.toggle(p, toggles, t);
            if (points > 0) this.toggle(this.prayers[0]!, toggles, t);
            return { toggles, attack: true, consume: this.prayers.length === 1, free: false, phase: 0 };
        }
        const phase = this.origin === null ? 0 : t - this.origin;
        if (phase === 1 && this.prayers.length > 1 && !blocked) {
            if (points > 0) for (const p of this.prayers.slice(1)) if (!this.believed.has(p)) this.toggle(p, toggles, t);
            return { toggles, attack: true, consume: true, free: false, phase };
        }
        const consume = !blocked && this.prayers.length === 1 && phase === 1;
        return { toggles, attack: false, consume, free: !blocked && toggles.length === 0, phase };
    }

    /**
     * The caller sent a sip or an eat on tick `t` (a tick whose plan allowed it).
     * Buttons are dropped for the next CONSUME_BLOCK ticks, so the next burst
     * moves to the first tick after them if it fell inside.
     */
    consumed(t: number): void {
        this.blockedUntil = t + CONSUME_BLOCK;
        if (this.nextBurst <= this.blockedUntil) this.nextBurst = this.blockedUntil + 1;
    }

    /** Buttons to switch every wanted prayer off (the end of a session), and forget them. */
    allOff(s: BotWorldState): PrayerName[] {
        const out = PRAYER_NAMES.filter(p => isOn(s, p));
        this.believed.clear();
        this.origin = null;
        this.nextBurst = -Infinity;
        return out;
    }
}

/**
 * The ticks a consume on tick `c` leaves the drain timer: the burst before it
 * started the timer at `origin`, and the next can come no earlier than
 * c + CONSUME_BLOCK + 1. Zero drain needs that to be within MAX_PERIOD.
 */
export function consumeIsSafe(origin: number, c: number, period: number): boolean {
    return Math.max(origin + period, c + CONSUME_BLOCK + 1) - origin <= MAX_PERIOD;
}
