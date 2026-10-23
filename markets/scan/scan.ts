// The wealth scan: content, recipes and a GE book snapshot in, one JSON report out.
//
//   bun markets/scan/scan.ts [--book=docs/markets/data/ge-book-<stamp>.json] [--tick=400] [--out=...]
//
// Without --book it uses the newest ge-book-*.json in docs/markets/data. No network.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadContent } from './content.ts';
import type { Book } from './ge-book.ts';
import { alchFromShops, askLines, bidLines, groundSpawns, multiplierAnomalies, shopArbitrage, shopLines, thievingLines } from './methods.ts';
import { DEFAULT_RANK, boardRate, rankCandidates, ranked } from './rank.ts';
import { loadRecipes, priceRecipe, statChance } from './recipes.ts';

export const DATA_DIR = join(import.meta.dir, '..', '..', 'docs', 'markets', 'data');

export function newestBook(dir = DATA_DIR): string {
    const files = readdirSync(dir).filter(f => /^ge-book-.*\.json$/.test(f)).sort();
    if (!files.length) throw new Error(`no ge-book-*.json in ${dir}; run bun markets/scan/ge-book.ts first`);
    return join(dir, files[files.length - 1]!);
}

const round = (v: unknown): unknown => typeof v === 'number' ? (Number.isInteger(v) ? v : Math.round(v * 100) / 100) : Array.isArray(v) ? v.map(round) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v;

if (import.meta.main) {
    const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
    const tickMs = Number(arg('tick') ?? DEFAULT_RANK.tickMs);
    const bookPath = arg('book') ?? newestBook();
    const book = JSON.parse(readFileSync(bookPath, 'utf8')) as Book;
    const c = loadContent();
    const lines = shopLines(c, tickMs);
    const nature = Math.min(...lines.filter(l => l.obj === 'naturerune').map(l => l.price));
    const recipes = loadRecipes().map(r => priceRecipe(r, c.objs)).filter(r => r.addedPerAction > 0).sort((a, b) => b.addedPerTick - a.addedPerTick);
    const candidates = ranked(rankCandidates(c, book.rows, { ...DEFAULT_RANK, tickMs }));
    const report = {
        generatedFrom: { book: bookPath.slice(bookPath.lastIndexOf('docs/')), bookAt: book.at, tickMs, ticksPerHour: 3_600_000 / tickMs },
        counts: { objs: c.objs.size, shops: c.shops.length, shopLines: lines.length, recipes: recipes.length, groundSpawns: c.groundObjs.length, bookRows: book.rows.length },
        candidates: candidates.map(x => ({ rank: candidates.indexOf(x) + 1, boardRatePerHour: boardRate(x), ...x })),
        shopMultiplierAnomalies: multiplierAnomalies(c),
        shopsBelowCost: lines.filter(l => l.price < l.cost),
        shopArbitrage: shopArbitrage(c, tickMs).sort((a, b) => b.coinsPerHour - a.coinsPerHour),
        highAlchFromShops: { natureRune: nature, lines: alchFromShops(lines, nature).sort((a, b) => b.coinsPerHour - a.coinsPerHour) },
        geAsksBelowCost: askLines(c, book.rows).filter(a => a.ask < a.cost).sort((a, b) => b.gainAtDepth - a.gainAtDepth),
        geBids: bidLines(c, book.rows, lines).sort((a, b) => b.committed - a.committed),
        recipesByBoardValuePerTick: recipes.slice(0, 60).map(r => ({ skill: r.skill, row: r.row, level: r.level, inputs: r.inputs, output: r.output, success: r.success, inputCost: r.inputCost, outputCost: r.outputCost, addedPerAction: r.addedPerAction, addedPerTick: r.addedPerTick, cycle: r.cycle })),
        groundSpawns: groundSpawns(c, tickMs).sort((a, b) => b.boardPerHour - a.boardPerHour).slice(0, 40),
        thieving: thievingLines(c, statChance).sort((a, b) => b.valuePerTick - a.valuePerTick),
        mines: c.mines,
    };
    const out = arg('out') ?? join(DATA_DIR, `scan-${book.at.slice(0, 10)}.json`);
    writeFileSync(out, JSON.stringify(round(report), null, 1) + '\n');
    console.log(`${candidates.length} candidates -> ${out}`);
    for (const x of candidates.slice(0, 25)) console.log(String(Math.round(boardRate(x))).padStart(9), String(Math.round(x.coinsPerHour)).padStart(9), String(Math.round(x.boardPerHour)).padStart(9), x.scaling.padEnd(15), x.method);
}
