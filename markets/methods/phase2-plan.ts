#!/usr/bin/env bun
/**
 * Phase-2 allocation arithmetic (docs/markets/phase2.md): capital each method earns over a horizon on one address,
 * with each fresh login's setup time subtracted and a shared one-off cap (a finite bid, a world clock) applied.
 *
 *   bun markets/methods/phase2-plan.ts
 *
 * The rates are the doc's planning figures; their provenance (measured, live or inferred) is in the doc's tables.
 */

export interface PlanRow {
    method: string;
    logins: number;
    /** Net coins an hour per login at this crowding, inputs paid at live prices. */
    perLogin: number;
    /** Login-hours of setup before a fresh account earns `perLogin`. */
    setupHours: number;
    /** Coins the shared outlet holds for these logins together before it binds (a bid's depth, net), if finite. */
    capCoins?: number;
    /** Net coins an hour per login once the cap binds (the method's fallback outlet). */
    afterCap?: number;
}

/** Hours from the phase's start until the row's shared cap binds, or Infinity. */
export function capHours(r: PlanRow): number {
    if (r.capCoins === undefined || r.logins === 0 || r.perLogin <= 0) return Infinity;
    return r.setupHours + r.capCoins / (r.logins * r.perLogin);
}

/** Coins a row's logins earn together in the first `hours` of the phase. */
export function horizonCapital(r: PlanRow, hours: number): number {
    const worked = Math.max(0, hours - r.setupHours);
    const full = r.logins * r.perLogin * worked;
    if (r.capCoins === undefined || full <= r.capCoins) return full;
    const tCap = r.capCoins / (r.logins * r.perLogin);
    return r.capCoins + r.logins * (r.afterCap ?? 0) * (worked - tCap);
}

/** The horizon (hours) after which `a` has earned more per login than `b`, from setup alone; null if never. */
export function crossover(a: Pick<PlanRow, 'perLogin' | 'setupHours'>, b: Pick<PlanRow, 'perLogin' | 'setupHours'>): number | null {
    // a.perLogin (H - a.setup) = b.perLogin (H - b.setup)
    const d = a.perLogin - b.perLogin;
    if (d === 0) return null;
    const h = (a.perLogin * a.setupHours - b.perLogin * b.setupHours) / d;
    return h > Math.max(a.setupHours, b.setupHours) ? h : null;
}

export const HORIZONS = [6, 24, 72] as const;

// Planning figures (docs/markets/phase2.md 'Per-login rates'), coins an hour per login, net of inputs.
const KNIGHTS = 104_000; // live at-knights 118.5k less 26 sharks/h at the 533 ask
const HEROES = 73_000; // lab 94k coins + blood and death runes sold, less 110 sharks/h at 533
const GUARDS = 60_000; // rs/502 62.9k, kebabs
const IRON = 91_800; // 1,208 ore/h into the iron bid at its 80 mean, less 5%
const STEEL = 208_000; // 160 bars/h at the 7-day flow's 1,369, less 5%
const SHILO_SHARED = 301_000; // 233 gems/h (one regular on the site) x 1,291 a gem with the jade bid
const SHILO_AFTER_JADE = 171_000;

/** Allocation A: knights allowed. */
export const WITH_KNIGHTS: PlanRow[] = [
    { method: 'Shilo gem rocks', logins: 1, perLogin: SHILO_SHARED, setupHours: 0.8, capCoins: 3768 * 2375 * (64 / 30) * 0.583 * 0 + 9_000_000, afterCap: SHILO_AFTER_JADE },
    { method: 'Steel bars', logins: 1, perLogin: STEEL, setupHours: 0.2 },
    { method: 'Knights of Ardougne', logins: 43, perLogin: KNIGHTS, setupHours: 0.3 }
];

/** Allocation B: knights left free for S18. */
export const WITHOUT_KNIGHTS: PlanRow[] = [
    { method: 'Shilo gem rocks', logins: 1, perLogin: SHILO_SHARED, setupHours: 0.8, capCoins: 9_000_000, afterCap: SHILO_AFTER_JADE },
    { method: 'Steel bars', logins: 1, perLogin: STEEL, setupHours: 0.2 },
    { method: 'Iron ore', logins: 12, perLogin: IRON, setupHours: 0.1, capCoins: 400_000 * 76, afterCap: GUARDS },
    { method: 'Heroes', logins: 8, perLogin: HEROES, setupHours: 0.35 },
    { method: 'Varrock guards', logins: 23, perLogin: GUARDS, setupHours: 0.25 }
];

function main(): void {
    const fmt = (n: number) => (n / 1e6).toFixed(2) + 'M';
    for (const [name, rows] of [['with knights', WITH_KNIGHTS], ['without knights', WITHOUT_KNIGHTS]] as const) {
        console.log(`\n${name}: ${rows.reduce((s, r) => s + r.logins, 0)} logins`);
        console.log('| Method | Logins | Net coins/h per login | Setup h | Cap binds at h | 6 h | 24 h | 72 h |\n|---|---|---|---|---|---|---|---|');
        for (const r of rows) {
            const ch = capHours(r);
            console.log(`| ${r.method} | ${r.logins} | ${r.perLogin.toLocaleString('en-US')} | ${r.setupHours} | ${Number.isFinite(ch) ? ch.toFixed(1) : '-'} | ${HORIZONS.map(h => fmt(horizonCapital(r, h))).join(' | ')} |`);
        }
        console.log(`| **Total** | | | | | ${HORIZONS.map(h => fmt(rows.reduce((s, r) => s + horizonCapital(r, h), 0))).join(' | ')} |`);
    }
}

if (import.meta.main) main();
