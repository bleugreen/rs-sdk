#!/usr/bin/env bun
/**
 * Player pages for named accounts (skill levels and stamps), three seconds apart. Public HTTP only.
 * An account with no levels holding billions is a sign its wealth was handed to it rather than earned.
 *
 *   bun markets/tools/players.ts NAME... [--out=docs/markets/data]
 *
 * Writes players-<stamp>.json and prints one line per account: total level, skills ranked, highest skills.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { OVERALL, parsePlayer, playerPath, QUEST_POINTS, withServerRate, type PlayerRow } from '../../speedrun/tools/hiscore-scrape.ts';
import { writerExclusion } from '../lib/accounts.ts';
import { Gentle, HttpError } from '../lib/demo.ts';

const stamp = (d: Date) => d.toISOString().replace(/[:]/g, '').replace(/\.\d+Z$/, 'Z');

/** `total 1234, 19 skills ranked, QP 12; top: Fishing 99, Cooking 99, ...`, or `not on the hiscores`. */
export function summarisePlayer(rows: PlayerRow[] | null): string {
    if (!rows) return 'not on the hiscores';
    const overall = rows.find(r => r.category === OVERALL);
    const qp = rows.find(r => r.category === QUEST_POINTS);
    const skills = rows.filter(r => r.category !== OVERALL && r.category !== QUEST_POINTS && r.level !== null);
    const top = [...skills].sort((a, b) => b.level! - a.level!).slice(0, 5).map(r => `${r.skill} ${r.level}`).join(', ');
    return `total ${overall?.level ?? '-'}, ${skills.length} skills ranked, QP ${qp?.level ?? '-'}; top: ${top || '-'}`;
}

async function main(): Promise<void> {
    const { values, positionals } = parseArgs({ args: Bun.argv.slice(2), allowPositionals: true, options: { out: { type: 'string' }, 'placeholder-data': { type: 'boolean' } } });
    if (!positionals.length) throw new Error('usage: players.ts NAME... [--out=DIR]');
    const ex = writerExclusion();
    const out = values.out ? resolve(values.out) : resolve(import.meta.dir, '../../docs/markets/data');
    const g = new Gentle();
    const takenAt = new Date();
    const players: Record<string, PlayerRow[] | null> = {};
    // An excluded name is skipped silently: not read, not written, not printed.
    for (const name of positionals.filter(n => !ex.excludes(n))) {
        let html: string;
        try {
            html = await g.text(playerPath(name));
        } catch (e) {
            // A missing player is a 404 page; anything else is a failed read.
            if (!(e instanceof HttpError && e.status === 404)) throw e;
            players[name] = null;
            console.log(`${name}: not on the hiscores`);
            continue;
        }
        players[name] = await withServerRate(g.origin, tickMs => parsePlayer(html, tickMs));
        console.log(`${name}: ${summarisePlayer(players[name]!)}`);
    }
    mkdirSync(out, { recursive: true });
    const file = join(out, `players-${stamp(takenAt)}.json`);
    writeFileSync(file, JSON.stringify({ takenAt: takenAt.toISOString(), source: g.origin, players }));
    console.log(`${file}: ${g.requests} requests`);
}

if (import.meta.main) await main();
