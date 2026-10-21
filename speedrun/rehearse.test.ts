import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { baseState, FakeSdk } from './lib/fake-sdk';
import type { DirectVerdict, GateCheck } from './lib/hostgate';
import type { ProgramStatus } from './lib/programs';
import { LOGOUT_BUTTON, logoutClean, type Session, startWatchdog } from './lib/session';
import { TickLog, type TickRow } from './lib/ticks';
import { sleep, waitUntil } from './lib/wait';
import type { Link } from './runner/resume';
import { BOUNDARY_STEP, type Step } from './runner/step';
import {
    annotation, compareHiscore, DEFAULT_GATE_BOT, type DirectRead, EXIT_HOST_RESERVED, formatPlayers, formatSummary, GATE_PLAYERS_STEP, gateRefusal, type InPageRead, kitMissing, kitWant,
    parseArgs, parseDirectJson, parseKit, PAUSE_STEP, playerReads, playerSwing, ProgramTracker, ReachTracker, readReservation, reservationPath, reservationRefusal, ReservationWatch,
    runAttempt, SessionClock, summarize, UsageError,
} from './rehearse';
import type { PlayerRow } from './tools/hiscore-scrape';

describe('parseArgs', () => {
    test('defaults: browser, to 99, no probes on the rehearsal clock', () => {
        expect(parseArgs(['--skill=woodcutting', '--bot=cairn_wc'])).toEqual({
            skill: 'woodcutting', claim: false, bot: 'cairn_wc', client: 'browser', to: 99, lab: false, skillOpts: {}, gateProbeTrials: 0, probeTrials: 0, forceGate: false,
        });
    });

    test('--claim: S00 and logout only, one login: no skill, no gate account even off a local world, no probes', () => {
        const demo = { defaultGateBot: DEFAULT_GATE_BOT };
        const a = parseArgs(['--claim', '--bot=cairn_swings', '--log=/tmp/c.jsonl'], demo);
        expect(a).toEqual({ claim: true, bot: 'cairn_swings', client: 'browser', to: 99, lab: false, skillOpts: {}, gateProbeTrials: 0, probeTrials: 0, forceGate: false, log: '/tmp/c.jsonl' });
        expect(a.gateBot).toBeUndefined();
        expect(parseArgs(['cairn_x', '--claim', '--client=lite', '--lab']).claim).toBe(true);
        for (const extra of ['--skill=x', '--to=15', '--gate-bot=cairn_twin', '--gate-json=/tmp/g.json', '--gate-probe-trials=60', '--probe-trials=20', '--force-gate', '--from=2', '--technique=plain', '--skill-opt=idle=1', '--kit-from=m']) {
            expect(() => parseArgs(['--claim', '--bot=b', extra], demo)).toThrow('--claim runs S00 and logs out, nothing else');
        }
        expect(() => parseArgs(['--claim=yes', '--bot=b'])).toThrow('takes no value');
    });

    test('the bot may come positionally, as lab.sh passes it', () => {
        const a = parseArgs(['srlab1', '--skill=speedrun/runner/stub.ts', '--client=lite', '--lab', '--to=15', '--from=2', '--skill-opt=idle=50', '--skill-opt=k=v=w']);
        expect(a).toMatchObject({ bot: 'srlab1', client: 'lite', lab: true, to: 15, from: 2, skillOpts: { idle: '50', k: 'v=w' } });
        expect(parseArgs(['--skill=x', '--bot=b', '--from=S01 kit']).from).toBe('S01 kit');
        expect(() => parseArgs(['a', '--bot=b', '--skill=x'])).toThrow('two bots');
        expect(() => parseArgs(['a', 'b', '--skill=x'])).toThrow('unexpected arguments');
    });

    test('the gate tab probes default to 60 trials with --gate-bot on the browser client', () => {
        expect(parseArgs(['--skill=x', '--bot=b', '--gate-bot=cairn_twin']).gateProbeTrials).toBe(60);
        expect(parseArgs(['--skill=x', '--bot=b', '--gate-bot=g', '--client=lite']).gateProbeTrials).toBe(0);
        expect(parseArgs(['--skill=x', '--bot=b', '--gate-bot=g', '--gate-probe-trials=20']).gateProbeTrials).toBe(20);
        expect(() => parseArgs(['--skill=x', '--bot=b', '--gate-probe-trials=20'])).toThrow('needs --gate-bot');
        expect(() => parseArgs(['--skill=x', '--bot=b', '--gate-bot=b'])).toThrow('(--gate-bot, b) must be separate');
    });

    test('off a local world the gate account defaults to cairn_twin, with its tab probes', () => {
        const demo = { defaultGateBot: DEFAULT_GATE_BOT };
        expect(DEFAULT_GATE_BOT).toBe('cairn_twin');
        expect(parseArgs(['--skill=x', '--bot=cairn_smoke'], demo)).toMatchObject({ gateBot: 'cairn_twin', gateProbeTrials: 60 });
        expect(parseArgs(['--skill=x', '--bot=cairn_smoke', '--client=lite'], demo)).toMatchObject({ gateBot: 'cairn_twin', gateProbeTrials: 0 });
        expect(parseArgs(['--skill=x', '--bot=b', '--gate-bot=g'], demo).gateBot).toBe('g');
        // A direct read from a file: no gate account, so no gate tab either.
        const fromFile = parseArgs(['--skill=x', '--bot=b', '--gate-json=/tmp/g.json'], demo);
        expect(fromFile.gateBot).toBeUndefined();
        expect(fromFile.gateProbeTrials).toBe(0);
        expect(() => parseArgs(['--skill=x', '--bot=cairn_twin'], demo)).toThrow('the default, cairn_twin');
        // The lab has no default.
        expect(parseArgs(['--skill=x', '--bot=b']).gateBot).toBeUndefined();
    });

    test('refuses what cannot be right', () => {
        const bad: [string[], string][] = [
            [['--bot=b'], '--skill is required (or --claim)'],
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
        expect(parseKit('knife=3')).toEqual([{ debugName: 'knife', name: 'knife', amount: 3 }]);
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
const page = (c: GateCheck, label = 'gate tab before'): InPageRead => ({ label, account: 'cairn_twin', verdict: verdict(c), loopRateP10: 72, at: '' });

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

    test('a claim needs no read off the lab, but a silent world still refuses it', () => {
        expect(gateRefusal({ direct: null, inPage: [], players: 1540, local: false, now, claim: true })).toEqual([]);
        expect(gateRefusal({ direct: null, inPage: [], players: null, local: false, now, claim: true })).toEqual(['the world does not answer /playercount (down or restarting): wait for it']);
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

describe('player count through the attempt', () => {
    const t0 = Date.parse('2026-10-21T20:00:00Z'); // 13:00 PDT
    const min = 60_000;
    const gateRow = (players: number | null) => ({ ...annotation(log, 'a', 'gate', GATE_PLAYERS_STEP, { meta: { players, origin: 'x' } }), at: new Date(t0).toISOString() });
    const playersRow = (players: number | null, minutes: number) =>
        annotation(log, 'a', 'players', '(players) during', { meta: { players, at: new Date(t0 + minutes * min).toISOString(), ms: 40 } });

    test('reads come from the gate row and the players rows, in log order; other rows are ignored', () => {
        const rows = [gateRow(1500), row('S00 tutorial skip', 3), playersRow(1480, 10), annotation(log, 'a', 'gate', '(gate) direct', {}), playersRow(null, 20)];
        expect(playerReads(rows)).toEqual([{ at: t0, players: 1500 }, { at: t0 + 10 * min, players: 1480 }, { at: t0 + 20 * min, players: null }]);
    });

    test('the swing is (highest - lowest) / highest over the answered reads', () => {
        const steady = playerSwing([{ at: 0, players: 1500 }, { at: 1, players: 1200 }, { at: 2, players: 1350 }]);
        expect(steady).toMatchObject({ reads: 3, unanswered: 0, swing: 0.2, moved: false });
        expect(steady.min?.players).toBe(1200);
        expect(steady.max?.players).toBe(1500);
        expect(steady.first?.players).toBe(1500);
        expect(steady.last?.players).toBe(1350);

        // A restart and refill: 1,587 down to 23 and back.
        const restart = playerSwing([{ at: 0, players: 1587 }, { at: 1, players: null }, { at: 2, players: 23 }, { at: 3, players: 900 }]);
        expect(restart).toMatchObject({ reads: 4, unanswered: 1, moved: true });
        expect(restart.swing).toBeCloseTo(1564 / 1587, 10);
        // A refill after a restart just before the attempt also counts (the first read is the low one).
        expect(playerSwing([{ at: 0, players: 23 }, { at: 1, players: 600 }]).moved).toBe(true);
    });

    test('exactly half is not moved; just over is', () => {
        expect(playerSwing([{ at: 0, players: 1000 }, { at: 1, players: 500 }])).toMatchObject({ swing: 0.5, moved: false });
        expect(playerSwing([{ at: 0, players: 1000 }, { at: 1, players: 499 }]).moved).toBe(true);
    });

    test('degenerate inputs: none, one, all unanswered, all zero', () => {
        expect(playerSwing([])).toMatchObject({ reads: 0, swing: 0, moved: false, first: null });
        expect(playerSwing([{ at: 0, players: 40 }])).toMatchObject({ reads: 1, swing: 0, moved: false });
        expect(playerSwing([{ at: 0, players: null }, { at: 1, players: null }])).toMatchObject({ reads: 2, unanswered: 2, swing: 0, moved: false, min: null });
        expect(playerSwing([{ at: 0, players: 0 }, { at: 1, players: 0 }])).toMatchObject({ swing: 0, moved: false });
    });

    test('the summary lines: always the range, and the warning only when it moved', () => {
        expect(formatPlayers(playerSwing([]))).toEqual([]);
        const calm = formatPlayers(playerSwing(playerReads([gateRow(1500), playersRow(1400, 10)])));
        expect(calm).toEqual(['players: 1,500 at the start, 1,400 at the end; lowest 1,400 (13:10:00 PDT), highest 1,500 (13:00:00 PDT); 2 reads']);
        const moved = formatPlayers(playerSwing(playerReads([gateRow(1587), playersRow(null, 10), playersRow(23, 20), playersRow(900, 30)])));
        expect(moved[0]).toBe('players: 1,587 at the start, 900 at the end; lowest 23 (13:20:00 PDT), highest 1,587 (13:00:00 PDT); 4 reads, 1 unanswered');
        expect(moved[1]).toContain('MOVED 99% during the attempt (over 50%)');
        // summarize carries it, and formatSummary prints it.
        const s = summarize([gateRow(1587), playersRow(23, 20), annotation(log, 'a', 'session', '(session)', { sessionId: 1, startTick: 0, endTick: 57 })]);
        expect(s.players.moved).toBe(true);
        expect(formatSummary(s, { account: 'a', skill: 'woodcutting', to: 15, outcome: 'chain done', gate: [], hiscore: null })).toContain('MOVED 99%');
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

describe('host reservation: pre-flight', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rehearse-reservation-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    const at = Date.parse('2026-10-22T02:00:00Z');
    const file = (name: string, text: string) => {
        const p = join(dir, name);
        writeFileSync(p, text);
        return p;
    };
    const watch = (path: string) => {
        const warnings: string[] = [];
        return { w: new ReservationWatch(path, { now: () => at, warn: m => warnings.push(m) }), warnings };
    };

    test('the path: --host-reservation, else $SPEEDRUN_HOST_RESERVATION, else $HOME/host-reserved.json', () => {
        expect(reservationPath(undefined, { HOME: '/home/ubuntu' })).toBe('/home/ubuntu/host-reserved.json');
        expect(reservationPath(undefined, { HOME: '/home/ubuntu', SPEEDRUN_HOST_RESERVATION: '/tmp/r.json' })).toBe('/tmp/r.json');
        expect(reservationPath('/x.json', { HOME: '/home/ubuntu', SPEEDRUN_HOST_RESERVATION: '/tmp/r.json' })).toBe('/x.json');
        expect(parseArgs(['--skill=x', '--bot=b', '--host-reservation=/tmp/r.json']).hostReservation).toBe('/tmp/r.json');
        expect(parseArgs(['--claim', '--bot=b', '--host-reservation=/tmp/r.json'], { defaultGateBot: DEFAULT_GATE_BOT }).hostReservation).toBe('/tmp/r.json');
        expect(parseArgs(['--skill=x', '--bot=b']).hostReservation).toBeUndefined();
    });

    test('live: refused, naming owner, until and reason', () => {
        const reservation = { owner: 'run', until: '2026-10-22T03:00:00Z', reason: 'gate and scored run' };
        const p = file('live.json', JSON.stringify(reservation));
        expect(readReservation(p, at)).toEqual({ state: 'live', reservation });
        const { w, warnings } = watch(p);
        const why = reservationRefusal(w);
        expect(why).toContain('the host is reserved by run until 2026-10-22T03:00:00Z (gate and scored run)');
        expect(why).toContain(p);
        expect(warnings).toEqual([]);
    });

    test('expired: not live, also at exactly `until`', () => {
        const p = file('expired.json', JSON.stringify({ owner: 'rs/host', until: '2026-10-22T01:59:59Z', reason: 'install' }));
        expect(readReservation(p, at).state).toBe('expired');
        expect(reservationRefusal(watch(p).w)).toBeNull();
        const edge = file('edge.json', JSON.stringify({ owner: 'rs/host', until: '2026-10-22T02:00:00Z', reason: '' }));
        expect(reservationRefusal(watch(edge).w)).toBeNull();
    });

    test('missing: not live, and silent', () => {
        const p = join(dir, 'absent.json');
        expect(readReservation(p, at)).toEqual({ state: 'none' });
        const { w, warnings } = watch(p);
        expect(reservationRefusal(w)).toBeNull();
        expect(warnings).toEqual([]);
    });

    test('malformed: not live, with a warning once per distinct problem', () => {
        const { w, warnings } = watch(file('torn.json', '{"owner": "run", "until": '));
        expect(reservationRefusal(w)).toBeNull();
        expect(reservationRefusal(w)).toBeNull();
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('is malformed, so it is not a live reservation: not JSON');
        expect(readReservation(file('array.json', '[]'), at)).toEqual({ state: 'malformed', error: 'not a JSON object' });
        expect(readReservation(file('when.json', '{"owner": "run", "until": "tonight"}'), at)).toEqual({ state: 'malformed', error: '"until" is not a time ("tonight")' });
        expect(readReservation(file('none.json', '{"owner": "run"}'), at)).toEqual({ state: 'malformed', error: '"until" is not a time (null)' });
        // A directory where the file should be: unreadable, which is not live either.
        const r = readReservation(dir, at);
        expect(r.state).toBe('malformed');
    });
});

describe('host reservation: in flight (runAttempt)', () => {
    const prevTick = process.env.SPEEDRUN_TICK_MS;
    beforeAll(() => { process.env.SPEEDRUN_TICK_MS = '5'; });
    afterAll(() => { if (prevTick === undefined) delete process.env.SPEEDRUN_TICK_MS; else process.env.SPEEDRUN_TICK_MS = prevTick; });
    const dir = mkdtempSync(join(tmpdir(), 'rehearse-inflight-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    /** A lite client that ticks every 2 ms; the logout click ends its session as the lite runner does (it exits). */
    function liteClient() {
        const sdk = Object.assign(new FakeSdk(baseState({ tick: 10 })), { checkBotStatus: async () => ({ status: 'active', inGame: true }) });
        const now = Date.now();
        const s = {
            name: 'srtest', client: 'lite', env: { BOT_USERNAME: 'srtest', PASSWORD: 'x' }, sdk, bot: {}, sessionId: 1, expectInWorld: true,
            child: { pid: 4242 }, childExit: null as number | null, lastInWorldTick: 10, lastAdvanceAt: now, launchedAt: now - 60_000,
            lastProgressAt: now, watchdog: null, logPath: '/dev/null',
        };
        const session = s as unknown as Session;
        let online = true;
        const timer = setInterval(() => {
            if (!online) return;
            const st = sdk.tick();
            s.lastInWorldTick = st.tick;
            s.lastAdvanceAt = Date.now();
        }, 2);
        sdk.onSend = a => {
            if (a.method !== 'sendClickComponent' || a.args[0] !== LOGOUT_BUTTON) return;
            online = false;
            setTimeout(() => {
                sdk.push({ inGame: false });
                s.childExit = 1;
            }, 4);
        };
        const link: Link = {
            isLost: () => false,
            lost: async signal => {
                while (!signal.aborted) await sleep(2);
                return 'stopped watching';
            },
            restored: async () => {},
        };
        const logoutClicks = () => sdk.sent.filter(x => x.method === 'sendClickComponent' && x.args[0] === LOGOUT_BUTTON).length;
        return { sdk, session, link, logoutClicks, stop: () => clearInterval(timer) };
    }

    function chain(ran: string[], between: Record<string, () => void> = {}): Step<any>[] {
        return ['one', 'two', 'three'].map(name => ({
            name,
            preconditions: s => s.inGame || 'not in game',
            run: async ({ sdk }) => {
                ran.push(name);
                const t = sdk.getState()!.tick;
                await waitUntil(sdk, st => st.tick >= t + 2, { maxTicks: 20 });
                between[name]?.();
            },
            postconditions: () => true,
            logoutSafe: true,
        }));
    }

    const reserve = (path: string, until: string) => writeFileSync(path, JSON.stringify({ owner: 'run', until, reason: 'gate and scored run' }));
    const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();

    test('a reservation appearing between two steps: clean logout there, the pause row, exit 5, no relaunch', async () => {
        const path = join(dir, 'appears.json');
        const client = liteClient();
        const calls: string[] = [];
        const wd = startWatchdog(client.session, {
            timer: false,
            actions: {
                logout: async () => { calls.push('logout'); throw new Error('unexpected'); },
                login: async () => { calls.push('login'); },
                relaunch: async () => { calls.push('relaunch'); },
                reconnect: async () => { calls.push('reconnect'); },
            },
        });
        const ran: string[] = [];
        const until = inAnHour();
        const tlog = TickLog.memory('pause');
        const r = await runAttempt(client.session, chain(ran, { one: () => reserve(path, until) }), {
            log: tlog, account: 'srtest', link: client.link, from: 0,
            reservation: new ReservationWatch(path), stopAsked: () => false, gateStop: () => null,
            logout: () => logoutClean(client.session),
        });
        client.stop();

        expect(ran).toEqual(['one']);
        expect(r.code).toBe(EXIT_HOST_RESERVED);
        expect(r.paused).toEqual({ owner: 'run', until, reason: 'gate and scored run' });
        expect(r.outcome).toContain(`PAUSED for the gate/run: the host is reserved by run until ${until} (gate and scored run); logged out before "two"`);
        // One page-confirmed logoutClean, and the account is meant to stay out.
        expect(client.logoutClicks()).toBe(1);
        expect(client.session.expectInWorld).toBe(false);

        const pause = tlog.rows.filter(x => x.kind === 'gate' && x.step === PAUSE_STEP);
        expect(pause).toHaveLength(1);
        expect(pause[0]!.ok).toBe(true);
        expect(pause[0]!.meta).toMatchObject({ owner: 'run', until, reason: 'gate and scored run', path, before: 'two', logout: { ok: true, confirmedBy: 'child' } });
        // The runner's own logout boundary sits before it.
        expect(tlog.rows.some(x => x.step === BOUNDARY_STEP && x.meta?.ended === '(logout)') || tlog.rows.some(x => x.step === BOUNDARY_STEP)).toBe(true);

        // The summary shows the pause.
        const summary = summarize(tlog.rows);
        expect(summary.pauses).toEqual([{ owner: 'run', until, reason: 'gate and scored run', sessionId: 1, tick: pause[0]!.startTick, at: pause[0]!.at, before: 'two' }]);
        expect(formatSummary(summary, { account: 'srtest', skill: 'woodcutting', to: 15, outcome: r.outcome, gate: [], hiscore: null }))
            .toContain(`PAUSED for the gate/run at ${pause[0]!.at}: host reserved by run until ${until} (gate and scored run); logged out at tick ${pause[0]!.startTick} of session 1, before "two"`);

        // The lite runner has exited after the logout; the crash-recovery watchdog leaves it out.
        expect(client.session.childExit).toBe(1);
        await wd.check();
        wd.resume();
        await wd.check();
        expect(calls).toEqual([]);
        wd.stop();
    });

    test('a reservation that is already expired mid-run is ignored: the chain finishes', async () => {
        const path = join(dir, 'expired.json');
        const client = liteClient();
        const ran: string[] = [];
        const tlog = TickLog.memory('expired');
        const r = await runAttempt(client.session, chain(ran, { one: () => reserve(path, '2026-10-21T00:00:00Z') }), {
            log: tlog, account: 'srtest', link: client.link, from: 0,
            reservation: new ReservationWatch(path), stopAsked: () => false, gateStop: () => null,
            logout: () => logoutClean(client.session),
        });
        client.stop();
        expect(ran).toEqual(['one', 'two', 'three']);
        expect(r).toEqual({ outcome: 'chain done', code: 0, paused: null });
        expect(client.logoutClicks()).toBe(0);
        expect(tlog.rows.some(x => x.step === PAUSE_STEP)).toBe(false);
    });

    test('no file: Ctrl-C still stops at the boundary with exit 4, as before', async () => {
        const client = liteClient();
        const ran: string[] = [];
        let stop = false;
        const r = await runAttempt(client.session, chain(ran, { two: () => (stop = true) }), {
            log: TickLog.memory('sigint'), account: 'srtest', link: client.link, from: 0,
            reservation: new ReservationWatch(join(dir, 'never.json')), stopAsked: () => stop, gateStop: () => null,
            logout: () => logoutClean(client.session),
        });
        client.stop();
        expect(ran).toEqual(['one', 'two']);
        expect(r).toEqual({ outcome: 'stopped before "three"; logged out', code: 4, paused: null });
        expect(client.logoutClicks()).toBe(1);
    });
});
