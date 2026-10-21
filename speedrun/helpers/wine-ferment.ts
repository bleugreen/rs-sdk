// Model of the fermenting_wine timer (wine.rs2) for planning the scored account's
// wine delivery (cairn://p/rs/47, docs/speedrun/helpers/wine.md).
//
// When the timer fires, the bank's unfermented wines are rolled in 15 equal
// batches of floor(N/15), then the N % 15 remainder one by one, then the
// inventory's one by one. Each roll is stat_random(cooking, 48, 352) at the
// CURRENT level, and a success adds 110 xp per wine in the batch (times the
// server's xp rate) before the next roll. A batch is all-or-nothing, so 450
// wines at Cooking 1 are fifteen 30-wine rolls at about 19% for the first.
//
//   bun speedrun/helpers/wine-ferment.ts [trials]   prints the plan table

/** Experience thresholds in tenths, levels 2..99 (Player.ts levelExperience). */
export const LEVEL_TENTHS: readonly number[] = (() => {
    const out: number[] = [];
    let acc = 0;
    for (let level = 1; level <= 99; level++) {
        acc += Math.floor(level + Math.pow(2, level / 10) * 300);
        out.push(Math.floor(acc / 4) * 10);
    }
    return out;
})();

export function levelOf(tenths: number): number {
    for (let i = 98; i >= 0; i--) if (tenths >= LEVEL_TENTHS[i]!) return Math.min(i + 2, 99);
    return 1;
}

/** stat_random(stat, low, high) success chance at `level` (PlayerOps.ts STAT_RANDOM). */
export function rollChance(level: number, low = 48, high = 352): number {
    const l = Math.min(level, 99);
    const value = Math.floor((low * (99 - l)) / 98) + Math.floor((high * (l - 1)) / 98) + 1;
    return Math.min(1, value / 256);
}

export const WINE_TENTHS = 1100;

export interface FermentOutcome {
    tenths: number;
    good: number;
    bad: number;
}

/** One firing of the timer over `bank` unfermented wines in the bank (none in the inventory). */
export function fermentBank(bank: number, tenths: number, xpRate: number, rng: () => number = Math.random): FermentOutcome {
    let good = 0;
    const roll = (n: number) => {
        if (rng() < rollChance(levelOf(tenths))) {
            good += n;
            tenths += WINE_TENTHS * n * xpRate;
        }
    };
    const per = Math.floor(bank / 15);
    if (per > 0) for (let i = 0; i < 15; i++) roll(per);
    for (let i = 0; i < bank % 15; i++) roll(1);
    return { tenths, good, bad: bank - good };
}

/** Ferment the deliveries in order, each in its own firing, from `startTenths`. */
export function fermentPlan(firings: readonly number[], xpRate: number, rng: () => number = Math.random, startTenths = 0): FermentOutcome & { levels: number[] } {
    let tenths = startTenths;
    let good = 0;
    let bad = 0;
    const levels: number[] = [];
    for (const n of firings) {
        const r = fermentBank(n, tenths, xpRate, rng);
        tenths = r.tenths;
        good += r.good;
        bad += r.bad;
        levels.push(levelOf(tenths));
    }
    return { tenths, good, bad, levels };
}

/** Good wines needed for 99 from 0 xp at `xpRate`, if every roll succeeded. */
export function perfectWinesFor99(xpRate: number): number {
    return Math.ceil(LEVEL_TENTHS[97]! / (WINE_TENTHS * xpRate));
}

export interface PlanStats {
    plan: string;
    wines: number;
    p99: number;
    meanLevel: number;
    p5Level: number;
    /** Chance the level after the first firing is below 35 (the re-arming make needs 35). */
    pFirstBelow35: number;
    meanFirstLevel: number;
    minFirstLevel: number;
}

export function simulate(firings: readonly number[], xpRate: number, trials: number, rng: () => number = Math.random): PlanStats {
    let hit = 0;
    let below35 = 0;
    let firstSum = 0;
    let firstMin = 99;
    let levelSum = 0;
    const finals: number[] = [];
    for (let t = 0; t < trials; t++) {
        const r = fermentPlan(firings, xpRate, rng);
        const final = levelOf(r.tenths);
        finals.push(final);
        levelSum += final;
        if (final >= 99) hit++;
        const first = r.levels[0]!;
        firstSum += first;
        firstMin = Math.min(firstMin, first);
        if (first < 35) below35++;
    }
    finals.sort((a, b) => a - b);
    return {
        plan: firings.join(' + '),
        wines: firings.reduce((a, b) => a + b, 0),
        p99: hit / trials,
        meanLevel: levelSum / trials,
        p5Level: finals[Math.floor(trials * 0.05)]!,
        pFirstBelow35: below35 / trials,
        meanFirstLevel: firstSum / trials,
        minFirstLevel: firstMin
    };
}

if (import.meta.main) {
    const trials = Number(process.argv[2] ?? 20_000);
    const rate = Number(process.env.NODE_XPRATE ?? 25);
    console.log(`xp rate ${rate}: ${perfectWinesFor99(rate)} perfect wines reach 99; ${trials} trials per plan`);
    const plans = [[400], [450], [520], [600], [10, 440], [15, 435], [20, 430], [30, 420], [30, 490], [45, 405], [60, 390], [15, 60, 375], [30, 120, 300]];
    console.log('plan | wines | P(99) | mean level | 5th pct level | first firing: mean / min level | P(first < 35)');
    for (const p of plans) {
        const s = simulate(p, rate, trials);
        console.log(`${s.plan} | ${s.wines} | ${(s.p99 * 100).toFixed(1)}% | ${s.meanLevel.toFixed(1)} | ${s.p5Level} | ${s.meanFirstLevel.toFixed(1)} / ${s.minFirstLevel} | ${(s.pFirstBelow35 * 100).toFixed(2)}%`);
    }
}
