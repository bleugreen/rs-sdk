/**
 * The demo's value boards: bank (and its item search), equipment, and the Lava Maze runite board.
 * Bank and equipment parsing is speedrun/tools/hiscore-scrape.ts's; this module adds the runite board and the
 * readers. A bank row's `gp` is the board's own valuation: each item's count times a fixed per-item value
 * (air rune 4, raw shark 300, coins 1), not a GE price, so a total moves only when the items move.
 * The bank board lists the top 50 accounts and each account's six most valuable stacks; nothing below that.
 */
import { parseBank, parseOutfit, type Item, type ValueRow } from '../../speedrun/tools/hiscore-scrape.ts';
import type { Gentle } from './demo.ts';

export { parseBank, parseOutfit, type Item, type ValueRow };

export const bankPath = (q?: string): string => `/hiscores/bank?profile=main${q ? `&q=${encodeURIComponent(q)}` : ''}`;
export const OUTFIT_PATH = '/hiscores/outfit?profile=main';
export const RUNITE_PATH = '/hiscores/runite?profile=main';

export interface CountRow {
    rank: number;
    name: string;
    count: number;
}

export interface RuniteBoard {
    allTime: CountRow[];
    week: CountRow[];
    today: CountRow[];
}

const RUNITE_PERIODS: [keyof RuniteBoard, string][] = [
    ['allTime', 'All time'],
    ['week', 'This week'],
    ['today', 'Today']
];

/** Runite ore mined: three tables (all time, this week, today) of rank, name and ore count. */
export function parseRunite(html: string): RuniteBoard {
    const starts = RUNITE_PERIODS.map(([, label]) => html.indexOf(`<b>${label}</b>`));
    if (starts.some(i => i < 0)) throw new Error('runite board: a period heading is missing; the page layout has changed');
    const board: RuniteBoard = { allTime: [], week: [], today: [] };
    RUNITE_PERIODS.forEach(([key], i) => {
        const segment = html.slice(starts[i], starts[i + 1] ?? html.length);
        board[key] = [...segment.matchAll(/<td align="right">(\d+)<\/td>\s*<td><a href="\/hiscores\/player\/([^?"]+)\?[^"]*"[^>]*>[^<]*<\/a><\/td>\s*<td align="right"[^>]*>([\d,]+)<\/td>/g)].map(m => ({
            rank: Number(m[1]),
            name: decodeURIComponent(m[2]!),
            count: Number(m[3]!.replaceAll(',', ''))
        }));
    });
    return board;
}

export const readBank = async (g: Gentle, q?: string): Promise<ValueRow[]> => parseBank(await g.text(bankPath(q)));
export const readOutfit = async (g: Gentle): Promise<ValueRow[]> => parseOutfit(await g.text(OUTFIT_PATH));
export const readRunite = async (g: Gentle): Promise<RuniteBoard> => parseRunite(await g.text(RUNITE_PATH));
