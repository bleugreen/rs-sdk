import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { analyzeAccount, diffPlayers, hasSave, parseBank, parseBoard, parseOutfit, parsePlayer, type PlayerRow, TickRateNeeded, titleTicks, withServerRate } from './hiscore-scrape.ts';

const fixture = (name: string) => readFileSync(join(import.meta.dir, 'fixtures', name), 'utf8');

// The demo's Time title has had three forms (all fetched live on 2026-10-22):
//   older fixtures         `N ticks`, which the engine's own page (lab worlds) still renders;
//   *-2026-10-22.html      `S seconds of game time` (about 19:34 to 19:56 UTC, rs/455), S = ticks x 300 ms then;
//   *-2026-10-22-400ms.html `N ticks normalized to 400 ms per tick`, since the demo's ~19:56 UTC restart onto
//                          400 ms ticks (rs/147). The same accounts carry the same tick counts in all of them.
describe('titleTicks', () => {
    test('form 1: N ticks', () => {
        expect(titleTicks('12,006 ticks')).toEqual({ ticks: 12_006 });
        expect(titleTicks('764 ticks', 400)).toEqual({ ticks: 764 });
    });

    test('form 3: N ticks normalized to M ms per tick gives the ticks and the rate', () => {
        expect(titleTicks('3,329 ticks normalized to 400 ms per tick')).toEqual({ ticks: 3_329, tickMs: 400 });
        expect(titleTicks('35,916 ticks normalized to 600 ms per tick', 400)).toEqual({ ticks: 35_916, tickMs: 600 });
    });

    test('form 2: S seconds of game time converts exactly under the given rate, never an assumed one', () => {
        expect(() => titleTicks('998.7 seconds of game time')).toThrow(TickRateNeeded);
        expect(titleTicks('998.7 seconds of game time', 300)).toEqual({ ticks: 3_329, tickMs: 300 });
        expect(titleTicks('207 seconds of game time', 300)).toEqual({ ticks: 690, tickMs: 300 });
        expect(titleTicks('2,247 seconds of game time', 300)).toEqual({ ticks: 7_490, tickMs: 300 });
        expect(titleTicks('3,601.8 seconds of game time', 300)).toEqual({ ticks: 12_006, tickMs: 300 });
        expect(titleTicks('1,331.6 seconds of game time', 400)).toEqual({ ticks: 3_329, tickMs: 400 });
        expect(titleTicks('0.6 seconds of game time', 600)).toEqual({ ticks: 1, tickMs: 600 });
        // Every tick count up to 100k survives the round trip through a one-decimal rendering.
        for (const ms of [300, 400, 600]) {
            for (let t = 0; t <= 100_000; t += 7) {
                const s = ((t * ms) / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 });
                expect(titleTicks(`${s} seconds of game time`, ms).ticks).toBe(t);
            }
        }
    });

    test('a value off the rate grid, a fractional tick count or an unknown form is rejected, not rounded', () => {
        expect(() => titleTicks('998.8 seconds of game time', 300)).toThrow(/not a whole number of 300 ms ticks/);
        expect(() => titleTicks('998.75 seconds of game time', 300)).toThrow(/not a whole number of 300 ms ticks/);
        expect(() => titleTicks('998.7 seconds of game time', 400)).toThrow(/not a whole number of 400 ms ticks/);
        expect(() => titleTicks('1.5 ticks')).toThrow(/not a whole tick count/);
        expect(() => titleTicks('1.5 ticks normalized to 400 ms per tick')).toThrow(/not a whole tick count/);
        expect(() => titleTicks('3,329 ticks at 400 ms')).toThrow(/no known form/);
        expect(() => titleTicks('16m 38s')).toThrow(/no known form/);
    });
});

describe('withServerRate', () => {
    test('a page that states its stamps parses without asking the server', async () => {
        const html = fixture('hiscore/board-woodcutting-2026-10-22-400ms.html');
        // An origin nothing listens on: reaching it would fail the parse.
        expect((await withServerRate('http://127.0.0.1:9', ms => parseBoard(html, ms)))[0]).toMatchObject({ ticks: 3_329, tickMs: 400 });
    });

    test('a seconds-form page converts under the hello frame\'s tickMs', async () => {
        const server = Bun.serve({
            port: 0,
            fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response('no', { status: 400 })),
            websocket: {
                open: ws => {
                    ws.send(JSON.stringify({ t: 'hello', v: 1, tick: 1, tickMs: 300, players: 0 }));
                },
                message: () => {}
            }
        });
        try {
            const rows = await withServerRate(`http://127.0.0.1:${server.port}`, ms => parseBoard(fixture('hiscore/board-woodcutting-2026-10-22.html'), ms));
            expect(rows[0]).toEqual({ rank: 1, name: 'cairn_chops', level: 99, ticks: 3_329, tickMs: 300 });
        } finally {
            server.stop(true);
        }
    });
});

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

    test('seconds-form board (demo, 2026-10-22, 300 ms): converts under the given rate to the same ticks', () => {
        const html = fixture('hiscore/board-woodcutting-2026-10-22.html');
        expect(() => parseBoard(html)).toThrow(TickRateNeeded);
        const rows = parseBoard(html, 300);
        expect(rows).toHaveLength(21);
        expect(rows[0]).toEqual({ rank: 1, name: 'cairn_chops', level: 99, ticks: 3_329, tickMs: 300 });
        expect(rows[1]!.ticks).toBe(3_403); // 1,020.9 s
        expect(rows.every(r => Number.isInteger(r.ticks))).toBe(true);
    });

    test('normalized-form board (demo since its 400 ms restart): the same ticks, and the rate', () => {
        const rows = parseBoard(fixture('hiscore/board-woodcutting-2026-10-22-400ms.html'));
        expect(rows).toHaveLength(21);
        expect(rows[0]).toEqual({ rank: 1, name: 'cairn_chops', level: 99, ticks: 3_329, tickMs: 400 });
        expect(rows[1]).toMatchObject({ ticks: 3_403, tickMs: 400 });
        expect(rows.slice(0, 10).map(r => r.ticks)).toEqual(parseBoard(fixture('hiscore/board-woodcutting-2026-10-22.html'), 300).slice(0, 10).map(r => r.ticks));
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

    test('seconds-form and normalized-form player pages (demo, 2026-10-22) carry the same ticks', () => {
        for (const [suffix, tickMs] of [['2026-10-22', 300], ['2026-10-22-400ms', 400]] as const) {
            const chops = parsePlayer(fixture(`hiscore/player-cairn_chops-${suffix}.html`), suffix.endsWith('400ms') ? undefined : tickMs)!;
            expect(chops).toHaveLength(21);
            expect(chops.find(r => r.skill === 'Woodcutting')).toEqual({ category: 9, skill: 'Woodcutting', rank: 1, level: 99, ticks: 3_329, tickMs });
            expect(chops.find(r => r.skill === 'Overall')).toMatchObject({ level: 126, ticks: 3_329, tickMs });
            expect(chops.find(r => r.skill === 'Attack')).toEqual({ category: 1, skill: 'Attack', rank: null, level: null, ticks: null });
            const burns = parsePlayer(fixture(`hiscore/player-cairn_burns-${suffix}.html`), suffix.endsWith('400ms') ? undefined : tickMs)!;
            expect(burns.find(r => r.skill === 'Firemaking')).toMatchObject({ category: 12, level: 99, ticks: 690, tickMs });
        }
        expect(() => parsePlayer(fixture('hiscore/player-cairn_chops-2026-10-22.html'))).toThrow(TickRateNeeded);
    });

    test('mid-level rows and the Runecraft category on the 400 ms pages (demo, 2026-10-22 22:42-22:47Z)', () => {
        const runes = parsePlayer(fixture('hiscore/player-cairn_runes-2026-10-22-400ms.html'))!;
        expect(runes).toHaveLength(21);
        // The page links Runecraft as category 21 (stat index 20 + 1).
        expect(runes.find(r => r.skill === 'Runecraft')).toEqual({ category: 21, skill: 'Runecraft', rank: 1_529, level: 70, ticks: 4_543, tickMs: 400 });
        expect(runes[0]).toEqual({ category: 0, skill: 'Overall', rank: 18_200, level: 97, ticks: 4_543, tickMs: 400 });
        expect(parsePlayer(fixture('hiscore/player-cairn_jumps-2026-10-22-400ms.html'))!.find(r => r.skill === 'Agility')).toMatchObject({ category: 17, level: 99, ticks: 7_111 });
        expect(parsePlayer(fixture('hiscore/player-cairn_ashes-2026-10-22-400ms.html'))!.find(r => r.skill === 'Firemaking')).toMatchObject({ category: 12, level: 99, ticks: 664 });
    });

    test('hasSave: Overall is stamped from the first save, even with every skill under 15; blank before it', () => {
        const sub15 = parsePlayer(fixture('hiscore/player-cairn_h90-2026-10-22-400ms.html'))!;
        expect(sub15.filter(r => r.level !== null).map(r => r.skill)).toEqual(['Overall']);
        expect(sub15[0]).toMatchObject({ level: 28, ticks: 59_252, tickMs: 400 });
        expect(hasSave(sub15)).toBe(true);
        // An account that has logged in but never saved: the page exists with every row blank.
        const unsaved = parsePlayer(fixture('hiscore/player-acquiredl13-unsaved-2026-10-22.html'))!;
        expect(unsaved).toHaveLength(21);
        expect(unsaved.every(r => r.level === null && r.ticks === null)).toBe(true);
        expect(hasSave(unsaved)).toBe(false);
        expect(hasSave(parsePlayer(fixture('hiscore/player-cairn_runes-2026-10-22-400ms.html'))!)).toBe(true);
    });

    test('a seconds title off the rate grid fails the page instead of mis-reporting a stamp', () => {
        const html = fixture('hiscore/player-cairn_burns-2026-10-22.html').replaceAll('title="207 seconds', 'title="207.1 seconds');
        expect(() => parsePlayer(html, 300)).toThrow(/not a whole number of 300 ms ticks/);
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
