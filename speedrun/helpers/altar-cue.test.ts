import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    assertUntracked,
    canonName,
    chooseTurn,
    cueAddresses,
    CueWatcher,
    CueWriter,
    cycleTicks,
    FrameLog,
    giverSteps,
    judgeTick,
    MissBench,
    nameHash,
    STATUS_FRESH_MS,
    STOCK_MIN_TICKS,
    STOCK_WINDOW,
    turnOrder,
    readCue,
    readStatuses,
    resolveOffset,
    scopeOption,
    scoredSteps,
    turnKey,
    writeStatus,
    type Beacon,
    type Cue,
    type CueFamily,
    type CueScope
} from './altar-cue';

const frames = (ticks: number[], ms0: number, step = 300, jitter: (i: number) => number = () => 0): Beacon[] =>
    ticks.map((tick, i) => ({ tick, ms: ms0 + i * step + jitter(i) }));

const cue = (over: Partial<Cue> = {}): Cue => ({
    v: 1,
    scope: { step: 'S06', family: 'altar' },
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

describe('MissBench', () => {
    test('a failed turn skips its giver until it reports ready after the turn was named', () => {
        const b = new MissBench();
        b.miss('Cairn H71', 5_000);
        // its status from before the turn (a dead client: the file stops changing)
        expect(b.skips({ account: 'cairn_h71', readyAt: 4_000 })).toBe(true);
        expect(b.skips({ account: 'cairn_h71', readyAt: null })).toBe(true);
        expect(b.skips({ account: 'cairn_h71', readyAt: 5_000 })).toBe(true);
        expect(b.skips({ account: 'cairn_h70', readyAt: 1 })).toBe(false);
        expect(b.benched).toEqual(['cairn_h71']);
        // ready again after the turn (a live giver's result, or a relaunched process): lifted for good
        expect(b.skips({ account: 'cairn_h71', readyAt: 5_001 })).toBe(false);
        expect(b.skips({ account: 'cairn_h71', readyAt: 4_000 })).toBe(false);
        expect(b.benched).toEqual([]);
    });

    test('a later miss moves the bar; a turn no cue carried benches nobody', () => {
        const b = new MissBench();
        b.miss('g1', 5_000);
        b.miss('g1', 7_000);
        b.miss('g1', 6_000);
        expect(b.skips({ account: 'g1', readyAt: 6_500 })).toBe(true);
        expect(b.skips({ account: 'g1', readyAt: 7_001 })).toBe(false);
        b.miss('g2', undefined);
        expect(b.skips({ account: 'g2', readyAt: 1 })).toBe(false);
    });
});

describe('turnOrder: the one turn-taking rule of both giver families', () => {
    const now = 100_000;
    const c = (account: string, readyAt: number | null, extra: { ms?: number; holding?: boolean; ok?: boolean } = {}) => ({ account, readyAt, ms: extra.ms ?? now - 1_000, holding: !!extra.holding, ok: extra.ok ?? true });
    const names = (xs: { account: string }[]) => xs.map(x => x.account);
    const rule = { eligible: (x: { ok: boolean }) => x.ok, holding: (x: { holding: boolean }) => x.holding };

    test('current, eligible candidates: those holding the turn first, then oldest ready, then by name', () => {
        const order = turnOrder([c('b03', 500), c('b02', 300), c('b04', 300), c('b01', 900, { holding: true })], now, rule);
        expect(names(order)).toEqual(['b01', 'b02', 'b04', 'b03']);
    });

    test('a stale heartbeat or an ineligible candidate is out; an unknown readyAt goes last', () => {
        const order = turnOrder([c('b01', 100, { ms: now - STATUS_FRESH_MS - 1 }), c('b02', 200, { ok: false }), c('b03', null), c('b04', 400)], now, rule);
        expect(names(order)).toEqual(['b04', 'b03']);
    });

    test('a giver benched after a failed turn (MissBench) is skipped until it reports ready again', () => {
        const bench = new MissBench();
        bench.miss('b01', 1_000);
        expect(names(turnOrder([c('b01', 900), c('b02', 950)], now, { ...rule, bench }))).toEqual(['b02']);
        expect(names(turnOrder([c('b01', 1_001), c('b02', 950)], now, { ...rule, bench }))).toEqual(['b02', 'b01']);
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

const S06_ALTAR: CueScope = { step: 'S06', family: 'altar' };

describe('cue scopes', () => {
    test('a cue addresses only its own step and family; a cue without a scope addresses nobody', () => {
        expect(cueAddresses(cue(), 'S06', 'altar')).toBe(true);
        expect(cueAddresses(cue(), 'S21', 'altar')).toBe(false);
        expect(cueAddresses(cue(), 'S06', 'bone')).toBe(false);
        expect(cueAddresses({ ...cue(), scope: undefined } as unknown as Cue, 'S06', 'altar')).toBe(false);
        expect(cueAddresses(null, 'S06', 'altar')).toBe(false);
    });

    test('the writer refuses a missing or malformed scope', () => {
        const dir = mkdtempSync(join(tmpdir(), 'rc-cue-'));
        expect(() => new CueWriter(dir, 'x', undefined as unknown as CueScope)).toThrow(/scope \{ step, family \} is required/);
        expect(() => new CueWriter(dir, 'x', { step: '', family: 'altar' })).toThrow(/needs a step/);
        expect(() => new CueWriter(dir, 'x', { step: 'S07', family: 'bones' as CueFamily })).toThrow(/family must be one of/);
    });

    test('the launcher-only families (fmrow, ring) are cue families: a writer and a watcher take them', () => {
        const dir = mkdtempSync(join(tmpdir(), 'rc-cue-'));
        for (const s of [{ step: 'S03', family: 'fmrow' }, { step: 'S04', family: 'ring' }] as CueScope[]) {
            expect(new CueWriter(dir, 'scored', s).stop([{ tick: 1, ms: 1 }]).scope).toEqual(s);
            new CueWatcher(dir, s, () => {}).close();
        }
    });

    test("a role's scope option must name a family the role serves", () => {
        expect(scopeOption({ step: 'S07', family: 'bone' }, ['bone'])).toEqual({ step: 'S07', family: 'bone' });
        expect(() => scopeOption({ step: 'S07', family: 'courier' }, ['bone'])).toThrow(/scope.family must be bone/);
        expect(() => scopeOption(undefined, ['altar'])).toThrow(/^scope: a cue scope/);
    });

    test("S06's stop is invisible to an S07 bone and an S18 courier watcher; an S06 altar watcher stops on it; each foreign scope is logged once", async () => {
        const dir = mkdtempSync(join(tmpdir(), 'rc-cue-'));
        const seen: Record<string, Cue[]> = { altar: [], bone: [], courier: [] };
        const logs: Record<string, string[]> = { altar: [], bone: [], courier: [] };
        const watch = (k: 'altar' | 'bone' | 'courier', scope: CueScope) => new CueWatcher(dir, scope, c => seen[k]!.push(c), { pollMs: 5, log: m => logs[k]!.push(m) });
        const watchers = [watch('altar', S06_ALTAR), watch('bone', { step: 'S07', family: 'bone' }), watch('courier', { step: 'S18', family: 'courier' })];
        const w = new CueWriter(dir, 'scored', S06_ALTAR);
        w.addTurn({ giver: 'cairn_h70', T: 10 }, [{ tick: 3, ms: 1 }]);
        await Bun.sleep(30);
        w.stop([{ tick: 4, ms: 2 }]);
        await Bun.sleep(30);
        expect(seen.altar!.at(-1)!.stop).toBe(true);
        expect(seen.bone).toEqual([]);
        expect(seen.courier).toEqual([]);
        expect(logs.bone).toEqual(['cue ignored: addressed to another step or family']);
        expect(logs.courier).toEqual(['cue ignored: addressed to another step or family']);
        expect(logs.altar).toEqual([]);

        // S07's own cue, written after S06's stop, reaches the bone watcher and only it.
        new CueWriter(dir, 'scored', { step: 'S07', family: 'bone' }).write({ beacons: [{ tick: 5, ms: 3 }], turns: [] });
        await Bun.sleep(30);
        expect(seen.bone!.map(c => [c.scope.step, !!c.stop])).toEqual([['S07', false]]);
        expect(seen.altar!.every(c => c.scope.step === 'S06')).toBe(true);
        for (const x of watchers) x.close();
    });

    test('a cue without a scope is refused, logged once, and never reaches the role', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'rc-cue-'));
        const seen: Cue[] = [];
        const logs: string[] = [];
        const watcher = new CueWatcher(dir, S06_ALTAR, c => seen.push(c), { pollMs: 5, log: m => logs.push(m) });
        const { scope: _scope, ...legacy } = cue({ stop: true });
        writeFileSync(join(dir, 'cue.json'), JSON.stringify(legacy));
        await Bun.sleep(30);
        writeFileSync(join(dir, 'cue.json'), JSON.stringify({ ...legacy, seq: 2 }));
        await Bun.sleep(30);
        watcher.close();
        expect(seen).toEqual([]);
        expect(logs).toEqual(['cue refused: cue.json has no scope { step, family }']);
    });

    test('onOther: every new cue for another scope, once per write; its own scope never goes there', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'rc-cue-'));
        const mine: Cue[] = [];
        const others: Cue[] = [];
        const watcher = new CueWatcher(dir, S06_ALTAR, c => mine.push(c), { pollMs: 5, log: () => {}, onOther: c => others.push(c) });
        const bone = new CueWriter(dir, 'scored', { step: 'S07', family: 'bone' });
        bone.write({ beacons: [{ tick: 1, ms: 1 }], turns: [] });
        await Bun.sleep(30);
        bone.stop([{ tick: 2, ms: 2 }]);
        await Bun.sleep(30);
        new CueWriter(dir, 'scored', S06_ALTAR).write({ beacons: [{ tick: 3, ms: 3 }], turns: [] });
        await Bun.sleep(30);
        watcher.close();
        expect(others.map(c => [c.scope.step, c.seq, !!c.stop])).toEqual([
            ['S07', 1, false],
            ['S07', 2, true]
        ]);
        expect(mine.map(c => c.scope.step)).toEqual(['S06']);
    });

    test('the watcher refuses to start without a scope', () => {
        const dir = mkdtempSync(join(tmpdir(), 'rc-cue-'));
        expect(() => new CueWatcher(dir, undefined as unknown as CueScope, () => {})).toThrow(/CueWatcher: a cue scope/);
    });
});

describe('files', () => {
    test('writer, watcher and status files round-trip, and the cue never holds the name', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'rc-cue-'));
        const seen: Cue[] = [];
        const watcher = new CueWatcher(dir, S06_ALTAR, c => seen.push(c), { pollMs: 5 });
        const w = new CueWriter(dir, 'secret_name', S06_ALTAR);
        w.addTurn({ giver: 'cairn_h70', T: 10 }, [{ tick: 3, ms: 1 }]);
        w.addTurn({ giver: 'cairn_h71', T: 17 }, [{ tick: 4, ms: 2 }]);
        await Bun.sleep(60);
        watcher.close();
        const read = readCue(dir)!;
        expect(read.seq).toBe(2);
        expect(read.scope).toEqual(S06_ALTAR);
        expect(read.turns.map(t => t.giver)).toEqual(['cairn_h70', 'cairn_h71']);
        expect(JSON.stringify(read)).not.toContain('secret');
        expect(read.receiver.sha256).toBe(nameHash('Secret Name'));
        expect(seen.at(-1)!.seq).toBe(2);
        w.stop([{ tick: 5, ms: 3 }]);
        expect(readCue(dir)!.stop).toBe(true);
        expect(readCue(dir)!.final).toBeUndefined();
        // The scope's last stop says so; final without stop is refused.
        w.stop([{ tick: 6, ms: 4 }], { final: true });
        expect(readCue(dir)).toMatchObject({ stop: true, final: true, seq: 4 });
        expect(() => w.write({ beacons: [{ tick: 7, ms: 5 }], turns: [], final: true })).toThrow(/final needs stop/);

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
