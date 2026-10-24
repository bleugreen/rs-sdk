// Summarises a headcount file (markets/scan/headcount.ts): per site, each rival's dwell, sessions and coverage of the
// window, the hourly distinct names (passers-by), accounts that arrived together, name families, and our own count.
//
//   bun markets/scan/headcount-report.ts FILE.jsonl [--gap=5] [--json=OUT.json]
//
// A session is a run of reads with the name present, allowing up to --gap missing reads inside it (a bank trip).
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { SiteRead } from './headcount.ts';

export interface Read {
    at: string;
    online: number;
    sites: Record<string, SiteRead>;
}

export interface RivalStats {
    name: string;
    reads: number;
    /** Share of the window's reads with the name present. */
    coverage: number;
    first: string;
    last: string;
    sessions: number;
    /** The longest session, first read to last, in minutes. */
    longestMin: number;
}

export interface SiteSummary {
    site: string;
    reads: number;
    readsWithRivals: number;
    rivals: { min: number; mean: number; max: number };
    ours: { min: number; mean: number; max: number };
    byRival: RivalStats[];
    hourly: { hour: string; reads: number; distinct: number; meanRivals: number; meanOurs: number }[];
    /** Names whose sessions began on the same read, two or more at a time. */
    coArrivals: { at: string; names: string[] }[];
}

export function parseHeadcount(text: string): { header: Record<string, unknown>; reads: Read[]; errors: number } {
    const lines = text.split('\n').filter(Boolean).map(l => JSON.parse(l));
    const [header, ...rest] = lines;
    const reads = rest.filter(r => r.sites) as Read[];
    return { header, reads, errors: rest.length - reads.length };
}

const stats = (xs: number[]) => ({ min: xs.length ? Math.min(...xs) : 0, mean: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0, max: xs.length ? Math.max(...xs) : 0 });

/** [start, end] read indices of each session of `present` (indices into the read list), joining gaps of up to `gap`. */
export function sessionsOf(present: number[], gap: number): [number, number][] {
    const out: [number, number][] = [];
    for (const i of present) {
        const last = out[out.length - 1];
        if (last && i - last[1] <= gap + 1) last[1] = i;
        else out.push([i, i]);
    }
    return out;
}

export function summariseSite(site: string, reads: Read[], gap = 5): SiteSummary {
    const here = reads.map(r => r.sites[site] ?? { ours: 0, rivals: [] });
    const seen = new Map<string, number[]>();
    here.forEach((s, i) => s.rivals.forEach(([name]) => seen.set(name, [...(seen.get(name) ?? []), i])));
    const minutes = (a: number, b: number) => (Date.parse(reads[b]!.at) - Date.parse(reads[a]!.at)) / 60_000;
    const starts = new Map<number, string[]>();
    const byRival: RivalStats[] = [...seen].map(([name, idx]) => {
        const sessions = sessionsOf(idx, gap);
        for (const [s] of sessions) if (s > 0) starts.set(s, [...(starts.get(s) ?? []), name]);
        return {
            name,
            reads: idx.length,
            coverage: idx.length / reads.length,
            first: reads[idx[0]!]!.at,
            last: reads[idx[idx.length - 1]!]!.at,
            sessions: sessions.length,
            longestMin: Math.max(...sessions.map(([a, b]) => minutes(a, b))),
        };
    }).sort((a, b) => b.reads - a.reads || a.name.localeCompare(b.name));
    const hours = new Map<string, number[]>();
    reads.forEach((r, i) => hours.set(r.at.slice(0, 13) + 'Z', [...(hours.get(r.at.slice(0, 13) + 'Z') ?? []), i]));
    return {
        site,
        reads: reads.length,
        readsWithRivals: here.filter(s => s.rivals.length).length,
        rivals: stats(here.map(s => s.rivals.length)),
        ours: stats(here.map(s => s.ours)),
        byRival,
        hourly: [...hours].map(([hour, idx]) => ({
            hour,
            reads: idx.length,
            distinct: new Set(idx.flatMap(i => here[i]!.rivals.map(([n]) => n))).size,
            meanRivals: stats(idx.map(i => here[i]!.rivals.length)).mean,
            meanOurs: stats(idx.map(i => here[i]!.ours)).mean,
        })),
        coArrivals: [...starts].filter(([, names]) => names.length >= 2).sort(([a], [b]) => a - b).map(([i, names]) => ({ at: reads[i]!.at, names: names.sort() })),
    };
}

/** A name's stem: lower case, trailing digits dropped (`Tygem020` -> `tygem`). */
export const stemOf = (name: string): string => name.toLowerCase().replace(/[\s_]*\d+$/, '');

/** Stems shared by two or more names, with their members. */
export function families(names: Iterable<string>): Record<string, string[]> {
    const by = new Map<string, Set<string>>();
    for (const n of names) by.set(stemOf(n), (by.get(stemOf(n)) ?? new Set()).add(n));
    return Object.fromEntries([...by].filter(([, m]) => m.size >= 2).map(([s, m]) => [s, [...m].sort()]).sort(([a], [b]) => a.localeCompare(b)));
}

if (import.meta.main) {
    const { values, positionals } = parseArgs({ args: Bun.argv.slice(2), allowPositionals: true, options: { gap: { type: 'string' }, json: { type: 'string' } } });
    const { header, reads, errors } = parseHeadcount(readFileSync(positionals[0]!, 'utf8'));
    const sites = (header.sites as { name: string }[]).map(s => s.name);
    const summaries = sites.map(s => summariseSite(s, reads, Number(values.gap ?? 5)));
    const fams = families(summaries.flatMap(s => s.byRival.map(r => r.name)));
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    console.log(`${reads.length} reads, ${errors} failed, ${reads[0]?.at} .. ${reads[reads.length - 1]?.at}; online ${stats(reads.map(r => r.online)).min}-${stats(reads.map(r => r.online)).max}`);
    for (const s of summaries) {
        console.log(`\n## ${s.site}: rivals ${s.rivals.min}-${s.rivals.max} (mean ${s.rivals.mean.toFixed(2)}), ours mean ${s.ours.mean.toFixed(2)} max ${s.ours.max}; ${s.readsWithRivals}/${s.reads} reads with a rival; ${s.byRival.length} names`);
        for (const r of s.byRival.slice(0, 25)) console.log(`  ${r.name}: ${r.reads} reads (${pct(r.coverage)}), ${r.sessions} sessions, longest ${Math.round(r.longestMin)} min, ${r.first.slice(11, 16)}-${r.last.slice(11, 16)}`);
        console.log(`  hourly distinct: ${s.hourly.map(h => `${h.hour.slice(11, 13)}h ${h.distinct}`).join(' ')}`);
        if (s.coArrivals.length) console.log(`  co-arrivals: ${s.coArrivals.map(c => `${c.at.slice(11, 16)} [${c.names.join(' ')}]`).join('; ')}`);
    }
    console.log(`\nfamilies: ${Object.entries(fams).map(([f, m]) => `${f}* (${m.length}: ${m.join(' ')})`).join('; ')}`);
    if (values.json) writeFileSync(values.json, JSON.stringify({ source: positionals[0], window: [reads[0]?.at, reads[reads.length - 1]?.at], reads: reads.length, errors, sites: summaries, families: fams }, null, 1) + '\n');
}
