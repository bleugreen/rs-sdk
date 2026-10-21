// Fixed-window bank deposits, not first-to-last snapshots within the window.
// bun docs/speedrun/scripts/bones-dev/stats.ts SINCE_ISO UNTIL_ISO [bone name] [accounts...]
import { readdirSync, readFileSync } from 'node:fs';

interface RecordLine {
    t: string;
    bank?: { name: string; count: number }[];
    message?: string;
    trip?: { min: number; roomMin: number; eats: number; kills: number } | null;
    carried?: { bones: number };
    out?: string;
    ticks?: number;
    [key: string]: unknown;
}

const quantiles = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? null;
    return { n: sorted.length, p10: q(0.1), p50: q(0.5), p90: q(0.9) };
};

export function summarizeWindow(lines: RecordLine[], since: string, until: string, bone = 'Babydragon bones') {
    const start = Date.parse(since), end = Date.parse(until);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('expected increasing ISO window boundaries');
    const sorted = [...lines].sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
    const snapshots = sorted.filter(l => Array.isArray(l.bank));
    const baseline = snapshots.filter(l => Date.parse(l.t) < start).at(-1);
    const last = snapshots.filter(l => Date.parse(l.t) < end).at(-1);
    const count = (l: RecordLine) => l.bank!.find(i => i.name === bone)?.count ?? 0;
    const window = sorted.filter(l => Date.parse(l.t) >= start && Date.parse(l.t) < end);
    const stockChanges = snapshots.filter(l => Date.parse(l.t) >= start && Date.parse(l.t) < end);
    let previous = baseline;
    let decrease = false;
    for (const snapshot of stockChanges) {
        if (previous && count(snapshot) < count(previous)) decrease = true;
        previous = snapshot;
    }
    // A missing pre-window baseline or any withdrawal prevents attributing net growth to production.
    const banked = baseline && last && !decrease ? count(last) - count(baseline) : null;
    const hours = (end - start) / 3_600_000;
    const trips = window.filter(l => l.message === 'banked' && l.trip && l.trip.kills > 0);
    const noteworthy = new Set(['died', 'cycle error', 'coins received', 'waiting for coins', 'start', 'stopped', 'fleeing']);
    return {
        since, until, hours, baselineAt: baseline?.t ?? null, baseline: baseline ? count(baseline) : null,
        lastBankAt: last?.t ?? null, stock: last ? count(last) : null, banked,
        perHour: banked === null ? null : banked / hours, stockDecreased: decrease,
        visits: window.filter(l => l.message === 'banked').length,
        deaths: window.filter(l => l.message === 'died').length,
        tripMin: quantiles(trips.map(l => l.trip!.min)),
        roomMin: quantiles(trips.map(l => l.trip!.roomMin)),
        bonesPerTrip: quantiles(trips.map(l => l.carried?.bones ?? 0)),
        // Trace covers one fight invocation (attack through loot), not an engine attack interval.
        fightTicks: quantiles(window.filter(l => l.message === 'fight' && l.out === 'killed' && typeof l.ticks === 'number').map(l => l.ticks!)),
        notable: window.filter(l => noteworthy.has(l.message ?? '') || l.to === 'downgrade')
            .map(l => ({ t: l.t, message: l.message, to: l.to, coins: l.coins, error: l.error }))
    };
}

if (import.meta.main) {
    const [since, until, bone = 'Babydragon bones', ...accounts] = process.argv.slice(2);
    if (!since || !until) throw new Error('usage: stats.ts SINCE_ISO UNTIL_ISO [bone name] [accounts...]');
    const results = readdirSync('logs')
        .filter(f => /^role-cairn_h5[1-4]\.log$/.test(f))
        .filter(f => accounts.length === 0 || accounts.includes(f.slice(5, -4)))
        .sort().map(file => {
            const lines = readFileSync(`logs/${file}`, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l) as RecordLine);
            return { account: file.slice(5, -4), ...summarizeWindow(lines, since, until, bone) };
        });
    for (const result of results) console.log(JSON.stringify(result));
    const complete = results.length > 0 && results.every(r => r.banked !== null);
    const total = complete ? results.reduce((n, r) => n + r.banked!, 0) : null;
    const hours = (Date.parse(until) - Date.parse(since)) / 3_600_000;
    console.log(JSON.stringify({ accounts: results.length, total, totalPerHour: total === null ? null : total / hours,
        meanPerAccountHour: total === null ? null : total / hours / results.length }));
}
