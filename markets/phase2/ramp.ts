/**
 * The knights ramp (rs/495's condition on plan A): 43 logins on the 4 market knights has never been tested (the
 * lab measured 1-8 bots, the live probe one login among ~53 other players), so the runner brings knights logins
 * online in steps and checks each step's rate per login against the first's. Pure; the clock and the rates are
 * passed in, so a test drives it with a fake rate source.
 *
 * A step opens (its logins are admitted), then holds for `holdMinutes` once every admitted login is pickpocketing
 * (or `admitTimeoutMinutes` after it opened), then is evaluated: the median gp a tick per login over the hold.
 * The first step's median is the reference. A later step whose median is more than `dropPct` below it stops the
 * ramp: no more knights logins, and the ones not yet admitted go to the fallback mix. A step with no login
 * measured goes back to admitting (its timeout counted afresh) rather than deciding on nothing.
 *
 * The runner opens the ramp when the first knights login reaches admission, not when the run starts: setup takes
 * tens of minutes, and a timeout counted from the start would open the first hold before any knight arrived.
 */
import { median } from '../lib/market.ts';
import type { RampPlan } from './plan.ts';

export type RampPhase = 'admitting' | 'holding' | 'done' | 'stopped';

export interface RampDecision {
    kind: 'ramp';
    /** 1-based step evaluated. */
    step: number;
    /** Knights logins admitted at this step. */
    logins: number;
    /** gp a tick of each login measured over the hold. */
    rates: number[];
    /** The same rates by alias. */
    perLogin: Record<string, number>;
    median: number;
    /**
     * Logins measured in both the first step and this one: how many, and the median of each one's rate now over its
     * rate then. Unaffected by who joined, so it separates crowding (the incumbents slow down) from newcomers that
     * earn less. Null at the first step or with no login in both.
     */
    incumbents: { logins: number; ratio: number } | null;
    /** The first step's median; null until the first step is measured. */
    firstMedian: number | null;
    /** median / firstMedian. */
    ratio: number | null;
    action: 'next' | 'stop' | 'done' | 'repeat';
    reason: string;
    holdStart: number;
    holdEnd: number;
}

export class KnightsRamp {
    phase: RampPhase;
    private step = 0;
    private openedAt: number;
    holdStart: number | null = null;
    private first: number | null = null;
    private firstPerLogin: Record<string, number> | null = null;
    readonly decisions: RampDecision[] = [];

    constructor(
        private readonly cfg: Pick<RampPlan, 'steps' | 'holdMinutes' | 'dropPct' | 'admitTimeoutMinutes'>,
        now: number
    ) {
        this.openedAt = now;
        this.phase = cfg.steps.length === 0 ? 'done' : 'admitting';
    }

    /** Knights logins admitted now (cumulative). */
    admitted(): number {
        return this.cfg.steps[this.step] ?? 0;
    }

    /** 1-based step now open. */
    get stepNumber(): number {
        return this.step + 1;
    }

    /** Start the hold once every admitted login works the knights, or the admission timeout has passed. Returns true when it starts. */
    update(now: number, allWorking: boolean): boolean {
        if (this.phase !== 'admitting') return false;
        if (!allWorking && now < this.openedAt + this.cfg.admitTimeoutMinutes * 60_000) return false;
        this.phase = 'holding';
        this.holdStart = now;
        return true;
    }

    holdDue(now: number): boolean {
        return this.phase === 'holding' && this.holdStart !== null && now >= this.holdStart + this.cfg.holdMinutes * 60_000;
    }

    /** Evaluate the hold that has just ended with each measured login's gp a tick, by alias (`holdRates`). */
    evaluate(perLogin: Readonly<Record<string, number>>, now: number): RampDecision {
        if (this.phase !== 'holding' || this.holdStart === null) throw new Error(`the ramp is ${this.phase}, not holding`);
        const rates = Object.values(perLogin);
        const m = median([...rates]);
        if (rates.length > 0 && this.firstPerLogin === null) this.firstPerLogin = { ...perLogin };
        const incumbents = this.decisions.some(d => d.rates.length > 0) && this.firstPerLogin ? incumbentRatio(this.firstPerLogin, perLogin) : null;
        const base = { kind: 'ramp' as const, step: this.stepNumber, logins: this.admitted(), rates, perLogin: { ...perLogin }, median: m, incumbents, holdStart: this.holdStart, holdEnd: now };
        let d: RampDecision;
        if (rates.length === 0) {
            d = { ...base, firstMedian: this.first, ratio: null, action: 'repeat', reason: 'no login was measured over the whole hold; waiting for the step again' };
            this.phase = 'admitting';
            this.openedAt = now;
            this.holdStart = null;
        } else {
            if (this.first === null) this.first = m;
            const ratio = this.first > 0 ? m / this.first : null;
            const last = this.step >= this.cfg.steps.length - 1;
            if (ratio !== null && ratio < 1 - this.cfg.dropPct / 100) {
                d = { ...base, firstMedian: this.first, ratio, action: 'stop', reason: `median ${m.toFixed(2)} gp/tick is ${((1 - ratio) * 100).toFixed(1)}% below the first step's ${this.first.toFixed(2)} (limit ${this.cfg.dropPct}%): no more knights logins` };
                this.phase = 'stopped';
            } else if (last) {
                d = { ...base, firstMedian: this.first, ratio, action: 'done', reason: 'every knights login is admitted' };
                this.phase = 'done';
            } else {
                d = { ...base, firstMedian: this.first, ratio, action: 'next', reason: `within ${this.cfg.dropPct}% of the first step: admitting up to ${this.cfg.steps[this.step + 1]}` };
                this.step++;
                this.phase = 'admitting';
                this.openedAt = now;
                this.holdStart = null;
            }
        }
        this.decisions.push(d);
        return d;
    }
}

/** Each login's own rate now over its rate in `first`, for the logins in both: how many, and the median ratio. */
export function incumbentRatio(first: Readonly<Record<string, number>>, now: Readonly<Record<string, number>>): { logins: number; ratio: number } | null {
    const r = Object.keys(now).flatMap(a => (first[a] !== undefined && first[a]! > 0 ? [now[a]! / first[a]!] : []));
    return r.length ? { logins: r.length, ratio: median(r) } : null;
}

export interface RampReading {
    at: number;
    session: number;
    tick: number;
    coins: number;
    /** Cumulative ticks this session spent at the knights (pickpocket.ts's thieve errand), when counted. */
    work?: number;
}

/** A login spending less than this share of a window at the knights is not measuring the knights. */
export const MIN_WORK_SHARE = 0.5;

/**
 * gp a tick at the knights between two readings: coins over the ticks spent in the thieve errand, so the bank trips
 * (for food, and to deposit at `bankAt`) and the walks back are left out. Null across sessions, without work counts,
 * or when under MIN_WORK_SHARE of the window was spent at the knights.
 */
export function workRate(a: RampReading, b: RampReading): number | null {
    if (a.session !== b.session || a.work === undefined || b.work === undefined || b.tick <= a.tick) return null;
    const w = b.work - a.work;
    if (w <= 0 || w < MIN_WORK_SHARE * (b.tick - a.tick)) return null;
    return (b.coins - a.coins) / w;
}

export interface HoldLogin {
    alias: string;
    /** When the login last reached its method (ms); null when it is off it now. */
    methodAt: number | null;
    /** Its coin readings on the method, oldest first. */
    readings: readonly RampReading[];
}

/**
 * Each login's gp a tick over a hold that began at `start`: from its first reading at or after the later of `start`
 * and the end of its warm-up (`warmupMs` after it reached the method) to its last reading. A login measured over
 * less than `minSpanMs` is left out, as is one with no two readings in one session. `measure` 'knights' (the step
 * rule's) gives the rate at the knights from readings with work counts (`workRate`); 'gross', or readings without
 * them, the rate over the whole window (`rateBetween`), bank trips included: the income figure.
 *
 * Both guard the comparison against what is not crowding (docs/markets/phase2.md 'Knights crowding'). The warm-up
 * keeps a login's arrival out: it reaches the method at the Ardougne docks with no food, so its first minutes are
 * the walk to the bank and back. Live, a hold that began 22 s after the last newcomer arrived read the newcomers at
 * 12.5 gp a tick against the incumbents' 15.6. The rate at the knights keeps the bank trips out: a knight deposits
 * every ~21 minutes (50,000 coins carried), longer than a hold, so a wall-clock hold catches some logins' deposit
 * trip and not others'; in the lab the step-1 knights read 11% lower in step 2 for that alone.
 */
export function holdRates(logins: readonly HoldLogin[], start: number, warmupMs: number, minSpanMs: number, measure: 'knights' | 'gross' = 'knights'): Record<string, number> {
    const out: Record<string, number> = {};
    for (const l of logins) {
        const from = l.methodAt === null ? start : Math.max(start, l.methodAt + warmupMs);
        const a = l.readings.find(x => x.at >= from);
        const b = l.readings.at(-1);
        if (!a || !b || b.at - a.at < minSpanMs) continue;
        const v = measure === 'knights' && a.work !== undefined && b.work !== undefined ? workRate(a, b) : rateBetween(a, b);
        if (v !== null) out[l.alias] = v;
    }
    return out;
}

/** gp a tick of a login between two coin readings in the same session; null when it cannot be measured. */
export function rateBetween(a: { session: number; tick: number; coins: number } | undefined, b: { session: number; tick: number; coins: number } | undefined): number | null {
    if (!a || !b || a.session !== b.session || b.tick <= a.tick) return null;
    return (b.coins - a.coins) / (b.tick - a.tick);
}
