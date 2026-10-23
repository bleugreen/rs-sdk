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
 * measured holds again rather than deciding on nothing.
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
    median: number;
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

    /** Evaluate the hold that has just ended with each measured login's gp a tick. */
    evaluate(rates: readonly number[], now: number): RampDecision {
        if (this.phase !== 'holding' || this.holdStart === null) throw new Error(`the ramp is ${this.phase}, not holding`);
        const m = median([...rates]);
        const base = { kind: 'ramp' as const, step: this.stepNumber, logins: this.admitted(), rates: [...rates], median: m, holdStart: this.holdStart, holdEnd: now };
        let d: RampDecision;
        if (rates.length === 0) {
            d = { ...base, firstMedian: this.first, ratio: null, action: 'repeat', reason: 'no login was measured over the whole hold; holding again' };
            this.holdStart = now;
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

/** gp a tick of a login between two coin readings in the same session; null when it cannot be measured. */
export function rateBetween(a: { session: number; tick: number; coins: number } | undefined, b: { session: number; tick: number; coins: number } | undefined): number | null {
    if (!a || !b || a.session !== b.session || b.tick <= a.tick) return null;
    return (b.coins - a.coins) / (b.tick - a.tick);
}
