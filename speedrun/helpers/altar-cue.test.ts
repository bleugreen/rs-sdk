import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    assertUntracked,
    canonName,
    chooseTurn,
    CueWatcher,
    CueWriter,
    cycleTicks,
    FrameLog,
    giverSteps,
    judgeTick,
    nameHash,
    STOCK_MIN_TICKS,
    STOCK_WINDOW,
    readCue,
    readStatuses,
    resolveOffset,
    scoredSteps,
    turnKey,
    writeStatus,
    type Beacon,
    type Cue
} from './altar-cue';

const frames = (ticks: number[], ms0: number, step = 300, jitter: (i: number) => number = () => 0): Beacon[] =>
    ticks.map((tick, i) => ({ tick, ms: ms0 + i * step + jitter(i) }));

const cue = (over: Partial<Cue> = {}): Cue => ({
    v: 1,
    session: 's1',
    seq: 1,
    receiver: { sha256: nameHash('stand_in') },
    beacons: [{ tick: 100, ms: 0 }],
    schedule: 'tuned',
    open: 5,
    turns: [],
    ms: 0,
    ...over
});

describe('schedule', () => {
    test('tuned: request T+5, offer+accept T+6, confirm T+7; scored confirms and crafts on T+7', () => {
        expect(giverSteps(100, 5, 'tuned')).toEqual([
            { land: 105, actions: ['request'] },
            { land: 106, actions: ['offer-accept'] },
            { land: 107, actions: ['confirm'] }
        ]);
        expect(scoredSteps(100, 5, 'tuned')).toEqual([
            { land: 105, actions: ['request'] },
            { land: 106, actions: ['accept'] },
            { land: 107, actions: ['confirm', 'craft'] }
        ]);
        expect(cycleTicks(5, 'tuned')).toBe(7);
    });

    test('robust: the giver confirms twice and the craft moves to T+8', () => {
        expect(giverSteps(100, 5, 'robust').map(s => [s.land, ...s.actions])).toEqual([
            [105, 'request'],
            [106, 'offer-accept'],
            [107, 'confirm'],
            [108, 'confirm']
        ]);
        expect(scoredSteps(100, 5, 'robust').map(s => [s.land, ...s.actions])).toEqual([
            [105, 'request'],
            [107, 'accept', 'confirm'],
            [108, 'craft']
        ]);
        expect(cycleTicks(5, 'robust')).toBe(8);
    });

    test('the craft of one cycle is the next cycle T', () => {
        for (const schedule of ['tuned', 'robust'] as const) {
            const craft = scoredSteps(100, 5, schedule).find(s => s.actions.includes('craft'))!.land;
            expect(craft).toBe(100 + cycleTicks(5, schedule));
        }
    });

    test('the judge tick is after the giver last landing', () => {
        expect(judgeTick(100, 5, 'tuned')).toBe(Math.max(...giverSteps(100, 5, 'tuned').map(s => s.land)) + 2);
        expect(judgeTick(100, 5, 'robust')).toBe(Math.max(...giverSteps(100, 5, 'robust').map(s => s.land)) + 2);
    });
});

describe('clock', () => {
    test('same frames, different numbering: the offset is the difference', () => {
        const theirs = frames([500, 501, 502, 503], 10_000);
        const mine = frames([40, 41, 42, 43, 44], 10_000 - 300, 300, i => (i % 2 ? 4 : -3));
        expect(resolveOffset(mine, theirs)).toEqual({ offset: -459, errorMs: expect.any(Number) });
    });

    test('a single beacon is enough when the frames are 300 ms apart', () => {
        const mine = frames([10, 11, 12], 1_000);
        expect(resolveOffset(mine, [{ tick: 7, ms: 1_312 }])).toMatchObject({ offset: 4 });
    });

    test('refuses beacons that match no frame of ours', () => {
        const mine = frames([10, 11, 12], 1_000);
        expect(resolveOffset(mine, [{ tick: 7, ms: 1_150 }])).toHaveProperty('error');
        expect(resolveOffset([], [{ tick: 7, ms: 1_000 }])).toHaveProperty('error');
        expect(resolveOffset(mine, [])).toHaveProperty('error');
    });

    test('back-to-back frames (an overrun catch-up) are refused with one beacon, resolved with several', () => {
        // our frames: 20 at 0, 21 at 600 (late), 22 at 640 (catch-up), 23 at 900
        const mine: Beacon[] = [{ tick: 20, ms: 0 }, { tick: 21, ms: 600 }, { tick: 22, ms: 640 }, { tick: 23, ms: 900 }];
        const one = resolveOffset(mine, [{ tick: 81, ms: 620 }]);
        expect(one).toHaveProperty('error');
        const several = resolveOffset(mine, [{ tick: 80, ms: 2 }, { tick: 81, ms: 605 }, { tick: 82, ms: 642 }, { tick: 83, ms: 903 }]);
        expect(several).toMatchObject({ offset: -60 });
    });

    test('FrameLog keeps the first arrival of a tick and restarts on a relog', () => {
        const log = new FrameLog(3);
        expect(log.add(1, 10)).toBe('new');
        expect(log.add(1, 20)).toBe('dup');
        log.add(2, 30);
        log.add(3, 40);
        log.add(4, 50);
        expect(log.all()).toEqual([{ tick: 2, ms: 30 }, { tick: 3, ms: 40 }, { tick: 4, ms: 50 }]);
        expect(log.add(1, 60)).toBe('reset');
        expect(log.all()).toEqual([{ tick: 1, ms: 60 }]);
    });
});

describe('turns', () => {
    const turns = [{ giver: 'cairn_h70', T: 200 }, { giver: 'cairn_h71', T: 207 }, { giver: 'Cairn H70', T: 221 }];

    test('arms the newest turn naming this giver, in its own numbering', () => {
        const c = chooseTurn(cue({ turns }), 'cairn_h70', 1000, 1200, new Set());
        expect(c).toEqual({ kind: 'arm', turn: turns[2]!, myT: 1221, schedule: 'tuned', key: turnKey('s1', 221) });
    });

    test('the request is sent on the frame for T+K-1, so that frame must still be ahead', () => {
        const c = cue({ turns: [{ giver: 'cairn_h71', T: 207 }] });
        expect(chooseTurn(c, 'cairn_h71', 0, 210, new Set()).kind).toBe('arm');
        expect(chooseTurn(c, 'cairn_h71', 0, 211, new Set()).kind).toBe('late');
        expect(chooseTurn(c, 'cairn_h71', 0, 220, new Set()).kind).toBe('none');
    });

    test('per-turn schedule overrides the cue', () => {
        const c = cue({ turns: [{ giver: 'cairn_h71', T: 207, schedule: 'robust' }] });
        expect(chooseTurn(c, 'cairn_h71', 0, 200, new Set())).toMatchObject({ kind: 'arm', schedule: 'robust' });
    });

    test('done turns, other givers and stopped cues arm nothing', () => {
        expect(chooseTurn(cue({ turns }), 'cairn_h70', 0, 0, new Set([turnKey('s1', 221)])).kind).toBe('none');
        expect(chooseTurn(cue({ turns }), 'cairn_h72', 0, 0, new Set()).kind).toBe('none');
        expect(chooseTurn(cue({ turns, stop: true }), 'cairn_h70', 0, 0, new Set()).kind).toBe('none');
    });

    test('stock: judged STOCK_WINDOW ticks after the request, T+27 at K = 5, where the scored side gives up', () => {
        expect(STOCK_WINDOW).toBe(22);
        expect(judgeTick(200, 5, 'stock')).toBe(227);
    });

    test('stock: armed ahead of its request frame and after it, late only once a reacting trade no longer fits', () => {
        const c = cue({ schedule: 'robust', turns: [{ giver: 'cairn_h71', T: 200, schedule: 'stock' }] });
        expect(chooseTurn(c, 'cairn_h71', 0, 197, new Set())).toMatchObject({ kind: 'arm', schedule: 'stock', myT: 200 });
        // blind turns are late from T+K-1 on; a stock turn still has 22 ticks to react in
        expect(chooseTurn(c, 'cairn_h71', 0, 210, new Set())).toMatchObject({ kind: 'arm', schedule: 'stock' });
        expect(chooseTurn(c, 'cairn_h71', 0, 227 - STOCK_MIN_TICKS, new Set()).kind).toBe('arm');
        expect(chooseTurn(c, 'cairn_h71', 0, 227 - STOCK_MIN_TICKS + 1, new Set()).kind).toBe('late');
        expect(chooseTurn(c, 'cairn_h71', 0, 227, new Set()).kind).toBe('none');
    });

    test('a new session makes old turn keys irrelevant', () => {
        const done = new Set([turnKey('s1', 221)]);
        expect(chooseTurn(cue({ turns, session: 's2' }), 'cairn_h70', 0, 0, done).kind).toBe('arm');
    });
});

describe('names', () => {
    test('hash of the display name equals hash of the login name', () => {
        expect(nameHash('Cairn H75')).toBe(nameHash('cairn_h75'));
        expect(nameHash('Cairn H75')).toBe(nameHash('cairn_h75'));
        expect(canonName(' Cairn  H75 ')).toBe('cairn_h75');
        expect(nameHash('cairn_h75')).not.toBe(nameHash('cairn_h76'));
    });
});

describe('files', () => {
    test('writer, watcher and status files round-trip, and the cue never holds the name', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'rc-cue-'));
        const seen: Cue[] = [];
        const watcher = new CueWatcher(dir, c => seen.push(c), 5);
        const w = new CueWriter(dir, 'secret_name');
        w.addTurn({ giver: 'cairn_h70', T: 10 }, [{ tick: 3, ms: 1 }]);
        w.addTurn({ giver: 'cairn_h71', T: 17 }, [{ tick: 4, ms: 2 }]);
        await Bun.sleep(60);
        watcher.close();
        const read = readCue(dir)!;
        expect(read.seq).toBe(2);
        expect(read.turns.map(t => t.giver)).toEqual(['cairn_h70', 'cairn_h71']);
        expect(JSON.stringify(read)).not.toContain('secret');
        expect(read.receiver.sha256).toBe(nameHash('Secret Name'));
        expect(seen.at(-1)!.seq).toBe(2);
        w.stop([{ tick: 5, ms: 3 }]);
        expect(readCue(dir)!.stop).toBe(true);

        writeStatus(dir, { v: 1, account: 'cairn_h70', phase: 'ready', loggedInAt: 1, essence: 27, tile: null, inRoom: true, readyAt: 2, gave: 0, ms: 3 });
        expect(readStatuses(dir).map(s => s.account)).toEqual(['cairn_h70']);
    });

    test('refuses a cue directory that git would track, accepts an ignored one', () => {
        const repo = mkdtempSync(join(tmpdir(), 'rc-repo-'));
        spawnSync('git', ['init', '-q', repo]);
        writeFileSync(join(repo, '.gitignore'), 'run-machine/\n');
        expect(() => assertUntracked(join(repo, 'docs', 'cue'))).toThrow(/not ignored/);
        expect(() => assertUntracked(join(repo, 'run-machine', 'rc-cue'))).not.toThrow();
        mkdirSync(join(repo, 'run-machine', 'rc-cue'), { recursive: true });
        expect(() => assertUntracked(join(repo, 'run-machine', 'rc-cue'))).not.toThrow();
        expect(() => assertUntracked(mkdtempSync(join(tmpdir(), 'rc-free-')))).not.toThrow();
    });

    test('the default run directory of this checkout is ignored', () => {
        expect(() => assertUntracked(join(import.meta.dir, '..', '..', 'run-machine', 'rc-cue'))).not.toThrow();
    });
});
