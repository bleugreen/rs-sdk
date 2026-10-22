#!/usr/bin/env bun
/**
 * Who is active on the demo, from public data only (the files rival-positions-sample.ts and
 * rival-census.ts write; this script makes no requests).
 *
 *   bun docs/speedrun/scripts/rival-active.ts active POS.jsonl.gz [--minutes 60] [--census OLD.json NEW.json]
 *       "Accounts active in the last hour": every name whose tile changed between two samples inside the
 *       window (moved), every name first seen inside it (arrived), and with --census every account whose
 *       hiscore row changed between two censuses (a new level stamp, which the demo writes only at logout).
 *   bun docs/speedrun/scripts/rival-active.ts census CENSUS.json
 *       Batch patterns among the online names (shared prefixes, numbered suffixes, the known families),
 *       which online names have no hiscore page at all (never logged out), and each name's playtime at
 *       its last logout (the Overall row's stamp).
 *
 * What the counts are and are not: positions show who is logged in and moving, not what they gain;
 * a stamp is playtime in ticks at which a level was reached, never a wall-clock time, so new stamps can
 * only be dated to the interval between two censuses. Playtime is not account age.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import type { BoardRow, PlayerRow } from '../../../speedrun/tools/hiscore-scrape.ts';

interface Sample { t: string; n: number; p: [string, number, number, number][] }
interface Census {
    takenAt: string;
    positions: { name: string; x: number; z: number; level: number }[];
    players: Record<string, { at: string; rows: PlayerRow[] | null }>;
    boards: Record<string, BoardRow[]>;
}

export const FAMILIES = /^(stun|jackalope|nick|asuka|cairn|soko|zayne|lach|crab|miner)/;
export const pageKey = (name: string) => name.toLowerCase().replace(/ /g, '_');
const TICKS_PER_HOUR = 12_000;

export function readSamples(file: string): Sample[] {
    // Each sample is its own gzip member; gunzipSync reads a multi-member file whole.
    return gunzipSync(readFileSync(file)).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Sample);
}

export function activeFromPositions(samples: Sample[], minutes: number, now = Date.parse(samples.at(-1)!.t)) {
    const from = now - minutes * 60_000;
    const before = new Set<string>();
    const window: Sample[] = [];
    for (const s of samples) (Date.parse(s.t) < from ? s.p.forEach(q => before.add(q[0])) : window.push(s));
    const last = new Map<string, string>();
    const moved = new Set<string>();
    const firstSeen = new Map<string, string>();
    for (const s of window) {
        for (const [name, x, z, level] of s.p) {
            const tile = `${x},${z},${level}`;
            const prev = last.get(name);
            if (prev !== undefined && prev !== tile) moved.add(name);
            last.set(name, tile);
            if (!before.has(name) && !firstSeen.has(name)) firstSeen.set(name, s.t);
        }
    }
    // With no sample before the window every name is "first seen"; arrivals then mean nothing.
    const arrived = before.size ? firstSeen : new Map<string, string>();
    return { from: new Date(from).toISOString(), to: new Date(now).toISOString(), samples: window.length, online: last.size, moved, arrived, hadBaseline: before.size > 0 };
}

export function stampChanges(older: Census, newer: Census): { name: string; skill: string; from: string; to: string }[] {
    const out: { name: string; skill: string; from: string; to: string }[] = [];
    const fmt = (r?: PlayerRow) => (r?.level == null ? '-' : `${r.level}@${r.ticks}`);
    for (const [name, snap] of Object.entries(newer.players)) {
        const old = older.players[name];
        if (!old) continue;
        const before = new Map((old.rows ?? []).map(r => [r.category, r]));
        for (const r of snap.rows ?? []) {
            if (r.category === 0) continue;
            const b = before.get(r.category);
            if (b?.level === r.level && b?.ticks === r.ticks) continue;
            out.push({ name, skill: r.skill, from: fmt(b), to: fmt(r) });
        }
    }
    return out;
}

/** Groups of three or more online names sharing a stem: trailing digits stripped, or the first five letters. */
export function batches(names: string[]) {
    const byStem = new Map<string, string[]>();
    const byPrefix = new Map<string, string[]>();
    for (const n of names.map(pageKey)) {
        const stem = n.replace(/[0-9]+$/, '');
        if (stem !== n && stem.length >= 2) byStem.set(stem, [...(byStem.get(stem) ?? []), n]);
        if (n.length >= 6) byPrefix.set(n.slice(0, 5), [...(byPrefix.get(n.slice(0, 5)) ?? []), n]);
    }
    const big = (m: Map<string, string[]>, min: number) => [...m].filter(([, v]) => v.length >= min).sort((a, b) => b[1].length - a[1].length);
    return { numbered: big(byStem, 3), prefixed: big(byPrefix, 5) };
}

const playtime = (rows: PlayerRow[] | null) => rows?.find(r => r.category === 0)?.ticks ?? null;
const hours = (t: number | null) => (t === null ? '-' : (t / TICKS_PER_HOUR).toFixed(1) + 'h');

function censusReport(c: Census) {
    const names = c.positions.map(p => pageKey(p.name));
    const got = names.filter(n => c.players[n]);
    const noPage = got.filter(n => c.players[n]!.rows === null);
    const bucket = { 'no page': noPage.length, '<1h': 0, '1-6h': 0, '6-24h': 0, '1-7d': 0, '>7d': 0 };
    for (const n of got) {
        const t = playtime(c.players[n]!.rows);
        if (t === null) continue;
        const h = t / TICKS_PER_HOUR;
        bucket[h < 1 ? '<1h' : h < 6 ? '1-6h' : h < 24 ? '6-24h' : h < 168 ? '1-7d' : '>7d']++;
    }
    console.log(`census ${c.takenAt}: ${names.length} online, ${got.length} pages read`);
    console.log(`playtime at last logout (Overall stamp): ${JSON.stringify(bucket)}`);
    const line = (n: string) => `${n}(${c.players[n] ? (c.players[n]!.rows ? hours(playtime(c.players[n]!.rows)) : 'no page') : '?'})`;
    const { numbered, prefixed } = batches(names);
    console.log(`\nnumbered batches (stem + digits, >=3 online): ${numbered.length}`);
    for (const [stem, v] of numbered) console.log(`  ${stem}* x${v.length}: ${v.sort().map(line).join(' ')}`);
    console.log(`\nshared 5-letter prefixes (>=5 online): ${prefixed.length}`);
    for (const [p, v] of prefixed) console.log(`  ${p}* x${v.length}: ${v.sort().slice(0, 30).map(line).join(' ')}${v.length > 30 ? ' ...' : ''}`);
    const fam = names.filter(n => FAMILIES.test(n));
    console.log(`\nknown families online: ${fam.length}`);
    for (const n of fam.sort()) console.log(`  ${line(n)}`);
    console.log(`\nonline with no hiscore page (never logged out): ${noPage.length}`);
    console.log(`  ${noPage.sort().join(' ')}`);
}

if (import.meta.main) {
    const { values, positionals } = parseArgs({ args: Bun.argv.slice(2), allowPositionals: true, options: { minutes: { type: 'string', default: '60' }, census: { type: 'string', multiple: true } } });
    const [cmd, file] = positionals;
    if (cmd === 'active' && file) {
        const a = activeFromPositions(readSamples(file), Number(values.minutes));
        console.log(`${a.from} .. ${a.to}: ${a.samples} position samples, ${a.online} names online in the window`);
        console.log(`moved (tile changed between samples): ${a.moved.size}`);
        console.log(a.hadBaseline ? `arrived (first seen in the window): ${a.arrived.size}` : 'arrived: no sample before the window, so arrivals are unknown');
        for (const [n, t] of [...a.arrived].sort((x, y) => x[1].localeCompare(y[1]))) console.log(`  ${t.slice(11, 19)}Z ${n}`);
        const active = new Set(a.moved);
        if (values.census?.length === 2) {
            const [older, newer] = values.census.map(f => JSON.parse(readFileSync(f, 'utf8')) as Census);
            const ch = stampChanges(older!, newer!);
            const who = new Set(ch.map(c => c.name));
            console.log(`new level stamps between censuses ${older!.takenAt} and ${newer!.takenAt}: ${ch.length} rows on ${who.size} accounts`);
            for (const c of ch) console.log(`  ${c.name} ${c.skill} ${c.from} -> ${c.to}`);
            who.forEach(n => active.add(n));
        }
        console.log(`ACCOUNTS ACTIVE in the last ${values.minutes} min (moved or new stamp): ${active.size}`);
    } else if (cmd === 'census' && file) {
        censusReport(JSON.parse(readFileSync(file, 'utf8')) as Census);
    } else {
        console.error('usage: rival-active.ts active POS.jsonl.gz [--minutes 60] [--census OLD.json --census NEW.json] | census CENSUS.json');
        process.exit(2);
    }
}
