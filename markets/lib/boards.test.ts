import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bankPath, parseBank, parseOutfit, parseRunite, readBank } from './boards.ts';
import { Gentle } from './demo.ts';

const fixture = (name: string) => readFileSync(join(import.meta.dir, 'fixtures', name), 'utf8');

describe('bank board (recorded 2026-10-22 ~22:1xZ)', () => {
    const rows = parseBank(fixture('bank.html'));

    test('reads the top 50 with exact totals', () => {
        expect(rows).toHaveLength(50);
        expect(rows.slice(0, 3).map(r => [r.rank, r.name, r.gp])).toEqual([
            [1, 'nickai3', 16_139_489_874],
            [2, 'banker', 8_018_645_770],
            [3, 'nickai', 2_147_722_063]
        ]);
    });

    test('reads each row\'s top stacks with id and exact count, valued at a fixed per-item price', () => {
        const air = rows[0]!.items.find(i => i.name === 'Air rune')!;
        expect(air).toEqual({ id: 556, count: 1_923_311_135, name: 'Air rune', gp: 7_693_244_540 });
        expect(air.gp / air.count).toBe(4);
        expect(rows.find(r => r.name === 'kurobanker')!.items).toEqual([{ id: 995, count: 1_481_474_671, name: 'Coins', gp: 1_481_474_671 }]);
    });

    test('readBank asks for the item search through the gate', async () => {
        const asked: string[] = [];
        const g = new Gentle({
            minIntervalMs: 0,
            fetchImpl: (async (url: string) => (asked.push(url), new Response(fixture('bank.html')))) as unknown as typeof fetch
        });
        expect(await readBank(g, 'raw shark')).toHaveLength(50);
        expect(asked).toEqual(['https://rs-sdk-demo.fly.dev/hiscores/bank?profile=main&q=raw%20shark']);
        expect(bankPath()).toBe('/hiscores/bank?profile=main');
    });
});

test('equipment board', () => {
    const rows = parseOutfit(fixture('outfit.html'));
    expect(rows).toHaveLength(50);
    expect(rows[0]).toMatchObject({ rank: 1, name: 'nickai3', gp: 1_366_450 });
});

test('runite board splits all time, this week and today', () => {
    const b = parseRunite(fixture('runite.html'));
    expect(b.allTime[0]).toEqual({ rank: 1, name: 'goo001', count: 1847 });
    expect(b.allTime.slice(0, 4).map(r => r.name)).toEqual(['goo001', 'xulvexi', 'goo003', 'goo002']);
    expect(b.allTime.length + b.week.length + b.today.length).toBe(22);
    for (const period of [b.allTime, b.week, b.today]) period.forEach((r, i) => expect(r.rank).toBe(i + 1));
    expect(() => parseRunite('<html></html>')).toThrow('period heading');
});
