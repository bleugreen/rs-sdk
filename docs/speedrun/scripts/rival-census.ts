#!/usr/bin/env bun
/**
 * One census of who is on the demo right now, from public pages only (no login).
 *
 *   bun docs/speedrun/scripts/rival-census.ts --out DIR [--rps 2.5] [--max-players N] [--no-boards]
 *
 * 1. GET /playerpositions once (every online name and tile).
 * 2. GET every online name's hiscore player page, politely (--rps requests per second, one at a time).
 *    A 404 ("not found") means the account has no hiscore row at all: rows are written only at
 *    logout, so an online account with no page has never logged out since it was created.
 * 3. GET two pages (42 rows) of every skill board, Quest Points and five Overall pages, so two censuses
 *    can be diffed for new stamps (`rival-active.ts`).
 *
 * Writes DIR/census-<stamp>.json at the end and DIR/census-<stamp>.players.jsonl as it goes, so a
 * killed run keeps every player it reached. Player names map to page keys as lowercase with spaces
 * as underscores.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { BASE_URL, BOARD_PAGE_SIZE, CATEGORY_NAMES, parseBoard, parsePlayer, type BoardRow, type PlayerRow } from '../../../speedrun/tools/hiscore-scrape.ts';

const { values } = parseArgs({
    options: { out: { type: 'string' }, rps: { type: 'string', default: '2.5' }, 'max-players': { type: 'string' }, 'no-boards': { type: 'boolean', default: false } }
});
if (!values.out) throw new Error('--out DIR is required');
const out = values.out;
mkdirSync(out, { recursive: true });
const minGapMs = 1000 / Math.min(3, Math.max(0.2, Number(values.rps)));
const USER_AGENT = 'rs-sdk-hiscore-research (+https://github.com/bleugreen/rs-sdk)';

let last = 0;
let requests = 0;
async function get(path: string): Promise<{ status: number; body: string }> {
    for (let attempt = 1; attempt <= 4; attempt++) {
        const wait = last + minGapMs - Date.now();
        if (wait > 0) await Bun.sleep(wait);
        last = Date.now();
        requests++;
        try {
            const res = await fetch(BASE_URL + path, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) });
            const body = await res.text();
            if (res.ok || res.status === 404) return { status: res.status, body };
        } catch {}
        await Bun.sleep(1000 * 2 ** attempt);
    }
    throw new Error(`${path}: gave up`);
}

export const pageKey = (name: string) => name.toLowerCase().replace(/ /g, '_');
const stamp = new Date().toISOString().replace(/[:]/g, '').replace(/\.\d+Z$/, 'Z');
const takenAt = new Date().toISOString();

const positions = JSON.parse((await get('/playerpositions')).body) as { name: string; x: number; z: number; level: number }[];
console.log(`${takenAt} ${positions.length} online`);

const playersFile = join(out, `census-${stamp}.players.jsonl`);
const players: Record<string, { at: string; rows: PlayerRow[] | null }> = {};
const names = positions.map(p => pageKey(p.name)).slice(0, values['max-players'] ? Number(values['max-players']) : undefined);
for (const name of names) {
    try {
        const at = new Date().toISOString();
        const { body } = await get(`/hiscores/player/${encodeURIComponent(name)}?profile=main`);
        players[name] = { at, rows: parsePlayer(body) };
        appendFileSync(playersFile, JSON.stringify({ name, ...players[name] }) + '\n');
    } catch (err) {
        console.error(`player ${name}: ${err instanceof Error ? err.message : err}`);
    }
}

const boards: Record<string, BoardRow[]> = {};
if (!values['no-boards']) {
    for (const [cat, label] of Object.entries(CATEGORY_NAMES)) {
        const pages = Number(cat) === 0 ? 5 : 2;
        boards[label] = [];
        for (let p = 0; p < pages; p++) {
            const { body } = await get(`/hiscores?category=${cat}&profile=main${p ? `&rank=${1 + p * BOARD_PAGE_SIZE}` : ''}`);
            boards[label].push(...parseBoard(body));
        }
    }
}

const file = join(out, `census-${stamp}.json`);
writeFileSync(file, JSON.stringify({ takenAt, finishedAt: new Date().toISOString(), source: BASE_URL, positions, players, boards }));
const found = Object.values(players).filter(p => p.rows).length;
console.log(`${file}: ${Object.keys(players).length} player pages (${found} found), ${Object.keys(boards).length} boards, ${requests} requests`);
