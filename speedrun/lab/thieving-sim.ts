#!/usr/bin/env bun
/**
 * Monte Carlo of a from-creation Thieving 1-99 (skills/thieving.ts's route) for the release gate:
 * P(total < the #1's ticks). Every input is stated here or on the command line.
 *
 *   bun speedrun/lab/thieving-sim.ts [--n=20000] [--seed=1] [--bar=2935] [--route=module|farmers-lum]
 *       [--fixed=<ticks>] [--overhead=men:0.1,warrior:0.1,guard:0.1,farmer:0.1,knight:0.15] [--json]
 *
 * Per roll (read: pickpocket.rs2 / thieving.rs2 / PlayerOps.ts stat_random; measured: thieving.md
 * section 4): success with p(L) = (floor(lo(99-L)/98) + floor(hi(L-1)/98) + 1) / 256 on the
 * current level; a success costs 2 ticks and a failure stun + 3 (11); a failure deals the target's
 * fixed damage. Eating follows the module's eatPolicy at a 10 HP cap with cake (4 per bite): free
 * with the click after a success at or below eatBelow, and forced at or below forcedBelow, which
 * inside the stun costs 3 ticks (consume.rs2). Hitpoints regenerate 1 per 100 ticks. Walking after
 * a wandering target is `overhead` ticks per roll by target (calibrated against the lab).
 * `fixed` is every tick that is not a roll: tutorial skip, kit, the leg, the bank stop and the
 * walks between bands (measured in the lab).
 */
export const LEVEL_BASE: number[] = [0, 0];
{
    let acc = 0;
    for (let level = 1; level < 99; level++) {
        acc += Math.floor(level + Math.pow(2, level / 10) * 300);
        LEVEL_BASE[level + 1] = Math.floor(acc / 4) / 25;
    }
}
export const levelOf = (xp: number) => { let l = 1; while (l < 99 && LEVEL_BASE[l + 1]! <= xp) l++; return l; };

/** pickpocket.dbrow (read): base xp per success, stun ticks, damage, success lo/hi. */
export interface Target { xp: number; stun: number; dmg: number; lo: number; hi: number }
export const TARGETS: Record<string, Target> = {
    men: { xp: 8.0, stun: 8, dmg: 1, lo: 180, hi: 240 },
    farmer: { xp: 14.5, stun: 8, dmg: 1, lo: 150, hi: 240 },
    warrior: { xp: 26.0, stun: 8, dmg: 2, lo: 100, hi: 240 },
    guard: { xp: 46.8, stun: 8, dmg: 2, lo: 50, hi: 240 },
    knight: { xp: 84.3, stun: 8, dmg: 3, lo: 50, hi: 240 }
};
export const pSuccess = (t: Target, L: number) => (Math.floor((t.lo * (99 - L)) / 98) + Math.floor((t.hi * (L - 1)) / 98) + 1) / 256;

export interface SimBand { target: string; to: number }
export const ROUTES: Record<string, SimBand[]> = {
    module: [{ target: 'men', to: 25 }, { target: 'warrior', to: 40 }, { target: 'guard', to: 55 }, { target: 'knight', to: 99 }],
    'farmers-lum': [{ target: 'men', to: 10 }, { target: 'farmer', to: 25 }, { target: 'warrior', to: 40 }, { target: 'guard', to: 55 }, { target: 'knight', to: 99 }]
};

export interface SimOptions { route: SimBand[]; overhead: Record<string, number>; fixed: number; maxHp?: number; heal?: number }

/** xorshift32: a seeded generator so a run can be repeated exactly. */
export function rng(seed: number): () => number {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** The module's eatPolicy (skills/thieving.ts). */
const policy = (maxHp: number, heal: number, dmg: number) => ({ eatBelow: maxHp - Math.min(heal, maxHp - dmg - 1), forcedBelow: dmg });

export interface SimRun { total: number; bands: number[]; fails: number; stunEats: number }

export function simulate(o: SimOptions, rand: () => number): SimRun {
    const maxHp = o.maxHp ?? 10;
    const heal = o.heal ?? 4;
    let xp = 0, ticks = 0, hp = maxHp, regenAt = 100, fails = 0, stunEats = 0;
    const bands: number[] = [];
    for (const band of o.route) {
        const t = TARGETS[band.target]!;
        const { eatBelow, forcedBelow } = policy(maxHp, heal, t.dmg);
        const over = o.overhead[band.target] ?? 0;
        const start = ticks;
        while (levelOf(xp) < band.to) {
            const L = levelOf(xp);
            if (rand() < pSuccess(t, L)) {
                ticks += 2;
                xp += t.xp;
                if (hp <= eatBelow) hp = Math.min(maxHp, hp + heal);
            } else {
                ticks += t.stun + 3;
                fails++;
                hp -= t.dmg;
                if (hp <= forcedBelow) { hp = Math.min(maxHp, hp + heal); ticks += 3; stunEats++; }
            }
            // walking overhead, drawn so that its mean is `over` per roll
            if (over > 0 && rand() < over / Math.ceil(over)) ticks += Math.ceil(over);
            while (ticks >= regenAt) { hp = Math.min(maxHp, hp + 1); regenAt += 100; }
        }
        bands.push(ticks - start);
    }
    return { total: ticks + o.fixed, bands, fails, stunEats };
}

export function quantile(sorted: number[], q: number): number {
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]!;
}

if (import.meta.main) {
    const arg = (k: string, d: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
    const n = Number(arg('n', '20000'));
    const seed = Number(arg('seed', '1'));
    const bar = Number(arg('bar', '2935'));
    const routeName = arg('route', 'module');
    const route = ROUTES[routeName];
    if (!route) throw new Error(`unknown route ${routeName} (one of ${Object.keys(ROUTES).join(', ')})`);
    const overhead = Object.fromEntries(arg('overhead', 'men:0,farmer:0,warrior:0,guard:0,knight:0').split(',').map(kv => { const [k, v] = kv.split(':'); return [k!, Number(v)]; }));
    const fixed = Number(arg('fixed', '0'));
    const rand = rng(seed);
    const runs = Array.from({ length: n }, () => simulate({ route, overhead, fixed }, rand));
    const totals = runs.map(r => r.total).sort((a, b) => a - b);
    const mean = totals.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(totals.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
    const win = totals.filter(t => t < bar).length / n;
    const bandMeans = route.map((_, i) => Math.round(runs.reduce((a, r) => a + r.bands[i]!, 0) / n));
    const out = {
        route: routeName, n, seed, bar, fixed, overhead,
        mean: Math.round(mean), sd: Math.round(sd),
        p5: quantile(totals, 0.05), p10: quantile(totals, 0.1), p50: quantile(totals, 0.5), p90: quantile(totals, 0.9),
        pBeat: Math.round(win * 1000) / 1000,
        bands: Object.fromEntries(route.map((b, i) => [`${b.target}-${b.to}`, bandMeans[i]])),
        fails: Math.round(runs.reduce((a, r) => a + r.fails, 0) / n),
        stunEats: Math.round((runs.reduce((a, r) => a + r.stunEats, 0) / n) * 10) / 10
    };
    console.log(process.argv.includes('--json') ? JSON.stringify(out) : out);
}
