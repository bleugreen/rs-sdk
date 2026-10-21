import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { analyzeAccount, diffPlayers, parseBank, parseBoard, parseOutfit, parsePlayer, type PlayerRow } from './hiscore-scrape.ts';

const fixture = (name: string) => readFileSync(join(import.meta.dir, 'fixtures', name), 'utf8');

describe('parseBoard', () => {
    test('overall board: 21 rows of rank, name, level, ticks', () => {
        const rows = parseBoard(fixture('hiscores-2026-10-20.html'));
        expect(rows).toHaveLength(21);
        expect(rows[0]).toEqual({ rank: 1, name: 'stunbaron', level: 1881, ticks: 35_916 });
        expect(rows.map(r => r.rank)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
    });

    test('Quest Points board heads its level column "Points"', () => {
        const rows = parseBoard(fixture('hiscore/board-quest-points.html'));
        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0]!.level).toBeGreaterThan(100);
    });
});

describe('parsePlayer', () => {
    test('every skill row with its exact tick stamp', () => {
        const rows = parsePlayer(fixture('hiscore/player-stunbaron.html'))!;
        expect(rows).toHaveLength(21); // Overall, 19 skills, Quest Points
        expect(rows[0]).toEqual({ category: 0, skill: 'Overall', rank: 1, level: 1881, ticks: 35_916 });
        expect(rows.find(r => r.skill === 'Prayer')!.ticks).toBe(12_006);
        expect(rows.find(r => r.skill === 'Quest Points')).toMatchObject({ category: 100, level: 13, ticks: 17_697 });
    });

    test('skills under level 15 have no row: level and ticks are null', () => {
        const rows = parsePlayer(fixture('hiscore/player-nickquarry.html'))!;
        expect(rows.find(r => r.skill === 'Mining')).toMatchObject({ level: 99, ticks: 6_015 });
        expect(rows.find(r => r.skill === 'Attack')).toMatchObject({ rank: null, level: null, ticks: null });
    });

    test('row links of any profile parse the same', () => {
        const html = fixture('hiscore/player-stunbaron.html');
        expect(parsePlayer(html.replaceAll('profile=main', 'profile=lab'))).toEqual(parsePlayer(html));
    });

    test('a missing player is null', () => {
        expect(parsePlayer(fixture('hiscore/player-missing.html'))).toBeNull();
    });
});

describe('bank and outfit boards', () => {
    test('bank search: item id, exact count and value', () => {
        const rows = parseBank(fixture('hiscore/bank-grapes.html'));
        expect(rows.length).toBeGreaterThan(10);
        expect(rows[0]!.items[0]).toMatchObject({ id: 1987, name: 'Grapes' });
        expect(rows[0]!.items[0]!.count).toBe(rows[0]!.gp);
    });

    test('outfit: worn items per row', () => {
        const rows = parseOutfit(fixture('hiscore/outfit-top3.html'));
        expect(rows).toHaveLength(3);
        expect(rows[0]!.items.map(i => i.name)).toContain('Dragon med helm');
    });
});

const row = (category: number, skill: string, level: number | null, ticks: number | null): PlayerRow => ({ category, skill, rank: 1, level, ticks });

describe('analyzeAccount', () => {
    test('orders stamps, measures gaps and groups identical stamps', () => {
        const a = analyzeAccount([
            row(0, 'Overall', 1881, 300),
            row(9, 'Woodcutting', 99, 200),
            row(10, 'Fletching', 99, 100),
            row(11, 'Fishing', 99, 300),
            row(12, 'Firemaking', 99, 300),
            row(1, 'Attack', null, null)
        ]);
        expect(a.stamps.map(s => [s.skill, s.gap, s.batched])).toEqual([
            ['Fletching', 100, false],
            ['Woodcutting', 100, false],
            ['Fishing', 100, true],
            ['Firemaking', 0, true]
        ]);
        expect(a.batches).toEqual([{ ticks: 300, skills: ['Fishing', 'Firemaking'] }]);
        expect(a.laterThanOverall).toEqual([]);
    });

    test('Quest Points joins the batch it shares a stamp with; Overall never does (stunbaron page)', () => {
        const a = analyzeAccount(parsePlayer(fixture('hiscore/player-stunbaron.html'))!);
        expect(a).toMatchObject({ total: 1881, overallTicks: 35_916, laterThanOverall: [] });
        expect(a.batches.map(b => [b.ticks, b.skills.length])).toEqual([[12_006, 4], [17_697, 6], [35_916, 10]]);
        expect(a.batches[0]!.skills).toEqual(['Prayer', 'Woodcutting', 'Fishing', 'Mining']);
        expect(a.batches[1]!.skills).toEqual(['Fletching', 'Firemaking', 'Crafting', 'Smithing', 'Herblore', 'Quest Points']);
        expect(a.stamps.every(s => s.batched)).toBe(true);
    });

    test('distinct stamps stay unbatched; unranked skills are skipped (nickquarry page)', () => {
        const a = analyzeAccount(parsePlayer(fixture('hiscore/player-nickquarry.html'))!);
        expect(a.stamps.map(s => [s.skill, s.ticks, s.batched])).toEqual([
            ['Quest Points', 764, false],
            ['Mining', 6_015, false]
        ]);
        expect(a.batches).toEqual([]);
    });

    test('a skill stamped after the overall stamp can only be a logout fallback', () => {
        const a = analyzeAccount([row(0, 'Overall', 1881, 100), row(9, 'Woodcutting', 99, 100), row(10, 'Fletching', 99, 250), row(100, 'Quest Points', 5, 900)]);
        expect(a.laterThanOverall).toEqual(['Fletching']);
    });
});

test('diffPlayers reports changed rows of players present in both snapshots', () => {
    const at = (rows: PlayerRow[]) => ({ fetchedAt: '', rows });
    const changes = diffPlayers(
        { a: at([row(9, 'Woodcutting', 50, 10), row(10, 'Fletching', 99, 5)]) },
        { a: at([row(9, 'Woodcutting', 60, 90), row(10, 'Fletching', 99, 5)]), b: at([row(9, 'Woodcutting', 99, 1)]) }
    );
    expect(changes).toEqual([{ name: 'a', skill: 'Woodcutting', from: { level: 50, ticks: 10 }, to: { level: 60, ticks: 90 } }]);
});
