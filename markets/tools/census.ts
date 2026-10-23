#!/usr/bin/env bun
/**
 * One gentle sweep of every public board for the wealth families (markets/lib/families.ts): the overall board
 * (10 pages), two pages of each skill board and Quest Points, the bank board and its item searches, the
 * equipment and runite boards, and /playerpositions. About 65 requests, three seconds apart. Public HTTP only.
 *
 *   bun markets/tools/census.ts [--out=docs/markets/data] [--overall-pages=10]
 *
 * Writes census-<stamp>.json (the bank board and searches whole, the ranked boards cut to family rows) and prints
 * the census as markdown.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { BOARD_PAGE_SIZE, CATEGORY_NAMES, OVERALL, parseBoard, QUEST_POINTS, SKILLS, withServerRate, type BoardRow } from '../../speedrun/tools/hiscore-scrape.ts';
import { readBank, readOutfit, readRunite, type ValueRow } from '../lib/boards.ts';
import { writerExclusion } from '../lib/accounts.ts';
import { Gentle } from '../lib/demo.ts';
import { census, familyOf, type FamilyCensus } from '../lib/families.ts';
import { readPositions, zoneOf } from '../lib/positions.ts';

/** Item searches that surface holders below the bank board's top 50: the leaders' stacks and the coin-like goods. */
export const CENSUS_SEARCHES = ['coins', 'air rune', 'mind rune', 'fire rune', 'raw shark', 'shark', 'raw bass', 'oyster', 'uncut', 'yew logs', 'rune essence'];

const boardPath = (category: number, rank = 1) => `/hiscores?category=${category}&profile=main${rank > 1 ? `&rank=${rank}` : ''}`;
const stamp = (d: Date) => d.toISOString().replace(/[:]/g, '').replace(/\.\d+Z$/, 'Z');

export function renderCensus(c: FamilyCensus[]): string {
    const lines = ['| Family | Accounts seen | Online | Where online | Sources |', '|---|---|---|---|---|'];
    for (const f of c) {
        const where = Object.entries(f.zones).map(([z, n]) => `${z} ${n}`).join(', ') || '-';
        const sources = Object.entries(f.sources).map(([s, names]) => `${s} ${names.length}`).join(', ') || '-';
        lines.push(`| ${f.family} | ${f.accounts.length} | ${f.online.length} | ${where} | ${sources} |`);
    }
    return lines.join('\n');
}

async function main(): Promise<void> {
    const { values } = parseArgs({ args: Bun.argv.slice(2), options: { out: { type: 'string' }, 'overall-pages': { type: 'string' }, 'placeholder-data': { type: 'boolean' } } });
    const ex = writerExclusion();
    const out = values.out ? resolve(values.out) : resolve(import.meta.dir, '../../docs/markets/data');
    const pages = Number(values['overall-pages'] ?? 10);
    const g = new Gentle();
    const takenAt = new Date();
    const board = async (category: number, rank?: number): Promise<BoardRow[]> => {
        const html = await g.text(boardPath(category, rank));
        return ex.keep(await withServerRate(g.origin, tickMs => parseBoard(html, tickMs)));
    };

    const boards: Record<string, BoardRow[]> = {};
    for (let p = 0; p < pages; p++) (boards.Overall ??= []).push(...(await board(OVERALL, 1 + p * BOARD_PAGE_SIZE)));
    for (const cat of [...Object.keys(SKILLS).map(Number), QUEST_POINTS]) {
        boards[CATEGORY_NAMES[cat]!] = [...(await board(cat)), ...(await board(cat, 1 + BOARD_PAGE_SIZE))];
    }
    const bank = ex.keep(await readBank(g));
    const searches: Record<string, ValueRow[]> = {};
    for (const q of CENSUS_SEARCHES) searches[q] = ex.keep(await readBank(g, q));
    const outfit = ex.keep(await readOutfit(g));
    const rawRunite = await readRunite(g);
    const runite = { allTime: ex.keep(rawRunite.allTime), week: ex.keep(rawRunite.week), today: ex.keep(rawRunite.today) };
    const rawPositions = await readPositions(g);
    const positions = ex.keep(rawPositions);

    const sources: Record<string, { name: string }[]> = { ...boards, bank, outfit, ...Object.fromEntries(Object.entries(searches).map(([q, rows]) => [`bank:${q}`, rows])) };
    for (const [period, rows] of Object.entries(runite)) sources[`runite:${period}`] = rows;
    const result = census(sources, positions);
    const family = <T extends { name: string }>(rows: T[]): T[] => rows.filter(r => familyOf(r.name));

    mkdirSync(out, { recursive: true });
    const file = join(out, `census-${stamp(takenAt)}.json`);
    writeFileSync(
        file,
        JSON.stringify({
            takenAt: takenAt.toISOString(),
            source: g.origin,
            bank,
            searches,
            outfit: family(outfit),
            runite,
            boards: Object.fromEntries(Object.entries(boards).map(([k, rows]) => [k, { rows: rows.length, family: family(rows) }])),
            online: rawPositions.length,
            familyPositions: family(positions).map(p => ({ ...p, zone: zoneOf(p) })),
            census: result
        })
    );
    console.log(`${file}: ${g.requests} requests, ${positions.length} online\n`);
    console.log(renderCensus(result));
    for (const f of result) console.log(`\n${f.family}: ${f.accounts.join(', ')}\n  online: ${f.online.join(', ') || '-'}`);
}

if (import.meta.main) await main();
