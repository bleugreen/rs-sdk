import { describe, expect, test } from 'bun:test';
import { bankTops, decodePolls, encodePoll, formatPollFile, holdingsOf, jumps, stampFromFile, type BankRow, type PollFile } from './snapshots.ts';

const row = (rank: number, name: string, gp: number, items: [number, number][] = []): BankRow => ({ rank, name, gp, items: items.map(([id, count]) => ({ id, count })) });
const isFamily = (n: string) => /^soko/i.test(n);

describe('poll file codec', () => {
    test('stores only changed rows and rebuilds every full board', () => {
        const file: PollFile = { v: 1, source: 'https://rs-sdk-demo.fly.dev', polls: [] };
        const first = [row(1, 'a', 100, [[995, 100]]), row(2, 'b', 50, [[556, 10]])];
        const second = [row(1, 'b', 500, [[556, 125]]), row(2, 'a', 100, [[995, 100]])];
        const pos = [
            { name: 'Soko', x: 3185, z: 3436, level: 0 },
            { name: 'Other', x: 1, z: 1, level: 0 }
        ];
        file.polls.push(encodePoll(file, '2026-10-22T23:00:00.000Z', first, pos, isFamily));
        file.polls.push(encodePoll(file, '2026-10-22T23:05:00.000Z', second, null, isFamily));
        file.polls.push(encodePoll(file, '2026-10-22T23:10:00.000Z', null, pos, isFamily));
        expect(file.polls[0]!.rows).toHaveLength(2);
        expect(file.polls[1]!.rows).toEqual([['b', 500, [556, 125]]]);
        expect(file.polls[0]!.families).toEqual([['Soko', 3185, 3436, 0]]);
        const decoded = decodePolls(JSON.parse(formatPollFile(file)));
        expect(decoded.map(p => p.bank)).toEqual([first, second, null]);
        expect(decoded.map(p => p.online)).toEqual([2, null, 2]);
        expect(formatPollFile(file).split('\n')).toHaveLength(6);
    });
});

describe('loading saved boards', () => {
    test('reads a scraper snapshot, a census file, and a poll file; skips files without the top board', () => {
        const snap = { takenAt: '2026-10-21T08:04:27.000Z', bank: { top: [{ rank: 1, name: 'a', gp: 7, items: [{ id: 995, count: 7, name: 'Coins', gp: 7 }] }], searches: {} } };
        expect(bankTops(snap, 'snapshot-2026-10-21T080427Z.json')).toEqual([
            { at: '2026-10-21T08:04:27.000Z', source: 'snapshot-2026-10-21T080427Z.json', rows: [{ rank: 1, name: 'a', gp: 7, items: [{ id: 995, count: 7, name: 'Coins', gp: 7 }] }] }
        ]);
        expect(bankTops({ bank: [row(1, 'z', 3)] }, 'census-2026-10-22T230000Z.json')[0]!.at).toBe('2026-10-22T23:00:00.000Z');
        const polls: PollFile = { v: 1, source: 's', polls: [] };
        polls.polls.push(encodePoll(polls, '2026-10-22T23:00:00.000Z', [row(1, 'a', 9)], null, isFamily));
        polls.polls.push(encodePoll(polls, '2026-10-22T23:05:00.000Z', null, null, isFamily));
        expect(bankTops(polls, 'poll.json')).toHaveLength(1);
        expect(bankTops({ uncut: [] }, 'bank-searches-2026-10-21T081300Z.json')).toEqual([]);
        expect(stampFromFile('x/bank-searches-2026-10-21T081300Z.json')).toBe('2026-10-21T08:13:00.000Z');
    });

    test('holdingsOf orders one account\'s reads by time', () => {
        const tops = [
            { at: '2026-10-22T00:00:00.000Z', source: 'later', rows: [row(1, 'a', 20)] },
            { at: '2026-10-21T00:00:00.000Z', source: 'earlier', rows: [row(2, 'a', 10), row(1, 'b', 30)] }
        ];
        expect(holdingsOf(tops, 'a').map(h => [h.source, h.rank, h.gp])).toEqual([
            ['earlier', 2, 10],
            ['later', 1, 20]
        ]);
    });
});

test('jumps flags large gains, doublings and rich newcomers only', () => {
    const before = [row(1, 'big', 16e9), row(2, 'small', 20e6), row(3, 'flat', 1e9), row(4, 'tail', 300e6)];
    const after = [row(1, 'big', 16.2e9), row(2, 'small', 45e6), row(3, 'flat', 1.05e9), row(4, 'rich', 2e9), row(5, 'mid', 400e6)];
    expect(jumps(before, after)).toEqual([
        { name: 'rich', from: null, to: 2e9, delta: 2e9 - 300e6 },
        { name: 'big', from: 16e9, to: 16.2e9, delta: 200e6 },
        { name: 'small', from: 20e6, to: 45e6, delta: 25e6 }
    ]);
    expect(jumps([], after)).toEqual([]);
});
