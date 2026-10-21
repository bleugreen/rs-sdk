import { describe, expect, test } from 'bun:test';
import type { DirectVerdict, GateCheck } from './lib/hostgate';
import type { ProgramStatus } from './lib/programs';
import type { TickRow } from './lib/ticks';
import { BOUNDARY_STEP } from './runner/step';
import {
    annotation, compareHiscore, type DirectRead, formatSummary, gateRefusal, type InPageRead, kitMissing, kitWant, parseArgs, parseDirectJson, parseKit,
    ProgramTracker, ReachTracker, SessionClock, summarize, UsageError,
} from './rehearse';
import type { PlayerRow } from './tools/hiscore-scrape';

describe('parseArgs', () => {
    test('defaults: browser, to 99, no probes on the rehearsal clock', () => {
        expect(parseArgs(['--skill=woodcutting', '--bot=cairn_wc'])).toEqual({
            skill: 'woodcutting', bot: 'cairn_wc', client: 'browser', to: 99, lab: false, skillOpts: {}, gateProbeTrials: 0, probeTrials: 0, forceGate: false,
        });
    });

    test('the bot may come positionally, as lab.sh passes it', () => {
        const a = parseArgs(['srlab1', '--skill=speedrun/runner/stub.ts', '--client=lite', '--lab', '--to=15', '--from=2', '--skill-opt=idle=50', '--skill-opt=k=v=w']);
        expect(a).toMatchObject({ bot: 'srlab1', client: 'lite', lab: true, to: 15, from: 2, skillOpts: { idle: '50', k: 'v=w' } });
        expect(parseArgs(['--skill=x', '--bot=b', '--from=S01 kit']).from).toBe('S01 kit');
        expect(() => parseArgs(['a', '--bot=b', '--skill=x'])).toThrow('two bots');
        expect(() => parseArgs(['a', 'b', '--skill=x'])).toThrow('unexpected arguments');
    });

    test('the gate tab probes default to 60 trials with --gate-bot on the browser client', () => {
        expect(parseArgs(['--skill=x', '--bot=b', '--gate-bot=cairn_gate']).gateProbeTrials).toBe(60);
        expect(parseArgs(['--skill=x', '--bot=b', '--gate-bot=g', '--client=lite']).gateProbeTrials).toBe(0);
        expect(parseArgs(['--skill=x', '--bot=b', '--gate-bot=g', '--gate-probe-trials=20']).gateProbeTrials).toBe(20);
        expect(() => parseArgs(['--skill=x', '--bot=b', '--gate-probe-trials=20'])).toThrow('needs --gate-bot');
        expect(() => parseArgs(['--skill=x', '--bot=b', '--gate-bot=b'])).toThrow('separate gate account');
    });

    test('refuses what cannot be right', () => {
        const bad: [string[], string][] = [
            [['--bot=b'], '--skill is required'],
            [['--skill=x'], '--bot is required'],
            [['--skill=x', '--bot=b', '--client=chrome'], 'browser or lite'],
            [['--skill=x', '--bot=b', '--to=100'], 'from 2 to 99'],
            [['--skill=x', '--bot=b', '--to=9.5'], 'whole number'],
            [['--skill=x', '--bot=b', '--technique=fast'], 'auto, knife or plain'],
            [['--skill=x', '--bot=b', '--kit-from=mule'], 'needs --kit'],
            [['--skill=x', '--bot=b', '--kit=knife'], 'only the lab'],
            [['--skill=x', '--bot=b', '--client=lite', '--probe-trials=20'], 'lite client hosts no in-page programs'],
            [['--skill=x', '--bot=b', '--skil=y'], 'unknown option --skil'],
            [['--skill=x', '--bot=b', '--lab=yes'], 'takes no value'],
            [['--skill=x', '--bot=b', '--log'], 'needs a value'],
            [['--skill=x', '--skill=y', '--bot=b'], 'given twice'],
            [['--skill=x', '--bot=b', '--skill-opt=novalue'], '<key>=<value>'],
        ];
        for (const [argv, msg] of bad) {
            expect(() => parseArgs(argv)).toThrow(UsageError);
            expect(() => parseArgs(argv)).toThrow(msg);
        }
    });

    test('--insecure-query-login is accepted for session.ts to read', () => {
        expect(parseArgs(['--skill=x', '--bot=b', '--lab', '--insecure-query-login']).lab).toBe(true);
    });
});

describe('kit', () => {
    test('parses debug names into ::give names and trade wants', () => {
        const kit = parseKit('rune_axe:1, knife,feather:800');
        expect(kit).toEqual([
            { debugName: 'rune_axe', name: 'rune axe', amount: 1 },
            { debugName: 'knife', name: 'knife', amount: 1 },
            { debugName: 'feather', name: 'feather', amount: 800 },
        ]);
        expect(kitWant(kit)).toEqual([{ item: 'rune axe', amount: 1 }, { item: 'knife', amount: 1 }, { item: 'feather', amount: 800 }]);
        expect(() => parseKit('rune axe:1')).toThrow('bad kit item');
        expect(() => parseKit('knife,knife:2')).toThrow('listed twice');
        expect(() => parseKit('knife:0')).toThrow('at least 1');
        expect(() => parseKit(' , ')).toThrow('empty');
    });

    test('missing counts every matching stack; the lenient form asks only for presence', () => {
        const kit = parseKit('rune_axe,feather:800,logs:2');
        const inv = [{ name: 'Rune axe', count: 1 }, { name: 'Feather', count: 500 }, { name: 'Feather', count: 100 }, { name: 'Oak logs', count: 1 }];
        expect(kitMissing(inv, kit)).toEqual(['feather 600/800', 'logs 1/2']);
        expect(kitMissing(inv, kit, { strict: false })).toEqual([]);
        expect(kitMissing([], kit, { strict: false })).toEqual(['rune axe 0/1', 'feather 0/800', 'logs 0/2']);
    });
});

const checkC = (ok: boolean | null, value: number | null = ok === false ? 4 : 0.5): GateCheck => ({ id: 'c', name: 'catch-ups per minute', role: 'pass', ok, value, limit: 2 });
const verdict = (c: GateCheck): DirectVerdict => ({
    path: 'direct', on: c.ok !== false, status: c.ok === false ? 're-measure' : 'pass', onTime: 60, trials: 60, passAt: 60, floorAt: 58, lead: 0, failures: [],
    checks: [{ id: 'a', name: 'on-time trials', role: 'pass', ok: true, value: 60, limit: 58 }, { id: 'b', name: 'tick p90', role: 'report', ok: true, value: 310, limit: 400 }, c, { id: 'd', name: 'loop rate p10', role: 'pass', ok: null, value: null, limit: 50 }],
});
const now = Date.parse('2026-10-21T20:00:00Z');
const read = (c: GateCheck, over: Partial<DirectRead> = {}): DirectRead => ({ source: 'gate-bot', takenAt: '2026-10-21T19:58:00Z', verdict: verdict(c), vantage: null, ...over });
const page = (c: GateCheck, label = 'gate tab before'): InPageRead => ({ label, account: 'cairn_gate', verdict: verdict(c), loopRateP10: 72, at: '' });

describe('gateRefusal', () => {
    test('a clean read on a live world goes', () => {
        expect(gateRefusal({ direct: read(checkC(true)), inPage: [page(checkC(true))], players: 41, local: false, now })).toEqual([]);
    });

    test('(c) failing on the direct read or on an in-page probe refuses', () => {
        expect(gateRefusal({ direct: read(checkC(false)), inPage: [], players: 41, local: false, now })).toEqual([
            '(c) 4 catch-ups per minute over 2 on the direct read: an overrun period; wait and re-read',
        ]);
        expect(gateRefusal({ direct: read(checkC(true)), inPage: [page(checkC(false, 3))], players: 41, local: false, now })[0]).toContain('on the gate tab before in-page probe');
    });

    test('(a) short of the floor does not refuse here; it is printed with the verdict', () => {
        const v = verdict(checkC(true));
        v.checks[0] = { ...v.checks[0]!, ok: false, value: 50 };
        expect(gateRefusal({ direct: { ...read(checkC(true)), verdict: v }, inPage: [], players: 41, local: false, now })).toEqual([]);
    });

    test('off the lab: no read, a failed read, a stale file, or a silent world refuse', () => {
        expect(gateRefusal({ direct: null, inPage: [], players: 41, local: false, now })[0]).toContain('no direct gate read');
        expect(gateRefusal({ direct: read(checkC(true), { verdict: null, error: 'vantage: TCP connect p50 24 ms' }), inPage: [], players: 41, local: false, now })).toEqual(['direct gate read failed: vantage: TCP connect p50 24 ms']);
        expect(gateRefusal({ direct: read(checkC(true), { source: 'gate-json', takenAt: '2026-10-21T19:40:00Z' }), inPage: [], players: 41, local: false, now })).toEqual(['the direct gate read is 20 min old (at most 10 min)']);
        expect(gateRefusal({ direct: read(checkC(true), { source: 'gate-json', takenAt: null }), inPage: [], players: 41, local: false, now })[0]).toContain('undated');
        expect(gateRefusal({ direct: read(checkC(true)), inPage: [], players: null, local: false, now })[0]).toContain('does not answer');
    });

    test('the lab needs no read', () => {
        expect(gateRefusal({ direct: null, inPage: [], players: null, local: true, now })).toEqual([]);
    });

    test('parseDirectJson takes what tickmanip-latency --json writes', () => {
        const v = verdict(checkC(true));
        expect(parseDirectJson({ path: 'direct', startedUtc: '2026-10-21T19:58:00Z', verdict: v, result: {} }, 'gate-json')).toEqual({ source: 'gate-json', takenAt: '2026-10-21T19:58:00Z', vantage: null, verdict: v });
        expect(parseDirectJson({ path: 'relay' }, 'gate-json').error).toContain('not a tickmanip-latency');
    });
});

const log = { runId: 'r' };
const row = (step: string, ticks: number, extra: Partial<TickRow> = {}): TickRow => ({
    v: 1, runId: 'r', account: 'a', sessionId: 1, step, startTick: 0, endTick: ticks, ticks, wallMs: 0, ok: true, tickMs: 300, at: '', ...extra,
});
const session = (endTick: number, extra: Partial<TickRow> = {}) => annotation(log, 'a', 'session', '(session)', { sessionId: 1, startTick: 0, endTick, ...extra });
const reached = (skill: string, level: number, tick: number) => annotation(log, 'a', 'reach', `(reach) ${skill} ${level}`, { startTick: tick, meta: { skill, level } });

describe('summarize', () => {
    // The lab shape: login, a 2-tick wait in openSession, S00 3 ticks, a 50-tick stub, logout on the end tick.
    const rows = [
        row('(resume)', 0),
        row(BOUNDARY_STEP, 0), row('S00 tutorial skip', 3), row(BOUNDARY_STEP, 1), row('stub: idle 50 ticks', 50), row(BOUNDARY_STEP, 0),
        session(57),
    ];

    test('session, steps, boundaries and what lies outside the runner', () => {
        const s = summarize(rows);
        expect(s).toMatchObject({ sessionTicks: 57, playtime: 58, stepTicks: 53, boundaryTicks: 1, boundaries: 3, runnerTicks: 0, outsideTicks: 3, overhead: 4, overheadPerBoundary: 1.33, lowerBound: false });
        expect(s.steps.map(x => x.step)).toEqual(['S00 tutorial skip', 'stub: idle 50 ticks']);
    });

    test('reach rows take the playtime of the sessions before theirs', () => {
        const s = summarize([reached('woodcutting', 15, 40), session(100), reached('woodcutting', 16, 7), session(20, { sessionId: 2 })]);
        expect(s.reach).toEqual([{ skill: 'woodcutting', level: 15, playtime: 40 }, { skill: 'woodcutting', level: 16, playtime: 101 + 7 }]);
        expect(s.playtime).toBe(101 + 21);
    });

    test('a session ended by a relaunch is a lower bound', () => {
        expect(summarize([session(30, { meta: { ended: 'relaunch' } }), session(40)]).lowerBound).toBe(true);
    });

    test('the summary screen carries the numbers', () => {
        const text = formatSummary(summarize(rows), { account: 'cairn_smoke', skill: 'woodcutting', to: 15, outcome: 'chain done', gate: ['41 players online'], hiscore: null });
        expect(text).toContain('rehearsal cairn_smoke: woodcutting to 15: chain done');
        expect(text).toContain('session: 57 ticks (57) -> playtime 58');
        expect(text).toContain('overhead 4 = 1.33 per boundary');
    });
});

const player = (rows: [number, string, number | null, number | null][]): PlayerRow[] => rows.map(([category, skill, level, ticks]) => ({ category, skill, rank: null, level, ticks }));

describe('compareHiscore', () => {
    test('a fresh account with no level gained: Overall is the logout playtime', () => {
        const s = summarize([session(57)]);
        expect(compareHiscore(s, player([[0, 'Overall', 32, 59], [9, 'Woodcutting', null, null]]), 'woodcutting')).toEqual([
            { row: 'Woodcutting', hiscore: null, expected: null, diff: null, ok: null, basis: 'no row (under level 15)' },
            { row: 'Overall', hiscore: 59, expected: 58, diff: 1, ok: true, basis: 'logout playtime (no level gained)' },
        ]);
    });

    test('a skill row is its level\'s reach playtime; Overall the latest level gained', () => {
        const s = summarize([reached('woodcutting', 14, 30), reached('woodcutting', 15, 41), reached('firemaking', 2, 50), session(60)]);
        const checks = compareHiscore(s, player([[0, 'Overall', 46, 50], [9, 'Woodcutting', 15, 45]]), 'woodcutting');
        expect(checks[0]).toMatchObject({ row: 'Woodcutting 15', hiscore: 45, expected: 41, diff: 4, ok: false });
        expect(checks[1]).toMatchObject({ row: 'Overall', expected: 50, diff: 0, ok: true });
    });

    test('no page yet', () => {
        expect(compareHiscore(summarize([]), null, 'mining')[0]!.basis).toContain('no player page');
    });
});

describe('trackers', () => {
    test('SessionClock keeps first and last in-world tick per client session', () => {
        const c = new SessionClock();
        c.observe(1, { tick: 3, inGame: true });
        c.observe(1, { tick: 9, inGame: true });
        c.observe(1, { tick: 2, inGame: false });
        c.observe(2, { tick: 1, inGame: true });
        expect([...c.sessions]).toEqual([[1, { first: 3, last: 9 }], [2, { first: 1, last: 1 }]]);
    });

    test('ReachTracker reports each level gained after the first state', () => {
        const t = new ReachTracker();
        const st = (tick: number, wc: number, fm = 1) => ({ tick, inGame: true, skills: [{ name: 'Woodcutting', level: wc, baseLevel: wc, experience: 0 }, { name: 'Firemaking', level: fm, baseLevel: fm, experience: 0 }] });
        expect(t.observe(st(1, 1))).toEqual([]);
        expect(t.observe(st(5, 3))).toEqual([{ skill: 'woodcutting', level: 2, tick: 5 }, { skill: 'woodcutting', level: 3, tick: 5 }]);
        expect(t.observe(st(6, 3, 2))).toEqual([{ skill: 'firemaking', level: 2, tick: 6 }]);
        expect(t.observe({ tick: 7, inGame: false, skills: [] })).toEqual([]);
    });

    test('ProgramTracker logs each run once: at its end, or as replaced by the next', () => {
        const st = (runId: number, phase: ProgramStatus['phase'], tick: number) => ({ runId, name: 'knife-cycle', phase, startedTick: runId * 100, tick } as ProgramStatus);
        const t = new ProgramTracker();
        expect(t.observe(null)).toEqual([]);
        expect(t.observe(st(1, 'running', 101))).toEqual([]);
        expect(t.observe(st(1, 'done', 150)).map(s => [s.runId, s.phase])).toEqual([[1, 'done']]);
        expect(t.observe(st(1, 'done', 151))).toEqual([]);
        expect(t.observe(st(2, 'running', 201))).toEqual([]);
        expect(t.observe(st(3, 'running', 301)).map(s => [s.runId, s.phase])).toEqual([[2, 'replaced']]);
        expect(t.flush().map(s => [s.runId, s.phase])).toEqual([[3, 'running']]);
        expect(t.flush()).toEqual([]);
    });
});
